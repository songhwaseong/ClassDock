"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPythonStderr } = require("../src/js/core.js");

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
