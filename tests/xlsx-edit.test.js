const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("../vendor/exceljs.min.js");
const {
  adjustSpreadsheetMergesAfterColumnInsert,
  adjustSpreadsheetMergesAfterColumnDelete,
  adjustSpreadsheetMergesAfterRowDelete,
  adjustSpreadsheetMergesAfterRowInsert,
  spreadsheetRangesOverlap,
  parseClipboardTable,
  pxToExcelColWidth,
  pxToExcelRowHeight,
  evaluateFormula,
  remapFormulaRefs,
  buildSpreadsheetChartSvg,
  cloneSpreadsheetValue,
  spreadsheetCellValueSnapshot,
  spreadsheetVirtualWindow,
  spreadsheetGuessHeader,
  spreadsheetConvertedDocOptions,
  spreadsheetDirectSaveKind,
  spreadsheetSelectionBoundsFromKeys,
  spreadsheetSelectionCombineKeys,
  spreadsheetSelectionDragHitPoint,
  spreadsheetSelectionRangeCovered,
  spreadsheetSelectionRangeKeys,
  writeStructuredSpreadsheetModel
} = require("../src/js/spreadsheet-viewer.js");

test("Ctrl 선택은 떨어진 범위를 추가하고 선택된 범위를 다시 누르면 해제한다", () => {
  const maxCols = 5;
  const first = { row1:0, row2:1, col1:0, col2:1 };
  const extra = { row1:0, row2:0, col1:3, col2:3 };
  let keys = spreadsheetSelectionCombineKeys(new Set(), first, "replace", maxCols);

  assert.deepEqual([...spreadsheetSelectionRangeKeys(first, maxCols)], [0, 1, 5, 6]);
  assert.equal(spreadsheetSelectionRangeCovered(keys, first, maxCols), true);
  assert.deepEqual(
    spreadsheetSelectionBoundsFromKeys(keys, maxCols),
    { row1:0, row2:1, col1:0, col2:1, contiguous:true, count:4 }
  );

  keys = spreadsheetSelectionCombineKeys(keys, extra, "add", maxCols);
  assert.equal(spreadsheetSelectionRangeCovered(keys, extra, maxCols), true);
  assert.deepEqual(
    spreadsheetSelectionBoundsFromKeys(keys, maxCols),
    { row1:0, row2:1, col1:0, col2:3, contiguous:false, count:5 }
  );

  keys = spreadsheetSelectionCombineKeys(keys, extra, "subtract", maxCols);
  assert.deepEqual(
    spreadsheetSelectionBoundsFromKeys(keys, maxCols),
    { row1:0, row2:1, col1:0, col2:1, contiguous:true, count:4 }
  );
});

test("행·열 헤더 선택 드래그는 포인터가 헤더 띠를 벗어나도 시작 축을 유지한다", () => {
  const sheet = { left:100, right:900, top:50, bottom:650 };
  const corner = { left:100, right:146, top:50, bottom:82 };
  const colRow = { left:100, right:900, top:50, bottom:82 };

  assert.deepEqual(
    spreadsheetSelectionDragHitPoint("row", { x:700, y:360 }, sheet, corner, colRow),
    { x:102, y:360 }
  );
  assert.deepEqual(
    spreadsheetSelectionDragHitPoint("row", { x:700, y:20 }, sheet, corner, colRow),
    { x:102, y:84 }
  );
  assert.deepEqual(
    spreadsheetSelectionDragHitPoint("col", { x:620, y:500 }, sheet, corner, colRow),
    { x:620, y:52 }
  );
  assert.deepEqual(
    spreadsheetSelectionDragHitPoint("col", { x:40, y:500 }, sheet, corner, colRow),
    { x:148, y:52 }
  );
  assert.deepEqual(
    spreadsheetSelectionDragHitPoint("cell", { x:20, y:10 }, sheet, corner, colRow),
    { x:148, y:84 }
  );
});

