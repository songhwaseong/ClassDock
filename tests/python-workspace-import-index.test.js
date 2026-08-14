"use strict";

// 자동 import 후보는 '이미 열어 본 파일'만 보던 탓에, 같은 프로젝트의 옆 파일(state.py 등)을
// 한 번도 연 적 없으면 후보가 하나도 안 나왔다. 이제 열지 않은 .py 도 백그라운드로 읽어
// 캐시에 채운다(완성 팝업은 동기라 그 자리에서 디스크를 읽을 수 없다).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../src/js/core.js");
const source = fs.readFileSync(path.join(__dirname, "../src/js/workspace-python.js"), "utf8");

// 프리워밍 캐시 블록만 잘라 vm 에 올린다(DOM 의존 코드 제외).
function loadWorkspaceIndex(docs, options={}){
  const reads = [];
  const idleCalls = [];
  const activeIds = [];
  const ctx = {
    console, setTimeout, docs,
    pythonWorkspaceModuleIndex: core.pythonWorkspaceModuleIndex,
    pythonWorkspaceImportRowsFromIndex: core.pythonWorkspaceImportRowsFromIndex,
    pythonWorkspaceModuleRowsFromIndex: core.pythonWorkspaceModuleRowsFromIndex,
    hasLiveDocText: (doc) => typeof doc.savedText === "string",
    liveDocText: (doc) => (typeof doc.savedText === "string" ? doc.savedText : null),
    openDocRunText: async (doc) => { reads.push(doc.id); return doc.diskText == null ? null : doc.diskText; },
    setActiveDoc:(id) => { activeIds.push(id); }, toast:() => {}
  };
  if (options.projectRoot !== undefined) ctx.inferOpenPythonProjectRoot = () => options.projectRoot;
  if (options.trackIdle) ctx.requestIdleCallback = (fn) => { idleCalls.push(fn); };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source + ";this.workspaceApi = MNWorkspacePython;", ctx);
  Object.assign(ctx, ctx.workspaceApi);
  return { ctx, reads, idleCalls, activeIds };
}

function pyDoc(id, workspacePath, extra={}){
  return {
    id, workspacePath,
    sourceFile:{ size:extra.size == null ? 512 : extra.size, lastModified:extra.lastModified || 1, arrayBuffer(){ return Promise.resolve(new ArrayBuffer(0)); } },
    ...extra
  };
}

const STATE_PY = "class State(TypedDict):\n    query: str\n";

test("열지 않은 옆 파일도 프리워밍 뒤에는 자동 import 후보가 된다", async () => {
  const owner = pyDoc("owner", "llm_project/chapter08_langgraph/flow_control/graph.py", { savedText:"" });
  const state = pyDoc("state", "llm_project/chapter08_langgraph/flow_control/state.py", { diskText:STATE_PY });
  const { ctx, reads } = loadWorkspaceIndex([owner, state]);

  // 캐시가 비어 있는 첫 호출은 팝업을 막지 않고 그대로 비어 있다.
  assert.deepEqual(ctx.workspacePythonImportCandidates(owner), []);

  await ctx.runWorkspacePythonPrewarm(owner);
  assert.deepEqual(reads, ["state"]);

  const candidates = ctx.workspacePythonImportCandidates(owner);
  assert.ok(candidates.some(item => item.name === "State" && item.type === "class"
    && item.importText === "from state import State"));
});

test("실행 기준 폴더를 추정하면 그 폴더 기준 경로로 자동 import 를 만든다", async () => {
  const owner = pyDoc("owner", "llm_project/chapter08_langgraph/flow_control/graph.py", {
    savedText:"from chapter08_langgraph.flow_control.routers import login_router\n"
  });
  const state = pyDoc("state", "llm_project/chapter08_langgraph/flow_control/state.py", { diskText:STATE_PY });
  const { ctx } = loadWorkspaceIndex([owner, state], { projectRoot:"llm_project" });

  await ctx.runWorkspacePythonPrewarm(owner);
  const candidates = ctx.workspacePythonImportCandidates(owner);
  assert.ok(candidates.some(item => item.name === "State"
    && item.importText === "from chapter08_langgraph.flow_control.state import State"));
  assert.ok(candidates.some(item => item.name === "chapter08_langgraph" && item.importText === "import chapter08_langgraph"));
  assert.ok(candidates.some(item => item.name === "flow_control"
    && item.importText === "from chapter08_langgraph import flow_control"));
});

