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
  const html = read("classdock.html");
  assert.match(loaders, /\(ext === "musicxml" \|\| ext === "mxl"\) && typeof loadMusicXml === "function"/);
  assert.match(html, /id="fileInput"[^>]*accept="[^"]*\.msheet,[^"]*\.musicxml,[^"]*\.mxl/);
  assert.match(xmlSource, /async function loadMusicXml\(file, opts = \{\}\)/);
  assert.match(xmlSource, /MNLazy\.tryNeed\("jszip"\)/);
  assert.match(xmlSource, /META-INF\/container\.xml/);
  // 다른 파일처럼 원본 이름 그대로 문서가 된다 — 이름을 .msheet 로 바꾸거나 원본 핸들을 떼지 않는다.
  assert.match(xmlSource, /new File\(\[musicSerialize\(imported\.sheet\)\], file\.name/);
  assert.doesNotMatch(xmlSource, /fsHandle:null/);
  assert.doesNotMatch(xmlSource, /originalSaveMode:false/);
  assert.doesNotMatch(xmlSource, /musicXmlDerivedPath/);
});

test("MusicXML 문서는 원래 형식으로 저장하고, 남이 만든 원본은 처음 한 번 묻는다", () => {
  const editor = read("src/js/music-editor.js");
  assert.match(editor, /const format = musicXmlDocFormat\(doc\.name\)/);
  assert.match(editor, /payload = await musicXmlBuildMxl\(musicSerializeXml\(doc\.sheet\)\)/);
  assert.match(editor, /if \(!doc \|\| doc\.musicXmlOwned/);
  assert.match(editor, /confirmDialog\(message, "악보\(\.msheet\)로 따로 저장", "취소", \{ altText:"원본에 덮어쓰기" \}\)/);
  assert.match(editor, /await loadMusicXml\(file, \{ importAsSheet:true \}\)/);
  // 이진(.mxl) 내용이 텍스트 저장 경로에서 문자열로 바뀌면 안 된다
  assert.match(read("src/js/code-viewer.js"), /if \(value instanceof Uint8Array\) return value;/);
});

test("앱이 쓴 MusicXML 에는 악보 전체를 담고, 복구본은 원본을 누가 만들었는지 함께 남긴다", () => {
  const api = loadMusicXmlApi();
  const sheet = api.musicEmpty("담기 $& 시험");
  sheet.drumStyle = "rock";
  const xml = api.musicSerializeXml(sheet);
  assert.match(xml, /<\/work>\n  <identification><encoding><software>ClassDock<\/software><\/encoding><miscellaneous><miscellaneous-field name="classdock-msheet">/);
  assert.match(xml, /&quot;drumStyle&quot;:&quot;rock&quot;/);
  assert.match(xml, /<work-title>담기 \$&amp; 시험<\/work-title>/);
  assert.equal(api.musicXmlComparableBody(xml), api.musicXmlComparableBody(api.musicSerializeXmlPlain(sheet)));
  assert.equal(api.musicXmlComparableBody(xml.replace(/\n/g, "\r\n")), api.musicXmlComparableBody(xml));
  const recovered = api.musicXmlReadRecovery(api.musicXmlRecoveryText(sheet, true));
  assert.equal(recovered.owned, true);
  assert.equal(recovered.sheet.drumStyle, "rock");
  assert.equal(api.musicXmlReadRecovery("<?xml version=\"1.0\"?><score-partwise/>"), null);
  assert.equal(api.musicXmlDocFormat("곡.MXL"), "mxl");
  assert.equal(api.musicXmlDocFormat("곡.msheet"), "");
});

test("MusicXML 변환 계층은 모델 다음, 편집기 전에 로드된다", () => {
  const manifest = JSON.parse(read("scripts.manifest.json"));
  const html = read("classdock.html");
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

test("다중 악기 악보는 모든 파트 이름과 독립된 part 본문을 MusicXML로 내보낸다", () => {
  const api = loadMusicXmlApi();
  const sheet = api.musicEmpty("합주");
  sheet.measures = [api.musicMeasure([api.musicNote("C", 4)])];
  api.musicAddPart(sheet, { name:"플루트", timbre:"flute" });
  sheet.measures[0].notes.push(api.musicNote("G", 5));
  const xml = api.musicSerializeXml(sheet);
  assert.equal((xml.match(/<score-part id="P\d+">/g) || []).length, 2);
  assert.equal((xml.match(/<part id="P\d+">/g) || []).length, 2);
  assert.match(xml, /<part-name>피아노<\/part-name>/);
  assert.match(xml, /<part-name>플루트<\/part-name>/);
  assert.match(xml, /<step>C<\/step>/);
  assert.match(xml, /<step>G<\/step>/);
  assert.doesNotMatch(xmlSource, /여러 파트 중 첫 번째 파트만 가져왔어요/);
  assert.match(xmlSource, /for \(let partIndex = 1; partIndex < parts\.length; partIndex\+\+\)/);
});

test("가져오기는 각 오선의 두 성부를 고르고 지원 길이를 정규화한다", () => {
  const api = loadMusicXmlApi();
  const warnings = new Set();
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.musicXmlSupportedDuration("quarter", 2, 0, 1, warnings))),
    { value:"quarter", dots:2 }
  );
  assert.match(xmlSource, /각 오선의 성부는 두 개까지만 가져왔어요/);
  assert.match(xmlSource, /musicVoiceNotes\(measure, staff, editorVoice\)/);
  assert.match(xmlSource, /musicAddChordPitch\(lastNote\[voiceKey\], pitch\)/);
  assert.match(xmlSource, /if \(tieStart\) lastNote\[voiceKey\]\.tieToNext = true/);
});

