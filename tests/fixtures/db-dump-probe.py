# -*- coding: utf-8 -*-
"""db_worker의 SQL 덤프를 MySQL 서버 없이 확인한다.

가짜 커서가 SHOW CREATE·information_schema·SELECT 결과를 돌려주고,
만들어진 .sql 파일을 그대로 읽어 검사한다.
"""

import datetime
import decimal
import io
import os
import sys
import tempfile

sys.path.insert(0, sys.argv[1])
import db_worker as w  # noqa: E402


TABLES = {
    "orders": "CREATE TABLE `orders` (\n  `id` int NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
    "customers": "CREATE TABLE `customers` (\n  `id` int NOT NULL\n) ENGINE=InnoDB",
    "plain": "CREATE TABLE `plain` (\n  `id` int NOT NULL\n) ENGINE=InnoDB",
    "broken": "CREATE TABLE `broken` (\n  `id` int NOT NULL\n) ENGINE=InnoDB",
    # 뷰 v_top 은 뷰 v_orders 를 쓴다 — 파일에서 v_orders 가 먼저 나와야 한다.
    "v_orders": "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` VIEW `v_orders` AS select `orders`.`id` from `orders`",
    "v_top": "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` VIEW `v_top` AS select `id` from `v_orders`",
    "no_grant": "",                                   # 본문을 볼 권한이 없는 경우
}
ROUTINES = {
    ("procedure", "add_order"): "CREATE DEFINER=`root`@`localhost` PROCEDURE `add_order`()\nBEGIN\n  INSERT INTO orders VALUES (1);\n  SELECT 1;\nEND",
    ("trigger", "orders_ai"): "CREATE DEFINER=`root`@`localhost` TRIGGER `orders_ai` AFTER INSERT ON `orders` FOR EACH ROW BEGIN\n  SET @n = 1;\nEND",
}
# (이름, 타입, NULL허용, 키, 기본값, EXTRA, 주석, 문자셋, 콜레이션, 생성식)
COLUMNS = {
    "orders": [
        ("id", "int", "NO", "PRI", None, "", "", None, None, ""),
        ("memo", "varchar(200)", "YES", "", None, "", "", "utf8mb4", "utf8mb4_general_ci", ""),
        # 생성 컬럼 — INSERT 에 넣으면 서버가 거절하므로 빠져야 한다.
        ("total", "int", "YES", "", None, "STORED GENERATED", "", None, None, "(`id` * 2)"),
    ],
    "customers": [("id", "int", "NO", "PRI", None, "", "", None, None, "")],
    "plain": [("id", "int", "NO", "PRI", None, "", "", None, None, "")],
    "broken": [("id", "int", "NO", "PRI", None, "", "", None, None, "")],
}
# 값에 세미콜론·따옴표·주석 기호를 일부러 넣는다. 이스케이프가 깨지면 문장 경계가 어긋난다.
ROWS = {
    "orders": [
        (1, "it's a; test"),
        (2, "back\\slash -- not a comment"),
        (3, "/* not a comment */ END$$"),
        (4, None),
    ],
    "customers": [],
    "plain": [(7,), (8,)],
    # 첫 INSERT 묶음(200행)을 쓴 뒤 네트워크 오류가 나는 큰 테이블 자리.
    "broken": [(index,) for index in range(250)],
}


KILLED = []                                           # KILL QUERY 로 끊은 커넥션 번호


