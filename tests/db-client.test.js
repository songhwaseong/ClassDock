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

test("프로시저·함수·이벤트와 테이블 하위 트리거는 정의문을 정의 창에서 연다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(worker, /information_schema\.ROUTINES/);
  assert.match(worker, /information_schema\.EVENTS/);
  assert.match(worker, /information_schema\.TRIGGERS/);
  assert.match(worker, /def load_object_ddl\(kind, name, database=""\)/);
  // 정의문 조회는 덤프와 같은 헬퍼를 쓴다(SHOW CREATE 문법이 두 벌로 갈라지지 않게).
  assert.match(worker, /SHOW CREATE " \+ OBJECT_KEYWORDS\[kind\]/);
  assert.match(worker, /ddl = show_create_object\(cursor, normalized, name, schema\)/);
  assert.match(launcher, /path\.StartsWith\("\/db-object\?"/);
  assert.match(source, /const openObjectInfoModal = async \(item\)/);
  assert.match(source, /tableSection\(item, "indexes", "Indexes", "index"/);
  assert.match(source, /tableSection\(item, "foreignKeys", "Foreign Keys", "foreignKey"/);
  assert.match(source, /tableSection\(item, "triggers", "Triggers", "trigger"/);
  assert.match(source, /openTableInfoModal\(item\.name, "indexes"\)/);
  assert.match(source, /openTableInfoModal\(item\.name, "foreignKeys"\)/);
  assert.match(source, /el\("pre", "db-table-ddl", ddl \|\| "정의문이 없습니다\."\)/);
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

test("SQL Ctrl+클릭은 호출 형태의 프로시저·함수와 EVENT 뒤의 이벤트를 루틴 대상으로 해석한다", () => {
  const objects = [
    { type:"table", name:"orders" },
    { type:"procedure", name:"sp_settle" },
    { type:"function", name:"fn_total" },
    { type:"event", name:"ev_nightly" },
    { type:"trigger", name:"trg_orders", table:"orders" }
  ];
  const at = (sql, word, from) => {
    const start = from == null ? sql.indexOf(word) : sql.indexOf(word, from);
    return client.sqlDefinitionTargetAt(sql, { word, start, end:start + word.length, point:start }, objects);
  };

  // CALL 뒤, 그리고 역따옴표·스키마 한정이 붙은 형태.
  assert.equal(at("CALL sp_settle(1)", "sp_settle").kind, "routine");
  assert.equal(at("CALL `sp_settle`(1)", "sp_settle").name, "sp_settle");
  assert.equal(at("CALL shop.sp_settle(1)", "sp_settle").kind, "routine");
  // 함수는 호출 괄호만으로 충분하다. 여는 괄호 앞 공백도 허용한다.
  assert.equal(at("SELECT fn_total (id) FROM orders", "fn_total").kind, "routine");
  // DDL 문장의 키워드 뒤.
  assert.equal(at("DROP PROCEDURE sp_settle", "sp_settle").kind, "routine");
  assert.equal(at("ALTER EVENT ev_nightly DISABLE", "ev_nightly").kind, "routine");
  assert.equal(at("DROP TRIGGER trg_orders", "trg_orders").kind, "routine");
  assert.equal(at("DROP TRIGGER shop.trg_orders", "trg_orders").item.type, "trigger");
  // 루틴 대상은 항목 자체를 함께 넘겨야 정보 창이 종류·설명을 그릴 수 있다.
  assert.equal(at("CALL sp_settle(1)", "sp_settle").item.type, "procedure");
});

test("SQL Ctrl+클릭은 호출 형태가 아닌 루틴·이벤트·트리거 이름은 대상으로 보지 않는다", () => {
  const objects = [
    { type:"table", name:"orders" },
    { type:"procedure", name:"sp_settle" },
    { type:"event", name:"ev_nightly" },
    { type:"trigger", name:"trg_orders", table:"orders" }
  ];
  const at = (sql, word) => {
    const start = sql.indexOf(word);
    return client.sqlDefinitionTargetAt(sql, { word, end:start + word.length, start, point:start }, objects);
  };
  // 주석·문자열 안에서 이름만 같은 낱말은 링크가 되면 안 된다.
  assert.equal(at("-- sp_settle 을 손보자\nSELECT 1", "sp_settle"), null);
  assert.equal(at("SELECT 'sp_settle' FROM orders", "sp_settle"), null);
  // 이벤트는 호출 문법이 없어 EVENT 키워드 없이는 대상이 아니다.
  assert.equal(at("SELECT ev_nightly FROM orders", "ev_nightly"), null);
  // 트리거·이벤트는 호출되지 않으므로 괄호가 뒤따라도 그것만으로는 참조가 아니다.
  assert.equal(at("SELECT trg_orders(1)", "trg_orders"), null);
  assert.equal(at("SELECT ev_nightly(1)", "ev_nightly"), null);
});

test("이름이 겹치면 테이블·뷰가 루틴보다 먼저다", () => {
  const objects = [
    { type:"view", name:"orders" },
    { type:"function", name:"orders" }
  ];
  const sql = "SELECT * FROM orders";
  const start = sql.indexOf("orders");
  const target = client.sqlDefinitionTargetAt(sql,
    { word:"orders", start, end:start + 6, point:start }, objects);
  // 뷰도 테이블 정보 창으로 연다 — 예전에는 type==="table" 만 봐서 뷰가 빠져 있었다.
  assert.equal(target.kind, "table");
  assert.equal(target.item.type, "view");
});

test("루틴 매개변수는 정의문에서 읽고 중첩 괄호·역따옴표를 세지 않는다", () => {
  const ddl = "CREATE DEFINER=`root`@`%` PROCEDURE `sp_settle`("
    + "IN `from(day)` DATE, OUT total DECIMAL(10,2) UNSIGNED, INOUT note VARCHAR(20)) BEGIN END";
  const parameters = client.routineParameters(ddl, "procedure");
  assert.equal(parameters.length, 3);
  // 역따옴표 이름 안의 괄호를 매개변수 목록의 끝으로 오해하면 안 된다.
  assert.deepEqual(parameters[0], { name:"from(day)", direction:"IN", type:"DATE" });
  // DECIMAL(10,2) 의 쉼표는 매개변수 구분자가 아니다.
  assert.deepEqual(parameters[1], { name:"total", direction:"OUT", type:"DECIMAL(10,2) UNSIGNED" });
  assert.equal(parameters[2].direction, "INOUT");

  // 함수는 방향 표기가 없고, 생략하면 IN 으로 읽는다.
  const fn = client.routineParameters("CREATE FUNCTION fn_total(qty INT, price DECIMAL(8,2)) RETURNS DECIMAL(10,2)", "function");
  assert.deepEqual(fn.map(item => item.name), ["qty", "price"]);
  assert.equal(fn[0].direction, "IN");

  // 매개변수가 없는 정의, 정의문을 못 읽은 경우, 이벤트는 모두 빈 목록이다.
  assert.deepEqual(client.routineParameters("CREATE PROCEDURE sp_none() BEGIN END", "procedure"), []);
  assert.deepEqual(client.routineParameters("", "procedure"), []);
  assert.deepEqual(client.routineParameters("CREATE EVENT ev_nightly ON SCHEDULE", "event"), []);
});

test("객체 정의 창은 결과 패널을 지우지 않고 테이블 정보 창과 같은 자리에 뜬다", () => {
  const db = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const start = db.indexOf("const openObjectInfoModal");
  assert.ok(start > 0, "openObjectInfoModal 이 있어야 한다");
  const bodyEnd = db.indexOf("const openTableInfoModal", start);
  const body = db.slice(start, bodyEnd);
  // Ctrl+클릭은 잠깐 들여다보는 동작이라 실행 결과를 건드리면 안 된다.
  assert.ok(!/clearResult\(\)/.test(body), "객체 정의 창은 결과를 지우지 않는다");
  // 테이블 정보 창과 클래스를 공유해 두 창이 겹쳐 뜨지 않게 한다.
  assert.match(body, /db-table-modal db-object-modal/);
  assert.match(body, /document\.querySelector\("\.db-table-modal"\)/);
  // 정의는 이미 있는 /db-object 를 그대로 쓴다 — 서버 쪽 변경이 필요 없다.
  assert.match(body, /\/db-object\?id=/);
});

test("트리의 정의 보기는 결과 패널이 아니라 Ctrl+클릭과 같은 정의 창을 연다", () => {
  const db = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 컨텍스트 메뉴의 테이블/그 밖 객체 분기가 둘 다 모달로 간다.
  assert.match(db, /if \(tableTarget\) openTableInfoModal\(item\.table \|\| item\.name, childTab\);\s*\n\s*else openObjectInfoModal\(item\);/);
  // 왼쪽 클릭도 같은 창을 쓴다. 테이블·뷰만 결과 패널에 내용을 편다 — 그건 정의가 아니라 데이터다.
  assert.match(db, /if \(item\.type === "table" \|\| item\.type === "view"\) showTable\(item\.name\);\s*\n\s*else openObjectInfoModal\(item\);/);
  // 테이블 아래 트리거도 마찬가지다.
  assert.match(db, /bindSchemaObjectNode\(node, child, \(\) => openObjectInfoModal\(child\)\)/);
  // 정의를 결과 패널에 그리던 옛 경로는 남아 있으면 안 된다(두 가지 표현이 다시 갈린다).
  assert.ok(!db.includes("showSchemaObject"), "showSchemaObject 는 지워져야 한다");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.ok(!css.includes("db-schema-definition"), "쓰지 않는 정의 카드 CSS 도 함께 지운다");
  assert.match(db, /DEFINITION_OBJECT_KINDS = \{ procedure:true, function:true, event:true, trigger:true \}/);
  assert.match(db, /LINKABLE_OBJECT_KINDS = \{ procedure:true, function:true, event:true, trigger:true \}/);
  assert.match(db, /LINKABLE_OBJECT_KINDS\[candidate\.type\]/);

  // 정의 창은 종류별로 다른 개요를 그린다 — 트리거는 어느 테이블에 언제 걸리는지가 핵심이다.
  const start = db.indexOf("const openObjectInfoModal");
  const body = db.slice(start, db.indexOf("const openTableInfoModal", start));
  assert.match(body, /DEFINITION_OBJECT_KINDS\[kind\]/);
  assert.match(body, /"대상 테이블"/);
  assert.match(body, /"시점"/);
  // 매개변수 탭은 프로시저·함수에만 붙는다.
  assert.match(body, /const hasParameters = kind === "procedure" \|\| kind === "function"/);
  assert.match(body, /const paramsTab = hasParameters/);
});

test("스키마 패널은 툴바 버튼으로 접히고, 접힌 상태와 폭을 따로 기억한다", () => {
  const db = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

  // 접힘은 폭과 다른 칸에 저장한다. 폭 자리에 0 을 넣으면 다시 펼 때 쓰던 폭을 잃는다.
  assert.match(db, /SIDEBAR_COLLAPSED_KEY = "classdockDbSidebarCollapsedV1"/);
  assert.notEqual("classdockDbSidebarCollapsedV1", "classdockDbSidebarV1");
  assert.match(db, /storeSidebarCollapsed\(sidebarCollapsed\)/);
  // 다시 펼 때 저장해 둔 폭을 상한에 다시 재운다(접힌 사이 창이 줄었을 수 있다).
  assert.match(db, /if \(!sidebarCollapsed\) setSidebarWidth\(readSidebarWidth\(\) \|\| SIDEBAR_DEFAULT, false\)/);
  // 접속해서 작업 화면이 올라올 때 저장된 상태를 되살린다.
  assert.match(db, /if \(connected\)\{\s*\n\s*applySidebarCollapsed\(\);/);

  // 폭만 0 으로 만들면 눈에서만 사라지고 Tab·스크린리더는 그대로 들어간다 → 통째로 감춘다.
  assert.match(db, /sidebar\.hidden = sidebarCollapsed;/);
  assert.match(db, /divider\.hidden = sidebarCollapsed;/);
  assert.match(css, /\.db-sidebar\[hidden\],\.db-divider\[hidden\]\{display:none\}/);
  // 감추기 전에 포커스를 버튼으로 옮긴다. display:none 뒤에는 body 로 떨어진다.
  assert.match(db, /if \(sidebarCollapsed && sidebar\.contains\(document\.activeElement\)\) schemaPanelButton\.focus\(\);/);

  // 남은 한 칸을 편집기가 쓰도록 격자를 다시 잡는다. 좁은 화면의 2행 배치도 함께 되돌린다.
  assert.match(css, /\.db-workspace\.db-sidebar-collapsed\{grid-template-columns:minmax\(0,1fr\);grid-template-rows:minmax\(0,1fr\)\}/);

  // 분할선 더블클릭은 여전히 "기본 너비로"다 — 접기로 바꿔 뜻을 흔들지 않는다.
  assert.match(db, /divider\.addEventListener\("dblclick", \(event\) => \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*setSidebarWidth\(SIDEBAR_DEFAULT, true\);/);
  assert.match(db, /더블클릭: 기본 너비로/);
});

test("트리거는 트리 최상위 그룹으로도 오고 스키마 목록에 실려 Ctrl+클릭까지 닿는다", () => {
  const db = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 최상위 그룹. 테이블처럼 펼칠 하위 구조가 없으므로 expandable 을 주지 않는다.
  assert.match(db, /\{ type:"trigger", label:"Triggers", icon:"trigger" \}/);
  // 스키마 응답의 triggers 를 목록에 합쳐야 자동완성과 Ctrl+클릭이 트리거를 안다.
  assert.match(db, /\.\.\.\(Array\.isArray\(info\.triggers\) \? info\.triggers : \[\]\)/);
  // 이름만으로는 어느 테이블 것인지 모르므로 트리 항목에 테이블을 함께 적는다.
  assert.match(db, /item\.type === "trigger" && item\.table/);

  // 워커가 스키마를 읽을 때 트리거도 한 번에 가져온다 — 테이블을 펼칠 때까지 기다리지 않는다.
  assert.match(worker, /"triggers": \[\], "current": ""/);
  assert.match(worker, /SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING/);
  assert.match(worker, /FROM information_schema\.TRIGGERS WHERE TRIGGER_SCHEMA = %s "/);
  assert.match(worker, /"type": "trigger", "table": str\(item\[1\] or ""\)/);
  // 다른 스키마 객체와 같은 상한을 쓴다.
  assert.match(worker, /ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, TRIGGER_NAME LIMIT %s/);
});

test("공용 편집기는 외부 정의 대상만 Ctrl+클릭 링크로 열 수 있다", () => {
  const editor = fs.readFileSync(path.join(root, "src", "js", "python-editor.js"), "utf8");
  const db = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(editor, /options\.definitionTargetAt\(\{ source:ta\.value, wordInfo \}\)/);
  assert.match(editor, /options\.openDefinitionTarget\(\{ source:ta\.value, wordInfo, target:externalTarget \}\)/);
  assert.match(editor, /const canOpen = typeof options\.definitionTargetAt !== "function" \|\| !!externalTarget/);
  assert.match(db, /definitionTargetAt: \(\{ source, wordInfo \}\) => sqlDefinitionTargetAt\(source, wordInfo, schemaObjects\)/);
  assert.match(db, /openTableInfoModal\(target\.name\)/);
  assert.match(db, /openObjectInfoModal\(target\.item\)/);
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

test("SQL 덤프는 구조와 데이터를 순서대로 적고 실패하면 파일을 남기지 않는다",
  { skip: python.status !== 0 && "python 없음" }, () => {
    const run = spawnSync("python", [path.join(root, "tests", "fixtures", "db-dump-probe.py"),
      path.join(root, "desktop")], { encoding:"utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /ok/);
    // 데이터는 서버사이드 커서로 흘려 읽는다. 기본 커서는 큰 테이블을 통째로 메모리에 올린다.
    assert.match(worker, /connection\.cursor\(driver\.cursors\.SSCursor\)/);
    // 덤프는 사용자 세션이 아니라 전용 커넥션에서 돈다(열어 둔 트랜잭션을 건드리지 않게).
    // consistent 옵션은 그 전용 커넥션으로 전달된다. 다만 구조만 뽑을 때는 읽을 데이터가
    // 없으므로 스냅샷을 열지 않는다(needs_data 로 걸러 넘긴다).
    assert.match(worker, /needs_data = mode in \("data", "both"\)/);
    assert.match(worker,
      /dump_connection, dump_id = open_dump_connection\(driver, needs_data and options\["consistent"\]\)/);
    // 받은 값이 참일 때만 스냅샷을 연다 — 전달된 옵션이 실제로 스냅샷을 가른다.
    assert.match(worker,
      /def open_dump_connection\(driver, consistent\):[\s\S]*?if consistent:[\s\S]{0,200}?cursor\.execute\("START TRANSACTION WITH CONSISTENT SNAPSHOT"\)/);
    assert.match(worker, /finally:[\s\S]{0,80}?close_dump_connection\(dump_connection\)/);
    // 덤프 값은 표시용 cell() 을 거치면 안 된다(500자 절단·BLOB 치환이 그대로 파일에 실린다).
    const dumpSource = worker.slice(worker.indexOf("def choose_script_delimiter("),
      worker.indexOf("def handle(request):"));
    const literalSource = worker.slice(worker.indexOf("def sql_literal("), worker.indexOf("def elapsed_ms("));
    assert.ok(dumpSource.length > 0 && literalSource.length > 0, "덤프 코드를 찾지 못했다");
    // 설명하는 주석·독스트링은 빼고 실제 호출만 본다(규칙을 적어 둔 문장이 걸리지 않게).
    const code = (dumpSource + literalSource).replace(/"""[\s\S]*?"""/g, "").replace(/#[^\n]*/g, "");
    assert.ok(!/\bcell\(/.test(code), "덤프 경로가 표시용 cell() 을 부른다");
    // 저장 위치 정책은 런처가 쥔다 — 워커는 받은 경로에 쓰기만 한다.
    assert.match(worker, /def dump_schema\(request\):[\s\S]*path = str\(request\.get\("path"\) or ""\)/);
    assert.ok(!/os\.path\.join\([^)]*SaveRoot/i.test(worker), "워커가 저장 경로를 스스로 만든다");
  });

test("덤프는 진행 보고를 흘리고 런처가 그것을 폴링 응답에 싣는다", () => {
  // 워커: 최종 응답('+'/'-')과 진행 보고('*')를 접두 문자로 가른다.
  assert.match(worker, /sys\.__stdout__\.write\("\*" \+ encoded \+ "\\n"\)/);
  assert.match(worker, /def progress_reporter\(\):/);
  // 런처: '*' 줄은 콜백에 넘기고 계속 읽는다(요청 하나에 응답 하나라는 규약은 그대로).
  assert.match(launcher, /line\[0\] != '\*'/);
  assert.match(launcher, /if \(line\[0\] == '\*'\)\s*\n\s*\{\s*\n\s*if \(onProgress != null\) onProgress\(body\);/);
  // 제한 시간은 "줄 하나를 기다리는 시간"이다 — 진행 보고가 오는 동안 다시 잡힌다.
  assert.match(launcher, /while \(true\)\s*\n\s*\{\s*\n\s*string responseLine = null;/);
  assert.match(launcher, /const int DbDumpIdleMs = 120 \* 1000;/);
  // 폴링 응답에 마지막 진행 JSON 을 그대로 싣는다.
  assert.match(launcher, /public string Progress = "";/);
  assert.match(launcher, /",\\"progress\\":" \+ job\.Progress/);
  // 기존 호출부가 그대로 돌도록 콜백 없는 갈래를 남긴다.
  assert.match(launcher, /static string DbExchange\(DbSession session, string requestJson, int timeoutMs\)/);
});

// 요청 값의 순서가 한 자리라도 어긋나면 오류 없이 다른 옵션으로 덤프된다.
// 프런트가 싣는 순서와 런처가 읽는 순서를 나란히 놓고 본다.
const DUMP_FIELDS = ["fileName", "mode", "dropIfExists", "createIfNotExists",
  "insertForm", "columnNames", "rowLimit", "consistent", "database"];

test("덤프 요청 값의 순서는 프런트와 런처가 같다", () => {
  const dump = require("../src/js/db-dump.js");
  const values = dump.requestValues({
    name:"shop.sql", mode:"both", database:"shop",
    dropIfExists:true, createIfNotExists:false, insertForm:"ignore",
    columnNames:true, rowLimit:"50", consistent:true,
    objects:[{ kind:"table", name:"orders" }, { kind:"view", name:"v_top" }]
  });
  assert.deepEqual(values, ["shop.sql", "both", "1", "0", "ignore", "1", "50", "1", "shop",
    "2", "table", "orders", "view", "v_top"]);

  // 런처가 ReadBundleString 으로 읽어 가는 순서(대상 수 앞까지).
  const start = launcher.slice(launcher.indexOf("static string StartDbDump("),
    launcher.indexOf("int count;", launcher.indexOf("static string StartDbDump(")));
  const read = [...start.matchAll(/string (\w+) = (?:DbCheckField\()?ReadBundleString\(body, ref pos\)/g)]
    .map(match => match[1]);
  assert.deepEqual(read, DUMP_FIELDS);

  // 불리언 자리는 "1"/"0" 으로만 오간다.
  assert.deepEqual(dump.requestValues({ objects:[] }).slice(2, 4), ["0", "0"]);
  // 행 수는 음수·빈 값·글자를 0(전체)으로 되돌린다.
  assert.equal(dump.requestValues({ rowLimit:-5, objects:[] })[6], "0");
  assert.equal(dump.requestValues({ rowLimit:"abc", objects:[] })[6], "0");
  // 대상 수와 뒤따르는 짝의 개수가 맞아야 런처가 본문 끝을 정확히 만난다.
  const many = dump.requestValues({ objects:[{ kind:"table", name:"a" }, { kind:"table", name:"b" }] });
  assert.equal(many[9], "2");
  assert.equal(many.length, 10 + 2 * 2);
});

test("덤프 창은 기존 접속 화면의 것을 다시 쓰고 스스로 경로를 정하지 않는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-dump.js"), "utf8");
  // 길이 접두 인코딩은 한 벌만 있어야 한다(런처의 ReadBundleString 과 짝이다).
  assert.match(source, /MNDbClient\.encodeStrings\(values\)/);
  assert.ok(!/TextEncoder/.test(source), "덤프 창이 인코딩을 따로 만든다");
  // 오류 문구도 접속 화면의 것을 그대로 쓴다.
  assert.match(source, /MNDbClient\.messageFor/);
  // 저장 위치는 런처가 정한다 — 프런트는 이름만 보내고 경로는 응답으로 받는다.
  assert.match(source, /lastPath = String\(started\.path \|\| ""\);/);
  // 주석은 정책을 설명하므로 빼고, 실제 코드에 경로를 짓는 자리가 없는지 본다.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*/gm, "");
  assert.ok(!/["'][A-Za-z]:[\\/]|SaveRoot/.test(code), "덤프 창이 저장 경로를 스스로 만든다");
  // 파일 이름에서 경로 문자는 오히려 막는다(폴더를 파고들지 못하게).
  assert.ok(source.includes('replace(/[\\\\/:*?"<>|]/g, "_")'), "파일 이름의 경로 문자를 막지 않는다");
  // 덤프도 쿼리와 같은 작업 목록에 있어 취소 경로를 함께 쓴다.
  assert.match(source, /"\/db-query-cancel\?job=" \+ encodeURIComponent\(job\)/);
  assert.match(source, /"\/db-dump-poll\?job=" \+ encodeURIComponent\(job\)/);
  // 건너뛴 객체는 조용히 넘기지 않고 완료 문구에 함께 알린다.
  assert.match(source, /건너뛴 객체/);
  // 같은 이름의 파일이 있으면 덮어쓰기 전에 묻는다(덤프는 통째로 덮어쓴다).
  assert.match(source, /await savedFileExists\(name\)/);
  assert.match(source, /"\/save-file-exists"/);
  assert.match(source, /confirmDialog\([^)]*이미 있습니다/);

  // 매니페스트: db-client.js 뒤에 실려야 MNDbClient 를 쓸 수 있다.
  assert.ok(manifest.localScripts.includes("db-dump.js"));
  assert.ok(manifest.localScripts.indexOf("db-client.js") < manifest.localScripts.indexOf("db-dump.js"));
  assert.match(html, /<script src="src\/js\/db-dump\.js"><\/script>/);
  // 두 모듈은 서로를 부른다(덤프 창은 인코딩·문구를, 접속 화면은 창 열기를). 로드 순서로는
  // 한쪽만 앞설 수 있으므로 moduleBoundaries 로 묶지 않고, 참조가 모두 함수 안에 있는지 본다.
  assert.ok(!(manifest.moduleBoundaries || []).some(item => item.file === "db-dump.js"));
  // 로드 시점에 값을 읽지 않는다(참조는 전부 함수 본문 안이라 순서가 문제되지 않는다).
  assert.ok(!/^\s*const \w+ = MNDbClient\./m.test(source), "덤프 창이 로드 시점에 MNDbClient 를 읽는다");
  assert.match(source, /typeof MNDbClient !== "undefined" && MNDbClient\.messageFor/);
  // 반대 방향도 같다 — 접속 화면은 창을 열 때만 MNDbDump 를 찾는다.
  const client = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(client, /if \(typeof MNDbDump === "undefined"\)\{/);
});

test("덤프 창을 여는 자리는 툴바와 트리 우클릭 두 곳이다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 툴바 버튼 — 읽기 전용 접속에서도 쓸 수 있어야 한다(덤프는 읽기만 한다).
  assert.match(source, /const dumpButton = button\("내보내기"/);
  assert.match(source, /dumpButton\.addEventListener\("click", \(\) => openDumpModal\(\[\]\)\)/);
  assert.ok(!/dumpButton\.disabled = readOnly/.test(source), "읽기 전용에서 내보내기를 막는다");
  assert.match(source, /toolbar\.append\([\s\S]*?dumpButton/);
  // 트리 우클릭 — 컬럼·인덱스·외래키를 눌렀으면 딸린 테이블을 고른 채로 연다.
  assert.match(source, /openDumpModal\(\[dumpKind \+ ":" \+ dumpName\]\)/);
  assert.match(source, /const dumpName = childTab \? \(item\.table \|\| item\.name\) : item\.name;/);
  // 화면이 이미 아는 것만 넘긴다 — 스키마를 서버에 다시 묻지 않는다.
  assert.match(source, /MNDbDump\.open\(\{\s*\n\s*sessionId,\s*\n\s*database: currentDatabase,\s*\n\s*schemaObjects,/);
  // 연결 전·객체 없음은 창을 열지 않고 이유를 말한다.
  assert.match(source, /if \(!sessionId\)\{\s*\n\s*toast\("먼저 데이터베이스에 연결해 주세요\./);
  assert.match(source, /if \(!schemaObjects\.length\)\{/);
});

test("덤프 취소는 전용 커넥션을 끊고 반쪽 파일을 남기지 않는다", () => {
  // 세션 커넥션의 번호를 죽이는 기존 취소로는 덤프가 멈추지 않는다 — 번호를 따로 들고 끊는다.
  assert.match(worker, /def cancel_running_dump\(\):/);
  assert.match(worker, /dump\["cancel"\] = True\s*\n\s*kill_query\(dump\.get\("connectionId"\)\)/);
  assert.match(worker, /cursor\.execute\("SELECT CONNECTION_ID\(\)"\)/);
  // 취소·종료는 stdin 리더 스레드가 처리한다(덤프 중에는 워커 스레드가 막혀 있다).
  assert.match(worker, /cancel_running_query\(\)\s*#[^\n]*\n\s*cancel_running_dump\(\)/);
  // KILL QUERY 의 드라이버 예외도 일반 객체 실패로 삼키지 않고 취소로 올린다.
  assert.ok((worker.match(/if dump_cancelled\(\):\s*\n\s*raise DumpCancelled\(\) from exc/g) || []).length >= 2);
  // 마지막 서버 작업 뒤에 들어온 취소도 진짜 파일로 바꾸기 전에 잡는다.
  assert.match(worker, /if dump_cancelled\(\):\s*\n\s*raise DumpCancelled\(\)\s*\n\s*os\.replace\(temp, path\)/);
  // 반쪽짜리 임시 파일은 지운다.
  assert.match(worker, /except DumpCancelled:[\s\S]{0,200}?remove_quietly\(temp\)[\s\S]{0,120}?"code": "cancelled"/);
  // 덤프가 끝나면 표시를 지운다(남으면 다음 덤프가 시작하자마자 취소된다).
  assert.match(worker, /finally:\s*\n\s*_state\["dump"\] = None/);
  // 프런트는 이 코드를 이미 사람 말로 옮길 줄 안다.
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /case "cancelled":/);
});

test("대기 중인 DB 작업 취소는 같은 세션의 실행 중인 다른 작업으로 새지 않는다", () => {
  // ExecLock 을 얻기 전에 취소된 작업은 워커에 요청 자체를 보내지 않는다.
  assert.match(launcher, /public bool Started;/);
  assert.match(launcher, /if \(job\.CancelRequested\)\s*\n\s*return "-\{\\"ok\\":false,\\"code\\":\\"cancelled\\"/);
  assert.match(launcher, /job\.Started = true;\s*\n\s*session\.ActiveJobId = job\.Id;/);
  // 취소는 실제로 시작됐고 지금도 같은 id 가 실행 중일 때만 stdin 으로 보낸다.
  assert.match(launcher, /if \(!started\) return;/);
  assert.match(launcher, /if \(session\.ActiveJobId != job\.Id\) return;\s*\n\s*DbSendCancel\(session\);/);
  // 쿼리와 덤프가 모두 같은 보호 장치를 거친다.
  assert.match(launcher, /DbExchange\(session, request, seconds \* 1000, null, job\)/);
  assert.match(launcher, /DbDumpIdleMs,[\s\S]{0,180}?\}, job\);/);
});

test("덤프는 복원 세션 설정과 TIMESTAMP 시각을 보존한다", () => {
  assert.match(worker, /SET SESSION TIME_ZONE = '\+00:00'/);
  assert.match(worker, /SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT;/);
  assert.match(worker, /SET AUTOCOMMIT=@OLD_AUTOCOMMIT;/);
  assert.match(worker, /SET @OLD_TIME_ZONE=@@TIME_ZONE, TIME_ZONE='\+00:00';/);
  assert.match(worker, /SET TIME_ZONE=@OLD_TIME_ZONE;/);
  // 구조만 덤프해도 EVENT 정의의 시각을 UTC로 읽고 사용자 세션은 건드리지 않는다.
  assert.match(worker, /dump_connection, dump_id = open_dump_connection\(driver, needs_data and options\["consistent"\]\)/);
  assert.match(worker, /source = dump_connection/);
  // 프런트·런처와 마찬가지로 워커도 확장자 대소문자를 구분하지 않는다.
  assert.match(worker, /if not path\.lower\(\)\.endswith\("\.sql"\):/);
});

test("DB 세션 종료는 실행 중인 덤프를 취소하고 임시 파일 정리를 기다린다", () => {
  const main = worker.slice(worker.indexOf("def main():"));
  assert.match(main, /if action == "close":[\s\S]{0,180}?cancel_running_dump\(\)[\s\S]{0,80}?requests\.put\(None\)/);
  assert.match(main, /worker\.join\(4\.0\)/);
  assert.match(main, /remove_quietly\(dump\.get\("temp"\)\)/);
  assert.match(launcher, /session\.Process\.WaitForExit\(5000\)/);
});

test("덤프 저장 경로는 런처가 SaveRoot 안에서만 만든다", () => {
  assert.match(launcher, /path\.StartsWith\("\/db-dump\?"/);
  assert.match(launcher, /path\.StartsWith\("\/db-dump-poll"/);
  // 경로 정책: 사용자가 준 이름은 SafeRelPath 로 걸러 SaveRoot 아래로만 풀린다.
  const start = launcher.slice(launcher.indexOf("static string StartDbDump("),
    launcher.indexOf("/* 셀 값 읽기."));
  assert.ok(start.length > 0, "StartDbDump 를 찾지 못했다");
  assert.match(start, /string safe = SafeRelPath\(fileName\);/);
  assert.match(start, /if \(!TryResolveSaveRootPath\(safe, out full\)\) throw new Exception\("db-dump-bad-path"\);/);
  assert.match(start, /if \(!safe\.EndsWith\("\.sql", StringComparison\.OrdinalIgnoreCase\)\) safe \+= "\.sql";/);
  // 런처는 SQL 을 만들지 않는다 — 이름과 값을 JSON 값으로만 옮긴다.
  assert.ok(!/SELECT |INSERT |CREATE TABLE/.test(start), "런처가 SQL 을 조립한다");
  assert.match(start, /objects\.Append\("\{\\"kind\\":"\)\.Append\(JsonString\(kind\)\)/);
  // 대상 수 상한은 워커와 같은 값이어야 한다.
  assert.match(launcher, /const int MaxDbDumpObjects = 500;/);
  assert.match(worker, /MAX_DUMP_OBJECTS = 500/);
  // 덤프도 쿼리와 같은 작업 목록에 들어가 취소 경로를 함께 쓴다.
  assert.match(start, /lock \(DbJobsLock\) DbJobs\[job\.Id\] = job;/);
});

// DELIMITER 감싸기는 프런트(편집기 스크립트)와 워커(덤프 파일) 양쪽에 있다. 두 구현이 갈라지면
// 편집기에서 보던 복합문과 덤프한 복합문의 모양이 달라진다.
const DELIMITER_CASES = [
  ["CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND", ""],
  ["CREATE PROCEDURE p()\nBEGIN\n  SELECT '$$';\nEND", ""],
  ["CREATE PROCEDURE p()\nBEGIN\n  SELECT '$$ // ;; @@';\nEND", ""],
  ["CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET @n = 1", "//"],
  ["  ", ""]
];

test("복합문 DELIMITER 감싸기는 프런트와 워커가 같은 결과를 낸다",
  { skip: python.status !== 0 && "python 없음" }, () => {
    const probe = [
      "import json, sys",
      "sys.path.insert(0, " + JSON.stringify(path.join(root, "desktop")) + ")",
      "import db_worker",
      "cases = json.loads(sys.stdin.read())",
      "print(json.dumps([db_worker.wrap_delimited_statement(body, preferred) for body, preferred in cases]))"
    ].join("\n");
    const run = spawnSync("python", ["-c", probe], {
      input: JSON.stringify(DELIMITER_CASES), encoding: "utf8"
    });
    assert.equal(run.status, 0, run.stderr);
    const fromWorker = JSON.parse(run.stdout);
    DELIMITER_CASES.forEach(([body, preferred], index) => {
      assert.equal(fromWorker[index], client.wrapDelimitedStatement(body, preferred), body);
    });
    // 셋째 경우는 흔한 구분자가 본문에 다 들어 있어 마지막 후보까지 밀린다.
    assert.match(fromWorker[2], /^DELIMITER §§\n/);
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

/* ── SQL 정렬 ────────────────────────────────────────────────────────────
   정렬기는 vendor 라이브러리지만, "무엇을 라이브러리에 맡기고 무엇을 손대지 않는지"는
   우리 규칙이다. 가짜 정렬기로 그 규칙을 먼저 못박고, 마지막에 진짜 vendor 로 확인한다. */

// 문장을 대문자 한 줄로 바꾸는 가짜 정렬기. "정렬됐다"를 눈으로 구분하기 쉬우라고 단순하게 둔다.
const fakeFormat = (text) => {
  if (/^\s*BOOM/i.test(text)) throw new Error("parse error");   // 못 읽는 문장 흉내
  return text.replace(/\s+/g, " ").trim().toUpperCase();
};

test("SQL 정렬은 문장마다 따로 하고 원문 위치를 지킨다", () => {
  const sql = "select 1 from a;\nselect 2 from b;";
  const result = client.formatSqlText(sql, fakeFormat);
  assert.equal(result.text, "SELECT 1 FROM A;\nSELECT 2 FROM B;");
  assert.equal(result.formatted, 2);
  assert.equal(result.skipped, 0);
  // 문장 사이의 원문(세미콜론·줄바꿈)은 정렬기가 만지지 않는다.
  assert.deepEqual(client.splitStatements(result.text), ["SELECT 1 FROM A", "SELECT 2 FROM B"]);
});

test("SQL 정렬은 DELIMITER 로 감싼 프로시저 본문을 건드리지 않는다", () => {
  const sql = "DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;\nselect 2 from b;";
  const result = client.formatSqlText(sql, fakeFormat);
  assert.match(result.text, /CREATE PROCEDURE p\(\)\nBEGIN\n {2}SELECT 1;\nEND\$\$/,
    "본문을 한 줄로 접으면 DELIMITER 되돌리기가 깨진다");
  assert.match(result.text, /SELECT 2 FROM B;$/, "나머지 문장은 정렬한다");
  assert.equal(result.formatted, 1);
  assert.equal(result.skipped, 1);
  // 정렬 뒤에도 실행 단위가 그대로여야 한다 — 이게 깨지면 엉뚱한 문장이 서버로 나간다.
  assert.equal(client.splitStatements(result.text).length, client.splitStatements(sql).length);
});

test("SQL 부분 정렬은 선택에 걸친 문장만 손대고 나머지는 글자 그대로 둔다", () => {
  const sql = "select 1 from a;\nselect 2 from b;\nselect 3 from c;";
  const second = sql.indexOf("select 2");
  // 두 번째 문장 한가운데만 골라도 그 문장은 통째로 정렬한다(절반만 다시 쓰면 어긋난다).
  const result = client.formatSqlText(sql, fakeFormat, { from: second + 3, to: second + 6 });
  assert.equal(result.text, "select 1 from a;\nSELECT 2 FROM B;\nselect 3 from c;");
  assert.equal(result.formatted, 1);
  assert.equal(result.skipped, 0, "범위 밖 문장은 '건너뛴 문장'으로 세지 않는다");
});

test("SQL 부분 정렬에서 선택이 문장 사이 빈 곳뿐이면 아무것도 바꾸지 않는다", () => {
  const sql = "select 1 from a;\n\n\nselect 2 from b;";
  const gap = sql.indexOf(";") + 1;
  const result = client.formatSqlText(sql, fakeFormat, { from: gap, to: gap + 2 });
  assert.equal(result.text, sql);
  assert.equal(result.formatted, 0);
  assert.equal(result.skipped, 0);
});

test("SQL 부분 정렬도 프로시저 본문은 건너뛴다", () => {
  const sql = "DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;\nselect 2 from b;";
  const result = client.formatSqlText(sql, fakeFormat, { from: 0, to: sql.length });   // 전체 선택
  assert.match(result.text, /BEGIN\n {2}SELECT 1;\nEND\$\$/);
  assert.equal(result.skipped, 1);
});

test("SQL 정렬은 못 읽는 문장을 원문 그대로 남긴다", () => {
  const sql = "select 1 from a;\nboom 'not closed;";
  const result = client.formatSqlText(sql, fakeFormat);
  assert.equal(result.text, "SELECT 1 FROM A;\nboom 'not closed;");
  assert.equal(result.skipped, 1);
});

test("SQL 정렬은 DELIMITER 없는 프로시저 정의가 있으면 아무것도 하지 않는다", () => {
  // 본문이 세미콜론마다 조각나 들어오므로, 조각을 따로 정렬하면 한 덩어리였다는 사실이 지워진다.
  const sql = "CREATE PROCEDURE p()\nBEGIN\n  select 1;\n  select 2;\nEND";
  const result = client.formatSqlText(sql, fakeFormat);
  assert.equal(result.text, sql);
  assert.equal(result.reason, "routine");
  assert.equal(result.formatted, 0);
});

test("SQL 정렬이 문장 나누기를 바꾸면 통째로 되돌린다", () => {
  // 정렬기가 세미콜론을 만들어 내면 실행 단위가 늘어난다. 보기 좋은 것보다 실행이 먼저다.
  const sql = "select 1 from a";
  const result = client.formatSqlText(sql, () => "select 1; select 2");
  assert.equal(result.text, sql);
  assert.equal(result.reason, "unsafe");
});

test("SQL 정렬은 빈 편집기나 정렬기 없음에서 조용히 원문을 돌려준다", () => {
  assert.equal(client.formatSqlText("   ", fakeFormat).text, "   ");
  assert.equal(client.formatSqlText("select 1", null).text, "select 1");
});

test("vendor sql-formatter 는 MySQL 문법을 읽고 우리 규칙 안에서만 동작한다", () => {
  const context = { console, setTimeout, clearTimeout };
  context.globalThis = context;
  // UMD 는 module/exports 가 없으면 전역에 sqlFormatter 를 붙인다(브라우저에서와 같은 경로).
  vm.runInNewContext(fs.readFileSync(path.join(root, "vendor", "sql-formatter.min.js"), "utf8"), context);
  const format = context.sqlFormatter.format;
  assert.equal(typeof format, "function");

  const sql = "DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;\n"
    + "select a.id, b.cnt from `학생` a join 성적 b on b.sid = a.id where a.age > 10;";
  const result = client.formatSqlText(sql, format);
  // 라이브러리는 DELIMITER 를 모른다. 통째로 넘겼다면 끝이 "END $$ DELIMITER;" 로 붙어
  // 구분자 되돌리기가 사라지고, 뒤 문장이 앞 문장에 먹혀 실행 단위가 깨진다.
  const before = client.splitStatements(sql), after = client.splitStatements(result.text);
  assert.equal(after.length, before.length, "정렬이 실행 단위 개수를 바꾸면 안 된다");
  assert.equal(after[0], before[0], "프로시저 본문은 한 글자도 바뀌면 안 된다");
  assert.doesNotMatch(result.text, /DELIMITER;/, "DELIMITER 되돌리기가 앞 줄에 붙으면 안 된다");
  assert.match(result.text, /SELECT\n/, "일반 문장은 절 단위로 줄을 나눈다");
  assert.match(result.text, /`학생`/, "역따옴표·한글 식별자를 보존한다");
  assert.equal(result.skipped, 1);
});

test("DB 편집기는 공용 위젯의 정렬 확장점(formatSource)으로 연결된다", () => {
  // 이 연결이 끊기면 정렬 버튼이 조용히 아무 일도 하지 않는다(파이썬 전용 경로로 빠진다).
  const dbSource = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const editorSource = fs.readFileSync(path.join(root, "src", "js", "python-editor.js"), "utf8");
  assert.match(dbSource, /formatSource: formatEditorSql/);
  assert.match(editorSource, /const externalFormatter = typeof options\.formatSource === "function"/);
  assert.match(editorSource, /if \(!externalFormatter && \(plainMode \|\| prof !== "python"\)\) return/);
  // 정렬기는 처음 쓸 때만 읽는다(시작 비용 0).
  assert.match(dbSource, /MNLazy\.tryNeed\("sqlFormat"\)/);
  const vendor = manifest.vendorScripts.find((item) => item.file === "sql-formatter.min.js");
  assert.ok(vendor && vendor.lazy === "sqlFormat", "vendor 등록이 지연 로드여야 한다");
});

test("우클릭 메뉴 항목은 메뉴가 열릴 때의 선택 범위를 다시 세우고 실행한다", () => {
  const dbSource = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const editorSource = fs.readFileSync(path.join(root, "src", "js", "python-editor.js"), "utf8");
  // 메뉴는 공용 위젯의 contextMenuActions 확장점으로 얹는다(위젯에 DB 전용 코드를 넣지 않는다).
  assert.match(dbSource, /contextMenuActions: \(\) => \{/);
  assert.match(dbSource, /선택 영역 SQL 정렬/);
  // 메뉴가 닫히며 포커스가 흔들려도 처음 고른 범위에 그대로 걸리게 한다.
  assert.match(dbSource, /const onPicked = \(run\) => \(\) => \{/);
  assert.match(dbSource, /area\.setSelectionRange\(from, to\);/);
  assert.match(dbSource, /action: onPicked\(\(\) => runEditorFormat\(picked \?/);
  // 위젯은 선택 범위를 정렬기에 넘겨준다.
  assert.match(editorSource, /scope: opts\.scope === "selection" \? "selection" : "document"/);
  assert.match(editorSource, /from: selectFrom, to: selectTo/);
});

test("우클릭 메뉴는 텍스트 편집기의 줄 정리 목록을 베끼지 않고 그대로 가져다 쓴다", () => {
  const dbSource = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const viewerSource = fs.readFileSync(path.join(root, "src", "js", "code-viewer.js"), "utf8");
  // 목록이 전역이라야 두 화면이 같은 도구를 쓴다. 함수 안으로 들어가면 DB 메뉴가 조용히 빈다.
  assert.match(viewerSource, /^const LINE_TIDY_ITEMS = \[/m);
  assert.match(dbSource, /typeof LINE_TIDY_ITEMS !== "undefined"/);
  assert.match(dbSource, /runLineTidy\(tidy\)/);
  // 목록을 베껴 두면 한쪽에 도구가 늘 때 다른 쪽만 뒤처진다.
  assert.doesNotMatch(dbSource, /가나다순 정렬|줄 번호 매기기|탭 → 공백/);
  const tools = [...viewerSource.matchAll(/\{ action:"[a-z-]+", label:"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tools.length >= 11, "줄 정리 도구가 " + tools.length + "개뿐이다");
  // 순서가 뒤집히면 db-client 가 읽을 때 목록이 아직 없다.
  const order = manifest.localScripts;
  assert.ok(order.indexOf("code-viewer.js") < order.indexOf("db-client.js"));
  assert.ok((manifest.scriptDependencies["db-client.js"] || []).includes("code-viewer.js"));
});

test("우클릭 메뉴에 찾기·줄 이동·줄바꿈을 함께 올린다", () => {
  const dbSource = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  for (const label of ["찾기·바꾸기", "줄 번호로 이동", "줄바꿈 끄기", "줄바꿈 켜기"]) {
    assert.ok(dbSource.includes(label), "메뉴 항목 누락: " + label);
  }
  assert.match(dbSource, /editor\.openFind\(\)/);
  assert.match(dbSource, /editor\.openGoto\(\)/);
  // 대소문자 변환·특수문자·복사는 공용 메뉴가 이미 붙여 준다 — DB 쪽에서 또 만들지 않는다.
  const editorSource = fs.readFileSync(path.join(root, "src", "js", "python-editor.js"), "utf8");
  for (const label of ["대문자로 변경", "소문자로 변경", "특수문자… (Ctrl+F10)"]) {
    assert.ok(editorSource.includes(label), "공용 메뉴 항목 누락: " + label);
  }
  assert.doesNotMatch(dbSource, /대문자로 변경|특수문자…/);
});

test("우클릭 메뉴는 검색만 한 층 접고 특수문자는 1단에 남긴다", () => {
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, "src", "js", "python-editor.js"), "utf8")
    + "\nglobalThis.__textContextMenuItems = textContextMenuItems;", context);
  const noop = () => {};
  const base = { copy:noop, cut:noop, paste:noop, specialChars:noop, upper:noop, lower:noop, dedupe:noop, selectAll:noop };
  const items = context.__textContextMenuItems(Object.assign({}, base, {
    hasSelection: true,
    search: [{ label:"Google에서 검색", action:noop }, { label:"지도에서 찾기", action:noop }, { label:"파일 찾기", action:noop }],
    extra: [{ label:"SQL 정렬", action:noop }]
  }));
  const labels = items.filter((item) => !item.separator).map((item) => item.label);
  assert.equal(labels[0], "SQL 정렬", "부르는 쪽이 준 항목이 맨 위에 온다");
  // 문자표는 브라우저 위 편집기에서 특수문자를 넣는 주된 통로라 한 층 더 들어가게 두지 않는다.
  assert.ok(labels.includes("특수문자… (Ctrl+F10)"), "문자표는 1단에 남는다");
  const search = items.find((item) => item.label === "선택한 낱말로 검색");
  assert.equal(search.children.length, 3, "검색 셋만 접는다");
  assert.ok(!labels.includes("Google에서 검색"), "검색 항목을 1단에 늘어놓지 않는다");
  assert.equal(items.find((item) => item.label === "대문자로 변경").disabled, false);

  const noSelection = context.__textContextMenuItems(Object.assign({}, base, {
    hasSelection: false, search: [], extra: []
  }));
  const idle = noSelection.filter((item) => !item.separator).map((item) => item.label);
  assert.equal(noSelection.find((item) => item.label === "대문자로 변경").disabled, true);
  assert.ok(!idle.includes("선택한 낱말로 검색"), "고른 글자가 없으면 검색 층 자체가 생기지 않는다");
  assert.ok(idle.includes("특수문자… (Ctrl+F10)"), "문자표는 선택이 없어도 쓸 수 있다");
});

test("계층 메뉴는 공용 모듈(MNContextMenu)이 그리고 겉모습은 부르는 쪽 CSS 를 쓴다", () => {
  const menu = require("../src/js/context-menu.js");
  assert.equal(typeof menu.open, "function");
  assert.equal(typeof menu.close, "function");
  const source = fs.readFileSync(path.join(root, "src", "js", "context-menu.js"), "utf8");
  // 터치·펜에는 pointerenter 가 오지 않는다 — 부모 항목은 click 으로도 열려야 한다.
  assert.match(source, /button\.addEventListener\("click", openChildren\)/);
  // Escape 는 열린 서브메뉴만 닫는다(한 번에 전부 닫히면 실수로 메뉴를 놓친다).
  assert.match(source, /if \(layers\.length > 1\) closeFrom\(layers\.length - 1\)/);
  // 오른쪽 공간이 없으면 왼쪽으로 뒤집는다 — 화면 밖으로 나간 층은 누를 수 없다.
  assert.match(source, /if \(left \+ width > window\.innerWidth - MARGIN\) left = anchor\.left - width \+ 4/);
  // 눌러도 편집기 선택을 뺏지 않는다.
  assert.match(source, /button\.addEventListener\("pointerdown", \(event\) => event\.preventDefault\(\)\)/);

  const editorSource = fs.readFileSync(path.join(root, "src", "js", "python-editor.js"), "utf8");
  assert.match(editorSource, /MNContextMenu\.open\(event\.clientX, event\.clientY, items, \{/);
  assert.match(editorSource, /base: "text-context"/);
  // 닫히면 단일 창 계약(activeTextContextMenu)도 함께 풀려야 한다.
  assert.match(editorSource, /onClose: \(\) => \{ activeTextContextMenu = null; \}/);

  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(css, /\.text-context-sub\{/);
  assert.match(css, /\.text-context-parent::after\{content:"▸"/);
  assert.match(css, /\.text-context-menu\{[\s\S]{0,200}?max-height:calc\(100vh - 20px\);overflow-y:auto/);
});

test("줄 정리 열한 개는 1단에 늘어놓지 않고 한 층 접는다", () => {
  const dbSource = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(dbSource, /items\.push\(\{ label:"줄 정리", children/);
  // 자주 쓰는 정렬·찾기·줄바꿈은 1단에 남는다.
  for (const label of ["SQL 정렬 (전체)", "찾기·바꾸기", "줄 번호로 이동"]) {
    assert.ok(dbSource.includes(label), "1단 항목 누락: " + label);
  }
});

/* 결과 표 붙여넣기 --------------------------------------------------------
   격자를 칸에 맞추는 셈은 DOM 을 모르는 순수 함수라 여기서 직접 돌려 본다.
   스프레드시트 뷰어와 같은 파서·같은 셈을 쓰므로 한쪽에서 복사한 것이 다른 쪽에서 어긋나지 않는다. */
const gridSelection = require("../src/js/grid-selection.js");

test("클립보드 파서는 두 표가 함께 쓴다", () => {
  assert.equal(typeof gridSelection.gridClipboardTable, "function");
  assert.deepEqual(gridSelection.gridClipboardTable("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  // 큰따옴표 안의 탭·줄바꿈은 칸을 나누지 않는다(엑셀이 그렇게 내보낸다).
  assert.deepEqual(gridSelection.gridClipboardTable('"여러\n줄"\t"탭\t포함"'), [["여러\n줄", "탭\t포함"]]);
  // 이 앱에서 복사한 값은 특수문자가 있어도 같은 한 칸으로 되돌아와야 한다.
  for (const value of ['He said "hi"', "탭\t포함", "여러\n줄", '따옴표 "와\t탭']){
    const copied = gridSelection.gridSelectionToText(new Set([0]), 1, () => value);
    assert.deepEqual(gridSelection.gridClipboardTable(copied), [[value]]);
  }
  // 외부 앱이 인용하지 않은 평문 중간의 따옴표도 값 자체다.
  assert.deepEqual(gridSelection.gridClipboardTable('He said "hi"'), [['He said "hi"']]);
  // 스프레드시트 뷰어는 이제 자기 파서를 갖지 않고 이 함수를 이름만 바꿔 받는다.
  const sheet = fs.readFileSync(path.join(root, "src", "js", "spreadsheet-viewer.js"), "utf8");
  assert.match(sheet, /gridClipboardTable: parseClipboardTable/);
  assert.ok(!/^function parseClipboardTable\(/m.test(sheet), "파서가 두 곳에 있으면 규칙이 갈라진다");
});

test("붙여넣기는 표 밖으로 넘친 행·열을 버리고 그 수를 알린다", () => {
  const grid = [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]];
  const plan = gridSelection.gridPastePlan(grid, { row: 1, col: 1 }, { rows: 3, cols: 3 }, null);
  // 3×3 격자를 (1,1) 에 붙이면 2×2 만 들어가고 나머지는 버려진다 — 표는 늘어나지 않는다.
  assert.deepEqual(plan.cells.map(cell => [cell.row, cell.col, cell.value]),
    [[1, 1, "a"], [1, 2, "b"], [2, 1, "d"], [2, 2, "e"]]);
  assert.equal(plan.overflowRows, 1);
  assert.equal(plan.overflowCols, 1);
  assert.equal(plan.fill, false);
});

test("칸 하나를 복사하면 고른 칸 전부를 그 값으로 채운다", () => {
  const spots = [{ row: 0, col: 0 }, { row: 2, col: 1 }, { row: 9, col: 1 }];
  const plan = gridSelection.gridPastePlan([["x"]], { row: 0, col: 0 }, { rows: 3, cols: 2 }, spots);
  assert.equal(plan.fill, true);
  // 흩어진 선택도 그대로 따르고, 표 밖(9행)은 조용히 빠진다.
  assert.deepEqual(plan.cells, [{ row: 0, col: 0, value: "x" }, { row: 2, col: 1, value: "x" }]);
  // 격자가 여러 칸이면 채우기가 아니라 좌상단부터 붙이기다.
  assert.equal(gridSelection.gridPastePlan([["x", "y"]], { row: 0, col: 0 }, { rows: 3, cols: 2 }, spots).fill, false);
});

test("붙여넣기는 변경 목록에만 담고 상한을 넘기면 하나도 담지 않는다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const body = source.slice(source.indexOf("const pasteGridSelection ="), source.indexOf("const requestPaste ="));
  // 값은 stageUpdate 로만 간다 — 붙여넣기가 SQL 을 만들면 따옴표·NULL 처리가 두 곳으로 갈린다.
  assert.match(body, /stageUpdate\(item\.context, item\.value, item\.isNull\)/);
  assert.ok(!/UPDATE /.test(body), "붙여넣기가 SQL 문장을 만들면 안 된다");
  // 상한 검사는 담기 전에 하고, 걸리면 return 이다(절반만 담기면 어디까지 들어갔는지 알 수 없다).
  assert.match(body, /let projected = stagedCount\(\);[\s\S]{0,600}?if \(projected > MAX_STAGED\)\{[\s\S]{0,400}?return;/);
  // 읽기 전용·조인 결과는 애초에 담기지 않는다.
  assert.match(body, /if \(!plan \|\| !plan\.editable\)\{ toast\(editBlockNote\(plan\), 3500\); return; \}/);
  // NOT NULL 컬럼에 NULL 을 담지 않는다(값 창의 규칙과 같다).
  assert.match(body, /if \(isNull && !context\.nullable\)/);
  // 빈 칸의 기본은 빈 문자열이고 NULL 은 Ctrl+Shift+V 로만 들어온다.
  assert.match(body, /const isNull = !!nullOnEmpty && cell\.value === ""/);
});

test("붙여넣기는 Ctrl+V 의 paste 이벤트로 받고 Ctrl+Shift+V 만 따로 가로챈다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // Ctrl+V 를 keydown 에서 막으면 클립보드를 읽을 권한을 따로 물어야 한다. 이벤트가 실어 온 글자를 쓴다.
  assert.match(source, /table\.addEventListener\("paste", \(event\) => \{/);
  assert.match(source, /event\.clipboardData\.getData\("text\/plain"\)/);
  // 고치는 중인 입력칸의 붙여넣기는 그 칸의 일이다.
  assert.match(source, /if \(event\.target && event\.target\.closest && event\.target\.closest\("\.db-cell-input"\)\) return;/);
  // Ctrl+Shift+V 는 막지 않으면 paste 가 뒤따라 와 같은 블록이 두 번 붙는다.
  assert.match(source, /event\.shiftKey && key === "v"\)\{\s*\n\s*event\.preventDefault\(\);\s*\n\s*requestPaste\(true\);/);
});

test("결과 표 우클릭 메뉴는 단축키를 함께 적고 스키마 트리 메뉴의 껍데기를 다시 쓴다", () => {
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(source, /const openGridContextMenu = \(x, y\) =>/);
  assert.match(source, /table\.addEventListener\("contextmenu"/);
  // 고른 범위 밖을 누르면 그 칸을 먼저 고른다(범위 안이면 선택을 지키고 메뉴만 연다).
  assert.match(source, /if \(!gridSelection \|\| !gridSelection\.keys\.has\(key\)\) selectCell\(point\.row, point\.col\)/);
  // 닫기·바깥 클릭·Escape 규칙은 트리 메뉴의 것을 그대로 쓴다(메뉴가 둘 다 열려 있지 않게).
  assert.match(source, /openGridContextMenu = [\s\S]{0,200}?closeTableContextMenu\(\)/);
  for (const label of ["복사", "붙여넣기", "빈 칸을 NULL 로 붙여넣기", "값 보기·고치기", "행 추가", "행 삭제 담기"]) {
    assert.ok(source.includes('"' + label + '"'), "메뉴 항목 누락: " + label);
  }
  assert.match(css, /\.db-context-hint\{/);
});
