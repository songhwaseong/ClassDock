"use strict";

// 시험 제출 받기(LAN)는 동시 연결 수와 연결 하나가 머무는 시간을 제한하고, 학생 앱은 바쁨(503)에 잠시 뒤 다시 보낸다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const launcher = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");
const exam = fs.readFileSync(path.join(root, "src/js/exam-paper.js"), "utf8");
const csc = ["Framework64", "Framework"].map(framework =>
  path.join(process.env.SystemRoot || "C:/Windows", "Microsoft.NET", framework, "v4.0.30319", "csc.exe")
).find(file => fs.existsSync(file));

test("실제 수락 루프는 한도를 넘는 연결에 곧바로 503 을 주고, 연결이 끝나면 자리를 돌려준다", {
  skip:process.platform !== "win32" || !csc
}, () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempRoot, "classdock-exam-limit-"));
  try {
    const exe = path.join(temp, "exam-limit-test.exe");
    const stub = path.join(temp, "stub.txt");
    fs.writeFileSync(stub, "<html></html>");
    const resources = ["app.html", "python_kernel.py", "db_worker.py", "npm_package_runner.js"]
      .map(name => "/resource:" + stub + "," + name);
    const compiled = spawnSync(csc, [...resources, "/nologo", "/target:exe", "/main:ExamReceiveLimitTest",
      "/r:System.IO.Compression.dll", "/r:System.Security.dll", "/out:" + exe,
      path.join(root, "desktop/launcher.cs"), path.join(root, "desktop/ssh_terminal.cs"),
      path.join(root, "desktop/ssh_files.cs"), path.join(__dirname, "fixtures/exam-receive-limit.cs")
    ], { encoding:"utf8", timeout:30000, windowsHide:true });
    assert.equal(compiled.status, 0, compiled.error?.message || compiled.stdout + compiled.stderr);
    const result = spawnSync(exe, [], { encoding:"utf8", timeout:30000, windowsHide:true });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    assert.match(result.stdout, /Exam receive limit checks passed/);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), tempRoot, "cleanup must stay inside the test temporary directory");
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("연결 하나는 헤더와 본문을 합쳐 정해진 시간 안에 다 보내야 한다", () => {
  assert.match(launcher, /const int ExamReceiveConnectionDeadlineMs = 20000;/);
  const handler = launcher.slice(launcher.indexOf("static void ExamReceiveHandle(TcpClient client)"));
  assert.match(handler, /Stopwatch deadline = Stopwatch\.StartNew\(\);/);
  // 헤더를 읽는 반복과 본문을 읽는 반복 모두에서 전체 시간을 본다(바이트를 조금씩 흘려 읽기 제한을 갱신하는 연결 차단).
  assert.equal((handler.match(/deadline\.ElapsedMilliseconds > ExamReceiveConnectionDeadlineMs/g) || []).length, 2);
  assert.match(handler, /client\.ReceiveTimeout = ExamReceiveReadTimeoutMs;/);
});

test("학생 앱은 바쁨(503)이면 잠시 뒤 두 번까지 다시 보내고, 그래도 바쁘면 안내한다", () => {
  const start = exam.indexOf("async function examSendSubmission(");
  const body = exam.slice(start, exam.indexOf("\n}\n", start));
  assert.match(exam, /const EXAM_SEND_BUSY_RETRY_MS = \[1000, 2500\];/);
  assert.match(body, /if \(res\.status !== 503 \|\| attempt >= EXAM_SEND_BUSY_RETRY_MS\.length\) break;/);
  assert.match(body, /if \(res\.status === 503\) return \{ ok: false, reason: "busy" \};/);
  assert.match(exam, /busy: \{ message: "선생님 PC 에 제출이 몰려/);
});
