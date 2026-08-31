"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MN_BACKUP_MAGIC,
  MN_BACKUP_VERSION,
  MnBackupFormatError,
  MnBackupPreparationError,
  validateMnBackupManifest,
  mnBackupStamp,
  mnBackupPreparationMessage,
  mnBackupOpenBoardDescriptor,
  mnBackupBoardIdentity,
  mnBackupMissingBoards,
  MN_BACKUP_LOCAL_ONLY_KEYS,
  mnBackupIsLocalOnlyKey
} = require("../src/js/backup.js");

function validManifest(){
  return {
    magic:MN_BACKUP_MAGIC,
    formatVersion:MN_BACKUP_VERSION,
    files:{
      localStorage:"state/local-storage.json",
      indexedDb:"state/indexeddb.json",
      workspace:"state/workspace.bin"
    }
  };
}

test("전용 매니페스트만 ClassDock 백업으로 인정한다", () => {
  assert.equal(validateMnBackupManifest(validManifest()).magic, MN_BACKUP_MAGIC);
  assert.throws(
    () => validateMnBackupManifest({ magic:"ordinary-zip", formatVersion:1, files:{} }),
    error => error instanceof MnBackupFormatError && error.code === "not-backup"
  );
});

test("손상 형식과 더 최신 형식을 구분해서 거부한다", () => {
  const damaged = validManifest();
  delete damaged.files.indexedDb;
  assert.throws(
    () => validateMnBackupManifest(damaged),
    error => error instanceof MnBackupFormatError && error.code === "damaged"
  );
  const future = validManifest();
  future.formatVersion = MN_BACKUP_VERSION + 1;
  assert.throws(
    () => validateMnBackupManifest(future),
    error => error instanceof MnBackupFormatError && error.code === "unsupported-version"
  );
});

test("백업 파일명 시각은 정렬 가능한 고정 형식이다", () => {
  assert.equal(mnBackupStamp(new Date(2026, 6, 9, 4, 5, 6)), "20260709-040506");
});

test("메모에서 연 화이트보드는 복구 식별자를 백업에 보존한다", () => {
  assert.deepEqual(mnBackupOpenBoardDescriptor({
    name:"화이트보드 2",
    recoveryName:"메모블록:image-1",
    memoBlockId:"image-1"
  }), {
    name:"화이트보드 2",
    recoveryName:"메모블록:image-1",
    memoBlockId:"image-1"
  });
  assert.equal(mnBackupOpenBoardDescriptor("화이트보드"), "화이트보드");
});

test("자동 복원이 이미 되살린 화이트보드는 복원 단계에서 다시 만들지 않는다", () => {
  const backedUp = [
    "화이트보드",
    "화이트보드 2",
    { name:"화이트보드 3", recoveryName:"메모블록:image-1", memoBlockId:"image-1" }
  ];
  // 탭 상태·작업공간 기록으로 이미 열린 보드들
  const opened = [
    mnBackupBoardIdentity({ kind:"board", name:"화이트보드" }),
    mnBackupBoardIdentity({ kind:"board", name:"화이트보드 3", boardRecoveryName:"메모블록:image-1" })
  ];
  assert.deepEqual(mnBackupMissingBoards(backedUp, opened), [{ name:"화이트보드 2" }]);
  // 하나도 안 열렸으면 백업에 있는 만큼 만들고, 이름은 그대로 쓴다
  assert.deepEqual(mnBackupMissingBoards(backedUp, []), [
    { name:"화이트보드" },
    { name:"화이트보드 2" },
    { name:"화이트보드 3", recoveryName:"메모블록:image-1", memoBlockId:"image-1" }
  ]);
  // 같은 보드가 백업에 중복해 들어 있어도 한 번만 만든다
  assert.equal(mnBackupMissingBoards(["화이트보드", "화이트보드"], []).length, 1);
});

test("복원 단계는 이미 열린 보드를 제외하고 불린다", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src/js/backup.js"), "utf8");
  assert.match(source, /mnBackupMissingBoards\(pending && pending\.boards, opened\)/);
});

