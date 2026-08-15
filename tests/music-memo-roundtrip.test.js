"use strict";

// 악보 ↔ 메모창 왕복: 오선 한 단만 떼어 낸 발췌 악보(musicExcerpt)와,
// 메모 이미지 블록이 그 스냅샷을 어느 편집기로 되열지 기억하는 고리(boardKind)를 고정한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { scratchpadNormalizeBlock, normalizeScratchpadData } = require("../src/js/scratchpad.js");

function loadMusic(){
  const context = { console, Math, JSON, Date, Number, Array, Object, String, Error };
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/music-model.js"), "utf8");
  vm.runInContext(source + `
    ;globalThis.__music = { musicEmpty, musicNote, musicMeasure, musicParse, musicSerialize,
      musicExcerpt, musicPackLines, musicStaffNotes, musicEffectiveMeasureSettings };`, context);
  return context.__music;
}

const M = loadMusic();
const editorSource = fs.readFileSync(path.join(__dirname, "../src/js/music-editor.js"), "utf8");
const scratchpadSource = fs.readFileSync(path.join(__dirname, "../src/js/scratchpad.js"), "utf8");

function sampleSheet(){
  const sheet = M.musicEmpty("동요");
  sheet.key = "C";
  sheet.measures = [
    M.musicMeasure([M.musicNote("C", 4), M.musicNote("D", 4)]),
    M.musicMeasure([M.musicNote("E", 4), M.musicNote("F", 4)]),
    // 3마디부터 사장조로 바뀌고 빠르기도 달라진다 — 발췌본이 이 설정을 이어받아야 한다.
    M.musicMeasure([M.musicNote("G", 4)], { keyChange:"G", tempoChange:132 }),
    M.musicMeasure([M.musicNote("A", 4)])
  ];
  return sheet;
}

test("발췌 악보는 고른 마디만 담는다", () => {
  const excerpt = M.musicExcerpt(sampleSheet(), [1, 2]);
  assert.equal(excerpt.measures.length, 2);
  assert.equal(M.musicStaffNotes(excerpt.measures[0], "treble")[0].step, "E");
  assert.equal(M.musicStaffNotes(excerpt.measures[1], "treble")[0].step, "G");
});

test("발췌본은 앞 마디에서 이어받던 조표·빠르기를 기본값으로 옮겨 적는다", () => {
  // 3·4마디만 떼면 조표(사장조)는 3마디의 keyChange 로, 4마디는 그걸 이어받은 상태다.
  const excerpt = M.musicExcerpt(sampleSheet(), [2, 3]);
  assert.equal(excerpt.key, "G");
  assert.equal(excerpt.tempo, 132);
  // 기본값으로 올렸으니 첫 마디에 변경 표시가 남아 조표가 두 번 적히면 안 된다.
  assert.equal(excerpt.measures[0].keyChange, undefined);
  assert.equal(excerpt.measures[0].tempoChange, undefined);
  // 뒤 마디도 같은 조로 읽힌다(발췌 전과 같은 소리).
  assert.equal(M.musicEffectiveMeasureSettings(excerpt, 1).key, "G");
});

test("발췌본의 첫 마디는 줄바꿈 표시를 갖지 않는다", () => {
  const sheet = sampleSheet();
  sheet.measures[2].lineBreakBefore = true;      // ＋오선으로 끊어 둔 단
  const excerpt = M.musicExcerpt(sheet, [2, 3]);
  assert.equal(excerpt.measures[0].lineBreakBefore, false);
});

test("발췌본은 저장 형식을 그대로 통과한다(다시 열 수 있다)", () => {
  const excerpt = M.musicExcerpt(sampleSheet(), [0, 1], { title:"동요 — 1~2마디" });
  const reopened = M.musicParse(M.musicSerialize(excerpt));
  assert.equal(reopened.title, "동요 — 1~2마디");
  assert.equal(reopened.measures.length, 2);
  assert.equal(reopened.key, "C");
});

test("빈 범위나 없는 마디 번호는 발췌본을 만들지 않는다", () => {
  assert.equal(M.musicExcerpt(sampleSheet(), []), null);
  assert.equal(M.musicExcerpt(sampleSheet(), [99]), null);
});

test("메모 이미지 블록은 악보 스냅샷의 갈래를 저장·복원 뒤에도 유지한다", () => {
  const block = scratchpadNormalizeBlock({
    id:"image-1",
    type:"image",
    assetId:"asset-png",
    boardAssetId:"asset-sheet",
    boardKind:"music",
    boardName:"동요 — 1~4마디",
    name:"동요 — 1~4마디.png"
  });
  assert.equal(block.boardKind, "music");

  // 실제 저장 경로(localStorage JSON)를 한 바퀴 돌아도 갈래가 남아야 "✏️ 악보로"가 뜬다.
  const saved = JSON.parse(JSON.stringify({ version:5, notes:[{ id:"n1", title:"메모", blocks:[block] }] }));
  const restored = normalizeScratchpadData(saved).notes[0].blocks[0];
  assert.equal(restored.boardKind, "music");
  assert.equal(restored.boardName, "동요 — 1~4마디");
});

test("갈래가 없던 옛 블록은 화이트보드로 읽는다", () => {
  const block = scratchpadNormalizeBlock({ type:"image", assetId:"asset-png", boardAssetId:"asset-board" });
  assert.equal(block.boardKind, "board");
  // 알 수 없는 값도 화이트보드로 떨어뜨린다(엉뚱한 편집기를 열지 않게).
  assert.equal(scratchpadNormalizeBlock({ type:"image", assetId:"a", boardKind:"pdf" }).boardKind, "board");
});

test("긴 악보 PNG는 안전한 캔버스 크기로 낮추고 가독성 한계에서는 단별 저장을 안내한다", () => {
  assert.match(editorSource, /const MUSIC_IMAGE_MAX_SIDE = 16384/);
  assert.match(editorSource, /const MUSIC_IMAGE_MAX_PIXELS = 16 \* 1024 \* 1024/);
  assert.match(editorSource, /function musicSafeImageScale\(width, height\)/);
  assert.match(editorSource, /Math\.sqrt\(MUSIC_IMAGE_MAX_PIXELS \/ \(w \* h\)\)/);
  assert.match(editorSource, /if \(rasterScale < MUSIC_IMAGE_MIN_SCALE\)/);
  assert.match(editorSource, /단별로 메모에 보내 주세요/);
  assert.match(editorSource, /if \(!blob && typeof toast === "function"\)/);
});

test("악보 스냅샷을 열지 못하면 메모를 닫거나 성공으로 안내하지 않는다", () => {
  assert.match(scratchpadSource, /const openedDoc = sourceKind === "music"[\s\S]*?if \(!openedDoc\) return;[\s\S]*?setOpen\(false\)/);
});
