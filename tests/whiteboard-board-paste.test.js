"use strict";

// 화이트보드 보드 내용 JSON 붙여넣기: 메모 스냅샷 모양의 글만 받고, 수식·그래프는 재료만 적어도
// 붙일 때 그리도록 갈라 두며, 단계 번호는 어느 갈래로 가든 따라온다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { whiteboardPastedBoardEntries } = require("../src/js/whiteboard.js");

const source = fs.readFileSync(path.join(__dirname, "../src/js/whiteboard.js"), "utf8");
const board = (items, extra={}) => JSON.stringify({ version:1, items, ...extra });

test("보드 스냅샷 모양이 아닌 글은 붙여넣기 대상이 아니다", () => {
  for (const text of ["", "안녕하세요", "[1,2,3]", "{", "{\"items\":[]}", board([]), JSON.stringify({ version:2, items:[{ type:"text", x:0, y:0, text:"a" }] }), null, undefined]){
    assert.equal(whiteboardPastedBoardEntries(text), null, String(text));
  }
  // 알 수 없는 항목(펜 획 등)만 있으면 붙일 것이 없다.
  assert.equal(whiteboardPastedBoardEntries(board([{ type:"pen", points:[] }, { type:"image", src:"https://example.com/a.png" }])), null);
});

test("수식은 formulaSource 만 있어도 붙일 때 그릴 재료로 넘긴다", () => {
  const [entry] = whiteboardPastedBoardEntries(board([
    { type:"image", role:"education-formula", formulaSource:"  x^2  ", formulaColor:"#DC2626", x:10, y:"20", scale:0.6, w:300, step:3 }
  ]));
  assert.deepEqual(entry, { kind:"formula", source:"x^2", color:"#dc2626", x:10, y:20, w:300, scale:0.6, step:3 });
  // 색이 이상하면 검정, 배율은 0~4 로 가둔다.
  const [plain] = whiteboardPastedBoardEntries(board([{ type:"image", role:"education-formula", formulaSource:"a", formulaColor:"red", scale:9 }]));
  assert.equal(plain.color, "#111111");
  assert.equal(plain.scale, 4);
  assert.equal(plain.step, 0);
  // 너무 긴 수식은 수식 창과 같은 4,000자 한도에 걸려 빠진다.
  assert.equal(whiteboardPastedBoardEntries(board([{ type:"image", role:"education-formula", formulaSource:"x".repeat(4001) }])), null);
});

test("그래프는 plotSpec 만 있으면 재료로, 그려진 그룹은 그대로 받는다", () => {
  const spec = { curves:[{ source:"x^2" }], xMin:-2, xMax:2 };
  const [plot] = whiteboardPastedBoardEntries(board([{ type:"group", role:"education-plot", plotSpec:spec, x:5, y:6, w:400, step:2 }]));
  assert.equal(plot.kind, "plot");
  assert.deepEqual(plot.spec, spec);
  assert.deepEqual([plot.x, plot.y, plot.w, plot.h, plot.step], [5, 6, 400, 0, 2]);
  const drawn = { type:"group", role:"education-plot", plotSpec:spec, x:0, y:0, w:10, h:10, sourceW:10, sourceH:10, items:[{ type:"line", x1:0, y1:0, x2:10, y2:10 }], step:4 };
  const [kept] = whiteboardPastedBoardEntries(board([drawn]));
  assert.equal(kept.kind, "item");
  assert.equal(kept.item.items.length, 1);
  assert.equal(kept.item.step, 4);
});

test("일반 항목은 복사·붙여넣기와 같은 검사를 거치고 단계 번호를 지닌다", () => {
  const entries = whiteboardPastedBoardEntries(board([
    { type:"text", x:1, y:2, text:"① 착안", fontSize:21, color:"#1d4ed8", step:1 },
    { type:"rect", x1:0, y1:0, x2:5, y2:5, color:"#000000", width:2, mid:"m1" },
    { type:"image", src:"data:image/png;base64,AAAA", x:0, y:0, w:1, h:1 },
    { type:"pen", points:[{ x:0, y:0 }] }
  ]));
  assert.deepEqual(entries.map((e) => e.kind), ["item", "item", "item"]);
  assert.equal(entries[0].item.step, 1);
  assert.equal(entries[0].step, 1);
  assert.equal("mid" in entries[1].item, false, "측정 연결 식별자는 떼어 낸다");
});

test("보드는 Ctrl+V 글에서 이 경로로 들이고, 한 번에 화면에 맞춰 줄인다", () => {
  assert.match(source, /const entries = whiteboardPastedBoardEntries\(e\.clipboardData && e\.clipboardData\.getData\("text\/plain"\)\);/);
  assert.match(source, /const placed = ungroupBoardItem\(wrapper, measureBoardText\)/);
  assert.match(source, /Promise\.allSettled\(entries\.map/);
});
