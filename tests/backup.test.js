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
  mnBackupPreparationMessage
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

test("전용 매니페스트만 만능파일교실 백업으로 인정한다", () => {
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

test("메뉴에 내보내기·복원과 전용 파일 입력이 함께 연결된다", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "manneung-classroom.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
  assert.match(html, /id="sbBackupExport"/);
  assert.match(html, /id="sbBackupRestore"/);
  assert.match(html, /id="backupRestoreInput"[^>]+accept="\.zip,application\/zip"/);
  assert.match(app, /MNBackup\.exportBackup\(\)/);
  assert.match(app, /MNBackup\.restoreBackup\(file\)/);
});
