"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness");

// 사진첩 앨범 책(시안 C · 1단계) — 쪽 채우기·정리·이어 붙이기. 화면 없이 모듈 안 함수만 본다.
const day = (d, h = 9) => new Date(2026, 9, d, h).getTime();
const photo = (id, created, w = 400, h = 300) => ({ id, type:"image", name:id + ".png", width:w, height:h, created, stickers:[] });

test("처음 채우기: 오래된 차례로 날짜별로 묶고, 붙은 작은 날은 한 쪽(4장 이하)에 합친다", () => {
  const album = loadAlbum();
  const records = [
    photo("a1", day(1)), photo("a2", day(1, 10)),                   // 1일 2장
    photo("b1", day(2)),                                             // 2일 1장 → 1일과 합쳐 3장
    ...Array.from({ length:6 }, (_, i) => photo("c" + i, day(4, 9 + i))),   // 4일 6장 → 3·3
    photo("d1", day(5))                                              // 5일 1장 → 따로(합치기는 쪽으로 나누기 전 날 묶음 단위 — 4일 묶음은 6장이라 못 합친다)
  ].reverse();   // 사진첩은 새것부터 들고 있다
  album.useRecords(records);
  const pages = plain(album.autoFillPages(records));
  assert.deepEqual(pages.map(page => page.slots.map(slot => slot.media)), [
    ["a1", "a2", "b1"],
    ["c0", "c1", "c2"],
    ["c3", "c4", "c5"],
    ["d1"]
  ]);
  for (const page of pages){
    assert.equal(page.paper, "cream");
    for (const slot of page.slots){
      assert.ok(slot.w > 0 && slot.w <= 100);
      // 칸은 쪽 안에 들어간다(높이 % = 폭 % × 비율 × 0.75)
      assert.ok(slot.x >= 0 && slot.x + slot.w <= 100.01, "가로가 쪽 밖: " + JSON.stringify(slot));
      assert.ok(slot.y >= 0 && slot.y + slot.w * slot.a * 0.75 <= 100.01, "세로가 쪽 밖: " + JSON.stringify(slot));
    }
  }
});

test("쪽 나누기는 고르게(5→3·2, 6→3·3, 9→3·3·3)", () => {
  const album = loadAlbum();
  assert.deepEqual(plain(album.bookChunkSizes(4)), [4]);
  assert.deepEqual(plain(album.bookChunkSizes(5)), [3, 2]);
  assert.deepEqual(plain(album.bookChunkSizes(6)), [3, 3]);
  assert.deepEqual(plain(album.bookChunkSizes(9)), [3, 3, 3]);
  assert.deepEqual(plain(album.bookChunkSizes(0)), []);
});

test("읽을 때 지워진 사진 칸은 빼고, 값은 범위 안으로 정리한다", () => {
  const album = loadAlbum();
  album.useRecords([photo("keep", day(1))]);
  const book = plain(album.normalizeBook({ pages:[
    { id:"p1", paper:"없는바탕", slots:[{ id:"s1", media:"keep", x:-999, y:50, w:500, r:90 }, { id:"s2", media:"gone", x:1, y:1, w:10, r:0 }],
      texts:[{ id:"t1", text:"안녕", x:5, y:5, s:99, c:"red" }, { nope:true }] },
    null
  ] }));
  assert.equal(book.pages.length, 1);
  assert.equal(book.pages[0].paper, "cream");
  assert.deepEqual(book.pages[0].slots, [{ id:"s1", media:"keep", x:-40, y:50, w:100, r:45 }]);
  assert.deepEqual(book.pages[0].texts, [{ id:"t1", text:"안녕", x:5, y:5, s:14, c:"" }]);
});

test("새로 가져온 사진은 마지막 쪽 빈자리부터, 넘치면 새 쪽에 이어 붙이고 저장한다", async () => {
  const album = loadAlbum();
  const first = [photo("x1", day(1)), photo("x2", day(1, 10)), photo("x3", day(1, 11))];
  album.useRecords(first.slice().reverse());
  album.set("albumItem", { id:album.get("ALBUM_ID"), type:"album", created:0 });
  await album.ensureBook();                                      // 처음 → 3장으로 한 쪽
  assert.deepEqual(plain(album.get("albumItem").book.pages.map(p => p.slots.length)), [3]);
  const more = [photo("y1", day(2)), photo("y2", day(2, 10)), photo("y3", day(2, 11))];
  album.useRecords([...more.slice().reverse(), ...album.get("records")]);
  album.appendToBook(more);
  assert.deepEqual(plain(album.get("albumItem").book.pages.map(p => p.slots.map(s => s.media))), [["x1", "x2", "x3", "y1"], ["y2", "y3"]]);

  // 사진을 지우면 쪽에서도 빠진다
  album.removeFromBook("x2");
  assert.deepEqual(plain(album.get("albumItem").book.pages[0].slots.map(s => s.media)), ["x1", "x3", "y1"]);

  // 저장은 사진첩 전체 기록(type album)으로 간다
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(album.launcher.requests.some(r => r.route === "/photo-album-meta?id=" + encodeURIComponent(album.get("ALBUM_ID"))));
});

test("되돌리기·다시 하기는 쪽 전체를 한 단계씩 오간다", async () => {
  const album = loadAlbum();
  album.useRecords([photo("a", day(1))]);
  album.set("albumItem", { id:album.get("ALBUM_ID"), type:"album", created:0 });
  await album.ensureBook();
  const pages = () => album.get("albumItem").book.pages.length;
  assert.equal(pages(), 1);
  album.addPage(); assert.equal(pages(), 2);
  album.addPage(); assert.equal(pages(), 3);
  album.stepBookHistory(-1); assert.equal(pages(), 2);
  album.stepBookHistory(-1); assert.equal(pages(), 1);
  album.stepBookHistory(1); assert.equal(pages(), 2);
});

