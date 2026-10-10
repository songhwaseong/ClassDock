"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness");

const photo = (id, extra = {}) => ({ id, type:"image", name:id + ".png", created:1, stickers:[], ...extra });
const page = (id, media) => ({ id, paper:"cream", slots:media.map((value, at) => ({ id:id + at, media:value })), texts:[], stickers:[] });

function deletingAlbum(context = {}){
  const confirmations = [], revoked = [], messages = [], status = {};
  const album = loadAlbum({ context:{
    confirmDialog:async (...args) => { confirmations.push(args); return true; },
    URL:{ revokeObjectURL:url => revoked.push(url) },
    requestAnimationFrame:() => 0,
    toast:message => messages.push(message),
    ...context
  } });
  const root = album.get("root");
  root.querySelector = selector => selector === ".pa-status" ? status : null;
  return { album, confirmations, revoked, messages, status };
}

test("여러 장 선택은 두 화면에서 이어지고, 전체 선택은 현재 필터만 바꾼다", () => {
  const { album } = deletingAlbum();
  album.useRecords([photo("a"), photo("b", { favorite:true }), photo("v", { type:"video" })]);
  album.setMediaSelecting(true);
  album.toggleMediaSelection("a");
  album.setAlbumMode("edit");
  assert.deepEqual([...album.get("mediaPicked")], ["a"]);
  album.set("filter", "video");
  album.selectAllMedia("edit");
  assert.deepEqual([...album.get("mediaPicked")], ["a", "v"]);
  album.selectAllMedia("edit");
  assert.deepEqual([...album.get("mediaPicked")], ["a"]);
  album.setAlbumMode("book");
  album.selectAllMedia("book");
  assert.deepEqual([...album.get("mediaPicked")], ["a", "b", "v"]);
  album.selectAllMedia("book");
  assert.equal(album.get("mediaPicked").size, 0);
  album.toggleMediaSelection("missing");
  assert.equal(album.get("mediaPicked").size, 0);
  album.toggleMediaSelection("b");
  album.setMediaSelecting(false);
  assert.equal(album.get("mediaPicked").size, 0);
});

test("선택 삭제는 한 번 확인하고 모든 쪽·1장 보기·선택·캐시에서 성공한 항목을 제거한다", async () => {
  const { album, confirmations, revoked } = deletingAlbum();
  const items = [photo("a", { music:{ tracks:[{ id:"shared" }, { id:"unused" }] } }), photo("b"), photo("keep", { music:{ tracks:[{ id:"shared" }] } })];
  album.useRecords(items, "a").pick(["sticker"]);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page("p1", ["a", "keep"]), page("p2", ["a", "b"])] } });
  album.set("audioRecords", [{ id:"shared", type:"audio" }, { id:"unused", type:"audio" }]);
  album.set("bookPick", { kind:"slot", page:1, id:"p20" });
  album.setMediaSelecting(true); album.selectAllMedia("book");
  album.composed.set("a", { url:"blob:a" });
  album.histories.set("a", { undo:[] });
  await album.removeMediaItems([items[0], items[1], items[0], photo("missing")]);

  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0][0], /선택한 사진·영상 2개/);
  assert.match(confirmations[0][0], /앨범 쪽과 1장 보기/);
  assert.deepEqual(album.launcher.deleted(), ["a", "b", "unused"]);
  assert.deepEqual(plain(album.get("records").map(item => item.id)), ["keep"]);
  assert.deepEqual(plain(album.get("albumItem").book.pages.map(row => row.slots.map(slot => slot.media))), [["keep"]]);
  assert.equal(album.get("selectedId"), "keep");
  assert.deepEqual(album.picked(), []);
  assert.equal(album.get("bookPick"), null);
  assert.deepEqual([...album.get("mediaPicked")], ["keep"]);
  assert.equal(album.composed.has("a"), false);
  assert.equal(album.histories.has("a"), false);
  assert.deepEqual(revoked, ["blob:a"]);
  assert.equal(album.get("bookSaveTimer"), 0);
  assert.ok(album.launcher.requests.some(request => request.route === "/photo-album-meta?id=" + encodeURIComponent(album.ALBUM_ID)));
});

