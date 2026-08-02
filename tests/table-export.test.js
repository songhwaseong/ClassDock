"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const MNTableExport = require("../src/js/table-export.js");

const table = (rows, header=true) => ({ id:"table-1", type:"table", rows, header });

test("들쭉날쭉한 행도 직사각형으로 채워 꺼낸다", () => {
  const rows = MNTableExport.rowsOf(table([["이름", "점수"], ["민수"]]));
  assert.deepEqual(rows, [["이름", "점수"], ["민수", ""]]);
});

test("CSV 는 쉼표·따옴표·줄바꿈이 든 셀만 인용한다", () => {
  const csv = MNTableExport.toCsv(table([
    ["이름", "비고"],
    ['김"철수"', "국어, 수학"],
    ["줄\n바꿈", "보통"]
  ]));
  assert.equal(csv, [
    "이름,비고",
    '"김""철수""","국어, 수학"',
    '"줄\n바꿈",보통'
  ].join("\r\n"));
});

test("TSV 는 셀 안의 탭·줄바꿈을 공백으로 눕혀 격자를 지킨다", () => {
  const tsv = MNTableExport.toTsv(table([["이름", "비고"], ["민수", "한 줄\n두 줄\t끝"]]));
  assert.equal(tsv, "이름\t비고\n민수\t한 줄 두 줄 끝");
});

test("빈 표는 내보낼 내용이 없는 것으로 본다", () => {
  assert.equal(MNTableExport.hasContent(table([["", ""], [" ", ""]])), false);
  assert.equal(MNTableExport.hasContent(table([["", "값"]])), true);
});

test("파일 이름은 금지 문자를 지우고, 표가 여럿일 때만 번호를 붙인다", () => {
  assert.equal(MNTableExport.suggestBase("새 메모 1", 0, 1), "새 메모 1 표");
  assert.equal(MNTableExport.suggestBase("새 메모 1", 1, 3), "새 메모 1 표2");
  assert.equal(MNTableExport.suggestBase("보고서.mnote", 0, 1), "보고서 표");
  assert.equal(MNTableExport.suggestBase("2.5학기 점수", 0, 1), "2.5학기 점수 표");
  assert.equal(MNTableExport.suggestBase('나쁜:이름*"', 0, 1), "나쁜이름 표");
  assert.equal(MNTableExport.fileName("메모 표", "csv"), "메모 표.csv");
});

test("표 편집기 복사본은 원본 문서와 같은 작업 폴더 경로를 쓴다", () => {
  assert.equal(
    MNTableExport.siblingWorkspacePath({ workspacePath:"수업/자료/보고서.mnote" }, "보고서 표.xlsx"),
    "수업/자료/보고서 표.xlsx"
  );
  assert.equal(MNTableExport.siblingWorkspacePath(null, "메모 표.xlsx"), "메모 표.xlsx");
});
