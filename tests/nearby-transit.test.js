"use strict";
/* 주변 교통 자동 표시(nearby-transit.js)와 좌표로 고르는 근처 정류장(MNJejuBusApi.nearbyAt). */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const api=require("../src/js/jeju-bus-api.js"),transit=require("../src/js/nearby-transit.js");
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test("환승역은 점 하나로 합치고, 이름만 같은 먼 역은 따로 둔다",()=>{
  const list=transit.subwayStations({
    "1호선":{s:{"서울역":[37.5547,126.9707],"신길":[37.5175,126.9177]}},
    "4호선":{s:{"서울역":[37.5531,126.9726]}},
    "5호선":{s:{"양평":[37.5257,126.8862],"신길":[37.5170,126.9172]}},
    "경의중앙선":{s:{"양평":[37.4926,127.4916]}}});
  const find=(name,line)=>list.filter(e=>e.name===name && (!line || e.lines.includes(line)));
  assert.deepEqual(find("서울역")[0].lines,["1호선","4호선"]);
  assert.deepEqual(find("신길")[0].lines,["1호선","5호선"]);
  assert.equal(find("양평").length,2);
  assert.deepEqual(find("양평","경의중앙선")[0].lines,["경의중앙선"]);
});

test("실제 역 표에서도 환승역이 합쳐진다",()=>{
  const ctx={};vm.createContext(ctx);
  vm.runInContext(fs.readFileSync("src/js/subway-stations.js","utf8")+"\nglobalThis.lines=SUBWAY_LINES;",ctx);
  const list=transit.subwayStations(ctx.lines);
  const seoul=list.find(e=>e.name==="서울");    // 표의 이름은 끝의 '역'을 뗀 것
  assert.ok(seoul && seoul.lines.length>=2,"서울역은 여러 노선");
  assert.ok(list.length>400 && list.length<1000,String(list.length));
});

test("버스 조회 칸은 칸 안 어디서나 같은 가운데 좌표(소수 넷째 자리)로 묻는다",()=>{
  const a=transit.busCell(37.55471,126.97231),b=transit.busCell(a.at[0]+0.0015,a.at[1]-0.002);
  assert.equal(a.key,b.key);assert.deepEqual(a.at,b.at);
  for(const v of a.at)assert.equal(String(v),Number(v.toFixed(4)).toString());
  assert.notEqual(transit.busCell(a.at[0]+0.0061,a.at[1]).key,a.key);
});

test("화면을 덮는 칸들은 빈틈 없이 반경 500m 안에 들고, 가운데에서 가까운 차례로 16칸까지만",()=>{
  const view={south:37.548,west:126.955,north:37.562,east:126.99},center=[37.555,126.9725];
  const list=transit.busCells(view.south,view.west,view.north,view.east,center);
  assert.ok(list.length>1 && list.length<=16,String(list.length));
  assert.equal(new Set(list.map(c=>c.key)).size,list.length);
  const far=c=>Math.hypot((c.at[0]-center[0])*111000,(c.at[1]-center[1])*88000);
  for(let i=1;i<list.length;i++)assert.ok(far(list[i-1])<=far(list[i])+1e-6,"가까운 차례");
  // 화면 안 어느 점이든 어떤 칸 가운데에서 500m 안이다(가장자리 정류장도 잡힌다).
  for(let y=view.south;y<=view.north;y+=0.0007)for(let x=view.west;x<=view.east;x+=0.0007){
    const near=Math.min(...list.map(c=>Math.hypot((c.at[0]-y)*111000,(c.at[1]-x)*111000*Math.cos(y*Math.PI/180))));
    assert.ok(near<=500,y+","+x+" → "+near);
  }
  // 아주 넓은 화면은 가까운 16칸만.
  assert.equal(transit.busCells(37.4,126.8,37.7,127.2,center).length,16);
});

