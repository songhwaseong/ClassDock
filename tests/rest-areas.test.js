"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const api = require("../src/js/rest-areas.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
// 2026-10-10 실제 키로 받은 줄을 줄여 쓴다(위치 3 · 편의시설 4 · 주유소 4 · 음식 3).
const LOC = [
  { unitName:"서울만남(부산)휴게소", unitCode:"001", routeName:"경부선", routeNo:"0010", xValue:"127.042514", yValue:"37.459939", stdRestCd:"000001", serviceAreaCode:"A00001" },
  { unitName:"죽전(서울)휴게소", unitCode:"002", routeName:"경부선", routeNo:"0010", xValue:"127.104397", yValue:"37.332583", stdRestCd:"000003", serviceAreaCode:"A00002" },
  { unitName:"서울하이패스센터쉼터", unitCode:"192", routeName:"경부선", routeNo:"0010", xValue:"127.102965", yValue:"37.372309", stdRestCd:"000370", serviceAreaCode:"A00192" }
];
const CONV = [
  { direction:"서울", svarAddr:"경기 용인시 죽전2동866-2 ", routeName:"경부선", telNo:"031-262-3168", serviceAreaCode:"A00002", serviceAreaName:"죽전(서울)휴게소", brand:"파스쿠치 외 2", routeCode:"0010", serviceAreaCode2:"000003", convenience:"수유실|농산물판매장", maintenanceYn:"X", truckSaYn:"X" },
  { direction:"청주", serviceAreaCode:"A00195", serviceAreaName:null, telNo:"043-544-1466", brand:"투썸플레이스 외 2", convenience:"수유실|쉼터" },
  { direction:null, routeName:"수도권제1순환선", serviceAreaCode:"A00264", serviceAreaName:"시흥하늘휴게소", telNo:"031-481-9758", brand:"할리스 외 9", routeCode:"1000", serviceAreaCode2:"000530", svarAddr:"경기 시흥시 조남동서울외곽순환고속도로", convenience:"수유실|약국", maintenanceYn:"O", truckSaYn:"O" },
  { direction:"부산", routeName:"경부선", serviceAreaCode:"A00999", serviceAreaName:"새길(부산)휴게소", serviceAreaCode2:"000999", convenience:"" }
];
const GAS = [
  { direction:"부산", routeName:"경부선", serviceAreaName:"서울만남(부산)주유소", oilCompany:"AD", lpgYn:"Y", gasolinePrice:"1,864원", diselPrice:"1,853원", lpgPrice:"1,232원", serviceAreaCode:"B00001" },
  { direction:"인천", routeName:"영동선", serviceAreaName:"덕평(인천)주유소", oilCompany:"SK", lpgYn:"Y", gasolinePrice:"1,998원", diselPrice:"1,987원", lpgPrice:"1,235원", serviceAreaCode:"B00170" },
  { direction:"퇴계원", serviceAreaName:"시흥하늘(일산)주유소", oilCompany:"SK", lpgYn:"N", gasolinePrice:"1,899원", diselPrice:"1,869원", lpgPrice:"1,196원", serviceAreaCode:"B00211" },
  { direction:"판교", serviceAreaName:"시흥하늘(판교)주유소", oilCompany:"SK", lpgYn:"Y", gasolinePrice:"1,899원", diselPrice:"1,869원", lpgPrice:"1,196원", serviceAreaCode:"B00212" }
];
const FOOD = [
  { foodNm:"부산어묵우동", foodCost:"7500", bestfoodyn:"N", recommendyn:"Y", premiumyn:"N" },
  { foodNm:"가락속풀이생라면", foodCost:"6500", bestfoodyn:"N", recommendyn:"N", premiumyn:"N" },
  { foodNm:"용인성산한돈뼈해장국", foodCost:"11000", bestfoodyn:"Y", recommendyn:"Y", premiumyn:"N" }
];
const THEME = [{ stdRestCd:"000003", itemNm:"충절의 고장 죽전", detail:"정몽주 조형물 포토존" }];
const at = Date.UTC(2026, 9, 10, 3);
const body = (list, count = list.length) => JSON.stringify({ count, list, pageNo:1, numOfRows:list.length, message:"인증키가 유효합니다.", code:"SUCCESS" });
const ok = (text, stale = false) => ({ ok:true, headers:{ get:n => n === "X-ClassDock-Fetched-At" ? new Date(at).toISOString() : n === "X-ClassDock-Stale" ? (stale ? "1" : "") : "" }, text:async () => text });
const failure = reason => ({ ok:false, headers:{ get:() => "" }, text:async () => reason });
/* 쪽을 실제처럼 자른다. broken 에 든 줄(0부터)이 쪽 안에 있으면 서버 오류 화면처럼 실패한다. */
function server({ broken = { conveni:[1] }, tables = { loc:LOC, conveni:CONV, gas:GAS } } = {}){
  return async url => {
    if (url === "/can-proxy-expressway") return { ok:true, text:async () => "yes" };
    const q = new URL(url, "http://x").searchParams, kind = q.get("kind"), page = Number(q.get("page")), rows = Number(q.get("rows"));
    if (kind === "food") return ok(body(q.get("code") === "000003" ? FOOD : []));
    if (kind === "theme") return ok(body(q.get("code") === "000003" ? THEME : []));
    const table = tables[kind], start = (page - 1) * rows, end = start + rows;
    if ((broken[kind] || []).some(i => i >= start && i < end)) return failure("expressway-bad-page");
    return ok(body(table.slice(start, end), table.length));
  };
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function harness(fetch = server(), { findPlace = null } = {}){
  const nodes = [], calls = [], listeners = new Map(), windowListeners = new Map(), removed = [], fits = [], views = [], intervals = [];
  let inView = () => true;
  function node(tag){
    const n = { tag, children:[], events:{}, attributes:{}, style:{ setProperty(k, v){ this[k] = v; } }, hidden:false, disabled:false, value:"", textContent:"", checked:false,
      classList:{ toggle(){}, add(){} }, append(...items){ this.children.push(...items); }, replaceChildren(...items){ this.children = items; }, setAttribute(k, v){ this.attributes[k] = v; },
      addEventListener(k, fn){ this.events[k] = fn; }, click(){ this.events.click(); }, focus(){}, remove(){ this.removed = true; } };
    nodes.push(n); return n;
  }
  const group = { items:[], onMap:false, clearLayers(){ this.items = []; }, addTo(){ this.onMap = true; return this; } }, renderer = {};
  const L = { DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} }, svg:options => { renderer.options = options; return renderer; }, layerGroup:() => group,
    circleMarker:(latlng, options) => ({ latlng, options, bindTooltip(fn, o){ this.tip = fn; this.tipOptions = o; return this; }, bindPopup(fn, o){ this.popup = fn; this.popupOptions = o; return this; }, addTo(g){ g.items.push(this); return this; }, openPopup(){ this.opened = true; } }) };
  const center = { lat:37.4, lng:127.05 };
  const map = { createPane:() => node("pane"), getCenter:() => ({ ...center, distanceTo:([lat, lng]) => Math.hypot(lat - center.lat, lng - center.lng) * 111000 }),
    getBounds:() => ({ contains:p => inView(p) }), getZoom:() => 9, setView(p, z){ views.push({ p, z }); }, fitBounds(points, options){ fits.push({ points, options }); }, closePopup(){},
    removeLayer(g){ removed.push(g); g.onMap = false; }, on(k, fn){ listeners.set(k, fn); }, off(k){ listeners.delete(k); } };
  const window = { addEventListener(k, fn){ windowListeners.set(k, fn); }, removeEventListener(k){ windowListeners.delete(k); } };
  const storage = new Map(), localStorage = { getItem:k => storage.has(k) ? storage.get(k) : null, setItem:(k, v) => storage.set(k, String(v)) };
  const context = { module:{ exports:{} }, AbortController, URL, setTimeout, clearTimeout, L, window, localStorage, document:{ createElement:node }, encodeURIComponent,
    setInterval:(fn, ms) => { intervals.push({ fn, ms, live:true }); return intervals.length; }, clearInterval:id => { if (intervals[id - 1]) intervals[id - 1].live = false; },
    fetch:(url, options) => { calls.push({ url, options }); return fetch(url, options); } };
  vm.runInNewContext(read("src/js/rest-areas.js"), context);
  const doc = { cleanupFns:[] }, moduleApi = context.module.exports, controller = moduleApi.mount({ map, stage:node("stage"), toolRow:node("tools"), doc, findPlace });
  return { api:moduleApi, controller, doc, group, renderer, removed, calls, listeners, windowListeners, fits, views, intervals, storage,
    find:cls => nodes.find(n => (n.className || "").split(" ").includes(cls)), checks:() => nodes.filter(n => n.tag === "input"),
    setViewFilter:fn => { inView = fn; }, setEnglish:() => { window.MNI18N = { lang:"en" }; windowListeners.get("mni18nchange")(); } };
}
const opened = async (fetch, options) => { const h = harness(fetch, options); await settle(); h.find("map-toolvis-rest-areas").click(); await settle(); return h; };
const tree = n => n.removed ? [] : [n, ...(n.children || []).flatMap(tree)];
const textOf = n => tree(n).map(v => v.textContent || "").join(" ");
const marker = (h, name) => h.group.items.find(m => textOf(m.tip()).includes(name));

