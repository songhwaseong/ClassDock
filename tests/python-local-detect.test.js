"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
const runContext = fs.readFileSync(path.join(__dirname, "../src/js/python-run-context.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

test("로컬 파이썬은 PATH 다음에 레지스트리와 표준 설치 폴더까지 찾는다", () => {
  assert.match(launcher, /static string ProbePython\(\)/);
  assert.match(launcher, /string\[\] cands = \{ "py", "python", "python3" \}/);
  assert.match(launcher, /foreach \(string exe in InstalledPythonCandidates\(\)\)/);
  assert.match(launcher, /static List<string> RegistryPythonPaths\(\)/);
  assert.match(launcher, /OpenSubKey\("SOFTWARE\\\\Python"\)/);
  assert.match(launcher, /install\.GetValue\("ExecutablePath"\)/);
  assert.match(launcher, /static List<string> WellKnownPythonPaths\(\)/);
  assert.match(launcher, /Path\.Combine\(local, "Programs\\\\Python"\)/);
  assert.match(launcher, /Directory\.GetDirectories\(root, "Python3\*"\)/);
  assert.match(launcher, /string\[\] condaNames = \{ "anaconda3", "miniconda3", "miniforge3" \}/);
});

test("파이썬 후보는 Python 3 응답으로 검증해 Store 안내용 가짜 실행 파일을 거른다", () => {
  assert.match(launcher, /static bool IsUsablePython\(string cmd\)/);
  assert.match(launcher, /if \(p\.ExitCode != 0\) return false/);
  assert.match(launcher, /IndexOf\("Python 3", StringComparison\.OrdinalIgnoreCase\) >= 0/);
});

test("여러 파이썬이 설치돼 있으면 최신 버전을 먼저 시도한다", () => {
  assert.match(launcher, /static int PythonVersionRank\(string exePath\)/);
  assert.match(launcher, /return major \* 1000 \+ Math\.Min\(minor, 999\)/);
  assert.match(launcher, /found\.Sort\(delegate\(KeyValuePair<int, string> a, KeyValuePair<int, string> b\) \{ return b\.Key\.CompareTo\(a\.Key\); \}\)/);
});

test("파이썬 재검사는 인증이 필요한 POST 이고 탐색 캐시를 비운다", () => {
  assert.match(launcher, /if \(path == "\/python-rescan"\) return true/);
  assert.match(launcher, /method == "POST" && path == "\/python-rescan"/);
  assert.match(launcher, /static void ResetPythonProbe\(\)/);
  assert.match(launcher, /lock \(PyProbeLock\) \{ _pythonProbed = false; _pythonCmd = null; \}/);
  assert.match(launcher, /lock \(JediLock\) \{ _jediReady = null; \}/);
});

test("Py Env 는 브라우저 파이썬일 때 원인별 안내와 다시 검사를 보여 준다", () => {
  assert.match(runContext, /function buildPythonEnvHelp\(panel, btn\)/);
  assert.match(runContext, /if \(!info\.backend\) panel\.appendChild\(buildPythonEnvHelp\(panel, btn\)\)/);
  assert.match(runContext, /Add python\.exe to PATH/);
  assert.match(runContext, /테스트용 브라우저 모드로 고정돼 있습니다/);
  assert.match(runContext, /지금은 로컬 파이썬을 쓸 수 없는 실행 방식입니다/);
  assert.match(runContext, /fetch\("\/python-rescan", \{ method:"POST", cache:"no-store" \}\)/);
  // 프런트 캐시 비우기는 Py Env 와 DB 접속 화면이 함께 쓰는 함수로 묶여 있다.
  assert.match(runContext, /function resetPythonBackendProbe\(\)\{[\s\S]*?_pyBackend = null;/);
  assert.match(runContext, /resetPythonBackendProbe\(\);\s+\/\/ 프론트 캐시도 비워야/);
  assert.match(styles, /\.py-env-help\{/);
});
