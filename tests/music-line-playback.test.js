"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const editorSource = fs.readFileSync(path.join(__dirname, "../src/js/music-editor.js"), "utf8");

// 실제 편집기의 선택·범위 계산 함수를 실행한다. DOM과 소리 출력만 대체하므로 화면 캡처가 필요 없다.
function loadPlayback(){
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js/music-model.js"), "utf8"), context);
  vm.runInContext(`
    const sheet = musicEmpty("선택 오선 테스트");
    sheet.grandStaff = true;
    sheet.measures = Array.from({ length:10 }, () => musicMeasure([musicNote("C", 4)], {
      bassNotes:[musicNote("C", 3)]
    }));
    musicSyncActivePart(sheet);
    let scoreLines = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]];
    let playbackMeasure = 0;
    let playbackPartId = sheet.activePartId;
    let selection = null, activeStaff = "treble", activeVoice = 1;
    const flags = new Set();
    const root = { classList:{ contains:name => flags.has(name) } };
    const practice = { active:false };
    let earActive = false;
    const earTest = { active:() => earActive };
    const document = { createElement:() => ({ value:"", textContent:"" }) };
    const playSelectedPartBtn = { disabled:true };
    const playbackLineSelect = {
      options:[], value:"", disabled:true,
      replaceChildren(){ this.options = []; },
      appendChild(option){ this.options.push(option); }
    };
    const plays = [];
    function startPlay(range, options){ plays.push({ range, options }); }
    const noteEls = new Map();
    function paintSelection(){}
    function syncTools(){}
    function updateMeasureProgress(){}
    function revealScoreElement(){}
  `, context);
  for (const name of ["measureNumberLabel", "syncPlaybackLineControls", "selectPlaybackLine", "startSelectedPart", "select"]){
    const pattern = new RegExp(`^  function ${name}\\([^\\n]*\\)\\{[^]*?^  \\}`, "m");
    const source = editorSource.match(pattern);
    assert.ok(source, `${name} 함수를 읽을 수 있어야 한다`);
    vm.runInContext(source[0], context);
  }
  const run = code => vm.runInContext(code, context);
  const read = code => JSON.parse(run(`JSON.stringify(${code})`));
  run("syncPlaybackLineControls(true)");
  return { run, read };
}