test("응답 봉투의 SUCCESS·키 오류·한도를 가린다", () => {
  assert.equal(api.parse(JSON.parse(body(LOC))).list.length, 3);
  assert.throws(() => api.parse({ code:"ERROR", message:"인증키가 유효하지 않습니다." }), /expressway-key-invalid/);
  assert.throws(() => api.parse({ code:"ERROR", message:"인증키콜수제한. 관리자에게문의하시기바랍니다." }), /expressway-quota/);
  assert.throws(() => api.parse(null), /expressway-bad-page/);
  // 145번째 편의시설 줄처럼 망가진 쪽은 Accept 가 JSON 이면 code 없는 exception 덩어리로 온다(실제 응답).
  assert.throws(() => api.parse({ exception:{ message:"For input string: \"\"" } }), /expressway-bad-page/);
  assert.match(read("desktop/launcher.cs"), /error = "expressway-bad-page"; return false; \}\n\s+data = null;/);
  assert.deepEqual([api.core("서울만남(부산)휴게소"), api.direction("서울만남(부산)휴게소"), api.stem("시흥하늘(일산)주유소")], ["서울만남", "부산", "시흥하늘(일산)"]);
});

test("망가진 쪽은 99 → 11 → 1줄로 쪼개 그 줄만 빼고 받는다", async () => {
  const calls = [], fetch = server({ broken:{ conveni:[1] } });
  const h = harness(async url => { calls.push(url); return fetch(url); });
  const result = await h.api.fetchAll("conveni");
  assert.equal(result.rows.length, 3); assert.equal(result.skipped, 1); assert.equal(result.count, 4);
  assert.deepEqual(calls.filter(u => u.startsWith("/rest-areas?")).map(u => new URL(u, "http://x").searchParams.get("rows")), ["99", "11", "1", "1", "1", "1"]);
  h.controller.destroy();
});

