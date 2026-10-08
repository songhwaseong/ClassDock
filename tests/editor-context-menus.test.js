"use strict";

// 브라우저 없이 실제 메뉴 콜백을 실행해 대상 선택·저장·되돌리기와 우클릭 입력 경계를 확인한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadAlbum, plain } = require("./photo-album-harness");
const tier = require("../src/js/tier-list");
const study = require("../src/js/study-doc");
const concept = require("../src/js/concept-doc");

const source = name => fs.readFileSync(path.join(__dirname, "../src/js", name), "utf8");
const part = (id, extra = {}) => ({ id, art:"round", x:40, y:40, w:10, r:0, ...extra });
const photo = (id, stickers = []) => ({ id, type:"image", name:id + ".png", stickers, width:400, height:300, created:0 });
const menuSpy = () => ({ items:[], open(x, y, items, options){ this.items = items; this.options = options; return () => options.onClose(); } });
const eventFor = nodes => ({
  clientX:100, clientY:80, defaultPrevented:false, stopped:false,
  target:{ closest:selector => nodes[selector] || null },
  preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){ this.stopped = true; }
});
const action = (menu, label) => {
  const item = menu.find(row => row.label === label); assert.ok(item, label);
  assert.ok(!item.disabled, label + " enabled"); return item;
};
function albumHarness(){
  const menu = menuSpy();
  const album = loadAlbum({ context:{ MNContextMenu:menu, window:{}, document:{ activeElement:null } } });
  return { album, menu };
}
async function bookHarness(){
  const result = albumHarness(), media = photo("P");
  result.album.useRecords([media]).set("albumItem", { id:result.album.get("ALBUM_ID"), type:"album", created:0 });
  await result.album.ensureBook();
  return { ...result, media };
}

test("사진첩: 우클릭한 장식을 선택하고, 이미 선택한 묶음 안에서는 여러 선택을 유지한다", () => {
  const { album, menu } = albumHarness(), item = photo("P", [part("a", { g:"g" }), part("b", { g:"g" }), part("c")]);
  album.useRecords([item]).pick(["c"]);
  const e = eventFor({ ".pa-part":{ dataset:{ id:"a" } }, ".pa-stage":{} });
  album.onAlbumContextMenu(e);
  assert.deepEqual(album.picked(), ["a", "b"]);
  assert.equal(e.defaultPrevented, true); assert.equal(e.stopped, true);
  album.pick(["a", "b", "c"]); album.onAlbumContextMenu(e);
  assert.deepEqual(album.picked(), ["a", "b", "c"]);
  action(menu.items, "복사").action();
  assert.deepEqual(plain(album.get("partClipboard").parts).map(row => row.id), ["a", "b", "c"]);
});

test("사진첩: 메뉴 뒤집기는 선택한 장식에만 적용되고 사진 이력으로 되돌린다", () => {
  const { album } = albumHarness(), item = photo("P", [part("a"), part("b")]);
  album.useRecords([item]).pick(["b"]); album.trackHistory(item);
  const flip = action(album.albumPartMenuItems(item), "뒤집기").children[0];
  flip.action(); assert.equal(!!item.stickers[0].f, false); assert.equal(item.stickers[1].f, true);
  album.stepHistory(-1); assert.equal(!!item.stickers[1].f, false);
});

test("사진첩: 다른 미디어를 우클릭한 즐겨찾기는 그 대상에만 저장된다", () => {
  const { album, menu } = albumHarness(), a = photo("a"), b = photo("b");
  album.useRecords([a, b], "a");
  album.onAlbumContextMenu(eventFor({ ".pa-media-card,.pa-book-tray-item":{ dataset:{ mediaId:"b" } } }));
  action(menu.items, "즐겨찾기").action();
  assert.equal(b.favorite, true); assert.equal(!!a.favorite, false); assert.equal(album.get("selectedId"), "a");
  assert.ok(album.launcher.requests.some(row => row.route === "/photo-album-meta?id=b"));
});