test("두 성부·표현 기호·반복·중간 설정을 MusicXML로 내보낸다", () => {
  const api = loadMusicXmlApi();
  const sheet = api.musicEmpty("확장 악보");
  sheet.measures = [api.musicMeasure([
    api.musicNote("C", 4, { value:"eighth", tuplet:3, slurToNext:true, lyric:"봄",
      dynamic:"mf", articulation:"staccato", fingering:1, pedal:"start" }),
    api.musicNote("D", 4, { value:"eighth", tuplet:3 }),
    api.musicNote("E", 4, { value:"eighth", tuplet:3 })
  ], { voice2Notes:[api.musicNote("G", 3, { value:"half" })], repeatStart:true, repeatEnd:true, ending:1,
    pickupTicks:480, timeChange:{ beats:3, beatValue:4 }, keyChange:"G", tempoChange:90 })];
  const xml = api.musicSerializeXml(sheet);
  assert.match(xml, /<measure number="1" implicit="yes">/);
  assert.match(xml, /<voice>2<\/voice>/);
  assert.match(xml, /<actual-notes>3<\/actual-notes>/);
  assert.match(xml, /<slur type="start"/);
  assert.match(xml, /<lyric number="1"><text>봄<\/text><\/lyric>/);
  assert.match(xml, /<dynamics><mf\/><\/dynamics>/);
  assert.match(xml, /<articulations><staccato\/><\/articulations>/);
  assert.match(xml, /<fingering>1<\/fingering>/);
  assert.match(xml, /<pedal type="start"\/>/);
  assert.match(xml, /<repeat direction="forward"\/>/);
  assert.match(xml, /<ending number="1" type="start"\/>/);
});

