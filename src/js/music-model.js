"use strict";

/* ===== .msheet 악보 문서 — 모델 (P0) =====
   - 저장 포맷: UTF-8 JSON 한 개(format:"manneung-sheet"). 동요 수준 단선율 한 성부.
   - 이 파일은 순수 모델이다. DOM·오디오·VexFlow 를 일절 참조하지 않는다
     (그래야 node --test 로 조판·소리 없이 규칙을 검증할 수 있다).
   - 이름을 music* 로 잡은 이유: 이 코드베이스에서 sheet* 는 이미 스프레드시트를 뜻한다
     (spreadsheet-viewer.js 의 sheetBaseName 등). 파일 확장자만 .msheet 이고 코드는 music* 로 통일한다.
   설계: docs/악보-설계.md */

const MUSIC_FORMAT = "manneung-sheet";
const MUSIC_VERSION = 2;

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

// 조표 — 설계대로 #·b 각각 2개까지. alterations 는 "그 음이름은 기본으로 이만큼 변한다".
const MUSIC_KEYS = {
  C:  { label:"다장조",  vex:"C",  alterations:{} },
  G:  { label:"사장조",  vex:"G",  alterations:{ F:1 } },
  D:  { label:"라장조",  vex:"D",  alterations:{ F:1, C:1 } },
  F:  { label:"바장조",  vex:"F",  alterations:{ B:-1 } },
  Bb: { label:"내림나장조", vex:"Bb", alterations:{ B:-1, E:-1 } }
};

const MUSIC_TIMBRES = ["piano", "guitar", "triangle", "sine", "square"];
const MUSIC_TEMPO_MIN = 40;
const MUSIC_TEMPO_MAX = 208;
const MUSIC_DEFAULT_TEMPO = 100;

// 동요 음역: 덧줄 2개 안쪽(높은음자리표 기준 C4~A5)을 기본으로 두되,
// 파일에서 읽을 때는 조금 넉넉히 받아 준다(다른 곳에서 만든 파일을 거절하지 않으려고).
const MUSIC_RANGE_MIN_MIDI = 55;   // G3
const MUSIC_RANGE_MAX_MIDI = 84;   // C6

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
  return note;
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
  return {
    id:musicId("m"),
    notes:Array.isArray(notes) ? notes : [],
    lineBreakBefore:o.lineBreakBefore === true
  };
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
    timbre:"piano",
    showSolfege:true,
    measures:[musicMeasure(), musicMeasure(), musicMeasure(), musicMeasure()]
  };
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
  return (spec.ticks * (Math.pow(2, dots + 1) - 1)) / Math.pow(2, dots);
}

function musicMeasureTicks(time){
  const beats = Math.max(1, Math.round(Number(time && time.beats) || 4));
  const beatValue = Math.max(1, Math.round(Number(time && time.beatValue) || 4));
  return beats * ((MUSIC_TICKS_PER_QUARTER * 4) / beatValue);
}

function musicMeasureUsedTicks(measure){
  if (!measure || !Array.isArray(measure.notes)) return 0;
  let total = 0;
  for (const note of measure.notes) total += musicNoteTicks(note);
  return total;
}

/* ----- 검사 -----------------------------------------------------------------
   저장을 막지는 않는다(작성 중인 악보도 저장돼야 한다). 편집기가 경고만 띄운다.
   · 아직 아무것도 넣지 않은 빈 마디는 "작성 전"이라 문제 삼지 않는다.
   · 마지막 마디의 덜 참은 허용한다(끝마디는 짧을 수 있다). */

function musicValidate(sheet){
  const issues = [];
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  const expected = musicMeasureTicks(sheet && sheet.time);
  measures.forEach((measure, index) => {
    const used = musicMeasureUsedTicks(measure);
    if (used === 0) return;
    if (used > expected) issues.push({ measure:index + 1, kind:"over", expected, actual:used });
    else if (used < expected && index < measures.length - 1){
      issues.push({ measure:index + 1, kind:"under", expected, actual:used });
    }
  });
  return { ok:issues.length === 0, issues };
}

