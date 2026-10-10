"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness");

const file = (name, contents = "photo", type = "image/png") => Object.assign(new Blob([contents], { type }), { name, lastModified:123 });
const slots = owner => Array.from(owner.book.pages).flatMap(page => Array.from(page.slots, slot => slot.media));

async function fixture(t, browser = false){
  const files = new Map(), saved = new Map(), calls = [], status = {}, messages = [], faults = {};
  const album = loadAlbum({ context:{
    toast:message => messages.push(message), requestAnimationFrame:() => 0, confirmDialog:async () => true,
    createImageBitmap:async () => ({ width:400, height:300, close(){} }),
    document:{ createElement:() => ({ getContext:() => ({ drawImage(){} }), toDataURL:() => "data:image/jpeg;base64,preview" }) },
    fetch:async (route, options = {}) => {
      const id = decodeURIComponent(route.split("id=")[1] || ""), method = options.method || "GET";
      calls.push({ route, method, id });
      if (route.startsWith("/photo-album-file")){
        if (method === "GET") return { ok:files.has(id) && !faults.read, status:404, blob:async () => files.get(id) };
        if (faults.write){ faults.write--; return { ok:false, status:500 }; }
        files.set(id, options.body);
      } else if (route.startsWith("/photo-album-meta")) saved.set(id, JSON.parse(options.body));
      return { ok:true, status:200 };
    }
  } });
  album.get("root").querySelector = selector => selector === ".pa-status" ? status : null;
  if (browser){
    album.set("nativeStorage", false).set("dbPromise", Promise.resolve({ transaction:() => {
      const tx = { objectStore:() => ({ put:item => { saved.set(item.id, structuredClone(item)); return { result:item.id }; } }) };
      queueMicrotask(() => tx.oncomplete()); return tx;
    } }));
  }
  t.after(() => clearTimeout(album.bookSaveTimer));
  await album.initializeAlbums([]); await album.ensureBook(); calls.length = 0;
  const uploads = () => calls.filter(call => call.method === "POST" && call.route.startsWith("/photo-album-file"));
  return { album, files, saved, calls, status, messages, faults, uploads };
}

test("이름·수정 날짜가 달라도 같은 내용의 사진은 한 번에 한 항목만 저장한다", async t => {
  const { album, uploads, status } = await fixture(t);
  const renamed = file("renamed.png"); renamed.lastModified = 999;
  await album.importFiles([file("photo.png"), renamed, file("photo.png")]);
  assert.equal(album.records.length, 1); assert.equal(uploads().length, 1);
  assert.deepEqual(slots(album.albumItem), [album.records[0].id]);
  assert.equal(album.albumItem.mediaIds.length, 1);
  assert.match(status.textContent, /1개 파일을 새로 저장/); assert.match(status.textContent, /중복 2개는 건너뛰/);
});

test("파일 이름과 크기가 같아도 내용이 다르면 각각 가져온다", async t => {
  const { album, uploads } = await fixture(t);
  await album.importFiles([file("same.png", "first"), file("same.png", "other")]);
  assert.equal(album.records.length, 2); assert.equal(uploads().length, 2);
  assert.notEqual(album.records[0].sourceHash, album.records[1].sourceHash);
  assert.equal(slots(album.albumItem).length, 2);
});

test("재실행 뒤 같은 파일을 가져와도 원본·꾸미기·기존 쪽 배치를 유지한다", async t => {
  const { album, uploads, saved, calls } = await fixture(t);
  await album.importFiles([file("original.png")]);
  const item = album.records[0]; item.favorite = true; item.background = "sky"; item.stickers = [{ id:"deco", art:"crown" }];
  await album.persistMetadata(item);
  const owner = album.albumItem, before = JSON.stringify(owner.book), stored = saved.get(item.id);
  assert.equal(typeof stored.sourceHash, "string"); assert.equal("blob" in stored, false);
  album.useRecords([structuredClone(stored)]); calls.length = 0;
  await album.importFiles([file("renamed.png")]);
  assert.equal(uploads().length, 0); assert.equal(album.records.length, 1);
  assert.equal(album.records[0].id, item.id); assert.equal(album.records[0].favorite, true);
  assert.equal(album.records[0].background, "sky"); assert.deepEqual(plain(album.records[0].stickers), item.stickers);
  assert.equal(JSON.stringify(owner.book), before);
  assert.equal(calls.some(call => call.method === "GET"), false);
});

