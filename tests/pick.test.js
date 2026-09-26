"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pk = require("../src/js/pick.js");
const rl = require("../src/js/pick-roulette.js");
const ld = require("../src/js/pick-ladder.js");
const cd = require("../src/js/pick-card.js");
const sl = require("../src/js/pick-slot.js");
const mb = require("../src/js/pick-marble.js");
const cp = require("../src/js/pick-capsule.js");
const dc = require("../src/js/pick-dice.js");
const lt = require("../src/js/pick-lotto.js");
const bm = require("../src/js/pick-bomb.js");
const sc = require("../src/js/pick-scratch.js");
const bt = require("../src/js/pick-bottle.js");
const dt = require("../src/js/pick-dart.js");
const tr = require("../src/js/pick-treasure.js");
const cr = require("../src/js/pick-croc.js");
const bg = require("../src/js/pick-bingo.js");
const lo = require("../src/js/pick-lots.js");
const cn = require("../src/js/pick-coin.js");
const st = require("../src/js/pick-strings.js");
const bl = require("../src/js/pick-balloon.js");
const pb = require("../src/js/pick-pinball.js");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const seq = values => { let i = 0; return () => values[i++ % values.length]; };

test("명단은 JSON 으로 오가고, 빈 사람·겹친 id 는 버리고, 이번엔 빼기(off)는 남는다", () => {
  const model = pk.pickDocEmpty("우리 반");
  pk.pickAddPeople(model, ["민수", "지우", "서연"]);
  model.people[1].off = true;
  const back = pk.pickDocParse(pk.pickDocSerialize(model));
  assert.equal(back.title, "우리 반"); assert.equal(back.game, "roulette");
  assert.deepEqual(back.people.map(person => person.name), ["민수", "지우", "서연"]);
  assert.deepEqual(back.people.map(person => person.off), [false, true, false]);
  assert.deepEqual(pk.pickActive(back).map(person => person.name), ["민수", "서연"]);
  const messy = pk.pickDocParse({ type:pk.PICK_DOC_TYPE, people:[{ id:"a", name:"가" }, { id:"a", name:"겹침" }, { id:"b", name:"  " }, { name:"다", color:"red" }] });
  assert.deepEqual(messy.people.map(person => person.name), ["가", "다"]);
  assert.match(messy.people[1].color, /^#[0-9a-f]{6}$/);
  assert.throws(() => pk.pickDocParse({ type:"other", people:[] }));
  assert.throws(() => pk.pickDocParse("{"));
});

test("모르는 게임과 그 설정은 작으면 그대로 들고 간다 — 옛 앱이 저장해도 새 게임 설정이 남게", () => {
  const raw = { type:pk.PICK_DOC_TYPE, game:"future-game", people:[], games:{ "future-game":{ labels:["당첨", "통과"] }, roulette:{ junk:1 }, "Bad Key":{ a:1 }, big:{ s:"x".repeat(30000) } } };
  const model = pk.pickDocParse(raw);
  assert.equal(model.game, "future-game");
  assert.deepEqual(model.games["future-game"], { labels:["당첨", "통과"] });
  assert.deepEqual(model.games.roulette, {});           // 아는 게임은 그 게임이 고른다
  assert.ok(!("Bad Key" in model.games)); assert.ok(!("big" in model.games));
  assert.equal(pk.pickDocParse({ ...raw, game:"<script>" }).game, "roulette");
});

test("참가자를 넣으면 색이 겹치지 않게 돌아가고, 100명을 넘으면 뺀 수를 알려 준다", () => {
  const model = pk.pickDocEmpty();
  const out = pk.pickAddPeople(model, pk.PICK_COLORS.map((_, i) => "사람" + i));
  assert.equal(out.added, pk.PICK_COLORS.length);
  assert.equal(new Set(model.people.map(person => person.color)).size, pk.PICK_COLORS.length);
  const more = pk.pickAddPeople(model, Array.from({ length:120 }, (_, i) => "더" + i));
  assert.equal(model.people.length, pk.PICK_MAX_PEOPLE); assert.equal(more.skipped, 120 - (pk.PICK_MAX_PEOPLE - pk.PICK_COLORS.length));
  assert.deepEqual(pk.pickSplitNames("민수\r\n지우\t서연, 준호\n\n  하린  "), ["민수", "지우", "서연", "준호", "하린"]);
});

test("뽑기는 0~n-1 을 고르게 — random 을 넘기면 그대로, crypto 로는 치우침이 없다", () => {
  assert.equal(pk.pickRandomInt(6, () => 0), 0); assert.equal(pk.pickRandomInt(6, () => 0.9999999), 5); assert.equal(pk.pickRandomInt(1), 0); assert.equal(pk.pickRandomInt(0), 0);
  const counts = new Array(6).fill(0); for (let i = 0; i < 60000; i++) counts[pk.pickRandomInt(6)]++;
  counts.forEach(count => assert.ok(Math.abs(count - 10000) < 700, String(counts)));
  const shuffled = pk.pickShuffle([1, 2, 3, 4, 5], seq([0.1, 0.9, 0.5, 0.3]));
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4, 5]);
});