function asker(results){
  const calls=[];
  const ask=(kind,value,options)=>{calls.push({kind,value,city:options.city || ""});
    const r=results[options.city || ""];return r instanceof Error?Promise.reject(r):Promise.resolve(r || []);};
  return {calls,ask};
}
test("서울 경계에서 800m 넘게 떨어진 곳은 한쪽만, 경계 띠에서는 두 곳에 다 묻는다",async()=>{
  const where=at=>{const s=api.nearbySources(at);return (s.tago?"T":"")+(s.seoul?"S":"");};
  // 시청·잠실은 서울만, 광명시청·부천·고양 삼송·과천은 TAGO 만, 구리 갈매(경계에서 300m)는 둘 다.
  assert.equal(where([37.5665,126.978]),"S");assert.equal(where([37.5133,127.1001]),"S");
  assert.equal(where([37.4786,126.8646]),"T");assert.equal(where([37.4842,126.7829]),"T");
  assert.equal(where([37.6534,126.8955]),"T");assert.equal(where([37.429,126.9876]),"T");
  assert.equal(where([37.6338,127.1146]),"TS");
  assert.ok(api.seoulEdgeMetres([37.5665,126.978])>800);assert.ok(api.seoulEdgeMetres([37.4842,126.7829])<-800);
  const center=asker({"11":[{id:"02001",name:"시청",at:[37.5665,126.978],city:"11"}]});
  await api.nearbyAt([37.5665,126.978],{},center.ask);
  assert.deepEqual(center.calls.map(c=>c.city),["11"]);
  const jeju=asker({"":[{id:"JEB1",name:"제주",at:[33.5,126.53],city:""}]});
  const found=await api.nearbyAt([33.5,126.53],{jejuCodes:["39"]},jeju.ask);
  assert.deepEqual(jeju.calls.map(c=>c.city),[""]);assert.equal(found.length,1);
  const seoul=asker({"":[{id:"GGB1",name:"경계",at:[37.5,126.8],city:"31"},{id:"GGB2",name:"부천",at:[37.505,126.78],city:"31"}],
    "11":[{id:"14001",name:"경계",at:[37.50005,126.80005],city:"11"}]});
  const merged=await api.nearbyAt([37.5,126.81],{},seoul.ask);
  assert.deepEqual(seoul.calls.map(c=>c.city).sort(),["","11"]);
  // 양쪽에 다 실린 경계 정류장은 서울 쪽만 남는다.
  assert.deepEqual(merged.map(s=>s.id),["14001","GGB2"]);
});
test("한쪽만 실패하면 받은 쪽을, 둘 다 실패하면 서울 안쪽은 서울 오류를 낸다",async()=>{
  const half=asker({"":[{id:"GGB2",name:"부천",at:[37.505,126.78],city:"31"}],"11":new Error("bus-key-invalid")});
  assert.deepEqual((await api.nearbyAt([37.5,126.81],{},half.ask)).map(s=>s.id),["GGB2"]);
  const both=asker({"":new Error("bus-fetch-failed"),"11":new Error("bus-key-invalid")});
  await assert.rejects(()=>api.nearbyAt([37.5665,126.978],{},both.ask),error=>error.message==="bus-key-invalid" && error.city==="11");
  // 경계 띠 서울 쪽(안쪽 300m)은 서울 오류를, 바깥쪽 띠는 TAGO 오류를 낸다.
  await assert.rejects(()=>api.nearbyAt([37.48,126.83],{},both.ask),error=>error.city==="11");
  await assert.rejects(()=>api.nearbyAt([37.5,126.81],{},both.ask),error=>error.message==="bus-fetch-failed" && error.city==="");
  const tago=asker({"":new Error("bus-quota")});
  await assert.rejects(()=>api.nearbyAt([35.1,129.0],{},tago.ask),error=>error.message==="bus-quota" && error.city==="");
});

