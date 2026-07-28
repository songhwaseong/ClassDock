"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const editor = fs.readFileSync(path.join(__dirname, "../src/js/python-editor.js"), "utf8");

test("선택 없이 커서만 단어 안에 있으면 F3은 먼저 그 단어를 선택한다", () => {
  const branch = editor.slice(editor.indexOf('if (e.key === "F3" && !e.ctrlKey'));
  assert.match(branch, /if \(ta\.selectionStart === ta\.selectionEnd\)\{/);
  assert.match(branch, /const word = wordAtOffset\(ta\.selectionStart\);/);
  assert.match(branch, /word\.word\.length <= 80 && \/\^\[\\w가-힣\]\+\$\/\.test\(word\.word\)/);
  assert.match(branch, /ta\.setSelectionRange\(word\.start, word\.end\);/);
  // 단어를 선택만 하고 이번 키 입력은 끝난다 — 다음 F3 부터 같은 단어 순환
  assert.match(branch, /ta\.setSelectionRange\(word\.start, word\.end\);[\s\S]{0,200}?\}\s*return;/);
  // 선택이 있을 때의 기존 순환 동작은 그대로
  assert.match(branch, /const next = findNextIdentifierOccurrence\(ta\.value, ta\.selectionStart, ta\.selectionEnd, e\.shiftKey\);/);
});
