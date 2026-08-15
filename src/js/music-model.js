"use strict";

/* ===== .msheet 악보 문서 — 모델 (P0) =====
   - 저장 포맷: UTF-8 JSON 한 개(format:"classdock-sheet"). 단선율과 피아노 대보표를 함께 지원.
   - 이 파일은 순수 모델이다. DOM·오디오·VexFlow 를 일절 참조하지 않는다
     (그래야 node --test 로 조판·소리 없이 규칙을 검증할 수 있다).
   - 이름을 music* 로 잡은 이유: 이 코드베이스에서 sheet* 는 이미 스프레드시트를 뜻한다
     (spreadsheet-viewer.js 의 sheetBaseName 등). 파일 확장자만 .msheet 이고 코드는 music* 로 통일한다.
   설계: docs/악보-설계.md */

const MUSIC_FORMAT = "classdock-sheet";
const MUSIC_VERSION = 4;

// 4분음표 = 480틱. 정수로만 다뤄 부동소수 오차를 없앤다(점음표까지 나눠떨어진다).
const MUSIC_TICKS_PER_QUARTER = 480;
const MUSIC_MAX_DOTS = 2;
const MUSIC_X_OFFSET_MAX = 36;       // 자동 조판 위치에서 허용하는 좌우 미세 조정(조판 좌표)

// value → VexFlow 표기와 틱. 온음표~16분음표(동요 범위).
const MUSIC_NOTE_VALUES = {
  whole:   { vex:"w",  ticks:MUSIC_TICKS_PER_QUARTER * 4 },
  half:    { vex:"h",  ticks:MUSIC_TICKS_PER_QUARTER * 2 },
  quarter: { vex:"q",  ticks:MUSIC_TICKS_PER_QUARTER },
  eighth:  { vex:"8",  ticks:MUSIC_TICKS_PER_QUARTER / 2 },
  "16th":  { vex:"16", ticks:MUSIC_TICKS_PER_QUARTER / 4 }
};

const MUSIC_STEPS = ["C", "D", "E", "F", "G", "A", "B"];
const MUSIC_STEP_SEMITONES = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

function musicAlterationsFromFifths(fifths){
  const count = Math.max(-7, Math.min(7, Math.round(Number(fifths) || 0)));
  const order = count > 0 ? ["F", "C", "G", "D", "A", "E", "B"] : ["B", "E", "A", "D", "G", "C", "F"];
  const alterations = {};
  for (let index = 0; index < Math.abs(count); index++) alterations[order[index]] = count > 0 ? 1 : -1;
  return alterations;
}

function musicKeySpec(label, vex, fifths, mode){
  return { label, vex, fifths, mode:mode || "major", alterations:musicAlterationsFromFifths(fifths) };
}

// 장·단조 조표를 임시표 7개까지 제공한다. alterations 는 "그 음이름은 기본으로 이만큼 변한다".
const MUSIC_KEYS = {
  C:musicKeySpec("다장조", "C", 0), G:musicKeySpec("사장조", "G", 1),
  D:musicKeySpec("라장조", "D", 2), A:musicKeySpec("가장조", "A", 3),
  E:musicKeySpec("마장조", "E", 4), B:musicKeySpec("나장조", "B", 5),
  "F#":musicKeySpec("올림바장조", "F#", 6), "C#":musicKeySpec("올림다장조", "C#", 7),
  F:musicKeySpec("바장조", "F", -1), Bb:musicKeySpec("내림나장조", "Bb", -2),
  Eb:musicKeySpec("내림마장조", "Eb", -3), Ab:musicKeySpec("내림가장조", "Ab", -4),
  Db:musicKeySpec("내림라장조", "Db", -5), Gb:musicKeySpec("내림사장조", "Gb", -6),
  Cb:musicKeySpec("내림다장조", "Cb", -7),
  Am:musicKeySpec("가단조", "Am", 0, "minor"), Em:musicKeySpec("마단조", "Em", 1, "minor"),
  Bm:musicKeySpec("나단조", "Bm", 2, "minor"), "F#m":musicKeySpec("올림바단조", "F#m", 3, "minor"),
  "C#m":musicKeySpec("올림다단조", "C#m", 4, "minor"), "G#m":musicKeySpec("올림사단조", "G#m", 5, "minor"),
  "D#m":musicKeySpec("올림라단조", "D#m", 6, "minor"), "A#m":musicKeySpec("올림가단조", "A#m", 7, "minor"),
  Dm:musicKeySpec("라단조", "Dm", -1, "minor"), Gm:musicKeySpec("사단조", "Gm", -2, "minor"),
  Cm:musicKeySpec("다단조", "Cm", -3, "minor"), Fm:musicKeySpec("바단조", "Fm", -4, "minor"),
  Bbm:musicKeySpec("내림나단조", "Bbm", -5, "minor"), Ebm:musicKeySpec("내림마단조", "Ebm", -6, "minor"),
  Abm:musicKeySpec("내림가단조", "Abm", -7, "minor")
};

const MUSIC_TIMBRES = [
  "piano", "guitar", "xylophone", "harp", "flute", "clarinet",
  "triangle", "sine", "square"
];
const MUSIC_TEMPO_MIN = 40;
const MUSIC_TEMPO_MAX = 208;
const MUSIC_DEFAULT_TEMPO = 100;

// 동요 음역: 덧줄 2개 안쪽(높은음자리표 기준 C4~A5)을 기본으로 두되,
// 파일에서 읽을 때는 조금 넉넉히 받아 준다(다른 곳에서 만든 파일을 거절하지 않으려고).
const MUSIC_RANGE_MIN_MIDI = 55;   // G3
const MUSIC_RANGE_MAX_MIDI = 84;   // C6
const MUSIC_BASS_RANGE_MIN_MIDI = 36; // C2
const MUSIC_BASS_RANGE_MAX_MIDI = 72; // C5

