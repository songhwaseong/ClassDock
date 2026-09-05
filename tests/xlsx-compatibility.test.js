const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const F=require("../src/js/spreadsheet-formula.js");
const T=require("../src/js/spreadsheet-tools.js");
const V=require("../src/js/spreadsheet-viewer.js");
const ExcelJS=require("../vendor/exceljs.min.js");

test("Excel 반올림: 음수 절반, 소수 오차, 음수 자릿수",()=>{
  for(const [f,expected] of [["ROUND(-1.5,0)",-2],["ROUND(-1.475,2)",-1.48],["ROUND(1.005,2)",1.01],["ROUND(-50.55,-2)",-100],["ROUND(2.15,1)",2.2]])
    assert.equal(F.evaluateFormula(f),expected,f);
});
test("TEXT는 셀 표시와 같은 SSF로 월/분·퍼센트·앞자리 0을 구분한다",()=>{
  assert.equal(F.evaluateFormula('TEXT(DATE(2026,9,5)+0.5,"hh:mm")'),"12:00");
  assert.equal(F.evaluateFormula('TEXT(0.125,"0.0%")'),"12.5%");
  assert.equal(F.evaluateFormula('TEXT(7,"0000")'),"0007");
  assert.equal(F.evaluateFormula('TEXT(DATE(2026,9,5),"yyyy-mm-dd")'),"2026-09-05");
});
test("EDATE는 월말·윤년·음수 이동을 지킨다",()=>{
  assert.equal(F.evaluateFormula("EDATE(DATE(2024,1,31),1)"),F.evaluateFormula("DATE(2024,2,29)"));
  assert.equal(F.evaluateFormula("EDATE(DATE(2026,3,31),-1)"),F.evaluateFormula("DATE(2026,2,28)"));
});
test("XLOOKUP은 근사·역방향·와일드카드·생략 인수를 처리한다",()=>{
  const grid=[[10,100],[20,200],[30,300],[20,400]];
  const res=(c,r)=>grid[r]?.[c]??"";
  assert.equal(F.evaluateFormula('XLOOKUP(25,A1:A4,B1:B4,"없음",-1)',res),200);
  assert.equal(F.evaluateFormula('XLOOKUP(25,A1:A4,B1:B4,"없음",1)',res),300);
  assert.equal(F.evaluateFormula('XLOOKUP(20,A1:A4,B1:B4,,0,-1)',res),400);
  assert.equal(F.evaluateFormula('_xlfn.XLOOKUP(20,A1:A4,B1:B4)',res),200);
  const words=[["가*나",1],["가나다",2],["다라마",3]];
  const wr=(c,r)=>words[r]?.[c]??"";
  assert.equal(F.evaluateFormula('XLOOKUP("가~*나",A1:A3,B1:B3,,2)',wr),1);
  assert.equal(F.evaluateFormula('XLOOKUP("가?다",A1:A3,B1:B3,,2)',wr),2);
});
test("전체 열 참조와 SUBTOTAL은 필터·수동 숨김·중첩 집계를 구분한다",()=>{
  const grid=[[10],[20],[30],[999]];
  const res=(c,r)=>grid[r]?.[c]??"";
  res.bounds=()=>({rows:4,cols:1});
  res.excludeRow=(r,sh,manual)=>r===1 || (manual&&r===2);
  res.isSubtotal=(c,r)=>r===3;
  assert.equal(F.evaluateFormula("SUM(A:A)",res),1059);
  assert.equal(F.evaluateFormula("SUBTOTAL(9,A1:A4)",res),40);
  assert.equal(F.evaluateFormula("SUBTOTAL(109,A1:A4)",res),10);
  assert.equal(F.evaluateFormula("SUBTOTAL(1,A:A)",res),20);
});
test("시트 구조 변경: 교차 시트·절대참조·범위 축소·전체 삭제",()=>{
  assert.equal(T.remapStructure("SUM(Data!$A$2:$A$4)","Report","Data",{axis:"r",at:1}),"SUM(Data!$A$3:$A$5)");
  assert.equal(T.remapStructure("Other!A2:A4+Data!A2","Data","Data",{axis:"r",at:1}),"Other!A2:A4+Data!A3");
  assert.equal(T.remapStructure("SUM(A2:A4)","Data","Data",{axis:"r",deleted:[1]}),"SUM(A2:A3)");
  assert.equal(T.remapStructure("SUM(A2:A4)","Data","Data",{axis:"r",deleted:[1,2,3]}),"SUM(#REF!)");
  assert.equal(T.remapStructure("'내 시트'!B2","Report","내 시트",{axis:"c",at:1}),"'내 시트'!C2");
  assert.equal(T.remapStructure('"Data!A2"&Data!A2',"Report","Data",{axis:"r",at:1}),'"Data!A2"&Data!A3');
});
test("입력값은 백분율·콤마·날짜를 인식하고 텍스트와 긴 번호는 보존한다",()=>{
  assert.equal(T.inputValue("10%"),0.1);
  assert.equal(T.inputValue("1,234.5"),1234.5);
  assert.equal(T.inputValue("001"),"001");
  assert.equal(T.inputValue("123","@"),"123");
  assert.equal(T.inputValue("1234567890123456"),"1234567890123456");
  assert.equal(T.inputValue("'123"),"123");
  assert.ok(T.inputValue("2026-09-05") instanceof Date);
  assert.equal(T.inputValue("2026-02-30"),"2026-02-30");
});
test("구조 변경 저장은 삭제한 드롭다운을 제거하고 수식의 유효성도 보존한다",async()=>{
  const w=new ExcelJS.Workbook(),ws=w.addWorksheet("Data");
  ws.getCell("A1").value="yes";
  ws.getCell("A1").dataValidation={type:"list",formulae:['"yes,no"']};
  const validation={type:"whole",operator:"between",formulae:[1,10],showErrorMessage:true};
  V.writeStructuredSpreadsheetModel(ws,[[{v:"yes",xv:"yes",style:{},validation:null},{f:"1+1",v:2,style:{},validation}]],[]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await w.xlsx.writeBuffer());
  assert.equal(loaded.getWorksheet("Data").getCell("A1").dataValidation,undefined);
  assert.equal(loaded.getWorksheet("Data").getCell("B1").dataValidation.type,"whole");
});
test("미지원 수식 저장은 원본 계산 결과와 수식을 유지한다",async()=>{
  const w=new ExcelJS.Workbook(),ws=w.addWorksheet("Data");
  V.writeStructuredSpreadsheetModel(ws,[[{f:"UNSUPPORTED(1)",v:123,xv:{formula:"UNSUPPORTED(1)",result:123},unsupportedFormula:true,style:{}}]],[]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await w.xlsx.writeBuffer());
  assert.deepEqual(loaded.getWorksheet("Data").getCell("A1").value,{formula:"UNSUPPORTED(1)",result:123});
});
test("원본 조건부 서식은 지원 규칙을 읽고 미지원 규칙 원문도 보존한다",async()=>{
  const w=new ExcelJS.Workbook(),ws=w.addWorksheet("Data");ws.getCell("A1").value=100;
  ws.addConditionalFormatting({ref:"A1:A5",rules:[{type:"cellIs",operator:"greaterThan",formulae:[60],style:{fill:{type:"pattern",pattern:"solid",fgColor:{argb:"FFFF0000"}}}}]});
  ws.addConditionalFormatting({ref:"B1:B5",rules:[{type:"expression",formulae:["B1>A1"],style:{font:{bold:true}}}]});
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await w.xlsx.writeBuffer());
  const rules=T.readConditionalRules(loaded.getWorksheet("Data"));
  assert.equal(rules[0].kind,"highlight");assert.equal(rules[0].fill,"#FF0000");
  assert.equal(rules[1].kind,"unsupported");assert.deepEqual(rules[1].native.formulae,["B1>A1"]);
});
test("다중 정렬은 순위·숫자·빈칸·동률 순서를 지킨다",()=>{
  const rows=[["나",2],["가",3],["가",1],["가",1],["가",""]].map(row=>row.map(v=>({v})));
  assert.deepEqual(T.stableSort(rows,[{col:0,dir:1},{col:1,dir:-1}]).map(x=>x.index),[1,2,3,4,0]);
});
test("실제 워크북 구조 변경 핸들러는 다른 시트와 조건부 범위를 함께 갱신한다",()=>{
  const source=fs.readFileSync(require.resolve("../src/js/spreadsheet-viewer.js"),"utf8");
  const start=source.indexOf("  const remapWorkbookStructure =");
  const end=source.indexOf("  const remapModelFormulas =",start);
  const context={wb:{},worksheetViews:{},exModels:{Data:[[{v:1}],[{v:2}]],Report:[[{f:"Data!A2"}]]},
    condRulesBySheet:{Data:[{range:{s:{r:1,c:0},e:{r:3,c:0}}}]},structChanged:new Set(),
    spreadsheetTools:T,rangeA1:rg=>F.spreadsheetColumnName(rg.s.c)+(rg.s.r+1)+":"+F.spreadsheetColumnName(rg.e.c)+(rg.e.r+1),
    decodeSpreadsheetMerge:text=>{const [a,b]=text.split(":").map(F.parseA1Ref);return a&&b?{s:a,e:b}:null;}};
  vm.runInNewContext(source.slice(start,end)+'\nremapWorkbookStructure("Data",{axis:"r",at:1});',context);
  assert.equal(context.exModels.Report[0][0].f,"Data!A3");
  assert.ok(context.structChanged.has("Report"));
  assert.equal(context.condRulesBySheet.Data[0].range.s.r,2);
});


