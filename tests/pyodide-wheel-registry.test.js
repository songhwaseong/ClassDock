"use strict";

// 번들 파이썬 휠 등록부는 시작할 때 실행되지 않는 JSON 블록에 있고, 처음 필요할 때 한 번만 읽힌다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "src/js/python-runtime.js"), "utf8");
const build = fs.readFileSync(path.join(root, "build-offline.js"), "utf8");

function loadRegistry(holder){
  const start = runtime.indexOf("let _bundledPyodideWheels = null;");
  const end = runtime.indexOf("function decodeBundledPyodideWheel(");
  assert.ok(start > 0 && end > start, "registry block not found");
  const lookups = { count:0 };
  const context = vm.createContext({
    JSON, console:{ warn(){} },
    document:{ getElementById(id){ lookups.count++; return id === "mnPyodideWheels" ? holder : null; } }
  });
  vm.runInContext(runtime.slice(start, end) + "\nglobalThis.read = bundledPyodideWheelRegistry;", context);
  return { read:context.read, lookups };
}

test("휠 등록부 JSON 블록은 처음 한 번만 읽고 결과를 재사용한다", () => {
  let reads = 0;
  const holder = { get textContent(){ reads++; return JSON.stringify({ faker:{ packageName:"Faker", fileName:"faker.whl", base64:"UEsDBA==" } }); } };
  const { read, lookups } = loadRegistry(holder);
  assert.equal(read().faker.packageName, "Faker");
  assert.equal(read().faker.fileName, "faker.whl");
  assert.equal(reads, 1);
  assert.equal(lookups.count, 1);
});

test("블록이 없거나 깨져도 빈 등록부로 넘어가 온라인 설치 갈래를 막지 않는다", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(loadRegistry(null).read())), {});
  assert.deepEqual(JSON.parse(JSON.stringify(loadRegistry({ textContent:"{broken" }).read())), {});
});

test("빌드는 휠을 실행되는 전역 변수가 아니라 JSON 블록으로 심는다", () => {
  assert.match(build, /<script type="application\/json" id="mnPyodideWheels">\$\{esc\(JSON\.stringify\(bundledWheelRegistry\)\)\}<\/script>/);
  assert.ok(!build.includes("window.__MN_PYODIDE_WHEELS__="), "실행되는 휠 등록부가 되살아났다");
  assert.ok(!runtime.includes("__MN_PYODIDE_WHEELS__"), "런타임이 옛 전역 변수를 읽고 있다");
});
