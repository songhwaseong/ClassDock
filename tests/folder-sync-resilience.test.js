// 폴더 동기화가 "전부 아니면 전무"로 실패하던 문제의 회귀 방지.
// 실행 중인 파이썬이 잡고 있는 로그 파일 하나 때문에 폴더 전체 동기화가 취소되고
// (InvalidStateError), 파일마다 로컬 HTTP 연결을 새로 열어 소켓이 고갈되던
// (ERR_NO_BUFFER_SPACE) 두 경로를 함께 막는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const loaders = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
const launcher = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");

function loadWorkspaceRetentionHelpers(){
  const context = vm.createContext({
    console, Blob, File, URL, TextDecoder, TextEncoder, DOMException,
    window:{}, localStorage:{ getItem:() => null, setItem(){} },
    normalizedRunPath:(value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "")
  });
  new vm.Script(loaders, { filename:"file-loaders.js" }).runInContext(context);
  return new vm.Script("({ unreadable:folderSyncUnreadablePath, retained:retainedWorkspacePathsForSkipped })")
    .runInContext(context);
}

test("서버는 다른 프로세스가 쓰기로 잡은 파일도 공유 모드로 읽는다", () => {
  // File.ReadAllBytes 는 FileShare.Read 라 실행 중인 파이썬의 로그 파일에서 공유 위반이 났다.
  assert.match(launcher, /static byte\[\] ReadAllBytesShared\(string path\)/);
  assert.match(launcher, /FileShare\.ReadWrite \| FileShare\.Delete/);
  const body = launcher.slice(launcher.indexOf("static byte[] ReadSourceFolderFile"));
  assert.match(body.slice(0, 500), /return ReadAllBytesShared\(full\);/);
  assert.doesNotMatch(body.slice(0, 500), /File\.ReadAllBytes\(full\)/);
});

test("파일 하나를 읽지 못해도 폴더 스캔 전체를 버리지 않는다", () => {
  assert.match(loaders, /try \{ file = await item\.entry\.getFile\(\); \}/);
  assert.match(loaders, /skipped\.push\(\{ path: relPath, kind:"file" \}\)/);
  // 취소만은 그대로 위로 던져야 '동기화를 취소했어요' 안내가 유지된다.
  assert.match(loaders, /if \(error && error\.message === "operation-cancelled"\) throw error;/);
  assert.match(loaders, /return \{ files: collected\.filter\(Boolean\), folderPaths, skipped \};/);
});

test("하위 폴더 목록 읽기 실패도 그 폴더만 건너뛴다", () => {
  assert.match(loaders, /skipped\.push\(\{ path, kind:"directory" \}\)/);
  // 목록 수집과 재귀를 분리해야 깊은 곳의 실패가 형제 항목까지 삼키지 않는다.
  assert.match(loaders, /const children = \[\];[\s\S]*?for await \(const entry of dir\.values\(\)\)/);
  assert.match(loaders, /for \(const entry of children\)\{/);
});

test("읽지 못한 파일·폴더는 문서와 자동 복원 정리에서 모두 보존한다", () => {
  const { unreadable, retained } = loadWorkspaceRetentionHelpers();
  const skippedFiles = new Set(["proj/active.log"]);
  const skippedDirs = ["proj/data"];
  const oldPaths = [
    "proj/main.py", "proj/active.log", "proj/data/model.bin",
    "proj/data/nested/.classdock-folder-keep-9f4d2a7b", "proj/other.txt"
  ];

  assert.equal(unreadable("proj/active.log", skippedFiles, skippedDirs), true);
  assert.equal(unreadable("proj/data/model.bin", skippedFiles, skippedDirs), true);
  assert.equal(unreadable("proj/other.txt", skippedFiles, skippedDirs), false);
  assert.deepEqual(Array.from(retained(oldPaths, skippedFiles, skippedDirs)), [
    "proj/active.log", "proj/data/model.bin", "proj/data/nested/.classdock-folder-keep-9f4d2a7b"
  ]);
  assert.match(loaders,
    /const unreadable = \(key\) => folderSyncUnreadablePath\(key, skippedFiles, skippedDirs\)/);
  assert.match(loaders, /retainedWorkspacePaths\.forEach\(path => nextPathSet\.add\(path\)\)/);
  assert.match(loaders, /reportSkippedFolderEntries\(snapshot\.skipped\)/);
});

test("읽지 못한 이전 바이트는 새 Python 실행 묶음으로 병합한다", () => {
  assert.match(loaders,
    /previousFolderCtx\.copyTo\(folderCtx, unreadable\)/);
  assert.match(loaders,
    /\(doc\.isScratch && !doc\._named\) \|\| unreadable\(docKeyOf\(doc\)\)/);
});

test("크기·수정시각이 그대로면 기존 스냅샷을 재사용해 다시 읽지 않는다", () => {
  assert.match(loaders, /function folderSnapshotReuseMap\(rootId\)/);
  assert.match(loaders, /function reusableSnapshotFile\(reuse, relPath, meta\)/);
  assert.match(loaders, /let file = reusableSnapshotFile\(reuse, relPath, item\.entry\.meta\);/);
  assert.match(loaders, /collectDirectoryHandleFiles\(handle, \{ reuseFiles \}\)/);
  // 네이티브 목록이 주는 메타가 재사용 판정의 근거다.
  assert.match(loaders, /new NativeSourceFileHandle\(this\.rootId, this\.rootPath, rel, item\)/);
});
