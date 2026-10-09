"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

// 브라우저를 실행하지 않고 실제 묶음 계산과 이벤트 처리 코드를 검증한다.
class Element {
  constructor(){
    this.children = []; this.events = {}; this.attributes = {}; this.style = {};
    this.classes = new Set();
    this.classList = { toggle:(name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  }
  append(...nodes){ this.children.push(...nodes); }
  appendChild(node){ this.append(node); return node; }
  setAttribute(name, value){ this.attributes[name] = value; }
  addEventListener(name, fn){ this.events[name] = fn; }
  fire(name){ return this.events[name](); }
}

function load(saved){
  const storage = new Map(saved == null ? [] : [["mn.mapMarkerClusters", saved]]);
  const context = vm.createContext({
    console, window:{}, document:{ createElement:() => new Element() },
    location:{ protocol:"file:" }, navigator:{ onLine:true },
    setTimeout, clearTimeout,
    localStorage:{ getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value) }
  });
  vm.runInContext(source, context);
  const api = vm.runInContext("({mapClusterPixelGroups,mapClusterTip,mapClustersOn,mapRememberClusters,mapNormalizeMarker,mapDocEmpty,mapDocSerialize,mapDocContentKey})", context);
  return { context, api, storage };
}

function controller({ count = 20, zoom = 13, saved } = {}){
  const h = load(saved), { context, api } = h;
  const model = api.mapDocEmpty("표시 묶음");
  model.markers = Array.from({ length:count }, (_, i) => api.mapNormalizeMarker({
    id:"pin-" + i, lat:37.5, lng:127, label:"장소 " + (i + 1), source:i < 20 ? "" : "nearby"
  }));
  const layers = new Set(), markerLayers = new Map(), handlers = {};
  const latLng = ([lat, lng]) => ({ lat, lng, equals(other){ return lat === other.lat && lng === other.lng; } });
  const clusterLayer = {
    items:[], addTo(){ return this; }, clearLayers(){ this.items = []; }, addLayer(layer){ this.items.push(layer); }
  };
  const map = {
    zoom, offset:[0, 0], lastView:null, lastBounds:null,
    getZoom(){ return this.zoom; }, hasLayer:layer => layers.has(layer),
    removeLayer:layer => layers.delete(layer),
    latLngToContainerPoint:([lat, lng]) => ({ x:lng * 100 + map.offset[0], y:lat * 100 + map.offset[1] }),
    on(names, fn){ for (const name of names.split(" ")) handlers[name] = fn; },
    setView(center, nextZoom){ this.lastView = plain(center); this.zoom = nextZoom; handlers.zoomend(); handlers.moveend(); },
    fitBounds(bounds, options){ this.lastBounds = { points:bounds.points, padding:bounds.padding, options }; this.zoom = options.maxZoom; handlers.zoomend(); }
  };
  const markerLayer = () => ({
    element:new Element(), addTo(){ layers.add(this); return this; }, getElement(){ return this.element; }
  });
  const add = marker => { const layer = markerLayer().addTo(map); markerLayers.set(marker.id, layer); };
  model.markers.forEach(add);
  const button = new Element();
  Object.assign(context, {
    model, map, markerLayers, clusterBtn:button, taskMode:false,
    L:{
      layerGroup:() => clusterLayer, divIcon:options => options,
      marker:(center, options) => ({
        center:plain(center), options, handlers:{}, on(name, fn){ this.handlers[name] = fn; return this; },
        bindTooltip(content, options){ this.tooltip = content; this.tooltipOptions = options; return this; }
      }),
      latLngBounds(points){
        return {
          points:plain(points), padding:0,
          getNorthEast:() => latLng([Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]),
          getSouthWest:() => latLng([Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))]),
          pad(value){ this.padding = value; return this; }
        };
      }
    },
    redrawClusters(){}, syncRadius(){}, redrawRoute(){}, scheduleDrive(){}, scheduleChoropleth(){},
    recordSoon(){}, scheduleRecovery(){}, scheduleListRefresh(){}, setStatus(){},
    doc:{ savedContentKey:api.mapDocContentKey(model) }
  });
  const start = source.indexOf("  const MAP_LIST_MAX_ROWS = 300;");
  const end = source.indexOf("  /* ── 표시 잇는 선 ──", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end) + "\n globalThis.clusters = {redrawClusters,applyMarkerVisibility,hiddenSources,radiusMatches,radiusAMatches};", context);
  const touch = /const touch = \(\) => \{[\s\S]*?\n  \};/.exec(source);
  vm.runInContext(touch[0] + "\n globalThis.touchMarkers = touch;", context);
  return { ...h, model, map, button, markerLayers, layers, clusterLayer, handlers, add, controls:context.clusters };
}

