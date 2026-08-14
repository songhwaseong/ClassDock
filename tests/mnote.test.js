"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMnote(){
  const context = {
    console, Blob, URL, Map, Set, Date, Math, JSON,
    setTimeout, clearTimeout,
    document:{},
    window:{}
  };
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/mnote.js"), "utf8");
  vm.runInContext(source + `
    ;globalThis.__mnote = {
      mnoteEmpty, mnoteParse, mnoteSerialize, mnotePlainText,
      mnoteBlockMatchesQuery, mnoteToHtml, mnoteToMarkdown,
      mnoteHistorySnapshot, mnoteHistoryState
    };`, context);
  return context.__mnote;
}

test(".mnote는 같은 모델을 항상 같은 JSON으로 직렬화한다", () => {
  const api = loadMnote();
  const note = api.mnoteEmpty("수업 노트");
  note.createdAt = 100;
  note.updatedAt = 200;
  const first = api.mnoteSerialize(note);
  const second = api.mnoteSerialize(note);
  assert.equal(first, second);
  assert.equal(api.mnoteParse(first).updatedAt, 200);
});

test("지원하지 않는 버전과 블록 종류는 편집 모델로 열지 않는다", () => {
  const api = loadMnote();
  const base = {
    format:"classdock-note", version:1, title:"안전",
    createdAt:1, updatedAt:1, blocks:[{ type:"text", text:"보존" }]
  };
  assert.throws(() => api.mnoteParse(JSON.stringify({ ...base, version:2 })), /mnote-format/);
  assert.throws(() => api.mnoteParse(JSON.stringify({
    ...base, blocks:[{ type:"future-block", payload:"잃으면 안 됨" }]
  })), /mnote-block-type/);
});

test("표·이미지·글 본문과 이미지 파일명은 같은 검색 규칙을 쓴다", () => {
  const api = loadMnote();
  const blocks = [
    { type:"text", text:"설명 문단" },
    { type:"table", rows:[["이름", "점수"], ["민수", "95"]] },
    { type:"image", name:"실험결과.png", caption:"그래프 설명" }
  ];
  const text = api.mnotePlainText({ blocks });
  assert.match(text, /민수\t95/);
  assert.match(text, /실험결과\.png/);
  assert.equal(api.mnoteBlockMatchesQuery(blocks[2], "실험결과"), true);
  assert.equal(api.mnoteBlockMatchesQuery(blocks[2], "그래프 설명"), true);
});

test("큰 이미지 원본은 히스토리에 복제하지 않고 되돌릴 때 복원한다", () => {
  const api = loadMnote();
  const src = "data:image/png;base64," + "A".repeat(10 * 1024 * 1024);
  const note = {
    title:"큰 이미지", updatedAt:20,
    blocks:[
      { id:"image-1", type:"image", src, name:"큰그림.png", mime:"image/png", width:"medium", caption:"" },
      { id:"text-1", type:"text", text:"설명" }
    ]
  };
  const imageSources = new Map();
  const snapshot = api.mnoteHistorySnapshot(note, imageSources);
  assert.ok(snapshot.length < 1000, "base64가 단계마다 복제되면 안 된다");
  assert.equal(imageSources.get("image-1"), src);
  const restored = api.mnoteHistoryState(snapshot, imageSources);
  assert.equal(restored.blocks[0].src, src);
  assert.equal(restored.updatedAt, 20);
});

test("HTML과 Markdown 내보내기는 혼합 블록을 모두 포함한다", () => {
  const api = loadMnote();
  const note = {
    title:"공유 <문서>",
    blocks:[
      { type:"text", text:"첫 문단\n둘째 줄" },
      { type:"table", header:true, rows:[["항목", "값"], ["A", "1"]] },
      { type:"image", src:"data:image/png;base64,AAAA", name:"그림.png", caption:"설명" }
    ]
  };
  const html = api.mnoteToHtml(note);
  const md = api.mnoteToMarkdown(note);
  assert.match(html, /공유 &lt;문서&gt;/);
  assert.match(html, /<table>/);
  assert.match(html, /data:image\/png;base64,AAAA/);
  assert.match(md, /\| 항목 \| 값 \|/);
  assert.match(md, /!\[그림\.png\]\(data:image\/png;base64,AAAA\)/);
});

test("사이드바 아래 + 메뉴에서 새 .mnote 문서를 만들 수 있다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  assert.match(html, /id="sbNewMnote"[\s\S]*새 블록 문서\(\.mnote\)/);
  assert.match(app, /byId\("sbNewMnote"\)\.onclick[\s\S]*newMnoteScratch\(\)/);
  assert.match(app, /const items = \[[^\]]*byId\("sbNewMnote"\)/);
});

test("저장한 .mnote 는 자동 복원 사본에도 반영된다", () => {
  // saveTextDoc 은 디스크에만 쓴다. 편집 직후 저장하면 MNOTE_RECOVERY_DELAY 타이머가
  // hasUnsavedEdits=false 를 보고 건너뛰므로, 저장 자리에서 작업공간 사본까지 맞춰야 한다.
  const source = fs.readFileSync(path.join(__dirname, "../src/js/mnote.js"), "utf8");
  assert.match(source, /markDocumentSavedSnapshot\(doc, new TextEncoder\(\)\.encode\(json\), "application\/json"\)/);
});
