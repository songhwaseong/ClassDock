"use strict";

/* ===== 여행일지(.trip) =====
   한 파일 = 여행 한 건. 갈래(purpose)가 셋이지만 자료는 한 벌이다 — 개인 여행 기록(trip) ·
   체험학습 학습지(field) · 사회과 답사 보고서(survey). 갈래는 부르는 말과 기본값·접기만 바꾸고
   자료를 가르지 않는다. 그래서 갈래를 바꿔도 잃는 것이 없다(연대표 purpose 와 같은 방식).

   - 속은 일기장과 같은 무압축 ZIP: trip.json + assets/*(사진 바이트). ZIP·해시·사진 줄이기·스티커
     정규화는 일기장 것을 그대로 부른다(전역 스크립트라 바로 쓸 수 있다).
   - 하루(day)는 일기장의 하루와 같은 모양이다(글·꾸미기·스티커·그림). 여기에 장소(spots)가 얹힌다.
   - 장소는 스티커와 따로 둔다 — 지도·일정·경비 세 곳이 같은 자료를 읽기 때문이다.
   - 설계: docs/여행일지-설계.md */

const TRIP_FORMAT = "classdock-trip";
const TRIP_VERSION = 1;
const TRIP_JSON_NAME = "trip.json";
const TRIP_MAX_DAYS = 400;
const TRIP_MAX_SPOTS = 60;            // 하루에 들를 곳
const TRIP_MAX_PROMPTS = 20;          // 하루에 물을 것(학습지)
const TRIP_MAX_FIELDS = 12;           // 지점 하나의 조사 항목(답사)
const TRIP_MAX_HEADER = 8;            // 인쇄 머리의 자유 칸
const TRIP_ASSET_RE = /^assets\/[a-z0-9_-]{4,64}\.(png|jpe?g|webp|gif)$/;

/* ---------- 갈래 ---------- */

const TRIP_PURPOSES = ["trip", "field", "survey"];
function tripPurpose(raw){ return TRIP_PURPOSES.includes(raw) ? raw : "trip"; }
function tripPurposeAt(purpose){ return Math.max(0, TRIP_PURPOSES.indexOf(tripPurpose(purpose))); }

/* 갈래마다 갈리는 말은 여기 한 표에 모은다. 값은 [여행, 학습지, 답사] 차례이고 빈 문자열은
   '그 갈래에서는 감춤'이다. 짧은 말을 앱 공용 사전(i18n.js)에 넣으면 다른 화면의 같은 글자까지
   바뀐다(일기장 3단계에서 값을 치른 함정) — 그래서 영어도 여기 함께 둔다. */
const TRIP_WORDS = {
  docName:      ["여행일지", "체험학습 보고서", "답사 보고서"],
  newDoc:       ["새 여행일지", "새 체험학습 보고서", "새 답사 보고서"],
  titleHint:    ["여행 제목", "체험학습 제목", "답사 주제"],
  fileBase:     ["여행일지", "체험학습", "답사"],
  purposeLabel: ["문서 갈래", "문서 갈래", "문서 갈래"],

  day:          ["첫째 날", "활동", "조사 차례"],
  dayNth:       ["{n}째 날", "활동 {n}", "{n}차 조사"],
  dayAdd:       ["＋ 날", "＋ 활동", "＋ 조사 차례"],
  dayTitleHint: ["그날 제목", "활동 이름", "조사 차례 제목"],
  dayCount:     ["{n}일", "활동 {n}개", "조사 {n}차례"],
  dayDelete:    ["이 날 지우기", "이 활동 지우기", "이 차례 지우기"],
  dayEmpty:     ["아직 쓴 것이 없어요", "아직 쓴 것이 없어요", "아직 쓴 것이 없어요"],

  spot:         ["들른 곳", "장소", "조사 지점"],
  spotAdd:      ["＋ 들른 곳", "＋ 장소", "＋ 조사 지점"],
  spotList:     ["들른 곳 목록", "장소 목록", "조사 지점 목록"],
  spotNameHint: ["장소 이름", "장소 이름", "지점 이름"],
  spotAt:       ["들른 시각", "시각", "조사 시각"],
  spotNote:     ["메모", "본 것", "관찰 기록"],
  spotKindLabel:["종류", "활동 종류", "지점 성격"],
  spotSearchHint:["이름·주소·메모 검색", "이름·주소·본 것 검색", "이름·주소·관찰 검색"],
  spotEmpty:    ["들른 곳이 아직 없어요", "장소가 아직 없어요", "조사 지점이 아직 없어요"],

  mapPane:      ["동선", "위치", "조사 범위"],
  route:        ["다닌 길", "이동 경로", "조사 동선"],
  mapStill:     ["지도 그림으로 굳히기", "지도 그림으로 굳히기", "지도 그림으로 굳히기"],
  mapEmpty:     ["장소에 좌표가 없어요", "장소에 좌표가 없어요", "장소에 좌표가 없어요"],
  choro:        ["다녀온 지역", "", "조사 지역 분포"],

  paper:        ["종이", "종이", "종이"],
  sticker:      ["스티커", "스티커", "스티커"],
  photo:        ["사진", "사진", "사진"],
  draw:         ["그리기", "그리기", "그리기"],
  decorate:     ["꾸미기", "꾸미기", "꾸미기"],

  prompts:      ["", "질문", ""],
  promptAnswer: ["", "답", ""],
  cost:         ["쓴 돈", "", ""],
  costTotal:    ["이 날 {sum}", "", ""],
  fields:       ["", "", "조사 항목"],
  source:       ["", "", "자료 출처"],

  printDay:     ["이 날만 인쇄", "이 활동만 인쇄", "이 차례만 인쇄"],
  printAll:     ["여행 전체 인쇄", "보고서 전체 인쇄", "답사 전체 인쇄"],
  exportTimeline:["일정으로 내보내기", "일정으로 내보내기", "일정으로 내보내기"],
  exportMap:    ["지도로 내보내기", "지도로 내보내기", "지도로 내보내기"]
};

const TRIP_WORDS_EN = {
  docName:      ["Travel journal", "Field trip report", "Fieldwork report"],
  newDoc:       ["New travel journal", "New field trip report", "New fieldwork report"],
  titleHint:    ["Trip title", "Field trip title", "Fieldwork topic"],
  fileBase:     ["Travel journal", "Field trip", "Fieldwork"],
  purposeLabel: ["Document type", "Document type", "Document type"],

  day:          ["Day", "Activity", "Visit"],
  dayNth:       ["Day {n}", "Activity {n}", "Visit {n}"],
  dayAdd:       ["+ Day", "+ Activity", "+ Visit"],
  dayTitleHint: ["Day title", "Activity name", "Visit title"],
  dayCount:     ["{n} days", "{n} activities", "{n} visits"],
  dayDelete:    ["Delete day", "Delete activity", "Delete visit"],
  dayEmpty:     ["Nothing written yet", "Nothing written yet", "Nothing written yet"],

  spot:         ["Place", "Place", "Site"],
  spotAdd:      ["+ Place", "+ Place", "+ Site"],
  spotList:     ["Places", "Places", "Sites"],
  spotNameHint: ["Place name", "Place name", "Site name"],
  spotAt:       ["Time", "Time", "Time surveyed"],
  spotNote:     ["Note", "What I saw", "Observation"],
  spotKindLabel:["Kind", "Activity kind", "Site type"],
  spotSearchHint:["Search name, address, note", "Search name, address, notes", "Search name, address, observations"],
  spotEmpty:    ["No places yet", "No places yet", "No sites yet"],

  mapPane:      ["Route", "Location", "Survey area"],
  route:        ["Trail", "Route", "Survey path"],
  mapStill:     ["Freeze map image", "Freeze map image", "Freeze map image"],
  mapEmpty:     ["No coordinates yet", "No coordinates yet", "No coordinates yet"],
  choro:        ["Regions visited", "", "Region distribution"],

  paper:        ["Paper", "Paper", "Paper"],
  sticker:      ["Sticker", "Sticker", "Sticker"],
  photo:        ["Photo", "Photo", "Photo"],
  draw:         ["Draw", "Draw", "Draw"],
  decorate:     ["Decorate", "Decorate", "Decorate"],

  prompts:      ["", "Questions", ""],
  promptAnswer: ["", "Answer", ""],
  cost:         ["Spending", "", ""],
  costTotal:    ["Day total {sum}", "", ""],
  fields:       ["", "", "Survey items"],
  source:       ["", "", "Sources"],

  printDay:     ["Print this day", "Print this activity", "Print this visit"],
  printAll:     ["Print all", "Print all", "Print all"],
  exportTimeline:["Export as timeline", "Export as timeline", "Export as timeline"],
  exportMap:    ["Export as map", "Export as map", "Export as map"]
};

function tripIsEn(){ return typeof MNI18N !== "undefined" && !!MNI18N && MNI18N.lang === "en"; }
function tripT(ko){ return (typeof window !== "undefined" && typeof window.t === "function") ? window.t(ko) : ko; }
function tripTf(tmpl, vars){
  if (typeof window !== "undefined" && typeof window.tf === "function") return window.tf(tmpl, vars);
  return String(tmpl).replace(/\{(\w+)\}/g, (whole, key) => (vars && vars[key] != null ? String(vars[key]) : whole));
}

/* 갈래의 낱말 하나. 빈 문자열이면 '그 갈래에는 없는 것'이라 부르는 쪽이 단추를 감춘다. */
function tripWord(purpose, id){
  const at = tripPurposeAt(purpose);
  const table = tripIsEn() ? TRIP_WORDS_EN : TRIP_WORDS;
  const row = table[id] || TRIP_WORDS[id];
  if (!row) return "";
  return row[at] == null ? "" : row[at];
}
/* 낱말이 아니라 틀인 것({n}·{sum}) — 한국어는 "첫째 날"·"3일"인데 영어는 "Day 1"·"3 days"라
   자리만 바꿔서는 안 된다. */
function tripWordf(purpose, id, vars){
  return String(tripWord(purpose, id)).replace(/\{(\w+)\}/g, (whole, key) =>
    (vars && vars[key] != null ? String(vars[key]) : whole));
}
function tripHasWord(purpose, id){ return !!tripWord(purpose, id); }

/* ---------- 장소의 종류 ---------- */

/* [id, 아이콘(DIARY_ART 에 이미 있는 것), 기본 색, 한국어 [여행,학습지,답사], 영어]
   저장되는 값은 세 갈래의 합집합이다. 갈래는 고르개에 무엇을 보일지만 정하고, 다른 갈래에서 고른
   값이 들어 있어도 버리지 않는다(tripSpotKindInfo 가 찾아 주고 고르개는 맨 아래에 덧붙인다).
   색은 표식이 아니라 처음 찍힐 때의 기본값일 뿐이다 — 지도 표시 색이 여섯뿐이라 한 갈래(일곱)를
   다 가를 수 없다. 구분은 아이콘이 한다. */
