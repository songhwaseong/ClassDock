"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stateSource = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
const codeViewerSource = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");
const jsEditorSource = fs.readFileSync(path.join(__dirname, "../src/js/js-editor.js"), "utf8");
const javaEditorSource = fs.readFileSync(path.join(__dirname, "../src/js/java-editor.js"), "utf8");
const notebookSource = fs.readFileSync(path.join(__dirname, "../src/js/notebook-run.js"), "utf8");
const imageSource = fs.readFileSync(path.join(__dirname, "../src/js/image-viewer.js"), "utf8");
const whiteboardSource = fs.readFileSync(path.join(__dirname, "../src/js/whiteboard.js"), "utf8");
const mapSource = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
const musicSource = fs.readFileSync(path.join(__dirname, "../src/js/music-editor.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

// state.js 에서 레지스트리와 정규화 함수만 떼어내 실행한다(문서·localStorage 없이 검증).
const regStart = stateSource.indexOf("const TOGGLEABLE_TOOLS");
const regEnd = stateSource.indexOf("function applyToolVisibility");
const { TOGGLEABLE_TOOLS, normalizeToolVisibility } = new Function(
  stateSource.slice(regStart, regEnd) + "\nreturn { TOGGLEABLE_TOOLS, normalizeToolVisibility };"
)();

test("도구 레지스트리는 전체 화면의 선택 도구를 담고 필수 버튼(실행·저장)은 제외한다", () => {
  const ids = TOGGLEABLE_TOOLS.map(t => t.id);
  assert.ok(ids.includes("pyTrace") && ids.includes("nbToc") && ids.includes("pyDedupe") && ids.includes("pySpellcheck") && ids.includes("nbDedupe"));
  assert.ok(ids.includes("imgCrop") && ids.includes("imgOcr") && ids.includes("imgAnnotate") && ids.includes("imgAdjust"));
  assert.ok(ids.includes("hdrSidebar") && ids.includes("hdrPrint") && ids.includes("hdrPalette") && ids.includes("hdrTheme") && ids.includes("hdrLang"));
  assert.ok(ids.includes("jsGrade") && ids.includes("jsPkg"));
  assert.ok(ids.includes("javaGrade") && ids.includes("javaPkg") && ids.includes("javaEnv") && ids.includes("javaConfig")
    && ids.includes("javaJunit") && ids.includes("javaFormat") && ids.includes("javaImports")
    && ids.includes("javaPractice") && ids.includes("javaFont"));
  assert.ok(ids.includes("wbPen") && ids.includes("wbBackground") && ids.includes("wbPng"));
  assert.ok(ids.includes("mapSearch") && ids.includes("mapRoute") && ids.includes("mapOffline")
    && ids.includes("mapGeoExport") && ids.includes("mapCluster"));
  assert.ok(ids.includes("musicNoteValue") && ids.includes("musicPlayback") && ids.includes("musicDrums")
    && ids.includes("musicParts") && ids.includes("musicXml"));
  assert.equal(new Set(ids).size, ids.length, "id 는 중복이 없어야 한다");
  assert.equal(TOGGLEABLE_TOOLS.length, 177);
  assert.deepEqual(
    Object.fromEntries(["header", "py", "javascript", "java", "notebook", "image", "whiteboard", "map", "music"]
      .map(target => [target, TOGGLEABLE_TOOLS.filter(tool => tool.target === target).length])),
    { header:12, py:15, javascript:2, java:11, notebook:7, image:12, whiteboard:37, map:28, music:53 }
  );
  for (const tool of TOGGLEABLE_TOOLS){
    assert.ok(tool.cls && typeof tool.cls === "string", tool.id + " 는 클래스명이 있어야 한다");
    assert.ok(["header", "py", "javascript", "java", "notebook", "image", "whiteboard", "map", "music"].includes(tool.target));
  }
  // 필수 버튼은 노출 설정 대상이 아니어야 한다.
  assert.ok(!TOGGLEABLE_TOOLS.some(t => t.cls === "run-go" || t.cls === "run-save"));
});

test("헤더: 설정(⚙)·저장·집중·분할 작업은 노출 설정 대상에서 빠져 있다", () => {
  const headerCls = TOGGLEABLE_TOOLS.filter(t => t.target === "header").map(t => t.cls);
  // 레지스트리에 없어야 하는 것들 — 클래스를 달지 않았으므로 CSS 규칙도 생기지 않는다.
  for (const id of ["settingsOpen", "btnDownload", "petFocusOpen", "studyToggle"]){
    assert.ok(!new RegExp('id="' + id + '"[^>]*class="[^"]*hdr-tool-').test(htmlSource),
      id + " 에는 숨김용 hdr-tool-* 클래스를 달지 않는다");
  }
  // 헤더 버튼마다 HTML 에 짝이 되는 클래스가 실제로 붙어 있어야 한다.
  for (const cls of headerCls) assert.ok(htmlSource.includes(cls), cls + " 가 헤더 마크업에 있어야 한다");
  // 숨길 수 있는 전역 기능은 명령 팔레트에 대체 통로가 있어야 한다.
  const paletteSource = fs.readFileSync(path.join(__dirname, "../src/js/command-palette.js"), "utf8");
  assert.match(paletteSource, /clickId\("langToggle"\)/);
  assert.match(paletteSource, /clickId\("btnCodeLink"\)/);
  assert.match(paletteSource, /callFn\("__mnOpenLastSavedFolder"\)/);
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
  // 설정 UI: 화면별 하위 탭 + 비노출/노출 좌우 이동 목록 + 저장·부팅 적용
  assert.match(htmlSource, /data-settings-tab="tools"/);
  assert.match(htmlSource, /id="settingToolScopeTabs"/);
  for (const target of ["header", "py", "javascript", "java", "notebook", "image", "whiteboard", "map", "music"]){
    assert.match(htmlSource, new RegExp('data-tool-target="' + target + '"'));
  }
  assert.match(htmlSource, /id="settingToolsHidden"[^>]*multiple/);
  assert.match(htmlSource, /id="settingToolsVisible"[^>]*multiple/);
  assert.match(htmlSource, /id="settingToolsShow"[^>]*>→<\/button>/);
  assert.match(htmlSource, /id="settingToolsHide"[^>]*>←<\/button>/);
  assert.match(htmlSource, /id="settingToolsFixed"/);
  assert.doesNotMatch(htmlSource, /id="settingTool-[^"]+"/);
  assert.match(appSource, /const TOOL_VISIBILITY_TARGETS = Object\.freeze/);
  assert.match(appSource, /const moveSelectedTools = \(makeVisible\) =>/);
  assert.match(appSource, /toolVisibilityDraft\[id\] = !!makeVisible/);
  assert.match(appSource, /syncToolVisibilityTransfer\(\)/);
  assert.match(appSource, /toolVisibilityDraft \? toolVisibilityDraft\[tool\.id\] !== false/);
  assert.match(appSource, /hidden\.addEventListener\("dblclick"/);
  assert.match(appSource, /e\.key === "ArrowRight"/);
  assert.match(cssSource, /\.settings-tool-scope-tabs\{/);
  assert.match(cssSource, /\.settings-tool-transfer\{display:grid/);
  assert.match(cssSource, /\.settings-tool-listbox\{/);
  // 더보기(⋮): 설정뿐 아니라 저장 폴더의 런타임 가용성까지 계산해 빈 메뉴를 없앤다.
  assert.match(appSource, /const syncHeaderMoreAvailability = \(\) =>/);
  assert.match(appSource, /!saveFolderOpen\.hidden && vis\.hdrSaveFolder !== false/);
  assert.match(appSource, /headerMoreWrap\.hidden = !available/);
  assert.match(appSource, /toolVisibility: collectToolVisibility\(\)/);
  assert.match(appSource, /applyToolVisibility\(\)/);
  assert.match(stateSource, /id:"pyRevert"[\s\S]*?cls:"run-py-revert"/);
  assert.match(stateSource, /id:"pyGrade"[\s\S]*?cls:"run-py-grade"[\s\S]*?target:"py"/);
  assert.match(stateSource, /id:"jsGrade"[\s\S]*?cls:"run-js-grade"[\s\S]*?target:"javascript"/);
  assert.match(stateSource, /id:"jsPkg"[\s\S]*?cls:"run-js-library"[\s\S]*?target:"javascript"/);
  assert.match(stateSource, /id:"javaEnv"[\s\S]*?cls:"run-java-env"[\s\S]*?target:"java"/);
  assert.match(stateSource, /id:"javaConfig"[\s\S]*?cls:"run-java-config"[\s\S]*?target:"java"/);
  assert.match(stateSource, /id:"javaPractice"[\s\S]*?cls:"run-java-practice-group"[\s\S]*?target:"java"/);
  assert.match(stateSource, /id:"pyDedupe"[\s\S]*?cls:"run-dedupe"/);
  assert.match(stateSource, /id:"pySpellcheck"[\s\S]*?cls:"run-spellcheck"/);
  assert.match(stateSource, /id:"nbDedupe"[\s\S]*?cls:"nbv-dedupe"/);
  assert.match(codeViewerSource, /run-revert run-py-revert/);
  assert.match(codeViewerSource, /run-grade run-py-grade/);
  assert.match(jsEditorSource, /run-grade run-js-grade/);
  assert.match(javaEditorSource, /run-grade run-java-grade/);
  assert.match(javaEditorSource, /run-revert run-java-revert/);
  assert.match(cssSource, /hide-tool-pyGrade\s+\.run-py-grade/);
  assert.match(cssSource, /hide-tool-jsGrade\s+\.run-js-grade/);
  assert.match(cssSource, /hide-tool-javaGrade\s+\.run-java-grade/);
  assert.doesNotMatch(cssSource, /hide-tool-pyGrade\s+\.run-grade[\s,\{]/);
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

test("JavaScript·Java·화이트보드·지도·악보: 등록한 숨김 클래스가 실제 동적 도구막대에 연결된다", () => {
  const sources = { javascript:jsEditorSource, java:javaEditorSource, whiteboard:whiteboardSource, map:mapSource, music:musicSource };
  const generatedWhiteboardTools = new Set(["select", "pen", "highlighter", "eraser", "line", "arrow", "rect", "ellipse", "text"]);
  assert.match(whiteboardSource, /"wb-tool wb-toolvis-" \+ t/);
  for (const tool of TOGGLEABLE_TOOLS.filter(tool => sources[tool.target])){
    if (tool.target === "whiteboard" && generatedWhiteboardTools.has(tool.cls.replace("wb-toolvis-", ""))){
      assert.ok(whiteboardSource.includes('["' + tool.cls.replace("wb-toolvis-", "") + '"'),
        tool.id + "가 화이트보드 TOOLS 목록에 있어야 한다");
      continue;
    }
    assert.ok(sources[tool.target].includes(tool.cls),
      tool.id + "의 " + tool.cls + " 클래스가 " + tool.target + " 화면 코드에 있어야 한다");
  }

  // 저장·실행 취소/복구·도구막대 다시 보이기는 숨길 수 없게 두어 복구 경로를 보장한다.
  assert.doesNotMatch(whiteboardSource, /wb-undo[^\n]*wb-toolvis-|wb-redo[^\n]*wb-toolvis-/);
  assert.doesNotMatch(mapSource, /(?:saveBtn|undoBtn|redoBtn|toolsToggleBtn)\.className\s*=[^\n]*map-toolvis-/);
  assert.doesNotMatch(musicSource, /music-save[^\n]*music-toolvis-|music-history[^\n]*music-toolvis-|music-tools-toggle[^\n]*music-toolvis-/);

  // 지도 선택창·주변 시설 창도 쓰는 공용 클래스는 숨김 기준으로 삼지 않는다.
  for (const tool of TOGGLEABLE_TOOLS.filter(tool => tool.target === "map")){
    assert.match(tool.cls, /^map-toolvis-/, tool.id + "는 지도 본체 전용 클래스를 써야 한다");
  }
  assert.doesNotMatch(cssSource, /hide-tool-mapSearch\s+\.map-search[\s,\{]/);
  assert.doesNotMatch(cssSource, /hide-tool-mapBasemap\s+\.map-select[\s,\{]/);
});

test("이미지 편집기: 자르기·표시·보정은 딸린 UI까지 함께 숨기고, 켜 둔 모드는 정리한다", () => {
  // 필수 버튼(저장)에는 숨김 클래스를 달지 않는다.
  assert.doesNotMatch(imageSource, /run-save img-tool-|img-tool-\w+ run-save/);
  // 자르기 세트: 버튼·'적용'·비율 프리셋·선택 상자
  assert.equal((imageSource.match(/"img-tool-crop"/g) || []).length, 2);   // 자르기 + 적용
  assert.match(cssSource, /hide-tool-imgCrop\s+\.img-crop-ratios/);
  assert.match(cssSource, /hide-tool-imgCrop\s+\.img-crop-box/);
  // 패널: 표시 패널은 .img-adjust 를 함께 쓰므로 보정 패널에는 전용 클래스가 있어야 한다.
  assert.match(imageSource, /adjustPanel\.className = "img-adjust img-adjust-panel"/);
  assert.match(cssSource, /hide-tool-imgAnnotate\s+\.img-annotate/);
  assert.match(cssSource, /hide-tool-imgAdjust\s+\.img-adjust-panel/);
  assert.doesNotMatch(cssSource, /hide-tool-imgAdjust\s+\.img-adjust[\s,\{]/);
  // 숨김 즉시 켜져 있던 모드를 끄기 위한 알림·수신
  assert.match(stateSource, /dispatchEvent\(new CustomEvent\("mn-tool-visibility"/);
  assert.match(imageSource, /addEventListener\("mn-tool-visibility", onToolVisibility\)/);
});
