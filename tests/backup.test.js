"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MN_BACKUP_MAGIC,
  MN_BACKUP_VERSION,
  MnBackupFormatError,
  validateMnBackupManifest,
  mnBackupStamp
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
