"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  whiteboardEducationCatalog,
  whiteboardFormulaDictionary,
  expandWhiteboardFormulaTemplate,
  normalizeWhiteboardFormulaLibrary,
  whiteboardStencilSvg,
  whiteboardStencilGroup,
  whiteboardVectorGroupSvg,
  whiteboardFormulaSvg,
  whiteboardSvgDataUrl
} = require("../src/js/whiteboard.js");

test("수학·과학 도구상자는 기호·수식·도형·과학 묶음을 빠짐없이 제공한다", () => {
  const entries = whiteboardEducationCatalog();
  assert.ok(entries.length >= 230, "확장된 도구 목록이 너무 적다");
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length, "도구 id가 중복된다");
  for (const category of ["symbol", "formula", "geometry", "science"]){
    assert.ok(entries.some((entry) => entry.category === category), category + " 묶음이 비어 있다");
  }
  for (const value of ["±", "√", "∑", "∫", "π", "∴", "∅", "ℝ", "℃", "Ω", "Pa", "V"]){
    assert.ok(entries.some((entry) => entry.value === value), value + " 기호가 없다");
  }
});

test("수식 틀은 LaTeX 원문을 보존하는 편집 가능한 formula 항목으로 정의한다", () => {
  const formulas = whiteboardEducationCatalog().filter((entry) => entry.category === "formula");
  assert.ok(formulas.length >= 75);
  for (const entry of formulas){
    assert.equal(entry.kind, "formula", entry.label + " 수식이 formula가 아니다");
    assert.ok(entry.source && typeof entry.source === "string");
    assert.ok(entry.preview && typeof entry.preview === "string");
  }
  assert.ok(formulas.some((entry) => entry.source.includes("\\sqrt")));
  assert.ok(formulas.some((entry) => entry.source.includes("\\lim")));
});

test("수식 사전은 교과별 50개 이상의 검색 가능한 틀과 정확한 입력 위치를 제공한다", () => {
  const formulas = whiteboardFormulaDictionary();
  assert.ok(formulas.length >= 75, "수식 사전 확장 항목이 너무 적다");
  assert.equal(new Set(formulas.map((entry) => entry.id)).size, formulas.length);
  for (const group of ["basic", "algebra", "calculus", "set", "statistics", "geometry-formula", "science-formula"]){
    assert.ok(formulas.some((entry) => entry.formulaGroup === group), group + " 분야가 비어 있다");
  }
  for (const entry of formulas){
    assert.ok(entry.label && entry.source && entry.template && entry.keywords && entry.description, entry.id + "의 검색 정보가 부족하다");
    const expanded = expandWhiteboardFormulaTemplate(entry.template);
    assert.doesNotMatch(expanded.text, /\[\[[^\]]+\]\]/, entry.id + "에 입력 표시가 남았다");
    for (const field of expanded.fields) assert.equal(expanded.text.slice(field.start, field.end), field.label, entry.id + " 입력 위치가 어긋났다");
  }
  assert.equal(expandWhiteboardFormulaTemplate(String.raw`\frac{[[분자]]}{[[분모]]}`).text, String.raw`\frac{분자}{분모}`);
  assert.equal(expandWhiteboardFormulaTemplate(formulas.find((entry) => entry.id === "formula-nth-root").template).text, String.raw`\sqrt[ 차수 ]{값}`);
});

test("내 수식·즐겨찾기·최근 사용 저장값은 유효한 항목만 정규화한다", () => {
  const builtIn = whiteboardFormulaDictionary()[0].id;
  const saved = normalizeWhiteboardFormulaLibrary({
    custom:[
      {id:"custom-abcd",label:"나의 분수",source:String.raw`\frac{x}{y}`},
      {id:"bad",label:"제외",source:"x"},
      {id:"custom-abcd",label:"중복",source:"y"}
    ],
    favorites:[builtIn,"custom-abcd","missing",builtIn],
    recent:["missing","custom-abcd",builtIn,"custom-abcd"]
  });
  assert.equal(saved.custom.length, 1);
  assert.deepEqual(saved.favorites, [builtIn,"custom-abcd"]);
  assert.deepEqual(saved.recent, ["custom-abcd",builtIn]);
});

