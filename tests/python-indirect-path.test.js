"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../src/js/core.js");

const context = {
  console,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  ...core
};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../src/js/python-run-context.js"), "utf8") +
    "\n;globalThis.__indirectPathApi = { buildArchiveScopeFilter, expandArchiveScopeFilterFromPythonFiles };",
  context
);

const { buildArchiveScopeFilter, expandArchiveScopeFilterFromPythonFiles } = context.__indirectPathApi;

test("import된 Python 모듈의 상대 출력 폴더도 실행 묶음에 포함한다", () => {
  const target = "g.logstic/sonarTest.py";
  const entrySource = [
    "from Utility.keras_graph_util import graph_accuracy_loss",
    "graph_accuracy_loss(fit_hist, 'sonaTestGraph')"
  ].join("\n");
  const helperSource = [
    "import matplotlib.pyplot as plt",
    "dataOut = './../dataOut/'",
    "def graph_accuracy_loss(fit_hist, file_name):",
    "    plt.savefig(dataOut + file_name + '.png')"
  ].join("\n");
  const paths = [
    target,
    "Utility/keras_graph_util.py",
    "dataOut/existing.png"
  ];
  const directories = ["g.logstic", "Utility", "dataOut"];

  const initial = buildArchiveScopeFilter(target, entrySource, paths, directories);
  assert.equal(initial("dataOut/existing.png"), false);
  assert.deepEqual(Array.from(initial.pythonDependencyRoots), ["Utility"]);

  const expanded = expandArchiveScopeFilterFromPythonFiles(
    target,
    entrySource,
    paths,
    directories,
    "",
    [
      { path:target, bytes:new TextEncoder().encode(entrySource) },
      { path:"Utility/keras_graph_util.py", bytes:new TextEncoder().encode(helperSource) }
    ],
    initial
  );

  assert.equal(expanded("dataOut/existing.png"), true);
  assert.deepEqual(Array.from(expanded.directories), ["dataOut"]);
  assert.deepEqual(Array.from(expanded.references, item => ({ ref:item.ref, path:item.path })), [
    { ref:"./../dataOut/", path:"dataOut" }
  ]);
});
