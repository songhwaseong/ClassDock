const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../src/js/task-package.js"), "utf8");
const sandbox = {
  normalizeAssignmentTests(items){
    return Array.isArray(items) ? items.map(item => ({
      name: String(item.name || "테스트"), input: String(item.input || ""), expected: String(item.expected || ""),
      ...(item.hidden === true ? { hidden: true } : {})
    })) : [];
  },
  docs: []
};
vm.runInNewContext(source + "\n;globalThis.__taskTest = { validateTaskPayload, findOpenTaskCtx, countOpenTaskVersions };", sandbox);
const { validateTaskPayload, findOpenTaskCtx, countOpenTaskVersions } = sandbox.__taskTest;

function task(files=[]){
  return {
    format: "manneung-task", version: 1, id: "task-1",
    meta: { title: "두 수의 합" }, problem: { md: "" },
    starter: { name: "main.py", code: "print(1)" },
    files, tests: [{ name: "기본", input: "", expected: "1" }]
  };
}

test("과제 첨부는 시작 코드 및 다른 첨부와 대소문자 무시 경로 충돌을 허용하지 않는다", () => {
  assert.equal(validateTaskPayload(task([{ path: "MAIN.py", b64: "" }])).ok, false);
  assert.equal(validateTaskPayload(task([
    { path: "Data/input.txt", b64: "" },
    { path: "data/INPUT.txt", b64: "" }
  ])).ok, false);
  assert.equal(validateTaskPayload(task([{ path: "data/input.txt", b64: "" }])).ok, true);
});

test("재채점 과제는 같은 ID 중 제출 해시가 일치하는 버전을 우선한다", () => {
  const oldCtx = { hash: "old", task: { id: "task-1" } };
  const exactCtx = { hash: "exact", task: { id: "task-1" } };
  sandbox.docs.splice(0, sandbox.docs.length, { taskCtx: oldCtx }, { taskCtx: exactCtx });
  assert.equal(findOpenTaskCtx("task-1", "exact"), exactCtx);
  assert.equal(findOpenTaskCtx("task-1", "missing"), null);
  assert.equal(countOpenTaskVersions("task-1"), 2);
  sandbox.docs.splice(0, sandbox.docs.length, { taskCtx: oldCtx });
  assert.equal(findOpenTaskCtx("task-1", "missing"), oldCtx);
});
