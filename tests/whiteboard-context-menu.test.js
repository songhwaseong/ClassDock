"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("화이트보드 우클릭 메뉴는 클릭 대상과 기존 편집 동작을 연결한다", () => {
  const source = read("src/js/whiteboard.js");

  assert.match(source, /wb\.selected=canSelect\?itemAt\(lastBoardPointer\):null; redraw\(\)/);
  assert.match(source, /contextAction\("복사"[\s\S]{0,100}copySelectedFromMenu\)/);
  assert.match(source, /contextAction\("복제"[\s\S]{0,120}duplicateSelected\)/);
  assert.match(source, /contextAction\("삭제"[\s\S]{0,120}deleteSelected\)/);
  // 편집 버튼은 다시 고칠 수 있는 항목(텍스트·수식·그래프·차트)에만 뜬다.
  assert.match(source, /contextEditBtn\.hidden=!canEditSelected\(selected\)/);
  assert.match(source, /const canEditSelected = \(item\) =>[\s\S]{0,300}education-chart/);
  assert.match(source, /contextFlipXBtn\.hidden=!flippable/);
  assert.match(source, /contextUngroupBtn\.hidden=!\(selected&&selected\.type==="group"\)/);
});

test("화이트보드 우클릭 메뉴는 도구·색상·굵기·이력을 도구막대 실행 함수와 공유한다", () => {
  const source = read("src/js/whiteboard.js");
  const css = read("src/styles.css");

  assert.match(source, /TOOLS\.forEach\(\(\[tool,icon,title\]\)=>\{/);
  assert.match(source, /contextAction\([\s\S]{0,180}setTool\(tool\)/);
  assert.match(source, /COLORS\.forEach\(\(\[color,name\]\)=>\{/);
  assert.match(source, /setColor\(color\);closeFocusContextMenu\(\)/);
  assert.match(source, /contextWidthBtns\[key\]=button/);
  assert.match(source, /contextUndoBtn=contextAction\("되돌리기"/);
  assert.match(source, /contextRedoBtn=contextAction\("다시 실행"/);
  assert.match(source, /focusContextSection\.hidden=!focus\.active/);
  assert.match(css, /\.wb-context-tools\{display:grid/);
  assert.match(css, /\.wb-context-swatch\.active/);
  assert.match(css, /\.wb-focus-context-menu\{[^}]*box-sizing:border-box[^}]*overflow-x:hidden[^}]*overflow-y:auto/);
  assert.match(css, /\.wb-context-ink\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.wb-context-colors,\.wb-context-widths\{[^}]*flex-wrap:wrap[^}]*max-width:100%/);
});

test("화이트보드 우클릭 메뉴는 키보드 이동과 바깥 클릭 닫기를 지원한다", () => {
  const source = read("src/js/whiteboard.js");

  assert.match(source, /focusContextMenu\.addEventListener\("keydown",e=>\{/);
  assert.match(source, /"ArrowDown","ArrowRight","ArrowUp","ArrowLeft","Home","End"/);
  assert.match(source, /!focusContextMenu\.hidden && !focusContextMenu\.contains\(e\.target\)/);
  assert.match(source, /e\.key === "Escape" && !focusContextMenu\.hidden/);
});
