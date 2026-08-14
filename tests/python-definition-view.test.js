const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isDefinitionSourceDoc } = require("../src/js/workspace-python.js");

const source = fs.readFileSync(
  path.join(__dirname, "../src/js/code-viewer.js"),
  "utf8"
);

test("external Python definitions use the chunked read-only viewer", () => {
  assert.equal(
    isDefinitionSourceDoc({
      sourceKey:"definition:C:/Python/site-packages/pkg/base.py"
    }),
    true
  );
  assert.equal(
    isDefinitionSourceDoc({ sourceKey:"workspace:main.py" }),
    false
  );
  assert.equal(isDefinitionSourceDoc(null), false);

  // 정의 미리보기 문서에는 어떤 언어든 실행 바를 붙이지 않는다(언어 판별 자체를 건너뛴다).
  assert.match(
    source,
    /const extRunLang = definitionSource \? null : runLangForExt\(ext\);/
  );
  assert.match(
    source,
    /const runnable = !!runLang;/
  );
  assert.match(
    source,
    /const canEdit = !definitionSource && !tooBigToEdit;/
  );
  assert.match(
    source,
    /const big = definitionSource \|\| heavy \|\| lineN > 6000;/
  );
});
