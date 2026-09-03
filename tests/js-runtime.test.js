"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const runtimeSource = fs.readFileSync(path.join(root, "src/js/js-runtime.js"), "utf8");

// js-runtime.js 는 브라우저 전역을 로드 시점에 건드리지 않으므로 vm 컨텍스트에 그대로 올릴 수 있다.
function loadRuntime(){
  const context = vm.createContext({ console });
  new vm.Script(runtimeSource, { filename:"js-runtime.js" }).runInContext(context);
  return {
    context,
    get: (name) => vm.runInContext(name, context)
  };
}

// 워커 본체(jsWorkerMain)를 실제로 실행한다. 브라우저 Worker 대신 vm 컨텍스트를 self 로 쓴다 —
// console 후킹·input 셰임·타이머 배수·오류 수집이 정말 동작하는지 문자열 검사 없이 확인하기 위해서다.
function runInWorker(source, options = {}){
  const context = vm.createContext({});
  vm.runInContext("globalThis.self = globalThis;", context);
  const globals = vm.runInContext("globalThis", context);
  globals.setTimeout = setTimeout;
  globals.clearTimeout = clearTimeout;
  globals.setInterval = setInterval;
  globals.clearInterval = clearInterval;
  globals.addEventListener = () => {};
  new vm.Script(runtimeSource, { filename:"js-runtime.js" }).runInContext(context);
  const head = vm.runInContext("JS_WRAPPER_HEAD", context);
  const tailHead = vm.runInContext("JS_WRAPPER_TAIL_HEAD", context);
  // 워커는 출력을 조금씩(chunk) 흘려보내고 결과에는 담지 않는다 — 메인 스레드처럼 여기서 모은다.
  const segments = [];
  const chunks = [];
  const token = "run-test-token";
  const absorb = (list) => {
    for (const piece of list || []){
      if (!piece || !piece.t) continue;
      const last = segments[segments.length - 1];
      if (last && last.s === piece.s) last.t += piece.t;
      else segments.push({ s:piece.s, t:piece.t });
    }
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("워커가 끝나지 않았습니다.")), 5000);
    globals.postMessage = (message) => {
      if (!message) return;
      if (message.token !== token) return;
      if (message.type === "clear"){ segments.length = 0; return; }
      if (message.type === "chunk"){ chunks.push(message.segments); absorb(message.segments); return; }
      if (message.type !== "result") return;
      clearTimeout(timer);
      resolve(Object.assign({ segments, chunks }, message.result));
    };
    vm.runInContext("jsWorkerMain(formatJsValue)", context);
    globals.onmessage({ data:{
      type:"run",
      token,
      source,
      stdin: options.stdin || "",
      libraries: options.libraries || [],
      head,
      tail: tailHead + "practice.js\n",
      headLimit: options.headLimit || 1024 * 1024,
      segmentLimit: options.segmentLimit || 4000,
      graceMs: options.graceMs || 300,
      flushMs: options.flushMs || 5,
      flushChars: options.flushChars || 8192
    } });
  });
}

// 커널(노트북) 모드: 워커 하나를 살려 두고 셀을 차례로 보낸다. 앞 셀의 값이 남는지 확인하려면
// 워커 컨텍스트를 유지해야 하므로, 한 번 만들어 두고 여러 셀을 돌리는 하니스를 따로 둔다.
function makeWorkerKernel(){
  const context = vm.createContext({});
  vm.runInContext("globalThis.self = globalThis;", context);
  const globals = vm.runInContext("globalThis", context);
  globals.setTimeout = setTimeout;
  globals.clearTimeout = clearTimeout;
  globals.setInterval = setInterval;
  globals.clearInterval = clearInterval;
  globals.addEventListener = () => {};
  new vm.Script(runtimeSource, { filename:"js-runtime.js" }).runInContext(context);
  vm.runInContext("jsWorkerMain(formatJsValue)", context);
  const transform = vm.runInContext("transformJsCellSource", context);
  let seq = 0;
  const waiting = new Map();
  globals.postMessage = (message) => {
    if (!message) return;
    const job = waiting.get(message.id);
    if (!job || message.token !== job.token) return;
    if (message.type === "clear"){ job.clear(); return; }
    if (message.type === "chunk"){ job.absorb(message.segments); return; }
    if (message.type === "result"){ waiting.delete(message.id); job.resolve(message.result); }
  };
  return {
    // 셀 하나를 실행하고 { segments, ...result } 를 돌려준다.
    run(source, options = {}){
      const id = ++seq;
      const token = "cell-test-token-" + id;
      const segments = [];
      const absorb = (list) => {
        for (const piece of list || []){
          if (!piece || !piece.t) continue;
          const last = segments[segments.length - 1];
          if (last && last.s === piece.s) last.t += piece.t;
          else segments.push({ s:piece.s, t:piece.t });
        }
      };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("셀이 끝나지 않았습니다.")), 5000);
        waiting.set(id, {
          token,
          absorb,
          clear:() => { segments.length = 0; },
          resolve:(result) => { clearTimeout(timer); resolve(Object.assign({ segments }, result)); }
        });
        globals.onmessage({ data:{
          type:"cell", id, token,
          source,
          code: transform(source).code,
          userFile:"cell.js",
          stdin: options.stdin || "",
          libraries: options.libraries || [],
          headLimit: 1024 * 1024,
          segmentLimit: 4000,
          graceMs: options.graceMs || 200,
          flushMs: 5,
          flushChars: 8192
        } });
      });
    }
  };
}

const textOf = (result, stream) => (result.segments || [])
  .filter((segment) => !stream || segment.s === stream)
  .map((segment) => segment.t)
  .join("");

test("스택의 줄 번호에서 래퍼 줄 수를 빼면 편집기 줄 번호와 맞는다", async () => {
  const runtime = loadRuntime();
  const parse = runtime.get("parseJsStackLocation");
  const prefix = runtime.get("JS_WRAPPER_PREFIX_LINES");
  // 사용자 기준 3번째 줄에서 오류가 난다.
  const result = await runInWorker("const a = 1;\nconst b = 2;\nnull.boom;\n");
  assert.ok(result.error, "오류가 보고되어야 한다");
  const location = parse(result.error.stack, "practice.js", prefix);
  assert.equal(location.line, 3);
});

