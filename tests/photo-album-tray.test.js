"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness");

// 화면 없이 트레이의 드래그 이벤트부터 배치·복제·취소·되돌리기까지 검사한다.
function trayAlbum(t){
  function element(tag){
    const node = { tag, className:"", dataset:{}, style:{ setProperty(name, value){ this[name] = value; }, removeProperty(name){ delete this[name]; } }, children:[], listeners:{}, attributes:{}, isConnected:true,
      setAttribute(name, value){ this.attributes[name] = value; },
      removeAttribute(name){ delete this.attributes[name]; },
      appendChild(child){ child.remove(); child.parentNode = this; this.children.push(child); return child; },
      append(...children){ children.forEach(child => this.appendChild(child)); },
      replaceChildren(...children){ this.children.slice().forEach(child => child.remove()); this.append(...children); },
      remove(){ if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; },
      addEventListener(type, listener){ this.listeners[type] = listener; },
      querySelector(selector){ return this.querySelectorAll(selector)[0] || null; },
      querySelectorAll(selector){ const matches = [], choices = selector.split(",").map(choice => choice.split(".").filter(Boolean)); const visit = parent => parent.children.forEach(child => { if (choices.some(classes => classes.every(name => child.classList.contains(name)))) matches.push(child); visit(child); }); visit(this); return matches; },
      getBoundingClientRect:() => ({ left:100, top:50, width:400, height:600 })
    };
    const classes = () => node.className.split(/\s+/).filter(Boolean);
    node.classList = {
      contains:name => classes().includes(name),
      add:(...names) => { node.className = [...new Set([...classes(), ...names])].join(" "); },
      remove:(...names) => { node.className = classes().filter(name => !names.includes(name)).join(" "); },
      toggle:(name, on) => { if (on) node.classList.add(name); else node.classList.remove(name); }
    };
    return node;
  }
  const album = loadAlbum({ context:{ document:{ createElement:element }, window:{}, CSS:{ escape:value => value } } });
  const media = { id:"photo", name:"photo.png", type:"image", width:400, height:300, background:"mint", stickers:[{ id:"hat", art:"cap", x:40, y:30, w:15, r:0 }] };
  const other = { id:"other", name:"other.png", type:"image", width:400, height:300, stickers:[] };
  album.useRecords([media, other]);
  for (const item of album.records) album.composed.set(item.id, { sig:album.composedSig(item), url:"blob:" + item.id, aspect:.8 });
  const original = { id:"original", media:media.id, x:10, y:20, w:47, r:12, a:.8 };
  const pages = [
    { id:"p0", paper:"cream", slots:[original], texts:[], stickers:[] },
    { id:"p1", paper:"sky", slots:[], texts:[], stickers:[], keepEmpty:true }
  ];
  album.set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages } });
  album.bookHistory.base = JSON.stringify(album.bookOf());
  const root = element("section"); root.className = "photo-album"; album.set("root", root);
  const card = element("button"); card.className = "pa-book-tray-item"; root.appendChild(card);
  const data = new Map(), dataTransfer = { types:[album.BOOK_MEDIA_MIME], setData:(type, value) => data.set(type, value), getData:type => data.get(type) };
  const event = (clientX = 300, clientY = 230) => ({ dataTransfer, clientX, clientY, preventDefault(){}, stopPropagation(){} });
  t.after(() => { album.endTrayDrag(); clearTimeout(album.bookSaveTimer); });
  return { album, media, original, pages, root, card, element, dataTransfer, event };
}

