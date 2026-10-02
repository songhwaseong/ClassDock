"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const wind = require("../src/js/weather-wind.js");
const HOUR = 3600000, now = Date.UTC(2026, 9, 2, 3, 15);
const body = () => wind.coordinates().map((p, i) => ({ latitude:p.lat, longitude:p.lng, location_id:i,
  hourly_units:{ time:"unixtime", wind_speed_10m:"m/s", wind_direction_10m:"°", temperature_2m:"°C", pressure_msl:"hPa" },
  hourly:{ time:Array.from({ length:25 }, (_, i) => Math.floor(now / HOUR) * 3600 + i * 3600),
    wind_speed_10m:Array.from({ length:25 }, (_, i) => 10 + i / 10), wind_direction_10m:Array(25).fill(270),
    temperature_2m:Array.from({ length:25 }, (_, i) => 20 + i / 2), pressure_msl:Array.from({ length:25 }, (_, i) => 1000 + i) } }));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("wind direction follows meteorological convention, including wraparound and calm", () => {
  near(wind.vector(10, 0).v, -10); near(wind.vector(10, 90).u, -10);
  near(wind.vector(10, 180).v, 10); near(wind.vector(10, 270).u, 10);
  near(wind.vector(10, 360).v, -10); near(wind.vector(0, 180).u, 0);
  for (const value of [null, undefined, "10", -1, NaN, Infinity]) assert.equal(wind.vector(value, 90), null);
  assert.equal(wind.vector(10, null), null);
});

test("fixed request covers 195 points at 1°, uses m/s and nearest cells including the sea, without credentials", () => {
  const url = new URL(wind.requestUrl()), q = url.searchParams;
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(q.get("latitude").split(",").length, 195); assert.equal(q.get("longitude").split(",").length, 195);
  assert.equal(wind.REGION.step, 1); // 세계 범위(1°)보다 거칠지 않다.
  assert.equal(q.get("cell_selection"), "nearest"); assert.equal(q.get("wind_speed_unit"), "ms");
  assert.equal(q.get("forecast_hours"), "25"); assert.equal(q.has("apikey"), false);
  assert.equal(q.get("temperature_unit"), "celsius"); assert.match(q.get("hourly"), /temperature_2m/); assert.match(q.get("hourly"), /pressure_msl/);
  assert.deepEqual(wind.coordinates()[0], { lat:30, lng:122 });
  assert.deepEqual(wind.coordinates()[194], { lat:44, lng:134 });
  // 함경북도 북단(온성 약 43.0°N)·마라도(33.1°N)·독도(131.9°E)·백령도(124.7°E)가 범위 안이다.
  const grid = wind.parse(body(), now).frames[0];
  for (const [lat, lng] of [[43.01, 129.99], [33.11, 126.27], [37.24, 131.87], [37.97, 124.71]]) assert.ok(wind.sample(grid, lat, lng));
});

test("parser maps location IDs even when reordered and rejects mismatched units, times and coordinates", () => {
  const grid = wind.parse(body().reverse(), now); near(grid.frames[0].values[0].u, 10);
  for (const mutate of [
    b => b.pop(), b => { b[1].location_id = 0; }, b => { b[0].latitude = 0; },
    b => { b[0].hourly_units.wind_speed_10m = "km/h"; }, b => { b[1].hourly.time[0] += 3600; },
    b => { b[0].hourly_units.temperature_2m = "°F"; }, b => { b[0].hourly.temperature_2m.pop(); },
    b => { b[0].hourly_units.pressure_msl = "Pa"; }, b => { b[0].hourly.pressure_msl.pop(); },
    b => { for (const p of b) p.hourly.time[0] -= 10800; },
    b => { for (const p of b) p.hourly.wind_speed_10m[0] = null; }
  ]){ const b = body(); mutate(b); assert.throws(() => wind.parse(b, now)); }
});

test("vector interpolation handles 359/1 degrees, boundary cells and missing values", () => {
  const b = body(); b.forEach((p, i) => { p.hourly.wind_direction_10m[0] = i % 2 ? 1 : 359; });
  const grid = wind.parse(b, now).frames[0], middle = wind.sample(grid, 30.5, 122.5);
  near(middle.u, 0); assert.ok(middle.v < -9.9);
  for (const p of [{ lat:30, lng:122 }, { lat:44, lng:134 }]) assert.ok(wind.sample(grid, p.lat, p.lng));
  assert.equal(wind.sample(grid, 29.99, 125), null); assert.equal(wind.sample(grid, 36, 135), null);
  assert.equal(wind.sample(grid, 44.01, 128), null);
  grid.values[0] = null; assert.equal(wind.sample(grid, 30.5, 122.5).speed, null);
  assert.ok(wind.sample(grid, 40, 130));
});

