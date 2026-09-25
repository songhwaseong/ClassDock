"use strict";

/* ===== 대진표(.bracket) =====
   참가자(사진·글)를 토너먼트 나무에 놓고, 이긴 쪽 카드를 눌러 한 칸씩 올려 보내는 문서.
   파일은 JSON 하나 — 사진은 작게 줄여 data URL 로 담는다(티어표와 같은 방식, tierPrepareImage 공용).
   나무는 늘 2의 거듭제곱 칸(size, 2~128)이고 빈 칸은 부전승이다. 1회전 자리는 slots, 경기 결과는 results["회전:번호"].
   결과엔 그 경기 두 참가자(a·b)를 함께 적어 둔다 — 앞 경기가 바뀌어 참가자가 달라지면 그 뒤 결과는 저절로 무효(bracketPrune).
   모양(양쪽·한쪽·아래→위 …)은 모두 같은 나무를 '몇 회전 × 몇 번째'로 한 번 계산한 뒤 화면 좌표로 옮기는 방법만 다르다(bracketGeometry). */
const BRACKET_DOC_TYPE = "classdock-bracket";
const BRACKET_DOC_VERSION = 1;
const BRACKET_MAX_SIZE = 128;
const BRACKET_HISTORY_LIMIT = 60;
const BRACKET_RECOVERY_DELAY = 700;
const BRACKET_IMAGE_MAX_CHARS = 400 * 1024;
const BRACKET_BACKDROP_MAX_SIDE = 1920;
const BRACKET_BACKDROP_MAX_CHARS = 3 * 1024 * 1024;
const BRACKET_LAYOUTS = [
  { id:"split", label:"양쪽에서 가운데로", axis:"x" },
  { id:"left", label:"왼쪽에서 오른쪽으로", axis:"x" },
  { id:"right", label:"오른쪽에서 왼쪽으로", axis:"x" },
  { id:"up", label:"아래에서 위로", axis:"y" },
  { id:"down", label:"위에서 아래로", axis:"y" },
  { id:"split-v", label:"위아래에서 가운데로", axis:"y" }
];
/* 배경 템플릿 — 화면은 styles.css 의 [data-br-theme] 변수, PNG 는 아래 png 색(그라디언트 두 색으로 근사). */
const BRACKET_THEMES = [
  { id:"classic", label:"기본", png:{ bg:["#f6f5ff", "#eceafd"], line:"#c3c6da", win:"#6d5dfc", card:"#ffffff", edge:"#dcdfea", ink:"#1f2340", muted:"#5d6283", title:"#1f2340" } },
  { id:"stadium", label:"경기장", png:{ bg:["#34994a", "#2a7f3b"], line:"#e8f5ea", win:"#ffe45c", card:"#ffffff", edge:"#ffffff", ink:"#16341c", muted:"#f1fff2", title:"#ffffff" } },
  { id:"chalk", label:"칠판", png:{ bg:["#2e4f43", "#23413a"], line:"#cfdccb", win:"#ffe9a0", card:"#325748", edge:"#e9f1e6", ink:"#f6f8f2", muted:"#d9e4d3", title:"#fbfbf4" } },
  { id:"neon", label:"게임쇼", png:{ bg:["#2b1060", "#0a0a23"], line:"#5b5fa8", win:"#ff4fd8", card:"#14153a", edge:"#7c83ff", ink:"#ffffff", muted:"#b9bdf5", title:"#ffffff" } },
  { id:"gold", label:"트로피", png:{ bg:["#3f2e0d", "#120d05"], line:"#7a6534", win:"#f5c542", card:"#211909", edge:"#b8912f", ink:"#fdf3d6", muted:"#d9c38d", title:"#f8dc86" } },
  { id:"sky", label:"하늘", png:{ bg:["#a9d8ff", "#fff4dc"], line:"#8fb1d3", win:"#ff7a59", card:"#ffffff", edge:"#c9dcef", ink:"#1f3550", muted:"#48688a", title:"#1f3550" } },
  { id:"sakura", label:"봄꽃", png:{ bg:["#ffe3ec", "#f1e6ff"], line:"#e7aec1", win:"#ff4f86", card:"#ffffff", edge:"#f6cbd8", ink:"#5a2238", muted:"#9a5a72", title:"#7a2446" } },
  { id:"space", label:"우주", png:{ bg:["#070b1f", "#1b1450"], line:"#454b8a", win:"#7df9ff", card:"#11163d", edge:"#3f4798", ink:"#eef1ff", muted:"#aab2ec", title:"#ffffff" } },
  { id:"ocean", label:"바다", png:{ bg:["#0e7490", "#0b3b52"], line:"#7dd3fc", win:"#fde047", card:"#ffffff", edge:"#bae6fd", ink:"#0c2f3d", muted:"#d6f1ff", title:"#ffffff" } },
  { id:"wood", label:"나무 책상", png:{ bg:["#bd8a55", "#a8773f"], line:"#5b3a1e", win:"#fff1b8", card:"#fff8ec", edge:"#8a5a30", ink:"#3b2614", muted:"#fff6e6", title:"#fffaf0" } },
  { id:"custom", label:"내 사진", png:{ bg:["#1f2937", "#111827"], line:"#e5e7eb", win:"#ffd166", card:"#ffffff", edge:"#e5e7eb", ink:"#1f2328", muted:"#f3f4f6", title:"#ffffff" } }
];
/* 카드 크기 — 가로로 흐르는 모양(x)은 '작은 사진 + 이름' 막대, 세로로 흐르는 모양(y)은 '사진 위 + 이름 아래' 타일. */
const BRACKET_CARD_DIMS = {
  x:{ s:{ w:132, h:36 }, m:{ w:172, h:46 }, l:{ w:224, h:60 } },
  y:{ s:{ w:70, h:88 }, m:{ w:92, h:116 }, l:{ w:124, h:154 } }
};
const BRACKET_FONT = { s:12, m:14, l:17 };
const BRACKET_MOTION = { slow:{ move:1100, pause:900 }, normal:{ move:700, pause:450 }, fast:{ move:380, pause:160 }, off:{ move:0, pause:600 } };
const BRACKET_MOTION_LABELS = [["slow", "느리게"], ["normal", "보통"], ["fast", "빠르게"], ["off", "움직임 끄기"]];
const BRACKET_UI_PATHS = {
  layout:'<path d="M3 4.5h5v4H3zM3 15.5h5v4H3zM16 10h5v4h-5zM8 6.5h3v11H8M11 12h5"/>',
  palette:'<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-1.9-.5-1.1.2-2.1 1.4-2.1H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none"/>',
  screen:'<path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.7.6 2.7 2.2 3 4.7"/>',
  score:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M6.5 10.5l1.5-1v5M15.5 10h2.5v2h-2.5v2.5H18"/>',
  next:'<path d="M6 5.5l8.5 6.5L6 18.5zM18 5.5v13"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  edit:'<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  fit:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9h6v6H9z"/>'
};
let _bracketScratchCount = 0;

function bracketId(){ return "e-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function bracketText(value, max){ return String(value == null ? "" : value).slice(0, max); }
function bracketScore(value){ return String(value == null ? "" : value).trim().slice(0, 8); }
function bracketIsSize(n){ return Number.isInteger(n) && n >= 2 && n <= BRACKET_MAX_SIZE && (n & (n - 1)) === 0; }
function bracketLog2(size){ return Math.round(Math.log2(size)); }
function bracketSizeFor(count){ let n = 2; while (n < count && n < BRACKET_MAX_SIZE) n *= 2; return n; }
function bracketRoundLabel(n){ return n <= 1 ? "우승" : n === 2 ? "결승" : n + "강"; }
function bracketTheme(id){ return BRACKET_THEMES.find(theme => theme.id === id) || BRACKET_THEMES[0]; }
function bracketLayout(id){ return BRACKET_LAYOUTS.find(layout => layout.id === id) || BRACKET_LAYOUTS[0]; }
/* 경기 번호 → matches 배열 자리. 회전 r 앞에는 size/2 + size/4 + … (r 개) = size - size/2^r 경기가 있다. */
function bracketMatchIndex(size, r, i){ return size - (size >> r) + i; }
/* 씨드 차례 — 8칸이면 [1,8,4,5,2,7,3,6]. 1번과 2번은 결승에서야 만나고, 빈 칸(부전승)은 높은 씨드 쪽에 고루 흩어진다. */
function bracketSeedOrder(size){ let order = [1]; while (order.length < size){ const n = order.length * 2; order = order.flatMap(seed => [seed, n + 1 - seed]); } return order; }
function bracketSeat(ids, size){ return bracketSeedOrder(size).map(seed => ids[seed - 1] || ""); }
/* 지금 자리를 씨드 차례로 읽은 참가자 id — 대진 크기를 바꿀 때 이 차례를 새 크기에 다시 앉힌다. */
function bracketSeededIds(model){ const order = bracketSeedOrder(model.size), ids = []; for (let seed = 1; seed <= model.size; seed++){ const id = model.slots[order.indexOf(seed)]; if (id) ids.push(id); } return ids; }
/* 빈 칸 가운데 씨드 번호가 가장 앞선 칸에 앉힌다 — 부전승이 한쪽에 몰리지 않게. 자리가 없으면 -1. */
function bracketFillSlot(model, id){ const order = bracketSeedOrder(model.size); for (let seed = 1; seed <= model.size; seed++){ const at = order.indexOf(seed); if (!model.slots[at]){ model.slots[at] = id; return at; } } return -1; }

function bracketNormalizeImage(raw, maxChars){
  const value = raw && typeof raw === "object" ? raw : null, dataUrl = value ? String(value.dataUrl || "") : "";
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(dataUrl) || dataUrl.length > (maxChars || BRACKET_IMAGE_MAX_CHARS)) return null;
  return { dataUrl, width:Math.max(1, Math.min(10000, Number(value.width) || 1)), height:Math.max(1, Math.min(10000, Number(value.height) || 1)) };
}
function bracketNormalizeEntry(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  return { id:bracketText(value.id, 80) || bracketId(), text:bracketText(value.text, 60), name:bracketText(value.name, 120), image:bracketNormalizeImage(value.image) };
}
function bracketNormalizeBackdrop(raw){
  const value = raw && typeof raw === "object" ? raw : {}, veil = Number(value.veil);
  return { image:bracketNormalizeImage(value.image, BRACKET_BACKDROP_MAX_CHARS), fit:["cover", "contain", "tile"].includes(value.fit) ? value.fit : "cover",
    veil:value.veil == null || value.veil === "" || !Number.isFinite(veil) ? 0.25 : Math.max(0, Math.min(0.9, veil)) };
}
function bracketDocEmpty(title, size){
  const n = bracketIsSize(size) ? size : 8;
  return { type:BRACKET_DOC_TYPE, version:BRACKET_DOC_VERSION, title:bracketText(title || "대진표", 160), layout:"split", lineStyle:"elbow", cardSize:"m",
    theme:"classic", backdrop:bracketNormalizeBackdrop(null), showScores:true, scoreRule:"high", motion:"normal",
    size:n, entries:[], slots:new Array(n).fill(""), results:{} };
}
function bracketDocParse(text){
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  if (!raw || raw.type !== BRACKET_DOC_TYPE || !Array.isArray(raw.entries)) throw new Error("bracket-format");
  if (raw.entries.length > BRACKET_MAX_SIZE) throw new Error("bracket-limit");
  const ids = new Set();
  // 사진도 글도 없는 참가자는 보이지 않으니 버린다.
  const entries = raw.entries.map(bracketNormalizeEntry).filter(entry => (entry.image || entry.text.trim() || entry.name.trim()) && !ids.has(entry.id) && ids.add(entry.id));
  let size = Number(raw.size); if (!bracketIsSize(size)) size = bracketSizeFor(Math.max(2, entries.length));
  if (size < entries.length) size = bracketSizeFor(entries.length);
  const model = bracketDocEmpty(raw.title, size);
  if (typeof raw.title === "string") model.title = bracketText(raw.title, 160);
  model.layout = bracketLayout(raw.layout).id;
  model.lineStyle = raw.lineStyle === "curve" ? "curve" : "elbow";
  model.cardSize = Object.prototype.hasOwnProperty.call(BRACKET_FONT, raw.cardSize) ? raw.cardSize : "m";
  model.backdrop = bracketNormalizeBackdrop(raw.backdrop);
  model.theme = bracketTheme(raw.theme).id; if (model.theme === "custom" && !model.backdrop.image) model.theme = "classic";
  model.showScores = raw.showScores !== false; model.scoreRule = raw.scoreRule === "low" ? "low" : "high";
  model.motion = Object.prototype.hasOwnProperty.call(BRACKET_MOTION, raw.motion) ? raw.motion : "normal";
  model.entries = entries;
  // 자리: 아는 참가자만, 한 번씩만. 자리가 없는 참가자는 빈 칸에 씨드 차례로 앉힌다.
  const seated = new Set(), slots = Array.isArray(raw.slots) ? raw.slots : [];
  model.slots = model.slots.map((_, index) => { const id = String(slots[index] || ""); if (ids.has(id) && !seated.has(id)){ seated.add(id); return id; } return ""; });
  entries.filter(entry => !seated.has(entry.id)).forEach(entry => bracketFillSlot(model, entry.id));
  const results = raw.results && typeof raw.results === "object" ? raw.results : {}, R = bracketLog2(size);
  Object.keys(results).forEach(key => {
    const match = /^(\d{1,3}):(\d{1,3})$/.exec(key); if (!match) return;
    const r = Number(match[1]), i = Number(match[2]); if (r >= R || i >= (size >> (r + 1))) return;
    const value = results[key] && typeof results[key] === "object" ? results[key] : {};
    model.results[r + ":" + i] = { a:bracketText(value.a, 80), b:bracketText(value.b, 80), winner:bracketText(value.winner, 80), sa:bracketScore(value.sa), sb:bracketScore(value.sb) };
  });
  bracketPrune(model);
  return model;
}
function bracketDocSerialize(model){ return JSON.stringify(bracketDocParse({ ...model, type:BRACKET_DOC_TYPE, version:BRACKET_DOC_VERSION }), null, 2); }

