"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const api=require("../src/js/jeju-bus-api.js");
const stops=[{name:"역",id:"1",stId:"a",order:1},{name:"역",id:"2",stId:"b",order:2},{name:"종점",id:"3",stId:"c",order:3}];
const data={version:1,unit:"seconds",from:"2026-09-07",to:"2026-09-13",routes:{r:[
 ["a","b",1,2,...Array(25).fill(120)],["b","c",2,3,...Array(25).fill(180)]]}};
const now=Date.parse("2026-09-27T08:00:00+09:00"),choice={id:"r",city:"11"};
test("중복 이름은 순번으로 고르고 순환 노선의 반복 정류장을 합치지 않는다",()=>{
 assert.equal(api.tripStopIndex(stops,"역"),-1);assert.equal(api.tripStopIndex(stops,api.tripStopLabel(stops[1],1)),1);
 assert.equal(api.tripStopIndex(stops,"종점"),2);assert.equal(api.tripSection(stops,2,0).error,"direction");
 assert.equal(api.tripSection(stops,1,1).error,"same");assert.equal(api.tripSection(stops,-1,2).error,"stops");
 assert.equal(api.tripSection([stops[0],stops[2]],0,1).error,"gap");
 assert.equal(api.tripSection(stops,0,2).count,2);
});
test("정류장 ID와 순번을 모두 확인해 시간대별 통계를 합산한다",()=>{
 assert.equal(api.tripEstimate(data,choice,stops,now).seconds,300);
 const copy=structuredClone(data);copy.routes.r[1][2]=20;
 assert.equal(api.tripEstimate(copy,choice,stops,now).error,"missing");
 assert.equal(api.tripEstimate(data,{...choice,city:"25"},stops,now).error,"unsupported");
 assert.equal(api.tripEstimate(data,choice,stops,now+100*86400000).error,"old");
 const missing=structuredClone(data);missing.routes.r[1][13]=0;
 assert.equal(api.tripEstimate(missing,choice,stops,now).error,"missing");
});
test("이동 중 시간대가 바뀌면 다음 구간에는 다음 시간대 통계를 사용한다",()=>{
 const copy=structuredClone(data);copy.routes.r[1][14]=600;
 const at=Date.parse("2026-09-27T08:59:00+09:00");
 assert.equal(api.tripEstimate(copy,choice,stops,at).seconds,720);
});
test("포함된 서울 공개 통계의 모든 구간은 ID·순번·초 단위 계약을 지킨다",()=>{
 const bundled=JSON.parse(fs.readFileSync("src/assets/bus-travel-seoul.json","utf8"));
 assert.equal(bundled.unit,"seconds");assert.match(bundled.sourceSha256,/^[a-f0-9]{64}$/);assert.ok(Object.keys(bundled.routes).length>1000);
 for(const [route,rows] of Object.entries(bundled.routes)){
  assert.match(route,/^\d{9}$/);
  for(const row of rows){assert.equal(row.length,29);assert.equal(row[3],row[2]+1);assert.ok(row[4]>0);assert.ok(row.slice(4).every(n=>Number.isInteger(n)&&n>=0&&n<=7200));}
 }
 const row=bundled.routes["100100024"].find(r=>r[2]===37);
 const sample=[{stId:row[0],order:row[2]},{stId:row[1],order:row[3]}];
 assert.ok(api.tripEstimate(bundled,{city:"11",id:"100100024"},sample,now).seconds>0);
});
