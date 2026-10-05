/*
 * 앱 버전·빌드 정보·배포 기록.
 * - 버전 번호는 package.json 의 "version" 한 곳에만 적는다(사람이 배포할 때 올린다).
 * - 빌드 날짜·커밋 꼬리표는 빌드할 때마다 자동으로 붙는다(build-offline.js 가 HTML 에 새김).
 * - pack.ps1 은 앱 내용의 지문을 지난 배포 기록(release.json)과 비교해, 같으면 번호를 그대로 둔다.
 *
 *   node tools/release.js status              지금 지문과 지난 배포 기록(JSON)
 *   node tools/release.js next patch|minor|major  다음 번호만 출력
 *   node tools/release.js set-version 1.0.1   package.json 의 번호를 바꾼다
 *   node tools/release.js record <zip 이름>    release.json 에 이번 배포를 적는다(같은 내용·번호면 건너뜀)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const releasePath = path.join(root, "release.json");
const offlinePath = path.join(root, "classdock-offline.html");
const VERSION_RE = /^\d+\.\d+\.\d+$/;
// HTML 에 새기는 빌드 정보 블록 — 지문을 잴 때는 이 블록을 뺀다(빌드할 때마다 날짜·꼬리표가 바뀌므로).
const BUILD_INFO_RE = /<script type="application\/json" id="mnBuildInfo">[^<]*<\/script>/;

// exe 에 함께 들어가는 파일(desktop/build.bat 의 /resource·소스)과 배포 zip 에 담기는 파일.
// ffmpeg·JDK·java-libs 는 담을지 말지 고르는 덧붙이개라 앱 내용으로 치지 않는다.
const FINGERPRINT_FILES = [
  "desktop/launcher.cs", "desktop/ssh_terminal.cs", "desktop/ssh_files.cs", "desktop/world_wind.cs",
  "desktop/main.go", "desktop/console_windows.go", "desktop/classdock.ico",
  "desktop/python_kernel.py", "desktop/db_worker.py", "desktop/npm_package_runner.js", "desktop/ssh_shell_integration.bash",
  "docs/API-인증키-안내.md", "THIRD_PARTY_NOTICES.txt"
];
const FINGERPRINT_DIRS = ["vendor/pyodide", "vendor/wheels"];

function readPackageVersion() {
  const version = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
  if (!VERSION_RE.test(String(version || ""))) throw new Error(`package.json version must look like 1.2.3: ${version}`);
  return version;
}

function git(args) {
  try {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    return result.status === 0 ? String(result.stdout || "").trim() : null;
  } catch (_) {
    return null;
  }
}

function localDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// git 이 없거나 저장소가 아니면 커밋 없이 넘어간다. 커밋하지 않은 변경이 있으면 dirty 로 표시한다.
function buildInfo(now = new Date()) {
  const commit = git(["rev-parse", "--short", "HEAD"]) || "";
  const status = commit ? git(["status", "--porcelain"]) : null;
  return {
    name: "ClassDock",
    version: readPackageVersion(),
    date: localDate(now),
    commit,
    dirty: !!(status && status.length)
  };
}

function buildInfoBlock(info) {
  return `<script type="application/json" id="mnBuildInfo">${JSON.stringify(info).replace(/</g, "\\u003c")}</script>`;
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + "/" + entry.name;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

// 앱 내용의 지문. 빌드한 단일 HTML(src·vendor 가 전부 인라인됨)에서 빌드 정보 블록만 빼고,
// exe·zip 에 함께 실리는 파일을 경로 순서대로 더한다. exe 자체는 빌드마다 바이트가 달라 넣지 않는다.
function fingerprint() {
  if (!fs.existsSync(offlinePath)) throw new Error("classdock-offline.html is missing. Run node build-offline.js first.");
  const hash = crypto.createHash("sha256");
  const add = (label, bytes) => {
    hash.update(label + "\0" + bytes.length + "\0");
    hash.update(bytes);
  };
  add("classdock-offline.html", Buffer.from(fs.readFileSync(offlinePath, "utf8").replace(BUILD_INFO_RE, ""), "utf8"));
  const files = FINGERPRINT_FILES.filter((rel) => fs.existsSync(path.join(root, rel)));
  for (const dir of FINGERPRINT_DIRS) {
    if (fs.existsSync(path.join(root, dir))) files.push(...listFiles(dir));
  }
  for (const rel of files.sort()) add(rel, fs.readFileSync(path.join(root, rel)));
  return "sha256-" + hash.digest("base64");
}

function readReleases() {
  if (!fs.existsSync(releasePath)) return [];
  const data = JSON.parse(fs.readFileSync(releasePath, "utf8"));
  return Array.isArray(data.releases) ? data.releases : [];
}

function nextVersion(version, part) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  if (part === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown version part: ${part}`);
}

// package.json 의 나머지 모양(들여쓰기·순서)은 그대로 두고 "version" 값만 바꾼다.
function setVersion(version) {
  if (!VERSION_RE.test(version)) throw new Error(`Version must look like 1.2.3: ${version}`);
  const source = fs.readFileSync(packagePath, "utf8");
  if (!/"version"\s*:\s*"[^"]*"/.test(source)) throw new Error("package.json has no version field.");
  fs.writeFileSync(packagePath, source.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`), "utf8");
}

function record(zipName) {
  const releases = readReleases();
  const info = buildInfo();
  const entry = { version: info.version, date: info.date, commit: info.commit, dirty: info.dirty, fingerprint: fingerprint() };
  if (zipName) entry.package = path.basename(zipName);
  const last = releases[releases.length - 1];
  // 같은 번호·같은 내용으로 다시 묶었을 뿐이면(덧붙이개만 바꿔 묶기 등) 기록을 늘리지 않는다.
  if (last && last.version === entry.version && last.fingerprint === entry.fingerprint) return false;
  releases.push(entry);
  fs.writeFileSync(releasePath, JSON.stringify({ releases }, null, 2) + "\n", "utf8");
  return true;
}

module.exports = { buildInfo, buildInfoBlock, fingerprint, nextVersion, readPackageVersion, BUILD_INFO_RE };

if (require.main === module) {
  const [command, arg] = process.argv.slice(2);
  try {
    if (command === "status") {
      const releases = readReleases();
      process.stdout.write(JSON.stringify({
        version: readPackageVersion(),
        fingerprint: fingerprint(),
        last: releases[releases.length - 1] || null
      }) + "\n");
    } else if (command === "next") {
      process.stdout.write(nextVersion(readPackageVersion(), arg) + "\n");
    } else if (command === "set-version") {
      setVersion(String(arg || ""));
    } else if (command === "record") {
      process.stdout.write((record(arg) ? "recorded" : "unchanged") + "\n");
    } else {
      throw new Error("Usage: node tools/release.js status | next <patch|minor|major> | set-version <x.y.z> | record [zip]");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
