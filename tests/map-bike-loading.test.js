"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
function api(document = {}){
  const context = { document, window:{}, L:{ DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} } } };
  vm.createContext(context);
  vm.runInContext(source + ";globalThis.api = { mapBikeLayerController, mapBikeLoadLabel, mapBikeStatusPanel };", context);
  return context.api;
}
class TileLayer extends EventEmitter {
  constructor(id){ super(); this.id = id; this.loading = false; this.redraws = 0; }
  addTo(map){ map.layers.add(this); this.fire("loading"); }
  isLoading(){ return this.loading; }
  fire(name){ if (name === "loading") this.loading = true; if (name === "load") this.loading = false; this.emit(name); }
  redraw(){ this.redraws++; this.fire("loading"); }
}
function fixture(){
  const map = { layers:new Set(), removed:[], removeLayer(layer){ this.layers.delete(layer); this.removed.push(layer); } };
  const made = [], updates = [];
  const controller = api().mapBikeLayerController(map, states => updates.push(states), id => {
    const layer = new TileLayer(id); made.push(layer); return layer;
  });
  const sync = (lanes, routes, zoom = 19, proxy = "proxy", basemap = "osm") =>
    controller.sync({ bikeLanes:lanes, bikeRoutes:routes, basemap }, zoom, proxy, "mapBikePane");
  return { map, made, updates, controller, sync };
}

test("도로 → 도로+노선 → 노선에서 계속 켜진 층과 타일은 유지한다", () => {
  const f = fixture();
  f.sync(true, false);
  const lanes = f.made[0];
  lanes.fire("tileload"); lanes.fire("load");
  f.sync(true, true);
  const routes = f.made[1];
  assert.equal(f.made.length, 2);
  assert.ok(f.map.layers.has(lanes));
  assert.equal(f.map.removed.length, 0);
  f.sync(false, true);
  assert.deepEqual(f.map.removed, [lanes]);
  assert.ok(f.map.layers.has(routes));
  f.sync(false, true);
  assert.equal(f.made.length, 2);
});

test("확대 상한·프록시가 바뀌면 교체하고 사용자 이미지·문서 닫기에서는 이벤트까지 정리한다", () => {
  const f = fixture();
  f.sync(true, true);
  f.sync(true, true, 17);
  assert.equal(f.made.length, 4);
  f.sync(true, true, 17, "");
  assert.equal(f.made.length, 6);
  f.sync(true, true, 17, "", "custom");
  assert.equal(f.map.layers.size, 0);
  assert.ok(f.made.every(layer => layer.eventNames().length === 0));
  f.sync(true, true);
  f.controller.destroy();
  const count = f.updates.length;
  for (const layer of f.made) layer.fire("tileerror");
  assert.equal(f.updates.length, count);
  assert.equal(f.map.layers.size, 0);
});

test("층별 로딩·부분 실패를 추적하고 재시도는 해당 층에만 적용한다", () => {
  const f = fixture(), labels = api();
  f.sync(true, true);
  const [lanes, routes] = f.made;
  assert.equal(f.controller.isLoading(), true);
  lanes.fire("tileload"); lanes.fire("tileerror"); lanes.fire("load");
  const laneState = f.updates.at(-1).find(item => item.id === "lanes");
  assert.equal(labels.mapBikeLoadLabel(laneState), "일부 타일을 불러오지 못했어요");
  routes.fire("tileerror"); routes.fire("load");
  assert.equal(f.controller.isLoading(), false);
  assert.equal(labels.mapBikeLoadLabel(f.updates.at(-1)[1]), "타일을 불러오지 못했어요");
  f.controller.retry("lanes");
  assert.equal(lanes.redraws, 1);
  assert.equal(routes.redraws, 0);
  assert.equal(labels.mapBikeLoadLabel(f.updates.at(-1)[0]), "불러오는 중…");
  f.controller.retry("lanes");
  assert.equal(lanes.redraws, 1, "불러오는 동안 재시도 요청을 겹치지 않는다");
  lanes.fire("tileload"); lanes.fire("load");
  assert.equal(labels.mapBikeLoadLabel(f.updates.at(-1)[0]), "불러오기 완료");
  assert.equal(f.updates.at(-1)[0].failed, 0);
});

class Element {
  constructor(tag){
    this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; this.classes = new Set();
    this.classList = { toggle:(name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  }
  append(...nodes){ this.children.push(...nodes); }
  appendChild(node){ this.append(node); }
  setAttribute(key, value){ this.attributes[key] = value; }
  addEventListener(event, handler){ this.events[event] = handler; }
  remove(){ this.removed = true; }
}
test("상태창은 활성 층만 보여 주며 실패한 층의 재시도와 접근성 문구를 제공한다", () => {
  const doc = { createElement:tag => new Element(tag) };
  const stage = new Element("div"), retries = [];
  const panel = api(doc).mapBikeStatusPanel(stage, id => retries.push(id));
  const box = stage.children[0], [laneRow, routeRow] = box.children;
  panel.update([{ id:"lanes", loading:true, loaded:0, failed:0 }]);
  assert.equal(box.hidden, false);
  assert.equal(laneRow.hidden, false);
  assert.equal(routeRow.hidden, true);
  assert.equal(laneRow.children[1].textContent, "불러오는 중…");
  assert.equal(laneRow.children[1].attributes["aria-live"], "polite");
  assert.equal(laneRow.children[2].hidden, true);
  panel.update([{ id:"lanes", loading:false, loaded:1, failed:1 }]);
  assert.equal(laneRow.children[2].hidden, false);
  laneRow.children[2].events.click();
  assert.deepEqual(retries, ["lanes"]);
  panel.update([]);
  assert.equal(box.hidden, true);
  panel.destroy();
  assert.equal(box.removed, true);
  assert.match(source, /MAP_CAPTURE_HIDDEN_PANES[^\n]*"\.map-bike-status"/);
});
