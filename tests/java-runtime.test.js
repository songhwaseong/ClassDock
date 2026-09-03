"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const runtimeSource = fs.readFileSync(path.join(root, "src/js/java-runtime.js"), "utf8");
const editorSource = fs.readFileSync(path.join(root, "src/js/java-editor.js"), "utf8");
const i18nSource = fs.readFileSync(path.join(root, "src/js/i18n.js"), "utf8");
const launcher = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");

// java-runtime.js 는 로드 시점에 브라우저 전역을 건드리지 않으므로 vm 컨텍스트에 그대로 올릴 수 있다.
// 다른 파일에 있는 공용 함수(normalizeGradingOutput 등)만 최소한으로 채워 넣는다.
function loadRuntime(){
  const context = vm.createContext({
    console,
    location:{ protocol:"http:" },
    fetch: () => { throw new Error("no network in test"); },
    normalizeGradingOutput: (text) => String(text == null ? "" : text).replace(/\r\n?/g, "\n").replace(/\s+$/, "")
  });
  new vm.Script(runtimeSource, { filename:"java-runtime.js" }).runInContext(context);
  return (name) => vm.runInContext(name, context);
}

const get = loadRuntime();

test("컴파일 오류에서 편집기 줄 번호를 뽑는다", () => {
  const javaErrorLine = get("javaErrorLine");
  const stderr = [
    "C:\\Users\\me\\AppData\\Local\\Temp\\moidajava_session_abc123\\Broken.java:3: error: incompatible types",
    "        int x = \"문자열\";",
    "                ^",
    "1 error"
  ].join("\n");
  assert.equal(javaErrorLine(stderr, "Broken"), 3);
});

test("실행 스택에서는 JDK 안쪽 프레임을 건너뛰고 학생 파일의 줄을 고른다", () => {
  const javaErrorLine = get("javaErrorLine");
  const stderr = [
    "Exception in thread \"main\" java.util.NoSuchElementException",
    "\tat java.base/java.util.Scanner.throwFor(Scanner.java:937)",
    "\tat java.base/java.util.Scanner.nextLine(Scanner.java:1651)",
    "\tat Greeter.main(Greeter.java:7)"
  ].join("\n");
  assert.equal(javaErrorLine(stderr, "Greeter"), 7);
});

test("학생 코드의 헬퍼 메서드에서 터지면 가장 깊은 자기 프레임을 고른다", () => {
  const javaErrorLine = get("javaErrorLine");
  const stderr = [
    "Exception in thread \"main\" java.lang.ArithmeticException: / by zero",
    "\tat Calc.divide(Calc.java:11)",
    "\tat Calc.main(Calc.java:4)"
  ].join("\n");
  assert.equal(javaErrorLine(stderr, "Calc"), 11);
});

test("오류가 없으면 줄 번호도 없다", () => {
  const javaErrorLine = get("javaErrorLine");
  assert.equal(javaErrorLine("", "Main"), 0);
  assert.equal(javaErrorLine("경고: 무언가", "Main"), 0);
});

test("오류 메시지에서 실행 임시 폴더 경로를 지운다", () => {
  const cleanJavaStderr = get("cleanJavaStderr");
  const raw = "C:\\Users\\me\\AppData\\Local\\Temp\\moidajava_session_deadbeef01\\Broken.java:3: error: bad\n1 error\nerror: compilation failed";
  const cleaned = cleanJavaStderr(raw);
  assert.ok(!cleaned.includes("moidajava_session"), "임시 폴더 경로가 남아 있다");
  assert.ok(cleaned.startsWith("Broken.java:3: error: bad"), cleaned);
  // "1 error" 뒤에 같은 말을 반복하는 마지막 줄은 잡음이라 지운다.
  assert.ok(!cleaned.includes("compilation failed"), cleaned);
  // 경로를 지운 뒤에도 줄 번호는 그대로 읽혀야 한다.
  assert.equal(get("javaErrorLine")(cleaned, "Broken"), 3);
});

test("표준입력을 읽는 코드를 알아본다", () => {
  const javaUsesInput = get("javaUsesInput");
  assert.equal(javaUsesInput("Scanner sc = new Scanner(System.in);"), true);
  assert.equal(javaUsesInput("BufferedReader br = new BufferedReader(new InputStreamReader(System.in));"), true);
  assert.equal(javaUsesInput("System.out.println(\"hi\");"), false);
});

