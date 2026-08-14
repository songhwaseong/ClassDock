"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8");
// python-viewer.js 분할본을 이어붙여 실행 — 번들과 동일한 전역 환경이 된다.
const pythonViewerSource = ["workspace-python.js", "code-viewer.js", "python-snippets.js", "python-editor.js", "python-run-context.js", "python-runtime.js"]
  .map(read).join("\n");
const documentsSource = read("documents.js");
const notebookSource = read("notebook-model.js");
const mnoteSource = read("mnote.js");
const spreadsheetSource = read("spreadsheet-viewer.js");

// createScratchInFolder 는 폴더 우클릭 '새로 만들기'의 공통 경로다.
// handleFiles 로 넘어가는 폴더 문맥이 종류와 무관하게 같아야 첫 저장이 그 폴더 원본에 떨어진다.
function runCreateScratchInFolder(options={}){
  const captured = [];
  const context = vm.createContext({
    console,
    window:{},
    localStorage:{ getItem:() => null, setItem:() => {} },
    TextEncoder,
    TextDecoder,
    btoa:(value) => Buffer.from(value, "binary").toString("base64"),
    atob:(value) => Buffer.from(value, "base64").toString("binary"),
    docs:options.docs || [],
    navNodes:options.navNodes || [],
    toast:() => {},
    File:class { constructor(parts, name, opts){ this.parts = parts; this.name = name; this.opts = opts; } },
    handleFiles:(files, opts) => { captured.push({ file:files[0], opts }); }
  });
  new vm.Script(pythonViewerSource, { filename:"python-viewer.js" }).runInContext(context);
  const create = new vm.Script("createScratchInFolder").runInContext(context);
  const result = create(options.folder, options.makeName, options.makeContent, options.mime, options.notice);
  return { result, captured };
}

const folderCtx = { parentId:"grp-1", dir:"수업/자료", archiveCtx:{ isFolderContext:true }, label:"자료" };
const twice = (number) => (number > 1 ? "새 것 " + number + ".txt" : "새 것.txt");

test("폴더 안 새 문서는 폴더 문맥(부모·묶음·상대경로)을 그대로 물려받는다", () => {
  const { result, captured } = runCreateScratchInFolder({
    folder:folderCtx, makeName:twice, makeContent:() => "본문", mime:"text/plain", notice:"새 파일을"
  });
  assert.equal(result, true);
  assert.equal(captured.length, 1);
  const { file, opts } = captured[0];
  assert.equal(file.name, "새 것.txt");
  assert.equal(file.parts[0], "본문");
  assert.equal(opts.isScratch, true);
  assert.equal(opts.parentId, "grp-1");
  assert.equal(opts.archiveCtx, folderCtx.archiveCtx);
  assert.equal(opts.relPath, "수업/자료/새 것.txt");
  assert.equal(opts.workspacePath, "수업/자료/새 것.txt");
});

test("같은 폴더에 같은 이름이 있으면 번호를 붙여 겹치지 않게 만든다", () => {
  const { captured } = runCreateScratchInFolder({
    folder:folderCtx,
    docs:[{ workspacePath:"수업/자료/새 것.txt" }, { relPath:"수업/자료/새 것 2.txt" }],
    makeName:twice, makeContent:() => "", mime:"text/plain"
  });
  assert.equal(captured[0].file.name, "새 것 3.txt");
  assert.equal(captured[0].opts.relPath, "수업/자료/새 것 3.txt");
});

test("본문 생성 콜백은 번호까지 확정된 파일 이름을 받는다(.mnote 제목이 파일 이름을 따라가는 근거)", () => {
  const { captured } = runCreateScratchInFolder({
    folder:folderCtx,
    docs:[{ workspacePath:"수업/자료/새 것.txt" }],
    makeName:twice, makeContent:(name) => "제목:" + name, mime:"text/plain"
  });
  assert.equal(captured[0].file.parts[0], "제목:새 것 2.txt");
});

test("원본 저장 폴더에서 만든 문서는 originalSaveMode 를 이어받아 그 폴더 원본에 저장된다", () => {
  const withOriginal = runCreateScratchInFolder({
    folder:folderCtx,
    navNodes:[{ nodeId:"grp-1", type:"group", folderRefreshRootId:"grp-1", originalSaveMode:true }],
    makeName:twice, makeContent:() => "", mime:"text/plain"
  });
  assert.equal(withOriginal.captured[0].opts.originalSaveMode, true);

  const withoutOriginal = runCreateScratchInFolder({
    folder:folderCtx,
    navNodes:[{ nodeId:"grp-1", type:"group", folderRefreshRootId:"grp-1", originalSaveMode:false }],
    makeName:twice, makeContent:() => "", mime:"text/plain"
  });
  assert.equal(withoutOriginal.captured[0].opts.originalSaveMode, false);
});

