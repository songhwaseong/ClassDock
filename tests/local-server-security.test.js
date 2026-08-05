const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
const stateSync = fs.readFileSync(path.join(__dirname, "../src/js/state-sync.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
const pythonRuntime = fs.readFileSync(path.join(__dirname, "../src/js/python-runtime.js"), "utf8");
const pythonTerminal = fs.readFileSync(path.join(__dirname, "../src/js/python-terminal.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

test("로컬 API는 헤더 토큰만 인정하고 URL 토큰을 사용하지 않는다", () => {
  assert.match(launcher, /static bool HasLocalAuthToken\(Dictionary<string, string> headers\)/);
  assert.match(launcher, /X-Manneung-Token/);
  assert.doesNotMatch(launcher, /mn_token/);
  assert.doesNotMatch(stateSync, /mn_token|tokenUrl\(|navigator\.sendBeacon/);
  assert.match(stateSync, /keepalive:\s*true/);
});

test("로컬 서버는 Host와 인증을 본문 수신 전에 검증한다", () => {
  assert.match(launcher, /static bool HasAllowedLocalHost/);
  assert.match(launcher, /host == "127\.0\.0\.1" \|\| host == "localhost"/);
  assert.match(launcher, /static bool HasAllowedLocalOrigin/);
  assert.match(launcher, /path == "\/python-import-index"/);
  assert.match(launcher, /static string PythonImportIndexJson\(\)/);
  assert.match(launcher, /!HasAllowedLocalOrigin\(headers\) && !path\.StartsWith\("\/tile-proxy"/);
  const auth = launcher.indexOf("if (RequiresLocalAuthToken(method, path) && !HasLocalAuthToken(headers))");
  const body = launcher.indexOf("// ---- 바디(있으면) 읽기 ----");
  assert.ok(auth >= 0 && body >= 0 && auth < body);
  assert.match(launcher, /client\.ReceiveTimeout = 15000/);
  assert.match(launcher, /413 Payload Too Large/);
});

test("자동완성용 작업공간 미러는 토큰이 있어야 쓰고, 미러 밖 경로는 거부한다", () => {
  // 미러를 만드는·지우는 요청도 다른 로컬 API처럼 실행별 토큰을 요구한다.
  assert.match(launcher, /path == "\/python-project-sync"\) return true/);
  // 미러에 쓰는 경로는 실행 번들과 같은 zip-slip 방지 검사를 거치고, .py 계열만 받는다.
  assert.match(launcher, /string safe = SafeRelPath\(rel\);\s*\n\s*if \(safe != null && len <= ProjectMirrorMaxFileBytes && IsPythonSourcePath\(safe\)\)/);
  assert.match(launcher, /ProjectMirrorMaxFiles = 20000/);
  assert.match(launcher, /ProjectMirrorMaxFileBytes = 1024 \* 1024/);
  // 프로젝트 루트는 서버만 알고 환경변수로 넘긴다 — 요청 본문이 임의 폴더를 가리킬 수 없다.
  assert.match(launcher, /psi\.EnvironmentVariables\["MOIDA_JEDI_ROOT"\] = mirror;/);
  assert.match(launcher, /root = os\.environ\.get\('MOIDA_JEDI_ROOT', ''\) or ''/);
  assert.match(launcher, /candidate if \(candidate == root or candidate\.startswith\(root \+ os\.sep\)\) else ''/);
  // 종료할 때 미러도 함께 지운다.
  assert.match(launcher, /ClearPythonProjectMirror\(\);\s+\/\/ 자동완성용 작업공간 미러/);
});

test("저장 루트 경로는 공통 검증과 재분석 지점 차단을 거친다", () => {
  assert.match(launcher, /static bool TryResolveSaveRootPath/);
  assert.match(launcher, /static bool HasReparsePointBelowRoot/);
  assert.match(launcher, /TryResolveSaveRootPath\(safe, out candidate\)/);
  assert.match(launcher, /TryResolveSaveRootPath\(safe, out full\)/);
  assert.match(launcher, /TryResolveSaveRootPath\(path, out full\)/);
});

test("로컬 응답은 기본 보안 헤더를 포함하고 하트비트 종료도 인증한다", () => {
  assert.match(launcher, /X-Content-Type-Options: nosniff/);
  assert.match(launcher, /Referrer-Policy: no-referrer/);
  assert.match(launcher, /path\.StartsWith\("\/heartbeat", StringComparison\.Ordinal\)\) return true/);
  assert.match(app, /fetch\("\/heartbeat-close\?id=/);
  assert.match(app, /X-PdfSigner-Heartbeat/);
});

test("패키지 설치는 사용자 확인과 확인 헤더가 있어야 진행한다", () => {
  assert.match(pythonRuntime, /신뢰하는 패키지만 설치하세요/);
  assert.match(pythonRuntime, /X-Manneung-Pip-Confirm/);
  assert.match(launcher, /x-manneung-pip-confirm/);
  assert.match(launcher, /pip-confirmation-required/);
});

test("로컬 Python 실행은 출력·시간·메모리 상한을 적용한다", () => {
  assert.match(launcher, /class LimitedTextBuffer/);
  assert.match(launcher, /const long PythonProcessMemoryLimitBytes = 4096L/);
  assert.match(launcher, /static long ProcessTreeWorkingSetBytes/);
  assert.match(launcher, /메모리 제한: 실행이 4GB를 넘어 중단했습니다/);
  assert.match(launcher, /메모리 제한: 대화형 실행이 4GB를 넘어 종료했습니다/);
});

test("지속형 노트북 커널도 셀 실행 시간과 프로세스 트리 메모리를 제한한다", () => {
  const start = launcher.indexOf("static string ExecutePythonKernel");
  const end = launcher.indexOf("static void StopPythonKernel", start);
  const kernel = launcher.slice(start, end);
  assert.match(launcher, /const int PythonKernelExecutionTimeoutMs = 10 \* 60 \* 1000/);
  assert.match(kernel, /ProcessTreeWorkingSetBytes\(kernel\.Process\.Id\)/);
  assert.match(kernel, /PythonKernelExecutionTimeoutMs/);
  assert.match(kernel, /노트북 커널 실행이 4GB를 넘어 종료했습니다/);
  assert.match(kernel, /노트북 셀 실행이 10분을 넘어 종료했습니다/);
});

test("Python 편집기 터미널은 인증·사용자 확인·프로세스 제한을 거친다", () => {
  assert.match(launcher, /path\.StartsWith\("\/terminal-session-", StringComparison\.Ordinal\)\) return true/);
  assert.match(launcher, /static string OpenTerminalSession\(byte\[\] body\)/);
  assert.match(launcher, /static void RunTerminalCommand\(string id, byte\[\] body\)/);
  assert.match(launcher, /ProcessTreeWorkingSetBytes\(session\.Process\.Id\)/);
  assert.match(launcher, /메모리 제한: 터미널 명령이 4GB를 넘어 종료했습니다/);
  const terminalStart = launcher.indexOf("static string OpenTerminalSession");
  const terminalEnd = launcher.indexOf("static string StartPythonSession", terminalStart);
  const terminal = launcher.slice(terminalStart, terminalEnd);
  assert.doesNotMatch(terminal, /TotalMinutes >= 30/);
  assert.match(launcher, /KillProcessTree\(session\.Process\)/);
  assert.match(pythonTerminal, /터미널 명령은 내 컴퓨터에서 직접 실행됩니다/);
  assert.match(pythonTerminal, /const terminalPollIntervalMs = 500/);
  assert.match(pythonTerminal, /const terminalPollRetryLimit = 3/);
  assert.match(pythonTerminal, /터미널 상태를 확인하지 못했습니다/);
  assert.match(pythonTerminal, /startPyodideKernelRun/);
});

test("로컬 터미널은 PowerShell 프로세스를 재사용해 짧은 명령과 cd를 빠르게 처리한다", () => {
  assert.match(launcher, /while \(\(\$mnLine = \[Console\]::In\.ReadLine\(\)\) -ne \$null\)/);
  assert.match(launcher, /\. \(\[ScriptBlock\]::Create\(\$mnCommand\)\)/);
  assert.match(launcher, /\. \(\[ScriptBlock\]::Create\(\$mnCommand\)\) \| Out-Default/);
  assert.match(launcher, /\$mnSucceeded = \$mnPipelineSucceeded -and \(\$Error\.Count -eq \$mnErrorCount\)/);
  assert.match(launcher, /session\.Input\.WriteLine\(session\.Sequence\.ToString\(\) \+ "\|"/);
  assert.match(pythonTerminal, /fetch\("\/terminal-session-open"/);
  assert.match(pythonTerminal, /fetch\("\/terminal-session-run\?id="/);
  assert.match(pythonTerminal, /setTimeout\(resolve, terminalPollIntervalMs\)/);
  assert.match(pythonTerminal, /현재 폴더와 변수는 다음 명령에도 유지됩니다/);
});

test("터미널의 논리 작업 폴더가 없으면 실제 상위 폴더로 안전하게 대체한다", () => {
  assert.match(launcher, /ResolveTerminalWorkingDirectory\(string requested, out bool fallbackUsed\)/);
  assert.match(launcher, /Path\.GetDirectoryName\(parent\.TrimEnd/);
  assert.match(launcher, /session\.CwdFallback = cwdFallback/);
  assert.match(launcher, /cwdFallback/);
  assert.match(pythonTerminal, /표시된 작업 폴더가 PC에 없어 가장 가까운 실제 폴더/);
});

test("로컬 PowerShell 터미널은 Tab으로 경로를 자동 완성한다", () => {
  assert.match(launcher, /path == "\/terminal-complete"/);
  assert.match(launcher, /static string TerminalCompletionJson\(byte\[\] body\)/);
  assert.match(launcher, /directoryFlag == "1"/);
  assert.match(launcher, /StartsWith\(leaf, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(pythonTerminal, /fetch\("\/terminal-complete"/);
  assert.match(pythonTerminal, /event\.key === "Tab"/);
  assert.match(pythonTerminal, /event\.shiftKey/);
  assert.match(pythonTerminal, /quoteCompletion/);
});

test("열린 터미널 모달은 포커스를 방해하지 않고 Ctrl+C로 중지한다", () => {
  assert.match(pythonTerminal, /const interruptWithKeyboard = \(event\) =>/);
  assert.match(pythonTerminal, /!busy \|\| !isOpen/);
  // 열린 터미널은 화면을 덮는 모달이라 포커스 위치로 중지를 막지 않는다.
  // (로그를 클릭하면 카드로, 닫았다 다시 열면 모달 밖 터미널 버튼으로 포커스가 가 있었다.)
  const interruptStart = pythonTerminal.indexOf("const interruptWithKeyboard");
  const interruptEnd = pythonTerminal.indexOf("runButton.addEventListener", interruptStart);
  const interrupt = pythonTerminal.slice(interruptStart, interruptEnd);
  assert.ok(interruptStart > 0 && interruptEnd > interruptStart);
  assert.doesNotMatch(interrupt, /document\.activeElement|contains\(focused\)/);
  // 명령이 도는 동안에는 입력칸이 disabled 라 포커스를 카드로 보낸다(터미널 밖으로 새지 않게).
  assert.match(pythonTerminal, /const focusTerminal = \(\) => \{ if \(input\.disabled\) card\.focus\(\); else input\.focus\(\); \}/);
  // 한글 입력 상태에서는 event.key 가 "ㅊ" 으로 오므로 code 도 함께 본다.
  assert.match(pythonTerminal, /const key = String\(event\.key \|\| ""\)\.toLowerCase\(\), code = String\(event\.code \|\| ""\)/);
  assert.match(pythonTerminal, /if \(key !== "c" && code !== "KeyC"\) return/);
  assert.match(pythonTerminal, /event\.preventDefault\(\);\s+event\.stopPropagation\(\);\s+stop\(\);/);
  assert.match(pythonTerminal, /document\.removeEventListener\("keydown", interruptWithKeyboard, true\)/);
});

test("Python 편집기 터미널은 실행 결과와 분리된 모달로 열고 Esc로 닫는다", () => {
  assert.match(pythonTerminal, /modal\.className = "modal py-terminal-modal"/);
  assert.match(pythonTerminal, /modal\.setAttribute\("aria-modal", "true"\)/);
  assert.match(pythonTerminal, /const closeTerminal = \(restoreFocus=true\) =>/);
  assert.match(pythonTerminal, /if \(!isOpen \|\| event\.key !== "Escape"\) return/);
  assert.match(pythonTerminal, /modal\.addEventListener\("mousedown", \(event\) => \{ if \(event\.target === modal\) closeTerminal\(\); \}\)/);
  assert.doesNotMatch(pythonTerminal, /const resultStore = document\.createDocumentFragment\(\)/);
});

test("터미널 사용 확인 창은 터미널 모달보다 앞에 표시된다", () => {
  assert.match(styles, /\.modal\{[^}]*z-index:200/);
  assert.match(styles, /\.py-terminal-modal\{z-index:190\}/);
});

test("터미널 중지는 Windows Job과 후손 PID 재검사로 서버 프로세스를 끝낸다", () => {
  assert.match(launcher, /CreateJobObject\(IntPtr lpJobAttributes, string lpName\)/);
  assert.match(launcher, /AssignProcessToJobObject\(IntPtr hJob, IntPtr hProcess\)/);
  assert.match(launcher, /TerminateJobObject\(IntPtr hJob, uint uExitCode\)/);
  assert.match(launcher, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcher, /EnableJobKillOnClose\(session\.JobHandle\)/);
  assert.match(launcher, /session\.JobHandle = CreateJobObject\(IntPtr\.Zero, null\)/);
  assert.match(launcher, /TerminateJobObject\(job, 130\)/);
  assert.match(launcher, /static List<int> ProcessTreeIds\(int rootPid\)/);
  assert.match(launcher, /for \(int attempt = 0; attempt < 3; attempt\+\+\)/);
});