test("채점 입력은 마지막 줄에도 개행을 붙인다", () => {
  const javaGradingStdin = get("javaGradingStdin");
  // 개행이 없으면 Scanner 의 nextLine() 이 마지막 값을 받지 못한다.
  assert.equal(javaGradingStdin("3"), "3\n");
  assert.equal(javaGradingStdin("1\r\n2"), "1\n2\n");
  assert.equal(javaGradingStdin(""), "");
});

test("채점 한 줄은 오류가 없을 때만 통과로 본다", () => {
  const row = get("javaGradingRow");
  const call = (test, raw) => row(test, 0, raw);
  assert.equal(call({ expected:"6" }, { stdout:"6\n", stderr:"", code:0 }).passed, true);
  assert.equal(call({ expected:"6" }, { stdout:"7\n", stderr:"", code:0 }).passed, false);
  // stderr 가 있으면 출력이 맞아도 통과가 아니다.
  assert.equal(call({ expected:"6" }, { stdout:"6\n", stderr:"Exception ...", code:1 }).passed, false);
  // stderr 없이 System.exit(1) 한 코드도 정상 제출로 보면 안 된다.
  assert.equal(call({ expected:"6" }, { stdout:"6\n", stderr:"", code:1 }).passed, false);
  assert.equal(call({ expected:"6" }, { stdout:"", stderr:"", timedOut:true }).passed, false);
});

test("채점은 에코가 섞이지 않는 파이프 입력 경로를 쓴다", () => {
  // /java-session-input 은 터미널처럼 보이려고 stdout 에 에코를 남긴다 — 채점 비교에 섞이면 안 된다.
  assert.match(runtimeSource, /runJavaHeadless[\s\S]{0,200}startJavaSession\(source, stdinText, true, options\.libs\)/);
  assert.match(runtimeSource, /if \(piped\) query\.push\("piped=1"\);/);
  assert.match(launcher, /StartJavaSession\(body, QueryValue\(path, "piped"\) == "1", QueryValue\(path, "libs"\)\)/);
  assert.match(launcher, /if \(pipedStdin != null\)/);
  assert.match(launcher, /session\.Process\.StandardInput\.Close\(\); \} catch \{ \}/);
  const start = launcher.indexOf("static string StartJavaSessionProcess");
  const body = launcher.slice(start, launcher.indexOf("static bool CompileJavaSource", start));
  assert.ok(body.indexOf("StartLimitedReader") < body.indexOf("Thread inputWriter"), "출력 리더가 입력 writer보다 먼저 시작해야 한다");
  assert.ok(body.indexOf("watcher.Start()") < body.indexOf("Thread inputWriter"), "제한 감시가 입력 writer보다 먼저 시작해야 한다");
});

