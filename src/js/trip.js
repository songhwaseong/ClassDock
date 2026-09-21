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
// 2: 공용 종이에 줄 무늬 8종을 추가했다. 옛 앱이 새 무늬를 지우지 못하게 한다.
// 3: 장소에 짧은 영상(videos)을 단다. 옛 앱은 영상 이름을 모르는 자산으로 버리고 그대로 저장하므로
//    영상이 조용히 사라진다 — 판을 올려 옛 앱이 아예 열지 않게 한다.
const TRIP_VERSION = 3;
const TRIP_JSON_NAME = "trip.json";
const TRIP_MAX_DAYS = 400;
const TRIP_MAX_SPOTS = 60;            // 하루에 들를 곳
const TRIP_MAX_PROMPTS = 20;          // 하루에 물을 것(학습지)
const TRIP_MAX_FIELDS = 12;           // 지점 하나의 조사 항목(답사)
const TRIP_MAX_HEADER = 8;            // 인쇄 머리의 자유 칸
const TRIP_ASSET_RE = /^assets\/[a-z0-9_-]{4,64}\.(png|jpe?g|webp|gif)$/;
/* 장소 영상. 사진처럼 ZIP 안에 그대로 담는다(옆 파일로 두면 .trip 만 옮길 때 끊긴다).
   저장·복구본이 ZIP 전체를 매번 다시 쓰므로 '짧은' 영상만 받는다 — 한도는 여기 한 곳에서 정한다.
   한 개 상한은 ZIP 읽기 상한(DIARY_MAX_ENTRY_BYTES 64MB)보다 작아야 한다. 넘으면 열 때 조용히 빠진다.
   .mov 는 아이폰 H.264 영상이 흔해서 받는다 — 재생 가능 여부는 넣을 때 실제 <video> 로 확인한다. */
const TRIP_VIDEO_RE = /^assets\/[a-z0-9_-]{4,64}\.(mp4|webm|mov)$/;
const TRIP_VIDEO_MIME = { mp4:"video/mp4", webm:"video/webm", mov:"video/mp4" };
const TRIP_VIDEO_MAX_BYTES = 40 * 1024 * 1024;
const TRIP_VIDEO_TOTAL_MAX_BYTES = 150 * 1024 * 1024;   // 한 문서의 영상 합계
const TRIP_VIDEO_MAX_SEC = 30;
const TRIP_MAX_VIDEOS = 3;                               // 장소 하나에
const TRIP_VIDEO_POSTER_DIM = 640;                       // 첫 장면 그림(목록 칸 썸네일)
/* 2단계: EXE 에 ffmpeg 가 있으면 넣기 전에 줄인다(런처 /shrink-media). 긴 변 1280(720p)·평균 2Mbps·
   앞 30초·위치 메타데이터 지움. 이보다 작고 그대로 틀리는 영상은 화질을 잃지 않게 손대지 않는다.
   원본은 HTTP 본문으로 보내므로 런처 본문 상한(약 1GB) 안에서만 받는다. */
const TRIP_VIDEO_SHRINK_OVER = 8 * 1024 * 1024;
const TRIP_VIDEO_SHRINK_MAX_BYTES = 1024 * 1024 * 1024;
const TRIP_VIDEO_SHRINK_DIM = 1280;
const TRIP_DEFAULT_MAP_CENTER = [36.5, 127.9]; // 한반도 중심
const TRIP_DEFAULT_MAP_ZOOM = 7;               // 전국이 보이는 배율

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
  mapRemove:    ["굳힌 그림 지우기", "굳힌 그림 지우기", "굳힌 그림 지우기"],
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
  mapRemove:    ["Remove frozen image", "Remove frozen image", "Remove frozen image"],
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

/* 시각이 있는 장소는 이른 시각부터, 시각이 없는 장소는 뒤에 둔다. 같은 시각과 빈 시각끼리는
   사용자가 만든 차례를 지켜서 자동 정렬 때문에 순서가 흔들리지 않게 한다. */
function tripSortSpotsByTime(spots){
  return (Array.isArray(spots) ? spots : []).map((spot, index) => ({ spot, index })).sort((a, b) => {
    const aTime = tripNormalizeTime(a.spot && a.spot.at);
    const bTime = tripNormalizeTime(b.spot && b.spot.at);
    if (aTime && bTime) return aTime.localeCompare(bTime) || a.index - b.index;
    if (aTime) return -1;
    if (bTime) return 1;
    return a.index - b.index;
  }).map(item => item.spot);
}
function tripClampLat(v){
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 85 ? n : null;
}
function tripClampLng(v){
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 180 ? n : null;
}

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
  const seenVideos = new Set();
  const videos = (Array.isArray(raw.videos) ? raw.videos : [])
    .map(v => tripNormalizeVideo(v, hasAsset))
    .filter(v => v && !seenVideos.has(v.v) && seenVideos.add(v.v))
    .slice(0, TRIP_MAX_VIDEOS);
  const fields = tripNormalizePairs(raw.fields, TRIP_MAX_FIELDS);
  const cost = tripNormalizeCost(raw.cost);
  // 이름도 주소도 좌표도 없고 적은 것도 없으면 자리만 차지하는 줄이다.
  const lat = tripClampLat(raw.lat), lng = tripClampLng(raw.lng);
  if (!name && !address && lat == null && !note && !cost && !photos.length && !videos.length && !fields.length) return null;
  return {
    id:String(raw.id || "") || tripSpotId(),
    at:tripNormalizeTime(raw.at),
    name, address, note,
    // 모르는 종류도 버리지 않는다 — 갈래를 바꿨다고 값이 사라지면 무손실 규칙이 깨진다.
    kind:typeof raw.kind === "string" ? raw.kind.trim().slice(0, 24) : "",
    lat, lng:lat == null ? null : lng,
    color:String(raw.color || "").trim().slice(0, 12) || "",
    cost, photos, videos, fields
  };
}
/* 영상 한 개 = { v:영상, p:첫 장면 그림(없어도 된다), d:길이(초) }. 영상 바이트가 없으면 버린다. */
function tripNormalizeVideo(raw, hasAsset){
  if (!raw || typeof raw !== "object") return null;
  const v = typeof raw.v === "string" && TRIP_VIDEO_RE.test(raw.v) && (!hasAsset || hasAsset(raw.v)) ? raw.v : "";
  if (!v) return null;
  const p = typeof raw.p === "string" && TRIP_ASSET_RE.test(raw.p) && (!hasAsset || hasAsset(raw.p)) ? raw.p : "";
  const d = Number(raw.d);
  return { v, p, d:Number.isFinite(d) && d > 0 ? Math.round(Math.min(d, 36000) * 10) / 10 : 0 };
}
function tripAssetMime(name){
  const ext = String(name).split(".").pop().toLowerCase();
  if (TRIP_VIDEO_MIME[ext]) return TRIP_VIDEO_MIME[ext];
  return typeof diaryAssetMime === "function" ? diaryAssetMime(name) : "application/octet-stream";
}

