"use strict";

/* CSV·엑셀 → 테이블 적재.
   값이 어떻게 해석되는지가 이 기능의 전부라 순수 함수를 직접 돌려 보고,
   프런트가 싣는 차례와 런처가 읽는 차례는 소스를 나란히 놓고 본다
   (어긋나도 오류가 나지 않고 값이 옆 컬럼으로 들어간다 — /db-apply · /db-dump 와 같은 함정이다). */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const launcher = fs.readFileSync(path.join(root, "desktop", "launcher.cs"), "utf8");
const worker = fs.readFileSync(path.join(root, "desktop", "db_worker.py"), "utf8");
const clientSource = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
const importSource = fs.readFileSync(path.join(root, "src", "js", "db-import.js"), "utf8");
const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));

global.MNDataConvert = require("../src/js/data-convert.js");
const dbImport = require("../src/js/db-import.js");

// 함수 하나만 떼어 본다. 다음 static 선언까지 자르므로 런처에 다른 함수가 끼어들어도 흔들리지 않는다.
const launcherFunction = (name) => {
  const at = launcher.indexOf("static string " + name + "(");
  assert.ok(at >= 0, name + " 를 찾지 못했다");
  const next = launcher.indexOf("\n    static ", at + 1);
  return launcher.slice(at, next < 0 ? launcher.length : next);
};

const column = (name, extra) => Object.assign({ name, type: "varchar(50)", nullable: true, default: null, extra: "" }, extra);

