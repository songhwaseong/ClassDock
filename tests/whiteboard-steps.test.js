"use strict";

// 화이트보드 단계 발표: 항목의 step 번호 규칙, 여러 개를 읽는 순서대로 매기기,
// 메모 왕복(스냅샷)에서 단계 번호가 살아남는지, 화면·녹화·선택이 같은 판정을 쓰는지를 고정한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  whiteboardItemStep, whiteboardWithStep, whiteboardStepValues, whiteboardReadingOrder,
  boardStateFromSnapshot
} = require("../src/js/whiteboard.js");

const source = fs.readFileSync(path.join(__dirname, "../src/js/whiteboard.js"), "utf8");

test("단계 번호는 1 이상 정수만 인정하고 나머지는 늘 보이는 0 이다", () => {
  assert.equal(whiteboardItemStep({ step:3 }), 3);
  assert.equal(whiteboardItemStep({ step:"2" }), 2);
  assert.equal(whiteboardItemStep({ step:2.7 }), 2);
  assert.equal(whiteboardItemStep({ step:0 }), 0);
  assert.equal(whiteboardItemStep({ step:-1 }), 0);
  assert.equal(whiteboardItemStep({ step:"abc" }), 0);
  assert.equal(whiteboardItemStep({}), 0);
  assert.equal(whiteboardItemStep(null), 0);
  assert.equal(whiteboardItemStep({ step:500 }), 99);
});

test("단계를 바꾸면 사본을 돌려주고, 같으면 원본 그대로다(되돌리기 스냅샷 보호)", () => {
  const item = { type:"rect", x1:0, y1:0, x2:10, y2:10 };
  const stepped = whiteboardWithStep(item, 2);
  assert.notEqual(stepped, item);
  assert.equal(stepped.step, 2);
  assert.equal(item.step, undefined);
  assert.equal(whiteboardWithStep(stepped, 2), stepped);
  const cleared = whiteboardWithStep(stepped, 0);
  assert.equal("step" in cleared, false);
  assert.equal(whiteboardWithStep(item, 0), item);
});

test("쓰인 단계 번호만 작은 것부터 한 번씩 센다(띄엄띄엄 번호도 차례로 밟는다)", () => {
  const items = [{ step:3 }, {}, { step:1 }, { step:3 }, { step:7 }];
  assert.deepEqual(whiteboardStepValues(items), [1, 3, 7]);
  assert.deepEqual(whiteboardStepValues([]), []);
  // 측정값처럼 남을 따라가는 항목은 stepOf 로 셈한다.
  assert.deepEqual(whiteboardStepValues([{ follow:5 }, { step:2 }], (it) => it.follow || it.step || 0), [2, 5]);
});

test("차례로 매기기는 위 줄부터, 한 줄 안에서는 왼쪽부터다", () => {
  const box = (x, y, w=80, h=30) => ({ x, y, w, h });
  // ①② / ③④ 두 줄 배치를 섞어서 넘긴다. ②는 ①보다 살짝 위에 있어도 같은 줄이다.
  const entries = [
    { id:"④", box:box(200, 100) },
    { id:"①", box:box(0, 42) },
    { id:"③", box:box(0, 100) },
    { id:"②", box:box(200, 38) }
  ];
  assert.deepEqual(whiteboardReadingOrder(entries).map((e) => e.id), ["①", "②", "③", "④"]);
  // 세로로 늘어놓은 보기
  const column = [{ id:"c", box:box(0, 200) }, { id:"a", box:box(0, 0) }, { id:"b", box:box(4, 100) }];
  assert.deepEqual(whiteboardReadingOrder(column).map((e) => e.id), ["a", "b", "c"]);
  assert.deepEqual(whiteboardReadingOrder([{ id:"x", box:null }]), []);
});

