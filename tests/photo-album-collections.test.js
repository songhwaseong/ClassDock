"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness");

const photo = id => ({ id, type:"image", name:id + ".png", created:1, width:400, height:300, stickers:[] });
const page = (id, ids) => ({ id, paper:"sky", slots:ids.map(media => ({ id:id + media, media, x:12, y:17, w:40, r:3 })), texts:[], stickers:[] });
function fixture(t, context = {}){
  const writes = [], deleted = [], messages = [];
  const album = loadAlbum({ context:{
    confirmDialog:async () => true, requestAnimationFrame:() => 0,
    URL:{ revokeObjectURL(){} }, toast:message => messages.push(message),
    fetch:async (route, options = {}) => {
      if (route.startsWith("/photo-album-meta")) writes.push(JSON.parse(options.body));
      if (route.startsWith("/photo-album-delete")) deleted.push(decodeURIComponent(route.split("id=")[1]));
      return { ok:true, status:200, blob:async () => new Blob(["stored:" + route]) };
    }, ...context
  } });
  t.after(() => clearTimeout(album.bookSaveTimer));
  return { album, writes, deleted, messages };
}
async function prepare(album, items = [photo("a"), photo("b")]){
  album.useRecords(items);
  await album.initializeAlbums([{ id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page("old", items.map(item => item.id))] } }]);
  await album.ensureBook();
  return album.albumItem;
}

test("기존 사진·쪽·글·장식·음악은 기본 앨범으로 보존되고 재실행 때 중복 이관하지 않는다", async t => {
  const { album, writes } = fixture(t);
  const items = [photo("a"), photo("unplaced")]; album.useRecords(items);
  const old = { id:album.ALBUM_ID, type:"album", music:{ tracks:[{ id:"song" }] }, book:{ v:1, pages:[
    { ...page("kept", ["a"]), texts:[{ id:"txt", text:"가족 여행", x:10, y:80, s:5 }], stickers:[{ id:"hat", art:"crown", x:50, y:30, w:20, r:0 }] },
    { ...page("blank", []), keepEmpty:true }
  ] } };
  const previous = JSON.stringify(old);
  await album.initializeAlbums([old]);
  assert.equal(JSON.stringify(old), previous);
  assert.equal(album.albumItem.name, "기본 앨범");
  assert.deepEqual(plain(album.albumItem.mediaIds), ["a", "unplaced"]);
  assert.equal(album.albumItem.book.pages[0].slots[0].x, 12);
  assert.equal(album.albumItem.book.pages[0].texts[0].text, "가족 여행");
  assert.equal(album.albumItem.book.pages[0].stickers[0].art, "crown");
  assert.equal(album.albumItem.book.pages[1].keepEmpty, true);
  assert.deepEqual(plain(album.albumItem.music), old.music);
  const saved = plain(album.albums); writes.length = 0;
  await album.initializeAlbums(saved);
  assert.equal(writes.length, 0);
  assert.equal(album.albumItem.book.pages.length, 2);
});

test("새 앨범은 빈 책으로 시작하고 이름 변경·이름 중복 검증·선택 복원을 지원한다", async t => {
  const { album, writes } = fixture(t); const basic = await prepare(album);
  const family = await album.createAlbum("  가족 앨범  ");
  assert.equal(family.name, "가족 앨범"); assert.equal(album.albumItem, family);
  assert.deepEqual(plain(family.mediaIds), []); assert.equal(family.book.pages.length, 0);
  assert.equal(basic.book.pages.length, 1);
  assert.match(album.albumNameError("가족 앨범"), /같은 이름/);
  assert.match(album.albumNameError(" "), /이름을 입력/);
  assert.match(album.albumNameError("a".repeat(61)), /60자/);
  assert.equal(await album.createAlbum("가족 앨범"), null);
  assert.equal(await album.renameAlbum("친구 앨범"), true);
  assert.equal(writes.at(-1).name, "친구 앨범");
  await album.initializeAlbums(plain(album.albums));
  assert.equal(album.albumItem.id, family.id);
});

test("앨범 목록·필터·전체 선택은 현재 앨범을 따르고 전체 사진에서 다른 앨범 사진도 고를 수 있다", async t => {
  const { album } = fixture(t); const basic = await prepare(album);
  const family = await album.createAlbum("가족"); family.mediaIds = ["a"];
  assert.deepEqual(plain(album.shownRecords().map(item => item.id)), ["a"]);
  album.setMediaSelecting(true); album.selectAllMedia("book");
  assert.deepEqual([...album.mediaPicked], ["a"]);
  album.set("libraryView", true); album.selectAllMedia("book");
  assert.deepEqual([...album.mediaPicked], ["a", "b"]);
  await album.switchAlbum(basic.id);
  assert.equal(album.libraryView, false); assert.equal(album.mediaPicked.size, 0);
});

