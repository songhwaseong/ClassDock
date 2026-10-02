"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const csc = ["Framework64", "Framework"].map(framework => path.join(process.env.SystemRoot || "C:/Windows", "Microsoft.NET", framework, "v4.0.30319", "csc.exe")).find(file => fs.existsSync(file));

test("NOAA GRIB decoder matches ecCodes at all 65,160 points; metadata, masks, cache and retry limits hold", { skip:!csc }, () => {
  const tempRoot = fs.realpathSync(os.tmpdir()), temp = fs.mkdtempSync(path.join(tempRoot, "classdock-world-wind-"));
  try {
    const exe = path.join(temp, "world-wind.exe");
    const compile = spawnSync(csc, ["/nologo", "/target:exe", "/out:" + exe, path.join(root, "desktop/world_wind.cs"), path.join(__dirname, "fixtures/world-wind.cs")], { encoding:"utf8", timeout:30000, windowsHide:true });
    assert.equal(compile.status, 0, compile.error?.message || compile.stdout + compile.stderr);
    const run = spawnSync(exe, [path.join(__dirname, "fixtures/noaa-u850-2026100200-f006.grib2"), path.join(temp, "cache")], { encoding:"utf8", timeout:30000, windowsHide:true });
    assert.equal(run.status, 0, run.error?.message || run.stdout + run.stderr);
    assert.match(run.stdout, /World wind checks: \d+ passed/);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), tempRoot);
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("world routes require local authentication and both Windows build commands include the decoder", () => {
  const launcher = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");
  assert.match(launcher, /if \(path == "\/can-proxy-world-wind" \|\| path.StartsWith\("\/world-wind-", StringComparison.Ordinal\)\) return true;/);
  for (const file of ["build.bat", "build-dotnet.bat"]) assert.match(fs.readFileSync(path.join(root, "desktop", file), "utf8"), /"world_wind.cs"/);
});
