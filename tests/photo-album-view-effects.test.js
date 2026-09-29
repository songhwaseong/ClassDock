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
