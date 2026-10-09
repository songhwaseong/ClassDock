"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const api = require("../src/js/ev-chargers.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const at = Date.UTC(2026, 9, 9, 5), center = { lat:37.5665, lng:126.978 };
const record = (id, extra = {}) => ({ statId:"S1", chgerId:String(id), statNm:"중구 충전소", zscode:"11140", lat:"37.567", lng:"126.978", chgerType:"04",
  stat:"2", statUpdDt:"20261009135000", limitYn:"N", delYn:"N", output:"100", useTime:"24시간 이용가능", addr:"서울 중구", location:"지하 1층",
  busiNm:"충전 운영기관", busiCall:"1661-0000", parkingFree:"Y", method:"단독", ...extra });
const fixtures = [record(1), record(2, { stat:"3", chgerType:"02", output:"7" }), record(3, { statId:"S2", statNm:"공원 충전소", lat:"37.568", chgerType:"06" }),
  record(4, { statId:"S3", statNm:"입주민 충전소", limitYn:"Y", limitDetail:"입주민 전용" }), record(5, { statId:"S4", lat:"", lng:"" }),
  record(6, { statId:"S5", delYn:"Y" })];
const envelope = (items, total = items.length) => ({ resultCode:"00", resultMsg:"NORMAL SERVICE.", items:{ item:items }, totalCount:total });
const ok = (json, stamp = at, stale = false) => ({ ok:true, headers:{ get:n => n === "X-ClassDock-Bus-Fetched-At" ? new Date(stamp).toISOString() : n === "X-ClassDock-Bus-Stale" ? (stale ? "1" : "0") : "" }, json:async () => json });
const failure = (reason = "bus-key-invalid") => ({ ok:false, headers:{ get:() => "HTTP 403 - 30" }, text:async () => reason });
const defaultFetch = async (url, options, now = at) => url === "/can-proxy-weather" ? { ok:true, text:async () => "yes" } : ok(envelope(url.startsWith("/ev-charger-status") ? [] : fixtures), now);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const districts = [{ code:"11140", sido:"서울특별시", sgg:"중구", name:"서울특별시 중구", contains:(lat, lng) => lat > 37 && lng > 126 },
  { code:"50110", sido:"제주특별자치도", sgg:"제주시", name:"제주특별자치도 제주시", contains:lat => lat < 34 }];
function harness(fetch = defaultFetch, catalog = districts){
  const nodes = [], calls = [], listeners = new Map(), windowListeners = new Map(), removed = [], views = [], timers = new Map();
  let location = { ...center }, now = at, nextTimer = 1;
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
  const map = { createPane:() => node("pane"), getCenter:() => location, getZoom:() => 13,
    setView(point, zoom, options){ views.push({ point, zoom, options }); location = { lat:point[0], lng:point[1] }; if (listeners.has("moveend")) listeners.get("moveend")(); },
    closePopup(){ for (const marker of group.items) marker.opened = false; }, removeLayer(g){ removed.push(g); g.onMap = false; },
    on(k, fn){ listeners.set(k, fn); }, off(k){ listeners.delete(k); } };
  const window = { addEventListener(k, fn){ windowListeners.set(k, fn); }, removeEventListener(k){ windowListeners.delete(k); } };
  const context = { module:{ exports:{} }, AbortController, L, window, document:{ createElement:node },
    setTimeout(fn, delay){ if (delay < 30000) return setTimeout(fn, delay); const id = nextTimer++; timers.set(id, { fn, delay, interval:false }); return id; },
    clearTimeout(id){ if (!timers.delete(id)) clearTimeout(id); },
    setInterval(fn, delay){ const id = nextTimer++; timers.set(id, { fn, delay, interval:true }); return id; }, clearInterval:id => timers.delete(id),
    fetch:(url, options) => { calls.push({ url, options }); return fetch(url, options, now); },
    Date:class extends Date { constructor(...args){ super(...(args.length ? args : [now])); } static now(){ return now; } } };
  vm.runInNewContext(read("src/js/ev-chargers.js"), context);
  const doc = { cleanupFns:[] }, moduleApi = context.module.exports, controller = moduleApi.mount({ map, stage:node("stage"), toolRow:node("tools"), doc, getDistricts:async () => catalog });
  return { api:moduleApi, controller, doc, group, renderer, removed, calls, listeners, windowListeners, views, timers,
    find:cls => nodes.find(n => (n.className || "").split(" ").includes(cls)), setCenter:value => { location = value; }, setNow:value => { now = value; },
    runAuto(){ const entry = [...timers].find(([, v]) => !v.interval); assert.ok(entry); timers.delete(entry[0]); entry[1].fn(); },
    tickAge(){ for (const timer of timers.values()) if (timer.interval) timer.fn(); },
    setEnglish:() => { window.MNI18N = { lang:"en" }; windowListeners.get("mni18nchange")(); } };
}
const opened = async (fetch, catalog) => { const h = harness(fetch, catalog); await settle(); h.find("map-toolvis-ev-chargers").click(); await settle(); return h; };
const tree = n => n.removed ? [] : [n, ...(n.children || []).flatMap(tree)];
const textOf = n => tree(n).map(v => v.textContent || "").join(" ");
const data = (items = fixtures, extra = {}) => ({ ...api.normalize(items, "11140"), checkedAt:at, stale:false, ...extra });
const requests = h => h.calls.filter(c => c.url.startsWith("/ev-"));