test("룰렛은 뽑힌 칸이 바늘 아래 멈춘다 — 멈출 각을 칸 번호 셈과 같은 식으로 확인", () => {
  for (let n = 2; n <= 40; n++){
    for (let index = 0; index < n; index++){
      for (const offset of [-0.45, -0.2, 0, 0.3, 0.45]){
        const current = (index * 37.3 + n * 11) % 720, turns = 3 + (index % 3);
        const target = rl.pickRouletteTarget(current, index, n, { turns, offset });
        assert.equal(rl.pickRouletteIndexAt(target, n), index, `n=${n} i=${index} off=${offset}`);
        assert.ok(target >= current + turns * 360 && target < current + (turns + 1) * 360, `turns n=${n}`);
      }
    }
  }
  // 12시에서 시계 방향으로 칸 0·1·2… — 바퀴가 안 돌았으면 바늘 아래는 칸 0, 조금 거꾸로 돌면 마지막 칸.
  assert.equal(rl.pickRouletteIndexAt(0, 6), 0); assert.equal(rl.pickRouletteIndexAt(-59, 6), 0); assert.equal(rl.pickRouletteIndexAt(-61, 6), 1); assert.equal(rl.pickRouletteIndexAt(10, 6), 5);
});

test("룰렛 이름표 — 8칸까지는 똑바로, 많으면 눕히고, 긴 이름은 줄이고, 칸이 너무 좁으면 안 쓴다", () => {
  const six = rl.pickRouletteLabel(6, "민수"); assert.equal(six.radial, false); assert.ok(six.size > 8);
  const many = rl.pickRouletteLabel(20, "민수"); assert.equal(many.radial, true);
  assert.equal(rl.pickRouletteLabel(6, "아주아주긴이름입니다").text, "아주아주긴이름…");
  assert.equal(rl.pickRouletteLabel(100, "가나다라마바"), null);
  const svg = rl.pickRouletteSlices([{ id:"a", name:"<b>&", color:"#ffffff" }, { id:"b", name:"둘", color:"#000000" }, { id:"c", name:"셋", color:"#abcdef" }], "t");
  assert.equal((svg.body.match(/class="pick-slice"/g) || []).length, 3);
  assert.ok(svg.body.includes("&lt;b&gt;&amp;")); assert.ok(!svg.body.includes("<b>"));
  assert.match(rl.pickRouletteSlices([], "t").body, /pick-slice-empty/);
});

test("화면을 붙일 때 history.reset() 이 부르는 syncButtons 의 상태 변수가 먼저 선언돼 있다", () => {
  const src = read("src/js/pick.js"), mount = src.slice(src.indexOf("function mountPickEditor"));
  assert.ok(mount.indexOf("let busy = false") > 0 && mount.indexOf("let busy = false") < mount.indexOf("history.reset(); doc._pickHistory"));
});

