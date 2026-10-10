"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const tour = require("../src/js/tourism-map.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const at = Date.UTC(2026, 9, 9, 1, 20), dates = tour.week(at);
const place = (id, overrides = {}) => ({ contentid:String(id), contenttypeid:"12", title:"관광지 " + id, mapx:"126.978", mapy:"37.5665", addr1:"서울 중구", ...overrides });
const nearbyRows = [place(101, { firstimage:"http://tong.visitkorea.or.kr/cms/resource/30/3077530_image2_1.JPG", firstimage2:"https://tong.visitkorea.or.kr/cms/resource/30/3077530_image3_1.JPG" }), place(102, { mapx:"127.01", title:"먼 관광지" })];
const festival = (id, start = "20260920", end = "20261011", overrides = {}) => place(id, { contenttypeid:"15", title:"축제 " + id, eventstartdate:start, eventenddate:end, ...overrides });
const festivalRows = [festival(201), festival(202, "20261012", "20261013"), festival(203, "20261001", "20261004"),
  festival(204, "20261001", "20261005"), festival(205, "20261005", "20261011", { progresstype:"행사연기" }),
  festival(206, "20261010", "20261011", { mapx:"0", mapy:"0" })];
const envelope = (items, total = items.length) => ({ response:{ header:{ resultCode:"0000", resultMsg:"OK" }, body:{ items:{ item:items }, totalCount:total } } });
const ok = (body, stamp = at) => ({ ok:true, headers:{ get:() => new Date(stamp).toISOString() }, json:async () => body });
const failed = reason => ({ ok:false, text:async () => reason });
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const defaultFetch = async url => {
  if (url === "/can-proxy-weather") return { ok:true, text:async () => "yes" };
  const query = new URL(url, "http://localhost").searchParams;
  if (url.startsWith("/tourism-common")) return ok(envelope([{ contentid:query.get("id"), overview:"설명<br>두 번째 줄", homepage:'<a href="https://example.org/visit">홈페이지</a>' }]));
  if (url.startsWith("/tourism-intro")) return ok(envelope([{ contentid:query.get("id"), contenttypeid:query.get("type"), usetime:"09:00~18:00", playtime:"10:00~20:00", usetimefestival:"무료" }]));
  return ok(envelope(url.startsWith("/tourism-festivals") ? festivalRows : nearbyRows));
};
// 브라우저·화면 캡처 없이 네트워크와 지도 층의 생명주기를 검증한다.
function harness(fetch = defaultFetch){
  const nodes = [], listeners = new Map(), windowListeners = new Map(), intervals = new Map(), removed = [], calls = [], views = [], fits = [];
  let now = at, center = { lat:37.5665, lng:126.978 }, inView = () => true;
  function node(tag){
    const n = { tag, style:{}, children:[], events:{}, attributes:{}, hidden:false, disabled:false, value:"", textContent:"",
      classList:{ toggle(){}, add(cls){ n.className += " " + cls; } }, append(...items){ this.children.push(...items); }, appendChild(n){ this.children.push(n); },
      replaceChildren(...items){ this.children = items; }, setAttribute(k, v){ this.attributes[k] = v; },
      addEventListener(k, fn){ this.events[k] = fn; }, click(){ this.events.click(); }, focus(){}, remove(){ this.removed = true; } };
    nodes.push(n); return n;
  }
  const group = { items:[], onMap:false, clearLayers(){ this.items = []; }, addTo(){ this.onMap = true; return this; } }, renderer = {};
  const L = { DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} }, svg:options => { renderer.options = options; return renderer; }, layerGroup:() => group,
    circleMarker:(point, options) => ({ point, options, events:{}, positionUpdates:0,
      bindTooltip(fn){ this.tip = () => { if (this.currentTip) this.currentTip.isConnected = false; const card = fn(); card.isConnected = true; this.currentTip = card; return card; }; return this; },
      // Leaflet의 update()는 내용 함수를 다시 호출하고 setLatLng()는 현재 내용의 위치만 바꾼다.
      getTooltip(){ return { update:() => { this.positionUpdates++; this.tip(); }, getLatLng:() => this.point,
        setLatLng:point => { this.positionUpdates++; this.positionPoint = point; }, getElement:() => ({ contains:n => n === this.currentTip }) }; },
      setStyle(style){ Object.assign(this.options, style); }, bringToFront(){ this.front = true; },
      addTo(g){ g.items.push(this); return this; }, on(k, fn){ this.events[k] = fn; return this; } }) };
  const map = { createPane:() => node("pane"), getZoom:() => 8, setView(point, zoom){ views.push([point, zoom]); }, fitBounds(points, options){ fits.push({ points, options }); }, closePopup(){},
    getCenter:() => ({ ...center, distanceTo:([lat, lng]) => Math.hypot(lat - center.lat, lng - center.lng) * 111000 }), getBounds:() => ({ contains:inView }),
    removeLayer(g){ g.onMap = false; removed.push(g); }, on(k, fn){ listeners.set(k, fn); }, off(k){ listeners.delete(k); } };
  const window = { addEventListener(k, fn){ windowListeners.set(k, fn); }, removeEventListener(k){ windowListeners.delete(k); } };
  const context = { module:{ exports:{} }, AbortController, URL, URLSearchParams, setTimeout, clearTimeout, L, window, document:{ createElement:node },
    fetch:(url, options) => { calls.push({ url, options }); return fetch(url, options); },
    setInterval:fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; }, clearInterval:id => intervals.delete(id),
    Date:class extends Date { constructor(...args){ super(...(args.length ? args : [now])); } static now(){ return now; } } };
  vm.runInNewContext(read("src/js/tourism-map.js"), context);
  const doc = { cleanupFns:[] }, api = context.module.exports, controller = api.mount({ map, stage:node("stage"), toolRow:node("tools"), doc });
  return { api, controller, doc, group, renderer, removed, calls, listeners, windowListeners, intervals, views, fits,
    find:cls => nodes.find(n => (n.className || "").split(" ").includes(cls)), setViewFilter:fn => { inView = fn; },
    setNow:value => { now = value; }, setCenter:value => { center = value; }, setEnglish:() => { window.MNI18N = { lang:"en" }; windowListeners.get("mni18nchange")(); } };
}
const opened = async fetch => { const h = harness(fetch); await settle(); h.find("map-toolvis-tourism").click(); await settle(); return h; };
const tree = n => n.removed ? [] : [n, ...(n.children || []).flatMap(tree)];
const textOf = n => tree(n).map(v => v.textContent || "").join(" ");
const part = (n, cls) => tree(n).find(v => (v.className || "").split(" ").includes(cls));

