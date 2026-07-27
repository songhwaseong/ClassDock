"use strict";

// 패키지 설치는 몇 분이 걸릴 수 있어 "지금 진행 중"이 보이는지가 전부다.
// 순수 헬퍼와 스트리밍 드라이버는 실제로 실행해 검증하고, DOM/타이머 배선과 서버 경로는
// 소스 텍스트로 고정한다(python-stderr-classify·local-server-security 와 같은 방식).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtimeSource = fs.readFileSync(path.join(__dirname, "../src/js/python-runtime.js"), "utf8");
const viewerSource = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");
const notebookSource = fs.readFileSync(path.join(__dirname, "../src/js/notebook-tools.js"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
const launcherSource = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");

// fetch·setTimeout 을 인자로 넘겨 안쪽 호출이 스텁에 묶이게 한다(폴링 대기는 즉시 풀어 테스트를 빠르게).
function loadRuntime(fetchStub){
  const mod = { exports: {} };
  new Function("module", "window", "document", "localStorage", "navigator", "fetch", "setTimeout",
    runtimeSource + "\nmodule.exports = { pipInstallTryLock, pipInstallUnlock, pipPkgLabel, pipElapsedText, pipLogForDisplay, pipLogHeadline, pipErrorText, pipInstallStream };")(
    mod, {}, {}, { getItem: () => null, setItem: () => {} }, {},
    fetchStub || (() => { throw new Error("fetch 를 쓰지 않아야 한다"); }),
    (fn) => { fn(); return 0; });
  return mod.exports;
}

// 경로별 응답을 순서대로 돌려주는 fetch 스텁. 호출 기록을 calls 에 남긴다.
function makeFetch(plan){
  const calls = [];
  const queues = {};
  for (const key of Object.keys(plan)) queues[key] = plan[key].slice();
  const stub = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || "GET" });
    const key = Object.keys(queues).find((k) => url.startsWith(k));
    if (!key) throw new Error("스텁에 없는 경로: " + url);
    const next = queues[key].length > 1 ? queues[key].shift() : queues[key][0];
    if (next.error) throw next.error;
    const bodyText = typeof next.body === "string" ? next.body : JSON.stringify(next.body || {});
    const status = next.status == null ? 200 : next.status;
    return { status, ok: status >= 200 && status < 300, text: async () => bodyText, json: async () => JSON.parse(bodyText) };
  };
  stub.calls = calls;
  return stub;
}

const { pipPkgLabel, pipElapsedText } = loadRuntime();

test("설치 라벨은 3개까지는 그대로, 그보다 많으면 '외 N개'로 줄인다", () => {
  assert.equal(pipPkgLabel(["requests"]), "requests");
  assert.equal(pipPkgLabel(["requests", "beautifulsoup4", "lxml"]), "requests beautifulsoup4 lxml");
  assert.equal(pipPkgLabel(["matplotlib", "openpyxl", "seaborn", "scipy"]), "matplotlib openpyxl seaborn 외 1개");
  assert.equal(pipPkgLabel(["a", "b", "c", "d", "e"]), "a b c 외 2개");
});

test("경과 시간은 분:초로 표시되고 초는 두 자리로 채운다", () => {
  assert.equal(pipElapsedText(0), "0:00");
  assert.equal(pipElapsedText(7400), "0:07");
  assert.equal(pipElapsedText(60000), "1:00");
  assert.equal(pipElapsedText(75000), "1:15");
  assert.equal(pipElapsedText(605000), "10:05");
  assert.equal(pipElapsedText(-500), "0:00");   // 시계가 뒤로 가도 음수를 보여주지 않는다
});