test("cache expires, rejects damaged values, and color scale clamps high winds", () => {
  const grid = wind.parse(body(), now);
  assert.ok(wind.fresh(grid, now)); assert.equal(wind.fresh(grid, now + HOUR), false);
  assert.ok(wind.validCache(grid, now + 2 * HOUR)); assert.equal(wind.validCache(grid, now + 24 * HOUR), false);
  grid.frames[0].values[0] = { u:Infinity, v:0, temp:20 }; assert.equal(wind.validCache(grid, now), false);
  assert.deepEqual(wind.color(0), [56, 120, 220]); assert.deepEqual(wind.color(30), wind.color(100));
});

function runtime(overrides = {}){
  const saved = new Map();
  const context = { module:{ exports:{} }, URLSearchParams, AbortController, setTimeout, clearTimeout,
    Date:class extends Date { static now(){ return now; } },
    localStorage:{ getItem:k => saved.get(k) || null, setItem:(k, v) => saved.set(k, v) },
    ...overrides };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/js/weather-wind.js"), "utf8"), context);
  return { api:context.module.exports, saved };
}

test("concurrent loads share one request and subsequent fresh loads use cache", async () => {
  let calls = 0;
  const r = runtime({ fetch:async (_url, options) => {
    calls++; assert.equal(options.credentials, "omit"); return { ok:true, json:async () => body() };
  } });
  const result = await Promise.all([r.api.load(), r.api.load()]);
  assert.equal(calls, 1); assert.equal(result[0].grid, result[1].grid);
  await r.api.load(); assert.equal(calls, 1); assert.equal(r.saved.size, 1);
});

test("network failure uses explicitly marked saved data, with cooldown; old cache is rejected", async () => {
  let calls = 0;
  const r = runtime({ fetch:async () => { calls++; throw new Error("offline"); } });
  const grid = wind.parse(body(), now); grid.validAt -= 2 * HOUR; grid.fetchedAt -= 2 * HOUR;
  grid.frames.forEach(f => { f.validAt -= 2 * HOUR; });
  r.saved.set("classdock-wind-gfs-v4", JSON.stringify(grid));
  const a = await r.api.load(); assert.equal(a.saved, true); assert.equal(a.grid.validAt, grid.validAt);
  await r.api.load(); assert.equal(calls, 1);
  const empty = runtime({ fetch:async () => { throw new Error("offline"); } });
  grid.validAt -= 24 * HOUR; empty.saved.set("classdock-wind-gfs-v4", JSON.stringify(grid));
  await assert.rejects(empty.api.load(), /offline/); await assert.rejects(empty.api.load(), /wind-retry/);
});

// 순수 DOM/지도 대역으로 수명 주기만 검증한다. 브라우저나 화면 캡처는 사용하지 않는다.
function mountHarness(fetch, extra = {}){
  const nodes = [], frames = new Map(), listeners = new Map(); let frameId = 0, disconnected = false;
  const context2d = new Proxy({}, { get:() => () => {} });
  function node(tag){
    const n = { tag, style:{}, children:[], events:{}, attributes:{}, hidden:false, disabled:false,
      classList:{ toggle(){} }, append(...items){ this.children.push(...items); }, setAttribute(k, v){ this.attributes[k] = v; },
      replaceChildren(...items){ this.children = items; },
      addEventListener(k, fn){ this.events[k] = fn; }, focus(){}, remove(){ this.removed = true; }, getContext:() => context2d,
      getClientRects:() => [1] };
    nodes.push(n); return n;
  }
  const stage = node("stage"), toolRow = node("tools"), doc = { cleanupFns:[] };
  const document = { hidden:false, createElement:node, addEventListener(){}, removeEventListener(){} };
  let attribution = 0;
  const map = { createPane:() => node("pane"), getSize:() => ({ x:240, y:180 }), containerPointToLayerPoint:() => ({ x:0, y:0 }),
    containerPointToLatLng:([x, y]) => ({ lng:122 + x / 20, lat:42 - y / 15 }), fitBounds(){},
    latLngToContainerPoint:({ lat, lng }) => ({ x:(lng - 122) * 20, y:(42 - lat) * 15 }),
    attributionControl:{ addAttribution(){ attribution++; }, removeAttribution(){ attribution--; } },
    on(names, fn){ for (const name of names.split(" ")) listeners.set(name, fn); },
    off(names){ for (const name of names.split(" ")) listeners.delete(name); } };
  const r = runtime({ fetch, document, window:{ addEventListener(){}, removeEventListener(){}, matchMedia:() => ({ matches:false }) },
    L:{ DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} }, DomUtil:{ setPosition(){} } },
    requestAnimationFrame:fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame:id => frames.delete(id),
    IntersectionObserver:class { observe(){} disconnect(){ disconnected = true; } }, ...extra });
  const controller = r.api.mount({ map, stage, toolRow, doc });
  const find = cls => nodes.find(n => (n.className || "").split(" ").includes(cls));
  return { controller, find, frames, listeners, nodes, doc, disconnected:() => disconnected, attribution:() => attribution };
}