test("구분자는 첫 줄들에서 가장 많이 나온 것으로 고른다", () => {
  assert.equal(dbImport.guessDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(dbImport.guessDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(dbImport.guessDelimiter("a;b;c\n1;2;3"), ";");
  // 구분자가 하나도 없으면 쉼표로 둔다(한 열짜리 파일).
  assert.equal(dbImport.guessDelimiter("한 줄뿐"), ",");
});

test("컬럼 맞대기는 이름으로만 하고 자리 순서로 넘겨짚지 않는다", () => {
  const columns = [column("id"), column("user_name"), column("grade")];
  // 대소문자·공백·밑줄만 다른 머리글은 같은 것으로 본다.
  assert.deepEqual(dbImport.autoMapping(columns, ["User Name", "grade", "비고"]), [-1, 0, 1]);
  // 이름이 하나도 맞지 않으면 전부 '넣지 않음'이다 — 열 순서가 우연히 맞는 파일보다 어긋난 파일이 많다.
  assert.deepEqual(dbImport.autoMapping(columns, ["가", "나", "다"]), [-1, -1, -1]);
  // 같은 머리글이 두 번 나와도 한 열을 두 컬럼이 나눠 가지지 않는다.
  assert.deepEqual(dbImport.autoMapping([column("grade"), column("grade2")], ["grade", "grade"]), [0, -1]);
});

test("빈 칸의 기본은 NULL 이고 NULL 표기는 따로 정한다", () => {
  assert.deepEqual(dbImport.cellFor("", {}), { value: "", isNull: true });
  assert.deepEqual(dbImport.cellFor("", { nullOnEmpty: false }), { value: "", isNull: false });
  assert.deepEqual(dbImport.cellFor("\\N", { nullToken: "\\N" }), { value: "", isNull: true });
  // 'NULL' 이라고 적힌 글자는 마법이 아니다. 표기를 지정하지 않으면 글자 그대로 들어간다.
  assert.deepEqual(dbImport.cellFor("NULL", {}), { value: "NULL", isNull: false });
  // 숫자·날짜는 손대지 않는다. 서버가 컬럼 자료형으로 바꾸다 실패하면 그 행을 알려 준다.
  assert.deepEqual(dbImport.cellFor("1,234", {}), { value: "1,234", isNull: false });
  assert.deepEqual(dbImport.cellFor("2026-09-02", {}), { value: "2026-09-02", isNull: false });
});

test("엑셀 날짜는 숫자가 아니라 MySQL 이 읽는 글자로 굳힌다", () => {
  assert.equal(dbImport.sheetCellText(new Date(2026, 8, 2)), "2026-09-02");
  assert.equal(dbImport.sheetCellText(new Date(2026, 8, 2, 13, 5, 9)), "2026-09-02 13:05:09");
  assert.equal(dbImport.sheetCellText(true), "1");
  assert.equal(dbImport.sheetCellText(1234.5), "1234.5");
  assert.equal(dbImport.sheetCellText(null), "");
});

test("적재 계획은 머리글·빈 줄을 걸러 내고 파일 줄 번호를 함께 들고 있다", () => {
  const grid = [["이름", "학년"], ["홍길동", "1"], ["", ""], ["김철수", ""]];
  const columns = [column("name", { nullable: false }), column("grade")];
  const plan = dbImport.importPlan(grid, columns, [0, 1], { header: true });
  assert.deepEqual(plan.columns, ["name", "grade"]);
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.blank, 1);
  // 빈 줄을 건너뛰므로 행 번호와 파일 줄 번호가 어긋난다. 실패 안내에 쓸 줄 번호를 따로 들고 있어야 한다.
  assert.deepEqual(plan.sourceLines, [2, 4]);
  assert.deepEqual(plan.rows[1], [{ value: "김철수", isNull: false }, { value: "", isNull: true }]);
  assert.deepEqual(plan.blocking, []);
  assert.ok(plan.warnings.some(note => /빈 줄 1개/.test(note)));
});

test("보내면 서버가 되돌릴 것들은 보내기 전에 막는다", () => {
  const grid = [["이름"], ["홍길동"], [""]];
  const notNull = [column("name", { nullable: false })];
  // NOT NULL 컬럼에 빈 칸 → 서버가 전부 되돌린다. 10,000행을 보낸 뒤에 알면 늦다.
  // (칸이 전부 빈 줄은 '빈 줄'로 건너뛰므로, 다른 칸에는 값이 있는 행으로 본다.)
  const blocked = dbImport.importPlan([["이름", "학년"], ["", "1"]],
    [column("name", { nullable: false }), column("grade")], [0, 1], { header: true });
  assert.ok(blocked.blocking.some(note => /NULL 을 받지 않는 컬럼/.test(note)));
  // 같은 파일이라도 빈 칸을 빈 문자열로 두면 막지 않는다(그 값이 뜻이 있을 수 있다).
  assert.deepEqual(dbImport.importPlan([["이름", "학년"], ["", "1"]],
    [column("name", { nullable: false }), column("grade")], [0, 1],
    { header: true, nullOnEmpty: false }).blocking, []);
  // 값을 꼭 넣어야 하는 컬럼을 고르지 않았다.
  const required = dbImport.importPlan(grid, [column("name", { nullable: false }), column("code", { nullable: false })],
    [0, -1], { header: true });
  assert.ok(required.blocking.some(note => /code 은 값을 꼭 넣어야/.test(note)));
  // 넣을 컬럼이 하나도 없거나 넣을 행이 없다.
  assert.ok(dbImport.importPlan(grid, notNull, [-1], { header: true }).blocking.length);
  assert.ok(dbImport.importPlan([["이름"]], notNull, [0], { header: true })
    .blocking.some(note => /넣을 행이 없습니다/.test(note)));
});

test("행·칸 상한을 넘으면 앞부분만 넣지 않고 나눠 달라고 말한다", () => {
  const columns = [column("name")];
  const grid = [["이름"]];
  for (let index = 0; index <= dbImport.MAX_ROWS; index++) grid.push(["값" + index]);
  const plan = dbImport.importPlan(grid, columns, [0], { header: true });
  assert.ok(plan.blocking.some(note => /행까지입니다/.test(note) && /나누거나/.test(note)));
  assert.equal(dbImport.MAX_ROWS, 10000);
  // 워커·런처와 같은 값이어야 한다. 한쪽만 늘리면 화면은 보내고 서버가 거절한다.
  assert.match(worker, /MAX_IMPORT_ROWS = 10000/);
  assert.match(worker, /MAX_IMPORT_CELLS = 100000/);
  assert.match(launcher, /const int MaxDbImportRows = 10000;/);
  assert.match(launcher, /const int MaxDbImportCells = 100000;/);
  // 파일은 일부 열만 고를 수 있어 20MB까지 읽되, 실제 요청은 런처의 8MB 한도를 미리 검사한다.
  assert.equal(dbImport.MAX_REQUEST_BYTES, 8 * 1024 * 1024);
  assert.match(launcher, /const int MaxDbImportBytes = 8 \* 1024 \* 1024;/);
  assert.match(importSource, /payload\.byteLength > MAX_REQUEST_BYTES/);
});

test("적재 요청 값의 순서는 프런트와 런처가 같다", () => {
  const values = dbImport.requestValues({
    database: "school", table: "students", mode: "ignore",
    columns: ["name", "grade"],
    rows: [[{ value: "홍길동", isNull: false }, { value: "", isNull: true }]]
  });
  assert.deepEqual(values,
    ["school", "students", "ignore", "2", "name", "grade", "1", "홍길동", "0", "", "1"]);

  // 런처가 읽는 차례: database → table → mode → 컬럼 수 → 컬럼 → 행 수 → (값, NULL) × 컬럼
  const body = launcherFunction("StartDbImport");
  const order = [...body.matchAll(/ReadBundleString\(body, ref pos\)/g)].length;
  assert.ok(order >= 6, "런처가 읽는 자리가 모자라면 순서가 어긋난 것이다");
  assert.match(body, /DbCheckField\(ReadBundleString\(body, ref pos\), "database", 64, true\)[\s\S]{0,200}?"table", 128, false\)/);
  assert.match(body, /string mode = ReadBundleString\(body, ref pos\);/);
  assert.match(body, /out columnCount\)[\s\S]{0,400}?DbCheckField\(ReadBundleString\(body, ref pos\), "column", 128, false\)/);
  assert.match(body, /out rowCount\)[\s\S]{0,600}?string value = ReadBundleString\(body, ref pos\);\s*\n\s*string isNull = ReadBundleString\(body, ref pos\);/);
  // NULL 은 JSON null 로 간다 — 빈 문자열과 확실히 갈라야 두 값이 섞이지 않는다.
  assert.match(body, /isNull == "1" \? "null" : JsonString\(value\)/);
  // 본문을 다 읽었는지 확인한다(남으면 순서가 어긋난 것이다).
  assert.match(body, /if \(pos != body\.Length\) throw new Exception\("bad-db-request"\);/);
});

