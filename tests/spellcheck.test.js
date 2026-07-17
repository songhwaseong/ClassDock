"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const memoryStorage = new Map();
global.localStorage = {
  getItem:key => memoryStorage.has(key) ? memoryStorage.get(key) : null,
  setItem:(key, value) => memoryStorage.set(key, String(value))
};

const spellcheck = require("../src/js/spellcheck.js");

test("확실성이 높은 한국어 맞춤법과 띄어쓰기 오류를 교정 후보와 함께 찾는다", () => {
  const text = "몇일 뒤에 할수 있습니다. 금새 바꼈고 않되요.";
  const issues = spellcheck.check(text);
  const replacements = issues.flatMap(issue => issue.suggestions);

  assert.ok(replacements.includes("며칠"));
  assert.ok(replacements.includes("할 수 있"));
  assert.ok(replacements.includes("금세"));
  assert.ok(replacements.includes("바뀌었"));
  assert.ok(issues.some(issue => issue.original === "않되"));
  assert.ok(issues.some(issue => issue.original === "되요"));
});

test("마크다운 검사는 본문만 검사하고 코드 펜스와 인라인 코드는 제외한다", () => {
  const text = [
    "본문의 몇일은 검사한다.",
    "",
    "```python",
    "message = '몇일'",
    "```",
    "",
    "`되요`는 코드이고 본문에는 금새 결과가 있다."
  ].join("\n");
  const issues = spellcheck.check(text, { mode:"markdown" });

  assert.deepEqual(issues.map(issue => issue.original), ["몇일", "금새"]);
});

test("코드 검사는 실행 코드가 아니라 주석과 문자열 안의 한국어만 검사한다", () => {
  const text = [
    "plain = 금새",
    "message = \"몇일 뒤\"",
    "# 되요 라고 쓰지 않는다",
    "value = 3"
  ].join("\n");
  const issues = spellcheck.check(text, { mode:"code", fileExt:"py" });

  assert.deepEqual(issues.map(issue => issue.original), ["몇일", "되요"]);
});

test("검사 범위의 원문 오프셋을 보존하고 사용자 사전 단어를 제외한다", () => {
  const text = "앞부분 몇일\n뒷부분 금새";
  const start = text.indexOf("뒷부분");
  const ranged = spellcheck.check(text, { start, end:text.length });
  assert.equal(ranged.length, 1);
  assert.equal(ranged[0].original, "금새");
  assert.equal(text.slice(ranged[0].start, ranged[0].end), "금새");

  spellcheck.writeUserDictionary(new Set(["금새"]));
  const ignored = spellcheck.check(text, { ignored:spellcheck.readUserDictionary() });
  assert.deepEqual(ignored.map(issue => issue.original), ["몇일"]);
  spellcheck.writeUserDictionary(new Set());
});

test("확정 규칙과 사전 미등록 결과가 겹치면 확정 규칙을 우선한다", () => {
  const rules = [{
    id:"rule:0", ruleId:"rule", start:0, end:2, original:"몇일",
    suggestions:["며칠"], message:"규칙", category:"맞춤법"
  }];
  const dictionary = [
    {
      id:"dictionary:0", ruleId:"dictionary", start:0, end:2, original:"몇일",
      suggestions:[], message:"사전", category:"사전 미등록"
    },
    {
      id:"dictionary:3", ruleId:"dictionary", start:3, end:5, original:"부럴",
      suggestions:[], message:"사전", category:"사전 미등록"
    }
  ];
  const merged = spellcheck.mergeIssues(rules, dictionary);

  assert.deepEqual(merged.map(issue => issue.id), ["rule:0", "dictionary:3"]);
});

test("내장 한국어 Hunspell Worker가 미등록 단어를 찾고 기술 토큰과 사용자 사전을 제외한다", { timeout:30000 }, async t => {
  const vendor = fs.readFileSync(path.join(__dirname, "..", "vendor", "korean-hunspell-worker.js"), "utf8");
  const prefix = "window.__MN_KOREAN_HUNSPELL_WORKER_SOURCE__=";
  const start = vendor.indexOf(prefix);
  assert.ok(start >= 0, "내장 Worker 소스가 있어야 한다");
  const assignment = vendor.slice(start + prefix.length).trim().replace(/;$/, "");
  const workerSource = JSON.parse(assignment);
  const bridge = [
    "const { parentPort } = require('node:worker_threads');",
    "globalThis.self = globalThis;",
    "globalThis.process = undefined;",
    "globalThis.importScripts = () => {};",
    "globalThis.location = { href:'blob:node-test' };",
    "globalThis.postMessage = message => parentPort.postMessage(message);",
    "parentPort.on('message', data => self.onmessage({ data }));"
  ].join("\n");
  const worker = new Worker(bridge + "\n" + workerSource, { eval:true });
  t.after(() => worker.terminate());

  const run = payload => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Hunspell Worker 응답 시간 초과")), 25000);
    worker.once("message", message => { clearTimeout(timer); resolve(message); });
    worker.once("error", error => { clearTimeout(timer); reject(error); });
    worker.postMessage({ type:"check", requestId:1, ...payload });
  });
  const text = "부분 오늘은 부럴 https://예시.한국/부럴 부럴.txt";
  const result = await run({
    text,
    ranges:[{ start:0, end:text.length }],
    ignored:[]
  });

  assert.equal(result.type, "result", result.message || "Worker 검사 실패");
  assert.deepEqual(result.issues.map(issue => issue.original), ["부럴"]);
  assert.equal(result.issues[0].category, "사전 미등록");
  assert.ok(Array.isArray(result.issues[0].suggestions));

  const ignored = await run({
    text:"부럴",
    ranges:[{ start:0, end:2 }],
    ignored:["부럴"]
  });
  assert.deepEqual(ignored.issues, []);
});

test("메모·일반 편집기·노트북이 공통 맞춤법 API를 연결한다", () => {
  const root = path.join(__dirname, "..", "src", "js");
  for (const name of ["scratchpad.js", "code-viewer.js", "notebook-cells.js"]){
    const source = fs.readFileSync(path.join(root, name), "utf8");
    assert.match(source, /MNKoreanSpellcheck\.attach/);
  }
});
