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
      musicEmpty, musicExampleSheet, musicNote, musicRest, musicMeasure, musicParse, musicSerialize,
      musicNoteTicks, musicMeasureTicks, musicMeasureUsedTicks, musicValidate, musicCanFit, musicMeasureProgress,
      musicMidiNumber, musicFrequency, musicNoteFrequency, musicNoteName,
      musicVexNote, musicTimeline, MUSIC_TICKS_PER_QUARTER,
      musicDiatonicValue, musicPitchFromDiatonic, musicPitchFromStaveLine,
      musicStaveLineForNote, musicShiftPitch, musicMidiInRange,
      musicNotePitches, musicAddChordPitch, musicRemoveChordPitch, musicPitchKey, musicStaffNotes,
      musicVoiceNotes, musicEffectiveMeasureSettings, musicMeasureCapacity, musicPlaybackMeasureIndexes,
      musicRetuneForKey, musicPackLines, musicBarWidthHint,
      musicTransposeSheet, musicTransposedKey, musicTransposeSteps, musicTransposePitch, musicPitchFromMidi,
      musicClampXOffset, MUSIC_X_OFFSET_MAX, MUSIC_KEYS,
      musicPracticeSteps, musicPitchClass, MUSIC_PC_LABELS,
      MUSIC_EAR_LEVELS, MUSIC_EAR_COUNTS, musicEarLevel, musicEarPool, musicEarOctaves,
      musicEarQuestions, musicEarJudge, musicEarSummary, musicEarDistractor, MUSIC_EAR_REFERENCE_MIDI
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

test("두 성부와 표현 기호는 저장 후에도 독립적으로 유지된다", () => {
  const api = loadMusic();
  const first = api.musicNote("C", 4, { slurToNext:true, lyric:"봄", dynamic:"mf",
    articulation:"staccato", fingering:1, pedal:"start", tuplet:3 });
  const secondVoice = api.musicNote("E", 4, { value:"half" });
  const sheet = api.musicEmpty("두 성부");
  sheet.measures = [api.musicMeasure([first], { voice2Notes:[secondVoice], repeatStart:true,
    repeatEnd:true, ending:1 })];
  const reopened = api.musicParse(api.musicSerialize(sheet));
  assert.equal(reopened.measures[0].notes[0].lyric, "봄");
  assert.equal(reopened.measures[0].notes[0].dynamic, "mf");
  assert.equal(reopened.measures[0].notes[0].articulation, "staccato");
  assert.equal(reopened.measures[0].notes[0].tuplet, 3);
  assert.equal(reopened.measures[0].voice2Notes[0].step, "E");
  assert.equal(reopened.measures[0].ending, 1);
  assert.equal(api.musicNoteTicks(reopened.measures[0].notes[0]), 320);
});

test("반복선과 1·2번 괄호는 재생 순서를 만든다", () => {
  const api = loadMusic();
  const measures = [
    api.musicMeasure([], { repeatStart:true }),
    api.musicMeasure([], { repeatEnd:true, ending:1 }),
    api.musicMeasure([], { ending:2 })
  ];
  assert.deepEqual(Array.from(api.musicPlaybackMeasureIndexes(measures, 0, 2, true)), [0, 1, 0, 2]);
});

test("못갖춘마디와 중간 박자·조표·빠르기 변경은 마디별로 계산된다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("변경");
  sheet.measures = [
    api.musicMeasure([api.musicNote("C", 4)], { pickupTicks:480 }),
    api.musicMeasure([api.musicNote("D", 4)], { timeChange:{ beats:3, beatValue:4 }, keyChange:"G", tempoChange:60 })
  ];
  assert.equal(api.musicMeasureCapacity(sheet, 0), 480);
  assert.equal(api.musicMeasureCapacity(sheet, 1), 1440);
  assert.equal(api.musicEffectiveMeasureSettings(sheet, 1).key, "G");
  assert.equal(api.musicTimeline(sheet).totalSeconds, 3.6);
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
  legacy.version = 2;
  legacy.timbre = "guitar";
  assert.equal(api.musicParse(JSON.stringify(legacy)).timbre, "guitar");
  for (const timbre of ["xylophone", "harp", "flute", "clarinet"]){
    legacy.timbre = timbre;
    assert.equal(api.musicParse(JSON.stringify(legacy)).timbre, timbre);
  }
});

