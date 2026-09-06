"use strict";

// 큰 원본 폴더는 파일 내용 대신 폴더 위치만 자동 복원에 담는다 — 실제 rememberWorkspace 를
// vm 으로 싣고 서버에 실제로 나간 바이너리를 뜯어서 확인한다(소스 문자열 단언이 아니다).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  decodeWorkspace, workspaceFolderMarkerPath, workspaceImageSkipMarkerPath,
  workspaceOriginalSaveMarkerPath, workspaceSourceSkipMarkerPath,
  workspaceFolderPathFromMarker, workspaceImageSkipFolderPath,
  workspaceOriginalSaveFolderPath, workspaceSourceSkipFolderPath
} = require("../src/js/core.js");

const MB = 1024 * 1024;
const normalizedRunPath = (p) => String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");

// 크기만 크고 바이트는 0인 가짜 파일 — buildWorkspacePayload 는 size 와 arrayBuffer() 만 본다.
function fakeFile(relPath, size){
  const bytes = new Uint8Array(size);
  const file = new File([bytes], relPath.split("/").pop());
  Object.defineProperty(file, "webkitRelativePath", { value:relPath });
  Object.defineProperty(file, "size", { value:size });
  return file;
}

function loadStore(options={}){
  const calls = { save:[], remove:[], toasts:[] };
  const context = vm.createContext({
    console, TextEncoder, Uint8Array, ArrayBuffer, DataView, Blob, File,
    Promise, Set, Map, setTimeout, clearTimeout, AbortController,
    WORKSPACE_CAP: 256 * MB,
    normalizedRunPath, decodeWorkspace,
    workspaceFolderMarkerPath, workspaceImageSkipMarkerPath,
    workspaceOriginalSaveMarkerPath, workspaceSourceSkipMarkerPath,
    workspaceFolderPathFromMarker, workspaceImageSkipFolderPath,
    workspaceOriginalSaveFolderPath, workspaceSourceSkipFolderPath,
    IMG_EXTS: ["png", "jpg", "jpeg", "gif"],
    isMediaFileName: (name) => /\.(mp4|wav|mp3)$/i.test(String(name || "")),
    docs: options.docs || [],
    // 위치만 기억하는 최적화는 런처가 실제 경로를 아는 EXE 에서만 켜진다.
    nativeSourceSupported: async () => options.nativeSourceSupported !== false,
    byId: () => null,
    location: { protocol:"http:" },
    window: { __tabActive:true, dispatchEvent(){} },
    toast: (message) => calls.toasts.push(String(message)),
    showLoading(){}, updateLoading(){}, hideLoading(){},
    async fetch(url, init={}){
      if (url === "/can-save-file") return { ok:true, text: async () => "yes" };
      if (String(url).startsWith("/local-file")) return { ok:false, status:404 };
      if (String(url).startsWith("/workspace-save")){
        calls.save.push({ url, body: new Uint8Array(init.body) });
        return { ok:true, text: async () => "1" };
      }
      if (String(url) === "/workspace-remove"){
        calls.remove.push(new Uint8Array(init.body));
        return { ok:true, text: async () => "1" };
      }
      throw new Error("unexpected fetch: " + url);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js/workspace-store.js"), "utf8"),
    context, { filename:"workspace-store.js" });
  return { context, calls };
}

// /workspace-remove 본문(경로 목록 바이너리) → 경로 배열
function decodePathList(body){
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const dec = new TextDecoder();
  let pos = 0;
  const count = view.getUint32(pos, true); pos += 4;
  const out = [];
  for (let i = 0; i < count; i++){
    const len = view.getUint32(pos, true); pos += 4;
    out.push(dec.decode(body.subarray(pos, pos + len))); pos += len;
  }
  return out;
}

function savedPaths(calls){
  assert.equal(calls.save.length, 1);
  return decodeWorkspace(calls.save[0].body).map(row => row.path);
}

test("64MB 넘는 원본 저장 폴더는 파일 내용 대신 폴더 위치만 자동 복원에 담는다", async () => {
  const { context, calls } = loadStore();
  const files = [
    fakeFile("수업자료/큰파일.pdf", 70 * MB),
    fakeFile("수업자료/코드/a.py", 2048)
  ];
  const ok = await context.rememberWorkspace(files, true, {
    silent:true, folderPaths:["수업자료", "수업자료/코드"], originalSaveFolderPaths:["수업자료"]
  });
  assert.equal(ok, true);

  const paths = savedPaths(calls);
  // 파일 바이트는 하나도 담기지 않고, 폴더 구조와 표식만 남는다.
  assert.deepEqual(paths.filter(p => !p.includes("classdock-")), []);
  assert.ok(paths.includes(workspaceFolderMarkerPath("수업자료")));
  assert.ok(paths.includes(workspaceFolderMarkerPath("수업자료/코드")));
  assert.ok(paths.includes(workspaceOriginalSaveMarkerPath("수업자료")));
  assert.ok(paths.includes(workspaceSourceSkipMarkerPath("수업자료")));
  // 저장 묶음 자체가 몇 KB 로 줄어 WORKSPACE_CAP 을 넘길 여지가 사라진다.
  assert.ok(calls.save[0].body.length < 64 * 1024, "payload=" + calls.save[0].body.length);
  assert.match(calls.toasts.join("\n"), /폴더 위치만 기억/);

  // 예전 저장(병합)에 남아 있던 같은 폴더의 바이트도 함께 지운다.
  await new Promise(resolve => setTimeout(resolve, 200));
  const removed = calls.remove.flatMap(decodePathList);
  assert.ok(removed.includes("수업자료/큰파일.pdf"));
  assert.ok(removed.includes("수업자료/코드/a.py"));
  assert.ok(!removed.includes(workspaceSourceSkipMarkerPath("수업자료")));
});

test("작은 원본 폴더와 핸들 없는 폴더는 예전처럼 파일 내용을 담는다", async () => {
  const small = loadStore();
  await small.context.rememberWorkspace([fakeFile("수업/a.py", 1024), fakeFile("수업/b.py", 2048)],
    true, { silent:true, folderPaths:["수업"], originalSaveFolderPaths:["수업"] });
  const smallPaths = savedPaths(small.calls);
  assert.ok(smallPaths.includes("수업/a.py"));
  assert.ok(!smallPaths.includes(workspaceSourceSkipMarkerPath("수업")));

  // 원본 저장 모드가 아닌 폴더(드래그·폴더 선택 폴백)는 디스크에서 다시 읽을 방법이 없으므로 그대로 담는다.
  const big = loadStore();
  await big.context.rememberWorkspace([fakeFile("사진첩/원본.pdf", 70 * MB)],
    true, { silent:true, folderPaths:["사진첩"] });
  const bigPaths = savedPaths(big.calls);
  assert.ok(bigPaths.includes("사진첩/원본.pdf"));
  assert.ok(!bigPaths.includes(workspaceSourceSkipMarkerPath("사진첩")));
});

test("권한창 없이 다시 읽을 수 없는 환경(브라우저)에서는 큰 폴더도 그대로 담는다", async () => {
  const { context, calls } = loadStore({ nativeSourceSupported:false });
  await context.rememberWorkspace([fakeFile("수업자료/큰파일.pdf", 70 * MB)],
    true, { silent:true, folderPaths:["수업자료"], originalSaveFolderPaths:["수업자료"] });
  const paths = savedPaths(calls);
  assert.ok(paths.includes("수업자료/큰파일.pdf"), "다시 읽을 방법이 없으면 바이트를 담아야 한다");
  assert.ok(!paths.includes(workspaceSourceSkipMarkerPath("수업자료")));
});

test("저장하지 않은 편집본은 큰 원본 폴더에서도 바이트를 남긴다", async () => {
  const { context, calls } = loadStore({
    docs:[{ workspacePath:"수업자료/코드/a.py", hasUnsavedEdits:true }]
  });
  await context.rememberWorkspace(
    [fakeFile("수업자료/큰파일.pdf", 70 * MB), fakeFile("수업자료/코드/a.py", 2048)],
    true, { silent:true, folderPaths:["수업자료"], originalSaveFolderPaths:["수업자료"] });

  const paths = savedPaths(calls);
  assert.ok(paths.includes("수업자료/코드/a.py"), "저장 안 한 편집본은 남아야 한다");
  assert.ok(!paths.includes("수업자료/큰파일.pdf"));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(!calls.remove.flatMap(decodePathList).includes("수업자료/코드/a.py"));
});

test("복원은 폴더 위치 표식을 읽어 폴더만 되살리고 남은 편집본은 복구본으로 표시한다", async () => {
  const { context } = loadStore();
  const payload = context.encodeWorkspaceRows([
    { path:workspaceFolderMarkerPath("수업자료"), bytes:new Uint8Array(0) },
    { path:workspaceFolderMarkerPath("수업자료/코드"), bytes:new Uint8Array(0) },
    { path:workspaceOriginalSaveMarkerPath("수업자료"), bytes:new Uint8Array(0) },
    { path:workspaceSourceSkipMarkerPath("수업자료"), bytes:new Uint8Array(0) },
    { path:"수업자료/코드/a.py", bytes:new TextEncoder().encode("print(1)") }
  ]);
  const parsed = await context.parseWorkspacePayload(payload);
  // vm 실행 결과의 배열은 realm 이 달라 deepEqual 이 실패한다 — 이 realm 배열로 옮겨 비교한다.
  assert.deepEqual([...parsed.sourceSkipFolderPaths], ["수업자료"]);
  assert.deepEqual([...parsed.folderPaths], ["수업자료", "수업자료/코드"]);
  // 표식은 파일 목록에 섞이지 않는다 — 사이드바에 이상한 이름이 뜨지 않게.
  assert.deepEqual([...parsed.rows].map(row => row.path), ["수업자료/코드/a.py"]);
});

test("표식 경로 헬퍼는 서로를 오인하지 않는다", () => {
  const folder = "수업자료";
  const markers = [workspaceFolderMarkerPath(folder), workspaceImageSkipMarkerPath(folder),
    workspaceOriginalSaveMarkerPath(folder), workspaceSourceSkipMarkerPath(folder)];
  assert.equal(new Set(markers).size, 4);
  assert.equal(workspaceSourceSkipFolderPath(markers[3]), folder);
  assert.equal(workspaceSourceSkipFolderPath(markers[0]), "");
  assert.equal(workspaceFolderPathFromMarker(markers[3]), "");
  assert.equal(workspaceImageSkipFolderPath(markers[3]), "");
  assert.equal(workspaceOriginalSaveFolderPath(markers[3]), "");
});
