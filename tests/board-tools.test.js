"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MNBoardTools = require("../src/js/board-tools.js");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const whiteboardSource = fs.readFileSync(path.join(root, "src/js/whiteboard.js"), "utf8");
// board-render.js 는 브라우저 전역 스크립트라 module.exports 가 없다 — 같은 방식으로 읽어 쓴다.
const rendererContext = {};
vm.runInNewContext(fs.readFileSync(path.join(root, "src/js/board-render.js"), "utf8") + ";this.renderer = MNBoardRenderer;", rendererContext);
const MNBoardRenderer = rendererContext.renderer;

const strokeFromPoints = (points, extra) => Object.assign({ type:"pen", color:"#111111", width:3, points }, extra || {});
const traceShape = (vertices, jitter = 2) => {
  const points = [];
  for (let s = 0; s < vertices.length - 1; s++){
    const [x1, y1] = vertices[s], [x2, y2] = vertices[s + 1];
    for (let i = 0; i <= 20; i++){
      const t = i / 20;
      points.push({ x:x1 + (x2 - x1) * t + (i % 3 - 1) * jitter, y:y1 + (y2 - y1) * t + (i % 2 - .5) * jitter });
    }
  }
  return points;
};

test("수식은 eval 없이 계산하고, 곱셈 기호·괄호를 생략한 학교식 표기도 읽는다", () => {
  assert.equal(MNBoardTools.parseExpression("y = 2x^2 - 3x + 1").evaluate({ x:2 }), 3);
  assert.equal(MNBoardTools.parseExpression("f(x) = 3(x+1)").evaluate({ x:1 }), 6);
  assert.equal(MNBoardTools.parseExpression("sin x").evaluate({ x:Math.PI / 2 }), 1);
  assert.equal(MNBoardTools.parseExpression("log(100)").evaluate({}), 2);          // 학교에서 log 는 상용로그
  assert.equal(MNBoardTools.parseExpression("ln(e)").evaluate({}), 1);
  assert.ok(Math.abs(MNBoardTools.parseExpression("πx").evaluate({ x:2 }) - Math.PI * 2) < 1e-12);
  assert.ok(Math.abs(MNBoardTools.parseExpression("sin(πx)").evaluate({ x:.5 }) - 1) < 1e-12);
  assert.equal(MNBoardTools.parseExpression("√x").evaluate({ x:9 }), 3);
  assert.equal(MNBoardTools.parseExpression("2^3^2").evaluate({}), 512);           // 거듭제곱은 오른쪽부터
  assert.deepEqual(MNBoardTools.parseExpression("a x + b").variables, ["a", "x", "b"]);
  // 잘못 친 식은 그대로 보여 줄 수 있는 한국어 메시지로 알린다.
  assert.throws(() => MNBoardTools.parseExpression("2*+"), (error) => error.boardTool === true && /수식/.test(error.message));
  assert.throws(() => MNBoardTools.parseExpression("sin(x"), (error) => /괄호/.test(error.message));
});

test("그래프는 실제로 계산한 곡선을 그림 영역 안으로 잘라 넣는다", () => {
  const group = MNBoardTools.plotGroup({ curves:[{ source:"x^2 - 3" }, { source:"sin(x)" }], xMin:-6, xMax:6, width:520, height:360 });
  assert.equal(group.type, "group");
  assert.equal(group.role, "education-plot");
  assert.equal(group.w, group.sourceW);
  const curves = group.items.filter((item) => item.type === "polyline");
  assert.ok(curves.length >= 2);
  for (const curve of curves){
    for (const point of curve.points){
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(point.x >= -0.01 && point.x <= 520.01 && point.y >= -0.01 && point.y <= 360.01, "곡선이 그림 영역을 벗어나면 안 된다");
    }
  }
  // 다시 편집할 수 있도록 입력값을 그대로 들고 있는다.
  assert.equal(group.plotSpec.curves[0].source, "x^2 - 3");
  assert.equal(group.plotSpec.xMin, -6);
});

