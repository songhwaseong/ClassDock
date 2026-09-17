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

// 실제 단축키 핸들러와 공용 히스토리를 함께 실행한다. 브라우저 없이 셀 포커스만 흉내 낸다.
function tableHistoryKeyboard(){
  const source = fs.readFileSync(path.join(__dirname, "../src/js/mnote.js"), "utf8");
  const start = source.indexOf("  const onHistoryKey = (e) => {");
  const end = source.indexOf('  document.addEventListener("keydown", onHistoryKey', start);
  assert.ok(start >= 0 && end > start);
  const doc = {};
  const cell = { closest:() => cell };
  const outsideInput = { closest:(selector) => selector === ".mnote-table-cell" ? null : outsideInput };
  const context = { setTimeout, clearTimeout, doc, state:doc, root:{ contains:target => target === cell } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js/history.js"), "utf8")
    + "\nglobalThis.historyApi = MNEditHistory;", context);
  let rows = [["이름", "점수"], ["민수", "95"]];
  context.history = context.historyApi.create({
    capture:() => JSON.stringify(rows),
    apply:snapshot => { rows = JSON.parse(snapshot); },
    isEqual:(a, b) => a === b
  });
  context.history.reset();
  vm.runInContext(source.slice(start, end) + "\nglobalThis.handleKey = onHistoryKey;", context);
  return {
    context, outsideInput,
    rows:() => rows,
    change(fn, pending = false){
      context.history.flush();
      fn(rows);
      if (pending) context.history.commitSoon(400);
      else context.history.commit();
    },
    key(key, options = {}){
      const event = {
        key, target:cell, ctrlKey:true, prevented:false,
        preventDefault(){ this.prevented = true; }, stopPropagation(){}, ...options
      };
      context.handleKey(event);
      return event;
    }
  };
}

test("표 셀 포커스에서 행 추가·열 삭제를 Ctrl+Z로 순서대로 되돌리고 다시 실행한다", () => {
  const editor = tableHistoryKeyboard();
  const original = JSON.stringify(editor.rows());
  editor.change(rows => rows.push(["영희", "88"]));
  const added = JSON.stringify(editor.rows());
  editor.change(rows => rows.forEach(row => row.splice(1, 1)));
  const removed = JSON.stringify(editor.rows());
  assert.equal(editor.key("z").prevented, true);
  assert.equal(JSON.stringify(editor.rows()), added);
  editor.key("z");
  assert.equal(JSON.stringify(editor.rows()), original);
  editor.key("y");
  assert.equal(JSON.stringify(editor.rows()), added);
  editor.key("z", { shiftKey:true });
  assert.equal(JSON.stringify(editor.rows()), removed);
});

test("셀 입력 직후 되돌리면 입력부터 취소하고 다음 단계에서 행 추가를 취소한다", () => {
  const editor = tableHistoryKeyboard();
  editor.change(rows => rows.push(["", ""]));
  editor.change(rows => { rows[2][0] = "새 학생"; }, true);
  editor.key("z");
  assert.deepEqual(editor.rows()[2], ["", ""]);
  editor.key("z");
  assert.equal(editor.rows().length, 2);
  editor.key("y");
  editor.key("y");
  assert.equal(editor.rows()[2][0], "새 학생");
});

test("다른 입력창·비활성 문서·한글 조합 중에는 표 히스토리를 건드리지 않는다", () => {
  const editor = tableHistoryKeyboard();
  editor.change(rows => rows.push(["", ""]));
  assert.equal(editor.key("z", { target:editor.outsideInput }).prevented, false);
  assert.equal(editor.key("z", { isComposing:true }).prevented, false);
  assert.equal(editor.key("z", { defaultPrevented:true }).prevented, false);
  editor.context.state = {};
  assert.equal(editor.key("z").prevented, false);
  assert.equal(editor.rows().length, 3);
  editor.context.state = editor.context.doc;
  assert.equal(editor.key("z", { ctrlKey:false, metaKey:true }).prevented, true);
  assert.equal(editor.rows().length, 2);
});

