"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const api = require("../src/js/protection-zones.js"), coords = require("../src/js/korea-coords.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const polygon = "POLYGON ((126.977 37.566,126.979 37.566,126.979 37.568,126.977 37.566))";
const record = (id, extra = {}) => ({ ptznMngNo:String(id), sggCd:"11140", fcltTypeCd:"1", trgtFcltNm:"시설 " + id, useYn:"Y", fturGeomVl:polygon,
  roadNmAddr:"서울 중구", lastMdfcnDt:"2026-10-01", ...extra });
const fixtures = [record(1), record(2, { fcltTypeCd:"2" }), record(3, { fcltTypeCd:"3" }), record(4, { fturGeomVl:"", trgtFcltNm:'<img src=x onerror="alert(1)">' })];
const envelope = (items, total = items.length, code = "00") => ({ response:{ header:{ resultCode:code }, body:{ items:{ item:items }, totalCount:total } } });
const at = Date.UTC(2026, 9, 9, 5);
const ok = (json, stamp = at, stale = false) => ({ ok:true, headers:{ get:n => n === "X-ClassDock-Bus-Fetched-At" ? new Date(stamp).toISOString() : n === "X-ClassDock-Bus-Stale" ? (stale ? "1" : "0") : "" }, json:async () => json });
const failure = (reason = "bus-key-invalid") => ({ ok:false, headers:{ get:() => "HTTP 403 - 30" }, text:async () => reason });
const defaultFetch = async url => url === "/can-proxy-weather" ? { ok:true, text:async () => "yes" }
  : ok(envelope(fixtures.map(row => ({ ...row, sggCd:new URL(url, "http://localhost").searchParams.get("sgg") }))));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function harness(fetch = defaultFetch){
  const nodes = [], calls = [], listeners = new Map(), windowListeners = new Map(), removed = [], fits = [];
  let center = { lat:37.5665, lng:126.978 }, now = at, inView = () => true;
  function node(tag){
    const n = { tag, children:[], events:{}, attributes:{}, style:{ setProperty(k, v){ this[k] = v; } }, hidden:false, disabled:false, value:"", textContent:"",
      classList:{ toggle(){}, add(){} }, append(...items){ this.children.push(...items); }, replaceChildren(...items){ this.children = items; }, setAttribute(k, v){ this.attributes[k] = v; },
      addEventListener(k, fn){ this.events[k] = fn; }, click(){ this.events.click(); }, focus(){}, remove(){ this.removed = true; } };
    nodes.push(n); return n;
  }
  const group = { items:[], onMap:false, clearLayers(){ this.items = []; }, addTo(){ this.onMap = true; return this; } }, renderer = {};
  const L = { DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} }, svg:options => { renderer.options = options; return renderer; }, layerGroup:() => group,
    polygon:(parts, options) => ({ parts, options, bindTooltip(fn){ this.tip = fn; return this; }, bindPopup(fn){ this.popup = fn; return this; }, addTo(g){ g.items.push(this); return this; }, openPopup(){ this.opened = true; } }) };
  const map = { createPane:() => node("pane"), getCenter:() => ({ ...center, distanceTo:([lat, lng]) => Math.hypot(lat - center.lat, lng - center.lng) * 111000 }),
    getBounds:() => ({ intersects:inView }), fitBounds(points, options){ fits.push({ points, options }); }, closePopup(){}, removeLayer(g){ removed.push(g); g.onMap = false; },
    on(k, fn){ listeners.set(k, fn); }, off(k){ listeners.delete(k); } };
  const window = { addEventListener(k, fn){ windowListeners.set(k, fn); }, removeEventListener(k){ windowListeners.delete(k); } };
  const districts = [{ code:"11140", sido:"서울특별시", sgg:"중구", name:"서울특별시 중구", contains:lat => lat >= 37 && lat <= 38 },
    { code:"50110", sido:"제주특별자치도", sgg:"제주시", name:"제주특별자치도 제주시", contains:lat => lat >= 33 && lat <= 34 }];
  const context = { module:{ exports:{} }, MNKoreaCoords:coords, AbortController, setTimeout, clearTimeout, L, window, document:{ createElement:node },
    fetch:(url, options) => { calls.push({ url, options }); return fetch(url, options); },
    Date:class extends Date { constructor(...args){ super(...(args.length ? args : [now])); } static now(){ return now; } } };
  vm.runInNewContext(read("src/js/protection-zones.js"), context);
  const doc = { cleanupFns:[] }, moduleApi = context.module.exports, controller = moduleApi.mount({ map, stage:node("stage"), toolRow:node("tools"), doc, getDistricts:async () => districts });
  return { api:moduleApi, controller, doc, group, renderer, removed, calls, listeners, windowListeners, fits,
    find:cls => nodes.find(n => (n.className || "").split(" ").includes(cls)), checks:() => nodes.filter(n => n.tag === "input"),
    setCenter:value => { center = value; }, setNow:value => { now = value; }, setViewFilter:fn => { inView = fn; },
    setEnglish:() => { window.MNI18N = { lang:"en" }; windowListeners.get("mni18nchange")(); } };
}
const opened = async fetch => { const h = harness(fetch); await settle(); h.find("map-toolvis-protection-zones").click(); await settle(); return h; };
const tree = n => n.removed ? [] : [n, ...(n.children || []).flatMap(tree)];
const textOf = n => tree(n).map(v => v.textContent || "").join(" ");

