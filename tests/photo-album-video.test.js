"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain, svgText, assertWellFormedXml } = require("./photo-album-harness");

// 실제 화면이나 영상은 열지 않고, 영상 요소가 보내는 메타·준비·탐색·오류 이벤트를 흉내 낸다.
function videoProbe(mode, width = 1920, height = 1080){
  const timers = new Map(), revoked = [], canvases = [], probes = [];
  let nextTimer = 0;
  const album = loadAlbum({ context:{
    URL:{ createObjectURL:() => "blob:probe", revokeObjectURL:url => revoked.push(url) },
    setTimeout:(callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout:id => timers.delete(id),
    document:{ createElement:tag => {
      if (tag === "canvas"){
        const canvas = { getContext:() => ({ drawImage(){} }), toDataURL:() => "data:image/jpeg;base64,frame" };
        canvases.push(canvas); return canvas;
      }
      assert.equal(tag, "video");
      const video = { duration:1, readyState:0, videoWidth:0, videoHeight:0,
        pause(){ this.paused = true; }, removeAttribute(){ this.sourceRemoved = true; }, load(){ this.unloaded = true; }
      };
      Object.defineProperty(video, "src", { set:() => queueMicrotask(() => {
        if (mode === "error"){ video.onerror(); return; }
        video.videoWidth = width; video.videoHeight = height; video.readyState = 2;
        video.onloadedmetadata(); video.onloadeddata();
      }) });
      Object.defineProperty(video, "currentTime", { set:() => queueMicrotask(() => {
        if (mode === "no-seek") [...timers.values()].find(timer => timer.delay === 6000).callback();
        else video.onseeked();
      }) });
      probes.push(video); return video;
    } }
  } });
  return { album, timers, revoked, canvases, probes };
}

test("영상 가져오기는 첫 장면과 실제 가로세로를 저장하고 앨범에 빈 쪽 없이 넣는다", async () => {
  const { album, revoked, canvases, probes, timers } = videoProbe("ok", 720, 1280);
  await album.importFiles([{ name:"세로.mp4", type:"video/mp4", size:1 }]);
  const item = album.get("records")[0];
  assert.equal(item.type, "video");
  assert.equal(item.width, 720); assert.equal(item.height, 1280);
  assert.equal(item.thumbnail, "data:image/jpeg;base64,frame");
  assert.equal(canvases[0].width, 280); assert.equal(canvases[0].height, 498);
  assert.deepEqual(plain(album.get("albumItem").book.pages.map(page => page.slots.map(slot => slot.media))), [[item.id]]);
  assert.equal(album.get("albumItem").book.pages[0].slots[0].a, 1280/720);
  assert.deepEqual(revoked, ["blob:probe"]);
  assert.equal(probes[0].paused, true); assert.equal(probes[0].sourceRemoved, true); assert.equal(probes[0].unloaded, true);
  assert.ok([...timers.values()].every(timer => timer.delay !== 6000));
});

test("탐색 완료 이벤트가 없어도 제한 시간에 읽을 수 있는 첫 장면을 사용한다", async () => {
  const { album, revoked } = videoProbe("no-seek");
  const item = { id:"v", type:"video" };
  const preview = await album.videoThumbnail({ size:1 }, item);
  assert.equal(preview, "data:image/jpeg;base64,frame");
  assert.equal(item.width, 1920); assert.equal(item.height, 1080);
  assert.deepEqual(revoked, ["blob:probe"]);
});

test("미리보기 실패 영상도 보관하고 쪽·목록·내보내기에서 동영상 표시로 나타난다", async () => {
  const { album, revoked, canvases } = videoProbe("error");
  await album.importFiles([{ name:"호환되지않는.mov", type:"video/quicktime", size:1 }]);
  const item = album.get("records")[0];
  assert.equal(item.type, "video"); assert.equal(item.thumbnail, null);
  assert.equal(album.get("albumItem").book.pages.length, 1);
  assert.equal(album.get("albumItem").book.pages[0].slots.length, 1);
  const placeholder = album.mediaThumbnail(item);
  assert.match(placeholder, /^data:image\/svg\+xml/);
  assert.match(svgText(placeholder), /동영상/);
  assertWellFormedXml(svgText(placeholder));
  assert.equal(album.composedNow(item).url, placeholder);
  assert.equal((await album.composedImage(item)).url, placeholder);
  assert.equal(canvases.length, 0);
  assert.deepEqual(revoked, ["blob:probe"]);
  assert.ok(album.launcher.requests.some(request => request.route.startsWith("/photo-album-file?id=")));
});

test("책 감상 중 영상 칸에도 키보드로 누를 수 있는 제자리 재생 단추가 있다", () => {
  const element = tag => ({ tag, dataset:{}, style:{}, children:[], attributes:{},
    setAttribute(name, value){ this.attributes[name] = value; },
    appendChild(child){ this.children.push(child); }, append(...children){ this.children.push(...children); }, addEventListener(){}
  });
  const album = loadAlbum({ context:{ document:{ createElement:element }, window:{} } });
  const item = { id:"v", name:"영상.mp4", type:"video", width:1920, height:1080 };
  album.useRecords([item]).set("bookReading", true);
  const node = album.slotElement({}, { id:"s", media:"v", x:5, y:5, w:80, r:0 }, 0);
  const play = node.children.find(child => child.className === "pa-slot-play");
  assert.equal(play.tag, "button"); assert.equal(play.attributes["aria-label"], "이 자리에서 영상 재생");
  assert.equal(typeof play.onclick, "function");
  let stopped = false; play.onpointerdown({ stopPropagation:() => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(node.children[0].src, album.mediaThumbnail(item));
});
