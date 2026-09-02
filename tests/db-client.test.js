"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const launcher = fs.readFileSync(path.join(root, "desktop", "launcher.cs"), "utf8");
const worker = fs.readFileSync(path.join(root, "desktop", "db_worker.py"), "utf8");
const html = fs.readFileSync(path.join(root, "classdock.html"), "utf8");
const build = fs.readFileSync(path.join(root, "desktop", "build.bat"), "utf8");
const buildDotnet = fs.readFileSync(path.join(root, "desktop", "build-dotnet.bat"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
const client = require("../src/js/db-client.js");

// 세미콜론 나누기는 프런트(확인 창)와 워커(실행 단위) 양쪽에 있다. 두 구현이 갈라지면
// "확인 창에서 본 문장"과 "실제로 실행되는 문장"이 달라지므로 같은 입력으로 함께 검사한다.
const SPLIT_CASES = [
  ["SELECT 1; SELECT 2", ["SELECT 1", "SELECT 2"]],
  ["SELECT ';' AS a; SELECT 2", ["SELECT ';' AS a", "SELECT 2"]],
  ["SELECT `we;ird`; SELECT 2", ["SELECT `we;ird`", "SELECT 2"]],
  ["SELECT 'a\\'; b' ; SELECT 2", ["SELECT 'a\\'; b'", "SELECT 2"]],
  ["SELECT 'a''; b'; SELECT 2", ["SELECT 'a''; b'", "SELECT 2"]],
  ["-- c; comment\nSELECT 1", ["-- c; comment\nSELECT 1"]],
  ["SELECT 1 /* ; */ ;", ["SELECT 1 /* ; */"]],
  ["/*!40101 SET x=1 */; SELECT 1", ["/*!40101 SET x=1 */", "SELECT 1"]],
  ["DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND$$\nDELIMITER ;\nCALL p();",
    ["CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND", "CALL p()"]],
  ["  delimiter //\nCREATE FUNCTION f() RETURNS varchar(20)\nBEGIN\n  RETURN '//;still text'; /* // */\nEND//\nDELIMITER ;",
    ["CREATE FUNCTION f() RETURNS varchar(20)\nBEGIN\n  RETURN '//;still text'; /* // */\nEND"]],
  ["  ;;  ", []]
];

test("접속 문서는 비밀번호를 직렬화하지 않는다", () => {
  const profile = client.parseProfile(JSON.stringify({
    host: "db.example.org", port: 3307, database: "school", user: "teacher",
    readOnly: false, sql: "SELECT 1", password: "hunter2", passwd: "hunter2"
  }));
  assert.equal(profile.host, "db.example.org");
  assert.equal(profile.port, 3307);
  assert.equal(profile.readOnly, false);
  const text = client.serializeProfile(profile);
  assert.ok(!/hunter2/.test(text), "저장 내용에 비밀번호가 들어가면 안 된다");
  assert.ok(!/password|passwd/i.test(text), "저장 내용에 비밀번호 필드가 있으면 안 된다");
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(),
    ["autoCommit", "classdock", "color", "database", "driver", "host", "port", "readOnly", "sql", "user", "version"]);
});

test("자동 커밋은 기본으로 켜져 있고 끈 상태만 문서에 남는다", () => {
  assert.equal(client.parseProfile("{}").autoCommit, true, "자동 커밋이 기본값이어야 한다");
  assert.equal(client.parseProfile(JSON.stringify({ autoCommit: false })).autoCommit, false);
  // 아는 값이 아니면 기본값(켜짐)으로 둔다 — 모르는 값 때문에 수동 커밋에 갇히면 안 된다.
  assert.equal(client.parseProfile(JSON.stringify({ autoCommit: "no" })).autoCommit, true);
  const manual = client.parseProfile(JSON.stringify({ autoCommit: false }));
  assert.equal(JSON.parse(client.serializeProfile(manual)).autoCommit, false);
});

test("잘못된 접속 문서는 기본값으로 안전하게 읽힌다", () => {
  const profile = client.parseProfile("{}");
  assert.equal(profile.port, 3306);
  assert.equal(profile.readOnly, true, "읽기 전용이 기본값이어야 한다");
  assert.equal(client.parseProfile(JSON.stringify({ port: 999999 })).port, 65535);
  assert.equal(client.parseProfile(JSON.stringify({ port: 0 })).port, 1);
});

test("접속 표시색은 아는 값만 받아들인다", () => {
  assert.equal(client.parseProfile(JSON.stringify({ color: "red" })).color, "red");
  assert.equal(client.parseProfile(JSON.stringify({ color: "chartreuse" })).color, "");
  // 색 이름이 그대로 CSS 선택자에 쓰이므로 임의 문자열이 들어오면 안 된다.
  assert.equal(client.parseProfile(JSON.stringify({ color: "red; --x:y" })).color, "");
});

test("문장 범위는 원문에서의 위치를 그대로 가리킨다", () => {
  const sql = "SELECT 1;\n\nSELECT 2;\n";
  const ranges = client.statementRanges(sql);
  assert.equal(ranges.length, 2);
  for (const range of ranges) {
    assert.equal(sql.slice(range.start, range.end), range.text, "범위가 본문과 어긋나면 안 된다");
  }
  assert.equal(ranges[0].text, "SELECT 1");
  assert.equal(ranges[1].text, "SELECT 2");
  // 잘라 낸 문자열 목록은 예전 계약 그대로여야 한다(워커와 맞춘 검사가 여기 걸려 있다).
  assert.deepEqual(client.splitStatements(sql), ["SELECT 1", "SELECT 2"]);
});

test("커서가 놓인 문장을 고른다", () => {
  const sql = "SELECT 1;\n\nSELECT 2;\n\nSELECT 3";
  const at = (cursor) => (client.statementAt(sql, cursor) || {}).text;
  assert.equal(at(0), "SELECT 1", "첫 문장 맨 앞");
  assert.equal(at(8), "SELECT 1", "첫 문장 끝");
  assert.equal(at(sql.indexOf("SELECT 2") + 3), "SELECT 2", "문장 한가운데");
  assert.equal(at(sql.indexOf("SELECT 2") - 1), "SELECT 1", "문장 사이 빈 줄이면 바로 앞 문장");
  assert.equal(at(sql.length), "SELECT 3", "맨 끝은 마지막 문장");
  assert.equal(at(99999), "SELECT 3", "범위를 넘겨도 마지막 문장");
  assert.equal(client.statementAt("   ", 1), null, "실행할 문장이 없으면 null");
  // 세미콜론 뒤 공백에 커서가 있으면 직전 문장을 실행한다(방금 친 문장을 그대로 실행하는 흐름).
  assert.equal(at(sql.indexOf("SELECT 2") + "SELECT 2;".length), "SELECT 2");
});

test("커서 문장 고르기는 따옴표 안의 세미콜론에 속지 않는다", () => {
  const sql = "SELECT 'a;b' AS x;\nSELECT 2";
  assert.equal((client.statementAt(sql, 10) || {}).text, "SELECT 'a;b' AS x");
});

test("SQL 문장 나누기는 따옴표·역따옴표·주석 안의 세미콜론을 구분자로 보지 않는다", () => {
  for (const [sql, expected] of SPLIT_CASES) {
    assert.deepEqual(client.splitStatements(sql), expected, sql);
  }
});

test("DELIMITER 복합문은 지시어를 빼고 CREATE 전체를 한 문장으로 고른다", () => {
  const sql = "-- routine\nDELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n SELECT 1;\n SELECT 2;\nEND$$\nDELIMITER ;\nSELECT 3;";
  const ranges = client.statementRanges(sql);
  assert.equal(ranges.length, 2);
  assert.match(ranges[0].text, /^CREATE PROCEDURE[\s\S]*SELECT 2;\nEND$/);
  assert.equal(ranges[0].line, 3);
  assert.equal(ranges[0].delimiter, "$$");
  assert.equal((client.statementAt(sql, sql.indexOf("SELECT 2")) || {}).text, ranges[0].text);
  assert.equal(ranges[1].text, "SELECT 3");

  const wrapped = client.compoundExecutionScript(ranges[0].text, ranges[0].delimiter);
  assert.match(wrapped, /^DELIMITER \$\$/);
  assert.deepEqual(client.splitStatements(wrapped), [ranges[0].text],
    "커서 실행용으로 잘라 낸 루틴도 워커에서 다시 쪼개지면 안 된다");
});

test("선택한 CREATE 복합문은 DELIMITER가 없어도 자동으로 감싸고 일반 SQL은 건드리지 않는다", () => {
  const routine = "CREATE FUNCTION answer() RETURNS INT\nBEGIN\n RETURN 42;\nEND";
  const wrapped = client.compoundExecutionScript(routine);
  assert.match(wrapped, /^DELIMITER /);
  assert.deepEqual(client.splitStatements(wrapped), [routine]);
  assert.equal(client.compoundExecutionScript("SELECT 1; SELECT 2;"), "SELECT 1; SELECT 2;");
});

test("루틴 교체 스크립트는 DROP과 SHOW CREATE 정의를 같은 DELIMITER로 감싼다", () => {
  const script = client.routineEditScript({ type:"procedure", name:"find student" },
    "CREATE DEFINER=`root`@`%` PROCEDURE `find student`()\nBEGIN\n SELECT 1;\nEND", "school");
  assert.match(script, /^DELIMITER \$\$/);
  assert.match(script, /DROP PROCEDURE IF EXISTS `school`\.`find student`\$\$/);
  assert.match(script, /BEGIN\n SELECT 1;\nEND\$\$/);
  assert.match(script, /DELIMITER ;$/);
  assert.equal(client.splitStatements(script).length, 2, "DROP과 CREATE 두 문장이어야 한다");
});

test("스키마 트리 삭제 SQL은 객체 종류별 문법과 식별자 인용을 지킨다", () => {
  assert.equal(client.schemaDropSql({ type:"table", name:"order" }, "school-db"),
    "DROP TABLE `school-db`.`order`;");
  assert.equal(client.schemaDropSql({ type:"view", name:"student view" }, "school"),
    "DROP VIEW `school`.`student view`;");
  assert.equal(client.schemaDropSql({ type:"column", table:"student", name:"group" }, "school"),
    "ALTER TABLE `school`.`student` DROP COLUMN `group`;");
  assert.equal(client.schemaDropSql({ type:"index", table:"student", name:"PRIMARY" }, "school"),
    "ALTER TABLE `school`.`student` DROP PRIMARY KEY;");
  assert.equal(client.schemaDropSql({ type:"index", table:"student", name:"idx age" }, "school"),
    "ALTER TABLE `school`.`student` DROP INDEX `idx age`;");
  assert.equal(client.schemaDropSql({ type:"foreignKey", table:"score", name:"fk student" }, "school"),
    "ALTER TABLE `school`.`score` DROP FOREIGN KEY `fk student`;");
  assert.equal(client.schemaDropSql({ type:"procedure", name:"get_student" }, "school"),
    "DROP PROCEDURE `school`.`get_student`;");
  assert.equal(client.schemaDropSql({ type:"function", name:"student_count" }, "school"),
    "DROP FUNCTION `school`.`student_count`;");
  assert.equal(client.schemaDropSql({ type:"trigger", name:"student_before_insert" }, "school"),
    "DROP TRIGGER `school`.`student_before_insert`;");
  assert.equal(client.schemaDropSql({ type:"event", name:"nightly_cleanup" }, "school"),
    "DROP EVENT `school`.`nightly_cleanup`;");
});

test("첫 낱말은 앞선 주석과 여는 괄호를 건너뛰고 읽는다", () => {
  assert.equal(client.firstKeyword("SELECT 1"), "select");
  assert.equal(client.firstKeyword("  -- 메모\n DELETE FROM t"), "delete");
  assert.equal(client.firstKeyword("/* 메모 */ insert into t"), "insert");
  assert.equal(client.firstKeyword("(SELECT 1)"), "select");
  assert.equal(client.firstKeyword("   "), "");
});

test("되돌릴 수 없는 문장만 확인 대상으로 고른다", () => {
  const risky = client.riskyStatements(
    "SELECT * FROM a;\n" +
    "DELETE FROM a WHERE id = 1;\n" +
    "DELETE FROM a;\n" +
    "UPDATE a SET x = 1;\n" +
    "UPDATE a SET x = 1 WHERE id = 2;\n" +
    "DROP TABLE a;\n" +
    "TRUNCATE TABLE a;\n" +
    "ALTER TABLE a ADD COLUMN y int;"
  );
  assert.deepEqual(risky.map(item => client.firstKeyword(item.statement)),
    ["delete", "update", "drop", "truncate", "alter"]);
  assert.equal(client.riskyStatements("SELECT 1").length, 0);
});

test("오류 코드는 사람이 읽을 문구로 옮겨진다", () => {
  assert.match(client.messageFor({ code: "auth-failed" }), /비밀번호/);
  assert.match(client.messageFor({ code: "driver-missing" }), /pymysql/);
  assert.match(client.messageFor({ code: "read-only-blocked", detail: "DELETE" }), /DELETE/);
  // SQL 오류는 원문이 곧 학습 정보라 그대로 보인다.
  assert.equal(client.messageFor({ code: "sql-error", detail: "You have an error in your SQL syntax" }),
    "You have an error in your SQL syntax");
});

test("붙지 못하는 인증 방식은 비밀번호 오류와 다르게 안내한다", () => {
  // 2059 = 드라이버가 서버가 요구한 인증 플러그인을 못 쓴다(Windows GSSAPI 등).
  // 비밀번호를 다시 치게 하면 안 되는 경우라 안내가 갈려야 한다.
  assert.match(worker, /2059: "auth-plugin"/);
  assert.match(worker, /cryptography is required/);
  assert.match(client.messageFor({ code: "auth-plugin" }), /인증 방식/);
  assert.ok(!/비밀번호가 맞지/.test(client.messageFor({ code: "auth-plugin" })));
  assert.match(client.messageFor({ code: "auth-crypto" }), /cryptography/);
});

test("이름 삽입은 평범한 식별자가 아닐 때만 역따옴표로 감싼다", () => {
  assert.equal(client.identifierFor("users"), "users");
  assert.equal(client.identifierFor("user_2"), "user_2");
  assert.equal(client.identifierFor("주문내역"), "`주문내역`");
  assert.equal(client.identifierFor("my table"), "`my table`");
  assert.equal(client.identifierFor("2020_sales"), "`2020_sales`");
  // 이름 안의 역따옴표는 겹쳐 써서 escape 한다.
  assert.equal(client.identifierFor("we`ird"), "`we``ird`");
});






test("걸린 시간은 서버가 재고 프런트는 그 값만 쓴다", () => {
  // 프런트에서 재면 폴링 간격(300ms)이 섞여 빠른 쿼리가 느리게 보인다.
  assert.match(worker, /def elapsed_ms\(started\)/);
  assert.match(worker, /results\[first_result\]\["ms"\] = elapsed_ms\(started\)/);
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /formatMs\(response\.info\.ms\)/);
  assert.ok(!/Date\.now\(\) - runStartedAt/.test(source), "프런트가 실행 시간을 재면 안 된다");
});

