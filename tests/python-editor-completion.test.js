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

test("주석 안에서는 자동완성을 띄우지 않는다", () => {
  assert.match(editor, /const caretInComment = \(caret\) => \{/);
  assert.match(editor, /if \(caretInComment\(word\.end\)\)\{ hideCompletion\(\); return; \}/);
});

test("함수 자동완성 직후 ( 중복입력은 한 번 무시한다(튜플 인자는 그대로)", () => {
  // 수락으로 빈 () 가 삽입되면 그 커서 위치를 기록하고, 다음 키 입력 한 번만 유효한 one-shot 로 무효화한다.
  assert.match(editor, /pendingAutoParen = \(ta\.value\[caret - 1\] === "\(" && ta\.value\[caret\] === "\)"\) \? caret : -1;/);
  assert.match(editor, /const autoParenSpot = pendingAutoParen; pendingAutoParen = -1;/);
  assert.match(editor, /if \(e\.key === "\(" && start === end && start === autoParenSpot/);
});
