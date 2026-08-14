"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeScratchpadData,
  scratchpadNextTitle,
  scratchpadRemoveBlock,
  scratchpadNormalizeBlock,
  scratchpadNormalizeNotebookCell,
  scratchpadPlainText,
  scratchpadPreviewLines,
  scratchpadClipAround,
  scratchpadSearchNotes,
  scratchpadNoteCounts,
  scratchpadHasLockedBlocks
} = require("../src/js/scratchpad.js");

test("기존 단일 메모는 내용 손실 없이 첫 탭으로 이전한다", () => {
  const data = normalizeScratchpadData(null, "기존 메모 내용");
  assert.equal(data.version, 5);
  assert.equal(data.notes.length, 1);
  assert.equal(data.notes[0].title, "기존 메모");
  assert.equal(data.notes[0].blocks.length, 1);
  assert.equal(data.notes[0].blocks[0].type, "text");
  assert.equal(data.notes[0].blocks[0].text, "기존 메모 내용");
  assert.equal(data.notes[0].color, "yellow");
  assert.equal(data.activeId, data.notes[0].id);
});

test("메모 색상은 허용된 프리셋만 복원한다", () => {
  const data = normalizeScratchpadData({
    version:4,
    notes:[
      { id:"sage", title:"세이지", color:"sage", text:"초록" },
      { id:"invalid", title:"잘못된 색", color:"neon", text:"기본색" }
    ]
  });
  assert.equal(data.notes[0].color, "sage");
  assert.equal(data.notes[1].color, "yellow");
});

test("직접 고른 hex 메모 색은 유지하고 형식이 틀리면 기본색으로 되돌린다", () => {
  const data = normalizeScratchpadData({
    version:5,
    notes:[
      { id:"custom", title:"커스텀", color:"#A1B2C3", text:"hex 색" },
      { id:"short", title:"짧은 hex", color:"#123", text:"불량" },
      { id:"noHash", title:"샵 없음", color:"a1b2c3", text:"불량" }
    ]
  });
  assert.equal(data.notes[0].color, "#a1b2c3");
  assert.equal(data.notes[1].color, "yellow");
  assert.equal(data.notes[2].color, "yellow");
});

test("v2 텍스트 메모 탭과 활성 탭을 최신 블록 형식으로 복원한다", () => {
  const saved = {
    version:2,
    activeId:"two",
    notes:[
      { id:"one", title:"첫 메모", text:"하나" },
      { id:"two", title:"둘째 메모", text:"둘" }
    ]
  };
  const data = normalizeScratchpadData(saved);
  assert.deepEqual(data.notes.map(note => [note.id, note.title, note.blocks[0].text]), [
    ["one", "첫 메모", "하나"],
    ["two", "둘째 메모", "둘"]
  ]);
  assert.equal(data.activeId, "two");
});

test("텍스트와 이미지 블록의 배치 정보를 정규화한다", () => {
  const data = normalizeScratchpadData({
    version:3,
    notes:[{
      id:"mixed",
      title:"혼합 메모",
      blocks:[
        { id:"text-1", type:"text", text:"이미지 위 글" },
        { id:"image-1", type:"image", assetId:"asset-1", text:"이미지 옆 설명", position:"right", width:"large", name:"예제.png", size:123, locked:true }
      ]
    }]
  });
  assert.equal(data.notes[0].blocks[1].position, "right");
  assert.equal(data.notes[0].blocks[1].width, "large");
  assert.equal(data.notes[0].blocks[1].assetId, "asset-1");
  assert.equal(data.notes[0].blocks[0].locked, false);
  assert.equal(data.notes[0].blocks[1].locked, true);
  assert.equal(scratchpadHasLockedBlocks(data.notes[0]), true);
  assert.equal(scratchpadPlainText(data.notes[0]), "이미지 위 글\n\n[이미지: 예제.png]\n이미지 옆 설명");
});

test("잘못된 이미지 배치값은 안전한 기본값으로 바꾼다", () => {
  const block = scratchpadNormalizeBlock({
    type:"image",
    assetId:"asset-2",
    position:"floating",
    width:"huge"
  });
  assert.equal(block.position, "left");
  assert.equal(block.width, "medium");
  assert.equal(block.locked, false);
  assert.equal(scratchpadNormalizeBlock({ type:"image" }), null);
});

