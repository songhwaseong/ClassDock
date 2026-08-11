"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const source = read("src/js/whiteboard.js");

test("빈 공간 우클릭 메뉴는 출력·공유 기능을 기존 실행 경로로 연결한다", () => {
  assert.match(source, /makeContextSection\("출력·공유","wb-context-output"\)/);
  assert.match(source, /contextAction\("PNG 저장"[\s\S]{0,100}exportPng\)/);
  assert.match(source, /contextAction\("PDF 저장"[\s\S]{0,100}exportPdf\)/);
  assert.match(source, /contextAction\("인쇄"[\s\S]{0,100}printBoard\)/);
  assert.match(source, /contextAction\("메모로"[\s\S]{0,140}sendToMemo\)/);
  assert.match(source, /contextPngBtn\.disabled=boardEmpty; contextPdfBtn\.disabled=boardEmpty; contextPrintBtn\.disabled=boardEmpty; contextMemoBtn\.disabled=boardEmpty/);
});

test("수업 기록 메뉴는 도구막대와 같은 녹화 상태를 표시하고 전환한다", () => {
  assert.match(source, /contextRecordBtn=contextAction\("● 녹화 시작"[\s\S]{0,120}toggleRecord\)/);
  assert.match(source, /function syncRecordButtons\(\)\{/);
  assert.match(source, /contextRecordBtn\.textContent=recording\?"■ 녹화 정지":"● 녹화 시작"/);
  assert.match(source, /contextRecordBtn\.classList\.toggle\("wb-context-danger",recording\)/);
  assert.match(source, /doc\.recorder = null;\s*syncRecordButtons\(\)/);
  assert.match(source, /doc\.recorder = LessonRecorder[\s\S]{0,100}syncRecordButtons\(\)/);
});

test("도구막대 위치 메뉴는 네 방향을 저장하고 현재 위치를 강조한다", () => {
  assert.match(source, /\[\["top","위"\],\["right","오른쪽"\],\["bottom","아래"\],\["left","왼쪽"\]\]/);
  assert.match(source, /setToolbarPosition\(position\)/);
  assert.match(source, /function setToolbarPosition\(position\)\{[\s\S]{0,160}applyPos\(curPos\); savePos\(curPos\)/);
  assert.match(source, /position===curPos; contextPositionBtns\[position\]\.classList\.toggle\("active",active\)/);
});

test("3차 메뉴 구역은 선택 항목에서는 숨고 빈 공간에서만 보인다", () => {
  assert.match(source, /contextOutputSection\.hidden=!!selected; contextRecordSection\.hidden=!!selected; contextPositionSection\.hidden=!!selected/);
  assert.match(source, /focusContextMenu\.append\([\s\S]{0,240}contextOutputSection,contextRecordSection,contextPositionSection/);
});