function musicId(prefix){
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

function musicNote(step, octave, opts){
  const o = opts || {};
  const note = {
    id:musicId("n"),
    rest:false,
    step:MUSIC_STEP_SEMITONES[step] === undefined ? "C" : step,
    octave:Number.isFinite(o.octave) ? o.octave : (Number(octave) || 4),
    alter:musicClampAlter(o.alter),
    value:MUSIC_NOTE_VALUES[o.value] ? o.value : "quarter",
    dots:musicClampDots(o.dots)
  };
  const xOffset = musicClampXOffset(o.xOffset);
  if (xOffset) note.xOffset = xOffset;
  if (Array.isArray(o.chord)){
    note.chord = o.chord.map(musicNormalizePitch).filter(Boolean);
    if (!note.chord.length) delete note.chord;
  }
  if (o.tieToNext === true) note.tieToNext = true;
  if (o.slurToNext === true) note.slurToNext = true;
  const chordSymbol = musicClampChordSymbol(o.chordSymbol);
  if (chordSymbol) note.chordSymbol = chordSymbol;
  const lyric = musicClampText(o.lyric, 80);
  if (lyric) note.lyric = lyric;
  if (["pp", "p", "mp", "mf", "f", "ff"].includes(o.dynamic)) note.dynamic = o.dynamic;
  if (["staccato", "accent", "tenuto"].includes(o.articulation)) note.articulation = o.articulation;
  const fingering = Math.round(Number(o.fingering) || 0);
  if (fingering >= 1 && fingering <= 5) note.fingering = fingering;
  if (["start", "stop"].includes(o.pedal)) note.pedal = o.pedal;
  if (Number(o.tuplet) === 3) note.tuplet = 3;
  return note;
}

function musicNormalizePitch(raw){
  if (!raw || typeof raw !== "object" || MUSIC_STEP_SEMITONES[raw.step] === undefined) return null;
  const octave = Math.round(Number(raw.octave));
  if (!Number.isFinite(octave) || octave < 0 || octave > 9) return null;
  return { step:raw.step, octave, alter:musicClampAlter(raw.alter) };
}

function musicPitchKey(pitch){
  return pitch ? `${pitch.step}:${Math.round(Number(pitch.octave) || 0)}:${musicClampAlter(pitch.alter)}` : "";
}

function musicNotePitches(note){
  if (!note || note.rest) return [];
  const first = musicNormalizePitch(note);
  if (!first) return [];
  const out = [first], seen = new Set([musicPitchKey(first)]);
  for (const raw of (Array.isArray(note.chord) ? note.chord : [])){
    const pitch = musicNormalizePitch(raw);
    const key = musicPitchKey(pitch);
    if (!pitch || seen.has(key)) continue;
    seen.add(key);
    out.push(pitch);
  }
  out.sort((a, b) => musicMidiNumber(a) - musicMidiNumber(b));
  return out;
}

function musicAddChordPitch(note, rawPitch){
  if (!note || note.rest) return false;
  const pitch = musicNormalizePitch(rawPitch);
  if (!pitch || musicNotePitches(note).some((item) => musicPitchKey(item) === musicPitchKey(pitch))) return false;
  if (!Array.isArray(note.chord)) note.chord = [];
  note.chord.push(pitch);
  return true;
}

function musicRemoveChordPitch(note){
  if (!note || !Array.isArray(note.chord) || !note.chord.length) return null;
  const removed = note.chord.pop();
  if (!note.chord.length) delete note.chord;
  return removed;
}

function musicClampChordSymbol(value){
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 32);
}

function musicClampText(value, limit){
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, Math.max(1, Number(limit) || 80));
}

function musicRest(value, dots, opts){
  const rest = {
    id:musicId("n"),
    rest:true,
    value:MUSIC_NOTE_VALUES[value] ? value : "quarter",
    dots:musicClampDots(dots)
  };
  const xOffset = musicClampXOffset(opts && opts.xOffset);
  if (xOffset) rest.xOffset = xOffset;
  if (opts && Number(opts.tuplet) === 3) rest.tuplet = 3;
  return rest;
}

function musicClampAlter(alter){
  const n = Math.round(Number(alter) || 0);
  return Math.max(-2, Math.min(2, n));
}

function musicClampDots(dots){
  const n = Math.round(Number(dots) || 0);
  return Math.max(0, Math.min(MUSIC_MAX_DOTS, n));
}

function musicClampXOffset(value){
  const n = Math.round(Number(value) || 0);
  return Math.max(-MUSIC_X_OFFSET_MAX, Math.min(MUSIC_X_OFFSET_MAX, n));
}

function musicMeasure(notes, opts){
  const o = opts || {};
  const measure = {
    id:musicId("m"),
    notes:Array.isArray(notes) ? notes : [],
    voice2Notes:Array.isArray(o.voice2Notes) ? o.voice2Notes : [],
    bassNotes:Array.isArray(o.bassNotes) ? o.bassNotes : [],
    bassVoice2Notes:Array.isArray(o.bassVoice2Notes) ? o.bassVoice2Notes : [],
    lineBreakBefore:o.lineBreakBefore === true
  };
  if (o.repeatStart === true) measure.repeatStart = true;
  if (o.repeatEnd === true) measure.repeatEnd = true;
  const ending = Math.round(Number(o.ending) || 0);
  if (ending === 1 || ending === 2) measure.ending = ending;
  const pickupTicks = Math.round(Number(o.pickupTicks) || 0);
  if (pickupTicks > 0) measure.pickupTicks = pickupTicks;
  const timeChange = musicNormalizeTime(o.timeChange);
  if (timeChange) measure.timeChange = timeChange;
  if (MUSIC_KEYS[o.keyChange]) measure.keyChange = o.keyChange;
  const tempoChange = Number(o.tempoChange);
  if (tempoChange > 0) measure.tempoChange = musicClampTempo(tempoChange);
  return measure;
}

function musicEmpty(title){
  const now = Date.now();
  return {
    format:MUSIC_FORMAT,
    version:MUSIC_VERSION,
    title:String(title || "악보"),
    createdAt:now,
    updatedAt:now,
    tempo:MUSIC_DEFAULT_TEMPO,
    time:{ beats:4, beatValue:4 },
    key:"C",
    clef:"treble",
    grandStaff:false,
    timbre:"piano",
    showSolfege:true,
    measures:[musicMeasure(), musicMeasure(), musicMeasure(), musicMeasure()]
  };
}

function musicExampleSheet(name){
  const key = String(name || "").toLowerCase();
  if (key === "school-bell"){
    const sheet = musicEmpty("학교종");
    sheet.tempo = 100;
    sheet.measures = [
      musicMeasure([musicNote("G", 4), musicNote("G", 4), musicNote("A", 4), musicNote("A", 4)]),
      musicMeasure([musicNote("G", 4), musicNote("G", 4), musicNote("E", 4, { value:"half" })]),
      musicMeasure([musicNote("G", 4), musicNote("G", 4), musicNote("E", 4), musicNote("E", 4)]),
      musicMeasure([musicNote("D", 4, { value:"half" }), musicRest("half")])
    ];
    return sheet;
  }
  if (key === "twinkle"){
    const sheet = musicEmpty("작은별");
    sheet.tempo = 90;
    sheet.measures = [
      musicMeasure([musicNote("C", 4), musicNote("C", 4), musicNote("G", 4), musicNote("G", 4)]),
      musicMeasure([musicNote("A", 4), musicNote("A", 4), musicNote("G", 4, { value:"half" })]),
      musicMeasure([musicNote("F", 4), musicNote("F", 4), musicNote("E", 4), musicNote("E", 4)]),
      musicMeasure([musicNote("D", 4), musicNote("D", 4), musicNote("C", 4, { value:"half" })])
    ];
    return sheet;
  }
  return null;
}

/* ----- 음높이 ----------------------------------------------------------------
   alter 는 "실제로 울리는 반음"이다(MusicXML 의 <alter> 와 같은 뜻).
   화면에 임시표를 그릴지는 조표와 비교해 musicVexNote 가 따로 정한다.
   이렇게 나눠 두면 재생은 조표를 몰라도 항상 옳고, 표시 규칙만 나중에 손볼 수 있다. */

function musicMidiNumber(note){
  if (!note || note.rest) return null;
  const semitone = MUSIC_STEP_SEMITONES[note.step];
  if (semitone === undefined) return null;
  const octave = Number(note.octave);
  if (!Number.isFinite(octave)) return null;
  return (octave + 1) * 12 + semitone + musicClampAlter(note.alter);
}

