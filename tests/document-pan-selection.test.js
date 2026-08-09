const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const documents = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

test("read-only document text selection takes priority over hand-tool panning", () => {
  const start = documents.indexOf("function isPanIgnoredTarget");
  const end = documents.indexOf("function updatePannableState", start);
  const block = documents.slice(start, end);

  assert.match(block, /semanticText/);
  assert.match(block, /leafText/);
  assert.match(block, /getComputedStyle\(el\)\.userSelect/);
  assert.match(block, /if \(selectable\) return true/);
});

test("rendered Office text shows a text cursor while blank paper keeps grab", () => {
  assert.match(styles, /\.viewer\.pannable,\.office\.pannable\{cursor:grab\}/);
  assert.match(styles, /\.office\.pannable :where\(\.docx-host,\.hwp-host,\.pptx-host,\.doc-host\) span\{cursor:text\}/);
});