test("메모로 보낸 스냅샷을 다시 열어도 단계 번호가 그대로 남는다", () => {
  const snapshot = JSON.parse(JSON.stringify({
    version:1,
    bg:"#ffffff",
    items:[
      { type:"text", x:10, y:10, text:"문제", fontSize:20 },
      { type:"text", x:10, y:50, text:"① 보기", fontSize:20, step:1 },
      { type:"group", x:10, y:90, w:100, h:40, sourceW:100, sourceH:40, step:2, items:[] }
    ]
  }));
  const state = boardStateFromSnapshot(snapshot);
  assert.deepEqual(state.items.map(whiteboardItemStep), [0, 1, 2]);
  assert.deepEqual(whiteboardStepValues(state.items), [1, 2]);
});

test("화면·선택·녹화가 모두 같은 '보이는 항목' 판정을 쓴다", () => {
  // 그리기
  assert.match(source, /const shown = shownItemTest\(\);\s*for \(const it of wb\.items\)\{\s*if \(it === editingTextItem \|\| !shown\(it\)\) continue;/);
  // 클릭으로 고르기 — 두 번의 훑기 모두
  assert.match(source, /!isVectorSumItem\(it\) && shown\(it\) && hitTestBoardItem\(it, p, measureBoardText, tol, true\)/);
  assert.match(source, /isVectorSumItem\(it\) \|\| !shown\(it\) \|\| !hitTestBoardItem\(it, p, measureBoardText, tol\)/);
  // 끌어서 고르기·모두 고르기
  assert.match(source, /const inside = wb\.items\.filter\(\(it\) => \{\s*if \(!shown\(it\)\) return false;/);
  assert.match(source, /isSelectableBoardItem\(it\) && shown\(it\)/);
  // 녹화는 지금 보이는 것만
  assert.match(source, /doc\.recorder\.capture\(visibleItems\(\)/);
  assert.match(source, /LessonRecorder\(visibleItems\(\)/);
  assert.match(source, /doc\.recorder\.stop\(visibleItems\(\)/);
  assert.doesNotMatch(source, /doc\.recorder\.capture\(wb\.items/);
});

test("번호표는 편집 중에만 그리고 내보내기·발표에는 넣지 않는다", () => {
  assert.match(source, /const drawStepBadges = \(\) => \{\s*if \(stepView\.active \|\| gearHidden\) return;/);
});

test("묶으면 그룹이 가장 이른 단계를 맡고, 풀면 조각이 그룹 단계를 물려받는다", () => {
  assert.match(source, /group\.items = group\.items\.map\(\(child\) => whiteboardWithStep\(child, 0\)\);\s*if \(groupStep\.length\) group\.step = Math\.min\(\.\.\.groupStep\);/);
  assert.match(source, /ungroupBoardItem\(selected, measureBoardText\)\.map\(\(child\) => whiteboardWithStep\(child, groupStep\)\)/);
});

test("발표 넘기기는 프레젠터 키(PageDown/PageUp)와 화살표·Home/End, Esc 로 끝낸다", () => {
  assert.match(source, /\["PageDown", "PageUp", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"\]\.includes\(e\.key\)/);
  assert.match(source, /e\.key === "Escape" && stepView\.active\)\{[^}]*stopSteps\(\);/);
});

test("단계 발표 단추는 도구 노출 설정에 등록돼 있다", () => {
  const state = fs.readFileSync(path.join(__dirname, "../src/js/state.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.match(state, /id:"wbSteps"[\s\S]*?cls:"wb-toolvis-steps"[\s\S]*?target:"whiteboard"/);
  assert.match(css, /html\.hide-tool-wbSteps \.wb-toolvis-steps/);
  assert.match(source, /stepsGroup\.classList\.add\("wb-toolvis-steps"\)/);
});

test("빈 곳 우클릭의 '단계 모두 빼기'는 한 번 묻고 보드 전체 단계를 되돌리기 한 단계로 뗀다", () => {
  assert.match(source, /contextAction\("단계 모두 빼기",[^)]*clearAllSteps\)/);
  const clearAll = /const clearAllSteps = \(\) => \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(clearAll, "clearAllSteps 를 찾지 못했다");
  assert.match(clearAll[1], /applySteps\(stepped\.map\(\(it\) => \[it, 0\]\)\)/);
  assert.match(clearAll[1], /confirmDialog\(/);
  assert.match(source, /contextShowClearBtn\.disabled=!total;/);
});
