"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 색칠 지도: 이름 맞추기·구간 나누기·표시 세기는 실제 경계 자료(vendor/korea-regions.js)로 검증한다.
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(){
  const context = { console, Blob, URL, Map, Set, Date, Math, JSON, setTimeout, clearTimeout,
    document:{}, window:{}, location:{ protocol:"file:" }, navigator:{ onLine:true } };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("vendor/korea-regions.js"), context);
  vm.runInContext(read("vendor/korea-emd.js"), context);
  vm.runInContext(read("src/js/map-viewer.js") + `
    ;globalThis.__choro = { mapChoroEmdScopes, mapChoroScopeVintage, mapChoroMatch, mapChoroTable, mapChoroRowsFromText, mapChoroValuesFromTable,
      mapChoroBestVintage, mapChoroBreaks, mapChoroClassOf, mapChoroColors, mapChoroRegions, mapChoroGeometry,
      mapChoroContains, mapChoroMarkerCounts, mapChoroValueKey, mapChoroNumber, mapNormalizeChoropleth,
      mapDocEmpty, mapDocParse, mapDocSerialize, mapDocContentKey, mapAttributionText, MAP_CHORO_SCHEMES };`, context);
  return context.__choro;
}
const api = load();
const plain = (value) => JSON.parse(JSON.stringify(value));
const match = (text, level = "sgg", vintage = "2026-07") => plain(api.mapChoroMatch(text, level, vintage));

test("경계 자료는 두 시점의 시도·시군구를 모두 담는다", () => {
  assert.equal(api.mapChoroRegions("sido", "2026-07").length, 16);   // 전남광주통합특별시
  assert.equal(api.mapChoroRegions("sido", "2025-12").length, 17);
  assert.ok(api.mapChoroRegions("sgg", "2026-07").length > 240);
  const seoul = api.mapChoroGeometry(api.mapChoroRegions("sido", "2026-07").find(r => r.sido === "서울특별시").geom);
  assert.equal(api.mapChoroContains(seoul, 37.5665, 126.978), true, "서울시청은 서울 안");
  assert.equal(api.mapChoroContains(seoul, 35.1796, 129.0756), false, "부산시청은 서울 밖");
  assert.ok(api.mapChoroContains(seoul, seoul.anchor[0], seoul.anchor[1]), "글자 자리는 지역 안에 있다");
});

test("시도 이름은 줄임말·옛 이름까지 받는다", () => {
  assert.equal(match("서울", "sido").key, "서울특별시");
  assert.equal(match("부산시", "sido").key, "부산광역시");
  assert.equal(match("강원도", "sido").key, "강원특별자치도");
  assert.equal(match("전라북도", "sido").key, "전북특별자치도");
  assert.equal(match("충북", "sido").key, "충청북도");
  assert.equal(match("제주도", "sido").key, "제주특별자치도");
  assert.equal(match("광주광역시", "sido", "2026-07").status, "none", "통합 뒤에는 광주광역시 경계가 없다");
  assert.equal(match("광주광역시", "sido", "2025-12").key, "광주광역시");
  assert.equal(match("전국", "sido").status, "skip", "합계 줄은 못 찾은 이름이 아니다");
});

test("시군구: 시도가 붙은 이름·같은 이름·일반구를 가린다", () => {
  assert.equal(match("종로구").key, "서울특별시|종로구");
  assert.equal(match("중구").status, "ambiguous", "여러 시도에 있는 이름은 칠하지 않는다");
  assert.equal(match("서울특별시 중구").key, "서울특별시|중구");
  assert.equal(match("경남 고성군").key, "경상남도|고성군");
  // 광주시(경기)가 광주(광역시) + '시'로 잘못 떼이지 않는다
  assert.equal(match("광주시").key, "경기도|광주시");
  const suwon = match("수원시");
  assert.equal(suwon.key, "경기도|수원시");
  assert.equal(suwon.keys.length, 4, "수원시는 네 구를 한 덩어리로 칠한다");
  assert.equal(match("세종특별자치시").key, "세종특별자치시|세종시");
  assert.equal(match("인천 중구", "sgg", "2025-12").key, "인천광역시|중구");
  assert.equal(match("화성시", "sgg", "2025-12").keys.length, 1);
});

const emd = (text, scope, vintage = "2026-07") => plain(api.mapChoroMatch(text, "emd", vintage, scope));