/* ── 화면 ── 가짜 DOM·Leaflet 으로 켜기, 확대 문턱, 칸 캐시, 정류장 도착 창을 본다. */
function harness({saved=null,zoom=16,center={lat:37.5547,lng:126.9707},nearby=null,view={lat:0.0005,lng:0.0005}}={}){
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.style={setProperty(){}};this.attrs={};this.handlers={};this.className="";this.textContent="";this.hidden=false;this.parentNode=null;
      this.classList={set:new Set(),add(c){this.set.add(c);},remove(c){this.set.delete(c);},toggle(c,on){if(on)this.set.add(c);else this.set.delete(c);},contains(c){return this.set.has(c);}};}
    append(...items){items.forEach(item=>this.appendChild(item));}
    appendChild(item){item.parentNode=this;this.children.push(item);return item;}
    insertBefore(item,ref){item.parentNode=this;const i=this.children.indexOf(ref);this.children.splice(i<0?this.children.length:i,0,item);return item;}
    replaceChildren(...items){this.children=[];this.append(...items);}
    get nextSibling(){const p=this.parentNode;if(!p)return null;return p.children[p.children.indexOf(this)+1] || null;}
    querySelector(){return null;}
    contains(node){for(let n=node;n;n=n.parentNode)if(n===this)return true;return false;}
    setAttribute(k,v){this.attrs[k]=v;}
    addEventListener(name,fn){this.handlers[name]=fn;}
    fire(name,event={}){return this.handlers[name]?.({preventDefault(){},stopPropagation(){},target:this,...event});}
    click(){return this.fire("click");}
    focus(){}
    remove(){this.removed=true;}
  }
  const timers=new Map();let timerId=0;
  const requests=[],pending=[],markers=[],stored={};
  if(saved)stored.mapNearbyTransit=JSON.stringify(saved);
  const docHandlers={};
  const doc=new Element("document");doc.createElement=tag=>new Element(tag);doc.hidden=false;
  doc.addEventListener=(name,fn)=>{docHandlers[name]=fn;};doc.removeEventListener=name=>{delete docHandlers[name];};
  const onMap=new Set();
  const map={handlers:{},zoom,center,
    getZoom(){return this.zoom;},getCenter(){return this.center;},
    getBounds(){const c=this.center;return {pad(){return {contains:at=>Math.abs(at[0]-c.lat)<0.02 && Math.abs(at[1]-c.lng)<0.025};},
      getSouthWest:()=>({lat:c.lat-view.lat,lng:c.lng-view.lng}),getNorthEast:()=>({lat:c.lat+view.lat,lng:c.lng+view.lng})};},
    createPane:()=>new Element("pane"),addLayer(layer){onMap.add(layer);},removeLayer(layer){onMap.delete(layer);},
    setView(at,zoom){this.center={lat:at[0],lng:at[1]};this.zoom=zoom;this.handlers.moveend?.();},
    on(name,fn){this.handlers[name]=fn;},off(name){delete this.handlers[name];},
    move(changes){Object.assign(this,changes);this.handlers.moveend?.();}};
  const layer=()=>{const group={items:new Set(),addTo(){onMap.add(group);return group;},clearLayers(){group.items.clear();},
    addLayer(x){group.items.add(x);},removeLayer(x){group.items.delete(x);},hasLayer(x){return group.items.has(x);}};return group;};
  const fakeMarker=(at,options)=>{const m={at,options,handlers:{},tip:null,
    bindTooltip(tip,opts){this.tip=tip;this.tipOptions=opts;return this;},unbindTooltip(){this.tip=null;return this;},on(name,fn){this.handlers[name]=fn;return this;}};markers.push(m);return m;};
  const tips=[];
  const L={DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},layerGroup:layer,divIcon:o=>o,marker:fakeMarker,circleMarker:fakeMarker,
    tooltip(options){const tip={options,setLatLng(at){this.at=at;return this;},setContent(c){this.content=c;return this;},update(){}};tips.push(tip);return tip;}};
  const fakeApi={...api,request(kind,value,options){
    requests.push({kind,value,options});
    if(kind==="nearby" && nearby)return Promise.resolve(nearby(value,options));
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});pending.push({kind,value,options,resolve,reject});return promise;}};
  const context={console,Date,Map,Set,AbortController,Promise,JSON,Math,Number,String,Object,Array,
    MNJejuBusApi:fakeApi,L,document:doc,window:{},SUBWAY_LINES:{
      "1호선":{s:{"서울역":[37.5547,126.9707],"남영":[37.5414,126.9713],"소요산":[37.9481,127.0612]}},
      "4호선":{s:{"서울역":[37.5531,126.9726]}}},
    localStorage:{getItem(k){return stored[k] ?? null;},setItem(k,v){stored[k]=v;}},
    fetch:async url=>({ok:true,text:async()=>url==="/can-proxy-jeju-bus"?"yes":""}),
    setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("src/js/nearby-transit.js","utf8")+"\nglobalThis.mod=MNNearbyTransit;",context);
  const stage=new Element("stage");stage.offsetParent={};
  const toolRow=new Element("tools"),documentModel={cleanupFns:[]};
  const picked=[],opened=[];
  const busController={pickRoute(stop,item){picked.push([stop.id,item.number]);},failureText:(e,f)=>e && e.message==="bus-quota"?"한도":f,colorFor:()=>"#123456",jejuCodes:()=>["39"]};
  const controller=context.mod.mount({map,stage,toolRow,doc:documentModel,bus:busController,subwayColors:{"1호선":"#0d3692"},
    subwayArrivals:(line,name)=>{opened.push([line,name]);return true;}});
  const wrap=toolRow.children[0],menu=wrap.children[1];
  const [subwayRow,busRow,hint]=menu.children;
  const panel=stage.children[0];
  const runTimers=()=>{const list=[...timers.values()];timers.clear();list.forEach(fn=>fn());};
  return {controller,map,stage,wrap,menu,hint,panel,stored,requests,pending,markers,picked,opened,runTimers,onMap,tips,
    subway:subwayRow.children[0],bus:busRow.children[0],trigger:wrap.children[0],
    toggle(box,on){box.checked=on;box.fire("change");}};
}