class DumpCursor(object):
    """일반 커서. 실행한 SQL 을 records 에 남겨 무엇을 물었는지 확인할 수 있게 한다."""

    def __init__(self, records):
        self.rows = []
        self.description = None
        self.records = records
        self.fail_after = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        self.records.append(sql)
        if sql in ("SET SESSION TRANSACTION READ ONLY", "SET SESSION TIME_ZONE = '+00:00'",
                   "START TRANSACTION WITH CONSISTENT SNAPSHOT"):
            self.rows, self.description = [], None
            return
        if sql == "SELECT DATABASE()":
            self.rows, self.description = [("shop",)], [("DATABASE()",)]
            return
        if sql == "SELECT CONNECTION_ID()":
            self.rows, self.description = [(4242,)], [("CONNECTION_ID()",)]
            return
        if sql.startswith("KILL QUERY "):
            KILLED.append(int(sql.rsplit(" ", 1)[1]))
            self.rows, self.description = [], None
            return
        if "information_schema.COLUMNS" in sql:
            self.rows = list(COLUMNS[(params or ("", ""))[1]])
            self.description = None
            return
        if sql.startswith("SHOW CREATE TABLE "):
            name = sql.split("`")[-2]
            if name == "missing":
                raise Exception(1142, "SELECT command denied to user")
            self.rows = [(name, TABLES[name])]
            self.description = [("Table",), ("Create Table",)]
            return
        for kind, keyword in (("procedure", "PROCEDURE"), ("trigger", "TRIGGER")):
            if sql.startswith("SHOW CREATE " + keyword + " "):
                name = sql.split("`")[-2]
                label = "Create Procedure" if kind == "procedure" else "SQL Original Statement"
                self.rows = [(name, "", ROUTINES[(kind, name)])]
                self.description = [(kind.title(),), ("sql_mode",), (label,)]
                return
        raise AssertionError("예상하지 않은 SQL: %s" % sql)

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        rows, self.rows = self.rows, []
        return rows


class StreamCursor(DumpCursor):
    """서버사이드 커서(SSCursor) 자리. 결과를 한 행씩 흘려 준다."""

    def execute(self, sql, params=None):
        self.records.append(sql)
        assert sql.startswith("SELECT "), sql
        name = sql.split("`")[-2] if "`.`" in sql else sql.split("`")[-2]
        rows = list(ROWS[name])
        self.fail_after = 210 if name == "broken" else 0
        limit = sql.rsplit(" LIMIT ", 1)
        if len(limit) == 2:
            rows = rows[:int(limit[1])]
        self.rows = rows

    def __iter__(self):
        sent = 0
        while self.rows:
            if self.fail_after and sent >= self.fail_after:
                raise Exception(2013, "Lost connection while reading rows")
            sent += 1
            yield self.rows.pop(0)


class DumpConnection(object):
    def __init__(self):
        self.records = []
        self.closed = False
        self.rolled_back = False

    def cursor(self, cursor_class=None):
        kind = StreamCursor if cursor_class == "SSCursor" else DumpCursor
        return kind(self.records)

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class FakeCursors(object):
    SSCursor = "SSCursor"


class FakeDriver(object):
    """pymysql 자리. 덤프 전용 커넥션을 여는 길만 흉내 낸다."""

    cursors = FakeCursors()
    opened = []

    @staticmethod
    def connect(**kwargs):
        connection = DumpConnection()
        FakeDriver.opened.append((kwargs, connection))
        return connection


session = DumpConnection()
w._state["connection"] = session
w._state["credentials"] = {"host": "127.0.0.1", "port": 3306, "user": "teacher", "password": "hunter2"}
w._state["connection_id"] = 77                        # 세션 커넥션 번호(connect 가 채우는 값)
w._state["read_only"] = True                          # 읽기 전용 접속에서도 덤프는 된다
w._state["auto_commit"] = True
w._state["pending"] = False
w._state["table_meta"] = {}
w.import_driver = lambda: FakeDriver

# 진행 보고는 stdout 으로 나간다. 검사도 할 겸 가로채 둔다.
PROGRESS = []
w.write_progress = lambda payload: PROGRESS.append(payload)


