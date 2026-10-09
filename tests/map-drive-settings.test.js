"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 브라우저 없이 실제 창의 이벤트 처리기를 실행한다. 레이아웃·화면은 캡처하지 않는다.
function driveSettingsHarness(config = {}, geocode = async () => []){
  let body;
  const matches = (node, selector) => {
    const visible = selector.includes(":not([hidden])");
    selector = selector.replace(":not([hidden])", "");
    if (visible && node.hidden) return false;
    const tag = /^[a-z]+/i.exec(selector);
    if (tag && node.tagName !== tag[0]) return false;
    for (const [, cls] of selector.matchAll(/\.([\w-]+)/g)) if (!node.className.split(/\s+/).includes(cls)) return false;
    for (const [, attr, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)){
      if (attr === "checked") { if (!node.checked) return false; }
      else if (value === undefined ? !(attr in node.attrs) : node.attrs[attr] !== value) return false;
    }
    return true;
  };
  const make = tag => {
    const node = {
      tagName:tag, className:"", attrs:{}, style:{ setProperty(key, value){ this[key] = value; } }, children:[], parentElement:null,
      listeners:{}, value:"", checked:false, disabled:false, hidden:false, textContent:"",
      classList:{ toggle(){}, add(){} },
      get isConnected(){ return this === body || !!this.parentElement && this.parentElement.isConnected; },
      setAttribute(key, value){ this.attrs[key] = String(value); if (["class", "value", "id"].includes(key)) this[key === "class" ? "className" : key] = String(value); if (key === "hidden") this.hidden = true; },
      appendChild(child){ child.parentElement = this; this.children.push(child); return child; },
      append(...children){ children.forEach(child => this.appendChild(child)); },
      replaceChildren(...children){ this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); },
      remove(){ const parent = this.parentElement; if (parent) parent.children = parent.children.filter(child => child !== this); this.parentElement = null; },
      addEventListener(type, handler){ (this.listeners[type] ||= []).push(handler); },
      async dispatch(type, detail = {}){ for (const handler of this.listeners[type] || []) await handler({ target:this, preventDefault(){}, stopPropagation(){}, ...detail }); },
      click(){ return this.disabled ? Promise.resolve() : this.dispatch("click"); },
      focus(){ void this.dispatch("focus"); }, scrollIntoView(){},
      getBoundingClientRect(){ return { top:200, bottom:240 }; }, scrollHeight:150,
      querySelector(selector){ return this.querySelectorAll(selector)[0] || null; },
      querySelectorAll(selector){
        const results = [];
        const selectors = selector.split(/,\s*/).map(item => item.trim().split(/\s+/));
        const walk = current => {
          for (const child of current.children){
            if (selectors.some(parts => {
              if (!matches(child, parts.at(-1))) return false;
              let parent = child.parentElement;
              for (let i = parts.length - 2; i >= 0; i--){
                while (parent && !matches(parent, parts[i])) parent = parent.parentElement;
                if (!parent) return false;
                parent = parent.parentElement;
              }
              return true;
            })) results.push(child);
            walk(child);
          }
        };
        walk(this); return results;
      },
      set innerHTML(html){
        this.replaceChildren();
        const stack = [this];
        for (const token of html.match(/<[^>]+>/g) || []){
          if (token.startsWith("</")) { stack.pop(); continue; }
          const match = /^<([\w-]+)([^>]*)>/.exec(token);
          if (!match) continue;
          const child = make(match[1]);
          for (const [, key, value] of match[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) child.setAttribute(key, value || "");
          stack.at(-1).appendChild(child);
          if (!["input", "br", "hr"].includes(child.tagName)) stack.push(child);
        }
      }
    };
    return node;
  };
  body = make("body");
  const keyHandlers = new Set();
  const storage = new Map();
  const context = {
    console, setTimeout, clearTimeout, Date, Math, JSON, Map, Set,
    document:{ body, createElement:make, createTextNode:text => ({ children:[], textContent:text }) },
    window:{ innerHeight:900, addEventListener:(type, handler) => keyHandlers.add(handler), removeEventListener:(type, handler) => keyHandlers.delete(handler) },
    localStorage:{ getItem:key => storage.get(key), setItem:(key, value) => storage.set(key, value) },
    __geocode:geocode
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8") + "\nmapGeocode = __geocode;", context);
  context.openMapDriveSettings({ markers:[], ...config });
  const modal = body.querySelector(".map-drive-settings-modal");
  const query = selector => modal.querySelector(selector);
  const rows = () => modal.querySelectorAll(".map-drive-stop");
  const search = async (index, text) => {
    const row = rows()[index], input = row.querySelector("input");
    input.value = text;
    await input.dispatch("input");
    await row.querySelector(".map-drive-stop-search-btn").click();
    await new Promise(resolve => setImmediate(resolve));
  };
  return { context, modal, query, rows, search, keyHandlers };
}

const answer = stops => ({ stops, result:{ points:[[37.56, 126.98], [37.55, 126.97]], distance:1800, duration:300, sections:[{ distance:1800, duration:300 }] } });

test("표시 없는 지도에서 출발·도착을 검색하면 같은 창에 결과가 나오며 다시 실행할 수 있다", async () => {
  const calls = [];
  const harness = driveSettingsHarness({ onApply:async (...args) => { calls.push(args); return answer(args[2]); } }, async query => [
    { name:query, title:query, lat:query === "학교" ? 37.56 : 37.55, lng:126.98 }
  ]);
  assert.equal(harness.query(".map-drive-apply").disabled, true);
  await harness.search(0, "학교");
  assert.equal(harness.query(".map-drive-apply").disabled, true);
  await harness.search(1, "박물관");
  assert.equal(harness.query(".map-drive-apply").disabled, false);
  await harness.query(".map-drive-apply").click();
  assert.deepEqual(Array.from(calls[0][2], stop => stop.label), ["학교", "박물관"]);
  assert.equal(calls[0][3], false);
  assert.equal(harness.modal.isConnected, true);
  assert.equal(harness.query(".map-drive-comparison").hidden, false);
  assert.equal(harness.query(".map-drive-save-shape").disabled, false);
  assert.equal(harness.query(".map-drive-sections-wrap tbody").children.length, 1);
  await harness.query(".map-drive-apply").click();
  assert.equal(calls.length, 2);
  assert.equal(harness.query(".map-drive-sections-wrap tbody").children.length, 1);
  await harness.query(".map-drive-close").click();
  assert.equal(harness.keyHandlers.size, 0);
});

test("하나 있는 표시를 출발지에 채우고 경유지 순서를 바꾸며 선택한 장소만 적용한다", async () => {
  const calls = [];
  const markers = [{ id:"a", label:"학교", lat:37.56, lng:126.98 }];
  const harness = driveSettingsHarness({ markers, onApply:async (...args) => { calls.push(args); return answer(args[2]); } }, async query => [{ name:query, lat:37.55, lng:126.97 }]);
  assert.equal(harness.rows()[0].querySelector("input").value, "학교");
  await harness.search(1, "도착");
  await harness.query(".map-drive-add-stop").click();
  await harness.search(1, "경유 A");
  await harness.query(".map-drive-add-stop").click();
  await harness.search(2, "경유 B");
  await harness.rows()[2].querySelector(".map-drive-stop-tools").children[0].click();
  harness.query(".map-drive-add-markers").checked = true;
  await harness.query(".map-drive-apply").click();
  assert.deepEqual(Array.from(calls[0][2], stop => stop.label), ["학교", "경유 B", "경유 A", "도착"]);
  assert.equal(calls[0][2][0].markerId, "a");
  assert.equal(calls[0][3], true);
  await harness.query(".map-drive-swap-stops").click();
  await harness.query(".map-drive-apply").click();
  assert.deepEqual(Array.from(calls[1][2], stop => stop.label), ["도착", "경유 A", "경유 B", "학교"]);
});

test("검색 후보를 고르기 전이나 선택한 이름을 다시 고치는 동안에는 길찾기를 실행하지 않는다", async () => {
  const harness = driveSettingsHarness({}, async query => [
    { name:query + " 1", lat:37.56, lng:126.98 }, { name:query + " 2", lat:37.55, lng:126.97 }
  ]);
  await harness.search(0, "학교");
  assert.equal(harness.query(".map-drive-apply").disabled, true);
  await harness.rows()[0].querySelector(".map-results").children[1].click();
  await harness.search(1, "역");
  await harness.rows()[1].querySelector(".map-results").children[0].click();
  assert.equal(harness.query(".map-drive-apply").disabled, false);
  const input = harness.rows()[0].querySelector("input");
  input.value = "수정한 학교";
  await input.dispatch("input");
  assert.equal(harness.query(".map-drive-apply").disabled, true);
});

test("늦게 온 검색 응답은 바뀐 입력이나 닫힌 길찾기 창에 적용하지 않는다", async () => {
  let resolveSearch;
  const harness = driveSettingsHarness({}, () => new Promise(resolve => { resolveSearch = resolve; }));
  await harness.search(0, "옛 학교");
  const input = harness.rows()[0].querySelector("input");
  input.value = "새 학교";
  await input.dispatch("input");
  resolveSearch([{ name:"옛 학교", lat:37.56, lng:126.98 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(input.value, "새 학교");
  assert.equal(harness.query(".map-drive-apply").disabled, true);
  await harness.search(0, "새 학교");
  await harness.query(".map-drive-close").click();
  resolveSearch([{ name:"새 학교", lat:37.56, lng:126.98 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.modal.isConnected, false);
  assert.equal(harness.keyHandlers.size, 0);
});

test("출발 시각을 정하면 7곳 제한을 적용하며 경유지를 줄인 뒤 실행할 수 있다", async () => {
  const calls = [];
  const markers = Array.from({ length:8 }, (_, i) => ({ id:"p" + i, lat:37.55 + i / 1000, lng:126.98, label:"장소 " + i }));
  const harness = driveSettingsHarness({ markers, onApply:async (...args) => { calls.push(args); return answer(args[2]); } });
  const later = harness.query('input[name="map-drive-depart"][value="later"]');
  harness.query('input[name="map-drive-depart"][value="now"]').checked = false;
  later.checked = true;
  await later.dispatch("change");
  assert.equal(harness.query(".map-drive-apply").disabled, true);
  assert.match(harness.query(".map-drive-settings-route").textContent, /7곳/);
  await harness.rows()[1].querySelector(".map-drive-stop-tools").children[2].click();
  assert.equal(harness.query(".map-drive-apply").disabled, false);
  await harness.query(".map-drive-apply").click();
  assert.equal(calls[0][2].length, 7);
  assert.equal(calls[0][2].at(-1).label, "장소 7");
});

test("길찾기가 실패해도 창을 유지하고 재실행하면 결과와 저장 버튼이 갱신된다", async () => {
  let fail = true;
  const harness = driveSettingsHarness({ markers:[{ id:"a", lat:37.56, lng:126.98, label:"출발" }, { id:"b", lat:37.55, lng:126.97, label:"도착" }],
    onApply:async (options, depart, stops) => fail ? { result:{ error:"directions-failed" } } : answer(stops) });
  await harness.query(".map-drive-apply").click();
  assert.equal(harness.modal.isConnected, true);
  assert.equal(harness.query(".map-drive-comparison").hidden, true);
  assert.equal(harness.query(".map-drive-save-shape").disabled, true);
  assert.equal(harness.query(".map-drive-apply").disabled, false);
  assert.match(harness.query(".map-drive-settings-note").textContent, /찾지 못했어요/);
  fail = false;
  await harness.query(".map-drive-apply").click();
  assert.equal(harness.query(".map-drive-comparison").hidden, false);
  assert.equal(harness.query(".map-drive-save-shape").disabled, false);
});

test("지도 요약 카드는 실제 값을 갱신하고 접기·펼치기와 상세·설정 버튼을 연결한다", async () => {
  const harness = driveSettingsHarness();
  const clicks = [];
  const card = harness.context.mapCreateDriveSummaryCard({ onDetails:() => clicks.push("details"), onSettings:() => clicks.push("settings") });
  harness.context.document.body.appendChild(card.element);
  const waypoint = "충청남도 천안시 서북구 불당동 아주 긴 경유지 이름 ".repeat(4);
  const destination = "부산광역시해운대구아주긴목적지이름".repeat(6);
  const data = harness.context.mapDriveSummaryData({ distance:12345, duration:1500, toll:0 }, [
    { label:"<script>출발</script>", lat:37.56, lng:126.98 }, { label:waypoint, lat:37.555, lng:126.975 }, { label:destination, lat:37.55, lng:126.97 }
  ], {}, "", 3);
  card.update(data);
  const query = selector => card.element.querySelector(selector);
  const rows = () => card.element.querySelectorAll(".map-drive-summary-stop");
  assert.deepEqual(rows().map(row => row.querySelector(".map-drive-summary-stop-role").textContent), ["출발", "경유 1", "도착"]);
  assert.deepEqual(rows().map(row => row.querySelector(".map-drive-summary-stop-name").textContent), ["<script>출발</script>", waypoint, destination]);
  assert.equal(query(".map-drive-summary-stops").tabIndex, 0);
  assert.equal(query("script"), null);
  assert.equal(query(".map-drive-summary-duration strong").textContent, "25분");
  assert.equal(query(".map-drive-summary-distance strong").textContent, "12.3 km");
  assert.equal(query(".map-drive-summary-fares").children[0].querySelector("strong").textContent, "0원");
  assert.equal(query(".map-drive-summary-fares").children[1].querySelector("strong").textContent, "정보 없음");
  await query(".map-drive-summary-close").click();
  assert.equal(query(".map-drive-summary-card").hidden, true);
  assert.equal(query(".map-drive-summary-reopen").hidden, false);
  const updated = harness.context.mapDriveSummaryData({ distance:12345, duration:1800, toll:0 },
    Array.from({ length:10 }, (_, index) => ({ label:waypoint + index, lat:37.56 - index * 0.001, lng:126.98 })), {}, "", 10);
  card.update(updated);
  assert.equal(rows().length, 10);
  assert.equal(rows()[8].querySelector(".map-drive-summary-stop-role").textContent, "경유 8");
  assert.equal(rows()[9].querySelector(".map-drive-summary-stop-role").textContent, "도착");
  assert.equal(rows()[9].querySelector(".map-drive-summary-stop-name").textContent, waypoint + 9);
  assert.equal(query(".map-drive-summary-card").hidden, true);
  assert.match(query(".map-drive-summary-reopen").textContent, /30분/);
  await query(".map-drive-summary-reopen").click();
  assert.equal(query(".map-drive-summary-card").hidden, false);
  await query(".map-drive-summary-details").click();
  await query(".map-drive-summary-settings").click();
  assert.deepEqual(clicks, ["details", "settings"]);
});

function driveRendererHarness(){
  const harness = driveSettingsHarness();
  const context = harness.context;
  const controls = [];
  const layers = new Set();
  const calls = [];
  context.model = context.mapDocEmpty("요약 카드");
  context.model.drive = true;
  context.model.route = true;
  context.model.driveStops = [{ label:"출발", lat:37.56, lng:126.98 }, { label:"도착", lat:37.55, lng:126.97 }];
  context.driveItems = () => context.mapDriveRouteItems(context.model);
  context.map = { getSize:() => ({ x:320, y:500 }), on(){}, off(){}, removeLayer:layer => layers.delete(layer) };
  const layer = () => ({
    addTo(){ layers.add(this); return this; },
    bindTooltip(content, options){ this.tooltip = { content, options }; return this; },
    setLatLngs(){ return this; }
  });
  context.L = {
    polyline:layer, circleMarker:layer,
    DomEvent:{ disableClickPropagation(){}, disableScrollPropagation(){} },
    control:() => {
      const control = { addTo(){ this.element = this.onAdd(); context.document.body.appendChild(this.element); return this; }, remove(){ this.element.remove(); } };
      controls.push(control); return control;
    }
  };
  context.doc = { cleanupFns:[] };
  context.scheduleDrive = () => {};
  context.setStatus = context.restoreStatus = context.touch = context.openDriveSettings = () => {};
  context.driveBtn = context.document.createElement("button");
  context.routeBtn = context.document.createElement("button");
  context.__fetchDirections = async points => { calls.push(points); return { ...answer([]).result, toll:0, taxi:9000 }; };
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  const start = source.indexOf("  let driveLayer = null;");
  const end = source.indexOf("\n  let radiusResults = []", start);
  assert.ok(start >= 0 && end > start);
  const disable = /const disableDrive = \(\) => \{[\s\S]*?\n  \};/.exec(source);
  assert.ok(disable);
  const syncRoute = /const syncRouteButton = \(\) => \{[\s\S]*?\n  \};/.exec(source);
  assert.ok(syncRoute);
  vm.runInContext("mapFetchDirections = __fetchDirections;\n" + source.slice(start, end)
    + "\n" + syncRoute[0] + "\n" + disable[0] + "\nglobalThis.__driveRenderer = { run:runDrive, disable:disableDrive, summary:() => driveSummary };", context);
  return { ...harness, controls, layers, calls, renderer:context.__driveRenderer };
}

test("실제 경로 렌더러는 이름 변경 때 추가 요청 없이 요약을 갱신하고 경로 해제 때 카드를 걷는다", async () => {
  const harness = driveRendererHarness();
  harness.context.model.driveStops.splice(1, 0, { label:"충청남도 천안시 서북구 불당동", lat:37.555, lng:126.975 });
  await harness.renderer.run();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.controls.length, 1);
  const card = harness.controls[0].element;
  assert.equal(card.isConnected, true);
  assert.equal(card.style.maxWidth, "294px");
  assert.equal(card.style.maxHeight, "390px");
  const stops = () => [...harness.layers].filter(layer => layer.tooltip && layer.tooltip.options.className.startsWith("map-drive-stop-tip"));
  const tips = stops().map(layer => layer.tooltip.content());
  assert.deepEqual(tips.map(tip => tip.querySelector(".map-drive-stop-tip-role").textContent), ["출발", "경유 1", "도착"]);
  assert.equal(tips[1].querySelector(".map-drive-stop-tip-name").textContent, "충청남도 천안시 서북구 불당동");
  assert.equal(tips[1].style.maxWidth, "264px");
  assert.ok(tips[0].querySelector(".map-drive-stop-tip-role").style["--map-icon"]);
  await card.querySelector(".map-drive-summary-close").click();
  const longName = "옮긴 학교 <script>장소명</script> ".repeat(4);
  harness.context.model.driveStops[0].label = longName;
  await harness.renderer.run();
  assert.equal(harness.calls.length, 1);
  assert.match(harness.renderer.summary().title, /옮긴 학교/);
  assert.equal(card.querySelector(".map-drive-summary-stop-name").textContent, longName);
  const departureTip = stops()[0].tooltip.content();
  assert.equal(departureTip.querySelector(".map-drive-stop-tip-name").textContent, longName);
  assert.equal(departureTip.querySelector("script"), null);
  assert.equal(card.querySelector(".map-drive-summary-card").hidden, true);
  harness.renderer.disable();
  assert.equal(harness.context.model.drive, false);
  assert.equal(harness.context.model.route, false);
  assert.equal(harness.context.routeBtn.attrs["aria-pressed"], "false");
  assert.equal(harness.context.model.driveStops.length, 3);
  assert.equal(harness.calls.length, 1);
  assert.equal(card.isConnected, false);
  assert.equal(harness.layers.size, 0);
  assert.equal(harness.renderer.summary(), null);
});

test("늦게 도착한 옛 길찾기 응답은 해제한 경로의 요약 카드를 되살리지 않는다", async () => {
  const harness = driveRendererHarness();
  let resolve;
  harness.context.__lateDirections = () => new Promise(done => { resolve = done; });
  vm.runInContext("mapFetchDirections = __lateDirections;", harness.context);
  const pending = harness.renderer.run();
  harness.renderer.disable();
  resolve(answer([]).result);
  await pending;
  assert.equal(harness.controls.length, 0);
  assert.equal(harness.renderer.summary(), null);
  assert.equal(harness.layers.size, 0);
});
