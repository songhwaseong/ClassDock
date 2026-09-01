# -*- coding: utf-8 -*-
"""db_worker 의 셀 편집 판정과 UPDATE 조립을 서버 없이 확인한다.

가짜 커넥션이 information_schema 질의에만 답하고 실행된 SQL 을 그대로 기록한다.
MySQL 서버 없이도 "무엇이 잠기는가"와 "어떤 문장이 나가는가"를 못박아 둘 수 있다.
경로는 인자로 받는다(테스트가 저장소 위치를 안다). 결과는 마지막 줄 `ok` 하나로만 알린다.
"""

import sys

sys.path.insert(0, sys.argv[1])
import db_worker as w                                        # noqa: E402


class FakeField(object):
    def __init__(self, db, org_table, org_name, charsetnr=33, type_code=253):
        self.db = db.encode("utf-8")                          # 드라이버는 이 값만 bytes 로 준다
        self.org_table = org_table
        self.org_name = org_name
        self.charsetnr = charsetnr
        self.type_code = type_code


class FakeResult(object):
    def __init__(self, fields):
        self.fields = fields


class FakeCursor(object):
    def __init__(self, log, meta):
        self.log = log
        self.meta = meta
        self._rows = []
        self._result = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        self.log.append((" ".join(sql.split()), params))
        if "TABLE_TYPE FROM information_schema.TABLES" in sql:
            self._rows = [(self.meta["type"],)]
        elif "information_schema.COLUMNS" in sql:
            self._rows = list(self.meta["columns"])
        else:
            self._rows = list(self.meta.get("data", []))
        return len(self._rows)

    def fetchone(self):
        return self._rows.pop(0) if self._rows else None

    def fetchall(self):
        rows, self._rows = self._rows, []
        return rows


class FakeConnection(object):
    def __init__(self, meta):
        self.log = []
        self.meta = meta

    def cursor(self):
        return FakeCursor(self.log, self.meta)


META = {
    "type": "BASE TABLE",
    "columns": [
        ("id", "PRI", "auto_increment", "NO", "int"),
        ("name", "", "", "YES", "varchar(40)"),
        ("photo", "", "", "YES", "blob"),
        ("full", "", "STORED GENERATED", "YES", "varchar(80)"),
        ("score", "", "", "YES", "int"),
        ("entered", "", "", "NO", "date"),
    ],
    "data": [("next",)],
}

connection = FakeConnection(META)
cursor = FakeCursor(connection.log, META)
cursor._result = FakeResult([
    FakeField("school", "student", "id", 63, 3),
    FakeField("school", "student", "name"),
    FakeField("school", "student", "photo", 63, 252),
    FakeField("school", "student", "full"),
    FakeField("", "", ""),                                    # COUNT(*) 같은 계산식 열
    FakeField("school", "student", "score", 63, 3),           # INT
    FakeField("school", "student", "entered", 63, 10),        # DATE
])
labels = ["id", "name", "photo", "full", "cnt", "score", "entered"]

w._state["read_only"] = False
w._state["table_meta"] = {}
plan = w.edit_plan(connection, w.field_sources(cursor), labels)
assert plan["editable"] and plan["table"] == "student"
assert plan["keys"] == [{"name": "id", "index": 0}], plan["keys"]
assert plan["cells"][0]["reason"] == "key"                    # 기본키 칸은 행을 짚는 근거라 고치지 않는다
assert plan["cells"][1]["editable"] and plan["cells"][1]["nullable"]
assert plan["cells"][2]["reason"] == "binary"
assert plan["cells"][3]["reason"] == "generated"
assert plan["cells"][4]["reason"] == "no-source"
# ⚠ 숫자·날짜 컬럼도 이진 컬레이션(63)으로 온다. 컬레이션만 보고 판정하면 INT·DATE 가 전부 잠긴다.
assert plan["cells"][5]["editable"], "INT column must stay editable"
assert plan["cells"][6]["editable"] and not plan["cells"][6]["nullable"]

# 조인·기본키 누락·뷰·읽기 전용은 잠긴다
joined = [{"database": "school", "table": "student", "column": "id", "binary": False},
          {"database": "school", "table": "class", "column": "name", "binary": False}]
assert w.edit_plan(connection, joined, ["id", "name"])["reason"] == "multi-table"
w._state["table_meta"] = {}
nokey = [{"database": "school", "table": "student", "column": "name", "binary": False}]
assert w.edit_plan(connection, nokey, ["name"])["reason"] == "key-missing"
w._state["table_meta"] = {}
assert w.edit_plan(FakeConnection(dict(META, type="VIEW")), nokey, ["name"])["reason"] == "view"
w._state["read_only"] = True
assert w.edit_plan(connection, nokey, ["name"])["reason"] == "read-only"

# 묶음 적용: 이름만 인용하고 값은 언제나 자리표시자로 보낸다
w._state["read_only"] = False
w._state["table_meta"] = {}
w._state["auto_commit"] = False
w._state["pending"] = False
target = FakeConnection(META)
w._state["connection"] = target
result = w.apply_edits({
    "database": "school", "table": "student", "changes": [
        # 일부러 순서를 섞어 보낸다 — 워커가 고치기 → 지우기 → 넣기로 다시 세운다.
        {"kind": "insert", "values": [{"column": "name", "value": "new", "null": False},
                                      {"column": "score", "value": "", "null": True}]},
        {"kind": "delete", "keys": [{"name": "id", "value": "2"}]},
        {"kind": "update", "column": "name", "value": "next", "valueNull": False,
         "keys": [{"name": "id", "value": "1"}]},
    ]})
