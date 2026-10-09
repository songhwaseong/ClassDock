"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const air = require("../src/js/air-quality.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const at = Date.UTC(2026, 9, 9, 1, 20); // 10:20 KST
const envelope = (items, total = items.length) => ({ response:{ header:{ resultCode:"00" }, body:{ items, totalCount:total } } });
const catalog = [
  { stationName:"종로구", dmX:"37.572025", dmY:"127.005028", addr:"서울특별시 종로구", mangName:"도시대기" },
  { stationName:"중앙동", dmX:"36.5", dmY:"127.5", addr:"충청북도 청주시", mangName:"도시대기" },
  { stationName:"중앙동", dmX:"35.5", dmY:"129.1", addr:"울산광역시", mangName:"도시대기" }
];
const readings = [
  { stationName:"종로구", sidoName:"서울", dataTime:"2026-10-09 10:00", pm25Value:"16", pm10Value:"22", o3Value:"0.095", pm25Grade1h:"2", pm25Grade:"1", pm10Grade1h:"1", o3Grade:"3" },
  { stationName:"중앙동", sidoName:"충북", dataTime:"2026-10-09 10:00", pm25Value:"8", pm10Value:"10", o3Value:"0.025", pm25Flag:"장비점검" },
  { stationName:"중앙동", sidoName:"울산", dataTime:"2026-10-09 06:00", pm25Value:"5", pm10Value:"15", o3Value:"0.01" }
];

test("PM2.5·PM10·오존의 경계값과 1시간 등급을 사용한다", () => {
  for (const [metric, values] of Object.entries({ pm25:[0,15,16,35,36,75,76], pm10:[0,30,31,80,81,150,151], o3:[0,.03,.031,.09,.091,.15,.151] })){
    assert.deepEqual(values.map(value => air.measurement({ [metric + "Value"]:String(value) }, metric).grade), [1,1,2,2,3,3,4]);
  }
  assert.equal(air.measurement({ pm25Value:"16", pm25Grade:"1", pm25Grade1h:"2" }, "pm25").grade, 2);
  assert.equal(air.measurement({ pm10Value:"90", pm10Grade:"1" }, "pm10").grade, 3);
  for (const value of [null, "", "-", "-1", "NaN", "<script>", "0.1ppm"]){
    assert.deepEqual(air.measurement({ pm25Value:value }, "pm25"), { value:null, grade:0, flag:"" });
  }
  assert.deepEqual(air.measurement({ pm25Value:"0", pm25Grade1h:"1", pm25Flag:"자료이상" }, "pm25"), { value:null, grade:0, flag:"자료이상" });
});

test("시각이 없거나 잘못된 값·미래 값·오래된 값은 회색, 24:00은 올바르게 해석한다", () => {
  const s = { at:"2026-10-09 10:00", pm25:air.measurement({ pm25Value:"12" }, "pm25") };
  assert.equal(air.observation(s, "pm25", at).grade, 1);
  assert.equal(air.observation({ ...s, at:"2026-10-09 08:20" }, "pm25", at).grade, 1);
  assert.equal(air.observation({ ...s, at:"2026-10-09 08:19" }, "pm25", at).reason, "오래된 관측");
  for (const time of ["", "2026-02-30 10:00", "2026-10-09 24:01", "2026-10-09 12:00", "bad"]){
    assert.equal(air.observation({ ...s, at:time }, "pm25", at).grade, 0);
  }
  const midnight = Date.UTC(2026, 9, 8, 15, 10);
  assert.equal(air.observation({ ...s, at:"2026-10-08 24:00" }, "pm25", midnight).grade, 1);
  assert.equal(air.observation({ ...s, at:"2026-10-09 00:00" }, "pm25", midnight).grade, 1);
});

test("측정소 dmX는 위도·dmY는 경도이며 유효한 국내 좌표만 사용한다", () => {
  const s = air.station(catalog[0]);
  assert.deepEqual([s.lat, s.lng, s.sido], [37.572025, 127.005028, "서울"]);
  assert.equal(air.station({ ...catalog[0], dmX:"127", dmY:"37" }), null);
  assert.equal(air.station({ ...catalog[0], dmX:"-", dmY:"127" }), null);
  assert.equal(air.station({ ...catalog[0], stationName:"" }), null);
  assert.equal(air.province("전북특별자치도 전주시"), "전북");
  assert.equal(air.province("강원특별자치도"), "강원");
});

