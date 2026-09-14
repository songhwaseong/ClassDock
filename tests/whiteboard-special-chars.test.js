"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { whiteboardSpecialCharGroups, normalizeWhiteboardRecentSymbols, whiteboardEducationCatalog } = require("../src/js/whiteboard.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("특수문자 목록은 갈래마다 겹치지 않는 글자를 담고, 수학 갈래는 도구상자 기호를 빌린다", () => {
  const groups = whiteboardSpecialCharGroups();
  assert.deepEqual(groups.map((group) => group.id), ["common","shape","arrow","number","unit","punct","script","greek","math"]);
  for (const group of groups){
    assert.ok(group.chars.length >= 10, group.id);
    const chars = group.chars.map(([ch]) => ch);
    assert.equal(new Set(chars).size, chars.length, group.id);
    for (const [ch, name] of group.chars){ assert.ok(ch && ch.length <= 2, group.id + " " + ch); assert.ok(name, ch); }
  }
  const mathChars = groups.find((group) => group.id === "math").chars.map(([ch]) => ch);
  const symbols = whiteboardEducationCatalog().filter((entry) => entry.category === "symbol").map((entry) => entry.value);
  assert.deepEqual(mathChars, symbols);
});

test("최근 특수문자는 새 글자를 앞에 두고 중복 없이 20개까지", () => {
  assert.deepEqual(normalizeWhiteboardRecentSymbols(["①","※"], "※"), ["※","①"]);
  assert.deepEqual(normalizeWhiteboardRecentSymbols(null, "→"), ["→"]);
  assert.deepEqual(normalizeWhiteboardRecentSymbols([1, "", "긴긴긴긴긴", "★"]), ["★"]);
  const many = Array.from({ length:30 }, (_, i) => String.fromCharCode(0x2460 + i));
  assert.equal(normalizeWhiteboardRecentSymbols(many, "※").length, 20);
});

test("글상자 우클릭은 보드 메뉴로 올라가지 않고, 고르개는 초점을 뺏지 않는다", () => {
  const source = read("src/js/whiteboard.js");
  assert.match(source, /ta\.addEventListener\("contextmenu", \(e\) => \{\s*e\.stopPropagation\(\);\s*if \(e\.shiftKey\) return;/);
  assert.match(source, /symbolPicker\.addEventListener\("mousedown",e=>e\.preventDefault\(\)\)/);
  assert.match(source, /document\.execCommand\("insertText",false,ch\)/);
  assert.match(source, /symbolPicker\.className="wb-symbol-picker ui-keep-symbols"/);
  assert.match(read("src/js/icons.js"), /\.text-view,\.ui-keep-symbols"\)/);
});
