"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const XLSX=require("../vendor/xlsx.full.min.js");
const core=require("../src/js/core.js");
const {decodeWorkspace}=core;
const {spreadsheetConvertedDocOptions}=require("../src/js/spreadsheet-viewer.js");
const T=require("../src/js/spreadsheet-tools.js");
const read=name=>fs.readFileSync(require.resolve("../src/js/"+name),"utf8");
const documents=read("documents.js"),loaders=read("file-loaders.js"),spreadsheet=read("spreadsheet-viewer.js");

function recoverySession(){
  const storage=new Map(),backups=new Map();
  const context=vm.createContext({...core,File,Blob,Uint8Array,TextEncoder,TextDecoder,XLSX,console,clearTimeout,
    WORKSPACE_CAP:256*1024*1024,window:{},docs:[],navNodes:[],
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    docStableKey:doc=>doc.workspaceRestorePath||doc.workspacePath,
    markDocumentDirty:(doc,dirty=true)=>{doc.hasUnsavedEdits=dirty;},
    spreadsheetTools:T,spreadsheetConvertedDocOptions,
    toast(){},normalizedRunPath:value=>String(value||"").replace(/\\/g,"/").replace(/^\/+/,"")
  });
  vm.runInContext(read("workspace-store.js"),context);
  vm.runInContext(spreadsheet.slice(spreadsheet.indexOf("function sheetBaseName("),spreadsheet.indexOf("function sanitizeFilePart(")),context);
  // 저장 매체만 메모리로 대체한다. 복구 File 생성·바이너리 포맷·읽기는 실제 코드를 쓴다.
  context.rememberWorkspace=async files=>{
    const bytes=await context.buildWorkspacePayload(files);
    for(const row of decodeWorkspace(bytes))backups.set(row.path,row.bytes);
    return true;
  };
  context.workspaceBackendAvailable=async()=>false;
  const start=documents.indexOf("const UNSAVED_DOCS_KEY ="),end=documents.indexOf("function unsavedDocumentLabel",start);
  const snapshotStart=documents.indexOf("function recoverySnapshotFile("),snapshotEnd=documents.indexOf("function updateDocumentEncoding",snapshotStart);
  vm.runInContext(documents.slice(start,end)+documents.slice(snapshotStart,snapshotEnd),context);
  return {context,storage,backups};
}

test("CSV 변환 직후 저장 전에도 원본 CSV와 새 XLSX의 바이트를 모두 복원할 수 있다",async()=>{
  const {context,backups}=recoverySession();
  const original=new File(["수학,과학,영어\n52,58,55"],"성적.csv");
  Object.defineProperty(original,"webkitRelativePath",{value:"자료/성적.csv"});
  await context.rememberWorkspace([original]);
  const rows=["수학,과학,영어","52,58,55"];
  Object.assign(context,{rowStarts:[0,1],recordAt:i=>rows[i],parseCsvRecord:line=>line.split(","),delimiter:",",
    hasHeader:true,promptCsvHeaderChoice:async()=>true,filename:"성적.csv",
    ownerDoc:{workspacePath:"자료/성적.csv",parentId:"folder",originalSaveMode:true},
    handleFiles:async(files,options)=>{
      const doc={name:files[0].name,kind:"office",sourceFile:files[0],...options};context.docs.push(doc);return doc;
    }});
  const start=spreadsheet.indexOf("        const aoa = [];"),end=spreadsheet.indexOf("      } catch(e){ console.error(e); toast(\"변환하지 못했어요.",start);
  await vm.runInContext("(async()=>{"+spreadsheet.slice(start,end)+"})()",context);
  assert.ok(backups.has("자료/성적.csv"));assert.ok(backups.has("자료/성적.xlsx"));
  assert.equal(context.docs[0].hasUnsavedEdits,true);assert.equal(context.docs[0].originalSaveMode,true);
  const payload=await context.buildWorkspacePayload([...backups].map(([path,bytes])=>{
    const file=new File([bytes],path.split("/").pop());Object.defineProperty(file,"webkitRelativePath",{value:path});return file;
  }));
  const restored=await context.parseWorkspacePayload(payload);
  assert.deepEqual(Array.from(restored.rows,row=>row.path),["자료/성적.csv","자료/성적.xlsx"]);
  const xlsx=XLSX.read(await restored.rows[1].file.arrayBuffer(),{type:"array"});
  assert.equal(xlsx.Sheets.Sheet1.A2.v,52);
});

