// 재계산이 표 목록을 만드는 횟수.
//
// getAst 는 표 참조([@열] 같은 것)를 펼치려고 "시트별 표 목록"을 쓴다. 예전에는 부를 때마다 새로
// 만들었고, astCache 를 보기 '전에' 만들어서 캐시가 맞아도 그 비용은 매번 냈다. recalcAll 은 수식
// 셀 하나마다 getAst 를 부르므로 수식 1만 개면 이 객체를 1만 번 만들었다.
//
// 고치는 방법은 두 가지였다. (1) 전역으로 기억해 두고 표가 바뀔 때 무효화하거나,
// (2) 재계산 한 번 도는 동안만 붙잡거나. worksheetViews 를 건드리는 곳이 20군데가 넘어 (1)은
// 무효화를 한 곳만 빠뜨려도 '낡은 표로 계산'이 된다 - 조용히 틀린 값이 나오는 종류다.
// recalcAll 은 중간에 await 가 없어 도는 동안 표가 바뀔 수 없으므로 (2)를 골랐다.
// 이 테스트는 그 선택이 유지되는지 본다 - 무효화 지점이 하나도 없어야 안전하다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const T = require("../src/js/spreadsheet-tools.js");

const source = fs.readFileSync(path.join(__dirname, "../src/js/spreadsheet-viewer.js"), "utf8");

test("표 목록은 재계산 한 번에 한 번만 만든다", () => {
  // 캐시가 맞아도 매번 새로 만들던 자리가 사라졌다.
  assert.ok(!/const tables=Object\.fromEntries\(Object\.entries\(worksheetViews\)/.test(source),
    "getAst 안에서 표 목록을 매번 새로 만들면 안 된다");
  assert.match(source, /const tables=recalcTables \|\| sheetTablesSnapshot\(\);/);

  // 재계산은 시작할 때 한 번 붙잡고, 끝나면 반드시 놓는다.
  const recalc = source.slice(source.indexOf("const recalcAll = () => {"), source.indexOf("const maybeRecalc"));
  assert.match(recalc, /recalcTables = sheetTablesSnapshot\(\);\s*\n\s*try \{/);
  assert.match(recalc, /\} finally \{ recalcTables = null; \}/);
});

test("붙잡는 곳은 재계산 한 곳뿐이라 무효화할 자리가 없다", () => {
  // recalcTables 에 값을 넣는 곳이 늘면 "언제 낡는가"를 따져야 한다. 지금은 따질 필요가 없다.
  const writes = source.match(/recalcTables = (?!null)/g) || [];
  assert.equal(writes.length, 1, "recalcTables 를 채우는 곳은 recalcAll 하나여야 한다");
  // 놓아 주는 곳은 finally 하나뿐(선언 `let recalcTables = null;` 은 세지 않는다).
  const clears = source.match(/(?<!let )recalcTables = null/g) || [];
  assert.equal(clears.length, 1, "놓아 주는 곳도 하나여야 한다(반드시 finally 안에서)");

  // 재계산 밖에서는 붙잡지 않으므로 그때그때 새로 만든다 - 표를 고친 직후 편집해도 바로 반영된다.
  assert.match(source, /let recalcTables = null;/);
});

test("재계산 도중 오류가 나도 표 목록을 놓아 준다", () => {
  // 놓지 않으면 다음 계산이 낡은 표를 쓴다. try/finally 가 아니라 그냥 나열하면 이 성질이 깨진다.
  const recalc = source.slice(source.indexOf("const recalcAll = () => {"), source.indexOf("const maybeRecalc"));
  const tryAt = recalc.indexOf("try {");
  const loopAt = recalc.indexOf("Object.keys(exModels).forEach");
  const finallyAt = recalc.indexOf("} finally { recalcTables = null; }");
  assert.ok(tryAt > 0 && loopAt > tryAt && finallyAt > loopAt,
    "수식 셀을 도는 반복문 전체가 try/finally 안에 있어야 한다");
});

test("붙잡아 둔 표 목록으로도 표 참조가 그대로 펼쳐진다", () => {
  // recalcAll 이 한 번 만들어 돌려쓰는 객체는 expandReferences 가 읽기만 하는 모양이어야 한다.
  // (읽는 쪽이 고치면 두 번째 수식부터 다른 결과가 나온다.)
  // xlsx-compatibility.test.js 와 같은 표 하나(머리글 1줄 + 자료 3줄)를 쓴다.
  const tables = { Data:[{ name:"Table1", columns:["Name","Score"],
    range:{ s:{ r:0, c:0 }, e:{ r:3, c:1 } }, headerRow:true }] };
  const frozen = JSON.stringify(tables);

  assert.equal(T.expandReferences("SUM(Table1[Score])", "Report", 0, tables), "SUM('Data'!$B$2:$B$4)");
  assert.equal(T.expandReferences("[@Score]*2", "Data", 2, tables), "'Data'!$B3*2");
  // 같은 객체를 다시 넘겨도 첫 번째와 똑같이 나온다.
  assert.equal(T.expandReferences("SUM(Table1[Score])", "Report", 0, tables), "SUM('Data'!$B$2:$B$4)");
  assert.equal(JSON.stringify(tables), frozen, "expandReferences 는 표 목록을 고치면 안 된다");
});
