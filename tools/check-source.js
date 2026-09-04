const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const vm = require("vm");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
const sha384 = (bytes) => "sha384-" + crypto.createHash("sha384").update(bytes).digest("base64");
const normalizedTextBytes = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
const scripts = [...html.matchAll(/<script\s+src="(src\/js\/[^"]+)"\s*><\/script>/g)].map((match) => match[1]);
const manifestScripts = manifest.localScripts.map((file) => "src/js/" + file);

if (!scripts.length) throw new Error("Application script tags were not found.");
if (scripts.join("\n") !== manifestScripts.join("\n")) {
  throw new Error("classdock.html script order does not match scripts.manifest.json");
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
// 지연 로드 대상은 MNLazy 묶음 정의와 manifest 가 항상 같은 목록을 가리켜야 한다.
// (한쪽만 고치면 "시작할 때도 안 싣고 필요할 때도 안 싣는" 조용한 누락이 된다.)
const lazyBundles = require("../src/js/lazy.js").BUNDLES;
const bundledFiles = new Set(Object.values(lazyBundles).flatMap((bundle) => bundle.files));
const manifestLazyFiles = new Set(manifest.vendorScripts.filter((item) => item.lazy).map((item) => item.file));
for (const file of bundledFiles) {
  if (!manifestLazyFiles.has(file)) throw new Error(`MNLazy bundle file is not a lazy vendor script: ${file}`);
}
for (const file of manifestLazyFiles) {
  if (!bundledFiles.has(file)) throw new Error(`Lazy vendor script belongs to no MNLazy bundle: ${file}`);
}
for (const [name, bundle] of Object.entries(lazyBundles)) {
  if (!Array.isArray(bundle.files) || !bundle.files.length) throw new Error(`MNLazy bundle is empty: ${name}`);
  if (!bundle.label) throw new Error(`MNLazy bundle has no label: ${name}`);
}
if (!html.includes("<!--MN_LAZY_VENDOR-->")) throw new Error("Lazy vendor placeholder is missing from HTML.");

for (const item of manifest.vendorScripts) {
  const tag = `<script src="${item.src}"></script>`;
  if (item.lazy) {
    // 지연 로드 라이브러리는 시작 비용을 만들지 않아야 하므로 태그가 남아 있으면 실패시킨다.
    if (html.includes(tag)) throw new Error(`Lazy vendor must not be loaded at startup: ${item.src}`);
    if (!lazyBundles[item.lazy]) throw new Error(`Unknown MNLazy bundle for vendor: ${item.file} → ${item.lazy}`);
    if (!lazyBundles[item.lazy].files.includes(item.file)) {
      throw new Error(`Vendor is not part of the bundle it declares: ${item.file} → ${item.lazy}`);
    }
  } else if (!html.includes(tag)) {
    throw new Error(`Vendor script tag missing from HTML: ${item.src}`);
  }
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
// 예제 갤러리(python-snippets.js·java-snippets.js)는 템플릿 리터럴 안에 파이썬·자바 코드를 통째로
// 담고 있고, 그 코드의 class 선언은 들여쓰기 없이 열 0 에서 시작한다. 그대로 훑으면 남의 언어 선언을
// JS 전역으로 오해한다(자바 class Cat ↔ 파이썬 class Cat). 그래서 문자열·주석·템플릿 안은 비우고 본다.
// 상태를 끝까지 닫지 못하면(백틱을 문장 부호로 쓴 파일 등) 예전처럼 원문을 그대로 본다.
function codeLinesOutsideTemplates(text){
  const lines = text.split("\n");
  const kept = [];
  let inTemplate = 0, inBlock = false;
  for (const line of lines){
    kept.push(inTemplate === 0 && !inBlock ? line : "");
    for (let i = 0; i < line.length; i++){
      const ch = line[i], next = line[i + 1];
      if (inBlock){ if (ch === "*" && next === "/"){ inBlock = false; i++; } continue; }
      if (inTemplate > 0){
        if (ch === "\\"){ i++; continue; }
        if (ch === "`") inTemplate--;
        continue;
      }
      if (ch === "/" && next === "/") break;                  // 줄 주석
      if (ch === "/" && next === "*"){ inBlock = true; i++; continue; }
      if (ch === "\"" || ch === "'"){                         // 따옴표 문자열은 통째로 건너뛴다
        const quote = ch;
        for (i++; i < line.length; i++){
          if (line[i] === "\\"){ i++; continue; }
          if (line[i] === quote) break;
        }
        continue;
      }
      if (ch === "`") inTemplate++;
    }
  }
  return (inTemplate === 0 && !inBlock) ? kept : lines;
}
const topWindowAssignRe = /^(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=/;
const globalDecls = new Map();   // 이름 -> 선언한 파일 목록
function recordGlobal(name, relative){
  if (!name) return;
  if (!globalDecls.has(name)) globalDecls.set(name, []);
  globalDecls.get(name).push(relative);
}
for (const relative of scripts) {
  const lines = codeLinesOutsideTemplates(fs.readFileSync(path.join(root, relative), "utf8"));
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
const pythonViewerFiles = ["workspace-python.js", "code-viewer.js", "python-snippets.js", "python-editor.js", "python-run-context.js", "python-runtime.js"];
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
  protocol.append("1234567890__CLASSDOCK_");
  protocol.append("TRACE__payload");
  return {
    normal: normal.value(),
    protocol: protocol.value()
  };
})()`).runInContext(workerContext);
if (!outputLimitCheck.normal.includes("생략") || outputLimitCheck.normal.includes("ABCDEFGHIJ") ||
    !outputLimitCheck.protocol.includes("__CLASSDOCK_TRACE__payload")) {
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
    const marker = String(diagnosticRun.stdout).match(/__CLASSDOCK_DIAG__([A-Za-z0-9+/=]+)/);
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
  if (traceRun.status !== 0 || !String(traceRun.stdout).includes("__CLASSDOCK_TRACE__")) {
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