test("게임 스무 개가 모두 스스로 올라온다", () => {
  assert.equal(typeof pk.PICK_GAME_IMPL.roulette.mount, "function");
  assert.deepEqual(pk.pickReadyGames().map(game => game.id), ["roulette", "ladder", "card", "slot", "marble", "capsule", "dice", "lotto", "bomb", "scratch", "bottle", "dart", "treasure", "croc", "bingo", "lots", "coin", "strings", "balloon", "pinball"]);
});

const lcg = seed => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test("사다리 — 이웃 줄마다 가로줄이 있고, 한 층에 붙은 가로줄이 없으며, 위 n 명과 아래 n 칸이 하나씩 짝이 된다", () => {
  for (let n = 2; n <= ld.PICK_LADDER_MAX; n++){
    for (let seed = 1; seed <= 25; seed++){
      const ladder = ld.pickLadderBuild(n, lcg(seed * 97 + n));
      for (let c = 0; c < n - 1; c++) assert.ok(ladder.rungs.some(r => r.col === c), `n=${n} c=${c} 빈 사이`);
      ladder.rungs.forEach(r => assert.ok(!ladder.rungs.some(q => q !== r && q.level === r.level && Math.abs(q.col - r.col) <= 1), `n=${n} 붙은 가로줄`));
      const ends = Array.from({ length:n }, (_, i) => ld.pickLadderTrace(ladder, i).end);
      assert.deepEqual([...ends].sort((a, b) => a - b), Array.from({ length:n }, (_, i) => i), `n=${n} 짝`);
    }
  }
  const labels = ld.pickLadderLabels({ winners:2 }, 6, lcg(3));
  assert.equal(labels.length, 6); assert.equal(labels.filter(l => l.win).length, 2); assert.equal(labels.filter(l => l.text === "당첨").length, 2);
  assert.equal(ld.pickLadderLabels({ winners:9 }, 4, lcg(3)).filter(l => l.win).length, 3);              // 모두 당첨은 안 된다
  assert.deepEqual(ld.pickLadderLabels({ mode:"custom", labels:["청소", "발표"] }, 4, lcg(5)).map(l => l.text).sort(), ["발표", "청소", "통과", "통과"]);
  const path = ld.pickLadderTrace({ rungs:[{ col:0, y:0.5 }] }, 0);
  assert.deepEqual(path, { end:1, points:[[0, 0], [0, 0.5], [1, 0.5], [1, 1]] });
  assert.deepEqual(ld.pickLadderPointAt([[0, 0], [0, 10], [10, 10]], 15).slice(0, 2), [5, 10]);
});

test("카드 — 당첨 장수는 카드 수-1·사람 수를 넘지 않고, 이미 당첨된 사람은 차례를 건너뛴다", () => {
  assert.deepEqual(cd.pickCardPlan({}, 6), { count:6, winners:1 });
  assert.deepEqual(cd.pickCardPlan({ count:10, winners:12 }, 4), { count:10, winners:4 });
  assert.deepEqual(cd.pickCardPlan({ winners:5 }, 3), { count:3, winners:2 });
  const deck = cd.pickCardDeal(8, 3, lcg(9)); assert.equal(deck.length, 8); assert.equal(deck.filter(Boolean).length, 3);
  const g = cd.pickCardGrid(6, 900, 520, 16, 0.95, 260); assert.ok(g.cols >= 3 && g.cols <= 6); assert.ok(g.cw * g.cols + 16 * (g.cols - 1) <= 900);
  const order = [{ id:"a" }, { id:"b" }, { id:"c" }];
  assert.equal(cd.pickCardNextTurn(order, 0, new Set(["b"])), 2); assert.equal(cd.pickCardNextTurn(order, 2, new Set()), 0); assert.equal(cd.pickCardNextTurn(order, 0, new Set(["a", "b", "c"])), -1);
  assert.equal(cd.pickCardNormalize({ count:"x" }).count, "auto");
});

