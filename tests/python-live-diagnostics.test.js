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
  assert.match(viewer, /editor\.setDiagnosticItems\(withImportProblems\(analysis\.diagnostics, source\)\)/);
  assert.match(editor, /const setDiagnosticItems = \(items\) =>/);
  assert.match(editor, /err-line-warning/);
  assert.match(editor, /current\.diagnostics\.push\(diagnostic\)/);
  assert.match(editor, /ta\.addEventListener\("mousemove", handleDiagnosticPointerMove\)/);
  assert.match(editor, /code-diagnostic-tooltip-hint/);
});

test("Python 수동 진단도 심각도와 설명을 보존해 줄 색상과 호버에 반영한다", () => {
  assert.match(viewer, /ui\.setDiagnosticItems = \(items\) => editor\.setDiagnosticItems\(items\)/);
  const finishStart = runContext.indexOf("function finishPythonDiagnostics");
  const finishEnd = runContext.indexOf("function renderPythonDiagnostics", finishStart);
  const finish = runContext.slice(finishStart, finishEnd);
  assert.match(finish, /if \(ui && ui\.setDiagnosticItems\) ui\.setDiagnosticItems\(diagnostics\)/);
  assert.match(finish, /else \{[\s\S]*ui\.markErrorLines\(lines\)/);
});

test("while True 진단은 현재 반복문을 빠져나가는 break가 있을 때 생략한다", () => {
  assert.match(runContext, /class __md_LoopBreak\(__md_ast\.NodeVisitor\)/);
  assert.match(runContext, /def visit_Break\(self, node\): self\.found = True/);
  assert.match(runContext, /def visit_While\(self, node\): pass/);
  assert.match(runContext, /not __md_has_loop_break\(__md_node\)/);
});

test("자동 진단은 PY-LOOP 참고만 파란 줄 표시로 유지한다", () => {
  assert.match(runtime, /item\.severity !== "info" \|\| item\.code === "PY-LOOP"/);
});

test("Python 실시간 진단은 코드를 실행하지 않고 수동 실행 중에는 일시정지한다", () => {
  assert.match(runtime, /buildPythonDiagnosticHarness\(String\(src == null \? "" : src\)/);
  assert.match(runtime, /filter\(item => item\.severity !== "info" \|\| item\.code === "PY-LOOP"\)/);
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
  assert.match(liveRunner, /if \(analysis\.unusedReady\)\{ editor\.setUnusedRanges\(analysis\.unused\); editor\.setParamRanges\(analysis\.params\); \}/);
  assert.doesNotMatch(liveRunner, /editor\.clearError\(\); editor\.clearUnusedRanges\(\)/);
});

test("Python 미사용 선언은 범위 분석 결과로 흐려지고 입력 중 안전한 범위를 유지한다", () => {
  assert.match(runContext, /class _md_Unused/);
  assert.match(runContext, /def _md_resolve\(scope, name\)/);
  assert.match(runContext, /'unused': \(__md_unused\[:500\]/);
  assert.match(runtime, /unused:normalizePythonUnusedRanges\(parsed\.report\.unused\)/);
  assert.match(viewer, /editor\.setUnusedRanges\(analysis\.unused\)/);
  assert.match(editor, /remapTextRangesAfterEdit\(unusedSemanticRanges, semanticRangeText, ta\.value\)/);
  assert.match(editor, /highlightCode\(val, prof, semanticRanges\)/);
  assert.match(styles, /\.code-host \.tk-unused/);
});

test("Python 함수 매개변수·키워드 인자 이름은 AST 범위로 tk-param 색을 입는다", () => {
  assert.match(runContext, /isinstance\(__md_node, __md_ast\.keyword\) and __md_node\.arg is not None/);
  assert.match(runContext, /isinstance\(__md_node, __md_ast\.arg\)/);
  assert.match(runContext, /'params': \(__md_params\[:600\]/);
  assert.match(runtime, /params:normalizePythonUnusedRanges\(parsed\.report\.params, 600\)/);
  assert.match(viewer, /editor\.setParamRanges\(analysis\.params\)/);
  assert.match(editor, /const setParamRanges = \(items\) =>/);
  assert.match(editor, /cls:"tk-param"/);
  assert.match(editor, /remapTextRangesAfterEdit\(paramSemanticRanges, semanticRangeText, ta\.value\)/);
  assert.match(styles, /\.code-host \.tk-param,\.nbv-static \.tk-param\{color:var\(--code-param\)\}/);
  assert.match(styles, /--code-param:/);
});
