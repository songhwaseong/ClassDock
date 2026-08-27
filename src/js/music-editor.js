"use strict";

/* ===== .msheet 악보 문서 — 화면·편집 (P1 보기 + P2 편집) =====
   - 열기·저장, VexFlow 조판, 도구상자로 음표 넣고 지우기, 음표 클릭 미리듣기,
     전체·부분 재생, WAV 저장, 되돌리기를 담당한다.
   - 조판은 VexFlow 에 맡기고(꼬리 잇기·간격 배분), 소리는 MNMusicAudio,
     음악 규칙(틱·음높이·오선 자리)은 music-model.js 가 갖는다. 여기는 화면과 조작만 안다.
   - VexFlow(약 710KB)는 시작할 때 싣지 않고 이 문서를 열 때 MNLazy 로 처음 불러온다.
   설계: docs/악보-설계.md */

const MUSIC_LINE_HEIGHT = 205;      // 가사·셈여림·페달 표시가 다음 단과 겹치지 않을 간격
const MUSIC_GRAND_LINE_HEIGHT = 330;
const MUSIC_STAFF_GAP = 92;
const MUSIC_SCORE_MIN_WIDTH = 480;
const MUSIC_REDRAW_DELAY = 180;     // 창 크기 변경 뒤 다시 그리기까지(매 픽셀마다 재조판하면 무겁다)
const MUSIC_RECOVERY_DELAY = 1500;  // 편집이 멈춘 뒤 복구본을 남기기까지(.mnote 와 같은 간격)
const MUSIC_ZOOM_MIN = 0.5;
const MUSIC_ZOOM_MAX = 2;
const MUSIC_ZOOM_STEP = 0.1;
const MUSIC_TIME_CHOICES = ["2/4", "3/4", "4/4", "6/8"];
// 조옮김 메뉴에 세울 간격. 반음 수만 넘기면 새 조표와 적는 법은 music-model.js 가 정한다.
const MUSIC_TRANSPOSE_CHOICES = [
  { semitones:1,  label:"반음(단2도)" },
  { semitones:2,  label:"온음(장2도)" },
  { semitones:3,  label:"단3도" },
  { semitones:4,  label:"장3도" },
  { semitones:5,  label:"완전4도" },
  { semitones:7,  label:"완전5도" },
  { semitones:12, label:"한 옥타브" }
];
const MUSIC_TYPING_DELAY = 600;     // 제목 타자를 한 단계로 묶는 시간
const MUSIC_HISTORY_LIMIT = 200;    // 악보 JSON 은 가벼워서 깊게 쌓아도 된다
const MUSIC_TOOL_VALUES = [
  { value:"whole",   label:"온" },
  { value:"half",    label:"2분" },
  { value:"quarter", label:"4분" },
  { value:"eighth",  label:"8분" },
  { value:"16th",    label:"16분" }
];
const MUSIC_SOLFEGE_LABELS = { C:"도", D:"레", E:"미", F:"파", G:"솔", A:"라", B:"시" };

/* 작곡·따라치기·음감 테스트가 같은 악보 자판 설정을 쓴다. 실제 키 배열은 state.js 의
   MUSIC_KEYBOARD_DEFINITIONS/appSettings.musicKeyboard 에 있고, 여기서는 음높이로만 바꾼다. */
const MUSIC_KEYBOARD_PITCH_CLASSES = Object.freeze(Object.fromEntries(
  MUSIC_KEYBOARD_DEFINITIONS.filter((item) => Number.isFinite(item.pitchClass))
    .map((item) => [item.id, item.pitchClass])
));
const MUSIC_KEYBOARD_NOTE_VALUES = Object.freeze({
  noteWhole:"whole", noteHalf:"half", noteQuarter:"quarter", noteEighth:"eighth", noteSixteenth:"16th"
});
const MUSIC_KEYBOARD_ACCIDENTALS = Object.freeze({
  accidentalFlat:-1, accidentalNatural:0, accidentalSharp:1
});
const MUSIC_KEYBOARD_DURATION_ORDER = Object.freeze(["16th", "eighth", "quarter", "half", "whole"]);
const MUSIC_PRACTICE_DIGIT_KEYS = Object.freeze({
  Digit1:0, Digit2:2, Digit3:4, Digit4:5, Digit5:7, Digit6:9, Digit7:11
});
function musicKeyboardPitchClassForEvent(event){
  const action = musicKeyboardActionForEvent(event, appSettings.musicKeyboard);
  const pitchClass = MUSIC_KEYBOARD_PITCH_CLASSES[action];
  if (Number.isFinite(pitchClass)) return pitchClass;
  return event && event.code ? MUSIC_PRACTICE_DIGIT_KEYS[event.code] : undefined;
}
// 음감 테스트 4단계에서 옥타브를 받는 숫자키. 이때는 숫자가 음이름이 아니라 옥타브다.
const MUSIC_EAR_OCTAVE_KEYS = { Digit3:3, Digit4:4, Digit5:5, Digit6:6 };
const MUSIC_IMAGE_SCALE = 2;        // 메모 그림은 2배로 구워 확대해도 뭉개지지 않게 한다
const MUSIC_IMAGE_TOP_PAD = 26;     // 화음기호·빠르기 표시는 오선 위에 붙는다 — 단 위쪽 여유
// 브라우저마다 캔버스 한 변·전체 픽셀 한계가 다르다. 보수적인 공통 범위 안에서만 굽고,
// 긴 악보는 2배보다 낮춰 담되 글자를 읽기 어려운 배율까지 억지로 줄이지 않는다.
const MUSIC_IMAGE_MAX_SIDE = 16384;
const MUSIC_IMAGE_MAX_PIXELS = 16 * 1024 * 1024;
const MUSIC_IMAGE_MIN_SCALE = 0.75;
let _musicScratchCount = 0;

function musicSafeImageScale(width, height){
  const w = Number(width), h = Number(height);
  if (!(w > 0) || !(h > 0)) return 0;
  return Math.min(MUSIC_IMAGE_SCALE, MUSIC_IMAGE_MAX_SIDE / w, MUSIC_IMAGE_MAX_SIDE / h,
    Math.sqrt(MUSIC_IMAGE_MAX_PIXELS / (w * h)));
}

/* ===== 악보 그림(메모로 보내기) =====
   VexFlow 5 는 음표를 Bravura 글꼴의 "글자"로 그리고, 그 글꼴은 new FontFace 로 이 문서에만
   등록된다. 그래서 SVG 를 떼어내 <img> 로 구우면 그 그림 문서에는 글꼴이 없어 음표가 전부
   깨진다(인쇄를 새 창이 아니라 같은 문서 안에서 하는 이유와 같다). vendor 원문에서 글꼴
   데이터를 뽑아 복제 SVG 안에 @font-face 로 심으면 네트워크 없이 그대로 구울 수 있다.
   MNLazy.source 는 단일 파일(내장 블록)·서버 서빙 두 모드 모두에서 원문을 돌려준다. */
let musicFontCssTask = null;
function musicEmbeddedFontCss(){
  if (musicFontCssTask) return musicFontCssTask;
  musicFontCssTask = MNLazy.source("vexflow-bravura.min.js").then((text) => {
    const rules = [];
    const seen = new Set();
    // 번들 안의 등록 구문: Font.load("Bravura","data:font/woff2;…base64,…",{…})
    const pattern = /"(Bravura|Academico)","(data:font\/woff2;[^"]+)"/g;
    let match;
    while ((match = pattern.exec(text))){
      if (seen.has(match[1])) continue;      // 같은 글꼴의 굵기·기울임 변형은 첫 벌만 쓴다
      seen.add(match[1]);
      rules.push(`@font-face{font-family:"${match[1]}";src:url("${match[2]}") format("woff2")}`);
    }
    return seen.has("Bravura") ? rules.join("\n") : "";
  }).catch((error) => {
    console.warn("악보 글꼴을 그림에 심지 못했어요:", error);
    return "";
  });
  return musicFontCssTask;
}

/* 계이름·가사 같은 덧글자는 styles.css 의 클래스에서 색과 크기를 받는다. SVG 를 문서 밖으로
   떼어내면 그 규칙이 사라지므로 그림에 필요한 것만 함께 심는다(커서·선택 색은 뺀다). */
const MUSIC_IMAGE_CSS = [
  ".music-solfege{font-family:'Noto Sans KR','Malgun Gothic',sans-serif;font-size:13px;font-weight:700;fill:#2563eb;stroke:none}",
  ".music-chord-symbol{font-family:'Noto Sans KR','Malgun Gothic',sans-serif;font-size:14px;font-weight:700;font-style:italic;fill:#111;stroke:none}",
  ".music-notation,.music-measure-setting{font-family:'Noto Sans KR','Malgun Gothic',sans-serif;fill:#111;stroke:none}",
  ".music-lyric{font-size:13px}.music-dynamic{font-size:15px;font-weight:700}.music-fingering{font-size:12px;font-weight:700}",
  ".music-articulation{font-size:16px;font-weight:800}.music-pedal{font-size:13px}.music-measure-setting{font-size:11px;font-weight:700}",
  ".music-slur{fill:none;stroke:#111;stroke-width:1.4;stroke-linecap:round}"
].join("\n");

function musicRangeLabel(indexes){
  const first = indexes[0] + 1;
  const last = indexes[indexes.length - 1] + 1;
  return first === last ? `${first}마디` : `${first}~${last}마디`;
}

/* ===== 열기 ===== */
async function loadMusicSheet(file, opts = {}){
  let sheet;
  try {
    sheet = musicParse(await file.text());
  } catch(error){
    if (typeof toast === "function") toast("악보(.msheet)를 읽지 못해 텍스트로 열었어요.", 3500);
    return typeof loadText === "function" ? loadText(file, opts) : null;
  }
  const doc = makeDoc("music", file.name, opts);
  doc.sheet = sheet;
  // 메모 이미지 블록에서 되살린 악보 — "메모로"를 누르면 새 블록을 만들지 않고 그 블록을 바꾼다.
  doc.memoBlockId = String(opts.memoBlockId || "") || null;
  doc.sourceFile = file;
  doc.savedText = musicSerialize(sheet);
  doc.render = async () => {
    if (doc._musicMounted) return;              // 편집·재생 상태를 잃지 않도록 한 번만 마운트
    doc.el.innerHTML = "";
    await mountMusicEditor(doc);
    doc._musicMounted = true;
  };
  if (typeof refreshChrome === "function") refreshChrome();
  if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
  return doc;
}

/* ===== 새 문서 만들기 ===== */
function newMusicScratch(){
  _musicScratchCount++;
  const name = musicScratchFileName(_musicScratchCount);
  const starter = musicSerialize(musicEmpty(name.replace(/\.msheet$/i, "")));
  if (typeof handleFiles === "function"){
    handleFiles([new File([starter], name, { type:"application/json" })], { isScratch:true });
  }
}
function newMusicScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, musicScratchFileName,
    (name) => musicSerialize(musicEmpty(name.replace(/\.msheet$/i, ""))),
    "application/json", "새 악보를");
}

/* 악보 내용 비교용 열쇠 — 만든·고친 시각은 뺀다. 저장할 때마다 updatedAt 이 바뀌므로 그것까지
   넣으면 내용이 똑같은 악보도 "다르다"고 잘못 판단한다. 읽지 못하면 빈 문자열을 돌려주고,
   부르는 쪽은 빈 값을 "같다"로 보지 않는다. */
function musicMemoContentKey(sheet){
  if (!sheet) return "";
  try {
    const raw = JSON.parse(musicSerialize(sheet));
    delete raw.createdAt;
    delete raw.updatedAt;
    return JSON.stringify(raw);
  } catch(error){
    console.warn("악보 내용을 비교하지 못했어요:", error);
    return "";
  }
}

/* 이 블록과 이미 이어져 있는 악보 탭을 만났을 때 — true 면 그 탭을 그대로 쓰고, false 면 메모
   그림의 스냅샷으로 새 탭을 연다(지도의 mapKeepOpenedMemoTab 과 같은 규약).
   내용이 다른데도 말없이 그 탭을 보여 주면 메모 그림과 딴판인 악보가 뜨고, 그렇다고 열린 탭을
   스냅샷으로 되돌리면 메모로 보낸 뒤의 편집이 사라진다. 그래서 그 갈림길만 사용자에게 묻는다. */
async function musicKeepOpenedMemoTab(opened, snapshot){
  const openedKey = musicMemoContentKey(opened && opened.sheet);
  const same = !!openedKey && openedKey === musicMemoContentKey(snapshot);
  if (!same && typeof confirmDialog === "function"){
    const openNew = await confirmDialog(
      "이미 열려 있는 '" + String((opened && opened.name) || "악보")
        + "' 탭이 이 메모 그림과 이어져 있는데, 그 악보는 그림과 내용이 달라요. 메모 그림의 악보를 새 탭으로 열까요?",
      "메모 그림으로 열기", "열린 탭 보기");
    if (openNew) return false;
  }
  if (typeof setActiveDoc === "function") setActiveDoc(opened.id);
  if (typeof toast === "function"){
    toast(same
      ? "이미 열려 있는 악보 탭으로 갔어요."
      : "이미 열려 있는 악보 탭으로 갔어요 — 이 탭의 악보는 메모 그림과 내용이 다릅니다.", 3600);
  }
  opened.memoReusedTab = true;      // 메모창이 "악보로 열었어요" 안내를 겹쳐 띄우지 않게
  return true;
}

/* 메모 이미지 블록의 "✏️ 악보로" — 그림과 함께 넣어 둔 악보 스냅샷을 새 탭으로 되살린다.
   options.state       — 메모 블록에 담긴 악보 객체(musicSerialize 형식)
   options.name        — 탭 이름(메모에 적힌 이름을 되살린다)
   options.memoBlockId — 돌아갈 메모 블록 id. 고친 뒤 "메모로"를 누르면 그 블록을 제자리에서 바꾼다. */
async function openMusicSheetFromMemo(options = {}){
  const blockId = String(options.memoBlockId || "");
  // 같은 블록을 두 탭으로 열면 둘 다 그 블록을 덮어써 나중 것이 앞의 편집을 지운다.
  const opened = (typeof docs !== "undefined" ? docs : []).find((item) =>
    item && item.kind === "music" && blockId && item.memoBlockId === blockId);
  let snapshot;
  try { snapshot = musicParse(JSON.stringify(options.state || {})); }
  catch(error){
    console.warn("메모의 악보 스냅샷을 읽지 못했어요:", error);
    // 스냅샷이 깨졌더라도 이 블록과 이어져 있던 탭은 그대로 보여 준다.
    if (opened){
      if (typeof setActiveDoc === "function") setActiveDoc(opened.id);
      return opened;
    }
    if (typeof toast === "function") toast("메모에 담긴 악보 정보를 읽지 못했어요.", 2800, { type:"error" });
    return null;
  }
  if (opened){
    if (await musicKeepOpenedMemoTab(opened, snapshot)) return opened;
    // "메모 그림으로 열기"를 골랐다 — 옛 탭의 고리를 먼저 끊어야 한 블록을 두 탭이 덮어쓰지 않는다.
    opened.memoBlockId = null;
    if (typeof persistTabState === "function") persistTabState();
  }
  if (typeof handleFiles !== "function") return null;
  const base = String(options.name || "악보").replace(/\.msheet$/i, "").trim() || "악보";
  const made = await handleFiles([new File([musicSerialize(snapshot)], base + ".msheet", { type:"application/json" })],
    { isScratch:true, memoBlockId:blockId });
  if (made) made.memoReusedTab = false;
  return made;
}

/* ===== 저장 ===== */
async function saveMusicSheet(doc){
  if (!doc || !doc.sheet) return false;
  const previousUpdatedAt = doc.sheet.updatedAt;
  doc.sheet.updatedAt = Date.now();
  const json = musicSerialize(doc.sheet);
  const ok = (typeof saveTextDoc === "function") ? await saveTextDoc(json, doc, doc.name) : false;
  if (ok){
    doc.savedText = json;
    // updatedAt 도 스냅샷에 들어가므로 저장 성공 시 현재 이력의 기준점도 같은 JSON 으로 맞춘다.
    // 그래야 저장 → 편집 → 되돌리기 뒤 사용자 내용이 저장본과 같으면 다시 깨끗한 상태가 된다.
    if (doc._musicHistory && typeof doc._musicHistory.replaceCurrent === "function"){
      doc._musicHistory.replaceCurrent(json);
    }
    // 자동 복원은 문서를 열 때 담아 둔 File 바이트로 되살린다. 저장했다고 그 사본이 저절로 바뀌지는
    // 않으므로(saveTextDoc 은 디스크에만 쓴다) 여기서 작업공간 사본까지 새 내용으로 바꿔 준다.
    // 이걸 빠뜨리면 저장한 악보가 다음 실행 때 "만들 때의 빈 악보"로 되돌아온다(표·이미지와 같은 경로).
    if (typeof markDocumentSavedSnapshot === "function"){
      await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json");
    } else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
  } else {
    // 취소·실패한 저장이 메타데이터만 몰래 바꾸지 않게 원래 시각을 복원한다.
    doc.sheet.updatedAt = previousUpdatedAt;
  }
  return ok;
}

function musicExportName(doc, ext){
  const base = String((doc && doc.name) || (doc && doc.sheet && doc.sheet.title) || "악보")
    .replace(/\.msheet$/i, "");
  return base + "." + ext;
}

function musicDownloadBlob(name, blob){
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch(_){
    if (typeof toast === "function") toast("저장에 실패했어요.", 2400, { type:"error" });
    return false;
  }
}

function musicButton(label, title, className){
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "music-btn";
  button.textContent = label;
  if (title) button.title = title;
  return button;
}

