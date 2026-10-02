"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const api = require("../src/js/weather-api.js");

// 2026-10-02 12:00 KST. 기상청 응답 모양(response.header/body.items.item)은 다른 기상청 서비스와 같다.
// 한 줄 모양은 실측(tests/fixtures/kma-typhoon-20261002.json)을 따른다: 숫자 칸은 JSON 숫자, tmFc 만 문자열, 방향은 16방위 약자.
const now = Date.UTC(2026, 9, 2, 3, 0);
const item = (over = {}) => ({ img:"http://www.weather.go.kr/repositary/image/typ/img/RTKO63_202610021000]27_ko.png",
  tmFc:"202610021000", typSeq:27, tmSeq:12, typTm:202610020900, typLat:16.7, typLon:144.7, typLoc:"괌 북서쪽 약 280 km 부근 해상",
  typDir:"W", typSp:11, typPs:985, typWs:27, typ15:300, typ15ed:"", typ15er:0, typ25:0, typName:"초이완", typEn:"CHOI-WAN", rem:"", ...over });
const envelope = items => ({ response:{ header:{ resultCode:"00", resultMsg:"NORMAL_SERVICE" }, body:{ items:{ item:items } } } });

test("bulletins become one track per typhoon, latest position last, corrections replace earlier bulletins", () => {
  const body = envelope([
    item(),
    item({ tmSeq:10, typTm:202610020300, typLat:15.9, typLon:146.0, typPs:990, typWs:24 }),
    item({ tmSeq:11, typTm:202610020600, typLat:16.3, typLon:145.4, typPs:988 }),
    item({ tmSeq:13, typTm:202610020600, typLat:16.35, typLon:145.35, typPs:987 }), // 같은 시각 정정 통보
    item({ typSeq:26, typName:"너구리", typEn:"NEOGURI", tmSeq:30, typTm:202609291500, typLat:30, typLon:130, img:"https://evil.example/x.png" })
  ]);
  const list = api.parseTyphoons(body, now);
  assert.equal(list.length, 2);
  const [active, ended] = list;
  assert.equal(active.seq, 27); assert.equal(active.name, "초이완"); assert.equal(active.nameEn, "CHOI-WAN"); assert.equal(active.ended, false);
  assert.deepEqual(active.fixes.map(f => f.lat), [15.9, 16.35, 16.7]);
  assert.equal(active.latest.pressure, 985); assert.equal(active.latest.wind, 27); assert.equal(active.latest.gale, 300);
  assert.equal(active.latest.storm, null); // 0 km 은 '반경 없음'
  assert.equal(active.latest.at, Date.UTC(2026, 9, 2, 0, 0)); // 09:00 KST
  assert.match(active.image, /^https:\/\/www\.weather\.go\.kr\//);
  // 마지막 통보가 하루 넘게 없는 태풍은 끝난 것으로 치고, 기상청 밖 주소는 링크로 쓰지 않는다.
  assert.equal(ended.seq, 26); assert.equal(ended.ended, true); assert.equal(ended.image, "");
});

test("real KMA response (2026-10-02): newest-first rows, ended typhoon, one-sided radii and remarks", () => {
  // 이 응답은 2026-10-02 16:00 KST 발표까지 받은 것이다. 목록이 최근 통보부터 온다.
  const body = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/kma-typhoon-20261002.json"), "utf8"));
  const fetched = Date.UTC(2026, 9, 2, 7, 30);
  const [choiwan, surigae] = api.parseTyphoons(body, fetched);
  assert.equal(choiwan.seq, 27); assert.equal(choiwan.ended, false); assert.equal(choiwan.fixes.length, 7);
  assert.equal(choiwan.latest.lat, 17); assert.equal(choiwan.latest.lng, 144.5); assert.equal(choiwan.latest.pressure, 980);
  assert.equal(choiwan.latest.at, Date.UTC(2026, 9, 2, 6)); // 15:00 KST
  // 진로도 그림은 가장 늦은 통보의 것이어야 한다(처음 구현은 목록 순서 때문에 가장 이른 것을 골랐다).
  assert.match(choiwan.image, /RTKO63_202610021600\]27_ko\.png$/);
  assert.deepEqual({ ...choiwan.latest.galeException }, { direction:"W", km:180 });
  assert.deepEqual({ ...choiwan.latest.stormException }, { direction:"W", km:30 });
  assert.equal(choiwan.latest.direction, "NW"); assert.match(choiwan.latest.remarks[0], /22시경에 발표/);
  // 온대저기압으로 바뀐 수리개는 마지막 통보가 '정보를 종료'하므로, 하루가 지나기 전에도 끝난 태풍이다.
  assert.equal(surigae.seq, 26); assert.equal(surigae.ended, true);
  assert.equal(api.parseTyphoons(body, Date.UTC(2026, 9, 1, 2))[1].ended, true);
});