test("입력 제한은 숫자·글자수와 목록을 검증한다",()=>{
  assert.ok(T.validationError(11,{type:"whole",operator:"between",formulae:[1,10]}));
  assert.equal(T.validationError(5,{type:"whole",operator:"between",formulae:[1,10]}),"");
  assert.ok(T.validationError(1.5,{type:"whole",operator:"between",formulae:[1,10]}));
  assert.equal(T.validationError("",{type:"whole",allowBlank:true,formulae:[1,10]}),"");
  assert.equal(T.validationError("A",{type:"list",formulae:["Data!A1:A3"]},["A","B"]),"");
  assert.ok(T.validationError("Z",{type:"list",formulae:['"A,B"']}));
});
test("중복 행은 선택 열의 값으로 비교하고 원본 모델을 바꾸지 않는다",()=>{
  const rows=[["A",1],["a",2],["B",1],["A",3]].map(row=>row.map(v=>({v})));
  assert.deepEqual(T.duplicateRows(rows,{s:{r:0,c:0},e:{r:3,c:0}}),[1,3]);
  assert.equal(rows.length,4);
});
test("피벗은 여러 그룹·값과 교차 열을 집계한다",()=>{
  const rows=[["1반","남","국어",10,1],["1반","남","국어",20,2],["1반","남","수학",30,3],["2반","여","국어",40,4]];
  assert.deepEqual(T.pivotGrid(rows,[0,1],[3,4],"sum",2).rows,[["1반","남",30,3,30,3],["2반","여",40,4,0,0]]);
  assert.deepEqual(T.pivotGrid(rows,[0],[3],"avg").rows,[["1반",20],["2반",40]]);
});
test("표 참조와 이름 범위를 계산용 셀 주소로 확장한다",()=>{
  const tables={Data:[{name:"Table1",range:{s:{r:0,c:0},e:{r:3,c:1}},columns:["Name","Score"],headerRow:true}]};
  assert.equal(T.expandReferences("SUM(Table1[Score])","Report",0,tables),"SUM('Data'!$B$2:$B$4)");
  assert.equal(T.expandReferences("[@Score]*2","Data",2,tables),"'Data'!$B3*2");
  assert.equal(T.expandReferences('"Table1[Score]"',"Data",2,tables),'"Table1[Score]"');
  assert.equal(T.expandReferences("SUM(점수)","Data",2,tables,[{Name:"점수",Ref:"Data!$B$2:$B$4"}]),"SUM((Data!$B$2:$B$4))");
});
test("연결 설정은 XLSX 내부에 저장되고 셀 데이터와 함께 다시 읽힌다",async()=>{
  const w=new ExcelJS.Workbook();w.addWorksheet("Data").getCell("A1").value=123;
  const settings={Data:{view:{chart:{sheet:"Data",range:"A1:B3",type:"bar"},freezeCols:2},filters:{0:["가","나"]}}};
  const bytes=T.writeSettings(await w.xlsx.writeBuffer(),settings);
  assert.deepEqual(T.readSettings(bytes),settings);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes);
  assert.equal(loaded.getWorksheet("Data").getCell("A1").value,123);
  assert.equal(loaded.worksheets.length,1);
  assert.deepEqual(T.readSettings(T.writeSettings(await loaded.xlsx.writeBuffer(),T.readSettings(bytes))),settings);
});
test("실제 통합 문서 히스토리는 교차 시트 수식·조건부 서식·보기를 한 번에 되돌린다",()=>{
  const source=fs.readFileSync(require.resolve("../src/js/spreadsheet-viewer.js"),"utf8");
  const start=source.indexOf("  const cloneModel ="),end=source.indexOf("  // 도구모음 버튼을 누르면",start);
  const context={
    structuredClone,csvFastAoa:false,cloneSpreadsheetValue:V.cloneSpreadsheetValue,
    exModels:{Data:[[{v:1,xv:1,style:{},f:null}]],Report:[[{v:1,f:"Data!A1",style:{}}]]},
    exMerges:{Data:[],Report:[]},editedCells:{Data:new Map(),Report:new Map()},styledCells:{Data:new Map(),Report:new Map()},
    sheetRevs:{},condRulesBySheet:{Data:[],Report:[]},structChanged:new Set(),sheetsWithFormula:new Set(["Report"]),
    sheet:{},worksheetViews:{Data:{freezeCols:0},Report:{}},colFiltersBySheet:{},
    wb:{SheetNames:["Data","Report"],Sheets:{Data:{},Report:{}}},currentSheet:"Data",sheetOrigNames:new Map(),addedSheets:new Set(),removedOrigSheets:new Set(),
    sourceLayoutSheets:new Map(),undoBtn:null,redoBtn:null,anyDirty:false,rerender:()=>{},toast:()=>{},MNEditHistory:vm.runInNewContext(fs.readFileSync(require.resolve("../src/js/history.js"),"utf8")+"\nMNEditHistory",{setTimeout,clearTimeout})
  };
  const actions=[
    'pushUndo("Data")','exModels.Data[0][0].v=2','exModels.Report[0][0].f="Data!A2"',
    'condRulesBySheet.Data.push({kind:"highlight",id:1})','worksheetViews.Data.freezeCols=2','doUndo()',
    'globalThis.undone=[exModels.Data[0][0].v,exModels.Report[0][0].f,condRulesBySheet.Data.length,worksheetViews.Data.freezeCols]',
    'doRedo()','globalThis.redone=[exModels.Data[0][0].v,exModels.Report[0][0].f,condRulesBySheet.Data.length,worksheetViews.Data.freezeCols]'
  ].join(";");
  vm.runInNewContext(source.slice(start,end)+actions,context);
  assert.equal(JSON.stringify(context.undone),JSON.stringify([1,"Data!A1",0,0]));
  assert.equal(JSON.stringify(context.redone),JSON.stringify([2,"Data!A2",1,2]));
});