test("사진 하나를 여러 앨범에 추가해도 원본과 꾸미기를 공유하고 책 배치는 독립적이다", async t => {
  const { album, deleted } = fixture(t); const basic = await prepare(album);
  const family = await album.createAlbum("가족"), travel = await album.createAlbum("여행");
  album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(family.id);
  album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(travel.id);
  const familySlot = family.book.pages[0].slots[0]; familySlot.x = 45;
  assert.notEqual(familySlot, travel.book.pages[0].slots[0]);
  assert.notEqual(travel.book.pages[0].slots[0].x, 45);
  album.records[0].background = "mint";
  assert.equal(album.albumMedia(family)[0], album.albumMedia(travel)[0]);
  assert.equal(album.albumMedia(family)[0].background, "mint");
  album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(family.id);
  assert.equal(family.book.pages[0].slots.length, 1);
  assert.equal(album.records.length, 2); assert.deepEqual(deleted, []);
  assert.equal(basic.book.pages[0].slots.length, 2);
});

test("앨범 간 이동은 원래 앨범에서만 빼고 다른 앨범과 쪽의 글·장식은 보존한다", async t => {
  const { album, deleted } = fixture(t); const basic = await prepare(album);
  basic.book.pages[0].texts.push({ id:"memo", text:"남길 글" });
  const family = await album.createAlbum("가족"), travel = await album.createAlbum("여행");
  album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(travel.id);
  await album.switchAlbum(basic.id);
  album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(family.id, true);
  assert.deepEqual(plain(basic.mediaIds), ["b"]);
  assert.deepEqual(plain(basic.book.pages[0].slots.map(slot => slot.media)), ["b"]);
  assert.equal(basic.book.pages[0].texts[0].text, "남길 글");
  assert.deepEqual(plain(family.mediaIds), ["a"]); assert.deepEqual(plain(travel.mediaIds), ["a"]);
  assert.equal(album.records.length, 2); assert.deepEqual(deleted, []);
  assert.equal(album.bookHistory.undo.length, 0);
});

test("앨범에서 빼기는 전체 사진에 남으며 재실행 때 기본 앨범에 다시 넣지 않는다", async t => {
  const { album, deleted } = fixture(t); const basic = await prepare(album);
  album.set("mediaPicked", new Set(["a"])); await album.removeAlbumMedia();
  assert.deepEqual(plain(basic.mediaIds), ["b"]); assert.equal(album.records.length, 2);
  await album.initializeAlbums(plain(album.albums));
  assert.deepEqual(plain(album.albumItem.mediaIds), ["b"]);
  album.set("libraryView", true); assert.equal(album.shownRecords().length, 2);
  assert.deepEqual(deleted, []);
});

test("앨범을 바꾸기 전에 대기 중인 쪽 저장을 끝내고 되돌리기와 보던 쪽을 앨범별로 기억한다", async t => {
  const { album, writes } = fixture(t); const basic = await prepare(album);
  album.addPage(); album.addPage();
  const family = await album.createAlbum("가족");
  const oldSaved = writes.filter(item => item.id === basic.id).at(-1);
  assert.equal(oldSaved.book.pages.length, 3); assert.equal(oldSaved.lastPage, 2);
  assert.equal(album.bookSaveTimer, 0); assert.equal(album.bookHistory.undo.length, 0);
  album.addPage(); await album.switchAlbum(basic.id);
  assert.equal(album.bookPage, 2); assert.equal(album.bookHistory.undo.length, 2);
  album.stepBookHistory(-1); assert.equal(basic.book.pages.length, 2);
  await album.switchAlbum(family.id);
  assert.equal(family.book.pages.length, 1); assert.equal(album.bookHistory.undo.length, 1);
});

test("사진첩 삭제는 모든 앨범의 소속·사진 칸을 지우고 재실행에도 복원되지 않는다", async t => {
  const { album, deleted } = fixture(t); const basic = await prepare(album);
  const family = await album.createAlbum("가족");
  album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(family.id);
  await album.removeMedia(album.records.find(item => item.id === "a"));
  assert.deepEqual(deleted, ["a"]);
  assert.deepEqual(plain(basic.mediaIds), ["b"]); assert.deepEqual(plain(family.mediaIds), []);
  assert.equal(family.book.pages.length, 0);
  await album.initializeAlbums(plain(album.albums));
  assert.equal(album.albumMedia().length, 0);
});

test("전체 삭제는 사진이 없는 다른 앨범의 글 쪽까지 정리하되 앨범 이름·음악은 남긴다", async t => {
  const { album } = fixture(t); const basic = await prepare(album, []);
  const family = await album.createAlbum("가족");
  family.book.pages.push({ ...page("letter", []), texts:[{ id:"t", text:"기억" }] });
  basic.music = { tracks:[{ id:"song" }] };
  await album.switchAlbum(basic.id); await album.removeMediaItems([], { all:true });
  assert.equal(family.book.pages.length, 0); assert.equal(family.name, "가족");
  assert.equal(basic.music.tracks[0].id, "song");
});