test("전체 삭제는 사진·영상과 모든 쪽을 초기화하고 전체 음악과 내 그림은 보존한다", async () => {
  const { album, confirmations } = deletingAlbum();
  const items = [photo("a", { music:{ tracks:[{ id:"album-song" }] } }), photo("v", { type:"video" })];
  const p = page("p", ["a", "v"]); p.texts.push({ id:"t", text:"기억" }); p.stickers.push({ id:"s", art:"round" });
  album.useRecords(items);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", music:{ tracks:[{ id:"album-song" }] }, book:{ v:1, pages:[p] } });
  album.set("audioRecords", [{ id:"album-song", type:"audio" }]);
  album.set("customArts", [{ id:"drawing", type:"art" }]);
  album.setMediaSelecting(true); album.selectAllMedia("book");
  await album.removeMediaItems(items, { all:true });
  assert.match(confirmations[0][0], /전체 2개/);
  assert.equal(confirmations[0][1], "전체 삭제");
  assert.deepEqual(album.launcher.deleted(), ["a", "v"]);
  assert.equal(album.get("records").length, 0);
  assert.equal(album.get("mediaSelecting"), false);
  assert.equal(album.get("mediaPicked").size, 0);
  assert.equal(album.get("albumItem").book.pages.length, 0);
  assert.match(confirmations[0][0], /쪽의 글과 장식/);
  assert.equal(album.get("bookPage"), 0);
  assert.equal(album.get("bookSpread"), 0);
  assert.equal(album.get("bookPick"), null);
  assert.equal(album.get("bookHistory").undo.length, 0);
  assert.equal(album.get("audioRecords").length, 1);
  assert.equal(album.get("customArts")[0].id, "drawing");
});

test("삭제 취소는 저장소·쪽·선택을 바꾸지 않는다", async () => {
  const { album } = deletingAlbum({ confirmDialog:async () => false });
  const item = photo("a"); album.useRecords([item]);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page("p", ["a"])] } });
  album.setMediaSelecting(true); album.toggleMediaSelection("a");
  await album.removeMediaItems([item]);
  assert.deepEqual(album.launcher.deleted(), []);
  assert.equal(album.get("records")[0].id, "a");
  assert.equal(album.get("albumItem").book.pages[0].slots[0].media, "a");
  assert.deepEqual([...album.get("mediaPicked")], ["a"]);
  assert.equal(album.get("mediaDeleteBusy"), false);
});

test("목록에서 Delete를 눌러도 앨범의 고른 칸을 빼지 않고 선택한 원본의 삭제 확인을 연다", async () => {
  const confirmations = [];
  const { album } = deletingAlbum({ confirmDialog:async message => { confirmations.push(message); return false; } });
  album.useRecords([photo("a"), photo("b")]);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page("p", ["a", "b"])] } });
  album.set("bookPick", { kind:"slot", page:0, id:"p1" });
  album.setMediaSelecting(true); album.toggleMediaSelection("a");
  let prevented = false;
  album.onHistoryKey({ key:"Delete", target:{ closest:() => ({}) }, preventDefault:() => { prevented = true; } });
  await Promise.resolve();
  assert.equal(prevented, true);
  assert.equal(confirmations.length, 1);
  assert.equal(album.get("albumItem").book.pages[0].slots.length, 2);
  assert.deepEqual(album.launcher.deleted(), []);
});

test("일부 삭제 실패는 해당 사진을 목록과 쪽에 남기고 나머지는 계속 삭제한다", async () => {
  const requests = [];
  const { album, messages } = deletingAlbum({ fetch:async route => {
    requests.push(route);
    return { ok:!route.endsWith("id=b"), status:500 };
  } });
  const items = [photo("a"), photo("b"), photo("c")];
  album.useRecords(items);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page("p", ["a", "b", "c"])] } });
  album.setMediaSelecting(true); album.selectAllMedia("book");
  await album.removeMediaItems(items);
  assert.deepEqual(plain(album.get("records").map(item => item.id)), ["b"]);
  assert.deepEqual(plain(album.get("albumItem").book.pages[0].slots.map(slot => slot.media)), ["b"]);
  assert.equal(album.get("selectedId"), "b");
  assert.deepEqual([...album.get("mediaPicked")], ["b"]);
  assert.ok(requests.includes("/photo-album-delete?id=c"));
  assert.match(messages.at(-1), /2개를 삭제했습니다. 1개는 삭제하지 못했습니다/);
  assert.equal(album.get("mediaDeleteBusy"), false);
});

