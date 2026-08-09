const test = require("node:test");
const assert = require("node:assert/strict");

const api = require("../src/js/office-replace.js");

function editedRows(xml, text){
  return api.officeParagraphOutline(xml).map(item => ({
    index: item.index,
    text,
    original: item.text,
    removed: false,
    after: 0
  }));
}

test("DOCX editor saves the first text entered into an empty paragraph", () => {
  const xml = '<w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p></w:body>';
  const plan = api.officeParagraphEditPlan(xml, editedRows(xml, "홍길동"));
  const out = api.officeApplyEdits(xml, plan.edits);

  assert.equal(plan.changed, 1);
  assert.equal(plan.skipped, 0);
  assert.match(out, /<w:pPr><w:jc w:val="center"\/><\/w:pPr>/);
  assert.match(out, /<w:r><w:t>홍길동<\/w:t><\/w:r>/);
});

test("DOCX editor expands a self-closing empty paragraph for pasted text", () => {
  const xml = '<w:body><w:p/></w:body>';
  const plan = api.officeParagraphEditPlan(xml, editedRows(xml, "붙여넣은 내용"));
  const out = api.officeApplyEdits(xml, plan.edits);

  assert.equal(plan.changed, 1);
  assert.equal(plan.skipped, 0);
  assert.equal(out, '<w:body><w:p><w:r><w:t>붙여넣은 내용</w:t></w:r></w:p></w:body>');
});

test("DOCX editor removes an extra empty paragraph from a table cell", () => {
  const xml = '<w:body><w:tbl><w:tr><w:tc>' +
    '<w:p><w:r><w:t>기술 내용</w:t></w:r></w:p><w:p/>' +
    '</w:tc></w:tr></w:tbl></w:body>';
  const outline = api.officeParagraphOutline(xml);
  const plan = api.officeParagraphStructureEdits(outline, [2], []);
  const out = api.officeApplyEdits(xml, plan.edits);

  assert.equal(plan.removed, 1);
  assert.equal(plan.refused.length, 0);
  assert.equal((out.match(/<w:p(?:\s[^>]*)?>/g) || []).length, 1);
  assert.match(out, /기술 내용/);
});

test("DOCX editor keeps the only paragraph required by a table cell", () => {
  const xml = '<w:body><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body>';
  const plan = api.officeParagraphStructureEdits(api.officeParagraphOutline(xml), [1], []);

  assert.equal(plan.removed, 0);
  assert.equal(plan.refused.length, 1);
  assert.match(plan.refused[0].reason, /문단 하나/);
});
