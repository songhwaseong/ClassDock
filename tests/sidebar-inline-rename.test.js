"use strict";

// 폴더 우클릭으로 만든 새 문서의 이름을 사이드바 줄에서 바로 받는다.
// 예전엔 "새 코드.py" 같은 임시 이름으로 만들어 두고 첫 저장(Ctrl+S) 때 대화상자로 이름을 물었다.
// 이제는 만들자마자 그 줄이 입력이 되고, 거기서 정한 이름은 저장 때 다시 묻지 않는다(_nameChosen).
// 파일이 실제로 디스크에 생기는 시점은 예전과 같은 '첫 저장'이라, _named 는 여전히 저장 성공에서만 선다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8");
const documentsSource = read("documents.js");
const spreadsheetSource = read("spreadsheet-viewer.js");
const pythonViewerSource = ["code-viewer.js", "python-snippets.js", "python-editor.js", "python-run-context.js", "python-runtime.js"]
  .map(read).join("\n");

/* ===== documents.js 의 이름 짓기 상태기계 ===== */
// documents.js 는 브라우저 전역에 기대므로 최소한만 흉내 낸다. 사이드바를 실제로 그리는 부분
// (createSidebarRenameInput)은 DOM 이 필요하므로, 여기서는 renderSidebar 를 스텁으로 갈아 끼우고
// 상태 전이(열기·취소·확정)만 본다. 그린 결과는 아래 소스 검증 테스트가 대신 지킨다.
function loadRenameStateMachine(options={}){
  const elementStub = () => ({
    style:{ setProperty(){} }, dataset:{}, classList:{ add(){}, remove(){}, toggle(){} },
    append(){}, appendChild(){}, addEventListener(){}, setAttribute(){},
    querySelectorAll:() => [], querySelector:() => null, focus(){}, scrollIntoView(){}, contains:() => false
  });
  const calls = [];
  const ctx = {
    SUBTITLE_EXTS:[], SQLITE_EXTS:[], BINARY_ASSET_EXTS:new Set(),
    IMG_EXTS:[], VIDEO_EXTS:[], AUDIO_EXTS:[],
    console, setTimeout, clearTimeout, requestAnimationFrame:() => 0,
    Blob, URL, TextDecoder, TextEncoder,
    document:{ createElement:elementStub, querySelectorAll:() => [], addEventListener(){} },
    window:{ addEventListener(){}, t:(s) => s, tf:() => "" },
    localStorage:{ getItem:() => null, setItem(){} },
    byId:() => elementStub(),
    docs:options.docs || [],
    navNodes:[],
    navNodeById:(id) => (options.docs || []).some(d => d.nodeId === id) ? { nodeId:id, type:"doc" } : null,
    // 이름 확정 규칙은 code-viewer.js 의 공통 함수가 맡는다 — 여기서는 호출 여부·인자만 본다.
    applyScratchDocName:async (doc, typed) => {
      calls.push({ id:doc.id, typed });
      if (options.applyResult === null) return null;
      doc.name = String(typed);
      return doc.name;
    }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // state.js 의 사이드바 전역만 따로 세운다(state.js 전체를 올리지 않아도 되게).
  vm.runInContext("let sidebarCollapsed = false, sidebarCursorKey = null, lastFocusedDocId = null;\n"
    + documentsSource
    + "\n;globalThis.__sb = { begin:beginSidebarRename, cancel:cancelSidebarRename, commit:commitSidebarRename,"
    + "   state:() => sidebarRenameState, setValue:(v) => { sidebarRenameState.value = v; } };", ctx);
  ctx.renderSidebar = () => {};        // 실제 함수 선언이 스텁을 덮으므로 로드 뒤에 다시 씌운다
  ctx.focusSidebarDoc = () => {};
  return { sb: ctx.__sb, calls };
}

const scratchDoc = (over) => Object.assign({ id:7, nodeId:"doc:7", name:"새 코드.py", isScratch:true }, over);

test("갓 만든 문서는 사이드바 줄에서 이름을 받고, 확장자를 뺀 앞부분만 선택된다", () => {
  const doc = scratchDoc();
  const { sb } = loadRenameStateMachine({ docs:[doc] });
  assert.equal(sb.begin(doc), true);
  const state = sb.state();
  assert.equal(state.docId, 7);
  assert.equal(state.nodeId, "doc:7");
  assert.equal(state.value, "새 코드.py");
  assert.equal(state.selStart, 0);
  assert.equal(state.selEnd, "새 코드".length);   // ".py" 는 선택에서 빠져 그대로 남는다
});

test("확장자가 없는 이름은 전체가 선택된다", () => {
  const doc = scratchDoc({ name:"README" });
  const { sb } = loadRenameStateMachine({ docs:[doc] });
  sb.begin(doc);
  assert.equal(sb.state().selEnd, "README".length);
});

test("이미 저장했거나 이름을 정한 문서는 인라인 이름 짓기를 열지 않는다", () => {
  for (const over of [{ _named:true }, { _nameChosen:true }, { isScratch:false }]){
    const doc = scratchDoc(over);
    const { sb } = loadRenameStateMachine({ docs:[doc] });
    assert.equal(sb.begin(doc), false);
    assert.equal(sb.state(), null);
  }
});

test("Esc(취소)는 만들 때 붙인 기본 이름을 그대로 둔다", () => {
  const doc = scratchDoc();
  const { sb, calls } = loadRenameStateMachine({ docs:[doc] });
  sb.begin(doc);
  sb.setValue("성적표");
  sb.cancel();
  assert.equal(sb.state(), null);
  assert.equal(calls.length, 0);
  assert.equal(doc.name, "새 코드.py");
  // 이름을 정하지 않았으므로 첫 저장에서는 예전처럼 대화상자로 물어야 한다.
  assert.ok(!doc._nameChosen);
});

test("Enter(확정)는 공통 이름 규칙을 거치고 첫 저장에서 다시 묻지 않게 표시한다", async () => {
  const doc = scratchDoc();
  const { sb, calls } = loadRenameStateMachine({ docs:[doc] });
  sb.begin(doc);
  sb.setValue("  성적표  ");
  await sb.commit();
  assert.deepEqual(calls, [{ id:7, typed:"성적표" }]);   // 앞뒤 공백은 떼고 넘긴다
  assert.equal(doc._nameChosen, true);
  assert.equal(sb.state(), null);
  // 파일은 아직 디스크에 없다 — 저장 성공에서만 서는 _named 는 그대로 둔다.
  assert.ok(!doc._named);
});

test("기본 이름을 그대로 Enter로 확정해도 첫 저장에서 다시 묻지 않는다", async () => {
  const doc = scratchDoc();
  const { sb, calls } = loadRenameStateMachine({ docs:[doc] });
  sb.begin(doc);
  assert.equal(await sb.commit(), true);
  assert.equal(calls.length, 0);
  assert.equal(doc._nameChosen, true);
});

test("이름 확정이 취소되면(덮어쓰기 거부) 기본 이름을 유지한다", async () => {
  const doc = scratchDoc();
  const { sb } = loadRenameStateMachine({ docs:[doc], applyResult:null });
  sb.begin(doc);
  sb.setValue("이미있음");
  await sb.commit();
  assert.ok(!doc._nameChosen);
  assert.equal(sb.state(), null);
});

test("이름을 짓던 문서를 닫으면 다시 그릴 때 상태를 놓아준다", () => {
  const doc = scratchDoc();
  const { sb } = loadRenameStateMachine({ docs:[doc] });
  assert.match(documentsSource,
    /if \(sidebarRenameState\)\{[\s\S]*?const renaming = docs\.find\(d => d\.id === sidebarRenameState\.docId\);[\s\S]*?sidebarRenameState = null;/);
  assert.equal(sb.begin(doc), true);
});

/* ===== 이름 확정 규칙(대화상자 없이도 첫 저장 대화상자와 같은 규칙) ===== */
function loadNameApplier(){
  const ctx = vm.createContext({
    console, window:{}, docs:[],
    localStorage:{ getItem:() => null, setItem:() => {} },
    TextEncoder, TextDecoder,
    btoa:(value) => Buffer.from(value, "binary").toString("base64"),
    atob:(value) => Buffer.from(value, "base64").toString("binary"),
    askText:async () => { throw new Error("인라인 이름 짓기는 대화상자를 띄우면 안 된다"); },
    confirmDialog:async () => false
  });
  new vm.Script(pythonViewerSource, { filename:"python-viewer.js" }).runInContext(ctx);
  return new vm.Script("applyScratchDocName").runInContext(ctx);
}

test("인라인으로 정한 이름은 대화상자 없이 확장자·폴더 경로를 유지한다", async () => {
  const applyScratchDocName = loadNameApplier();
  const doc = { name:"새 코드.py", isScratch:true, workspacePath:"수업/자료/새 코드.py", relPath:"수업/자료/새 코드.py" };
  assert.equal(await applyScratchDocName(doc, "정렬연습", doc.name), "정렬연습.py");
  assert.equal(doc.name, "정렬연습.py");
  assert.equal(doc.workspacePath, "수업/자료/정렬연습.py");
  assert.equal(doc.relPath, "수업/자료/정렬연습.py");
});

test("인라인 이름도 쓸 수 없는 문자를 지우고 빈 이름은 원래 이름을 지킨다", async () => {
  const applyScratchDocName = loadNameApplier();
  const doc = { name:"새 메모.txt", isScratch:true, workspacePath:"새 메모.txt" };
  assert.equal(await applyScratchDocName(doc, "가/나:다", doc.name), "가나다.txt");

  const blank = { name:"새 메모.txt", isScratch:true, workspacePath:"새 메모.txt" };
  assert.equal(await applyScratchDocName(blank, "   ", blank.name), "새 메모.txt");
});

/* ===== 이어 붙는 지점(소스 검증) ===== */
test("폴더 우클릭으로 만든 새 문서는 만들자마자 사이드바에서 이름을 받는다", () => {
  assert.match(pythonViewerSource,
    /const opened = handleFiles\(\[file\][\s\S]*?opened\.then\(\(newDoc\) =>[\s\S]*?beginSidebarRename\(target\)/);
});

test("사이드바에서 이름을 정했으면 세 가지 첫 저장 경로가 모두 다시 묻지 않는다", () => {
  // .py 저장
  assert.match(pythonViewerSource, /ownerDoc\.isScratch && !ownerDoc\._named && !ownerDoc\._nameChosen\)\{/);
  // 텍스트·노트북·블록 문서 저장
  assert.match(pythonViewerSource, /ownerDoc\.isScratch && !ownerDoc\._named && !ownerDoc\._nameChosen\s*\n\s*&& \(wantOriginal/);
  // 표(XLSX) 저장 — 내보내기 파일 이름도 정한 이름을 따라가야 한다.
  assert.match(spreadsheetSource, /if \(doc\._nameChosen\)\{ base = sheetBaseName\(doc\.name/);
});

test("이름 입력 중에는 사이드바 커서 복원이 포커스를 뺏지 않는다", () => {
  // 포커스를 줄로 되돌리면 그 자리에서 blur → 이름이 사용자의 뜻과 무관하게 확정된다.
  assert.match(documentsSource, /if \(!sidebarRenameState && byId\("sbList"\)\.contains\(document\.activeElement\)\)\{/);
});

test("이름 입력은 줄 클릭(파일 열기)·드래그·사이드바 키 이동으로 새어 나가지 않는다", () => {
  assert.match(documentsSource,
    /\["click", "dblclick", "pointerdown", "mousedown", "contextmenu", "dragstart"\]\.forEach\(type =>\s*\n?\s*input\.addEventListener\(type, \(e\) => e\.stopPropagation\(\)\)\)/);
  assert.match(documentsSource, /input\.addEventListener\("keydown", \(e\) => \{\s*e\.stopPropagation\(\);/);
  assert.match(documentsSource, /item\.draggable = false;/);
});

test("이름 입력 중 Ctrl+S는 이름 확정이 끝난 뒤 현재 문서를 저장한다", () => {
  assert.match(documentsSource,
    /shortcutMatches\(e, "saveCurrent"\)[\s\S]*?commitSidebarRename\(\)\.then\(\(committed\) => \{ if \(committed\) saveDocAfterSidebarRename\(doc\); \}\)/);
  assert.match(documentsSource,
    /function saveDocAfterSidebarRename\(doc\)\{[\s\S]*?querySelector\("\.run-save"\)[\s\S]*?save\.click\(\)/);
});

test("이름을 짓는 새 문서는 검색·확장자 필터와 관계없이 표시한다", () => {
  assert.match(documentsSource,
    /else if \(sidebarRenameState && sidebarRenameState\.nodeId === node\.nodeId\) result = true;/);
});

test("저장 전 문서는 사이드바 메뉴에서 디스크 삭제와 구분해 버릴 수 있다", () => {
  assert.match(documentsSource,
    /if \(doc\.isScratch && !doc\._named\)\{[\s\S]*?add\("미저장 파일 삭제", \(\) => deleteUnsavedScratchDoc\(doc\)\)/);
  assert.match(documentsSource,
    /function deleteUnsavedScratchDoc\(doc\)[\s\S]*?archiveCtx\.remove\(path\)[\s\S]*?closeDoc\(doc\.id, \{ forgetWorkspace:true, skipConfirm:true \}\)/);
});

test("폴더 동기화는 인라인으로 이름만 정한 문서도 삭제된 파일로 보지 않는다", () => {
  // _named(저장 성공)만 보므로, 이름만 정하고 아직 저장하지 않은 문서는 계속 살아남는다.
  const loaderSource = read("file-loaders.js");
  assert.match(loaderSource, /if \(!file && doc\.isScratch && !doc\._named\)\{ keptDocs\.push\(doc\); continue; \}/);
  assert.doesNotMatch(loaderSource, /_nameChosen/);
});