# ── 값 → SQL 리터럴 ────────────────────────────────────────────────────────
LITERALS = [
    (None, "NULL"),
    (True, "1"),
    (False, "0"),
    (12, "12"),
    (decimal.Decimal("1.50"), "1.50"),
    (float("nan"), "NULL"),
    (float("inf"), "NULL"),
    (b"", "''"),
    (b"\x00\xff", "0x00ff"),
    (datetime.date(2026, 9, 2), "'2026-09-02'"),
    (datetime.datetime(2026, 9, 2, 14, 3, 11), "'2026-09-02 14:03:11'"),
    (datetime.timedelta(hours=838, minutes=59, seconds=59), "'838:59:59'"),
    (datetime.timedelta(hours=-2, minutes=-30), "'-02:30:00'"),
    ("plain", "'plain'"),
    ("it's", "'it\\'s'"),
    ("back\\slash", "'back\\\\slash'"),
    ("line\nbreak", "'line\\nbreak'"),
    ("carriage\rreturn", "'carriage\\rreturn'"),
    ("nul\0byte", "'nul\\0byte'"),
    ("sub\x1aend", "'sub\\Zend'"),
    ('quote"inside', "'quote\"inside'"),
]
for value, expected in LITERALS:
    actual = w.sql_literal(value)
    assert actual == expected, "sql_literal(%r) = %r, 기대 %r" % (value, actual, expected)

# 표시용 cell() 은 자르고 바꾼다. 덤프는 그 값을 쓰면 안 된다 — 둘이 다름을 못 박아 둔다.
long_text = "가" * 900
assert w.cell(long_text)[1] is True, "cell 은 긴 값을 자른다"
assert w.sql_literal(long_text) == "'" + long_text + "'", "sql_literal 은 자르지 않는다"
assert w.cell(b"\x00\xff")[0] == "<BLOB 2 bytes>", "cell 은 BLOB 을 설명 문구로 바꾼다"


# ── INSERT 묶기 ────────────────────────────────────────────────────────────
chunks = list(w.insert_chunks("P", ["(1)", "(2)", "(3)"], max_rows=2, max_chars=10 ** 6))
assert chunks == ["P(1),\n(2);\n", "P(3);\n"], chunks
# 길이 상한이 행 수보다 먼저 걸리는 경우: (1) 는 3자 + 구분자 2 = 5, 두 행이면 10 > 8.
chunks = list(w.insert_chunks("P", ["(1)", "(2)"], max_rows=100, max_chars=8))
assert len(chunks) == 2, chunks
# 한 행이 그것만으로 상한을 넘어도 버리지 않는다(행은 더 쪼갤 수 없다).
big = list(w.insert_chunks("P", ["(" + "x" * 50 + ")"], max_rows=100, max_chars=10))
assert len(big) == 1 and "x" * 50 in big[0], big
assert list(w.insert_chunks("P", [])) == []


# ── 뷰 순서 ────────────────────────────────────────────────────────────────
views = [{"name": "v_top", "ddl": "select from `v_orders`"}, {"name": "v_orders", "ddl": "select from `orders`"}]
ordered, cyclic = w.order_views(views)
assert [item["name"] for item in ordered] == ["v_orders", "v_top"], ordered
assert cyclic == [], cyclic

circular = [{"name": "a", "ddl": "uses `b`"}, {"name": "b", "ddl": "uses `a`"}]
ordered, cyclic = w.order_views(circular)
assert cyclic == ["a", "b"], cyclic
assert len(ordered) == 2, ordered

# 자기 이름이 정의문에 나와도(언제나 그렇다) 스스로를 막지 않는다.
ordered, cyclic = w.order_views([{"name": "v", "ddl": "create view `v` as select 1"}])
assert cyclic == [] and len(ordered) == 1, (ordered, cyclic)


# ── 구조 덤프 ──────────────────────────────────────────────────────────────
root = tempfile.mkdtemp(prefix="classdock-dump-")
path = os.path.join(root, "shop.sql")
result = w.dump_schema({
    "action": "dump", "path": path, "mode": "structure", "database": "shop",
    "objects": [
        {"kind": "table", "name": "orders"},
        {"kind": "table", "name": "customers"},
        {"kind": "view", "name": "v_top"},
        {"kind": "view", "name": "v_orders"},
        {"kind": "procedure", "name": "add_order"},
        {"kind": "trigger", "name": "orders_ai"},
        {"kind": "table", "name": "no_grant"},      # 정의를 못 읽음 → 건너뛴다
        {"kind": "table", "name": "missing"},       # 권한 오류 → 건너뛴다
    ],
})
assert result["ok"], result
assert result["counts"] == {"table": 2, "view": 2, "procedure": 1,
                            "function": 0, "trigger": 1, "event": 0}, result["counts"]
