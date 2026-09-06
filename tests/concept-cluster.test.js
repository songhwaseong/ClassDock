"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("../src/js/concept-doc.js");
const nodesFor = ids => ids.map(id => c.conceptNormalizeNode({ id, title:id }));
const positions = nodes => Object.fromEntries(nodes.map(({ id, x, y }) => [id, { x, y }]));
const groups = (nodes, edges, options) => c.conceptClusterGroups(nodes, edges, options).map(group => group.map(node => node.id));
function fixture(){
  const nodes = nodesFor(["a","b","c","d","e","f"]), edges = [];
  for (const group of ["abc","def"]) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) edges.push({ from:group[i], to:group[j], weight:5 });
  edges.push({ from:"c", to:"d", weight:1 }); return { nodes, edges };
}
function assertClear(nodes){
  for (let i = 0; i < nodes.length; i++){
    const a = nodes[i]; assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && a.x >= 20 && a.y >= 20 && a.x <= 30000 && a.y <= 30000);
    for (let j = i + 1; j < nodes.length; j++){
      const b = nodes[j]; if (a.pinned && b.pinned) continue;
      assert.ok(Math.abs(a.x - b.x) >= 249.99 || Math.abs(a.y - b.y) >= 187.99, `겹침: ${a.id}, ${b.id}`);
    }
  }
}
test("약한 다리로 연결된 두 밀집 집단은 다른 군집과 공간으로 배치된다", () => {
  const { nodes, edges } = fixture();
  assert.deepEqual(groups(nodes, edges), [["a","b","c"],["d","e","f"]]);
  const laid = c.conceptAutoLayout(nodes, edges, { mode:"cluster" }); assertClear(laid);
  const left = laid.filter(node => "abc".includes(node.id)), right = laid.filter(node => "def".includes(node.id));
  assert.ok(Math.min(...right.map(node => node.x)) - Math.max(...left.map(node => node.x + 230)) >= 180);
});
test("군집은 강한 연결을 바꾸면 달라지고 강도 미반영은 같은 결과를 만든다", () => {
  const nodes = nodesFor(["a","b","c","d"]), edges = [{ from:"a", to:"b", weight:5 }, { from:"c", to:"d", weight:5 }, { from:"a", to:"c", weight:1 }, { from:"b", to:"d", weight:1 }];
  const flipped = edges.map(edge => ({ ...edge, weight:6 - edge.weight }));
  assert.deepEqual(groups(nodes,edges),[["a","b"],["c","d"]]);
  assert.deepEqual(groups(nodes,flipped),[["a","c"],["b","d"]]);
  assert.deepEqual(c.conceptAutoLayout(nodes,edges,{mode:"cluster",weighted:false}),c.conceptAutoLayout(nodes,flipped,{mode:"cluster",weighted:false}));
});
test("군집은 입력 순서·좌표·중복과 무관하게 재현되며 고립 카드도 보존한다", () => {
  const { nodes, edges } = fixture(); nodes.push(...nodesFor(["solo"])); const before = JSON.stringify({ nodes, edges });
  const laid = c.conceptAutoLayout(nodes,edges,{mode:"cluster"});
  assert.deepEqual(positions(c.conceptAutoLayout([...nodes].reverse(),[...edges].reverse(),{mode:"cluster"})),positions(laid));
  assert.deepEqual(positions(c.conceptAutoLayout(laid,edges,{mode:"cluster"})),positions(laid));
  assert.deepEqual(groups(nodes,[...edges,edges[0],{from:"a",to:"a"},{from:"a",to:"missing"}]),groups(nodes,edges));
  assert.equal(JSON.stringify({ nodes, edges }),before); assertClear(laid);
  assert.deepEqual(c.conceptAutoLayout([],[],{mode:"cluster"}),[]);
  assertClear(c.conceptAutoLayout(nodesFor(["a","b","c"]),[],{mode:"cluster"}));
});
test("위치 고정은 구형 문서 기본값·JSON 저장·재가져오기에서 유지된다", () => {
  const { nodes, edges } = fixture(); nodes[0].pinned = true; nodes[0].x = 1450; nodes[0].y = 720;
  const model = c.conceptDocParse({ ...c.conceptDocEmpty("pin"), layoutStyle:"cluster", nodes, edges });
  const restored = c.conceptDocParse(c.conceptDocSerialize(model)); assert.deepEqual(restored,model);
  assert.equal(c.conceptNormalizeNode({title:"old"}).pinned,false); assert.equal(c.conceptNormalizeNode({title:"string",pinned:"false"}).pinned,false);
  const merged = c.conceptMergeGraph(restored,c.conceptOutlineParse("a\n\tb"));
  assert.equal(merged.nodes[0].pinned,true); assert.equal(merged.nodes[0].x,1450); assert.equal(merged.nodes[0].y,720);
});
test("모든 자동정렬에서 고정 카드 좌표는 그대로이고 나머지는 겹치지 않는다", () => {
  const { nodes, edges } = fixture(); nodes[0].pinned = true; nodes[0].x = 1234; nodes[0].y = 567;
  for (const { id:mode } of c.CONCEPT_LAYOUTS) for (const spacing of ["tight","normal","wide"]){
    const laid = c.conceptAutoLayout(nodes,edges,{mode,spacing});
    assert.deepEqual(laid.find(node => node.id === "a"),nodes[0],mode); assertClear(laid);
  }
});
test("고정 카드가 서로 겹치거나 좌표 끝에 있어도 고정을 우선한다", () => {
  const nodes = nodesFor(Array.from({length:25},(_,i)=>"n"+String(i).padStart(2,"0")));
  for (const corner of [20,30000]){
    nodes[0].pinned = nodes[1].pinned = true; nodes[0].x = nodes[1].x = corner; nodes[0].y = nodes[1].y = corner;
    for (const mode of ["cluster","weighted","focus","grid"]){
      const laid = c.conceptAutoLayout(nodes,[],{mode}); assertClear(laid);
      assert.deepEqual(laid.slice(0,2),nodes.slice(0,2));
    }
  }
  const allPinned = nodes.map(node=>({...node,pinned:true}));
  assert.deepEqual(c.conceptAutoLayout(allPinned,[],{mode:"cluster"}),allPinned);
});
test("군집별 고정 카드 주변에 나머지를 배치하고 고정 해제하면 다시 정렬된다", () => {
  const { nodes, edges } = fixture(); nodes[0].pinned = true; nodes[0].x = 1400; nodes[0].y = 1700; nodes[3].pinned = true; nodes[3].x = 6100; nodes[3].y = 4400;
  const laid = c.conceptAutoLayout(nodes,edges,{mode:"cluster"}); assertClear(laid);
  for (const [anchor,member] of [["a","b"],["a","c"],["d","e"],["d","f"]]){
    const a=laid.find(node=>node.id===anchor),b=laid.find(node=>node.id===member); assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1000);
  }
  assert.deepEqual(positions(c.conceptAutoLayout(laid,edges,{mode:"cluster"})),positions(laid));
  const released = c.conceptAutoLayout(laid.map(node=>({...node,pinned:false})),edges,{mode:"cluster"});
  assert.notDeepEqual(positions(released),positions(laid)); assertClear(released);
});
test("최대 300개 카드·800개 관계의 군집과 고정 조합도 좌표 범위와 간격을 지킨다", () => {
  const nodes = nodesFor(Array.from({length:300},(_,i)=>"n"+String(i).padStart(3,"0"))), edges=[];
  for(let i=0;i<800;i++)edges.push({from:nodes[i%300].id,to:nodes[(i%300+1+Math.floor(i/300)*7)%300].id,weight:i%5+1});
  assertClear(c.conceptAutoLayout(nodes,edges,{mode:"cluster",spacing:"tight"}));
  nodes[0].pinned=true;nodes[0].x=30000;nodes[0].y=30000;nodes[150].pinned=true;nodes[150].x=20;nodes[150].y=20;
  assertClear(c.conceptAutoLayout(nodes,edges,{mode:"cluster",spacing:"wide"}));
});
