"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness");

// 브라우저·화면·실제 영상을 열지 않고, 칸과 영상 요소의 수명·이벤트만 검사한다.
function inlineAlbum(context = {}){
  const created = [], revoked = [], videos = [];
  const windowListeners = new Map();
  const fakeWindow = { addEventListener:(type, listener) => windowListeners.set(type, listener), removeEventListener:(type, listener) => { if (windowListeners.get(type) === listener) windowListeners.delete(type); } };
  function element(tag){
    const node = { tag, dataset:{}, style:{}, children:[], attributes:{}, listeners:{}, className:"", isConnected:true,
      setAttribute(name, value){ this.attributes[name] = value; },
      removeAttribute(name){ delete this.attributes[name]; if (name === "src") delete this.src; },
      appendChild(child){ child.remove(); child.parentNode = this; this.children.push(child); return child; },
      moveBefore(child){ this.appendChild(child); },
      append(...children){ children.forEach(child => this.appendChild(child)); },
      remove(){ if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; },
      addEventListener(type, listener){ (this.listeners[type] ||= []).push(listener); },
      querySelector(selector){ return this.children.find(child => child.classList.contains(selector.slice(1))) || null; },
      closest(selector){ let current = this; while (current){ if (current.classList.contains(selector.slice(1))) return current; current = current.parentNode; } return null; },
      getBoundingClientRect:() => ({ left:0, top:0, width:400, height:600 }),
      focus(){ this.focused = true; }
    };
    const classes = () => new Set(node.className.split(/\s+/).filter(Boolean));
    node.classList = {
      contains:name => classes().has(name),
      add:(...names) => { node.className = [...new Set([...classes(), ...names])].join(" "); },
      remove:(...names) => { node.className = [...classes()].filter(name => !names.includes(name)).join(" "); }
    };
    if (tag === "video"){
      node.currentTime = 0; node.paused = true; node.playCount = node.pauseCount = node.loadCount = 0;
      node.play = async () => { node.playCount++; node.paused = false; if (node.onplaying) node.onplaying(); };
      node.pause = () => { node.pauseCount++; node.paused = true; };
      node.load = () => { node.loadCount++; };
      videos.push(node);
    }
    return node;
  }
  const album = loadAlbum({ context:{
    document:{ createElement:element, elementFromPoint:() => null }, window:fakeWindow, CSS:{ escape:value => value }, requestAnimationFrame:() => 0,
    URL:{ createObjectURL:blob => { const url = "blob:video-" + (created.length + 1); created.push({ blob, url }); return url; }, revokeObjectURL:url => revoked.push(url) },
    confirmDialog:async () => true,
    ...context
  } });
  const items = ["v1", "v2"].map(id => ({ id, name:id + ".mp4", type:"video", width:1920, height:1080, blob:{ id } }));
  const slots = items.map((item, at) => ({ id:"s" + at, media:item.id, x:7 + at*40, y:9, w:35, a:9/16, r:-2 }));
  const page = { id:"p", paper:"cream", slots, texts:[], stickers:[] };
  album.useRecords(items).set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages:[page] } });
  const host = at => {
    const node = album.slotElement(page, slots[at], 0), parent = element("div");
    parent.className = "pa-page"; parent.dataset.index = "0"; parent.appendChild(node);
    const spread = element("div"); spread.className = "pa-spread"; spread.appendChild(parent);
    return node;
  };
  return { album, items, slots, page, host, created, revoked, videos, windowListeners };
}

function event(key){
  return { key, prevented:false, stopped:false, preventDefault(){ this.prevented = true; }, stopPropagation(){ this.stopped = true; } };
}
const dispatch = (node, type, value = event()) => { for (const listener of node.listeners[type] || []) listener(value); return value; };

