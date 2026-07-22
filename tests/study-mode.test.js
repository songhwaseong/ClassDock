const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  studyPaneSelectionAction,
  studyReadonlyPointerAllowed,
  studyReadonlyKeyAllowed,
  splitDropRoleForSide,
  tabDropSplitAction,
  INTERNAL_DRAG_MIME,
  isInternalDragTransfer
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

test("드롭한 칸의 역할은 방향과 위치 바꾸기 상태를 따라간다", () => {
  assert.equal(splitDropRoleForSide("left", false), "reference");
  assert.equal(splitDropRoleForSide("right", false), "work");
  assert.equal(splitDropRoleForSide("top", false), "reference");
  assert.equal(splitDropRoleForSide("bottom", false), "work");
  assert.equal(splitDropRoleForSide("left", true), "work");
  assert.equal(splitDropRoleForSide("right", true), "reference");
  assert.equal(splitDropRoleForSide("top", true), "work");
  assert.equal(splitDropRoleForSide("bottom", true), "reference");
});

test("분할 중 탭 드롭은 유지·역할 교대·한쪽 교체를 구분한다", () => {
  // 참고=1, 작업=2
  assert.equal(tabDropSplitAction(1, 2, "reference", 1, 3), "keep");
  assert.equal(tabDropSplitAction(1, 2, "work", 2, 3), "keep");
  assert.equal(tabDropSplitAction(1, 2, "reference", 2, 3), "swap");
  assert.equal(tabDropSplitAction(1, 2, "work", 1, 3), "swap");
  assert.equal(tabDropSplitAction(1, 2, "reference", 3, 4), "replace-reference");
  assert.equal(tabDropSplitAction(1, 2, "work", 3, 4), "replace-work");
});

test("분할 전 탭 드롭은 보던 문서를 상대편 칸에 세워 분할로 들어간다", () => {
  // 보던 문서=2, 다른 탭 3을 끌어옴
  assert.equal(tabDropSplitAction(null, 2, "reference", 3, 2), "replace-reference");
  assert.equal(tabDropSplitAction(null, 2, "work", 3, 2), "pin-current");
});

test("보던 문서의 탭을 끌면 직전에 보던 문서가 짝이 된다", () => {
  assert.equal(tabDropSplitAction(null, 2, "reference", 2, 5), "pin-with-mate");
  assert.equal(tabDropSplitAction(null, 2, "work", 2, 5), "mate-as-reference");
});

test("짝이 없으면 참고로 고정만 하고 기다린다(버튼과 같은 동작)", () => {
  assert.equal(tabDropSplitAction(null, 2, "reference", 2, null), "pin-only");
  assert.equal(tabDropSplitAction(null, 2, "work", 2, null), "keep");
});

test("고정만 해둔 상태(참고=작업)에서 탭을 끌면 분할이 완성된다", () => {
  // 버튼으로 2를 고정만 해둔 상태 — 아직 분할 아님
  assert.equal(tabDropSplitAction(2, 2, "work", 3, null), "pin-current");
  assert.equal(tabDropSplitAction(2, 2, "reference", 3, null), "replace-reference");
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
  assert.match(css, /#content\.study-mode\.study-swapped \.study-reference\{left:0!important;right:0!important;top:50%!important;bottom:0!important;/);
  assert.match(css, /#content\.study-mode\.study-swapped \.study-work\{left:0!important;right:0!important;top:0!important;bottom:50%!important\}/);
  assert.match(css, /#content\.study-mode\.study-swapped \.study-ref-lock\{left:12px!important;top:calc\(50% \+ 10px\)!important\}/);
});

test("상하 분할은 높이 비율·가로 분할바·위아래 드롭 판정을 사용한다", () => {
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const docs = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../manneung-classroom.html"), "utf8");
  assert.match(css, /#content\.study-mode\.study-stacked \.study-reference\{left:0;right:0;top:0;bottom:calc\(100% - var\(--study-split,50%\)\)/);
  assert.match(css, /#content\.study-mode\.study-stacked \.study-divider\{left:0;right:0;top:var\(--study-split,50%\);bottom:auto;width:auto;height:8px/);
  assert.match(docs, /stacked = dy > dx/);
  assert.match(docs, /setStudyStacked\(side === "top" \|\| side === "bottom"\)/);
  assert.match(docs, /if \(stacked\) return clientY < rect\.top \+ rect\.height \/ 2 \? "top" : "bottom"/);
  assert.match(docs, /studyStackSplitRatio/);
  assert.match(docs, /aria-orientation", stacked \? "horizontal" : "vertical"/);
  assert.match(html, /id="studyDirectionToggle"/);
});

test("분할바는 누르는 즉시 포인터를 캡처해 빠른 방향별 드래그도 놓치지 않는다", () => {
  const docs = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  const down = docs.slice(
    docs.indexOf('divider.addEventListener("pointerdown"'),
    docs.indexOf('divider.addEventListener("dblclick"')
  );
  assert.match(down, /const pointerId = e\.pointerId;/);
  assert.match(down, /const startPoint = stacked \? e\.clientY : e\.clientX;/);
  assert.match(down, /ev\.clientY - rect\.top/);
  assert.match(down, /ev\.clientX - rect\.left/);
  assert.match(down, /divider\.setPointerCapture\(pointerId\)/);
  assert.ok(
    down.indexOf("divider.setPointerCapture(pointerId)") < down.indexOf('const move = (ev) =>'),
    "pointer capture must happen before waiting for the first pointermove"
  );
  assert.match(down, /ev\.pointerId !== pointerId/);
  assert.match(down, /divider\.releasePointerCapture\(pointerId\)/);
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

test("internal document drags are separated from external file uploads by MIME type", () => {
  assert.equal(isInternalDragTransfer({ types:[INTERNAL_DRAG_MIME, "text/plain"] }, false), true);
  assert.equal(isInternalDragTransfer({ types:["Files"] }, false), false);
  assert.equal(isInternalDragTransfer({ types:["Files"] }, true), false);
  assert.equal(isInternalDragTransfer({ types:["text/plain"] }, true), true);
  assert.equal(isInternalDragTransfer({ types:[] }, false), false);
});

test("document drag state is marked and reset on every termination path", () => {
  const docs = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  assert.match(docs, /setData\(INTERNAL_DRAG_MIME, "document"\)/);
  assert.match(docs, /function resetDocumentDragState\(\)/);
  assert.match(docs, /!isInternalDragTransfer\(e\.dataTransfer, true\)/);
  assert.match(app, /setData\(INTERNAL_DRAG_MIME, "1"\)/);
  assert.match(app, /const wasInternal = isInternalDragTransfer\(e\.dataTransfer, internalDrag\)/);
  assert.match(app, /window\.addEventListener\("blur", \(\) => \{ resetInternalDragState\(\); hideOverlay\(\); \}\)/);
  assert.match(app, /e\.key === "Escape" && internalDrag/);
});
