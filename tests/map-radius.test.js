"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
function load(){
  const context = vm.createContext({ console, window:{}, document:{}, location:{ protocol:"file:" }, navigator:{ onLine:true }, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  const api = vm.runInContext("({mapNormalizeRadius,mapRadiusResults,mapRadiusCounts,mapRadiusCategory,mapRadiusMemoRows,mapRadiusComparison,mapRadiusCompareMemoRows,mapRadiusCompareChart,mapNormalizeMarker,mapDocEmpty,mapDocSerialize,mapDocParse,mapDocContentKey,mapDistanceMeters})", context);
  return { context, api };
}
const plain = value => JSON.parse(JSON.stringify(value));
test("반경 경계 포함·거리순·날짜 변경선: 실제 지리 거리로 판단하고 원본 순서를 보존한다", () => {
  const { api } = load();
  const point = { id:"edge", lat:0, lng:0.01 };
  const meters = api.mapDistanceMeters([0,0], [point.lat,point.lng]);
  const markers = [point, { id:"outside", lat:0, lng:0.010001 }, { id:"center", lat:0, lng:0 }];
  const results = api.mapRadiusResults(markers, { center:[0,0], meters });
  assert.deepEqual(plain(results.map(item => item.marker.id)), ["center","edge"]);
  assert.deepEqual(markers.map(m => m.id), ["edge","outside","center"]);
  assert.equal(api.mapRadiusResults([{ lat:0,lng:-179.999 }], { center:[0,179.999], meters:500 }).length, 1);
  assert.equal(api.mapRadiusResults([{ lat:85,lng:0.01 }], { center:[85,0],meters:100 }).length, 1);
});
test("반경 저장·메모 스냅샷 왕복과 옛 파일·잘못된 값 처리", () => {
  const { api } = load();
  const model = api.mapDocEmpty("생활권");
  const oldKey = api.mapDocContentKey(model);
  model.radius = { center:[37.123456789,127.123456789], meters:1000 };
  model.markers.push(api.mapNormalizeMarker({ lat:37.12,lng:127.12,categoryCode:"HP8" }));
  assert.notEqual(api.mapDocContentKey(model), oldKey);
  const json = api.mapDocSerialize(model);
  const restored = api.mapDocParse(json);
  assert.deepEqual(plain(restored.radius), model.radius);
  assert.equal(restored.markers[0].categoryCode, "HP8");
  assert.equal(api.mapDocSerialize(restored), json);
  const raw = JSON.parse(json); delete raw.radius; raw.version = 10;
  assert.equal(api.mapDocParse(JSON.stringify(raw)).radius, null);
  for (const radius of [null, {}, {center:[null,0],meters:1000}, {center:[0,0],meters:"1000"},
    {center:[86,0],meters:1000}, {center:[0,181],meters:1000}, {center:[0,0],meters:99},
    {center:[0,0],meters:50001}, {center:[NaN,0],meters:1000}, {center:[0,0],meters:Infinity}]){
    assert.equal(api.mapNormalizeRadius(radius), null);
    assert.equal(api.mapRadiusResults(model.markers, radius).length, 0);
  }
  assert.equal(api.mapNormalizeRadius({center:[0,0],meters:100}).meters,100);
  assert.equal(api.mapNormalizeRadius({center:[0,0],meters:50000}).meters,50000);
});
test("시설 코드를 우선하고 옛 분류는 정확한 토큰만 사용하며 메모에 범위와 거리 단위를 남긴다", () => {
  const { api } = load();
  const markers = [
    {lat:0,lng:0,label:"학교 앞 카페",categoryCode:"CE7",category:"음식점 > 카페",roadAddress:"도로 주소"},
    {lat:0,lng:0.001,label:"놀이터",category:"여행 > 공원"},
    {lat:0,lng:0.002,label:"병원이라고 쓴 메모",note:"병원",category:"병원용품"},
    {lat:0,lng:0.003,label:"병원이라는 이름",category:""}
  ].map(api.mapNormalizeMarker);
  const radius = {center:[0,0],meters:1000};
  const results = api.mapRadiusResults(markers,radius);
  assert.deepEqual(plain(results.map(item => api.mapRadiusCategory(item.marker))),["카페","공원","기타","미분류"]);
  assert.equal(api.mapRadiusCounts(results).reduce((sum, item) => sum + item[1],0),4);
  const rows = api.mapRadiusMemoRows(results,radius);
  assert.match(rows[0][0], /1\.00 km.*0\.000000, 0\.000000/);
  assert.equal(rows[0][2],"중심에서 거리 (m)");
  assert.equal(rows[1][3],"도로 주소");
  assert.equal(rows[2][2],"111");
  assert.equal(api.mapNormalizeMarker({categoryCode:"invalid"}).categoryCode, "");
});

// 브라우저/화면 캡처 없이 실제 반경 컨트롤러를 DOM·Leaflet 계약 대역에서 실행한다.
class Element {
  constructor(){
    this.events = {}; this.nodes = new Map(); this.hidden = false; this.style = {}; this.dataset = {}; this.children = [];
    this.classList = { toggle:() => {}, add:() => {}, remove:() => {} };
  }
  setAttribute(name,value){ this[name] = value; }
  addEventListener(name,fn){ this.events[name] = fn; }
  fire(name){ if(this.events[name]) return this.events[name]({preventDefault(){},stopPropagation(){}}); }
  append(...nodes){ this.children.push(...nodes); }
  appendChild(node){ this.children.push(node); return node; }
  set textContent(value){ this.text = value; this.children = []; }
  get textContent(){ return this.text || ""; }
  querySelector(key){ if(!this.nodes.has(key)) this.nodes.set(key,new Element()); return this.nodes.get(key); }
  querySelectorAll(){ return [500,1000,2000].map(meters => { const el = this.querySelector(String(meters)); el.dataset.meters = String(meters); return el; }); }
  remove(){}
  focus(){}
  reportValidity(){ return Number(this.value)>=100 && Number(this.value)<=50000; }
}
function controller(){
  const { context, api } = load();
  const layers = new Set();
  const latLng = (lat,lng) => ({lat,lng,wrap(){return this;}});
  const layer = (center,options) => ({
    options, center:[...center], handlers:{},element:new Element(),
    setIcon(icon){this.options.icon=icon;return this;},getElement(){return this.element;},
    addTo(){layers.add(this);return this;},
    setLatLng(at){this.center=[...at];return this;},setRadius(meters){this.meters=meters;return this;},
    getLatLng(){return latLng(...this.center);},bindTooltip(){return this;},
    on(name,fn){this.handlers[name]=fn;return this;}
  });
  const model = api.mapDocEmpty("비교");
  model.markers = [api.mapNormalizeMarker({id:"near",lat:0,lng:0.001,source:"nearby",categoryCode:"SC4"}),
    api.mapNormalizeMarker({id:"far",lat:0,lng:0.02})];
  const hidden = new Set(); let savedRows = null;
  Object.assign(context,{
    model, taskMode:false, radiusFiltered:false, radiusMatches:new Set(), radiusAMatches:new Set(), radiusResults:[],
    radiusListReset:new Element(), listFilter:new Element(), listOpen:false,
    document:{createElement:()=>new Element(),activeElement:null},
    stage:new Element(), markerLayers:new Map(), doc:{cleanupFns:[]},
    map:{removeLayer(item){layers.delete(item);},getContainer:()=>new Element()},
    L:{circle:layer,marker:layer,latLng,divIcon:opts=>opts,DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}}},
    radiusActive:()=>!!model.radius && model.basemap!=="custom",
    markerVisible:marker=>!hidden.has(marker.source),
    mapTranslate(){}, scheduleListRefresh(){}, redrawClusters(){}, syncListPanel(){},
    syncRadius(){}, touch:()=>context.syncRadius(),
    window:{addTableToScratchpad(rows){savedRows=plain(rows);return {rows:rows.length-1,dropped:0};}},
  });
  // 기존 이력 엔진을 그대로 연결해 드래그가 실행 취소 한 단계인지 확인한다.
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/js/history.js"),"utf8"),context);
  context.history = vm.runInContext("MNEditHistory",context).create({
    capture:()=>api.mapDocSerialize(model),
    apply:json=>{Object.assign(model,api.mapDocParse(json));context.syncRadius();},
    isEqual:(a,b)=>a===b
  });
  context.history.reset();
  const start = source.indexOf("  /* ── 움직이는 반경 보기 ── */");
  const end = source.indexOf("  /* ── 발표 모드 ──",start);
  vm.runInContext(source.slice(start,end)+"\n globalThis.controls={startRadius,radiusCommit,get center(){return radiusCenter;},radiusPanel,radiusFold,radiusContent,radiusList,radiusMemo,radiusPresets,radiusFix,radiusUnfix,radiusCompareMemo,radiusCompareChart,get comparison(){return radiusComparison;},get fixedCircle(){return radiusFixedCircle;},get circle(){return radiusCircle;}};",context);
  return {context,api,model,hidden,layers,controls:context.controls,get rows(){return savedRows;}};
}
test("반경 조작: 생성·범위 변경·숨긴 묶음·메모·드래그·삭제와 실행 취소", () => {
  const h=controller(); const {context,controls,model,hidden,layers}=h;
  controls.startRadius({lat:0,lng:0});
  assert.equal(model.radius.meters,1000);
  assert.equal(context.radiusResults.length,1);
  assert.equal(layers.size,2);
  controls.radiusPresets[2].fire("click");
  assert.equal(model.radius.meters,2000);
  context.history.undo(); assert.equal(model.radius.meters,1000);
  controls.radiusMemo.fire("click"); assert.equal(h.rows.length,2);
  hidden.add("nearby"); context.syncRadius(); assert.equal(context.radiusResults.length,0);
  hidden.clear(); context.syncRadius();
  controls.radiusList.fire("click"); assert.equal(context.radiusFiltered,true);
  controls.radiusFold.fire("click"); assert.equal(controls.radiusContent.hidden,true);
  const center=controls.center;
  center.handlers.dragstart(); center.center=[0,0.02]; center.handlers.drag();
  assert.deepEqual(plain(model.radius.center),[0,0]); // 미리보기는 저장값을 바꾸지 않는다.
  center.handlers.dragend();
  assert.deepEqual(plain(model.radius.center),[0,0.02]);
  assert.equal(context.radiusResults[0].marker.id,"far");
  context.history.undo(); assert.deepEqual(plain(model.radius.center),[0,0]);
  context.history.redo(); assert.deepEqual(plain(model.radius.center),[0,0.02]);
  controls.radiusPanel.querySelector(".map-radius-remove").fire("click");
  assert.equal(model.radius,null); assert.equal(layers.size,0); assert.equal(context.radiusFiltered,false);
  context.history.undo(); assert.equal(layers.size,2);
  context.doc.cleanupFns.forEach(fn=>fn());
});
test("이미지 배경에서는 반경 집계·강조를 중지하고 일반 지도 복귀 시 되살린다", () => {
  const h=controller();
  h.controls.startRadius({lat:0,lng:0});
  h.model.basemap="custom"; h.context.syncRadius();
  assert.equal(h.layers.size,0); assert.equal(h.context.radiusResults.length,0);
  assert.equal(h.controls.radiusMemo.disabled,true);
  h.controls.startRadius({lat:1,lng:1});
  assert.deepEqual(plain(h.model.radius.center),[0,0]);
  h.model.basemap="osm"; h.context.syncRadius();
  assert.equal(h.layers.size,2); assert.equal(h.context.radiusResults.length,1);
  h.context.doc.cleanupFns.forEach(fn=>fn());
});

