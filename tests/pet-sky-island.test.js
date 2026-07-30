"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadPetCatalog(){
  const context = {};
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "src/js/pet-data.js"), "utf8")
    + "\n;globalThis.__petCatalog={PET_ART,PET_SPECIES,PET_NAMES,PET_NAMES_EN};";
  vm.runInContext(source, context);
  return context.__petCatalog;
}

test("천공의 섬은 본체 크기를 유지하며 구름이 좌우로 퍼지는 전용 스프라이트 펫이다", () => {
  const { PET_ART, PET_SPECIES, PET_NAMES, PET_NAMES_EN } = loadPetCatalog();
  const golem = PET_SPECIES.find(species => species.kind === "mossGolem");
  const island = PET_SPECIES.find(species => species.id === "skyIsland");

  assert.ok(golem);
  assert.ok(island);
  assert.equal(golem.speed, 0.3);
  assert.equal(island.kind, "skyIsland");
  assert.equal(island.art, PET_ART.skyIsland);
  assert.equal(island.width, golem.width * 4);
  assert.equal(island.height, golem.height * 2);
  assert.equal(island.spriteSheet.src, "src/assets/sky-island-clouds-sprite.png");
  assert.equal(island.spriteSheet.cellW, 512);
  assert.equal(island.spriteSheet.cellH, 320);
  assert.equal(PET_NAMES.skyIsland, "천공의 섬");
  assert.equal(PET_NAMES_EN.skyIsland, "Sky island");
});

test("천공의 섬을 선택해 저장한 나만의 펫도 전용 스프라이트와 움직임을 유지한다", () => {
  const stored = JSON.stringify([{
    id:"custom:island", name:"내 펫", art:"skyIsland", kind:"skyIsland",
    palette:{}, sayings:[], priority:false
  }]);
  const context = {
    localStorage:{
      getItem:key => key === "mn.petCustom" ? stored : null,
      setItem(){}
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "src/js/pet-data.js"), "utf8")
    + "\n" + fs.readFileSync(path.join(root, "src/js/pet-custom.js"), "utf8")
    + "\n;globalThis.__custom={species:petCustomSpecies(),labels:PET_KIND_LABELS};";
  vm.runInContext(source, context);

  const custom = context.__custom.species[0];
  assert.ok(custom);
  assert.equal(context.__custom.labels.skyIsland, "느리게 부유+사라졌다 나타나기 (천공의 섬)");
  assert.equal(custom.kind, "skyIsland");
  assert.equal(custom.spriteSheet.src, "src/assets/sky-island-clouds-sprite.png");
  assert.equal(custom.width, 512);
  assert.equal(custom.height, 320);
  assert.equal(custom.speed, 0.12);
  assert.equal(custom.fixedFacing, true);
});

test("천공의 섬 PNG는 투명 배경의 512x320 RGBA 스프라이트다", () => {
  const spritePath = path.join(root, "src/assets/sky-island-clouds-sprite.png");
  const bytes = fs.readFileSync(spritePath);

  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 512);
  assert.equal(bytes.readUInt32BE(20), 320);
  assert.equal(bytes[25], 6, "PNG color type must be RGBA");
  assert.ok(bytes.length > 50000, "sprite is unexpectedly empty");

  const buildSource = fs.readFileSync(path.join(root, "build-offline.js"), "utf8");
  assert.match(buildSource, /src\/assets\/sky-island-clouds-sprite\.png/);
});

test("천공의 섬은 보임, 페이드아웃, 완전 숨김, 페이드인 순서로 순환한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petSkyIslandUpdate");
  const end = source.indexOf("\n\n// ----- UFO", start);
  assert.ok(start >= 0 && end > start);

  const context = { window:{ innerWidth:1000, innerHeight:800 }, Math };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.updateIsland=petSkyIslandUpdate;", context);

  const pet = {
    w:256, h:320, x:100, y:100, vx:0, vy:0, speed:0.12, t:0,
    gTarget:{ x:200, y:100 },
    fadePhase:"visible", fadeTimer:1, fadeDuration:0,
    el:{ style:{} }
  };
  context.updateIsland(pet);
  assert.equal(pet.fadePhase, "fadeOut");

  for (let i = 0; i < 150; i++) context.updateIsland(pet);
  assert.equal(pet.fadePhase, "hidden");
  assert.equal(pet.el.style.opacity, "0");
  assert.equal(pet.el.style.pointerEvents, "none");

  pet.fadeTimer = 1;
  context.updateIsland(pet);
  assert.equal(pet.fadePhase, "fadeIn");
  for (let i = 0; i < 150; i++) context.updateIsland(pet);
  assert.equal(pet.fadePhase, "visible");
  assert.equal(pet.el.style.opacity, "1");
  assert.equal(pet.el.style.pointerEvents, "");
});