test("앨범 삭제는 사진 원본과 다른 앨범에서 쓰는 음악을 지우지 않는다", async t => {
  const { album, deleted } = fixture(t); const basic = await prepare(album);
  const family = await album.createAlbum("가족");
  album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(family.id);
  album.set("audioRecords", [{ id:"shared", type:"audio" }, { id:"unused", type:"audio" }]);
  basic.music = { tracks:[{ id:"shared" }] }; family.music = { tracks:[{ id:"shared" }, { id:"unused" }] };
  await album.deleteAlbum();
  assert.deepEqual(deleted, [family.id, "unused"]);
  assert.equal(album.albumItem, basic); assert.equal(album.records.length, 2);
  assert.equal(album.albums.length, 1); assert.equal(album.audioRecords[0].id, "shared");
  await album.deleteAlbum(); assert.equal(deleted.length, 2);
});

test("저장 실패 시 앨범을 전환하지 않고 대상 앨범 추가도 되돌린다", async t => {
  let rejectId = null;
  const { album } = fixture(t, { fetch:async route => ({ ok:!rejectId || !route.endsWith("id=" + rejectId), status:500 }) });
  const basic = await prepare(album); const family = await album.createAlbum("가족");
  rejectId = family.id; await album.switchAlbum(basic.id);
  assert.equal(album.albumItem, family);
  rejectId = null; await album.switchAlbum(basic.id);
  rejectId = family.id; album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(family.id, true);
  assert.deepEqual(plain(basic.mediaIds), ["a", "b"]); assert.deepEqual(plain(family.mediaIds), []);
  assert.equal(family.book.pages.length, 0); assert.equal(album.mediaPicked.size, 1);
});

test("이동의 원래 앨범 저장만 실패하면 양쪽에 남겨 사진을 잃지 않는다", async t => {
  let rejectId = null;
  const { album, messages } = fixture(t, { fetch:async route => ({ ok:!rejectId || !route.endsWith("id=" + rejectId), status:500 }) });
  const basic = await prepare(album); const family = await album.createAlbum("가족"); await album.switchAlbum(basic.id);
  rejectId = basic.id; album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(family.id, true);
  assert.deepEqual(plain(basic.mediaIds), ["a", "b"]); assert.deepEqual(plain(family.mediaIds), ["a"]);
  assert.match(messages.at(-1), /두 앨범에 보관/);
});

test("브라우저 저장소에서도 앨범을 별도 기록으로 만들고 분류를 다시 읽는다", async t => {
  const { album } = fixture(t); const data = new Map();
  album.set("nativeStorage", false).set("dbPromise", Promise.resolve({ transaction:() => {
    const tx = { objectStore:() => ({ put:item => { data.set(item.id, plain(item)); return { result:item.id }; } }) };
    queueMicrotask(() => tx.oncomplete()); return tx;
  } }));
  const basic = await prepare(album); const family = await album.createAlbum("가족");
  album.set("mediaPicked", new Set(["a"])); await album.classifyMedia(family.id);
  assert.deepEqual(data.get(family.id).mediaIds, ["a"]);
  assert.equal(data.get(basic.id).book.pages[0].slots.length, 2);
  await album.initializeAlbums([...data.values()]);
  assert.equal(album.albumItem.name, "가족"); assert.equal(album.albumItem.book.pages[0].slots[0].media, "a");
});

test("가져온 사진은 선택한 새 앨범에만 소속되고 원본과 앨범 저장이 끝난 뒤 완료한다", async t => {
  const { album, writes } = fixture(t, {
    createImageBitmap:async () => ({ width:400, height:300, close(){} }),
    document:{ createElement:() => ({ getContext:() => ({ drawImage(){} }), toDataURL:() => "data:image/jpeg;base64,preview" }) }
  });
  const basic = await prepare(album); const family = await album.createAlbum("가족");
  await album.importFiles([Object.assign(new Blob(["new image"], { type:"image/png" }), { name:"new.png" })]);
  const added = album.records.find(item => item.name === "new.png");
  assert.deepEqual(plain(family.mediaIds), [added.id]);
  assert.deepEqual(plain(basic.mediaIds), ["a", "b"]);
  assert.equal(family.book.pages[0].slots[0].media, added.id);
  assert.deepEqual(writes.at(-1).mediaIds, [added.id]);
  assert.equal(album.importing, false); assert.equal(album.bookSaveTimer, 0);
});