test("슬롯 — 띠는 지금 보이는 세 칸으로 시작해 당첨자를 가운데 두고 끝나며, 이웃 칸이 겹치지 않는다", () => {
  const people = ["가", "나", "다", "라"].map(id => ({ id }));
  for (let seed = 1; seed < 40; seed++){
    const winner = people[seed % 4], current = [people[0], people[1], people[2]];
    const { cells, target } = sl.pickSlotStrip(people, winner, current, 12, lcg(seed));
    assert.deepEqual(cells.slice(0, 3), current); assert.equal(cells[target], winner); assert.equal(target, cells.length - 2);
    for (let i = 3; i < cells.length; i++) assert.notEqual(cells[i], cells[i - 1], `seed=${seed} i=${i}`);
  }
  assert.ok(Math.abs(sl.pickSlotEase(1) - 1) < 1e-9); assert.equal(sl.pickSlotEase(0), 0); assert.ok(sl.pickSlotEase(0.8) > 1);   // 살짝 지나쳤다 돌아온다
});

test("구슬 경주 — 진행도는 0에서 1까지 뒤로 가지 않고, 등수대로 도착하며, 길은 자기와 겹치지 않는다", () => {
  for (let seed = 1; seed <= 30; seed++){
    const plan = mb.pickMarblePlan(8, 10000, lcg(seed));
    assert.deepEqual([...plan.order].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
    plan.order.forEach((who, rank) => { assert.equal(plan.racers[who].rank, rank); if (rank) assert.ok(plan.racers[who].T > plan.racers[plan.order[rank - 1]].T); });
    plan.racers.forEach(racer => {
      let prev = 0; for (let t = 0; t <= racer.T; t += racer.T / 400){ const p = mb.pickMarbleProgress(racer, t); assert.ok(p >= prev - 1e-9, "뒤로 감"); prev = p; }
      assert.equal(mb.pickMarbleProgress(racer, 0), 0); assert.ok(Math.abs(mb.pickMarbleProgress(racer, racer.T) - 1) < 1e-9);
    });
  }
  const path = mb.pickMarblePath(mb.PICK_MARBLE_TRACK, 28);
  let closest = Infinity;
  for (let i = 0; i < path.pts.length; i++) for (let j = i + 1; j < path.pts.length; j++){ if (path.cum[j] - path.cum[i] < 260) continue; closest = Math.min(closest, Math.hypot(path.pts[i][0] - path.pts[j][0], path.pts[i][1] - path.pts[j][1])); }
  assert.ok(closest > 70 + 24 + 10, "길 둘레(벽 포함)가 겹친다: " + closest.toFixed(1));
  const end = mb.pickMarbleAt(path, path.length + 50); assert.deepEqual([Math.round(end.x), Math.round(end.y)], mb.PICK_MARBLE_TRACK[mb.PICK_MARBLE_TRACK.length - 1]);
});

test("새 문서 종류 등록 — 새로 만들기·열기·검색·복구·팔레트", () => {
  const html = read("classdock.html");
  assert.match(html, /accept="[^"]*\.pick[,"]/); assert.match(html, /id="sbNewPick"/); assert.match(html, /id="dzNewPick"/);
  assert.match(html, /src="src\/js\/pick\.js"><\/script>\n<script src="src\/js\/pick-roulette\.js"/);
  assert.match(read("src/js/file-loaders.js"), /ext === "pick" && typeof loadPickDoc === "function"/);
  assert.match(read("src/js/command-palette.js"), /newPickScratch/);
  const docs = read("src/js/documents.js");
  assert.match(docs, /RESTORE_UNSAVED_KINDS = new Set\(\[[^\]]*"pick"/); assert.match(docs, /newPickScratchInFolder/); assert.match(docs, /isPickSearchable/);
  const app = read("src/js/app.js");
  assert.match(app, /"bracket", "pick"\]\.includes\(d\.kind\)/); assert.match(app, /state\.kind === "pick"/); assert.match(app, /newPickScratch\(\)/);
  assert.match(read("src/js/document-types.js"), /"bracket","pick"/);
  assert.match(read("src/styles.css"), /\[data-cat="pick"\]\{--ic:/);
  assert.equal(pk.pickDefaultTitle("복불복.pick"), "오늘은 누가?"); assert.equal(pk.pickDefaultTitle("3반 발표.pick"), "3반 발표");
  assert.equal(pk.pickScratchFileName(2), "복불복 2.pick");
  const model = pk.pickDocEmpty("발표 순서"); pk.pickAddPeople(model, ["민수", "지우"]);
  assert.equal(pk.pickSearchText(model), "발표 순서\n민수\n지우");
});

test("둥근 통 채우기 — 공이 통 밖으로 나가거나 서로 겹치지 않는다(캡슐·번호 공 공용)", () => {
  for (const n of [1, 2, 6, 15, 40, 60]){
    const { r, pts } = pk.pickPackCircle(n, 150, lcg(n)); assert.equal(pts.length, n);
    pts.forEach(p => assert.ok(Math.hypot(p[0], p[1]) <= 150 - r + r * 0.15, "밖으로 나감 n=" + n));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) >= r * 1.7, "겹침 n=" + n);
  }
  const balls = cp.pickCapsuleBalls(Array.from({ length:50 }, (_, i) => ({ id:"p" + i, color:"#ffffff" })), lcg(2));
  assert.equal(balls.length, cp.PICK_CAPSULE_SHOW);
  balls.forEach(b => assert.ok(Math.hypot(b.x - cp.PICK_CAPSULE_DOME.cx, b.y - cp.PICK_CAPSULE_DOME.cy) + b.r <= cp.PICK_CAPSULE_DOME.r + 2));
});

test("주사위 — 1~6만 나오고, 맨 앞 동점이면 그 사람들을 모두 돌려준다", () => {
  const rolls = dc.pickDiceRoll(600, lcg(4)); assert.ok(rolls.every(v => v >= 1 && v <= 6)); assert.equal(new Set(rolls).size, 6);
  const scores = new Map([["a", 7], ["b", 9], ["c", 9], ["d", 3]]);
  assert.deepEqual(dc.pickDiceLeaders(["a", "b", "c", "d"], scores, "high"), ["b", "c"]);
  assert.deepEqual(dc.pickDiceLeaders(["a", "b", "c", "d"], scores, "low"), ["d"]);
  assert.deepEqual(dc.pickDiceNormalize({ dice:9, rule:"x" }), { dice:3, rule:"high" });
  Object.values(dc.PICK_DICE_PIPS).forEach((pips, i) => assert.equal(pips.length, i + 1));
});

test("공 뽑기 — 번호는 전체 명단 차례, 관은 통 가장자리에서 받침까지, 튕겨도 공은 통 안에 머문다", () => {
  const people = [{ id:"a" }, { id:"b" }, { id:"c" }], model = { people };
  assert.equal(lt.pickLottoNumber(model, people[2]), "03");
  const tube = lt.pickLottoTube(), S = lt.PICK_LOTTO_SPHERE; assert.ok(Math.hypot(tube[0][0] - S.cx, tube[0][1] - S.cy) < S.r); assert.deepEqual(tube[tube.length - 1].map(Math.round), [540, 470]);
  const R = S.r - 6, r = 20, rnd = lcg(8), pack = pk.pickPackCircle(30, R, rnd), balls = pack.pts.map(([x, y]) => ({ x, y, vx:0, vy:0 }));
  for (let k = 0; k < 600; k++) lt.pickLottoStep(balls, r, R, 1 / 120, k < 400, rnd);
  balls.forEach(b => { assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y)); assert.ok(Math.hypot(b.x, b.y) <= R - r + 0.5, "통 밖"); });
});