const TRIP_SPOT_KINDS = [
  ["sight",     "mountain",  "blue",   ["볼거리", "견학", "지형·시설"],   ["Sight", "Tour", "Landform"]],
  ["food",      "hamburger", "amber",  ["먹을거리", "식사", ""],          ["Food", "Meal", ""]],
  ["stay",      "house",     "purple", ["잠자리", "", ""],                ["Stay", "", ""]],
  ["move",      "train",     "slate",  ["이동", "이동", "이동"],          ["Transport", "Transport", "Transport"]],
  ["shop",      "gift",      "red",    ["가게", "", ""],                  ["Shop", "", ""]],
  ["activity",  "soccer",    "green",  ["놀거리", "체험", ""],            ["Activity", "Hands-on", ""]],
  ["rest",      "coffee",    "green",  ["쉼터", "자유 시간", ""],         ["Rest", "Free time", ""]],
  ["base",      "flag",      "red",    ["", "모임·집합", "거점"],         ["", "Meeting point", "Base"]],
  ["safety",    "bell",      "purple", ["", "안전 지점", ""],             ["", "Safety point", ""]],
  ["observe",   "magnifier", "blue",   ["", "", "관찰·기록"],             ["", "", "Observation"]],
  ["interview", "speech",    "purple", ["", "", "면담"],                  ["", "", "Interview"]],
  ["measure",   "ruler",     "amber",  ["", "", "측정"],                  ["", "", "Measurement"]],
  ["collect",   "backpack",  "green",  ["", "", "채집"],                  ["", "", "Collection"]]
];
const TRIP_SPOT_KIND_IDS = TRIP_SPOT_KINDS.map(k => k[0]);
function tripSpotKindInfo(id){ return TRIP_SPOT_KINDS.find(k => k[0] === id) || null; }
/* 그 갈래의 고르개에 뜰 것만. 지금 값이 목록에 없으면 부르는 쪽이 맨 아래에 그 값을 덧붙인다. */
function tripSpotKinds(purpose){
  const at = tripPurposeAt(purpose);
  return TRIP_SPOT_KINDS.filter(k => k[3][at]);
}
function tripSpotKindName(purpose, id){
  const info = tripSpotKindInfo(id);
  if (!info) return "";
  const at = tripPurposeAt(purpose);
  const row = tripIsEn() ? info[4] : info[3];
  // 다른 갈래에서 고른 값이면 그 갈래의 이름으로라도 보여 준다 — 버리는 것보다 낫다.
  return row[at] || row.find(Boolean) || "";
}
function tripSpotKindIcon(id){ const info = tripSpotKindInfo(id); return info ? info[1] : ""; }
function tripSpotKindColor(id){ const info = tripSpotKindInfo(id); return info ? info[2] : "blue"; }

/* ---------- 모델 ---------- */

function tripSpotId(){ return "sp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function tripDayId(){ return "dy-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

function tripIsDateKey(value){
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00");
  return !Number.isNaN(d.getTime()) && value === [d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
// "09:30" 만 받는다. 시각은 정렬과 인쇄에만 쓰므로 비어 있어도 된다.
function tripNormalizeTime(raw){
  const text = String(raw == null ? "" : raw).trim();
  const m = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return "";
  return String(h).padStart(2, "0") + ":" + m[2];
}
function tripClampLat(v){ const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= 85 ? n : null; }
function tripClampLng(v){ const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= 180 ? n : null; }

function tripNormalizeCost(raw){
  if (!raw || typeof raw !== "object") return null;
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const currency = String(raw.currency || "KRW").trim().toUpperCase().slice(0, 3);
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  return { amount:Math.round(amount * 100) / 100, currency };
}
// 자유 항목(답사 조사 항목)과 인쇄 머리 칸은 같은 모양이다 — 이름과 값 한 쌍.
function tripNormalizePairs(raw, max){
  return (Array.isArray(raw) ? raw : []).slice(0, max)
    .map(item => item && typeof item === "object"
      ? { k:String(item.k == null ? "" : item.k).trim().slice(0, 40), v:String(item.v == null ? "" : item.v).slice(0, 300) }
      : null)
    .filter(item => item && (item.k || item.v));
}
function tripNormalizePrompts(raw){
  return (Array.isArray(raw) ? raw : []).slice(0, TRIP_MAX_PROMPTS)
    .map(item => item && typeof item === "object"
      ? { q:String(item.q == null ? "" : item.q).slice(0, 300), a:String(item.a == null ? "" : item.a).slice(0, 2000) }
      : null)
    .filter(item => item && (item.q.trim() || item.a.trim()));
}

function tripNormalizeSpot(raw, hasAsset){
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name == null ? "" : raw.name).trim().slice(0, 120);
  const address = String(raw.address == null ? "" : raw.address).trim().slice(0, 300);
  const note = String(raw.note == null ? "" : raw.note).slice(0, 2000);
  const photos = (Array.isArray(raw.photos) ? raw.photos : [])
    .filter(n => typeof n === "string" && TRIP_ASSET_RE.test(n) && (!hasAsset || hasAsset(n))).slice(0, 12);
  const fields = tripNormalizePairs(raw.fields, TRIP_MAX_FIELDS);
  const cost = tripNormalizeCost(raw.cost);
  // 이름도 주소도 좌표도 없고 적은 것도 없으면 자리만 차지하는 줄이다.
  const lat = tripClampLat(raw.lat), lng = tripClampLng(raw.lng);
  if (!name && !address && lat == null && !note && !cost && !photos.length && !fields.length) return null;
  return {
    id:String(raw.id || "") || tripSpotId(),
    at:tripNormalizeTime(raw.at),
    name, address, note,
    // 모르는 종류도 버리지 않는다 — 갈래를 바꿨다고 값이 사라지면 무손실 규칙이 깨진다.
    kind:typeof raw.kind === "string" ? raw.kind.trim().slice(0, 24) : "",
    lat, lng:lat == null ? null : lng,
    color:String(raw.color || "").trim().slice(0, 12) || "",
    cost, photos, fields
  };
}

function tripNormalizeDay(raw, hasAsset){
  if (!raw || typeof raw !== "object") return null;
  const stickers = typeof diaryNormalizeSticker === "function"
    ? (Array.isArray(raw.stickers) ? raw.stickers : []).map(s => diaryNormalizeSticker(s, hasAsset)).filter(Boolean)
    : [];
  const drawing = typeof diaryNormalizeStroke === "function"
    ? (Array.isArray(raw.drawing) ? raw.drawing : []).map(diaryNormalizeStroke).filter(Boolean)
    : [];
  const spots = (Array.isArray(raw.spots) ? raw.spots : []).slice(0, TRIP_MAX_SPOTS)
    .map(s => tripNormalizeSpot(s, hasAsset)).filter(Boolean);
  const ids = new Set();
  for (const s of spots){ if (ids.has(s.id)) s.id = tripSpotId(); ids.add(s.id); }
  const still = typeof raw.still === "string" && TRIP_ASSET_RE.test(raw.still) && (!hasAsset || hasAsset(raw.still))
    ? raw.still : "";
  return {
    id:String(raw.id || "") || tripDayId(),
    // 날짜는 있어도 되고 없어도 된다 — 학습지·답사는 "활동 1"처럼 날짜 없이 쓰기도 한다.
    date:tripIsDateKey(raw.date) ? raw.date : "",
    title:String(raw.title == null ? "" : raw.title).slice(0, 200),
    text:String(raw.text == null ? "" : raw.text).replace(/\r\n?/g, "\n"),
    style:raw.style && typeof raw.style === "object" && typeof diaryNormalizeStyle === "function"
      ? diaryNormalizeStyle(raw.style, hasAsset) : null,
    weather:typeof diaryWeatherInfo === "function" && diaryWeatherInfo(raw.weather) ? raw.weather : "",
    mood:typeof diaryMoodInfo === "function" && diaryMoodInfo(raw.mood) ? raw.mood : "",
    favorite:!!raw.favorite,
    tags:typeof diaryNormalizeTags === "function" ? diaryNormalizeTags(raw.tags) : [],
    drawing, stickers, spots,
    prompts:tripNormalizePrompts(raw.prompts),
    still,
    stillKey:still ? String(raw.stillKey == null ? "" : raw.stillKey).slice(0, 200) : ""
  };
}

function tripDayIsEmpty(day){
  return !day || (!String(day.title || "").trim() && !String(day.text || "").trim()
    && !(day.spots && day.spots.length) && !(day.stickers && day.stickers.length)
    && !(day.drawing && day.drawing.length) && !(day.prompts && day.prompts.length)
    && !day.style && !day.weather && !day.mood && !day.favorite && !day.still
    && !(day.tags && day.tags.length) && !day.date);
}

function tripNormalizeMap(raw, hasAsset){
  const value = raw && typeof raw === "object" ? raw : {};
  const lat = tripClampLat(Array.isArray(value.center) ? value.center[0] : null);
  const lng = tripClampLng(Array.isArray(value.center) ? value.center[1] : null);
  const zoom = Number(value.zoom);
  const still = typeof value.still === "string" && TRIP_ASSET_RE.test(value.still) && (!hasAsset || hasAsset(value.still))
    ? value.still : "";
  return {
    basemap:String(value.basemap || "osm").trim().slice(0, 20) || "osm",
    center:lat == null || lng == null ? null : [lat, lng],
    zoom:Number.isFinite(zoom) && zoom >= 1 && zoom <= 19 ? Math.round(zoom) : 9,
    route:value.route !== false,
    still,
    stillKey:still ? String(value.stillKey == null ? "" : value.stillKey).slice(0, 200) : ""
  };
}
function tripNormalizeBudget(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  const currency = String(value.currency || "KRW").trim().toUpperCase().slice(0, 3);
  const rate = Number(value.rate);
  return {
    currency:/^[A-Z]{3}$/.test(currency) ? currency : "KRW",
    rate:Number.isFinite(rate) && rate > 0 ? rate : null
  };
}

function tripEmpty(title, purpose){
  const now = Date.now();
  const kind = tripPurpose(purpose);
  return {
    format:TRIP_FORMAT, version:TRIP_VERSION,
    title:String(title || tripWord(kind, "docName")).slice(0, 200),
    createdAt:now, updatedAt:now,
    purpose:kind,
    style:typeof diaryDefaultStyle === "function" ? diaryDefaultStyle() : null,
    printPlain:false,
    header:[],
    map:tripNormalizeMap(null),
    budget:tripNormalizeBudget(null),
    source:"",
    days:[]
  };
}

function tripNormalize(raw, hasAsset){
  if (!raw || typeof raw !== "object" || raw.format !== TRIP_FORMAT) throw new Error("trip-format");
  // 모르는 판은 거절한다 — 모르는 값을 기본값으로 바꾼 채 덮어써서 자료를 잃는 것보다 낫다.
  if (!(Number(raw.version) >= 1 && Number(raw.version) <= TRIP_VERSION)) throw new Error("trip-version");
  const purpose = tripPurpose(raw.purpose);
  const days = [];
  const ids = new Set();
  for (const item of (Array.isArray(raw.days) ? raw.days : []).slice(0, TRIP_MAX_DAYS)){
    const day = tripNormalizeDay(item, hasAsset);
    if (!day || tripDayIsEmpty(day)) continue;
    if (ids.has(day.id)) day.id = tripDayId();
    ids.add(day.id);
    days.push(day);
  }
  return {
    format:TRIP_FORMAT, version:TRIP_VERSION,
    title:String(raw.title || tripWord(purpose, "docName")).slice(0, 200),
    createdAt:Number(raw.createdAt) || Date.now(),
    updatedAt:Number(raw.updatedAt) || Date.now(),
    purpose,
    style:typeof diaryNormalizeStyle === "function" ? diaryNormalizeStyle(raw.style, hasAsset) : null,
    printPlain:!!raw.printPlain,
    header:tripNormalizePairs(raw.header, TRIP_MAX_HEADER),
    map:tripNormalizeMap(raw.map, hasAsset),
    budget:tripNormalizeBudget(raw.budget),
    source:String(raw.source == null ? "" : raw.source).slice(0, 1000),
    days
  };
}

/* ---------- 저장할 모양 ---------- */

function tripCleanSpot(s){
  const out = { id:s.id, name:s.name || "", address:s.address || "", note:s.note || "", kind:s.kind || "" };
  if (s.at) out.at = s.at;
  if (s.lat != null && s.lng != null){ out.lat = s.lat; out.lng = s.lng; }
  if (s.color) out.color = s.color;
  if (s.cost) out.cost = s.cost;
  if (s.photos && s.photos.length) out.photos = s.photos.slice();
  if (s.fields && s.fields.length) out.fields = s.fields.map(f => ({ k:f.k, v:f.v }));
  return out;
}
function tripCleanDays(model){
  return (model.days || []).filter(d => !tripDayIsEmpty(d)).map(d => {
    const out = {
      id:d.id, date:d.date || "", title:d.title || "", text:d.text || "",
      style:d.style || null, weather:d.weather || "", mood:d.mood || "",
      favorite:!!d.favorite,
      tags:typeof diaryNormalizeTags === "function" ? diaryNormalizeTags(d.tags) : (d.tags || []),
      drawing:(d.drawing || []).map(st => st.e ? { c:st.c, w:st.w, p:st.p, e:true } : { c:st.c, w:st.w, p:st.p }),
      stickers:typeof diaryCleanSticker === "function"
        ? (d.stickers || []).map(diaryCleanSticker).filter(Boolean) : [],
      spots:(d.spots || []).map(tripCleanSpot)
    };
    if (d.prompts && d.prompts.length) out.prompts = d.prompts.map(p => ({ q:p.q, a:p.a }));
    if (d.still){ out.still = d.still; out.stillKey = d.stillKey || ""; }
    return out;
  });
}
function tripModelJson(model){
  return JSON.stringify({
    format:TRIP_FORMAT, version:TRIP_VERSION,
    title:model.title || "", createdAt:model.createdAt || Date.now(), updatedAt:model.updatedAt || Date.now(),
    purpose:tripPurpose(model.purpose),
    style:model.style, printPlain:!!model.printPlain,
    header:tripNormalizePairs(model.header, TRIP_MAX_HEADER),
    map:model.map, budget:model.budget, source:model.source || "",
    days:tripCleanDays(model)
  });
}
/* 저장본과 같은지 가르는 열쇠 — 시각(updatedAt)은 뺀다. 저장 → 편집 → 되돌리기 뒤 다시 '깨끗'이
   되어야 하기 때문이다(일기장과 같은 규칙). */
function tripContentKey(model){
  return JSON.stringify({
    title:model.title || "", purpose:tripPurpose(model.purpose),
    style:model.style, printPlain:!!model.printPlain,
    header:tripNormalizePairs(model.header, TRIP_MAX_HEADER),
    map:model.map, budget:model.budget, source:model.source || "",
    days:tripCleanDays(model)
  });
}

/* 모델이 실제로 가리키는 사진만 저장한다. 굳힌 지도 그림도 여기 들어가야 한다 —
   빠뜨리면 다음 저장에서 조용히 사라진다(일기장이 스티커 갈래마다 겪은 함정). */
function tripReferencedAssets(model){
  const used = new Set();
  const add = name => { if (typeof name === "string" && TRIP_ASSET_RE.test(name)) used.add(name); };
  add(model.style && model.style.bg);
  add(model.map && model.map.still);
  for (const day of (model.days || [])){
    add(day.style && day.style.bg);
    add(day.still);
    for (const s of (day.stickers || [])) add(s.asset);
    for (const s of (day.spots || [])) for (const p of (s.photos || [])) add(p);
  }
  return used;
}

function tripPack(model, assets, now){
  const json = tripModelJson({ ...model, updatedAt:now == null ? Date.now() : Number(now) });
  const files = [{ name:TRIP_JSON_NAME, bytes:new TextEncoder().encode(json) }];
  for (const name of [...tripReferencedAssets(model)].sort()){
    const asset = assets && assets.get(name);
    if (!asset || !asset.bytes) continue;
    if (asset.crc === undefined) asset.crc = diaryCrc32(asset.bytes);
    files.push({ name, bytes:asset.bytes, crc:asset.crc });
  }
  return diaryZipBuild(files, now == null ? undefined : now);
}
async function tripUnpack(bytes){
  const files = await diaryZipRead(bytes);
  const jsonBytes = files.get(TRIP_JSON_NAME);
  if (!jsonBytes) throw new Error("trip-format");
  const assets = new Map();
  for (const [name, data] of files){
    if (TRIP_ASSET_RE.test(name)) assets.set(name, { bytes:data });
  }
  const model = tripNormalize(JSON.parse(new TextDecoder("utf-8").decode(jsonBytes)), name => assets.has(name));
  const used = tripReferencedAssets(model);
  for (const name of [...assets.keys()]) if (!used.has(name)) assets.delete(name);
  return { model, assets };
}

/* ---------- 국내·해외 ---------- */

/* 좌표가 있는 장소로 정한다. 하나도 없으면 국내로 본다 — 주소만 적은 문서가 흔하고
   학습지·답사는 사실상 국내다. 판정은 여기 한 곳에서만 한다(단추마다 따로 재면 어떤 단추는
   감춰지고 어떤 단추는 남는다). */
function tripIsDomestic(model){
  const inKorea = typeof MNKoreaCoords !== "undefined" && MNKoreaCoords
    ? p => MNKoreaCoords.inKorea(p)
    : p => p[0] >= 32.8 && p[0] <= 38.9 && p[1] >= 124 && p[1] <= 132.2;
  let seen = 0, home = 0;
  for (const day of (model && model.days) || []){
    for (const s of (day.spots || [])){
      if (s.lat == null || s.lng == null) continue;
      seen++;
      if (inKorea([s.lat, s.lng])) home++;
    }
  }
  return seen === 0 || home * 2 >= seen;
}

/* ---------- 새 문서 ---------- */

let _tripScratchCount = 0;
function tripScratchFileName(purpose, n){
  const base = TRIP_WORDS.fileBase[tripPurposeAt(purpose)];
  return (n && n > 1 ? base + " " + n : base) + ".trip";
}
function tripStarterBytes(name, purpose){
  const title = String(name || "").replace(/\.trip$/i, "") || TRIP_WORDS.docName[tripPurposeAt(purpose)];
  return tripPack(tripEmpty(title, purpose), new Map());
}
function newTripScratch(purpose){
  const kind = tripPurpose(purpose);
  _tripScratchCount++;
  const name = tripScratchFileName(kind, _tripScratchCount);
  if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([tripStarterBytes(name, kind)], name, { type:"application/zip" })],
    { isScratch:true }));
}
function newTripScratchInFolder(folder, purpose){
  if (typeof createScratchInFolder !== "function") return false;
  const kind = tripPurpose(purpose);
  // 폴더에서 만들 때는 갈래를 물을 수 없다 — makeContent 가 동기여야 하기 때문이다(code-viewer.js).
  // 기본 갈래로 만들고 도구막대에서 바꾸게 한다. 갈래 전환이 무손실이라 잃는 것이 없다.
  return createScratchInFolder(folder, n => tripScratchFileName(kind, n),
    name => tripStarterBytes(name, kind), "application/zip", "새 여행일지를");
}