test("파일 이름과 실제 main 클래스를 따로 찾아 컴파일·실행한다", () => {
  assert.match(launcher, /static string JavaMainClassName\(string source\)/);
  assert.match(launcher, /static string JavaLaunchClassName\(string source\)/);
  assert.match(launcher, /string scriptPath = Path\.Combine\(tempRoot, fileClassName \+ "\.java"\);/);
  assert.match(launcher, /foreach \(JavaTypeCandidate type in types\) if \(type\.HasMain\) return type\.Name;/);
  assert.match(launcher, /static bool CompileJavaSource\(string javac/);
  // 클래스패스는 실행 임시 폴더 + 고른 라이브러리 jar 를 담은 한 줄(JavaClassPath)이다.
  assert.match(launcher, /-cp \\\""\s*\+ classPath \+ "\\\" " \+ qualifiedClassName/);
  // 주석·문자열에 적힌 class 이름에 속지 않도록 먼저 지운다.
  assert.match(launcher, /static string StripJavaCommentsAndStrings\(string source\)/);
  assert.match(launcher, /JavaMainClassName\(source\)[\s\S]{0,80}StripJavaCommentsAndStrings|StripJavaCommentsAndStrings\(source \?\? ""\)/);
});

test("실행은 한글이 깨지지 않도록 인코딩을 명시한다", () => {
  // 파이프로 받으면 자바가 시스템 기본(한글 Windows 는 cp949)을 쓴다 — 세 속성을 모두 지정해야 한다.
  assert.match(launcher, /-Dfile\.encoding=UTF-8 -Dstdout\.encoding=UTF-8 -Dstderr\.encoding=UTF-8/);
  assert.match(launcher, /psi\.StandardOutputEncoding = new UTF8Encoding\(false\);[\s\S]{0,120}psi\.StandardErrorEncoding/);
});

test("자바 편집기는 빈 파일에만 골격을 넣는다", () => {
  // 학생이 지운 내용을 되살리면 안 되므로 초안이 있으면 건드리지 않는다.
  assert.match(editorSource, /const initial = restoredDraft !== null \? restoredDraft : \(text\.trim\(\) === "" \? JAVA_STARTER_SOURCE : text\);/);
  assert.match(editorSource, /public static void main\(String\[\] args\)/);
  assert.match(editorSource, /const JAVA_GRADE_PREFIX = "classdock-java-grade:"/);
});

test("자바 편집기는 파이썬 공용 편집기 함수를 재사용한다", () => {
  ["pythonDraftKey", "loadPythonDraft", "savePythonDraft", "clearPythonDraft",
   "buildCodeEditor", "attachRunSplitter", "markDocumentDirty", "saveTextDoc"].forEach((name) => {
    assert.ok(editorSource.includes(name), `공용 함수 ${name} 를 쓰지 않는다`);
  });
  // 파이썬 전용 지능(Jedi)은 꺼야 한다 — 켜 두면 자바 코드를 파이썬 분석기에 물어보게 된다.
  assert.match(editorSource, /plain: true,\s*\n\s*fileExt: ext,/);
});

test("설치 안내는 문서가 닫히면 폴링과 자동 재실행을 폐기한다", () => {
  assert.match(runtimeSource, /wrap\.dispose = \(\) => \{ disposed = true; \}/);
  const succeed = runtimeSource.slice(runtimeSource.indexOf("const succeed = (version)"), runtimeSource.indexOf("rescan.addEventListener"));
  assert.match(succeed, /if \(disposed\) return;/);
  assert.match(succeed, /onReady\(\)/);
  assert.match(runtimeSource, /if \(disposed\) return;\s*\n\s*const res = await fetch\("\/java-install-status"/);
  assert.match(editorSource, /if \(typeof ui\.disposeInstallGuide === "function"\) ui\.disposeInstallGuide\(\);[\s\S]{0,160}ui\.cancelRun/);
  assert.match(editorSource, /ui\.isDisposed = \(\) => disposed/);
});

test("Java 실행 화면의 전용 문구는 영문 모드 번역을 제공한다", () => {
  [".java 저장", "자바 자동 설치", "다시 검사", "자바 실행 환경", "입력 끝", "실행 결과 · 대화형 터미널"]
    .forEach((label) => assert.ok(i18nSource.includes(JSON.stringify(label)), `번역 키 누락: ${label}`));
  assert.match(runtimeSource, /window\.MNI18N\.translateTree\(wrap\)/);
  assert.match(runtimeSource, /javaTf\("채점 중… \{index\}\/\{total\}"/);
});

test("세션 정리는 앱 종료 때도 빠뜨리지 않는다", () => {
  assert.match(launcher, /foreach \(JavaSession session in javaSessions\)/);
  assert.match(launcher, /if \(!session\.Complete\) KillProcessTree\(session\.Process\);\s*\n\s*CleanupJavaSessionFiles\(session\);/);
  assert.match(launcher, /static void SweepJavaSessions\(\)/);
});

// ── JDK 원클릭 설치 ────────────────────────────────────────────────────────

test("설치는 배포처가 준 SHA-256 을 대조한 뒤에만 자리를 잡는다", () => {
  // 200MB 를 실행 파일로 쓰는 것이라 ffmpeg 설치보다 한 겹 더 확인한다.
  assert.match(launcher, /static void FetchJdkAsset\(out string link, out string checksum/);
  assert.match(launcher, /static string Sha256File\(string path\)/);
  const worker = launcher.slice(launcher.indexOf("static void InstallJdkWorker()"));
  const verifyAt = worker.indexOf("Sha256File(tmpZip)");
  const extractAt = worker.indexOf("ExtractZipToDirectory(tmpZip, staging)");
  assert.ok(verifyAt >= 0 && extractAt >= 0);
  assert.ok(verifyAt < extractAt, "체크섬 대조는 압축을 풀기 전에 해야 한다");
  assert.match(launcher, /Sha256HexRe\.IsMatch\(checksum\)/);
});

test("압축은 대상 폴더 밖을 가리키는 경로를 버린다(zip-slip)", () => {
  assert.match(launcher, /static void ExtractZipToDirectory\(string zipPath, string destRoot\)/);
  assert.match(launcher, /if \(!full\.StartsWith\(rootFull, StringComparison\.OrdinalIgnoreCase\)\) continue;\s*\/\/ zip-slip/);
});

test("설치는 임시 폴더에 풀고 성공한 뒤에 제자리로 옮긴다", () => {
  // 중간에 실패해도 반쯤 풀린 jdk 폴더가 남으면 다음 실행이 그것을 잡는다.
  assert.match(launcher, /staging = root \+ "\.part-"/);
  assert.match(launcher, /static void ReplaceDirectory\(string staging, string dest\)/);
  assert.match(launcher, /if \(staging != null && Directory\.Exists\(staging\)\) Directory\.Delete\(staging, true\)/);
  // 실패하면 받은 zip 도 지운다.
  assert.match(launcher, /if \(File\.Exists\(tmpZip\)\) File\.Delete\(tmpZip\)/);
});

test("받기 전에 디스크 여유 공간을 확인한다", () => {
  const worker = launcher.slice(launcher.indexOf("static void InstallJdkWorker()"));
  const spaceAt = worker.indexOf("EnsureJdkFreeSpace(");
  const downloadAt = worker.indexOf('_jdkInstallState = "downloading"');
  assert.ok(spaceAt >= 0 && downloadAt >= 0);
  assert.ok(spaceAt < downloadAt, "공간 확인은 내려받기 전에 해야 한다");
  // 설치 위치와 임시 파일이 다른 드라이브일 수 있다.
  assert.match(launcher, /CheckDriveFreeSpace\(installRoot, needed\);\s*\n\s*CheckDriveFreeSpace\(tempFile, needed\);/);
});

test("설치가 끝나면 탐색 캐시를 비우고 실제로 찾히는지 확인한다", () => {
  const worker = launcher.slice(launcher.indexOf("static void InstallJdkWorker()"));
  assert.match(worker, /ResetJavaProbe\(\);\s*\n\s*if \(FindJava\(\) == null\) throw new Exception/);
  assert.match(worker, /_jdkInstallState = "done";/);
});

test("이미 자바가 있으면 200MB 를 다시 받지 않는다", () => {
  assert.match(launcher, /path == "\/java-install"[\s\S]{0,200}if \(FindJava\(\) != null\)[\s\S]{0,200}"already"/);
  // 같은 설치가 두 번 돌지 않도록 진행 중이면 새 스레드를 띄우지 않는다.
  assert.match(launcher, /if \(!JdkInstallRunning\(\)\)/);
});

test("설치 진행 상태는 내려받기와 압축 풀기를 따로 보여 준다", () => {
  const text = get("javaInstallProgressText");
  assert.match(text({ state:"metadata" }), /확인하는 중/);
  assert.equal(text({ state:"downloading", received:52428800, total:209715200 }), "자바 내려받는 중… 50 / 200 MB");
  assert.match(text({ state:"downloading", received:0, total:0 }), /내려받는 중/);
  assert.match(text({ state:"verifying" }), /확인 중/);
  assert.equal(text({ state:"extracting", extracted:50, entries:200 }), "설치 중… 25%");
});

test("자동 설치는 확인을 받은 뒤에 시작한다", () => {
  // 인터넷으로 200MB 를 받는 동작이라 누르기 전에 한 번 묻는다.
  assert.match(runtimeSource, /confirmDialog\([\s\S]{0,200}Eclipse Adoptium 공식 배포처[\s\S]{0,200}\);\s*\n\s*if \(!yes\) return;/);
  assert.match(runtimeSource, /fetch\("\/java-install", \{ method:"POST" \}\)/);
  assert.match(runtimeSource, /fetch\("\/java-install-status", \{ cache:"no-store" \}\)/);
  // 설치가 끝나면 학생이 방금 누른 실행을 그대로 이어 준다.
  assert.match(runtimeSource, /if \(info\.state === "done"\)\{ succeed\(info\.version\); return; \}/);
  assert.match(runtimeSource, /const succeed = \(version\) =>[\s\S]{0,300}resetJavaBackendProbe\(\)[\s\S]{0,300}onReady\(\)/);
});

test("설치 계열 POST 도 토큰을 요구한다", () => {
  // /java- prefix 규칙이 /java-install 까지 덮는지 — 새 엔드포인트가 인증에서 새지 않아야 한다.
  assert.match(launcher, /if \(path\.StartsWith\("\/java-", StringComparison\.Ordinal\)\) return true;/);
  assert.ok(launcher.includes('path == "/java-install"'), "설치 엔드포인트가 있어야 한다");
});

test("한글 클래스 이름도 파일·실행 후보와 오류 줄에서 그대로 인식한다", () => {
  assert.match(launcher, /const string JavaIdStart = .*\\p\{L\}/);
  assert.match(launcher, /Name = m\.Groups\[2\]\.Value/);
  const javaErrorLine = get("javaErrorLine");
  assert.equal(javaErrorLine("\tat 인사.main(인사.java:5)", "인사"), 5);
  assert.equal(javaErrorLine("인사.java:3: error: bad", "인사"), 3);
});
