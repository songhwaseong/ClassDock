"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMusic(){
  const context = { console, Math, JSON, Date, Number, Array, Object, String, Error };
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/music-model.js"), "utf8");
  vm.runInContext(source + `
    ;globalThis.__music = {
      musicEmpty, musicNote, musicRest, musicMeasure, musicParse, musicSerialize,
      musicNoteTicks, musicMeasureTicks, musicMeasureUsedTicks, musicValidate, musicCanFit,
      musicMidiNumber, musicFrequency, musicNoteFrequency, musicNoteName,
      musicVexNote, musicTimeline, MUSIC_TICKS_PER_QUARTER,
      musicDiatonicValue, musicPitchFromDiatonic, musicPitchFromStaveLine,
      musicStaveLineForNote, musicShiftPitch, musicMidiInRange,
      musicRetuneForKey, musicPackLines, musicBarWidthHint
    };`, context);
  return context.__music;
}

// 학교종 앞 4마디(4/4, 다장조) — 재생·저장 검증에 계속 쓰는 표본이다.
function schoolBell(api){
  const sheet = api.musicEmpty("학교종");
  sheet.tempo = 100;
  sheet.measures = [
    api.musicMeasure([
      api.musicNote("G", 4), api.musicNote("G", 4), api.musicNote("A", 4), api.musicNote("A", 4)
    ]),
    api.musicMeasure([
      api.musicNote("G", 4), api.musicNote("G", 4), api.musicNote("E", 4, { value:"half" })
    ]),
    api.musicMeasure([
      api.musicNote("G", 4), api.musicNote("G", 4), api.musicNote("E", 4), api.musicNote("E", 4)
    ]),
    api.musicMeasure([
      api.musicNote("D", 4, { value:"half" }), api.musicRest("half")
    ])
  ];
  return sheet;
}

test(".msheet는 같은 모델을 항상 같은 JSON으로 직렬화하고 그대로 다시 읽는다", () => {
  const api = loadMusic();
  const sheet = schoolBell(api);
  sheet.createdAt = 100;
  sheet.updatedAt = 200;
  const first = api.musicSerialize(sheet);
  assert.equal(first, api.musicSerialize(sheet));

  const reopened = api.musicParse(first);
  assert.equal(reopened.title, "학교종");
  assert.equal(reopened.updatedAt, 200);
  assert.equal(reopened.measures.length, 4);
  assert.equal(reopened.measures[3].notes[1].rest, true);
  // 다시 저장해도 바이트가 같아야 한다(불필요한 파일 변경·diff 방지).
  assert.equal(api.musicSerialize(reopened), first);
});

test("새 악보와 v1 기본 삼각파 악보는 실제 피아노 음색을 기본으로 쓴다", () => {
  const api = loadMusic();
  assert.equal(api.musicEmpty("피아노").timbre, "piano");
  const legacy = JSON.parse(api.musicSerialize(api.musicEmpty("옛 악보")));
  legacy.version = 1;
  legacy.timbre = "triangle";
  assert.equal(api.musicParse(JSON.stringify(legacy)).timbre, "piano");
  legacy.timbre = "sine"; // 사용자가 일부러 고른 다른 합성음은 보존한다.
  assert.equal(api.musicParse(JSON.stringify(legacy)).timbre, "sine");
});

test("계이름 노출 여부는 새 악보에서 켜지고 .msheet에 저장·복원된다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("계이름 학습");
  assert.equal(sheet.showSolfege, true);
  sheet.showSolfege = false;
  const saved = api.musicSerialize(sheet);
  assert.match(saved, /"showSolfege": false/);
  assert.equal(api.musicParse(saved).showSolfege, false);
  const legacy = JSON.parse(saved);
  delete legacy.showSolfege;
  assert.equal(api.musicParse(JSON.stringify(legacy)).showSolfege, true);
});

test("수동 오선 줄바꿈은 .msheet에 저장되고 다시 열어도 유지된다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("두 단 악보");
  sheet.measures[2].lineBreakBefore = true;
  const saved = api.musicSerialize(sheet);
  assert.match(saved, /"lineBreakBefore": true/);
  const reopened = api.musicParse(saved);
  assert.equal(reopened.measures[2].lineBreakBefore, true);
  assert.equal(reopened.measures[0].lineBreakBefore, false);
  assert.equal(api.musicSerialize(reopened), saved);
});