/* ---------- 사진에서 찍은 때·자리 읽기(EXIF) ----------
   여행일지의 절반은 사진이 이미 알고 있다 — 언제 어디서 찍었는지. 다만 읽을 자리가 까다롭다.
   - 사진을 넣을 때 줄여 다시 굽는 길(diaryPrepareImage)을 지나면 EXIF 가 통째로 날아간다.
     그래서 **굽기 전 원본 바이트**에서 읽어야 한다.
   - 메신저로 받은 사진은 보낸 쪽이 EXIF 를 지워서 아무것도 없는 것이 정상이다.
   - GPS 는 개인정보다. 집 근처 사진 한 장이 주소를 드러낸다 — 그래서 저절로 읽지 않고,
     사용자가 '사진에서 장소'를 눌렀을 때만 읽는다. */

const TRIP_EXIF_MAX_SCAN = 512 * 1024;      // 앞부분만 본다(EXIF 는 파일 머리에 있다)

function tripExifRational(view, at, little){
  const num = view.getUint32(at, little), den = view.getUint32(at + 4, little);
  return den ? num / den : 0;
}
/* 도·분·초 세 쌍을 도(度)로. 남/서면 음수. */
function tripExifDegrees(view, at, little, ref){
  const d = tripExifRational(view, at, little);
  const m = tripExifRational(view, at + 8, little);
  const s = tripExifRational(view, at + 16, little);
  const value = d + m / 60 + s / 3600;
  if (!Number.isFinite(value)) return null;
  return (ref === "S" || ref === "W") ? -value : value;
}
/* "2026:07:20 09:30:11" → { date:"2026-07-20", at:"09:30" } */
function tripExifWhen(text){
  const m = String(text || "").match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const date = m[1] + "-" + m[2] + "-" + m[3];
  return tripIsDateKey(date) ? { date, at:m[4] + ":" + m[5] } : null;
}

/* JPEG 바이트에서 찍은 때와 자리를 읽는다. 못 읽으면 빈 값을 돌려준다(던지지 않는다) —
   사진 한 장이 이상해서 나머지가 안 붙으면 안 된다. */
function tripReadExif(bytes){
  const empty = { date:"", at:"", lat:null, lng:null };
  try {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (data.length < 16 || data[0] !== 0xFF || data[1] !== 0xD8) return empty;   // JPEG 가 아니다
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 2;
    const limit = Math.min(data.length, TRIP_EXIF_MAX_SCAN);
    while (at + 4 <= limit){
      if (view.getUint8(at) !== 0xFF) break;
      const marker = view.getUint8(at + 1);
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)){ at += 2; continue; }
      if (marker === 0xDA) break;                       // 그림 자료가 시작된다
      const size = view.getUint16(at + 2, false);
      if (size < 2) break;
      if (marker === 0xE1 && at + 4 + 6 <= limit){
        const tag = String.fromCharCode(...data.slice(at + 4, at + 8));
        if (tag === "Exif") return tripReadExifTiff(view, at + 10, Math.min(at + 2 + size, limit)) || empty;
      }
      at += 2 + size;
    }
  } catch(error){ console.warn("EXIF 를 읽지 못했어요:", error); }
  return empty;
}