test("래퍼 줄 수 상수는 손으로 센 값이 아니라 실제 래퍼와 일치한다", () => {
  const runtime = loadRuntime();
  const head = runtime.get("JS_WRAPPER_HEAD");
  // new Function 이 붙이는 `function anonymous(` + `) {` 2줄 + 래퍼 앞부분의 줄 수
  assert.equal(runtime.get("JS_WRAPPER_PREFIX_LINES"), 2 + head.split("\n").length - 1);
});

test("parseJsStackLocation 은 V8·SpiderMonkey 형식을 모두 읽고 안쪽 프레임을 고른다", () => {
  const parse = loadRuntime().get("parseJsStackLocation");
  // vm 컨텍스트가 만든 객체라 프로토타입이 달라 deepStrictEqual 을 쓸 수 없다 — 값으로 비교한다.
  const at = (stack) => {
    const hit = parse(stack, "practice.js", 4);
    return hit ? hit.line + ":" + hit.column : null;
  };
  assert.equal(at("TypeError: x\n    at inner (practice.js:9:3)\n    at outer (practice.js:12:1)"), "5:3");
  assert.equal(at("inner@practice.js:9:3\nouter@practice.js:12:1"), "5:3");
  // 래퍼 안쪽(사용자 코드보다 앞)의 프레임은 건너뛴다.
  assert.equal(at("at wrapper (practice.js:2:1)\n    at user (practice.js:7:5)"), "3:5");
  assert.equal(at(""), null);
  assert.equal(at("at other.js:9:3"), null);
});

test("console 은 스트림별로 나뉘어 기록된다", async () => {
  const result = await runInWorker([
    "console.log('보통');",
    "console.warn('경고');",
    "console.error('오류');"
  ].join("\n"));
  assert.equal(result.error, null);
  assert.equal(textOf(result, "out"), "보통\n");
  assert.equal(textOf(result, "warn"), "경고\n");
  assert.equal(textOf(result, "err"), "오류\n");
});

test("선택한 라이브러리는 사용자 코드보다 먼저 별도 소스로 실행된다", async () => {
  const result = await runInWorker("console.log(StudyLib.twice(7));", {
    libraries:[{
      id:"study-lib@1", name:"Study Lib", global:"StudyLib", sourceURL:"study-lib.js",
      source:"globalThis.StudyLib = { twice(n){ return n * 2; } };"
    }]
  });
  assert.equal(result.error, null);
  assert.equal(textOf(result, "out"), "14\n");
});

test("라이브러리 로드 오류는 사용자 코드 오류와 구분해 이름을 알려준다", async () => {
  const result = await runInWorker("console.log('실행되면 안 됨');", {
    libraries:[{ id:"broken@1", name:"깨진 도구", sourceURL:"broken.js", source:"const = ;" }]
  });
  assert.ok(result.error);
  assert.match(result.error.message, /깨진 도구 불러오기 실패/);
  assert.equal(textOf(result, "out"), "");
});

test("console.clear 는 이미 보낸 출력까지 비우고 실행을 계속한다", async () => {
  const result = await runInWorker("console.log('지울 값');\nconsole.clear();\nconsole.log('남길 값');", { flushMs:1 });
  assert.equal(result.error, null);
  assert.equal(textOf(result, "out"), "남길 값\n");
});

test("사용자 postMessage 는 실행 완료 프로토콜을 위조할 수 없다", async () => {
  const result = await runInWorker([
    "postMessage({ type:'result', result:{ segments:[{ s:'out', t:'가짜\\n' }] } });",
    "console.log('실제');"
  ].join("\n"));
  assert.equal(result.error, null);
  assert.equal(textOf(result, "out"), "실제\n");
});

test("console.log 는 여러 인자를 공백으로 잇고 객체를 펼쳐 보여준다", async () => {
  const result = await runInWorker("console.log('값', { a:1 }, [1, 2]);");
  assert.equal(textOf(result, "out"), '값 { a: 1 } [1, 2]\n');
});

test("input() 은 입력값 칸을 순서대로 소비하고 화면에 남긴다", async () => {
  const result = await runInWorker(
    "const name = input('이름? ');\nconst age = input();\nconsole.log(name + '/' + age);",
    { stdin:"홍길동\n27\n" }
  );
  assert.equal(result.error, null);
  assert.equal(textOf(result, "out"), "이름? 홍길동\n27\n홍길동/27\n");
});

test("입력값이 모자라면 어디를 채워야 하는지 알려준다", async () => {
  const result = await runInWorker("input();\ninput();", { stdin:"하나\n" });
  assert.ok(result.error);
  assert.match(result.error.message, /입력값이 모자랍니다/);
});

test("본체가 끝나도 남은 setTimeout 의 출력까지 기다린다", async () => {
  const result = await runInWorker("setTimeout(() => console.log('나중'), 10);\nconsole.log('먼저');");
  assert.equal(result.error, null);
  assert.equal(textOf(result, "out"), "먼저\n나중\n");
  assert.equal(result.pendingNote, "");
});

test("clearTimeout 으로 취소하면 기다리지 않고 끝난다", async () => {
  const result = await runInWorker("const id = setTimeout(() => console.log('안 나옴'), 50);\nclearTimeout(id);");
  assert.equal(textOf(result, "out"), "");
  assert.equal(result.pendingNote, "");
});

test("setInterval 은 유예 시간까지만 돌고 멈춘 이유를 알려준다", async () => {
  const result = await runInWorker("setInterval(() => console.log('반복'), 10);", { graceMs:120 });
  assert.ok(textOf(result, "out").includes("반복"));
  assert.match(result.pendingNote, /clearInterval/);
});

test("유예 시간이 지난 setTimeout 은 살아 있는 커널의 다음 셀을 바꾸지 않는다", async () => {
  const kernel = makeWorkerKernel();
  const first = await kernel.run("setTimeout(() => { globalThis.tooLate = 1; }, 60);", { graceMs:10 });
  assert.match(first.pendingNote, /예약한 작업/);
  await new Promise((resolve) => setTimeout(resolve, 90));
  const second = await kernel.run("typeof tooLate");
  assert.equal(second.value, '"undefined"');
});