test("같은 측정소 이름은 시도로 구분하고 모호하거나 다른 시도의 관측은 매칭하지 않는다", () => {
  const stations = catalog.map(air.station);
  const result = air.join(stations, [...readings,
    { ...readings[1], sidoName:"" },
    { ...readings[0], sidoName:"부산" },
    { ...readings[0], stationName:"새 측정소" },
    { ...readings[0], dataTime:"2026-10-09 09:00", pm25Value:"999" }
  ]);
  assert.equal(result.unmatched, 3);
  assert.equal(result.stations.length, 3);
  assert.equal(result.stations[0].pm25.value, 16); // 늦게 도착한 이전 시각을 버린다.
  assert.equal(result.stations.find(s => s.sido === "충북").pm25.value, null);
  assert.equal(result.stations.find(s => s.sido === "울산").pm25.value, 5);
  const missing = air.join(stations, readings.slice(0, 1)).stations.find(s => s.sido === "충북");
  assert.equal(missing.pm25.grade, 0);
});

test("측정소 코드가 있으면 이름 변경 후에도 같은 위치로 맞춘다", () => {
  const s = air.station({ ...catalog[0], stationCode:"111123" });
  const result = air.join([s], [{ ...readings[0], stationName:"바뀐 이름", stationCode:"111123" }]);
  assert.equal(result.unmatched, 0);
  assert.equal(result.stations[0].pm25.value, 16);
});

test("정상 JSON·XML 변환 봉투와 자료 없음은 읽고 오류 응답은 거절한다", () => {
  assert.deepEqual(air.rows(envelope(readings)).items, readings);
  assert.deepEqual(air.rows({ header:{ resultCode:"00" }, body:{ items:{ item:readings[0] }, totalCount:1 } }).items, [readings[0]]);
  assert.equal(air.rows({ response:{ header:{ resultCode:"03" } } }).total, 0);
  assert.throws(() => air.rows({ response:{ header:{ resultCode:"30" }, body:{} } }), /air-invalid-data/);
  assert.throws(() => air.rows({}), /air-invalid-data/);
});

// DOM과 Leaflet을 대신해 API·취소·캐시·지도 생명주기를 검사한다. 브라우저를 실행하지 않는다.
function harness(fetch){
  const nodes = [], saved = new Map(), listeners = new Map(), windowListeners = new Map(), intervals = new Map(), removed = [];
  let now = at, inView = () => true, popups = 0;
  const calls = [], views = [];
  function node(tag){
    const n = { tag, style:{}, children:[], events:{}, attributes:{}, hidden:false, disabled:false, value:"", textContent:"",
      classList:{ toggle(){} }, append(...items){ this.children.push(...items); }, appendChild(n){ this.children.push(n); },
      replaceChildren(...items){ this.children = items; }, setAttribute(k, v){ this.attributes[k] = v; },
      addEventListener(k, fn){ this.events[k] = fn; }, click(){ this.events.click(); }, focus(){}, remove(){ this.removed = true; } };
    nodes.push(n); return n;
  }
  const group = { items:[], onMap:false, clearLayers(){ this.items = []; }, addTo(){ this.onMap = true; return this; } }, renderer = {};
  const L = { DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} }, svg:options => { renderer.options = options; return renderer; }, layerGroup:() => group,
    circleMarker:(point, options) => ({ point, options, bindTooltip(fn, tooltipOptions){ this.tip = fn; this.tooltipOptions = tooltipOptions; return this; }, bindPopup(fn){ this.popup = fn; return this; },
      addTo(g){ g.items.push(this); return this; }, openPopup(){ popups++; } }) };
  const map = { createPane:() => node("pane"), getZoom:() => 8, setView(point, zoom){ views.push([point, zoom]); }, closePopup(){},
    getCenter:() => ({ distanceTo:([lat, lng]) => Math.hypot(lat - 36.5, lng - 127.5) }), getBounds:() => ({ contains:inView }),
    removeLayer(g){ g.onMap = false; removed.push(g); }, on(k, fn){ listeners.set(k, fn); }, off(k){ listeners.delete(k); } };
  const window = { addEventListener(k, fn){ windowListeners.set(k, fn); }, removeEventListener(k){ windowListeners.delete(k); } };
  const context = { module:{ exports:{} }, AbortController, setTimeout, clearTimeout, L, window, document:{ createElement:node, createTextNode:t => ({ textContent:t }) },
    fetch:(url, options) => { calls.push({ url, options }); return fetch(url, options); },
    setInterval:fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; }, clearInterval:id => intervals.delete(id),
    Date:class extends Date { constructor(...args){ super(...(args.length ? args : [now])); } static now(){ return now; } },
    localStorage:{ getItem:k => saved.get(k) || null, setItem:(k, v) => saved.set(k, v) } };
  vm.runInNewContext(read("src/js/air-quality.js"), context);
  const doc = { cleanupFns:[] }, api = context.module.exports;
  const controller = api.mount({ map, stage:node("stage"), toolRow:node("tools"), doc });
  return { api, controller, doc, group, renderer, removed, saved, calls, listeners, windowListeners, intervals, views,
    find:cls => nodes.find(n => (n.className || "").split(" ").includes(cls)), setViewFilter:fn => { inView = fn; },
    setNow:value => { now = value; }, setEnglish:() => { window.MNI18N = { lang:"en" }; windowListeners.get("mni18nchange")(); }, popups:() => popups };
}
const ok = (body, fetchedAt = at) => ({ ok:true, headers:{ get:() => new Date(fetchedAt).toISOString() }, json:async () => body });
const defaultFetch = async url => url === "/can-proxy-weather" ? { ok:true, text:async () => "yes" }
  : ok(envelope(url.includes("stations") ? catalog : readings));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const opened = async fetch => { const h = harness(fetch || defaultFetch); await settle(); h.find("map-toolvis-air-quality").click(); await settle(); await settle(); return h; };