test("지하철역을 켜면 화면 둘레 역만 합쳐 찍고, 누르면 첫 노선으로 도착 창을 연다",async()=>{
  const h=harness({zoom:14});await flush();
  h.toggle(h.subway,true);
  assert.equal(JSON.parse(h.stored.mapNearbyTransit).subway,true);
  const stations=h.markers.filter(m=>m.options.title);
  assert.deepEqual(stations.map(m=>m.options.title).sort(),["남영","서울역"]);   // 소요산은 화면 밖
  assert.equal(h.trigger.classList.contains("is-on"),true);
  assert.match(h.hint.textContent,/지하철역 2곳/);
  stations.find(m=>m.options.title==="서울역").handlers.click();
  assert.deepEqual(h.opened,[["1호선","서울역"]]);
  // 멀리 축소하면 감춘다.
  h.map.move({zoom:11});assert.match(h.hint.textContent,/더 확대하면/);
  h.controller.destroy();
});

test("버스는 확대 16 이상에서 멈춘 뒤에만, 같은 칸은 다시 묻지 않는다",async()=>{
  const h=harness({zoom:15});await flush();
  h.toggle(h.bus,true);h.runTimers();await flush();
  assert.equal(h.requests.length,0);assert.match(h.hint.textContent,/버스 정류장은 더 확대하면/);
  h.map.move({zoom:16});
  assert.equal(h.requests.length,0,"옮기는 동안은 묻지 않는다");
  h.runTimers();await flush();
  // 서울 한가운데라 TAGO 는 건너뛰고 서울 API 에만 칸 가운데 좌표로 묻는다.
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.city,"11");
  assert.equal(JSON.stringify(h.requests[0].value),JSON.stringify(transit.busCell(37.5547,126.9707).at));
  h.pending[0].resolve([{id:"02001",name:"서울역버스환승센터",no:"02001",at:[37.5546,126.9723],city:"11"}]);
  await flush();
  assert.match(h.hint.textContent,/버스 정류장 1곳/);
  // 같은 칸 안에서 조금 옮기면 다시 묻지 않는다.
  h.map.move({center:{lat:37.5549,lng:126.9709}});h.runTimers();await flush();
  assert.equal(h.requests.length,1);
  h.controller.destroy();
});

test("넓은 화면은 가장자리 칸까지 두 개씩 차례로 묻고, 다시 옮기면 남은 줄을 버린다",async()=>{
  const view={lat:0.009,lng:0.016},center={lat:35.103,lng:129.003};
  const h=harness({center,view});await flush();
  h.toggle(h.bus,true);h.runTimers();await flush();
  const expected=transit.busCells(center.lat-view.lat,center.lng-view.lng,center.lat+view.lat,center.lng+view.lng,[center.lat,center.lng]);
  assert.ok(expected.length>4,String(expected.length));
  assert.equal(h.requests.length,2,"한꺼번에 둘씩");
  assert.deepEqual(h.requests.map(r=>JSON.stringify(r.value)),expected.slice(0,2).map(c=>JSON.stringify(c.at)));
  const edgeStop={id:"BSB9",name:"가장자리",no:"",at:[center.lat+0.008,center.lng+0.015],city:"21"};
  for(let i=0;i<expected.length;i++){h.pending[i].resolve(i===expected.length-1?[edgeStop]:[]);await flush();}
  assert.equal(h.requests.length,expected.length);
  assert.match(h.hint.textContent,/버스 정류장 1곳/);
  assert.ok(h.markers.some(m=>m.options.className==="map-transit-stop"));
  // 다 물은 화면은 다시 묻지 않는다.
  h.map.move({});h.runTimers();await flush();
  assert.equal(h.requests.length,expected.length);
  // 묻는 중에 옮기면 남은 칸은 버리고 새 화면 칸부터 묻는다.
  h.map.move({center:{lat:35.2,lng:129.2}});h.runTimers();await flush();
  const before=h.requests.length;
  h.map.move({center:{lat:35.3,lng:129.3}});h.runTimers();await flush();
  assert.equal(h.requests.length,before+2);
  h.controller.destroy();
});

