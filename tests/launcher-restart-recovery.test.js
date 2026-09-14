"use strict";

// ClassDock.exe 가 다시 시작돼 토큰·원본 폴더 번호가 바뀌어도, 이미 열린 창이 새로고침 없이 저장을 이어 가는지 본다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const stateSync = fs.readFileSync(path.join(root, "src/js/state-sync.js"), "utf8");
const loaders = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
const launcher = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");

// 새로 시작한 런처처럼 동작하는 가짜 서버. 토큰이 틀리면 403, 모르는 폴더 번호면 409 로 답한다.
function fakeLauncher(){
  const server = { token:"new-token", folders:new Map([["new-root", "C:\\수업"]]), calls:[], writes:[] };
  server.fetch = async (url, init={}) => {
    const headers = new Headers(init.headers);
    const address = new URL(url, "http://127.0.0.1:17645/");
    server.calls.push({ path:address.pathname, token:headers.get("X-ClassDock-Token") });
    if (address.pathname === "/local-token"){
      if (headers.get("X-ClassDock-Action") !== "1") return new Response("action-header-required", { status:403 });
      return new Response(JSON.stringify({ token:server.token }), { status:200 });
    }
    if (headers.get("X-ClassDock-Token") !== server.token) return new Response("local-token-required", { status:403 });
    if (address.pathname === "/source-folder-restore"){
      const folder = String(init.body || "");
      for (const [id, value] of server.folders) if (value === folder) return new Response(JSON.stringify({ id, path:value }), { status:200 });
      return new Response("source-folder-not-remembered", { status:403 });
    }
    if (address.pathname.startsWith("/source-folder-")){
      if (!server.folders.has(address.searchParams.get("id"))) return new Response("source-folder-unknown", { status:409 });
      if (address.pathname === "/source-folder-entry"){
        const name = String(address.searchParams.get("path") || "").split("/").pop();
        return new Response(JSON.stringify({ kind:"file", name, size:0, lastModified:0 }), { status:200 });
      }
      if (address.pathname === "/source-folder-file" && init.method === "POST"){
        server.writes.push({ id:address.searchParams.get("id"), path:address.searchParams.get("path"), size:init.body.byteLength });
      }
      return new Response("ok", { status:200 });
    }
    return new Response("ok", { status:200 });
  };
  return server;
}

function bootStateSync(server, pageToken){
  const window = { __CLASSDOCK_LOCAL_TOKEN__:pageToken, fetch:server.fetch, addEventListener(){} };
  class XHR { open(){} setRequestHeader(){} send(){ this.status = 500; } }
  const context = vm.createContext({
    window, XMLHttpRequest:XHR, URL, Headers, Response, ReadableStream, localStorage:{},
    location:{ protocol:"http:", hostname:"127.0.0.1", origin:"http://127.0.0.1:17645", href:"http://127.0.0.1:17645/" },
    setTimeout, clearTimeout
  });
  window.XMLHttpRequest = XHR;
  vm.runInContext(stateSync, context);
  return window;
}

test("런처 재시작으로 토큰이 바뀌면 새 토큰을 한 번만 받아 와 요청을 다시 보낸다", async () => {
  const server = fakeLauncher();
  const window = bootStateSync(server, "old-token");
  const [first, second] = await Promise.all([
    window.fetch("/save-file", { method:"POST", body:"a" }),
    window.fetch("/heartbeat?id=x", { method:"POST" })
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(server.calls.filter(call => call.path === "/local-token").length, 1);
  assert.equal(window.__CLASSDOCK_LOCAL_TOKEN__, "new-token");
  // 이후 요청은 처음부터 새 토큰으로 간다.
  server.calls.length = 0;
  assert.equal((await window.fetch("/ping")).status, 200);
  assert.deepEqual(server.calls.map(call => call.token), ["new-token"]);
});

test("다시 보낼 수 없는 요청·호출자가 토큰을 직접 넣은 요청은 재시도하지 않는다", async () => {
  const server = fakeLauncher();
  const window = bootStateSync(server, "old-token");
  const stream = new ReadableStream({ start(controller){ controller.close(); } });
  const streamed = await window.fetch("/save-file", { method:"POST", body:stream, duplex:"half" });
  assert.equal(streamed.status, 403);
  const explicit = await window.fetch("/save-file", { method:"POST", headers:{ "X-ClassDock-Token":"mine" } });
  assert.equal(explicit.status, 403);
  assert.equal(server.calls.filter(call => call.path === "/local-token").length, 0);
});

function loadNativeHandles(server){
  const start = loaders.indexOf("function nativeSourceUrl(");
  const end = loaders.indexOf("async function chooseNativeSourceFolder(");
  assert.ok(start > 0 && end > start, "native handle source block not found");
  // 토큰은 state-sync.js 의 fetch 래퍼가 맡는다(위 테스트). 여기서는 이미 새 토큰을 붙여 보내는 상태로 둔다.
  const fetchWithToken = (url, init={}) => {
    const headers = new Headers(init.headers);
    headers.set("X-ClassDock-Token", server.token);
    return server.fetch(url, { ...init, headers });
  };
  const context = vm.createContext({ fetch:fetchWithToken, Headers, Response, URL, DOMException, TextEncoder, Blob, File, Uint8Array, ArrayBuffer, Date, JSON });
  vm.runInContext(loaders.slice(start, end) + "\nglobalThis.NativeDir = NativeSourceDirectoryHandle;", context);
  return context;
}

test("런처가 모르는 원본 폴더 번호면 경로로 다시 연결해 한 번 재시도하고, 같은 폴더의 다른 핸들도 새 번호를 쓴다", async () => {
  const server = fakeLauncher();
  const context = loadNativeHandles(server);
  const rootHandle = new context.NativeDir("stale-root", "C:\\수업");
  const fileHandle = await rootHandle.getFileHandle("성적.xlsx");
  const writable = await fileHandle.createWritable();
  await writable.write(new Uint8Array([1, 2, 3]));
  await writable.close();
  assert.deepEqual(server.writes, [{ id:"new-root", path:"성적.xlsx", size:3 }]);
  assert.equal(server.calls.filter(call => call.path === "/source-folder-restore").length, 1);
  // 예전 번호를 가진 다른 핸들도 다시 연결하지 않고 새 번호로 바로 간다.
  const sibling = new context.NativeDir("stale-root", "C:\\수업");
  await sibling.getFileHandle("출석.xlsx");
  assert.equal(server.calls.filter(call => call.path === "/source-folder-restore").length, 1);
  assert.equal(sibling.rootId, "new-root");
});

test("기억하지 않은 폴더는 다시 연결하지 않고 원래 오류를 그대로 알린다", async () => {
  const server = fakeLauncher();
  const context = loadNativeHandles(server);
  const handle = new context.NativeDir("stale-root", "D:\\모르는폴더");
  await assert.rejects(handle.getFileHandle("a.txt"), (error) => error.sourceFolderUnknown === true);
});

test("런처는 새 토큰 입구를 사용자 정의 헤더로만 열고, 모르는 폴더 번호를 잘못된 경로와 구분한다", () => {
  assert.match(launcher, /method == "GET" && path == "\/local-token"\)\s*\{[\s\S]{0,600}?if \(!HasLocalActionHeader\(headers\)\)/);
  assert.match(launcher, /IsSourceFolderIdRoute\(path\) && !IsKnownSourceFolder\(QueryValue\(path, "id"\)\)[\s\S]{0,400}?"409 Conflict"[\s\S]{0,120}?source-folder-unknown/);
});