const tree = node => [node, ...(node.children || []).flatMap(tree)];
const part = (node, cls) => tree(node).find(n => (n.className || "").split(" ").includes(cls));
const textOf = node => tree(node).map(n => n.textContent || "").join("");

test("항목 전환·팝업·가까운 순의 목록과 출처를 표시하고 지도 이동은 추가 조회하지 않는다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  assert.equal(h.controller.isAvailable(), true);
  assert.equal(h.group.items.length, 3);
  assert.deepEqual(h.group.items.map(m => m.options.fillColor), [air.COLORS[2], air.COLORS[0], air.COLORS[0]]);
  assert.deepEqual(Array.from(h.group.items[0].point), [37.572025, 127.005028]);
  assert.match(h.find("map-air-summary").textContent, /화면 안 3곳.*결측·시각 확인 2곳/);
  assert.equal(h.find("map-air-list").children[0].children[0].children[0].textContent, "중앙동");
  h.find("map-air-list").children[0].children[0].click();
  assert.equal(h.views[0][1], 14); assert.equal(h.popups(), 1);
  const popup = h.group.items[0].popup();
  assert.equal(popup.children[0].textContent, "종로구");
  assert.ok(popup.children.some(n => n.children[1] && n.children[1].textContent === "2026-10-09 10:00 (KST)"));
  assert.ok(popup.children.some(n => n.children[1] && n.children[1].textContent === "16 ㎍/㎥ · 보통"));
  const tip = h.group.items[0].tip();
  assert.equal(h.group.items[0].tooltipOptions.className, "map-air-tooltip");
  assert.equal(part(tip, "map-air-tip-name").textContent, "종로구");
  assert.equal(part(tip, "map-air-tip-metric").textContent, "PM2.5");
  assert.equal(part(tip, "map-air-tip-status").textContent, "보통");
  assert.equal(part(tip, "map-air-tip-value").textContent, "16");
  assert.equal(part(tip, "map-air-tip-unit").textContent, "㎍/㎥");
  const cells = part(tip, "map-air-tip-scale").children;
  assert.deepEqual(Array.from(cells, c => part(c, "map-air-tip-label").textContent), ["좋음", "보통", "나쁨", "매우나쁨"]);
  assert.equal(cells.filter(c => c.attributes["aria-current"] === "true").length, 1);
  assert.equal(cells[1].attributes["aria-current"], "true");
  assert.ok(part(cells[1], "map-air-tip-position"));
  const missingTip = h.group.items[1].tip();
  assert.equal(part(missingTip, "map-air-tip-status").textContent, "장비점검");
  assert.equal(part(missingTip, "map-air-tip-value").textContent, "—");
  assert.equal(part(missingTip, "map-air-tip-unit"), undefined);
  assert.equal(part(missingTip, "map-air-tip-scale").children.some(c => c.attributes["aria-current"] === "true"), false);
  h.find("map-air-metric").value = "o3"; h.find("map-air-metric").events.change();
  assert.equal(h.group.items[0].options.fillColor, air.COLORS[3]);
  const ozoneTip = h.group.items[0].tip();
  assert.equal(part(ozoneTip, "map-air-tip-metric").textContent, "O₃");
  assert.equal(part(ozoneTip, "map-air-tip-value").textContent, "0.095");
  assert.equal(part(ozoneTip, "map-air-tip-unit").textContent, "ppm");
  assert.equal(part(ozoneTip, "map-air-tip-scale").children[2].attributes["aria-current"], "true");
  assert.match(h.controller.captureNote(), /오존.*2026-10-09 10:00.*에어코리아/);
  h.setViewFilter(([lat]) => lat > 37); h.listeners.get("moveend")();
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(h.find("map-air-list").children.length, 1);
  assert.equal(h.calls.length, 3); // capability + catalog + readings
  h.find("map-air-metric").value = "pm25"; h.setEnglish();
  const englishTip = h.group.items[0].tip();
  assert.equal(part(englishTip, "map-air-tip-status").textContent, "Moderate"); // global '보통' = Medium is not used here.
  assert.equal(englishTip.attributes.lang, "en");
  assert.ok(Object.hasOwn(englishTip.attributes, "data-i18n-ignore"));
});

