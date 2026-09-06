"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const csc = ["Framework64", "Framework"].map(framework =>
  path.join(process.env.SystemRoot || "C:/Windows", "Microsoft.NET", framework, "v4.0.30319", "csc.exe")
).find(file => fs.existsSync(file));

test("실제 HTTP 저장 경로는 불완전 본문·교체 실패에서 원본을 보존하고 정상 빈 파일도 저장한다", {
  skip:process.platform !== "win32" || !csc
}, () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempRoot, "classdock-file-save-"));
  try {
    const exe = path.join(temp, "file-save-test.exe");
    const stub = path.join(temp, "stub.txt");
    fs.writeFileSync(stub, "<html></html>");
    const resources = ["app.html", "python_kernel.py", "db_worker.py", "npm_package_runner.js"]
      .map(name => "/resource:" + stub + "," + name);
    const compiled = spawnSync(csc, [...resources, "/nologo", "/target:exe", "/main:LocalFileSaveTest",
      "/r:System.IO.Compression.dll", "/r:System.Security.dll", "/out:" + exe,
      path.join(root, "desktop/launcher.cs"), path.join(root, "desktop/ssh_terminal.cs"),
      path.join(root, "desktop/ssh_files.cs"), path.join(__dirname, "fixtures/local-file-save.cs")
    ], { encoding:"utf8", timeout:30000, windowsHide:true });
    assert.equal(compiled.status, 0, compiled.error?.message || compiled.stdout + compiled.stderr);
    const result = spawnSync(exe, [temp], { encoding:"utf8", timeout:30000, windowsHide:true });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    assert.match(result.stdout, /Local file save checks passed/);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), tempRoot, "cleanup must stay inside the test temporary directory");
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
