"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const documents = read("src", "js", "documents.js");
const loaders = read("src", "js", "file-loaders.js");
const viewer = read("src", "js", "image-viewer.js");

test("ML model binaries and NumPy sidecar files use the safe binary-asset path", () => {
  for (const ext of [
    "model", "npy", "npz", "kv", "onnx", "tflite", "safetensors", "pt", "pth", "ckpt",
    "joblib", "pkl", "pickle", "keras", "h5", "hdf5", "pyc"
  ]) assert.match(documents, new RegExp(`"${ext}"`));
  assert.match(documents, /\.\.\.BINARY_ASSET_EXTS/);
  assert.match(loaders, /BINARY_ASSET_EXTS\.has\(ext\)\) made = await loadBinaryAsset\(file, opts\)/);
  assert.match(viewer, /async function loadBinaryAsset\(file, options=\{\}\)/);
  assert.match(viewer, /URL\.createObjectURL\(source\)/);
  assert.match(viewer, /link\.download = doc\.name \|\| file\.name/);
});

test("Word2Vec text exports are registered as searchable text documents", () => {
  assert.match(documents, /\bvec\s*:\s*["']text["']/);
  assert.match(documents, /\bvocab\s*:\s*["']text["']/);
});
