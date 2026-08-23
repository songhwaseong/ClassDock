const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, "src", "js", name), "utf8");

test("공용 아이콘 모듈은 필기 도구 SVG와 라벨 도우미를 제공한다", () => {
  const source = read("icons.js");
  for (const name of ["select", "pen", "highlighter", "eraser", "undo", "redo", "move", "rect", "mosaic"]){
    assert.match(source, new RegExp("\\b" + name + ":\\s*'<"), name);
  }
  assert.match(source, /window\.setUiIconLabel\s*=/);
});

test("필기·표시 도구막대는 삭제될 수 있는 이모지 대신 공용 SVG를 직접 사용한다", () => {
  const files = ["pdf-editor.js", "python-runtime.js", "notebook-tools.js", "image-viewer.js", "code-viewer.js"];
  for (const file of files){
    const source = read(file);
    assert.match(source, /setUiIcon|setLabeledIcon/, file);
    assert.doesNotMatch(source, /🖱|🖍|🧽|✏️/, file);
  }
});

test("화이트보드 도구막대도 이모지 라벨 대신 자기 SVG를 쓴다", () => {
  /* icons.js 는 앱 UI 의 색상 이모지를 걷어내는데, 짝이 되는 단색 SVG 가 없으면 글자만 사라져
     그림 없는 빈 버튼이 남는다 — 지도(🗺️)·환율(💱) 버튼이 실제로 그렇게 비어 보였다.
     화이트보드는 공용 icons.js 가 아니라 자기 WB_ICONS 를 쓰므로 여기서 따로 지킨다. */
  const source = read("whiteboard.js");
  assert.doesNotMatch(source, /mkBtn\("[^"]*[\u{1F000}-\u{1FAFF}]/u);
  for (const name of ["map", "exchange"]) assert.match(source, new RegExp("\\n\\s*" + name + ":\\s*'<"), name);
});