test("KST 월~일을 계산하며 UTC 일요일 밤, 연말, 윤년 날짜 경계를 처리한다", () => {
  assert.deepEqual(dates, { start:"20261005", end:"20261011", today:"20261009" });
  assert.equal(tour.week(Date.parse("2026-10-11T14:59:59Z")).start, "20261005");
  assert.equal(tour.week(Date.parse("2026-10-11T15:00:00Z")).start, "20261012");
  assert.deepEqual(tour.week(Date.parse("2026-12-31T15:00:00Z")), { start:"20261228", end:"20270103", today:"20270101" });
  assert.equal(tour.date("20240229"), "20240229");
  for (const value of ["20260229", "20260230", "20261301", "20260001", "", "NaN"]) assert.equal(tour.date(value), "");
});

test("이번 주와 겹친 진행 중 행사·양끝 날짜를 포함하고 취소·연기·다른 주는 제외한다", () => {
  const result = tour.normalize(festivalRows, { kind:"festivals", ...dates });
  assert.deepEqual(result.places.map(p => p.id), ["201", "204", "206"]);
  assert.equal(result.excluded, 1); assert.equal(result.places[2].lat, null);
  assert.equal(tour.normalize([festival(301, "20261011", "20261011")], { kind:"festivals", ...dates }).places.length, 1);
  assert.equal(tour.normalize([festival(302, "20261008", "20261001")], { kind:"festivals", ...dates }).places.length, 0);
});

test("mapX는 경도·mapY는 위도이고 좌표가 없는 축제는 목록에 남으며 중복 콘텐츠를 합친다", () => {
  assert.deepEqual([tour.place(place(101)).lat, tour.place(place(101)).lng], [37.5665, 126.978]);
  for (const coords of [{ mapy:"126.978", mapx:"37.5" }, { mapy:"NaN", mapx:"127" }, { mapy:"0", mapx:"0" }]) assert.equal(tour.place(place(101, coords)).lat, null);
  assert.equal(tour.place(place(101, { contentid:"1&url=other" })), null);
  assert.equal(tour.normalize([place(101), place(101), place(102, { contenttypeid:"39" })], { kind:"nearby", type:"12" }).places.length, 1);
});