test("점근선이 있는 함수는 획을 나눠 그려 화면을 가로지르지 않는다", () => {
  const tangent = MNBoardTools.plotGroup({ curves:[{ source:"tan(x)" }], xMin:-6, xMax:6, width:520, height:360 });
  const branches = tangent.items.filter((item) => item.type === "polyline");
  assert.ok(branches.length >= 4, `tan 은 구간마다 끊겨야 한다(${branches.length})`);
  const reciprocal = MNBoardTools.plotGroup({ curves:[{ source:"1/x" }], xMin:-5, xMax:5, width:520, height:360 });
  assert.ok(reciprocal.items.filter((item) => item.type === "polyline").length >= 2);
  // 정의역 밖만 있는 식은 범위를 바꾸라고 알린다.
  assert.throws(() => MNBoardTools.plotGroup({ curves:[{ source:"sqrt(-1 - x^2)" }], xMin:-3, xMax:3 }), (error) => error.boardTool === true);
});

test("매개변수가 있는 식은 값을 넣어 계산하고 자동 y 범위는 점근선에 휘둘리지 않는다", () => {
  const flat = MNBoardTools.plotGroup({ curves:[{ source:"a x" }], params:{ a:1 }, xMin:-5, xMax:5, width:400, height:300 });
  const steep = MNBoardTools.plotGroup({ curves:[{ source:"a x" }], params:{ a:5 }, xMin:-5, xMax:5, width:400, height:300 });
  assert.notDeepEqual(flat.items.find((item) => item.type === "polyline").points, steep.items.find((item) => item.type === "polyline").points);
  const hyperbola = MNBoardTools.plotGroup({ curves:[{ source:"1/x" }], xMin:-5, xMax:5, width:400, height:300 });
  assert.ok(hyperbola.items.some((item) => item.type === "polyline" && item.points.length > 20));
});

test("자료 차트는 쉼표·탭·띄어쓰기로 적은 표를 읽어 종류별 벡터로 만든다", () => {
  assert.deepEqual(MNBoardTools.parseChartData("국어, 7\n수학\t12\n영어 5"), [
    { label:"국어", value:7 }, { label:"수학", value:12 }, { label:"영어", value:5 }
  ]);
  assert.deepEqual(MNBoardTools.parseChartData("3\n5\n8").map((row) => row.label), ["1", "2", "3"]);
  for (const type of ["bar", "line", "pie", "histogram", "scatter"]){
    const group = MNBoardTools.chartGroup({ type, data:"1, 3\n2, 5\n3, 8\n4, 2", title:"자료" });
    assert.equal(group.role, "education-chart");
    assert.equal(group.chartSpec.type, type);
    assert.ok(group.items.length > 4, `${type} 차트 항목`);
    assert.ok(group.items.some((item) => item.type === "text" && item.text === "자료"));
  }
  // 원그래프는 부채꼴을 닫힌 다각형으로 채운다(렌더러에 호 항목이 없다).
  const pie = MNBoardTools.chartGroup({ type:"pie", data:"가, 1\n나, 3" });
  assert.ok(pie.items.some((item) => item.type === "polyline" && item.closed && item.fill));
  assert.throws(() => MNBoardTools.chartGroup({ type:"bar", data:"이름만\n또 이름만" }), (error) => error.boardTool === true);
});

test("차트·그래프 항목은 공용 렌더러가 그릴 수 있는 종류만 쓴다", () => {
  const drawable = new Set(["line", "arrow", "rect", "ellipse", "polyline", "text", "image", "group"]);
  const groups = [
    MNBoardTools.plotGroup({ curves:[{ source:"x^2" }], xMin:-4, xMax:4 }),
    MNBoardTools.chartGroup({ type:"bar", data:"가, 3\n나, 6" }),
    MNBoardTools.chartGroup({ type:"pie", data:"가, 3\n나, 6" })
  ];
  for (const group of groups){
    assert.ok(MNBoardRenderer.isSelectable(group));
    for (const item of group.items) assert.ok(drawable.has(item.type), item.type);
    assert.ok(MNBoardRenderer.itemBounds(group, () => 10));
  }
});

