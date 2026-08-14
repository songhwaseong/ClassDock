const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { decodeWorkspace, fingerprintBytes } = require("../src/js/core.js");

function loadBrowserScript(file, extra={}){
  const context = vm.createContext({ console, TextEncoder, Uint8Array, ArrayBuffer, DataView, Blob, ...extra });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8"), context, { filename:file });
  return context;
}

function pen(points=[{ x:1, y:2 }, { x:3, y:4 }]){
  return { type:"pen", color:"#111", width:2, points };
}

test(".lesson 입력은 정상 리플레이만 받아들이고 손상된 장면은 거부한다", () => {
  const { validateLessonPayload } = loadBrowserScript("lesson-replay.js");
  const valid = {
    format:"classdock-lesson", version:1, kind:"board", duration:120, W:1280, H:720,
    keyframes:[{ t:0, s:[] }, { t:120, a:pen() }]
  };
  assert.equal(validateLessonPayload(valid).ok, true);
  assert.equal(validateLessonPayload({ ...valid, version:2 }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, keyframes:[{ t:10, s:[] }, { t:5, a:pen() }] }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, keyframes:[{ t:0, s:[pen([{ x:1, y:"bad" }])] }] }).ok, false);
  assert.equal(validateLessonPayload({ ...valid, keyframes:new Array(100001).fill({ t:0, s:[] }) }).ok, false);

  const group = { type:"group",x:20,y:30,w:240,h:190,sourceW:240,sourceH:190,items:[
    { type:"line",x1:0,y1:0,x2:100,y2:100,color:"#111",width:2 },
    { type:"polyline",color:"#111",width:2,points:[{x:0,y:10},{x:50,y:20}] },
    { type:"text",x:20,y:30,text:"벡터",fontSize:18,color:"#111" }
  ] };
  assert.equal(validateLessonPayload({ ...valid, keyframes:[{ t:0, s:[group] }] }).ok, true);
  assert.equal(validateLessonPayload({ ...valid, keyframes:[{ t:0, s:[{ ...group, items:new Array(1001).fill(group.items[0]) }] }] }).ok, false);

  const shapeReplay = {
    format:"classdock-lesson", version:1, kind:"pdf-ink", duration:50,
    pages:{ 0:{ w:800, h:1200 } },
    keyframes:[{ t:50, p:0, a:{ tool:"mosaic", color:"#999", width:3, points:[{ x:10, y:20 }, { x:80, y:60 }] } }]
  };
  assert.equal(validateLessonPayload(shapeReplay).ok, true);
});

test("브라우저 작업공간은 새 경로를 병합하고 닫은 경로만 제거한다", () => {
  const store = loadBrowserScript("workspace-store.js", { WORKSPACE_CAP:256 * 1024 * 1024, decodeWorkspace });
  const before = store.encodeWorkspaceRows([
    { path:"class/a.py", bytes:Uint8Array.from([1]) },
    { path:"memo.txt", bytes:Uint8Array.from([2]) }
  ]);
  const incoming = store.encodeWorkspaceRows([
    { path:"class/a.py", bytes:Uint8Array.from([9]) },
    { path:"class/b.py", bytes:Uint8Array.from([3]) }
  ]);
  const merged = decodeWorkspace(store.mergeWorkspacePayloads(before, incoming));
  assert.deepEqual(merged.map(row => row.path), ["class/a.py", "memo.txt", "class/b.py"]);
  assert.deepEqual([...merged[0].bytes], [9]);
  const pruned = decodeWorkspace(store.removeWorkspacePayloadPaths(store.mergeWorkspacePayloads(before, incoming), ["memo.txt"]));
  assert.deepEqual(pruned.map(row => row.path), ["class/a.py", "class/b.py"]);
  assert.equal(store.removeWorkspacePayloadPaths(before, ["class/a.py", "memo.txt"]), null);
});

test("OCR 캐시는 전체 SHA-256과 버전으로 동일 크기 PDF를 구분한다", async () => {
  const ocr = loadBrowserScript("pdf-ocr.js", { crypto:webcrypto, fingerprintBytes });
  const first = new Uint8Array(70000).fill(7);
  const second = new Uint8Array(first);
  second[35000] = 8; // 기존 앞/뒤 표본 밖의 내용 차이
  const firstKey = await ocr.pdfOcrCacheKey({ name:"scan.pdf", pdfBytes:first.buffer });
  const secondKey = await ocr.pdfOcrCacheKey({ name:"scan.pdf", pdfBytes:second.buffer });
  const renamedKey = await ocr.pdfOcrCacheKey({ name:"renamed.pdf", pdfBytes:first.buffer });
  assert.match(firstKey, /^ocr:v2:sha256:[0-9a-f]{64}$/);
  assert.notEqual(firstKey, secondKey);
  assert.equal(firstKey, renamedKey);
});