function musicFrequency(midi){
  if (!Number.isFinite(midi)) return 0;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function musicNoteFrequency(note){
  const midi = musicMidiNumber(note);
  return midi === null ? 0 : musicFrequency(midi);
}

// 사람이 읽는 이름(도구상자·상태표시줄용). 내림표는 b 로 적는다.
function musicNoteName(note){
  if (!note || note.rest) return "쉼표";
  const alter = musicClampAlter(note.alter);
  const mark = alter === 0 ? "" : alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
  return note.step + mark + note.octave;
}

/* ----- 길이(틱) ------------------------------------------------------------- */

function musicNoteTicks(note){
  const spec = MUSIC_NOTE_VALUES[note && note.value];
  if (!spec) return 0;
  const dots = musicClampDots(note.dots);
  // 점 하나면 1.5배, 둘이면 1.75배 — 정수를 유지하려고 곱하고 나눈다.
  const ticks = (spec.ticks * (Math.pow(2, dots + 1) - 1)) / Math.pow(2, dots);
  return note && Number(note.tuplet) === 3 ? ticks * 2 / 3 : ticks;
}

function musicNormalizeTime(raw){
  if (!raw || typeof raw !== "object") return null;
  const beats = Math.max(1, Math.min(16, Math.round(Number(raw.beats) || 0)));
  const beatValue = Math.round(Number(raw.beatValue) || 0);
  return [2, 4, 8, 16].includes(beatValue) ? { beats, beatValue } : null;
}

function musicMeasureTicks(time){
  const beats = Math.max(1, Math.round(Number(time && time.beats) || 4));
  const beatValue = Math.max(1, Math.round(Number(time && time.beatValue) || 4));
  return beats * ((MUSIC_TICKS_PER_QUARTER * 4) / beatValue);
}

function musicStaffNotes(measure, staff){
  return musicVoiceNotes(measure, staff, 1);
}

function musicVoiceNotes(measure, staff, voice){
  if (!measure) return [];
  const second = Number(voice) === 2;
  const key = staff === "bass"
    ? (second ? "bassVoice2Notes" : "bassNotes")
    : (second ? "voice2Notes" : "notes");
  return Array.isArray(measure[key]) ? measure[key] : [];
}

function musicMeasureUsedTicks(measure, staff, voice){
  const notes = musicVoiceNotes(measure, staff, voice);
  let total = 0;
  for (const note of notes) total += musicNoteTicks(note);
  return total;
}

function musicEffectiveMeasureSettings(sheet, measureIndex){
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  const settings = {
    time:musicNormalizeTime(sheet && sheet.time) || { beats:4, beatValue:4 },
    key:MUSIC_KEYS[sheet && sheet.key] ? sheet.key : "C",
    tempo:musicClampTempo(sheet && sheet.tempo)
  };
  const last = Math.max(0, Math.min(measures.length - 1, Math.round(Number(measureIndex) || 0)));
  for (let index = 0; index <= last; index++){
    const measure = measures[index];
    if (!measure) continue;
    if (musicNormalizeTime(measure.timeChange)) settings.time = musicNormalizeTime(measure.timeChange);
    if (MUSIC_KEYS[measure.keyChange]) settings.key = measure.keyChange;
    if (Number(measure.tempoChange) > 0) settings.tempo = musicClampTempo(measure.tempoChange);
  }
  return settings;
}

/* 고른 마디만 담은 발췌 악보 — 오선 한 단을 메모로 보냈다가 다시 열 때 쓴다.
   첫 마디에 걸리는 조표·박자·빠르기는 앞 마디에서 이어받은 값이라 마디만 떼어 오면 사라진다.
   그래서 그 자리의 실제 설정을 발췌본의 기본값으로 옮겨 적는다(도중에 조가 바뀌는 악보). */
function musicExcerpt(sheet, indexes, options){
  const list = (Array.isArray(indexes) ? indexes : []).filter((index) => Number.isInteger(index));
  if (!list.length) return null;
  const excerpt = musicParse(musicSerialize(sheet));      // 저장 형식을 거쳐 깊게 복사
  const measures = list.map((index) => excerpt.measures[index]).filter(Boolean);
  if (!measures.length) return null;
  const effective = musicEffectiveMeasureSettings(sheet, list[0]);
  excerpt.measures = measures;
  excerpt.time = effective.time;
  excerpt.key = effective.key;
  excerpt.tempo = effective.tempo;
  const head = measures[0];
  head.lineBreakBefore = false;
  // 기본값으로 올린 설정이 첫 마디에도 남아 있으면 발췌본에 조표·박자가 두 번 적힌다.
  delete head.timeChange;
  delete head.keyChange;
  delete head.tempoChange;
  const title = options && options.title;
  if (title) excerpt.title = String(title).slice(0, 200);
  excerpt.updatedAt = Date.now();
  return excerpt;
}

function musicMeasureCapacity(sheet, measureIndex){
  const measure = sheet && Array.isArray(sheet.measures) ? sheet.measures[measureIndex] : null;
  const pickup = Math.round(Number(measure && measure.pickupTicks) || 0);
  return pickup > 0 ? pickup : musicMeasureTicks(musicEffectiveMeasureSettings(sheet, measureIndex).time);
}

/* ----- 검사 -----------------------------------------------------------------
   저장을 막지는 않는다(작성 중인 악보도 저장돼야 한다). 편집기가 경고만 띄운다.
   · 아직 아무것도 넣지 않은 빈 마디는 "작성 전"이라 문제 삼지 않는다.
   · 마지막 마디의 덜 참은 허용한다(끝마디는 짧을 수 있다). */

function musicValidate(sheet){
  const issues = [];
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  measures.forEach((measure, index) => {
    for (const staff of ((sheet && sheet.grandStaff) ? ["treble", "bass"] : ["treble"])){
      for (const voice of [1, 2]){
        const used = musicMeasureUsedTicks(measure, staff, voice);
        const expected = musicMeasureCapacity(sheet, index);
        if (used === 0) continue;
        if (used > expected) issues.push({ measure:index + 1, staff, voice, kind:"over", expected, actual:used });
        else if (used < expected && index < measures.length - 1){
          issues.push({ measure:index + 1, staff, voice, kind:"under", expected, actual:used });
        }
      }
    }
  });
  return { ok:issues.length === 0, issues };
}

// 이 음표를 그 마디에 더 넣을 수 있는지(편집기가 입력을 막는 기준).
function musicCanFit(sheet, measureIndex, note, staff, voice){
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  const measure = measures[measureIndex];
  if (!measure) return false;
  return musicMeasureUsedTicks(measure, staff, voice) + musicNoteTicks(note) <= musicMeasureCapacity(sheet, measureIndex);
}

function musicMeasureProgress(sheet, measureIndex, staff, voice){
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  const index = Math.max(0, Math.min(Math.max(0, measures.length - 1), Math.round(Number(measureIndex) || 0)));
  const settings = musicEffectiveMeasureSettings(sheet, index);
  const expected = musicMeasureCapacity(sheet, index);
  const used = musicMeasureUsedTicks(measures[index], staff, voice);
  const beatValue = settings.time.beatValue;
  const ticksPerBeat = MUSIC_TICKS_PER_QUARTER * 4 / beatValue;
  return {
    measure:index + 1,
    used, expected,
    remaining:Math.max(0, expected - used),
    over:Math.max(0, used - expected),
    usedBeats:used / ticksPerBeat,
    expectedBeats:expected / ticksPerBeat,
    remainingBeats:Math.max(0, expected - used) / ticksPerBeat,
    overBeats:Math.max(0, used - expected) / ticksPerBeat,
    complete:used === expected
  };
}

/* ----- VexFlow 로 넘길 형태 ---------------------------------------------------
   모델은 VexFlow 표기를 저장하지 않는다. 그리기 직전에만 바꾼다(설계 §2).
   임시표는 조표와 다를 때만 그린다 — 사장조에서 F#은 임시표 없이, F♮이면 ♮을 붙인다. */

function musicKeyAlterations(key){
  const spec = MUSIC_KEYS[key];
  return spec ? spec.alterations : {};
}

function musicAccidentalSymbol(alter){
  if (alter === 0) return "n";
  if (alter === 1) return "#";
  if (alter === 2) return "##";
  if (alter === -1) return "b";
  if (alter === -2) return "bb";
  return null;
}

function musicVexNote(note, key, clef){
  const value = MUSIC_NOTE_VALUES[note && note.value] || MUSIC_NOTE_VALUES.quarter;
  const dots = musicClampDots(note && note.dots);
  if (!note || note.rest){
    const restKey = clef === "bass" ? "d/3" : "b/4";
    return { keys:[restKey], duration:value.vex + "r", dots, rest:true, accidentals:[], accidental:null };
  }
  const pitches = musicNotePitches(note);
  const accidentals = pitches.map((pitch) => {
    const alter = musicClampAlter(pitch.alter);
    const keyAlter = musicKeyAlterations(key)[pitch.step] || 0;
    return alter === keyAlter ? null : musicAccidentalSymbol(alter);
  });
  return {
    keys:pitches.map((pitch) => {
      const alter = musicClampAlter(pitch.alter);
      const mark = alter === 0 ? "" : alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
      return pitch.step.toLowerCase() + mark + "/" + pitch.octave;
    }),
    duration:value.vex,
    dots,
    rest:false,
    accidentals,
    accidental:accidentals[0]
  };
}

/* ----- 오선 자리 ↔ 음높이 -----------------------------------------------------
   편집(오선 클릭·↑↓ 이동)에 쓰는 계산. 악보 관례라 VexFlow 와 무관하므로 여기 둔다.

   음이름을 "몇 번째 흰건반인가"(diatonic)로 세면 줄·칸을 한 칸씩 오르내리기 쉽다.
   C4 = 4*7+0 = 28, D4 = 29 … 반음(alter)은 여기에 섞지 않는다.

   높은음자리표에서 오선 맨 윗줄(VexFlow line 0)은 F5 다. 줄 값이 0.5 늘 때마다
   (줄 → 칸 → 줄) 한 음씩 내려간다. */

const MUSIC_DIATONIC_STEPS = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
const MUSIC_TREBLE_TOP_DIATONIC = 5 * 7 + 3;   // F5
const MUSIC_BASS_TOP_DIATONIC = 3 * 7 + 5;     // A3

function musicDiatonicValue(note){
  if (!note || MUSIC_DIATONIC_STEPS[note.step] === undefined) return null;
  return Math.round(Number(note.octave) || 0) * 7 + MUSIC_DIATONIC_STEPS[note.step];
}

function musicPitchFromDiatonic(value){
  const v = Math.round(Number(value) || 0);
  return { step:MUSIC_STEPS[((v % 7) + 7) % 7], octave:Math.floor(v / 7) };
}

// 오선 줄 값(0=맨 윗줄, 0.5=그 아래 칸 …) → 음높이. 0.5 단위로 맞춰 받는다.
function musicPitchFromStaveLine(lineValue, clef){
  const top = clef === "bass" ? MUSIC_BASS_TOP_DIATONIC : MUSIC_TREBLE_TOP_DIATONIC;
  return musicPitchFromDiatonic(top - Math.round(Number(lineValue) * 2));
}

function musicStaveLineForNote(note, clef){
  const diatonic = musicDiatonicValue(note);
  const top = clef === "bass" ? MUSIC_BASS_TOP_DIATONIC : MUSIC_TREBLE_TOP_DIATONIC;
  return diatonic === null ? null : (top - diatonic) / 2;
}

function musicMidiInRange(midi, staff){
  const min = staff === "bass" ? MUSIC_BASS_RANGE_MIN_MIDI : MUSIC_RANGE_MIN_MIDI;
  const max = staff === "bass" ? MUSIC_BASS_RANGE_MAX_MIDI : MUSIC_RANGE_MAX_MIDI;
  return Number.isFinite(midi) && midi >= min && midi <= max;
}

/* 음표를 흰건반 기준으로 steps 만큼 올리고 내린다(↑↓ 한 음씩, Shift 면 한 옥타브).
   음역을 벗어나면 null 을 준다 — 호출부가 "더 못 올라가요"로 처리한다.
   임시표(alter)는 그대로 들고 간다: 사장조에서 F#을 올리면 G#이 아니라 G 가 되는 게 아니라
   같은 임시표를 유지한 G# 이 된다. 교실에서 쓰기엔 이 규칙이 예측 가능하다. */
function musicShiftPitch(note, steps, staff){
  const diatonic = musicDiatonicValue(note);
  if (diatonic === null) return null;
  const moved = musicPitchFromDiatonic(diatonic + Math.round(Number(steps) || 0));
  const midi = musicMidiNumber({ step:moved.step, octave:moved.octave, alter:musicClampAlter(note.alter) });
  return musicMidiInRange(midi, staff) ? moved : null;
}

/* ----- 재생 타임라인 ----------------------------------------------------------
   모델 → "몇 초에 어떤 주파수를 얼마 동안" 목록. 실시간 재생과 WAV 저장이 같은 목록을 쓴다.
   from·to 는 1부터 세는 마디 번호(양끝 포함). 부분 재생은 그 구간만 잘라 0초부터 다시 센다.
   tempo 는 4분음표 기준 BPM 이다(6/8 도 ♩ 기준으로 읽는다 — 설계 결정). */

function musicPlaybackMeasureIndexes(measures, first, last, useRepeats){
  const order = [];
  let index = first, repeatStart = first;
  const repeatedEnds = new Set();
  let repeatPass = 1;
  let guard = 0;
  while (index <= last && guard++ < Math.max(32, measures.length * 4)){
    const measure = measures[index];
    if (measure && measure.repeatStart) repeatStart = index;
    const ending = Math.round(Number(measure && measure.ending) || 0);
    if (!useRepeats || !ending || ending === repeatPass) order.push(index);
    if (useRepeats && measure && measure.repeatEnd && !repeatedEnds.has(index)){
      repeatedEnds.add(index);
      repeatPass = 2;
      index = repeatStart;
    } else {
      index++;
      if (repeatPass === 2 && ending === 2) repeatPass = 1;
    }
  }
  return order;
}

function musicDynamicGain(dynamic){
  return ({ pp:0.42, p:0.58, mp:0.72, mf:0.86, f:1, ff:1.15 })[dynamic] || 1;
}

function musicTimeline(sheet, opts){
  const options = opts || {};
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  const playbackRate = Math.max(0.25, Math.min(2, Number(options.playbackRate) || 1));
  const tempo = musicClampTempo(sheet && sheet.tempo) * playbackRate;
  const secondsPerTick = 60 / tempo / MUSIC_TICKS_PER_QUARTER;
  const first = Math.max(1, Math.round(Number(options.from) || 1)) - 1;
  const last = Math.min(measures.length, Math.round(Number(options.to) || measures.length)) - 1;
  const requestedStaff = options.staff === "bass" ? "bass" : options.staff === "treble" ? "treble" : null;
  const staffs = requestedStaff ? [requestedStaff] : (sheet && sheet.grandStaff ? ["treble", "bass"] : ["treble"]);
  const order = musicPlaybackMeasureIndexes(measures, first, last, options.repeats !== false);
  const events = [];
  const metronome = [];
  const tied = new Map();
  const currentGain = new Map();
  let measureStartSeconds = 0;
  let previousIndex = null;

  for (const index of order){
    const measure = measures[index];
    if (!measure) continue;
    if (previousIndex !== null && index !== previousIndex + 1) tied.clear();
    previousIndex = index;
    const settings = musicEffectiveMeasureSettings(sheet, index);
    const localTempo = settings.tempo * playbackRate;
    const localSecondsPerTick = 60 / localTempo / MUSIC_TICKS_PER_QUARTER;
    const capacity = musicMeasureCapacity(sheet, index);
    const beatTicks = MUSIC_TICKS_PER_QUARTER * 4 / settings.time.beatValue;
    for (let tick = 0; tick < capacity; tick += beatTicks){
      metronome.push({ start:measureStartSeconds + tick * localSecondsPerTick, accented:tick === 0,
        measure:index + 1 });
    }
    for (const staff of staffs){
      for (const voice of [1, 2]){
        const voiceKey = `${staff}:${voice}`;
        let cursorTicks = 0;
        let tiedPitches = tied.get(voiceKey) || new Map();
        let gain = currentGain.get(voiceKey) || 1;
        for (const note of musicVoiceNotes(measure, staff, voice)){
          const ticks = musicNoteTicks(note);
          if (ticks <= 0) continue;
          const start = measureStartSeconds + cursorTicks * localSecondsPerTick;
          const fullDuration = ticks * localSecondsPerTick;
          if (note.dynamic){ gain = musicDynamicGain(note.dynamic); currentGain.set(voiceKey, gain); }
          if (note.rest){
            events.push({ id:note.id, noteId:note.id, staff, voice, measure:index + 1, rest:true,
              midi:null, frequency:0, start, duration:fullDuration, gain });
            tiedPitches = new Map();
            cursorTicks += ticks;
            continue;
          }
          const nextTied = new Map();
          const durationFactor = note.tieToNext ? 1 : note.articulation === "staccato" ? 0.52
            : note.articulation === "tenuto" ? 0.96 : 1;
          const noteGain = gain * (note.articulation === "accent" ? 1.18 : 1);
          for (const pitch of musicNotePitches(note)){
            const midi = musicMidiNumber(pitch);
            if (midi === null) continue;
            const previous = tiedPitches.get(midi);
            let event;
            if (previous && Math.abs((previous.start + previous.duration) - start) < 1e-7){
              previous.duration += fullDuration;
              event = previous;
            } else {
              event = { id:note.id, noteId:note.id, staff, voice, measure:index + 1, rest:false, midi,
                frequency:musicFrequency(midi), start, duration:fullDuration * durationFactor, gain:noteGain };
              events.push(event);
            }
            if (note.tieToNext) nextTied.set(midi, event);
          }
          tiedPitches = nextTied;
          cursorTicks += ticks;
        }
        tied.set(voiceKey, tiedPitches);
      }
    }
    measureStartSeconds += capacity * localSecondsPerTick;
  }
  events.sort((a, b) => a.start - b.start || a.staff.localeCompare(b.staff) || a.voice - b.voice);
  const firstSettings = musicEffectiveMeasureSettings(sheet, order.length ? order[0] : first);
  return { tempo, playbackRate, secondsPerTick, totalSeconds:measureStartSeconds, events,
    metronome, countInBeats:firstSettings.time.beats,
    countInBeatSeconds:(60 / (firstSettings.tempo * playbackRate)) * (4 / firstSettings.time.beatValue),
    measureOrder:order.map((index) => index + 1) };
}

function musicClampTempo(tempo){
  const n = Math.round(Number(tempo) || MUSIC_DEFAULT_TEMPO);
  return Math.max(MUSIC_TEMPO_MIN, Math.min(MUSIC_TEMPO_MAX, n));
}

/* ----- 조표 바꾸기 -------------------------------------------------------------
   조표를 바꾸면 "임시표 없이 적혀 있던 음"은 새 조표를 따라간다.
   다장조의 파(F♮)를 사장조로 바꾸면 파샵(F#)이 되는 것이 악보를 읽는 사람의 기대다.
   반대로 임시표가 붙어 있던 음(그 조표의 기본과 달랐던 음)은 일부러 적은 것이므로 그대로 둔다.
   alter 가 "실제 울리는 반음"이라(§2) 이 규칙이 곧 소리의 변화가 된다. */
function musicRetuneForKey(sheet, nextKey){
  if (!sheet || !MUSIC_KEYS[nextKey]) return 0;
  const before = musicKeyAlterations(sheet.key);
  const after = musicKeyAlterations(nextKey);
  let changed = 0;
  for (const measure of (Array.isArray(sheet.measures) ? sheet.measures : [])){
    for (const note of [
      ...musicVoiceNotes(measure, "treble", 1), ...musicVoiceNotes(measure, "treble", 2),
      ...musicVoiceNotes(measure, "bass", 1), ...musicVoiceNotes(measure, "bass", 2)
    ]){
      if (note.rest) continue;
      for (const pitch of [note, ...(Array.isArray(note.chord) ? note.chord : [])]){
        const wasDefault = musicClampAlter(pitch.alter) === (before[pitch.step] || 0);
        if (!wasDefault) continue;                     // 임시표를 일부러 적은 음은 건드리지 않는다
        const next = after[pitch.step] || 0;
        if (next !== musicClampAlter(pitch.alter)){ pitch.alter = next; changed++; }
      }
    }
  }
  sheet.key = nextKey;
  return changed;
}

/* ----- 조옮김(전조) -----------------------------------------------------------
   조표 바꾸기(musicRetuneForKey)와 다르다. 저건 음표를 제자리에 두고 조표만 갈아끼우고,
   이건 노래 전체를 통째로 올리거나 내린다("아이들 목소리에 맞게 두 음 올려 주세요").

   반음 수만으로는 어떻게 적을지가 정해지지 않는다(올림다 = 내림라). 그래서 순서를 이렇게 잡는다.
     1) 새 조표를 먼저 정한다 — 5도권에서 옮긴 뒤 임시표가 적은 쪽을 고른다(다장조 +1반음 → 내림라장조).
     2) 그 조표의 으뜸음이 몇 칸 움직였는지로 음이름의 이동 칸수(diatonicSteps)를 얻는다.
     3) 모든 음을 "칸수만큼 이름을 옮기고, 남는 차이는 임시표로" 적는다.
   이러면 조표와 음 하나하나의 적는 법이 서로 어긋나지 않는다. */

const MUSIC_TRANSPOSE_LIMIT = 12;    // 위아래 한 옥타브까지(그 이상은 옥타브를 겹쳐 쓰면 된다)

const MUSIC_MIDI_SHARP_SPELLING = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
  ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]
];
const MUSIC_MIDI_FLAT_SPELLING = [
  ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
  ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]
];