test("no-data, single-item and malformed bulletins are handled without inventing positions", () => {
  assert.deepEqual(api.parseTyphoons({ response:{ header:{ resultCode:"03" } } }, now), []);
  assert.equal(api.parseTyphoons(envelope(item()), now).length, 1); // item 이 배열이 아니라 객체 하나일 때
  const bad = [item({ typLat:"" }), item({ typLon:"abc" }), item({ typTm:"2026100209" }), item({ typTm:202613020900 }),
    item({ typSeq:0 }), item({ typLat:80 }), item({ typTm:202610030900 }) /* 미래 */];
  assert.deepEqual(api.parseTyphoons(envelope(bad), now), []);
  const odd = api.parseTyphoons(envelope([item({ typPs:5000, typWs:-3, typ15:"", typSp:null })]), now)[0].latest;
  assert.equal(odd.pressure, null); assert.equal(odd.wind, null); assert.equal(odd.gale, null); assert.equal(odd.speed, null);
  assert.throws(() => api.parseTyphoons({ response:{ header:{ resultCode:"99" } } }, now), /weather-invalid-data/);
  assert.match(api.failureText(new Error("bus-key-invalid"), "typhoon"), /기상청_태풍정보 조회서비스/);
});

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
const FETCHED = Date.UTC(2026, 9, 2, 7, 30); // 두 실측 자료를 받은 때(16:30 KST)

