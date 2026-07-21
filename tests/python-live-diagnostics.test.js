"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "../src/js", name), "utf8");
const viewer = read("code-viewer.js");
const editor = read("python-editor.js");
const runtime = read("python-runtime.js");
const runContext = read("python-run-context.js");
const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

test("Python 실시간 진단은 입력을 모아 최신 코드 결과만 줄 표시에 반영한다", () => {
  assert.match(viewer, /const scheduleLiveDiagnostics = \(delay=700\)/);
  assert.match(viewer, /version === liveDiagVersion && source === editor\.getValue\(\)/);
  assert.match(viewer, /editor\.setDiagnosticItems\(analysis\.diagnostics\)/);
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

test("불완전한 Python 문법에서는 기존 미사용 표시를 빈 결과로 덮어쓰지 않는다", () => {
  const liveStart = viewer.indexOf("const runLiveDiagnostics");
  const liveEnd = viewer.indexOf("const scheduleLiveDiagnostics", liveStart);
  const liveRunner = viewer.slice(liveStart, liveEnd);
  assert.match(runContext, /'unusedReady': __md_tree is not None/);
  assert.match(runtime, /unusedReady:parsed\.report\.unusedReady === true/);
  assert.match(liveRunner, /if \(analysis\.unusedReady\) editor\.setUnusedRanges\(analysis\.unused\)/);
  assert.doesNotMatch(liveRunner, /editor\.clearError\(\); editor\.clearUnusedRanges\(\)/);
});

test("Python 미사용 선언은 범위 분석 결과로 흐려지고 입력 중 안전한 범위를 유지한다", () => {
  assert.match(runContext, /class _md_Unused/);
  assert.match(runContext, /def _md_resolve\(scope, name\)/);
  assert.match(runContext, /'unused': \(__md_unused\[:500\]/);
  assert.match(runtime, /unused:normalizePythonUnusedRanges\(parsed\.report\.unused\)/);
  assert.match(viewer, /editor\.setUnusedRanges\(analysis\.unused\)/);
  assert.match(editor, /remapTextRangesAfterEdit\(unusedSemanticRanges, semanticRangeText, ta\.value\)/);
  assert.match(editor, /highlightCode\(val, prof, unusedSemanticRanges\)/);
  assert.match(styles, /\.code-host \.tk-unused/);
});