test("mount loads without KMA, pauses for export/movement and cleans up listeners/canvases", async () => {
  let calls = 0;
  const h = mountHarness(async () => { calls++; return { ok:true, json:async () => body() }; });
  assert.equal(calls, 0); assert.equal(h.find("map-wind-toggle").disabled, false);
  await h.find("map-wind-show").events.click(); assert.equal(calls, 1); assert.equal(h.attribution(), 1);
  assert.ok(h.frames.size); assert.match(h.controller.captureNote(), /Open-Meteo/);
  const resume = h.controller.freeze(); assert.equal(h.frames.size, 0); resume(); assert.ok(h.frames.size);
  h.listeners.get("movestart")(); assert.equal(h.frames.size, 0);
  h.listeners.get("moveend")(); assert.ok(h.frames.size); assert.equal(calls, 1);
  h.find("map-wind-pause").events.click(); assert.equal(h.frames.size, 0);
  h.find("map-wind-toggle").events.click(); assert.equal(h.controller.captureNote(), ""); assert.equal(h.attribution(), 0);
  assert.equal(h.find("map-wind-panel").hidden, true); assert.equal(h.find("map-wind-toggle").attributes["aria-pressed"], "false");
  h.doc.cleanupFns[0](); assert.equal(h.listeners.size, 0); assert.ok(h.disconnected());
  assert.ok(h.find("map-wind-panel").removed);
  assert.ok(h.nodes.find(n => n.tag === "pane").removed);
});

test("clearing or destroying a pending request never paints a late response", async () => {
  for (const destroy of [false, true]){
    let finish;
    const h = mountHarness(() => new Promise(resolve => { finish = resolve; }));
    const task = h.find("map-wind-show").events.click();
    if (destroy) h.controller.destroy(); else h.find("map-wind-toggle").events.click();
    finish({ ok:true, json:async () => body() }); await task;
    assert.equal(h.frames.size, 0); assert.equal(h.attribution(), 0); assert.equal(h.controller.captureNote(), "");
  }
});

test("25 forecast frames keep time, wind and temperature aligned through the next day", () => {
  const grid = wind.parse(body(), now);
  assert.equal(grid.frames.length, 25);
  assert.equal(grid.frames[24].validAt - grid.frames[0].validAt, 24 * HOUR);
  const value = wind.sample(grid.frames[24], 36, 128);
  near(value.speed, 12.4); near(value.direction, 270); near(value.temp, 32);
  assert.equal(wind.timeIndex(grid, grid.validAt - HOUR), 0);
  assert.equal(wind.timeIndex(grid, grid.validAt + 7.5 * HOUR), 7);
  assert.equal(wind.timeIndex(grid, grid.validAt + 48 * HOUR), 24);
  for (const mutate of [
    b => { b[7].hourly.time[24] += 3600; },
    b => { b[0].hourly.time[12] = null; },
    b => { b[0].hourly.wind_speed_10m.pop(); }
  ]){ const b = body(); mutate(b); assert.throws(() => wind.parse(b, now)); }
});

test("temperature is bilinearly interpolated independently of missing wind and retains zero", () => {
  const grid = wind.parse(body(), now).frames[0];
  const cols = wind.REGION.cols;
  for (const [id, temp] of [[0, -10], [1, 0], [cols, 10], [cols + 1, 20]]) grid.values[id].temp = temp;
  near(wind.sample(grid, 30.5, 122.5).temp, 5);
  grid.values[0].u = grid.values[0].v = null;
  const value = wind.sample(grid, 30.5, 122.5); assert.equal(value.speed, null); near(value.temp, 5);
  grid.values[0].temp = null; assert.equal(wind.sample(grid, 30.5, 122.5).temp, null);
  near(wind.sample(grid, 30, 123).temp, 0); // 가중치가 0인 이웃 결측은 정확한 격자점에 영향을 주지 않는다.
  assert.deepEqual(wind.color(-100, "temperature"), wind.color(-20, "temperature"));
  assert.deepEqual(wind.color(100, "temperature"), wind.color(40, "temperature"));
  const calm = wind.parse(body(), now).frames[0]; calm.values.forEach(v => { v.u = v.v = 0; });
  assert.equal(wind.sample(calm, 36, 128).direction, null);
});

