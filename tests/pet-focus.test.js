"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function focusHarness(initial = {}){
  const values = new Map(Object.entries(initial));
  const context = {
    appSettings:{ petFocus:{ enabled:true, focusMin:25, breakMin:5, quietTyping:true } },
    normalizePetFocus:value => ({ enabled:value.enabled !== false, focusMin:Number(value.focusMin) || 25,
      breakMin:Number(value.breakMin) || 5, quietTyping:value.quietTyping !== false }),
    localStorage:{
      getItem:key => values.has(key) ? values.get(key) : null,
      setItem:(key, value) => values.set(key, String(value)),
      removeItem:key => values.delete(key)
    },
    document:{ getElementById:() => null },
    petSetRhythm:() => {},
    Date, Math, JSON
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "src/js/pet-focus.js"), "utf8") + `
    ;globalThis.__focusTest={
      format:petFocusFormat,
      dayKey:petFocusDayKey,
      load:petFocusLoad,
      restore:petFocusRestoreElapsed,
      getState:()=>({...petFocusState})
    };`;
  vm.runInContext(source, context);
  return { api:context.__focusTest, values };
}

test("집중 타이머는 남은 시간을 MM:SS 형식으로 표시한다", () => {
  const { api } = focusHarness();
  assert.equal(api.format(25 * 60 * 1000), "25:00");
  assert.equal(api.format(60_001), "01:01");
  assert.equal(api.format(-1), "00:00");
  assert.match(api.dayKey(new Date(2026, 6, 11)), /^2026-07-11$/);
});
test("앱이 닫힌 사이 집중이 끝나면 남은 휴식 구간으로 복원한다", () => {
  const session = JSON.stringify({ phase:"focus", running:true, endAt:Date.now() - 1000, remainingMs:0, totalMs:25 * 60 * 1000 });
  const { api, values } = focusHarness({ "mn.petFocusSession":session });
  api.load(); api.restore();
  const state = api.getState();
  assert.equal(state.phase, "break");
  assert.equal(state.running, true);
  assert.ok(state.endAt > Date.now());
  const stats = JSON.parse(values.get("mn.petFocusStats"));
  assert.equal(stats.cycles, 1);
});

test("이미 끝난 휴식 세션은 대기 상태로 정리한다", () => {
  const session = JSON.stringify({ phase:"break", running:true, endAt:Date.now() - 1000, remainingMs:0, totalMs:5 * 60 * 1000 });
  const { api, values } = focusHarness({ "mn.petFocusSession":session });
  api.load(); api.restore();
  assert.equal(api.getState().phase, "idle");
  assert.equal(JSON.parse(values.get("mn.petFocusSession")).phase, "idle");
});

test("집중 모드 스크립트와 필수 조작 UI가 올바른 순서로 포함된다", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
  assert.ok(manifest.localScripts.indexOf("pet.js") < manifest.localScripts.indexOf("pet-focus.js"));
  assert.ok(manifest.localScripts.indexOf("pet-focus.js") < manifest.localScripts.indexOf("app.js"));
  const html = fs.readFileSync(path.join(root, "manneung-classroom.html"), "utf8");
  for (const id of ["petFocusOpen", "petFocusPanel", "petFocusStart", "petFocusPause", "petFocusStop", "settingPetFocus"])
    assert.match(html, new RegExp(`id="${id}"`));
});
