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
  assert.match(runtimeSource, /startJavaSession\(source, stdinText, true, options\.libs\)/);
  assert.match(runtimeSource, /startJavaSession\(source, "", false, hooks\.libs\)/);
});

test("라이브러리 이름은 쿼리로만 보내고 경로는 만들지 않는다", () => {
  assert.match(runtimeSource, /query\.push\("libs=" \+ encodeURIComponent\(String\(libs\)\)\)/);
  assert.ok(!/java-lib-catalog|repo1\.maven\.org/.test(runtimeSource), "실행기는 카탈로그·저장소를 알 필요가 없다");
});