test("앨범의 ▶는 원래 칸 크기·위치·회전에서 재생하고 한 장 보기로 이동하지 않는다", async () => {
  const { album, items, host, created } = inlineAlbum();
  album.set("bookReading", true);
  const node = host(0), geometry = plain(node.style), click = event();
  await node.querySelector(".pa-slot-play").onclick(click);
  const session = album.get("bookVideo"), video = session.video;
  assert.equal(click.prevented, true); assert.equal(click.stopped, true);
  assert.equal(album.get("albumMode"), "book"); assert.equal(album.get("bookReading"), true); assert.equal(album.get("viewing"), false);
  assert.deepEqual(plain(node.style), geometry);
  assert.equal(node.classList.contains("is-playing"), true); assert.equal(video.parentNode, node);
  assert.equal(video.controls, true); assert.equal(video.playsInline, true);
  assert.match(video.attributes.controlsList, /nofullscreen/);
  assert.equal(video.playCount, 1); assert.equal(session.note.hidden, true);
  assert.equal(created.length, 1); assert.equal(created[0].blob, items[0].blob);
});

test("영상 칸 두 번 누르기도 책 감상에서 제자리 재생하고 전체화면 이벤트를 막는다", async () => {
  const { album, host } = inlineAlbum();
  album.set("bookReading", true);
  const node = host(0), dblclick = event();
  await node.listeners.dblclick[0](dblclick);
  assert.equal(dblclick.prevented, true); assert.equal(dblclick.stopped, true);
  assert.equal(album.get("bookVideo").host, node); assert.equal(album.get("albumMode"), "book");
});

test("닫기는 영상을 멈추고 원본 연결을 해제한 뒤 재생 단추로 돌아간다", async () => {
  const { album, items, slots, host, revoked } = inlineAlbum();
  const node = host(0);
  await album.playBookVideo(items[0], slots[0], node);
  const { video, close } = album.get("bookVideo");
  close.onclick(event());
  assert.equal(album.get("bookVideo"), null);
  assert.equal(video.paused, true); assert.equal(video.pauseCount, 1); assert.equal(video.loadCount, 1);
  assert.equal(video.src, undefined); assert.equal(video.parentNode, null);
  assert.equal(node.classList.contains("is-playing"), false); assert.equal(node.children.length, 2);
  assert.equal(node.querySelector(".pa-slot-play").focused, true);
  assert.deepEqual(revoked, ["blob:video-1"]);
  album.stopBookVideo(); assert.equal(video.pauseCount, 1); assert.equal(revoked.length, 1);
});

test("같은 쪽을 다시 그릴 때는 재생 위치와 영상 요소를 유지한다", async () => {
  const { album, items, slots, host, created, revoked } = inlineAlbum();
  const old = host(0);
  await album.playBookVideo(items[0], slots[0], old);
  const video = album.get("bookVideo").video; video.currentTime = 17;
  const fresh = host(0);
  album.syncBookVideo();
  await album.playBookVideo(items[0], slots[0], fresh);
  assert.equal(album.get("bookVideo").video, video); assert.equal(video.parentNode, fresh);
  assert.equal(video.currentTime, 17); assert.equal(video.playCount, 1);
  assert.equal(old.classList.contains("is-playing"), false); assert.equal(fresh.classList.contains("is-playing"), true);
  assert.equal(created.length, 1); assert.equal(revoked.length, 0);
});

test("다른 영상을 재생하면 기존 영상 한 개를 멈추고 연결을 해제한다", async () => {
  const { album, items, slots, host, revoked } = inlineAlbum();
  const old = host(0);
  await album.playBookVideo(items[0], slots[0], old);
  const video = album.get("bookVideo").video;
  await album.playBookVideo(items[1], slots[1], host(1));
  assert.equal(video.paused, true); assert.equal(video.parentNode, null); assert.equal(old.classList.contains("is-playing"), false);
  assert.equal(album.get("bookVideo").mediaId, items[1].id);
  assert.deepEqual(revoked, ["blob:video-1"]);
});

