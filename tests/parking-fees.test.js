"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const api = require("../src/js/parking-fees.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const record = (id, extra = {}) => ({ prkplceNo:String(id), prkplceNm:"주차장 " + id, prkplceSe:"공영", prkplceType:"노외", latitude:"37.567", longitude:"126.978",
  parkingchrgeInfo:"유료", basicTime:"30", basicCharge:"600", addUnitTime:"10", addUnitCharge:"300", prkcmprt:"50", referenceDate:"2026-10-01",
  operDay:"평일+토요일+공휴일", weekdayOperOpenHhmm:"09:00", weekdayOperColseHhmm:"21:00", satOperOperOpenHhmm:"00:00", satOperCloseHhmm:"23:59",
  holidayOperOpenHhmm:"10:00", holidayCloseOpenHhmm:"18:00", rdnmadr:"서울 중구", ...extra });
const fixtures = [record(1), record(2, { parkingchrgeInfo:"무료", latitude:"37.568" }), record(3, { parkingchrgeInfo:"혼합" }),
  record(4, { latitude:"", prkplceNm:'<img src=x onerror="bad()">' })];
const envelope = (items, total = items.length) => ({ header:{ resultCode:"00" }, body:{ items:{ item:items }, totalCount:total } });
const at = Date.UTC(2026, 9, 9, 5);
const ok = (json, stamp = at, stale = false) => ({ ok:true, headers:{ get:n => n === "X-ClassDock-Bus-Fetched-At" ? new Date(stamp).toISOString() : n === "X-ClassDock-Bus-Stale" ? (stale ? "1" : "0") : "" }, json:async () => json });
const failure = (reason = "bus-key-invalid") => ({ ok:false, headers:{ get:() => "HTTP 403 - 30" }, text:async () => reason });
const defaultFetch = async url => url === "/can-proxy-weather" ? { ok:true, text:async () => "yes" } : ok(envelope(fixtures));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function harness(fetch = defaultFetch, disk = null){
  const nodes = [], calls = [], listeners = new Map(), windowListeners = new Map(), removed = [], views = [];
  let center = { lat:37.5665, lng:126.978 }, now = at;
  function node(tag){
    const n = { tag, children:[], events:{}, attributes:{}, style:{ setProperty(k, v){ this[k] = v; } }, hidden:false, disabled:false, value:"", textContent:"",
      classList:{ toggle(){}, add(){} }, append(...items){ this.children.push(...items); }, replaceChildren(...items){ this.children = items; }, setAttribute(k, v){ this.attributes[k] = v; },
      addEventListener(k, fn){ this.events[k] = fn; }, click(){ this.events.click(); }, focus(){}, remove(){ this.removed = true; } };
    nodes.push(n); return n;
  }
  const group = { items:[], onMap:false, clearLayers(){ for (const item of this.items) item.opened = false; this.items = []; },
    removeLayer(item){ item.opened = false; this.items = this.items.filter(v => v !== item); }, addTo(){ this.onMap = true; return this; } }, renderer = {};
  const L = { DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} }, svg:options => { renderer.options = options; return renderer; }, layerGroup:() => group,
    circleMarker:(point, options) => ({ point, options, bindTooltip(fn){ this.tip = fn; return this; }, bindPopup(fn, settings){ this.popup = fn; this.popupOptions = settings; return this; },
      addTo(g){ g.items.push(this); return this; }, openPopup(){ this.opened = true; }, isPopupOpen(){ return !!this.opened; }, setStyle(settings){ Object.assign(this.options, settings); },
      getLatLng(){ return { lat:this.point[0], lng:this.point[1] }; }, setLatLng(value){ this.point = value; } }) };
  const map = { createPane:() => node("pane"), getCenter:() => center, getZoom:() => 13,
    setView(point, zoom, options){ views.push({ point, zoom, options }); center = { lat:point[0], lng:point[1] }; if (listeners.has("moveend")) listeners.get("moveend")(); }, closePopup(){},
    removeLayer(g){ removed.push(g); g.onMap = false; }, on(k, fn){ listeners.set(k, fn); }, off(k){ listeners.delete(k); } };
  const window = { addEventListener(k, fn){ windowListeners.set(k, fn); }, removeEventListener(k){ windowListeners.delete(k); } };
  const context = { module:{ exports:{} }, AbortController, setTimeout, clearTimeout, L, window, document:{ createElement:node },
    fetch:(url, options) => { calls.push({ url, options }); return fetch(url, options); },
    Date:class extends Date { constructor(...args){ super(...(args.length ? args : [now])); } static now(){ return now; } } };
  if (disk) context.indexedDB = {
    open(){ const request = {};
      queueMicrotask(() => {
        request.result = { close(){ disk.closed++; }, transaction(){
          const transaction = { objectStore:() => ({ get:() => operation(false), put:value => operation(value) }) };
          function operation(value){ const item = {}; queueMicrotask(() => { if (value) disk.data = structuredClone(value); item.result = disk.data; item.onsuccess(); transaction.oncomplete(); }); return item; }
          return transaction;
        } }; request.onsuccess();
      }); return request;
    }
  };
  vm.runInNewContext(read("src/js/parking-fees.js"), context);
  const doc = { cleanupFns:[] }, moduleApi = context.module.exports, controller = moduleApi.mount({ map, stage:node("stage"), toolRow:node("tools"), doc });
  return { api:moduleApi, controller, doc, group, renderer, removed, calls, listeners, windowListeners, views,
    find:cls => nodes.find(n => (n.className || "").split(" ").includes(cls)), setCenter:value => { center = value; }, setNow:value => { now = value; },
    setEnglish:() => { window.MNI18N = { lang:"en" }; windowListeners.get("mni18nchange")(); } };
}
const opened = async fetch => { const h = harness(fetch); await settle(); h.find("map-toolvis-parking-fees").click(); await settle(); return h; };
const tree = n => n.removed ? [] : [n, ...(n.children || []).flatMap(tree)];
const textOf = n => tree(n).map(v => v.textContent || "").join(" ");