test("런처는 SQL 을 만들지 않고 아는 모드만 워커에 넘긴다", () => {
  const body = launcherFunction("StartDbImport");
  assert.match(body, /mode != "insert" && mode != "ignore" && mode != "update"/);
  assert.match(body, /\{\\"action\\":\\"import-rows\\"/);
  assert.ok(!/INSERT INTO/.test(body), "런처가 INSERT 문을 만들면 안 된다");
  assert.match(body, /body\.Length > MaxDbImportBytes/);
  // 적재도 덤프와 같은 작업 목록에 들어가 폴링·취소 경로를 함께 쓴다.
  assert.match(launcher, /path\.StartsWith\("\/db-import\?", StringComparison\.Ordinal\)/);
  assert.match(importSource, /\/db-query-poll\?job=/);
  assert.match(importSource, /\/db-query-cancel\?job=/);
});

test("워커만 INSERT 문을 만들고 값은 자리표시자로만 나간다", () => {
  const body = worker.slice(worker.indexOf("def import_sql"), worker.indexOf("def tx_state"));
  assert.match(body, /"INSERT IGNORE INTO " if mode == "ignore" else "INSERT INTO "/);
  assert.match(body, /ON DUPLICATE KEY UPDATE/);
  // 이름은 전부 인용하고 값은 %s 로만 간다.
  assert.match(body, /names = \[quote_identifier\(name\) for name in columns\]/);
  assert.match(body, /", "\.join\(\["%s"\] \* len\(names\)\)/);
  assert.ok(!/\+ str\(value\)/.test(body), "값이 문장에 붙으면 안 된다");
  // REPLACE 는 DELETE + INSERT 라 자식 행을 말없이 지운다. 넣지 않는다.
  assert.ok(!/REPLACE INTO/.test(body), "REPLACE 는 적재 모드에 없어야 한다");
  assert.deepEqual(dbImport.MODES.map(mode => mode.value), ["insert", "ignore", "update"]);
  assert.match(worker, /IMPORT_MODES = \("insert", "ignore", "update"\)/);
});

test("적재는 읽기 전용에서 막히고 실패·취소하면 통째로 되돌린다", () => {
  const body = worker.slice(worker.indexOf("def import_rows"), worker.indexOf("def tx_state"));
  // 판정 이전에 잠근다(쿼리 경로에만 걸어 두면 적재가 뒷문이 된다).
  assert.match(body, /if _state\["read_only"\]:\s*\n\s*return \{"ok": False, "code": "read-only-blocked"/);
  // 수동 커밋 모드에서 connection.rollback() 을 부르면 사용자가 쌓아 둔 변경까지 사라진다.
  assert.match(body, /cursor\.execute\("SAVEPOINT classdock_import"\)/);
  assert.match(body, /cursor\.execute\("ROLLBACK TO SAVEPOINT classdock_import"\)/);
  assert.match(body, /connection\.rollback\(\)/);
  // 취소는 청크 전·실행 오류 뒤·마지막 청크와 COMMIT 사이에서 모두 잡는다.
  assert.ok([...body.matchAll(/if import_cancelled\(\):\s*\n\s*raise ImportCancelled\(\)/g)].length >= 3);
  assert.match(worker, /cancel_running_import\(\)\s+# 적재는 청크 사이에서 멈춘다/);
  // 청크마다 세이브포인트를 잡아야 실패한 행을 짚을 때 멀쩡한 행이 중복 키로 걸리지 않는다.
  assert.match(body, /cursor\.execute\("SAVEPOINT classdock_chunk"\)/);
  assert.match(body, /cursor\.execute\("ROLLBACK TO SAVEPOINT classdock_chunk"\)[\s\S]{0,400}?find_failing_row/);
  // 실패한 행 번호를 응답에 실어 화면이 파일 줄 번호로 옮길 수 있게 한다.
  assert.match(body, /failure\["row"\] = exc\.row/);
  assert.match(importSource, /plan\.sourceLines\[info\.row\]/);
});

test("적재 창은 파서를 새로 만들지 않고 앱에 있는 것을 쓴다", () => {
  // 앱 안의 네 번째 CSV 파서를 만들지 않는다.
  assert.match(importSource, /convert\.parseDelimited\(decoded\.text, delimiter\)/);
  assert.equal(typeof MNDataConvert.parseDelimited, "function");
  // 한글 CSV 는 CP949 가 흔하다. .sql 가져오기가 쓰는 판정기를 그대로 쓴다.
  assert.match(importSource, /typeof detectTextEncoding === "function"/);
  // 엑셀은 지연 로딩(xlsx) 뒤에만 읽는다.
  assert.match(importSource, /MNLazy\.tryNeed\("xlsx"\)/);
  assert.match(importSource, /XLSX\.read\(bytes, \{ type:"array", cellDates:true \}\)/);
});

test("적재 진입점은 툴바와 두 우클릭 메뉴이고 읽기 전용에서는 잠긴다", () => {
  assert.match(clientSource, /const openImportModal = \(target\) =>/);
  assert.match(clientSource, /if \(readOnly\)\{\s*\n\s*toast\("읽기 전용 접속입니다\. 데이터를 넣으려면/);
  assert.match(clientSource, /importDataButton\.addEventListener\("click"/);
  // 트리 메뉴는 테이블에만 붙는다 — 뷰에 행을 넣는 항목이 있으면 메뉴가 거짓말을 한다.
  assert.match(clientSource, /const importName = item\.type === "table" \? item\.name/);
  assert.match(clientSource, /importItem\.disabled = readOnly/);
  // 결과 표 메뉴에서도 지금 보고 있는 테이블로 바로 연다.
  assert.match(clientSource, /item\("table", "CSV·엑셀 적재", "", \(\) => openImportModal\(plan\.table\)/);
  // 넣고 나면 트랜잭션 상태를 먼저 반영하고 그 테이블을 열어 준다.
  assert.match(clientSource, /onImported: \(name, info\) => \{[\s\S]{0,300}?applyTxState\(info\);[\s\S]{0,100}?showTable\(name\);/);
});

test("늦게 온 테이블·파일 응답은 현재 선택을 덮지 않는다", () => {
  assert.match(importSource, /const generation = \+\+tableLoadGeneration;/);
  assert.match(importSource, /generation !== tableLoadGeneration \|\| table !== requestedTable/);
  assert.match(importSource, /const generation = \+\+fileReadGeneration;/);
  assert.match(importSource, /generation !== fileReadGeneration \|\| file !== picked/);
});

test("적재 모듈은 스크립트 목록과 의존성 표에 등록된다", () => {
  assert.ok(manifest.localScripts.includes("db-import.js"));
  assert.deepEqual(manifest.scriptDependencies["db-import.js"], ["db-client.js", "data-convert.js", "lazy.js"]);
  // db-client.js 뒤에 실려야 MNDbClient.encodeStrings 를 쓸 수 있다.
  assert.ok(manifest.localScripts.indexOf("db-import.js") > manifest.localScripts.indexOf("db-client.js"));
  assert.ok(manifest.localScripts.indexOf("db-import.js") > manifest.localScripts.indexOf("data-convert.js"));
  assert.match(html, /<script src="src\/js\/db-import\.js"><\/script>/);
});
