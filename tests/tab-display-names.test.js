const test = require("node:test");
const assert = require("node:assert/strict");
const { tabNameStem, tabDisplayNames } = require("../src/js/document-types.js");

test("상단 탭은 단독 파일의 확장명을 숨기고 숨김 파일 이름은 유지한다", () => {
  assert.equal(tabNameStem("보고서.pdf"), "보고서");
  assert.equal(tabNameStem("README"), "README");
  assert.equal(tabNameStem(".env.local"), ".env.local");
  assert.deepEqual([...tabDisplayNames([
    { id:1, name:"보고서.pdf" }, { id:2, name:".env.local" }
  ])], [[1, "보고서"], [2, ".env.local"]]);
});

test("같은 이름의 열린 탭은 확장명과 필요한 폴더 경로로 구분한다", () => {
  const labels = tabDisplayNames([
    { id:1, name:"보고서.pdf", path:"1반/보고서.pdf" },
    { id:2, name:"보고서.docx", path:"2반/보고서.docx" },
    { id:3, name:"계획.txt", path:"A/자료/계획.txt" },
    { id:4, name:"계획.txt", path:"B/자료/계획.txt" }
  ]);
  assert.equal(labels.get(1), "보고서.pdf");
  assert.equal(labels.get(2), "보고서.docx");
  assert.equal(labels.get(3), "계획.txt · A/자료");
  assert.equal(labels.get(4), "계획.txt · B/자료");
});

test("같은 전체 파일명에 경로 정보가 없을 때도 탭을 구분한다", () => {
  const labels = tabDisplayNames([
    { id:1, name:"메모.txt" }, { id:2, name:"메모.txt" }
  ]);
  assert.equal(labels.get(1), "메모.txt (1)");
  assert.equal(labels.get(2), "메모.txt (2)");
});
