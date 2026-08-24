"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const styles = read("src/styles.css");
const codeViewer = read("src/js/code-viewer.js");
const notebookRun = read("src/js/notebook-run.js");
const notebookCells = read("src/js/notebook-cells.js");

// code-viewer.js 는 통째로 못 돌린다 — 코드 글자 크기·폰트 구획만 떼어 실행한다.
const start = codeViewer.indexOf("const CODE_FONT_SIZE_BASE");
const end = codeViewer.indexOf("function setCodeFontFamily");
assert.ok(start > 0 && end > start, "code-viewer.js 에서 코드 글자 크기 구획을 찾지 못했습니다");

function loadFontModule(saved){
  const context = {
    localStorage:{ getItem:() => (saved == null ? null : String(saved)), setItem:() => {} }
  };
  vm.createContext(context);
  vm.runInContext(codeViewer.slice(start, end)
    + "\nthis.registerEditorFont = registerEditorFont;"
    + "\nthis.bumpCodeFont = bumpCodeFont;", context);
  return context;
}

function fakeHost(){
  const props = new Map();
  return {
    isConnected: true,
    props,
    style:{
      setProperty:(name, value) => props.set(name, value),
      removeProperty:(name) => props.delete(name)
    }
  };
}

test("코드 글자 크기와 함께 단위 없는 배율(--code-scale)을 내려준다", () => {
  const ctx = loadFontModule(null);
  const host = fakeHost();
  ctx.registerEditorFont(host);
  assert.equal(host.props.get("--code-fs"), "13px");
  assert.equal(host.props.get("--code-scale"), "1");        // 기본 13px = 배율 1.0
});

test("A+ / A− 로 크기를 바꾸면 배율도 같은 비율로 따라간다", () => {
  const ctx = loadFontModule(null);
  const host = fakeHost();
  ctx.registerEditorFont(host);
  ctx.bumpCodeFont(5);                                      // 13 → 18px
  assert.equal(host.props.get("--code-fs"), "18px");
  assert.equal(host.props.get("--code-scale"), String(Math.round(18 / 13 * 1000) / 1000));
  ctx.bumpCodeFont(-7);                                     // 18 → 11px (하한)
  assert.equal(host.props.get("--code-fs"), "11px");
  assert.equal(host.props.get("--code-scale"), String(Math.round(11 / 13 * 1000) / 1000));
});

test("저장된 크기로 시작해도 배율이 그 크기에 맞춰 복원된다", () => {
  const ctx = loadFontModule(26);
  const host = fakeHost();
  ctx.registerEditorFont(host);
  assert.equal(host.props.get("--code-fs"), "26px");
  assert.equal(host.props.get("--code-scale"), "2");
});

test("마크다운 셀 본문·제목이 코드 글자 배율을 따라간다", () => {
  assert.match(styles, /\.nbv-md,\.nbv-md-preview\{font-size:calc\(1em \* var\(--code-scale,1\)\)\}/);
  for (const [tag, px] of [["h1", 30], ["h2", 24], ["h3", 19], ["h4", 16]]){
    const rule = ".nbv-md " + tag + ",.nbv-md-preview " + tag +
                 "{font-size:calc(" + px + "px * var(--code-scale,1))}";
    assert.ok(styles.includes(rule), tag + " 제목 배율 규칙이 없습니다: " + rule);
  }
});

test("마크다운 배율 규칙은 .md-host 제목 규칙보다 뒤에 온다(같은 특정도라 순서가 곧 우선순위)", () => {
  const mdHostH1 = styles.indexOf(".md-host h1{font-size:30px");
  const cellH1 = styles.indexOf(".nbv-md h1,.nbv-md-preview h1{");
  assert.ok(mdHostH1 > 0 && cellH1 > 0, "비교할 규칙을 찾지 못했습니다");
  assert.ok(cellH1 > mdHostH1, "노트북 마크다운 제목 규칙이 .md-host 보다 앞에 있으면 덮이지 않습니다");
});

test("마크다운 원문 편집 textarea 도 코드 셀과 같은 글꼴·크기를 쓴다", () => {
  // `.nbv-md-editpane>.nbv-md-edit` 가 앞에 따로 있으므로 줄머리에 오는 본 규칙만 집는다.
  const at = styles.indexOf("\n  .nbv-md-edit{");
  assert.ok(at > 0, ".nbv-md-edit 규칙을 찾지 못했습니다");
  const rule = styles.slice(at, styles.indexOf("}", at) + 1);
  assert.match(rule, /font-size:var\(--code-fs,13px\)/);
  assert.match(rule, /font-family:var\(--code-ff,/);
  assert.match(rule, /line-height:var\(--code-lh,21px\)/);
  assert.doesNotMatch(rule, /font-size:13px/);
});

test("글자 크기가 바뀌면 편집 중인 마크다운 textarea 높이도 다시 맞춘다", () => {
  assert.match(notebookCells, /ctrl\.refitEditor = \(\) => \{ if \(editCtx\) editCtx\.grow\(\); \};/);
  assert.match(notebookRun, /typeof ctrl\.refitEditor === "function"\) ctrl\.refitEditor\(\)/);
});

test("A− / A+ 버튼 설명이 마크다운 셀까지 포함한다고 알린다", () => {
  assert.match(notebookRun, /fontDown\.title = "노트북 글자 작게 — 코드 셀·마크다운 셀·결과 \(Ctrl\+−\)";/);
  assert.match(notebookRun, /fontUp\.title = "노트북 글자 크게 — 코드 셀·마크다운 셀·결과 \(Ctrl\+\+\)";/);
});