test("열 필터 값 목록은 항목이 많아도 행을 축소하지 않고 긴 값만 말줄임한다", () => {
  const root = path.join(__dirname, "..");
  const viewer = fs.readFileSync(path.join(root, "src/js/spreadsheet-viewer.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(viewer, /valueText\.className\s*=\s*"sheet-colfilter-value"/);
  assert.match(styles, /\.sheet-colfilter-list label\{[^}]*flex:0 0 auto;[^}]*min-height:20px/);
  assert.match(styles, /\.sheet-colfilter-value\{[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
});

test("CSV 변환 문서는 원본 CSV 대신 같은 폴더의 XLSX를 저장 대상으로 삼는다", () => {
  const csvHandle = { kind:"file", name:"성적.csv" };
  const parentDirHandle = { kind:"directory", name:"자료" };
  const aoa = [["이름", "점수"], ["가", "90"]];
  const options = spreadsheetConvertedDocOptions({
    parentId:"folder-1",
    workspacePath:"자료/성적.csv",
    relPath:"자료/성적.csv",
    fsHandle:csvHandle,
    fsDirHandle:parentDirHandle
  }, "성적.xlsx", aoa, true);

  assert.equal(options.convertedFromCsv, true);
  assert.equal(options.fsHandle, null);
  assert.equal(options.fsDirHandle, parentDirHandle);
  assert.equal(options.workspacePath, "자료/성적.xlsx");
  assert.equal(options.relPath, "자료/성적.xlsx");
  assert.equal(options.parentId, "folder-1");
  assert.equal(options.originalSaveMode, false);
  assert.equal(options.spreadsheetAoa, aoa);
  assert.equal(options.spreadsheetHasHeader, true);

  assert.equal(spreadsheetDirectSaveKind({ convertedFromCsv:true }), "create");
  assert.equal(spreadsheetDirectSaveKind({ convertedFromCsv:true, fsHandle:{} }), "existing");
  assert.equal(spreadsheetDirectSaveKind({ fsHandle:{} }), "existing");
  assert.equal(spreadsheetDirectSaveKind({}), "");
});

test("CSV 첫 줄 머리글 추정: 컬럼명/데이터/애매를 구분한다", () => {
  // 숫자 열인데 첫 줄만 텍스트 → 머리글
  assert.equal(spreadsheetGuessHeader([
    ["이름", "점수", "나이"],
    ["가", "90", "12"],
    ["나", "85", "13"],
    ["다", "77", "12"]
  ]), true);
  // 첫 줄도 아래와 같은 숫자 형태 → 데이터(머리글 아님)
  assert.equal(spreadsheetGuessHeader([
    ["1", "90", "12"],
    ["2", "85", "13"],
    ["3", "77", "12"]
  ]), false);
  // 전부 텍스트 + 첫 줄 값이 고유 → 머리글로 추정
  assert.equal(spreadsheetGuessHeader([
    ["도시", "지역", "구분"],
    ["서울", "수도권", "특별시"],
    ["부산", "영남", "광역시"]
  ]), true);
  // 첫 줄에 빈 칸이 섞이면 머리글로 보기 어렵다 → 데이터
  assert.equal(spreadsheetGuessHeader([
    ["", "10", "20"],
    ["x", "11", "21"],
    ["y", "12", "22"]
  ]), false);
  // 데이터가 거의 없으면 기존 동작대로 머리글
  assert.equal(spreadsheetGuessHeader([["a", "b"]]), true);
});

test("XLSX 셀 값 스냅샷은 수식·날짜·리치텍스트를 독립 복제한다", () => {
  const source = {
    formula: "A1+1",
    result: 2,
    meta: { date:new Date("2026-07-03T00:00:00Z"), richText:[{ text:"값" }] }
  };
  const copied = cloneSpreadsheetValue(source);
  assert.deepEqual(copied, source);
  assert.notEqual(copied, source);
  assert.notEqual(copied.meta, source.meta);
  assert.notEqual(copied.meta.date, source.meta.date);
  assert.ok(copied.meta.date instanceof Date);
});

test("행 삭제 후 병합 범위는 이동·축소되고 사라진 범위는 제거된다", () => {
  const merges = ["A1:B3", "C5:C6", "D2:E2", "F8:G8"];
  assert.deepEqual(
    adjustSpreadsheetMergesAfterRowDelete(merges, [1]),
    ["A1:B2", "C4:C5", "F7:G7"]
  );
});

test("열 삭제 후 병합 범위는 이동·축소되고 사라진 범위는 제거된다", () => {
  // B열(index 1) 삭제
  assert.deepEqual(
    adjustSpreadsheetMergesAfterColumnDelete(["A1:C1", "E2:F2", "B5:B6", "D3:E3"], [1]),
    ["A1:B1",   // A1:C1 → C가 B로 이동해 A1:B1로 축소
     "D2:E2",   // E2:F2 → 왼쪽으로 한 칸 이동
     // B5:B6 → 유일한 열 B가 삭제되어 남는 셀 없음 → 제거
     "C3:D3"]   // D3:E3 → 왼쪽으로 한 칸 이동
  );
});

test("열 삭제: 축소로 단일 셀이 되는 병합은 지워지고 나머지는 왼쪽으로 이동한다", () => {
  assert.deepEqual(
    adjustSpreadsheetMergesAfterColumnDelete(["B1:C1", "E1:F1"], [1]),   // B열 삭제 → B1:C1은 단일 셀 되어 제거
    ["D1:E1"]
  );
  assert.deepEqual(
    adjustSpreadsheetMergesAfterColumnDelete(["B2:D2"], [2]),            // C열(중간) 삭제 → 범위 축소
    ["B2:C2"]
  );
  assert.deepEqual(
    adjustSpreadsheetMergesAfterColumnDelete(["C1:C4"], [2]),            // 단일 열 병합의 그 열 삭제 → 남는 열 없음 → 제거
    []
  );
});

test("행·열 삽입 후 병합 범위는 위치에 따라 이동하거나 확장된다", () => {
  assert.deepEqual(
    adjustSpreadsheetMergesAfterRowInsert(["A2:B3", "C5:D5"], 1),
    ["A3:B4", "C6:D6"]
  );
  assert.deepEqual(
    adjustSpreadsheetMergesAfterRowInsert(["A2:B4"], 2),
    ["A2:B5"]
  );
  assert.deepEqual(
    adjustSpreadsheetMergesAfterColumnInsert(["B2:C3", "E1:F1"], 1),
    ["C2:D3", "F1:G1"]
  );
  assert.deepEqual(
    adjustSpreadsheetMergesAfterColumnInsert(["B2:D3"], 2),
    ["B2:E3"]
  );
});

test("클립보드 표 파싱: 탭=열·줄바꿈=행, 따옴표 필드는 탭·줄바꿈·이스케이프를 허용한다", () => {
  assert.deepEqual(
    parseClipboardTable("a\tb\tc\n1\t2\t3"),
    [["a", "b", "c"], ["1", "2", "3"]]
  );
  // 마지막 줄바꿈이 만든 빈 행은 제거
  assert.deepEqual(parseClipboardTable("x\ty\n"), [["x", "y"]]);
  // 따옴표로 감싼 필드: 내부 줄바꿈·탭 보존, "" → " 이스케이프
  assert.deepEqual(
    parseClipboardTable('"여러\n줄"\t"탭\t포함"\n"큰따옴표"" 값"\tend'),
    [["여러\n줄", "탭\t포함"], ['큰따옴표" 값', "end"]]
  );
  // 빈 입력은 단일 빈 행(빈 문자열 붙여넣기)로 취급
  assert.deepEqual(parseClipboardTable(""), [[""]]);
});

test("범위 겹침 판정: 접하는·떨어진·포함 관계를 구분한다", () => {
  const A = { s:{ r:0, c:0 }, e:{ r:2, c:2 } };
  assert.equal(spreadsheetRangesOverlap(A, { s:{ r:1, c:1 }, e:{ r:1, c:1 } }), true);   // 포함
  assert.equal(spreadsheetRangesOverlap(A, { s:{ r:2, c:2 }, e:{ r:4, c:4 } }), true);   // 모서리 접촉
  assert.equal(spreadsheetRangesOverlap(A, { s:{ r:3, c:0 }, e:{ r:4, c:2 } }), false);  // 아래로 분리
  assert.equal(spreadsheetRangesOverlap(A, { s:{ r:0, c:3 }, e:{ r:2, c:5 } }), false);  // 오른쪽으로 분리
});

test("픽셀 → 엑셀 단위 변환(열 폭=문자수, 행 높이=포인트)과 최소값 보장", () => {
  assert.equal(pxToExcelColWidth(75), 10);        // (75-5)/7 = 10
  assert.equal(pxToExcelColWidth(0), 1);          // 최소 폭 1
  assert.equal(pxToExcelRowHeight(20), 15);       // 20 * 0.75 = 15
  assert.equal(pxToExcelRowHeight(1), 6);         // 최소 높이 6
});

test("수식 엔진: 산술·참조·범위·핵심 함수·오류를 계산한다", () => {
  // grid[r][c] — A1=10, B1=20, A2=5, B2="x"(텍스트), A3=""(빈칸)
  const grid = [[10, 20], [5, "x"], ["", 3]];
  const resolver = (c, r) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : "");
  const f = (s) => evaluateFormula(s, resolver);

  assert.equal(f("=1+2*3"), 7);
  assert.equal(f("=(1+2)*3"), 9);
  assert.equal(f("=2^10"), 1024);
  assert.equal(f("=50%"), 0.5);
  assert.equal(f("=A1+B1"), 30);          // 10+20
  assert.equal(f("=A1*A2"), 50);          // 10*5
  assert.equal(f("=SUM(A1:B2)"), 35);     // 10+20+5 (텍스트 x 무시)
  assert.equal(f("=AVERAGE(A1:A3)"), 7.5);// (10+5)/2, 빈칸 제외
  assert.equal(f("=MIN(A1:B2)"), 5);
  assert.equal(f("=MAX(A1:B2)"), 20);
  assert.equal(f("=COUNT(A1:B3)"), 4);    // 숫자 셀 개수(10,20,5,3)
  assert.equal(f("=IF(A1>A2,\"큼\",\"작음\")"), "큼");
  assert.equal(f("=ROUND(A1/A2/3,2)"), 0.67);
  assert.equal(f('="점수:"&A1'), "점수:10");
  assert.equal(f("=A1/0"), "#DIV/0!");
  assert.equal(f("=A1+B2"), "#VALUE!");   // 10 + "x"
  assert.equal(f("=FOO(1)"), "#NAME?");
  assert.equal(f("=COUNTIF(A1:B2,\">8\")"), 2);   // 10,20
  assert.equal(f("=SUMIF(A1:A3,\">=5\")"), 15);   // 10+5
});

test("수식 엔진: 날짜·텍스트 함수", () => {
  const f = (s) => evaluateFormula(s, () => "");
  // 날짜
  assert.equal(f("=YEAR(DATE(2026,7,5))"), 2026);
  assert.equal(f("=MONTH(DATE(2026,7,5))"), 7);
  assert.equal(f("=DAY(DATE(2026,7,5))"), 5);
  assert.equal(f("=DATE(2026,8,5)-DATE(2026,7,5)"), 31);      // 직렬값 차이 = 일수
  assert.equal(f("=MONTH(EDATE(DATE(2026,7,5),2))"), 9);
  assert.equal(f("=DATEDIF(DATE(2026,1,1),DATE(2026,7,5),\"M\")"), 6);
  assert.equal(f("=TEXT(DATE(2026,7,5),\"yyyy-mm-dd\")"), "2026-07-05");
  assert.equal(f("=TEXT(1234.5,\"#,##0.00\")"), "1,234.50");
  // 텍스트
  assert.equal(f('=SUBSTITUTE("a-b-c","-","/")'), "a/b/c");
  assert.equal(f('=FIND("b","abc")'), 2);
  assert.equal(f('=SEARCH("B","abc")'), 2);
  assert.equal(f('=REPT("ab",3)'), "ababab");
  assert.equal(f('=PROPER("hello world")'), "Hello World");
  assert.equal(f('=TEXTJOIN("-",TRUE,"a","","b")'), "a-b");
  assert.equal(f('=VALUE("1,200")'), 1200);
});

test("차트 SVG 생성: 막대·선·원 모두 유효한 svg 문자열을 만든다", () => {
  const labels = ["A", "B", "C"], values = [3, 7, 5];
  for (const type of ["bar", "line", "pie"]){
    const svg = buildSpreadsheetChartSvg(type, labels, values, { width: 400, height: 240 });
    assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
    assert.ok(svg.includes("viewBox"));
  }
  // 라벨 텍스트가 이스케이프되어 들어간다
  assert.ok(buildSpreadsheetChartSvg("bar", ["<b>"], [1], {}).includes("&lt;b&gt;"));
});

test("수식 엔진: VLOOKUP·HLOOKUP·INDEX·MATCH 조회 함수", () => {
  // A1:C4 표 — 1열=코드, 2열=이름, 3열=점수
  const grid = [
    ["코드", "이름", "점수"],
    [1, "김", 90],
    [2, "이", 80],
    [3, "박", 70]
  ];
  const resolver = (c, r) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : "");
  const f = (s) => evaluateFormula(s, resolver);
  assert.equal(f("=VLOOKUP(2,A1:C4,2,FALSE)"), "이");       // 코드2 → 이름
  assert.equal(f("=VLOOKUP(3,A1:C4,3,FALSE)"), 70);         // 코드3 → 점수
  assert.equal(f("=VLOOKUP(9,A1:C4,2,FALSE)"), "#N/A");     // 없음
  assert.equal(f("=HLOOKUP(\"점수\",A1:C4,3,FALSE)"), 80);  // '점수' 열의 3번째 행
  assert.equal(f("=MATCH(\"이\",B1:B4,0)"), 3);             // '이' 는 3번째
  assert.equal(f("=INDEX(A1:C4,3,2)"), "이");               // 3행 2열
  assert.equal(f("=INDEX(C1:C4,MATCH(3,A1:A4,0))"), 70);    // INDEX+MATCH 조합
});

test("수식 엔진: 시트 간 참조(Sheet2!A1)를 resolver 로 해석한다", () => {
  const sheets = {
    Sheet1: [[1, 2]],
    "성적표": [[10, 20], [30, 40]]
  };
  // resolver(col, row, sheetName) — sheetName 없으면 현재 시트(Sheet1)
  const resolver = (c, r, sheet) => {
    const g = sheets[sheet || "Sheet1"];
    return (g && g[r] && g[r][c] !== undefined) ? g[r][c] : "";
  };
  const f = (s) => evaluateFormula(s, resolver);
  assert.equal(f("=Sheet1!A1+성적표!A1"), 11);          // 1 + 10
  assert.equal(f("=SUM(성적표!A1:B2)"), 100);           // 10+20+30+40
  assert.equal(f("='성적표'!B2"), 40);                  // 따옴표 시트 이름
  assert.equal(f("=A2"), "");                           // 현재 시트 빈 셀
});

test("수식 참조 재작성은 시트 간 참조(Sheet2!A1)를 건드리지 않는다", () => {
  const shiftDown = (c, r) => ({ c, r: r + 1 });
  assert.equal(remapFormulaRefs("A1+Sheet2!A1", shiftDown), "A2+Sheet2!A1");
});

test("수식 참조 재작성: 행 삽입·삭제·정렬에 따라 참조가 이동하고 삭제는 #REF!", () => {
  // 행 3(index 2) 위에 1행 삽입 → index>=2 인 행 참조는 +1
  const insertRow2 = (c, r) => ({ c, r: r >= 2 ? r + 1 : r });
  assert.equal(remapFormulaRefs("A1+B5", insertRow2), "A1+B6");     // B5(r4)→B6, A1 유지
  assert.equal(remapFormulaRefs("SUM(A1:A3)", insertRow2), "SUM(A1:A4)");  // 범위 확장
  assert.equal(remapFormulaRefs("$A$1+A5", insertRow2), "$A$1+A6");  // 절대표기 보존, 행은 이동

  // 행 5(index 4) 삭제 → 그 행 참조는 #REF!, 아래 행은 -1
  const delSet = new Set([4]);
  const delRow5 = (c, r) => { if (delSet.has(r)) return null; return { c, r: r > 4 ? r - 1 : r }; };
  assert.equal(remapFormulaRefs("A5*2", delRow5), "#REF!*2");
  assert.equal(remapFormulaRefs("A1+A7", delRow5), "A1+A6");

  // 열 B(index 1) 삽입 → col>=1 인 참조는 +1
  const insertColB = (c, r) => ({ c: c >= 1 ? c + 1 : c, r });
  assert.equal(remapFormulaRefs("A1+B1", insertColB), "A1+C1");

  // 정렬 순열: 행 1↔행 2 교환(상대참조만 따라감)
  const swap = (c, r, abs) => (!abs.rowAbs && (r === 1 || r === 2)) ? { c, r: r === 1 ? 2 : 1 } : { c, r };
  assert.equal(remapFormulaRefs("A2+$A$2", swap), "A3+$A$2");
});

test("가상 스크롤 창은 보이는 행 주변만 계산하고 전체 높이를 보존한다", () => {
  const top = spreadsheetVirtualWindow(10000, 0, 580, 29, 14);
  assert.equal(top.start, 0);
  assert.equal(top.count, 48);
  assert.equal(top.topHeight, 0);
  assert.equal(top.bottomHeight, (10000 - 48) * 29);

  const middle = spreadsheetVirtualWindow(10000, 29000, 580, 29, 14);
  assert.equal(middle.start, 986);
  assert.equal(middle.count, 48);
  assert.equal(middle.topHeight + middle.count * 29 + middle.bottomHeight, 10000 * 29);
});

test("구조 변경 저장은 수식을 유지하고 이동 전 위치의 서식을 지운다", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "머리글";
  sheet.getCell("A2").value = "서식 있음";
  sheet.getCell("A2").fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFFFF00" } };
  sheet.getCell("A3").value = "서식 없음";
  sheet.getCell("B2").value = { formula:"1+1", result:2 };

  const snapshot = (cell) => ({
    v: cell.value && typeof cell.value === "object" && cell.value.formula ? cell.value.result : (cell.value || ""),
    xv: spreadsheetCellValueSnapshot(cell),
    nf: cell.numFmt || null,
    style: cloneSpreadsheetValue(cell.style || {})
  });
  const model = [];
  for (let row = 1; row <= 3; row++) model.push([snapshot(sheet.getCell(row, 1)), snapshot(sheet.getCell(row, 2))]);
  model.splice(1, 2, model[2], model[1]);

  writeStructuredSpreadsheetModel(sheet, model, []);
  const bytes = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  const result = reopened.getWorksheet("Sheet1");

  assert.equal(result.getCell("A2").value, "서식 없음");
  assert.ok(!result.getCell("A2").fill || result.getCell("A2").fill.pattern !== "solid");
  assert.equal(result.getCell("A3").value, "서식 있음");
  assert.equal(result.getCell("A3").fill.fgColor.argb, "FFFFFF00");
  assert.deepEqual(result.getCell("B3").value, { formula:"1+1", result:2 });
});

test("구조 변경 저장은 수식 셀을 수식+결과로 기록한다", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  const model = [
    [{ v:10, xv:10, style:{}, f:null }, { v:20, xv:20, style:{}, f:null }],
    [{ v:30, xv:30, style:{}, f:"A1+B1" }, { v:"", xv:null, style:{}, f:null }]
  ];
  writeStructuredSpreadsheetModel(sheet, model, []);
  const bytes = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  const result = reopened.getWorksheet("Sheet1");
  const cell = result.getCell("A2");
  assert.equal(cell.value.formula, "A1+B1");
  assert.equal(cell.value.result, 30);
});

