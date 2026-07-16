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
  assert.match(source, /p\.kind !== "human" && p\.t > 40 && Math\.random\(\) < 0\.004/);
});

// 벽 꼭대기 도약 계산기만 떼어내 실제 낙하 적분으로 검증한다
function loadWallHop(){
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  const start = source.indexOf("function petPlanWallHop");
  const end = source.indexOf("\n// 아저씨: 만세한 채", start);
  assert.ok(start >= 0 && end > start, "petPlanWallHop 을 찾지 못함");
  const context = { PET_W:45, PET_H:33, PET_GRAV:0.5, PET_HOP_VX:5.2, PET_HOP_VY:-3.6, Math };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + ";globalThis.plan=petPlanWallHop;", context);
  return context.plan;
}

// pet.js 의 점프와 같은 적분(vy += g 뒤 x += vx, y += vy)으로 착지 지점을 구한다
function simulateFall(p, vx, platform){
  let x = p.x, y = p.y, vy = -3.6;
  for (let i = 0; i < 600; i++){
    const prevFeet = y + p.h;
    vy += 0.5; x += vx; y += vy;
    const feet = y + p.h, cx = x + p.w / 2;
    if (vy > 0 && prevFeet <= platform.y + 1 && feet >= platform.y)   // 실제 코드처럼 내려올 때만 착지 판정
      return (cx >= platform.x && cx <= platform.x + platform.w) ? { landed:true, cx } : { landed:false, cx };
  }
  return { landed:false, cx:x + p.w / 2 };
}

test("아저씨의 벽 꼭대기 도약은 실제로 선반 위에 착지하는 속도만 고른다", () => {
  const plan = loadWallHop();
  const pet = { x:0, y:0, w:64, h:80, side:-1 };                     // 왼쪽 벽 꼭대기의 픽셀 선생님
  const shelf = { x:150, y:520, w:260, floor:false };
  const w = { platforms:[{ x:0, y:900, w:1280, floor:true }, shelf] };

  for (let i = 0; i < 200; i++){
    const vx = plan(pet, w);
    assert.ok(vx !== null, "닿을 수 있는 선반인데 후보를 못 찾음");
    assert.ok(vx > 0, `왼쪽 벽에서는 오른쪽으로 뛰어야 함: ${vx}`);
    assert.ok(vx <= 5.2, `상한을 넘는 속도: ${vx}`);
    const hit = simulateFall(pet, vx, shelf);
    assert.ok(hit.landed, `선반 밖에 떨어짐: vx=${vx} cx=${hit.cx}`);
  }
});

test("아저씨의 벽 꼭대기 도약은 못 닿는 선반이면 후보를 내지 않는다(그냥 뛰어내린다)", () => {
  const plan = loadWallHop();
  const pet = { x:0, y:0, w:64, h:80, side:-1 };
  const floor = { x:0, y:900, w:1280, floor:true };

  // 너무 멀어 낙하 시간 안에 못 닿는 선반
  assert.equal(plan(pet, { platforms:[floor, { x:1100, y:520, w:160, floor:false }] }), null);
  // 펫보다 좁은 선반
  assert.equal(plan(pet, { platforms:[floor, { x:150, y:520, w:60, floor:false }] }), null);
  // 발밑이 아니라 눈높이에 있는 선반
  assert.equal(plan(pet, { platforms:[floor, { x:150, y:100, w:260, floor:false }] }), null);
  // 바닥만 있으면 건너뛸 곳이 없다
  assert.equal(plan(pet, { platforms:[floor] }), null);

  // 오른쪽 벽에서는 왼쪽으로만 뛴다
  const right = { x:1216, y:0, w:64, h:80, side:1 };
  const vx = plan(right, { platforms:[floor, { x:1000, y:520, w:260, floor:false }] });
  assert.ok(vx !== null && vx < 0, `오른쪽 벽에서는 왼쪽으로 뛰어야 함: ${vx}`);
});

test("만세 뒤 두둥실은 스스로 한 만세만 이어지고 만세 자세를 유지한다", () => {
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8");
  assert.match(source, /const PET_CHEER_POSE_STATES = \["cheer", "soar", "glide"\]/);
  // 떠오르는 동안 팔을 내리지 않는다(만세 그림 되돌리기가 soar·glide 를 건너뛴다)
  assert.match(source, /p\.cheerArt && !PET_CHEER_POSE_STATES\.includes\(p\.state\)/);
  // soar·glide 는 발판에 붙는 상태가 아니어야 공중에 뜬다
  const ground = source.match(/const PET_GROUND_STATES = \[[^\]]*\]/s)[0];
  assert.ok(!ground.includes("soar") && !ground.includes("glide"));
  // 스스로 한 만세만 mayFloat 를 켜고, 클릭 만세는 켜지 않는다
  assert.match(source, /roll < 0\.84\)\{ petCheer\(p, Math\.random\(\) < 0\.5, true\)/);
  assert.match(source, /p\.kind === "human" && p\.grav\)\{ petCheer\(p, true\)/);
  assert.match(source, /p\.soarAfter = !!mayFloat/);
  assert.match(source, /const soared = p\.soarAfter && Math\.random\(\) < 0\.5 && petSoarStart\(p, w\)/);
});

test("픽셀 선생님은 떠오르고 활강하는 동안 만세 셀을 그린다", () => {
  const { PET_ART, PET_SPECIES } = loadPetCatalog();
  const portrait = PET_SPECIES.find(species => species.art === PET_ART.glassesMan);
  const frames = portrait.spriteSheet.frames;
  assert.deepEqual(Array.from(frames.soar), Array.from(frames.cheer));
  assert.deepEqual(Array.from(frames.glide), Array.from(frames.cheer));
  assert.equal(portrait.motionArt.soar, portrait.motionArt.cheer);
  assert.equal(portrait.motionArt.glide, portrait.motionArt.cheer);
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
