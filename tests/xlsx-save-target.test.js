const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {spreadsheetDirectSaveKind}=require("../src/js/spreadsheet-viewer.js");
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
  const directory={getFileHandle:async(name,flags)=>{events.files.push({name,create:flags.create});return handle;}};
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
  return {context,events,doc};
}
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