test("다른 앨범에서 같은 사진을 가져오면 원본을 공유하여 한 번만 추가한다", async t => {
  const { album, uploads, calls, status } = await fixture(t);
  await album.importFiles([file("family.png")]);
  const basic = album.albumItem, original = album.records[0], family = await album.createAlbum("가족"); calls.length = 0;
  await album.importFiles([file("trip.png"), file("again.png")]);
  assert.equal(uploads().length, 0); assert.equal(album.records.length, 1);
  assert.deepEqual(plain(basic.mediaIds), [original.id]); assert.deepEqual(plain(family.mediaIds), [original.id]);
  assert.deepEqual(slots(basic), [original.id]); assert.deepEqual(slots(family), [original.id]);
  assert.match(status.textContent, /기존 사진·영상 1개를 가족에 추가/); assert.match(status.textContent, /중복 1개는 건너뛰/);
});

test("앨범에서 뺀 보관 사진을 다시 가져오면 파일을 만들지 않고 현재 앨범에 연결한다", async t => {
  const { album, uploads, calls } = await fixture(t);
  await album.importFiles([file("photo.png")]); const original = album.records[0];
  album.set("mediaPicked", new Set([original.id])); await album.removeAlbumMedia();
  assert.equal(album.albumItem.mediaIds.length, 0); calls.length = 0;
  await album.importFiles([file("again.png")]);
  assert.equal(uploads().length, 0); assert.deepEqual(plain(album.albumItem.mediaIds), [original.id]);
  assert.deepEqual(slots(album.albumItem), [original.id]);
});

test("예전 네이티브 사진은 원본으로 한 번 비교하고 다음 실행에 비교 정보를 재사용한다", async t => {
  const { album, files, saved, uploads, calls } = await fixture(t);
  const item = { id:"old", type:"image", name:"old.png", created:1, width:400, height:300, stickers:[] };
  files.set(item.id, file("old.png")); album.useRecords([item]); album.albumItem.mediaIds = [item.id];
  album.appendToBook([item]); await album.flushBookSave(); calls.length = 0;
  await album.importFiles([file("renamed.png")]);
  assert.equal(uploads().length, 0); assert.equal(album.records.length, 1);
  assert.equal(calls.filter(call => call.method === "GET").length, 1); assert.equal("blob" in item, false);
  assert.match(saved.get(item.id).sourceHash, /^sha256:[a-f0-9]{64}$/);
  album.useRecords([structuredClone(saved.get(item.id))]); calls.length = 0;
  await album.importFiles([file("renamed-again.png")]);
  assert.equal(calls.some(call => call.method === "GET"), false); assert.equal(uploads().length, 0);
});

test("예전에 중복 저장한 사진 중 현재 앨범 항목을 우선하며 기존 항목은 지우지 않는다", async t => {
  const { album, files, uploads } = await fixture(t);
  const items = ["outside", "inside"].map(id => ({ id, type:"image", name:id + ".png", created:1, width:400, height:300, stickers:[] }));
  for (const item of items) files.set(item.id, file(item.name));
  album.useRecords(items); album.albumItem.mediaIds = ["inside"];
  album.appendToBook([items[1]]); await album.flushBookSave();
  await album.importFiles([file("again.png")]);
  assert.equal(album.records.length, 2); assert.equal(uploads().length, 0);
  assert.deepEqual(plain(album.albumItem.mediaIds), ["inside"]); assert.deepEqual(slots(album.albumItem), ["inside"]);
});