test("공식 평면 JSON·단일 항목·빈 결과를 읽고 오류와 잘못된 규모는 거부한다", () => {
  assert.equal(api.rows(envelope(fixtures)).items.length, 6);
  assert.equal(api.rows({ ...envelope([]), items:{ item:record(1) }, totalCount:"1" }).items.length, 1);
  assert.equal(api.rows({ response:{ header:{ resultCode:"0000" }, body:{ items:fixtures, totalCount:6 } } }).total, 6);
  assert.equal(api.rows({ resultCode:"03" }).total, 0);
  for (const value of [null, { resultCode:"30" }, envelope([], -1), envelope([], "bad"), envelope([], 1.5)]) assert.throws(() => api.rows(value), /ev-invalid-data/);
  assert.equal(api.validDistrict("11140"), true);
  for (const value of ["01140", "1114", "111400", "11140&serviceKey=x"]) assert.equal(api.validDistrict(value), false);
});

test("상태 변경 시각은 KST로 해석하며 존재하지 않는 날짜·시간은 거부한다", () => {
  assert.equal(api.stamp("20261009140000"), at);
  assert.equal(api.stamp("20240229000000"), Date.UTC(2024, 1, 28, 15));
  for (const value of ["", null, "20260229000000", "20261309140000", "20261009240000", "20261009146000", "20261009140060", "bad", "202610091400000"]) assert.equal(api.stamp(value), null);
});

test("전체 자료는 충전기 ID로 중복 제거하고 삭제·다른 지역·빈 좌표를 구분한다", () => {
  const items = [record(1), record(1, { statUpdDt:"20261009135500", output:"200" }), record(1, { statUpdDt:"20261008140000", output:"7" }),
    record(2, { delYn:"Y" }), record(2), record(3), record(3, { delYn:"Y" }), record(4, { zscode:"50110" }), record(5, { lat:"", lng:"" })];
  const result = api.normalize(items, "11140"); assert.equal(result.chargers.length, 2); assert.equal(result.deleted, 2); assert.equal(result.other, 1);
  assert.equal(result.chargers[0].power, 200); assert.equal(result.chargers[1].lat, null);
  assert.equal(api.charger({ statId:"S1" }), null);
  for (const extra of [{ lat:"0" }, { lng:"0" }, { lat:"NaN" }, { lng:"140" }]) assert.equal(api.charger(record(1, extra)).lat, null);
  for (const output of ["", "0", "-1", "10001", "bad"]) assert.equal(api.charger(record(1, { output })).power, null);
  assert.equal(api.charger(record(1, { chgerType:"4" })).type, "04");
});

test("충전대기만 사용 가능하며 통신·점검·예약·제한·버스 전용·미등록 커넥터는 제외한다", () => {
  const snapshot = data();
  for (const state of ["0", "1", "2", "3", "4", "5", "6", "9", "99", ""]) assert.equal(api.status(api.charger(record(1, { stat:state })), snapshot, at).available, state === "2");
  for (const extra of [{ limitYn:"Y" }, { limitYn:"" }, { chgerType:"11" }, { chgerType:"99" }, { statUpdDt:"" }, { statUpdDt:"20261009140500" }]) assert.equal(api.status(api.charger(record(1, extra)), snapshot, at).available, false);
  assert.equal(api.status(api.charger(record(1, { statUpdDt:"20200101000000" })), snapshot, at).available, true, "오래된 상태 변경일은 오래된 조회를 뜻하지 않는다");
  for (const extra of [{ checkedAt:at - 300000 }, { checkedAt:at + 1 }, { checkedAt:NaN }, { stale:true }]) assert.equal(api.status(api.charger(record(1)), data(fixtures, extra), at).available, false);
  assert.equal(api.status(api.charger(record(1)), data(fixtures, { checkedAt:at - 299999 }), at).available, true);
});