test("쪽 장식은 읽을 때 값을 정리하고, 모르는 장식·이모지가 아닌 글자는 버린다", () => {
  const album = loadAlbum();
  album.useRecords([photo("p", day(1))]);
  const book = plain(album.normalizeBook({ pages:[{ id:"p1", slots:[], texts:[], stickers:[
    { id:"s1", art:"round", x:500, y:-50, w:0, r:400, f:1 },
    { id:"s2", art:"emoji", em:"🎉", x:10, y:10, w:12, r:0 },
    { id:"s3", art:"emoji", em:"가", x:10, y:10, w:12 },
    { id:"s4", x:1, y:1 },
    null
  ] }] }));
  assert.deepEqual(book.pages[0].stickers, [
    { id:"s1", art:"round", x:120, y:-20, w:4, r:180, f:true },
    { id:"s2", art:"emoji", x:10, y:10, w:12, r:0, em:"🎉" }
  ]);
  // 새 쪽·자동 채운 쪽은 빈 장식 목록을 갖는다
  const pages = plain(album.autoFillPages([photo("q", day(2))]));
  assert.deepEqual(pages[0].stickers, []);
});

test("이미 만든 쪽 그림은 꾸미기가 같을 때만 바로 쓴다(넘김 복제 쪽이 썸네일을 거치지 않게)", () => {
  const album = loadAlbum();
  const item = { ...photo("p1", day(1)), background:"none" };
  assert.equal(album.composedNow(item), null);
  album.composed.set("p1", { sig:album.composedSig(item), url:"blob:p1", aspect:.75 });
  assert.equal(album.composedNow(item).url, "blob:p1");
  item.stickers = [{ id:"s1", art:"round", x:50, y:50, w:20, r:0 }];
  assert.equal(album.composedNow(item), null, "꾸미기가 바뀌면 옛 그림을 쓰지 않는다");
  assert.deepEqual(plain(album.composedNow({ id:"v1", type:"video", thumbnail:"data:v" })), { url:"data:v", aspect:9/16 });
});

test("사진과 가로·세로 영상을 함께 가져와도 빈 쪽 없이 올바른 비율로 배치한다", () => {
  const album = loadAlbum();
  const records = [photo("p", day(1)), { id:"wide", type:"video", created:day(1), width:1920, height:1080 }, { id:"tall", type:"video", created:day(1), width:720, height:1280 }];
  album.useRecords(records);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[] } });
  album.appendToBook(records);
  const pages = album.get("albumItem").book.pages;
  assert.equal(pages.length, 1);
  assert.deepEqual(plain(pages[0].slots.map(slot => slot.media)), ["p", "wide", "tall"]);
  assert.equal(pages[0].slots[1].a, 1080/1920);
  assert.equal(pages[0].slots[2].a, 1280/720);
  assert.ok(pages.every(page => page.slots.length > 0));
  for (const slot of pages[0].slots){
    assert.ok(slot.x + slot.w <= 100.01);
    assert.ok(slot.y + slot.w * slot.a * .75 <= 100.01);
  }
  clearTimeout(album.get("bookSaveTimer"));
});

test("재실행·다시 가져오기는 예전 자동 빈 쪽을 정리하되 직접 만든 빈 쪽과 글 쪽은 보존한다", async () => {
  const album = loadAlbum();
  const p = photo("p", day(1)); album.useRecords([p]);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[
    { id:"ghost", slots:[], texts:[], stickers:[] },
    { id:"used", slots:[{ id:"s", media:"p" }], texts:[], stickers:[] },
    { id:"manual", slots:[], texts:[], stickers:[], keepEmpty:true },
    { id:"note", slots:[], texts:[{ id:"t", text:"기억" }], stickers:[] }
  ] } });
  await album.ensureBook();
  assert.deepEqual(plain(album.get("albumItem").book.pages.map(page => page.id)), ["used", "manual", "note"]);
  assert.equal(album.get("albumItem").book.pages[1].keepEmpty, true);
  const v = { id:"v", type:"video", created:day(2), width:720, height:1280 };
  album.useRecords([v, p]); album.appendToBook([v]);
  assert.deepEqual(plain(album.get("albumItem").book.pages.map(page => page.id)), ["used", "manual", "note"]);
  assert.equal(album.get("albumItem").book.pages[2].slots[0].media, "v");
  clearTimeout(album.get("bookSaveTimer"));
});

test("중간 쪽의 마지막 사진 삭제는 자동 빈 쪽을 빼고 뒤쪽 선택의 쪽 번호를 맞춘다", () => {
  const album = loadAlbum(); album.useRecords([photo("a", day(1)), photo("b", day(2))]);
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[
    { id:"p1", slots:[{ id:"a-slot", media:"a" }], texts:[], stickers:[] },
    { id:"p2", slots:[{ id:"b-slot", media:"b" }], texts:[], stickers:[] }
  ] } });
  album.set("bookPage", 1).set("bookPick", { kind:"slot", page:1, id:"b-slot" });
  album.removeFromBook("a");
  assert.deepEqual(plain(album.get("albumItem").book.pages.map(page => page.id)), ["p2"]);
  assert.equal(album.get("bookPage"), 0);
  assert.equal(album.get("bookPick").page, 0);
  clearTimeout(album.get("bookSaveTimer"));
});