test("정류장을 누르면 떠 있는 도착 창이 열리고, 노선을 누르면 버스 창에 넘긴다",async()=>{
  const h=harness({saved:{bus:true},center:{lat:33.5,lng:126.53},nearby:()=>[{id:"JEB1",name:"제주시청",no:"7",at:[33.5,126.53],city:""}]});
  await flush();h.runTimers();await flush();
  assert.equal(h.bus.checked,true);
  const stop=h.markers.find(m=>m.options.className==="map-transit-stop");
  assert.ok(stop);stop.handlers.click();
  const ask=h.pending.at(-1);assert.equal(ask.kind,"arrivals");assert.equal(ask.value,"JEB1");assert.equal(ask.options.city,"");
  ask.resolve({fetchedAt:Date.now(),items:[{routeId:"R1",number:"360",type:"간선",vehicleType:"",seconds:120,stops:3}]});
  await flush();
  const [head,list,status]=h.panel.children;
  assert.equal(h.panel.hidden,false);assert.equal(head.children[0].textContent,"제주시청 (7)");
  const pick=list.children[0].children[0];
  assert.equal(pick.children[0].style.backgroundColor,"#123456");
  pick.click();assert.deepEqual(h.picked,[["JEB1","360"]]);
  assert.match(status.textContent,/수신/);
  head.children[2].click();assert.equal(h.panel.hidden,true);
  h.controller.destroy();
});

test("한도·키 문제면 옮길 때마다 다시 묻지 않고, 다시 켜면 다시 묻는다",async()=>{
  const h=harness({center:{lat:35.103,lng:129.003}});await flush();
  h.toggle(h.bus,true);h.runTimers();await flush();
  h.pending.at(-1).reject(new Error("bus-quota"));await flush();
  assert.match(h.hint.textContent,/한도/);
  h.map.move({center:{lat:35.2,lng:129.1}});h.runTimers();await flush();
  assert.equal(h.requests.length,1);
  h.toggle(h.bus,false);h.toggle(h.bus,true);h.runTimers();await flush();
  assert.equal(h.requests.length,2);
  h.controller.destroy();
});

test("정류장에 마우스를 머물러야 도착 미리보기를 묻고, 받은 것은 잠시 다시 쓰며 한도면 그만 묻는다",async()=>{
  const h=harness({saved:{bus:true},center:{lat:33.5,lng:126.53},nearby:()=>[{id:"JEB1",name:"용문마을회관[동]",no:"7",at:[33.5,126.53],city:""}]});
  await flush();h.runTimers();await flush();
  const stop=h.markers.find(m=>m.options.className==="map-transit-stop");
  const asks=()=>h.requests.filter(r=>r.kind==="arrivals").length;
  // 스치고 지나가면 묻지 않는다.
  stop.handlers.mouseover();
  const card=h.tips.at(-1).content,[head]=card.children;
  assert.equal(head.children[1].textContent,"용문마을회관");
  assert.equal(head.children[2].textContent,"동");
  assert.equal(head.children[3].textContent,"7");
  assert.ok(h.onMap.has(h.tips.at(-1)));
  stop.handlers.mouseout();h.runTimers();await flush();
  assert.equal(asks(),0);assert.ok(!h.onMap.has(h.tips.at(-1)));
  // 머물면 묻고, 노선마다 가장 빠른 한 줄만 세 줄까지 보인다.
  stop.handlers.mouseover();h.runTimers();await flush();
  assert.equal(asks(),1);
  h.pending.at(-1).resolve({fetchedAt:Date.now(),items:[
    {number:"7",type:"간선",seconds:30,stops:1},{number:"7",type:"간선",seconds:600,stops:5},
    {number:"13",type:"지선",seconds:300,stops:3},{number:"20",type:"",seconds:900,stops:8},{number:"30",type:"",seconds:1200,stops:9}]});
  await flush();
  const tip=h.tips.at(-1).content,[,list,more]=tip.children;
  assert.deepEqual(list.children.map(li=>li.children[0].textContent),["7","13","20"]);
  assert.equal(list.children[0].className,"is-soon");
  assert.match(more.textContent,/외 1개/);
  // 곧 다시 올리면 묻지 않고 받은 것을 보인다.
  stop.handlers.mouseout();stop.handlers.mouseover();h.runTimers();await flush();
  assert.equal(asks(),1);assert.equal(h.tips.at(-1).content.children[1].children.length,3);
  h.controller.destroy();
});