test("top-level await 를 쓸 수 있다", async () => {
  const result = await runInWorker("const v = await Promise.resolve(7);\nconsole.log(v);");
  assert.equal(result.error, null);
  assert.equal(textOf(result, "out"), "7\n");
});

test("화면 관련 전역은 이유를 붙여 막는다", async () => {
  const result = await runInWorker("document.querySelector('body');");
  assert.ok(result.error);
  assert.match(result.error.message, /HTML 미리보기/);
});

test("출력이 한도를 넘으면 잘라내고 표시를 남긴다", async () => {
  const result = await runInWorker("for (let i = 0; i < 500; i++) console.log('0123456789');", { headLimit:64 });
  assert.equal(result.truncated, true);
  assert.ok(textOf(result).length <= 64);
});

test("checkJsSyntax 는 문법 오류만 잡고 정상 코드는 통과시킨다", () => {
  const check = loadRuntime().get("checkJsSyntax");
  assert.equal(check("const a = 1;\nconsole.log(a);"), null);
  assert.equal(check("const v = await Promise.resolve(1);"), null);   // 래퍼가 async 라 허용된다
  assert.equal(check("return 1;"), null);                             // 래퍼 함수 안이라 허용된다
  const bad = check("if (true {\n}");
  assert.ok(bad && bad.message, "문법 오류 메시지가 있어야 한다");
});

test("문법 오류에 닫히지 않은 짝의 줄 번호를 붙인다", () => {
  const check = loadRuntime().get("checkJsSyntax");
  // 2번째 줄에서 연 { 가 끝까지 닫히지 않는다.
  const unclosed = check("const a = 1;\nfunction f(){\n  console.log(a);\n");
  assert.equal(unclosed.line, 2);
  assert.match(unclosed.message, /닫지 않았어요/);
  // 닫는 짝이 하나 더 있는 경우는 그 자리를 짚는다.
  const extra = check("function f(){\n}\n}\n");
  assert.equal(extra.line, 3);
  assert.match(extra.message, /여는 짝 없이/);
});

test("문법 오류 위치 추정은 문자열·주석·정규식 안의 괄호에 속지 않는다", () => {
  const locate = loadRuntime().get("locateJsSyntaxProblem");
  // 문자열·주석·정규식 안의 괄호는 세지 않는다 → 정상 코드에서는 아무 곳도 짚지 않는다.
  assert.equal(locate('const s = "){";\nconst r = /[)]/;\n// }\nconst t = `${1}`;\n'), null);
  assert.equal(locate("const half = total / 2 / 3;\n"), null);        // 나눗셈을 정규식으로 보지 않는다
  assert.equal(locate("return /ab+/.test(s);\n"), null);              // return 뒤는 정규식이다
  // 닫히지 않은 따옴표는 연 줄을 짚는다.
  const openString = locate('const a = 1;\nconst s = "열고 안 닫음;\n');
  assert.equal(openString.line, 2);
  assert.match(openString.reason, /닫히지 않았어요/);
  // 닫히지 않은 블록 주석도 연 줄을 짚는다.
  assert.equal(locate("const a = 1;\n/* 여기부터\n").line, 2);
});

test("explainJsError 는 자주 나는 오류에 한국어 도움말을 붙인다", () => {
  const explain = loadRuntime().get("explainJsError");
  assert.match(explain("ReferenceError", "total is not defined").tip, /total/);
  assert.match(explain("ReferenceError", "Cannot access 'x' before initialization").title, /만들기 전에/);
  assert.match(explain("TypeError", "Cannot read properties of undefined (reading 'name')").tip, /name/);
  assert.match(explain("TypeError", "obj.run is not a function").tip, /obj\.run/);
  assert.match(explain("TypeError", "Assignment to constant variable.").title, /const/);
  assert.match(explain("RangeError", "Maximum call stack size exceeded").title, /끝없이/);
  assert.match(explain("SyntaxError", "Unexpected end of input").title, /닫는 기호/);
  // 짝이 없으면 억지로 만들어 내지 않는다.
  assert.equal(explain("Error", "알 수 없는 문제"), null);
  assert.equal(explain("TypeError", "완전히 새로운 메시지"), null);
});

test("jsUsesInput 은 input·prompt 호출만 찾는다", () => {
  const usesInput = loadRuntime().get("jsUsesInput");
  assert.equal(usesInput("const a = input();"), true);
  assert.equal(usesInput("prompt('이름')"), true);
  assert.equal(usesInput("form.input(3)"), false);        // 메서드 호출은 아니다
  assert.equal(usesInput("const inputs = 3;"), false);
  assert.equal(usesInput("console.log(1);"), false);
});

test("formatJsValue 는 realm 과 무관하게 표준 객체를 알아본다", () => {
  const format = loadRuntime().get("formatJsValue");
  assert.equal(format("바로 문자열", 0), "바로 문자열");           // 최상위 문자열은 따옴표 없이
  assert.equal(format(["a"], 0), '["a"]');                          // 중첩 문자열은 따옴표로
  assert.equal(format(undefined, 0), "undefined");
  assert.equal(format(10n, 0), "10n");
  assert.equal(format(new Map([["a", 1]]), 0), 'Map(1) { "a" => 1 }');
  assert.equal(format(new Set([1, 2]), 0), "Set(2) { 1, 2 }");
  assert.equal(format(/ab+/gi, 0), "/ab+/gi");
  assert.equal(format(() => {}, 0), "[Function: anonymous]");
  assert.equal(format([1, [2, [3, [4, [5]]]]], 0), "[1, [2, [3, [4, [Array]]]]]");
  const circular = { n:1 }; circular.self = circular;
  assert.equal(format(circular, 0), "{ n: 1, self: [순환 참조] }");
});

test("워커에 주입되는 소스는 문법적으로 유효하다", () => {
  const runtime = loadRuntime();
  const source = "(" + runtime.get("jsWorkerMain").toString() + ")(" + runtime.get("formatJsValue").toString() + ");";
  assert.doesNotThrow(() => new vm.Script(source, { filename:"js-worker.generated.js" }));
});

