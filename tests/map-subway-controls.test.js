"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
const context = vm.createContext({ window:{}, document:{}, location:{ protocol:"file:" }, navigator:{ onLine:true } });
vm.runInContext(source, context);
const inView = vm.runInContext("mapSubwayRouteInView", context);
const project = ([x,y]) => ({ x,y });
const size = { x:100, y:100 };

test("노선 일부가 보이면 유지: 화면 안의 역·역 사이 구간·화면 경계", () => {
  assert.equal(inView({ A:[50,50] }, () => [], project, size), true);
  assert.equal(inView({ A:[-20,50], B:[120,50] }, n => n === "A" ? ["B"] : ["A"], project, size), true);
  assert.equal(inView({ A:[50,-20], B:[50,120] }, n => n === "A" ? ["B"] : ["A"], project, size), true);
  assert.equal(inView({ A:[-20,-20], B:[0,0] }, () => ["B"], project, size), true);
});

test("노선 전체가 화면 밖이면 이동: 범위 사각형만 겹쳐도 실제 구간이 없으면 밖이다", () => {
  assert.equal(inView({ A:[-20,-20], B:[-20,120], C:[120,120] },
    n => ({ A:["B"], B:["A","C"], C:["B"] })[n], project, size), false);
  assert.equal(inView({ A:[-20,10], B:[10,-20] }, () => ["B"], project, size), false);
  assert.equal(inView({ A:[-20,50], B:[120,50] }, () => [], project, size), false);
  assert.equal(inView({}, () => [], project, size), false);
});

/* 브라우저 없이 실제 선택·중지·조회 코드를 실행한다. 지도와 타이머만 대역으로 교체한다. */
function controls(){
  const events = {};
  const requests = [], fitted = [], intervals = new Set(), frames = new Set(), ingested = [];
  let nextId = 0;
  const table = {
    "가노선":{ A:[-20,50], B:[120,50] },
    "나노선":{ A:[200,200], B:[300,300] }
  };
  const layer = () => ({
    present:false, cleared:0,
    clearLayers(){ this.cleared++; },
    addTo(){ this.present = true; }
  });
  const select = { value:"", addEventListener:(name, handler) => { events[name] = handler; } };
  const ctx = vm.createContext({
    subwayOn:false, subwayShown:-1, subwayNote:"", subwayRequestSeq:0, subwayFetching:false,
    subwayTimer:0, subwayFrame:0, subwayLabelsShown:false, subwayStationDots:[],
    subwayTrains:new Map(), subwayMarkers:new Map(), subwayLayer:layer(), subwayRouteLayer:layer(),
    subwayLineSelect:select, subwayViewAll:() => {},
    document:{ hidden:false }, stage:{ offsetParent:{} },
    map:{
      latLngToContainerPoint:project, getSize:() => size,
      fitBounds:(points, options) => fitted.push({ points, options }),
      on:() => {}, off:() => {}, removeLayer:l => { l.present = false; }
    },
    MNSubwayLive:{
      stationsOf:line => table[line], neighbours:(_line, n) => n === "A" ? ["B"] : ["A"],
      ingest:(_trains, rows, line) => { ingested.push({ rows, line }); return new Set(); }
    },
    mapSubwayRouteInView:inView,
    mapT:text => text, mapTf:(text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k]),
    setStatus:text => { ctx.status = text; }, syncSubwayPicker:() => { ctx.selected = select.value; },
    subwayDrawRoute:() => { ctx.drawn = select.value; }, subwaySyncLabels:() => {},
    subwayCloseArrivals:() => { ctx.arrivalClosed = true; }, subwayRender:() => {},
    MAP_SUBWAY_POLL_MS:15000,
    setInterval:() => { const id = ++nextId; intervals.add(id); return id; },
    clearInterval:id => intervals.delete(id),
    requestAnimationFrame:() => { const id = ++nextId; frames.add(id); return id; },
    cancelAnimationFrame:id => frames.delete(id),
    fetch:url => new Promise((resolve, reject) => requests.push({ url, resolve, reject }))
  });
  const statusStart = source.indexOf("    const subwayStatus = (shown) => {");
  const pollEnd = source.indexOf("    /* ── 역별 도착 정보", statusStart);
  const controlStart = source.indexOf("    const subwayStop = () => {");
  const controlEnd = source.indexOf("    toolChips.appendChild(subwayLinePicker);", controlStart);
  assert.ok(statusStart > 0 && pollEnd > statusStart && controlStart > pollEnd && controlEnd > controlStart);
  vm.runInContext(source.slice(statusStart, pollEnd) + source.slice(controlStart, controlEnd), ctx);
  const choose = line => { select.value = line; events.change(); };
  const settle = async (at, rows = []) => {
    requests[at].resolve({ ok:true, json:async () => ({ realtimePositionList:rows }) });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { ctx, choose, settle, requests, fitted, intervals, frames, ingested };
}

