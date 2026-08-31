"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {webcrypto}=require("node:crypto");

// Run the production handlers against DOM/HTTP boundary doubles, without opening a browser.
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.textContent="";this.value="";this.hidden=false;this.dataset={};this.classList={add(){},remove(){}};}
  append(...nodes){this.children.push(...nodes);if(this.tag==="select"&&!this.value)this.value=nodes[0]?.value||"";}
  replaceChildren(...nodes){this.children=nodes;}
  get firstElementChild(){return this.children[0];}
  setAttribute(){}removeAttribute(){}addEventListener(){}focus(){}querySelectorAll(){return [];}
}
const find=(node,predicate)=>predicate(node)?node:node.children.map(child=>find(child,predicate)).find(Boolean);
const btn=(root,text)=>find(root,node=>node.tag==="button"&&node.textContent===text);
const input=(root,label)=>find(root,node=>node.tag==="label"&&node.firstElementChild?.textContent===label).children[1];
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=async()=>{for(let n=0;n<70;n++)await Promise.resolve();};
function harness(){
  const calls=[],visibility=[],busy=[],gates={},replies={},session={id:"session-A",identity:"student@host",authentication:"password"};
  const pdfState={disposed:0};
  let readyFile="",connected=true,directory="";
  const response=value=>({ok:true,json:async()=>value,text:async()=>""});
  const context={document:{createElement:tag=>new Element(tag)},TextEncoder,TextDecoder,DataView,Uint8Array,AbortController,
    crypto:webcrypto,setTimeout,clearTimeout,URL,Blob,console,
    ensureWorker:async()=>{},
    pdfjsLib:{
      PDFWorker:class{destroy(){pdfState.disposed++;}},
      getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>{throw new Error("simulated PDF page failure");}}),destroy:async()=>{}})
    },
    fetch:async(url,options={})=>{
      if(url.startsWith("/ssh-file-content?"))return {ok:true,arrayBuffer:async()=>new Uint8Array([37,80,68,70,45]).buffer};
      assert.equal(options.method,"POST");
      const bytes=Buffer.from(options.body),values=[];
      for(let offset=0;offset<bytes.length;){const length=bytes.readUInt32LE(offset);offset+=4;values.push(bytes.toString("utf8",offset,offset+length));offset+=length;}
      const op=url.replace("/ssh-file-","");calls.push({op,values});
      if(gates[op])await gates[op].promise;
      if(op==="connect")connected=true;
      if(op==="disconnect"){connected=false;return response({});}
      if(op==="release"){if(values[1]===readyFile)readyFile="";return response({});}
      if(op==="cancel")return response({});
      if(op==="inspect")readyFile="file-A";
      if(op==="download")assert.equal(readyFile,"file-A","closing the panel must not release a pending download's file");
      return response({id:values[0],peerId:"peer-A",fileId:"file-A",done:true,connected,state:op==="save-pick"?"selected":"complete",
        path:"/home/student/results.txt",size:"123",total:"123",bytes:"123",kind:"unsupported",readAt:new Date().toISOString(),...replies[op]});
    }
  };
  const source=["remote-files.js","remote-files-ui.js"].map(file=>fs.readFileSync(path.join(__dirname,"../src/js",file),"utf8")).join("\n");
  vm.runInNewContext(source+"\nglobalThis.createFiles = MNRemoteFilesUI.create;",context);
  const ui=context.createFiles({getSession:()=>session,getDirectory:()=>directory,onVisibility:value=>visibility.push(value),onBusy:value=>busy.push(value)});
  return {ui,calls,visibility,busy,gates,session,replies,pdfState,setDirectory:value=>{directory=value;ui.updateDirectory();}};
}
test("PDF first-page failure keeps the previous preview and reports failure instead of a blank success",async()=>{
  const h=harness();h.ui.show();input(h.ui.panel,"원격 파일 경로").value="/home/student/a.pdf";
  input(h.ui.panel,"파일 연결 SSH 비밀번호").value="secret";
  await btn(h.ui.panel,"미리보기").onclick();
  const viewport=find(h.ui.panel,node=>node.className==="ssh-file-preview"), previous=viewport.children[0];
  assert.ok(previous);
  h.replies.preview={kind:"pdf"};await btn(h.ui.panel,"새로고침").onclick();
  assert.equal(viewport.children[0],previous);
  assert.match(find(h.ui.panel,node=>node.className==="ssh-file-status").textContent,/실패.*이전 내용/);
  assert.ok(h.pdfState.disposed>0);h.ui.reset();
});
test("failed authentication clears its connection ID and retries through a new authenticated connection",async()=>{
  const h=harness();h.ui.show();input(h.ui.panel,"원격 파일 경로").value="/home/student/a.txt";
  input(h.ui.panel,"파일 연결 SSH 비밀번호").value="first";
  // Include a non-ssh-file error to ensure recovery uses connected=false rather than a message regex.
  h.replies.connect={state:"failed",connected:false,error:"ssh-private-key-read-failed"};
  await btn(h.ui.panel,"미리보기").onclick();
  const secretField=find(h.ui.panel,node=>node.tag==="label"&&node.firstElementChild?.textContent==="파일 연결 SSH 비밀번호");
  assert.equal(secretField.hidden,false);assert.equal(secretField.children[1].value,"");
  delete h.replies.connect;secretField.children[1].value="second";
  await btn(h.ui.panel,"미리보기").onclick();
  assert.equal(h.calls.filter(call=>call.op==="connect").length,2);
  assert.equal(h.calls.filter(call=>call.op==="inspect").length,1);assert.equal(h.busy.at(-1),false);h.ui.reset();
});
test("opening remote file panel does not execute shell commands or start authentication",()=>{
  const h=harness();h.ui.show();assert.equal(h.calls.length,0);assert.equal(h.ui.panel.hidden,false);
  assert.ok(input(h.ui.panel,"원격 파일 경로"));
  h.ui.reset();
});
test("a download continues when panel is hidden and releases metadata only after saving",async()=>{
  const h=harness();h.ui.show();input(h.ui.panel,"원격 파일 경로").value="/home/student/results.txt";
  input(h.ui.panel,"파일 연결 SSH 비밀번호").value="test secret";
  h.gates["save-pick"]=defer();
  const done=btn(h.ui.panel,"다운로드…").onclick();await settle();
  h.setDirectory("/home/student/other/");
  assert.equal(input(h.ui.panel,"원격 파일 경로").value,"/home/student/results.txt");
  assert.equal(h.calls.find(call=>call.op==="inspect").values[2],"/home/student/results.txt");
  assert.equal(input(h.ui.panel,"파일 연결 SSH 비밀번호").value,"");
  assert.ok(h.calls.some(call=>call.op==="save-pick"));h.ui.hide();
  assert.equal(h.ui.panel.hidden,true);assert.equal(h.busy.at(-1),true);
  assert.equal(h.calls.some(call=>call.op==="cancel"||call.op==="disconnect"||call.op==="release"),false);
  h.gates["save-pick"].resolve();await done;await settle();
  assert.equal(h.calls.filter(call=>call.op==="download").length,1);assert.equal(h.busy.at(-1),false);
  assert.ok(h.calls.some(call=>call.op==="release"&&call.values[1]==="file-A"));h.ui.reset();
});
test("a late authentication response after cancellation is disconnected and never opens a file",async()=>{
  const h=harness();h.ui.show();input(h.ui.panel,"원격 파일 경로").value="/home/student/a.txt";
  input(h.ui.panel,"파일 연결 SSH 비밀번호").value="secret";h.gates.connect=defer();
  const done=btn(h.ui.panel,"미리보기").onclick();await settle();h.ui.cancel();h.gates.connect.resolve();await done;await settle();
  assert.equal(h.calls.some(call=>call.op==="inspect"),false);assert.ok(h.calls.some(call=>call.op==="disconnect"&&call.values[1]==="peer-A"));
  h.ui.reset();
});