test("브라우저 저장소에서도 예전 사진 원본을 유지하며 재실행·다른 앨범 가져오기의 중복을 막는다", async t => {
  const { album, saved } = await fixture(t, true);
  const item = { id:"old", type:"image", name:"old.png", blob:file("old.png"), created:1, width:400, height:300, stickers:[] };
  album.useRecords([item]); album.albumItem.mediaIds = [item.id]; album.appendToBook([item]); await album.flushBookSave();
  await album.importFiles([file("again.png")]);
  assert.equal(album.records.length, 1); assert.equal(await saved.get(item.id).blob.text(), "photo");
  album.useRecords([structuredClone(saved.get(item.id))]);
  const family = await album.createAlbum("가족"); await album.importFiles([file("renamed.png"), file("new.png", "different")]);
  assert.equal(album.records.length, 2); assert.equal(family.mediaIds.length, 2);
  assert.ok(family.mediaIds.includes(item.id)); assert.equal(await saved.get(item.id).blob.text(), "photo");
  const added = album.records.find(record => record.id !== item.id);
  assert.equal(await saved.get(added.id).blob.text(), "different");
  assert.match(saved.get(added.id).sourceHash, /^sha256:[a-f0-9]{64}$/);
});

test("미리보기를 읽을 수 없는 영상도 같은 내용을 다시 가져오면 중복 저장하지 않는다", async t => {
  const { album, uploads } = await fixture(t); let probes = 0;
  album.set("videoThumbnail", async () => { probes++; return null; });
  await album.importFiles([file("clip.mp4", "video", "video/mp4"), file("renamed.mp4", "video", "video/mp4")]);
  assert.equal(album.records.length, 1); assert.equal(uploads().length, 1); assert.equal(probes, 1);
  assert.equal(album.records[0].thumbnail, null); assert.equal(slots(album.albumItem).length, 1);
});

test("기존 원본의 중복 확인 실패는 새 파일 저장을 중단하고 다시 시도할 수 있다", async t => {
  const { album, files, faults, uploads, messages } = await fixture(t);
  const item = { id:"old", type:"image", name:"old.png", created:1, width:400, height:300, stickers:[] };
  files.set(item.id, file("old.png")); album.useRecords([item]); album.albumItem.mediaIds = [item.id]; faults.read = true;
  await album.importFiles([file("again.png")]);
  assert.equal(uploads().length, 0); assert.equal(album.records.length, 1); assert.equal(album.importing, false);
  assert.match(messages.at(-1), /중복 확인.*중단/);
  faults.read = false; await album.importFiles([file("again.png")]);
  assert.equal(uploads().length, 0); assert.equal(album.records.length, 1);
});

test("파일 저장에 실패한 항목은 보관된 중복으로 간주하지 않고 같은 배치에서 다시 시도한다", async t => {
  const { album, files, faults, status } = await fixture(t); faults.write = 1;
  await album.importFiles([file("failed.png"), file("retry.png")]);
  assert.equal(album.records.length, 1); assert.equal(files.size, 1);
  assert.equal(album.records[0].name, "retry.png"); assert.equal(slots(album.albumItem).length, 1);
  assert.match(status.textContent, /1개 파일을 새로 저장/); assert.match(status.textContent, /1개는 가져오지 못/);
});

test("가져오기 중 같은 파일의 추가 가져오기를 막고 완료 후 재시도도 중복 저장하지 않는다", async t => {
  const { album, uploads } = await fixture(t); let release;
  const pendingFile = file("pending.png"), read = pendingFile.arrayBuffer.bind(pendingFile);
  pendingFile.arrayBuffer = () => new Promise(resolve => { release = () => resolve(read()); });
  const pending = album.importFiles([pendingFile]);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(album.importing, true);
  await album.importFiles([file("same.png")]); assert.equal(uploads().length, 0);
  release(); await pending; await album.importFiles([file("same.png")]);
  assert.equal(album.records.length, 1); assert.equal(uploads().length, 1); assert.equal(album.importing, false);
});
