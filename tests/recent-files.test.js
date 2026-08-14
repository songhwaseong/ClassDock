const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// MNRecent 는 localStorage 와 CustomEvent 만 있으면 동작하는 순수 목록 관리 계층이다.
// (실제 파일 열기는 File System Access 핸들이 필요해 e2e 에서 다룬다.)
function loadRecent(mocks={}){
  const store = new Map();
  const events = [];
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  global.CustomEvent = class { constructor(type){ this.type = type; } };
  global.window = { dispatchEvent: (e) => events.push(e.type) };
  for (const name of [
    "loadFsHandle", "restoreNativeSourceFolder", "ensureReadPermission", "collectDirectoryHandleFiles",
    "openFolderFiles", "classifyRelatedFolderRoots", "requestFolderRefresh", "ensureFolderWriteAccess",
    "rememberFolderHandle", "absorbContainedFolderRoots"
  ]) delete global[name];
  Object.assign(global, mocks);
  delete require.cache[require.resolve("../src/js/recent-files.js")];
  const MNRecent = require(path.join("..", "src", "js", "recent-files.js"));
  return { MNRecent, store, events };
}

test("최근 목록은 최신 항목이 맨 앞에 온다", () => {
  const { MNRecent } = loadRecent();
  MNRecent.rememberFile("a.py", "a.py");
  MNRecent.rememberFile("b.py", "b.py");
  MNRecent.rememberFolder("수업자료");
  assert.deepEqual(MNRecent.list().map((row) => row.name), ["수업자료", "b.py", "a.py"]);
  assert.deepEqual(MNRecent.list().map((row) => row.type), ["folder", "file", "file"]);
});

test("같은 항목을 다시 열면 중복되지 않고 맨 위로 올라간다", () => {
  const { MNRecent } = loadRecent();
  MNRecent.rememberFile("a.py", "a.py");
  MNRecent.rememberFile("b.py", "b.py");
  MNRecent.rememberFile("a.py", "a.py");
  assert.deepEqual(MNRecent.list().map((row) => row.name), ["a.py", "b.py"]);
});

test("같은 이름이라도 경로가 다르면 서로 다른 항목이다", () => {
  const { MNRecent } = loadRecent();
  MNRecent.rememberFile("main.py", "수업1/main.py");
  MNRecent.rememberFile("main.py", "수업2/main.py");
  assert.equal(MNRecent.list().length, 2);
});

test("파일과 폴더는 이름이 같아도 구분한다", () => {
  const { MNRecent } = loadRecent();
  MNRecent.rememberFile("수업", "수업");
  MNRecent.rememberFolder("수업");
  assert.equal(MNRecent.list().length, 2);
});

test("목록은 상한을 넘지 않고 오래된 항목부터 밀려난다", () => {
  const { MNRecent } = loadRecent();
  for (let i = 0; i < MNRecent.LIMIT + 5; i++) MNRecent.rememberFile("f" + i + ".py", "f" + i + ".py");
  const rows = MNRecent.list();
  assert.equal(rows.length, MNRecent.LIMIT);
  assert.equal(rows[0].name, "f" + (MNRecent.LIMIT + 4) + ".py");
  assert.ok(!rows.some((row) => row.name === "f0.py"));
});

test("항목 지우기와 전체 지우기는 목록에만 영향을 준다", () => {
  const { MNRecent } = loadRecent();
  MNRecent.rememberFile("a.py", "a.py");
  MNRecent.rememberFolder("수업자료");
  MNRecent.forget("file", "a.py");
  assert.deepEqual(MNRecent.list().map((row) => row.name), ["수업자료"]);
  MNRecent.clear();
  assert.deepEqual(MNRecent.list(), []);
});