test("실행 가능한 확장자와 언어 판별이 한 곳에 모여 있다", () => {
  const context = vm.createContext({ console, window:{}, localStorage:{ getItem:() => null, setItem:() => {} } });
  const runContext = fs.readFileSync(path.join(root, "src/js/python-run-context.js"), "utf8");
  new vm.Script(runContext, { filename:"python-run-context.js" }).runInContext(context);
  const runLangForExt = vm.runInContext("runLangForExt", context);
  assert.equal(runLangForExt("py"), "python");
  assert.equal(runLangForExt("js"), "js");
  assert.equal(runLangForExt("MJS"), "js");
  assert.equal(runLangForExt("txt"), null);
  assert.equal(runLangForExt(""), null);
});

test("출력은 실행이 끝나기 전에 조금씩 흘러나온다", async () => {
  // 오래 걸리는 코드도 진행이 보여야 한다 — 결과 한 번에 몰아 보내지 않는다.
  const result = await runInWorker(
    "console.log('첫째');\nawait new Promise(r => setTimeout(r, 30));\nconsole.log('둘째');",
    { flushMs:1 }
  );
  assert.equal(textOf(result, "out"), "첫째\n둘째\n");
  assert.ok(result.chunks.length >= 2, "출력이 두 번 이상 나뉘어 나와야 한다");
});

test("이벤트 루프를 놓지 않는 동기 반복에서도 출력이 흘러나온다", async () => {
  // 타이머 flush 는 여기서 영영 돌지 않는다 — 크기 기준 즉시 flush 가 없으면 조각이 하나뿐이다.
  const result = await runInWorker(
    "for (let i = 0; i < 400; i++) console.log('0123456789012345678901234567890123456789');",
    { flushMs:100000, flushChars:1024 }
  );
  assert.ok(result.chunks.length >= 4, "동기 반복 중에도 여러 번 나뉘어 나와야 한다 (실제: " + result.chunks.length + ")");
  assert.ok(textOf(result, "out").startsWith("0123456789"));
});

test("결과 메시지에는 출력을 담지 않는다(이미 보낸 조각으로 충분하다)", async () => {
  const result = await runInWorker("console.log('하나');");
  // runInWorker 가 chunk 를 모아 segments 를 만든다. 워커의 result 자체에는 segments 가 없다.
  assert.equal(textOf(result, "out"), "하나\n");
  assert.ok(result.chunks.length >= 1);
});

test("메인 스레드는 중지·시간 초과에도 그때까지 받은 출력을 남긴다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/js-runtime.js"), "utf8");
  // 워커를 끊어도 이미 받아 둔 segments 위에 상태만 얹어 돌려준다.
  assert.match(source, /resolve\(Object\.assign\(\{ segments \}, extra \|\| \{\}\)\)/);
  assert.match(source, /cancel\(\)\{ done\(\{ cancelled:true \}\); \}/);
  assert.match(source, /done\(\{ timedOut:true \}\)/);
  // 실행 중에는 받은 조각을 화면에 바로 이어 붙인다.
  assert.match(source, /onChunk: \(chunk\) => appendJsSegments\(pre, chunk\)/);
});

// 채점 한 줄(jsGradingRow)은 실행 결과를 보고서 모양으로 바꾸는 순수 함수라 그대로 부를 수 있다.
function loadGrading(){
  const runtime = loadRuntime();
  // core.js 의 공용 함수(정규화)를 같은 컨텍스트에 올려 준다 — 실제 앱과 같은 조합.
  const core = fs.readFileSync(path.join(root, "src/js/core.js"), "utf8");
  const normalize = core.match(/  function normalizeGradingOutput\(value\) \{[\s\S]*?\n  \}/)[0];
  const tests = core.match(/  function normalizeAssignmentTests\(items[\s\S]*?\n  \}/)[0];
  vm.runInContext(normalize.trim().replace(/^function/, "globalThis.normalizeGradingOutput = function"), runtime.context);
  vm.runInContext(tests.trim().replace(/^function/, "globalThis.normalizeAssignmentTests = function"), runtime.context);
  return runtime;
}

test("채점 한 줄은 앞뒤 빈 줄·줄 끝 공백을 무시하고 견준다", () => {
  const row = loadGrading().get("jsGradingRow");
  const make = (expected, out) => row({ name:"T", input:"", expected }, 0,
    { segments:out ? [{ s:"out", t:out }] : [] });
  assert.equal(make("5", "5\n").passed, true);
  assert.equal(make("5", "\n\n5   \n\n").passed, true);      // 앞뒤 빈 줄·줄 끝 공백은 무시
  assert.equal(make("5", "6\n").passed, false);
  assert.equal(make("", "").passed, true);
  // 실제 출력과 기대 출력은 원본 그대로 보고서에 남는다(화면에서 비교할 수 있게).
  assert.equal(make("5", "5\n").actual, "5\n");
});

test("채점은 오류·시간 초과·중지를 실패로 적는다", () => {
  const row = loadGrading().get("jsGradingRow");
  const at = (raw) => row({ name:"T", input:"", expected:"5" }, 0, raw);
  const failed = at({ segments:[{ s:"out", t:"5\n" }], error:{ name:"TypeError", message:"boom" } });
  assert.equal(failed.passed, false, "출력이 맞아도 오류가 났으면 통과가 아니다");
  assert.match(failed.error, /TypeError: boom/);
  assert.match(at({ timedOut:true }).error, /끝나지 않았어요/);
  assert.match(at({ cancelled:true }).error, /중지/);
  // 예외가 없을 때만 stderr 출력을 오류로 본다(파이썬 채점과 같은 순서).
  assert.match(at({ segments:[{ s:"err", t:"이런\n" }] }).error, /이런/);
  assert.equal(at({ segments:[{ s:"err", t:"뒤에 밀림\n" }], error:{ name:"Error", message:"먼저" } }).error, "Error: 먼저");
});

