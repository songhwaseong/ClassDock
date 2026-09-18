"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const api=require("../src/js/jeju-bus-api.js"),live=require("../src/js/jeju-bus-live.js");
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness(){
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.style={};this.attrs={};this.handlers={};this.className="";this.textContent="";this.value="";this.offsetParent={};this.classList={add(){},remove(){},toggle(){}};}
    append(...items){items.forEach(item=>this.appendChild(item));}
    appendChild(item){this.children.push(item);if(this.tagName==="select" && this.children.length===1)this.value=item.value;return item;}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(k,v){this.attrs[k]=v;}
    addEventListener(name,fn){this.handlers[name]=fn;}
    removeEventListener(name){delete this.handlers[name];}
    fire(name,event={}){return this.handlers[name]?.({preventDefault(){},stopPropagation(){},...event});}
    click(){return this.fire("click");}
    focus(){}
    remove(){this.removed=true;}
  }
  const requests=[],groups=[],circles=[],intervals=new Set(),frames=new Map(),pending=[];let now=1000000,frameId=0;
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const doc=new Element("document");doc.createElement=tag=>new Element(tag);doc.hidden=false;
  const map={handlers:{},getCenter:()=>({lat:33.5,lng:126.53}),createPane:()=>new Element("pane"),removeLayer(){},getZoom:()=>14,
    fitBounds(){this.fitCount=(this.fitCount||0)+1;},on(name,fn){this.handlers[name]=fn;},off(name){delete this.handlers[name];}};
  const L={DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},latLngBounds:p=>p,divIcon:o=>o,
    layerGroup(){const group={items:[],addTo(){return this;},clearLayers(){this.items=[];},addLayer(x){this.items.push(x);},removeLayer(x){this.items=this.items.filter(i=>i!==x);}};groups.push(group);return group;},
    marker(at){const element=new Element("marker");return {at,bindTooltip(tip){this.tip=tip;return this;},setLatLng(p){this.at=p;},setOpacity(v){this.opacity=v;},getElement(){return element;}};},
    circleMarker(at,options){const marker={at,options,handlers:{},bindTooltip(){return this;},on(name,fn){this.handlers[name]=fn;return this;}};circles.push(marker);return marker;},polyline:p=>({points:p})};
  const cityList=[{code:"",name:"제주도",raw:"39"},{code:"25",name:"대전광역시",raw:"25"}];
  const catalogJobs=[],catalogJobOptions=[],catalogLoads=[],cityCatalogs={};let catalogFile=null,catalogState={state:"idle",error:"",done:0,total:1999,found:0,busy:false};
  const fakeApi={...api,
    loadCatalog(options={}){catalogLoads.push(options.city || "");return Promise.resolve(options.city?cityCatalogs[options.city] || null:catalogFile);},
    catalogJob(action,options={}){catalogJobs.push(action);catalogJobOptions.push(options);return Promise.resolve(catalogState);},
    request(kind,value,options){requests.push({kind,value,options});
    if(kind==="routes")return Promise.resolve([{id:"1",number:"201",from:"A",to:"B",type:"간선"},{id:"2",number:"201",from:"B",to:"A",type:"간선"}]);
    if(kind==="route")return Promise.resolve([{id:"s",name:"stop",at:[33.3,126.5]}]);
    if(kind==="cities")return Promise.resolve(cityList);
    const task=deferred();pending.push({task,request:requests.at(-1)});return task.promise;}};
  const confirms=[];let confirmAnswer=true;
  const context={console,Date:Clock,Map,Set,AbortController,Promise,MNJejuBusApi:fakeApi,MNJejuBusLive:live,L,document:doc,
    MNJejuBusRouteCatalog:{updatedAt:"2026-09-16",routes:[["201","제주","서귀포",2],["331","제주","동부",1],["1111","제주","한라산",1]]},
    confirmDialog(message){confirms.push(message);return Promise.resolve(confirmAnswer);},
    window:{matchMedia:()=>({matches:false})},localStorage:{getItem(){return null;},setItem(){}},fetch:async()=>({ok:true,text:async()=>"yes"}),
    setInterval(fn){intervals.add(fn);return fn;},clearInterval(fn){intervals.delete(fn);},requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);}};
  vm.createContext(context);vm.runInContext(fs.readFileSync("src/js/jeju-bus-map.js","utf8")+"\nglobalThis.busModule=MNJejuBusMap;",context);
  const stage=new Element("stage"),toolRow=new Element("tools"),documentModel={cleanupFns:[]};
  const controller=context.busModule.mount({map,stage,toolRow,doc:documentModel});
  const panel=stage.children[0],form=panel.children[1],catalogRow=panel.children[2],select=panel.children[3],actions=panel.children[5];
  return {controller,doc:documentModel,document:doc,stage,map,groups,requests,pending,intervals,frames,form,select,
    panel,actions,start:actions.children[0],status:panel.children[6],button:toolRow.children[0],
    catalogSelect:form.children[0],input:form.children[1],catalogText:catalogRow.children[0],
    catalogRefresh:catalogRow.children[1],catalogCancel:catalogRow.children[2],catalogJobs,catalogJobOptions,catalogLoads,cityCatalogs,confirms,
    citySelect:panel.children[0].children[1],stopBox:panel.children[7],circles,
    setCatalogState(state){catalogState={...catalogState,...state};},setCatalogFile(file){catalogFile=file;},
    answerConfirm(value){confirmAnswer=value;},
    tick(ms=1000){now+=ms;for(const fn of intervals)fn();},now:()=>now};
}
const body=(id,at,x=126.5)=>api.positions({response:{header:{resultCode:"00"},body:{items:{item:{vehicleno:"bus",gpslati:33.3,gpslong:x,nodeid:"s1",nodenm:"stop"}}}}},id,at);
test("노선 변경 후 늦은 응답을 무시하고 지도를 닫으면 요청·타이머를 정리한다",async()=>{
  const h=harness();await flush();assert.equal(h.button.disabled,false);
  await h.form.fire("submit");h.start.click();assert.equal(h.pending.length,1);const old=h.pending[0];
  h.select.value="2";await h.select.fire("change");assert.equal(old.request.options.signal.aborted,true);
  h.start.click();old.task.resolve(body("1",h.now()));await flush();assert.equal(h.groups[0].items.length,0);
  h.pending[1].task.resolve(body("2",h.now()));await flush();assert.equal(h.groups[0].items.length,1);
  const fits=h.map.fitCount;h.tick(31000);h.pending[2].task.resolve(body("2",h.now(),126.5001));await flush();assert.equal(h.map.fitCount,fits);
  h.tick(31000);const last=h.pending.at(-1);
  assert.equal(h.actions.children.some(button=>button.textContent==="끄기"),false);
  assert.equal(h.button.attrs["aria-pressed"],"true");h.button.click();
  assert.equal(last.request.options.signal.aborted,true);assert.equal(h.button.attrs["aria-pressed"],"false");
  assert.equal(h.button.attrs["aria-expanded"],"false");assert.equal(h.panel.hidden,true);
  assert.equal(h.groups[0].items.length,0);assert.equal(h.groups[1].items.length,0);assert.equal(h.frames.size,0);
  const requestCount=h.pending.length;h.tick(60000);assert.equal(h.pending.length,requestCount);
  last.task.resolve(body("2",h.now()));await flush();assert.equal(h.groups[0].items.length,0);
  h.button.click();assert.equal(h.panel.hidden,false);h.start.click();assert.equal(h.button.attrs["aria-pressed"],"true");
  const restarted=h.pending.at(-1);h.doc.cleanupFns.forEach(fn=>fn());
  assert.equal(restarted.request.options.signal.aborted,true);assert.equal(h.intervals.size,0);
  restarted.task.resolve(body("2",h.now()));await flush();assert.equal(h.groups[0].items.length,0);
});
test("숨긴 지도는 요청을 중지하고 복귀 시 갱신하며 캡처 고정 중에는 응답을 적용하지 않는다",async()=>{
  const h=harness();await h.form.fire("submit");h.start.click();h.tick();
  h.document.hidden=true;h.tick();assert.equal(h.pending[0].request.options.signal.aborted,true);
  const count=h.pending.length;h.tick(60000);assert.equal(h.pending.length,count);
  h.document.hidden=false;h.tick();assert.equal(h.pending.length,count+1);
  const resume=h.controller.freeze();h.pending.at(-1).task.resolve(body("1",h.now()));await flush();assert.equal(h.groups[0].items.length,0);
  h.tick(60000);assert.equal(h.pending.length,count+1);resume();assert.equal(h.pending.length,count+2);
  h.pending.at(-1).task.resolve(body("1",h.now()));await flush();assert.equal(h.groups[0].items.length,1);
  assert.match(h.controller.captureNote(),/TAGO/);h.controller.destroy();
});
test("서버 실패는 운행 차량 없음과 구분하고 재시도 간격을 지킨다",async()=>{
  const h=harness();await h.form.fire("submit");h.tick();h.start.click();
  const error=new Error("failed");error.retryAfterMs=120000;h.pending[0].task.reject(error);await flush();
  h.tick(31000);assert.equal(h.pending.length,1);assert.match(h.status.textContent,/받지 못/);
  h.tick(90000);assert.equal(h.pending.length,2);h.controller.destroy();
});
test("인증키가 없으면 다시 시도한다고 하지 않고 설정을 안내한다",async()=>{
  const h=harness();await h.form.fire("submit");h.start.click();
  h.pending[0].task.reject(new Error("bus-key-required"));await flush();
  assert.match(h.status.textContent,/버스 실시간/);assert.doesNotMatch(h.status.textContent,/다시 시도/);
  assert.equal(h.requests.some(r=>r.kind==="shape"),false);
  h.controller.destroy();
});
test("노선 목록에서 고르면 번호를 채워 검색하고, 최신화는 확인을 받은 뒤에만 시작한다",async()=>{
  const h=harness();await flush();
  const numbers=h.catalogSelect.children.flatMap(node=>node.children || []).map(option=>option.value);
  assert.deepEqual(numbers,["201","331","1111"]);
  assert.match(h.catalogText.textContent,/앱에 들어 있는 노선 목록/);
  h.catalogSelect.value="331";await h.catalogSelect.fire("change");
  assert.equal(h.input.value,"331");
  assert.deepEqual(h.requests.filter(r=>r.kind==="routes").map(r=>r.value),["331"]);
  h.answerConfirm(false);await h.catalogRefresh.click();await flush();
  assert.equal(h.confirms.length,1);assert.equal(h.catalogJobs.includes("refresh"),false);
  h.answerConfirm(true);h.setCatalogState({state:"running",done:12,total:1999,found:3});
  await h.catalogRefresh.click();await flush();
  assert.match(h.catalogText.textContent,/12\/1999/);assert.equal(h.catalogCancel.hidden,false);
  h.setCatalogFile({updatedAt:"2026-09-20",routes:[{number:"500",from:"서귀포",to:"제주",count:2}]});
  h.setCatalogState({state:"done"});h.tick(1000);await flush();
  assert.equal(h.catalogSelect.children.at(-1).children[0].value,"500");
  assert.match(h.catalogText.textContent,/최신화한 노선 목록/);
  assert.equal(h.catalogCancel.hidden,true);
  h.controller.destroy();
});
test("최신화가 실패하거나 멈추면 예전 목록을 그대로 둔다",async()=>{
  const h=harness();await flush();
  h.answerConfirm(true);h.setCatalogState({state:"running",done:5,total:1999,found:1});
  await h.catalogRefresh.click();await flush();
  h.setCatalogState({state:"failed",error:"bus-catalog-too-few"});h.tick(1000);await flush();
  assert.match(h.catalogText.textContent,/앱에 들어 있는 노선 목록/);
  assert.match(h.catalogText.textContent,/너무 적어/);
  assert.equal(h.catalogSelect.children.flatMap(node=>node.children || []).length,3);
  assert.equal(h.catalogRefresh.disabled,false);
  h.controller.destroy();
});
test("API 어댑터는 런처 캐시 시각과 Retry-After를 보존한다",async()=>{
  const original=global.fetch;let requested;
  try{
    global.fetch=async(url,options)=>{requested={url,options};return {ok:true,headers:new Headers({"X-ClassDock-Bus-Fetched-At":"2026-09-12T03:34:16.000Z","X-ClassDock-Bus-Stale":"1","Retry-After":"120"}),json:async()=>({response:{header:{resultCode:"00"},body:{items:""}}})};};
    const result=await api.request("position","JJB405320111");assert.equal(result.fetchedAt,Date.parse("2026-09-12T03:34:16Z"));assert.equal(result.stale,true);assert.equal(result.retryAfterMs,120000);
    assert.equal(requested.url,"/jeju-bus-position?routeId=JJB405320111");assert.equal(requested.options.cache,"no-store");
    await assert.rejects(()=>api.request("position","https://example.com"));
    await assert.rejects(()=>api.request("shape","JJB1"));
    // 키가 없으면 런처가 428 과 까닭을 준다 — 그 까닭을 그대로 오류 이름으로 넘긴다.
    global.fetch=async()=>({ok:false,status:428,headers:new Headers({"Retry-After":"30"}),text:async()=>"bus-key-required"});
    await assert.rejects(()=>api.request("position","JJB1"),error=>error.message==="bus-key-required" && error.retryAfterMs===30000);
    global.fetch=async()=>({ok:false,status:503,headers:new Headers(),text:async()=>"<html>"});
    await assert.rejects(()=>api.request("route","JJB1"),/bus-fetch-failed/);
  }finally{global.fetch=original;}
});
test("도시를 바꾸면 보던 노선을 끄고 그 도시 목록·검색으로 옮긴다",async()=>{
  const h=harness();await flush();
  assert.equal(h.citySelect.children.map(o=>o.value).join(","),",25");
  await h.form.fire("submit");h.start.click();assert.equal(h.button.attrs["aria-pressed"],"true");
  h.cityCatalogs["25"]={updatedAt:"2026-09-18",routes:[{number:"마을1",from:"a",to:"b",count:1}]};
  h.citySelect.value="25";h.citySelect.fire("change");await flush();
  assert.equal(h.button.attrs["aria-pressed"],"false");assert.equal(h.pending[0].request.options.signal.aborted,true);
  assert.equal(h.catalogLoads.at(-1),"25");
  assert.equal(h.catalogSelect.children.flatMap(node=>node.children || []).map(o=>o.value).join(","),"마을1");
  h.catalogSelect.value="마을1";await h.catalogSelect.fire("change");await flush();
  const search=h.requests.filter(r=>r.kind==="routes").at(-1);
  assert.equal(search.value,"마을1");assert.equal(search.options.city,"25");
  assert.equal(h.requests.filter(r=>r.kind==="route").at(-1).options.city,"25");
  // 다른 도시는 비교할 기본 목록이 없으니 최소 1개만 찾으면 된다.
  h.answerConfirm(true);await h.catalogRefresh.click();await flush();
  const job=h.catalogJobOptions.at(-1);assert.equal(job.minimum,1);assert.equal(job.city,"25");
  h.controller.destroy();
});
test("근처 정류장을 찾고 정류장을 누르면 그 도시로 도착 정보를 묻고, 노선을 누르면 검색한다",async()=>{
  const h=harness();await flush();
  const [tools,list,arrivalBox]=h.stopBox.children,nearby=tools.children[0];
  assert.equal(nearby.disabled,false);
  nearby.click();
  const ask=h.pending.at(-1);assert.equal(ask.request.kind,"nearby");
  assert.equal(JSON.stringify(ask.request.value),"[33.5,126.53]");assert.equal(JSON.stringify(ask.request.options.jejuCodes),"[\"39\"]");
  ask.task.resolve([{id:"DJB9",name:"먼 정류장",no:"",at:[33.51,126.53],city:"25"},{id:"JEB1",name:"가까운 정류장",no:"7",at:[33.5001,126.53],city:""}]);
  await flush();
  assert.equal(list.children[0].textContent.startsWith("가까운 정류장 (7)"),true);
  // 지금 도시(제주)가 아닌 정류장엔 도시 이름이 붙는다.
  assert.match(list.children[1].textContent,/먼 정류장 · 대전광역시 · \d+m/);assert.doesNotMatch(list.children[0].textContent,/제주/);
  assert.equal(h.circles.filter(c=>c.options.fillColor).length,2);
  list.children[1].click();
  const arrivals=h.pending.at(-1);assert.equal(arrivals.request.kind,"arrivals");
  assert.equal(arrivals.request.value,"DJB9");assert.equal(arrivals.request.options.city,"25");
  arrivals.task.resolve({fetchedAt:h.now(),items:[{routeId:"DJB1",number:"102",type:"간선버스",vehicleType:"",seconds:300,stops:2}]});
  await flush();
  const [head,rows]=arrivalBox.children;
  assert.equal(arrivalBox.hidden,false);assert.equal(head.children[0].textContent,"먼 정류장");
  const pick=rows.children[0].children[0];assert.equal(pick.children[1].textContent,"5분 후 · 2정류장 전");
  pick.click();await flush();
  assert.equal(h.citySelect.value,"25");assert.equal(h.input.value,"102");
  const search=h.requests.filter(r=>r.kind==="routes").at(-1);assert.equal(search.value,"102");assert.equal(search.options.city,"25");
  // 닫으면 정류장 점과 도착 칸을 치운다.
  h.panel.children[0].children[2].click();assert.equal(arrivalBox.hidden,true);assert.equal(list.hidden,true);
  h.controller.destroy();
});
test("도착 정보 키가 거절되면 버스도착정보 활용신청을 안내한다",async()=>{
  const h=harness();await flush();
  const [tools,list,arrivalBox]=h.stopBox.children;
  tools.children[0].click();h.pending.at(-1).task.resolve([{id:"JEB1",name:"정류장",no:"",at:[33.5,126.53],city:""}]);await flush();
  list.children[0].click();h.pending.at(-1).task.reject(new Error("bus-key-invalid"));await flush();
  assert.match(arrivalBox.children[2].textContent,/버스도착정보/);
  h.controller.destroy();
});