test("실제 목록 렌더러는 반경 필터·거리순·검색·해제를 함께 적용한다", () => {
  const h=controller(); const {context,model}=h;
  model.markers.push(h.api.mapNormalizeMarker({id:"closer",lat:0,lng:0.0005,label:"가까운 학교"}));
  model.markers[0].label="먼 학교";
  const listItems=new Element(), listGroups=new Element();
  Object.assign(context,{
    listItems,listGroups,listFoot:new Element(),MAP_LIST_MAX_ROWS:300,hiddenSources:h.hidden,
    applyMarkerVisibility:()=>context.syncRadius(),focusMarker(){},removeMarker(){},
  });
  context.listFilter.value="";
  const start=source.indexOf("  const renderMarkerList = () => {");
  const end=source.indexOf("  let listTimer = 0;",start);
  vm.runInContext(source.slice(start,end)+"\n globalThis.renderList=renderMarkerList;",context);
  h.controls.startRadius({lat:0,lng:0});
  h.controls.radiusList.fire("click"); context.renderList();
  const names=()=>listItems.children.map(row=>row.children[0].children[1].textContent);
  assert.deepEqual(names(),["가까운 학교","먼 학교"]);
  assert.equal(listItems.children[0].children[1].hidden,true);
  context.listFilter.value="가까운"; context.renderList();
  assert.deepEqual(names(),["가까운 학교"]);
  context.listFilter.value=""; context.radiusFiltered=false; context.renderList();
  assert.equal(listItems.children.length,3);
  assert.equal(listItems.children[0].children[1].hidden,false);
  h.context.doc.cleanupFns.forEach(fn=>fn());
});
test("공용 출력 경로는 반경 요약을 담고 성공·실패 모두 출력 전용 요약을 정리한다", async () => {
  const h=controller(); const {context}=h;
  h.controls.startRadius({lat:0,lng:0});
  let captured=null, fail=false;
  Object.assign(context,{
    setAdding(){},drawingMode:null,waitForTiles:async()=>{},driveLayer:null,
    // 캡처는 실시간 열차 층이 걸어 두는 역 이름 훅도 부른다(꺼져 있으면 빈 배열).
    subwayCaptureLabels:()=>[],
    mapCaptureDataUrl:async()=>{
      const summary=vm.runInContext("radiusExport",context);
      captured={hidden:summary.hidden,text:summary.textContent};
      if(fail) throw new Error("capture failed");
      return "test-png";
    }
  });
  context.map.closePopup=()=>{};
  const start=source.indexOf("  const captureMapPng = async () => {");
  const end=source.indexOf("  /* ── 지역 통계 ── */",start);
  vm.runInContext(source.slice(start,end)+"\n globalThis.captureRadius=captureMapPng;",context);
  assert.equal(await context.captureRadius(),"test-png");
  assert.equal(captured.hidden,false);
  assert.match(captured.text,/1\.00 km/);
  assert.match(captured.text,/학교 1/);
  assert.match(captured.text,/직선 반경/);
  assert.equal(vm.runInContext("radiusExport.hidden",context),true);
  h.controls.radiusFix.fire("click");
  h.controls.startRadius({lat:0,lng:0.02});
  await context.captureRadius();
  assert.match(captured.text,/전체 A 1곳 \/ B 1곳/);
  assert.match(captured.text,/학교 A 1 \/ B 0/);
  assert.match(captured.text,/B: 0\.00000, 0\.02000/);
  assert.match(captured.text,/겹친 표시 0곳/);
  assert.equal(h.layers.size,4);
  fail=true;
  await assert.rejects(context.captureRadius(),/capture failed/);
  assert.equal(vm.runInContext("radiusExport.hidden",context),true);
  h.context.doc.cleanupFns.forEach(fn=>fn());
});

