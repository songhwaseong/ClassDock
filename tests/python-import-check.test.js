"use strict";

// 진단 하니스(compile + AST)는 import 대상이 실제로 있는지 보지 않는다 — import 문에 적힌
// 이름은 무조건 '정의된 이름'으로 등록하므로, 없는 모듈·없는 함수를 가져와도 표시가 없었다.
// 이제 작업공간에 열린 .py 색인으로 import 경로와 이름을 확인해 빨간 줄로 알린다.
// 검사는 '확실할 때만' 말한다 — 최상위 이름이 작업공간 모듈일 때만 보고하고,
// 못 읽은 파일·import * ·같은 경로 후보가 여럿이면 판단을 포기한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../src/js/core.js");
const read = (name) => fs.readFileSync(path.join(__dirname, "../src/js", name), "utf8");
const viewer = read("code-viewer.js");
const workspacePython = read("workspace-python.js");
const runContext = read("python-run-context.js");
const runtime = read("python-runtime.js");

const PROJECT = [
  { path:"chapter09_agent/__init__.py", source:"" },
  { path:"chapter09_agent/travel_agent/__init__.py", source:"" },
  { path:"chapter09_agent/travel_agent/ui/__init__.py", source:"" },
  { path:"chapter09_agent/travel_agent/ui/trip_plan_view.py", source:"def show_trip_plan(plan):\n    print(plan)\n" },
  { path:"chapter09_agent/travel_agent/state.py", source:"MAX = 3\n\nclass TripState:\n    pass\n" }
];

const indexFor = (currentPath, entries=PROJECT, options={}) =>
  core.pythonWorkspaceModuleIndex(currentPath, entries, options);
const problemsFor = (source, currentPath="chapter09_agent/travel_agent/graph/show.py", entries, options) =>
  core.pythonWorkspaceImportProblems(source, indexFor(currentPath, entries, options));

test("없는 모듈을 가져오면 오류로 알린다", () => {
  const problems = problemsFor("from chapter09_agent.travel_agent.ui.trip_plan_vieww import show_trip_plan\n");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].severity, "error");
  assert.equal(problems[0].code, "PY-IMPORT-MODULE");
  assert.equal(problems[0].line, 1);
  assert.equal(problems[0].column, 5);          // 모듈 경로가 시작하는 칸
});

test("모듈은 있지만 그 안에 없는 이름을 가져오면 오류로 알린다", () => {
  const problems = problemsFor("from chapter09_agent.travel_agent.ui.trip_plan_view import show_trip_planX\n");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, "PY-IMPORT-NAME");
  assert.match(problems[0].message, /'show_trip_planX' 이름이 없어요/);
});

test("실제로 있는 모듈·이름·하위 모듈은 조용히 통과한다", () => {
  const source = [
    "from chapter09_agent.travel_agent.ui.trip_plan_view import show_trip_plan",
    "from chapter09_agent.travel_agent import ui, state",
    "from chapter09_agent.travel_agent.state import MAX as m, TripState",
    "import chapter09_agent.travel_agent.state as st"
  ].join("\n");
  assert.deepEqual(problemsFor(source), []);
});

test("작업공간 밖(설치 패키지·표준 라이브러리)은 검사하지 않는다", () => {
  const source = "import os, sys\nfrom langchain_core.messages import HumanMessage\nfrom typing import TYPE_CHECKING\n";
  assert.deepEqual(problemsFor(source), []);
});

test("중첩 폴더의 같은 이름 파일 때문에 외부 패키지를 작업공간 모듈로 오인하지 않는다", () => {
  const entries = PROJECT.concat([{ path:"vendor/requests.py", source:"VERSION = 1\n" }]);
  assert.deepEqual(problemsFor("import requests.sessions\n",
    "chapter09_agent/travel_agent/graph/show.py", entries), []);
});

test("내용이 빈 __init__.py 는 '가진 이름이 없는 패키지'로 본다", () => {
  const problems = problemsFor("from chapter09_agent.travel_agent import nope\n");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, "PY-IMPORT-NAME");
});

test("아직 읽지 못한 파일(unreadable)은 이름이 없다고 단정하지 않는다", () => {
  const entries = PROJECT.map(entry => entry.path.endsWith("ui/trip_plan_view.py")
    ? { path:entry.path, source:"", unreadable:true } : entry);
  assert.deepEqual(problemsFor("from chapter09_agent.travel_agent.ui.trip_plan_view import show_trip_plan\n",
    "chapter09_agent/travel_agent/graph/show.py", entries), []);
});

