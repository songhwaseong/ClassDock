"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function coordinateHelper(){
  const document = { addEventListener:() => {}, getElementById:() => null };
  const context = {
    document,
    window:{ document, addEventListener:() => {}, getSelection:() => null, innerWidth:1200, innerHeight:800 },
    requestAnimationFrame:fn => fn(),
    setTimeout:() => 0,
    clearTimeout:() => {},
    console,
    Math
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "src/js/pdf-editor.js"), "utf8") +
    ";globalThis.__pdfMarkupTest = { pageLocalFromClient };";
  vm.runInContext(source, context);
  return context.__pdfMarkupTest.pageLocalFromClient;
}

test("PDF 회전·확대 화면 좌표를 원래 페이지 좌표로 되돌린다", () => {
  const local = { x:42, y:31 }, z = 1.75;
  const frame = { left:100, top:60 };
  const clientFor = {
    0:() => ({ x:frame.left + local.x * z, y:frame.top + local.y * z }),
    90:() => ({ x:frame.left + (100 - local.y) * z, y:frame.top + local.x * z }),
    180:() => ({ x:frame.left + (200 - local.x) * z, y:frame.top + (100 - local.y) * z }),
    270:() => ({ x:frame.left + local.y * z, y:frame.top + (200 - local.x) * z })
  };
  const pageLocalFromClient = coordinateHelper();
  for (const rotation of [0, 90, 180, 270]){
    const point = clientFor[rotation]();
    const p = { cssW:200, cssH:100, exportRotation:rotation, frame:{ getBoundingClientRect:() => frame } };
    const actual = pageLocalFromClient(p, { zoom:z }, point.x, point.y);
    assert.ok(Math.abs(actual.x - local.x) < 1e-9, `rotation ${rotation}: x`);
    assert.ok(Math.abs(actual.y - local.y) < 1e-9, `rotation ${rotation}: y`);
  }
});

test("PDF 강조와 명령 팔레트의 키보드 접근성 연결을 유지한다", () => {
  const pdfEditor = fs.readFileSync(path.join(root, "src/js/pdf-editor.js"), "utf8");
  const palette = fs.readFileSync(path.join(root, "src/js/command-palette.js"), "utf8");
  assert.match(pdfEditor, /document\.addEventListener\("keyup", \(e\) => \{/);
  assert.match(pdfEditor, /positionTextHiBar\(true\)/);
  assert.match(palette, /function trapFocus\(e\)/);
  assert.match(palette, /aria-activedescendant/);
  for (const command of ["closeCurrent", "reopenClosed", "pdfUndo", "pdfRedo", "studyToggle"])
    assert.match(palette, new RegExp('C\\("' + command + '"'));
});
