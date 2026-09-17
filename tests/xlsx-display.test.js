const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { spreadsheetDarkTextColor } = require("../src/js/spreadsheet-viewer.js");

function contrast(a, b){
  const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("다크모드: 줄무늬·원본 채우기·조건부 색조·선택 배경에서 글자 대비를 확보한다", () => {
  for (const bg of ["#eff6ff", "#ffffff", "#244f6a", "#0f172a", "#111827", "#1e293b", "#252e49", "#0b1220", "#ffff00", "#ff0000"]){
    for (const fg of ["", "#e2e8f0", "#000000", "#ffffff", "#0000ff", "#64748b"]){
      const actual = spreadsheetDarkTextColor(fg, bg);
      assert.ok(contrast(actual, bg) >= 4.5, `${fg} on ${bg}: ${actual}`);
    }
  }
  assert.equal(spreadsheetDarkTextColor("rgb(0, 0, 255)", "rgb(239, 246, 255)"), "#0000ff");
  assert.equal(spreadsheetDarkTextColor("#ffffff", "#244f6a"), "#ffffff");
  assert.ok(contrast(spreadsheetDarkTextColor("#0000ff", "var(--xlsx-frozen-bg,#fff)"), "#1e293b") >= 4.5);
});

const source = fs.readFileSync(require.resolve("../src/js/spreadsheet-viewer.js"), "utf8");
function element(tag){
  return { tag, dataset:{}, style:{}, className:"", children:[],
    classList:{ add(){} }, appendChild(child){ this.children.push(child); } };
}
function tableRenderer(){
  const context = vm.createContext({
    document:{ createElement:element }, editState:{ headerFrozen:true },
    matchingModelRows:model => model.map((_, i) => i),
    mergeRenderInfo:() => ({ covered:new Set(["0,1"]), spanAt:new Map([["0,0", { rs:1, cs:2 }]]) }),
    prepCondRules:() => [{ rule:{} }], dispCell:s => String(s.v),
    applyCellStyleToTd:(td, s) => { td.style.color = s.style.font.color; td.style.backgroundColor = s.style.fill; },
    applyCondOverlayToTd:td => { td.style.backgroundColor = "#ffff00"; }
  });
  const start = source.indexOf("  const tableFromModel =");
  const end = source.indexOf("  const modelNavigationCellEmpty", start);
  return vm.runInContext(source.slice(start, end) + "\ntableFromModel", context);
}

test("편집 후 읽기 전용은 최신 값·병합을 유지하고 셀/조건부 서식을 화면에 적용하지 않는다", () => {
  const render = tableRenderer();
  const cell = v => ({ v, style:{ font:{ color:"#0000ff" }, fill:"#eff6ff" } });
  const model = [[cell("제목"), cell("")], [cell("체험 재료"), cell(174000)]];
  const before = structuredClone(model);
  const plain = render(model, false, { plain:true }).children[0].children;
  assert.equal(plain[0].className, "");
  assert.equal(plain[0].children.length, 1);
  assert.equal(plain[0].children[0].colSpan, 2);
  assert.equal(plain[1].children[1].textContent, "174000");
  for (const row of plain) for (const td of row.children) assert.deepEqual(td.style, {});
  model[1][1].v = 175000;
  assert.equal(render(model, false, { plain:true }).children[0].children[1].children[1].textContent, "175000");
  model[1][1].v = 174000;
  for (const editable of [true, false]){ // 편집 및 인쇄는 원본 글자색/조건부 서식 유지
    const styled = render(model, editable).children[0].children;
    assert.equal(styled[1].children[1].style.color, "#0000ff");
    assert.equal(styled[1].children[1].style.backgroundColor, "#ffff00");
  }
  assert.deepEqual(model, before);
});