test("무료·기본시간·추가 단위 올림과 0원 무료 시간을 계산한다", () => {
  const p = api.lot(record(1));
  for (const [minutes, expected] of [[1, 600], [30, 600], [31, 900], [40, 900], [41, 1200], [120, 3300]]) assert.equal(api.estimate(p, minutes), expected);
  assert.equal(api.estimate(api.lot(record(2, { parkingchrgeInfo:"무료", basicCharge:"", addUnitCharge:"" }))), 0);
  assert.equal(api.estimate(api.lot(record(3, { basicCharge:"0" })), 30), 0);
  assert.equal(api.estimate(api.lot(record(4, { basicTime:"0", basicCharge:"0" })), 31), 1200);
  assert.equal(api.estimate(api.lot(record(5, { basicTime:"30분", basicCharge:"1,200원" })), 30), 1200);
});

test("누락·혼합·음수·깨진 요금을 무료로 오인하지 않고 일일권은 자동 상한으로 삼지 않는다", () => {
  for (const extra of [{ parkingchrgeInfo:"혼합" }, { basicCharge:"" }, { basicTime:"" }, { addUnitCharge:"" }, { addUnitTime:"0" },
    { basicCharge:"-600" }, { basicCharge:"600~900" }, { basicTime:"0", basicCharge:"0", addUnitCharge:"0" }]) assert.equal(api.estimate(api.lot(record(1, extra))), null);
  const p = api.lot(record(1, { dayCmmtkt:"1000", dayCmmtktAdjTime:"5" })); assert.equal(api.estimate(p), 3300);
  assert.equal(api.estimate(api.lot(record(1, { addUnitCharge:"" })), 30), 600);
  for (const duration of [0, -1, 1441, NaN, 1.5]) assert.equal(api.estimate(p, duration), null);
  for (const value of ["", null, "-1", "NaN", "무제한", "1e5", "1,00"]) assert.equal(api.number(value), null);
});

