const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRestoreFunction(saved){
  const source = fs.readFileSync(path.join(__dirname, "../src/js/pdf-recovery.js"), "utf8");
  const start = source.indexOf("async function restorePdfRecovery");
  const end = source.indexOf("async function listSavedSignatures", start);
  assert.ok(start >= 0 && end > start, "PDF 복원 함수를 찾을 수 있어야 한다");
  const calls = [];
  const context = {
    appSettings: { pdfRecovery:true },
    PDF_RECOVERY_VERSION: 1,
    pdfRecoveryRequest: async () => saved,
    serializePdfOutline: () => [],
    restorePdfPageState: () => calls.push("pages"),
    restorePdfOutlineState: () => calls.push("outline"),
    hydratePdfElements: () => calls.push("elements"),
    updateDocumentStatus: () => calls.push("status"),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\n;globalThis.__restorePdfRecovery = restorePdfRecovery;", context);
  return { restorePdfRecovery:context.__restorePdfRecovery, calls };
}

test("PDF 자동 저장·복원은 확인창 없이 편집 상태를 바로 적용한다", async () => {
  const saved = {
    version:1,
    elements:[{ kind:"text" }],
    pages:[{ originalIndex:0, exportRotation:0 }],
    outline:[{ title:"목차", target:{ type:"page", pageIndex:0 }, children:[] }],
  };
  const { restorePdfRecovery, calls } = loadRestoreFunction(saved);
  const doc = {
    recoveryKey:"pdf:test",
    pages:[{ originalIndex:0, exportRotation:0 }],
    pdfOutline:[],
    recoveryDirty:true,
  };

  await restorePdfRecovery(doc);

  assert.deepEqual(calls, ["pages", "outline", "elements", "status"]);
  assert.equal(doc.recoveryDirty, false);
  assert.equal(doc._restoringRecovery, false);
});

test("복원할 PDF 편집 차이가 없으면 문서 상태를 변경하지 않는다", async () => {
  const saved = { version:1, elements:[], pages:[{ originalIndex:0, exportRotation:0 }], outline:[] };
  const { restorePdfRecovery, calls } = loadRestoreFunction(saved);
  const doc = { recoveryKey:"pdf:test", pages:[{ originalIndex:0, exportRotation:0 }], pdfOutline:[] };

  await restorePdfRecovery(doc);

  assert.deepEqual(calls, []);
});