test("뒤쪽 쪽이 망가지면 전체 수를 알고 있으니 쪼갠 쪽을 한꺼번에 묻는다(실제 145번째 줄과 같은 모양)", async () => {
  const many = Array.from({ length:120 }, (_, i) => ({ serviceAreaCode:"A" + String(i).padStart(5, "0"), serviceAreaName:"곳" + i + "휴게소" }));
  const calls = [], fetch = server({ broken:{ conveni:[104] }, tables:{ conveni:many } });
  const h = harness(async url => { if (url.startsWith("/rest-areas?")) calls.push(new URL(url, "http://x").searchParams); return fetch(url); });
  const result = await h.api.fetchAll("conveni");
  assert.equal(result.rows.length, 119); assert.equal(result.skipped, 1);
  assert.deepEqual(calls.map(q => q.get("rows") + "@" + q.get("page")).slice(0, 4), ["99@1", "99@2", "11@10", "11@11"]);
  assert.equal(calls.filter(q => q.get("rows") === "1").length, 11);
  h.controller.destroy();
});

test("위치·편의시설을 코드로 합치고 위치 없는 새 휴게소는 내장 카카오 좌표로 채운다", () => {
  const areas = api.merge(LOC, CONV), by = id => areas.find(a => a.id === id);
  assert.equal(areas.length, 5, "이름 없는 줄은 뺀다");
  assert.equal(by("A00002").brand, "파스쿠치 외 2"); assert.deepEqual(by("A00002").facilities, ["수유실", "농산물판매장"]); assert.equal(by("A00002").direction, "서울");
  assert.equal(by("A00192").kind, "shelter"); assert.equal(by("A00001").facilities.length, 0);
  const sihung = by("A00264");
  assert.deepEqual([sihung.lat, sihung.lng, sihung.located, sihung.std, sihung.truck, sihung.repair], [37.38385, 126.8555, "kakao", "000530", true, true]);
  assert.equal(by("A00999").lat, null);
  assert.equal(api.merge([], [{ ...CONV[2], serviceAreaName:"다른휴게소" }])[0].lat, null, "이름이 다르면 내장 좌표를 쓰지 않는다");
  assert.equal(Object.keys(api.KAKAO_FIXES).length, 42);
  for (const [code, [name, lat, lng]] of Object.entries(api.KAKAO_FIXES)){
    assert.match(code, /^A\d{5}$/); assert.ok(name && lat > 34 && lat < 38.5 && lng > 126 && lng < 130, code);
  }
});

