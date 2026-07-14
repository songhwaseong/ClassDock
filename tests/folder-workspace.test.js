"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// documents.js 분할본을 이어붙여 검사 — 패턴이 어느 조각에 있든 동일하게 매칭된다.
const source = ["documents.js", "workspace-store.js", "file-loaders.js", "pdf-render.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8")).join("\n");
const appSource = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
const codeSource = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "../manneung-classroom.html"), "utf8");
const guideMarkdown = fs.readFileSync(path.join(__dirname, "../사용법.md"), "utf8");
const guideHtml = fs.readFileSync(path.join(__dirname, "../사용법.html"), "utf8");

test("폴더 작업공간은 빈 폴더 경로를 저장하고 복원한다", () => {
  assert.match(source, /buildWorkspacePayload\(rows, folderPaths, pendingImageFolderPaths\)/);
  assert.match(source, /workspaceFolderMarkerPath\(folder\)/);
  assert.match(source, /workspaceFolderPathFromMarker\(row\.path\)/);
  assert.match(source, /openFolderFiles\(group\.files, \{ folderPaths:group\.folderPaths, pendingImageFolderPaths:group\.pendingImageFolderPaths, restoreFromWorkspace:true \}\)/);
  assert.match(source, /restorePendingImages = !!options\.restoreFromWorkspace && pendingImageFolderPaths\.some\(path => path === rootName\)/);
});

test("대량 이미지 생략 표식은 복원 뒤 하위 폴더 클릭에서도 실제 폴더 읽기를 시작한다", () => {
  assert.match(source, /workspaceImageSkipMarkerPath\(folder\)/);
  assert.match(source, /workspaceImageSkipFolderPath\(row\.path\)/);
  assert.match(source, /pendingImageFolderPaths:group\.pendingImageFolderPaths/);
  assert.match(source, /pendingImageRoot\.restorePendingImages/);
  assert.match(source, /requestFolderRefresh\(pendingImageRoot\.nodeId\)/);
});

test("폴더 새로고침으로 교체된 참고 문서는 분할 화면에서 다시 렌더한다", () => {
  assert.match(source, /const refreshedStudyReference = docs\.find\(doc => doc\.id === studyPdfId\)/);
  assert.match(source, /ensureRendered\(refreshedStudyReference\)\.then\(\(\) => \{/);
  assert.match(source, /refreshedStudyReference\.id === studyPdfId && refreshedStudyReference\.kind === "pdf"/);
});

test("폴더 선택 폴백도 상대경로의 루트를 대량 이미지 복원 표식에 남긴다", () => {
  assert.match(source, /filter\(path => path\.includes\("\/"\)\)/);
  assert.match(source, /map\(path => path\.split\("\/"\)\[0\]\)/);
  assert.match(source, /rememberWorkspace\(files, replaceWorkspace, \{ silent: true, folderPaths \}\)/);
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

test("설정의 자동 저장 폴더 항목은 경로 조회 전이나 일반 HTML에서도 숨기지 않는다", () => {
  assert.match(htmlSource, /id="settingSaveFolderWrap">/);
  assert.doesNotMatch(htmlSource, /id="settingSaveFolderWrap" hidden/);
  assert.match(appSource, /settingSaveFolderWrap\.hidden = false/);
  assert.match(appSource, /EXE에서만 설정할 수 있습니다\./);
});

test("원본 쓰기 권한 없이 연 폴더의 Python 저장은 별도 저장 위치를 명확히 알린다", () => {
  assert.match(codeSource, /fromFolder && !saveToOriginal/);
  assert.match(codeSource, /원본 쓰기 권한 없이 열려 자동 저장 폴더에 저장했어요/);
  assert.match(codeSource, /원본에 저장하려면 '폴더 열기'로 다시 여세요/);
});

test("사용 설명서는 폴더 드래그와 폴더 열기의 Python 저장 차이를 필수 주의사항으로 안내한다", () => {
  for (const guide of [guideMarkdown, guideHtml]){
    assert.match(guide, /꼭 알아두세요/);
    assert.match(guide, /폴더를 화면으로 드래그/);
    assert.match(guide, /드래그한 원본 파일은 변경되지 않습니다/);
    assert.match(guide, /자동 저장 폴더/);
  }
});
