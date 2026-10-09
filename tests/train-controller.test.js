"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const realApi=require("../src/js/train-api.js"),timetable=require("./fixtures/train-schedule-seoul-busan.json");
const stationData=require("../src/js/train-stations-data.js");
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness({failCatalogue=false,canQuery=true}={}){
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.handlers={};this.value="";this.textContent="";this.className="";}
    append(...items){items.forEach(item=>this.appendChild(item));}
    appendChild(item){this.children.push(item);if(this.tag==="select" && this.children.length===1)this.value=item.value;return item;}
    insertBefore(item,before){this.children.splice(this.children.indexOf(before),0,item);}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(key,value){this.attrs[key]=value;}
    addEventListener(name,handler){this.handlers[name]=handler;}
    fire(name,event={}){return this.handlers[name]?.({preventDefault(){},stopPropagation(){},...event});}
    click(){return this.fire("click");}focus(){this.focused=true;}remove(){this.removed=true;}
  }
  const pending=[],timers=new Set(),storage=new Map();let catalogueCalls=0,now=Date.parse("2026-10-09T04:00:00+09:00");
  const layers=new Set(),mapEvents=new Map(),attributions=new Set(),allMarkers=[];let zoom=8;
  const map={createPane(){return {style:{},remove(){this.removed=true;}};},on(name,handler){mapEvents.set(name,handler);},off(name){mapEvents.delete(name);},
    getZoom:()=>zoom,removeLayer:layer=>layers.delete(layer),closePopup(){this.popupClosed=true;},fitBounds(points,options){this.fit={points,options};},
    setView(at,value){this.view=at;zoom=value;mapEvents.get("zoomend")?.();},latLngToContainerPoint:at=>({x:at[1],y:at[0]}),
    attributionControl:{addAttribution:note=>attributions.add(note),removeAttribution:note=>attributions.delete(note)}};
  const leaflet={DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},divIcon:options=>options,latLngBounds:points=>points,
    layerGroup(){return {items:[],addLayer(item){this.items.push(item);},addTo(){layers.add(this);},clearLayers(){this.items=[];}};},
    marker(at,options){const marker={at,options,setIcon(icon){this.options.icon=icon;},bindPopup(factory,settings){this.popup=factory;this.popupOptions={options:settings};return this;},getPopup(){return this.popupOptions;},
      unbindTooltip(){this.tooltip=null;},bindTooltip(label,settings){this.tooltip={label,settings};return this;},setTooltipContent(label){this.tooltip.label=label;return this;}};allMarkers.push(marker);return marker;}};
  class Clock extends Date{constructor(...args){super(...(args.length ? args : [now]));}static now(){return now;}}
  const stations=[{id:"NAT010000",name:"서울",label:"서울 · 서울특별시"},{id:"NAT014445",name:"부산",label:"부산 · 부산광역시"},
    {id:"NAT011668",name:"대전",label:"대전 · 대전광역시"}];
  const api={...realApi,dateAt:(at=now)=>realApi.dateAt(at),ymd:(at=now)=>realApi.ymd(at),
    async loadCatalogue(){catalogueCalls++;if(failCatalogue && catalogueCalls===1)throw new Error("bus-key-invalid");return {stations,grades:[{id:"00",name:"KTX"}],at:now};},
    loadSchedule(from,to,date,options){const task=deferred();pending.push({from,to,date,options,task});return task.promise;}};
  const context={MNTrainApi:api,MNTrainStationData:stationData,Date:Clock,AbortController,window:{},document:{createElement:tag=>new Element(tag)},L:leaflet,
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    fetch:async()=>({ok:true,text:async()=>canQuery ? "yes" : "no"}),setInterval(fn){timers.add(fn);return fn;},clearInterval(fn){timers.delete(fn);}};
  vm.createContext(context);vm.runInContext(fs.readFileSync("src/js/train-map.js","utf8")+"\nglobalThis.trainModule=MNTrainMap;",context);
  const stage=new Element("stage"),tools=new Element("tools"),doc={cleanupFns:[]};
  stage.clientWidth=1000;
  const controller=context.trainModule.mount({map,stage,toolRow:tools,doc});
  const panel=stage.children[0],form=panel.children[2],route=form.children[0],query=form.children[2];
  return {controller,pending,timers,doc,panel,form,map,layers,markers:allMarkers,mapEvents,attributions,mapTools:panel.children[1],toggle:tools.children[0],from:route.children[0].children[1],to:route.children[1].children[1],
    swap:route.children[2],date:query.children[0].children[1],grade:query.children[1].children[1],load:query.children[2],
    hidePast:panel.children[3].children[0].children[0],refresh:panel.children[3].children[1],summary:panel.children[5],list:panel.children[6],status:panel.children[7],
    catalogueCalls:()=>catalogueCalls,tick(ms){now+=ms;for(const fn of timers)fn();},now:()=>now};
}
const result=()=>({items:realApi.schedule(timetable),fetchedAt:Date.parse("2026-10-09T04:00:00+09:00"),total:86,truncated:false});
test("조건 변경 후 늦은 시간표를 무시하고 닫힌 문서의 요청·타이머를 정리한다",async()=>{
  const h=harness();await flush();assert.equal(h.toggle.disabled,false);h.toggle.click();await flush();
  assert.equal(h.date.value,"2026-10-09");assert.equal(h.toggle.attrs["aria-expanded"],"true");
  const first=h.form.fire("submit");await flush();assert.equal(h.pending.length,1);
  h.to.value="대전";h.to.fire("input");assert.equal(h.pending[0].options.signal.aborted,true);
  h.pending[0].task.resolve(result());await first;assert.equal(h.summary.textContent,"");
  const second=h.form.fire("submit");await flush();h.pending[1].task.resolve(result());await second;
  assert.match(h.summary.textContent,/서울 → 대전/);assert.ok(h.list.children.length>0);
  const summary=h.summary.textContent;h.to.value="부산";h.to.fire("input");const third=h.form.fire("submit");await flush();
  h.doc.cleanupFns.forEach(fn=>fn());assert.equal(h.pending[2].options.signal.aborted,true);assert.equal(h.timers.size,0);
  assert.equal(h.panel.removed,true);assert.equal(h.toggle.removed,true);h.pending[2].task.resolve(result());await third;
  assert.equal(h.summary.textContent,summary);
});
test("KTX 역 표시를 눌러 실제 TAGO ID로 출발·도착을 고르고 지도·시간표를 연결한다",async()=>{
  const h=harness();await flush();h.toggle.click();await flush();assert.equal(h.markers.length,88);assert.equal(h.layers.size,1);
  const busan=h.markers.find(x=>x.options.title==="부산역"),popup=busan.popup();
  const seoul=h.markers.find(x=>x.options.title==="서울역");
  assert.equal(busan.tooltip.settings.permanent,false);assert.equal(busan.tooltip.settings.interactive,true);
  assert.equal(busan.tooltip.label.children[0].textContent,"부산역");assert.equal(seoul.tooltip.label.children[1].textContent,"KTX · 출발");
  assert.match(popup.children[2].textContent,/부산/);assert.match(popup.children[3].textContent,/35\./);
  const actions=popup.children[4];await actions.children[1].click();assert.equal(h.to.value,"부산 · 부산광역시");
  assert.match(busan.options.icon.html.className,/is-to/);assert.equal(h.map.popupClosed,true);
  assert.equal(busan.tooltip.label.children[1].textContent,"KTX · 도착");
  actions.children[2].click();assert.equal(h.map.getZoom(),14);assert.equal(busan.tooltip.settings.permanent,true);
  await h.markers.find(x=>x.options.title==="대전역").popup().children[4].children[0].click();
  assert.equal(seoul.tooltip.label.children[1].textContent,"KTX");
  assert.equal(h.markers.find(x=>x.options.title==="대전역").tooltip.label.children[1].textContent,"KTX · 출발");
  assert.equal(h.from.value,"대전 · 대전광역시");h.mapTools.children[2].click();assert.equal(h.map.fit.points.length,2);
  const request=h.form.fire("submit");await flush();assert.equal(h.pending[0].from,"NAT011668");assert.equal(h.pending[0].to,"NAT014445");
  h.pending[0].task.resolve(result());await request;
  h.panel.children[0].children[1].click();assert.equal(h.panel.hidden,true);assert.equal(h.layers.size,1);
  assert.match(h.controller.captureNote(),/OpenStreetMap/);assert.equal(h.controller.captureLabels().length,88);
  h.toggle.click();const visibility=h.mapTools.children[0].children[0];visibility.checked=false;visibility.fire("change");
  assert.equal(h.layers.size,0);assert.equal(h.toggle.attrs["aria-pressed"],"false");assert.equal(h.controller.captureLabels().length,0);assert.equal(h.attributions.size,0);
  h.mapTools.children[1].click();assert.equal(h.map.fit.points.length,88);assert.equal(h.layers.size,1);
  h.controller.destroy();assert.equal(h.layers.size,0);assert.equal(h.mapEvents.size,0);assert.equal(h.attributions.size,0);
});
test("지도 역은 시간표 프록시 없이도 표시하고 미지원 역의 잘못된 시간표 조회를 막는다",async()=>{
  const h=harness({canQuery:false});await flush();h.toggle.click();await flush();assert.equal(h.markers.length,88);assert.equal(h.catalogueCalls(),0);
  const unsupported=h.markers.find(x=>x.options.title==="평택지제역").popup();
  assert.equal(unsupported.children[4].children[0].disabled,true);assert.match(unsupported.children[6].textContent,/역 목록/);
  await h.form.fire("submit");assert.equal(h.pending.length,0);assert.match(h.status.textContent,/ClassDock EXE/);
  await h.markers.find(x=>x.options.title==="대전역").popup().children[4].children[0].click();
  assert.equal(h.from.value,"대전");assert.equal(h.catalogueCalls(),0);
  h.from.value="";h.to.value="";h.mapTools.children[2].click();assert.equal(h.map.fit,undefined);assert.match(h.status.textContent,/위치 자료가 없어요/);
  h.controller.destroy();
});
test("키 오류 뒤 재시도하고 갱신 실패 시 기존 구간·시간표를 유지한다",async()=>{
  const h=harness({failCatalogue:true});await flush();h.toggle.click();await flush();assert.match(h.status.textContent,/활용신청/);
  h.toggle.click();h.toggle.click();await flush();assert.equal(h.catalogueCalls(),2);
  const request=h.form.fire("submit");await flush();h.pending[0].task.resolve(result());await request;
  const before=h.summary.textContent,rows=h.list.children.length;
  const refresh=h.refresh.click();await flush();assert.equal(h.pending[1].options.refresh,true);
  h.pending[1].task.reject(new Error("train-fetch-failed"));await refresh;assert.equal(h.summary.textContent,before);assert.equal(h.list.children.length,rows);
  assert.match(h.status.textContent,/받지 못했어요/);assert.equal(h.refresh.disabled,false);
  h.hidePast.checked=false;h.hidePast.fire("change");h.grade.value="all";h.grade.fire("change");assert.equal(h.list.children.length,86);
  h.controller.destroy();
});
