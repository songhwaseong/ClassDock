"use strict";
/* KOSIS 응답 → 색칠 지도 붙여넣기 글. 표본 줄은 2026-09-19 실제 응답의 모양(코드·이름)을 그대로 옮긴 것이다.
   36개 자주 쓰는 통계를 실제로 받아 색칠 지도 이름 맞추기에 넣으면 시도·시군구 모두 100% 맞았다(같은 날 확인). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../src/js/kosis-api.js");

const row = (C1, C1_NM, DT) => ({ C1, C1_NM, DT, PRD_DE:"2025", UNIT_NM:"명" });
const names = (regions, level) => regions.filter(r => r.level === level).map(r => r.name);

test("시군구 이름에 시도를 붙이고 합계 줄은 뺀다(e-지방지표 코드 11010)", () => {
  const regions = api.regionRows([
    row("00", "전국", "51117378"), row("11", "서울특별시", "9299548"), row("11010", "종로구", "137048"), row("11020", "중구", "117805"),
    row("22", "대구광역시", "2350000"), row("22010", "중구", "70000")
  ]);
  assert.deepEqual(names(regions, "sido"), ["서울특별시", "대구광역시"]);
  assert.deepEqual(names(regions, "sgg"), ["서울특별시 종로구", "서울특별시 중구", "대구광역시 중구"]);
  assert.equal(regions.find(r => r.name === "서울특별시 종로구").value, 137048);
});

test("코드 모양이 달라도 끝 숫자 앞머리로 시도를 찾는다", () => {
  // 행정안전부 표: 11101HJG 머리 + 행안부 코드
  const foreign = api.regionRows([row("11101HJG00", "합계", "2583626"), row("11101HJG11", "서울특별시", "450888"), row("11101HJG11010", "종로구", "13429")]);
  assert.deepEqual(names(foreign, "sgg"), ["서울특별시 종로구"]);
  // 통합특별시(12) 아래 옛 시도(1236 전라남도) — 2025년 경계로는 둘 다 시도, 시군구는 가까운 쪽(1236)에 붙는다.
  const water = api.regionRows([row("12", "전남광주통합특별시", "97"), row("1224", "광주광역시", "100"), row("1236", "전라남도", "94"), row("1236010", "목포시", "100")]);
  assert.deepEqual(names(water, "sido"), ["전남광주통합특별시", "광주광역시", "전라남도"]);
  assert.deepEqual(names(water, "sgg"), ["전라남도 목포시"]);
});

test("일반구에는 시를 끼운다 — 같은 자리 끝 0(31011→31010)도, 코드 앞머리(3101011→31010)도", () => {
  const a = api.regionRows([row("31", "경기도", "1"), row("31010", "수원시", "10"), row("31011", "장안구", "3"), row("31012", "권선구", "4")]);
  assert.deepEqual(names(a, "sgg"), ["경기도 수원시", "경기도 수원시 장안구", "경기도 수원시 권선구"]);
  const b = api.regionRows([row("11101HJG31", "경기도", "1"), row("11101HJG31010", "수원시", "10"), row("11101HJG3101011", "장안구", "3")]);
  assert.deepEqual(names(b, "sgg"), ["경기도 수원시", "경기도 수원시 장안구"]);
  // 구로 끝나도 광역시의 자치구는 시를 끼우지 않는다.
  const c = api.regionRows([row("21", "부산광역시", "1"), row("21010", "중구", "2"), row("21020", "서구", "3")]);
  assert.deepEqual(names(c, "sgg"), ["부산광역시 중구", "부산광역시 서구"]);
});

test("통합청주시·동부/읍부/면부·시부는 합계라 빼고, 앞에 붙은 시도 약칭과 이름 속 빈칸은 정리한다", () => {
  const regions = api.regionRows([
    row("33", "충청북도", "1"), row("43110", "통합청주시", "856152"), row("33040", "청주시", "850000"),
    row("03", "동부", "5"), row("04", "읍부", "5"), row("11000", "서울시부", "5"),
    row("39", "제주특별자치도", "-0.72"), row("3911", "제주 제주시", "-0.54"), row("3912", "제주 서귀포시", "-1.22"),
    row("23", "인천광역시", "1"), row("23030", "남 구", "7")
  ]);
  assert.deepEqual(names(regions, "sgg"), ["충청북도 청주시", "제주특별자치도 제주시", "제주특별자치도 서귀포시", "인천광역시 남구"]);
  assert.equal(regions.find(r => r.name === "제주특별자치도 서귀포시").value, -1.22);
});

test("값 없음(-·빈칸)은 0 이 아니고, skipZero 는 없어진 지역의 0 만 버린다", () => {
  const rows = [row("41", "경기도", "10"), row("41710", "양주군", "0"), row("41820", "가평군", "-"), row("41830", "양평군", ""), row("41800", "연천군", "1,859")];
  assert.deepEqual(names(api.regionRows(rows), "sgg"), ["경기도 양주군", "경기도 연천군"]);
  assert.deepEqual(names(api.regionRows(rows, { skipZero:true }), "sgg"), ["경기도 연천군"]);
  assert.equal(api.regionRows(rows).find(r => r.short === "연천군").value, 1859);
});

test("붙여넣기 글은 고른 단계의 줄만 두 열(지역·값)로 담는다", () => {
  const regions = api.regionRows([row("11", "서울특별시", "9"), row("11010", "종로구", "1.5")]);
  assert.equal(api.pasteText(regions, "sgg", "인구"), "지역\t인구\n서울특별시 종로구\t1.5");
  assert.equal(api.pasteText(regions, "sido", "인구"), "지역\t인구\n서울특별시\t9");
});

test("검색한 표의 메타: 지역 분류를 찾고 ＜br＞ 를 지운다, 연 단위 해 목록", () => {
  const meta = [
    { OBJ_ID:"ITEM", OBJ_NM:"항목", ITM_ID:"T10", ITM_NM:"고령인구비율＜br＞(A÷B×100)", UNIT_NM:"%" },
    { OBJ_ID:"SGG", OBJ_NM:"행정구역별", OBJ_ID_SN:"1", ITM_ID:"00", ITM_NM:"전국" },
    { OBJ_ID:"SGG", OBJ_NM:"행정구역별", OBJ_ID_SN:"1", ITM_ID:"11", ITM_NM:"서울특별시" },
    { OBJ_ID:"SBB", OBJ_NM:"성별", OBJ_ID_SN:"2", ITM_ID:"0", ITM_NM:"계" }
  ];
  const info = api.metaObjects(meta);
  assert.equal(info.region.id, "SGG");
  assert.deepEqual(info.classes.map(c => c.id), ["SGG", "SBB"]);
  assert.equal(info.items[0].name, "고령인구비율 (A÷B×100)");
  const prds = api.periods([{ PRD_SE:"월", STRT_PRD_DE:"2008.01", END_PRD_DE:"2026.08" }, { PRD_SE:"년", STRT_PRD_DE:"2000", END_PRD_DE:"2025" }]);
  assert.deepEqual(prds.map(p => p.se), ["M", "Y"]);
  const years = api.yearsOf(prds);
  assert.equal(years[0], "2025");
  assert.equal(years.length, 15);
});

test("자주 쓰는 통계 목록은 겹치지 않고, 묻는 값이 런처 검사를 통과하는 모양이다", () => {
  const ids = api.PRESETS.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(api.PRESETS.length, 36);
  for (const p of api.PRESETS){
    assert.ok(api.GROUPS.includes(p.group), p.id);
    assert.match(p.org, /^[0-9]+$/, p.id);
    assert.match(p.tbl, /^[A-Za-z0-9_]+$/, p.id);
    assert.ok(p.objs.includes("ALL"), p.id + " 지역 분류는 ALL");
    for (const v of p.objs) assert.match(v, /^[A-Za-z0-9_.+ ]+$/, p.id);
    assert.ok(p.items.length >= 1, p.id);
    for (const [id] of p.items) assert.match(id, /^[A-Za-z0-9_.+ ]+$/, p.id);
    assert.ok(p.levels.includes("sido"), p.id);
    // 영어 화면: 제목·묶음·항목 이름이 모두 영어 표에 있다.
    for (const ko of [p.title, p.group, ...p.items.map(i => i[1]).filter(Boolean), ...(p.note ? [p.note] : [])])
      assert.ok(api.EN[ko], "영어 없음: " + ko);
  }
});

test("오류 안내는 모두 영어 사전에 있고, 런처는 KOSIS 길을 토큰 대상으로 둔다", () => {
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  for (const reason of [...Object.keys(api.FAILURES), "kosis-fetch-failed"]){
    const message = api.failureText(new Error(reason));
    assert.ok(i18n.includes(JSON.stringify(message) + ":"), "번역 누락: " + message);
  }
  const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  assert.match(launcher, /path == "\/can-proxy-kosis" \|\| path == "\/kosis-key-status" \|\| path\.StartsWith\("\/kosis\?"/);
  assert.match(launcher, /if \(path\.StartsWith\("\/kosis-key", StringComparison\.Ordinal\)\) return true;/);
  assert.match(launcher, /jsonVD=Y/);
  const viewer = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  assert.match(viewer, /MNKosisChoro\.mount/);
});