test("스프레드시트 복구본은 재시작 후 미저장 표시와 동기화 보호를 복원하고 저장 후 해제한다",async()=>{
  const {context,storage}=recoverySession();
  context.docs=[{kind:"office",name:"성적.xlsx",workspacePath:"자료/성적.xlsx",hasUnsavedEdits:true},
    {kind:"office",name:"원본.csv",workspacePath:"자료/원본.csv",hasUnsavedEdits:false},
    {kind:"office",name:"문서.docx",workspacePath:"자료/문서.docx",hasUnsavedEdits:true}];
  context.persistUnsavedDocKeys();
  assert.deepEqual(JSON.parse(storage.get("classdock-unsaved-docs:v2")),["자료/성적.xlsx"]);
  const restored={kind:"office",name:"성적.xlsx",workspacePath:"자료/성적.xlsx"};context.docs=[restored];
  assert.equal(context.restoreUnsavedDocMarks(),1);assert.equal(restored.hasUnsavedEdits,true);assert.equal(restored.workspaceRecovery,true);
  await context.markDocumentSavedSnapshot(restored,new Uint8Array([1,2,3]));context.persistUnsavedDocKeys();
  assert.equal(restored.hasUnsavedEdits,false);assert.equal(storage.has("classdock-unsaved-docs:v2"),false);
});

test("자동 복원에서 낱개 XLSX의 기억한 파일 핸들을 문서에 다시 연결한다",async()=>{
  const {context}=recoverySession(),handle={kind:"file",name:"성적.xlsx"};
  Object.assign(context,{docsBySourceKey:new Map(),throwIfUiCancelled(){},fileExtOf:name=>name.split(".").pop(),
    inspectTextFileEncoding:async()=>null,loadFsHandle:async path=>{assert.equal(path,"성적.xlsx");return handle;},
    workspaceFindOpenDocument:async()=>null,confirmLargeFileOpen:async()=>true,
    BINARY_ASSET_EXTS:new Set(),SQLITE_EXTS:[],CODE_EXTS:{},IMG_EXTS:[],VIDEO_EXTS:[],AUDIO_EXTS:[],SUBTITLE_EXTS:[],
    loadOffice:async(file,ext,opts)=>({kind:"office",name:file.name,...opts})});
  const start=loaders.indexOf("async function handleFiles("),end=loaders.indexOf("// 닫은 탭 복원 스택",start);
  vm.runInContext(loaders.slice(start,end),context);
  const doc=await context.handleFiles([new File(["xlsx"],"성적.xlsx")],{restoreFromWorkspace:true});
  assert.equal(doc.fsHandle,handle);assert.equal(doc.workspaceRestorePath,"성적.xlsx");
});

test("낱개 XLSX 드롭은 원본 저장용 파일 핸들을 보존한다",async()=>{
  const {context,backups}=recoverySession();
  const raw=new File(["xlsx"],"성적.xlsx",{lastModified:123});
  const snapshot=new File(["xlsx"],"성적.xlsx",{lastModified:123});
  const handle={kind:"file",name:raw.name,getFile:async()=>snapshot};
  let opened=[];
  Object.assign(context,{fileQueue:Promise.resolve(),runUiBatch:async task=>task(),
    showLoading(){},yieldToBrowser:async()=>{},collapseToActiveBranch(){},
    handleFiles:async files=>{opened=files;},
    toast:message=>assert.fail(message)});
  for(const [source,name] of [[documents,"withFileHandle"],[loaders,"setFileRelativePath"],[loaders,"queueDroppedItems"]]){
    const start=source.indexOf("function "+name+"(");
    vm.runInContext(source.slice(start,source.indexOf("\n}",start)+2),context);
  }
  await context.queueDroppedItems({files:[raw],items:[{kind:"file",getAsFileSystemHandle:async()=>handle}]});
  assert.equal(opened.length,1);assert.equal(opened[0].__fsHandle,handle);
  assert.ok(backups.has("성적.xlsx"));
});
