"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = name => fs.readFileSync(path.join(__dirname, "../src/js", name), "utf8");
const loader = read("file-loaders.js");
const documents = read("documents.js");

// Renderers and the disk-removal timer are replaced; open/close and persisted
// restore filtering execute production code, with a fresh VM for every restart.
function session(storage = new Map()){
  const removed = [];
  const context = vm.createContext({
    localStorage:{ getItem:key => storage.get(key) || null, setItem:(key,value) => storage.set(key,value) },
    console, File, clearTimeout, setTimeout:() => 1,
    docs:[], navNodes:[], docsBySourceKey:new Map(), contentMatchSnippets:new Map(),
    studyPdfId:null, activeMru:[], activeId:0,
    throwIfUiCancelled(){}, inspectTextFileEncoding:async () => null,
    fileExtOf:name => name.split(".").pop(), workspaceFindOpenDocument:async () => null,
    confirmLargeFileOpen:async () => true,
    contentCacheDrop(){}, evictContentSearchDoc(){}, workspaceForgetClosedDoc(){}, bumpNavTree(){},
    forgetWorkspacePaths:paths => removed.push([...paths]),
    SQLITE_EXTS:[], BINARY_ASSET_EXTS:new Set(), CODE_EXTS:{}, IMG_EXTS:[], VIDEO_EXTS:[], AUDIO_EXTS:[], SUBTITLE_EXTS:[]
  });
  vm.runInContext(read("workspace-store.js"), context);
  // Leave pending disk deletion unexecuted to reproduce closing immediately.
  context.forgetWorkspacePaths = paths => removed.push([...paths]);
  let nextId = 0;
  // MusicXML 도 다른 파일처럼 원본 이름·경로 그대로 문서가 된다.
  const make = (file, opts) => {
    const doc = { id:++nextId, kind:"music", name:file.name, sourceKey:opts.sourceKey,
      workspacePath:opts.workspacePath, el:{ remove(){} } };
    context.docs.push(doc);
    context.docsBySourceKey.set(opts.sourceKey, doc);
    context.navNodes.push({type:"doc", docId:doc.id});
    return doc;
  };
  context.loadMusicSheet = (file,opts) => make(file,opts);
  context.loadMusicXml = (file,opts) => make(file,opts);
  vm.runInContext(loader.slice(loader.indexOf("async function handleFiles("), loader.indexOf("// 닫은 탭 복원 스택")), context);
  vm.runInContext(documents.slice(documents.indexOf("function closeDoc("), documents.indexOf("function withFileHandle(")), context);
  const open = (name,restore = false) => context.handleFiles([new File(["sample"],name)], {workspacePath:"scores/"+name, restoreFromWorkspace:restore});
  const close = doc => context.closeDoc(doc.id,{skipUi:true,skipConfirm:true,forgetWorkspace:true});
  return {context,storage,removed,open,close};
}

test("두 파일을 모두 닫고 디스크 정리 전에 재시작해도 백업·폴더에서 되살아나지 않는다", async () => {
  const first = session();
  const a = await first.open("a.msheet"), b = await first.open("b.msheet");
  first.close(a); first.close(b);
  assert.equal(first.context.docs.length,0);
  const restarted = session(first.storage);
  assert.equal(await restarted.open("a.msheet",true),null);
  assert.equal(await restarted.open("b.msheet",true),null);
  assert.ok(await restarted.open("new.msheet",true));
  assert.deepEqual(restarted.context.docs.map(d => d.name),["new.msheet"]);
});

test("이름만 같은 MusicXML 두 원본(.musicxml·.mxl)은 각각 닫기와 복원이 적용된다", async () => {
  const first = session();
  const xml = await first.open("Chopin.musicxml"), mxl = await first.open("Chopin.mxl");
  assert.equal(xml.workspaceRestorePath,"scores/Chopin.musicxml");
  assert.equal(mxl.workspaceRestorePath,"scores/Chopin.mxl");
  first.close(xml);
  assert.deepEqual(first.removed[0],["scores/Chopin.musicxml"]);
  const halfway = session(first.storage);
  assert.equal(await halfway.open("Chopin.musicxml",true),null);
  assert.ok(await halfway.open("Chopin.mxl",true));
  first.close(mxl);
  const restarted = session(first.storage);
  for (const name of ["Chopin.musicxml","Chopin.mxl"])
    assert.equal(await restarted.open(name,true),null);
});

test("직접 다시 연 파일은 다음 재시작에 다시 복원한다", async () => {
  const first = session();
  first.close(await first.open("Chopin.musicxml"));
  const manual = session(first.storage);
  assert.ok(await manual.open("Chopin.musicxml"));
  const restarted = session(first.storage);
  assert.ok(await restarted.open("Chopin.musicxml",true));
  assert.equal(restarted.context.workspaceRestorePathExcluded("scores/Chopin.msheet"),false);
});

test("다른 작업공간에서 열린 동일 원본은 전역 복원에서 제외하지 않는다", async () => {
  const first = session();
  const a = await first.open("shared.msheet"), b = await first.open("shared.msheet");
  b.workspaceIds = new Set(["other"]);
  first.close(a);
  assert.equal(first.removed.length,0);
  assert.equal(first.context.workspaceRestorePathExcluded(b.workspacePath),false);
});

test("내부 새로고침 닫기는 복원 제외 기록을 남기지 않는다", async () => {
  const first = session();
  const doc = await first.open("a.msheet");
  first.context.closeDoc(doc.id,{skipUi:true,skipConfirm:true});
  assert.ok(await session(first.storage).open("a.msheet",true));
});
