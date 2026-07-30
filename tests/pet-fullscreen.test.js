"use strict";

// ⛶ 문서 전체화면(#content 만 최상단 레이어)에서도 픽셀펫이 보이게 하는 호스트 선택 규칙.
// body 에 붙은 요소는 전체화면 요소 밖이라 z-index 와 무관하게 그려지지 않는다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function makeEl(name, rect){
  const el = {
    name,
    children:[],
    closest:() => null,
    getBoundingClientRect:() => rect || { left:0, top:0, width:0, height:0 }
  };
  el.contains = other => other === el || el.children.includes(other);
  return el;
}

function hostHarness({ fullscreenElement = null, platforms = {} } = {}){
  const source = fs.readFileSync(path.join(root, "src/js/pet.js"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function petHost");
  const end = source.indexOf("\nfunction petFindSupport", start);
  assert.ok(start >= 0 && end > start);

  const body = makeEl("body");
  const documentElement = makeEl("html");
  // "html" 을 주면 이 하니스가 만든 documentElement 를 전체화면 요소로 삼는다
  if (fullscreenElement === "html") fullscreenElement = documentElement;
  const context = {
    PET_W:45, PET_H:33, Math,
    PET_PLATFORM_SELECTORS:["#tabBar", ".fs-controls"],
    window:{ innerWidth:1000, innerHeight:800 },
    document:{
      body,
      documentElement,
      fullscreenElement,
      querySelectorAll:sel => platforms[sel] || []
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + `
    ;globalThis.__fsTest={ host:petHost, platforms:petCollectPlatforms };`, context);
  return { api:context.__fsTest, body, documentElement };
}

test("평소에는 지금까지처럼 body 에 붙인다", () => {
  const { api, body } = hostHarness();
  assert.equal(api.host(), body);
});

test("문서 전체화면 중에는 전체화면 요소 안에 붙인다", () => {
  const content = makeEl("content");
  const { api } = hostHarness({ fullscreenElement:content });
  assert.equal(api.host(), content);
});

test("화면 전체를 올린 전체화면(화면보호기)은 body 그대로 — body 가 이미 그 안이다", () => {
  // documentElement 전체화면은 문서 전체가 최상단 레이어라 옮길 필요가 없다
  const whole = hostHarness({ fullscreenElement:"html" });
  assert.equal(whole.api.host(), whole.body);
});

test("전체화면에서는 밖에 있는 탭 바를 발판으로 쓰지 않는다", () => {
  const content = makeEl("content");
  const tabBar = makeEl("tabBar", { left:0, top:120, width:900, height:44 });
  const fsControls = makeEl("fsControls", { left:600, top:300, width:200, height:40 });
  content.children.push(fsControls);          // fs 컨트롤만 전체화면 요소 안에 있다

  const platforms = { "#tabBar":[tabBar], ".fs-controls":[fsControls] };

  // vm 컨텍스트에서 만들어진 배열이라 deepEqual 대신 값으로 비교한다
  const tops = api => api.platforms().map(p => p.y).join(",");

  // 전체화면이 아닐 때: 바닥 + 탭 바 + fs 컨트롤
  const normal = hostHarness({ platforms });
  assert.equal(tops(normal.api), "800,120,300");

  // #content 전체화면일 때: 바닥 + fs 컨트롤만(탭 바는 그려지지 않으므로 제외)
  const full = hostHarness({ fullscreenElement:content, platforms });
  assert.equal(tops(full.api), "800,300");
});
