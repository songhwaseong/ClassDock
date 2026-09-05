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

test("영상 변환은 호환 스트림 보존·GPU 실패 대체·취소와 실제 MP4 출력을 검증한다", {
  skip:process.platform !== "win32" || !csc
}, () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempRoot, "classdock-media-"));
  try {
    const exe = path.join(temp, "media-test.exe");
    const resource = path.join(temp, "stub.txt");
    fs.writeFileSync(resource, "<html></html>");
    const resources = ["app.html", "python_kernel.py", "db_worker.py", "npm_package_runner.js"]
      .map((name) => "/resource:" + resource + "," + name);
    const compiled = spawnSync(csc, [...resources,"/nologo", "/target:exe", "/main:MediaConvertTest",
      "/r:System.IO.Compression.dll", "/r:System.Security.dll", "/out:" + exe,
      path.join(root, "desktop/launcher.cs"), path.join(root, "desktop/ssh_terminal.cs"),
      path.join(root, "desktop/ssh_files.cs"), path.join(__dirname, "fixtures/media-convert.cs")
    ], { encoding:"utf8", timeout:30000, windowsHide:true });
    assert.equal(compiled.status, 0, compiled.error?.message || compiled.stdout + compiled.stderr);
    const result = spawnSync(exe, [path.join(root, "ffmpeg.exe"), temp], { encoding:"utf8", timeout:60000, windowsHide:true });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    assert.match(result.stdout, /Media conversion checks passed/);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), tempRoot, "cleanup must stay inside the test temporary directory");
    fs.rmSync(temp, { recursive:true, force:true });
  }
});