test("import * 로 이름을 넘겨받는 모듈은 이름 검사를 하지 않는다", () => {
  const entries = PROJECT.concat([{ path:"chapter09_agent/travel_agent/reexport.py", source:"from .state import *\n" }]);
  assert.deepEqual(problemsFor("from chapter09_agent.travel_agent.reexport import TripState\n",
    "chapter09_agent/travel_agent/graph/show.py", entries), []);
});

test("조건문·try 안에서 정의한 이름도 '있는 이름'으로 인정한다", () => {
  const entries = PROJECT.concat([{
    path:"chapter09_agent/travel_agent/tools/search.py",
    source:"import os\n\nif os.name:\n    def web_search(q):\n        return q\n"
  }]);
  assert.deepEqual(problemsFor("from chapter09_agent.travel_agent.tools.search import web_search\n",
    "chapter09_agent/travel_agent/graph/show.py", entries), []);
});

test("실행 기준 폴더 추정이 빗나가도 같은 결론을 낸다(경로 끝부분으로 맞추므로)", () => {
  const bad = "from chapter09_agent.travel_agent.ui.trip_plan_vieww import show_trip_plan\n";
  const withRoot = problemsFor(bad, "chapter09_agent/travel_agent/ui/show.py", PROJECT, { projectRoot:"" });
  const withoutRoot = problemsFor(bad, "chapter09_agent/travel_agent/ui/show.py", PROJECT, {});
  assert.equal(withRoot.length, 1);
  assert.deepEqual(withRoot, withoutRoot);
});

test("여러 줄 괄호 import 는 이름마다 제 줄을 가리킨다", () => {
  const source = "from chapter09_agent.travel_agent.ui.trip_plan_view import (\n    show_trip_plan,\n    show_missing,\n)\n";
  const problems = problemsFor(source);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 3);
  assert.equal(problems[0].column, 4);
});

test("문자열(예시 코드) 안의 import 는 건너뛴다", () => {
  assert.deepEqual(problemsFor('"""\nfrom chapter09_agent.nope import x\n"""\nprint(1)\n'), []);
});

test("상대 import 는 현재 파일 폴더를 기준으로 확인한다", () => {
  const problems = problemsFor("from ..state import TripState\nfrom ..state import Missing\n",
    "chapter09_agent/travel_agent/ui/show.py");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 2);
  assert.match(problems[0].message, /'Missing' 이름이 없어요/);
});

test("올라갈 폴더가 없는 상대 import 는 판단하지 않는다", () => {
  assert.deepEqual(core.pythonWorkspaceImportProblems("from . import helper\n",
    core.pythonWorkspaceModuleIndex("solo.py", [{ path:"other.py", source:"x = 1\n" }], {})), []);
});

test("모듈이 내보내는 이름은 넉넉히 모은다(대입·for·with as·import)", () => {
  const bindings = core.pythonModuleBindings([
    "import os",
    "import numpy as np",
    "from pathlib import Path",
    "MAX: int = 3",
    "a, b = 1, 2",
    "for item in range(3):",
    "    pass",
    "with open('x') as fp:",
    "    pass",
    "def run():",
    "    pass"
  ].join("\n"));
  assert.equal(bindings.wildcard, false);
  for (const name of ["os", "np", "Path", "MAX", "a", "b", "item", "fp", "run"]) {
    assert.ok(bindings.names.includes(name), name + " 를 이름으로 모으지 못했습니다");
  }
});

test("연쇄 대입과 역슬래시 여러 줄 import 의 이름도 모은다", () => {
  const bindings = core.pythonModuleBindings("a = b = 1\nfrom .state import MAX, \\\n    TripState\n");
  for (const name of ["a", "b", "MAX", "TripState"]) assert.ok(bindings.names.includes(name), name);
  const entries = PROJECT.concat([{
    path:"chapter09_agent/travel_agent/reexport.py",
    source:"a = b = 1\nfrom .state import MAX, \\\n    TripState\n"
  }]);
  assert.deepEqual(problemsFor("from chapter09_agent.travel_agent.reexport import b, TripState\n",
    "chapter09_agent/travel_agent/graph/show.py", entries), []);
});

test("모듈 __getattr__ 이 있으면 이름 검사를 포기한다", () => {
  assert.equal(core.pythonModuleBindings("def __getattr__(name):\n    return name\n").wildcard, true);
});