// MIDI 번호 하나를 음이름으로 — 같은 소리를 두 이름으로 적을 수 있어 어느 쪽을 쓸지 받는다.
function musicPitchFromMidi(midi, preferFlats){
  const value = Math.round(Number(midi));
  if (!Number.isFinite(value)) return null;
  const [step, alter] = (preferFlats ? MUSIC_MIDI_FLAT_SPELLING : MUSIC_MIDI_SHARP_SPELLING)[((value % 12) + 12) % 12];
  return { step, octave:Math.floor(value / 12) - 1, alter };
}

function musicKeyTonic(key){
  const spec = MUSIC_KEYS[key];
  if (!spec) return null;
  const mark = String(key).charAt(1);
  return { step:String(key).charAt(0), alter:mark === "#" ? 1 : mark === "b" ? -1 : 0, mode:spec.mode };
}

function musicKeyIdFor(tonic, mode){
  if (!tonic) return null;
  const mark = tonic.alter === 1 ? "#" : tonic.alter === -1 ? "b" : tonic.alter === 0 ? "" : null;
  if (mark === null) return null;                  // 겹올림표 으뜸음(G##장조)은 조표로 적지 않는다
  const id = tonic.step + mark + (mode === "minor" ? "m" : "");
  return MUSIC_KEYS[id] ? id : null;
}

