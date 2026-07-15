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
    + "\n;globalThis.__petCatalog={PET_ART,PET_SPECIES,PET_NAMES};";
  vm.runInContext(source, context);
  return context.__petCatalog;
}

test("사진 기반 사람 펫은 기존 커피 아저씨와 분리된 16×20 프레임을 제공한다", () => {
  const { PET_ART, PET_SPECIES, PET_NAMES } = loadPetCatalog();
  const coffee = PET_SPECIES.find(species => species.art === PET_ART.mister);
  const portrait = PET_SPECIES.find(species => species.art === PET_ART.glassesMan);
  assert.ok(coffee);
  assert.ok(portrait);
  assert.notEqual(coffee, portrait);
  assert.equal(PET_NAMES.mister, "커피 아저씨");
  assert.equal(PET_NAMES.glassesMan, "픽셀 선생님");
  assert.ok(PET_ART.mister.some(row => row.includes("CC")), "커피잔 픽셀이 복원되어야 함");
  assert.equal(coffee.motionArt, undefined);
  assert.equal(portrait.gridW, 16);
  assert.equal(portrait.gridH, 20);
  assert.equal(portrait.pixelScale, 3);
  assert.equal(portrait.width, 64);
  assert.equal(portrait.height, 80);
  assert.equal(portrait.spriteSheet.cellW, 96);
  assert.equal(portrait.spriteSheet.cellH, 120);
  assert.deepEqual(Array.from(portrait.spriteSheet.frames.walk), [0, 1, 2, 3, 4, 5]);
  assert.ok(portrait.motionArt);

  for (const state of ["walk", "jump", "fall", "climb", "cheer"]){
    const frames = portrait.motionArt[state];
    assert.ok(Array.isArray(frames) && frames.length > 0, `${state} 프레임 누락`);
    for (const frame of frames){
      assert.equal(frame.length, 20, `${state} 프레임 높이 오류`);
      for (const row of frame) assert.equal(row.length, 16, `${state} 프레임 너비 오류: ${row}`);
    }
  }
  assert.equal(portrait.motionArt.walk.length, 2);
  assert.equal(portrait.motionArt.climb.length, 2);
  assert.equal(portrait.motionArt.cheer.length, 2);
});

test("사진 기반 스프라이트 PNG는 18개 동작 셀로 저장되고 오프라인 빌드에 포함된다", () => {
  const spritePath = path.join(root, "src/assets/pixel-teacher.png");
  const bytes = fs.readFileSync(spritePath);
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 96 * 18);
  assert.equal(bytes.readUInt32BE(20), 120);
  const buildSource = fs.readFileSync(path.join(root, "build-offline.js"), "utf8");
  assert.match(buildSource, /src\/assets\/pixel-teacher\.png/);
  assert.match(buildSource, /data:image\/png;base64/);
});

test("사람 펫 엔진은 큰 캔버스·전용 프레임·직립 벽타기·클릭 만세를 연결한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  assert.match(source, /const frames = p\.motionArt && p\.motionArt\[motionState\]/);
  assert.match(source, /const petW = species\.width \|\| gridW \* pixelScale, petH = species\.height \|\| gridH \* pixelScale/);
  assert.match(source, /el\.style\.width = petW \+ "px"; el\.style\.height = petH \+ "px"/);
  assert.match(source, /const pw = p\.w \|\| PET_W, ph = p\.h \|\| PET_H/);
  assert.match(source, /p\.state === "climb" && p\.kind !== "human"/);
  assert.match(source, /p\.kind === "human" && p\.grav\)\{ petCheer\(p, true\)/);
  assert.match(source, /if \(say\) petSay\(p, petRandomSaying\(p, "만세!"\), false\)/);
  assert.match(source, /const sayingsSpeciesId = species\.baseSpeciesId \|\| speciesId/);
  assert.match(source, /if \(p\.kind === "human"\).*꼭대기에서 힘차게 뛰어내린다/);
  assert.match(source, /p\.kind !== "human" && p\.t > 40 && Math\.random\(\) < 0\.004/);
});

test("사람 펫의 만세 말풍선은 저장 대사를 우선하고 빈 목록만 기본 대사를 쓴다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  const start = source.indexOf("function petRandomSaying");
  const end = source.indexOf("\nfunction petCheer", start);
  assert.ok(start >= 0 && end > start);
  const fakeMath = Object.create(Math);
  fakeMath.random = () => 0.75;
  const context = { Math:fakeMath };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.pick=petRandomSaying;", context);
  assert.equal(context.pick({ sayings:["안되냐고~", "옆에 깨워주세요~"] }, "만세!"), "옆에 깨워주세요~");
  assert.equal(context.pick({ sayings:[] }, "만세!"), "만세!");
});