test("평일·토요일·공휴일과 익일 종료를 구분하고 00:00–00:00을 24시간으로 추정하지 않는다", () => {
  const p = api.lot(record(1)); assert.equal(api.hours(p, 0).label, "09:00–21:00"); assert.equal(api.hours(p, 1).label, "24시간"); assert.equal(api.hours(p, 2).label, "10:00–18:00");
  assert.equal(api.hours(api.lot(record(1, { weekdayOperOpenHhmm:"22:00", weekdayOperColseHhmm:"06:00" }))).label, "22:00–06:00 (익일)");
  assert.equal(api.hours(api.lot(record(1, { operDay:"평일" })), 2).state, "closed");
  for (const extra of [{ weekdayOperOpenHhmm:"" }, { weekdayOperColseHhmm:"25:00" }, { weekdayOperOpenHhmm:"00:00", weekdayOperColseHhmm:"00:00" }]) assert.equal(api.hours(api.lot(record(1, extra))).state, "unknown");
});

test("응답·최신 중복·빈 좌표·총 규모와 가격/거리/무료 필터를 해석한다", () => {
  assert.equal(api.rows({ response:envelope([record(1)]) }).items.length, 1);
  assert.equal(api.rows({ header:{ resultCode:"03" } }).total, 0);
  assert.throws(() => api.rows({ header:{ resultCode:"30" } }), /parking-invalid-data/);
  assert.throws(() => api.rows({ header:{ resultCode:"00" }, body:{ totalCount:"bad" } }), /parking-invalid-data/);
  const lots = api.normalize([...fixtures, record(1, { referenceDate:"2026-10-02", basicCharge:"700" })]);
  assert.equal(lots.length, 4); assert.equal(lots[0].basicFee, 700); assert.equal(lots[3].lat, null);
  assert.equal(api.lot(record(1, { prkcmprt:"0" })).capacity, null);
  const center = { lat:37.5665, lng:126.978 };
  assert.deepEqual(api.nearby(lots, center).map(v => v.lot.id), ["2", "1", "3"]);
  assert.deepEqual(api.nearby(lots, center, 3000, 120, "distance").map(v => v.lot.id), ["1", "3", "2"]);
  assert.equal(api.nearby(lots, center, 3000, 120, "fee", true).length, 1);
  assert.equal(api.nearby(lots, center, 40).length, 0); assert.equal(api.nearby(lots, { lat:51.5, lng:-.1 }).length, 0);
  assert.ok(Math.abs(api.distance(center, { lat:37.5675, lng:126.978 }) - 111.195) < .01);
});

test("2시간 요금·시간표·규모·상세 카드와 목록 이동을 연결한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); assert.equal(h.controller.isAvailable(), true); assert.equal(h.group.items.length, 3);
  assert.equal(h.group.items[0].options.pane, "mapParkingFeesPane"); assert.match(textOf(h.group.items[0].tip()), /주차장 2.*2시간.*무료.*총 50면/);
  assert.match(textOf(h.group.items[1].popup()), /3,300원.*기본요금.*추가요금.*데이터 기준일.*2026-10-01/);
  assert.match(h.find("map-parking-summary").textContent, /3 km.*2시간.*3곳/); assert.match(h.find("map-parking-status").textContent, /좌표 미등록 1곳/);
  h.find("map-parking-list").children[0].children[0].click(); assert.equal(h.views.length, 1); assert.equal(h.views[0].options.animate, false);
  await new Promise(resolve => setTimeout(resolve, 140)); assert.ok(h.group.items[0].opened, "목록 이동 직후 갱신이 팝업을 지우지 않는다");
  assert.match(h.controller.captureNote(), /전국주차장.*2시간/);
});