test("손그림 정리는 크게 그린 도형만 반듯하게 바꾸고 글씨 크기 획은 그대로 둔다", () => {
  const circle = [];
  for (let i = 0; i <= 60; i++){
    const angle = i / 60 * Math.PI * 2;
    circle.push({ x:200 + 80 * Math.cos(angle) + (i % 3 - 1), y:200 + 78 * Math.sin(angle) + (i % 2 - .5) });
  }
  const asEllipse = MNBoardTools.recognizeStroke(strokeFromPoints(circle));
  assert.equal(asEllipse.type, "ellipse");
  assert.equal(MNBoardTools.recognizedShapeName(asEllipse), "원");
  assert.equal(asEllipse.color, "#111111");
  assert.equal(asEllipse.width, 3);

  const straight = [];
  for (let i = 0; i <= 30; i++) straight.push({ x:50 + i * 9, y:100 + (i % 2 - .5) });
  assert.equal(MNBoardTools.recognizeStroke(strokeFromPoints(straight)).type, "line");

  const triangle = MNBoardTools.recognizeStroke(strokeFromPoints(traceShape([[100, 220], [220, 220], [160, 100], [100, 220]])));
  assert.equal(triangle.type, "polyline");
  assert.equal(triangle.points.length, 3);
  assert.equal(triangle.closed, true);
  assert.equal(MNBoardTools.recognizedShapeName(triangle), "삼각형");

  const rectangle = MNBoardTools.recognizeStroke(strokeFromPoints(traceShape([[80, 80], [280, 82], [281, 200], [79, 199], [80, 80]])));
  assert.equal(rectangle.type, "rect");

  // 글씨만 한 획·짧은 획·아무 모양도 아닌 낙서는 건드리지 않는다.
  assert.equal(MNBoardTools.recognizeStroke(strokeFromPoints([{ x:10, y:10 }, { x:12, y:30 }, { x:11, y:40 }, { x:13, y:44 }, { x:12, y:48 }, { x:14, y:50 }])), null);
  const scribble = [];
  for (let i = 0; i < 80; i++) scribble.push({ x:60 + i * 3 + (i % 7) * 9, y:120 + Math.sin(i) * 40 + (i % 5) * 7 });
  assert.equal(MNBoardTools.recognizeStroke(strokeFromPoints(scribble)), null);
});

test("교구는 자 모서리 스냅·15° 각도 스냅·각도기 읽기·컴퍼스 호를 계산한다", () => {
  const ruler = { x:100, y:200, angle:0, length:400 };
  const edge = MNBoardTools.rulerEdge(ruler);
  assert.deepEqual(edge.b, { x:500, y:200 });
  const snapped = MNBoardTools.snapToRuler({ x:250, y:214 }, ruler, 32);
  assert.deepEqual({ x:snapped.x, y:snapped.y }, { x:250, y:200 });
  assert.equal(MNBoardTools.snapToRuler({ x:250, y:400 }, ruler, 32), null);       // 멀리 그은 획은 자유롭게
  assert.deepEqual(MNBoardTools.snapToRuler({ x:900, y:205 }, ruler, 32), null);   // 자 길이 밖

  const angleSnapped = MNBoardTools.snapAngle({ x:0, y:0 }, { x:100, y:7 }, 15);   // 4° → 0°
  assert.ok(Math.abs(angleSnapped.y) < 1e-9 && Math.abs(angleSnapped.x - Math.hypot(100, 7)) < 1e-9);
  const toThirty = MNBoardTools.snapAngle({ x:0, y:0 }, { x:100, y:62 }, 15);      // 31.8° → 30°
  assert.equal(Math.round(Math.atan2(toThirty.y, toThirty.x) * 180 / Math.PI), 30);

  // 화면 좌표는 y 가 아래로 자라므로 위로 그은 선이 90°로 읽혀야 한다.
  assert.equal(Math.round(MNBoardTools.measureAngle({ x:0, y:0 }, { x:0, y:-50 }, 0)), 90);
  assert.equal(Math.round(MNBoardTools.measureAngle({ x:0, y:0 }, { x:-50, y:0 }, 0)), 180);
  // 각도기를 화면에서 시계 방향 90° 돌리면 아래쪽 기준선이 다시 0°다.
  assert.equal(Math.round(MNBoardTools.measureAngle({ x:0, y:0 }, { x:0, y:50 }, Math.PI / 2)), 0);
  assert.equal(MNBoardTools.lengthInCm(MNBoardTools.PX_PER_CM * 3).toFixed(1), "3.0");

  const arc = MNBoardTools.compassArcItem({ cx:100, cy:100, radius:60, from:0, to:Math.PI / 2 }, "#e11d48", 4);
  assert.equal(arc.type, "polyline");
  assert.equal(arc.color, "#e11d48");
  for (const point of arc.points) assert.ok(Math.abs(Math.hypot(point.x - 100, point.y - 100) - 60) < 1e-6);
  // 한 바퀴 다 돌면 원으로 닫고, 거의 안 돌렸으면 아무것도 남기지 않는다.
  assert.equal(MNBoardTools.compassArcItem({ cx:0, cy:0, radius:50, from:0, to:Math.PI * 2 }).type, "ellipse");
  assert.equal(MNBoardTools.compassArcItem({ cx:0, cy:0, radius:50, from:0, to:0.01 }), null);
});

