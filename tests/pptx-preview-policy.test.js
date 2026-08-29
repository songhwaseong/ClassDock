"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const state = read("src/js/state.js");
const app = read("src/js/app.js");
const html = read("classdock.html");
const loaders = read("src/js/file-loaders.js");
const viewer = read("src/js/pptx-viewer.js");

test("PPTX는 기본적으로 PowerPoint 변환 없이 간이 미리보기로 연다", () => {
  assert.match(state, /pptxExactByDefault:\s*false/);
  assert.match(loaders, /if \(appSettings\.pptxExactByDefault === true\)[\s\S]*pptxQuickPreview:true/);
  assert.match(viewer, /정확한 PDF로 열기/);
});

test("설정에서 자동 정확 변환을 켜고 저장할 수 있다", () => {
  assert.match(html, /id="settingPptxExactByDefault"/);
  assert.match(app, /settingPptxExactByDefault"\)\.checked = appSettings\.pptxExactByDefault === true/);
  assert.match(app, /pptxExactByDefault: byId\("settingPptxExactByDefault"\)\.checked/);
});

function exactPreviewContext(){
  const start = loaders.indexOf("async function openPptxExactPreview");
  const end = loaders.indexOf("/* ===== 압축(zip)", start);
  assert.ok(start > 0 && end > start, "정확 변환 함수 구획을 찾지 못했습니다");
  const calls = { convert:0, convertOptions:null, load:0, active:[] };
  const context = {
    docsBySourceKey: new Map(),
    setActiveDoc: (id) => calls.active.push(id),
    tryConvertPptxToPdf: async (_bytes, options) => { calls.convert++; calls.convertOptions = options; return new Uint8Array([37,80,68,70]); },
    loadPdf: async (_bytes, name, options) => {
      calls.load++;
      const doc = { id:91, name, options };
      context.docsBySourceKey.set(options.sourceKey, doc);
      return doc;
    }
  };
  vm.createContext(context);
  vm.runInContext(loaders.slice(start, end) + "\nthis.openPptxExactPreview = openPptxExactPreview;", context);
  return { context, calls };
}

test("명시적 정확 변환은 원본 저장 연결을 제거한 별도 PDF 탭을 만든다", async () => {
  const { context, calls } = exactPreviewContext();
  const file = { name:"수업.pptx", size:20, lastModified:30 };
  const result = await context.openPptxExactPreview(file, new Uint8Array([1,2]), {
    sourceKey:"root|수업.pptx", workspacePath:"수업.pptx", fsHandle:{}, fsDirHandle:{}, bulk:true
  });
  assert.equal(calls.convert, 1);
  assert.equal(calls.convertOptions.timeoutMs, 15000);
  assert.equal(calls.convertOptions.inline, true);
  assert.equal(calls.convertOptions.forceBackendCheck, true);
  assert.equal(calls.load, 1);
  assert.equal(result.name, "수업.pdf");
  assert.equal(result.options.sourceKey, "root|수업.pptx|exact-pdf");
  assert.equal(result.options.workspacePath, null);
  assert.equal(result.options.transient, true);
  assert.equal(result.options.bulk, false);
  assert.equal(result.options.fsHandle, null);
  assert.equal(result.options.fsDirHandle, null);
  assert.equal(result.options.originalSaveMode, false);
});

test("재시도는 이전 PowerPoint 백엔드 실패 캐시를 버리고 상태를 새로 확인한다", () => {
  assert.match(loaders, /if \(options\.forceBackendCheck === true\) _pptxBackend = null/);
  assert.match(loaders, /현재 간이 미리보기를 유지합니다/);
});

test("이미 만든 정확 변환 탭은 다시 만들지 않고 활성화한다", async () => {
  const { context, calls } = exactPreviewContext();
  const existing = { id:44 };
  context.docsBySourceKey.set("same|exact-pdf", existing);
  const result = await context.openPptxExactPreview({ name:"a.pptx" }, new Uint8Array([1]), { sourceKey:"same" });
  assert.equal(result, existing);
  assert.equal(calls.convert, 0);
  assert.equal(calls.load, 0);
  assert.deepEqual(calls.active, [44]);
});

