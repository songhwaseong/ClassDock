"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const tier = require("../src/js/tier-list.js");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const img = { dataUrl:"data:image/jpeg;base64,AAAA", width:10, height:10 };

function sample(){
  const model = tier.tierDocEmpty("간식");
  model.items = ["떡볶이", "라면", "김밥", "순대"].map((text, index) => tier.tierNormalizeItem({ id:"c" + index, text }));
  return model;
}

test("새 티어표는 S·A·B·C·D 다섯 줄로 시작하고 JSON 으로 왕복한다", () => {
  const model = sample();
  assert.deepEqual(model.tiers.map(row => row.label), ["S", "A", "B", "C", "D"]);
  model.items[0].image = img; model.items[0].tier = model.tiers[1].id; model.cardSize = "l";
  const parsed = tier.tierDocParse(tier.tierDocSerialize(model));
  assert.equal(parsed.title, "간식"); assert.equal(parsed.cardSize, "l"); assert.equal(parsed.items.length, 4);
  assert.equal(parsed.items[0].tier, model.tiers[1].id); assert.equal(parsed.items[0].image.dataUrl, img.dataUrl);
  assert.match(tier.tierSearchText(parsed), /간식[\s\S]*떡볶이/);
});

test("읽을 때 빈 카드·겹친 id 는 버리고, 없는 줄을 가리키는 카드는 아래 모음으로 내린다", () => {
  const model = sample();
  const raw = { ...model, items:[...model.items, { id:"c0", text:"중복" }, { id:"empty" }, { id:"lost", text:"떠돌이", tier:"no-such-row" }], cardSize:"xxl" };
  const parsed = tier.tierDocParse(JSON.stringify(raw));
  assert.deepEqual(parsed.items.map(item => item.id), ["c0", "c1", "c2", "c3", "lost"]);
  assert.equal(parsed.items.find(item => item.id === "lost").tier, "");
  assert.equal(parsed.cardSize, "m");
  assert.throws(() => tier.tierDocParse('{"type":"x"}'), /tier-format/);
});

test("카드 옮기기는 고른 카드 앞에, 없으면 그 줄 맨 끝에 놓는다", () => {
  const model = sample(), [s, a] = model.tiers.map(row => row.id);
  assert.ok(tier.tierMoveItem(model, "c2", s, ""));
  assert.ok(tier.tierMoveItem(model, "c0", s, ""));
  assert.deepEqual(tier.tierItemsIn(model, s).map(item => item.id), ["c2", "c0"]);
  assert.ok(tier.tierMoveItem(model, "c3", s, "c0"));
  assert.deepEqual(tier.tierItemsIn(model, s).map(item => item.id), ["c2", "c3", "c0"]);
  assert.ok(tier.tierMoveItem(model, "c2", "", ""));                 // 아래 모음으로
  assert.deepEqual(tier.tierItemsIn(model, "").map(item => item.id), ["c1", "c2"]);
  assert.equal(tier.tierMoveItem(model, "c1", "no-such-row", ""), false);
  assert.equal(tier.tierMoveItem(model, "c1", a, "c1"), false);
  assert.equal(model.items.length, 4);
});

test("줄을 비우거나 지워도 카드는 아래 모음에 남고, 마지막 한 줄은 못 지운다", () => {
  const model = sample(), [s, a] = model.tiers.map(row => row.id);
  tier.tierMoveItem(model, "c0", s, ""); tier.tierMoveItem(model, "c1", a, "");
  assert.equal(tier.tierClearRow(model, s), 1); assert.equal(model.items.find(item => item.id === "c0").tier, "");
  assert.ok(tier.tierRemoveRow(model, a)); assert.equal(model.tiers.length, 4); assert.equal(model.items.find(item => item.id === "c1").tier, "");
  model.tiers = model.tiers.slice(0, 1); assert.equal(tier.tierRemoveRow(model, model.tiers[0].id), false);
  assert.equal(model.items.length, 4);
});

test("줄 틀을 바꾸면 같은 차례 줄의 카드는 그대로, 사라진 줄의 카드는 아래로 내려간다", () => {
  const model = sample(), rows = model.tiers.map(row => row.id);
  tier.tierMoveItem(model, "c0", rows[0], ""); tier.tierMoveItem(model, "c1", rows[4], "");
  tier.tierApplyPreset(model, "level");
  assert.deepEqual(model.tiers.map(row => row.label), ["상", "중", "하"]);
  assert.equal(model.items.find(item => item.id === "c0").tier, rows[0]);
  assert.equal(model.items.find(item => item.id === "c1").tier, "");
  assert.equal(tier.tierResetAll(model), 1); assert.ok(model.items.every(item => item.tier === ""));
});

test("줄 색에 맞춰 글자색을 고른다", () => {
  assert.equal(tier.tierInkFor("#ffff7f"), "#1f2328");
  assert.equal(tier.tierInkFor("#1e293b"), "#ffffff");
});

