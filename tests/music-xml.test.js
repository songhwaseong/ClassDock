"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const xmlSource = read("src/js/music-xml.js");

function loadMusicXmlApi(){
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(read("src/js/music-model.js"), context, { filename:"music-model.js" });
  vm.runInContext(xmlSource, context, { filename:"music-xml.js" });
  return context;
}

test("MusicXML 파일과 압축형 MXL을 전용 가져오기로 연다", () => {
  const loaders = read("src/js/file-loaders.js");
  const html = read("manneung-classroom.html");
  assert.match(loaders, /\(ext === "musicxml" \|\| ext === "mxl"\) && typeof loadMusicXml === "function"/);
  assert.match(html, /id="fileInput"[^>]*accept="[^"]*\.msheet,[^"]*\.musicxml,[^"]*\.mxl/);
  assert.match(xmlSource, /async function loadMusicXml\(file, opts = \{\}\)/);
  assert.match(xmlSource, /MNLazy\.tryNeed\("jszip"\)/);
  assert.match(xmlSource, /META-INF\/container\.xml/);
  assert.match(xmlSource, /new File\(\[musicSerialize\(imported\.sheet\)\], name/);
  assert.match(xmlSource, /isScratch:true/);
  assert.match(xmlSource, /fsHandle:null/);
  assert.match(xmlSource, /nativeAbsolutePath:null/);
  assert.match(xmlSource, /originalSaveMode:false/);
});

test("MusicXML 변환 계층은 모델 다음, 편집기 전에 로드된다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json"));
  const html = read("manneung-classroom.html");
  const at = (name) => manifest.localScripts.indexOf(name);
  assert.ok(at("music-model.js") < at("music-xml.js"));
  assert.ok(at("music-xml.js") < at("music-editor.js"));
  assert.ok(html.indexOf('src/js/music-model.js') < html.indexOf('src/js/music-xml.js'));
  assert.ok(html.indexOf('src/js/music-xml.js') < html.indexOf('src/js/music-editor.js'));
  assert.ok(manifest.scriptDependencies["music-editor.js"].includes("music-xml.js"));
});

test("단선율 msheet를 표준 score-partwise MusicXML로 내보낸다", () => {
  const api = loadMusicXmlApi();
  const sheet = api.musicEmpty("동요 & <연습>");
  sheet.tempo = 132;
  sheet.time = { beats:3, beatValue:4 };
  sheet.key = "G";
  sheet.measures = [
    api.musicMeasure([
      api.musicNote("F", 4, { alter:1, value:"quarter", dots:1 }),
      api.musicRest("eighth", 0)
    ]),
    api.musicMeasure([api.musicNote("C", 5, { value:"half", dots:0 })], { lineBreakBefore:true })
  ];
  const xml = api.musicSerializeXml(sheet);
  assert.match(xml, /<score-partwise version="4\.0">/);
  assert.match(xml, /<work-title>동요 &amp; &lt;연습&gt;<\/work-title>/);
  assert.match(xml, /<fifths>1<\/fifths>/);
  assert.match(xml, /<beats>3<\/beats><beat-type>4<\/beat-type>/);
  assert.match(xml, /<sound tempo="132"\/>/);
  assert.match(xml, /<step>F<\/step>/);
  assert.match(xml, /<alter>1<\/alter>/);
  assert.match(xml, /<duration>720<\/duration>/);
  assert.match(xml, /<type>quarter<\/type>\s*<dot\/>/);
  assert.match(xml, /<rest\/>/);
  assert.match(xml, /<print new-system="yes"\/>/);
});

test("가져오기 제한을 명시하고 지원 길이는 msheet 길이로 정규화한다", () => {
  const api = loadMusicXmlApi();
  const warnings = new Set();
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.musicXmlSupportedDuration("quarter", 2, 0, 1, warnings))),
    { value:"quarter", dots:2 }
  );
  assert.match(xmlSource, /여러 파트 중 첫 번째 파트만 가져왔어요/);
  assert.match(xmlSource, /화음은 가장 먼저 나온 음만 가져왔어요/);
  assert.match(xmlSource, /여러 성부 중 첫 번째 성부만 가져왔어요/);
  assert.match(xmlSource, /붙임줄은 개별 음표로 가져왔어요/);
});

test("편집기에서 MusicXML 내려받기 버튼을 제공한다", () => {
  const editor = read("src/js/music-editor.js");
  assert.match(editor, /const musicXmlBtn = musicButton\("⬇ MusicXML"/);
  assert.match(editor, /musicSerializeXml\(sheet\)/);
  assert.match(editor, /musicExportName\(doc, "musicxml"\)/);
  assert.match(editor, /application\/vnd\.recordare\.musicxml\+xml/);
  assert.match(editor, /좌우 미세 위치는 다른 프로그램의 자동 조판에 따라 달라질 수 있어요/);
});
