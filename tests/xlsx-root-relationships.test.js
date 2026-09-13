const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path").posix;
const ExcelJS = require("../vendor/exceljs.min.js");
const JSZip = require("../vendor/jszip.min.js");
const { spreadsheetNormalizeXlsxNamespaces, spreadsheetLoadExcelWorkbook,
  spreadsheetEditFailureMessage } = require("../src/js/spreadsheet-viewer.js");

test("루트 기준 표 연결과 접두사 XML을 읽고 표·서식·수식을 저장한다", async () => {
  const original = new ExcelJS.Workbook();
  const sheet = original.addWorksheet("성적");
  sheet.addTable({ name:"Grades", ref:"A1", headerRow:true,
    columns:[{ name:"이름" }, { name:"점수" }], rows:[["가온", 52], ["나래", 59]] });
  sheet.getCell("C2").value = { formula:"B2+10", result:62 };
  sheet.getCell("B2").font = { bold:true, color:{ argb:"FF2563EB" } };
  sheet.getColumn(1).width = 24;
  const zip = new JSZip(await original.xlsx.writeBuffer());
  for (const name of Object.keys(zip.files)){
    const entry = zip.file(name);
    if (!entry) continue;
    if (name.endsWith(".rels")){
      const base = path.dirname(path.dirname(name));
      zip.file(name, entry.asText().replace(/Target="([^"]+)"/g,
        (_all, target) => 'Target="/' + path.normalize(path.join(base, target)) + '"'));
    } else if (name.endsWith(".xml")){
      const xml = entry.asText();
      if (xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')){
        zip.file(name, xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
          .replace(/<(\/?)(?![A-Za-z_][\w.-]*:)([A-Za-z_][\w.-]*)(?=[\s/>])/g, "<$1x:$2"));
      }
    }
  }
  const bytes = zip.generate({ type:"uint8array", compression:"STORE" });
  await assert.rejects(new ExcelJS.Workbook().xlsx.load(bytes));
  const loaded = await spreadsheetLoadExcelWorkbook(bytes, ExcelJS, JSZip);
  const current = loaded.getWorksheet("성적");
  assert.equal(current.getCell("A2").value, "가온");
  assert.equal(current.getTable("Grades").name, "Grades");
  assert.equal(current.getCell("B2").font.color.argb, "FF2563EB");
  assert.equal(current.getColumn(1).width, 24);
  current.getCell("B2").value = 80;
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await loaded.xlsx.writeBuffer());
  assert.equal(saved.getWorksheet("성적").getCell("B2").value, 80);
  assert.equal(saved.getWorksheet("성적").getTable("Grades").name, "Grades");
  assert.deepEqual(saved.getWorksheet("성적").getCell("C2").value, { formula:"B2+10", result:62 });
});

test("내부 절대 경로만 보정하고 외부 링크와 원본 바이트는 유지한다", () => {
  const zip = new JSZip();
  const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="t" Target="/xl/tables/table1.xml"/>' +
    "<Relationship Id='s' Target = '/xl/media/image1.png'/>" +
    '<Relationship Id="r" Target="../drawings/drawing1.xml"/>' +
    '<Relationship Id="e" Target="/downloads/file.xlsx" TargetMode="External"/>' +
    '<Relationship Id="u" Target="//example.com/file.xlsx"/>' +
    '</Relationships>';
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", rels);
  zip.file("_rels/.rels", '<Relationships><Relationship Target="/xl/workbook.xml"/></Relationships>');
  const bytes = zip.generate({ type:"uint8array" });
  const fixed = new JSZip(spreadsheetNormalizeXlsxNamespaces(bytes, JSZip));
  const text = fixed.file("xl/worksheets/_rels/sheet1.xml.rels").asText();
  assert.match(text, /Target="\.\.\/tables\/table1.xml"/);
  assert.match(text, /Target='\.\.\/media\/image1.png'/);
  assert.ok(text.includes('<Relationship Id="r" Target="../drawings/drawing1.xml"/>'));
  assert.ok(text.includes('<Relationship Id="e" Target="/downloads/file.xlsx" TargetMode="External"/>'));
  assert.ok(text.includes('<Relationship Id="u" Target="//example.com/file.xlsx"/>'));
  assert.match(fixed.file("_rels/.rels").asText(), /Target="xl\/workbook.xml"/);
  assert.equal(new JSZip(bytes).file("xl/worksheets/_rels/sheet1.xml.rels").asText(), rels);
  const normalized = fixed.generate({ type:"uint8array" });
  assert.strictEqual(spreadsheetNormalizeXlsxNamespaces(normalized, JSZip), normalized);
});

test("편집 실패 안내는 라이브러리 누락과 파일 읽기 오류를 구분한다", () => {
  assert.match(spreadsheetEditFailureMessage(false, null), /라이브러리/);
  assert.match(spreadsheetEditFailureMessage(true, new Error("table")), /내부 형식/);
  assert.doesNotMatch(spreadsheetEditFailureMessage(true, new Error("table")), /라이브러리/);
  assert.match(spreadsheetEditFailureMessage(true, null), /시트/);
});