test("구조 변경 저장은 현재 병합 범위를 다시 적용한다", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "제목";
  const model = [[
    { v:"제목", xv:"제목", style:{} },
    { v:"제목", xv:"제목", style:{} }
  ], [
    { v:"", xv:null, style:{} },
    { v:"", xv:null, style:{} }
  ]];

  writeStructuredSpreadsheetModel(sheet, model, ["A1:B1"]);
  const bytes = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  const result = reopened.getWorksheet("Sheet1");

  assert.equal(result.getCell("B1").isMerged, true);
  assert.equal(result.getCell("B1").master.address, "A1");
  assert.equal(result.getCell("A1").value, "제목");
});

test("수식 엔진: 통계·다중조건·논리 확장 함수(RANK·SUMIFS·IFS·MEDIAN 등)", () => {
  // A열=반(1,1,2,2), B열=점수(90,70,80,60)
  const grid = [[1, 90], [1, 70], [2, 80], [2, 60]];
  const resolver = (c, r) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : "");
  const f = (s) => evaluateFormula(s, resolver);

  // 통계
  assert.equal(f("=MEDIAN(B1:B4)"), 75);                       // (70+80)/2
  assert.equal(f("=MEDIAN(B1:B3)"), 80);                       // 홀수 개
  assert.equal(f("=LARGE(B1:B4,2)"), 80);
  assert.equal(f("=SMALL(B1:B4,1)"), 60);
  assert.equal(f("=LARGE(B1:B4,9)"), "#NUM!");
  assert.equal(f("=ROUND(STDEV(B1:B4),4)"), 12.9099);          // 표본표준편차 √(500/3)
  assert.equal(f("=ROUND(STDEVP(B1:B4),4)"), 11.1803);         // 모표준편차 √125
  // 석차: 90점은 1등, 60점은 4등, 오름차순이면 60점이 1등
  assert.equal(f("=RANK(B1,B1:B4)"), 1);
  assert.equal(f("=RANK(B4,B1:B4)"), 4);
  assert.equal(f("=RANK(B4,B1:B4,1)"), 1);
  assert.equal(f("=RANK(999,B1:B4)"), "#N/A");
  // 다중 조건 집계
  assert.equal(f("=COUNTIFS(A1:A4,1,B1:B4,\">=70\")"), 2);     // 1반 & 70점 이상
  assert.equal(f("=SUMIFS(B1:B4,A1:A4,2)"), 140);              // 2반 점수 합
  assert.equal(f("=SUMIFS(B1:B4,A1:A4,1,B1:B4,\">80\")"), 90); // 1반 & 80점 초과
  assert.equal(f("=AVERAGEIFS(B1:B4,A1:A4,2)"), 70);
  assert.equal(f("=AVERAGEIFS(B1:B4,A1:A4,9)"), "#DIV/0!");    // 조건에 맞는 값 없음
  // 논리·조회
  assert.equal(f("=IFS(B1<80,\"보통\",B1>=80,\"우수\")"), "우수");
  assert.equal(f("=IFS(B4>=90,\"A\",B4>=70,\"B\")"), "#N/A");  // 아무 조건도 안 맞음
  assert.equal(f("=CHOOSE(2,\"가\",\"나\",\"다\")"), "나");
  assert.equal(f("=CHOOSE(9,\"가\",\"나\")"), "#VALUE!");
  assert.equal(f("=XLOOKUP(2,A1:A4,B1:B4)"), 80);              // 첫 일치(3행)
  assert.equal(f("=XLOOKUP(9,A1:A4,B1:B4,\"없음\")"), "없음");
  assert.equal(f("=XLOOKUP(9,A1:A4,B1:B4)"), "#N/A");
  // 정보 함수(빈칸·숫자·텍스트·오류)
  assert.equal(f("=ISBLANK(C1)"), "TRUE");
  assert.equal(f("=ISNUMBER(B1)"), "TRUE");
  assert.equal(f("=ISNUMBER(\"x\")"), "FALSE");
  assert.equal(f("=ISTEXT(\"x\")"), "TRUE");
  assert.equal(f("=ISERROR(1/0)"), "TRUE");
  assert.equal(f("=IF(ISERROR(1/0),\"오류\",\"정상\")"), "오류");
});

