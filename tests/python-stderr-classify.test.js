"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyPythonStderr, pythonStderrDisplayKind, pythonStderrShouldBuffer } = require("../src/js/core.js");

test("Python stderr color classification separates warnings from failures", () => {
  assert.equal(classifyPythonStderr("", 0), "none");
  assert.equal(
    classifyPythonStderr("WARNING:tensorflow:GPU support is not available\nI0000 oneDNN custom operations are on.", 0),
    "warning"
  );
  assert.equal(classifyPythonStderr("UserWarning: careful\n", 0), "warning");
  assert.equal(classifyPythonStderr("Traceback (most recent call last):\nValueError: bad\n", 0), "error");
  assert.equal(classifyPythonStderr("WARNING: noisy but process failed\n", 1), "error");
});

test("Python stderr remains unclassified while an interactive run is pending", () => {
  assert.equal(pythonStderrDisplayKind("UserWarning: careful\n", undefined), "pending");
  assert.equal(pythonStderrDisplayKind("UserWarning: careful\n", 0), "warning");
  assert.equal(pythonStderrDisplayKind("Traceback\nValueError: bad\n", 1), "error");
});

test("hidden warnings buffer stderr only until the run completes", () => {
  assert.equal(pythonStderrShouldBuffer(false, false), true);
  assert.equal(pythonStderrShouldBuffer(false, true), false);
  assert.equal(pythonStderrShouldBuffer(true, false), false);
});

test("interactive stderr visibility reads the split panel from ui", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "../src/js/python-runtime.js"), "utf8");
  assert.match(runtime, /const showWarnings = !ui\.split\.classList\.contains\("hide-python-warnings"\)/);
});