test("폭탄 — 터지는 시각은 정한 범위 안, 시계 글, 째깍 간격은 갈수록 짧아진다", () => {
  for (let seed = 1; seed < 50; seed++){ const ms = bm.pickBombFuse({ min:10, max:30 }, lcg(seed)); assert.ok(ms >= 10000 && ms <= 30000); }
  assert.deepEqual(bm.pickBombNormalize({ min:40, max:5 }), { min:5, max:40, showLeft:false, dir:"cw" });
  assert.equal(bm.pickBombClock(8200), "00:08"); assert.equal(bm.pickBombClock(75000), "01:15"); assert.equal(bm.pickBombClock(-5), "00:00");
  assert.equal(bm.pickBombTickGap(0, 10000), 1000); assert.ok(bm.pickBombTickGap(9000, 10000) < 400);
});

test("스크래치 — 당첨 장수만큼 숨기고, 저절로 긁는 길은 절반 넘게 긁는다", () => {
  const deck = sc.pickScratchDeal(6, 2, lcg(3)); assert.equal(deck.filter(Boolean).length, 2); assert.equal(sc.pickScratchDeal(3, 9, lcg(3)).filter(Boolean).length, 2);
  const grid = new Uint8Array(sc.PICK_SCRATCH_GRID ** 2), path = sc.pickScratchAutoPath(6); let ratio = 0;
  for (let i = 1; i < path.length; i++) ratio = sc.pickScratchCover(grid, path[i - 1], path[i], 0.11);
  assert.ok(ratio >= 0.55, "자동 긁기 비율 " + ratio);
  assert.ok(sc.pickScratchCover(new Uint8Array(sc.PICK_SCRATCH_GRID ** 2), [0.5, 0.5], [0.5, 0.5], 0.1) < 0.1);
  assert.equal(sc.pickScratchNormalize({}).loseLabel, "다음 기회에");
});