test("자동 import 후보가 빈 파일을 만나면 백그라운드 읽기를 예약한다", () => {
  const owner = pyDoc("owner", "proj/main.py", { savedText:"" });
  const helper = pyDoc("helper", "proj/helper.py", { diskText:"def load_data():\n    pass\n" });
  const { ctx, idleCalls } = loadWorkspaceIndex([owner, helper], { trackIdle:true });

  ctx.workspacePythonImportCandidates(owner);
  assert.equal(idleCalls.length, 1);
});

test("프리워밍 중 다른 프로젝트 요청이 오면 마지막 요청 프로젝트를 이어서 읽는다", async () => {
  const contextA = {}, contextB = {};
  const ownerA = pyDoc("owner-a", "a/main.py", { savedText:"", archiveCtx:contextA });
  const helperA = pyDoc("helper-a", "a/helper.py", { diskText:"def a(): pass", archiveCtx:contextA });
  const ownerB = pyDoc("owner-b", "b/main.py", { savedText:"", archiveCtx:contextB });
  const helperB = pyDoc("helper-b", "b/helper.py", { diskText:"def b(): pass", archiveCtx:contextB });
  const { ctx, reads, idleCalls } = loadWorkspaceIndex([ownerA, helperA, ownerB, helperB], { trackIdle:true });

  ctx.scheduleWorkspacePythonPrewarm(ownerA);
  ctx.scheduleWorkspacePythonPrewarm(ownerB);
  assert.equal(idleCalls.length, 1);
  await idleCalls.shift()();
  assert.equal(idleCalls.length, 1);
  await idleCalls.shift()();
  assert.deepEqual(reads, ["helper-a", "helper-b"]);
});

test("정의 이동은 같은 상대경로를 가진 다른 프로젝트 문서를 열지 않는다", async () => {
  const contextA = {}, contextB = {};
  const ownerB = pyDoc("owner-b", "pkg/graph.py", { savedText:"", archiveCtx:contextB, parentId:"folder-b" });
  const stateA = pyDoc("state-a", "pkg/state.py", { savedText:STATE_PY, archiveCtx:contextA, parentId:"folder-a" });
  const stateB = pyDoc("state-b", "pkg/state.py", { savedText:STATE_PY, archiveCtx:contextB, parentId:"folder-b" });
  const { ctx, activeIds } = loadWorkspaceIndex([ownerB, stateA, stateB]);

  assert.equal(await ctx.openWorkspaceDefinitionTarget(ownerB,
    { path:"pkg/state.py", line:3, column:2, name:"State" }), true);
  assert.deepEqual(activeIds, ["state-b"]);
  assert.equal(stateA.pendingFocusLine, undefined);
  assert.equal(stateB.pendingFocusLine, 3);
});

test("살아있는 편집기 내용이 프리워밍 캐시보다 우선한다", async () => {
  const owner = pyDoc("owner", "proj/main.py", { savedText:"" });
  const helper = pyDoc("helper", "proj/helper.py", { diskText:"def old_name():\n    pass\n" });
  const { ctx } = loadWorkspaceIndex([owner, helper]);
  await ctx.runWorkspacePythonPrewarm(owner);
  assert.ok(ctx.workspacePythonImportCandidates(owner).some(item => item.name === "old_name"));

  helper.savedText = "def new_name():\n    pass\n";
  const candidates = ctx.workspacePythonImportCandidates(owner);
  assert.ok(candidates.some(item => item.name === "new_name"));
  assert.ok(!candidates.some(item => item.name === "old_name"));
});

test("파일이 바뀌면(크기·수정시각) 옛 캐시는 쓰지 않는다", async () => {
  const owner = pyDoc("owner", "proj/main.py", { savedText:"" });
  const helper = pyDoc("helper", "proj/helper.py", { diskText:"def first():\n    pass\n" });
  const { ctx, reads } = loadWorkspaceIndex([owner, helper]);
  await ctx.runWorkspacePythonPrewarm(owner);

  helper.sourceFile.lastModified = 2;
  helper.diskText = "def second():\n    pass\n";
  assert.deepEqual(ctx.workspacePythonImportCandidates(owner), []);   // 옛 내용은 버린다
  await ctx.runWorkspacePythonPrewarm(owner);
  assert.deepEqual(reads, ["helper", "helper"]);
  assert.ok(ctx.workspacePythonImportCandidates(owner).some(item => item.name === "second"));
});

