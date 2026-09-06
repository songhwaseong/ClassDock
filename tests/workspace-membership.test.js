"use strict";

// 자동 복원 중에는 작업공간 소속을 저장하지 않는다.
// 복원 중 열리는 문서는 전부 "활성 작업공간 소속"으로 등록되므로, 그때 저장이 한 번이라도
// 터지면 다른 작업공간의 파일까지 활성 작업공간 docKeys 로 넘어와 영구히 남는다.
// workspaces.js 를 vm 으로 실제로 싣고 localStorage 에 무엇이 쓰였는지로 확인한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const KEY = "classdock-workspaces:v1";

function savedRegistry(){
  return {
    version:1, activeId:"main",
    items:[
      { id:"main", name:"기본 작업공간", color:"blue", docKeys:["수업/a.py", "수업/b.py"],
        tabKeys:["수업/a.py"], activeKey:"수업/a.py", mruKeys:[], boards:[] },
      { id:"test1", name:"test1", color:"green", docKeys:["서류/x.pdf", "서류/y.pdf"],
        tabKeys:["서류/x.pdf"], activeKey:"서류/x.pdf", mruKeys:[], boards:[] }
    ]
  };
}

function loadWorkspaces(saved){
  const store = new Map([[KEY, JSON.stringify(saved || savedRegistry())]]);
  const timers = [];
  const context = {
    console, Map, Set, WeakMap, JSON, Date, Math, String, Number, Array, Object, Promise,
    localStorage:{
      getItem:(k) => (store.has(k) ? store.get(k) : null),
      setItem:(k, v) => store.set(k, String(v)),
      removeItem:(k) => store.delete(k)
    },
    // 복원 중 예약된 저장을 우리가 직접 터뜨려 본다(실제 앱에서는 파일 사이 350ms 틈에서 터진다).
    setTimeout:(fn) => { timers.push(fn); return timers.length; },
    clearTimeout:(id) => { if (id) timers[id - 1] = null; },
    docs:[], navNodes:[], navSeq:0,
    tabOrder:[], activeMru:[], activeId:0, state:null, viewer:null,
    studyPdfId:null, studyReferenceLocked:false, studyTargetPane:"work",
    studyStacked:false, studySwapped:false, sidebarCollapsed:false,
    docStableKey:(doc) => String(doc && doc.key || ""),
    byId:() => null,
    bumpNavTree(){}, renderSidebar(){}, refreshChrome(){}, applyStudyLayout(){},
    setActiveDoc(id){ context.activeId = id || 0; },
    toast(){},
    confirmDialog:async () => true,
    window:{ addEventListener(){}, dispatchEvent(){} },
    document:{ addEventListener(){}, removeEventListener(){}, querySelector:() => null },
    CustomEvent:function CustomEvent(){}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js/workspaces.js"), "utf8"),
    context, { filename:"workspaces.js" });
  // 화면을 그리는 함수만 무력화한다(소속·저장 논리는 원본 그대로 쓴다).
  vm.runInContext("renderWorkspaceUi = function(){}; workspaceCloseCtxMenu = function(){};", context);
  const run = (code) => vm.runInContext(code, context);
  const flushTimers = () => { const pending = timers.splice(0, timers.length); pending.forEach(fn => { if (fn) fn(); }); };
  const readSaved = () => JSON.parse(store.get(KEY));
  return { context, run, flushTimers, readSaved };
}

// 자동 복원이 문서를 여는 흉내 — makeDoc 이 하는 일 중 작업공간에 닿는 부분만 그대로.
function openDocDuringRestore(harness, key){
  const doc = { id: harness.context.docs.length + 1, key, name:key, workspacePath:key };
  harness.context.docs.push(doc);
  const node = { nodeId:"doc:" + doc.id, type:"doc", docId:doc.id, parentId:null };
  harness.context.navNodes.push(node);
  harness.run("workspaceRegisterDoc(docs[docs.length - 1], navNodes[navNodes.length - 1])");
  return doc;
}