test("A 중심은 독립 사본으로 저장되고 비교만 손상되면 단일 반경으로 복원한다", () => {
  const {api}=load();
  const radius={center:[37,127],meters:1000,compareCenter:[37.01,127.02]};
  const normal=api.mapNormalizeRadius(radius);
  radius.compareCenter[0]=1;
  assert.equal(normal.compareCenter[0],37.01);
  const model=api.mapDocEmpty("A/B"); model.radius=normal;
  const saved=api.mapDocSerialize(model);
  assert.deepEqual(plain(api.mapDocParse(saved).radius),plain(normal));
  const withCompare=api.mapDocContentKey(model);
  delete model.radius.compareCenter;
  assert.notEqual(api.mapDocContentKey(model),withCompare);
  assert.deepEqual(plain(api.mapDocParse(api.mapDocSerialize(model)).radius),{center:[37,127],meters:1000});
  for(const compareCenter of [[91,0],[0,181],[null,0],["37",127],[],"wrong"]){
    assert.deepEqual(plain(api.mapNormalizeRadius({center:[37,127],meters:1000,compareCenter})),{center:[37,127],meters:1000});
  }
});
test("A/B 집계는 겹침을 양쪽에 세고 한쪽에 없는 분류는 0이며 차이는 B-A다", () => {
  const {api}=load();
  const markers=[
    {id:"a",lat:0,lng:0,categoryCode:"SC4"},
    {id:"both",lat:0,lng:0.007,categoryCode:"HP8"},
    {id:"b",lat:0,lng:0.014,categoryCode:"CE7"},
    {id:"out",lat:0,lng:0.03,categoryCode:"CE7"}
  ].map(api.mapNormalizeMarker);
  const radius={center:[0,0.014],compareCenter:[0,0],meters:1000};
  const comparison=api.mapRadiusComparison(markers,radius);
  assert.deepEqual([comparison.aTotal,comparison.bTotal,comparison.shared],[2,2,1]);
  const rows=Object.fromEntries(plain(comparison.rows).map(row=>[row.label,[row.a,row.b,row.delta]]));
  assert.deepEqual(rows,{병원:[1,1,0],카페:[0,1,1],학교:[1,0,-1]});
  const identical=api.mapRadiusComparison(markers,{...radius,center:[0,0]});
  assert.equal(identical.shared,identical.aTotal);
  assert.ok(identical.rows.every(row=>row.delta===0));
  const empty=api.mapRadiusComparison([],radius);
  assert.equal(empty.aTotal,0);assert.equal(empty.bTotal,0);assert.equal(empty.rows.length,0);
  assert.equal(api.mapRadiusComparison(markers,{center:[0,0],meters:1000}),null);
  const chart=api.mapRadiusCompareChart(comparison,radius);
  const group=require("../src/js/board-tools.js").chartGroup(plain(chart));
  assert.deepEqual(group.chartSpec.series,plain(chart.series));
  assert.deepEqual(group.chartSpec.rows.map(row=>row.values),plain(chart.rows.map(row=>row.values)));
  assert.deepEqual(group.chartSpec.palette,["#b45309","#0e7490"]);
  const emptyGroup=require("../src/js/board-tools.js").chartGroup(plain(api.mapRadiusCompareChart(empty,radius)));
  assert.deepEqual(emptyGroup.chartSpec.rows[0].values,[0,0]);
});
test("A 고정 후 우클릭·드래그는 B만 옮기고 크기·실행 취소·배경 전환은 두 원에 적용한다", () => {
  const h=controller();const {controls,context,model,layers}=h;
  controls.startRadius({lat:0,lng:0});
  controls.radiusFix.fire("click");
  assert.equal(layers.size,4);
  assert.deepEqual(plain(model.radius.compareCenter),[0,0]);
  controls.startRadius({lat:0,lng:0.02});
  assert.deepEqual(plain(model.radius.compareCenter),[0,0]);
  assert.deepEqual(plain(model.radius.center),[0,0.02]);
  assert.equal(controls.comparison.aTotal,1);assert.equal(controls.comparison.bTotal,1);
  controls.radiusPresets[2].fire("click");
  assert.equal(controls.fixedCircle.meters,2000);assert.equal(controls.circle.meters,2000);
  context.history.undo();assert.equal(controls.fixedCircle.meters,1000);assert.equal(controls.circle.meters,1000);
  const center=controls.center;
  center.handlers.dragstart();center.center=[0,0.003];center.handlers.drag();
  context.syncRadius();
  assert.deepEqual(plain(model.radius.center),[0,0.02]);
  assert.deepEqual(plain(model.radius.compareCenter),[0,0]);
  assert.equal(controls.comparison.shared,1);
  center.handlers.dragend();
  context.history.undo();assert.deepEqual(plain(model.radius.center),[0,0.02]);
  context.history.redo();assert.deepEqual(plain(model.radius.center),[0,0.003]);
  controls.radiusUnfix.fire("click");assert.equal(layers.size,2);assert.equal(model.radius.compareCenter,undefined);
  assert.deepEqual(plain(model.radius.center),[0,0.003]);
  context.history.undo();assert.equal(layers.size,4);
  model.basemap="custom";context.syncRadius();assert.equal(layers.size,0);assert.equal(controls.comparison,null);
  model.basemap="osm";context.syncRadius();assert.equal(layers.size,4);
  h.hidden.add("nearby");context.syncRadius();
  assert.equal(controls.comparison.aTotal,0);assert.equal(controls.comparison.bTotal,0);
  controls.radiusPanel.querySelector(".map-radius-remove").fire("click");assert.equal(layers.size,0);
  context.history.undo();assert.equal(layers.size,4);
  context.doc.cleanupFns.forEach(fn=>fn());assert.equal(layers.size,0);
});
test("비교표는 좌표·반경·겹침·분류 개수를 메모에 보내고 B 장소 목록은 B만 보낸다", () => {
  const h=controller();h.controls.startRadius({lat:0,lng:0});h.controls.radiusFix.fire("click");
  h.controls.startRadius({lat:0,lng:0.02});h.controls.radiusCompareMemo.fire("click");
  assert.match(h.rows[0][0],/1\.00 km.*등록 표시/);
  assert.match(h.rows[0][0],/겹친 표시 0곳/);
  assert.match(h.rows[0][1],/A.*0\.000000, 0\.000000/);
  assert.match(h.rows[0][2],/B.*0\.000000, 0\.020000/);
  assert.deepEqual(h.rows[1],["전체","1","1","0"]);
  assert.deepEqual(h.rows.find(row=>row[0]==="학교"),["학교","1","0","-1"]);
  h.controls.radiusMemo.fire("click");
  assert.equal(h.rows.length,2);assert.equal(h.rows[1][1],"미분류");
  h.context.doc.cleanupFns.forEach(fn=>fn());
});
test("칠판 생성 대기 중에는 중복 전송을 막고 클릭 시점의 비교 자료를 보낸다", async () => {
  const h=controller();let calls=0,resolveBoard,sent;
  h.context.newWhiteboard=()=>{};
  h.context.createMapBoard=()=>{calls++;return new Promise(resolve=>{resolveBoard=resolve;});};
  h.controls.startRadius({lat:0,lng:0});h.controls.radiusFix.fire("click");
  h.controls.startRadius({lat:0,lng:0.02});
  const waiting=h.controls.radiusCompareChart.fire("click");
  assert.equal(h.controls.radiusCompareChart.disabled,true);
  await h.controls.radiusCompareChart.fire("click");assert.equal(calls,1);
  h.controls.startRadius({lat:0,lng:0}); // 기다리는 동안 B가 달라져도 보낼 자료는 고정
  resolveBoard({insertBoardChart(spec){sent=plain(spec);return true;}});
  await waiting;
  assert.match(sent.series[1],/0\.0200/);
  assert.deepEqual(sent.rows.find(row=>row.label==="학교").values,[1,0]);
  assert.equal(h.controls.radiusCompareChart.disabled,false);
  h.context.doc.cleanupFns.forEach(fn=>fn());
});
test("비교 차트 전송 실패 뒤에는 버튼을 되살리고 비교 상태를 보존한다", async () => {
  const h=controller();let message="";
  h.context.newWhiteboard=()=>{};h.context.createMapBoard=async()=>({insertBoardChart:()=>false});
  h.context.console={warn(){}};h.context.toast=text=>{message=text;};
  h.controls.startRadius({lat:0,lng:0});h.controls.radiusFix.fire("click");
  await h.controls.radiusCompareChart.fire("click");
  assert.match(message,/비교 차트/);assert.equal(h.controls.radiusCompareChart.disabled,false);
  assert.deepEqual(plain(h.model.radius.compareCenter),[0,0]);
  h.context.doc.cleanupFns.forEach(fn=>fn());
});
