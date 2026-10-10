"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness");

// 화면 없이 실제 끌기 함수의 요소 이동·좌표·취소·저장 이력을 확인한다.
function dragAlbum(t, fromIndex = 0, options = {}){
  const listeners = new Map(), transfers = [];
  function node(className, rect){
    const el = { className, dataset:{}, style:{ setProperty(name, value){ this[name] = value; }, removeProperty(name){ delete this[name]; } }, children:[], parentNode:null,
      appendChild(child){ if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(row => row !== child); child.parentNode = this; this.children.push(child); return child; },
      closest(selector){ let current = this; while (current){ if (current.classList.contains(selector.slice(1))) return current; current = current.parentNode; } return null; },
      getBoundingClientRect:() => rect,
      querySelector:() => null, querySelectorAll:() => []
    };
    const classes = () => el.className.split(/\s+/).filter(Boolean);
    el.classList = {
      contains:name => classes().includes(name),
      add:(...names) => { el.className = [...new Set([...classes(), ...names])].join(" "); },
      remove:(...names) => { el.className = classes().filter(name => !names.includes(name)).join(" "); },
      toggle:(name, on) => { if (on) el.classList.add(name); else el.classList.remove(name); }
    };
    if (options.moveBefore !== false) el.moveBefore = child => { transfers.push({ parent:el, child }); el.appendChild(child); };
    return el;
  }
  const width = 400, height = width / .75;
  const spread = node("pa-spread", { left:100, top:50, width:width * 2, height });
  const pageNodes = [0, 1].map(index => {
    const el = node("pa-page", { left:100 + index * width, top:50, width, height });
    el.dataset.index = String(index); spread.appendChild(el); return el;
  });
  const slot = { id:"moving", media:"photo", x:55, y:20, w:40, a:.75, r:-2 };
  const original = plain(slot), el = node("pa-slot is-picked"); el.dataset.id = slot.id;
  Object.assign(el.style, { left:slot.x + "%", top:slot.y + "%", width:slot.w + "%", transform:"rotate(-2deg)" });
  el.getBoundingClientRect = () => {
    const parent = el.parentNode.getBoundingClientRect();
    const pixels = (value, size) => parseFloat(value) * (value.endsWith("%") ? size / 100 : 1);
    const w = pixels(el.style.width, parent.width);
    return { left:parent.left + pixels(el.style.left, parent.width), top:parent.top + pixels(el.style.top, parent.height), width:w, height:w * slot.a };
  };
  pageNodes[fromIndex].appendChild(el);
  if (options.blank) pageNodes[1 - fromIndex].classList.add("is-blank");
  const pages = pageNodes.map((_, index) => ({ id:"page-" + index, paper:"cream", slots:index === fromIndex ? [slot] : Array.from({ length:options.full ? 12 : 0 }, (_, at) => ({ id:"other-" + at, media:"photo", x:10, y:10, w:30, a:.75, r:0 })), texts:[], stickers:[] }));
  const root = node("photo-album"); root.appendChild(spread);
  root.querySelector = selector => selector.startsWith(".pa-slot[data-id=") ? el : null;
  const album = loadAlbum({ context:{
    CSS:{ escape:value => value },
    window:{ addEventListener:(type, listener) => listeners.set(type, listener), removeEventListener:(type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); } }
  } });
  album.useRecords([{ id:"photo", type:"image", name:"photo.png", width:400, height:300 }]);
  album.set("root", root).set("albumItem", { id:album.ALBUM_ID, type:"album", book:{ v:1, pages } });
  album.set("bookPick", { kind:"slot", page:fromIndex, id:slot.id }).set("bookPage", fromIndex);
  album.bookHistory.base = JSON.stringify(album.bookOf());
  const box = el.getBoundingClientRect(), start = { clientX:box.left + 12, clientY:box.top + 10 };
  const event = (type, x = start.clientX, y = start.clientY, pointerId = 7) => ({ type, button:0, pointerId, clientX:x, clientY:y, preventDefault(){}, stopPropagation(){} });
  const begin = (kind = "move") => album.startSlotDrag(event("pointerdown"), fromIndex, slot, el, kind);
  const dispatch = (type, x, y, pointerId) => listeners.get(type)(event(type, x, y, pointerId));
  t.after(() => { album.stopSlotDrag(); clearTimeout(album.bookSaveTimer); });
  return { album, pages, root, spread, pageNodes, slot, original, el, start, begin, dispatch, listeners, transfers };
}

test("가운데 경계를 넘는 사진은 원래 쪽의 잘라내기 밖에서 전체 모습과 크기를 유지한다", t => {
  const { slot, original, el, root, spread, pageNodes, start, begin, dispatch } = dragAlbum(t);
  begin(); dispatch("pointermove", start.clientX + 80, start.clientY + 20);
  assert.equal(el.parentNode, spread);
  assert.equal(el.classList.contains("is-moving"), true);
  assert.equal(root.classList.contains("pa-slot-dragging"), true);
  assert.equal(el.style.left, "300px"); assert.equal(el.style.width, "160px");
  const box = el.getBoundingClientRect(), seam = pageNodes[1].getBoundingClientRect().left;
  assert.ok(box.left < seam && box.left + box.width > seam);
  assert.equal(el.style.transform, "rotate(-2deg)");
  assert.deepEqual(plain(slot), original, "끌기 중인 임시 좌표는 저장 기록을 바꾸지 않는다");
});