test("복원 중에는 작업공간 소속을 저장하지 않는다", () => {
  const h = loadWorkspaces();
  // 두 작업공간의 파일이 한꺼번에 열린다(workspace.bin 은 작업공간 구분 없이 한 묶음이다).
  ["수업/a.py", "수업/b.py", "서류/x.pdf", "서류/y.pdf"].forEach(key => openDocDuringRestore(h, key));
  h.flushTimers();      // 복원 도중 예약된 저장이 터지는 순간

  const saved = h.readSaved();
  const main = saved.items.find(rec => rec.id === "main");
  const test1 = saved.items.find(rec => rec.id === "test1");
  assert.deepEqual(main.docKeys, ["수업/a.py", "수업/b.py"], "복원 중 저장이 활성 작업공간을 덮어쓰면 안 된다");
  assert.deepEqual(test1.docKeys, ["서류/x.pdf", "서류/y.pdf"]);
});

test("복원이 끝나면 저장된 docKeys 대로 소속이 갈리고 그때부터 저장된다", () => {
  const h = loadWorkspaces();
  ["수업/a.py", "수업/b.py", "서류/x.pdf", "서류/y.pdf"].forEach(key => openDocDuringRestore(h, key));
  h.flushTimers();
  h.run("finalizeWorkspaceRestore()");

  const memberships = h.run("docs.map(doc => doc.key + '=' + [...doc.workspaceIds].sort().join('+'))");
  assert.deepEqual([...memberships], [
    "수업/a.py=main", "수업/b.py=main", "서류/x.pdf=test1", "서류/y.pdf=test1"
  ]);

  const saved = h.readSaved();
  assert.deepEqual(saved.items.find(rec => rec.id === "main").docKeys, ["수업/a.py", "수업/b.py"]);
  assert.deepEqual(saved.items.find(rec => rec.id === "test1").docKeys, ["서류/x.pdf", "서류/y.pdf"]);

  // 복원이 끝난 뒤 연 파일은 예전처럼 활성 작업공간(main)에 들어가고 저장도 다시 열린다.
  openDocDuringRestore(h, "수업/c.py");
  h.flushTimers();
  assert.deepEqual(h.readSaved().items.find(rec => rec.id === "main").docKeys,
    ["수업/a.py", "수업/b.py", "수업/c.py"]);
  assert.deepEqual(h.readSaved().items.find(rec => rec.id === "test1").docKeys,
    ["서류/x.pdf", "서류/y.pdf"], "다른 작업공간은 건드리지 않는다");
});

test("복원 원본이 통째로 비면 저장된 docKeys 를 지우지 않는다", () => {
  const h = loadWorkspaces();
  h.run("finalizeWorkspaceRestore()");      // 문서가 하나도 안 열린 상황
  const saved = h.readSaved();
  assert.deepEqual(saved.items.find(rec => rec.id === "main").docKeys, ["수업/a.py", "수업/b.py"]);
  assert.deepEqual(saved.items.find(rec => rec.id === "test1").docKeys, ["서류/x.pdf", "서류/y.pdf"]);
});

// 앱을 껐다 켜는 흉내 — 저장된 레지스트리로 새로 싣고, 모든 작업공간의 파일을 한꺼번에 연 뒤
// (workspace.bin 은 작업공간 구분이 없다) 복원 중 저장을 터뜨리고 finalize 한다.
function restartWith(saved, keys){
  const h = loadWorkspaces(saved);
  keys.forEach(key => openDocDuringRestore(h, key));
  h.flushTimers();
  h.run("finalizeWorkspaceRestore()");
  return h;
}
function membership(h){
  return [...h.run("docs.map(doc => doc.key + '=' + [...doc.workspaceIds].sort().join('+'))")];
}
function keysOf(saved, id){
  const rec = saved.items.find(item => item.id === id);
  return rec ? rec.docKeys : null;
}

