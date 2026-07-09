"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/js/python-viewer.js"), "utf8");

test("파이썬 편집기에서 실행 기준 폴더를 선택하는 경로 도우미를 노출한다", () => {
  assert.match(source, /pathHelpBtn\.textContent = "경로 도우미"/);
  assert.doesNotMatch(source, /pathHelpBtn\.hidden = true/);
  assert.match(source, /auto\.textContent = "자동 감지 \("/);
  assert.match(source, /cwdLabel\.textContent = "실행 기준 폴더"/);
});

test("열린 Python 파일 묶음은 실제 프로젝트 경로와 선택한 실행 기준을 보존한다", () => {
  assert.match(source, /preferredCwd:pythonPreferredRunCwd\(runCtx\)/);
  assert.match(source, /putBytes\(item\.path, bytes, 500\)/);
  assert.match(source, /cwd:normalizedRunPath\(projCtx\.cwd\) \|\| dir/);
  assert.match(source, /logicalRoot:commonTopDir\(files\.map\(file => file\.path\)\) \|\| ""/);
});