assert {item["name"] for item in result["skipped"]} == {"no_grant", "missing"}, result["skipped"]
assert [item["reason"] for item in result["skipped"] if item["name"] == "missing"] == ["denied"], result["skipped"]
assert result["rows"] == 0, result
assert result["bytes"] > 0 and os.path.exists(path), result
assert not os.path.exists(path + ".part"), "임시 파일이 남았다"
# 구조만 뽑아도 UTC 기준의 이벤트 정의를 얻고 사용자 세션을 건드리지 않도록 전용 연결을 쓴다.
assert len(FakeDriver.opened) == 1, FakeDriver.opened
assert "SET SESSION TIME_ZONE = '+00:00'" in FakeDriver.opened[-1][1].records

text = io.open(path, encoding="utf-8").read()
assert not text.startswith("﻿"), "덤프에는 BOM 을 넣지 않는다"
assert "SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;" in text
assert "SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;" in text
assert "SQL_MODE='NO_AUTO_VALUE_ON_ZERO'" in text and "SET SQL_MODE=@OLD_SQL_MODE;" in text
assert "DROP TABLE IF EXISTS `orders`;" in text
assert "DROP PROCEDURE IF EXISTS `add_order`;" in text
assert "DROP TRIGGER IF EXISTS `orders_ai`;" in text
assert "-- 서버: 127.0.0.1:3306 · 데이터베이스: shop" in text
assert "hunter2" not in text, "비밀번호가 파일에 새면 안 된다"
# 구조만 뽑았으면 데이터 구간이 통째로 없어야 한다(프로시저 본문의 INSERT 와 헷갈리지 않게
# 구간 표시와 트랜잭션으로 본다).
assert "-- 데이터" not in text and "START TRANSACTION;" not in text
assert "INSERT INTO `orders` (" not in text
# 종류별 순서: 테이블 → 뷰 → 프로시저 → 트리거
order = [text.index("`orders`\n"), text.index("`v_orders`\n"), text.index("`v_top`\n"),
         text.index("`add_order`\n"), text.index("`orders_ai`\n")]
assert order == sorted(order), order
# 세미콜론이 든 복합문은 DELIMITER 로 감싼다.
assert "DELIMITER $$" in text and "END$$" in text and "DELIMITER ;" in text
# 건너뛴 객체는 파일에도 사실대로 남긴다.
assert "no_grant" in text and "missing" in text

# 옵션: DROP 을 끄고 IF NOT EXISTS 를 켠다.
path2 = os.path.join(root, "shop2.sql")
result2 = w.dump_schema({
    "path": path2, "mode": "structure", "database": "shop",
    "objects": [{"kind": "table", "name": "orders"}],
    "options": {"dropIfExists": False, "createIfNotExists": True},
})
assert result2["ok"], result2
text2 = io.open(path2, encoding="utf-8").read()
assert "DROP TABLE" not in text2, text2
assert "CREATE TABLE IF NOT EXISTS `orders`" in text2, text2


