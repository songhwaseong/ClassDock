"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const terminal = fs.readFileSync(path.join(root, "src/js/python-terminal.js"), "utf8");
const codeViewer = fs.readFileSync(path.join(root, "src/js/code-viewer.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

test("터미널은 앱에서 하나만 만들고 문서마다 버튼만 등록한다", () => {
  assert.match(terminal, /return sharedPythonTerminal\(\)\.attach\(toggleButton, options\)/);
  assert.match(terminal, /function sharedPythonTerminal\(\)\{\s*\n\s*if \(createPythonTerminal\.shared\) return createPythonTerminal\.shared/);
  assert.match(terminal, /createPythonTerminal\.shared = \{ attach \}/);
  // 버튼이 여러 개이므로 열림 표시는 등록된 모든 버튼에 함께 적용한다.
  assert.match(terminal, /const entries = new Map\(\)/);
  assert.match(terminal, /const setOpenState = \(\) => \{ entries\.forEach\(\(entry\) => applyOpenStateTo\(entry\.button\)\); \}/);
  // 문서 하나가 닫혔다고 다른 문서가 쓰는 세션을 끊지 않는다.
  assert.match(terminal, /destroy:\(\) => detach\(entry\)/);
  assert.match(terminal, /if \(!entries\.size\) scheduleShutdown\(\)/);
  assert.doesNotMatch(codeViewer, /pythonTerminal = createPythonTerminal[\s\S]{0,400}new [A-Za-z]*Terminal/);
});

test("다른 파이썬 파일에서 터미널을 열면 변수는 두고 작업 폴더만 옮긴다", () => {
  assert.match(terminal, /const switched = !!entry && activeEntry !== entry/);
  assert.match(terminal, /\} else if \(switched\)\{\s*\n\s*await moveToDocFolder\(target\)/);
  assert.match(terminal, /await sendLocalCommand\("Set-Location -LiteralPath " \+ powerShellLiteral\(target\)/);
  // 같은 폴더면 명령을 보내지 않고, 사용자가 직접 옮긴 폴더도 같은 파일에서는 되돌리지 않는다.
  assert.match(terminal, /if \(sameCwd\(target, currentCwd\)\) return/);
  assert.match(terminal, /작업 폴더를 " \+ currentCwd \+ " 로 옮겼습니다/);
  // 세션을 처음 열 때는 그 파일 폴더에서 시작하므로 이동 명령이 필요 없다.
  assert.match(terminal, /if \(!localSessionId\)\{[\s\S]{0,240}await ensureLocalShell\(\)/);
});

test("자동 작업 폴더 이동은 터미널 사용 확인 창을 띄우지 않는다", () => {
  // 사용자가 친 명령만 확인 창을 거치고, 앱이 넣는 cd 는 확인 없이 같은 세션으로 보낸다.
  assert.match(terminal, /const runLocalCommand = async \(command, stdoutEl, stderrEl\) => \{\s*\n\s*await confirmLocalUse\(\);\s*\n\s*await sendLocalCommand\(command, stdoutEl, stderrEl\);/);
  assert.match(terminal, /const confirmLocalUse = async \(\) => \{[\s\S]{0,320}createPythonTerminal\.localConfirmed = true;/);
  const moveStart = terminal.indexOf("const moveToDocFolder");
  const moveEnd = terminal.indexOf("const browserConsoleSource", moveStart);
  const move = terminal.slice(moveStart, moveEnd);
  assert.ok(moveStart > 0 && moveEnd > moveStart);
  assert.doesNotMatch(move, /confirmLocalUse|confirmDialog/);
});

test("브라우저 Pyodide 콘솔도 파일 사이에서 상태를 이어 간다", () => {
  assert.match(terminal, /const browserKernelId = "py-terminal-shared"/);
  assert.doesNotMatch(terminal, /browserKernelId = "py-terminal-" \+ Math\.random/);
});

test("명령이 도는 동안 터미널 버튼에 실행 중 점을 켠다", () => {
  // 터미널을 닫아도 명령은 계속 도므로 버튼의 점이 유일한 실행 중 표시가 된다.
  assert.match(terminal, /button\.classList\.toggle\("running", busy\)/);
  assert.match(terminal, /명령이 실행 중입니다 · 눌러서 터미널 열기/);
  assert.match(terminal, /setOpenState\(\);\s*\/\/ 열린 문서들의 터미널 버튼에 실행 중 점을/);
  // 탭 묶음이 overflow:hidden + border-radius 라 모서리 배지는 곡선에 잘린다 → 세로 한가운데 왼쪽에 둔다.
  assert.match(styles, /\.run-output-tab\.running::before\{content:"";position:absolute;left:2px;top:50%/);
  assert.match(styles, /background:#22c55e;animation:srv-pulse/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)\{ \.run-output-tab\.running::before\{animation:none\} \}/);
  assert.doesNotMatch(styles, /\.run-output-tab\.running::after/);
});

test("마지막 파이썬 문서가 닫히면 셸과 전역 단축키를 정리한다", () => {
  assert.match(terminal, /const shutdownDelayMs = 3000/);
  assert.match(terminal, /shutdownTimer = setTimeout\(\(\) => \{[\s\S]{0,120}if \(!entries\.size\) shutdown\(\);/);
  assert.match(terminal, /const shutdown = \(\) => \{\s*\n\s*generation\+\+/);
  assert.match(terminal, /fetch\("\/terminal-session-stop\?id=" \+ encodeURIComponent\(id\), \{ method:"POST", keepalive:true \}\)/);
  assert.match(terminal, /unbindDocumentKeys\(\)/);
  // 세션을 여는 중에 마지막 문서가 닫히면 새로 열린 세션도 바로 정리한다.
  assert.match(terminal, /const openedFor = generation/);
  assert.match(terminal, /if \(openedFor !== generation\)\{/);
});