test("변환은 대칭·회전·평행이동·닮음을 도형 종류에 맞게 옮긴다", () => {
  const triangle = { type:"polyline", points:[{ x:10, y:10 }, { x:60, y:10 }, { x:10, y:50 }], closed:true, color:"#111111", width:3 };
  // 선대칭: x=100 축 기준으로 좌우가 뒤집힌다
  const mirrored = MNBoardTools.transformedItem(triangle, MNBoardTools.makeTransform({ kind:"reflect", ax:100, ay:0, bx:100, by:80 }));
  assert.deepEqual(mirrored.points.map((p) => p.x), [190, 140, 190]);
  assert.deepEqual(mirrored.points.map((p) => p.y), [10, 10, 50]);
  // 점대칭은 180° 회전과 같다
  const half = MNBoardTools.transformedItem(triangle, MNBoardTools.makeTransform({ kind:"point", cx:0, cy:0 }));
  assert.deepEqual(half.points[0], { x:-10, y:-10 });

  const rect = { type:"rect", x1:0, y1:0, x2:40, y2:20, color:"#111111", width:3 };
  // 90°의 배수로 돌린 사각형은 rect 로 남고, 비스듬히 돌리면 다각형이 된다
  assert.equal(MNBoardTools.transformedItem(rect, MNBoardTools.makeTransform({ kind:"rotate", cx:0, cy:0, degrees:90 })).type, "rect");
  assert.equal(MNBoardTools.transformedItem(rect, MNBoardTools.makeTransform({ kind:"rotate", cx:0, cy:0, degrees:45 })).type, "polyline");
  // 닮음은 선 굵기까지 함께 키운다
  const scaled = MNBoardTools.transformedItem(rect, MNBoardTools.makeTransform({ kind:"scale", cx:0, cy:0, factor:2 }));
  assert.deepEqual([scaled.x2, scaled.y2, scaled.width], [80, 40, 6]);
  // 이미지 모델은 회전 좌표를 표현하지 못하므로 조용히 제자리 사본을 만들지 않는다.
  const image = { type:"image", src:"data:image/png;base64,x", x:10, y:20, w:40, h:20 };
  assert.equal(MNBoardTools.transformedItem(image, MNBoardTools.makeTransform({ kind:"rotate", cx:30, cy:30, degrees:90 })), null);
  const movedImage = MNBoardTools.transformedItem(image, MNBoardTools.makeTransform({ kind:"translate", dx:5, dy:-3 }));
  assert.deepEqual([movedImage.x, movedImage.y, movedImage.w, movedImage.h], [15, 17, 40, 20]);

  // 그룹은 자식 좌표가 지역 좌표라 회전을 담을 수 없다 — 풀어서 옮기고 다시 묶는다
  const group = {
    type:"group", role:"education-plot", plotSpec:{ curves:[] }, x:100, y:100, w:240, h:190, sourceW:240, sourceH:190,
    items:[{ type:"line", x1:0, y1:0, x2:240, y2:190, color:"#111111", width:3 }]
  };
  const turned = MNBoardTools.transformedItem(group, MNBoardTools.makeTransform({ kind:"rotate", cx:100, cy:100, degrees:90 }), (text, size) => String(text).length * size * .6);
  assert.equal(turned.type, "group");
  assert.equal(Math.round(turned.w), 190);
  assert.equal(Math.round(turned.h), 240);
  assert.equal(turned.plotSpec, undefined, "변환한 사본은 더 이상 그 식의 그래프가 아니다");
  assert.equal(turned.sourceW, turned.w);
});

