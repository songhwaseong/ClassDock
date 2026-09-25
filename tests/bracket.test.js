"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const br = require("../src/js/bracket.js");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const img = { dataUrl:"data:image/jpeg;base64,AAAA", width:10, height:10 };

function sample(names){
  const model = br.bracketDocEmpty("반 대항전", 2);
  br.bracketAddEntries(model, (names || ["가", "나", "다", "라"]).map((text, index) => br.bracketNormalizeEntry({ id:"p" + index, text })));
  return model;
}
const nameOf = (model, id) => (model.entries.find(entry => entry.id === id) || {}).text;

test("씨드 차례는 1·2번이 결승에서야 만나고, 빈 칸(부전승)은 높은 씨드 쪽에 흩어진다", () => {
  assert.deepEqual(br.bracketSeedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepEqual(br.bracketSeat(["a", "b", "c", "d", "e"], 8), ["a", "", "d", "e", "b", "", "c", ""]);
  assert.equal(br.bracketSizeFor(5), 8); assert.equal(br.bracketSizeFor(1), 2); assert.equal(br.bracketSizeFor(128), 128); assert.equal(br.bracketSizeFor(300), 128);
  assert.deepEqual([1, 2, 4, 16].map(br.bracketRoundLabel), ["우승", "결승", "4강", "16강"]);
});

test("참가자를 넣으면 빈 칸부터 채우고, 모자라면 두 배로 키워 128명까지 받는다", () => {
  const model = sample(["가", "나", "다"]);
  assert.equal(model.size, 4); assert.equal(model.slots.filter(Boolean).length, 3);
  const out = br.bracketAddEntries(model, ["라", "마"].map(text => br.bracketNormalizeEntry({ text })));
  assert.equal(out.grew, true); assert.equal(model.size, 8); assert.equal(model.slots.filter(Boolean).length, 5);
  const many = br.bracketDocEmpty("큰 대회");
  const big = br.bracketAddEntries(many, Array.from({ length:130 }, (_, n) => br.bracketNormalizeEntry({ text:"팀" + n })));
  assert.equal(big.added, 128); assert.equal(big.skipped, 2); assert.equal(many.size, 128); assert.equal(many.slots.filter(Boolean).length, 128);
});

test("이긴 쪽을 고르면 한 칸씩 올라가고, 한쪽이 비면 저절로 부전승이다", () => {
  const model = sample(["가", "나", "다"]);      // 4칸: 1번 씨드(가)는 부전승
  let res = br.bracketResolve(model);
  const bye = res.matches.find(match => match.auto);
  assert.ok(bye); assert.equal(nameOf(model, bye.winner), "가");
  const open = res.matches.find(match => match.r === 0 && match.a && match.b);
  assert.ok(br.bracketSetResult(model, 0, open.i, { winner:open.b }));
  res = br.bracketResolve(model);
  const final = res.matches.find(match => match.r === 1);
  assert.ok(final.a && final.b);
  br.bracketSetResult(model, 1, 0, { winner:final.a });
  assert.equal(br.bracketResolve(model).champion, final.a);
  assert.deepEqual(br.bracketDecidedOrder(model), ["0:" + open.i, "1:0"]);   // 부전승은 다시 보기에서 뺀다
  assert.equal(br.bracketSetResult(model, 0, bye.i, { winner:bye.winner }), null);   // 상대 없는 경기는 결과를 못 넣는다
});

test("앞 경기 승자를 바꾸면 그 참가자가 올라가 있던 뒤 경기 결과는 지워진다", () => {
  const model = sample();
  const first = br.bracketResolve(model).matches.filter(match => match.r === 0);
  first.forEach(match => br.bracketSetResult(model, 0, match.i, { winner:match.a }));
  const final = br.bracketResolve(model).matches.find(match => match.r === 1);
  br.bracketSetResult(model, 1, 0, { winner:final.a, sa:"3", sb:"1" });
  const out = br.bracketSetResult(model, 0, 0, { winner:first[0].b });
  assert.equal(out.changed, true); assert.equal(out.cleared, 1);
  assert.equal(model.results["1:0"], undefined); assert.equal(br.bracketResolve(model).champion, "");
  // 다른 쪽 경기를 바꾸는 건 결승에 영향이 없어야 할 때(결승 전) — 1회전 두 번째 경기 결과는 그대로
  assert.equal(model.results["0:1"].winner, first[1].a);
});

test("점수로 승자 정하기 — 높은 쪽(기본)·낮은 쪽, 같거나 숫자가 아니면 정하지 않는다", () => {
  assert.equal(br.bracketWinnerByScore("3", "1", "high"), "a");
  assert.equal(br.bracketWinnerByScore("3", "1", "low"), "b");
  assert.equal(br.bracketWinnerByScore("2", "2", "high"), "");
  assert.equal(br.bracketWinnerByScore("", "1", "high"), "");
  assert.equal(br.bracketWinnerByScore("12.5", "12,4", "high"), "a");
  const model = sample(["가", "나"]); const match = br.bracketResolve(model).matches[0];
  br.bracketSetResult(model, 0, 0, { sa:"1", sb:"1" });                     // 점수만 있고 승자는 아직
  assert.equal(br.bracketResolve(model).champion, ""); assert.equal(model.results["0:0"].sa, "1");
  br.bracketSetResult(model, 0, 0, { winner:match.b });
  assert.equal(br.bracketResolve(model).champion, match.b);
});

test("JSON 왕복 — 모양·테마·점수·사진이 남고, 이상한 값은 기본으로, 맞지 않는 결과는 버린다", () => {
  const model = sample(); model.entries[0].image = img; model.layout = "up"; model.theme = "neon"; model.lineStyle = "curve"; model.motion = "fast"; model.scoreRule = "low";
  const match = br.bracketResolve(model).matches[0]; br.bracketSetResult(model, 0, 0, { winner:match.a, sa:"5", sb:"7" });
  const parsed = br.bracketDocParse(br.bracketDocSerialize(model));
  assert.equal(parsed.layout, "up"); assert.equal(parsed.theme, "neon"); assert.equal(parsed.lineStyle, "curve"); assert.equal(parsed.motion, "fast"); assert.equal(parsed.scoreRule, "low");
  assert.equal(parsed.entries[0].image.dataUrl, img.dataUrl); assert.deepEqual(parsed.slots, model.slots);
  assert.equal(parsed.results["0:0"].winner, match.a); assert.equal(parsed.results["0:0"].sb, "7");
  const odd = br.bracketDocParse({ ...JSON.parse(br.bracketDocSerialize(model)), layout:"zigzag", theme:"custom", size:6, results:{ "0:0":{ a:"x", b:"y", winner:"x" }, "9:9":{}, "junk":{} } });
  assert.equal(odd.layout, "split"); assert.equal(odd.theme, "classic"); assert.equal(odd.size, 4); assert.deepEqual(odd.results, {});
  assert.throws(() => br.bracketDocParse('{"type":"x"}'), /bracket-format/);
  assert.match(br.bracketSearchText(parsed), /반 대항전[\s\S]*가/);
});

test("자리가 없는 참가자는 빈 칸에 앉히고, 겹친 자리는 한 번만 쓴다", () => {
  const raw = { type:"classdock-bracket", size:4, entries:[{ id:"a", text:"A" }, { id:"b", text:"B" }, { id:"c", text:"C" }], slots:["a", "a", "", "zz"] };
  const parsed = br.bracketDocParse(raw);
  assert.equal(parsed.slots.filter(Boolean).length, 3); assert.equal(new Set(parsed.slots.filter(Boolean)).size, 3);
});

test("크기 바꾸기·섞기·자리 바꾸기·빼기는 참가자를 잃지 않는다", () => {
  const model = sample(["가", "나", "다", "라", "마"]);
  assert.equal(model.size, 8);
  assert.equal(br.bracketResize(model, 4), null);                          // 5명은 4칸에 못 앉는다
  assert.ok(br.bracketResize(model, 32)); assert.equal(model.slots.length, 32); assert.equal(model.slots.filter(Boolean).length, 5);
  br.bracketShuffle(model, () => 0.3); assert.equal(model.slots.filter(Boolean).length, 5);
  const p = model.slots.findIndex(Boolean), q = model.slots.findIndex(slot => !slot);
  const moved = model.slots[p]; br.bracketSwapSlots(model, p, q); assert.equal(model.slots[q], moved); assert.equal(model.slots[p], "");
  assert.ok(br.bracketRemoveEntry(model, moved)); assert.equal(model.entries.length, 4); assert.ok(!model.slots.includes(moved));
});

test("모양마다 칸이 겹치지 않고, 양쪽 모양은 결승 두 칸이 우승 칸 좌우에 온다", () => {
  for (const layout of br.BRACKET_LAYOUTS.map(item => item.id)){
    for (const size of [2, 8, 128]){
      const geo = br.bracketGeometry(size, layout, "m", { title:true });
      assert.equal(geo.nodes.length, size * 2 - 1, layout + size); assert.equal(geo.edges.length, size * 2 - 2);
      geo.nodes.forEach(node => { assert.ok(node.x - node.w / 2 >= 0 && node.x + node.w / 2 <= geo.width, `${layout} ${size} ${node.key} x`); assert.ok(node.y - node.h / 2 >= 0 && node.y + node.h / 2 <= geo.height, `${layout} ${size} ${node.key} y`); });
      const leaves = geo.nodes.filter(node => node.r === 0);
      for (let i = 1; i < leaves.length; i++){ const a = leaves[i - 1], b = leaves[i]; const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2; assert.ok(apart, `${layout} ${size} leaves ${i}`); }
    }
  }
  const split = br.bracketGeometry(8, "split", "m"), champ = split.byKey.get("3-0"), left = split.byKey.get("2-0"), right = split.byKey.get("2-1");
  assert.ok(left.x < champ.x && champ.x < right.x); assert.equal(left.y, champ.y); assert.equal(right.y, champ.y);
  const up = br.bracketGeometry(8, "up", "m"); assert.ok(up.byKey.get("3-0").y < up.byKey.get("0-0").y);    // 아래에서 위로: 우승이 꼭대기
  assert.match(br.bracketEdgePath({ x:0, y:0, w:10, h:10 }, { x:100, y:50, w:10, h:10 }, "x", "elbow"), /^M5 0H50V50H95$/);
  assert.match(br.bracketEdgePath({ x:0, y:0, w:10, h:10 }, { x:100, y:50, w:10, h:10 }, "x", "curve"), /^M5 0C/);
});

test("대진표가 셸·불러오기·새로 만들기·검색·복원 목록에 등록되어 있다", () => {
  const html = read("classdock.html");
  assert.match(html, /accept="[^"]*\.bracket/); assert.match(html, /id="sbNewBracket"/); assert.match(html, /id="dzNewBracket"/); assert.match(html, /src="src\/js\/bracket\.js"/);
  assert.match(read("src/js/file-loaders.js"), /ext === "bracket" && typeof loadBracketDoc === "function"/);
  assert.match(read("src/js/command-palette.js"), /newBracketScratch/);
  const docs = read("src/js/documents.js");
  assert.match(docs, /RESTORE_UNSAVED_KINDS = new Set\(\[[^\]]*"bracket"/); assert.match(docs, /newBracketScratchInFolder/); assert.match(docs, /isBracketSearchable/);
  assert.match(read("src/js/app.js"), /"diary", "trip", "bracket"\]\.includes\(d\.kind\)/);
  assert.match(read("src/js/document-types.js"), /"tier","bracket"/);
  const css = read("src/styles.css");
  br.BRACKET_THEMES.forEach(theme => assert.match(css, new RegExp(`\\[data-br-theme="${theme.id}"\\]\\{--br-bg:`), theme.id));
});