test("영상 컨트롤의 휠·탐색 키·두 번 누르기는 쪽 넘김이나 전체화면으로 이어지지 않는다", async () => {
  const { album, items, slots, host } = inlineAlbum();
  await album.playBookVideo(items[0], slots[0], host(0));
  const video = album.get("bookVideo").video;
  for (const type of ["pointerdown", "click", "wheel", "contextmenu", "dblclick"]){
    const value = dispatch(video, type);
    assert.equal(value.stopped, true, type);
    assert.equal(value.prevented, type === "dblclick", type);
  }
  for (const key of [" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]){
    const value = dispatch(video, "keydown", event(key));
    assert.equal(value.stopped, true); assert.equal(value.prevented, false);
  }
  const escape = dispatch(video, "keydown", event("Escape"));
  assert.equal(escape.prevented, true); assert.equal(album.get("bookVideo"), null);
});

test("책 감상의 Esc는 먼저 영상만 닫고 다음 Esc에서 감상을 끝낸다", async () => {
  const { album, items, slots, host } = inlineAlbum();
  album.set("bookReading", true);
  await album.playBookVideo(items[0], slots[0], host(0));
  album.onBookKey(event("Escape"));
  assert.equal(album.get("bookVideo"), null); assert.equal(album.get("bookReading"), true);
  album.onBookKey(event("Escape"));
  assert.equal(album.get("bookReading"), false);
});

test("원본을 읽는 중 닫은 영상은 읽기가 끝나도 재생하거나 URL을 만들지 않는다", async () => {
  const { album, items, slots, host, created, videos } = inlineAlbum();
  let resolveBlob;
  album.set("getBlob", () => new Promise(resolve => { resolveBlob = resolve; }));
  const pending = album.playBookVideo(items[0], slots[0], host(0));
  album.stopBookVideo(); resolveBlob(items[0].blob); await pending;
  assert.equal(album.get("bookVideo"), null); assert.equal(created.length, 0); assert.equal(videos[0].playCount, 0);
});

test("화면 전환·유효한 쪽 넘김·칸 제거는 숨은 영상 소리를 남기지 않는다", async () => {
  for (const change of ["mode", "turn", "remove-slot"]){
    const { album, items, slots, host, page, revoked } = inlineAlbum();
    await album.playBookVideo(items[0], slots[0], host(0));
    const video = album.get("bookVideo").video;
    if (change === "mode") album.setAlbumMode("edit");
    else if (change === "turn"){
      album.get("albumItem").book.pages.push({ ...page, id:"p2" }, { ...page, id:"p3" });
      assert.equal(album.goSpread(-1), false); assert.ok(album.get("bookVideo"));
      assert.equal(album.goSpread(1), true);
    } else { page.slots = []; album.syncBookVideo(); }
    assert.equal(album.get("bookVideo"), null, change); assert.equal(video.paused, true, change);
    assert.deepEqual(revoked, ["blob:video-1"], change);
  }
});

test("재생 중인 영상을 삭제해도 영상 원본 연결을 해제한다", async () => {
  const { album, items, slots, host, revoked } = inlineAlbum();
  await album.playBookVideo(items[0], slots[0], host(0));
  const video = album.get("bookVideo").video;
  await album.removeMediaItems([items[0]]);
  assert.equal(album.get("bookVideo"), null); assert.equal(video.paused, true);
  assert.deepEqual(revoked, ["blob:video-1"]);
  assert.deepEqual(plain(album.get("records").map(item => item.id)), ["v2"]);
});

test("재생 거절·미지원 형식·파일 읽기 실패도 같은 칸에 안내와 닫기를 남긴다", async () => {
  for (const failure of ["NotAllowedError", "NotSupportedError", "read"]){
    const { album, items, slots, host, videos } = inlineAlbum();
    const node = host(0);
    if (failure === "read") album.set("getBlob", async () => { throw new Error("read"); });
    const pending = album.playBookVideo(items[0], slots[0], node);
    videos[0].play = async () => { throw Object.assign(new Error(failure), { name:failure }); };
    await pending;
    const session = album.get("bookVideo");
    assert.equal(session.host, node); assert.equal(session.close.parentNode, node); assert.equal(session.note.hidden, false);
    assert.match(session.note.textContent, failure === "NotAllowedError" ? /▶/ : failure === "read" ? /다시 재생/ : /MP4/);
    assert.equal(album.get("albumMode"), "book"); assert.equal(album.get("viewing"), false);
    album.stopBookVideo();
  }
});

test("재생·일시정지 중 이동과 크기 손잡이는 재생 위치·상태를 지키며 실제 칸을 조절한다", async () => {
  for (const paused of [false, true]){
    const { album, items, slots, host, windowListeners, created } = inlineAlbum();
    const node = host(0), slot = slots[0];
    await album.playBookVideo(items[0], slot, node);
    const session = album.get("bookVideo"), video = session.video; video.currentTime = 23;
    if (paused) video.pause();
    assert.equal(session.move.parentNode, node); assert.equal(session.resize.parentNode, node);
    const drag = (control, dx, dy) => {
      const down = Object.assign(event(), { button:0, clientX:100, clientY:100 });
      dispatch(control, "pointerdown", down);
      assert.equal(down.prevented, true); assert.equal(down.stopped, true);
      windowListeners.get("pointermove")({ clientX:100 + dx, clientY:100 + dy });
      if (control === session.move){
        assert.equal(node.parentNode.classList.contains("pa-spread"), true);
        assert.equal(video.parentNode, node); assert.equal(video.currentTime, 23); assert.equal(video.paused, paused);
      }
      windowListeners.get("pointerup")({ clientX:100 + dx, clientY:100 + dy });
      assert.equal(node.parentNode.classList.contains("pa-page"), true);
      assert.equal(windowListeners.size, 0);
    };
    drag(session.move, 40, 60);
    assert.equal(slot.x, 17); assert.equal(slot.y, 19); assert.equal(slot.w, 35);
    drag(session.resize, 40, 0);
    assert.equal(slot.w, 45); assert.equal(slot.x, 17); assert.equal(slot.y, 19);
    assert.equal(node.style.left, "17%"); assert.equal(node.style.top, "19%"); assert.equal(node.style.width, "45%");
    assert.equal(video.paused, paused); assert.equal(video.currentTime, 23); assert.equal(video.playCount, 1); assert.equal(created.length, 1);
    album.stopBookVideo();
    const poster = host(0);
    assert.equal(poster.style.left, "17%"); assert.equal(poster.style.top, "19%"); assert.equal(poster.style.width, "45%");
    assert.ok(poster.querySelector(".is-resize"));
    clearTimeout(album.get("bookSaveTimer")); album.set("bookSaveTimer", 0);
  }
});

test("영상 조절 손잡이의 방향키는 칸을 조절하고 크기 한도를 지킨다", async () => {
  const { album, items, slots, host } = inlineAlbum();
  await album.playBookVideo(items[0], slots[0], host(0));
  const session = album.get("bookVideo"), key = event("ArrowRight");
  dispatch(session.move, "keydown", key);
  assert.equal(slots[0].x, 7.5); assert.equal(key.prevented, true); assert.equal(key.stopped, true);
  dispatch(session.resize, "keydown", Object.assign(event("ArrowUp"), { shiftKey:true }));
  assert.equal(slots[0].w, 37);
  slots[0].w = 99.9; dispatch(session.resize, "keydown", event("ArrowRight")); assert.equal(slots[0].w, 100);
  slots[0].w = 8.1; dispatch(session.resize, "keydown", event("ArrowLeft")); assert.equal(slots[0].w, 8);
  assert.equal(session.video.playCount, 1);
  clearTimeout(album.get("bookSaveTimer")); album.set("bookSaveTimer", 0);
});

test("책 감상에서는 영상 조절 손잡이를 감추고 편집으로 돌아오면 다시 붙인다", async () => {
  const { album, items, slots, host } = inlineAlbum();
  album.set("bookReading", true);
  await album.playBookVideo(items[0], slots[0], host(0));
  const session = album.get("bookVideo");
  assert.equal(session.move.parentNode, null); assert.equal(session.resize.parentNode, null);
  album.set("bookReading", false);
  const edit = host(0);
  assert.equal(session.move.parentNode, edit); assert.equal(session.resize.parentNode, edit);
  album.set("bookReading", true); host(0);
  assert.equal(session.move.parentNode, null); assert.equal(session.resize.parentNode, null);
});
