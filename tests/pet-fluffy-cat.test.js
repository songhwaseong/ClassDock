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

test("복실고양이는 24프레임 전용 시트와 정확한 대사를 제공한다", () => {
  const { PET_ART, PET_SPECIES, PET_NAMES, PET_NAMES_EN } = loadPetCatalog();
  const fluffy = PET_SPECIES.find(species => species.art === PET_ART.fluffyCat);
  assert.ok(fluffy);
  assert.equal(fluffy.kind, "fluffyCat");
  assert.equal(PET_NAMES.fluffyCat, "복실고양이");
  assert.equal(PET_NAMES_EN.fluffyCat, "Fluffy cat");
  assert.equal(fluffy.width, 96);
  assert.equal(fluffy.height, 96);
  assert.equal(fluffy.spriteSheet.src, "src/assets/fluffy-cat-sprites-v2.png");
  assert.equal(fluffy.spriteSheet.cellW, 96);
  assert.equal(fluffy.spriteSheet.cellH, 96);
  assert.equal(fluffy.spriteSheet.cols, 6);
  assert.deepEqual(Array.from(fluffy.spriteSheet.frames.walk), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(fluffy.spriteSheet.frames.diagonalFly), [6, 7, 8, 9, 10, 11]);
  assert.deepEqual(Array.from(fluffy.spriteSheet.frames.wallBounce), [12, 13, 14, 15]);
  assert.deepEqual(Array.from(fluffy.spriteSheet.frames.land), [16, 17]);
  assert.deepEqual(Array.from(fluffy.spriteSheet.frames.groom), [18, 19, 20, 21, 22, 23]);
  assert.deepEqual(Array.from(fluffy.sayings), ["배고프다냐옹"]);
});

test("복실고양이 PNG는 6×4 RGBA 셀 시트이며 오프라인 빌드 대상이다", () => {
  const spritePath = path.join(root, "src/assets/fluffy-cat-sprites-v2.png");
  const bytes = fs.readFileSync(spritePath);
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 96 * 6);
  assert.equal(bytes.readUInt32BE(20), 96 * 4);
  assert.equal(bytes[25], 6, "PNG color type must be RGBA");
  assert.ok(bytes.length > 10000, "sprite sheet is unexpectedly empty");

  const buildSource = fs.readFileSync(path.join(root, "build-offline.js"), "utf8");
  assert.match(buildSource, /src\/assets\/fluffy-cat-sprites-v2\.png/);
  assert.match(buildSource, /html\.split\(petSpriteRelative\)\.join\(petSpriteDataUrl\)/);
});

test("복실고양이 벽 충돌은 좌우를 뒤집고 반드시 위쪽 대각선으로 반사한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  const start = source.indexOf("function petFluffyWallBounce");
  const end = source.indexOf("\nfunction petStartFluffyGroom", start);
  assert.ok(start >= 0 && end > start);
  const context = { Math };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.bounce=petFluffyWallBounce;", context);

  const rightWall = { face:1, vx:2.4, vy:1.7, state:"diagonalFly", timer:0, t:9, pop:0 };
  context.bounce(rightWall, 1);
  assert.equal(rightWall.face, -1);
  assert.ok(rightWall.vx < 0);
  assert.ok(rightWall.vy < 0);
  assert.equal(rightWall.state, "wallBounce");

  const leftWall = { face:-1, vx:-2.1, vy:0.8, state:"diagonalFly", timer:0, t:9, pop:0 };
  context.bounce(leftWall, -1);
  assert.equal(leftWall.face, 1);
  assert.ok(leftWall.vx > 0);
  assert.ok(leftWall.vy < 0);
});

test("짧은 클릭은 점프 대신 그루밍과 '배고프다냐옹' 말풍선을 시작한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  const start = source.indexOf("function petStartFluffyGroom");
  const end = source.indexOf("\n// 벽 꼭대기", start);
  assert.ok(start >= 0 && end > start);
  let said = null;
  let remembered = false;
  const context = {
    petRememberFluffyCatSeen:() => { remembered = true; },
    petSay:(_pet, text) => { said = text; }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.groom=petStartFluffyGroom;", context);
  const pet = { kind:"fluffyCat", state:"walk", timer:0, t:20, vx:2, vy:1, rot:3, squash:0.2 };
  context.groom(pet);
  assert.equal(pet.state, "groom");
  assert.equal(pet.timer, 126);
  assert.equal(pet.vx, 0);
  assert.equal(pet.vy, 0);
  assert.equal(remembered, true);
  assert.equal(said, "배고프다냐옹");
  assert.match(source, /p\.kind === "fluffyCat" \|\| p\.kind === "calicoCat"\)\{ petStartFluffyGroom\(p\); \}/);
});

test("다중 행 스프라이트 렌더링과 비행·착지 상태가 엔진에 연결된다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  assert.match(source, /const sourceX = \(frameIndex % cols\) \* p\.spriteSheet\.cellW/);
  assert.match(source, /const sourceY = Math\.floor\(frameIndex \/ cols\) \* p\.spriteSheet\.cellH/);
  assert.match(source, /p\.state === "diagonalFly" \|\| p\.state === "wallBounce"/);
  assert.match(source, /petFluffyWallBounce\(p, -1\)/);
  assert.match(source, /petFluffyWallBounce\(p, 1\)/);
  assert.match(source, /p\.state = "land"; p\.timer = 14/);
});

test("복실고양이는 직접 클릭하기 전까지 우선 등장하고 이후에는 무작위 순서를 유지한다", () => {
  // Windows 체크아웃(CRLF)에서도 "\n\n" 경계 탐색이 어긋나지 않게 정규화한다
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petNewFluffyCatBiasBag");
  const end = source.indexOf("\n\n// ----- 켜기/끄기", start);
  assert.ok(start >= 0 && end > start);
  let seen = false;
  const context = {
    petFluffyCatSeen:() => seen,
    petSpeciesId:species => species.id
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.bias=petNewFluffyCatBiasBag;", context);
  const bag = [{ id:"dog" }, { id:"fluffyCat" }, { id:"robot" }];
  assert.equal(context.bias(bag)[0].id, "fluffyCat");
  seen = true;
  assert.deepEqual(Array.from(context.bias(bag), item => item.id), ["dog", "fluffyCat", "robot"]);
});