// 옮긴 뒤의 조표. 같은 소리를 내는 후보 중 임시표가 적은 쪽을 고르고,
// 6개로 같으면(올림바 ↔ 내림사) 올리는 방향이면 올림표 쪽을 쓴다.
function musicTransposedKey(key, semitones){
  const spec = MUSIC_KEYS[key];
  if (!spec) return null;
  const amount = Math.round(Number(semitones) || 0);
  const wanted = spec.fifths + 7 * amount;
  let best = null;
  for (let fifths = -7; fifths <= 7; fifths++){
    if (((fifths - wanted) % 12 + 12) % 12 !== 0) continue;
    if (best === null || Math.abs(fifths) < Math.abs(best)
      || (Math.abs(fifths) === Math.abs(best) && (amount > 0 ? fifths > best : fifths < best))) best = fifths;
  }
  if (best === null) return null;
  for (const [id, candidate] of Object.entries(MUSIC_KEYS)){
    if (candidate.fifths === best && candidate.mode === spec.mode) return id;
  }
  return null;
}

// 으뜸음이 움직인 칸수. 반음 수의 옥타브 부분은 그대로 7칸씩 더한다.
function musicTransposeSteps(fromKey, toKey, semitones){
  const from = musicKeyTonic(fromKey), to = musicKeyTonic(toKey);
  if (!from || !to) return null;
  const amount = Math.round(Number(semitones) || 0);
  const within = ((amount % 12) + 12) % 12;
  const octaves = (amount - within) / 12;
  const steps = ((MUSIC_DIATONIC_STEPS[to.step] - MUSIC_DIATONIC_STEPS[from.step]) % 7 + 7) % 7;
  return steps + octaves * 7;
}

