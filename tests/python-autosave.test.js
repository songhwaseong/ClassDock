"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const codeSource = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");
const stateSource = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "../manneung-classroom.html"), "utf8");

const targetStart = codeSource.indexOf("function pythonAutosaveTarget");
const targetEnd = codeSource.indexOf("async function writePythonAutosave", targetStart);
const pythonAutosaveTarget = new Function(
  codeSource.slice(targetStart, targetEnd) + "\nreturn pythonAutosaveTarget;"
)();
const writeStart = codeSource.indexOf("async function writePythonAutosave");
const writeEnd = codeSource.indexOf("function pythonDraftKey", writeStart);
const makeWritePythonAutosave = (saveViaServer) => new Function(
  "saveViaServer", "Blob", codeSource.slice(writeStart, writeEnd) + "\nreturn writePythonAutosave;"
)(saveViaServer, Blob);

test("Python 자동저장 설정은 기본적으로 꺼져 있고 설정 창에서 저장된다", () => {
  assert.match(stateSource, /pythonAutosave:\s*false/);
  assert.match(htmlSource, /id="settingPythonAutosave"/);
  assert.match(appSource, /settingPythonAutosave"\)\.checked = !!appSettings\.pythonAutosave/);
  assert.match(appSource, /pythonAutosave: byId\("settingPythonAutosave"\)\.checked/);
});

test("Python 자동저장은 이름과 조용히 쓸 수 있는 저장 대상이 확정된 파일만 사용한다", () => {
  const base = { hasUnsavedEdits:true, name:"수업.py", workspacePath:"수업/수업.py" };
  assert.equal(pythonAutosaveTarget(base, true), "server");
  assert.equal(pythonAutosaveTarget(base, false), "");
  assert.equal(pythonAutosaveTarget({ ...base, isScratch:true }, true), "");
  assert.equal(pythonAutosaveTarget({ ...base, isScratch:true, _named:true }, true), "server");
  assert.equal(pythonAutosaveTarget({ ...base, fsHandle:{ createWritable(){} } }, false), "file-handle");
  assert.equal(pythonAutosaveTarget({ ...base, originalSaveMode:true }, true), "");
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
  assert.match(writeBlock, /queryPermission/);
  assert.doesNotMatch(writeBlock, /requestPermission/);
  assert.match(codeSource, /Python 자동 저장에 실패했어요\. 로컬 초안은 유지됩니다\./);
  const runBlock = codeSource.slice(codeSource.indexOf("async function runPythonAutosave"), codeSource.indexOf("const refreshEditState"));
  const failureBlock = runBlock.slice(runBlock.indexOf("})().catch"));
  assert.match(runBlock, /if \(!result\.ok\) throw[\s\S]*clearPythonDraft\(draftKey\)/);
  assert.doesNotMatch(failureBlock, /clearPythonDraft\(draftKey\)/);
});

test("파일 핸들 자동저장은 이미 허용된 핸들만 실제로 쓴다", async () => {
  let opened = 0;
  const denied = {
    hasUnsavedEdits:true,
    fsHandle:{
      createWritable(){ opened++; },
      queryPermission:async () => "prompt",
      requestPermission:async () => { throw new Error("자동저장이 권한을 요청하면 안 됨"); }
    }
  };
  const writePythonAutosave = makeWritePythonAutosave(async () => null);
  assert.deepEqual(await writePythonAutosave("print(1)", denied, "a.py", "file-handle"), { ok:false, path:"" });
  assert.equal(opened, 0);

  let written = "";
  const allowed = {
    hasUnsavedEdits:true,
    workspacePath:"수업/a.py",
    fsHandle:{
      queryPermission:async () => "granted",
      createWritable:async () => ({
        write:async blob => { written = await blob.text(); },
        close:async () => {}
      })
    }
  };
  assert.deepEqual(await writePythonAutosave("print(2)", allowed, "a.py", "file-handle"), { ok:true, path:"수업/a.py" });
  assert.equal(written, "print(2)");
});
