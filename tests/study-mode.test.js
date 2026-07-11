const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  studyPaneSelectionAction,
  studyReadonlyPointerAllowed,
  studyReadonlyKeyAllowed
} = require("../src/js/core.js");

test("분할 문서 선택은 타깃 칸 유지·역할 교체·한쪽 교체를 구분한다", () => {
  assert.equal(studyPaneSelectionAction(null, 2, "work", 3), "activate");
  assert.equal(studyPaneSelectionAction(1, 2, "reference", 1), "keep");
  assert.equal(studyPaneSelectionAction(1, 2, "work", 2), "keep");
  assert.equal(studyPaneSelectionAction(1, 2, "reference", 2), "swap");
  assert.equal(studyPaneSelectionAction(1, 2, "work", 1), "swap");
  assert.equal(studyPaneSelectionAction(1, 2, "reference", 3), "replace-reference");
  assert.equal(studyPaneSelectionAction(1, 2, "work", 3), "replace-work");
});

test("참고 잠금은 텍스트·표 선택을 허용하고 편집 진입은 막는다", () => {
  assert.equal(studyReadonlyPointerAllowed("text-selection", "pointerdown"), true);
  assert.equal(studyReadonlyPointerAllowed("text-selection", "dblclick"), true);
  assert.equal(studyReadonlyPointerAllowed("sheet-selection", "pointerdown"), true);
  assert.equal(studyReadonlyPointerAllowed("sheet-selection", "click"), true);
  assert.equal(studyReadonlyPointerAllowed("sheet-selection", "dblclick"), false);
  assert.equal(studyReadonlyPointerAllowed("mutation-control", "click"), false);
});

test("참고 잠금은 복사·선택·키보드 탐색만 통과시킨다", () => {
  assert.equal(studyReadonlyKeyAllowed({ key:"c", ctrlKey:true, textEntry:true }), true);
  assert.equal(studyReadonlyKeyAllowed({ key:"a", ctrlKey:true, textEntry:true }), true);
  assert.equal(studyReadonlyKeyAllowed({ key:"PageDown" }), true);
  assert.equal(studyReadonlyKeyAllowed({ key:"ArrowDown", textEntry:true }), true);
  assert.equal(studyReadonlyKeyAllowed({ key:" ", textEntry:false, activationControl:false }), true);
  assert.equal(studyReadonlyKeyAllowed({ key:" ", textEntry:true }), false);
  assert.equal(studyReadonlyKeyAllowed({ key:"x", ctrlKey:true, textEntry:true }), false);
  assert.equal(studyReadonlyKeyAllowed({ key:"Delete" }), false);
});

test("모바일 교체 배치는 참고와 작업의 위아래 영역을 완전히 지정한다", () => {
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.match(css, /#content\.study-mode\.study-swapped \.study-reference\{left:0;right:0;top:50%;bottom:0;/);
  assert.match(css, /#content\.study-mode\.study-swapped \.study-work\{left:0;right:0;top:0;bottom:50%\}/);
  assert.match(css, /#content\.study-mode\.study-swapped \.study-ref-lock\{left:12px;top:calc\(50% \+ 10px\)\}/);
});

test("study session state is persisted and restored with tabs", () => {
  const docs = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "../src/js/workspace-store.js"), "utf8");
  assert.match(docs, /study = reference && work && reference\.id !== work\.id/);
  assert.match(docs, /reference: docStableKey\(reference\)/);
  assert.match(docs, /work: docStableKey\(work\)/);
  assert.match(docs, /locked: !!studyReferenceLocked/);
  assert.match(docs, /function restoreStudyState\(saved\)/);
  assert.match(docs, /ensureRendered\(reference\)\.then\(\(\) => \{/);
  assert.match(docs, /reference\.id === studyPdfId && reference\.kind === "pdf"/);
  assert.match(store, /restoreStudyState\(savedTabs\)/);
});