/* 음 하나를 옮긴다. 이름은 diatonicSteps 칸 옮기고, 남는 반음 차이를 임시표로 적는다.
   이름을 7칸(한 옥타브) 어긋나게 잡으면 임시표가 12씩 튀므로, ±2 안에 드는 자리는 하나뿐이다.
   그 자리를 못 찾으면(겹올림표를 넘어서면) null — 호출부가 반음만 맞는 이름으로 대신 적는다. */
function musicTransposePitch(pitch, semitones, diatonicSteps){
  const diatonic = musicDiatonicValue(pitch);
  const midi = musicMidiNumber(pitch);
  if (diatonic === null || midi === null) return null;
  const target = midi + Math.round(Number(semitones) || 0);
  for (const octaveShift of [0, 7, -7]){
    const spelled = musicPitchFromDiatonic(diatonic + Math.round(Number(diatonicSteps) || 0) + octaveShift);
    const alter = target - musicMidiNumber({ step:spelled.step, octave:spelled.octave, alter:0 });
    if (Math.abs(alter) <= 2) return { step:spelled.step, octave:spelled.octave, alter };
  }
  return null;
}

/* 악보 전체를 옮긴다. opts.apply === false 면 세어 보기만 한다(편집기가 먼저 물어보려고).
   · outOfRange = 옮기면 권장 음역(오른손 G3~C6·왼손 C2~C5)을 벗어나는 음. 막지 않고 알리기만 한다.
   · blocked = 저장할 수 있는 옥타브(0~9)를 벗어나 적을 수 없는 음. 하나라도 있으면 아무것도 옮기지 않는다
     — 일부만 옮긴 악보는 고치기보다 다시 그리는 게 빠를 만큼 망가진다. */
function musicTransposeSheet(sheet, semitones, opts){
  const amount = Math.round(Number(semitones) || 0);
  const fromKey = (sheet && MUSIC_KEYS[sheet.key]) ? sheet.key : "C";
  const empty = { changed:0, outOfRange:0, blocked:0, semitones:0, previousKey:fromKey, key:fromKey };
  if (!sheet || !amount || Math.abs(amount) > MUSIC_TRANSPOSE_LIMIT) return empty;
  const toKey = musicTransposedKey(fromKey, amount);
  const diatonicSteps = musicTransposeSteps(fromKey, toKey, amount);
  if (!toKey || diatonicSteps === null) return empty;

  const edits = [];
  let outOfRange = 0, blocked = 0;
  for (const measure of (Array.isArray(sheet.measures) ? sheet.measures : [])){
    for (const staff of ["treble", "bass"]){
      for (const voice of [1, 2]){
        for (const note of musicVoiceNotes(measure, staff, voice)){
          if (note.rest) continue;
          for (const pitch of [note, ...(Array.isArray(note.chord) ? note.chord : [])]){
            const midi = musicMidiNumber(pitch);
            if (midi === null) continue;
            const moved = musicTransposePitch(pitch, amount, diatonicSteps)
              // 겹올림표를 넘는 음은 소리만 맞춰 적는다(방향에 맞는 임시표로).
              || musicPitchFromMidi(midi + amount, amount < 0);
            if (!moved || moved.octave < 0 || moved.octave > 9){ blocked++; continue; }
            if (!musicMidiInRange(midi + amount, staff)) outOfRange++;
            edits.push({ pitch, moved });
          }
        }
      }
    }
  }

  const report = { changed:edits.length, outOfRange, blocked, semitones:amount,
    previousKey:fromKey, key:toKey, diatonicSteps };
  if (blocked > 0 || (opts && opts.apply === false)) return report;

  for (const edit of edits){
    edit.pitch.step = edit.moved.step;
    edit.pitch.octave = edit.moved.octave;
    edit.pitch.alter = musicClampAlter(edit.moved.alter);
  }
  // 중간에 조표가 바뀌는 악보는 그 조표도 같은 간격으로 옮겨야 앞뒤가 맞는다.
  for (const measure of (Array.isArray(sheet.measures) ? sheet.measures : [])){
    if (!measure || !MUSIC_KEYS[measure.keyChange]) continue;
    const tonic = musicKeyTonic(measure.keyChange);
    const moved = musicTransposePitch({ step:tonic.step, octave:4, alter:tonic.alter }, amount, diatonicSteps);
    measure.keyChange = (moved && musicKeyIdFor(moved, tonic.mode))
      || musicTransposedKey(measure.keyChange, amount) || measure.keyChange;
  }
  sheet.key = toKey;
  return report;
}

