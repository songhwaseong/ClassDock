"use strict";

// 사진첩 장식 편집: 여러 개 고르기·묶기·복사·정렬·자석·레이어·크기·각도, 직접 그린 장식·글자·이모지.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain, svgText, assertWellFormedXml } = require("./photo-album-harness.js");

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message || ""} ${actual} vs ${expected}`);
const part = (id, x, y, w = 10, r = 0, extra = {}) => ({ id, art:"round", x, y, w, r, ...extra });
// 200×100 크기의 사진 면을 흉내 내는 root(정렬·크기·각도 계산이 화면 크기를 잰다).
const stageRoot = (width = 200, height = 100) => ({
  querySelector:selector => selector === ".pa-layer" ? { clientWidth:width, clientHeight:height }
    : selector === ".pa-photo-surface" ? { getBoundingClientRect:() => ({ left:0, top:0, width, height }) } : null,
  querySelectorAll:() => [], closest:() => null, contains:() => false, classList:{ add(){}, remove(){}, toggle(){} }, isConnected:true
});

test("겹침 순서는 고른 장식끼리의 앞뒤를 지키며 옮긴다", () => {
  const album = loadAlbum(), item = { stickers:["a","b","c","d","e"].map((id, i) => part(id, i, 0)) };
  const order = () => item.stickers.map(p => p.id).join("");
  album.pick(["a","c"]);
  assert.deepEqual(plain(album.orderRoom(item)), { forward:true, backward:true });
  album.moveParts(item, "forward"); assert.equal(order(), "badce");
  album.moveParts(item, "front"); assert.equal(order(), "bdeac");
  assert.deepEqual(plain(album.orderRoom(item)), { forward:false, backward:true });
  album.moveParts(item, "backward"); assert.equal(order(), "bdace");
  album.moveParts(item, "back"); assert.equal(order(), "acbde");
});

test("묶음 틀로 함께 키우고 돌리면 간격과 크기 한도를 지킨다", () => {
  const album = loadAlbum(), rect = { left:0, top:0, width:200, height:100 };
  const p1 = part("p", 25, 50), p2 = part("q", 75, 50);
  album.transformParts(album.partStarts([p1, p2]), rect, { x:100, y:50 }, 2, 0);
  assert.equal(p1.x, 0); assert.equal(p2.x, 100); assert.equal(p1.w, 20);
  const q1 = part("p", 40, 50), q2 = part("q", 60, 50);
  album.transformParts(album.partStarts([q1, q2]), rect, { x:100, y:50 }, 1, 90);
  near(q1.x, 50); near(q1.y, 30); assert.equal(q1.r, 90);
  const big = part("p", 50, 50, 100), small = part("q", 50, 50, 10);
  album.transformParts(album.partStarts([big, small]), rect, { x:100, y:50 }, 2, 0);
  assert.equal(big.w, 150); assert.equal(small.w, 15);
  const box = album.partsBox([part("p", 50, 50, 60)], 200, 100);
  assert.deepEqual(plain(box), { l:40, t:-2.5, r:160, b:102.5, cx:100, cy:50 });
});

test("묶음: 하나를 고르면 묶음 전체가 골라지고, 묶음째 복제하면 새 묶음이 된다", () => {
  const album = loadAlbum(), item = { id:"P", type:"image", stickers:["a","b","c","d"].map(id => part(id, 10, 10)) };
  album.useRecords([item]).pick(["a","b"]);
  album.groupParts(item);
  assert.ok(item.stickers[0].g); assert.equal(item.stickers[0].g, item.stickers[1].g);
  assert.deepEqual([...album.withGroups(item, ["a"])].sort(), ["a","b"]);
  assert.equal(album.pickedIsOneGroup(item), true);
  album.pick(["a","b"]); album.duplicateParts(item);
  const copies = item.stickers.slice(4);
  assert.equal(copies.length, 2); assert.equal(copies[0].g, copies[1].g); assert.notEqual(copies[0].g, item.stickers[0].g);
  album.pick(["a","b"]); album.ungroupParts(item);
  assert.equal(item.stickers[0].g, undefined);
});

test("복사·붙여넣기: 사진마다 비끼는 횟수를 따로 세고 묶음 모양을 지킨다", () => {
  const album = loadAlbum();
  const one = { id:"P1", type:"image", stickers:[part("a", 10, 10, 10, 0, { g:"G" }), part("b", 20, 30, 10, 0, { g:"G" })] };
  const two = { id:"P2", type:"image", stickers:[] };
  album.useRecords([one, two], "P1").pick(["a","b"]);
  assert.equal(album.copyParts(one, false), true);
  album.pasteParts(one); album.pasteParts(one);
  assert.deepEqual(one.stickers.slice(2).map(p => [p.x, p.y]), [[14,14],[24,34],[18,18],[28,38]]);
  assert.equal(one.stickers[2].g, one.stickers[3].g); assert.notEqual(one.stickers[2].g, "G");
  album.pasteParts(two);
  assert.deepEqual(two.stickers.map(p => [p.x, p.y]), [[10,10],[20,30]]);
  const edge = { id:"E", type:"image", stickers:[part("e", 98, 50), part("f", 90, 50)] };
  album.useRecords([edge]).pick(["e","f"]); album.copyParts(edge, false); album.pasteParts(edge);
  assert.deepEqual(edge.stickers.slice(2).map(p => p.x), [100, 92]);
  assert.equal(album.pasteParts({ id:"V", type:"video", stickers:[] }), false);
});

test("정렬: 하나는 사진에, 여럿은 고른 둘레에 맞추고 묶음은 한 덩어리로 옮긴다", () => {
  const album = loadAlbum(); album.set("root", stageRoot());
  let item = { stickers:[part("a", 50, 50, 20)] };
  album.pick(["a"]);
  album.alignParts(item, "left"); near(item.stickers[0].x, 10);
  album.alignParts(item, "right"); near(item.stickers[0].x, 90);
  item = { stickers:[part("a", 30, 20, 10), part("b", 60, 70, 20)] };
  album.pick(["a","b"]); album.alignParts(item, "left");
  near(item.stickers[0].x*2 - 10, 50); near(item.stickers[1].x*2 - 20, 50);
  item = { stickers:[part("a", 20, 50, 10, 0, { g:"G" }), part("b", 40, 50, 10, 0, { g:"G" }), part("c", 80, 50)] };
  album.pick(["a","b","c"]); assert.equal(album.pickedUnits(item).length, 2);
  album.alignParts(item, "right");
  near(item.stickers[1].x - item.stickers[0].x, 20); near(item.stickers[1].x, item.stickers[2].x);
  item = { stickers:[part("a", 10, 50), part("b", 30, 50), part("c", 90, 50)] };
  album.pick(["a","b","c"]); album.alignParts(item, "spread-x");
  near(item.stickers[1].x, 50);
});

test("같은 크기로·같은 각도로: 낱개는 제자리, 묶음은 모양을 지킨다", () => {
  const album = loadAlbum(); album.set("root", stageRoot());
  let item = { stickers:[part("a", 20, 50, 10), part("b", 50, 50, 30), part("c", 80, 50, 20)] };
  album.pick(["a","b","c"]); album.matchSizes(item, "largest");
  item.stickers.forEach(p => assert.equal(p.w, 30)); near(item.stickers[0].x, 20);
  item = { stickers:[part("g1", 40, 50, 10, 0, { g:"G" }), part("g2", 60, 50, 10, 0, { g:"G" }), part("s", 80, 50, 15)] };
  album.pick(["g1","g2","s"]); album.matchSizes(item, "smallest");
  assert.equal(item.stickers[0].w, 5); near(item.stickers[1].x - item.stickers[0].x, 10);
  item = { stickers:[part("a", 20, 50, 10, 30), part("b", 60, 50, 10, -70)] };
  album.pick(["a","b"]); album.rotateTo(item, 45);
  assert.equal(item.stickers[0].r, 45); assert.equal(item.stickers[1].r, 45);
  album.rotateTo(item, 270); assert.equal(item.stickers[0].r, -90);
  item = { stickers:[part("g1", 40, 50, 10, 10, { g:"G" }), part("g2", 60, 50, 10, 40, { g:"G" })] };
  album.pick(["g1","g2"]); album.rotateTo(item, 0);
  assert.equal(item.stickers[0].r, 0); assert.equal(item.stickers[1].r, 30);
});

test("자석: 사진과 고르지 않은 장식의 선에만 6px 안에서 붙는다", () => {
  const album = loadAlbum(), item = { stickers:[part("a", 25, 50), part("b", 75, 50)] };
  album.pick(["a"]);
  const lines = album.snapLines(item, 200, 100), box = album.partsBox([item.stickers[0]], 200, 100);
  assert.ok(!lines.xs.includes(40) && lines.xs.includes(140));
  assert.equal(album.snapOffset(box, 57, 0, lines).x, 3);
  assert.equal(album.snapOffset(box, 97, 20, lines).lineX, 140);
  assert.equal(album.snapOffset(box, 30, 20, lines).lineX, null);
});

test("레이어: 이름에 번호를 붙이고, 숨김·잠금은 묶음째 적용돼 고르기에서 빠진다", () => {
  const album = loadAlbum();
  const item = { id:"P", type:"image", stickers:[part("a", 50, 50), { ...part("b", 50, 50), art:"sun" }, part("c", 50, 50, 10, 0, { g:"G" }), { ...part("d", 50, 50, 10, 0, { g:"G" }), art:"crown" }] };
  album.useRecords([item]);
  const names = album.layerNames(item);
  assert.equal(names.get("a"), "동그란 안경 1"); assert.equal(names.get("c"), "동그란 안경 2"); assert.equal(names.get("b"), "선글라스");
  album.pick(["c","d","a"]); album.toggleLayerFlag(item, item.stickers[2], "h");
  assert.equal(item.stickers[3].h, true); assert.deepEqual(album.picked(), ["a"]);
  assert.deepEqual([...album.withGroups(item, ["c","b"])], ["b"]);
  album.toggleLayerFlag(item, item.stickers[0], "l");
  assert.deepEqual([...album.withGroups(item, ["a"])], []);
});

test("직접 그린 장식은 그림을 품고 붙어서 목록에서 지워도 보인다", () => {
  const album = loadAlbum();
  const strokes = plain(album.cleanStrokes([{ c:"red", w:99, p:[[1.234, 500], ["x", 1], [3, 4]] }, { p:[] }]));
  assert.deepEqual(strokes, [{ c:"#1f2937", w:20, f:false, p:[[1.2, 115], [3, 4]] }]);
  assert.equal(album.cleanStrokes([{ p:Array.from({ length:2000 }, (_, i) => [i % 120, 5]) }])[0].p.length, 1500);
  assert.equal(album.strokePath({ p:[[0,0],[10,0],[10,10]], f:true }), "M0 0Q10 0 10 5L10 10Z");
  const record = album.normalizeArt({ type:"art", id:"d1", name:" ", strokes:[{ c:"#ff0000", w:4, p:[[10,10],[50,50],[90,20]] }] });
  assert.equal(record.name, "내 그림");
  album.set("customArts", [record]);
  const item = { id:"P", type:"image", stickers:[] }; album.useRecords([item]);
  album.addSticker(album.customRow(record));
  const placed = item.stickers[0];
  assert.equal(placed.cs.s, record.strokes);
  album.set("customArts", []);
  assert.ok(album.rowOf(placed)); assert.equal(album.rowOf(placed), album.rowOf(placed));
  assertWellFormedXml(svgText(album.partSvg(album.rowOf(placed), { cl:{ t:"#3a5bd9" }, pt:{ p:"dots" }, ol:{ t:3, c:"#ffffff" } })));
});

test("글자 장식: 값 정리·특수문자·크기 맞춤·레이어 이름", () => {
  const album = loadAlbum();
  assert.deepEqual(plain(album.cleanText({ t:"a\r\nb\n1\n2\n3\n4\n5\n6", f:"comic", c:"red", b:false, i:1, a:"justify" })), { t:"a\nb\n1\n2\n3\n4", f:"gothic", c:"#1f2937", b:false, i:true, a:"center" });
  assert.ok(album.textSvg(album.cleanText({ t:`<b>&"'` })).includes("&lt;b&gt;&amp;&quot;&apos;"));
  const size = text => Number(album.textSvg(album.cleanText({ t:text })).match(/font-size="([\d.]+)"/)[1]);
  assert.ok(size("가") > size("가나다라마바사아자차"));
  const item = { id:"P", type:"image", stickers:[] }; album.useRecords([item]);
  album.addText("최고!", "#ff8c42"); album.addText("최고!"); album.addText("안녕");
  assert.deepEqual([...album.layerNames(item).values()], ["최고! 1", "최고! 2", "안녕"]);
  const before = item.stickers[0].tx;
  album.pick([item.stickers[0].id]); album.editText(item, "f", "serif");
  assert.equal(item.stickers[0].tx.f, "serif"); assert.equal(before.f, "gothic");
  assertWellFormedXml(svgText(album.partSvg(album.rowOf(item.stickers[0]), { pt:{ p:"stars" }, ol:{ t:3, c:"#ffffff" } })));
});

test("이모지 장식: 첫 이모지 한 덩어리만 받고 최근 목록을 기억한다", () => {
  const album = loadAlbum();
  assert.equal(album.cleanEmoji("😀abc"), "😀");
  assert.equal(album.cleanEmoji("👨‍👩‍👧 family"), "👨‍👩‍👧");
  assert.equal(album.cleanEmoji("🇰🇷"), "🇰🇷");
  assert.equal(album.cleanEmoji("가"), null);
  album.EMOJI_SETS.forEach(([id, , list]) => { assert.equal(list.length, 20, id); list.forEach(em => assert.equal(album.cleanEmoji(em), em)); });
  const item = { id:"P", type:"image", stickers:[] }; album.useRecords([item]);
  assert.equal(album.addEmoji("🐶 dog", { x:10, y:20 }), true); assert.equal(album.addEmoji("hello"), false);
  album.addEmoji("🐱"); album.addEmoji("🐶");
  assert.deepEqual([...album.recentEmojis()], ["🐶","🐱"]);
  assert.deepEqual([...album.layerNames(item).values()], ["🐶 1","🐱","🐶 2"]);
  assert.equal(album.rowOf(item.stickers[0]), album.rowOf({ art:"emoji", em:"🐶" }));
});
