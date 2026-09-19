"use strict";
/* NEIS 응답 해석. 표본은 2026-09-19 키 없이 받은 실제 응답(가락고등학교)을 줄여 옮긴 것이다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../src/js/neis-api.js");

const wrap = (service, row, total = row.length) => ({ [service]:[
  { head:[{ list_total_count:total }, { RESULT:{ CODE:"INFO-000", MESSAGE:"정상 처리되었습니다." } }] },
  { row }
] });

test("학교 찾기: 교육청·학교 코드와 학교급·주소를 담는다", () => {
  const list = api.schools(wrap("schoolInfo", [
    { ATPT_OFCDC_SC_CODE:"B10", SD_SCHUL_CODE:"7010057", SCHUL_NM:"가락고등학교", SCHUL_KND_SC_NM:"고등학교", LCTN_SC_NM:"서울특별시", ORG_RDNMA:"서울특별시 송파구 송이로 42" },
    { ATPT_OFCDC_SC_CODE:"bad", SD_SCHUL_CODE:"7130165", SCHUL_NM:"이상한 줄" }
  ]));
  assert.deepEqual(list, [{ office:"B10", code:"7010057", name:"가락고등학교", kind:"고등학교", region:"서울특별시", address:"서울특별시 송파구 송이로 42" }]);
  assert.deepEqual(api.schools({}), [], "자료 없음(런처가 {} 로 바꿔 줌)");
});

test("급식: <br/> 로 나누고 알레르기 번호를 지운다, 끼니 순서대로", () => {
  const meals = api.meals(wrap("mealServiceDietInfo", [
    { MMEAL_SC_CODE:"3", MMEAL_SC_NM:"석식", MLSV_YMD:"20260918", DDISH_NM:"카레라이스 (5.6)<br/>깍두기 (9)", CAL_INFO:"650 Kcal" },
    { MMEAL_SC_CODE:"2", MMEAL_SC_NM:"중식", MLSV_YMD:"20260918",
      DDISH_NM:"발아현미밥 <br/>우렁된장찌개 (5.6)<br/>돈육볶음우동 (5.6.9.10.13.15.17.18)<br/>고등어구이&와사비장 (5.6.7.13)<br/>배추김치 (9)", CAL_INFO:"721.4 Kcal" }
  ]));
  const day = meals.get("2026-09-18");
  assert.deepEqual(day.map(m => m.type), ["중식", "석식"]);
  assert.deepEqual(day[0].dishes, ["발아현미밥", "우렁된장찌개", "돈육볶음우동", "고등어구이&와사비장", "배추김치"]);
  assert.equal(day[0].calories, "721.4 Kcal");
  assert.equal(api.mealLine(day), "중식: 발아현미밥, 우렁된장찌개, 돈육볶음우동, 고등어구이&와사비장, 배추김치");
  assert.equal(api.dishName("★수제돈가스*(1.2.5.6)"), "수제돈가스");
});

test("학사일정: 휴업일을 가리고, 매주 오는 토요휴업일과 같은 날 같은 행사는 뺀다", () => {
  const events = api.schedule(wrap("SchoolSchedule", [
    { AA_YMD:"20260902", EVENT_NM:"전국연합학력평가(1,2,3)", SBTR_DD_SC_NM:"해당없음" },
    { AA_YMD:"20260905", EVENT_NM:"토요휴업일", SBTR_DD_SC_NM:"휴업일" },
    { AA_YMD:"20260924", EVENT_NM:"추석", SBTR_DD_SC_NM:"공휴일" },
    { AA_YMD:"20260924", EVENT_NM:"추석", SBTR_DD_SC_NM:"공휴일" },
    { AA_YMD:"20260930", EVENT_NM:"재량휴업일", SBTR_DD_SC_NM:"휴업일" }
  ]));
  assert.deepEqual([...events.keys()], ["2026-09-02", "2026-09-24", "2026-09-30"]);
  assert.deepEqual(events.get("2026-09-24"), [{ name:"추석", off:true }]);
  assert.equal(events.get("2026-09-02")[0].off, false);
});

test("시간표: 학교급마다 서비스가 다르고 교시 순서로 정리한다", () => {
  assert.equal(api.timetableService("초등학교"), "elsTimetable");
  assert.equal(api.timetableService("중학교"), "misTimetable");
  assert.equal(api.timetableService("고등학교"), "hisTimetable");
  assert.equal(api.timetableService("특수학교"), "hisTimetable");
  const list = api.timetable(wrap("hisTimetable", [
    { PERIO:"2", ITRT_CNTNT:"통합사회2" }, { PERIO:"1", ITRT_CNTNT:"공통영어2" }, { PERIO:"1", ITRT_CNTNT:"겹친 줄" }, { PERIO:"3", ITRT_CNTNT:"-" }
  ]), "hisTimetable");
  assert.deepEqual(list, [{ period:1, subject:"공통영어2" }, { period:2, subject:"통합사회2" }]);
});

test("학급정보: 학년마다 반 목록을 숫자 순서로, 이름 반·겹친 줄도 정리한다", () => {
  const row = (GRADE, CLASS_NM) => ({ GRADE, CLASS_NM, AY:"2026" });
  const byGrade = api.classes(wrap("classInfo", [
    row("1", "10"), row("1", "2"), row("1", "1"), row("1", "2"), row("2", "사랑"), row("2", "가"), row("7", "1"), row("1", "<b>")
  ]));
  assert.deepEqual(byGrade, { "1":["1", "2", "10"], "2":["가", "사랑"] });
  assert.deepEqual(api.classes({}), {});
  // 학년도는 3월에 바뀐다.
  assert.equal(api.schoolYear(new Date(2026, 1, 20)), "2025");
  assert.equal(api.schoolYear(new Date(2026, 2, 2)), "2026");
});

test("학교 정보 카드: 학교 코드로 한 곳을 고르고, 날짜·홈페이지를 정리한다", () => {
  const body = wrap("schoolInfo", [
    { SD_SCHUL_CODE:"7130165", SCHUL_NM:"가락중학교" },
    { SD_SCHUL_CODE:"7010057", SCHUL_NM:"가락고등학교", ENG_SCHUL_NM:"Garak High School", SCHUL_KND_SC_NM:"고등학교", FOND_SC_NM:"공립",
      COEDU_SC_NM:"남여공학", HS_SC_NM:"일반고", ORG_RDNZC:"05678 ", ORG_RDNMA:"서울특별시 송파구 송이로 42", ORG_RDNDA:"(송파동,가락고등학교)",
      ORG_TELNO:"02-416-4658", ORG_FAXNO:"02-421-9669", HMPG_ADRES:"http://garak.sen.hs.kr", JU_ORG_NM:"서울특별시교육청",
      FOND_YMD:"19881223", FOAS_MEMRD:"19890428", SPCLY_PURPS_HS_ORD_NM:null }
  ]);
  const info = api.schoolDetail(body, "7010057");
  assert.equal(info.name, "가락고등학교");
  assert.equal(info.address, "서울특별시 송파구 송이로 42 (송파동,가락고등학교)");
  assert.equal(info.zip, "05678");
  assert.equal(info.homepage, "http://garak.sen.hs.kr/");
  assert.deepEqual(info.founded, { y:1988, m:12, d:23 });
  assert.deepEqual(info.anniversary, { y:1989, m:4, d:28 });
  assert.equal(api.schoolDetail(body, "0000000"), null);
  // 홈페이지는 http(s) 만 — 앞이 빠진 주소는 http:// 를 붙이고, 이상한 주소는 버린다.
  assert.equal(api.homepage("www.school.go.kr"), "http://www.school.go.kr/");
  assert.equal(api.homepage("javascript:alert(1)"), "");
  assert.equal(api.homepage("없음"), "");
  assert.equal(api.homepage(null), "");
});

test("고른 학교는 모양이 맞을 때만 되살린다", () => {
  const store = new Map();
  global.localStorage = { getItem:k => store.get(k) ?? null, setItem:(k, v) => store.set(k, String(v)), removeItem:k => store.delete(k) };
  try {
    assert.equal(api.savedSchool(), null);
    api.saveSchool({ office:"B10", code:"7010057", name:"가락고등학교", kind:"고등학교", grade:"1", cls:"3" });
    assert.deepEqual(api.savedSchool(), { office:"B10", code:"7010057", name:"가락고등학교", kind:"고등학교", grade:"1", cls:"3" });
    store.set("mn.neisSchool", JSON.stringify({ office:"B10&x=1", code:"7010057", name:"x" }));
    assert.equal(api.savedSchool(), null);
    store.set("mn.neisSchool", JSON.stringify({ office:"B10", code:"7010057", name:"x", grade:"9", cls:"<b>" }));
    assert.deepEqual([api.savedSchool().grade, api.savedSchool().cls], ["", ""]);
  } finally { delete global.localStorage; }
});

test("오류 안내는 영어 사전에 있고, 런처는 정해 둔 서비스만 토큰 길로 넘긴다", () => {
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  for (const reason of [...Object.keys(api.FAILURES), "neis-fetch-failed"]){
    const message = api.failureText(new Error(reason));
    assert.ok(i18n.includes(JSON.stringify(message) + ":"), "번역 누락: " + message);
  }
  const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  assert.match(launcher, /path == "\/can-proxy-neis" \|\| path == "\/neis-key-status" \|\| path\.StartsWith\("\/neis\?"/);
  for (const service of ["schoolInfo", "mealServiceDietInfo", "SchoolSchedule", "elsTimetable", "misTimetable", "hisTimetable", "classInfo"])
    assert.ok(launcher.includes('{ "' + service + '"'), service);
  assert.match(launcher, /ERROR-290/);
  const diary = fs.readFileSync(path.join(__dirname, "../src/js/diary.js"), "utf8");
  assert.match(diary, /MNNeisApi/);
});