test("문법이 틀리면 워커를 띄우지 않고 모든 테스트에 같은 사유를 적는다", async () => {
  const runtime = loadGrading();
  const grade = runtime.get("runJsGrading");
  // Worker 가 없는 환경이다 — 워커를 띄우려 했다면 여기서 터진다.
  const report = await grade("if (true {", [
    { name:"A", input:"", expected:"1" },
    { name:"B", input:"", expected:"2" }
  ]);
  assert.equal(report.results.length, 2);
  for (const row of report.results){
    assert.equal(row.passed, false);
    assert.match(row.error, /SyntaxError/);
    assert.match(row.error, /닫지 않았어요/);       // 위치 추정도 함께 붙는다
  }
});

test("채점은 테스트마다 코드를 새로 실행하고 중지하면 거기서 멈춘다", async () => {
  const runtime = loadGrading();
  // 워커 대신 가짜 실행기를 끼워 루프·중지·진행 알림만 확인한다.
  const runs = [];
  vm.runInContext("globalThis.__runs = [];", runtime.context);
  runtime.context.__fakeRun = (source, options) => {
    runs.push(options.stdin);
    return { promise:Promise.resolve({ segments:[{ s:"out", t:String(Number(options.stdin) * 2) + "\n" }] }), cancel(){} };
  };
  vm.runInContext("globalThis.startJsWorkerRun = (s, o) => __fakeRun(s, o);", runtime.context);
  const grade = runtime.get("runJsGrading");

  const progress = [];
  const report = await grade("console.log(Number(input()) * 2);", [
    { name:"A", input:"2", expected:"4" },
    { name:"B", input:"3", expected:"6" },
    { name:"C", input:"4", expected:"99" }
  ], { onProgress:(index, total) => progress.push(index + "/" + total) });
  assert.deepEqual(runs, ["2", "3", "4"], "테스트마다 각자의 입력으로 새로 실행해야 한다");
  assert.deepEqual(progress, ["0/3", "1/3", "2/3"]);
  // vm 컨텍스트가 만든 배열이라 deepStrictEqual 을 쓸 수 없다 — 값으로 비교한다.
  assert.equal(report.results.map((r) => r.passed).join(","), "true,true,false");

  // 중지하면 남은 테스트는 실행하지 않는다.
  runs.length = 0;
  let stop = false;
  const stopped = await grade("code", [
    { name:"A", input:"1", expected:"2" },
    { name:"B", input:"2", expected:"4" }
  ], { isCancelled:() => stop, onHandle:() => { stop = true; } });
  assert.equal(runs.length, 1, "중지 뒤에는 다음 테스트를 시작하지 않는다");
  assert.equal(stopped.results.length, 1);
});