/* ----- 줄 나누기(조판 폭 배분) --------------------------------------------------
   마디를 몇 개씩 한 줄에 놓을지 정한다. 화면 폭과 마디마다 든 음표 수로 정하므로
   16분음표가 빽빽한 마디는 넓게, 온음표 한 개짜리 마디는 좁게 간다.
   순수 계산이라 브라우저 없이 검증한다(그리기는 music-editor.js). */

const MUSIC_BAR_BASE_WIDTH = 74;     // 음표가 없어도 필요한 폭
const MUSIC_BAR_NOTE_WIDTH = 26;     // 음표 하나가 더 요구하는 폭
const MUSIC_BAR_MIN_WIDTH = 96;
const MUSIC_LINE_HEAD_EXTRA = 80;    // 줄 첫 마디의 음자리표·조표 자리
const MUSIC_MAX_BARS_PER_LINE = 8;

function musicBarWidthHint(measure){
  const count = Math.max(
    musicVoiceNotes(measure, "treble", 1).length, musicVoiceNotes(measure, "treble", 2).length,
    musicVoiceNotes(measure, "bass", 1).length, musicVoiceNotes(measure, "bass", 2).length
  );
  return Math.max(MUSIC_BAR_MIN_WIDTH, MUSIC_BAR_BASE_WIDTH + count * MUSIC_BAR_NOTE_WIDTH);
}

function musicPackLines(measures, availableWidth){
  const list = Array.isArray(measures) ? measures : [];
  const width = Math.max(MUSIC_BAR_MIN_WIDTH + MUSIC_LINE_HEAD_EXTRA, Number(availableWidth) || 0);
  const lines = [];
  let current = null;

  list.forEach((measure, index) => {
    const hint = musicBarWidthHint(measure);
    // ＋오선으로 지정한 마디는 폭이 남아 있어도 새 단의 첫 마디가 된다.
    if (current && measure && measure.lineBreakBefore === true) current = null;
    if (current){
      const wouldBe = current.total + hint;
      const full = current.indexes.length >= MUSIC_MAX_BARS_PER_LINE;
      if (full || wouldBe > width - MUSIC_LINE_HEAD_EXTRA) current = null;
    }
    if (!current){
      current = { indexes:[], hints:[], total:0 };
      lines.push(current);
    }
    current.indexes.push(index);
    current.hints.push(hint);
    current.total += hint;
  });

  // 남는 폭은 마디마다 비례로 나눠 줄을 꽉 채운다(줄 끝이 들쭉날쭉하지 않게).
  return lines.map((line) => {
    const room = width - MUSIC_LINE_HEAD_EXTRA;
    const scale = line.total > 0 ? Math.max(1, room / line.total) : 1;
    const widths = line.hints.map((hint, at) => hint * scale + (at === 0 ? MUSIC_LINE_HEAD_EXTRA : 0));
    return { indexes:line.indexes, widths };
  });
}

/* ----- 읽기·쓰기 ------------------------------------------------------------- */

// 신뢰할 수 없는 입력(JSON)을 안전한 모델로 정규화한다. mnote 와 같은 규칙:
// 서명·버전이 맞지 않거나 음표 종류를 모르면 편집 모델로 열지 않고 던진다(호출부가 텍스트로 폴백).
function musicNormalizeNote(raw){
  if (!raw || typeof raw !== "object") return null;
  if (!MUSIC_NOTE_VALUES[raw.value]) throw new Error("지원하지 않는 음표 길이: " + raw.value);
  const dots = musicClampDots(raw.dots);
  if (raw.rest === true){
    const rest = musicRest(raw.value, dots, { xOffset:raw.xOffset, tuplet:raw.tuplet });
    if (typeof raw.id === "string" && raw.id) rest.id = raw.id.slice(0, 80);
    return rest;
  }
  if (MUSIC_STEP_SEMITONES[raw.step] === undefined) throw new Error("지원하지 않는 음이름: " + raw.step);
  const octave = Math.round(Number(raw.octave));
  if (!Number.isFinite(octave) || octave < 0 || octave > 9) throw new Error("음높이가 범위를 벗어났습니다.");
  const note = musicNote(raw.step, octave, {
    alter:raw.alter, value:raw.value, dots, xOffset:raw.xOffset,
    chord:raw.chord, tieToNext:raw.tieToNext, slurToNext:raw.slurToNext,
    chordSymbol:raw.chordSymbol, lyric:raw.lyric, dynamic:raw.dynamic,
    articulation:raw.articulation, fingering:raw.fingering, pedal:raw.pedal, tuplet:raw.tuplet
  });
  if (typeof raw.id === "string" && raw.id) note.id = raw.id.slice(0, 80);
  return note;
}

function musicNormalizeMeasure(raw){
  const notes = [];
  const voice2Notes = [];
  const bassNotes = [];
  const bassVoice2Notes = [];
  const rawNotes = (raw && Array.isArray(raw.notes)) ? raw.notes : [];
  for (const rawNote of rawNotes){
    const note = musicNormalizeNote(rawNote);
    if (note) notes.push(note);
  }
  const rawBassNotes = (raw && Array.isArray(raw.bassNotes)) ? raw.bassNotes : [];
  for (const rawNote of rawBassNotes){
    const note = musicNormalizeNote(rawNote);
    if (note) bassNotes.push(note);
  }
  for (const rawNote of ((raw && Array.isArray(raw.voice2Notes)) ? raw.voice2Notes : [])){
    const note = musicNormalizeNote(rawNote); if (note) voice2Notes.push(note);
  }
  for (const rawNote of ((raw && Array.isArray(raw.bassVoice2Notes)) ? raw.bassVoice2Notes : [])){
    const note = musicNormalizeNote(rawNote); if (note) bassVoice2Notes.push(note);
  }
  const measure = musicMeasure(notes, {
    voice2Notes, bassNotes, bassVoice2Notes,
    lineBreakBefore:raw && raw.lineBreakBefore === true,
    repeatStart:raw && raw.repeatStart === true, repeatEnd:raw && raw.repeatEnd === true,
    ending:raw && raw.ending,
    pickupTicks:raw && raw.pickupTicks, timeChange:raw && raw.timeChange,
    keyChange:raw && raw.keyChange, tempoChange:raw && raw.tempoChange
  });
  if (raw && typeof raw.id === "string" && raw.id) measure.id = raw.id.slice(0, 80);
  return measure;
}

