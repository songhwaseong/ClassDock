const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("../vendor/exceljs.min.js");
const {
  spreadsheetWorkspaceBounds, spreadsheetEnsureWorkspace, spreadsheetDataModel,
  writeStructuredSpreadsheetModel, spreadsheetWorksheetDisplayLayout
} = require("../src/js/spreadsheet-viewer.js");
const cell = (v="") => ({ v, xv:v === "" ? null : v, nf:null, f:null, style:{} });

test("화면용 격자는 원본 데이터와 행 스냅샷을 보존하고 반복 렌더에서 무한히 늘지 않는다", () => {
  const model = [[cell("이름"), cell("점수")], [cell("가"), cell(90)]];
  const before = structuredClone(model);
  const historyRows = model.slice();
  assert.equal(spreadsheetEnsureWorkspace(model, 1920), true);
  assert.ok(model.length >= 40);
  assert.ok(model[0].length >= 28);
  assert.deepEqual(historyRows, before);
  assert.deepEqual(spreadsheetDataModel(model), before);
  assert.equal(spreadsheetEnsureWorkspace(model, 1920), false);
  assert.notEqual(model[2][2], model[2][3]);
});

test("원본 너비가 있는 일반 XLSX도 레이아웃을 읽고 빈 영역의 입력·수식·서식을 저장한다", async () => {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("성적");
  ws.getColumn(1).width = 18.375;
  ws.getColumn(2).width = 9.25;
  ws.getRow(1).height = 35;
  const layout = spreadsheetWorksheetDisplayLayout(wb, ws.name);
  assert.equal(layout.columns[0], Math.round(18.375 * 7 + 5));
  assert.equal(layout.rows[0], Math.round(35 / 0.75));
  const model = [[cell("이름"), cell("점수")], [cell("가"), cell(90)]];
  spreadsheetEnsureWorkspace(model);
  Object.assign(model[10][7], { v:77, xv:77 });
  Object.assign(model[11][8], { f:"H11+1", v:78, xv:null });
  model[12][9].style = { fill:{ type:"pattern", pattern:"solid", fgColor:{ argb:"FFFFFF00" } } };
  assert.deepEqual(spreadsheetWorkspaceBounds(model), { rows:13, cols:10 });
  writeStructuredSpreadsheetModel(ws, model, []);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await wb.xlsx.writeBuffer());
  const sheet = loaded.getWorksheet("성적");
  assert.equal(sheet.getCell("H11").value, 77);
  assert.equal(sheet.getCell("I12").formula, "H11+1");
  assert.equal(sheet.getCell("J13").fill.fgColor.argb, "FFFFFF00");
  assert.equal(sheet.getColumn(1).width, 18.375);
  assert.equal(sheet.getRow(1).height, 35);
  assert.equal(sheet.rowCount, 13);
  assert.ok(sheet.columnCount <= 10); // ExcelJS columnCount는 값 없는 서식 셀을 제외할 수 있다.
});

test("빈 영역 끝에 입력하면 격자가 확장되고 되돌린 모델은 원래 데이터 범위를 유지한다", () => {
  const model = [[cell("시작")]];
  spreadsheetEnsureWorkspace(model);
  const undo = structuredClone(model);
  const r = model.length - 1, c = model[0].length - 1;
  Object.assign(model[r][c], { v:"끝", xv:"끝" });
  assert.equal(spreadsheetEnsureWorkspace(model), true);
  assert.ok(model.length > r + 1 && model[0].length > c + 1);
  assert.deepEqual(spreadsheetWorkspaceBounds(model), { rows:r + 1, cols:c + 1 });
  assert.equal(spreadsheetEnsureWorkspace(undo), false);
  assert.deepEqual(spreadsheetWorkspaceBounds(undo), { rows:1, cols:1 });
});

test("화면 빈 영역은 CSV용 행 배열에서 제외하고 명시적인 원본 빈 행·열은 유지한다", () => {
  const model = [[cell("A"), cell()], [cell(), cell()]];
  spreadsheetEnsureWorkspace(model);
  const data = spreadsheetDataModel(model);
  assert.equal(data.length, 2);
  assert.equal(data[0].length, 2);
  assert.equal(data.map(row => row.map(s => s.v).join(",")).join("\n"), "A,\n,");
  Object.assign(model[8][8], { v:0, xv:0 });
  assert.deepEqual(spreadsheetWorkspaceBounds(model), { rows:9, cols:9 });
  Object.assign(model[8][8], { v:"", xv:null });
  assert.deepEqual(spreadsheetWorkspaceBounds(model), { rows:2, cols:2 });
});

test("큰 표의 여유 격자 추가는 한 번에 12000셀 이내로 제한한다", () => {
  const model = Array.from({ length:20000 }, () => [cell(1)]);
  const original = model.length;
  spreadsheetEnsureWorkspace(model, 3840);
  assert.ok(model.length * model[0].length - original <= 12000);
  assert.equal(model[0].length, 1);
  assert.deepEqual(spreadsheetWorkspaceBounds(model), { rows:20000, cols:1 });
});
