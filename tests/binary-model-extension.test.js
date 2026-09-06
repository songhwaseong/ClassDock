"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const documentTypes = read("src", "js", "document-types.js");
const loaders = read("src", "js", "file-loaders.js");
const viewer = read("src", "js", "image-viewer.js");

test("ML model binaries and NumPy sidecar files use the safe binary-asset path", () => {
  for (const ext of [
    "model", "npy", "npz", "kv", "onnx", "tflite", "safetensors", "pt", "pth", "ckpt",
    "joblib", "pkl", "pickle", "keras", "h5", "hdf5", "pyc"
  ]) assert.match(documentTypes, new RegExp(`"${ext}"`));
  assert.match(documentTypes, /\.\.\.BINARY_ASSET_EXTS/);
  assert.match(loaders, /BINARY_ASSET_EXTS\.has\(ext\)\) made = await loadBinaryAsset\(file, opts\)/);
  assert.match(viewer, /async function loadBinaryAsset\(file, options=\{\}\)/);
  // 원본 파일을 제 이름 그대로 내려받을 수 있어야 한다(내려받기 자체는 MNDownload 공용이 맡는다).
  assert.match(viewer, /MNDownload\.saveBlob\(source, doc\.name \|\| file\.name\)/);
});

test("Word2Vec text exports are registered as searchable text documents", () => {
  assert.match(documentTypes, /\bvec\s*:\s*["']text["']/);
  assert.match(documentTypes, /\bvocab\s*:\s*["']text["']/);
});
