"use strict";

/* ===== .msheet 악보 문서 — 모델 (P0) =====
   - 저장 포맷: UTF-8 JSON 한 개(format:"classdock-sheet"). 단선율과 피아노 대보표를 함께 지원.
   - 이 파일은 순수 모델이다. DOM·오디오·VexFlow 를 일절 참조하지 않는다
     (그래야 node --test 로 조판·소리 없이 규칙을 검증할 수 있다).
   - 이름을 music* 로 잡은 이유: 이 코드베이스에서 sheet* 는 이미 스프레드시트를 뜻한다
     (spreadsheet-viewer.js 의 sheetBaseName 등). 파일 확장자만 .msheet 이고 코드는 music* 로 통일한다.
   설계: docs/악보-설계.md */

const MUSIC_FORMAT = "classdock-sheet";
const MUSIC_VERSION = 8;

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
const MUSIC_DRUM_STYLE_SPECS = Object.freeze({
  off:{ label:"끔", times:null },
  basic:{ label:"기본 드럼", times:null },
  children:{ label:"동요", times:null },
  ballad:{ label:"발라드", times:["4/4", "6/8"] },
  march:{ label:"행진", times:["2/4", "4/4"] },
  waltz:{ label:"왈츠", times:["3/4"] },
  rock:{ label:"록", times:["4/4"] }
});
const MUSIC_DRUM_STYLES = Object.freeze(Object.keys(MUSIC_DRUM_STYLE_SPECS));
const MUSIC_DEFAULT_DRUM_VOLUME = 0.65;
const MUSIC_ACCOMPANIMENT_MODES = Object.freeze(["drums", "bass", "full"]);
const MUSIC_ACCOMPANIMENT_TIMBRES = Object.freeze(["piano", "guitar"]);
const MUSIC_TEMPO_MIN = 40;
const MUSIC_TEMPO_MAX = 208;
const MUSIC_DEFAULT_TEMPO = 100;
const MUSIC_DEFAULT_PART_VOLUME = 1;
const MUSIC_PART_STRUCTURE_KEYS = Object.freeze([
  "lineBreakBefore", "repeatStart", "repeatEnd", "ending", "pickupTicks",
  "timeChange", "keyChange", "tempoChange"
]);

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
  const measures = [musicMeasure(), musicMeasure(), musicMeasure(), musicMeasure()];
  const sheet = {
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
    drumStyle:"off",
    drumVolume:MUSIC_DEFAULT_DRUM_VOLUME,
    accompanimentMode:"drums",
    accompanimentTimbre:"piano",
    showSolfege:true,
    measures
  };
  const part = musicPart("피아노", { timbre:"piano", volume:MUSIC_DEFAULT_PART_VOLUME, measures });
  sheet.parts = [part];
  sheet.activePartId = part.id;
  return sheet;
}

function musicClampPartVolume(value){
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : MUSIC_DEFAULT_PART_VOLUME;
}

function musicPart(name, opts){
  const options = opts || {};
  return {
    id:typeof options.id === "string" && options.id ? options.id.slice(0, 80) : musicId("part"),
    name:musicClampText(name || options.name || "악기", 80) || "악기",
    timbre:MUSIC_TIMBRES.includes(options.timbre) ? options.timbre : "piano",
    volume:musicClampPartVolume(options.volume),
    muted:options.muted === true,
    grandStaff:options.grandStaff === true,
    measures:Array.isArray(options.measures) && options.measures.length ? options.measures : [musicMeasure()]
  };
}

function musicParts(sheet){
  return sheet && Array.isArray(sheet.parts) ? sheet.parts.filter((part) => part && typeof part === "object") : [];
}

function musicActivePart(sheet){
  const parts = musicParts(sheet);
  return parts.find((part) => part.id === (sheet && sheet.activePartId)) || parts[0] || null;
}

function musicCopyMeasureStructure(source, target, index){
  const output = target || musicMeasure();
  for (const key of MUSIC_PART_STRUCTURE_KEYS){
    if (source && Object.prototype.hasOwnProperty.call(source, key)) output[key] = source[key];
    else delete output[key];
  }
  if (index === 0) output.lineBreakBefore = false;
  return output;
}

/* 편집 화면은 선택한 파트의 기존 sheet.measures/timbre/grandStaff API를 그대로 쓴다.
   파트를 바꾸기 직전에 현재 화면 내용을 파트에 되돌리고, 마디 구조는 모든 파트에 맞춘다. */
function musicSyncActivePart(sheet){
  const active = musicActivePart(sheet);
  if (!active) return null;
  active.timbre = MUSIC_TIMBRES.includes(sheet.timbre) ? sheet.timbre : active.timbre;
  active.grandStaff = sheet.grandStaff === true;
  active.measures = Array.isArray(sheet.measures) && sheet.measures.length ? sheet.measures : [musicMeasure()];
  const sourceMeasures = active.measures;
  for (const part of musicParts(sheet)){
    if (part === active) continue;
    if (!Array.isArray(part.measures)) part.measures = [];
    while (part.measures.length < sourceMeasures.length) part.measures.push(musicMeasure());
    if (part.measures.length > sourceMeasures.length) part.measures.length = sourceMeasures.length;
    sourceMeasures.forEach((measure, index) => musicCopyMeasureStructure(measure, part.measures[index], index));
  }
  return active;
}

