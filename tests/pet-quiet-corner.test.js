"use strict";

// 집중·타이핑 중 조용히 기다리는 자리: 기본은 좌·우 번갈아 아래쪽이지만,
// 마우스로 끌어다 놓으면 그 근처 코너(상단 포함)에서 기다린다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function quietHarness({ innerWidth = 1000, innerHeight = 800, tabBarBottom = null } = {}){
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petQuietUpdate");
  const end = source.indexOf("\nfunction petSetRhythm", start);
  assert.ok(start >= 0 && end > start);

  const bar = tabBarBottom === null ? null : {
    closest:() => null,
    getBoundingClientRect:() => ({ height:tabBarBottom, top:0, bottom:tabBarBottom })
  };
  const context = {
    PET_W:45, PET_H:33, Math,
    window:{ innerWidth, innerHeight },
    document:{ getElementById:id => id === "tabBar" ? bar : null }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + `
    ;globalThis.__quietTest={ update:petQuietUpdate, corner:petQuietCorner,
      topY:petQuietTopY, remember:petQuietRememberCorner };`, context);
  return { api:context.__quietTest, context };
}

function makePet(extra = {}){
  return Object.assign({
    quiet:false, w:45, h:33, x:400, y:400, face:1, rot:0, squash:0, off:false, t:0,
    el:{ classList:{ add(){}, remove(){}, toggle(){} } }
  }, extra);
}

// 목표 자리까지 수렴시킨다(매 프레임 0.065 씩 다가간다)
function settle(api, pets, world, frames = 400){
  for (let i = 0; i < frames; i++) for (const p of pets) api.update(p, world);
}

test("끌어다 놓지 않은 펫은 지금까지처럼 좌·우 번갈아 아래쪽에서 기다린다", () => {
  const { api } = quietHarness();
  const pets = [makePet(), makePet(), makePet()];
  const world = { pets };
  settle(api, pets, world);

  assert.equal(Math.round(pets[0].x), 8);                       // 왼쪽 첫째
  assert.equal(Math.round(pets[1].x), 1000 - 45 - 8);           // 오른쪽 첫째
  assert.equal(Math.round(pets[2].x), 8 + 45 + 7);              // 왼쪽 둘째
  for (const p of pets){
    assert.equal(Math.round(p.y), 800 - 33 - 6);                // 모두 화면 아래쪽
    assert.equal(p.off, true);
  }
  assert.equal(pets[0].face, 1);
  assert.equal(pets[1].face, -1);
});

test("놓아 준 자리로 코너를 정한다(네 방향 모두)", () => {
  const { api } = quietHarness();
  const cases = [
    { x:20,  y:20,  sx:0, sy:0 },
    { x:900, y:20,  sx:1, sy:0 },
    { x:20,  y:700, sx:0, sy:1 },
    { x:900, y:700, sx:1, sy:1 }
  ];
  for (const c of cases){
    const p = makePet({ x:c.x, y:c.y });
    api.remember(p);
    assert.equal(p.quietCorner.sx, c.sx);
    assert.equal(p.quietCorner.sy, c.sy);
  }
});

test("위쪽 코너로 끌어다 놓으면 탭 바 바로 아래에서 기다린다", () => {
  const { api } = quietHarness({ tabBarBottom:44 });
  const pet = makePet({ x:900, y:30, quietCorner:{ sx:1, sy:0 } });
  const world = { pets:[pet] };
  settle(api, [pet], world);

  assert.equal(api.topY(), 48);                                 // 탭 바 아래 4px
  assert.equal(Math.round(pet.y), 48);
  assert.equal(Math.round(pet.x), 1000 - 45 - 8);
  assert.equal(pet.face, -1);
});

test("탭 바가 없으면 위쪽 코너는 화면 맨 위에 붙는다", () => {
  const { api } = quietHarness();
  const pet = makePet({ quietCorner:{ sx:0, sy:0 } });
  const world = { pets:[pet] };
  settle(api, [pet], world);

  assert.equal(api.topY(), 6);
  assert.equal(Math.round(pet.y), 6);
  assert.equal(Math.round(pet.x), 8);
});

test("같은 코너로 여러 마리를 끌어다 놓아도 겹치지 않고 나란히 기다린다", () => {
  const { api } = quietHarness();
  const pets = [
    makePet({ quietCorner:{ sx:0, sy:0 } }),
    makePet(),                                                  // 기본 자리(index 1 → 오른쪽 아래)
    makePet({ quietCorner:{ sx:0, sy:0 } })
  ];
  const world = { pets };
  settle(api, pets, world);

  assert.equal(Math.round(pets[0].x), 8);
  assert.equal(Math.round(pets[2].x), 8 + 45 + 7);              // 위쪽 왼편에서 둘째 자리
  assert.equal(Math.round(pets[0].y), 6);
  assert.equal(Math.round(pets[2].y), 6);
  assert.equal(Math.round(pets[1].x), 1000 - 45 - 8);           // 끌지 않은 펫은 기본 자리 그대로
  assert.equal(Math.round(pets[1].y), 800 - 33 - 6);
});

test("펫보다 낮은 화면에서도 위쪽 목표가 화면 밖으로 나가지 않는다", () => {
  const { api } = quietHarness({ innerHeight:40, tabBarBottom:44 });
  const pet = makePet({ y:0, quietCorner:{ sx:0, sy:0 } });
  const world = { pets:[pet] };
  settle(api, [pet], world);

  assert.equal(Math.round(pet.y), Math.max(0, 40 - 33 - 6));
});
