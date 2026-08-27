"use strict";

// 지도 ↔ 메모창 왕복: 메모 그림 블록이 지도 스냅샷을 어느 편집기로 되열지 기억하는 고리(boardKind)와,
// 메모에서 되살린 JSON 이 다시 .map 문서로 열리는지를 고정한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  scratchpadNormalizeBlock, normalizeScratchpadData, scratchpadBoardKindLabel
} = require("../src/js/scratchpad.js");

function loadMapViewer(overrides={}){
  const context = {
    console, Blob, File, URL, Map, Set, Date, Math, JSON,
    setTimeout, clearTimeout,
    document:{}, window:{}, location:{ protocol:"file:" }, navigator:{ onLine:true },
    ...overrides
  };
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
  vm.runInContext(source + `
    ;globalThis.__map = { mapDocEmpty, mapDocParse, mapDocSerialize, mapNormalizeMarker, openMapFromMemo };`, context);
  return context.__map;
}

const mapSource = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");
const scratchpadSource = fs.readFileSync(path.join(__dirname, "../src/js/scratchpad.js"), "utf8");
const documentsSource = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
const musicSource = fs.readFileSync(path.join(__dirname, "../src/js/music-editor.js"), "utf8");
const workspaceSource = fs.readFileSync(path.join(__dirname, "../src/js/workspace-store.js"), "utf8");

/* restoreMemoLinks 는 열린 문서 목록(docs)과 안정 키에 기대는 문서 편집기 함수라 통째로 불러올 수
   없다. 함수 본문만 떼어 내 docs·docStableKey 를 대신 넣은 자리에서 실제로 돌려 본다. */
function loadRestoreMemoLinks(){
  const start = documentsSource.indexOf("function restoreMemoLinks(saved){");
  assert.ok(start >= 0, "restoreMemoLinks 를 찾지 못했습니다");
  const end = documentsSource.indexOf("\n}\n", start) + 3;
  const context = { console, Map, Set, Array, String, docs:[], docStableKey:(doc) => (doc && doc.key) || "" };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(documentsSource.slice(start, end) + "\n;globalThis.__restore = restoreMemoLinks;", context);
  return (openDocs, saved) => { context.docs = openDocs; return context.__restore(saved); };
}

test("메모 그림 블록은 지도 스냅샷의 갈래를 저장·복원 뒤에도 유지한다", () => {
  const block = scratchpadNormalizeBlock({
    id:"image-1",
    type:"image",
    assetId:"asset-png",
    boardAssetId:"asset-map",
    boardKind:"map",
    boardName:"우리 동네",
    name:"우리 동네.png"
  });
  assert.equal(block.boardKind, "map");

  // 실제 저장 경로(localStorage JSON)를 한 바퀴 돌아도 갈래가 남아야 "✏️ 지도로"가 뜬다.
  const saved = JSON.parse(JSON.stringify({ version:5, notes:[{ id:"n1", title:"메모", blocks:[block] }] }));
  const restored = normalizeScratchpadData(saved).notes[0].blocks[0];
  assert.equal(restored.boardKind, "map");
  assert.equal(restored.boardName, "우리 동네");
});

test("갈래 이름은 되열 단추와 안내문이 함께 쓴다", () => {
  assert.equal(scratchpadBoardKindLabel("map"), "지도");
  assert.equal(scratchpadBoardKindLabel("music"), "악보");
  assert.equal(scratchpadBoardKindLabel("board"), "화이트보드");
  // 모르는 값은 화이트보드로 떨어뜨린다(엉뚱한 편집기를 열지 않게).
  assert.equal(scratchpadBoardKindLabel("pdf"), "화이트보드");
  assert.equal(scratchpadNormalizeBlock({ type:"image", assetId:"a", boardKind:"pdf" }).boardKind, "board");
});

test("메모에 담는 지도 스냅샷은 표시·도형·보던 자리를 그대로 되살린다", () => {
  const api = loadMapViewer();
  const model = api.mapDocEmpty("우리 동네");
  model.center = [37.5665, 126.978];
  model.zoom = 15;
  model.basemap = "light";
  model.markers.push(api.mapNormalizeMarker({ lat:37.5665, lng:126.978, label:"학교", color:"blue" }));

  // 메모로 보낼 때 넘기는 값(JSON.parse(mapDocSerialize(model)))과 되열 때의 복원 경로가 같은 짝이다.
  const snapshot = JSON.parse(api.mapDocSerialize(model));
  const reopened = api.mapDocParse(JSON.stringify(snapshot));
  assert.equal(reopened.title, "우리 동네");
  assert.equal(reopened.basemap, "light");
  assert.equal(reopened.zoom, 15);
  assert.equal(reopened.markers.length, 1);
  assert.equal(reopened.markers[0].label, "학교");
  assert.equal(reopened.center[0], 37.5665);
  assert.equal(reopened.center[1], 126.978);
});