test("자동 채우기 텍스트 패턴: 요일·월 순환과 '1반' 증가, 역방향·비패턴 구분", () => {
  const { spreadsheetTextSeries } = require("../src/js/spreadsheet-viewer.js");
  // 요일 순환(주말 지나 되돌아옴)
  const day = spreadsheetTextSeries(["금"]);
  assert.deepEqual([day(0), day(1), day(2)], ["토", "일", "월"]);
  // 두 값으로 간격 파악(격일)
  const skip = spreadsheetTextSeries(["월", "수"]);
  assert.deepEqual([skip(0), skip(1)], ["금", "일"]);
  // 역방향(위로 드래그): 호출부가 뒤집어 넘기는 형태 그대로
  const rev = spreadsheetTextSeries(["수", "화"]);
  assert.deepEqual([rev(0), rev(1)], ["월", "일"]);
  // 월 순환: 12월 다음은 1월
  const month = spreadsheetTextSeries(["11월", "12월"]);
  assert.deepEqual([month(0), month(1)], ["1월", "2월"]);
  // 접두어+숫자: 1반→2반, 0채움 유지
  const ban = spreadsheetTextSeries(["1반"]);
  assert.deepEqual([ban(0), ban(1)], ["2반", "3반"]);
  const pad = spreadsheetTextSeries(["학생01", "학생02"]);
  assert.equal(pad(0), "학생03");
  // 간격 있는 숫자 패턴
  const step = spreadsheetTextSeries(["5번", "10번"]);
  assert.equal(step(0), "15번");
  // 패턴이 아니면 null(호출부가 순환 복사)
  assert.equal(spreadsheetTextSeries(["사과", "바나나"]), null);
  assert.equal(spreadsheetTextSeries(["월", "월"]), null);        // 동일 반복은 복사에 맡김
  assert.equal(spreadsheetTextSeries(["1반", "3반", "4반"]), null); // 간격 불일치
  assert.equal(spreadsheetTextSeries(["", "1반"]), null);           // 빈 값 포함
});

