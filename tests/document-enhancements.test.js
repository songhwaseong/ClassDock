const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "../src/js", name), "utf8");

test("표시 이름 변경은 실제 저장 이름과 분리하고 원래 복원 키를 유지한다", () => {
  const source = read("documents.js");
  const start = source.indexOf("async function renameDoc");
  const end = source.indexOf("// 탭 우클릭 메뉴", start);
  const rename = source.slice(start, end);
  assert.match(rename, /doc\.stableRestoreKey\s*=\s*docStableKey\(doc\)/);
  assert.match(rename, /원본 파일과 저장\/내보내기 파일 이름은 그대로/);
  assert.doesNotMatch(rename, /doc\.fileName\s*=\s*name/);
  assert.match(source, /if \(doc\.stableRestoreKey\) return doc\.stableRestoreKey/);
});

test("Office 검색은 압축 해제 크기를 제한하고 대용량 XML split을 사용하지 않는다", () => {
  const source = read("documents.js");
  assert.match(source, /OFFICE_XML_ENTRY_MAX_BYTES/);
  assert.match(source, /OFFICE_XML_TOTAL_MAX_BYTES/);
  assert.match(source, /e\.uncompressedSize/);
  assert.doesNotMatch(source, /String\(xml\)\.split\(paraSplitRe\)/);
});

test("대용량 Markdown 소스 보기에도 미리보기 복귀 도구막대가 남는다", () => {
  const source = read("code-viewer.js");
  assert.match(source, /if \(canEdit \|\| jsonPretty \|\| isHtml \|\| isMd\)/);
});

test("스프레드시트 전체 바꾸기는 재계산과 다시 그리기를 각각 한 번만 수행한다", () => {
  const source = read("spreadsheet-viewer.js");
  assert.match(source, /recalcAndRefresh\(\{ refreshDom:false \}\)/);
  assert.match(source, /renderEditable\(currentSheet, \{ skipRecalc:recalculated \}\)/);
});

test("스프레드시트 편집은 공통 미저장 상태와 작업공간 복구 스냅샷을 갱신한다", () => {
  const sheet = read("spreadsheet-viewer.js");
  const docs = read("documents.js");
  assert.match(sheet, /syncSpreadsheetDirtyState/);
  assert.match(sheet, /markDocumentDirty\(doc\)/);
  assert.match(sheet, /saveDocumentRecoverySnapshot\(doc, bytes/);
  assert.match(sheet, /markSpreadsheetSaved/);
  assert.match(docs, /function markDocumentDirty\(/);
  assert.match(docs, /function markDocumentSavedSnapshot\(/);
});

test("이미지와 화이트보드 편집도 공통 미저장 상태를 사용한다", () => {
  const image = read("image-viewer.js");
  const board = read("whiteboard.js");
  assert.match(image, /const markImageDirty/);
  assert.match(image, /saveDocumentRecoverySnapshot\(ownerDoc, blob/);
  assert.match(board, /markDocumentDirty\(doc\)/);
  assert.match(board, /doc\.boardState/);
  assert.match(board, /BOARD_RECOVERY_PREFIX/);
  assert.match(board, /restoreBoardImages/);
});
