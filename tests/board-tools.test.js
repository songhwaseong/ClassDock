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

test("매개변수가 있는 그래프는 보드에 슬라이더를 함께 그리고 손잡이 자리를 알려 준다", () => {
  const group = MNBoardTools.plotGroup({ curves:[{ source:"a sin(x)" }], params:{ a:2 }, xMin:-6, xMax:6, width:520, height:360 });
  assert.equal(group.sliders.length, 1);
  const slider = group.sliders[0];
  assert.equal(slider.name, "a");
  assert.equal(slider.value, 2);
  assert.ok(slider.y > 360 - 40 && slider.y < 360, "슬라이더 띠는 그림 아래쪽에 놓인다");
  assert.ok(group.items.some((item) => item.type === "text" && item.text === "a = 2"));
  // 슬라이더가 있으면 세로 눈금을 붙잡아 둔다 — 값을 끌 때 축이 따라 움직이면 무엇이 변했는지 안 보인다.
  assert.ok(Number.isFinite(group.plotSpec.yMin) && Number.isFinite(group.plotSpec.yMax));
  assert.equal(group.plotSpec.showSliders, true);
  // 끄지 않기로 하면 띠가 사라지고 자동 y 범위로 돌아간다.
  const plain = MNBoardTools.plotGroup({ curves:[{ source:"a sin(x)" }], params:{ a:2 }, showSliders:false, width:520, height:360 });
  assert.deepEqual(plain.sliders, []);
  assert.equal(plain.plotSpec.yMin, null);

  // 보드에 놓인 그룹은 크기가 바뀌고 좌우로 뒤집힐 수 있다 — 그 좌표를 되돌려 손잡이를 찾는다.
  const placed = Object.assign({}, group, { x:100, y:50, w:1040, h:720 });
  const knobX = 100 + (slider.x1 + (slider.x2 - slider.x1) * (2 - slider.min) / (slider.max - slider.min)) * 2;
  const hit = MNBoardTools.plotSliderAt(placed, { x:knobX, y:50 + slider.y * 2 });
  assert.equal(hit && hit.index, 0);
  assert.equal(MNBoardTools.plotSliderAt(placed, { x:knobX, y:60 }), null);
  // 끌어 놓은 자리는 0.1 눈금으로 읽고 띠 밖은 양 끝 값으로 붙잡는다.
  assert.equal(MNBoardTools.sliderValueAt(slider, (slider.x1 + slider.x2) / 2), 0);
  assert.equal(MNBoardTools.sliderValueAt(slider, slider.x2 + 500), 10);
  assert.equal(MNBoardTools.sliderValueAt(slider, slider.x1 - 500), -10);
  const quarter = MNBoardTools.sliderValueAt(slider, slider.x1 + (slider.x2 - slider.x1) * .25);
  assert.equal(quarter, -5);
  // 값을 바꿔 다시 그리면 같은 자리에 손잡이만 옮겨 간다.
  const moved = MNBoardTools.plotGroup(Object.assign({}, group.plotSpec, { params:{ a:5 } }));
  assert.equal(moved.sliders[0].y, slider.y);
  assert.ok(moved.sliders[0].x1 === slider.x1 && moved.sliders[0].value === 5);
  assert.deepEqual([moved.plotSpec.yMin, moved.plotSpec.yMax], [group.plotSpec.yMin, group.plotSpec.yMax]);
});

