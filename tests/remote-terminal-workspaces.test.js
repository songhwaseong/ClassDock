"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = ["remote-files.js", "remote-files-ui.js", "remote-terminal.js"]
  .map(file => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8")).join("\n");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const response = (data={}) => ({ ok:true, json:async () => data, text:async () => "" });

// DOM/HTTP/xterm 경계만 대체한다. 브라우저 없이 실제 공개 API와 버튼 핸들러를 실행한다.
class Element {
  constructor(tag){
    this.tag = tag; this.value = ""; this.hidden = false; this.children = []; this.dataset = {};
    this.className = ""; this.textContent = ""; this.listeners = new Map();this.attributes={};
    this.clientWidth = 640; this.clientHeight = 480;
    const classes = new Set();
    this.classList = {
      add:(...names) => names.forEach((name) => classes.add(name)),
      remove:(...names) => names.forEach((name) => classes.delete(name)),
      contains:(name) => classes.has(name),
      toggle:(name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    };
    this.style = { values:{}, setProperty:(name, value) => { this.style.values[name] = value; } };
  }
  append(...children){
    this.children.push(...children);
    if (this.tag === "select" && !this.value) this.value = children[0].value;
  }
  appendChild(child){ this.append(child); }
  get firstElementChild(){ return this.children[0]; }
  addEventListener(type, listener){ this.listeners.set(type, listener); }
  fire(type, properties={}){ return this.listeners.get(type)?.({ preventDefault(){}, stopPropagation(){}, target:this, ...properties }); }
  setAttribute(name,value){this.attributes[name]=value;} removeAttribute(){} getAttribute(name){ return this.attributes[name]||null; }
  querySelector(){ return null; } focus(){} remove(){} replaceChildren(...children){this.children=children;}
  setSelectionRange(start, end){ this.selectionStart=start; this.selectionEnd=end; }
}
const find = (element, predicate) => {
  if (predicate(element)) return element;
  for (const child of element.children){ const found = find(child, predicate); if (found) return found; }
  return null;
};
const byClass = (root, name) => find(root, (el) => el.className.split(" ").includes(name));
const button = (root, copy) => find(root, (el) => el.tag === "button" && el.textContent === copy);
const input = (root, label) => find(root, (el) => el.tag === "label" && el.firstElementChild?.textContent === label).children[1];

function harness(storage=new Map()){
  const main = new Element("main"), events = new Map(), calls = [], terminals = [], inputs = [], downloads=[];
  const pendingPolls = new Map(), pendingStops = new Map();
  const timers = new Map(); let nextTimer = 0;
  const context = {
    TextEncoder, TextDecoder, AbortController, activeWorkspaceId:"A",
    atob:(text) => Buffer.from(text, "base64").toString("binary"),
    document:{ createElement:(tag) => new Element(tag), querySelector:() => main,
      getElementById:() => null, documentElement:new Element("html"), body:new Element("body") },
    localStorage:{ getItem:(key) => storage.get(key), setItem:(key, value) => storage.set(key, value), removeItem:(key) => storage.delete(key) },
    location:{ protocol:"http:" },
    window:{ addEventListener:(name, listener) => events.set(name, listener), getComputedStyle:() => ({}) },
    setTimeout:(callback, delay=0) => { const id=++nextTimer; timers.set(id,{callback,delay}); return id; },
    clearTimeout:(id) => timers.delete(id), requestAnimationFrame:() => 1,
    MNLazy:{ tryNeed:async () => true },
    MNDownload:{saveText:(text,name)=>{downloads.push({text,name});return true;}},
    Terminal:class {
      constructor(options){ this.options = options; this.output = ""; terminals.push(this); }
      open(){} dispose(){} focus(){} onData(){}
      clearSelection(){this.selection=null;} select(column,row,length){this.selection={column,row,length};} scrollToLine(row){this.scrolled=row;}
      resize(cols, rows){ this.cols = cols; this.rows = rows; }
      write(bytes, done){ this.output += Buffer.from(bytes).toString("utf8"); done(); }
      writeln(text){ this.output += text + "\n"; }
    },
    fetch:async (url, options={}) => {
      calls.push(url);
      if (url === "/ssh-capability") return response({ available:true });
      if (url === "/ssh-host-key-scan") return response({ state:"trusted" });
      if (url === "/ssh-key-pick") return response();
      if (url === "/ssh-key-pick-status") return response({ state:"selected", id:"key-A", name:"id_A" });
      if (url === "/ssh-session-open"){
        const bytes = Buffer.from(options.body), values = [];
        for (let offset = 0; offset < bytes.length;){
          const length = bytes.readUInt32LE(offset); offset += 4;
          values.push(bytes.toString("utf8", offset, offset + length)); offset += length;
        }
        return response({ id:values[1] });
      }
      const id = new URL(url, "http://localhost").searchParams.get("id");
      if (url.startsWith("/ssh-session-input")){
        inputs.push({ id, text:Buffer.from(options.body).toString("utf8") }); return response();
      }
      if (url.startsWith("/ssh-session-poll")){
        const pending = deferred(); pendingPolls.set(id, pending); return pending.promise;
      }
      if (url.startsWith("/ssh-session-stop")) return pendingStops.get(id)?.promise || response();
      if (url.startsWith("/ssh-session-resize")) return response();
      throw new Error("Unexpected request: " + url);
    }
  };
  vm.runInNewContext(source + "\nglobalThis.api = MNRemoteTerminal;", context);
  const switchTo = (id) => { context.activeWorkspaceId = id; events.get("mnworkspaceswitch")?.(); };
  const open = async (id) => {
    switchTo(id); await context.api.open();
    return main.children.find((el) => el.tag === "aside" && !el.hidden);
  };
  const connect = async (dock, host, authentication="password", port="22") => {
    input(dock, "호스트").value = host; input(dock, "포트").value = port;
    input(dock, "계정").value = "user"; input(dock, "인증 방식").value = authentication;
    input(dock, "인증 방식").fire("change");
    input(dock, authentication === "private-key" ? "키 암호 (암호화된 키만)" : "비밀번호").value = "secret";
    if (authentication === "private-key") await button(dock, "개인키 선택…").fire("click");
    byClass(dock, "ssh-connect-view").fire("submit"); await settle();
    assert.ok(pendingPolls.has(host), "connection should start polling");
  };
  const pollReply = async (id, text, offset, complete=false, more=false) => {
    pendingPolls.get(id).resolve(response({ data:Buffer.from(text).toString("base64"), offset, complete, alive:!complete, more, code:0 }));
    await settle();
  };
  const flushTimers = (delay) => {
    for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);timer.callback();}
  };
  return { main, calls, inputs, terminals, downloads, pendingStops, api:context.api, switchTo, open, connect, pollReply, flushTimers, resize:()=>events.get("resize")?.() };
}

