"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// python-viewer.js 분할본을 이어붙여 검사 — 패턴이 어느 조각에 있든 동일하게 매칭된다.
const pythonSource = ["code-viewer.js", "python-snippets.js", "python-editor.js", "python-run-context.js", "python-runtime.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8")).join("\n");
// notebook-viewer.js 분할본을 이어붙여 검사 — 패턴이 어느 조각에 있든 동일하게 매칭된다.
const notebookSource = ["notebook-model.js", "notebook-tools.js", "notebook-run.js", "notebook-pdf-export.js", "notebook-cells.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8")).join("\n");

test("브라우저 노트북 커널은 실행 폴더가 아닌 프로젝트 루트 전체에서 출력 파일을 찾는다", () => {
  assert.match(pythonSource, /outputRoot = workspace\.root/);
  assert.match(pythonSource, /outputs = collectOutputs\(outputRoot, snapshot\)/);
  assert.match(pythonSource, /workspace\.snapshots\.set\(outputRoot, snapshotFs\(outputRoot\)\)/);
});

test("노트북 출력 경로는 브라우저·로컬 커널 모두 프로젝트 루트 기준으로 보존한다", () => {
  assert.match(notebookSource, /logicalRoot:commonTopDir\(files\.map\(file => file\.path\)\) \|\| ""/);
  assert.match(notebookSource, /logicalRoot:workspaceBundle\.logicalRoot \|\| ""/);
  assert.match(notebookSource, /const path = normalizedRunPath\(output\.name\)/);
  assert.doesNotMatch(notebookSource, /logicalRoot:\s*(?:workspaceBundle|ws)\.logicalRoot \|\| cwd/);
  assert.doesNotMatch(notebookSource, /workspaceCwd \+ "\/" \+ String\(output\.name/);
});
