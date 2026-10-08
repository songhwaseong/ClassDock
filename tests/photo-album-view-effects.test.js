"use strict";

// 사진첩 감상 모드 넘기기 효과: 고른 값 읽기·무작위·움직임 줄이기, 효과가 어느 층을 움직이는지.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAlbum, plain } = require("./photo-album-harness.js");

// animate 를 적어 두는 가짜 요소.
function fakeElement(log, name, children = []){
  return {
    name, children, style:{},
    animate:(frames, timing) => { log.push({ name, frames:plain(frames), timing:plain(timing) }); return { finished:Promise.resolve(), cancel(){} }; }
  };
}

test("고른 효과·빠르기는 브라우저에 기억하고, 모르는 값이면 밀기·보통", () => {
  const album = loadAlbum();
  assert.equal(album.viewEffectId(), "slide");
  assert.equal(album.viewSpeed()[0], "normal");
  album.storage.setItem("classdock.photoAlbum.viewEffect", "circle");
  album.storage.setItem("classdock.photoAlbum.viewEffectSpeed", "slow");
  assert.equal(album.viewEffectId(), "circle");
  assert.equal(album.viewSpeed()[2], 1.8);
  album.storage.setItem("classdock.photoAlbum.viewEffect", "없는효과");
  assert.equal(album.viewEffectId(), "slide");
});

test("무작위는 움직이는 효과만, 같은 효과를 잇달아 고르지 않는다", () => {
  const album = loadAlbum();
  let last = "";
  for (let i = 0; i < 60; i++){
    const effect = album.resolveViewEffect("random", false);
    assert.ok(effect.ms > 0, effect.id);
    assert.notEqual(effect.id, "random");
    assert.notEqual(effect.id, last);
    last = effect.id;
  }
});

test("움직임 줄이기면 흐려지기로, 바로 넘기기는 그대로", () => {
  const album = loadAlbum();
  assert.equal(album.resolveViewEffect("flip", true).id, "fade");
  assert.equal(album.resolveViewEffect("random", true).id, "fade");
  assert.equal(album.resolveViewEffect("none", true).id, "none");
  assert.equal(album.resolveViewEffect("push", false).id, "push");
});

test("덮기: 새 층이 원래 자리 밖으로는 보이지 않게 옮긴 만큼 잘라 낸다", () => {
  const album = loadAlbum(), cover = album.viewEffectById("cover");
  assert.deepEqual(plain(cover.in(1, 400, 300)[0]), { transform:"translateX(400px)", clipPath:"inset(0 400px 0 0)" });
  assert.deepEqual(plain(cover.in(-1, 400, 300)[0]), { transform:"translateX(-400px)", clipPath:"inset(0 0 0 400px)" });
});

test("알맹이 효과는 두 층의 액자를, box 효과는 새 층 전체를 움직이고 새 층을 위로 올린다", async () => {
  const album = loadAlbum();
  let log = [];
  const parts = () => ({
    ghost:fakeElement(log, "ghost", [fakeElement(log, "old-art")]),
    stage:fakeElement(log, "stage", [fakeElement(log, "new-art")]),
    d:1, w:400, h:300, speed:.6
  });
  const slideParts = parts();
  await album.playViewEffect(album.viewEffectById("slide"), slideParts);
  assert.deepEqual(log.map(row => row.name), ["old-art", "new-art"]);
  assert.equal(log[0].timing.duration, Math.round(380*.6));
  assert.equal(slideParts.stage.style.zIndex, undefined);

  log = [];
  const wipeParts = parts();
  await album.playViewEffect(album.viewEffectById("wipe"), wipeParts);
  assert.deepEqual(log.map(row => row.name), ["stage"]);
  assert.equal(wipeParts.ghost.style.zIndex, "0");
  assert.equal(wipeParts.stage.style.zIndex, "1");

  log = [];
  assert.deepEqual(plain(await album.playViewEffect(album.viewEffectById("none"), parts())), []);
  assert.equal(log.length, 0);
});

// viewSwitchIn 에 넘길 가짜 무대·앞 층. 무대엔 새 사진 img 하나, 앞 층엔 앞 사진 액자 하나.
function fakeSwitch(album, log, img){
  const classes = new Set();
  const stage = fakeElement(log, "stage", [fakeElement(log, "new-board")]);
  Object.assign(stage, { isConnected:true, offsetWidth:400, offsetHeight:300,
    classList:{ add:name => classes.add(name), remove:name => classes.delete(name), contains:name => classes.has(name) },
    querySelector:selector => selector === ".pa-photo-surface > img" ? img : null });
  const ghost = fakeElement(log, "ghost", [fakeElement(log, "old-board")]);
  Object.assign(ghost, { isConnected:true, remove(){ ghost.isConnected = false; } });
  album.set("root", { querySelector:selector => selector === ".pa-stage" ? stage : null });
  return { stage, ghost, classes };
}

test("무대 그림자 중 안쪽 선만 골라 낸다(괄호 속 쉼표는 나누지 않음)", () => {
  const album = loadAlbum();
  assert.equal(album.insetShadows("rgb(39, 51, 64) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.33) 0px 15px 40px 0px"), "rgb(39, 51, 64) 0px 0px 0px 1px inset");
  assert.equal(album.insetShadows("rgba(0, 0, 0, 0.33) 0px 15px 40px 0px"), "none");
  assert.equal(album.insetShadows("none"), "none");
});

test("새 사진을 한도 안에 다 못 풀면 앞 사진을 둔 채 기다렸다가 흐려지기로 넘긴다", async () => {
  let finishDecode;
  const album = loadAlbum({ context:{ setTimeout:fn => setTimeout(fn, 0) } });
  const log = [], img = { complete:false, decode:() => new Promise(resolve => { finishDecode = resolve; }) };
  const { ghost, classes } = fakeSwitch(album, log, img);
  const running = album.viewSwitchIn(ghost, 1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(classes.has("pa-view-wait"), "다 풀 때까지 새 사진은 감춘다");
  assert.equal(log.length, 0, "기다리는 동안은 움직이지 않는다");
  assert.ok(ghost.isConnected, "그동안 앞 사진이 그대로 보인다");
  finishDecode(); await running;
  assert.ok(!classes.has("pa-view-wait"));
  assert.deepEqual(log.map(row => row.name), ["old-board", "new-board"]);
  assert.deepEqual(log[1].frames, [{ opacity:0 }, { opacity:1 }], "밀기 대신 흐려지기");
  assert.ok(!ghost.isConnected);
});

test("box 효과는 무대 테두리선·그림자를 앞 층이 맡고, 끝나면 무대 것을 되돌린다", async () => {
  const shadow = "rgb(39, 51, 64) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.33) 0px 15px 40px 0px";
  const album = loadAlbum({ context:{ getComputedStyle:() => ({ backgroundColor:"rgb(7, 10, 14)", backgroundImage:"none", boxShadow:shadow }) } });
  album.storage.setItem("classdock.photoAlbum.viewEffect", "wipe");
  const log = [], { stage, ghost } = fakeSwitch(album, log, { complete:true });
  let during = null;
  stage.animate = () => { during = { stage:stage.style.boxShadow, ghost:ghost.style.boxShadow, zIndex:stage.style.zIndex }; return { finished:Promise.resolve(), cancel(){} }; };
  await album.viewSwitchIn(ghost, 1);
  assert.deepEqual(during, { stage:"rgb(39, 51, 64) 0px 0px 0px 1px inset", ghost:shadow, zIndex:"1" });
  assert.equal(stage.style.boxShadow, "");
  assert.equal(stage.style.zIndex, "");
});