test("서명·버전·음표 종류가 맞지 않으면 편집 모델로 열지 않는다", () => {
  const api = loadMusic();
  assert.throws(() => api.musicParse("{}"), /악보 파일이 아닙니다/);
  assert.throws(() => api.musicParse("깨진 내용"), /읽지 못했습니다/);
  assert.throws(() => api.musicParse(JSON.stringify({ format:"manneung-sheet", version:99 })), /지원하지 않는 악보 버전/);
  assert.throws(() => api.musicParse(JSON.stringify({
    format:"manneung-sheet", version:1,
    measures:[{ notes:[{ step:"C", octave:4, value:"32nd" }] }]
  })), /지원하지 않는 음표 길이/);
  assert.throws(() => api.musicParse(JSON.stringify({
    format:"manneung-sheet", version:1,
    measures:[{ notes:[{ step:"H", octave:4, value:"quarter" }] }]
  })), /지원하지 않는 음이름/);
});

test("점음표와 마디 길이는 정수 틱으로 떨어진다", () => {
  const api = loadMusic();
  assert.equal(api.MUSIC_TICKS_PER_QUARTER, 480);
  assert.equal(api.musicNoteTicks({ value:"quarter", dots:0 }), 480);
  assert.equal(api.musicNoteTicks({ value:"quarter", dots:1 }), 720);
  assert.equal(api.musicNoteTicks({ value:"quarter", dots:2 }), 840);
  assert.equal(api.musicNoteTicks({ value:"16th", dots:2 }), 210);
  assert.equal(api.musicNoteTicks({ value:"whole", dots:0 }), 1920);

  assert.equal(api.musicMeasureTicks({ beats:4, beatValue:4 }), 1920);
  assert.equal(api.musicMeasureTicks({ beats:3, beatValue:4 }), 1440);
  assert.equal(api.musicMeasureTicks({ beats:6, beatValue:8 }), 1440);
  assert.equal(api.musicMeasureTicks({ beats:2, beatValue:4 }), 960);
});

test("음높이는 MIDI 번호를 거쳐 주파수가 된다", () => {
  const api = loadMusic();
  assert.equal(api.musicMidiNumber(api.musicNote("A", 4)), 69);
  assert.equal(api.musicMidiNumber(api.musicNote("C", 4)), 60);
  assert.equal(api.musicMidiNumber(api.musicNote("F", 4, { alter:1 })), 66);
  assert.equal(api.musicMidiNumber(api.musicNote("B", 4, { alter:-1 })), 70);
  assert.equal(api.musicMidiNumber(api.musicRest("quarter")), null);

  assert.equal(Math.round(api.musicFrequency(69)), 440);
  assert.equal(Math.round(api.musicFrequency(60) * 100) / 100, 261.63);
  assert.equal(Math.round(api.musicNoteFrequency(api.musicNote("G", 4))), 392);
  assert.equal(api.musicNoteFrequency(api.musicRest("quarter")), 0);
  assert.equal(api.musicNoteName(api.musicNote("F", 4, { alter:1 })), "F#4");
});

test("임시표는 조표와 다를 때만 그린다", () => {
  const api = loadMusic();
  const fSharp = api.musicNote("F", 4, { alter:1 });
  const fNatural = api.musicNote("F", 4);

  // 사장조는 F#이 기본이므로 임시표를 그리지 않고, F♮이면 ♮을 붙인다.
  assert.equal(api.musicVexNote(fSharp, "G").accidental, null);
  assert.equal(api.musicVexNote(fNatural, "G").accidental, "n");
  // 다장조에서는 반대다.
  assert.equal(api.musicVexNote(fSharp, "C").accidental, "#");
  assert.equal(api.musicVexNote(fNatural, "C").accidental, null);

  assert.equal(api.musicVexNote(fSharp, "C").keys.join(","), "f#/4");
  assert.equal(api.musicVexNote(api.musicNote("G", 4, { value:"eighth" }), "C").duration, "8");
  const rest = api.musicVexNote(api.musicRest("half"), "C");
  assert.equal(rest.duration, "hr");
  assert.equal(rest.rest, true);
  assert.equal(rest.keys.join(","), "b/4");
});