test("읍면동은 범위 안만 담고, 두 파일의 경계 번호를 따로 센다", () => {
  const all = api.mapChoroRegions("emd", "2026-07", "");
  assert.ok(all.length > 3500, "전국 읍면동");
  const jongno = api.mapChoroRegions("emd", "2026-07", "서울특별시|종로구");
  assert.ok(jongno.length > 10 && jongno.every(r => r.sgg === "종로구"));
  assert.equal(api.mapChoroRegions("emd", "2026-07", "경기도|수원시").some(r => r.sgg === "수원시장안구"), true, "시를 고르면 일반구가 모두 들어온다");
  assert.equal(api.mapChoroRegions("emd", "2026-07", "광주광역시").length, 0, "통합 뒤에는 광주광역시가 없다");
  assert.ok(api.mapChoroRegions("emd", "2025-12", "광주광역시").length > 90);
  assert.equal(api.mapChoroScopeVintage("광주광역시", "2026-07"), "2025-12");
  const hyoja = jongno.find(r => r.emd === "청운효자동");
  assert.equal(hyoja.code, "1111051500");
  const shape = api.mapChoroGeometry(hyoja.geom);
  assert.equal(api.mapChoroContains(shape, shape.anchor[0], shape.anchor[1]), true);
  assert.notEqual(api.mapChoroGeometry(hyoja.geom), api.mapChoroGeometry(Number(hyoja.geom.slice(1))), "읍면동 번호와 시도·시군구 번호는 섞이지 않는다");
  const scopes = plain(api.mapChoroEmdScopes());
  const gyeonggi = scopes.find(item => item.sido === "경기도");
  assert.deepEqual(gyeonggi.sggs.find(item => item.value === "수원시"), { value:"수원시", city:true });
  assert.ok(scopes.some(item => item.sido === "광주광역시") && scopes.some(item => item.sido === "전남광주통합특별시"), "두 시점의 시도를 모두 고를 수 있다");
});

test("읍면동: 코드가 먼저, 이름은 범위 안에서 하나로 좁혀질 때만 칠한다", () => {
  assert.equal(emd("서울특별시 종로구 청운효자동(1111051500)", "서울특별시").key, "서울특별시|종로구|청운효자동");
  assert.equal(emd("아무 이름 1111051500", "서울특별시|종로구").key, "서울특별시|종로구|청운효자동", "코드만 맞아도 된다");
  assert.equal(emd("서울특별시 종로구 (1111000000)", "서울특별시").status, "skip", "시군구 합계 줄");
  assert.equal(emd("서울특별시 종로구", "서울특별시").status, "skip");
  assert.equal(emd("청운효자동", "서울특별시|종로구").key, "서울특별시|종로구|청운효자동");
  assert.equal(emd("청운효자동", "부산광역시").status, "outside", "범위 밖 줄은 틀린 이름이 아니다");
  assert.equal(emd("중앙동", "경기도").status, "ambiguous", "경기도 안에도 중앙동이 여럿");
  const jungang = emd("중앙동", "경기도|과천시");
  assert.equal(jungang.status, "ok");
  assert.equal(jungang.key, "경기도|과천시|중앙동");
  assert.equal(emd("수원시 파장동", "경기도").key, "경기도|수원시장안구|파장동", "구를 빼고 적어도 찾는다");
  assert.equal(emd("경기 수원시 장안구 파장동", "경기도|수원시").key, "경기도|수원시장안구|파장동");
  assert.equal(emd("종로1.2.3.4가동", "서울특별시|종로구").key, "서울특별시|종로구|종로1·2·3·4가동");
  assert.equal(emd("강동구 상일1동", "서울특별시").key, "서울특별시|강동구|상일제1동", "'제'를 빼고 적어도 같은 동");
  assert.equal(emd("없는동", "서울특별시").status, "none");
  // 코드 열이 따로 있는 표: 코드 열은 값으로 고를 수 없고 이름 쪽으로 넘어간다
  const table = api.mapChoroTable(api.mapChoroRowsFromText("행정기관코드\t행정기관\t인구\n1111000000\t종로구\t139,417\n1111051500\t청운효자동\t11,000\n1111053000\t사직동\t9,000\n2611051000\t중앙동\t5,000"));
  assert.deepEqual(plain(table.columns.map(c => [c.label, c.numeric, c.code])), [["행정기관코드", false, true], ["행정기관", false, false], ["인구", true, false]]);
  const result = plain(api.mapChoroValuesFromTable(table, 2, "emd", "2026-07", "서울특별시|종로구"));
  assert.deepEqual(result.values, { "서울특별시|종로구|청운효자동":11000, "서울특별시|종로구|사직동":9000 });
  assert.equal(result.outside, 1, "부산 중앙동은 범위 밖");
  assert.deepEqual(result.unmatched, []);
  // 시도·시군구 지도도 이름에 붙은 코드 때문에 못 찾지 않는다
  assert.equal(match("서울특별시 종로구 (1111000000)").key, "서울특별시|종로구");
});

