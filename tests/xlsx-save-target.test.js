const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {spreadsheetDirectSaveKind,spreadsheetConvertedDocOptions}=require("../src/js/spreadsheet-viewer.js");
const spreadsheet=fs.readFileSync(require.resolve("../src/js/spreadsheet-viewer.js"),"utf8");
const code=fs.readFileSync(require.resolve("../src/js/code-viewer.js"),"utf8");
const documents=fs.readFileSync(require.resolve("../src/js/documents.js"),"utf8");

function fixture(options={}){
  const events={writes:[],files:[],copies:0,downloads:0,saved:0,toasts:[]};
  const doc={name:"test.xlsx",workspacePath:"Folder/Sub/test.xlsx",parentId:"root",kind:"office",saveCapability:"spreadsheet",
    originalSaveMode:true,hasUnsavedEdits:true,_named:true,...options.doc};
  const handle={name:doc.name,__classdockNativeHandle:!!options.native,nativePath:options.native?"D:/Folder/Sub/test.xlsx":undefined,
    createWritable:async()=>{
      if(options.writeFails)throw new Error("locked");
      return {write:async value=>events.writes.push(new Uint8Array(await value.arrayBuffer())),close:async()=>{events.closed=true;}};
    }};
  const directory={getFileHandle:async(name,flags)=>{
    events.files.push({name,create:flags.create});
    if(options.missingFile && !flags.create)throw Object.assign(new Error("source-entry-not-found"),{name:"NotFoundError"});
    return handle;
  }};
  const root={nodeId:"root",type:"group",folderRefreshRootId:"root",name:"Folder",folderHandle:options.disconnected?null:{
    __classdockNativeHandle:!!options.native,nativePath:"D:/Folder",
    queryPermission:async()=>options.denied?"denied":"granted",requestPermission:async()=>options.denied?"denied":"granted",
    getDirectoryHandle:async name=>{assert.equal(name,"Sub");return directory;},getFileHandle:directory.getFileHandle
  }};
  const context={
    doc,file:{name:"test.xlsx"},base:"test",navNodes:[root],Blob,Uint8Array,console:{error(){},warn(){}},
    normalizedRunPath:value=>String(value).replace(/\\/g,"/").replace(/^\/+/,""),
    nativeSourceSupported:async()=>!!options.native,restoreNativeSourceFolder:async()=>null,
    chooseNativeSourceFolder:async()=>({supported:true,handle:null}),
    saveFsHandle:()=>{},window:{},spreadsheetDirectSaveKind,sheetBaseName:value=>value.replace(/\.xlsx$/,""),
    imageProtectedWorkbook:false,anyDirty:true,csvFastAoa:false,
    exportExBytes:async()=>new Uint8Array([80,75,3,4]),
    saveFileBackendAvailable:async()=>options.server!==false,
    fetch:async()=>{events.copies++;return {ok:true,text:async()=>"D:/SavedCopy/test.xlsx"};},
    downloadSpreadsheetFile:()=>{events.downloads++;},
    markSpreadsheetSaved:async()=>{events.saved++;doc.hasUnsavedEdits=false;},
    toast:message=>events.toasts.push(message),workspaceBackendStatus:()=>true
  };
  vm.createContext(context);
  const cs=code.indexOf("function originalSaveRootForDoc("),ce=code.indexOf("// exe 런처(로컬 서버)가 디스크 저장",cs);
  const ss=spreadsheet.indexOf("  const saveBytesToSaveRoot ="),se=spreadsheet.indexOf("  // ----- 현재 시트 인쇄",ss);
  const ds=documents.indexOf("function documentSaveTarget("),de=documents.indexOf("let saveTargetNoticeTimer",ds);
  vm.runInContext(code.slice(cs,ce)+documents.slice(ds,de)+spreadsheet.slice(ss,se)+"globalThis.save=quickSave;",context);
  return {context,events,doc,handle};
}

test("복원 CSV에서 변환한 XLSX는 폴더 핸들이 문서에 없어도 같은 원본 폴더에 생성한다",async()=>{
  const options=spreadsheetConvertedDocOptions({parentId:"root",workspacePath:"Folder/Sub/test.csv",originalSaveMode:true},"test.xlsx",[],true);
  const {context,events}=fixture({native:true,doc:options});
  await context.save();
  assert.deepEqual(events.files,[{name:"test.xlsx",create:true}]);
  assert.equal(events.writes.length,1);assert.equal(events.copies,0);
});

test("예전 사본 저장 XLSX를 복원했는데 원본 폴더 파일이 없으면 수동 저장에서만 생성한다",async()=>{
  const {context,events}=fixture({native:true,missingFile:true});await context.save();
  assert.deepEqual(events.files,[{name:"test.xlsx",create:false},{name:"test.xlsx",create:true}]);
  assert.equal(events.writes.length,1);assert.equal(events.copies,0);assert.equal(events.saved,1);
  const silent=fixture({native:true,missingFile:true});
  assert.equal(await silent.context.saveViaFileHandle(new Uint8Array([1]),"test.xlsx",silent.doc,{existingOnly:true,noPermissionPrompt:true}),"denied");
  assert.deepEqual(silent.events.files,[{name:"test.xlsx",create:false}]);assert.equal(silent.events.writes.length,0);
});

