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
const spreadsheetSource = read("spreadsheet-viewer.js");
const launcherSource = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");

const context = vm.createContext({
  console,
  window:{},
  docs:[],
  localStorage:{ getItem:() => null, setItem:() => {} },
  TextEncoder,
  TextDecoder,
  btoa:(value) => Buffer.from(value, "binary").toString("base64"),
  atob:(value) => Buffer.from(value, "base64").toString("binary"),
  askText:async () => context.__typed,
  confirmDialog:async () => context.__overwrite
});
new vm.Script(pythonViewerSource, { filename:"python-viewer.js" }).runInContext(context);
const askScratchSaveName = new vm.Script("askScratchSaveName").runInContext(context);

// typed: 사용자가 대화상자에 입력한 값(null 이면 취소)
async function rename(doc, typed, options={}){
  context.__typed = typed;
  const named = await askScratchSaveName(doc, doc.name, options);
  return named;
}

test("첫 저장에서 정한 이름은 원래 확장자를 유지한다", async () => {
  const doc = { name:"새 표.xlsx", isScratch:true, workspacePath:"새 표.xlsx" };
  assert.equal(await rename(doc, "성적표"), "성적표.xlsx");
  assert.equal(doc.name, "성적표.xlsx");
  assert.equal(doc.workspacePath, "성적표.xlsx");
  assert.equal(doc._named, true);
});

test("폴더 안에서 만든 문서는 폴더 경로를 유지한 채 파일명만 바뀐다", async () => {
  const doc = { name:"새 노트북.ipynb", isScratch:true, archiveCtx:{},
    workspacePath:"수업/자료/새 노트북.ipynb", relPath:"수업/자료/새 노트북.ipynb" };
  assert.equal(await rename(doc, "1주차 실습"), "1주차 실습.ipynb");
  assert.equal(doc.workspacePath, "수업/자료/1주차 실습.ipynb");
  assert.equal(doc.relPath, "수업/자료/1주차 실습.ipynb");
});

test("사용자가 확장자를 직접 적으면 그 확장자를 그대로 쓴다", async () => {
  const doc = { name:"새 메모.txt", isScratch:true, workspacePath:"새 메모.txt" };
  assert.equal(await rename(doc, "정리.md"), "정리.md");
});

test("파일 이름에 쓸 수 없는 문자는 지운다", async () => {
  const doc = { name:"새 코드.py", isScratch:true, workspacePath:"새 코드.py" };
  assert.equal(await rename(doc, 'a/b:c*d?e"f<g>h|i'), "abcdefghi.py");
});

test("이름을 비우면 원래 이름을 유지한다", async () => {
  const doc = { name:"블록 문서.mnote", isScratch:true, workspacePath:"블록 문서.mnote" };
  assert.equal(await rename(doc, "   "), "블록 문서.mnote");
});

test("취소하면 null 을 돌려주고 문서를 건드리지 않는다", async () => {
  const doc = { name:"새 표.xlsx", isScratch:true, workspacePath:"수업/새 표.xlsx" };
  assert.equal(await rename(doc, null), null);
  assert.equal(doc.name, "새 표.xlsx");
  assert.equal(doc.workspacePath, "수업/새 표.xlsx");
  assert.equal(doc._named, undefined);
});

test("같은 경로의 파일이 있으면 확인 없이 덮어쓰지 않는다", async () => {
  const doc = { name:"새 메모.txt", isScratch:true, workspacePath:"수업/새 메모.txt" };
  context.docs = [{ name:"기존.txt", workspacePath:"수업/기존.txt" }];
  context.__overwrite = false;
  assert.equal(await rename(doc, "기존"), null);
  assert.equal(doc.name, "새 메모.txt");
  assert.equal(doc.workspacePath, "수업/새 메모.txt");
  assert.equal(doc._named, undefined);

  context.__overwrite = true;
  assert.equal(await rename(doc, "기존"), "기존.txt");
  assert.equal(doc.workspacePath, "수업/기존.txt");
  context.docs = [];
});

test("확장자가 없던 문서는 종류별 기본 확장자를 붙인다", async () => {
  const doc = { name:"메모 없음", isScratch:true, workspacePath:"메모 없음" };
  assert.equal(await rename(doc, "정리", { fallbackExt:".txt" }), "정리.txt");
});

test("텍스트·노트북·블록 문서도 원본 폴더 저장 전에 이름을 먼저 받는다", () => {
  // 원본 폴더 분기(wantOriginal)보다 앞에서 이름을 확정해야 임시 이름이 디스크에 박히지 않는다.
  const namingIndex = pythonViewerSource.indexOf("askScratchSaveName(ownerDoc, name, { fallbackExt:\".txt\"");
  const originalBranchIndex = pythonViewerSource.indexOf("if (wantOriginal || fromFolderOriginal){");
  assert.ok(namingIndex > 0 && originalBranchIndex > 0);
  assert.ok(namingIndex < originalBranchIndex, "이름 확정이 원본 폴더 저장 분기보다 먼저여야 한다");
  assert.match(pythonViewerSource, /\(wantOriginal \|\| fromFolderOriginal \|\| await saveFileBackendAvailable\(\)\)/);
});

test("자동 저장·일괄 저장은 이름을 묻지 않고 건너뛴다", () => {
  assert.match(pythonViewerSource, /if \(existingOnly\) return "skipped"/);
  // 자동 저장이 이름 없는 새 문서를 건드리지 않는 규칙은 .py·노트북과 동일하다.
  assert.match(pythonViewerSource, /if \(ownerDoc\.isScratch && !ownerDoc\._named\) return ""/);
});

test("표는 저장 방식과 관계없이 첫 저장 이름을 먼저 받는다", () => {
  assert.doesNotMatch(spreadsheetSource, /const savesWithoutDialog/);
  // Ctrl+S 빠른 저장, XLSX 저장, '제자리 저장' 모두 같은 확인을 거친다.
  const calls = spreadsheetSource.match(/await askSpreadsheetScratchName\(\)/g) || [];
  assert.equal(calls.length, 3);
  // 이름을 바꾸면 내보내기 파일 이름도 따라가야 한다.
  assert.match(spreadsheetSource, /base = sheetBaseName\(named\)/);
});

test("EXE 저장 폴더의 충돌 확인 경로는 인증과 안전한 경로 해석을 거친다", () => {
  assert.match(launcherSource, /path == "\/save-file" \|\| path == "\/save-file-exists"/);
  assert.match(launcherSource, /method == "POST" && path == "\/save-file-exists"[\s\S]*?SafeRelPath\(rel\)[\s\S]*?TryResolveSaveRootPath\(safe, out full\)[\s\S]*?File\.Exists\(full\)/);
});
