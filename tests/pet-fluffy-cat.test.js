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
  assert.equal(fluffy.spriteSheet.frameMs.walk, 90);
  assert.equal(fluffy.spriteSheet.frameMs.diagonalFly, 116.67);
  assert.deepEqual(Array.from(fluffy.spriteSheet.frameOffsets[6]), [2, 18]);
  assert.deepEqual(Array.from(fluffy.spriteSheet.frameOffsets[11]), [2, 18]);
  assert.deepEqual(Array.from(fluffy.sayings), ["배고프다냐옹"]);
});

test("복실고양이 시간 배율은 화면 주사율과 무관하게 60Hz 물리 시간으로 환산한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petFrameScale");
  const end = source.indexOf("\n\n// ----- 발판 수집", start);
  assert.ok(start >= 0 && end > start);
  const context = { PET_BASE_FRAME_MS:1000 / 60 };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.frameScale=petFrameScale;", context);

  assert.ok(Math.abs(context.frameScale(1000 / 60) - 1) < 1e-9);
  assert.ok(Math.abs(context.frameScale(1000 / 120) - 0.5) < 1e-9);
  assert.equal(context.frameScale(1000 / 20), 2, "긴 프레임은 두 틱까지만 따라잡는다");
  assert.equal(context.frameScale(500), 1, "탭 복귀 간격은 한 틱으로 안전하게 처리한다");
});

test("복실고양이는 걷기 속도에서 비행 목표 속도로 완만하게 이륙한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petStartFluffyFlight");
  const end = source.indexOf("\nfunction petFluffyWallBounce", start);
  assert.ok(start >= 0 && end > start);
  const context = { PET_WALK:1.05, Math };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.startFlight=petStartFluffyFlight;", context);

  const pet = { state:"walk", face:1, t:12, vx:0, vy:0, support:{}, rot:2, squash:0.2 };
  context.startFlight(pet);
  assert.equal(pet.state, "diagonalFly");
  assert.equal(pet.flightStartVx, 1.05);
  assert.equal(pet.flightStartVy, 0);
  assert.ok(pet.flightTargetVx > pet.flightStartVx);
  assert.ok(pet.flightTargetVy < 0);
  assert.equal(pet.flightEase, 0);
  assert.equal(pet.vx, pet.flightStartVx);
  assert.equal(pet.vy, 0);
});

test("복실고양이 PNG는 6×4 RGBA 셀 시트이며 오프라인 빌드 대상이다", () => {
  const spritePath = path.join(root, "src/assets/fluffy-cat-sprites-v2.png");
  const bytes = fs.readFileSync(spritePath);
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 96 * 6);
  assert.equal(bytes.readUInt32BE(20), 96 * 4);
  assert.equal(bytes[25], 6, "PNG color type must be RGBA");
  assert.ok(bytes.length > 10000, "sprite sheet is unexpectedly empty");

  // 단일 파일 빌드에는 이 그림이 반드시 들어가야 한다. 다만 예전처럼 JavaScript 문자열에
  // 직접 박아 넣지 않고, 실행되지 않는 JSON 표(#mnPetSprites)에 경로→데이터URL 로 넣는다.
  // 펫은 기본 꺼짐이라, 켜지 않은 사용자가 약 1.6MB 를 함께 파싱하지 않게 하기 위함이다.
  const buildSource = fs.readFileSync(path.join(root, "build-offline.js"), "utf8");
  assert.match(buildSource, /src\/assets\/fluffy-cat-sprites-v2\.png/);
  assert.match(buildSource, /petSpriteMap\[petSpriteRelative\]\s*=\s*"data:image\/png;base64,"/);
  assert.match(buildSource, /id="mnPetSprites"/);
  // 그리는 쪽은 그 표를 거쳐 실제 URL 을 얻어야 한다(안 그러면 EXE 에서 그림이 안 뜬다).
  const petSource = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  assert.match(petSource, /spriteImage\.src\s*=\s*petSpriteUrl\(species\.spriteSheet\.src\)/);
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

test("짧은 클릭은 점프 대신 그루밍과 저장된 복실고양이 대사를 시작한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  const start = source.indexOf("function petStartFluffyGroom");
  const end = source.indexOf("\n// 벽 꼭대기", start);
  assert.ok(start >= 0 && end > start);
  let said = null;
  let translated = null;
  let remembered = false;
  const context = {
    petRememberFluffyCatSeen:() => { remembered = true; },
    petRandomSaying:(pet, fallback) => pet.sayings && pet.sayings[1] || fallback,
    petSay:(_pet, text, translate) => { said = text; translated = translate; }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.groom=petStartFluffyGroom;", context);
  const pet = { kind:"fluffyCat", sayings:["배고프다냐옹", "추르달라냥"], state:"walk", timer:0, t:20, vx:2, vy:1, rot:3, squash:0.2 };
  context.groom(pet);
  assert.equal(pet.state, "groom");
  assert.equal(pet.timer, 126);
  assert.equal(pet.vx, 0);
  assert.equal(pet.vy, 0);
  assert.equal(remembered, true);
  assert.equal(said, "추르달라냥");
  assert.equal(translated, false);
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
  assert.match(source, /p\.spriteDrawFrame !== frameIndex/);
  assert.match(source, /petDraw\(p, w\.frameDeltaMs\)/);
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

test("코딩 중 휴식할 때 복실고양이의 전체 크기가 화면 안에 남는다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petQuietUpdate");
  const end = source.indexOf("\nfunction petSetRhythm", start);
  assert.ok(start >= 0 && end > start);

  const context = { PET_W:45, PET_H:33, window:{ innerWidth:1264, innerHeight:910 }, Math };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.quietUpdate=petQuietUpdate;", context);

  const pet = {
    quiet:true, w:96, h:96, x:8, y:808, face:1, rot:0, squash:0, off:false, t:0,
    el:{ classList:{ add(){} } }
  };
  const world = { pets:[pet] };
  context.quietUpdate(pet, world);

  assert.equal(pet.x, 8);
  assert.equal(pet.y, 808);
  assert.equal(pet.y + pet.h, context.window.innerHeight - 6);
});