test("시트 이름 변경 시 수식 속 시트 참조를 재작성한다", () => {
  const { remapFormulaSheetName } = require("../src/js/spreadsheet-viewer.js");
  assert.equal(remapFormulaSheetName("Sheet2!A1+1", "Sheet2", "성적표"), "성적표!A1+1");
  assert.equal(remapFormulaSheetName("SUM(Sheet2!A1:B2)", "Sheet2", "성적표"), "SUM(성적표!A1:B2)");
  // 따옴표 시트 이름 · 공백 있는 새 이름은 따옴표로 감싼다
  assert.equal(remapFormulaSheetName("'내 시트'!A1", "내 시트", "새시트"), "새시트!A1");
  assert.equal(remapFormulaSheetName("Sheet2!A1", "Sheet2", "1학기 성적"), "'1학기 성적'!A1");
  // 다른 시트 참조·함수 이름은 건드리지 않는다
  assert.equal(remapFormulaSheetName("Sheet3!A1+SUM(A1)", "Sheet2", "성적표"), "Sheet3!A1+SUM(A1)");
});

test("ExcelJS orderNo 로 시트 순서를 바꿔 저장하면 재로드 순서도 바뀐다(탭 드래그 저장 경로)", async () => {
  const w = new ExcelJS.Workbook();
  w.addWorksheet("A"); w.addWorksheet("B"); w.addWorksheet("C");
  w.getWorksheet("A").getCell("A1").value = "a";
  // 탭 드래그 결과 [B, C, A] 순서 → orderNo 1,2,3
  w.getWorksheet("B").orderNo = 1;
  w.getWorksheet("C").orderNo = 2;
  w.getWorksheet("A").orderNo = 3;
  const bytes = await w.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  assert.deepEqual(reopened.worksheets.map(ws => ws.name), ["B", "C", "A"]);
  assert.equal(reopened.getWorksheet("A").getCell("A1").value, "a");   // 데이터 유지
});