test("오른쪽 클릭 메뉴는 카드 일 아래로 머리말·⋯ 메뉴의 도구를 갈래별로 모두 싣는다", () => {
  const src = read("src/js/bracket.js");
  assert.match(src, /body\.addEventListener\("contextmenu"/);
  const tools = src.slice(src.indexOf("function toolMenuItems()"), src.indexOf("function replayMenuItems()"));
  ["글로 참가자 넣기…", "사진 참가자 넣기…", "\"모양\"", "\"꾸미기\"", "\"대진\"", "\"점수\"", "\"보기\"", "실행 취소", "다시 실행", "제목 고치기", "저장하기", "exportItems()"].forEach(label => assert.ok(tools.includes(label), label));
  // ⋯ 메뉴와 같은 조각을 쓴다 — 한쪽만 고쳐 어긋나지 않게
  ["sizeMenu()", "shuffleItem()", "clearResultsItem()", "removeAllItem()"].forEach(piece => assert.ok(tools.includes(piece), piece));
});

test("회전별로 크게 보기 — 그 회전 위만 작은 대진으로 배치하되 칸·선 번호는 원래 대진 번호다", () => {
  const full = br.bracketFocusGeometry(32, 0, "split", "m", { title:true });
  assert.equal(full.depth, 0); assert.equal(full.nodes.length, 63);
  const focus = br.bracketFocusGeometry(32, 2, "split", "m", { title:true });    // 8강부터
  assert.equal(focus.depth, 2); assert.equal(focus.size, 32); assert.equal(focus.R, 5);
  assert.equal(focus.nodes.length, 15); assert.ok(focus.nodes.every(node => node.r >= 2));
  assert.ok(focus.byKey.get("2-7") && focus.byKey.get("5-0") && !focus.byKey.get("1-0"));
  assert.ok(focus.edges.every(edge => edge.r >= 2 && focus.byKey.get(edge.key)));
  assert.deepEqual(focus.labels.map(label => label.text).filter((text, i, all) => all.indexOf(text) === i), ["8강", "4강", "결승"]);
  assert.ok(focus.byKey.get("2-0").w > full.byKey.get("2-0").w);                 // 카드는 한 단계 크게
  assert.equal(br.bracketFocusGeometry(8, 99, "up", "l").depth, 2);               // 결승(2명)까지만
});

test("다시 보기 자동 확대는 기본으로 켜져 있고 파일에 남는다", () => {
  const model = sample(); assert.equal(model.replayFocus, true);
  model.replayFocus = false;
  assert.equal(br.bracketDocParse(br.bracketDocSerialize(model)).replayFocus, false);
  assert.equal(br.bracketDocParse({ type:"classdock-bracket", entries:[] }).replayFocus, true);
});

test("메모 왕복 — 메모 그림 블록이 대진표 갈래를 기억하고, 보낼 때 그림과 스냅샷을 함께 넘긴다", () => {
  const { scratchpadNormalizeBlock, scratchpadBoardKindLabel } = require("../src/js/scratchpad.js");
  assert.equal(scratchpadBoardKindLabel("bracket"), "대진표");
  assert.equal(scratchpadNormalizeBlock({ type:"image", assetId:"a", boardAssetId:"b", boardKind:"bracket" }).boardKind, "bracket");
  const pad = read("src/js/scratchpad.js"), src = read("src/js/bracket.js");
  assert.match(pad, /sourceKind === "bracket" \? await openBracketFromMemo\(openOptions\)/);
  assert.match(pad, /window\.addBracketToScratchpad = async/);
  assert.match(src, /window\.addBracketToScratchpad\(blob, JSON\.parse\(json\), \{[^}]*blockId:doc\.memoBlockId/);
  assert.match(src, /doc\.memoBlockId = result\.blockId/);
  assert.match(src, /doc\.memoBlockId = String\(opts\.memoBlockId \|\| ""\) \|\| null/);
  assert.match(read("src/js/documents.js"), /d\.kind === "music" \|\| d\.kind === "bracket"/);
});

test("메모에서 다시 열기 — 스냅샷으로 .bracket 탭을 만들고, 같은 블록은 두 번 열지 않는다", async () => {
  const vm = require("node:vm");
  const opened = [];
  const context = { console, Map, Set, Math, JSON, Date, File, Blob, Promise, docs:[], toast:() => {}, setActiveDoc:(id) => { context.active = id; },
    handleFiles:async (files, opts) => { const text = await files[0].text(); const made = { id:"d" + opened.length, kind:"bracket", name:files[0].name, memoBlockId:opts.memoBlockId, bracketDoc:br.bracketDocParse(text) }; opened.push(made); context.docs.push(made); return made; } };
  context.globalThis = context; vm.createContext(context);
  vm.runInContext(read("src/js/bracket.js") + ";globalThis.__open = openBracketFromMemo;", context);
  const model = sample(); const state = JSON.parse(br.bracketDocSerialize(model));
  const [a, b] = await Promise.all([context.__open({ state, name:"반 대항전", memoBlockId:"image-1" }), context.__open({ state, name:"반 대항전", memoBlockId:"image-1" })]);
  assert.equal(opened.length, 1); assert.equal(a, b);
  assert.equal(a.name, "반 대항전.bracket"); assert.equal(a.memoBlockId, "image-1"); assert.equal(a.bracketDoc.entries.length, 4);
  const again = await context.__open({ state, name:"반 대항전", memoBlockId:"image-1" });   // 이미 이어진 탭(내용 같음) → 그 탭으로
  assert.equal(again, a); assert.equal(opened.length, 1); assert.equal(context.active, a.id); assert.equal(a.memoReusedTab, true);
  assert.equal(await context.__open({ state:{ type:"x" }, memoBlockId:"image-2" }), null);   // 깨진 스냅샷은 탭을 만들지 않는다
});
