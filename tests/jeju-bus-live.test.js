"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../src/js/jeju-bus-api.js"),live=require("../src/js/jeju-bus-live.js");
const observations=require("./fixtures/jeju-bus-observations.json");
const id="405320111",base=1000000;
const row=(v=1,x=126.5,y=33.3,station=1)=>({vhId:v,plateNo:"test"+v,localX:x,localY:y,currStationId:station,currStationNm:"stop"+station});
const response=(rows,at)=>api.positions(rows,id,at);
test("실측: 좌표 갱신·정류장만 갱신·큰 점프를 구분한다",()=>{
  const state=live.create();
  for(const sample of observations)live.ingest(state,response(sample.rows,sample.at),sample.at,null);
  const still=state.vehicles.get("jeju-bis:"+id+":7983077"),moved=state.vehicles.get("jeju-bis:"+id+":7983202");
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
  assert.equal(live.ingest(state,api.positions([],"2",base+1),base+1,null),false);assert.equal(state.vehicles.size,2);
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
  for(const body of [null,{},"error",[row(1,0,0)],[{error:"failed"}]])assert.throws(()=>response(body,base));
  assert.throws(()=>response([],NaN));assert.throws(()=>api.route({error:"failed"}));
  assert.equal(response([row(),row(),row(3,0,0)],base).vehicles.length,1);
  assert.equal(response(row(),base).vehicles.length,1);
});
test("같은 노선번호의 방향·세부 노선 ID를 유지한다",()=>{
  const result=api.routes([{routeId:1,routeNum:"201",orgtNm:"A",dstNm:"B"},{routeId:2,routeNum:"201",orgtNm:"B",dstNm:"A"}]);
  assert.equal(result.length,2);assert.notEqual(result[0].id,result[1].id);
});
test("정류장은 경로 순서로 정렬하고 누락된 경로는 연결하지 않는다",()=>{
  assert.deepEqual(api.route({stationInfoList:[{...row(),stationId:2,linkOrd:20},{...row(),stationId:1,linkOrd:10}]}).map(s=>s.id),["1","2"]);
  assert.equal(live.prepareShape([[33.3,126.5],[33.4,126.5]]),null);
  assert.deepEqual(api.shape([{localX:126.5,localY:33.3},{}]),[]);
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
