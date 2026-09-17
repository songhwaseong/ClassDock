"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { decodeTextAuto, tableTemplateCsv, describeFoundColumns } = require("../src/js/core.js");
const concept = require("../src/js/concept-doc.js");
const timeline = require("../src/js/timeline.js");
const study = require("../src/js/study-doc.js");

// 표 들이기: 한글 엑셀 CSV(CP949)도 읽고, '양식 받기' CSV 는 그대로 다시 들여지고, 틀린 표는 찾은 열을 알려 준다.
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function loadMap(){
  const context = { console, Blob, URL, Map, Set, Date, Math, JSON, setTimeout, clearTimeout,
    document:{}, window:{}, location:{ protocol:"file:" }, navigator:{ onLine:true } };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("vendor/korea-regions.js"), context);
  vm.runInContext(read("vendor/korea-emd.js"), context);
  vm.runInContext(read("src/js/map-viewer.js") + `
    ;globalThis.__map = { mapMarkersFromCsv, mapMarkersTemplateRows, mapChoroTemplateRows, mapChoroRowsFromText,
      mapChoroTable, mapChoroBestVintage, mapChoroEmdScopes };`, context);
  return context.__map;
}
const map = loadMap();
const plain = (value) => JSON.parse(JSON.stringify(value));
// CSV 를 한 번 바이트로 만든 뒤 앱과 같은 길(decodeTextAuto)로 다시 읽는다.
const roundTrip = (rows) => decodeTextAuto(new TextEncoder().encode(tableTemplateCsv(rows)));

test("CP949 로 저장된 한글 CSV 와 BOM 붙은 UTF-8 을 모두 깨지 않고 읽는다", () => {
  const cp949 = new Uint8Array([0xC1, 0xFA, 0xB9, 0xAE, 0x2C, 0xC1, 0xA4, 0xB4, 0xE4]);   // "질문,정답"
  assert.equal(decodeTextAuto(cp949), "질문,정답");
  assert.equal(decodeTextAuto(new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode("시작,제목")])), "시작,제목");
  assert.equal(decodeTextAuto(new Uint8Array()), "");
  const cards = study.studyCardsFromCsv(decodeTextAuto(new Uint8Array([...cp949, 0x0D, 0x0A, 0x61, 0x2C, 0x62])));
  assert.equal(cards.length, 1);
});

test("양식 CSV 는 BOM·CRLF 를 붙이고 쉼표·따옴표 칸을 감싼다", () => {
  const csv = tableTemplateCsv([["이름", "메모"], ["가", 'a,"b"']]);
  assert.ok(csv.startsWith("﻿"));
  assert.equal(csv, '﻿이름,메모\r\n가,"a,""b"""\r\n');
});

test("찾은 열 요약은 빈 칸을 빼고 길면 줄인다", () => {
  assert.equal(describeFoundColumns(["﻿date", " ", "name"]), "date, name");
  assert.equal(describeFoundColumns([]), "");
  assert.equal(describeFoundColumns(["a", "b", "c", "d"], 2), "a, b 외 2개");
  assert.match(describeFoundColumns(["가".repeat(30)]), /…$/);
});

test("관계도 양식은 관계 표로 다시 읽힌다", () => {
  const graph = concept.conceptGraphFromRows(concept.conceptCsvRows(roundTrip(concept.conceptTableTemplateRows())));
  assert.equal(graph.mode, "edges");
  assert.equal(graph.edges.length, 3);
  assert.ok(graph.nodes.some(node => node.title === "식물" && node.category === "생물"));
  assert.throws(() => concept.conceptGraphFromRows([["날짜", "메모"], ["1", "2"]]),
    error => error.message === "concept-table-columns" && describeFoundColumns(error.headers) === "날짜, 메모");
});

test("연대표 양식은 역사·여행 모두 건너뛰는 줄 없이 다시 읽힌다", () => {
  for (const purpose of ["history", "trip"]){
    const result = timeline.timelineEventsFromCsv(roundTrip(timeline.timelineTemplateRows(purpose)));
    assert.equal(result.events.length, 2, purpose);
    assert.equal(result.skipped, 0, purpose);
  }
  assert.throws(() => timeline.timelineEventsFromCsv("이름,날짜X\n가,1"),
    error => error.message === "csv-columns" && describeFoundColumns(error.headers) === "이름, 날짜X");
});

test("암기장 양식은 문답·빈칸 카드로 다시 읽힌다", () => {
  const cards = study.studyCardsFromCsv(roundTrip(study.studyTemplateRows()));
  assert.deepEqual(cards.map(card => card.type), ["qa", "cloze"]);
  assert.throws(() => study.studyCardsFromCsv("front2,back2\na,b"),
    error => error.message === "csv-columns" && describeFoundColumns(error.headers) === "front2, back2");
});

test("지도 표시 양식은 좌표 줄은 바로, 주소만 있는 줄은 찾기 대기로 읽힌다", () => {
  const result = plain(map.mapMarkersFromCsv(roundTrip(map.mapMarkersTemplateRows())));
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].color, "red");
  assert.equal(result.pending.length, 1);
  assert.equal(result.skipped, 0);
  assert.throws(() => map.mapMarkersFromCsv("장소명,x\n가,1"),
    error => error.message === "csv-columns" && describeFoundColumns(error.headers) === "장소명, x");
});

test("색칠 지도 양식은 기준마다 모든 줄이 지역에 맞는다", () => {
  for (const level of ["sido", "sgg", "emd"]){
    const rows = map.mapChoroTemplateRows(level);
    const table = map.mapChoroTable(map.mapChoroRowsFromText(roundTrip(rows)));
    const valueColumn = table.columns.find(column => column.numeric);
    assert.ok(valueColumn, level);
    const scope = level === "emd" ? "서울특별시|종로구" : "";
    const best = plain(map.mapChoroBestVintage(table, valueColumn.index, level, scope));
    assert.equal(best.result.matched, rows.length - 1, level + " " + JSON.stringify(best.result));
  }
});

test("들이기 화면들은 인코딩 판별·양식 받기를 연결한다", () => {
  for (const file of ["concept-doc.js", "timeline.js", "study-doc.js", "map-viewer.js"]){
    assert.match(read("src/js/" + file), /readTextFileAuto/, file);
    assert.match(read("src/js/" + file), /tableTemplateCsv/, file);
  }
  assert.match(read("src/js/state.js"), /readTextFileAuto, tableTemplateCsv, describeFoundColumns/);
});