test("수식 자동완성 컨텍스트: 함수 이름 입력·괄호 안 인자·비수식 구분", () => {
  const { formulaTypingContext } = require("../src/js/spreadsheet-viewer.js");
  // '=' 뒤 함수 이름 입력 중
  assert.deepEqual(formulaTypingContext("=SU", 3), { type:"name", partial:"SU", start:1 });
  assert.deepEqual(formulaTypingContext("=A1+CO", 6), { type:"name", partial:"CO", start:4 });
  assert.deepEqual(formulaTypingContext("=SUM(A1)+AV", 11), { type:"name", partial:"AV", start:9 });
  // 괄호 안 → 인자 힌트(가장 안쪽 함수)
  assert.deepEqual(formulaTypingContext("=SUM(A1", 7), { type:"args", name:"SUM" });
  assert.deepEqual(formulaTypingContext("=SUM(IF(A1>1,", 13), { type:"args", name:"IF" });
  // 닫힌 괄호 뒤·수식 아님·완성할 것 없음 → null
  assert.equal(formulaTypingContext("=SUM(A1)", 8), null);
  assert.equal(formulaTypingContext("hello", 5), null);
  assert.equal(formulaTypingContext("=A1+", 4), null);
  // 셀 참조(SUM 안의 A1)는 함수 이름 후보로 취급하지 않도록 캐럿이 참조 뒤일 때 args 유지
  assert.deepEqual(formulaTypingContext("=RANK(B2,", 9), { type:"args", name:"RANK" });
});

