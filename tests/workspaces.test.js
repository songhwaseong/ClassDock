"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const {
  workspaceNormalizeSaved, workspaceNormalizeBoardRows, workspaceCleanName,
  workspaceRestoreNeedsPreservation, workspaceDeletionKeepNodeIds, workspaceMoveOrder
} = require(path.join(root, "src/js/workspaces.js"));

test("작업공간 저장값을 안전한 기본 구조로 정규화한다", () => {
  const empty = workspaceNormalizeSaved(null);
  assert.equal(empty.items.length, 1);
  assert.equal(empty.items[0].id, "main");
  assert.equal(empty.activeId, "main");

  const saved = workspaceNormalizeSaved({ activeId:"bad", items:[
    { id:"lesson", name:"  1학년   수학  ", color:"green", docKeys:["a.pdf"], tabKeys:["a.pdf"] },
    { id:"lesson", name:"Python", color:"not-a-color" }
  ] });
  assert.equal(saved.items.length, 2);
  assert.equal(saved.items[0].name, "1학년 수학");
  assert.equal(saved.items[0].color, "green");
  assert.notEqual(saved.items[0].id, saved.items[1].id);
  assert.equal(saved.activeId, saved.items[0].id);
});

test("작업공간 이름은 공백과 길이를 제한한다", () => {
  assert.equal(workspaceCleanName("  Python    실습  "), "Python 실습");
  assert.equal(workspaceCleanName("", "기본"), "기본");
  assert.equal(workspaceCleanName("가".repeat(80)).length, 40);
});