test("old cache format and inconsistent forecast frame caches are rejected", () => {
  const grid = wind.parse(body(), now);
  for (const version of [1, 2, 3]) assert.equal(wind.validCache({ ...grid, version }, now), false);
  // 예전 9×9(81지점) 저장 자료는 새 격자에 맞지 않으므로 버린다.
  assert.equal(wind.validCache({ ...grid, frames:grid.frames.map(f => ({ ...f, values:f.values.slice(0, 81) })) }, now), false);
  grid.frames[5].validAt += HOUR; assert.equal(wind.validCache(grid, now), false);
});

test("time, color and point inspection stay synchronized without more requests, including while paused", async () => {
  let calls = 0;
  const h = mountHarness(async () => { calls++; return { ok:true, json:async () => body() }; });
  assert.equal(h.controller.inspectAt({ lat:36, lng:128 }), false);
  await h.find("map-wind-show").events.click();
  h.find("map-wind-pause").events.click(); assert.equal(h.frames.size, 0);
  assert.equal(h.controller.inspectAt({ lat:36, lng:128 }), true);
  assert.match(h.find("map-wind-spot-values").textContent, /10\.0 m\/s.*서 270°/);
  const slider = h.find("map-wind-time"); slider.value = "24"; slider.events.input();
  assert.match(h.find("map-wind-spot-values").textContent, /12\.4 m\/s/);
  assert.match(h.find("map-wind-spot-values").textContent, /32\.0 °C/);
  assert.equal(h.find("map-wind-next").disabled, true); assert.equal(h.frames.size, 0);
  const mode = h.find("map-wind-mode"); mode.value = "temperature"; mode.events.change();
  assert.match(h.controller.captureNote(), /기온·바람/); assert.match(h.controller.captureNote(), /10\. 03\./);
  assert.equal(slider.attributes["aria-valuetext"], h.find("map-wind-selected-time").textContent);
  const selectedTime = slider.value; await h.find("map-wind-show").events.click(); assert.equal(slider.value, selectedTime);
  h.find("map-wind-previous").events.click(); assert.equal(slider.value, "23");
  h.find("map-wind-current").events.click(); assert.equal(slider.value, "0");
  assert.equal(h.find("map-wind-previous").disabled, true);
  h.controller.inspectAt({ lat:20, lng:128 }); assert.match(h.find("map-wind-spot-values").textContent, /범위 밖/);
  assert.equal(calls, 1);
  h.find("map-wind-toggle").events.click(); assert.equal(h.find("map-wind-spot").hidden, true);
  assert.equal(slider.disabled, true); assert.equal(h.controller.inspectAt({ lat:36, lng:128 }), false);
  h.controller.destroy();
});

test("map inspection yields to quiz, drawing, adding markers and feature clicks", () => {
  const source = fs.readFileSync(require.resolve("../src/js/map-viewer.js"), "utf8");
  const start = source.indexOf('  map.on("click", (e) => {');
  const end = source.indexOf('  /* ── 보기 위치', start);
  let click, inspected = 0, places = 0;
  const context = { map:{ on:(_name, fn) => { click = fn; } }, quizPlaceAnswer:null, drawingMode:null, adding:false,
    wind:{ inspectAt:() => { inspected++; return true; } }, spotInfo:true, spotReady:true, popupWasOpen:false,
    showSpotInfo:() => { places++; }, clearDraftGuide(){}, draftPoints:[], mapClampLat:v => v, mapClampLng:v => v,
    updateDraft(){}, setStatus(){}, mapTf:() => "", model:{ markers:[] }, mapNormalizeMarker:v => v,
    hiddenSources:new Set(), addMarkerLayer:() => ({ openPopup(){} }), setAdding(){}, touch(){}, autoAddress:false };
  vm.runInNewContext(source.slice(start, end), context);
  const e = { latlng:{ lat:36, lng:128 } };
  click(e); assert.equal(inspected, 1); assert.equal(places, 0);
  click({ ...e, propagatedFrom:{} }); assert.equal(inspected, 1);
  context.quizPlaceAnswer = () => true; click(e); assert.equal(inspected, 1);
  context.quizPlaceAnswer = null; context.drawingMode = "line"; click(e); assert.equal(inspected, 1); assert.equal(context.draftPoints.length, 1);
  context.drawingMode = null; context.adding = true; click(e); assert.equal(inspected, 1); assert.equal(context.model.markers.length, 1);
  context.adding = false; context.wind.inspectAt = () => false; click(e); assert.equal(places, 1);
});

