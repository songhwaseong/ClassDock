"use strict";

// Jedi 는 코드 텍스트만 받으면 내 프로젝트 모듈(from 내패키지.모듈 import …)을 전혀 못 푼다.
// 브라우저 폴더 핸들에는 실제 경로가 없어서, 작업공간 .py 를 서버 임시폴더에 미러링하고
// 그 폴더를 jedi.Project 루트로 넘긴다. 루트는 서버만 알고 환경변수로 러너에 준다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
const snippets = fs.readFileSync(path.join(__dirname, "../src/js/python-snippets.js"), "utf8");
const editor = fs.readFileSync(path.join(__dirname, "../src/js/python-editor.js"), "utf8");
const viewer = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");

// launcher.cs 의 JediRunner() 안 문자열 연결을 이어 붙여 실제로 실행되는 러너 .py 를 만든다.
function extractJediRunner(){
  const start = launcher.indexOf("static string JediRunner()");
  const marker = "File.WriteAllText(path,";
  const from = launcher.indexOf(marker, start) + marker.length;
  const end = launcher.indexOf("new UTF8Encoding(false));", from);
  assert.ok(start > 0 && from > marker.length && end > from, "JediRunner 본문을 찾지 못했습니다");
  const body = launcher.slice(from, end);
  let out = "";
  for (let i = 0; i < body.length; i++){
    if (body[i] === "/" && body[i + 1] === "/"){ i = body.indexOf("\n", i); if (i < 0) break; continue; }
    if (body[i] !== "\"") continue;
    i++;
    for (; i < body.length && body[i] !== "\""; i++){
      if (body[i] !== "\\"){ out += body[i]; continue; }
      i++;
      out += body[i] === "n" ? "\n" : body[i] === "t" ? "\t" : body[i] === "r" ? "\r" : body[i];
    }
  }
  return out;
}

