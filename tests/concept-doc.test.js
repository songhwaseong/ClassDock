"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const concept = require("../src/js/concept-doc.js");

test(".concept는 개념 카드와 유효한 관계만 안전하게 왕복한다", () => {
  const model = concept.conceptDocEmpty("생태계");
  model.nodes = [concept.conceptNormalizeNode({ id:"a", title:"생산자", category:"생물", x:10, y:20 }), concept.conceptNormalizeNode({ id:"b", title:"소비자", description:"다른 생물을 먹는다", x:350, y:20 })];
  model.edges = [concept.conceptNormalizeEdge({ id:"e", from:"a", to:"b", type:"support", label:"에너지 전달" }), concept.conceptNormalizeEdge({ id:"bad", from:"a", to:"missing" })];
  const parsed = concept.conceptDocParse(concept.conceptDocSerialize(model));
  assert.equal(parsed.title, "생태계"); assert.equal(parsed.nodes.length, 2); assert.deepEqual(parsed.edges.map(edge => edge.id), ["e"]); assert.match(concept.conceptSearchText(parsed), /생산자[\s\S]*에너지 전달/);
});
test("자동 정렬은 원인·포함 관계의 방향대로 다음 열에 놓는다", () => {
  const nodes = ["원인", "과정", "결과"].map((title, index) => concept.conceptNormalizeNode({ id:String(index), title }, index));
  const edges = [concept.conceptNormalizeEdge({ from:"0", to:"1", type:"cause" }), concept.conceptNormalizeEdge({ from:"1", to:"2", type:"cause" })];
  const laid = concept.conceptAutoLayout(nodes, edges); assert.ok(laid[0].x < laid[1].x && laid[1].x < laid[2].x);
});
test("발표 순서는 관계 방향의 세대·과정별로 만들고 같은 단계는 화면 위쪽부터 둔다", () => {
  const nodes = [
    concept.conceptNormalizeNode({ id:"root", title:"시조", x:70, y:300 }),
    concept.conceptNormalizeNode({ id:"child-b", title:"둘째", x:400, y:300 }),
    concept.conceptNormalizeNode({ id:"child-a", title:"첫째", x:400, y:80 }),
    concept.conceptNormalizeNode({ id:"grand", title:"손자녀", x:730, y:80 })
  ];
  const edges = [concept.conceptNormalizeEdge({ from:"root", to:"child-a", type:"include" }), concept.conceptNormalizeEdge({ from:"root", to:"child-b", type:"include" }), concept.conceptNormalizeEdge({ from:"child-a", to:"grand", type:"include" })];
  assert.deepEqual(concept.conceptAutoPresentationOrder(nodes, edges), ["root", "child-a", "child-b", "grand"]);
});
test("발표 설정은 중복·사라진 카드를 걷고 새 카드를 뒤에 붙이며 애니메이션을 검증한다", () => {
  const nodes = [concept.conceptNormalizeNode({ id:"a", title:"A" }), concept.conceptNormalizeNode({ id:"b", title:"B" }), concept.conceptNormalizeNode({ id:"c", title:"C" })];
  assert.deepEqual(concept.conceptNormalizePresentation({ order:["b", "missing", "b", "a"], animation:"zoom", autoFocus:false }, nodes), { order:["b", "a", "c"], animation:"zoom", autoFocus:false });
  assert.equal(concept.conceptNormalizePresentation({ animation:"spin" }, nodes).animation, "fade");
  assert.deepEqual(concept.CONCEPT_PRESENT_ANIMATIONS.map(item => item.id), ["fade", "zoom", "slide", "draw", "none"]);
});
test("카드는 기존 화면 높이 아래 좌표도 보존하고 캔버스가 그 위치까지 확장된다", () => {
  const far = concept.conceptNormalizeNode({ id:"far", title:"아래 카드", x:4200, y:12500 });
  const parsed = concept.conceptDocParse(concept.conceptDocSerialize({ ...concept.conceptDocEmpty("긴 관계도"), nodes:[far] }));
  assert.equal(parsed.nodes[0].x, 4200); assert.equal(parsed.nodes[0].y, 12500); assert.deepEqual(concept.conceptCanvasSize(parsed.nodes), { width:4490, height:12710 });
});
test("커서 중심 확대는 확대 전후 같은 캔버스 지점을 가리킨다", () => {
  const before = { left:360, top:240 }, anchor = { x:180, y:120 }, next = concept.conceptZoomScroll(before.left, before.top, anchor.x, anchor.y, 1, 1.5);
  assert.equal((before.left + anchor.x) / 1, (next.left + anchor.x) / 1.5); assert.equal((before.top + anchor.y) / 1, (next.top + anchor.y) / 1.5);
  assert.equal(concept.conceptClampZoom(.1), .35); assert.equal(concept.conceptClampZoom(4), 2);
});
test("큰 카드 보기는 선택한 카드의 들어오는·나가는 관계를 읽기 좋게 만든다", () => {
  const model = concept.conceptDocEmpty("가족 관계");
  model.nodes = [concept.conceptNormalizeNode({ id:"parent", title:"부모" }), concept.conceptNormalizeNode({ id:"child", title:"자녀" }), concept.conceptNormalizeNode({ id:"school", title:"학교" })];
  model.edges = [concept.conceptNormalizeEdge({ id:"family", from:"parent", to:"child", type:"include", label:"부모 → 자녀" }), concept.conceptNormalizeEdge({ id:"attend", from:"child", to:"school", type:"related" })];
  assert.deepEqual(concept.conceptNodeConnections(model, "child"), [
    { edgeId:"family", otherId:"parent", otherTitle:"부모", direction:"in", label:"부모 → 자녀" },
    { edgeId:"attend", otherId:"school", otherTitle:"학교", direction:"out", label:"관련" }
  ]);
});
test("개념 관계도 형식은 파일 열기·메뉴·manifest에 연결된다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8"), loaders = fs.readFileSync(path.join(__dirname, "../src/js/file-loaders.js"), "utf8"), manifest = fs.readFileSync(path.join(__dirname, "../scripts.manifest.json"), "utf8"), source = fs.readFileSync(path.join(__dirname, "../src/js/concept-doc.js"), "utf8");
  assert.match(html, /accept="[^"]*\.concept/); assert.match(html, /id="sbNewConcept"/); assert.match(html, /src="src\/js\/concept-doc\.js"/); assert.match(loaders, /ext === "concept"[\s\S]{0,120}loadConceptDoc/); assert.match(manifest, /"concept-doc\.js"/);
  assert.match(source, /concept-build-present/); assert.match(source, /event\.key === " " && !event\.shiftKey/); assert.match(source, /openPresentationOrderDialog/);
  assert.match(source, /viewport\.addEventListener\("wheel"/); assert.match(source, /CONCEPT_MAX_COORD/); assert.match(source, /viewport\.scrollBy/);
});