function tripNormalizeDay(raw, hasAsset){
  if (!raw || typeof raw !== "object") return null;
  const stickers = typeof diaryNormalizeSticker === "function"
    ? (Array.isArray(raw.stickers) ? raw.stickers : []).map(s => diaryNormalizeSticker(s, hasAsset)).filter(Boolean)
    : [];
  const drawing = typeof diaryNormalizeStroke === "function"
    ? (Array.isArray(raw.drawing) ? raw.drawing : []).map(diaryNormalizeStroke).filter(Boolean)
    : [];
  const spots = tripSortSpotsByTime((Array.isArray(raw.spots) ? raw.spots : []).slice(0, TRIP_MAX_SPOTS)
    .map(s => tripNormalizeSpot(s, hasAsset)).filter(Boolean));
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

/* 사진 묶음에만 있는 날짜를 오름차순으로 돌려준다. 이미 만들어 둔 여정 날짜는 다시 만들지 않고,
   같은 날 사진이 여러 장이어도 날은 하나만 만든다. */
function tripMissingPhotoDates(days, infos){
  const existing = new Set((Array.isArray(days) ? days : [])
    .map(day => String(day && day.date || "")).filter(tripIsDateKey));
  return [...new Set((Array.isArray(infos) ? infos : [])
    .map(info => String(info && info.date || ""))
    .filter(date => tripIsDateKey(date) && !existing.has(date)))].sort();
}

/* 한 날의 날짜를 고쳤을 때 그 날만 날짜 차례에 맞는 자리로 옮긴다. 이미 앞뒤 날짜 사이에 있으면
   그대로 두고, 날짜 없는 날은 건드리지 않는다(통째로 정렬하면 사이에 끼워 둔 날짜 없는 날이 끝으로 밀린다). */
function tripPlaceDayByDate(days, day){
  const list = Array.isArray(days) ? days.slice() : [];
  const from = list.indexOf(day);
  if (from < 0 || !tripIsDateKey(day.date)) return list;
  list.splice(from, 1);
  const dateOf = d => (d && tripIsDateKey(d.date) ? d.date : "");
  let lastBefore = -1, firstAfter = -1;
  list.forEach((d, i) => {
    const date = dateOf(d);
    if (!date) return;
    if (date <= day.date) lastBefore = i;
    else if (firstAfter < 0) firstAfter = i;
  });
  const fits = from > lastBefore && (firstAfter < 0 || from <= firstAfter);
  const at = fits ? from : firstAfter >= 0 && firstAfter > lastBefore ? firstAfter : lastBefore + 1;
  list.splice(at, 0, day);
  return list;
}

/* 여행(날) 갈래에서는 한 날짜에 날이 하나다 — 날 수 세기('5일')·사진 가져오기·날씨가 모두 날짜 하나에
   날 하나를 기대한다. 체험학습(활동)·답사(조사 차례)는 하루에 여럿일 수 있어 막지 않는다. */
function tripDateTakenBy(model, day, date){
  if (!tripIsDateKey(date) || tripPurpose(model && model.purpose) !== "trip") return null;
  return ((model && model.days) || []).find(other => other !== day && other && other.date === date) || null;
}

/* '＋ 날' 로 더하는 날의 날짜 — 여행 갈래에서 가장 늦은 날짜의 다음 날. 날짜가 하나도 없거나
   하루에 여럿일 수 있는 활동·조사 차례면 비워 둔다. */
function tripNextDayDate(model){
  if (tripPurpose(model && model.purpose) !== "trip") return "";
  const dates = ((model && model.days) || []).map(day => day && day.date).filter(tripIsDateKey).sort();
  if (!dates.length) return "";
  const next = new Date(dates[dates.length - 1] + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const key = next.toISOString().slice(0, 10);
  return tripIsDateKey(key) ? key : "";
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
    center:lat == null || lng == null ? TRIP_DEFAULT_MAP_CENTER.slice() : [lat, lng],
    zoom:Number.isFinite(zoom) && zoom >= 1 && zoom <= 19 ? Math.round(zoom) : TRIP_DEFAULT_MAP_ZOOM,
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
  if (s.videos && s.videos.length) out.videos = s.videos.map(v => {
    const o = { v:v.v };
    if (v.p) o.p = v.p;
    if (v.d) o.d = v.d;
    return o;
  });
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
   되어야 하기 때문이다(일기장과 같은 규칙). 지도를 보던 자리(center·zoom)도 뺀다 — 파일엔 담지만
   편집이 아니다(열기만 해도 지도가 장소에 맞춰 움직인다). */
function tripContentKey(model){
  const map = model.map && typeof model.map === "object" ? { ...model.map, center:undefined, zoom:undefined } : model.map;
  return JSON.stringify({
    title:model.title || "", purpose:tripPurpose(model.purpose),
    style:model.style, printPlain:!!model.printPlain,
    header:tripNormalizePairs(model.header, TRIP_MAX_HEADER),
    map, budget:model.budget, source:model.source || "",
    days:tripCleanDays(model)
  });
}

/* 모델이 실제로 가리키는 사진만 저장한다. 굳힌 지도 그림도 여기 들어가야 한다 —
   빠뜨리면 다음 저장에서 조용히 사라진다(일기장이 스티커 갈래마다 겪은 함정). */
function tripReferencedAssets(model){
  const used = new Set();
  const add = name => { if (typeof name === "string" && (TRIP_ASSET_RE.test(name) || TRIP_VIDEO_RE.test(name))) used.add(name); };
  add(model.style && model.style.bg);
  add(model.map && model.map.still);
  for (const day of (model.days || [])){
    add(day.style && day.style.bg);
    add(day.still);
    for (const s of (day.stickers || [])) add(s.asset);
    for (const s of (day.spots || [])){
      for (const p of (s.photos || [])) add(p);
      for (const v of (s.videos || [])){ add(v && v.v); add(v && v.p); }
    }
  }
  return used;
}
/* 문서가 가리키는 영상의 바이트 합(한 문서 상한·복구본 간격을 정할 때 쓴다). */
function tripVideoBytes(model, assets){
  let total = 0;
  const seen = new Set();
  for (const day of (model.days || [])) for (const s of (day.spots || [])) for (const v of (s.videos || [])){
    if (!v || seen.has(v.v)) continue;
    seen.add(v.v);
    const asset = assets && assets.get(v.v);
    if (asset && asset.bytes) total += asset.bytes.length;
  }
  return total;
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
    if (TRIP_ASSET_RE.test(name) || TRIP_VIDEO_RE.test(name)) assets.set(name, { bytes:data });
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

/* ---------- 다녀온 지역 ----------
   좌표가 어느 시군구 안인지는 내장 경계(vendor/korea-regions.js)로 **인터넷 없이** 가린다
   (mapProjectedRegionIndex·mapProjectedRegionAt — 색칠 지도가 평면 좌표를 맞출 때 쓰는 길).
   한국 경계만 있으므로 국내에서만 뜻이 있다(설계 2.1). */

function tripRegionTally(model, index){
  const counts = new Map();
  let unknown = 0;
  for (const day of (model.days || [])){
    for (const spot of (day.spots || [])){
      if (spot.lat == null || spot.lng == null) continue;
      const region = typeof mapProjectedRegionAt === "function"
        ? mapProjectedRegionAt(index, [spot.lat, spot.lng]) : null;
      if (!region){ unknown++; continue; }
      const key = region.sido + "\n" + region.sgg;
      const seen = counts.get(key) || { sido:region.sido, sgg:region.sgg, count:0 };
      seen.count++;
      counts.set(key, seen);
    }
  }
  const list = [...counts.values()].sort((a, b) => b.count - a.count
    || (a.sido + a.sgg).localeCompare(b.sido + b.sgg));
  const sidos = new Set(list.map(r => r.sido));
  return { list, sidos:[...sidos], unknown };
}

/* ---------- 다른 문서로 내보내기 ----------
   연대표의 '여행 일정' 모드와 지도의 표시는 여행일지의 장소와 자리가 거의 그대로 맞는다.
   한 방향으로만 보낸다 — 글자로 되살리면 언어·사용자 편집에 깨진다(설계 부록 B.5). */

function tripSpotRows(model){
  const rows = [];
  for (const day of (model.days || [])){
    for (const spot of (day.spots || [])) rows.push({ day, spot });
  }
  return rows;
}

/* 여행일지 → 연대표(.timeline) 의 '여행 일정'. 장소의 첫 사진(없으면 첫 영상의 첫 장면)도 일정 안에 담는다. */
async function tripToTimelineDoc(model, assets, preparePhoto = timelinePreparePhoto){
  const purpose = tripPurpose(model.purpose);
  const doc = timelineDocEmpty(model.title || tripWord(purpose, "docName"));
  doc.purpose = "trip";
  const allRows = tripSpotRows(model);
  const rows = allRows.slice(0, TIMELINE_MAX_EVENTS);
  doc.events = rows.map(({ day, spot }, index) => timelineNormalizeEvent({
    title:spot.name || tripWord(purpose, "spot"),
    start:[day.date, spot.at].filter(Boolean).join(" "),
    category:spot.kind ? tripSpotKindName(purpose, spot.kind) : "",
    placeName:spot.name || "",
    placeAddress:spot.address || "",
    lat:spot.lat, lng:spot.lng,
    description:[spot.note, day.title].filter(Boolean).join("\n"),
    color:"blue"
  }, index));
  const prepared = new Map();
  let photoCount = 0, skippedPhotos = 0, totalChars = 0;
  for (let index = 0; index < rows.length; index++){
    // 사진이 없으면 영상의 첫 장면 그림을 쓴다(연대표는 영상을 담지 않는다).
    const names = [...(rows[index].spot.photos || []), ...(rows[index].spot.videos || []).map(v => v && v.p).filter(Boolean)];
    if (!names.length) continue;
    let photo = null;
    for (const name of names){
      const asset = assets && assets.get(name);
      if (!asset || !asset.bytes) continue;
      if (!prepared.has(name)){
        const mime = diaryAssetMime(name);
        const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
        const fileName = "사진." + extension;
        const file = new File([asset.bytes], fileName, { type:mime });
        prepared.set(name, Promise.resolve().then(() => preparePhoto(file)).catch(() => null));
      }
      photo = await prepared.get(name);
      if (photo) break;
    }
    if (!photo || totalChars + photo.dataUrl.length > TIMELINE_PHOTO_TOTAL_MAX_CHARS){
      skippedPhotos++;
      continue;
    }
    doc.events[index].image = { ...photo, name:(rows[index].spot.name || "사진").slice(0, 100) + ".jpg" };
    totalChars += photo.dataUrl.length;
    photoCount++;
  }
  return { text:timelineDocSerialize(doc), sent:rows.length, photoCount, skippedPhotos,
    omitted:allRows.length - rows.length };
}
/* 여행일지 → 지도(.map). 좌표가 있는 장소만 간다(주소만 있는 줄은 셈해서 알려 준다). */
function tripToMapDoc(model){
  const purpose = tripPurpose(model.purpose);
  const doc = mapDocEmpty(model.title || tripWord(purpose, "docName"));
  const rows = tripSpotRows(model).filter(({ spot }) => spot.lat != null && spot.lng != null);
  doc.markers = rows.map(({ day, spot }) => mapNormalizeMarker({
    lat:spot.lat, lng:spot.lng,
    label:spot.name || tripWord(purpose, "spot"),
    note:[[day.date, spot.at].filter(Boolean).join(" "),
      spot.kind ? tripSpotKindName(purpose, spot.kind) : "",
      spot.address, spot.note].filter(Boolean).join("\n"),
    // .map 에는 장소의 종류가 없다. 업종 칸에 이름을 실어 보내되 되돌려 읽지는 않는다.
    category:spot.kind ? tripSpotKindName(purpose, spot.kind) : "",
    address:spot.address || "",
    color:tripSpotKindColor(spot.kind)
  }));
  doc.route = !!(model.map && model.map.route);
  if (rows.length){
    doc.center = [rows[0].spot.lat, rows[0].spot.lng];
    doc.zoom = rows.length > 1 ? 9 : 13;
  }
  return { text:mapDocSerialize(doc), sent:rows.length, skipped:tripSpotRows(model).length - rows.length };
}

/* ---------- 인쇄 ----------
   화면을 찍지 않고 A4 폭으로 다시 배치한다(일기장과 같은 방식). 종이는 공용 함수가 그리고
   여기서는 갈래마다 다른 머리 칸과 장소·질문 표를 붙인다.
   인쇄 층에는 Leaflet 저작권 줄이 따라오지 않으므로 **자료 출처 한 줄을 앱이 직접 넣는다**(설계 2.5). */

const TRIP_PRINT_WIDTH = 680;

/* 갈래마다 다른 머리 칸의 기본값. 사용자가 header 에 적어 둔 것이 있으면 그것을 쓴다. */
const TRIP_HEADER_DEFAULTS = {
  trip:   [],
  field:  [["학교", ""], ["학년·반", ""], ["이름", ""]],
  survey: [["주제", ""], ["조사자", ""], ["조사일", ""]]
};
function tripPrintHeader(model){
  const rows = (model.header || []).filter(item => item.k || item.v);
  if (rows.length) return rows;
  return (TRIP_HEADER_DEFAULTS[tripPurpose(model.purpose)] || []).map(([k, v]) => ({ k, v }));
}

/* 앱이 쓴 자료의 출처. 쓴 것만 적는다 — 안 쓴 자료의 출처를 적는 것은 틀린 표시다(설계 2.5 규칙 2). */
function tripPrintSources(model){
  const out = [];
  const usedMap = !!(model.map && model.map.still) || (model.days || []).some(d => d.still);
  if (usedMap && typeof MAP_BASEMAPS !== "undefined"){
    const spec = MAP_BASEMAPS[(model.map && model.map.basemap) || "osm"];
    // 굳힌 그림에는 이미 새겨져 있으므로 그림이 있는 쪽은 그림이 맡는다. 여기는 그림 밖에서 쓴 것만.
    if (spec && !usedMap) out.push(spec.attribution);
  }
  const anyCoord = (model.days || []).some(d => (d.spots || []).some(s => s.lat != null));
  // 경계 자료(공공누리 1유형)는 지연 로드라 전역에 있을 때만 이름을 댄다.
  const regions = typeof globalThis !== "undefined" ? globalThis.MN_KOREA_REGIONS : null;
  if (anyCoord && regions && regions.attribution && tripIsDomestic(model)) out.push(regions.attribution);
  const user = String(model.source || "").trim();
  return { app:out, user };
}

/* ---------- 장소 영상: 넣기 전 살피기 · 틀기 ---------- */

function tripIsVideoFile(file){
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  if (/^video\/(mp4|webm|quicktime|x-m4v)$/.test(type)) return true;
  return !type.startsWith("image/") && /\.(mp4|m4v|webm|mov)$/i.test(String(file.name || ""));
}
/* ffmpeg 로 바꿔 넣을 수 있는 영상까지(mkv·avi·휴대폰 HEVC 등). ffmpeg 가 없으면 이 가운데
   tripIsVideoFile 만 받는다. */
function tripIsAnyVideoFile(file){
  if (!file) return false;
  if (tripIsVideoFile(file)) return true;
  const type = String(file.type || "").toLowerCase();
  if (type.startsWith("video/")) return true;
  return !type.startsWith("image/") && /\.(mkv|avi|wmv|3gp|3g2|mts|m2ts|ts|flv|mpe?g|ogv)$/i.test(String(file.name || ""));
}
function tripVideoExt(file){
  const type = String(file.type || "").toLowerCase(), name = String(file.name || "").toLowerCase();
  if (type === "video/webm" || name.endsWith(".webm")) return "webm";
  if (type === "video/quicktime" || name.endsWith(".mov")) return "mov";
  return "mp4";
}
/* 실제 <video> 에 올려 첫 장면이 나오는지 본다 — 확장자만 보고 받으면 HEVC 처럼 이 컴퓨터에서
   안 틀리는 영상이 문서에 들어가 버린다. 되는 영상이면 길이와 첫 장면 그림(JPEG)을 함께 돌려준다. */
async function tripPrepareVideo(file){
  if (!tripIsVideoFile(file)) throw new Error("trip-video-type");
  if (!(file.size > 0) || file.size > TRIP_VIDEO_MAX_BYTES) throw new Error("trip-video-size");
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto";
  const wait = (ok, ms) => new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); video.removeEventListener(ok, pass); video.removeEventListener("error", fail); };
    const pass = () => { done(); resolve(); };
    const fail = () => { done(); reject(new Error("trip-video-play")); };
    const timer = setTimeout(fail, ms);
    video.addEventListener(ok, pass);
    video.addEventListener("error", fail);
  });
  try {
    const loaded = wait("loadeddata", 20000);
    video.src = url;
    await loaded;
    if (!video.videoWidth || !video.videoHeight) throw new Error("trip-video-play");
    // MediaRecorder 로 만든 webm 은 길이가 Infinity 로 온다 — 그땐 크기 상한만 믿는다.
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration > TRIP_VIDEO_MAX_SEC + 0.5) throw new Error("trip-video-long");
    // 첫 장면은 까만 화면인 일이 흔해 조금 들어가서 뜬다. 못 넘어가도 지금 장면으로 그린다.
    const at = duration ? Math.min(1, duration * 0.1) : 0;
    if (at > 0){
      const seeked = wait("seeked", 5000);
      video.currentTime = at;
      try { await seeked; } catch(_){}
    }
    let poster = null;
    try {
      const scale = Math.min(1, TRIP_VIDEO_POSTER_DIM / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    } catch(_){ poster = null; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, ext:tripVideoExt(file), duration:Math.round(duration * 10) / 10, poster };
  } finally {
    video.removeAttribute("src");
    try { video.load(); } catch(_){}
    URL.revokeObjectURL(url);
  }
}
async function tripMediaBackend(){
  return typeof vvMediaBackendAvailable === "function" ? !!(await vvMediaBackendAvailable()) : false;
}
/* 넣을 영상 한 개를 준비한다. 작고 그대로 틀리면 그대로, 아니면(크다·길다·안 틀린다·다른 형식) ffmpeg 로
   줄인 MP4 를 받아 같은 검사를 한 번 더 거친다. 줄인 쪽이 오히려 크면 원본을 쓴다.
   돌려주는 것: { prepared, shrunk, trimmed } — prepared 는 tripPrepareVideo 와 같은 모양. */
