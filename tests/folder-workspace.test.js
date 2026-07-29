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

test("original-save folders keep their mode and file handles across restore and refresh", () => {
  assert.match(source, /workspaceOriginalSaveMarkerPath\(folder\)/);
  assert.match(source, /workspaceOriginalSaveFolderPath\(row\.path\)/);
  // 네이티브·브라우저 폴더 핸들 중 하나라도 되찾았을 때만 원본 저장 모드를 유지하고,
  // 표식만 남고 핸들이 사라졌으면 저장할 곳이 없으므로 사본 저장으로 내린다.
  assert.match(source, /const restoredHandle = nativeHandle \|\| rememberedHandle/);
  assert.match(source, /const restoreOriginalSaveMode = !!\(group\.originalSaveMode && restoredHandle\)/);
  assert.match(source, /originalSaveMode:restoreOriginalSaveMode, restoreFromWorkspace:true,\s*folderHandle:restoredHandle, nativeRootPath:restoredHandle\.nativePath/);
  assert.match(source, /originalSaveMode:false, restoreFromWorkspace:true \}\)/);
  assert.match(source, /originalSaveFolderPaths:root\.originalSaveMode \? \[selectedRootName\] : \[\]/);
  assert.match(source, /root\.originalSaveMode \? \[workspaceOriginalSaveMarkerPath\(selectedRootName\)\] : \[\]/);
  assert.match(source, /if \(root\.originalSaveMode\) nextPathSet\.add\(workspaceOriginalSaveMarkerPath\(selectedRootName\)\)/);
  assert.match(source, /doc\.fsHandle = file\.__fsHandle \|\| doc\.fsHandle \|\| null/);
  assert.match(source, /doc\.originalSaveMode = !!root\.originalSaveMode/);
  assert.match(codeSource, /restoreFolderOriginalFileHandle\(ownerDoc, name,[\s\S]*!!options\.existingOnly && !createInOriginalFolder, !!options\.noPermissionPrompt\)/);
  assert.match(codeSource, /loadRememberedFolderHandle\(root\.name\)/);
});

