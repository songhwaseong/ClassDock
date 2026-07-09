"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// python-viewer.js 분할본을 이어붙여 실행 — 번들과 동일한 전역 환경이 된다.
const source = ["code-viewer.js", "python-snippets.js", "python-editor.js", "python-run-context.js", "python-runtime.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8")).join("\n");
const context = vm.createContext({
  console,
  window:{},
  localStorage:{ getItem:() => null, setItem:() => {} },
  TextEncoder,
  TextDecoder,
  btoa:(value) => Buffer.from(value, "binary").toString("base64"),
  atob:(value) => Buffer.from(value, "base64").toString("binary")
});
new vm.Script(source, { filename:"python-viewer.js" }).runInContext(context);
const splitNotebookCells = new vm.Script("splitNotebookCells").runInContext(context);
const ensureFirstNotebookCellMarker = new vm.Script("ensureFirstNotebookCellMarker").runInContext(context);

test("셀 나누기 시작 코드는 첫 줄에 셀 경계를 자동으로 추가한다", () => {
  assert.equal(ensureFirstNotebookCellMarker("print('첫 셀')"), "# %%\nprint('첫 셀')");
  assert.equal(ensureFirstNotebookCellMarker("# %%\nprint('첫 셀')"), "# %%\nprint('첫 셀')");
});

test("첫 경계 없이 중간 경계만 있어도 앞쪽 코드를 첫 셀로 보존한다", () => {
  const cells = splitNotebookCells("before = 1\nprint(before)\n# %%\nafter = 2");
  assert.equal(cells.length, 2);
  assert.equal(cells[0].code, "before = 1\nprint(before)");
  assert.equal(cells[1].code, "# %%\nafter = 2");
});