test("그래프 해석 도구는 교점·접선·구간 넓이·부등식 영역을 실제로 계산한다", () => {
  const textOf = (group) => group.items.filter((item) => item.type === "text").map((item) => item.text);
  // 교점: x^2-2 와 x 는 x=-1, 2 에서 만난다.
  const crossing = MNBoardTools.plotGroup({
    curves:[{ source:"x^2 - 2" }, { source:"x" }], xMin:-4, xMax:4, width:520, height:360, showIntersections:true
  });
  assert.ok(textOf(crossing).includes("(-1, -1)"));
  assert.ok(textOf(crossing).includes("(2, 2)"));
  // 점근선을 사이에 둔 부호 뒤집힘은 교점으로 세지 않는다.
  const fake = MNBoardTools.plotGroup({ curves:[{ source:"1/x" }, { source:"0" }], xMin:-4, xMax:4, showIntersections:true });
  assert.equal(textOf(fake).filter((text) => /^\(/.test(text)).length, 0);

  // 접선: x^2 의 x=1.5 에서 기울기는 3.
  const tangent = MNBoardTools.plotGroup({ curves:[{ source:"x^2" }], xMin:-4, xMax:4, tangentX:1.5 });
  assert.ok(textOf(tangent).some((text) => text === "x = 1.5에서 기울기 3"));
  assert.ok(tangent.items.some((item) => item.type === "line" && Array.isArray(item.dash)), "접선은 점선으로 긋는다");

  // 넓이: ∫₀² x² dx = 8/3, 직사각형 8개(가운데 높이)면 2.6563.
  const integral = MNBoardTools.plotGroup({ curves:[{ source:"x^2" }], xMin:-1, xMax:3, areaFrom:0, areaTo:2 });
  assert.ok(textOf(integral).some((text) => text === "0~2 넓이 ≈ 2.6667"));
  assert.ok(integral.items.some((item) => item.type === "polyline" && item.fill && item.closed));
  const riemann = MNBoardTools.plotGroup({ curves:[{ source:"x^2" }], xMin:-1, xMax:3, areaFrom:0, areaTo:2, areaBars:8 });
  assert.ok(textOf(riemann).some((text) => text === "직사각형 8개의 합 ≈ 2.6563"));
  assert.equal(riemann.items.filter((item) => item.type === "rect" && item.fill).length, 8);

  // 부등식: y > x+1 은 위쪽 반평면을 칠하고 경계선을 점선으로 긋는다.
  const region = MNBoardTools.plotGroup({ curves:[{ source:"x + 1", relation:"gt" }], xMin:-5, xMax:5, width:520, height:360 });
  const shade = region.items.find((item) => item.type === "polyline" && item.fill && item.closed);
  assert.ok(shade && shade.points.every((point) => point.y >= -0.01 && point.y <= 360.01));
  assert.ok(region.items.some((item) => item.type === "polyline" && !item.fill && Array.isArray(item.dash)));
  assert.ok(textOf(region).includes("y > x + 1"));
  // 등호가 있는 부등식은 경계선을 실선으로 둔다.
  const closed = MNBoardTools.plotGroup({ curves:[{ source:"x + 1", relation:"le" }], xMin:-5, xMax:5 });
  assert.ok(!closed.items.some((item) => item.type === "polyline" && !item.fill && Array.isArray(item.dash)));

  // 설정은 그대로 저장돼 다시 열면 같은 그림이 나온다. 값을 안 정한 자리는 0 이 아니라 null 로 남는다.
  assert.deepEqual(
    [crossing.plotSpec.showIntersections, crossing.plotSpec.tangentX, crossing.plotSpec.areaFrom, crossing.plotSpec.areaBars],
    [true, null, null, 0]
  );
  assert.equal(MNBoardTools.plotGroup(integral.plotSpec).items.length, integral.items.length);
});

test("값의 표는 식에서 x·y 대응표를 만들고 칸이 너무 많으면 막는다", () => {
  const group = MNBoardTools.valueTableGroup({ curves:[{ source:"2x + 1" }, { source:"x^2" }], from:-3, to:3, step:1, title:"값의 표" });
  assert.equal(group.role, "education-table");
  assert.equal(group.tableSpec.kind, "values");
  // 줄(y 좌표)별로 글자를 모으면 머리글 x 줄과 식마다 한 줄이 나온다.
  const lines = new Map();
  for (const item of group.items.filter((it) => it.type === "text")){
    const key = Math.round(item.y);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(item.text);
  }
  const rows = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => cells);
  assert.deepEqual(rows[0], ["값의 표"]);
  assert.deepEqual(rows[1], ["x", "-3", "-2", "-1", "0", "1", "2", "3"]);
  assert.deepEqual(rows[2], ["y = 2x + 1", "-5", "-3", "-1", "1", "3", "5", "7"]);
  assert.deepEqual(rows[3], ["y = x^2", "9", "4", "1", "0", "1", "4", "9"]);
  // 정의역 밖은 빈칸이 아니라 —(값 없음)으로 적는다.
  const root = MNBoardTools.valueTableGroup({ curves:[{ source:"sqrt(x)" }], from:-1, to:1, step:1 });
  assert.ok(root.items.some((item) => item.type === "text" && item.text === "—"));
  // 매개변수가 있는 식도 슬라이더로 정한 값을 그대로 넣어 계산한다.
  const withParam = MNBoardTools.valueTableGroup({ curves:[{ source:"a x" }], params:{ a:3 }, from:1, to:3, step:1 });
  assert.ok(withParam.items.some((item) => item.type === "text" && item.text === "9"));
  assert.throws(() => MNBoardTools.valueTableGroup({ curves:[{ source:"x" }], from:0, to:100, step:1 }), (error) => /칸이 너무 많/.test(error.message));
  assert.throws(() => MNBoardTools.valueTableGroup({ curves:[{ source:"x" }], from:5, to:1, step:1 }), (error) => error.boardTool === true);
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

test("자료를 여러 열 적으면 묶음(계열)이 여러 개인 차트가 된다", () => {
  const table = MNBoardTools.parseChartTable("과목, 1반, 2반\n국어, 7, 9\n수학, 12, 8");
  assert.deepEqual(table.series, ["1반", "2반"]);
  assert.deepEqual(table.rows, [{ label:"국어", values:[7, 9] }, { label:"수학", values:[12, 8] }]);
  // 첫 칸은 언제나 이름이라 산점도의 "1, 3" 은 x=1,y=3 그대로다.
  assert.deepEqual(MNBoardTools.parseChartTable("1, 3\n2, 5").rows, [{ label:"1", values:[3] }, { label:"2", values:[5] }]);
  // 이름에 띄어쓰기가 있어도 값만 뒤에서 걷어 낸다.
  assert.deepEqual(MNBoardTools.parseChartTable("홍 길동 7 9").rows, [{ label:"홍 길동", values:[7, 9] }]);
  // 줄마다 열 개수가 달라도 짧은 줄은 빈칸으로 채워 계열 수를 맞춘다.
  assert.deepEqual(MNBoardTools.parseChartTable("가, 1\n나, 2, 3").rows[0].values, [1, null]);

  const grouped = MNBoardTools.chartGroup({ type:"bar", data:"과목, 1반, 2반\n국어, 7, 9\n수학, 12, 8" });
  assert.deepEqual(grouped.chartSpec.series, ["1반", "2반"]);
  // 묶음마다 막대가 따로 서고(테두리 포함 2개씩), 범례 이름이 붙는다.
  assert.equal(grouped.items.filter((item) => item.type === "rect" && item.fill).length, 4 + 2);
  for (const name of ["1반", "2반"]) assert.ok(grouped.items.some((item) => item.type === "text" && item.text === name));
  const single = MNBoardTools.chartGroup({ type:"bar", data:"국어, 7\n수학, 12" });
  assert.ok(!single.items.some((item) => item.type === "text" && /^자료 \d$/.test(item.text)), "묶음이 하나면 범례를 달지 않는다");

  const lines = MNBoardTools.chartGroup({ type:"line", data:"월, 작년, 올해\n3월, 8, 9\n4월, 14, 16" });
  assert.equal(lines.items.filter((item) => item.type === "polyline").length, 2);
  // 원그래프·히스토그램은 첫 묶음만 쓴다(부채꼴은 겹칠 수 없다).
  const pie = MNBoardTools.chartGroup({ type:"pie", data:"과목, 1반, 2반\n국어, 7, 9\n수학, 12, 8" });
  assert.equal(pie.items.filter((item) => item.type === "polyline" && item.fill).length, 2);
});

test("묶음 색을 골라 넘기면 그 색으로 그리고 차트에 함께 저장한다", () => {
  const colored = MNBoardTools.chartGroup({ type:"bar", data:"과목, 1반, 2반\n국어, 7, 9", palette:["#ff0000", "#00ff00"] });
  assert.ok(colored.items.some((item) => item.type === "rect" && item.fill && item.color === "#ff0000"));
  assert.ok(colored.items.some((item) => item.type === "rect" && item.fill && item.color === "#00ff00"));
  assert.deepEqual(colored.chartSpec.palette, ["#ff0000", "#00ff00"]);
  // 저장본에서 되살린 색이 망가져 있으면 기본 색으로 대신한다(잘못된 색 문자열이 그림에 새지 않게).
  const broken = MNBoardTools.chartGroup({ type:"bar", data:"가, 1\n나, 2", palette:["red", "#00FF00"] });
  assert.deepEqual(broken.chartSpec.palette, [MNBoardTools.CHART_PALETTE[0], "#00ff00"]);
  // 색을 고르지 않으면 기본 팔레트 그대로다.
  assert.deepEqual(MNBoardTools.chartGroup({ type:"bar", data:"가, 1" }).chartSpec.palette, MNBoardTools.CHART_PALETTE);
});

test("자료 요약은 학교식 사분위수로 재고 상자그림·도수분포표·추세선이 그 값을 쓴다", () => {
  const scores = "62\n71\n75\n78\n80\n83\n85\n88\n91\n95\n72\n77";
  const stat = MNBoardTools.describeData([62, 71, 75, 78, 80, 83, 85, 88, 91, 95, 72, 77]);
  assert.equal(stat.n, 12);
  assert.equal(stat.median, 79);                       // 78 과 80 의 평균
  assert.equal(stat.q1, 73.5);                         // 아래 반쪽(6개)의 중앙값
  assert.equal(stat.q3, 86.5);
  assert.equal(stat.range, 33);
  assert.deepEqual(stat.modes, []);                    // 한 번씩만 나오면 최빈값은 없다
  assert.deepEqual(MNBoardTools.describeData([1, 2, 2, 3, 3]).modes, [2, 3]);
  assert.equal(MNBoardTools.describeData([5]).q1, 5);  // 자료가 하나여도 무너지지 않는다
  assert.equal(Math.round(MNBoardTools.describeData([2, 4, 4, 4, 5, 5, 7, 9]).sd * 100) / 100, 2);
  assert.throws(() => MNBoardTools.describeData([]), (error) => error.boardTool === true);

  const card = MNBoardTools.statsSummaryGroup({ data:scores, title:"수학 점수" });
  const cardText = card.items.filter((item) => item.type === "text").map((item) => item.text);
  assert.equal(card.tableSpec.kind, "stats");
  for (const cell of ["평균", "79.75", "중앙값", "79", "표준편차", "제1사분위수 Q1", "73.5"]) assert.ok(cardText.includes(cell), cell);

  const frequency = MNBoardTools.frequencyTableGroup({ data:scores, bins:4 });
  const rows = frequency.items.filter((item) => item.type === "text").map((item) => item.text);
  assert.equal(frequency.tableSpec.kind, "frequency");
  assert.deepEqual(rows.slice(1, 5), ["계급", "도수", "상대도수", "누적도수"]);
  assert.equal(rows[rows.length - 3], "합계");         // 마지막 줄은 합계(누적도수 칸은 비운다)

  // 상자그림은 다섯 수 요약을 실제로 계산해 그린다.
  const box = MNBoardTools.chartGroup({ type:"box", data:scores, title:"수학 점수", width:560, height:400 });
  assert.equal(box.educationLabel, "상자그림");
  assert.equal(box.chartSpec.type, "box");
  const boxText = box.items.filter((item) => item.type === "text").map((item) => item.text);
  assert.ok(boxText.includes("중앙값 79") && boxText.includes("Q1 73.5") && boxText.includes("Q3 86.5"));
  // 열이 여럿이면 상자도 여럿(테두리 사각형이 묶음마다 두 개씩).
  const two = MNBoardTools.chartGroup({ type:"box", data:"번호, 1반, 2반\n1, 62, 71\n2, 75, 68\n3, 88, 79\n4, 91, 84" });
  assert.equal(two.items.filter((item) => item.type === "rect" && item.fill).length, 2);
  for (const name of ["1반", "2반"]) assert.ok(two.items.some((item) => item.type === "text" && item.text === name));
  assert.throws(() => MNBoardTools.chartGroup({ type:"box", data:"이름만\n또 이름만" }), (error) => error.boardTool === true);

  // 산점도 추세선 — 최소제곱 직선과 상관계수.
  const fit = MNBoardTools.linearFit([{ x:1, y:2 }, { x:2, y:4 }, { x:3, y:6 }]);
  assert.deepEqual([fit.slope, fit.intercept, Math.round(fit.r)], [2, 0, 1]);
  assert.equal(MNBoardTools.linearFit([{ x:1, y:2 }]), null);
  assert.equal(MNBoardTools.linearFit([{ x:1, y:2 }, { x:1, y:5 }]), null);   // 세로로 늘어선 점은 직선을 못 정한다
  const scatter = MNBoardTools.chartGroup({ type:"scatter", data:"1, 60\n2, 68\n3, 74\n4, 79\n5, 88", trend:true });
  assert.ok(scatter.items.some((item) => item.type === "line" && Array.isArray(item.dash)));
  assert.ok(scatter.items.some((item) => item.type === "text" && /r = 0\.99/.test(item.text)));
  assert.equal(scatter.chartSpec.trend, true);
});

test("수 모형은 분수·자릿값·뛰어세기·저울을 값 그대로 그린다", () => {
  const textOf = (group) => group.items.filter((item) => item.type === "text").map((item) => item.text);
  // 분수 막대: 분모만큼 칸을 나누고 분자만큼 칠한다(칠한 칸 + 테두리 칸이 각각 생긴다).
  const bar = MNBoardTools.fractionModelGroup({ fractions:"3/4, 2/3" });
  assert.equal(bar.role, "education-tool");
  assert.deepEqual(bar.toolSpec, { kind:"fraction", values:{ shape:"bar", fractions:"3/4, 2/3" } });
  assert.equal(bar.items.filter((item) => item.type === "rect" && item.fill).length, 5);   // 3 + 2
  assert.equal(bar.items.filter((item) => item.type === "rect" && !item.fill).length, 7);  // 4 + 3
  assert.deepEqual(textOf(bar), ["3", "4", "2", "3"]);
  // 가분수는 전체를 여러 개 그린다(5/3 → 두 개).
  const improper = MNBoardTools.fractionModelGroup({ shape:"circle", fractions:"5/3" });
  assert.equal(improper.items.filter((item) => item.fill).length, 5);
  assert.throws(() => MNBoardTools.fractionModelGroup({ fractions:"3-4" }), (error) => /3\/4 처럼/.test(error.message));
  assert.throws(() => MNBoardTools.fractionModelGroup({ fractions:"" }), (error) => error.boardTool === true);

  // 자릿값 블록: 앞자리 0 은 그리지 않고, 자리마다 개수를 적는다.
  const blocks = MNBoardTools.placeValueGroup({ value:1347 });
  assert.deepEqual(textOf(blocks), ["1347 = 1000 + 300 + 40 + 7", "천 1", "백 3", "십 4", "일 7"]);
  assert.deepEqual(textOf(MNBoardTools.placeValueGroup({ value:7 })), ["7", "일 7"]);
  assert.equal(MNBoardTools.placeValueGroup({ value:99999 }).toolSpec.values.value, 9999);  // 범위 밖은 붙잡는다

  // 수직선 뛰어세기: 2에서 3씩 네 번 → 14, 수직선 밖으로는 뛰지 않는다.
  const jumps = MNBoardTools.numberLineJumpGroup({ from:0, to:20, start:2, step:3, jumps:4 });
  assert.ok(textOf(jumps).includes("2에서 3씩 뛰어 세기 → 14"));
  assert.ok(textOf(jumps).filter((text) => text === "+3").length === 4);
  const clipped = MNBoardTools.numberLineJumpGroup({ from:0, to:10, start:8, step:3, jumps:5 });
  assert.ok(textOf(clipped).includes("8에서 3씩 뛰어 세기 → 8"));
  assert.ok(textOf(MNBoardTools.numberLineJumpGroup({ from:0, to:20, start:18, step:-4, jumps:3 })).includes("18에서 4씩 거꾸로 뛰어 세기 → 6"));
  assert.throws(() => MNBoardTools.numberLineJumpGroup({ from:5, to:5 }), (error) => error.boardTool === true);
  assert.throws(() => MNBoardTools.numberLineJumpGroup({ from:0, to:20, step:0 }), (error) => /0이 될 수 없/.test(error.message));

  // 양팔 저울: 식을 적고 풀 수 있으면 답까지 적는다.
  const scale = MNBoardTools.balanceScaleGroup({ leftX:2, leftOne:3, rightX:0, rightOne:11 });
  assert.ok(textOf(scale).includes("2x + 3 = 11"));
  assert.ok(textOf(scale).some((text) => /x = 4$/.test(text)));
  assert.equal(scale.items.filter((item) => item.type === "text" && item.text === "x").length, 2);
  assert.equal(scale.items.filter((item) => item.type === "text" && item.text === "1").length, 14);
  // 양변의 x 개수가 같으면 x 를 정할 수 없다 — 답을 적지 않는다.
  assert.ok(!MNBoardTools.balanceScaleGroup({ leftX:2, leftOne:3, rightX:2, rightOne:3 }).items.some((item) => item.type === "text" && /x = /.test(item.text)));
  assert.throws(() => MNBoardTools.balanceScaleGroup({ leftX:0, rightX:0 }), (error) => error.boardTool === true);
});

test("벡터 합성은 평행사변형과 합력을 재어 그린다", () => {
  const cm = MNBoardTools.PX_PER_CM;
  // 3cm(→)와 4cm(↑)의 합은 5cm, 화면 좌표에서 위로 53.1°
  const group = MNBoardTools.vectorSumGroup(
    { type:"arrow", x1:100, y1:200, x2:100 + cm * 3, y2:200 },
    { type:"arrow", x1:100, y1:200, x2:100, y2:200 - cm * 4 }
  );
  assert.equal(group.role, "vector-sum");
  assert.equal(group.vectorSum.text, "합력 5.0cm · 53.1°");
  assert.equal(group.items.filter((item) => item.type === "arrow").length, 1);
  assert.equal(group.items.filter((item) => item.type === "line" && Array.isArray(item.dash)).length, 2);
  // 그룹은 두 화살표와 합력을 모두 감싸는 자리에 놓인다(보드 좌표 그대로).
  assert.ok(group.x <= 100 && group.y <= 200 - cm * 4 && group.x + group.w >= 100 + cm * 3);
  // 눈금을 정해 주면 힘의 단위로 적는다(1cm = 2N).
  assert.equal(MNBoardTools.vectorSumGroup(
    { x1:0, y1:0, x2:cm * 3, y2:0 }, { x1:0, y1:0, x2:0, y2:-cm * 4 }, { perCm:2, unit:"N" }
  ).vectorSum.text, "합력 10N · 53.1°");
  assert.throws(() => MNBoardTools.vectorSumGroup({ x1:0, y1:0, x2:20, y2:0 }, { x1:0, y1:0, x2:-20, y2:0 }), (error) => error.boardTool === true);
});

test("광선 작도는 상의 자리·크기를 렌즈 공식으로 구한다", () => {
  const textOf = (group) => group.items.filter((item) => item.type === "text").map((item) => item.text);
  // 볼록렌즈 f=4, a=6 → b=12, 배율 -2(실상·도립·확대)
  const lens = MNBoardTools.opticsSolve("convex-lens", 4, 6);
  assert.deepEqual([lens.b, lens.magnification, lens.real], [12, -2, true]);
  // 초점 안쪽(돋보기)은 허상·정립·확대
  const magnifier = MNBoardTools.opticsSolve("convex-lens", 4, 3);
  assert.deepEqual([magnifier.b, magnifier.magnification, magnifier.real], [-12, 4, false]);
  // 오목렌즈·볼록거울은 언제나 허상·정립·축소
  for (const kind of ["concave-lens", "convex-mirror"]){
    const solved = MNBoardTools.opticsSolve(kind, 4, 6);
    assert.ok(!solved.real && solved.magnification > 0 && solved.magnification < 1, kind);
  }
  assert.equal(MNBoardTools.opticsSolve("concave-mirror", 4, 6).b, 12);
  assert.throws(() => MNBoardTools.opticsSolve("convex-lens", 4, 4), (error) => /초점에 있으면/.test(error.message));

  const group = MNBoardTools.opticsGroup({ kind:"convex-lens", focal:4, distance:6, height:2 });
  assert.equal(group.role, "education-tool");
  assert.deepEqual(group.toolSpec.values, { kind:"convex-lens", focal:4, distance:6, height:2 });
  assert.ok(textOf(group).includes("상거리 12cm · 배율 -2배 (실상·도립·확대)"));
  assert.ok(textOf(group).includes("실상") && textOf(group).includes("물체"));
  assert.equal(group.items.filter((item) => item.type === "polyline").length, 3);   // 광선 세 개
  // 허상이면 상 화살표와 연장선을 점선으로 그린다.
  const virtual = MNBoardTools.opticsGroup({ kind:"convex-lens", focal:4, distance:3, height:2 });
  assert.ok(virtual.items.some((item) => item.type === "arrow" && Array.isArray(item.dash)));
  assert.ok(textOf(virtual).includes("허상"));
});

test("퍼넷 사각형은 배우자를 만들어 칸을 채우고 비율을 센다", () => {
  const textOf = (group) => group.items.filter((item) => item.type === "text").map((item) => item.text);
  assert.deepEqual(MNBoardTools.punnettGametes("AaBb").gametes, ["AB", "Ab", "aB", "ab"]);
  assert.deepEqual(MNBoardTools.punnettGametes("AA").gametes, ["A", "A"]);
  assert.throws(() => MNBoardTools.punnettGametes("Ab"), (error) => /같은 형질끼리/.test(error.message));
  assert.throws(() => MNBoardTools.punnettGametes("A"), (error) => error.boardTool === true);
  assert.throws(() => MNBoardTools.punnettGametes("AaBbCc"), (error) => /두 가지까지/.test(error.message));

  const single = MNBoardTools.punnettGroup({ parentA:"Aa", parentB:"Aa" });
  const cells = textOf(single);
  assert.equal(single.toolSpec.kind, "punnett");
  assert.ok(cells.includes("AA") && cells.includes("aa"));
  assert.equal(cells.filter((text) => text === "Aa").length, 2);
  assert.ok(cells.includes("유전자형 AA 1 : Aa 2 : aa 1"));
  assert.ok(cells.includes("표현형 A_ 3 : aa 1  (전체 4칸)"));
  // 두 형질이면 9 : 3 : 3 : 1
  const dihybrid = textOf(MNBoardTools.punnettGroup({ parentA:"AaBb", parentB:"AaBb" }));
  assert.ok(dihybrid.includes("표현형 A_B_ 9 : A_bb 3 : aaB_ 3 : aabb 1  (전체 16칸)"));
  assert.throws(() => MNBoardTools.punnettGroup({ parentA:"Aa", parentB:"AaBb" }), (error) => /형질 수/.test(error.message));
  assert.throws(() => MNBoardTools.punnettGroup({ parentA:"Aa", parentB:"Bb" }), (error) => /형질 문자/.test(error.message));
});

test("확률 실험은 주머니·스피너까지 굴리고 누적 상대도수로 큰 수의 법칙을 보여 준다", () => {
  let seed = 11;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const items = [{ label:"빨강", value:3 }, { label:"파랑", value:2 }];
  const bag = MNBoardTools.simulateTrials("bag", 500, { items, random });
  assert.deepEqual(bag.rows.map((row) => row.label), ["빨강", "파랑"]);
  assert.equal(bag.rows.reduce((sum, row) => sum + row.value, 0), 500);
  assert.ok(Math.abs(bag.rows[0].value / 500 - 0.6) < 0.08, "5개 중 3개가 빨강이면 60% 근처");
  assert.equal(bag.title, "주머니 500회");

  // 두 개를 비복원으로 뽑으면 결과가 조합이 되고, 같은 색 두 개도 나올 수 있다.
  const pair = MNBoardTools.simulateTrials("bag", 500, { items, draws:2, random });
  assert.ok(pair.rows.every((row) => /·|\d/.test(row.label)));
  assert.equal(pair.rows.reduce((sum, row) => sum + row.value, 0), 500);
  assert.ok(pair.rows.some((row) => row.label === "빨강1·파랑1"));
  // 파랑은 2개뿐이라 비복원으로 3개를 뽑으면 파랑3 은 나올 수 없다.
  const three = MNBoardTools.simulateTrials("bag", 300, { items, draws:3, random });
  assert.ok(!three.rows.some((row) => row.label === "파랑3"));

  // 스피너는 넓이(가중치)만큼 자주 나온다.
  const spinner = MNBoardTools.simulateTrials("spinner", 800, { items:[{ label:"A", value:3 }, { label:"B", value:1 }], random });
  assert.ok(Math.abs(spinner.rows[0].value / 800 - 0.75) < 0.06);

  const law = MNBoardTools.runningRatioGroup("coin", 400, { random, target:"앞" });
  assert.equal(law.educationLabel, "큰 수의 법칙");
  const text = law.items.filter((item) => item.type === "text").map((item) => item.text);
  assert.ok(text.includes("이론값 0.5"));
  assert.ok(text.some((line) => /^400회 뒤 0\.\d+ \(\d+회\)$/.test(line)));
  assert.ok(law.items.some((item) => item.type === "line" && Array.isArray(item.dash)));
  // 이론값을 모르는 실험(여러 개 뽑기)은 점선 없이 곡선만 그린다.
  const unknown = MNBoardTools.runningRatioGroup("bag", 200, { items, draws:2, target:"빨강1·파랑1", random });
  assert.ok(!unknown.items.some((item) => item.type === "line" && Array.isArray(item.dash)));
});

test("회로 계산은 합성저항·전체 전류와 저항마다의 값을 구한다", () => {
  const textOf = (group) => group.items.filter((item) => item.type === "text").map((item) => item.text);
  // 직렬 6+3+2 = 11Ω, I = 12/11 ≒ 1.09A, 전압은 저항에 비례해 나뉜다
  const series = textOf(MNBoardTools.circuitGroup({ mode:"series", resistors:"6, 3, 2", voltage:12 }));
  assert.ok(series.includes("직렬회로 · R = 6 + 3 + 2 = 11Ω"));
  assert.ok(series.includes("전체 전류 I = V ÷ R = 12 ÷ 11 = 1.09A"));
  assert.ok(series.includes("6.55V") && series.includes("3.27V") && series.includes("2.18V"));
  // 병렬 6∥3 = 2Ω, 가지 전류 2A + 4A = 6A
  const parallel = textOf(MNBoardTools.circuitGroup({ mode:"parallel", resistors:"6, 3", voltage:12 }));
  assert.ok(parallel.includes("병렬회로 · 1/R = 1/6 + 1/3 → R = 2Ω"));
  assert.ok(parallel.includes("2A") && parallel.includes("4A"));
  assert.ok(parallel.includes("전체 전류 I = V ÷ R = 12 ÷ 2 = 6A"));
  assert.deepEqual(MNBoardTools.parseResistors("6, 3, 2"), [6, 3, 2]);
  assert.throws(() => MNBoardTools.circuitGroup({ resistors:"0" }), (error) => /0보다 커야/.test(error.message));
  assert.throws(() => MNBoardTools.circuitGroup({ resistors:"" }), (error) => /저항 값을 적어/.test(error.message));
  assert.throws(() => MNBoardTools.circuitGroup({ resistors:"1,2,3,4,5,6" }), (error) => /다섯 개까지/.test(error.message));
});

test("차트·그래프 항목은 공용 렌더러가 그릴 수 있는 종류만 쓴다", () => {
  const drawable = new Set(["line", "arrow", "rect", "ellipse", "polyline", "text", "image", "group"]);
  const groups = [
    MNBoardTools.plotGroup({ curves:[{ source:"x^2" }], xMin:-4, xMax:4 }),
    MNBoardTools.plotGroup({ curves:[{ source:"a x", relation:"gt" }], params:{ a:2 }, showIntersections:true, tangentX:1, areaFrom:0, areaTo:2 }),
    MNBoardTools.chartGroup({ type:"bar", data:"가, 3\n나, 6" }),
    MNBoardTools.chartGroup({ type:"pie", data:"가, 3\n나, 6" }),
    MNBoardTools.chartGroup({ type:"box", data:"3\n6\n9\n12" }),
    MNBoardTools.valueTableGroup({ curves:[{ source:"x^2" }], from:-2, to:2, step:1 }),
    MNBoardTools.statsSummaryGroup({ data:"3\n6\n9" }),
    MNBoardTools.frequencyTableGroup({ data:"3\n6\n9\n12" }),
    MNBoardTools.fractionModelGroup({ shape:"circle", fractions:"3/4" }),
    MNBoardTools.placeValueGroup({ value:1347 }),
    MNBoardTools.numberLineJumpGroup({ from:0, to:20, start:2, step:3, jumps:3 }),
    MNBoardTools.balanceScaleGroup({ leftX:2, leftOne:3, rightX:0, rightOne:11 }),
    MNBoardTools.vectorSumGroup({ x1:0, y1:0, x2:80, y2:0 }, { x1:0, y1:0, x2:0, y2:-60 }),
    MNBoardTools.opticsGroup({ kind:"concave-mirror", focal:4, distance:6, height:2 }),
    MNBoardTools.punnettGroup({ parentA:"AaBb", parentB:"Aabb" }),
    MNBoardTools.circuitGroup({ mode:"parallel", resistors:"6, 3", voltage:12 }),
    MNBoardTools.runningRatioGroup("dice", 120, { target:"6" })
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

test("화학량론은 균형 반응식과 한 물질의 양으로 나머지 물질의 몰수·질량을 구한다", () => {
  assert.equal(MNBoardTools.molarMass("H2O").toFixed(3), "18.015");
  assert.equal(MNBoardTools.molarMass("Ca(OH)2").toFixed(3), "74.092");
  assert.throws(() => MNBoardTools.molarMass("Xx2"), (error) => /모르는 원소/.test(error.message));

  // CH₄ 8g(≈0.4987mol) → O₂ 2배, CO₂ 같은 몰수, H₂O 2배
  const result = MNBoardTools.stoichiometry("CH4 + O2 -> CO2 + H2O", { species:0, amount:8, unit:"g" });
  assert.deepEqual(result.rows.map((row) => row.coefficient), [1, 2, 1, 2]);
  assert.deepEqual(result.rows.map((row) => row.side), ["반응물", "반응물", "생성물", "생성물"]);
  assert.equal(result.rows[0].moles.toFixed(4), "0.4987");
  assert.equal(result.rows[1].moles / result.rows[0].moles, 2);            // 계수비 그대로
  assert.equal(result.rows[2].grams.toFixed(2), "21.95");
  assert.equal(result.rows[0].grams.toFixed(2), "8.00");     // 아는 양은 그대로 돌아온다

  // 화학식으로 골라도 되고, 몰 단위로 줘도 된다.
  const byName = MNBoardTools.stoichiometry("H2 + O2 -> H2O", { species:"H2O", amount:2, unit:"mol" });
  assert.deepEqual(byName.rows.map((row) => row.moles), [2, 1, 2]);
  assert.throws(() => MNBoardTools.stoichiometry("H2 + O2 -> H2O", { species:"NaCl", amount:1 }), (error) => /반응식에 없는/.test(error.message));
  assert.throws(() => MNBoardTools.stoichiometry("H2 + O2 -> H2O", { species:0, amount:0 }), (error) => /0보다 큰/.test(error.message));
  assert.throws(() => MNBoardTools.stoichiometry("H2O", { species:0, amount:1 }), (error) => /화살표/.test(error.message));

  const group = MNBoardTools.stoichiometryGroup("CH4 + O2 -> CO2 + H2O", { species:0, amount:8, unit:"g" });
  const text = group.items.filter((item) => item.type === "text").map((item) => item.text);
  assert.equal(group.role, "education-table");
  assert.deepEqual(group.tableSpec, { kind:"stoichiometry", equation:"CH4 + O2 -> CO2 + H2O", species:0, amount:8, unit:"g", color:"#111111" });
  assert.ok(text.includes("CH₄ + 2O₂ → CO₂ + 2H₂O"), "제목은 균형을 맞춘 반응식");
  assert.ok(text.includes("CH₄ ◀ 아는 양"));
  assert.ok(text.includes("21.95"));
  for (const head of ["물질", "계수", "몰질량(g/mol)", "몰수(mol)", "질량(g)"]) assert.ok(text.includes(head), head);
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
  assert.match(whiteboardSource, /drawItem\(isMeasureItem\(it\) \? \(liveMeasureItem\(it\) \|\| it\) : isVectorSumItem\(it\) \? \(liveVectorSumItem\(it\) \|\| it\) : it\)/);
  assert.match(whiteboardSource, /const recordCommit = \(\) => \{\s*\n\s*syncMeasureItems\(\);/);
  assert.match(whiteboardSource, /const boardSnapshot = \(\) => \(syncMeasureItems\(\),/);
  // 잰 도형을 지우면 라벨도 함께 사라지고, 원본을 대신하는 변환은 이름표를 물려받는다.
  assert.match(whiteboardSource, /const label = measureLabelOf\(selected\), sums = vectorSumsFor\(selected\);/);
  assert.match(whiteboardSource, /if \(selected\.mid\) moved\.mid = selected\.mid; else delete moved\.mid;/);
  assert.match(whiteboardSource, /\["chemistry", "화학"\]/);
  assert.match(whiteboardSource, /MNBoardTools\.balanceEquation\(source\)/);
  assert.match(whiteboardSource, /MNBoardTools\.elementCardGroup\(element, wb\.color\)/);
  assert.match(whiteboardSource, /MNBoardTools\.simulateTrials\(kind, Number\(simCount\.value\)/);
  // 보드 위 슬라이더는 교구 손잡이 다음, 판서보다 먼저 잡는다(그래프 위로 선이 그어지면 안 된다).
  assert.match(whiteboardSource, /const sliderHit = plotSliderHitAt\(lastBoardPointer\);\s*\n\s*if \(sliderHit\)\{ beginSliderDrag\(e, sliderHit\); return; \}/);
  // 끄는 동안은 되돌리기 칸을 만들지 않고 손을 뗄 때 한 번만 남긴다.
  assert.match(whiteboardSource, /if \(state\.changed\)\{ history\.commit\(\); recordCommit\(\); \}/);
  // 표(값의 표·요약 카드·도수분포표·몰 계산표)도 두 번 눌러 다시 고칠 수 있다.
  assert.match(whiteboardSource, /item\.role === "education-table" && item\.tableSpec/);
  assert.match(whiteboardSource, /MNBoardTools\.valueTableGroup\(readValueTableSpec\(\)\)/);
  assert.match(whiteboardSource, /MNBoardTools\.statsSummaryGroup\(/);
  assert.match(whiteboardSource, /MNBoardTools\.frequencyTableGroup\(/);
  assert.match(whiteboardSource, /MNBoardTools\.stoichiometryGroup\(chemInput\.value, readStoichiometrySpec\(\)\)/);
  assert.match(whiteboardSource, /\["box", "상자그림"\]/);
  // 값을 넣어 만드는 도구 탭(수 모형·과학 계산)과 그 도구들.
  assert.match(whiteboardSource, /\["number", "수 모형"\], \["lab", "과학 계산"\]/);
  for (const call of ["fractionModelGroup", "placeValueGroup", "numberLineJumpGroup", "balanceScaleGroup",
    "opticsGroup", "punnettGroup", "circuitGroup", "runningRatioGroup"]){
    assert.match(whiteboardSource, new RegExp(`MNBoardTools\\.${call}\\(`), call);
  }
  assert.match(whiteboardSource, /item\.role === "education-tool" && item\.toolSpec/);
  // 합력은 원본 화살표에서 다시 계산하는 파생 항목 — 그리기·저장·지우기 접점이 모두 있어야 한다.
  assert.match(whiteboardSource, /if \(syncVectorSumItems\(\)\) dropped = true;/);
  assert.match(whiteboardSource, /const tipHit = arrowTipAt\(lastBoardPointer\);/);
  assert.match(whiteboardSource, /if \(isVectorSumItem\(it\)\) continue;/);        // 합력은 클릭으로 고르지 않는다
});