// 이 음표를 그 마디에 더 넣을 수 있는지(편집기가 입력을 막는 기준).
function musicCanFit(sheet, measureIndex, note){
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  const measure = measures[measureIndex];
  if (!measure) return false;
  return musicMeasureUsedTicks(measure) + musicNoteTicks(note) <= musicMeasureTicks(sheet && sheet.time);
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

function musicVexNote(note, key){
  const value = MUSIC_NOTE_VALUES[note && note.value] || MUSIC_NOTE_VALUES.quarter;
  const dots = musicClampDots(note && note.dots);
  if (!note || note.rest){
    // 쉼표는 높은음자리표에서 b/4 자리에 그린다(VexFlow 관례).
    return { keys:["b/4"], duration:value.vex + "r", dots, rest:true, accidental:null };
  }
  const alter = musicClampAlter(note.alter);
  const mark = alter === 0 ? "" : alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
  const keyAlter = musicKeyAlterations(key)[note.step] || 0;
  return {
    keys:[note.step.toLowerCase() + mark + "/" + note.octave],
    duration:value.vex,
    dots,
    rest:false,
    accidental:alter === keyAlter ? null : musicAccidentalSymbol(alter)
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

function musicDiatonicValue(note){
  if (!note || MUSIC_DIATONIC_STEPS[note.step] === undefined) return null;
  return Math.round(Number(note.octave) || 0) * 7 + MUSIC_DIATONIC_STEPS[note.step];
}

function musicPitchFromDiatonic(value){
  const v = Math.round(Number(value) || 0);
  return { step:MUSIC_STEPS[((v % 7) + 7) % 7], octave:Math.floor(v / 7) };
}

// 오선 줄 값(0=맨 윗줄, 0.5=그 아래 칸 …) → 음높이. 0.5 단위로 맞춰 받는다.
function musicPitchFromStaveLine(lineValue){
  return musicPitchFromDiatonic(MUSIC_TREBLE_TOP_DIATONIC - Math.round(Number(lineValue) * 2));
}

function musicStaveLineForNote(note){
  const diatonic = musicDiatonicValue(note);
  return diatonic === null ? null : (MUSIC_TREBLE_TOP_DIATONIC - diatonic) / 2;
}

function musicMidiInRange(midi){
  return Number.isFinite(midi) && midi >= MUSIC_RANGE_MIN_MIDI && midi <= MUSIC_RANGE_MAX_MIDI;
}

/* 음표를 흰건반 기준으로 steps 만큼 올리고 내린다(↑↓ 한 음씩, Shift 면 한 옥타브).
   음역을 벗어나면 null 을 준다 — 호출부가 "더 못 올라가요"로 처리한다.
   임시표(alter)는 그대로 들고 간다: 사장조에서 F#을 올리면 G#이 아니라 G 가 되는 게 아니라
   같은 임시표를 유지한 G# 이 된다. 교실에서 쓰기엔 이 규칙이 예측 가능하다. */
function musicShiftPitch(note, steps){
  const diatonic = musicDiatonicValue(note);
  if (diatonic === null) return null;
  const moved = musicPitchFromDiatonic(diatonic + Math.round(Number(steps) || 0));
  const midi = musicMidiNumber({ step:moved.step, octave:moved.octave, alter:musicClampAlter(note.alter) });
  return musicMidiInRange(midi) ? moved : null;
}

/* ----- 재생 타임라인 ----------------------------------------------------------
   모델 → "몇 초에 어떤 주파수를 얼마 동안" 목록. 실시간 재생과 WAV 저장이 같은 목록을 쓴다.
   from·to 는 1부터 세는 마디 번호(양끝 포함). 부분 재생은 그 구간만 잘라 0초부터 다시 센다.
   tempo 는 4분음표 기준 BPM 이다(6/8 도 ♩ 기준으로 읽는다 — 설계 결정). */

function musicTimeline(sheet, opts){
  const options = opts || {};
  const measures = (sheet && Array.isArray(sheet.measures)) ? sheet.measures : [];
  const tempo = musicClampTempo(sheet && sheet.tempo);
  const secondsPerTick = 60 / tempo / MUSIC_TICKS_PER_QUARTER;
  const fullMeasure = musicMeasureTicks(sheet && sheet.time);

  const first = Math.max(1, Math.round(Number(options.from) || 1));
  const last = Math.min(measures.length, Math.round(Number(options.to) || measures.length));

  const events = [];
  let cursor = 0;
  for (let index = first - 1; index <= last - 1; index++){
    const measure = measures[index];
    if (!measure) continue;
    const measureStart = cursor;
    for (const note of (Array.isArray(measure.notes) ? measure.notes : [])){
      const ticks = musicNoteTicks(note);
      if (ticks <= 0) continue;
      const midi = musicMidiNumber(note);
      events.push({
        id:note.id,
        measure:index + 1,
        rest:!!note.rest || midi === null,
        midi:note.rest ? null : midi,
        frequency:note.rest || midi === null ? 0 : musicFrequency(midi),
        start:cursor * secondsPerTick,
        duration:ticks * secondsPerTick
      });
      cursor += ticks;
    }
    // 덜 찬 마디도 마디 길이만큼은 흐르게 한다(빈 마디를 건너뛰면 박자가 어긋난다).
    const used = cursor - measureStart;
    if (used < fullMeasure) cursor = measureStart + fullMeasure;
  }
  return { tempo, secondsPerTick, totalSeconds:cursor * secondsPerTick, events };
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
    for (const note of (Array.isArray(measure.notes) ? measure.notes : [])){
      if (note.rest) continue;
      const wasDefault = musicClampAlter(note.alter) === (before[note.step] || 0);
      if (!wasDefault) continue;                       // 임시표를 일부러 적은 음은 건드리지 않는다
      const next = after[note.step] || 0;
      if (next !== musicClampAlter(note.alter)){ note.alter = next; changed++; }
    }
  }
  sheet.key = nextKey;
  return changed;
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
  const count = (measure && Array.isArray(measure.notes)) ? measure.notes.length : 0;
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
    const rest = musicRest(raw.value, dots, { xOffset:raw.xOffset });
    if (typeof raw.id === "string" && raw.id) rest.id = raw.id.slice(0, 80);
    return rest;
  }
  if (MUSIC_STEP_SEMITONES[raw.step] === undefined) throw new Error("지원하지 않는 음이름: " + raw.step);
  const octave = Math.round(Number(raw.octave));
  if (!Number.isFinite(octave) || octave < 0 || octave > 9) throw new Error("음높이가 범위를 벗어났습니다.");
  const note = musicNote(raw.step, octave, { alter:raw.alter, value:raw.value, dots, xOffset:raw.xOffset });
  if (typeof raw.id === "string" && raw.id) note.id = raw.id.slice(0, 80);
  return note;
}

function musicNormalizeMeasure(raw){
  const notes = [];
  const rawNotes = (raw && Array.isArray(raw.notes)) ? raw.notes : [];
  for (const rawNote of rawNotes){
    const note = musicNormalizeNote(rawNote);
    if (note) notes.push(note);
  }
  const measure = musicMeasure(notes, { lineBreakBefore:raw && raw.lineBreakBefore === true });
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
    clef:"treble",                                        // 1차는 높은음자리표 하나만
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
    timbre:MUSIC_TIMBRES.includes(model.timbre) ? model.timbre : "piano",
    showSolfege:model.showSolfege !== false,
    measures:(Array.isArray(model.measures) ? model.measures : []).map((measure, index) => {
      const outMeasure = { id:String(measure && measure.id || musicId("m")) };
      // 기존 .msheet와 불필요한 diff를 만들지 않도록 수동 줄바꿈이 있을 때만 기록한다.
      if (index > 0 && measure && measure.lineBreakBefore === true) outMeasure.lineBreakBefore = true;
      outMeasure.notes = ((measure && Array.isArray(measure.notes)) ? measure.notes : []).map(note => {
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
        return outNote;
      });
      return outMeasure;
    })
  };
  return JSON.stringify(out, null, 2);
}

function musicScratchFileName(n){
  return n && n > 1 ? "악보 " + n + ".msheet" : "악보.msheet";
}
