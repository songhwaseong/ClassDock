"use strict";
/* 버스 전국 도시·정류장 도착·근처 정류장(TAGO) — 응답 해석과 런처 주소 만들기. */
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../src/js/jeju-bus-api.js");
const tago=rows=>({response:{header:{resultCode:"00"},body:{items:rows.length?{item:rows.length===1?rows[0]:rows}:""}}});

test("도시 목록은 이름순이고 제주는 빈 코드로 바꾼다",()=>{
  const list=api.cities(tago([{citycode:25,cityname:"대전광역시"},{citycode:"39",cityname:"제주도"},
    {citycode:"x",cityname:"잘못"},{citycode:"22",cityname:"대구광역시"}]));
  assert.deepEqual(list.map(c=>c.code),["22","25",""]);
  assert.equal(list.find(c=>c.code==="").raw,"39");
  assert.deepEqual(api.cities(tago([])),[]);
});

test("도착 예정은 가까운 차례로, 빈 값은 0으로 읽지 않는다",()=>{
  const list=api.arrivals(tago([
    {routeid:"DJB1",routeno:"102",routetp:"간선버스",vehicletp:"저상버스",arrtime:"420",arrprevstationcnt:"3"},
    {routeid:"DJB2",routeno:"급행1",routetp:"급행버스",arrtime:45,arrprevstationcnt:1},
    {routeid:"DJB3",routeno:"마을5",arrtime:"",arrprevstationcnt:""}]));
  assert.deepEqual(list.map(a=>a.number),["급행1","102","마을5"]);
  assert.equal(list[2].seconds,null);assert.equal(list[2].stops,null);
  assert.equal(api.arrivalText(list[0]),"곧 도착 · 1정류장 전");
  assert.equal(api.arrivalText(list[1]),"7분 후 · 3정류장 전");
  assert.equal(api.arrivalText(list[2]),"도착 정보 없음");
});

test("근처 정류장은 좌표 없는 줄을 버리고 제주 도시코드를 빈 코드로 바꾼다",()=>{
  const list=api.nearby(tago([
    {citycode:"39",nodeid:"JEB1",nodenm:"제주시청",nodeno:"1",gpslati:33.49,gpslong:126.53},
    {citycode:"25",nodeid:"DJB9",nodenm:"대전역",gpslati:"36.33",gpslong:"127.43"},
    {citycode:"25",nodeid:"DJB8",nodenm:"빈 좌표",gpslati:"",gpslong:""},
    {citycode:"25",nodeid:"bad id",nodenm:"x",gpslati:36.3,gpslong:127.4}]),["39"]);
  assert.deepEqual(list.map(s=>[s.id,s.city]),[["JEB1",""],["DJB9","25"]]);
  assert.deepEqual(list[1].at,[36.33,127.43]);
});

test("전국 좌표와 글자가 든 노선 번호를 받는다",()=>{
  assert.deepEqual(api.coords({gpslati:37.56,gpslong:126.97}),[37.56,126.97]);
  assert.equal(api.coords({gpslati:0,gpslong:0}),null);
  for(const ok of ["201","43-1","마을1","급행2","B1"])assert.equal(api.validNumber(ok),true,ok);
  for(const bad of ["","-","1;2","1 2","x".repeat(21)])assert.equal(api.validNumber(bad),false,bad);
  const data=api.catalog({routes:[["마을2","a","b",1],["101","a","b",1],["마을1","a","b",1],["1;2","a","b",1]]});
  assert.deepEqual(data.routes.map(r=>r.number),["101","마을1","마을2"]);
  assert.deepEqual(api.catalogGroups(data.routes).map(g=>[g.prefix,g.hundred,g.routes.length]),[["",100,1],["마을",0,2]]);
});

test("런처 주소에 도시를 붙이고, 근처·도시 목록은 도시 없이 묻는다",async()=>{
  const original=global.fetch,urls=[];
  const ok=body=>({ok:true,status:200,headers:new Headers({"X-ClassDock-Bus-Fetched-At":"2026-09-18T01:00:00Z"}),json:async()=>body});
  try{
    global.fetch=async url=>{urls.push(url);return ok(tago([]));};
    await api.request("routes","마을1",{city:"25"});
    await api.request("routes","201");
    await api.request("arrivals","DJB8001",{city:"25"});
    await api.request("nearby",[36.33291,127.43409],{city:"25"});
    await api.request("cities","");
    await api.loadCatalog({city:"25"}).catch(()=>{});
    assert.deepEqual(urls,[
      "/jeju-bus-routes?keyword="+encodeURIComponent("마을1")+"&city=25",
      "/jeju-bus-routes?keyword=201",
      "/jeju-bus-arrivals?nodeId=DJB8001&city=25",
      "/jeju-bus-nearby?lat=36.3329&lng=127.4341",
      "/jeju-bus-cities",
      "/jeju-bus-catalog?city=25"]);
    await assert.rejects(()=>api.request("routes","201",{city:"25&x=1"}),/bus-bad-request/);
    await assert.rejects(()=>api.request("nearby",[0,0]),/bus-bad-request/);
    await assert.rejects(()=>api.request("arrivals","../x"),/bus-bad-request/);
    const arrived=await api.request("arrivals","DJB8001",{city:"25"});
    assert.equal(arrived.fetchedAt,Date.parse("2026-09-18T01:00:00Z"));assert.deepEqual(arrived.items,[]);
  }finally{global.fetch=original;}
});