function layerHarness({ available = true, load, forecast } = {}){
  const nodes = [], calls = { fit:[], added:0, groups:[], forecast:[] };
  function node(tag){
    const n = { tag, style:{}, children:[], events:{}, attributes:{}, hidden:false, checked:false, textContent:"", innerHTML:"",
      append(...items){ this.children.push(...items); }, replaceChildren(...items){ this.children = items; },
      setAttribute(k, v){ this.attributes[k] = v; }, addEventListener(k, fn){ this.events[k] = fn; }, remove(){ this.removed = true; } };
    nodes.push(n); return n;
  }
  const layer = (kind, latlng, options) => ({ kind, latlng, options, addTo(group){ group.layers.push(this); return this; } });
  const L = {
    layerGroup:() => { const group = { layers:[], addTo(){ calls.added++; this.onMap = true; return this; }, remove(){ this.onMap = false; } };
      calls.groups.push(group); return group; },
    circle:(a, o) => layer("circle", a, o), polyline:(a, o) => layer("polyline", a, o), circleMarker:(a, o) => layer("dot", a, o),
    marker:(a, o) => layer("marker", a, o), divIcon:o => o
  };
  const map = { createPane:() => node("pane"), fitBounds(points, options){ calls.fit.push({ points, options }); } };
  const words = { lang:"ko" };
  const context = { module:{ exports:{} }, document:{ createElement:node }, L, Date,
    MNWeatherApi:{ available:async () => available, loadTyphoons:load || (async () => ({ typhoons:api.parseTyphoons(envelope([item(), item({ tmSeq:10, typTm:202610020300, typLat:15.9, typLon:146 })]), now), fetchedAt:now })),
      loadTyphoonForecast:async (seq, bulletin) => { calls.forecast.push(seq + "-" + bulletin); if (forecast) return forecast(seq, bulletin); throw new Error("weather-fetch-failed"); },
      failureText:api.failureText } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/js/weather-typhoon.js"), "utf8"), context);
  const host = node("host");
  const controller = context.module.exports.mount({ map, host, word:(ko, en) => words.lang === "en" ? en : ko });
  const find = cls => nodes.find(n => (n.className || "").split(" ").includes(cls));
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { controller, find, nodes, calls, host, words, settle, group:() => calls.groups[calls.groups.length - 1] };
}

test("typhoon layer draws track, radius and labelled marker, lists details and fits the map once", async () => {
  const h = layerHarness();
  const check = h.find("map-typhoon-check");
  assert.equal(h.controller.shown(), false); assert.equal(h.find("map-typhoon-list").hidden, true);
  check.checked = true; check.events.change(); await h.settle();
  // 지나온 길을 먼저 그리고 진로 예보를 받은 뒤 다시 그린다. 지도에는 늘 한 묶음만 남는다.
  assert.equal(h.controller.shown(), true); assert.equal(h.calls.groups.filter(g => g.onMap).length, 1); assert.equal(h.calls.fit.length, 1);
  assert.equal(h.calls.fit[0].options.maxZoom, 6);
  // 강풍 반경 원 하나(폭풍 반경 0 은 그리지 않음) · 지나온 길 · 앞선 위치 점 하나 · 지금 위치 표지. 모두 클릭을 막지 않는다.
  const drawn = h.group().layers;
  assert.deepEqual(drawn.map(l => l.kind), ["circle", "polyline", "dot", "marker"]);
  assert.equal(drawn[0].options.radius, 300000); assert.equal(JSON.stringify(drawn[1].latlng), "[[15.9,146],[16.7,144.7]]"); // 다른 vm 영역의 배열이라 문자열로 비교
  assert.ok(drawn.every(l => l.options.interactive === false && l.options.pane === "mapTyphoonPane"));
  const list = h.find("map-typhoon-list");
  assert.equal(list.children.length, 1);
  const lines = list.children[0].children.map(n => n.textContent).join("\n");
  assert.match(lines, /제27호 태풍 초이완 \(CHOI-WAN\)/); assert.match(lines, /중심기압 985 hPa · 최대풍속 27 m\/s · 이동 서 11 km\/h/); // W → 서
  assert.match(lines, /16\.7°N 144\.7°E/); assert.match(lines, /강풍\(15 m\/s\) 반경 300 km/); assert.doesNotMatch(lines, /폭풍/);
  const label = h.find("map-typhoon-label"); assert.equal(label.textContent, "제27호 초이완 · 985 hPa");
  assert.equal(h.find("map-typhoon-image").href.startsWith("https://www.weather.go.kr/"), true);
  assert.match(h.controller.captureNote(), /^태풍 · 기상청 통보/);
  // 다시 받으면 지도를 또 옮기지 않는다. '지도에서 보기'는 옮긴다.
  await h.controller.refresh({ fitOnLoad:true }); assert.equal(h.calls.fit.length, 1);
  h.find("map-typhoon-go").events.click(); assert.equal(h.calls.fit.length, 2);
  const last = h.group(); h.controller.clear(); assert.equal(last.onMap, false);
  assert.equal(h.controller.shown(), false); assert.equal(h.controller.captureNote(), "");
  h.controller.destroy();
});

test("typhoon layer explains EXE/key requirements and keeps previous drawing when an update fails", async () => {
  const absent = layerHarness({ available:false });
  absent.find("map-typhoon-check").checked = true; absent.find("map-typhoon-check").events.change(); await absent.settle();
  assert.match(absent.find("map-typhoon-status").textContent, /ClassDock\.exe/); assert.equal(absent.calls.added, 0);
  let fail = false;
  const h = layerHarness({ load:async () => {
    if (fail) throw new Error("bus-key-invalid");
    return { typhoons:api.parseTyphoons(envelope([item()]), now), fetchedAt:now };
  } });
  h.find("map-typhoon-check").checked = true; h.find("map-typhoon-check").events.change(); await h.settle();
  fail = true; await h.controller.refresh();
  assert.match(h.find("map-typhoon-status").textContent, /태풍정보 조회서비스/);
  assert.equal(h.find("map-typhoon-list").children.length, 1); assert.match(h.controller.captureNote(), /태풍/);
  const none = layerHarness({ load:async () => ({ typhoons:[], fetchedAt:now }) });
  none.find("map-typhoon-check").checked = true; none.find("map-typhoon-check").events.change(); await none.settle();
  assert.match(none.find("map-typhoon-status").textContent, /진행 중인 태풍이 없습니다/); assert.equal(none.calls.fit.length, 0);
  assert.equal(none.controller.captureNote(), "");
  h.words.lang = "en"; h.controller.sync();
  assert.match(h.find("map-typhoon-list").children[0].children[0].textContent, /^Typhoon No\. 27 CHOI-WAN$/);
});

test("list shows one-sided radii in Korean directions and KMA remarks", async () => {
  const h = layerHarness({ load:async () => ({ typhoons:api.parseTyphoons(envelope([item({ typDir:"NNE", typ15:280, typ15ed:"W", typ15er:180,
    typ25:60, typ25ed:"W", typ25er:30, rem:"이 태풍은 북상 중임.|다음 정보는 오늘(2일) 22시경에 발표될 예정임.|" })]), now), fetchedAt:now }) });
  h.find("map-typhoon-check").checked = true; h.find("map-typhoon-check").events.change(); await h.settle();
  const texts = h.find("map-typhoon-list").children[0].children.map(n => n.textContent);
  assert.ok(texts.includes("강풍(15 m/s) 반경 280 km (서쪽 180 km) · 폭풍(25 m/s) 반경 60 km (서쪽 30 km)"));
  assert.ok(texts.some(t => /이동 북북동 11 km\/h/.test(t)));
  assert.deepEqual(h.find("map-typhoon-list").children[0].children.filter(n => n.className === "map-typhoon-remark").map(n => n.textContent),
    ["이 태풍은 북상 중임.", "다음 정보는 오늘(2일) 22시경에 발표될 예정임."]);
  h.words.lang = "en"; h.controller.sync();
  assert.ok(h.find("map-typhoon-list").children[0].children.some(n => /Gale \(15 m\/s\) radius 280 km \(180 km to the W\)/.test(n.textContent)));
});

test("the launcher proxies only the KMA typhoon list and forecast through the authenticated weather route", () => {
  const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  assert.match(launcher, /route == "\/weather-typhoon" \? "wx-typhoon"/);
  assert.match(launcher, /if \(kind == "wx-typhoon"\) return value == "now";/);
  assert.match(launcher, /TyphoonInfoService\/"; operation = "getTyphoonInfo"/);
  assert.match(launcher, /fromTmFc=" \+ kst\.AddDays\(-3\)/);
  assert.match(launcher, /kind == "wx-ncst" \|\| kind == "wx-ultra" \|\| kind == "wx-typhoon" \? 600/);
  // 진로 예보: "번호-발표시각"만, 열흘 안의 발표만 받고, 같은 통보의 예보는 하루 캐시한다(기본 TTL).
  assert.match(launcher, /route == "\/weather-typhoon-fcst" \? "wx-typhoon-fcst"/);
  assert.match(launcher, /Regex\.Match\(value, "\^\(\[1-9\]\[0-9\]\?\)-\(\[0-9\]\{12\}\)\$"\)/);
  assert.match(launcher, /operation = "getTyphoonFcst"; needsCity = false;\s+query = "dataType=JSON&pageNo=1&numOfRows=100&tmFc=" \+ typhoon\[1\] \+ "&typSeq=" \+ typhoon\[0\]/);
  // 토큰 검사 대상(/weather-*)에 그대로 들어간다.
  assert.match(launcher, /path == "\/can-proxy-weather" \|\| path\.StartsWith\("\/weather-", StringComparison\.Ordinal\)\) return true;/);
});

test("real forecast response (2026-10-02 16:00 bulletin) gives seven ordered points with 70% probability radii", () => {
  const [choiwan] = api.parseTyphoons(fixture("kma-typhoon-20261002.json"), FETCHED);
  assert.equal(choiwan.latest.bulletin, "202610021600");
  const plan = api.parseTyphoonForecast(fixture("kma-typhoon-fcst-20261002.json"), 27, "202610021600");
  assert.equal(plan.length, 7);
  assert.deepEqual(plan.map(p => (p.at - Date.UTC(2026, 9, 2, 7)) / 3600000), [11, 23, 35, 47, 71, 95, 119]); // 16:00 발표 → 03:00·15:00 …
  assert.deepEqual(plan.map(p => p.probability), [40, 80, 110, 130, 190, 290, 440]);
  assert.deepEqual({ lat:plan[0].lat, lng:plan[0].lng, pressure:plan[0].pressure, wind:plan[0].wind, gale:plan[0].gale, storm:plan[0].storm },
    { lat:18, lng:144.5, pressure:970, wind:35, gale:350, storm:70 }); // 값이 문자열로 와도 숫자로 읽는다
  assert.deepEqual({ ...plan[1].galeException }, { direction:"WNW", km:300 }); assert.equal(plan[6].place, "");
  // 다른 태풍·다른 통보의 줄, 발표보다 이른 예상 시각은 섞지 않는다.
  assert.deepEqual(api.parseTyphoonForecast(fixture("kma-typhoon-fcst-20261002.json"), 26, "202610021600"), []);
  assert.deepEqual(api.parseTyphoonForecast(fixture("kma-typhoon-fcst-20261002.json"), 27, "202610021000"), []);
  const early = fixture("kma-typhoon-fcst-20261002.json"); early.response.body.items.item[0].tm = "202610021500";
  assert.equal(api.parseTyphoonForecast(early, 27, "202610021600").length, 6);
});

test("forecast track is drawn dashed from the current position, with time labels and probability circles, and cached per bulletin", async () => {
  const h = layerHarness({ load:async () => ({ typhoons:api.parseTyphoons(fixture("kma-typhoon-20261002.json"), FETCHED), fetchedAt:FETCHED }),
    forecast:async (seq, bulletin) => api.parseTyphoonForecast(fixture("kma-typhoon-fcst-20261002.json"), seq, bulletin) });
  h.find("map-typhoon-check").checked = true; h.find("map-typhoon-check").events.change(); await h.settle(); await h.settle();
  assert.deepEqual(h.calls.forecast, ["27-202610021600"]); // 끝난 수리개 것은 묻지 않는다
  const drawn = h.group().layers;
  const dashed = drawn.filter(l => l.kind === "polyline" && l.options.dashArray);
  assert.equal(dashed.length, 1);
  assert.equal(JSON.stringify(dashed[0].latlng[0]), "[17,144.5]"); // 지금 위치에서 시작
  assert.equal(dashed[0].latlng.length, 8);
  const probability = drawn.filter(l => l.kind === "circle" && l.options.dashArray);
  assert.deepEqual(probability.map(l => l.options.radius / 1000), [40, 80, 110, 130, 190, 290, 440]);
  const labels = h.nodes.filter(n => n.className === "map-typhoon-time").map(n => n.textContent);
  assert.deepEqual(labels, ["3일 03시", "3일 15시", "4일 03시", "4일 15시", "5일 15시", "6일 15시", "7일 15시"]);
  // 지도 맞춤에 예상 진로 끝(37.9°N)까지 들어간다.
  assert.ok(h.calls.fit[0].points.some(([lat]) => lat === 37.9));
  const plan = h.find("map-typhoon-plan");
  assert.match(plan.children[0].textContent, /예상 진로 7곳/);
  assert.match(plan.children[1].textContent, /18\.0°N 144\.5°E · 970 hPa · 35 m\/s · 확률 반경 40 km/);
  assert.match(h.find("map-typhoon-status").textContent, /점선은 진로 예보/);
  assert.match(h.controller.captureNote(), /점선: 진로 예보/);
  await h.controller.refresh(); assert.equal(h.calls.forecast.length, 1); // 같은 통보는 다시 받지 않는다
  assert.equal(h.group().layers.filter(l => l.kind === "polyline" && l.options.dashArray).length, 1);
});

test("a failed forecast keeps the past track and says so", async () => {
  const h = layerHarness({ load:async () => ({ typhoons:api.parseTyphoons(fixture("kma-typhoon-20261002.json"), FETCHED), fetchedAt:FETCHED }) });
  h.find("map-typhoon-check").checked = true; h.find("map-typhoon-check").events.change(); await h.settle(); await h.settle();
  const drawn = h.group().layers;
  assert.equal(drawn.filter(l => l.kind === "polyline" && !l.options.dashArray).length, 1);
  assert.equal(drawn.filter(l => l.options.dashArray).length, 0);
  assert.match(h.find("map-typhoon-status").textContent, /진로 예보를 받지 못해 지나온 길만/);
  assert.equal(h.find("map-typhoon-plan"), undefined);
});
