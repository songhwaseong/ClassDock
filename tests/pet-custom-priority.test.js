const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadPetCustomHarness(initialStorage){
  const values = new Map(Object.entries(initialStorage || {}));
  const context = {
    PET_ART: { crab:["A"], robot:["B"] },
    localStorage: {
      getItem:(key) => values.has(key) ? values.get(key) : null,
      setItem:(key, value) => values.set(key, String(value))
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "src/js/pet-custom.js"), "utf8") + `
    ;globalThis.__petCustomHarness = { petCustomLoad, petCustomSave, petCustomSpecies };
  `;
  vm.runInContext(source, context);
  return { api:context.__petCustomHarness, values };
}

test("custom pet priority is normalized and exposed to the pet engine", () => {
  const stored = JSON.stringify([
    { id:"custom:a", name:"A", art:"crab", kind:"walker", palette:{ A:"#111111" }, sayings:["hi"], priority:true },
    { id:"custom:b", name:"B", art:"robot", kind:"walker", palette:{ A:"#222222" }, priority:"yes" }
  ]);
  const { api } = loadPetCustomHarness({ "mn.petCustom":stored });
  const list = api.petCustomLoad();
  assert.equal(list[0].priority, true);
  assert.equal(list[1].priority, false);
  const species = api.petCustomSpecies();
  const exposed = JSON.parse(JSON.stringify(species.map(item => [item.id, item.priority, item.priorityIndex])));
  assert.deepEqual(exposed, [
    ["custom:a", true, 0],
    ["custom:b", false, 1]
  ]);
});
