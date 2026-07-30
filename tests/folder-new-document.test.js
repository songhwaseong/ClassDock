"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8");
// python-viewer.js 분할본을 이어붙여 실행 — 번들과 동일한 전역 환경이 된다.
const pythonViewerSource = ["code-viewer.js", "python-snippets.js", "python-editor.js", "python-run-context.js", "python-runtime.js"]
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
