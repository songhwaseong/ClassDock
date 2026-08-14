"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { latexToMathML } = require("../src/js/core.js");
const {
  whiteboardEducationCatalog,
  whiteboardFormulaDictionary,
  expandWhiteboardFormulaTemplate,
  whiteboardFormulaNeedsInput,
  normalizeWhiteboardFormulaLibrary,
  whiteboardClipboardItem,
  whiteboardStencilSvg,
  whiteboardStencilGroup,
  whiteboardVectorGroupSvg,
  whiteboardFormulaSvg,
  whiteboardSvgDataUrl
} = require("../src/js/whiteboard.js");

test("선택한 수식은 이미지 캡처가 아닌 편집 가능한 화이트보드 항목으로 복사된다", () => {
  const formula = {
    type:"image", role:"education-formula", formulaSource:String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
    formulaColor:"#e11d48", formulaBaseW:420, formulaBaseH:90,
    src:"data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E", x:100, y:120, w:315, h:68,
    img:{ complete:true }
  };
  const copy = whiteboardClipboardItem(formula);
  assert.notEqual(copy, formula);
  assert.equal(copy.formulaSource, formula.formulaSource);
  assert.equal(copy.formulaColor, formula.formulaColor);
  assert.equal(copy.w, formula.w);
  assert.equal(copy.img, undefined);
  assert.deepEqual(whiteboardClipboardItem(JSON.stringify(copy)), copy);
  assert.equal(whiteboardClipboardItem({ type:"image", src:"https://example.com/image.png" }), null);
});

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
  assert.ok(formulas.length >= 100);
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
  assert.ok(formulas.length >= 100, "수식 사전 확장 항목이 너무 적다");
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

test("행렬·로그·벡터·원뿔곡선·화학·물리 확장 수식을 빠짐없이 제공한다", () => {
  const formulas = whiteboardFormulaDictionary();
  const expected = [
    "matrix-2x2","determinant-2x2","inverse-matrix-2x2","simultaneous-equations","piecewise-function",
    "log-product-law","log-quotient-law","log-power-law",
    "vector-components","vector-dot-product","vector-cross-product","parabola-standard","ellipse-standard","hyperbola-standard","general-conic",
    "chemical-formula","ion-charge","balanced-reaction","uniform-motion","velocity-acceleration","displacement-acceleration",
    "mechanical-work","coulomb-law","series-resistance","parallel-resistance"
  ];
  for (const id of expected){
    const entry = formulas.find((item) => item.id === "formula-" + id);
    assert.ok(entry, id + " 수식이 없다");
    assert.ok(entry.label && entry.template && entry.source && entry.keywords && entry.description, id + " 검색 정보가 부족하다");
    assert.doesNotMatch(latexToMathML(entry.source), /<mi>begin<\/mi>|<mtext>(?:pmatrix|vmatrix|cases)<\/mtext>/);
  }
  for (const id of ["matrix-2x2","determinant-2x2","inverse-matrix-2x2","simultaneous-equations","piecewise-function","vector-components"]){
    const entry = formulas.find((item) => item.id === "formula-" + id);
    assert.match(latexToMathML(entry.source), /<mtable/);
  }
});

