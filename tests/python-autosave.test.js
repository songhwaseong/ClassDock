"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const codeSource = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");
const stateSource = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8");

const targetStart = codeSource.indexOf("function pythonAutosaveTarget");
const targetEnd = codeSource.indexOf("async function writePythonAutosave", targetStart);
const pythonAutosaveTarget = new Function(
  codeSource.slice(targetStart, targetEnd) + "\nreturn pythonAutosaveTarget;"
)();
const writeStart = codeSource.indexOf("async function writePythonAutosave");
const writeEnd = codeSource.indexOf("function pythonDraftKey", writeStart);
const makeWritePythonAutosave = (saveViaServer, saveViaFileHandle) => new Function(
  "saveViaServer", "saveViaFileHandle",
  codeSource.slice(writeStart, writeEnd) + "\nreturn writePythonAutosave;"
)(saveViaServer, saveViaFileHandle);

test("자동 저장 설정은 기본적으로 꺼져 있고 설정 창에서 저장된다", () => {
  // 예전 이름(pythonAutosave)은 Python 전용이었다. 지금은 텍스트·마크다운도 같은 설정을 쓴다.
  assert.match(stateSource, /autoSave:\s*false/);
  assert.match(htmlSource, /id="settingAutoSave"/);
  assert.match(appSource, /settingAutoSave"\)\.checked = !!appSettings\.autoSave/);
  assert.match(appSource, /autoSave: byId\("settingAutoSave"\)\.checked/);
});

test("예전 설정(pythonAutosave)을 켜 둔 사용자는 새 이름으로 그대로 이어진다", () => {
  const start = stateSource.indexOf("function migrateAppSettings");
  const end = stateSource.indexOf("let appSettings", start);
  assert.ok(start >= 0 && end > start);
  const migrate = new Function(stateSource.slice(start, end) + "\nreturn migrateAppSettings;")();
  assert.equal(migrate({ pythonAutosave: true }).autoSave, true);
  assert.equal(migrate({ pythonAutosave: false }).autoSave, false);
  assert.equal(migrate({}).autoSave, undefined);                       // 저장한 적 없으면 기본값을 쓴다
  assert.equal(migrate({ autoSave: false, pythonAutosave: true }).autoSave, false);   // 새 값이 우선
  assert.ok(!("pythonAutosave" in migrate({ pythonAutosave: true })));
});

test("텍스트·마크다운 편집기도 같은 자동 저장 설정을 쓰고 대화상자를 띄우지 않는다", () => {
  assert.match(codeSource, /appSettings\.autoSave/);
  // existingOnly: 이미 있는 파일에만 조용히 되쓴다 — 타이핑 중 저장 위치 묻는 창이 뜨면 안 된다.
  assert.match(codeSource, /saveTextDoc\([^)]*\{ silent:true, existingOnly:true \}\)/);
  assert.doesNotMatch(codeSource, /appSettings\.pythonAutosave/);
});

test("텍스트 자동저장은 건너뜀을 성공으로 오인하지 않고 저장 중 새 입력을 더럽힘 상태로 유지한다", () => {
  const start = codeSource.indexOf("const runTextAutosave");
  const end = codeSource.indexOf("const scheduleTextAutosave", start);
  const block = codeSource.slice(start, end);
  assert.match(block, /if \(ok === true\)/);
  assert.match(block, /else if \(ok === "skipped"\)/);
  assert.match(block, /const latest = editor\.getValue\(\)/);
  assert.match(block, /const dirty = latest !== value/);
  assert.match(block, /markDocumentDirty\(ownerDoc, dirty\)/);
  assert.match(block, /retryChangedValue = dirty/);
  assert.match(codeSource, /if \(existingOnly\) return false;\s*\/\/ 저장 대상은 확정됐지만 EXE 쓰기가 실패함/);
  assert.match(codeSource, /return hadHandle \? false : "skipped"/);
});

test("텍스트 자동저장 실패는 편집 내용을 유지하고 한 번만 수동 재시도를 안내한다", () => {
  const start = codeSource.indexOf("const runTextAutosave");
  const end = codeSource.indexOf("const scheduleTextAutosave", start);
  const block = codeSource.slice(start, end);
  assert.match(block, /setTextAutosaveState\("failed"\)/);
  assert.match(block, /_textAutosaveFailureNotified/);
  assert.match(block, /자동 저장에 실패했어요\. 편집 내용은 남아 있어요\./);
  assert.match(block, /label:"지금 저장"/);
});