function musicSelectPart(sheet, partId){
  if (!sheet) return null;
  musicSyncActivePart(sheet);
  const part = musicParts(sheet).find((item) => item.id === partId);
  if (!part) return musicActivePart(sheet);
  sheet.activePartId = part.id;
  sheet.measures = part.measures;
  sheet.timbre = part.timbre;
  sheet.grandStaff = part.grandStaff === true;
  return part;
}

function musicAddPart(sheet, opts){
  if (!sheet) return null;
  const active = musicSyncActivePart(sheet);
  const options = opts || {};
  const existing = musicParts(sheet);
  const sourceMeasures = active ? active.measures : (sheet.measures || [musicMeasure()]);
  const measures = sourceMeasures.map((measure, index) => musicCopyMeasureStructure(measure, musicMeasure(), index));
  const part = musicPart(options.name || `악기 ${existing.length + 1}`, {
    timbre:options.timbre || "piano", volume:options.volume, muted:false,
    grandStaff:options.grandStaff === true, measures
  });
  if (!Array.isArray(sheet.parts)) sheet.parts = [];
  sheet.parts.push(part);
  musicSelectPart(sheet, part.id);
  return part;
}

function musicRemovePart(sheet, partId){
  if (!sheet) return null;
  musicSyncActivePart(sheet);
  const parts = musicParts(sheet);
  if (parts.length <= 1) return null;
  const index = parts.findIndex((part) => part.id === partId);
  if (index < 0) return null;
  const removed = parts.splice(index, 1)[0];
  sheet.parts = parts;
  const next = parts[Math.min(index, parts.length - 1)];
  sheet.activePartId = next.id;
  sheet.measures = next.measures;
  sheet.timbre = next.timbre;
  sheet.grandStaff = next.grandStaff === true;
  return removed;
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

function musicDrumStyle(value){
  return MUSIC_DRUM_STYLES.includes(value) ? value : "off";
}

function musicClampDrumVolume(value){
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : MUSIC_DEFAULT_DRUM_VOLUME;
}

function musicDrumTimeKey(time){
  const beats = Math.max(1, Math.round(Number(time && time.beats) || 4));
  const beatValue = Math.max(1, Math.round(Number(time && time.beatValue) || 4));
  return `${beats}/${beatValue}`;
}

function musicDrumStyleCompatible(style, time){
  const spec = MUSIC_DRUM_STYLE_SPECS[musicDrumStyle(style)];
  return !spec || !Array.isArray(spec.times) || spec.times.includes(musicDrumTimeKey(time));
}

/* 박자표별 드럼 패턴. 음표와 독립된 반주 이벤트라 화면 표기는 건드리지 않는다.
   tick 은 마디 안의 위치, gain 은 악기별 상대 세기다. 못갖춘마디는 capacity 에서 자연스럽게 잘린다.
   악보 중간에 박자가 바뀌어 선택 스타일과 맞지 않으면 그 마디만 기본 드럼으로 자연스럽게 이어 간다. */
function musicDrumPattern(style, time, capacity){
  const requested = musicDrumStyle(style);
  if (requested === "off") return [];
  const effective = musicDrumStyleCompatible(requested, time) ? requested : "basic";
  const beats = Math.max(1, Math.round(Number(time && time.beats) || 4));
  const beatValue = Math.max(1, Math.round(Number(time && time.beatValue) || 4));
  const beatTicks = MUSIC_TICKS_PER_QUARTER * 4 / beatValue;
  const halfBeat = beatTicks / 2;
  const events = [];
  const add = (kind, tick, gain) => {
    if (tick >= 0 && tick < capacity) events.push({ kind, tick, gain });
  };
  const hats = (stepTicks, strong, weak) => {
    for (let tick = 0, step = 0; tick < capacity; tick += stepTicks, step++){
      add("hihat", tick, step % Math.max(1, Math.round(beatTicks / stepTicks)) === 0 ? strong : weak);
    }
  };

  if (effective === "waltz"){
    hats(beatTicks, 0.48, 0.48);
    add("kick", 0, 0.9);
    add("snare", beatTicks, 0.54);
    add("snare", beatTicks * 2, 0.64);
    return events;
  }

  if (effective === "march"){
    hats(halfBeat, 0.58, 0.34);
    for (let beat = 0; beat < beats; beat++){
      add(beat % 2 === 0 ? "kick" : "snare", beat * beatTicks, beat % 2 === 0 ? 1 : 0.96);
    }
    add("snare", capacity - halfBeat, 0.48);
    return events;
  }

  if (effective === "rock"){
    hats(halfBeat, 0.7, 0.5);
    add("kick", 0, 1.08);
    add("snare", beatTicks, 1.06);
    add("kick", beatTicks * 1.5, 0.72);
    add("kick", beatTicks * 2, 0.96);
    add("kick", beatTicks * 2.5, 0.62);
    add("snare", beatTicks * 3, 1.08);
    return events;
  }

  if (effective === "ballad"){
    if (beats === 6 && beatValue === 8){
      hats(beatTicks, 0.42, 0.42);
      add("kick", 0, 0.72);
      add("snare", beatTicks * 3, 0.62);
      add("kick", beatTicks * 5, 0.42);
    } else {
      hats(halfBeat, 0.38, 0.26);
      add("kick", 0, 0.72);
      add("snare", beatTicks, 0.58);
      add("kick", beatTicks * 2.5, 0.5);
      add("snare", beatTicks * 3, 0.62);
    }
    return events;
  }

  if (effective === "children"){
    if (beats === 6 && beatValue === 8){
      hats(beatTicks, 0.56, 0.56);
      add("kick", 0, 0.86);
      add("snare", beatTicks * 3, 0.72);
    } else if (beats === 3){
      hats(beatTicks, 0.5, 0.5);
      add("kick", 0, 0.86);
      add("snare", beatTicks, 0.46);
      add("snare", beatTicks * 2, 0.58);
    } else {
      hats(halfBeat, 0.54, 0.32);
      for (let beat = 0; beat < beats; beat++){
        add(beat % 2 === 0 ? "kick" : "snare", beat * beatTicks, beat % 2 === 0 ? 0.86 : 0.72);
      }
    }
    return events;
  }

  if (beats === 6 && beatValue === 8){
    // 여섯 개의 8분음표를 들려주되 1·4박을 큰 두 박으로 느끼게 한다.
    for (let beat = 0; beat < 6; beat++){
      add("hihat", beat * beatTicks, beat === 0 || beat === 3 ? 0.58 : 0.42);
    }
    add("kick", 0, 1);
    add("snare", 3 * beatTicks, 0.86);
    return events;
  }

  // 2/4·3/4·4/4는 8분음표 하이햇을 바탕으로 단순하고 익숙한 박을 만든다.
  hats(halfBeat, 0.55, 0.38);
  add("kick", 0, 1);
  if (beats === 2){
    add("snare", beatTicks, 0.88);
  } else if (beats === 3){
    add("snare", beatTicks, 0.68);
    add("snare", beatTicks * 2, 0.78);
  } else if (beats === 4){
    add("snare", beatTicks, 0.9);
    add("kick", beatTicks * 2, 0.82);
    add("snare", beatTicks * 3, 0.9);
  } else {
    add("snare", Math.floor(beats / 2) * beatTicks, 0.86);
  }
  return events;
}

function musicBasicDrumPattern(time, capacity){
  return musicDrumPattern("basic", time, capacity);
}

function musicAccompanimentMode(value){
  return MUSIC_ACCOMPANIMENT_MODES.includes(value) ? value : "drums";
}

function musicAccompanimentTimbre(value){
  return MUSIC_ACCOMPANIMENT_TIMBRES.includes(value) ? value : "piano";
}

function musicChordPitchClass(step, accidental){
  const base = MUSIC_STEP_SEMITONES[String(step || "").toUpperCase()];
  if (base === undefined) return null;
  const alteration = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (base + alteration + 12) % 12;
}

/* 코드 기호를 자동 반주에 필요한 음정으로 바꾼다. 화면 표기는 원문을 그대로 유지하고,
   여기서는 흔히 쓰는 장·단·7·sus·dim·aug·add9 및 슬래시 베이스만 해석한다. */
function musicParseChordSymbol(raw){
  const symbol = musicClampChordSymbol(raw);
  if (!symbol) return null;
  const compact = symbol.replace(/\s+/g, "").replace(/♯/g, "#").replace(/♭/g, "b");
  if (/^N\.?C\.?$/i.test(compact)) return null;
  const parts = compact.split("/");
  if (parts.length > 2 || !parts[0]) return null;
  const rootMatch = /^([A-Ga-g])([#b]?)(.*)$/.exec(parts[0]);
  if (!rootMatch) return null;
  const rootPc = musicChordPitchClass(rootMatch[1], rootMatch[2]);
  const bassMatch = parts.length === 2 ? /^([A-Ga-g])([#b]?)$/.exec(parts[1]) : null;
  if (parts.length === 2 && !bassMatch) return null;
  const bassPc = bassMatch ? musicChordPitchClass(bassMatch[1], bassMatch[2]) : rootPc;
  let suffix = rootMatch[3].replace(/[△Δ]/g, "maj").replace(/°/g, "dim").replace(/ø/g, "m7b5");
  let intervals = null;
  if (!suffix || suffix === "M" || /^(maj|major)$/i.test(suffix)) intervals = [0, 4, 7];
  else if (suffix === "M7" || /^(maj7|major7)$/i.test(suffix)) intervals = [0, 4, 7, 11];
  else if (/^(7|dom7)$/i.test(suffix)) intervals = [0, 4, 7, 10];
  else if (/^(m|min|minor|-)$/i.test(suffix)) intervals = [0, 3, 7];
  else if (/^(m7|min7|minor7|-7)$/i.test(suffix)) intervals = [0, 3, 7, 10];
  else if (/^(m6|min6|minor6|-6)$/i.test(suffix)) intervals = [0, 3, 7, 9];
  else if (/^(6|maj6)$/i.test(suffix)) intervals = [0, 4, 7, 9];
  else if (/^(m7b5|min7b5)$/i.test(suffix)) intervals = [0, 3, 6, 10];
  else if (/^dim7$/i.test(suffix)) intervals = [0, 3, 6, 9];
  else if (/^dim$/i.test(suffix)) intervals = [0, 3, 6];
  else if (/^(aug|\+)$/i.test(suffix)) intervals = [0, 4, 8];
  else if (/^sus2$/i.test(suffix)) intervals = [0, 2, 7];
  else if (/^(sus|sus4)$/i.test(suffix)) intervals = [0, 5, 7];
  else if (/^add9$/i.test(suffix)) intervals = [0, 4, 7, 14];
  else if (/^(madd9|minadd9)$/i.test(suffix)) intervals = [0, 3, 7, 14];
  else if (/^9$/i.test(suffix)) intervals = [0, 4, 10, 14];
  else if (/^(m9|min9)$/i.test(suffix)) intervals = [0, 3, 10, 14];
  else if (/^(maj9|M9)$/i.test(suffix)) intervals = [0, 4, 11, 14];
  if (!intervals) return null;
  return { symbol, rootPc, bassPc, intervals };
}

function musicSheetHasPlayableChords(sheet){
  for (const measure of ((sheet && sheet.measures) || [])){
    for (const notes of [measure.notes, measure.voice2Notes, measure.bassNotes, measure.bassVoice2Notes]){
      for (const note of (Array.isArray(notes) ? notes : [])){
        if (note && note.chordSymbol && musicParseChordSymbol(note.chordSymbol)) return true;
      }
    }
  }
  return false;
}

/* 각 마디 시작 시점의 코드를 원래 악보 순서로 미리 계산한다. 반복 재생으로 앞 마디로
   되돌아가더라도, 점프 직전 코드가 잘못 이어지지 않고 악보에 적힌 화성이 재현된다. */
function musicChordMeasureStates(sheet){
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  const states = [];
  let current = null;
  for (let measureIndex = 0; measureIndex < measures.length; measureIndex++){
    const measure = measures[measureIndex];
    const capacity = musicMeasureCapacity(sheet, measureIndex);
    const candidates = [];
    [
      musicVoiceNotes(measure, "treble", 1), musicVoiceNotes(measure, "treble", 2),
      musicVoiceNotes(measure, "bass", 1), musicVoiceNotes(measure, "bass", 2)
    ].forEach((notes, priority) => {
      let tick = 0;
      for (const note of notes){
        if (note && note.chordSymbol){
          candidates.push({ tick, priority, symbol:musicClampChordSymbol(note.chordSymbol),
            chord:musicParseChordSymbol(note.chordSymbol) });
        }
        tick += musicNoteTicks(note);
      }
    });
    candidates.sort((a, b) => a.tick - b.tick || a.priority - b.priority);
    const changes = [];
    for (const candidate of candidates){
      if (candidate.tick >= capacity) continue;
      if (changes.length && changes[changes.length - 1].tick === candidate.tick) continue;
      changes.push({ tick:candidate.tick, symbol:candidate.symbol, chord:candidate.chord });
    }
    states.push({ startChord:current, changes });
    for (const change of changes) current = change.chord;
  }
  return states;
}

function musicChordAtTick(state, tick){
  let chord = state ? state.startChord : null;
  for (const change of ((state && state.changes) || [])){
    if (change.tick > tick) break;
    chord = change.chord;
  }
  return chord;
}

function musicMidiForPitchClass(pitchClass, lowest){
  const floor = Math.round(Number(lowest) || 36);
  return floor + ((pitchClass - (floor % 12)) + 12) % 12;
}

function musicChordVoicing(chord){
  if (!chord) return [];
  let root = 60 + chord.rootPc;
  if (root > 67) root -= 12;
  return chord.intervals.map((interval) => root + interval);
}

function musicAccompanimentPattern(style, mode, time, capacity, chordState){
  const result = { bass:[], chords:[] };
  const selectedMode = musicAccompanimentMode(mode);
  if (musicDrumStyle(style) === "off" || selectedMode === "drums" || !chordState) return result;
  const beats = Math.max(1, Math.round(Number(time && time.beats) || 4));
  const beatValue = Math.max(1, Math.round(Number(time && time.beatValue) || 4));
  const beatTicks = MUSIC_TICKS_PER_QUARTER * 4 / beatValue;
  const effective = musicDrumStyleCompatible(style, time) ? musicDrumStyle(style) : "basic";
  let bassTicks;
  if (beats === 6 && beatValue === 8) bassTicks = [0, beatTicks * 3];
  else if (beats === 3) bassTicks = [0, beatTicks, beatTicks * 2];
  else if (beats >= 4) bassTicks = [0, beatTicks * 2];
  else bassTicks = [0, beatTicks];
  let chordTicks = [];
  let chordLength = beatTicks * 0.72;
  if (effective === "waltz") chordTicks = [beatTicks, beatTicks * 2];
  else if (effective === "ballad" && beats === 6 && beatValue === 8){
    chordTicks = [0, beatTicks * 3]; chordLength = beatTicks * 2.7;
  } else if (effective === "ballad"){
    chordTicks = [0, beatTicks * 2]; chordLength = beatTicks * 1.75;
  } else {
    for (let tick = 0; tick < capacity; tick += beatTicks) chordTicks.push(tick);
  }
  const changeTicks = chordState.changes.map((change) => change.tick);
  const uniqueTicks = (ticks) => Array.from(new Set(ticks.concat(changeTicks)
    .filter((tick) => tick >= 0 && tick < capacity))).sort((a, b) => a - b);
  bassTicks = uniqueTicks(bassTicks);
  chordTicks = uniqueTicks(chordTicks);
  bassTicks.forEach((tick, at) => {
    const chord = musicChordAtTick(chordState, tick);
    if (!chord) return;
    const explicitChange = chordState.changes.some((change) => change.tick === tick);
    const pitchClass = explicitChange || at % 2 === 0 ? chord.bassPc : (chord.rootPc + 7) % 12;
    const next = bassTicks[at + 1] === undefined ? capacity : bassTicks[at + 1];
    result.bass.push({ tick, duration:Math.max(1, Math.min(beatTicks * 0.82, next - tick)),
      midi:musicMidiForPitchClass(pitchClass, 36), gain:0.58, chordSymbol:chord.symbol });
  });
  if (selectedMode === "full") chordTicks.forEach((tick, at) => {
    const chord = musicChordAtTick(chordState, tick);
    if (!chord) return;
    const next = chordTicks[at + 1] === undefined ? capacity : chordTicks[at + 1];
    const duration = Math.max(1, Math.min(chordLength, next - tick));
    for (const midi of musicChordVoicing(chord)){
      result.chords.push({ tick, duration, midi, gain:0.3, chordSymbol:chord.symbol });
    }
  });
  return result;
}

function musicSinglePartTimeline(sheet, opts){
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
  const drums = [];
  const bass = [];
  const chords = [];
  const drumStyle = options.drums === false ? "off" : musicDrumStyle(sheet && sheet.drumStyle);
  const drumVolume = musicClampDrumVolume(sheet && sheet.drumVolume);
  const accompanimentMode = musicAccompanimentMode(sheet && sheet.accompanimentMode);
  const chordStates = musicChordMeasureStates(sheet);
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
    if (drumStyle !== "off"){
      for (const hit of musicDrumPattern(drumStyle, settings.time, capacity)){
        drums.push({ kind:hit.kind, start:measureStartSeconds + hit.tick * localSecondsPerTick,
          gain:hit.gain * drumVolume, measure:index + 1 });
      }
    }
    const accompaniment = musicAccompanimentPattern(drumStyle, accompanimentMode, settings.time,
      capacity, chordStates[index]);
    for (const item of accompaniment.bass){
      bass.push({ midi:item.midi, frequency:musicFrequency(item.midi), rest:false,
        start:measureStartSeconds + item.tick * localSecondsPerTick,
        duration:item.duration * localSecondsPerTick, gain:item.gain * drumVolume,
        accompaniment:"bass", chordSymbol:item.chordSymbol, measure:index + 1 });
    }
    for (const item of accompaniment.chords){
      chords.push({ midi:item.midi, frequency:musicFrequency(item.midi), rest:false,
        start:measureStartSeconds + item.tick * localSecondsPerTick,
        duration:item.duration * localSecondsPerTick, gain:item.gain * drumVolume,
        accompaniment:"chord", chordSymbol:item.chordSymbol, measure:index + 1 });
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
              // 붙임줄로 이어 붙인 음표들의 id 를 함께 들고 간다 — 소리는 하나지만 화면에는 음표가 여럿이라,
              // 따라치기가 "한 번 눌렀을 때 어느 음표들을 칠할지" 알아야 한다.
              if (!previous.tiedIds) previous.tiedIds = [previous.id];
              if (previous.tiedIds[previous.tiedIds.length - 1] !== note.id) previous.tiedIds.push(note.id);
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
  drums.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
  bass.sort((a, b) => a.start - b.start || a.midi - b.midi);
  chords.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const firstSettings = musicEffectiveMeasureSettings(sheet, order.length ? order[0] : first);
  return { tempo, playbackRate, secondsPerTick, totalSeconds:measureStartSeconds, events,
    metronome, drums, bass, chords, countInBeats:firstSettings.time.beats,
    countInBeatSeconds:(60 / (firstSettings.tempo * playbackRate)) * (4 / firstSettings.time.beatValue),
    measureOrder:order.map((index) => index + 1) };
}

function musicPartSheet(sheet, part){
  return Object.assign({}, sheet, {
    parts:undefined, activePartId:undefined,
    measures:part.measures,
    timbre:part.timbre,
    grandStaff:part.grandStaff === true
  });
}

/* 여러 파트를 같은 0초 축에 펼친 합주 타임라인. 드럼과 코드 자동 반주는 선택 파트에서
   한 번만 만들고, 각 악기 음표에는 고유 음색·파트·음량 정보를 붙인다. */
function musicTimeline(sheet, opts){
  const options = opts || {};
  const parts = musicParts(sheet);
  if (!parts.length) return musicSinglePartTimeline(sheet, options);
  musicSyncActivePart(sheet);
  const requested = options.partId && parts.find((part) => part.id === options.partId);
  const anchor = requested || musicActivePart(sheet) || parts[0];
  const base = musicSinglePartTimeline(musicPartSheet(sheet, anchor), options);
  const selectedParts = requested ? [requested] : parts;
  const events = [];
  let totalSeconds = base.totalSeconds;
  for (const part of selectedParts){
    if (part.muted === true && options.includeMuted !== true) continue;
    const timeline = part === anchor ? base : musicSinglePartTimeline(musicPartSheet(sheet, part),
      Object.assign({}, options, { drums:false }));
    totalSeconds = Math.max(totalSeconds, timeline.totalSeconds);
    const volume = musicClampPartVolume(part.volume);
    for (const event of timeline.events){
      events.push(Object.assign({}, event, {
        gain:event.gain * volume,
        timbre:part.timbre,
        partId:part.id,
        partName:part.name
      }));
    }
  }
  events.sort((a, b) => a.start - b.start || String(a.partId).localeCompare(String(b.partId))
    || a.staff.localeCompare(b.staff) || a.voice - b.voice);
  return Object.assign({}, base, {
    totalSeconds, events,
    parts:selectedParts.map((part) => ({ id:part.id, name:part.name, timbre:part.timbre,
      volume:musicClampPartVolume(part.volume), muted:part.muted === true }))
  });
}

/* ----- 따라치기(음 맞추기) 순서 -----
   재생 타임라인을 "동시에 울리는 음 묶음" 하나씩으로 잘라, 학생이 눌러야 할 차례를 만든다.
   코드 따라치기(python-editor.js)의 교본 문자열에 해당하는 자리다.
   - `pcs` 는 옥타브를 뺀 음이름(0=도 … 11=시). 옥타브를 통과시키는 채점은 이 값만 본다.
   - 쉼표만 있는 자리는 `auto:true` 로 남겨 도달하는 순간 그냥 지나간다
     — 코드 따라치기가 줄 앞 들여쓰기를 자동으로 넘기는 것과 같은 규칙이다.
   - 도돌이는 펼치지 않는다(`repeats:false`). 같은 음표가 두 번 나오면 화면의 맞음·틀림 표시가
     서로를 덮어써 지금 어디를 누르고 있는지 알 수 없게 된다.
   - 붙임줄로 이어진 음은 타임라인이 이미 하나로 합쳤다(`tiedIds`). 학생은 한 번만 누른다. */
function musicPitchClass(midi){
  const value = Math.round(Number(midi));
  return Number.isFinite(value) ? ((value % 12) + 12) % 12 : null;
}

/* 음이름(0~11)을 사람이 읽는 계이름으로. 검은건반은 악보 조표와 상관없이 ♯ 쪽 이름으로 안내한다.
   따라치기와 음감 테스트가 같은 이름을 써야 해서(둘 다 "지금 누른 음"을 말로 알려 준다) 모델에 둔다. */
const MUSIC_PC_LABELS = ["도", "도♯", "레", "레♯", "미", "파", "파♯", "솔", "솔♯", "라", "라♯", "시"];

function musicPracticeSteps(sheet, opts){
  const options = opts || {};
  const timeline = musicTimeline(sheet, {
    from:options.from, to:options.to, staff:options.staff, partId:options.partId, repeats:false
  });
  const groups = [];
  let group = null;
  for (const event of timeline.events){
    if (!group || Math.abs(event.start - group.start) > 1e-6){
      group = { start:event.start, measure:event.measure, events:[] };
      groups.push(group);
    }
    group.events.push(event);
  }
  const steps = [];
  for (const item of groups){
    const sounded = item.events.filter((event) => !event.rest && event.midi !== null);
    // 같은 자리에 소리 나는 음이 하나라도 있으면 다른 성부의 쉼표는 묻힌다(누를 것이 있는 차례다).
    const source = sounded.length ? sounded : item.events;
    const noteIds = [], midis = [], pcs = [];
    for (const event of source){
      for (const id of (event.tiedIds || [event.id])) if (!noteIds.includes(id)) noteIds.push(id);
      if (event.rest || event.midi === null) continue;
      if (!midis.includes(event.midi)) midis.push(event.midi);
      const pc = musicPitchClass(event.midi);
      if (!pcs.includes(pc)) pcs.push(pc);
    }
    steps.push({
      index:steps.length, auto:!sounded.length, start:item.start, measure:item.measure,
      noteIds, midis:midis.sort((a, b) => a - b), pcs:pcs.sort((a, b) => a - b)
    });
  }
  return { steps, total:steps.reduce((count, step) => count + (step.auto ? 0 : 1), 0) };
}

/* ===== 음감 테스트 — 소리만 듣고 음이름 맞히기 =====
   따라치기가 "악보를 보고 누르기"라면 이쪽은 "악보를 보지 않고 듣고 맞히기"다.
   문제는 악보와 무관한 무작위 음이라 여기까지가 순수 로직이고(화면·소리는 music-eartest.js),
   rng 를 주입받게 만들어 node 에서 규칙을 그대로 검증한다.

   음역을 도4~시5 두 옥타브로 좁힌 이유: 앱 음역(G3~C6) 안이면서 옥타브가 정확히 둘이라
   4단계의 "옥타브까지 맞히기"가 4·5 둘 중 하나로 떨어진다. 반옥타브가 끼면 문항마다
   고를 수 있는 옥타브 수가 달라져 정답률을 비교할 수 없다. */
const MUSIC_EAR_LEVELS = [
  { id:1, label:"1단계 · 흰건반 한 옥타브", black:false, low:60, high:71, octaveAnswer:false },
  { id:2, label:"2단계 · 흰건반 두 옥타브", black:false, low:60, high:83, octaveAnswer:false },
  { id:3, label:"3단계 · 검은건반까지",      black:true,  low:60, high:83, octaveAnswer:false },
  { id:4, label:"4단계 · 옥타브까지",        black:true,  low:60, high:83, octaveAnswer:true }
];
const MUSIC_EAR_COUNTS = [5, 10, 20];
const MUSIC_EAR_DEFAULT_COUNT = 10;
const MUSIC_EAR_MAX_COUNT = 50;
const MUSIC_EAR_BLACK_PCS = [1, 3, 6, 8, 10];

function musicEarLevel(id){
  const want = Math.round(Number(id));
  return MUSIC_EAR_LEVELS.find((level) => level.id === want) || MUSIC_EAR_LEVELS[0];
}

// 이 단계에서 나올 수 있는 음 전부(MIDI 번호). 문제는 여기서만 뽑는다.
function musicEarPool(levelId){
  const level = musicEarLevel(levelId);
  const pool = [];
  for (let midi = level.low; midi <= level.high; midi++){
    if (!level.black && MUSIC_EAR_BLACK_PCS.includes(musicPitchClass(midi))) continue;
    pool.push(midi);
  }
  return pool;
}

function musicEarOctaves(levelId){
  const level = musicEarLevel(levelId);
  const octaves = [];
  for (let octave = Math.floor(level.low / 12) - 1; octave <= Math.floor(level.high / 12) - 1; octave++){
    octaves.push(octave);
  }
  return octaves;
}

function musicEarPick(pool, rng){
  const index = Math.floor(rng() * pool.length);
  return pool[Math.max(0, Math.min(pool.length - 1, index))];
}

function musicEarQuestions(opts){
  const options = opts || {};
  const level = musicEarLevel(options.level);
  const count = Math.max(1, Math.min(MUSIC_EAR_MAX_COUNT,
    Math.round(Number(options.count) || MUSIC_EAR_DEFAULT_COUNT)));
  const rng = typeof options.rng === "function" ? options.rng : Math.random;
  const pool = musicEarPool(level.id);
  const questions = [];
  let previous = null;
  for (let index = 0; index < count; index++){
    let midi = musicEarPick(pool, rng);
    // 사용자가 내야 하는 답이 연달아 같으면 "직전과 같은지"만 들어도 맞힐 수 있다.
    // 1~3단계는 음이름(pc), 4단계는 옥타브까지 포함한 MIDI 번호를 기준으로 다시 뽑는다.
    const repeatsAnswer = previous !== null && (level.octaveAnswer
      ? midi === previous : musicPitchClass(midi) === musicPitchClass(previous));
    if (repeatsAnswer && pool.length > 1){
      const alternatives = pool.filter((value) => level.octaveAnswer
        ? value !== previous : musicPitchClass(value) !== musicPitchClass(previous));
      if (alternatives.length) midi = musicEarPick(alternatives, rng);
    }
    previous = midi;
    questions.push({ index, midi, pc:musicPitchClass(midi), octave:Math.floor(midi / 12) - 1 });
  }
  return { level, count, questions };
}

/* 문제 사이에 끼우는 간섭음. 방금 들은 음의 잔상으로 다음 음을 '견주어' 맞히면 절대음감이
   아니라 상대음감을 재는 셈이라, 조성이 생기지 않는 반음·트라이톤 덩어리를 문제 음역
   아래에서 짧게 울려 귀를 지운다. */
function musicEarDistractor(rng){
  const random = typeof rng === "function" ? rng : Math.random;
  const base = 43 + Math.floor(random() * 6);      // G2~C3 — 문제 음역(도4~시5)과 겹치지 않는다
  return [base, base + 1, base + 6, base + 11];
}

// 기준음(상대음감 모드에서 시작 전에 들려준다). 가온다(C4).
const MUSIC_EAR_REFERENCE_MIDI = 60;

function musicEarJudge(question, answer, levelId){
  const level = musicEarLevel(levelId);
  const want = question || {};
  const given = answer || {};
  const pcOk = musicPitchClass(given.pc) === want.pc;
  const octaveOk = !level.octaveAnswer || Math.round(Number(given.octave)) === want.octave;
  return { correct:pcOk && octaveOk, pcOk, octaveOk, needsOctave:level.octaveAnswer };
}

/* 성적표. 정확도·반응 시간과 함께 "무엇을 무엇으로 들었는지"를 센다 —
   교실에서 제일 쓸모 있는 값이라 상위 세 짝만 추려 돌려준다. */
function musicEarSummary(records){
  const list = Array.isArray(records) ? records : [];
  const answered = list.filter((item) => item && item.answered !== false);
  const correct = answered.filter((item) => item.correct).length;
  const times = answered.map((item) => Math.max(0, Math.round(Number(item.ms) || 0)));
  const confusion = new Map();
  for (const item of answered){
    if (item.correct || !Number.isFinite(item.answerPc)) continue;
    const key = item.pc + ">" + item.answerPc;
    confusion.set(key, (confusion.get(key) || 0) + 1);
  }
  const confusions = [...confusion.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split(">").map(Number);
      return { from, to, count, label:`${MUSIC_PC_LABELS[from]}→${MUSIC_PC_LABELS[to]}` };
    })
    .sort((a, b) => b.count - a.count || a.from - b.from || a.to - b.to);
  return {
    total:list.length,
    answered:answered.length,
    correct,
    wrong:answered.length - correct,
    accuracy:answered.length ? Math.round((correct / answered.length) * 100) : 0,
    avgMs:times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : 0,
    bestMs:times.length ? Math.min(...times) : 0,
    replays:answered.reduce((sum, item) => sum + (Math.round(Number(item.replays)) || 0), 0),
    confusions:confusions.slice(0, 3)
  };
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
  const partMeasures = musicParts(sheet).length
    ? (musicSyncActivePart(sheet), musicParts(sheet).map((part) => part.measures))
    : [Array.isArray(sheet.measures) ? sheet.measures : []];
  for (const measures of partMeasures) for (const measure of measures){
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
  const partMeasures = musicParts(sheet).length
    ? (musicSyncActivePart(sheet), musicParts(sheet).map((part) => part.measures))
    : [Array.isArray(sheet.measures) ? sheet.measures : []];
  for (const measures of partMeasures) for (const measure of measures){
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
  for (const measures of partMeasures) for (const measure of measures){
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

function musicNormalizePart(raw, fallbackName){
  if (!raw || typeof raw !== "object") return null;
  const measures = (Array.isArray(raw.measures) ? raw.measures : []).map(musicNormalizeMeasure);
  if (measures.length) measures[0].lineBreakBefore = false;
  const grandStaff = raw.grandStaff === true || measures.some((measure) =>
    measure.bassNotes.length > 0 || measure.bassVoice2Notes.length > 0);
  return musicPart(musicClampText(raw.name, 80) || fallbackName || "악기", {
    id:raw.id,
    timbre:MUSIC_TIMBRES.includes(raw.timbre) ? raw.timbre : "piano",
    volume:raw.volume,
    muted:raw.muted === true,
    grandStaff,
    measures:measures.length ? measures : [musicMeasure()]
  });
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
  const legacyGrandStaff = raw.grandStaff === true || measures.some((measure) =>
    measure.bassNotes.length > 0 || measure.bassVoice2Notes.length > 0);
  const legacyTimbre = (version === 1 && raw.timbre === "triangle")
    ? "piano" : (MUSIC_TIMBRES.includes(raw.timbre) ? raw.timbre : "piano");
  let parts = [];
  if (version >= 8 && Array.isArray(raw.parts)){
    parts = raw.parts.map((part, index) => musicNormalizePart(part, `악기 ${index + 1}`)).filter(Boolean);
  }
  if (!parts.length){
    parts = [musicPart(legacyTimbre === "piano" ? "피아노" : "악기 1", {
      timbre:legacyTimbre, volume:1, grandStaff:legacyGrandStaff,
      measures:measures.length ? measures : [musicMeasure()]
    })];
  }
  const activePart = parts.find((part) => part.id === raw.activePartId) || parts[0];
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
    grandStaff:activePart.grandStaff === true,
    // v1의 triangle 은 당시 새 악보 기본값이었다. v2에서 실제 피아노가 기본이 되었으므로
    // 기존 악보도 별도 설정 없이 개선된 소리를 듣도록 자동 이전한다.
    timbre:activePart.timbre,
    drumStyle:musicDrumStyle(raw.drumStyle),
    drumVolume:musicClampDrumVolume(raw.drumVolume),
    accompanimentMode:musicAccompanimentMode(raw.accompanimentMode),
    accompanimentTimbre:musicAccompanimentTimbre(raw.accompanimentTimbre),
    showSolfege:raw.showSolfege !== false,
    measures:activePart.measures,
    parts,
    activePartId:activePart.id
  };
}

function musicSerializePartMeasures(measures, grandStaff){
  const serializeNote = (note) => {
    const outNote = note.rest
      ? { id:String(note.id || musicId("n")), rest:true, value:note.value, dots:musicClampDots(note.dots) }
      : { id:String(note.id || musicId("n")), rest:false, step:note.step,
          octave:Math.round(Number(note.octave) || 4), alter:musicClampAlter(note.alter),
          value:note.value, dots:musicClampDots(note.dots) };
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
  return (Array.isArray(measures) ? measures : []).map((measure, index) => {
    const outMeasure = { id:String(measure && measure.id || musicId("m")) };
    if (index > 0 && measure && measure.lineBreakBefore === true) outMeasure.lineBreakBefore = true;
    if (measure && measure.repeatStart === true) outMeasure.repeatStart = true;
    if (measure && measure.repeatEnd === true) outMeasure.repeatEnd = true;
    if (measure && (measure.ending === 1 || measure.ending === 2)) outMeasure.ending = measure.ending;
    if (Math.round(Number(measure && measure.pickupTicks) || 0) > 0) outMeasure.pickupTicks = Math.round(Number(measure.pickupTicks));
    if (musicNormalizeTime(measure && measure.timeChange)) outMeasure.timeChange = musicNormalizeTime(measure.timeChange);
    if (measure && MUSIC_KEYS[measure.keyChange]) outMeasure.keyChange = measure.keyChange;
    if (measure && Number(measure.tempoChange) > 0) outMeasure.tempoChange = musicClampTempo(measure.tempoChange);
    outMeasure.notes = musicStaffNotes(measure, "treble").map(serializeNote);
    const voice2Notes = musicVoiceNotes(measure, "treble", 2);
    if (voice2Notes.length) outMeasure.voice2Notes = voice2Notes.map(serializeNote);
    const bassNotes = musicStaffNotes(measure, "bass");
    if (grandStaff === true || bassNotes.length) outMeasure.bassNotes = bassNotes.map(serializeNote);
    const bassVoice2Notes = musicVoiceNotes(measure, "bass", 2);
    if (bassVoice2Notes.length) outMeasure.bassVoice2Notes = bassVoice2Notes.map(serializeNote);
    return outMeasure;
  });
}

// 같은 모델은 언제나 같은 바이트로 — 키 순서를 코드로 고정한다(불필요한 파일 변경·diff 방지).
function musicSerialize(sheet){
  const model = sheet || musicEmpty();
  musicSyncActivePart(model);
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
    drumStyle:musicDrumStyle(model.drumStyle),
    drumVolume:musicClampDrumVolume(model.drumVolume),
    accompanimentMode:musicAccompanimentMode(model.accompanimentMode),
    accompanimentTimbre:musicAccompanimentTimbre(model.accompanimentTimbre),
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
  const activePart = musicActivePart(model);
  out.activePartId = activePart ? activePart.id : "";
  out.parts = musicParts(model).map((part) => ({
    id:String(part.id || musicId("part")),
    name:musicClampText(part.name, 80) || "악기",
    timbre:MUSIC_TIMBRES.includes(part.timbre) ? part.timbre : "piano",
    volume:musicClampPartVolume(part.volume),
    muted:part.muted === true,
    grandStaff:part.grandStaff === true,
    measures:musicSerializePartMeasures(part.measures, part.grandStaff)
  }));
  return JSON.stringify(out, null, 2);
}

function musicScratchFileName(n){
  return n && n > 1 ? "악보 " + n + ".msheet" : "악보.msheet";
}