test("마디 채움 검사는 넘침과 덜 참을 가려낸다", () => {
  const api = loadMusic();
  const sheet = schoolBell(api);
  assert.equal(api.musicValidate(sheet).ok, true);

  // 빈 마디는 '작성 전'이라 문제 삼지 않는다.
  sheet.measures.push(api.musicMeasure());
  assert.equal(api.musicValidate(sheet).ok, true);

  // 중간 마디가 덜 차면 잡아낸다.
  sheet.measures[1].notes.pop();
  const under = api.musicValidate(sheet);
  assert.equal(under.ok, false);
  assert.equal(under.issues[0].measure, 2);
  assert.equal(under.issues[0].kind, "under");

  // 넘치는 마디도 잡아낸다.
  const over = schoolBell(api);
  over.measures[0].notes.push(api.musicNote("G", 4));
  const overResult = api.musicValidate(over);
  assert.equal(overResult.issues[0].kind, "over");
  assert.equal(overResult.issues[0].actual, 2400);

  // 마지막 마디의 덜 참은 허용한다(끝마디는 짧을 수 있다).
  const tail = schoolBell(api);
  tail.measures[3].notes.pop();
  assert.equal(api.musicValidate(tail).ok, true);

  assert.equal(api.musicCanFit(sheet, 0, api.musicNote("G", 4)), false);
  assert.equal(api.musicCanFit(sheet, 1, api.musicNote("G", 4)), true);
});

test("타임라인은 마디를 초로 펼치고, 부분 재생은 0초부터 다시 센다", () => {
  const api = loadMusic();
  const sheet = schoolBell(api);   // ♩=100 → 4분음표 0.6초, 한 마디 2.4초

  const all = api.musicTimeline(sheet);
  assert.equal(all.tempo, 100);
  assert.equal(round3(all.totalSeconds), 9.6);
  assert.equal(all.events.length, 13);
  assert.equal(round3(all.events[0].start), 0);
  assert.equal(round3(all.events[0].duration), 0.6);
  assert.equal(Math.round(all.events[0].frequency), 392);          // G4
  assert.equal(round3(all.events[4].start), 2.4);                  // 2마디 첫 음
  assert.equal(round3(all.events[6].duration), 1.2);               // 2분음표
  assert.equal(all.events[12].rest, true);                         // 마지막은 쉼표
  assert.equal(all.events[12].frequency, 0);

  // 부분 재생(3~4마디): 시작이 0초로 당겨지고 마디 번호는 원래대로 남는다.
  const part = api.musicTimeline(sheet, { from:3, to:4 });
  assert.equal(round3(part.totalSeconds), 4.8);
  assert.equal(round3(part.events[0].start), 0);
  assert.equal(part.events[0].measure, 3);
  assert.equal(part.events[part.events.length - 1].measure, 4);

  // 빠르기를 두 배로 하면 전체 길이는 절반이 된다.
  sheet.tempo = 200;
  assert.equal(round3(api.musicTimeline(sheet).totalSeconds), 4.8);
});

test("덜 찬 마디도 마디 길이만큼 시간이 흐른다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("빈 마디");
  sheet.tempo = 100;
  sheet.measures = [
    api.musicMeasure([api.musicNote("C", 4)]),   // 4분음표 하나뿐(1/4만 참)
    api.musicMeasure([api.musicNote("D", 4)])
  ];
  const timeline = api.musicTimeline(sheet);
  // 두 번째 마디는 0.6초가 아니라 2.4초(한 마디)에서 시작해야 박자가 맞는다.
  assert.equal(round3(timeline.events[1].start), 2.4);
  assert.equal(round3(timeline.totalSeconds), 4.8);
});

test("오선 자리와 음높이는 서로 정확히 옮겨진다", () => {
  const api = loadMusic();
  // 높은음자리표: 맨 윗줄(0)=F5, 한 칸 아래(0.5)=E5 … 맨 아랫줄(4)=E4.
  const cases = [[0, "F", 5], [0.5, "E", 5], [1, "D", 5], [2, "B", 4], [3, "G", 4], [4, "E", 4], [5, "C", 4]];
  for (const [line, step, octave] of cases){
    const pitch = api.musicPitchFromStaveLine(line);
    assert.equal(pitch.step + pitch.octave, step + octave, `줄 ${line}`);
    assert.equal(api.musicStaveLineForNote(pitch), line, `${step}${octave} 의 줄 값`);
  }
  // 오선 위(덧줄)도 같은 규칙으로 이어진다.
  assert.equal(api.musicPitchFromStaveLine(-1).step + api.musicPitchFromStaveLine(-1).octave, "A5");
  assert.equal(api.musicDiatonicValue(api.musicNote("C", 4)), 28);
  assert.equal(api.musicPitchFromDiatonic(28).step, "C");
});