test("선택 파트 버튼·오선 목록·우클릭 메뉴를 같은 재생 경로에 연결한다", () => {
  assert.match(editorSource, /musicButton\("▶ 선택 파트"/);
  assert.match(editorSource, /playSelectedPartBtn\.addEventListener\("click", startSelectedPart\)/);
  assert.match(editorSource, /playbackLineSelect\.addEventListener\("change", \(\) => selectPlaybackLine\(Number\(playbackLineSelect\.value\)\)\)/);
  assert.match(editorSource, /label:"선택 파트 재생 \(이 오선 줄\)"[^]*?selectPlaybackLine\(targetLine\);\s+startSelectedPart\(\)/);
  assert.match(editorSource, /label:"현재 악기 전체 재생"/);
  assert.match(editorSource, /playbackMeasure = sheet\.measures\.length - 1;\s+afterEdit\(\)/);
  assert.match(editorSource, /playSelectedPartBtn, playbackLineSelect,\s+speedSelect/);
});

test("오선 목록에는 줄 번호와 마디 범위를 표시한다", () => {
  const h = loadPlayback();
  assert.deepEqual(h.read("playbackLineSelect.options"), [
    { value:"0", textContent:"1번째 오선 (1~4마디)" },
    { value:"1", textContent:"2번째 오선 (5~8마디)" },
    { value:"2", textContent:"3번째 오선 (9~10마디)" }
  ]);
  assert.equal(h.run("playbackLineSelect.value"), "0");
  assert.equal(h.run("playSelectedPartBtn.disabled"), false);
});

test("맨 아래 음표를 선택하면 그 오선 처음부터 끝까지만 재생한다", () => {
  const h = loadPlayback();
  h.run('select(9, sheet.measures[9].notes[0].id); startSelectedPart()');
  assert.equal(h.run("playbackLineSelect.value"), "2");
  assert.deepEqual(h.read("plays[0].range"), { from:9, to:10 });
  assert.equal(h.run("plays[0].options.partId === sheet.activePartId"), true);
  h.run("const timeline = musicTimeline(sheet, { ...plays[0].range, ...plays[0].options })");
  assert.deepEqual(h.read("timeline.measureOrder"), [9, 10]);
  assert.equal(h.run("timeline.events[0].start"), 0);
  assert.equal(h.run("timeline.events.every(event => event.measure >= 9 && event.measure <= 10)"), true);
  assert.deepEqual(h.read("Array.from(new Set(timeline.events.map(event => event.staff))).sort()"), ["bass", "treble"]);
});

test("목록으로 다른 오선을 고른 뒤 음표를 다시 선택하면 재생 대상도 따라간다", () => {
  const h = loadPlayback();
  h.run('select(9, sheet.measures[9].notes[0].id)');
  const before = h.run("musicSerialize(sheet)");
  h.run("selectPlaybackLine(1); startSelectedPart()");
  assert.deepEqual(h.read("plays[0].range"), { from:5, to:8 });
  assert.equal(h.run("musicSerialize(sheet)"), before, "오선 선택만으로 악보를 수정하지 않는다");
  h.run('select(8, sheet.measures[8].bassNotes[0].id, { staff:"bass" }); startSelectedPart()');
  assert.deepEqual(h.read("plays[1].range"), { from:9, to:10 });
});

test("창 폭·줄바꿈이 달라져도 기준 마디가 들어 있는 오선을 고른다", () => {
  const h = loadPlayback();
  h.run('select(9, sheet.measures[9].notes[0].id)');
  h.run("scoreLines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]; syncPlaybackLineControls(true); startSelectedPart()");
  assert.equal(h.run("playbackLineSelect.value"), "3");
  assert.equal(h.run("playbackLineSelect.options[3].textContent"), "4번째 오선 (10마디)");
  assert.deepEqual(h.read("plays[0].range"), { from:10, to:10 });
});

test("오선을 삭제하면 남아 있는 마지막 오선 범위로 보정한다", () => {
  const h = loadPlayback();
  h.run("selectPlaybackLine(2); sheet.measures.splice(8); scoreLines.pop(); syncPlaybackLineControls(true); startSelectedPart()");
  assert.equal(h.run("playbackLineSelect.value"), "1");
  assert.deepEqual(h.read("plays[0].range"), { from:5, to:8 });
});

test("못갖춘마디는 표시 번호만 다르고 실제 재생은 배열 범위를 따른다", () => {
  const h = loadPlayback();
  h.run("sheet.measures[0].pickupTicks = 480; syncPlaybackLineControls(true); selectPlaybackLine(2); startSelectedPart()");
  assert.equal(h.run("playbackLineSelect.options[2].textContent"), "3번째 오선 (8~9마디)");
  assert.deepEqual(h.read("plays[0].range"), { from:9, to:10 });
});

test("다른 악기로 바꾸면 첫 오선으로 초기화하고 선택한 악기만 재생한다", () => {
  const h = loadPlayback();
  h.run(`
    selectPlaybackLine(2);
    const guitar = musicAddPart(sheet, { name:"기타", timbre:"guitar" });
    sheet.measures = Array.from({ length:10 }, () => musicMeasure([musicNote("E", 4)]));
    syncPlaybackLineControls(true);
  `);
  assert.equal(h.run("playbackLineSelect.value"), "0");
  h.run("selectPlaybackLine(1); startSelectedPart(); const timeline = musicTimeline(sheet, { ...plays[0].range, ...plays[0].options })");
  assert.equal(h.run("plays[0].options.partId === guitar.id"), true);
  assert.ok(h.run("timeline.events.length > 0"));
  assert.equal(h.run("timeline.events.every(event => event.partId === guitar.id && event.measure >= 5 && event.measure <= 8)"), true);
});

test("도돌이표가 있어도 선택 오선 바깥으로 재생 범위가 넘어가지 않는다", () => {
  const h = loadPlayback();
  h.run(`
    sheet.measures[0].repeatStart = true;
    sheet.measures[9].repeatEnd = true;
    selectPlaybackLine(2); startSelectedPart();
    const timeline = musicTimeline(sheet, { ...plays[0].range, ...plays[0].options });
  `);
  assert.deepEqual(h.read("timeline.measureOrder"), [9, 10, 9, 10]);
});

test("재생·따라치기·음감 테스트 중에는 선택 재생 버튼과 목록을 잠근다", () => {
  const h = loadPlayback();
  for (const [start, stop] of [["flags.add('is-running')", "flags.clear()"],
    ["practice.active = true", "practice.active = false"], ["earActive = true", "earActive = false"]]){
    h.run(`${start}; syncPlaybackLineControls()`);
    assert.equal(h.run("playSelectedPartBtn.disabled && playbackLineSelect.disabled"), true);
    h.run(`${stop}; syncPlaybackLineControls()`);
    assert.equal(h.run("playSelectedPartBtn.disabled || playbackLineSelect.disabled"), false);
  }
});

test("그릴 오선이 없으면 전체 재생으로 대체하지 않는다", () => {
  const h = loadPlayback();
  h.run("scoreLines = []; syncPlaybackLineControls(true); startSelectedPart()");
  assert.equal(h.run("playSelectedPartBtn.disabled && playbackLineSelect.disabled"), true);
  assert.equal(h.run("plays.length"), 0);
});
