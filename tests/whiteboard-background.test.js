"use strict";

// 화이트보드 배경색: 보드마다 고른 색이 스냅샷에 남아 되살아나고, 배경을 바꿨을 때 같이 움직여야 하는
// 것들(무대·텍스트 입력칸·펜 색·리플레이 배경)이 흰색에 묶여 있지 않은지 고정한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { boardStateFromSnapshot, boardSnapshotBg } = require("../src/js/whiteboard.js");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("스냅샷의 배경색은 그대로 되살아난다", () => {
  const state = boardStateFromSnapshot({ version:1, bg:"#0f5132", items:[] });
  assert.equal(state.bg, "#0f5132");
});

test("배경색이 없던 옛 스냅샷은 흰 종이로 되살린다", () => {
  // 그때 쓴 펜은 검정이다 — 지금 설정한 기본 배경(칠판 등)을 씌우면 판서가 통째로 사라져 보인다.
  assert.equal(boardStateFromSnapshot({ version:1, items:[] }).bg, "#ffffff");
  assert.equal(boardSnapshotBg(""), "#ffffff");
  assert.equal(boardSnapshotBg("초록"), "#ffffff");
  assert.equal(boardSnapshotBg("#0F5132"), "#0f5132");
});

test("설정에 새 보드 기본 배경이 있고, 새 보드만 그 색으로 연다", () => {
  const state = read("src/js/state.js");
  assert.match(state, /boardBg: BOARD_BG_DEFAULT/);
  assert.match(state, /function normalizeBoardBg\(value\)\{ return normalizeHexColor\(value\) \|\| BOARD_BG_DEFAULT; \}/);
  // 저장·불러오기 양쪽에서 정규화해야 손상된 값이 그대로 살아남지 않는다.
  assert.match(state, /const loaded = \{[^\n]*boardBg:normalizeBoardBg\(saved\.boardBg\)/);
  assert.match(state, /appSettings = \{[^\n]*boardBg:normalizeBoardBg\(merged\.boardBg\)/);

  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /function defaultBoardBg\(\)/);
  assert.match(wb, /doc\.boardState = \{[^\n]*bg: defaultBoardBg\(\)/);
});

test("배경색을 바꾸면 무대·텍스트 입력칸까지 함께 따라간다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /const applyBoardBackground = \(\) => \{[\s\S]{0,320}setProperty\("--wb-bg", wb\.bg\)/);
  assert.match(wb, /setProperty\("--wb-textbg"/);
  assert.match(wb, /const setBackground = \(value, options=\{\}\) => \{[\s\S]{0,200}applyBoardBackground\(\);/);

  const css = read("src/styles.css");
  assert.match(css, /\.wb-stage\{[^}]*background:var\(--wb-bg,#fff\)\}/);
  assert.match(css, /\.wb-canvas\{[^}]*background:var\(--wb-bg,#fff\)\}/);
  assert.match(css, /\.wb-textinput\{[^}]*background:var\(--wb-textbg,rgba\(255,255,255,\.9\)\)/);
});

test("배경색은 복구 스냅샷에 바로 남는다 — 되돌리기(Ctrl+Z) 대상은 아니다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /const setBackground = \(value, options=\{\}\) => \{[\s\S]{0,420}scheduleBoardRecovery\(\);/);
  // history.commit 을 부르면 배경 변경이 판서 되돌리기 단계에 끼어든다.
  const body = wb.slice(wb.indexOf("const setBackground = (value, options"));
  assert.doesNotMatch(body.slice(0, 900), /history\.commit\(\)/);
  assert.match(wb, /bg:wb\.bg,/);   // boardSnapshot 이 배경색을 담는다
});

test("어두운 배경으로 바꾸면 펜 색을 읽히는 색으로 맞춘다", () => {
  const state = read("src/js/state.js");
  assert.match(state, /function boardInkForBackground\(bg, ink\)/);
  assert.match(state, /colorContrastRatio\(current, background\) >= 2\.2/);

  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /boardInkForBackground\(next, wb\.color\)/);
  // 저장해 둔 칠판 보드를 다시 열 때도 검정 펜으로 시작하지 않는다.
  assert.match(wb, /boardInkForBackground\(wb\.bg, "#111111"\)/);
});

test("녹화 중 배경을 바꾸면 리플레이도 그 배경으로 재생된다", () => {
  const replay = read("src/js/lesson-replay.js");
  assert.match(replay, /setBackground\(next\)\{ if \(next\) bg = next; \}/);
  assert.match(replay, /capture\(its, b, d\)\{[\s\S]{0,120}if \(b\) bg = b;/);

  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /doc\.recorder\.setBackground\(next\)/);
});

test("내보내기는 화면에 보이는 배경을 그대로 담는다", () => {
  const wb = read("src/js/whiteboard.js");
  // 인쇄·PDF만 흰 배경으로 바꾸면 칠판에 흰 펜으로 쓴 판서가 흰 종이에서 사라진다.
  const exportBlock = wb.slice(wb.indexOf("const withBoardExport"), wb.indexOf("const exportPng"));
  assert.doesNotMatch(exportBlock, /#ffffff/);
});

test("설정 › 문서에 새 보드 기본 배경 칸이 있고 저장 목록에 실린다", () => {
  const html = read("manneung-classroom.html");
  assert.match(html, /data-settings-panel="document"[\s\S]{0,2600}id="settingBoardBg"/);

  const app = read("src/js/app.js");
  // 팔레트는 BOARD_BG_PRESETS 한 곳에서만 관리한다(설정 화면·보드 도구막대 이중 관리 방지).
  assert.match(app, /for \(const preset of BOARD_BG_PRESETS\)/);
  assert.match(app, /boardBgDraft = normalizeBoardBg\(appSettings\.boardBg\)/);
  assert.match(app, /boardBg: boardBgDraft,/);
});

test("보드 도구막대에 배경색 버튼이 있고 Esc·바깥 클릭으로 닫힌다", () => {
  const wb = read("src/js/whiteboard.js");
  assert.match(wb, /tools\.append\([^)]*colorGroup, bgGroup,/);
  assert.match(wb, /function toggleBackgroundPanel\(force\)/);
  assert.match(wb, /e\.key === "Escape" && !bgPanel\.hidden/);
  assert.match(wb, /document\.addEventListener\("pointerdown", onPointerDownOutside, true\)/);
  // 탭을 닫을 때 문서 전역 리스너를 반드시 걷어낸다.
  assert.match(wb, /removeEventListener\("pointerdown", onPointerDownOutside, true\)/);
});
