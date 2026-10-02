"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {Terminal}=require("../vendor/xterm.js");

// Exercise the real vendored xterm parser and buffers in Node; no browser or screen capture.
const context={TextEncoder,TextDecoder,document:{getElementById:()=>null}};
const source=fs.readFileSync(path.join(__dirname,"../src/js/remote-terminal.js"),"utf8")
  .replace("const terminalSnapshot = ","const terminalSnapshot = globalThis.snapshot = ");
vm.runInNewContext(source,context);
const write=(term,text)=>new Promise(resolve=>term.write(text,resolve));

test("terminal search joins soft wraps and maps Korean, emoji and combining characters to cells",async()=>{
  const terminal=new Terminal({cols:6,rows:4});
  try{
    await write(terminal,"ab한cdEF\r\n😀e\u0301끝");
    const result=context.snapshot(terminal,"한cdEF");
    assert.equal(result.text,"ab한cdEF\n😀e\u0301끝");
    assert.equal(JSON.stringify(result.matches),JSON.stringify([{row:0,column:2,length:6}]));
    const emoji=context.snapshot(terminal,"😀e\u0301");
    // The bundled default Unicode provider renders this emoji as one cell.
    assert.equal(JSON.stringify(emoji.matches),JSON.stringify([{row:2,column:0,length:2}]));
    assert.equal(context.snapshot(terminal,"EF😀").matches.length,0,"hard newlines are not soft wraps");
  }finally{terminal.dispose();}
});

test("output export reflects overwritten rendered text, excludes escape codes and respects active buffer",async()=>{
  const terminal=new Terminal({cols:20,rows:3,scrollback:5});
  try{
    await write(terminal,"\x1b[31mold progress\x1b[0m\r\x1b[2Kdone\r\n  indented  ");
    assert.equal(context.snapshot(terminal).text,"done\n  indented  ");
    await write(terminal,"\x1b[?1049hALT");
    assert.match(context.snapshot(terminal).text,/ALT/);
    assert.doesNotMatch(context.snapshot(terminal).text,/done/);
    await write(terminal,"\x1b[?1049l");
    assert.match(context.snapshot(terminal).text,/done/);
    await write(terminal,"\r\n"+Array.from({length:15},(_,n)=>"line"+n).join("\r\n"));
    assert.doesNotMatch(context.snapshot(terminal).text,/done|line0\n/);
    assert.match(context.snapshot(terminal).text,/line14$/);
  }finally{terminal.dispose();}
});

test("search caps matches and preserves a double-width character wrapped at the last column",async()=>{
  const terminal=new Terminal({cols:6,rows:3,scrollback:1500});
  try{
    await write(terminal,"abcde한글");
    assert.equal(context.snapshot(terminal).text,"abcde한글");
    const match=context.snapshot(terminal,"e한").matches[0];
    assert.equal(JSON.stringify(match),JSON.stringify({row:0,column:4,length:4}));
    await write(terminal,"\r\n"+"x".repeat(6000));
    const result=context.snapshot(terminal,"x");
    assert.equal(result.matches.length,5000);assert.equal(result.limited,true);
  }finally{terminal.dispose();}
});
