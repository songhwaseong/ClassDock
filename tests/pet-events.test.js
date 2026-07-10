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

function loadPetEvents(){
  const context = {};
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "src/js/pet-events.js"), "utf8")
    + "\n;globalThis.__petEvents=PET_EVENT_DEFS;";
  vm.runInContext(source, context);
  return context.__petEvents;
}

test("행동 도감은 고유한 10개 항목과 6개 전용 연출을 제공한다", () => {
  const events = loadPetEvents();
  assert.equal(events.length, 10);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  assert.equal(events.filter(event => event.scene).length, 6);
  for (const event of events){
    assert.equal(event.pets.length, 2);
    assert.ok(event.title);
    assert.ok(event.hint);
    assert.ok(event.description);
    if (event.scene) assert.ok(event.duration >= 180);
  }
});
test("행동 조합의 모든 펫 ID와 도감 이름이 실제 종족 데이터에 존재한다", () => {
  const { PET_ART, PET_SPECIES, PET_NAMES } = loadPetCatalog();
  const events = loadPetEvents();
  const speciesIds = new Set(PET_SPECIES.map(species =>
    Object.keys(PET_ART).find(id => PET_ART[id] === species.art)
  ));
  for (const event of events){
    for (const id of event.pets){
      assert.ok(speciesIds.has(id), `알 수 없는 펫 ID: ${id}`);
      assert.ok(PET_NAMES[id], `도감 이름 누락: ${id}`);
    }
  }
  for (const id of speciesIds) assert.ok(PET_NAMES[id], `전체 도감 이름 누락: ${id}`);
});

test("행동 데이터 스크립트는 펫 엔진보다 먼저 로드된다", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
  const eventIndex = manifest.localScripts.indexOf("pet-events.js");
  const engineIndex = manifest.localScripts.indexOf("pet.js");
  assert.ok(eventIndex >= 0);
  assert.ok(eventIndex < engineIndex);
});
