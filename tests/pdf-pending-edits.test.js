const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// pdf-recovery.js 에서 스냅샷·히스토리 계열 함수만 떼어 실행한다.
function loadPendingEditsApi(){
  const source = fs.readFileSync(path.join(__dirname, "../src/js/pdf-recovery.js"), "utf8");
  const slice = (from, to) => {
    const start = source.indexOf(from), end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `${from} 를 찾을 수 있어야 한다`);
    return source.slice(start, end);
  };
  const historySource = fs.readFileSync(path.join(__dirname, "../src/js/history.js"), "utf8");
  const context = {
    console, setTimeout, clearTimeout,
    serializePdfOutline: (items) => (items || []).map(it => ({ title: it.title })),
  };
  vm.createContext(context);
  vm.runInContext(
    historySource
    + slice("function serializePdfElements", "async function savePdfRecovery")
    + slice("function initPdfHistory", "function recordPdfEdit")
    + "\n;globalThis.__api = { initPdfHistory, pdfHasPendingEdits, commitPdfHistory, snapshotPdfState };",
    context
  );
  return context.__api;
}

// 페이지 2장짜리 PDF 문서. cssW/cssH 는 요소 좌표를 비율로 바꿀 때 쓰인다.
function makeDoc(){
  return {
    kind: "pdf",
    pages: [
      { originalIndex: 0, exportRotation: 0, cssW: 100, cssH: 100 },
      { originalIndex: 1, exportRotation: 0, cssW: 100, cssH: 100 },
    ],
    pdfOutline: [{ title: "1장" }],
    elements: [],
  };
}

const inkElement = (pageIndex) => ({
  pageIndex, kind: "ink",
  el: { offsetLeft: 10, offsetTop: 10, offsetWidth: 20, offsetHeight: 20, __strokes: [[1, 2]] },
});

test("연 직후에는 편집이 없다고 본다", () => {
  const { initPdfHistory, pdfHasPendingEdits } = loadPendingEditsApi();
  const doc = makeDoc();
  initPdfHistory(doc);
  assert.equal(pdfHasPendingEdits(doc), false);
});

test("페이지 회전만 해도 편집으로 본다(주석이 없어도)", () => {
  const { initPdfHistory, pdfHasPendingEdits } = loadPendingEditsApi();
  const doc = makeDoc();
  initPdfHistory(doc);
  doc.pages[0].exportRotation = 90;
  assert.equal(pdfHasPendingEdits(doc), true);
});

test("페이지 재정렬만 해도 편집으로 본다", () => {
  const { initPdfHistory, pdfHasPendingEdits } = loadPendingEditsApi();
  const doc = makeDoc();
  initPdfHistory(doc);
  doc.pages.reverse();
  assert.equal(pdfHasPendingEdits(doc), true);
});

test("페이지 삭제만 해도 편집으로 본다", () => {
  const { initPdfHistory, pdfHasPendingEdits } = loadPendingEditsApi();
  const doc = makeDoc();
  initPdfHistory(doc);
  doc.pages.pop();
  assert.equal(pdfHasPendingEdits(doc), true);
});

test("목차 편집만 해도 편집으로 본다", () => {
  const { initPdfHistory, pdfHasPendingEdits } = loadPendingEditsApi();
  const doc = makeDoc();
  initPdfHistory(doc);
  doc.pdfOutline = [{ title: "고친 제목" }];
  assert.equal(pdfHasPendingEdits(doc), true);
});

test("주석·서명이 있으면 편집으로 본다", () => {
  const { initPdfHistory, pdfHasPendingEdits } = loadPendingEditsApi();
  const doc = makeDoc();
  initPdfHistory(doc);
  doc.elements.push(inkElement(0));
  assert.equal(pdfHasPendingEdits(doc), true);
});

test("편집을 되돌려 연 직후 상태로 돌아오면 다시 편집 없음이 된다", () => {
  const { initPdfHistory, pdfHasPendingEdits } = loadPendingEditsApi();
  const doc = makeDoc();
  initPdfHistory(doc);
  doc.pages[0].exportRotation = 90;
  assert.equal(pdfHasPendingEdits(doc), true);
  doc.pages[0].exportRotation = 0;
  assert.equal(pdfHasPendingEdits(doc), false);
});

// 히스토리는 50개를 넘으면 shift() 로 가장 오래된 항목(=연 직후 상태)을 버린다.
// 기준점을 pdfHistory[0] 이 아니라 pdfBaselineJson 으로 따로 들고 있어야 하는 이유.
test("편집을 50번 넘게 해도 기준점은 연 직후 상태로 남는다", () => {
  const { initPdfHistory, pdfHasPendingEdits, commitPdfHistory } = loadPendingEditsApi();
  const doc = makeDoc();
  initPdfHistory(doc);

  for (let i = 1; i <= 60; i++){
    doc.pages[0].exportRotation = (i % 4) * 90;
    commitPdfHistory(doc);
  }
  // 상한까지 찼다는 건 앞쪽이 버려졌다는 뜻 = 연 직후 상태는 이미 히스토리에서 밀려났다
  assert.equal(doc.pdfHistory.size(), 50, "히스토리는 상한(50)으로 잘린다");

  doc.pages[0].exportRotation = 0;                       // 연 직후와 같은 상태로 되돌림
  assert.equal(pdfHasPendingEdits(doc), false, "기준점이 밀려나도 편집 없음을 정확히 판단해야 한다");
});

test("PDF 가 아니거나 기준점이 없으면 편집 없음으로 본다", () => {
  const { pdfHasPendingEdits } = loadPendingEditsApi();
  assert.equal(pdfHasPendingEdits(null), false);
  assert.equal(pdfHasPendingEdits({ kind: "board" }), false);
  assert.equal(pdfHasPendingEdits(makeDoc()), false, "아직 열리는 중이면 기준점이 없다");
});
