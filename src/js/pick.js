"use strict";

/* ===== 복불복(.pick) =====
   참가자 명단 하나로 여러 뽑기 게임(룰렛·사다리·카드·슬롯·구슬 경주)을 돌리는 문서.
   파일엔 명단·고른 게임·게임별 설정만 담고, 뽑은 결과는 화면에만 둔다(티어표 월드컵과 같은 까닭 — 놀이 결과로 파일이 바뀌지 않게).
   뽑기는 늘 결과를 먼저 정하고(pickRandomInt — crypto) 움직임은 그 결과에 맞춰 보여 준다. 연출이 어떻든 확률은 모두 같다.
   게임은 pick-*.js 가 PICK_GAME_IMPL 에 { mount } 로 스스로 올린다 — 이 파일은 명단·머리말·결과 창·효과음·색종이만 맡는다. */
const PICK_DOC_TYPE = "classdock-pick";
const PICK_DOC_VERSION = 1;
const PICK_MAX_PEOPLE = 100;
const PICK_HISTORY_LIMIT = 60;
const PICK_RECOVERY_DELAY = 700;
const PICK_IMAGE_MAX_CHARS = 400 * 1024;
const PICK_GAME_SETTINGS_MAX_CHARS = 20000;
/* 참가자 색 — 룰렛 칸·얼굴·구슬이 모두 이 색을 쓴다. 파스텔이라 위에 짙은 남색 글자를 얹어도 잘 읽힌다. */
const PICK_COLORS = ["#f7a193", "#a3e3c8", "#fbe09a", "#d3c1f6", "#b1d0fa", "#f9c3dc", "#ffc89e", "#b9e4a0", "#9fd8ef", "#e7c9a9", "#c5cbf6", "#f3b0c3"];
const PICK_COLOR_NAMES = ["살구", "민트", "노랑", "보라", "하늘", "분홍", "복숭아", "연두", "물빛", "모래", "라벤더", "장미"];
/* 게임 목록 — 차례가 곧 '게임 선택' 메뉴 차례. 몸체(PICK_GAME_IMPL[id])가 아직 없는 게임은 메뉴에 나오지 않는다. */
const PICK_GAMES = [
  { id:"roulette", label:"룰렛 돌리기", short:"룰렛", sub:"돌려보세요!\n오늘의 주인공은 누구일까요?", go:"돌리기", note:"좋은 사람과\n좋은 시간이\n더 특별해져요!", layout:"side" },
  { id:"ladder", label:"사다리타기", short:"사다리", sub:"누가 당첨될까요? 지금 사다리를 타보세요!", go:"사다리 타기", note:"", layout:"center" },
  { id:"card", label:"카드 뽑기", short:"카드", sub:"카드를 한 장 골라보세요", go:"카드 섞기", note:"", layout:"center" },
  { id:"slot", label:"슬롯 추첨", short:"슬롯", sub:"누가 오늘의 주인공일까요?", go:"추첨 시작", note:"두근두근\n누가 될까요?", layout:"center" },
  { id:"marble", label:"구슬 경주", short:"구슬", sub:"구슬이 함께 달려요! 오늘의 우승자는 누구일까요?", go:"경주 시작", note:"", layout:"center" },
  { id:"capsule", label:"캡슐 뽑기", short:"캡슐", sub:"손잡이를 돌려 캡슐을 뽑아요", go:"캡슐 뽑기", note:"어떤 친구가\n나올까요?", layout:"center" },
  { id:"dice", label:"주사위 굴리기", short:"주사위", sub:"차례대로 굴려요 — 높은 숫자가 이겨요", go:"주사위 굴리기", note:"", layout:"center" },
  { id:"lotto", label:"공 뽑기", short:"공", sub:"번호 공이 섞이다 하나씩 굴러 나와요", go:"공 뽑기", note:"좋은 일이\n뽑히기를!", layout:"center" },
  { id:"bomb", label:"폭탄 돌리기", short:"폭탄", sub:"터지기 전에 다음 사람에게 넘겨요!", go:"폭탄 시작", note:"", layout:"center" },
  { id:"scratch", label:"스크래치 뽑기", short:"스크래치", sub:"긁어서 결과를 확인하세요", go:"새로 섞기", note:"", layout:"center" },
  { id:"bottle", label:"병 돌리기", short:"병", sub:"병이 가리키는 사람이 오늘의 주인공!", go:"병 돌리기", note:"", layout:"center" },
  { id:"dart", label:"다트 추첨", short:"다트", sub:"다트가 꽂힌 칸의 친구가 당첨!", go:"다트 던지기", note:"", layout:"center" },
  { id:"treasure", label:"보물상자 고르기", short:"보물상자", sub:"상자를 하나 골라보세요", go:"다시 섞기", note:"", layout:"center" },
  { id:"croc", label:"악어 이빨 누르기", short:"악어", sub:"차례대로 이빨을 눌러요 — 악어가 물면 걸려요!", go:"게임 시작", note:"", layout:"center" },
  { id:"bingo", label:"빙고 추첨", short:"빙고", sub:"번호를 뽑아 먼저 한 줄을 채우면 빙고!", go:"번호 뽑기", note:"", layout:"center" }
];
const PICK_MOTION = { slow:1.4, normal:1, fast:0.6, off:0 };
const PICK_MOTION_LABELS = [["slow", "느리게"], ["normal", "보통"], ["fast", "빠르게"], ["off", "움직임 끄기"]];
const PICK_GAME_IMPL = (typeof globalThis !== "undefined" && globalThis.PICK_GAME_IMPL) || {};
if (typeof globalThis !== "undefined") globalThis.PICK_GAME_IMPL = PICK_GAME_IMPL;
let _pickScratchCount = 0;

function pickId(){ return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function pickText(value, max){ return String(value == null ? "" : value).slice(0, max); }
function pickColor(value, fallback){ const text = String(value || "").trim(); return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : (fallback || PICK_COLORS[0]); }
function pickGame(id){ return PICK_GAMES.find(game => game.id === id) || PICK_GAMES[0]; }
function pickReadyGames(){ return PICK_GAMES.filter(game => PICK_GAME_IMPL[game.id]); }
/* 아직 덜 쓴 색부터 — 여섯 명이면 여섯 색이 모두 다르게. */
function pickNextColor(people){
  const used = new Map(PICK_COLORS.map(color => [color, 0]));
  (people || []).forEach(person => { if (used.has(person.color)) used.set(person.color, used.get(person.color) + 1); });
  let best = PICK_COLORS[0]; PICK_COLORS.forEach(color => { if (used.get(color) < used.get(best)) best = color; });
  return best;
}

/* 뽑기 — crypto 가 있으면 그것을(Math.random 보다 고르고 예측이 어렵다), 없으면 Math.random. 시험에선 random 을 넘겨 고정한다. */
function pickCryptoRandom(){
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (c && typeof c.getRandomValues === "function"){ const buf = new Uint32Array(1); c.getRandomValues(buf); return buf[0] / 4294967296; }
  return Math.random();
}
function pickRandomInt(n, random=pickCryptoRandom){ const count = Math.floor(Number(n) || 0); if (count <= 1) return 0; return Math.min(count - 1, Math.floor(random() * count)); }
function pickShuffle(list, random=pickCryptoRandom){ const out = list.slice(); for (let i = out.length - 1; i > 0; i--){ const j = pickRandomInt(i + 1, random); [out[i], out[j]] = [out[j], out[i]]; } return out; }
/* 둥근 통(반지름 R) 바닥부터 공 count 개를 벌집 모양으로 쌓는다 — 캡슐·번호 공이 쓴다. { r, pts:[[x,y]] } (가운데가 0,0, 아래가 +y) */
function pickPackCircle(count, R, random=Math.random){
  const n = Math.max(0, Math.floor(count)); if (!n) return { r:R * 0.2, pts:[] };
  let r = Math.min(R * 0.42, R * Math.sqrt(0.6 / n));
  for (let tries = 0; tries < 40; tries++){
    const pts = [], dx = r * 2.02, dy = r * 1.76;
    for (let row = 0, y = R - r; y >= -R + r; row++, y -= dy)
      for (let x = -R + r + (row % 2 ? dx / 2 : 0); x <= R - r; x += dx) if (Math.hypot(x, y) <= R - r) pts.push([x + (random() - 0.5) * r * 0.2, y + (random() - 0.5) * r * 0.15]);
    if (pts.length >= n){ pts.sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0])); return { r, pts:pts.slice(0, n) }; }
    r *= 0.95;
  }
  return { r, pts:Array.from({ length:n }, () => [0, 0]) };
}

