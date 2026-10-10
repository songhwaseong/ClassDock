"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const api = require("../src/js/road-incidents.js"), coords = require("../src/js/korea-coords.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
// 표본 키로 실제로 받은 봉은교 공사 줄(2026-10-10)을 그대로 쓴다.
const row = (id, extra = {}) => {
  const fields = { acc_id:String(id), occr_date:"20260407", occr_time:"1000", exp_clr_date:"20270301", exp_clr_time:"000000", acc_type:"A04", acc_dtype:"04B01",
    link_id:"1220031600", grs80tm_x:"206076.7132692197", grs80tm_y:"446245.6950463236",
    acc_info:"탄천나들목 및 봉은교 구조개선공사&#13;-일시 : 26.4.7(화)10:00~27.2.28(일) 23:59&#13;-장소 : 봉은교&#13;-통제 : 양방향 전면통제 ", acc_road_code:"009", ...extra };
  return "<row>" + Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join("") + "</row>";
};
const envelope = (rows, total = rows.length, code = "INFO-000") => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><AccInfo><list_total_count>${total}</list_total_count><RESULT><CODE>${code}</CODE><MESSAGE>정상 처리되었습니다</MESSAGE></RESULT>${rows.join("")}</AccInfo>`;
const codes = kind => kind === "main"
  ? `<AccMainCode><list_total_count>2</list_total_count><RESULT><CODE>INFO-000</CODE></RESULT><row><acc_type>A04</acc_type><acc_type_nm>공사</acc_type_nm></row><row><acc_type>A10</acc_type><acc_type_nm>집회및행사</acc_type_nm></row></AccMainCode>`
  : `<AccSubCode><list_total_count>1</list_total_count><RESULT><CODE>INFO-000</CODE></RESULT><row><acc_dtype>04B01</acc_dtype><acc_dtype_nm>시설물보수</acc_dtype_nm></row></AccSubCode>`;
const fixtures = [row(1), row(2, { acc_type:"A01", acc_dtype:"01B01", acc_info:"올림픽대로 추돌사고&#13;-통제 : 2차로 통제", exp_clr_date:"20261010", exp_clr_time:"1500" }),
  row(3, { acc_type:"A10", acc_dtype:"10B01", acc_info:"&lt;img src=x onerror=alert(1)&gt; 마라톤 대회", occr_date:"20261020", grs80tm_x:"198000", grs80tm_y:"451000" }),
  row(4, { grs80tm_x:"", grs80tm_y:"" })];
const at = Date.UTC(2026, 9, 10, 3);
const ok = (body, stamp = at, stale = false) => ({ ok:true, headers:{ get:n => n === "X-ClassDock-Fetched-At" ? new Date(stamp).toISOString() : n === "X-ClassDock-Stale" ? (stale ? "1" : "") : "" }, text:async () => body });
const failure = (reason = "seoul-key-invalid") => ({ ok:false, headers:{ get:() => "" }, text:async () => reason });
const defaultFetch = async url => url === "/can-proxy-seoul-open" ? { ok:true, text:async () => "yes" }
  : /kind=main/.test(url) ? ok(codes("main")) : /kind=sub/.test(url) ? ok(codes("sub")) : ok(envelope(fixtures));
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function harness(fetch = defaultFetch){
  const nodes = [], calls = [], listeners = new Map(), windowListeners = new Map(), removed = [], fits = [], views = [], intervals = [];
  let now = at, inView = () => true;
  function node(tag){
    const n = { tag, children:[], events:{}, attributes:{}, style:{ setProperty(k, v){ this[k] = v; } }, hidden:false, disabled:false, value:"", textContent:"",
      classList:{ toggle(){}, add(){} }, append(...items){ this.children.push(...items); }, replaceChildren(...items){ this.children = items; }, setAttribute(k, v){ this.attributes[k] = v; },
      addEventListener(k, fn){ this.events[k] = fn; }, click(){ this.events.click(); }, focus(){}, remove(){ this.removed = true; } };
    nodes.push(n); return n;
  }
  const group = { items:[], onMap:false, clearLayers(){ this.items = []; }, addTo(){ this.onMap = true; return this; } }, renderer = {};
  const L = { DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} }, svg:options => { renderer.options = options; return renderer; }, layerGroup:() => group,
    circleMarker:(latlng, options) => ({ latlng, options, bindTooltip(fn){ this.tip = fn; return this; }, bindPopup(fn){ this.popup = fn; return this; }, addTo(g){ g.items.push(this); return this; }, openPopup(){ this.opened = true; } }) };
  const center = { lat:37.5157, lng:127.0687 };
  const map = { createPane:() => node("pane"), getCenter:() => ({ ...center, distanceTo:([lat, lng]) => Math.hypot(lat - center.lat, lng - center.lng) * 111000 }),
    getBounds:() => ({ contains:p => inView(p) }), getZoom:() => 12, setView(p, z){ views.push({ p, z }); }, fitBounds(points, options){ fits.push({ points, options }); }, closePopup(){},
    removeLayer(g){ removed.push(g); g.onMap = false; }, on(k, fn){ listeners.set(k, fn); }, off(k){ listeners.delete(k); } };
  const window = { addEventListener(k, fn){ windowListeners.set(k, fn); }, removeEventListener(k){ windowListeners.delete(k); } };
  const storage = new Map(), localStorage = { getItem:k => storage.has(k) ? storage.get(k) : null, setItem:(k, v) => storage.set(k, String(v)) };
  const context = { module:{ exports:{} }, MNKoreaCoords:coords, AbortController, setTimeout, clearTimeout, L, window, localStorage, document:{ createElement:node },
    setInterval:(fn, ms) => { intervals.push({ fn, ms, live:true }); return intervals.length; }, clearInterval:id => { if (intervals[id - 1]) intervals[id - 1].live = false; },
    fetch:(url, options) => { calls.push({ url, options }); return fetch(url, options); },
    Date:class extends Date { constructor(...args){ super(...(args.length ? args : [now])); } static now(){ return now; } } };
  vm.runInNewContext(read("src/js/road-incidents.js"), context);
  const doc = { cleanupFns:[] }, moduleApi = context.module.exports, controller = moduleApi.mount({ map, stage:node("stage"), toolRow:node("tools"), doc });
  return { api:moduleApi, controller, doc, group, renderer, removed, calls, listeners, windowListeners, fits, views, intervals, storage,
    find:cls => nodes.find(n => (n.className || "").split(" ").includes(cls)), checks:() => nodes.filter(n => n.tag === "input"),
    setNow:value => { now = value; }, setViewFilter:fn => { inView = fn; }, setEnglish:() => { window.MNI18N = { lang:"en" }; windowListeners.get("mni18nchange")(); } };
}
const opened = async fetch => { const h = harness(fetch); await settle(); h.find("map-toolvis-road-incidents").click(); await settle(); return h; };
const tree = n => n.removed ? [] : [n, ...(n.children || []).flatMap(tree)];
const textOf = n => tree(n).map(v => v.textContent || "").join(" ");

test("서울 XML 응답의 결과 코드·전체 수·줄과 문자 참조를 읽는다", () => {
  const result = api.parse(envelope(fixtures, 7));
  assert.equal(result.total, 7); assert.equal(result.rows.length, 4);
  assert.equal(result.rows[0].acc_info.split("\r").length, 4); assert.match(result.rows[2].acc_info, /^<img/);
  assert.deepEqual(api.parse(envelope([], 0, "INFO-200")), { rows:[], total:0 });
  assert.throws(() => api.parse(envelope([], 0, "INFO-100")), /seoul-key-invalid/);
  for (const body of ["", "<html>oops</html>", envelope([], 0, "ERROR-500")]) assert.throws(() => api.parse(body), /incidents-invalid-data/);
  assert.equal(api.decode("A&amp;B &#x41; <![CDATA[x<y]]>"), "A&B A x<y");
});

test("중부원점 TM 좌표를 봉은교 위치로 바꾸고 위치 없는 줄은 세어 뺀다", () => {
  const { rows } = api.parse(envelope(fixtures)), result = api.normalize(rows, {}, coords);
  assert.equal(result.incidents.length, 3); assert.equal(result.unlocated, 1);
  const bridge = result.incidents[0];
  assert.ok(Math.abs(bridge.lat - 37.5157) < .001 && Math.abs(bridge.lng - 127.0687) < .001);
  assert.equal(bridge.title, "탄천나들목 및 봉은교 구조개선공사"); assert.equal(bridge.place, "봉은교"); assert.equal(bridge.control, "양방향 전면통제");
  assert.equal(bridge.full, true); assert.equal(bridge.category, "work"); assert.equal(bridge.typeName, "공사");
  assert.equal(bridge.start, "2026-04-07 10:00"); assert.equal(bridge.end, "2027-03-01 00:00");
  assert.equal(result.incidents[1].category, "accident"); assert.equal(result.incidents[1].full, false);
  assert.equal(api.normalize(api.parse(envelope([row(9, { grs80tm_x:"0", grs80tm_y:"0" })])).rows, {}, coords).unlocated, 1, "서울 밖 좌표는 찍지 않는다");
});

test("유형 갈래·날짜·진행 단계를 판정한다", () => {
  assert.equal(api.category("A10", "집회및행사", ""), "event");
  assert.equal(api.category("A99", "", "도로 침수로 통제"), "hazard");
  assert.equal(api.category("A99", "", "알 수 없음"), "other");
  assert.equal(api.stamp("20260230", "1000"), ""); assert.equal(api.stamp("20261010", "930"), "2026-10-10 09:30");
  const incident = { start:"2026-10-10 10:00", end:"2026-10-10 15:00" };
  assert.equal(api.phase(incident, Date.parse("2026-10-10T09:00:00+09:00")), 1);
  assert.equal(api.phase(incident, Date.parse("2026-10-10T12:00:00+09:00")), 0);
  assert.equal(api.phase(incident, Date.parse("2026-10-10T16:00:00+09:00")), 2);
});

test("갈래 색 점·카드·목록·전체 보기와 출처를 연결한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  assert.equal(h.controller.isAvailable(), true); assert.equal(h.group.items.length, 3);
  assert.ok(h.calls.some(c => /^\/road-incidents\?kind=info&page=1$/.test(c.url)));
  assert.ok(h.calls.some(c => /kind=main/.test(c.url)) && h.calls.some(c => /kind=sub/.test(c.url)));
  const bridge = h.group.items.find(m => m.options.radius === 8);
  assert.equal(bridge.options.fillColor, api.CATEGORIES.work.color); assert.equal(bridge.options.weight, 2.5);
  assert.match(textOf(bridge.tip()), /봉은교 구조개선공사.*공사.*시설물보수.*전면 통제.*장소: .*봉은교.*2027-03-01 00:00까지/);
  assert.match(textOf(bridge.popup()), /일시: .*26\.4\.7.*통제 기간: .*2026-04-07 10:00 ~ 2027-03-01 00:00/);
  const event = h.group.items.find(m => m.options.fillColor === api.CATEGORIES.event.color);
  assert.equal(event.options.dashArray, "3 2", "예정된 통제는 점선");
  assert.equal(tree(event.popup()).filter(n => n.tag === "img").length, 0);
  assert.match(h.find("map-incident-summary").textContent, /서울 3곳 · 전면 통제 1곳 · 화면 안 3곳/);
  assert.match(textOf(h.find("map-incident-list").children[0]), /봉은교/, "전면 통제가 먼저");
  h.find("map-incident-list").children[0].children[0].click(); assert.equal(h.views[0].z, 16); assert.equal(bridge.opened, true);
  h.find("map-incident-fit").click(); assert.equal(h.fits[0].points.length, 3);
  assert.match(h.find("map-incident-status").textContent, /자료 받은 때.*위치를 읽지 못한 1건 제외/);
  assert.match(h.controller.captureNote(), /서울 열린데이터광장 실시간 돌발정보.*KST/);
});

test("갈래·예정 거르기와 지도 이동은 다시 조회하지 않는다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const count = h.calls.length;
  const work = h.checks().find(c => c.value === "work"); work.checked = false; work.events.change(); assert.equal(h.group.items.length, 2);
  const upcoming = h.checks().find(c => !c.value); upcoming.checked = false; upcoming.events.change(); assert.equal(h.group.items.length, 1);
  h.setViewFilter(() => false); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140));
  assert.match(textOf(h.find("map-incident-list")), /서울 전체 보기/); assert.equal(h.calls.length, count);
});

test("키 없음·잘못된 키를 안내하고 실패해도 앞 표시를 유지한다", async t => {
  const none = await opened(url => url === "/can-proxy-seoul-open" ? defaultFetch(url) : failure("seoul-key-required")); t.after(() => none.controller.destroy());
  assert.match(none.find("map-incident-status").textContent, /서울 열린데이터\(일반\)/); assert.equal(none.controller.captureNote(), "");
  const wrong = await opened(url => url === "/can-proxy-seoul-open" ? defaultFetch(url) : failure()); t.after(() => wrong.controller.destroy());
  assert.match(wrong.find("map-incident-status").textContent, /지하철 실시간 키로는/);
  let fail = false;
  const h = await opened(url => fail && /kind=info/.test(url) ? failure("seoul-failed") : defaultFetch(url)); t.after(() => h.controller.destroy());
  fail = true; h.find("map-incident-refresh").click(); await settle();
  assert.equal(h.group.items.length, 3); assert.match(h.find("map-incident-status").textContent, /앞서 받은 돌발정보를 유지/);
  assert.match(h.calls.at(-1).url, /refresh=1/);
});

test("코드표를 못 받아도 내장 유형 이름으로 목록을 보여 주고, 받으면 이레 기억한다", async () => {
  const h = harness(url => /kind=(main|sub)/.test(url) ? failure("seoul-failed") : defaultFetch(url));
  const result = await h.api.load(); assert.equal(result.incidents[0].typeName, "공사"); assert.equal(result.incidents[0].dtypeName, "");
  h.controller.destroy();
  const g = harness(); const loaded = await g.api.load(); assert.equal(loaded.incidents[0].dtypeName, "시설물보수");
  assert.ok(g.storage.has(g.api.CODE_CACHE_KEY)); assert.equal(g.api.readCodes(at).sub["04B01"], "시설물보수");
  assert.equal(g.api.readCodes(at + 8 * 86400000), null); g.controller.destroy();
});

test("여러 쪽을 이어 받되 상한에서 멈추고 오래된 자료를 알린다", async () => {
  const many = harness(url => /kind=info/.test(url) ? ok(envelope(Array.from({ length:3 }, (_, i) => row(Number(new URL(url, "http://x").searchParams.get("page")) * 10 + i)), 99999), at, true) : defaultFetch(url));
  const result = await many.api.load(); assert.equal(many.calls.filter(c => /kind=info/.test(c.url)).length, 5);
  assert.equal(result.complete, false); assert.equal(result.stale, true); assert.equal(result.incidents.length, 15); many.controller.destroy();
});

test("켜 둔 동안만 5분마다 조용히 갱신하고 닫기·언어 변경·문서 종료를 정리한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  const timer = h.intervals[0]; assert.equal(timer.ms, 300000); const count = h.calls.length;
  timer.fn(); await settle(); assert.ok(h.calls.length > count);
  h.find("map-incident-clear").click(); const after = h.calls.length; timer.fn(); await settle(); assert.equal(h.calls.length, after);
  assert.equal(h.group.onMap, false); assert.equal(h.controller.captureNote(), "");
  h.find("map-incident-refresh").click(); await settle(); h.setEnglish(); assert.match(h.find("map-incident-summary").textContent, /Seoul: 3 incidents · 1 full closures/);
  h.doc.cleanupFns[0](); assert.equal(timer.live, false); assert.equal(h.listeners.size, 0); assert.equal(h.windowListeners.size, 0);
  assert.ok(h.removed.includes(h.renderer)); assert.ok(h.find("map-incident-panel").removed);
});

test("돌발·통제 묶음·숨김·런처 경로·설정 칸과 인증키 비노출을 등록한다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json")); assert.ok(manifest.localScripts.includes("road-incidents.js"));
  assert.ok(manifest.scriptDependencies["map-viewer.js"].includes("road-incidents.js")); assert.ok(manifest.scriptDependencies["road-incidents.js"].includes("korea-coords.js"));
  assert.match(read("classdock.html"), /src="src\/js\/road-incidents\.js"/); assert.match(read("classdock.html"), /id="settingSeoulOpenKey"/);
  assert.match(read("src/js/state.js"), /id:"mapRoadIncidents"/);
  assert.match(read("src/styles.css"), /hide-tool-mapRoadIncidents \.map-toolvis-road-incidents/);
  assert.match(read("src/js/map-viewer.js"), /roadIncidents && roadIncidents\.captureNote\(\)/);
  const launcher = read("desktop/launcher.cs");
  for (const route of ["/can-proxy-seoul-open", "/road-incidents?", "/seoul-open-key-status", "/seoul-open-key"]) assert.ok(launcher.includes('"' + route), route);
  assert.match(launcher, /http:\/\/openapi\.seoul\.go\.kr:8088\//); assert.match(launcher, /"\/xml\/"/);
  assert.doesNotMatch(read("src/js/road-incidents.js"), /innerHTML|openapi\.seoul|serviceKey/);
});
