# -*- coding: utf-8 -*-
"""db_worker의 스키마 삭제 의존성 검사를 MySQL 서버 없이 확인한다."""

import sys

sys.path.insert(0, sys.argv[1])
import db_worker as w  # noqa: E402


class DependencyCursor(object):
    def __init__(self):
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        params = params or ()
        if sql == "SELECT DATABASE()":
            self.rows = [("school",)]
        elif "VIEW_TABLE_USAGE" in sql:
            self.rows = [("school", "v_parent")]
        elif "TRIGGER_NAME FROM information_schema.TRIGGERS" in sql:
            self.rows = [("parent_audit",)]
        elif "REFERENCED_TABLE_SCHEMA = %s" in sql and "NOT (TABLE_SCHEMA" in sql:
            self.rows = [("fk_child_parent", "school", "child", "parent_id", "id")]
        elif "STATISTICS WHERE TABLE_SCHEMA" in sql and "AND COLUMN_NAME = %s" in sql:
            self.rows = [("idx_age",)]
        elif "((TABLE_SCHEMA = %s" in sql:
            self.rows = [("fk_age", "school", "score", "student_age", "school", "student", "age")]
        elif "GENERATION_EXPRESSION" in sql:
            self.rows = [("age_group", "if(`age` >= 20, 'adult', 'young')")]
        elif "SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX" in sql:
            self.rows = [("idx_parent", "parent_id", 1), ("idx_other", "other_id", 1)]
        elif "SELECT CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION" in sql:
            self.rows = [("fk_parent", "parent_id", 1)]
        elif "VIEW_ROUTINE_USAGE" in sql:
            self.rows = [("school", "v_student_labels")]
        else:
            raise AssertionError("예상하지 않은 SQL: %s / %r" % (sql, params))

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        rows, self.rows = self.rows, []
        return rows


class DependencyConnection(object):
    def cursor(self):
        return DependencyCursor()


w._state["connection"] = DependencyConnection()
w._state["read_only"] = False
w._state["auto_commit"] = True
w._state["pending"] = False
w._state["table_meta"] = {}

table = w.load_dependencies("table", "parent")
assert table["ok"], table
assert {item["kind"] for item in table["dependencies"]} == {"view", "foreignKey"}, table
assert "parent_audit" in table["warnings"][0], table

column = w.load_dependencies("column", "age", "student", "school")
assert {item["kind"] for item in column["dependencies"]} == {"index", "foreignKey", "column"}, column
assert any("age_group" in item["detail"] for item in column["dependencies"]), column

index = w.load_dependencies("index", "idx_parent", "child", "school")
assert len(index["dependencies"]) == 1, index
assert index["dependencies"][0]["name"] == "fk_parent", index

function = w.load_dependencies("function", "student_label", "", "school")
assert function["dependencies"][0]["name"] == "v_student_labels", function

foreign_key = w.load_dependencies("foreignkey", "fk_parent", "child", "school")
assert foreign_key["dependencies"] == [], foreign_key

print("ok")
