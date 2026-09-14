"use strict";

// 엑셀 되돌리기: 바뀌지 않은 수식 없는 시트는 복제본을 재사용하되, 되돌리기 결과는 예전과 똑같아야 한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const V = require("../src/js/spreadsheet-viewer.js");

const source = fs.readFileSync(require.resolve("../src/js/spreadsheet-viewer.js"), "utf8");
const start = source.indexOf("  const cloneModel =");
const end = source.indexOf("  // 도구모음 버튼을 누르면", start);
const historySource = fs.readFileSync(require.resolve("../src/js/history.js"), "utf8") + "\nMNEditHistory";

function cell(v, f=null){ return { v, xv:v, style:{}, f }; }

// 실제 spreadsheet-viewer.js 의 히스토리 코드를 그대로 실행한다. structuredClone 을 세어 시트별 복제 횟수를 본다.
function workbook(){
  const clones = new Map();
  const context = {
    csvFastAoa:false, cloneSpreadsheetValue:V.cloneSpreadsheetValue,
    exModels:{ Data:[[cell(1)]], Notes:[[cell("memo")]], Report:[[cell(1, "Data!A1")]] },
    exMerges:{ Data:[], Notes:[], Report:[] },
    editedCells:{ Data:new Map(), Notes:new Map(), Report:new Map() },
    styledCells:{ Data:new Map(), Notes:new Map(), Report:new Map() },
    sheetRevs:{}, condRulesBySheet:{ Data:[], Notes:[], Report:[] }, structChanged:new Set(), sheetsWithFormula:new Set(["Report"]),
    sheet:{}, worksheetViews:{ Data:{}, Notes:{}, Report:{} }, colFiltersBySheet:{},
    wb:{ SheetNames:["Data", "Notes", "Report"], Sheets:{ Data:{}, Notes:{}, Report:{} } }, currentSheet:"Data",
    sheetOrigNames:new Map(), addedSheets:new Set(), removedOrigSheets:new Set(), sourceLayoutSheets:new Map(),
    undoBtn:null, redoBtn:null, anyDirty:false, rerender(){}, toast(){},
    MNEditHistory:vm.runInNewContext(historySource, { setTimeout, clearTimeout })
  };
  context.structuredClone = (value) => {
    for (const [name, model] of Object.entries(context.exModels)) if (model === value) clones.set(name, (clones.get(name) || 0) + 1);
    return structuredClone(value);
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const run = (code) => vm.runInContext(code, context);
  return { context, clones, run, value:(name) => run(`exModels[${JSON.stringify(name)}][0][0].v`) };
}

test("같은 시트를 여러 번 고쳐도 건드리지 않은 수식 없는 시트는 한 번만 복제하고, 수식 시트는 매번 복제한다", () => {
  const { clones, run } = workbook();
  for (let i = 2; i <= 6; i++) run(`pushUndo("Data"); exModels.Data[0][0].v = ${i};`);
  run(`doUndo()`);
  assert.equal(clones.get("Notes"), 1, "바뀌지 않은 시트를 편집마다 다시 복제했다");
  assert.ok(clones.get("Report") >= 6, "수식 시트는 제자리 재계산 때문에 매번 복제해야 한다");
  assert.ok(clones.get("Data") >= 5, "고친 시트는 매번 새 상태를 복제해야 한다");
});

test("재사용해도 되돌리기·다시 실행 결과가 정확하다(여러 시트·되돌린 뒤 새 편집)", () => {
  const { run, value } = workbook();
  run(`pushUndo("Notes"); exModels.Notes[0][0].v = "수정";`);
  run(`pushUndo("Data"); exModels.Data[0][0].v = 2;`);
  run(`doUndo()`);
  assert.equal(value("Data"), 1);
  assert.equal(value("Notes"), "수정");
  run(`doUndo()`);
  assert.equal(value("Notes"), "memo");
  run(`doRedo(); doRedo();`);
  assert.equal(value("Notes"), "수정");
  assert.equal(value("Data"), 2);

  // 되돌린 뒤 새로 편집하면 sheetRevs 가 예전 숫자로 돌아가 같은 번호가 다시 나온다. 그래도 옛 복제본을 쓰면 안 된다.
  run(`doUndo()`);
  assert.equal(value("Data"), 1);
  run(`pushUndo("Data"); exModels.Data[0][0].v = 3;`);
  run(`doUndo()`);
  assert.equal(value("Data"), 1);
  run(`doRedo()`);
  assert.equal(value("Data"), 3);
});

test("수식 시트가 기록 없이 제자리에서 재계산돼도 되돌리기는 그 시점의 값을 되살린다", () => {
  const { run, value } = workbook();
  run(`pushUndo("Data"); exModels.Data[0][0].v = 2;`);
  run(`exModels.Report[0][0].v = 2;`);               // recalcAll 처럼 pushUndo 없이 결과만 바뀐다
  run(`pushUndo("Data"); exModels.Data[0][0].v = 5;`);
  run(`exModels.Report[0][0].v = 5;`);
  run(`doUndo()`);
  assert.equal(value("Data"), 2);
  assert.equal(value("Report"), 2, "수식 시트의 옛 복제본을 재사용해 재계산 결과가 어긋났다");
});

test("되살린 모델을 고쳐도 히스토리에 공유된 복제본은 오염되지 않는다", () => {
  const { run, value } = workbook();
  run(`pushUndo("Notes"); exModels.Notes[0][0].v = "A";`);
  run(`pushUndo("Data"); exModels.Data[0][0].v = 2;`);
  run(`doUndo(); doUndo();`);                          // Notes 를 복원: 복제본을 재사용 표에 올린다
  assert.equal(value("Notes"), "memo");
  run(`exModels.Notes[0][0].style.bold = true;`);      // 기록 없이 되살린 셀 객체를 건드려도
  run(`doRedo(); doUndo();`);
  assert.equal(run(`exModels.Notes[0][0].style.bold`), undefined, "되살릴 때 공유 복제본을 그대로 넘겼다");
});

test("시트 이름을 바꾸거나 지우면 재사용 표도 따라 정리된다", () => {
  const rename = source.slice(source.indexOf("  const renameSheetState = (oldName, name) => {"), source.indexOf("  const addNewSheet = async"));
  assert.match(rename, /modelCloneCache\.set\(name, modelCloneCache\.get\(oldName\)\); modelCloneCache\.delete\(oldName\);/);
  const remove = source.slice(source.indexOf("  const deleteCurrentSheet = async () => {"));
  assert.match(remove.slice(0, 1200), /modelCloneCache\.delete\(name\);/);
});