test("커넥터 복합형은 한 대로 세며 충전소·반경·커넥터별 사용 가능한 대수를 계산한다", () => {
  const snapshot = data(); const found = api.stations(snapshot, center, {}, at);
  assert.deepEqual(found.map(g => [g.id, g.available, g.chargers.length]), [["S1", 1, 2], ["S2", 1, 1]]);
  const ac = api.stations(snapshot, center, { connector:"ac", availableOnly:false }, at); assert.equal(ac.length, 1); assert.equal(ac[0].available, 0);
  const multi = api.stations(snapshot, center, { connector:"chademo" }, at); assert.equal(multi.length, 1); assert.equal(multi[0].chargers.length, 1);
  assert.equal(api.stations(snapshot, center, { availableOnly:false }, at).length, 3);
  assert.equal(api.stations(snapshot, center, { radius:20 }, at).length, 0); assert.equal(api.stations(snapshot, { lat:51.5, lng:-.1 }, {}, at).length, 0);
  assert.equal(api.stations(snapshot, center, {}, at + 300000).length, 0);
  assert.ok(Math.abs(api.distance(center, { lat:37.5675, lng:126.978 }) - 111.195) < .01);
});

test("최근 변경분은 빠진 충전기의 상태를 유지하고 뒤늦은 과거 변경은 덮어쓰지 않는다", () => {
  const baseline = data().chargers;
  const merged = api.merge(baseline, [record(1, { stat:"3", statUpdDt:"20261009135500" }), record(1, { stat:"2", statUpdDt:"20261009135100" }),
    record(2, { stat:"2", statUpdDt:"20261008140000" }), record(9, { statId:"OTHER", stat:"2" })]);
  assert.equal(merged[0].state, "3"); assert.equal(merged[1].state, "3"); assert.equal(merged[2].state, "2"); assert.equal(merged.length, baseline.length);
  const unknown = api.merge(baseline, [record(1, { stat:"2", statUpdDt:"" })]); assert.equal(api.status(unknown[0], data(), at).available, false);
});

test("여러 페이지와 진행률을 끝까지 모으고 최대 페이지·빈 중간 페이지는 일부 결과로 표시한다", async t => {
  const progress = [], h = harness((url, options, now) => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([record(new URL(url, "http://localhost").searchParams.get("page"))], 3), now));
  t.after(() => h.controller.destroy()); const result = await h.api.load("11140", { onProgress:(got, total) => progress.push([got, total]) });
  assert.equal(result.chargers.length, 3); assert.equal(result.complete, true); assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  const large = harness(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([record(new URL(url, "http://localhost").searchParams.get("page"))], 11)));
  t.after(() => large.controller.destroy()); assert.equal((await large.api.load("11140")).complete, false); assert.equal(requests(large).length, 10);
  const empty = harness(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([], 1))); t.after(() => empty.controller.destroy());
  assert.equal((await empty.api.load("11140")).complete, false); assert.equal(requests(empty).length, 1);
});

test("1분 캐시·최근 변경분·8분 전체 재조회로 갱신 공백을 막는다", async t => {
  const h = harness((url, options, now) => url.startsWith("/ev-charger-status") ? ok(envelope([record(1, { stat:"3", statUpdDt:"20261009140100" })]), now) : defaultFetch(url, options, now));
  t.after(() => h.controller.destroy()); const first = await h.api.load("11140"); await h.api.load("11140"); assert.equal(requests(h).length, 1);
  h.setNow(at + 60000); const delta = await h.api.load("11140"); assert.match(requests(h).at(-1).url, /^\/ev-charger-status/); assert.equal(delta.chargers[0].state, "3"); assert.equal(delta.snapshotAt, first.snapshotAt);
  h.setNow(at + 120000); await h.api.load("11140", { refresh:true }); assert.match(requests(h).at(-1).url, /status.*refresh=1/);
  h.setNow(at + 480000); const full = await h.api.load("11140"); assert.match(requests(h).at(-1).url, /^\/ev-chargers/); assert.equal(full.snapshotAt, at + 480000);
  h.setNow(at + 20 * 60000); await h.api.load("11140"); assert.match(requests(h).at(-1).url, /^\/ev-chargers/);
});