test("아주 큰 .py 와 PDF·다른 묶음 문서는 인덱스에서 제외한다", async () => {
  const owner = pyDoc("owner", "proj/main.py", { savedText:"" });
  const huge = pyDoc("huge", "proj/generated.py", { size:2 * 1024 * 1024, diskText:"def generated():\n    pass\n" });
  const other = pyDoc("other", "proj/other.py", { diskText:"def other_fn():\n    pass\n", archiveCtx:{} });
  const pdf = pyDoc("pdf", "proj/manual.pdf", { kind:"pdf", diskText:"" });
  const { ctx, reads } = loadWorkspaceIndex([owner, huge, other, pdf]);

  await ctx.runWorkspacePythonPrewarm(owner);
  assert.deepEqual(reads, []);
  assert.deepEqual(ctx.workspacePythonImportCandidates(owner).map(item => item.name), ["generated"]);
  // 큰 파일은 '읽지 않기로 한 파일'로 한 번만 표시하고 타이핑마다 다시 시도하지 않는다.
  assert.deepEqual([...ctx.workspacePyTextCache.keys()], ["huge"]);
  assert.equal(ctx.workspacePyTextCache.get("huge").text, "");
});

test("import 문을 치는 중이면 하위 모듈·모듈 안 이름을 그 자리 후보로 준다", async () => {
  const owner = pyDoc("owner", "llm_project/chapter08_langgraph/flow_control/graph.py", {
    savedText:"from chapter08_langgraph.flow_control.routers import login_router\n"
  });
  const state = pyDoc("state", "llm_project/chapter08_langgraph/flow_control/state.py", { diskText:STATE_PY });
  const nodes = pyDoc("nodes", "llm_project/chapter08_langgraph/flow_control/nodes.py", {
    diskText:"def login(state):\n    pass\n\ndef payment(state):\n    pass\n"
  });
  const { ctx } = loadWorkspaceIndex([owner, state, nodes], { projectRoot:"llm_project" });
  await ctx.runWorkspacePythonPrewarm(owner);
  const names = (context) => ctx.workspacePythonModuleCandidates(owner, context).map(item => item.name).sort();

  assert.deepEqual(names({ kind:"module", module:"", prefix:"" }), ["chapter08_langgraph"]);
  assert.deepEqual(names({ kind:"module", module:"chapter08_langgraph", prefix:"" }), ["flow_control"]);
  assert.deepEqual(names({ kind:"module", module:"chapter08_langgraph.flow_control", prefix:"" }), ["nodes", "state"]);
  assert.deepEqual(names({ kind:"symbol", module:"chapter08_langgraph.flow_control.state", prefix:"" }), ["State"]);
  assert.deepEqual(names({ kind:"symbol", module:"chapter08_langgraph.flow_control.nodes", prefix:"pay" }), ["payment"]);
  assert.equal(ctx.workspacePythonModuleCandidates(owner, null).length, 0);   // import 문맥이 아니면 후보 없음
});

test("모듈 색인은 본문이 그대로면 다시 만들지 않는다", async () => {
  const owner = pyDoc("owner", "proj/main.py", { savedText:"" });
  const helper = pyDoc("helper", "proj/helper.py", { diskText:"def helper_fn():\n    pass\n" });
  const { ctx } = loadWorkspaceIndex([owner, helper]);
  await ctx.runWorkspacePythonPrewarm(owner);

  const first = ctx.workspacePythonModuleIndex(owner);
  assert.equal(ctx.workspacePythonModuleIndex(owner), first);      // 같은 색인 객체를 재사용
  helper.savedText = "def helper_fn():\n    pass\n# 한 줄 추가\n";
  assert.notEqual(ctx.workspacePythonModuleIndex(owner), first);   // 본문이 바뀌면 새로 만든다
});

test("닫힌 문서의 캐시는 프리워밍 때 정리된다", async () => {
  const owner = pyDoc("owner", "proj/main.py", { savedText:"" });
  const helper = pyDoc("helper", "proj/helper.py", { diskText:"def helper_fn():\n    pass\n" });
  const docs = [owner, helper];
  const { ctx } = loadWorkspaceIndex(docs);
  await ctx.runWorkspacePythonPrewarm(owner);
  assert.equal(ctx.workspacePyTextCache.size, 1);

  docs.splice(1, 1);                       // 탭을 닫은 상황
  await ctx.runWorkspacePythonPrewarm(owner);
  assert.equal(ctx.workspacePyTextCache.size, 0);
});
