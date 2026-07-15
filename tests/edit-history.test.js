const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHistory(){
  const source = fs.readFileSync(path.join(__dirname, "../src/js/history.js"), "utf8");
  const context = { setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(source + "\n;globalThis.__MNEditHistory = MNEditHistory;", context);
  return context.__MNEditHistory;
}

// 편집기 흉내: live 가 화면 상태, capture/apply 로 스냅샷을 뜨고 되돌린다.
function makeEditor(MNEditHistory, opts){
  const box = { live: "s0", changes: 0 };
  box.history = MNEditHistory.create(Object.assign({
    capture: () => box.live,
    apply: (state) => { box.live = state; },
    isEqual: (a, b) => a === b,
    onChange: () => { box.changes++; },
  }, opts || {}));
  box.history.reset();
  return box;
}

test("연 직후에는 되돌리기·다시실행 모두 불가", () => {
  const box = makeEditor(loadHistory());
  assert.equal(box.history.canUndo(), false);
  assert.equal(box.history.canRedo(), false);
  assert.equal(box.history.size(), 1);
});

test("편집 후 commit 하면 되돌리기가 가능해지고, 되돌리면 이전 상태가 된다", () => {
  const box = makeEditor(loadHistory());
  box.live = "s1"; box.history.commit();
  assert.equal(box.history.canUndo(), true);
  assert.equal(box.history.canRedo(), false);

  assert.equal(box.history.undo(), true);
  assert.equal(box.live, "s0");
  assert.equal(box.history.canUndo(), false);
  assert.equal(box.history.canRedo(), true);

  assert.equal(box.history.redo(), true);
  assert.equal(box.live, "s1");
});

test("같은 상태를 거듭 commit 해도 단계가 늘지 않는다", () => {
  const box = makeEditor(loadHistory());
  box.live = "s1";
  assert.equal(box.history.commit(), true);
  assert.equal(box.history.commit(), false);
  assert.equal(box.history.commit(), false);
  assert.equal(box.history.size(), 2);
});

test("되돌린 뒤 새로 편집하면 다시실행 기록은 버려진다", () => {
  const box = makeEditor(loadHistory());
  box.live = "s1"; box.history.commit();
  box.live = "s2"; box.history.commit();
  box.history.undo();                       // live=s1, redo=s2 가능
  assert.equal(box.history.canRedo(), true);

  box.live = "s9"; box.history.commit();    // 새 갈래
  assert.equal(box.history.canRedo(), false);
  assert.equal(box.history.undo(), true);
  assert.equal(box.live, "s1");
});

test("상한을 넘으면 가장 오래된 단계부터 버린다", () => {
  const box = makeEditor(loadHistory(), { limit: 3 });
  for (const s of ["s1", "s2", "s3", "s4"]){ box.live = s; box.history.commit(); }
  assert.equal(box.history.size(), 3);
  // s0,s1 은 밀려났다 — s4 → s3 → s2 까지만 되돌아간다
  box.history.undo(); assert.equal(box.live, "s3");
  box.history.undo(); assert.equal(box.live, "s2");
  assert.equal(box.history.undo(), false);
});

// capture 가 매번 새 배열/객체를 주는 편집기(화이트보드·이미지)에서 isEqual 을 빠뜨리면
// undo 가 방금 만든 같은 상태로 되돌아가 아무 일도 하지 않는다 — 조용히 깨지므로 필수로 받는다.
test("배열 스냅샷도 isEqual 만 제대로 주면 undo 가 실제로 되돌린다", () => {
  const MNEditHistory = loadHistory();
  let items = ["a"];
  const history = MNEditHistory.create({
    capture: () => items.slice(),
    apply: (v) => { items = v.slice(); },
    isEqual: (a, b) => a.length === b.length && a.every((it, i) => it === b[i]),
  });
  history.reset();
  items.push("b"); history.commit();
  assert.equal(history.undo(), true);
  assert.deepEqual(items, ["a"], "undo 가 실제로 이전 상태로 돌아가야 한다");
  history.redo();
  assert.deepEqual(items, ["a", "b"]);
});

test("되돌리는 중 일어난 변경은 새 기록으로 쌓이지 않는다", () => {
  const MNEditHistory = loadHistory();
  const box = { live: "s0" };
  // apply 가 화면을 갱신하며 commit 을 다시 부르는 편집기(재진입) 흉내
  box.history = MNEditHistory.create({
    capture: () => box.live,
    apply: (state) => { box.live = state; box.history.commit(); },
    isEqual: (a, b) => a === b,
  });
  box.history.reset();
  box.live = "s1"; box.history.commit();
  box.history.undo();
  assert.equal(box.live, "s0");
  assert.equal(box.history.size(), 2, "재진입 commit 이 단계를 늘리면 안 된다");
  assert.equal(box.history.canRedo(), true, "redo 기록이 살아 있어야 한다");
});

test("편집 직전에 commit 하는 방식(pre-push)도 undo 가 현재 상태를 먼저 확정해 같은 결과가 된다", () => {
  const box = makeEditor(loadHistory());
  // 예전 whiteboard/표 방식: 바꾸기 직전에 기록하고 끝난 뒤엔 기록하지 않음
  box.history.commit();          // 이미 s0 == entries[0] → 무시됨
  box.live = "s1";               // 편집만 하고 commit 안 함
  assert.equal(box.history.undo(), true, "미기록 상태도 undo 시점에 확정된다");
  assert.equal(box.live, "s0");
  assert.equal(box.history.redo(), true);
  assert.equal(box.live, "s1");
});

// 표 편집기가 쓰는 방식: 편집 "직전"에 기록한다(18곳의 호출 위치를 옮기지 않기 위해).
// 리비전 번호로 같음을 O(1) 에 판정하고, 미기록 변경은 undo 가 확정한다.
// live 는 화면 상태, rev 는 편집마다 올라가는 번호. 스냅샷은 { rev, value }.
function makeSheetLike(MNEditHistory){
  const box = { live: "M0", rev: 0 };
  box.history = MNEditHistory.create({
    capture: () => ({ rev: box.rev, value: box.live }),
    apply: (s) => { box.live = s.value; box.rev = s.rev; },   // rev 도 함께 되돌려야 한다
    isEqual: (a, b) => a.rev === b.rev,
  });
  box.history.reset();
  // 편집 직전 호출 — 예전 pushUndo 자리
  box.beginEdit = () => { box.history.commit(); box.history.dropRedo(); box.rev++; };
  box.hasPending = () => box.history.current().rev !== box.rev;
  box.canUndo = () => box.history.canUndo() || box.hasPending();
  return box;
}

test("편집 직전 기록 방식: 첫 편집 뒤에도 되돌리기가 가능하다고 나온다", () => {
  const box = makeSheetLike(loadHistory());
  assert.equal(box.canUndo(), false);
  box.beginEdit(); box.live = "M1";
  assert.equal(box.canUndo(), true, "아직 commit 전이지만 되돌릴 게 있다");
  assert.equal(box.history.canRedo(), false);
});

test("편집 직전 기록 방식: 되돌리기·다시실행이 실제 상태를 오간다", () => {
  const box = makeSheetLike(loadHistory());
  box.beginEdit(); box.live = "M1";
  box.beginEdit(); box.live = "M2";

  box.history.undo();
  assert.equal(box.live, "M1");
  box.history.undo();
  assert.equal(box.live, "M0");
  assert.equal(box.canUndo(), false, "처음까지 왔으면 더 되돌릴 게 없다");

  box.history.redo();
  assert.equal(box.live, "M1");
  box.history.redo();
  assert.equal(box.live, "M2");
  assert.equal(box.history.canRedo(), false);
});

// dropRedo 가 없으면: 되돌린 뒤 새 편집을 시작해도 canRedo 가 true 로 남아,
// 다시실행을 누르면 방금 만든 편집을 조용히 버리고 옛 갈래로 간다.
test("편집 직전 기록 방식: 되돌린 뒤 새로 편집하면 다시실행 기록이 사라진다", () => {
  const box = makeSheetLike(loadHistory());
  box.beginEdit(); box.live = "M1";
  box.beginEdit(); box.live = "M2";
  box.history.undo();
  assert.equal(box.live, "M1");
  assert.equal(box.history.canRedo(), true);

  box.beginEdit(); box.live = "M1-다른갈래";
  assert.equal(box.history.canRedo(), false, "새 편집이 시작되면 앞쪽 갈래는 무효");

  box.history.undo();
  assert.equal(box.live, "M1", "새 갈래의 편집만 되돌아간다");
});

test("편집 직전 기록 방식: 되돌린 직후엔 미기록 변경이 없다고 본다", () => {
  const box = makeSheetLike(loadHistory());
  box.beginEdit(); box.live = "M1";
  box.history.undo();
  assert.equal(box.live, "M0");
  assert.equal(box.hasPending(), false, "rev 까지 되돌렸으니 미기록 변경이 없다");
  assert.equal(box.canUndo(), false);
});

test("commitSoon 은 연속 편집을 한 단계로 묶는다", async () => {
  const box = makeEditor(loadHistory());
  box.live = "s1"; box.history.commitSoon(10);
  box.live = "s2"; box.history.commitSoon(10);
  box.live = "s3"; box.history.commitSoon(10);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(box.history.size(), 2, "세 번 입력이 한 단계로 묶여야 한다");
  box.history.undo();
  assert.equal(box.live, "s0");
});

test("flush 는 묶는 중이던 입력을 즉시 확정한다", () => {
  const box = makeEditor(loadHistory());
  box.live = "s1"; box.history.commitSoon(1000);
  box.history.flush();
  assert.equal(box.history.size(), 2);
  assert.equal(box.history.canUndo(), true);
});

test("isEqual 로 같음 판정을 바꿀 수 있다", () => {
  const MNEditHistory = loadHistory();
  const box = { live: { v: 1 } };
  box.history = MNEditHistory.create({
    capture: () => ({ v: box.live.v }),
    apply: (s) => { box.live = { v: s.v }; },
    isEqual: (a, b) => a.v === b.v,
  });
  box.history.reset();
  box.live = { v: 1 };
  assert.equal(box.history.commit(), false, "값이 같으면 새 객체여도 단계가 아니다");
  box.live = { v: 2 };
  assert.equal(box.history.commit(), true);
});

// 노트북은 한 단계가 ipynb 전체(출력·이미지 포함)라 단계 수만으로는 메모리를 못 막는다.
test("총량 상한을 넘으면 단계 수가 남아 있어도 오래된 것부터 버린다", () => {
  const MNEditHistory = loadHistory();
  const box = { live: "" };
  const history = MNEditHistory.create({
    limit: 100,                                   // 개수로는 안 걸리게
    maxBytes: 25,
    sizeOf: (s) => s.length,
    capture: () => box.live,
    apply: (s) => { box.live = s; },
    isEqual: (a, b) => a === b,
  });
  history.reset();
  for (const s of ["a".repeat(10), "b".repeat(10), "c".repeat(10)]){ box.live = s; history.commit(); }
  // 빈 기준점 + 10+10+10 = 30 > 25 → 앞에서부터 버려 25 이하로 맞춘다
  assert.ok(history.size() < 4, "총량이 넘치면 오래된 단계가 버려진다");
  assert.equal(box.live, "c".repeat(10), "현재 상태는 그대로다");
});

test("총량 상한이 아무리 작아도 현재 단계 하나는 남긴다", () => {
  const MNEditHistory = loadHistory();
  const box = { live: "" };
  const history = MNEditHistory.create({
    limit: 100, maxBytes: 1, sizeOf: (s) => s.length,
    capture: () => box.live, apply: (s) => { box.live = s; }, isEqual: (a, b) => a === b,
  });
  history.reset();
  box.live = "x".repeat(50); history.commit();
  assert.equal(history.size(), 1);
  assert.equal(history.canUndo(), false);
});

test("sizeOf 없이 maxBytes 만 주면 총량 상한은 무시한다", () => {
  const MNEditHistory = loadHistory();
  const box = { live: "" };
  const history = MNEditHistory.create({
    limit: 100, maxBytes: 1,                      // sizeOf 가 없으면 잴 수 없다
    capture: () => box.live, apply: (s) => { box.live = s; }, isEqual: (a, b) => a === b,
  });
  history.reset();
  box.live = "aaa"; history.commit();
  box.live = "bbb"; history.commit();
  assert.equal(history.size(), 3);
});

test("peekRedo 는 다시실행하면 갈 단계를 알려준다", () => {
  const box = makeEditor(loadHistory());
  assert.equal(box.history.peekRedo(), null);
  box.live = "s1"; box.history.commit();
  assert.equal(box.history.peekRedo(), null, "맨 앞이면 없다");
  box.history.undo();
  assert.equal(box.history.peekRedo(), "s1", "되돌린 직후엔 방금 떠난 단계");
  box.history.redo();
  assert.equal(box.history.peekRedo(), null);
});

test("onChange 는 상태가 바뀔 때만 불린다", () => {
  const box = makeEditor(loadHistory());
  const base = box.changes;
  box.history.commit();                    // 변화 없음 → 알림 없음
  assert.equal(box.changes, base);
  box.live = "s1"; box.history.commit();   // 변화 → 알림
  assert.equal(box.changes, base + 1);
  box.history.undo();
  assert.equal(box.changes, base + 2);
});

test("capture/apply/isEqual 없이 만들면 즉시 알려준다", () => {
  const MNEditHistory = loadHistory();
  const ok = { capture: () => 1, apply: () => {}, isEqual: (a, b) => a === b };
  assert.throws(() => MNEditHistory.create({}), /capture\/apply\/isEqual/);
  // isEqual 만 빠뜨리는 게 가장 위험한 실수라 이것도 막는다
  assert.throws(() => MNEditHistory.create({ capture: ok.capture, apply: ok.apply }), /capture\/apply\/isEqual/);
  assert.doesNotThrow(() => MNEditHistory.create(ok));
});

test("상한 표는 편집기별로 다르게 정의돼 있다", () => {
  const { LIMITS } = loadHistory();
  assert.ok(LIMITS.text > LIMITS.sheet, "가벼운 문자열 스냅샷이 더 깊게 쌓인다");
  assert.equal(Object.isFrozen(LIMITS), true);
});
