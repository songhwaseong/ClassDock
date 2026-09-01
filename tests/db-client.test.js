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
    ["classdock", "color", "database", "driver", "host", "port", "readOnly", "sql", "user", "version"]);
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
    "TRUNCATE TABLE a;"
  );
  assert.deepEqual(risky.map(item => client.firstKeyword(item.statement)),
    ["delete", "update", "drop", "truncate"]);
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

test("Ctrl+/ 는 고른 줄을 통째로 주석 처리하고 다시 벗긴다", () => {
  const sql = "SELECT 1\nFROM t\nWHERE x = 1";
  const on = client.toggleLineComment(sql, 0, sql.length);
  assert.equal(on.text, "-- SELECT 1\n-- FROM t\n-- WHERE x = 1");
  const off = client.toggleLineComment(on.text, on.start, on.end);
  assert.equal(off.text, sql, "다시 누르면 원래대로 돌아와야 한다");
});

test("Ctrl+/ 는 일부만 주석이면 전부 주석으로 맞춘다", () => {
  const sql = "-- SELECT 1\nFROM t";
  const result = client.toggleLineComment(sql, 0, sql.length);
  assert.equal(result.text, "-- -- SELECT 1\n-- FROM t");
});

test("Ctrl+/ 는 들여쓰기를 지키고 빈 줄은 건드리지 않는다", () => {
  const sql = "  SELECT 1\n\n  FROM t";
  const result = client.toggleLineComment(sql, 0, sql.length);
  assert.equal(result.text, "  -- SELECT 1\n\n  -- FROM t");
  assert.equal(client.toggleLineComment(result.text, 0, result.text.length).text, sql);
});

test("Ctrl+/ 는 선택이 없으면 커서 줄만 바꾸고 커서를 그 줄에 남긴다", () => {
  const sql = "SELECT 1\nFROM t";
  const cursor = sql.indexOf("FROM") + 2;
  const result = client.toggleLineComment(sql, cursor, cursor);
  assert.equal(result.text, "SELECT 1\n-- FROM t");
  assert.equal(result.start, result.end, "선택이 없으면 커서로 남아야 한다");
  assert.equal(result.text.slice(result.start - 2, result.start), "FR", "커서가 같은 글자 옆에 있어야 한다");
});

test("Ctrl+/ 는 빈 줄에서 아무것도 바꾸지 않는다", () => {
  const result = client.toggleLineComment("\n\n", 1, 1);
  assert.equal(result.text, "\n\n");
});

test("걸린 시간은 서버가 재고 프런트는 그 값만 쓴다", () => {
  // 프런트에서 재면 폴링 간격(300ms)이 섞여 빠른 쿼리가 느리게 보인다.
  assert.match(worker, /def elapsed_ms\(started\)/);
  assert.match(worker, /entry\["ms"\] = elapsed_ms\(started\)/);
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  assert.match(source, /formatMs\(response\.info\.ms\)/);
  assert.ok(!/Date\.now\(\) - runStartedAt/.test(source), "프런트가 실행 시간을 재면 안 된다");
});

