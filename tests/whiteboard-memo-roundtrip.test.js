"use strict";

// 화이트보드 ↔ 메모창 왕복: 메모 이미지 블록이 편집용 벡터 스냅샷을 가리키는 고리(boardAssetId)와
// 그 스냅샷을 다시 보드 상태로 되살리는 변환을 고정한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const { scratchpadNormalizeBlock, normalizeScratchpadData } = require("../src/js/scratchpad.js");
const { boardStateFromSnapshot, boardRecoveryKey, chooseBoardSnapshot } = require("../src/js/whiteboard.js");

test("메모 이미지 블록은 화이트보드 스냅샷 고리를 저장·복원 뒤에도 유지한다", () => {
  const block = scratchpadNormalizeBlock({
    id:"image-1",
    type:"image",
    assetId:"asset-png",
    boardAssetId:"asset-board",
    boardName:"화이트보드 2",
    name:"화이트보드 2.png"
  });
  assert.equal(block.boardAssetId, "asset-board");
  assert.equal(block.boardName, "화이트보드 2");

  // 실제 저장 경로(localStorage JSON)를 한 바퀴 돌려도 고리가 남아야 "✏️ 화이트보드로"가 뜬다.
  const saved = JSON.parse(JSON.stringify({ version:5, notes:[{ id:"n1", title:"메모", blocks:[block] }] }));
  const restored = normalizeScratchpadData(saved).notes[0].blocks[0];
  assert.equal(restored.boardAssetId, "asset-board");
  assert.equal(restored.boardName, "화이트보드 2");
});

test("화이트보드에서 오지 않은 이미지 블록은 스냅샷 고리가 비어 있다", () => {
  const block = scratchpadNormalizeBlock({ type:"image", assetId:"asset-png" });
  assert.equal(block.boardAssetId, "");
  assert.equal(block.boardName, "");
});

test("메모가 돌려준 스냅샷은 편집 가능한 보드 상태로 되살아난다", () => {
  const snapshot = {
    version:1,
    bg:"#fffbea",
    items:[
      { type:"stroke", color:"#111111", width:4, pts:[{ x:1, y:2 }, { x:3, y:4 }] },
      { type:"image", x:10, y:20, w:100, h:80, src:"data:image/png;base64,AAAA" }
    ]
  };
  const state = boardStateFromSnapshot(snapshot);
  assert.equal(state.bg, "#fffbea");
  assert.equal(state.items.length, 2);
  assert.equal(state.selected, null);
  // 이미지는 src(data URL)만 들고 오고 <img>는 화면에서 되살린다.
  assert.equal(state.items[1].src, "data:image/png;base64,AAAA");
  assert.equal(state.items[1].img, undefined);
});

test("형식이 어긋난 스냅샷은 보드를 열지 않는다", () => {
  assert.equal(boardStateFromSnapshot(null), null);
  assert.equal(boardStateFromSnapshot({ version:2, items:[] }), null);
  assert.equal(boardStateFromSnapshot({ version:1, items:"stroke" }), null);
});

test("메모 에셋과 자동복원본 중 더 최근 화이트보드 상태를 고른다", () => {
  const saved = { version:1, savedAt:100, bg:"#ffffff", items:[{ type:"stroke", id:"saved" }] };
  const recovery = { version:1, savedAt:200, bg:"#ffffff", items:[{ type:"stroke", id:"recovery" }] };
  assert.equal(chooseBoardSnapshot(saved, recovery).items[0].id, "recovery");
  assert.equal(chooseBoardSnapshot(recovery, saved).items[0].id, "recovery");
  // 시각이 없는 예전 형식끼리는 메모에 확정 저장된 상태를 우선한다.
  assert.equal(chooseBoardSnapshot(
    { version:1, items:[{ id:"memo" }] },
    { version:1, items:[{ id:"old-recovery" }] }
  ).items[0].id, "memo");
});

test("메모에서 연 보드는 같은 이름의 일반 보드와 자동복원 칸을 나눠 쓴다", () => {
  assert.notEqual(boardRecoveryKey("화이트보드"), boardRecoveryKey("메모블록:image-1"));
});