test("깨진 스냅샷은 지도 탭을 만들지 않는다", () => {
  const api = loadMapViewer();
  assert.throws(() => api.mapDocParse(JSON.stringify({ type:"something-else" })));
  assert.throws(() => api.mapDocParse(JSON.stringify({})));
});

test("지도는 메모로 보낼 때 그림과 편집용 스냅샷을 함께 넘긴다", () => {
  assert.match(mapSource, /window\.addMapToScratchpad\(blob, JSON\.parse\(mapDocSerialize\(model\)\)/);
  // 되돌아갈 블록을 기억해 두 번째부터는 새 블록을 만들지 않고 그 블록을 바꾼다.
  assert.match(mapSource, /blockId: doc\.memoBlockId/);
  assert.match(mapSource, /doc\.memoBlockId = result\.blockId/);
  assert.match(mapSource, /doc\.memoBlockId = String\(opts\.memoBlockId \|\| ""\) \|\| null/);
});

test("같은 메모 블록을 두 지도 탭으로 열지 않는다", () => {
  assert.match(mapSource, /async function openMapFromMemo\(options = \{\}\)/);
  assert.match(mapSource, /item\.kind === "map" && blockId && item\.memoBlockId === blockId/);
  assert.match(mapSource, /const _mapMemoOpenTasks = new Map\(\)/);
  assert.match(mapSource, /_mapMemoOpenTasks\.get\(blockId\)/);
  assert.match(mapSource, /_mapMemoOpenTasks\.set\(blockId, opening\)/);
});

test("같은 메모 블록을 동시에 열어도 파일 로딩은 한 번만 수행한다", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let loads = 0, activations = 0;
  const openedDoc = { id:"map-tab-1", kind:"map", memoBlockId:"image-1" };
  const api = loadMapViewer({
    docs:[],
    setActiveDoc:() => { activations++; },
    handleFiles:async () => { loads++; await gate; return openedDoc; }
  });
  const state = api.mapDocEmpty("우리 동네");
  const first = api.openMapFromMemo({ state, name:"우리 동네", memoBlockId:"image-1" });
  const second = api.openMapFromMemo({ state, name:"우리 동네", memoBlockId:"image-1" });
  assert.equal(loads, 1);
  release();
  const [firstDoc, secondDoc] = await Promise.all([first, second]);
  assert.equal(firstDoc.id, "map-tab-1");
  assert.equal(secondDoc.id, "map-tab-1");
  assert.equal(activations, 1);
});

/* 이 블록과 이어져 있는 지도 탭이 이미 열려 있는 경우. 열린 탭을 그냥 보여 주기만 하면
   그 탭이 그새 다른 곳으로 옮겨 갔을 때(또는 파일을 다시 열어 저장된 자리로 돌아왔을 때)
   메모 그림과 딴판인 지도가 뜬다 — 그림의 자리로 맞추거나, 내용이 다르면 물어야 한다. */
function memoReuseCase(overrides={}){
  const calls = { setView:[], handleFiles:0, persisted:0, toasts:[] };
  const openDocs = [];
  const api = loadMapViewer({
    docs:openDocs,
    setActiveDoc:() => { calls.activated = true; },
    persistTabState:() => { calls.persisted++; },
    toast:(message) => { calls.toasts.push(String(message)); },
    handleFiles:async () => { calls.handleFiles++; return { id:"map-tab-new", kind:"map" }; },
    ...overrides
  });
  const model = api.mapDocEmpty("우리 동네");
  model.center = [37.5665, 126.978];
  model.zoom = 15;
  model.markers.push(api.mapNormalizeMarker({ id:"mk-1", lat:37.5665, lng:126.978, label:"학교" }));
  const state = JSON.parse(api.mapDocSerialize(model));
  // 열려 있는 탭은 같은 지도를 제주 쪽에서 보고 있다(보던 자리는 내용 비교에 넣지 않는다).
  const opened = {
    id:"map-tab-1", kind:"map", name:"우리 동네.map", memoBlockId:"image-1",
    mapDoc: api.mapDocParse(JSON.stringify(state)),
    mapInstance:{ setView:(center, zoom) => { calls.setView.push([center[0], center[1], zoom]); } }
  };
  opened.mapDoc.center = [33.4886, 126.4931];
  opened.mapDoc.zoom = 10;
  openDocs.push(opened);
  return { api, calls, opened, state };
}