test("스키마 트리는 컬럼만 따로 받아오고 DDL 을 볼 수 있다", () => {
  assert.match(worker, /def load_columns\(/);
  assert.match(worker, /def load_ddl\(/);
  assert.match(worker, /SHOW CREATE TABLE/);
  const source = fs.readFileSync(path.join(root, "src", "js", "db-client.js"), "utf8");
  // 트리를 펼칠 때 미리보기 200행까지 함께 가져오면 안 된다.
  assert.match(source, /&mode=columns/);
  assert.match(source, /&mode=ddl/);
  assert.match(source, /&mode=count/);
  // 같은 테이블을 다시 펼치면 서버를 또 부르지 않는다.
  assert.match(source, /columnCache\.has\(name\)/);
});

test("런처는 아는 mode 만 워커에 넘긴다", () => {
  assert.match(launcher, /if \(mode != "columns" && mode != "count" && mode != "ddl"\) mode = "table";/);
});

test("자동완성 문맥은 커서 앞의 낱말과 한정자를 읽는다", () => {
  const at = (sql) => client.completionContext(sql, sql.length);
  assert.deepEqual({ ...at("SELECT na") }, { prefix: "na", start: 7, qualifier: "", after: "select" });
  assert.equal(at("SELECT * FROM ").after, "from");
  assert.equal(at("SELECT o.").qualifier, "o");
  assert.equal(at("SELECT o.na").qualifier, "o");
  assert.equal(at("SELECT o.na").prefix, "na");
  assert.equal(at("").prefix, "");
});

test("별칭은 테이블 이름으로 되돌아간다", () => {
  const map = client.aliasMap("SELECT * FROM orders o JOIN users AS u ON o.uid = u.id");
  assert.equal(map.get("o"), "orders");
  assert.equal(map.get("u"), "users");
  assert.equal(map.get("orders"), "orders");
  // 별칭 자리에 온 예약어를 별칭으로 오해하면 안 된다.
  assert.equal(client.aliasMap("SELECT * FROM orders WHERE x = 1").get("where"), undefined);
});

test("FROM 뒤에서는 테이블만, 한정자 뒤에서는 그 테이블 컬럼만 준다", () => {
  const schema = {
    tables: [{ name: "orders", type: "table" }, { name: "users", type: "table" }],
    columns: [{ table: "orders", name: "order_id", type: "int" }, { table: "users", name: "user_name", type: "text" }],
    aliases: client.aliasMap("SELECT * FROM orders o")
  };
  const fromItems = client.completionCandidates(client.completionContext("SELECT * FROM ", 14), schema);
  assert.ok(fromItems.every(item => item.kind === "table"), "FROM 뒤에 컬럼·키워드가 섞이면 안 된다");

  const sql = "SELECT o.";
  const dotted = client.completionCandidates(client.completionContext(sql, sql.length), schema);
  assert.deepEqual(dotted.map(item => item.label), ["order_id"], "별칭이 가리키는 테이블의 컬럼만 나와야 한다");
});

test("자동완성은 이미 친 글자로 후보를 좁힌다", () => {
  const schema = {
    tables: [{ name: "orders", type: "table" }, { name: "users", type: "table" }],
    columns: [], aliases: new Map()
  };
  const sql = "SELECT * FROM or";
  const items = client.completionCandidates(client.completionContext(sql, sql.length), schema);
  assert.deepEqual(items.map(item => item.label), ["orders"]);
});

test("자동완성 후보 수에는 상한이 있다", () => {
  const tables = Array.from({ length: 200 }, (_, index) => ({ name: "t" + index, type: "table" }));
  const items = client.completionCandidates(client.completionContext("SELECT * FROM ", 14),
    { tables, columns: [], aliases: new Map() });
  assert.ok(items.length <= 40, "목록이 화면을 넘길 만큼 길면 안 된다");
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
  assert.match(source, /firstKeyword\(target\.sql\) === "explain" \? target\.sql : "EXPLAIN " \+ target\.sql/);
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

test("편집기 높이도 분할선이 정하고 기본 resize 손잡이는 끈다", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // 두 방식을 함께 두면 컨테이너 높이와 textarea 높이가 서로를 덮어써 화면이 어긋난다.
  assert.match(css, /\.db-editor\{position:relative;flex:none;height:var\(--db-editor-height,180px\)/);
  assert.match(css, /\.db-editor-input\{[^}]*height:100%;min-height:0;resize:none/);
  assert.ok(!/\.db-editor-input\{[^}]*resize:vertical/.test(css), "기본 resize 손잡이가 남아 있으면 안 된다");
});

test("가로 분할선은 기존 간격을 늘리지 않는다", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  // .db-main 은 gap:10px 이라 분할선을 그냥 넣으면 위아래 gap 이 둘 다 붙어 간격이 두 배가 된다.
  assert.match(css, /\.db-hdivider\{position:relative;height:0;margin:-5px 0;cursor:row-resize;touch-action:none\}/);
  // 잡을 수 있는 영역은 pseudo 로 넓힌다(선 자체는 높이가 0 이다).
  assert.match(css, /\.db-hdivider::before\{content:"";position:absolute;left:0;right:0;top:-6px;bottom:-6px\}/);
});

test("가로 분할선도 pointercancel 까지 정리한다", () => {
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
  assert.match(source, /highlightCodeBase\(editor\.value \+ "\\n", "sql"\)/);
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
  assert.match(source, /runQuery\(event\.shiftKey \? allTarget\(\) : runTarget\(\)\)/);
  // 여러 결과 집합을 버리지 않고 탭으로 낸다.
  assert.match(source, /resultSets = statements\.filter\(item => item && item\.kind === "rows"\)/);
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