test("↑↓ 이동은 흰건반 한 음씩 가고 음역 밖에서 멈춘다", () => {
  const api = loadMusic();
  const g4 = api.musicNote("G", 4);
  assert.equal(api.musicShiftPitch(g4, 1).step, "A");
  assert.equal(api.musicShiftPitch(g4, -1).step, "F");
  const up = api.musicShiftPitch(g4, 7);          // 한 옥타브 위
  assert.equal(up.step + up.octave, "G5");

  // 임시표는 그대로 들고 간다(F# 을 올리면 G#).
  const fSharp = api.musicNote("F", 4, { alter:1 });
  assert.equal(api.musicShiftPitch(fSharp, 1).step, "G");

  // 음역(G3~C6) 밖으로는 나가지 않는다.
  assert.equal(api.musicShiftPitch(api.musicNote("C", 6), 1), null);
  assert.equal(api.musicShiftPitch(api.musicNote("G", 3), -1), null);
  assert.equal(api.musicMidiInRange(60), true);
  assert.equal(api.musicMidiInRange(20), false);
});

test("조표를 바꾸면 임시표 없던 음만 새 조표를 따라간다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("조표 바꾸기");
  sheet.measures = [api.musicMeasure([
    api.musicNote("F", 4),                 // 다장조에서 임시표 없음 → 사장조에서 F#
    api.musicNote("F", 4, { alter:-1 }),   // 일부러 적은 내림표 → 그대로
    api.musicNote("G", 4),                 // 사장조에서도 그대로
    api.musicRest("quarter")
  ])];

  const changed = api.musicRetuneForKey(sheet, "G");
  assert.equal(sheet.key, "G");
  assert.equal(changed, 1);
  const notes = sheet.measures[0].notes;
  assert.equal(notes[0].alter, 1);         // F → F#(소리도 함께 바뀐다)
  assert.equal(notes[1].alter, -1);        // 손대지 않는다
  assert.equal(notes[2].alter, 0);
  // 사장조 F#은 임시표를 그리지 않고, 되돌리면 다시 F♮ 이 된다.
  assert.equal(api.musicVexNote(notes[0], "G").accidental, null);
  api.musicRetuneForKey(sheet, "C");
  assert.equal(notes[0].alter, 0);
  assert.equal(notes[1].alter, -1);
});

test("줄 나누기는 화면 폭과 마디의 음표 수에 따라 마디를 나눈다", () => {
  const api = loadMusic();
  const busy = api.musicMeasure(Array.from({ length:8 }, () => api.musicNote("C", 4, { value:"eighth" })));
  const light = api.musicMeasure([api.musicNote("C", 4, { value:"whole" })]);

  // 빽빽한 마디는 넓은 폭을 요구한다.
  assert.ok(api.musicBarWidthHint(busy) > api.musicBarWidthHint(light));

  // 좁은 화면에서는 한 줄에 적게, 넓은 화면에서는 많이 들어간다.
  const measures = Array.from({ length:8 }, () => light);
  const narrow = api.musicPackLines(measures, 400);
  const wide = api.musicPackLines(measures, 1400);
  assert.ok(narrow.length > wide.length, "좁을수록 줄이 늘어야 한다");
  assert.ok(wide[0].indexes.length > narrow[0].indexes.length);

  // 모든 마디가 빠짐없이 한 번씩 들어간다.
  const flat = narrow.flatMap((line) => line.indexes);
  assert.equal(flat.length, measures.length);
  assert.equal(flat.join(","), measures.map((_, index) => index).join(","));

  // 줄마다 폭이 마디 수와 맞고, 첫 마디는 음자리표·조표 자리만큼 넓다.
  for (const line of wide){
    assert.equal(line.widths.length, line.indexes.length);
    if (line.indexes.length > 1) assert.ok(line.widths[0] > line.widths[1]);
  }

  // 아주 좁아도 한 줄에 최소 한 마디는 놓는다(무한 루프·빈 줄 방지).
  const tiny = api.musicPackLines(measures, 10);
  assert.ok(tiny.every((line) => line.indexes.length >= 1));
  assert.equal(tiny.flatMap((line) => line.indexes).length, measures.length);

  // 폭이 충분해도 수동 줄바꿈 마디는 새 오선의 첫 마디가 된다.
  const manual = Array.from({ length:4 }, () => api.musicMeasure([api.musicNote("C", 4, { value:"whole" })]));
  manual[2].lineBreakBefore = true;
  const forced = api.musicPackLines(manual, 1400);
  assert.equal(forced.length, 2);
  assert.equal(forced[0].indexes.join(","), "0,1");
  assert.equal(forced[1].indexes.join(","), "2,3");
});

function round3(value){
  return Math.round(value * 1000) / 1000;
}