test("작업공간 만들기와 이름 변경은 브라우저 prompt 대신 앱 입력창을 쓴다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  assert.match(source, /async function createWorkspace\(\)[\s\S]*await askText\(\{ title:"새 작업공간"/);
  assert.match(source, /async function renameWorkspace\(id\)[\s\S]*await askText\(\{ title:"작업공간 이름 변경"/);
  assert.doesNotMatch(source, /\b(?:window\.)?prompt\s*\(/);
});

test("화이트보드 복원 정보는 작업공간마다 따로 정규화해 보존한다", () => {
  const rows = workspaceNormalizeBoardRows([
    { key:"화이트보드", name:"화이트보드", recoveryName:"화이트보드" },
    { key:"화이트보드", name:"중복", recoveryName:"중복" },
    { key:"", name:"", recoveryName:"" }
  ]);
  assert.deepEqual(rows, [{ key:"화이트보드", name:"화이트보드", recoveryName:"화이트보드", memoBlockId:"" }]);
  const saved = workspaceNormalizeSaved({ activeId:"a", items:[
    { id:"a", name:"수학", docKeys:["화이트보드"], tabKeys:["화이트보드"], boards:rows },
    { id:"b", name:"과학", docKeys:["화이트보드 2"], tabKeys:["화이트보드 2"],
      boards:[{ key:"화이트보드 2", name:"화이트보드 2", recoveryName:"화이트보드 2" }] }
  ] });
  assert.equal(saved.items[0].boards[0].key, "화이트보드");
  assert.equal(saved.items[1].boards[0].key, "화이트보드 2");

  const source = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  const store = fs.readFileSync(path.join(root, "src/js/workspace-store.js"), "utf8");
  assert.match(source, /rec\.boards = owned\.filter\(doc => doc\.kind === "board"\)/);
  assert.match(source, /function restoreSavedWorkspaceWhiteboards\(\)/);
  assert.match(source, /readBoardRecoverySnapshot\(key\)/); // 작업공간 boards 필드가 없던 기존 상태도 승격
  assert.match(store, /restoreSavedWorkspaceWhiteboards\(\);[\s\S]*restoreSavedWhiteboards\(savedTabs\)/);
});

test("HTML과 파일 로더가 작업공간 UI와 공유 문서 경로를 연결한다", () => {
  const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
  const workspaces = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  const loader = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
  const docs = fs.readFileSync(path.join(root, "src/js/documents.js"), "utf8");
  assert.match(html, /id="workspaceTabs" role="tablist"/);
  // 헤더의 ＋/▾ 버튼은 없애고 탭 우클릭 메뉴로 옮겼다.
  assert.doesNotMatch(html, /id="workspaceSwitch"/);
  assert.doesNotMatch(html, /id="workspaceAdd"/);
  assert.doesNotMatch(html, /id="workspaceMenu"/);
  assert.match(workspaces, /className = "workspace-tab" \+ \(rec\.id === activeWorkspaceId \? " active" : ""\)/);
  assert.match(workspaces, /setAttribute\("aria-selected", String\(rec\.id === activeWorkspaceId\)\)/);
  assert.match(workspaces, /workspaceRevealTab\(tabs, activeTab\)/);
  assert.match(workspaces, /tabs\.addEventListener\("wheel"/);
  assert.match(workspaces, /tabs\.addEventListener\("contextmenu"/);
  assert.match(workspaces, /function openWorkspaceCtxMenu\(anchorId, x, y\)/);
  assert.match(styles, /\.workspace-ctx-menu\{/);
  assert.match(styles, /\.workspace-tabs\{[^}]*overflow-x:auto/);
  assert.match(styles, /\.workspace-tab\.active/);
  assert.match(styles, /\.workspace-color\{[^}]*width:3px;height:14px;border-radius:2px/);
  assert.match(styles, /\.server-status-dot\{[^}]*border-radius:50%/);
  assert.match(styles, /\.workspace-tab:not\(\.active\)\{display:none\}/);
  assert.match(html, /src="src\/js\/workspaces\.js"/);
  assert.match(loader, /workspaceFindOpenDocument\(file, opts\)/);
  assert.match(loader, /workspaceAttachExistingDoc\(duplicate/);
  assert.match(docs, /workspaceDetachDocFromActive\(doc\)/);
});

test("복원 원본이 없을 때 저장된 작업공간 문서 키를 빈 화면으로 덮어쓰지 않는다", () => {
  const workspaces = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
  assert.equal(workspaceRestoreNeedsPreservation(true, false), true);
  assert.equal(workspaceRestoreNeedsPreservation(true, true), false);
  assert.equal(workspaceRestoreNeedsPreservation(false, false), false);
  assert.match(workspaces, /workspaceRestoreUnresolved = workspaceRestoreNeedsPreservation\(hasSavedKeys, hasSavedMembership\)/);
  assert.match(workspaces, /workspaceRestoreUnresolved && !owned\.length && rec\.docKeys\.length/);
  assert.match(app, /finalizeWorkspaceRestore\(restoreResult\)/);
});

test("가상 작업공간 폴더는 개별 병합 후 전체 폴더를 중복해서 다시 읽지 않는다", () => {
  const store = fs.readFileSync(path.join(root, "src/js/workspace-store.js"), "utf8");
  const loader = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
  assert.match(loader, /rememberWorkspace\(files, replaceWorkspace, \{ silent: true, folderPaths, originalSaveFolderPaths \}\)/);
  assert.doesNotMatch(store, /collectOpenWorkspaceSnapshot|scheduleOpenWorkspaceSnapshot|snapshotFiles/);
});

test("종료 직전 작업공간 변경을 서버 상태로 한 번 더 확정한다", () => {
  const workspaces = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  const sync = fs.readFileSync(path.join(root, "src/js/state-sync.js"), "utf8");
  assert.match(sync, /window\.__mnFlushAppState = flushForPageHide/);
  assert.match(workspaces, /window\.__mnFlushAppState\(\)/);
});

test("폴더 파일 중복 판정은 전체 문서 순회 대신 경로 인덱스를 사용한다", () => {
  const workspaces = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  const start = workspaces.indexOf("async function workspaceFindOpenDocument");
  const end = workspaces.indexOf("\nfunction workspaceDetachDocFromActive", start);
  const finder = workspaces.slice(start, end);
  assert.match(finder, /workspaceDocsByNativePath\.get\(nativePath\)/);
  assert.match(finder, /workspaceDocsByRestorePath\.get\(restorePath\)/);
  assert.doesNotMatch(finder, /docs\.find|for \(const doc of docs\)/);
});

test("낱개로 열려 있던 파일이 드롭한 폴더에 포함되면 그 폴더 아래로 재배치한다", () => {
  const workspaces = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  const loader = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
  const start = workspaces.indexOf("function workspaceAttachExistingDoc");
  const end = workspaces.indexOf("\nasync function workspaceFindOpenDocument", start);
  const attach = workspaces.slice(start, end);
  assert.match(attach, /const existingNode = workspaceDocNodeIn\(doc, activeWorkspaceId\)/);
  assert.match(attach, /existingNode\.parentId = parent\.nodeId/);
  assert.match(attach, /doc\.parentId = parent\.nodeId/);
  assert.match(attach, /return moved \? "moved" : added/);
  assert.match(loader, /이미 열려 있던 파일을 폴더 아래로 정리했습니다/);
});

test("다중 선택 닫기도 공유 문서는 현재 작업공간에서만 분리한다", () => {
  const app = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
  const start = app.indexOf("function wireSidebarSelection");
  const end = app.indexOf("\nfunction wireSidebarResize", start);
  const selection = app.slice(start, end);
  assert.match(selection, /workspaceDetachDocFromActive\(doc\)/);
  assert.match(selection, /\|\| await requestCloseDoc\(id, \{ forgetWorkspace: true \}\)/);
});

test("다른 작업공간의 같은 폴더는 숨은 트리를 동기화하지 않고 현재 작업공간에 연다", () => {
  const loader = fs.readFileSync(path.join(root, "src/js/file-loaders.js"), "utf8");
  const start = loader.indexOf("async function classifyRelatedFolderRoots");
  const end = loader.indexOf("\nfunction absorbContainedFolderRoots", start);
  assert.match(loader.slice(start, end), /navNodes\.filter\(n => workspaceNodeVisible\(n\)/);
});

test("작업공간 삭제는 전용 문서의 노드와 조상만 남은 작업공간으로 옮긴다", () => {
  const nodes = [
    { nodeId:"root-a", type:"group", workspaceId:"a", parentId:null },
    { nodeId:"shared-a", type:"doc", workspaceId:"a", parentId:"root-a", docId:1 },
    { nodeId:"only-a", type:"doc", workspaceId:"a", parentId:"root-a", docId:2 },
    { nodeId:"shared-b", type:"doc", workspaceId:"b", parentId:null, docId:1 }
  ];
  const keep = workspaceDeletionKeepNodeIds(nodes, "a", new Set([2]));
  assert.deepEqual([...keep].sort(), ["only-a", "root-a"]);
  assert.equal(keep.has("shared-a"), false);
  const source = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  assert.match(source, /if \(!fallback\.docKeys\.includes\(key\)\) fallback\.docKeys\.push\(key\)/);
});

test("Python 정의 이동 후보는 현재 작업공간 문서로 제한한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/workspace-python.js"), "utf8");
  const start = source.indexOf("async function openWorkspacePythonImportDefinition");
  const end = source.indexOf("\n  // 아직 한 번도 연 적 없는", start);
  const definition = source.slice(start, end);
  assert.match(definition, /const candidates = docs\.filter\(doc => typeof workspaceHasDoc !== "function" \|\| workspaceHasDoc\(doc\)\)/);
  assert.match(definition, /candidates\.map\(docPath\)/);
  assert.match(definition, /candidates\.find\(doc => docPath\(doc\) === hit\.path\)/);
});

test("작업공간 순서 바꾸기는 items 배열만 옮기고 제자리 드롭은 걸러낸다", () => {
  const ids = () => items.map(rec => rec.id).join(",");
  let items = [{ id:"a" }, { id:"b" }, { id:"c" }];
  assert.equal(workspaceMoveOrder(items, "a", "c", true), true);
  assert.equal(ids(), "b,c,a");

  items = [{ id:"a" }, { id:"b" }, { id:"c" }];
  assert.equal(workspaceMoveOrder(items, "c", "a", false), true);
  assert.equal(ids(), "c,a,b");

  // 바로 뒤 탭의 왼쪽에 떨구면 자리가 그대로다 → 다시 그리기·저장을 건너뛰도록 false.
  items = [{ id:"a" }, { id:"b" }, { id:"c" }];
  assert.equal(workspaceMoveOrder(items, "a", "b", false), false);
  assert.equal(ids(), "a,b,c");
  assert.equal(workspaceMoveOrder(items, "a", "a", true), false);
  assert.equal(workspaceMoveOrder(items, "a", "없는탭", true), false);
  assert.equal(workspaceMoveOrder(items, "없는탭", "a", true), false);
  assert.equal(ids(), "a,b,c");
});

test("작업공간 탭은 드래그로 순서를 바꾸고 좁은 창에서는 우클릭 메뉴로 옮긴다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  // 하나뿐인 작업공간은 옮길 자리가 없다.
  assert.match(source, /const canDragWorkspace = workspaceRegistry\.items\.length > 1/);
  assert.match(source, /tab\.draggable = canDragWorkspace/);
  // 문서 탭 드래그·바깥 파일이 넘어와도 작업공간 순서는 건드리지 않는다.
  assert.match(source, /tab\.addEventListener\("dragover"[\s\S]*?if \(draggedWorkspaceId === null \|\| draggedWorkspaceId === rec\.id\) return/);
  assert.match(source, /tab\.addEventListener\("drop"[\s\S]*?if \(draggedWorkspaceId === null \|\| draggedWorkspaceId === rec\.id\) return/);
  // 내부 드래그 표시가 없으면 자기 창 드롭이 파일 열기로 새어 나간다.
  assert.match(source, /setData\(INTERNAL_DRAG_MIME, "workspace"\)/);
  assert.match(source, /tab\.addEventListener\("dragend", workspaceResetDragState\)/);
  assert.match(source, /renderWorkspaceUi\(\{ reveal:false \}\); workspacePersistNow\(\)/);
  assert.match(source, /function moveWorkspaceOrder\(id, delta\)/);
  assert.match(source, /add\("‹ 왼쪽으로 옮기기", \(\) => moveWorkspaceOrder\(anchor\.id, -1\), \{ disabled:anchorIndex <= 0 \}\)/);
  assert.match(source, /add\("› 오른쪽으로 옮기기", \(\) => moveWorkspaceOrder\(anchor\.id, 1\)/);
  assert.match(styles, /header \.workspace-tab\[draggable="true"\]\{cursor:grab;-webkit-user-drag:element\}/);
  assert.match(styles, /header \.workspace-tab\.drop-before\{box-shadow:inset 3px 0 var\(--accent\)\}/);
  assert.match(styles, /header \.workspace-tab\.drop-after\{box-shadow:inset -3px 0 var\(--accent\)\}/);
});
