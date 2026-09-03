"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const libraries = require(path.join(root, "src/js/java-libraries.js"));
const editorSource = fs.readFileSync(path.join(root, "src/js/java-editor.js"), "utf8");
const runtimeSource = fs.readFileSync(path.join(root, "src/js/java-runtime.js"), "utf8");

test("보낼 수 있는 이름은 카탈로그 id 또는 좌표뿐이다", () => {
  assert.ok(libraries.javaLibraryValidSpec("gson"));
  assert.ok(libraries.javaLibraryValidSpec("commons-lang3"));
  assert.ok(libraries.javaLibraryValidSpec("com.google.code.gson:gson:2.11.0"));
  // 폴더를 거슬러 오르거나 클래스패스를 끊는 글자는 서버에 보내기 전에 막는다.
  assert.ok(!libraries.javaLibraryValidSpec("../evil"));
  assert.ok(!libraries.javaLibraryValidSpec("com..evil:gson:1.0"));
  assert.ok(!libraries.javaLibraryValidSpec("com:gson:1.0;evil"));
  assert.ok(!libraries.javaLibraryValidSpec("com/google:gson:1.0"));
  assert.ok(!libraries.javaLibraryValidSpec("org.example:mylib"));
  assert.ok(!libraries.javaLibraryValidSpec(""));
});

test("저장된 선택이 깨져 있어도 실행이 막히지 않는다", () => {
  const state = libraries.javaLibraryState({ ids:["gson", "gson", "../evil", "", null, "BAD/ID", "jsoup"] });
  assert.deepEqual(state.ids, ["gson", "jsoup"]);   // 중복·잘못된 값은 버린다
  assert.deepEqual(libraries.javaLibraryState(null).ids, []);
  assert.deepEqual(libraries.javaLibraryState("망가진 값").ids, []);
  const many = Array.from({ length: 40 }, (_, i) => "lib" + i);
  assert.equal(libraries.javaLibraryState({ ids:many }).ids.length, libraries.JAVA_LIBRARY_MAX_SELECTED);
});

test("실행 요청에는 고른 이름만 쉼표로 붙인다", () => {
  assert.equal(libraries.javaLibraryQuery({ ids:["gson", "commons-csv"] }), "gson,commons-csv");
  assert.equal(libraries.javaLibraryQuery(null), "");
  assert.equal(libraries.javaLibrarySelectionSignature({ ids:["gson"] }), "gson");
});

test("선택 저장 자리는 문서별이고 채점 테스트와 섞이지 않는다", () => {
  const key = libraries.javaLibraryStorageKey("classdock-py-draft:folder/Main.java");
  assert.equal(key, libraries.JAVA_LIBRARY_STORAGE_PREFIX + "folder/Main.java");
  assert.ok(key.startsWith("classdock-java-libraries:"));
});

test("고른 라이브러리의 클래스 이름만 자동완성에 얹는다", () => {
  const rows = [
    { id:"gson", spec:"gson", coordinate:"com.google.code.gson:gson:2.11.0", words:"Gson JsonObject" },
    { id:"jsoup", spec:"jsoup", coordinate:"org.jsoup:jsoup:1.18.3", words:"Jsoup Document" },
    { id:"", spec:"org.example:mylib:1.0", coordinate:"org.example:mylib:1.0", words:"" }
  ];
  assert.deepEqual(libraries.javaLibraryCompletionWords({ ids:["gson"] }, rows), ["Gson", "JsonObject"]);
  assert.deepEqual(libraries.javaLibraryCompletionWords({ ids:[] }, rows), []);
  // 좌표로 고른 것도 같은 줄을 가리킨다.
  assert.deepEqual(
    libraries.javaLibraryCompletionWords({ ids:["org.jsoup:jsoup:1.18.3"] }, rows), ["Jsoup", "Document"]);
});

test("런처가 돌려준 오류 코드는 사람이 읽는 말로 바꾼다", () => {
  assert.match(libraries.javaLibraryErrorText("javalib-failed: java-lib-exists"), /이미 이 컴퓨터에/);
  assert.match(libraries.javaLibraryErrorText("java-lib-bundled"), /함께 담겨 온/);
  assert.equal(libraries.javaLibraryErrorText(""), "라이브러리 작업에 실패했어요.");
});