test("WKT 다각형·구멍·멀티폴리곤·Z를 위경도 순서로 보존한다", () => {
  const result = api.geometry("MULTIPOLYGON (((127 37,128 37,128 38,127 37),(127.1 37.1,127.2 37.1,127.2 37.2,127.1 37.1)),((129 37,129.1 37,129.1 37.1,129 37)))");
  assert.equal(result.parts.length, 2); assert.equal(result.parts[0].length, 2); assert.deepEqual(result.parts[0][0][0], [37, 127]);
  assert.deepEqual(result.bounds, [[37, 127], [38, 129.1]]);
  assert.deepEqual(api.geometry("SRID=4326; POLYGON Z ((127 37 10,128 37 11,128 38 12,127 37 10))").parts[0][0][0], [37, 127]);
  assert.deepEqual(api.geometry(JSON.stringify({ type:"Polygon", coordinates:[[[127, 37], [128, 37], [128, 38], [127, 37]]] })).parts[0][0][0], [37, 127]);
});

test("평면 WKT의 기본 5181과 명시된 5186·5179의 원점을 정확히 변환한다", () => {
  for (const [id, x, y, expected] of [["5181", 200000, 500000, [38, 127]], ["5186", 200000, 600000, [38, 127]], ["5179", 1000000, 2000000, [38, 127.5]]]){
    const wkt = (id === "5181" ? "" : "SRID=" + id + ";") + `POLYGON ((${x} ${y},${x + 100} ${y},${x + 100} ${y + 100},${x} ${y}))`;
    const result = api.geometry(wkt, coords); assert.ok(result);
    assert.ok(Math.abs(result.parts[0][0][0][0] - expected[0]) < 1e-7); assert.ok(Math.abs(result.parts[0][0][0][1] - expected[1]) < 1e-7);
  }
  assert.equal(api.geometry("POLYGON ((200000 500000,200100 500000,200100 500100,200000 500000))", null), null);
});

test("깨진·열린·국외·지원하지 않는 경계와 과도한 좌표는 임의 경계로 바꾸지 않는다", () => {
  for (const value of ["", "POLYGON EMPTY", "LINESTRING (127 37,128 38)", "POLYGON ((127 37,128 37,128 38))", "POLYGON ((127 37,128 37,128 38,127 37))evil",
    "POLYGON ((127 37,127 37,127 37,127 37))", "POLYGON ((-80 37,-81 37,-81 38,-80 37))", "SRID=99999;" + polygon,
    '{"type":"Polygon","coordinates":[[[127,37],[128,37],[128,38],[127,37]]],"crs":{"properties":{"name":"unknown"}}}']) assert.equal(api.geometry(value, coords), null, value);
  assert.equal(api.geometry("POLYGON ((" + Array(20002).fill("127 37").join(",") + "))"), null);
});

test("경찰청 정상·단일 항목·ERR_03을 읽고 나머지 오류를 빈 결과로 숨기지 않는다", () => {
  assert.equal(api.rows(envelope(fixtures, 4, "0000")).items.length, 4);
  assert.equal(api.rows(envelope(record(1), 1)).items.length, 1);
  assert.deepEqual(api.rows({ header:{ resultCode:"ERR_03" } }), { items:[], total:0 });
  for (const code of ["30", "ERR_01", "ERR_02", "ERR_04", "00"]) assert.throws(() => api.rows({ header:{ resultCode:code } }), /zones-invalid-data/);
});

test("사용하지 않는 기록·다른 시군구·잘못된 갈래를 제외하고 경계 누락은 목록에 보존한다", () => {
  const result = api.normalize([...fixtures, record(5, { useYn:"N" }), record(6, { sggCd:"50110" }), record(7, { fcltTypeCd:"9" }), record(4)], "11140");
  assert.equal(result.zones.length, 4); assert.equal(result.inactive, 1); assert.equal(result.other, 2);
  assert.ok(result.zones.find(z => z.id === "4").geometry, "같은 관리번호의 유효 경계를 우선한다");
  assert.equal(api.normalize(fixtures, "11140").zones[3].geometry, null);
  assert.match(api.normalize(fixtures, "11140").zones[3].name, /<img/);
});