test("묶음은 격자 경계 양쪽의 가까운 표시를 함께 세고 먼 대각선 표시는 나눈다", () => {
  const { api } = load();
  const close = [{ id:"a", x:71, y:71 }, { id:"b", x:73, y:73 }];
  assert.deepEqual(plain(api.mapClusterPixelGroups(close, 72)).map(group => group.map(item => item.id)), [["a", "b"]]);
  const diagonal = [{ id:"a", x:1, y:1 }, { id:"b", x:70, y:70 }];
  assert.deepEqual(plain(api.mapClusterPixelGroups(diagonal, 72)).map(group => group.length), [1, 1]);
});

test("지도를 평행 이동해도 묶음이 바뀌지 않고 표시를 중복하거나 잃지 않는다", () => {
  const { api } = load();
  const items = [{ id:"a", x:71, y:70 }, { id:"b", x:73, y:72 }, { id:"c", x:210, y:-1 }, { id:"d", x:212, y:1 }];
  const grouped = points => plain(api.mapClusterPixelGroups(points, 72)).map(group => group.map(item => item.id));
  const expected = [["a", "b"], ["c", "d"]];
  for (const [dx, dy] of [[0, 0], [2, 2], [-250, -500], [721.25, 144.5]]){
    assert.deepEqual(grouped(items.map(item => ({ ...item, x:item.x + dx, y:item.y + dy }))), expected);
  }
  const before = plain(items);
  const groups = api.mapClusterPixelGroups(items, 72);
  assert.equal(new Set(groups.flat()).size, items.length);
  assert.equal(groups.flat().length, items.length);
  assert.deepEqual(items, before);
  // 같은 거리의 두 묶음 사이에서도 지도를 옮겼다는 이유로 다른 묶음에 들어가면 안 된다.
  const tied = [{ id:"first", x:0, y:0 }, { id:"second", x:100, y:0 }, { id:"middle", x:50, y:0 }];
  for (const dx of [0, 30, 70, -100]){
    assert.deepEqual(grouped(tied.map(item => ({ ...item, x:item.x + dx }))), [["first", "middle"], ["second"]]);
  }
});

test("긴 표시 사슬을 한 묶음으로 합치지 않고 CSV 상한 5천 개도 빠짐없이 센다", () => {
  const { api } = load();
  const chain = Array.from({ length:20 }, (_, i) => ({ x:i * 60, y:0 }));
  for (const group of api.mapClusterPixelGroups(chain, 72)){
    assert.ok(Math.max(...group.map(item => item.x)) - Math.min(...group.map(item => item.x)) <= 144);
  }
  const dense = Array.from({ length:5000 }, (_, id) => ({ id, x:71 + id % 3, y:71 + id % 2 }));
  const groups = api.mapClusterPixelGroups(dense, 72);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 5000);
  assert.equal(new Set(groups.flat()).size, 5000);
});

test("표시 20개·확대 13 경계와 켜기·끄기를 적용하고 보기 설정만 기억한다", () => {
  const nineteen = controller({ count:19 });
  assert.equal(nineteen.clusterLayer.items.length, 0);
  assert.equal(nineteen.layers.size, 19);
  const h = controller();
  const before = h.api.mapDocSerialize(h.model);
  assert.equal(h.clusterLayer.items.length, 1);
  assert.equal(h.layers.size, 0);
  assert.match(h.clusterLayer.items[0].options.icon.html, />20</);
  h.map.zoom = 14; h.handlers.zoomend();
  assert.equal(h.clusterLayer.items.length, 0);
  assert.equal(h.layers.size, 20);
  h.map.zoom = 13; h.handlers.zoomend();
  assert.equal(h.clusterLayer.items.length, 1);
  h.button.fire("click");
  assert.equal(h.button.attributes["aria-pressed"], "false");
  assert.equal(h.storage.get("mn.mapMarkerClusters"), "0");
  assert.equal(h.layers.size, 20);
  assert.equal(h.clusterLayer.items.length, 0);
  h.button.fire("click");
  assert.equal(h.button.attributes["aria-pressed"], "true");
  assert.equal(h.storage.get("mn.mapMarkerClusters"), "1");
  assert.equal(h.api.mapDocSerialize(h.model), before);
  const off = controller({ saved:"0" });
  assert.equal(off.clusterLayer.items.length, 0);
  assert.equal(off.layers.size, 20);
});

