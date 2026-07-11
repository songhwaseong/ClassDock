"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadTheme(values){
  const attrs = new Map();
  const context = {
    localStorage:{ getItem:key => values[key] ?? null },
    matchMedia:() => ({ matches:false }),
    document:{ documentElement:{ setAttribute:(key, value) => attrs.set(key, value) } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "src/js/theme.js"), "utf8"), context);
  return attrs;
}

test("저장한 라이트 배경 프리셋을 초기 테마와 함께 즉시 적용한다", () => {
  const attrs = loadTheme({ theme:"light", lightBackground:"mint" });
  assert.equal(attrs.get("data-theme"), "light");
  assert.equal(attrs.get("data-light-background"), "mint");
});

test("잘못된 라이트 배경 프리셋은 기본 쿨 그레이로 정규화한다", () => {
  const attrs = loadTheme({ theme:"light", lightBackground:"neon" });
  assert.equal(attrs.get("data-light-background"), "cool");
});

test("라이트 모드 배경 설정은 메모 색과 분리된 본 화면 전용 UI·CSS를 가진다", () => {
  const html = fs.readFileSync(path.join(root, "manneung-classroom.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(html, /id="settingLightBackground"/);
  for (const value of ["cool", "warm", "mint", "lavender", "sky"])
    assert.match(html, new RegExp('data-light-background="' + value + '"'));
  assert.match(css, /html\[data-theme="light"\]\[data-light-background="mint"\]\{--bg:#edf7f2;--workspace-bg:#edf7f2\}/);
  assert.match(css, /\[data-light-background="mint"\] \.office\.python-editor-doc\{background:#edf7f2;--code-bg:#f9fdfb/);
  assert.match(css, /\[data-light-background\]:not\(\[data-light-background="cool"\]\) \.viewer/);
  assert.doesNotMatch(css, /data-light-background[^\n]*memo-paper/);
  const codeViewer = fs.readFileSync(path.join(root, "src/js/code-viewer.js"), "utf8");
  assert.match(codeViewer, /if \(runnable\) host\.classList\.add\("python-editor-doc"\)/);
});