test("학생용 예제 악보는 완성된 4마디와 안정된 제목·빠르기를 제공한다", () => {
  const api = loadMusic();
  const school = api.musicExampleSheet("school-bell");
  const twinkle = api.musicExampleSheet("twinkle");
  assert.equal(school.title, "학교종");
  assert.equal(school.measures.length, 4);
  assert.equal(school.tempo, 100);
  assert.equal(twinkle.title, "작은별");
  assert.equal(twinkle.measures.length, 4);
  assert.equal(twinkle.tempo, 90);
  assert.equal(api.musicValidate(school).ok, true);
  assert.equal(api.musicValidate(twinkle).ok, true);
  assert.equal(api.musicExampleSheet("unknown"), null);
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

test("음표 좌우 미세 조정값은 안전한 범위로 제한되어 .msheet에 저장된다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("위치 조정");
  sheet.measures[0].notes = [
    api.musicNote("C", 4, { xOffset:18 }),
    api.musicRest("quarter", 0, { xOffset:-12 }),
    api.musicNote("E", 4, { xOffset:999 })
  ];
  const saved = api.musicSerialize(sheet);
  const reopened = api.musicParse(saved);
  assert.equal(reopened.measures[0].notes[0].xOffset, 18);
  assert.equal(reopened.measures[0].notes[1].xOffset, -12);
  assert.equal(reopened.measures[0].notes[2].xOffset, api.MUSIC_X_OFFSET_MAX);
  assert.equal(api.musicClampXOffset(-999), -api.MUSIC_X_OFFSET_MAX);
  reopened.measures[0].notes[0].xOffset = 0;
  assert.doesNotMatch(api.musicSerialize(reopened), /"xOffset": 0/);
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
  assert.throws(() => api.musicParse(JSON.stringify({ format:"classdock-sheet", version:99 })), /지원하지 않는 악보 버전/);
  assert.throws(() => api.musicParse(JSON.stringify({
    format:"classdock-sheet", version:1,
    measures:[{ notes:[{ step:"C", octave:4, value:"32nd" }] }]
  })), /지원하지 않는 음표 길이/);
  assert.throws(() => api.musicParse(JSON.stringify({
    format:"classdock-sheet", version:1,
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

test("화음과 피아노 대보표는 저장·조판·재생에서 동시에 유지된다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("피아노 화음");
  sheet.grandStaff = true;
  const chord = api.musicNote("C", 4, { value:"half", chordSymbol:"Cm7", tieToNext:true,
    chord:[{ step:"E", octave:4, alter:-1 }, { step:"G", octave:4, alter:0 }] });
  sheet.measures = [api.musicMeasure([
    chord, api.musicNote("C", 4, { value:"half", chord:[{ step:"E", octave:4, alter:-1 }, { step:"G", octave:4, alter:0 }] })
  ], { bassNotes:[api.musicNote("C", 3, { value:"whole" })] })];

  const vex = api.musicVexNote(chord, "Cm", "treble");
  assert.equal(vex.keys.join(","), "c/4,eb/4,g/4");
  assert.equal(vex.accidentals.filter(Boolean).length, 0);
  assert.equal(api.musicMeasureUsedTicks(sheet.measures[0], "bass"), 1920);
  assert.equal(api.musicValidate(sheet).ok, true);

  const timeline = api.musicTimeline(sheet);
  assert.equal(timeline.events.filter((event) => event.staff === "treble").length, 3,
    "붙임줄로 이어진 세 화음음은 각각 한 이벤트여야 한다");
  assert.equal(timeline.events.filter((event) => event.staff === "bass").length, 1);
  assert.ok(timeline.events.filter((event) => event.staff === "treble").every((event) => round3(event.duration) === 2.4));
  assert.ok(api.musicTimeline(sheet, { staff:"treble" }).events.every((event) => event.staff === "treble"));
  assert.ok(api.musicTimeline(sheet, { staff:"bass" }).events.every((event) => event.staff === "bass"));

  const reopened = api.musicParse(api.musicSerialize(sheet));
  assert.equal(reopened.grandStaff, true);
  assert.equal(reopened.measures[0].bassNotes[0].step, "C");
  assert.equal(reopened.measures[0].notes[0].chord.length, 2);
  assert.equal(reopened.measures[0].notes[0].tieToNext, true);
  assert.equal(reopened.measures[0].notes[0].chordSymbol, "Cm7");
});

test("장·단조 조표는 임시표 일곱 개 범위와 낮은음자리표 입력을 지원한다", () => {
  const api = loadMusic();
  assert.equal(Object.keys(api.MUSIC_KEYS).length, 30);
  assert.equal(api.MUSIC_KEYS.Eb.fifths, -3);
  assert.equal(api.MUSIC_KEYS.Cm.fifths, -3);
  assert.equal(api.MUSIC_KEYS["C#"].fifths, 7);
  assert.equal(api.musicPitchFromStaveLine(0, "bass").step + api.musicPitchFromStaveLine(0, "bass").octave, "A3");
  assert.equal(api.musicStaveLineForNote(api.musicNote("F", 2), "bass"), 4.5);
  assert.equal(api.musicMidiInRange(36, "bass"), true);
  assert.equal(api.musicMidiInRange(35, "bass"), false);
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

test("마디 진행 상태는 사용·남은·초과 박자를 학생용 값으로 계산한다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("박자 안내");
  sheet.measures = [api.musicMeasure([api.musicNote("C", 4), api.musicNote("D", 4)])];
  let progress = api.musicMeasureProgress(sheet, 0);
  assert.equal(progress.usedBeats, 2);
  assert.equal(progress.expectedBeats, 4);
  assert.equal(progress.remainingBeats, 2);
  assert.equal(progress.complete, false);
  sheet.measures[0].notes.push(api.musicNote("E", 4, { value:"half" }));
  progress = api.musicMeasureProgress(sheet, 0);
  assert.equal(progress.complete, true);
  assert.equal(progress.remainingBeats, 0);
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

test("연습 재생 속도는 음높이는 그대로 두고 시간만 늘이거나 줄인다", () => {
  const api = loadMusic();
  const sheet = schoolBell(api);
  const normal = api.musicTimeline(sheet);
  const slow = api.musicTimeline(sheet, { playbackRate:0.5 });
  const quick = api.musicTimeline(sheet, { playbackRate:0.75 });
  assert.equal(slow.playbackRate, 0.5);
  assert.equal(slow.totalSeconds, normal.totalSeconds * 2);
  assert.ok(Math.abs(quick.totalSeconds - normal.totalSeconds / 0.75) < 1e-9);
  assert.equal(slow.events[0].frequency, normal.events[0].frequency);
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

test("조옮김은 음표와 조표를 함께 옮긴다", () => {
  const api = loadMusic();
  const sheet = schoolBell(api);            // 다장조 학교종

  const result = api.musicTransposeSheet(sheet, 2);
  assert.equal(result.semitones, 2);
  assert.equal(sheet.key, "D");             // 다장조 + 온음 = 라장조
  assert.equal(result.previousKey, "C");
  assert.equal(result.blocked, 0);

  // 솔라솔라 → 라시라시. 멜로디 모양(음 사이 간격)이 그대로여야 한다.
  const first = sheet.measures[0].notes;
  assert.deepEqual(first.map((note) => note.step + note.octave), ["A4", "A4", "B4", "B4"]);
  // 라장조는 F#·C# — 3마디의 미(E4)는 파샵(F#4)이 되고 임시표는 그리지 않는다.
  const third = sheet.measures[2].notes;
  assert.equal(third[2].step, "F");
  assert.equal(third[2].alter, 1);
  assert.equal(api.musicVexNote(third[2], sheet.key).accidental, null);
  assert.equal(result.changed, first.length + 3 + 4 + 1);   // 쉼표는 세지 않는다
});

test("조옮김은 임시표가 적은 조표를 고르고 음도 같은 방식으로 적는다", () => {
  const api = loadMusic();

  // 다장조에서 반음 올리면 올림다장조(♯7)가 아니라 내림라장조(♭5)로 적는다.
  assert.equal(api.musicTransposedKey("C", 1), "Db");
  assert.equal(api.musicTransposedKey("C", -1), "B");
  assert.equal(api.musicTransposedKey("C", 12), "C");       // 옥타브는 조표를 바꾸지 않는다
  assert.equal(api.musicTransposedKey("Am", 2), "Bm");      // 단조는 단조로 남는다

  const sheet = api.musicEmpty("적는 법");
  sheet.measures = [api.musicMeasure([api.musicNote("C", 4), api.musicNote("E", 4)])];
  api.musicTransposeSheet(sheet, 1);
  const notes = sheet.measures[0].notes;
  assert.equal(sheet.key, "Db");
  assert.deepEqual(notes.map((note) => [note.step, note.alter]), [["D", -1], ["F", 0]]);
  // 소리는 정확히 반음 위여야 한다(적는 법이 달라도 울리는 음은 하나뿐이다).
  assert.equal(api.musicMidiNumber(notes[0]), 61);
  assert.equal(api.musicMidiNumber(notes[1]), 65);
});

test("조옮김은 화음·성부·왼손·중간 조표를 빠짐없이 옮긴다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("빠짐없이");
  sheet.grandStaff = true;
  const chord = api.musicNote("C", 4, { chord:[{ step:"E", octave:4 }, { step:"G", octave:4 }] });
  sheet.measures = [
    api.musicMeasure([chord], {
      voice2Notes:[api.musicNote("E", 5)],
      bassNotes:[api.musicNote("C", 3)],
      bassVoice2Notes:[api.musicNote("G", 2)]
    }),
    api.musicMeasure([api.musicNote("D", 4)], { keyChange:"F" })
  ];

  api.musicTransposeSheet(sheet, 2);
  assert.equal(sheet.key, "D");
  const moved = sheet.measures[0];
  assert.equal(api.musicNotePitches(moved.notes[0]).map((pitch) => pitch.step + pitch.octave).join(" "),
    "D4 F4 A4");
  assert.equal(api.musicNotePitches(moved.notes[0])[1].alter, 1);   // 미 → 파샵
  assert.equal(moved.voice2Notes[0].step + moved.voice2Notes[0].octave, "F5");
  assert.equal(moved.bassNotes[0].step + moved.bassNotes[0].octave, "D3");
  assert.equal(moved.bassVoice2Notes[0].step + moved.bassVoice2Notes[0].octave, "A2");
  // 중간에 바뀌는 조표도 같은 간격으로 따라간다(바장조 + 온음 = 사장조).
  assert.equal(sheet.measures[1].keyChange, "G");
  assert.equal(api.musicEffectiveMeasureSettings(sheet, 1).key, "G");
});

test("조옮김 미리보기는 악보를 바꾸지 않고 음역 밖 음을 세어 준다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("미리보기");
  sheet.measures = [api.musicMeasure([api.musicNote("A", 5), api.musicNote("G", 4)])];
  const before = api.musicSerialize(sheet);

  const preview = api.musicTransposeSheet(sheet, 5, { apply:false });
  assert.equal(api.musicSerialize(sheet), before, "미리보기는 악보를 건드리지 않는다");
  assert.equal(preview.changed, 2);
  assert.equal(preview.outOfRange, 1);            // A5 + 완전4도 = D6 → 권장 음역(C6) 밖
  assert.equal(preview.key, "F");

  // 저장할 수 없는 옥타브로 밀려나는 악보는 하나라도 있으면 통째로 옮기지 않는다.
  // (0옥타브는 우리 편집기로는 넣을 수 없고 MusicXML 로 들어올 수 있어 opts 로 만든다.)
  const extreme = api.musicEmpty("맨 아래");
  extreme.measures = [api.musicMeasure([api.musicNote("C", 4, { octave:0 })])];
  const blockedText = api.musicSerialize(extreme);
  const blocked = api.musicTransposeSheet(extreme, -12);
  assert.ok(blocked.blocked > 0);
  assert.equal(api.musicSerialize(extreme), blockedText);

  // 옮길 수 없는 간격은 아무 일도 하지 않는다.
  assert.equal(api.musicTransposeSheet(sheet, 0).changed, 0);
  assert.equal(api.musicTransposeSheet(sheet, 13).changed, 0);
  assert.equal(api.musicSerialize(sheet), before);
});

test("MIDI 번호는 조표 방향에 맞는 이름으로 적는다", () => {
  const api = loadMusic();
  const spell = (midi, flats) => {
    const pitch = api.musicPitchFromMidi(midi, flats);
    return `${pitch.step}${pitch.alter > 0 ? "#" : pitch.alter < 0 ? "b" : ""}${pitch.octave}`;
  };
  assert.equal(spell(61, false), "C#4");
  assert.equal(spell(61, true), "Db4");
  assert.equal(spell(60, false), "C4");
  // 어느 쪽으로 적어도 울리는 음은 같다.
  for (const midi of [55, 60, 66, 70, 84]){
    assert.equal(api.musicMidiNumber(api.musicPitchFromMidi(midi, true)), midi);
    assert.equal(api.musicMidiNumber(api.musicPitchFromMidi(midi, false)), midi);
  }
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

/* ===== 따라치기(음 맞추기) 순서 ===== */

test("따라치기 순서는 음표 하나를 한 차례로 잘라 준다", () => {
  const api = loadMusic();
  const sheet = schoolBell(api);
  const built = api.musicPracticeSteps(sheet);
  // 학교종 앞 4마디 = 음표 12개(4·3·4·1) + 마지막 마디의 2분쉼표 한 자리.
  assert.equal(built.total, 12);
  assert.equal(built.steps.length, 13);
  assert.equal(built.steps[12].auto, true);
  assert.equal(built.steps[0].measure, 1);
  assert.equal(built.steps[0].noteIds.length, 1);
  // 차례는 악보에 적힌 시간 순서 그대로다.
  for (let index = 1; index < built.steps.length; index++){
    assert.ok(built.steps[index].start > built.steps[index - 1].start);
    assert.equal(built.steps[index].index, index);
  }
});

test("옥타브를 뺀 음이름(pcs)으로 채점한다 — 같은 도는 몇 옥타브든 같은 값", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("옥타브");
  sheet.measures = [api.musicMeasure([
    api.musicNote("C", 4), api.musicNote("C", 5), api.musicNote("F", 4, { alter:1 }), api.musicNote("G", 4)
  ])];
  const steps = api.musicPracticeSteps(sheet).steps;
  assert.deepEqual(Array.from(steps[0].pcs), [0]);            // 도4
  assert.deepEqual(Array.from(steps[1].pcs), [0]);            // 도5 — 옥타브가 달라도 같은 음이름
  assert.notEqual(steps[0].midis[0], steps[1].midis[0]);   // 들려줄 높이는 실제 옥타브 그대로다
  assert.deepEqual(Array.from(steps[2].pcs), [6]);            // 파♯
  assert.deepEqual(Array.from(steps[3].pcs), [7]);            // 솔
  assert.equal(api.musicPitchClass(60), 0);
  assert.equal(api.musicPitchClass(72), 0);
  assert.equal(api.musicPitchClass(71), 11);
});

test("쉼표 자리는 auto 로 남겨 그냥 지나가고, 채점 수에 넣지 않는다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("쉼표");
  sheet.measures = [api.musicMeasure([
    api.musicNote("C", 4), api.musicRest("quarter"), api.musicNote("E", 4), api.musicRest("quarter")
  ])];
  const built = api.musicPracticeSteps(sheet);
  assert.equal(built.steps.length, 4);
  assert.equal(built.total, 2);                   // 눌러야 할 차례는 음표 둘뿐
  assert.deepEqual(Array.from(built.steps.map((step) => step.auto)), [false, true, false, true]);
  assert.deepEqual(Array.from(built.steps[1].pcs), []);
  // 쉼표에도 음표 id 는 달려 있어야 화면에서 함께 흘러간 것으로 칠할 수 있다.
  assert.equal(built.steps[1].noteIds.length, 1);
});

test("화음과 양손은 한 차례로 묶어 '동시에 누를 음'으로 준다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("화음");
  sheet.grandStaff = true;
  sheet.measures = [api.musicMeasure(
    [api.musicNote("C", 4, { value:"whole", chord:[{ step:"E", octave:4 }, { step:"G", octave:4 }] })],
    { bassNotes:[api.musicNote("C", 3, { value:"whole" })] }
  )];
  const both = api.musicPracticeSteps(sheet);
  assert.equal(both.steps.length, 1);
  assert.deepEqual(Array.from(both.steps[0].pcs), [0, 4, 7]);          // 도·미·솔 — 낮은 도는 같은 음이름이라 겹치지 않는다
  assert.equal(both.steps[0].noteIds.length, 2);           // 오른손 화음 한 개 + 왼손 한 개
  // 손을 고르면 그 오선만 따라친다.
  const right = api.musicPracticeSteps(sheet, { staff:"treble" });
  assert.equal(right.steps[0].noteIds.length, 1);
  const left = api.musicPracticeSteps(sheet, { staff:"bass" });
  assert.deepEqual(Array.from(left.steps[0].pcs), [0]);
});

test("붙임줄로 이어진 음은 한 번만 누르되 두 음표를 함께 칠한다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("붙임줄");
  const first = api.musicNote("G", 4, { value:"half", tieToNext:true });
  const second = api.musicNote("G", 4, { value:"half" });
  sheet.measures = [api.musicMeasure([first, second])];
  const built = api.musicPracticeSteps(sheet);
  assert.equal(built.total, 1);
  assert.deepEqual(Array.from(built.steps[0].noteIds), [first.id, second.id]);
});

test("마디 범위만 따라치고, 도돌이는 펼치지 않는다", () => {
  const api = loadMusic();
  const sheet = api.musicEmpty("도돌이");
  sheet.measures = [
    api.musicMeasure([api.musicNote("C", 4, { value:"whole" })], { repeatStart:true }),
    api.musicMeasure([api.musicNote("D", 4, { value:"whole" })], { repeatEnd:true }),
    api.musicMeasure([api.musicNote("E", 4, { value:"whole" })])
  ];
  // 도돌이를 펼치면 같은 음표가 두 번 나와 화면의 맞음·틀림 표시가 서로를 덮어쓴다.
  const all = api.musicPracticeSteps(sheet);
  assert.equal(all.total, 3);
  assert.deepEqual(Array.from(all.steps.map((step) => step.pcs[0])), [0, 2, 4]);
  const part = api.musicPracticeSteps(sheet, { from:2, to:3 });
  assert.equal(part.total, 2);
  assert.deepEqual(Array.from(part.steps.map((step) => step.measure)), [2, 3]);
});

test("빈 악보는 따라칠 차례가 없다", () => {
  const api = loadMusic();
  const built = api.musicPracticeSteps(api.musicEmpty("빈 악보"));
  assert.equal(built.total, 0);
  assert.equal(built.steps.length, 0);
});


/* ===== 음감 테스트 — 소리만 듣고 음이름 맞히기 ===== */

// 예측 가능한 난수. 같은 씨앗이면 같은 문제지가 나와야 규칙을 눈으로 확인할 수 있다.
function fakeRng(values){
  let at = 0;
  return () => values[at++ % values.length];
}

test("단계마다 나올 수 있는 음이 정해져 있다", () => {
  const api = loadMusic();
  const level1 = api.musicEarPool(1);
  assert.deepEqual(Array.from(level1), [60, 62, 64, 65, 67, 69, 71]);      // 도4~시4 흰건반 일곱
  assert.equal(api.musicEarPool(2).length, 14);                 // 두 옥타브 흰건반
  assert.ok(!api.musicEarPool(2).includes(61), "흰건반 단계에 검은건반이 섞이면 안 된다");
  assert.equal(api.musicEarPool(3).length, 24);                 // 도4~시5 반음 전부
  assert.ok(api.musicEarPool(3).includes(61));
  // 앱 음역(G3~C6) 안에 들어야 실제로 소리를 낼 수 있다.
  for (const level of api.MUSIC_EAR_LEVELS){
    for (const midi of api.musicEarPool(level.id)) assert.ok(midi >= 55 && midi <= 84);
  }
  // 4단계만 옥타브까지 묻고, 고를 옥타브는 4·5 둘뿐이라 문항마다 조건이 같다.
  assert.deepEqual(Array.from(api.MUSIC_EAR_LEVELS.filter((level) => level.octaveAnswer).map((level) => level.id)), [4]);
  assert.deepEqual(Array.from(api.musicEarOctaves(4)), [4, 5]);
  assert.deepEqual(Array.from(api.musicEarOctaves(1)), [4]);
});

test("문제는 뽑은 단계 안에서만 나오고, 같은 정답이 연달아 나오지 않는다", () => {
  const api = loadMusic();
  // 도4 다음 도5를 고르는 난수 — MIDI는 달라도 두 문제의 정답은 모두 '도'다.
  const built = api.musicEarQuestions({ level:2, count:10, rng:fakeRng([0, 0.5]) });
  assert.equal(built.questions.length, 10);
  const pool = api.musicEarPool(2);
  for (let index = 0; index < built.questions.length; index++){
    const question = built.questions[index];
    assert.ok(pool.includes(question.midi));
    assert.equal(question.pc, api.musicPitchClass(question.midi));
    assert.equal(question.index, index);
    if (index) assert.notEqual(question.pc, built.questions[index - 1].pc);
  }
  // 잘못된 값이 들어와도 판이 성립해야 한다 — 빈 값은 기본 문항 수, 나머지는 1~50 사이로 자른다.
  assert.equal(api.musicEarQuestions({ level:1, count:0 }).questions.length, 10);
  assert.equal(api.musicEarQuestions({ level:1, count:-5 }).questions.length, 1);
  assert.equal(api.musicEarQuestions({ level:1, count:999 }).questions.length, 50);
  assert.equal(api.musicEarQuestions({ level:99 }).level.id, 1);   // 없는 단계는 1단계로
});

test("옥타브는 4단계에서만 채점한다", () => {
  const api = loadMusic();
  const question = { midi:67, pc:7, octave:4 };                     // 솔4
  // 1~3단계 — 음이름만 맞으면 몇 옥타브에서 눌러도 맞은 것으로 본다.
  assert.equal(api.musicEarJudge(question, { pc:7, octave:5 }, 2).correct, true);
  assert.equal(api.musicEarJudge(question, { pc:9, octave:4 }, 2).correct, false);
  // 4단계 — 음이름이 맞아도 옥타브가 틀리면 틀린 답이다.
  const wrongOctave = api.musicEarJudge(question, { pc:7, octave:5 }, 4);
  assert.equal(wrongOctave.correct, false);
  assert.equal(wrongOctave.pcOk, true);
  assert.equal(wrongOctave.octaveOk, false);
  assert.equal(api.musicEarJudge(question, { pc:7, octave:4 }, 4).correct, true);
  assert.equal(api.musicEarJudge(question, { pc:7 }, 2).needsOctave, false);
  assert.equal(api.musicEarJudge(question, { pc:7 }, 4).needsOctave, true);
});

test("성적표는 정확도·반응 시간과 함께 헷갈린 음 짝을 센다", () => {
  const api = loadMusic();
  const summary = api.musicEarSummary([
    { pc:0, answerPc:0, correct:true,  ms:900,  replays:0 },
    { pc:5, answerPc:7, correct:false, ms:2100, replays:1 },
    { pc:5, answerPc:7, correct:false, ms:1500, replays:0 },
    { pc:7, answerPc:5, correct:false, ms:1200, replays:0 }
  ]);
  assert.equal(summary.answered, 4);
  assert.equal(summary.correct, 1);
  assert.equal(summary.wrong, 3);
  assert.equal(summary.accuracy, 25);
  assert.equal(summary.avgMs, 1425);
  assert.equal(summary.bestMs, 900);
  assert.equal(summary.replays, 1);
  assert.equal(summary.confusions[0].label, "파→솔");        // 가장 많이 헷갈린 짝이 앞에 온다
  assert.equal(summary.confusions[0].count, 2);
  assert.equal(summary.confusions.length, 2);
  assert.equal(api.musicEarSummary([]).accuracy, 0);
  // 상위 세 짝까지만 보여 준다(교실에서 읽을 수 있는 분량).
  const many = api.musicEarSummary([0, 1, 2, 3, 4].map((pc) => ({ pc, answerPc:(pc + 1) % 12, correct:false, ms:1000 })));
  assert.equal(many.confusions.length, 3);
});

test("간섭음은 문제 음역과 겹치지 않는다", () => {
  const api = loadMusic();
  // 문제 음(도4~시5)과 같은 자리에서 울리면 앞 음의 잔상을 지우기는커녕 답을 헷갈리게 한다.
  for (const value of [0, 0.5, 0.99]){
    const cluster = api.musicEarDistractor(() => value);
    assert.equal(cluster.length, 4);
    for (const midi of cluster) assert.ok(midi < 60, `간섭음이 문제 음역에 들어왔다: ${midi}`);
    // 화음이 되지 않게 반음·트라이톤으로만 쌓는다.
    assert.deepEqual(Array.from(cluster.map((midi) => midi - cluster[0])), [0, 1, 6, 11]);
  }
  assert.equal(api.MUSIC_EAR_REFERENCE_MIDI, 60);              // 기준음은 가온다
});