test("설치를 시작하면 라이브러리 팝오버를 닫아 진행 표시가 가려지지 않게 한다", () => {
  // .run-pkg-wrap 은 실행 바 아래(출력 패널 위)에 겹쳐 뜨므로 닫지 않으면 스피너가 보이지 않는다.
  assert.match(cssSource, /\.run-pkg-wrap\{position:absolute;top:calc\(100% \+ 6px\)/);
  assert.match(runtimeSource, /if \(typeof ui\.closePkg === "function"\) ui\.closePkg\(\);/);
  assert.match(viewerSource, /ui\.closePkg = closePkg;/);
});

test("설치 잠금은 첫 await 전에 선점되고 finally 에서 반드시 풀린다", () => {
  const { pipInstallTryLock, pipInstallUnlock } = loadRuntime();
  assert.equal(pipInstallTryLock(), true);
  assert.equal(pipInstallTryLock(), false);
  pipInstallUnlock();
  assert.equal(pipInstallTryLock(), true);
  pipInstallUnlock();

  const runStart = runtimeSource.indexOf("async function runPipInstall");
  const lockAt = runtimeSource.indexOf("if (!pipInstallTryLock())", runStart);
  const firstAwait = runtimeSource.indexOf("await pythonBackendAvailable()", runStart);
  assert.ok(lockAt >= runStart && lockAt < firstAwait, "비동기 사전 확인보다 먼저 잠금을 잡아야 한다");
  assert.match(runtimeSource, /\} finally \{\s*\n\s*pipInstallUnlock\(\);\s*\n\s*\}\s*\n\}/);
  assert.match(runtimeSource, /\} finally \{\s*\n\s*clearInterval\(timer\);\s*\n\s*if \(typeof ui\.setPkgBusy === "function"\) ui\.setPkgBusy\(false\);/);
});

test("잠금은 라이브러리 패널 안의 모든 조작과 패널 버튼까지 함께 끈다", () => {
  assert.match(viewerSource, /const setPkgBusy = \(busy\) => \{[\s\S]*?pkgWrap\.querySelectorAll\("button, input"\)\.forEach\(el => \{ el\.disabled = !!busy; \}\);[\s\S]*?pkgBtn\.disabled = !!busy;/);
  assert.match(viewerSource, /ui\.setPkgBusy = setPkgBusy;/);
  assert.match(cssSource, /\.pkg-set:disabled,\.pkg-go:disabled,\.pkg-custom:disabled\{opacity:\.45;cursor:not-allowed\}/);
});

test("진행 표시는 1초마다 갱신되는 경과 시간과 도는 스피너를 함께 보여준다", () => {
  assert.match(runtimeSource, /const timer = setInterval\(tick, 1000\);/);
  assert.match(runtimeSource, /progTime\.textContent = el \+ " 경과";/);
  assert.match(runtimeSource, /status\.textContent = "설치 중… " \+ label \+ " · " \+ el;/);
  // 1초마다 바뀌는 시간은 라이브 영역에서 빼서 스크린리더가 반복해 읽지 않게 한다.
  assert.match(runtimeSource, /prog\.setAttribute\("role", "status"\)/);
  assert.match(runtimeSource, /progTime\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(cssSource, /\.pip-spin\{[^}]*animation:spin \.8s linear infinite\}/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)\{ \.pip-spin\{animation-duration:2\.4s\} \}/);
});

test("설치가 끝나면 진행 표시를 걷어내고 걸린 시간을 결과에 남긴다", () => {
  assert.match(runtimeSource, /const stopProgress = \(\) => \{ clearInterval\(timer\); prog\.remove\(\); hint\.remove\(\); \};/);
  assert.match(runtimeSource, /status\.textContent = r\.ok \? \("설치 완료 ✓ · " \+ took\) : \(r\.cancelled \? "설치 취소됨" : "설치 실패"\)/);
});

// ── B단계: pip 로그 실시간 스트리밍 ────────────────────────────────────────────