test("내장 행안부 5자리 시군구 코드와 실제 행정경계로 서울·제주·부산을 고른다", async () => {
  const c = { console, window:{}, document:{}, location:{ protocol:"file:" }, navigator:{ onLine:true }, Blob, URL, setTimeout, clearTimeout };
  vm.createContext(c); for (const file of ["vendor/korea-regions.js", "vendor/korea-emd.js", "src/js/map-viewer.js"]) vm.runInContext(read(file), c);
  const districts = await vm.runInContext("mapProtectionDistricts()", c); assert.ok(districts.length > 240);
  assert.equal(new Set(districts.map(v => v.code)).size, districts.length);
  for (const [lat, lng, code] of [[37.5665, 126.978, "11140"], [33.4996, 126.5312, "50110"], [35.1796, 129.0756, "26470"]]) assert.equal(districts.find(v => v.contains(lat, lng)).code, code);
  assert.equal(districts.find(v => v.contains(51.5, -.1)), undefined);
});

test("세 갈래의 경계·목록·팝업·전체 보기와 출처를 연결한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  assert.equal(h.controller.isAvailable(), true); assert.equal(h.group.items.length, 3);
  assert.match(h.calls[1].url, /^\/protection-zones\?sgg=11140&page=1$/);
  assert.equal(h.group.items[0].options.pane, "mapProtectionZonesPane"); assert.equal(h.group.items[0].parts[0][0].length, 4);
  assert.equal(new Set(h.group.items.map(v => v.options.color)).size, 3);
  assert.match(textOf(h.group.items[0].tip()), /시설 1.*어린이 보호구역.*서울 중구/);
  assert.match(textOf(h.group.items[0].popup()), /관리번호.*최종 수정일.*2026-10-01/);
  assert.match(h.find("map-zone-summary").textContent, /중구.*4곳.*경계 3곳.*좌표 확인 1곳/);
  h.find("map-zone-list").children[0].children[0].click(); assert.equal(h.fits.length, 1); assert.equal(h.group.items[0].opened, true);
  h.find("map-zone-fit").click(); assert.equal(h.fits[1].points.length, 6);
  assert.match(h.controller.captureNote(), /경찰청.*중구.*어린이.*노인.*장애인/);
});

test("갈래 변경과 지도 이동은 API를 다시 부르지 않고 빠진 경계는 목록에서 상세를 연다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const count = h.calls.length;
  h.checks()[0].checked = false; h.checks()[0].events.change(); assert.equal(h.group.items.length, 2);
  h.setViewFilter(() => false); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140));
  assert.match(h.find("map-zone-summary").textContent, /화면 안 0곳/); assert.equal(h.calls.length, count);
  h.checks()[0].checked = true; h.checks()[0].events.change();
  const item = h.find("map-zone-list").children.find(n => textOf(n).includes("<img")); item.children[0].click();
  assert.match(textOf(item), /경계 미등록.*좌표 확인 필요/); assert.equal(tree(item).filter(n => n.tag === "img").length, 0);
  assert.equal(h.fits.length, 0); assert.equal(h.calls.length, count);
});

test("자료 없는 지역과 심의 중인 API를 구분해 안내한다", async t => {
  const empty = await opened(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok({ header:{ resultCode:"ERR_03" } })); t.after(() => empty.controller.destroy());
  assert.equal(empty.group.items.length, 0); assert.match(textOf(empty.find("map-zone-list")), /표시할 보호구역이 없어요/);
  const denied = await opened(url => url === "/can-proxy-weather" ? defaultFetch(url) : failure()); t.after(() => denied.controller.destroy());
  assert.match(denied.find("map-zone-status").textContent, /심의승인.*심의 중.*HTTP 403 - 30/); assert.equal(denied.controller.captureNote(), "");
});

test("직접 지역을 바꾸고 갱신 실패 때 이전 지역 이름과 경계를 유지한다", async t => {
  let fail = false;
  const h = await opened(url => fail && url.startsWith("/protection-zones") ? failure() : defaultFetch(url)); t.after(() => h.controller.destroy());
  fail = true; h.find("map-zone-province").value = "제주특별자치도"; h.find("map-zone-province").events.change(); await settle();
  assert.match(h.calls.at(-1).url, /sgg=50110/); assert.equal(h.group.items.length, 3);
  assert.match(h.find("map-zone-summary").textContent, /^서울특별시 중구/); assert.match(h.find("map-zone-status").textContent, /앞서 받은 보호구역/);
  assert.doesNotMatch(h.controller.captureNote(), /제주/);
  fail = false; h.find("map-zone-search").click(); await settle(); assert.match(h.find("map-zone-summary").textContent, /^제주특별자치도 제주시/);
});