test("폴더 문맥이 불완전하면 아무것도 만들지 않는다", () => {
  for (const folder of [null, { parentId:"grp-1" }, { parentId:"grp-1", archiveCtx:{}, dir:"" }]){
    const { result, captured } = runCreateScratchInFolder({
      folder, makeName:twice, makeContent:() => "", mime:"text/plain"
    });
    assert.equal(result, false);
    assert.equal(captured.length, 0);
  }
});

test("폴더 우클릭 메뉴는 사이드바 '새로 만들기'와 같은 종류를 모두 제공한다(화이트보드 제외)", () => {
  assert.match(documentsSource, /add\("\+Py {2}새 Python 코드"[\s\S]*?newPythonScratchInFolder\(node\.newPythonContext\)/);
  assert.match(documentsSource, /add\("\+Nb {2}새 노트북"[\s\S]*?newNotebookScratchInFolder\(node\.newPythonContext\)/);
  assert.match(documentsSource, /add\("\+Xls {2}새 빈 표"[\s\S]*?newSpreadsheetScratchInFolder\(node\.newPythonContext\)/);
  assert.match(documentsSource, /add\("\+Txt {2}새 텍스트 파일"[\s\S]*?newTextScratchInFolder\(node\.newPythonContext\)/);
  assert.match(documentsSource, /add\("\+Mn {2}새 블록 문서"[\s\S]*?newMnoteScratchInFolder\(node\.newPythonContext\)/);
  // 화이트보드는 디스크 파일 형식이 없는 가상 문서라 폴더 안에 만들 수 없다.
  assert.doesNotMatch(documentsSource, /newWhiteboardInFolder/);
});

test("종류별 폴더 생성 함수는 모두 공통 헬퍼를 거친다", () => {
  assert.match(pythonViewerSource, /function createPythonScratchInFolder\(folder\)\{\s*return createScratchInFolder\(/);
  assert.match(pythonViewerSource, /function newTextScratchInFolder\(folder\)\{\s*return createScratchInFolder\(/);
  assert.match(notebookSource, /function newNotebookScratchInFolder\(folder\)\{[\s\S]*?return createScratchInFolder\(/);
  assert.match(mnoteSource, /function newMnoteScratchInFolder\(folder\)\{[\s\S]*?return createScratchInFolder\(/);
  assert.match(spreadsheetSource, /async function newSpreadsheetScratchInFolder\(folder\)\{[\s\S]*?return createScratchInFolder\(/);
});

test("폴더에서 만든 빈 표는 저장 위치를 다시 묻지 않고 그 폴더에 파일을 만든다", () => {
  assert.match(spreadsheetSource, /if \(doc\.isScratch && doc\.originalSaveMode\) return "create"/);
});

// 폴더를 연 시점의 파일 목록으로 고정되는 archiveCtx 에 새 문서가 등록되지 않으면,
// 같은 폴더의 다른 코드가 그 파일을 import 하지 못하고 경로 도우미도 '찾지 못함'으로 표시한다.
function runFolderCtxHarness(){
  const core = require("../src/js/core.js");
  const context = vm.createContext(Object.assign({
    console,
    window:{},
    localStorage:{ getItem:() => null, setItem:() => {}, removeItem:() => {} },
    TextEncoder, TextDecoder,
    docs:[], navNodes:[], toast:() => {},
    File:class {
      constructor(parts, name, opts){
        this.parts = parts; this.name = name; this.opts = opts;
        this.text = String(parts[0] == null ? "" : parts[0]);
        this.size = this.text.length;
      }
      async arrayBuffer(){ return new TextEncoder().encode(this.text).buffer; }
    },
    handleFiles:() => {}
  }, core));
  new vm.Script(pythonViewerSource, { filename:"python-viewer.js" }).runInContext(context);
  return context;
}

test("폴더 우클릭으로 만든 새 파일은 실행 묶음(archiveCtx)에도 등록된다", async () => {
  const context = runFolderCtxHarness();
  const run = (code) => new vm.Script(code).runInContext(context);
  const makeFile = run("(text, name) => new File([text], name)");
  const pairs = [{ file:makeFile("import helper\n", "main.py"), relPath:"proj/main.py" }];
  const folderCtx = run("makeFileSiblingCtx")(pairs, "proj", ["proj"]);
  const folder = { parentId:"grp-1", dir:"proj", archiveCtx:folderCtx, label:"proj" };

  run("createScratchInFolder")(folder, () => "helper.py", () => "def hi(): return 1\n", "text/x-python", null);

  assert.deepEqual(folderCtx.paths, ["proj/main.py", "proj/helper.py"]);
  // 디스크에 저장하기 전이라도 실행 번들에 실려야 main.py 의 import helper 가 동작한다.
  const filter = run("buildArchiveScopeFilter")("proj/main.py", "import helper\n", folderCtx.paths, folderCtx.directories, "");
  const files = await folderCtx.extract(filter);
  assert.deepEqual(Array.from(files, f => f.path).sort(), ["proj/helper.py", "proj/main.py"]);
});

test("이미 있는 경로를 다시 등록하면 목록을 늘리지 않고 최신 내용으로 바꾼다", () => {
  const context = runFolderCtxHarness();
  const run = (code) => new vm.Script(code).runInContext(context);
  const makeFile = run("(text, name) => new File([text], name)");
  const pairs = [{ file:makeFile("옛 내용", "a.py"), relPath:"proj/a.py" }];
  const folderCtx = run("makeFileSiblingCtx")(pairs, "proj", ["proj"]);

  assert.equal(folderCtx.add("proj/a.py", makeFile("새 내용", "a.py")), true);
  assert.deepEqual(folderCtx.paths, ["proj/a.py"]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].file.text, "새 내용");
});

test("저장 전 파일을 버리면 실행 묶음에서도 해당 경로를 제거한다", async () => {
  const context = runFolderCtxHarness();
  const run = (code) => new vm.Script(code).runInContext(context);
  const makeFile = run("(text, name) => new File([text], name)");
  const pairs = [
    { file:makeFile("import helper\n", "main.py"), relPath:"proj/main.py" },
    { file:makeFile("def hi(): return 1\n", "helper.py"), relPath:"proj/helper.py" }
  ];
  const folderCtx = run("makeFileSiblingCtx")(pairs, "proj", ["proj"]);

  assert.equal(folderCtx.remove("proj/helper.py"), true);
  assert.deepEqual(folderCtx.paths, ["proj/main.py"]);
  assert.deepEqual(Array.from(await folderCtx.extract(), f => f.path), ["proj/main.py"]);
});

test("부분 동기화는 읽지 못한 이전 스냅샷을 새 실행 묶음으로 옮긴다", async () => {
  const context = runFolderCtxHarness();
  const run = (code) => new vm.Script(code).runInContext(context);
  const makeFile = run("(text, name) => new File([text], name)");
  const oldCtx = run("makeFileSiblingCtx")([
    { file:makeFile("print('main')\n", "main.py"), relPath:"proj/main.py" },
    { file:makeFile("잠긴 로그", "active.log"), relPath:"proj/logs/active.log" },
    { file:makeFile("바이너리", "model.bin"), relPath:"proj/data/model.bin" }
  ], "proj", ["proj", "proj/logs", "proj/data"]);
  const nextCtx = run("makeFileSiblingCtx")([
    { file:makeFile("print('new')\n", "main.py"), relPath:"proj/main.py" }
  ], "proj", ["proj"]);

  assert.equal(oldCtx.copyTo(nextCtx, path => path.startsWith("proj/logs/")), 1);
  assert.deepEqual(nextCtx.paths, ["proj/main.py", "proj/logs/active.log"]);
  assert.deepEqual(Array.from(await nextCtx.extract(), f => f.path),
    ["proj/main.py", "proj/logs/active.log"]);
});

test("하위 폴더에 만든 새 파일은 그 폴더도 실행 묶음의 디렉터리 목록에 들어간다", () => {
  const context = runFolderCtxHarness();
  const run = (code) => new vm.Script(code).runInContext(context);
  const makeFile = run("(text, name) => new File([text], name)");
  const folderCtx = run("makeFileSiblingCtx")([{ file:makeFile("", "main.py"), relPath:"proj/main.py" }], "proj", ["proj"]);

  folderCtx.add("proj/새 폴더/util.py", makeFile("", "util.py"));
  assert.ok(folderCtx.directories.includes("proj/새 폴더"));
});

test("폴더 동기화는 아직 저장하지 않은 새 문서를 삭제된 파일로 보지 않는다", () => {
  const loaderSource = read("file-loaders.js");
  assert.match(loaderSource, /if \(!file && doc\.isScratch && !doc\._named\)\{ keptDocs\.push\(doc\); continue; \}/);
  // 동기화가 만든 새 묶음에도 그 문서를 다시 등록해야 import 가 끊기지 않는다.
  assert.match(loaderSource,
    /\(doc\.isScratch && !doc\._named\) \|\| unreadable\(docKeyOf\(doc\)\)/);
});

test("실행 번들은 묶음에 없던 열린 문서도 실행 범위 안이면 채워 넣는다", () => {
  const runtimeSource = read("python-runtime.js");
  assert.match(runtimeSource, /for \(const \[rp, text\] of liveEdits\)\{[\s\S]*?if \(scopeFilter && !scopeFilter\(rp\)\) continue;[\s\S]*?files\.push\(\{ path: rp, bytes: enc\.encode\(text\) \}\);/);
});