test("주유소는 이름 줄기로, 양방향 휴게소는 방향을 떼고 잇는다", () => {
  const gas = api.attachGas(api.merge(LOC, CONV), GAS);
  assert.equal(gas.get("A00001")[0].gasoline, 1864); assert.equal(gas.get("A00001")[0].lpg, 1232);
  assert.equal(gas.get("A00264").length, 2); assert.equal(gas.get("A00264")[0].lpg, 0, "LPG 를 안 팔면 0");
  assert.equal([...gas.values()].flat().length, 3, "덕평(인천)은 목록에 없어 붙이지 않는다");
  assert.deepEqual(api.foods(FOOD).map(f => f.name), ["용인성산한돈뼈해장국", "부산어묵우동", "가락속풀이생라면"]);
});

test("카카오 검색으로 남은 휴게소를 찾고, 갈래·방향이 안 맞거나 카카오가 없으면 비워 둔다", async () => {
  const docs = [{ place_name:"새길휴게소주유소 부산방향", category_name:"교통,수송 > 주유소", x:"127.5", y:"36.5" },
    { place_name:"새길휴게소 서울방향", category_name:"교통,수송 > 휴게소 > 고속도로휴게소", x:"127.6", y:"36.6" },
    { place_name:"새길휴게소 부산방향", category_name:"교통,수송 > 휴게소 > 고속도로휴게소", x:"127.7", y:"36.7" }];
  assert.deepEqual(api.pickPlace({ documents:docs }, "새길", "부산"), { lat:36.7, lng:127.7 });
  assert.equal(api.pickPlace({ documents:docs.slice(0, 2) }, "새길", "부산"), null);
  const queries = [], areas = api.merge(LOC, CONV);
  assert.equal(await api.locateMissing(areas, async q => { queries.push(q); return { documents:docs }; }), 1);
  assert.deepEqual(queries, ["새길휴게소 부산방향"]); assert.equal(areas.find(a => a.id === "A00999").located, "kakao");
  const none = api.merge(LOC, CONV); assert.equal(await api.locateMissing(none, async () => null), 0); assert.equal(none.find(a => a.id === "A00999").lat, null);
});