test("읍면동 표시 개수와 설정 저장", () => {
  const counts = plain(api.mapChoroMarkerCounts([{ lat:37.5665, lng:126.978 }, { lat:35.1796, lng:129.0756 }], "emd", "2026-07", "서울특별시|중구"));
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 1, "범위 밖 표시는 세지 않는다");
  const settings = plain(api.mapNormalizeChoropleth({ level:"emd", scope:" 서울특별시 | 종로구 |x", source:"markers" }));
  assert.equal(settings.level, "emd");
  assert.equal(settings.scope, "서울특별시|종로구");
  assert.equal("scope" in plain(api.mapNormalizeChoropleth({ level:"sgg", scope:"서울특별시", source:"markers" })), false, "시군구 지도는 범위를 담지 않는다");
});

test("붙여 넣은 표에서 머리줄·숫자 열·빈 값을 가려 읽고, 이름이 더 맞는 시점을 고른다", () => {
  const text = "행정구역\t인구(명)\t면적\n전국\t51,000,000\t100\n서울특별시\t9,386,034\t605\n광주광역시\t1,419,237\t501\n"
    + "전라남도\t1,804,217\t12348\n제주도\t\t1850\n없는도\t5\t1";
  const table = api.mapChoroTable(api.mapChoroRowsFromText(text));
  assert.deepEqual(plain(table.columns.map(c => [c.label, c.numeric])), [["행정구역", false], ["인구(명)", true], ["면적", true]]);
  const best = plain(api.mapChoroBestVintage(table, 1, "sido"));
  assert.equal(best.vintage, "2025-12");
  assert.deepEqual(best.result.values, { "서울특별시":9386034, "광주광역시":1419237, "전라남도":1804217 });
  assert.deepEqual(best.result.unmatched, ["없는도"]);
  assert.equal(best.result.empty, 1, "빈 값은 0이 아니라 '값 없음'");
  assert.equal(api.mapChoroNumber(""), null);
  assert.equal(api.mapChoroNumber("12.5%"), 12.5);
  // CSV 와 두 칸짜리 이름(시도, 시군구)
  const csv = api.mapChoroTable(api.mapChoroRowsFromText("시도,시군구,학교 수\n서울특별시,중구,30\n대구광역시,중구,\"1,204\""));
  const result = plain(api.mapChoroValuesFromTable(csv, 2, "sgg", "2026-07"));
  assert.deepEqual(result.values, { "서울특별시|중구":30, "대구광역시|중구":1204 });
});

test("일반구는 제 값이 없으면 그 시를 합친 값을 쓴다", () => {
  const region = api.mapChoroRegions("sgg", "2026-07").find(r => r.sgg === "수원시장안구");
  assert.equal(api.mapChoroValueKey(region, { "경기도|수원시":1 }), "경기도|수원시");
  assert.equal(api.mapChoroValueKey(region, { "경기도|수원시장안구":2, "경기도|수원시":1 }), "경기도|수원시장안구");
  assert.equal(api.mapChoroValueKey(region, {}), "");
});

test("구간은 같은 개수씩·같은 간격으로 나누고, 몰린 값은 구간을 줄인다", () => {
  assert.deepEqual(plain(api.mapChoroBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5, "quantile")), [1, 3, 5, 6, 8, 10]);
  assert.deepEqual(plain(api.mapChoroBreaks([0, 100], 4, "equal")), [0, 25, 50, 75, 100]);
  assert.deepEqual(plain(api.mapChoroBreaks([1, 1, 1, 1, 10], 5, "quantile")), [1, 10]);
  assert.deepEqual(plain(api.mapChoroBreaks([7, 7], 5, "quantile")), [7, 7]);
  assert.equal(api.mapChoroClassOf(10, [1, 5, 10]), 1, "최댓값은 맨 윗 구간");
  assert.equal(api.mapChoroClassOf(1, [1, 5, 10]), 0);
  for (const scheme of api.MAP_CHORO_SCHEMES.filter(item => item.colors)){
    const colors = api.mapChoroColors(scheme.id, 5);
    assert.equal(colors.length, 5);
    assert.equal(colors[0], scheme.colors[0]);
    assert.equal(colors[4], scheme.colors[scheme.colors.length - 1]);
  }
});

