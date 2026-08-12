"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  whiteboardRecolorItem,
  whiteboardItemColor,
  whiteboardCanFlipItem,
  whiteboardFormulaReplacementRect,
  whiteboardPresetResizeItem,
  normalizeWhiteboardTextSize,
  normalizeWhiteboardObjectScale,
  whiteboardObjectScalePercent,
  boardStateFromSnapshot,
  whiteboardStencilGroup
} = require("../src/js/whiteboard.js");

test("텍스트 색상 변경은 원본을 보존한 새 항목을 만든다", () => {
  const original = { type:"text", x:10, y:20, text:"설명", fontSize:24, color:"#111111" };
  const changed = whiteboardRecolorItem(original, "#E11D48");

  assert.notEqual(changed, original);
  assert.equal(changed.color, "#e11d48");
  assert.equal(original.color, "#111111");
  assert.equal(whiteboardItemColor(changed), "#e11d48");
});

test("교육 도형 색상 변경은 내부 굵기·투명도를 보존하고 자식만 깊게 복제한다", () => {
  const original = whiteboardStencilGroup("stencil-grid", "#111111");
  const widths = original.items.map((item) => item.width);
  const alphas = original.items.map((item) => item.alpha);
  const changed = whiteboardRecolorItem(original, "#2563eb");

  assert.notEqual(changed, original);
  assert.notEqual(changed.items, original.items);
  assert.equal(changed.educationColor, "#2563eb");
  assert.equal(whiteboardItemColor(changed), "#2563eb");
  assert.deepEqual(changed.items.map((item) => item.width), widths);
  assert.deepEqual(changed.items.map((item) => item.alpha), alphas);
  assert.ok(changed.items.every((item) => item.color === "#2563eb"));
  assert.ok(original.items.every((item) => item.color === "#111111"));
});

test("텍스트 S/M/L은 처음 글자 크기를 기준으로 안정적으로 왕복한다", () => {
  const original = { type:"text", x:0, y:0, text:"단위", fontSize:32, color:"#111111" };
  const large = whiteboardPresetResizeItem(original, 1.5);
  const small = whiteboardPresetResizeItem(large, .75);
  const medium = whiteboardPresetResizeItem(small, 1);

  assert.equal(large.fontSize, 48);
  assert.equal(small.fontSize, 24);
  assert.equal(medium.fontSize, 32);
  assert.equal(original.fontSize, 32);
});

test("텍스트 직접 크기는 12~72px 범위에서 1px 단위로 정규화된다", () => {
  assert.equal(normalizeWhiteboardTextSize(12), 12);
  assert.equal(normalizeWhiteboardTextSize(31.6), 32);
  assert.equal(normalizeWhiteboardTextSize(100), 72);
  assert.equal(normalizeWhiteboardTextSize(5), 12);
  assert.equal(normalizeWhiteboardTextSize("", 24), 24);
  assert.equal(normalizeWhiteboardTextSize("잘못된 값", 24), 24);
});

test("새 텍스트 크기는 화이트보드 스냅샷에서 복원된다", () => {
  const restored = boardStateFromSnapshot({ version:1, textSize:37, items:[] });
  const legacy = boardStateFromSnapshot({ version:1, items:[] });

  assert.equal(restored.textSize, 37);
  assert.equal(legacy.textSize, 16);
});

test("수식과 수학·과학 도형의 직접 크기는 원본 대비 25~400%로 계산된다", () => {
  const formula = { type:"image", role:"education-formula", formulaBaseW:200, formulaBaseH:100, w:300, h:150 };
  const stencil = { type:"group", role:"education-stencil", sourceW:240, sourceH:190, w:180, h:143 };

  assert.equal(whiteboardObjectScalePercent(formula), 150);
  assert.equal(whiteboardObjectScalePercent(stencil), 75);
  assert.equal(normalizeWhiteboardObjectScale(225.6), 226);
  assert.equal(normalizeWhiteboardObjectScale(10), 25);
  assert.equal(normalizeWhiteboardObjectScale(500), 400);
});

test("옮긴 수식의 색상 변경은 화면 범위와 관계없이 위치와 크기를 보존한다", () => {
  const moved = {
    type:"image", role:"education-formula",
    x:1480, y:-220, w:300, h:150,
    formulaBaseW:200, formulaBaseH:100
  };

  assert.deepEqual(
    whiteboardFormulaReplacementRect(moved, 200, 100, 900, 600, true),
    { x:1480, y:-220, w:300, h:150 }
  );
});

test("화이트보드 일반 이미지와 수식 이미지는 좌우·상하 반전할 수 있다", () => {
  assert.equal(whiteboardCanFlipItem({ type:"image" }), true);
  assert.equal(whiteboardCanFlipItem({ type:"image", role:"education-formula" }), true);
  assert.equal(whiteboardCanFlipItem({ type:"group", role:"education-stencil" }), true);
  assert.equal(whiteboardCanFlipItem({ type:"text" }), false);
});

test("교육 도형 S/M/L은 원본 벡터 비율을 유지한다", () => {
  const original = whiteboardStencilGroup("stencil-triangle", "#16a34a");
  const small = whiteboardPresetResizeItem(original, .75);
  const large = whiteboardPresetResizeItem(original, 1.5);

  assert.deepEqual([small.w, small.h], [180, 143]);
  assert.deepEqual([large.w, large.h], [360, 285]);
  assert.deepEqual([original.w, original.h], [240, 190]);
});

test("선택 스타일 UI는 수식·텍스트·교육 도형·분리 도형을 종류별로 처리한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/whiteboard.js"), "utf8");

  assert.match(source, /replaceSelectedItem\(selected, whiteboardRecolorItem\(selected, c\)\)/);
  assert.match(source, /selected\.type === "text" \|\| \(selected\.type === "group" && selected\.role === "education-stencil"\)/);
  assert.match(source, /\["line","arrow","rect","ellipse","polyline"\]\.includes\(selected\.type\)/);
  assert.match(source, /sizeLabel = "선택한 텍스트 크기"/);
  assert.match(source, /sizeLabel = "선택한 교육 도형 크기"/);
  assert.match(source, /sizeLabel = "선택한 도형 선 굵기"/);
  assert.match(source, /setColor\(ink, \{ applySelected:false \}\)/);
  assert.match(source, /textSizeInput\.type = "number"/);
  assert.match(source, /contextTextSizeInput\.type="number"/);
  assert.match(source, /fontSize:size, textBaseFontSize:size/);
  assert.match(source, /textSize:wb\.textSize/);
  assert.match(source, /if \(selected\.type === "image"\) resizeSelectedFormula\(percent \/ 100\)/);
  assert.match(source, /else resizeSelectedPreset\(percent \/ 100\)/);
  assert.match(source, /const directLabel = formula \? "수식" : stencil \? "도형" : "글자"/);
});
