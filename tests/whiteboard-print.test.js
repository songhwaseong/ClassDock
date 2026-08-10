"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// 헤더의 "인쇄 / PDF로 저장"이 화면 DOM을 그대로 인쇄하면 화이트보드는 도구막대·탭바만 찍히고
// 판서(<canvas>)는 통째로 빠진다. 보드일 때만 그림 한 장을 만들어 인쇄하는 경로를 지킨다.
test("보드 문서의 인쇄 버튼은 window.print 대신 보드 그림 인쇄로 간다", () => {
  const app = read("src/js/app.js");
  assert.match(app, /btnPrint"\)\.onclick[\s\S]{0,320}state\.kind === "board" && typeof state\.printBoard === "function"[\s\S]{0,80}state\.printBoard\(\)/);
});

test("printBoard 는 보드 그림을 그린 뒤 인쇄하고 임시 레이어를 반드시 치운다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /const printBoard = async \(\)/);
  assert.match(wb, /doc\.printBoard = printBoard;/);
  // PDF 내보내기와 같은 그림(선택 표시 없이 원본 배율)
  assert.match(wb, /printBoard[\s\S]{0,400}withBoardExport\(\(\) => canvas\.toDataURL\("image\/png"\)\)/);
  // 이미지 로딩을 기다린 뒤 인쇄 — 빈 페이지 방지
  assert.match(wb, /img\.onload = resolve[\s\S]{0,300}window\.print\(\)/);
  assert.match(wb, /window\.addEventListener\("afterprint", cleanup\)/);
  assert.match(wb, /finally \{ cleanup\(\); \}/);
  assert.match(wb, /document\.body\.classList\.remove\("board-printing"\)/);
});

test("인쇄용 레이어는 화면에서 숨고, 인쇄 때는 그것만 남는다", () => {
  const css = read("src/styles.css");
  assert.match(css, /\.board-print\{display:none\}/);
  assert.match(css, /body\.board-printing>\*\{display:none!important\}/);
  assert.match(css, /body\.board-printing>\.board-print\{display:block!important\}/);
});

// 인쇄 레이아웃에서는 무대 높이가 0이 된다. 그때 캔버스를 1×1로 줄이면 clampView 가 화면 이동
// 위치를 뭉개 버려서, 인쇄를 끝내고 돌아오면 보던 자리를 잃는다.
test("무대가 감춰진 순간에는 캔버스 크기를 다시 잡지 않는다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /const resize = \(\) => \{[\s\S]{0,400}if \(!r\.width \|\| !r\.height\) return;/);
});
