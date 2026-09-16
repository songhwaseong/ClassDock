"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const {
  workspaceNormalizeSaved, workspaceNormalizeBoardRows, workspaceCleanName,
  workspaceRestoreNeedsPreservation, workspaceDeletionKeepNodeIds
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
  // 작업공간 UI 는 헤더가 아니라 문서 탭 줄 왼쪽 끝 버튼 하나다(누르면 목록 메뉴).
  const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
  assert.doesNotMatch(header, /workspace-switcher|workspaceTabs|workspaceMenuBtn/);
  assert.match(html, /<div id="tabBar">\s*<div class="workspace-switcher" id="workspaceSwitcher">\s*<button type="button" class="workspace-menu-btn" id="workspaceMenuBtn" aria-haspopup="menu" aria-expanded="false"/);
  assert.match(html, /<span class="tab-bar-sep" aria-hidden="true"><\/span>\s*<div class="doc-tabs" id="docTabs"><\/div>\s*<\/div>/);
  assert.doesNotMatch(html, /id="workspaceTabs"/);
  assert.doesNotMatch(workspaces, /draggedWorkspaceId|workspaceRevealTab|role", "tab"/);
  assert.match(workspaces, /function openWorkspaceCtxMenu\(anchorId, x, y, opts\)/);
  assert.match(workspaces, /function openWorkspaceMenuFromButton\(opts\)/);
  assert.match(workspaces, /btn\.addEventListener\("click"[\s\S]*?if \(workspaceCtxEl\)\{ workspaceCloseCtxMenu\(\); return; \}/);
  assert.match(workspaces, /btn\.addEventListener\("contextmenu"/);
  // 여는 버튼 클릭은 바깥 클릭으로 보지 않는다(닫자마자 다시 열리는 것을 막는다).
  assert.match(workspaces, /function onWorkspaceCtxDocClick\(e\)\{[\s\S]*?if \(btn && btn\.contains\(e\.target\)\) return;/);
  // 탭이 없어도 탭 줄은 숨기지 않고, 문서 탭은 #docTabs 에만 그린다.
  assert.match(docs, /function renderTabs\(\)\{[\s\S]*?const bar = byId\("docTabs"\);/);
  assert.doesNotMatch(docs, /bar\.hidden = true; bar\.innerHTML = ""/);
  assert.match(styles, /\.workspace-ctx-menu\{/);
  assert.match(styles, /\.workspace-menu-btn\{[^}]*max-width:170px/);
  assert.match(styles, /\.doc-tabs\{flex:1 1 0;min-width:0;display:flex/);
  assert.doesNotMatch(styles, /\.workspace-tab/);
  assert.match(styles, /\.workspace-color\{[^}]*width:3px;height:14px;border-radius:2px/);
  assert.match(styles, /\.server-status-dot\{[^}]*border-radius:50%/);
  assert.match(html, /src="src\/js\/workspaces\.js"/);
  assert.match(loader, /workspaceFindOpenDocument\(file, opts\)/);
  assert.match(loader, /workspaceAttachExistingDoc\(duplicate/);
  assert.match(loader, /opts\.workspaceRestorePath = parts\.filter\(Boolean\)\.join/);
  assert.match(docs, /function docLegacyStableKey\(doc\)/);
  assert.match(docs, /if \(doc\.workspaceRestorePath\) return String/);
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

test("작업공간 메뉴에는 순서 옮기기 항목이 없다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  assert.doesNotMatch(source, /옮기기|moveWorkspaceOrder|workspaceMoveOrder/);
});

test("사이드바에 그릴 수 없는 줄은 열린 항목으로 세지 않는다", () => {
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  const lineOf = (name) => source.slice(source.indexOf(`function ${name}(`)).split("\n")[0];
  const start = source.indexOf("function workspaceActiveNodes(");
  const body = source.slice(start, source.indexOf("\n}\n", start) + 2);
  const ctx = vm.createContext({ activeWorkspaceId:"work", docs:[], navNodes:[] });
  vm.runInContext(lineOf("workspaceNodeVisible") + "\n" + body, ctx);
  // 다른 작업공간 폴더 아래 빈 하위 폴더·닫힌 문서 줄·사라진 문서 줄 = 목록엔 아무것도 없다
  ctx.docs = [{ id:1, closed:true }];
  ctx.navNodes = [
    { nodeId:"g1", type:"group", parentId:null, workspaceId:"work2" },
    { nodeId:"g2", type:"group", parentId:"g1", workspaceId:"work" },
    { nodeId:"d1", type:"doc", docId:1, parentId:null, workspaceId:"work" },
    { nodeId:"d2", type:"doc", docId:9, parentId:null, workspaceId:"work" }
  ];
  assert.equal(vm.runInContext("workspaceActiveNodes().length", ctx), 0);
  // 루트부터 이어진 빈 폴더와 살아 있는 문서는 센다
  ctx.docs = [{ id:1, closed:false }];
  ctx.navNodes.push({ nodeId:"g3", type:"group", parentId:null, workspaceId:"" });
  assert.deepEqual(vm.runInContext("workspaceActiveNodes().map(n => n.nodeId)", ctx), ["d1", "g3"]);
});

test("파일 없는 하위 폴더의 복원 소속은 부모 폴더를 따른다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/workspaces.js"), "utf8");
  assert.match(source, /node\.workspaceId = inheritFromParent\(node\) \|\| activeWorkspaceId/);
});