test("측정 라벨은 길이·각도·넓이를 도형에서 직접 잰다", () => {
  const cm = MNBoardTools.PX_PER_CM;
  assert.equal(MNBoardTools.measureLabel({ type:"line", x1:0, y1:0, x2:cm * 5, y2:0 }).text, "5.0cm");
  const area = MNBoardTools.measureLabel({ type:"rect", x1:0, y1:0, x2:cm * 2, y2:cm * 3 });
  assert.equal(area.kind, "area");
  assert.equal(area.text, "2.0cm × 3.0cm = 6.0cm²");
  assert.match(MNBoardTools.measureLabel({ type:"ellipse", x1:0, y1:0, x2:cm * 2, y2:cm * 2 }).text, /^반지름 1\.0cm/);
  // 꺾인 점이 하나뿐인 열린 선은 그 자리의 각을 잰다
  const angle = MNBoardTools.measureLabel({ type:"polyline", points:[{ x:100, y:0 }, { x:0, y:0 }, { x:0, y:100 }] });
  assert.equal(angle.kind, "angle");
  assert.equal(angle.text, "90°");
  assert.equal(MNBoardTools.measureLabel({ type:"polyline", closed:true, points:[{ x:0, y:0 }, { x:cm * 4, y:0 }, { x:0, y:cm * 3 }] }).text, "6.0cm²");
  const openArc = MNBoardTools.compassArcItem({ cx:0, cy:0, radius:cm, from:0, to:Math.PI / 2 });
  const arcMeasure = MNBoardTools.measureLabel(openArc);
  assert.equal(arcMeasure.kind, "length");
  assert.equal(arcMeasure.text, "1.6cm");
  assert.equal(MNBoardTools.polygonArea([{ x:0, y:0 }, { x:10, y:0 }, { x:10, y:10 }, { x:0, y:10 }]), 100);
  assert.equal(MNBoardTools.measureLabel({ type:"image", x:0, y:0, w:10, h:10 }), null);
});

test("반응식 균형은 정수 계수를 정확히 구하고 못 맞추는 식은 알려 준다", () => {
  assert.equal(MNBoardTools.balanceEquation("H2 + O2 -> H2O").text, "2H₂ + O₂ → 2H₂O");
  assert.deepEqual(MNBoardTools.balanceEquation("CH4 + O2 -> CO2 + H2O").coefficients, [1, 2, 1, 2]);
  assert.equal(MNBoardTools.balanceEquation("Fe + O2 -> Fe2O3").text, "4Fe + 3O₂ → 2Fe₂O₃");
  assert.equal(MNBoardTools.balanceEquation("Ca(OH)2 + HCl -> CaCl2 + H2O").text, "Ca(OH)₂ + 2HCl → CaCl₂ + 2H₂O");
  // 이미 계수를 적어 두었어도 다시 맞춘다
  assert.deepEqual(MNBoardTools.balanceEquation("3H2 + 9O2 -> 5H2O").coefficients, [2, 1, 2]);
  assert.deepEqual(MNBoardTools.balanceEquation("KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2").coefficients, [2, 16, 2, 2, 8, 5]);
  assert.deepEqual(MNBoardTools.parseChemicalFormula("Ca(OH)2"), { Ca:1, O:2, H:2 });
  assert.throws(() => MNBoardTools.parseChemicalFormula("Xx2"), (error) => /모르는 원소/.test(error.message));
  assert.throws(() => MNBoardTools.balanceEquation("H2 + O2 -> H2"), (error) => error.boardTool === true);
  assert.throws(() => MNBoardTools.balanceEquation("H2O"), (error) => /화살표/.test(error.message));
});

test("주기율표는 118개 원소와 배치·검색·원소 카드를 제공한다", () => {
  assert.equal(MNBoardTools.PERIODIC_TABLE.length, 118);
  const oxygen = MNBoardTools.findElements("산소")[0];
  assert.deepEqual([oxygen.number, oxygen.symbol, oxygen.group, oxygen.period], [8, "O", 16, 2]);
  assert.equal(MNBoardTools.findElements("Na")[0].name, "나트륨");
  assert.equal(MNBoardTools.findElements("26")[0].symbol, "Fe");
  // 란타넘·악티늄족만 족이 0(표 아래 두 줄)이고 나머지는 1~18족에 들어간다
  const fBlock = MNBoardTools.PERIODIC_TABLE.filter((element) => element.group === 0);
  assert.equal(fBlock.length, 30);
  assert.ok(MNBoardTools.PERIODIC_TABLE.every((element) => element.group >= 0 && element.group <= 18 && element.period >= 1 && element.period <= 7));
  assert.ok(MNBoardTools.PERIODIC_TABLE.every((element) => element.mass > 0 && element.name && element.symbol));
  const card = MNBoardTools.elementCardGroup("Na", "#111111");
  assert.equal(card.role, "education-element");
  assert.equal(card.elementNumber, 11);
  assert.ok(card.items.some((item) => item.type === "text" && item.text === "Na"));
  assert.ok(card.items.some((item) => item.type === "text" && item.text === "나트륨"));
  assert.throws(() => MNBoardTools.elementCardGroup("Zz"), (error) => error.boardTool === true);
});