test("스트리밍 설치는 증분 로그를 이어붙이고 받은 길이만큼 from 을 올려 보낸다", async () => {
  const fetchStub = makeFetch({
    "/pip-install-start": [{ body: { id: "job1" } }],
    "/pip-install-poll": [
      { body: { complete: false, code: -1, log: "pip install pandas\n" } },
      { body: { complete: false, unchanged: true } },
      { body: { complete: false, code: -1, logDelta: "Collecting pandas\n" } },
      { body: { complete: true, code: 0, logDelta: "Successfully installed pandas-2.2.2\n" } },
    ],
  });
  const { pipInstallStream } = loadRuntime(fetchStub);
  const seen = [];
  const r = await pipInstallStream(["pandas"], { onLog: (text) => seen.push(text) });

  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.streamed, true);
  assert.equal(r.cancelled, false);
  assert.equal(r.output, "pip install pandas\nCollecting pandas\nSuccessfully installed pandas-2.2.2\n");
  // unchanged 응답은 화면을 다시 그리지 않는다 → onLog 는 내용이 자란 3번만 불린다.
  assert.deepEqual(seen, [
    "pip install pandas\n",
    "pip install pandas\nCollecting pandas\n",
    "pip install pandas\nCollecting pandas\nSuccessfully installed pandas-2.2.2\n",
  ]);
  const polls = fetchStub.calls.filter((c) => c.url.startsWith("/pip-install-poll"));
  assert.equal(polls.length, 4);
  assert.match(polls[0].url, /&from=-1$/);          // 첫 폴은 누적 로그 전체를 받아온다
  assert.match(polls[1].url, /&from=19$/);
  assert.match(polls[2].url, /&from=19$/);          // unchanged 였으므로 오프셋은 그대로
  assert.match(polls[3].url, /&from=37$/);
});

test("취소를 누르면 서버에 취소를 보내고 결과를 '취소'로 돌려준다", async () => {
  const fetchStub = makeFetch({
    "/pip-install-start": [{ body: { id: "job2" } }],
    "/pip-install-cancel": [{ body: "ok" }],
    "/pip-install-poll": [
      { body: { complete: false, code: -1, log: "Collecting numpy\n" } },
      { body: { complete: true, code: -1, cancelled: true, logDelta: "[설치를 취소했습니다.]\n" } },
    ],
  });
  const { pipInstallStream } = loadRuntime(fetchStub);
  const handed = [];
  const r = await pipInstallStream(["numpy"], {
    onCancel: (cancel) => { handed.push(cancel); if (cancel) cancel(); },
  });

  assert.equal(r.ok, false);
  assert.equal(r.cancelled, true);
  assert.match(r.output, /\[설치를 취소했습니다\.\]/);
  const cancels = fetchStub.calls.filter((c) => c.url.startsWith("/pip-install-cancel"));
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].method, "POST");
  assert.match(cancels[0].url, /id=job2/);
  // 취소 함수는 시작할 때 넘겨주고, 끝나면 null 로 회수해 취소 버튼이 남지 않게 한다.
  assert.equal(typeof handed[0], "function");
  assert.equal(handed[handed.length - 1], null);
});

test("폴링의 일시 오류는 재시도하고 이어서 설치 결과를 받는다", async () => {
  const fetchStub = makeFetch({
    "/pip-install-start": [{ body: { id: "retry-job" } }],
    "/pip-install-poll": [
      { error: new Error("temporary-1") },
      { error: new Error("temporary-2") },
      { body: { complete: true, code: 0, log: "Successfully installed pandas\n" } },
    ],
  });
  const { pipInstallStream } = loadRuntime(fetchStub);
  const r = await pipInstallStream(["pandas"], {});

  assert.equal(r.ok, true);
  assert.equal(fetchStub.calls.filter((c) => c.url.startsWith("/pip-install-poll")).length, 3);
  assert.equal(fetchStub.calls.filter((c) => c.url.startsWith("/pip-install-cancel")).length, 0);
});

test("폴링 오류가 반복되면 뒤에서 도는 설치를 취소한 후 실패한다", async () => {
  const fetchStub = makeFetch({
    "/pip-install-start": [{ body: { id: "failed-poll-job" } }],
    "/pip-install-poll": [
      { error: new Error("offline-1") },
      { error: new Error("offline-2") },
      { error: new Error("offline-3") },
    ],
    "/pip-install-cancel": [{ body: "ok" }],
  });
  const { pipInstallStream } = loadRuntime(fetchStub);

  await assert.rejects(
    () => pipInstallStream(["numpy"], {}),
    /설치 진행 상태를 확인하지 못해 설치를 중단했어요: offline-3/);
  assert.equal(fetchStub.calls.filter((c) => c.url.startsWith("/pip-install-poll")).length, 3);
  assert.equal(fetchStub.calls.filter((c) => c.url.startsWith("/pip-install-cancel")).length, 1);
});

