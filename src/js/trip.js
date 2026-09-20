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

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    TRIP_FORMAT, TRIP_VERSION, TRIP_JSON_NAME, TRIP_PURPOSES, TRIP_MAX_DAYS, TRIP_MAX_SPOTS,
    TRIP_WORDS, TRIP_WORDS_EN, TRIP_SPOT_KINDS, TRIP_SPOT_KIND_IDS,
    tripPurpose, tripPurposeAt, tripWord, tripWordf, tripHasWord,
    tripSpotKinds, tripSpotKindInfo, tripSpotKindName, tripSpotKindIcon, tripSpotKindColor,
    tripIsDateKey, tripNormalizeTime, tripNormalizeSpot, tripNormalizeDay, tripDayIsEmpty,
    tripNormalizePairs, tripNormalizePrompts, tripNormalizeCost, tripNormalizeMap, tripNormalizeBudget,
    tripEmpty, tripNormalize, tripCleanDays, tripCleanSpot, tripModelJson, tripContentKey,
    tripReferencedAssets, tripPack, tripUnpack, tripIsDomestic,
    tripScratchFileName, tripStarterBytes
  };
}
