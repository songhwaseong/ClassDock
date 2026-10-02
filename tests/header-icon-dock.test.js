"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
const documents = fs.readFileSync(path.join(root, "src/js/documents.js"), "utf8");

test("헤더 빠른 도구는 아이콘 그룹과 접근 가능한 이름을 갖는다", () => {
  for (const id of ["headerOpenFiles", "headerOpenFolder", "btnDownload", "btnPrint", "headerZoomOut", "headerZoomLabel", "headerZoomIn", "btnOfficeFullscreen", "settingsOpen", "helpOpen"]){
    assert.match(html, new RegExp('id="' + id + '"[^>]*aria-label="[^"]+"'), id);
  }
  assert.ok(html.includes('class="header-command-dock" aria-label="빠른 도구"'));
  assert.ok(css.includes('.header-dock-group+.header-dock-group'));
  assert.ok(css.includes('border-left:1px solid rgba(148,163,184,.25)'));
});

test("헤더 빠른 도구는 활성 문서의 기존 저장·확대 기능을 재사용한다", () => {
  assert.ok(app.includes('function updateHeaderCommandDock()'));
  assert.ok(app.includes('function saveFromHeader()'));
  assert.ok(app.includes('activeDocumentControl(".run-save")'));
  // 실행(▶)·터미널은 실행 바에만 둔다 — 헤더에 같은 단추가 또 있어 한 화면에 둘씩 보였다.
  for (const id of ["headerRun", "headerTerminal"]){
    assert.ok(!html.includes('id="' + id + '"'), id);
    assert.ok(!app.includes('byId("' + id + '")'), id);
  }
  assert.ok(app.includes('byId("headerZoomOut").onclick'));
  assert.ok(app.includes('setPdfZoom((state.zoom || 1) / 1.25)'));
  assert.ok(documents.includes('typeof updateHeaderCommandDock === "function"'));
});

test("현재 문서에서 쓸 수 없는 빠른 도구와 빈 기능군은 완전히 숨긴다", () => {
  assert.ok(app.includes('save.hidden = !canSave'));
  assert.ok(app.includes('print.hidden = !canPrint'));
  assert.ok(app.includes('button.hidden = !pdf'));
  assert.ok(css.includes('.header-dock-group:not(:has(>button:not([hidden])))'));
});

test("기존 메모·검색·언어 버튼도 빠른 도구와 같은 하나의 도크 표면을 쓴다", () => {
  assert.ok(css.includes('.header-actions{display:flex'));
  assert.ok(css.includes('background:linear-gradient(180deg,rgba(15,23,42,.7),rgba(2,6,23,.5))'));
  assert.ok(css.includes('header .header-actions .cmdk-trigger'));
  assert.ok(css.includes('header .header-actions .lang-toggle'));
  assert.ok(css.includes('.header-command-dock{display:inline-flex'));
  assert.ok(css.includes('border-radius:0;background:transparent;box-shadow:none'));
});
