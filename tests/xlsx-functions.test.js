const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const F=require("../src/js/spreadsheet-formula.js");
const T=require("../src/js/spreadsheet-tools.js");
const V=require("../src/js/spreadsheet-viewer.js");
const ExcelJS=require("../vendor/exceljs.min.js");
const XLSX=require("../vendor/xlsx.full.min.js");
const Zip=require("../vendor/jszip.min.js");

const resolverFor=(definitions,grid=[])=>{
  const resolver=(c,r)=>grid[r]?.[c]??"";
  resolver.bounds=()=>({rows:grid.length,cols:grid[0]?.length || 0});
  resolver.resolveName=name=>definitions[name]?F.parseFormula(definitions[name]):null;
  return resolver;
};
test("LAMBDA는 직접 호출·한글 입력값·범위 인수·오류를 처리한다",()=>{
  assert.equal(F.evaluateFormula("LAMBDA(중간,기말,중간*0.4+기말*0.6)(80,90)"),86);
  assert.equal(F.evaluateFormula("LAMBDA(42)()"),42);
  assert.equal(F.evaluateFormula("LAMBDA(x,SUM(x))(A1:A3)",resolverFor({},[[1],[2],[3]])),6);
  assert.equal(F.evaluateFormula("LAMBDA(x,IFERROR(1/x,0))(0)"),0);
  assert.equal(F.evaluateFormula("LAMBDA(x,x)"),"#CALC!");
  assert.equal(F.evaluateFormula("LAMBDA(x,x)(1,2)"),"#VALUE!");
  assert.equal(F.evaluateFormula("LAMBDA(x,x)()"),"#VALUE!");
  assert.equal(F.evaluateFormula("LAMBDA(x,x,x)(1,2)"),"#VALUE!");
  assert.equal(F.evaluateFormula("LAMBDA(A1,A1)(1)"),"#VALUE!");
});
test("LET와 중첩 LAMBDA는 지역 변수·클로저·이름 가리기를 지킨다",()=>{
  assert.equal(F.evaluateFormula("LET(x,2,y,x+3,x*y)"),10);
  assert.equal(F.evaluateFormula("LET(x,2,fn,LAMBDA(y,x+y),LET(x,10,fn(3)))"),5);
  assert.equal(F.evaluateFormula("LAMBDA(x,LAMBDA(y,x+y))(2)(3)"),5);
  assert.equal(F.evaluateFormula("LET(x,1,LET(x,x+1,x))"),2);
  assert.equal(F.evaluateFormula("LET(x,1,x,2)"),"#VALUE!");
  const resolver=resolverFor({X:"10",FN:"LAMBDA(y,X+y)"});
  assert.equal(F.evaluateFormula("LET(x,100,FN(2))",resolver),12);
});
test("이름 함수는 다른 함수·재귀를 호출하며 무한 재귀는 제한한다",()=>{
  const resolver=resolverFor({DOUBLE:"LAMBDA(x,x*2)",PLUS:"LAMBDA(x,DOUBLE(x)+1)",FACT:"LAMBDA(n,IF(n<=1,1,n*FACT(n-1)))",LOOP:"LAMBDA(x,LOOP(x))"});
  assert.equal(F.evaluateFormula("plus(3)",resolver),7);
  assert.equal(F.evaluateFormula("FACT(6)",resolver),720);
  assert.equal(F.evaluateFormula("LOOP(1)",resolver),"#NUM!");
  assert.equal(F.evaluateFormula("UNKNOWN(1)",resolver),"#NAME?");
  assert.equal(F.evaluateFormula("IF(TRUE,7,LOOP(1))",resolver),7);
  assert.equal(F.evaluateFormula("CYCLE",resolverFor({CYCLE:"CYCLE"})),"#CYCLE!");
});
test("Excel의 함수·매개 변수 접두사를 읽고 저장 형식을 안정적으로 생성한다",()=>{
  const raw="_xlfn.LAMBDA(_xlpm.temp,(5/9)*(_xlpm.temp-32))";
  assert.equal(F.evaluateFormula(raw+"(212)"),100);
  assert.equal(F.excelFormula(F.displayFormula(raw)),raw);
  assert.equal(F.excelFormula(F.excelFormula(raw)),raw);
  assert.equal(F.excelFormula('LAMBDA(x,LET(x,x+1,x+$A$1))'),
    '_xlfn.LAMBDA(_xlpm.x,_xlfn.LET(x,_xlpm.x+1,x+$A$1))');
  assert.equal(F.excelFormula('LAMBDA(x,"x _xlpm.x"&x)'), '_xlfn.LAMBDA(_xlpm.x,"x _xlpm.x"&_xlpm.x)');
  assert.deepEqual(F.lambdaDetails(raw),{parameters:["temp"],body:"(5/9)*(temp-32)"});
});
test("함수 등록은 이름·인수·구문·지원 함수와 충돌을 검사한다",()=>{
  const valid=T.customFunctionDefinition("가중점수","중간, 기말","=중간*0.4+기말*0.6");
  assert.equal(valid.definition.Ref,"LAMBDA(중간,기말,중간*0.4+기말*0.6)");
  for(const [name,params,body] of [["SUM","x","x"],["A1","x","x"],["TestFn","x,X","x"],["TestFn","c","c"],["TestFn","x","x+"],["TestFn","x","missing+x"],["TestFn","x","UNSUPPORTED(x)"]])
    assert.ok(T.customFunctionDefinition(name,params,body).error,[name,params,body].join("/"));
  assert.ok(T.customFunctionDefinition("가중점수","x","x",[valid.definition]).error);
  assert.ok(T.customFunctionDefinition("FACT","n","IF(n<=1,1,n*FACT(n-1))").definition);
  assert.ok(T.customFunctionDefinition("constant","","42").definition);
});
test("지원 판정은 지역 변수·다른 이름 함수와 미지원 의존 함수를 구분한다",()=>{
  const resolver=resolverFor({DOUBLE:"LAMBDA(x,x*2)",BAD:"LAMBDA(x,UNSUPPORTED(x))",FACT:"LAMBDA(n,IF(n<2,1,n*FACT(n-1)))"});
  const supports=text=>F.formulaIsSupported(F.parseFormula(text),resolver.resolveName);
  assert.equal(supports("DOUBLE(3)"),true);
  assert.equal(supports("BAD(3)"),false);
  assert.equal(supports("FACT(3)"),true);
  assert.equal(supports("LET(x,1,x+2)"),true);
  assert.equal(supports("LAMBDA(x,LAMBDA(y,x+y))(1)(2)"),true);
  assert.equal(supports("MISSING(3)"),false);
});
test("한글·밑줄 함수는 자동완성에 잡히고 셀 주소는 인자 힌트를 유지한다",()=>{
  assert.deepEqual(F.formulaTypingContext("=가중점",4),{type:"name",partial:"가중점",start:1});
  assert.deepEqual(F.formulaTypingContext("=내_함수(",6),{type:"args",name:"내_함수"});
  assert.deepEqual(F.formulaTypingContext("=SUM(A1",7),{type:"args",name:"SUM"});
});
test("XLSX 표준 이름 정의는 저장·수정·삭제 후 복원되고 인쇄 설정은 유지된다",async()=>{
  const w=new ExcelJS.Workbook(),ws=w.addWorksheet("Data");ws.getCell("A1").value={formula:"가중점수(80,90)",result:86};ws.pageSetup.printArea="A1:B3";
  const definition={Name:"가중점수",Ref:"LAMBDA(중간,기말,중간*0.4+기말*0.6)",Comment:'점수 & "설명"'};
  const bytes=T.writeDefinedNames(await w.xlsx.writeBuffer(),[definition,{Name:"LocalFn",Ref:"LAMBDA(x,x+1)",Sheet:0}]);
  const read=XLSX.read(bytes,{type:"array"});
  assert.equal(read.Workbook.Names.find(n=>n.Name==="가중점수").Ref,F.excelFormula(definition.Ref));
  assert.equal(read.Workbook.Names.find(n=>n.Name==="LocalFn").Sheet,0);
  assert.equal(read.Sheets.Data.A1.v,86);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes);
  const edited=T.writeDefinedNames(await loaded.xlsx.writeBuffer(),[{...definition,Ref:"LAMBDA(x,x*3)"}]);
  const again=XLSX.read(edited,{type:"array"});
  assert.equal(again.Workbook.Names.find(n=>n.Name==="가중점수").Ref,"_xlfn.LAMBDA(_xlpm.x,_xlpm.x*3)");
  assert.ok(again.Workbook.Names.some(n=>n.Name==="_xlnm.Print_Area"));
  const deleted=XLSX.read(T.writeDefinedNames(edited,[]),{type:"array"});
  assert.ok(!deleted.Workbook.Names.some(n=>n.Name==="가중점수"));
});
test("실제 셀 쓰기와 현재 시트 내보내기도 LAMBDA 정의·캐시·범위를 보존한다",async()=>{
  const w=new ExcelJS.Workbook();w.addWorksheet("Other").getCell("A1").value=1;const ws=w.addWorksheet("Data");
  V.writeStructuredSpreadsheetModel(ws,[[{f:"LAMBDA(x,x*2)(3)",v:6,style:{}},{f:"LAMBDA(x,x)",v:"#CALC!",style:{}}]],[]);
  const defs=[{Name:"내함수",Ref:"LAMBDA(x,x+1)"},{Name:"LocalFn",Ref:"LAMBDA(x,x*2)",Sheet:1}];
  const bytes=T.writeDefinedNames(await w.xlsx.writeBuffer(),defs);
  const isolated=await V.spreadsheetIsolateWorksheetBytes(bytes,"Data",ExcelJS);
  const read=XLSX.read(isolated,{type:"array",xlfn:true});
  assert.deepEqual(read.SheetNames,["Data"]);
  assert.equal(read.Workbook.Names.find(n=>n.Name==="LocalFn").Sheet,0);
  assert.equal(read.Sheets.Data.A1.f,"_xlfn.LAMBDA(_xlpm.x,_xlpm.x*2)(3)");
  assert.equal(read.Sheets.Data.A1.v,6);
  assert.equal(read.Sheets.Data.B1.w,"#CALC!");
  assert.ok(new Zip(isolated).file("xl/workbook.xml").asText().includes("_xlpm."));
});
function viewerRuntime(){
  const source=fs.readFileSync(require.resolve("../src/js/spreadsheet-viewer.js"),"utf8");
  const context={structuredClone,spreadsheetFormulaFunctions:F,spreadsheetTools:T,...F,spreadsheetWorkspaceBounds:V.spreadsheetWorkspaceBounds,
    wb:{SheetNames:["Data","Other"],Sheets:{Data:{},Other:{}},Workbook:{Names:[{Name:"가중점수",Ref:"LAMBDA(중간,기말,중간*0.4+기말*0.6)"}]}},
    worksheetViews:{},exModels:{Data:[[{v:80},{v:90},{f:"가중점수(A1,B1)",xv:{result:1}}]],Other:[[{f:"가중점수(50,100)"}]]},
    currentSheet:"Data",sheetsWithFormula:new Set(["Data","Other"]),colFiltersBySheet:{},editState:{filter:""},dispCell:cell=>String(cell.v??""),
    renderEditable:()=>{},structChanged:new Set(),anyDirty:false};
  const start=source.indexOf("  const astCache ="),end=source.indexOf("  const maybeRecalc =",start);
  vm.createContext(context);vm.runInContext(source.slice(start,end)+"globalThis.run=recalcAll;",context);
  return {source,context};
}
test("실제 뷰어는 등록한 함수를 두 시트에서 재계산하고 원본 결과 사용으로 오인하지 않는다",()=>{
  const {context}=viewerRuntime();context.run();
  assert.equal(context.exModels.Data[0][2].v,86);assert.equal(context.exModels.Other[0][0].v,80);
  assert.equal(context.exModels.Data[0][2].unsupportedFormula,false);
  context.exModels.Data[0][0].v=100;context.run();assert.equal(context.exModels.Data[0][2].v,94);
});
test("실제 정의 변경 핸들러는 함수 수정·삭제와 실행 취소를 연결한다",()=>{
  const {source,context}=viewerRuntime();
  Object.assign(context,{
    condRulesBySheet:{},csvFastAoa:false,cloneSpreadsheetValue:V.cloneSpreadsheetValue,exMerges:{Data:[],Other:[]},editedCells:{Data:new Map(),Other:new Map()},
    styledCells:{Data:new Map(),Other:new Map()},sheet:{},sheetOrigNames:new Map(),addedSheets:new Set(),removedOrigSheets:new Set(),sourceLayoutSheets:new Map(),
    rerender:()=>context.run(),toast:()=>{},MNEditHistory:vm.runInNewContext(fs.readFileSync(require.resolve("../src/js/history.js"),"utf8")+"\nMNEditHistory",{setTimeout,clearTimeout})
  });
  const hs=source.indexOf("  const cloneModel ="),he=source.indexOf("  // 도구모음 버튼을 누르면",hs);
  const cs=source.indexOf("  const changeFunctionDefinitions ="),ce=source.indexOf("  let functionModal=",cs);
  vm.runInContext('const sheetRevs={};let undoBtn=null,redoBtn=null;const recalcAndRefresh=()=>recalcAll();'+source.slice(hs,he)+source.slice(cs,ce)+
    'recalcAll();changeFunctionDefinitions([{Name:"가중점수",Ref:"LAMBDA(x,y,x+y)"}]);globalThis.changed=exModels.Data[0][2].v;'+
    'changeFunctionDefinitions([]);globalThis.deleted=exModels.Data[0][2].v;doUndo();globalThis.undone=exModels.Data[0][2].v;doRedo();globalThis.redone=exModels.Data[0][2].v;',context);
  assert.equal(context.changed,170);assert.equal(context.deleted,"#NAME?");assert.equal(context.undone,170);assert.equal(context.redone,"#NAME?");
});