test("사진첩: 쪽 사진 메뉴로 뺀 사진의 원본을 유지하고 쪽 이력에서 복원한다", async () => {
  const { album, menu, media } = await bookHarness(), slot = album.get("albumItem").book.pages[0].slots[0];
  album.onAlbumContextMenu(eventFor({ ".pa-page,.pa-book-thumb":{ dataset:{ index:"0" } }, ".pa-slot":{ dataset:{ id:slot.id } } }));
  assert.equal(album.get("bookPick").id, slot.id);
  action(menu.items, "쪽에서 빼기 (사진은 사진첩에 남음)").action();
  assert.equal(album.get("albumItem").book.pages[0].slots.length, 0); assert.equal(album.get("records")[0], media);
  album.stepBookHistory(-1); assert.equal(album.get("albumItem").book.pages[0].slots[0].id, slot.id);
});

test("사진첩: 책 감상 중에는 페이지 편집 메뉴가 나오지 않는다", async () => {
  const { album, menu } = await bookHarness(); album.set("bookReading", true);
  album.onAlbumContextMenu(eventFor({ ".pa-page,.pa-book-thumb":{ dataset:{ index:"0" } } }));
  assert.deepEqual(plain(menu.items.map(row => row.label)), ["책 감상 끝내기", "이전 쪽", "다음 쪽"]);
  assert.equal(menu.items.find(row => row.label === "다음 쪽").disabled, true);
});

test("사진첩: 쪽 장식 메뉴 복제는 새 ID와 선택을 만들고 되돌릴 수 있다", async () => {
  const { album } = await bookHarness(), page = album.get("albumItem").book.pages[0], sticker = part("deco");
  page.stickers.push(sticker); album.bookChanged();
  action(album.albumPageMenuItems(0, { kind:"sticker", id:"deco" }), "복제").action();
  assert.equal(page.stickers.length, 2); assert.notEqual(page.stickers[1].id, "deco");
  assert.equal(album.get("bookPick").id, page.stickers[1].id);
  album.stepBookHistory(-1); assert.equal(album.get("albumItem").book.pages[0].stickers.length, 1);
});

test("사진첩: 입력칸의 우클릭을 대상 메뉴가 가로채지 않으며 오른쪽 드래그는 변형하지 않는다", () => {
  const { album, menu } = albumHarness();
  const e = eventFor({ "input,textarea,select,[contenteditable]":{} }); album.onAlbumContextMenu(e);
  assert.equal(e.defaultPrevented, false); assert.equal(menu.items.length, 0);
  const right = { button:2, preventDefault(){ assert.fail("right drag consumed"); } };
  album.partHandleDrag(right, [part("a")], photo("P"), {}, "rotate");
  album.startTextDrag(right, 0, {}, {}); album.startSlotDrag(right, 0, {}, {}, "resize");
  album.startStickerDrag(right, 0, {}, {}, "resize");
});

// 메뉴 이벤트 함수만 실제 소스에서 가져오고 저장·화면 렌더링 경계는 흉내 낸다.
function loadHandler(file, start, end, name, context){
  const text = source(file), from = text.indexOf(start), to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  vm.createContext(context); vm.runInContext(text.slice(from, to) + "\nthis.handle = " + name + ";", context);
  return context;
}
function editorContext(model){
  const menu = menuSpy(), counts = { render:0, commit:0, touch:0 };
  return { model, MNContextMenu:menu, menu, counts, selectedId:"", render:() => counts.render++, touch:() => counts.touch++,
    history:{ canUndo:() => false, canRedo:() => false, commit:() => counts.commit++, undo(){}, redo(){} }, clearTimeout };
}

test("티어표: 우클릭한 카드의 줄 이동은 그 카드만 바꾸고 저장·이력을 갱신한다", () => {
  const model = tier.tierDocEmpty("test"); model.items = [tier.tierNormalizeItem({ id:"a" }), tier.tierNormalizeItem({ id:"b" })];
  const c = editorContext(model);
  Object.assign(c, { tierMoveItem:tier.tierMoveItem, tierItemsIn:tier.tierItemsIn, TIER_MAX_ITEMS:400,
    changed:() => { c.counts.commit++; c.counts.touch++; }, tierToolMenuItems:() => [], openItemDialog(){}, deleteItem(){} });
  loadHandler("tier-list.js", "  let closeTierMenu = null;", "  board.addEventListener(\"contextmenu\"", "onTierContextMenu", c);
  c.handle(eventFor({ ".tier-item":{ dataset:{ itemId:"b" } } }));
  assert.equal(c.selectedId, "b");
  action(c.menu.items, "줄로 이동").children[1].action();
  assert.equal(model.items.find(row => row.id === "a").tier, ""); assert.equal(model.items.find(row => row.id === "b").tier, model.tiers[0].id);
  assert.equal(c.counts.commit, 1); assert.equal(c.counts.touch, 1);
});