test("교육 도형 SVG는 외부 자원이나 실행 코드를 포함하지 않는다", () => {
  const stencils = whiteboardEducationCatalog().filter((entry) => entry.kind === "stencil");
  assert.ok(stencils.length >= 100);
  for (const entry of stencils){
    const svg = whiteboardStencilSvg(entry.id, "#2563eb");
    assert.match(svg, /^<svg[^>]+width="240"[^>]+height="190"[^>]+viewBox="0 0 240 190"/);
    assert.ok(svg.includes("#2563eb"), entry.label + " 색이 반영되지 않았다");
    assert.doesNotMatch(svg, /<script|foreignObject|javascript:|(?:href|src)=["']https?:/i);
    const url = whiteboardSvgDataUrl(svg);
    assert.ok(url.startsWith("data:image/svg+xml;charset=utf-8,"));
    assert.equal(decodeURIComponent(url.split(",")[1]), svg);
    const group = whiteboardStencilGroup(entry.id, "#2563eb");
    assert.equal(group.type, "group");
    assert.equal(group.role, "education-stencil");
    assert.ok(group.items.length >= 2, entry.label + " 벡터 구성 요소가 부족하다");
    assert.ok(group.items.every((item) => item.color === "#2563eb"));
  }
});

test("교육 도형 미리보기는 테마 글자색을 따르되 임의 CSS 값은 받지 않는다", () => {
  const direct = whiteboardStencilSvg("stencil-angle", "currentColor");
  const generated = whiteboardStencilSvg("stencil-cube", "currentColor");
  assert.ok(direct.includes('stroke="currentColor"'));
  assert.ok(generated.includes('stroke="currentColor"'));
  assert.doesNotMatch(whiteboardStencilSvg("stencil-angle", "currentColor;filter:url(x)"), /filter:url|stroke="currentColor;/);
});

test("도형·과학 확장팩은 교과 분야별 벡터 스텐실을 빠짐없이 제공한다", () => {
  const stencils = whiteboardEducationCatalog().filter((entry) => entry.kind === "stencil");
  const geometry = stencils.filter((entry) => entry.category === "geometry");
  const science = stencils.filter((entry) => entry.category === "science");
  assert.ok(geometry.length >= 45);
  assert.ok(science.length >= 60);
  for (const group of ["plane","solid","construction","graph","data"]){
    assert.ok(geometry.some((entry) => entry.stencilGroup === group), group + " 도형 분야가 비어 있다");
  }
  for (const group of ["mechanics","waves","electricity","optics","chemistry","biology","earth"]){
    assert.ok(science.some((entry) => entry.stencilGroup === group), group + " 과학 분야가 비어 있다");
  }
  for (const id of ["stencil-cube","stencil-angle-bisector","stencil-parabola","stencil-bar-chart","stencil-cube-net","stencil-pulley","stencil-transverse-wave","stencil-magnetic-field","stencil-refraction","stencil-parallel-circuit","stencil-convex-lens","stencil-burette","stencil-particle-states","stencil-plant-cell","stencil-punnett-square","stencil-earth-layers","stencil-rock-cycle"]){
    const entry = stencils.find((item) => item.id === id);
    assert.ok(entry, id + " 항목이 없다");
    const group = whiteboardStencilGroup(id, "#16a34a");
    assert.ok(group && group.items.length >= 2, id + " 벡터 모델이 없다");
    assert.match(whiteboardVectorGroupSvg(group, "#16a34a"), /^<svg[^>]+width="240"[^>]+height="190"/);
  }
});

test("수식 SVG는 MathML과 선택 색을 담고 편집 원문은 별도 모델에 보존할 수 있다", () => {
  const math = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';
  const svg = whiteboardFormulaSvg(math, "#e11d48", 260, 90);
  assert.match(svg, /^<svg[^>]+width="260"[^>]+height="90"/);
  assert.ok(svg.includes("<foreignObject"));
  assert.ok(svg.includes("<mfrac>"));
  assert.ok(svg.includes("#e11d48"));
  assert.doesNotMatch(svg, /<script|javascript:|(?:href|src)=["']https?:/i);
});

test("도구상자 UI는 클릭 삽입과 보드 드래그앤드롭을 함께 배선한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/whiteboard.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const palette = fs.readFileSync(path.join(__dirname, "../src/js/command-palette.js"), "utf8");
  assert.match(source, /WB_EDU_TRANSFER_TYPE/);
  assert.match(source, /insertEducationEntry\(entry, center\.x, center\.y\)/);
  assert.match(source, /setData\(WB_EDU_TRANSFER_TYPE, entry\.id\)/);
  assert.match(source, /getData\(WB_EDU_TRANSFER_TYPE\)/);
  assert.match(source, /role:"education-stencil"/);
  assert.match(source, /role:"education-formula"/);
  assert.match(source, /whiteboardStencilSvg\(entry\.id, "currentColor"\)/);
  assert.match(source, /flipXBtn = mkBtn\("↔", "선택한 교육 도형 좌우 반전"/);
  assert.match(source, /flipYBtn = mkBtn\("↕", "선택한 교육 도형 상하 반전"/);
  assert.match(source, /selected\.role !== "education-stencil"/);
  assert.match(source, /groupActionBtn = mkBtn\("분리"/);
  assert.match(source, /PdfSignerCore\.latexToMathML/);
  assert.match(source, /WB_FORMULA_LIBRARY_KEY/);
  assert.match(source, /insertFormulaTemplate\(entry\)/);
  assert.match(source, /e\.key === "Tab" && formulaStops\.length/);
  assert.match(source, /toggleFormulaFavorite/);
  assert.match(source, /saveCustomFormula/);
  assert.match(source, /STENCIL_GROUPS/);
  assert.match(source, /stencilGroup\[eduCategory\]/);
  assert.match(css, /\.wb-edu-panel/);
  assert.match(css, /\.wb-edu-stencil/);
  assert.match(css, /\.wb-formula-builder/);
  assert.match(css, /\.wb-formula-groups/);
  assert.match(css, /\.wb-formula-favorite/);
  assert.match(css, /\.wb-edu-subgroups/);
  assert.match(css, /\.wb-formula-groups\{[^}]*flex:0 0 auto[^}]*overflow-y:hidden/);
  assert.match(css, /\.wb-edu-subgroups\{[^}]*min-height:43px/);
  assert.match(palette, /수학·과학 도구상자[\s\S]*?\.wb-edu-toggle/);
  assert.match(palette, /교육 도형 그룹 풀기[\s\S]*?\.wb-ungroup:not\(:disabled\)/);
});