# ── 구조 + 데이터 ──────────────────────────────────────────────────────────
path3 = os.path.join(root, "shop3.sql")
before_both = len(FakeDriver.opened)
result3 = w.dump_schema({
    "path": path3, "mode": "both", "database": "shop",
    "objects": [
        {"kind": "table", "name": "orders"},
        {"kind": "table", "name": "customers"},
        {"kind": "view", "name": "v_orders"},
    ],
})
assert result3["ok"], result3
assert result3["rows"] == 4, result3
text3 = io.open(path3, encoding="utf-8").read()
assert "-- ClassDock SQL 덤프 (구조 + 데이터)" in text3
assert "INSERT INTO `orders` (`id`,`memo`) VALUES" in text3, text3
# 생성 컬럼은 INSERT 에 넣지 않는다(서버가 거절한다).
assert "`total`" not in text3.split("-- 데이터")[1], "생성 컬럼이 INSERT 에 들어갔다"
# 트랜잭션은 데이터 바로 앞에서 연다. DDL 은 실행하는 순간 커밋되기 때문이다.
assert text3.index("CREATE TABLE `orders`") < text3.index("START TRANSACTION;") < text3.index("INSERT INTO"), text3
assert "SET AUTOCOMMIT=0;" in text3 and "COMMIT;" in text3
assert "SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT;" in text3
assert "SET AUTOCOMMIT=@OLD_AUTOCOMMIT;" in text3
assert "SET @OLD_TIME_ZONE=@@TIME_ZONE, TIME_ZONE='+00:00';" in text3
assert "SET TIME_ZONE=@OLD_TIME_ZONE;" in text3
assert "SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;" in text3
assert "SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;" in text3
# 빈 테이블은 사실대로 적는다.
assert "-- (비어 있음)" in text3
# 뷰는 데이터 구간 뒤에 온다.
assert text3.index("COMMIT;") < text3.index("`v_orders`\n"), text3
# 전용 커넥션을 열고, 스냅샷을 잡고, 다 쓰면 닫는다.
assert len(FakeDriver.opened) == before_both + 1, FakeDriver.opened
opened_kwargs, opened_connection = FakeDriver.opened[-1]
assert opened_kwargs["host"] == "127.0.0.1" and opened_kwargs["user"] == "teacher", opened_kwargs
assert "SET SESSION TRANSACTION READ ONLY" in opened_connection.records
assert "SET SESSION TIME_ZONE = '+00:00'" in opened_connection.records
assert "START TRANSACTION WITH CONSISTENT SNAPSHOT" in opened_connection.records
assert opened_connection.rolled_back and opened_connection.closed, "전용 커넥션을 닫지 않았다"
# 사용자 세션 커넥션에는 덤프가 트랜잭션을 걸지 않는다.
assert "START TRANSACTION WITH CONSISTENT SNAPSHOT" not in session.records, session.records

# 진행 보고: 정의를 읽기 시작할 때 한 번, 테이블 데이터마다 한 번은 반드시 나간다.
phases = [item["phase"] for item in PROGRESS]
assert phases[0] == "schema", PROGRESS
data_reports = [item for item in PROGRESS if item["phase"] == "data"]
assert {item["object"] for item in data_reports} == {"orders", "customers"}, data_reports
assert data_reports[0]["total"] == 2, data_reports[0]
assert all(item["bytes"] > 0 for item in data_reports), data_reports
# 마지막 테이블을 시작할 때는 앞 테이블의 행이 이미 세어져 있다.
last = [item for item in data_reports if item["object"] == "customers"][0]
assert last["done"] == 1 and last["rows"] == 4, last

# 왕복: 덤프를 다시 문장으로 쪼개 이스케이프가 경계를 깨지 않았는지 본다.
# (문장 앞에 붙은 주석은 그 문장의 일부로 잡히므로 첫 낱말로 가른다.)
statements = w.split_statements(text3)
inserts = [item for item in statements if w.first_keyword(item) == "insert"]
assert len(inserts) == 1, [item[:60] for item in inserts]
assert inserts[0].count("),\n(") == 3, inserts[0]        # 4행이 한 문장에 묶였다
assert "it\\'s a; test" in inserts[0], inserts[0]
assert "back\\\\slash -- not a comment" in inserts[0], inserts[0]
assert inserts[0].endswith(")"), inserts[0]
assert sum(1 for item in statements if w.first_keyword(item) == "create") == 3, statements
assert any("CREATE ALGORITHM=UNDEFINED" in item for item in statements), "뷰 정의가 통째로 잡히지 않았다"


# ── 데이터만 · INSERT 형식 · 행 제한 ───────────────────────────────────────
path4 = os.path.join(root, "shop4.sql")
result4 = w.dump_schema({
    "path": path4, "mode": "data", "database": "shop",
    "objects": [{"kind": "table", "name": "orders"}, {"kind": "view", "name": "v_orders"}],
    "options": {"insertForm": "ignore", "columnNames": False, "rowLimit": 2},
})
assert result4["ok"], result4
assert result4["rows"] == 2, result4
assert result4["counts"]["view"] == 0, result4["counts"]
assert [item["reason"] for item in result4["skipped"]] == ["data-only"], result4["skipped"]
text4 = io.open(path4, encoding="utf-8").read()
# orders 에는 생성 컬럼이 있다. 컬럼 이름을 끄라고 했어도 목록을 적어야 값 개수가 맞는다.
assert "INSERT IGNORE INTO `orders` (`id`,`memo`) VALUES" in text4, text4
assert "CREATE TABLE" not in text4, "데이터만 뽑았는데 구조가 들어갔다"
assert "-- (2행)" in text4, text4

