"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const days = require("../src/js/market-days.js");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
// 2026-10-04 실제 응답에서 갈래마다 한 줄씩 뽑은 것(전체 1,393곳 · 두 쪽째 뒤는 03).
const sample = JSON.parse(read("tests/fixtures/market-days-20261004.json"));
const nodata = JSON.parse(read("tests/fixtures/market-days-nodata-20261004.json"));

test("시장개설주기 글을 날짜 끝자리로 푼다", () => {
  assert.deepEqual(days.cycleDigits("4일+9일"), [4, 9]);
  assert.deepEqual(days.cycleDigits("5일+10일"), [5, 0]);
  assert.deepEqual(days.cycleDigits("2일+4일+7일+9일"), [2, 4, 7, 9]);
  assert.deepEqual(days.cycleDigits("2일+5일"), [2, 5]);
  assert.deepEqual(days.cycleDigits("매일"), []);
  assert.deepEqual(days.cycleDigits(""), []);
  assert.equal(days.cycleLabel([5, 0]), "5·10일");
  assert.equal(days.cycleLabel([2, 7], true), "Days 2·7");
  assert.equal(days.cycleLabel([5, 0], true), "Days 5·10");
});

test("장날은 끝자리로 가리고 31일은 1·6일장에 든다", () => {
  const twoSeven = [2, 7], fiveTen = [5, 0], oneSix = [1, 6];
  assert.deepEqual([...Array(31)].map((_, i) => i + 1).filter(d => days.isMarketDay(twoSeven, d)), [2, 7, 12, 17, 22, 27]);
  assert.deepEqual([...Array(31)].map((_, i) => i + 1).filter(d => days.isMarketDay(fiveTen, d)), [5, 10, 15, 20, 25, 30]);
  assert.ok(days.isMarketDay(oneSix, 31));
  assert.equal(days.nextMarketDay(twoSeven, "2026-10-04"), "2026-10-07");
  assert.equal(days.nextMarketDay(oneSix, "2026-10-31"), "2026-10-31");
  assert.equal(days.nextMarketDay(fiveTen, "2026-10-31"), "2026-11-05");
  assert.equal(days.nextMarketDay([], "2026-10-04"), "");
  assert.equal(days.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(days.koreaToday(Date.UTC(2026, 9, 3, 15, 30)), "2026-10-04"); // 한국 시각 자정 넘음
});

test("실제 응답(껍질 없는 봉투)을 읽는다", () => {
  const { items, total } = days.rows(sample);
  assert.equal(total, 1393);
  assert.equal(items.length, 8);
  assert.deepEqual(days.rows(nodata), { items:[], total:0 });
  // 다른 공공 API 처럼 response 껍질이 있어도 읽는다.
  assert.equal(days.rows({ response:sample }).items.length, 8);
  assert.throws(() => days.rows({ header:{ resultCode:"30" } }), /market-invalid-data/);

  const list = days.parse([sample, nodata]);
  const byName = name => list.find(m => m.name === name);
  assert.deepEqual(byName("장호원전통시장").digits, [4, 9]);
  assert.equal(byName("장호원전통시장").type, "상설장+4일장");
  assert.deepEqual(byName("사기막골도자기시장").digits, []);
  assert.ok(byName("장호원전통시장").goods.startsWith("농산물, 축산물"));
  // 위치가 빈 곳은 좌표를 null 로 둔다(지도에 안 찍고 개수만 알린다).
  assert.equal(byName("안덕시장").lat, null);
  assert.ok(Math.abs(byName("말바우시장").lat - 35.1729756) < 1e-9);
});

test("홈페이지는 http(s) 로만 열고 빠진 머리는 붙인다", () => {
  assert.equal(days.siteUrl("www.sagimakgol.com"), "http://www.sagimakgol.com/");
  assert.equal(days.siteUrl("blog.naver.com/tongbokmk"), "http://blog.naver.com/tongbokmk");
  assert.equal(days.siteUrl("javascript:alert(1)"), "");
  assert.equal(days.siteUrl(""), "");
});

test("두 쪽을 이어 받고 모자람이 없으면 멈춘다", async () => {
  const asked = [];
  const page = (n, count, total) => ({ header:{ resultCode:"00" }, body:{ items:{ item:Array.from({ length:count }, (_, i) => ({ mrktNm:"시장" + n + "-" + i, mrktEstblCycle:"2일+7일" })) }, totalCount:total } });
  global.fetch = async url => {
    asked.push(url);
    const n = Number(/page=(\d)/.exec(url)[1]);
    return { ok:true, json:async () => n === 1 ? page(1, 1000, 1393) : page(2, 393, 1393) };
  };
  try {
    const list = await days.loadAll();
    assert.equal(list.length, 1393);
    assert.deepEqual(asked, ["/market-days?page=1", "/market-days?page=2"]);
  } finally { delete global.fetch; }
});

test("키 문제는 런처 까닭 그대로 알린다", async () => {
  global.fetch = async () => ({ ok:false, status:428, text:async () => "bus-key-invalid", headers:{ get:() => "" } });
  try { await assert.rejects(days.loadAll(), /bus-key-invalid/); }
  finally { delete global.fetch; }
  assert.match(days.failureText(new Error("bus-key-invalid")), /전국전통시장표준데이터/);
  assert.match(days.failureText(new Error("bus-key-required")), /인증키/);
});

test("런처·지도·도구 목록에 장날 층이 이어져 있다", () => {
  const launcher = read("desktop/launcher.cs");
  assert.match(launcher, /route == "\/market-days" \? "markets"/);
  assert.match(launcher, /if \(path\.StartsWith\("\/market-days\?", StringComparison\.Ordinal\)\) return true;/);
  assert.match(launcher, /tn_pubr_public_trdit_mrkt_api/);
  assert.match(launcher, /if \(kind == "markets"\) return System\.Text\.RegularExpressions\.Regex\.IsMatch\(value, "\^\[1-9\]\$"\)/);
  // 표준데이터 봉투엔 response 껍질이 없다 — 결과 코드 읽기가 뿌리의 header 도 본다.
  assert.match(launcher, /response == null && root != null && root\.ContainsKey\("header"\)/);
  assert.match(read("src/js/map-viewer.js"), /MNMarketDays\.mount\(/);
  assert.match(read("src/js/map-viewer.js"), /markets && markets\.captureNote\(\)/);
  assert.match(read("src/js/state.js"), /id:"mapMarket", label:"장날", cls:"map-toolvis-market", target:"map"/);
  assert.match(read("src/styles.css"), /html\.hide-tool-mapMarket \.map-toolvis-market/);
  assert.ok(read("classdock.html").includes('<script src="src/js/market-days.js"></script>'));
  const manifest = JSON.parse(read("scripts.manifest.json"));
  assert.ok(manifest.localScripts.includes("market-days.js"));
  assert.ok(manifest.scriptDependencies["map-viewer.js"].includes("market-days.js"));
});

// 가짜 DOM·지도로 단추 → 받기 → 점 찍기 → 날짜 바꾸기 → 지우기 → 치우기를 따라간다. 브라우저·화면 캡처는 쓰지 않는다.
function mountHarness(fetch){
  const nodes = [], listeners = new Map(), saved = new Map();
  let markers = [], popups = 0;
  function node(tag){
    const n = { tag, style:{}, children:[], events:{}, attributes:{}, hidden:false, disabled:false, value:"", checked:false, textContent:"",
      classList:{ add(){}, toggle(){} }, append(...items){ this.children.push(...items); }, setAttribute(k, v){ this.attributes[k] = v; },
      appendChild(item){ this.children.push(item); }, replaceChildren(...items){ this.children = items; }, addEventListener(k, fn){ this.events[k] = fn; }, focus(){}, remove(){ this.removed = true; } };
    nodes.push(n); return n;
  }
  const svgRenderer = { renderer:true }, removed = [];
  const layer = () => { const g = { items:[], onMap:false, addTo(){ this.onMap = true; return this; }, clearLayers(){ this.items = []; } }; return g; };
  const group = layer();
  const L = { DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} }, svg:options => { svgRenderer.options = options; return svgRenderer; }, layerGroup:() => group,
    circleMarker:(at, options) => { const m = { at, options, events:{}, bindTooltip(fn, o){ m.tip = fn; m.tipOptions = o; return m; }, bindPopup(fn){ m.popup = fn; return m; },
      on(k, fn){ m.events[k] = fn; return m; }, setStyle(o){ Object.assign(m.options, o); return m; },
      addTo(g){ g.items.push(m); markers = g.items; return m; }, openPopup(){ popups++; } }; return m; } };
  const map = { createPane:() => node("pane"), getZoom:() => 7, setView(){}, closePopup(){}, removeLayer(g){ g.onMap = false; removed.push(g); },
    getCenter:() => ({ lat:36.5, lng:127.5, distanceTo:([lat, lng]) => Math.hypot(lat - 36.5, lng - 127.5) * 111000 }),
    getBounds:() => ({ contains:([lat, lng]) => lat > 33 && lat < 39 && lng > 124 && lng < 132 }),
    on(name, fn){ listeners.set(name, fn); }, off(name){ listeners.delete(name); } };
  const now = Date.UTC(2026, 9, 4, 1); // 2026-10-04 10:00 KST
  const window = { addEventListener(){}, removeEventListener(){} };
  const context = { module:{ exports:{} }, URL, AbortController, setTimeout, clearTimeout, fetch, L, mapSetToolIcon(){},
    Date:class extends Date { constructor(...a){ super(...(a.length ? a : [now])); } static now(){ return now; } },
    document:{ createElement:node, createTextNode:t => ({ t }) }, window,
    localStorage:{ getItem:k => saved.get(k) || null, setItem:(k, v) => saved.set(k, v) } };
  vm.runInNewContext(read("src/js/market-days.js"), context);
  const doc = { cleanupFns:[] }, stage = node("stage"), toolRow = node("tools");
  const controller = context.module.exports.mount({ map, stage, toolRow, doc });
  const find = cls => nodes.find(n => (n.className || "").split(" ").includes(cls));
  return { svgRenderer, removed, setEnglish:on => { window.MNI18N = on ? { lang:"en" } : undefined; }, controller, find, group, doc, listeners, saved, markers:() => markers, popups:() => popups };
}
const vm = require("node:vm");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("장날 단추: 오늘 장 서는 곳만 찍고, 날짜·상설 보기를 따라 다시 그리며, 지우고 치운다", async () => {
  let calls = 0;
  const h = mountHarness(async url => {
    if (url === "/can-proxy-weather") return { ok:true, text:async () => "yes" };
    calls++; return { ok:true, json:async () => url.endsWith("page=1") ? sample : nodata };
  });
  await settle();
  const toggle = h.find("map-toolvis-market");
  assert.equal(toggle.disabled, false);
  toggle.events.click(); await settle(); await settle();
  assert.equal(calls, 1); // 8줄 < 1000 이라 한 쪽으로 끝
  assert.equal(h.find("map-market-date").value, "2026-10-04");
  // 브라우저 날짜 칸 대신 요일까지 쓴 글자 단추를 보인다.
  assert.equal(h.find("map-market-date-btn").textContent, "10월 4일(일)");
  // 10월 4일 = 끝자리 4: 장호원(4·9)·말바우(2·4·7·9). 안덕(4·9)은 위치가 없어 빠진다.
  assert.deepEqual(h.markers().map(m => m.options.fillColor), ["#e8590c", "#e8590c"]);
  assert.match(h.find("map-market-summary").textContent, /10월 4일\(일\) · 장 서는 곳 전국 3곳, 지금 화면 2곳 · 위치 없는 1곳/);
  assert.equal(h.find("map-market-list").children.length, 2);
  assert.ok(h.saved.has(days.CACHE_KEY));
  // 다음 날(5일): 통복(5·10)·삽교(2·5)
  h.find("map-market-next").events.click();
  assert.equal(h.find("map-market-date").value, "2026-10-05");
  assert.equal(h.find("map-market-date-btn").textContent, "10월 5일(월)");
  assert.equal(h.markers().length, 2);
  // 상설시장도 보기: 사기막골(매일)이 회색으로 더해진다.
  h.find("map-market-permanent").checked = true; h.find("map-market-permanent").events.change();
  assert.equal(h.markers().length, 3);
  assert.equal(h.markers()[0].options.fillColor, "#6b7f86"); // 상설이 아래에 깔린다
  // 점 말풍선 내용(다음 장 날짜 포함)
  h.find("map-market-today").events.click();
  const tongbok = h.markers().find(m => Math.abs(m.at[0] - 36.99782533) < 1e-6);
  assert.equal(tongbok, undefined); // 4일엔 통복이 없다
  const popup = h.markers().find(m => Math.abs(m.at[0] - 37.11809055) < 1e-6).popup();
  assert.equal(popup.children[0].textContent, "장호원전통시장");
  assert.ok(popup.children.some(row => row.children && row.children[1] && row.children[1].textContent === "4·9일 (상설시장 함께)"));
  // 간판형 이름표: 그림 · 이름 · 장날 주기. 가리키면 점이 커지고 떠나면 돌아온다.
  const jangho = h.markers().find(m => Math.abs(m.at[0] - 37.11809055) < 1e-6);
  assert.equal(jangho.tipOptions.className, "map-market-tip");
  assert.deepEqual(jangho.tip().children.map(c => c.textContent || ""), ["", "장호원전통시장", "4·9일장"]);
  jangho.events.mouseover(); assert.equal(jangho.options.radius, 10);
  jangho.events.mouseout(); assert.equal(jangho.options.radius, 7);
  const daily = h.markers().find(m => m.options.fillColor === "#6b7f86");
  assert.equal(daily.tipOptions.className, "map-market-tip is-permanent");
  assert.equal(daily.tip().children[2].textContent, "매일");
  // 영어 이름표는 짧게: "Days 4·9"
  h.setEnglish(true);
  assert.equal(jangho.tip().children[2].textContent, "Days 4·9");
  assert.equal(daily.tip().children[2].textContent, "Daily");
  // 말풍선 장날 줄은 머리가 'Market days' 라 값은 "4·9" 만.
  const enPopup = jangho.popup();
  assert.ok(enPopup.children.some(row => row.children && row.children[0] && row.children[0].textContent === "Market days"
    && row.children[1].textContent === "4·9 (also open daily)"));
  h.setEnglish(false);
  assert.match(h.controller.captureNote(), /장날 · 10월 4일/);
  // 켠 채로 단추를 다시 누르면 지우고 닫는다.
  toggle.events.click();
  assert.equal(h.group.onMap, false); assert.equal(h.find("map-market-panel").hidden, true); assert.equal(h.controller.captureNote(), "");
  // 끄면 지도 전체를 덮는 렌더러 바탕도 치워 아래 층(주변 교통 등)의 마우스를 막지 않는다.
  assert.equal(h.svgRenderer.options.pane, "mapMarketPane");
  assert.ok(h.removed.includes(h.svgRenderer));
  // 다시 켜면 브라우저에 담아 둔 목록을 쓴다.
  toggle.events.click(); await settle(); await settle();
  assert.equal(calls, 1);
  h.doc.cleanupFns[0]();
  assert.equal(h.listeners.size, 0); assert.ok(h.find("map-market-panel").removed);
});

test("늦게 온 응답은 지운 뒤에 찍지 않는다", async () => {
  let finish;
  const h = mountHarness(url => url === "/can-proxy-weather" ? Promise.resolve({ ok:true, text:async () => "yes" })
    : new Promise(resolve => { finish = resolve; }));
  await settle();
  const toggle = h.find("map-toolvis-market");
  toggle.events.click(); await settle();
  h.find("map-weather-heading").children[1].events.click(); // 닫기만 해서는 받기를 멈추지 않는다
  h.controller.destroy();
  finish({ ok:true, json:async () => sample }); await settle(); await settle();
  assert.equal(h.markers().length, 0);
});