test("js 편집기의 채점 버튼은 파이썬 테스트 창을 쓰되 저장 자리는 따로 둔다", () => {
  const editorSource = fs.readFileSync(path.join(root, "src/js/js-editor.js"), "utf8");
  assert.match(editorSource, /openAssignmentGradingModal\(\{/);
  assert.match(editorSource, /onRun: \(tests\) => runJsSource\(editor\.getValue\(\), ui, \{ gradeTests:tests \}\)/);
  // 파이썬 테스트와 섞이지 않게 저장 키를 분리한다.
  assert.match(editorSource, /const JS_GRADE_PREFIX = "classdock-js-grade:"/);
  // 과제 패키지(.task)는 아직 파이썬 전용이라 넘기지 않는다.
  assert.doesNotMatch(editorSource, /taskExport/);
  // 채점 중에는 채점 버튼을 잠근다.
  const runtimeSrc = fs.readFileSync(path.join(root, "src/js/js-runtime.js"), "utf8");
  assert.match(runtimeSrc, /if \(ui\.gradeBtn\) ui\.gradeBtn\.disabled = true;/);
  assert.match(runtimeSrc, /if \(ui\.gradeBtn\) ui\.gradeBtn\.disabled = false;/);
  // 결과는 파이썬 채점 화면을 그대로 쓴다 — 따로 그리지 않는다.
  assert.match(runtimeSrc, /renderAssignmentGradingResult\(outPanel, report,/);
});

test("js 편집기의 저장은 자동 복원 사본까지 갱신한다", () => {
  // saveTextDoc 은 디스크에만 쓴다. 편집 직후 저장하면 디바운스 복구 스냅샷도 건너뛰므로
  // 저장 자리에서 공용 헬퍼로 작업공간 사본을 저장한 내용으로 바꿔야 한다(악보·.mnote 와 같은 경로).
  const editorSource = fs.readFileSync(path.join(root, "src/js/js-editor.js"), "utf8");
  const calls = editorSource.match(/markDocumentSavedSnapshot\(ownerDoc, new TextEncoder\(\)\.encode\(value\), "text\/plain;charset=utf-8"\)/g) || [];
  assert.equal(calls.length, 2, "저장 버튼과 자동 저장 두 곳 모두에서 사본을 갱신한다");
});

test("셀 변환은 맨 바깥 선언만 var 로 바꾼다", () => {
  const transform = loadRuntime().get("transformJsCellSource");
  const code = (src) => transform(src).code;
  assert.equal(code("let a = 1;"), "var a = 1;");
  assert.equal(code("const {p, q} = obj;"), "var {p, q} = obj;");     // 구조분해도 그대로 동작한다
  assert.equal(code("const [x, y] = arr;"), "var [x, y] = arr;");
  assert.equal(code("class Point { hi(){} }"), "var Point = class Point { hi(){} }");
  assert.equal(code("class Dog extends Animal {}"), "var Dog = class Dog extends Animal {}");
  // 블록·함수·괄호 안의 선언은 원래대로 그 안에서만 살아야 한다.
  assert.equal(code("function f(){ let inner = 1; }"), "function f(){ let inner = 1; }");
  assert.equal(code("for (const it of list) {}"), "for (const it of list) {}");
  assert.equal(code("if (t) { let scoped = 1; }"), "if (t) { let scoped = 1; }");
  // 문자열·주석·정규식 안의 글자와 속성 이름은 건드리지 않는다.
  assert.equal(code('const s = "let a = 1";'), 'var s = "let a = 1";');
  assert.equal(code("// let a = 1"), "// let a = 1");
  assert.equal(code("const re = /let /g;"), "var re = /let /g;");
  assert.equal(code("obj.const = 1; obj.let = 2;"), "obj.const = 1; obj.let = 2;");
  assert.equal(transform("console.log(1);").changed, false);
});

test("커널은 앞 셀에서 만든 값을 다음 셀에서 쓸 수 있다", async () => {
  const kernel = makeWorkerKernel();
  await kernel.run("let total = 10;\nconst name = '홍길동';\nfunction twice(n){ return n * 2 }\nclass Box { get v(){ return 7 } }");
  const second = await kernel.run("console.log(total, name, twice(total), new Box().v);");
  assert.equal(second.error, null);
  assert.equal(textOf(second, "out"), "10 홍길동 20 7\n");
});

test("같은 셀을 다시 실행해도 ‘이미 선언됨’ 오류가 나지 않는다", async () => {
  const kernel = makeWorkerKernel();
  const first = await kernel.run("let count = 1;\nclass Item {}");
  assert.equal(first.error, null);
  const again = await kernel.run("let count = 2;\nclass Item {}\nconsole.log(count);");
  assert.equal(again.error, null);
  assert.equal(textOf(again, "out"), "2\n");
});

test("셀 마지막 식의 값을 결과로 돌려준다", async () => {
  const kernel = makeWorkerKernel();
  assert.equal((await kernel.run("1 + 1")).value, "2");
  assert.equal((await kernel.run("'글자'")).value, '"글자"');          // 값 표기는 따옴표를 붙인다
  assert.equal((await kernel.run("var q = 5;")).value, "");            // 선언문에는 값이 없다
  assert.equal((await kernel.run("[1, 2]")).value, "[1, 2]");
});

test("셀의 오류 줄 번호는 보정 없이 셀의 줄 번호와 맞는다", async () => {
  const runtime = loadRuntime();
  const parse = runtime.get("parseJsStackLocation");
  const kernel = makeWorkerKernel();
  const result = await kernel.run("var a = 1;\nvar b = 2;\nnull.boom;");
  assert.ok(result.error);
  assert.equal(parse(result.error.stack, "cell.js", 0).line, 3);
});

test("top-level await 를 쓴 셀은 함수로 감싸 실행하고 그 사실을 알린다", async () => {
  const kernel = makeWorkerKernel();
  const result = await kernel.run("const v = await Promise.resolve(3);\nconsole.log(v);");
  assert.equal(result.error, null);
  assert.equal(textOf(result, "out"), "3\n");
  assert.equal(result.asyncWrapped, true);
  // 감싸서 실행했으므로 이 셀의 변수는 다음 셀로 이어지지 않는다.
  const next = await kernel.run("typeof v");
  assert.equal(next.value, '"undefined"');
});

test("jsKernelResult 는 노트북이 아는 결과 모양으로 바꾼다", () => {
  const toResult = loadRuntime().get("jsKernelResult");
  const plain = toResult([{ s:"out", t:"안녕\n" }, { s:"err", t:"이런\n" }], { value:"42" });
  assert.equal(plain.ok, true);
  assert.equal(plain.stdout, "안녕\n");
  assert.match(plain.stderr, /이런/);
  assert.equal(plain.richOutputs[0].output_type, "execute_result");
  assert.equal(plain.richOutputs[0].data["text/plain"], "42");
  // 오류·중지·시간 초과는 ok 를 내리고 사람이 읽을 안내를 stderr 에 붙인다.
  const failed = toResult([], { error:{ name:"TypeError", message:"boom", stack:"" } });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /TypeError: boom/);
  assert.match(toResult([], { timedOut:true }).stderr, /끝나지 않아/);
  assert.match(toResult([], { cancelled:true }).stderr, /중지/);
  assert.match(toResult([], { asyncWrapped:true }).stderr, /이어지지 않아요/);
});

test("응답 없는 자바스크립트 커널은 사용자 중지가 아니라 시간 초과로 끝난다", async () => {
  class SilentWorker {
    postMessage(){}
    terminate(){ this.terminated = true; }
  }
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Blob:class Blob {},
    Worker:SilentWorker,
    URL:{ createObjectURL:() => "blob:test", revokeObjectURL:() => {} }
  });
  new vm.Script(runtimeSource, { filename:"js-runtime.js" }).runInContext(context);
  const start = vm.runInContext("startJsKernelRun", context);
  const result = await start({ kernelId:"timeout-test", source:"while (true) {}", timeoutMs:15 }).promise;
  assert.equal(result.ok, false);
  assert.match(result.stderr, /끝나지 않아/);
  assert.doesNotMatch(result.stderr, /실행을 중지/);
});

test("js 편집기는 텍스트 편집기와 같은 자동 저장 계약을 지킨다", () => {
  const editorSource = fs.readFileSync(path.join(root, "src/js/js-editor.js"), "utf8");
  // 설정을 끄면 자동 저장하지 않는다.
  assert.match(editorSource, /!\(appSettings && appSettings\.autoSave\)/);
  // 조용히, 이미 저장 위치가 정해진 문서에만 쓴다(새 문서에 저장 대화상자를 띄우지 않는다).
  assert.match(editorSource, /saveTextDoc\([\s\S]{0,120}\{ silent:true, existingOnly:true \}\)/);
  // 저장 위치가 없어 건너뛴 경우("skipped")를 실패로 알리지 않는다.
  assert.match(editorSource, /ok !== "skipped"/);
  // 마지막 입력을 초안에 먼저 기록한 뒤 종료 표시와 예약 타이머를 정리한다.
  assert.match(editorSource, /persistDraft\(\);\s*disposed = true;[\s\S]{0,160}clearTimeout\(autosaveTimer\)/);
});