test("감춘 갈래를 묶음 개수에서 빼고 반경을 지우면 묶음과 개별 강조를 복구한다", () => {
  const h = controller({ count:30 });
  assert.match(h.clusterLayer.items[0].options.icon.html, />30</);
  h.controls.hiddenSources.add("nearby"); h.controls.applyMarkerVisibility();
  assert.match(h.clusterLayer.items[0].options.icon.html, />20</);
  h.model.radius = { center:[37.5, 127], meters:1000 };
  h.controls.radiusMatches.add("pin-0"); h.controls.radiusAMatches.add("pin-1");
  h.controls.redrawClusters();
  assert.equal(h.clusterLayer.items.length, 0);
  assert.equal(h.layers.size, 20);
  assert.equal(h.markerLayers.get("pin-0").element.classes.has("map-radius-match"), true);
  assert.equal(h.markerLayers.get("pin-1").element.classes.has("map-radius-a-match"), true);
  assert.equal(h.layers.has(h.markerLayers.get("pin-20")), false);
  h.model.radius = null; h.controls.redrawClusters();
  assert.equal(h.clusterLayer.items.length, 1);
  assert.equal(h.layers.size, 0);
  h.controls.hiddenSources.delete("nearby"); h.controls.redrawClusters();
  assert.match(h.clusterLayer.items[0].options.icon.html, />30</);
  h.model.radius = { center:[37.5, 127], meters:1000 }; h.model.basemap = "custom";
  h.controls.redrawClusters();
  assert.equal(h.clusterLayer.items.length, 1, "이미지 배경에서 비활성화된 반경은 묶기를 막지 않는다");
});

test("표시 추가·이동·삭제는 실제 touch 경로에서 묶음과 개별 표시를 다시 계산한다", () => {
  const h = controller();
  h.model.markers[0].lng = 130; h.context.touchMarkers();
  assert.match(h.clusterLayer.items[0].options.icon.html, />19</);
  assert.equal(h.layers.has(h.markerLayers.get("pin-0")), true);
  const removed = h.model.markers.pop();
  h.layers.delete(h.markerLayers.get(removed.id)); h.markerLayers.delete(removed.id);
  h.context.touchMarkers();
  assert.equal(h.clusterLayer.items.length, 0);
  assert.equal(h.layers.size, 19);
  const marker = h.api.mapNormalizeMarker({ id:"new", lat:37.5, lng:127 });
  h.model.markers.push(marker); h.add(marker); h.context.touchMarkers();
  assert.match(h.clusterLayer.items[0].options.icon.html, />19</);
  assert.equal(h.layers.size, 1);
});

test("묶음 클릭은 구성 표시의 범위로 확대하고 같은 좌표도 한 번에 개별 표시로 펼친다", () => {
  const h = controller({ zoom:5 });
  h.clusterLayer.items[0].handlers.click();
  assert.ok(h.map.getZoom() > 13, "같은 좌표의 묶음이 여러 번 눌러야 풀리지 않아야 한다");
  assert.equal(h.clusterLayer.items.length, 0);
  assert.equal(h.layers.size, 20);
  const spread = controller();
  spread.model.markers[0].lng += 0.01; spread.controls.redrawClusters();
  spread.clusterLayer.items[0].handlers.click();
  assert.equal(spread.map.lastBounds.points.length, 20);
  assert.equal(spread.map.lastBounds.padding, 0.2);
  assert.equal(spread.map.lastBounds.options.maxZoom, 15);
  assert.equal(spread.layers.size, 20);
});

test("묶음 이름표는 이름 있는 표시 셋·색·나머지 개수를 안전한 텍스트로 만든다", () => {
  const { api } = load();
  const markers = [
    { label:"", color:"slate" }, { label:"학교", color:"blue" },
    { label:"<img src=x>", color:"red" }, { label:"도서관", color:"green" }, { label:"공원", color:"amber" }
  ];
  const tip = api.mapClusterTip(markers);
  const [head, list] = tip.children;
  assert.equal(head.children[0].textContent, "표시 5개");
  assert.equal(head.children[1].textContent, "눌러서 펼치기 ›");
  assert.deepEqual(list.children.slice(0, 3).map(row => row.children[1].textContent), ["학교", "<img src=x>", "도서관"]);
  assert.equal(list.children[0].children[0].style.background, "#2563eb");
  assert.equal(list.children[3].textContent, "외 2곳");
  const unnamed = api.mapClusterTip([{ label:" ", color:"blue" }, { label:"", color:"red" }]);
  assert.equal(unnamed.children[1].children.length, 2);
  assert.equal(unnamed.children[1].children[0].children[1].textContent, "이름 없는 표시");
});
