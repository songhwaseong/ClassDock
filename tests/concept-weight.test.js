"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const c = require("../src/js/concept-doc.js");
const vm = require("node:vm");
const nodesFor = ids => ids.map(id => c.conceptNormalizeNode({ id, title:id }));
const distance = (nodes, a, b) => { const left = nodes.find(n => n.id === a), right = nodes.find(n => n.id === b); return Math.hypot(left.x - right.x, left.y - right.y); };
const positions = nodes => Object.fromEntries(nodes.map(({ id, x, y }) => [id, { x, y }]));
function assertClear(nodes){
  for (let i = 0; i < nodes.length; i++){
    assert.ok(Number.isFinite(nodes[i].x) && Number.isFinite(nodes[i].y));
    assert.ok(nodes[i].x >= 20 && nodes[i].x <= 30000 && nodes[i].y >= 20 && nodes[i].y <= 30000);
    for (let j = i + 1; j < nodes.length; j++) assert.ok(Math.abs(nodes[i].x - nodes[j].x) >= 249.99 || Math.abs(nodes[i].y - nodes[j].y) >= 187.99, `겹침: ${nodes[i].id}, ${nodes[j].id}`);
  }
}
test("강도는 1~5로 정규화되고 구형 파일은 보통 3으로 열린다", () => {
  for (const [value, expected] of [[undefined,3],[null,3],["",3],["bad",3],[Infinity,3],[-2,1],[0,1],[8,5],[2.6,3],["4",4]]) assert.equal(c.conceptNormalizeEdge({ weight:value }).weight, expected);
  const model = { ...c.conceptDocEmpty("old"), nodes:nodesFor(["a","b"]), edges:[{ id:"e", from:"a", to:"b", type:"related" }] };
  assert.equal(c.conceptDocParse(model).edges[0].weight, 3);
});
test("강도와 배치 설정은 저장 및 실행 취소용 스냅샷 복원에서 보존된다", () => {
  const model = { ...c.conceptDocEmpty("weights"), layoutStyle:"focus", layoutWeighted:false, layoutInfluence:"strong", showWeights:true, layoutRootId:"b", nodes:nodesFor(["a","b"]), edges:[c.conceptNormalizeEdge({ id:"e", from:"a", to:"b", weight:5 })] };
  model.presentation = c.conceptNormalizePresentation(model.presentation, model.nodes);
  assert.deepEqual(c.conceptDocParse(c.conceptDocSerialize(model)), model);
  assert.deepEqual(c.conceptDocParse(JSON.stringify(model)), model);
  const invalid = c.conceptDocParse({ ...model, layoutRootId:"gone", layoutInfluence:"oops" });
  assert.equal(invalid.layoutRootId, ""); assert.equal(invalid.layoutInfluence, "normal");
});
test("강한 연결은 더 가까워지고 강도 미반영은 값을 바꿔도 같은 배치를 만든다", () => {
  const nodes = nodesFor(["a","b","c"]), edges = [{ from:"a", to:"b", weight:5 }, { from:"a", to:"c", weight:1 }];
  for (const mode of ["weighted","focus"]){
    const laid = c.conceptAutoLayout(nodes, edges, { mode, rootId:"a" });
    assert.ok(distance(laid,"a","b") < distance(laid,"a","c"), mode);
    const changed = edges.map(edge => ({ ...edge, weight:6 - edge.weight }));
    assert.deepEqual(c.conceptAutoLayout(nodes, edges, { mode, weighted:false }), c.conceptAutoLayout(nodes, changed, { mode, weighted:false }));
    const weak = c.conceptAutoLayout(nodes, edges, { mode, influence:"weak" }), strong = c.conceptAutoLayout(nodes, edges, { mode, influence:"strong" });
    assert.ok(distance(strong,"a","c") - distance(strong,"a","b") > distance(weak,"a","c") - distance(weak,"a","b"), mode);
    assertClear(laid);
  }
});
test("중심 집중형은 선택 중심과 간접 연결의 강도를 반영한다", () => {
  const nodes = nodesFor(["a","b","c","d"]), edges = [{ from:"b", to:"a", weight:5 }, { from:"a", to:"c", weight:5 }, { from:"b", to:"d", weight:1 }];
  const laid = c.conceptAutoLayout(nodes, edges, { mode:"focus", rootId:"b" });
  assert.ok(distance(laid,"b","a") < distance(laid,"b","c"));
  assert.ok(distance(laid,"b","c") < distance(laid,"b","d"));
  assertClear(laid);
});
test("새 배치는 이전 좌표·입력 순서와 관계없이 재현되고 원본을 바꾸지 않는다", () => {
  const nodes = nodesFor(["a","b","c","d"]), edges = [{ from:"a", to:"b", weight:5 }, { from:"c", to:"b", weight:2 }], snapshot = JSON.stringify({ nodes, edges });
  for (const mode of ["weighted","focus"]){
    const first = c.conceptAutoLayout(nodes, edges, { mode });
    assert.deepEqual(positions(c.conceptAutoLayout(first, edges, { mode })), positions(first));
    assert.deepEqual(positions(c.conceptAutoLayout([...nodes].reverse(), [...edges].reverse(), { mode })), positions(first));
    assertClear(first);
  }
  assert.equal(JSON.stringify({ nodes, edges }), snapshot);
});
test("빈 관계도·고립 카드·순환·중복·유효하지 않은 연결도 안전하게 정돈한다", () => {
  for (const mode of ["weighted","focus"]){
    assert.deepEqual(c.conceptAutoLayout([], [], { mode }), []);
    assertClear(c.conceptAutoLayout(nodesFor(["solo"]), [], { mode }));
    const nodes = nodesFor(["a","b","c","d","e","f"]), edges = [{ from:"a", to:"b", weight:5 }, { from:"b", to:"c", weight:2 }, { from:"c", to:"a", weight:3 }, { from:"d", to:"e", weight:1 }];
    const laid = c.conceptAutoLayout(nodes, edges, { mode, rootId:"missing" });
    assertClear(laid);
    assert.deepEqual(laid, c.conceptAutoLayout(nodes, [...edges, edges[0], { from:"a", to:"a" }, { from:"a", to:"gone" }], { mode, rootId:"missing" }));
  }
});
test("최대 300개 카드·800개 관계에서도 좁은 간격으로 겹치지 않는다", () => {
  const nodes = nodesFor(Array.from({ length:300 }, (_, i) => "n" + String(i).padStart(3,"0"))), edges = [];
  for (let i = 0; i < 800; i++) edges.push({ from:nodes[i % 300].id, to:nodes[(i % 300 + 1 + Math.floor(i / 300) * 7) % 300].id, weight:i % 5 + 1 });
  for (const mode of ["weighted","focus"]) assertClear(c.conceptAutoLayout(nodes, edges, { mode, spacing:"tight" }));
  const star = nodes.slice(1).map(node => ({ from:nodes[0].id, to:node.id, weight:5 }));
  assertClear(c.conceptAutoLayout(nodes, star, { mode:"focus", spacing:"tight" }));
});
test("CSV 강도는 왕복하며 재가져오기는 기존 관계 강도만 갱신한다", () => {
  const model = { ...c.conceptDocEmpty("table"), nodes:nodesFor(["a","b","solo"]), edges:[c.conceptNormalizeEdge({ id:"e", from:"a", to:"b", type:"include", label:"유지", weight:5 })] };
  const back = c.conceptGraphFromRows(c.conceptCsvRows(c.conceptGraphToCsv(model)));
  assert.equal(back.edges[0].weight, 5); assert.equal(back.nodes.length, 3);
  const incoming = c.conceptGraphFromRows(c.conceptCsvRows("개념,대상,관계,강도\na,b,상위,2\n"));
  const merged = c.conceptMergeGraph(model, incoming);
  assert.equal(merged.edges.length, 1); assert.equal(merged.edges[0].weight, 2); assert.equal(merged.edges[0].label,"유지"); assert.equal(merged.edges[0].id,"e"); assert.equal(merged.updatedEdges,1); assert.equal(model.edges[0].weight,5);
  for (const csv of ["개념,대상,관계\na,b,상위\n", "개념,대상,관계,강도\na,b,상위,\n", "개념,대상,관계,강도\na,b,상위,invalid\n"]){
    assert.equal(c.conceptMergeGraph(model,c.conceptGraphFromRows(c.conceptCsvRows(csv))).edges[0].weight,5);
  }
  assert.equal(c.conceptMergeGraph(model,c.conceptOutlineParse("a\n\tb")).edges[0].weight,5);
  assert.equal(c.conceptGraphFromRows(c.conceptCsvRows("개념,상위,가중치\na,,\nb,a,4")).edges[0].weight,4);
});
test("강도 변경과 정렬은 실행 취소·다시 실행으로 좌표와 설정까지 복원된다", () => {
  const context = { setTimeout, clearTimeout }; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/js/history.js"),"utf8") + ";globalThis.historyApi = MNEditHistory;", context);
  let model = c.conceptDocParse({ ...c.conceptDocEmpty("history"), nodes:nodesFor(["a","b","c"]), edges:[{ id:"e", from:"a", to:"b", weight:3 }] });
  const history = context.historyApi.create({ capture:() => JSON.stringify(model), apply:snapshot => { model = c.conceptDocParse(snapshot); }, isEqual:(a,b) => a === b });
  history.reset(); const before = JSON.stringify(model);
  model.edges[0].weight = 5; model.nodes[0].pinned = true; history.commit(); const edited = JSON.stringify(model);
  model.layoutStyle = "focus"; model.layoutRootId = "b"; model.layoutInfluence = "strong"; model.showWeights = true;
  model.nodes = c.conceptAutoLayout(model.nodes, model.edges, { mode:"focus", rootId:"b", influence:"strong" }); history.commit(); const arranged = JSON.stringify(model);
  history.undo(); assert.equal(JSON.stringify(model), edited);
  history.undo(); assert.equal(JSON.stringify(model), before);
  history.redo(); history.redo(); assert.equal(JSON.stringify(model), arranged);
});