test("쪽 저장 실패 후에도 다음 사진을 고르고 사용하지 않는 음악을 정리한다", async () => {
  const requests = [];
  const { album, messages } = deletingAlbum({ fetch:async route => {
    requests.push(route);
    return { ok:!route.startsWith("/photo-album-meta"), status:500 };
  } });
  const items = [photo("a", { music:{ tracks:[{ id:"unused" }] } }), photo("keep")];
  album.useRecords(items);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page("p", ["a", "keep"])] } });
  album.set("audioRecords", [{ id:"unused", type:"audio" }]);
  await album.removeMedia(items[0]);
  assert.equal(album.get("selectedId"), "keep");
  assert.ok(requests.includes("/photo-album-delete?id=unused"));
  assert.match(messages.at(-1), /앨범 쪽 정보를 저장하지 못했습니다/);
  assert.equal(album.get("mediaDeleteBusy"), false);
});

test("확인창을 기다리는 동안 중복 삭제와 선택 변경을 막는다", async () => {
  let resolveConfirm, confirmations = 0;
  const { album } = deletingAlbum({ confirmDialog:() => { confirmations++; return new Promise(resolve => { resolveConfirm = resolve; }); } });
  const item = photo("a"); album.useRecords([item]);
  album.setMediaSelecting(true); album.toggleMediaSelection("a");
  const pending = album.removeMediaItems([item]);
  assert.equal(album.get("mediaDeleteBusy"), true);
  await album.removeMedia(item);
  album.toggleMediaSelection("a"); album.setMediaSelecting(false); album.selectAllMedia("book");
  assert.equal(confirmations, 1);
  assert.equal(album.get("mediaSelecting"), true);
  assert.deepEqual([...album.get("mediaPicked")], ["a"]);
  resolveConfirm(true); await pending;
  assert.deepEqual(album.launcher.deleted(), ["a"]);
  assert.equal(album.get("mediaDeleteBusy"), false);
});

test("브라우저 저장소에서도 여러 장을 지우고 앨범 쪽을 한 번 저장한다", async () => {
  const { album } = deletingAlbum();
  const items = [photo("a"), photo("v", { type:"video" })], data = new Map(items.map(item => [item.id, item])), transactions = [];
  album.useRecords(items).set("nativeStorage", false);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page("p", ["a", "v"])] } });
  album.set("dbPromise", Promise.resolve({ transaction:(_store, mode) => {
    transactions.push(mode);
    const tx = { objectStore:() => ({
      delete:id => { data.delete(id); return { result:undefined }; },
      put:item => { data.set(item.id, plain(item)); return { result:item.id }; }
    }) };
    queueMicrotask(() => tx.oncomplete()); return tx;
  } }));
  await album.removeMediaItems(items);
  assert.deepEqual([...data.keys()], [album.ALBUM_ID]);
  assert.deepEqual(data.get(album.ALBUM_ID).book.pages, []);
  assert.equal(transactions.length, 3);
  assert.deepEqual(album.launcher.deleted(), []);
});

test("사진·영상 없이 남은 쪽도 전체 삭제로 초기화하고 하단 미리보기를 감춘다", async () => {
  const { album, confirmations } = deletingAlbum();
  album.useRecords([]);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[{ ...page("p", []), keepEmpty:true }] } });
  album.set("bookPage", 3).set("bookSpread", 2);
  await album.removeMediaItems([], { all:true });
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0][0], /남은 1쪽/);
  assert.equal(album.get("albumItem").book.pages.length, 0);
  assert.equal(album.get("bookSaveTimer"), 0);
  assert.ok(album.launcher.requests.some(request => request.route.startsWith("/photo-album-meta")));
  const strip = { replaceChildren(){}, hidden:false };
  album.get("root").querySelector = selector => selector === ".pa-book-thumbs" ? strip : null;
  album.paintBookThumbs();
  assert.equal(strip.hidden, true);
});

test("전체 삭제가 일부 실패하면 남은 사진과 그 쪽은 유지한다", async () => {
  const { album } = deletingAlbum({ fetch:async route => ({ ok:!route.endsWith("id=b"), status:500 }) });
  const items = [photo("a"), photo("b")]; album.useRecords(items);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page("p1", ["a"]), page("p2", ["b"])] } });
  await album.removeMediaItems(items, { all:true });
  assert.deepEqual(plain(album.get("records").map(item => item.id)), ["b"]);
  assert.deepEqual(plain(album.get("albumItem").book.pages.map(row => row.slots.map(slot => slot.media))), [["b"]]);
});