test("이어진 지도 탭이 이미 열려 있으면 메모 그림과 같은 자리로 옮긴다", async () => {
  const { api, calls, opened, state } = memoReuseCase();
  const doc = await api.openMapFromMemo({ state, name:"우리 동네", memoBlockId:"image-1" });
  assert.equal(doc, opened);
  assert.equal(calls.handleFiles, 0);               // 한 블록에 두 탭이 물리지 않는다
  assert.deepEqual(calls.setView, [[37.5665, 126.978, 15]]);
  // vm 안에서 만든 배열이라 deepEqual(realm 이 다름) 대신 값으로 견준다.
  assert.equal(opened.mapDoc.center[0], 37.5665);
  assert.equal(opened.mapDoc.center[1], 126.978);
  assert.equal(opened.mapDoc.zoom, 15);
  assert.equal(opened.memoReusedTab, true);         // 메모창의 "열었어요" 안내를 겹쳐 띄우지 않게
  assert.match(calls.toasts.join("\n"), /같은 자리로 옮겼어요/);
});

test("열린 탭의 지도가 메모 그림과 다르면 물어보고, 새로 열면 옛 고리를 끊는다", async () => {
  let asked = 0;
  const { api, calls, opened, state } = memoReuseCase({
    confirmDialog:async () => { asked++; return true; }   // "메모 그림으로 열기"
  });
  opened.mapDoc.markers.push(api.mapNormalizeMarker({ id:"mk-2", lat:33.5, lng:126.5, label:"나중에 찍은 표시" }));
  const doc = await api.openMapFromMemo({ state, name:"우리 동네", memoBlockId:"image-1" });
  assert.equal(asked, 1);
  assert.equal(calls.handleFiles, 1);
  assert.equal(doc.id, "map-tab-new");
  assert.equal(doc.memoReusedTab, false);
  assert.equal(opened.memoBlockId, null);           // 두 탭이 한 블록을 덮어쓰지 않게 옛 고리를 끊는다
  assert.equal(calls.persisted, 1);                 // 끊긴 고리를 탭 상태에도 남긴다
  assert.deepEqual(calls.setView, []);              // 열린 탭의 지도는 건드리지 않는다
});

test("열린 탭을 보겠다고 하면 그 탭을 그대로 두고 화면도 옮기지 않는다", async () => {
  const { api, calls, opened, state } = memoReuseCase({
    confirmDialog:async () => false                       // "열린 탭 보기"
  });
  opened.mapDoc.markers.push(api.mapNormalizeMarker({ id:"mk-2", lat:33.5, lng:126.5, label:"나중에 찍은 표시" }));
  const doc = await api.openMapFromMemo({ state, name:"우리 동네", memoBlockId:"image-1" });
  assert.equal(doc, opened);
  assert.equal(calls.handleFiles, 0);
  assert.equal(opened.memoBlockId, "image-1");
  assert.deepEqual(calls.setView, []);
  assert.match(calls.toasts.join("\n"), /메모 그림과 내용이 다릅니다/);
});

test("스냅샷이 깨져도 이어져 있던 탭은 보여 준다", async () => {
  const { api, calls, opened } = memoReuseCase();
  const doc = await api.openMapFromMemo({ state:{ type:"something-else" }, memoBlockId:"image-1" });
  assert.equal(doc, opened);
  assert.equal(calls.handleFiles, 0);
});

test("메모창은 이미 열려 있던 탭으로 갔을 때 '열었어요' 안내를 겹쳐 띄우지 않는다", () => {
  assert.match(scratchpadSource, /if \(openedDoc\.memoReusedTab\) return;/);
  assert.match(mapSource, /opened\.memoReusedTab = true/);
  assert.match(musicSource, /opened\.memoReusedTab = true/);
});

test("악보도 지도와 같은 규약으로 열린 탭을 화해시킨다", () => {
  assert.match(musicSource, /async function musicKeepOpenedMemoTab\(opened, snapshot\)/);
  assert.match(musicSource, /if \(await musicKeepOpenedMemoTab\(opened, snapshot\)\) return opened;/);
  assert.match(musicSource, /opened\.memoBlockId = null;/);
  // 저장할 때마다 바뀌는 시각은 내용 비교에서 뺀다(같은 악보를 "다르다"고 묻지 않게).
  assert.match(musicSource, /delete raw\.createdAt;[\s\S]{0,40}delete raw\.updatedAt;/);
});

test("메모의 되열기 단추는 지도 갈래를 지도 편집기로 보낸다", () => {
  assert.match(scratchpadSource, /sourceKind === "map" \? typeof openMapFromMemo === "function"/);
  assert.match(scratchpadSource, /sourceKind === "map" \? await openMapFromMemo\(openOptions\)/);
  assert.match(scratchpadSource, /window\.addMapToScratchpad = async \(pngBlob, mapData, options=\{\}\)/);
});