const globalCatalog = () => ({ cycle:"2026100200", runAt:Date.UTC(2026, 9, 2), hours:[3, 6, 9, 12, 15, 18, 21, 24, 27], step:3, resolution:1, saved:false });
function globalBuffer(hour = 3, level = 10){
  const count = 360 * 181, buffer = new ArrayBuffer(40 + count * 16), view = new DataView(buffer);
  // 0x32574443 = "CDW2"(채널 넷)
  view.setUint32(0, 0x32574443, true); view.setInt32(4, 360, true); view.setInt32(8, 181, true); view.setInt32(12, level, true);
  view.setFloat64(16, globalCatalog().runAt, true); view.setFloat64(24, globalCatalog().runAt + hour * HOUR, true); view.setFloat64(32, now, true);
  for (let i = 0; i < count; i++){
    view.setFloat32(40 + i * 4, hour, true); view.setFloat32(40 + count * 4 + i * 4, 0, true);
    view.setFloat32(40 + count * 8 + i * 4, level === 10 ? 20 : -40, true);
    view.setFloat32(40 + count * 12 + i * 4, 1010 - hour, true);
  }
  return buffer;
}
function globalFetch(requests, frameResponse = null){
  return async url => {
    requests.push(url);
    if (url === "/can-proxy-world-wind") return { ok:true, text:async () => "yes" };
    if (url === "/world-wind-catalog") return { ok:true, json:async () => globalCatalog() };
    assert.match(url, /^\/world-wind-frame\?/);
    const q = new URL(url, "http://localhost").searchParams;
    return frameResponse ? frameResponse(q) : { ok:true, arrayBuffer:async () => globalBuffer(Number(q.get("hour")), Number(q.get("level"))) };
  };
}

test("world binary validates cycle, level, dimensions, values and time before painting", () => {
  const catalog = globalCatalog(), r = runtime();
  assert.equal(r.api.parseWorldCatalog(catalog).cycle, catalog.cycle);
  for (const bad of [{ ...catalog, runAt:now + HOUR }, { ...catalog, cycle:"2026100206" }, { ...catalog, step:1 }, { ...catalog, hours:[3, 6] }])
    assert.throws(() => r.api.parseWorldCatalog(bad), /world-wind-data/);
  const parsed = r.api.parseWorldFrame(globalBuffer(), catalog, 3, 10);
  near(parsed.u[0], 3); near(parsed.temp[0], 20);
  assert.throws(() => r.api.parseWorldFrame(globalBuffer(), catalog, 6, 10));
  assert.throws(() => r.api.parseWorldFrame(globalBuffer(), catalog, 3, 850));
  assert.throws(() => r.api.parseWorldFrame(globalBuffer().slice(0, 50), catalog, 3, 10));
  near(parsed.pres[0], 1007);
  const old = globalBuffer(); new DataView(old).setUint32(0, 0x31574443, true); // 예전 "CDW1" 은 받지 않는다.
  assert.throws(() => r.api.parseWorldFrame(old, catalog, 3, 10));
  assert.throws(() => r.api.parseWorldFrame(globalBuffer().slice(0, 40 + 65160 * 12), catalog, 3, 10));
  for (const [offset, value] of [[40, Infinity], [40, 201], [40 + 65160 * 8, -121], [40 + 65160 * 12, 700], [40 + 65160 * 12, 1200]]){
    const buffer = globalBuffer(); new DataView(buffer).setFloat32(offset, value, true);
    assert.throws(() => r.api.parseWorldFrame(buffer, catalog, 3, 10));
  }
});

test("world interpolation wraps both date line and Greenwich, masks terrain and excludes polar singularities", () => {
  const grid = wind.parseWorldFrame(globalBuffer(), globalCatalog(), 3, 10);
  const row = 90 * 360;
  grid.u[row + 359] = 20; grid.u[row] = 10;
  near(wind.worldSample(grid, 0, -.5).u, 15);
  near(wind.worldSample(grid, 0, 359.5).u, 15);
  near(wind.worldSample(grid, 0, 719.5).u, 15);
  grid.u[row + 179] = 5; grid.u[row + 180] = 15;
  near(wind.worldSample(grid, 0, 179.5).u, 10); near(wind.worldSample(grid, 0, -180.5).u, 10);
  grid.u[row] = grid.v[row] = grid.temp[row] = NaN;
  assert.equal(wind.worldSample(grid, 0, -.5).speed, null);
  near(wind.worldSample(grid, 0, -1).u, 20);
  assert.equal(wind.worldSample(grid, 86, 0), null); assert.equal(wind.worldSample(grid, -90, 0), null);
  assert.equal(wind.worldSample(grid, NaN, 0), null);
});