# 생성 컬럼이 없는 테이블이라면 컬럼 목록을 뺄 수 있다.
path5 = os.path.join(root, "shop6.sql")
result5 = w.dump_schema({
    "path": path5, "mode": "data", "database": "shop",
    "objects": [{"kind": "table", "name": "plain"}],
    "options": {"columnNames": False},
})
assert result5["ok"] and result5["rows"] == 2, result5
text5 = io.open(path5, encoding="utf-8").read()
assert "INSERT INTO `plain` VALUES\n(7),\n(8);" in text5, text5

columns, total = w.dump_data_columns(w._state["connection"].cursor(), "orders", "shop")
assert columns == ["id", "memo"] and total == 3, (columns, total)
assert w.dump_options({"insertForm": "replace"})["insertForm"] == "replace"
# 모르는 값은 가장 안전한 쪽으로 되돌린다.
assert w.dump_options({"insertForm": "drop-everything"})["insertForm"] == "insert"
assert w.dump_options({"rowLimit": "abc"})["rowLimit"] == 0
assert w.dump_options({"rowLimit": -5})["rowLimit"] == 0


# ── 취소 ───────────────────────────────────────────────────────────────────
# 데이터를 쓰는 도중에 사용자가 멈춘다(진행 보고가 나온 시점에 취소를 건다).
cancel_path = os.path.join(root, "cancel.sql")
reports = []


def cancel_when_data_starts(payload):
    reports.append(payload)
    if payload["phase"] == "data":
        w.cancel_running_dump()                       # 실제 취소 경로를 그대로 탄다


w.write_progress = cancel_when_data_starts
KILLED[:] = []
cancelled = w.dump_schema({
    "path": cancel_path, "mode": "both", "database": "shop",
    "objects": [{"kind": "table", "name": "orders"}, {"kind": "table", "name": "customers"}],
})
assert not cancelled["ok"] and cancelled["code"] == "cancelled", cancelled
# 반쪽짜리 파일을 남기지 않는다 — 받다 만 백업이 정상 덤프처럼 보이면 안 된다.
assert not os.path.exists(cancel_path), "취소했는데 덤프 파일이 남았다"
assert not os.path.exists(cancel_path + ".part"), "취소했는데 임시 파일이 남았다"
# 전용 커넥션의 번호를 끊는다(세션 커넥션의 번호로는 덤프가 멈추지 않는다).
assert KILLED == [4242], KILLED
# 덤프가 끝나면 표시를 지운다. 남아 있으면 다음 덤프가 시작하자마자 취소된다.
assert w._state["dump"] is None, w._state["dump"]
assert w.dump_cancelled() is False

# 취소 표시가 남지 않았으니 다음 덤프는 정상으로 끝난다.
w.write_progress = lambda payload: None
again = w.dump_schema({
    "path": os.path.join(root, "after-cancel.sql"), "mode": "both", "database": "shop",
    "objects": [{"kind": "table", "name": "orders"}],
})
assert again["ok"] and again["rows"] == 4, again

# 정의를 읽는 동안 취소해도 같다(구조만 뽑는 덤프).
# schema 단계 보고는 정의를 읽기 전에 나가므로, 첫 대상에서 멈춘다.
structure_cancel = os.path.join(root, "cancel2.sql")
w.write_progress = lambda payload: w.cancel_running_dump()
KILLED[:] = []
stopped = w.dump_schema({"path": structure_cancel, "mode": "structure",
                         "objects": [{"kind": "table", "name": "orders"}]})