test("백업 ZIP 은 동기 JSZip 2.6.1 대신 비동기 3.x 를 먼저 쓴다", () => {
  const root = path.join(__dirname, "..");
  const backup = fs.readFileSync(path.join(root, "src/js/backup.js"), "utf8");
  const lazy = require("../src/js/lazy.js");
  assert.ok(lazy.BUNDLES.jszipModern, "jszipModern 묶음이 있어야 한다");
  assert.deepEqual(lazy.BUNDLES.jszipModern.files, ["jszip3.min.js"]);
  assert.equal(lazy.BUNDLES.jszipModern.jszipSwap, true);   // 전역 JSZip 은 2.6.1 로 되돌린다
  assert.equal(typeof lazy.modernZip, "function");
  assert.match(backup, /MNLazy\.tryNeed\("jszipModern"\)/);
  assert.match(backup, /zip\.generateAsync\(\{ type:"blob", compression:"STORE" \}/);
});

test("화면보호기 영상 이름과 활성 창 표시는 백업에서 빠진다", () => {
  const screensaver = fs.readFileSync(path.join(__dirname, "..", "src/js/screensaver.js"), "utf8");
  // screensaver.js 의 실제 키 이름과 목록이 갈라지면 조용히 다시 새는 것을 막는다.
  assert.match(screensaver, /SS_NAMES_KEY = "mnScreensaverVideoNames"/);
  assert.match(screensaver, /SS_NAME_KEY = "mnScreensaverVideoName"/);
  assert.deepEqual(MN_BACKUP_LOCAL_ONLY_KEYS,
    ["classdock:active-tab", "mnScreensaverVideoNames", "mnScreensaverVideoName"]);
  assert.ok(mnBackupIsLocalOnlyKey("mnScreensaverVideoNames"));
  assert.ok(mnBackupIsLocalOnlyKey("classdock-backup:pending-restore:v1"));
  assert.ok(!mnBackupIsLocalOnlyKey("classdock-tabs:v1"));   // 탭 구성은 백업된다
});

test("미저장 준비 실패는 중복을 제거한 항목 이름으로 안내한다", () => {
  const error = new MnBackupPreparationError([
    { label:"search_util.py" },
    { label:"이미지 메모" },
    { label:"search_util.py" },
    { label:"작업 노트.ipynb" },
    { label:"화이트보드" }
  ]);
  assert.equal(error.code, "backup-recovery-flush-failed");
  assert.equal(
    mnBackupPreparationMessage(error),
    "미저장 내용을 백업 준비하지 못했어요: search_util.py, 이미지 메모, 작업 노트.ipynb 외 1개. 문서를 닫지 말고 다시 시도해 주세요."
  );
});

test("변경되지 않은 노트북 복구 저장은 백업 실패로 취급하지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src/js/notebook-model.js"), "utf8");
  assert.match(source, /if \(!ownerDoc\.hasUnsavedEdits\) return true;/);
});

test("백업 제외 파일만 열린 경우 작업공간 저장 생략을 실패로 오인하지 않는다", () => {
  const root = path.join(__dirname, "..");
  const backup = fs.readFileSync(path.join(root, "src/js/backup.js"), "utf8");
  const workspace = fs.readFileSync(path.join(root, "src/js/workspace-store.js"), "utf8");
  assert.match(workspace, /function workspaceHasBackupEligibleFiles\(files\)/);
  assert.match(backup, /result === false && !hasEligibleFiles \? true : result/);
});

test("메뉴에 내보내기·복원과 전용 파일 입력이 함께 연결된다", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
  assert.match(html, /id="sbBackupExport"/);
  assert.match(html, /id="sbBackupRestore"/);
  assert.match(html, /id="backupRestoreInput"[^>]+accept="\.zip,application\/zip"/);
  assert.match(app, /MNBackup\.exportBackup\(\)/);
  assert.match(app, /MNBackup\.restoreBackup\(file\)/);
});
