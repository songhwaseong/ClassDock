"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lotto = require("../src/js/lotto.js");
const all = Array.from({ length:45 }, (_, i) => i + 1);
const round = (id, games, time=1) => ({ id, games, time });

test("1~5게임은 범위 안의 서로 다른 번호 6개이며, 한 번에 뽑는 조합도 겹치지 않는다", () => {
  for (const count of [1, 5]){
    const games = lotto.draw(all, count);
    assert.equal(games.length, count);
    assert.equal(new Set(games.map(game => game.join(","))).size, count);
    for (const game of games){ assert.equal(game.length, 6); assert.equal(new Set(game).size, 6); assert.deepEqual(game, [...game].sort((a, b) => a - b)); assert.ok(game.every(n => n >= 1 && n <= 45)); }
  }
  assert.deepEqual(all, Array.from({ length:45 }, (_, i) => i + 1));
  assert.equal(lotto.choose(45, 6), 8145060);
});
test("후보 7개의 모든 조합 순번은 정확한 서로 다른 7조합으로 복원된다", () => {
  const pool = [1, 2, 3, 4, 5, 6, 7];
  const games = Array.from({ length:7 }, (_, rank) => lotto.combination(pool, rank));
  assert.equal(new Set(games.map(game => game.join(","))).size, 7);
  assert.deepEqual(games[0], [1, 2, 3, 4, 5, 6]); assert.deepEqual(games[6], [2, 3, 4, 5, 6, 7]);
  const drawn = lotto.draw(pool, 5, () => 0);
  assert.equal(new Set(drawn.map(game => game.join(","))).size, 5);
});
test("직전 회차의 모든 게임과 직접 고른 제외 번호는 동시에 적용된다", () => {
  const state = lotto.normalize({ excluded:[45], excludePrevious:true, history:[round("a", [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]])] });
  const pool = lotto.pool(state); assert.equal(pool.numbers.length, 32);
  assert.ok(pool.numbers.every(n => n > 12 && n < 45));
  assert.ok(lotto.draw(pool.numbers, 5).flat().every(n => n > 12 && n < 45));
});
test("공통 번호는 회차별 모든 게임의 합집합을 비교하고 제외 조건도 반영한다", () => {
  const state = lotto.normalize({ commonOnly:true, selected:["a", "b"], history:[round("a", [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]], 2), round("b", [[1, 3, 5, 7, 9, 11]])] });
  assert.deepEqual(lotto.pool(state).numbers, [1, 3, 5, 7, 9, 11]);
  state.excluded = [11]; assert.ok(lotto.pool(state).reason);
  state.selected = ["a"]; assert.match(lotto.pool(state).reason, /2개 이상/);
});
test("직전 회차를 비교에 넣고 이전 번호 제외도 켜면 이유를 따로 알려 준다", () => {
  const history = [round("a", [[1, 2, 3, 4, 5, 6]], 3), round("b", [[1, 2, 3, 4, 5, 6]], 2), round("c", [[1, 2, 3, 4, 5, 6]], 1)];
  const state = lotto.normalize({ commonOnly:true, excludePrevious:true, selected:["a", "b"], history });
  assert.equal(lotto.pool(state).numbers.length, 0);
  assert.match(lotto.pool(state).reason, /직전 회차/);
  state.selected = ["b", "c"];
  assert.equal(lotto.pool(state).numbers.length, 0);
  assert.doesNotMatch(lotto.pool(state).reason, /직전 회차/);
});
test("후보·조합이 부족하면 멈추며 기록이나 원본 후보를 바꾸지 않는다", () => {
  const pool = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(lotto.draw(pool, 1), [pool]);
  assert.throws(() => lotto.draw(pool, 2), /조합/);
  assert.throws(() => lotto.draw(pool.slice(0, 5), 1), /6개 미만/);
  assert.throws(() => lotto.draw(pool, 0), /게임 수/);
  assert.deepEqual(pool, [1, 2, 3, 4, 5, 6]);
  const state = lotto.normalize({ count:5, excluded:all.slice(6), history:[] });
  assert.match(lotto.pool(state).reason, /1개뿐/); assert.equal(state.history.length, 0);
});
test("손상되거나 범위 밖인 저장 데이터는 제거되고 유효한 설정·기록은 왕복한다", () => {
  const state = lotto.normalize({ count:99, excluded:[0, 3, 3, 46, "4"], selected:["valid", "invalid", "valid"], history:[round("valid", [[1, 2, 3, 4, 5, 6]], 2), round("invalid", [[1, 1, 2, 3, 4, 5]]), round("valid", [[7, 8, 9, 10, 11, 12]])] });
  assert.equal(state.count, 1); assert.deepEqual(state.excluded, [3]); assert.deepEqual(state.selected, ["valid"]); assert.equal(state.history.length, 1);
  assert.deepEqual(lotto.normalize(JSON.parse(JSON.stringify(state))), state);
});