test("되돌린 뒤 새 셀 값을 입력하면 이전 다시실행이 새 값을 덮어쓰지 않는다", () => {
  const editor = tableHistoryKeyboard();
  editor.change(rows => rows.push(["", ""]));
  editor.key("z");
  editor.change(rows => { rows[1][1] = "100"; }, true);
  editor.key("y");
  assert.equal(editor.rows().length, 2);
  assert.equal(editor.rows()[1][1], "100");
  editor.key("z");
  assert.equal(editor.rows()[1][1], "95");
});

function loadMnoteScrollHelpers(context){
  const source = fs.readFileSync(path.join(__dirname, "../src/js/mnote.js"), "utf8");
  const helperStart = source.indexOf("  function growTextArea(area){");
  const helperEnd = source.indexOf("  /* ---- 글 블록 ---- */", helperStart);
  const renderStart = source.indexOf("  function renderBlocks(){");
  const renderEnd = source.indexOf("  // 검색 결과 클릭", renderStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && renderStart >= 0 && renderEnd > renderStart);
  vm.createContext(context);
  vm.runInContext(source.slice(helperStart, helperEnd) + source.slice(renderStart, renderEnd)
    + "\nglobalThis.scrollHelpers = { focusTableCell, renderBlocks };", context);
  return context.scrollHelpers;
}

test("표 버튼·되돌리기의 셀 포커스 복원은 세로·가로 스크롤을 유지한다", () => {
  const list = { scrollTop:640, scrollLeft:12 };
  const table = { scrollLeft:180 };
  const focusOptions = [];
  const cell = {
    closest:() => table,
    focus(options){
      focusOptions.push(options.preventScroll);
      if (!options.preventScroll) list.scrollTop = 900;
    }
  };
  const api = loadMnoteScrollHelpers({
    list,
    document:{ createRange:() => ({ selectNodeContents(){}, collapse(){} }) },
    window:{ getSelection:() => ({
      removeAllRanges(){},
      addRange(){ list.scrollTop = 900; list.scrollLeft = 0; table.scrollLeft = 400; }
    }) }
  });
  api.focusTableCell(cell, true);
  assert.equal(focusOptions[0], true);
  assert.equal(list.scrollTop, 640);
  assert.equal(list.scrollLeft, 12);
  assert.equal(table.scrollLeft, 180);
});

test("Tab·Enter로 셀을 이동할 때는 기본 포커스 스크롤을 허용한다", () => {
  const list = { scrollTop:0, scrollLeft:0 };
  const api = loadMnoteScrollHelpers({
    list,
    document:{ createRange:() => ({ selectNodeContents(){}, collapse(){} }) },
    window:{ getSelection:() => ({ removeAllRanges(){}, addRange(){} }) }
  });
  api.focusTableCell({ closest:() => null, focus(options){ if (!options.preventScroll) list.scrollTop = 400; } });
  assert.equal(list.scrollTop, 400);
});

test("문서를 다시 그린 뒤 글 높이를 먼저 복구하고 표별 스크롤 위치를 복원한다", () => {
  let top = 640, heightReady = true;
  const area = { style:{}, scrollHeight:900 };
  Object.defineProperty(area.style, "height", { set(value){ heightReady = value === "900px"; } });
  const table = (id, left) => ({ scrollLeft:left, closest:() => ({ dataset:{ blockId:id } }) });
  const oldTables = [table("a", 180), table("b", 75)];
  const newTables = [table("a", 0), table("b", 0)];
  let tables = oldTables;
  const list = {
    childElementCount:3, scrollLeft:15,
    get scrollTop(){ return top; },
    set scrollTop(value){ top = Math.min(value, heightReady ? 1200 : 100); },
    querySelectorAll(selector){ return selector === "textarea.mnote-text" ? [area] : tables; },
    replaceChildren(){ heightReady = false; top = 100; this.scrollLeft = 0; tables = newTables; }
  };
  const api = loadMnoteScrollHelpers({
    list, mnote:{ blocks:[{ type:"text" }, { type:"table" }, { type:"image" }] },
    renderText:() => ({}), renderTable:() => ({}), renderImage:() => ({}),
    requestAnimationFrame(){ assert.fail("편집 중 글 높이 복원을 다음 프레임으로 미루면 안 된다"); }
  });
  api.renderBlocks();
  assert.equal(list.scrollTop, 640);
  assert.equal(list.scrollLeft, 15);
  assert.deepEqual(newTables.map(item => item.scrollLeft), [180, 75]);
});