const directoryReply=(session, directory)=>"\x1b]7;file://classdock-"+session+directory+"\x07";

test("search and export buttons use rendered output without sending remote commands",async()=>{
  const h=harness(), dock=await h.open("A");await h.connect(dock,"server.test");
  const {Terminal}=require("../vendor/xterm.js"), parser=new Terminal({cols:12,rows:3});
  try{
    await new Promise(resolve=>parser.write("한글 test\r\n한글 result",resolve));
    const terminal=h.terminals[0];terminal.buffer=parser.buffer;terminal.cols=12;
    button(dock,"출력 찾기").fire("click");
    const search=find(dock,node=>node.placeholder==="출력에서 찾기 (대소문자 구분)");
    search.value="한글";search.fire("input");button(dock,"다음").fire("click");
    assert.equal(terminal.selection.row,0);assert.equal(terminal.selection.length,4);
    button(dock,"다음").fire("click");assert.equal(terminal.selection.row,1);
    search.fire("keydown",{key:"Enter",shiftKey:true});assert.equal(terminal.selection.row,0);
    search.value="missing";button(dock,"다음").fire("click");assert.equal(terminal.selection,null);
    await button(dock,"출력 저장").fire("click");
    assert.equal(h.downloads[0].text,"한글 test\n한글 result");assert.match(h.downloads[0].name,/^ssh-.*\.txt$/);
    assert.equal(h.inputs.length,0);
  }finally{parser.dispose();await h.api.close();}
});

test("session tools sit in a vertical rail and font settings open from the rail",async()=>{
  const h=harness(), dock=await h.open("A");await h.connect(dock,"server.test");
  try{
    const head=byClass(dock,"ssh-session-actions"), rail=byClass(dock,"ssh-session-rail");
    assert.deepEqual(head.children.map(node=>node.textContent),["접기","닫기"]);
    assert.equal(rail.attributes.role,"toolbar");assert.equal(rail.attributes["aria-orientation"],"vertical");
    for(const copy of ["파일 업로드","원격 파일","출력 찾기","출력 저장","글꼴","⇄","접속 정보","연결 끊기"])
      assert.ok(find(rail,node=>node.tag==="button"&&node.textContent===copy),copy);
    const fonts=byClass(dock,"ssh-font-controls");assert.equal(fonts.hidden,true);
    button(rail,"글꼴").fire("click");assert.equal(fonts.hidden,false);assert.equal(button(rail,"글꼴").attributes["aria-pressed"],"true");
    button(rail,"글꼴").fire("click");assert.equal(fonts.hidden,true);
  }finally{await h.api.close();}
});

