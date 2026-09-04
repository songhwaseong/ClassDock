"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const runtimeSource = fs.readFileSync(path.join(root, "src/js/java-runtime.js"), "utf8");
const editorSource = fs.readFileSync(path.join(root, "src/js/java-editor.js"), "utf8");
const pythonEditorSource = fs.readFileSync(path.join(root, "src/js/python-editor.js"), "utf8");
const i18nSource = fs.readFileSync(path.join(root, "src/js/i18n.js"), "utf8");
const launcher = fs.readFileSync(path.join(root, "desktop/launcher.cs"), "utf8");
const stateSource = fs.readFileSync(path.join(root, "src/js/state.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
const manualSource = fs.readFileSync(path.join(root, "사용법.md"), "utf8");

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

test("Java Ctrl+클릭은 java.lang 표준 타입을 JDK 소스 대상으로 해석한다", () => {
  const targetAt = get("javaDefinitionTargetAt");
  const source = "public class Demo {\n  StringBuffer value = new StringBuffer();\n}";
  const start = source.lastIndexOf("StringBuffer");
  const target = targetAt(source, { word:"StringBuffer", start });
  assert.equal(target.kind, "jdk");
  assert.equal(target.name, "StringBuffer");
  assert.equal(target.qualified, "java.lang.StringBuffer");
});

test("Java Ctrl+클릭은 import된 JDK 타입의 완전 이름을 찾는다", () => {
  const targetAt = get("javaDefinitionTargetAt");
  const source = "import java.util.ArrayList;\nclass Demo { ArrayList<String> rows; }";
  const start = source.lastIndexOf("ArrayList");
  assert.equal(targetAt(source, { word:"ArrayList", start }).qualified, "java.util.ArrayList");
});

test("Java Ctrl+클릭은 현재 파일의 타입·메서드로 이동하고 주석 속 가짜 정의는 무시한다", () => {
  const targetAt = get("javaDefinitionTargetAt");
  const source = [
    "// class Ghost {}",
    "public class Demo {",
    "  void helper() { }",
    "  void run() { helper(); }",
    "}"
  ].join("\n");
  assert.equal(targetAt(source, { word:"Demo", start:source.indexOf("Demo") }).line, 2);
  const helper = targetAt(source, { word:"helper", start:source.lastIndexOf("helper") });
  assert.equal(helper.scope, "local");
  assert.equal(helper.kind, "method");
  assert.equal(helper.line, 3);
  assert.equal(targetAt(source, { word:"Ghost", start:source.indexOf("Ghost") }), null);
});

test("Java 편집기와 EXE 런처가 JDK src.zip 정의 이동 경로를 연결한다", () => {
  assert.match(editorSource, /definitionTargetAt:\s*\(\{ source, wordInfo \}\)\s*=>\s*javaDefinitionTargetAt/);
  assert.match(editorSource, /requestJavaDefinitionSource\(target\.qualified\)/);
  assert.match(launcher, /path == "\/java-definition"/);
  assert.match(launcher, /static string JavaDefinitionSource\(byte\[\] body\)/);
  assert.match(launcher, /Path\.Combine\(home, "lib", "src\.zip"\)/);
});

test("Java 자동완성은 StringBuffer와 import된 타입의 패키지를 알려 준다", () => {
  const detail = get("javaCompletionTypePackage");
  assert.equal(detail("class Demo {}", "StringBuffer"), "java.lang");
  assert.equal(detail("import java.util.ArrayList;\nclass Demo {}", "ArrayList"), "java.util");
  assert.equal(detail("class Demo {}", "HashMap"), "java.util");
});

test("현재 파일의 동명 타입과 애매한 외부 타입에는 잘못된 패키지를 표시하지 않는다", () => {
  const detail = get("javaCompletionTypePackage");
  assert.equal(detail("class StringBuffer {}", "StringBuffer"), "");
  assert.equal(detail("class Demo {}", "Widget", { classes:["a.Widget", "b.Widget"], members:{} }), "");
  assert.equal(detail("class Demo {}", "Widget", { classes:["com.example.Widget"], members:{} }), "com.example");
});

test("공용 자동완성 보조 설명 훅을 Java 편집기가 패키지 계산에 사용한다", () => {
  assert.match(pythonEditorSource, /typeof options\.completionDetail === "function"/);
  assert.match(pythonEditorSource, /options\.completionDetail\(info, ta\.value\)/);
  assert.match(editorSource, /completionDetail:\s*\(item, source\)\s*=>\s*javaCompletionTypePackage/);
});

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

test("Java 실행 결과는 컴파일 실패·실행 오류·정상 종료를 구분한다", () => {
  const outcome = get("javaRunOutcome");
  const compile = outcome({ code:1, mainClass:"Broken", stderr:"Broken.java:3: error: ';' expected\n1 error" });
  const runtime = outcome({ code:1, mainClass:"Main", stderr:"Exception in thread \"main\" java.lang.ArithmeticException" });
  const success = outcome({ code:0, mainClass:"Main", stderr:"" });
  assert.equal(compile.kind, "compile-error");
  assert.equal(runtime.kind, "runtime-error");
  assert.equal(success.kind, "success");
  assert.match(compile.label, /컴파일 실패/);
  assert.match(runtime.label, /실행 중 오류/);
  assert.match(success.label, /정상 종료/);
});

test("실행 구성의 상세 경고는 저장 검사·실행·채점과 javac까지 이어진다", () => {
  assert.match(editorSource, /buildJavaRunConfigPopover\(/);
  assert.match(editorSource, /상세 컴파일 경고 사용 \(-Xlint:all\)/);
  assert.match(editorSource, /runConfig\.getLint\(\)/);
  assert.match(runtimeSource, /if \(lint\) query\.push\("lint=1"\)/);
  assert.match(runtimeSource, /if \(options\.lint\) query\.push\("lint=1"\)/);
  assert.match(launcher, /QueryValue\(path, "lint"\) == "1"/);
  assert.match(launcher, /\(lint \? " -Xlint:all" : ""\)/);
});

test("Java 실행 구성은 main·패키지·형제 파일·라이브러리·JDK·임시 폴더를 보여 준다", () => {
  assert.match(editorSource, /function javaRunSourceInfo\(/);
  assert.match(editorSource, /main 클래스/);
  assert.match(editorSource, /함께 컴파일/);
  assert.match(editorSource, /javaSiblingFileNames\(ownerDoc\)/);
  assert.match(editorSource, /libraries:\(\) => libraryPicker\.getQuery\(\)/);
  assert.match(editorSource, /javaEnvironmentDetails\(\)/);
  assert.match(editorSource, /ClassDock 임시 폴더 · 실행 후 자동 정리/);
  assert.match(editorSource, /java-run-more-toggle/);
});

test("Java 실행 구성은 포커스 위치와 관계없이 Esc로 닫히고 문서 종료 때 키 리스너를 해제한다", () => {
  const start = editorSource.indexOf("function buildJavaRunConfigPopover");
  const end = editorSource.indexOf("// ── 새 자바 파일 만들기", start);
  const block = editorSource.slice(start, end);
  assert.match(block, /window\.addEventListener\("keydown", onKey, true\)/);
  assert.match(block, /window\.removeEventListener\("keydown", onKey, true\)/);
  assert.doesNotMatch(block, /bar\.addEventListener\("keydown", onKey\)/);
});

test("Java 코드 정렬은 블록 들여쓰기를 맞추고 text block은 보존한다", () => {
  const format = get("javaFormatSource");
  assert.equal(format("class Main {\npublic static void main(String[] args) {\nSystem.out.println(1);\n}\n}\n"),
    "class Main {\n    public static void main(String[] args) {\n        System.out.println(1);\n    }\n}\n");
  const textBlock = "class Main {\nString s = \"\"\"\n  그대로\n\"\"\";\n}";
  assert.equal(format(textBlock), textBlock);
});

test("Java import 정리는 중복·미사용을 제거하고 명확한 표준 import를 추가한다", () => {
  const organize = get("javaOrganizeImports");
  const source = [
    "package demo;", "", "import java.util.List;", "import java.util.List;", "import java.util.HashMap;", "",
    "class Main {", "    List<String> rows = new ArrayList<>();", "}", ""
  ].join("\n");
  const result = organize(source, { words:[], classes:[] });
  assert.equal((result.match(/import java\.util\.List;/g) || []).length, 1);
  assert.match(result, /import java\.util\.ArrayList;/);
  assert.doesNotMatch(result, /HashMap/);
});

test("여러 main 선택과 JUnit 실행은 검증된 런처 경로와 별도 요약을 쓴다", () => {
  const summary = get("javaJunitSummary")({ stdout:"[ 3 tests found ]\n[ 2 tests successful ]\n[ 1 tests failed ]\n[ 0 tests skipped ]", stderr:"" });
  assert.equal(summary.found, 3);
  assert.equal(summary.successful, 2);
  assert.equal(summary.failed, 1);
  assert.match(editorSource, /getMainClass:\(\) =>/);
  assert.match(editorSource, /mainClass:runConfig\.getMainClass\(\)/);
  assert.match(runtimeSource, /query\.push\("main="/);
  assert.match(runtimeSource, /query\.push\("junit=1"\)/);
  assert.match(launcher, /type\.HasMain && string\.Equals\(type\.Name, requestedMain/);
  assert.match(launcher, /junit-platform-console-standalone-/);
  assert.match(launcher, /--scan-class-path --disable-banner --disable-ansi-colors --details=tree/);
  assert.match(editorSource, /run-java-junit/);
  assert.match(editorSource, /run-java-format/);
  assert.match(editorSource, /run-java-imports/);
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
  const lintWarning = "Main.java:3: warning: [deprecation] old() in Legacy has been deprecated\n    old();\n    ^\n1 warning";
  assert.equal(call({ expected:"6" }, { stdout:"6\n", stderr:lintWarning, code:0, mainClass:"Main" }).passed, true);
  assert.equal(call({ expected:"6" }, { stdout:"6\n", stderr:lintWarning + "\n프로그램 경고", code:0, mainClass:"Main" }).passed, false);
});

test("채점은 에코가 섞이지 않는 파이프 입력 경로를 쓴다", () => {
  // /java-session-input 은 터미널처럼 보이려고 stdout 에 에코를 남긴다 — 채점 비교에 섞이면 안 된다.
  assert.match(runtimeSource, /runJavaHeadless[\s\S]{0,280}startJavaSession\(source, stdinText, true, options\.libs, options\.extras, options\.lint,/);
  assert.match(runtimeSource, /if \(piped\) query\.push\("piped=1"\);/);
  assert.match(launcher, /StartJavaSession\(body, QueryValue\(path, "piped"\) == "1", QueryValue\(path, "libs"\),\s*\n\s*QueryValue\(path, "lint"\) == "1", QueryValue\(path, "main"\), QueryValue\(path, "junit"\) == "1"\)/);
  assert.match(launcher, /if \(pipedStdin != null\)/);
  assert.match(launcher, /session\.Process\.StandardInput\.Close\(\); \} catch \{ \}/);
  const start = launcher.indexOf("static string StartJavaSessionProcess");
  const body = launcher.slice(start, launcher.indexOf("static bool CompileJavaSource", start));
  assert.ok(body.indexOf("StartLimitedReader") < body.indexOf("Thread inputWriter"), "출력 리더가 입력 writer보다 먼저 시작해야 한다");
  assert.ok(body.indexOf("watcher.Start()") < body.indexOf("Thread inputWriter"), "제한 감시가 입력 writer보다 먼저 시작해야 한다");
});

test("파일 이름과 실제 main 클래스를 따로 찾아 컴파일·실행한다", () => {
  assert.match(launcher, /static string JavaMainClassName\(string source\)/);
  assert.match(launcher, /static string JavaLaunchClassName\(string source, string requestedMain\)/);
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

test("새 자바 파일은 사이드바 + 메뉴·시작 화면·폴더 우클릭 세 곳에서 만들 수 있다", () => {
  const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
  const documentsSource = fs.readFileSync(path.join(root, "src/js/documents.js"), "utf8");

  // 사이드바 + 메뉴: 항목이 있고, 눌렀을 때 동작하고, 키보드 이동 목록에도 들어간다.
  assert.match(html, /id="sbNewJava"[^>]*role="menuitem"/);
  assert.match(html, /<span>새 자바 코드\(\.java\)<\/span>/);
  assert.match(appSource, /byId\("sbNewJava"\)\.onclick = \(\) => \{ if \(typeof newJavaScratch === "function"\) newJavaScratch\(\); \}/);
  assert.match(appSource, /byId\("sbNewJs"\), byId\("sbNewJava"\)/);

  // 시작 화면 '다른 문서 만들기' + 폴더 우클릭
  assert.match(html, /id="dzNewJava"[^>]*role="menuitem"/);
  assert.match(documentsSource, /add\("\+Java {2}새 자바 코드"[\s\S]{0,140}newJavaScratchInFolder\(node\.newPythonContext\)/);

  // 만드는 길은 파이썬·자바스크립트 스크래치와 같은 공용 함수를 쓴다.
  assert.match(editorSource, /createScratchInFolder\(folder, javaScratchFileName, javaScratchStarter,\s*\n?\s*"text\/x-java-source"/);
  assert.match(editorSource, /function newJavaScratch\(\)\{[\s\S]{0,320}activeFolderContextForNewFile\(\)/);
  // 미저장 새 파일도 자동복원 바탕 문서를 남기도록 queueFiles 경로를 쓴다.
  assert.match(editorSource,
    /function newJavaScratch\(\)\{[\s\S]{0,600}typeof queueFiles === "function"[\s\S]{0,120}queueFiles\(\[file\], \{ isScratch:true \}\)/);

  // 메뉴 라벨은 한/EN 사전에도 있어야 영어 UI 에서 한글로 남지 않는다.
  assert.match(i18nSource, /"새 자바 코드\(\.java\)": "New Java file \(\.java\)"/);
  assert.match(i18nSource, /"\+Java {2}새 자바 코드": "\+Java {2}New Java code"/);
});

/* 자바만의 이름 규칙 — 파일 이름이 곧 public 클래스 이름이다.
   파이썬·자바스크립트처럼 "새 코드 2.py" 를 쓰면 javac 가 받지 못하는 파일이 디스크에 남는다. */
test("새 자바 파일 이름은 식별자로 유효하고, 시작 코드의 클래스 이름과 같다", () => {
  const context = vm.createContext({ t:(s) => s, shortcutDisplay:() => "F5", shortcutValue:() => "F5" });
  const pick = /function javaScratchFileName[\s\S]*?\n\}\n[\s\S]*?function javaScratchStarter[\s\S]*?\n\}\n/.exec(editorSource);
  assert.ok(pick, "이름·시작코드 함수를 찾을 수 있어야 한다");
  const api = vm.runInContext(pick[0] + "\n({ name:javaScratchFileName, starter:javaScratchStarter })", context);

  assert.equal(api.name(1), "Main.java");
  assert.equal(api.name(3), "Main3.java");
  for (const n of [1, 2, 7]){
    const file = api.name(n);
    const cls = file.replace(/\.java$/, "");
    assert.match(cls, /^[A-Za-z_$][A-Za-z0-9_$]*$/, "클래스 이름으로 쓸 수 있어야 한다: " + file);
    // 시작 코드의 public 클래스 이름이 파일 이름과 어긋나면 javac 가 거절한다.
    assert.match(api.starter(file), new RegExp("public class " + cls + " \{"));
    assert.match(api.starter(file), /public static void main\(String\[\] args\)/);
  }
});

test("자바 저장 파일명은 영문 대문자로 시작하는 클래스 이름만 허용한다", () => {
  const context = vm.createContext({ console });
  const start = editorSource.indexOf("const JAVA_FILE_ID_START_RE");
  const end = editorSource.indexOf("function createJavaScratchInFolder", start);
  assert.ok(start >= 0 && end > start, "자바 파일 이름 검사 함수를 찾을 수 있어야 한다");
  const source = editorSource.slice(start, end);
  const api = vm.runInContext(source + "\n;({ validate:javaFileNameValidationMessage, rename:javaRenamePublicTypeForFile })", context);

  assert.equal(api.validate("Student.java"), "");
  assert.match(api.validate("student.java"), /대문자/);
  assert.match(api.validate("1Student.java"), /대문자/);
  assert.match(api.validate("My Student.java"), /클래스 이름으로 쓸 수 있는 문자/);
  assert.match(api.validate("Student.txt"), /\.java 확장자/);
});

test("자바 파일명을 바꾸면 최상위 public 타입만 같은 이름으로 바꾼다", () => {
  const context = vm.createContext({ console });
  const start = editorSource.indexOf("const JAVA_FILE_ID_START_RE");
  const end = editorSource.indexOf("function createJavaScratchInFolder", start);
  const source = editorSource.slice(start, end);
  const rename = vm.runInContext(source + "\n;javaRenamePublicTypeForFile", context);
  const before = [
    "// public class CommentOnly {}",
    "class Helper {}",
    "public class Main {",
    "    String sample = \"public class StringOnly {}\";",
    "    public Main() {}",
    "    Main copy = new Main();",
    "    public class Inner {}",
    "}"
  ].join("\n");
  const result = rename(before, "Student.java");
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.match(result.value, /public class Student \{/);
  assert.match(result.value, /public class CommentOnly/);
  assert.match(result.value, /public class StringOnly/);
  assert.match(result.value, /public class Inner/);
  assert.match(result.value, /class Helper \{\}/);
  assert.match(result.value, /public Student\(\) \{\}/);
  assert.match(result.value, /Student copy = new Student\(\)/);
  assert.match(result.value, /String sample = "public class StringOnly \{\}"/);
  assert.doesNotMatch(result.value, /public class Main \{/);
});

test("자바 이름 규칙과 클래스명 동기화는 모든 파일명 변경 저장 경로에 연결된다", () => {
  const codeViewer = fs.readFileSync(path.join(root, "src/js/code-viewer.js"), "utf8");
  const documents = fs.readFileSync(path.join(root, "src/js/documents.js"), "utf8");
  assert.match(codeViewer, /applyScratchDocName[\s\S]*?javaPrepareDocumentFileRename\(ownerDoc, fname\)/);
  assert.match(codeViewer, /prepareWrite:[\s\S]*?javaPrepareDocumentFileRename\(ownerDoc, actualName, value\)/);
  assert.match(documents, /oldExt === "java"[\s\S]*?javaPrepareDocumentFileRename\(doc, name\)/);
  assert.match(documents, /moveOriginalFile\(ctx, name, javaReplacement\)/);
});

test("실행 결과 숨기기는 실행 바가 아니라 결과 칸 오른쪽 위에 있다", () => {
  // 파이썬 실행 화면과 같은 자리·같은 클래스를 쓴다 — CSS(.out-hide·.out-head-actions)를 새로 만들지 않는다.
  assert.match(editorSource, /outHideBtn\.className = "out-hide"/);
  assert.match(editorSource, /outHeadActions\.className = "out-head-actions out-chrome"/);
  assert.ok(!/hideOutBtn/.test(editorSource), "실행 바의 '결과 숨기기' 버튼은 남아 있으면 안 된다");
  // 결과 렌더러들이 outPanel.innerHTML 을 갈아끼워도 새 헤더에 다시 붙는다.
  assert.match(editorSource, /function attachJavaOutputFind\(options\)/);
  assert.match(editorSource, /const observer = new MutationObserver/);
  assert.match(editorSource, /observer\.observe\(outPanel, \{ childList:true, subtree:true \}\)/);
  assert.match(editorSource, /outputFinder\.destroy\(\)/);
});

test("Java 실행 환경과 공용 편집 도구는 Python과 같은 진입 방식을 쓴다", () => {
  assert.match(editorSource, /function openJavaEnvModal\(btn\)/);
  assert.match(editorSource, /modal\.className = "modal py-env-modal java-env-modal"/);
  assert.match(editorSource, /envBtn\.textContent = "Java Env"/);
  assert.match(editorSource, /openJavaEnvModal\(envBtn\)/);
  assert.doesNotMatch(editorSource, /envBtn\.addEventListener\("click", async/);
  assert.match(editorSource, /fontGroup\.className = "run-java-font-group"/);
  assert.match(editorSource, /practiceGroup\.className = "run-java-practice-group"/);
  assert.match(editorSource, /newJavaBtn\.className = "run-newjava"/);
  assert.match(editorSource, /outputFinder = attachJavaOutputFind/);
});

test("결과 칸은 편집기 옆 ↔ 아래로 옮길 수 있고 그 선택이 남는다", () => {
  assert.match(editorSource, /layoutBtn\.className = "run-layout"/);
  assert.match(editorSource, /split\.classList\.toggle\("stack-v", outputStacked\)/);
  assert.match(editorSource, /localStorage\.getItem\("javaSplitDir"\)/);
  assert.match(editorSource, /localStorage\.setItem\("javaSplitDir", outputStacked \? "col" : "row"\)/);
  // 세로 배치에서는 분할선도 가로로 잡아야 한다(attachRunSplitter 가 stack-v 를 보고 끌 축을 정한다).
  assert.match(editorSource, /divider\.setAttribute\("aria-orientation", outputStacked \? "horizontal" : "vertical"\)/);
  ["실행 결과 숨기기", "실행 결과를 편집기 오른쪽 옆으로", "실행 결과를 편집기 아래로"]
    .forEach((label) => assert.ok(i18nSource.includes(JSON.stringify(label)), `번역 키 누락: ${label}`));
});

// ── 자동완성 ───────────────────────────────────────────────────────────────

// vm 컨텍스트가 만든 배열은 프로토타입이 달라 deepEqual 이 어긋난다 — 이쪽 realm 배열로 옮겨 담는다.
const names = (items) => Array.from(items, (item) => item.name);

test("표준 클래스 이름이 단어 후보에 올라간다(키워드만으로는 String 도 안 나온다)", () => {
  const words = get("JAVA_TYPE_WORDS");
  // import 없이 바로 쓰는 java.lang 이름은 단어 후보로 올린다.
  ["String", "Math", "Integer", "StringBuilder", "Object", "Exception"]
    .forEach((word) => assert.ok(words.includes(word), `없는 이름: ${word}`));
  // import 가 필요한 이름은 여기 없다 — 있으면 import 후보와 겹쳐 같은 이름이 두 줄로 뜬다.
  const imports = get("JAVA_IMPORTS");
  ["List", "ArrayList", "Map", "HashMap", "Set", "Scanner"].forEach((word) => {
    assert.ok(!words.includes(word), `단어 후보에 남아 있다: ${word}`);
    assert.ok(imports[word], `import 후보에 없다: ${word}`);
  });
  // 편집기가 실제로 이 목록을 기본 후보에 얹는지 — 배선이 빠지면 자동완성은 그대로 키워드뿐이다.
  assert.match(editorSource, /JAVA_TYPE_WORDS/);
  assert.match(editorSource, /memberCandidates: \(source, receiver, prefix\) => javaMemberCompletionCandidates\(source, receiver, prefix, libraries\)/);
});

test("선언한 타입을 보고 점 뒤 후보를 고른다", () => {
  const members = get("javaMemberCompletionCandidates");
  const source = [
    "import java.util.*;",
    "public class Main {",
    "    public static void main(String[] args) {",
    "        Scanner sc = new Scanner(System.in);",
    "        List<String> names = new ArrayList<>();",
    "        Map<String, Integer> counts = new HashMap<>();",
    "        String line = sc.nextLine();",
    "        StringBuilder sb = new StringBuilder();",
    "        int[] scores = new int[10];",
    "    }",
    "}"
  ].join("\n");

  assert.ok(names(members(source, "sc", "")).includes("nextInt"));
  assert.ok(names(members(source, "names", "")).includes("add"));
  assert.ok(names(members(source, "counts", "")).includes("put"));
  assert.ok(names(members(source, "line", "")).includes("substring"));
  assert.ok(names(members(source, "sb", "")).includes("append"));
  // 배열은 메서드가 없고 length 필드뿐 — size()/length() 오타를 막는 자리다.
  assert.deepEqual(names(members(source, "scores", "")), ["length"]);
  assert.equal(members(source, "scores", "")[0].type, "property");
  // 선언한 적 없는 이름은 후보를 내지 않는다(버퍼 단어 완성으로 넘어간다).
  assert.equal(members(source, "nobody", "").length, 0);
});

test("클래스 이름으로 부르는 정적 멤버도 나온다", () => {
  const members = get("javaMemberCompletionCandidates");
  assert.ok(names(members("", "Math", "")).includes("random"));
  assert.ok(names(members("", "Integer", "")).includes("parseInt"));
  assert.ok(names(members("", "Arrays", "")).includes("sort"));
  // System. 다음은 out·err 부터. 편집기는 점 바로 앞 낱말만 주므로 out 도 그대로 알아본다.
  assert.equal(names(members("", "System", ""))[0], "out");
  assert.ok(names(members("", "out", "")).includes("println"));
});

test("친 글자로 후보를 걸러내고, 메서드는 괄호가 붙도록 표시한다", () => {
  const members = get("javaMemberCompletionCandidates");
  const source = "List<String> names = new ArrayList<>();";
  const picked = members(source, "names", "add");
  assert.deepEqual(names(picked), ["add", "addAll"]);
  assert.equal(picked[0].type, "function");
  assert.equal(picked[0].signature, "add(item)");
  // 이미 다 친 필드는 목록에서 뺀다(메서드는 () 편의를 위해 남긴다).
  assert.deepEqual(names(members("", "Math", "PI")), []);
});

test("같은 이름을 다시 선언하면 마지막 선언을 따르고, 타입이 아닌 낱말에는 속지 않는다", () => {
  const declared = get("javaDeclaredType");
  assert.equal(declared("String value = \"a\";\nScanner value = new Scanner(System.in);", "value").type, "Scanner");
  // return·new 처럼 앞에 오는 낱말을 타입으로 오해하면 엉뚱한 후보가 나온다.
  assert.equal(declared("return total;", "total"), null);
  // var 는 오른쪽을 봐야 안다.
  assert.equal(declared("var sc = new Scanner(System.in);", "sc").type, "Scanner");
  assert.equal(declared("var name = \"홍길동\";", "name").type, "String");
  assert.equal(declared("var mystery = compute();", "mystery"), null);
  // for-each 와 메서드 매개변수의 선언도 읽는다.
  assert.equal(declared("for (String word : words) {", "word").type, "String");
  assert.equal(declared("static void greet(String name) {", "name").type, "String");
});

test("고른 라이브러리의 클래스는 점 뒤 멤버까지 나온다", () => {
  const members = get("javaMemberCompletionCandidates");
  const source = [
    "import com.google.gson.Gson;",
    "public class Main {",
    "    public static void main(String[] args) {",
    "        Gson gson = new Gson();",
    "    }",
    "}"
  ].join("\n");
  const picked = names(members(source, "gson", "", { words:["Gson", "GsonBuilder", "JsonObject"] }));
  assert.ok(picked.includes("toJson"), "변수로 쓴 라이브러리 클래스도 선언 타입으로 찾는다");
  assert.ok(picked.includes("fromJson"));
  // 클래스 이름으로 바로 부르는 것(정적)도 같은 길에서 답한다.
  assert.ok(names(members("", "Jsoup", "", { words:["Jsoup", "Document"] })).includes("connect"));
  assert.ok(names(members("", "StringUtils", "", { words:["StringUtils"] })).includes("isBlank"));
  assert.ok(names(members("", "Assertions", "", { words:["Assertions"] })).includes("assertEquals"));
});

test("고르지 않은 라이브러리의 멤버는 제안하지 않는다", () => {
  const members = get("javaMemberCompletionCandidates");
  // 목록에 없으면 = 실행에 안 들어간다. 컴파일되지 않을 코드를 권하면 안 된다.
  assert.equal(members("Gson gson = new Gson();", "gson", "", { words:[] }).length, 0);
  assert.equal(members("", "Jsoup", "", { words:["StringUtils"] }).length, 0);
  // 라이브러리 정보를 아예 넘기지 않아도(브라우저 편집 등) 조용히 비운다.
  assert.equal(members("", "Jsoup", "").length, 0);
});

test("라이브러리 멤버도 표준 라이브러리와 같은 모양으로 답한다", () => {
  const members = get("javaMemberCompletionCandidates");
  const picked = members("", "StringUtils", "isB", { words:["StringUtils"] });
  assert.deepEqual(names(picked), ["isBlank"]);
  assert.equal(picked[0].type, "function");
  assert.equal(picked[0].signature, "isBlank(cs)");
  // 상수는 필드로 — CSVFormat.DEFAULT 뒤에 괄호가 붙으면 안 된다.
  const constants = members("", "CSVFormat", "DEF", { words:["CSVFormat"] });
  assert.deepEqual(names(constants), ["DEFAULT"]);
  assert.equal(constants[0].type, "property");
});

test("표준 라이브러리 이름이 라이브러리 표에 가려지지 않는다", () => {
  const members = get("javaMemberCompletionCandidates");
  // jsoup 을 골랐어도 String 변수는 String 멤버가 나와야 한다(표준이 먼저다).
  const picked = names(members("String line = \"a\";", "line", "", { words:["Document", "Element"] }));
  assert.ok(picked.includes("substring"));
  assert.ok(!picked.includes("select"));
});

test("직접 받은 jar 는 서버가 뽑아 온 멤버 표를 쓴다", () => {
  const members = get("javaMemberCompletionCandidates");
  // 서버가 주는 모양: 메서드는 이름 뒤에 (), 필드는 이름만. 인자 이름은 클래스 파일에 없어 못 싣는다.
  const libraries = { words:[], members:{ FileUtils:"readFileToString() writeStringToFile() copyFile() EMPTY_FILE_ARRAY" } };
  const picked = members("FileUtils utils = null;", "utils", "", libraries);
  assert.deepEqual(names(picked), ["readFileToString", "writeStringToFile", "copyFile", "EMPTY_FILE_ARRAY"]);
  assert.equal(picked[0].type, "function");
  assert.equal(picked[0].signature, "readFileToString()");
  assert.equal(picked[3].type, "property");     // 상수는 괄호가 붙으면 안 된다
  // 클래스 이름으로 바로 부르는 것도 같은 표에서 답한다.
  assert.ok(names(members("", "FileUtils", "", libraries)).includes("copyFile"));
  // 친 글자로 거르는 규칙은 표준 라이브러리와 같다.
  assert.deepEqual(names(members("", "FileUtils", "write", libraries)), ["writeStringToFile"]);
});

test("손으로 적어 둔 표가 뽑아 온 표보다 먼저다", () => {
  const members = get("javaMemberCompletionCandidates");
  // 같은 클래스가 양쪽에 있으면 인자 안내가 있는 쪽(기본 목록)을 쓴다.
  const libraries = { words:["Jsoup"], members:{ Jsoup:"onlyFromJar()" } };
  const picked = names(members("", "Jsoup", "", libraries));
  assert.ok(picked.includes("connect"));
  assert.ok(!picked.includes("onlyFromJar"));
});

test("라이브러리 정보가 없거나 모양이 깨져도 조용히 넘어간다", () => {
  const members = get("javaMemberCompletionCandidates");
  assert.equal(members("", "FileUtils", "").length, 0);
  assert.equal(members("", "FileUtils", "", null).length, 0);
  assert.equal(members("", "FileUtils", "", { words:null, members:null }).length, 0);
  assert.equal(members("", "FileUtils", "", { members:{ FileUtils:123 } }).length, 0);
});

// ── 자동완성이 import 까지 ─────────────────────────────────────────────────

test("친 글자로 import 후보를 내고, 이미 적어 둔 것은 빼놓는다", () => {
  const candidates = get("javaImportCandidates");
  const rows = candidates("public class Main {}", "Lis", null);
  assert.deepEqual(names(rows), ["List"]);
  assert.equal(rows[0].importText, "import java.util.List;");
  // 이미 적혀 있으면 후보에서 뺀다 — 그때부터는 버퍼에 이름이 있어 평범한 단어 완성으로 나온다.
  assert.equal(candidates("import java.util.List;\npublic class Main {}", "Lis", null).length, 0);
  // 패키지를 * 로 받아 왔어도 다시 적지 않는다.
  assert.equal(candidates("import java.util.*;\npublic class Main {}", "Arr", null).length, 0);
  // 아무 글자도 치지 않았으면 목록 전체를 쏟지 않는다.
  assert.equal(candidates("", "", null).length, 0);
});

test("라이브러리 클래스는 그 라이브러리를 골랐을 때만 import 후보가 된다", () => {
  const candidates = get("javaImportCandidates");
  assert.equal(candidates("", "Gso", null).length, 0);
  const picked = candidates("", "Gso", { words:["Gson", "GsonBuilder"] });
  assert.deepEqual(names(picked), ["Gson", "GsonBuilder"]);
  assert.equal(picked[0].importText, "import com.google.gson.Gson;");
});

test("직접 받은 jar 클래스도 패키지 전체 이름으로 import 후보가 된다", () => {
  const candidates = get("javaImportCandidates");
  // 패키지 전체 이름은 jar 목록에서 곧바로 오므로, 느린 javap 멤버 추출을 기다리지 않아도 된다.
  const libraries = { words:[], classes:[
    "org.apache.commons.io.FileUtils",
    "org.apache.commons.io.IOUtils"
  ], members:{} };
  const rows = candidates("public class Main {}", "FileU", libraries);
  assert.deepEqual(names(rows), ["FileUtils"]);
  assert.equal(rows[0].importText, "import org.apache.commons.io.FileUtils;");

  assert.equal(candidates("import org.apache.commons.io.FileUtils;\nclass Main {}", "FileU", libraries).length, 0);
  assert.equal(candidates("import org.apache.commons.io.*;\nclass Main {}", "FileU", libraries).length, 0);
  assert.equal(candidates("package org.apache.commons.io;\nclass Main {}", "FileU", libraries).length, 0);
});

test("직접 받은 jar 의 동명 클래스는 import 문이 다른 후보로 모두 보여 준다", () => {
  const candidates = get("javaImportCandidates");
  const libraries = { words:[], classes:[
    "alpha.model.Document",
    "beta.model.Document"
  ], members:{} };
  const rows = candidates("class Main {}", "Doc", libraries);
  assert.deepEqual(Array.from(rows, (row) => row.importText), [
    "import alpha.model.Document;",
    "import beta.model.Document;"
  ]);
});

test("import 는 package 아래·기존 import 다음·클래스 위에 들어간다", () => {
  const offsetOf = get("javaImportInsertOffset");
  const at = (source) => source.slice(0, offsetOf(source)) + "<<>>" + source.slice(offsetOf(source));

  // 아무것도 없으면 첫 코드 줄 앞
  assert.equal(at("public class Main {\n}\n"), "<<>>public class Main {\n}\n");
  // package 가 있으면 그 다음 줄
  assert.equal(at("package school;\n\npublic class Main {\n}\n"),
    "package school;\n<<>>\npublic class Main {\n}\n");
  // 이미 import 가 있으면 마지막 것 다음 줄
  assert.equal(at("package school;\n\nimport java.util.List;\nimport java.util.Map;\n\npublic class Main {\n}\n"),
    "package school;\n\nimport java.util.List;\nimport java.util.Map;\n<<>>\npublic class Main {\n}\n");
  // 맨 위 주석은 건너뛴다(저작권 머리글이 흔하다)
  assert.equal(at("// 3학년 2반 홍길동\npublic class Main {\n}\n"),
    "// 3학년 2반 홍길동\n<<>>public class Main {\n}\n");
  assert.equal(at("/*\n * 과제 1\n */\npublic class Main {\n}\n"),
    "/*\n * 과제 1\n */\n<<>>public class Main {\n}\n");
});

test("이미 적혀 있는 import 인지 가린다", () => {
  const has = get("javaHasImport");
  assert.ok(has("import java.util.List;", "import java.util.List;"));
  assert.ok(has("import  java.util.List ;", "import java.util.List;"));      // 띄어쓰기가 달라도 같은 것
  assert.ok(has("import java.util.*;", "import java.util.List;"));           // 패키지를 통째로 받아 왔다
  assert.ok(!has("import java.util.*;", "import java.io.File;"));            // 다른 패키지는 아니다
  assert.ok(!has("import java.util.stream.*;", "import java.util.List;"));   // 하위 패키지 * 는 상위를 덮지 않는다
  assert.ok(!has("// import java.util.List;", "import java.util.List;"));    // 주석 처리한 것은 없는 것
  assert.ok(!has("public class Main {}", "import java.util.List;"));
});


test("직접 받은 jar 멤버는 static 과 instance 를 수신자에 맞춰 가른다", () => {
  const members = get("javaMemberCompletionCandidates");
  const libraries = { words:[], members:{
    "org.apache.commons.io.FileUtils":"S:readFileToString() S:copyFile() S:EMPTY_FILE_ARRAY I:toString()"
  } };
  const java = "import org.apache.commons.io.FileUtils;\nFileUtils utils = null;";
  const instance = members(java, "utils", "", libraries);
  assert.deepEqual(names(instance), ["toString"]);
  const statics = members(java, "FileUtils", "", libraries);
  assert.deepEqual(names(statics), ["readFileToString", "copyFile", "EMPTY_FILE_ARRAY"]);
  assert.equal(statics[2].type, "property");
});

test("직접 받은 jar 의 동명 클래스는 현재 import 로 가른다", () => {
  const members = get("javaMemberCompletionCandidates");
  const libraries = { words:[], members:{
    "alpha.model.Document":"I:alphaOnly()",
    "beta.model.Document":"I:betaOnly()"
  } };
  const alpha = "import alpha.model.Document;\nDocument doc = null;";
  assert.deepEqual(names(members(alpha, "doc", "", libraries)), ["alphaOnly"]);
  const beta = "import beta.model.*;\nDocument doc = null;";
  assert.deepEqual(names(members(beta, "doc", "", libraries)), ["betaOnly"]);
  assert.deepEqual(names(members("Document doc = null;", "doc", "", libraries)), []);
  assert.deepEqual(names(members("alpha.model.Document doc = null;", "doc", "", libraries)), ["alphaOnly"]);
});


test("javac 진단을 줄·칸·심각도·힌트로 나눈다", () => {
  const javacDiagnostics = get("javacDiagnostics");
  const stderr = [
    "C:\Users\me\AppData\Local\Temp\moidajava_session_abc123\Main.java:3: error: incompatible types: int cannot be converted to String",
    "        String s = 3;",
    "                   ^",
    "C:\Users\me\AppData\Local\Temp\moidajava_session_abc123\Main.java:4: error: cannot find symbol",
    "        undefinedCall();",
    "        ^",
    "  symbol:   method undefinedCall()",
    "  location: class Main",
    "2 errors"
  ].join("\n");
  const items = javacDiagnostics(stderr);
  assert.equal(items.length, 2);
  assert.equal(items[0].line, 3);
  assert.equal(items[0].severity, "error");
  assert.equal(items[0].column, 19);
  assert.equal(items[0].message, "incompatible types: int cannot be converted to String");
  assert.equal(items[0].hint, "");
  assert.equal(items[1].line, 4);
  assert.equal(items[1].hint, "symbol:   method undefinedCall() · location: class Main");
});

test("경고·참고는 오류와 다른 심각도로 나오고 개수 요약은 목록에 들어가지 않는다", () => {
  const javacDiagnostics = get("javacDiagnostics");
  const stderr = [
    "Main.java:5: warning: [deprecation] Thread.stop() is deprecated",
    "        t.stop();",
    "         ^",
    "1 warning"
  ].join("\n");
  const items = javacDiagnostics(stderr);
  assert.equal(items.length, 1);
  assert.equal(items[0].severity, "warning");
  assert.equal(items[0].line, 5);
});

test("컴파일이 성공하면 뽑을 진단이 없다", () => {
  const javacDiagnostics = get("javacDiagnostics");
  // vm 컨텍스트가 만든 배열이라 deepEqual([]) 은 realm 이 달라 실패한다 — 길이로 본다.
  assert.equal(javacDiagnostics("").length, 0);
  assert.equal(javacDiagnostics("Note: Main.java uses unchecked or unsafe operations.").length, 0);
});

test("저장 검사는 실행과 같은 컴파일 경로를 쓰고 세션을 남기지 않는다", () => {
  assert.match(launcher, /path\.StartsWith\("\/java-check", StringComparison\.Ordinal\)/);
  const start = launcher.indexOf("static string RunJavaCheck");
  assert.ok(start > 0, "RunJavaCheck 가 있어야 한다");
  const body = launcher.slice(start, launcher.indexOf("/* piped=false", start));
  assert.match(body, /CompileJavaSource\(javac, scriptPath, tempRoot, probe/);
  // 검사 세션은 JavaSessions 에 등록하지 않는다 — 폴링·중지 대상이 되면 실행 세션과 섞인다.
  assert.ok(!/JavaSessions\[/.test(body), "검사는 세션 목록에 등록하지 않는다");
  assert.match(body, /Directory\.Delete\(tempRoot, true\)/);
});

test("자동 저장 컴파일 검사는 별도 설정에 따르고 수동 저장 검사는 항상 실행한다", () => {
  assert.match(stateSource, /javaCheckOnAutoSave:\s*false/);
  assert.match(htmlSource, /id="settingJavaCheckOnAutoSave"/);
  assert.match(appSource, /settingJavaCheckOnAutoSave"\)\.checked = appSettings\.javaCheckOnAutoSave === true/);
  assert.match(appSource, /javaCheckOnAutoSave: byId\("settingJavaCheckOnAutoSave"\)\.checked/);
  assert.match(editorSource, /requestSaveCheck\(writtenValue\);/);
  const autosave = editorSource.slice(editorSource.indexOf("const runAutosave = async"),
    editorSource.indexOf("const scheduleAutosave"));
  assert.match(autosave, /appSettings\.javaCheckOnAutoSave === true/);
  assert.match(autosave, /requestSaveCheck\(value, \{ reveal:false \}\)/);
  assert.match(manualSource, /Java 자동 저장 후 컴파일 검사/);
  assert.match(i18nSource, /"Java 자동 저장 후 컴파일 검사"/);
  // 오류 여러 개를 설명까지 살려 넘기는 통로
  assert.match(editorSource, /setDiagnosticItems: \(items\) => editor\.setDiagnosticItems\(items\)/);
  assert.match(editorSource, /focusLine: \(line\) => editor\.focusLine\(line\)/);
});

test("자동 컴파일은 겹치지 않고 오래된 결과를 버리며 결과 창을 강제로 열지 않는다", () => {
  assert.match(editorSource, /checkBusy = false, pendingCheck = null/);
  assert.match(editorSource, /while \(!disposed && pendingCheck\)/);
  assert.match(editorSource, /pendingCheck = request/);
  assert.match(editorSource, /isCurrent:\(\) => [^\n]*seq === checkSeq[^\n]*editor\.getValue\(\) === value/);
  assert.match(editorSource, /checkSeq\+\+;\s*\/\/ 진행 중 검사는/);
  assert.match(runtimeSource, /typeof options\.isCurrent === "function" && !options\.isCurrent\(\)/);
  assert.match(runtimeSource, /ui\.split && options\.reveal !== false/);
});

test("형제 파일의 진단은 편집기 줄 표시에서 빠지고 목록에는 파일 이름과 함께 남는다", () => {
  const javacDiagnostics = get("javacDiagnostics");
  const stderr = [
    "C:\\Users\\me\\AppData\\Local\\Temp\\moidajava_session_abc\\Dog.java:2: error: incompatible types: String cannot be converted to int",
    "    void bark() { int x = \"no\"; }",
    "                          ^",
    "C:\\Users\\me\\AppData\\Local\\Temp\\moidajava_session_abc\\Main.java:9: error: cannot find symbol",
    "        oops();",
    "        ^",
    "2 errors"
  ].join("\n");
  const items = javacDiagnostics(stderr, "Main.java");
  assert.equal(items.length, 2);
  // 지금 편집 중인 파일이 먼저 온다.
  assert.equal(items[0].file, "Main.java");
  assert.equal(items[0].own, true);
  assert.equal(items[1].file, "Dog.java");
  assert.equal(items[1].own, false);
  assert.equal(items[1].line, 2);
  // 파일 이름을 안 주면 전부 내 파일로 본다(형제를 안 보내는 예전 동작).
  assert.equal(javacDiagnostics(stderr).filter(item => item.own).length, 2);
});

test("형제 .java 는 실행·채점·저장 검사 세 길에 같은 목록으로 들어간다", () => {
  // 실행 봉투 뒤에 [개수]([길이][소스])* 를 잇는다. 형제가 없으면 바이트가 예전과 같아야 한다.
  assert.match(runtimeSource, /function buildJavaRunPayload\(source, stdinText, extras\)/);
  assert.match(runtimeSource, /if \(!rows\.length\) return base;/);
  assert.match(runtimeSource, /body:buildJavaRunPayload\(source, "", options\.extras\)/);
  // 실행·채점은 runJavaSource 가 한 번 모은 목록을 나눠 쓴다.
  assert.match(runtimeSource, /extras = \(await ui\.siblingSources\(\)\) \|\| \[\]/);
  assert.match(runtimeSource, /runJavaGrading\(source, gradeTests, \{[\s\S]{0,120}libs, extras,/);
  assert.match(runtimeSource, /runJavaInteractive\(source, ui, \{[\s\S]{0,160}libs, extras/);
  // 같은 폴더·같은 폴더문맥의 .java 만 모은다.
  assert.match(editorSource, /if \(!\/\\\.java\$\/i\.test\(path\) \|\| javaDocDir\(path\) !== dir\) continue;/);
  assert.match(editorSource, /if \(\(doc\.archiveCtx \|\| null\) !== context\) continue;/);
});

test("런처는 형제 소스를 package 경로에 풀고 -sourcepath 로 찾게 한다", () => {
  assert.match(launcher, /static void WriteJavaExtraSources\(string tempRoot, List<string> extras\)/);
  // 클래스 이름은 그 파일이 실제로 선언한 타입에서만 얻는다(JavaMainClassName 은 "Main" 으로 떨어진다).
  assert.match(launcher, /static string JavaDeclaredFileClassName\(string source\)/);
  const start = launcher.indexOf("static void WriteJavaExtraSources");
  const body = launcher.slice(start, launcher.indexOf("static string JavaDeclaredFileClassName", start));
  assert.match(body, /JavaDeclaredFileClassName\(extra\)/);
  assert.match(body, /JavaIdentifierRe\.IsMatch\(part\)/);       // 경로 구분자·.. 가 섞인 package 는 버린다
  assert.match(body, /if \(File\.Exists\(path\)\) continue;/);   // 주 파일을 형제가 덮어쓰지 못한다
  assert.match(launcher, /-sourcepath \\"" \+ tempRoot/);
  // 실행·검사 두 길 모두에서 형제를 푼다.
  assert.equal((launcher.match(/WriteJavaExtraSources\(tempRoot, extraSources\)/g) || []).length, 2);
  // 개수·크기 상한이 있어야 거대한 폴더가 그대로 들어오지 않는다.
  assert.match(launcher, /count > JavaExtraSourceMax/);
  assert.match(launcher, /len > JavaExtraSourceBytes/);
});
