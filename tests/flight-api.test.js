"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../src/js/flight-api.js");
// 2026-09-19 실측 응답에서 옮긴 줄(김포 국내선 출발·제주 도착). 필드 이름·값 모양 그대로다.
const row=(over={})=>({boardingKor:"서울/김포",boardingEng:"GIMPO",arrivedKor:"제주",arrivedEng:"JEJU",airlineKorean:"에어서울",
  airlineEnglish:"AIR SEOUL",airFln:"RS901",std:"0600",etd:"0614",io:"O",line:"국내",gate:"3",rmkKor:"출발",rmkEng:"DEPARTED",
  city:"CJU",airport:"GMP",...over});
const envelope=(items,total=items.length)=>({response:{header:{resultCode:"00",resultMsg:"NORMAL SERVICE."},
  body:{numOfRows:100,pageNo:1,totalCount:total,items:{item:items}}}});

test("봉투: 정상·빈 결과·단건 객체를 읽고, 게이트웨이 오류(100줄 넘김 04)는 오류로 올린다",()=>{
  assert.equal(api.flights(envelope([row(),row({airFln:"7C101"})])).items.length,2);
  assert.deepEqual(api.flights(envelope([],0)).items,[]);
  assert.equal(api.flights({response:{header:{resultCode:"00"},body:{items:{item:row()},totalCount:1}}}).items.length,1);
  assert.throws(()=>api.flights({OpenAPI_ServiceResponse:{cmmMsgHeader:{errMsg:"HTTP_ERROR",returnReasonCode:"04"}}}),/flight-invalid-data/);
  assert.throws(()=>api.flights({response:{header:{resultCode:"99"}}}),/flight-invalid-data/);
});

test("한 줄: 출발 줄은 이 공항→상대, 도착 줄은 상대→이 공항으로 읽는다",()=>{
  const out=api.flight(row());
  assert.equal(out.from,"GMP");assert.equal(out.to,"CJU");assert.equal(out.line,"D");assert.equal(out.kind,"departed");assert.equal(out.delay,14);
  const inbound=api.flight(row({io:"I",airport:"CJU",city:"GMP",std:"0715",etd:"0708",rmkKor:"도착",rmkEng:"ARRIVED   "}));
  assert.equal(inbound.from,"GMP");assert.equal(inbound.to,"CJU");assert.equal(inbound.kind,"arrived");
  assert.equal(inbound.delay,-7,"일찍 내리면 음수");assert.equal(inbound.statusEn,"ARRIVED","영문 상태 꼬리 공백을 자른다");
  assert.equal(api.flight(row({line:"국제",city:"HND"})).line,"I");
  assert.equal(api.flight(row({etd:null,rmkKor:""})).kind,"scheduled");
  assert.equal(api.flight(row({etd:null})).delay,null);
  assert.equal(api.flight(row({io:"X"})),null);assert.equal(api.flight(row({airport:""})),null);
});

test("상태 갈래: 실측에 나온 글을 모두 나눈다",()=>{
  const expect={"":"scheduled","수속중":"checkin","탑승장 입장":"boarding","탑승중":"boarding","탑승최종":"boarding","마감예정":"boarding",
    "탑승구 변경":"boarding","출발":"departed","도착":"arrived","지연":"delayed","사전결항":"cancelled","결항":"cancelled","회항":"diverted"};
  for (const [label,kind] of Object.entries(expect)) assert.equal(api.statusKind(label),kind,label);
  assert.equal(api.finished("departed"),true);assert.equal(api.finished("delayed"),false);assert.equal(api.finished("cancelled"),false);
});

test("지연 분: 자정을 넘긴 편도 바로 센다",()=>{
  assert.equal(api.delayMinutes("2350","0005"),15);
  assert.equal(api.delayMinutes("0010","2355"),-15);
  assert.equal(api.delayMinutes("0600",""),null);
  assert.equal(api.timeText("0614"),"06:14");assert.equal(api.timeText(null),"");
});

test("상대 공항별 묶음과 가장 급한 소식",()=>{
  const items=[row(),row({airFln:"A1",rmkKor:"지연"}),row({airFln:"A2",city:"PUS",arrivedKor:"부산/김해",rmkKor:"사전결항"}),row({airFln:"A3"})]
    .map(api.flight);
  const groups=api.destinations(items);
  assert.deepEqual(groups.map(g=>[g.code,g.count]),[["CJU",3],["PUS",1]]);
  assert.equal(groups[0].name,"제주");
  assert.equal(api.worstKind(groups[0].kinds),"delayed");assert.equal(api.worstKind(groups[1].kinds),"cancelled");
  assert.equal(api.worstKind({departed:3}),"normal");
});

