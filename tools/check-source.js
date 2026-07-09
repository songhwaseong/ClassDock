const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "manneung-classroom.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
const scripts = [...html.matchAll(/<script\s+src="(src\/js\/[^"]+)"\s*><\/script>/g)].map((match) => match[1]);
const manifestScripts = manifest.localScripts.map((file) => "src/js/" + file);

if (!scripts.length) throw new Error("Application script tags were not found.");
if (scripts.join("\n") !== manifestScripts.join("\n")) {
  throw new Error("manneung-classroom.html script order does not match scripts.manifest.json");
}
for (const item of manifest.vendorScripts) {
  const tag = `<script src="${item.src}"></script>`;
  if (!html.includes(tag)) throw new Error(`Vendor script tag missing from HTML: ${item.src}`);
  if (!fs.existsSync(path.join(root, "vendor", item.file))) throw new Error(`Vendor file missing: ${item.file}`);
  if (item.worker && !fs.existsSync(path.join(root, "vendor", item.worker))) throw new Error(`Vendor worker missing: ${item.worker}`);
}
for (const relative of scripts) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing script: ${relative}`);
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const stateSource = fs.readFileSync(path.join(root, "src/js/state.js"), "utf8");
for (const name of ["normalizePythonDiagnostics", "normalizePythonTraceReport"]) {
  if (!new RegExp("\\b" + name + "\\b").test(stateSource)) {
    throw new Error(`state.js shared function binding missing: ${name}`);
  }
}

// python-viewer.js 분할본 — 같은 컨텍스트에 순서대로 로드하면 번들과 동일한 전역 환경이 된다.
const pythonViewerFiles = ["code-viewer.js", "python-snippets.js", "python-editor.js", "python-run-context.js", "python-runtime.js"];
const workerContext = vm.createContext({
  console,
  window:{},
  localStorage:{ getItem:() => null, setItem:() => {} },
  TextEncoder,
  TextDecoder,
  btoa:(value) => Buffer.from(value, "binary").toString("base64"),
  atob:(value) => Buffer.from(value, "base64").toString("binary")
});
for (const file of pythonViewerFiles) {
  const code = fs.readFileSync(path.join(root, "src/js", file), "utf8");
  new vm.Script(code, { filename: file }).runInContext(workerContext);
}
const outputLimitCheck = new vm.Script(`(() => {
  const normal = createPythonOutputCollector(8, 64);
  normal.append("12345678"); normal.append("ABCDEFGHIJ");
  const protocol = createPythonOutputCollector(8, 64);
  protocol.append("1234567890__MANNEUNG_");
  protocol.append("TRACE__payload");
  return {
    normal: normal.value(),
    protocol: protocol.value()
  };
})()`).runInContext(workerContext);
if (!outputLimitCheck.normal.includes("생략") || outputLimitCheck.normal.includes("ABCDEFGHIJ") ||
    !outputLimitCheck.protocol.includes("__MANNEUNG_TRACE__payload")) {
  throw new Error("Python output limit check failed");
}
const workerSource = new vm.Script(
  '"(" + pyodideWorkerMain.toString() + ")();"'
).runInContext(workerContext);
new vm.Script(workerSource, { filename: "pyodide-worker.generated.js" });

let pythonHarnessChecked = false;
const pythonProbe = spawnSync("python", ["--version"], { encoding:"utf8" });
if (pythonProbe.status === 0) {
  const diagnosticHarness = new vm.Script(
    "buildPythonDiagnosticHarness(\"total = missing + 1\", \"check.py\")"
  ).runInContext(workerContext);
  const diagnosticRun = spawnSync("python", ["-"], { input:diagnosticHarness, encoding:"utf8" });
  if (diagnosticRun.status !== 0 || !String(diagnosticRun.stdout).includes("__MANNEUNG_DIAG__")) {
    process.stderr.write(diagnosticRun.stderr || "Python diagnostic harness check failed\n");
    process.exit(diagnosticRun.status || 1);
  }
  const traceHarness = new vm.Script(
    "buildPythonTraceHarness(\"value = 1\\nvalue += 2\\nprint(value)\", \"check.py\", 30)"
  ).runInContext(workerContext);
  const traceRun = spawnSync("python", ["-"], { input:traceHarness, encoding:"utf8" });
  if (traceRun.status !== 0 || !String(traceRun.stdout).includes("__MANNEUNG_TRACE__")) {
    process.stderr.write(traceRun.stderr || "Python trace harness check failed\n");
    process.exit(traceRun.status || 1);
  }
  pythonHarnessChecked = true;
}

const styleMatch = html.match(/<link\s+rel="stylesheet"\s+href="(src\/[^"]+)"/);
if (!styleMatch || !fs.existsSync(path.join(root, styleMatch[1]))) throw new Error("Application stylesheet was not found.");
if (styleMatch[1] !== manifest.styles.local) throw new Error("HTML local stylesheet does not match scripts.manifest.json");
if (!html.includes(`<link rel="stylesheet" href="${manifest.styles.pptx.src}">`)) throw new Error("PPTX stylesheet tag missing from HTML");
console.log(`소스 검사 완료: JavaScript ${scripts.length}개, Pyodide Worker 1개, CSS 1개${pythonHarnessChecked ? ", Python harness 2개" : ""}`);