test("점·이름표·말풍선의 음식·주유 가격·목록·전국 보기를 연결한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  assert.equal(h.controller.isAvailable(), true); assert.equal(h.group.items.length, 4, "위치를 못 찾은 새길은 빼고 그린다");
  const juk = marker(h, "죽전(서울)휴게소");
  assert.match(textOf(juk.tip()), /죽전\(서울\)휴게소.*경부선 · 서울방향.*파스쿠치 외 2.*수유실 · 농산물판매장/);
  const seoul = marker(h, "서울만남(부산)휴게소"); assert.match(textOf(seoul.tip()), /휘발유 1,864원 · 경유 1,853원 · LPG 1,232원/);
  const popup = juk.popup(); assert.match(textOf(popup), /음식 정보를 받는 중/); await settle();
  assert.match(textOf(popup), /용인성산한돈뼈해장국.*대표.*11,000원.*부산어묵우동.*충절의 고장 죽전/);
  assert.ok(h.calls.some(c => /kind=food&page=1&rows=99&code=000003$/.test(c.url)));
  juk.popup(); await settle(); assert.equal(h.calls.filter(c => /kind=food/.test(c.url)).length, 1, "같은 휴게소 음식은 다시 묻지 않는다");
  const sihung = marker(h, "시흥하늘휴게소"); assert.match(textOf(sihung.popup()), /화물차 휴게소.*경정비.*주유\(퇴계원방향\).*1,899원.*카카오 장소 검색 좌표/);
  assert.equal(marker(h, "서울하이패스센터쉼터").options.fillColor, api.KINDS.shelter.color);
  assert.match(h.find("map-rest-summary").textContent, /전국 4곳 · 화면 안 4곳/);
  h.find("map-rest-list").children[0].children[0].click(); assert.equal(h.views[0].z, 14);
  h.find("map-rest-fit").click(); assert.equal(h.fits[0].points.length, 4);
  assert.match(h.find("map-rest-status").textContent, /자료 받은 때.*1곳 정보 빠짐.*위치를 찾지 못한 1곳 제외/);
  assert.match(h.controller.captureNote(), /한국도로공사 고속도로 공공데이터 포털 · 일부 위치: 카카오 · .*KST/);
  assert.ok(h.storage.has(h.api.CACHE_KEY));
});

test("갈래·화물차·노선 거르기와 지도 이동은 다시 조회하지 않는다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const count = h.calls.length;
  const shelter = h.checks().find(c => c.value === "shelter"); shelter.checked = false; shelter.events.change(); assert.equal(h.group.items.length, 3);
  const route = h.find("map-rest-route"); assert.deepEqual(route.children.map(o => o.value), ["", "경부선", "수도권제1순환선"]);
  route.value = "수도권제1순환선"; route.events.change(); assert.equal(h.group.items.length, 1);
  route.value = ""; route.events.change();
  const truck = h.checks().find(c => !c.value); truck.checked = true; truck.events.change(); assert.equal(h.group.items.length, 1);
  h.setViewFilter(() => false); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140));
  assert.match(textOf(h.find("map-rest-list")), /전국 보기/); assert.equal(h.calls.length, count);
});

test("키 없음·잘못된 키·한도를 안내하고 실패해도 앞 표시를 유지한다", async t => {
  const none = await opened(url => url === "/can-proxy-expressway" ? server()(url) : failure("expressway-key-required")); t.after(() => none.controller.destroy());
  assert.match(none.find("map-rest-status").textContent, /한국도로공사\(고속도로\)/); assert.equal(none.controller.captureNote(), "");
  const wrong = await opened(url => url === "/can-proxy-expressway" ? server()(url) : failure("expressway-key-invalid")); t.after(() => wrong.controller.destroy());
  assert.match(wrong.find("map-rest-status").textContent, /data\.go\.kr\) 키로는/);
  let fail = false; const base = server();
  const h = await opened(url => fail && /kind=loc/.test(url) ? failure("expressway-failed") : base(url)); t.after(() => h.controller.destroy());
  fail = true; h.find("map-rest-refresh").click(); await settle();
  assert.equal(h.group.items.length, 4); assert.match(h.find("map-rest-status").textContent, /앞서 받은 휴게소 표시를 유지/);
  assert.match(h.calls.filter(c => /kind=loc/.test(c.url)).at(-1).url, /refresh=1/);
});

