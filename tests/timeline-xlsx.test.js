"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const timeline = require("../src/js/timeline.js");

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9Zl8AAAAASUVORK5CYII=",
  "base64");

test("엑셀 칸 값은 날짜·수식·서식글자·하이퍼링크를 글자로 풀어 읽는다", () => {
  const cell = value => ({ value });
  assert.equal(timeline.timelineCellText(cell(new Date(Date.UTC(1945, 7, 15)))), "1945-08-15");
  assert.equal(timeline.timelineCellText(cell({ richText:[{ text:"3·1" }, { text:" 운동" }] })), "3·1 운동");
  assert.equal(timeline.timelineCellText(cell({ formula:"A1&B1", result:"광복" })), "광복");
  assert.equal(timeline.timelineCellText(cell({ text:"탑골공원", hyperlink:"https://example.com" })), "탑골공원");
  assert.equal(timeline.timelineCellText(cell({ formula:"NOW()" })), "");
  assert.equal(timeline.timelineCellText(cell(null)), "");
  assert.equal(timeline.timelineCellText(cell(1945)), "1945");
});

test("시트 그림은 왼쪽 위 줄로 사건에 붙고 한 줄에 한 장만 쓴다", () => {
  const sheet = {
    getImages: () => [
      { imageId:"0", range:{ tl:{ nativeRow:1, nativeCol:3 } } },
      { imageId:"1", range:{ tl:{ nativeRow:1, nativeCol:5 } } },   // 같은 줄 두 번째 — 무시
      { imageId:"2", range:{ tl:{ nativeRow:2, nativeCol:3 } } },
      { imageId:"3", range:{ tl:{ nativeRow:3, nativeCol:3 } } }    // emf — 사진 아님
    ]
  };
  const workbook = {
    getImage: id => [
      { buffer:PNG_1X1, extension:"png", name:"가" },
      { buffer:PNG_1X1, extension:"png", name:"나" },
      { buffer:PNG_1X1, extension:"jpeg", name:"다" },
      { buffer:PNG_1X1, extension:"emf", name:"라" }
    ][Number(id)]
  };
  const found = timeline.timelineSheetImageRows(workbook, sheet);
  assert.deepEqual([...found.keys()], [1, 2]);
  assert.equal(found.get(1).name, "가.png");
  assert.equal(found.get(1).type, "image/png");
  assert.equal(found.get(2).type, "image/jpeg");
  assert.equal(timeline.timelineSheetImageRows({}, {}).size, 0);
});

test("행 파서는 CSV·엑셀 어느 쪽이든 사건이 나온 줄 번호를 함께 돌려준다", () => {
  const rows = [
    ["시작", "제목", "설명"],
    ["1945-08-15", "광복", "해방"],
    ["날짜아님", "제외", ""],
    ["1948", "정부 수립", ""]
  ];
  const result = timeline.timelineEventsFromRows(rows);
  assert.deepEqual(result.events.map(event => event.title), ["광복", "정부 수립"]);
  assert.deepEqual(result.rowIndexes, [1, 3]);
  assert.equal(result.skipped, 1);
  assert.throws(() => timeline.timelineEventsFromRows([["제목"], ["광복"]]), /csv-columns/);
  assert.throws(() => timeline.timelineEventsFromRows([["시작", "제목"]]), /csv-empty/);
});

test("실제 xlsx 파일에서 사건과 시트에 붙인 사진을 함께 읽는다", async () => {
  const ExcelJS = require("../vendor/exceljs.min.js");
  global.ExcelJS = ExcelJS;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("연대표");
  sheet.addRow(["시작", "종료", "제목", "유적지", "설명"]);
  sheet.addRow(["1443", "", "훈민정음 창제", "경복궁", "스물여덟 자"]);
  sheet.addRow(["1592-05", "1598", "임진왜란", "부산진성", "7년 전쟁"]);
  const imageId = workbook.addImage({ buffer:PNG_1X1, extension:"png" });
  sheet.addImage(imageId, { tl:{ col:5, row:1 }, ext:{ width:80, height:60 } });   // 둘째 줄 = 첫 사건
  const buffer = await workbook.xlsx.writeBuffer();
  const file = new File([buffer], "연대표.xlsx",
    { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  const result = await timeline.timelineEventsFromXlsx(file);
  assert.deepEqual(result.events.map(event => event.title), ["훈민정음 창제", "임진왜란"]);
  assert.equal(result.events[0].placeName, "경복궁");
  assert.equal(result.events[1].end, "1598");
  assert.equal(result.skipped, 0);
  assert.equal(result.sheetImages, 1);
  assert.deepEqual([...result.imageFiles.keys()], [0], "사진은 첫 사건에 붙어야 한다");
  const photo = result.imageFiles.get(0);
  assert.equal(photo.type, "image/png");
  assert.equal(photo.size, PNG_1X1.length);
  delete global.ExcelJS;
});

test("표 들이기 단추는 CSV와 xlsx를 함께 받고 시트 사진을 바로 줄인다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/timeline.js"), "utf8");
  assert.match(source, /timelineButton\("표 들이기", "CSV·엑셀\(\.xlsx\)에서 사건 가져오기"\)/);
  assert.match(source, /csvInput\.accept = "[^"]*\.xlsx/);
  assert.match(source, /isSheet \? await timelineEventsFromXlsx\(file\) : timelineEventsFromCsv/);
  assert.match(source, /await timelinePreparePhoto\(imageFile\)/);
  assert.match(source, /totalChars \+ photo\.dataUrl\.length > TIMELINE_PHOTO_TOTAL_MAX_CHARS/);
  assert.match(source, /MNLazy\.tryNeed\("exceljs"\)/);
  const lazy = fs.readFileSync(path.join(__dirname, "../src/js/lazy.js"), "utf8");
  assert.match(lazy, /exceljs:\s*\{[^}]*exceljs\.min\.js/);
});
