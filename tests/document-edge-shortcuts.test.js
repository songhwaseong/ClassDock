"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const notebook = fs.readFileSync(path.join(__dirname, "../src/js/notebook-cells.js"), "utf8");
const notebookTools = fs.readFileSync(path.join(__dirname, "../src/js/notebook-tools.js"), "utf8");

test("노트북 Ctrl+Home/End는 첫 셀 시작과 마지막 셀 끝으로 이동한다", () => {
  assert.match(notebook, /const idx = edge === "start" \? 0 : ctrls\.length - 1;/);
  assert.match(notebook, /nbEnterEdit\(ownerDoc, idx, edge\);/);
  assert.match(notebook, /nbMoveTextEditorToDocumentEdge\(textarea, edge\);/);
  assert.match(notebook, /documentEdge && \(!textEntry \|\| cellEditor\)/);
  assert.match(notebook, /nbFocusNotebookDocumentEdge\(ownerDoc, documentEdge\);/);
  assert.match(notebookTools, /Ctrl\+Home \/ End/);
});