test("피아노 대보표·화음·붙임줄·코드 기호를 MusicXML로 내보낸다", () => {
  const api = loadMusicXmlApi();
  const sheet = api.musicEmpty("피아노");
  sheet.grandStaff = true;
  sheet.key = "Cm";
  sheet.measures = [api.musicMeasure([
    api.musicNote("C", 4, { value:"half", chordSymbol:"Cm7", tieToNext:true,
      chord:[{ step:"E", octave:4, alter:-1 }, { step:"G", octave:4, alter:0 }] }),
    api.musicNote("C", 4, { value:"half", chord:[{ step:"E", octave:4, alter:-1 }, { step:"G", octave:4, alter:0 }] })
  ], { bassNotes:[api.musicNote("C", 3, { value:"whole" })] })];
  const xml = api.musicSerializeXml(sheet);
  assert.match(xml, /<fifths>-3<\/fifths><mode>minor<\/mode>/);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<clef number="2"><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.match(xml, /<kind text="Cm7">other<\/kind>/);
  assert.equal((xml.match(/<chord\/>/g) || []).length, 4);
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<tie type="stop"\/>/);
  assert.match(xml, /<backup>[\s\S]*<staff>2<\/staff>/);
});

test("편집기에서 MusicXML 가져오기와 내려받기 버튼을 제공한다", () => {
  const editor = read("src/js/music-editor.js");
  assert.match(editor, /const musicXmlImportBtn = musicButton\("MusicXML 열기"/);
  assert.match(editor, /musicXmlInput\.accept = "\.musicxml,\.mxl"/);
  assert.match(editor, /musicXmlImportBtn\.addEventListener\("click", \(\) => musicXmlInput\.click\(\)\)/);
  assert.match(editor, /await loadMusicXml\(file, \{ importAsSheet:true \}\)/);
  assert.match(editor, /label:"MusicXML 가져오기…", action:\(\) => musicXmlInput\.click\(\)/);
  assert.match(editor, /const musicXmlBtn = musicButton\("MusicXML 저장"/);
  assert.match(editor, /musicSerializeXml\(sheet\)/);
  assert.match(editor, /musicExportName\(doc, "musicxml"\)/);
  assert.match(editor, /application\/vnd\.recordare\.musicxml\+xml/);
  assert.match(editor, /좌우 미세 위치는 다른 프로그램의 자동 조판에 따라 달라질 수 있어요/);
  assert.match(read("src/js/state.js"), /label:"MusicXML 가져오기·내보내기"/);
});

test("가사 여러 절은 <lyric number>로 나가고 그대로 다시 들어온다", () => {
  const api = loadMusicXmlApi();
  const sheet = api.musicEmpty("절 왕복");
  const note = api.musicNote("C", 4, { value:"quarter" });
  api.musicSetNoteLyric(note, 1, "봄");
  api.musicSetNoteLyric(note, 2, "여");
  sheet.measures[0].notes.push(note);
  sheet.parts[0].measures = sheet.measures;
  const xml = api.musicSerializeXml(sheet);
  assert.match(xml, /<lyric number="1"><text>봄<\/text><\/lyric>/);
  assert.match(xml, /<lyric number="2"><text>여<\/text><\/lyric>/);
});

test("이조 악기 파트는 <transpose>로 나가고 옥타브까지 적는다", () => {
  const api = loadMusicXmlApi();
  const sheet = api.musicEmpty("이조");
  sheet.measures = [api.musicMeasure([api.musicNote("D", 4, { value:"whole" })])];
  sheet.parts[0].measures = sheet.measures;
  api.musicActivePart(sheet).transposition = "Bb";
  const xml = api.musicSerializeXml(sheet);
  assert.match(xml, /<transpose>[\s\S]*<diatonic>-1<\/diatonic>[\s\S]*<chromatic>-2<\/chromatic>[\s\S]*<\/transpose>/);
  assert.doesNotMatch(xml, /octave-change/);
  // 테너 색소폰은 옥타브가 더 붙는다 — 이 값을 빼먹으면 다른 프로그램에서 한 옥타브 어긋난다
  api.musicActivePart(sheet).transposition = "BbT";
  const tenor = api.musicSerializeXml(sheet);
  assert.match(tenor, /<chromatic>-2<\/chromatic>[\s\S]*<octave-change>-1<\/octave-change>/);
});