test("낱개로 연 XLSX는 폴더 트리가 없어도 보관한 파일 핸들로 저장한다",async()=>{
  for(const native of [false,true]){
    const {context,events,doc,handle}=fixture({native,doc:{parentId:null}});
    doc.fsHandle=handle;context.navNodes=[];
    await context.save();assert.equal(events.writes.length,1);assert.equal(events.copies,0);assert.equal(events.saved,1);
  }
});

test("낱개 XLSX 복원본은 저장 전 기억한 파일 핸들을 다시 연결한다",async()=>{
  const {context,events,doc,handle}=fixture({doc:{parentId:null,originalSaveMode:false}});
  context.loadFsHandle=async path=>{assert.equal(path,doc.workspacePath);return handle;};
  await context.save();assert.equal(doc.fsHandle,handle);assert.equal(events.writes.length,1);assert.equal(events.copies,0);
});
test("원본 칩이 있는 복원 XLSX는 파일 핸들이 없어도 원본 저장 경로를 선택한다",async()=>{
  const {context,events,doc}=fixture();
  assert.equal(context.documentSaveTarget(doc).mode,"original");
  assert.equal(spreadsheetDirectSaveKind(doc),"existing");
  await context.save();
  assert.deepEqual(events.files,[{name:"test.xlsx",create:false}]);
  assert.deepEqual([...events.writes[0]],[80,75,3,4]);assert.equal(events.closed,true);
  assert.equal(events.copies,0);assert.equal(events.downloads,0);assert.equal(events.saved,1);
  assert.equal(doc.hasUnsavedEdits,false);assert.ok(doc.fsHandle);
});
test("EXE 네이티브 폴더로 복원된 XLSX도 원본에 쓰고 실제 경로를 안내한다",async()=>{
  const {context,events,doc}=fixture({native:true});
  await context.save();
  assert.equal(events.writes.length,1);assert.equal(events.copies,0);assert.equal(events.downloads,0);
  assert.equal(doc.nativeAbsolutePath,"D:/Folder/Sub/test.xlsx");
  assert.ok(events.toasts.some(text=>text.includes(doc.nativeAbsolutePath)));
});
test("원본 연결 없음·권한 거부·파일 잠금이면 사본을 만들지 않고 미저장 상태를 유지한다",async()=>{
  for(const options of [{disconnected:true},{denied:true},{writeFails:true}]){
    const {context,events,doc}=fixture(options);await context.save();
    assert.equal(events.copies,0);assert.equal(events.downloads,0);assert.equal(events.saved,0);
    assert.equal(doc.hasUnsavedEdits,true);assert.ok(events.toasts.some(text=>text.includes("원본 XLSX에 저장하지 못")));
  }
});
test("원본 폴더 재연결을 취소하면 다른 위치에 저장하지 않는다",async()=>{
  const {context,events,doc}=fixture({native:true,disconnected:true});await context.save();
  assert.equal(events.copies,0);assert.equal(events.downloads,0);assert.equal(events.saved,0);assert.equal(doc.hasUnsavedEdits,true);
});
test("원본 폴더의 새 표는 새 파일로 생성하고 실패 시 사본으로 바꾸지 않는다",async()=>{
  const ok=fixture({doc:{isScratch:true}});await ok.context.save();
  assert.equal(ok.events.files[0].create,true);assert.equal(ok.events.writes.length,1);assert.equal(ok.events.copies,0);
  const failed=fixture({doc:{isScratch:true},writeFails:true});await failed.context.save();
  assert.equal(failed.events.copies,0);assert.equal(failed.events.downloads,0);assert.equal(failed.doc.hasUnsavedEdits,true);
});
test("사본 저장 모드 문서는 기존 자동 저장 폴더·다운로드 동작을 유지한다",async()=>{
  for(const server of [true,false]){
    const {context,events,doc}=fixture({server,doc:{originalSaveMode:false}});
    assert.equal(context.documentSaveTarget(doc).mode,"copy");await context.save();
    assert.equal(events.writes.length,0);assert.equal(events.copies,server?1:0);assert.equal(events.downloads,server?0:1);
    assert.equal(events.saved,1);
  }
});
test("원본 저장 모드에서 저장 API가 없으면 사본으로 우회하지 않는다",async()=>{
  const {context,events,doc}=fixture();context.saveViaFileHandle=undefined;await context.save();
  assert.equal(events.copies,0);assert.equal(events.downloads,0);assert.equal(doc.hasUnsavedEdits,true);
});
test("셀 입력 중이나 표 밖에 포커스가 있어도 Ctrl+S는 표 저장으로 가고 브라우저 페이지 저장 창을 열지 않는다",()=>{
  const app=fs.readFileSync(require.resolve("../src/js/app.js"),"utf8");
  // 셀 편집 키 처리는 전파를 막으므로 그 안에서 입력을 반영한 뒤 저장해야 한다.
  assert.match(spreadsheet,/const onKey = \(e\) => \{[\s\S]*?shortcutMatches\(e, "saveCurrent"\)\)\{\s*e\.preventDefault\(\); e\.stopPropagation\(\);\s*finish\(true\);\s*quickSave\(\);/);
  assert.match(spreadsheet,/doc\.saveCurrent = saveCurrentSpreadsheet;/);
  assert.match(app,/if \(state && typeof state\.saveCurrent === "function"\)\{\s*e\.preventDefault\(\);\s*state\.saveCurrent\(\);/);
  assert.match(app,/window\.addEventListener\("keydown", \(e\) => \{\s*if \(shortcutMatches\(e, "saveCurrent"\)\) e\.preventDefault\(\);\s*\}, true\);/);
});