test("world frames deduplicate requests and use a bounded memory cache", async () => {
  const requests = [], r = runtime({ fetch:globalFetch(requests) }), catalog = globalCatalog();
  const first = await Promise.all([r.api.worldFrame(catalog, 0, 10), r.api.worldFrame(catalog, 0, 10)]);
  assert.equal(first[0], first[1]); assert.equal(requests.length, 1);
  await r.api.worldFrame(catalog, 0, 10); assert.equal(requests.length, 1);
  for (let i = 1; i <= 12; i++) await r.api.worldFrame(catalog, i % 9, i < 9 ? 10 : 850);
  await r.api.worldFrame(catalog, 0, 10); assert.equal(requests.length, 14);
});

test("world controls load one frame per selection, keep one model run, preserve pause and never fetch on map movement", async () => {
  const requests = [], h = mountHarness(globalFetch(requests));
  const scope = h.find("map-wind-scope"); scope.value = "world"; scope.events.change();
  await h.find("map-wind-show").events.click();
  assert.equal(requests.length, 3); assert.equal(h.attribution(), 1); assert.match(h.controller.captureNote(), /NOAA GFS/);
  assert.doesNotMatch(h.controller.captureNote(), /Open-Meteo/);
  const slider = h.find("map-wind-time"); assert.equal(slider.max, "8");
  h.controller.inspectAt({ lat:36, lng:128 }); assert.match(h.find("map-wind-spot-values").textContent, /3\.0 m\/s/);
  h.find("map-wind-pause").events.click();
  slider.value = "2"; slider.events.input(); assert.equal(requests.length, 3); // Wait until release, no drag request storm.
  await slider.events.change(); assert.equal(requests.length, 4); assert.equal(h.frames.size, 0);
  assert.match(h.find("map-wind-spot-values").textContent, /9\.0 m\/s/);
  const level = h.find("map-wind-level"); level.value = "250"; await level.events.change();
  assert.equal(requests.length, 5); assert.equal(h.frames.size, 0); assert.equal(h.attribution(), 1);
  assert.match(h.controller.captureNote(), /250 hPa/); assert.match(h.find("map-wind-spot-values").textContent, /-40\.0 °C/);
  h.listeners.get("moveend")(); h.listeners.get("zoomend")(); assert.equal(requests.length, 5);
  await h.find("map-wind-previous").events.click(); assert.equal(requests.length, 6);
  await h.find("map-wind-next").events.click(); assert.equal(requests.length, 6);
  assert.equal(requests.filter(url => url === "/world-wind-catalog").length, 1);
  scope.value = "korea"; scope.events.change(); assert.equal(h.attribution(), 0); assert.equal(h.controller.captureNote(), "");
  assert.equal(h.find("map-wind-time").max, "24"); h.controller.destroy();
});

test("unsupported hosts explain EXE requirement; a failed level or time load keeps the previous field under its own label", async () => {
  const absent = mountHarness(async () => ({ ok:false, status:404 }));
  absent.find("map-wind-scope").value = "world"; absent.find("map-wind-scope").events.change();
  await absent.find("map-wind-show").events.click();
  assert.match(absent.find("map-weather-status").textContent, /Windows ClassDock.exe/); assert.equal(absent.controller.captureNote(), ""); absent.controller.destroy();
  let finishLevel = null;
  const h = mountHarness(globalFetch([], async q => {
    if (q.get("hour") === "9") throw new Error("offline");
    if (q.get("level") !== "10") return new Promise((_, reject) => { finishLevel = () => reject(new Error("offline")); });
    return { ok:true, arrayBuffer:async () => globalBuffer(Number(q.get("hour")), 10) };
  }));
  h.find("map-wind-scope").value = "world"; h.find("map-wind-scope").events.change(); await h.find("map-wind-show").events.click();
  h.controller.inspectAt({ lat:36, lng:128 }); const before = h.controller.captureNote(), frames = h.frames.size;
  assert.match(before, /지상 10m/); assert.ok(frames);
  const level = h.find("map-wind-level"); level.value = "850"; const pendingLevel = level.events.change();
  await new Promise(resolve => setTimeout(resolve, 0));
  // 받는 동안에도 지도에 남은 10m 자료에 850 hPa 이름이 붙지 않는다.
  assert.match(h.find("map-wind-legend").children[0].textContent, /지상 10m/); assert.doesNotMatch(h.controller.captureNote(), /850/);
  finishLevel(); await pendingLevel;
  assert.equal(level.value, "10"); assert.equal(h.controller.captureNote(), before); assert.equal(h.attribution(), 1);
  assert.equal(h.frames.size, frames); assert.match(h.find("map-wind-spot-values").textContent, /3\.0 m\/s/);
  assert.match(h.find("map-weather-status").textContent, /앞의 표시를 그대로 둡니다.*받지 못했습니다/);
  const slider = h.find("map-wind-time"); slider.value = "2"; await slider.events.change();
  assert.equal(slider.value, "0"); assert.equal(h.controller.captureNote(), before); assert.equal(slider.disabled, false);
  assert.match(h.find("map-weather-status").textContent, /앞의 표시를 그대로 둡니다/);
  await h.find("map-wind-next").events.click(); assert.equal(slider.value, "1"); assert.match(h.find("map-wind-spot-values").textContent, /6\.0 m\/s/);
  assert.match(h.find("map-weather-status").textContent, /^선택한 예보/); h.controller.destroy();
});