test("트레이에서 끌면 원래 배치를 옮기고 미리보기의 크기·기울기·자리를 그대로 사용한다", t => {
  const { album, media, original, pages, root, card, dataTransfer, event } = trayAlbum(t);
  const beforeMedia = plain(media), beforeBook = JSON.stringify(album.bookOf());
  const target = album.pageElement(1); root.appendChild(target);
  album.startTrayDrag(event(), media, card);
  assert.equal(dataTransfer.effectAllowed, "move"); assert.equal(JSON.stringify(album.bookOf()), beforeBook);
  target.listeners.dragover(event());
  assert.equal(dataTransfer.dropEffect, "move");
  const ghost = target.querySelector(".pa-drop-ghost");
  assert.equal(ghost.style.width, "47%"); assert.equal(ghost.style.transform, "rotate(12deg)");
  const preview = { x:parseFloat(ghost.style.left), y:parseFloat(ghost.style.top), w:parseFloat(ghost.style.width) };
  target.listeners.drop(event());
  assert.equal(pages[0].slots.length, 0); assert.equal(pages[1].slots.length, 1);
  assert.equal(pages[1].slots[0], original); assert.equal(original.id, "original");
  assert.equal(original.x, preview.x); assert.equal(original.y, preview.y); assert.equal(original.w, preview.w);
  assert.equal(original.r, 12); assert.equal(original.a, .8); assert.deepEqual(plain(media), beforeMedia);
  assert.equal(album.records.length, 2); assert.equal(album.trayDrag, null);
  assert.equal(card.classList.contains("is-dragging"), false); assert.equal(root.classList.contains("pa-tray-dragging"), false);
  assert.equal(root.querySelector(".pa-drop-ghost"), null); assert.equal(album.bookHistory.undo.length, 1);
  album.stepBookHistory(-1);
  assert.equal(album.bookOf().pages[0].slots[0].id, "original"); assert.equal(album.bookOf().pages[0].slots[0].x, 10);
  assert.equal(album.bookOf().pages[1].slots.length, 0);
  album.stepBookHistory(1);
  assert.equal(album.bookOf().pages[0].slots.length, 0); assert.equal(album.bookOf().pages[1].slots[0].id, "original");
});

test("같은 사진을 반복해서 넣거나 현재 쪽 가운데로 눌러 옮겨도 배치 수가 늘지 않는다", t => {
  const { album, media, original, pages } = trayAlbum(t);
  album.placeMedia(0, media, { x:70, y:40 });
  assert.equal(pages[0].slots.length, 1); assert.equal(pages[0].slots[0], original); assert.equal(original.x, 46.5);
  album.placeMedia(1, media, null);
  assert.equal(pages[0].slots.length, 0); assert.equal(pages[1].slots.length, 1); assert.equal(original.x, 26.5);
  album.placeMedia(0, media, { x:30, y:50 });
  assert.equal(pages[0].slots.length, 1); assert.equal(pages[1].slots.length, 0); assert.equal(original.x, 6.5);
  assert.equal(original.w, 47); assert.equal(original.r, 12);
});

test("아직 앨범에 없는 사진만 새 칸을 만들고 이후에는 그 칸을 옮긴다", t => {
  const { album, pages, card, event, dataTransfer } = trayAlbum(t);
  const media = album.records[1];
  album.startTrayDrag(event(), media, card); assert.equal(dataTransfer.effectAllowed, "copy"); album.endTrayDrag();
  album.placeMedia(1, media, { x:50, y:40 });
  const first = pages[1].slots[0]; assert.equal(first.w, 70); assert.equal(first.media, "other");
  album.placeMedia(0, media, null);
  assert.equal(pages[1].slots.length, 0); assert.equal(pages[0].slots.length, 2);
  assert.equal(pages[0].slots[1], first); assert.equal(first.w, 70); assert.equal(album.records.length, 2);
});