test("대표사진·썸네일을 보존하고 공식 사진 서버의 HTTP만 HTTPS로 바꾸며 다른 주소는 거절한다", () => {
  const p = tour.place(nearbyRows[0]);
  assert.equal(p.photo, "https://tong.visitkorea.or.kr/cms/resource/30/3077530_image2_1.JPG");
  assert.equal(p.thumbnail, nearbyRows[0].firstimage2);
  assert.equal(tour.photoUrl("http://tong.visitkorea.or.kr/cms/resource/94/2932494_image2_1.bmp"),
    "https://tong.visitkorea.or.kr/cms/resource/94/2932494_image2_1.bmp");
  for (const url of ["javascript:alert(1)", "data:image/png;base64,AAAA", "https://example.org/photo.jpg", "https://tong.visitkorea.or.kr.evil.org/cms/resource/photo.jpg",
    "https://user:password@tong.visitkorea.or.kr/cms/resource/photo.jpg", "https://tong.visitkorea.or.kr:444/cms/resource/photo.jpg",
    "https://tong.visitkorea.or.kr/cms/resource/photo.svg", "https://tong.visitkorea.or.kr/cms/resource/photo.jpg?token=secret", "https://tong.visitkorea.or.kr/other/photo.jpg"]){
    assert.equal(tour.photoUrl(url), "", url);
  }
});

test("사진 카드는 실제 사진·갈래·거리를 표시하며 원본 실패 때 썸네일, 모두 실패 때 텍스트로 돌아간다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  const marker = h.group.items[0], count = h.calls.length, card = marker.tip(), img = part(card, "map-tour-tip-photo");
  assert.equal(img.src, tour.place(nearbyRows[0]).photo); assert.equal(img.alt, nearbyRows[0].title);
  assert.equal(img.referrerPolicy, "no-referrer"); assert.equal(part(card, "map-tour-tip-name").textContent, nearbyRows[0].title);
  assert.equal(part(card, "map-tour-tip-category").textContent, "관광지");
  assert.equal(part(card, "map-tour-tip-distance").textContent, "0.0 km");
  assert.equal(part(card, "map-tour-tip-distance").title, "지도 중심 기준");
  img.events.error(); assert.equal(img.src, nearbyRows[0].firstimage2);
  img.events.load(); assert.equal(part(card, "map-tour-tip-media").hidden, false);
  assert.ok(marker.currentTip === card, "사진을 불러온 카드가 위치 보정 때문에 새 카드로 바뀌면 안 된다");
  assert.equal(part(card, "map-tour-tip-credit").hidden, false); assert.match(part(card, "map-tour-tip-credit").textContent, /한국관광공사/);
  assert.equal(part(card, "map-tour-tip-icon").hidden, true); assert.equal(marker.positionUpdates, 1);
  const fallback = marker.tip(), failedImage = part(fallback, "map-tour-tip-photo"); failedImage.events.error(); failedImage.events.error();
  assert.equal(part(fallback, "map-tour-tip-media").hidden, true); assert.equal(part(fallback, "map-tour-tip-credit").hidden, true);
  assert.equal(part(fallback, "map-tour-tip-icon").hidden, false); assert.equal(marker.positionUpdates, 2);
  const noPhoto = h.group.items[1].tip(); assert.equal(part(noPhoto, "map-tour-tip-photo"), undefined);
  assert.equal(part(noPhoto, "map-tour-tip-icon").hidden, false); assert.equal(h.calls.length, count);
  // 닫히거나 새 카드로 바뀐 툴팁의 뒤늦은 이미지 응답이 현재 카드 위치를 바꾸지 않는다.
  img.events.load(); assert.equal(marker.positionUpdates, 2); h.controller.destroy(); failedImage.events.load(); assert.equal(marker.positionUpdates, 2);
});