sqls = [item[0] for item in target.log]
assert sqls[0] == "SAVEPOINT classdock_edit", sqls              # 수동 커밋이면 이 묶음만 되돌릴 수 있게 건다
assert sqls[1] == "UPDATE `school`.`student` SET `name` = %s WHERE `id` = %s", sqls
assert target.log[1][1] == ["next", "1"]
assert sqls[2] == "DELETE FROM `school`.`student` WHERE `id` = %s", sqls
assert sqls[3] == "INSERT INTO `school`.`student` (`name`, `score`) VALUES (%s, %s)", sqls
assert target.log[3][1] == ["new", None]                        # NULL 은 빈 문자열과 다른 값으로 나간다
assert sqls[4] == "RELEASE SAVEPOINT classdock_edit", sqls
assert result["ok"] and result["counts"]["insert"] == 1
assert result["pending"] is True                                # 수동 커밋이면 미커밋 변경으로 센다

# 하나라도 실패하면 이 묶음만 통째로 되돌린다(수동 커밋에서는 rollback 을 부르면 안 된다)
class FailingConnection(FakeConnection):
    def cursor(self):
        outer = self

        class Cursor(FakeCursor):
            def execute(self, sql, params=None):
                if sql.startswith("DELETE"):
                    outer.log.append((" ".join(sql.split()), params))
                    raise ValueError("boom")
                return FakeCursor.execute(self, sql, params)

        return Cursor(outer.log, outer.meta)


w._state["table_meta"] = {}
failing = FailingConnection(META)
w._state["connection"] = failing
result = w.apply_edits({"table": "student", "changes": [{"kind": "delete", "keys": [{"name": "id", "value": "2"}]}]})
sqls = [item[0] for item in failing.log]
assert result["ok"] is False and result["applied"] == 0, result
assert "ROLLBACK TO SAVEPOINT classdock_edit" in sqls, sqls
assert "RELEASE SAVEPOINT classdock_edit" not in sqls, sqls

# 자동 커밋 모드에서는 세이브포인트가 뜻이 없다. 묶음을 트랜잭션으로 연다.
class CountingConnection(FakeConnection):
    def __init__(self, meta):
        FakeConnection.__init__(self, meta)
        self.calls = []

    def begin(self):
        self.calls.append("begin")

    def commit(self):
        self.calls.append("commit")

    def rollback(self):
        self.calls.append("rollback")


w._state["auto_commit"] = True
w._state["pending"] = False          # 실제로는 자동 커밋으로 되돌릴 때 워커가 함께 지운다
w._state["table_meta"] = {}
auto = CountingConnection(META)
w._state["connection"] = auto
result = w.apply_edits({"table": "student", "changes": [
    {"kind": "update", "column": "name", "value": "next", "valueNull": False,
     "keys": [{"name": "id", "value": "1"}]}]})
assert auto.calls == ["begin", "commit"], auto.calls
assert "SAVEPOINT classdock_edit" not in [item[0] for item in auto.log]
assert result["pending"] is False                               # 자동 커밋이면 확정이라 대기가 남지 않는다

# 반영 0행 가르기: 값이 같았으면 넘어가고, 행이 사라졌으면 묶음 전체가 실패한다
class ZeroConnection(CountingConnection):
    """UPDATE 는 0행을 반영하고, 존재 확인 결과는 exists 로 정한다."""
    def __init__(self, meta, exists):
        CountingConnection.__init__(self, meta)
        self.exists = exists

    def cursor(self):
        outer = self

        class Cursor(FakeCursor):
            def execute(self, sql, params=None):
                outer.log.append((" ".join(sql.split()), params))
                if sql.startswith("UPDATE"):
                    self._rows = []
                    return 0
                self._rows = [(1,)] if outer.exists else []
                return len(self._rows)

        return Cursor(outer.log, outer.meta)


change = {"kind": "update", "column": "name", "value": "next", "valueNull": False,
          "keys": [{"name": "id", "value": "1"}]}
w._state["table_meta"] = {}
same = ZeroConnection(META, True)
w._state["connection"] = same
result = w.apply_edits({"table": "student", "changes": [change]})
assert result["ok"] and result["counts"]["unchanged"] == 1, result

w._state["table_meta"] = {}
gone = ZeroConnection(META, False)
w._state["connection"] = gone
result = w.apply_edits({"table": "student", "changes": [change]})
assert result["ok"] is False and result["code"] == "row-gone", result
assert gone.calls == ["begin", "rollback"], gone.calls

# 지울 행이 이미 없으면 뜻은 이루어진 것이라 실패가 아니라 건수로만 알린다
w._state["table_meta"] = {}
missing = ZeroConnection(META, False)
w._state["connection"] = missing
result = w.apply_edits({"table": "student", "changes": [{"kind": "delete", "keys": [{"name": "id", "value": "9"}]}]})
assert result["ok"] and result["counts"]["missing"] == 1, result

# 읽기 전용에서는 묶음 적용도 막힌다
w._state["read_only"] = True
assert w.apply_edits({"table": "student", "changes": [change]})["code"] == "read-only-blocked"
w._state["read_only"] = False

# 기본키 없는 요청과 모르는 갈래는 거절
for bad in ({"kind": "update", "column": "name", "keys": []}, {"kind": "몰라"}):
    try:
        w.apply_edits({"table": "student", "changes": [bad]})
        raise AssertionError("must be refused: %r" % (bad,))
    except RuntimeError as exc:
        assert str(exc) in ("bad-cell-key", "bad-change-kind"), str(exc)

print("ok")
