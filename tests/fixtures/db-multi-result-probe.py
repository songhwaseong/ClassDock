# -*- coding: utf-8 -*-
"""db_worker의 DELIMITER·다중 결과 집합 계약을 MySQL 서버 없이 확인한다."""

import sys

sys.path.insert(0, sys.argv[1])
import db_worker as w  # noqa: E402


class FakeResult(object):
    fields = []


class MultiCursor(object):
    def __init__(self, connection):
        self.connection = connection
        self.sets = [
            {"description": [("first",)], "rows": [(1,), (2,)], "rowcount": 2},
            {"description": [("second",)], "rows": [("a",), ("b",)], "rowcount": 2},
            {"description": None, "rows": [], "rowcount": 0},
        ]
        self.index = 0
        self.description = None
        self.rowcount = 0
        self.lastrowid = 0
        self._warnings = 0
        self._result = FakeResult()
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def _load(self):
        current = self.sets[self.index]
        self.description = current["description"]
        self.rowcount = current["rowcount"]
        self.rows = list(current["rows"])

    def execute(self, sql):
        assert sql == "CALL multi_result()", sql
        self.index = 0
        self.connection.drained = False
        self._load()

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def nextset(self):
        if self.index + 1 >= len(self.sets):
            self.connection.drained = True
            return None
        self.index += 1
        self._load()
        return True


class MultiConnection(object):
    def __init__(self):
        self.drained = False

    def cursor(self):
        return MultiCursor(self)


connection = MultiConnection()
w._state["connection"] = connection
w._state["read_only"] = False
w._state["auto_commit"] = True
w._state["pending"] = False
w._state["pages"] = {}
w._state["table_meta"] = {}

original_safe_edit_plan = w.safe_edit_plan
edit_checks = []


def safe_edit_after_drain(_connection, _sources, _columns):
    assert connection.drained, "편집 메타데이터 조회 전에 CALL의 모든 결과를 읽어야 한다"
    edit_checks.append(True)
    return {"editable": False, "reason": "no-source"}


w.safe_edit_plan = safe_edit_after_drain
result = w.run_statements("CALL multi_result();", object())
w.safe_edit_plan = original_safe_edit_plan
assert result["ok"], result
sets = result["statements"]
assert [item["kind"] for item in sets] == ["rows", "rows"], sets
assert [item["statement"] for item in sets] == [0, 0], sets
assert [item["resultIndex"] for item in sets] == [0, 1], sets
assert sets[0]["rows"] == [["1"], ["2"]], sets[0]
assert sets[1]["rows"] == [["a"], ["b"]], sets[1]
assert len(edit_checks) == 2, edit_checks
assert sum(item.get("ms", 0) for item in sets) == result["ms"]


class SingleStatusCursor(object):
    description = None
    rowcount = 0
    lastrowid = 0
    _warnings = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, _sql):
        return 0

    def nextset(self):
        return None


class SingleStatusConnection(object):
    def cursor(self):
        return SingleStatusCursor()


# CALL에 딸린 두 번째 빈 완료 결과만 숨긴다. 일반 UPDATE 0행과 결과가 없는 CALL의
# 유일한 완료 결과는 실행 여부를 알려 주므로 그대로 전달해야 한다.
w._state["connection"] = SingleStatusConnection()
zero_update = w.run_statements("UPDATE student SET age = age WHERE 1 = 0;", object())
assert len(zero_update["statements"]) == 1, zero_update
assert zero_update["statements"][0]["kind"] == "affected", zero_update
empty_call = w.run_statements("CALL no_result();", object())
assert len(empty_call["statements"]) == 1, empty_call


class FakeSqlError(Exception):
    pass


class ErrorCursor(object):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql):
        raise FakeSqlError(1064, "syntax error at line 3")


class ErrorConnection(object):
    def cursor(self):
        return ErrorCursor()


w._state["connection"] = ErrorConnection()
script = "DELIMITER $$\nCREATE PROCEDURE broken()\nBEGIN\n BAD SQL;\nEND$$\nDELIMITER ;"
failure = w.run_statements(script, object())
assert not failure["ok"], failure
assert failure["failedStatement"] == 0, failure
assert failure["scriptLine"] == 4, failure
assert failure["statements"][-1]["scriptLine"] == 4, failure

print("ok")
