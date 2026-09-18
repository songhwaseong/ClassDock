"use strict";
/* 서울 버스(ws.bus.go.kr, 도시코드 11) — 응답 해석과 런처 주소 만들기.
   위치(getBusPosByRtid) 줄은 2026-09-19 실제 응답에서 뽑았다. 노선·정류소 조회는 아직 키로 받아 보지 못해 문서의 필드 이름을 따랐다. */
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../src/js/jeju-bus-api.js");
const seoul=list=>({comMsgHeader:{},msgHeader:{headerMsg:"정상적으로 처리되었습니다.",headerCd:"0",itemCount:0},msgBody:{itemList:list}});

test("서울 응답: 결과 없음(4)은 빈 목록, 그 밖의 코드는 잘못된 자료",()=>{
  assert.deepEqual(api.seoulRows({msgHeader:{headerCd:"4"},msgBody:null}),[]);
  assert.deepEqual(api.seoulRows(seoul(null)),[]);
  assert.deepEqual(api.seoulRows(seoul({a:1})),[{a:1}]);
  assert.throws(()=>api.seoulRows({msgHeader:{headerCd:"7"}}),/bus-invalid-data/);
  assert.throws(()=>api.seoulRows({response:{header:{resultCode:"00"}}}),/bus-invalid-data/);
});

test("서울 버스 위치: gpsX 는 경도, 번호판을 이름으로",()=>{
  const result=api.seoulPositions(seoul([
    {sectOrd:"7",gpsX:"126.921014",gpsY:"37.618821",vehId:"111033352",plainNo:"서울75사2644",lastStnId:"111001109",congetion:"3"},
    {gpsX:"0",gpsY:"0",vehId:"1",plainNo:"빈좌표"}]),"100100118",Date.parse("2026-09-19T00:00:00Z"));
  assert.equal(result.provider,"seoul");assert.equal(result.routeKey,"seoul:100100118");
  assert.equal(result.vehicles.length,1);
  assert.deepEqual(result.vehicles[0].at,[37.618821,126.921014]);
  assert.equal(result.vehicles[0].label,"서울75사2644");assert.equal(result.vehicles[0].stationId,"111001109");
});

test("서울 노선 검색은 같은 번호만, 노선 종류 코드를 이름으로",()=>{
  const list=api.seoulRoutes(seoul([
    {busRouteId:"100100063",busRouteNm:"402",stStationNm:"장지공영차고지",edStationNm:"광화문",routeType:"3"},
    {busRouteId:"100100596",busRouteNm:"N402",stStationNm:"a",edStationNm:"b",routeType:"3"},
    {busRouteId:"100100063",busRouteNm:"402",stStationNm:"중복",edStationNm:"중복",routeType:"3"}]),"402");
  assert.deepEqual(list.map(r=>[r.id,r.number,r.from,r.to,r.type]),[["100100063","402","장지공영차고지","광화문","간선"]]);
});

test("서울 노선 정류장: 순번대로, 가상 정류장(arsId 0)은 도착 정보를 묻지 않는다",()=>{
  const list=api.seoulRoute(seoul([
    {seq:"2",station:"111000002",stationNm:"둘째",arsId:"02002",gpsX:"126.98",gpsY:"37.56"},
    {seq:"1",station:"111000001",stationNm:"첫째",arsId:"02001",gpsX:"126.97",gpsY:"37.55"},
    {seq:"3",station:"111000003",stationNm:"가상",arsId:"0",gpsX:"126.99",gpsY:"37.57"}]));
  assert.deepEqual(list.map(s=>[s.id,s.name,s.stId]),[["02001","첫째","111000001"],["02002","둘째","111000002"],["","가상","111000003"]]);
});

test("서울 도착 안내 글 읽기",()=>{
  assert.deepEqual(api.seoulArrival("3분12초후[2번째 전]"),{seconds:192,stops:2,message:""});
  assert.deepEqual(api.seoulArrival("45초후[1번째 전]"),{seconds:45,stops:1,message:""});
  assert.deepEqual(api.seoulArrival("곧 도착"),{seconds:0,stops:null,message:""});
  assert.deepEqual(api.seoulArrival("출발대기"),{seconds:null,stops:null,message:"출발대기"});
  assert.equal(api.seoulArrival(""),null);
});

test("서울 정류장 도착: 첫째·둘째 차를 두 줄로, 시간 없는 둘째 차는 뺀다",()=>{
  const list=api.seoulArrivals(seoul([
    {rtNm:"402",busRouteId:"100100063",routeType:"3",arrmsg1:"5분3초후[3번째 전]",arrmsg2:"12분후[7번째 전]",busType1:"1",busType2:"0"},
    {rtNm:"7016",busRouteId:"100100341",routeType:"4",arrmsg1:"곧 도착",arrmsg2:"운행종료",busType1:"0"},
    {rtNm:"N16",busRouteId:"100100500",routeType:"3",arrmsg1:"운행종료",arrmsg2:"운행종료"}]));
  assert.deepEqual(list.map(a=>[a.number,a.seconds]),[["7016",0],["402",303],["402",720],["N16",null]]);
  assert.equal(list[1].vehicleType,"저상");assert.equal(list[1].type,"간선");
  assert.equal(api.arrivalText(list[3]),"운행종료");
  assert.equal(api.arrivalText(list[1]),"5분 후 · 3정류장 전");
});

test("서울 근처 정류장은 arsId 를 ID·번호로, 도시는 11",()=>{
  const list=api.seoulNearby(seoul([
    {stationId:"102000001",stationNm:"서울역버스환승센터",arsId:"02001",gpsX:"126.9723",gpsY:"37.5546",dist:"40"},
    {stationId:"102000009",stationNm:"가상",arsId:"0",gpsX:"126.97",gpsY:"37.55"}]));
  assert.deepEqual(list.map(s=>[s.id,s.no,s.city]),[["02001","02001","11"]]);
});

test("서울은 근처 정류장에도 도시를 붙여 묻고, 서울 모양으로 읽는다",async()=>{
  const original=global.fetch,urls=[];
  try{
    global.fetch=async url=>{urls.push(url);return {ok:true,status:200,headers:new Headers({"X-ClassDock-Bus-Fetched-At":"2026-09-19T01:00:00Z"}),
      json:async()=>seoul([{stationId:"1",stationNm:"서울역",arsId:"02001",gpsX:"126.97",gpsY:"37.55",busRouteId:"100100063",busRouteNm:"402",rtNm:"402",arrmsg1:"곧 도착"}])};};
    const near=await api.request("nearby",[37.5546,126.9723],{city:"11"});
    const routes=await api.request("routes","402",{city:"11"});
    const arrived=await api.request("arrivals","02001",{city:"11"});
    assert.deepEqual(urls,["/jeju-bus-nearby?lat=37.5546&lng=126.9723&city=11","/jeju-bus-routes?keyword=402&city=11","/jeju-bus-arrivals?nodeId=02001&city=11"]);
    assert.equal(near[0].id,"02001");assert.equal(routes[0].id,"100100063");assert.equal(arrived.items[0].seconds,0);
  }finally{global.fetch=original;}
});