test("폴더 작업공간은 빈 폴더 경로를 저장하고 복원한다", () => {
  assert.match(source, /buildWorkspacePayload\(rows, folderPaths, pendingImageFolderPaths, originalSaveFolderPaths\)/);
  assert.match(source, /workspaceFolderMarkerPath\(folder\)/);
  assert.match(source, /workspaceFolderPathFromMarker\(row\.path\)/);
  // 폴더 핸들 복원 여부와 무관하게 두 갈래 모두 저장해 둔 folderPaths 를 그대로 넘겨야 빈 폴더가 되살아난다.
  assert.match(source, /openFolderFiles\(group\.files, \{ folderPaths:group\.folderPaths, pendingImageFolderPaths:group\.pendingImageFolderPaths,\s*originalSaveMode:restoreOriginalSaveMode, restoreFromWorkspace:true,/);
  assert.match(source, /openFolderFiles\(group\.files, \{ folderPaths:group\.folderPaths, pendingImageFolderPaths:group\.pendingImageFolderPaths,\s*originalSaveMode:false, restoreFromWorkspace:true \}\)/);
  assert.match(source, /restorePendingImages = !!options\.restoreFromWorkspace && pendingImageFolderPaths\.some\(path => path === rootName\)/);
});

test("대량 이미지·실행 산출물 표식은 명시적 '동기화' 버튼으로만 실제 폴더 읽기를 시작한다", () => {
  assert.match(source, /workspaceImageSkipMarkerPath\(folder\)/);
  assert.match(source, /workspaceImageSkipFolderPath\(row\.path\)/);
  assert.match(source, /pendingImageFolderPaths:group\.pendingImageFolderPaths/);
  // 자동 복원에서 빠진 사진이나 실행 산출물이 있는 루트에만 동기화 버튼을 달고,
  // 그 버튼을 눌러야만 requestFolderRefresh 로 디스크를 다시 읽는다.
  assert.match(source, /node\.folderRefreshRootId === node\.nodeId &&[\s\S]*node\.restorePendingImages \|\| node\.runOutputsPending/);
  assert.match(source, /restore\.innerHTML = window\.uiIcon\("refresh"\)/);
  assert.match(source, /translate\("폴더 동기화"\)/);
  assert.match(source, /requestFolderRefresh\(node\.nodeId\)/);
});

test("폴더 새로고침으로 교체된 참고 문서는 분할 화면에서 다시 렌더한다", () => {
  assert.match(source, /const refreshedStudyReference = docs\.find\(doc => doc\.id === studyPdfId\)/);
  assert.match(source, /ensureRendered\(refreshedStudyReference\)\.then\(\(\) => \{/);
  assert.match(source, /refreshedStudyReference\.id === studyPdfId && refreshedStudyReference\.kind === "pdf"/);
});

test("폴더 선택 폴백도 상대경로의 루트를 대량 이미지 복원 표식에 남긴다", () => {
  assert.match(source, /filter\(path => path\.includes\("\/"\)\)/);
  assert.match(source, /map\(path => path\.split\("\/"\)\[0\]\)/);
  assert.match(source, /rememberWorkspace\(files, replaceWorkspace, \{ silent: true, folderPaths, originalSaveFolderPaths \}\)/);
});

test("folder refresh picker starts from the previous root folder handle when possible", () => {
  assert.match(source, /async function chooseFolderHandle\(startIn=null\)/);
  assert.match(source, /options\.startIn = startIn/);
  assert.match(source, /chooseFolderHandle\(root\.folderHandle \|\| null\)/);
});

test("folder drops traverse modern File System Access directory handles", () => {
  assert.match(source, /captureDroppedFileItems\(dataTransfer\)/);
  assert.match(source, /await Promise\.all\(handlePromises\)/);
  assert.match(source, /handle\.kind === "directory"/);
  assert.match(source, /collectDirectoryHandleFiles\(handle\)/);
  assert.match(source, /const modernHasDir = handles\.some/);
  assert.match(source, /if \(!modernHasDir && hasLegacyDir\)/);
  assert.match(source, /droppedTransferNeedsFolderPicker\(dataTransfer, files\)/);
  assert.match(source, /pickFolderOrInput\(folderInput\)/);
  assert.match(source, /folderHandle:directoryHandles\.length === 1 \? directoryHandles\[0\] : null/);
  assert.match(appSource, /const wasInternal = isInternalDragTransfer\(e\.dataTransfer, internalDrag\)/);
  assert.match(appSource, /if \(!wasInternal\) queueDroppedItems\(e\.dataTransfer\)/);
  assert.match(appSource, /dropOverlay\.addEventListener\("drop"/);
});

test("폴더 드롭은 탐색 진행을 즉시 표시하고 화면을 연 뒤 작업공간을 저장한다", () => {
  assert.match(source, /showLoading\("폴더 파일 확인 중…"\);\s*await yieldToBrowser\(\)/);
  assert.match(source, /폴더 파일 확인 중… \(파일 \$\{files\}개 · 폴더 \$\{folders\}개\)/);
  assert.match(source, /collectDirectoryHandleFiles\(handle, \{ onProgress:showScanProgress \}\)/);
  const dropStart = source.indexOf("function queueDroppedItems(dataTransfer)");
  const dropEnd = source.indexOf("\n}", dropStart) + 2;
  const dropBlock = source.slice(dropStart, dropEnd);
  const openAt = dropBlock.indexOf("const rootGroup = await openFolderFiles(collected");
  const deferAt = dropBlock.indexOf("deferredWorkspaceSave = {");
  const saveAt = dropBlock.indexOf("await rememberWorkspace(pending.files");
  assert.ok(openAt >= 0 && deferAt > openAt && saveAt > deferAt);
  assert.match(dropBlock, /collapseToActiveBranch\(\);[\s\S]*await yieldToBrowser\(\);[\s\S]*await rememberWorkspace\(pending\.files/);
  assert.match(dropBlock, /silent:true, folderPaths:pending\.folderPaths/);
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
  assert.match(codeSource, /원본에 저장하려면 사이드바 \[열기 → 폴더 열기\]로 다시 여세요/);
});

test("원본 폴더에서 만든 새 Python 파일은 원본 저장 모드와 폴더 상대경로를 이어받는다", () => {
  assert.match(codeSource, /originalSaveRootForDoc\(\{ parentId:folder\.parentId \}\)/);
  assert.match(codeSource, /originalSaveMode:!!\(originalRoot && originalRoot\.originalSaveMode\)/);
  assert.match(codeSource, /const initialDocPath = ownerDoc && \(ownerDoc\.workspacePath \|\| ownerDoc\.relPath\)/);
  assert.match(codeSource, /setSavedPath\(initialDocPath, \{ original:true, pending:!!\(ownerDoc\.isScratch && !ownerDoc\._named\) \}\)/);
  assert.match(codeSource, /const createInOriginalFolder = !!\(ownerDoc && ownerDoc\.isScratch && ownerDoc\.originalSaveMode\)/);
  assert.match(codeSource, /!!options\.existingOnly && !createInOriginalFolder/);
});

test("쓰기 가능한 실제 폴더의 우클릭 메뉴에서 디스크에 빈 폴더를 만들고 트리를 갱신한다", () => {
  assert.match(source, /function canCreateFolderOnDisk\(node\)/);
  assert.match(source, /root\.folderHandle\.getDirectoryHandle/);
  assert.match(source, /add\("＋ 새 폴더"/);
  assert.match(source, /requestPermission\(\{ mode:"readwrite" \}\)/);
  assert.match(source, /directoryEntryWithName\(targetHandle, name\)/);
  assert.match(source, /targetHandle\.getDirectoryHandle\(name, \{ create:true \}\)/);
  assert.match(source, /await requestFolderRefresh\(root\.nodeId\)/);
  assert.match(source, /sidebarCursorKey = created\.nodeId/);
  assert.match(source, /ZIP\/TAR 묶음에는 핸들이 없으므로 메뉴가 나타나지 않는다/);
});

test("사용 설명서는 브라우저별 폴더 드래그 저장 차이를 필수 주의사항으로 안내한다", () => {
  for (const guide of [guideMarkdown, guideHtml]){
    assert.match(guide, /꼭 알아두세요/);
    assert.match(guide, /폴더를 화면으로 드래그/);
    assert.match(guide, /Chrome·Edge/);
    assert.match(guide, /원본에 저장/);
    assert.match(guide, /Firefox·Safari/);
    assert.match(guide, /드래그한 원본.*변경하지 않습니다/);
    assert.match(guide, /자동 저장 폴더/);
  }
});