test("시간·반경·정렬·요일·무료와 지도 이동은 API를 재조회하지 않는다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const count = h.calls.length;
  const duration = h.find("map-parking-duration"); duration.value = "60"; duration.events.change(); assert.match(textOf(h.group.items[1].tip()), /1시간.*1,500원/);
  const day = h.find("map-parking-day"); day.value = "1"; day.events.change(); assert.match(textOf(h.group.items[0].tip()), /24시간/);
  const free = h.find("map-parking-free"); free.checked = true; free.events.change(); assert.equal(h.group.items.length, 1);
  h.setCenter({ lat:33.5, lng:126.5 }); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140)); assert.equal(h.group.items.length, 0);
  assert.match(textOf(h.find("map-parking-list")), /반경/); assert.equal(h.calls.length, count);
});

test("팝업의 자동 지도 이동은 열린 상세와 표시 객체를 지우지 않으며 높이를 제한한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const count = h.calls.length, marker = h.group.items[1];
  marker.openPopup(); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140));
  assert.ok(h.group.items.includes(marker)); assert.equal(marker.opened, true);
  assert.equal(marker.popupOptions.className, "map-parking-popup"); assert.equal(marker.popupOptions.maxHeight, 260);
  h.setCenter({ lat:33.5, lng:126.5 }); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140));
  assert.ok(h.group.items.includes(marker), "열린 주차 상세는 반경 목록이 바뀌어도 닫기 전까지 유지한다");
  marker.opened = false; h.listeners.get("popupclose")(); await new Promise(resolve => setTimeout(resolve, 140)); assert.equal(h.group.items.length, 0);
  assert.equal(h.calls.length, count);
});

test("전국 페이지를 끝까지 모으고 짧은 중간 페이지와 최대 페이지 제한을 숨기지 않는다", async t => {
  const progress = [], h = harness(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([record(Number(new URL(url, "http://localhost").searchParams.get("page")))], 3)));
  t.after(() => h.controller.destroy()); const result = await h.api.load({ onProgress:(got, total) => progress.push([got, total]) });
  assert.equal(result.lots.length, 3); assert.equal(result.complete, true); assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  await h.api.load(); assert.equal(h.calls.filter(c => c.url.startsWith("/parking-fees")).length, 3);
  const large = harness(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([record(new URL(url, "http://localhost").searchParams.get("page"))], 51)));
  t.after(() => large.controller.destroy()); assert.equal((await large.api.load()).complete, false); assert.equal(large.calls.filter(c => c.url.startsWith("/parking-fees")).length, 50);
});

test("IndexedDB를 7일 재사용하고 갱신·만료·오래된 서버 응답을 구분한다", async t => {
  const disk = { data:null, closed:0 }, h = harness(defaultFetch, disk); t.after(() => h.controller.destroy()); await h.api.load(); assert.ok(disk.data);
  const restarted = harness(defaultFetch, disk); t.after(() => restarted.controller.destroy()); await restarted.api.load(); assert.equal(restarted.calls.filter(c => c.url.startsWith("/parking-fees")).length, 0);
  await restarted.api.load({ refresh:true }); assert.match(restarted.calls.at(-1).url, /refresh=1/);
  restarted.setNow(at + 7 * 86400000 + 1); await restarted.api.load(); assert.equal(restarted.calls.filter(c => c.url.startsWith("/parking-fees")).length, 2);
  assert.ok(disk.closed >= 4);
  const stale = harness(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope(fixtures), at - 8 * 86400000, true)); t.after(() => stale.controller.destroy());
  assert.equal((await stale.api.load()).stale, true); await stale.api.load(); assert.equal(stale.calls.filter(c => c.url.startsWith("/parking-fees")).length, 2);
});

test("갱신 실패는 기존 자료를 보존하며 누락 요금과 승인/한도 오류를 안내한다", async t => {
  let fail = false; const h = await opened(url => fail && url.startsWith("/parking-fees") ? failure("bus-quota") : defaultFetch(url)); t.after(() => h.controller.destroy());
  fail = true; h.find("map-parking-refresh").click(); await settle(); assert.equal(h.group.items.length, 3); assert.match(h.find("map-parking-status").textContent, /조회 한도.*앞서 받은/);
  const denied = await opened(url => url === "/can-proxy-weather" ? defaultFetch(url) : failure()); t.after(() => denied.controller.destroy());
  assert.match(denied.find("map-parking-status").textContent, /활용신청 승인.*HTTP 403 - 30/); assert.equal(denied.controller.captureNote(), "");
});