test("노선 선택 즉시 표시·조회, 일부가 보이면 유지, 전체 보기는 강제 이동", async () => {
  const c = controls();
  c.choose("가노선");
  assert.equal(c.ctx.subwayOn, true);
  assert.equal(c.ctx.drawn, "가노선");
  assert.equal(c.ctx.subwayRouteLayer.present, true);
  assert.equal(c.ctx.subwayLayer.present, true);
  assert.equal(c.requests.length, 1);
  assert.equal(c.fitted.length, 0);
  c.ctx.subwayViewAll();
  assert.equal(c.fitted.length, 1);
  assert.equal(c.fitted[0].points.length, 2);
  await c.settle(0);
  assert.equal(c.ctx.subwayLineSelect.value, "가노선");
  assert.equal(c.ctx.subwayOn, true);
  assert.match(c.ctx.status, /운행 중인 열차가 없어요/);
});

test("화면 밖 노선 선택 시 자동 이동, 숨기면 표시·타이머·조회·도착 패널 모두 정리", async () => {
  const c = controls();
  c.choose("나노선");
  assert.equal(c.fitted.length, 1);
  assert.equal(c.fitted[0].options.maxZoom, 14);
  assert.equal(c.intervals.size, 1);
  assert.equal(c.frames.size, 1);
  c.choose("");
  assert.equal(c.ctx.subwayOn, false);
  assert.equal(c.ctx.selected, "");
  assert.equal(c.ctx.subwayRouteLayer.present, false);
  assert.equal(c.ctx.subwayLayer.present, false);
  assert.equal(c.ctx.arrivalClosed, true);
  assert.equal(c.intervals.size, 0);
  assert.equal(c.frames.size, 0);
  await c.settle(0, [{ trainNo:"old" }]);
  assert.equal(c.ingested.length, 0);
  assert.equal(c.ctx.status, "");
});

test("조회 도중 노선 변경 시 즉시 새 노선 조회, 늦게 온 이전 응답·오류는 무시", async () => {
  const c = controls();
  c.choose("가노선");
  c.choose("나노선");
  assert.equal(c.requests.length, 2);
  assert.equal(c.intervals.size, 1);
  await c.settle(0, [{ trainNo:"old" }]);
  assert.equal(c.ingested.length, 0);
  assert.equal(c.ctx.subwayFetching, true);
  await c.settle(1, [{ trainNo:"new" }]);
  assert.equal(c.ingested[0].line, "나노선");
  c.choose("가노선");
  c.choose("나노선");
  c.requests[2].reject(new Error("subway-key-required"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.ctx.subwayOn, true);
  assert.equal(c.ctx.subwayLineSelect.value, "나노선");
  assert.equal(c.ctx.subwayFetching, true);
  await c.settle(3);
});

test("인증키가 없으면 선택을 해제하고 조회를 중지", async () => {
  const c = controls();
  c.choose("가노선");
  c.requests[0].resolve({ ok:false, text:async () => "subway-key-required" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.ctx.subwayOn, false);
  assert.equal(c.ctx.selected, "");
  assert.equal(c.intervals.size, 0);
  assert.equal(c.frames.size, 0);
  assert.match(c.ctx.status, /인증키/);
});
