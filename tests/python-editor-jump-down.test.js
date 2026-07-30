"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const editor = fs.readFileSync(path.join(__dirname, "../src/js/python-editor.js"), "utf8");
const helperStart = editor.indexOf("function documentEndBlankIndent");
const helperEnd = editor.indexOf("function buildCodeEditor", helperStart);
const context = {
  pythonLineOpensBlock(line){
    return String(line || "").trimEnd().endsWith(":");
  }
};
vm.runInNewContext(
  editor.slice(helperStart, helperEnd) + "\nthis.documentEndBlankIndent = documentEndBlankIndent;",
  context
);

test("문서 끝 빈 줄 추가는 마지막 코드 줄의 들여쓰기를 유지한다", () => {
  assert.equal(context.documentEndBlankIndent("def work():\n    try:\n        run()", "python"), "        ");
  assert.equal(context.documentEndBlankIndent("def work():\n    try:\n        run()\n\n", "python"), "        ");
});

test("블록을 여는 마지막 줄 뒤에서는 Enter처럼 한 단계 더 들여쓴다", () => {
  assert.equal(context.documentEndBlankIndent("def work():\n    if ready:", "python"), "        ");
  assert.equal(context.documentEndBlankIndent("if (ready) {", "c"), "    ");
});

test("아래 화살표는 들여쓰기된 줄 10개를 추가한다", () => {
  assert.match(editor, /const blankIndent = documentEndBlankIndent\(ta\.value, prof\);/);
  assert.match(editor, /ta\.value = ta\.value \+ \("\\n" \+ blankIndent\)\.repeat\(JUMP_DOWN_LINES\);/);
});