test("암기 카드: 우클릭 복제는 내용은 보존하고 학습 이력과 ID를 새로 시작한다", () => {
  const model = study.studyDocEmpty("test"), card = study.studyNormalizeCard({ id:"a", front:"질문", back:"정답", result:"good", reviews:5, streak:3, due:"2026-10-09", lastReviewed:"2026-10-08" });
  model.cards.push(card); const c = editorContext(model);
  Object.assign(c, { STUDY_MAX_CARDS:1000, studyNormalizeCard:study.studyNormalizeCard, studyId:() => "copy",
    visibleCards:() => model.cards, startSession(){}, openCardDialog(){}, deleteCard(){}, saveStudyDoc(){}, doc:{} });
  loadHandler("study-doc.js", "  let closeStudyMenu = null;", "  list.addEventListener(\"contextmenu\"", "onStudyContextMenu", c);
  c.handle(eventFor({ ".study-list-card":{ dataset:{ cardId:"a" } } })); action(c.menu.items, "카드 복제").action();
  const copy = model.cards[1]; assert.equal(copy.front, card.front); assert.equal(copy.back, card.back); assert.equal(copy.id, "copy");
  assert.equal(copy.result, "new"); assert.equal(copy.reviews, 0); assert.equal(copy.streak, 0); assert.equal(copy.due, ""); assert.equal(copy.lastReviewed, "");
  assert.equal(c.counts.commit, 1); assert.equal(c.counts.touch, 1);
});

test("관계도: 선택한 연결선의 우클릭 강도·삭제는 여러 선택을 유지한다", () => {
  const model = concept.conceptDocEmpty("test"); model.edges = [{ id:"a", weight:2 }, { id:"b", weight:2 }, { id:"c", weight:3 }];
  const c = editorContext(model);
  Object.assign(c, { previewTimer:0, selectedEdgeIds:new Set(["a", "b"]), selectEdge(){ assert.fail("multi-selection lost"); },
    CONCEPT_MAX_NODES:300, CONCEPT_MAX_EDGES:1000, openNodeDialog(){}, openEdgeDialog(){}, openAutoLayoutDialog(){},
    openTableOutlineDialog(){}, openPresentationOrderDialog(){}, saveConceptDoc(){}, doc:{} });
  loadHandler("concept-doc.js", "  async function deleteNode(id){", "  viewport.addEventListener(\"contextmenu\"", "onConceptContextMenu", c);
  c.handle(eventFor({ ".concept-edge":{ dataset:{ edgeId:"a" } } }));
  action(c.menu.items, "관계 강도").children[4].action(); assert.deepEqual(model.edges.map(row => row.weight), [5,5,3]);
  action(c.menu.items, "선택한 관계 삭제").action(); assert.deepEqual(model.edges.map(row => row.id), ["c"]);
  assert.equal(c.counts.commit, 2); assert.equal(c.counts.touch, 2);
});

test("이미지 편집: 오른쪽 버튼은 자르기·그리기·자르기 틀 이동을 시작하지 않는다", () => {
  const text = source("image-viewer.js"), handlers = [], c = { state:{ output:{}, cropMode:true, cropRect:{} } };
  c.canvas = c.cropBox = { addEventListener:(type, handler) => handlers.push(handler), setPointerCapture(){ assert.fail("right capture"); } };
  vm.createContext(c);
  for (const [start, end] of [["  canvas.addEventListener(\"pointerdown\"", "  canvas.addEventListener(\"pointermove\""], ["  cropBox.addEventListener(\"pointerdown\"", "  cropBox.addEventListener(\"pointermove\""]]){
    const from = text.indexOf(start); vm.runInContext(text.slice(from, text.indexOf(end, from)), c);
  }
  for (const handler of handlers) handler({ button:2, preventDefault(){ assert.fail("right edit"); } });
  assert.equal(c.state.dragStart, undefined);
});