test("connect form helper buttons are icon buttons with names kept for tooltips and screen readers",async()=>{
  const h=harness(), dock=await h.open("A");
  try{
    for(const [copy,label] of [["개인키 선택…","개인키 파일 선택"],["즐겨찾기 저장","즐겨찾기 저장"],["선택 삭제","선택한 즐겨찾기 삭제"],["최근 기록 지우기","최근 기록 지우기"]]){
      const el=button(dock,copy);
      assert.ok(el.className.split(" ").includes("ssh-form-ico"),copy);
      assert.equal(el.title,label);assert.equal(el.attributes["aria-label"],label);
    }
    assert.ok(button(dock,"접속").className.includes("ssh-connect-btn"));
    // 업로드 창·출력 찾기 줄도 그림만(업로드 시작은 주 단추라 그림 + 글자).
    for(const [copy,label] of [["파일 선택…","업로드할 파일 선택"],["업로드 취소","업로드 취소"],["닫기","파일 업로드 닫기"],
      ["이전","이전 찾기 (Shift+Enter)"],["다음","다음 찾기 (Enter)"],["찾기 닫기","찾기 닫기 (Esc)"]]){
      const el=find(dock,node=>node.tag==="button"&&node.textContent===copy&&node.className.includes("ssh-form-ico"));
      assert.ok(el,copy);assert.equal(el.title,label);assert.equal(el.attributes["aria-label"],label);
    }
    // 주 단추(접속·업로드 시작)도 그림만 — 이름은 title·aria-label 로.
    const start=button(dock,"업로드 시작");assert.ok(start.className.includes("ssh-form-ico"));
    assert.equal(start.attributes["aria-label"],"선택한 파일을 원격 서버로 업로드");
    const connect=button(dock,"접속");assert.ok(connect.className.includes("ssh-form-ico"));
    assert.equal(connect.title,"SSH 서버에 접속");assert.equal(connect.attributes["aria-label"],"SSH 서버에 접속");
  }finally{await h.api.close();}
});

test("favorites persist only allowed fields, support groups and search, and load without connecting or credentials",async()=>{
  const storage=new Map(), h=harness(storage), dock=await h.open("A");
  input(dock,"호스트").value="server.test";input(dock,"계정").value="student";
  input(dock,"비밀번호").value="never-persist";input(dock,"즐겨찾기 이름").value="실습 서버";input(dock,"그룹 (선택)").value="학교";
  await button(dock,"즐겨찾기 저장").fire("click");
  let saved=JSON.parse(storage.get("classdockSshFavoritesV1"));
  assert.equal(saved[0].name,"실습 서버");assert.equal(saved[0].group,"학교");
  assert.deepEqual(Object.keys(saved[0]).sort(),["authentication","group","host","id","name","port","user"]);
  assert.doesNotMatch(storage.get("classdockSshFavoritesV1"),/never-persist/);
  const select=find(dock,node=>node.attributes["aria-label"]==="서버 즐겨찾기");
  input(dock,"호스트").value="changed.test";select.value=saved[0].id;select.fire("change");
  assert.equal(input(dock,"호스트").value,"server.test");assert.equal(input(dock,"비밀번호").value,"");
  assert.equal(h.calls.some(url=>url==="/ssh-session-open"),false);
  const search=find(dock,node=>node.placeholder==="이름·그룹·주소 검색");
  search.value="학교";search.fire("input");assert.equal(select.children.length,2);
  search.value="없는 서버";search.fire("input");assert.equal(select.children.length,1);
  search.value="";search.fire("input");select.value=saved[0].id;
  input(dock,"즐겨찾기 이름").value="수정한 이름";button(dock,"즐겨찾기 저장").fire("click");
  saved=JSON.parse(storage.get("classdockSshFavoritesV1"));assert.equal(saved.length,1);assert.equal(saved[0].name,"수정한 이름");
  const other=await h.open("B"), otherSelect=find(other,node=>node.attributes["aria-label"]==="서버 즐겨찾기");
  assert.equal(otherSelect.children.length,2);
  otherSelect.value=saved[0].id;button(other,"선택 삭제").fire("click");assert.deepEqual(JSON.parse(storage.get("classdockSshFavoritesV1")),[]);
});