test("정상 사진이 로드된 카드를 유지하고 다음 마우스 진입에는 새 지도 중심의 거리를 표시한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  const marker = h.group.items[0], count = h.calls.length, card = marker.tip(), img = part(card, "map-tour-tip-photo");
  img.events.load();
  assert.ok(marker.currentTip === card, "정상 로드된 사진의 DOM을 그대로 유지해야 한다");
  assert.equal(part(marker.currentTip, "map-tour-tip-media").hidden, false);
  assert.deepEqual(marker.positionPoint, marker.point); assert.equal(marker.positionUpdates, 1);
  h.setCenter({ lat:37.5665, lng:126.988 });
  const nextCard = marker.tip(); assert.notEqual(nextCard, card);
  assert.equal(part(nextCard, "map-tour-tip-distance").textContent, "1.1 km");
  part(nextCard, "map-tour-tip-photo").events.load();
  assert.ok(marker.currentTip === nextCard); assert.equal(part(nextCard, "map-tour-tip-media").hidden, false);
  assert.equal(marker.positionUpdates, 2); assert.equal(h.calls.length, count);
});

test("TourAPI 0000·일반 00·단일 행·자료 없음 응답을 읽고 오류는 거절한다", () => {
  assert.deepEqual(tour.rows(envelope(nearbyRows)).items, nearbyRows);
  assert.equal(tour.rows({ header:{ resultCode:"00" }, body:{ items:{ item:place(101) } } }).items.length, 1);
  assert.equal(tour.rows({ response:{ header:{ resultCode:"03" } } }).total, 0);
  assert.equal(tour.rows(envelope([])).items.length, 0);
  assert.throws(() => tour.rows({ response:{ header:{ resultCode:"0030" }, body:{} } }), /tour-invalid-data/);
});

test("HTML 설명을 글자로만 풀고 javascript·data·자격 증명이 있는 홈페이지는 거절한다", () => {
  assert.equal(tour.plain('첫 줄<br>둘째 &amp; &#54620; &#xAE00;<script>alert(1)</script><style>bad</style>'), "첫 줄\n둘째 & 한 글");
  assert.equal(tour.homepage('<a href="https://example.org/?a=1&amp;b=2">링크</a>'), "https://example.org/?a=1&b=2");
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "https://user:secret@example.org/", "/relative"]) assert.equal(tour.homepage(url), "");
  assert.doesNotMatch(read("src/js/tourism-map.js"), /innerHTML|serviceKey|TagoKeyParameter/);
});

test("관광 점·가까운 목록·상세·축제 일정·누락 위치·출처를 연결하며 지도 이동은 조회하지 않는다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  assert.equal(h.controller.isAvailable(), true); assert.equal(h.group.items.length, 2);
  assert.deepEqual(Array.from(h.group.items[0].point), [37.5665, 126.978]);
  assert.match(h.calls[1].url, /lat=37\.5665&lng=126\.9780&radius=5000&type=12&page=1/);
  h.find("map-tour-list").children[0].children[0].click(); await settle();
  assert.equal(h.views[0][1], 14); assert.equal(h.group.items[0].popup, undefined);
  assert.equal(h.group.items[0].options.radius, 9); assert.equal(h.group.items[0].options.bubblingMouseEvents, false);
  assert.match(textOf(h.find("map-tour-details")), /관광지 101.*09:00~18:00.*두 번째 줄/s);
  assert.equal(h.find("map-tour-homepage").href, "https://example.org/visit");
  h.group.items[1].events.click(); await settle();
  assert.equal(h.group.items[0].options.radius, 6); assert.equal(h.group.items[1].options.radius, 9); assert.match(textOf(h.find("map-tour-details")), /먼 관광지/);
  h.find("map-tour-details").children[0].children[1].click(); assert.equal(h.group.items[1].options.radius, 6);
  h.group.items[0].events.click(); await settle(); assert.equal(h.find("map-tour-details").hidden, false);
  h.group.items[0].events.click(); assert.equal(h.find("map-tour-details").hidden, true); assert.equal(h.group.items[0].options.radius, 6);
  h.group.items[0].events.click(); await settle(); assert.equal(h.find("map-tour-details").hidden, false); assert.equal(h.group.items[0].options.radius, 9);
  h.find("map-tour-festivals").click(); await settle();
  assert.equal(h.group.items.length, 2); assert.ok(h.group.items.every(m => m.options.fillColor === "#8b4ec6"));
  assert.match(h.find("map-tour-summary").textContent, /2026\.10\.05.*2026\.10\.11.*3곳.*위치 미등록 1곳/);
  assert.match(h.find("map-tour-status").textContent, /취소·연기 1건 제외/);
  assert.match(textOf(h.group.items[0].tip()), /진행 중.*2026\.09\.20/s);
  assert.match(textOf(h.group.items[1].tip()), /행사 종료/);
  const oldCalls = h.calls.length; h.setViewFilter(() => false); h.listeners.get("moveend")(); await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(h.calls.length, oldCalls); assert.match(h.find("map-tour-summary").textContent, /화면 안 0곳/);
  h.find("map-tour-fit").click(); assert.equal(h.fits[0].points.length, 2);
  assert.match(h.controller.captureNote(), /이번 주 축제.*2026\.10\.05.*TourAPI/);
});

