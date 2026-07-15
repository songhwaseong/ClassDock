"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const documentsSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "js", "documents.js"),
  "utf8"
);

test(".tokens files are registered as plain text documents", () => {
  assert.match(documentsSource, /\btokens\s*:\s*["']text["']/);
  assert.match(documentsSource, /TEXT_ENCODING_EXTS[^\n]+Object\.keys\(CODE_EXTS\)/);
  assert.match(documentsSource, /ZIP_OPENABLE[\s\S]+?Object\.keys\(CODE_EXTS\)/);
});