test("국외 지도 중심은 API를 부르지 않으며 기존 표시를 유지한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const count = h.calls.length;
  h.setCenter({ lat:51.5, lng:-.1 }); h.find("map-zone-center").click(); await settle();
  assert.equal(h.calls.length, count); assert.match(h.find("map-zone-status").textContent, /대한민국.*직접 골라/); assert.equal(h.group.items.length, 3);
});

test("하루 캐시·자료 갱신·페이지 상한과 잘못된 요청을 처리한다", async t => {
  const h = harness(); t.after(() => h.controller.destroy());
  const first = await h.api.load("11140"); await h.api.load("11140"); assert.equal(h.calls.filter(c => c.url.startsWith("/protection-zones")).length, 1);
  assert.equal(first.complete, true); await h.api.load("11140", { refresh:true }); assert.equal(h.calls.filter(c => c.url.startsWith("/protection-zones")).length, 2);
  h.setNow(at + 86400001); await h.api.load("11140"); assert.equal(h.calls.filter(c => c.url.startsWith("/protection-zones")).length, 3);
  const large = harness(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope(Array.from({ length:100 }, (_, i) => record(Number(new URL(url, "http://localhost").searchParams.get("page")) * 100 + i)), 1100)));
  t.after(() => large.controller.destroy()); const result = await large.api.load("11140"); assert.equal(result.zones.length, 1000); assert.equal(result.complete, false);
  assert.equal(large.calls.filter(c => c.url.startsWith("/protection-zones")).length, 10);
  for (const id of ["", "1114", "01140", "11140&url=other", "50110,1"]) await assert.rejects(h.api.load(id), /bus-bad-request/);
});

test("서버의 오래된 자료는 캐시에 새 자료로 저장하지 않는다", async t => {
  const h = harness(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope(fixtures), at - 86400001, true)); t.after(() => h.controller.destroy());
  assert.equal((await h.api.load("11140")).stale, true); await h.api.load("11140"); assert.equal(h.calls.filter(c => c.url.startsWith("/protection-zones")).length, 2);
});

test("조회 취소 뒤 늦게 도착한 응답은 지운 경계를 되살리지 않는다", async t => {
  let resolve, request;
  const h = await opened((url, options) => url === "/can-proxy-weather" ? defaultFetch(url) : new Promise(done => { resolve = done; request = options; })); t.after(() => h.controller.destroy());
  h.find("map-zone-clear").click(); assert.equal(request.signal.aborted, true); resolve(ok(envelope(fixtures))); await settle();
  assert.equal(h.group.items.length, 0); assert.equal(h.group.onMap, false); assert.equal(h.controller.captureNote(), "");
});

test("창 닫기·언어 변경·문서 종료는 재조회 없이 층과 자원을 정리한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const count = h.calls.length;
  h.find("map-weather-heading").children[1].click(); assert.equal(h.group.onMap, true); h.find("map-toolvis-protection-zones").click(); assert.equal(h.calls.length, count);
  h.setEnglish(); assert.match(h.find("map-zone-summary").textContent, /4 places.*3 boundaries/); assert.equal(h.calls.length, count);
  h.doc.cleanupFns[0](); assert.equal(h.group.onMap, false); assert.equal(h.listeners.size, 0); assert.equal(h.windowListeners.size, 0);
  assert.ok(h.removed.includes(h.renderer)); assert.ok(h.find("map-zone-panel").removed);
});

test("보호구역 묶음·숨김·좌표 의존성·출처와 인증키 비노출을 등록한다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json")); assert.ok(manifest.localScripts.includes("protection-zones.js"));
  assert.ok(manifest.scriptDependencies["map-viewer.js"].includes("protection-zones.js")); assert.ok(manifest.scriptDependencies["protection-zones.js"].includes("korea-coords.js"));
  assert.match(read("classdock.html"), /src="src\/js\/protection-zones\.js"/); assert.match(read("src/js/state.js"), /id:"mapProtectionZones"/);
  assert.match(read("src/styles.css"), /hide-tool-mapProtectionZones \.map-toolvis-protection-zones/); assert.match(read("src/js/map-viewer.js"), /protectionZones && protectionZones\.captureNote\(\)/);
  assert.doesNotMatch(read("src/js/protection-zones.js"), /innerHTML|serviceKey|TagoKeyParameter|L\.circle/);
  assert.match(api.SOURCE, /15142010/);
});