test("티어표가 셸·불러오기·새로 만들기·검색·복원 목록에 등록되어 있다", () => {
  const html = read("classdock.html");
  assert.match(html, /accept="[^"]*\.tier/); assert.match(html, /id="sbNewTier"/); assert.match(html, /id="dzNewTier"/); assert.match(html, /src="src\/js\/tier-list\.js"/);
  assert.match(read("src/js/file-loaders.js"), /ext === "tier" && typeof loadTierDoc === "function"/);
  assert.match(read("src/js/command-palette.js"), /newTierScratch/);
  const docs = read("src/js/documents.js");
  assert.match(docs, /RESTORE_UNSAVED_KINDS = new Set\(\[[^\]]*"tier"/); assert.match(docs, /newTierScratchInFolder/); assert.match(docs, /isTierSearchable/);
  assert.match(read("src/js/app.js"), /"study", "tier", "diary"/);
});

test("줄 장식 그림은 줄에 붙어 있어 줄을 옮겨도 따라가고, 그림 없는 예전 파일은 지금 차례로 정한다", () => {
  const model = tier.tierDocEmpty("간식");
  assert.deepEqual(model.tiers.map(row => row.icon), ["crown", "star", "star", "sprout", "gem"]);
  const [s] = model.tiers.splice(0, 1); model.tiers.splice(2, 0, s);          // S 를 가운데로
  const parsed = tier.tierDocParse(tier.tierDocSerialize(model));
  assert.equal(parsed.tiers[2].label, "S"); assert.equal(parsed.tiers[2].icon, "crown");
  const old = tier.tierDocParse({ type:"classdock-tier", tiers:[{ id:"a", label:"A" }, { id:"b", label:"B", icon:"nope" }, { id:"c", label:"C" }], items:[] });
  assert.deepEqual(old.tiers.map(row => row.icon), ["crown", "star", "gem"]);
});

test("보유 카드 한꺼번에 지우기는 줄에 올린 카드를 건드리지 않는다", () => {
  const model = sample(), [s] = model.tiers.map(row => row.id);
  tier.tierMoveItem(model, "c0", s, "");
  assert.equal(tier.tierRemovePoolItems(model, ["c0", "c1", "c2"]), 2);
  assert.deepEqual(model.items.map(item => item.id).sort(), ["c0", "c3"]);
  assert.equal(model.items.find(item => item.id === "c0").tier, s);
});

test("월드컵은 둘 중 하나를 고르며 올라가고, 진 판 크기대로 순위를 묶는다", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"], state = tier.tierCupStart(ids, () => 0.5);
  assert.deepEqual(state.round.slice().sort(), ids);
  let matches = 0;
  for (let match = tier.tierCupMatch(state); match; match = tier.tierCupMatch(state)){
    matches++; assert.equal(tier.tierCupPick(state, "zz"), false);             // 이 경기에 없는 카드는 못 고른다
    assert.ok(tier.tierCupPick(state, match.includes("a") ? "a" : match[0]));
  }
  assert.equal(matches, 7); assert.equal(state.champion, "a");
  const ranking = tier.tierCupRanking(state);
  assert.deepEqual(ranking.map(group => [group.size, group.ids.length]), [[1, 1], [2, 1], [4, 2], [8, 4]]);
  assert.deepEqual(ranking.map(group => tier.tierCupRankLabel(group.size)), ["우승", "준우승", "4강", "8강"]);
  assert.equal(tier.tierCupRoundLabel(2), "결승"); assert.equal(tier.tierCupRoundLabel(16), "16강");
});

test("짝이 안 맞으면 부전승으로 올라가고, 카드가 한 장이면 바로 우승이다", () => {
  const state = tier.tierCupStart(["a", "b", "c", "d", "e"], () => 0.99);
  let matches = 0; for (let match = tier.tierCupMatch(state); match; match = tier.tierCupMatch(state)){ matches++; tier.tierCupPick(state, match[1]); }
  assert.equal(matches, 4); assert.ok(state.champion);                            // 5장이면 경기는 늘 4번
  assert.equal(tier.tierCupRanking(state).reduce((sum, group) => sum + group.ids.length, 0), 5);
  const solo = tier.tierCupStart(["only"]); assert.equal(solo.champion, "only"); assert.equal(tier.tierCupMatch(solo), null);
  assert.deepEqual(tier.tierCupSizes(20), [4, 8, 16, 20]); assert.deepEqual(tier.tierCupSizes(16), [4, 8, 16]); assert.deepEqual(tier.tierCupSizes(3), [3]);
});

test("월드컵 결과를 줄에 놓으면 우승은 첫 줄, 줄이 모자라면 나머지는 마지막 줄로 간다", () => {
  const model = sample(); model.tiers = model.tiers.slice(0, 2);
  const [s, a] = model.tiers.map(row => row.id);
  const ranking = [{ size:1, ids:["c2"] }, { size:2, ids:["c0"] }, { size:4, ids:["c1", "c3"] }];
  assert.equal(tier.tierCupPlace(model, ranking), 4);
  assert.deepEqual(tier.tierItemsIn(model, s).map(item => item.id), ["c2"]);
  assert.deepEqual(tier.tierItemsIn(model, a).map(item => item.id), ["c0", "c1", "c3"]);
});