test("자동합계(Σ): 선택 모양에 따라 아래·오른쪽·제자리에 수식을 만든다", () => {
  const { spreadsheetAutoFormulaJobs } = require("../src/js/spreadsheet-viewer.js");
  const n = (v) => ({ v, f: null });
  const t = (v) => ({ v, f: null });
  // A열 숫자 3행 + B열 텍스트
  const model = [
    [n(10), t("가")],
    [n(20), t("나")],
    [n(30), t("다")]
  ];
  // 여러 행 선택 → 숫자 있는 열만 아래 칸에 열 합계
  assert.deepEqual(
    spreadsheetAutoFormulaJobs(model, { s:{ r:0, c:0 }, e:{ r:2, c:1 } }, "SUM"),
    [{ r:3, c:0, f:"SUM(A1:A3)" }]
  );
  // 한 행 여러 열 → 오른쪽 칸에 행 합계
  const rowModel = [[n(1), n(2), n(3)]];
  assert.deepEqual(
    spreadsheetAutoFormulaJobs(rowModel, { s:{ r:0, c:0 }, e:{ r:0, c:2 } }, "AVERAGE"),
    [{ r:0, c:3, f:"AVERAGE(A1:C1)" }]
  );
  // 단일 셀 → 위로 이어진 숫자 범위를 그 셀에
  const below = [[n(1)], [n(2)], [n(3)], [t("")]];
  assert.deepEqual(
    spreadsheetAutoFormulaJobs(below, { s:{ r:3, c:0 }, e:{ r:3, c:0 } }, "SUM"),
    [{ r:3, c:0, f:"SUM(A1:A3)" }]
  );
  // 단일 셀 · 위에 숫자 없으면 왼쪽으로
  const leftward = [[n(5), n(6), t("")]];
  assert.deepEqual(
    spreadsheetAutoFormulaJobs(leftward, { s:{ r:0, c:2 }, e:{ r:0, c:2 } }, "SUM"),
    [{ r:0, c:2, f:"SUM(A1:B1)" }]
  );
  // 숫자가 전혀 없으면 빈 배열
  assert.deepEqual(
    spreadsheetAutoFormulaJobs([[t("가"), t("나")]], { s:{ r:0, c:0 }, e:{ r:0, c:1 } }, "SUM"),
    []
  );
});

