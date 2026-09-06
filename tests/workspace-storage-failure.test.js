"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { decodeWorkspace } = require("../src/js/core.js");
const source = fs.readFileSync(path.join(__dirname, "../src/js/workspace-store.js"), "utf8");

// IndexedDB 요청 경계만 대체하고 Blob 읽기·병합·삭제·작업 큐는 실제 코드를 실행한다.
function memoryWorkspace(){
  const notices = [];
  const context = vm.createContext({
    Blob, TextEncoder, TextDecoder, decodeWorkspace, clearTimeout,
    WORKSPACE_CAP:512 * 1024 * 1024,
    console:{ warn(){} }, toast:message => notices.push(message)
  });
  new vm.Script(source, { filename:"workspace-store.js" }).runInContext(context);
  const encode = rows => context.encodeWorkspaceRows(Object.entries(rows)
    .map(([path, text]) => ({ path, bytes:new TextEncoder().encode(text) })));
  let record = { blob:new Blob([encode({ "old.txt":"original" })]) };
  let readError = null, reads = 0, writes = 0;
  context.wsIdbRequest = async (mode, run) => {
    if (mode === "readonly"){
      reads++;
      if (readError) throw readError;
    }
    return run({
      get:() => ({ result:record }),
      put:value => { writes++; record = value; return {}; },
      delete:() => { writes++; record = undefined; return {}; }
    }).result;
  };
  return {
    context, encode, notices,
    get record(){ return record; },
    set record(value){ record = value; },
    get reads(){ return reads; },
    get writes(){ return writes; },
    set readError(value){ readError = value; },
    async contents(){
      if (!record) return null;
      return Object.fromEntries(decodeWorkspace(new Uint8Array(await record.blob.arrayBuffer()))
        .map(row => [row.path, new TextDecoder().decode(row.bytes)]));
    }
  };
}

for (const operation of ["save", "remove"]){
  for (const failure of ["request", "blob"]){
    test(operation + ": " + failure + " 읽기 실패 시 기존 데이터를 보존하고 실패를 전달한다", async () => {
      const storage = memoryWorkspace(), error = new Error("read-failed");
      if (failure === "request") storage.readError = error;
      else storage.record = { blob:{ arrayBuffer:async () => { throw error; } } };
      const before = storage.record;
      const action = operation === "save"
        ? () => storage.context.browserWorkspaceSave(storage.encode({ "new.txt":"new" }), false)
        : () => storage.context.browserWorkspaceRemove(["old.txt"], false);
      await assert.rejects(action, thrown => thrown === error);
      assert.equal(storage.writes, 0);
      assert.equal(storage.record, before);
    });
  }
}

test("최초 저장·같은 경로 갱신·선택 삭제·마지막 삭제는 기존 규칙을 유지한다", async () => {
  const storage = memoryWorkspace();
  storage.record = undefined;
  await storage.context.browserWorkspaceSave(storage.encode({ "a.txt":"A", "b.txt":"B" }), false);
  await storage.context.browserWorkspaceSave(storage.encode({ "a.txt":"updated", "c.txt":"C" }), false);
  assert.deepEqual(await storage.contents(), { "a.txt":"updated", "b.txt":"B", "c.txt":"C" });
  await storage.context.browserWorkspaceRemove(["b.txt", "missing.txt"], false);
  assert.deepEqual(await storage.contents(), { "a.txt":"updated", "c.txt":"C" });
  await storage.context.browserWorkspaceRemove(["a.txt", "c.txt"], false);
  assert.equal(await storage.contents(), null);
  const writes = storage.writes;
  await storage.context.browserWorkspaceRemove(["missing.txt"], false);
  assert.equal(storage.writes, writes);
});

test("명시적 전체 교체와 전체 삭제는 이전 데이터를 읽지 않는다", async () => {
  const storage = memoryWorkspace();
  storage.readError = new Error("must-not-read");
  await storage.context.browserWorkspaceSave(storage.encode({ "replacement.txt":"R" }), true);
  assert.deepEqual(await storage.contents(), { "replacement.txt":"R" });
  await storage.context.browserWorkspaceRemove([], true);
  assert.equal(await storage.contents(), null);
  assert.equal(storage.reads, 0);
});

test("실패한 병합 뒤에도 작업 큐는 다음 저장을 진행하며 기존 파일을 보존한다", async () => {
  const storage = memoryWorkspace(), error = new Error("temporary-read-error");
  storage.readError = error;
  await assert.rejects(storage.context.queueWorkspaceMutation(() =>
    storage.context.browserWorkspaceSave(storage.encode({ "failed.txt":"F" }), false)), thrown => thrown === error);
  storage.readError = null;
  await storage.context.queueWorkspaceMutation(() =>
    storage.context.browserWorkspaceSave(storage.encode({ "next.txt":"N" }), false));
  assert.deepEqual(await storage.contents(), { "old.txt":"original", "next.txt":"N" });
  assert.equal(storage.writes, 1);
});

test("닫은 파일 정리의 읽기 실패는 성공으로 숨기지 않고 기존 안내를 표시한다", async () => {
  const storage = memoryWorkspace();
  storage.readError = new Error("read-failed");
  storage.context.workspaceBackendAvailable = async () => false;
  storage.context.setWorkspaceActivity = () => {};
  vm.runInContext('pendingWorkspaceRemovals.add("old.txt")', storage.context);
  assert.equal(await storage.context.flushWorkspaceRemovals(), false);
  assert.equal(storage.writes, 0);
  assert.deepEqual(await storage.contents(), { "old.txt":"original" });
  assert.equal(storage.notices.length, 1);
  assert.match(storage.notices[0], /최근 작업공간에서 제거하지 못했어요/);
});
