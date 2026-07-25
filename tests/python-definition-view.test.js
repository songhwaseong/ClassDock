const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../src/js/code-viewer.js"),
  "utf8"
);

test("external Python definitions use the chunked read-only viewer", () => {
  const start = source.indexOf("function isDefinitionSourceDoc");
  const end = source.indexOf("async function openWorkspacePythonImportDefinition", start);
  const sandbox = {};
  vm.runInNewContext(
    source.slice(start, end) +
      "; this.isDefinitionSourceDoc = isDefinitionSourceDoc;",
    sandbox
  );

  assert.equal(
    sandbox.isDefinitionSourceDoc({
      sourceKey:"definition:C:/Python/site-packages/pkg/base.py"
    }),
    true
  );
  assert.equal(
    sandbox.isDefinitionSourceDoc({ sourceKey:"workspace:main.py" }),
    false
  );
  assert.equal(sandbox.isDefinitionSourceDoc(null), false);

  assert.match(
    source,
    /const runnable = RUN_EXTS\.has\(ext\) && !definitionSource;/
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