test("recent requests are deduplicated, clearable and omit credentials",async()=>{
  const storage=new Map(), h=harness(storage), dock=await h.open("A");
  await h.connect(dock,"server.test");
  assert.equal(JSON.parse(storage.get("classdockSshRecentsV1")).length,1);
  assert.doesNotMatch(storage.get("classdockSshRecentsV1"),/secret|password.*:/);
  await button(dock,"접속 정보").fire("click");await h.connect(dock,"server.test");
  assert.equal(JSON.parse(storage.get("classdockSshRecentsV1")).length,1);
  await button(dock,"접속 정보").fire("click");button(dock,"최근 기록 지우기").fire("click");
  assert.equal(storage.has("classdockSshRecentsV1"),false);assert.equal(storage.has("classdockSshProfileV1"),false);
  await h.api.close();
});

test("현재 폴더는 명령 입력 없이 자동으로 채우고 파일명과 업로드 수동 경로는 유지한다",async()=>{
  const h=harness(), dock=await h.open("A");await h.connect(dock,"server-A");
  const upload=byClass(dock,"ssh-upload-path-picker").children[0];upload.value="/keep/uploads";upload.fire("input");
  await button(dock,"원격 파일").fire("click");
  const pathInput=input(dock,"원격 파일 경로");
  await h.pollReply("server-A","\x1b]7;file://server-A/stale\x07",20);
  assert.equal(pathInput.value,"");assert.equal(h.inputs.length,0,"opening the panel never sends a shell command");
  assert.equal(button(dock,"현재 경로 가져오기"),null);
  const reply=directoryReply("server-A","/home/user/"+encodeURIComponent("한글 폴더 100%"));
  await h.pollReply("server-A",reply.slice(0,-1),70);assert.equal(pathInput.value,"");
  await h.pollReply("server-A",reply.slice(-1),71);
  assert.equal(pathInput.value,"/home/user/한글 폴더 100%/");assert.equal(upload.value,"/keep/uploads");
  assert.equal(h.calls.some(url=>url.startsWith("/ssh-file-")),false,"folder lookup does not authenticate a file connection");
  pathInput.value+="chart.png";pathInput.oninput();
  await h.pollReply("server-A",directoryReply("server-A","/home/user/new"),120);
  assert.equal(pathInput.value,"/home/user/한글 폴더 100%/chart.png");assert.equal(upload.value,"/keep/uploads");
  pathInput.value="";pathInput.oninput();assert.equal(pathInput.value,"/home/user/new/");
  assert.equal(h.inputs.length,0);
});

test("다른 셸의 경로와 오래된 출력은 자동 입력을 덮어쓰지 않고 재접속 시 경로를 비운다",async()=>{
  const h=harness(), dock=await h.open("A");await h.connect(dock,"server-A");
  await h.pollReply("server-A",directoryReply("server-A","/first"),40);await button(dock,"원격 파일").fire("click");
  const pathInput=input(dock,"원격 파일 경로"), upload=byClass(dock,"ssh-upload-path-picker").children[0];
  assert.equal(pathInput.value,"/first/");assert.equal(upload.value,"/first/");
  await h.pollReply("server-A",directoryReply("server-A","/second"),90);
  await h.pollReply("server-A",directoryReply("nested-server","/wrong")+"ordinary output",150);
  assert.equal(pathInput.value,"/second/");assert.equal(upload.value,"/second/");
  button(dock,"터미널로 돌아가기").onclick();
  await h.pollReply("server-A",directoryReply("server-A","/"),190);await button(dock,"원격 파일").fire("click");
  assert.equal(pathInput.value,"/");
  await button(dock,"연결 끊기").fire("click");assert.equal(pathInput.value,"");
  await button(dock,"접속 정보").fire("click");await h.connect(dock,"server-B");await button(dock,"원격 파일").fire("click");
  await h.pollReply("server-B",directoryReply("server-A","/old-server"),30);assert.equal(pathInput.value,"");
  await h.pollReply("server-B",directoryReply("server-B","/new-server"),80);assert.equal(pathInput.value,"/new-server/");
});

test("경로 알림이 없는 셸에서도 직접 입력할 수 있고 입력 명령을 자동으로 보내지 않는다",async()=>{
  const h=harness(), dock=await h.open("A");await h.connect(dock,"server-A");await button(dock,"원격 파일").fire("click");
  const panel=byClass(dock,"ssh-file-panel"), pathInput=input(dock,"원격 파일 경로");
  pathInput.value="/keep/file.txt";
  pathInput.oninput();h.flushTimers(6000);await h.pollReply("server-A","user@host:~$ ",20);
  assert.equal(pathInput.value,"/keep/file.txt");assert.equal(h.inputs.length,0);
  assert.ok(find(panel,node=>node.textContent.includes("지원하지 않는 셸에서는 전체 파일 경로")));
});

