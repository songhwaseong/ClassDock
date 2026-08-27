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
test("가계도·방사형·원형·격자형은 같은 관계를 서로 다른 구조로 배치한다", () => {
  const nodes = [
    concept.conceptNormalizeNode({ id:"root", title:"시조" }), concept.conceptNormalizeNode({ id:"a", title:"첫째" }),
    concept.conceptNormalizeNode({ id:"b", title:"둘째" }), concept.conceptNormalizeNode({ id:"grand", title:"손자녀" })
  ];
  const edges = [concept.conceptNormalizeEdge({ from:"root", to:"a", type:"include" }), concept.conceptNormalizeEdge({ from:"root", to:"b", type:"include" }), concept.conceptNormalizeEdge({ from:"a", to:"grand", type:"include" })];
  const byId = list => new Map(list.map(node => [node.id, node])), tree = byId(concept.conceptAutoLayout(nodes, edges, { mode:"tree" }));
  assert.ok(tree.get("root").y < tree.get("a").y && tree.get("a").y < tree.get("grand").y); assert.equal(tree.get("a").y, tree.get("b").y); assert.notEqual(tree.get("a").x, tree.get("b").x);
  const radial = byId(concept.conceptAutoLayout(nodes, edges, { mode:"radial", rootId:"a" })), center = radial.get("a"), distance = node => Math.hypot(node.x - center.x, node.y - center.y);
  assert.equal(distance(center), 0); assert.ok(distance(radial.get("root")) > 250); assert.ok(distance(radial.get("b")) > distance(radial.get("root")));
  const circle = concept.conceptAutoLayout(nodes, edges, { mode:"circle" }), centerX = circle.reduce((sum, node) => sum + node.x + 115, 0) / circle.length, centerY = circle.reduce((sum, node) => sum + node.y + 65, 0) / circle.length, radii = circle.map(node => Math.hypot(node.x + 115 - centerX, node.y + 65 - centerY));
  assert.ok(Math.max(...radii) - Math.min(...radii) < .001);
  const grid = concept.conceptAutoLayout(nodes, edges, { mode:"grid" }); assert.equal(new Set(grid.map(node => `${node.x},${node.y}`)).size, nodes.length);
});
test("자동 정렬 간격과 화면 맞춤 배율은 크기에 맞게 달라진다", () => {
  const nodes = [concept.conceptNormalizeNode({ id:"root", title:"상위" }), concept.conceptNormalizeNode({ id:"child", title:"하위" })], edges = [concept.conceptNormalizeEdge({ from:"root", to:"child", type:"include" })];
  const normal = concept.conceptAutoLayout(nodes, edges, { mode:"tree", spacing:"normal" }), wide = concept.conceptAutoLayout(nodes, edges, { mode:"tree", spacing:"wide" });
  assert.ok(wide[1].y - wide[0].y > normal[1].y - normal[0].y); assert.ok(concept.conceptFitZoom(1800, 1100, 1000, 700) > .5); assert.equal(concept.conceptFitZoom(10000, 10000, 800, 600), .35);
  const model = { ...concept.conceptDocEmpty("배치 저장"), layout:"auto", layoutStyle:"circle", layoutSpacing:"wide", nodes, edges }, parsed = concept.conceptDocParse(concept.conceptDocSerialize(model)); assert.equal(parsed.layoutStyle, "circle"); assert.equal(parsed.layoutSpacing, "wide");
  assert.deepEqual(concept.CONCEPT_LAYOUTS.map(item => item.id), ["tree", "radial", "circle", "flow", "grid"]);
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
  const before = { x:-360, y:-240 }, anchor = { x:180, y:120 }, next = concept.conceptZoomPan(before.x, before.y, anchor.x, anchor.y, 1, 1.5);
  assert.equal((anchor.x - before.x) / 1, (anchor.x - next.x) / 1.5); assert.equal((anchor.y - before.y) / 1, (anchor.y - next.y) / 1.5);
  assert.equal(concept.conceptClampZoom(.1), .35); assert.equal(concept.conceptClampZoom(4), 2);
});
test("핀치로 축소해도 두 손가락 가운데 캔버스 지점은 제자리에 남는다", () => {
  const start = { x:120, y:80 }, center = { x:500, y:300 }, next = concept.conceptZoomPan(start.x, start.y, center.x, center.y, 1, .5);
  assert.equal((center.x - start.x) / 1, (center.x - next.x) / .5); assert.equal((center.y - start.y) / 1, (center.y - next.y) / .5);
});
test("자유 이동은 사방으로 열려 있되 관계도를 화면 밖으로 놓치지는 않는다", () => {
  const canvas = { width:1800, height:1100 }, view = { width:1000, height:700 };
  const free = concept.conceptClampPan(-900, -400, canvas.width, canvas.height, view.width, view.height, 1);
  assert.deepEqual(free, { x:-900, y:-400 });          // 오른쪽·아래로 미는 음수 이동이 그대로 살아 있다
  const right = concept.conceptClampPan(9000, 0, canvas.width, canvas.height, view.width, view.height, 1);
  assert.equal(right.x, view.width - 120);              // 왼쪽 가장자리 120px는 화면 안에 남는다
  const left = concept.conceptClampPan(-9000, 0, canvas.width, canvas.height, view.width, view.height, 1);
  assert.equal(left.x, 120 - canvas.width);             // 오른쪽 가장자리 120px도 마찬가지
  const zoomedOut = concept.conceptClampPan(-9000, 0, canvas.width, canvas.height, view.width, view.height, .5);
  assert.equal(zoomedOut.x, 120 - canvas.width * .5);   // 배율이 줄면 남는 범위도 같이 줄어든다
});
test("전개 발표 확대는 가운데 맞춤 여백이 달라져도 포인터 아래 캔버스 지점을 유지한다", () => {
  const before = { left:20, top:30, offsetLeft:160, offsetTop:90 }, afterOffset = { left:16, top:16 }, anchor = { x:420, y:260 };
  const next = concept.conceptZoomScrollWithOffset(before.left, before.top, anchor.x, anchor.y, .5, 1, before.offsetLeft, before.offsetTop, afterOffset.left, afterOffset.top);
  const beforeX = (before.left + anchor.x - before.offsetLeft) / .5, beforeY = (before.top + anchor.y - before.offsetTop) / .5;
  assert.equal((next.left + anchor.x - afterOffset.left) / 1, beforeX); assert.equal((next.top + anchor.y - afterOffset.top) / 1, beforeY);
});
test("가장자리 자동 이동은 카드가 마우스 아래에서 한 번 더 밀리지 않게 좌표를 보정한다", () => {
  // 화면이 오른쪽으로 22px 옮겨간 것은 pan이 -22px 움직인 것과 같다.
  const origin = 500, pointerDelta = 100, actualScroll = 22, zoom = .5, next = concept.conceptDragCoordinate(origin, pointerDelta, actualScroll, zoom);
  const screenBefore = origin * zoom, screenAfter = next * zoom - actualScroll;
  assert.equal(screenAfter, screenBefore + pointerDelta);
  assert.equal(concept.conceptDragCoordinate(origin, pointerDelta, 0, zoom), 700);
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
  const html = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8"), loaders = fs.readFileSync(path.join(__dirname, "../src/js/file-loaders.js"), "utf8"), manifest = fs.readFileSync(path.join(__dirname, "../scripts.manifest.json"), "utf8"), source = fs.readFileSync(path.join(__dirname, "../src/js/concept-doc.js"), "utf8"), styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.match(html, /accept="[^"]*\.concept/); assert.match(html, /id="sbNewConcept"/); assert.match(html, /src="src\/js\/concept-doc\.js"/); assert.match(loaders, /ext === "concept"[\s\S]{0,120}loadConceptDoc/); assert.match(manifest, /"concept-doc\.js"/);
  assert.match(source, /concept-build-present/); assert.match(source, /event\.key === " " && !event\.shiftKey/); assert.match(source, /openPresentationOrderDialog/);
  assert.match(source, /conceptButton\("전개 발표"/); assert.doesNotMatch(source, /✨ 전개 발표/);
  assert.match(source, /buildViewport\.addEventListener\("wheel"/); assert.match(source, /concept-build-zoom/); assert.match(source, /setBuildZoom\(1\)/);
  assert.match(source, /viewport\.addEventListener\("wheel"/); assert.match(source, /CONCEPT_MAX_COORD/); assert.match(source, /setPan\(panX - dx, panY - dy\)/);
  assert.match(source, /moveY > 0 \? speed/); assert.match(styles, /\.concept-viewport\{[^}]*touch-action:none/); assert.match(styles, /\.concept-viewport\{[^}]*overflow:hidden/);
  // 자유 이동: 스크롤이 아니라 무대 변환으로 옮기고, 손가락 두 개면 핀치 확대로 넘어간다
  assert.match(source, /translate\(\$\{panX\}px, \$\{panY\}px\) scale/); assert.match(source, /startPinch/); assert.match(source, /pointerType === "touch"/);
  assert.doesNotMatch(source, /viewport\.scroll(?:Left|Top|To|By)/); assert.doesNotMatch(styles, /concept-zoom-space/);
  assert.match(styles, /\.concept-edge-label\{fill:var\(--ink\)/); assert.match(styles, /\[data-theme="dark"\] \.concept-edge-label\{fill:#f8fafc;stroke:#0b1120\}/);
  assert.match(source, /openAutoLayoutDialog/); assert.match(source, /정렬 뒤 화면에 맞춤/); assert.match(styles, /concept-layout-choices/);
});
