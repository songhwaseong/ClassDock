const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/js/docx-editor.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

test("DOCX 제자리 편집 문단에 계층형 우클릭 메뉴가 연결된다", () => {
  assert.match(source, /previewEl\.addEventListener\("contextmenu", onDocxContextMenu\)/);
  assert.match(source, /contextItemsFor\(row, paragraph, range/);
  assert.match(source, /docx-context-menu docx-context-sub/);
  assert.match(styles, /\.docx-context-menu\{/);
  assert.match(styles, /\.docx-context-menu button\.docx-context-parent::after\{content:"▸"/);
});

test("우클릭 메뉴는 글자 선택을 보존하고 기본 글자 편집을 제공한다", () => {
  assert.match(source, /event\.button !== 2\) state\.textSelection = null/);
  for (const label of ["복사", "잘라내기", "붙여넣기", "특수문자… (Ctrl+F10)", "문단 전체 선택"])
    assert.ok(source.includes(`label: "${label}"`), label + " 메뉴가 없다");
  assert.match(source, /document\.execCommand\("cut"\)/);
  assert.match(source, /navigator\.clipboard\.readText/);
  assert.match(source, /MNSpecialChars\.open/);
});

test("우클릭 메뉴에서 모든 DOCX 글자·문단·목록 서식을 같은 편집 함수로 실행한다", () => {
  for (const kind of ["font", "font-size", "bold", "italic", "underline", "strike", "baseline",
    "text-color", "highlight", "clear-format"])
    assert.ok(source.includes(`applyTextFormat("${kind}"`), kind + " 글자 서식 연결이 없다");
  for (const kind of ["alignment", "line-spacing", "space-before", "space-after", "indent-left",
    "indent-right", "special-indent", "clear-layout"])
    assert.ok(source.includes(`applyParagraphFormat("${kind}"`), kind + " 문단 서식 연결이 없다");
  for (const kind of ["none", "bullet", "number"])
    assert.ok(source.includes(`applyListFormat("${kind}"`), kind + " 목록 연결이 없다");
  assert.match(source, /action: copyCurrentFormatting/);
  assert.match(source, /action: pasteCurrentFormatting/);
});

test("표 문단 우클릭 메뉴는 행·열·병합·셀 서식을 모두 제공한다", () => {
  for (const kind of ["row-add-above", "row-add-below", "row-delete", "column-add-left",
    "column-add-right", "column-delete", "cell-merge-right", "cell-split"])
    assert.ok(source.includes(`applyTableAction("${kind}"`), kind + " 표 구조 연결이 없다");
  for (const kind of ["horizontal", "vertical", "fill", "border", "column-width", "row-height"])
    assert.ok(source.includes(`applyTableFormat("${kind}"`), kind + " 표 서식 연결이 없다");
  assert.match(source, /\.\.\.tableItems\.length \? \[\{ label: "표", children: tableItems \}\] : \[\]/);
});

test("그림·페이지·머리글·이력·저장도 우클릭 메뉴의 기존 경로를 쓴다", () => {
  for (const label of ["그림 추가…", "첫 그림 교체…", "첫 그림 10% 작게", "첫 그림 10% 크게",
    "용지 방향", "페이지 여백", "머리글 편집…", "바닥글 편집…", "되돌리기 (Ctrl+Z)",
    "다시 실행 (Ctrl+Y)", "저장 (Ctrl+S)"])
    assert.ok(source.includes(`label: "${label}"`), label + " 메뉴가 없다");
  assert.match(source, /action: \(\) => saveEdits\(state, doc\)/);
  assert.match(source, /if \(doc\.cleanupFns\) doc\.cleanupFns\.push\(closeDocxContextMenu\)/);
});

test("키보드 메뉴 키와 특수문자 단축키도 같은 DOCX 메뉴 대상에서 동작한다", () => {
  assert.match(source, /event\.key !== "ContextMenu"/);
  assert.match(source, /event\.shiftKey && event\.key === "F10"/);
  assert.match(source, /event\.ctrlKey[\s\S]+event\.key === "F10"/);
  assert.match(source, /previewEl\.addEventListener\("keydown", onDocxContextKeydown\)/);
});

test("DOCX 편집 도구는 문단 선택이 없어도 자리를 유지해 화면을 밀지 않는다", () => {
  assert.match(source, /textTools\.hidden = !visible/);
  assert.match(source, /paragraphTools\.hidden = !visible/);
  assert.match(source, /tableTools\.hidden = !visible/);
  assert.match(source, /textTools\.classList\.toggle\("is-idle", visible && !active\)/);
  assert.match(source, /tableToolsLabel\.textContent = "표 셀 선택"/);
  assert.match(styles, /\.docx-text-tools\.is-idle[\s\S]+opacity:/);
});

test("DOCX 제자리 편집에서는 손바닥 이동 대신 글자 커서를 쓴다", () => {
  const documents = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  assert.match(documents, /container\.classList\.contains\("docx-inline-editing"\)\) return true/);
  assert.match(styles, /\.office\.pannable\.docx-inline-editing[^{]*\{cursor:default/);
  assert.match(styles, /\.docx-inline-editing \.docx-inline-para\[contenteditable="true"\]\{cursor:text\}/);
});

test("DOCX 편집 도구막대는 긴 문서에서도 상단에 따라오고 문단을 가리지 않는다", () => {
  assert.match(styles, /\.docx-editor-bar\{position:sticky;top:8px;z-index:24/);
  assert.match(styles, /scroll-margin-top:var\(--docx-editor-tools-height,120px\)/);
  assert.match(source, /const syncStickyToolHeight = \(\) =>/);
  assert.match(source, /stickyToolObserver = new ResizeObserver\(syncStickyToolHeight\)/);
  assert.match(source, /host\.style\.setProperty\("--docx-editor-tools-height"/);
  assert.match(source, /stickyToolObserver\.disconnect\(\)/);
});

test("DOCX 편집 안내는 상시 배너 대신 편집 도구 옆 도움말로 연다", () => {
  assert.match(source, /editHelpButton\.textContent = "\?"/);
  assert.match(source, /editHelpPopup\.textContent = inline \? INLINE_NOTE : LIST_NOTE/);
  assert.match(source, /editHelpButton\.addEventListener\("click"/);
  assert.match(source, /document\.addEventListener\("pointerdown", closeEditHelpOutside, true\)/);
  assert.doesNotMatch(source, /docx-edit-note/);
  assert.match(styles, /\.docx-edit-help:hover \.docx-edit-help-pop/);
  assert.match(styles, /\.docx-edit-help\.open \.docx-edit-help-pop/);
});

test("상단 DOCX 도구는 여섯 갈래 메뉴로 정리하고 실제 컨트롤은 중복 노출하지 않는다", () => {
  for (const kind of ["document", "text", "paragraph", "table", "image", "all"])
    assert.ok(source.includes(`toolLauncherButton("${kind}"`), kind + " 분류 버튼이 없다");
  assert.match(source, /const openToolbarCategory = \(kind, button\) =>/);
  assert.match(source, /contextItemsFor\(row, paragraph, rangeInside\(paragraph\)/);
  assert.match(source, /if \(kind === "text"\) items = \(branch\("글자 서식"\)/);
  assert.match(source, /else if \(kind === "paragraph"\)/);
  assert.match(styles, /\.docx-editor-bar>\.docx-document-tools[\s\S]+display:none!important/);
  assert.match(styles, /\.docx-tool-launchers\{display:inline-flex/);
});

/* 글 문서에서 지명을 긁어 지도 탭으로 보내는 길 — 지도 쪽 배선은 tests/map-viewer.test.js 가 본다. */
test("우클릭 메뉴에서 고른 지명을 지도 검색으로 보낸다", () => {
  assert.ok(source.includes('label: "지도에서 검색"'), "지도에서 검색 메뉴가 없다");
  assert.match(source, /action: \(\) => searchMapForText\(mapQuery\), disabled: !mapQuery/);
  // 지도 모듈이 없거나, 고른 것이 없거나, 문단째 긁었으면 흐리게 둔다.
  assert.match(source, /typeof mapSearchTextFrom === "function" && typeof searchMapForText === "function"/);
  assert.match(source, /mapSearchTextFrom\(hasSelection \? commandRange\.toString\(\) : ""\)/);
});