test("불완전·오래된 변경분과 갱신 실패 뒤에는 캐시를 버리고 전체 조회로 복구한다", async t => {
  for (const mode of ["partial", "stale", "older", "failure"]){
    let broken = false;
    const h = harness((url, options, now) => {
      if (!broken || !url.startsWith("/ev-charger-status")) return defaultFetch(url, options, now);
      return mode === "failure" ? failure("bus-rate-limit") : ok(envelope([], mode === "partial" ? 1 : 0), mode === "older" ? at - 1 : now, mode === "stale");
    }); t.after(() => h.controller.destroy()); await h.api.load("11140"); broken = true; h.setNow(at + 60000);
    if (mode === "failure") await assert.rejects(h.api.load("11140"), /bus-rate-limit/); else assert.equal((await h.api.load("11140")).stale, true);
    broken = false; await h.api.load("11140"); assert.match(requests(h).at(-1).url, /^\/ev-chargers\?/);
  }
});

test("사용 가능한 대수·상세 상태·출력·주차요금·조회 시각을 표시하고 목록에서 이동한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); assert.equal(h.controller.isAvailable(), true); assert.equal(h.group.items.length, 2);
  assert.equal(h.group.items[0].options.pane, "mapEvChargersPane"); assert.match(textOf(h.group.items[0].tip()), /중구 충전소.*충전 가능 1 \/ 2기.*DC콤보.*AC완속/);
  assert.match(textOf(h.group.items[0].popup()), /주차요금 무료.*마지막 상태 조회.*충전기 1 · 충전 가능.*100 kW.*상태 변경.*충전기 2 · 충전 중.*7 kW/);
  assert.match(h.find("map-ev-summary").textContent, /중구.*3 km.*2곳.*충전 가능 2기/); assert.match(h.find("map-ev-status").textContent, /좌표 미등록 1기 제외/);
  h.find("map-ev-list").children[0].children[0].click(); assert.equal(h.views[0].options.animate, false);
  await new Promise(resolve => setTimeout(resolve, 140)); assert.ok(h.group.items[0].opened); assert.match(h.controller.captureNote(), /한국환경공단.*중구.*KST/);
});

test("커넥터·반경·충전 가능 필터와 지도 이동은 지역 API를 재조회하지 않는다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const count = requests(h).length;
  const available = h.find("map-ev-available"); available.checked = false; available.events.change(); assert.equal(h.group.items.length, 3);
  const connector = h.find("map-ev-connector"); connector.value = "ac"; connector.events.change(); assert.equal(h.group.items.length, 1); assert.equal(h.group.items[0].options.fillColor, "#426bc0");
  h.setCenter({ lat:33.5, lng:126.5 }); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140)); assert.equal(h.group.items.length, 0); assert.equal(requests(h).length, count);
});

test("팝업 자동 이동은 표시 객체와 열린 상세를 유지하며 긴 상세에는 높이 제한을 둔다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const marker = h.group.items[0]; marker.openPopup(); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140));
  assert.ok(h.group.items.includes(marker)); assert.equal(marker.opened, true); assert.equal(marker.popupOptions.maxHeight, 260);
  h.setCenter({ lat:33.5, lng:126.5 }); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140)); assert.ok(h.group.items.includes(marker));
  marker.opened = false; h.listeners.get("popupclose")(); await new Promise(resolve => setTimeout(resolve, 140)); assert.equal(h.group.items.length, 0);
});

test("1분 자동 갱신은 열린 패널에서만 동작하고 닫기·다시 열기·해제·지우기를 따른다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); assert.equal(h.timers.size, 2); h.setNow(at + 60000); h.runAuto(); await settle(); assert.match(requests(h).at(-1).url, /^\/ev-charger-status/);
  h.find("map-ev-panel").children[0].children[1].click(); assert.equal(h.timers.size, 1); const count = requests(h).length;
  h.setNow(at + 120000); h.find("map-toolvis-ev-chargers").click(); await settle(); assert.equal(requests(h).length, count + 1); assert.equal(h.timers.size, 2);
  const automatic = h.find("map-ev-auto"); automatic.checked = false; automatic.events.change(); assert.equal(h.timers.size, 1);
  h.find("map-ev-clear").click(); assert.equal(h.group.items.length, 0); assert.equal(h.controller.captureNote(), "");
});

test("5분 지난 자료의 충전 가능 표시와 열린 옛 상세를 해제한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const marker = h.group.items[0]; marker.openPopup(); h.setNow(at + 300000); h.tickAge();
  assert.equal(marker.opened, false); assert.equal(h.group.items.length, 0); assert.match(h.controller.captureNote(), /최근 상태 확인 필요/);
  const available = h.find("map-ev-available"); available.checked = false; available.events.change(); assert.equal(h.group.items.length, 3);
  assert.ok(h.group.items.every(m => m.options.fillColor === "#7b8794")); assert.match(textOf(h.group.items[0].popup()), /최근 상태 확인 필요/);
});