function tripReadExifTiff(view, start, end){
  const out = { date:"", at:"", lat:null, lng:null };
  if (start + 8 > end) return out;
  const order = view.getUint16(start, false);
  if (order !== 0x4949 && order !== 0x4D4D) return out;
  const little = order === 0x4949;
  if (view.getUint16(start + 2, little) !== 42) return out;
  const ifd0 = start + view.getUint32(start + 4, little);

  const readEntries = (base, onEntry) => {
    if (base + 2 > end) return;
    const count = view.getUint16(base, little);
    if (count > 512) return;                       // 손으로 고친 파일 방어
    for (let i = 0; i < count; i++){
      const at = base + 2 + i * 12;
      if (at + 12 > end) return;
      onEntry(view.getUint16(at, little), view.getUint16(at + 2, little), view.getUint32(at + 4, little), at + 8);
    }
  };
  const asciiAt = (offset, length) => {
    const from = start + offset;
    if (from + length > end) return "";
    let text = "";
    for (let i = 0; i < length; i++){
      const code = view.getUint8(from + i);
      if (!code) break;
      text += String.fromCharCode(code);
    }
    return text;
  };

  let exifIfd = 0, gpsIfd = 0;
  readEntries(ifd0, (tag, type, count, valueAt) => {
    if (tag === 0x8769) exifIfd = start + view.getUint32(valueAt, little);
    else if (tag === 0x8825) gpsIfd = start + view.getUint32(valueAt, little);
    else if (tag === 0x0132 && type === 2 && count <= 32 && !out.date){    // DateTime(찍은 때가 없을 때의 보루)
      const when = tripExifWhen(asciiAt(view.getUint32(valueAt, little), count));
      if (when){ out.date = when.date; out.at = when.at; }
    }
  });
  if (exifIfd) readEntries(exifIfd, (tag, type, count, valueAt) => {
    if ((tag === 0x9003 || tag === 0x9004) && type === 2 && count <= 32){   // DateTimeOriginal/Digitized
      const when = tripExifWhen(asciiAt(view.getUint32(valueAt, little), count));
      if (when && (tag === 0x9003 || !out.date)){ out.date = when.date; out.at = when.at; }
    }
  });
  if (gpsIfd){
    let latRef = "", lngRef = "", latAt = 0, lngAt = 0;
    readEntries(gpsIfd, (tag, type, count, valueAt) => {
      if (tag === 0x0001 && type === 2) latRef = asciiAt(valueAt - start, 2).trim().toUpperCase();
      else if (tag === 0x0003 && type === 2) lngRef = asciiAt(valueAt - start, 2).trim().toUpperCase();
      else if (tag === 0x0002 && type === 5 && count === 3) latAt = start + view.getUint32(valueAt, little);
      else if (tag === 0x0004 && type === 5 && count === 3) lngAt = start + view.getUint32(valueAt, little);
    });
    if (latAt && lngAt && latAt + 24 <= end && lngAt + 24 <= end){
      const lat = tripExifDegrees(view, latAt, little, latRef);
      const lng = tripExifDegrees(view, lngAt, little, lngRef);
      if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)){
        out.lat = Math.round(lat * 1e6) / 1e6;
        out.lng = Math.round(lng * 1e6) / 1e6;
      }
    }
  }
  return out;
}

/* ---------- 문서 열고 닫기 ---------- */

function tripAttachDoc(doc, unpacked){
  doc.trip = unpacked.model;
  doc.tripAssets = unpacked.assets;
  doc.savedText = tripContentKey(unpacked.model);
  doc.render = async () => {
    if (doc._tripMounted) return;               // 편집 상태를 잃지 않도록 한 번만 마운트
    doc._tripMounted = true;
    doc.el.innerHTML = "";
    mountTripEditor(doc);
  };
}

async function loadTrip(file, opts = {}){
  const bytes = new Uint8Array(await file.arrayBuffer());
  let unpacked;
  try { unpacked = await tripUnpack(bytes); }
  catch(error){
    console.warn("trip open failed:", error);
    if (typeof toast === "function") toast(tripT("여행일지(.trip)를 읽지 못했어요. 파일이 손상됐을 수 있어요."), 4200, { type:"error" });
    return null;
  }
  const doc = makeDoc("trip", file.name, opts);
  doc.sourceFile = file;
  tripAttachDoc(doc, unpacked);
  if (typeof refreshChrome === "function") refreshChrome();
  if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
  return doc;
}