async function tripReadyVideo(file, backend, onShrink){
  let direct = null, directError = null;
  if (!tripIsAnyVideoFile(file)) throw new Error("trip-video-type");
  if (tripIsVideoFile(file)){
    try { direct = await tripPrepareVideo(file); } catch(error){ directError = error; }
  } else directError = new Error("trip-video-type");
  if (direct && (!backend || file.size <= TRIP_VIDEO_SHRINK_OVER)) return { prepared:direct, shrunk:false, trimmed:false };
  if (!backend) throw directError;
  if (file.size > TRIP_VIDEO_SHRINK_MAX_BYTES){
    if (direct) return { prepared:direct, shrunk:false, trimmed:false };
    throw new Error("trip-video-source-size");
  }
  if (typeof onShrink === "function") onShrink();
  let res = null;
  try {
    res = await fetch("/shrink-media?dim=" + TRIP_VIDEO_SHRINK_DIM + "&sec=" + TRIP_VIDEO_MAX_SEC, {
      method:"POST", headers:{ "Content-Type":"application/octet-stream" }, body:file
    });
  } catch(_){ res = null; }
  if (!res || !res.ok){
    if (direct) return { prepared:direct, shrunk:false, trimmed:false };
    throw new Error("trip-video-shrink");
  }
  const sourceMs = Number(res.headers.get("X-Media-Source-Duration-Ms")) || 0;
  const base = String(file.name || "video").replace(/\.[^.]+$/, "") || "video";
  const small = new File([await res.blob()], base + ".mp4", { type:"video/mp4" });
  let prepared;
  try { prepared = await tripPrepareVideo(small); }
  catch(error){ if (direct) return { prepared:direct, shrunk:false, trimmed:false }; throw error; }
  if (direct && prepared.bytes.length >= direct.bytes.length) return { prepared:direct, shrunk:false, trimmed:false };
  return { prepared, shrunk:true, trimmed:sourceMs > (TRIP_VIDEO_MAX_SEC + 0.5) * 1000 };
}
function tripVideoProblem(error){
  const code = String((error && error.message) || error || "");
  const en = tripIsEn();
  const mb = n => Math.round(n / 1048576);
  if (code === "trip-video-type") return en ? "Only mp4, webm or mov videos can be added." : "mp4·webm·mov 영상만 넣을 수 있어요.";
  if (code === "trip-video-size") return en
    ? "The video is too large (up to " + mb(TRIP_VIDEO_MAX_BYTES) + "MB)."
    : "영상이 너무 커요(" + mb(TRIP_VIDEO_MAX_BYTES) + "MB까지).";
  if (code === "trip-video-long") return en
    ? "The video is too long (up to " + TRIP_VIDEO_MAX_SEC + " seconds)."
    : "영상이 너무 길어요(" + TRIP_VIDEO_MAX_SEC + "초까지).";
  if (code === "trip-video-total") return en
    ? "This document can hold up to " + mb(TRIP_VIDEO_TOTAL_MAX_BYTES) + "MB of video in total."
    : "이 문서에 넣을 수 있는 영상은 모두 합해 " + mb(TRIP_VIDEO_TOTAL_MAX_BYTES) + "MB까지예요.";
  if (code === "trip-video-count") return en
    ? "Each place can have up to " + TRIP_MAX_VIDEOS + " videos."
    : "장소 하나에 영상은 " + TRIP_MAX_VIDEOS + "개까지예요.";
  if (code === "trip-video-same") return en ? "That video is already here." : "이미 넣은 영상이에요.";
  if (code === "trip-video-source-size") return en
    ? "The original video is too large to shrink (up to 1GB)."
    : "원본 영상이 너무 커서 줄일 수 없어요(1GB까지).";
  if (code === "trip-video-shrink") return en
    ? "Couldn't shrink this video. Please convert it to mp4 (H.264) and try again."
    : "영상을 줄이지 못했어요. mp4(H.264)로 바꿔서 넣어 주세요.";
  return en
    ? "This video can't be played on this computer. Please convert it to mp4 (H.264) and try again."
    : "이 컴퓨터에서 재생할 수 없는 영상이에요. mp4(H.264)로 바꿔서 넣어 주세요.";
}
function tripFormatDuration(sec){
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/* 누르면 곧바로 틀리는 창. 사용자가 누른 동작 안에서 play() 를 부르므로 소리까지 바로 나온다.
   껍데기를 .modal 로 두어 화면보호기의 '바쁨' 판정에도 걸린다. 창은 하나만 만들어 계속 쓴다. */
let _tripVideoPlayer = null;
function tripOpenVideoPlayer(list, start){
  const items = (list || []).filter(it => it && it.src);
  if (!items.length || typeof document === "undefined") return;
  if (!_tripVideoPlayer){
    const modal = document.createElement("div");
    modal.className = "modal trip-video-modal";
    modal.hidden = true;
    const card = document.createElement("div");
    card.className = "modal-card trip-video-card";
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
    const head = document.createElement("div"); head.className = "trip-video-head";
    const title = document.createElement("h3"); title.className = "trip-video-title";
    const count = document.createElement("span"); count.className = "trip-video-count";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button"; closeBtn.className = "trip-video-x"; closeBtn.textContent = "×";
    head.append(title, count, closeBtn);
    const body = document.createElement("div"); body.className = "trip-video-body";
    const video = document.createElement("video");
    video.className = "trip-video-player"; video.controls = true; video.playsInline = true; video.preload = "auto";
    const prev = document.createElement("button"); prev.type = "button"; prev.className = "trip-video-nav prev"; prev.textContent = "‹";
    const next = document.createElement("button"); next.type = "button"; next.className = "trip-video-nav next"; next.textContent = "›";
    body.append(prev, video, next);
    card.append(head, body);
    modal.append(card);
    document.body.append(modal);
    const player = { modal, card, title, count, video, prev, next, closeBtn, items:[], index:0, lastFocus:null };
    const show = (i) => {
      player.index = (i + player.items.length) % player.items.length;
      const item = player.items[player.index];
      video.poster = item.poster || "";
      video.src = item.src;
      title.textContent = item.title || "";
      count.textContent = player.items.length > 1 ? (player.index + 1) + " / " + player.items.length : "";
      prev.hidden = next.hidden = player.items.length < 2;
      const playing = video.play();
      if (playing && typeof playing.catch === "function") playing.catch(() => {});
    };
    // Esc 는 여기서 먹는다 — 흘려보내면 편집기·다른 창이 같은 키로 또 무언가를 닫는다.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation();
      close();
    };
    const close = () => {
      if (modal.hidden) return;
      modal.hidden = true;
      video.pause();
      video.removeAttribute("src"); video.removeAttribute("poster");
      try { video.load(); } catch(_){}
      player.items = [];
      window.removeEventListener("keydown", onKey, true);
      const back = player.lastFocus; player.lastFocus = null;
      if (back && typeof back.focus === "function" && back.isConnected){ try { back.focus(); } catch(_){} }
    };
    closeBtn.addEventListener("click", close);
    prev.addEventListener("click", () => show(player.index - 1));
    next.addEventListener("click", () => show(player.index + 1));
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
    player.show = show; player.close = close; player.onKey = onKey;
    _tripVideoPlayer = player;
  }
  const player = _tripVideoPlayer;
  const en = tripIsEn();
  player.closeBtn.title = en ? "Close" : "닫기"; player.closeBtn.setAttribute("aria-label", player.closeBtn.title);
  player.prev.setAttribute("aria-label", en ? "Previous video" : "이전 영상");
  player.next.setAttribute("aria-label", en ? "Next video" : "다음 영상");
  player.card.setAttribute("aria-label", en ? "Play video" : "영상 보기");
  if (player.modal.hidden){
    player.lastFocus = document.activeElement;
    window.addEventListener("keydown", player.onKey, true);
  }
  player.items = items;
  player.modal.hidden = false;
  player.show(Math.max(0, Math.min(items.length - 1, start | 0)));
  try { player.video.focus(); } catch(_){}
}

/* ---------- 편집기 ---------- */

