"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../src/js/jeju-bus-api.js"),live=require("../src/js/jeju-bus-live.js");
const observations=require("./fixtures/jeju-bus-observations.json");
const id="JJB405320111",base=1000000;
// TAGO 응답 봉투. 한 건이면 item 이 객체, 없으면 items 가 빈 문자열로 온다.
const tago=(rows,code="00")=>({response:{header:{resultCode:code,resultMsg:"NORMAL SERVICE."},
  body:{items:!Array.isArray(rows)?{item:rows}:rows.length?{item:rows}:"",numOfRows:300,pageNo:1,totalCount:Array.isArray(rows)?rows.length:1}}});
const row=(v=1,x=126.5,y=33.3,station=1)=>({vehicleno:"test"+v,gpslong:x,gpslati:y,nodeid:"JJB"+station,nodenm:"stop"+station,nodeord:station,routenm:201,routetp:"간선버스"});
const response=(rows,at)=>api.positions(tago(rows),id,at);
// 제주 사이트에서 잰 실측 표본을 TAGO 필드 이름으로 옮겨 쓴다(좌표·차량번호·정류장은 그대로).
const fromSite=r=>({vehicleno:r.plateNo,gpslong:r.localX,gpslati:r.localY,nodeid:String(r.currStationId),nodenm:r.currStationNm});
test("실측: 좌표 갱신·정류장만 갱신·큰 점프를 구분한다",()=>{
  const state=live.create();
  for(const sample of observations)live.ingest(state,response(sample.rows.map(fromSite),sample.at),sample.at,null);
  const still=state.vehicles.get("tago:"+id+":제주79아3077"),moved=state.vehicles.get("tago:"+id+":제주79아3202");
  assert.equal(still.coordinateSince,observations[0].at);assert.equal(still.lastCoordinateChangedAt,null);
  assert.equal(still.stationPending,true);assert.equal(moved.lastCoordinateChangedAt,observations[2].at);
  assert.deepEqual(moved.at,[33.284879,126.74115]);assert.equal(still.animation,null);
});
test("좌표를 재수신해도 좌표 변화시각은 보존하고 GPS 측정시각은 null이다",()=>{
  const state=live.create();live.ingest(state,response([row()],base),base,null);
  live.ingest(state,response([row()],base+100000),base+100000,null);
  const bus=[...state.vehicles.values()][0];assert.equal(bus.coordinateSince,base);assert.equal(bus.observedAt,null);
  assert.equal(live.view(bus,base+100000).status,"위치 변화 확인 안 됨");
});
test("캐시·역순·다른 노선 응답은 이력과 누락 횟수를 바꾸지 않는다",()=>{
  const state=live.create();live.ingest(state,response([row(),row(2)],base),base,null);
  const cached=response([row()],base);assert.equal(live.ingest(state,cached,base+60000,null),false);
  assert.equal([...state.vehicles.values()][1].missing,0);
  assert.equal(live.ingest(state,response([],base-1),base,null),false);
  assert.equal(live.ingest(state,api.positions(tago([]),"JJB2",base+1),base+1,null),false);assert.equal(state.vehicles.size,2);
});
test("한 번 누락은 흐리게, 두 번 누락은 제거, 정상 빈 응답은 즉시 비운다",()=>{
  const state=live.create();live.ingest(state,response([row(),row(2)],base),base,null);
  live.ingest(state,response([row()],base+30000),base+30000,null);
  assert.equal(live.view([...state.vehicles.values()][1],base+30000).dim,true);
  live.ingest(state,response([row()],base+60000),base+60000,null);assert.equal(state.vehicles.size,1);
  live.ingest(state,response([],base+90000),base+90000,null);assert.equal(state.vehicles.size,0);
});
test("지연 2분은 흐리게, 5분은 숨기고 새 응답으로 복원한다",()=>{
  const state=live.create();live.ingest(state,response([row()],base),base,null);const bus=[...state.vehicles.values()][0];
  assert.equal(live.view(bus,base+120000).dim,true);assert.equal(live.view(bus,base+300000),null);
  live.ingest(state,response([row()],base+310000),base+310000,null);assert.equal(live.view([...state.vehicles.values()][0],base+310000).dim,false);
});
test("잘못된 응답·좌표를 빈 운행 정보로 해석하지 않는다",()=>{
  for(const rows of [[row(1,0,0)],[{error:"failed"}]])assert.throws(()=>response(rows,base));
  // 봉투가 아니거나 오류 코드(22 한도·30 키)면 '차량 없음'이 아니라 오류다.
  for(const body of [null,{},"error",[row()],tago([row()],"22"),tago([row()],"30"),{response:{header:{resultCode:"00"}}}])
    assert.throws(()=>api.positions(body,id,base));
  assert.throws(()=>response([],NaN));assert.throws(()=>api.route({error:"failed"}));
  assert.throws(()=>api.positions(tago([row()]),"https://example.com",base));
  assert.equal(response([row(),row(),row(3,0,0)],base).vehicles.length,1);
  assert.equal(response(row(),base).vehicles.length,1);
  assert.equal(response([],base).vehicles.length,0);
  assert.equal(api.positions(tago([row()],"03"),id,base).vehicles.length,0);
  // 좌표가 빈 문자열이면 Number("")=0 으로 읽지 않고 버린다.
  assert.throws(()=>response([{...row(),gpslati:"",gpslong:""}],base));
});
test("실측 TAGO 위치 응답(2026-09-16, 201번 JEB405320111)을 읽는다",()=>{
  const body={response:{header:{resultCode:"00",resultMsg:"NORMAL SERVICE."},body:{items:{item:[
    {gpslati:33.434834,gpslong:126.909657,nodeid:"JEB406001075",nodenm:"성산읍사무소[서]",nodeord:94,routenm:201,routetp:"간선버스",vehicleno:"제주79아3054"},
    {gpslati:33.259258,gpslong:126.593656,nodeid:"JEB406000179",nodenm:"상효입구[북]",nodeord:168,routenm:201,routetp:"간선버스",vehicleno:"제주79아3059"}]},
    numOfRows:300,pageNo:1,totalCount:2}}};
  const result=api.positions(body,"JEB405320111",base);
  assert.deepEqual(result.vehicles.map(v=>[v.id,v.at,v.stationName]),[
    ["tago:JEB405320111:제주79아3054",[33.434834,126.909657],"성산읍사무소[서]"],
    ["tago:JEB405320111:제주79아3059",[33.259258,126.593656],"상효입구[북]"]]);
});
test("같은 노선번호의 방향·세부 노선 ID를 유지하고, 번호가 정확히 같은 노선을 앞세운다",()=>{
  const body=tago([{routeid:"JJB1",routeno:201,startnodenm:"A",endnodenm:"B",routetp:"간선버스"},
    {routeid:"JJB2",routeno:"201",startnodenm:"B",endnodenm:"A",routetp:"간선버스"},
    {routeid:"JJB3",routeno:"1201",startnodenm:"C",endnodenm:"D"},{routeid:"bad id",routeno:"201"}]);
  const result=api.routes(body,"201");
  assert.deepEqual(result.map(r=>r.id),["JJB1","JJB2"]);assert.equal(result[0].number,"201");assert.equal(result[0].type,"간선버스");
  assert.deepEqual(api.routes(body,"20").map(r=>r.id),["JJB1","JJB2","JJB3"]);
  assert.deepEqual(api.routes(tago([]),"201"),[]);
});
test("정류장은 경로 순서로 정렬하고 누락된 경로는 연결하지 않는다",()=>{
  assert.deepEqual(api.route(tago([row(1,126.5,33.3,20),row(1,126.5,33.3,10),{...row(1,126.5,33.3,5),gpslati:""}])).map(s=>s.id),["JJB10","JJB20"]);
  assert.deepEqual(api.route(tago(row(1,126.5,33.3,7))).map(s=>s.name),["stop7"]);
  assert.equal(live.prepareShape([[33.3,126.5],[33.4,126.5]]),null);
});
test("짧은 정상 변경은 경로를 따라 이동하고 미래 좌표를 만들지 않는다",()=>{
  const shape=live.prepareShape([[33.3,126.5],[33.301,126.5],[33.301,126.501]]),state=live.create();
  live.ingest(state,response([row()],base),base,shape);
  live.ingest(state,response([row(1,126.501,33.301)],base+30000),base+30000,shape);
  const bus=[...state.vehicles.values()][0];assert.ok(bus.animation);
  const middle=live.view(bus,base+30900);assert.ok(middle.moving);assert.ok(middle.at[0]>=33.3 && middle.at[0]<=33.301);
  assert.deepEqual(live.view(bus,base+32000).at,[33.301,126.501]);assert.deepEqual(live.view(bus,base+31000,true).at,bus.at);
});
test("되돌림·큰 점프·왕복 겹침은 이동 효과를 생략한다",()=>{
  const shape=live.prepareShape([[33.3,126.5],[33.301,126.5],[33.302,126.5]]);
  assert.equal(live.transition(shape,[33.302,126.5],[33.3,126.5],30000),null);
  assert.equal(live.transition(shape,[33.3,126.5],[33.302,126.5],1000),null);
  const loop=live.prepareShape([[33.3,126.5],[33.301,126.5],[33.302,126.5],[33.301,126.5],[33.3,126.5]]);
  assert.equal(live.project(loop,[33.3,126.5]),null);
});