function pickNormalizeImage(raw){
  const value = raw && typeof raw === "object" ? raw : null, dataUrl = value ? String(value.dataUrl || "") : "";
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(dataUrl) || dataUrl.length > PICK_IMAGE_MAX_CHARS) return null;
  return { dataUrl, width:Math.max(1, Math.min(10000, Number(value.width) || 1)), height:Math.max(1, Math.min(10000, Number(value.height) || 1)) };
}
function pickNormalizePerson(raw, index){
  const value = raw && typeof raw === "object" ? raw : {};
  return { id:pickText(value.id, 80) || pickId(), name:pickText(value.name, 40).trim(), color:pickColor(value.color, PICK_COLORS[(index || 0) % PICK_COLORS.length]),
    image:pickNormalizeImage(value.image), off:value.off === true };
}
/* 게임별 설정 — 아는 게임은 그 게임이 고르고(normalize), 모르는 게임(더 새 앱이 쓴 것)은 작은 JSON 이면 그대로 들고 간다.
   그래야 옛 앱이 열었다 저장해도 새 게임 설정이 사라지지 않는다. */
function pickNormalizeGames(raw){
  const out = {}, value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  Object.keys(value).slice(0, 20).forEach(key => {
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(key)) return;
    const item = value[key]; if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const impl = PICK_GAME_IMPL[key];
    if (impl && typeof impl.normalize === "function"){ out[key] = impl.normalize(item); return; }
    try { const text = JSON.stringify(item); if (text.length <= PICK_GAME_SETTINGS_MAX_CHARS) out[key] = JSON.parse(text); } catch(_){}
  });
  return out;
}
function pickDocEmpty(title){
  return { type:PICK_DOC_TYPE, version:PICK_DOC_VERSION, title:pickText(title || "오늘은 누가?", 120), game:"roulette", motion:"normal", sound:true, autoRest:false, people:[], games:{} };
}
function pickDocParse(text){
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  if (!raw || raw.type !== PICK_DOC_TYPE || !Array.isArray(raw.people)) throw new Error("pick-format");
  const model = pickDocEmpty(raw.title);
  if (typeof raw.title === "string") model.title = pickText(raw.title, 120);
  // 모르는 게임(더 새 앱에서 고른 것)도 이름은 그대로 둔다 — 화면은 있는 게임으로 보여 주고, 저장하면 원래 게임이 남는다.
  model.game = /^[a-z][a-z0-9-]{0,23}$/.test(String(raw.game || "")) ? String(raw.game) : "roulette";
  model.motion = Object.prototype.hasOwnProperty.call(PICK_MOTION, raw.motion) ? raw.motion : "normal";
  model.sound = raw.sound !== false; model.autoRest = raw.autoRest === true;
  const ids = new Set();
  model.people = raw.people.slice(0, PICK_MAX_PEOPLE).map(pickNormalizePerson).filter(person => (person.name || person.image) && !ids.has(person.id) && ids.add(person.id));
  model.games = pickNormalizeGames(raw.games);
  return model;
}
function pickDocSerialize(model){ return JSON.stringify(pickDocParse({ ...model, type:PICK_DOC_TYPE, version:PICK_DOC_VERSION }), null, 2); }
function pickActive(model){ return (model.people || []).filter(person => !person.off); }
function pickPersonLabel(person){ return person ? (person.name || "사진 참가자") : ""; }
/* 이름 여러 개 넣기 — 빈 줄은 버리고, 한도를 넘는 만큼은 빼고 알려 준다. */
function pickAddPeople(model, names){
  const list = (names || []).map(name => pickText(name, 40).trim()).filter(Boolean), room = Math.max(0, PICK_MAX_PEOPLE - model.people.length);
  const added = [];
  list.slice(0, room).forEach(name => { const person = pickNormalizePerson({ name, color:pickNextColor(model.people) }); model.people.push(person); added.push(person); });
  return { added:added.length, skipped:list.length - added.length, people:added };
}
function pickSplitNames(text){ return String(text || "").split(/\r?\n|\t|,(?=\s*\S)/).map(line => line.trim()).filter(Boolean); }
function pickSearchText(model){ return [model.title, ...(model.people || []).map(person => person.name)].filter(Boolean).join("\n"); }
function pickDefaultTitle(name){ const base = String(name || "").replace(/\.pick$/i, ""); return !base || /^복불복( \d+)?$/.test(base) ? "오늘은 누가?" : base; }
function pickScratchFileName(number){ return number > 1 ? "복불복 " + number + ".pick" : "복불복.pick"; }
function pickSafeName(value){ return String(value || "복불복").replace(/[\\/:*?"<>|]+/g, "_").trim() || "복불복"; }
function pickEaseOut(t){ const x = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - x, 4); }

/* 얼굴 — 사진이 있으면 사진, 없으면 참가자 색 동그라미에 웃는 얼굴. */
function pickFaceSvg(){
  return '<svg class="pick-face" viewBox="0 0 40 40" aria-hidden="true"><circle cx="14.5" cy="17" r="2.1"/><circle cx="25.5" cy="17" r="2.1"/><path d="M14 24.5q6 5 12 0" fill="none" stroke-width="2.4" stroke-linecap="round"/></svg>';
}
function pickAvatar(person, className){
  const el = document.createElement("span"); el.className = "pick-avatar" + (className ? " " + className : "");
  el.style.setProperty("--pk-c", person ? person.color : "#e5e7eb");
  if (person && person.image){ const img = document.createElement("img"); img.src = person.image.dataUrl; img.alt = ""; img.draggable = false; el.appendChild(img); }
  else el.innerHTML = pickFaceSvg();
  return el;
}
function pickButton(label, title, className, icon){
  const button = document.createElement("button"); button.type = "button"; button.className = className || "tier-btn";
  button.innerHTML = icon || "";
  if (label){ const span = document.createElement("span"); if (/run-save/.test(button.className)) span.className = "run-save-label"; span.textContent = label; button.append(span); }
  else button.classList.add("tier-ico");
  if (title){ button.title = title; button.setAttribute("aria-label", title); }
  return button;
}
function pickUiIcon(name){ return typeof window.uiIcon === "function" ? window.uiIcon(name) : ""; }
const PICK_UI_PATHS = {
  grid:'<circle cx="5" cy="5" r="1.7"/><circle cx="12" cy="5" r="1.7"/><circle cx="19" cy="5" r="1.7"/><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/><circle cx="5" cy="19" r="1.7"/><circle cx="12" cy="19" r="1.7"/><circle cx="19" cy="19" r="1.7"/>',
  kebab:'<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  play:'<path d="M7 4.5v15l12.5-7.5z"/>'
};
function pickSvg(name, extraClass, filled){
  return '<svg class="ui-icon' + (extraClass ? " " + extraClass : "") + '" viewBox="0 0 24 24" fill="' + (filled ? "currentColor" : "none") + '" stroke="' + (filled ? "none" : "currentColor") + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PICK_UI_PATHS[name] || "") + "</svg>";
}

/* ── 효과음 ── 소리 파일 없이 WebAudio 로 만든다. 처음 누른 순간에 AudioContext 를 연다(브라우저 자동 재생 규칙). */
let _pickAudio = null;
function pickAudio(){
  if (_pickAudio) return _pickAudio;
  const Ctx = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null; if (!Ctx) return null;
  try { _pickAudio = new Ctx(); } catch(_){ _pickAudio = null; }
  return _pickAudio;
}
function pickTone(ctx, at, freq, dur, type, gain){
  const osc = ctx.createOscillator(), amp = ctx.createGain(); osc.type = type || "triangle"; osc.frequency.setValueAtTime(freq, at);
  amp.gain.setValueAtTime(0.0001, at); amp.gain.exponentialRampToValueAtTime(gain || 0.12, at + 0.008); amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(amp); amp.connect(ctx.destination); osc.start(at); osc.stop(at + dur + 0.02);
}
function pickPlaySound(kind){
  const ctx = pickAudio(); if (!ctx) return; if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  if (kind === "tick") pickTone(ctx, now, 1500, 0.035, "square", 0.035);
  else if (kind === "pop") pickTone(ctx, now, 660, 0.09, "triangle", 0.08);
  else if (kind === "win") [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => pickTone(ctx, now + i * 0.11, freq, i === 3 ? 0.5 : 0.16, "triangle", 0.12));
  else if (kind === "snap"){ pickTone(ctx, now, 220, 0.08, "square", 0.12); pickTone(ctx, now + 0.05, 110, 0.22, "sawtooth", 0.14); }
  else if (kind === "roll") [0, 0.05, 0.11, 0.18].forEach(dt => pickTone(ctx, now + dt, 180 + Math.random() * 160, 0.04, "square", 0.04));
  else if (kind === "boom"){
    // 펑 — 짧은 잡음을 낮은 쪽만 남겨 터지는 소리처럼.
    const len = Math.floor(ctx.sampleRate * 0.7), buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain(); src.buffer = buf; filter.type = "lowpass"; filter.frequency.setValueAtTime(900, now); filter.frequency.exponentialRampToValueAtTime(80, now + 0.6);
    amp.gain.setValueAtTime(0.5, now); src.connect(filter); filter.connect(amp); amp.connect(ctx.destination); src.start(now);
  }
}

async function loadPickDoc(file, opts = {}){
  let model; try { model = pickDocParse(await file.text()); }
  catch(_){ if (typeof toast === "function") toast("복불복(.pick)을 읽지 못해 텍스트로 열었어요.", 3600); return typeof loadText === "function" ? loadText(file, opts) : null; }
  const doc = makeDoc("pick", file.name, opts); doc.pickDoc = model; doc.sourceFile = file; doc.savedText = pickDocSerialize(model);
  doc.contentSearchFocus = query => { const needle = String(query || "").trim().toLowerCase(), found = model.people.find(person => person.name.toLowerCase().includes(needle)); if (!found || typeof doc.pickFocus !== "function") return false; return doc.pickFocus(found.id); };
  doc.render = async () => { if (doc._pickMounted) return; doc._pickMounted = true; doc.el.innerHTML = ""; mountPickEditor(doc); };
  if (typeof refreshChrome === "function") refreshChrome(); if (typeof activateIfIdle === "function") activateIfIdle(doc, opts); return doc;
}
function newPickScratch(){
  _pickScratchCount++; const name = pickScratchFileName(_pickScratchCount); if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([pickDocSerialize(pickDocEmpty(pickDefaultTitle(name)))], name, { type:"application/json" })], { isScratch:true }));
}
function newPickScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, pickScratchFileName, name => pickDocSerialize(pickDocEmpty(pickDefaultTitle(name))), "application/json", "복불복");
}
async function savePickDoc(doc){
  if (!doc || !doc.pickDoc) return false; const json = pickDocSerialize(doc.pickDoc), ok = typeof saveTextDoc === "function" ? await saveTextDoc(json, doc, doc.name) : false; if (!ok) return false;
  doc.savedText = json; if (typeof doc.pickMarkSaved === "function") doc.pickMarkSaved();
  if (typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json"); else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false); return true;
}

/* 손글씨 쪽지 — 일기장 손글씨(펜)를 빌려 쓴다. 없으면 브라우저의 cursive 로. */
function pickHandFontStack(){ return typeof DIARY_FONT_STACKS === "object" && DIARY_FONT_STACKS.pen ? DIARY_FONT_STACKS.pen : "cursive"; }

function mountPickEditor(doc){
  const model = doc.pickDoc, root = document.createElement("div"); root.className = "pick-doc"; doc.el.appendChild(root);
  const say = (message, ms, opts) => { if (typeof toast === "function") toast(message, ms || 2600, opts); };
  root.style.setProperty("--pk-hand", pickHandFontStack());
  if (typeof diaryEnsureFont === "function") diaryEnsureFont("pen").catch(() => {});

  /* 머리말 — 로고·제목 / 게임 선택 · 되돌리기 · 저장 · 설정 */
  const bar = document.createElement("div"); bar.className = "pick-bar";
  const brand = document.createElement("div"); brand.className = "pick-brand";
  brand.innerHTML = '<span class="pick-logo" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="15" cy="17" r="6.5" fill="#c4b5fd"/><circle cx="33" cy="17" r="6.5" fill="#93c5fd"/><path d="M4 38c1-7.5 5.5-11.5 11-11.5S25 30.5 26 38z" fill="#c4b5fd"/><path d="M22 38c1-7.5 5.5-11.5 11-11.5S43 30.5 44 38z" fill="#93c5fd"/><circle cx="24" cy="21" r="7.5" fill="#8b5cf6"/><path d="M11 42c1.3-8.5 6.5-13 13-13s11.7 4.5 13 13z" fill="#8b5cf6"/></svg></span>';
  const titleInput = document.createElement("input"); titleInput.className = "pick-title"; titleInput.value = model.title; titleInput.maxLength = 120; titleInput.placeholder = "제목 (예: 오늘은 누가?)"; titleInput.title = "눌러서 제목 바꾸기";
  const tagline = document.createElement("span"); tagline.className = "pick-tagline"; tagline.textContent = "함께하는 모든 순간이 특별하니까";
  brand.append(titleInput, tagline);
  const gameBtn = pickButton("게임 선택", "게임 고르기", "tier-btn pick-game-btn", pickSvg("grid", "", true));
  gameBtn.insertAdjacentHTML("beforeend", pickUiIcon("chevronDown"));
  const undoBtn = pickButton("", "실행 취소 (Ctrl+Z)", "tier-btn", pickUiIcon("undo")), redoBtn = pickButton("", "다시 실행 (Ctrl+Y)", "tier-btn", pickUiIcon("redo"));
  const saveBtn = pickButton("저장하기", "명단 저장 (Ctrl+S)", "tier-btn tier-primary run-save", pickUiIcon("save"));
  const moreBtn = pickButton("", "설정 — 효과음·움직임·뽑힌 사람 빼기·참가자 한꺼번에", "tier-btn", pickUiIcon("settings"));
  const actions = document.createElement("div"); actions.className = "pick-actions"; actions.append(gameBtn, undoBtn, redoBtn, saveBtn, moreBtn);
  bar.append(brand, actions);

  /* 본문 — 왼쪽 게임 판 / 오른쪽 참가자 */
  const main = document.createElement("div"); main.className = "pick-main";
  const stage = document.createElement("section"); stage.className = "pick-stage";
  const head = document.createElement("div"); head.className = "pick-head";
  const gameTitle = document.createElement("h1"); gameTitle.className = "pick-game-title";
  const gameSub = document.createElement("p"); gameSub.className = "pick-game-sub";
  head.append(gameTitle, gameSub);
  const note = document.createElement("div"); note.className = "pick-note"; note.setAttribute("aria-hidden", "true");
  const arena = document.createElement("div"); arena.className = "pick-arena";
  const controls = document.createElement("div"); controls.className = "pick-controls";
  const goBtn = document.createElement("button"); goBtn.type = "button"; goBtn.className = "pick-go"; goBtn.innerHTML = pickSvg("play", "pick-go-icon", true) + '<span class="pick-go-label"></span>';
  const log = document.createElement("div"); log.className = "pick-log"; log.hidden = true;
  controls.append(goBtn, log);
  const result = document.createElement("div"); result.className = "pick-result"; result.hidden = true;
  const confetti = document.createElement("canvas"); confetti.className = "pick-confetti"; confetti.setAttribute("aria-hidden", "true");
  stage.append(head, note, arena, controls, result, confetti);

  const side = document.createElement("aside"); side.className = "pick-side";
  const sideHead = document.createElement("div"); sideHead.className = "pick-side-head";
  sideHead.innerHTML = '<h2>참가자</h2><span class="pick-count"></span>';
  const list = document.createElement("ul"); list.className = "pick-list";
  const addBtn = pickButton("참가자 추가", "참가자 추가 — 이름을 쓰고 Enter. 여러 줄을 붙여 넣으면 한꺼번에 들어가요", "pick-add", pickUiIcon("plus"));
  const addRow = document.createElement("div"); addRow.className = "pick-add-row"; addRow.hidden = true;
  const addInput = document.createElement("input"); addInput.className = "pick-add-input"; addInput.maxLength = 400; addInput.placeholder = "이름 쓰고 Enter (여러 줄 붙여넣기 OK)";
  const addDone = pickButton("", "닫기 (Esc)", "pick-add-done", pickUiIcon("close"));
  addRow.append(addInput, addDone);
  const sideNote = document.createElement("div"); sideNote.className = "pick-side-note"; sideNote.setAttribute("aria-hidden", "true"); sideNote.textContent = "오늘도\n좋은 하루 되세요! ♡";
  side.append(sideHead, list, addRow, addBtn, sideNote);
  main.append(stage, side);
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"; fileInput.multiple = true; fileInput.hidden = true;
  root.append(bar, main, fileInput);

  /* 되돌리기 — 사진 바이트 대신 짧은 열쇠만 기록한다(티어표·대진표와 같은 까닭). */
  const imageKeys = new WeakMap(), imageStore = new Map(); let imageSeq = 0;
  const imageKey = image => { if (!image) return ""; let key = imageKeys.get(image); if (!key){ key = "i" + (++imageSeq); imageKeys.set(image, key); imageStore.set(key, image); } return key; };
  const snapshot = () => JSON.stringify({ ...model, people:model.people.map(person => ({ ...person, image:imageKey(person.image) })) });
  let savedSnapshot = snapshot(), recoveryTimer = 0, history = null;
  // 진행 상태 — history.reset() 이 곧바로 syncButtons 를 부르므로 그보다 먼저 선언해 둔다.
  let busy = false, game = null, gameId = "", picks = [];
  doc.pickMarkSaved = () => { savedSnapshot = snapshot(); if (history) history.replaceCurrent(savedSnapshot); };
  const flushRecovery = async () => { clearTimeout(recoveryTimer); recoveryTimer = 0; if (!doc.hasUnsavedEdits && !(doc.isScratch && !doc._named)) return true; if (typeof rememberWorkspace !== "function" || typeof recoverySnapshotFile !== "function") return false;
    try { const file = recoverySnapshotFile(doc, new TextEncoder().encode(pickDocSerialize(model)), "application/json"); doc.savedInWorkspace = file ? await rememberWorkspace([file], false, { silent:true }) : false; return !!doc.savedInWorkspace; } catch(error){ console.warn("복불복 복구본 저장 실패:", error); return false; } };
  const touch = () => { if (typeof markDocumentDirty === "function") markDocumentDirty(doc, snapshot() !== savedSnapshot); clearTimeout(recoveryTimer); recoveryTimer = setTimeout(flushRecovery, PICK_RECOVERY_DELAY); };
  doc.flushBackupRecovery = flushRecovery;
  const replaceModel = value => {
    const raw = JSON.parse(value); Object.keys(raw).forEach(key => { model[key] = raw[key]; });
    model.people = raw.people.map(person => ({ ...person, image:person.image ? imageStore.get(person.image) || null : null }));
    titleInput.value = model.title; render(); touch();
  };
  history = MNEditHistory.create({ capture:snapshot, isEqual:(a, b) => a === b, apply:replaceModel, onChange:() => syncButtons(), limit:PICK_HISTORY_LIMIT }); history.reset(); doc._pickHistory = history;
  const changed = () => { history.commit(); touch(); render(); };

  /* ── 진행 상태 ── 게임이 도는 동안(busy)엔 명단을 못 바꾼다 — 뽑을 때의 명단과 화면이 어긋나지 않게. */
  const motion = () => { const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; return reduce ? 0 : (PICK_MOTION[model.motion] == null ? 1 : PICK_MOTION[model.motion]); };
  const sound = kind => { if (model.sound) pickPlaySound(kind); };
  function syncButtons(){
    undoBtn.disabled = busy || !history.canUndo(); redoBtn.disabled = busy || !history.canRedo();
    const ready = !!(game && (typeof game.canStart !== "function" || game.canStart()));
    // 폭탄 돌리기처럼 도는 동안에도 시작 단추가 할 일(넘기기)이 있는 게임은 goWhileBusy 로 알려 준다.
    const goOpen = busy && !!(game && typeof game.goWhileBusy === "function" && game.goWhileBusy());
    goBtn.disabled = (busy && !goOpen) || !ready; root.classList.toggle("is-busy", busy);
  }
  function setBusy(on){ busy = !!on; syncButtons(); }
  function currentGame(){ const ready = pickReadyGames(); return ready.find(item => item.id === model.game) || ready[0] || PICK_GAMES[0]; }

  /* ── 참가자 목록 ── */
  const rowFor = person => {
    const li = document.createElement("li"); li.className = "pick-person" + (person.off ? " is-off" : ""); li.dataset.id = person.id;
    const face = pickAvatar(person); face.setAttribute("role", "button"); face.tabIndex = 0; face.title = "고치기 — 이름·색·사진"; face.classList.add("pick-person-face");
    const name = document.createElement("span"); name.className = "pick-person-name"; name.textContent = pickPersonLabel(person);
    const rest = document.createElement("button"); rest.type = "button"; rest.className = "pick-person-rest"; rest.textContent = person.off ? "쉬는 중" : "";
    rest.hidden = !person.off; rest.title = "눌러서 다시 넣기";
    const more = pickButton("", "더 보기 — 고치기·이번엔 빼기·순서·지우기", "pick-person-more", pickSvg("kebab", "", true));
    li.append(face, name, rest);
    // 게임이 붙이는 작은 표(공 뽑기의 번호 등)
    const badge = !person.off && game && typeof game.badge === "function" ? game.badge(person) : "";
    if (badge){ const tag = document.createElement("span"); tag.className = "pick-person-badge"; tag.textContent = badge; li.appendChild(tag); }
    li.appendChild(more);
    return li;
  };
  function renderList(){
    const active = pickActive(model).length;
    sideHead.querySelector(".pick-count").textContent = model.people.length ? (active === model.people.length ? `${active}명` : `${active}/${model.people.length}명`) : "0명";
    list.innerHTML = ""; const frag = document.createDocumentFragment(); model.people.forEach(person => frag.appendChild(rowFor(person))); list.appendChild(frag);
    list.classList.toggle("is-empty", !model.people.length);
    if (!model.people.length){ const li = document.createElement("li"); li.className = "pick-list-empty"; li.textContent = "아래 '참가자 추가'로 이름을 넣어 주세요. 여러 줄을 붙여 넣으면 한꺼번에 들어가요."; list.appendChild(li); }
    addBtn.disabled = model.people.length >= PICK_MAX_PEOPLE;
  }
  const personById = id => model.people.find(person => person.id === id) || null;
  function personMenuItems(person){
    const index = model.people.indexOf(person);
    return [
      { label:"고치기…", title:"이름·색·사진", icon:"pen", action:() => openPersonDialog(person.id) },
      { label:person.off ? "다시 넣기" : "이번엔 빼기", title:person.off ? "다시 뽑기에 넣어요" : "명단엔 두고 뽑기에서만 빼요 (결석·이미 뽑힘)", icon:person.off ? "plus" : "close", action:() => { person.off = !person.off; changed(); } },
      { label:"색", icon:"sticker", children:PICK_COLORS.map((color, i) => ({ label:PICK_COLOR_NAMES[i], active:person.color === color, action:() => { person.color = color; changed(); } })) },
      { separator:true },
      { label:"위로", icon:"chevronUp", disabled:index <= 0, action:() => movePerson(person.id, -1) },
      { label:"아래로", icon:"chevronDown", disabled:index >= model.people.length - 1, action:() => movePerson(person.id, 1) },
      { separator:true },
      { label:"명단에서 지우기", title:"Ctrl+Z 로 되돌릴 수 있어요", icon:"delete", action:() => removePerson(person.id) }
    ];
  }
  function movePerson(id, delta){ const at = model.people.findIndex(person => person.id === id), to = at + delta; if (at < 0 || to < 0 || to >= model.people.length) return; const [person] = model.people.splice(at, 1); model.people.splice(to, 0, person); changed(); }
  function removePerson(id){ const at = model.people.findIndex(person => person.id === id); if (at < 0) return; const [gone] = model.people.splice(at, 1); changed(); say(`'${pickPersonLabel(gone)}'을(를) 명단에서 지웠어요. 되돌리려면 Ctrl+Z`, 2800); }
  const openMenu = (x, y, items, anchor) => { if (typeof MNContextMenu === "undefined") return; if (anchor) anchor.classList.add("is-open"); MNContextMenu.open(x, y, items, { base:"text-context", onClose:() => { if (anchor) anchor.classList.remove("is-open"); } }); };
  list.addEventListener("click", event => {
    if (busy) return;
    const li = event.target.closest(".pick-person"); if (!li) return; const person = personById(li.dataset.id); if (!person) return;
    if (event.target.closest(".pick-person-more")){ const rect = event.target.closest(".pick-person-more").getBoundingClientRect(); openMenu(rect.right - 200, rect.bottom + 4, personMenuItems(person), event.target.closest(".pick-person-more")); return; }
    if (event.target.closest(".pick-person-rest")){ person.off = false; changed(); return; }
    if (event.target.closest(".pick-person-face")) openPersonDialog(person.id);
  });
  list.addEventListener("dblclick", event => { if (busy) return; const li = event.target.closest(".pick-person"); if (li && !event.target.closest("button")) openPersonDialog(li.dataset.id); });
  list.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && event.target.classList && event.target.classList.contains("pick-person-face")){ event.preventDefault(); if (!busy) openPersonDialog(event.target.closest(".pick-person").dataset.id); } });
  list.addEventListener("contextmenu", event => { const li = event.target.closest(".pick-person"); if (!li || busy) return; const person = personById(li.dataset.id); if (!person) return; event.preventDefault(); event.stopPropagation(); openMenu(event.clientX, event.clientY, personMenuItems(person)); });

  /* 참가자 추가 — 단추를 누르면 입력칸이 열리고, Enter 로 한 명씩 이어서 넣는다. 여러 줄을 붙여 넣으면 한꺼번에. */
  const openAdd = () => { if (busy) return; addRow.hidden = false; addBtn.hidden = true; addInput.value = ""; setTimeout(() => addInput.focus(), 0); };
  const closeAdd = () => { addRow.hidden = true; addBtn.hidden = false; };
  const addNames = names => {
    if (!names.length) return;
    const out = pickAddPeople(model, names); if (out.added) changed();
    if (out.skipped) say(`참가자는 ${PICK_MAX_PEOPLE}명까지예요 — ${out.skipped}명은 넣지 못했어요.`, 3200);
    else if (out.added > 1) say(`${out.added}명을 넣었어요.`, 2000);
    const last = list.querySelector(".pick-person:last-child"); if (last) last.scrollIntoView({ block:"nearest" });
  };
  addBtn.onclick = openAdd; addDone.onclick = closeAdd;
  addInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing){ event.preventDefault(); const value = addInput.value.trim(); if (!value){ closeAdd(); return; } addInput.value = ""; addNames(pickSplitNames(value)); }
    else if (event.key === "Escape"){ event.preventDefault(); event.stopPropagation(); closeAdd(); }
  });
  addInput.addEventListener("paste", event => {
    const text = event.clipboardData ? event.clipboardData.getData("text") : ""; if (!/[\r\n\t]/.test(text)) return;
    event.preventDefault(); addNames(pickSplitNames(addInput.value + text)); addInput.value = "";
  });
  addInput.addEventListener("blur", () => { setTimeout(() => { if (!addRow.hidden && !addInput.value.trim() && document.activeElement !== addInput && !addRow.contains(document.activeElement)) closeAdd(); }, 120); });

  /* ── 창들 ── 티어표 창(tierModal·tier-form)을 함께 쓴다. */
  function openPersonDialog(id){
    const person = personById(id); if (!person) return;
    const form = document.createElement("div"); form.className = "tier-form pick-person-form";
    form.innerHTML = '<div class="wide pick-person-preview"></div><label class="wide"><span>이름</span><input class="pf-name" maxlength="40"></label>'
      + '<div class="wide pick-swatches" role="radiogroup" aria-label="색"></div>'
      + '<div class="wide tier-form-actions"><button type="button" class="pf-photo">사진 넣기</button><button type="button" class="pf-photo-remove">사진 빼기</button><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" hidden></div>'
      + '<label class="wide pick-check"><input type="checkbox" class="pf-off"><span>이번엔 빼기 (명단엔 두고 뽑기에서만 빼요)</span></label>'
      + '<p class="tier-form-error wide" role="alert"></p><footer class="wide"><button type="button" class="pf-delete danger">명단에서 지우기</button><span></span><button type="button" class="pf-cancel">취소</button><button type="button" class="pf-save primary">확인</button></footer>';
    const ui = tierModal("참가자 고치기", form), nameInput = form.querySelector(".pf-name"), preview = form.querySelector(".pick-person-preview"), swatches = form.querySelector(".pick-swatches");
    const photoInput = form.querySelector("input[type=file]"), error = form.querySelector(".tier-form-error"), offBox = form.querySelector(".pf-off");
    let image = person.image, color = person.color;
    const sync = () => {
      preview.innerHTML = ""; preview.appendChild(pickAvatar({ ...person, image, color }, "is-large"));
      swatches.querySelectorAll("button").forEach(button => button.setAttribute("aria-checked", button.dataset.color === color ? "true" : "false"));
      form.querySelector(".pf-photo").textContent = image ? "사진 바꾸기" : "사진 넣기"; form.querySelector(".pf-photo-remove").hidden = !image;
    };
    PICK_COLORS.forEach((value, i) => { const b = document.createElement("button"); b.type = "button"; b.className = "pick-swatch"; b.dataset.color = value; b.style.setProperty("--pk-c", value); b.setAttribute("role", "radio"); b.title = PICK_COLOR_NAMES[i]; b.setAttribute("aria-label", PICK_COLOR_NAMES[i]); b.onclick = () => { color = value; sync(); }; swatches.appendChild(b); });
    nameInput.value = person.name; offBox.checked = person.off; sync();
    form.querySelector(".pf-photo").onclick = () => photoInput.click();
    form.querySelector(".pf-photo-remove").onclick = () => { image = null; sync(); };
    photoInput.onchange = async () => { const file = photoInput.files && photoInput.files[0]; photoInput.value = ""; if (!file) return; try { image = await tierPrepareImage(file); sync(); } catch(_){ error.textContent = "사진을 넣지 못했어요."; } };
    form.querySelector(".pf-cancel").onclick = ui.dispose;
    form.querySelector(".pf-delete").onclick = () => { ui.dispose(); removePerson(person.id); };
    form.querySelector(".pf-save").onclick = () => {
      const value = pickText(nameInput.value, 40).trim();
      if (!value && !image){ error.textContent = "이름을 쓰거나 사진을 넣으세요."; nameInput.focus(); return; }
      person.name = value; person.image = image; person.color = color; person.off = offBox.checked; ui.dispose(); changed();
    };
    nameInput.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing){ event.preventDefault(); form.querySelector(".pf-save").click(); } });
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
  }
  function openBulkDialog(){
    const form = document.createElement("div"); form.className = "tier-form";
    form.innerHTML = '<label class="wide"><span>한 줄에 한 명씩 적으세요 (엑셀 열을 그대로 붙여 넣어도 돼요)</span><textarea class="pf-lines" rows="10" placeholder="예)\n민수\n지우\n서연\n준호"></textarea></label>'
      + '<label class="wide pick-check"><input type="checkbox" class="pf-replace"><span>지금 명단을 지우고 이 명단으로 바꾸기</span></label>'
      + '<p class="wide pick-form-note"></p><p class="tier-form-error wide" role="alert"></p>'
      + '<footer class="wide"><span></span><button type="button" class="pf-cancel">취소</button><button type="button" class="pf-save primary">넣기</button></footer>';
    const ui = tierModal("참가자 한꺼번에 넣기", form), area = form.querySelector(".pf-lines"), replace = form.querySelector(".pf-replace"), noteEl = form.querySelector(".pick-form-note"), error = form.querySelector(".tier-form-error");
    const paint = () => { const n = pickSplitNames(area.value).length, base = replace.checked ? 0 : model.people.length; noteEl.textContent = `지금 ${model.people.length}명` + (n ? ` → 넣으면 ${Math.min(PICK_MAX_PEOPLE, base + n)}명` : "") + (base + n > PICK_MAX_PEOPLE ? ` · ${PICK_MAX_PEOPLE}명을 넘는 ${base + n - PICK_MAX_PEOPLE}명은 빠져요` : ""); };
    area.addEventListener("input", paint); replace.addEventListener("change", paint); paint();
    form.querySelector(".pf-cancel").onclick = ui.dispose;
    form.querySelector(".pf-save").onclick = () => {
      const names = pickSplitNames(area.value); if (!names.length){ error.textContent = "넣을 이름을 적으세요."; area.focus(); return; }
      if (replace.checked) model.people = [];
      const out = pickAddPeople(model, names); ui.dispose(); changed();
      say(`${out.added}명을 넣었어요.` + (out.skipped ? ` (${out.skipped}명은 ${PICK_MAX_PEOPLE}명을 넘어 뺌)` : ""), 3000);
    };
    setTimeout(() => area.focus(), 0);
  }
  async function addImageFiles(files){
    const images = Array.from(files || []).filter(file => /^image\//i.test(file.type || "")); if (!images.length || busy) return 0;
    const room = PICK_MAX_PEOPLE - model.people.length; if (room <= 0){ say(`참가자는 ${PICK_MAX_PEOPLE}명까지예요.`, 2800); return 0; }
    const known = new Set(model.people.map(person => person.image && person.image.dataUrl).filter(Boolean)); let added = 0, failed = 0, same = 0;
    for (const file of images.slice(0, room)){
      try { const image = await tierPrepareImage(file); if (known.has(image.dataUrl)){ same++; continue; } known.add(image.dataUrl);
        const person = pickNormalizePerson({ name:String(file.name || "").replace(/\.[^.]+$/, ""), color:pickNextColor(model.people) }); person.image = image; model.people.push(person); added++; }
      catch(_){ failed++; }
    }
    if (added) changed();
    say((added || !same ? `사진 참가자 ${added}명을 넣었어요.` : "이미 있는 사진이에요.") + (same ? ` (같은 사진 ${same}장은 뺌)` : "") + (failed ? ` (${failed}장은 읽지 못함)` : "") + (images.length > room ? ` (${images.length - room}장은 한도를 넘어 뺌)` : ""), 3200);
    return added;
  }

  /* ── 결과 ── 게임이 뽑은 사람을 크게 보여 주고, 뽑힌 차례를 아래에 남긴다(화면에만). */
  let confettiFrame = 0;
  function burst(){
    if (!motion()) return;
    cancelAnimationFrame(confettiFrame);
    const w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1); if (!w || !h) return;
    confetti.width = Math.round(w * dpr); confetti.height = Math.round(h * dpr);
    const ctx = confetti.getContext("2d"); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ["#ff4f86", "#ffd166", "#06d6a0", "#118ab2", "#8b80f9", "#ff7a59", "#f5c542"], parts = [];
    for (let n = 0; n < 160; n++){ const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 8; parts.push({ x:w / 2, y:h * 0.42, vx:Math.cos(a) * s, vy:Math.sin(a) * s - 5, r:3 + Math.random() * 4, c:colors[n % colors.length], spin:Math.random() * 6, t:Math.random() * 6 }); }
    const start = performance.now();
    const tick = now => {
      const life = (now - start) / 2600; ctx.clearRect(0, 0, w, h); if (life >= 1) return;
      ctx.globalAlpha = Math.min(1, (1 - life) * 2.2);
      parts.forEach(p => { p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.t += p.spin * 0.02; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); });
      confettiFrame = requestAnimationFrame(tick);
    };
    confettiFrame = requestAnimationFrame(tick);
  }
  function renderLog(){
    log.innerHTML = ""; log.hidden = !picks.length; if (!picks.length) return;
    const label = document.createElement("span"); label.className = "pick-log-label"; label.textContent = "뽑힌 차례"; log.appendChild(label);
    picks.forEach((entry, i) => { const chip = document.createElement("span"); chip.className = "pick-log-chip"; chip.style.setProperty("--pk-c", entry.color); chip.innerHTML = `<b>${i + 1}</b>`; chip.append(document.createTextNode(entry.name)); log.appendChild(chip); });
    const clear = pickButton("", "뽑힌 차례 지우기", "pick-log-clear", pickUiIcon("close")); clear.onclick = () => { picks = []; renderLog(); }; log.appendChild(clear);
  }
  function hideResult(){ result.hidden = true; result.innerHTML = ""; if (game && typeof game.clearResult === "function") game.clearResult(); }
  /* 게임이 부른다 — winner: 뽑힌 사람(한 명 또는 여럿, 없어도 됨).
     opts.kicker: 위 작은 글("오늘의 주인공" 등) · opts.title: 뽑힌 사람이 없을 때 큰 글 · opts.rows: [{ person, name, label, win }] 결과 표(사다리 칸·구슬 순위) */
  function showResult(winner, opts = {}){
    const people = (Array.isArray(winner) ? winner : [winner]).filter(Boolean), rows = Array.isArray(opts.rows) ? opts.rows : [];
    if (!people.length && !rows.length) return;
    people.forEach(person => picks.push({ id:person.id, name:pickPersonLabel(person), color:person.color })); renderLog();
    const rested = model.autoRest ? people.filter(person => !person.off) : [];
    if (rested.length){ rested.forEach(person => { person.off = true; }); history.commit(); touch(); renderList(); }
    result.innerHTML = ""; result.hidden = false;
    const card = document.createElement("div"); card.className = "pick-result-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-live", "polite");
    const kicker = document.createElement("span"); kicker.className = "pick-result-kicker"; kicker.textContent = opts.kicker || "오늘의 주인공";
    card.appendChild(kicker);
    if (people.length === 1){
      const name = document.createElement("strong"); name.className = "pick-result-name"; name.textContent = pickPersonLabel(people[0]);
      card.append(pickAvatar(people[0], "is-large"), name);
    } else if (people.length > 1){
      const many = document.createElement("div"); many.className = "pick-result-many";
      people.forEach(person => { const item = document.createElement("span"); item.className = "pick-result-one"; const name = document.createElement("strong"); name.textContent = pickPersonLabel(person); item.append(pickAvatar(person, "is-mid"), name); many.appendChild(item); });
      card.appendChild(many);
    } else {
      const title = document.createElement("strong"); title.className = "pick-result-name is-title"; title.textContent = opts.title || "결과"; card.appendChild(title);
    }
    if (rows.length){
      const table = document.createElement("ol"); table.className = "pick-result-rows";
      rows.forEach(row => {
        const li = document.createElement("li"); if (row.win) li.classList.add("is-win");
        const tag = document.createElement("span"); tag.className = "pick-result-tag"; tag.textContent = row.label || "";
        const name = document.createElement("span"); name.className = "pick-result-row-name"; name.textContent = row.person ? pickPersonLabel(row.person) : (row.name || "");
        li.append(tag); if (row.person) li.appendChild(pickAvatar(row.person)); li.appendChild(name); table.appendChild(li);
      });
      card.appendChild(table);
    }
    const buttons = document.createElement("div"); buttons.className = "pick-result-actions";
    const again = pickButton(opts.againLabel || "한 번 더", "같은 명단으로 다시 (Space)", "tier-btn tier-primary", pickUiIcon("refresh"));
    const restLabel = people.length === 1 ? `${pickPersonLabel(people[0])} 빼고 다시` : "뽑힌 사람 빼고 다시";
    const restAgain = pickButton(restLabel, "뽑힌 사람을 '이번엔 빼기'로 두고 다시 뽑기", "tier-btn", pickUiIcon("shuffle"));
    const close = pickButton("닫기", "닫기 (Esc)", "tier-btn", "");
    restAgain.hidden = !people.length || rested.length > 0 || people.some(person => person.off) || pickActive(model).length - people.length < 2;
    buttons.append(again, restAgain, close);
    card.appendChild(buttons);
    if (rested.length){ const tip = document.createElement("span"); tip.className = "pick-result-tip"; tip.textContent = "뽑힌 사람은 '쉬는 중'으로 빠졌어요"; card.appendChild(tip); }
    result.appendChild(card);
    again.onclick = () => { hideResult(); start(); };
    restAgain.onclick = () => { people.forEach(person => { person.off = true; }); hideResult(); changed(); start(); };
    close.onclick = hideResult;
    setTimeout(() => again.focus(), 0);
    people.forEach(person => { const row = list.querySelector(`.pick-person[data-id="${CSS.escape(person.id)}"]`); if (row){ row.classList.remove("is-picked"); void row.offsetWidth; row.classList.add("is-picked"); row.scrollIntoView({ block:"nearest" }); } });
    sound("win"); if (people.length) burst();
  }
  result.addEventListener("pointerdown", event => { if (event.target === result) hideResult(); });

  /* ── 게임 붙이기 ── */
  /* 게임에 건네는 것. 게임이 돌려주는 객체: render · canStart · blockReason? · start · clearResult? · menuItems? · goLabel? · dispose */
  const gameApi = { model, root, stage, arena, active:() => pickActive(model), motion, sound, setBusy, showResult, hideResult, say, changed, touch, commitSoon:ms => history.commitSoon(ms || 500), requestStart:() => start(),
    refresh:() => { renderHead(); syncButtons(); }, refreshList:() => renderList(), isBusy:() => busy, hand:pickHandFontStack(),
    // 게임 설정 — 읽을 땐 늘 그 게임이 고른 모양(없으면 기본값)으로, 바꿀 땐 setSettings 로(되돌리기에 남는다).
    // 기본값을 미리 파일에 써 두지 않는다 — 게임만 열어 봐도 '저장 안 됨'이 되지 않게.
    settings:() => { const id = currentGame().id, impl = PICK_GAME_IMPL[id], cur = model.games[id] || {}; return impl && typeof impl.normalize === "function" ? impl.normalize(cur) : cur; },
    setSettings:patch => { const id = currentGame().id; model.games[id] = { ...gameApi.settings(), ...patch }; changed(); } };
  function mountGame(){
    const info = currentGame();
    if (gameId === info.id && game) return;
    if (game && typeof game.dispose === "function") game.dispose();
    arena.innerHTML = ""; hideResult(); gameId = info.id;
    const impl = PICK_GAME_IMPL[info.id]; game = impl ? impl.mount(gameApi) : null;
  }
  function renderHead(){
    const info = currentGame();
    stage.dataset.game = info.id; stage.dataset.layout = info.layout || "center";
    gameTitle.textContent = info.label; gameSub.textContent = info.sub;
    goBtn.querySelector(".pick-go-label").textContent = (game && typeof game.goLabel === "function" && game.goLabel()) || info.go;
    note.textContent = info.note || ""; note.hidden = !info.note;
    gameBtn.title = `게임 고르기 — 지금: ${info.label}`; gameBtn.setAttribute("aria-label", gameBtn.title);
  }
  function render(){
    mountGame(); renderHead(); renderList();
    if (game && typeof game.render === "function") game.render();
    syncButtons();
  }
  function start(){
    if (!game) return;
    if (busy){ if (typeof game.goWhileBusy === "function" && game.goWhileBusy()) game.start(); return; }
    if (typeof game.canStart === "function" && !game.canStart()){
      const reason = typeof game.blockReason === "function" ? game.blockReason() : "";
      say(reason || (pickActive(model).length ? "두 명 이상이어야 뽑을 수 있어요." : "먼저 참가자를 넣어 주세요."), 2600); return;
    }
    hideResult(); closeAdd(); game.start();
  }
  goBtn.onclick = start;

  /* ── 머리말 단추·설정 메뉴 ── */
  const setModel = (key, value) => { if (model[key] === value) return; model[key] = value; changed(); };
  const gameItems = () => pickReadyGames().map(info => ({ label:info.label, active:currentGame().id === info.id, action:() => { if (!busy) setModel("game", info.id); } }));
  gameBtn.onclick = () => { if (busy) return; const rect = gameBtn.getBoundingClientRect(); openMenu(rect.left, rect.bottom + 6, gameItems(), gameBtn); };
  const toggleFullscreen = () => { if (typeof toggleViewerFullscreen === "function") toggleViewerFullscreen(); };
  function settingsItems(){
    const offCount = model.people.filter(person => person.off).length, info = currentGame();
    const own = game && typeof game.menuItems === "function" ? game.menuItems() : [];
    return [
      { label:"게임", icon:"dice", disabled:busy, children:gameItems() },
      ...(own.length ? [{ label:`${info.short} 설정`, icon:"sliders", disabled:busy, children:own }] : []),
      { separator:true },
      { label:"참가자 한꺼번에 넣기…", title:"이름을 한 줄에 하나씩 — 엑셀 열 붙여넣기도 돼요", icon:"list", disabled:busy, action:openBulkDialog },
      { label:"사진으로 참가자 넣기…", title:"사진 여러 장 (끌어다 놓기·Ctrl+V 도 돼요)", icon:"image", disabled:busy || model.people.length >= PICK_MAX_PEOPLE, action:() => fileInput.click() },
      { label:`모두 다시 넣기${offCount ? ` (${offCount}명)` : ""}`, title:"'쉬는 중'인 사람을 모두 뽑기에 다시 넣어요", icon:"refresh", disabled:busy || !offCount, action:() => { model.people.forEach(person => { person.off = false; }); changed(); } },
      { label:"명단 순서 섞기", icon:"shuffle", disabled:busy || model.people.length < 2, action:() => { model.people = pickShuffle(model.people); changed(); } },
      { label:"명단 모두 지우기", icon:"delete", disabled:busy || !model.people.length, action:async () => { if (typeof confirmDialog === "function" && !await confirmDialog(`참가자 ${model.people.length}명을 모두 지울까요? (Ctrl+Z 로 되돌릴 수 있어요)`, "모두 지우기", "취소")) return; model.people = []; changed(); } },
      { separator:true },
      { label:"뽑힌 사람 자동으로 빼기", title:"뽑힐 때마다 그 사람을 '쉬는 중'으로 — 발표 차례 정하기처럼 한 번씩만 뽑을 때", icon:"check", active:model.autoRest, action:() => setModel("autoRest", !model.autoRest) },
      { label:"효과음", icon:"volume", active:model.sound, action:() => setModel("sound", !model.sound) },
      { label:"움직임", icon:"play", children:PICK_MOTION_LABELS.map(([id, label]) => ({ label, active:model.motion === id, action:() => setModel("motion", id) })) },
      { label:"뽑힌 차례 지우기", icon:"close", disabled:!picks.length, action:() => { picks = []; renderLog(); } },
      { separator:true },
      { label:"발표 (전체 화면)", title:"한 번 더 고르면 돌아와요", icon:"view", action:toggleFullscreen },
      { label:"실행 취소", title:"Ctrl+Z", icon:"undo", disabled:busy || !history.canUndo(), action:() => history.undo() },
      { label:"다시 실행", title:"Ctrl+Y", icon:"redo", disabled:busy || !history.canRedo(), action:() => history.redo() },
      { label:"저장하기", title:"Ctrl+S", icon:"save", action:() => savePickDoc(doc) }
    ];
  }
  moreBtn.onclick = () => { const rect = moreBtn.getBoundingClientRect(); openMenu(rect.right - 250, rect.bottom + 6, settingsItems(), moreBtn); };
  stage.addEventListener("contextmenu", event => { if (event.target.closest("input,textarea")) return; event.preventDefault(); openMenu(event.clientX, event.clientY, settingsItems()); });
  undoBtn.onclick = () => { if (!busy) history.undo(); }; redoBtn.onclick = () => { if (!busy) history.redo(); };
  saveBtn.onclick = () => savePickDoc(doc);
  titleInput.oninput = () => { model.title = titleInput.value; history.commitSoon(500); touch(); };
  fileInput.onchange = async () => { const files = Array.from(fileInput.files || []); fileInput.value = ""; await addImageFiles(files); };
  doc.pickFocus = id => { const row = list.querySelector(`.pick-person[data-id="${CSS.escape(id)}"]`); if (!row) return false; row.scrollIntoView({ block:"nearest" }); row.classList.remove("is-picked"); void row.offsetWidth; row.classList.add("is-picked"); return true; };

  // 사진 파일을 끌어다 놓거나 붙여 넣으면 사진 참가자로 들어간다.
  root.addEventListener("dragover", event => { if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files")){ event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; root.classList.add("is-file-over"); } });
  root.addEventListener("dragleave", event => { if (event.target === root || !root.contains(event.relatedTarget)) root.classList.remove("is-file-over"); });
  root.addEventListener("drop", event => {
    root.classList.remove("is-file-over"); const files = event.dataTransfer && event.dataTransfer.files; if (!files || !files.length) return;
    const images = Array.from(files).filter(file => /^image\//i.test(file.type || "")); if (!images.length) return;
    event.preventDefault(); event.stopPropagation(); addImageFiles(images);
  });
  const onPaste = event => {
    if (doc.el.hidden || !doc.el.isConnected || document.querySelector(".tier-modal")) return;
    if (event.target && event.target.closest && event.target.closest("input,textarea,[contenteditable=true]")) return;
    const files = Array.from((event.clipboardData && event.clipboardData.files) || []).filter(file => /^image\//i.test(file.type || ""));
    if (files.length){ event.preventDefault(); addImageFiles(files); return; }
    const text = event.clipboardData ? event.clipboardData.getData("text") : ""; const names = pickSplitNames(text);
    if (names.length && !busy){ event.preventDefault(); addNames(names); }
  };
  document.addEventListener("paste", onPaste);

  const keydown = event => {
    if (doc.el.hidden || !doc.el.isConnected || document.querySelector(".tier-modal")) return;
    if (event.target && event.target.closest && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
    const key = String(event.key || "").toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (mod && key === "z"){ event.preventDefault(); if (!busy) event.shiftKey ? history.redo() : history.undo(); return; }
    if (mod && key === "y"){ event.preventDefault(); if (!busy) history.redo(); return; }
    if (event.key === "Escape" && !result.hidden){ event.preventDefault(); hideResult(); return; }
    // Space = 시작. 단추에 초점이 있으면 그 단추가 먼저(브라우저 기본 동작)지만, 결과 창의 '한 번 더'와 시작 단추는 같은 일이다.
    if (event.key === " " && !mod && !(event.target && event.target.closest && event.target.closest("button,[role=button]"))){ event.preventDefault(); start(); }
  };
  window.addEventListener("keydown", keydown);
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer); if (history) history.cancel(); cancelAnimationFrame(confettiFrame);
    if (game && typeof game.dispose === "function") game.dispose(); game = null;
    window.removeEventListener("keydown", keydown); document.removeEventListener("paste", onPaste);
    if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery; delete doc.pickFocus; delete doc.pickMarkSaved;
  });
  render(); touch();
  if (!model.people.length) openAdd();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_DOC_TYPE, PICK_DOC_VERSION, PICK_MAX_PEOPLE, PICK_COLORS, PICK_GAMES, PICK_GAME_IMPL, pickDocEmpty, pickDocParse, pickDocSerialize, pickNormalizePerson, pickNormalizeGames,
    pickActive, pickAddPeople, pickSplitNames, pickNextColor, pickRandomInt, pickShuffle, pickCryptoRandom, pickSearchText, pickDefaultTitle, pickScratchFileName, pickEaseOut, pickReadyGames, pickPackCircle };
}