function pythonWithJedi(){
  for (const exe of ["python", "python3", "py"]){
    const probe = spawnSync(exe, ["-c", "import jedi"], { encoding:"utf8" });
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
}

function loadProjectSync(options={}){
  const probeStart = snippets.indexOf("function ensureJediProbe()");
  const probeEnd = snippets.indexOf("// ===== Jedi 프로젝트 인지", probeStart);
  const syncStart = snippets.indexOf("const JEDI_PROJECT_SYNC_DELAY", probeEnd);
  const syncEnd = snippets.indexOf("async function requestJediCompletions", syncStart);
  assert.ok(probeStart > 0 && probeEnd > probeStart && syncStart > probeEnd && syncEnd > syncStart);
  const timers = [];
  const requests = [];
  const ctx = {
    location:{ protocol:"http:" }, TextEncoder, Uint8Array, DataView,
    setTimeout:(fn) => { timers.push(fn); return timers.length; },
    fetch:async (url) => {
      requests.push(url);
      if (url === "/can-complete") return { ok:true, text:async () => "yes" };
      return { ok:true };
    }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  let body = "let _jediBackend = null, _jediProbePromise = null;\n" + snippets.slice(probeStart, probeEnd) + snippets.slice(syncStart, syncEnd);
  if (options.maxBytes != null) body = body.replace("32 * 1024 * 1024", String(options.maxBytes));
  vm.runInContext(body + ";this.scheduleJediProjectSync=scheduleJediProjectSync;this.buildJediProjectBundle=buildJediProjectBundle;", ctx);
  return { ctx, timers, requests };
}

test("Jedi 러너는 프로젝트 루트를 환경변수로만 받고 미러 밖 경로는 버린다", () => {
  const runner = extractJediRunner();
  assert.match(runner, /root = os\.environ\.get\('MOIDA_JEDI_ROOT', ''\) or ''/);
  assert.match(runner, /root = os\.path\.normpath\(root\) if root else ''/);   // 구분자 통일 후에 경로를 비교한다
  assert.match(runner, /candidate\.startswith\(root \+ os\.sep\)/);
  assert.match(runner, /script_path = inside\(clean\(data\.get\('path', ''\)\)\) or None/);
  assert.match(runner, /project_root = inside\(clean\(data\.get\('root', ''\)\)\) or root/);
  assert.match(runner, /script = jedi\.Script\(code=src, path=script_path, project=project\)/);
  assert.match(runner, /except TypeError:\n {8}script = jedi\.Script\(code=src\)/);   // 예전 Jedi 폴백
  assert.match(runner, /'workspacePath': to_workspace\(p\)/);
});

test("작업공간 미러는 색인이 바뀔 때만, 그것도 묶어서 보낸다", () => {
  // 타이핑마다 보내면 안 된다 — 색인을 새로 만든 순간에만 예약하고 1.2초 묶는다.
  assert.match(viewer, /workspacePyIndexMemo = \{ currentPath:targets\.currentPath, projectRoot, entries, index \};[\s\S]{0,400}scheduleJediProjectSync\(/);
  assert.match(snippets, /const JEDI_PROJECT_SYNC_DELAY = 1200;/);
  assert.match(snippets, /_jediProjectPending = files;[\s\S]{0,300}if \(!jediReady\(\)\)\{ ensureJediProbe\(\); return; \}/);
  assert.match(snippets, /if \(_jediBackend && _jediProjectPending\) scheduleJediProjectSync\(_jediProjectPending\);/);
  assert.match(snippets, /if \(_jediProjectBusy \|\| _jediProjectTimer\) return;/);
  assert.match(snippets, /fetch\("\/python-project-sync", \{ method:"POST"/);
  assert.match(snippets, /for \(const listener of \[\.\.\._jediProjectSyncListeners\]\)/);
  assert.match(viewer, /onJediProjectSynced\(\(\) => \{[\s\S]*jediImportSig = null;[\s\S]*scheduleLiveDiagnostics\(120\)/);
  assert.match(snippets, /if \(total \+ 8 \+ pathText\.length \+ sourceText\.length > JEDI_PROJECT_MAX_BYTES\) return null;/);
  // 완성·도움말·정의 요청 모두 현재 파일 경로와 실행 기준 폴더를 함께 보낸다.
  assert.match(snippets, /path:String\(relPath \|\| ""\), root:String\(projectRoot \|\| ""\) \}\) \}\);/);
  assert.match(editor, /const jediRelPath = \(\) => \{/);
  assert.match(editor, /const jediProjectRoot = \(\) => \{/);
  assert.match(editor, /requestJediCompletions\(source, line, column, jediRelPath\(\), jediProjectRoot\(\)\)/);
  // 미러 안에서 찾은 정의는 임시 복사본이 아니라 원래 탭으로 연다.
  assert.match(editor, /if \(def\.workspacePath && typeof options\.openWorkspaceDefinition === "function"\)/);
  assert.match(viewer, /async function openWorkspaceDefinitionTarget\(ownerDoc, hit\)/);
  assert.match(viewer, /openWorkspaceDefinitionTarget\(ownerDoc, hit\)/);
});

test("Jedi 준비 중 예약된 최초 프로젝트 미러는 probe 성공 뒤 자동으로 전송된다", async () => {
  const { ctx, timers, requests } = loadProjectSync();
  ctx.scheduleJediProjectSync([{ path:"project/main.py", source:"value = 1" }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ["/can-complete"]);
  assert.equal(timers.length, 1);
  await timers.shift()();
  assert.deepEqual(requests, ["/can-complete", "/python-project-sync"]);
});

test("Jedi 번들은 크기 하한을 넘으면 소스 인코딩 전에 중단한다", () => {
  const { ctx } = loadProjectSync({ maxBytes:64 });
  let encoded = 0;
  ctx.TextEncoder = class { encode(){ encoded++; throw new Error("인코딩되면 안 됩니다"); } };
  assert.equal(ctx.buildJediProjectBundle([{ path:"p.py", source:"x".repeat(65) }]), null);
  assert.equal(encoded, 0);
});

const jediPython = pythonWithJedi();
test("Jedi 러너는 미러 안에서 프로젝트 모듈을 풀고 정의를 작업공간 경로로 돌려준다",
  { skip: jediPython ? false : "로컬 python + jedi 가 없어 건너뜁니다" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "moida-jedi-test-"));
  try {
    const pkg = path.join(root, "llm_project", "chapter08_langgraph", "flow_control");
    fs.mkdirSync(pkg, { recursive:true });
    fs.writeFileSync(path.join(root, "llm_project", "chapter08_langgraph", "__init__.py"), "");
    fs.writeFileSync(path.join(pkg, "__init__.py"), "");
    fs.writeFileSync(path.join(pkg, "state.py"), "from typing import TypedDict\n\nclass State(TypedDict):\n    query: str\n");
    fs.writeFileSync(path.join(pkg, "nodes.py"), "def login(state):\n    pass\n");
    const runnerPath = path.join(root, "runner.py");
    fs.writeFileSync(runnerPath, extractJediRunner(), "utf8");
    const rel = "llm_project/chapter08_langgraph/flow_control/graph.py";

    const call = (payload, env={}) => {
      const proc = spawnSync(jediPython, [runnerPath], {
        input:JSON.stringify(payload), encoding:"utf8",
        env:{ ...process.env, MOIDA_JEDI_ROOT:root, PYTHONIOENCODING:"utf-8", ...env }
      });
      assert.equal(proc.status, 0, proc.stderr);
      return JSON.parse(proc.stdout);
    };
    const names = (payload) => (call(payload).items || []).map(item => item.name);

    const modules = "from chapter08_langgraph.flow_control.";
    assert.deepEqual(names({ source:modules, line:1, column:modules.length, path:rel, root:"llm_project" }).sort(),
      ["nodes", "state"]);

    // import 한 프로젝트 모듈의 멤버 접근(내 코드 본문)도 문맥으로 인식한다.
    const member = "import chapter08_langgraph.flow_control.nodes as n\nn.";
    assert.ok(names({ source:member, line:2, column:2, path:rel, root:"llm_project" }).includes("login"));

    const definition = call({
      source:"from chapter08_langgraph.flow_control.state import State\nState",
      line:2, column:5, mode:"definition", path:rel, root:"llm_project"
    });
    assert.equal(definition.ok, true);
    assert.equal(definition.workspacePath, "llm_project/chapter08_langgraph/flow_control/state.py");
    assert.equal(definition.name, "State");

    // 미러 밖을 가리키는 path·root 는 무시된다(경로 탈출 차단 — 절대경로는 join 이 루트를 지워 버린다).
    const escape = "C:/Windows/win.ini";
    assert.deepEqual(names({ source:modules, line:1, column:modules.length, path:escape, root:escape }), []);
    // 미러가 없으면(브라우저·미러 실패) 예전처럼 코드 텍스트만으로 동작한다.
    const noMirror = names({ source:"import os\nos.pa", line:2, column:5, path:rel, root:"llm_project" }, { MOIDA_JEDI_ROOT:"" });
    assert.ok(noMirror.includes("path"));
  } finally {
    try { fs.rmSync(root, { recursive:true, force:true }); } catch(_){}
  }
});