test("실시간 진단과 수동 진단이 같은 import 검사 결과를 함께 반영한다", () => {
  assert.match(workspacePython, /function workspacePythonImportAnalysis\(ownerDoc, source, onReady\)/);
  assert.match(workspacePython, /function workspacePythonImportDiagnostics\(ownerDoc, source, onReady\)/);
  assert.match(workspacePython, /if \(rows\.some\(row => workspacePyText\(row\.doc\) == null\)\)/);   // 못 읽은 파일이 있으면 검사 보류
  assert.match(viewer, /editor\.setDiagnosticItems\(withImportProblems\(analysis\.diagnostics, source\)\)/);
  assert.match(viewer, /workspacePythonImportAnalysis\(ownerDoc, source, rerunAfterWorkspacePrewarm\)/);
  assert.match(viewer, /ui\.extraDiagnostics = \(\) => \{/);
  assert.match(viewer, /ui\.prepareExtraDiagnostics = async \(source\) => \{/);
  assert.match(viewer, /await workspacePythonPrewarmReady\(ownerDoc\)/);
  assert.match(viewer, /await ensureJediImportCheck\(source\)/);
  assert.match(runtime, /preparedExtraDiagnostics = await ui\.prepareExtraDiagnostics\(studentSource\)/);
  assert.match(runtime, /finishPythonDiagnostics\(parsed && parsed\.report, ui, preparedExtraDiagnostics\)/);
  assert.match(runContext, /if \(rawReport && Array\.isArray\(preparedExtraDiagnostics\)\) extra = preparedExtraDiagnostics/);
  assert.match(runContext, /extra = ui\.extraDiagnostics\(\) \|\| \[\]/);
  assert.match(runContext, /normalizePythonDiagnostics\(\(Array\.isArray\(rawReport\.diagnostics\) \? rawReport\.diagnostics : \[\]\)\.concat\(extra\)\)/);
});

test("프리워밍은 파일 상한 뒤에도 이어지고 완료되면 진단을 다시 예약한다", () => {
  assert.match(workspacePython, /if \(read >= WORKSPACE_PY_PREWARM_MAX\)\{ remaining = true; break; \}/);
  assert.match(workspacePython, /if \(outcome\.remaining\) \{/);
  assert.match(workspacePython, /callbacks\.add\(onReady\)/);
  assert.match(viewer, /const rerunAfterWorkspacePrewarm = \(\) => \{/);
});

test("입력 중 숨긴 import 경고는 커서가 줄을 떠나면 하니스 재실행 없이 다시 표시한다", () => {
  assert.match(viewer, /let liveDiagBaseItems = \[\], liveDiagSource = "", suppressedImportLine = 0/);
  assert.match(viewer, /suppressedImportLine = caretLine && workspaceAll\.concat\(jediAll\)\.some/);
  assert.match(viewer, /const refreshSuppressedImport = \(outsideEditor=false\) => \{/);
  assert.match(viewer, /source === liveDiagSource\) editor\.setDiagnosticItems\(withImportProblems\(liveDiagBaseItems, source\)\)/);
  assert.match(viewer, /addEventListener\("selectionchange", \(\) => refreshSuppressedImport\(false\)\)/);
  assert.match(viewer, /addEventListener\("blur", \(\) => refreshSuppressedImport\(true\)\)/);
});

// ── Jedi 로 한 번 더 확인하는 층(설치 패키지까지 본다. exe + 로컬 Python + Jedi 필요) ──
test("Jedi 에게 물어볼 자리는 이름 바로 뒤 칸을 가리킨다", () => {
  const targets = core.pythonImportCheckTargets("import os.path\nfrom pkg.mod import run, Helper\n");
  assert.deepEqual(targets.map(item => [item.key, item.line, item.column]), [
    ["module:os.path", 1, 14],          // 'os.path' 끝
    ["module:pkg.mod", 2, 12],          // 'pkg.mod' 끝
    ["name:pkg.mod|run", 2, 23],
    ["name:pkg.mod|Helper", 2, 31]
  ]);
});

test("상대 import 는 모듈 자리를 묻지 않고 이름만 확인한다", () => {
  const targets = core.pythonImportCheckTargets("from ..state import TripState\n");
  assert.deepEqual(targets.map(item => item.key), ["name:..state|TripState"]);
});

test("Jedi 가 못 찾은 자리는 '없다'가 아니라 '찾지 못했다'는 경고로 적는다", () => {
  const targets = core.pythonImportCheckTargets("from pkg.mod import run\n");
  const problems = core.pythonJediImportProblems(targets, ["name:pkg.mod|run"], new Set());
  assert.equal(problems.length, 1);
  assert.equal(problems[0].severity, "warning");
  assert.equal(problems[0].code, "PY-IMPORT-JEDI");
  assert.match(problems[0].message, /정의를 찾지 못했어요/);
  assert.match(problems[0].hint, /실제로는 있을 수도 있어요/);
});

test("작업공간 검사가 이미 짚은 줄에는 Jedi 경고를 겹쳐 쓰지 않는다", () => {
  const targets = core.pythonImportCheckTargets("from pkg.mod import run\n");
  assert.deepEqual(core.pythonJediImportProblems(targets, ["name:pkg.mod|run"], new Set([1])), []);
});

test("작업공간에서 정상 해결된 import 대상에는 Jedi 오탐 경고를 붙이지 않는다", () => {
  const source = "from chapter09_agent.travel_agent.state import MAX, TripState\n";
  const analysis = core.pythonWorkspaceImportAnalysis(source,
    indexFor("chapter09_agent/travel_agent/graph/show.py"));
  assert.deepEqual(analysis.problems, []);
  assert.ok(analysis.resolvedKeys.includes("module:chapter09_agent.travel_agent.state"));
  assert.ok(analysis.resolvedKeys.includes("name:chapter09_agent.travel_agent.state|MAX"));
  assert.ok(analysis.resolvedKeys.includes("name:chapter09_agent.travel_agent.state|TripState"));
  const targets = core.pythonImportCheckTargets(source);
  assert.deepEqual(core.pythonJediImportProblems(targets, targets.map(item => item.key), new Set(),
    new Set(analysis.resolvedKeys)), []);
  assert.match(viewer, /new Set\(knowledge\.resolvedKeys\)/);
});

test("모듈 자체를 못 찾았으면 그 모듈의 이름은 따로 말하지 않는다", () => {
  const targets = core.pythonImportCheckTargets("from pkg.nope import run, Helper\n");
  const problems = core.pythonJediImportProblems(targets,
    ["module:pkg.nope", "name:pkg.nope|run", "name:pkg.nope|Helper"], new Set());
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /'pkg\.nope' 모듈의 정의를 찾지 못했어요/);
});

test("Jedi import 검사는 준비 완료를 기다리고 구성이 바뀔 때만 다시 묻는다", () => {
  const snippets = read("python-snippets.js");
  assert.match(snippets, /async function requestJediImportChecks\(source, targets, relPath, projectRoot\)/);
  assert.match(snippets, /mode:"imports"/);
  assert.match(snippets, /targets:rows\.map\(item => \(\{ line:item\.line, column:item\.column \}\)\)/);
  assert.match(snippets, /if \(_jediProbePromise\) return _jediProbePromise/);                       // 진행 중인 probe 공유
  assert.match(snippets, /async function waitForJediReady\(\)/);
  assert.match(viewer, /if \(typeof waitForJediReady !== "function" \|\| !\(await waitForJediReady\(\)\)\) return false/);
  assert.match(viewer, /if \(signature === jediImportSig\) return false/);                         // 같은 구성이면 다시 묻지 않는다
  assert.match(viewer, /if \(jediImportTask\) \{[\s\S]*return ensureJediImportCheck\(source\)/);  // 진행 중 변경은 끝난 뒤 이어 검사
  assert.match(viewer, /if \(seq !== jediImportSeq \|\| !unresolved\) return false/);               // 뒤늦은 응답은 버린다
  const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  assert.match(launcher, /elif mode == 'imports':/);
  assert.match(launcher, /for index, target in enumerate\(targets\[:120\]\)/);
  assert.match(launcher, /'unresolved': unresolved/);
});

test("못 읽은 파일은 색인에 '내용을 모르는 모듈'로 표시된다", () => {
  assert.match(workspacePython, /const workspacePyUnreadable = new Set\(\)/);
  assert.match(workspacePython, /entries\.push\(\{ path:row\.path, source, unreadable:workspacePyUnreadable\.has\(row\.doc\.id\) \}\)/);
  const index = indexFor("a/main.py", [{ path:"a/mod.py", source:"", unreadable:true }, { path:"a/plain.py", source:"" }]);
  assert.equal(index.files.find(file => file.path === "a/mod.py").hasSource, false);
  assert.equal(index.files.find(file => file.path === "a/plain.py").hasSource, true);
});
