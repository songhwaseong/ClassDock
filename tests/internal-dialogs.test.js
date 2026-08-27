"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("앱 기능은 브라우저 alert·confirm·prompt 대신 내부 창을 사용한다", () => {
  const sourceDir = path.join(root, "src/js");
  const nativeDialog = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/;
  for (const name of fs.readdirSync(sourceDir).filter(file => file.endsWith(".js"))){
    const source = fs.readFileSync(path.join(sourceDir, name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, nativeDialog, `${name}에 브라우저 기본 대화상자가 남아 있습니다`);
  }
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(styles, /#textModal,#confirmModal\{z-index:2200\}/);
});
