"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");

test("폴더 작업공간은 빈 폴더 경로를 저장하고 복원한다", () => {
  assert.match(source, /buildWorkspacePayload\(rows, folderPaths\)/);
  assert.match(source, /workspaceFolderMarkerPath\(folder\)/);
  assert.match(source, /workspaceFolderPathFromMarker\(row\.path\)/);
  assert.match(source, /openFolderFiles\(group\.files, \{ folderPaths:group\.folderPaths \}\)/);
});

test("folder refresh picker starts from the previous root folder handle when possible", () => {
  assert.match(source, /async function chooseFolderHandle\(startIn=null\)/);
  assert.match(source, /options\.startIn = startIn/);
  assert.match(source, /chooseFolderHandle\(root\.folderHandle \|\| null\)/);
});

test("실제 폴더 그룹은 마지막 파일을 닫아도 자동 정리하지 않는다", () => {
  assert.match(source, /const physicalFolder = refreshRoot/);
  assert.match(source, /if \(physicalFolder\) break;/);
});
