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
  const sidebarMenu = source.slice(source.indexOf("function openSidebarDocMenu"), source.indexOf("// 업로드한 일반 폴더 우클릭 메뉴"));
  assert.match(sidebarMenu, /if \(canRenameOriginalDoc\(doc\)\) add\("이름 바꾸기"/);
  assert.doesNotMatch(sidebarMenu, /if \(!canRenameOriginalDoc\(doc\)\) return;/);
  assert.match(rename, /moveOriginalFile\(ctx, name\)/);
  assert.match(source, /await ctx\.dirHandle\.removeEntry\(ctx\.oldName\)/);
  assert.match(source, /doc\.workspacePath = doc\.workspacePath \? refreshWorkspacePath/);
  assert.match(source, /doc\.stableRestoreKey = docStableKey\(doc\)/);
});

test("탭과 사이드바 파일 메뉴는 이름과 상대 경로를 복사한다", () => {
  const source = read("documents.js");
  assert.match(source, /add\("이름 복사", null, \(\) => copyDocumentName\(anchorDoc\)\)/);
  assert.match(source, /add\("상대 경로 복사", null, \(\) => copyDocumentRelativePath\(anchorDoc\)\)/);
  assert.match(source, /add\("이름 복사", \(\) => copyDocumentName\(doc\)\)/);
  assert.match(source, /add\("상대 경로 복사", \(\) => copyDocumentRelativePath\(doc\)\)/);

  const start = source.indexOf("function documentRelativePathForCopy");
  const end = source.indexOf("async function copyDocumentMenuText", start);
  const sandbox = {};
  vm.runInNewContext(source.slice(start, end) + "; this.documentRelativePathForCopy = documentRelativePathForCopy;", sandbox);
  assert.equal(sandbox.documentRelativePathForCopy({ name:"문서.pdf", workspacePath:"수업\\1주차\\문서.pdf" }), "수업/1주차/문서.pdf");
  assert.equal(sandbox.documentRelativePathForCopy({ name:"압축문서.txt", relPath:"자료/압축문서.txt" }), "자료/압축문서.txt");
  assert.equal(sandbox.documentRelativePathForCopy({ name:"낱개.txt" }), "낱개.txt");
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

test("선택한 글자는 안전한 Google 검색 주소로 새 창에 열고 시험 응시 화면에서는 숨긴다", () => {
  const source = read("python-editor.js");
  const start = source.indexOf('const GOOGLE_SEARCH_MENU_LABEL');
  const end = source.indexOf('function addSelectionSearchItems', start);
  assert.ok(start >= 0 && end > start);

  let clicked = 0;
  const link = { click(){ clicked++; } };
  const context = {
    encodeURIComponent,
    document: { createElement: tag => { assert.equal(tag, "a"); return link; } },
    window: { t: value => value, getSelection: () => null }
  };
  vm.runInNewContext(source.slice(start, end) + `
    ;globalThis.__google = {
      GOOGLE_SEARCH_MENU_LABEL, GOOGLE_SEARCH_TEXT_MAX, googleSearchTextFrom,
      googleSearchUrl, openGoogleSearch, selectionContextInsideExam,
      googleSearchMenuItem, selectionSearchMenuItems
    };`, context);
  const api = context.__google;

  assert.equal(api.googleSearchTextFrom("  뉴턴의\n운동\t법칙  "), "뉴턴의 운동 법칙");
  assert.equal(api.googleSearchTextFrom("가".repeat(api.GOOGLE_SEARCH_TEXT_MAX + 1)), "");
  assert.equal(api.googleSearchUrl("뉴턴의 운동 법칙"),
    "https://www.google.com/search?q=" + encodeURIComponent("뉴턴의 운동 법칙"));

  const normal = { closest: () => null };
  const exam = { closest: selector => selector === ".exam-take" ? {} : null };
  assert.equal(api.googleSearchMenuItem("", normal), null);
  assert.equal(api.googleSearchMenuItem("뉴턴", exam), null);
  const item = api.googleSearchMenuItem("뉴턴의 운동 법칙", normal);
  assert.equal(item.label, "Google에서 검색");
  assert.equal(item.disabled, false);
  assert.equal(api.selectionSearchMenuItems("뉴턴", exam).length, 0);

  item.action();
  assert.equal(clicked, 1);
  assert.equal(link.href, "https://www.google.com/search?q=" + encodeURIComponent("뉴턴의 운동 법칙"));
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
});

test("이미지 편집은 공통 미저장 상태를 사용한다", () => {
  const image = read("image-viewer.js");
  assert.match(image, /const markImageDirty/);
  assert.match(image, /saveDocumentRecoverySnapshot\(ownerDoc, blob/);
});

// 화이트보드는 디스크 파일 형식이 없어 ● 를 끌 "저장"이 없다. 예전엔 커밋마다 markDocumentDirty 를
// 켜 놓고 끄는 곳이 없어 ● 가 영영 남았다. 지금은 복구본 자동 저장으로 대신하고 ● 는 켜지 않는다.
test("화이트보드는 ● 대신 복구본을 남기고, Ctrl+S 는 PNG 내보내기로 받는다", () => {
  const board = read("whiteboard.js");
  const app = read("app.js");
  const backup = read("backup.js");
  assert.match(board, /doc\.boardState/);
  assert.match(board, /BOARD_RECOVERY_PREFIX/);
  assert.match(board, /restoreBoardImages/);
  assert.doesNotMatch(board, /markDocumentDirty\(/);   // 호출은 없어야 한다(설명 주석에는 이름이 남아 있다)
  // 브라우저 기본 "웹페이지 저장(HTML)" 대신 툴바 PNG 와 같은 동작으로 받는다.
  assert.match(board, /doc\.saveBoardPng = \(\) => exportPng\(\{ notify:true \}\)/);
  assert.match(app, /state\.kind === "board" && typeof state\.saveBoardPng === "function"/);
  // ● 를 안 켜므로 백업 플러시는 hasUnsavedEdits 판정 앞에서 보드를 먼저 흘려보내야 한다.
  const flush = backup.slice(backup.indexOf("for (const doc of [...docs])"));
  assert.match(flush, /doc\.kind === "board"[\s\S]{0,120}flushBoardRecovery[\s\S]{0,200}if \(!doc\.hasUnsavedEdits\) continue;/);
});

/* 문서에서 고른 낱말을 사이드바 검색창(파일명·내용)으로 넘기는 길 — 사람이 직접 친 것과 같은
   길(onSidebarSearchInput)을 타야 이름 거르기·내용 검색·최근 검색어가 갈라지지 않는다. */
test("고른 글자로 파일 검색을 걸면 사이드바를 펴고 같은 검색 경로를 탄다", () => {
  const source = read("documents.js");
  const body = source.slice(source.indexOf("function searchFilesForText"), source.indexOf("function fileSearchMenuItem"));
  assert.match(body, /const input = byId\("sbSearch"\)/);
  assert.match(body, /if \(!text \|\| !input\) return false/);
  // 접어 둔 사이드바에 결과만 넣으면 아무 일도 없는 것처럼 보인다. 커서는 건드리지 않고 편다.
  assert.match(body, /if \(sidebarCollapsed\) openSidebar\(\{ reveal:false \}\)/);
  assert.match(body, /input\.value = text;\s*\n\s*onSidebarSearchInput\(\)/);
  // 결과를 보며 고쳐 칠 수 있게 검색어를 통째로 골라 둔다.
  assert.match(body, /input\.setSelectionRange\(0, input\.value\.length\)/);
});

test("파일 검색으로 넘길 글자는 문단째 긁은 것만 거른다", () => {
  const source = read("documents.js");
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  const start = source.indexOf("const FILE_SEARCH_MENU_LABEL");
  vm.runInContext(source.slice(start, source.indexOf("function searchFilesForText")) + `
    ;globalThis.__files = { FILE_SEARCH_TEXT_MAX, fileSearchTextFrom };`, context);
  const api = context.__files;
  assert.equal(api.fileSearchTextFrom("  세종대왕 "), "세종대왕");
  // 장소 이름보다 너그럽다 — 문장 조각으로 본문을 찾는 것도 쓸모가 있다.
  assert.equal(api.fileSearchTextFrom("조선\n전기의\t문화"), "조선 전기의 문화");
  assert.equal(api.fileSearchTextFrom(""), "");
  assert.equal(api.fileSearchTextFrom("가".repeat(api.FILE_SEARCH_TEXT_MAX + 1)), "");
});
