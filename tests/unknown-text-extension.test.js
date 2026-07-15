"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const loaders = read("src", "js", "file-loaders.js");
const viewer = read("src", "js", "image-viewer.js");
const documents = read("src", "js", "documents.js");

test("unknown extensions are admitted only after text-content detection", () => {
  assert.match(loaders, /function isLikelyTextBytes\(bytes\)/);
  assert.match(loaders, /async function isLikelyTextFile\(file\)/);
  assert.match(loaders, /await isLikelyTextFile\(f\)/);
  assert.match(loaders, /!knownOpenable && !\(await isLikelyTextFile\(innerFile\)\)/);
  assert.match(loaders, /isLikelyTextBytes\(en\.data\)/);
});

test("opened unknown text files remain searchable while binary files are rejected", () => {
  assert.match(viewer, /const textLike = typeof isLikelyTextFile === "function"/);
  assert.match(viewer, /doc\.isTextFile = true/);
  assert.match(documents, /if \(doc\.isTextFile\) return true/);
});
