"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../src/js/ship-api.js");
const data=require("../src/js/ship-ports-data.js");
const incheon=require("./fixtures/ship-schedule-incheon.json");   // 2026-09-19 인천 출발 실측 46줄
const envelope=items=>({response:{header:{resultCode:"00",resultMsg:"NORMAL SERVICE."},body:{items:{item:items},numOfRows:500,pageNo:1,totalCount:items.length}}});

test("봉투: 정상·빈 결과·단건 객체를 읽고, 다른 결과 코드는 오류로 올린다",()=>{
  assert.equal(api.schedule(envelope(incheon)).length,46);
  assert.deepEqual(api.schedule({response:{header:{resultCode:"00"},body:{items:"",totalCount:0}}}),[]);
  assert.deepEqual(api.schedule({response:{header:{resultCode:"03"}}}),[]);
  assert.equal(api.schedule({response:{header:{resultCode:"00"},body:{items:{item:incheon[0]}}}}).length,1);
  assert.throws(()=>api.schedule({OpenAPI_ServiceResponse:{cmmMsgHeader:{returnReasonCode:"30"}}}),/ship-invalid-data/);
});

test("한 줄: 시각은 숫자로 와도 읽고, 운임 0 은 정보 없음, 선박명 공백 겹침을 편다",()=>{
  const [first]=api.schedule(envelope([incheon[0]]));
  assert.equal(first.dep.time,"05:00");assert.equal(first.dep.day,"20260919");assert.equal(first.fare,null);
  const [row]=api.schedule(envelope([{depPlaceNm:"만재도",arrPlaceNm:"목포",depPlandTime:202609190830,arrPlandTime:202609191206,charge:65000,vihicleNm:"뉴  퀸"}]));
  assert.equal(row.ship,"뉴 퀸");assert.equal(row.fare,65000);assert.equal(row.arr.time,"12:06");
  assert.deepEqual(api.schedule(envelope([{depPlaceNm:"a",arrPlaceNm:"b",depPlandTime:"2026091925"}])),[],"이상한 시각은 버린다");
  assert.equal(api.displayName("울릉_도동"),"울릉 도동");
});

test("항해 묶기: 한 배가 같은 시각에 떠나 여러 섬을 들르면 한 줄이다",()=>{
  const voyages=api.voyages(api.schedule(envelope(incheon)));
  assert.equal(voyages.length,16);
  const daebu=voyages.find(v=>v.ship==="대부고속페리호" && v.dep.time==="07:50");
  assert.deepEqual(daebu.stops,["대이작도","소이작도","승봉도","자월도"]);
  assert.equal(Math.min(...daebu.fares)>0,true);
  const gold=voyages.find(v=>v.ship==="골드페리3호");
  assert.deepEqual(gold.fares,[],"운임 0 은 목록에 넣지 않는다");
});

test("도착지 묶음: 편수가 많은 곳부터",()=>{
  const groups=api.destinations(api.schedule(envelope(incheon)));
  assert.equal(groups.length,18);
  assert.ok(groups[0].count>=groups[groups.length-1].count);
  assert.equal(groups.reduce((sum,g)=>sum+g.count,0),46);
});

test("항구 목록: SEA 번호만 받고 같은 ID 는 한 번",()=>{
  const list=api.ports(envelope([{nodeId:"SEA10100",nodeNm:"인천"},{nodeId:"SEA10100",nodeNm:"인천"},{nodeId:"x1",nodeNm:"틀린 값"}]));
  assert.deepEqual(list,[{id:"SEA10100",name:"인천"}]);
  assert.ok(api.validPort("SEA42010"));assert.ok(!api.validPort("SEA4201"));assert.ok(!api.validPort("../x"));
});

test("좌표 표: 같은 이름 항구가 둘이면 가까운 쪽을 고른다",()=>{
  global.MNShipPortData={ports:{"조도":[[34.30,126.00],[34.80,127.80]],"목포":[34.78,126.38]}};
  try{
    assert.deepEqual(api.coordsOf("목포"),[34.78,126.38]);
    assert.deepEqual(api.coordsOf("조도",[34.78,126.38]),[34.30,126.00]);
    assert.deepEqual(api.coordsOf("조도",[34.74,127.74]),[34.80,127.80]);
    assert.equal(api.coordsOf("없는섬"),null);
    const near=api.nearby([34.78,126.38],2);
    assert.equal(near[0].name,"목포");assert.ok(near[0].distance<1);
    assert.deepEqual(api.nearby([34.78,126.38],5,new Set(["조도"])).map(n=>n.name),["조도","조도"]);
  }finally{delete global.MNShipPortData;}
});

test("동봉한 좌표 표: 모두 한국 바다 범위이고, 오늘 실측 시간표의 이름을 거의 다 담는다",()=>{
  const ports=data.ports;
  for (const [name,value] of Object.entries(ports)){
    const spots=Array.isArray(value[0]) ? value : [value];
    for (const [lat,lng] of spots) assert.ok(lat>33 && lat<38.7 && lng>124.5 && lng<131.9,name+" "+lat+","+lng);
  }
  const names=new Set(incheon.flatMap(r=>[r.depPlaceNm,r.arrPlaceNm]));
  const missing=[...names].filter(n=>!ports[n]);
  assert.ok(missing.length<=2,"인천 시간표에서 좌표 없는 곳: "+missing.join(","));
});

test("시간표 조회: 런처 주소와 오류 까닭",async()=>{
  global.fetch=async url=>{
    assert.equal(url,"/ship-schedule?port=SEA10100&date=20260919");
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>envelope(incheon)};
  };
  const result=await api.loadSchedule("SEA10100","20260919");
  assert.equal(result.items.length,46);
  await assert.rejects(api.loadSchedule("인천","20260919"),/ship-bad-request/);
  global.fetch=async()=>({ok:false,status:428,headers:{get:()=>"60"},text:async()=>"bus-key-invalid"});
  await assert.rejects(api.loadSchedule("SEA10100","20260919"),error=>error.message==="bus-key-invalid" && error.retryAfterMs===60000);
  assert.equal(api.ymd(new Date(2026,8,9)),"20260909");
});