test("편의시설·주유를 못 받아도 위치는 보여 주고, 목록은 이레 기억해 다시 묻지 않는다", async () => {
  const base = server();
  const h = harness(url => /kind=(conveni|gas)/.test(url) ? failure("expressway-failed") : base(url));
  const result = await h.api.loadList(); assert.equal(result.partial, true); assert.equal(result.areas.length, 3);
  assert.equal(h.storage.has(h.api.CACHE_KEY), false, "반쪽 목록은 기억하지 않는다"); h.controller.destroy();
  const g = harness(); await g.api.loadList(); const count = g.calls.length;
  const again = await g.api.loadList(); assert.equal(again.cached, true); assert.equal(g.calls.length, count);
  assert.equal(g.api.readCache(Date.now() + 8 * 86400000), null); g.controller.destroy();
  const p = await opened(url => /kind=gas/.test(url) ? failure("expressway-failed") : base(url)); assert.equal(p.group.items.length, 4);
  assert.match(p.find("map-rest-status").textContent, /주유 가격을 받지 못했어요/); p.controller.destroy();
});

test("켜 둔 동안만 30분마다 주유 가격을 다시 받고 닫기·언어 변경·문서 종료를 정리한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  const timer = h.intervals[0]; assert.equal(timer.ms, 1800000); const count = h.calls.length;
  timer.fn(); await settle(); const added = h.calls.slice(count).map(c => new URL(c.url, "http://x").searchParams.get("kind"));
  assert.ok(added.length && added.every(kind => kind === "gas"), "목록은 다시 받지 않는다");
  assert.ok(h.calls.slice(count).every(c => !/refresh=1/.test(c.url)), "런처 30분 묶음을 그대로 쓴다");
  h.find("map-rest-clear").click(); const after = h.calls.length; timer.fn(); await settle(); assert.equal(h.calls.length, after);
  assert.equal(h.group.onMap, false); assert.equal(h.controller.captureNote(), "");
  h.find("map-rest-refresh").click(); await settle(); h.setEnglish(); assert.match(h.find("map-rest-summary").textContent, /Nationwide: 4 · 4 in view/);
  assert.match(textOf(marker(h, "서울만남(부산)휴게소").tip()), /₩1,864/);
  h.doc.cleanupFns[0](); assert.equal(timer.live, false); assert.equal(h.listeners.size, 0); assert.equal(h.windowListeners.size, 0);
  assert.ok(h.removed.includes(h.renderer)); assert.ok(h.find("map-rest-panel").removed);
});

test("휴게소 묶음·숨김·런처 경로·설정 칸과 인증키 비노출을 등록한다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json")); assert.ok(manifest.localScripts.includes("rest-areas.js"));
  assert.ok(manifest.scriptDependencies["map-viewer.js"].includes("rest-areas.js"));
  assert.match(read("classdock.html"), /src="src\/js\/rest-areas\.js"/); assert.match(read("classdock.html"), /id="settingExpresswayKey"/);
  assert.match(read("src/js/app.js"), /\/expressway-key-status/);
  assert.match(read("src/js/state.js"), /id:"mapRestAreas"/);
  assert.match(read("src/styles.css"), /hide-tool-mapRestAreas \.map-toolvis-rest-areas/);
  const viewer = read("src/js/map-viewer.js");
  assert.match(viewer, /restAreas && restAreas\.captureNote\(\)/); assert.match(viewer, /mapFetchGeocode\(query, "kakao-keyword"\)/);
  const launcher = read("desktop/launcher.cs");
  for (const route of ["/can-proxy-expressway", "/rest-areas?", "/expressway-key-status", "/expressway-key"]) assert.ok(launcher.includes('"' + route), route);
  assert.match(launcher, /https:\/\/data\.ex\.co\.kr\/openapi\//); assert.match(launcher, /rows != 1 && rows != 11 && rows != 99/);
  assert.doesNotMatch(read("src/js/rest-areas.js"), /innerHTML|data\.ex\.co\.kr\/openapi|key=/);
});