function musicParse(text){
  let raw;
  try { raw = JSON.parse(String(text || "")); }
  catch(_){ throw new Error("악보 파일(JSON)을 읽지 못했습니다."); }
  if (!raw || typeof raw !== "object") throw new Error("악보 파일이 비어 있습니다.");
  if (raw.format !== MUSIC_FORMAT) throw new Error("악보 파일이 아닙니다.");
  const version = Math.round(Number(raw.version) || 0);
  if (!(version >= 1 && version <= MUSIC_VERSION)) throw new Error("지원하지 않는 악보 버전: " + raw.version);

  const now = Date.now();
  const beats = Math.max(1, Math.min(16, Math.round(Number(raw.time && raw.time.beats) || 4)));
  const beatValue = [2, 4, 8, 16].includes(Math.round(Number(raw.time && raw.time.beatValue)))
    ? Math.round(Number(raw.time.beatValue)) : 4;
  const measures = (Array.isArray(raw.measures) ? raw.measures : []).map(musicNormalizeMeasure);
  if (measures.length) measures[0].lineBreakBefore = false;  // 첫 마디 앞 줄바꿈은 의미가 없다
  return {
    format:MUSIC_FORMAT,
    version:MUSIC_VERSION,
    title:String(raw.title || "악보").slice(0, 200),
    createdAt:Number(raw.createdAt) || now,
    updatedAt:Number(raw.updatedAt) || now,
    tempo:musicClampTempo(raw.tempo),
    time:{ beats, beatValue },
    key:MUSIC_KEYS[raw.key] ? raw.key : "C",
    clef:"treble",
    grandStaff:raw.grandStaff === true || measures.some((measure) =>
      measure.bassNotes.length > 0 || measure.bassVoice2Notes.length > 0),
    // v1의 triangle 은 당시 새 악보 기본값이었다. v2에서 실제 피아노가 기본이 되었으므로
    // 기존 악보도 별도 설정 없이 개선된 소리를 듣도록 자동 이전한다.
    timbre:(version === 1 && raw.timbre === "triangle")
      ? "piano" : (MUSIC_TIMBRES.includes(raw.timbre) ? raw.timbre : "piano"),
    showSolfege:raw.showSolfege !== false,
    measures:measures.length ? measures : [musicMeasure()]
  };
}

// 같은 모델은 언제나 같은 바이트로 — 키 순서를 코드로 고정한다(불필요한 파일 변경·diff 방지).
function musicSerialize(sheet){
  const model = sheet || musicEmpty();
  const out = {
    format:MUSIC_FORMAT,
    version:MUSIC_VERSION,
    title:String(model.title || "악보"),
    createdAt:Number(model.createdAt) || 0,
    updatedAt:Number(model.updatedAt) || 0,
    tempo:musicClampTempo(model.tempo),
    time:{
      beats:Math.max(1, Math.round(Number(model.time && model.time.beats) || 4)),
      beatValue:Math.max(1, Math.round(Number(model.time && model.time.beatValue) || 4))
    },
    key:MUSIC_KEYS[model.key] ? model.key : "C",
    clef:"treble",
    grandStaff:model.grandStaff === true,
    timbre:MUSIC_TIMBRES.includes(model.timbre) ? model.timbre : "piano",
    showSolfege:model.showSolfege !== false,
    measures:(Array.isArray(model.measures) ? model.measures : []).map((measure, index) => {
      const outMeasure = { id:String(measure && measure.id || musicId("m")) };
      // 기존 .msheet와 불필요한 diff를 만들지 않도록 수동 줄바꿈이 있을 때만 기록한다.
      if (index > 0 && measure && measure.lineBreakBefore === true) outMeasure.lineBreakBefore = true;
      if (measure && measure.repeatStart === true) outMeasure.repeatStart = true;
      if (measure && measure.repeatEnd === true) outMeasure.repeatEnd = true;
      if (measure && (measure.ending === 1 || measure.ending === 2)) outMeasure.ending = measure.ending;
      if (Math.round(Number(measure && measure.pickupTicks) || 0) > 0) outMeasure.pickupTicks = Math.round(Number(measure.pickupTicks));
      if (musicNormalizeTime(measure && measure.timeChange)) outMeasure.timeChange = musicNormalizeTime(measure.timeChange);
      if (measure && MUSIC_KEYS[measure.keyChange]) outMeasure.keyChange = measure.keyChange;
      if (measure && Number(measure.tempoChange) > 0) outMeasure.tempoChange = musicClampTempo(measure.tempoChange);
      const serializeNote = (note) => {
        const outNote = note.rest
          ? { id:String(note.id || musicId("n")), rest:true, value:note.value, dots:musicClampDots(note.dots) }
          : {
              id:String(note.id || musicId("n")),
              rest:false,
              step:note.step,
              octave:Math.round(Number(note.octave) || 4),
              alter:musicClampAlter(note.alter),
              value:note.value,
              dots:musicClampDots(note.dots)
            };
        const xOffset = musicClampXOffset(note.xOffset);
        if (xOffset) outNote.xOffset = xOffset;
        if (!note.rest){
          const chord = musicNotePitches(note).filter((pitch) => musicPitchKey(pitch) !== musicPitchKey(note));
          if (chord.length) outNote.chord = chord.map((pitch) => ({
            step:pitch.step, octave:pitch.octave, alter:musicClampAlter(pitch.alter)
          }));
          if (note.tieToNext === true) outNote.tieToNext = true;
          if (note.slurToNext === true) outNote.slurToNext = true;
          const chordSymbol = musicClampChordSymbol(note.chordSymbol);
          if (chordSymbol) outNote.chordSymbol = chordSymbol;
          const lyric = musicClampText(note.lyric, 80);
          if (lyric) outNote.lyric = lyric;
          if (["pp", "p", "mp", "mf", "f", "ff"].includes(note.dynamic)) outNote.dynamic = note.dynamic;
          if (["staccato", "accent", "tenuto"].includes(note.articulation)) outNote.articulation = note.articulation;
          const fingering = Math.round(Number(note.fingering) || 0);
          if (fingering >= 1 && fingering <= 5) outNote.fingering = fingering;
          if (["start", "stop"].includes(note.pedal)) outNote.pedal = note.pedal;
        }
        if (Number(note.tuplet) === 3) outNote.tuplet = 3;
        return outNote;
      };
      outMeasure.notes = musicStaffNotes(measure, "treble").map(serializeNote);
      const voice2Notes = musicVoiceNotes(measure, "treble", 2);
      if (voice2Notes.length) outMeasure.voice2Notes = voice2Notes.map(serializeNote);
      const bassNotes = musicStaffNotes(measure, "bass");
      if (model.grandStaff === true || bassNotes.length) outMeasure.bassNotes = bassNotes.map(serializeNote);
      const bassVoice2Notes = musicVoiceNotes(measure, "bass", 2);
      if (bassVoice2Notes.length) outMeasure.bassVoice2Notes = bassVoice2Notes.map(serializeNote);
      return outMeasure;
    })
  };
  return JSON.stringify(out, null, 2);
}

function musicScratchFileName(n){
  return n && n > 1 ? "악보 " + n + ".msheet" : "악보.msheet";
}