test("Ctrl+방향키 데이터 경계 점프: 블록 끝·다음 데이터·시트 끝을 엑셀처럼 찾는다", () => {
  const { spreadsheetJumpToDataEdge, spreadsheetModelCellEmpty } = require("../src/js/spreadsheet-viewer.js");
  // 6행×1열: 데이터 A1:A3, A5 (A4·A6 빈 칸)
  const col = ["v", "v", "v", "", "v", ""];
  const empty = (r, c) => col[r] === "";
  const jump = (row, dr) => spreadsheetJumpToDataEdge(empty, col.length, 1, row, 0, dr, 0).row;
  assert.equal(jump(0, 1), 2);   // 블록 안 → 블록 끝
  assert.equal(jump(2, 1), 4);   // 블록 끝 → 다음 데이터 셀
  assert.equal(jump(4, 1), 5);   // 마지막 데이터 → 더 없으면 시트 끝
  assert.equal(jump(3, 1), 4);   // 빈 셀 → 다음 데이터 셀
  assert.equal(jump(4, -1), 2);  // 위로: 빈 칸 건너 이전 블록 끝
  assert.equal(jump(2, -1), 0);  // 블록 안 위로 → 블록 시작
  assert.equal(jump(0, -1), 0);  // 경계 밖 이동은 제자리
  // 가로 방향도 동일 로직(2열 격자에서 오른쪽 점프)
  const grid = [["v", "", "v"]];
  const emptyG = (r, c) => grid[r][c] === "";
  assert.deepEqual(
    spreadsheetJumpToDataEdge(emptyG, 1, 3, 0, 0, 0, 1),
    { row: 0, col: 2 }
  );
  assert.equal(spreadsheetModelCellEmpty({ v:"", f:"A1" }), false);  // 표시 결과가 비어도 수식 셀은 데이터
  assert.equal(spreadsheetModelCellEmpty({ v:"   ", f:null }), false); // 공백 문자열도 입력된 값
  assert.equal(spreadsheetModelCellEmpty({ v:"", f:null }), true);
});

test("복사 붙여넣기 수식 이동: 상대참조는 델타만큼, $절대참조는 고정된다", () => {
  // 붙여넣기 코드와 동일한 변환: 복사 원점→붙일 위치 이동량(dr, dc)만큼 상대참조를 옮긴다
  const shift = (f, dr, dc) => remapFormulaRefs(
    f,
    (cc, rr, abs) => ({
      c:abs.colAbs ? cc : cc + dc,
      r:abs.rowAbs ? rr : rr + dr
    }),
    { includeSheetRefs:true }
  );
  assert.equal(shift("SUM(A1:A3)", 2, 1), "SUM(B3:B5)");
  assert.equal(shift("$A$1+B2", 3, 3), "$A$1+E5");          // 절대참조 고정
  assert.equal(shift("$A1+A$1", 1, 1), "$A2+B$1");          // 혼합참조는 고정된 축만 유지
  assert.equal(shift("Sheet2!A1+A1", 1, 0), "Sheet2!A2+A2"); // 시트 지정 상대참조도 이동
  assert.equal(shift("A1", -1, 0), "#REF!");                 // 격자 밖으로 나가면 #REF!
});

test("잘라낸 범위를 옮기면 같은 시트와 다른 시트의 참조가 새 위치를 따라간다", () => {
  const { remapMovedFormulaRefs } = require("../src/js/spreadsheet-viewer.js");
  const bounds = { s:{ r:0, c:0 }, e:{ r:1, c:1 } }; // Sheet1!A1:B2
  assert.equal(
    remapMovedFormulaRefs("A1+$B$2+C3", "Sheet1", "Sheet1", "Sheet1", bounds, 2, 1),
    "B3+$C$4+C3"
  );
  assert.equal(
    remapMovedFormulaRefs("A1+C3", "Sheet1", "Sheet1", "Sheet 2", bounds, 0, 2),
    "'Sheet 2'!C1+C3"
  );
  assert.equal(
    remapMovedFormulaRefs("Sheet1!A1+A1", "Summary", "Sheet1", "Sheet 2", bounds, 1, 0),
    "'Sheet 2'!A2+A1"
  );
  assert.equal(
    remapMovedFormulaRefs("'Sheet 1'!$B2", "Summary", "Sheet 1", "Sheet2", bounds, 1, 1),
    "Sheet2!$C3"
  );
});
