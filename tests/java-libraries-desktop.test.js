"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const launcher = fs.readFileSync(path.join(root, "desktop", "launcher.cs"), "utf8");

test("자바 라이브러리 카탈로그는 서버가 갖고, 단일 jar 로 끝나는 것만 올린다", () => {
  for (const id of ["\"gson\"", "\"commons-lang3\"", "\"commons-csv\"", "\"jsoup\"", "\"junit\""]) {
    assert.ok(launcher.includes("Id = " + id), id);
  }
  // JUnit 은 의존성이 딸리지 않는 console-standalone(모든 것을 담은 한 개 jar)이어야 한다.
  assert.match(launcher, /Artifact = "junit-platform-console-standalone"/);
});

test("실행 요청의 libs 는 id·좌표만 받고 경로는 서버가 조립한다", () => {
  assert.match(launcher, /QueryValue\(path, "libs"\)/);
  assert.match(launcher, /StartJavaSession\(byte\[\] body, bool piped, string libs\)/);
  assert.match(launcher, /ResolveJavaLibraryJars\(libs, out missingLibraries\)/);
});

test("좌표는 폴더 이름이 되므로 .. 와 캐시 루트 밖을 막는다", () => {
  assert.match(launcher, /value\.IndexOf\("\.\.", StringComparison\.Ordinal\) >= 0\) return false/);
  // JavaLibraryFileUnder: 조립 결과가 루트 안인지 다시 확인한다(읽기·쓰기·삭제가 모두 이 함수를 지난다).
  assert.match(launcher, /full\.StartsWith\(rootFull, StringComparison\.OrdinalIgnoreCase\)\) return null/);
});

test("클래스패스는 컴파일과 실행 양쪽에 같은 값으로 들어간다", () => {
  // javac: -cp 가 없으면 라이브러리를 쓰는 import 부터 컴파일이 실패한다.
  assert.match(launcher, /CompileJavaSource\(string javac, string scriptPath, string tempRoot, JavaSession session,\s*\n\s*string classPath\)/);
  assert.match(launcher, /-encoding UTF-8 -cp \\"" \+ classPath/);
  // java: 임시 폴더만 주던 자리를 classPath 로 바꿨는지.
  assert.match(launcher, /-Dstderr\.encoding=UTF-8 -cp \\""\s*\n\s*\+ classPath/);
  assert.ok(!launcher.includes('+ tempRoot + "\\" " + qualifiedClassName'),
    "실행 인자가 임시 폴더만 주던 예전 모양으로 되돌아갔다");
  assert.ok(!launcher.includes('-encoding UTF-8 -d \\"'),
    "컴파일 인자가 classpath 없이 -d 만 주던 예전 모양으로 되돌아갔다");
});

test("캐시 전체를 얹는 와일드카드 대신 고른 jar 만 붙인다", () => {
  assert.ok(!launcher.includes("\\\\*\";"), "dir\\* 와일드카드는 버전 충돌을 만든다");
  assert.match(launcher, /sb\.Append\(';'\)\.Append\(jar\)/);
});

