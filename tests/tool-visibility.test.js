"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stateSource = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
const codeViewerSource = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");
const notebookSource = fs.readFileSync(path.join(__dirname, "../src/js/notebook-run.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "../manneung-classroom.html"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

// state.js 에서 레지스트리와 정규화 함수만 떼어내 실행한다(문서·localStorage 없이 검증).
const regStart = stateSource.indexOf("const TOGGLEABLE_TOOLS");
const regEnd = stateSource.indexOf("function applyToolVisibility");
const { TOGGLEABLE_TOOLS, normalizeToolVisibility } = new Function(
  stateSource.slice(regStart, regEnd) + "\nreturn { TOGGLEABLE_TOOLS, normalizeToolVisibility };"
)();

test("도구 레지스트리는 Python·노트북 도구를 담고 필수 버튼(실행·저장)은 제외한다", () => {
  const ids = TOGGLEABLE_TOOLS.map(t => t.id);
  assert.ok(ids.includes("pyTrace") && ids.includes("nbToc") && ids.includes("pyDedupe") && ids.includes("pySpellcheck") && ids.includes("nbDedupe"));
  assert.equal(new Set(ids).size, ids.length, "id 는 중복이 없어야 한다");
  for (const tool of TOGGLEABLE_TOOLS){
    assert.ok(tool.cls && typeof tool.cls === "string", tool.id + " 는 클래스명이 있어야 한다");
    assert.ok(tool.target === "py" || tool.target === "notebook");
  }
  // 필수 버튼은 노출 설정 대상이 아니어야 한다.
  assert.ok(!TOGGLEABLE_TOOLS.some(t => t.cls === "run-go" || t.cls === "run-save"));
});

test("정규화: 미지정·잘못된 값은 노출(true), false 만 숨김", () => {
  const all = normalizeToolVisibility(undefined);
  for (const tool of TOGGLEABLE_TOOLS) assert.equal(all[tool.id], true);

  const some = normalizeToolVisibility({ pyTrace: false, nbToc: false, unknownId: false });
  assert.equal(some.pyTrace, false);
  assert.equal(some.nbToc, false);
  assert.equal(some.pyGrade, true);          // 지정 안 됨 → 노출
  assert.ok(!("unknownId" in some));         // 레지스트리에 없는 id 는 버린다
});

test("각 도구 id 마다 CSS 숨김 규칙과 설정 UI 배선이 있다", () => {
  // CSS: html.hide-tool-<id> .<cls>
  for (const tool of TOGGLEABLE_TOOLS){
    assert.match(cssSource, new RegExp("hide-tool-" + tool.id + "\\s+\\." + tool.cls.replace(/[-]/g, "\\-")),
      tool.id + " 의 CSS 숨김 규칙이 있어야 한다");
  }
  // 설정 UI 컨테이너와 배선(열기·저장·부팅 적용)
  assert.match(htmlSource, /data-settings-tab="tools"/);
  assert.match(htmlSource, /id="settingToolsPy"/);
  assert.match(htmlSource, /id="settingToolsNb"/);
  assert.match(appSource, /syncToolVisibilityChecks\(\)/);
  assert.match(appSource, /toolVisibility: collectToolVisibility\(\)/);
  assert.match(appSource, /applyToolVisibility\(\)/);
  assert.match(stateSource, /id:"pyRevert"[\s\S]*?cls:"run-py-revert"/);
  assert.match(stateSource, /id:"pyDedupe"[\s\S]*?cls:"run-dedupe"/);
  assert.match(stateSource, /id:"pySpellcheck"[\s\S]*?cls:"run-spellcheck"/);
  assert.match(stateSource, /id:"nbDedupe"[\s\S]*?cls:"nbv-dedupe"/);
  assert.match(codeViewerSource, /run-revert run-py-revert/);
  assert.match(codeViewerSource, /className = "run-dedupe"/);
  assert.match(codeViewerSource, /buttonClass:runnable \? "run-spellcheck" : ""/);
  assert.match(notebookSource, /className = "nbv-dedupe"/);
  assert.match(codeViewerSource, /viewBtn\.className = "run-revert"/);
  assert.match(cssSource, /hide-tool-pyRevert\s+\.run-py-revert/);
  assert.doesNotMatch(cssSource, /hide-tool-pyRevert\s+\.run-revert[\s,\{]/);
  assert.match(cssSource, /hide-tool-nbExport\s+\.nbv-export-group/);
  assert.match(cssSource, /hide-tool-nbExport\s+\.nbv-save-group\s*>\s*\.nbv-run-more/);
  assert.match(cssSource, /hide-tool-nbExport\s+\.nbv-save-group\s*>\s*\.nbv-run-menu/);
  assert.doesNotMatch(cssSource, /hide-tool-nbExport\s+\.nbv-save-group\s*[\,\{]/);
  assert.match(stateSource, /applyToolVisibility\(\);/);   // 부팅 시 1회 적용
});
