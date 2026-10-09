"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../src/js/train-api.js");
const timetable=require("./fixtures/train-schedule-seoul-busan.json");
const stationBody=require("./fixtures/train-stations-seoul.json");
const cityBody=require("./fixtures/train-cities.json"),gradeBody=require("./fixtures/train-grades.json");
const envelope=(items,total=items.length)=>({response:{header:{resultCode:"00"},body:{items:{item:items},totalCount:total}}});
const reply=body=>({ok:true,headers:{get:()=>"2026-10-09T00:00:00Z"},json:async()=>body});

test("공식 최신 응답: 서울~부산 86편과 14자리 시각·열차번호·성인 운임을 보존한다",()=>{
  const items=api.schedule(timetable);
  assert.equal(items.length,86);assert.equal(items[0].number,"00001");assert.equal(items[0].dep.time,"05:13");
  assert.equal(items[0].arr.time,"07:50");assert.equal(items[0].duration,157);assert.equal(items[0].fare,54200);
  assert.equal(items[0].dep.at,Date.parse("2026-10-09T05:13:00+09:00"));
  assert.equal(api.stations(stationBody,{id:"11",name:"서울특별시"}).length,12);
  assert.equal(api.cities(cityBody).length,16);assert.equal(api.grades(gradeBody).length,15);
  for(const name of ["KTX","KTX-산천(A-type)","KTX-이음","KTX-청룡"])assert.ok(api.isKtx(name));
  for(const name of ["SRT","ITX-새마을","무궁화호"])assert.equal(api.isKtx(name),false);
});
test("빈 결과·단건·비정상 응답과 자정 통과를 구분한다",()=>{
  assert.deepEqual(api.schedule({response:{header:{resultCode:"03"}}}),[]);
  assert.deepEqual(api.schedule({response:{header:{resultCode:"00"},body:{items:""}}}),[]);
  const row={...timetable.response.body.items.item[0],depplandtime:"20261009233000",arrplandtime:"20261010011000",adultcharge:"0"};
  const parsed=api.schedule(envelope(row))[0];assert.equal(parsed.duration,100);assert.equal(parsed.arr.day,"20261010");assert.equal(parsed.fare,null);
  assert.equal(api.schedule(envelope([{...row,arrplandtime:"20261009223000"}])).length,0);
  assert.equal(api.stamp("20260230090000"),null);assert.equal(api.stamp("20261009246000"),null);
  assert.equal(api.validDate(20261009),false);assert.equal(api.validDate("20260229"),false);assert.equal(api.validDate("20280229"),true);
  assert.throws(()=>api.rows({response:{header:{resultCode:"30"},body:{}}}),/train-invalid-data/);
});
test("동명이역은 지역을 선택하며 이름 뒤의 '역'과 공식 ID로도 찾는다",()=>{
  const list=[{id:"NAT010000",name:"서울",label:"서울 · 서울특별시"},
    {id:"NAT010001",name:"신기",label:"신기 · 강원특별자치도"},{id:"NAT010002",name:"신기",label:"신기 · 경상북도"}];
  assert.equal(api.resolveStation("서울역",list).id,"NAT010000");assert.equal(api.resolveStation("신기",list),null);
  assert.equal(api.resolveStation("신기 · 경상북도",list).id,"NAT010002");assert.equal(api.resolveStation("NAT010000",list).name,"서울");
  assert.equal(api.ymd(Date.parse("2026-10-08T16:00:00Z")),"20261009");
});
test("시간표 쪽을 이어 받고 상한·빈 중간 쪽은 일부 수신으로 표시한다",async t=>{
  const previous=global.fetch;t.after(()=>{global.fetch=previous;});
  const template=timetable.response.body.items.item[0];const make=count=>Array.from({length:count},(_,index)=>({...template,trainno:String(index).padStart(5,"0")}));
  const urls=[];global.fetch=async url=>{urls.push(url);return reply(envelope(url.includes("page=1") ? make(300) : [{...template,trainno:"00300"}],301));};
  let result=await api.loadSchedule("NAT010000","NAT014445","20261009");
  assert.equal(result.items.length,301);assert.equal(result.truncated,false);assert.equal(urls.length,2);
  assert.equal(urls[0],"/train-schedule?from=NAT010000&to=NAT014445&date=20261009&page=1");
  urls.length=0;global.fetch=async url=>{urls.push(url);return reply(envelope(make(300),3001));};
  result=await api.loadSchedule("NAT010000","NAT014445","20261009",{refresh:true});
  assert.equal(urls.length,10);assert.equal(result.truncated,true);assert.ok(urls.every(url=>url.endsWith("&refresh=1")));
  global.fetch=async()=>reply(envelope([],5));result=await api.loadSchedule("NAT010000","NAT014445","20261009");assert.equal(result.truncated,true);
});
test("키·한도 오류와 잘못된 요청을 구분하며 인증키는 프런트에서 보내지 않는다",async t=>{
  const previous=global.fetch;t.after(()=>{global.fetch=previous;});let calls=0;
  global.fetch=async()=>{calls++;return {ok:false,status:428,headers:{get:()=>"60"},text:async()=>"bus-key-invalid"};};
  await assert.rejects(api.loadSchedule("NAT010000","NAT014445","20261009"),error=>error.message==="bus-key-invalid" && error.retryAfterMs===60000);
  await assert.rejects(api.loadSchedule("NAT010000","NAT010000","20261009"),/train-bad-request/);
  await assert.rejects(api.loadSchedule("NAT010000&serviceKey=x","NAT014445","20261009"),/train-bad-request/);
  assert.equal(calls,1);
});
test("전국 역 목록은 최대 세 도시씩 받고 완전한 목록만 캐시한다",async t=>{
  const previous=global.fetch;t.after(()=>{global.fetch=previous;});let active=0,peak=0,calls=0;
  delete require.cache[require.resolve("../src/js/train-api.js")];const fresh=require("../src/js/train-api.js");
  global.fetch=async url=>{
    calls++;if(url==="/train-cities")return reply(cityBody);if(url==="/train-grades")return reply(gradeBody);
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
    const city=new URL(url,"http://localhost").searchParams.get("city");
    return reply(envelope([{nodeid:"NAT01"+city+"00",nodename:"역"+city}]));
  };
  const result=await fresh.loadCatalogue();assert.equal(result.stations.length,16);assert.ok(peak<=3 && peak>1);
  const firstCount=calls;assert.equal(await fresh.loadCatalogue(),result);assert.equal(calls,firstCount);
});
