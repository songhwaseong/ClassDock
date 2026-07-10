const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
const stateSync = fs.readFileSync(path.join(__dirname, "../src/js/state-sync.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
const pythonRuntime = fs.readFileSync(path.join(__dirname, "../src/js/python-runtime.js"), "utf8");

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
  assert.match(launcher, /!HasAllowedLocalOrigin\(headers\) && !path\.StartsWith\("\/tile-proxy"/);
  const auth = launcher.indexOf("if (RequiresLocalAuthToken(method, path) && !HasLocalAuthToken(headers))");
  const body = launcher.indexOf("// ---- 바디(있으면) 읽기 ----");
  assert.ok(auth >= 0 && body >= 0 && auth < body);
  assert.match(launcher, /client\.ReceiveTimeout = 15000/);
  assert.match(launcher, /413 Payload Too Large/);
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
  assert.match(launcher, /const long PythonProcessMemoryLimitBytes = 1536L/);
  assert.match(launcher, /static long ProcessTreeWorkingSetBytes/);
  assert.match(launcher, /메모리 제한: 실행이 1\.5GB를 넘어 중단했습니다/);
  assert.match(launcher, /메모리 제한: 대화형 실행이 1\.5GB를 넘어 종료했습니다/);
});