test("실행·채점 모두 같은 라이브러리 목록으로 돈다", () => {
  // 실행 바의 선택이 두 경로에 모두 들어가야 편집기에서만 되는 코드가 생기지 않는다.
  assert.match(editorSource, /libs: libraryPicker\.getQuery\(\)/);
  assert.match(editorSource, /gradeTests:tests, libs:libraryPicker\.getQuery\(\)/);
  assert.match(runtimeSource, /runJavaGrading\(source, gradeTests, \{[\s\S]{0,120}libs,/);
  assert.match(runtimeSource, /startJavaSession\(source, stdinText, true, options\.libs, options\.extras\)/);
  assert.match(runtimeSource, /startJavaSession\(source, "", false, hooks\.libs, hooks\.extras\)/);
});

test("라이브러리 이름은 쿼리로만 보내고 경로는 만들지 않는다", () => {
  assert.match(runtimeSource, /query\.push\("libs=" \+ encodeURIComponent\(String\(libs\)\)\)/);
  assert.ok(!/java-lib-catalog|repo1\.maven\.org/.test(runtimeSource), "실행기는 카탈로그·저장소를 알 필요가 없다");
});

test("직접 받은 jar 의 클래스 이름도 자동완성 단어에 올라간다", () => {
  // 카탈로그 행은 id 가 있고, 직접 좌표로 받은 행은 id 가 빈 문자열이다(서버가 그렇게 싣는다).
  const rows = [
    { id:"jsoup", spec:"jsoup", coordinate:"org.jsoup:jsoup:1.18.3", words:"Jsoup Document Element Elements" },
    { id:"", spec:"commons-io:commons-io:2.16.1", coordinate:"commons-io:commons-io:2.16.1",
      words:"FileUtils IOUtils FilenameUtils" }
  ];
  const words = libraries.javaLibraryCompletionWords({ ids:["commons-io:commons-io:2.16.1"] }, rows);
  assert.deepEqual(words, ["FileUtils", "IOUtils", "FilenameUtils"]);
  // 고르지 않은 것은 여전히 빠진다.
  assert.deepEqual(libraries.javaLibraryCompletionWords({ ids:[] }, rows), []);
});

test("직접 받은 jar 의 패키지 전체 클래스 이름은 선택한 항목에서만 가져온다", () => {
  const rows = [{
    id:"", spec:"commons-io:commons-io:2.16.1", coordinate:"commons-io:commons-io:2.16.1",
    classes:"org.apache.commons.io.FileUtils org.apache.commons.io.IOUtils"
  }];
  assert.deepEqual(libraries.javaLibraryCompletionClasses(
    { ids:["commons-io:commons-io:2.16.1"] }, rows),
  ["org.apache.commons.io.FileUtils", "org.apache.commons.io.IOUtils"]);
  assert.deepEqual(libraries.javaLibraryCompletionClasses({ ids:[] }, rows), []);
});

test("멤버 목록은 기본 목록에서 온 이름에만 연다", () => {
  /* 직접 jar 에서 읽은 이름만으로 손으로 적은 멤버 표를 열면 안 된다. Document 처럼 흔한 이름 때문에
     jsoup 을 고르지 않았는데 jsoup 의 select() 를 권할 수 있다. 직접 jar 멤버는 별도 qualified 표로 처리한다. */
  const rows = [
    { id:"", spec:"org.dom4j:dom4j:2.1.4", coordinate:"org.dom4j:dom4j:2.1.4", words:"Document Element SAXReader" }
  ];
  const selected = { ids:["org.dom4j:dom4j:2.1.4"] };
  assert.deepEqual(libraries.javaLibraryCompletionWords(selected, rows), ["Document", "Element", "SAXReader"]);
  assert.deepEqual(libraries.javaLibraryMemberWords(selected, rows), []);   // 멤버 문은 닫혀 있다

  // 기본 목록(jsoup)을 고르면 그때는 열린다.
  const catalogRows = [{ id:"jsoup", spec:"jsoup", coordinate:"org.jsoup:jsoup:1.18.3", words:"Jsoup Document" }];
  assert.deepEqual(libraries.javaLibraryMemberWords({ ids:["jsoup"] }, catalogRows), ["Jsoup", "Document"]);
});

test("편집기는 단어와 멤버에 서로 다른 목록을 넘긴다", () => {
  assert.match(editorSource, /const extra = javaLibraryCompletionWords\(libState, libRows\)/);
  assert.match(editorSource, /libraries\.words = javaLibraryMemberWords\(libState, libRows\)/);
  assert.match(editorSource, /libraries\.classes = javaLibraryCompletionClasses\(libState, libRows\)/);
});

test("직접 받은 jar 의 멤버는 고른 것만, 늦게 와도 뒤늦게 낀다", () => {
  // 기본 목록(id 가 있는 행)은 손으로 적어 둔 표를 쓰므로 서버에 묻지 않는다.
  assert.match(editorSource, /if \(!row \|\| row\.id \|\| !row\.installed\) continue/);
  assert.match(editorSource, /await javaLibraryMembers\(spec\)/);
  // 기다리는 동안 고른 것이 바뀌면 늦게 온 답은 버린다.
  assert.match(editorSource, /const seq = \+\+libraryMemberSeq/);
  assert.match(editorSource, /if \(seq !== libraryMemberSeq\) return/);
});

test("멤버 표는 좌표가 올바를 때만 묻고, 실패해도 편집을 막지 않는다", async () => {
  // 서버에 보내기 전에 좌표를 검사한다(경로를 거스르는 값이 그대로 나가면 안 된다).
  assert.deepEqual(await libraries.javaLibraryMembers("../evil"), {});
  assert.deepEqual(await libraries.javaLibraryMembers(""), {});
});
