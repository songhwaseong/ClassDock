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
const textModalSource = read("office-doc-viewers.js");
const documentsSource = read("documents.js");
const stylesSource = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
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

test("첫 저장에서 정한 이름은 원래 확장자를 유지하되 저장 성공 전에는 확정하지 않는다", async () => {
  const doc = { name:"새 표.xlsx", isScratch:true, workspacePath:"새 표.xlsx" };
  assert.equal(await rename(doc, "성적표"), "성적표.xlsx");
  assert.equal(doc.name, "성적표.xlsx");
  assert.equal(doc.workspacePath, "성적표.xlsx");
  assert.equal(doc._named, undefined);
});

test("폴더 안에서 만든 문서는 폴더 경로를 유지한 채 파일명만 바뀐다", async () => {
  const renamed = [];
  const archiveCtx = { rename:(oldPath, newPath) => { renamed.push([oldPath, newPath]); return true; } };
  const doc = { name:"새 노트북.ipynb", isScratch:true, archiveCtx,
    workspacePath:"수업/자료/새 노트북.ipynb", relPath:"수업/자료/새 노트북.ipynb" };
  assert.equal(await rename(doc, "1주차 실습"), "1주차 실습.ipynb");
  assert.equal(doc.workspacePath, "수업/자료/1주차 실습.ipynb");
  assert.equal(doc.relPath, "수업/자료/1주차 실습.ipynb");
  assert.deepEqual(renamed, [["수업/자료/새 노트북.ipynb", "수업/자료/1주차 실습.ipynb"]]);
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
  // 저장 입구(Ctrl+S · [XLSX 저장] 버튼)는 quickSave 하나로 모였고, 이름 확인은 그 안에서 한 번 한다.
  const calls = spreadsheetSource.match(/await askSpreadsheetScratchName\(\)/g) || [];
  assert.equal(calls.length, 1);
  assert.match(spreadsheetSource, /const quickSave = async[\s\S]*?await askSpreadsheetScratchName\(\)/);
  // 이름을 바꾸면 내보내기 파일 이름도 따라가야 한다.
  assert.match(spreadsheetSource, /base = sheetBaseName\(named\)/);
});

test("EXE 저장 폴더의 충돌 확인 경로는 인증과 안전한 경로 해석을 거친다", () => {
  assert.match(launcherSource, /path == "\/save-file" \|\| path == "\/save-file-exists"/);
  assert.match(launcherSource, /method == "POST" && path == "\/save-file-exists"[\s\S]*?SafeRelPath\(rel\)[\s\S]*?TryResolveSaveRootPath\(safe, out full\)[\s\S]*?File\.Exists\(full\)/);
});

/* ---------- 표 저장: 원본이 먼저, 사본이면 그렇게 말한다 ---------- */

// 예전엔 '제자리 저장' 버튼만 핸들 갈래를 건너뛰어, 폴더로 열어 원본에 쓸 수 있는 문서까지
// 사본이 생겼다. 게다가 이름이 "제자리" 라 사본이 생긴 걸 알 방법이 없었다.
test("표의 파일 저장은 원본 핸들을 먼저 시도한다", () => {
  // 핸들 저장은 quickSave 한 곳에서만 부른다 — 저장 갈래가 둘이면 하나가 반드시 뒤처진다.
  const direct = spreadsheetSource.match(/await saveBytesToDocumentHandle\(out\)/g) || [];
  assert.equal(direct.length, 1);
  // 순서: 원본 핸들 → 자동 저장 폴더 사본 → (마지막) 다운로드.
  assert.match(spreadsheetSource,
    /const quickSave = async[\s\S]*?await saveBytesToDocumentHandle\(out\)[\s\S]*?await saveBytesAsCopy\(out\)[\s\S]*?downloadSpreadsheetFile\(out/);
});

/* [XLSX 저장] 버튼이 바로 다운로드로 새면, 폴더로 연 원본은 그대로인데 탭의 수정 표시만 지워져
   "저장했는데 다음에 열면 편집이 없다" 가 된다(CSV→XLSX 변환본에서 특히 잘 드러났다). */
test("표 도구막대의 [XLSX 저장]은 Ctrl+S 와 같은 경로를 쓴다", () => {
  assert.match(spreadsheetSource,
    /xlsxBtn\.onclick = async \(\) => \{[\s\S]*?await quickSave\(\);[\s\S]*?\};/);
  // 다운로드만 하는 갈래는 '복사본 내려받기' 로 따로 두고, 원본을 바꾼 척(markSpreadsheetSaved)하지 않는다.
  const copyButton = spreadsheetSource.match(/xlsxCopyBtn\.onclick = async[\s\S]*?finally \{ xlsxCopyBtn\.disabled = false; \}/);
  assert.ok(copyButton, "복사본 내려받기 버튼이 있어야 한다");
  assert.doesNotMatch(copyButton[0], /markSpreadsheetSaved/);
  // 저장 버튼이 둘로 갈라져 어느 쪽이 진짜 저장인지 헷갈리던 예전 버튼은 없앴다.
  assert.doesNotMatch(spreadsheetSource, /textContent = "파일에 저장"/);
});

test("자동 저장 폴더에 쓰는 함수는 '제자리'라고 부르지 않는다", () => {
  // 서버가 X-Save-Path 를 SaveRoot 기준으로 풀어 결과가 사본이다 — 이름이 사실과 맞아야 한다.
  assert.doesNotMatch(spreadsheetSource, /saveBytesInPlace\s*\(/);
  assert.match(spreadsheetSource, /const saveBytesToSaveRoot = async/);
});

test("사본으로 저장하면 원본을 고치는 방법까지 알린다", () => {
  assert.match(spreadsheetSource, /사본으로 저장했어요[\s\S]{0,120}폴더 열기/);
});

test("자바 파일 이름 입력 중에는 규칙을 안내하고 저장 버튼을 비활성화한다", () => {
  const askStart = textModalSource.indexOf("function askText(opts)");
  const askEnd = textModalSource.indexOf("function confirmDialog", askStart);
  const askSource = textModalSource.slice(askStart, askEnd);
  assert.match(askSource, /typeof opts\.validate === "function"/);
  assert.match(askSource, /okButton\.disabled = !!error/);
  assert.match(askSource, /input\.addEventListener\("input", refreshValidation\)/);
  assert.match(askSource, /if \(!refreshValidation\(\)\) return/);
  assert.match(pythonViewerSource, /askScratchSaveName[\s\S]*?javaFileNameValidationMessage[\s\S]*?okText: "저장", validate/);
  assert.match(documentsSource, /title: "이름 바꾸기"[\s\S]*?validate: oldExt === "java"/);
  assert.match(stylesSource, /\.modal-card \.sub\.is-error\{color:var\(--danger\)\}/);
});
