const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const launcher = read("desktop/launcher.cs");
const viewer = read("src/js/viewer-base.js");
const loaders = read("src/js/file-loaders.js");
const workspace = read("src/js/workspace-store.js");

test("SQLite 편집은 서버가 확인한 디스크 경로에서만 활성화된다", () => {
  assert.match(viewer, /doc\.dbPath = options\.sqliteDiskPath \|\| null/);
  assert.doesNotMatch(viewer, /doc\.dbPath = options\.(workspacePath|relPath)/);
  assert.match(loaders, /sqliteDiskPath: options\.sqliteDiskPath \|\| file\.__sqliteDiskPath \|\| null/);
  assert.match(workspace, /Object\.defineProperty\(file, "__sqliteDiskPath", \{ value:path \}\)/);
  assert.match(viewer, /sqliteDiskSnapshot\(dbPath, expectedFingerprint\)/);
  assert.match(viewer, /e\.status !== 404 && e\.status !== 409/);
});

test("SQLite 쓰기 경로는 저장 루트 상대경로와 파일 지문으로 제한된다", () => {
  const start = launcher.indexOf("static bool TryResolveDbPath");
  const end = launcher.indexOf("static readonly System.Text.RegularExpressions.Regex PkgNameRe", start);
  const sqlite = launcher.slice(start, end);
  assert.match(launcher, /path == "\/sqlite-disk-preview" \|\| path == "\/sqlite-exec"/);
  assert.match(sqlite, /Path\.IsPathRooted\(path\)\) return false/);
  assert.match(sqlite, /TryResolveSaveRootPath\(path, out full\)/);
  assert.match(sqlite, /ValidateDbFingerprint\(headers, full, true, true\)/);
  assert.match(sqlite, /expected\.Length != 64/);
});

test("SQLite 변경은 일관된 백업과 단일 트랜잭션 안에서 실행된다", () => {
  const start = launcher.indexOf("static string SqliteExecRunner()");
  const end = launcher.indexOf("static bool TryResolveDbPath", start);
  const runner = launcher.slice(start, end);
  assert.match(runner, /con\.backup\(backup_con\)/);
  assert.match(runner, /BEGIN IMMEDIATE/);
  assert.match(runner, /SQLITE_ATTACH, sqlite3\.SQLITE_DETACH, sqlite3\.SQLITE_TRANSACTION/);
  assert.match(runner, /con\.rollback\(\)/);
  assert.doesNotMatch(runner, /executescript/);
});

test("SQLite 프로세스 제한 시간은 출력 소비와 동시에 적용된다", () => {
  const start = launcher.indexOf("static string RunSqliteRunner");
  const end = launcher.indexOf("static string SqliteDiskPreview", start);
  const runner = launcher.slice(start, end);
  assert.match(runner, /stdoutThread\.Start\(\)/);
  assert.match(runner, /stderrThread\.Start\(\)/);
  assert.match(runner, /proc\.WaitForExit\(30000\)/);
  assert.match(runner, /proc\.Kill\(\)/);
  assert.doesNotMatch(runner, /ReadToEnd/);
});

test("SQL 실행 결과와 디스크 미리보기 실패를 분리한다", () => {
  assert.match(viewer, /data = await sqliteDiskSnapshot\(dbPath\)/);
  assert.match(viewer, /exec\.previewError =/);
  assert.match(viewer, /SQL은 완료됐지만 화면 새로고침에 실패했습니다/);
  const start = launcher.indexOf("if mode == 'preview'");
  const end = launcher.indexOf("print(json.dumps", start);
  const runner = launcher.slice(start, end);
  assert.match(runner, /result\['tables'\], result\['totalTables'\] = snapshot\(con\)/);
  assert.match(runner, /result = \{'ok': True, 'exec': exec_info\}/);
});