test("스키마 트리는 데이터 행 없이 하위 객체만 따로 받아오고 DDL 을 볼 수 있다", () => {
  assert.match(worker, /def load_columns\(/);
  assert.match(worker, /def load_table_children\(/);
  assert.match(worker, /def load_ddl\(/);
  assert.match(worker, /def load_table_info\(/);
  assert.match(worker, /SHOW CREATE TABLE/);
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 트리를 펼칠 때 미리보기 200행까지 함께 가져오면 안 된다.
  assert.match(source, /&mode=children/);
  assert.match(source, /&mode=ddl/);
  assert.match(source, /&mode=count/);
  // 같은 테이블을 다시 펼치면 서버를 또 부르지 않는다.
  assert.match(source, /tableChildrenCache\.has\(name\)/);
});

test("스키마 트리는 SVG 아이콘으로 주요 객체를 나누고 이름 넣기 버튼을 두지 않는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const icons = fs.readFileSync(path.join(root, "src", "js", "icons.js"), "utf8");
  assert.match(source, /\{ type:"table", label:"Tables", icon:"table", expandable:true \}/);
  assert.match(source, /\{ type:"view", label:"Views", icon:"view", expandable:true \}/);
  assert.match(source, /\{ type:"procedure", label:"Procedures", icon:"procedure" \}/);
  assert.match(source, /\{ type:"function", label:"Functions", icon:"function" \}/);
  assert.match(source, /\{ type:"event", label:"Events", icon:"event" \}/);
  assert.match(source, /schemaIcon\(column\.key === "PRI" \? "key" : "column"/);
  assert.match(source, /expandedTables = new Set\(\)/);
  assert.ok(!/db-table-insert/.test(source), "테이블 행에 별도 이름 넣기 버튼이 없어야 한다");
  assert.ok(!/db-table-kind/.test(source), "테이블 행에 표/뷰 글자 배지가 없어야 한다");
  ["database", "table", "view", "column", "key", "index", "foreignKey", "procedure", "function", "trigger", "event", "chevronRight", "chevronDown"].forEach((name) =>
    assert.match(icons, new RegExp("\\b" + name + ":")));
});

test("런처는 아는 mode 만 워커에 넘긴다", () => {
  assert.match(launcher, /if \(mode != "columns" && mode != "children" && mode != "count" && mode != "ddl" && mode != "info"\) mode = "table";/);
});

test("테이블 구조 편집은 변경할 ALTER 문만 만들고 모든 이름을 인용한다", () => {
  const id = client.columnDraft({ name:"id", type:"bigint", nullable:false, key:"PRI", extra:"auto_increment" }, 0);
  const name = client.columnDraft({ name:"display name", type:"varchar(80)", nullable:true, default:"guest" }, 1);
  const base = { database:"school db", name:"members", comment:"학생", columns:[id, name].map(item => ({ originalName:item.originalName })) };
  const unchanged = client.tableAlterPlan(base, { name:"members", comment:"학생", columns:[id, name] });
  assert.equal(unchanged.sql, "");

  name.type = "varchar(120)";
  name.nullable = false;
  const added = client.columnDraft({ name:"created_at", type:"datetime", nullable:false }, 2);
  added.originalName = ""; added.original = null; added.isNew = true;
  const plan = client.tableAlterPlan(base, { name:"students", comment:"재학생", columns:[id, name, added] });
  assert.deepEqual(plan.errors, []);
  assert.match(plan.sql, /^ALTER TABLE `school db`\.`members`/);
  assert.match(plan.sql, /MODIFY COLUMN `display name` varchar\(120\) NOT NULL DEFAULT 'guest'/);
  assert.match(plan.sql, /ADD COLUMN `created_at` datetime NOT NULL AFTER `display name`/);
  assert.match(plan.sql, /COMMENT = '재학생'/);
  assert.match(plan.sql, /RENAME TO `school db`\.`students`/);
});

test("테이블 구조 편집은 삭제와 위험한 자료형 입력을 구분한다", () => {
  const id = client.columnDraft({ name:"id", type:"int", nullable:false }, 0);
  const memo = client.columnDraft({ name:"memo", type:"text", nullable:true }, 1);
  const base = { database:"school", name:"notes", comment:"", columns:[id, memo].map(item => ({ originalName:item.originalName })) };
  memo.deleted = true;
  const dropped = client.tableAlterPlan(base, { name:"notes", comment:"", columns:[id, memo] });
  assert.equal(dropped.destructive, true);
  assert.match(dropped.sql, /DROP COLUMN `memo`/);
  id.type = "int; DROP TABLE notes";
  const unsafe = client.tableAlterPlan(base, { name:"notes", comment:"", columns:[id, memo] });
  assert.ok(unsafe.errors.some(message => /자료형/.test(message)));
  assert.equal(unsafe.sql, "");
});

test("테이블 정보 모달은 읽기 전용과 외부 구조 변경을 확인한 뒤 기존 쿼리 경로로 적용한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /const openTableInfoModal = async \(name, initialTab\)/);
  assert.match(source, /editable = !readOnly && info\.type === "table"/);
  assert.match(source, /url \+ "&mode=info"/);
  assert.match(source, /String\(latest\.info\.ddl \|\| ""\) !== originalDdl/);
  assert.match(source, /label:"테이블 구조 변경", quiet:true, skipRiskConfirm:true/);
  assert.match(source, /onComplete:async \(ok, result\)/);
  assert.match(source, /await loadSchema\(\)/);
  assert.match(source, /showTable\(nextName\)/);
});

test("스키마 트리는 우클릭과 Delete 키로 객체 삭제를 요청하고 읽기 전용에서는 막는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(source, /const bindSchemaObjectNode =/);
  assert.match(source, /node\.addEventListener\("contextmenu"/);
  assert.match(source, /openTableContextMenu\(item, event\.clientX, event\.clientY\)/);
  assert.match(source, /tableList\.addEventListener\("keydown"/);
  assert.match(source, /event\.key !== "Delete"/);
  assert.match(source, /deleteItem\.disabled = readOnly/);
  assert.match(source, /openTableInfoModal\(item\.table \|\| item\.name, childTab\)/);
  assert.match(source, /event\.key !== "ContextMenu".*event\.shiftKey.*"F10"/);
  assert.ok(!/db-table-info-button/.test(source), "결과 영역에 테이블 정보 버튼이 남으면 안 된다");
  assert.ok(!/db-table-info-button/.test(css), "없어진 결과 버튼 스타일이 남으면 안 된다");
  assert.match(css, /\.db-table-context-menu\{/);
  assert.match(css, /\.db-table-context-item\.danger/);
});

test("삭제 전 의존성을 조회하고 발견되면 실행하지 않은 채 관련 객체를 안내한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(launcher, /path\.StartsWith\("\/db-dependencies\?"/);
  assert.match(launcher, /\{\\"action\\":\\"dependencies\\"/);
  assert.match(worker, /def load_dependencies\(kind, name, table="", database=""\)/);
  assert.match(worker, /information_schema\.KEY_COLUMN_USAGE/);
  assert.match(worker, /information_schema\.VIEW_TABLE_USAGE/);
  assert.match(worker, /information_schema\.VIEW_ROUTINE_USAGE/);
  assert.match(source, /fetch\(url, \{ cache:"no-store" \}\)/);
  assert.match(source, /if \(dependencies\.length\)/);
  assert.match(source, /먼저 위 객체의 참조를 변경하거나 삭제해 주세요/);
  assert.match(source, /skipRiskConfirm:true/);
  assert.match(worker, /1553: "dependency"/);
  assert.match(worker, /3730: "dependency"/);
});

test("테이블 정보의 DDL과 변경 SQL은 창 이동 대신 글자로 선택할 수 있다", () => {
  const app = fs.readFileSync(path.join(root, "src", "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  const ignore = /const IGNORE = "([^"]+)"/.exec(app);
  assert.ok(ignore, "모달 이동 제외 대상이 있어야 한다");
  assert.match(ignore[1], /(?:^|,)pre(?:,|$)/);
  assert.match(ignore[1], /(?:^|,)code(?:,|$)/);
  assert.match(css, /\.db-table-ddl\{[^}]*cursor:text;[^}]*user-select:text/);
  assert.match(css, /\.db-table-alter-sql\{[^}]*cursor:text;[^}]*user-select:text/);
});

test("2차 테이블 정보는 인덱스와 외래키 메타데이터를 함께 읽는다", () => {
  assert.match(worker, /information_schema\.STATISTICS/);
  assert.match(worker, /information_schema\.REFERENTIAL_CONSTRAINTS/);
  assert.match(worker, /"indexes": indexes/);
  assert.match(worker, /"foreignKeys": foreign_keys/);
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /const indexesTab = button\("인덱스 "/);
  assert.match(source, /const foreignKeysTab = button\("외래키 "/);
  assert.match(source, /renderIndexEditor\(\);\s*\n\s*renderForeignKeyEditor\(\);/);
});

test("프로시저·함수·이벤트와 테이블 하위 트리거는 정의문을 결과 영역에서 연다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(worker, /information_schema\.ROUTINES/);
  assert.match(worker, /information_schema\.EVENTS/);
  assert.match(worker, /information_schema\.TRIGGERS/);
  assert.match(worker, /def load_object_ddl\(kind, name, database=""\)/);
  assert.match(worker, /SHOW CREATE " \+ keywords\[normalized\]/);
  assert.match(launcher, /path\.StartsWith\("\/db-object\?"/);
  assert.match(source, /const showSchemaObject = async \(item\)/);
  assert.match(source, /tableSection\(item, "indexes", "Indexes", "index"/);
  assert.match(source, /tableSection\(item, "foreignKeys", "Foreign Keys", "foreignKey"/);
  assert.match(source, /tableSection\(item, "triggers", "Triggers", "trigger"/);
  assert.match(source, /openTableInfoModal\(item\.name, "indexes"\)/);
  assert.match(source, /openTableInfoModal\(item\.name, "foreignKeys"\)/);
  assert.match(source, /db-schema-definition-ddl/);
});

test("ERD 메타데이터는 테이블별 반복 요청 없이 컬럼과 외래키를 일괄 조회한다", () => {
  assert.match(worker, /def load_erd\(database=""\)/);
  assert.match(worker, /TABLE_TYPE = 'BASE TABLE'/);
  assert.match(worker, /MAX_SCHEMA_RELATIONS/);
  assert.match(worker, /"relationships": list\(relation_map\.values\(\)\)/);
  assert.match(worker, /if action == "erd":\s*\n\s*return load_erd/);
  assert.match(launcher, /schemaMode == "erd" \? "erd" : "schema"/);
});

test("ERD 자동 배치는 참조 대상 테이블을 왼쪽에 두고 카드가 겹치지 않는다", () => {
  const columns = Array.from({ length:30 }, (_, index) => ({ name:"c" + index, type:"int" }));
  const layout = client.erdLayout([
    { name:"parents", columns:[{ name:"id", type:"int", key:"PRI" }] },
    { name:"children", columns },
    { name:"grandchildren", columns:[{ name:"id", type:"int" }] }
  ], [
    { sourceTable:"children", targetTable:"parents" },
    { sourceTable:"grandchildren", targetTable:"children" }
  ]);
  const byName = new Map(layout.nodes.map(node => [node.table.name, node]));
  assert.ok(byName.get("parents").x < byName.get("children").x);
  assert.ok(byName.get("children").x < byName.get("grandchildren").x);
  assert.equal(layout.maxColumns, 24);
  assert.ok(byName.get("children").height < 700, "컬럼이 많은 테이블 카드는 접어서 보여야 한다");
  assert.ok(layout.width > 0 && layout.height > 0);
});

test("ERD 화면은 검색·이동·확대·화면 맞춤과 테이블/관계 상세 보기를 제공한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(source, /erdButton\.innerHTML = uiIcon\("graph"\)/);
  assert.match(source, /&mode=erd/);
  assert.match(source, /const openErdModal = async \(\)/);
  assert.match(source, /viewport\.addEventListener\("wheel"/);
  assert.match(source, /viewport\.addEventListener\("pointercancel", endPan\)/);
  assert.match(source, /const fitDiagram = \(\)/);
  assert.match(source, /search\.addEventListener\("input", filterCards\)/);
  assert.match(source, /cardNode\.addEventListener\("dblclick", openInfo\)/);
  assert.match(source, /openTableInfoModal\(relationship\.sourceTable, "foreignKeys"\)/);
  assert.match(css, /\.db-erd-world\{/);
  assert.match(css, /\.db-erd-edge-hit\{/);
  assert.match(css, /\.db-erd-relation-detail\{/);
});

test("인덱스와 외래키 변경은 삭제 후 재생성하는 ALTER 문으로 합쳐진다", () => {
  const id = client.columnDraft({ name:"id", type:"bigint", nullable:false }, 0);
  const parent = client.columnDraft({ name:"parent_id", type:"bigint", nullable:true }, 1);
  const index = client.indexDraft({
    name:"idx_parent", unique:false, type:"BTREE",
    columns:[{ name:"parent_id", prefix:null, order:"ASC" }]
  }, 0);
  index.name = "uq_parent";
  index.unique = true;
  index.columns[0].prefix = "8";
  index.columns[0].order = "DESC";
  const foreignKey = client.foreignKeyDraft({
    name:"fk_nodes_parent", referencedDatabase:"school", referencedTable:"nodes",
    updateRule:"CASCADE", deleteRule:"SET NULL",
    columns:[{ local:"parent_id", referenced:"id" }]
  }, 0);
  foreignKey.originalName = "";
  foreignKey.original = null;
  foreignKey.isNew = true;
  const base = { database:"school", name:"nodes", comment:"", columns:[id, parent].map(column => ({ originalName:column.originalName })) };
  const plan = client.tableAlterPlan(base, {
    name:"nodes", comment:"", columns:[id, parent], indexes:[index], foreignKeys:[foreignKey]
  });
  assert.deepEqual(plan.errors, []);
  assert.match(plan.sql, /DROP INDEX `idx_parent`/);
  assert.match(plan.sql, /ADD UNIQUE INDEX `uq_parent` \(`parent_id`\(8\) DESC\)/);
  assert.match(plan.sql, /ADD CONSTRAINT `fk_nodes_parent` FOREIGN KEY \(`parent_id`\) REFERENCES `school`\.`nodes` \(`id`\)/);
  assert.match(plan.sql, /ON DELETE SET NULL ON UPDATE CASCADE/);
});

test("활성 제약조건이 참조하는 컬럼은 먼저 정리하지 않으면 삭제할 수 없다", () => {
  const id = client.columnDraft({ name:"id", type:"int", nullable:false }, 0);
  const parent = client.columnDraft({ name:"parent_id", type:"int", nullable:true }, 1);
  parent.deleted = true;
  const index = client.indexDraft({
    name:"idx_parent", unique:false, type:"BTREE", columns:[{ name:"parent_id", order:"ASC" }]
  }, 0);
  const foreignKey = client.foreignKeyDraft({
    name:"fk_parent", referencedDatabase:"school", referencedTable:"nodes",
    updateRule:"RESTRICT", deleteRule:"RESTRICT", columns:[{ local:"parent_id", referenced:"id" }]
  }, 0);
  const plan = client.tableAlterPlan(
    { database:"school", name:"nodes", comment:"", columns:[{ originalName:"id" }, { originalName:"parent_id" }] },
    { name:"nodes", comment:"", columns:[id, parent], indexes:[index], foreignKeys:[foreignKey] }
  );
  assert.ok(plan.errors.some(message => /인덱스의 컬럼/.test(message)));
  assert.ok(plan.errors.some(message => /외래키의 로컬 컬럼/.test(message)));
  assert.equal(plan.sql, "");
});

test("지원하지 않는 함수식 인덱스는 그대로 둔 채 다른 속성만 바꿀 수 있다", () => {
  const id = client.columnDraft({ name:"id", type:"int", nullable:false }, 0);
  const functional = client.indexDraft({
    name:"idx_expression", unique:false, type:"BTREE",
    columns:[{ name:"", order:"ASC", unsupported:true }]
  }, 0);
  const plan = client.tableAlterPlan(
    { database:"school", name:"nodes", comment:"", columns:[{ originalName:"id" }] },
    { name:"nodes", comment:"노드", columns:[id], indexes:[functional], foreignKeys:[] }
  );
  assert.deepEqual(plan.errors, []);
  assert.match(plan.sql, /COMMENT = '노드'/);
});

test("고급 컬럼 속성은 구조 SQL에서 조용히 사라지지 않는다", () => {
  const normal = client.columnDraft({
    name:"title", type:"varchar(100)", nullable:false, characterSet:"utf8mb4", collation:"utf8mb4_bin"
  }, 0);
  const base = { database:"school", name:"docs", comment:"", columns:[{ originalName:"title" }] };
  normal.comment = "제목";
  const preserved = client.tableAlterPlan(base, { name:"docs", comment:"", columns:[normal] });
  assert.match(preserved.sql, /CHARACTER SET `utf8mb4` COLLATE `utf8mb4_bin`/);

  const advanced = client.columnDraft({ name:"secret", type:"varchar(20)", nullable:true, extra:"INVISIBLE" }, 1);
  advanced.comment = "숨김";
  const blocked = client.tableAlterPlan(
    { database:"school", name:"docs", comment:"", columns:[{ originalName:"secret" }] },
    { name:"docs", comment:"", columns:[advanced] }
  );
  assert.ok(blocked.errors.some(message => /고급 속성/.test(message)));
  assert.equal(blocked.sql, "");
});


test("별칭은 테이블 이름으로 되돌아간다", () => {
  const map = client.aliasMap("SELECT * FROM orders o JOIN users AS u ON o.uid = u.id");
  assert.equal(map.get("o"), "orders");
  assert.equal(map.get("u"), "users");
  assert.equal(map.get("orders"), "orders");
  // 별칭 자리에 온 예약어를 별칭으로 오해하면 안 된다.
  assert.equal(client.aliasMap("SELECT * FROM orders WHERE x = 1").get("where"), undefined);
});

test("SQL Ctrl+클릭은 현재 문장의 테이블명과 별칭을 테이블 정보 대상으로 해석한다", () => {
  const sql = "SELECT o.id FROM orders o JOIN users AS u ON o.uid = u.id; SELECT note FROM logs";
  const objects = [
    { type:"table", name:"orders" },
    { type:"table", name:"users" },
    { type:"table", name:"logs" },
    { type:"procedure", name:"orders" }
  ];
  const aliasPoint = sql.indexOf("o.id");
  const alias = client.sqlDefinitionTargetAt(sql, { word:"o", start:aliasPoint, point:aliasPoint }, objects);
  assert.equal(alias.kind, "table");
  assert.equal(alias.name, "orders");
  const tablePoint = sql.indexOf("users");
  assert.equal(client.sqlDefinitionTargetAt(sql,
    { word:"users", start:tablePoint, point:tablePoint }, objects).name, "users");
  const columnPoint = sql.indexOf("note");
  assert.equal(client.sqlDefinitionTargetAt(sql,
    { word:"note", start:columnPoint, point:columnPoint }, objects), null);
});

test("공용 편집기는 외부 정의 대상만 Ctrl+클릭 링크로 열 수 있다", () => {
  const editor = fs.readFileSync(path.join(root, "src", "js", "python-editor.js"), "utf8");
  const db = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(editor, /options\.definitionTargetAt\(\{ source:ta\.value, wordInfo \}\)/);
  assert.match(editor, /options\.openDefinitionTarget\(\{ source:ta\.value, wordInfo, target:externalTarget \}\)/);
  assert.match(editor, /const canOpen = typeof options\.definitionTargetAt !== "function" \|\| !!externalTarget/);
  assert.match(db, /definitionTargetAt: \(\{ source, wordInfo \}\) => sqlDefinitionTargetAt\(source, wordInfo, schemaObjects\)/);
  assert.match(db, /openTableInfoModal\(target\.name\)/);
});




test("더 보기는 SQL 을 고쳐 쓰지 않고 보관분에서 떼어 온다", () => {
  // 임의의 쿼리에 LIMIT/OFFSET 을 덧붙이면 이미 LIMIT 이 있는 쿼리가 망가진다.
  assert.match(worker, /def slice_page\(kept, offset, limit\)/);
  assert.match(worker, /KEEP_ROWS/);
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /\/db-page\?id=/);
  assert.ok(!/LIMIT " \+ .*OFFSET/i.test(source), "프런트가 SQL 에 LIMIT 을 붙이면 안 된다");
});

test("보관분이 서버의 전부가 아니면 그렇다고 밝힌다", () => {
  assert.match(worker, /"serverHasMore": kept\["more"\]/);
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /info\.serverHasMore/);
  assert.match(source, /보관해 둔/);
});

test("실행 계획은 편집기를 고치지 않고 EXPLAIN 만 붙인다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /const base = target\.displaySql \|\| target\.sql/);
  assert.match(source, /firstKeyword\(base\) === "explain" \? base : "EXPLAIN " \+ base/);
});

test("실행 이력은 접속별로 나뉘고 비밀번호를 섞지 않는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /const historySignature = \(\) => \[profile\.host, profile\.port, profile\.database, profile\.user\]/);
  assert.ok(!/historySignature[\s\S]{0,200}password/i.test(source), "이력 키에 비밀번호가 들어가면 안 된다");
  // 지우는 방법이 함께 있어야 한다.
  assert.match(source, /historyClear\.addEventListener/);
  assert.match(source, /HISTORY_MAX = 50/);
});

test("ORDER BY 자리는 괄호·문자열·주석 밖에서만 찾는다", () => {
  const at = (sql) => client.orderBySpot(sql);
  // 서브쿼리 안의 ORDER BY 는 이 문장의 정렬이 아니다.
  const sub = "SELECT * FROM (SELECT x FROM u ORDER BY x) s";
  assert.equal(at(sub).start, sub.length, "서브쿼리 ORDER BY 를 잡으면 안 된다");
  // 문자열·주석 안의 글자도 마찬가지다.
  assert.equal(at("SELECT 'order by' FROM t").start, "SELECT 'order by' FROM t".length);
  const commented = "SELECT * FROM t -- order by z";
  assert.equal(at(commented).start, commented.length);
  // 진짜 ORDER BY 는 잡고, LIMIT 앞에서 끊는다.
  const real = "SELECT * FROM t ORDER BY b LIMIT 10";
  assert.equal(real.slice(at(real).start, at(real).end), "ORDER BY b ");
});

test("ORDER BY 는 LIMIT·FOR UPDATE 자리를 지키며 바뀐다", () => {
  const apply = client.applyOrderBy;
  assert.equal(apply("SELECT * FROM t", "a"), "SELECT * FROM t ORDER BY a");
  assert.equal(apply("SELECT * FROM t LIMIT 10", "a"), "SELECT * FROM t ORDER BY a LIMIT 10");
  assert.equal(apply("SELECT * FROM t FOR UPDATE", "a"), "SELECT * FROM t ORDER BY a FOR UPDATE");
  // 이미 있는 ORDER BY 는 갈아 끼운다(두 개가 생기면 문법 오류가 된다).
  assert.equal(apply("SELECT * FROM t ORDER BY b LIMIT 10", "a DESC"), "SELECT * FROM t ORDER BY a DESC LIMIT 10");
  // 빈 절을 주면 정렬을 뺀다.
  assert.equal(apply("SELECT * FROM t ORDER BY b", ""), "SELECT * FROM t");
  assert.equal(apply("SELECT * FROM t ORDER BY b LIMIT 5", ""), "SELECT * FROM t LIMIT 5");
});

test("여러 줄 문장은 줄바꿈으로 이어 붙인다", () => {
  assert.equal(client.applyOrderBy("SELECT *\nFROM t", "a"), "SELECT *\nFROM t\nORDER BY a");
});

test("정렬 표시는 실행된 문장에서만 읽는다", () => {
  // 화살표를 클릭 기록에서 만들면 사용자가 손으로 ORDER BY 를 고쳤을 때 거짓말을 하게 된다.
  assert.deepEqual(client.orderByState("SELECT * FROM t ORDER BY a"), { column: "a", direction: "asc" });
  assert.deepEqual(client.orderByState("SELECT * FROM t ORDER BY b DESC LIMIT 5"), { column: "b", direction: "desc" });
  assert.deepEqual(client.orderByState("SELECT * FROM t ORDER BY `두 낱말` DESC"), { column: "두 낱말", direction: "desc" });
  assert.equal(client.orderByState("SELECT * FROM t"), null);
  // 정렬 키가 여럿이면 첫 번째만 화살표로 보여 준다.
  assert.deepEqual(client.orderByState("SELECT * FROM t ORDER BY a ASC, b DESC"), { column: "a", direction: "asc" });
});

test("헤더 정렬은 클라이언트에서 행을 다시 늘어놓지 않는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 1000행에서 잘린 결과를 정렬하면 "전체에서 가장 큰 값"처럼 보이는 거짓말이 된다.
  assert.ok(!/rows\.sort\(|\.sort\(\(a, ?b\)/.test(source), "받아온 행을 정렬하면 안 된다");
  assert.match(source, /const next = applyOrderBy\(entry\.sql, clause\)/);
  // SELECT 계열이 아니거나 문장이 잘려 왔으면 정렬을 걸지 않는다.
  assert.match(source, /if \(!entry \|\| !entry\.sql \|\| entry\.sqlTruncated\) return null;/);
  assert.match(source, /\["select", "with", "table"\]\.includes/);
  assert.match(worker, /"sqlTruncated": len\(statement\) > 4000/);
});

test("Ctrl+S 는 앱의 전역 saveCurrent 경로를 그대로 탄다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "src", "js", "app.js"), "utf8");
  // app.js 는 활성 문서 안의 .run-save 를 눌러 준다. 자체 키 처리기를 두면 두 번 겹친다.
  assert.match(app, /querySelector\("\.run-save"\)/);
  assert.match(source, /button\("저장", "db-btn db-btn-quiet run-save"/);
  assert.match(source, /saveButton\.dataset\.shortcutAction = "saveCurrent"/);
  assert.ok(!/key === "s"|code === "KeyS"/i.test(source), "자체 Ctrl+S 처리기를 두면 안 된다");
});

test("헤더 정렬은 편집기 내용을 고치지 않는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // sortBy 함수 본문만 잘라 본다(범위가 넓으면 다른 함수의 editor.value 를 잘못 잡는다).
  const from = source.indexOf("const sortBy =");
  const sortBy = source.slice(from, source.indexOf("\n    };", from));
  assert.ok(from > 0 && sortBy.length > 0 && sortBy.length < 1200, "sortBy 본문만 잡혀야 한다");
  assert.ok(!/editor\.value\s*=/.test(sortBy), "정렬이 편집기를 고치면 안 된다");
  assert.ok(!/markDirty\(\)/.test(sortBy), "정렬로 문서가 수정됨 표시가 되면 안 된다");
  // 대신 무엇이 적용됐는지 결과 줄에 밝힌다.
  assert.match(sortBy, /label:clause \? "정렬 · ORDER BY " \+ clause : "정렬 해제"/);
  // 정렬 클릭이 실행 이력을 채우지 않는다.
  assert.match(sortBy, /quiet:true/);
  assert.match(source, /if \(!runningQuiet\) rememberQuery/);
});

test("스키마 패널 너비는 접속 문서가 아니라 브라우저에 저장한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /const SIDEBAR_KEY = "classdockDbSidebarV1"/);
  // .dbconn 파일에 들어가면 접속 정보에 화면 설정이 섞이고 문서가 계속 "저장 안 됨"이 된다.
  const text = client.serializeProfile(client.emptyProfile());
  assert.ok(!/width|sidebar/i.test(text), "저장 파일에 화면 폭이 들어가면 안 된다");
});

test("분할선 드래그는 pointercancel 까지 정리한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const from = source.indexOf('divider.addEventListener("pointerdown"');
  const block = source.slice(from, source.indexOf("\n    });", from));
  assert.ok(from > 0, "분할선 드래그 처리기가 있어야 한다");
  // 터치가 끊겼을 때 pointermove 리스너가 남으면 손을 뗀 뒤에도 폭이 따라다닌다.
  assert.match(block, /removeEventListener\("pointermove", move\)/);
  assert.match(block, /removeEventListener\("pointerup", end\)/);
  assert.match(block, /removeEventListener\("pointercancel", end\)/);
  assert.match(block, /addEventListener\("pointercancel", end\)/);
  assert.match(source, /divider\.addEventListener\("dblclick"/);
});

test("분할선은 편집기를 없앨 만큼 밀리지 않는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /SIDEBAR_MIN = 150, SIDEBAR_DEFAULT = 240, SIDEBAR_KEEP_MAIN = 320/);
  assert.match(source, /rect\.width - SIDEBAR_KEEP_MAIN/);
  // 연결 전에는 작업 영역 폭이 0 이라 상한을 걸면 최소값으로 눌려 버린다.
  assert.match(source, /if \(!rect\.width\) return Infinity;/);
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // 가운데 12px 열이 예전 gap 을 대신한다 — gap 을 함께 두면 간격이 두 번 벌어진다.
  assert.match(css, /grid-template-columns:min\(var\(--db-sidebar-width,240px\),60%\) 12px minmax\(0,1fr\);\s*\n\s*gap:0/);
  assert.match(css, /\.db-divider\{position:relative;cursor:col-resize;touch-action:none\}/);
  // 좁은 화면에서는 세로 배치라 세로 분할선이 의미가 없다.
  assert.match(css, /@media\(max-width:820px\)\{[\s\S]*?\.db-divider\{display:none\}/);
});

test("SQL 편집기와 결과는 아래·오른쪽 배치에서 각각 크기를 기억한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(source, /const RESULT_LAYOUT_KEY = "classdockDbResultLayoutV1"/);
  assert.match(source, /const EDITOR_WIDTH_KEY = "classdockDbEditorWidthV1"/);
  assert.match(source, /localStorage\.setItem\(RESULT_LAYOUT_KEY, layout === "side" \? "side" : "below"\)/);
  assert.match(source, /compactQueryLayout = window\.matchMedia\("\(max-width:900px\)"\)/);
  assert.match(css, /\.db-query-layout\.db-layout-below\{flex-direction:column\}/);
  assert.match(css, /\.db-query-layout\.db-layout-side\{flex-direction:row\}/);
  assert.match(css, /\.db-editor-pane\{flex:0 0 var\(--db-editor-height,180px\)\}/);
  assert.match(css, /\.db-layout-side \.db-editor-pane\{flex-basis:var\(--db-editor-width,520px\)\}/);
  // .db-editor 는 높이만 정하는 그릇이고 안쪽 편집기 위젯이 그 높이를 채운다.
  assert.match(css, /\.db-editor \.code-host\{[^}]*height:100%/);
  // 위젯 기본값(가운데 정렬·최대 폭)은 문서 한가운데 띄우는 코드 화면용이라 여기선 꺼야 한다.
  assert.match(css, /\.db-editor \.code-host\{[^}]*max-width:none/);
});

test("다크모드 데이터베이스 선택 목록은 항목 배경과 글자가 구분된다", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // Windows WebView가 펼친 목록을 밝은 기본 배경으로 그려도 밝은 글자만 남지 않게 한다.
  assert.match(css, /\[data-theme="dark"\] \.db-database-select\{color-scheme:dark\}/);
  assert.match(css, /\[data-theme="dark"\] \.db-database-select option\{background:var\(--field\);color:var\(--ink\)\}/);
});

test("SQL 결과 분할선은 배치 방향에 맞춰 동작한다", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(css, /\.db-query-divider\{position:relative;z-index:2;flex:0 0 10px;touch-action:none;outline:none\}/);
  assert.match(css, /\.db-layout-below \.db-query-divider\{cursor:row-resize\}/);
  assert.match(css, /\.db-layout-side \.db-query-divider\{cursor:col-resize\}/);
  assert.match(css, /\.db-layout-below \.db-query-divider::before\{left:0;right:0;top:4px;height:2px\}/);
  assert.match(css, /\.db-layout-side \.db-query-divider::before\{top:0;bottom:0;left:4px;width:2px\}/);
});

test("SQL 결과 분할선도 pointercancel 까지 정리한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const from = source.indexOf('editorDivider.addEventListener("pointerdown"');
  const block = source.slice(from, source.indexOf("\n    });", from));
  assert.ok(from > 0, "가로 분할선 드래그 처리기가 있어야 한다");
  assert.match(block, /removeEventListener\("pointercancel", end\)/);
  assert.match(source, /editorDivider\.addEventListener\("dblclick"/);
  // 결과 자리를 남겨 분할선을 끝까지 내려도 결과가 사라지지 않는다.
  assert.match(source, /EDITOR_MIN = 90, EDITOR_DEFAULT = 180, EDITOR_KEEP_RESULT = 240/);
  assert.match(source, /rect\.height - EDITOR_KEEP_RESULT/);
  assert.match(source, /if \(!rect\.height\) return Infinity;/);
  // 높이도 접속 문서가 아니라 브라우저에 저장한다.
  assert.match(source, /const EDITOR_KEY = "classdockDbEditorHeightV1"/);
  assert.match(source, /const EDITOR_WIDTH_KEY = "classdockDbEditorWidthV1"/);
});

test("DB 결과 전체나 선택 영역을 메모 표로 보낼 수 있다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /const memoRowsFromGrid = \(\) =>/);
  assert.match(source, /memoButton\.textContent = selected \? "선택 메모로" : "전체 메모로"/);
  assert.match(source, /gridSelection\.keys\.has\(row \* columnCount \+ col\)/);
  assert.match(source, /const memoTableChunks = \(rows\) =>/);
  assert.match(source, /const maxColumns = 20, maxCells = 3000, maxRows = 200/);
  assert.match(source, /window\.addTableToScratchpad\(rows\)/);
});

test("DB 편집기와 결과 표의 글꼴·크기 및 테마별 글자색을 바꿀 수 있다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(source, /registerEditorFont\(editor\.host\)/);
  assert.match(source, /registerEditorFont\(resultHost\)/);
  assert.match(source, /groupedCodeFontChoices\(\)/);
  assert.match(source, /bumpCodeFont\(-1\)/);
  assert.match(source, /bumpCodeFont\(1\)/);
  assert.match(source, /setCodeFontFamily\(fontPick\.value\)/);
  assert.match(source, /classdockDbEditorTextColorLightV1/);
  assert.match(source, /classdockDbEditorTextColorDarkV1/);
  assert.match(source, /editor\.host\.style\.setProperty\("--code-text", value\)/);
  assert.match(source, /editor\.host\.style\.removeProperty\("--code-text"\)/);
  assert.match(source, /classdockDbResultTextColorLightV1/);
  assert.match(source, /classdockDbResultTextColorDarkV1/);
  // 편집기 일반 글자색만 덮어 키워드·문자열·주석의 문법 강조 변수는 유지한다.
  assert.doesNotMatch(source, /editor\.host\.style\.setProperty\("--code-(?:keyword|string|comment)"/);
  assert.match(css, /font-family:var\(--code-ff,/);
  assert.match(css, /font-size:var\(--code-fs,13px\)/);
  assert.match(css, /color:var\(--db-result-text-color,var\(--ink\)\)/);
  assert.match(css, /\.db-result-color-field\{display:inline-flex/);
});

test("편집기 위젯은 프로파일에 맞는 줄 주석 표시를 고른다", () => {
  const editor = fs.readFileSync(path.join(root, "src", "js", "python-editor.js"), "utf8");
  // 자바스크립트에 "#" 을 넣던 버그의 원인은 주석 표시가 core.js 에 박혀 있었던 것이다.
  assert.match(editor, /const commentToken = options\.commentToken/);
  assert.match(editor, /prof === "sql" \? "--" : \(prof === "python" \|\| prof === "hash" \? "#" : "\/\/"\)/);
  assert.match(editor, /transformEditorLines\(ta\.value, ta\.selectionStart, ta\.selectionEnd, action, commentToken\)/);
});

test("런처는 워커 응답을 파싱하지 않고 상태 문자로만 판단한다", () => {
  // C# 에는 JSON 파서가 없다. 워커가 '+'/'-' 를 앞에 붙이는 약속이 양쪽에 다 있어야 한다.
  assert.match(worker, /\("\+" if payload\.get\("ok"\) else "-"\)/);
  assert.match(launcher, /response\[0\] == '\+'/);
  assert.match(launcher, /line\[0\] != '\+' && line\[0\] != '-'/);
});

test("비밀번호는 명령행·환경변수가 아니라 stdin 으로만 건너간다", () => {
  const start = launcher.slice(launcher.indexOf("static string StartDbSession"),
    launcher.indexOf("static string DbMetadataRequest"));
  assert.ok(start.includes('",\\"password\\":" + JsonString(password)'),
    "비밀번호는 connect 요청 JSON(stdin)에 실려야 한다");
  assert.ok(!/EnvironmentVariables\[[^\]]*(?:PASS|PWD)/i.test(start), "환경변수에 비밀번호를 넣으면 안 된다");
  // 프로세스 인수에는 러너 경로만 들어간다.
  assert.match(start, /string args = \(interp == "py" \? "-3 " : ""\) \+ "-u -X utf8 \\"" \+ runnerPath/);
});

test("읽기 전용은 안내 문구가 아니라 서버가 건다", () => {
  assert.match(worker, /SET SESSION TRANSACTION READ ONLY/);
  // 1792 = ER_CANNOT_EXECUTE_IN_READ_ONLY_TRANSACTION
  assert.match(worker, /1792: "read-only"/);
});

test("수동 커밋 모드는 워커가 쥔 커넥션 하나에서만 성립한다", () => {
  // 자동 커밋 여부는 접속 요청이 정한다(예전처럼 autocommit=True 로 고정하지 않는다).
  assert.match(worker, /autocommit=auto_commit/);
  // 읽기 전용 접속에는 확정할 것이 없으므로 언제나 자동 커밋이다.
  assert.match(worker, /auto_commit = True if read_only else bool\(request\.get\("autoCommit", True\)\)/);
  assert.match(launcher, /bool autoCommit = readOnly \|\| autoCommitText != "0";/);
  // 커밋·롤백·자동 커밋 전환은 모두 같은 세션(같은 커넥션)으로 나간다.
  ["commit", "rollback", "autocommit", "tx"].forEach((action) => {
    assert.match(worker, new RegExp('if action == "' + action + '":'));
  });
  assert.match(launcher, /path\.StartsWith\("\/db-tx\?"/);
});

test("커밋하지 않은 변경은 화면이 짐작하지 않고 워커가 알려 준다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 쿼리·커밋·롤백 응답에 실려 오는 상태를 그대로 받는다.
  assert.match(worker, /def tx_state\(\):/);
  assert.match(worker, /"autoCommit": bool\(_state\["auto_commit"\]\), "pending": bool\(_state\["pending"\]\)/);
  // 암묵적 커밋(DDL) 뒤에는 되돌릴 것이 남지 않으므로 미커밋 표시를 지운다.
  assert.match(worker, /IMPLICIT_COMMIT_KEYWORDS/);
  assert.match(source, /applyTxState\(response\.info\)/);
  // 자동 커밋을 켜면 서버가 트랜잭션을 확정한다 — 남은 변경이 있으면 먼저 막는다.
  assert.match(worker, /"code": "tx-pending"/);
  // 커밋하지 않고 연결을 끊으면 서버가 롤백하므로 한 번 묻는다.
  assert.match(source, /연결을 끊으면 모두 사라집니다/);
});

test("취소는 응답을 만들지 않고 별도 커넥션으로 KILL QUERY 를 보낸다", () => {
  assert.match(worker, /KILL QUERY/);
  // 취소가 응답을 내면 실행 중인 쿼리의 응답과 순서가 뒤섞인다.
  assert.match(worker, /if action == "cancel":\s*\n\s*cancel_running_query\(\)/);
  assert.match(launcher, /static void DbSendCancel/);
});

test("DB API 는 실행별 로컬 토큰을 요구한다", () => {
  const guardStart = launcher.indexOf("static bool RequiresLocalAuthToken");
  const guard = launcher.slice(guardStart, launcher.indexOf("\n    }", guardStart));
  const hits = guard.match(/path\.StartsWith\("\/db-", StringComparison\.Ordinal\)\) return true;/g) || [];
  assert.equal(hits.length, 2, "GET·POST 양쪽에서 토큰을 요구해야 한다");
});

test("잘린 셀은 화면이 알 수 있게 좌표로 표시된다", () => {
  // 잘린 값을 전부인 것처럼 보여 주면 화면이 거짓말을 하게 된다.
  assert.match(worker, /clippedCells/);
  assert.match(worker, /MAX_CLIPPED_MARKS/);
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /db-clipped/);
  assert.match(source, /서버에서 500자까지만 가져온 값입니다/);
});

test("워커는 EXE 리소스로 포함되고 종료 시 정리된다", () => {
  assert.match(build, /\/resource:db_worker\.py,db_worker\.py/);
  assert.match(buildDotnet, /\/resource:db_worker\.py,db_worker\.py/);
  assert.match(launcher, /ReadResource\("db_worker\.py"\)/);
  assert.match(launcher, /foreach \(string id in dbIds\) StopDbSession\(id\);/);
});

test("접속 문서는 새 문서 메뉴와 스크립트 목록에 등록되어 있다", () => {
  assert.match(html, /id="sbNewDbConn"[\s\S]*?\.dbconn/);
  assert.match(html, /<script src="src\/js\/db-client\.js"><\/script>/);
  assert.ok(manifest.localScripts.includes("db-client.js"));
  const order = manifest.localScripts;
  for (const dependency of manifest.scriptDependencies["db-client.js"]) {
    assert.ok(order.indexOf(dependency) < order.indexOf("db-client.js"), dependency);
  }
});

// 파이썬이 있는 환경에서만 돈다(check-source 의 파이썬 하네스 검사와 같은 기조).
const python = spawnSync("python", ["--version"], { encoding: "utf8" });
test("의존성 검사는 외래키·인덱스·생성 컬럼·뷰 사용 관계를 구조화한다",
  { skip: python.status !== 0 && "python 없음" }, () => {
    const run = spawnSync("python", [path.join(root, "tests", "fixtures", "db-dependency-probe.py"),
      path.join(root, "desktop")], { encoding:"utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /ok/);
  });

test("워커의 문장 나누기는 프런트와 같은 결과를 낸다", { skip: python.status !== 0 && "python 없음" }, () => {
  const probe = [
    "import json, sys",
    "sys.path.insert(0, " + JSON.stringify(path.join(root, "desktop")) + ")",
    "import db_worker",
    "cases = json.loads(sys.stdin.read())",
    "print(json.dumps([db_worker.split_statements(item) for item in cases]))"
  ].join("\n");
  const run = spawnSync("python", ["-c", probe], {
    input: JSON.stringify(SPLIT_CASES.map(item => item[0])), encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr);
  const fromWorker = JSON.parse(run.stdout);
  SPLIT_CASES.forEach(([sql, expected], index) => {
    assert.deepEqual(fromWorker[index], expected, sql);
  });
});

test("문서 뷰어는 SQL 강조와 표 내보내기를 새로 만들지 않고 재사용한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 편집기는 직접 만들지 않고 파이썬·자바스크립트와 같은 위젯을 쓴다.
  assert.match(source, /buildCodeEditor\(profile\.sql \|\| "", "sql", \{/);
  assert.match(source, /plain: true/);
  assert.match(source, /memberCandidates: \(source, receiver, prefix\) => sqlMemberCandidates/);
  assert.match(source, /MNTableExport\.saveCsv/);
  // 부족한 패키지는 그 자리에서 설치할 수 있어야 한다(드라이버·인증 보조 패키지 모두).
  assert.match(source, /offerPackageInstall\(\["pymysql"\]/);
  assert.match(source, /offerPackageInstall\(\["cryptography"\]/);
  assert.match(source, /MNTableExport\.openInEditor/);
  // 탭을 닫으면 워커 프로세스와 서버 커넥션이 남지 않아야 한다.
  assert.match(source, /doc\.cleanupFns = doc\.cleanupFns \|\| \[\]/);
  // 확인창은 편집기 전체가 아니라 실제로 보낼 것만 검사해야 한다.
  assert.match(source, /const risky = riskyStatements\(sql\);/);
  assert.match(source, /const sql = chosen \? chosen\.sql\.trim\(\) : "";/);
  // Ctrl+Enter 는 대상만, Ctrl+Shift+Enter 는 편집기 전체.
  // 실행은 앱의 runCode 단축키(기본 Ctrl+Enter)를 따르고, 전체 실행은 Ctrl+Shift+Enter 다.
  assert.match(source, /shortcutMatches\(event, "runCode"\)/);
  assert.match(source, /runQuery\(allTarget\(\)\)/);
  // 자동완성 목록이 떠 있으면 실행 단축키가 가로채지 않는다.
  assert.match(source, /if \(editor\.isCompletionOpen && editor\.isCompletionOpen\(\)\) return;/);
  // 여러 결과 집합을 버리지 않고 탭으로 낸다. 표가 없는 문장(INSERT·UPDATE·오류)도 탭 하나를 차지한다.
  assert.match(source, /resultSets = \(statements \|\| \[\]\)\.filter\(item => item && item\.kind\)/);
});

test("CALL의 실제 결과 집합은 모두 전달하고 마지막 빈 완료 결과는 숨긴다",
  { skip: python.status !== 0 && "python 없음" }, () => {
    const run = spawnSync("python", [path.join(root, "tests", "fixtures", "db-multi-result-probe.py"),
      path.join(root, "desktop")], { encoding:"utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /ok/);
    assert.match(worker, /while True:[\s\S]*getattr\(cursor, "nextset", None\)/);
    assert.match(worker, /trailing_call_status/);
    const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
    assert.match(source, /entry\.resultIndex/);
    assert.match(source, /entry\.statement/);
  });

test("여러 문장 실행은 중간에 멈춰도 거기까지의 결과를 보여 준다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 워커는 실패한 문장까지의 결과를 함께 돌려준다 — 앞의 문장은 이미 서버에서 실행됐다.
  assert.match(worker, /failure\["statements"\] = results/);
  assert.match(worker, /failure\["failedAt"\] = len\(results\) - 1/);
  assert.match(worker, /entry\.update\(\{"kind": "error"/);
  // 화면은 실패해도 결과를 지우지 않고, 멈춘 자리를 먼저 연다.
  assert.match(source, /const partial = \(response\.info && response\.info\.statements\) \|\| \[\];/);
  assert.match(source, /showResultSet\(failure && Number\.isInteger\(failure\.failedAt\)/);
});

test("탭 이름은 어느 문장의 결과인지 밝히고, 예산에 밀린 결과는 그렇다고 적는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 결과 1·결과 2 만으로는 어느 쿼리인지 알 수 없다.
  assert.match(source, /const tabLabel = \(entry, index\) =>/);
  assert.match(source, /previewOf\(entry\.sql \|\| "", 34\)/);
  // 앞의 결과가 셀 예산을 다 써서 못 실은 것과 "데이터가 없다"를 구분한다.
  assert.match(worker, /if not page\["rows"\] and len\(kept_rows\):/);
  assert.match(worker, /entry\["budgetExhausted"\] = True/);
  assert.match(source, /entry\.budgetExhausted/);
});

test("SQL 파일 가져오기는 서버를 거치지 않고 인코딩을 판정해 읽는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 파일 선택은 브라우저 입력으로 끝난다 — 런처에 파일을 올리는 경로가 생기면 안 된다.
  assert.match(source, /sqlFileInput\.accept = "\.sql,\.txt,text\/plain";/);
  assert.doesNotMatch(source, /FormData/);
  // 한글 주석이 든 CP949 덤프가 깨지지 않게 코어의 판정기를 그대로 쓴다.
  assert.match(source, /typeof detectTextEncoding === "function" \? detectTextEncoding\(bytes\) : null/);
  // 쓰던 SQL 을 말없이 덮어쓰지 않는다.
  assert.match(source, /editor\.getValue\(\)\.trim\(\) && typeof confirmDialog === "function"/);
  // 큰 파일은 묻고, 더 큰 파일은 받지 않는다.
  assert.match(source, /file\.size > SQL_IMPORT_MAX/);
  assert.match(source, /file\.size > SQL_IMPORT_WARN/);
  // DELIMITER 복합문은 경고하지 않고 인식한 문장 수를 안내한다.
  assert.match(source, /DELIMITER 복합문을 인식했습니다/);
  assert.doesNotMatch(source, /DELIMITER 구문은 그대로 실행할 수 없습니다/);
});

test("표 칸 고르기 셈은 스프레드시트와 DB 결과 표가 같은 모듈을 쓴다", () => {
  const selection = require("../src/js/grid-selection.js");
  const viewer = fs.readFileSync(path.join(root, "src", "js", "spreadsheet-viewer.js"), "utf8");
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 스프레드시트는 옛 이름을 그대로 쓰되 정의는 공용 모듈에서 받아 온다(부르는 자리를 건드리지 않는다).
  assert.match(viewer, /gridSelectionRangeKeys: spreadsheetSelectionRangeKeys/);
  assert.doesNotMatch(viewer, /function spreadsheetSelectionRangeKeys/);
  assert.match(source, /MNGridSelection/);

  // 4열짜리 표에서 (1,1)~(2,2) 는 네 칸이다.
  const keys = selection.gridSelectionRangeKeys({ row1:1, row2:2, col1:1, col2:2 }, 4);
  assert.equal(keys.size, 4);
  assert.ok(keys.has(1 * 4 + 1) && keys.has(2 * 4 + 2));

  // 이미 다 고른 범위를 Ctrl 로 다시 끌면 빼기가 된다는 판단의 근거.
  assert.equal(selection.gridSelectionRangeCovered(keys, { row1:1, row2:2, col1:1, col2:2 }, 4), true);
  assert.equal(selection.gridSelectionRangeCovered(keys, { row1:0, row2:2, col1:1, col2:2 }, 4), false);

  const wider = selection.gridSelectionCombineKeys(keys, { row1:0, row2:0, col1:0, col2:0 }, "add", 4);
  const bounds = selection.gridSelectionBoundsFromKeys(wider, 4);
  assert.deepEqual([bounds.row1, bounds.row2, bounds.col1, bounds.col2], [0, 2, 0, 2]);
  assert.equal(bounds.contiguous, false, "구멍이 있으면 사각형이 아니다");
  assert.equal(bounds.count, 5);

  // 어느 쪽을 먼저 눌렀든 같은 범위가 나온다.
  assert.deepEqual(selection.gridSelectionRangeBetween({ row:3, col:1 }, { row:1, col:2 }),
    { row1:1, row2:3, col1:1, col2:2 });
});

test("고른 칸은 붙여 넣기 좋은 탭 구분 글자로 옮긴다", () => {
  const selection = require("../src/js/grid-selection.js");
  const cells = [["1", "가", "x"], ["2", "나", "y"], ["3", "다", "z"]];
  const keys = selection.gridSelectionRangeKeys({ row1:0, row2:1, col1:0, col2:1 }, 3);
  assert.equal(selection.gridSelectionToText(keys, 3, (row, col) => cells[row][col]), "1\t가\n2\t나");
  // 흩어진 선택은 사각형으로 감싸되 고르지 않은 칸은 빈칸으로 둔다 — 고르지 않은 값을 끼워 넣지 않는다.
  const scattered = new Set([0, 3 * 1 + 1]);
  assert.equal(selection.gridSelectionToText(scattered, 3, (row, col) => cells[row][col]), "1\t\n\t나");
});

test("결과 표는 칸 단위로 고르고 정렬은 화살표 버튼만 받는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // 칸 고르기와 글자 긁기가 같은 드래그를 두고 다투지 않게 표의 글자 선택을 끈다.
  assert.match(css, /\.db-grid\{[^}]*user-select:none/);
  // 머리 전체가 정렬 버튼이면 열을 고를 자리가 없다 — 정렬은 별도 버튼으로 뺀다.
  assert.match(source, /const sortButton = button\(/);
  assert.match(source, /"db-sort-btn"/);
  assert.match(source, /event\.target\.closest\("\.db-sort-btn"\)\) return;/);
  assert.doesNotMatch(source, /db-sort-mark/);
  // 셀마다 리스너를 달지 않는다(1,000행 × 20열이면 리스너가 2만 개가 된다).
  assert.doesNotMatch(source, /td\.addEventListener/);
  assert.match(source, /table\.addEventListener\("pointerdown"/);
  // 왼쪽 번호 칸은 행, 컬럼명은 열, 왼쪽 위 모서리는 표 전체를 고른다.
  assert.match(source, /return col < 0 \? \{ kind:"row", row, col:0 \} : \{ kind:"cell", row, col \};/);
  assert.match(source, /kind:"all"/);
  // 행이 늘면 고른 자리의 뜻이 달라지므로 더 보기는 선택을 정리한다.
  assert.match(source, /clearGridSelection\(\);\s*\/\/ 행이 늘면/);
});

test("긴 값·여러 줄 값·NULL 은 값 창이 맡는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // 클릭은 고르는 일, 더블클릭은 그 칸을 여는 일로 나눈다(고칠 수 있으면 그 자리에서, 아니면 값 창).
  assert.match(source, /table\.addEventListener\("dblclick"/);
  assert.match(source, /point\.kind !== "cell"/);
  // 포인터 캡처를 쓰면 뒤따르는 마우스 이벤트가 캡처 대상(<table>)으로 가 셀을 찾지 못한다.
  // 끌기는 document 리스너로 받고, 더블클릭은 target 대신 좌표로 셀을 찾는다.
  assert.doesNotMatch(source, /table\.setPointerCapture/);
  assert.match(source, /document\.addEventListener\("pointermove", onDragMove, true\)/);
  assert.match(source, /const node = document\.elementFromPoint\(event\.clientX, event\.clientY\);/);
  // pointerdown 에서 preventDefault 를 부르면 뒤따르는 dblclick 까지 막힌다.
  // 글자 드래그는 CSS 가 막으므로 부르지 않는다.
  assert.doesNotMatch(source, /event\.preventDefault\(\);\s*\/\/ 글자 드래그/);
  assert.match(css, /\.db-grid\{[^}]*user-select:none/);
  // 결과 아래에 늘 자리를 차지하던 패널은 사라지고 모달 카드가 그 일을 맡는다.
  assert.doesNotMatch(source, /db-value-panel/);
  assert.doesNotMatch(css, /\.db-value-panel\{/);
  assert.match(source, /el\("div", "modal db-value-modal"\)/);
  assert.match(css, /\.db-value-card\{/);
  // Esc 는 맨 위의 창부터 닫는다 — 아래 창들이 값 창에 양보해야 엉뚱한 창이 닫히지 않는다.
  assert.match(source, /!document\.querySelector\("\.db-table-modal,\.db-value-modal"\)/);
  assert.match(source, /!document\.querySelector\("\.db-value-modal"\)/);
});

test("고칠 수 있는 결과인지는 열 이름이 아니라 서버가 알려 준 출처로 판정한다", () => {
  // 열 이름만으로는 별칭·조인·계산식을 가릴 수 없다. 드라이버가 서버에서 받아 둔
  // 필드 메타데이터(org_table·org_name)를 봐야 어느 테이블 어느 컬럼인지 알 수 있다.
  assert.match(worker, /def field_sources\(cursor\)/);
  assert.match(worker, /getattr\(field, "org_table"/);
  assert.match(worker, /getattr\(field, "org_name"/);
  // 커서에 다른 질의를 실행하면 이 메타데이터가 덮인다 — 읽는 자리가 execute 직후여야 한다.
  assert.match(worker, /sources = field_sources\(cursor\)\n\s*columns, kept_rows, more, clipped = read_rows/);
  // 한 베이스 테이블 + 기본키가 결과에 모두 실려 있을 때만 연다.
  assert.match(worker, /if len\(tables\) > 1:\n\s*return \{"editable": False, "reason": "multi-table"\}/);
  assert.match(worker, /if not meta\["base"\]:\n\s*return \{"editable": False, "reason": "view"\}/);
  assert.match(worker, /if not meta\["keys"\]:\n\s*return \{"editable": False, "reason": "no-key"\}/);
  assert.match(worker, /"reason": "key-missing"/);
  // 읽기 전용 접속에서는 판정 이전에 잠긴다.
  assert.match(worker, /if _state\["read_only"\]:\n\s*return \{"editable": False, "reason": "read-only"\}/);
  // 판정이 실패해도 결과 자체는 그대로 보여 준다(고치지 못할 뿐이다).
  assert.match(worker, /def safe_edit_plan\(/);
  assert.match(worker, /edit_candidates\.append\(\(entry, sources, columns\)\)/);
  assert.match(worker, /result_entry\["edit"\] = safe_edit_plan\(connection, sources, columns\)/);
});

test("기본키·계산식·이진·생성 컬럼 칸은 고치지 못하고 그 까닭을 밝힌다", () => {
  assert.match(worker, /cells\.append\(\{"editable": False, "reason": "key"/);
  assert.match(worker, /cells\.append\(\{"editable": False, "reason": "binary"/);
  assert.match(worker, /cells\.append\(\{"editable": False, "reason": "generated"/);
  assert.match(worker, /cells\.append\(\{"editable": False, "reason": "no-source"/);
  // 잠긴 이유를 밝히지 않으면 왜 어떤 칸만 되는지 사용자가 추측하게 된다.
  ["read-only", "no-source", "multi-table", "view", "no-key", "key-missing", "key", "binary", "generated"]
    .forEach((reason) => {
      assert.notEqual(client.editBlockNote({ reason }), client.editBlockNote({ reason: "없는이유" }),
        reason + " 에 해당하는 안내 문구가 있어야 한다");
    });
  // 빠진 기본키 컬럼 이름처럼 덧붙은 사실은 문구 뒤에 그대로 붙는다.
  assert.match(client.editBlockNote({ reason: "key-missing", detail: "id" }), /\(id\)$/);
});

test("고치기·지우기·넣기 모두 기본키 조건과 자리표시자로만 나간다", () => {
  // 값을 SQL 에 이어 붙이지 않는다 — 따옴표·줄바꿈·NULL 을 프런트가 떠맡는 순간 무너진다.
  assert.match(worker, /"UPDATE " \+ target \+ " SET " \+ quote_identifier\(column\)\n\s*\+ " = %s WHERE " \+ where, \[value\] \+ params/);
  assert.match(worker, /"DELETE FROM " \+ target \+ " WHERE " \+ where, params/);
  assert.match(worker, /", ".join\(\["%s"\] \* len\(columns\)\)/);
  assert.match(worker, /clauses\.append\(quote_identifier\(name\) \+ " = %s"\)/);
  // 조건은 언제나 기본키다. NULL 인 키 값으로는 행을 짚을 수 없으므로 거절한다.
  assert.match(worker, /raise RuntimeError\("bad-cell-key"\)/);
  // 읽기 전용 접속은 여기서도 막힌다(쿼리 경로에만 걸어 두면 셀 편집이 뒷문이 된다).
  assert.match(worker, /def apply_edits\(request\):[\s\S]*?if _state\["read_only"\]:\n\s*return \{"ok": False, "code": "read-only-blocked"/);
  // 런처는 SQL 을 만들지 않는다. 이름과 값을 JSON 값으로 옮기기만 한다.
  const helper = launcher.slice(launcher.indexOf("static string DbCellRequest"),
    launcher.indexOf("static string PollDbQuery"));
  assert.doesNotMatch(helper, /UPDATE|DELETE|INSERT|SELECT/);
  assert.match(helper, /else throw new Exception\("db-bad-change-kind"\)/);
  // 본문은 길이 접두 문자열의 평평한 줄이다. 프런트가 싣는 차례와 런처가 읽는 차례가
  // 어긋나면 값이 엉뚱한 칸으로 들어간다 — 두 쪽을 같은 순서로 못박아 둔다.
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /parts\.push\(change\.column, change\.isNull \? "" : change\.value, change\.isNull \? "1" : "0"\);\n\s*pushKeys\(parts, change\.keys\);/);
  assert.match(helper, /string column = ReadBundleString\(body, ref pos\);\n\s*string value = ReadBundleString\(body, ref pos\);\n\s*string valueNull = ReadBundleString\(body, ref pos\);/);
  assert.match(source, /const parts = \[staged\.target\.database \|\| "", staged\.target\.table, String\(staged\.list\.length\)\]/);
  assert.match(helper, /string database = ReadBundleString\(body, ref pos\);\n\s*string table = ReadBundleString\(body, ref pos\);/);
  // 쓰는 길은 하나다. 셀 하나만 따로 쓰는 뒷문을 남기지 않는다.
  assert.doesNotMatch(worker, /def update_cell\(/);
  assert.doesNotMatch(launcher, /"cell-update"/);
});

test("담아 둔 변경은 한 묶음으로 적용되고 실패하면 그 묶음만 되돌아간다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // ⚠ 수동 커밋 모드에서 rollback() 을 부르면 사용자가 앞서 쌓아 둔 변경까지 사라진다.
  // 세이브포인트로 이 묶음만 되돌린다. 자동 커밋 모드에서는 묶음을 트랜잭션으로 연다.
  assert.match(worker, /cursor\.execute\("SAVEPOINT classdock_edit"\)/);
  assert.match(worker, /cursor\.execute\("ROLLBACK TO SAVEPOINT classdock_edit"\)/);
  assert.match(worker, /cursor\.execute\("RELEASE SAVEPOINT classdock_edit"\)/);
  assert.match(worker, /else:\n\s*connection\.begin\(\)/);
  assert.match(worker, /failure\["applied"\] = 0/);
  // 순서: 고치기 → 지우기 → 넣기. 지운 기본키를 같은 묶음에서 다시 넣을 수 있다.
  assert.match(worker, /order = \{"update": 0, "delete": 1, "insert": 2\}/);
  // 절반만 들어갔다고 오해하게 두지 않는다.
  assert.match(source, /아무것도 반영되지 않았습니다/);
});

test("미리보기 문장은 사람이 읽는 것이고 이름과 값을 모두 인용한다", () => {
  const sql = client.cellUpdatePreview({ database: "school", table: "score" }, "점수",
    [{ name: "id", value: "3" }], "9'5", false);
  assert.equal(sql, "UPDATE `school`.`score` SET `점수` = '9''5' WHERE `id` = '3'");
  // NULL 은 따옴표 없이 그대로 적는다 — 빈 문자열과 구분되어야 한다.
  assert.match(client.cellUpdatePreview({ table: "score" }, "메모", [{ name: "id", value: "3" }], "", true),
    /SET `메모` = NULL WHERE/);
  // 데이터베이스 이름이 없으면 테이블 이름만 적는다.
  assert.match(client.cellUpdatePreview({ table: "score" }, "메모", [{ name: "id", value: "3" }], "x", false),
    /^UPDATE `score` SET/);
  // 복합 기본키는 조건을 모두 적는다.
  assert.match(client.cellUpdatePreview({ table: "t" }, "v",
    [{ name: "a", value: "1" }, { name: "b", value: "2" }], "x", false), /WHERE `a` = '1' AND `b` = '2'$/);
});

test("반영 0행은 값이 같은 것과 행이 사라진 것을 가른다", () => {
  // MySQL 은 값이 이미 같으면 0행 반영이라고 답한다. 그 행이 아직 있는지 물어 둘을 가른다.
  assert.match(worker, /def row_exists\(cursor, target, where, params\)/);
  // 사라진 행을 고치라는 요청은 실패로 본다 — 말없이 아무 일도 일어나지 않는 것이 제일 나쁘다.
  assert.match(worker, /elif row_exists\(cursor, target, where, key_params\):\n\s*counts\["unchanged"\] \+= 1\n\s*else:\n\s*raise RuntimeError\("row-gone"\)/);
  // 사라진 행을 지우라는 요청은 뜻이 이미 이루어진 것이라 몇 건인지만 알린다.
  assert.match(worker, /elif kind == "delete":\n\s*counts\["missing"\] \+= 1/);
  assert.match(client.messageFor({ code: "row-gone" }), /다시 조회/);
  // 수동 커밋이면 이 변경도 "커밋하지 않은 변경"으로 센다.
  assert.match(worker, /if manual:\n\s*_state\["pending"\] = True/);
});

test("잘려 온 값은 그대로 저장하지 않고 원본을 다시 읽는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 표의 값은 500자에서 잘려 있을 수 있다. 그 글자를 저장하면 서버의 값이 잘린 채로 덮인다.
  assert.match(worker, /def read_cell\(request\)/);
  assert.match(worker, /text\[:MAX_EDIT_CHARS\], "clipped": len\(text\) > MAX_EDIT_CHARS/);
  assert.match(source, /if \(!edit\.staged && \(edit\.clipped \|\| isNull\)\)\{/);
  assert.match(source, /current = await readFullCell\(edit\)/);
  // 이미 담아 둔 칸은 서버가 아니라 담아 둔 값에서 이어 고친다(서버 값은 아직 옛 값이다).
  assert.match(source, /let current = edit\.staged/);
  // 이진 값은 글자로 고칠 수 없다.
  assert.match(worker, /return \{"ok": False, "code": "binary-cell"/);
  // 기본키가 잘려 왔으면 그 값으로 행을 짚을 수 없으므로 고치기도 지우기도 열지 않는다.
  assert.match(source, /node\.classList\.contains\("db-clipped"\)\)\n\s*return \{ error:"기본키 값이 길어/);
});

test("셀 편집은 값 창 안에서만 열리고 무엇이 실행될지 먼저 보여 준다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // 고치기 버튼은 워커가 "고칠 수 있다"고 판정했을 때만 보인다.
  assert.match(source, /editButton\.hidden = !\(edit && edit\.editable\)/);
  // GUI 로 고친 일이 어떤 SQL 이 되는지 보여 준다 — SQL 을 배우는 도구라 감추지 않는다.
  assert.match(source, /preview\.textContent = cellUpdatePreview\(/);
  assert.match(source, /이 문장이 실행됩니다/);
  // NULL 과 빈 문자열은 다른 값이라 입력칸이 아니라 체크로 가른다.
  assert.match(source, /빈 값\(NULL\)으로 두기/);
  assert.match(source, /if \(nullBox\.checked && !edit\.nullable\)/);
  // 여러 줄 값을 다루므로 Enter 는 줄바꿈이고 담기는 Ctrl\+Enter 다.
  assert.match(source, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/);
  // 고치던 중의 Esc·바깥 클릭은 창이 아니라 고치기를 먼저 접는다.
  assert.match(source, /if \(editing\) stopEdit\(\);/);
  assert.match(source, /event\.target === modal && !editing/);
  assert.match(css, /\.db-value-input\{/);
  // 값 창은 서버에 쓰지 않는다. 변경 목록에 담고 적용은 한곳에서 한다.
  assert.match(source, /const kept = stageUpdate\(edit, input\.value, nullBox\.checked\);/);
  assert.match(css, /\.db-grid td\.db-cell-staged\{/);
});

test("변경은 담아 두었다가 한 번에 적용하고, 무엇이 나갈지 문장으로 보여 준다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // 담아 둔 변경이 있을 때만 변경 바가 나오고, 적용 전에는 서버에 아무것도 가지 않는다.
  assert.match(source, /editBar\.hidden = !count/);
  assert.match(source, /resultPane\.append\(resultBar, resultTabs, editBar, resultHost\)/);
  assert.match(css, /\.db-edit-bar\{/);
  // 담은 칸·지울 행은 화면에서 구분된다(지금 화면과 서버가 다르다는 사실을 계속 알린다).
  assert.match(source, /node\.classList\.add\("db-cell-staged"\)/);
  assert.match(source, /tr\.classList\.toggle\("db-row-staged", on\)/);
  assert.match(css, /\.db-grid tbody tr\.db-row-staged td\{/);
  // 미리보기는 나갈 문장을 그대로 보여 주고 하나씩 뺄 수 있다.
  assert.match(source, /const openChangesModal = \(\) => \{/);
  assert.match(source, /remove\.addEventListener\("click", \(\) => \{ unstage\(change\.id\); render\(\); \}\);/);
  // 다시 그리면 되돌릴 자리가 사라지므로 먼저 묻는다.
  assert.match(source, /const confirmLosingStaged = async \(\) => \{/);
  assert.match(source, /if \(!await confirmLosingStaged\(\)\) return false;/);
  // 적용한 뒤에는 다시 조회해 화면과 서버를 맞춘다.
  assert.match(source, /const reloadFor = \(entry\) => \{/);
  assert.match(source, /reload:\(\) => showTable\(name\)/);
});

test("행 삭제는 고른 행의 기본키로만 걸고, 행 추가는 테이블 정의 전체를 늘어놓는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 고른 칸이 걸친 행을 지운다. 칸 하나는 `행 * 열수 + 열` 정수 하나로 담겨 있다.
  assert.match(source, /gridSelection\.keys\.forEach\(key => rows\.add\(Math\.floor\(key \/ count\)\)\)/);
  // 못 짚는 행은 지우지도 고치지도 않는다(엉뚱한 행이 사라지면 되돌릴 수 없다).
  assert.match(source, /const rowKeyValues = \(row\) => \{/);
  assert.match(source, /if \(found\.error\)\{ blocked = found\.error; return; \}/);
  // 지울 행에 담아 둔 값 수정은 뜻이 없으므로 함께 뺀다.
  assert.match(source, /staged\.list\.filter\(item => item\.kind === "update" && item\.row === row\)/);
  // 결과에 실린 열만으로는 넣을 수 없다 — 조회하지 않은 컬럼도 채워야 한다.
  assert.match(source, /"\/db-table\?id=" \+ encodeURIComponent\(sessionId\) \+ "&mode=info"/);
  // 자동 증가·생성 컬럼은 사람이 채우지 않고, 값이 꼭 필요한 컬럼은 처음부터 `값` 으로 연다.
  assert.match(source, /extra\.indexOf\("AUTO_INCREMENT"\) >= 0 \|\| extra\.indexOf\("GENERATED"\) >= 0/);
  assert.match(source, /const required = !column\.nullable && column\.default == null && !auto;/);
  // 적지 않은 칸은 서버의 기본값에 맡긴다(빈 문자열을 넣어 버리지 않는다).
  assert.match(source, /fields\.filter\(item => !item\.auto && item\.mode\.value !== "default"\)/);
  // 컬럼 머리를 누르면 열 전체 = 보이는 행 전부가 대상이 된다. 많은 행은 담기 전에 먼저 묻는다.
  assert.match(source, /if \(rows\.length >= 10 && typeof confirmDialog === "function"\)/);
  // 담을 수 있는 상한은 워커가 한 묶음으로 받는 상한과 같아야 한다(담고 나서 거절당하면 안 된다).
  assert.match(source, /const MAX_STAGED = 500;/);
  assert.match(worker, /MAX_BATCH_CHANGES = 500/);
});

test("표 안에서 바로 타자를 쳐 고치고, 방향키로 칸을 옮긴다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // 지금 칸(캐럿)을 따로 들고 다녀야 Enter 뒤에 어디로 갈지 알 수 있다.
  assert.match(source, /let gridCaret = null;/);
  assert.match(source, /const steps = \{ arrowup:\[-1, 0\], arrowdown:\[1, 0\], arrowleft:\[0, -1\], arrowright:\[0, 1\] \}/);
  // F2·Enter 로 시작하고 Enter 는 담고 아래로, Tab 은 담고 옆으로, Esc 는 되돌린다.
  assert.match(source, /key === "f2" \|\| key === "enter"/);
  assert.match(source, /commitInlineEdit\(\);\n\s*focusGrid\(\);\n\s*moveCaret\(1, 0, false\);/);
  assert.match(source, /const next = nextEditableCol\(from, event\.shiftKey \? -1 : 1\);/);
  assert.match(source, /if \(event\.key === "Escape"\)\{ event\.preventDefault\(\); cancelInlineEdit\(\); focusGrid\(\); return; \}/);
  // 담기는 값 창과 같은 길을 쓴다. 입력하는 자리만 다를 뿐 서버로 가는 때는 하나다.
  assert.match(source, /stageUpdate\(context, value, false\);/);
  // 두 번 누르기·F2·타자가 모두 한 길로 모인다 — "어떨 때 무엇이 열리는지"를 하나로 설명할 수 있어야 한다.
  assert.match(source, /gridCaret = \{ row:point\.row, col:point\.col \};\n\s*openCellAt\(point\.row, point\.col\);/);
  assert.doesNotMatch(source, /beginInlineEdit/);
  // 칸 밖으로 나가면 담는다(엑셀과 같다). 다시 들어오지 않게 상태를 먼저 지운다.
  assert.match(source, /input\.addEventListener\("blur", \(\) => \{ if \(inlineEdit && inlineEdit\.input === input\) commitInlineEdit\(\); \}\);/);
  assert.match(css, /\.db-cell-input\{/);
});

test("한 줄 입력칸이 담아내지 못하는 값은 값 창으로 보낸다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // input 은 값에 든 줄바꿈을 조용히 지운다. 그대로 담으면 서버의 줄이 사라진다.
  assert.match(source, /if \(clipped \|\| \/\[\\r\\n\]\/\.test\(text\)\)\n\s*return \{ note:"여러 줄 값과 잘려 온 값은 값 창에서 고칩니다\.", modal:true \};/);
  assert.match(source, /if \(!startInlineEdit\(row, col, initial\)\) return;/);
  // NULL 칸을 빈 채로 지나가면 아무 일도 하지 않는다(빈 문자열은 NULL 과 다른 값이다).
  assert.match(source, /if \(before\.isNull && value === ""\) return;/);
});

test("한글 IME 는 첫 글자 조합을 끊지 않고 그 칸에서 시작한다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const sheet = fs.readFileSync(path.join(root, "src", "js", "spreadsheet-viewer.js"), "utf8");
  // ⚠ 한글은 keydown 이 Process(229) 로 온다. preventDefault 하면 첫 글자가 사라진다.
  assert.match(source, /const ime = event\.key === "Process" \|\| event\.keyCode === 229;/);
  assert.match(source, /if \(!ime\) event\.preventDefault\(\);/);
  assert.match(source, /openCellAt\(caret\.row, caret\.col, ime \? "" : event\.key\);/);
  // 스프레드시트 뷰어가 같은 이유로 같은 방식을 쓴다. 두 도구가 갈라지지 않게 함께 본다.
  assert.match(sheet, /e\.key === "Process" \|\| e\.keyCode === 229/);
});

test("삭제·추가 미리보기 문장도 이름과 값을 모두 인용한다", () => {
  assert.equal(client.rowDeletePreview({ database: "school", table: "score" }, [{ name: "id", value: "3" }]),
    "DELETE FROM `school`.`score` WHERE `id` = '3'");
  assert.equal(client.rowInsertPreview({ table: "score" },
    [{ column: "이름", value: "가'나" }, { column: "점수", value: "", isNull: true }]),
    "INSERT INTO `score` (`이름`, `점수`) VALUES ('가''나', NULL)");
  // 값을 하나도 적지 않은 행 = 전부 기본값. MySQL 이 받는 문장이라 그대로 보여 준다.
  assert.equal(client.rowInsertPreview({ table: "score" }, []), "INSERT INTO `score` () VALUES ()");
});

test("셀 편집 판정과 UPDATE 조립은 서버 없이도 같은 결과를 낸다",
  { skip: python.status !== 0 && "python 없음" }, () => {
  // 가짜 커넥션으로 워커를 직접 돌린다. 무엇이 잠기는지와 어떤 문장이 나가는지를
  // MySQL 없이 못박아 둔다 — 특히 숫자·날짜가 이진 컬레이션(63)으로 온다는 함정을.
  const run = spawnSync("python", [path.join(root, "tests", "fixtures", "db-cell-edit-probe.py"),
    path.join(root, "desktop")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /ok/);
});

test("db-client.js 는 브라우저 전역 없이도 순수 함수만 노출한다", () => {
  // 최상위 const 는 컨텍스트 객체의 속성이 되지 않는다 — 원격 터미널 테스트와 같은 방식으로 꺼낸다.
  const context = { TextEncoder, module: { exports: {} } };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  vm.runInNewContext(source + "\nglobalThis.__dbClientApi = MNDbClient;", context);
  assert.equal(typeof context.__dbClientApi.mount, "function");
  assert.equal(typeof context.__dbClientApi.emptyProfile().host, "string");
});