test("못 찾은 라이브러리는 조용히 빼지 않고 출력 칸에 알린다", () => {
  assert.match(launcher, /missingLibraries\.Count > 0/);
  assert.match(launcher, /StartJavaMessageSession\("\[라이브러리를 찾지 못했습니다/);
});

test("조회 위치는 exe 옆·LocalAppData·배포 동봉 vendor 세 곳이다", () => {
  assert.match(launcher, /JavaLibraryPortableRoot\(\), JavaLibraryLocalAppDataRoot\(\), JavaLibraryVendorRoot\(\)/);
  assert.match(launcher, /Path\.Combine\(AppDomain\.CurrentDomain\.BaseDirectory, "vendor", "java-libs"\)/);
  // 클래스패스 구분자가 든 경로는 인자를 통째로 어긋나게 하므로 조회 대상에서 뺀다.
  assert.match(launcher, /root\.IndexOf\(';'\) >= 0 \|\| root\.IndexOf\('"'\) >= 0\) continue/);
});

test("설치·목록·삭제 API 는 로컬 토큰과 확인 헤더 뒤에 둔다", () => {
  for (const route of [
    "/java-lib-catalog", "/java-lib-list", "/java-lib-install-start",
    "/java-lib-install-poll", "/java-lib-install-cancel", "/java-lib-delete"
  ]) assert.ok(launcher.includes(route), route);
  assert.match(launcher, /x-classdock-javalib-confirm/);
  // POST 는 "/java-" 규칙이 잡지만 읽기 경로는 따로 적어야 한다.
  assert.match(launcher, /if \(path\.StartsWith\("\/java-lib-", StringComparison\.Ordinal\)\) return true;/);
});

test("내려받을 주소는 서버가 검증된 좌표로만 조립한다", () => {
  assert.match(launcher, /JavaLibraryRepository = "https:\/\/repo1\.maven\.org\/maven2\/"/);
  assert.match(launcher, /JavaLibraryRepository \+ target\.Relative\.Replace\('\\\\', '\/'\)/);
  // 프런트가 준 주소를 쓰는 길이 없어야 한다.
  assert.ok(!/WebRequest\.Create\((?:url|link)Value/.test(launcher));
});

test("검증하지 못한 파일은 설치하지 않는다", () => {
  // 카탈로그에 박아 둔 SHA-256 이 있으면 그것과, 없으면 배포처의 .sha1 과 대조한다.
  assert.match(launcher, /string\.Equals\(actual, target\.Sha256, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(launcher, /string\.Equals\(Sha1File\(file\), expected, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(launcher, /if \(string\.IsNullOrEmpty\(expected\)\) throw new Exception\("배포처에서 검증값을/);
  // 검증 전에는 .part 로만 존재한다.
  assert.match(launcher, /temp = dest \+ "\.part-"/);
  assert.match(launcher, /VerifyJavaLibrary\(job, target, temp\);[\s\S]{0,120}File\.Move\(temp, dest\)/);
});

test("배포본에 담아 보낸 jar 는 받지도 지우지도 않는다", () => {
  // 인터넷이 막힌 교실에서는 vendor\java-libs 에 담아 보내는 것으로 끝난다 — 조회 루트라 설치할 것이 없고,
  // 설치를 눌러도 '이미 있음'으로 돌아간다. 그래서 내려받기 경로에는 배포본을 복사하는 가지가 없다.
  assert.match(launcher, /FindJavaLibraryFile\(target\.Relative\) != null\) throw new InvalidOperationException\("java-lib-exists"\)/);
  assert.ok(!launcher.includes("File.Copy(bundled"), "배포본 복사 분기는 도달할 수 없는 코드다");
  // 삭제는 캐시 두 곳만 훑는다(vendor 는 목록에 없다).
  assert.match(launcher, /roots = new string\[\] \{ JavaLibraryPortableRoot\(\), JavaLibraryLocalAppDataRoot\(\) \};[\s\S]{0,400}File\.Delete\(file\);/);
  assert.match(launcher, /IsBundledJavaLibrary\(target\.Relative\) \? "java-lib-bundled" : "java-lib-not-found"/);
});

test("한 번에 하나만, 크기와 개수에 상한을 둔다", () => {
  assert.match(launcher, /JavaLibraryMaxJarBytes = 30L \* 1024 \* 1024/);
  assert.match(launcher, /JavaLibraryMaxInstalled = 20/);
  assert.match(launcher, /if \(!active\.Complete\) throw new InvalidOperationException\("java-lib-busy"\)/);
  // 길이를 알려 주지 않는 응답도 있어 받는 도중에도 상한을 본다.
  assert.match(launcher, /if \(received > JavaLibraryMaxJarBytes\)/);
});

test("카탈로그의 모든 항목은 대조할 SHA-256 을 갖고 있다", () => {
  // 값이 비면 배포처가 준 .sha1(손상 검출)까지만 확인된다 — 새 항목을 넣을 때 빠뜨리지 않도록 여기서 잡는다.
  const catalog = launcher.slice(
    launcher.indexOf("JavaLibraryCatalog = new JavaLibrary"),
    launcher.indexOf("static JavaLibrary FindJavaLibraryCatalogItem"));
  const ids = catalog.match(/Id = "[a-z0-9-]+"/g) || [];
  const hashes = catalog.match(/Sha256 = "[0-9a-f]{64}"/g) || [];
  assert.equal(hashes.length, ids.length, "항목 수와 검증값 수가 같아야 한다");
  assert.ok(!catalog.includes('Sha256 = ""'), "검증값이 빈 항목이 남아 있다");
});
