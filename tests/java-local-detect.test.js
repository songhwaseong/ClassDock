"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcher = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
const runContext = fs.readFileSync(path.join(__dirname, "../src/js/python-run-context.js"), "utf8");

test("자바 탐색은 앱이 설치한 JDK 를 PATH·레지스트리보다 먼저 본다", () => {
  // 학생 PC 에 남은 낡은 자바(8 등)가 PATH 를 잡고 있어도 앱이 받아 둔 JDK 로 실행되어야 한다.
  assert.match(launcher, /static List<KeyValuePair<string, string>> JavaCandidates\(\)/);
  const body = launcher.slice(launcher.indexOf("static List<KeyValuePair<string, string>> JavaCandidates()"));
  const order = ["app-portable", "app-local", "java-home", "\"path\"", "registry"]
    .map((key) => body.indexOf(key));
  assert.ok(order.every((at) => at >= 0), "탐색 출처가 모두 있어야 한다");
  for (let i = 1; i < order.length; i++){
    assert.ok(order[i - 1] < order[i], `탐색 순서가 어긋남: ${i}번째`);
  }
});

test("자동 설치 위치는 exe 옆을 우선하고 쓰기가 막히면 LocalAppData 로 물러난다", () => {
  assert.match(launcher, /static string JdkPortableRoot\(\)/);
  assert.match(launcher, /Path\.Combine\(AppDomain\.CurrentDomain\.BaseDirectory, "jdk"\)/);
  assert.match(launcher, /static string JdkLocalAppDataRoot\(\)/);
  assert.match(launcher, /"ClassDock", "jdk"/);
  assert.match(launcher, /static string JdkInstallRoot\(\)/);
  assert.match(launcher, /if \(CanWriteInto\(parent\)\) return portable;/);
  // 속성만 봐서는 Program Files 가상화·읽기 전용 USB 를 걸러낼 수 없어 실제로 써 본다.
  assert.match(launcher, /static bool CanWriteInto\(string dir\)/);
  assert.match(launcher, /new FileStream\(probe, FileMode\.CreateNew, FileAccess\.Write\)/);
});

test("JRE 만 있는 PC 는 JDK 로 인정하지 않는다", () => {
  assert.match(launcher, /static bool IsUsableJdk\(string exePath\)/);
  assert.match(launcher, /!File\.Exists\(Path\.Combine\(bin, "javac\.exe"\)\)\) return false/);
  assert.match(launcher, /JavaFeatureVersion\(exePath\) >= JavaMinimumFeatureVersion/);
  // 단일 파일 소스 실행(java Foo.java)이 들어온 버전
  assert.match(launcher, /const int JavaMinimumFeatureVersion = 11;/);
});

test("PATH 후보는 폴더째 훑는다 — 이름만으로 실행하면 javac 존재를 확인할 수 없다", () => {
  assert.match(launcher, /static List<string> PathJavaPaths\(\)/);
  assert.match(launcher, /Environment\.GetEnvironmentVariable\("PATH"\)/);
  assert.match(launcher, /Path\.Combine\(dir, "java\.exe"\)/);
});

test("자바 버전 문자열은 1.8 표기와 21 표기를 모두 읽는다", () => {
  assert.match(launcher, /static int JavaFeatureVersion\(string exePath\)/);
  assert.match(launcher, /if \(first != 1\) return first;/);   // 21.0.5 → 21
  assert.match(launcher, /JavaVersionRe/);
  assert.match(launcher, /JavaBareVersionRe/);
  // 폴더 이름 기준 최신 우선 정렬
  assert.match(launcher, /static int JavaVersionRank\(string exePath\)/);
  assert.match(launcher, /if \(major == 1\) \{ major = minor; minor = 0; \}/);
});

test("-version 은 종료를 먼저 기다린 뒤 읽는다(응답 없는 PATH 후보 대비)", () => {
  const fn = launcher.slice(launcher.indexOf("static string RunJavaOutput("));
  const waitAt = fn.indexOf("p.WaitForExit(timeoutMs)");
  const readAt = fn.indexOf("p.StandardOutput.ReadToEnd()");
  assert.ok(waitAt >= 0 && readAt >= 0);
  assert.ok(waitAt < readAt, "ReadToEnd 보다 WaitForExit 가 먼저여야 한다");
});

test("자바 재검사는 인증이 필요한 POST 이고 탐색 캐시를 비운다", () => {
  assert.match(launcher, /if \(path\.StartsWith\("\/java-", StringComparison\.Ordinal\)\) return true;/);
  assert.match(launcher, /method == "POST" && path == "\/java-rescan"/);
  assert.match(launcher, /static void ResetJavaProbe\(\)/);
  assert.match(launcher, /lock \(JavaProbeLock\) \{ _javaProbed = false; _javaCmd = null; _javaSource = ""; \}/);
});

test("진단은 어디서 찾았는지와 설치하면 어디로 갈지를 함께 알려 준다", () => {
  assert.match(launcher, /static string JavaDiagnostics\(\)/);
  const start = launcher.indexOf("static string JavaDiagnostics()");
  const body = launcher.slice(start, launcher.indexOf("\n    }", start));
  assert.ok(body.includes("JsonString(JavaProbeSource())"), "어느 경로에서 찾았는지 알려야 한다");
  // 못 찾았을 때도 installRoot 는 채워 보낸다 — 설치 안내가 '어디에 깔릴지'를 말할 수 있어야 한다.
  const missingBranch = body.slice(0, body.indexOf("string version = RunJavaOutput"));
  assert.ok(missingBranch.includes("installRoot"), "미설치 응답에도 installRoot 가 있어야 한다");
  assert.ok(missingBranch.includes("JavaMinimumFeatureVersion"), "필요한 최소 버전을 알려야 한다");
});

test("프런트는 로컬 JDK 가용 여부를 캐시하고 재검사 때 함께 비운다", () => {
  assert.match(runContext, /const JAVA_RUN_EXTS = new Set\(\["java"\]\)/);
  assert.match(runContext, /async function javaBackendAvailable\(\)/);
  assert.match(runContext, /fetch\("\/can-run-java", \{ method: "GET" \}\)/);
  assert.match(runContext, /function resetJavaBackendProbe\(\)\{\s*_javaBackend = null;/);
  assert.match(runContext, /async function javaEnvironmentDetails\(\)/);
  assert.match(runContext, /function javaSourceLabel\(source\)/);
});

test(".java 는 실행 언어로 잡히고 전용 실행 화면으로 넘어간다", () => {
  // runLangForExt 가 "java" 를 돌려주는데 code-viewer 에 분기가 없으면 파이썬 경로로 떨어져
  // .java 열기 자체가 깨진다 — 두 곳은 항상 같이 있어야 한다.
  const fn = runContext.slice(runContext.indexOf("function runLangForExt(ext)"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /JAVA_RUN_EXTS\.has\(key\)\) return "java"/);
  const codeViewer = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");
  assert.match(codeViewer, /if \(runLang === "java"\)\{\s*\n\s*renderJavaRunnable\(/);
});
