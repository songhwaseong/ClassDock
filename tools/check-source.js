const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const vm = require("vm");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "manneung-classroom.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
const sha384 = (bytes) => "sha384-" + crypto.createHash("sha384").update(bytes).digest("base64");
const normalizedTextBytes = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
const scripts = [...html.matchAll(/<script\s+src="(src\/js\/[^"]+)"\s*><\/script>/g)].map((match) => match[1]);
const manifestScripts = manifest.localScripts.map((file) => "src/js/" + file);

if (!scripts.length) throw new Error("Application script tags were not found.");
if (scripts.join("\n") !== manifestScripts.join("\n")) {
  throw new Error("manneung-classroom.html script order does not match scripts.manifest.json");
}
const layerScripts = (manifest.applicationLayers || []).flatMap((layer) => layer.scripts || []);
if (layerScripts.join("\n") !== manifest.localScripts.join("\n")) {
  throw new Error("applicationLayers must contain every local script exactly once and in load order.");
}
const scriptIndex = new Map(manifest.localScripts.map((file, index) => [file, index]));
for (const [script, dependencies] of Object.entries(manifest.scriptDependencies || {})) {
  if (!scriptIndex.has(script)) throw new Error(`Dependency target is not a local script: ${script}`);
  for (const dependency of dependencies) {
    if (!scriptIndex.has(dependency)) throw new Error(`Dependency source is not a local script: ${dependency}`);
    if (scriptIndex.get(dependency) >= scriptIndex.get(script)) {
      throw new Error(`Script dependency order is invalid: ${script} must load after ${dependency}`);
    }
  }
}
for (const boundary of manifest.moduleBoundaries || []) {
  if (!scriptIndex.has(boundary.file)) throw new Error(`Module boundary is not a local script: ${boundary.file}`);
  const moduleSource = fs.readFileSync(path.join(root, "src/js", boundary.file), "utf8");
  if (!new RegExp(`\\b(?:const|let|var)\\s+${boundary.publicApi}\\b`).test(moduleSource)) {
    throw new Error(`Module public API is missing: ${boundary.publicApi}`);
  }
  for (const consumer of boundary.consumers || []) {
    if (!scriptIndex.has(consumer)) throw new Error(`Module consumer is not a local script: ${consumer}`);
    if (scriptIndex.get(consumer) <= scriptIndex.get(boundary.file)) {
      throw new Error(`Module consumer must load after its boundary: ${consumer}`);
    }
    const consumerSource = fs.readFileSync(path.join(root, "src/js", consumer), "utf8");
    if (!new RegExp(`\\b${boundary.publicApi}\\b`).test(consumerSource)) {
      throw new Error(`Module consumer does not use the public API: ${consumer}`);
    }
  }
}
for (const item of manifest.vendorScripts) {
  const tag = `<script src="${item.src}"></script>`;
  if (!html.includes(tag)) throw new Error(`Vendor script tag missing from HTML: ${item.src}`);
  const vendorPath = path.join(root, "vendor", item.file);
  if (!fs.existsSync(vendorPath)) throw new Error(`Vendor file missing: ${item.file}`);
  if (!item.sha384 || !/^sha384-[A-Za-z0-9+/]+={0,2}$/.test(item.sha384)) throw new Error(`Vendor SHA-384 is missing or invalid: ${item.file}`);
  const vendorBytes = fs.readFileSync(vendorPath);
  // Preserve the original byte-level check. If it differs, also accept the
  // canonical LF form because Git may convert checked-out JavaScript to CRLF
  // on Windows.
  const rawHash = sha384(vendorBytes);
  const actualHash = rawHash === item.sha384 ? rawHash : sha384(normalizedTextBytes(vendorBytes));
  if (actualHash !== item.sha384) throw new Error(`Vendor SHA-384 mismatch: ${item.file}`);
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

// 전역 네임스페이스 충돌 가드
// 모듈 번들러 없이 40여 개 스크립트가 하나의 전역을 공유하는 구조라, 두 파일(또는 한 파일에서
// 두 번)이 같은 최상위 이름을 선언하면 나중 것이 앞의 것을 '조용히' 덮어써 버그가 된다.
// 빌드 시점에 잡아 실패시켜, 전역 네임스페이스 통합 없이도 실수로 인한 덮어쓰기를 막는다.
// 최상위(들여쓰기 없는 열 0) function/class/var/let/const 선언만 본다 — 이 코드베이스의 스타일상
// 중첩 선언은 항상 들여쓰기돼 있어 열 0 기준이면 실제 전역만 정확히 걸러진다.
const topDeclRe = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)|^(?:var|let|const)\s+([A-Za-z_$][\w$]*)/;
const topWindowAssignRe = /^(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=/;
const globalDecls = new Map();   // 이름 -> 선언한 파일 목록
function recordGlobal(name, relative){
  if (!name) return;
  if (!globalDecls.has(name)) globalDecls.set(name, []);
  globalDecls.get(name).push(relative);
}
for (const relative of scripts) {
  const lines = fs.readFileSync(path.join(root, relative), "utf8").split("\n");
  for (const line of lines) {
    const match = topDeclRe.exec(line);
    if (match) recordGlobal(match[1] || match[2] || match[3], relative);
    // 함수 선언뿐 아니라 직접 window/globalThis 에 붙이는 공개 API도 같은 전역 이름이므로 충돌을 막는다.
    const windowMatch = topWindowAssignRe.exec(line);
    if (windowMatch) recordGlobal(windowMatch[1], relative);
  }
}
const globalCollisions = [...globalDecls.entries()].filter(([, files]) => files.length > 1);
if (globalCollisions.length) {
  const detail = globalCollisions.map(([name, files]) => `  ${name}  ←  ${files.join(", ")}`).join("\n");
  throw new Error("전역 이름 충돌(같은 최상위 이름을 두 곳 이상에서 선언 — 뒤 정의가 앞을 덮어씀):\n" + detail);
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
  const runDiagnosticProbe = (source) => {
    const diagnosticHarness = new vm.Script(
      `buildPythonDiagnosticHarness(${JSON.stringify(source)}, "check.py")`
    ).runInContext(workerContext);
    const diagnosticRun = spawnSync("python", ["-"], { input:diagnosticHarness, encoding:"utf8" });
    const marker = String(diagnosticRun.stdout).match(/__MANNEUNG_DIAG__([A-Za-z0-9+/=]+)/);
    if (diagnosticRun.status !== 0 || !marker) {
      process.stderr.write(diagnosticRun.stderr || "Python diagnostic harness check failed\n");
      process.exit(diagnosticRun.status || 1);
    }
    return JSON.parse(Buffer.from(marker[1], "base64").toString("utf8"));
  };
  runDiagnosticProbe("total = missing + 1");
  const directBreakReport = runDiagnosticProbe("while True:\n    if ready:\n        break");
  if (directBreakReport.diagnostics.some((item) => item.code === "PY-LOOP")) {
    throw new Error("Python diagnostic direct-break loop check failed");
  }
  const nestedBreakReport = runDiagnosticProbe("while True:\n    while pending:\n        break");
  const nestedLoopItems = nestedBreakReport.diagnostics.filter((item) => item.code === "PY-LOOP");
  if (nestedLoopItems.length !== 1 || nestedLoopItems[0].line !== 1) {
    throw new Error("Python diagnostic nested-loop break check failed");
  }
  const noBreakReport = runDiagnosticProbe("while True:\n    while True:\n        pass");
  const noBreakLoopItems = noBreakReport.diagnostics.filter((item) => item.code === "PY-LOOP");
  if (noBreakLoopItems.length !== 2 || noBreakLoopItems[0].line !== 1 || noBreakLoopItems[1].line !== 2) {
    throw new Error("Python diagnostic nested no-break loop check failed");
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
console.log(`소스 검사 완료: JavaScript ${scripts.length}개, Pyodide Worker 1개, CSS 1개${pythonHarnessChecked ? ", Python harness 2개" : ""}, 전역 선언 ${globalDecls.size}개(충돌 0)`);
