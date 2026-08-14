"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const documentTypesSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "js", "document-types.js"),
  "utf8"
);

test(".tokens files are registered as plain text documents", () => {
  assert.match(documentTypesSource, /\btokens\s*:\s*["']text["']/);
  assert.match(documentTypesSource, /TEXT_ENCODING_EXTS[^\n]+Object\.keys\(CODE_EXTS\)/);
  assert.match(documentTypesSource, /ZIP_OPENABLE[\s\S]+?Object\.keys\(CODE_EXTS\)/);
});