/* 나무 풀기 — nodes[r][k] 는 그 칸에 올라온 참가자: id(정해짐) · ""(앞 경기를 기다림) · null(아무도 없음).
   한쪽이 null 이면 다른 쪽이 저절로 올라간다(부전승, auto). results 를 따로 주면 그것만 반영한다(다시 보기). */
function bracketResolve(model, results){
  const saved = results || model.results || {}, known = new Set(model.entries.map(entry => entry.id)), R = bracketLog2(model.size);
  let prev = model.slots.map(id => (id && known.has(id) ? id : null));
  const nodes = [prev], matches = [];
  for (let r = 0; r < R; r++){
    const next = [];
    for (let i = 0; i < prev.length / 2; i++){
      const a = prev[2 * i], b = prev[2 * i + 1], result = saved[r + ":" + i];
      const valid = !!(a && b && result && result.a === a && result.b === b && (result.winner === "" || result.winner === a || result.winner === b));
      let winner = "", auto = false;
      if (a === null && b === null) winner = null;
      else if (a === null && b){ winner = b; auto = true; }
      else if (b === null && a){ winner = a; auto = true; }
      else if (valid && result.winner) winner = result.winner;
      matches.push({ r, i, a, b, winner, auto, result:valid ? result : null });
      next.push(winner);
    }
    nodes.push(next); prev = next;
  }
  return { nodes, matches, champion:nodes[R][0] || "" };
}
function bracketMatchOf(model, r, i){ const R = bracketLog2(model.size); if (r < 0 || r >= R || i < 0 || i >= (model.size >> (r + 1))) return null; return bracketResolve(model).matches[bracketMatchIndex(model.size, r, i)]; }
/* 참가자가 바뀌어 맞지 않게 된 결과를 지운다. 지운 결과 가운데 승자가 있던 것의 수를 돌려준다. */
function bracketPrune(model){
  const keep = {}; let dropped = 0;
  bracketResolve(model).matches.forEach(match => { if (match.result) keep[match.r + ":" + match.i] = match.result; });
  Object.keys(model.results || {}).forEach(key => { if (!keep[key] && model.results[key] && model.results[key].winner) dropped++; });
  model.results = keep; return dropped;
}
/* 점수로 승자 — 둘 다 숫자이고 다를 때만. rule "low" 면 낮은 쪽(기록 경기). */
function bracketWinnerByScore(sa, sb, rule){
  const a = Number(String(sa).replace(",", ".")), b = Number(String(sb).replace(",", "."));
  if (String(sa).trim() === "" || String(sb).trim() === "" || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return "";
  return (rule === "low" ? a < b : a > b) ? "a" : "b";
}
/* 경기 결과 넣기 — patch 는 { winner, sa, sb } 가운데 바꿀 것만. 두 참가자가 다 정해진 경기만 된다.
   돌려주는 cleared 는 참가자가 바뀌어 지워진 뒤 경기 결과 수. */
function bracketSetResult(model, r, i, patch){
  const match = bracketMatchOf(model, r, i); if (!match || !match.a || !match.b) return null;
  const key = r + ":" + i, old = match.result, next = { a:match.a, b:match.b, winner:old ? old.winner : "", sa:old ? old.sa : "", sb:old ? old.sb : "" };
  if (patch && "winner" in patch) next.winner = patch.winner === match.a || patch.winner === match.b ? patch.winner : "";
  if (patch && "sa" in patch) next.sa = bracketScore(patch.sa);
  if (patch && "sb" in patch) next.sb = bracketScore(patch.sb);
  const changed = next.winner !== (old ? old.winner : "");
  if (!next.winner && !next.sa && !next.sb) delete model.results[key]; else model.results[key] = next;
  return { changed, cleared:bracketPrune(model) };
}
function bracketClearResults(model){ const n = Object.values(model.results || {}).filter(result => result.winner).length; model.results = {}; return n; }
/* 참가자 넣기 — 빈 칸에 씨드 차례로 앉히고, 칸이 모자라면 대진을 두 배로 키워(최대 128) 씨드 차례 그대로 다시 앉힌다. */
function bracketAddEntries(model, list){
  const room = Math.max(0, BRACKET_MAX_SIZE - model.entries.length), add = (list || []).slice(0, room); let grew = false;
  add.forEach(entry => {
    model.entries.push(entry);
    if (bracketFillSlot(model, entry.id) >= 0) return;
    const ids = bracketSeededIds(model); ids.push(entry.id);
    model.size = Math.min(BRACKET_MAX_SIZE, model.size * 2); model.slots = bracketSeat(ids, model.size); grew = true;
  });
  return { added:add.length, skipped:(list || []).length - add.length, grew, cleared:bracketPrune(model) };
}
function bracketRemoveEntry(model, id){
  const before = model.entries.length; model.entries = model.entries.filter(entry => entry.id !== id); if (model.entries.length === before) return null;
  model.slots = model.slots.map(slot => (slot === id ? "" : slot)); return { cleared:bracketPrune(model) };
}
function bracketResize(model, size){
  if (!bracketIsSize(size) || size < model.entries.length) return null;
  const ids = bracketSeededIds(model); model.size = size; model.slots = bracketSeat(ids, size); return { cleared:bracketPrune(model) };
}
function bracketSwapSlots(model, p, q){
  if (p === q || p < 0 || q < 0 || p >= model.slots.length || q >= model.slots.length) return null;
  [model.slots[p], model.slots[q]] = [model.slots[q], model.slots[p]]; return { cleared:bracketPrune(model) };
}
/* 대진 새로 뽑기 — 참가자를 섞어 씨드 차례로 다시 앉힌다(부전승 자리는 그대로 고루). */
function bracketShuffle(model, random=Math.random){
  const ids = model.entries.map(entry => entry.id);
  for (let i = ids.length - 1; i > 0; i--){ const j = Math.floor(random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  model.slots = bracketSeat(ids, model.size); return { cleared:bracketPrune(model) };
}
/* 다시 보기 차례 — 사람이 정한 경기만(부전승 빼고) 회전 차례대로. */
function bracketDecidedOrder(model){ return bracketResolve(model).matches.filter(match => match.result && match.result.winner && !match.auto).map(match => match.r + ":" + match.i); }
function bracketSearchText(model){ return [model.title, ...(model.entries || []).flatMap(entry => [entry.text, entry.name])].filter(Boolean).join("\n"); }
function bracketDefaultTitle(name){ return String(name || "").replace(/\.bracket$/i, "") || "대진표"; }
function bracketScratchFileName(number){ return number > 1 ? "대진표 " + number + ".bracket" : "대진표.bracket"; }
function bracketSafeName(value){ return String(value || "대진표").replace(/[\\/:*?"<>|]+/g, "_").trim() || "대진표"; }
function bracketEntryLabel(entry){ return entry ? (entry.text || entry.name || "") : ""; }

/* ── 배치 ── 칸(node)마다 가운데 좌표·크기, 선(edge) 경로, 회전 이름표 자리.
   lane = 진행 방향으로 몇 번째 줄인지, cross = 그와 직각 방향 자리(1회전 칸 단위). 모양은 lane 을 어떻게 세느냐만 다르다. */
function bracketGeometry(size, layout, cardSize, opts = {}){
  const R = bracketLog2(size), info = bracketLayout(layout), axis = info.axis, split = info.id === "split" || info.id === "split-v";
  const base = BRACKET_CARD_DIMS[axis][cardSize] || BRACKET_CARD_DIMS[axis].m;
  const champ = axis === "x" ? { w:Math.round(base.w * 1.15), h:Math.round(base.h * 2.6) } : { w:Math.round(base.w * 1.5), h:Math.round(base.h * 1.5) };
  const along = dims => (axis === "x" ? dims.w : dims.h), across = dims => (axis === "x" ? dims.h : dims.w);
  const gapMain = axis === "x" ? 46 : 50, gapCross = axis === "x" ? 10 : 12, lanes = split ? 2 * R + 1 : R + 1;
  const laneOf = (r, left) => (split ? (r === R ? R : left ? r : 2 * R - r) : (info.id === "right" || info.id === "up") ? R - r : r);
  const depthOf = lane => (split ? (lane <= R ? lane : 2 * R - lane) : (info.id === "right" || info.id === "up") ? R - lane : lane);
  const champLane = laneOf(R, true), centers = []; let pos = 0;
  for (let lane = 0; lane < lanes; lane++){
    const s = lane === champLane ? along(champ) : along(base);
    if (lane) pos += gapMain + (lane === champLane || lane - 1 === champLane ? 16 : 0);   // 우승 칸 둘레는 조금 더 띄운다
    centers.push(pos + s / 2); pos += s;
  }
  const mainTotal = pos, pitch = across(base) + gapCross, leaves = split ? size / 2 : size;
  const leafSpan = leaves * pitch - gapCross, crossTotal = Math.max(leafSpan, across(champ)), crossShift = (crossTotal - leafSpan) / 2;
  const bare = !!opts.bare, margin = bare ? 8 : 36, titleBand = !bare && opts.title ? 64 : 0, labelBand = bare ? 0 : axis === "x" ? 30 : 78;
  // 우승 칸 위로 왕관(34px)이 솟는다 — 우승 칸이 판 윗변에 붙는 모양(아래→위, 참가자가 적은 가로 모양)은 그만큼 더 띄운다.
  const champTop = axis === "x" ? crossTotal / 2 - champ.h / 2 : champLane === 0 ? 0 : Infinity, crownRoom = bare ? 0 : Math.max(0, 40 - champTop);
  let offsetX = axis === "x" ? margin : margin + labelBand, offsetY = (axis === "x" ? margin + titleBand + labelBand : margin + titleBand) + crownRoom;
  let width = axis === "x" ? offsetX + mainTotal + margin : offsetX + crossTotal + margin;
  const height = axis === "x" ? offsetY + crossTotal + margin : offsetY + mainTotal + margin;
  if (titleBand && width < 460){ offsetX += (460 - width) / 2; width = 460; }   // 제목이 잘리지 않게 가운데로
  const nodes = [], byKey = new Map();
  for (let r = 0; r <= R; r++){
    const count = size >> r, span = 1 << r;
    for (let k = 0; k < count; k++){
      let left = true, t = (k + 0.5) * span;
      if (split){ if (r === R) t = size / 4; else if (k * span >= size / 2){ left = false; t -= size / 2; } }
      const dims = r === R ? champ : base, main = centers[laneOf(r, left)], cross = crossShift + t * pitch - gapCross / 2;
      const node = { key:r + "-" + k, r, k, left, w:dims.w, h:dims.h, x:axis === "x" ? offsetX + main : offsetX + cross, y:axis === "x" ? offsetY + cross : offsetY + main, out:"" };
      nodes.push(node); byKey.set(node.key, node);
    }
  }
  const edges = [];
  nodes.forEach(node => {
    if (node.r >= R) return;
    const parent = byKey.get((node.r + 1) + "-" + (node.k >> 1));
    node.out = axis === "x" ? (parent.x >= node.x ? "r" : "l") : (parent.y >= node.y ? "b" : "t");
    edges.push({ key:node.key, r:node.r, k:node.k, d:bracketEdgePath(node, parent, axis, opts.lineStyle) });
  });
  const labels = bare ? [] : centers.map((center, lane) => {
    const r = depthOf(lane);
    return { lane, r, text:bracketRoundLabel(size >> r), x:axis === "x" ? offsetX + center : margin + labelBand / 2 - 6, y:axis === "x" ? offsetY - crownRoom - 17 : offsetY + center };
  }).filter(label => label.r < R);   // 우승 칸은 왕관·글자로 이미 보이니 이름표를 달지 않는다
  return { size, R, axis, layout:info.id, split, width:Math.ceil(width), height:Math.ceil(height), nodes, byKey, edges, labels, titleY:margin + 26, font:BRACKET_FONT[cardSize] || BRACKET_FONT.m };
}
/* 아래 칸의 '나가는 변' 가운데 → 위 칸의 '들어오는 변' 가운데. 꺾은선은 두 칸 사이 한가운데서 꺾는다. */
function bracketEdgePath(child, parent, axis, style){
  const n = value => Math.round(value * 10) / 10;
  if (axis === "x"){
    const dir = parent.x >= child.x ? 1 : -1, x1 = n(child.x + dir * child.w / 2), x2 = n(parent.x - dir * parent.w / 2), y1 = n(child.y), y2 = n(parent.y), mid = n((x1 + x2) / 2);
    return style === "curve" ? `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}` : `M${x1} ${y1}H${mid}V${y2}H${x2}`;
  }
  const dir = parent.y >= child.y ? 1 : -1, y1 = n(child.y + dir * child.h / 2), y2 = n(parent.y - dir * parent.h / 2), x1 = n(child.x), x2 = n(parent.x), mid = n((y1 + y2) / 2);
  return style === "curve" ? `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}` : `M${x1} ${y1}V${mid}H${x2}V${y2}`;
}
/* 모양·테마 고르기 창의 작은 그림 — 8강 나무를 선과 네모로만. */
function bracketMiniSvg(layout, lineStyle){
  const geo = bracketGeometry(8, layout, "s", { bare:true, lineStyle });
  const lines = geo.edges.map(edge => `<path d="${edge.d}"/>`).join("");
  const boxes = geo.nodes.map(node => `<rect x="${node.x - node.w / 2}" y="${node.y - node.h / 2}" width="${node.w}" height="${node.h}" rx="${geo.axis === "x" ? 8 : 10}"${node.r === geo.R ? ' class="is-champ"' : ""}/>`).join("");
  return `<svg class="bracket-mini" viewBox="0 0 ${geo.width} ${geo.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g class="bracket-mini-lines">${lines}</g><g class="bracket-mini-cards">${boxes}</g></svg>`;
}
function bracketSvg(name, extraClass){
  return '<svg class="ui-icon' + (extraClass ? " " + extraClass : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (BRACKET_UI_PATHS[name] || "") + "</svg>";
}

/* 바탕 사진 — 화면을 덮는 크기라 카드 사진보다 크게(긴 변 1920px) JPEG 로. */
async function bracketPrepareBackdrop(file){
  if (!file || !/^image\/(?:png|jpeg|webp|gif|bmp|avif)$/i.test(String(file.type || ""))) throw new Error("photo-type");
  if (file.size > 40 * 1024 * 1024) throw new Error("photo-too-large");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("photo-read")); img.src = url; });
    const nw = image.naturalWidth || image.width, nh = image.naturalHeight || image.height, scale = Math.min(1, BRACKET_BACKDROP_MAX_SIDE / Math.max(nw, nh));
    const width = Math.max(1, Math.round(nw * scale)), height = Math.max(1, Math.round(nh * scale));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0, width, height);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.85); if (dataUrl.length > BRACKET_BACKDROP_MAX_CHARS) dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    if (dataUrl.length > BRACKET_BACKDROP_MAX_CHARS) throw new Error("photo-output-too-large");
    return { dataUrl, width, height };
  } finally { URL.revokeObjectURL(url); }
}

async function loadBracketDoc(file, opts = {}){
  let model; try { model = bracketDocParse(await file.text()); }
  catch(_){ if (typeof toast === "function") toast("대진표(.bracket)를 읽지 못해 텍스트로 열었어요.", 3600); return typeof loadText === "function" ? loadText(file, opts) : null; }
  if (!model.title) model.title = bracketDefaultTitle(file.name);
  const doc = makeDoc("bracket", file.name, opts); doc.bracketDoc = model; doc.sourceFile = file; doc.savedText = bracketDocSerialize(model);
  doc.contentSearchFocus = query => { const needle = String(query || "").trim().toLowerCase(), found = model.entries.find(entry => [entry.text, entry.name].join(" ").toLowerCase().includes(needle)); if (!found || typeof doc.bracketFocus !== "function") return false; return doc.bracketFocus(found.id); };
  doc.render = async () => { if (doc._bracketMounted) return; doc._bracketMounted = true; doc.el.innerHTML = ""; mountBracketEditor(doc); };
  if (typeof refreshChrome === "function") refreshChrome(); if (typeof activateIfIdle === "function") activateIfIdle(doc, opts); return doc;
}
function newBracketScratch(){
  _bracketScratchCount++; const name = bracketScratchFileName(_bracketScratchCount); if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([bracketDocSerialize(bracketDocEmpty(bracketDefaultTitle(name)))], name, { type:"application/json" })], { isScratch:true }));
}
function newBracketScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, bracketScratchFileName, name => bracketDocSerialize(bracketDocEmpty(bracketDefaultTitle(name))), "application/json", "대진표");
}
async function saveBracketDoc(doc){
  if (!doc || !doc.bracketDoc) return false; const json = bracketDocSerialize(doc.bracketDoc), ok = typeof saveTextDoc === "function" ? await saveTextDoc(json, doc, doc.name) : false; if (!ok) return false;
  doc.savedText = json; if (typeof doc.bracketMarkSaved === "function") doc.bracketMarkSaved();
  if (typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json"); else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false); return true;
}

/* ── 그림(PNG) ── 화면을 찍지 않고 같은 배치로 캔버스에 직접 그린다(스크롤·확대와 상관없이 전체가 나오게). */
function bracketLoadImage(src){ return new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; }); }
function bracketRoundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  if (typeof ctx.roundRect === "function"){ ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function bracketFitText(ctx, text, maxWidth){
  let value = String(text || ""); if (ctx.measureText(value).width <= maxWidth) return value;
  while (value && ctx.measureText(value + "…").width > maxWidth) value = value.slice(0, -1);
  return value ? value + "…" : "";
}
function bracketWrapText(ctx, text, maxWidth, maxLines){
  const lines = []; let line = "";
  for (const ch of String(text || "").replace(/\s+/g, " ").trim()){
    if (ctx.measureText(line + ch).width > maxWidth && line){ lines.push(line); line = ch.trim() ? ch : ""; if (lines.length >= maxLines) return lines; } else line += ch;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}
function bracketDrawCover(ctx, img, x, y, w, h){
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}
async function bracketRenderPng(model, opts = {}){
  const geo = bracketGeometry(model.size, model.layout, model.cardSize, { title:!!model.title, lineStyle:model.lineStyle });
  const res = bracketResolve(model), theme = bracketTheme(model.theme).png, entries = new Map(model.entries.map(entry => [entry.id, entry]));
  const ratio = Math.max(0.4, Math.min(opts.ratio || 2, 12000 / Math.max(geo.width, geo.height)));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(geo.width * ratio); canvas.height = Math.round(geo.height * ratio);
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const font = '"Pretendard","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  const bg = ctx.createLinearGradient(0, 0, 0, geo.height); bg.addColorStop(0, theme.bg[0]); bg.addColorStop(1, theme.bg[1]); ctx.fillStyle = bg; ctx.fillRect(0, 0, geo.width, geo.height);
  if (model.theme === "custom" && model.backdrop.image){
    const img = await bracketLoadImage(model.backdrop.image.dataUrl);
    if (img){
      if (model.backdrop.fit === "tile"){ const pattern = ctx.createPattern(img, "repeat"); if (pattern){ ctx.fillStyle = pattern; ctx.fillRect(0, 0, geo.width, geo.height); } }
      else if (model.backdrop.fit === "contain"){ const s = Math.min(geo.width / img.width, geo.height / img.height), w = img.width * s, h = img.height * s; ctx.drawImage(img, (geo.width - w) / 2, (geo.height - h) / 2, w, h); }
      else bracketDrawCover(ctx, img, 0, 0, geo.width, geo.height);
    }
    ctx.fillStyle = `rgba(15,23,42,${model.backdrop.veil})`; ctx.fillRect(0, 0, geo.width, geo.height);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (model.title){ ctx.fillStyle = theme.title; ctx.font = "900 30px " + font; ctx.fillText(model.title, geo.width / 2, geo.titleY, geo.width - 48); }
  ctx.font = "800 12.5px " + font;
  geo.labels.forEach(label => {
    const w = ctx.measureText(label.text).width + 20;
    ctx.save(); ctx.globalAlpha = 0.72; ctx.fillStyle = theme.card; bracketRoundRect(ctx, label.x - w / 2, label.y - 11, w, 22, 11); ctx.fill(); ctx.restore();
    ctx.fillStyle = theme.ink; ctx.fillText(label.text, label.x, label.y);
  });
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (typeof Path2D === "function"){
    geo.edges.forEach(edge => { const id = res.nodes[edge.r][edge.k]; ctx.save(); ctx.strokeStyle = theme.line; ctx.lineWidth = 2.2; if (id === null){ ctx.globalAlpha = 0.45; ctx.setLineDash([3, 5]); } ctx.stroke(new Path2D(edge.d)); ctx.restore(); });
    geo.edges.forEach(edge => {
      const id = res.nodes[edge.r][edge.k], up = res.nodes[edge.r + 1][edge.k >> 1]; if (!id || id !== up) return;
      const match = res.matches[bracketMatchIndex(model.size, edge.r, edge.k >> 1)];
      ctx.save(); ctx.strokeStyle = theme.win; ctx.lineWidth = match.auto ? 2.4 : 3.6; if (match.auto){ ctx.globalAlpha = 0.7; ctx.setLineDash([6, 5]); } ctx.stroke(new Path2D(edge.d)); ctx.restore();
    });
  }
  const images = new Map(); await Promise.all(model.entries.filter(entry => entry.image).map(async entry => images.set(entry.id, await bracketLoadImage(entry.image.dataUrl))));
  const fs = geo.font;
  geo.nodes.forEach(node => {
    const id = res.nodes[node.r][node.k], entry = id ? entries.get(id) : null, champ = node.r === geo.R, x = node.x - node.w / 2, y = node.y - node.h / 2;
    const match = node.r < geo.R ? res.matches[bracketMatchIndex(model.size, node.r, node.k >> 1)] : null;
    ctx.save();
    if (!entry){
      ctx.globalAlpha = id === null && node.r > 0 ? 0.3 : 0.75; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = theme.line; bracketRoundRect(ctx, x, y, node.w, node.h, 10); ctx.stroke();
      ctx.fillStyle = theme.muted; ctx.font = "750 " + fs + "px " + font;
      const hint = champ ? "우승" : node.r === 0 && id === null ? (res.nodes[0][node.k ^ 1] ? "부전승" : "") : "";
      if (hint) ctx.fillText(hint, node.x, node.y);
      ctx.restore(); return;
    }
    const lost = !!(match && match.winner && match.winner !== id), won = !!(match && match.winner === id && !match.auto);
    if (lost){ ctx.globalAlpha = 0.45; if ("filter" in ctx) ctx.filter = "grayscale(0.85)"; }
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.fillStyle = theme.card; bracketRoundRect(ctx, x, y, node.w, node.h, 10); ctx.fill(); ctx.restore();
    const img = images.get(entry.id), label = bracketEntryLabel(entry), tile = champ || geo.axis === "y";
    ctx.save(); bracketRoundRect(ctx, x, y, node.w, node.h, 10); ctx.clip();
    ctx.fillStyle = theme.ink;
    if (tile){
      const capH = label ? Math.round(champ ? Math.max(30, node.h * 0.2) : Math.max(22, fs * 1.8)) : 0;
      if (img){ bracketDrawCover(ctx, img, x, y, node.w, node.h - capH); if (label){ ctx.font = (champ ? "850 " + Math.round(fs * 1.3) : "750 " + fs) + "px " + font; ctx.fillText(bracketFitText(ctx, label, node.w - 10), node.x, y + node.h - capH / 2); } }
      else { const size = champ ? Math.round(fs * 1.6) : fs; ctx.font = "800 " + size + "px " + font; const lines = bracketWrapText(ctx, label, node.w - 12, 3); lines.forEach((line, index) => ctx.fillText(line, node.x, node.y + (index - (lines.length - 1) / 2) * size * 1.25)); }
    } else {
      const mirror = node.out === "l", thumb = img ? node.h : 0;
      if (img) bracketDrawCover(ctx, img, mirror ? x + node.w - thumb : x, y, thumb, node.h);
      ctx.font = "750 " + fs + "px " + font; ctx.textAlign = mirror ? "right" : "left";
      const scoreRoom = model.showScores && match && match.result && (node.k & 1 ? match.result.sb : match.result.sa) ? 34 : 0;
      ctx.fillText(bracketFitText(ctx, label, node.w - thumb - 20 - scoreRoom), mirror ? x + node.w - thumb - 10 : x + thumb + 10, node.y);
      ctx.textAlign = "center";
    }
    ctx.restore();
    ctx.lineWidth = champ ? 3 : won ? 2.4 : 1.5; ctx.strokeStyle = champ || won ? theme.win : theme.edge; bracketRoundRect(ctx, x, y, node.w, node.h, 10); ctx.stroke();
    if (model.showScores && match && match.result){
      const score = node.k & 1 ? match.result.sb : match.result.sa;
      if (score !== ""){
        ctx.font = "850 12px " + font; const w = Math.max(24, ctx.measureText(score).width + 12);
        const bx = geo.axis === "x" ? (node.out === "l" ? x + 6 : x + node.w - w - 6) : x + node.w - w - 4, by = geo.axis === "x" ? node.y - 11 : y + 4;
        ctx.fillStyle = won ? theme.win : theme.ink; bracketRoundRect(ctx, bx, by, w, 22, 11); ctx.fill();
        ctx.fillStyle = won ? "#1b1b1b" : theme.card; ctx.fillText(score, bx + w / 2, by + 11);
      }
    }
    if (champ && typeof Path2D === "function" && typeof TIER_ICON_PATHS !== "undefined"){
      ctx.save(); ctx.translate(node.x - 24, y - 40); ctx.scale(2, 2); ctx.fillStyle = "#f5c542"; ctx.strokeStyle = "#7a5a00"; ctx.lineWidth = 0.8; ctx.lineJoin = "round";
      const crown = new Path2D(TIER_ICON_PATHS.crown); ctx.fill(crown); ctx.stroke(crown); ctx.restore();
    }
    ctx.restore();
  });
  return canvas.toDataURL("image/png");
}

function bracketButton(label, title, className, icon){
  const button = document.createElement("button"); button.type = "button"; button.className = className || "tier-btn";
  button.innerHTML = icon || "";
  if (label){ const span = document.createElement("span"); if (/run-save/.test(button.className)) span.className = "run-save-label"; span.textContent = label; button.append(span); }
  else button.classList.add("tier-ico");
  if (title){ button.title = title; button.setAttribute("aria-label", title); }
  return button;
}
function bracketUiIcon(name){ return typeof window.uiIcon === "function" ? window.uiIcon(name) : ""; }
function bracketSleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

function mountBracketEditor(doc){
  const model = doc.bracketDoc, root = document.createElement("div"); root.className = "bracket-doc"; doc.el.appendChild(root);
  const say = (message, ms, opts) => { if (typeof toast === "function") toast(message, ms || 2600, opts); };
  const layerHost = () => (typeof tierLayerHost === "function" ? tierLayerHost() : document.body);

  /* 머리말 — 제목 입력칸 / 참가자 넣기 / 모양·꾸미기 / 다시 보기·발표 / 되돌리기·저장·⋯ */
  const bar = document.createElement("div"); bar.className = "bracket-bar";
  const brand = document.createElement("div"); brand.className = "bracket-brand";
  brand.innerHTML = '<span class="bracket-logo" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M6 9h10v10H6zM6 29h10v10H6zM32 19h10v10H32z" fill="#8b80f9" stroke="#2b2d6e" stroke-width="2.4" stroke-linejoin="round"/><path d="M16 14h6v20h-6M22 24h10" fill="none" stroke="#2b2d6e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  const titleInput = document.createElement("input"); titleInput.className = "bracket-title"; titleInput.value = model.title; titleInput.maxLength = 160; titleInput.placeholder = "대진표 제목 (예: 반 대항 피구 대회)"; titleInput.title = "눌러서 제목 바꾸기";
  brand.appendChild(titleInput);
  const addBtn = bracketButton("글로 넣기", "참가자(사람·팀·물건 이름)를 한 줄에 하나씩 넣기", "tier-btn", bracketUiIcon("plus"));
  const photoBtn = bracketButton("사진 넣기", "사진 참가자 넣기 — 여러 장을 한꺼번에 고르거나, 화면에 끌어다 놓거나, Ctrl+V 로 붙여 넣을 수 있어요", "tier-btn", bracketUiIcon("image"));
  const layoutBtn = bracketButton("모양", "대진표 모양 고르기 — 양쪽에서 가운데로·한쪽으로·아래에서 위로 …", "tier-btn", bracketSvg("layout"));
  const themeBtn = bracketButton("꾸미기", "배경 템플릿·선 모양·카드 크기", "tier-btn", bracketSvg("palette"));
  const playBtn = bracketButton("다시 보기", "지금까지 정한 경기를 1회전부터 차례로 올라가는 모습으로 다시 보여 줘요", "tier-btn bracket-play-btn", bracketUiIcon("play"));
  const showBtn = bracketButton("", "발표 — 화면 가득 보기 (한 번 더 누르면 돌아와요)", "tier-btn", bracketSvg("screen"));
  const undoBtn = bracketButton("", "실행 취소 (Ctrl+Z)", "tier-btn", bracketUiIcon("undo")), redoBtn = bracketButton("", "다시 실행 (Ctrl+Y)", "tier-btn", bracketUiIcon("redo"));
  const saveBtn = bracketButton("저장하기", "대진표 저장 (Ctrl+S)", "tier-btn tier-primary run-save", bracketUiIcon("save"));
  const moreBtn = bracketButton("", "더 보기 — 대진 크기·새로 뽑기·점수·움직임·그림으로 저장", "tier-btn", bracketUiIcon("more"));
  const actions = document.createElement("div"); actions.className = "bracket-actions";
  actions.append(addBtn, photoBtn, layoutBtn, themeBtn, playBtn, showBtn, undoBtn, redoBtn, saveBtn, moreBtn);
  bar.append(brand, actions);

  const body = document.createElement("div"); body.className = "bracket-body";
  const backdrop = document.createElement("div"); backdrop.className = "bracket-backdrop";
  const view = document.createElement("div"); view.className = "bracket-view";
  const sizer = document.createElement("div"); sizer.className = "bracket-sizer";
  const stage = document.createElement("div"); stage.className = "bracket-stage";
  sizer.appendChild(stage); view.appendChild(sizer);
  const zoomBox = document.createElement("div"); zoomBox.className = "bracket-zoom";
  const zoomOut = bracketButton("", "작게 보기 (Ctrl+휠)", "bracket-zoom-btn", bracketUiIcon("zoomOut")), zoomIn = bracketButton("", "크게 보기 (Ctrl+휠)", "bracket-zoom-btn", bracketUiIcon("zoomIn"));
  const zoomLabel = document.createElement("button"); zoomLabel.type = "button"; zoomLabel.className = "bracket-zoom-label"; zoomLabel.title = "실제 크기(100%)로";
  const fitBtn = bracketButton("", "화면에 맞추기", "bracket-zoom-btn", bracketSvg("fit"));
  const helpBtn = bracketButton("", "사용 안내 보기", "bracket-zoom-btn bracket-help-btn", '<span aria-hidden="true">?</span>');
  zoomBox.append(helpBtn, zoomOut, zoomLabel, zoomIn, fitBtn);
  /* 사용 안내 — 판 위에 떠서 카드를 가리므로 늘 두지 않는다. ✕ 로 닫으면 다음부터 안 뜨고(이 브라우저에 기억),
     판을 누르거나 끌기 시작하면 바로 숨는다. 오른쪽 아래 ? 단추로 언제든 다시 본다. */
  const hint = document.createElement("div"); hint.className = "bracket-hint"; hint.setAttribute("role", "note");
  const hintText = document.createElement("span"); hintText.textContent = "이긴 쪽 카드를 누르면 한 칸 올라가요 · 오른쪽 클릭하면 점수·모양·꾸미기 등 모든 도구 · 첫 칸 카드를 끌어 자리 바꾸기";
  const hintClose = bracketButton("", "안내 닫기 — 다시 보려면 오른쪽 아래 ? 단추", "bracket-hint-x", bracketUiIcon("close"));
  hint.append(hintText, hintClose);
  const HINT_CLOSED_KEY = "classdock-bracket-hint-closed";
  const showHint = on => { hint.hidden = !on; helpBtn.classList.toggle("is-on", !!on); };
  hintClose.onclick = () => { showHint(false); try { localStorage.setItem(HINT_CLOSED_KEY, "1"); } catch(_){} };
  helpBtn.onclick = () => showHint(hint.hidden);
  let hintClosed = false; try { hintClosed = localStorage.getItem(HINT_CLOSED_KEY) === "1"; } catch(_){}
  showHint(!hintClosed);
  const replayBar = document.createElement("div"); replayBar.className = "bracket-replay"; replayBar.hidden = true;
  const empty = document.createElement("div"); empty.className = "bracket-empty"; empty.hidden = true;
  empty.innerHTML = '<strong>참가자를 넣어 대진표를 만들어 보세요.</strong><span>빈 칸을 눌러 한 명씩 넣어도 되고, 칸이 모자라면 대진이 저절로 커져요(최대 128).</span><div class="bracket-empty-actions"></div>';
  const emptyText = bracketButton("글로 넣기", "", "tier-btn tier-primary", bracketUiIcon("plus")), emptyPhoto = bracketButton("사진 넣기", "", "tier-btn", bracketUiIcon("image"));
  empty.querySelector(".bracket-empty-actions").append(emptyText, emptyPhoto);
  const confetti = document.createElement("canvas"); confetti.className = "bracket-confetti"; confetti.setAttribute("aria-hidden", "true");
  body.append(backdrop, view, empty, replayBar, hint, zoomBox, confetti);
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"; fileInput.multiple = true; fileInput.hidden = true;
  root.append(bar, body, fileInput);

  // 되돌리기 기록엔 사진 바이트 대신 짧은 열쇠만 — 티어표와 같은 까닭(사진 128장 × 기록 60칸).
  const imageKeys = new WeakMap(), imageStore = new Map(); let imageSeq = 0;
  const imageKey = image => { if (!image) return ""; let key = imageKeys.get(image); if (!key){ key = "i" + (++imageSeq); imageKeys.set(image, key); imageStore.set(key, image); } return key; };
  const snapshot = () => JSON.stringify({ ...model, entries:model.entries.map(entry => ({ ...entry, image:imageKey(entry.image) })), backdrop:{ ...model.backdrop, image:imageKey(model.backdrop.image) } });
  let savedSnapshot = snapshot(), recoveryTimer = 0, history = null;
  doc.bracketMarkSaved = () => { savedSnapshot = snapshot(); if (history) history.replaceCurrent(savedSnapshot); };
  const flushRecovery = async () => { clearTimeout(recoveryTimer); recoveryTimer = 0; if (!doc.hasUnsavedEdits && !(doc.isScratch && !doc._named)) return true; if (typeof rememberWorkspace !== "function" || typeof recoverySnapshotFile !== "function") return false;
    try { const file = recoverySnapshotFile(doc, new TextEncoder().encode(bracketDocSerialize(model)), "application/json"); doc.savedInWorkspace = file ? await rememberWorkspace([file], false, { silent:true }) : false; return !!doc.savedInWorkspace; } catch(error){ console.warn("대진표 복구본 저장 실패:", error); return false; } };
  const touch = () => { if (typeof markDocumentDirty === "function") markDocumentDirty(doc, snapshot() !== savedSnapshot); clearTimeout(recoveryTimer); recoveryTimer = setTimeout(flushRecovery, BRACKET_RECOVERY_DELAY); };
  doc.flushBackupRecovery = flushRecovery;
  const replaceModel = value => {
    const raw = JSON.parse(value); Object.keys(raw).forEach(key => { model[key] = raw[key]; });
    model.entries = raw.entries.map(entry => ({ ...entry, image:entry.image ? imageStore.get(entry.image) || null : null }));
    model.backdrop = { ...raw.backdrop, image:raw.backdrop.image ? imageStore.get(raw.backdrop.image) || null : null };
    titleInput.value = model.title; stopReplay(true); render(); touch();
  };
  history = MNEditHistory.create({ capture:snapshot, isEqual:(a, b) => a === b, apply:replaceModel, onChange:() => { undoBtn.disabled = !history.canUndo(); redoBtn.disabled = !history.canRedo(); }, limit:BRACKET_HISTORY_LIMIT }); history.reset(); doc._bracketHistory = history;
  const changed = () => { stopReplay(true); history.commit(); touch(); render(); };
  const clearedNote = cleared => (cleared ? ` 참가자가 바뀌어 뒤 경기 결과 ${cleared}개를 지웠어요 — 되돌리려면 Ctrl+Z` : "");

  /* ── 그리기 ── 바뀔 때마다 판 전체를 다시 그린다(칸 255개·선 254개면 충분히 가볍다). */
  let geo = null, resolved = null, entryById = new Map(), animToken = 0, traceId = "", zoom = 1, fitMode = true;
  const motion = () => { const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; return BRACKET_MOTION[reduce ? "off" : model.motion] || BRACKET_MOTION.normal; };
  function applyBackdrop(){
    root.dataset.brTheme = model.theme;
    const img = model.theme === "custom" && model.backdrop.image;
    backdrop.classList.toggle("has-image", !!img); backdrop.dataset.fit = model.backdrop.fit;
    if (img){ if (backdrop._src !== img.dataUrl){ backdrop.style.setProperty("--br-image", `url("${img.dataUrl}")`); backdrop._src = img.dataUrl; } backdrop.style.setProperty("--br-veil", String(model.backdrop.veil)); }
    else if (backdrop._src){ backdrop.style.removeProperty("--br-image"); backdrop._src = ""; }
  }
  function matchAt(r, i){ return resolved && r < geo.R ? resolved.matches[bracketMatchIndex(model.size, r, i)] : null; }
  function cardFor(node){
    const id = resolved.nodes[node.r][node.k], entry = id ? entryById.get(id) : null, champ = node.r === geo.R, match = champ ? null : matchAt(node.r, node.k >> 1);
    const el = document.createElement("div"); el.className = "bracket-card" + (champ ? " is-champ" : ""); el.dataset.node = node.key; if (node.out) el.dataset.out = node.out;
    el.style.left = (node.x - node.w / 2) + "px"; el.style.top = (node.y - node.h / 2) + "px"; el.style.width = node.w + "px"; el.style.height = node.h + "px";
    if (entry){
      const label = bracketEntryLabel(entry);
      el.classList.add("is-entry"); el.dataset.entry = entry.id; if (!entry.image) el.classList.add("is-text");
      if (entry.image){ const img = document.createElement("img"); img.src = entry.image.dataUrl; img.alt = label; img.draggable = false; el.appendChild(img); }
      if (label){ const text = document.createElement("span"); text.className = "bracket-card-text"; text.textContent = label; el.appendChild(text); }
      if (match && match.winner){ if (match.winner === entry.id) el.classList.add(match.auto ? "is-pass" : "is-won"); else el.classList.add("is-lost"); }
      if (match && match.a && match.b) el.classList.add("is-playable");
      if (model.showScores && match && match.result){ const score = node.k & 1 ? match.result.sb : match.result.sa; if (score !== ""){ const badge = document.createElement("span"); badge.className = "bracket-score"; badge.textContent = score; el.appendChild(badge); } }
      if (node.r === 0){ const edit = document.createElement("button"); edit.type = "button"; edit.className = "bracket-card-edit"; edit.innerHTML = bracketSvg("edit"); edit.title = "참가자 고치기"; edit.setAttribute("aria-label", "참가자 고치기 — " + (label || "사진")); el.appendChild(edit); }
      if (champ){ const crown = document.createElement("span"); crown.className = "bracket-crown"; crown.innerHTML = typeof tierSvg === "function" ? tierSvg("crown") : ""; el.appendChild(crown); }
      el.title = (label || "사진 참가자") + (champ ? " — 우승!" : match && match.a && match.b ? (match.winner === entry.id ? " — 이긴 쪽 (다른 쪽을 누르면 바꿔요)" : " — 누르면 이 쪽이 이겨요") : match && match.auto ? " — 부전승" : "");
    } else if (id === null){
      el.classList.add(node.r === 0 ? "is-empty" : "is-void");
      if (node.r === 0){ const sibling = resolved.nodes[0][node.k ^ 1]; el.innerHTML = '<span class="bracket-card-text">＋ ' + (sibling ? "부전승" : "빈 자리") + "</span>"; el.title = "눌러서 이 자리에 참가자 넣기" + (sibling ? " (비워 두면 옆 참가자가 부전승으로 올라가요)" : ""); }
      if (champ) el.innerHTML = '<span class="bracket-card-text">우승</span>';
    } else {
      el.classList.add("is-pending");
      if (champ){ el.innerHTML = (typeof tierSvg === "function" ? tierSvg("trophy", "bracket-trophy") : "") + '<span class="bracket-card-text">우승</span>'; el.title = "결승이 끝나면 우승 참가자가 여기로 올라와요"; }
    }
    return el;
  }
  function render(results){
    animToken++;
    applyBackdrop();
    entryById = new Map(model.entries.map(entry => [entry.id, entry]));
    geo = bracketGeometry(model.size, model.layout, model.cardSize, { title:true, lineStyle:model.lineStyle });
    resolved = bracketResolve(model, results);
    stage.className = "bracket-stage axis-" + geo.axis; stage.style.width = geo.width + "px"; stage.style.height = geo.height + "px"; stage.style.setProperty("--br-font", geo.font + "px");
    stage.innerHTML = "";
    const title = document.createElement("div"); title.className = "bracket-stage-title"; title.textContent = model.title; title.style.top = (geo.titleY - 22) + "px"; stage.appendChild(title);
    geo.labels.forEach(label => { const tag = document.createElement("span"); tag.className = "bracket-round"; tag.dataset.round = String(label.r); tag.textContent = label.text; tag.style.left = label.x + "px"; tag.style.top = label.y + "px"; stage.appendChild(tag); });
    let base = "", wins = "";
    geo.edges.forEach(edge => {
      const id = resolved.nodes[edge.r][edge.k], up = resolved.nodes[edge.r + 1][edge.k >> 1];
      base += `<path class="bracket-edge${id === null ? " is-void" : ""}" d="${edge.d}"/>`;
      if (id && id === up){ const match = matchAt(edge.r, edge.k >> 1); wins += `<path class="bracket-edge-win${match && match.auto ? " is-pass" : ""}" data-edge="${edge.key}" data-entry="${id.replace(/"/g, "&quot;")}" d="${edge.d}"/>`; }
    });
    stage.insertAdjacentHTML("beforeend", `<svg class="bracket-lines" width="${geo.width}" height="${geo.height}" viewBox="0 0 ${geo.width} ${geo.height}" aria-hidden="true">${base}${wins}</svg>`);
    const frag = document.createDocumentFragment(); geo.nodes.forEach(node => frag.appendChild(cardFor(node))); stage.appendChild(frag);
    if (traceId) setTrace(traceId, true);
    empty.hidden = !!model.entries.length || !!replay;
    playBtn.disabled = !Object.keys(model.results).some(key => model.results[key].winner) && !replay;
    applyZoom();
  }

  /* ── 확대·맞추기 ── 판은 transform 으로 줄이고, 겉 칸(sizer)이 줄인 크기만큼 자리를 차지해 스크롤이 맞게 한다. */
  function fitScale(){ const w = view.clientWidth - 28, h = view.clientHeight - 28; if (!geo || w <= 0 || h <= 0) return 1; return Math.max(0.08, Math.min(1.6, w / geo.width, h / geo.height)); }
  function applyZoom(){
    if (!geo) return; if (fitMode) zoom = fitScale();
    stage.style.transform = `scale(${zoom})`; sizer.style.width = Math.ceil(geo.width * zoom) + "px"; sizer.style.height = Math.ceil(geo.height * zoom) + "px";
    zoomLabel.textContent = Math.round(zoom * 100) + "%"; fitBtn.classList.toggle("is-on", fitMode);
  }
  function setZoom(value){
    if (!geo) return; const before = zoom, cx = view.scrollLeft + view.clientWidth / 2, cy = view.scrollTop + view.clientHeight / 2;
    fitMode = false; zoom = Math.max(0.08, Math.min(3, value)); applyZoom();
    view.scrollLeft = cx / before * zoom - view.clientWidth / 2; view.scrollTop = cy / before * zoom - view.clientHeight / 2;
  }
  const fitNow = () => { fitMode = true; applyZoom(); };
  zoomOut.onclick = () => setZoom(zoom / 1.2); zoomIn.onclick = () => setZoom(zoom * 1.2); zoomLabel.onclick = () => setZoom(1); fitBtn.onclick = fitNow;
  view.addEventListener("wheel", event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); setZoom(zoom * Math.exp(-event.deltaY * 0.0015)); }, { passive:false });
  const viewObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (fitMode) applyZoom(); }) : null; if (viewObserver) viewObserver.observe(view);

  /* ── 한 칸 올라가기 애니메이션 ── 선이 차오르고, 이긴 카드가 다음 칸으로 날아가고, 진 카드는 흐려진다. */
  function nodeEl(key){ return stage.querySelector(`.bracket-card[data-node="${key}"]`); }
  function animateAdvance(r, i){
    const match = matchAt(r, i); if (!match || !match.winner || !geo) return Promise.resolve();
    const final = r + 1 === geo.R, done = () => { if (final) celebrate(); };
    const dur = motion().move; if (!dur){ done(); return Promise.resolve(); }
    const token = animToken, side = match.winner === match.a ? 0 : 1, childKey = r + "-" + (2 * i + side), loserKey = r + "-" + (2 * i + 1 - side), parentKey = (r + 1) + "-" + i;
    const child = geo.byKey.get(childKey), parent = geo.byKey.get(parentKey), childEl = nodeEl(childKey), parentEl = nodeEl(parentKey), loserEl = nodeEl(loserKey);
    const edge = stage.querySelector(`.bracket-edge-win[data-edge="${childKey}"]`), jobs = [];
    if (edge && typeof edge.getTotalLength === "function" && typeof edge.animate === "function"){
      const len = edge.getTotalLength(); edge.style.strokeDasharray = len + "px " + len + "px";
      jobs.push(edge.animate([{ strokeDashoffset:len + "px" }, { strokeDashoffset:"0px" }], { duration:dur * 0.9, easing:"ease-in-out", fill:"backwards" }).finished);
    }
    if (loserEl && typeof loserEl.animate === "function") jobs.push(loserEl.animate([{ opacity:1, filter:"grayscale(0)", transform:"scale(1)" }, { transform:"scale(.94)", offset:0.5 }, { transform:"scale(1)" }], { duration:dur, easing:"ease-out" }).finished);
    if (childEl && parentEl && child && parent && typeof childEl.animate === "function"){
      parentEl.style.visibility = "hidden";
      const ghost = childEl.cloneNode(true); ghost.classList.remove("is-won", "is-lost", "is-playable", "is-pass", "is-trace"); ghost.classList.add("bracket-fly"); ghost.removeAttribute("data-node"); stage.appendChild(ghost);
      const dx = parent.x - child.x, dy = parent.y - child.y;
      const fly = ghost.animate([
        { transform:"translate(0px, 0px) scale(1)", opacity:1 },
        { transform:`translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1.14)`, opacity:1, offset:0.5 },
        { transform:`translate(${dx}px, ${dy}px) scale(1)`, opacity:1, offset:0.9 },
        { transform:`translate(${dx}px, ${dy}px) scale(1)`, opacity:0 }
      ], { duration:dur, easing:"cubic-bezier(.45,.05,.35,1)", fill:"forwards" });
      jobs.push(fly.finished.then(() => {
        ghost.remove(); if (token !== animToken) return null; parentEl.style.visibility = "";
        return parentEl.animate([{ transform:"scale(.7)", opacity:0.2 }, { transform:"scale(1.1)", opacity:1, offset:0.6 }, { transform:"scale(1)", opacity:1 }], { duration:340, easing:"ease-out" }).finished;
      }));
    }
    return Promise.all(jobs.map(job => job.catch(() => {}))).then(() => { if (token === animToken) done(); });
  }
  /* 우승 — 왕관이 떨어지고 색종이가 터진다(움직임 끄기면 왕관만). */
  let confettiFrame = 0;
  function celebrate(){
    const champ = stage.querySelector(".bracket-card.is-champ.is-entry"); if (!champ) return;
    champ.classList.remove("is-celebrating"); void champ.offsetWidth; champ.classList.add("is-celebrating");
    if (!motion().move) return;
    cancelAnimationFrame(confettiFrame);
    const box = body.getBoundingClientRect(), rect = champ.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = body.clientWidth, h = body.clientHeight; confetti.width = Math.round(w * dpr); confetti.height = Math.round(h * dpr);
    const ctx = confetti.getContext("2d"); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ox = box.width ? (rect.left + rect.width / 2 - box.left) / box.width * w : w / 2, oy = box.height ? (rect.top + rect.height / 3 - box.top) / box.height * h : h / 3;
    const colors = ["#ff4f86", "#ffd166", "#06d6a0", "#118ab2", "#8b80f9", "#ff7a59", "#f5c542"], parts = [];
    for (let n = 0; n < 170; n++){ const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 8; parts.push({ x:ox, y:oy, vx:Math.cos(a) * s, vy:Math.sin(a) * s - 5, r:3 + Math.random() * 4, c:colors[n % colors.length], spin:Math.random() * 6, t:Math.random() * 6 }); }
    const start = performance.now();
    const tick = now => {
      const life = (now - start) / 2600; ctx.clearRect(0, 0, w, h); if (life >= 1){ ctx.clearRect(0, 0, w, h); return; }
      ctx.globalAlpha = Math.min(1, (1 - life) * 2.2);
      parts.forEach(p => { p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.t += p.spin * 0.02; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); });
      confettiFrame = requestAnimationFrame(tick);
    };
    confettiFrame = requestAnimationFrame(tick);
  }

  /* 이긴 길 따라 빛내기 — 카드에 올리면 그 참가자가 지나온 칸·선을 함께 밝힌다. */
  function setTrace(id, force){
    if (traceId === id && !force) return; traceId = id || "";
    stage.querySelectorAll(".is-trace").forEach(el => el.classList.remove("is-trace"));
    if (traceId) stage.querySelectorAll(`[data-entry="${CSS.escape(traceId)}"]`).forEach(el => el.classList.add("is-trace"));
  }
  stage.addEventListener("pointerover", event => { if (press || pan || replay) return; const card = event.target.closest(".bracket-card.is-entry"); setTrace(card ? card.dataset.entry : ""); });
  stage.addEventListener("pointerleave", () => setTrace(""));
  doc.bracketFocus = id => {
    const el = stage.querySelector(`.bracket-card[data-entry="${CSS.escape(id)}"]`); if (!el) return false;
    setTrace(id); el.scrollIntoView({ block:"center", inline:"center", behavior:"smooth" }); return true;
  };

  /* ── 경기 정하기 ── */
  function chooseWinner(r, i, id){
    const match = matchAt(r, i); if (!match || !match.a || !match.b) return;
    if (match.winner === id) return;
    const out = bracketSetResult(model, r, i, { winner:id }); if (!out) return;
    changed(); animateAdvance(r, i);
    if (out.cleared) say("이긴 쪽을 바꿨어요." + clearedNote(out.cleared), 3400);
  }
  function onCardClick(key){
    if (replay || !geo) return;
    const node = geo.byKey.get(key); if (!node) return;
    const id = resolved.nodes[node.r][node.k];
    if (node.r === 0 && id === null){ openEntryDialog("", node.k); return; }
    if (!id) return;
    if (node.r === geo.R){ celebrate(); return; }
    const match = matchAt(node.r, node.k >> 1);
    if (match && match.a && match.b) chooseWinner(node.r, node.k >> 1, id);
    else if (match && match.auto) say("상대가 없어 부전승으로 올라가요.", 2000);
    else say("상대가 아직 정해지지 않았어요 — 앞 경기를 먼저 정하세요.", 2400);
  }

  /* ── 누르기·끌기·밀기 ── 카드를 누르면 경기 결정, 첫 칸 카드를 끌면 자리 바꾸기, 빈 곳을 끌면 화면 밀기.
     마우스·펜·손가락이 같은 길로 가도록 포인터 이벤트로 직접 짠다(HTML5 drag 는 터치에서 안 된다). */
  let press = null, pan = null;
  view.addEventListener("pointerdown", event => {
    if (!hint.hidden) showHint(false);   // 일을 시작하면 안내는 비킨다(? 로 다시)
    if (event.button !== 0) return;
    if (event.target.closest(".bracket-card-edit")) return;
    const card = event.target.closest(".bracket-card");
    if (card && card.dataset.node){ const node = geo && geo.byKey.get(card.dataset.node); press = { card, key:card.dataset.node, leaf:!!(node && node.r === 0 && card.dataset.entry), pointerId:event.pointerId, x:event.clientX, y:event.clientY, moved:false, started:false, ghost:null, target:null }; return; }
    if (event.target.closest("button,input,select,textarea")) return;
    pan = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, left:view.scrollLeft, top:view.scrollTop, moved:false };
  });
  const dropTargetAt = (x, y) => { const hit = document.elementFromPoint(x, y), card = hit && hit.closest ? hit.closest(".bracket-doc .bracket-card") : null; return card && card !== press.card && /^0-/.test(card.dataset.node || "") ? card : null; };
  const onMove = event => {
    if (pan && event.pointerId === pan.pointerId){
      const dx = event.clientX - pan.x, dy = event.clientY - pan.y; if (!pan.moved && Math.hypot(dx, dy) < 4) return;
      pan.moved = true; view.classList.add("is-panning"); view.scrollLeft = pan.left - dx; view.scrollTop = pan.top - dy; return;
    }
    if (!press || event.pointerId !== press.pointerId) return;
    if (!press.moved){ if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return; press.moved = true; }
    if (!press.leaf || replay) return;
    if (!press.started){
      press.started = true; const r = press.card.getBoundingClientRect(); press.dx = press.x - r.left; press.dy = press.y - r.top;
      const wrap = document.createElement("div"); wrap.className = "bracket-drag-ghost axis-" + geo.axis; wrap.dataset.brTheme = model.theme; wrap.style.setProperty("--br-font", geo.font + "px");
      const clone = press.card.cloneNode(true); clone.style.left = "0px"; clone.style.top = "0px"; clone.style.transform = `scale(${zoom})`; clone.style.transformOrigin = "0 0"; wrap.appendChild(clone);
      press.ghost = wrap; layerHost().appendChild(wrap); press.card.classList.add("is-dragging"); root.classList.add("is-dragging"); setTrace("");
    }
    event.preventDefault();
    press.ghost.style.transform = `translate(${event.clientX - press.dx}px, ${event.clientY - press.dy}px)`;
    const target = dropTargetAt(event.clientX, event.clientY);
    if (target !== press.target){ if (press.target) press.target.classList.remove("is-drop-target"); press.target = target; if (target) target.classList.add("is-drop-target"); }
    const r = view.getBoundingClientRect();
    if (event.clientY < r.top + 40) view.scrollTop -= 14; else if (event.clientY > r.bottom - 40) view.scrollTop += 14;
    if (event.clientX < r.left + 40) view.scrollLeft -= 14; else if (event.clientX > r.right - 40) view.scrollLeft += 14;
  };
  const finish = (event, cancel) => {
    if (pan && (!event || event.pointerId === pan.pointerId)){ pan = null; view.classList.remove("is-panning"); return; }
    if (!press || (event && event.pointerId !== press.pointerId)) return;
    const state = press; press = null;
    if (!state.started){ if (!cancel && !state.moved) onCardClick(state.key); return; }
    state.ghost.remove(); state.card.classList.remove("is-dragging"); root.classList.remove("is-dragging"); if (state.target) state.target.classList.remove("is-drop-target");
    if (cancel || !state.target) return;
    const from = Number(state.key.split("-")[1]), to = Number(state.target.dataset.node.split("-")[1]), out = bracketSwapSlots(model, from, to);
    if (out){ changed(); if (out.cleared) say("자리를 바꿨어요." + clearedNote(out.cleared), 3400); }
  };
  const onUp = event => finish(event, false), onCancel = event => finish(event, true);
  window.addEventListener("pointermove", onMove, { passive:false }); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onCancel);
  view.addEventListener("click", event => {
    const edit = event.target.closest(".bracket-card-edit"); if (!edit || replay) return;
    event.stopPropagation(); const card = edit.closest(".bracket-card"); if (card && card.dataset.entry) openEntryDialog(card.dataset.entry, -1);
  });

  /* 오른쪽 클릭 — 카드 위면 그 카드·경기 일을 먼저, 그 아래로 머리말·⋯ 메뉴의 모든 도구를 갈래별(▸)로.
     빈 곳에서도 같은 도구 메뉴가 뜬다. 다시 보기 중엔 재생 조절만. 손가락은 길게 누르면 같은 메뉴가 뜬다. */
  body.addEventListener("contextmenu", event => {
    if (!geo || typeof MNContextMenu === "undefined") return;
    if (event.target.closest("input,textarea")) return;   // 입력칸은 브라우저 메뉴(붙여넣기 등) 그대로
    event.preventDefault(); press = null;   // 손가락 길게 누르기 — 메뉴가 뜬 뒤 손을 떼도 경기가 정해지지 않게
    if (pan){ pan = null; view.classList.remove("is-panning"); }
    const card = event.target.closest(".bracket-card");
    const items = replay ? replayMenuItems() : [...(card && card.dataset.node ? cardMenuItems(card) : []), ...toolMenuItems()];
    MNContextMenu.open(event.clientX, event.clientY, items, { base:"text-context" });
  });
  const shortName = text => (text.length > 14 ? text.slice(0, 13) + "…" : text);
  function cardMenuItems(card){
    const node = geo.byKey.get(card.dataset.node); if (!node) return [];
    const id = resolved.nodes[node.r][node.k], entry = id ? entryById.get(id) : null, champ = node.r === geo.R, match = champ ? null : matchAt(node.r, node.k >> 1), items = [];
    const name = entry ? bracketEntryLabel(entry) || "사진 참가자" : "";
    if (entry && match && match.a && match.b){
      const i = node.k >> 1;
      items.push({ label:`「${shortName(name)}」 이김`, title:"이 참가자를 다음 칸으로 올리기 (카드를 한 번 눌러도 돼요)", icon:"check", disabled:match.winner === id, action:() => chooseWinner(node.r, i, id) });
      items.push({ label:"점수·결과 넣기…", title:"두 참가자의 점수를 넣고 이긴 쪽 정하기", icon:"pen", action:() => openMatchDialog(node.r, i) });
      items.push({ label:"이 경기 결과 지우기", icon:"undo", disabled:!match.result, action:() => { const out = bracketSetResult(model, node.r, i, { winner:"", sa:"", sb:"" }); if (out){ changed(); if (out.cleared) say("결과를 지웠어요." + clearedNote(out.cleared), 3400); } } });
    } else if (entry && match && match.auto) items.push({ label:"부전승 — 상대가 없어요", disabled:true, action:() => {} });
    else if (entry && match) items.push({ label:"상대를 기다리는 중", disabled:true, action:() => {} });
    if (champ && entry) items.push({ label:"우승 축하 다시 보기", icon:"play", action:celebrate });
    if (entry){
      if (items.length) items.push({ separator:true });
      items.push({ label:"참가자 고치기…", title:"이름·사진 바꾸기", icon:"pen", action:() => openEntryDialog(id, -1) });
      items.push({ label:"참가자 빼기", title:"그 자리는 빈 칸(부전승)이 돼요", icon:"delete", action:() => removeEntry(id) });
    } else if (node.r === 0) items.push({ label:"여기에 참가자 넣기…", icon:"plus", disabled:model.entries.length >= BRACKET_MAX_SIZE, action:() => openEntryDialog("", node.k) });
    return items.length ? [...items, { separator:true }] : [];
  }

  function removeEntry(id){ const out = bracketRemoveEntry(model, id); if (!out) return; changed(); say("참가자를 뺐어요 — 그 자리는 빈 칸(부전승)이 돼요." + clearedNote(out.cleared) + (out.cleared ? "" : " 되돌리려면 Ctrl+Z"), 3200); }

  /* ── 창들 ── 모양은 티어표 창(tierModal·tier-form)을 함께 쓴다. */
  function modal(title, bodyEl, wide){ const ui = tierModal(title, bodyEl); if (wide) ui.modal.querySelector(".tier-modal-card").classList.add("bracket-wide"); return ui; }
  function openEntryDialog(entryId, slotIndex){
    const current = entryId ? entryById.get(entryId) : null; if (entryId && !current) return;
    const form = document.createElement("div"); form.className = "tier-form";
    form.innerHTML = '<div class="wide tier-item-preview"></div><label class="wide"><span class="bf-text-label"></span><input class="bf-text" maxlength="60"></label>'
      + '<div class="wide tier-form-actions"><button type="button" class="bf-photo">사진 넣기</button><button type="button" class="bf-photo-remove">사진 빼기</button><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" hidden></div>'
      + '<p class="tier-form-error wide" role="alert"></p><footer class="wide"><button type="button" class="bf-delete danger">참가자 빼기</button><span></span><button type="button" class="bf-cancel">취소</button><button type="button" class="bf-save primary">확인</button></footer>';
    const ui = modal(current ? "참가자 고치기" : "참가자 넣기", form), text = form.querySelector(".bf-text"), preview = form.querySelector(".tier-item-preview"), photoInput = form.querySelector("input[type=file]"), error = form.querySelector(".tier-form-error");
    let image = current ? current.image : null;
    const sync = () => {
      preview.innerHTML = ""; preview.hidden = !image; if (image){ const img = document.createElement("img"); img.src = image.dataUrl; img.alt = ""; preview.appendChild(img); }
      form.querySelector(".bf-text-label").textContent = image ? "이름 (비워 두면 사진만)" : "이름 (사람·팀·물건)";
      form.querySelector(".bf-photo").textContent = image ? "사진 바꾸기" : "사진 넣기"; form.querySelector(".bf-photo-remove").hidden = !image;
    };
    text.value = current ? bracketEntryLabel(current) : ""; sync();
    form.querySelector(".bf-photo").onclick = () => photoInput.click();
    form.querySelector(".bf-photo-remove").onclick = () => { image = null; sync(); };
    photoInput.onchange = async () => { const file = photoInput.files && photoInput.files[0]; photoInput.value = ""; if (!file) return; try { image = await tierPrepareImage(file); sync(); } catch(_){ error.textContent = "사진을 넣지 못했어요."; } };
    form.querySelector(".bf-cancel").onclick = ui.dispose;
    const del = form.querySelector(".bf-delete"); del.hidden = !current; del.onclick = () => { ui.dispose(); removeEntry(current.id); };
    form.querySelector(".bf-save").onclick = () => {
      const value = bracketText(text.value, 60).trim();
      if (!image && !value){ error.textContent = "이름을 쓰거나 사진을 넣으세요."; text.focus(); return; }
      if (current){ current.text = value; current.name = ""; current.image = image; ui.dispose(); changed(); return; }   // 입력칸에 보여 준 이름(파일 이름 포함)이 곧 새 이름
      if (model.entries.length >= BRACKET_MAX_SIZE){ error.textContent = `참가자는 ${BRACKET_MAX_SIZE}명까지 넣을 수 있어요.`; return; }
      const entry = bracketNormalizeEntry({ text:value }); entry.image = image;
      if (slotIndex >= 0 && slotIndex < model.slots.length && !model.slots[slotIndex]){ model.entries.push(entry); model.slots[slotIndex] = entry.id; bracketPrune(model); ui.dispose(); changed(); return; }
      const out = bracketAddEntries(model, [entry]); ui.dispose(); changed(); if (out.grew) say(`칸이 모자라 ${model.size}강 대진으로 키웠어요.` + clearedNote(out.cleared), 3400);
    };
    text.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing){ event.preventDefault(); form.querySelector(".bf-save").click(); } });
    setTimeout(() => text.focus(), 0);
  }
  function openBulkDialog(){
    const form = document.createElement("div"); form.className = "tier-form";
    form.innerHTML = '<label class="wide"><span>한 줄에 하나씩 적으세요</span><textarea class="bf-lines" rows="9" placeholder="예)\n호랑이반\n사자반\n독수리반\n돌고래반"></textarea></label>'
      + '<p class="wide bracket-form-note"></p><p class="tier-form-error wide" role="alert"></p>'
      + '<footer class="wide"><span></span><button type="button" class="bf-cancel">취소</button><button type="button" class="bf-save primary">넣기</button></footer>';
    const ui = modal("참가자 글로 넣기", form), area = form.querySelector(".bf-lines"), note = form.querySelector(".bracket-form-note"), error = form.querySelector(".tier-form-error");
    const names = () => area.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const paint = () => { const n = names().length, total = model.entries.length + n; note.textContent = `지금 ${model.entries.length}명 · ${bracketRoundLabel(model.size)} 대진` + (n ? ` → 넣으면 ${Math.min(total, BRACKET_MAX_SIZE)}명` + (total > model.size ? ` (${bracketRoundLabel(Math.min(BRACKET_MAX_SIZE, bracketSizeFor(total)))}으로 커져요)` : "") : "") + (total > BRACKET_MAX_SIZE ? ` · ${BRACKET_MAX_SIZE}명을 넘는 ${total - BRACKET_MAX_SIZE}명은 빠져요` : ""); };
    area.addEventListener("input", paint); paint();
    form.querySelector(".bf-cancel").onclick = ui.dispose;
    form.querySelector(".bf-save").onclick = () => {
      const list = names(); if (!list.length){ error.textContent = "넣을 이름을 적으세요."; area.focus(); return; }
      const out = bracketAddEntries(model, list.map(name => bracketNormalizeEntry({ text:name }))); ui.dispose(); changed();
      say(`참가자 ${out.added}명을 넣었어요.` + (out.grew ? ` ${bracketRoundLabel(model.size)} 대진으로 커졌어요.` : "") + (out.skipped ? ` (${out.skipped}명은 ${BRACKET_MAX_SIZE}명을 넘어 뺌)` : "") + clearedNote(out.cleared), 3400);
    };
    setTimeout(() => area.focus(), 0);
  }
  async function addImageFiles(files){
    const list = Array.from(files || []).filter(file => /^image\//i.test(file.type || "")); if (!list.length) return 0;
    const room = BRACKET_MAX_SIZE - model.entries.length; if (room <= 0){ say(`참가자는 ${BRACKET_MAX_SIZE}명까지 넣을 수 있어요.`, 2800); return 0; }
    const known = new Set(model.entries.map(entry => entry.image && entry.image.dataUrl).filter(Boolean)), fresh = [];
    let failed = 0, same = 0;
    for (const file of list.slice(0, room)){
      try { const image = await tierPrepareImage(file); if (known.has(image.dataUrl)){ same++; continue; } known.add(image.dataUrl); const entry = bracketNormalizeEntry({ name:String(file.name || "").replace(/\.[^.]+$/, "") }); entry.image = image; fresh.push(entry); }
      catch(_){ failed++; }
    }
    const out = fresh.length ? bracketAddEntries(model, fresh) : { added:0, grew:false, cleared:0 };
    if (out.added) changed();
    const skipped = list.length - Math.min(list.length, room);
    say((out.added || !same ? `사진 참가자 ${out.added}명을 넣었어요.` : "이미 있는 사진이에요.") + (out.grew ? ` ${bracketRoundLabel(model.size)} 대진으로 커졌어요.` : "") + (same ? ` (같은 사진 ${same}장은 이미 있어서 뺌)` : "") + (failed ? ` (${failed}장은 읽지 못함)` : "") + (skipped ? ` (${skipped}장은 한도를 넘어 뺌)` : "") + clearedNote(out.cleared), 3400);
    return out.added;
  }
  function openMatchDialog(r, i){
    const match = matchAt(r, i); if (!match || !match.a || !match.b) return;
    const a = entryById.get(match.a), b = entryById.get(match.b), result = match.result || { winner:"", sa:"", sb:"" };
    const form = document.createElement("div"); form.className = "tier-form bracket-match-form";
    const side = (entry, key) => `<div class="bracket-match-side" data-side="${key}"><div class="bracket-match-card">${entry.image ? `<img src="${entry.image.dataUrl}" alt="">` : ""}<strong></strong></div><label><span>점수</span><input class="bf-score" inputmode="decimal" maxlength="8"></label><button type="button" class="bf-win">이 쪽이 이김</button></div>`;
    form.innerHTML = `<div class="wide bracket-match-row">${side(a, "a")}<span class="bracket-match-vs">VS</span>${side(b, "b")}</div>`
      + '<p class="wide bracket-form-note"></p><footer class="wide"><button type="button" class="bf-clear">결과 지우기</button><span></span><button type="button" class="bf-cancel">취소</button><button type="button" class="bf-save primary">확인</button></footer>';
    const round = bracketRoundLabel(model.size >> r);
    const ui = modal(`${round} 경기 결과`, form, true), note = form.querySelector(".bracket-form-note");
    const sides = { a:form.querySelector('[data-side="a"]'), b:form.querySelector('[data-side="b"]') };
    sides.a.querySelector("strong").textContent = bracketEntryLabel(a) || "사진 참가자"; sides.b.querySelector("strong").textContent = bracketEntryLabel(b) || "사진 참가자";
    const scoreA = sides.a.querySelector(".bf-score"), scoreB = sides.b.querySelector(".bf-score"); scoreA.value = result.sa; scoreB.value = result.sb;
    let winner = result.winner === match.a ? "a" : result.winner === match.b ? "b" : "";
    const paint = () => {
      ["a", "b"].forEach(key => { sides[key].classList.toggle("is-winner", winner === key); sides[key].querySelector(".bf-win").setAttribute("aria-pressed", winner === key ? "true" : "false"); });
      note.textContent = winner ? "" : scoreA.value.trim() && scoreB.value.trim() ? "점수가 같아요 — 이긴 쪽을 직접 고르세요(승부차기 등)." : `점수를 넣으면 ${model.scoreRule === "low" ? "낮은" : "높은"} 쪽이 저절로 이긴 쪽이 돼요. 점수 없이 이긴 쪽만 골라도 돼요.`;
    };
    const auto = () => { const by = bracketWinnerByScore(scoreA.value, scoreB.value, model.scoreRule); if (by) winner = by; paint(); };
    scoreA.addEventListener("input", auto); scoreB.addEventListener("input", auto);
    ["a", "b"].forEach(key => { sides[key].querySelector(".bf-win").onclick = () => { winner = winner === key ? "" : key; paint(); }; });
    paint();
    form.querySelector(".bf-cancel").onclick = ui.dispose;
    form.querySelector(".bf-clear").onclick = () => { scoreA.value = ""; scoreB.value = ""; winner = ""; paint(); };
    form.querySelector(".bf-save").onclick = () => {
      const before = match.winner, out = bracketSetResult(model, r, i, { winner:winner === "a" ? match.a : winner === "b" ? match.b : "", sa:scoreA.value, sb:scoreB.value }); ui.dispose(); if (!out) return;
      changed(); const now = matchAt(r, i); if (now && now.winner && now.winner !== before) animateAdvance(r, i);
      if (out.cleared) say("결과를 바꿨어요." + clearedNote(out.cleared), 3400);
    };
    [scoreA, scoreB].forEach(input => input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing){ event.preventDefault(); form.querySelector(".bf-save").click(); } }));
    setTimeout(() => scoreA.focus(), 0);
  }
  function openLayoutDialog(){
    const form = document.createElement("div"); form.className = "tier-form";
    form.innerHTML = '<div class="wide bracket-pick-grid"></div><footer class="wide"><span></span><button type="button" class="bf-cancel">닫기</button></footer>';
    const ui = modal("대진표 모양", form, true), grid = form.querySelector(".bracket-pick-grid");
    BRACKET_LAYOUTS.forEach(layout => {
      const tile = document.createElement("button"); tile.type = "button"; tile.className = "bracket-pick" + (model.layout === layout.id ? " is-on" : ""); tile.dataset.layout = layout.id; tile.setAttribute("aria-pressed", model.layout === layout.id ? "true" : "false");
      tile.innerHTML = `<span class="bracket-pick-preview" data-br-theme="${model.theme}">${bracketMiniSvg(layout.id, model.lineStyle)}</span><span class="bracket-pick-label"></span>`; tile.querySelector(".bracket-pick-label").textContent = layout.label;
      tile.onclick = () => { ui.dispose(); if (model.layout !== layout.id){ model.layout = layout.id; fitMode = true; changed(); } };
      grid.appendChild(tile);
    });
    form.querySelector(".bf-cancel").onclick = ui.dispose;
  }
  function openThemeDialog(){
    const form = document.createElement("div"); form.className = "tier-form bracket-theme-form";
    form.innerHTML = '<div class="wide bracket-field"><span>배경 템플릿</span><div class="bracket-pick-grid is-themes"></div></div>'
      + '<div class="wide bracket-field bracket-custom"><span>내 사진 바탕</span><div class="tier-form-actions"><button type="button" class="bf-bg">사진 고르기</button><button type="button" class="bf-bg-remove">사진 빼기</button><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" hidden></div>'
      + '<div class="bracket-choices bf-fit"></div><label class="bracket-range"><span>흐리게</span><input type="range" class="bf-veil" min="0" max="0.9" step="0.05"></label></div>'
      + '<div class="wide bracket-field"><span>선 모양</span><div class="bracket-choices bf-line"></div></div>'
      + '<div class="wide bracket-field"><span>카드 크기</span><div class="bracket-choices bf-size"></div></div>'
      + '<p class="tier-form-error wide" role="alert"></p><footer class="wide"><span></span><button type="button" class="bf-cancel primary">닫기</button></footer>';
    const ui = modal("꾸미기", form, true), grid = form.querySelector(".is-themes"), photoInput = form.querySelector(".bracket-custom input[type=file]"), error = form.querySelector(".tier-form-error"), veil = form.querySelector(".bf-veil");
    const choice = (box, label, on, pick) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); b.onclick = pick; box.appendChild(b); };
    const paint = () => {
      grid.innerHTML = "";
      BRACKET_THEMES.forEach(theme => {
        const tile = document.createElement("button"); tile.type = "button"; tile.className = "bracket-pick" + (model.theme === theme.id ? " is-on" : ""); tile.dataset.theme = theme.id; tile.setAttribute("aria-pressed", model.theme === theme.id ? "true" : "false");
        tile.innerHTML = `<span class="bracket-pick-preview" data-br-theme="${theme.id}">${bracketMiniSvg("split", model.lineStyle)}</span><span class="bracket-pick-label"></span>`; tile.querySelector(".bracket-pick-label").textContent = theme.label;
        if (theme.id === "custom" && model.backdrop.image){ const preview = tile.querySelector(".bracket-pick-preview"); preview.style.backgroundImage = `linear-gradient(rgba(15,23,42,${model.backdrop.veil}),rgba(15,23,42,${model.backdrop.veil})),url("${model.backdrop.image.dataUrl}")`; preview.style.backgroundSize = "cover"; preview.style.backgroundPosition = "center"; }
        tile.onclick = () => { if (theme.id === "custom" && !model.backdrop.image){ photoInput.click(); return; } if (model.theme !== theme.id){ model.theme = theme.id; changed(); paint(); } };
        grid.appendChild(tile);
      });
      const custom = form.querySelector(".bracket-custom"); custom.classList.toggle("is-off", model.theme !== "custom");
      form.querySelector(".bf-bg").textContent = model.backdrop.image ? "사진 바꾸기" : "사진 고르기"; form.querySelector(".bf-bg-remove").hidden = !model.backdrop.image;
      const fitBox = form.querySelector(".bf-fit"); fitBox.innerHTML = ""; [["cover", "가득 채우기"], ["contain", "전체 보이기"], ["tile", "바둑판"]].forEach(([id, label]) => choice(fitBox, label, model.backdrop.fit === id, () => { model.backdrop.fit = id; changed(); paint(); }));
      veil.value = String(model.backdrop.veil);
      const lineBox = form.querySelector(".bf-line"); lineBox.innerHTML = ""; [["elbow", "꺾은선"], ["curve", "부드러운 곡선"]].forEach(([id, label]) => choice(lineBox, label, model.lineStyle === id, () => { model.lineStyle = id; changed(); paint(); }));
      const sizeBox = form.querySelector(".bf-size"); sizeBox.innerHTML = ""; [["s", "작게"], ["m", "보통"], ["l", "크게"]].forEach(([id, label]) => choice(sizeBox, label, model.cardSize === id, () => { model.cardSize = id; fitMode = true; changed(); paint(); }));
    };
    photoInput.onchange = async () => {
      const file = photoInput.files && photoInput.files[0]; photoInput.value = ""; if (!file) return; error.textContent = "";
      try { model.backdrop.image = await bracketPrepareBackdrop(file); model.theme = "custom"; changed(); paint(); } catch(_){ error.textContent = "바탕 사진을 넣지 못했어요."; }
    };
    form.querySelector(".bf-bg").onclick = () => photoInput.click();
    form.querySelector(".bf-bg-remove").onclick = () => { model.backdrop.image = null; if (model.theme === "custom") model.theme = "classic"; changed(); paint(); };
    veil.addEventListener("input", () => { model.backdrop.veil = Math.max(0, Math.min(0.9, Number(veil.value) || 0)); applyBackdrop(); history.commitSoon(400); touch(); });
    veil.addEventListener("change", () => paint());
    form.querySelector(".bf-cancel").onclick = ui.dispose;
    paint();
  }

  /* ── 다시 보기 ── 정한 경기를 1회전부터 하나씩 되살리며 올라가는 모습을 보여 준다. 화면만 바뀌고 문서는 그대로. */
  let replay = null, replaySeq = 0;
  const replayResults = step => { const out = {}; replay.order.slice(0, step).forEach(key => { out[key] = model.results[key]; }); return out; };
  function paintReplayBar(){
    replayBar.innerHTML = ""; if (!replay) return;
    const label = document.createElement("span"); label.className = "bracket-replay-label";
    const key = replay.order[Math.max(0, replay.step - 1)], r = key ? Number(key.split(":")[0]) : 0;
    label.textContent = replay.done ? "다 봤어요!" : replay.step ? `${bracketRoundLabel(model.size >> r)} · ${replay.step} / ${replay.order.length}` : "준비…";
    const pause = bracketButton("", replay.paused ? "계속 (Space)" : "멈춤 (Space)", "bracket-replay-btn", replay.paused ? bracketUiIcon("play") : bracketSvg("pause"));
    const next = bracketButton("", "다음 경기 (→)", "bracket-replay-btn", bracketSvg("next")); next.disabled = !replay.paused || replay.done;
    const end = bracketButton("끝으로", "모든 결과 바로 보기", "bracket-replay-btn", "");
    const again = bracketButton("다시", "처음부터 다시 보기", "bracket-replay-btn", bracketUiIcon("refresh"));
    const close = bracketButton("", "닫기 (Esc)", "bracket-replay-btn", bracketUiIcon("close"));
    pause.onclick = togglePause; next.onclick = stepOnce; end.onclick = () => stopReplay(false); again.onclick = startReplay; close.onclick = () => stopReplay(false);
    replayBar.append(label, ...(replay.done ? [again, close] : [pause, next, end, close]));
  }
  function markRound(r){ stage.querySelectorAll(".bracket-round.is-current").forEach(el => el.classList.remove("is-current")); if (r != null) stage.querySelectorAll(`.bracket-round[data-round="${r}"]`).forEach(el => el.classList.add("is-current")); }
  async function playStep(run){
    const key = replay.order[replay.step]; replay.step++; render(replayResults(replay.step)); paintReplayBar();
    const [r, i] = key.split(":").map(Number); markRound(r); await animateAdvance(r, i);
    return replay && replay.run === run;
  }
  async function replayLoop(run){
    while (replay && replay.run === run && replay.step < replay.order.length){
      if (replay.paused){ await new Promise(resolve => { replay.resume = resolve; }); continue; }
      if (!await playStep(run)) return;
      await bracketSleep(motion().pause);
    }
    if (replay && replay.run === run){ replay.done = true; markRound(null); paintReplayBar(); }
  }
  async function startReplay(){
    const order = bracketDecidedOrder(model);
    if (!order.length){ say("아직 정한 경기가 없어요 — 이긴 쪽 카드를 눌러 결과를 넣어 보세요.", 3000); return; }
    stopReplay(true);
    const run = ++replaySeq; replay = { order, step:0, paused:false, done:false, run, resume:null };
    root.classList.add("is-replaying"); replayBar.hidden = false; setTrace(""); fitMode = true; render(replayResults(0)); paintReplayBar();
    await bracketSleep(500 + motion().pause); replayLoop(run);
  }
  function togglePause(){ if (!replay || replay.done) return; replay.paused = !replay.paused; const resume = replay.resume; replay.resume = null; if (!replay.paused && resume) resume(); paintReplayBar(); }
  async function stepOnce(){ if (!replay || !replay.paused || replay.done || replay.busy) return; replay.busy = true; const run = replay.run; await playStep(run); if (replay && replay.run === run){ replay.busy = false; if (replay.step >= replay.order.length){ replay.done = true; markRound(null); } paintReplayBar(); } }
  function stopReplay(quiet){
    if (!replay) return; const resume = replay.resume; replay = null; if (resume) resume();
    root.classList.remove("is-replaying"); replayBar.hidden = true; replayBar.innerHTML = "";
    if (!quiet) render();
  }

  /* ── 머리말 버튼·⋯ 메뉴 ── */
  addBtn.onclick = openBulkDialog; emptyText.onclick = openBulkDialog;
  photoBtn.onclick = () => fileInput.click(); emptyPhoto.onclick = () => fileInput.click();
  fileInput.onchange = async () => { const files = Array.from(fileInput.files || []); fileInput.value = ""; await addImageFiles(files); };
  layoutBtn.onclick = openLayoutDialog; themeBtn.onclick = openThemeDialog; playBtn.onclick = startReplay;
  showBtn.onclick = () => { if (typeof toggleViewerFullscreen === "function"){ fitMode = true; toggleViewerFullscreen(); } };
  undoBtn.onclick = () => history.undo(); redoBtn.onclick = () => history.redo();
  titleInput.oninput = () => { model.title = titleInput.value; const title = stage.querySelector(".bracket-stage-title"); if (title) title.textContent = model.title; history.commitSoon(500); touch(); };
  saveBtn.onclick = () => saveBracketDoc(doc);
  const exportPng = async () => {
    try { const png = await bracketRenderPng(model); const blob = await (await fetch(png)).blob(); MNDownload.saveBlob(blob, bracketSafeName(model.title) + ".png"); }
    catch(error){ console.warn("대진표 그림 저장 실패:", error); say("그림으로 저장하지 못했어요.", 3000, { type:"error" }); }
  };
  let sendingToBoard = false;
  const sendToBoard = async () => {
    if (typeof newWhiteboard !== "function"){ say("화이트보드를 열 수 없어요."); return; }
    if (sendingToBoard) return; sendingToBoard = true;
    try {
      const png = await bracketRenderPng(model, { ratio:1.5 });
      const boardDoc = newWhiteboard({ name:bracketSafeName(model.title), state:{ version:1, savedAt:Date.now(), bg:typeof defaultBoardBg === "function" ? defaultBoardBg() : "#ffffff", items:[] } });
      if (typeof setActiveDoc === "function") setActiveDoc(boardDoc.id);
      if (typeof ensureRendered === "function") await ensureRendered(boardDoc);
      const placed = typeof boardDoc.insertBoardImage === "function" ? await boardDoc.insertBoardImage(png) : false;
      say(placed ? "대진표를 칠판으로 옮겼어요 — 그 위에 바로 판서할 수 있어요." : "칠판에 대진표를 넣지 못했어요.", 3000);
    } catch(error){ console.warn("대진표 칠판 보내기 실패:", error); say("칠판에 대진표를 넣지 못했어요.", 3000, { type:"error" }); }
    finally { sendingToBoard = false; }
  };
  const hasResults = () => Object.keys(model.results).some(key => model.results[key].winner);
  const guardResults = async message => !hasResults() || typeof confirmDialog !== "function" || await confirmDialog(message, "계속", "취소");
  /* 메뉴 조각 — ⋯ 메뉴와 오른쪽 클릭 메뉴가 같은 항목을 쓴다(한쪽만 고쳐 어긋나지 않게). */
  const backdropInput = document.createElement("input"); backdropInput.type = "file"; backdropInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"; backdropInput.hidden = true; root.appendChild(backdropInput);
  backdropInput.onchange = async () => {
    const file = backdropInput.files && backdropInput.files[0]; backdropInput.value = ""; if (!file) return;
    try { model.backdrop.image = await bracketPrepareBackdrop(file); model.theme = "custom"; changed(); } catch(_){ say("바탕 사진을 넣지 못했어요.", 3000, { type:"error" }); }
  };
  const setModel = (key, value, refit) => { if (model[key] === value) return; model[key] = value; if (refit) fitMode = true; changed(); };
  const pickItems = (pairs, key, refit) => pairs.map(([id, label]) => ({ label, active:model[key] === id, action:() => setModel(key, id, refit) }));
  const fitSize = () => bracketSizeFor(Math.max(2, model.entries.length));
  const sizeMenu = () => {
    const sizes = []; for (let n = fitSize(); n <= BRACKET_MAX_SIZE; n *= 2) sizes.push(n);
    return { label:"대진 크기", title:"몇 강 대진으로 할지 — 참가자보다 큰 칸은 부전승이 돼요", icon:"table", children:sizes.map(n => ({ label:bracketRoundLabel(n) + (n === fitSize() ? " (딱 맞게)" : ""), active:model.size === n,
      action:async () => { if (model.size === n) return; if (!await guardResults("대진 크기를 바꾸면 자리가 새로 짜여 지금까지의 결과가 지워져요. 계속할까요?")) return; const out = bracketResize(model, n); if (out){ fitMode = true; changed(); } } })) };
  };
  const shuffleItem = () => ({ label:"대진 새로 뽑기", title:"참가자를 무작위로 섞어 자리를 새로 정하기", icon:"shuffle", disabled:model.entries.length < 2,
    action:async () => { if (!await guardResults("새로 뽑으면 지금까지의 결과가 지워져요. 계속할까요?")) return; bracketShuffle(model); changed(); say("대진을 새로 뽑았어요. 되돌리려면 Ctrl+Z", 2600); } });
  const clearResultsItem = () => ({ label:"결과 모두 지우기", title:"참가자 자리는 그대로 두고 경기 결과만 처음으로", icon:"refresh", disabled:!Object.keys(model.results).length,
    action:async () => { if (typeof confirmDialog === "function" && !await confirmDialog("경기 결과를 모두 지울까요? 참가자 자리는 그대로예요.", "지우기", "취소")) return; bracketClearResults(model); changed(); } });
  const removeAllItem = () => ({ label:"참가자 모두 빼기", title:"빈 대진표로 되돌리기 (Ctrl+Z 로 되돌릴 수 있어요)", icon:"delete", disabled:!model.entries.length,
    action:async () => { if (typeof confirmDialog === "function" && !await confirmDialog(`참가자 ${model.entries.length}명과 결과를 모두 뺄까요?`, "모두 빼기", "취소")) return; model.entries = []; model.slots = model.slots.map(() => ""); model.results = {}; changed(); } });
  const scoreShowItem = () => ({ label:"점수 보이기", title:"카드에 경기 점수 표시", icon:"check", active:model.showScores, action:() => setModel("showScores", !model.showScores) });
  const scoreRuleMenu = () => ({ label:"점수로 이긴 쪽 정하기", icon:"list", children:pickItems([["high", "높은 점수가 이김"], ["low", "낮은 점수가 이김 (기록 경기)"]], "scoreRule") });
  const motionMenu = () => ({ label:"올라가는 움직임", icon:"play", children:pickItems(BRACKET_MOTION_LABELS, "motion") });
  const exportItems = () => [
    { label:"칠판으로", title:"대진표를 그림으로 굳혀 새 화이트보드에 넣기", icon:"board", action:sendToBoard },
    { label:"그림(PNG)으로 저장", title:"대진표 전체를 그림 한 장으로 저장", icon:"image", action:exportPng }
  ];
  const decorateItems = () => [
    { label:"배경 템플릿", icon:"image", children:BRACKET_THEMES.map(theme => ({ label:theme.label + (theme.id === "custom" && !model.backdrop.image ? " (사진 고르기…)" : ""), active:model.theme === theme.id,
      action:() => { if (theme.id === "custom" && !model.backdrop.image){ backdropInput.click(); return; } setModel("theme", theme.id); } })) },
    { label:model.backdrop.image ? "바탕 사진 바꾸기…" : "내 사진 바탕 고르기…", icon:"image", action:() => backdropInput.click() },
    ...(model.backdrop.image ? [
      { label:"바탕 사진 맞춤", icon:"move", disabled:model.theme !== "custom", children:[["cover", "가득 채우기"], ["contain", "전체 보이기"], ["tile", "바둑판"]].map(([id, label]) => ({ label, active:model.backdrop.fit === id, action:() => { if (model.backdrop.fit !== id){ model.backdrop.fit = id; changed(); } } })) },
      { label:"바탕 사진 흐리게", icon:"sun", disabled:model.theme !== "custom", children:[[0, "안 흐리게"], [0.25, "조금"], [0.45, "보통"], [0.65, "많이"]].map(([value, label]) => ({ label, active:Math.abs(model.backdrop.veil - value) < 0.01, action:() => { model.backdrop.veil = value; changed(); } })) },
      { label:"바탕 사진 빼기", icon:"delete", action:() => { model.backdrop.image = null; if (model.theme === "custom") model.theme = "classic"; changed(); } }
    ] : []),
    { separator:true },
    { label:"선 모양", icon:"graph", children:pickItems([["elbow", "꺾은선"], ["curve", "부드러운 곡선"]], "lineStyle") },
    { label:"카드 크기", icon:"view", children:pickItems([["s", "작게"], ["m", "보통"], ["l", "크게"]], "cardSize", true) },
    { separator:true },
    { label:"꾸미기 창 열기…", icon:"settings", action:openThemeDialog }
  ];
  const viewItems = () => [
    { label:"다시 보기", title:"정한 경기를 1회전부터 올라가는 모습으로 다시 보기", icon:"play", disabled:!hasResults(), action:startReplay },
    { label:"발표 (전체 화면)", title:"한 번 더 고르면 돌아와요", icon:"view", action:() => showBtn.click() },
    { separator:true },
    { label:"화면에 맞추기", icon:"move", active:fitMode, action:fitNow },
    { label:"실제 크기 (100%)", icon:"search", action:() => setZoom(1) },
    { label:"크게 보기", title:"Ctrl+휠로도 돼요", icon:"zoomIn", action:() => setZoom(zoom * 1.2) },
    { label:"작게 보기", title:"Ctrl+휠로도 돼요", icon:"zoomOut", action:() => setZoom(zoom / 1.2) },
    { separator:true },
    motionMenu()
  ];
  function toolMenuItems(){
    const full = model.entries.length >= BRACKET_MAX_SIZE;
    return [
      { label:"글로 참가자 넣기…", title:"이름을 한 줄에 하나씩 적어 한꺼번에 넣기", icon:"plus", disabled:full, action:openBulkDialog },
      { label:"사진 참가자 넣기…", title:"사진 여러 장을 한꺼번에 고르기 (끌어다 놓기·Ctrl+V 도 돼요)", icon:"image", disabled:full, action:() => fileInput.click() },
      { separator:true },
      { label:"모양", icon:"graph", children:[...BRACKET_LAYOUTS.map(layout => ({ label:layout.label, active:model.layout === layout.id, action:() => setModel("layout", layout.id, true) })), { separator:true }, { label:"그림 보며 고르기…", icon:"view", action:openLayoutDialog }] },
      { label:"꾸미기", icon:"sticker", children:decorateItems() },
      { label:"대진", icon:"table", children:[sizeMenu(), shuffleItem(), clearResultsItem(), { separator:true }, removeAllItem()] },
      { label:"점수", icon:"pen", children:[scoreShowItem(), ...scoreRuleMenu().children] },
      { label:"보기", icon:"view", children:viewItems() },
      { separator:true },
      { label:"실행 취소", title:"Ctrl+Z", icon:"undo", disabled:!history.canUndo(), action:() => history.undo() },
      { label:"다시 실행", title:"Ctrl+Y", icon:"redo", disabled:!history.canRedo(), action:() => history.redo() },
      { label:"제목 고치기", icon:"text", action:() => { titleInput.focus(); titleInput.select(); } },
      { separator:true },
      { label:"저장하기", title:"Ctrl+S", icon:"save", action:() => saveBracketDoc(doc) },
      ...exportItems()
    ];
  }
  function replayMenuItems(){
    if (!replay) return [];
    const items = replay.done ? [] : [
      { label:replay.paused ? "계속" : "멈춤", title:"Space", icon:replay.paused ? "play" : "pause", action:togglePause },
      { label:"다음 경기", title:"→ (멈춘 동안)", icon:"arrow", disabled:!replay.paused, action:stepOnce },
      { label:"끝으로", title:"모든 결과 바로 보기", icon:"check", action:() => stopReplay(false) }
    ];
    return [...items, { label:"처음부터 다시", icon:"refresh", action:startReplay }, { separator:true }, { label:"다시 보기 닫기", title:"Esc", icon:"close", action:() => stopReplay(false) }];
  }
  moreBtn.onclick = () => {
    if (typeof MNContextMenu === "undefined"){ exportPng(); return; }
    const rect = moreBtn.getBoundingClientRect(); moreBtn.classList.add("is-open");
    MNContextMenu.open(rect.right - 230, rect.bottom + 6, [
      sizeMenu(), shuffleItem(), clearResultsItem(),
      { separator:true },
      scoreShowItem(), scoreRuleMenu(), motionMenu(),
      { separator:true },
      ...exportItems(),
      { separator:true },
      removeAllItem()
    ], { base:"text-context", onClose:() => moreBtn.classList.remove("is-open") });
  };

  // 사진 파일을 이 화면에 끌어다 놓거나 붙여 넣으면 참가자로 들어간다.
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
    if (files.length){ event.preventDefault(); addImageFiles(files); }
  };
  document.addEventListener("paste", onPaste);

  const keydown = event => {
    if (doc.el.hidden || !doc.el.isConnected || document.querySelector(".tier-modal")) return;
    if (event.target && event.target.closest && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
    if (replay){
      if (event.key === "Escape"){ event.preventDefault(); stopReplay(false); return; }
      if (event.key === " "){ event.preventDefault(); togglePause(); return; }
      if (event.key === "ArrowRight"){ event.preventDefault(); if (!replay.paused) togglePause(); else stepOnce(); }
      return;
    }
    const key = String(event.key || "").toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (mod && key === "z"){ event.preventDefault(); event.shiftKey ? history.redo() : history.undo(); return; }
    if (mod && key === "y"){ event.preventDefault(); history.redo(); return; }
    if (event.key === "Escape" && traceId){ event.preventDefault(); setTrace(""); }
  };
  window.addEventListener("keydown", keydown);
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer); if (history) history.cancel(); stopReplay(true); cancelAnimationFrame(confettiFrame); animToken++;
    if (press && press.ghost) press.ghost.remove(); press = null; pan = null;
    window.removeEventListener("keydown", keydown); document.removeEventListener("paste", onPaste); if (viewObserver) viewObserver.disconnect();
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel);
    if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery; delete doc.bracketFocus; delete doc.bracketMarkSaved;
  });
  render(); touch();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = { BRACKET_DOC_TYPE, BRACKET_DOC_VERSION, BRACKET_MAX_SIZE, BRACKET_LAYOUTS, BRACKET_THEMES, bracketDocEmpty, bracketDocParse, bracketDocSerialize, bracketNormalizeEntry,
    bracketSeedOrder, bracketSeat, bracketSizeFor, bracketResolve, bracketMatchIndex, bracketPrune, bracketSetResult, bracketWinnerByScore, bracketClearResults, bracketAddEntries,
    bracketRemoveEntry, bracketResize, bracketSwapSlots, bracketShuffle, bracketDecidedOrder, bracketGeometry, bracketEdgePath, bracketRoundLabel, bracketSearchText, bracketScratchFileName };
}