test("노트북 언어는 .ipynb metadata 로 가린다", () => {
  const context = vm.createContext({ console, window:{}, document:{}, localStorage:{ getItem:() => null, setItem:() => {} } });
  const modelSource = fs.readFileSync(path.join(root, "src/js/notebook-model.js"), "utf8");
  new vm.Script(modelSource, { filename:"notebook-model.js" }).runInContext(context);
  const languageOf = vm.runInContext("notebookLanguageOf", context);
  assert.equal(languageOf({ metadata:{ kernelspec:{ language:"javascript" } } }), "javascript");
  assert.equal(languageOf({ metadata:{ language_info:{ name:"javascript" } } }), "javascript");
  assert.equal(languageOf({ metadata:{ kernelspec:{ name:"deno" } } }), "javascript");
  assert.equal(languageOf({ metadata:{ kernelspec:{ language:"python" } } }), "python");
  // 표시가 없으면 파이썬 — 이 앱이 만든 노트북과 기존 파일이 모두 파이썬이었다.
  assert.equal(languageOf({ metadata:{} }), "python");
  assert.equal(languageOf(null), "python");
  // 실행할 수 없는 언어를 자바스크립트로 착각하지 않는다.
  assert.equal(languageOf({ metadata:{ kernelspec:{ language:"typescript" } } }), "python");
  assert.equal(languageOf({ metadata:{ kernelspec:{ language:"r" } } }), "python");
});

