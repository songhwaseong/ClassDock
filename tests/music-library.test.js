"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadLibrary(){
  const context = { console, Intl, String, Object, Array, Set, Math };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ["music-library-data.js", "music-library.js"]){
    const source = fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8");
    vm.runInContext(source, context, { filename:file });
  }
  return vm.runInContext("MNMusicLibrary", context);
}

test("OpenScore CC0 카탈로그는 천 곡 이상이며 MusicXML 주소만 담는다", () => {
  const library = loadLibrary();
  assert.ok(library.count >= 1000);
  assert.equal(library.catalog.license, "CC0-1.0");
  assert.ok(library.catalog.scores.every((score) =>
    score.mxl.startsWith("https://raw.githubusercontent.com/OpenScore/Lieder/") && /\.mxl\?raw=true$/.test(score.mxl)));
});

test("무료 악보는 원어·한글 작곡가 이름과 언어로 검색한다", () => {
  const library = loadLibrary();
  const english = library.search("Beethoven Mailied");
  assert.ok(english.some((score) => /Mailied/i.test(score.title)));
  const korean = library.search("베토벤");
  assert.ok(korean.length > 0);
  assert.ok(korean.every((score) => score.composer.includes("Beethoven")));
  assert.ok(library.search("Schubert", "DE").every((score) => score.language === "DE"));
});