test("조용한 텍스트 자동저장은 파일·폴더 쓰기 권한 요청창을 띄우지 않는다", () => {
  assert.match(codeSource, /noPermissionPrompt: silent && existingOnly/);
  const start = codeSource.indexOf("async function saveViaFileHandle");
  const end = codeSource.indexOf("// exe 런처", start);
  const block = codeSource.slice(start, end);
  assert.match(block, /options\.noPermissionPrompt\) return "denied"/);
  assert.match(block, /restoreFolderOriginalFileHandle\([\s\S]*!!options\.noPermissionPrompt/);
});

test("Python 자동저장은 이름과 조용히 쓸 수 있는 저장 대상이 확정된 파일만 사용한다", () => {
  const base = { hasUnsavedEdits:true, name:"수업.py", workspacePath:"수업/수업.py" };
  assert.equal(pythonAutosaveTarget(base, true), "server");
  assert.equal(pythonAutosaveTarget(base, false), "");
  assert.equal(pythonAutosaveTarget({ ...base, isScratch:true }, true), "");
  assert.equal(pythonAutosaveTarget({ ...base, isScratch:true, _named:true }, true), "server");
  assert.equal(pythonAutosaveTarget({ ...base, fsHandle:{ createWritable(){} } }, false), "file-handle");
  // Ctrl+S와 같은 공통 저장 경로가 원본 폴더에서 파일 핸들을 복원할 수 있다.
  assert.equal(pythonAutosaveTarget({ ...base, originalSaveMode:true }, true), "file-handle");
  assert.equal(pythonAutosaveTarget({ ...base, originalSaveMode:true, fsHandle:{ createWritable(){} } }, false), "file-handle");
  assert.equal(pythonAutosaveTarget(base, true, true), "");
  assert.equal(pythonAutosaveTarget({ ...base, hasUnsavedEdits:false }, true), "");
});

test("Python 자동저장은 3초 지연하고 저장 중 새 입력을 다시 예약한다", () => {
  assert.match(codeSource, /const PYTHON_AUTOSAVE_DELAY = 3000/);
  assert.match(codeSource, /pyAutosaveTimer = setTimeout\([\s\S]*PYTHON_AUTOSAVE_DELAY/);
  assert.match(codeSource, /if \(pyAutosaveSaving \|\| pyManualSaveActive\)\{ pyAutosaveAgain = true; return; \}/);
  assert.match(codeSource, /markDocumentDirty\(ownerDoc, editor\.getValue\(\) !== savedValue\)/);
  assert.match(codeSource, /if \(pyAutosaveAgain\) schedulePythonAutosave\(\)/);
});

test("파일 핸들 자동저장은 권한 요청창을 띄우지 않고 로컬 초안을 실패 시 유지한다", () => {
  const writeBlock = codeSource.slice(writeStart, writeEnd);
  assert.match(writeBlock, /saveViaFileHandle/);
  assert.match(writeBlock, /existingOnly:true/);
  assert.match(writeBlock, /noPermissionPrompt:true/);
  // 실패 알림은 "무슨 일이 있었는지"에 더해 "다음에 뭘 할 수 있는지"까지 준다.
  assert.match(codeSource, /자동 저장에 실패했어요\. 편집 내용은 남아 있어요\./);
  assert.match(codeSource, /label:"지금 저장"/);
  const runBlock = codeSource.slice(codeSource.indexOf("async function runPythonAutosave"), codeSource.indexOf("const refreshEditState"));
  const failureBlock = runBlock.slice(runBlock.indexOf("})().catch"));
  assert.match(runBlock, /if \(!result\.ok\) throw[\s\S]*clearPythonDraft\(draftKey\)/);
  assert.doesNotMatch(failureBlock, /clearPythonDraft\(draftKey\)/);
});

test("파일 핸들 자동저장은 원본 저장·Ctrl+S와 같은 공통 저장 함수를 사용한다", async () => {
  const calls = [];
  const ownerDoc = { hasUnsavedEdits:true, workspacePath:"수업/a.py" };
  const writePythonAutosave = makeWritePythonAutosave(
    async () => null,
    async (value, name, doc, options) => {
      calls.push({ value, name, doc, options });
      return "saved";
    }
  );
  assert.deepEqual(
    await writePythonAutosave("print(2)", ownerDoc, "a.py", "file-handle"),
    { ok:true, path:"수업/a.py" }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].doc, ownerDoc);
  assert.deepEqual(calls[0].options, {
    existingOnly:true,
    noPermissionPrompt:true,
    mime:"text/x-python;charset=utf-8"
  });

  const denied = makeWritePythonAutosave(async () => null, async () => "denied");
  assert.deepEqual(await denied("print(1)", ownerDoc, "a.py", "file-handle"), { ok:false, path:"" });
});
