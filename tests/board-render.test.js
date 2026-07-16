const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/js/board-render.js"), "utf8");
const context = {};
vm.runInNewContext(source + "\nthis.renderer = MNBoardRenderer;", context);
const renderer = context.renderer;

test("화이트보드 선택 판정은 도형·선·텍스트를 구분한다", () => {
  const measure = (line, size) => String(line).length * size * 0.5;
  assert.equal(renderer.hitTestItem({ type:"rect", x1:10, y1:20, x2:110, y2:80, width:2 }, { x:50, y:50 }, measure, 7), true);
  assert.equal(renderer.hitTestItem({ type:"ellipse", x1:10, y1:20, x2:110, y2:80, width:2 }, { x:60, y:50 }, measure, 7), true);
  assert.equal(renderer.hitTestItem({ type:"line", x1:10, y1:10, x2:100, y2:100, width:2 }, { x:52, y:49 }, measure, 7), true);
  assert.equal(renderer.hitTestItem({ type:"text", x:30, y:40, text:"수업", fontSize:20 }, { x:45, y:50 }, measure, 7), true);
  assert.equal(renderer.hitTestItem({ type:"text", x:30, y:40, text:"수업", fontSize:20 }, { x:200, y:200 }, measure, 7), false);
});

test("화이트보드 항목 이동은 원본을 바꾸지 않고 좌표를 함께 옮긴다", () => {
  const rect = { type:"rect", x1:10, y1:20, x2:50, y2:60, color:"#111" };
  const movedRect = renderer.translateItem(rect, 12, -5);
  assert.notEqual(movedRect, rect);
  assert.deepEqual([movedRect.x1, movedRect.y1, movedRect.x2, movedRect.y2], [22, 15, 62, 55]);
  assert.deepEqual([rect.x1, rect.y1, rect.x2, rect.y2], [10, 20, 50, 60]);

  const text = { type:"text", x:5, y:8, text:"안내", fontSize:16 };
  const movedText = renderer.translateItem(text, -2, 9);
  assert.deepEqual([movedText.x, movedText.y], [3, 17]);
  assert.deepEqual([text.x, text.y], [5, 8]);
});