test("노트북 셀 블록은 코드·마크다운 내용을 보존하고 실행 메타데이터를 제거한다", () => {
  const block = scratchpadNormalizeBlock({
    id:"cell-1",
    type:"notebook-cell",
    cell:{
      type:"markdown",
      source:"## 메모 셀",
      attachments:{ "figure.png":{ "image/png":"AAAA" } },
      metadata:{ keep:true, classdock_execution:{ hash:"old" }, classdock_ink:[1, 2] }
    }
  });
  assert.equal(block.type, "notebook-cell");
  assert.equal(block.cell.type, "markdown");
  assert.equal(block.cell.source, "## 메모 셀");
  assert.deepEqual(block.cell.attachments, { "figure.png":{ "image/png":"AAAA" } });
  assert.deepEqual(block.cell.metadata, { keep:true });
  assert.match(scratchpadPlainText({ blocks:[block] }), /노트북 마크다운 셀/);
  assert.equal(scratchpadNormalizeNotebookCell(null), null);
});

test("잠긴 블록이 없는 메모는 전체 삭제를 막지 않는다", () => {
  assert.equal(scratchpadHasLockedBlocks({
    blocks:[
      { type:"text", text:"수정 가능", locked:false },
      { type:"image", assetId:"asset", locked:false }
    ]
  }), false);
});

test("새 메모 이름은 이미 사용 중인 번호를 건너뛴다", () => {
  assert.equal(scratchpadNextTitle([{ title:"새 메모 1" }, { title:"새 메모 3" }]), "새 메모 2");
});

test("마지막 노트북 셀 블록을 삭제하면 빈 글 블록으로 돌아간다", () => {
  const cell = {
    id:"cell-only",
    type:"notebook-cell",
    cell:{ type:"code", source:"print('hello')" },
    locked:false
  };
  const result = scratchpadRemoveBlock([cell], cell.id);
  assert.equal(result.removed, cell);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, "text");
  assert.equal(result.blocks[0].text, "");
  assert.equal(result.activeId, result.blocks[0].id);
});

test("마지막 이미지 블록도 삭제하고 빈 글 블록으로 돌아간다", () => {
  const image = { id:"image-only", type:"image", assetId:"asset-only", locked:false };
  const result = scratchpadRemoveBlock([image], image.id);
  assert.equal(result.removed, image);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, "text");
});

test("표 블록은 직사각형으로 정규화되고 복사 본문에 포함된다", () => {
  const table = scratchpadNormalizeBlock({
    id:"table-1",
    type:"table",
    rows:[["이름", "점수"], ["민수"]],
    header:true,
    locked:true
  });
  assert.equal(table.type, "table");
  assert.deepEqual(table.rows, [["이름", "점수"], ["민수", ""]]);
  assert.equal(table.header, true);
  assert.equal(table.locked, true);
  assert.equal(scratchpadPlainText({ blocks:[table] }), "이름\t점수\n민수\t");
});

test("마지막 표 블록도 삭제하면 빈 글 블록으로 돌아간다", () => {
  const table = {
    id:"table-only",
    type:"table",
    rows:[[""]],
    header:false,
    locked:false
  };
  const result = scratchpadRemoveBlock([table], table.id);
  assert.equal(result.removed, table);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, "text");
});

test("탭 미리보기는 빈 줄을 걸러 앞 세 줄만 뽑는다", () => {
  const note = { blocks:[
    { type:"text", text:"\n첫 줄\n\n  둘째 줄  \n" },
    { type:"text", text:"셋째 줄\n넷째 줄" }
  ] };
  assert.deepEqual(scratchpadPreviewLines(note), ["첫 줄", "둘째 줄", "셋째 줄", "…"]);
});

test("탭 미리보기는 긴 줄을 잘라내고 내용이 없으면 빈 배열을 준다", () => {
  const long = { blocks:[{ type:"text", text:"가".repeat(80) }] };
  assert.deepEqual(scratchpadPreviewLines(long, 3, 10), ["가".repeat(10) + "…"]);
  assert.deepEqual(scratchpadPreviewLines({ blocks:[{ type:"text", text:"  \n \n" }] }), []);
  assert.deepEqual(scratchpadPreviewLines(null), []);
});

test("탭 미리보기는 이미지·표 블록도 알아볼 수 있게 보여준다", () => {
  const note = { blocks:[
    { type:"image", name:"수업자료.png", text:"" },
    { type:"table", rows:[["이름", "점수"]] }
  ] };
  assert.deepEqual(scratchpadPreviewLines(note), ["[이미지: 수업자료.png]", "이름\t점수"]);
});