test("공항 표: 게시판 공항은 모두 좌표가 있고, 좌표는 대략 한국·국제선 범위 안이다",()=>{
  for (const code of api.BOARD_AIRPORTS){
    const found=api.airport(code);
    assert.ok(found && found.domestic,code);
    assert.ok(found.at[0]>33 && found.at[0]<38.7 && found.at[1]>124.5 && found.at[1]<132,code);
  }
  // 2026-09-19 전국 게시판에 나온 상대 공항 코드는 모두 표에 있어야 선이 그어진다.
  const seen="ALA BKK CAN CEB CJJ CJU CRK CTS CXR DAD DPS DYG FUK GMP GUM HAN HGH HIN HKG HNA HND IBR ICN KHH KIX KKJ KMG KMJ KPO KUV KWJ MFM MNL MYJ NGB NGO NKG NRT OKA PEK PKX PQC PUS PVG RMQ SGN SHA SHE SIN SJW SZX TAE TAG TAO TPE TSA UBN USN WJU WUX XIY YNJ YNY".split(" ");
  for (const code of seen) assert.ok(api.airport(code),code);
  for (const [code,item] of Object.entries(api.AIRPORTS))
    assert.ok(item.at[0]>-12 && item.at[0]<50 && item.at[1]>70 && item.at[1]<150 && item.ko && item.en,code);
  assert.equal(api.airportName("CJU"),"제주");assert.equal(api.airportName("CJU",true),"Jeju");
  assert.equal(api.airportName("ZZZ",false,"어딘가"),"어딘가");
});

test("편명 검사: 숫자 섞인 항공사 코드·끝 글자를 받고, 이상한 값은 막는다",()=>{
  for (const ok of ["KE1201","7C101","rs 901","ZE781A","LJ3"]) assert.ok(api.validFlight(ok),ok);
  for (const bad of ["","KE","KE12345","KE-12","../x","김포1"]) assert.ok(!api.validFlight(bad),bad);
  assert.equal(api.normalizeFlight(" rs 901 "),"RS901");
});

test("대권 곡선: 끝점이 두 공항이고 가까운 구간은 거의 곧다",()=>{
  const a=api.airport("GMP").at,b=api.airport("CJU").at,points=api.greatCircle(a,b,10);
  assert.equal(points.length,11);
  assert.ok(Math.abs(points[0][0]-a[0])<1e-9 && Math.abs(points[0][1]-a[1])<1e-9);
  assert.ok(Math.abs(points[10][0]-b[0])<1e-9 && Math.abs(points[10][1]-b[1])<1e-9);
  const mid=points[5];
  assert.ok(Math.abs(mid[0]-(a[0]+b[0])/2)<0.05 && Math.abs(mid[1]-(a[1]+b[1])/2)<0.05);
  assert.deepEqual(api.greatCircle(a,a),[a,a]);
});

test("게시판 조회: 100줄씩 쪽을 넘겨 모두 받고, 겹친 줄은 한 번만 둔다",async()=>{
  const all=Array.from({length:232},(_,i)=>row({airFln:"XX"+(i+1),std:String(600+i%60).padStart(4,"0"),io:"I",airport:"CJU",city:"GMP"}));
  const asked=[];
  global.fetch=async url=>{
    asked.push(url);
    const page=Number(/page=(\d+)/.exec(url)[1]);
    // 둘째 쪽 첫 줄은 첫 쪽 끝 줄과 같게(쪽 경계 겹침) 보낸다.
    const slice=all.slice((page-1)*100,page*100);
    if (page===2) slice.unshift(all[99]);
    return {ok:true,status:200,headers:{get:name=>name==="X-ClassDock-Bus-Fetched-At" ? "2026-09-19T03:00:00Z" : null},
      json:async()=>envelope(slice,232)};
  };
  const result=await api.board({airport:"CJU",io:"I",line:"D"});
  assert.equal(asked.length,3);
  assert.match(asked[0],/^\/flight-board\?airport=CJU&io=I&line=D&page=1$/);
  assert.equal(result.items.length,232);assert.equal(result.truncated,false);
  assert.equal(result.fetchedAt,Date.parse("2026-09-19T03:00:00Z"));
  for (let i=1;i<result.items.length;i++) assert.ok(result.items[i-1].std<=result.items[i].std,"예정 시각 차례");
  await assert.rejects(api.board({airport:"cju",io:"I",line:"D"}),/flight-bad-request/);
});

test("오류 까닭: 키·한도 문제는 버스와 같은 이름으로 올린다",async()=>{
  global.fetch=async()=>({ok:false,status:428,headers:{get:()=>"60"},text:async()=>"bus-key-invalid"});
  await assert.rejects(api.search("KE1201"),error=>error.message==="bus-key-invalid" && error.retryAfterMs===60000);
  global.fetch=async()=>({ok:false,status:503,headers:{get:()=>null},text:async()=>"bus-fetch-failed"});
  await assert.rejects(api.board({airport:"GMP",io:"O",line:"D"}),/flight-fetch-failed/);
});

test("편명 찾기: 출발 공항 줄을 도착 공항 줄보다 앞에 둔다",async()=>{
  global.fetch=async url=>{
    assert.match(url,/^\/flight-search\?fln=RS901$/);
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>envelope([
      row({io:"I",airport:"CJU",city:"GMP",std:"0715",rmkKor:"도착"}),row()])};
  };
  const result=await api.search("rs901");
  assert.deepEqual(result.items.map(item=>item.io),["O","I"]);
  assert.ok(result.items.every(item=>item.from==="GMP" && item.to==="CJU"));
});