test("조회 페이지를 끝까지 받되 관광 300곳 상한에서는 일부 목록임을 표시한다", async t => {
  const h = harness(async url => url === "/can-proxy-weather" ? { ok:true, text:async () => "yes" }
    : ok(envelope(Array.from({ length:100 }, (_, i) => place(Number(new URL(url, "http://localhost").searchParams.get("page")) * 100 + i)), 400)));
  t.after(() => h.controller.destroy()); await settle(); h.find("map-toolvis-tourism").click(); await settle();
  assert.equal(h.group.items.length, 300); assert.match(h.find("map-tour-status").textContent, /일부만 표시/);
  assert.equal(h.calls.filter(c => c.url.startsWith("/tourism-nearby")).length, 3);
});

test("닫기는 표시를 유지하고 다시 열 때 캐시를 쓰며 지우기·문서 닫기는 자원을 정리한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy()); const toggle = h.find("map-toolvis-tourism");
  h.find("map-weather-heading").children[1].click(); assert.equal(h.group.onMap, true);
  toggle.click(); assert.equal(h.find("map-tour-panel").hidden, false); assert.equal(h.calls.length, 2);
  toggle.click(); assert.equal(h.group.onMap, false); assert.equal(h.controller.captureNote(), ""); assert.ok(h.removed.includes(h.renderer));
  toggle.click(); await settle(); assert.equal(h.calls.length, 2);
  h.doc.cleanupFns[0](); assert.equal(h.listeners.size, 0); assert.equal(h.windowListeners.size, 0); assert.equal(h.intervals.size, 0);
  assert.equal(h.find("map-tour-panel").removed, true);
});

test("조회 취소 후 늦게 도착한 응답은 지운 표시를 되살리지 않는다", async t => {
  let resolve, signal; const pending = new Promise(r => { resolve = r; });
  const h = harness((url, options) => url === "/can-proxy-weather" ? defaultFetch(url) : (signal = options.signal, pending));
  t.after(() => h.controller.destroy()); await settle(); h.find("map-toolvis-tourism").click(); h.find("map-tour-clear").click();
  assert.equal(signal.aborted, true); resolve(ok(envelope(nearbyRows))); await settle();
  assert.equal(h.group.items.length, 0); assert.equal(h.controller.captureNote(), "");
});

test("상세 선택이 바뀌면 이전 조회를 취소하며 인증 오류를 원인별로 안내한다", async t => {
  let resolve, firstSignal;
  const h = await opened((url, options) => {
    if (url.startsWith("/tourism-common?id=101")){ firstSignal = options.signal; return new Promise(r => { resolve = r; }); }
    return defaultFetch(url);
  }); t.after(() => h.controller.destroy());
  const list = h.find("map-tour-list"); list.children[0].children[0].click(); list.children[1].children[0].click(); await settle();
  assert.equal(firstSignal.aborted, true); resolve(ok(envelope([{ contentid:"101", overview:"이전 내용" }]))); await settle();
  assert.match(textOf(h.find("map-tour-details")), /먼 관광지/); assert.doesNotMatch(textOf(h.find("map-tour-details")), /이전 내용/);
  assert.match(tour.failureText({ message:"bus-key-required" }), /설정 → 연결/);
  assert.match(tour.failureText({ message:"bus-key-invalid" }), /국문 관광정보 서비스/);
  assert.match(tour.failureText({ message:"bus-quota" }), /조회 한도/);
});

