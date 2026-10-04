const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/js/board-render.js"), "utf8");
const context = {};
vm.runInNewContext(source + "\nthis.renderer = MNBoardRenderer;", context);
const renderer = context.renderer;

test("배경 그림은 저장된 항목 상자 대신 현재 화면 영역에 맞춰진다", () => {
  const calls = [];
  const ctx = {
    globalAlpha:1,
    save(){}, restore(){},
    drawImage(...args){ calls.push(args.slice(1)); }
  };
  const img = { complete:true, naturalWidth:800, naturalHeight:800 };
  const area = { x:0, y:0, w:1000, h:500 };

  renderer.drawBackgroundImage(ctx, { img, fit:"cover", opacity:1, x:90, y:80, w:10, h:10 }, area);
  assert.deepEqual(calls.pop(), [0, 200, 800, 400, 0, 0, 1000, 500]);

  renderer.drawBackgroundImage(ctx, { img, fit:"contain", opacity:1, x:90, y:80, w:10, h:10 }, area);
  assert.deepEqual(calls.pop(), [250, 0, 500, 500]);
});

test("화이트보드 선택 판정은 도형·선·텍스트를 구분한다", () => {
  const measure = (line, size) => String(line).length * size * 0.5;
  assert.equal(renderer.hitTestItem({ type:"rect", x1:10, y1:20, x2:110, y2:80, width:2 }, { x:50, y:50 }, measure, 7), true);
  assert.equal(renderer.hitTestItem({ type:"ellipse", x1:10, y1:20, x2:110, y2:80, width:2 }, { x:60, y:50 }, measure, 7), true);
  assert.equal(renderer.hitTestItem({ type:"line", x1:10, y1:10, x2:100, y2:100, width:2 }, { x:52, y:49 }, measure, 7), true);
  assert.equal(renderer.hitTestItem({ type:"text", x:30, y:40, text:"수업", fontSize:20 }, { x:45, y:50 }, measure, 7), true);
  assert.equal(renderer.hitTestItem({ type:"text", x:30, y:40, text:"수업", fontSize:20 }, { x:200, y:200 }, measure, 7), false);
});

test("화이트보드 항목 이동은 원본을 바꾸지 않고 좌표를 함께 옮긴다", () => {
  const rect = { type:"rect", x1:10, y1:20, x2:50, y2:60, color:"#111" };
  const movedRect = renderer.translateItem(rect, 12, -5);
  assert.notEqual(movedRect, rect);
  assert.deepEqual([movedRect.x1, movedRect.y1, movedRect.x2, movedRect.y2], [22, 15, 62, 55]);
  assert.deepEqual([rect.x1, rect.y1, rect.x2, rect.y2], [10, 20, 50, 60]);

  const text = { type:"text", x:5, y:8, text:"안내", fontSize:16 };
  const movedText = renderer.translateItem(text, -2, 9);
  assert.deepEqual([movedText.x, movedText.y], [3, 17]);
  assert.deepEqual([text.x, text.y], [5, 8]);
});

test("교육 도형 그룹은 한 덩어리로 선택·이동하고 현재 크기의 독립 벡터로 풀린다", () => {
  const group = {
    type:"group", x:100, y:50, w:240, h:95, sourceW:120, sourceH:95,
    items:[
      { type:"line", x1:0, y1:10, x2:120, y2:10, color:"#111", width:2 },
      { type:"text", x:30, y:20, text:"x", fontSize:20, color:"#111" },
      { type:"polyline", points:[{x:0,y:40},{x:60,y:80},{x:120,y:40}], color:"#111", width:3 }
    ]
  };
  const bounds = renderer.itemBounds(group);
  assert.deepEqual([bounds.x,bounds.y,bounds.w,bounds.h], [100,50,240,95]);
  assert.equal(renderer.hitTestItem(group, { x:200, y:80 }, null, 7), true);
  const moved = renderer.translateItem(group, 15, -5);
  assert.deepEqual([moved.x,moved.y], [115,45]);
  assert.deepEqual([group.x,group.y], [100,50]);

  const parts = renderer.ungroupItem(group);
  assert.equal(parts.length, 3);
  assert.deepEqual([parts[0].x1,parts[0].y1,parts[0].x2,parts[0].y2], [100,60,340,60]);
  assert.deepEqual([parts[1].x,parts[1].y,parts[1].fontSize], [160,70,30]);
  assert.deepEqual(Array.from(parts[2].points, (p) => [p.x,p.y]), [[100,90],[220,130],[340,90]]);
  assert.deepEqual(group.items[2].points.map((p) => [p.x,p.y]), [[0,40],[60,80],[120,40]]);
});

test("반전한 교육 도형을 풀면 도형 좌표는 뒤집히고 글자는 읽는 방향을 유지한다", () => {
  const group = {
    type:"group", x:100, y:50, w:240, h:95, sourceW:120, sourceH:95, flipX:true,
    items:[
      { type:"arrow", x1:0, y1:10, x2:120, y2:10, color:"#111", width:2 },
      { type:"text", x:30, y:20, text:"x", fontSize:20, color:"#111" },
      { type:"polyline", points:[{x:0,y:40},{x:60,y:80},{x:120,y:40}], color:"#111", width:3 }
    ]
  };
  const parts = renderer.ungroupItem(group, (line, size) => String(line).length * size * .5);
  assert.deepEqual([parts[0].x1,parts[0].x2], [340,100]);
  assert.deepEqual([parts[1].x,parts[1].y,parts[1].fontSize], [260,70,30]);
  assert.equal(parts[1].flipX, undefined);
  assert.deepEqual(Array.from(parts[2].points, (p) => [p.x,p.y]), [[340,90],[220,130],[100,90]]);
});

