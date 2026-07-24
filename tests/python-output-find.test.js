"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const codeSource = fs.readFileSync(path.join(root, "src/js/code-viewer.js"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "manneung-classroom.html"), "utf8");
const i18nSource = fs.readFileSync(path.join(root, "src/js/i18n.js"), "utf8");
const terminalSource = fs.readFileSync(path.join(root, "src/js/python-terminal.js"), "utf8");

test("Python 실행 결과 헤더는 재렌더 뒤에도 검색 도구를 다시 붙인다", () => {
  assert.match(codeSource, /outFindBtn\.className = "out-find-open"/);
  assert.match(codeSource, /outFindBar\.className = "out-find-bar out-chrome"/);
  assert.match(codeSource, /const attachOutputChrome = \(\) =>/);
  assert.match(codeSource, /new MutationObserver\(\(records\) => \{[\s\S]*attachOutputChrome\(\)/);
  assert.match(codeSource, /outHeadActions\.append\(outFindBtn, outHideBtn\)/);
});

test("터미널의 중첩 헤더는 검색 바를 같은 부모에 한 번만 붙인다", () => {
  assert.match(terminalSource, /head\.className = "out-head py-terminal-head"/);
  assert.match(codeSource, /const headParent = head\.parentNode \|\| outPanel/);
  assert.match(codeSource, /outFindBar\.parentNode !== headParent/);
  assert.doesNotMatch(codeSource, /outFindBar\.parentNode !== outPanel \|\| outFindBar\.previousElementSibling !== head/);
});

test("터미널 입력 경로는 출력 본문과 같은 기본 글자색을 사용한다", () => {
  assert.match(cssSource, /\.py-terminal-prompt\{[^}]*color:var\(--code-text\)/);
  assert.match(cssSource, /\.py-terminal-output\{color:var\(--code-text\)\}/);
});

test("실행 결과 검색은 본문만 찾아 오버레이로 강조하고 큰 출력의 결과 수를 제한한다", () => {
  assert.match(codeSource, /const OUTPUT_FIND_LIMIT = 2000/);
  assert.match(codeSource, /document\.createTreeWalker\(outPanel, NodeFilter\.SHOW_TEXT/);
  assert.match(codeSource, /closest\("\.out-head,\.out-vars,\.code-pen-overlay,button,input,textarea,select,script,style,svg,\[hidden\]"\)/);
  assert.match(codeSource, /closest\("details:not\(\[open\]\)"\)/);
  assert.match(codeSource, /if \(!el\.getClientRects\(\)\.length\) return false/);
  assert.match(codeSource, /outPanel\.addEventListener\("toggle", onOutputDetailsToggle, true\)/);
  assert.match(codeSource, /split\.classList\.contains\("hide-python-warnings"\)/);
  assert.match(codeSource, /match\.range\.getClientRects\(\)/);
  assert.match(codeSource, /rect\.bottom <= visibleTop \|\| rect\.top >= visibleBottom/);
  assert.match(codeSource, /outPanel\.addEventListener\("scroll", onOutputFindScroll/);
  assert.match(codeSource, /const clearOutputFindHighlights = \(\) => \{\s*outFindLayer\.replaceChildren\(\)/);
  assert.doesNotMatch(codeSource, /\boutputFindLayer\b/);
  assert.match(cssSource, /\.out-find-hit\{position:absolute/);
  assert.match(cssSource, /\.out-find-hit\.active\{/);
});

test("코드와 실행 결과는 포커스 문맥에 따라 Ctrl+H 검색 대상을 나눈다", () => {
  assert.match(codeSource, /shortcutMatches\(e, "findInDocument"\) && outputOwnsFindShortcut\(e\)/);
  assert.match(codeSource, /if \(outPanel\.contains\(document\.activeElement\) \|\| outputFindSelectionSeed\(\)\) openOutputFind\(\)/);
  assert.match(codeSource, /else editor\.openFind\(\)/);
  assert.match(codeSource, /e\.key === "Enter"[\s\S]*goOutputFindMatch\(e\.shiftKey \? -1 : 1\)/);
  assert.match(codeSource, /e\.key === "Escape"[\s\S]*closeOutputFind\(\)/);
  assert.match(htmlSource, /포커스가 있는 코드 또는 실행 결과에서 찾기/);
  assert.match(i18nSource, /"실행 결과에서 찾기": "Find in run output"/);
});

test("출력 갱신과 글자 크기·패널 크기 변경은 열린 검색 강조를 다시 계산한다", () => {
  assert.match(codeSource, /if \(contentChanged\) scheduleOutputFind\(false, 120\)/);
  assert.match(codeSource, /new ResizeObserver\(\(\) => \{ if \(outputFindOpen\) renderOutputFindHighlights\(\); \}\)/);
  assert.match(codeSource, /outPanel\.__refreshFontMetrics = \(\) => \{ if \(outputFindOpen\) renderOutputFindHighlights\(\); \}/);
});
