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
  assert.ok(css.includes('header .header-actions .lang-toggle'));
  assert.ok(css.includes('.header-command-dock{display:inline-flex'));
  assert.ok(css.includes('border-radius:0;background:transparent;box-shadow:none'));
});

test("머리글 가운데는 기능 검색 칸이고 문서 상태는 오른쪽 아래로 옮긴다", () => {
  const center = html.match(/<div class="header-search">([\s\S]*?)\n  <\/div>/);
  assert.ok(center, "header-search");
  assert.match(center[1], /id="commandPaletteOpen"/);
  assert.match(center[1], /<kbd id="commandPaletteKbd" data-shortcut-action="commandPalette">/);
  // 파일 이름·모드 표시는 화면에서 감추되, 글자를 읽는 코드·시험을 위해 요소는 남긴다.
  assert.match(center[1], /<span class="header-doc-meta" hidden><span id="activeFileName"><\/span><span id="activeModeBadge"/);
  assert.ok(!html.includes('class="header-file-title"'));
  const corner = html.match(/<div class="doc-status-corner" id="docStatusCorner">([\s\S]*?)<\/div>/);
  assert.ok(corner, "docStatusCorner");
  for (const id of ["studyPairBadge", "saveStatusBadge", "activeDocEncoding"]) assert.match(corner[1], new RegExp('id="' + id + '"'), id);
  assert.ok(css.includes('.doc-status-corner:not(:has(>:not([hidden]))){display:none}'));
  // <main> 이 z-index:19 로 쌓임 맥락을 만들므로 그보다 위여야 문서 위에 보인다.
  const z = Number((css.match(/\.doc-status-corner\{[^}]*z-index:(\d+)/) || [])[1]);
  assert.ok(z > 19 && z < 30, "z-index " + z);
  assert.ok(documents.includes("function syncDocStatusCorner("));
  assert.ok(documents.includes('syncDocStatusCorner(d);'));
});
