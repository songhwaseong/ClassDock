const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const documents = read("src/js/documents.js");
const loaders = read("src/js/file-loaders.js");
const state = read("src/js/state.js");
const app = read("src/js/app.js");
const shell = read("classdock.html");
const styles = read("src/styles.css");
const workspaceStore = read("src/js/workspace-store.js");

test("탭바는 파일이 하나만 열려 있어도 보인다", () => {
  assert.match(documents, /if \(!tabOrder\.length\)\{ bar\.hidden = true/);
  assert.doesNotMatch(documents, /if \(tabOrder\.length < 2\)\{ bar\.hidden = true/);
});

test("상단 탭이 하나뿐이면 분할 드래그를 시작하지 않는다", () => {
  assert.match(documents, /const canDragTab = tabOrder\.length > 1/);
  assert.match(documents, /tab\.draggable = canDragTab/);
  assert.match(documents, /dragstart[\s\S]*if \(!canDragTab\)\{ e\.preventDefault\(\); return; \}[\s\S]*showSplitDropZone\(\)/);
});

test("저장된 탭 상태는 탭이 하나뿐이어도 복원한다", () => {
  assert.match(documents, /!Array\.isArray\(saved\.tabs\) \|\| !saved\.tabs\.length\) return/);
  assert.match(documents, /if \(!restored\.length\) return/);
});

test("열어 둔 화이트보드는 마지막 판서와 활성 탭까지 다음 실행에 복원한다", () => {
  assert.match(documents, /const boards = tabOrder[\s\S]*\.filter\(d => d && d\.kind === "board"\)/);
  assert.match(documents, /function restoreSavedWhiteboards\(saved\)/);
  assert.match(documents, /readBoardRecoverySnapshot\(key\)/); // boards 필드가 없던 기존 저장 상태도 승격
  assert.match(workspaceStore, /restoreSavedWhiteboards\(savedTabs\);[\s\S]*applyTabState\(savedTabs\)/);
  assert.match(app, /persistTabStateNow\(\)/); // 종료 직전 디바운스를 기다리지 않고 마지막 탭 상태 저장
});

test("마지막 탭을 닫으면 탭이 되살아나지 않고 보던 문서도 내려간다", () => {
  assert.match(documents, /else if \(id === activeId\) setActiveDoc\(0\)/);
});

test("폴더·압축 열기는 첫 파일을 자동으로 띄우지 않는다(자동 복원은 예외)", () => {
  assert.match(state, /autoOpenFirstFile: false/);
  assert.match(state, /function autoOpenFirstFileEnabled\(\)\{ return appSettings\.autoOpenFirstFile === true; \}/);
  // 폴더·zip·tar·단일 gzip 네 통로 모두 복원 중에는 억제하지 않는다
  const guards = loaders.match(/!options\.restoreFromWorkspace && !autoOpenFirstFileEnabled\(\)\) suppressUiBatchAutoOpen\(/g) || [];
  assert.equal(guards.length, 4);
  assert.match(loaders, /단일 파일 gzip[\s\S]*await handleFiles\(\[new File\(\[out\], innerName\)\], options\);[\s\S]*suppressUiBatchAutoOpen\(null\)/);
});

test("자동으로 열지 않은 배치는 연 그룹만 펼치고 빈 화면 안내를 띄운다", () => {
  assert.match(documents, /function suppressUiBatchAutoOpen\(groupId\)/);
  assert.match(documents, /node\.parentId == null && !uiBatchOpenedGroupIds\.includes\(groupId\)/);
  assert.match(documents, /if \(noAutoOpen\)\{[\s\S]*node\.expanded = true[\s\S]*updateDocEmptyState\(\);\s*\n\s*return;/);
  assert.match(documents, /el\.hidden = !\(workspaceActiveNodes\(\)\.length > 0 && !workspaceActiveDocs\(\)\.some\(d => d\.id === activeId\)\)/);
  assert.match(shell, /<div class="doc-empty" id="docEmpty" hidden>/);
  assert.match(styles, /\.doc-empty\{position:absolute;inset:0/);
});

test("첫 파일 자동 열기는 설정에서 켤 수 있다", () => {
  assert.match(shell, /id="settingAutoOpenFirstFile"/);
  assert.match(app, /byId\("settingAutoOpenFirstFile"\)\.checked = appSettings\.autoOpenFirstFile === true/);
  assert.match(app, /autoOpenFirstFile: byId\("settingAutoOpenFirstFile"\)\.checked/);
});

test("문서를 고르지 않은 상태에서 그룹을 닫아도 남은 첫 파일을 자동으로 열지 않는다", () => {
  assert.match(documents, /const activeWasInGroup = childDocs\.some\(d => d\.id === activeId\)/);
  assert.match(documents, /else if \(activeWasInGroup && !workspaceActiveDocs\(\)\.some\(d => d\.id === activeId\)\) setActiveDoc\(workspaceActiveDocs\(\)\[0\]\.id\)/);
});

test("자동 선택하지 않은 새 폴더는 기존 활성 문서가 있어도 펼친 상태를 유지한다", () => {
  const guards = loaders.match(/if \(!keepOpenedGroupExpanded\) collapseToActiveBranch\(\)/g) || [];
  assert.equal(guards.length, 2); // 폴더 선택과 폴더 드롭
  assert.match(loaders, /keepOpenedGroupExpanded = !!rootGroup && !options\.restoreFromWorkspace && !autoOpenFirstFileEnabled\(\)/);
});

test("자동 복원 표식은 폴더와 압축 내부의 중첩 압축까지 전달한다", () => {
  const forwards = loaders.match(/restoreFromWorkspace: !!options\.restoreFromWorkspace/g) || [];
  assert.ok(forwards.length >= 3);
});
