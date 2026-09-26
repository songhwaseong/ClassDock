"use strict";
/* 복불복 화면을 작은 가짜 DOM(helpers/mini-dom.js)에 실제로 붙여, 게임마다 시작 단추를 누르고 시계를 돌려 결과 창까지 가 보는 시험.
   모양은 못 보지만 '열자마자 오류'·'끝나지 않는 게임' 같은 것은 여기서 잡힌다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createWindow, MiniEvent } = require("./helpers/mini-dom.js");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const FILES = ["history.js", "pick.js", "pick-roulette.js", "pick-ladder.js", "pick-card.js", "pick-slot.js", "pick-marble.js", "pick-capsule.js", "pick-dice.js", "pick-lotto.js", "pick-bomb.js", "pick-scratch.js", "pick-bottle.js", "pick-dart.js", "pick-treasure.js", "pick-croc.js", "pick-bingo.js"];
const NAMES = ["민수", "지우", "서연", "준호", "하린", "도윤"];

function boot(opts = {}){
  const win = createWindow();
  const ctx = Object.assign(win, {
    console, TextEncoder, crypto:require("node:crypto").webcrypto, toasts:[],
    toast:(message) => { ctx.toasts.push(message); }, markDocumentDirty:(doc, dirty) => { doc.hasUnsavedEdits = dirty; }, confirmDialog:async () => true,
    MNContextMenu:{ open:(x, y, items) => { ctx.menu = items; } },
    tierModal:(title, body) => { const modal = win.document.createElement("div"); modal.className = "tier-modal"; modal.appendChild(body); win.document.body.appendChild(modal); return { modal, dispose:() => modal.remove() }; },
    uiIcon:() => '<svg class="ui-icon"></svg>'
  });
  ctx.globalThis = ctx; vm.createContext(ctx);
  FILES.forEach(file => vm.runInContext(read("src/js/" + file), ctx, { filename:file }));
  ctx.__raw = JSON.stringify({ type:"classdock-pick", title:"시험", motion:opts.motion || "normal", people:(opts.names || NAMES).map(name => ({ name })) });
  const model = vm.runInContext("pickDocParse(__raw)", ctx);
  const doc = { el:win.document.createElement("div"), cleanupFns:[], pickDoc:model };
  win.document.body.appendChild(doc.el); ctx.__doc = doc;
  vm.runInContext("mountPickEditor(__doc)", ctx);
  const $ = sel => doc.el.querySelector(sel), $$ = sel => doc.el.querySelectorAll(sel);
  const pickGame = label => { $(".pick-game-btn").click(); const item = ctx.menu.find(entry => entry.label === label); assert.ok(item, "게임 메뉴: " + label); item.action(); };
  const go = () => $(".pick-go").click();
  const resultShown = () => !$(".pick-result").hidden && !!$(".pick-result-card");
  return { ctx, win, doc, model, $, $$, pickGame, go, resultShown, advance:ms => win.clock.advance(ms) };
}

test("열자마자 오류 없이 붙는다 — 빈 명단이면 추가 입력칸이 열려 있고, Enter 로 넣고 Ctrl+Z 로 되돌린다", () => {
  const app = boot({ names:[] });
  assert.ok(app.$(".pick-doc")); assert.equal(app.$(".pick-add-row").hidden, false); assert.equal(app.$(".pick-go").disabled, true);
  const input = app.$(".pick-add-input");
  input.value = "민수"; input.dispatchEvent(new MiniEvent("keydown", { key:"Enter" }));
  input.value = "지우"; input.dispatchEvent(new MiniEvent("keydown", { key:"Enter" }));
  assert.equal(app.$$(".pick-person").length, 2); assert.equal(app.$(".pick-go").disabled, false); assert.equal(app.doc.hasUnsavedEdits, true);
  const undo = app.$$(".pick-actions .tier-btn").find(b => b.title.startsWith("실행 취소")); undo.click();
  assert.equal(app.$$(".pick-person").length, 1);
});

test("룰렛 — 돌리면 멈추고 결과 창에 명단의 한 사람이, 뽑힌 차례에 한 줄", () => {
  const app = boot();
  assert.equal(app.$$(".pick-slice").length, 6);
  app.go(); assert.equal(app.$(".pick-go").disabled, true);          // 도는 동안 막힌다
  app.advance(12000);
  assert.ok(app.resultShown()); assert.ok(NAMES.includes(app.$(".pick-result-name").textContent));
  assert.equal(app.$$(".pick-log-chip").length, 1); assert.equal(app.$(".pick-go").disabled, false);
  assert.equal(app.$$(".pick-slice.is-win").length, 1);
  // '빼고 다시' — 뽑힌 사람을 쉬게 하고 다시 돈다(바퀴가 한 칸 줄어든다)
  const rest = app.$$(".pick-result-actions button")[1]; rest.click();
  assert.equal(app.$$(".pick-person.is-off").length, 1); assert.equal(app.$$(".pick-slice").length, 5);
  app.advance(12000); assert.ok(app.resultShown()); assert.equal(app.$$(".pick-log-chip").length, 2);
});

test("사다리 — 여섯 줄·아래 칸 여섯(당첨 하나), 타면 여섯 길이 다 그려지고 당첨자가 나온다", () => {
  const app = boot(); app.pickGame("사다리타기");
  assert.equal(app.$$(".pick-ladder-name").length, 6); assert.equal(app.$$(".pick-ladder-prize").length, 6); assert.equal(app.$$(".pick-ladder-prize.is-win").length, 1);
  assert.ok(app.$(".pick-ladder-cover"));                              // 가로줄은 탈 때까지 가린다
  app.go(); app.advance(6000);
  assert.ok(app.resultShown()); assert.equal(app.$$(".pick-ladder-trail").length, 6); assert.equal(app.$$(".pick-ladder-reach").length, 6);
  assert.ok(NAMES.includes(app.$(".pick-result-name").textContent));
  assert.equal(app.$(".pick-go-label").textContent, "새 사다리 타기");
});

test("사다리 — 칸마다 직접 쓰면 결과 표에 모두가 한 칸씩", () => {
  const app = boot({ motion:"off" }); app.pickGame("사다리타기");
  app.$$(".pick-game-tools button").find(b => b.textContent.includes("아래 칸 고치기")).click();
  const modal = app.win.document.querySelector(".tier-modal"); assert.ok(modal);
  modal.querySelector('.pick-seg button[data-mode="custom"]').click();
  modal.querySelector(".pl-lines").value = "청소\n발표\n간식"; modal.querySelector(".pl-save").click();
  assert.deepEqual(app.$$(".pick-ladder-prize").map(el => el.textContent).sort(), ["간식", "발표", "청소", "통과", "통과", "통과"]);
  app.go(); assert.ok(app.resultShown());
  assert.equal(app.$$(".pick-result-rows li").length, 6);
  assert.equal(app.model.games.ladder.mode, "custom");
});

test("사다리 — 이름을 누르면 그 사람만 타고, 모두 누르면 결과가 나온다", () => {
  const app = boot({ motion:"off", names:["가", "나", "다"] }); app.pickGame("사다리타기");
  app.$$(".pick-ladder-name")[0].click(); assert.equal(app.$$(".pick-ladder-trail").length, 1); assert.ok(!app.resultShown());
  app.$$(".pick-ladder-name")[1].click(); app.$$(".pick-ladder-name")[2].click();
  assert.ok(app.resultShown());
});

test("카드 — 섞은 뒤 차례대로 뒤집다가 당첨 카드가 나오면 끝난다", () => {
  const app = boot(); app.pickGame("카드 뽑기");
  assert.equal(app.$$(".pick-card").length, 6); assert.match(app.$(".pick-card-who").textContent, /민수 차례/);
  app.go(); app.advance(2000);
  let guard = 0;
  while (!app.resultShown() && guard++ < 10){ const card = app.$$(".pick-card").find(el => !el.disabled); card.click(); app.advance(1000); }
  assert.ok(app.resultShown()); assert.equal(app.$$(".pick-card.is-flipped .pick-card-front.is-win").length, 1);
  assert.ok(NAMES.includes(app.$(".pick-result-name").textContent));
  assert.equal(app.$$(".pick-card").filter(el => el.disabled).length, 6);
});

test("슬롯 — 세 릴이 차례로 멈추고 가운데 줄이 모두 같은 사람", () => {
  const app = boot(); app.pickGame("슬롯 추첨");
  assert.equal(app.$$(".pick-slot-reel").length, 3);
  app.go(); app.advance(8000);
  assert.ok(app.resultShown());
  const middles = app.$$(".pick-slot-strip").map(strip => strip.querySelectorAll(".pick-slot-name")[1].textContent);
  assert.equal(new Set(middles).size, 1); assert.equal(middles[0], app.$(".pick-result-name").textContent);
});

test("구슬 경주 — 카운트다운 뒤 모두 도착하고, 1등과 전체 순위가 나온다", () => {
  const app = boot(); app.pickGame("구슬 경주");
  assert.equal(app.$$(".pk-marble").length, 6);
  app.go(); app.advance(30000);
  assert.ok(app.resultShown()); assert.equal(app.$$(".pick-result-rows li").length, 6);
  assert.equal(app.$(".pick-result-rows li .pick-result-tag").textContent, "1등");
  assert.equal(app.$(".pick-result-rows li .pick-result-row-name").textContent, app.$(".pick-result-name").textContent);
  assert.equal(app.$$(".pk-marble.is-in").length, 6);
});

test("움직임 끄기면 모든 게임이 바로 결과까지 간다", () => {
  const app = boot({ motion:"off" });
  ["룰렛 돌리기", "사다리타기", "슬롯 추첨", "구슬 경주", "캡슐 뽑기", "공 뽑기", "병 돌리기", "다트 추첨"].forEach(label => {
    app.pickGame(label); app.go(); app.advance(100);
    assert.ok(app.resultShown(), label); app.$$(".pick-result-actions button").find(b => b.textContent === "닫기").click();
  });
});

test("게임을 바꿔도 명단 그대로 — 게임 설정은 바꿀 때만 파일에 쓴다", () => {
  const app = boot();
  ["사다리타기", "카드 뽑기", "슬롯 추첨", "구슬 경주", "캡슐 뽑기", "주사위 굴리기", "공 뽑기", "폭탄 돌리기", "스크래치 뽑기", "병 돌리기", "다트 추첨", "보물상자 고르기", "악어 이빨 누르기", "빙고 추첨", "룰렛 돌리기"].forEach(label => app.pickGame(label));
  assert.equal(app.model.game, "roulette"); assert.deepEqual(Object.keys(app.model.games), []);
  assert.equal(app.$$(".pick-person").length, 6);
});

test("캡슐 — 손잡이를 돌리면 캡슐 하나가 나와 열리고, 쪽지 이름이 결과와 같다", () => {
  const app = boot(); app.pickGame("캡슐 뽑기");
  assert.equal(app.$$(".pkc-cap").length, 6);
  app.go(); app.advance(5000);
  assert.ok(app.resultShown()); assert.equal(app.$(".pkc-open b").textContent, app.$(".pick-result-name").textContent);
  assert.ok(app.$(".pkc-open").classList.contains("is-open")); assert.equal(app.$$(".pkc-balls .pkc-cap").length, 5);   // 나온 캡슐은 통에서 빠진다
});

test("주사위 — 여섯 명이 차례로 굴리고(동점이면 재대결) 한 사람이 이긴다", () => {
  const app = boot(); app.pickGame("주사위 굴리기");
  assert.equal(app.$$(".pick-dice-card").length, 6); assert.equal(app.$$(".pick-die").length, 2);
  let guard = 0; while (!app.resultShown() && guard++ < 60){ app.go(); app.advance(2000); }
  assert.ok(app.resultShown(), "끝나지 않음"); assert.equal(app.$$(".pick-dice-card.is-win").length, 1);
  assert.equal(app.$(".pick-result-rows li .pick-result-row-name").textContent, app.$(".pick-result-name").textContent);
  assert.equal(app.$(".pick-go-label").textContent, "새 판");
});

test("공 뽑기 — 참가자 칸에 번호가 붙고, 누를 때마다 남은 공에서 하나씩, 다 뽑으면 다시 넣기", () => {
  const app = boot({ names:["가", "나", "다"] }); app.pickGame("공 뽑기");
  assert.deepEqual(app.$$(".pick-person-badge").map(el => el.textContent), ["01", "02", "03"]);
  assert.equal(app.$$(".pkl-ball").length, 3);
  const winners = [];
  for (let k = 0; k < 3; k++){ app.go(); app.advance(6000); assert.ok(app.resultShown()); winners.push(app.$(".pick-result-name").textContent); }
  assert.deepEqual([...winners].sort(), ["가", "나", "다"]);                 // 한 번 뽑힌 공은 다시 안 나온다
  assert.equal(app.$$(".pkl-mini").length, 3); assert.equal(app.$(".pick-go-label").textContent, "공 다시 넣기");
  app.go(); assert.equal(app.$$(".pkl-ball").length, 3); assert.equal(app.$$(".pkl-mini").length, 0);
});

test("폭탄 — 시작하면 누군가 폭탄을 들고, 넘기면 다음 사람에게 가며, 시간이 되면 들고 있던 사람이 걸린다", () => {
  const app = boot(); app.pickGame("폭탄 돌리기");
  assert.equal(app.$$(".pkb-seat").length, 6);
  app.go(); app.advance(200);
  const holder = () => app.$$(".pkb-seat").findIndex(el => el.classList.contains("is-holder"));
  const first = holder(); assert.ok(first >= 0); assert.equal(app.$(".pick-go").disabled, false); assert.equal(app.$(".pick-go-label").textContent, "다음 사람에게");
  app.go(); assert.equal(holder(), (first + 1) % 6);
  app.$$(".pkb-seat")[(first + 3) % 6].click(); assert.equal(holder(), (first + 3) % 6);
  const holderName = app.$$(".pkb-seat")[holder()].querySelector(".pkb-name").textContent;
  app.advance(40000);
  assert.ok(app.resultShown()); assert.equal(app.$(".pick-result-name").textContent, holderName);
  assert.equal(app.$$(".pick-person.is-off").length, 0);
});

test("스크래치 — 카드를 한 번 누르면 저절로 긁히고, 당첨 카드가 나오면 끝난다", () => {
  const app = boot(); app.pickGame("스크래치 뽑기");
  assert.equal(app.$$(".pks-card").length, 6); assert.equal(app.$$(".pks-prize.is-win").length, 1);
  let guard = 0;
  while (!app.resultShown() && guard++ < 8){
    const card = app.$$(".pks-card").find(el => !el.classList.contains("is-open")); const canvas = card.querySelector("canvas");
    canvas.dispatchEvent(new MiniEvent("pointerdown", { clientX:100, clientY:100 })); canvas.dispatchEvent(new MiniEvent("pointerup", { clientX:100, clientY:100 }));
    app.advance(3000);
  }
  assert.ok(app.resultShown()); assert.equal(app.$$(".pks-card.is-open").length, 6);
  const winCard = app.$$(".pks-card").find(el => el.querySelector(".pks-prize.is-win"));
  assert.equal(winCard.querySelector(".pks-name").textContent, app.$(".pick-result-name").textContent);
});

test("스크래치 — 끌어서 긁어도 절반 넘게 긁히면 열린다", () => {
  const app = boot({ names:["가", "나"] }); app.pickGame("스크래치 뽑기");
  const card = app.$$(".pks-card")[0], canvas = card.querySelector("canvas");
  canvas.dispatchEvent(new MiniEvent("pointerdown", { clientX:10, clientY:40 }));
  for (let y = 40; y < 640; y += 90) for (const x of [10, 890]) canvas.dispatchEvent(new MiniEvent("pointermove", { clientX:x, clientY:y }));
  canvas.dispatchEvent(new MiniEvent("pointerup", {}));
  assert.ok(card.classList.contains("is-open"));
});

test("병 돌리기 — 병이 멈추면 가리킨 자리가 결과와 같다", () => {
  const app = boot(); app.pickGame("병 돌리기");
  assert.equal(app.$$(".pkt-seat").length, 6);
  app.go(); app.advance(8000);
  assert.ok(app.resultShown()); assert.equal(app.$(".pkt-seat.is-chosen span").textContent, app.$(".pick-result-name").textContent);
  assert.match(app.$(".pkt-banner").textContent, /당첨/);
});

test("다트 — 다트가 꽂힌 칸이 결과와 같고, 다트가 판에 남는다", () => {
  const app = boot(); app.pickGame("다트 추첨");
  assert.equal(app.$$(".pick-slice").length, 6);
  app.go(); app.advance(3000); assert.ok(app.resultShown());
  const win = app.$(".pick-slice.is-win"); assert.ok(win); assert.equal(win.querySelector("text").textContent, app.$(".pick-result-name").textContent);
  app.go(); app.advance(3000); assert.equal(app.$$(".pkd-dart").length, 2); assert.equal(app.$$(".pkd-dart.is-old").length, 1);
});

test("보물상자 — 차례대로 상자를 열다가 보물이 나오면 끝난다", () => {
  const app = boot(); app.pickGame("보물상자 고르기");
  assert.equal(app.$$(".pkx-item").length, 6); assert.match(app.$(".pick-card-who").textContent, /민수 차례/);
  let guard = 0;
  while (!app.resultShown() && guard++ < 10){ app.$$(".pkx-item").find(el => !el.disabled).click(); app.advance(1500); }
  assert.ok(app.resultShown()); assert.equal(app.$$(".pkx-item.is-open.is-win").length, 1);
  assert.equal(app.$$(".pkx-item").filter(el => el.disabled).length, 6);
});

test("악어 — 이빨은 사람 수만큼, 차례대로 누르다 물리면 그 사람이 걸린다", () => {
  const app = boot(); app.pickGame("악어 이빨 누르기");
  assert.equal(app.$$(".pkr-tooth").length, 6);
  const order = [];
  let guard = 0;
  while (!app.resultShown() && guard++ < 10){
    order.push(app.$(".pkr-chip strong").textContent.replace(/ 차례$/, ""));
    app.$$(".pkr-tooth").find(el => !el.classList.contains("is-down")).dispatchEvent(new MiniEvent("click", { bubbles:true })); app.advance(1500);
  }
  assert.ok(app.resultShown()); assert.equal(app.$(".pick-result-name").textContent, order[order.length - 1]);
  assert.ok(app.$(".pkr-svg").classList.contains("is-snapped")); assert.equal(app.$(".pick-go-label").textContent, "다시 시작");
  app.go(); assert.equal(app.$$(".pkr-tooth.is-down").length, 0);
});

test("빙고 — 사람마다 판을 받고, 번호를 뽑다 보면 한 줄을 채운 사람이 나온다", () => {
  const app = boot({ names:["가", "나", "다"] }); app.pickGame("빙고 추첨");
  assert.equal(app.$$(".pkg-card").length, 3); assert.equal(app.$$(".pkg-card")[0].querySelectorAll(".pkg-cell").length, 25);
  let guard = 0; while (!app.resultShown() && guard++ < 80){ app.go(); app.advance(1000); }
  assert.ok(app.resultShown(), "빙고가 안 남"); assert.ok(app.$$(".pkg-card.is-bingo").length >= 1);
  assert.ok(app.$$(".pkg-drawn-chip").length >= 4); assert.equal(app.$(".pkg-status").textContent, "빙고!");
  app.go(); assert.equal(app.$$(".pkg-drawn-chip").length, 0);
});
