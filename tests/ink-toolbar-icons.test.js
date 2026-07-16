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