test("그룹을 푼 회전 타원과 폴리라인도 선택 판정할 수 있다", () => {
  const ellipse = { type:"ellipse", x1:20,y1:40,x2:120,y2:80,rotation:Math.PI/4,color:"#111",width:2 };
  assert.equal(renderer.hitTestItem(ellipse,{x:70,y:60},null,5),true);
  const poly = { type:"polyline",points:[{x:0,y:0},{x:50,y:50},{x:100,y:0}],color:"#111",width:2 };
  assert.equal(renderer.hitTestItem(poly,{x:48,y:51},null,5),true);
  assert.equal(renderer.hitTestItem(poly,{x:50,y:80},null,5),false);
});

test("벡터 그룹 렌더링은 캔버스 변환 안에서 자식 도형을 순서대로 그린다", () => {
  const calls = [];
  const ctx = {
    save:()=>calls.push("save"), restore:()=>calls.push("restore"),
    translate:(x,y)=>calls.push(["translate",x,y]), scale:(x,y)=>calls.push(["scale",x,y]),
    setLineDash:(v)=>calls.push(["dash",...v]), beginPath:()=>calls.push("begin"),
    moveTo:(x,y)=>calls.push(["move",x,y]), lineTo:(x,y)=>calls.push(["line",x,y]),
    stroke:()=>calls.push("stroke"), fill:()=>calls.push("fill"), closePath:()=>calls.push("close"),
    strokeRect:()=>{}, fillRect:()=>{}, ellipse:()=>{}, fillText:()=>{}, drawImage:()=>{}
  };
  renderer.drawItem(ctx, { type:"group",x:10,y:20,w:200,h:100,sourceW:100,sourceH:100,items:[
    { type:"polyline",points:[{x:0,y:0},{x:100,y:50}],color:"#111",width:2 },
    { type:"ellipse",x1:20,y1:20,x2:40,y2:40,color:"#111",width:2,fill:true }
  ]}, "#fff");
  assert.deepEqual(calls[0], "save");
  assert.deepEqual(calls[1], ["translate",10,20]);
  assert.deepEqual(calls[2], ["scale",2,1]);
  assert.ok(calls.includes("stroke"));
  assert.ok(calls.includes("fill"));
  assert.equal(calls.at(-1), "restore");
});

test("반전 그룹 렌더링은 그룹만 뒤집고 내부 글자 방향은 다시 바로 세운다", () => {
  const calls = [];
  const ctx = {
    save:()=>calls.push("save"), restore:()=>calls.push("restore"),
    translate:(x,y)=>calls.push(["translate",x,y]), scale:(x,y)=>calls.push(["scale",x,y]),
    setLineDash:()=>{}, fillText:(text,x,y)=>calls.push(["text",text,x,y]), measureText:()=>({width:10})
  };
  renderer.drawItem(ctx, { type:"group",x:10,y:20,w:200,h:100,sourceW:100,sourceH:100,flipX:true,items:[
    { type:"text",x:20,y:30,text:"L",fontSize:20,color:"#111" }
  ]}, "#fff");
  assert.deepEqual(calls.slice(0,5), ["save",["translate",10,20],["scale",2,1],["translate",100,0],["scale",-1,1]]);
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === "translate" && call[1] === 50));
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === "scale" && call[1] === -1 && call[2] === 1));
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === "text" && call[1] === "L"));
});

test("칠판 질감 타일은 고정 씨앗으로 만들고 가장자리가 반대편과 이어진다", () => {
  const n = 256;
  const fields = renderer.chalkTextureFields(n, 7);
  assert.equal(fields.size, n);
  assert.equal(fields.light.length, n * n);
  assert.equal(fields.dark.length, n * n);
  // 같은 씨앗은 같은 결(리플레이·내보내기가 편집 화면과 같아야 한다), 다른 씨앗은 다른 결.
  assert.equal(renderer.chalkTextureFields(n, 7), fields);
  const other = renderer.chalkTextureFields(n, 8);
  assert.ok(other.light.some((value, i) => value !== fields.light[i]));
  // 가루층은 판 전체를 덮지 않는다 — 옅은 안개 위에 군데군데 짙은 지우개 자국.
  let sum = 0, max = 0;
  for (const value of fields.light){ sum += value; if (value > max) max = value; }
  const mean = sum / fields.light.length;
  assert.ok(mean > 5 && mean < 80, "가루층 평균 " + mean);
  assert.ok(max > mean * 2, "지우개 자국이 안개보다 짙어야 한다");
  // 반복 이음매: 마지막 열→첫 열 차이가 이웃한 열끼리의 차이와 비슷해야 한다.
  const column = (x) => { let s = 0; for (let y = 0; y < n; y++) s += fields.light[y * n + x]; return s / n; };
  let neighbor = 0;
  for (let x = 1; x < n; x++) neighbor += Math.abs(column(x) - column(x - 1));
  neighbor /= n - 1;
  assert.ok(Math.abs(column(0) - column(n - 1)) < neighbor * 4 + 1);
});

test("칠판 질감은 그릴 캔버스가 없으면 조용히 건너뛴다", () => {
  const calls = [];
  const ctx = { save(){}, restore(){}, fillRect(){ calls.push("fill"); } };
  renderer.drawPattern(ctx, { id:"chalk", size:100, opacity:.7, color:"" }, { x:0, y:0, w:100, h:100 }, "#2c4639");
  assert.deepEqual(calls, []);
});
