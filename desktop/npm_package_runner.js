"use strict";

// 만능파일교실 EXE가 시작하는 npm 설치 도우미.
// 사용자 패키지의 install script는 서버가 npm에 --ignore-scripts를 넘겨 실행하지 않는다.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const MAX_PROJECT_BYTES = 250 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const ESBUILD_VERSION = "0.25.8";

function fail(message){
  process.stderr.write("\n[오류] " + String(message || "npm package install failed") + "\n");
  process.exit(1);
}

function folderBytes(root){
  let total = 0;
  const stack = [root];
  while (stack.length){
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes:true }); }
    catch (_) { continue; }
    for (const entry of entries){
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()){
        try { total += fs.statSync(full).size; } catch (_) {}
        if (total > MAX_PROJECT_BYTES) return total;
      }
    }
  }
  return total;
}

function packageFolder(project, packageName){
  const parts = packageName.split("/");
  return path.join(project, "node_modules", ...parts);
}

function replaceFolder(stage, target){
  const old = target + ".old-" + process.pid;
  try { fs.rmSync(old, { recursive:true, force:true }); } catch (_) {}
  if (fs.existsSync(target)) fs.renameSync(target, old);
  try {
    fs.renameSync(stage, target);
    try { fs.rmSync(old, { recursive:true, force:true }); } catch (_) {}
  } catch (error){
    if (!fs.existsSync(target) && fs.existsSync(old)) fs.renameSync(old, target);
    throw error;
  }
}

function main(){
  const [cacheRoot, id, npmCli, spec, packageName, globalName] = process.argv.slice(2);
  if (!cacheRoot || !/^[a-f0-9]{32}$/.test(id || "") || !npmCli || !spec || !packageName || !globalName) {
    fail("invalid installer arguments");
  }
  const target = path.join(cacheRoot, id);
  const stage = path.join(cacheRoot, ".work-" + id + "-" + process.pid);
  fs.mkdirSync(cacheRoot, { recursive:true });
  fs.rmSync(stage, { recursive:true, force:true });
  fs.mkdirSync(stage, { recursive:true });

  try {
    fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({
      name:"manneung-js-package-cache", private:true, version:"1.0.0"
    }, null, 2));

    process.stdout.write("npm install " + spec + "\n");
    const install = cp.spawnSync(process.execPath, [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund",
      "--save-exact", "--package-lock=true", spec, "esbuild@" + ESBUILD_VERSION], {
      cwd:stage, stdio:"inherit", windowsHide:true
    });
    if (install.error) throw install.error;
    if (install.status !== 0) throw new Error("npm install이 종료 코드 " + install.status + "로 끝났습니다.");

    const installedBytes = folderBytes(stage);
    if (installedBytes > MAX_PROJECT_BYTES) throw new Error("설치 파일이 250MB 제한을 넘었습니다.");

    const packageJsonPath = path.join(packageFolder(stage, packageName), "package.json");
    if (!fs.existsSync(packageJsonPath)) throw new Error("설치된 패키지 정보를 찾지 못했습니다: " + packageName);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const resolvedVersion = String(packageJson.version || "");
    if (!resolvedVersion) throw new Error("설치된 패키지 버전을 확인하지 못했습니다.");

    const entry = [
      "import * as __mnPackage from " + JSON.stringify(packageName) + ";",
      "const __mnValue = Object.prototype.hasOwnProperty.call(__mnPackage, 'default') ? __mnPackage.default : __mnPackage;",
      "globalThis[" + JSON.stringify(globalName) + "] = __mnValue;"
    ].join("\n");
    const entryPath = path.join(stage, "entry.js");
    const bundlePath = path.join(stage, "bundle.js");
    fs.writeFileSync(entryPath, entry, "utf8");
    process.stdout.write("브라우저 Worker용 번들을 만드는 중...\n");
    const esbuild = require(path.join(stage, "node_modules", "esbuild"));
    esbuild.buildSync({
      entryPoints:[entryPath], bundle:true, format:"iife", platform:"browser", target:["es2020"],
      outfile:bundlePath, logLevel:"info", legalComments:"none", sourcemap:false
    });
    const bundleBytes = fs.statSync(bundlePath).size;
    if (bundleBytes <= 0 || bundleBytes > MAX_BUNDLE_BYTES) throw new Error("생성된 번들이 8MB 제한을 넘었거나 비어 있습니다.");

    const metadata = {
      id, spec, name:packageName, version:resolvedVersion, global:globalName,
      size:bundleBytes, installedAt:new Date().toISOString()
    };
    fs.writeFileSync(path.join(stage, "metadata.json"), JSON.stringify(metadata), "utf8");
    replaceFolder(stage, target);
    process.stdout.write("\n설치 완료: " + packageName + "@" + resolvedVersion + " → " + globalName + "\n");
  } catch (error){
    try { fs.rmSync(stage, { recursive:true, force:true }); } catch (_) {}
    const message = error && error.message ? error.message : String(error);
    if (/Could not resolve|built into node|node:/.test(message)) {
      fail("이 패키지는 Node.js 전용 모듈에 의존해 브라우저 Worker용으로 묶을 수 없습니다.\n" + message);
    }
    fail(message);
  }
}

main();
