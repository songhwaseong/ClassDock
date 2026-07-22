const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (name) => fs.readFileSync(path.join(__dirname, "../src/js", name), "utf8");

test("이름 변경은 원본 폴더 권한이 있는 문서에만 노출하고 실제 파일과 경로를 갱신한다", () => {
  const source = read("documents.js");
  const start = source.indexOf("async function renameDoc");
  const end = source.indexOf("// 탭 우클릭 메뉴", start);
  const rename = source.slice(start, end);
  assert.match(source, /function canRenameOriginalDoc\(doc\)/);
  assert.match(source, /doc\.originalSaveMode/);
  assert.match(source, /typeof directDir\.removeEntry === "function"/);
  assert.match(source, /if \(canRenameOriginalDoc\(anchorDoc\)\) add\("이름 바꾸기"/);
  assert.match(source, /if \(!canRenameOriginalDoc\(doc\)\) return;/);
  assert.match(rename, /moveOriginalFile\(ctx, name\)/);
  assert.match(source, /await ctx\.dirHandle\.removeEntry\(ctx\.oldName\)/);
  assert.match(source, /doc\.workspacePath = doc\.workspacePath \? refreshWorkspacePath/);
  assert.match(source, /doc\.stableRestoreKey = docStableKey\(doc\)/);
});

test("원본 이름 변경 폴백은 복사를 마친 뒤에만 이전 파일을 제거한다", async () => {
  const source = read("documents.js");
  const start = source.indexOf("async function originalRenameTargetExists");
  const end = source.indexOf("function replaceWorkspacePathInGroups", start);
  const sandbox = {};
  vm.runInNewContext(source.slice(start, end) + "; this.moveOriginalFile = moveOriginalFile;", sandbox);

  const events = [];
  const originalFile = { size:4 };
  const oldHandle = {
    getFile: async () => originalFile,
    isSameEntry: async other => other === oldHandle
  };
  const entries = new Map([["old.txt", oldHandle]]);
  const dirHandle = {
    getFileHandle: async (name, options={}) => {
      if (entries.has(name)) return entries.get(name);
      if (!options.create){ const error = new Error("missing"); error.name = "NotFoundError"; throw error; }
      let size = 0;
      const target = {
        createWritable: async () => ({
          write: async file => { events.push("write"); size = file.size; },
          close: async () => { events.push("close"); },
          abort: async () => {}
        }),
        getFile: async () => ({ size })
      };
      entries.set(name, target);
      return target;
    },
    removeEntry: async name => { events.push("remove:" + name); entries.delete(name); }
  };
  const result = await sandbox.moveOriginalFile({ oldName:"old.txt", fileHandle:oldHandle, dirHandle }, "new.txt");
  assert.equal(result, entries.get("new.txt"));
  assert.equal(entries.has("old.txt"), false);
  assert.deepEqual(events, ["write", "close", "remove:old.txt"]);
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
