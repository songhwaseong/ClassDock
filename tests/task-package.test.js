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
    format: "classdock-task", version: 1, id: "task-1",
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

/* ===== 지도 문제(kind:"map") — 2026-08-18 ===== */
/* 채점이 거리 계산이라 map-viewer 의 거리 함수를 함께 올려 실제와 같은 값으로 검사한다
   (스텁으로 대신하면 "허용 오차 안" 판정이 진짜로 맞는지는 아무것도 확인하지 못한다). */
const mapSource = fs.readFileSync(require.resolve("../src/js/map-viewer.js"), "utf8");
const mapSandbox = {
  console, Map, Set, Date, Math, JSON, Number, String, Array, Boolean,
  setTimeout, clearTimeout,
  document:{}, window:{}, location:{ protocol:"file:" }, navigator:{ onLine:true },
  normalizeAssignmentTests: sandbox.normalizeAssignmentTests,
  docs: []
};
mapSandbox.globalThis = mapSandbox;
vm.createContext(mapSandbox);
vm.runInContext(mapSource, mapSandbox);
vm.runInContext(source + `
  ;globalThis.__mapTask = { validateTaskPayload, validateTaskSubmissionPayload, normalizeMapTaskSpec,
    mapTaskGrade, TASK_MAP_MAX_QUESTIONS, TASK_MAP_DEFAULT_TOLERANCE };`, mapSandbox);
const mapTaskApi = mapSandbox.__mapTask;

function mapTask(questions){
  return {
    format: "classdock-task", version: 1, id: "map-1", kind: "map",
    meta: { title: "우리 지역 찾기" }, problem: { md: "" },
    map: { basemap: "osm", center: [37.5, 127], zoom: 12, questions }
  };
}

test("지도 문제는 시작 코드·채점 테스트 없이도 열리고, 풀 문제가 없으면 거절한다", () => {
  const ok = mapTaskApi.validateTaskPayload(mapTask([{ id:"q1", prompt:"경복궁", lat:37.5796, lng:126.977 }]));
  assert.equal(ok.ok, true);
  assert.equal(ok.task.kind, "map");
  assert.equal(ok.task.map.questions.length, 1);
  // 허용 오차를 적지 않으면 기본값이 들어간다.
  assert.equal(ok.task.map.questions[0].toleranceM, mapTaskApi.TASK_MAP_DEFAULT_TOLERANCE);
  assert.equal(mapTaskApi.validateTaskPayload(mapTask([])).ok, false);
  // 파이썬 과제는 예전 그대로 — 종류를 적지 않은 옛 .task 도 열린다.
  const python = mapTaskApi.validateTaskPayload(task());
  assert.equal(python.ok, true);
  assert.equal(python.task.kind, "python");
});

test("손으로 고친 지도 문제는 눌러 담고 쓸 수 없는 문제는 버린다", () => {
  const spec = mapTaskApi.normalizeMapTaskSpec({
    questions: [
      { id:"q1", prompt:"제대로 된 문제", lat:37.5, lng:127, toleranceM: 1 },        // 오차 하한으로 눌린다
      { id:"q1", prompt:"같은 id 는 하나만", lat:37.6, lng:127 },
      { id:"q3", prompt:"", lat:37.5, lng:127 },                                      // 문제 글이 없다
      { id:"q4", prompt:"좌표가 없다", lat:"어디에요" },
      { id:"q5", prompt:"지구 밖", lat:999, lng:999, toleranceM: 9999999 }
    ]
  });
  assert.deepEqual([...spec.questions.map(q => q.id)], ["q1", "q5"]);
  assert.equal(spec.questions[0].toleranceM, 10);
  assert.equal(spec.questions[1].lat, 85);
  assert.equal(spec.questions[1].lng, 180);
  assert.equal(spec.questions[1].toleranceM, 200000);
  // 문제 수 상한을 넘기면 앞에서부터 자른다.
  const many = mapTaskApi.normalizeMapTaskSpec({
    questions: Array.from({ length: 40 }, (_, i) => ({ id:"q" + i, prompt:"문제", lat:37, lng:127 }))
  });
  assert.equal(many.questions.length, mapTaskApi.TASK_MAP_MAX_QUESTIONS);
});

test("지도 문제 채점은 허용 오차 안이면 정답, 답하지 않은 문제는 오답", () => {
  const task = mapTaskApi.validateTaskPayload(mapTask([
    { id:"q1", prompt:"가까이", lat:37.5665, lng:126.9780, toleranceM: 500 },
    { id:"q2", prompt:"멀리", lat:35.1796, lng:129.0756, toleranceM: 500 },
    { id:"q3", prompt:"안 푼 문제", lat:33.4996, lng:126.5312, toleranceM: 500 }
  ])).task;
  const grade = mapTaskApi.mapTaskGrade(task, [
    { id:"q1", lat:37.5680, lng:126.9790 },      // 약 180m — 허용 안
    { id:"q2", lat:37.5665, lng:126.9780 }       // 부산을 서울로 찍었다
  ]);
  assert.equal(grade.total, 3);
  assert.equal(grade.passed, 1);
  assert.deepEqual([...grade.results.map(r => r.passed)], [true, false, false]);
  assert.match(grade.results[0].actual, /허용/);
  assert.equal(grade.results[2].actual, "답하지 않음");
  // 문제 순서는 그대로 — 검수 화면이 번호로 짝지어 보여 준다.
  assert.deepEqual([...grade.results.map(r => r.name)], ["가까이", "멀리", "안 푼 문제"]);
});

test("지도 문제 제출본은 종류와 찍은 좌표를 그대로 지니고 온다", () => {
  const checked = mapTaskApi.validateTaskSubmissionPayload({
    format: "classdock-task-result", version: 1, kind: "map",
    taskId: "map-1", taskTitle: "우리 지역 찾기", student: "12 홍길동",
    answers: [
      { id:"q1", lat:37.5, lng:127 },
      { id:"q2", lat:"엉뚱한 값", lng:127 },     // 좌표가 아니면 버린다
      { id:"", lat:37, lng:127 }                  // 어느 문제의 답인지 알 수 없다
    ],
    grade: { passed: 1, total: 2, results: [] }
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.submission.kind, "map");
  assert.deepEqual([...checked.submission.answers.map(a => a.id)], ["q1"]);
  // 파이썬 제출본은 예전대로 종류가 python 이고 좌표는 비어 있다.
  const python = mapTaskApi.validateTaskSubmissionPayload({
    format: "classdock-task-result", version: 1, taskId: "t", student: "홍길동", code: "print(1)",
    grade: { passed: 1, total: 1, results: [] }
  });
  assert.equal(python.submission.kind, "python");
  assert.deepEqual([...python.submission.answers], []);
});
