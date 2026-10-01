"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/js/code-viewer.js"), "utf8");
const fontSource = source.slice(source.indexOf("const CODE_FONT_SIZE_BASE"), source.indexOf("// 빈 파이썬 코드로 바로 시작"));

function loadFonts(storage = new Map()){
  const ctx = {
    docs:[], activeId:0,
    localStorage:{ getItem:key => storage.get(key) || null, setItem:(key, value) => storage.set(key, value) }
  };
  vm.createContext(ctx);
  vm.runInContext(fontSource, ctx);
  return ctx;
}

function host(){
  const properties = new Map();
  return { isConnected:true, properties,
    style:{ setProperty:(name, value) => properties.set(name, value), removeProperty:name => properties.delete(name) } };
}

test("TXT의 글꼴·크기를 바꿔도 Python과 나중에 여는 파일은 바뀌지 않는다", () => {
  const storage = new Map();
  const ctx = loadFonts(storage);
  const txt = { id:1, workspacePath:"notes.txt" }, py = { id:2, workspacePath:"main.py" };
  ctx.docs.push(txt, py); ctx.activeId = py.id;
  const txtHost = host(), pyHost = host(), pyOutput = host();
  ctx.registerEditorFont(txtHost, txt);
  ctx.registerEditorFont(pyHost, py);
  ctx.registerEditorFont(pyOutput, py);
  ctx.bumpCodeFont(5, txt);
  ctx.setCodeFontFamily("Malgun Gothic", txt);
  assert.equal(txtHost.properties.get("--code-fs"), "18px");
  assert.match(txtHost.properties.get("--code-ff"), /Malgun Gothic/);
  for (const panel of [pyHost, pyOutput]){
    assert.equal(panel.properties.get("--code-fs"), "13px");
    assert.equal(panel.properties.get("--code-ff"), undefined);
  }
  const later = host();
  ctx.registerEditorFont(later, { workspacePath:"later.txt" });
  assert.equal(later.properties.get("--code-fs"), "13px");
  assert.equal(later.properties.get("--code-ff"), undefined);
  assert.equal(storage.has("pyCodeFontSize"), false);
  assert.equal(storage.has("pyCodeFontFamily"), false);
});

test("대상 생략 시 활성 파일의 편집기와 실행 결과만 바뀐다", () => {
  const ctx = loadFonts();
  const a = { id:1, name:"a.py" }, b = { id:2, name:"b.py" };
  ctx.docs.push(a, b); ctx.activeId = a.id;
  const editor = host(), output = host(), other = host();
  let refreshes = 0;
  editor.__refreshFontMetrics = () => refreshes++;
  ctx.registerEditorFont(editor, a); ctx.registerEditorFont(output, a); ctx.registerEditorFont(other, b);
  ctx.bumpCodeFont(99);
  ctx.setCodeFontFamily("Malgun Gothic");
  assert.equal(editor.properties.get("--code-fs"), "30px");
  assert.equal(output.properties.get("--code-fs"), "30px");
  assert.equal(output.properties.get("--code-ff"), editor.properties.get("--code-ff"));
  assert.equal(other.properties.get("--code-fs"), "13px");
  assert.equal(refreshes, 3);
  ctx.bumpCodeFont(-99, editor);
  assert.equal(output.properties.get("--code-fs"), "11px");
});

test("세션을 다시 시작해도 같은 경로의 설정만 복원된다", () => {
  const storage = new Map();
  let ctx = loadFonts(storage);
  const first = { workspacePath:"folder-a/main.py" };
  ctx.bumpCodeFont(5, first); ctx.setCodeFontFamily("Malgun Gothic", first);
  ctx = loadFonts(storage);
  const reopened = host(), sameNameElsewhere = host();
  ctx.registerEditorFont(reopened, { workspacePath:"folder-a/main.py" });
  ctx.registerEditorFont(sameNameElsewhere, { workspacePath:"folder-b/main.py" });
  assert.equal(reopened.properties.get("--code-fs"), "18px");
  assert.match(reopened.properties.get("--code-ff"), /Malgun Gothic/);
  assert.equal(sameNameElsewhere.properties.get("--code-fs"), "13px");
  assert.equal(sameNameElsewhere.properties.get("--code-ff"), undefined);
});