test("a late global frame cannot repaint after scope changes or destruction", async () => {
  for (const destroy of [false, true]){
    let finish, started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    const h = mountHarness(globalFetch([], () => new Promise(resolve => { finish = resolve; started(); })));
    h.find("map-wind-scope").value = "world"; h.find("map-wind-scope").events.change();
    const pending = h.find("map-wind-show").events.click(); await startedPromise;
    if (destroy) h.controller.destroy(); else { h.find("map-wind-scope").value = "korea"; h.find("map-wind-scope").events.change(); }
    finish({ ok:true, arrayBuffer:async () => globalBuffer() }); await pending;
    assert.equal(h.controller.captureNote(), ""); assert.equal(h.attribution(), 0); assert.equal(h.frames.size, 0); h.controller.destroy();
  }
});

test("wind has its own toolbar class and icon, and upper-level particles move slower than surface winds", () => {
  const h = mountHarness(async () => { throw new Error("unused"); });
  const toggle = h.find("map-wind-toggle");
  assert.ok(toggle.className.split(" ").includes("map-toolvis-wind"));
  assert.ok(!toggle.className.split(" ").includes("map-toolvis-weather")); // 날씨 숨기기와 따로 논다.
  const viewer = fs.readFileSync(require.resolve("../src/js/map-viewer.js"), "utf8");
  assert.match(viewer, /\n  wind: '<path /);
  const source = fs.readFileSync(require.resolve("../src/js/weather-wind.js"), "utf8");
  assert.match(source, /mapSetToolIcon\(toggle, "wind"\)/);
  assert.match(source, /pace = shown && shown\.world \? motionScale\(shown\.level\) : 1/);
  assert.match(source, /const scale = 2 \* ratio \* pace \//);
  assert.equal(wind.motionScale(10), 1); assert.equal(wind.motionScale(undefined), 1);
  const levels = [10, 850, 500, 250].map(wind.motionScale);
  levels.slice(1).forEach((pace, i) => assert.ok(pace < levels[i]));
  // 250 hPa 제트기류 70 m/s 가 지상 강풍 25 m/s 보다 화면에서 느리다.
  assert.ok(70 * wind.motionScale(250) < 25 * wind.motionScale(10));
  h.controller.destroy();
});

test("sea-level pressure is fetched, validated, interpolated and colored in both regions", async () => {
  const grid = wind.parse(body(), now);
  near(wind.sample(grid.frames[0], 36, 128).pres, 1000); near(wind.sample(grid.frames[24], 36, 128).pres, 1024);
  const missing = body(); missing[0].hourly.pressure_msl[0] = null; missing[1].hourly.pressure_msl[0] = 5000;
  const holes = wind.parse(missing, now).frames[0];
  assert.equal(holes.values[0].pres, null); assert.equal(holes.values[1].pres, null);
  assert.equal(wind.sample(holes, 30.2, 122.2).pres, null); assert.ok(wind.sample(holes, 36, 128).speed > 0); // 기압 결측이 바람을 숨기지 않는다.
  const cached = wind.parse(body(), now); cached.frames[0].values[0].pres = 2000; assert.equal(wind.validCache(cached, now), false);
  // 색: 낮은 기압(태풍 중심)은 짙은 자주, 표준 기압은 초록, 높은 기압은 파랑.
  assert.deepEqual(wind.color(940, "pressure"), wind.PRESSURE_COLORS[0][1]);
  assert.deepEqual(wind.color(1013, "pressure"), [115, 195, 130]);
  assert.deepEqual(wind.color(1060, "pressure"), wind.PRESSURE_COLORS[wind.PRESSURE_COLORS.length - 1][1]);
  const world = wind.parseWorldFrame(globalBuffer(3, 850), globalCatalog(), 3, 850);
  world.u[90 * 360] = NaN; // 지형 아래로 가린 상층 바람에서도 해면기압은 남는다.
  const value = wind.worldSample(world, 0, 0); assert.equal(value.speed, null); near(value.pres, 1007);
  // 화면: 기압 색을 고르면 범례·지점 수치·그림 메모가 기압을 말한다.
  const h = mountHarness(async () => ({ ok:true, json:async () => body() }));
  await h.find("map-wind-show").events.click();
  const mode = h.find("map-wind-mode"); mode.value = "pressure"; mode.events.change();
  assert.match(h.find("map-wind-legend").children[0].textContent, /해면기압 · hPa/);
  assert.equal(h.find("map-wind-ticks").children[0].textContent, "960−");
  h.controller.inspectAt({ lat:36, lng:128 }); assert.match(h.find("map-wind-spot-values").textContent, /해면기압 1000\.0 hPa/);
  assert.match(h.controller.captureNote(), /^해면기압·바람/);
  h.controller.destroy();
});

test("the wind button clears typhoons too, 'Update data' refreshes them, and captures name both sources", async () => {
  const log = [];
  let shown = false;
  const MNTyphoonLayer = { mount:({ host, onChange }) => {
    assert.ok(host); log.push("mount");
    return { shown:() => shown, clear(){ shown = false; log.push("clear"); onChange(); }, refresh(){ log.push("refresh"); }, sync(){},
      captureNote:() => shown ? "태풍 · 기상청 통보" : "", destroy(){ log.push("destroy"); } };
  } };
  const h = mountHarness(async () => ({ ok:true, json:async () => body() }), { MNTyphoonLayer });
  const toggle = h.find("map-wind-toggle");
  toggle.events.click(); assert.equal(h.find("map-wind-panel").hidden, false);
  shown = true; // 바람은 켜지 않고 태풍만 켠 상태
  assert.equal(h.controller.captureNote(), "태풍 · 기상청 통보");
  await h.find("map-wind-show").events.click(); assert.deepEqual(log, ["mount", "refresh"]);
  assert.match(h.controller.captureNote(), /^바람\(1° 보간\).* · 태풍 · 기상청 통보$/);
  toggle.events.click();
  assert.deepEqual(log, ["mount", "refresh", "clear"]); assert.equal(h.find("map-wind-panel").hidden, true);
  assert.equal(h.controller.captureNote(), ""); assert.equal(toggle.attributes["aria-pressed"], "false");
  // 태풍만 켜져 있어도 단추는 '켜짐'이고, 누르면 지우고 닫는다.
  toggle.events.click(); shown = true; h.controller.inspectAt({ lat:36, lng:128 });
  toggle.events.click(); assert.equal(log[log.length - 1], "clear"); assert.equal(h.find("map-wind-panel").hidden, true);
  h.controller.destroy(); assert.equal(log[log.length - 1], "destroy");
});

test("the map opens with the real typhoon layer mounted inside the wind panel (no use-before-init)", async () => {
  // 가짜 태풍 층은 만드는 도중 onChange 를 부르지 않아 2026-10-02 의 지도 열림 오류(ReferenceError: anyShown)를 놓쳤다.
  // 그래서 진짜 weather-typhoon.js 를 바람 창 안에 그대로 연다.
  const element = tag => ({ tag, style:{}, children:[], events:{}, attributes:{}, hidden:false, checked:false,
    append(...items){ this.children.push(...items); }, replaceChildren(...items){ this.children = items; },
    setAttribute(k, v){ this.attributes[k] = v; }, addEventListener(k, fn){ this.events[k] = fn; }, remove(){} });
  const layerContext = { module:{ exports:{} }, Date, document:{ createElement:element },
    MNWeatherApi:{ available:async () => false, failureText:() => "" } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/js/weather-typhoon.js"), "utf8"), layerContext);
  const h = mountHarness(async () => ({ ok:true, json:async () => body() }), { MNTyphoonLayer:layerContext.module.exports });
  assert.equal(h.find("map-wind-typhoon").hidden, false);
  assert.equal(h.find("map-wind-toggle").attributes["aria-pressed"], "false");
  await h.find("map-wind-show").events.click(); assert.match(h.controller.captureNote(), /^바람/);
  h.controller.destroy();
});
