"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  setWhiteboardInternalClipboard,
  getWhiteboardInternalClipboard,
  hasWhiteboardInternalClipboard
} = require("../src/js/whiteboard.js");

const source = fs.readFileSync(path.join(__dirname, "../src/js/whiteboard.js"), "utf8");

test("화이트보드 내부 클립보드는 항목을 독립 복제해 보드 사이에서 안전하게 꺼낸다", () => {
  const original = { type:"text", x:10, y:20, text:"복사", fontSize:24, color:"#111111" };
  assert.equal(setWhiteboardInternalClipboard(original), true);
  assert.equal(hasWhiteboardInternalClipboard(), true);

  const first = getWhiteboardInternalClipboard();
  first.text = "변경";
  const second = getWhiteboardInternalClipboard();
  assert.equal(second.text, "복사");
  assert.notEqual(first, second);

  assert.equal(setWhiteboardInternalClipboard({ type:"unknown" }), false);
  assert.equal(hasWhiteboardInternalClipboard(), false);
});

test("복사·잘라내기·우클릭 위치 붙여넣기는 내부 클립보드와 시스템 이벤트를 함께 쓴다", () => {
  assert.match(source, /document\.addEventListener\("cut", onCut\)/);
  assert.match(source, /const onCut = \(e\) => \{ if \(writeSelectedClipboardEvent\(e\)\) deleteSelected\(\); \}/);
  assert.match(source, /setWhiteboardInternalClipboard\(item\)/);
  assert.match(source, /pasteBoardClipboardItem\(item, point \|\| lastBoardPointer\)/);
  assert.match(source, /contextMenuBoardPoint=\{x:lastBoardPointer\.x,y:lastBoardPointer\.y\}/);
  assert.match(source, /document\.removeEventListener\("cut", onCut\)/);
});

test("선택 항목 메뉴는 네 방향 레이어 이동을 제공하고 경계에서는 비활성화한다", () => {
  assert.match(source, /const moveSelectedLayer = \(direction\) => \{/);
  assert.match(source, /direction === "forward"/);
  assert.match(source, /direction === "backward"/);
  assert.match(source, /direction === "front"/);
  assert.match(source, /direction === "back"/);
  assert.match(source, /contextAction\("앞으로"/);
  assert.match(source, /contextAction\("뒤로"/);
  assert.match(source, /contextAction\("맨 앞으로"/);
  assert.match(source, /contextAction\("맨 뒤로"/);
  assert.match(source, /contextForwardBtn\.disabled=selectedIndex<0\|\|selectedIndex>=lastIndex/);
  assert.match(source, /contextBackwardBtn\.disabled=selectedIndex<=0/);
});

test("빈 공간 메뉴는 삽입·배경·배율·집중 도구·전체 지우기를 기존 실행 경로로 연다", () => {
  assert.match(source, /const contextBoardSection=makeContextSection\("보드 작업"/);
  assert.match(source, /contextAction\("이미지"[\s\S]{0,100}fileInput\.click\(\)/);
  assert.match(source, /contextAction\("수학·과학"[\s\S]{0,120}toggleEducationPanel\(true\)/);
  assert.match(source, /contextAction\("배경색"[\s\S]{0,100}toggleBackgroundPanel\(true\)/);
  assert.match(source, /contextAction\("100%"[\s\S]{0,100}resetView/);
  assert.match(source, /contextAction\("집중 도구"[\s\S]{0,120}toggleFocusPanel\(true\)/);
  assert.match(source, /contextAction\("전체 지우기"[\s\S]{0,140}confirmClearAll/);
  assert.match(source, /contextBoardSection\.hidden=!!selected/);
});