test("창 닫기는 표시를 유지하고, 끄기는 SVG를 제거하며, 다시 켜면 캐시를 쓰고 치울 때 자원을 정리한다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  const toggle = h.find("map-toolvis-air-quality");
  h.find("map-weather-heading").children[1].click();
  assert.equal(h.find("map-air-panel").hidden, true); assert.equal(h.group.onMap, true);
  toggle.click(); assert.equal(h.group.onMap, false); assert.equal(h.controller.captureNote(), "");
  assert.ok(h.removed.includes(h.renderer)); assert.equal(h.renderer.options.pane, "mapAirQualityPane");
  toggle.click(); await settle(); await settle(); assert.equal(h.calls.length, 3);
  h.doc.cleanupFns[0]();
  assert.equal(h.listeners.size, 0); assert.equal(h.windowListeners.size, 0); assert.equal(h.intervals.size, 0);
  assert.equal(h.find("map-air-panel").removed, true);
});

test("유효한 측정소 캐시만 쓰고 관측 캐시는 런처 수신 시각부터 10분을 센다", async t => {
  let readingCalls = 0;
  const h = harness(async url => {
    if (url === "/can-proxy-weather") return { ok:true, text:async () => "yes" };
    if (url.includes("readings")) readingCalls++;
    return ok(envelope(url.includes("stations") ? catalog : readings), at - 9 * 60000);
  }); t.after(() => h.controller.destroy());
  h.saved.set(air.CACHE_KEY, JSON.stringify({ at:at - 6 * 86400000, stations:catalog.map(air.station) }));
  await settle(); h.find("map-toolvis-air-quality").click(); await settle(); await settle();
  assert.equal(h.calls.length, 2); assert.equal(readingCalls, 1);
  assert.equal(h.api.readStations(at).length, 3);
  h.find("map-toolvis-air-quality").click(); h.setNow(at + 60000); h.find("map-toolvis-air-quality").click(); await settle(); await settle();
  assert.equal(readingCalls, 2);
  h.saved.set(air.CACHE_KEY, JSON.stringify({ at:at - 7 * 86400000, stations:catalog.map(air.station) })); assert.equal(h.api.readStations(at), null);
  h.saved.set(air.CACHE_KEY, JSON.stringify({ at:at + 1, stations:catalog.map(air.station) })); assert.equal(h.api.readStations(at), null);
  h.saved.set(air.CACHE_KEY, "bad JSON"); assert.equal(h.api.readStations(at), null);
});

test("자료 갱신 실패 때 이전 관측을 유지하고 이유를 알리며, 수동 갱신은 refresh를 지정한다", async t => {
  let fail = false;
  const h = await opened(url => fail && url.includes("readings") ? Promise.resolve({ ok:false, text:async () => "bus-key-invalid" }) : defaultFetch(url));
  t.after(() => h.controller.destroy()); fail = true;
  h.find("map-air-refresh").click(); await settle(); await settle();
  assert.equal(h.group.items.length, 3);
  assert.match(h.find("map-air-status").textContent, /대기오염정보/);
  assert.match(h.find("map-air-status").textContent, /앞서 받은 관측값을 유지/);
  assert.match(h.calls.at(-1).url, /readings\?page=1&refresh=1$/);
  assert.equal(h.find("map-air-refresh").disabled, false);
});