test("보기·편집 전환과 새로 만들어진 결과 패널에 같은 파일 설정을 적용한다", () => {
  const ctx = loadFonts();
  const doc = { name:"note.txt" }, oldEditor = host();
  ctx.registerEditorFont(oldEditor, doc); ctx.bumpCodeFont(3, doc);
  ctx.setCodeFontFamily("Malgun Gothic", doc); ctx.unregisterEditorFont(oldEditor);
  const view = host(), newEditor = host();
  ctx.applyCodeFontMetrics(view, doc); ctx.registerEditorFont(newEditor, doc);
  assert.equal(view.properties.get("--code-fs"), "16px");
  assert.equal(view.properties.get("--code-ff"), newEditor.properties.get("--code-ff"));
  ctx.bumpCodeFont(1, doc);
  assert.equal(oldEditor.properties.get("--code-fs"), "16px");
  assert.equal(newEditor.properties.get("--code-fs"), "17px");
});

test("표시 이름이 같은 원본 파일도 실제 경로가 다르면 따로 복원한다", () => {
  const storage = new Map();
  let ctx = loadFonts(storage);
  const a = { name:"main.py", nativeAbsolutePath:"D:\\one\\main.py" };
  const b = { name:"main.py", nativeAbsolutePath:"D:\\two\\main.py" };
  ctx.bumpCodeFont(3, a);
  const bHost = host(); ctx.registerEditorFont(bHost, b);
  assert.equal(bHost.properties.get("--code-fs"), "13px");
  ctx.bumpCodeFont(6, b);
  ctx = loadFonts(storage);
  const aHost = host(), reopenedB = host();
  ctx.registerEditorFont(aHost, a); ctx.registerEditorFont(reopenedB, b);
  assert.equal(aHost.properties.get("--code-fs"), "16px");
  assert.equal(reopenedB.properties.get("--code-fs"), "19px");
});

test("이름 없는 새 파일끼리 겹치지 않고 첫 저장 후에는 이름으로 설정을 기억한다", () => {
  const storage = new Map(), ctx = loadFonts(storage);
  const a = { name:"새 코드.py", isScratch:true }, b = { name:"새 코드.py", isScratch:true };
  const aHost = host(), bHost = host();
  ctx.registerEditorFont(aHost, a); ctx.registerEditorFont(bHost, b); ctx.bumpCodeFont(6, a);
  assert.equal(bHost.properties.get("--code-fs"), "13px");
  assert.equal(storage.size, 0);
  a._named = true; a.name = "saved.py"; a.workspacePath = "saved.py";
  a.workspaceRestorePath = "새 코드.py"; ctx.persistCodeFontSettings(a);
  const reopened = host(); loadFonts(storage).registerEditorFont(reopened, { name:"saved.py" });
  assert.equal(reopened.properties.get("--code-fs"), "19px");
});

test("예전 공통 글꼴이 손글씨여도 시작값은 Consolas이고 파일별 글꼴은 유지한다", () => {
  const storage = new Map([
    ["pyCodeFontSize", "20"], ["pyCodeFontFamily", "hand:pen"],
    ["classdock-code-font:v1:broken.txt", '{"size":100,"family":"missing-font"}'],
    ["classdock-code-font:v1:invalid.txt", "bad-json"],
    ["classdock-code-font:v1:custom.txt", '{"size":18,"family":"hand:pen"}']
  ]);
  const ctx = loadFonts(storage);
  for (const name of ["new.txt", "main.py", "broken.txt", "invalid.txt"]){
    const doc = { name }, panel = host(); ctx.registerEditorFont(panel, doc);
    assert.equal(panel.properties.get("--code-fs"), "20px");
    assert.equal(panel.properties.get("--code-ff"), undefined);
    assert.equal(ctx.codeFontSettings(doc).family, "");
  }
  const custom = { name:"custom.txt" };
  assert.equal(ctx.codeFontSettings(custom).family, "hand:pen");
  assert.equal(ctx.codeFontSettings(custom).size, 18);
  ctx.bumpCodeFont(2, { name:"changed.txt" });
  assert.equal(storage.get("pyCodeFontSize"), "20");
  assert.equal(storage.get("pyCodeFontFamily"), "hand:pen");
});