test("사진 복제 단추는 새 칸만 만들고, 트레이 이동은 선택한 복제본을 우선하며 나머지는 보존한다", t => {
  const { album, media, original, pages, root, element } = trayAlbum(t);
  const toolbar = element("span"); toolbar.className = "pa-book-pick"; root.appendChild(toolbar);
  album.set("bookPick", { kind:"slot", page:0, id:original.id }); album.paintBookPick();
  const copyButton = toolbar.querySelector(".pa-book-pick-tools").children.find(button => button.attributes["aria-label"] === "사진 복제");
  assert.ok(copyButton); copyButton.onclick();
  const copy = pages[0].slots[1]; assert.notEqual(copy.id, original.id);
  assert.deepEqual(plain(copy), { ...plain(original), id:copy.id, x:13, y:23 });
  assert.equal(album.bookPick.id, copy.id);
  const menu = album.albumPageMenuItems(0, { kind:"slot", id:copy.id });
  assert.ok(menu.some(item => item.label === "사진 복제" && !item.disabled));
  album.placeMedia(1, media, null);
  assert.deepEqual(pages[0].slots.map(slot => slot.id), [original.id]); assert.equal(pages[1].slots[0], copy);
  assert.equal(original.x, 10); assert.equal(original.y, 20); assert.equal(album.records.length, 2);
  album.set("bookPick", null);
  album.placeMedia(1, media, { x:80, y:50 });
  assert.equal(pages[0].slots[0], original); assert.equal(pages[1].slots[0], copy);
  copy.x = copy.y = 98; album.duplicateSlot(1, copy.id);
  assert.equal(pages[1].slots[1].x, 95); assert.equal(pages[1].slots[1].y, 95);
  assert.equal(pages[1].slots[1].w, 47); assert.equal(pages[1].slots[1].r, 12);
});

test("트레이를 눌러도 기존 사진을 이동하고 사용 쪽 표시와 안내를 갱신한다", t => {
  const { album, pages, original, root, element } = trayAlbum(t);
  const list = element("div"); list.className = "pa-book-tray-list"; root.appendChild(list);
  album.paintBookTray();
  assert.equal(list.children.length, 2);
  const card = list.children[0]; assert.match(card.attributes["aria-label"], /기존 사진을 옮기기/);
  assert.equal(card.querySelector(".pa-book-tray-used").textContent, "1쪽");
  album.set("bookPage", 1); card.onclick(); album.paintBookTray();
  assert.equal(pages[0].slots.length, 0); assert.equal(pages[1].slots[0], original);
  assert.equal(list.children.length, 2); assert.equal(list.children[0].querySelector(".pa-book-tray-used").textContent, "2쪽");
});

test("트레이 끌기를 취소하거나 잘못된 쪽·가득 찬 쪽에 놓으면 기존 배치를 제거하지 않는다", t => {
  const { album, media, original, pages, root, card, event } = trayAlbum(t);
  album.startTrayDrag(event(), media, card); album.endTrayDrag();
  assert.equal(pages[0].slots[0], original); assert.equal(album.bookHistory.undo.length, 0); assert.equal(album.bookSaveTimer, 0);
  assert.equal(root.classList.contains("pa-tray-dragging"), false);
  album.placeMedia(99, media, null); assert.equal(pages[0].slots[0], original);
  pages[1].slots = Array.from({ length:album.BOOK_MAX_SLOTS_PER_PAGE }, (_, at) => ({ id:"full-" + at, media:"other", x:10, y:10, w:30, r:0, a:.8 }));
  const before = JSON.stringify(album.bookOf());
  album.placeMedia(1, media, null); album.duplicateSlot(1, "full-0");
  assert.equal(JSON.stringify(album.bookOf()), before); assert.equal(album.bookHistory.undo.length, 0);
  assert.equal(album.bookSaveTimer, 0); assert.equal(pages[0].slots[0], original);
});

test("오른쪽 빈 자리에 트레이 사진을 놓으면 새 쪽으로 옮기며 기존 사진 크기를 유지한다", t => {
  const { album, media, original, pages, root, card, event } = trayAlbum(t);
  pages.pop();
  const target = album.blankPage(1); root.appendChild(target);
  album.startTrayDrag(event(), media, card); target.listeners.drop(event());
  assert.equal(pages.length, 2); assert.equal(pages[0].slots.length, 0); assert.equal(pages[1].slots[0], original);
  assert.equal(original.w, 47); assert.equal(original.r, 12); assert.equal(original.x, 26.5);
  assert.equal(album.bookPick.page, 1); assert.equal(album.trayDrag, null);
});