test("미리보기로 숨겨진 터미널은 20x5로 줄이지 않고 복귀할 때만 실제 크기로 맞춘다",async()=>{
  const h=harness(), dock=await h.open("A");await h.connect(dock,"server-A");
  const terminal=h.terminals[0], host=byClass(dock,"ssh-xterm-host"), original={cols:terminal.cols,rows:terminal.rows};
  await button(dock,"원격 파일").fire("click");assert.equal(host.hidden,true);
  host.clientWidth=0;host.clientHeight=0;h.resize();h.flushTimers(100);
  assert.deepEqual({cols:terminal.cols,rows:terminal.rows},original);
  assert.equal(h.calls.some(url=>url.startsWith("/ssh-session-resize")),false);
  button(dock,"터미널로 돌아가기").onclick();host.clientWidth=800;host.clientHeight=600;
  h.flushTimers(0);h.flushTimers(100);
  assert.equal(host.hidden,false);assert.ok(terminal.cols>original.cols);assert.ok(terminal.rows>original.rows);
  assert.equal(h.calls.filter(url=>url.startsWith("/ssh-session-resize")).length,1);
});

test("재접속 응답 전에 작업공간을 바꿔도 현재 배치와 복귀 배치를 보존한다", async () => {
  const h = harness(new Map([["classdockSshDockV3", JSON.stringify({ A:{ width:460 }, B:{ width:680 } })]]));
  const a = await h.open("A"); await h.connect(a, "server-A");
  const b = await h.open("B");
  await button(b, "⇄").fire("click"); await button(b, "접기").fire("click");
  h.switchTo("A");
  const stop = deferred(); h.pendingStops.set("server-A", stop);
  const reconnect = button(a, "접속 정보").fire("click"); await settle();
  h.switchTo("B"); stop.resolve(response()); await reconnect;
  assert.equal(h.main.classList.contains("ssh-dock-left"), true);
  assert.equal(h.main.classList.contains("ssh-dock-collapsed"), true);
  assert.equal(h.main.style.values["--ssh-dock-width"], "680px");
  h.switchTo("A");
  assert.equal(h.main.classList.contains("ssh-dock-left"), false);
  assert.equal(h.main.classList.contains("ssh-dock-collapsed"), false);
  assert.equal(h.main.style.values["--ssh-dock-width"], "460px");
  assert.equal(byClass(a, "ssh-connect-view").hidden, false);
});

test("다른 작업공간이 최근 접속 정보를 저장해도 다시 연 터미널의 인증과 기본 포트를 유지한다", async () => {
  const storage = new Map(), h = harness(storage);
  const a = await h.open("A"); await h.connect(a, "server-A", "private-key");
  await h.api.close();
  const b = await h.open("B"); await h.connect(b, "server-B", "password", "2222");
  await h.open("A");
  assert.equal(input(a, "호스트").value, "server-A");
  assert.equal(input(a, "포트").value, "22");
  assert.equal(input(a, "인증 방식").value, "private-key");
  assert.equal(input(a, "키 암호 (암호화된 키만)").value, "");
  input(a, "호스트").value = "";
  await h.api.close(); await h.open("A");
  assert.equal(input(a, "호스트").value, "", "intentional blank input must also survive reopen");
  const fresh = await harness(storage).open("C");
  assert.equal(input(fresh, "호스트").value, "server-B", "a new instance still receives the recent profile");
  assert.equal(input(fresh, "포트").value, "2222");
});

test("배경에서 멈춘 출력은 복귀 후 끝까지 받고 나서만 서버에 회수를 요청한다", async () => {
  const h = harness(), a = await h.open("A"); await h.connect(a, "server-A");
  h.switchTo("B"); await h.pollReply("server-A", "before\n", 7);
  assert.equal(h.calls.filter((url) => url.startsWith("/ssh-session-poll")).length, 1);
  assert.equal(h.calls.some((url) => url.startsWith("/ssh-session-stop")), false);
  h.switchTo("A"); await settle();
  assert.ok(h.calls.includes("/ssh-session-poll?id=server-A&offset=7"));
  await h.pollReply("server-A", "last-one\n", 16, true, true);
  assert.equal(h.calls.some((url) => url.startsWith("/ssh-session-stop")), false);
  await h.pollReply("server-A", "last-two\n", 25, true, false);
  assert.ok(h.terminals[0].output.includes("before\nlast-one\nlast-two\n"));
  assert.equal(h.calls.filter((url) => url === "/ssh-session-stop?id=server-A").length, 1);
  assert.equal(byClass(a, "ssh-session-status").textContent, "정상 종료");
});
