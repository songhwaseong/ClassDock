"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const editor = fs.readFileSync(path.join(__dirname, "../src/js/python-editor.js"), "utf8");

test("Python 자동완성은 목록 바깥을 클릭하면 닫히고 진행 중인 응답을 무효화한다", () => {
  assert.match(editor, /const dismissCompletion = \(\) => \{\s*completionSeq\+\+;\s*hideCompletion\(\);/);
  assert.match(editor, /if \(complete\.hidden \|\| complete\.contains\(event\.target\)\) return;/);
  assert.match(editor, /document\.addEventListener\("pointerdown", closeCompletionOnOutsidePointer, true\)/);
  assert.match(editor, /document\.removeEventListener\("pointerdown", closeCompletionOnOutsidePointer, true\)/);
  assert.match(editor, /ta\.addEventListener\("blur", \(\) => \{[^}]*dismissCompletion\(\)/);
});