test("갱신 실패는 이전 자료·출처를 유지하고 캐시 만료는 수신 시각을 기준으로 판단한다", async t => {
  let fail = false;
  const h = await opened(url => fail && url.startsWith("/tourism-nearby") ? failed("bus-key-invalid") : defaultFetch(url)); t.after(() => h.controller.destroy());
  fail = true; h.find("map-tour-refresh").click(); await settle();
  assert.equal(h.group.items.length, 2); assert.match(h.find("map-tour-status").textContent, /활용신청.*유지합니다/);
  assert.match(h.controller.captureNote(), /관광지.*5 km/);
  fail = false; h.setNow(at + 3600001); h.find("map-tour-search").click(); await settle();
  assert.equal(h.calls.filter(c => c.url.startsWith("/tourism-nearby")).length, 3);
});

test("주가 바뀌면 새 주간을 한 번 요청하며 실패한 자료는 이전 주로 구분한다", async t => {
  let fail = false;
  const h = await opened(url => fail && url.startsWith("/tourism-festivals") ? failed("bus-quota") : defaultFetch(url)); t.after(() => h.controller.destroy());
  h.find("map-tour-festivals").click(); await settle(); fail = true; h.setNow(Date.parse("2026-10-11T15:00:00Z"));
  for (const fn of h.intervals.values()) fn(); await settle();
  const count = h.calls.length; for (const fn of h.intervals.values()) fn(); await settle();
  assert.equal(h.calls.length, count); assert.match(h.find("map-tour-summary").textContent, /이전 주 축제/);
  assert.match(h.controller.captureNote(), /이전 주 축제/);
  assert.match(h.calls[count - 1].url, /start=20261012&end=20261018/);
});

test("HTML 이름은 글자로 표시하고 국내 지도에서만 관광을 조회한다", async t => {
  const unsafe = '<img src=x onerror="alert(1)">';
  const h = await opened(url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([place(101, { title:unsafe })]))); t.after(() => h.controller.destroy());
  assert.equal(part(h.group.items[0].tip(), "map-tour-tip-name").textContent, unsafe);
  h.setCenter({ lat:51.5, lng:-.1 }); const count = h.calls.length; h.find("map-tour-search").click(); await settle();
  assert.equal(h.calls.length, count); assert.match(h.find("map-tour-status").textContent, /대한민국/);
});

test("부분 소개 조회 실패는 설명을 유지하고 다른 콘텐츠의 상세는 붙이지 않는다", async t => {
  const h = harness(url => url.startsWith("/tourism-intro") ? failed("bus-quota") : defaultFetch(url)); t.after(() => h.controller.destroy());
  const result = await h.api.details(tour.place(nearbyRows[0])); assert.equal(result.base.contentid, "101"); assert.equal(result.introError.message, "bus-quota");
  const wrong = harness(async url => url === "/can-proxy-weather" ? defaultFetch(url) : ok(envelope([{ contentid:"999" }]))); t.after(() => wrong.controller.destroy());
  await assert.rejects(wrong.api.details(tour.place(nearbyRows[0])), /tour-no-details/);
});

test("관광·축제 번들·숨김 설정·고정 프록시 경로·출처를 등록한다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json"));
  assert.ok(manifest.localScripts.includes("tourism-map.js")); assert.ok(manifest.scriptDependencies["map-viewer.js"].includes("tourism-map.js"));
  assert.match(read("classdock.html"), /src="src\/js\/tourism-map\.js"/);
  assert.match(read("src/js/state.js"), /id:"mapTourism"/); assert.match(read("src/styles.css"), /hide-tool-mapTourism \.map-toolvis-tourism/);
  assert.match(read("src/js/map-viewer.js"), /tourism && tourism\.captureNote\(\)/);
  const launcher = read("desktop/launcher.cs"); assert.match(launcher, /path\.StartsWith\("\/tourism-", StringComparison\.Ordinal\)\) return true/);
  assert.ok(launcher.includes('service = "https://apis.data.go.kr/B551011/KorService2/"'));
  assert.match(launcher, /ValidTourValue\(kind, value\)/); assert.match(launcher, /BusHttpGet\(url, max, TourResultCode, "22"\)/);
});