test("한글 입력 자리만 미완성으로 보고 영문·기호 수식은 수정 없이 넣을 수 있다", () => {
  const latin = expandWhiteboardFormulaTemplate(String.raw`[[a]]^2 + [[b]]^2 = [[c]]^2`);
  assert.equal(whiteboardFormulaNeedsInput(latin.text, latin.fields), false);

  const korean = expandWhiteboardFormulaTemplate(String.raw`\frac{[[분자]]}{[[분모]]}`);
  assert.equal(whiteboardFormulaNeedsInput(korean.text, korean.fields), true);
  assert.equal(whiteboardFormulaNeedsInput(String.raw`\frac{a}{분모}`, korean.fields), true);
  assert.equal(whiteboardFormulaNeedsInput(String.raw`\frac{a}{b}`, []), false);
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
  assert.match(source, /WB_ITEM_TRANSFER_TYPE/);
  assert.match(source, /setData\(WB_ITEM_TRANSFER_TYPE, JSON\.stringify\(item\)\)/);
  assert.match(source, /getData\(WB_ITEM_TRANSFER_TYPE\)/);
  assert.match(source, /document\.addEventListener\("copy", onCopy\)/);
  assert.match(source, /document\.removeEventListener\("copy", onCopy\)/);
  assert.match(source, /insertEducationEntry\(entry, center\.x, center\.y\)/);
  assert.match(source, /setData\(WB_EDU_TRANSFER_TYPE, entry\.id\)/);
  assert.match(source, /getData\(WB_EDU_TRANSFER_TYPE\)/);
  assert.match(source, /role:"education-stencil"/);
  assert.match(source, /role:"education-formula"/);
  assert.match(source, /whiteboardStencilSvg\(entry\.id, "currentColor"\)/);
  assert.match(source, /flipXBtn = mkBtn\("↔", "선택한 이미지 또는 교육 도형 좌우 반전"/);
  assert.match(source, /flipYBtn = mkBtn\("↕", "선택한 이미지 또는 교육 도형 상하 반전"/);
  assert.match(source, /if \(!whiteboardCanFlipItem\(selected\)\) return/);
  assert.match(source, /groupActionBtn = mkBtn\("분리"/);
  assert.match(source, /ClassDockCore\.latexToMathML/);
  assert.match(source, /latexToMathML\(String\(source \|\| ""\), false, true\)/);
  assert.match(source, /LaTeX 수식 또는 '일반 문자열'/);
  assert.match(source, /const width = Math\.min\(16000,/);
  assert.match(source, /const height = Math\.min\(16000,/);
  assert.doesNotMatch(source, /const width = Math\.min\(900,/);
  assert.match(source, /FORMULA_SIZE_PRESETS = \{ 2:\.75, 4:1, 8:1\.5 \}/);
  assert.match(source, /resizeSelectedFormula\(FORMULA_SIZE_PRESETS\[w\] \|\| 1\)/);
  assert.match(source, /selected\.role === "education-formula"[\s\S]*?insertFormulaSource\(selected\.formulaSource/);
  assert.match(source, /colorOverride=""/);
  assert.match(source, /WB_FORMULA_LIBRARY_KEY/);
  assert.match(source, /insertFormulaTemplate\(entry\)/);
  assert.match(source, /if \(insertFormulaSource\(source, center\.x, center\.y, target\)\)\{ resetFormulaEditor\(\); \}/);
  assert.doesNotMatch(source, /insertFormulaSource\(source, center\.x, center\.y, target\)[^\n]*toggleEducationPanel\(false\)/);
  assert.match(source, /e\.key === "Tab" && formulaStops\.length/);
  assert.match(source, /toggleFormulaFavorite/);
  assert.match(source, /saveCustomFormula/);
  assert.doesNotMatch(source, /createElement\("span"\); description\.className = "wb-edu-description"/);
  assert.match(source, /STENCIL_GROUPS/);
  assert.match(source, /stencilGroup\[eduCategory\]/);
  assert.match(css, /\.wb-edu-panel/);
  assert.match(css, /\.wb-edu-stencil/);
  assert.match(css, /\.wb-formula-builder/);
  assert.match(css, /\.wb-formula-groups/);
  assert.match(css, /\.wb-formula-favorite/);
  assert.match(css, /\.wb-edu-subgroups/);
  assert.match(css, /\.wb-edu-search\{[^}]*flex:0 0 34px[^}]*min-height:34px/);
  assert.doesNotMatch(css, /\.wb-edu-description\{/);
  assert.match(css, /\.wb-formula-groups\{[^}]*flex:0 0 auto[^}]*overflow-y:hidden/);
  assert.match(css, /\.wb-edu-subgroups\{[^}]*min-height:43px/);
  assert.match(palette, /수학·과학 도구상자[\s\S]*?\.wb-edu-toggle/);
  assert.match(palette, /교육 도형 그룹 풀기[\s\S]*?\.wb-ungroup:not\(:disabled\)/);
});

test("도구상자는 메모창과 같은 공용 헬퍼로 옮기고 크기를 조절한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/js/whiteboard.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  const memo = fs.readFileSync(path.join(__dirname, "../src/js/scratchpad.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  // 공용 헬퍼는 app.js 한 곳에만 있고, 메모창도 같은 것을 쓴다
  assert.match(app, /function makeFloatingPanel\(panel, head, opts\)/);
  assert.match(memo, /return makeFloatingPanel\(panel, head, \{/);
  assert.doesNotMatch(memo, /attachEdgeResize/);
  // 화이트보드 도구상자 배선: 저장 키·작업 영역 안으로 제한·전체화면 대응·창을 닫을 때 정리
  assert.match(source, /makeFloatingPanel\(eduPanel, eduHead, \{/);
  assert.match(source, /storageKey: "classdock-whiteboard:edu-rect:v1"/);
  assert.match(source, /bounds: \(\) => \{[\s\S]*?byId\("content"\)/);
  assert.match(source, /host: \(\) => document\.fullscreenElement \|\| document\.body/);
  assert.match(source, /if \(eduFloat\) eduFloat\.clampOnOpen\(\);/);
  assert.match(source, /if \(eduFloat\) eduFloat\.destroy\(\);/);
  // 떠 있는 상태에서는 무대 기준 max-height 를 놓아 주어야 세로로 늘릴 수 있다
  assert.match(css, /\.wb-edu-panel\.is-floating\{[^}]*max-height:none/);
  assert.match(css, /\.wb-edu-head\{[^}]*cursor:move/);
});