test("양쪽 쪽 간 이동은 잡은 지점과 보인 자리를 유지하고 한 번에 되돌릴 수 있다", t => {
  for (const fromIndex of [0, 1]){
    const { album, pages, el, pageNodes, start, begin, dispatch, listeners, transfers } = dragAlbum(t, fromIndex);
    const toIndex = 1 - fromIndex, area = pageNodes[toIndex].getBoundingClientRect();
    const x = area.left + 100, y = start.clientY + 35;
    begin(); dispatch("pointermove", x, y);
    assert.equal(pageNodes[toIndex].classList.contains("is-drop"), true);
    const preview = el.getBoundingClientRect();
    assert.equal(preview.left + 12, x); assert.equal(preview.top + 10, y);
    dispatch("pointerup", x, y);
    assert.equal(pages[fromIndex].slots.length, 0); assert.equal(pages[toIndex].slots.length, 1);
    assert.equal(el.parentNode, pageNodes[toIndex]);
    assert.equal(el.getBoundingClientRect().left, preview.left); assert.equal(el.getBoundingClientRect().top, preview.top);
    assert.equal(el.style.width, "40%"); assert.equal(el.classList.contains("is-moving"), false);
    assert.equal(pageNodes[toIndex].classList.contains("is-drop"), false); assert.equal(listeners.size, 0);
    assert.equal(transfers.length, 2); assert.equal(album.bookHistory.undo.length, 1);
    assert.equal(album.bookPick.page, toIndex);
    album.stepBookHistory(-1);
    assert.equal(album.bookOf().pages[fromIndex].slots[0].id, "moving"); assert.equal(album.bookOf().pages[toIndex].slots.length, 0);
    album.stepBookHistory(1);
    assert.equal(album.bookOf().pages[toIndex].slots[0].id, "moving"); assert.equal(album.bookOf().pages[fromIndex].slots.length, 0);
  }
});

test("같은 쪽 이동과 moveBefore가 없는 환경에서도 위치·크기와 요소를 유지한다", t => {
  const { album, slot, el, pageNodes, start, begin, dispatch, listeners } = dragAlbum(t, 1, { moveBefore:false });
  begin(); dispatch("pointermove", start.clientX + 20, start.clientY + 16);
  dispatch("pointerup", start.clientX + 20, start.clientY + 16);
  assert.equal(el.parentNode, pageNodes[1]); assert.equal(slot.x, 60); assert.equal(slot.y, 23);
  assert.equal(slot.w, 40); assert.equal(slot.r, -2); assert.equal(listeners.size, 0);
  assert.equal(album.bookHistory.undo.length, 1);
});

test("빈 자리·가득 찬 옆 쪽·쪽 바깥에 놓으면 원래 자리로 돌아와 사진을 숨기거나 저장하지 않는다", t => {
  for (const options of [{ blank:true }, { full:true }, { outside:true }]){
    const { album, slot, original, el, pageNodes, start, begin, dispatch, listeners } = dragAlbum(t, 0, options);
    const x = options.outside ? 1000 : 600;
    begin(); dispatch("pointermove", x, start.clientY); dispatch("pointerup", x, start.clientY);
    assert.deepEqual(plain(slot), original); assert.equal(el.parentNode, pageNodes[0]);
    assert.equal(el.style.left, "55%"); assert.equal(el.classList.contains("is-moving"), false);
    assert.equal(listeners.size, 0); assert.equal(album.bookHistory.undo.length, 0); assert.equal(album.bookSaveTimer, 0);
  }
});

test("Esc·포인터 취소·창 초점 해제·다시 그리기는 끌기 층과 이벤트를 정리한다", t => {
  for (const reason of ["escape", "pointercancel", "blur", "paint"]){
    const { album, slot, original, el, root, pageNodes, start, begin, dispatch, listeners } = dragAlbum(t);
    begin(); dispatch("pointermove", 620, start.clientY);
    if (reason === "escape") album.onBookKey({ key:"Escape", preventDefault(){} });
    else if (reason === "paint") album.paintBook();
    else dispatch(reason, 620, start.clientY);
    assert.deepEqual(plain(slot), original); assert.equal(el.parentNode, pageNodes[0]);
    assert.equal(el.classList.contains("is-moving"), false); assert.equal(root.classList.contains("pa-slot-dragging"), false);
    assert.equal(pageNodes[1].classList.contains("is-drop"), false); assert.equal(listeners.size, 0);
    assert.equal(album.bookSlotDrag, null); assert.equal(album.bookHistory.undo.length, 0);
  }
});

test("단순 누르기·다른 포인터는 사진을 띄우거나 저장하지 않고, 크기 조절도 취소할 수 있다", t => {
  const { album, slot, original, el, pageNodes, start, begin, dispatch, listeners } = dragAlbum(t);
  begin(); dispatch("pointermove", 650, start.clientY, 8); dispatch("pointercancel", 650, start.clientY, 8);
  assert.equal(el.parentNode, pageNodes[0]); assert.equal(listeners.size, 4);
  dispatch("pointermove", start.clientX + 1, start.clientY); dispatch("pointerup", start.clientX + 1, start.clientY);
  assert.deepEqual(plain(slot), original); assert.equal(album.bookHistory.undo.length, 0); assert.equal(listeners.size, 0);
  begin("resize"); dispatch("pointermove", start.clientX + 40, start.clientY);
  assert.equal(slot.w, 50); assert.equal(el.parentNode, pageNodes[0]);
  dispatch("pointercancel", start.clientX + 40, start.clientY);
  assert.equal(slot.w, 40); assert.equal(el.style.width, "40%"); assert.equal(listeners.size, 0);
});