test("자료 갱신은 유지한 표시의 좌표와 새 상세 정보를 함께 바꾼다", async t => {
  let changed = false;
  const h = await opened(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([record(1, changed ? { latitude:"37.568", basicCharge:"900", referenceDate:"2026-10-09" } : {})])));
  t.after(() => h.controller.destroy()); const marker = h.group.items[0]; changed = true;
  h.find("map-parking-refresh").click(); await settle(); assert.equal(h.group.items[0], marker);
  assert.equal(marker.getLatLng().lat, 37.568); assert.match(textOf(marker.popup()), /3,600원.*2026-10-09/);
});

test("조회 취소·문서 종료는 늦은 응답이 표시를 되살리지 않도록 한다", async t => {
  let resolve, request;
  const h = await opened((url, options) => url === "/can-proxy-weather" ? defaultFetch(url) : new Promise(done => { resolve = done; request = options; })); t.after(() => h.controller.destroy());
  h.find("map-parking-clear").click(); assert.equal(request.signal.aborted, true); resolve(ok(envelope(fixtures))); await settle(); assert.equal(h.group.items.length, 0); assert.equal(h.controller.captureNote(), "");
  const active = await opened(); active.doc.cleanupFns[0](); assert.equal(active.group.onMap, false); assert.equal(active.listeners.size, 0); assert.equal(active.windowListeners.size, 0); assert.ok(active.removed.includes(active.renderer));
});

test("공공데이터 텍스트는 HTML로 실행되지 않으며 언어 변경·닫기는 재조회하지 않는다", async t => {
  const h = await opened(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([record(1, { prkplceNm:'<img src=x onerror="bad()">', spcmnt:'<script>bad()</script>' })])));
  t.after(() => h.controller.destroy()); const count = h.calls.length, card = h.group.items[0].popup(); assert.match(textOf(card), /<img.*<script>/); assert.equal(tree(card).filter(n => n.tag === "img" || n.tag === "script").length, 0);
  h.find("map-parking-panel").children[0].children[1].click(); assert.equal(h.find("map-parking-panel").hidden, true); assert.equal(h.group.items.length, 1);
  h.find("map-toolvis-parking-fees").click(); assert.equal(h.find("map-parking-panel").hidden, false); h.setEnglish(); assert.match(h.find("map-parking-summary").textContent, /2 h estimate/); assert.equal(h.calls.length, count);
});

test("런처의 고정 API·요청 제한과 지도 묶음·숨김·출처를 등록한다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json")); assert.ok(manifest.localScripts.includes("parking-fees.js")); assert.ok(manifest.scriptDependencies["map-viewer.js"].includes("parking-fees.js"));
  assert.match(read("classdock.html"), /src="src\/js\/parking-fees\.js"/); assert.match(read("src/js/state.js"), /id:"mapParkingFees"/);
  assert.match(read("src/styles.css"), /hide-tool-mapParkingFees \.map-toolvis-parking-fees/); assert.match(read("src/js/map-viewer.js"), /parkingFees && parkingFees\.captureNote\(\)/);
  const backend = read("desktop/launcher.cs"); assert.match(backend, /route == "\/parking-fees" \? "parking"/); assert.match(backend, /operation = "tn_pubr_prkplce_info_api"/);
  assert.match(backend, /kind == "parking"\) return System\.Text\.RegularExpressions\.Regex\.IsMatch/);
  assert.doesNotMatch(read("src/js/parking-fees.js"), /innerHTML|serviceKey|TagoKeyParameter|L\.canvas/); assert.match(api.SOURCE, /15012896/);
});
