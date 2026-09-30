"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pension } = require("../src/js/lotto.js");
const key = ticket => ticket.group + ":" + ticket.number;
const state = (extra={}) => pension.normalize(Object.assign({ count:5 }, extra));

test("무작위 조로 1~5장은 조 1~5·여섯 자리 숫자이고, 한 번에 뽑는 표는 겹치지 않는다", () => {
  for (const count of [1, 5]){
    const tickets = pension.draw(state({ count }));
    assert.equal(tickets.length, count);
    assert.equal(new Set(tickets.map(key)).size, count);
    for (const ticket of tickets){ assert.ok(ticket.group >= 1 && ticket.group <= 5); assert.match(ticket.number, /^\d{6}$/); }
  }
  assert.equal(pension.pool(state()).total, 5000000);
});
test("자리마다 같은 숫자가 나올 수 있고, 순번은 앞 자리부터 채운다", () => {
  assert.equal(pension.numberAt([null, null, null, null, null, null], 77150), "077150");
  assert.equal(pension.numberAt([1, null, 1, null, 1, null], 999), "191919");
});
test("조를 지정하면 그 조로만 뽑고, 고정한 자리는 모든 표에 들어간다", () => {
  const tickets = pension.draw(state({ group:3, fixed:[null, null, null, null, null, 7] }));
  assert.equal(tickets.length, 5);
  assert.ok(tickets.every(ticket => ticket.group === 3 && ticket.number.endsWith("7")));
});
test("모든 조는 장 수와 관계없이 같은 번호로 1~5조 5장을 만든다", () => {
  const tickets = pension.draw(state({ count:2, group:"all" }));
  assert.deepEqual(tickets.map(ticket => ticket.group), [1, 2, 3, 4, 5]);
  assert.equal(new Set(tickets.map(ticket => ticket.number)).size, 1);
  const fixed = pension.draw(state({ group:"all", fixed:[1, 2, 3, 4, 5, 6] }));
  assert.ok(fixed.every(ticket => ticket.number === "123456"));
});
test("표가 모자라면 멈추고, 무작위 조는 여섯 자리를 다 고정해도 5장까지 된다", () => {
  const allFixed = [1, 2, 3, 4, 5, 6];
  assert.equal(pension.pool(state({ group:2, fixed:allFixed, count:1 })).reason, "");
  assert.match(pension.pool(state({ group:2, fixed:allFixed, count:2 })).reason, /1장뿐/);
  assert.throws(() => pension.draw(state({ group:2, fixed:allFixed, count:2 })), /1장뿐/);
  const tickets = pension.draw(state({ fixed:allFixed, count:5 }), () => 0);
  assert.deepEqual(tickets.map(key), ["1:123456", "2:123456", "3:123456", "4:123456", "5:123456"]);
  assert.throws(() => pension.draw({ count:0, group:"random", fixed:[] }), /장 수/);
});
test("손상된 저장 데이터는 걸러지고 유효한 설정·기록은 왕복한다", () => {
  const saved = state({ count:9, group:7, fixed:[1, 10, -1, "3", 4.5, 9, 8], history:[
    { id:"ok", time:2, games:[{ group:1, number:"000000" }, { group:5, number:"999999" }] },
    { id:"dup", time:1, games:[{ group:1, number:"123456" }, { group:1, number:"123456" }] },
    { id:"bad", time:1, games:[{ group:6, number:"123456" }] },
    { id:"short", time:1, games:[{ group:1, number:"12345" }] },
  ] });
  assert.equal(saved.count, 1); assert.equal(saved.group, "random");
  assert.deepEqual(saved.fixed, [1, null, null, null, null, 9]);
  assert.deepEqual(saved.history.map(round => round.id), ["ok"]);
  assert.deepEqual(pension.normalize(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(pension.normalize({ group:"all" }).group, "all");
});