test("확률 실험은 정해진 난수로 같은 결과를 내고 합계가 횟수와 맞는다", () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const dice = MNBoardTools.simulateTrials("dice", 600, { random });
  assert.equal(dice.rows.length, 6);
  assert.equal(dice.rows.reduce((sum, row) => sum + row.value, 0), 600);
  assert.equal(dice.title, "주사위 600회");
  assert.match(dice.summary, /평균/);
  assert.equal(dice.data.split("\n").length, 6);
  const coin = MNBoardTools.simulateTrials("coin", 100, { random });
  assert.deepEqual(coin.rows.map((row) => row.label), ["앞", "뒤"]);
  assert.equal(MNBoardTools.simulateTrials("dice2", 100, { random }).rows.length, 11);
  assert.equal(MNBoardTools.simulateTrials("number", 50, { random, min:1, max:5 }).rows.length, 5);
  assert.throws(() => MNBoardTools.simulateTrials("number", 10, { min:5, max:1 }), (error) => error.boardTool === true);
  assert.throws(() => MNBoardTools.simulateTrials("magic", 10), (error) => error.boardTool === true);
  // 실험 결과는 그대로 차트 자료가 된다
  assert.equal(MNBoardTools.chartGroup({ type:"bar", data:dice.data }).chartSpec.rows.length, 6);
});

test("화이트보드는 새 도구를 교구·그래프·차트 접점에 배선한다", () => {
  // 교구는 판서가 아니라 손에 든 도구 — 내보내기 그림에는 들어가지 않아야 한다.
  assert.match(whiteboardSource, /gearHidden\s*=\s*true;\s*redraw\(\)/);
  assert.match(whiteboardSource, /if \(gearHidden\) return;/);
  // 손잡이는 어떤 도구를 쓰는 중이든 먼저 잡는다.
  assert.match(whiteboardSource, /const gearHit = gearHandleAt\(lastBoardPointer\);/);
  // 지우개는 자에 붙이지 않는다.
  assert.match(whiteboardSource, /cur\.type === "eraser" \? raw : gearSnapPoint\(raw\)/);
  // 그린 뒤 정리 → 한 번의 Ctrl+Z 로 원래 획이 돌아온다.
  assert.match(whiteboardSource, /wb\.items\.push\(finished\); cur = null; redraw\(\); history\.commit\(\); recordCommit\(\);\s*\n\s*tidyStroke\(finished\);/);
  // 그래프·차트는 두 번 눌러 다시 고칠 수 있다.
  assert.match(whiteboardSource, /item\.role === "education-plot" && item\.plotSpec/);
  assert.match(whiteboardSource, /item\.role === "education-chart" && item\.chartSpec/);
  assert.match(whiteboardSource, /\["graph", "그래프"\], \["chart", "차트"\]/);
  assert.match(whiteboardSource, /MNBoardTools\.plotGroup\(spec\)/);
  assert.match(whiteboardSource, /MNBoardTools\.chartGroup\(readChartSpec/);
  // 측정 라벨은 그릴 때마다 다시 재고, 저장·녹화 직전에 모델에도 같은 값을 적는다.
  assert.match(whiteboardSource, /drawItem\(isMeasureItem\(it\) \? \(liveMeasureItem\(it\) \|\| it\) : it\)/);
  assert.match(whiteboardSource, /const recordCommit = \(\) => \{\s*\n\s*syncMeasureItems\(\);/);
  assert.match(whiteboardSource, /const boardSnapshot = \(\) => \(syncMeasureItems\(\),/);
  // 잰 도형을 지우면 라벨도 함께 사라지고, 원본을 대신하는 변환은 이름표를 물려받는다.
  assert.match(whiteboardSource, /const label = measureLabelOf\(selected\);/);
  assert.match(whiteboardSource, /if \(selected\.mid\) moved\.mid = selected\.mid; else delete moved\.mid;/);
  assert.match(whiteboardSource, /\["chemistry", "화학"\]/);
  assert.match(whiteboardSource, /MNBoardTools\.balanceEquation\(source\)/);
  assert.match(whiteboardSource, /MNBoardTools\.elementCardGroup\(element, wb\.color\)/);
  assert.match(whiteboardSource, /MNBoardTools\.simulateTrials\(kind, Number\(simCount\.value\)/);
});