test("노트북은 자바스크립트 셀을 브라우저 커널로 보내고 파이썬 준비 과정을 건너뛴다", () => {
  const runSource = fs.readFileSync(path.join(root, "src/js/notebook-run.js"), "utf8");
  assert.match(runSource, /const jsNotebook = nbIsJavascript\(ownerDoc\);/);
  // 자바스크립트 노트북에서는 로컬 Python 커널을 고르지 않는다.
  assert.match(runSource, /const localKernel = !jsNotebook && ownerDoc\._nbKernelMode === "local";/);
  // 작업폴더 번들·패키지 준비는 파이썬 전용이라 건너뛴다.
  assert.match(runSource, /if \(!jsNotebook\) try \{/);
  assert.match(runSource, /task = startJsKernelRun\(\{/);
  // 커널 재시작도 언어에 맞는 쪽을 끊는다.
  assert.match(runSource, /function nbResetKernel\(ownerDoc\)\{[\s\S]{0,160}resetJsKernel\(nbKernelId\(ownerDoc\)\)/);
  // 결과 후처리(출력 저장·실행 횟수·상태 표시)는 파이썬과 같은 길을 탄다 — 따로 복제하지 않는다.
  assert.equal(runSource.match(/cell\.rawOutputs = notebookResultToRawOutputs/g).length, 1);
});

test("노트북 셀 편집기·강조는 노트북 언어를 따른다", () => {
  const cellsSource = fs.readFileSync(path.join(root, "src/js/notebook-cells.js"), "utf8");
  assert.match(cellsSource, /const cellProfile = cellLang === "javascript" \? "c" : "python";/);
  assert.doesNotMatch(cellsSource, /highlightCode\(cell\.source, "python"\)/);
  assert.doesNotMatch(cellsSource, /buildCodeEditor\(cell\.source, "python"/);
  // 자바스크립트 노트북에는 로컬 Python 버튼이 뜨지 않는다.
  const toolsSource = fs.readFileSync(path.join(root, "src/js/notebook-tools.js"), "utf8");
  assert.match(toolsSource, /notebookLanguageOf\(ownerDoc\.notebookModel\) === "javascript"[\s\S]{0,240}_nbLocalKernelBtn\.hidden = true/);
});

test("js 편집기는 파이썬 전용 지능을 끄고 자바스크립트 기준으로 완성한다", () => {
  const editorSource = fs.readFileSync(path.join(root, "src/js/js-editor.js"), "utf8");
  // plain 을 넘기지 않으면 파이썬 키워드로 완성하고, 로컬 Python 이 있으면 Jedi(파이썬 분석기)에 물어본다.
  assert.match(editorSource, /plain: true,\s*\n\s*fileExt: ext,\s*\n\s*completionWords,/);
  // 편집기는 목록을 직접 받을 수 있어야 한다.
  const pyEditor = fs.readFileSync(path.join(root, "src/js/python-editor.js"), "utf8");
  assert.match(pyEditor, /Array\.isArray\(options\.completionWords\) \? options\.completionWords : completionWordsForProfile/);
});

test("자동완성 낱말은 이 실행 환경에서 되는 것만 담는다", () => {
  const words = loadRuntime().get("JS_RUN_COMPLETION_WORDS");
  const has = (w) => words.indexOf(w) >= 0;
  // 워커에 없어서 쓰면 오류가 나는 것들은 제안하지 않는다.
  for (const missing of ["document", "window", "require", "module", "exports", "export", "import"]){
    assert.equal(has(missing), false, "실행되지 않는 낱말이 후보에 있다: " + missing);
  }
  // 이 실행 환경이 마련해 둔 것과 흔한 문법·전역은 있어야 한다.
  for (const wanted of ["input", "prompt", "console", "async", "await", "const", "let", "class", "Promise", "JSON", "setTimeout"]){
    assert.equal(has(wanted), true, "빠진 낱말: " + wanted);
  }
});

test("점 뒤 멤버 완성 — 잘 알려진 전역", () => {
  const members = loadRuntime().get("jsMemberCompletionCandidates");
  const names = (source, receiver, prefix) => members(source, receiver, prefix).map((i) => i.name).join(" ");
  assert.equal(names("", "console", "l"), "log");
  assert.equal(names("", "Math", "ra"), "random");
  assert.equal(names("", "JSON", "s"), "stringify");
  assert.equal(names("", "Promise", "res"), "resolve");
  // console. 만 쳤을 때 가장 많이 쓰는 log 가 첫 후보여야 한다(Enter 로 바로 들어가는 자리).
  assert.equal(members("", "console", "")[0].name, "log");
  // 메서드는 function 으로 표시해야 수락할 때 () 가 붙는다.
  assert.equal(members("", "console", "log")[0].type, "function");
  // 워커 console 에 없는 것은 제안하지 않는다.
  assert.equal(names("", "console", "profile"), "");
  // 모르는 이름에는 억지로 후보를 만들지 않는다.
  assert.equal(names("", "document", ""), "");
  assert.equal(names("const x = someUnknown();", "x", "a"), "");
});

test("점 뒤 멤버 완성 — 값의 종류를 글에서 짐작한다", () => {
  const members = loadRuntime().get("jsMemberCompletionCandidates");
  const names = (source, receiver, prefix) => members(source, receiver, prefix).map((i) => i.name).join(" ");
  assert.equal(names("const nums = [1,2,3];", "nums", "pu"), "push");
  assert.equal(names("const name = \"홍길동\";", "name", "toU"), "toUpperCase");
  assert.equal(names("let total = 42;", "total", "toF"), "toFixed");
  assert.equal(names("const m = new Map();", "m", "ge"), "get");
  assert.equal(names("const s = new Set();", "s", "ad"), "add");
  assert.equal(names("const rows = Object.keys(obj);", "rows", "filt"), "filter");
  // 다시 대입했으면 마지막 값이 기준이다.
  assert.equal(names("let v = 1;\nv = \"글자\";", "v", "toU"), "toUpperCase");
});

test("점 뒤 멤버 완성 — 객체 리터럴은 적힌 키를 그대로 쓴다", () => {
  const members = loadRuntime().get("jsMemberCompletionCandidates");
  const names = (source, receiver, prefix) => members(source, receiver, prefix).map((i) => i.name).join(" ");
  assert.equal(names('const student = { name: "홍", score: 90 };', "student", ""), "name score");
  // 중첩 객체의 키는 그 객체 것이므로 섞이지 않는다.
  assert.equal(names("const nested = { a: { b: 1 }, c: 2 };", "nested", ""), "a c");
  // 단축 표기와 메서드도 키로 본다(메서드는 function).
  const shorthand = members("const o = { name, hi(){ return 1 } };", "o", "");
  assert.equal(shorthand.map((i) => i.name).join(" "), "name hi");
  assert.equal(shorthand[1].type, "function");
  // 문자열·주석 안의 콜론에 속지 않는다.
  assert.equal(names('const o = { a: "x: y", /* b: 1 */ c: 2 };', "o", ""), "a c");
});

test("새 자바스크립트 파일은 사이드바 + 메뉴와 폴더 우클릭 양쪽에서 만들 수 있다", () => {
  const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "src/js/app.js"), "utf8");
  const documentsSource = fs.readFileSync(path.join(root, "src/js/documents.js"), "utf8");
  const editorSource = fs.readFileSync(path.join(root, "src/js/js-editor.js"), "utf8");

  // 사이드바 + 메뉴: 항목이 있고, 눌렀을 때 동작하고, 키보드 이동 목록에도 들어간다.
  assert.match(html, /id="sbNewJs"[^>]*role="menuitem"/);
  assert.match(html, /<span>새 자바스크립트 코드<\/span>/);
  assert.match(appSource, /byId\("sbNewJs"\)\.onclick = \(\) => \{ if \(typeof newJsScratch === "function"\) newJsScratch\(\); \}/);
  assert.match(appSource, /byId\("sbNewPy"\), byId\("sbNewJs"\)/);

  // 폴더 우클릭 메뉴
  assert.match(documentsSource, /add\("\+Js  새 자바스크립트 코드"[\s\S]{0,140}newJsScratchInFolder\(node\.newPythonContext\)/);

  // 만드는 길은 파이썬 스크래치와 같은 공용 함수를 쓴다(폴더 문맥·이름 충돌 회피를 그대로 물려받는다).
  assert.match(editorSource, /createScratchInFolder\(folder, jsScratchFileName, jsScratchStarter,\s*\n?\s*"text\/javascript"/);
  assert.match(editorSource, /function newJsScratch\(\)\{[\s\S]{0,320}activeFolderContextForNewFile\(\)/);
  assert.match(editorSource, /base \+ \(number > 1 \? " " \+ number : ""\) \+ "\.js"/);
});

test("미저장 새 자바스크립트 파일도 자동복원 작업공간에 바탕 문서를 남긴다", () => {
  const editorSource = fs.readFileSync(path.join(root, "src/js/js-editor.js"), "utf8");
  const codeViewer = fs.readFileSync(path.join(root, "src/js/code-viewer.js"), "utf8");

  // 최상위 새 JS는 일반 파일과 같은 queueFiles 경로에서 열기 뒤 rememberWorkspace까지 수행한다.
  assert.match(editorSource,
    /function newJsScratch\(\)\{[\s\S]{0,500}typeof queueFiles === "function"[\s\S]{0,120}queueFiles\(\[file\], \{ isScratch:true \}\)/);
  // 폴더 안 새 파일은 즉시 렌더를 유지하면서 별도 스냅샷을 저장하고, 이름 변경 시 예전 경로를 교체한다.
  assert.match(codeViewer,
    /async function rememberScratchWorkspaceFile\([\s\S]{0,900}rememberWorkspace\(\[snapshot\], false, \{ silent:true \}\)/);
  assert.match(codeViewer,
    /rememberScratchWorkspaceFile\(target, file\)/);
  assert.match(codeViewer,
    /rememberScratchWorkspaceFile\(ownerDoc, ownerDoc\.sourceFile, oldPath\)/);
});

test("새 파일 메뉴 문구는 영어 번역이 함께 있다", () => {
  const i18n = fs.readFileSync(path.join(root, "src/js/i18n.js"), "utf8");
  for (const key of ["새 자바스크립트 코드", "+Js  새 자바스크립트 코드", "여기에 자바스크립트 코드를 작성하고 ▶ 실행"]){
    assert.ok(i18n.includes('"' + key + '":'), "번역 누락: " + key);
  }
});

test("code-viewer 는 언어 판별로 실행 바를 붙이고 js 는 전용 화면으로 넘긴다", () => {
  const codeViewer = fs.readFileSync(path.join(root, "src/js/code-viewer.js"), "utf8");
  assert.match(codeViewer, /const extRunLang = definitionSource \? null : runLangForExt\(ext\);/);
  assert.match(codeViewer, /const runnable = !!runLang;/);
  assert.match(codeViewer, /if \(runLang === "js"\)\{\s*\n\s*renderJsRunnable\(/);
  // 압축된 라이브러리(.min.js)나 아주 큰 .java 는 실행 화면이 아니라 기존 코드 보기로 흘려보낸다.
  assert.match(codeViewer, /const runLang = \(\(extRunLang === "js" \|\| extRunLang === "java"\) && \(heavy \|\| lightEdit\)\)/);
  // 파이썬은 이 규칙에서 빼 둔다 — 기존 동작을 바꾸지 않는다.
  assert.doesNotMatch(codeViewer, /extRunLang === "python" && \(heavy/);
});