test("같은 앨범의 저장은 호출 순서와 당시 값을 지키고 삭제는 진행 중 저장이 끝날 때까지 기다린다", async t => {
  const events = []; let release;
  const { album } = fixture(t, { fetch:async (route, options) => {
    if (route.startsWith("/photo-album-meta")){
      const value = JSON.parse(options.body).name; events.push(value);
      if (events.length === 1) await new Promise(resolve => { release = resolve; });
    } else events.push("deleted");
    return { ok:true, status:200 };
  } });
  const owner = album.albumItem; owner.name = "처음";
  const first = album.persistMetadata(owner); owner.name = "나중";
  const second = album.persistMetadata(owner); const removing = album.deleteItem(owner);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["처음"]); release();
  await Promise.all([first, second, removing]);
  assert.deepEqual(events, ["처음", "나중", "deleted"]);
  assert.equal(album.metadataWrites.size, 0);
});

test("내보내기 중에는 앨범 전환·삭제·분류로 렌더링 대상을 바꾸지 않는다", async t => {
  const { album, deleted } = fixture(t); const basic = await prepare(album);
  const family = await album.createAlbum("가족");
  album.set("bookExportBusy", true).set("mediaPicked", new Set(["a"]));
  await album.switchAlbum(basic.id); await album.deleteAlbum(); await album.classifyMedia(family.id);
  assert.equal(await album.setBookBackground("#ffffff"), false); assert.equal(family.bookBackground, undefined);
  assert.equal(album.albumItem, family); assert.deepEqual(plain(family.mediaIds), []); assert.deepEqual(deleted, []);
  album.set("bookExportBusy", false);
});

for (const browser of [false, true]){
  test((browser ? "브라우저" : "EXE") + "에서 바깥 배경색은 앨범별로 저장·복원되고 기본색으로 되돌릴 수 있다", async t => {
    const { album, writes } = fixture(t), data = new Map(), css = new Map();
    album.get("root").style = { setProperty:(name, value) => css.set(name, value), removeProperty:name => css.delete(name) };
    if (browser) album.set("nativeStorage", false).set("dbPromise", Promise.resolve({ transaction:() => {
      const tx = { objectStore:() => ({ put:item => { data.set(item.id, plain(item)); return { result:item.id }; } }) };
      queueMicrotask(() => tx.oncomplete()); return tx;
    } }));
    const basic = await prepare(album), book = JSON.stringify(basic.book), history = album.bookHistory.undo.length;
    assert.equal(await album.setBookBackground("#BCDDEF"), true);
    assert.equal(css.get("--pa-book-background"), "#bcddef"); assert.equal(basic.bookBackground, "#bcddef");
    assert.equal(JSON.stringify(basic.book), book); assert.equal(album.bookHistory.undo.length, history);
    const family = await album.createAlbum("가족"); assert.equal(css.has("--pa-book-background"), false);
    await album.setBookBackground("#334455");
    await album.switchAlbum(basic.id); assert.equal(css.get("--pa-book-background"), "#bcddef");
    const saved = browser ? data : new Map(writes.map(item => [item.id, item]));
    assert.equal(saved.get(basic.id).bookBackground, "#bcddef"); assert.equal(saved.get(family.id).bookBackground, "#334455");
    await album.initializeAlbums([...saved.values()]); album.paintBookBackground();
    assert.equal(css.get("--pa-book-background"), "#bcddef"); assert.equal(JSON.stringify(album.albumItem.book), book);
    album.set("bookReading", true); album.paintBookBackground(); assert.equal(css.get("--pa-book-background"), "#bcddef");
    album.set("bookReading", false);
    await album.setBookBackground(""); assert.equal(css.has("--pa-book-background"), false); assert.equal(album.albumItem.bookBackground, undefined);
    const reset = browser ? data.get(basic.id) : writes.at(-1); assert.equal("bookBackground" in reset, false);
  });
}

test("바깥 배경색 저장 실패·잘못된 색은 이전 색과 쪽을 유지하고 다음 변경을 막지 않는다", async t => {
  let fail = false;
  const { album, messages } = fixture(t, { fetch:async () => ({ ok:!fail, status:500 }) });
  const css = new Map(); album.get("root").style = { setProperty:(name, value) => css.set(name, value), removeProperty:name => css.delete(name) };
  const owner = await prepare(album), book = JSON.stringify(owner.book);
  await album.setBookBackground("#aabbcc");
  assert.equal(await album.setBookBackground("url(bad)"), false); assert.equal(owner.bookBackground, "#aabbcc");
  fail = true; assert.equal(await album.setBookBackground("#112233"), false);
  assert.equal(owner.bookBackground, "#aabbcc"); assert.equal(css.get("--pa-book-background"), "#aabbcc");
  assert.equal(JSON.stringify(owner.book), book); assert.equal(album.albumBusy, false);
  assert.match(messages.at(-1), /이전 색으로 돌아/);
  fail = false; assert.equal(await album.setBookBackground("#112233"), true); assert.equal(css.get("--pa-book-background"), "#112233");
});