test("메모 검색: 검색어가 없으면 모든 메모를 앞부분 미리보기와 함께 준다", () => {
  const notes = [
    { id:"a", title:"첫 메모", blocks:[{ type:"text", text:"하나\n둘" }] },
    { id:"b", title:"둘째 메모", blocks:[{ type:"text", text:"" }] }
  ];
  const found = scratchpadSearchNotes(notes, "");
  assert.equal(found.length, 2);
  assert.deepEqual(found[0].lines, ["하나", "둘"]);
  assert.deepEqual(found[1].lines, []);
});

test("메모 검색: 본문이 맞는 메모만 남기고 일치한 줄을 보여 준다", () => {
  const notes = [
    { id:"a", title:"수업 준비", blocks:[{ type:"text", text:"색연필 24색\n도화지" }] },
    { id:"b", title:"회의록", blocks:[{ type:"text", text:"예산 확인\n색연필 추가 주문" }] },
    { id:"c", title:"기타", blocks:[{ type:"text", text:"관련 없음" }] }
  ];
  const found = scratchpadSearchNotes(notes, "색연필");
  assert.deepEqual(found.map(item => item.note.id), ["a", "b"]);
  assert.deepEqual(found[0].lines, ["색연필 24색"]);
  assert.deepEqual(found[1].lines, ["색연필 추가 주문"]);
  assert.equal(found[0].hits, 1);
});

test("메모 검색: 제목만 맞아도 남기고, 대소문자는 가리지 않는다", () => {
  const notes = [{ id:"a", title:"Python 메모", blocks:[{ type:"text", text:"본문에는 없음" }] }];
  const found = scratchpadSearchNotes(notes, "PYTHON");
  assert.equal(found.length, 1);
  assert.equal(found[0].titleHit, true);
  assert.equal(found[0].hits, 0);
  assert.deepEqual(found[0].lines, ["본문에는 없음"]);   // 일치한 줄이 없으면 앞부분을 보여 준다
  assert.deepEqual(scratchpadSearchNotes(notes, "없는말"), []);
});

test("메모 검색: 표·이미지·셀 본문도 함께 찾는다", () => {
  const notes = [
    { id:"t", title:"표", blocks:[{ type:"table", rows:[["이름", "점수"], ["민수", "90"]] }] },
    { id:"i", title:"그림", blocks:[{ type:"image", name:"민수사진.png", text:"" }] }
  ];
  assert.deepEqual(scratchpadSearchNotes(notes, "민수").map(item => item.note.id), ["t", "i"]);
});

test("긴 줄은 찾은 말이 보이도록 그 자리를 가운데 두고 자른다", () => {
  const line = "앞".repeat(60) + "핵심어" + "뒤".repeat(60);
  const clipped = scratchpadClipAround(line, "핵심어", 20);
  assert.ok(clipped.includes("핵심어"));
  assert.ok(clipped.startsWith("…") && clipped.endsWith("…"));
  assert.equal(scratchpadClipAround("짧은 줄", "줄", 20), "짧은 줄");            // 자를 필요가 없으면 그대로
  assert.equal(scratchpadClipAround("가".repeat(30), "없음", 10), "가".repeat(10) + "…");
});

test("미리보기 폭보다 긴 검색어도 일치한 문자열을 온전히 남긴다", () => {
  const needle = "긴검색어".repeat(30);
  const clipped = scratchpadClipAround("앞부분 " + needle + " 뒷부분", needle, 80);
  assert.ok(clipped.includes(needle));
  assert.ok(clipped.startsWith("…") && clipped.endsWith("…"));
});

test("메모 카드 요약은 글자 수와 블록 개수를 센다", () => {
  const counts = scratchpadNoteCounts({ blocks:[
    { type:"text", text:"열두 글자입니다" },
    { type:"image", name:"a.png", text:"설명" },
    { type:"table", rows:[["a"]] },
    { type:"notebook-cell", cell:{ type:"code", source:"print(1)" } }
  ] });
  assert.equal(counts.chars, "열두 글자입니다".length + "설명".length);
  assert.deepEqual([counts.images, counts.tables, counts.cells], [1, 1, 1]);
  assert.deepEqual(scratchpadNoteCounts(null), { chars:0, images:0, tables:0, cells:0 });
});
