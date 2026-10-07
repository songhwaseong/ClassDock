"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const source = read("src/js/whiteboard.js");
const css = read("src/styles.css");

test("빈 공간 우클릭 메뉴는 출력·공유 기능을 기존 실행 경로로 연결한다", () => {
  assert.match(source, /contextOutputGroup=contextGroup\("출력·공유","wb-context-output"\)/);
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

test("도구막대 표시 토글은 우클릭 대상과 관계없이 보이고 상태를 기억한다", () => {
  // 도구막대 토글은 어디서 우클릭하든 남는 "보기" 묶음 안에 있다.
  assert.match(source, /contextListActions\(contextViewGroup\)\.append\(contextFocusBtn,contextToolbarToggle\)/);
  assert.match(source, /contextToolbarToggle=contextAction\("편집 도구막대 숨기기"[\s\S]{0,140}toggleToolbarVisibility\)/);
  assert.match(source, /contextToolbarToggle\.textContent=toolbarVisible\?"편집 도구막대 숨기기":"편집 도구막대 보이기"/);
  assert.match(source, /localStorage\.getItem\("wbToolbarVisible"\) !== "false"/);
  assert.match(source, /tools\.hidden = !toolbarVisible/);
  assert.match(css, /\.wb-tools\[hidden\]\{display:none\}/);
});

test("보드 전용 묶음은 선택 항목에서 숨고 보기 묶음(도구막대 토글)은 항상 보인다", () => {
  assert.match(source, /const boardContextGroups=\[contextInsertGroup,contextGearGroup,contextOutputGroup,contextRecordGroup\]/);
  assert.match(source, /for\(const group of boardContextGroups\)group\.heading\.hidden=!show/);
  assert.doesNotMatch(source, /contextViewGroup\.heading\.hidden/);
  assert.match(source, /contextItemSection\.hidden=false; showBoardContext\(false\)/);
});

test("빈 곳 메뉴는 도구·색·되돌리기만 펼치고 나머지는 ▸ 묶음에 접는다", () => {
  assert.match(source, /focusContextMenu\.append\([\s\S]{0,160}contextQuickSection,contextHistorySection,contextGroupSection,contextClearSection\)/);
  assert.match(source, /contextHistoryActions\.append\(contextUndoBtn,contextRedoBtn,contextPasteBoardBtn\)/);
  // 묶음은 메뉴의 자식(바깥 클릭·키보드 처리 공유)이고, 메뉴를 닫거나 다시 열 때 함께 접힌다.
  assert.match(source, /contextGroupSection\.append\(heading,panel\)/);
  assert.match(source, /function closeFocusContextMenu\(\)\{ focusContextMenu\.hidden=true; closeContextSub\(\); \}/);
  assert.match(source, /e\.key==="ArrowRight"&&group\)\{ e\.preventDefault\(\); openContextSub\(group,true\)/);
  assert.match(source, /if \(contextOpenGroup\)\{ const heading = contextOpenGroup\.heading; closeContextSub\(\)/);
  assert.match(source, /contextRecordGroup\.heading\.classList\.toggle\("recording",recording\)/);
  assert.match(css, /\.wb-context-sub\{position:fixed/);
  assert.match(css, /\.wb-focus-context-menu \.wb-context-parent\[hidden\]\{display:none\}/);
  assert.match(css, /\.wb-context-text-size-control\[hidden\]\{display:none\}/);
});