test("작업공간을 새로 만들어 파일을 열어도, 다시 켜면 그 작업공간에만 들어간다", () => {
  const h = restartWith(savedRegistry(), ["수업/a.py", "수업/b.py", "서류/x.pdf", "서류/y.pdf"]);
  // 새 작업공간을 만들고 전환(createWorkspace 의 이름 묻는 부분만 빼고 같은 동작)
  h.run("workspaceRegistry.items.push(workspaceEmptyRecord('ws-new', '3학년', 'orange')); switchWorkspace('ws-new');");
  openDocDuringRestore(h, "과제/report.md");
  openDocDuringRestore(h, "과제/notes.md");
  h.flushTimers();

  const saved = h.readSaved();
  assert.deepEqual(keysOf(saved, "ws-new"), ["과제/report.md", "과제/notes.md"]);
  assert.deepEqual(keysOf(saved, "main"), ["수업/a.py", "수업/b.py"], "기존 작업공간은 그대로여야 한다");
  assert.deepEqual(keysOf(saved, "test1"), ["서류/x.pdf", "서류/y.pdf"]);
  assert.equal(saved.activeId, "ws-new");

  // 껐다 켜기 — 여섯 파일이 한꺼번에 열려도 소속이 그대로 갈린다.
  const again = restartWith(saved, ["수업/a.py", "수업/b.py", "서류/x.pdf", "서류/y.pdf", "과제/report.md", "과제/notes.md"]);
  assert.deepEqual(membership(again), [
    "수업/a.py=main", "수업/b.py=main", "서류/x.pdf=test1", "서류/y.pdf=test1",
    "과제/report.md=ws-new", "과제/notes.md=ws-new"
  ]);
  const savedAgain = again.readSaved();
  assert.deepEqual(keysOf(savedAgain, "main"), ["수업/a.py", "수업/b.py"]);
  assert.deepEqual(keysOf(savedAgain, "test1"), ["서류/x.pdf", "서류/y.pdf"]);
  assert.deepEqual(keysOf(savedAgain, "ws-new"), ["과제/report.md", "과제/notes.md"]);
});

test("작업공간을 지우면 그 파일은 남은 작업공간으로 옮겨지고 다시 켜도 그대로다", async () => {
  const h = restartWith(savedRegistry(), ["수업/a.py", "수업/b.py", "서류/x.pdf", "서류/y.pdf"]);
  await h.run("deleteWorkspace('test1')");
  h.flushTimers();

  const saved = h.readSaved();
  assert.equal(saved.items.length, 1);
  assert.equal(keysOf(saved, "test1"), null);
  assert.deepEqual(keysOf(saved, "main"), ["수업/a.py", "수업/b.py", "서류/x.pdf", "서류/y.pdf"],
    "지운 작업공간의 파일은 남은 작업공간이 넘겨받는다");

  const again = restartWith(saved, ["수업/a.py", "수업/b.py", "서류/x.pdf", "서류/y.pdf"]);
  assert.deepEqual(membership(again), [
    "수업/a.py=main", "수업/b.py=main", "서류/x.pdf=main", "서류/y.pdf=main"
  ]);
});

test("지운 작업공간의 파일이 다른 작업공간에도 있었다면 옮기지 않는다", async () => {
  // 같은 파일을 두 작업공간이 함께 가진 상태(정상적으로 '이 작업공간에도 추가'한 경우)
  const shared = savedRegistry();
  shared.items[0].docKeys = ["수업/a.py", "서류/x.pdf"];
  const h = restartWith(shared, ["수업/a.py", "서류/x.pdf", "서류/y.pdf"]);
  assert.deepEqual(membership(h), ["수업/a.py=main", "서류/x.pdf=main+test1", "서류/y.pdf=test1"]);

  await h.run("deleteWorkspace('test1')");
  h.flushTimers();
  const saved = h.readSaved();
  // x.pdf 는 이미 main 에 있었으므로 중복 추가되지 않고, y.pdf 만 넘어온다.
  assert.deepEqual(keysOf(saved, "main"), ["수업/a.py", "서류/x.pdf", "서류/y.pdf"]);
});