test("미리보기에서 한도에 걸리면 다시 켤 때까지 이름만 보인다",async()=>{
  const h=harness({saved:{bus:true},center:{lat:33.5,lng:126.53},nearby:()=>[
    {id:"A",name:"가",no:"",at:[33.5,126.53],city:""},{id:"B",name:"나",no:"",at:[33.5001,126.53],city:""}]});
  await flush();h.runTimers();await flush();
  const [a,b]=h.markers.filter(m=>m.options.className==="map-transit-stop");
  const asks=()=>h.requests.filter(r=>r.kind==="arrivals").length;
  a.handlers.mouseover();h.runTimers();await flush();
  h.pending.at(-1).reject(new Error("bus-quota"));await flush();
  assert.match(h.tips.at(-1).content.children[2].textContent,/눌러서 도착 정보/);
  a.handlers.mouseout();b.handlers.mouseover();h.runTimers();await flush();
  assert.equal(asks(),1);
  b.handlers.mouseout();h.toggle(h.bus,false);h.toggle(h.bus,true);h.runTimers();await flush();
  const again=h.markers.filter(m=>m.options.className==="map-transit-stop").at(-1);
  again.handlers.mouseover();h.runTimers();await flush();
  assert.equal(asks(),2);
  h.controller.destroy();
});

test("점에서 카드로 옮겨 가면 카드가 남고, 카드를 누르면 전체 도착 창이 열린다",async()=>{
  const h=harness({saved:{bus:true},center:{lat:33.5,lng:126.53},nearby:()=>[{id:"JEB1",name:"제주시청",no:"7",at:[33.5,126.53],city:""}]});
  await flush();h.runTimers();await flush();
  const stop=h.markers.find(m=>m.options.className==="map-transit-stop");
  const asks=()=>h.requests.filter(r=>r.kind==="arrivals").length;
  stop.handlers.mouseover();
  const tip=h.tips.at(-1),card=tip.content;
  // 점을 떠나 카드에 올라오면 닫지 않고 바로 묻는다.
  stop.handlers.mouseout();card.fire("mouseenter");
  assert.equal(asks(),1);
  h.runTimers();await flush();
  assert.ok(h.onMap.has(tip),"카드에 있는 동안은 남는다");
  // 카드를 누르면 카드는 닫고 떠 있는 도착 창을 연다.
  card.fire("click");
  assert.ok(!h.onMap.has(tip));
  assert.equal(h.panel.hidden,false);assert.equal(asks(),2);
  // 카드에서도 벗어나면 잠시 뒤 닫힌다.
  stop.handlers.mouseover();const next=h.tips.at(-1);
  next.content.fire("mouseenter");next.content.fire("mouseleave");
  assert.ok(h.onMap.has(next));h.runTimers();assert.ok(!h.onMap.has(next));
  h.controller.destroy();
});

test("장소 말풍선의 주변 교통은 그 자리로 확대 16까지 다가가 지하철역·버스 정류장을 함께 켠다",async()=>{
  const h=harness({zoom:12});await flush();
  assert.equal(h.controller.showAround([37.5547,126.9707]),true);
  assert.equal(h.map.zoom,16);assert.equal(h.map.center.lat,37.5547);
  assert.equal(h.subway.checked,true);assert.equal(h.bus.checked,true);
  assert.deepEqual(JSON.parse(h.stored.mapNearbyTransit),{subway:true,bus:true});
  assert.ok(h.markers.some(m=>m.options.title==="서울역"));
  h.runTimers();await flush();
  assert.equal(h.requests.filter(r=>r.kind==="nearby").length,1,"버스 정류장도 그 자리 칸부터 찾는다");
  // 이미 더 확대해 두었으면 그 확대를 지킨다.
  h.map.zoom=18;h.controller.showAround([37.5548,126.9708]);assert.equal(h.map.zoom,18);
  h.controller.destroy();
});
