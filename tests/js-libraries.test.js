"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const libraries = require("../src/js/js-libraries.js");

test("내장 JavaScript 라이브러리는 고정 버전·전역 이름·vendor 파일을 가진다", () => {
  assert.deepEqual(libraries.JS_LIBRARY_CATALOG.map((item) => item.id), ["lodash", "dayjs", "papaparse", "mathjs"]);
  for (const item of libraries.JS_LIBRARY_CATALOG){
    assert.match(item.version, /^\d+\.\d+\.\d+$/);
    assert.match(item.global, /^[A-Za-z_$][\w$]*$/);
    assert.ok(fs.statSync(path.join(root, "vendor", item.file)).size > 1000, item.file);
  }
});

test("문서별 라이브러리 상태는 알 수 없는 항목과 너무 큰 로컬 파일을 버린다", () => {
  const state = libraries.jsLibraryState({
    builtins:["lodash", "unknown", "lodash", "dayjs"],
    npm:[
      { id:"0123456789abcdef0123456789abcdef", name:"lodash-es", version:"4.17.21", global:"lodashEs", size:1234 },
      { id:"not-safe", name:"bad", version:"1.0.0", global:"bad" }
    ],
    custom:[
      { id:"bad", name:"ok.js", source:"globalThis.OK = true;" },
      { name:"huge.js", source:"x".repeat(libraries.JS_LIBRARY_MAX_CUSTOM_SOURCE + 1) }
    ]
  });
  assert.deepEqual(state.builtins, ["lodash", "dayjs"]);
  assert.deepEqual(state.npm.map((item) => item.global), ["lodashEs"]);
  assert.equal(state.version, 2);
  assert.equal(state.custom.length, 1);
  assert.match(state.custom[0].id, /^custom:/);
});

test("선택한 내장 라이브러리만 자동완성 전역과 멤버를 제공한다", () => {
  const state = { builtins:["lodash", "papaparse"], npm:[
    { id:"0123456789abcdef0123456789abcdef", name:"nanoid", version:"5.1.0", global:"nanoid" }
  ], custom:[] };
  assert.deepEqual(libraries.jsLibraryCompletionWords(state), ["_", "Papa", "nanoid"]);
  assert.equal(libraries.jsLibraryMemberCandidates(state, "_", "ch")[0].name, "chunk");
  assert.equal(libraries.jsLibraryMemberCandidates(state, "math", "sqrt").length, 0);
});

test("npm 입력에서 Worker 전역 이름을 안전하게 제안한다", () => {
  assert.equal(libraries.jsNpmGlobalFromSpec("lodash-es@4.17.21"), "lodashEs");
  assert.equal(libraries.jsNpmGlobalFromSpec("@scope/my-library@2.0.0"), "myLibrary");
  assert.equal(libraries.jsNpmGlobalFromSpec("3d-lib"), "pkg3dLib");
  assert.match(libraries.jsNpmErrorText("npm-failed: no-node"), /Node\.js/);
});

test("고정한 브라우저 배포본은 Worker와 같은 전역 환경에서 실제로 로드된다", () => {
  for (const item of libraries.JS_LIBRARY_CATALOG){
    const context = vm.createContext({});
    vm.runInContext("globalThis.self = globalThis; globalThis.window = undefined;", context);
    const source = fs.readFileSync(path.join(root, "vendor", item.file), "utf8");
    new vm.Script(source, { filename:item.file }).runInContext(context);
    assert.notEqual(vm.runInContext("typeof globalThis[" + JSON.stringify(item.global) + "]", context), "undefined", item.label);
  }
});