test("다시 실행해도 지도·악보가 돌아갈 메모 블록을 기억한다", () => {
  const restore = loadRestoreMemoLinks();
  const mapDoc = { key:"우리 동네.map", kind:"map", memoBlockId:null };
  const musicDoc = { key:"동요.msheet", kind:"music", memoBlockId:null };
  const plainDoc = { key:"메모.txt", kind:"text", memoBlockId:null };
  const restored = restore([mapDoc, musicDoc, plainDoc], {
    memoLinks:[
      { doc:"우리 동네.map", block:"image-map-1" },
      { doc:"동요.msheet", block:"image-music-1" }
    ]
  });
  assert.equal(restored, 2);
  assert.equal(mapDoc.memoBlockId, "image-map-1");
  assert.equal(musicDoc.memoBlockId, "image-music-1");
  assert.equal(plainDoc.memoBlockId, null);
});

test("이름이 겹치는 문서에는 첫 문서에만 고리를 잇는다", () => {
  const restore = loadRestoreMemoLinks();
  // 안정 키는 경로+이름이라 폴더 밖 같은 이름이 둘일 수 있다. 두 탭이 한 블록을 서로
  // 덮어쓰는 것이 이어 붙이지 않는 것보다 나쁘므로 첫 문서만 잇는다.
  const first = { key:"지도.map", kind:"map", memoBlockId:null };
  const second = { key:"지도.map", kind:"map", memoBlockId:null };
  const restored = restore([first, second], {
    memoLinks:[{ doc:"지도.map", block:"image-1" }, { doc:"지도.map", block:"image-2" }]
  });
  assert.equal(restored, 1);
  assert.equal(first.memoBlockId, "image-1");
  assert.equal(second.memoBlockId, null);
});

test("이미 고리를 가진 문서와 고리가 없던 옛 상태는 건드리지 않는다", () => {
  const restore = loadRestoreMemoLinks();
  const live = { key:"지도.map", kind:"map", memoBlockId:"image-살아있음" };
  assert.equal(restore([live], { memoLinks:[{ doc:"지도.map", block:"image-옛것" }] }), 0);
  assert.equal(live.memoBlockId, "image-살아있음");
  // memoLinks 가 없던 시절의 탭 상태(그리고 아무것도 없는 상태)도 조용히 지나간다.
  assert.equal(restore([live], { tabs:["지도.map"], active:"지도.map" }), 0);
  assert.equal(restore([live], null), 0);
});

test("메모 고리는 탭 상태에 함께 저장되고 복원 끝에 다시 이어진다", () => {
  assert.match(documentsSource, /d\.memoBlockId && \(d\.kind === "map" \|\| d\.kind === "music"\)/);
  assert.match(documentsSource, /JSON\.stringify\(\{ tabs, active, study, memoLinks, boards, savedAt: Date\.now\(\) \}\)/);
  assert.match(workspaceSource, /restoreMemoLinks\(savedTabs\)/);
  // 블록이 바뀌는 순간(메모로 보내기)에도 탭 상태를 다시 적어야 그 고리가 남는다.
  assert.match(mapSource, /doc\.memoBlockId = result\.blockId;[\s\S]{0,160}persistTabState\(\)/);
  assert.match(musicSource, /doc\.memoBlockId = result\.blockId;[\s\S]{0,160}persistTabState\(\)/);
});

test("스냅샷이 상한을 넘으면 그림만 넣고 그 사실을 알린다", () => {
  assert.match(scratchpadSource, /const SCRATCHPAD_MAX_SNAPSHOT_BYTES = 25 \* 1024 \* 1024/);
  assert.match(scratchpadSource, /boardBlob\.size > SCRATCHPAD_MAX_SNAPSHOT_BYTES/);
  assert.match(scratchpadSource, /snapshotDropped[\s\S]{0,200}그림만 넣었습니다/);
  assert.match(scratchpadSource, /return \{ blockId:block\.id, replaced:!!found, snapshotDropped \}/);
  assert.match(mapSource, /if \(result\.snapshotDropped && typeof toast === "function"\)/);
  assert.match(mapSource, /지도가 너무 커서 그림만 넣었어요/);
});

test("영어 모드에서 새로 그린 메모 블록도 번역기에 등록한다", () => {
  assert.match(scratchpadSource,
    /editor\.replaceChildren\([\s\S]{0,500}window\.MNI18N\.translateTree\(editor\)/);
});