test("시작 응답에 작업 번호가 없으면 one-shot 설치를 겹쳐 시작하지 않는다", async () => {
  const fetchStub = makeFetch({
    "/pip-install-start": [{ body: {} }],
  });
  const { pipInstallStream } = loadRuntime(fetchStub);

  await assert.rejects(() => pipInstallStream(["lxml"], {}), /설치 작업 번호를 받지 못했어요/);
  assert.equal(fetchStub.calls.filter((c) => c.url === "/pip-install").length, 0);
});

test("스트리밍 경로가 없는 예전 exe(404)에서는 한 번에 응답하는 경로로 폴백한다", async () => {
  const fetchStub = makeFetch({
    "/pip-install-start": [{ status: 404, body: "Not found" }],
    "/pip-install": [{ body: { ok: true, code: 0, output: "Successfully installed lxml-5.2.1\n" } }],
  });
  const { pipInstallStream } = loadRuntime(fetchStub);
  const seen = [];
  const r = await pipInstallStream(["lxml"], { onLog: (text) => seen.push(text) });

  assert.equal(r.ok, true);
  assert.equal(r.streamed, false);
  assert.equal(r.output, "Successfully installed lxml-5.2.1");
  assert.deepEqual(seen, ["Successfully installed lxml-5.2.1"]);
  assert.equal(fetchStub.calls.filter((c) => c.url.startsWith("/pip-install-poll")).length, 0);
});

test("서버가 낸 짧은 오류 코드는 사용자 문장으로 바꿔 알린다", async () => {
  const { pipErrorText } = loadRuntime();
  assert.match(pipErrorText("no-python"), /Python 을 찾지 못했어요/);
  assert.match(pipErrorText("pip-failed: invalid-package: pandas;rm"), /쓸 수 없는 문자/);
  assert.equal(pipErrorText("  "), "알 수 없는 오류");

  const fetchStub = makeFetch({ "/pip-install-start": [{ status: 501, body: "no-python" }] });
  const { pipInstallStream } = loadRuntime(fetchStub);
  await assert.rejects(() => pipInstallStream(["pandas"], {}), /Python 을 찾지 못했어요/);
});

test("진행 중 로그는 마지막 부분만 그리고, 상태줄용 한 줄은 진행바 파편을 건너뛴다", () => {
  const { pipLogForDisplay, pipLogHeadline } = loadRuntime();
  const short = "Collecting pandas\n";
  assert.equal(pipLogForDisplay(short), short);
  const shown = pipLogForDisplay("x".repeat(30000));
  assert.match(shown, /^…\(로그가 길어 마지막 부분만 표시 중\)\n/);
  assert.equal(shown.length, "…(로그가 길어 마지막 부분만 표시 중)\n".length + 24000);

  assert.equal(pipLogHeadline("Collecting pandas\nDownloading pandas.whl (11 MB)\n"), "Downloading pandas.whl (11 MB)");
  assert.equal(pipLogHeadline("Collecting pandas\n━━━━━━━━\n   \n"), "Collecting pandas");
  assert.equal(pipLogHeadline(""), "");
  assert.equal(pipLogHeadline("y".repeat(100)).length, 70);   // 상태줄이 밀리지 않게 70자로 줄인다
});

