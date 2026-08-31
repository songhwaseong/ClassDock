"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const csc = ["Framework64", "Framework"].map((framework) =>
  path.join(process.env.SystemRoot || "C:/Windows", "Microsoft.NET", framework, "v4.0.30319", "csc.exe")
).find((file) => fs.existsSync(file));

test("SSH 서버는 미수신 종료 출력을 보존하고 수신 완료·명시적 종료 후에만 정리한다", {
  skip:process.platform !== "win32" || !csc
}, () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempRoot, "classdock-ssh-retention-"));
  try {
    const exe = path.join(temp, "retention.exe");
    const compiled = spawnSync(csc, ["/nologo", "/target:exe", "/main:SshSessionRetentionTest",
      "/r:System.IO.Compression.dll", "/r:System.Security.dll", "/out:" + exe,
      path.join(root, "desktop/launcher.cs"), path.join(root, "desktop/ssh_terminal.cs"),
      path.join(root, "desktop/ssh_files.cs"),
      path.join(__dirname, "fixtures/ssh-session-retention.cs")
    ], { encoding:"utf8", timeout:30000, windowsHide:true });
    assert.equal(compiled.status, 0, compiled.error?.message || compiled.stdout + compiled.stderr);
    const result = spawnSync(exe, [], { encoding:"utf8", timeout:10000, windowsHide:true });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    assert.match(result.stdout, /SSH session retention checks passed/);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), tempRoot, "cleanup must stay inside the test temporary directory");
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