test("전체 열 참조는 복사·열 삽입·삭제에서 절대참조와 시트 범위를 지킨다",()=>{
  const shift=(c,r,a)=>({c:a.colAbs?c:c+1,r:a.rowAbs?r:r+1});
  assert.equal(F.remapFormulaRefs("SUM(A:A,$B:$C,Data!A1:B2)",shift),"SUM(B:B,$B:$C,Data!A1:B2)");
  assert.equal(F.remapFormulaRefs("SUM(Data!A:A)",shift,{includeSheetRefs:true}),"SUM(Data!B:B)");
  assert.equal(F.remapFormulaRefs("A1!B2",shift,{includeSheetRefs:true}),"A1!C3");
  assert.equal(F.remapFormulaSheetName("SUM(A1!B:B)","A1","New"),"SUM(New!B:B)");
  assert.equal(T.remapStructure("SUM(Data!$A:$C)","Report","Data",{axis:"c",at:1}),"SUM(Data!$A:$D)");
  assert.equal(T.remapStructure("SUM(A:C)","Data","Data",{axis:"c",deleted:[0]}),"SUM(A:B)");
  assert.equal(T.remapStructure("SUM(A:C)","Data","Data",{axis:"c",deleted:[0,1,2]}),"SUM(#REF!)");
  assert.equal(T.remapStructure("SUM(A:C)","Data","Data",{axis:"r",at:0}),"SUM(A:C)");
});
test("기존 목록의 사용자 입력 메시지와 오류 정책을 보존한다",()=>{
  const validation={type:"list",formulae:['"A,B"'],allowBlank:false,showErrorMessage:false,promptTitle:"안내",prompt:"직접 입력 가능"};
  assert.deepEqual(T.validationFor({validation,dv:{values:["A","B"]}}),validation);
});
test("표 머리글 변경은 해당 표의 수식만 바꾸고 복제한 표의 이름도 바꿀 수 있다",()=>{
  const changes=new Map([["score","점수"]]);
  assert.equal(T.renameTableReferences('SUM(Table1[Score])+Table2[Score]&"Table1[Score]"',"Table1",changes),
    'SUM(Table1[점수])+Table2[Score]&"Table1[Score]"');
  assert.equal(T.renameTableReferences("[@Score]+[@[Score]]","Table1",changes,true),"[@점수]+[@[점수]]");
  assert.equal(T.renameTableReferences("SUM(Table1[Score])","Table1",new Map(),false,"Table2"),"SUM(Table2[Score])");
});
test("실제 Excel 표 저장 경로는 원본·확장·새 표를 중복 없이 다시 읽는다",async()=>{
  const source=fs.readFileSync(require.resolve("../src/js/spreadsheet-viewer.js"),"utf8");
  const start=source.indexOf("    const applyTables="),end=source.indexOf("    const writeWorkbook=",start);
  const w=new ExcelJS.Workbook(),ws=w.addWorksheet("Data");
  ws.addTable({name:"Table1",ref:"A1",columns:[{name:"이름"},{name:"점수"}],rows:[["가",1]]});
  const model=[["이름","점수"],["가",1],["나",2]].map(row=>row.map(v=>({v,xv:v,style:{}})));
  const context={ws,worksheetViews:{Data:{tables:[{name:"Table1",range:{s:{r:0,c:0},e:{r:2,c:1}},columns:["이름","점수"],headerRow:true}]}},
    exModels:{Data:model},cloneSpreadsheetValue:V.cloneSpreadsheetValue,encodeSpreadsheetCell:(r,c)=>F.spreadsheetColumnName(c)+(r+1)};
  vm.runInNewContext(source.slice(start,end)+'applyTables(ws,"Data");applyTables(ws,"Data");',context);
  V.writeStructuredSpreadsheetModel(ws,model,[]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await w.xlsx.writeBuffer());
  const result=loaded.getWorksheet("Data");
  assert.equal(result.getTables().length,1);
  assert.equal(result.getTable("Table1").table.tableRef,"A1:B3");
  assert.equal(result.getCell("B3").value,2);
});
test("실제 메뉴 조립은 유효한 노드를 연결하고 인쇄 메뉴를 독립적으로 둔다",()=>{
  class Node {
    constructor(tag="button"){this.tag=tag;this.children=[];this.style={};this.value="0";}
    append(...items){items.forEach(item=>{assert.ok(item instanceof Node,"메뉴에 노드가 아닌 객체가 전달됨");this.children.push(item);});}
    appendChild(item){this.append(item);return item;}
    prepend(item){assert.ok(item instanceof Node);this.children.unshift(item);}
    addEventListener(){}
    cloneNode(){return new Node(this.tag);}
  }
  const source=fs.readFileSync(require.resolve("../src/js/spreadsheet-viewer.js"),"utf8");
  const start=source.indexOf("    const makeGroup ="),end=source.indexOf("    const addSheetBtn =",start);
  const ps=source.indexOf("    const printSettings="),pe=source.indexOf("    const mkAutoBtn =",ps);
  const ms=source.indexOf("    const mainRow =",pe),me=source.indexOf("    const fmtRow =",ms);
  const context={document:{createElement:tag=>new Node(tag),createTextNode:()=>new Node("text")},editToolMenus:[]};
  for(const key of ["undoBtn","redoBtn","filterInput","sortSel","ascBtn","descBtn","xlsxBtn","xlsxCopyBtn","csvBtn2","printBtn2"])context[key]=new Node();
  for(const key of ["structureMenu","autoMenu","findMenu","moreMenu"])context[key]={details:new Node("details")};
  vm.runInNewContext(source.slice(start,end)+source.slice(ps,pe)+source.slice(ms,me)+"globalThis.result={mainRow,dataGroup,printSettings};",context);
  assert.equal(context.result.dataGroup.children.filter(n=>n.tag==="details").length,2);
  assert.ok(context.result.mainRow.children.includes(context.result.printSettings.details));
});