assert not stopped["ok"] and stopped["code"] == "cancelled", stopped
assert not os.path.exists(structure_cancel), "취소했는데 덤프 파일이 남았다"
assert not os.path.exists(structure_cancel + ".part"), "취소했는데 임시 파일이 남았다"
# 구조만 뽑아도 전용 커넥션 번호를 끊는다.
assert KILLED == [4242], KILLED

# 덤프가 시작하기 전에 들어온 취소는 다음 덤프를 막지 않는다(취소는 "지금 도는 작업"만 멈춘다).
w.write_progress = lambda payload: None
w.cancel_running_dump()
fresh = w.dump_schema({"path": os.path.join(root, "fresh.sql"), "mode": "structure",
                       "objects": [{"kind": "table", "name": "orders"}]})
assert fresh["ok"], fresh

# 덤프가 돌고 있지 않으면 취소는 조용히 넘어간다.
KILLED[:] = []
w.cancel_running_dump()
assert KILLED == [], KILLED


# ── 스트리밍 실패 ─────────────────────────────────────────────────────────
# 일부 INSERT 를 이미 적은 뒤 읽기가 끊겨도 성공 파일이나 .part 를 남기면 안 된다.
broken_path = os.path.join(root, "broken.sql")
broken = w.handle({"action": "dump", "path": broken_path, "mode": "both", "database": "shop",
                   "objects": [{"kind": "table", "name": "broken"}]})
assert not broken["ok"], broken
assert not os.path.exists(broken_path), "부분 데이터가 정상 덤프로 확정됐다"
assert not os.path.exists(broken_path + ".part"), "실패한 스트리밍 임시 파일이 남았다"


# ── 잘못된 요청은 파일을 만들지 않는다 ────────────────────────────────────
for bad, code in (
    ({"path": os.path.join(root, "x.txt"), "objects": [{"kind": "table", "name": "orders"}]}, "dump-bad-path"),
    ({"path": os.path.join(root, "x.sql"), "mode": "csv",
      "objects": [{"kind": "table", "name": "orders"}]}, "dump-mode-unsupported"),
    ({"path": os.path.join(root, "x.sql"), "objects": []}, "dump-no-objects"),
    ({"path": os.path.join(root, "x.sql"), "objects": [{"kind": "table", "name": ""}]}, "dump-bad-object"),
    ({"path": os.path.join(root, "x.sql"), "objects": [{"kind": "sequence", "name": "s"}]}, "dump-bad-object"),
):
    failed = w.dump_schema(bad)
    assert not failed["ok"] and failed["code"] == code, failed
    assert not os.path.exists(os.path.join(root, "x.sql")), code

# 확장자는 프런트·런처와 같이 대소문자를 구분하지 않는다.
upper_path = os.path.join(root, "upper.SQL")
upper = w.dump_schema({"path": upper_path, "mode": "structure",
                       "objects": [{"kind": "table", "name": "orders"}]})
assert upper["ok"] and os.path.exists(upper_path), upper

# 쓸 수 없는 경로면 오류 코드로 알리고 임시 파일을 남기지 않는다.
blocked = os.path.join(root, "no-such-folder", "x.sql")
failed = w.dump_schema({"path": blocked, "objects": [{"kind": "table", "name": "orders"}]})
assert not failed["ok"] and failed["code"] == "dump-write-failed", failed
assert not os.path.exists(blocked + ".part"), "실패한 덤프의 임시 파일이 남았다"

# 데이터를 담는 덤프가 실패해도 전용 커넥션은 닫는다.
before = len(FakeDriver.opened)
failed = w.dump_schema({"path": blocked, "mode": "both",
                        "objects": [{"kind": "table", "name": "orders"}]})
assert not failed["ok"], failed
assert len(FakeDriver.opened) == before + 1, FakeDriver.opened
assert FakeDriver.opened[-1][1].closed, "실패한 덤프가 전용 커넥션을 흘렸다"

# handle() 을 통해서도 같은 길로 간다.
through = w.handle({"action": "dump", "path": os.path.join(root, "shop5.sql"), "mode": "structure",
                    "objects": [{"kind": "table", "name": "orders"}]})
assert through["ok"], through

print("ok")