test("병 돌리기 — 병목이 뽑힌 사람 자리(± 간격 30%)에서 멈춘다", () => {
  for (let n = 2; n <= bt.PICK_BOTTLE_MAX; n++) for (let i = 0; i < n; i++) for (const off of [-0.3, 0, 0.29]){
    const cur = (i * 53.7 + n * 7) % 720, target = bt.pickBottleTarget(cur, i, n, { turns:3, offset:off });
    assert.equal(bt.pickBottleIndexAt(target, n), i, `n=${n} i=${i}`); assert.ok(target >= cur + 3 * 360 && target < cur + 4 * 360);
  }
});

test("다트 — 꽂힐 자리는 뽑힌 칸 안, 가운데 과녁과 테두리 밖은 피한다", () => {
  for (let n = 2; n <= dt.PICK_DART_MAX; n++) for (let i = 0; i < n; i++){
    const spot = dt.pickDartSpot(i, n, lcg(n * 31 + i)), r = Math.hypot(spot.x, spot.y);
    assert.equal(dt.pickDartIndexAt(spot.x, spot.y, n), i, `n=${n} i=${i}`); assert.ok(r > dt.PICK_DART_BULL + 8 && r < 96, "반지름 " + r);
  }
});

test("보물상자 — 상자 설정은 카드와 같은 모양이고, 상자 그림엔 열리는 뚜껑이 있다", () => {
  assert.match(tr.PICK_TREASURE_CHEST, /class="pkx-lid"/); assert.match(tr.PICK_TREASURE_CHEST, /class="pkx-star-big"/);
  assert.equal(tr.pickTreasureNormalize({}).count, "auto");
});

test("악어 — 이빨 수는 기본이 사람 수(4~16), 이빨끼리 겹치지 않는다", () => {
  assert.equal(cr.pickCrocTeethCount({}, 6), 6); assert.equal(cr.pickCrocTeethCount({}, 2), 4); assert.equal(cr.pickCrocTeethCount({}, 30), 16); assert.equal(cr.pickCrocTeethCount({ teeth:12 }, 3), 12);
  assert.deepEqual(cr.pickCrocNormalize({ teeth:99, turns:"x" }), { teeth:16, turns:"list" });
  for (let n = cr.PICK_CROC_MIN; n <= cr.PICK_CROC_MAX; n++){
    const t = cr.pickCrocTeeth(n);
    for (let i = 1; i < n; i++) assert.ok(Math.hypot(t[i].x - t[i - 1].x, t[i].y - t[i - 1].y) >= 38 * t[i].scale * 0.87, "겹침 n=" + n);
    t.forEach(q => { assert.ok(q.x > 104 && q.x < 496 && q.y > 248 && q.y < 464, "잇몸 밖 n=" + n); });
  }
});