test("받는 중 취소하거나 치운 뒤 늦게 응답이 와도 재표시하거나 다음 API를 부르지 않는다", async () => {
  for (const destroy of [false, true]){
    let finish;
    const h = harness(url => url === "/can-proxy-weather" ? Promise.resolve({ ok:true, text:async () => "yes" }) : new Promise(resolve => { finish = resolve; }));
    try {
      await settle(); const toggle = h.find("map-toolvis-air-quality"); toggle.click(); await settle();
      const signal = h.calls.at(-1).options.signal;
      if (destroy) h.controller.destroy(); else toggle.click();
      assert.equal(signal.aborted, true);
      finish(ok(envelope(catalog))); await settle(); await settle();
      assert.equal(h.group.items.length, 0); assert.equal(h.calls.length, 2); assert.equal(h.saved.size, 0);
    } finally { h.controller.destroy(); }
  }
});

test("관측이 2시간을 넘으면 추가 조회 없이 회색으로 바뀐다", async t => {
  const h = await opened(); t.after(() => h.controller.destroy());
  h.setNow(at + 2 * 3600000); for (const fn of h.intervals.values()) fn();
  assert.ok(h.group.items.every(m => m.options.fillColor === air.COLORS[0]));
  const tip = h.group.items[0].tip();
  assert.match(textOf(tip), /오래된 관측/); assert.equal(h.calls.length, 3);
  assert.equal(part(tip, "map-air-tip-value").textContent, "16");
  assert.match(part(tip, "map-air-tip-time").textContent, /2026-10-09 10:00 \(KST\)/);
  assert.equal(part(tip, "map-air-tip-scale").children.some(c => c.attributes["aria-current"] === "true"), false);
});

test("API 측정소 이름과 주소는 HTML로 해석하지 않고 글자로 표시한다", async t => {
  const unsafe = "<img src=x onerror=alert(1)>";
  const h = await opened(async url => url === "/can-proxy-weather" ? { ok:true, text:async () => "yes" }
    : ok(envelope(url.includes("stations") ? [{ ...catalog[0], stationName:unsafe, addr:"서울 " + unsafe }] : [{ ...readings[0], stationName:unsafe }])));
  t.after(() => h.controller.destroy());
  assert.equal(h.group.items[0].popup().children[0].textContent, unsafe);
  assert.equal(part(h.group.items[0].tip(), "map-air-tip-name").textContent, unsafe);
  assert.doesNotMatch(read("src/js/air-quality.js"), /innerHTML/);
});

test("전체 건수까지 다음 쪽을 받고 서비스별 인증 오류를 알린다", async t => {
  const h = harness(async url => url === "/can-proxy-weather" ? { ok:true, text:async () => "yes" }
    : ok(envelope(url.includes("page=1") ? [catalog[0]] : [catalog[1]], 2)));
  t.after(() => h.controller.destroy());
  const result = await h.api.pages("stations"); assert.equal(result.items.length, 2);
  assert.deepEqual(h.calls.filter(c => c.url.includes("stations")).map(c => c.url), ["/air-quality-stations?page=1", "/air-quality-stations?page=2"]);
  assert.match(air.failureText({ message:"bus-key-invalid", kind:"stations" }), /측정소정보/);
  assert.match(air.failureText({ message:"bus-key-required" }), /설정 → 연결/);
});

test("새 기능을 분할 번들·도구 설정·내보내기 출처·고정 API 경로에 연결한다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json"));
  assert.ok(manifest.localScripts.includes("air-quality.js"));
  assert.ok(manifest.scriptDependencies["map-viewer.js"].includes("air-quality.js"));
  assert.ok(read("classdock.html").includes('<script src="src/js/air-quality.js"></script>'));
  assert.match(read("src/js/state.js"), /id:"mapAirQuality"/);
  assert.match(read("src/styles.css"), /html\.hide-tool-mapAirQuality \.map-toolvis-air-quality/);
  assert.match(read("src/js/map-viewer.js"), /airQuality && airQuality\.captureNote\(\)/);
  const launcher = read("desktop/launcher.cs");
  assert.match(launcher, /path\.StartsWith\("\/air-quality-", StringComparison\.Ordinal\)\) return true/);
  assert.ok(launcher.includes('service = "https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/"'));
  assert.ok(launcher.includes('service = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/"'));
  assert.doesNotMatch(read("src/js/air-quality.js"), /serviceKey|TagoKeyParameter/); // 브라우저·지도 문서로 인증키를 전달하지 않는다.
});
