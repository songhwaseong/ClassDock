"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");

// 실제 브라우저 없이 저장한 원의 측정값과 Leaflet 이름표 갱신을 확인한다.
class Element {
  constructor(){ this.children = []; this.events = {}; this.attributes = {}; }
  append(...nodes){ this.children.push(...nodes); }
  setAttribute(name, value){ this.attributes[name] = value; }
  addEventListener(name, fn){ this.events[name] = fn; }
  set textContent(value){ this.text = value; this.children = []; }
  get textContent(){ return this.text ?? this.children.map(child => child.textContent).join(""); }
}
function load(){
  const context = vm.createContext({
    window:{}, document:{ createElement:() => new Element() },
    location:{ protocol:"file:" }, navigator:{ onLine:true }, setTimeout, clearTimeout
  });
  vm.runInContext(source, context);
  const api = vm.runInContext("({mapNearbyCircleInfo,mapNearbyCircleTip,mapCirclePoints,mapNormalizeShape,mapDocEmpty,mapDocSerialize,mapDocParse})", context);
  const circle = (radius = 1000, label = "주변 시설 1.00 km", lat = 37.5) => api.mapNormalizeShape({
    type:"area", source:"nearby", label, color:"#2563eb", points:api.mapCirclePoints(lat, 127, radius)
  });
  return { api, context, circle };
}
function title(tip){ return tip.children[0].children[1]; }
function metrics(tip){ return tip.children[1].children.map(metric => metric.children.map(node => node.textContent)); }

test("주변 시설 원은 위도와 거리 단위에 맞는 반경·면적을 두 줄로 보여 준다", () => {
  const { api, circle } = load();
  for (const lat of [-33.9, 0, 37.5, 80]){
    for (const [radius, distance] of [[500, "500 m"], [1000, "1.00 km"], [3000, "3.00 km"]]){
      const shape = circle(radius, "주변 시설 " + distance, lat);
      const info = api.mapNearbyCircleInfo(shape);
      assert.equal(info.title, "주변 시설");
      assert.equal(info.radius, distance);
      if (radius === 1000) assert.equal(info.area, "3.14 km²");
      if (radius === 500) assert.match(info.area, /m²$/);
      const tip = api.mapNearbyCircleTip(shape);
      assert.equal(title(tip).textContent, "주변 시설");
      assert.deepEqual(metrics(tip), [["반경", distance], ["면적", info.area]]);
    }
  }
});

test("옛 지도 파일도 새 정보 이름표로 열리고 이름을 고쳐도 측정값은 유지한다", () => {
  const { api, circle } = load();
  const model = api.mapDocEmpty("생활권"); model.shapes.push(circle(1000, "학교 1.00 km"));
  const oldFile = JSON.parse(api.mapDocSerialize(model)); oldFile.version = 14;
  const restoredModel = api.mapDocParse(JSON.stringify(oldFile));
  const serialized = api.mapDocSerialize(restoredModel);
  const restored = restoredModel.shapes[0];
  assert.equal(title(api.mapNearbyCircleTip(restored)).textContent, "학교");
  assert.equal(api.mapDocSerialize(restoredModel), serialized, "이름표 생성은 저장 내용에 영향을 주지 않는다");
  for (const [label, expected] of [["학교 주변", "학교 주변"], ["통학로 2 km", "통학로 2 km"], ["", "주변 시설"]]){
    restored.label = label;
    const tip = api.mapNearbyCircleTip(restored);
    assert.equal(title(tip).textContent, expected);
    assert.deepEqual(metrics(tip), [["반경", "1.00 km"], ["면적", "3.14 km²"]]);
  }
});

test("시설 이름은 HTML로 해석하지 않고 직접 그린 도형에는 주변 시설 정보를 붙이지 않는다", () => {
  const { api, circle } = load();
  const name = '<img src=x onerror="alert(1)">';
  const shape = circle(1000, name + " 1.00 km");
  const tip = api.mapNearbyCircleTip(shape);
  assert.equal(title(tip).textContent, name);
  assert.equal(title(tip).innerHTML, undefined);
  assert.equal(tip.children[0].children[0].attributes["aria-hidden"], "true");
  for (const invalid of [null, { ...shape, type:"line" }, { ...shape, source:"" }, { ...shape, points:[] }]){
    assert.equal(api.mapNearbyCircleTip(invalid), null);
  }
});

test("반경·면적과 기본 이름은 현재 언어로 표시한다", () => {
  const { api, context, circle } = load();
  const translations = { "주변 시설":"Nearby places", "반경":"Radius", "면적":"Area" };
  context.window.t = text => translations[text] || text;
  const tip = api.mapNearbyCircleTip(circle());
  assert.equal(title(tip).textContent, "Nearby places");
  assert.deepEqual(metrics(tip), [["Radius", "1.00 km"], ["Area", "3.14 km²"]]);
});

test("새 원·저장한 원·이름 편집에 같은 카드가 적용되고 이미지 내보내기는 문자열을 유지한다", () => {
  const { api, context, circle } = load();
  const nearby = circle(), manual = api.mapNormalizeShape({
    type:"area", points:api.mapCirclePoints(37.5, 127, 1000), label:"직접 그린 영역"
  });
  const layers = [], model = { shapes:[nearby, manual], markers:[] };
  const layer = points => {
    const entry = {
      points, events:{}, bindTooltip(content, options){ this.tooltip = content; this.tooltipOptions = options; },
      bindPopup(content){ this.popup = content; }, on(name, fn){ this.events[name] = fn; },
      addTo(){ this.added = true; }, openTooltip(anchor){ assert.ok(this.added); this.anchor = anchor; },
      setTooltipContent(content){ this.tooltip = content; }
    };
    layers.push(entry); return entry;
  };
  let changes = 0;
  Object.assign(context, { model, map:{}, L:{ polygon:layer, polyline:layer },
    setStatus(){}, touch(){ changes++; }
  });
  const start = source.indexOf("  const shapeLayers = new Map();");
  const end = source.indexOf("  model.shapes.forEach(addShapeLayer);", start) + "  model.shapes.forEach(addShapeLayer);".length;
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end) + "\n globalThis.shapeTest = {addShapeLayer,shapeTooltip};", context);
  const [nearbyLayer, manualLayer] = layers;
  assert.equal(nearbyLayer.tooltipOptions.direction, "top");
  assert.match(nearbyLayer.tooltipOptions.className, /map-nearby-circle-label/);
  assert.equal(nearbyLayer.tooltipOptions.opacity, 1);
  assert.ok(nearbyLayer.anchor[0] > 37.5, "시설이 모인 중심보다 위쪽에 둔다");
  assert.equal(manualLayer.tooltipOptions.direction, "center");
  assert.equal(typeof manualLayer.tooltip, "string");
  const input = nearbyLayer.popup.children[0];
  input.value = "답사 구역"; input.events.input();
  assert.equal(title(nearbyLayer.tooltip).textContent, "답사 구역");
  assert.deepEqual(metrics(nearbyLayer.tooltip), [["반경", "1.00 km"], ["면적", "3.14 km²"]]);
  assert.equal(changes, 1);
  assert.equal(context.shapeTest.shapeTooltip(nearby), "답사 구역 · 3.14 km²");
  const added = circle(500, "카페 500 m"); context.shapeTest.addShapeLayer(added);
  assert.equal(title(layers[2].tooltip).textContent, "카페");
  assert.equal(metrics(layers[2].tooltip)[0][1], "500 m");
});