/* ===== 편집기 ===== */
async function mountMusicEditor(doc){
  const sheet = doc.sheet;
  const root = document.createElement("div");
  root.className = "music-doc";
  doc.el.appendChild(root);

  const noteEls = new Map();        // 음표 id → SVG 요소(강조·클릭용)
  const solfegeEls = new Map();     // 음표 id → 오선 밖 계이름 SVG 글자
  const noteHorizontalLimits = new Map(); // 음표 id → 현재 조판에서 이웃·마디를 넘지 않는 xOffset 범위
  let staveBoxes = [];              // 마디별 조판 좌표 — 오선 클릭을 마디·음높이로 옮길 때 쓴다
  let scoreLines = [];              // 단(오선지 한 줄)마다 담긴 마디 번호 — "이 단을 메모로"가 쓴다
  let selection = null;             // { measure:0부터, staff:"treble"|"bass", voice:1|2, id }
  let activeStaff = "treble";       // 다음 음을 넣을 손/오선
  let activeVoice = 1;              // 같은 오선 안의 독립 성부
  let redrawTimer = 0;
  let vexReady = false;
  let history = null;
  let scoreZoom = 1;                // 보기 상태라 .msheet·되돌리기에는 넣지 않는다
  let scorePan = null;              // 확대된 악보 여백을 손바닥으로 끌 때의 시작 좌표·스크롤
  let suppressScoreClick = false;   // 드래그를 끝낼 때 생기는 click 이 음표를 넣지 못하게 막는다
  let pitchGuideEl = null;          // 오선 위·아래의 보이지 않는 음높이를 보여주는 가상 덧줄
  let noteDrag = null;              // 좌우 위치 또는 위아래 음높이 조정 중인 음표와 드래그 시작 좌표
  let contextLayers = [];           // 악보 우클릭 메뉴와 열린 하위 메뉴
  let contextOutside = null;
  let contextKeydown = null;
  let contextResize = null;
  let contextSubTimer = null;
  let countInEnabled = false;       // 연습 설정은 보기 상태라 .msheet에는 저장하지 않는다
  let metronomeEnabled = false;
  let midiAccess = null;
  let midiInputEnabled = false;
  let lastMidiNoteAt = 0;
  let lastMidiBaseId = null;
  let imageReferenceUrl = "";
  let keyboardComposeActive = false; // 보기/입력 모드라 .msheet와 되돌리기에는 넣지 않는다

  /* 따라치기(음 맞추기) — 악보를 흐린 교본으로 깔고 자판으로 음을 따라 눌러 보는 모드.
     핵심 규칙 하나: 연습 내내 `sheet` 를 한 글자도 건드리지 않는다. 채점 상태는 화면 표시일 뿐이라
     저장·자동저장·되돌리기가 연습 중 값에 오염될 여지가 없다(코드 따라치기가 교본을 지키려고
     getValue() 로 방어하던 문제 자체가 없어진다). 그 대신 입력 경로를 전부 여기로 돌려야 한다.
     state[i]: 0=아직 / 1=맞음 / 2=틀렸다가 통과. */
  const practice = { active:false, steps:[], state:null, total:0, pos:0, done:0, notes:0, wrong:0, bad:0,
                     hit:new Set(), err:false, startedAt:0, hintAt:0 };

  // 도구상자 상태. accidental 은 "다음에 넣을 음표 하나"에만 붙는다(임시표는 일회성이 자연스럽다).
  // null 은 임시표 미선택, 0 은 사용자가 고른 제자리표다. 둘을 나눠야 새 음표가 현재 조표를 따른다.
  const tool = { value:"quarter", dots:0, rest:false, accidental:null, eraser:false, position:false, chord:false };

  /* 저장하기 전에 창을 닫거나 갑자기 꺼져도 되살릴 수 있게 복구본을 남긴다.
     PDF·노트북·표·이미지·블록 문서와 같은 경로(saveDocumentRecoverySnapshot)이고, 원본 파일은 건드리지 않는다. */
  let recoveryTimer = 0;
  const musicRecoveryBytes = () => {
    try { return new TextEncoder().encode(musicSerialize(sheet)); } catch(_){ return null; }
  };
  const scheduleMusicRecovery = () => {
    clearTimeout(recoveryTimer);
    if (typeof appSettings !== "object" || !appSettings || !appSettings.pdfRecovery) return;
    if (typeof saveDocumentRecoverySnapshot !== "function") return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = 0;
      if (!doc.hasUnsavedEdits) return;
      const bytes = musicRecoveryBytes();
      if (bytes) saveDocumentRecoverySnapshot(doc, bytes, "application/json").catch(() => {});
    }, MUSIC_RECOVERY_DELAY);
  };
  const flushMusicBackup = () => {
    clearTimeout(recoveryTimer);
    recoveryTimer = 0;
    if (!doc.hasUnsavedEdits || typeof saveDocumentRecoverySnapshot !== "function") return true;
    const bytes = musicRecoveryBytes();
    return bytes ? saveDocumentRecoverySnapshot(doc, bytes, "application/json") : true;
  };
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.flushBackupRecovery = flushMusicBackup;
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer);
    recoveryTimer = 0;
    if (doc.flushBackupRecovery === flushMusicBackup) delete doc.flushBackupRecovery;
  });

  const touch = () => {
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, musicSerialize(sheet) !== doc.savedText);
    scheduleMusicRecovery();
  };

  /* ----- 상단 바 ----- */
  const bar = document.createElement("div");
  bar.className = "music-bar";

  const titleInput = document.createElement("input");
  titleInput.className = "music-title";
  titleInput.type = "text";
  titleInput.value = sheet.title || "";
  titleInput.placeholder = "악보 제목";
  titleInput.setAttribute("aria-label", "악보 제목");
  titleInput.addEventListener("input", () => {
    sheet.title = titleInput.value;
    touch();
    if (history) history.commitSoon(MUSIC_TYPING_DELAY);
  });

  const tempoWrap = document.createElement("label");
  tempoWrap.className = "music-field";
  tempoWrap.append("♩=");
  const tempoInput = document.createElement("input");
  tempoInput.type = "number";
  tempoInput.className = "music-tempo";
  tempoInput.min = String(MUSIC_TEMPO_MIN);
  tempoInput.max = String(MUSIC_TEMPO_MAX);
  tempoInput.value = String(sheet.tempo);
  tempoInput.addEventListener("change", () => {
    sheet.tempo = Math.max(MUSIC_TEMPO_MIN, Math.min(MUSIC_TEMPO_MAX, Number(tempoInput.value) || MUSIC_DEFAULT_TEMPO));
    tempoInput.value = String(sheet.tempo);
    touch();
    updateStatus();
    if (history) history.commit();
  });
  tempoWrap.appendChild(tempoInput);

  const timbreWrap = document.createElement("label");
  timbreWrap.className = "music-field";
  timbreWrap.append("음색");
  const timbreSelect = document.createElement("select");
  timbreSelect.className = "music-timbre";
  const TIMBRE_LABELS = {
    piano:"피아노(추천)", guitar:"기타(나일론)",
    xylophone:"실로폰", harp:"하프", flute:"플루트", clarinet:"클라리넷",
    triangle:"삼각파", sine:"사인파(부드럽게)", square:"사각파(또렷하게)"
  };
  const timbreLabel = (name) => (TIMBRE_LABELS[name] || name).replace(/\(.+\)$/, "");
  for (const name of MUSIC_TIMBRES){
    const option = document.createElement("option");
    option.value = name;
    option.textContent = TIMBRE_LABELS[name] || name;
    if (sheet.timbre === name) option.selected = true;
    timbreSelect.appendChild(option);
  }
  timbreSelect.addEventListener("change", () => {
    sheet.timbre = timbreSelect.value;
    const activePart = musicActivePart(sheet);
    if (activePart) activePart.timbre = sheet.timbre;
    syncPartControls();
    touch();
    if (history) history.commit();
    const keyAlter = musicKeyAlterations(sheet.key).C || 0;
    MNMusicAudio.previewNote({ rest:false, step:"C", octave:4, alter:keyAlter }, sheet.timbre);
  });
  timbreWrap.appendChild(timbreSelect);

  const partWrap = document.createElement("span");
  partWrap.className = "music-field music-parts";
  partWrap.append("파트");
  const partSelect = document.createElement("select");
  partSelect.className = "music-timbre music-part-select";
  partSelect.setAttribute("aria-label", "편집할 악기 파트");
  const partNameInput = document.createElement("input");
  partNameInput.type = "text";
  partNameInput.className = "music-part-name";
  partNameInput.maxLength = 80;
  partNameInput.setAttribute("aria-label", "파트 이름");
  const addPartBtn = musicButton("＋", "새 악기 파트 추가");
  const removePartBtn = musicButton("−", "현재 악기 파트 삭제");
  const partMuteBtn = musicButton("M", "현재 파트 음소거");
  partMuteBtn.setAttribute("aria-pressed", "false");
  const partVolumeInput = document.createElement("input");
  partVolumeInput.type = "range";
  partVolumeInput.className = "music-part-volume";
  partVolumeInput.min = "0";
  partVolumeInput.max = "100";
  partVolumeInput.step = "5";
  partVolumeInput.setAttribute("aria-label", "현재 파트 음량");
  const partVolumeLabel = document.createElement("span");
  partVolumeLabel.className = "music-part-volume-label";
  partWrap.append(partSelect, partNameInput, addPartBtn, removePartBtn, partMuteBtn,
    partVolumeInput, partVolumeLabel);

  partSelect.addEventListener("change", () => selectEditorPart(partSelect.value, true));
  partNameInput.addEventListener("input", () => {
    const part = musicActivePart(sheet);
    if (!part) return;
    part.name = musicClampText(partNameInput.value, 80) || "악기";
    syncPartSelectOptions();
    touch();
    if (history) history.commitSoon(MUSIC_TYPING_DELAY);
  });
  addPartBtn.addEventListener("click", addEditorPart);
  removePartBtn.addEventListener("click", removeEditorPart);
  partMuteBtn.addEventListener("click", () => {
    const part = musicActivePart(sheet);
    if (!part) return;
    part.muted = !part.muted;
    syncPartControls();
    touch();
    if (history) history.commit();
  });
  partVolumeInput.addEventListener("input", () => setEditorPartVolume(Number(partVolumeInput.value) / 100, false));
  partVolumeInput.addEventListener("change", () => setEditorPartVolume(Number(partVolumeInput.value) / 100, true));

  const exampleWrap = document.createElement("span");
  exampleWrap.className = "music-field music-example";
  const exampleSelect = document.createElement("select");
  exampleSelect.className = "music-timbre";
  for (const [value, label] of [["", "예제 선택"], ["school-bell", "학교종 4마디"], ["twinkle", "작은별 4마디"]]){
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    exampleSelect.appendChild(option);
  }
  const exampleBtn = musicButton("예제로 시작", "현재 악보를 선택한 예제로 바꿉니다");
  exampleBtn.addEventListener("click", loadSelectedExample);
  exampleWrap.append(exampleSelect, exampleBtn);

  // 박자표 — 마디 용량이 바뀌므로 넘치는 마디가 생길 수 있다(막지 않고 경고만; 되돌리기로 취소 가능).
  const timeWrap = document.createElement("label");
  timeWrap.className = "music-field";
  timeWrap.append("박자");
  const timeSelect = document.createElement("select");
  timeSelect.className = "music-timbre";
  for (const spec of MUSIC_TIME_CHOICES){
    const option = document.createElement("option");
    option.value = spec;
    option.textContent = spec;
    if (`${sheet.time.beats}/${sheet.time.beatValue}` === spec) option.selected = true;
    timeSelect.appendChild(option);
  }
  timeSelect.addEventListener("change", () => {
    const [beats, beatValue] = timeSelect.value.split("/").map(Number);
    sheet.time = { beats, beatValue };
    const previousDrumStyle = musicDrumStyle(sheet.drumStyle);
    const drumChanged = previousDrumStyle !== "off" && !musicDrumStyleCompatible(previousDrumStyle, sheet.time);
    if (drumChanged) sheet.drumStyle = "basic";
    syncDrumControls();
    afterEdit();
    const check = musicValidate(sheet);
    if (!check.ok && typeof toast === "function"){
      toast(`박자를 ${timeSelect.value} 로 바꿨어요. 박자와 맞지 않는 마디는 아래에 표시했어요.`
        + (drumChanged ? " 드럼은 기본 드럼으로 바꿨어요." : ""), 3800);
    } else if (drumChanged && typeof toast === "function"){
      toast(`${MUSIC_DRUM_STYLE_SPECS[previousDrumStyle].label} 스타일은 ${timeSelect.value}에 맞지 않아 기본 드럼으로 바꿨어요.`, 3600);
    }
  });
  timeWrap.appendChild(timeSelect);

  // 조표 — 임시표 없이 적혀 있던 음은 새 조표를 따라간다(musicRetuneForKey).
  const keyWrap = document.createElement("label");
  keyWrap.className = "music-field";
  keyWrap.append("조표");
  const keySelect = document.createElement("select");
  keySelect.className = "music-timbre";
  // 옆의 조옮김과 헷갈리기 쉬운 자리라 무엇이 다른지 적어 둔다.
  keySelect.title = "음표는 그 자리에 두고 조표만 바꿉니다. 노래 높이를 통째로 올리거나 내리려면 조옮김을 쓰세요.";
  for (const name of Object.keys(MUSIC_KEYS)){
    const option = document.createElement("option");
    option.value = name;
    option.textContent = MUSIC_KEYS[name].label;
    if (sheet.key === name) option.selected = true;
    keySelect.appendChild(option);
  }
  keySelect.addEventListener("change", () => {
    const changed = musicRetuneForKey(sheet, keySelect.value);
    afterEdit();
    if (changed && typeof toast === "function"){
      toast(`${MUSIC_KEYS[sheet.key].label}로 바꿨어요. 임시표 없던 음 ${changed}개가 새 조표를 따라갑니다.`, 3400);
    }
  });
  keyWrap.appendChild(keySelect);

  const transposeBtn = musicButton("조옮김",
    "노래 전체를 올리거나 내립니다 — 음표와 조표가 함께 움직여 멜로디는 그대로입니다");
  transposeBtn.addEventListener("click", () => {
    const rect = transposeBtn.getBoundingClientRect();
    openMusicContextMenu(rect.left, rect.bottom + 4, transposeContextItems());
  });

  const grandStaffBtn = musicButton(sheet.grandStaff ? "🎹 피아노 대보표" : "🎼 단일 오선",
    "오른손 높은음자리표와 왼손 낮은음자리표를 함께 사용합니다");
  grandStaffBtn.addEventListener("click", () => setGrandStaff(!sheet.grandStaff));

  // 도구막대 접기 단추 — 접으면 이 줄(상단 바)만 남아 다시 펴는 길이 늘 보인다.
  const toolbarToggleBtn = musicButton("▤ 도구 숨기기", "", "music-btn music-toolbar-toggle");
  toolbarToggleBtn.addEventListener("click", toggleToolbarVisibility);

  const undoBtn = musicButton("↶", "되돌리기 (Ctrl+Z)");
  const redoBtn = musicButton("↷", "다시 실행 (Ctrl+Y)");
  const historyWrap = document.createElement("span");
  historyWrap.className = "music-history";
  historyWrap.append(undoBtn, redoBtn);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "run-save music-save";      // .run-save → 전역 Ctrl+S 가 이 버튼을 클릭한다
  saveBtn.textContent = "💾 저장";
  saveBtn.addEventListener("click", () => { saveMusicSheet(doc); });

  tempoWrap.classList.add("music-toolvis-tempo");
  timeWrap.classList.add("music-toolvis-time");
  keyWrap.classList.add("music-toolvis-key");
  transposeBtn.classList.add("music-toolvis-transpose");
  timbreWrap.classList.add("music-toolvis-timbre");
  partWrap.classList.add("music-toolvis-parts");
  grandStaffBtn.classList.add("music-toolvis-grandstaff");
  exampleWrap.classList.add("music-toolvis-example");
  bar.append(titleInput, partWrap, tempoWrap, timeWrap, keyWrap, transposeBtn, timbreWrap, grandStaffBtn, exampleWrap,
    toolbarToggleBtn, historyWrap, saveBtn);

  /* ----- 도구상자 ----- */
  const tools = document.createElement("div");
  tools.className = "music-tools";

  const valueButtons = new Map();
  const valueGroup = document.createElement("span");
  valueGroup.className = "music-group";
  MUSIC_TOOL_VALUES.forEach((item, index) => {
    const button = musicButton(item.label, `${item.label}음표 (${index + 1})`);
    button.addEventListener("click", () => setToolValue(item.value));
    valueButtons.set(item.value, button);
    valueGroup.appendChild(button);
  });

  const dotBtn = musicButton("·점", "점음표 (마침표 키로 0 → 점 → 겹점)");
  dotBtn.addEventListener("click", () => setToolDots((tool.dots + 1) % (MUSIC_MAX_DOTS + 1)));

  const restBtn = musicButton("쉼표", "쉼표로 넣기 (R)");
  restBtn.addEventListener("click", () => setToolRest(!tool.rest));

  const accidentalGroup = document.createElement("span");
  accidentalGroup.className = "music-group";
  const accidentalButtons = new Map();
  for (const [alter, label, title] of [[1, "♯", "올림표"], [-1, "♭", "내림표"], [0, "♮", "제자리표"]]){
    const button = musicButton(label, title + " — 고른 음표에 바로, 없으면 다음에 넣을 음표에");
    button.addEventListener("click", () => applyAccidental(alter));
    accidentalButtons.set(alter, button);
    accidentalGroup.appendChild(button);
  }

  const eraserBtn = musicButton("지우개", "켜면 누른 음표를 지웁니다 (Delete 로도 지울 수 있어요)");
  eraserBtn.addEventListener("click", () => setToolEraser(!tool.eraser));

  const positionBtn = musicButton("위치 조정", "켜고 음표를 좌우로 드래그합니다 (Alt+드래그도 가능)");
  positionBtn.addEventListener("click", () => setPositionTool(!tool.position));

  const solfegeBtn = musicButton("계이름", "음표 아래 계이름 표시 켜기/끄기");
  solfegeBtn.setAttribute("aria-pressed", sheet.showSolfege !== false ? "true" : "false");
  solfegeBtn.addEventListener("click", toggleSolfege);

  const rightHandBtn = musicButton("오른손", "높은음자리표에 입력");
  rightHandBtn.addEventListener("click", () => setActiveStaff("treble"));
  const leftHandBtn = musicButton("왼손", "낮은음자리표에 입력(피아노 대보표 켜기)");
  leftHandBtn.addEventListener("click", () => setActiveStaff("bass"));
  const staffGroup = document.createElement("span");
  staffGroup.className = "music-group music-staff-group";
  staffGroup.append(rightHandBtn, leftHandBtn);

  const voice1Btn = musicButton("성부 1", "같은 오선의 첫 번째 성부에 입력합니다");
  voice1Btn.addEventListener("click", () => setActiveVoice(1));
  const voice2Btn = musicButton("성부 2", "긴 음 위에 다른 리듬을 함께 적을 때 사용합니다");
  voice2Btn.addEventListener("click", () => setActiveVoice(2));
  const voiceGroup = document.createElement("span");
  voiceGroup.className = "music-group music-voice-group";
  voiceGroup.append(voice1Btn, voice2Btn);

  const chordBtn = musicButton("＋화음", "음표를 고른 뒤 켜고 같은 오선을 누르면 화음음을 추가합니다");
  chordBtn.addEventListener("click", () => setChordEntry(!tool.chord));
  const removeChordBtn = musicButton("－화음음", "고른 화음에서 마지막으로 추가한 음을 제거합니다");
  removeChordBtn.addEventListener("click", removeSelectedChordPitch);
  const tieBtn = musicButton("⌒ 붙임줄", "고른 음표를 다음 음표와 붙이거나 해제합니다");
  tieBtn.addEventListener("click", toggleSelectedTie);
  const chordSymbolBtn = musicButton("코드 기호", "고른 음표 위에 Cm7·B♭ 같은 코드 이름을 입력합니다");
  chordSymbolBtn.addEventListener("click", editSelectedChordSymbol);
  const slurBtn = musicButton("⌒ 이음줄", "고른 음표에서 다음 음표까지 프레이즈 이음줄을 표시합니다");
  slurBtn.addEventListener("click", toggleSelectedSlur);
  const lyricBtn = musicButton("가사", "고른 음표 아래에 한 음절의 가사를 입력합니다");
  lyricBtn.addEventListener("click", editSelectedLyric);
  const repeatStartBtn = musicButton("|: 반복 시작", "고른 마디의 시작 반복선을 켜거나 끕니다");
  repeatStartBtn.addEventListener("click", () => toggleMeasureMark("repeatStart"));
  const repeatEndBtn = musicButton(":| 반복 끝", "고른 마디의 끝 반복선을 켜거나 끕니다");
  repeatEndBtn.addEventListener("click", () => toggleMeasureMark("repeatEnd"));
  const endingBtn = musicButton("1·2번 괄호", "고른 마디의 1번·2번 엔딩 괄호를 차례로 바꿉니다");
  endingBtn.addEventListener("click", () => cycleMeasureEnding());
  const dynamicBtn = musicButton("셈여림", "고른 음표에 pp~ff 셈여림표를 붙입니다");
  dynamicBtn.addEventListener("click", editSelectedDynamic);
  const articulationBtn = musicButton("연주 기호", "스타카토·악센트·테누토를 고릅니다");
  articulationBtn.addEventListener("click", cycleSelectedArticulation);
  const tripletBtn = musicButton("3잇단", "고른 음표부터 3개를 셋잇단음표로 묶거나 해제합니다");
  tripletBtn.addEventListener("click", toggleSelectedTriplet);
  const fingeringBtn = musicButton("운지", "고른 음표에 1~5 손가락 번호를 표시합니다");
  fingeringBtn.addEventListener("click", editSelectedFingering);
  const pedalBtn = musicButton("페달", "피아노 페달 시작·끝 표시를 차례로 바꿉니다");
  pedalBtn.addEventListener("click", cycleSelectedPedal);
  const measureSettingsBtn = musicButton("마디 설정", "못갖춘마디 또는 이 마디부터 바뀌는 박자·조표·빠르기를 설정합니다");
  measureSettingsBtn.addEventListener("click", editActiveMeasureSettings);

  const addBarBtn = musicButton("＋마디", "마지막에 빈 마디 추가");
  addBarBtn.addEventListener("click", () => addMeasure());
  const addStaffBtn = musicButton("＋오선", "마지막에 빈 오선 한 단 추가");
  addStaffBtn.addEventListener("click", () => addStaffLine());
  const removeStaffBtn = musicButton("－오선", "마지막에 추가한 오선 한 단 삭제");
  removeStaffBtn.addEventListener("click", () => removeStaffLine());
  const removeBarBtn = musicButton("－마디", "고른 마디(없으면 마지막 마디) 삭제");
  removeBarBtn.addEventListener("click", () => removeMeasure());
  const resetScoreBtn = musicButton("↺ 초기화",
    "음표·쉼표·마디를 모두 지우고 빈 1마디로 만듭니다. 제목과 음악 설정은 유지됩니다.",
    "music-btn music-reset");
  resetScoreBtn.addEventListener("click", resetScoreContent);

  const hint = document.createElement("span");
  hint.className = "music-hint music-hover-readout";
  hint.setAttribute("aria-label", "악보 입력 위치 안내");
  hint.textContent = "오선 위에 마우스를 올리면 넣을 음을 보여줘요";

  const measureProgress = document.createElement("span");
  measureProgress.className = "music-measure-progress";
  measureProgress.setAttribute("aria-live", "polite");

  valueGroup.classList.add("music-toolvis-notevalue");
  dotBtn.classList.add("music-toolvis-dots");
  restBtn.classList.add("music-toolvis-rest");
  accidentalGroup.classList.add("music-toolvis-accidental");
  staffGroup.classList.add("music-toolvis-staff");
  voiceGroup.classList.add("music-toolvis-voice");
  chordBtn.classList.add("music-toolvis-chord"); removeChordBtn.classList.add("music-toolvis-chord");
  tieBtn.classList.add("music-toolvis-tie");
  slurBtn.classList.add("music-toolvis-slur");
  chordSymbolBtn.classList.add("music-toolvis-chordsymbol");
  lyricBtn.classList.add("music-toolvis-lyric");
  dynamicBtn.classList.add("music-toolvis-dynamic");
  articulationBtn.classList.add("music-toolvis-articulation");
  tripletBtn.classList.add("music-toolvis-triplet");
  fingeringBtn.classList.add("music-toolvis-fingering");
  pedalBtn.classList.add("music-toolvis-pedal");
  repeatStartBtn.classList.add("music-toolvis-repeat"); repeatEndBtn.classList.add("music-toolvis-repeat"); endingBtn.classList.add("music-toolvis-repeat");
  measureSettingsBtn.classList.add("music-toolvis-measure-settings");
  solfegeBtn.classList.add("music-toolvis-solfege");
  eraserBtn.classList.add("music-toolvis-eraser");
  positionBtn.classList.add("music-toolvis-position");
  addBarBtn.classList.add("music-toolvis-measures"); removeBarBtn.classList.add("music-toolvis-measures");
  addStaffBtn.classList.add("music-toolvis-staves"); removeStaffBtn.classList.add("music-toolvis-staves");
  resetScoreBtn.classList.add("music-toolvis-reset");
  tools.append(valueGroup, dotBtn, restBtn, accidentalGroup, staffGroup, voiceGroup, chordBtn, removeChordBtn,
    tieBtn, slurBtn, chordSymbolBtn, lyricBtn, dynamicBtn, articulationBtn, tripletBtn, fingeringBtn, pedalBtn,
    repeatStartBtn, repeatEndBtn, endingBtn, measureSettingsBtn, solfegeBtn, eraserBtn, positionBtn,
    addBarBtn, removeBarBtn, addStaffBtn, removeStaffBtn, resetScoreBtn, measureProgress, hint);

  const beginnerTools = document.createElement("div");
  beginnerTools.className = "music-beginner-tools";
  const beginnerLabel = document.createElement("strong");
  beginnerLabel.textContent = "쉬운 입력";
  const keyboardComposeBtn = musicButton("⌨ 자판 작곡",
    "설정한 계이름 키로 음표를 이어서 입력합니다. 마디가 차면 다음 마디를 자동으로 만듭니다 (Esc: 끝내기)");
  keyboardComposeBtn.classList.add("music-keyboard-compose");
  keyboardComposeBtn.setAttribute("aria-pressed", "false");
  keyboardComposeBtn.addEventListener("click", () => setKeyboardCompose(!keyboardComposeActive));
  const keyboardSettingsBtn = musicButton("⚙ 자판 설정", "설정의 악보 자판에서 계이름마다 원하는 키를 고릅니다");
  keyboardSettingsBtn.classList.add("music-keyboard-settings-open");
  keyboardSettingsBtn.addEventListener("click", () => {
    const open = document.getElementById("settingsOpen");
    const tab = document.querySelector('#settingsTabs [data-settings-tab="shortcut"]');
    if (open) open.click();
    if (tab) tab.click();
  });
  const easyOctaveSelect = document.createElement("select");
  easyOctaveSelect.className = "music-timbre music-easy-octave";
  easyOctaveSelect.setAttribute("aria-label", "계이름 입력 음역");
  for (const [octave, label] of [[2, "아주 낮은 음(2옥타브)"], [3, "낮은 음(3옥타브)"], [4, "가운데 음(4옥타브)"], [5, "높은 음(5옥타브)"]]){
    const option = document.createElement("option");
    option.value = String(octave);
    option.textContent = label;
    option.selected = octave === 4; // 새 단일 오선은 높은음자리표이므로 C4부터 바로 입력되게 한다
    easyOctaveSelect.appendChild(option);
  }
  const easyNoteGroup = document.createElement("span");
  easyNoteGroup.className = "music-group music-easy-notes";
  for (const step of MUSIC_STEPS){
    const button = musicButton(MUSIC_SOLFEGE_LABELS[step], `${MUSIC_SOLFEGE_LABELS[step]} 음표를 현재 길이로 넣기`);
    button.dataset.step = step;
    button.addEventListener("click", () => insertSolfegeNote(step));
    easyNoteGroup.appendChild(button);
  }
  const easyHelp = document.createElement("span");
  easyHelp.className = "music-easy-help";
  easyHelp.textContent = "음표 길이를 고른 뒤 계이름을 누르세요";
  beginnerTools.classList.add("music-toolvis-easy");
  beginnerTools.append(beginnerLabel, keyboardComposeBtn, keyboardSettingsBtn, easyOctaveSelect, easyNoteGroup, easyHelp);

  /* ----- 재생 바 ----- */
  const playBar = document.createElement("div");
  playBar.className = "music-play";

  const playAllBtn = musicButton("▶ 전체 재생");
  const playActivePartBtn = musicButton("▶ 현재 파트", "현재 편집 중인 악기 파트만 재생합니다");
  const playRightBtn = musicButton("▶ 오른손", "높은음자리표만 재생합니다");
  const playLeftBtn = musicButton("▶ 왼손", "낮은음자리표만 재생합니다");
  playRightBtn.disabled = playLeftBtn.disabled = !sheet.grandStaff;
  const rangeWrap = document.createElement("span");
  rangeWrap.className = "music-field";
  const fromInput = document.createElement("input");
  const toInput = document.createElement("input");
  for (const input of [fromInput, toInput]){
    input.type = "number";
    input.className = "music-range";
    input.min = "1";
    input.value = "1";
  }
  toInput.value = String(sheet.measures.length);
  rangeWrap.append("마디 ", fromInput, " ~ ", toInput);

  const playPartBtn = musicButton("▶ 이 구간만");
  const repeatMeasureBtn = musicButton("↻ 고른 마디", "고른 음표의 마디를 정지할 때까지 반복합니다");
  const speedWrap = document.createElement("label");
  speedWrap.className = "music-field";
  speedWrap.append("속도");
  const speedSelect = document.createElement("select");
  speedSelect.className = "music-timbre music-speed";
  for (const rate of [0.5, 0.75, 1]){
    const option = document.createElement("option");
    option.value = String(rate);
    option.textContent = Math.round(rate * 100) + "%";
    if (rate === 1) option.selected = true;
    speedSelect.appendChild(option);
  }
  speedWrap.appendChild(speedSelect);
  const countInBtn = musicButton("1234 준비", "재생 전에 한 마디를 세어 줍니다");
  countInBtn.setAttribute("aria-pressed", "false");
  const metronomeBtn = musicButton("♩ 메트로놈", "재생 중 박자를 소리로 들려줍니다");
  metronomeBtn.setAttribute("aria-pressed", "false");
  const drumWrap = document.createElement("label");
  drumWrap.className = "music-field music-drums";
  drumWrap.append("🥁 반주");
  const drumSelect = document.createElement("select");
  drumSelect.className = "music-timbre music-drum-select";
  drumSelect.title = "박자표에 맞춘 킥·스네어·하이햇을 재생합니다";
  for (const value of MUSIC_DRUM_STYLES){
    const spec = MUSIC_DRUM_STYLE_SPECS[value];
    const option = document.createElement("option");
    option.value = value;
    option.textContent = spec.label;
    if (Array.isArray(spec.times)) option.title = `사용 가능: ${spec.times.join("·")}`;
    drumSelect.appendChild(option);
  }
  drumSelect.value = musicDrumStyle(sheet.drumStyle);
  const accompanimentModeSelect = document.createElement("select");
  accompanimentModeSelect.className = "music-timbre music-accompaniment-mode";
  accompanimentModeSelect.title = "코드 기호를 읽어 베이스와 코드 반주를 더합니다";
  for (const [value, label] of [["drums", "드럼만"], ["bass", "드럼+베이스"], ["full", "전체 반주"]]){
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    accompanimentModeSelect.appendChild(option);
  }
  accompanimentModeSelect.value = musicAccompanimentMode(sheet.accompanimentMode);
  const accompanimentTimbreSelect = document.createElement("select");
  accompanimentTimbreSelect.className = "music-timbre music-accompaniment-timbre";
  accompanimentTimbreSelect.title = "코드 반주 악기";
  for (const [value, label] of [["piano", "피아노"], ["guitar", "기타"]]){
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    accompanimentTimbreSelect.appendChild(option);
  }
  accompanimentTimbreSelect.value = musicAccompanimentTimbre(sheet.accompanimentTimbre);
  const drumVolumeInput = document.createElement("input");
  drumVolumeInput.type = "range";
  drumVolumeInput.className = "music-drum-volume";
  drumVolumeInput.min = "0";
  drumVolumeInput.max = "100";
  drumVolumeInput.step = "5";
  drumVolumeInput.value = String(Math.round(musicClampDrumVolume(sheet.drumVolume) * 100));
  drumVolumeInput.setAttribute("aria-label", "반주 음량");
  const drumVolumeLabel = document.createElement("span");
  drumVolumeLabel.className = "music-drum-volume-label";
  drumWrap.append(drumSelect, accompanimentModeSelect, accompanimentTimbreSelect,
    drumVolumeInput, drumVolumeLabel);
  const practiceWrap = document.createElement("span");
  practiceWrap.className = "music-practice";
  const practiceBtn = musicButton("🎯 따라치기",
    "악보를 흐리게 두고 자판으로 음을 따라 눌러 보기 — A S D F G H J = 도레미파솔라시, 검은건반은 W E T Y U (Esc: 그만두기)");
  const practiceStaffSelect = document.createElement("select");
  practiceStaffSelect.className = "music-timbre music-practice-staff";
  practiceStaffSelect.title = "따라칠 손 고르기";
  practiceStaffSelect.setAttribute("aria-label", practiceStaffSelect.title);
  for (const [value, label] of [["", "양손"], ["treble", "오른손"], ["bass", "왼손"]]){
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    practiceStaffSelect.appendChild(option);
  }
  practiceStaffSelect.hidden = !sheet.grandStaff;
  const practiceInfo = document.createElement("span");
  practiceInfo.className = "music-practice-info";
  practiceInfo.hidden = true;
  practiceInfo.setAttribute("aria-live", "polite");
  practiceWrap.append(practiceBtn, practiceStaffSelect, practiceInfo);

  /* 음감 테스트 — 악보를 감추고 소리만 듣고 음이름을 맞힌다(진행·채점은 music-eartest.js).
     단계·문항 수·기준음은 배율·도구막대와 같은 보기 상태라 .msheet 에도 되돌리기에도 넣지 않는다. */
  const MUSIC_EAR_LEVEL_KEY = "musicEarLevel";
  const MUSIC_EAR_COUNT_KEY = "musicEarCount";
  const MUSIC_EAR_REFERENCE_KEY = "musicEarReference";
  const earWrap = document.createElement("span");
  earWrap.className = "music-ear-controls";
  const earBtn = musicButton("🎧 음감 테스트",
    "악보를 감추고 소리만 듣고 음이름 맞히기 — A S D F G H J = 도레미파솔라시 (Space: 다시 듣기, Esc: 그만두기)");
  const earLevelSelect = document.createElement("select");
  earLevelSelect.className = "music-timbre music-ear-level";
  earLevelSelect.title = "음감 테스트 단계";
  earLevelSelect.setAttribute("aria-label", earLevelSelect.title);
  for (const level of MNMusicEarTest.LEVELS){
    const option = document.createElement("option");
    option.value = String(level.id);
    option.textContent = level.label;
    earLevelSelect.appendChild(option);
  }
  const earCountSelect = document.createElement("select");
  earCountSelect.className = "music-timbre music-ear-count";
  earCountSelect.title = "음감 테스트 문항 수";
  earCountSelect.setAttribute("aria-label", earCountSelect.title);
  for (const count of MNMusicEarTest.COUNTS){
    const option = document.createElement("option");
    option.value = String(count);
    option.textContent = `${count}문제`;
    earCountSelect.appendChild(option);
  }
  earCountSelect.value = String(MNMusicEarTest.COUNTS[1] || MNMusicEarTest.COUNTS[0]);
  const earReferenceBtn = musicButton("🎵 기준음",
    "시작할 때 가온다(도4)를 들려줍니다 — 기준음이 있으면 상대음감 연습, 없으면 절대음감 연습");
  earReferenceBtn.setAttribute("aria-pressed", "false");
  let earReference = false;
  try {
    const savedLevel = localStorage.getItem(MUSIC_EAR_LEVEL_KEY);
    if (savedLevel && MNMusicEarTest.LEVELS.some((level) => String(level.id) === savedLevel)) {
      earLevelSelect.value = savedLevel;
    }
    const savedCount = localStorage.getItem(MUSIC_EAR_COUNT_KEY);
    if (savedCount && MNMusicEarTest.COUNTS.includes(Number(savedCount))) earCountSelect.value = savedCount;
    earReference = localStorage.getItem(MUSIC_EAR_REFERENCE_KEY) === "true";
  } catch(_){}
  earWrap.append(earBtn, earLevelSelect, earCountSelect, earReferenceBtn);

  const earTest = MNMusicEarTest.create({
    timbre:() => sheet.timbre,
    toast:(message, ms) => { if (typeof toast === "function") toast(message, ms); },
    onStart:() => setEarChrome(true),
    onFinish:(summary) => {
      if (typeof petReact === "function") petReact(summary.accuracy >= 80 ? "success" : "error");
    },
    onEnd:(summary, reason) => {
      setEarChrome(false);
      scheduleRedraw();                            // 감춰 뒀던 악보가 제 폭으로 다시 그려진다
      if (reason === "cancel" && summary.answered && typeof toast === "function"){
        toast(`음감 테스트를 그만뒀어요. 여기까지 ${summary.correct}/${summary.answered}`
          + ` · 정확도 ${summary.accuracy}%`, 3000);
      }
    }
  });

  const volumeWrap = document.createElement("span");
  volumeWrap.className = "music-volume";
  const muteBtn = musicButton("🔊", "악보 소리 음소거");
  muteBtn.setAttribute("aria-pressed", MNMusicAudio.muted() ? "true" : "false");
  const volumeInput = document.createElement("input");
  volumeInput.type = "range";
  volumeInput.className = "music-volume-range";
  volumeInput.min = "0";
  volumeInput.max = "100";
  volumeInput.step = "5";
  volumeInput.value = String(Math.round(MNMusicAudio.getVolume() * 100));
  volumeInput.setAttribute("aria-label", "악보 음량");
  const volumeLabel = document.createElement("span");
  volumeLabel.className = "music-volume-label";
  volumeWrap.append(muteBtn, volumeInput, volumeLabel);
  const stopBtn = musicButton("■ 정지");
  stopBtn.disabled = true;
  const musicXmlBtn = musicButton("⬇ MusicXML", "다른 악보 프로그램에서 열 수 있는 .musicxml 파일로 저장");
  const midiInputBtn = musicButton("🎹 MIDI 입력", "연결된 MIDI 건반으로 음표와 화음을 입력합니다");
  const midiExportBtn = musicButton("⬇ MIDI", "재생 가능한 표준 MIDI(.mid) 파일로 저장합니다");
  const imageReferenceBtn = musicButton("🖼 악보 이미지 참고", "이미지를 옆에 열어 보며 악보를 옮겨 적습니다");
  const wavBtn = musicButton("⬇ WAV 저장");
  const memoBtn = musicButton("📋 메모로",
    "악보를 그림으로 메모창에 보내기 — 메모에서 '✏️ 악보로'를 누르면 다시 편집할 수 있어요 (오선 한 단만 보내려면 그 단에서 오른쪽 버튼)");
  const printBtn = musicButton("🖨 인쇄", "인쇄 대화상자에서 'PDF로 저장'을 고르면 PDF가 됩니다");
  const zoomWrap = document.createElement("span");
  zoomWrap.className = "music-zoom";
  const zoomOutBtn = musicButton("−", "악보 축소 (Ctrl+휠 아래, Ctrl+-)");
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "music-zoom-label";
  zoomLabel.setAttribute("aria-live", "polite");
  const zoomInBtn = musicButton("＋", "악보 확대 (Ctrl+휠 위, Ctrl++)");
  const zoomFitBtn = musicButton("맞춤", "악보 배율을 100%로 되돌리기 (Ctrl+0)");
  zoomWrap.append(zoomOutBtn, zoomLabel, zoomInBtn, zoomFitBtn);
  const status = document.createElement("span");
  status.className = "music-status";

  playAllBtn.classList.add("music-toolvis-playback"); playActivePartBtn.classList.add("music-toolvis-playback");
  playRightBtn.classList.add("music-toolvis-playback");
  playLeftBtn.classList.add("music-toolvis-playback"); stopBtn.classList.add("music-toolvis-playback");
  rangeWrap.classList.add("music-toolvis-range"); playPartBtn.classList.add("music-toolvis-range");
  repeatMeasureBtn.classList.add("music-toolvis-repeat-measure");
  speedWrap.classList.add("music-toolvis-speed");
  countInBtn.classList.add("music-toolvis-countin");
  metronomeBtn.classList.add("music-toolvis-metronome");
  drumWrap.classList.add("music-toolvis-drums");
  practiceWrap.classList.add("music-toolvis-practice");
  earWrap.classList.add("music-toolvis-ear");
  volumeWrap.classList.add("music-toolvis-volume");
  musicXmlBtn.classList.add("music-toolvis-xml");
  midiInputBtn.classList.add("music-toolvis-midi-input");
  midiExportBtn.classList.add("music-toolvis-midi-export");
  imageReferenceBtn.classList.add("music-toolvis-reference");
  wavBtn.classList.add("music-toolvis-wav");
  memoBtn.classList.add("music-toolvis-memo");
  printBtn.classList.add("music-toolvis-print");
  zoomWrap.classList.add("music-toolvis-zoom");
  playBar.append(playAllBtn, playActivePartBtn, playRightBtn, playLeftBtn, rangeWrap, playPartBtn, repeatMeasureBtn, speedWrap,
    countInBtn, metronomeBtn, drumWrap, practiceWrap, earWrap, volumeWrap, stopBtn, musicXmlBtn, midiInputBtn, midiExportBtn,
    imageReferenceBtn, wavBtn, memoBtn, printBtn, zoomWrap, status);

  /* ----- 악보 ----- */
  const scoreHost = document.createElement("div");
  scoreHost.className = "music-score";
  scoreHost.tabIndex = 0;
  scoreHost.setAttribute("aria-label", "악보 편집 영역. 마우스 오른쪽 버튼으로 편집 메뉴를 열 수 있습니다.");
  const notice = document.createElement("div");
  notice.className = "music-notice";
  notice.hidden = true;

  const scoreWorkspace = document.createElement("div");
  scoreWorkspace.className = "music-score-workspace";
  const imageReference = document.createElement("aside");
  imageReference.className = "music-image-reference";
  imageReference.hidden = true;
  const imageReferenceControls = document.createElement("div");
  imageReferenceControls.className = "music-image-reference-controls";
  const imageReferenceTitle = document.createElement("strong");
  imageReferenceTitle.textContent = "참고 악보";
  const imageZoom = document.createElement("input");
  imageZoom.type = "range"; imageZoom.min = "50"; imageZoom.max = "250"; imageZoom.value = "100";
  imageZoom.setAttribute("aria-label", "참고 이미지 확대 비율");
  const imageReferenceClose = musicButton("닫기", "참고 이미지 닫기");
  imageReferenceControls.append(imageReferenceTitle, imageZoom, imageReferenceClose);
  const imageReferenceViewport = document.createElement("div");
  imageReferenceViewport.className = "music-image-reference-viewport";
  const imageReferenceImg = document.createElement("img");
  imageReferenceImg.alt = "옮겨 적을 참고 악보";
  imageReferenceViewport.appendChild(imageReferenceImg);
  imageReference.append(imageReferenceControls, imageReferenceViewport);
  const imageReferenceInput = document.createElement("input");
  imageReferenceInput.type = "file";
  imageReferenceInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp";
  imageReferenceInput.hidden = true;
  scoreWorkspace.append(imageReference, scoreHost);
  root.append(bar, tools, beginnerTools, playBar, notice, scoreWorkspace, earTest.el, imageReferenceInput);

  /* ----- 도구막대 접기 -----
     악보만 넓게 보고 싶을 때 편집 도구·쉬운 입력·재생 세 줄을 접는다. 접어도 우클릭 메뉴에
     같은 기능이 다 있어 편집을 이어 갈 수 있고, 요소를 지우지 않고 hidden 으로만 감추므로
     메뉴가 읽는 값(속도·음역·구간 등)도 그대로 살아 있다. 배율과 같은 보기 상태라 .msheet
     에는 저장하지 않고, 모든 악보가 이어 쓰는 화면 환경설정으로 기억한다.

     창 모드에서는 머리말(제목·저장·되돌리기)을 늘 남긴다 — 다시 펴는 단추가 보여야 한다.
     ⛶ 전체화면에서는 나가는 길이 Esc·⛶ 컨트롤로 따로 있으므로 머리말까지 접어 악보만 남긴다. */
  const MUSIC_TOOLBAR_KEY = "musicToolbarVisible";
  let toolbarVisible = true;
  try { toolbarVisible = localStorage.getItem(MUSIC_TOOLBAR_KEY) !== "false"; } catch(_){}
  let fullscreenNow = false;
  let toolbarBeforeFullscreen = null;   // 전체화면이 임시로 접었을 때만 담는다(나가면 되돌린다)
  function applyToolbarVisible(){
    bar.hidden = fullscreenNow && !toolbarVisible;
    for (const row of [tools, beginnerTools, playBar]) row.hidden = !toolbarVisible;
    toolbarToggleBtn.textContent = toolbarVisible ? "▤ 도구 숨기기" : "▤ 도구 보이기";
    toolbarToggleBtn.title = toolbarVisible
      ? "편집·쉬운 입력·재생 줄을 접고 악보를 넓게 봅니다 (H)"
      : "접어 둔 도구막대를 다시 폅니다 (H)";
    toolbarToggleBtn.classList.toggle("is-on", !toolbarVisible);
    toolbarToggleBtn.setAttribute("aria-pressed", toolbarVisible ? "false" : "true");
  }
  function setToolbarVisible(visible){
    toolbarVisible = !!visible;
    toolbarBeforeFullscreen = null;     // 직접 고른 값이 전체화면의 임시 접기보다 우선한다
    applyToolbarVisible();
    try { localStorage.setItem(MUSIC_TOOLBAR_KEY, String(toolbarVisible)); } catch(_){}
  }
  function toggleToolbarVisibility(){
    const next = !toolbarVisible;
    setToolbarVisible(next);
    if (typeof toast !== "function") return;
    if (next) toast("도구막대를 다시 폈어요.", 1300);
    else toast("도구막대를 접었어요. 악보를 마우스 오른쪽 버튼으로 누르면 같은 기능을 쓸 수 있어요.", 2800);
  }

  /* ⛶ 문서 영역 전체화면이면 머리말까지 접어 악보만 남기고, 나가면 들어가기 전 상태로 되돌린다.
     실제 전체화면은 fullscreenchange 로 알 수 있지만 창 안 폴백(body.viewer-fullscreen)은
     이벤트가 없어 클래스 변화를 함께 지켜본다(documents.js setViewerFullscreenFallback). */
  function syncFullscreenState(){
    const on = typeof isViewerFullscreen === "function" ? isViewerFullscreen() : false;
    if (on === fullscreenNow) return;
    fullscreenNow = on;
    const announce = !doc.el.hidden && typeof toast === "function";
    if (on){
      toolbarBeforeFullscreen = toolbarVisible;
      toolbarVisible = false;
      applyToolbarVisible();
      if (announce) toast("전체화면 — 악보만 남겼어요. H 를 누르거나 악보를 오른쪽 버튼으로 누르면 도구가 다시 나와요.", 3000);
      return;
    }
    if (toolbarBeforeFullscreen !== null){ toolbarVisible = toolbarBeforeFullscreen; toolbarBeforeFullscreen = null; }
    applyToolbarVisible();
  }
  document.addEventListener("fullscreenchange", syncFullscreenState);
  const fullscreenClassWatch = typeof MutationObserver === "function" ? new MutationObserver(syncFullscreenState) : null;
  if (fullscreenClassWatch) fullscreenClassWatch.observe(document.body, { attributes:true, attributeFilter:["class"] });
  doc.cleanupFns.push(() => {
    document.removeEventListener("fullscreenchange", syncFullscreenState);
    if (fullscreenClassWatch) fullscreenClassWatch.disconnect();
  });
  applyToolbarVisible();
  syncFullscreenState();              // 이미 전체화면인 채로 악보를 열었을 때

  function syncPartSelectOptions(){
    const active = musicActivePart(sheet);
    const current = active ? active.id : "";
    partSelect.replaceChildren();
    for (const part of musicParts(sheet)){
      const option = document.createElement("option");
      option.value = part.id;
      option.textContent = `${part.muted ? "🔇 " : ""}${part.name}`;
      partSelect.appendChild(option);
    }
    partSelect.value = current;
  }

  function syncPartControls(){
    const part = musicActivePart(sheet);
    syncPartSelectOptions();
    if (!part) return;
    if (document.activeElement !== partNameInput) partNameInput.value = part.name;
    const volume = musicClampPartVolume(part.volume);
    partVolumeInput.value = String(Math.round(volume * 100));
    partVolumeLabel.textContent = `${Math.round(volume * 100)}%`;
    partMuteBtn.classList.toggle("is-on", part.muted === true);
    partMuteBtn.setAttribute("aria-pressed", part.muted ? "true" : "false");
    partMuteBtn.textContent = part.muted ? "🔇" : "M";
    removePartBtn.disabled = musicParts(sheet).length <= 1;
  }

  function selectEditorPart(partId, commit){
    MNMusicAudio.stop();
    const part = musicSelectPart(sheet, partId);
    if (!part) return;
    selection = null;
    activeStaff = "treble";
    activeVoice = 1;
    timbreSelect.value = sheet.timbre;
    grandStaffBtn.textContent = sheet.grandStaff ? "🎹 피아노 대보표" : "🎼 단일 오선";
    toInput.value = String(sheet.measures.length);
    syncPartControls();
    syncTools();
    updateStatus();
    drawScore();
    touch();
    if (commit && history) history.commit();
  }

  function addEditorPart(){
    const choices = ["piano", "guitar", "xylophone", "harp", "flute", "clarinet"];
    const count = musicParts(sheet).length;
    const timbre = choices[count % choices.length];
    const part = musicAddPart(sheet, { name:timbreLabel(timbre), timbre });
    if (!part) return;
    selection = null;
    activeStaff = "treble";
    activeVoice = 1;
    timbreSelect.value = sheet.timbre;
    grandStaffBtn.textContent = "🎼 단일 오선";
    syncPartControls();
    afterEdit();
    partNameInput.focus();
    partNameInput.select();
  }

  async function removeEditorPart(){
    const part = musicActivePart(sheet);
    if (!part || musicParts(sheet).length <= 1) return;
    const hasNotes = part.measures.some((measure) => [measure.notes, measure.voice2Notes,
      measure.bassNotes, measure.bassVoice2Notes].some((notes) => Array.isArray(notes) && notes.length));
    if (hasNotes && (typeof confirmDialog !== "function"
      || !await confirmDialog(`'${part.name}' 파트와 그 음표를 삭제할까요?`, "파트 삭제", "취소"))) return;
    musicRemovePart(sheet, part.id);
    selection = null;
    activeStaff = "treble";
    activeVoice = 1;
    timbreSelect.value = sheet.timbre;
    grandStaffBtn.textContent = sheet.grandStaff ? "🎹 피아노 대보표" : "🎼 단일 오선";
    syncPartControls();
    afterEdit();
  }

  function setEditorPartVolume(value, commit){
    const part = musicActivePart(sheet);
    if (!part) return;
    part.volume = musicClampPartVolume(value);
    syncPartControls();
    touch();
    if (commit && history) history.commit();
  }

  /* ----- 도구·상태 표시 ----- */
  function setToolValue(value){
    if (MUSIC_TOOL_VALUES.some((item) => item.value === value)) tool.value = value;
    syncTools();
  }

  function setToolDots(dots){
    tool.dots = Math.max(0, Math.min(MUSIC_MAX_DOTS, Math.round(Number(dots) || 0)));
    syncTools();
  }

  function setToolRest(rest){ tool.rest = !!rest; if (tool.rest) tool.chord = false; syncTools(); }
  function setToolEraser(eraser){
    tool.eraser = !!eraser;
    if (tool.eraser){ tool.position = false; tool.chord = false; }
    syncTools();
  }
  function setPositionTool(position){
    tool.position = !!position;
    if (tool.position){ tool.eraser = false; tool.chord = false; }
    syncTools();
  }
  function setToolAccidental(alter){ tool.accidental = alter === null ? null : musicClampAlter(alter); syncTools(); }

  function setChordEntry(enabled){
    tool.chord = !!enabled;
    if (tool.chord){
      tool.eraser = false;
      tool.position = false;
      setToolRest(false);
    }
    syncTools();
  }

  function staffNotes(measure, staff, voice){ return musicVoiceNotes(measure, staff, voice || 1); }

  function setActiveVoice(voice){
    activeVoice = Number(voice) === 2 ? 2 : 1;
    selection = null;
    syncTools();
    updateMeasureProgress();
  }

  function setActiveStaff(staff){
    activeStaff = staff === "bass" ? "bass" : "treble";
    if (activeStaff === "bass" && !sheet.grandStaff) setGrandStaff(true);
    easyOctaveSelect.value = activeStaff === "bass" ? "3" : "4";
    select(0, null);
    syncTools();
  }

  async function setGrandStaff(enabled){
    const next = !!enabled;
    if (!next){
      const bassCount = sheet.measures.reduce((sum, measure) => sum
        + staffNotes(measure, "bass", 1).length + staffNotes(measure, "bass", 2).length, 0);
      if (bassCount && (typeof confirmDialog !== "function" ||
          !await confirmDialog(`왼손 음표와 쉼표 ${bassCount}개를 지우고 단일 오선으로 바꿀까요?`, "바꾸기", "취소"))) return;
      for (const measure of sheet.measures){ measure.bassNotes = []; measure.bassVoice2Notes = []; }
      activeStaff = "treble";
    }
    sheet.grandStaff = next;
    grandStaffBtn.textContent = next ? "🎹 피아노 대보표" : "🎼 단일 오선";
    selection = null;
    afterEdit();
    syncTools();
  }

  function toggleSolfege(){
    sheet.showSolfege = sheet.showSolfege === false;
    syncTools();
    afterEdit();
  }

  function resetHoverReadout(){
    hint.textContent = tool.chord
      ? "화음 추가: 기준 음표를 고른 뒤 같은 오선의 음높이를 누르세요"
      : tool.eraser
      ? "지우개: 지울 음표 위로 마우스를 옮겨 보세요"
      : tool.position
        ? "위치 조정: 음표를 좌우로 드래그하세요"
        : "오선 위에 마우스를 올리면 넣을 음을 보여줘요";
    scoreHost.classList.remove("is-invalid-entry");
    hidePitchGuide();
  }

  function syncTools(){
    for (const [value, button] of valueButtons) button.classList.toggle("is-on", tool.value === value);
    dotBtn.classList.toggle("is-on", tool.dots > 0);
    dotBtn.textContent = tool.dots === 2 ? "··겹점" : "·점";
    restBtn.classList.toggle("is-on", tool.rest);
    eraserBtn.classList.toggle("is-on", tool.eraser);
    positionBtn.classList.toggle("is-on", tool.position);
    chordBtn.classList.toggle("is-on", tool.chord);
    rightHandBtn.classList.toggle("is-on", activeStaff === "treble");
    leftHandBtn.classList.toggle("is-on", activeStaff === "bass");
    voice1Btn.classList.toggle("is-on", activeVoice === 1);
    voice2Btn.classList.toggle("is-on", activeVoice === 2);
    leftHandBtn.setAttribute("aria-pressed", activeStaff === "bass" ? "true" : "false");
    rightHandBtn.setAttribute("aria-pressed", activeStaff === "treble" ? "true" : "false");
    const selected = selectedNote();
    removeChordBtn.disabled = !selected || !Array.isArray(selected.chord) || !selected.chord.length;
    tieBtn.disabled = !selected || selected.rest;
    tieBtn.classList.toggle("is-on", !!selected && selected.tieToNext === true);
    slurBtn.disabled = !selected || selected.rest;
    slurBtn.classList.toggle("is-on", !!selected && selected.slurToNext === true);
    chordSymbolBtn.disabled = !selected || selected.rest;
    lyricBtn.disabled = !selected || selected.rest;
    dynamicBtn.disabled = !selected || selected.rest;
    articulationBtn.disabled = !selected || selected.rest;
    tripletBtn.disabled = !selected;
    fingeringBtn.disabled = !selected || selected.rest;
    pedalBtn.disabled = !selected || selected.rest;
    articulationBtn.classList.toggle("is-on", !!selected && !!selected.articulation);
    tripletBtn.classList.toggle("is-on", !!selected && selected.tuplet === 3);
    pedalBtn.classList.toggle("is-on", !!selected && !!selected.pedal);
    const activeMeasure = sheet.measures[activeMeasureIndex()];
    repeatStartBtn.classList.toggle("is-on", !!activeMeasure && activeMeasure.repeatStart === true);
    repeatEndBtn.classList.toggle("is-on", !!activeMeasure && activeMeasure.repeatEnd === true);
    endingBtn.classList.toggle("is-on", !!activeMeasure && (activeMeasure.ending === 1 || activeMeasure.ending === 2));
    endingBtn.textContent = activeMeasure && activeMeasure.ending ? `${activeMeasure.ending}. 괄호` : "1·2번 괄호";
    grandStaffBtn.classList.toggle("is-on", sheet.grandStaff === true);
    if (!root.classList.contains("is-running")){
      playRightBtn.disabled = !sheet.grandStaff;
      playLeftBtn.disabled = !sheet.grandStaff;
    }
    // 손 고르기는 대보표일 때만 뜻이 있다(단일 오선은 늘 오른손 하나뿐).
    practiceStaffSelect.hidden = !sheet.grandStaff;
    if (!sheet.grandStaff) practiceStaffSelect.value = "";
    solfegeBtn.classList.toggle("is-on", sheet.showSolfege !== false);
    solfegeBtn.setAttribute("aria-pressed", sheet.showSolfege !== false ? "true" : "false");
    for (const [alter, button] of accidentalButtons) button.classList.toggle("is-on", !selection && tool.accidental === alter);
    scoreHost.classList.toggle("is-erasing", tool.eraser);
    scoreHost.classList.toggle("is-position-tool", tool.position);
    scoreHost.classList.toggle("is-chord-entry", tool.chord);
    scoreHost.classList.toggle("is-note-entry", !tool.eraser && !tool.position && !tool.chord);
    resetHoverReadout();
  }

  function updateHistoryButtons(){
    undoBtn.disabled = !history || !history.canUndo();
    redoBtn.disabled = !history || !history.canRedo();
  }

  function updateStatus(){
    const total = musicTimeline(sheet).totalSeconds;
    const part = musicActivePart(sheet);
    status.textContent = `${musicParts(sheet).length}파트 · ${part ? part.name + " · " : ""}${sheet.measures.length}마디 · ${total.toFixed(1)}초`;
    updateMeasureProgress();
    const check = musicValidate(sheet);
    if (check.ok){
      notice.hidden = true;
    } else {
      const first = check.issues[0];
      const beatTicks = MUSIC_TICKS_PER_QUARTER * 4 / Math.max(1, Number(sheet.time && sheet.time.beatValue) || 4);
      const beats = (ticks) => musicFriendlyNumber(ticks / beatTicks);
      notice.hidden = false;
      const difference = Math.abs(first.expected - first.actual);
      const detail = first.kind === "over"
        ? `${beats(difference)}박 넘쳐요. 음표를 지우거나 더 짧게 바꿔 보세요.`
        : `${beats(difference)}박 비었어요. ${musicRemainingSuggestion(difference)}`;
      const hand = first.staff === "bass" ? "왼손" : (sheet.grandStaff ? "오른손" : "");
      const voice = first.voice === 2 ? " 성부 2" : "";
      notice.textContent = `⚠ ${first.measure}마디${hand ? ` ${hand}` : ""}${voice}: ${detail}`
        + (check.issues.length > 1 ? ` 외 ${check.issues.length - 1}곳` : "");
    }
  }

  function musicFriendlyNumber(value){
    return Number(value).toFixed(2).replace(/\.?0+$/, "");
  }

  function musicRemainingSuggestion(ticks){
    for (const item of MUSIC_TOOL_VALUES){
      for (let dots = 0; dots <= MUSIC_MAX_DOTS; dots++){
        if (musicNoteTicks({ value:item.value, dots, rest:false }) !== ticks) continue;
        const prefix = dots === 2 ? "겹점 " : dots === 1 ? "점 " : "";
        return `${prefix}${item.label}음표나 같은 길이 쉼표 하나를 넣으면 완성돼요.`;
      }
    }
    return "음표나 쉼표를 더 넣어 마디를 채워 보세요.";
  }

  function activeMeasureIndex(){
    if (selection && sheet.measures[selection.measure]) return selection.measure;
    const incomplete = sheet.measures.findIndex((measure, index) =>
      !musicMeasureProgress(sheet, index, activeStaff, activeVoice).complete);
    return incomplete >= 0 ? incomplete : Math.max(0, sheet.measures.length - 1);
  }

  function updateMeasureProgress(){
    const progress = musicMeasureProgress(sheet, activeMeasureIndex(), activeStaff, activeVoice);
    measureProgress.classList.toggle("is-complete", progress.complete);
    measureProgress.classList.toggle("is-over", progress.over > 0);
    if (progress.over > 0){
      measureProgress.textContent = `${progress.measure}마디 · 성부 ${activeVoice} · ${musicFriendlyNumber(progress.overBeats)}박 초과`;
    } else if (progress.complete){
      measureProgress.textContent = `✓ ${progress.measure}마디 성부 ${activeVoice} 완성 · ${musicFriendlyNumber(progress.expectedBeats)}박`;
    } else {
      measureProgress.textContent = `${progress.measure}마디 · ${musicFriendlyNumber(progress.usedBeats)}/${musicFriendlyNumber(progress.expectedBeats)}박 · ${musicFriendlyNumber(progress.remainingBeats)}박 남음`;
    }
  }

  /* ----- VexFlow 조판 ----- */
  function clampRange(){
    const last = Math.max(1, sheet.measures.length);
    let from = Math.max(1, Math.min(last, Math.round(Number(fromInput.value) || 1)));
    let to = Math.max(1, Math.min(last, Math.round(Number(toInput.value) || last)));
    if (to < from) to = from;
    fromInput.value = String(from);
    toInput.value = String(to);
    fromInput.max = toInput.max = String(last);
    return { from, to };
  }

  /* ----- 보기 배율 -----
     SVG의 transform만 바꾸면 스크롤 영역이 원래 크기로 남는다. 실제 표시 너비·높이를 바꿔
     스크롤바와 클릭 좌표를 함께 맞춘다(scorePoint가 화면 좌표를 SVG 좌표로 다시 환산한다). */
  function clampScoreZoom(value){
    const next = Number(value);
    return Math.max(MUSIC_ZOOM_MIN, Math.min(MUSIC_ZOOM_MAX, Number.isFinite(next) ? next : 1));
  }

  function updateZoomControls(){
    zoomLabel.textContent = Math.round(scoreZoom * 100) + "%";
    zoomOutBtn.disabled = scoreZoom <= MUSIC_ZOOM_MIN + 0.001;
    zoomInBtn.disabled = scoreZoom >= MUSIC_ZOOM_MAX - 0.001;
    zoomFitBtn.disabled = Math.abs(scoreZoom - 1) < 0.001;
  }

  function applyScoreZoom(anchor){
    updateZoomControls();
    const svg = scoreHost.querySelector("svg");
    if (!svg) return;
    const baseWidth = Number(svg.dataset.musicBaseWidth) ||
      ((svg.width && svg.width.baseVal) ? svg.width.baseVal.value : 0);
    const baseHeight = Number(svg.dataset.musicBaseHeight) ||
      ((svg.height && svg.height.baseVal) ? svg.height.baseVal.value : 0);
    if (!(baseWidth > 0) || !(baseHeight > 0)) return;

    const hasAnchor = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y);
    const before = hasAnchor ? svg.getBoundingClientRect() : null;
    const ratioX = before && before.width ? (anchor.x - before.left) / before.width : 0.5;
    const ratioY = before && before.height ? (anchor.y - before.top) / before.height : 0.5;

    svg.style.width = Math.max(1, Math.round(baseWidth * scoreZoom)) + "px";
    svg.style.height = Math.max(1, Math.round(baseHeight * scoreZoom)) + "px";
    svg.style.maxWidth = "none";

    // 휠을 돌린 곳의 악보 지점이 화면에서 움직이지 않도록 새 크기만큼 스크롤을 보정한다.
    if (hasAnchor){
      const after = svg.getBoundingClientRect();
      scoreHost.scrollLeft += after.left + ratioX * after.width - anchor.x;
      scoreHost.scrollTop += after.top + ratioY * after.height - anchor.y;
    }
  }

  function setScoreZoom(value, clientX, clientY){
    scoreZoom = Math.round(clampScoreZoom(value) * 10) / 10;
    const box = scoreHost.getBoundingClientRect();
    const anchor = {
      x:Number.isFinite(clientX) ? clientX : box.left + box.width / 2,
      y:Number.isFinite(clientY) ? clientY : box.top + box.height / 2
    };
    applyScoreZoom(anchor);
  }

  function stepScoreZoom(direction, clientX, clientY){
    setScoreZoom(scoreZoom + (direction > 0 ? MUSIC_ZOOM_STEP : -MUSIC_ZOOM_STEP), clientX, clientY);
  }

  // SVG를 다시 그리거나 아래 오선의 음표를 고를 때 문서 전체가 위로 끌려가지 않게,
  // 악보 스크롤 상자 안에서만 필요한 만큼 움직인다.
  function revealScoreElement(el){
    if (!el || typeof el.getBoundingClientRect !== "function") return;
    const hostRect = scoreHost.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const pad = 24;
    if (rect.top < hostRect.top + pad) scoreHost.scrollTop += rect.top - hostRect.top - pad;
    else if (rect.bottom > hostRect.bottom - pad) scoreHost.scrollTop += rect.bottom - hostRect.bottom + pad;
    if (rect.left < hostRect.left + pad) scoreHost.scrollLeft += rect.left - hostRect.left - pad;
    else if (rect.right > hostRect.right - pad) scoreHost.scrollLeft += rect.right - hostRect.right + pad;
  }

  function drawScore(){
    // replaceChildren()는 스크롤 위치를 0으로 되돌릴 수 있다. 아래 오선을 편집하던 위치를 기억한다.
    const previousScroll = { left:scoreHost.scrollLeft, top:scoreHost.scrollTop };
    const VF = (typeof window !== "undefined") ? window.VexFlow : null;
    noteEls.clear();
    solfegeEls.clear();
    noteHorizontalLimits.clear();
    staveBoxes = [];
    scoreLines = [];
    pitchGuideEl = null;
    scoreHost.replaceChildren();
    if (!VF){
      scoreHost.textContent = "악보 그리기 라이브러리를 불러오지 못했어요.";
      return;
    }
    try {
      const width = Math.max(MUSIC_SCORE_MIN_WIDTH, Math.floor(scoreHost.clientWidth || MUSIC_SCORE_MIN_WIDTH) - 8);
      // 한 줄에 몇 마디를 놓을지는 화면 폭과 마디마다 든 음표 수로 정한다(music-model.js).
      const layout = musicPackLines(sheet.measures, width - 20);
      scoreLines = layout.map((line) => line.indexes.slice());
      const lineHeight = sheet.grandStaff ? MUSIC_GRAND_LINE_HEIGHT : MUSIC_LINE_HEIGHT;
      const renderer = new VF.Renderer(scoreHost, VF.Renderer.Backends.SVG);
      const scoreHeight = layout.length * lineHeight + 30;
      renderer.resize(width, scoreHeight);
      const context = renderer.getContext();
      const scoreSvg = scoreHost.querySelector("svg");
      const places = [];
      const solfegePlaces = [];
      const chordSymbolPlaces = [];
      const notationPlaces = [];
      const drawnSequences = { "treble:1":[], "treble:2":[], "bass:1":[], "bass:2":[] };
      layout.forEach((line, lineIndex) => {
        let x = 10;
        line.indexes.forEach((index, columnIndex) => {
          places.push({ index, lineIndex, x, y:10 + lineIndex * lineHeight,
            width:line.widths[columnIndex], head:columnIndex === 0 });
          x += line.widths[columnIndex];
        });
      });

      function drawStaff(measure, index, lineIndex, stave, staff){
        const voiceDrawings = [];
        for (const voiceNumber of [1, 2]){
          const notes = staffNotes(measure, staff, voiceNumber);
          if (!notes.length) continue;
          const drawn = notes.map((note) => {
            const spec = musicVexNote(note, musicEffectiveMeasureSettings(sheet, index).key, staff);
            const staveNote = new VF.StaveNote({ clef:staff === "bass" ? "bass" : "treble",
              keys:spec.keys, duration:spec.duration });
            if (typeof staveNote.setStemDirection === "function") staveNote.setStemDirection(voiceNumber === 1 ? 1 : -1);
            (spec.accidentals || []).forEach((accidental, pitchIndex) => {
              if (accidental) staveNote.addModifier(new VF.Accidental(accidental), pitchIndex);
            });
            for (let dot = 0; dot < spec.dots; dot++) VF.Dot.buildAndAttach([staveNote], { all:true });
            return { note, staveNote, spec, staff, voice:voiceNumber, index, lineIndex };
          });
          const tuplets = [];
          for (let at = 0; at + 2 < drawn.length; at++){
            const group = drawn.slice(at, at + 3);
            if (!group.every((item) => item.note.tuplet === 3)) continue;
            try { tuplets.push(new VF.Tuplet(group.map((item) => item.staveNote), { num_notes:3, notes_occupied:2 })); }
            catch(error){ console.warn("셋잇단음표를 준비하지 못했어요.", error); }
            at += 2;
          }
          const vexVoice = new VF.Voice(VF.TIME4_4).setMode(VF.Voice.Mode.SOFT)
            .addTickables(drawn.map((item) => item.staveNote));
          voiceDrawings.push({ voiceNumber, drawn, vexVoice, tuplets, beams:VF.Beam.applyAndGetBeams(vexVoice) });
        }
        if (!voiceDrawings.length) return;
        const vexVoices = voiceDrawings.map((item) => item.vexVoice);
        new VF.Formatter().joinVoices(vexVoices).formatToStave(vexVoices, stave, { alignRests:true, stave });

        for (const voiceDrawing of voiceDrawings){
          const { voiceNumber, drawn, vexVoice, tuplets, beams } = voiceDrawing;
          const tickables = drawn.map((item) => item.staveNote);
          const baseXs = tickables.map((item) => item.getAbsoluteX());
          const noteStartX = stave.getNoteStartX();
          const noteEndX = stave.getNoteEndX();
          drawn.forEach((item, at) => {
            const baseX = baseXs[at];
            const leftRoom = at > 0 ? (baseX - baseXs[at - 1]) / 2 - 6 : baseX - noteStartX - 6;
            const rightRoom = at + 1 < baseXs.length ? (baseXs[at + 1] - baseX) / 2 - 6 : noteEndX - baseX - 6;
            const min = Math.max(-MUSIC_X_OFFSET_MAX, -Math.max(0, Math.floor(leftRoom)));
            const max = Math.min(MUSIC_X_OFFSET_MAX, Math.max(0, Math.floor(rightRoom)));
            const applied = Math.max(min, Math.min(max, musicClampXOffset(item.note.xOffset)));
            noteHorizontalLimits.set(item.note.id, { min, max, applied });
            item.staveNote.setXShift(applied);
          });
          vexVoice.setContext(context).setStave(stave).drawWithStyle();
          beams.forEach((beam) => beam.setContext(context).drawWithStyle());
          tuplets.forEach((tuplet) => tuplet.setContext(context).draw());

          const bottomY = stave.getYForLine(4);
          for (const item of drawn){
          const { note, staveNote } = item;
          const el = (typeof staveNote.getSVGElement === "function") ? staveNote.getSVGElement() : null;
          if (el){
            el.classList.add("music-note");
            if (note.rest) el.classList.add("is-rest");
            el.dataset.noteId = note.id;
            el.dataset.measure = String(index + 1);
            el.dataset.staff = staff;
            el.dataset.voice = String(voiceNumber);
            noteEls.set(note.id, el);
          }
          const noteX = staveNote.getAbsoluteX() + staveNote.getXShift();
          if (sheet.showSolfege !== false && !note.rest && scoreSvg){
            solfegePlaces.push({ note, index, staff, voice:voiceNumber, x:noteX,
              y:bottomY + 38 + (voiceNumber === 2 ? 15 : 0) });
          }
          if (note.chordSymbol && scoreSvg){
            chordSymbolPlaces.push({ note, index, staff, voice:voiceNumber, x:noteX,
              y:stave.getYForLine(0) - (staff === "treble" ? 18 : 10) });
          }
          if (scoreSvg && (note.lyric || note.dynamic || note.articulation || note.fingering || note.pedal)){
            const ys = typeof staveNote.getYs === "function" ? staveNote.getYs() : [];
            notationPlaces.push({ note, index, staff, voice:voiceNumber, x:noteX,
              noteY:Number(ys[0]) || stave.getYForLine(2), topY:stave.getYForLine(0), bottomY });
          }
            drawnSequences[`${staff}:${voiceNumber}`].push(item);
          }
        }
      }

      places.forEach(({ index, lineIndex, x, y, width:staveWidth, head }) => {
        const measure = sheet.measures[index];
        const effective = musicEffectiveMeasureSettings(sheet, index);
        const effectiveKeySpec = (MUSIC_KEYS[effective.key] || MUSIC_KEYS.C).vex;
        const trebleStave = new VF.Stave(x, y, staveWidth);
        const bassStave = sheet.grandStaff ? new VF.Stave(x, y + MUSIC_STAFF_GAP, staveWidth) : null;
        // 음자리표·조표는 줄마다 다시 그린다(악보 관례). 박자표는 맨 처음 한 번만.
        if (head){
          trebleStave.addClef("treble");
          if (effective.key !== "C") trebleStave.addKeySignature(effectiveKeySpec);
          if (bassStave){
            bassStave.addClef("bass");
            if (effective.key !== "C") bassStave.addKeySignature(effectiveKeySpec);
          }
        } else if (measure.keyChange){
          trebleStave.addKeySignature(effectiveKeySpec);
          if (bassStave) bassStave.addKeySignature(effectiveKeySpec);
        }
        if (index === 0 || measure.timeChange){
          const timeText = effective.time.beats + "/" + effective.time.beatValue;
          trebleStave.addTimeSignature(timeText);
          if (bassStave) bassStave.addTimeSignature(timeText);
        }
        if (measure.repeatStart){
          trebleStave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
          if (bassStave) bassStave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
        }
        if (measure.repeatEnd){
          trebleStave.setEndBarType(VF.Barline.type.REPEAT_END);
          if (bassStave) bassStave.setEndBarType(VF.Barline.type.REPEAT_END);
        }
        if (measure.ending === 1 || measure.ending === 2){
          trebleStave.setVoltaType(VF.Volta.type.BEGIN_END, `${measure.ending}.`, 0);
        }
        trebleStave.setContext(context).draw();
        if (bassStave) bassStave.setContext(context).draw();

        if (bassStave){
          if (head){
            new VF.StaveConnector(trebleStave, bassStave).setType(VF.StaveConnector.type.BRACE).setContext(context).draw();
            new VF.StaveConnector(trebleStave, bassStave).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
          }
          new VF.StaveConnector(trebleStave, bassStave).setType(VF.StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();
        }
        if (scoreSvg && (measure.tempoChange || measure.pickupTicks)){
          const marker = document.createElementNS("http://www.w3.org/2000/svg", "text");
          marker.classList.add("music-measure-setting");
          marker.textContent = [measure.tempoChange ? `♩=${measure.tempoChange}` : "",
            measure.pickupTicks ? "못갖춘마디" : ""].filter(Boolean).join(" · ");
          marker.setAttribute("x", String(trebleStave.getNoteStartX()));
          marker.setAttribute("y", String(trebleStave.getYForLine(0) - 28));
          scoreSvg.appendChild(marker);
        }

        for (const entry of [{ staff:"treble", stave:trebleStave }, ...(bassStave ? [{ staff:"bass", stave:bassStave }] : [])]){
          const topY = entry.stave.getYForLine(0);
          const bottomY = entry.stave.getYForLine(4);
          staveBoxes.push({ index, lineIndex, staff:entry.staff, x, width:staveWidth, topY, bottomY,
            spacing:(bottomY - topY) / 4, hitTop:topY - 28, hitBottom:bottomY + 28 });
          drawStaff(measure, index, lineIndex, entry.stave, entry.staff);
        }
      });

      // 같은 줄에서 이어지는 같은 높이의 음을 붙임줄로 연결한다.
      for (const staff of ["treble", "bass"]){
        for (const voiceNumber of [1, 2]){
        const sequence = drawnSequences[`${staff}:${voiceNumber}`];
        sequence.forEach((item, at) => {
          if (!item.note.tieToNext || item.note.rest) return;
          const next = sequence[at + 1];
          if (!next || next.note.rest || next.lineIndex !== item.lineIndex) return;
          const nextKeys = next.spec.keys;
          const firstIndices = [];
          const lastIndices = [];
          item.spec.keys.forEach((key, firstIndex) => {
            const lastIndex = nextKeys.indexOf(key);
            if (lastIndex >= 0){ firstIndices.push(firstIndex); lastIndices.push(lastIndex); }
          });
          if (!firstIndices.length) return;
          new VF.StaveTie({ firstNote:item.staveNote, lastNote:next.staveNote,
            firstIndexes:firstIndices, lastIndexes:lastIndices }).setContext(context).draw();
        });
        sequence.forEach((item, at) => {
          if (!item.note.slurToNext || item.note.rest || !scoreSvg) return;
          const next = sequence[at + 1];
          if (!next || next.note.rest || next.lineIndex !== item.lineIndex) return;
          const x1 = item.staveNote.getAbsoluteX() + item.staveNote.getXShift();
          const x2 = next.staveNote.getAbsoluteX() + next.staveNote.getXShift();
          const firstYs = item.staveNote.getYs();
          const lastYs = next.staveNote.getYs();
          const below = voiceNumber === 2;
          const y1 = (Number(firstYs[0]) || 0) + (below ? 13 : -13);
          const y2 = (Number(lastYs[0]) || 0) + (below ? 13 : -13);
          const curve = document.createElementNS("http://www.w3.org/2000/svg", "path");
          curve.classList.add("music-slur");
          const bend = below ? 18 : -18;
          curve.setAttribute("d", `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 + bend} ${x2} ${y2}`);
          scoreSvg.appendChild(curve);
        });
        }
      }
      function appendNotationText(place, text, className, y, italic){
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.textContent = text;
        label.classList.add("music-notation", className);
        label.dataset.noteId = place.note.id;
        label.dataset.measure = String(place.index + 1);
        label.dataset.staff = place.staff;
        label.dataset.voice = String(place.voice);
        label.setAttribute("x", String(place.x));
        label.setAttribute("y", String(y));
        label.setAttribute("text-anchor", "middle");
        if (italic) label.setAttribute("font-style", "italic");
        scoreSvg.appendChild(label);
      }
      for (const place of notationPlaces){
        const note = place.note;
        if (note.fingering) appendNotationText(place, String(note.fingering), "music-fingering",
          place.noteY - (place.voice === 1 ? 19 : -25));
        if (note.articulation){
          const mark = { staccato:"•", accent:">", tenuto:"—" }[note.articulation] || "";
          appendNotationText(place, mark, "music-articulation", place.noteY + (place.voice === 1 ? -11 : 18));
        }
        if (note.lyric) appendNotationText(place, note.lyric, "music-lyric",
          place.bottomY + 54 + (place.voice === 2 ? 16 : 0));
        if (note.dynamic) appendNotationText(place, note.dynamic, "music-dynamic",
          place.bottomY + 70 + (place.voice === 2 ? 16 : 0), true);
        if (note.pedal) appendNotationText(place, note.pedal === "start" ? "Ped." : "✱", "music-pedal",
          place.bottomY + 86 + (place.voice === 2 ? 16 : 0), true);
      }
      // VexFlow가 모든 마디를 그린 뒤 붙여야 뒤쪽 오선이 계이름을 덮지 않는다.
      for (const place of solfegePlaces){
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const alter = musicClampAlter(place.note.alter);
        const mark = alter > 0 ? "♯".repeat(alter) : alter < 0 ? "♭".repeat(-alter) : "";
        label.textContent = (MUSIC_SOLFEGE_LABELS[place.note.step] || place.note.step) + mark;
        label.classList.add("music-solfege");
        label.dataset.noteId = place.note.id;
        label.dataset.measure = String(place.index + 1);
        label.dataset.staff = place.staff;
        label.dataset.voice = String(place.voice);
        label.setAttribute("x", String(place.x));
        label.setAttribute("y", String(place.y));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("aria-label", label.textContent + " 계이름");
        scoreSvg.appendChild(label);
        solfegeEls.set(place.note.id, label);
      }
      for (const place of chordSymbolPlaces){
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.textContent = place.note.chordSymbol;
        label.classList.add("music-chord-symbol");
        label.dataset.noteId = place.note.id;
        label.dataset.measure = String(place.index + 1);
        label.dataset.staff = place.staff;
        label.dataset.voice = String(place.voice);
        label.setAttribute("x", String(place.x));
        label.setAttribute("y", String(place.y));
        label.setAttribute("text-anchor", "middle");
        scoreSvg.appendChild(label);
      }
      const svg = scoreHost.querySelector("svg");
      if (svg){
        svg.dataset.musicBaseWidth = String(width);
        svg.dataset.musicBaseHeight = String(scoreHeight);
        const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
        guide.classList.add("music-pitch-guide");
        guide.setAttribute("visibility", "hidden");
        guide.setAttribute("aria-hidden", "true");
        svg.appendChild(guide);
        pitchGuideEl = guide;
      }
      vexReady = true;
      applyScoreZoom();
      scoreHost.scrollLeft = previousScroll.left;
      scoreHost.scrollTop = previousScroll.top;
      paintSelection();
      paintPractice();          // 배율·창 크기가 바뀌어 다시 그려도 따라치기 진도 표시가 살아남는다
    } catch(error){
      console.warn("악보를 그리지 못했습니다:", error);
      scoreHost.textContent = "악보를 그리지 못했어요. 파일이 손상되었을 수 있어요.";
    }
  }

  function scheduleRedraw(){
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => { if (vexReady) drawScore(); }, MUSIC_REDRAW_DELAY);
  }

  /* ----- 선택 ----- */
  function selectedNote(){
    if (!selection) return null;
    const measure = sheet.measures[selection.measure];
    if (!measure) return null;
    return staffNotes(measure, selection.staff, selection.voice).find((item) => item.id === selection.id) || null;
  }

  function paintSelection(){
    for (const el of noteEls.values()) el.classList.remove("is-selected");
    for (const el of solfegeEls.values()) el.classList.remove("is-selected");
    scoreHost.querySelectorAll(".music-chord-symbol.is-selected,.music-notation.is-selected")
      .forEach((el) => el.classList.remove("is-selected"));
    if (!selection) return;
    const el = noteEls.get(selection.id);
    if (el) el.classList.add("is-selected");
    const label = solfegeEls.get(selection.id);
    if (label) label.classList.add("is-selected");
    const symbol = Array.from(scoreHost.querySelectorAll(".music-chord-symbol"))
      .find((el) => el.dataset.noteId === selection.id);
    if (symbol) symbol.classList.add("is-selected");
    scoreHost.querySelectorAll(`.music-notation[data-note-id="${selection.id}"]`)
      .forEach((item) => item.classList.add("is-selected"));
  }

  function select(measureIndex, noteId, options){
    const staff = options && options.staff === "bass" ? "bass" : activeStaff;
    const voice = options && Number(options.voice) === 2 ? 2 : activeVoice;
    selection = (noteId == null) ? null : { measure:measureIndex, staff, voice, id:noteId };
    if (selection){ activeStaff = staff; activeVoice = voice; }
    paintSelection();
    syncTools();
    updateMeasureProgress();
    if (selection && (!options || options.scroll !== false)){
      const el = noteEls.get(selection.id);
      revealScoreElement(el);
    }
  }

  /* ----- 편집 ----- */
  function afterEdit(){
    touch();
    updateStatus();
    clampRange();
    drawScore();
    if (history && !history.isApplying()) history.commit();
  }

  /* ----- 조옮김 -----
     조표 선택(musicRetuneForKey)은 음표를 제자리에 두고 조표만 바꾼다. 여기는 반대로
     노래 전체를 올리고 내린다. 음역을 벗어나는 음이 생겨도 막지 않고 물어보기만 한다
     — 박자 바꾸기와 같은 규칙이고, 되돌리기 한 번으로 취소된다. */
  function transposeLabel(semitones){
    const item = MUSIC_TRANSPOSE_CHOICES.find((choice) => choice.semitones === Math.abs(semitones));
    const name = item ? item.label : `${Math.abs(semitones)}반음`;
    return `${name} ${semitones > 0 ? "올리기" : "내리기"}`;
  }

  async function applyTranspose(semitones){
    const preview = musicTransposeSheet(sheet, semitones, { apply:false });
    if (preview.blocked > 0){
      if (typeof toast === "function"){
        toast(`음 ${preview.blocked}개가 너무 높거나 낮아 옮길 수 없어요. 더 작은 간격으로 나눠 옮겨 보세요.`,
          3600, { type:"error" });
      }
      return;
    }
    if (!preview.changed && preview.key === sheet.key) return;
    if (preview.outOfRange > 0 && (typeof confirmDialog !== "function"
      || !await confirmDialog(`${transposeLabel(semitones)}: 음 ${preview.outOfRange}개가 이 오선에서 권장하는 음역`
        + `(오른손 G3~C6·왼손 C2~C5)을 벗어나요.\n그래도 옮길까요? (Ctrl+Z로 되돌릴 수 있어요)`, "옮기기", "취소"))) return;

    MNMusicAudio.stop();
    const result = musicTransposeSheet(sheet, semitones);
    keySelect.value = sheet.key;
    afterEdit();
    if (selection) select(selection.measure, selection.id, { staff:selection.staff, voice:selection.voice });
    if (typeof toast === "function"){
      const keyText = result.previousKey === result.key
        ? MUSIC_KEYS[result.key].label
        : `${MUSIC_KEYS[result.previousKey].label} → ${MUSIC_KEYS[result.key].label}`;
      // changed 는 화음음까지 따로 세므로 "음표"가 아니라 "음"이다.
      toast(`${transposeLabel(semitones)} · ${keyText} · 음 ${result.changed}개를 옮겼어요.`, 3000);
    }
  }

  function transposeContextItems(){
    const item = (semitones) => {
      const nextKey = musicTransposedKey(sheet.key, semitones);
      const keyText = nextKey && MUSIC_KEYS[nextKey] ? ` — ${MUSIC_KEYS[nextKey].label}` : "";
      return { label:`${transposeLabel(semitones)}${keyText}`, action:() => applyTranspose(semitones) };
    };
    return [
      ...MUSIC_TRANSPOSE_CHOICES.map((choice) => item(choice.semitones)),
      { separator:true },
      ...MUSIC_TRANSPOSE_CHOICES.map((choice) => item(-choice.semitones))
    ];
  }

  async function loadSelectedExample(){
    const example = musicExampleSheet(exampleSelect.value);
    if (!example){
      if (typeof toast === "function") toast("먼저 시작할 예제를 골라 주세요.", 2200);
      return;
    }
    const hasNotes = sheet.measures.some((measure) =>
      (measure.notes || []).length > 0 || (measure.voice2Notes || []).length > 0 ||
      (measure.bassNotes || []).length > 0 || (measure.bassVoice2Notes || []).length > 0);
    if (hasNotes && (typeof confirmDialog !== "function"
      || !await confirmDialog("현재 악보 내용을 선택한 예제로 바꿀까요?", "바꾸기", "취소"))) return;
    MNMusicAudio.stop();
    sheet.title = example.title;
    sheet.tempo = example.tempo;
    sheet.time = example.time;
    sheet.key = example.key;
    sheet.timbre = example.timbre;
    sheet.drumStyle = example.drumStyle;
    sheet.drumVolume = example.drumVolume;
    sheet.accompanimentMode = example.accompanimentMode;
    sheet.accompanimentTimbre = example.accompanimentTimbre;
    sheet.showSolfege = example.showSolfege;
    sheet.parts = example.parts;
    sheet.activePartId = example.activePartId;
    sheet.grandStaff = example.grandStaff === true;
    sheet.measures = example.measures;
    musicSelectPart(sheet, example.activePartId);
    titleInput.value = sheet.title;
    tempoInput.value = String(sheet.tempo);
    timeSelect.value = `${sheet.time.beats}/${sheet.time.beatValue}`;
    keySelect.value = sheet.key;
    timbreSelect.value = sheet.timbre;
    syncPartControls();
    syncDrumControls();
    grandStaffBtn.textContent = sheet.grandStaff ? "🎹 피아노 대보표" : "🎼 단일 오선";
    activeStaff = "treble";
    activeVoice = 1;
    easyOctaveSelect.value = "4";
    selection = null;
    exampleSelect.value = "";
    afterEdit();
    if (typeof toast === "function") toast(`${sheet.title} 예제로 시작했어요. 바꾸거나 이어서 만들어 보세요.`, 2800);
  }

  function toolAlterForPitch(pitch, measureIndex){
    const key = Number.isInteger(measureIndex) ? musicEffectiveMeasureSettings(sheet, measureIndex).key : sheet.key;
    const keyAlter = musicKeyAlterations(key)[pitch.step] || 0;
    return tool.accidental === null ? keyAlter : tool.accidental;
  }

  function toolNote(pitch, measureIndex, forcedAlter){
    if (tool.rest) return musicRest(tool.value, tool.dots);
    return musicNote(pitch.step, pitch.octave, {
      alter:Number.isFinite(forcedAlter) ? musicClampAlter(forcedAlter) : toolAlterForPitch(pitch, measureIndex),
      value:tool.value, dots:tool.dots
    });
  }

  function musicDurationLabel(note){
    const item = MUSIC_TOOL_VALUES.find((entry) => entry.value === (note && note.value));
    const base = item ? item.label : "4분";
    const prefix = note && note.dots === 2 ? "겹점" : note && note.dots === 1 ? "점" : "";
    return prefix + base + (note && note.rest ? "쉼표" : "음표");
  }

  function musicSolfegeLabel(note){
    if (!note || note.rest) return musicDurationLabel(note);
    const alter = musicClampAlter(note.alter);
    const mark = alter > 0 ? "♯".repeat(alter) : alter < 0 ? "♭".repeat(-alter) : "";
    const korean = (MUSIC_SOLFEGE_LABELS[note.step] || note.step) + mark + note.octave;
    return `${korean} (${musicNoteName(note)}) · ${musicDurationLabel(note)}`;
  }

  function insertNote(measureIndex, pitch, staff, forcedAlter){
    const measure = sheet.measures[measureIndex];
    if (!measure) return;
    const targetStaff = staff === "bass" ? "bass" : activeStaff;
    const targetVoice = activeVoice;
    const note = toolNote(pitch, measureIndex, forcedAlter);
    if (!musicCanFit(sheet, measureIndex, note, targetStaff, targetVoice)){
      if (typeof toast === "function") toast(`${measureIndex + 1}마디가 이미 가득 찼어요. 마디를 더하거나 짧은 음표를 골라 보세요.`, 3000);
      return;
    }
    // 고른 음표가 이 마디에 있으면 그 뒤에, 아니면 마디 끝에 넣는다.
    const notes = staffNotes(measure, targetStaff, targetVoice);
    const current = selectedNote();
    const at = (current && selection.measure === measureIndex && selection.staff === targetStaff && selection.voice === targetVoice)
      ? notes.indexOf(current) + 1 : notes.length;
    notes.splice(at, 0, note);
    tool.accidental = null;                    // 임시표는 한 번 쓰면 풀리고 다시 조표를 따른다
    afterEdit();
    select(measureIndex, note.id, { staff:targetStaff, voice:targetVoice });
    if (!note.rest) MNMusicAudio.previewNote(note, sheet.timbre);
  }

  function insertSequentialPitch(pitch, forcedAlter, keepRest = false){
    // 따라치기·음감 테스트 중에는 '쉬운 입력'의 도레미 버튼이 그대로 누르는 건반이 된다(자판을 못 쓰는 학생용).
    if (!keepRest) tool.rest = false;
    syncTools();
    const candidate = toolNote(pitch, selection ? selection.measure : 0, forcedAlter);
    if (!candidate.rest && !musicMidiInRange(musicMidiNumber(candidate), activeStaff)){
      if (typeof toast === "function") toast("이 악보에서 쓸 수 있는 음역을 벗어나요.", 2200);
      return false;
    }
    const start = selection ? selection.measure : 0;
    let measureIndex = -1;
    for (let index = start; index < sheet.measures.length; index++){
      if (musicCanFit(sheet, index, candidate, activeStaff, activeVoice)){ measureIndex = index; break; }
    }
    if (measureIndex < 0){
      sheet.measures.push(musicMeasure());
      measureIndex = sheet.measures.length - 1;
      toInput.value = String(sheet.measures.length);
      if (typeof toast === "function") toast("빈 마디를 하나 추가하고 이어서 넣었어요.", 2200);
    }
    insertNote(measureIndex, pitch, activeStaff, forcedAlter);
    return true;
  }

  function insertSolfegeNote(step){
    if (!MUSIC_STEPS.includes(step)) return;
    // 따라치기·음감 테스트 중에는 '쉬운 입력'의 도레미 버튼이 그대로 누르는 건반이 된다(자판을 못 쓰는 학생용).
    if (earTest.active()){ earTest.press(MUSIC_STEP_SEMITONES[step]); return; }
    if (practice.active){ practicePress(MUSIC_STEP_SEMITONES[step]); return; }
    const pitch = { step, octave:Math.round(Number(easyOctaveSelect.value) || 4) };
    insertSequentialPitch(pitch);
  }

  function insertKeyboardPitchClass(pitchClass, forcedOctave){
    if (!Number.isFinite(pitchClass)) return false;
    const octave = Number.isFinite(forcedOctave) ? Math.round(forcedOctave) : Math.round(Number(easyOctaveSelect.value) || 4);
    const whiteStep = Object.keys(MUSIC_STEP_SEMITONES).find((step) => MUSIC_STEP_SEMITONES[step] === pitchClass);
    if (whiteStep) return insertSequentialPitch({ step:whiteStep, octave }, undefined, true);
    const settings = musicEffectiveMeasureSettings(sheet, activeMeasureIndex());
    const useFlats = ((MUSIC_KEYS[settings.key] || {}).vex || "").includes("b");
    const pitch = musicPitchFromMidi((octave + 1) * 12 + pitchClass, useFlats);
    return pitch ? insertSequentialPitch(pitch, pitch.alter, true) : false;
  }

  function musicKeyboardHelpText(){
    const mapping = normalizeMusicKeyboard(appSettings.musicKeyboard);
    const white = MUSIC_KEYBOARD_DEFINITIONS.filter((item) => [0, 2, 4, 5, 7, 9, 11].includes(item.pitchClass))
      .map((item) => `${item.label} ${musicKeyboardCodeLabel(mapping[item.id])}`).join(" · ");
    const values = ["noteWhole", "noteHalf", "noteQuarter", "noteEighth", "noteSixteenth"]
      .map((id) => musicKeyboardCodeLabel(mapping[id])).join("/");
    return `${white} · 옥타브 ${musicKeyboardCodeLabel(mapping.octaveDown)}/${musicKeyboardCodeLabel(mapping.octaveUp)}`
      + ` · 길이 ${values} · 쉼표 ${musicKeyboardCodeLabel(mapping.toggleRest)}`
      + ` · 마디/오선 ${musicKeyboardCodeLabel(mapping.addMeasure)}/${musicKeyboardCodeLabel(mapping.addStaff)}`
      + " · ← 짧게 / → 길게";
  }

  function changeSelectedKeyboardDuration(direction){
    const note = selectedNote();
    if (!note || !selection){
      if (typeof toast === "function") toast("먼저 계이름 키로 음표나 쉼표를 넣어 주세요.", 1800);
      return false;
    }
    const currentIndex = MUSIC_KEYBOARD_DURATION_ORDER.indexOf(note.value);
    const from = currentIndex >= 0 ? currentIndex : MUSIC_KEYBOARD_DURATION_ORDER.indexOf("quarter");
    const nextIndex = Math.max(0, Math.min(MUSIC_KEYBOARD_DURATION_ORDER.length - 1,
      from + (direction > 0 ? 1 : -1)));
    if (nextIndex === from){
      if (typeof toast === "function") toast(direction > 0 ? "이미 가장 긴 온음표예요." : "이미 가장 짧은 16분음표예요.", 1400);
      return false;
    }
    const nextValue = MUSIC_KEYBOARD_DURATION_ORDER[nextIndex];
    const measure = sheet.measures[selection.measure];
    const usedWithoutCurrent = musicMeasureUsedTicks(measure, selection.staff, selection.voice) - musicNoteTicks(note);
    const candidate = { ...note, value:nextValue };
    if (usedWithoutCurrent + musicNoteTicks(candidate) > musicMeasureCapacity(sheet, selection.measure)){
      if (typeof toast === "function") toast("이 마디의 남은 박자보다 길어서 늘릴 수 없어요.", 2000);
      return false;
    }
    note.value = nextValue;
    tool.value = nextValue; // 다음에 넣는 음표도 방금 고른 길이에서 시작한다
    afterEdit();
    syncTools();
    updateMeasureProgress();
    return true;
  }

  function setKeyboardCompose(on, announce = true){
    const next = !!on;
    if (next && (practice.active || earTest.active() || root.classList.contains("is-running"))){
      if (announce && typeof toast === "function") toast("재생이나 연습을 끝낸 뒤 자판 작곡을 켜 주세요.", 2400);
      return false;
    }
    keyboardComposeActive = next;
    keyboardComposeBtn.classList.toggle("is-on", next);
    keyboardComposeBtn.setAttribute("aria-pressed", next ? "true" : "false");
    keyboardComposeBtn.textContent = next ? "■ 자판 작곡 끝내기" : "⌨ 자판 작곡";
    root.classList.toggle("is-keyboard-compose", next);
    scoreHost.classList.toggle("is-keyboard-compose", next);
    easyHelp.textContent = next
      ? `${easyOctaveSelect.value}옥타브 · ${musicKeyboardHelpText()} · Esc 끝내기`
      : (practice.active ? musicPracticeHelpText() : MUSIC_EASY_HELP);
    if (next){
      scoreHost.focus({ preventScroll:true });
      if (announce && typeof toast === "function") toast("자판 작곡을 시작했어요. " + musicKeyboardHelpText(), 5200);
    } else if (announce && typeof toast === "function") toast("자판 작곡을 끝냈어요.", 1800);
    return true;
  }
  easyOctaveSelect.addEventListener("change", () => {
    if (keyboardComposeActive) easyHelp.textContent = `${easyOctaveSelect.value}옥타브 · ${musicKeyboardHelpText()} · Esc 끝내기`;
  });

  function deleteNote(measureIndex, noteId, staff, voice){
    const measure = sheet.measures[measureIndex];
    if (!measure) return;
    const targetStaff = staff === "bass" ? "bass" : (selection && selection.id === noteId ? selection.staff : activeStaff);
    const targetVoice = Number(voice) === 2 ? 2 : (selection && selection.id === noteId ? selection.voice : activeVoice);
    const notes = staffNotes(measure, targetStaff, targetVoice);
    const at = notes.findIndex((item) => item.id === noteId);
    if (at < 0) return;
    notes.splice(at, 1);
    const next = notes[at] || notes[at - 1] || null;
    afterEdit();
    select(measureIndex, next ? next.id : null, { staff:targetStaff, voice:targetVoice });
  }

  function addSelectedChordPitch(measureIndex, pitch, staff){
    const note = selectedNote();
    const targetStaff = staff === "bass" ? "bass" : "treble";
    if (!note || note.rest || !selection || selection.measure !== measureIndex || selection.staff !== targetStaff){
      if (typeof toast === "function") toast("먼저 같은 손의 기준 음표를 고른 뒤 화음음을 눌러 주세요.", 2600);
      return;
    }
    const alter = toolAlterForPitch(pitch, measureIndex);
    const extra = { step:pitch.step, octave:pitch.octave, alter };
    if (!musicMidiInRange(musicMidiNumber(extra), targetStaff)){
      if (typeof toast === "function") toast("이 오선에서 쓸 수 있는 음역을 벗어나요.", 2200);
      return;
    }
    if (!musicAddChordPitch(note, extra)){
      if (typeof toast === "function") toast("이미 화음에 들어 있는 음이에요.", 2000);
      return;
    }
    tool.accidental = null;
    const selected = { measure:selection.measure, staff:selection.staff, voice:selection.voice, id:selection.id };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
    MNMusicAudio.previewNote(note, sheet.timbre);
  }

  function removeSelectedChordPitch(){
    const note = selectedNote();
    if (!note || !musicRemoveChordPitch(note)) return;
    const selected = { measure:selection.measure, staff:selection.staff, voice:selection.voice, id:selection.id };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
    MNMusicAudio.previewNote(note, sheet.timbre);
  }

  function nextStaffNote(measureIndex, staff, voice, note){
    for (let index = measureIndex; index < sheet.measures.length; index++){
      const notes = staffNotes(sheet.measures[index], staff, voice);
      const start = index === measureIndex ? notes.indexOf(note) + 1 : 0;
      for (let at = Math.max(0, start); at < notes.length; at++) return notes[at];
    }
    return null;
  }

  function toggleSelectedTie(){
    const note = selectedNote();
    if (!note || note.rest) return;
    if (!note.tieToNext){
      const next = nextStaffNote(selection.measure, selection.staff, selection.voice, note);
      const nextKeys = new Set(musicNotePitches(next).map(musicPitchKey));
      if (!next || next.rest || !musicNotePitches(note).some((pitch) => nextKeys.has(musicPitchKey(pitch)))){
        if (typeof toast === "function") toast("바로 다음에 같은 높이의 음이 있어야 붙임줄을 만들 수 있어요.", 2800);
        return;
      }
      note.tieToNext = true;
    } else {
      delete note.tieToNext;
    }
    const selected = { measure:selection.measure, staff:selection.staff, voice:selection.voice, id:selection.id };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
  }

  function toggleSelectedSlur(){
    const note = selectedNote();
    if (!note || note.rest) return;
    if (!note.slurToNext){
      const next = nextStaffNote(selection.measure, selection.staff, selection.voice, note);
      if (!next || next.rest){
        if (typeof toast === "function") toast("같은 성부의 다음 음표가 있어야 이음줄을 만들 수 있어요.", 2600);
        return;
      }
      note.slurToNext = true;
    } else delete note.slurToNext;
    const selected = { ...selection };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
  }

  async function editSelectedLyric(){
    const note = selectedNote();
    if (!note || note.rest || typeof askText !== "function") return;
    const value = await askText({ title:"가사 편집", message:"이 음표 아래에 붙일 가사 한 음절을 입력하세요. 비우면 지워집니다.",
      value:note.lyric || "", okText:"적용" });
    if (value === null) return;
    const lyric = musicClampText(value, 80);
    if (lyric) note.lyric = lyric;
    else delete note.lyric;
    const selected = { ...selection };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
  }

  async function editSelectedDynamic(){
    const note = selectedNote();
    if (!note || note.rest || typeof askText !== "function") return;
    const value = await askText({ title:"셈여림표 편집", message:"pp, p, mp, mf, f, ff 중 하나를 입력하세요. 비우면 지워집니다.",
      value:note.dynamic || "", placeholder:"pp, p, mp, mf, f, ff", okText:"적용" });
    if (value === null) return;
    const dynamic = String(value).trim().toLowerCase();
    if (dynamic && !["pp", "p", "mp", "mf", "f", "ff"].includes(dynamic)){
      if (typeof toast === "function") toast("pp, p, mp, mf, f, ff 중 하나를 입력해 주세요.", 2400);
      return;
    }
    if (dynamic) note.dynamic = dynamic;
    else delete note.dynamic;
    const selected = { ...selection };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
  }

  function cycleSelectedArticulation(){
    const note = selectedNote();
    if (!note || note.rest) return;
    const order = [null, "staccato", "accent", "tenuto"];
    const next = order[(order.indexOf(note.articulation || null) + 1) % order.length];
    if (next) note.articulation = next;
    else delete note.articulation;
    const labels = { staccato:"스타카토", accent:"악센트", tenuto:"테누토" };
    const selected = { ...selection };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
    if (typeof toast === "function") toast(next ? `${labels[next]}를 표시했어요.` : "연주 기호를 지웠어요.", 1800);
  }

  function toggleSelectedTriplet(){
    const note = selectedNote();
    if (!note || !selection) return;
    const notes = staffNotes(sheet.measures[selection.measure], selection.staff, selection.voice);
    const at = notes.indexOf(note);
    const group = notes.slice(at, at + 3);
    if (group.length < 3){
      if (typeof toast === "function") toast("고른 음표부터 같은 성부의 음표·쉼표 3개가 필요해요.", 2600);
      return;
    }
    const enabled = group.every((item) => item.tuplet === 3);
    for (const item of group){
      if (enabled) delete item.tuplet;
      else item.tuplet = 3;
    }
    const selected = { ...selection };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
  }

  async function editSelectedFingering(){
    const note = selectedNote();
    if (!note || note.rest || typeof askText !== "function") return;
    const value = await askText({ title:"손가락 번호 편집", message:"손가락 번호 1~5를 입력하세요. 비우면 지워집니다.",
      value:note.fingering || "", placeholder:"1~5", okText:"적용" });
    if (value === null) return;
    const fingering = Math.round(Number(value));
    if (String(value).trim() && (fingering < 1 || fingering > 5)){
      if (typeof toast === "function") toast("손가락 번호는 1~5로 입력해 주세요.", 2200);
      return;
    }
    if (String(value).trim()) note.fingering = fingering;
    else delete note.fingering;
    const selected = { ...selection };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
  }

  function cycleSelectedPedal(){
    const note = selectedNote();
    if (!note || note.rest) return;
    if (!note.pedal) note.pedal = "start";
    else if (note.pedal === "start") note.pedal = "stop";
    else delete note.pedal;
    const selected = { ...selection };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
  }

  function toggleMeasureMark(name, measureIndex){
    const index = Number.isInteger(measureIndex) ? measureIndex : activeMeasureIndex();
    const measure = sheet.measures[index];
    if (!measure) return;
    measure[name] = measure[name] !== true;
    afterEdit();
  }

  function cycleMeasureEnding(measureIndex){
    const index = Number.isInteger(measureIndex) ? measureIndex : activeMeasureIndex();
    const measure = sheet.measures[index];
    if (!measure) return;
    if (!measure.ending) measure.ending = 1;
    else if (measure.ending === 1) measure.ending = 2;
    else delete measure.ending;
    afterEdit();
  }

  async function editActiveMeasureSettings(measureIndex){
    if (typeof askText !== "function") return;
    const index = Number.isInteger(measureIndex) ? measureIndex : activeMeasureIndex();
    const measure = sheet.measures[index];
    if (!measure) return;
    const effective = musicEffectiveMeasureSettings(sheet, index);
    const timeValue = await askText({ title:"마디 박자", message:`${index + 1}마디부터 바꿀 박자를 입력하세요. 비우면 앞 마디 설정을 따릅니다.`,
      value:measure.timeChange ? `${measure.timeChange.beats}/${measure.timeChange.beatValue}` : "", placeholder:"예: 3/4", okText:"다음" });
    if (timeValue !== null){
      const parsed = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(timeValue);
      if (!String(timeValue).trim()) delete measure.timeChange;
      else if (parsed) measure.timeChange = musicNormalizeTime({ beats:Number(parsed[1]), beatValue:Number(parsed[2]) });
      else if (typeof toast === "function") toast("박자는 3/4처럼 입력해 주세요.", 2200);
    }
    const keyValue = await askText({ title:"마디 조표", message:`${index + 1}마디부터 바꿀 조표 ID를 입력하세요. 비우면 앞 마디 설정을 따릅니다.`,
      value:measure.keyChange || "", placeholder:"예: C, Bb, F#m", okText:"다음" });
    if (keyValue !== null){
      const key = String(keyValue).trim();
      if (!key) delete measure.keyChange;
      else if (MUSIC_KEYS[key]) measure.keyChange = key;
      else if (typeof toast === "function") toast("상단 조표 목록에 있는 이름을 입력해 주세요.", 2400);
    }
    const tempoValue = await askText({ title:"마디 빠르기", message:`${index + 1}마디부터 바꿀 빠르기를 입력하세요. 비우면 앞 마디 설정을 따릅니다.`,
      value:measure.tempoChange || "", placeholder:"예: 120", okText:"다음" });
    if (tempoValue !== null){
      if (!String(tempoValue).trim()) delete measure.tempoChange;
      else measure.tempoChange = Math.max(MUSIC_TEMPO_MIN, Math.min(MUSIC_TEMPO_MAX,
        Math.round(Number(tempoValue) || effective.tempo)));
    }
    if (index === 0){
      const beatTicks = MUSIC_TICKS_PER_QUARTER * 4 / effective.time.beatValue;
      const currentBeats = measure.pickupTicks ? musicFriendlyNumber(measure.pickupTicks / beatTicks) : "";
      const pickupValue = await askText({ title:"못갖춘마디", message:"못갖춘마디(여린내기)의 박 수를 입력하세요. 비우거나 0이면 보통 마디입니다.",
        value:currentBeats, placeholder:"예: 1", okText:"적용" });
      if (pickupValue !== null){
        const beats = Number(pickupValue);
        const fullTicks = effective.time.beats * beatTicks;
        if (beats > 0 && beats * beatTicks < fullTicks) measure.pickupTicks = Math.round(beats * beatTicks);
        else delete measure.pickupTicks;
      }
    }
    afterEdit();
  }

  async function editSelectedChordSymbol(){
    const note = selectedNote();
    if (!note || note.rest || typeof askText !== "function") return;
    const value = await askText({ title:"코드 기호 편집", message:"음표 위에 표시할 코드 기호를 입력하세요. 비우면 지워집니다.",
      value:note.chordSymbol || "", placeholder:"예: Cm7, B♭, E♭/G", okText:"적용" });
    if (value === null) return;
    const symbol = musicClampChordSymbol(value);
    if (symbol) note.chordSymbol = symbol;
    else delete note.chordSymbol;
    const selected = { measure:selection.measure, staff:selection.staff, voice:selection.voice, id:selection.id };
    afterEdit();
    select(selected.measure, selected.id, { staff:selected.staff, voice:selected.voice });
  }

  function shiftSelected(steps){
    const note = selectedNote();
    if (!note || note.rest) return;
    const pitches = [{ step:note.step, octave:note.octave, alter:note.alter },
      ...(Array.isArray(note.chord) ? note.chord : [])];
    const movedPitches = pitches.map((pitch) => musicShiftPitch(pitch, steps, selection.staff));
    if (movedPitches.some((pitch) => !pitch)){
      if (typeof toast === "function") toast("이 악보에서 쓸 수 있는 음역을 벗어나요.", 2200);
      return;
    }
    note.step = movedPitches[0].step;
    note.octave = movedPitches[0].octave;
    note.alter = pitches[0].alter;
    const extras = movedPitches.slice(1).map((pitch, index) => ({
      step:pitch.step, octave:pitch.octave, alter:pitches[index + 1].alter
    }));
    if (extras.length) note.chord = extras;
    else delete note.chord;
    const selected = { measure:selection.measure, staff:selection.staff, voice:selection.voice, id:selection.id };
    afterEdit();
    select(selected.measure, note.id, { staff:selected.staff, voice:selected.voice });
    MNMusicAudio.previewNote(note, sheet.timbre);
  }

  function resetSelectedHorizontalPosition(){
    const note = selectedNote();
    if (!note || !musicClampXOffset(note.xOffset)) return;
    delete note.xOffset;
    const measureIndex = selection.measure;
    afterEdit();
    select(measureIndex, note.id, { staff:selection.staff, voice:selection.voice });
  }

  function applyAccidental(alter){
    const note = selectedNote();
    if (note && !note.rest){
      // 같은 임시표를 다시 누르면 제자리로 돌린다.
      note.alter = (note.alter === alter) ? 0 : alter;
      afterEdit();
      select(selection.measure, note.id, { staff:selection.staff, voice:selection.voice });
      MNMusicAudio.previewNote(note, sheet.timbre);
      return;
    }
    tool.accidental = (tool.accidental === alter) ? null : alter;
    syncTools();
  }

  function moveSelection(delta){
    const flat = [];
    sheet.measures.forEach((measure, index) => {
      for (const staff of (sheet.grandStaff ? ["treble", "bass"] : ["treble"])){
        for (const voice of [1, 2]){
          for (const note of staffNotes(measure, staff, voice)) flat.push({ measure:index, staff, voice, id:note.id });
        }
      }
    });
    if (!flat.length) return;
    let at = selection ? flat.findIndex((item) => item.id === selection.id) : -1;
    at = (at < 0) ? (delta > 0 ? 0 : flat.length - 1) : Math.max(0, Math.min(flat.length - 1, at + delta));
    select(flat[at].measure, flat[at].id, { staff:flat[at].staff, voice:flat[at].voice });
  }

  function addMeasure(){
    sheet.measures.push(musicMeasure());
    afterEdit();
    toInput.value = String(sheet.measures.length);
    clampRange();
  }

  function addStaffLine(){
    // 새 단은 줄바꿈 표시를 가진 빈 마디로 시작한다. 뒤의 ＋마디는 이 단에 이어 붙는다.
    sheet.measures.push(musicMeasure([], { lineBreakBefore:true }));
    afterEdit();
    toInput.value = String(sheet.measures.length);
    clampRange();
  }

  async function removeStaffLine(){
    // ＋오선으로 만든 마지막 줄바꿈부터 끝까지가 마지막으로 추가한 오선 한 단이다.
    let at = -1;
    for (let index = sheet.measures.length - 1; index > 0; index--){
      if (sheet.measures[index] && sheet.measures[index].lineBreakBefore){ at = index; break; }
    }
    if (at < 0){
      if (typeof toast === "function") toast("추가한 오선이 없어요.", 2200);
      return;
    }
    const removed = sheet.measures.slice(at);
    const noteCount = removed.reduce((sum, measure) => sum + ((measure && measure.notes) || []).length
      + ((measure && measure.voice2Notes) || []).length + ((measure && measure.bassNotes) || []).length
      + ((measure && measure.bassVoice2Notes) || []).length, 0);
    if (noteCount > 0 && (typeof confirmDialog !== "function" ||
        !await confirmDialog(`마지막 오선에 음표 또는 쉼표 ${noteCount}개가 있어요. 오선 전체를 지울까요?`, "지우기", "취소"))) return;
    sheet.measures.splice(at);
    selection = null;
    afterEdit();
    toInput.value = String(sheet.measures.length);
    clampRange();
  }

  function removeMeasure(measureIndex){
    if (sheet.measures.length <= 1){
      if (typeof toast === "function") toast("마디는 하나 이상 있어야 해요.", 2200);
      return;
    }
    const requested = Number(measureIndex);
    const at = Number.isInteger(requested) && requested >= 0 && requested < sheet.measures.length
      ? requested : (selection ? selection.measure : sheet.measures.length - 1);
    const removed = sheet.measures.splice(at, 1)[0];
    // 새 단의 첫 마디를 지우면 다음 마디가 그 줄바꿈을 이어받는다.
    if (at > 0 && removed && removed.lineBreakBefore && sheet.measures[at]){
      sheet.measures[at].lineBreakBefore = true;
    }
    if (sheet.measures[0]) sheet.measures[0].lineBreakBefore = false;
    selection = null;
    afterEdit();
  }

  async function resetScoreContent(){
    musicSyncActivePart(sheet);
    const itemCount = musicParts(sheet).reduce((partSum, part) => partSum + part.measures.reduce((sum, measure) =>
      sum + ((measure && measure.notes) || []).length + ((measure && measure.voice2Notes) || []).length
      + ((measure && measure.bassNotes) || []).length + ((measure && measure.bassVoice2Notes) || []).length, 0), 0);
    if (itemCount === 0 && sheet.measures.length === 1){
      if (typeof toast === "function") toast("이미 비어 있는 악보예요.", 2000);
      return;
    }
    const message = itemCount > 0
      ? `음표와 쉼표 ${itemCount}개를 모두 지우고 빈 악보로 초기화할까요?\n제목·빠르기·박자·조표·음색은 그대로 유지됩니다.`
      : "빈 마디와 오선 구성을 지우고 빈 1마디로 초기화할까요?\n제목과 음악 설정은 그대로 유지됩니다.";
    if (typeof confirmDialog !== "function" || !await confirmDialog(message, "초기화", "취소")) return;
    MNMusicAudio.stop();
    selection = null;
    for (const part of musicParts(sheet)) part.measures = [musicMeasure()];
    const active = musicActivePart(sheet);
    sheet.measures = active ? active.measures : [musicMeasure()];
    fromInput.value = "1";
    toInput.value = "1";
    afterEdit();
    if (typeof toast === "function") toast("악보를 비웠어요. Ctrl+Z로 되돌릴 수 있어요.", 2600);
  }

  /* ----- 오선 클릭 ----- */
  function scorePoint(event){
    const svg = scoreHost.querySelector("svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // CSS 로 크기가 달라졌을 수 있으므로 SVG 좌표계로 되돌린다.
    const userWidth = (svg.width && svg.width.baseVal) ? svg.width.baseVal.value : rect.width;
    const userHeight = (svg.height && svg.height.baseVal) ? svg.height.baseVal.value : rect.height;
    return {
      x:(event.clientX - rect.left) * (userWidth / rect.width),
      y:(event.clientY - rect.top) * (userHeight / rect.height)
    };
  }

  function staveBoxAtPoint(point){
    if (!point) return null;
    return staveBoxes.find((item) =>
      point.x >= item.x && point.x <= item.x + item.width && point.y >= item.hitTop && point.y <= item.hitBottom) || null;
  }

  function scoreHasOverflow(){
    return scoreHost.scrollWidth > scoreHost.clientWidth + 1 ||
      scoreHost.scrollHeight > scoreHost.clientHeight + 1;
  }

  function scorePanAreaAt(event){
    const target = event.target && event.target.closest ? event.target.closest("[data-note-id]") : null;
    return !target && !staveBoxAtPoint(scorePoint(event));
  }

  function updateScorePanCursor(event){
    const ready = !scorePan && scoreHasOverflow() && scorePanAreaAt(event);
    scoreHost.classList.toggle("is-pan-ready", ready);
    if (ready) hidePitchGuide();
    return ready;
  }

  function staveLineAtScorePoint(point, box){
    if (!point || !box || !box.spacing) return null;
    return Math.round(((point.y - box.topY) / box.spacing) * 2) / 2;
  }

  function pitchAtScorePoint(point, box){
    const lineValue = staveLineAtScorePoint(point, box);
    if (lineValue === null) return null;
    // 줄 값(0=맨 윗줄)으로 바꾼 뒤 0.5 칸(줄·칸)에 붙인다.
    return musicPitchFromStaveLine(lineValue, box.staff);
  }

  function hidePitchGuide(){
    if (pitchGuideEl) pitchGuideEl.setAttribute("visibility", "hidden");
  }

  function updatePitchGuide(point, box, invalid){
    const lineValue = staveLineAtScorePoint(point, box);
    // 실제 오선 5줄 안은 이미 위치가 보인다. 그 위·아래의 보이지 않는 음높이만 안내한다.
    if (!pitchGuideEl || lineValue === null || (lineValue >= 0 && lineValue <= 4)){
      hidePitchGuide();
      return;
    }
    const y = box.topY + lineValue * box.spacing;
    pitchGuideEl.setAttribute("x1", String(box.x + 5));
    pitchGuideEl.setAttribute("x2", String(box.x + box.width - 5));
    pitchGuideEl.setAttribute("y1", String(y));
    pitchGuideEl.setAttribute("y2", String(y));
    pitchGuideEl.classList.toggle("is-invalid", !!invalid);
    pitchGuideEl.removeAttribute("visibility");
  }

  function noteByElement(target){
    if (!target) return null;
    const measureIndex = (Number(target.dataset.measure) || 1) - 1;
    const measure = sheet.measures[measureIndex];
    const staff = target.dataset.staff === "bass" ? "bass" : "treble";
    const voice = Number(target.dataset.voice) === 2 ? 2 : 1;
    const note = measure && staffNotes(measure, staff, voice).find((item) => item.id === target.dataset.noteId);
    return note ? { note, measureIndex, staff, voice } : null;
  }

  /* ----- 악보 우클릭 편집 메뉴 -----
     도구막대와 별도 편집 로직을 만들지 않고 위의 공용 동작을 그대로 부른다. 음표를 누른
     경우에는 그 음표용 명령을 먼저, 빈 오선에서는 다음 입력 도구를 먼저 보여 준다. */
  function cancelContextSubClose(){
    if (contextSubTimer){ clearTimeout(contextSubTimer); contextSubTimer = null; }
  }

  function closeContextLayers(depth){
    while (contextLayers.length > depth){
      const layer = contextLayers.pop();
      if (layer.__parentButton) layer.__parentButton.classList.remove("is-open");
      layer.remove();
    }
  }

  function closeMusicContextMenu(){
    cancelContextSubClose();
    closeContextLayers(0);
    if (contextOutside){ document.removeEventListener("pointerdown", contextOutside, true); contextOutside = null; }
    if (contextKeydown){ document.removeEventListener("keydown", contextKeydown, true); contextKeydown = null; }
    if (contextResize){ window.removeEventListener("resize", contextResize); contextResize = null; }
  }

  function placeContextSub(menu, button){
    const anchor = button.getBoundingClientRect();
    const margin = 6, width = menu.offsetWidth, height = menu.offsetHeight;
    let left = anchor.right - 4;
    if (left + width > window.innerWidth - margin) left = anchor.left - width + 4;
    menu.style.left = Math.max(margin, left) + "px";
    menu.style.top = Math.max(margin, Math.min(window.innerHeight - height - margin, anchor.top - 5)) + "px";
  }

  function renderMusicContextLayer(items, depth){
    const menu = document.createElement("div");
    menu.className = depth ? "music-context-menu music-context-sub" : "music-context-menu";
    menu.setAttribute("role", "menu");
    menu.addEventListener("pointerenter", cancelContextSubClose);
    for (const item of items){
      if (item.separator){
        const separator = document.createElement("div");
        separator.className = "music-context-sep";
        separator.setAttribute("role", "separator");
        menu.appendChild(separator);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", item.active === undefined ? "menuitem" : "menuitemcheckbox");
      if (item.active !== undefined) button.setAttribute("aria-checked", item.active ? "true" : "false");
      button.textContent = item.label;
      button.disabled = !!item.disabled;
      button.classList.toggle("is-active", !!item.active);
      const children = Array.isArray(item.children) ? item.children : [];
      if (children.length){
        button.classList.add("music-context-parent");
        const openChildren = () => {
          if (button.disabled) return;
          const opened = contextLayers[depth + 1];
          if (opened && opened.__parentButton === button) return;
          closeContextLayers(depth + 1);
          const sub = renderMusicContextLayer(children, depth + 1);
          sub.__parentButton = button;
          document.body.appendChild(sub);
          contextLayers.push(sub);
          button.classList.add("is-open");
          placeContextSub(sub, button);
        };
        button.addEventListener("pointerenter", () => { cancelContextSubClose(); openChildren(); });
        button.addEventListener("click", openChildren);
      } else {
        button.addEventListener("pointerenter", () => {
          if (contextLayers.length <= depth + 1) return;
          cancelContextSubClose();
          contextSubTimer = setTimeout(() => closeContextLayers(depth + 1), 220);
        });
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          if (button.disabled) return;
          closeMusicContextMenu();
          if (typeof item.action === "function") item.action();
        });
      }
      menu.appendChild(button);
    }
    return menu;
  }

  function openMusicContextMenu(x, y, items){
    closeMusicContextMenu();
    const menu = renderMusicContextLayer(items, 0);
    document.body.appendChild(menu);
    contextLayers.push(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, x)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, y)) + "px";
    contextOutside = (event) => {
      if (!contextLayers.some((layer) => layer.contains(event.target))) closeMusicContextMenu();
    };
    contextKeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (contextLayers.length > 1) closeContextLayers(contextLayers.length - 1);
      else closeMusicContextMenu();
    };
    contextResize = closeMusicContextMenu;
    setTimeout(() => {
      if (!contextLayers.length) return;
      document.addEventListener("pointerdown", contextOutside, true);
      document.addEventListener("keydown", contextKeydown, true);
      window.addEventListener("resize", contextResize);
    }, 0);
    const first = menu.querySelector("button:not(:disabled)");
    if (first) first.focus({ preventScroll:true });
  }

  function nextInputContextItems(){
    return [
      { label:"입력 오선", children:[
        { label:"오른손 · 높은음자리표", active:activeStaff === "treble", action:() => setActiveStaff("treble") },
        { label:"왼손 · 낮은음자리표", active:activeStaff === "bass", action:() => setActiveStaff("bass") }
      ] },
      { label:"입력 성부", children:[
        { label:"성부 1", active:activeVoice === 1, action:() => setActiveVoice(1) },
        { label:"성부 2", active:activeVoice === 2, action:() => setActiveVoice(2) }
      ] },
      { label:"음표 길이", children:MUSIC_TOOL_VALUES.map((item) => ({
        label:item.label + "음표", active:tool.value === item.value, action:() => setToolValue(item.value)
      })) },
      { label:"점", children:[
        { label:"점 없음", active:tool.dots === 0, action:() => setToolDots(0) },
        { label:"점음표", active:tool.dots === 1, action:() => setToolDots(1) },
        { label:"겹점음표", active:tool.dots === 2, action:() => setToolDots(2) }
      ] },
      { label:"입력 종류", children:[
        { label:"음표", active:!tool.rest, action:() => setToolRest(false) },
        { label:"쉼표", active:tool.rest, action:() => setToolRest(true) }
      ] },
      { label:"다음 임시표", children:[
        { label:"조표 따름", active:tool.accidental === null, action:() => setToolAccidental(null) },
        { label:"♯ 올림표", active:tool.accidental === 1, action:() => setToolAccidental(1) },
        { label:"♭ 내림표", active:tool.accidental === -1, action:() => setToolAccidental(-1) },
        { label:"♮ 제자리표", active:tool.accidental === 0, action:() => setToolAccidental(0) }
      ] },
      { label:"쉬운 입력 옥타브", children:[2, 3, 4, 5].map((octave) => ({
        label:`${octave}옥타브`, active:Number(easyOctaveSelect.value) === octave,
        action:() => { easyOctaveSelect.value = String(octave); }
      })) },
      { label:"도레미 빠른 입력", children:MUSIC_STEPS.map((step) => ({
        label:`${MUSIC_SOLFEGE_LABELS[step]} (${step})`, action:() => insertSolfegeNote(step)
      })) },
      { separator:true },
      { label:"화음음 추가 모드", active:tool.chord, action:() => setChordEntry(!tool.chord),
        disabled:!selectedNote() || selectedNote().rest },
      { label:"지우개 모드", active:tool.eraser, action:() => setToolEraser(!tool.eraser) },
      { label:"MIDI 건반으로 입력", active:midiInputEnabled, action:() => { toggleMidiInput(); } }
    ];
  }

  function playbackContextItems(targetMeasure){
    const measure = targetMeasure + 1;
    const running = MNMusicAudio.playing();
    return [
      { label:"전체 재생", action:() => startPlay(null), disabled:running },
      { label:"현재 파트만 재생", action:() => {
        const part = musicActivePart(sheet); startPlay(null, { partId:part && part.id });
      }, disabled:running },
      { label:"오른손만 재생", action:() => startPlay(null, { staff:"treble" }), disabled:running || !sheet.grandStaff },
      { label:"왼손만 재생", action:() => startPlay(null, { staff:"bass" }), disabled:running || !sheet.grandStaff },
      { label:"지정 구간 재생", action:() => startPlay(clampRange()), disabled:running },
      { label:`${measure}마디 반복`, action:() => {
        fromInput.value = toInput.value = String(measure);
        startPlay({ from:measure, to:measure }, { loop:true });
      }, disabled:running },
      { label:"정지", action:() => MNMusicAudio.stop(), disabled:!running },
      { separator:true },
      // 도구막대를 접어 두고 쓰는 사람을 위해 여기에도 둔다. 그만두기는 Esc 로 — 연습 중에는
      // 우클릭 메뉴 자체가 열리지 않는다(연습 중 편집 메뉴를 여는 길을 막아 둬서).
      { label:"따라치기(자판으로 음 맞추기)", disabled:running, action:() => { practiceBtn.click(); } },
      { label:"음감 테스트(듣고 음 맞히기)", disabled:running, action:() => { earBtn.click(); } },
      { label:"연습 속도", children:[0.5, 0.75, 1].map((rate) => ({
        label:`${Math.round(rate * 100)}%`, active:Number(speedSelect.value) === rate,
        action:() => { speedSelect.value = String(rate); }
      })) },
      { label:"1234 준비", active:countInEnabled,
        action:() => { countInEnabled = !countInEnabled; syncPracticeControls(); } },
      { label:"메트로놈", active:metronomeEnabled,
        action:() => { metronomeEnabled = !metronomeEnabled; syncPracticeControls(); } },
      { label:"드럼 반주", children:MUSIC_DRUM_STYLES.map((style) => ({
        label:MUSIC_DRUM_STYLE_SPECS[style].label,
        active:musicDrumStyle(sheet.drumStyle) === style,
        disabled:running || !musicDrumStyleCompatible(style, sheet.time),
        action:() => setDrumStyle(style)
      })) },
      { label:"반주 구성", children:[["drums", "드럼만"], ["bass", "드럼+베이스"], ["full", "전체 반주"]]
        .map(([mode, label]) => ({
          label, active:musicAccompanimentMode(sheet.accompanimentMode) === mode,
          disabled:running || musicDrumStyle(sheet.drumStyle) === "off",
          action:() => setAccompanimentMode(mode)
        })) },
      { label:"코드 악기", children:[["piano", "피아노"], ["guitar", "기타"]]
        .map(([timbre, label]) => ({
          label, active:musicAccompanimentTimbre(sheet.accompanimentTimbre) === timbre,
          disabled:running || musicDrumStyle(sheet.drumStyle) === "off"
            || musicAccompanimentMode(sheet.accompanimentMode) !== "full",
          action:() => setAccompanimentTimbre(timbre)
        })) },
      { label:"반주 음량", children:[0.25, 0.5, 0.75, 1].map((volume) => ({
        label:`${Math.round(volume * 100)}%`, active:Math.abs(musicClampDrumVolume(sheet.drumVolume) - volume) < 0.01,
        disabled:running,
        action:() => setDrumVolume(volume, true)
      })) },
      { label:"음소거", active:MNMusicAudio.muted(), action:() => {
        MNMusicAudio.setMuted(!MNMusicAudio.muted());
        syncVolumeControls();
      } },
      { label:"음량", children:[0.25, 0.5, 0.75, 1].map((volume) => ({
        label:`${Math.round(volume * 100)}%`, active:Math.abs(MNMusicAudio.getVolume() - volume) < 0.01,
        action:() => {
          MNMusicAudio.setVolume(volume);
          MNMusicAudio.setMuted(false);
          volumeInput.value = String(Math.round(volume * 100));
          syncVolumeControls();
        }
      })) }
    ];
  }

  function scoreContextItems(noteInfo, measureIndex){
    const note = noteInfo && noteInfo.note;
    const targetMeasure = Math.max(0, Math.min(sheet.measures.length - 1,
      Number.isInteger(measureIndex) ? measureIndex : (selection ? selection.measure : sheet.measures.length - 1)));
    const canRemoveStaff = sheet.measures.some((measure, index) => index > 0 && measure && measure.lineBreakBefore);
    // 누른 마디가 놓인 단 — 조판은 창 폭에 따라 바뀌므로 그때그때 찾는다.
    const targetLine = scoreLines.findIndex((indexes) => indexes.includes(targetMeasure));
    const items = [];
    if (note){
      items.push(
        { label:"이 음표 미리 듣기", action:() => MNMusicAudio.previewNote(note, sheet.timbre), disabled:note.rest },
        { label:"임시표", children:[
          { label:"♯ 올림표", active:note.alter === 1, action:() => applyAccidental(1), disabled:note.rest },
          { label:"♭ 내림표", active:note.alter === -1, action:() => applyAccidental(-1), disabled:note.rest },
          { label:"♮ 제자리표", active:note.alter === 0, action:() => applyAccidental(0), disabled:note.rest }
        ] },
        { label:"음높이", children:[
          { label:"한 음 올리기 (↑)", action:() => shiftSelected(1), disabled:note.rest },
          { label:"한 음 내리기 (↓)", action:() => shiftSelected(-1), disabled:note.rest },
          { separator:true },
          { label:"한 옥타브 올리기 (Shift+↑)", action:() => shiftSelected(7), disabled:note.rest },
          { label:"한 옥타브 내리기 (Shift+↓)", action:() => shiftSelected(-7), disabled:note.rest }
        ] },
        { label:"좌우 위치 원래대로", action:resetSelectedHorizontalPosition,
          disabled:!musicClampXOffset(note.xOffset) },
        { label:"화음", children:[
          { label:"화음음 추가 모드", active:tool.chord,
            action:() => { tool.chord = true; setToolRest(false); syncTools(); }, disabled:note.rest },
          { label:"마지막 화음음 삭제", action:removeSelectedChordPitch,
            disabled:note.rest || !Array.isArray(note.chord) || !note.chord.length },
          { label:"붙임줄", active:note.tieToNext === true, action:toggleSelectedTie, disabled:note.rest },
          { label:"이음줄", active:note.slurToNext === true, action:toggleSelectedSlur, disabled:note.rest },
          { label:"코드 기호…", action:editSelectedChordSymbol, disabled:note.rest }
        ] },
        { label:"표현·가사", children:[
          { label:"가사…", action:editSelectedLyric, disabled:note.rest },
          { label:"셈여림…", action:editSelectedDynamic, disabled:note.rest },
          { label:"연주 기호 바꾸기", action:cycleSelectedArticulation, disabled:note.rest },
          { label:"셋잇단음표 묶기/해제", active:note.tuplet === 3, action:toggleSelectedTriplet },
          { label:"운지 번호…", action:editSelectedFingering, disabled:note.rest },
          { label:"페달 표시 바꾸기", action:cycleSelectedPedal, disabled:note.rest }
        ] },
        { label:"이 음표 삭제 (Delete)", action:() => deleteNote(noteInfo.measureIndex, note.id, noteInfo.staff, noteInfo.voice) },
        { separator:true }
      );
    }
    items.push(
      { label:"다음 입력 도구", children:nextInputContextItems() },
      { label:"위치 조정 모드", active:tool.position, action:() => setPositionTool(!tool.position) },
      { label:"악보 구조", children:[
        { label:"단일 오선", active:!sheet.grandStaff, action:() => setGrandStaff(false) },
        { label:"피아노 대보표", active:sheet.grandStaff, action:() => setGrandStaff(true) },
        { label:"입력 성부 1", active:activeVoice === 1, action:() => setActiveVoice(1) },
        { label:"입력 성부 2", active:activeVoice === 2, action:() => setActiveVoice(2) },
        { separator:true },
        { label:`${targetMeasure + 1}마디 반복 시작`, active:sheet.measures[targetMeasure].repeatStart === true,
          action:() => toggleMeasureMark("repeatStart", targetMeasure) },
        { label:`${targetMeasure + 1}마디 반복 끝`, active:sheet.measures[targetMeasure].repeatEnd === true,
          action:() => toggleMeasureMark("repeatEnd", targetMeasure) },
        { label:`${targetMeasure + 1}마디 1·2번 괄호`, active:!!sheet.measures[targetMeasure].ending,
          action:() => cycleMeasureEnding(targetMeasure) },
        { label:`${targetMeasure + 1}마디 박자·조표·빠르기…`, action:() => editActiveMeasureSettings(targetMeasure) },
        { separator:true },
        { label:"마지막에 마디 추가", action:addMeasure },
        { label:`${targetMeasure + 1}마디 삭제`, action:() => removeMeasure(targetMeasure), disabled:sheet.measures.length <= 1 },
        { separator:true },
        { label:"마지막에 오선 추가", action:addStaffLine },
        { label:"마지막 오선 삭제", action:removeStaffLine, disabled:!canRemoveStaff },
        { separator:true },
        { label:"악보 내용 초기화…", action:resetScoreContent }
      ] },
      { label:"조옮김", children:transposeContextItems() },
      { separator:true },
      { label:"재생·연습", children:playbackContextItems(targetMeasure) },
      { label:"계이름 표시", active:sheet.showSolfege !== false, action:toggleSolfege },
      { label:toolbarVisible ? "편집 도구막대 숨기기 (H)" : "편집 도구막대 보이기 (H)", action:toggleToolbarVisibility },
      { label:"보기 배율", children:[
        { label:"확대 (Ctrl++)", action:() => stepScoreZoom(1), disabled:scoreZoom >= MUSIC_ZOOM_MAX - 0.001 },
        { label:"축소 (Ctrl+-)", action:() => stepScoreZoom(-1), disabled:scoreZoom <= MUSIC_ZOOM_MIN + 0.001 },
        { label:"100% 맞춤 (Ctrl+0)", active:Math.abs(scoreZoom - 1) < 0.001, action:() => setScoreZoom(1) }
      ] },
      { label:"저장·내보내기", children:[
        { label:"악보 저장 (Ctrl+S)", action:() => saveMusicSheet(doc) },
        { label:targetLine >= 0 ? `이 단(${musicRangeLabel(scoreLines[targetLine])})을 메모로` : "이 단을 메모로",
          action:() => sendScoreToMemo(targetLine), disabled:targetLine < 0 },
        { label:"악보 전체를 메모로", action:() => sendScoreToMemo(null) },
        { label:"MusicXML 저장", action:exportMusicXml },
        { label:"MIDI 저장", action:exportMusicMidi },
        { label:"악보 이미지 참고…", action:() => imageReferenceInput.click() },
        { label:"WAV 저장", action:exportMusicWav, disabled:wavBtn.disabled },
        { label:"인쇄 · PDF 저장", action:printScore }
      ] },
      { separator:true },
      { label:"되돌리기 (Ctrl+Z)", action:() => history && history.undo(), disabled:!history || !history.canUndo() },
      { label:"다시 실행 (Ctrl+Y)", action:() => history && history.redo(), disabled:!history || !history.canRedo() }
    );
    return items;
  }

  function openScoreContextAt(clientX, clientY, target){
    const noteTarget = target && target.closest ? target.closest("[data-note-id]") : null;
    const noteInfo = noteByElement(noteTarget);
    if (noteInfo) select(noteInfo.measureIndex, noteInfo.note.id,
      { scroll:false, staff:noteInfo.staff, voice:noteInfo.voice });
    const box = staveBoxAtPoint(scorePoint({ clientX, clientY }));
    const measureIndex = noteInfo ? noteInfo.measureIndex : (box ? box.index : null);
    openMusicContextMenu(clientX, clientY, scoreContextItems(noteInfo, measureIndex));
  }

  function onScoreContextMenu(event){
    event.preventDefault();
    event.stopPropagation();
    if (practice.active || earTest.active()) return;   // 편집 메뉴는 연습·테스트가 끝난 뒤에
    openScoreContextAt(event.clientX, event.clientY, event.target);
  }

  function openKeyboardScoreContextMenu(){
    const target = selection ? noteEls.get(selection.id) : null;
    const rect = (target || scoreHost).getBoundingClientRect();
    openScoreContextAt(rect.left + Math.min(24, rect.width / 2), rect.top + Math.min(24, rect.height / 2), target || scoreHost);
  }

  function setHoverReadout(text, invalid){
    if (hint.textContent !== text) hint.textContent = text;
    scoreHost.classList.toggle("is-invalid-entry", !!invalid);
  }

  scoreHost.addEventListener("contextmenu", onScoreContextMenu);
  scoreHost.addEventListener("scroll", closeMusicContextMenu);

  scoreHost.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const target = event.target && event.target.closest ? event.target.closest("[data-note-id]") : null;
    // 따라치기 중에는 음표를 끌어 옮기지 못하게 한다. 손바닥으로 악보를 끄는 것(scorePan)은 그대로 둔다.
    const existing = practice.active ? null : noteByElement(target);
    const horizontalDrag = existing && (tool.position || (event.pointerType !== "touch" && event.altKey));
    const pitchDrag = existing && !existing.note.rest && !tool.eraser && !tool.position && !event.altKey
      && event.pointerType !== "touch";
    if (horizontalDrag || pitchDrag){
      const point = scorePoint(event);
      const limits = noteHorizontalLimits.get(existing.note.id) ||
        { min:-MUSIC_X_OFFSET_MAX, max:MUSIC_X_OFFSET_MAX, applied:musicClampXOffset(existing.note.xOffset) };
      const box = staveBoxes.find((item) => item.index === existing.measureIndex && item.staff === existing.staff);
      if (!point) return;
      select(existing.measureIndex, existing.note.id,
        { scroll:false, staff:existing.staff, voice:existing.voice });
      noteDrag = {
        pointerId:event.pointerId,
        kind:horizontalDrag ? "horizontal" : "pitch",
        note:existing.note,
        staff:existing.staff,
        measureIndex:existing.measureIndex,
        startX:point.x,
        startY:point.y,
        startPitch:{ step:existing.note.step, octave:existing.note.octave, alter:existing.note.alter },
        startChord:(Array.isArray(existing.note.chord) ? existing.note.chord : []).map((pitch) => ({
          step:pitch.step, octave:pitch.octave, alter:pitch.alter
        })),
        spacing:box && box.spacing,
        startOffset:limits.applied,
        min:limits.min,
        max:limits.max,
        appliedSteps:0,
        moved:false
      };
      closeMusicContextMenu();
      scoreHost.classList.add(horizontalDrag ? "is-positioning" : "is-pitching");
      if (scoreHost.setPointerCapture) scoreHost.setPointerCapture(event.pointerId);
      // 일반 클릭의 미리듣기는 뒤의 click 경로가 맡는다. 실제 이동이 시작된 뒤에만 기본 동작을 막는다.
      if (horizontalDrag) event.preventDefault();
      return;
    }
    if (event.pointerType === "touch" || !updateScorePanCursor(event)) return;
    scorePan = {
      pointerId:event.pointerId,
      x:event.clientX,
      y:event.clientY,
      left:scoreHost.scrollLeft,
      top:scoreHost.scrollTop,
      moved:false
    };
    if (scoreHost.setPointerCapture) scoreHost.setPointerCapture(event.pointerId);
  });

  scoreHost.addEventListener("pointermove", (event) => {
    if (noteDrag && noteDrag.pointerId === event.pointerId){
      const point = scorePoint(event);
      if (!point) return;
      if (noteDrag.kind === "pitch"){
        const dy = point.y - noteDrag.startY;
        if (!noteDrag.moved && Math.abs(dy) < 3) return;
        noteDrag.moved = true;
        const steps = -Math.round(dy / Math.max(1, (noteDrag.spacing || 10) / 2));
        const sourcePitches = [noteDrag.startPitch, ...noteDrag.startChord];
        const movedPitches = sourcePitches.map((pitch) => musicShiftPitch(pitch, steps, noteDrag.staff));
        if (movedPitches.some((pitch) => !pitch)){
          hidePitchGuide();
          setHoverReadout("음높이 이동 불가: 사용할 수 있는 음역을 벗어났어요", true);
          event.preventDefault();
          return;
        }
        if (steps !== noteDrag.appliedSteps){
          noteDrag.appliedSteps = steps;
          noteDrag.note.step = movedPitches[0].step;
          noteDrag.note.octave = movedPitches[0].octave;
          if (movedPitches.length > 1){
            noteDrag.note.chord = movedPitches.slice(1).map((pitch, index) => ({
              step:pitch.step, octave:pitch.octave, alter:noteDrag.startChord[index].alter
            }));
          }
          touch();
          drawScore();
        }
        const dragBox = staveBoxes.find((item) => item.index === noteDrag.measureIndex && item.staff === noteDrag.staff);
        updatePitchGuide(point, dragBox, false);
        scoreHost.classList.add("is-pitching");
        setHoverReadout("음높이 이동: " + musicSolfegeLabel(noteDrag.note), false);
        event.preventDefault();
        return;
      }
      const next = Math.max(noteDrag.min, Math.min(noteDrag.max,
        Math.round(noteDrag.startOffset + point.x - noteDrag.startX)));
      if (!noteDrag.moved && Math.abs(point.x - noteDrag.startX) < 2) return;
      noteDrag.moved = true;
      if (next) noteDrag.note.xOffset = next;
      else delete noteDrag.note.xOffset;
      touch();
      drawScore();
      scoreHost.classList.add("is-positioning");
      setHoverReadout(`위치 조정: ${next > 0 ? "+" : ""}${next}`, false);
      event.preventDefault();
      return;
    }
    // 손가락은 hover가 없고 움직임이 스크롤이므로 마우스·펜의 공중 이동만 안내한다.
    if (event.pointerType === "touch") return;
    if (scorePan && scorePan.pointerId === event.pointerId){
      const dx = event.clientX - scorePan.x;
      const dy = event.clientY - scorePan.y;
      if (!scorePan.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      scorePan.moved = true;
      scoreHost.classList.remove("is-pan-ready");
      scoreHost.classList.add("is-panning");
      scoreHost.scrollLeft = scorePan.left - dx;
      scoreHost.scrollTop = scorePan.top - dy;
      event.preventDefault();
      return;
    }
    updateScorePanCursor(event);
    const target = event.target && event.target.closest ? event.target.closest("[data-note-id]") : null;
    const existing = noteByElement(target);
    if (existing){
      hidePitchGuide();
      setHoverReadout((tool.eraser ? "지우기: " : tool.position ? "위치 조정: " : existing.note.rest ? "현재 쉼표: " : "위아래로 드래그: ")
        + musicSolfegeLabel(existing.note), false);
      return;
    }
    if (tool.eraser || tool.position){ resetHoverReadout(); return; }

    const point = scorePoint(event);
    const box = staveBoxAtPoint(point);
    const pitch = pitchAtScorePoint(point, box);
    if (!box || !pitch){ resetHoverReadout(); return; }

    const preview = tool.rest
      ? { rest:true, value:tool.value, dots:tool.dots }
      : { rest:false, step:pitch.step, octave:pitch.octave,
          alter:toolAlterForPitch(pitch, box.index), value:tool.value, dots:tool.dots };
    const midi = musicMidiNumber(preview);
    if (!tool.rest && !musicMidiInRange(midi, box.staff)){
      updatePitchGuide(point, box, true);
      setHoverReadout("입력 불가: 사용할 수 있는 음역을 벗어났어요", true);
      return;
    }
    if (!tool.chord && !musicCanFit(sheet, box.index, preview, box.staff, activeVoice)){
      if (!tool.rest) updatePitchGuide(point, box, true);
      setHoverReadout(`입력 불가: ${box.index + 1}마디가 가득 찼어요`, true);
      return;
    }
    if (tool.rest) hidePitchGuide();
    else updatePitchGuide(point, box, false);
    setHoverReadout("입력 위치: " + musicSolfegeLabel(preview), false);
  });

  function finishNoteDrag(event){
    if (!noteDrag || noteDrag.pointerId !== event.pointerId) return;
    const moved = noteDrag.moved;
    const pitchChanged = noteDrag.kind === "pitch" && noteDrag.appliedSteps !== 0;
    const draggedNote = noteDrag.note;
    noteDrag = null;
    scoreHost.classList.remove("is-positioning", "is-pitching");
    hidePitchGuide();
    if (scoreHost.hasPointerCapture && scoreHost.hasPointerCapture(event.pointerId)){
      scoreHost.releasePointerCapture(event.pointerId);
    }
    if (moved){
      if (history && !history.isApplying()) history.commit();
      if (pitchChanged) MNMusicAudio.previewNote(draggedNote, sheet.timbre);
      suppressScoreClick = true;
      setTimeout(() => { suppressScoreClick = false; }, 0);
      event.preventDefault();
    }
    resetHoverReadout();
  }

  function finishScorePan(event){
    if (!scorePan || scorePan.pointerId !== event.pointerId) return;
    const moved = scorePan.moved;
    scorePan = null;
    scoreHost.classList.remove("is-panning");
    if (scoreHost.hasPointerCapture && scoreHost.hasPointerCapture(event.pointerId)){
      scoreHost.releasePointerCapture(event.pointerId);
    }
    if (moved){
      suppressScoreClick = true;
      setTimeout(() => { suppressScoreClick = false; }, 0);
      event.preventDefault();
    }
    if (event.type !== "pointercancel") updateScorePanCursor(event);
  }
  function finishScorePointer(event){
    finishNoteDrag(event);
    finishScorePan(event);
  }
  scoreHost.addEventListener("pointerup", finishScorePointer);
  scoreHost.addEventListener("pointercancel", finishScorePointer);
  scoreHost.addEventListener("pointerleave", () => {
    if (!noteDrag) resetHoverReadout();
    if (!scorePan) scoreHost.classList.remove("is-pan-ready");
  });

  scoreHost.addEventListener("click", (event) => {
    hidePitchGuide();
    if (practice.active) return;                 // 따라치기 중에는 오선을 눌러도 음표가 들어가지 않는다
    if (suppressScoreClick){
      suppressScoreClick = false;
      event.preventDefault();
      return;
    }
    const target = event.target && event.target.closest ? event.target.closest("[data-note-id]") : null;
    if (target){
      const measureIndex = (Number(target.dataset.measure) || 1) - 1;
      const staff = target.dataset.staff === "bass" ? "bass" : "treble";
      const voice = Number(target.dataset.voice) === 2 ? 2 : 1;
      if (tool.eraser){ deleteNote(measureIndex, target.dataset.noteId, staff, voice); return; }
      select(measureIndex, target.dataset.noteId, { scroll:false, staff, voice });
      fromInput.value = String(measureIndex + 1);
      if (Number(toInput.value) < measureIndex + 1) toInput.value = String(measureIndex + 1);
      const note = selectedNote();
      if (note && !note.rest) MNMusicAudio.previewNote(note, sheet.timbre);
      return;
    }
    if (tool.eraser || tool.position) return;
    const point = scorePoint(event);
    if (!point) return;
    const box = staveBoxAtPoint(point);
    const pitch = pitchAtScorePoint(point, box);
    if (!box || !pitch) return;
    const midi = musicMidiNumber({ step:pitch.step, octave:pitch.octave, alter:toolAlterForPitch(pitch, box.index) });
    if (!tool.rest && !musicMidiInRange(midi, box.staff)){
      if (typeof toast === "function") toast("이 악보에서 쓸 수 있는 음역을 벗어나요.", 2200);
      return;
    }
    if (tool.chord) addSelectedChordPitch(box.index, pitch, box.staff);
    else insertNote(box.index, pitch, box.staff);
  });

  // 긴 악보는 일반 휠로 위아래 움직여야 하므로 Ctrl(맥은 Command)+휠일 때만 배율을 바꾼다.
  scoreHost.addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    stepScoreZoom(event.deltaY < 0 ? 1 : -1, event.clientX, event.clientY);
  }, { passive:false });

  /* ----- 자판 ----- */
  function editableTarget(target){
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  function onKeyDown(event){
    if (doc.el.hidden) return;                       // 다른 문서를 보고 있으면 관여하지 않는다
    /* 음감 테스트 중에도 자판이 통째로 '답을 누르는 건반'이 된다. 악보를 감춰 둔 동안 편집 키가
       들으면 안 되므로 따라치기와 같이 캡처 단계에서 삼키고 전파까지 끊는다.
       4단계에서 옥타브를 물을 때만 숫자키의 뜻이 음이름에서 옥타브로 바뀐다. */
    if (earTest.active()){
      const claimEar = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.key === "Escape"){ claimEar(); stopEarTest(); return; }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (earTest.finished()){
        if (event.key === "Enter"){ claimEar(); stopEarTest(); }
        return;
      }
      if (earTest.needsOctave()){
        const octave = event.code ? MUSIC_EAR_OCTAVE_KEYS[event.code] : undefined;
        if (octave !== undefined){ claimEar(); if (!event.repeat) earTest.answerOctave(octave); }
        return;
      }
      if (event.code === "Space"){ claimEar(); if (!event.repeat) earTest.replay(); return; }
      const answerPc = musicKeyboardPitchClassForEvent(event);
      if (answerPc !== undefined){ claimEar(); if (!event.repeat) earTest.press(answerPc); }
      return;
    }
    // 따라치기 중에는 자판이 통째로 '건반'이 된다. 악보를 바꾸는 키(음표 길이·화살표·되돌리기…)는
    // 여기서 전부 막는다 — 교본이 연습 도중 바뀌면 지금 어디를 누르고 있는지가 어긋난다.
    if (practice.active){
      // 이 핸들러는 document 의 캡처 단계에 있다. 연습 중 삼킨 키는 전파까지 끊어,
      // 다른 곳에 걸린 한 글자 단축키가 같은 키에 함께 반응하지 않게 한다.
      const claim = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.key === "Escape"){ claim(); stopPractice("cancel"); return; }
      if (event.altKey) return;
      if (event.ctrlKey || event.metaKey){
        const key = event.key.toLowerCase();          // 보기 배율만 연습 중에도 그대로 쓸 수 있게 남긴다
        if (key === "=" || key === "+"){ claim(); stepScoreZoom(1); }
        else if (key === "-"){ claim(); stepScoreZoom(-1); }
        else if (key === "0"){ claim(); setScoreZoom(1); }
        return;
      }
      if (event.key === "Backspace"){ claim(); if (!event.repeat) practiceBack(); return; }
      const pitchClass = musicKeyboardPitchClassForEvent(event);
      if (pitchClass !== undefined){
        claim();
        if (!event.repeat) practicePress(pitchClass);  // 키를 누르고 있어도 한 번만 친 것으로 센다
      }
      return;
    }
    if (keyboardComposeActive && !editableTarget(event.target) && !document.querySelector(".modal:not([hidden])")){
      const claimCompose = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.key === "Escape"){ claimCompose(); setKeyboardCompose(false); return; }
      if (event.code === "ArrowLeft" || event.code === "ArrowRight"){
        claimCompose();
        if (!event.repeat) changeSelectedKeyboardDuration(event.code === "ArrowRight" ? 1 : -1);
        return;
      }
      const action = musicKeyboardActionForEvent(event, appSettings.musicKeyboard);
      if (action){
        claimCompose();
        if (event.repeat) return;
        const pitchClass = MUSIC_KEYBOARD_PITCH_CLASSES[action];
        if (action === "octaveDown" || action === "octaveUp"){
          const options = Array.from(easyOctaveSelect.options).map((option) => Number(option.value));
          const current = Math.round(Number(easyOctaveSelect.value) || 4);
          const next = Math.max(Math.min(...options), Math.min(Math.max(...options), current + (action === "octaveUp" ? 1 : -1)));
          easyOctaveSelect.value = String(next);
          easyHelp.textContent = `${next}옥타브 · ${musicKeyboardHelpText()} · Esc 끝내기`;
          if (typeof toast === "function") toast(`${next}옥타브로 입력합니다.`, 1300);
          return;
        }
        if (MUSIC_KEYBOARD_NOTE_VALUES[action]){
          setToolValue(MUSIC_KEYBOARD_NOTE_VALUES[action]);
          return;
        }
        if (action === "toggleRest"){
          setToolRest(!tool.rest);
          return;
        }
        if (action === "cycleDots"){
          setToolDots((tool.dots + 1) % (MUSIC_MAX_DOTS + 1));
          return;
        }
        if (Object.prototype.hasOwnProperty.call(MUSIC_KEYBOARD_ACCIDENTALS, action)){
          setToolAccidental(MUSIC_KEYBOARD_ACCIDENTALS[action]);
          return;
        }
        if (action === "addMeasure"){
          addMeasure();
          if (typeof toast === "function") toast("빈 마디를 추가했어요.", 1400);
          return;
        }
        if (action === "addStaff"){
          addStaffLine();
          if (typeof toast === "function") toast("새 오선을 추가했어요.", 1400);
          return;
        }
        if (Number.isFinite(pitchClass)) insertKeyboardPitchClass(pitchClass);
        return;
      }
    }
    if (editableTarget(event.target)) return;
    if (contextLayers.length) return;                 // 메뉴가 열려 있으면 버튼 탐색·Esc 닫기를 메뉴에 맡긴다
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")){
      event.preventDefault();
      openKeyboardScoreContextMenu();
      return;
    }
    if (event.ctrlKey || event.metaKey){
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey){ event.preventDefault(); history.undo(); return; }
      if (key === "y" || (key === "z" && event.shiftKey)){ event.preventDefault(); history.redo(); return; }
      if (key === "=" || key === "+"){ event.preventDefault(); stepScoreZoom(1); return; }
      if (key === "-"){ event.preventDefault(); stepScoreZoom(-1); return; }
      if (key === "0"){ event.preventDefault(); setScoreZoom(1); return; }
      return;
    }
    if (event.altKey) return;

    const index = ["1", "2", "3", "4", "5"].indexOf(event.key);
    if (index >= 0){ setToolValue(MUSIC_TOOL_VALUES[index].value); event.preventDefault(); return; }
    switch (event.key){
      case "r": case "R":
        setToolRest(!tool.rest); event.preventDefault(); break;
      case "h": case "H":
        toggleToolbarVisibility(); event.preventDefault(); break;
      case ".":
        setToolDots((tool.dots + 1) % (MUSIC_MAX_DOTS + 1)); event.preventDefault(); break;
      case "ArrowUp":
        shiftSelected(event.shiftKey ? 7 : 1); event.preventDefault(); break;
      case "ArrowDown":
        shiftSelected(event.shiftKey ? -7 : -1); event.preventDefault(); break;
      case "ArrowLeft":
        moveSelection(-1); event.preventDefault(); break;
      case "ArrowRight":
        moveSelection(1); event.preventDefault(); break;
      case "Delete": case "Backspace":
        if (selection){ deleteNote(selection.measure, selection.id); event.preventDefault(); }
        break;
      case "Escape":
        select(0, null); break;
      default: break;
    }
  }

  /* ----- 따라치기(음 맞추기) -----
     채점 규칙 — 코드 따라치기와 같은 결로 맞췄다.
     · 옥타브는 통과시킨다: 음이름(도·레·미…)만 맞으면 몇 옥타브에서 눌러도 맞은 것으로 본다.
     · 틀린 키는 진도를 나가지 않는다. 글자와 달리 음은 "틀린 것을 그 자리에 보여 줄" 수 없어,
       진도까지 나가면 학생이 노래의 어디인지를 잃는다. 대신 지금 차례를 빨갛게 두고 실수로 센다.
     · 맞게 누르면 진도가 나가되 빨간 표시는 남는다(정확도에 반영).
     · Backspace 로 한 음 되돌아가면 그 자리 빨간 표시가 지워지고 정확도가 도로 올라간다. */
  const MUSIC_EASY_HELP = easyHelp.textContent;
  function musicPracticeKeyHelp(){
    const mapping = normalizeMusicKeyboard(appSettings.musicKeyboard);
    return MUSIC_KEYBOARD_DEFINITIONS.filter((item) => Number.isFinite(item.pitchClass))
      .map((item) => `${item.label} ${musicKeyboardCodeLabel(mapping[item.id])}`).join(" · ") + " · 숫자 1~7도 도~시";
  }
  // 연습 중 '쉬운 입력' 도움말 줄 — 무엇으로 누르는지를 모아 두는 자리라 MIDI 건반도 여기서 안내한다.
  // 건반이 붙어 있는지는 권한 없이 알 수 없으므로(아래 practiceMidiHint 참고) 이 줄이 첫 안내가 된다.
  function musicPracticeHelpText(){
    return musicPracticeKeyHelp()
      + (typeof navigator !== "undefined" && navigator.requestMIDIAccess ? " · 피아노는 🎹 MIDI 입력을 켜세요" : "");
  }

  function practiceUseFlats(){
    return ((MUSIC_KEYS[sheet.key] || {}).vex || "").includes("b");
  }
  // 음이름 하나를 소리로 들려준다. 화음이면 note.chord 에 얹어 한 번에 울린다
  // (previewNote 는 부를 때마다 앞의 미리듣기를 취소해서, 여러 번 나눠 부르면 마지막 하나만 난다).
  function practicePreviewMidis(midis){
    const flats = practiceUseFlats();
    const pitches = (midis || []).map((midi) => musicPitchFromMidi(midi, flats)).filter(Boolean);
    if (!pitches.length) return;
    const [first, ...rest] = pitches;
    MNMusicAudio.previewNote({ rest:false, step:first.step, octave:first.octave, alter:first.alter, chord:rest },
      sheet.timbre);
  }
  // 틀린 키를 눌렀을 때 들려줄 높이 — 지금 차례의 음에서 가장 가까운 옥타브로 잡는다.
  function practiceNearMidi(pc, baseMidi){
    const base = Number.isFinite(baseMidi) ? baseMidi : 60;
    const start = Math.round((base - pc) / 12) * 12 + pc;
    let best = start;
    for (const candidate of [start - 12, start, start + 12]){
      if (Math.abs(candidate - base) < Math.abs(best - base)) best = candidate;
    }
    return Math.max(MUSIC_BASS_RANGE_MIN_MIDI, Math.min(MUSIC_RANGE_MAX_MIDI, best));
  }

  function paintPracticeStep(step, cls){
    for (const id of step.noteIds){
      const el = noteEls.get(id);
      if (el) el.classList.add(cls);
      const label = solfegeEls.get(id);
      if (label) label.classList.add(cls);
    }
  }

  function paintPractice(){
    for (const el of noteEls.values()) el.classList.remove("mp-ok", "mp-bad", "mp-now");
    for (const el of solfegeEls.values()) el.classList.remove("mp-ok", "mp-bad", "mp-now");
    if (!practice.active) return;
    for (let index = 0; index < practice.steps.length; index++){
      const mark = practice.state[index];
      if (mark) paintPracticeStep(practice.steps[index], mark === 2 ? "mp-bad" : "mp-ok");
    }
    const current = practice.steps[practice.pos];
    if (!current) return;
    paintPracticeStep(current, "mp-now");
    if (practice.err) paintPracticeStep(current, "mp-bad");   // 이번 차례에서 틀린 적이 있다
  }

  function revealPracticeStep(){
    const current = practice.steps[practice.pos];
    if (!current) return;
    for (const id of current.noteIds){
      const el = noteEls.get(id);
      if (el){ revealScoreElement(el); return; }
    }
  }

  function practiceStats(){
    const ms = Math.max(1, Date.now() - practice.startedAt);
    const total = practice.total, done = practice.done, notes = practice.notes;
    return { total, done, notes, wrong:practice.wrong, bad:practice.bad,
      percent:total ? Math.round((done / total) * 100) : 100,
      // 정확도는 '지금 남아 있는 빨간 음표' 기준 — 되돌아가 다시 맞게 누르면 도로 올라간다.
      accuracy:done ? Math.round(((done - practice.bad) / done) * 100) : 100,
      seconds:Math.max(1, Math.round(ms / 1000)),
      npm:Math.round(notes / (ms / 60000)) };
  }

  function updatePracticeInfo(){
    if (!practice.active){ practiceInfo.textContent = ""; return; }
    const stats = practiceStats();
    const step = practice.steps[practice.pos];
    const measure = step ? ` · ${step.measure}마디` : "";
    practiceInfo.textContent = `${stats.done}/${stats.total} · 정확도 ${stats.accuracy}%${measure}`;
  }

  // 쉼표만 있는 자리는 그냥 지나간다(코드 따라치기의 줄 앞 들여쓰기와 같다).
  function practiceSkipAuto(){
    while (practice.pos < practice.steps.length && practice.steps[practice.pos].auto){
      practice.state[practice.pos] = 1;
      practice.pos++;
    }
  }

  function practiceAdvance(){
    const step = practice.steps[practice.pos];
    practice.state[practice.pos] = practice.err ? 2 : 1;
    if (practice.err) practice.bad++;
    practice.done++;
    practice.notes += step ? step.pcs.length : 0;
    practice.pos++;
    practice.hit = new Set();
    practice.err = false;
    practiceSkipAuto();
    if (practice.pos >= practice.steps.length){ stopPractice("done"); return; }
    paintPractice();
    revealPracticeStep();
    updatePracticeInfo();
  }

  function practiceBack(){
    if (!practice.active) return;
    // 화음을 치다 만 중간이면 그 차례만 처음으로 되돌린다.
    if (practice.hit.size || practice.err){
      practice.hit = new Set();
      practice.err = false;
      paintPractice();
      updatePracticeInfo();
      return;
    }
    let at = practice.pos - 1;
    while (at >= 0 && practice.steps[at].auto) at--;
    if (at < 0) return;
    if (practice.state[at] === 2) practice.bad--;
    practice.done = Math.max(0, practice.done - 1);
    practice.notes = Math.max(0, practice.notes - practice.steps[at].pcs.length);
    for (let index = at; index < practice.pos; index++) practice.state[index] = 0;
    practice.pos = at;
    paintPractice();
    revealPracticeStep();
    updatePracticeInfo();
  }

  // 자판·도레미 버튼·MIDI 건반이 모두 이 문 하나로 들어온다. pc 는 옥타브를 뺀 음이름(0~11).
  function practicePress(pc){
    if (!practice.active || !Number.isFinite(pc)) return;
    const step = practice.steps[practice.pos];
    if (!step) return;
    if (step.pcs.includes(pc)){
      if (!practice.hit.has(pc)){
        practice.hit.add(pc);
        practicePreviewMidis(step.midis.filter((midi) => musicPitchClass(midi) === pc));
      }
      if (practice.hit.size >= step.pcs.length) practiceAdvance();
      else { paintPractice(); updatePracticeInfo(); }   // 화음은 남은 음을 마저 누를 때까지 기다린다
      return;
    }
    practice.wrong++;
    practice.err = true;
    practicePreviewMidis([practiceNearMidi(pc, step.midis[0])]);
    paintPractice();
    updatePracticeInfo();
    const now = Date.now();
    if (typeof toast === "function" && now - practice.hintAt > 3500){
      practice.hintAt = now;
      const want = step.pcs.map((value) => MUSIC_PC_LABELS[value]).join("+");
      toast(`누른 음: ${MUSIC_PC_LABELS[pc]} · 이 자리는 ${want}`, 2200);
    }
  }

  function setPracticeChrome(on){
    if (on && keyboardComposeActive) setKeyboardCompose(false, false);
    practiceBtn.classList.toggle("is-on", on);
    practiceBtn.textContent = on ? "■ 그만두기" : "🎯 따라치기";
    practiceInfo.hidden = !on;
    if (!on) practiceInfo.textContent = "";
    practiceStaffSelect.disabled = on;
    keyboardComposeBtn.disabled = on;
    keyboardSettingsBtn.disabled = on;
    easyHelp.textContent = on ? musicPracticeHelpText() : MUSIC_EASY_HELP;
    root.classList.toggle("is-practice", on);        // 머리말·도구상자를 통째로 잠근다(CSS)
    scoreHost.classList.toggle("is-practice", on);   // 악보를 흐린 교본으로 깐다(CSS)
    for (const control of [playAllBtn, playRightBtn, playLeftBtn, playPartBtn, repeatMeasureBtn,
                           speedSelect, countInBtn, metronomeBtn, fromInput, toInput]){
      control.disabled = on;
    }
    if (!on) syncTools();                            // 오른손·왼손 재생 버튼은 대보표일 때만 다시 켠다
  }

  /* ----- 음감 테스트(듣고 음 맞히기) -----
     따라치기와 반대로 **악보를 감춘다**. 소리로 내는 음은 무작위지만, 화면에 악보가 남아 있으면
     학생이 거기서 음이름을 골라 짚어 보게 되고(나중에 악보에서 문제를 뽑게 되면 아예 정답표가 된다),
     무엇보다 "귀로만 고르는" 연습이 되지 않는다. 편집·재생 줄은 따라치기와 같은 이유로 잠그되
     '쉬운 입력'의 도레미 버튼은 살려 둔다 — 자판을 못 쓰는 학생이 답을 누르는 길이다. */
  function setEarChrome(on){
    if (on && keyboardComposeActive) setKeyboardCompose(false, false);
    earBtn.classList.toggle("is-on", on);
    earBtn.textContent = on ? "■ 그만두기" : "🎧 음감 테스트";
    earLevelSelect.disabled = on;
    earCountSelect.disabled = on;
    earReferenceBtn.disabled = on;
    keyboardComposeBtn.disabled = on;
    keyboardSettingsBtn.disabled = on;
    root.classList.toggle("is-eartest", on);
    // 테스트 중에는 대기 화면이 덮지 않아야 한다 — 재생과 같은 규칙(.is-running).
    root.classList.toggle("is-running", on);
    for (const control of [playAllBtn, playRightBtn, playLeftBtn, playPartBtn, repeatMeasureBtn,
                           speedSelect, countInBtn, metronomeBtn, fromInput, toInput, practiceBtn]){
      control.disabled = on;
    }
    if (!on) syncTools();
  }

  function stopEarTest(){
    return earTest.stop(earTest.finished() ? "done" : "cancel");
  }

  function startEarTest(){
    if (earTest.active()) return false;
    if (practice.active){
      if (typeof toast === "function") toast("따라치기를 먼저 그만두고 시작해 주세요.", 2200);
      return false;
    }
    MNMusicAudio.stop();
    closeMusicContextMenu();
    hidePitchGuide();
    noteDrag = null;
    select(0, null);                                 // 테스트 중에는 편집 대상(선택)이 없다
    return earTest.start({
      level:Number(earLevelSelect.value) || 1,
      count:Number(earCountSelect.value) || 10,
      reference:earReference
    });
  }

  earBtn.addEventListener("click", () => {
    if (earTest.active()){ stopEarTest(); return; }
    if (!startEarTest()) return;
    if (typeof toast === "function"){
      toast("소리를 듣고 음이름을 눌러 보세요. " + musicPracticeKeyHelp() + " · "
        + "Space 다시 듣기 · Esc 그만두기", 5200);
    }
  });
  earLevelSelect.addEventListener("change", () => {
    try { localStorage.setItem(MUSIC_EAR_LEVEL_KEY, earLevelSelect.value); } catch(_){}
  });
  earCountSelect.addEventListener("change", () => {
    try { localStorage.setItem(MUSIC_EAR_COUNT_KEY, earCountSelect.value); } catch(_){}
  });
  earReferenceBtn.addEventListener("click", () => {
    earReference = !earReference;
    syncEarControls();
    try { localStorage.setItem(MUSIC_EAR_REFERENCE_KEY, String(earReference)); } catch(_){}
    if (typeof toast === "function"){
      toast(earReference
        ? "기준음을 켰어요 — 시작할 때 가온다(도4)를 들려줍니다(상대음감 연습)."
        : "기준음을 껐어요 — 기준 없이 바로 문제를 냅니다(절대음감 연습).", 2600);
    }
  });

  function syncEarControls(){
    earReferenceBtn.classList.toggle("is-on", earReference);
    earReferenceBtn.setAttribute("aria-pressed", earReference ? "true" : "false");
  }

  /* 연결된 피아노가 있는데 MIDI 입력이 꺼져 있으면, 켜는 단추가 달린 안내를 띄운다.
     아직 권한을 허락하지 않았다면 여기서 묻지 않는다 — 연습을 시작할 때마다 브라우저 권한 창이
     뜨면 성가시고, 건반이 없는 교실에서는 물어볼 이유조차 없다. 그 경우에는 도움말 줄의
     "피아노는 🎹 MIDI 입력을 켜세요" 가 대신 남는다. */
  async function practiceMidiHint(){
    if (midiInputEnabled || typeof navigator === "undefined" || !navigator.requestMIDIAccess) return;
    try {
      if (!midiAccess){
        if (!navigator.permissions || typeof navigator.permissions.query !== "function") return;
        const status = await navigator.permissions.query({ name:"midi" });
        if (!status || status.state !== "granted") return;   // 이미 허락돼 있을 때만 조용히 열어 본다
        midiAccess = await navigator.requestMIDIAccess();
      }
      const inputs = midiAccess.inputs ? [...midiAccess.inputs.values()] : [];
      if (!inputs.length) return;
      if (!practice.active || midiInputEnabled) return;      // 기다리는 사이에 상황이 바뀌었다
      if (typeof toast !== "function") return;
      const name = String(inputs[0].name || "").trim() || "MIDI 건반";
      toast(`연결된 건반: ${name} · 자판 대신 건반으로 치려면 MIDI 입력을 켜세요.`, 6000,
        { action:{ label:"🎹 켜기", onClick:() => { if (!midiInputEnabled) toggleMidiInput(); } } });
    } catch(_){ /* 권한 조회를 지원하지 않는 실행 환경 — 조용히 넘어간다 */ }
  }

  function startPractice(){
    if (practice.active) return false;
    if (earTest.active()) return false;          // 음감 테스트와 따라치기는 서로 배타(자판을 함께 쓴다)
    const range = clampRange();
    const staff = practiceStaffSelect.value === "treble" || practiceStaffSelect.value === "bass"
      ? practiceStaffSelect.value : null;
    const activePart = musicActivePart(sheet);
    const built = musicPracticeSteps(sheet, { from:range.from, to:range.to, staff,
      partId:activePart && activePart.id });
    if (!built.total){
      if (typeof toast === "function") toast("따라 칠 음이 없어요. 이 구간에 음표를 먼저 넣어 주세요.", 2600);
      return false;
    }
    MNMusicAudio.stop();
    closeMusicContextMenu();
    hidePitchGuide();
    noteDrag = null;
    select(0, null);                                 // 연습 중에는 편집 대상(선택)이 없다
    practice.active = true;
    practice.steps = built.steps;
    practice.total = built.total;
    practice.state = new Uint8Array(built.steps.length);
    practice.pos = 0; practice.done = 0; practice.notes = 0; practice.wrong = 0; practice.bad = 0;
    practice.hit = new Set(); practice.err = false;
    practice.startedAt = Date.now(); practice.hintAt = 0;
    practiceSkipAuto();
    setPracticeChrome(true);
    paintPractice();
    revealPracticeStep();
    updatePracticeInfo();
    scoreHost.focus({ preventScroll:true });
    practiceMidiHint();                              // 권한 조회를 기다리므로 시작을 붙잡지 않는다
    return true;
  }

  // reason: "done"=끝까지 눌렀다 / "cancel"=Esc·버튼으로 그만뒀다. 악보는 내내 그대로였으므로 표시만 되돌린다.
  function stopPractice(reason = "cancel"){
    if (!practice.active) return null;
    const stats = practiceStats();
    practice.active = false;
    practice.steps = []; practice.state = null; practice.total = 0;
    practice.pos = 0; practice.done = 0; practice.notes = 0; practice.hit = new Set(); practice.err = false;
    setPracticeChrome(false);
    paintPractice();
    if (typeof toast === "function"){
      if (reason === "done"){
        toast(`다 따라 눌렀어요! 정확도 ${stats.accuracy}% · ${stats.seconds}초 · 분당 ${stats.npm}음`
          + (stats.wrong ? ` (틀린 횟수 ${stats.wrong}번)` : ""), 5200);
      } else {
        toast(`따라치기를 그만뒀어요. 여기까지 ${stats.percent}% · 정확도 ${stats.accuracy}%`, 3000);
      }
    }
    if (reason === "done" && typeof petReact === "function") petReact(stats.accuracy >= 90 ? "success" : "error");
    return stats;
  }

  practiceBtn.addEventListener("click", () => {
    if (practice.active){ stopPractice("cancel"); return; }
    if (!startPractice()) return;
    if (typeof toast === "function"){
      toast("악보를 보고 자판으로 음을 눌러 보세요. " + musicPracticeKeyHelp()
        + " · 옥타브는 달라도 맞은 것으로 봐요. (Backspace: 한 음 뒤로 · Esc: 그만두기)", 6000);
    }
  });

  /* ----- 재생 ----- */
  function highlight(event){
    for (const el of noteEls.values()) el.classList.remove("is-playing");
    for (const el of solfegeEls.values()) el.classList.remove("is-playing");
    scoreHost.querySelectorAll(".music-chord-symbol.is-playing,.music-notation.is-playing")
      .forEach((el) => el.classList.remove("is-playing"));
    if (!event) return;
    const el = noteEls.get(event.id);
    if (!el) return;
    el.classList.add("is-playing");
    const label = solfegeEls.get(event.id);
    if (label) label.classList.add("is-playing");
    const symbol = Array.from(scoreHost.querySelectorAll(".music-chord-symbol"))
      .find((item) => item.dataset.noteId === event.id);
    if (symbol) symbol.classList.add("is-playing");
    scoreHost.querySelectorAll(`.music-notation[data-note-id="${event.id}"]`)
      .forEach((item) => item.classList.add("is-playing"));
    revealScoreElement(el);
  }

  function setPlaying(on){
    if (on && keyboardComposeActive) setKeyboardCompose(false, false);
    stopBtn.disabled = !on;
    playAllBtn.disabled = on;
    playActivePartBtn.disabled = on;
    playRightBtn.disabled = on || !sheet.grandStaff;
    playLeftBtn.disabled = on || !sheet.grandStaff;
    playPartBtn.disabled = on;
    repeatMeasureBtn.disabled = on;
    speedSelect.disabled = on;
    countInBtn.disabled = on;
    metronomeBtn.disabled = on;
    drumSelect.disabled = on;
    accompanimentModeSelect.disabled = on || musicDrumStyle(sheet.drumStyle) === "off";
    accompanimentTimbreSelect.disabled = on || musicDrumStyle(sheet.drumStyle) === "off"
      || musicAccompanimentMode(sheet.accompanimentMode) !== "full";
    drumVolumeInput.disabled = on || musicDrumStyle(sheet.drumStyle) === "off";
    partSelect.disabled = on;
    partNameInput.disabled = on;
    addPartBtn.disabled = on;
    removePartBtn.disabled = on || musicParts(sheet).length <= 1;
    partMuteBtn.disabled = on;
    partVolumeInput.disabled = on;
    practiceBtn.disabled = on;                   // 재생 중에는 따라치기를 시작하지 않는다(소리가 겹친다)
    earBtn.disabled = on;                        // 음감 테스트도 같다 — 반주와 문제 음이 겹친다
    keyboardComposeBtn.disabled = on;
    keyboardSettingsBtn.disabled = on;
    // 재생 중에는 대기 화면이 뜨지 않아야 한다. screensaverBusy() 가 이미 .is-running 을
    // "실행 중"으로 보고 있어서(파이썬·노트북과 같은 규칙) 이 클래스만 붙였다 떼면 된다.
    root.classList.toggle("is-running", on);
  }

  function syncPracticeControls(){
    countInBtn.classList.toggle("is-on", countInEnabled);
    countInBtn.setAttribute("aria-pressed", countInEnabled ? "true" : "false");
    metronomeBtn.classList.toggle("is-on", metronomeEnabled);
    metronomeBtn.setAttribute("aria-pressed", metronomeEnabled ? "true" : "false");
  }

  function syncDrumControls(){
    const style = musicDrumStyle(sheet.drumStyle);
    const volume = musicClampDrumVolume(sheet.drumVolume);
    for (const option of drumSelect.options){
      option.disabled = !musicDrumStyleCompatible(option.value, sheet.time);
    }
    drumSelect.value = style;
    const mode = musicAccompanimentMode(sheet.accompanimentMode);
    accompanimentModeSelect.value = mode;
    accompanimentTimbreSelect.value = musicAccompanimentTimbre(sheet.accompanimentTimbre);
    accompanimentModeSelect.disabled = MNMusicAudio.playing() || style === "off";
    accompanimentTimbreSelect.disabled = MNMusicAudio.playing() || style === "off" || mode !== "full";
    drumVolumeInput.value = String(Math.round(volume * 100));
    drumVolumeInput.disabled = MNMusicAudio.playing() || style === "off";
    drumVolumeLabel.textContent = `${Math.round(volume * 100)}%`;
  }

  function setDrumStyle(style){
    const requested = musicDrumStyle(style);
    sheet.drumStyle = musicDrumStyleCompatible(requested, sheet.time) ? requested : "basic";
    syncDrumControls();
    touch();
    if (history) history.commit();
    if (requested !== sheet.drumStyle && typeof toast === "function"){
      toast(`${MUSIC_DRUM_STYLE_SPECS[requested].label} 스타일은 ${musicDrumTimeKey(sheet.time)} 박자에서 사용할 수 없어요.`, 3000);
    }
  }

  function setDrumVolume(volume, commit){
    sheet.drumVolume = musicClampDrumVolume(volume);
    syncDrumControls();
    touch();
    if (commit && history) history.commit();
  }

  function setAccompanimentMode(mode){
    sheet.accompanimentMode = musicAccompanimentMode(mode);
    syncDrumControls();
    touch();
    if (history) history.commit();
    if (sheet.accompanimentMode !== "drums" && !musicSheetHasPlayableChords(sheet)
      && typeof toast === "function"){
      toast("음표 위에 C, Am, G7 같은 코드 기호를 넣으면 베이스와 코드 반주가 재생돼요.", 3600);
    }
  }

  function setAccompanimentTimbre(timbre){
    sheet.accompanimentTimbre = musicAccompanimentTimbre(timbre);
    syncDrumControls();
    touch();
    if (history) history.commit();
  }

  function syncVolumeControls(){
    const isMuted = MNMusicAudio.muted();
    muteBtn.textContent = isMuted || MNMusicAudio.getVolume() === 0 ? "🔇" : "🔊";
    muteBtn.classList.toggle("is-on", isMuted);
    muteBtn.setAttribute("aria-pressed", isMuted ? "true" : "false");
    volumeLabel.textContent = `${Math.round(MNMusicAudio.getVolume() * 100)}%`;
  }

  async function startPlay(range, playOptions){
    if (practice.active) return;                 // 따라치기 중에는 재생하지 않는다(누른 음과 반주가 겹친다)
    if (earTest.active()) return;                // 음감 테스트 중에도 같다
    const options = playOptions || {};
    setPlaying(true);
    if (musicParts(sheet).some((part) => !part.muted && MNMusicAudio.sampledTimbre(part.timbre))
      || (musicAccompanimentMode(sheet.accompanimentMode) === "full"
        && MNMusicAudio.sampledTimbre(sheet.accompanimentTimbre))){
      status.textContent = "음원 준비 중…";
    }
    try {
      const handle = await MNMusicAudio.play(sheet, Object.assign({
        playbackRate:Number(speedSelect.value) || 1,
        countIn:countInEnabled,
        metronome:metronomeEnabled,
        loop:!!options.loop,
        staff:options.staff,
        partId:options.partId,
        onNote:highlight,
        onCount:(beat, total) => {
          if (beat) status.textContent = `준비 ${beat} / ${total}`;
          else updateStatus();
        },
        onEnd:() => { highlight(null); setPlaying(false); updateStatus(); },
        onError:(error, timbre) => {
          const label = timbreLabel(timbre);
          if (typeof toast === "function") toast(label + " 음원을 읽지 못해 삼각파로 재생해요.", 3200);
          console.warn(label + " 음원을 읽지 못했습니다:", error);
        }
      }, range || {}));
      if (!handle){
        setPlaying(false);
        updateStatus();
        if (!MNMusicAudio.supported() && typeof toast === "function"){
          toast("소리를 낼 수 없어요(브라우저가 Web Audio 를 지원하지 않아요).", 3000);
        }
        return;
      }
      updateStatus();
    } catch(error){
      setPlaying(false);
      updateStatus();
      if (typeof toast === "function") toast(error && error.message ? error.message : "재생하지 못했어요.", 3000);
    }
  }

  playAllBtn.addEventListener("click", () => startPlay(null));
  playActivePartBtn.addEventListener("click", () => {
    const part = musicActivePart(sheet);
    startPlay(null, { partId:part && part.id });
  });
  playRightBtn.addEventListener("click", () => startPlay(null, { staff:"treble" }));
  playLeftBtn.addEventListener("click", () => startPlay(null, { staff:"bass" }));
  playPartBtn.addEventListener("click", () => startPlay(clampRange()));
  repeatMeasureBtn.addEventListener("click", () => {
    const measure = selection ? selection.measure + 1 : clampRange().from;
    fromInput.value = toInput.value = String(measure);
    startPlay({ from:measure, to:measure }, { loop:true });
  });
  countInBtn.addEventListener("click", () => { countInEnabled = !countInEnabled; syncPracticeControls(); });
  metronomeBtn.addEventListener("click", () => { metronomeEnabled = !metronomeEnabled; syncPracticeControls(); });
  drumSelect.addEventListener("change", () => setDrumStyle(drumSelect.value));
  accompanimentModeSelect.addEventListener("change", () => setAccompanimentMode(accompanimentModeSelect.value));
  accompanimentTimbreSelect.addEventListener("change", () => setAccompanimentTimbre(accompanimentTimbreSelect.value));
  drumVolumeInput.addEventListener("input", () => setDrumVolume(Number(drumVolumeInput.value) / 100, false));
  drumVolumeInput.addEventListener("change", () => setDrumVolume(Number(drumVolumeInput.value) / 100, true));
  volumeInput.addEventListener("input", () => {
    MNMusicAudio.setVolume(Number(volumeInput.value) / 100);
    if (MNMusicAudio.muted()) MNMusicAudio.setMuted(false);
    syncVolumeControls();
    // 음량 막대는 입력 칸이라 자판을 가져간다 — 따라치기 중이라면 초점을 악보로 되돌린다.
    if (practice.active) scoreHost.focus({ preventScroll:true });
  });
  muteBtn.addEventListener("click", () => {
    MNMusicAudio.setMuted(!MNMusicAudio.muted());
    syncVolumeControls();
  });
  stopBtn.addEventListener("click", () => MNMusicAudio.stop());
  undoBtn.addEventListener("click", () => history.undo());
  redoBtn.addEventListener("click", () => history.redo());
  zoomOutBtn.addEventListener("click", () => stepScoreZoom(-1));
  zoomInBtn.addEventListener("click", () => stepScoreZoom(1));
  zoomFitBtn.addEventListener("click", () => setScoreZoom(1));

  function exportMusicXml(){
    try {
      const xml = musicSerializeXml(sheet);
      musicDownloadBlob(musicExportName(doc, "musicxml"),
        new Blob([xml], { type:"application/vnd.recordare.musicxml+xml;charset=utf-8" }));
      const hasFinePosition = sheet.measures.some((measure) =>
        [...(measure.notes || []), ...(measure.bassNotes || [])].some((note) => musicClampXOffset(note.xOffset)));
      if (typeof toast === "function"){
        toast(hasFinePosition
          ? "MusicXML로 저장했어요. 좌우 미세 위치는 다른 프로그램의 자동 조판에 따라 달라질 수 있어요."
          : "다른 악보 프로그램에서 열 수 있는 MusicXML로 저장했어요.", hasFinePosition ? 4200 : 2600);
      }
    } catch(error){
      if (typeof toast === "function") toast(error && error.message ? error.message : "MusicXML 저장에 실패했어요.", 3000, { type:"error" });
    }
  }
  musicXmlBtn.addEventListener("click", exportMusicXml);

  function midiVarLength(value){
    let buffer = Math.max(0, Math.round(value)) & 0x7f;
    const bytes = [];
    while ((value = Math.floor(value / 128)) > 0){ buffer <<= 8; buffer |= (value & 0x7f) | 0x80; }
    for (;;){ bytes.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
    return bytes;
  }

  function midiChunk(name, bytes){
    const length = bytes.length;
    return [...Array.from(name).map((char) => char.charCodeAt(0)),
      (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...bytes];
  }

  function exportMusicMidi(){
    try {
      const division = 480;
      const tempo = musicClampTempo(sheet.tempo);
      const micros = Math.round(60000000 / tempo);
      const tempoTrack = [0, 0xff, 0x51, 3, (micros >>> 16) & 255, (micros >>> 8) & 255, micros & 255,
        0, 0xff, 0x2f, 0];
      const programs = { piano:0, guitar:24, xylophone:13, harp:46, flute:73, clarinet:71,
        triangle:80, sine:88, square:81 };
      const partTracks = [];
      musicParts(sheet).forEach((part, partIndex) => {
        const rawChannel = partIndex % 15;
        const channel = rawChannel >= 9 ? rawChannel + 1 : rawChannel; // 10번 채널은 표준 타악기용이라 건너뛴다
        const nameBytes = Array.from(new TextEncoder().encode(part.name || `악기 ${partIndex + 1}`));
        const track = [0, 0xff, 0x03, ...midiVarLength(nameBytes.length), ...nameBytes,
          0, 0xc0 | channel, programs[part.timbre] == null ? 0 : programs[part.timbre],
          0, 0xb0 | channel, 7, Math.max(0, Math.min(127, Math.round(musicClampPartVolume(part.volume) * 127)))];
        const timed = [];
        const timeline = musicTimeline(sheet, { partId:part.id, includeMuted:true });
        for (const event of timeline.events){
          if (event.rest || event.midi === null) continue;
          const start = Math.max(0, Math.round(event.start * tempo * division / 60));
          const end = Math.max(start + 1, Math.round((event.start + event.duration) * tempo * division / 60));
          const velocity = Math.max(1, Math.min(127, Math.round(82 * (event.gain || 1))));
          timed.push({ tick:start, order:1, data:[0x90 | channel, event.midi & 0x7f, velocity] });
          timed.push({ tick:end, order:0, data:[0x80 | channel, event.midi & 0x7f, 0] });
        }
        timed.sort((a, b) => a.tick - b.tick || a.order - b.order);
        let cursor = 0;
        for (const event of timed){
          track.push(...midiVarLength(event.tick - cursor), ...event.data);
          cursor = event.tick;
        }
        track.push(0, 0xff, 0x2f, 0);
        partTracks.push(midiChunk("MTrk", track));
      });
      const trackCount = partTracks.length + 1;
      const header = midiChunk("MThd", [0, 1, (trackCount >>> 8) & 255, trackCount & 255,
        (division >>> 8) & 255, division & 255]);
      const bytes = new Uint8Array([...header, ...midiChunk("MTrk", tempoTrack), ...partTracks.flat()]);
      musicDownloadBlob(musicExportName(doc, "mid"), new Blob([bytes], { type:"audio/midi" }));
      if (typeof toast === "function") toast(`${partTracks.length}개 악기 트랙을 MIDI 파일로 저장했어요.`, 2400);
    } catch(error){
      console.error(error);
      if (typeof toast === "function") toast("MIDI 저장에 실패했어요.", 2600, { type:"error" });
    }
  }
  midiExportBtn.addEventListener("click", exportMusicMidi);

  function pitchFromMidiInput(midi){
    // 검은건반을 어느 이름으로 적을지는 그 자리의 조표를 따른다(내림표 조표면 B♭, 아니면 A♯).
    const settings = musicEffectiveMeasureSettings(sheet, activeMeasureIndex());
    const useFlats = ((MUSIC_KEYS[settings.key] || {}).vex || "").includes("b");
    return musicPitchFromMidi(midi, useFlats);
  }

  function handleMidiMessage(event){
    if (!midiInputEnabled) return;
    const data = event.data || [];
    const command = data[0] & 0xf0;
    if (command !== 0x90 || Number(data[2]) <= 0) return;
    // 따라치기·음감 테스트 중이면 건반은 '입력'이 아니라 '채점'으로 간다 — 안 그러면 연습하다 악보가 고쳐진다.
    // 음감 테스트에는 MIDI 번호를 함께 넘긴다 — 옥타브까지 한 번에 답한 것으로 볼 수 있다(4단계).
    if (earTest.active()){ earTest.press(musicPitchClass(Number(data[1])), Number(data[1])); return; }
    if (practice.active){ practicePress(musicPitchClass(Number(data[1]))); return; }
    const pitch = pitchFromMidiInput(Number(data[1]));
    if (!musicMidiInRange(Number(data[1]), activeStaff)){
      if (typeof toast === "function") toast("현재 오선에서 쓸 수 있는 MIDI 음역을 벗어났어요.", 1800);
      return;
    }
    const now = Number(event.receivedTime) || performance.now();
    const selected = selectedNote();
    if (selected && !selected.rest && selection && lastMidiBaseId === selected.id && now - lastMidiNoteAt <= 130){
      if (musicAddChordPitch(selected, pitch)){
        const keep = { ...selection };
        afterEdit();
        select(keep.measure, keep.id, { staff:keep.staff, voice:keep.voice });
        MNMusicAudio.previewNote(selected, sheet.timbre);
      }
    } else {
      tool.rest = false;
      tool.accidental = pitch.alter;
      const target = activeMeasureIndex();
      insertNote(target, pitch, activeStaff);
      lastMidiBaseId = selection && selection.id;
    }
    lastMidiNoteAt = now;
  }

  function connectMidiInputs(){
    if (!midiAccess) return;
    for (const input of midiAccess.inputs.values()) input.onmidimessage = midiInputEnabled ? handleMidiMessage : null;
  }

  async function toggleMidiInput(){
    if (midiInputEnabled){
      midiInputEnabled = false;
      connectMidiInputs();
      midiInputBtn.classList.remove("is-on");
      midiInputBtn.textContent = "🎹 MIDI 입력";
      return;
    }
    if (!navigator.requestMIDIAccess){
      if (typeof toast === "function") toast("이 실행 환경은 MIDI 건반 입력을 지원하지 않아요.", 3000);
      return;
    }
    try {
      midiAccess = midiAccess || await navigator.requestMIDIAccess();
      midiInputEnabled = true;
      connectMidiInputs();
      midiAccess.onstatechange = connectMidiInputs;
      midiInputBtn.classList.add("is-on");
      midiInputBtn.textContent = "🎹 MIDI 입력 중";
      if (typeof toast === "function") toast("MIDI 건반을 누르면 현재 오선·성부에 입력돼요. 동시에 누르면 화음이 됩니다.", 3600);
    } catch(error){
      if (typeof toast === "function") toast("MIDI 장치 사용 권한을 허용하지 않았거나 장치를 찾지 못했어요.", 3200);
    }
  }
  midiInputBtn.addEventListener("click", toggleMidiInput);

  imageReferenceBtn.addEventListener("click", () => imageReferenceInput.click());
  imageReferenceInput.addEventListener("change", () => {
    const file = imageReferenceInput.files && imageReferenceInput.files[0];
    if (!file) return;
    if (imageReferenceUrl) URL.revokeObjectURL(imageReferenceUrl);
    imageReferenceUrl = URL.createObjectURL(file);
    imageReferenceImg.src = imageReferenceUrl;
    imageReferenceTitle.textContent = file.name;
    imageReference.hidden = false;
    imageReferenceInput.value = "";
  });
  imageZoom.addEventListener("input", () => { imageReferenceImg.style.width = imageZoom.value + "%"; });
  imageReferenceClose.addEventListener("click", () => { imageReference.hidden = true; });

  async function exportMusicWav(){
    if (wavBtn.disabled) return;
    const previous = wavBtn.textContent;
    wavBtn.disabled = true;
    wavBtn.textContent = "만드는 중…";
    try {
      const blob = await MNMusicAudio.renderWav(sheet, {
        onError:(error, timbre) => {
          const label = timbreLabel(timbre);
          if (typeof toast === "function") toast(label + " 음원을 읽지 못해 삼각파 WAV로 저장해요.", 3200);
          console.warn(label + " WAV 음원을 읽지 못했습니다:", error);
        }
      });
      musicDownloadBlob(musicExportName(doc, "wav"), blob);
      if (typeof toast === "function") toast("WAV 파일로 저장했어요.", 2400);
    } catch(error){
      if (typeof toast === "function"){
        toast(error && error.message ? error.message : "WAV 저장에 실패했어요.", 3000, { type:"error" });
      }
    } finally {
      wavBtn.disabled = false;
      wavBtn.textContent = previous;
    }
  }
  wavBtn.addEventListener("click", exportMusicWav);

  for (const input of [fromInput, toInput]) input.addEventListener("change", clampRange);

  /* ----- 메모로 보내기 -----
     화면의 SVG 를 복제해 글꼴·색 정의를 심고, 고른 단만 잘라 PNG 로 굽는다.
     화면 배율과 선택·재생 표시는 보기 상태일 뿐이라 그림에는 남기지 않는다(인쇄와 같은 이유). */
  async function scoreImageBlob(lineIndex){
    const svg = scoreHost.querySelector("svg");
    if (!svg){
      if (typeof toast === "function") toast("악보가 아직 그려지지 않았어요.", 2400);
      return null;
    }
    const fontCss = await musicEmbeddedFontCss();
    if (!fontCss){
      if (typeof toast === "function") toast("악보 글꼴을 찾지 못해 그림을 만들지 못했어요.", 3000, { type:"error" });
      return null;
    }
    const baseWidth = Number(svg.dataset.musicBaseWidth) || 0;
    const baseHeight = Number(svg.dataset.musicBaseHeight) || 0;
    const lineHeight = sheet.grandStaff ? MUSIC_GRAND_LINE_HEIGHT : MUSIC_LINE_HEIGHT;
    let top = 0, height = baseHeight;
    if (lineIndex != null){
      top = Math.max(0, 10 + lineIndex * lineHeight - MUSIC_IMAGE_TOP_PAD);
      height = Math.min(baseHeight - top, lineHeight + MUSIC_IMAGE_TOP_PAD);
    }
    if (!(baseWidth > 0) || !(height > 0)) return null;
    const rasterScale = musicSafeImageScale(baseWidth, height);
    if (rasterScale < MUSIC_IMAGE_MIN_SCALE){
      if (typeof toast === "function") toast(
        "악보가 너무 길어 한 장의 그림으로 만들 수 없어요. 오선에서 오른쪽 버튼을 눌러 단별로 메모에 보내 주세요.",
        4200, { type:"error" });
      return null;
    }

    const copy = svg.cloneNode(true);
    copy.style.removeProperty("width");
    copy.style.removeProperty("height");
    copy.style.removeProperty("max-width");
    copy.querySelectorAll(".is-selected,.is-playing").forEach((el) => el.classList.remove("is-selected", "is-playing"));
    const guide = copy.querySelector(".music-pitch-guide");
    if (guide) guide.remove();
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("width", String(baseWidth));
    copy.setAttribute("height", String(height));
    copy.setAttribute("viewBox", `0 ${top} ${baseWidth} ${height}`);
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = fontCss + "\n" + MUSIC_IMAGE_CSS;
    copy.insertBefore(style, copy.firstChild);

    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],
      { type:"image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(baseWidth * rasterScale));
      canvas.height = Math.max(1, Math.floor(height * rasterScale));
      const ctx = canvas.getContext("2d");
      if (!ctx){
        if (typeof toast === "function") toast("악보 그림을 만들 수 없는 환경이에요.", 3000, { type:"error" });
        return null;
      }
      // 악보는 늘 흰 종이 위에 둔다 — 메모가 어두운 주제여도 검은 잉크가 보이게.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob && typeof toast === "function"){
        toast("악보 그림을 만들지 못했어요. 긴 악보라면 단별로 보내 주세요.", 3600, { type:"error" });
      }
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* lineIndex 가 null 이면 악보 전체. 그림(PNG)과 편집용 악보 스냅샷을 함께 넘겨,
     메모 블록의 "✏️ 악보로"로 다시 편집할 수 있게 한다. */
  async function sendScoreToMemo(lineIndex){
    if (typeof window.addMusicToScratchpad !== "function"){
      if (typeof toast === "function") toast("메모창을 열 수 없어요.", 2200, { type:"error" });
      return;
    }
    const indexes = (lineIndex != null && scoreLines[lineIndex]) ? scoreLines[lineIndex] : null;
    const excerpt = indexes
      ? musicExcerpt(sheet, indexes, { title:(sheet.title || "악보") + " — " + musicRangeLabel(indexes) })
      : sheet;
    if (!excerpt){
      if (typeof toast === "function") toast("보낼 악보를 찾지 못했어요.", 2400, { type:"error" });
      return;
    }
    // 이 탭이 담고 있는 내용을 통째로 보낼 때만 원래 메모 블록을 바꾼다. 여러 단 중 한 단만
    // 보내면서 블록을 갈아치우면 나머지 단이 메모에서 사라져 버린다.
    const coversAll = !indexes || indexes.length === sheet.measures.length;
    const base = String(doc.name || sheet.title || "악보").replace(/\.msheet$/i, "");
    const label = base + (indexes ? " — " + musicRangeLabel(indexes) : "");
    try {
      const blob = await scoreImageBlob(indexes ? lineIndex : null);
      if (!blob) return;
      const result = await window.addMusicToScratchpad(blob, JSON.parse(musicSerialize(excerpt)), {
        name:label + ".png",
        boardName:label,
        blockId:coversAll ? doc.memoBlockId : null
      });
      if (result && result.blockId && coversAll){
        doc.memoBlockId = result.blockId;
        // 이 고리는 탭 상태에 함께 저장된다 — 다시 실행한 뒤에도 같은 블록으로 돌아가게.
        if (typeof persistTabState === "function") persistTabState();
      }
    } catch(error){
      console.error(error);
      if (typeof toast === "function") toast("메모로 보내지 못했어요.", 2400, { type:"error" });
    }
  }
  memoBtn.addEventListener("click", () => sendScoreToMemo(null));

  /* ----- 인쇄 -----
     VexFlow 5 는 음표를 Bravura 글꼴의 글자로 그린다. 그래서 새 창·iframe 으로 SVG 만 옮기면
     그 문서에는 글꼴이 없어 악보가 깨진다. 화이트보드(printBoard)와 같은 방식으로
     이 문서 안에 인쇄용 층을 만들고 나머지를 숨긴다 — 글꼴이 그대로 살아 있다.
     PDF 는 인쇄 대화상자의 'PDF로 저장'으로 만든다(별도 내보내기를 두지 않는 이유). */
  function printScore(){
    const svg = scoreHost.querySelector("svg");
    if (!svg){
      if (typeof toast === "function") toast("인쇄할 악보가 아직 그려지지 않았어요.", 2400);
      return;
    }
    const old = document.getElementById("musicPrintLayer");
    if (old) old.remove();
    const layer = document.createElement("div");
    layer.id = "musicPrintLayer";
    layer.className = "music-print";
    const heading = document.createElement("h1");
    heading.textContent = sheet.title || "악보";
    const sub = document.createElement("div");
    sub.className = "music-print-sub";
    sub.textContent = `♩=${sheet.tempo} · ${sheet.time.beats}/${sheet.time.beatValue} · ${(MUSIC_KEYS[sheet.key] || MUSIC_KEYS.C).label}`;
    const copy = svg.cloneNode(true);
    // 화면 확대는 보기 상태일 뿐이다. 인쇄본은 VexFlow의 원래 크기로 되돌려 종이에 맞춘다.
    copy.style.removeProperty("width");
    copy.style.removeProperty("height");
    copy.style.removeProperty("max-width");
    // 화면에서 고르거나 재생 중이던 표시는 종이에 남기지 않는다.
    copy.querySelectorAll(".is-selected,.is-playing").forEach((el) => el.classList.remove("is-selected", "is-playing"));
    layer.append(heading, sub, copy);
    document.body.appendChild(layer);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", cleanup);
      document.body.classList.remove("music-printing");
      layer.remove();
    };
    try {
      window.addEventListener("afterprint", cleanup);
      document.body.classList.add("music-printing");
      window.print();          // 크로미움에서는 인쇄창이 닫힐 때까지 여기서 멈춘다
    } catch(e){ console.error(e); }
    finally { cleanup(); }
  }
  printBtn.addEventListener("click", printScore);
  doc.printScore = printScore;      // 머리말 🖨 버튼(app.js)도 같은 경로를 쓴다

  /* ----- 되돌리기 -----
     스냅샷은 악보 JSON 문자열 하나다(가볍고 비교가 정확하다). */
  history = MNEditHistory.create({
    capture:() => musicSerialize(sheet),
    isEqual:(a, b) => a === b,
    apply:(state) => {
      const restored = musicParse(state);
      sheet.title = restored.title;
      sheet.tempo = restored.tempo;
      sheet.time = restored.time;
      sheet.key = restored.key;
      sheet.drumStyle = restored.drumStyle;
      sheet.drumVolume = restored.drumVolume;
      sheet.accompanimentMode = restored.accompanimentMode;
      sheet.accompanimentTimbre = restored.accompanimentTimbre;
      sheet.showSolfege = restored.showSolfege;
      sheet.parts = restored.parts;
      sheet.activePartId = restored.activePartId;
      sheet.timbre = restored.timbre;
      sheet.grandStaff = restored.grandStaff;
      sheet.measures = restored.measures;
      musicSelectPart(sheet, restored.activePartId);
      titleInput.value = sheet.title;
      tempoInput.value = String(sheet.tempo);
      timeSelect.value = `${sheet.time.beats}/${sheet.time.beatValue}`;
      keySelect.value = sheet.key;
      timbreSelect.value = sheet.timbre;
      syncPartControls();
      syncDrumControls();
      grandStaffBtn.textContent = sheet.grandStaff ? "🎹 피아노 대보표" : "🎼 단일 오선";
      if (!sheet.grandStaff) activeStaff = "treble";
      selection = null;
      syncTools();
      afterEdit();
    },
    onChange:updateHistoryButtons,
    limit:MUSIC_HISTORY_LIMIT
  });
  doc._musicHistory = history;
  history.reset();

  /* ----- 정리 ----- */
  document.addEventListener("keydown", onKeyDown, true);
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(redrawTimer);
    noteDrag = null;
    scorePan = null;
    practice.active = false;                     // 문서를 닫으면 따라치기도 끝난다(악보는 건드린 적이 없다)
    practice.steps = []; practice.state = null;
    earTest.destroy();                           // 예약해 둔 다음 문제 타이머까지 함께 걷는다
    closeMusicContextMenu();
    scoreHost.removeEventListener("contextmenu", onScoreContextMenu);
    scoreHost.removeEventListener("scroll", closeMusicContextMenu);
    document.removeEventListener("keydown", onKeyDown, true);
    if (history) history.cancel();
    doc._musicHistory = null;
    midiInputEnabled = false;
    if (midiAccess){
      for (const input of midiAccess.inputs.values()) input.onmidimessage = null;
      midiAccess.onstatechange = null;
    }
    if (imageReferenceUrl) URL.revokeObjectURL(imageReferenceUrl);
    MNMusicAudio.stop();
  });
  if (typeof ResizeObserver === "function"){
    const observer = new ResizeObserver(scheduleRedraw);
    observer.observe(scoreHost);
    doc.cleanupFns.push(() => observer.disconnect());
  }

  clampRange();
  syncPartControls();
  updateStatus();
  syncTools();
  updateHistoryButtons();
  updateZoomControls();
  syncPracticeControls();
  syncEarControls();
  syncVolumeControls();
  syncDrumControls();

  scoreHost.textContent = "악보를 준비하는 중…";
  const ready = await MNLazy.tryNeed("vexflow");
  if (!ready){
    scoreHost.textContent = "악보 그리기 라이브러리를 불러오지 못했어요. 재생과 저장은 그대로 쓸 수 있어요.";
    return;
  }
  drawScore();
}