async function saveTrip(doc){
  if (!doc || !doc.trip || doc._tripSaving) return false;
  doc._tripSaving = true;
  try {
    const now = Date.now();
    const savedKey = tripContentKey(doc.trip);         // await 앞에서 모델을 고정한다(저장 중 입력과 섞이지 않게)
    let bytes;
    try { bytes = tripPack(doc.trip, doc.tripAssets, now); }
    catch(error){
      console.warn("trip pack failed:", error);
      if (typeof toast === "function") toast(tripT("여행일지가 너무 커서 저장하지 못했어요(4GB 제한)."), 4200, { type:"error" });
      return false;
    }
    const ok = (typeof saveTextDoc === "function") ? await saveTextDoc(bytes, doc, doc.name) : false;
    if (ok){
      doc.trip.updatedAt = now;
      if (typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(doc, bytes, "application/zip");
      doc.savedText = savedKey;
      // 디스크에 쓰는 동안에도 입력할 수 있다 — 쓴 내용과 지금 내용을 다시 견줘 '저장 안 됨'을 정한다.
      if (typeof markDocumentDirty === "function") markDocumentDirty(doc, tripContentKey(doc.trip) !== savedKey);
    }
    return ok;
  } finally { doc._tripSaving = false; }
}

/* 통합 검색에 줄 글. savedText 는 비교용 열쇠(JSON)라 본문이 아니다. */
function tripPlainText(model){
  const parts = [model.title || ""];
  for (const day of (model.days || [])){
    parts.push([day.date, day.title].filter(Boolean).join(" "));
    parts.push(day.text || "");
    for (const p of (day.prompts || [])) parts.push([p.q, p.a].filter(Boolean).join(" "));
    for (const s of (day.spots || [])){
      parts.push([s.at, s.name, s.address, s.note].filter(Boolean).join(" "));
      for (const f of (s.fields || [])) parts.push([f.k, f.v].filter(Boolean).join(" "));
    }
  }
  return parts.filter(Boolean).join("\n");
}

/* ---------- 종이 뼈대 ---------- */

/* 종이 층은 일기장과 똑같이 만들고 클래스도 그대로 쓴다 — 같은 종이라 스타일을 새로 쓸 까닭이 없다.
   여행일지 고유한 칸(여정 띠·장소 목록)만 trip-* 를 쓴다. */
function tripBuildPaperEls(main){
  const el = (tag, cls) => { const node = document.createElement(tag); if (cls) node.className = cls; return node; };
  const paper = el("div", "diary-paper");
  const artBgLayer = el("div", "diary-paper-art");
  const bgLayer = el("div", "diary-paper-bg");
  const veilLayer = el("div", "diary-paper-veil");
  const area = el("textarea", "diary-text");
  area.spellcheck = false;
  area.setAttribute("aria-label", "여행일지 본문");
  const stickerLayer = el("div", "diary-stickers");

  const pictureBox = el("div", "diary-picture-box");
  pictureBox.hidden = true;
  const pictureHint = el("div", "diary-picture-hint");
  const pictureHintText = el("span");
  pictureHintText.textContent = "그림 칸 — 사진을 넣거나(끌어다 놓아도 돼요) 직접 그려요.";
  const pictureBtn = diaryButton("", "그림 칸에 사진 넣기", "diary-btn diary-picture-photo", "image");
  const pictureInput = el("input");
  pictureInput.type = "file"; pictureInput.accept = "image/*"; pictureInput.multiple = true; pictureInput.hidden = true;
  const pictureDrawBtn = diaryButton("", "그림 칸에 그리기", "diary-btn diary-picture-draw", "pen");
  const pictureHintBtns = el("div", "diary-picture-hint-btns");
  pictureHintBtns.append(pictureBtn, pictureDrawBtn);
  pictureHint.append(pictureHintText, pictureHintBtns, pictureInput);
  pictureBox.append(pictureHint);

  const drawLayer = el("div", "diary-draw-layer");
  drawLayer.hidden = true;
  const drawCanvas = el("canvas", "diary-draw-canvas");
  const drawBar = el("div", "diary-draw-bar");
  drawBar.hidden = true;
  drawBar.setAttribute("role", "toolbar");
  drawLayer.append(drawCanvas, drawBar);

  const genkoLayer = el("div", "diary-genko");
  genkoLayer.hidden = true;
  const genkoGrid = el("div", "diary-genko-grid");
  const genkoCaret = el("div", "diary-genko-caret");
  genkoLayer.append(genkoGrid, genkoCaret);

  paper.append(artBgLayer, bgLayer, veilLayer, area, genkoLayer, pictureBox, stickerLayer, drawLayer);
  return { paper, area, bgLayer, veilLayer, genkoLayer, genkoCaret, genkoGrid, stickerLayer, artBgLayer,
    drawLayer, drawCanvas, pictureBox, pictureHint, main,
    // 종이 엔진이 받지 않는 것(바깥이 배선한다)
    drawBar, pictureBtn, pictureInput, pictureDrawBtn };
}

/* ---------- 편집기 ---------- */

const TRIP_RECOVERY_DELAY = 1500;

function tripDayLabel(model, day){
  const at = (model.days || []).indexOf(day);
  const nth = tripWordf(model.purpose, "dayNth", { n:at + 1 });
  return day && day.date ? day.date + " " + nth : nth;
}

function mountTripEditor(doc){
  const model = doc.trip;
  const assets = doc.tripAssets;
  const root = document.createElement("div");
  // diary-doc 은 종이 색·줄 색 변수를 담은 껍데기다(CSS 전용, JS 선택자로는 쓰이지 않는다).
  // 같은 종이를 쓰기로 했으니 그대로 두르고, 여행일지 고유한 칸만 trip-* 로 꾸민다.
  root.className = "trip-root diary-doc";
  doc.el.append(root);

  let current = model.days.length ? model.days[0].id : "";
  let history = null;
  let recoveryTimer = 0;

  /* 사진 주소는 한 번 만들어 두고 다시 쓴다(문서에 썸네일을 따로 담지 않는다). */
  const urls = new Map();
  const assetUrl = (name) => {
    if (!name || !assets.has(name)) return "";
    if (!urls.has(name)){
      const asset = assets.get(name);
      urls.set(name, URL.createObjectURL(new Blob([asset.bytes], { type:diaryAssetMime(name) })));
    }
    return urls.get(name);
  };

  const dayOf = (id) => (model.days || []).find(d => d.id === id) || null;
  const ensureDay = (id) => {
    let day = dayOf(id);
    if (!day){
      day = tripNormalizeDay({ id:id || tripDayId(), title:"" });
      model.days.push(day);
      current = day.id;
    }
    return day;
  };

  /* ----- 도구막대 ----- */
  const bar = document.createElement("div");
  bar.className = "trip-bar";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "trip-title";
  titleInput.maxLength = 200;
  titleInput.value = model.title || "";
  const purposeSelect = document.createElement("select");
  purposeSelect.className = "trip-select trip-purpose-select";
  for (const value of TRIP_PURPOSES){
    const option = document.createElement("option");
    option.value = value;
    option.selected = tripPurpose(model.purpose) === value;
    purposeSelect.appendChild(option);
  }
  const status = document.createElement("span");
  status.className = "trip-status";
  const undoBtn = diaryButton("", "실행 취소 (Ctrl+Z)", "diary-btn trip-undo-btn", "undo");
  const redoBtn = diaryButton("", "다시 실행 (Ctrl+Shift+Z)", "diary-btn trip-redo-btn", "redo");
  const photoBtn = diaryButton("사진", "사진 붙이기", "diary-btn trip-photo-btn", "image");
  const photoInput = document.createElement("input");
  photoInput.type = "file"; photoInput.accept = "image/*"; photoInput.multiple = true; photoInput.hidden = true;
  const exifBtn = diaryButton("사진에서", "사진에 찍힌 때·자리로 장소 만들기", "diary-btn trip-exif-btn", "map");
  const exifInput = document.createElement("input");
  exifInput.type = "file"; exifInput.accept = "image/jpeg,image/jpg"; exifInput.multiple = true; exifInput.hidden = true;
  const stickerBtn = diaryButton("스티커", "그림·글상자 붙이기", "diary-btn trip-sticker-btn", "sticker");
  const styleBtn = diaryButton("꾸미기", "종이 꾸미기", "diary-btn trip-style-btn", "palette");
  const bgInput = document.createElement("input");
  bgInput.type = "file"; bgInput.accept = "image/*"; bgInput.hidden = true;
  const saveBtn = diaryButton("저장", "저장 (Ctrl+S)", "diary-btn diary-primary trip-save-btn", "save");
  bar.append(titleInput, purposeSelect, status, undoBtn, redoBtn, photoBtn, photoInput,
    exifBtn, exifInput, stickerBtn, styleBtn, bgInput, saveBtn);

  /* ----- 본문: 여정 띠 + 종이 ----- */
  const body = document.createElement("div");
  body.className = "trip-body";
  const rail = document.createElement("div");
  rail.className = "trip-rail";
  const railHead = document.createElement("div");
  railHead.className = "trip-rail-head";
  const railList = document.createElement("div");
  railList.className = "trip-rail-list";
  const addDayBtn = document.createElement("button");
  addDayBtn.type = "button";
  addDayBtn.className = "diary-btn trip-add-day";
  rail.append(railHead, railList, addDayBtn);

  /* 지도 칸 — 좌표가 있는 장소를 표시로 찍고 목록 차례대로 잇는다(설계 2.3).
     칸은 접을 수 있다. 접기는 보는 사람 편의라 파일이 아니라 이 브라우저에만 남긴다. */
  const mapPane = document.createElement("aside");
  mapPane.className = "trip-map-pane";
  const mapHead = document.createElement("div");
  mapHead.className = "trip-map-head";
  const mapTitle = document.createElement("span");
  mapTitle.className = "trip-map-title";
  const scopeBtn = diaryButton("", "이 날 / 여행 전체", "diary-btn trip-map-scope", "list");
  const routeBtn = diaryButton("", "표시를 목록 차례대로 잇기", "diary-btn trip-route-btn", "route");
  const freezeBtn = diaryButton("", "지도 그림으로 굳히기", "diary-btn trip-freeze-btn", "camera");
  mapHead.append(mapTitle, scopeBtn, routeBtn, freezeBtn);
  const mapStage = document.createElement("div");
  mapStage.className = "trip-map-stage";
  const mapNote = document.createElement("p");
  mapNote.className = "trip-map-note";
  const stillBox = document.createElement("div");
  stillBox.className = "trip-still";
  stillBox.hidden = true;
  const stillImg = document.createElement("img");
  stillImg.className = "trip-still-img";
  stillImg.alt = "굳힌 지도 그림";
  const stillNote = document.createElement("p");
  stillNote.className = "trip-still-note";
  stillBox.append(stillImg, stillNote);
  mapPane.append(mapHead, mapStage, mapNote, stillBox);

  const main = document.createElement("div");
  main.className = "trip-main diary-main";
  const pageHead = document.createElement("div");
  pageHead.className = "trip-page-head diary-page-head";
  const dayTitle = document.createElement("input");
  dayTitle.type = "text";
  dayTitle.className = "trip-day-title";
  dayTitle.maxLength = 200;
  const dayDate = document.createElement("input");
  dayDate.type = "date";
  dayDate.className = "trip-day-date";
  const deleteBtn = diaryButton("", "이 날 지우기", "diary-btn trip-day-delete", "delete");
  pageHead.append(dayDate, dayTitle, deleteBtn);

  const els = tripBuildPaperEls(main);

  /* 장소 칸 — 종이 아래에 둔다. 스티커와 달리 지도·일정·경비가 함께 읽는 자료다(설계 2장). */
  const spotsBox = document.createElement("section");
  spotsBox.className = "trip-spots";
  const spotsHead = document.createElement("div");
  spotsHead.className = "trip-spots-head";
  const spotsTitle = document.createElement("span");
  spotsTitle.className = "trip-spots-title";
  const addSpotBtn = document.createElement("button");
  addSpotBtn.type = "button";
  addSpotBtn.className = "diary-btn trip-add-spot";
  spotsHead.append(spotsTitle, addSpotBtn);
  const spotList = document.createElement("div");
  spotList.className = "trip-spot-list";
  const spotsEmpty = document.createElement("p");
  spotsEmpty.className = "trip-spots-empty";
  spotsBox.append(spotsHead, spotList, spotsEmpty);

  /* 질문 칸 — 학습지 갈래에서만 뜬다(빈 낱말 = 감춤 규칙). */
  const promptsBox = document.createElement("section");
  promptsBox.className = "trip-prompts";
  const promptsHead = document.createElement("div");
  promptsHead.className = "trip-prompts-head";
  const promptsTitle = document.createElement("span");
  const addPromptBtn = document.createElement("button");
  addPromptBtn.type = "button";
  addPromptBtn.className = "diary-btn trip-add-prompt";
  addPromptBtn.textContent = "＋";
  promptsHead.append(promptsTitle, addPromptBtn);
  const promptList = document.createElement("div");
  promptList.className = "trip-prompt-list";
  promptsBox.append(promptsHead, promptList);

  main.append(pageHead, els.paper, promptsBox, spotsBox);
  body.append(rail, main, mapPane);
  root.append(bar, body);

  /* ----- 저장 여부·복구본 ----- */
  const setStatus = (msg) => { status.textContent = msg || ""; };
  const refreshDirty = () => {
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, tripContentKey(model) !== doc.savedText);
  };
  const scheduleRecovery = () => {
    clearTimeout(recoveryTimer);
    if (typeof appSettings === "object" && appSettings && appSettings.pdfRecovery === false) return;
    recoveryTimer = setTimeout(() => { recoveryTimer = 0; flushRecovery(); }, TRIP_RECOVERY_DELAY);
  };
  const flushRecovery = async () => {
    clearTimeout(recoveryTimer); recoveryTimer = 0;
    if (!doc.hasUnsavedEdits && !(doc.isScratch && !doc._named)) return true;
    if (typeof rememberWorkspace !== "function" || typeof recoverySnapshotFile !== "function") return false;
    try {
      const file = recoverySnapshotFile(doc, tripPack(model, assets, Date.now()), "application/zip");
      if (!file) return false;
      doc.savedInWorkspace = await rememberWorkspace([file], false, { silent:true });
      return !!doc.savedInWorkspace;
    } catch(error){ console.warn("여행일지 복구본을 남기지 못했어요:", error); return false; }
  };
  doc.flushBackupRecovery = flushRecovery;
  function touch(immediate){
    refreshDirty();
    scheduleRecovery();
    if (history){ if (immediate) history.commit(); else history.commitSoon(400); }
  }
  const updateHistoryButtons = () => {
    undoBtn.disabled = !(history && history.canUndo());
    redoBtn.disabled = !(history && history.canRedo());
  };

  /* ----- 그리기 바(펜은 바가 가진 상태 — 종이는 획을 시작할 때만 읽는다) ----- */
  let eraser = false;
  let penColor = DIARY_PENS[0][0], penSize = "mid";
  try {
    const saved = JSON.parse(localStorage.getItem("mn.diaryPen") || "null");
    if (saved && DIARY_HEX_RE.test(String(saved.color || ""))) penColor = String(saved.color).toLowerCase();
    if (saved && DIARY_PEN_SIZES.some(x => x[0] === saved.size)) penSize = saved.size;
  } catch(_){}
  const rememberPen = () => { try { localStorage.setItem("mn.diaryPen", JSON.stringify({ color:penColor, size:penSize })); } catch(_){} };
  const penButtons = DIARY_PENS.map(([color]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-pen"; b.dataset.color = color;
    b.style.setProperty("--pen", color);
    els.drawBar.append(b);
    return b;
  });
  const penCustomColor = diaryColorInput("diary-pen-custom", (color, live) => setPenColor(color, live));
  els.drawBar.append(penCustomColor);
  const sizeButtons = DIARY_PEN_SIZES.map(([id, w]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-pen-size"; b.dataset.size = id;
    const dot = document.createElement("span");
    dot.style.width = dot.style.height = Math.round(4 + w * 300) + "px";
    b.append(dot);
    els.drawBar.append(b);
    return b;
  });
  const eraserBtn = diaryButton("", "지우개", "diary-draw-tool", "eraser");
  const drawClearBtn = diaryButton("", "그림 전체 지우기", "diary-draw-tool", "delete");
  const drawDoneBtn = diaryButton("다 그렸어요", "그리기 끝내기 (Esc)", "diary-btn diary-primary", "check", "diary-draw-done-label");
  els.drawBar.append(eraserBtn, drawClearBtn, drawDoneBtn);
  function syncDrawBar(){
    penButtons.forEach(b => {
      const on = !eraser && b.dataset.color === penColor;
      b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on));
    });
    penCustomColor.value = penColor;
    penCustomColor.classList.toggle("is-on", !eraser && !DIARY_PENS.some(x => x[0] === penColor));
    sizeButtons.forEach(b => {
      const on = b.dataset.size === penSize;
      b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on));
    });
    eraserBtn.classList.toggle("is-on", eraser);
    eraserBtn.setAttribute("aria-pressed", String(eraser));
    const day = dayOf(current);
    drawClearBtn.disabled = !(day && day.drawing && day.drawing.length);
  }
  function setPenColor(color, live){
    penColor = color; eraser = false;
    if (!live) rememberPen();
    syncDrawBar();
  }

  /* ----- 종이 엔진 ----- */
  const paperApi = mountDiaryPaper(els, {
    model, assets,
    assetUrl:(...a) => assetUrl(...a),
    currentLabel:() => tripDayLabel(model, dayOf(current)),
    entryOf:(...a) => dayOf(...a),
    ensureEntry:(...a) => ensureDay(...a),
    onDrawModeChange:(on) => { els.drawBar.hidden = !on; },
    onEntryChange:() => { deleteBtn.disabled = !dayOf(current); },
    // 창은 종이 뒤에 세우므로 그때그때 짚는다(창이 종이의 색·투명도를 되비춘다).
    onStickerSelect:() => { if (panels) panels.syncArtPanel(); },
    openStickerColorPicker:() => {
      if (!panels) return;
      panels.setArtPanelOpen(true);
      panels.artCustomColor.focus({ preventScroll:true });
      panels.artCustomColor.click();
    },
    refreshCurrentLabel:() => renderRail(),
    refreshDirty:(...a) => refreshDirty(...a),
    renderCalendar:() => renderRail(),        // 여행일지의 달력 자리는 여정 띠다
    repaintCardPapers:() => {},
    scheduleRecovery:(...a) => scheduleRecovery(...a),
    setStatus:(...a) => setStatus(...a),
    syncDrawBar:(...a) => syncDrawBar(...a),
    syncPanel:() => { if (panels) panels.syncPanel(); },
    touch:(...a) => touch(...a),
    translateUi:(node) => { if (typeof MNI18N !== "undefined" && MNI18N && typeof MNI18N.translateTree === "function") MNI18N.translateTree(node); },
    current:() => current,
    history:() => history,
    penColor:() => penColor,
    penSize:() => penSize,
    eraser:() => eraser
  });
  const { addStickers, addAsset, applyStyle, layout, redrawDrawing, renderStickers, setDrawMode, clearSelection,
    addArtSticker, addTextSticker, applyStickerColor, applyStickerOpacity, selectedStickers,
    stickerColorNow, stickerOpacityNow } = paperApi;

  /* ----- 꾸미기 창·스티커 창 ----- */
  // 일기장과 같은 창을 그대로 쓴다. 종이가 같으니 꾸밀 거리도 같다.
  const panels = mountDiaryPanels({
    model, assets, bgInput, styleBtn, stickerBtn,
    assetUrl:(...a) => assetUrl(...a),
    addAsset:(...a) => addAsset(...a),
    entryOf:(...a) => dayOf(...a),
    ensureEntry:(...a) => ensureDay(...a),
    touch:(...a) => touch(...a),
    setStatus:(...a) => setStatus(...a),
    applyStyle:(...a) => applyStyle(...a),
    layout:(...a) => layout(...a),
    renderCalendar:() => renderRail(),
    addArtSticker:(...a) => addArtSticker(...a),
    addTextSticker:(...a) => addTextSticker(...a),
    applyStickerColor:(...a) => applyStickerColor(...a),
    applyStickerOpacity:(...a) => applyStickerOpacity(...a),
    selectedStickers:(...a) => selectedStickers(...a),
    stickerColorNow:(...a) => stickerColorNow(...a),
    stickerOpacityNow:(...a) => stickerOpacityNow(...a),
    current:() => current,
    history:() => history
  });
  root.append(panels.panel, panels.artPanel);
  // 창 바깥을 누르면 닫는다. 스티커 창은 종이 위 스티커를 고르며 쓰는 창이라 종이를 눌러도 안 닫는다.
  const onOutside = (e) => {
    if (!root.isConnected) return;
    if (!panels.panel.hidden && !panels.panel.contains(e.target) && !styleBtn.contains(e.target)) panels.setPanelOpen(false);
    if (!panels.artPanel.hidden && !panels.artPanel.contains(e.target) && !stickerBtn.contains(e.target)
      && !els.paper.contains(e.target)) panels.setArtPanelOpen(false);
  };
  document.addEventListener("pointerdown", onOutside, true);

  penButtons.forEach(b => b.addEventListener("click", () => setPenColor(b.dataset.color)));
  sizeButtons.forEach(b => b.addEventListener("click", () => { penSize = b.dataset.size; rememberPen(); syncDrawBar(); }));
  eraserBtn.addEventListener("click", () => { eraser = !eraser; syncDrawBar(); });
  drawClearBtn.addEventListener("click", () => {
    const day = dayOf(current);
    if (!day || !day.drawing || !day.drawing.length) return;
    if (history) history.flush();
    day.drawing = [];
    redrawDrawing(); syncDrawBar(); renderRail();
    touch(true);
    setStatus(tripT("그림을 모두 지웠어요. Ctrl+Z 로 되돌릴 수 있어요."));
  });
  drawDoneBtn.addEventListener("click", () => setDrawMode(false));
  els.pictureDrawBtn.addEventListener("click", (e) => { e.stopPropagation(); setDrawMode(true); });
  els.pictureBtn.addEventListener("click", (e) => { e.stopPropagation(); els.pictureInput.click(); });
  els.pictureInput.addEventListener("change", async () => {
    const files = [...(els.pictureInput.files || [])]; els.pictureInput.value = "";
    if (files.length) await addStickers(files, null, true);
  });
  /* ----- 사진에서 장소 만들기 -----
     EXIF 는 **줄여 굽기 전 원본 바이트**에서 읽어야 한다 — diaryPrepareImage 를 지나면 통째로 날아간다.
     찍힌 날짜와 같은 날이 여정에 있으면 그 날에, 없으면 보고 있는 날에 넣는다. 새 날을 멋대로 만들지는 않는다.
     GPS 는 개인정보라 저절로 읽지 않는다 — 이 단추를 누른 사진만 읽는다. */
  async function makeSpotsFromPhotos(files){
    const day = dayOf(current);
    if (!day && !files.length) return;
    let made = 0, noExif = 0, noGps = 0;
    if (history) history.flush();
    for (const file of files){
      let info;
      try { info = tripReadExif(new Uint8Array(await file.arrayBuffer())); }
      catch(_){ info = { date:"", at:"", lat:null, lng:null }; }
      if (!info.date && info.lat == null){ noExif++; continue; }
      if (info.lat == null) noGps++;
      const target = (info.date && (model.days || []).find(d => d.date === info.date)) || day;
      if (!target) continue;
      if (target.spots.length >= TRIP_MAX_SPOTS) continue;
      const asset = await addAsset(file, DIARY_STICKER_MAX_DIM);
      const name = String(file.name || "").replace(/\.[a-z0-9]+$/i, "").slice(0, 120);
      target.spots.push({
        id:tripSpotId(), at:info.at || "", name, address:"", note:"", kind:"",
        lat:info.lat, lng:info.lat == null ? null : info.lng,
        color:"", cost:null, photos:asset ? [asset.name] : [], fields:[]
      });
      made++;
    }
    renderSpots(); renderRail(); renderMap();
    if (made) touch(true);
    const parts = [];
    if (made) parts.push(tripTf("{n}곳을 만들었어요", { n:made }));
    if (noGps) parts.push(tripTf("{n}장은 찍은 자리가 없어 때만 적었어요", { n:noGps }));
    if (noExif) parts.push(tripTf("{n}장은 찍은 때·자리가 없어요(메신저로 받은 사진은 지워져 있어요)", { n:noExif }));
    setStatus(parts.join(" · ") || tripT("사진에서 읽을 것이 없었어요."));
  }
  exifBtn.addEventListener("click", () => exifInput.click());
  exifInput.addEventListener("change", async () => {
    const files = [...(exifInput.files || [])]; exifInput.value = "";
    if (files.length) await makeSpotsFromPhotos(files);
  });

  photoBtn.addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", async () => {
    const files = [...(photoInput.files || [])]; photoInput.value = "";
    if (files.length) await addStickers(files);
  });

  /* ----- 지도 칸 -----
     지도 만들기·타일·저작권 줄은 .map 문서 것을 그대로 부른다(mapCreateTileLayer·mapAttachNetworkNotice).
     인터넷이 없으면 타일이 안 오지만 칸은 그대로 두고 알림만 띄운다 — 좌표는 여전히 볼 수 있다. */
  let leafletMap = null, markerLayer = null, routeLine = null, tileLayer = null;
  let mapReady = false, mapFailed = false, tilesDrawn = 0, freezing = false;
  let pickingFor = "";                  // '지도에서 찍기' 를 누른 장소 id

  /* 이 날만 볼지 여행 전체를 볼지 — 보는 사람 편의라 파일이 아니라 이 브라우저에만 남긴다.
     굳힌 그림은 이 둘을 따로 담는다(날마다 한 장 + 전체 한 장, 설계 2.3). */
  let mapScope = "day";
  try { if (localStorage.getItem("mn.tripMapScope") === "all") mapScope = "all"; } catch(_){}

  const spotsWithCoords = () => {
    const days = mapScope === "all" ? (model.days || []) : [dayOf(current)].filter(Boolean);
    const out = [];
    for (const day of days) for (const s of (day.spots || [])) if (s.lat != null && s.lng != null) out.push(s);
    return out;
  };
  /* 굳힐 때의 서명. 이게 없으면 낡은 지도가 낡은 줄 모르고 인쇄된다(설계 2.3 규칙 4). */
  const stillSignature = () => JSON.stringify({
    scope:mapScope,
    basemap:(model.map && model.map.basemap) || "osm",
    route:!!(model.map && model.map.route),
    at:spotsWithCoords().map(s => [s.lat, s.lng, s.kind || "", s.color || ""])
  });
  // 굳힌 그림이 들어갈 자리 — 이 날 것과 여행 전체 것이 다르다.
  const stillHolder = () => (mapScope === "all" ? model.map : dayOf(current));

  async function ensureMap(){
    if (mapReady || mapFailed) return mapReady;
    if (typeof MNLazy === "undefined" || typeof mapCreateTileLayer !== "function"){ mapFailed = true; return false; }
    try {
      if (!await MNLazy.tryNeed("leaflet")) throw new Error("leaflet");
      const proxyBase = typeof mapTileProxyBase === "function" ? await mapTileProxyBase() : "";
      leafletMap = L.map(mapStage, { zoomControl:true, attributionControl:true });
      const center = (model.map && model.map.center) || [36.5, 127.9];
      leafletMap.setView(center, (model.map && model.map.zoom) || 7);
      tileLayer = mapCreateTileLayer((model.map && model.map.basemap) || "osm", proxyBase, () => {});
      // 타일이 실제로 그려졌는지 세어 둔다. 안 온 채로 찍으면 회색 사각형이 파일에 박힌다(설계 2.3 규칙 3).
      tileLayer.on("tileload", () => { tilesDrawn++; syncFreezeBtn(); });
      tileLayer.addTo(leafletMap);
      if (typeof mapAttachNetworkNotice === "function") mapAttachNetworkNotice(mapStage, leafletMap, () => tileLayer);
      markerLayer = L.layerGroup().addTo(leafletMap);
      leafletMap.on("click", (e) => {
        if (!pickingFor) return;
        const day = dayOf(current);
        const spot = day && day.spots.find(s => s.id === pickingFor);
        pickingFor = "";
        mapStage.classList.remove("is-picking");
        if (!spot) return;
        if (history) history.flush();
        spot.lat = Math.round(e.latlng.lat * 1e6) / 1e6;
        spot.lng = Math.round(e.latlng.lng * 1e6) / 1e6;
        renderSpots(); renderMap(); touch(true);
        setStatus(tripT("자리를 찍었어요."));
      });
      // 보고 있던 자리는 문서에 남긴다 — 다음에 열면 그 자리에서 시작한다.
      leafletMap.on("moveend zoomend", () => {
        if (!leafletMap) return;
        const c = leafletMap.getCenter();
        model.map = { ...model.map, center:[Math.round(c.lat * 1e6) / 1e6, Math.round(c.lng * 1e6) / 1e6],
          zoom:leafletMap.getZoom() };
        touch();
      });
      mapReady = true;
      return true;
    } catch(error){
      console.warn("여행일지 지도를 열지 못했어요:", error);
      mapFailed = true;
      return false;
    }
  }

  function renderMap(){
    const purpose = tripPurpose(model.purpose);
    mapTitle.textContent = tripWord(purpose, "mapPane") + (mapScope === "all" ? " · " + tripT("여행 전체") : "");
    scopeBtn.classList.toggle("is-on", mapScope === "all");
    routeBtn.classList.toggle("is-on", !!(model.map && model.map.route));
    routeBtn.title = tripWord(purpose, "route");
    const list = spotsWithCoords();
    mapNote.textContent = list.length ? "" : tripWord(purpose, "mapEmpty");
    mapNote.hidden = !!list.length;
    syncFreezeBtn();
    renderStill();
    if (!mapReady || !markerLayer) return;
    markerLayer.clearLayers();
    if (routeLine){ routeLine.remove(); routeLine = null; }
    for (const [at, spot] of list.entries()){
      const color = tripSpotKindColor(spot.kind);
      const hex = (typeof MAP_MARKER_COLORS !== "undefined"
        ? (MAP_MARKER_COLORS.find(c => c.id === (spot.color || color)) || MAP_MARKER_COLORS[0]).hex : "#2563eb");
      const marker = L.circleMarker([spot.lat, spot.lng], {
        radius:9, color:"#fff", weight:2, fillColor:hex, fillOpacity:.95
      });
      marker.bindTooltip((at + 1) + ". " + (spot.name || tripWord(purpose, "spot")), { direction:"top" });
      marker.addTo(markerLayer);
    }
    if (model.map && model.map.route && list.length > 1){
      routeLine = L.polyline(list.map(s => [s.lat, s.lng]),
        { color:"#2563eb", weight:3, opacity:.75, dashArray:"6 5", className:"trip-route-line" }).addTo(leafletMap);
    }
    leafletMap.invalidateSize();
    syncFreezeBtn();
    renderStill();
  }

  async function showMap(){
    if (!await ensureMap()){
      mapNote.hidden = false;
      mapNote.textContent = tripT("지도를 열지 못했어요. 인터넷이 없으면 배경 지도가 비어 보일 수 있어요.");
      return;
    }
    renderMap();
    const list = spotsWithCoords();
    if (list.length > 1) leafletMap.fitBounds(list.map(s => [s.lat, s.lng]), { padding:[28, 28] });
    else if (list.length === 1) leafletMap.setView([list[0].lat, list[0].lng], Math.max(leafletMap.getZoom(), 13));
  }

  /* ----- 지도 그림으로 굳히기 (설계 2.3) -----
     1) 단추로만 한다 — 저장할 때 자동으로 찍으면 아래 2·3 을 피할 수 없다.
     2) 칸이 접혀 있으면 찍을 DOM 이 없다.
     3) 타일이 안 왔으면 회색 사각형이 박힌다 — 가장 고약한 결과라 아예 막는다.
     4) 굳힐 때의 서명을 함께 담아 낡으면 알린다. 자동으로 다시 굳히지는 않는다(2·3 때문에 늘 되지는 않는다).
     5) 굳힌 그림이 없으면 그 자리를 비운다 — 회색 지도를 넣느니 아무것도 안 넣는 쪽이 낫다. */
  function canFreeze(){
    if (!mapReady || freezing) return false;
    if (!mapStage.clientWidth || !mapStage.clientHeight) return false;   // 접힌 칸
    if (!tilesDrawn) return false;                                       // 타일이 아직 안 왔다
    return !!spotsWithCoords().length;
  }
  function syncFreezeBtn(){
    freezeBtn.disabled = !canFreeze();
    freezeBtn.title = freezing ? tripT("지도를 굳히는 중…")
      : !mapReady ? tripT("지도를 아직 열지 못했어요.")
      : !mapStage.clientHeight ? tripT("지도 칸이 접혀 있어요.")
      : !tilesDrawn ? tripT("배경 지도가 아직 오지 않았어요. 인터넷이 없으면 굳힐 수 없어요.")
      : !spotsWithCoords().length ? tripWord(model.purpose, "mapEmpty")
      : tripWord(model.purpose, "mapStill");
    freezeBtn.setAttribute("aria-label", freezeBtn.title);
  }
  function renderStill(){
    const holder = stillHolder();
    const name = holder && holder.still;
    const url = name ? assetUrl(name) : "";
    stillBox.hidden = !url;
    if (!url) return;
    stillImg.src = url;
    const stale = (holder.stillKey || "") !== stillSignature();
    stillNote.textContent = stale
      ? tripT("지도 그림이 낡았어요 — 다시 굳히세요.")
      : tripT("이 그림이 인쇄에 쓰여요.");
    stillNote.classList.toggle("is-stale", stale);
  }
  async function freezeMap(){
    if (!canFreeze() || typeof mapCaptureDataUrl !== "function") return;
    freezing = true; syncFreezeBtn();
    setStatus(tripT("지도를 굳히는 중…"));
    try {
      const spec = (typeof MAP_BASEMAPS !== "undefined" && MAP_BASEMAPS[(model.map && model.map.basemap) || "osm"]) || null;
      const title = String(model.title || "").trim();
      // 출처는 그림 자체에 새긴다 — 캡처 전에 저작권 줄을 감추기 때문이다(.map 과 같은 규칙).
      const attribution = (title ? title + " · " : "") + (spec ? spec.attribution : "");
      const labels = spotsWithCoords().map((s, at) => {
        const p = leafletMap.latLngToContainerPoint([s.lat, s.lng]);
        return { text:(at + 1) + ". " + (s.name || ""), x:p.x, y:p.y };
      }).filter(l => l.text.trim().length > 2);
      const dataUrl = await mapCaptureDataUrl(mapStage, attribution, labels);
      const blob = typeof mapDataUrlToBlob === "function" ? await mapDataUrlToBlob(dataUrl) : null;
      if (!blob) throw new Error("capture");
      // 사진과 똑같은 길로 다시 굽는다 — 2배 해상도 PNG 그대로 담으면 한 장에 2MB 가 넘는다.
      const asset = await addAsset(blob, 1600);
      if (!asset) throw new Error("asset");
      if (history) history.flush();
      const holder = stillHolder();
      if (!holder) return;
      holder.still = asset.name;
      holder.stillKey = stillSignature();
      if (mapScope === "all") model.map = { ...model.map };
      renderStill(); touch(true);
      setStatus(tripT("지도를 그림으로 굳혔어요."));
    } catch(error){
      console.warn("지도를 굳히지 못했어요:", error);
      setStatus(tripT("지도를 굳히지 못했어요."));
    } finally { freezing = false; syncFreezeBtn(); }
  }
  freezeBtn.addEventListener("click", freezeMap);

  scopeBtn.addEventListener("click", () => {
    mapScope = mapScope === "all" ? "day" : "all";
    try { localStorage.setItem("mn.tripMapScope", mapScope); } catch(_){}
    showMap();
  });

  routeBtn.addEventListener("click", () => {
    model.map = { ...model.map, route:!(model.map && model.map.route) };
    renderMap();
    touch(true);
  });

  function startPicking(spotId){
    pickingFor = spotId;
    mapStage.classList.add("is-picking");
    setStatus(tripT("지도를 눌러 자리를 찍으세요."));
    showMap();
  }

  /* ----- 여정 띠 ----- */
  function renderRail(){
    railList.innerHTML = "";
    railHead.textContent = tripWordf(model.purpose, "dayCount", { n:(model.days || []).length });
    for (const day of (model.days || [])){
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "trip-day-chip" + (day.id === current ? " is-on" : "");
      chip.dataset.id = day.id;
      const head = document.createElement("span");
      head.className = "trip-day-chip-head";
      head.textContent = tripDayLabel(model, day);
      const sub = document.createElement("span");
      sub.className = "trip-day-chip-sub";
      const spots = (day.spots || []).length;
      sub.textContent = day.title || (spots ? tripWord(model.purpose, "spot") + " " + spots : tripWord(model.purpose, "dayEmpty"));
      chip.append(head, sub);
      chip.addEventListener("click", () => goTo(day.id));
      railList.append(chip);
    }
    addDayBtn.textContent = tripWord(model.purpose, "dayAdd");
  }

  function goTo(id){
    if (history) history.flush();
    setDrawMode(false);
    clearSelection();
    current = id;
    renderRail();
    renderPage();
  }

  /* ----- 장소 목록 ----- */

  /* 고르개에는 이 갈래의 것만 담되, 지금 값이 목록에 없으면 맨 아래에 그 값을 덧붙인다.
     갈래를 바꿨다고 값이 사라지면 무손실 규칙이 깨진다(설계 부록 B). */
  function fillKindSelect(select, purpose, value){
    select.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = "—";
    select.append(blank);
    const shown = tripSpotKinds(purpose);
    for (const kind of shown){
      const option = document.createElement("option");
      option.value = kind[0];
      option.textContent = tripSpotKindName(purpose, kind[0]);
      select.append(option);
    }
    if (value && !shown.some(k => k[0] === value)){
      const option = document.createElement("option");
      option.value = value;
      // 다른 갈래에서 고른 값이면 그 이름을, 아예 모르는 글자면 글자 그대로 보여 준다.
      option.textContent = tripSpotKindName(purpose, value) || value;
      option.className = "trip-kind-foreign";
      select.append(option);
    }
    select.value = value || "";
  }

  function renderSpots(){
    const day = dayOf(current);
    const purpose = tripPurpose(model.purpose);
    spotsTitle.textContent = tripWord(purpose, "spotList");
    addSpotBtn.textContent = tripWord(purpose, "spotAdd");
    addSpotBtn.disabled = !day;
    spotList.innerHTML = "";
    const spots = day ? day.spots : [];
    spotsEmpty.textContent = tripWord(purpose, "spotEmpty");
    spotsEmpty.hidden = !!spots.length;
    const showCost = tripHasWord(purpose, "cost");
    const showFields = tripHasWord(purpose, "fields");

    for (const spot of spots){
      const row = document.createElement("div");
      row.className = "trip-spot";
      row.dataset.id = spot.id;

      const line1 = document.createElement("div");
      line1.className = "trip-spot-line";
      const at = document.createElement("input");
      at.type = "text"; at.className = "trip-spot-at"; at.maxLength = 5;
      at.value = spot.at || ""; at.placeholder = "09:30";
      at.title = tripWord(purpose, "spotAt");
      const icon = document.createElement("span");
      icon.className = "trip-spot-icon";
      icon.innerHTML = spot.kind ? diaryArtSvg(tripSpotKindIcon(spot.kind), "trip-spot-art") : "";
      const kindSelect = document.createElement("select");
      kindSelect.className = "trip-select trip-spot-kind";
      kindSelect.title = tripWord(purpose, "spotKindLabel");
      fillKindSelect(kindSelect, purpose, spot.kind);
      const name = document.createElement("input");
      name.type = "text"; name.className = "trip-spot-name"; name.maxLength = 120;
      name.value = spot.name || ""; name.placeholder = tripWord(purpose, "spotNameHint");
      const pickBtn = diaryButton("", spot.lat == null ? "지도에서 자리 찍기" : "지도에서 자리 다시 찍기",
        "diary-btn trip-spot-pick" + (spot.lat == null ? "" : " is-on"), "map");
      const removeBtn = diaryButton("", "이 줄 빼기", "diary-btn trip-spot-remove", "close");
      line1.append(at, icon, kindSelect, name, pickBtn, removeBtn);
      pickBtn.addEventListener("click", () => startPicking(spot.id));

      const line2 = document.createElement("div");
      line2.className = "trip-spot-line";
      const address = document.createElement("input");
      address.type = "text"; address.className = "trip-spot-addr"; address.maxLength = 300;
      address.value = spot.address || ""; address.placeholder = "주소";
      const note = document.createElement("input");
      note.type = "text"; note.className = "trip-spot-note"; note.maxLength = 2000;
      note.value = spot.note || ""; note.placeholder = tripWord(purpose, "spotNote");
      line2.append(address, note);
      row.append(line1, line2);

      if (showCost){
        const line3 = document.createElement("div");
        line3.className = "trip-spot-line";
        const cost = document.createElement("input");
        cost.type = "text"; cost.className = "trip-spot-cost"; cost.maxLength = 12; cost.inputMode = "numeric";
        cost.value = spot.cost ? String(spot.cost.amount) : "";
        cost.placeholder = tripWord(purpose, "cost");
        cost.title = tripWord(purpose, "cost");
        const unit = document.createElement("span");
        unit.className = "trip-spot-cost-unit";
        unit.textContent = (spot.cost && spot.cost.currency) || model.budget.currency;
        cost.addEventListener("input", () => {
          // Number("") 는 0 이다 — 빈 칸을 0원으로 적으면 안 된다.
          const text = cost.value.replace(/[^0-9.]/g, "");
          spot.cost = text ? tripNormalizeCost({ amount:Number(text), currency:unit.textContent }) : null;
          touch();
        });
        line3.append(cost, unit);
        row.append(line3);
      }
      if (showFields){
        const box = document.createElement("div");
        box.className = "trip-spot-fields";
        const head = document.createElement("span");
        head.className = "trip-spot-fields-head";
        head.textContent = tripWord(purpose, "fields");
        const addField = document.createElement("button");
        addField.type = "button"; addField.className = "diary-btn trip-add-field"; addField.textContent = "＋";
        addField.addEventListener("click", () => {
          if (history) history.flush();
          spot.fields = [...(spot.fields || []), { k:"", v:"" }];
          renderSpots(); touch(true);
        });
        box.append(head, addField);
        for (const [at2, field] of (spot.fields || []).entries()){
          const k = document.createElement("input");
          k.type = "text"; k.className = "trip-field-k"; k.maxLength = 40;
          k.value = field.k; k.placeholder = "항목";
          const v = document.createElement("input");
          v.type = "text"; v.className = "trip-field-v"; v.maxLength = 300;
          v.value = field.v; v.placeholder = "내용";
          k.addEventListener("input", () => { spot.fields[at2].k = k.value; touch(); });
          v.addEventListener("input", () => { spot.fields[at2].v = v.value; touch(); });
          box.append(k, v);
        }
        row.append(box);
      }

      at.addEventListener("change", () => {
        spot.at = tripNormalizeTime(at.value);
        at.value = spot.at;
        touch(true);
      });
      kindSelect.addEventListener("change", () => {
        spot.kind = kindSelect.value;
        icon.innerHTML = spot.kind ? diaryArtSvg(tripSpotKindIcon(spot.kind), "trip-spot-art") : "";
        touch(true);
      });
      name.addEventListener("input", () => { spot.name = name.value; renderRail(); touch(); });
      address.addEventListener("input", () => { spot.address = address.value; touch(); });
      note.addEventListener("input", () => { spot.note = note.value; touch(); });
      removeBtn.addEventListener("click", () => {
        if (history) history.flush();
        day.spots = day.spots.filter(s => s.id !== spot.id);
        renderSpots(); renderRail(); touch(true);
        setStatus(tripT("지웠어요. Ctrl+Z 로 되돌릴 수 있어요."));
      });
      spotList.append(row);
    }
  }

  addSpotBtn.addEventListener("click", () => {
    const day = dayOf(current);
    if (!day) return;
    if (history) history.flush();
    if (day.spots.length >= TRIP_MAX_SPOTS){
      setStatus(tripT("한 날에 넣을 수 있는 수를 넘었어요.")); return;
    }
    day.spots.push({ id:tripSpotId(), at:"", name:"", address:"", note:"", kind:"",
      lat:null, lng:null, color:"", cost:null, photos:[], fields:[] });
    renderSpots(); renderRail(); touch(true);
    const last = spotList.querySelector(".trip-spot:last-child .trip-spot-name");
    if (last) last.focus();
  });

  /* ----- 질문 칸(학습지) ----- */
  function renderPrompts(){
    const purpose = tripPurpose(model.purpose);
    const show = tripHasWord(purpose, "prompts");
    promptsBox.hidden = !show;
    if (!show) return;
    const day = dayOf(current);
    promptsTitle.textContent = tripWord(purpose, "prompts");
    addPromptBtn.disabled = !day;
    promptList.innerHTML = "";
    for (const [at, prompt] of ((day && day.prompts) || []).entries()){
      const row = document.createElement("div");
      row.className = "trip-prompt";
      const q = document.createElement("input");
      q.type = "text"; q.className = "trip-prompt-q"; q.maxLength = 300;
      q.value = prompt.q; q.placeholder = tripWord(purpose, "prompts");
      const a = document.createElement("input");
      a.type = "text"; a.className = "trip-prompt-a"; a.maxLength = 2000;
      a.value = prompt.a; a.placeholder = tripWord(purpose, "promptAnswer");
      const remove = diaryButton("", "이 줄 빼기", "diary-btn trip-prompt-remove", "close");
      q.addEventListener("input", () => { day.prompts[at].q = q.value; touch(); });
      a.addEventListener("input", () => { day.prompts[at].a = a.value; touch(); });
      remove.addEventListener("click", () => {
        if (history) history.flush();
        day.prompts.splice(at, 1);
        renderPrompts(); touch(true);
      });
      row.append(q, a, remove);
      promptList.append(row);
    }
  }
  addPromptBtn.addEventListener("click", () => {
    const day = dayOf(current);
    if (!day) return;
    if (history) history.flush();
    if (!Array.isArray(day.prompts)) day.prompts = [];
    if (day.prompts.length >= TRIP_MAX_PROMPTS){ setStatus(tripT("질문을 더 넣을 수 없어요.")); return; }
    day.prompts.push({ q:"", a:"" });
    renderPrompts(); touch(true);
    const last = promptList.querySelector(".trip-prompt:last-child .trip-prompt-q");
    if (last) last.focus();
  });

  function renderPage(){
    const day = dayOf(current);
    deleteBtn.disabled = !day;
    dayTitle.value = day ? (day.title || "") : "";
    dayTitle.placeholder = tripWord(model.purpose, "dayTitleHint");
    dayTitle.disabled = !day;
    dayDate.value = day ? (day.date || "") : "";
    dayDate.disabled = !day;
    els.area.value = day ? (day.text || "") : "";
    els.area.disabled = !day;
    applyStyle();
    renderStickers();
    layout();
    syncDrawBar();
    renderPrompts();
    renderSpots();
    renderMap();
  }

  addDayBtn.addEventListener("click", () => {
    if (history) history.flush();
    const day = tripNormalizeDay({ title:"" });
    day.title = "";
    model.days.push(day);
    current = day.id;
    renderRail(); renderPage();
    touch(true);
    dayTitle.focus();
  });
  deleteBtn.addEventListener("click", () => {
    const day = dayOf(current);
    if (!day) return;
    if (history) history.flush();
    const at = model.days.indexOf(day);
    model.days.splice(at, 1);
    current = model.days.length ? model.days[Math.min(at, model.days.length - 1)].id : "";
    renderRail(); renderPage();
    touch(true);
    setStatus(tripT("지웠어요. Ctrl+Z 로 되돌릴 수 있어요."));
  });
  dayTitle.addEventListener("input", () => {
    const day = dayOf(current);
    if (!day) return;
    day.title = dayTitle.value;
    renderRail();
    touch();
  });
  dayDate.addEventListener("change", () => {
    const day = dayOf(current);
    if (!day) return;
    day.date = tripIsDateKey(dayDate.value) ? dayDate.value : "";
    renderRail();
    touch(true);
  });
  titleInput.addEventListener("input", () => { model.title = titleInput.value; touch(); });

  /* ----- 갈래 바꾸기 — 말과 기본값만 바뀌고 자료는 그대로다(설계 3장) ----- */
  function applyPurposeLabels(){
    const p = tripPurpose(model.purpose);
    root.dataset.purpose = p;
    titleInput.placeholder = tripWord(p, "titleHint");
    titleInput.setAttribute("aria-label", titleInput.placeholder);
    purposeSelect.title = tripWord(p, "purposeLabel");
    for (const option of purposeSelect.options) option.textContent = tripWord(option.value, "docName");
    deleteBtn.title = tripWord(p, "dayDelete");
    deleteBtn.setAttribute("aria-label", deleteBtn.title);
    addDayBtn.textContent = tripWord(p, "dayAdd");
    renderRail();
    renderPage();
  }
  purposeSelect.addEventListener("change", () => {
    if (history) history.flush();
    model.purpose = tripPurpose(purposeSelect.value);
    applyPurposeLabels();
    touch(true);
  });

  /* ----- 되돌리기 ----- */
  const snapshot = () => JSON.stringify({ title:model.title, purpose:model.purpose, style:model.style, days:model.days });
  history = MNEditHistory.create({
    limit:80,
    sizeOf:(s) => s.length,
    maxBytes:24 * 1024 * 1024,
    capture:snapshot,
    isEqual:(a, b) => a === b,
    apply:(state) => {
      let parsed; try { parsed = JSON.parse(state); } catch(_){ return; }
      model.title = parsed.title;
      model.purpose = tripPurpose(parsed.purpose);
      model.style = parsed.style;
      model.days = parsed.days;
      if (!dayOf(current)) current = model.days.length ? model.days[0].id : "";
      titleInput.value = model.title || "";
      purposeSelect.value = model.purpose;
      applyPurposeLabels();
      refreshDirty();
      scheduleRecovery();
    },
    onChange:updateHistoryButtons
  });
  undoBtn.addEventListener("click", () => history.undo());
  redoBtn.addEventListener("click", () => history.redo());
  saveBtn.addEventListener("click", () => saveTrip(doc));

  const onKey = (e) => {
    if (!root.isConnected || !doc.el.contains(document.activeElement) && !root.contains(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "s"){
      e.preventDefault(); saveTrip(doc); return;
    }
    const inField = /^(input|textarea|select)$/i.test(String(e.target && e.target.tagName || ""));
    if ((e.ctrlKey || e.metaKey) && !inField && String(e.key || "").toLowerCase() === "z"){
      e.preventDefault();
      if (e.shiftKey) history.redo(); else history.undo();
    }
  };
  document.addEventListener("keydown", onKey, true);

  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onOutside, true);
    if (typeof paperApi.destroyPaper === "function") paperApi.destroyPaper();
    if (leafletMap){ leafletMap.remove(); leafletMap = null; }
    if (history) history.cancel();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery;
  });

  applyPurposeLabels();
  showMap();
  history.reset();
  updateHistoryButtons();
  refreshDirty();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    TRIP_FORMAT, TRIP_VERSION, TRIP_JSON_NAME, TRIP_PURPOSES, TRIP_MAX_DAYS, TRIP_MAX_SPOTS,
    TRIP_WORDS, TRIP_WORDS_EN, TRIP_SPOT_KINDS, TRIP_SPOT_KIND_IDS,
    tripPurpose, tripPurposeAt, tripWord, tripWordf, tripHasWord,
    tripSpotKinds, tripSpotKindInfo, tripSpotKindName, tripSpotKindIcon, tripSpotKindColor,
    tripIsDateKey, tripNormalizeTime, tripNormalizeSpot, tripNormalizeDay, tripDayIsEmpty,
    tripNormalizePairs, tripNormalizePrompts, tripNormalizeCost, tripNormalizeMap, tripNormalizeBudget,
    tripEmpty, tripNormalize, tripCleanDays, tripCleanSpot, tripModelJson, tripContentKey,
    tripReferencedAssets, tripPack, tripUnpack, tripIsDomestic, tripPlainText,
    tripReadExif, tripExifWhen,
    tripScratchFileName, tripStarterBytes
  };
}