test("빙고 — 판은 열마다 제 범위의 서로 다른 번호, 가운데는 빈칸, 줄 판정과 번호 뽑기", () => {
  for (let seed = 1; seed < 30; seed++){
    const card = bg.pickBingoCard(lcg(seed)); assert.equal(card.length, 25); assert.equal(card[12], 0);
    assert.equal(new Set(card.filter(Boolean)).size, 24);
    card.forEach((v, k) => { if (v){ const c = k % 5; assert.ok(v >= c * 15 + 1 && v <= c * 15 + 15); } });
  }
  const card = bg.pickBingoCard(lcg(3));
  assert.equal(bg.pickBingoLines(card, new Set()).length, 0);
  assert.equal(bg.pickBingoLines(card, new Set([card[10], card[11], card[13], card[14]])).length, 1);          // 가운데 줄(빈칸 포함)
  assert.equal(bg.pickBingoLines(card, new Set(card.filter(Boolean))).length, 12);
  const drawn = new Set(), rnd = lcg(5); for (let i = 0; i < 75; i++){ const n = bg.pickBingoDraw(drawn, rnd); assert.ok(n >= 1 && n <= 75 && !drawn.has(n)); drawn.add(n); }
  assert.equal(bg.pickBingoDraw(drawn, rnd), 0); assert.equal(bg.pickBingoLetter(75), "O"); assert.equal(bg.pickBingoLetter(31), "N");
});

test("동전 — 나올 면대로 멈추고(앞면 360의 배수·뒷면 +180), 편은 반반", () => {
  for (const cur of [0, 90, 400, 725]) for (const side of [0, 1]){ const deg = cn.pickCoinSpin(cur, side, 4); assert.equal(cn.pickCoinSideAt(deg), side); assert.ok(deg >= cur + 4 * 360 - 360); }
  const people = ["a", "b", "c", "d", "e"].map(id => ({ id })), team = cn.pickCoinSplit(people, lcg(2));
  const zeros = [...team.values()].filter(v => v === 0).length; assert.ok(zeros === 2 || zeros === 3); assert.equal(team.size, 5);
});

test("핀볼 — 어느 칸이든 닿는 걸음이 나오고, 구슬은 벽 밖으로 나가지 않는다", () => {
  for (let n = 2; n <= pb.PICK_PINBALL_MAX; n++){
    const R = pb.pickPinballRows(n); assert.equal((R - (n - 1)) % 2, 0); assert.ok(R >= 7);
    for (let t = 0; t < n; t++) for (let seed = 1; seed <= 6; seed++){
      const path = pb.pickPinballPath(n, t, R, lcg(seed * 13 + t + n));
      assert.equal(path.length, R + 1); assert.equal(path[0], 0); assert.equal(path[R], pb.pickPinballGoal(n, t), `n=${n} t=${t}`);
      for (let i = 1; i <= R; i++){ assert.equal(Math.abs(path[i] - path[i - 1]), 1); assert.ok(Math.abs(path[i]) <= Math.max(1, n - 1)); }
    }
  }
  const g = pb.pickPinballGeometry(6); assert.equal(g.x(pb.pickPinballGoal(6, 0)) - 45, 40); assert.equal(g.x(pb.pickPinballGoal(6, 5)) + 45, g.W - 40);
});

test("끈·풍선·제비 — 당첨 장수, 끈 자리, 그림 조각", () => {
  assert.equal(bl.pickBalloonDeal(6, 2, lcg(4)).filter(Boolean).length, 2); assert.equal(bl.pickBalloonDeal(2, 5, lcg(4)).filter(Boolean).length, 1);
  assert.equal(bl.pickBalloonNormalize({}).loseLabel, "꽝"); assert.match(bl.pickBalloonSvg("#ff0000"), /pkb3-body/);
  const xs = st.pickStringsXs(6, 760); assert.equal(xs.length, 6); assert.ok(xs[0] > 60 && xs[5] < 700); for (let i = 1; i < 6; i++) assert.ok(xs[i] > xs[i - 1]);
  assert.equal(st.pickStringsNormalize({ count:30 }).count, st.PICK_STRINGS_MAX);
  assert.equal(lo.PICK_LOTS_TENTS.length, 8); assert.match(lo.pickLotsSlipSvg(40, "#abcdef"), /#abcdef/); assert.match(lo.pickLotsTentSvg(0, 0, "#fff", "<b>"), /&lt;b&gt;/);
});
