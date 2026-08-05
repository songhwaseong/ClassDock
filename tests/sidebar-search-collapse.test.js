"use strict";

// 사이드바 검색·확장자 필터 중의 폴더 접기.
// 검색어가 걸리면 결과가 접힌 폴더 안에 숨지 않도록 폴더를 강제로 펼친다. 그래서 예전엔 검색 중
// 폴더를 눌러도 node.expanded 만 뒤집혀 화살표(▾/▸)만 바뀌고 목록은 그대로였고, 검색을 지우는
// 순간 그 폴더가 갑자기 접혀 있었다. 이제 검색 중 접기는 검색 한정 표시(sidebarSearchCollapsed)로
// 따로 기억하고, 검색어·필터가 바뀌면 놓아준다 — 원래 트리의 접힘 상태는 건드리지 않는다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// documents.js 는 브라우저 전역에 기대므로 최소한만 흉내 낸다. 검색창은 값만 있으면 된다.
function loadSidebar(){
  const el = () => ({
    style:{ setProperty(){} }, dataset:{}, classList:{ add(){}, remove(){} },
    append(){}, appendChild(){}, addEventListener(){}, setAttribute(){},
    querySelectorAll:() => [], focus(){}, scrollIntoView(){}
  });
  const searchInput = { value:"" };
  const ctx = {
    SUBTITLE_EXTS:[], SQLITE_EXTS:[], BINARY_ASSET_EXTS:new Set(),
    IMG_EXTS:[], VIDEO_EXTS:[], AUDIO_EXTS:[],
    console, setTimeout, clearTimeout, requestAnimationFrame:() => 0,
    Blob, URL, TextDecoder, TextEncoder,
    document:{ createElement:el, querySelectorAll:() => [], addEventListener(){} },
    window:{ addEventListener(){}, t:(s) => s, tf:() => "" },
    localStorage:{ getItem:() => null, setItem(){} },
    byId:(id) => (id === "sbSearch" ? searchInput : el()),
    docs:[],
    navNodes:[]
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  // state.js 의 사이드바 전역만 따로 세운다(state.js 전체를 올리지 않아도 되게).
  vm.runInContext("let sidebarCollapsed = false, sidebarCursorKey = null, lastFocusedDocId = null;\n"
    + source
    + "\n;globalThis.__fold = {"
    + "  open:(node) => sidebarGroupOpen(node),"
    + "  set:(node, v) => setSidebarGroupOpen(node, v),"
    + "  collapseSiblings:(node) => collapseSiblingGroups(node),"
    + "  filtering:() => sidebarFilterActive(),"
    + "  sync:() => syncSidebarSearchCollapse(sidebarSearchQuery()),"
    + "  extFilter:(v) => { sidebarExtFilter = v; },"
    + "  marks:() => sidebarSearchCollapsed.size };", ctx);
  ctx.renderSidebar = () => {};        // 실제 함수 선언이 스텁을 덮으므로 로드 뒤에 다시 씌운다
  // 검색어를 바꿀 때는 렌더가 하는 일(표시 초기화)을 같이 해 준다.
  const search = (q) => { searchInput.value = q; ctx.__fold.sync(); };
  const group = (nodeId, over) => {
    const node = Object.assign({ nodeId, type:"group", parentId:null, name:nodeId, expanded:false }, over);
    ctx.navNodes.push(node);
    return node;
  };
  return { ctx, fold:ctx.__fold, search, group };
}

test("검색 중에는 접혀 있던 폴더도 펼쳐 보인다", () => {
  const { fold, search, group } = loadSidebar();
  const folder = group("g1");                    // expanded:false — 평소엔 접힘
  assert.equal(fold.open(folder), false);
  search("get_api_key");
  assert.equal(fold.open(folder), true, "결과가 접힌 폴더 안에 숨으면 안 된다");
});

test("검색 중 폴더를 접으면 실제로 접히고, 원래 트리의 접힘 상태는 그대로다", () => {
  const { fold, search, group } = loadSidebar();
  const folder = group("g1", { expanded:true });
  search("get_api_key");
  fold.set(folder, false);
  assert.equal(fold.open(folder), false, "화살표만 바뀌고 목록이 남아 있으면 안 된다");
  assert.equal(folder.expanded, true, "검색 중 접기는 원래 트리를 건드리지 않는다");
  search("");
  assert.equal(fold.open(folder), true, "검색을 지우면 검색 전 상태로 돌아온다");
});

test("검색어가 바뀌면 검색 중 접어 둔 표시를 놓아준다", () => {
  const { fold, search, group } = loadSidebar();
  const folder = group("g1");
  search("get_api_key");
  fold.set(folder, false);
  assert.equal(fold.marks(), 1);
  search("temperature");
  assert.equal(fold.marks(), 0);
  assert.equal(fold.open(folder), true, "새 결과는 다시 전부 펼친 채로 보인다");
});

test("확장자 필터만 걸려 있어도 같은 규칙이 적용된다", () => {
  const { fold, group } = loadSidebar();
  const folder = group("g1");
  fold.extFilter(".py"); fold.sync();
  assert.equal(fold.filtering(), true);
  assert.equal(fold.open(folder), true);
  fold.set(folder, false);
  assert.equal(fold.open(folder), false);
  fold.extFilter(""); fold.sync();
  assert.equal(fold.open(folder), false, "필터를 풀면 원래 접힘 상태(expanded:false)로 돌아온다");
});

test("검색 중 아코디언도 검색 한정 표시로 형제를 접는다", () => {
  const { fold, search, group } = loadSidebar();
  const a = group("g1", { expanded:true }), b = group("g2", { expanded:true }), c = group("g3");
  search("get_api_key");
  fold.collapseSiblings(a);
  assert.equal(fold.open(a), true, "자기 자신은 유지");
  assert.equal(fold.open(b), false);
  assert.equal(fold.open(c), false);
  assert.equal(b.expanded, true, "원래 트리는 그대로");
  search("");
  assert.deepEqual([fold.open(a), fold.open(b), fold.open(c)], [true, true, false]);
});

test("검색 중 접어 둔 폴더라도 그 안의 파일을 열면 다시 펼친다", () => {
  const { ctx, fold, search, group } = loadSidebar();
  const folder = group("g1", { expanded:true });
  const doc = { id:1, nodeId:"doc:1", name:"env_util.py" };
  ctx.docs.push(doc);
  ctx.navNodes.push({ nodeId:"doc:1", type:"doc", parentId:"g1", docId:1 });
  ctx.navNodeById = (id) => ctx.navNodes.find(n => n.nodeId === id) || null;
  ctx.sidebarItems = () => [];
  search("get_api_key");
  fold.set(folder, false);
  ctx.focusSidebarDoc(1);
  assert.equal(fold.open(folder), true, "활성 파일 줄이 안 보이면 스크롤도 강조도 못 한다");
});