test("노트북 설치도 같은 드라이버를 쓰고, 실행 바의 ■ 가 pip 취소로 연결된다", () => {
  const fnStart = notebookSource.indexOf("async function nbInstallMissingModule");
  const lockAt = notebookSource.indexOf("if (!pipInstallTryLock())", fnStart);
  const firstAwait = notebookSource.indexOf("await pythonBackendAvailable()", fnStart);
  assert.ok(lockAt >= fnStart && lockAt < firstAwait, "노트북도 비동기 확인보다 먼저 공통 잠금을 잡아야 한다");
  assert.match(notebookSource, /await pipInstallStream\(\[pkg\], \{/);
  assert.match(notebookSource, /ownerDoc\._nbActiveTask = cancel \? \{ cancel \} : prevTask;/);
  // 설치를 시작하기 전에 이미 ■ 를 눌렀다면 바로 끊는다.
  assert.match(notebookSource, /if \(cancel && ownerDoc\._nbCancelRequested\) cancel\(\);/);
  // 상태줄에 경과 시간과 pip 진행 줄을 함께 흘린다.
  assert.match(notebookSource, /nbSetStatus\(ownerDoc, "패키지 설치 중… " \+ pkg \+ " · " \+ el \+ \(headline \? " · " \+ headline : ""\)\);/);
  assert.match(notebookSource, /const timer = setInterval\(paint, 1000\);/);
  assert.match(notebookSource, /\} finally \{[\s\S]*?clearInterval\(timer\);[\s\S]*?ownerDoc\._nbActiveTask = prevTask;/);
  assert.match(notebookSource, /\} finally \{\s*\n\s*pipInstallUnlock\(\);\s*\n\s*\}\s*\n\}/);
});

// ── B단계: 서버(launcher.cs) 경로 ─────────────────────────────────────────────

test("서버는 설치를 시작·폴링·취소로 나누고 시작에는 여전히 동의 헤더를 요구한다", () => {
  assert.match(launcherSource, /method == "POST" && path == "\/pip-install-start"/);
  assert.match(launcherSource, /method == "GET" && path\.StartsWith\("\/pip-install-poll", StringComparison\.Ordinal\)/);
  assert.match(launcherSource, /method == "POST" && path\.StartsWith\("\/pip-install-cancel", StringComparison\.Ordinal\)/);
  // 시작 경로도 확인 헤더가 없으면 403 — 기존 /pip-install 과 같은 문턱.
  assert.match(launcherSource,
    /path == "\/pip-install-start"\)\s*\n\s*\{\s*\n\s*string pipConfirmed;\s*\n\s*if \(!headers\.TryGetValue\("x-manneung-pip-confirm", out pipConfirmed\) \|\| pipConfirmed != "1"\)/);
  // 예전 오프라인 HTML 을 위해 한 번에 응답하는 경로는 남겨 둔다.
  assert.match(launcherSource, /method == "POST" && path == "\/pip-install"\)/);
});

test("설치 관련 경로는 모두 실행별 인증 토큰을 요구한다", () => {
  assert.match(launcherSource, /if \(path\.StartsWith\("\/pip-install", StringComparison\.Ordinal\)\) return true;/);
  assert.match(launcherSource, /if \(path\.StartsWith\("\/pip-install-poll", StringComparison\.Ordinal\)\) return true;/);
});

test("서버는 로그를 버퍼에 흘려 담고 증분 폴링·취소·정리를 갖춘다", () => {
  // stdout·stderr 를 한 버퍼에 모아 pip 가 낸 순서를 지킨다.
  assert.match(launcherSource, /StartLimitedReader\(job\.Process\.StandardOutput, job\.Log\);/);
  assert.match(launcherSource, /StartLimitedReader\(job\.Process\.StandardError, job\.Log\);/);
  // 진행 중이고 자란 게 없으면 본문 없이 짧게 답한다(파이썬 세션 폴링과 같은 규약).
  assert.match(launcherSource, /if \(known && !job\.Complete && from == job\.Log\.TextLength\)\s*\n\s*return "\{\\"complete\\":false,\\"unchanged\\":true\}";/);
  assert.match(launcherSource, /return head \+ ",\\"logDelta\\":" \+ JsonString\(job\.Log\.GetTextFrom\(from\)\) \+ "\}";/);
  // 취소는 프로세스 트리를 끊고, 종료 코드와 무관하게 실패로 보고한다.
  assert.match(launcherSource, /static void CancelPipInstall\(string id\)[\s\S]*?KillProcessTree\(job\.Process\);/);
  assert.match(launcherSource, /job\.ExitCode = job\.CancelRequested \? -1 : \(exited \? code : -1\);/);
  // 기존 5분 상한은 그대로 유지한다.
  assert.match(launcherSource, /job\.Process\.WaitForExit\(300000\)/);
  assert.match(launcherSource, /static void SweepPipJobs\(\)/);
});
