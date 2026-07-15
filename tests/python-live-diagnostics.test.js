"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "../src/js", name), "utf8");
const viewer = read("code-viewer.js");
const editor = read("python-editor.js");
const runtime = read("python-runtime.js");

test("Python 실시간 진단은 입력을 모아 최신 코드 결과만 줄 표시에 반영한다", () => {
  assert.match(viewer, /const scheduleLiveDiagnostics = \(delay=700\)/);
  assert.match(viewer, /version === liveDiagVersion && source === editor\.getValue\(\)/);
  assert.match(viewer, /editor\.setDiagnosticItems\(items\)/);
  assert.match(editor, /const setDiagnosticItems = \(items\) =>/);
  assert.match(editor, /err-line-warning/);
  assert.match(editor, /current\.diagnostics\.push\(diagnostic\)/);
  assert.match(editor, /ta\.addEventListener\("mousemove", handleDiagnosticPointerMove\)/);
  assert.match(editor, /code-diagnostic-tooltip-hint/);
});

test("Python 실시간 진단은 코드를 실행하지 않고 수동 실행 중에는 일시정지한다", () => {
  assert.match(runtime, /buildPythonDiagnosticHarness\(String\(src == null \? "" : src\)/);
  assert.match(runtime, /filter\(item => item\.severity !== "info"\)/);
  assert.match(runtime, /ui\.pauseLiveDiagnostics\(\)/);
  assert.match(runtime, /ui\.resumeLiveDiagnostics\(\)/);
  assert.match(viewer, /ui\.destroyLiveDiagnostics/);
});
