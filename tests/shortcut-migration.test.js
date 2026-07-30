"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stateSource = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");

const definitionsStart = stateSource.indexOf("const SHORTCUT_DEFINITIONS");
const definitionsEnd = stateSource.indexOf("const TOGGLEABLE_TOOLS", definitionsStart);
const { SHORTCUT_DEFINITIONS, DEFAULT_SHORTCUTS } = new Function(
  stateSource.slice(definitionsStart, definitionsEnd) +
  "\nreturn { SHORTCUT_DEFINITIONS, DEFAULT_SHORTCUTS };"
)();

const migrationStart = stateSource.indexOf("function migrateAppSettings");
const migrationEnd = stateSource.indexOf("let shortcutDefaultsMigrated", migrationStart);
const migrateAppSettings = new Function(
  stateSource.slice(migrationStart, migrationEnd) + "\nreturn migrateAppSettings;"
)();

test("신규 기본 단축키는 문서 찾기 관습을 따르고 열린 파일 검색과 충돌하지 않는다", () => {
  assert.equal(DEFAULT_SHORTCUTS.findInDocument, "Ctrl+F");
  assert.equal(DEFAULT_SHORTCUTS.focusSearch, "Ctrl+Shift+F");
  assert.equal(new Set(SHORTCUT_DEFINITIONS.map((item) => item.defaultValue)).size, SHORTCUT_DEFINITIONS.length);
});

test("예전 기본 조합을 쓰던 설정만 새 기본 조합으로 한 번 이전한다", () => {
  const migrated = migrateAppSettings({
    shortcutDefaultsVersion: 1,
    shortcuts: { focusSearch:"Ctrl+F", findInDocument:"Ctrl+H", saveCurrent:"Ctrl+S" }
  });
  assert.equal(migrated.shortcuts.focusSearch, "Ctrl+Shift+F");
  assert.equal(migrated.shortcuts.findInDocument, "Ctrl+F");
  assert.equal(migrated.shortcuts.saveCurrent, "Ctrl+S");
  assert.equal(migrated.shortcutDefaultsVersion, 2);
  assert.equal(migrated._shortcutDefaultsMigrated, true);

  const secondLoad = migrateAppSettings(migrated);
  assert.equal(secondLoad.shortcuts.focusSearch, "Ctrl+Shift+F");
  assert.equal(secondLoad.shortcuts.findInDocument, "Ctrl+F");
});

test("사용자가 직접 바꾼 단축키는 이전 과정에서 보존한다", () => {
  const customized = migrateAppSettings({
    shortcuts: { focusSearch:"Alt+F", findInDocument:"Ctrl+H" }
  });
  assert.equal(customized.shortcuts.focusSearch, "Alt+F");
  assert.equal(customized.shortcuts.findInDocument, "Ctrl+H");
  assert.equal(customized.shortcutDefaultsVersion, 2);
  assert.equal(customized._shortcutDefaultsMigrated, undefined);
});