test("실패한 갱신은 기존 자료를 확인 필요로 바꾸고 승인·한도 오류에서는 자동 조회를 멈춘다", async t => {
  let broken = false; const h = await opened((url, options, now) => broken && url.startsWith("/ev-") ? failure("bus-quota") : defaultFetch(url, options, now)); t.after(() => h.controller.destroy());
  const marker = h.group.items[0]; marker.openPopup(); broken = true; h.find("map-ev-refresh").click(); await settle();
  assert.equal(marker.opened, false); assert.equal(h.group.items.length, 0); assert.match(h.find("map-ev-status").textContent, /오늘 조회 한도/); assert.equal(h.find("map-ev-auto").checked, false); assert.equal(h.timers.size, 1);
  const denied = await opened(url => url === "/can-proxy-weather" ? defaultFetch(url) : failure()); t.after(() => denied.controller.destroy());
  assert.match(denied.find("map-ev-status").textContent, /활용신청 승인.*HTTP 403 - 30/); assert.equal(denied.find("map-ev-auto").checked, false); assert.equal(denied.controller.captureNote(), "");
});

test("지도 중심 지역과 직접 선택한 시군구만 조회하며 지역 선택 실패를 안내한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); h.setCenter({ lat:33.5, lng:126.5 }); h.find("map-ev-center").click(); await settle(); assert.match(requests(h).at(-1).url, /district=50110/);
  const province = h.find("map-ev-province"); province.value = "서울특별시"; province.events.change(); await settle(); assert.match(h.find("map-ev-summary").textContent, /서울특별시 중구/);
  const none = await opened(defaultFetch, []); t.after(() => none.controller.destroy()); assert.match(none.find("map-ev-status").textContent, /시군구를 찾지 못/); assert.equal(requests(none).length, 0);
});

test("조회 취소와 문서 종료는 늦은 응답·타이머·이벤트가 표시를 되살리지 않도록 한다", async t => {
  let resolve, request; const h = await opened((url, options) => url === "/can-proxy-weather" ? defaultFetch(url) : new Promise(done => { resolve = done; request = options; })); t.after(() => h.controller.destroy());
  h.find("map-ev-clear").click(); assert.equal(request.signal.aborted, true); resolve(ok(envelope(fixtures))); await settle(); assert.equal(h.group.items.length, 0);
  const active = await opened(); active.doc.cleanupFns[0](); assert.equal(active.timers.size, 0); assert.equal(active.listeners.size, 0); assert.equal(active.windowListeners.size, 0); assert.ok(active.removed.includes(active.renderer));
});

test("공공데이터 텍스트는 HTML로 실행되지 않고 언어 변경은 다시 조회하지 않는다", async t => {
  const h = await opened((url, options, now) => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([record(1, { statNm:'<img src=x onerror="bad()">', note:'<script>bad()</script>' })]), now));
  t.after(() => h.controller.destroy()); const count = requests(h).length, card = h.group.items[0].popup(); assert.match(textOf(card), /<img.*<script>/); assert.equal(tree(card).filter(n => n.tag === "img" || n.tag === "script").length, 0);
  h.setEnglish(); assert.match(h.find("map-ev-summary").textContent, /stations.*available/); assert.equal(requests(h).length, count);
});

test("런처의 고정 API·요청 제한·평면 응답 처리와 지도 묶음·숨김·출처를 등록한다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json")); assert.ok(manifest.localScripts.includes("ev-chargers.js")); assert.ok(manifest.scriptDependencies["map-viewer.js"].includes("ev-chargers.js"));
  assert.match(read("classdock.html"), /src="src\/js\/ev-chargers\.js"/); assert.match(read("src/js/state.js"), /id:"mapEvChargers"/);
  assert.match(read("src/styles.css"), /hide-tool-mapEvChargers \.map-toolvis-ev-chargers/); assert.match(read("src/js/map-viewer.js"), /evChargers && evChargers\.captureNote\(\)/);
  const backend = read("desktop/launcher.cs"); assert.match(backend, /route == "\/ev-chargers" \? "ev-info"/); assert.match(backend, /operation = kind == "ev-info" \? "getChargerInfo" : "getChargerStatus"/);
  assert.match(backend, /dataType=JSON&numOfRows=5000&pageNo=/); assert.match(backend, /static string EvChargerResultCode\(byte\[\] body\)/);
  assert.doesNotMatch(read("src/js/ev-chargers.js"), /innerHTML|serviceKey|TagoKeyParameter|L\.canvas|localStorage|indexedDB/); assert.match(api.SOURCE, /15076352/);
});