const TRIP_RECOVERY_DELAY = 1500;
const TRIP_RECOVERY_VIDEO_DELAY = 8000;

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
  // '＋ 날' 이 날짜를 미리 채운 뒤 아직 사용자가 날짜를 고르지 않은 날(문서에는 남기지 않는다).
  const autoDated = new Set();
  let recoveryTimer = 0;

  /* 사진 주소는 한 번 만들어 두고 다시 쓴다(문서에 썸네일을 따로 담지 않는다). */
  const urls = new Map();
  const assetUrl = (name) => {
    if (!name || !assets.has(name)) return "";
    if (!urls.has(name)){
      const asset = assets.get(name);
      urls.set(name, URL.createObjectURL(new Blob([asset.bytes], { type:tripAssetMime(name) })));
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
  const brand = document.createElement("div");
  brand.className = "trip-brand";
  const brandMark = document.createElement("span");
  brandMark.className = "trip-brand-mark";
  brandMark.setAttribute("aria-hidden", "true");
  brandMark.innerHTML = diaryArtSvg("mountain", "trip-brand-art");
  const brandWords = document.createElement("span");
  brandWords.className = "trip-brand-words";
  const brandTitle = document.createElement("strong");
  brandTitle.className = "trip-brand-title";
  const brandSub = document.createElement("span");
  brandSub.className = "trip-brand-sub";
  brandWords.append(brandTitle, brandSub);
  brand.append(brandMark, brandWords);
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
  status.dataset.placeholder = tripIsEn()
    ? "Record your journey. Ctrl+Z will undo changes."
    : "여행을 기록해보세요. Ctrl+Z로 되돌릴 수 있어요.";
  const undoBtn = diaryButton("", "실행 취소 (Ctrl+Z)", "diary-btn trip-undo-btn", "undo");
  const redoBtn = diaryButton("", "다시 실행 (Ctrl+Shift+Z)", "diary-btn trip-redo-btn", "redo");
  const photoBtn = diaryButton("", "사진 붙이기", "diary-btn trip-photo-btn", "image");
  const photoInput = document.createElement("input");
  photoInput.type = "file"; photoInput.accept = "image/*"; photoInput.multiple = true; photoInput.hidden = true;
  const exifBtn = diaryButton("", "사진에 찍힌 때·자리로 장소 만들기", "diary-btn trip-exif-btn", "map");
  const exifInput = document.createElement("input");
  exifInput.type = "file"; exifInput.accept = "image/jpeg,image/jpg"; exifInput.multiple = true; exifInput.hidden = true;
  const stickerBtn = diaryButton("", "그림·글상자 붙이기", "diary-btn trip-sticker-btn", "sticker");
  const styleBtn = diaryButton("", "종이 꾸미기", "diary-btn trip-style-btn", "sliders");
  const bgInput = document.createElement("input");
  bgInput.type = "file"; bgInput.accept = "image/*"; bgInput.hidden = true;
  const printBtn = diaryButton("", "인쇄 · PDF 로 저장", "diary-btn trip-print-btn", "print");
  const exportBtn = diaryButton("", "일정·지도로 내보내기", "diary-btn trip-export-btn", "export");
  const saveBtn = diaryButton("", "저장 (Ctrl+S)", "diary-btn diary-primary trip-save-btn", "save");
  const toolLabel = (button, ko, en) => {
    const label = document.createElement("span");
    label.className = "trip-tool-label";
    label.textContent = tripIsEn() ? en : ko;
    button.classList.add("trip-tool-button");
    button.append(label);
  };
  toolLabel(undoBtn, "되돌리기", "Undo");
  toolLabel(redoBtn, "다시하기", "Redo");
  toolLabel(photoBtn, "사진추가", "Add photo");
  toolLabel(exifBtn, "사진정보", "Photo info");
  toolLabel(stickerBtn, "꾸미기", "Decorate");
  toolLabel(styleBtn, "편집/설정", "Style");
  toolLabel(printBtn, "인쇄", "Print");
  toolLabel(exportBtn, "내보내기", "Export");
  toolLabel(saveBtn, "저장", "Save");
  const actions = document.createElement("div");
  actions.className = "trip-bar-actions";
  actions.append(undoBtn, redoBtn, photoBtn, photoInput, exifBtn, exifInput,
    stickerBtn, styleBtn, bgInput, printBtn, exportBtn, saveBtn);
  bar.append(brand, purposeSelect, titleInput, status, actions);

  /* ----- 본문: 여정 띠 + 종이 ----- */
  const body = document.createElement("div");
  body.className = "trip-body";
  const rail = document.createElement("div");
  rail.className = "trip-rail";
  const railTitlebar = document.createElement("div");
  railTitlebar.className = "trip-rail-titlebar";
  const railIcon = document.createElement("span");
  railIcon.className = "trip-rail-icon";
  railIcon.setAttribute("aria-hidden", "true");
  if (typeof window.uiIcon === "function") railIcon.innerHTML = window.uiIcon("calendar");
  const railHead = document.createElement("div");
  railHead.className = "trip-rail-head";
  const railChevron = document.createElement("span");
  railChevron.className = "trip-rail-chevron";
  railChevron.setAttribute("aria-hidden", "true");
  if (typeof window.uiIcon === "function") railChevron.innerHTML = window.uiIcon("chevronUp");
  railTitlebar.append(railIcon, railHead, railChevron);
  const railList = document.createElement("div");
  railList.className = "trip-rail-list";
  const addDayBtn = document.createElement("button");
  addDayBtn.type = "button";
  addDayBtn.className = "diary-btn trip-add-day";
  rail.append(railTitlebar, railList, addDayBtn);

  /* 지도 칸 — 좌표가 있는 장소를 표시로 찍고 목록 차례대로 잇는다(설계 2.3).
     칸은 접을 수 있다. 접기는 보는 사람 편의라 파일이 아니라 이 브라우저에만 남긴다. */
  const mapPane = document.createElement("aside");
  mapPane.className = "trip-map-pane";
  const mapHead = document.createElement("div");
  mapHead.className = "trip-map-head";
  const mapHeadIcon = document.createElement("span");
  mapHeadIcon.className = "trip-map-head-icon";
  mapHeadIcon.setAttribute("aria-hidden", "true");
  if (typeof window.uiIcon === "function") mapHeadIcon.innerHTML = window.uiIcon("map");
  const mapTitle = document.createElement("span");
  mapTitle.className = "trip-map-title";
  const scopeBtn = diaryButton("", "이 날 / 여행 전체", "diary-btn trip-map-scope", "list");
  const scopeLabel = document.createElement("span");
  scopeLabel.className = "trip-map-scope-label";
  scopeBtn.append(scopeLabel);
  const routeBtn = diaryButton("", "표시를 목록 차례대로 잇기", "diary-btn trip-route-btn", "route");
  const freezeBtn = diaryButton("", "지도 그림으로 굳히기", "diary-btn trip-freeze-btn", "camera");
  mapHead.append(mapHeadIcon, mapTitle, scopeBtn, routeBtn, freezeBtn);
  const mapStage = document.createElement("div");
  mapStage.className = "trip-map-stage";
  const mapNote = document.createElement("p");
  mapNote.className = "trip-map-note";
  const mapGuide = document.createElement("div");
  mapGuide.className = "trip-map-guide";
  const mapGuideIcon = document.createElement("span");
  mapGuideIcon.setAttribute("aria-hidden", "true");
  if (typeof window.uiIcon === "function") mapGuideIcon.innerHTML = window.uiIcon("map");
  const mapGuideText = document.createElement("span");
  mapGuideText.textContent = tripIsEn()
    ? "Use the map button on a place card to set its location."
    : "장소 카드의 지도 버튼으로 위치를 지정하세요.";
  mapGuide.append(mapGuideIcon, mapGuideText);
  const stillBox = document.createElement("div");
  stillBox.className = "trip-still";
  stillBox.hidden = true;
  const stillImg = document.createElement("img");
  stillImg.className = "trip-still-img";
  stillImg.alt = "굳힌 지도 그림";
  const stillNote = document.createElement("p");
  stillNote.className = "trip-still-note";
  const stillRemoveBtn = diaryButton("굳힌 그림 지우기", "굳힌 그림 지우기", "diary-btn trip-still-remove");
  const stillFoot = document.createElement("div");
  stillFoot.className = "trip-still-foot";
  stillFoot.append(stillNote, stillRemoveBtn);
  stillBox.append(stillImg, stillFoot);
  /* 다녀온 지역 — 좌표가 어느 시군구 안인지 내장 경계로 가려 센다. 국내에서만 뜻이 있다. */
  const regionBox = document.createElement("div");
  regionBox.className = "trip-regions";
  regionBox.hidden = true;
  const regionHead = document.createElement("div");
  regionHead.className = "trip-regions-head";
  const regionList = document.createElement("div");
  regionList.className = "trip-region-list";
  regionBox.append(regionHead, regionList);
  mapPane.append(mapHead, mapStage, mapNote, mapGuide, regionBox, stillBox);

  const mapDivider = document.createElement("div");
  mapDivider.className = "trip-map-divider";
  mapDivider.tabIndex = 0;
  mapDivider.setAttribute("role", "separator");
  mapDivider.setAttribute("aria-orientation", "vertical");
  mapDivider.title = tripIsEn()
    ? "Drag to resize the editor and map · Double-click to reset"
    : "드래그해서 편집 화면과 지도 화면의 크기 조절 · 더블클릭하면 초기화";
  mapDivider.setAttribute("aria-label", mapDivider.title);

  const main = document.createElement("div");
  main.className = "trip-main diary-main";
  const pageHead = document.createElement("div");
  pageHead.className = "trip-page-head diary-page-head";
  const dayTitle = document.createElement("input");
  dayTitle.type = "text";
  dayTitle.className = "trip-day-title";
  dayTitle.maxLength = 200;
  const dayDateField = document.createElement("div");
  dayDateField.className = "trip-day-date-field";
  const dayDate = document.createElement("input");
  dayDate.type = "date";
  dayDate.className = "trip-day-date";
  dayDate.setAttribute("aria-label", tripIsEn() ? "Date" : "날짜");
  const dayDateDisplay = document.createElement("span");
  dayDateDisplay.className = "trip-day-date-display";
  dayDateDisplay.setAttribute("aria-hidden", "true");
  const dayDateIcon = document.createElement("span");
  dayDateIcon.className = "trip-day-date-icon";
  dayDateIcon.setAttribute("aria-hidden", "true");
  if (typeof window.uiIcon === "function") dayDateIcon.innerHTML = window.uiIcon("calendar");
  dayDateField.append(dayDateDisplay, dayDateIcon, dayDate);
  const weatherBtn = diaryButton("", "그날 그곳 날씨 받기", "diary-btn trip-weather-btn", "sun");
  const weatherText = document.createElement("span");
  weatherText.className = "trip-weather-text";
  const deleteBtn = diaryButton("", "이 날 지우기", "diary-btn trip-day-delete", "delete");
  pageHead.append(dayDateField, dayTitle, weatherBtn, weatherText, deleteBtn);

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
  /* 경비 — 여행 갈래에만 있다. 환율은 받은 날 값을 문서에 굳힌다(설계 4장 budget.rate):
     나중에 열었을 때 값이 저절로 달라지면 그때 쓴 돈이 아니게 된다. */
  const budgetBox = document.createElement("div");
  budgetBox.className = "trip-budget";
  budgetBox.hidden = true;
  const budgetSum = document.createElement("span");
  budgetSum.className = "trip-budget-sum";
  const currencyInput = document.createElement("input");
  currencyInput.type = "text"; currencyInput.className = "trip-currency"; currencyInput.maxLength = 3;
  currencyInput.title = "쓴 돈의 화폐(USD·JPY 처럼 세 글자)";
  const rateInput = document.createElement("input");
  rateInput.type = "text"; rateInput.className = "trip-rate"; rateInput.maxLength = 12; rateInput.inputMode = "decimal";
  rateInput.title = "1 단위가 몇 원인지 — 받은 날 값을 그대로 굳혀 둡니다";
  const rateBtn = diaryButton("", "환율 찾아보기", "diary-btn trip-rate-btn", "exchange");
  budgetBox.append(budgetSum, currencyInput, rateInput, rateBtn);
  spotsBox.append(spotsHead, spotList, spotsEmpty, budgetBox);

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
  body.append(rail, main, mapDivider, mapPane);
  root.append(bar, body);

  /* ----- 저장 여부·복구본 ----- */
  const setStatus = (msg) => { status.textContent = msg || ""; };
  const refreshDirty = () => {
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, tripContentKey(model) !== doc.savedText);
  };
  const scheduleRecovery = () => {
    clearTimeout(recoveryTimer);
    if (typeof appSettings === "object" && appSettings && appSettings.pdfRecovery === false) return;
    // 복구본은 ZIP 전체를 다시 쓴다. 영상이 들어 있으면 글자 몇 개마다 수십 MB 를 새로 쓰게 되므로
    // 간격을 넓힌다(사진만 있는 문서는 그대로).
    const delay = tripVideoBytes(model, assets) > 0 ? TRIP_RECOVERY_VIDEO_DELAY : TRIP_RECOVERY_DELAY;
    recoveryTimer = setTimeout(() => { recoveryTimer = 0; flushRecovery(); }, delay);
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
  /* ----- 그날 그곳 날씨 -----
     일기장은 사용자가 고른 관측 지점 하나를 쓰지만, 여행일지는 **그날 들른 자리**를 안다.
     그래서 지점을 묻지 않고 그날 첫 좌표에서 가장 가까운 지점을 고른다(nearestStation).
     기상청 자료라 국내에서만 된다 — 한국 밖이면 단추를 감춘다(설계 2.1). */
  const weatherApi = typeof MNWeatherApi !== "undefined" ? MNWeatherApi : null;
  let weatherReady = false;
  if (weatherApi) weatherApi.available().then(ok => {
    if (!ok || !root.isConnected) return;
    weatherReady = true;
    syncWeather();
    requestSpecialMonths();
  }).catch(() => {});

  /* 공휴일·24절기 — 한국천문연구원 특일. 런처(EXE)가 키로 대신 묻는다.
     그리기는 **받아 둔 것만** 보고(cachedSpecialDays), 받아 오는 일은 따로 한다 —
     그래야 인터넷이 없어도 화면이 막히지 않고, 이미 받아 둔 달은 그대로 뜬다. */
  const specialFailed = new Set();
  function specialItemsOf(dateKey){
    if (!weatherApi || !tripIsDateKey(dateKey)) return [];
    const items = weatherApi.cachedSpecialDays(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)));
    return items ? items.filter(item => item.date === dateKey) : [];
  }
  function requestSpecialMonths(){
    if (!weatherApi || !weatherReady) return;
    const months = new Set();
    for (const day of (model.days || [])) if (day.date) months.add(day.date.slice(0, 7));
    for (const ym of months){
      const year = Number(ym.slice(0, 4)), month = Number(ym.slice(5, 7));
      const key = year * 100 + month;
      if (specialFailed.has(key) || weatherApi.cachedSpecialDays(year, month)) continue;
      weatherApi.loadSpecialDays(year, month)
        .then(() => { if (root.isConnected) renderRail(); })
        .catch(() => { specialFailed.add(key); });
    }
  }

  function dayStation(day){
    const spot = (day && day.spots || []).find(s => s.lat != null && s.lng != null);
    return spot && weatherApi ? weatherApi.nearestStation(spot.lat, spot.lng) : null;
  }
  function syncWeather(){
    const day = dayOf(current);
    const station = dayStation(day);
    const domestic = tripIsDomestic(model);
    const show = !!(weatherReady && day && day.date && station && domestic);
    weatherBtn.hidden = !show;
    weatherBtn.disabled = !show;
    if (show) weatherBtn.title = tripTf("{place} 관측으로 날씨 채우기", { place:station.name });
    // 이미 들어 있는 값은 갈래·나라와 상관없이 그대로 보여 준다(감춤이지 지움이 아니다).
    const info = day && day.weather && typeof diaryWeatherInfo === "function" ? diaryWeatherInfo(day.weather) : null;
    weatherText.textContent = info ? (diaryIsEn && diaryIsEn() ? info[3] : info[2]) : "";
  }
  async function fillWeather(){
    const day = dayOf(current);
    const station = dayStation(day);
    if (!day || !day.date || !station || !weatherReady) return;
    weatherBtn.disabled = true;
    setStatus(tripT("기상청 날씨를 받는 중…"));
    try {
      const today = diaryDateKey(new Date());
      const ahead = Math.round((diaryDateFromKey(day.date) - diaryDateFromKey(today)) / 86400000);
      let value = "", summary = "";
      const round = v => v == null ? "" : String(Math.round(v * 10) / 10);
      if (ahead < 0){
        const d = await weatherApi.loadDay(station.id, day.date);
        value = d.diary;
        summary = [tripTf("{place} 관측", { place:d.station || station.name }),
          d.max != null ? tripTf("최고 {max}°", { max:round(d.max) }) : "",
          d.min != null ? tripTf("최저 {min}°", { min:round(d.min) }) : ""].filter(Boolean).join(" · ");
      } else if (ahead === 0){
        const n = await weatherApi.loadNow(station.lat, station.lng);
        value = n.diary;
        summary = [tripTf("{place} 지금", { place:station.name }),
          n.temp != null ? tripTf("기온 {t}°", { t:round(n.temp) }) : ""].filter(Boolean).join(" · ");
      } else if (ahead <= 5){
        const f = await weatherApi.loadForecast(station.lat, station.lng);
        const found = f.days.find(d => d.date === day.date.replace(/-/g, "") && d.sky != null);
        if (found){ value = found.diary; summary = tripTf("{place} 예보", { place:station.name }); }
      }
      if (!value){ setStatus(tripT("기상청 자료로 날씨를 정하지 못했어요.")); return; }
      if (history) history.flush();
      day.weather = value;
      syncWeather(); renderRail(); touch(true);
      setStatus(summary || tripT("날씨를 채웠어요."));
    } catch(error){
      setStatus(weatherApi ? tripT(weatherApi.failureText(error, "day")) : tripT("날씨를 받지 못했어요."));
    } finally { syncWeather(); }
  }
  weatherBtn.addEventListener("click", fillWeather);

  /* ----- 사진에서 장소 만들기 -----
     EXIF 는 **줄여 굽기 전 원본 바이트**에서 읽어야 한다 — diaryPrepareImage 를 지나면 통째로 날아간다.
     찍힌 날짜와 같은 날이 여정에 있으면 그 날에, 없으면 촬영 날짜별 날을 만들어 같은 날 사진끼리 모은다.
     날짜가 없는 사진만 보고 있는 날에 넣는다. GPS 는 개인정보라 이 단추를 누른 사진만 읽는다. */
  async function makeSpotsFromPhotos(files){
    let fallbackDay = dayOf(current);
    if (!fallbackDay && !files.length) return;
    let made = 0, noExif = 0, noGps = 0;
    const freshSpots = new Set();
    if (history) history.flush();
    const prepared = [];
    for (const file of files){
      let info;
      try { info = tripReadExif(new Uint8Array(await file.arrayBuffer())); }
      catch(_){ info = { date:"", at:"", lat:null, lng:null }; }
      if (!info.date && info.lat == null){ noExif++; continue; }
      if (info.lat == null) noGps++;
      prepared.push({ file, info });
    }

    const daysByDate = new Map();
    for (const day of (model.days || [])) if (day.date && !daysByDate.has(day.date)) daysByDate.set(day.date, day);
    // 보고 있는 날이 비어 있으면 새 날을 만드는 대신 다시 쓴다. '＋ 날' 이 미리 채운 날짜만 있고 손대지
    // 않은 날도 빈 날로 친다(사용자가 고른 날짜는 지키고) — 그 날짜로 찍은 사진이 있으면 그 자리라 그대로 둔다.
    const photoDates = new Set(prepared.map(item => item.info.date).filter(tripIsDateKey));
    const blank = fallbackDay && (tripDayIsEmpty(fallbackDay) || (autoDated.has(fallbackDay.id)
      && tripDayIsEmpty({ ...fallbackDay, date:"" }) && !photoDates.has(fallbackDay.date)));
    let reusableBlank = blank ? fallbackDay : null;
    const missingDates = tripMissingPhotoDates(model.days, prepared.map(item => item.info));
    const placed = [];
    for (const date of missingDates){
      let day = reusableBlank;
      if (day){
        if (daysByDate.get(day.date) === day) daysByDate.delete(day.date);
        autoDated.delete(day.id);
        day.date = date;
        reusableBlank = null;
      } else {
        day = tripNormalizeDay({ date, title:"" });
        model.days.push(day);
      }
      placed.push(day);
      daysByDate.set(date, day);
      if (!fallbackDay) fallbackDay = day;
      if (!current) current = day.id;
    }

    for (const { file, info } of prepared){
      let target = info.date ? daysByDate.get(info.date) : fallbackDay;
      // 날짜 없이 GPS 만 남은 사진도 모든 날을 지운 상태에서 받을 수 있어야 한다.
      if (!target){
        target = ensureDay("");
        fallbackDay = target;
      }
      if (target.spots.length >= TRIP_MAX_SPOTS) continue;
      let asset = null;
      try { asset = await addAsset(file, DIARY_STICKER_MAX_DIM); }
      catch(error){ console.warn("장소 사진을 붙이지 못했어요:", error); }
      const name = String(file.name || "").replace(/\.[a-z0-9]+$/i, "").slice(0, 120);
      const spotId = tripSpotId();
      freshSpots.add(spotId);
      target.spots.push({
        id:spotId, at:info.at || "", name, address:"", note:"", kind:"",
        lat:info.lat, lng:info.lat == null ? null : info.lng,
        color:"", cost:null, photos:asset ? [asset.name] : [], fields:[]
      });
      made++;
    }
    for (const day of (model.days || [])) day.spots = tripSortSpotsByTime(day.spots);
    const importedDates = [...new Set(prepared.map(item => item.info.date).filter(tripIsDateKey))].sort();
    // 새로 만들거나 날짜를 바꾼 날만 날짜 자리에 끼운다. 통째로 정렬하면 사이에 둔 날짜 없는 날이 끝으로 밀린다.
    for (const day of placed) model.days = tripPlaceDayByDate(model.days, day);
    // 현재 날 지도는 선택한 날만 보여 준다. 가져온 첫 날짜로 이동해야 장소와 표식이 곧바로 보인다.
    if (made && importedDates.length){
      const firstImportedDay = daysByDate.get(importedDates[0]);
      if (firstImportedDay) current = firstImportedDay.id;
    }
    // renderPage 가 종이 스티커와 장소 사진을 모델에서 함께 다시 그린다. 어느 한쪽을 덮어쓰지 않는다.
    renderRail(); renderPage();
    if (made) touch(true);
    showFreshSpots(freshSpots);
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

  /* ----- 장소 영상 -----
     장소 줄의 영상 단추나 줄 위로 떨어뜨린 영상을 그 장소에 단다. 살피는 동안(비동기) 되돌리기로
     모델이 바뀔 수 있으므로 장소는 id 로 붙잡고, 다 준비한 뒤 지금 모델에서 다시 찾아 한 번에 넣는다. */
  const videoInput = document.createElement("input");
  videoInput.type = "file"; videoInput.multiple = true; videoInput.hidden = true; videoInput.className = "trip-video-input";
  videoInput.accept = "video/*,.mp4,.m4v,.webm,.mov,.mkv,.avi,.wmv,.3gp,.mts,.m2ts";
  root.append(videoInput);
  let videoTarget = "", videoBusy = false;
  const spotById = (id) => {
    for (const day of (model.days || [])) for (const spot of (day.spots || [])) if (spot.id === id) return spot;
    return null;
  };
  async function addVideosToSpot(spotId, files){
    if (!files.length) return;
    if (videoBusy){ setStatus(tripIsEn() ? "Still adding a video — try again in a moment." : "영상을 넣는 중이에요. 잠시 뒤에 다시 해 주세요."); return; }
    videoBusy = true;
    const picked = [], problems = [];
    let shrunkCount = 0, trimmedCount = 0;
    try {
      const first = spotById(spotId);
      const have = new Set(((first && first.videos) || []).map(v => v.v));
      let room = TRIP_MAX_VIDEOS - have.size;
      let total = tripVideoBytes(model, assets);
      const backend = await tripMediaBackend();
      for (const file of files){
        try {
          if (room <= 0) throw new Error("trip-video-count");
          setStatus((tripIsEn() ? "Checking video… " : "영상을 살펴보는 중… ") + (file.name || ""));
          const ready = await tripReadyVideo(file, backend, () => setStatus(tripIsEn()
            ? "Shrinking video… " + (file.name || "") + " (may take a few dozen seconds)"
            : "영상을 작게 줄이는 중… " + (file.name || "") + " (몇십 초 걸릴 수 있어요)"));
          const prepared = ready.prepared;
          const name = "assets/" + await diaryHashBytes(prepared.bytes) + "." + prepared.ext;
          if (have.has(name)) throw new Error("trip-video-same");
          if (!assets.has(name) && total + prepared.bytes.length > TRIP_VIDEO_TOTAL_MAX_BYTES) throw new Error("trip-video-total");
          if (ready.shrunk) shrunkCount++;
          if (ready.trimmed) trimmedCount++;
          let poster = "";
          if (prepared.poster){
            const made = await addAsset(prepared.poster, TRIP_VIDEO_POSTER_DIM);
            if (made) poster = made.name;
          }
          if (!assets.has(name)){ assets.set(name, { bytes:prepared.bytes }); total += prepared.bytes.length; }
          have.add(name);
          picked.push({ v:name, p:poster, d:prepared.duration });
          room--;
        } catch(error){
          const message = tripVideoProblem(error);
          if (!problems.includes(message)) problems.push(message);
          if (String(error && error.message) === "trip-video-count") break;
        }
      }
    } finally { videoBusy = false; }
    const spot = spotById(spotId);
    if (picked.length && spot){
      if (history) history.flush();
      spot.videos = [...(spot.videos || []), ...picked].slice(0, TRIP_MAX_VIDEOS);
      renderSpots(); touch(true);
    }
    const added = spot ? picked.length : 0;
    const notes = [];
    if (added && shrunkCount) notes.push(tripIsEn() ? shrunkCount + " shrunk" : "작게 줄임 " + shrunkCount + "개");
    if (added && trimmedCount) notes.push(tripIsEn()
      ? trimmedCount + " cut to the first " + TRIP_VIDEO_MAX_SEC + "s"
      : "앞 " + TRIP_VIDEO_MAX_SEC + "초만 " + trimmedCount + "개");
    const tail = notes.length ? (tripIsEn() ? " (" + notes.join(", ") + ")" : "(" + notes.join(" · ") + ")") : "";
    const done = added ? (tripIsEn() ? "Added " + added + " video" + (added > 1 ? "s" : "") + tail + "." : "영상 " + added + "개를 넣었어요" + tail + ".") : "";
    setStatus([done, ...problems].filter(Boolean).join(" "));
    if (problems.length && typeof toast === "function") toast(problems.join("\n"), 6000, { type:"error" });
  }
  videoInput.addEventListener("change", async () => {
    const files = [...(videoInput.files || [])]; videoInput.value = "";
    const target = videoTarget; videoTarget = "";
    if (files.length && target) await addVideosToSpot(target, files);
  });
  const hasVideoItems = (dt) => !!dt && [...(dt.items || [])].some(it => it.kind === "file" && tripIsAnyVideoFile({ type:it.type, name:"" }));

  /* ----- 지도 칸 -----
     지도 만들기·타일·저작권 줄은 .map 문서 것을 그대로 부른다(mapCreateTileLayer·mapAttachNetworkNotice).
     인터넷이 없으면 타일이 안 오지만 칸은 그대로 두고 알림만 띄운다 — 좌표는 여전히 볼 수 있다. */
  let leafletMap = null, markerLayer = null, routeLine = null, tileLayer = null;
  let mapReady = false, mapFailed = false, tilesDrawn = 0, freezing = false;
  let pickingFor = "";                  // '지도에서 찍기' 를 누른 장소 id

  /* 편집 화면 ↔ 지도 화면 분할 바. 폭은 문서 내용이 아니라 보는 환경이므로 이 브라우저에만 남긴다.
     Leaflet 은 컨테이너 폭이 바뀐 사실을 스스로 모르므로 드래그하는 동안 invalidateSize 도 함께 부른다. */
  const TRIP_MAP_WIDTH_DEFAULT = 320;
  let tripMapWidth = TRIP_MAP_WIDTH_DEFAULT, mapResizeRaf = 0;
  try {
    const saved = Number(localStorage.getItem("mn.tripMapWidth"));
    if (saved >= 240 && saved <= 720) tripMapWidth = saved;
  } catch(_){}
  const tripMapWidthLimit = () => {
    // 좁은 화면에서는 지도와 분할 바가 감춰진다. 그때 저장 폭까지 줄이지 말고 다시 넓어질 때 복원한다.
    if (matchMedia("(max-width: 1100px)").matches) return 720;
    return Math.max(240, Math.min(720, body.clientWidth - rail.offsetWidth - 360 - mapDivider.offsetWidth));
  };
  const syncMapAfterResize = () => {
    cancelAnimationFrame(mapResizeRaf);
    mapResizeRaf = requestAnimationFrame(() => {
      mapResizeRaf = 0;
      if (leafletMap) leafletMap.invalidateSize({ pan:false });
      syncFreezeBtn();
    });
  };
  const applyTripMapWidth = (next) => {
    tripMapWidth = Math.max(240, Math.min(tripMapWidthLimit(), Number(next) || TRIP_MAP_WIDTH_DEFAULT));
    body.style.setProperty("--trip-map", Math.round(tripMapWidth) + "px");
    mapDivider.setAttribute("aria-valuemin", "240");
    mapDivider.setAttribute("aria-valuemax", String(Math.round(tripMapWidthLimit())));
    mapDivider.setAttribute("aria-valuenow", String(Math.round(tripMapWidth)));
    syncMapAfterResize();
  };
  const rememberTripMapWidth = () => {
    try { localStorage.setItem("mn.tripMapWidth", String(Math.round(tripMapWidth))); } catch(_){}
  };
  applyTripMapWidth(tripMapWidth);
  mapDivider.addEventListener("pointerdown", (e) => {
    if (matchMedia("(max-width: 1100px)").matches) return;
    e.preventDefault();
    mapDivider.setPointerCapture(e.pointerId);
    mapDivider.classList.add("dragging");
    const move = (ev) => {
      const rect = body.getBoundingClientRect();
      applyTripMapWidth(rect.right - ev.clientX - mapDivider.offsetWidth / 2);
    };
    const up = () => {
      mapDivider.classList.remove("dragging");
      mapDivider.removeEventListener("pointermove", move);
      mapDivider.removeEventListener("pointerup", up);
      mapDivider.removeEventListener("pointercancel", up);
      rememberTripMapWidth();
    };
    mapDivider.addEventListener("pointermove", move);
    mapDivider.addEventListener("pointerup", up);
    mapDivider.addEventListener("pointercancel", up);
  });
  mapDivider.addEventListener("dblclick", () => {
    applyTripMapWidth(TRIP_MAP_WIDTH_DEFAULT);
    rememberTripMapWidth();
  });
  mapDivider.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    applyTripMapWidth(tripMapWidth + (e.key === "ArrowLeft" ? 20 : -20));
    rememberTripMapWidth();
  });
  const onTripWindowResize = () => applyTripMapWidth(tripMapWidth);
  window.addEventListener("resize", onTripWindowResize);

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
      const center = (model.map && model.map.center) || TRIP_DEFAULT_MAP_CENTER;
      leafletMap.setView(center, (model.map && model.map.zoom) || TRIP_DEFAULT_MAP_ZOOM);
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
        renderSpots(); renderMap(); syncWeather(); touch(true);
        setStatus(tripT("자리를 찍었어요."));
      });
      // 보고 있던 자리는 문서에 남긴다 — 다음에 저장하면 그 자리에서 시작한다.
      // 다만 편집은 아니다: 탭을 열면 장소에 맞춰 지도가 저절로 움직이므로(showMap 의 fitBounds),
      // 여기서 touch() 하면 고치지도 않았는데 '저장 안 됨'(●)이 켜지고 되돌리기 단계까지 생겼다.
      leafletMap.on("moveend zoomend", () => {
        if (!leafletMap) return;
        const c = leafletMap.getCenter();
        model.map = { ...model.map, center:[Math.round(c.lat * 1e6) / 1e6, Math.round(c.lng * 1e6) / 1e6],
          zoom:leafletMap.getZoom() };
      });
      mapReady = true;
      return true;
    } catch(error){
      console.warn("여행일지 지도를 열지 못했어요:", error);
      mapFailed = true;
      return false;
    }
  }

  /* 표식 미리보기 카드. 사진 먼저, 그다음 영상(첫 장면 + ▶) — 모두 합쳐 4칸까지.
     사진을 누르면 사진끼리 크게 보고, 영상을 누르면 그 장소 영상들을 곧바로 튼다. */
  function tripMapPhotoCard(spot, markerNumber){
    const photos = (spot.photos || []).map(assetUrl).filter(Boolean);
    const videos = (spot.videos || []).filter(v => assets.has(v.v));
    if (!photos.length && !videos.length) return null;
    const placeName = spot.name || tripWord(model.purpose, "spot");
    const card = document.createElement("div");
    card.className = "trip-map-photo-card";
    const head = document.createElement("div");
    head.className = "trip-map-photo-head";
    const title = document.createElement("strong");
    title.textContent = markerNumber + ". " + placeName;
    const count = document.createElement("span");
    const counts = [];
    if (photos.length) counts.push(tripIsEn() ? photos.length + " photos" : "사진 " + photos.length + "장");
    if (videos.length) counts.push(tripIsEn() ? videos.length + (videos.length > 1 ? " videos" : " video") : "영상 " + videos.length + "개");
    count.textContent = counts.join(" · ");
    head.append(title, count);
    card.append(head);
    const metaText = [spot.at || "", spot.address || ""].filter(Boolean).join(" · ");
    if (metaText){
      const meta = document.createElement("div");
      meta.className = "trip-map-photo-meta";
      meta.textContent = metaText;
      card.append(meta);
    }
    const items = [...photos.map((src, at) => ({ kind:"photo", src, at })),
      ...videos.map((video, at) => ({ kind:"video", src:video.p ? assetUrl(video.p) : "", at, video }))];
    const shown = items.slice(0, 4);
    const gallery = document.createElement("div");
    gallery.className = "trip-map-photo-gallery";
    gallery.dataset.count = String(shown.length);
    for (const [slot, item] of shown.entries()){
      const button = document.createElement("button");
      button.type = "button";
      button.className = "trip-map-photo-thumb" + (item.kind === "video" ? " trip-map-video-thumb" : "");
      button.title = item.kind === "video" ? (tripIsEn() ? "Play video" : "영상 틀기") : tripT("사진 크게 보기");
      if (item.src){
        const img = document.createElement("img");
        img.src = item.src;
        img.alt = placeName + (items.length > 1 ? " (" + (slot + 1) + "/" + items.length + ")" : "");
        img.loading = "lazy";
        button.append(img);
      }
      if (item.kind === "video"){
        const badge = document.createElement("span");
        badge.className = "trip-spot-video-badge";
        if (typeof window.uiIcon === "function") badge.innerHTML = window.uiIcon("play");
        button.append(badge);
        if (item.video.d){
          const length = document.createElement("span");
          length.className = "trip-spot-video-dur";
          length.textContent = tripFormatDuration(item.video.d);
          button.append(length);
        }
      }
      if (slot === 3 && items.length > 4){
        const more = document.createElement("span");
        more.className = "trip-map-photo-more";
        more.textContent = "+" + (items.length - 4);
        button.append(more);
      }
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (item.kind === "video"){
          tripOpenVideoPlayer(videos.map(video => ({
            src:assetUrl(video.v), poster:video.p ? assetUrl(video.p) : "", title:placeName
          })), item.at);
          return;
        }
        if (typeof window.openImageLightbox !== "function") return;
        window.openImageLightbox(photos.map((photoSrc, index) => ({
          src:photoSrc,
          alt:placeName + (photos.length > 1 ? " (" + (index + 1) + "/" + photos.length + ")" : "")
        })), item.at);
      });
      gallery.append(button);
    }
    card.append(gallery);
    return card;
  }

  function bindTripMarkerPreview(marker, spot, markerNumber){
    if (!(spot.photos || []).some(name => assets.has(name)) && !(spot.videos || []).some(v => assets.has(v.v))){
      marker.bindTooltip(markerNumber + ". " + (spot.name || tripWord(model.purpose, "spot")), { direction:"top" });
      return;
    }
    let card = null;
    let closeTimer = 0;
    const cancelClose = () => { clearTimeout(closeTimer); closeTimer = 0; };
    const closeSoon = () => {
      if (window.matchMedia && !window.matchMedia("(hover: hover)").matches) return;
      cancelClose();
      closeTimer = setTimeout(() => { closeTimer = 0; marker.closePopup(); }, 220);
    };
    const openPreview = () => {
      cancelClose();
      if (!card){
        card = tripMapPhotoCard(spot, markerNumber);
        if (!card) return;
        marker.bindPopup(card, {
          minWidth:220, maxWidth:270, closeButton:false, autoPan:false,
          offset:[0, -8], className:"trip-map-photo-popup"
        });
        card.addEventListener("mouseenter", cancelClose);
        card.addEventListener("mouseleave", closeSoon);
      }
      marker.openPopup();
    };
    marker.on("mouseover", openPreview);
    marker.on("click", openPreview);
    marker.on("mouseout", closeSoon);
  }

  function renderMap(){
    const purpose = tripPurpose(model.purpose);
    mapTitle.textContent = tripWord(purpose, "mapPane") + (mapScope === "all" ? " · " + tripT("여행 전체") : "");
    scopeLabel.textContent = mapScope === "all"
      ? (tripIsEn() ? "All" : "전체")
      : (tripIsEn() ? "Day" : "이 날");
    scopeBtn.classList.toggle("is-on", mapScope === "all");
    routeBtn.classList.toggle("is-on", !!(model.map && model.map.route));
    routeBtn.title = tripWord(purpose, "route");
    const list = spotsWithCoords();
    mapNote.textContent = list.length ? "" : tripWord(purpose, "mapEmpty");
    mapNote.hidden = !!list.length;
    syncFreezeBtn();
    renderStill();
    renderRegions();
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
      bindTripMarkerPreview(marker, spot, at + 1);
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
  /* ----- 다녀온 지역 -----
     경계 자료(약 0.4MB)는 좌표가 생긴 뒤에만 한 번 읽는다. 없으면 이 칸만 조용히 감춘다. */
  let regionIndex = null, regionTried = false;
  async function renderRegions(){
    const purpose = tripPurpose(model.purpose);
    const word = tripWord(purpose, "choro");                 // 학습지 갈래에는 빈 낱말 = 감춤
    const anyCoord = (model.days || []).some(d => (d.spots || []).some(s => s.lat != null));
    if (!word || !anyCoord || !tripIsDomestic(model)){ regionBox.hidden = true; return; }
    if (!regionIndex && !regionTried){
      regionTried = true;
      try {
        if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("koreaRegions");
        regionIndex = typeof mapProjectedRegionIndex === "function" ? mapProjectedRegionIndex() : null;
      } catch(_){ regionIndex = null; }
      if (!root.isConnected) return;
    }
    if (!regionIndex){ regionBox.hidden = true; return; }
    const tally = tripRegionTally(model, regionIndex);
    regionBox.hidden = !tally.list.length;
    if (!tally.list.length) return;
    regionHead.textContent = word + " · " + tripTf("{a}개 시도 · {b}곳", { a:tally.sidos.length, b:tally.list.length });
    regionList.innerHTML = "";
    for (const region of tally.list){
      const chip = document.createElement("span");
      chip.className = "trip-region-chip";
      chip.textContent = region.sgg + (region.count > 1 ? " ×" + region.count : "");
      chip.title = region.sido + " " + region.sgg;
      regionList.append(chip);
    }
  }

  function renderStill(){
    const holder = stillHolder();
    const name = holder && holder.still;
    const url = name ? assetUrl(name) : "";
    stillBox.hidden = !url;
    if (!url){ stillImg.removeAttribute("src"); stillNote.textContent = ""; return; }
    stillImg.src = url;
    stillRemoveBtn.textContent = tripWord(model.purpose, "mapRemove");
    stillRemoveBtn.title = stillRemoveBtn.textContent;
    stillRemoveBtn.setAttribute("aria-label", stillRemoveBtn.title);
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
  stillRemoveBtn.addEventListener("click", () => {
    const holder = stillHolder();
    if (!holder || !holder.still) return;
    if (history) history.flush();
    holder.still = "";
    holder.stillKey = "";
    renderStill();
    touch(true);
    setStatus(tripIsEn() ? "Frozen map image removed. Press Ctrl+Z to undo."
      : "굳힌 지도 그림을 지웠어요. Ctrl+Z 로 되돌릴 수 있어요.");
  });

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
      // 공휴일·24절기가 있으면 이름을 옆에 단다. 쉬는 날은 붉게.
      for (const item of specialItemsOf(day.date)){
        const badge = document.createElement("span");
        badge.className = "trip-day-special" + (item.holiday ? " is-holiday" : "");
        badge.textContent = item.name;
        head.append(badge);
      }
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

  /* 사진으로 만든 장소를 곧바로 보이게 — 들른 곳 목록으로 내려가고 새로 생긴 줄을 잠깐 밝힌다.
     글 칸에 포커스를 주지 않는다(가져온 뒤 누른 글쇠가 장소 이름을 고치면 안 된다). */
  function showFreshSpots(ids){
    const rows = [...spotList.querySelectorAll(".trip-spot")].filter(row => ids.has(row.dataset.id));
    if (!rows.length) return;
    // 부드럽게 굴리지 않는다: 장소 사진이 뜨며 종이 엔진이 다시 재면(layout) scrollTop 을 되써 넣는데,
    // 그 순간 굴러가던 스크롤이 멈춰 목록까지 못 간다. 곧장 옮겨 두면 되써 넣는 값도 그 자리다.
    // scrollIntoView 는 바깥 칸까지 모두 굴려 편집기 전체가 위로 밀린다 — 글 칸(스크롤 칸)만 굴린다.
    let scroller = spotsBox.parentElement;
    while (scroller && scroller !== root && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement;
    if (!scroller || scroller === root) { spotsBox.scrollIntoView({ block:"nearest" }); }
    else {
      const top = scroller.scrollTop + spotsBox.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
      scroller.scrollTop = Math.max(0, top);
    }
    for (const row of rows){
      row.classList.remove("is-fresh");
      void row.offsetWidth;
      row.classList.add("is-fresh");
      row.addEventListener("animationend", () => row.classList.remove("is-fresh"), { once:true });
    }
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
      const videoBtn = diaryButton("", tripIsEn()
        ? "Add a short video (up to " + TRIP_VIDEO_MAX_SEC + "s)"
        : "짧은 영상 넣기 (" + TRIP_VIDEO_MAX_SEC + "초까지)", "diary-btn trip-spot-video-add", "video");
      line1.append(at, icon, kindSelect, name, videoBtn, pickBtn, removeBtn);
      pickBtn.addEventListener("click", () => startPicking(spot.id));
      videoBtn.addEventListener("click", () => { videoTarget = spot.id; videoInput.click(); });
      row.addEventListener("dragover", (e) => {
        if (!hasVideoItems(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        row.classList.add("is-drop");
      });
      row.addEventListener("dragleave", (e) => { if (!row.contains(e.relatedTarget)) row.classList.remove("is-drop"); });
      row.addEventListener("drop", (e) => {
        row.classList.remove("is-drop");
        const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
        const videos = files.filter(tripIsAnyVideoFile);
        if (!videos.length) return;
        // 영상만 떨어뜨렸으면 새 탭으로 열리지 않게 여기서 끝낸다(섞였으면 나머지는 평소처럼 열린다).
        e.preventDefault();
        if (videos.length === files.length) e.stopPropagation();
        addVideosToSpot(spot.id, videos);
      });

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

      const spotPhotos = (spot.photos || []).map((asset, at2) => ({ asset, at:at2, src:assetUrl(asset) })).filter(item => item.src);
      const spotVideos = (spot.videos || []).filter(v => assets.has(v.v));
      if (spotPhotos.length || spotVideos.length){
        const strip = document.createElement("div");
        strip.className = "trip-spot-photos";
        for (const photo of spotPhotos){
          const tile = document.createElement("div");
          tile.className = "trip-spot-photo";
          const view = document.createElement("button");
          view.type = "button"; view.className = "trip-spot-photo-view";
          view.title = tripT("사진 크게 보기");
          const img = document.createElement("img");
          img.src = photo.src; img.alt = spot.name || tripT("장소 사진");
          view.append(img);
          view.addEventListener("click", () => {
            if (typeof window.openImageLightbox !== "function") return;
            window.openImageLightbox(spotPhotos.map((item, i) => ({
              src:item.src, alt:(spot.name || tripT("장소 사진")) + (spotPhotos.length > 1 ? " (" + (i + 1) + "/" + spotPhotos.length + ")" : "")
            })), photo.at);
          });
          const removePhoto = diaryButton("", "이 사진 빼기", "diary-btn trip-spot-photo-remove", "close");
          removePhoto.addEventListener("click", () => {
            if (history) history.flush();
            spot.photos = (spot.photos || []).filter(name2 => name2 !== photo.asset);
            renderSpots(); touch(true);
            setStatus(tripT("사진을 뺐어요. Ctrl+Z 로 되돌릴 수 있어요."));
          });
          tile.append(view, removePhoto);
          strip.append(tile);
        }
        spotVideos.forEach((video, videoAt) => {
          const tile = document.createElement("div");
          tile.className = "trip-spot-photo trip-spot-video";
          const view = document.createElement("button");
          view.type = "button"; view.className = "trip-spot-photo-view trip-spot-video-view";
          view.title = tripIsEn() ? "Play video" : "영상 틀기";
          const posterSrc = video.p ? assetUrl(video.p) : "";
          if (posterSrc){
            const img = document.createElement("img");
            img.src = posterSrc; img.alt = spot.name || (tripIsEn() ? "Place video" : "장소 영상");
            view.append(img);
          }
          const badge = document.createElement("span");
          badge.className = "trip-spot-video-badge";
          if (typeof window.uiIcon === "function") badge.innerHTML = window.uiIcon("play");
          view.append(badge);
          if (video.d){
            const length = document.createElement("span");
            length.className = "trip-spot-video-dur";
            length.textContent = tripFormatDuration(video.d);
            view.append(length);
          }
          view.addEventListener("click", () => {
            const label = spot.name || (tripIsEn() ? "Place video" : "장소 영상");
            tripOpenVideoPlayer(spotVideos.map(item => ({
              src:assetUrl(item.v), poster:item.p ? assetUrl(item.p) : "", title:label
            })), videoAt);
          });
          const removeVideo = diaryButton("", tripIsEn() ? "Remove this video" : "이 영상 빼기",
            "diary-btn trip-spot-photo-remove", "close");
          removeVideo.addEventListener("click", () => {
            if (history) history.flush();
            spot.videos = (spot.videos || []).filter(item => item.v !== video.v);
            renderSpots(); touch(true);
            setStatus(tripIsEn() ? "Video removed. Use Undo to bring it back." : "영상을 뺐어요. 되돌리기 단추로 되살릴 수 있어요.");
          });
          tile.append(view, removeVideo);
          strip.append(tile);
        });
        row.append(strip);
      }

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
        unit.title = tripT("이 여행의 화폐 — 아래에서 바꿔요");
        cost.addEventListener("input", () => {
          // Number("") 는 0 이다 — 빈 칸을 0원으로 적으면 안 된다.
          const text = cost.value.replace(/[^0-9.]/g, "");
          spot.cost = text ? tripNormalizeCost({ amount:Number(text), currency:unit.textContent }) : null;
          renderBudget();
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
        day.spots = tripSortSpotsByTime(day.spots);
        renderSpots();
        renderMap();
        syncWeather();
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
        // 장소와 지도는 같은 자료를 읽는다. 목록에서 뺀 즉시 표식·동선·지역 집계와
        // 그 장소를 기준으로 하던 날씨까지 함께 다시 그려야 지도에 낡은 표식이 남지 않는다.
        if (pickingFor === spot.id){
          pickingFor = "";
          mapStage.classList.remove("is-picking");
        }
        renderSpots(); renderRail(); renderMap(); syncWeather(); touch(true);
        setStatus(tripT("지웠어요. Ctrl+Z 로 되돌릴 수 있어요."));
      });
      spotList.append(row);
    }
    renderBudget();
  }

  /* ----- 경비 합계 -----
     화폐가 섞여 있으면 합치지 않는다 — 5,000원과 5,000엔을 더한 수는 아무 뜻이 없다.
     여행 화폐가 원이 아니면 굳혀 둔 환율로 원화 환산을 함께 보여 준다. */
  function sumCost(days){
    const byCurrency = new Map();
    for (const day of days){
      for (const spot of (day.spots || [])){
        if (!spot.cost) continue;
        const cur = spot.cost.currency || "KRW";
        byCurrency.set(cur, (byCurrency.get(cur) || 0) + spot.cost.amount);
      }
    }
    return byCurrency;
  }
  const moneyText = (amount, currency) => {
    const digits = currency === "KRW" || currency === "JPY" ? 0 : 2;
    const text = typeof MNExchangeRate !== "undefined" && MNExchangeRate
      ? MNExchangeRate.formatMoney(amount, digits) : String(Math.round(amount));
    return currency === "KRW" ? text + "원" : text + " " + currency;
  };
  function renderBudget(){
    const purpose = tripPurpose(model.purpose);
    if (!tripHasWord(purpose, "cost")){ budgetBox.hidden = true; return; }
    const day = dayOf(current);
    const here = sumCost(day ? [day] : []);
    const all = sumCost(model.days || []);
    budgetBox.hidden = !all.size;
    if (!all.size) return;
    const parts = [];
    for (const [cur, amount] of here) parts.push(tripWordf(purpose, "costTotal", { sum:moneyText(amount, cur) }));
    const total = [...all].map(([cur, amount]) => moneyText(amount, cur)).join(" + ");
    parts.push(tripTf("모두 {sum}", { sum:total }));
    // 여행 화폐가 원이 아니고 환율을 적어 두었으면 원화로도 보여 준다.
    const rate = model.budget && model.budget.rate;
    const cur = (model.budget && model.budget.currency) || "KRW";
    if (rate && cur !== "KRW" && all.has(cur)) parts.push("≈ " + moneyText(all.get(cur) * rate, "KRW"));
    budgetSum.textContent = parts.join(" · ");
    currencyInput.value = cur;
    rateInput.value = rate ? String(rate) : "";
    rateInput.hidden = cur === "KRW";
    rateBtn.hidden = cur === "KRW" || typeof window.openExchangeRate !== "function";
  }
  currencyInput.addEventListener("change", () => {
    const value = String(currencyInput.value || "").trim().toUpperCase().slice(0, 3);
    model.budget = tripNormalizeBudget({ ...model.budget, currency:/^[A-Z]{3}$/.test(value) ? value : "KRW" });
    renderBudget(); renderSpots(); touch(true);
  });
  rateInput.addEventListener("change", () => {
    const text = String(rateInput.value || "").replace(/[^0-9.]/g, "");
    model.budget = tripNormalizeBudget({ ...model.budget, rate:text ? Number(text) : null });
    renderBudget(); touch(true);
  });
  rateBtn.addEventListener("click", () => {
    if (typeof window.openExchangeRate === "function") window.openExchangeRate();
    setStatus(tripT("환율을 찾아 1 단위가 몇 원인지 적어 두세요 — 그날 값으로 굳습니다."));
  });

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
    dayDateDisplay.textContent = day ? (day.date || (tripIsEn() ? "Choose date" : "날짜 선택")) : "";
    dayDateField.classList.toggle("is-empty", !!day && !day.date);
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
    syncWeather();
  }

  addDayBtn.addEventListener("click", () => {
    if (history) history.flush();
    const day = tripNormalizeDay({ title:"" });
    day.title = "";
    day.date = tripNextDayDate(model);
    if (day.date) autoDated.add(day.id);
    model.days.push(day);
    current = day.id;
    if (day.date) requestSpecialMonths();
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
    const picked = tripIsDateKey(dayDate.value) ? dayDate.value : "";
    const taken = tripDateTakenBy(model, day, picked);
    if (taken) {
      // 날짜 고르개는 날짜 하나하나를 막을 수 없어서, 고른 뒤에 받지 않고 원래 날짜로 돌려놓는다.
      dayDate.value = day.date || "";
      setStatus(tripTf("{date} 은(는) 이미 {day}이에요. 다른 날짜를 고르세요.",
        { date:picked, day:tripDayLabel(model, taken).replace(picked + " ", "") }));
      return;
    }
    day.date = picked;
    autoDated.delete(day.id);
    const moved = tripPlaceDayByDate(model.days, day);
    const reordered = moved.some((d, i) => d !== model.days[i]);
    if (reordered) model.days = moved;
    dayDateDisplay.textContent = day.date || (tripIsEn() ? "Choose date" : "날짜 선택");
    dayDateField.classList.toggle("is-empty", !day.date);
    requestSpecialMonths();
    renderRail();
    if (reordered) {
      renderPage();
      setStatus(tripT("날짜에 맞춰 차례를 옮겼어요. 되돌리기 단추로 원래 자리로 돌릴 수 있어요."));
    }
    touch(true);
  });
  titleInput.addEventListener("input", () => { model.title = titleInput.value; touch(); });

  /* ----- 갈래 바꾸기 — 말과 기본값만 바뀌고 자료는 그대로다(설계 3장) ----- */
  function applyPurposeLabels(){
    const p = tripPurpose(model.purpose);
    root.dataset.purpose = p;
    brandTitle.textContent = tripWord(p, "docName");
    brandSub.textContent = p === "survey" ? "Fieldwork Report"
      : p === "field" ? "Field Trip Report" : "Travel Diary";
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
  const snapshot = () => JSON.stringify({ title:model.title, purpose:model.purpose, style:model.style, days:model.days,
    mapStill:(model.map && model.map.still) || "", mapStillKey:(model.map && model.map.stillKey) || "" });
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
      model.map = { ...model.map, still:parsed.mapStill || "", stillKey:parsed.mapStillKey || "" };
      if (!dayOf(current)) current = model.days.length ? model.days[0].id : "";
      titleInput.value = model.title || "";
      purposeSelect.value = model.purpose;
      applyPurposeLabels();
      refreshDirty();
      scheduleRecovery();
    },
    onChange:updateHistoryButtons
  });
  /* ----- 인쇄 ----- */
  function buildPrintPage(day, index, first){
    const purpose = tripPurpose(model.purpose);
    const W = TRIP_PRINT_WIDTH;
    const waits = [];
    const page = document.createElement("section");
    page.className = "trip-print-page";
    if (first){
      const top = document.createElement("div");
      top.className = "trip-print-title";
      top.textContent = model.title || tripWord(purpose, "docName");
      page.append(top);
      const rows = tripPrintHeader(model);
      if (rows.length){
        const head = document.createElement("div");
        head.className = "trip-print-header";
        for (const item of rows){
          const cell = document.createElement("span");
          cell.className = "trip-print-header-cell";
          cell.textContent = item.k + " " + (item.v || "____________");
          head.append(cell);
        }
        page.append(head);
      }
    }
    // header 태그는 쓰지 않는다 — 전역 header{color:#fff} 를 물려받아 흰 종이에 흰 글자가 된다.
    const dayHead = document.createElement("div");
    dayHead.className = "trip-print-day";
    dayHead.textContent = [tripWordf(purpose, "dayNth", { n:index + 1 }), day.date, day.title]
      .filter(Boolean).join(" · ");
    page.append(dayHead);

    const style = diaryEffectiveStyle(model, day);
    const built = diaryBuildPrintPaper(day, style, W, model.printPlain, { assetUrl });
    built.paperEl.style.width = W + "px";
    page.append(built.paperEl);
    waits.push(...built.waits);

    if ((day.prompts || []).length && tripHasWord(purpose, "prompts")){
      const box = document.createElement("div");
      box.className = "trip-print-prompts";
      for (const prompt of day.prompts){
        const row = document.createElement("div");
        row.className = "trip-print-prompt";
        const q = document.createElement("div"); q.className = "trip-print-q"; q.textContent = prompt.q;
        const a = document.createElement("div"); a.className = "trip-print-a";
        a.textContent = prompt.a || "";           // 비어 있으면 답 쓸 자리로 남는다
        row.append(q, a);
        box.append(row);
      }
      page.append(box);
    }

    if ((day.spots || []).length){
      const table = document.createElement("table");
      table.className = "trip-print-spots";
      const head = document.createElement("tr");
      for (const label of [tripWord(purpose, "spotAt"), tripWord(purpose, "spot"),
        tripWord(purpose, "spotNote"), tripHasWord(purpose, "cost") ? tripWord(purpose, "cost") : ""]){
        if (!label) continue;
        const th = document.createElement("th"); th.textContent = label; head.append(th);
      }
      table.append(head);
      for (const spot of day.spots){
        const row = document.createElement("tr");
        const cells = [spot.at || "",
          [spot.name, spot.kind ? "(" + tripSpotKindName(purpose, spot.kind) + ")" : "", spot.address]
            .filter(Boolean).join(" "),
          [spot.note, ...(spot.fields || []).map(f => f.k + ": " + f.v)].filter(Boolean).join(" / ")];
        if (tripHasWord(purpose, "cost")) cells.push(spot.cost ? moneyText(spot.cost.amount, spot.cost.currency) : "");
        for (const text of cells){
          const td = document.createElement("td"); td.textContent = text; row.append(td);
        }
        // 종이는 영상을 틀 수 없다 — 있다는 것과 길이만 적는다(첫 장면 그림을 찍으면 사진으로 오해한다).
        const printVideos = (spot.videos || []).filter(v => assets.has(v.v));
        if (printVideos.length && row.children[1]){
          const mark = document.createElement("div");
          mark.className = "trip-print-video";
          const lengths = printVideos.map(v => v.d ? tripFormatDuration(v.d) : "").filter(Boolean);
          mark.textContent = "▶ " + (tripIsEn()
            ? printVideos.length + (printVideos.length > 1 ? " videos" : " video")
            : "영상 " + printVideos.length + "개") + (lengths.length ? " · " + lengths.join(", ") : "");
          row.children[1].append(mark);
        }
        table.append(row);
      }
      page.append(table);
    }

    /* 굳힌 지도 그림. 없으면 그 자리를 비운다 — 회색 지도를 넣느니 아무것도 안 넣는다(설계 2.3 규칙 5). */
    const stillUrl = day.still ? assetUrl(day.still) : "";
    if (stillUrl){
      const img = document.createElement("img");
      img.className = "trip-print-map";
      img.alt = tripWord(purpose, "mapPane");
      img.src = stillUrl;
      if (img.decode) waits.push(img.decode().catch(() => {}));
      page.append(img);
    }
    return { page, waits };
  }

  async function printDays(list){
    if (!list.length) return false;
    const fonts = new Set(list.map(d => diaryEffectiveStyle(model, d).font));
    for (const d of list) for (const st of (d.stickers || [])) if (diaryStickerKind(st) === "text") fonts.add(st.font);
    await Promise.all([...fonts].map(diaryEnsureFont));
    const old = document.getElementById("tripPrintLayer");
    if (old) old.remove();
    const layer = document.createElement("div");
    layer.id = "tripPrintLayer";
    layer.className = "trip-print diary-doc ui-keep-symbols";
    const waits = [];
    list.forEach((day, i) => {
      const built = buildPrintPage(day, (model.days || []).indexOf(day), i === 0);
      layer.append(built.page);
      waits.push(...built.waits);
    });
    // 표지에 여행 전체 지도가 굳어 있으면 맨 뒤에 한 장 더 붙인다.
    const allStill = model.map && model.map.still ? assetUrl(model.map.still) : "";
    if (allStill){
      const page = document.createElement("section");
      page.className = "trip-print-page";
      const img = document.createElement("img");
      img.className = "trip-print-map";
      img.alt = tripWord(model.purpose, "mapPane");
      img.src = allStill;
      if (img.decode) waits.push(img.decode().catch(() => {}));
      page.append(img);
      layer.append(page);
    }
    // 자료 출처 — 인쇄는 화면을 찍지 않아 저작권 줄이 따라오지 않는다(설계 2.5).
    const sources = tripPrintSources(model);
    if (sources.app.length || sources.user){
      const foot = document.createElement("div");
      foot.className = "trip-print-sources";
      if (sources.user){
        const mine = document.createElement("div");
        mine.textContent = tripWord(model.purpose, "source") || "자료 출처";
        mine.append(document.createElement("br"));
        mine.append(sources.user);
        foot.append(mine);
      }
      if (sources.app.length){
        const app = document.createElement("div");
        app.className = "trip-print-sources-app";
        app.textContent = sources.app.join(" · ");
        foot.append(app);
      }
      layer.append(foot);
    }
    document.body.appendChild(layer);
    await Promise.all(waits);
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", cleanup);
      document.body.classList.remove("trip-printing");
      layer.remove();
    };
    try {
      window.addEventListener("afterprint", cleanup);
      document.body.classList.add("trip-printing");
      window.print();
    } finally { cleanup(); }
    return true;
  }
  doc.printTrip = () => printDays(model.days || []);

  printBtn.addEventListener("click", () => {
    const day = dayOf(current);
    const r = printBtn.getBoundingClientRect();
    MNContextMenu.open(r.left, r.bottom + 4, [
      { label:tripWord(model.purpose, "printDay"), disabled:!day, action:() => printDays(day ? [day] : []) },
      { label:tripWord(model.purpose, "printAll"), disabled:!(model.days || []).length,
        action:() => printDays(model.days || []) }
    ], { autoFocus:true });
  });

  /* ----- 내보내기 ----- */
  async function openAsDoc(text, name, mime){
    if (typeof handleFiles !== "function") return false;
    await handleFiles([new File([text], name, { type:mime })], { isScratch:true });
    return true;
  }
  const exportBase = () => (String(model.title || "").trim() || tripWord(model.purpose, "fileBase")).slice(0, 60);
  async function exportTimeline(){
    const rows = tripSpotRows(model);
    if (!rows.length){ setStatus(tripWord(model.purpose, "spotEmpty")); return; }
    exportBtn.disabled = true;
    setStatus(tripT("사진을 일정에 넣는 중이에요…"));
    try {
      const out = await tripToTimelineDoc(model, assets);
      if (!await openAsDoc(out.text, exportBase() + ".timeline", "application/json")) return;
      const parts = [tripTf("일정 {n}개를 연대표로 보냈어요", { n:out.sent })];
      if (out.photoCount) parts.push(tripTf("사진 {n}장 포함", { n:out.photoCount }));
      if (out.skippedPhotos) parts.push(tripTf("사진 {n}장은 읽기 오류·용량 제한으로 빠졌어요", { n:out.skippedPhotos }));
      if (out.omitted) parts.push(tripTf("일정 {n}개는 연대표 개수 제한으로 빠졌어요", { n:out.omitted }));
      setStatus(parts.join(" · "));
    } catch(error){
      console.warn("여행 일정을 내보내지 못했어요:", error);
      setStatus(tripT("일정을 내보내지 못했어요."));
    } finally { exportBtn.disabled = false; }
  }
  async function exportMap(){
    const out = tripToMapDoc(model);
    if (!out.sent){ setStatus(tripWord(model.purpose, "mapEmpty")); return; }
    await openAsDoc(out.text, exportBase() + ".map", "application/json");
    setStatus(out.skipped
      ? tripTf("{n}곳을 지도로 보냈어요 · {s}곳은 좌표가 없어 빠졌어요", { n:out.sent, s:out.skipped })
      : tripTf("{n}곳을 지도로 보냈어요", { n:out.sent }));
  }
  exportBtn.addEventListener("click", () => {
    const r = exportBtn.getBoundingClientRect();
    MNContextMenu.open(r.left, r.bottom + 4, [
      { label:tripWord(model.purpose, "exportTimeline"), action:exportTimeline },
      { label:tripWord(model.purpose, "exportMap"), action:exportMap }
    ], { autoFocus:true });
  });

  undoBtn.addEventListener("click", () => history.undo());
  redoBtn.addEventListener("click", () => history.redo());
  saveBtn.addEventListener("click", () => saveTrip(doc));

  const onKey = (e) => {
    if (!root.isConnected || activeId !== doc.id) return;
    if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "s"){
      e.preventDefault(); saveTrip(doc); return;
    }
    if (!doc.el.contains(document.activeElement) && !root.contains(e.target)) return;
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
    cancelAnimationFrame(mapResizeRaf);
    window.removeEventListener("resize", onTripWindowResize);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onOutside, true);
    if (typeof paperApi.destroyPaper === "function") paperApi.destroyPaper();
    if (leafletMap){ leafletMap.remove(); leafletMap = null; }
    if (_tripVideoPlayer) _tripVideoPlayer.close();   // 아래에서 영상 주소를 거두기 전에 닫는다
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
    tripIsDateKey, tripNormalizeTime, tripSortSpotsByTime, tripNormalizeSpot, tripNormalizeDay, tripDayIsEmpty,
    tripMissingPhotoDates, tripPlaceDayByDate, tripDateTakenBy, tripNextDayDate,
    tripNormalizePairs, tripNormalizePrompts, tripNormalizeCost, tripNormalizeMap, tripNormalizeBudget,
    tripEmpty, tripNormalize, tripCleanDays, tripCleanSpot, tripModelJson, tripContentKey,
    TRIP_VIDEO_MAX_BYTES, TRIP_VIDEO_TOTAL_MAX_BYTES, TRIP_VIDEO_MAX_SEC, TRIP_MAX_VIDEOS,
    tripNormalizeVideo, tripAssetMime, tripVideoBytes, tripIsVideoFile, tripIsAnyVideoFile,
    tripReferencedAssets, tripPack, tripUnpack, tripIsDomestic, tripPlainText,
    tripReadExif, tripExifWhen,
    tripScratchFileName, tripStarterBytes
  };
}
