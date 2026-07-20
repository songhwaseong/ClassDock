"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadExportPdf(overrides = {}){
  const source = fs.readFileSync(path.join(__dirname, "../src/js/pdf-editor.js"), "utf8");
  const start = source.indexOf("let pdfExportActive = false;");
  const end = source.indexOf("/* ===== 서명 패드 ===== */", start);
  assert.ok(start >= 0 && end > start, "exportPdf source block");

  const button = {
    disabled:false,
    setAttribute(){},
    removeAttribute(){}
  };
  const context = vm.createContext({
    console,
    File: class {
      constructor(parts, name, options){
        this.parts = parts;
        this.name = name;
        this.type = options && options.type;
        this.size = parts.reduce((sum, part) => sum + (part.byteLength || part.length || 0), 0);
      }
    },
    byId:() => button,
    toast:() => {},
    downloadPdfBytes:() => {},
    ...overrides
  });
  vm.runInContext(
    source.slice(start, end) + "\n;globalThis.__pdfExportTest = { exportPdf };",
    context,
    { filename:"pdf-editor-export.js" }
  );
  return { context, exportPdf:context.__pdfExportTest.exportPdf, button };
}

test("PDF 저장 중 다른 탭으로 전환해도 저장 대상 문서를 바꾸지 않는다", async () => {
  const pdfDoc = {
    id:11,
    kind:"pdf",
    fileName:"notes.pdf",
    workspacePath:"work/notes.pdf",
    originalSaveMode:true,
    elements:[],
    pdfOutline:[],
    recoveryKey:"pdf-recovery",
    recoveryDirty:true
  };
  const csvDoc = {
    id:22,
    kind:"office",
    name:"data.csv",
    fileName:"data.csv",
    originalSaveMode:true
  };
  const saved = [];
  const refreshed = [];
  let context;
  ({ context } = loadExportPdf({
    buildPdfBytes:async (doc) => {
      assert.equal(doc, pdfDoc);
      context.state = csvDoc;
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    },
    saveViaFileHandle:async (bytes, name, ownerDoc) => {
      saved.push({ bytes:Array.from(bytes), name, ownerDoc });
      return "saved";
    },
    rememberWorkspace:async () => true,
    deletePdfRecovery:async () => {},
    updateDocumentStatus:() => {},
    refreshDocFromSource:async (id) => { refreshed.push(id); }
  }));
  context.state = pdfDoc;

  await context.__pdfExportTest.exportPdf();

  assert.equal(context.state, csvDoc, "테스트 중 활성 탭은 CSV로 전환된다");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].ownerDoc, pdfDoc);
  assert.equal(saved[0].name, "notes.pdf");
  assert.deepEqual(saved[0].bytes, [0x25, 0x50, 0x44, 0x46]);
  assert.deepEqual(refreshed, [pdfDoc.id]);
  assert.equal(pdfDoc.recoveryDirty, false);
  assert.equal(csvDoc.recoveryDirty, undefined);
});