test("이름 없는 항목은 기록하지 않고, 경로가 없으면 파일명을 경로로 쓴다", () => {
  const { MNRecent } = loadRecent();
  MNRecent.rememberFile("", "a.py");        // 이름이 없으면 목록에 남길 이유가 없다
  MNRecent.rememberFile("   ", "   ");
  assert.deepEqual(MNRecent.list(), []);
  // 폴더 밖에서 낱개로 연 파일은 작업공간 경로가 파일명과 같다 — 이름으로 폴백한다.
  MNRecent.rememberFile("a.py", "");
  assert.deepEqual(MNRecent.list().map((row) => row.path), ["a.py"]);
});

test("저장값이 깨져 있어도 빈 목록으로 안전하게 시작한다", () => {
  const { MNRecent, store } = loadRecent();
  store.set("mn.recentItems", "{망가진 JSON");
  assert.deepEqual(MNRecent.list(), []);
  store.set("mn.recentItems", JSON.stringify([{ name: "a.py" }, null, { path: "b.py" }, { name: "c.py", path: "c.py" }]));
  assert.deepEqual(MNRecent.list().map((row) => row.name), ["c.py"]);
});

test("목록이 바뀌면 화면이 다시 그릴 수 있게 알린다", () => {
  const { MNRecent, events } = loadRecent();
  MNRecent.rememberFile("a.py", "a.py");
  MNRecent.forget("file", "a.py");
  MNRecent.clear();
  assert.deepEqual(events, ["mnrecentchange", "mnrecentchange", "mnrecentchange"]);
});

test("EXE 최근 폴더는 IndexedDB 핸들이 없어도 기억한 실제 경로로 복원한다", async () => {
  let opened = null;
  const nativeHandle = { kind:"directory", name:"수업자료", __classdockNativeHandle:true };
  const { MNRecent } = loadRecent({
    loadFsHandle: async () => null,
    restoreNativeSourceFolder: async (name) => {
      assert.equal(name, "수업자료");
      return nativeHandle;
    },
    ensureReadPermission: async () => true,
    ensureFolderWriteAccess: async () => {},
    classifyRelatedFolderRoots: async () => ({ same:null, child:null, parents:[] }),
    collectDirectoryHandleFiles: async () => ({ files:[], folderPaths:["수업자료"] }),
    openFolderFiles: async (files, options) => { opened = { files, options }; }
  });
  const result = await MNRecent.open({ type:"folder", name:"수업자료", path:"수업자료" });
  assert.equal(result, "opened");
  assert.deepEqual(opened.files, []);
  assert.equal(opened.options.folderHandle, nativeHandle);
  assert.equal(opened.options.originalSaveMode, true);
});

test("이미 열린 최근 폴더는 중복으로 열지 않고 기존 트리를 동기화한다", async () => {
  let refreshed = 0;
  const handle = { kind:"directory", name:"수업자료" };
  const root = { nodeId:"root-1", name:"수업자료", folderHandle:handle, originalSaveMode:true };
  const { MNRecent } = loadRecent({
    loadFsHandle: async () => handle,
    ensureReadPermission: async () => true,
    ensureFolderWriteAccess: async () => {},
    classifyRelatedFolderRoots: async () => ({ same:root, child:null, parents:[] }),
    requestFolderRefresh: async (id) => { assert.equal(id, root.nodeId); refreshed++; },
    rememberFolderHandle: () => {},
    collectDirectoryHandleFiles: async () => { throw new Error("새 트리를 읽으면 안 됨"); },
    openFolderFiles: async () => { throw new Error("새 트리를 열면 안 됨"); }
  });
  assert.equal(await MNRecent.open({ type:"folder", name:"수업자료", path:"수업자료" }), "opened");
  assert.equal(refreshed, 1);
});

test("네이티브 낱개 핸들은 다시 열 수 없으므로 최근 파일로 기록하지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/file-loaders.js"), "utf8");
  assert.match(source, /opts\.fsHandle && !opts\.fsHandle\.__classdockNativeHandle[\s\S]*MNRecent\.rememberFile/);
});