test("직접 고른 색은 낮은 값·가운데·높은 값 사이를 단계 수만큼 섞는다", () => {
  assert.deepEqual(plain(api.mapChoroColors("custom", 3, ["#000000", "#ffffff"])), ["#000000", "#808080", "#ffffff"]);
  // 가운데 색이 있으면 홀수 단계의 가운데 칸이 정확히 그 색이다
  assert.deepEqual(plain(api.mapChoroColors("custom", 5, ["#0000ff", "#ffffff", "#ff0000"])),
    ["#0000ff", "#8080ff", "#ffffff", "#ff8080", "#ff0000"]);
  assert.equal(api.mapChoroColors("custom", 7, ["#123456", "#ABCDEF"]).length, 7);
  assert.deepEqual(plain(api.mapChoroColors("custom", 2, ["red", "#12"])), ["#fef9c3", "#b91c1c"], "잘못된 색은 기본 색으로");

  const custom = plain(api.mapNormalizeChoropleth({ source:"markers", scheme:"custom", customColors:["#ABCDEF", "#00ff00", "#112233", "#999999"] }));
  assert.deepEqual(custom.customColors, ["#abcdef", "#00ff00", "#112233"], "색은 세 개까지, 소문자로");
  const model = api.mapDocEmpty("색");
  model.choropleth = api.mapNormalizeChoropleth({ source:"markers", scheme:"custom", customColors:["#ffffff", "#7c3aed"] });
  assert.deepEqual(plain(api.mapDocParse(api.mapDocSerialize(model)).choropleth.customColors), ["#ffffff", "#7c3aed"]);
  assert.equal("customColors" in plain(api.mapNormalizeChoropleth({ source:"markers", scheme:"blue", customColors:["#ffffff", "#000000"] })), false,
    "정해 둔 색표를 쓰면 직접 고른 색은 담지 않는다");
});

test("표시 개수는 주소를 되묻지 않고 경계 안에서 센다", () => {
  const counts = plain(api.mapChoroMarkerCounts([
    { lat:37.5665, lng:126.978 }, { lat:37.57, lng:126.98 }, { lat:35.1796, lng:129.0756 }, { lat:30, lng:120 }
  ], "sido", "2026-07"));
  assert.equal(counts["서울특별시"], 2);
  assert.equal(counts["부산광역시"], 1);
  assert.equal(counts["경기도"], 0, "없는 지역은 0 으로 칠한다");
});

test("색칠 설정은 .map 에 담기고, 옛 파일·잘못된 값은 안전하게 연다", () => {
  const model = api.mapDocEmpty("인구 지도");
  assert.equal(model.choropleth, null);
  const before = api.mapDocContentKey(model);
  model.choropleth = api.mapNormalizeChoropleth({ level:"sido", vintage:"2025-12", source:"table",
    values:{ "서울특별시":9386034, "나쁜값":"12", "빈값":null }, scheme:"green", classes:4, method:"equal", opacity:3, labels:true, title:"인구" });
  assert.notEqual(api.mapDocContentKey(model), before, "칠하면 저장 안 됨(●)이 켜진다");
  const again = api.mapDocParse(api.mapDocSerialize(model));
  assert.deepEqual(plain(again.choropleth), { level:"sido", vintage:"2025-12", source:"table", values:{ "서울특별시":9386034 },
    title:"인구", unit:"", scheme:"green", classes:4, method:"equal", opacity:0.95, labels:true });
  assert.equal(api.mapNormalizeChoropleth({ source:"table", values:{} }), null, "값 없는 표 색칠은 버린다");
  assert.equal(plain(api.mapNormalizeChoropleth({ source:"markers", values:{ "서울특별시":3 } })).values["서울특별시"], undefined,
    "표시 개수는 저장하지 않고 열 때마다 센다");
  const old = api.mapDocParse(JSON.stringify({ type:"classdock-map", version:12, markers:[] }));
  assert.equal(old.choropleth, null);
  assert.match(api.mapAttributionText(model), /통계청 SGIS/, "그림 출처에 행정경계 출처가 따라간다");
});

test("경계 자료는 지연 로드 묶음이고 출처·라이선스가 함께 있다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json"));
  const entry = manifest.vendorScripts.find(item => item.file === "korea-regions.js");
  assert.equal(entry.lazy, "koreaRegions");
  assert.match(read("src/js/lazy.js"), /koreaRegions:\{[^}]*files:\["korea-regions\.js"\]/);
  assert.ok(fs.existsSync(path.join(root, "vendor/licenses/admdongkor-20260701.txt")));
  assert.match(read("vendor/korea-regions.js"), /공공누리 제1유형[\s\S]*CC BY 4\.0/);
  const editor = read("src/js/map-viewer.js");
  assert.match(editor, /interactive:false, color:"#475569"/, "경계층은 지도 클릭·우클릭을 가로채지 않는다");
  assert.match(editor, /"\.map-choro-hover"\]/, "마우스를 올린 지역 글자는 캡처에서 감춘다");
});
