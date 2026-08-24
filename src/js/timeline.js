"use strict";

/* ===== 연대표 문서(.timeline) =====
   사건·기간·유적지·사진을 JSON 한 파일에 담아, 인터넷 없이 만들고 발표하는 수업용 연대표다.
   날짜는 2026 / 2026-08 / 2026-08-20 / 2026-08-20 09:30뿐 아니라 "기원전 300"·"BC 300"도 받는다.
   화면 배치는 보기 상태지만 균등/시간 비례 방식은 자료를 만든 의도라 문서에 함께 저장한다. */

const TIMELINE_DOC_TYPE = "classdock-timeline";
const TIMELINE_DOC_VERSION = 2;
const TIMELINE_MAX_EVENTS = 1000;
const TIMELINE_PHOTO_MAX_DATA_CHARS = 900 * 1024;
/* 사진은 base64 로 문서 안에 들어간다. 총량 상한은 파일 크기·저장 시간을 감당할 만큼만 둔다.
   되돌리기 기록과 수정 여부 판정은 사진 바이트를 복사하지 않으므로(timelineSnapshot) 여기서 막는 건
   "한 파일에 담을 사진 총량" 하나뿐이다. */
const TIMELINE_PHOTO_TOTAL_MAX_CHARS = 40 * 1024 * 1024;
const TIMELINE_PHOTO_TOTAL_LABEL = Math.round(TIMELINE_PHOTO_TOTAL_MAX_CHARS / (1024 * 1024)) + "MB";
const TIMELINE_PHOTO_MAX_SIDE = 1280;
const TIMELINE_RECOVERY_DELAY = 900;
const TIMELINE_TYPING_DELAY = 550;
const TIMELINE_HISTORY_LIMIT = 80;
const TIMELINE_ZOOM_MIN = 0.55;
const TIMELINE_ZOOM_MAX = 2.2;
const TIMELINE_ZOOM_STEP = 0.15;
const TIMELINE_STAGE_HEIGHT = 780;
const TIMELINE_OVERVIEW_MIN_HEIGHT = 320;

const TIMELINE_COLORS = [
  { id:"rose",   label:"빨강", hex:"#e11d48" },
  { id:"blue",   label:"파랑", hex:"#2563eb" },
  { id:"green",  label:"초록", hex:"#16a34a" },
  { id:"amber",  label:"노랑", hex:"#d97706" },
  { id:"purple", label:"보라", hex:"#7c3aed" },
  { id:"slate",  label:"검정", hex:"#475569" }
];

let _timelineScratchCount = 0;

const TIMELINE_MAP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 21.2c4.2-4.6 6.3-8.1 6.3-10.7A6.3 6.3 0 0 0 12 4.2a6.3 6.3 0 0 0-6.3 6.3c0 2.6 2.1 6.1 6.3 10.7Z" ' +
  'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
  '<circle cx="12" cy="10.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';

const TIMELINE_MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="m6 9.5 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function timelineT(text){
  return typeof window !== "undefined" && typeof window.t === "function" ? window.t(text) : text;
}

function timelineTf(template, vars){
  if (typeof window !== "undefined" && typeof window.tf === "function") return window.tf(template, vars);
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (vars && vars[key] != null ? String(vars[key]) : whole));
}

function timelineEventId(){
  return "ev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function timelineColorHex(id){
  const found = TIMELINE_COLORS.find(item => item.id === id);
  return found ? found.hex : TIMELINE_COLORS[0].hex;
}

function timelineLeapYear(year){
  const value = Math.abs(Number(year) || 0);
  return value % 4 === 0 && (value % 100 !== 0 || value % 400 === 0);
}

function timelinePurpose(value){
  return value === "trip" ? "trip" : "timeline";
}

/* 입력 날짜를 정렬 가능한 값으로 바꾼다. 역사 연대표에서 자주 쓰는 기원전은 별도 달력
   라이브러리 없이도 정렬되게 천문학적 연도(기원전 1년=0년)로 환산한다. */
function timelineParseDate(raw){
  const original = String(raw == null ? "" : raw).trim();
  if (!original) return null;
  let source = original.replace(/[–—]/g, "-").trim();
  let approximate = false;
  if (/^(?:약|경|~|c\.?|circa)\s*/i.test(source)){
    approximate = true;
    source = source.replace(/^(?:약|경|~|c\.?|circa)\s*/i, "").trim();
  }
  let era = "ce";
  if (/^(?:기원전|bce?|bc)\s*/i.test(source)){
    era = "bce";
    source = source.replace(/^(?:기원전|bce?|bc)\s*/i, "").trim();
  } else {
    source = source.replace(/^(?:서기|ce|ad)\s*/i, "").trim();
  }
  if (/^-\d/.test(source)){
    era = "bce";
    source = source.slice(1);
  }
  let hour = 0, minute = 0, hasTime = false;
  const timeMatch = /(?:[T\s]+)(\d{1,2}):(\d{2})$/.exec(source);
  if (timeMatch){
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    hasTime = true;
    source = source.slice(0, timeMatch.index).trim();
  }
  source = source
    .replace(/\s*년\s*/g, "-")
    .replace(/\s*월\s*/g, "-")
    .replace(/\s*일\s*$/g, "")
    .replace(/[./\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const parts = source.split("-");
  if (!/^\d{1,6}$/.test(parts[0] || "") || parts.length > 3) return null;
  const year = Number(parts[0]);
  const month = parts.length >= 2 && parts[1] !== "" ? Number(parts[1]) : 1;
  const day = parts.length >= 3 && parts[2] !== "" ? Number(parts[2]) : 1;
  if (!Number.isInteger(year) || year < 1 || year > 999999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const monthDays = [31, timelineLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!Number.isInteger(day) || day < 1 || day > monthDays[month - 1]) return null;
  if (hasTime && parts.length < 3) return null;
  const precision = hasTime ? "minute" : parts.length >= 3 ? "day" : parts.length >= 2 ? "month" : "year";
  const astronomicalYear = era === "bce" ? 1 - year : year;
  const dayKey = astronomicalYear * 372 + (month - 1) * 31 + (day - 1);
  const key = dayKey * 1440 + hour * 60 + minute;
  return { original, era, year, month, day, hour, minute, precision, approximate, key };
}

function timelineFormatDate(raw){
  const parsed = typeof raw === "object" && raw && raw.key != null ? raw : timelineParseDate(raw);
  if (!parsed) return String(raw == null ? "" : raw);
  let value = (parsed.era === "bce" ? "기원전 " : "") + parsed.year + "년";
  if (["month", "day", "minute"].includes(parsed.precision)) value += " " + parsed.month + "월";
  if (["day", "minute"].includes(parsed.precision)) value += " " + parsed.day + "일";
  if (parsed.precision === "minute") value += " " + String(parsed.hour).padStart(2, "0") + ":" + String(parsed.minute).padStart(2, "0");
  return (parsed.approximate ? "약 " : "") + value;
}

function timelineNormalizePhoto(raw){
  const value = raw && typeof raw === "object" ? raw : null;
  if (!value) return null;
  const dataUrl = String(value.dataUrl || "");
  if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl)) return null;
  if (dataUrl.length > TIMELINE_PHOTO_MAX_DATA_CHARS) return null;
  return {
    name:String(value.name || "사진").slice(0, 120),
    dataUrl,
    width:Math.max(1, Math.min(10000, Math.round(Number(value.width) || 1))),
    height:Math.max(1, Math.min(10000, Math.round(Number(value.height) || 1)))
  };
}

function timelineNormalizeEvent(raw, index){
  const value = raw && typeof raw === "object" ? raw : {};
  const color = TIMELINE_COLORS.some(item => item.id === value.color) ? value.color : "blue";
  return {
    id:String(value.id || "") || timelineEventId(),
    title:String(value.title == null ? "" : value.title).slice(0, 120),
    start:String(value.start == null ? "" : value.start).trim().slice(0, 40),
    end:String(value.end == null ? "" : value.end).trim().slice(0, 40),
    category:String(value.category == null ? "" : value.category).trim().slice(0, 60),
    placeName:String(value.placeName == null ? "" : value.placeName).trim().slice(0, 120),
    placeAddress:String(value.placeAddress == null ? "" : value.placeAddress).trim().slice(0, 200),
    description:String(value.description == null ? "" : value.description).slice(0, 4000),
    color,
    imageFileName:String(value.imageFileName == null ? "" : value.imageFileName).trim().replace(/\\/g, "/").slice(0, 260),
    image:timelineNormalizePhoto(value.image),
    order:Number.isInteger(value.order) ? value.order : (Number(index) || 0)
  };
}

function timelineDocEmpty(title){
  return {
    type:TIMELINE_DOC_TYPE,
    version:TIMELINE_DOC_VERSION,
    title:String(title || "연대표").slice(0, 160),
    purpose:"timeline",
    viewMode:"even",
    events:[]
  };
}

function timelineDocParse(text){
  const raw = JSON.parse(String(text || ""));
  if (!raw || typeof raw !== "object" || raw.type !== TIMELINE_DOC_TYPE) throw new Error("not-a-timeline-doc");
  return {
    type:TIMELINE_DOC_TYPE,
    version:TIMELINE_DOC_VERSION,
    title:String(raw.title == null ? "" : raw.title).slice(0, 160),
    purpose:timelinePurpose(raw.purpose),
    viewMode:raw.viewMode === "scale" ? "scale" : "even",
    events:(Array.isArray(raw.events) ? raw.events : []).slice(0, TIMELINE_MAX_EVENTS)
      .map((item, index) => timelineNormalizeEvent(item, index))
  };
}

function timelineDocSerialize(model){
  return JSON.stringify({
    type:TIMELINE_DOC_TYPE,
    version:TIMELINE_DOC_VERSION,
    title:String(model && model.title || "").slice(0, 160),
    purpose:timelinePurpose(model && model.purpose),
    viewMode:model && model.viewMode === "scale" ? "scale" : "even",
    events:(model && Array.isArray(model.events) ? model.events : []).slice(0, TIMELINE_MAX_EVENTS)
      .map((item, index) => timelineNormalizeEvent(item, index))
  }, null, 2);
}

function timelineDocContentKey(model){
  try { return timelineDocSerialize(model); } catch(_){ return ""; }
}

/* ===== 되돌리기·수정 여부용 가벼운 스냅샷 =====
   사진은 한 장이 최대 900KB(base64)이고 한 문서에 수십 장이 들어간다. 되돌리기 기록 80단계와
   타자 한 글자마다 도는 수정 여부 판정이 이 바이트를 매번 복사·비교하면 문서 하나로 수백 MB를 쓴다.
   그래서 스냅샷은 사진을 뺀 값만 문자열로 뜨고, 사진은 객체 참조로만 들고 있는다.
   사진을 바꾸면 새 객체가 만들어지므로(참조가 달라지므로) 참조 비교로 정확히 잡힌다. */
function timelineSnapshot(model){
  const images = [];
  const events = (model && Array.isArray(model.events) ? model.events : []).slice(0, TIMELINE_MAX_EVENTS)
    .map((item, index) => {
      /* 정규화는 사진 객체를 새로 만든다. 그러면 참조 비교가 늘 어긋나므로 사진만 원본 객체를 그대로 든다. */
      const photo = item && item.image && timelineNormalizePhoto(item.image) ? item.image : null;
      const event = timelineNormalizeEvent(photo ? { ...item, image:null } : item, index);
      if (photo){ images.push(photo); event.image = { slot:images.length - 1 }; }
      return event;
    });
  return {
    text:JSON.stringify({
      title:String(model && model.title || "").slice(0, 160),
      purpose:timelinePurpose(model && model.purpose),
      viewMode:model && model.viewMode === "scale" ? "scale" : "even",
      events
    }),
    images
  };
}

function timelineSnapshotEqual(a, b){
  if (!a || !b) return a === b;
  if (a.text !== b.text || a.images.length !== b.images.length) return false;
  return a.images.every((image, index) => image === b.images[index]);
}

function timelineSnapshotModel(state){
  const raw = state && typeof state.text === "string" ? JSON.parse(state.text) : {};
  const images = state && Array.isArray(state.images) ? state.images : [];
  return {
    type:TIMELINE_DOC_TYPE,
    version:TIMELINE_DOC_VERSION,
    title:String(raw.title == null ? "" : raw.title).slice(0, 160),
    purpose:timelinePurpose(raw.purpose),
    viewMode:raw.viewMode === "scale" ? "scale" : "even",
    events:(Array.isArray(raw.events) ? raw.events : []).map((item, index) => {
      const slot = item && item.image ? item.image.slot : null;
      const event = timelineNormalizeEvent({ ...item, image:null }, index);
      if (Number.isInteger(slot) && images[slot]) event.image = images[slot];
      return event;
    })
  };
}

function timelineSortedEvents(events){
  return (Array.isArray(events) ? events : []).map((event, index) => ({
    event,
    index,
    date:timelineParseDate(event.start),
    endDate:timelineParseDate(event.end)
  })).sort((a, b) => {
    if (a.date && b.date && a.date.key !== b.date.key) return a.date.key - b.date.key;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    const orderA = Number.isInteger(a.event.order) ? a.event.order : a.index;
    const orderB = Number.isInteger(b.event.order) ? b.event.order : b.index;
    return orderA - orderB || a.index - b.index;
  });
}

/* 날짜·시각이 같은 항목만 수동 순서를 바꾼다. 서로 다른 시각은 실제 시간순을 유지하고,
   날짜만 적은 사건이나 같은 시작 시각의 일정은 사용자가 의도한 순서로 정리할 수 있다. */
function timelineCanMoveEvent(events, id, direction){
  const rows = timelineSortedEvents(events);
  const at = rows.findIndex(row => row.event.id === id);
  const step = direction < 0 ? -1 : 1;
  const other = rows[at + step];
  return at >= 0 && !!rows[at].date && !!other && !!other.date && rows[at].date.key === other.date.key;
}

function timelineMoveEvent(events, id, direction){
  const rows = timelineSortedEvents(events);
  const at = rows.findIndex(row => row.event.id === id);
  const step = direction < 0 ? -1 : 1;
  if (at < 0 || !timelineCanMoveEvent(events, id, step)) return false;
  const moved = rows.splice(at, 1)[0];
  rows.splice(at + step, 0, moved);
  rows.forEach((row, index) => { row.event.order = index; });
  return true;
}

/* 렌더러와 단위 테스트가 함께 쓰는 배치 계산. 시간 비례는 실제 간격을 보존하되, 날짜가
   몰린 사건은 최소 간격을 주어 카드를 누를 수 있게 한다. */
function timelineLayoutEntries(events, mode, zoom){
  const sorted = timelineSortedEvents(events);
  const factor = Math.max(TIMELINE_ZOOM_MIN, Math.min(TIMELINE_ZOOM_MAX, Number(zoom) || 1));
  const gap = 250 * factor;
  let width = Math.max(840, 280 + Math.max(0, sorted.length - 1) * gap);
  const keys = [];
  for (const row of sorted){
    if (row.date) keys.push(row.date.key);
    if (row.endDate) keys.push(row.endDate.key);
  }
  const min = keys.length ? Math.min(...keys) : 0;
  const max = keys.length ? Math.max(...keys) : min;
  const span = Math.max(1, max - min);
  let previous = -Infinity;
  const entries = sorted.map((row, index) => {
    let x;
    if (mode === "scale" && row.date){
      x = 140 + ((row.date.key - min) / span) * (width - 280);
      x = Math.max(x, previous + 42 * factor);
    } else x = 140 + index * gap;
    previous = x;
    let endX = x;
    if (row.endDate && row.date && row.endDate.key > row.date.key){
      if (mode === "scale") endX = 140 + ((row.endDate.key - min) / span) * (width - 280);
      else endX = x + Math.min(gap * 0.72, 150 * factor);
      endX = Math.max(x + 18, endX);
    }
    return { ...row, x, endX, lane:index % 4 };
  });
  const farthest = entries.reduce((value, row) => Math.max(value, row.endX), 0);
  width = Math.max(width, farthest + 150);
  return { entries, width, min, max };
}

/* 많은 사건을 한 화면에서 훑는 개요 배치. 균등 보기는 모든 사건을 같은 간격으로, 시간 비례는
   실제 날짜 간격으로 놓는다. 같은 자리에 몰린 점도 누를 수 있도록 다섯 높이로 엇갈린다. */
function timelineOverviewEntries(events, mode, width){
  const sorted = timelineSortedEvents(events);
  const safeWidth = Math.max(320, Number(width) || 0);
  const left = 54, right = Math.max(left, safeWidth - 54), spanX = Math.max(1, right - left);
  const dated = sorted.filter(row => row.date);
  const min = dated.length ? Math.min(...dated.map(row => row.date.key)) : 0;
  const max = dated.length ? Math.max(...dated.map(row => row.date.key)) : min;
  const spanDate = Math.max(1, max - min);
  return sorted.map((row, index) => {
    let x;
    if (mode === "scale" && row.date) x = left + ((row.date.key - min) / spanDate) * spanX;
    else x = sorted.length < 2 ? safeWidth / 2 : left + (index / (sorted.length - 1)) * spanX;
    return { ...row, x, lane:(index % 5) - 2 };
  });
}

function timelinePhotoTotalChars(events){
  return (Array.isArray(events) ? events : []).reduce((sum, event) =>
    sum + (event && event.image && event.image.dataUrl ? event.image.dataUrl.length : 0), 0);
}

function timelineCsvRows(text){
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++){
    const ch = source[i];
    if (quoted){
      if (ch === '"' && source[i + 1] === '"'){ field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ","){ row.push(field); field = ""; }
    else if (ch === "\n"){ row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length){ row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(values => values.some(value => String(value).trim()));
}

function timelineCsvCell(value){
  const text = String(value == null ? "" : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function timelineImageMatchName(value){
  return String(value == null ? "" : value).trim().replace(/\\/g, "/").replace(/^\.\/+/, "")
    .normalize("NFC").toLocaleLowerCase();
}

function timelineImageFileSupported(file){
  const type = String(file && file.type || "");
  const name = String(file && file.name || "");
  return /^image\/(?:png|jpeg|webp)$/i.test(type) || /\.(?:png|jpe?g|webp)$/i.test(name);
}

/* 폴더 선택 파일은 webkitRelativePath 맨 앞에 선택한 폴더 이름이 붙는다. 전체 상대경로,
   그 첫 폴더를 뗀 경로, 파일명 세 가지를 모두 색인해 CSV의 어느 표기와도 연결한다.
   같은 파일명이 여러 폴더에 있으면 잘못 붙이지 않도록 그 짧은 키는 모호함(null)으로 둔다. */
function timelineImageFileLookup(files){
  const lookup = new Map();
  const add = (rawKey, file) => {
    const key = timelineImageMatchName(rawKey);
    if (!key) return;
    if (!lookup.has(key)) lookup.set(key, file);
    else if (lookup.get(key) !== file) lookup.set(key, null);
  };
  for (const file of Array.from(files || [])){
    if (!timelineImageFileSupported(file)) continue;
    const relative = String(file.webkitRelativePath || "").replace(/\\/g, "/");
    const parts = relative.split("/").filter(Boolean);
    if (relative) add(relative, file);
    if (parts.length > 1) add(parts.slice(1).join("/"), file);
    add(file.name, file);
  }
  return lookup;
}

function timelineFindImageFile(reference, lookup){
  const key = timelineImageMatchName(reference);
  if (!key || !(lookup instanceof Map)) return null;
  const exact = lookup.get(key);
  if (exact) return exact;
  const base = key.split("/").pop();
  return base && lookup.get(base) || null;
}

function timelineExportHeaders(purpose, includePhoto){
  const trip = timelinePurpose(purpose) === "trip";
  const headers = ["시작", "종료", "제목", trip ? "유형" : "분류", trip ? "장소" : "유적지",
    trip ? "장소 주소" : "유적지 주소", "이미지 파일명", trip ? "메모" : "설명", "색상"];
  if (includePhoto) headers.push("사진");
  return headers;
}

function timelineEventsToCsv(events, purpose){
  const lines = [timelineExportHeaders(purpose, false)];
  for (const row of timelineSortedEvents(events)){
    const event = row.event;
    lines.push([event.start, event.end, event.title, event.category, event.placeName, event.placeAddress,
      event.imageFileName || event.image && event.image.name || "", event.description, event.color]);
  }
  return lines.map(row => row.map(timelineCsvCell).join(",")).join("\r\n") + "\r\n";
}

const TIMELINE_EXPORT_HEADERS = timelineExportHeaders("timeline", true);

async function timelineXlsxImageSource(photo){
  const dataUrl = String(photo && photo.dataUrl || "");
  const match = /^data:image\/(png|jpe?g|webp);base64,/i.exec(dataUrl);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  if (kind !== "webp") return { base64:dataUrl, extension:kind === "png" ? "png" : "jpeg" };
  /* ExcelJS가 WebP를 직접 쓰지 못하므로 오래된 .timeline 문서에 WebP가 남아 있으면 JPEG로 바꾼다.
     새로 넣는 사진은 timelinePreparePhoto 단계에서 이미 JPEG가 되므로 보통은 이 경로를 거치지 않는다. */
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("xlsx-image"));
    element.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Number(photo.width) || image.naturalWidth || image.width || 1);
  canvas.height = Math.max(1, Number(photo.height) || image.naturalHeight || image.height || 1);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { base64:canvas.toDataURL("image/jpeg", 0.86), extension:"jpeg" };
}

/* CSV와 같은 열을 사람이 읽기 좋은 엑셀 표로 만들고, 사건 사진은 마지막 열의 같은 행에 넣는다.
   날짜를 Date로 바꾸면 연도만 있는 값·기원전·대략 표기가 손실되므로 모두 원문 문자열로 기록한다. */
async function timelineEventsToXlsx(events, title, purpose){
  if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("exceljs");
  if (typeof ExcelJS === "undefined" || !ExcelJS.Workbook) throw new Error("xlsx-runtime");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ClassDock";
  const trip = timelinePurpose(purpose) === "trip";
  const sheet = workbook.addWorksheet(trip ? "여행 일정" : "연대표", { views:[{ state:"frozen", ySplit:1, topLeftCell:"A2", activeCell:"A2" }] });
  sheet.columns = [
    { key:"start", width:16 }, { key:"end", width:16 }, { key:"title", width:27 },
    { key:"category", width:15 }, { key:"place", width:21 }, { key:"address", width:32 },
    { key:"imageName", width:24 }, { key:"description", width:48 }, { key:"color", width:12 },
    { key:"photo", width:17 }
  ];
  sheet.addRow(timelineExportHeaders(purpose, true));
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold:true, color:{ argb:"FFFFFFFF" } };
  header.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF2563EB" } };
  header.alignment = { vertical:"middle", horizontal:"center" };
  header.eachCell(cell => { cell.border = { bottom:{ style:"thin", color:{ argb:"FF1D4ED8" } } }; });

  let imageCount = 0;
  let skippedImages = 0;
  for (const item of timelineSortedEvents(events)){
    const event = item.event;
    const row = sheet.addRow([
      event.start, event.end, event.title, event.category, event.placeName, event.placeAddress,
      event.imageFileName || event.image && event.image.name || "", event.description, event.color, ""
    ]);
    row.alignment = { vertical:"middle" };
    row.getCell(8).alignment = { vertical:"top", wrapText:true };
    row.getCell(9).alignment = { vertical:"middle", horizontal:"center" };
    const color = TIMELINE_COLORS.find(candidate => candidate.id === event.color);
    if (color){
      row.getCell(9).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF" + color.hex.slice(1).toUpperCase() } };
      row.getCell(9).font = { color:{ argb:"FFFFFFFF" }, bold:true };
    }
    if (!event.image) continue;
    try {
      const source = await timelineXlsxImageSource(event.image);
      if (!source){ skippedImages++; continue; }
      const imageId = workbook.addImage(source);
      const width = Math.max(1, Number(event.image.width) || 4);
      const height = Math.max(1, Number(event.image.height) || 3);
      const scale = Math.min(96 / width, 72 / height);
      const displayWidth = Math.max(18, Math.round(width * scale));
      const displayHeight = Math.max(18, Math.round(height * scale));
      row.height = 60;
      sheet.addImage(imageId, {
        tl:{ col:9.08, row:row.number - 1 + 0.08 },
        ext:{ width:displayWidth, height:displayHeight },
        editAs:"oneCell"
      });
      imageCount++;
    } catch(_){ skippedImages++; }
  }
  sheet.autoFilter = { from:"A1", to:"J1" };
  sheet.pageSetup = { orientation:"landscape", fitToPage:true, fitToWidth:1, fitToHeight:0 };
  sheet.headerFooter = { oddHeader:"&C" + String(title || "연대표").slice(0, 160) };
  return { bytes:await workbook.xlsx.writeBuffer(), imageCount, skippedImages };
}

function timelineEventsFromCsv(text){
  return timelineEventsFromRows(timelineCsvRows(text));
}

/* CSV와 엑셀은 "칸 값이 담긴 2차원 배열"까지 오면 같은 자료다. 열 이름 해석·날짜 검사·건너뛴 줄
   세기를 한곳에 두어 두 경로가 서로 다르게 동작하지 않게 한다. rowIndexes 는 사건이 시트 몇째
   줄에서 왔는지를 남긴다 — 엑셀 시트에 떠 있는 사진을 줄 번호로 사건에 붙이는 데 쓴다. */
function timelineEventsFromRows(rows){
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("csv-empty");
  const headers = rows[0].map(value => String(value).trim().toLowerCase());
  const find = aliases => headers.findIndex(value => aliases.includes(value));
  const startAt = find(["시작", "시작일", "날짜", "연도", "start", "date", "year"]);
  const endAt = find(["종료", "종료일", "끝", "end"]);
  const titleAt = find(["제목", "사건", "일정", "이름", "title", "event", "name"]);
  const categoryAt = find(["분류", "유형", "갈래", "category", "group", "type"]);
  const placeNameAt = find(["유적지", "관련 유적지", "유적명", "장소", "place", "place name", "location"]);
  const placeAddressAt = find(["유적지 주소", "유적지주소", "장소 주소", "장소주소", "주소", "소재지", "도로명주소", "place address", "address"]);
  const imageAt = find(["이미지 파일명", "이미지파일명", "이미지 파일", "이미지", "사진 파일명", "사진파일명", "사진 파일", "사진", "image filename", "image file", "image", "photo filename", "photo file", "photo"]);
  const descAt = find(["설명", "내용", "메모", "description", "note"]);
  const colorAt = find(["색", "색상", "color"]);
  if (startAt < 0 || titleAt < 0) throw new Error("csv-columns");
  const events = [];
  const rowIndexes = [];
  let skipped = 0;
  for (let rowIndex = 1; rowIndex < rows.length && rowIndex <= TIMELINE_MAX_EVENTS; rowIndex++){
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const start = String(row[startAt] || "").trim();
    const title = String(row[titleAt] || "").trim();
    const parsedStart = timelineParseDate(start);
    const end = endAt >= 0 ? String(row[endAt] || "").trim() : "";
    const parsedEnd = end ? timelineParseDate(end) : null;
    if (!title || !parsedStart || (end && (!parsedEnd || parsedEnd.key < parsedStart.key))){ skipped++; continue; }
    const colorRaw = colorAt >= 0 ? String(row[colorAt] || "").trim().toLowerCase() : "blue";
    const color = TIMELINE_COLORS.find(item => item.id === colorRaw || item.label === colorRaw);
    events.push(timelineNormalizeEvent({
      start,
      end,
      title,
      category:categoryAt >= 0 ? row[categoryAt] : "",
      placeName:placeNameAt >= 0 ? row[placeNameAt] : "",
      placeAddress:placeAddressAt >= 0 ? row[placeAddressAt] : "",
      imageFileName:imageAt >= 0 ? row[imageAt] : "",
      description:descAt >= 0 ? row[descAt] : "",
      color:color ? color.id : "blue"
    }, events.length));
    rowIndexes.push(rowIndex);
  }
  if (!events.length) throw new Error("csv-no-events");
  return { events, rowIndexes, skipped, truncated:rows.length - 1 > TIMELINE_MAX_EVENTS };
}

/* ===== 엑셀(.xlsx) 들이기 =====
   xlsx 는 ZIP 이고 시트에 붙인 사진은 xl/media/ 에 원본 그대로, 어느 칸에 놓였는지는 그림 앵커에
   남는다. ExcelJS 는 표 편집에서 이미 쓰는 번들이라 새 라이브러리 없이 둘 다 읽을 수 있다.
   덕분에 CSV + [이미지 폴더] 두 단계가 엑셀 파일 하나로 끝난다. */
const TIMELINE_SHEET_IMAGE_TYPES = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp" };

/* 일부 OOXML 생성기는 SpreadsheetML 기본 네임스페이스를 <x:workbook>, <x:worksheet>처럼
   접두사로 쓴다. XML로는 올바르지만 현재 ExcelJS는 이 요소 이름을 못 알아봐 workbook 모델을
   만들지 못한다. 그 형식으로 확인된 XML만 기본 네임스페이스 형태로 좁게 정규화한다. */
function timelineNormalizeXlsxNamespaces(bytes, ZipCtor){
  const Ctor = ZipCtor || (typeof JSZip !== "undefined" ? JSZip : null);
  if (!Ctor) return bytes;
  const spreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  try {
    const zip = new Ctor(bytes);
    let changed = false;
    Object.keys(zip.files || {}).forEach(path => {
      if (!/\.xml$/i.test(path) || /\/_rels\//i.test(path)) return;
      const entry = zip.file(path);
      if (!entry) return;
      const xml = entry.asText();
      const root = xml.match(/<([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\b[^>]*\bxmlns:\1\s*=\s*(["'])http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main\2/i);
      if (!root) return;
      const prefix = root[1];
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const declaration = new RegExp("\\s+xmlns:" + escaped + "\\s*=\\s*([\\\"'])" + spreadsheetNamespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\1", "i");
      const hasDefaultNamespace = new RegExp("\\s+xmlns\\s*=\\s*([\\\"'])" + spreadsheetNamespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\1", "i").test(xml);
      let fixed = xml.replace(new RegExp("(<\\/?)" + escaped + ":", "g"), "$1");
      fixed = hasDefaultNamespace
        ? fixed.replace(declaration, "")
        : fixed.replace(declaration, match => match.replace(new RegExp("xmlns:" + escaped, "i"), "xmlns"));
      if (fixed !== xml){ zip.file(path, fixed); changed = true; }
    });
    return changed ? zip.generate({ type:"uint8array", compression:"STORE" }) : bytes;
  } catch(error){
    console.warn("timeline xlsx namespace normalization skipped:", error);
    return bytes;
  }
}

function timelineCellText(cell){
  const value = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
  if (value == null) return "";
  if (value instanceof Date){
    const pad = number => String(number).padStart(2, "0");
    return value.getUTCFullYear() + "-" + pad(value.getUTCMonth() + 1) + "-" + pad(value.getUTCDate());
  }
  if (typeof value === "object"){
    if (Array.isArray(value.richText)) return value.richText.map(part => String(part && part.text || "")).join("");
    if (value.text != null) return String(value.text);                       // 하이퍼링크 칸
    if (value.result != null) return String(value.result);                   // 수식 결과
    if (value.formula !== undefined || value.sharedFormula !== undefined) return "";
    return "";
  }
  return String(value);
}

function timelineSheetRows(sheet){
  const rows = [];
  if (!sheet || typeof sheet.eachRow !== "function") return rows;
  sheet.eachRow({ includeEmpty:true }, (row, rowNumber) => {
    const values = [];
    if (row && typeof row.eachCell === "function"){
      row.eachCell({ includeEmpty:true }, (cell, colNumber) => { values[colNumber - 1] = timelineCellText(cell); });
    }
    rows[rowNumber - 1] = values;
  });
  for (let index = 0; index < rows.length; index++) if (!rows[index]) rows[index] = [];
  return rows;
}

/* 그림 앵커의 nativeRow 는 0부터 센 줄 번호라 timelineSheetRows 의 첨자와 그대로 맞는다.
   여러 줄에 걸친 그림은 왼쪽 위가 놓인 줄로 보고, 한 줄에 여러 장이면 첫 장만 쓴다(사건당 사진 한 장). */
function timelineSheetImageRows(workbook, sheet){
  const found = new Map();
  const images = sheet && typeof sheet.getImages === "function" ? sheet.getImages() : [];
  for (const item of (Array.isArray(images) ? images : [])){
    const anchor = item && item.range ? item.range.tl : null;
    const row = anchor && Number.isFinite(Number(anchor.nativeRow)) ? Math.round(Number(anchor.nativeRow)) : null;
    if (row == null || found.has(row)) continue;
    const media = workbook && typeof workbook.getImage === "function" ? workbook.getImage(Number(item.imageId)) : null;
    if (!media || !media.buffer) continue;
    const extension = String(media.extension || "").toLowerCase();
    const type = TIMELINE_SHEET_IMAGE_TYPES[extension];
    if (!type) continue;                                                     // emf·wmf·gif 는 사진으로 쓰지 않는다
    found.set(row, { buffer:media.buffer, type, name:String(media.name || "사진") + "." + extension });
  }
  return found;
}

async function timelineEventsFromXlsx(file){
  if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("exceljs");
  if (typeof ExcelJS === "undefined" || !ExcelJS.Workbook) throw new Error("xlsx-runtime");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch(originalError){
    if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("jszip");
    const fixed = timelineNormalizeXlsxNamespaces(bytes);
    if (fixed === bytes) throw originalError;
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fixed);
  }
  const sheet = (workbook.worksheets || []).find(item => item && item.rowCount) || (workbook.worksheets || [])[0];
  if (!sheet) throw new Error("csv-empty");
  const result = timelineEventsFromRows(timelineSheetRows(sheet));
  const media = timelineSheetImageRows(workbook, sheet);
  const imageFiles = new Map();
  result.rowIndexes.forEach((rowIndex, index) => {
    const image = media.get(rowIndex);
    if (image) imageFiles.set(index, new File([image.buffer], image.name, { type:image.type }));
  });
  return { ...result, imageFiles, sheetImages:media.size };
}

function timelineDefaultTitle(name){
  return String(name || "").replace(/\.timeline$/i, "") || "연대표";
}

function timelineScratchFileName(number){
  return number > 1 ? "연대표 " + number + ".timeline" : "연대표.timeline";
}

async function loadTimelineDoc(file, opts = {}){
  let model;
  try { model = timelineDocParse(await file.text()); }
  catch(_){
    if (typeof toast === "function") toast(timelineT("연대표 문서(.timeline)를 읽지 못해 텍스트로 열었어요."), 3500);
    return typeof loadText === "function" ? loadText(file, opts) : null;
  }
  if (!model.title) model.title = timelineDefaultTitle(file.name);
  const doc = makeDoc("timeline", file.name, opts);
  doc.timelineDoc = model;
  doc.sourceFile = file;
  doc.savedText = timelineDocSerialize(model);
  doc._timelineSavedSnapshot = timelineSnapshot(model);
  doc.contentSearchFocus = query => {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle || typeof doc.timelineSelectEvent !== "function") return false;
    const found = timelineSortedEvents(doc.timelineDoc && doc.timelineDoc.events).find(row =>
      [row.event.start, row.event.end, row.event.title, row.event.category, row.event.placeName,
        row.event.placeAddress, row.event.description]
        .join(" ").toLowerCase().includes(needle));
    if (!found) return false;
    doc.timelineSelectEvent(found.event.id, true);
    return true;
  };
  doc.render = async () => {
    if (doc._timelineMounted) return;
    doc.el.innerHTML = "";
    doc._timelineMounted = true;
    mountTimelineEditor(doc);
  };
  if (typeof refreshChrome === "function") refreshChrome();
  if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
  return doc;
}

function newTimelineScratch(){
  _timelineScratchCount++;
  const name = timelineScratchFileName(_timelineScratchCount);
  const starter = timelineDocSerialize(timelineDocEmpty(timelineDefaultTitle(name)));
  if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([starter], name, { type:"application/json" })], { isScratch:true }));
}

function newTimelineScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, timelineScratchFileName,
    name => timelineDocSerialize(timelineDocEmpty(timelineDefaultTitle(name))),
    "application/json", "연대표");
}

async function saveTimelineDoc(doc){
  if (!doc || !doc.timelineDoc) return false;
  const json = timelineDocSerialize(doc.timelineDoc);
  const ok = typeof saveTextDoc === "function" ? await saveTextDoc(json, doc, doc.name) : false;
  if (!ok) return false;
  doc.savedText = json;
  doc._timelineSavedSnapshot = timelineSnapshot(doc.timelineDoc);
  if (doc._timelineHistory && typeof doc._timelineHistory.replaceCurrent === "function"){
    doc._timelineHistory.replaceCurrent(doc._timelineSavedSnapshot);
  }
  if (typeof markDocumentSavedSnapshot === "function"){
    await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json");
  } else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
  return true;
}

function timelineButton(label, title, className){
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "timeline-btn";
  button.textContent = label;
  if (title) button.title = title;
  return button;
}

function timelineSafeName(value){
  return String(value || "연대표").replace(/[\\/:*?"<>|]+/g, "_").trim() || "연대표";
}

function timelineDownload(name, blob){
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function timelinePreparePhoto(file){
  if (!file || !/^image\/(?:png|jpeg|webp)$/i.test(String(file.type || ""))) throw new Error("photo-type");
  if (file.size > 20 * 1024 * 1024) throw new Error("photo-too-large");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("photo-read"));
      img.src = url;
    });
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, TIMELINE_PHOTO_MAX_SIDE / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    if (dataUrl.length > TIMELINE_PHOTO_MAX_DATA_CHARS) dataUrl = canvas.toDataURL("image/jpeg", 0.68);
    if (dataUrl.length > TIMELINE_PHOTO_MAX_DATA_CHARS) dataUrl = canvas.toDataURL("image/jpeg", 0.52);
    if (dataUrl.length > TIMELINE_PHOTO_MAX_DATA_CHARS) throw new Error("photo-output-too-large");
    return { name:String(file.name || "사진").slice(0, 120), dataUrl, width, height };
  } finally { URL.revokeObjectURL(url); }
}

function mountTimelineEditor(doc){
  const model = doc.timelineDoc;
  model.purpose = timelinePurpose(model.purpose);
  const root = document.createElement("div");
  root.className = "timeline-doc";
  doc.el.appendChild(root);

  const bar = document.createElement("div");
  bar.className = "timeline-bar";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "timeline-title";
  titleInput.maxLength = 160;
  titleInput.value = model.title || "";
  titleInput.placeholder = timelineT("연대표 제목");
  titleInput.setAttribute("aria-label", timelineT("연대표 제목"));

  const purposeSelect = document.createElement("select");
  purposeSelect.className = "timeline-select timeline-purpose-select";
  purposeSelect.title = timelineT("문서 용도");
  for (const [value, label] of [["timeline", "일반 연대표"], ["trip", "여행 일정"]]){
    const option = document.createElement("option");
    option.value = value; option.textContent = timelineT(label);
    if (timelinePurpose(model.purpose) === value) option.selected = true;
    purposeSelect.appendChild(option);
  }
  const addBtn = timelineButton("＋ 사건", "새 사건 또는 기간 추가", "timeline-btn timeline-add");
  const moveEarlierBtn = timelineButton("↑", "같은 날짜·시각에서 앞 순서로 이동");
  const moveLaterBtn = timelineButton("↓", "같은 날짜·시각에서 뒤 순서로 이동");
  const undoBtn = timelineButton("↶", "실행 취소 (Ctrl+Z)");
  const redoBtn = timelineButton("↷", "다시 실행 (Ctrl+Shift+Z)");
  const modeSelect = document.createElement("select");
  modeSelect.className = "timeline-select";
  modeSelect.title = "사건 사이 간격";
  for (const [value, label] of [["even", "읽기 좋게 균등"], ["scale", "시간 간격대로"]]){
    const option = document.createElement("option");
    option.value = value; option.textContent = timelineT(label);
    if (model.viewMode === value) option.selected = true;
    modeSelect.appendChild(option);
  }
  const zoomOut = timelineButton("−", "연대표 축소");
  const zoomLabel = timelineButton("100%", "연대표 배율 100%로 초기화", "timeline-btn timeline-zoom-label");
  const zoomIn = timelineButton("＋", "연대표 확대");
  const overviewBtn = timelineButton("▤ 개요", "모든 사건을 한 화면에서 보기");
  const listBtn = timelineButton("☷ 목록", "사건 목록 열기·닫기");
  const csvInBtn = timelineButton("표 들이기", "CSV·엑셀(.xlsx)에서 사건 가져오기");
  const imageFolderBtn = timelineButton("이미지 폴더", "CSV의 이미지 파일명과 연결할 폴더 선택");
  const exportMenu = document.createElement("details");
  exportMenu.className = "timeline-export-menu";
  const exportSummary = document.createElement("summary");
  exportSummary.className = "timeline-btn";
  exportSummary.textContent = "표 내보내기";
  exportSummary.title = "사건 목록을 CSV 또는 Excel로 저장";
  const exportPanel = document.createElement("div");
  exportPanel.className = "timeline-export-panel";
  const csvOutBtn = timelineButton("CSV", "사건 목록을 UTF-8 CSV로 저장", "timeline-export-option");
  const xlsxOutBtn = timelineButton("Excel (.xlsx)", "사진을 포함한 사건 목록을 Excel 파일로 저장", "timeline-export-option");
  exportPanel.append(csvOutBtn, xlsxOutBtn);
  exportMenu.append(exportSummary, exportPanel);
  const presentBtn = timelineButton("▶ 발표", "사건을 하나씩 크게 보여주기");
  const printBtn = timelineButton("🖨 인쇄", "세로 목록으로 인쇄하거나 PDF로 저장");
  const saveBtn = timelineButton("저장", "연대표 저장 (Ctrl+S)", "timeline-btn run-save timeline-save");
  bar.append(titleInput, purposeSelect, addBtn, moveEarlierBtn, moveLaterBtn, undoBtn, redoBtn, modeSelect, zoomOut, zoomLabel, zoomIn, overviewBtn,
    listBtn, csvInBtn, imageFolderBtn, exportMenu, presentBtn, printBtn, saveBtn);

  const workspace = document.createElement("div");
  workspace.className = "timeline-workspace";
  const viewport = document.createElement("div");
  viewport.className = "timeline-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "연대표 화면");
  const stage = document.createElement("div");
  stage.className = "timeline-stage";
  const canvas = document.createElement("div");
  canvas.className = "timeline-canvas";
  stage.appendChild(canvas);
  viewport.appendChild(stage);

  const listPanel = document.createElement("aside");
  listPanel.className = "timeline-list-panel";
  listPanel.hidden = true;
  const listHead = document.createElement("div");
  listHead.className = "timeline-list-head";
  const listTitle = document.createElement("strong");
  listTitle.textContent = timelineT("사건 목록");
  const listClose = timelineButton("×", "사건 목록 닫기");
  listHead.append(listTitle, listClose);
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "timeline-search";
  searchInput.placeholder = timelineT("제목·분류·유적지·설명 검색");
  const list = document.createElement("div");
  list.className = "timeline-list";
  listPanel.append(listHead, searchInput, list);
  workspace.append(viewport, listPanel);

  const empty = document.createElement("div");
  empty.className = "timeline-empty";
  const emptyTitle = document.createElement("strong");
  emptyTitle.textContent = timelineT("첫 사건을 넣어 연대표를 시작하세요");
  const emptyText = document.createElement("span");
  emptyText.textContent = timelineT("연도·날짜와 설명, 사진을 넣을 수 있습니다. 기원전은 ‘기원전 300’처럼 적으세요.");
  const emptyAdd = timelineButton("＋ 첫 사건 추가", "새 사건 추가", "timeline-btn timeline-add");
  empty.append(emptyTitle, emptyText, emptyAdd);

  const csvInput = document.createElement("input");
  csvInput.type = "file"; csvInput.hidden = true;
  csvInput.accept = ".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const imageFolderInput = document.createElement("input");
  imageFolderInput.type = "file"; imageFolderInput.accept = "image/png,image/jpeg,image/webp";
  imageFolderInput.multiple = true; imageFolderInput.hidden = true;
  imageFolderInput.setAttribute("webkitdirectory", "");
  imageFolderInput.setAttribute("directory", "");

  root.append(bar, workspace, csvInput, imageFolderInput);

  let zoom = 1;
  let overview = false;
  let trackBaseWidth = 840;
  let trackBaseHeight = TIMELINE_STAGE_HEIGHT;
  let detailView = { zoom:1, left:0, top:0 };
  let selectedId = "";
  let history = null;
  let recoveryTimer = 0;
  let cardPreviewTimer = 0;
  let presentIndex = -1;
  let presentRows = [];

  const contextMenu = document.createElement("div");
  contextMenu.className = "timeline-context-menu";
  contextMenu.hidden = true;
  contextMenu.setAttribute("role", "menu");
  contextMenu.setAttribute("aria-label", "연대표 빠른 메뉴");
  const contextHead = document.createElement("div");
  contextHead.className = "timeline-context-head";
  contextMenu.appendChild(contextHead);
  let contextEventId = "";
  let contextReturnFocus = null;

  function closeTimelineContextMenu(){
    if (contextMenu.hidden) return;
    if (contextMenu.contains(document.activeElement) && contextReturnFocus && document.contains(contextReturnFocus)){
      try { contextReturnFocus.focus({ preventScroll:true }); } catch(_){}
    }
    contextMenu.hidden = true;
    contextEventId = "";
    contextReturnFocus = null;
    document.removeEventListener("pointerdown", onTimelineContextOutside, true);
    window.removeEventListener("keydown", onTimelineContextKey, true);
  }
  function onTimelineContextOutside(pointerEvent){
    if (!contextMenu.contains(pointerEvent.target)) closeTimelineContextMenu();
  }
  function onTimelineContextKey(keyEvent){
    if (keyEvent.key === "Escape"){
      keyEvent.preventDefault(); keyEvent.stopImmediatePropagation();
      closeTimelineContextMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(keyEvent.key)) return;
    const items = [...contextMenu.querySelectorAll("button")].filter(button => !button.hidden && !button.disabled);
    if (!items.length) return;
    keyEvent.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = keyEvent.key === "Home" ? 0
      : keyEvent.key === "End" ? items.length - 1
      : (Math.max(0, at) + (keyEvent.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus({ preventScroll:true });
  }
  const timelineContextItem = run => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      const id = contextEventId;
      closeTimelineContextMenu();
      if (id) run(id);
    });
    contextMenu.appendChild(button);
    return button;
  };
  const timelineContextSep = () => {
    const sep = document.createElement("div");
    sep.className = "timeline-context-sep";
    sep.setAttribute("role", "separator");
    contextMenu.appendChild(sep);
  };
  const contextEditBtn = timelineContextItem(id => openEventDialog(id));
  timelineContextSep();
  const contextEarlierBtn = timelineContextItem(id => {
    selectedId = id;
    moveSelected(-1);
  });
  const contextLaterBtn = timelineContextItem(id => {
    selectedId = id;
    moveSelected(1);
  });
  const contextMapBtn = timelineContextItem(id => {
    const event = model.events.find(item => item.id === id);
    if (event) searchTimelinePlace(event);
  });
  timelineContextSep();
  const contextDeleteBtn = timelineContextItem(id => removeEvent(id));
  contextDeleteBtn.classList.add("danger");
  document.body.appendChild(contextMenu);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(contextMenu);

  const tripMode = () => model.purpose === "trip";
  function openTimelineContextMenu(pointerEvent, id, returnFocus){
    const event = model.events.find(item => item.id === id);
    if (!event) return;
    closeTimelineContextMenu();
    contextEventId = event.id;
    contextReturnFocus = returnFocus || null;
    selectEvent(event.id, false);
    const trip = tripMode();
    contextHead.textContent = timelineFormatDate(event.start) + " · " +
      (event.title || timelineT(trip ? "제목 없는 일정" : "제목 없는 사건"));
    contextEditBtn.textContent = timelineT(trip ? "일정 수정" : "사건 수정");
    contextEditBtn.title = timelineT(trip ? "일정 고치기" : "사건 고치기");
    contextEarlierBtn.textContent = timelineT(trip ? "같은 시작 시각에서 먼저 표시" : "같은 날짜에서 먼저 표시");
    contextEarlierBtn.title = timelineT(trip ? "같은 시작 시각에서 앞 일정으로 이동" : "같은 날짜에서 앞 사건으로 이동");
    contextEarlierBtn.disabled = !timelineCanMoveEvent(model.events, event.id, -1);
    contextLaterBtn.textContent = timelineT(trip ? "같은 시작 시각에서 나중 표시" : "같은 날짜에서 나중 표시");
    contextLaterBtn.title = timelineT(trip ? "같은 시작 시각에서 뒤 일정으로 이동" : "같은 날짜에서 뒤 사건으로 이동");
    contextLaterBtn.disabled = !timelineCanMoveEvent(model.events, event.id, 1);
    contextMapBtn.textContent = timelineT(trip ? "지도에서 장소 찾기" : "지도에서 유적지 찾기");
    contextMapBtn.hidden = !(event.placeName || event.placeAddress);
    contextDeleteBtn.textContent = timelineT(trip ? "일정 삭제" : "사건 삭제");
    contextMenu.hidden = false;
    const pad = 8;
    const width = contextMenu.offsetWidth;
    const height = contextMenu.offsetHeight;
    contextMenu.style.left = Math.max(pad, Math.min(pointerEvent.clientX, window.innerWidth - width - pad)) + "px";
    contextMenu.style.top = Math.max(pad, Math.min(pointerEvent.clientY, window.innerHeight - height - pad)) + "px";
    const first = contextMenu.querySelector("button:not([hidden]):not(:disabled)");
    if (first) first.focus({ preventScroll:true });
    document.addEventListener("pointerdown", onTimelineContextOutside, true);
    window.addEventListener("keydown", onTimelineContextKey, true);
  }
  function onTimelineContextMenu(pointerEvent){
    const target = pointerEvent.target;
    if (!target || typeof target.closest !== "function") return;
    const item = target.closest(".timeline-card,.timeline-tick,.timeline-overview-marker,.timeline-list-item");
    if (!item || !workspace.contains(item)) return;
    const id = item.dataset.eventId || item.dataset.timelineContextEventId || "";
    if (!id) return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    openTimelineContextMenu(pointerEvent, id, item);
  }
  function applyPurposeLabels(){
    const trip = tripMode();
    root.classList.toggle("is-trip", trip);
    titleInput.placeholder = timelineT(trip ? "여행 제목" : "연대표 제목");
    titleInput.setAttribute("aria-label", titleInput.placeholder);
    addBtn.textContent = timelineT(trip ? "＋ 일정" : "＋ 사건");
    addBtn.title = timelineT(trip ? "새 여행 일정 추가" : "새 사건 또는 기간 추가");
    moveEarlierBtn.title = timelineT(trip ? "같은 시작 시각에서 앞 일정으로 이동" : "같은 날짜에서 앞 사건으로 이동");
    moveLaterBtn.title = timelineT(trip ? "같은 시작 시각에서 뒤 일정으로 이동" : "같은 날짜에서 뒤 사건으로 이동");
    modeSelect.title = timelineT(trip ? "일정 사이 간격" : "사건 사이 간격");
    if (modeSelect.options[1]) modeSelect.options[1].textContent = timelineT(trip ? "실제 시간 간격" : "시간 간격대로");
    overviewBtn.title = timelineT(overview ? "상세 카드 보기로 돌아가기" : trip ? "모든 일정을 한 화면에서 보기" : "모든 사건을 한 화면에서 보기");
    listTitle.textContent = timelineT(trip ? "일정 목록" : "사건 목록");
    searchInput.placeholder = timelineT(trip ? "제목·유형·장소·메모 검색" : "제목·분류·유적지·설명 검색");
    emptyTitle.textContent = timelineT(trip ? "첫 일정을 넣어 여행계획을 시작하세요" : "첫 사건을 넣어 연대표를 시작하세요");
    emptyText.textContent = timelineT(trip
      ? "날짜와 시각, 장소, 메모, 사진을 넣을 수 있습니다."
      : "연도·날짜와 설명, 사진을 넣을 수 있습니다. 기원전은 ‘기원전 300’처럼 적으세요.");
    emptyAdd.textContent = timelineT(trip ? "＋ 첫 일정 추가" : "＋ 첫 사건 추가");
    emptyAdd.title = timelineT(trip ? "새 여행 일정 추가" : "새 사건 추가");
    presentBtn.textContent = timelineT(trip ? "▶ 일정 보기" : "▶ 발표");
    presentBtn.title = timelineT(trip ? "일정을 시간순으로 하나씩 크게 보여주기" : "사건을 하나씩 크게 보여주기");
    exportSummary.title = timelineT(trip ? "일정 목록을 CSV 또는 Excel로 저장" : "사건 목록을 CSV 또는 Excel로 저장");
    csvOutBtn.title = timelineT(trip ? "일정 목록을 UTF-8 CSV로 저장" : "사건 목록을 UTF-8 CSV로 저장");
    xlsxOutBtn.title = timelineT(trip ? "사진을 포함한 일정 목록을 Excel 파일로 저장" : "사진을 포함한 사건 목록을 Excel 파일로 저장");
    csvInBtn.title = timelineT(trip ? "CSV·엑셀(.xlsx)에서 일정 가져오기" : "CSV·엑셀(.xlsx)에서 사건 가져오기");
  }

  const serialize = () => timelineDocSerialize(model);
  const snapshot = () => timelineSnapshot(model);
  const touch = () => {
    if (typeof markDocumentDirty === "function"){
      markDocumentDirty(doc, !timelineSnapshotEqual(snapshot(), doc._timelineSavedSnapshot));
    }
    scheduleRecovery();
  };
  /* 복구본은 사진까지 통째로 다시 쓴다. 사진이 많은 문서는 한 번 쓰는 값이 커서
     타자 도중 자주 밀어 넣으면 버벅인다. 무거운 문서일수록 뜸하게 남긴다. */
  const scheduleRecovery = () => {
    clearTimeout(recoveryTimer);
    if (typeof appSettings === "object" && appSettings && appSettings.pdfRecovery === false) return;
    const heavy = timelinePhotoTotalChars(model.events) > TIMELINE_PHOTO_TOTAL_MAX_CHARS / 4;
    recoveryTimer = setTimeout(() => { recoveryTimer = 0; flushRecovery(); },
      heavy ? TIMELINE_RECOVERY_DELAY * 3 : TIMELINE_RECOVERY_DELAY);
  };
  const flushRecovery = async () => {
    clearTimeout(recoveryTimer); recoveryTimer = 0;
    if (!doc.hasUnsavedEdits && !(doc.isScratch && !doc._named)) return true;
    if (typeof rememberWorkspace !== "function" || typeof recoverySnapshotFile !== "function") return false;
    try {
      const file = recoverySnapshotFile(doc, new TextEncoder().encode(serialize()), "application/json");
      if (!file) return false;
      doc.savedInWorkspace = await rememberWorkspace([file], false, { silent:true });
      return !!doc.savedInWorkspace;
    } catch(error){ console.warn("연대표 복구본을 남기지 못했어요:", error); return false; }
  };
  doc.flushBackupRecovery = flushRecovery;

  const replaceModel = restored => {
    model.title = restored.title;
    model.purpose = timelinePurpose(restored.purpose);
    model.viewMode = restored.viewMode;
    model.events = restored.events;
    titleInput.value = model.title;
    purposeSelect.value = model.purpose;
    modeSelect.value = model.viewMode;
    applyPurposeLabels();
    if (selectedId && !model.events.some(event => event.id === selectedId)) selectedId = "";
    renderAll(); touch();
  };
  const updateHistory = () => {
    undoBtn.disabled = !(history && history.canUndo());
    redoBtn.disabled = !(history && history.canRedo());
  };
  history = MNEditHistory.create({
    capture:snapshot,
    isEqual:timelineSnapshotEqual,
    apply:state => replaceModel(timelineSnapshotModel(state)),
    onChange:updateHistory,
    limit:TIMELINE_HISTORY_LIMIT
  });
  doc._timelineHistory = history;
  history.reset();

  function applyTrackScale(){
    const factor = overview ? 1 : zoom;
    canvas.style.transform = "scale(" + factor + ")";
    stage.style.width = Math.max(viewport.clientWidth, Math.ceil(trackBaseWidth * factor)) + "px";
    stage.style.height = Math.max(overview ? viewport.clientHeight : 0, Math.ceil(trackBaseHeight * factor)) + "px";
  }

  function setZoom(value, anchor){
    if (overview) return;
    const previousZoom = zoom || 1;
    const rect = viewport.getBoundingClientRect();
    const pointerAnchor = anchor && anchor !== false && Number.isFinite(anchor.clientX) && Number.isFinite(anchor.clientY);
    const anchorX = pointerAnchor ? anchor.clientX - rect.left : viewport.clientWidth / 2;
    const anchorY = pointerAnchor ? anchor.clientY - rect.top : viewport.clientHeight / 2;
    const contentX = (viewport.scrollLeft + anchorX) / previousZoom;
    const contentY = (viewport.scrollTop + anchorY) / previousZoom;
    zoom = Math.max(TIMELINE_ZOOM_MIN, Math.min(TIMELINE_ZOOM_MAX, Number(value) || 1));
    /* 빈 화면은 카드가 840px 기본 캔버스의 가운데가 아니라 현재 보이는 작업 영역의 가운데에
       있어야 한다. 사건이 없을 때만 캔버스 크기도 새 배율에 맞춰 다시 계산한다. */
    if (!model.events.length) renderTrack();
    else applyTrackScale();
    zoomLabel.textContent = Math.round(zoom * 100) + "%";
    if (anchor !== false){
      viewport.scrollLeft = Math.max(0, contentX * zoom - anchorX);
      viewport.scrollTop = Math.max(0, contentY * zoom - anchorY);
    }
  }

  function setOverview(value, options){
    const next = !!value;
    if (overview === next) return;
    if (next){
      detailView = { zoom, left:viewport.scrollLeft, top:viewport.scrollTop };
      overview = true;
    } else {
      overview = false;
      zoom = detailView.zoom;
    }
    root.classList.toggle("is-overview", overview);
    overviewBtn.classList.toggle("is-on", overview);
    overviewBtn.textContent = overview ? timelineT("▤ 상세") : timelineT("▤ 개요");
    overviewBtn.title = overview ? timelineT("상세 카드 보기로 돌아가기") : timelineT(tripMode() ? "모든 일정을 한 화면에서 보기" : "모든 사건을 한 화면에서 보기");
    zoomOut.disabled = overview; zoomIn.disabled = overview; zoomLabel.disabled = overview;
    zoomLabel.textContent = overview ? timelineT("전체") : Math.round(zoom * 100) + "%";
    renderTrack();
    if (overview){ viewport.scrollLeft = 0; viewport.scrollTop = 0; }
    else if (!(options && options.skipRestore)){
      viewport.scrollLeft = detailView.left; viewport.scrollTop = detailView.top;
    }
  }

  const placeText = event => [event && event.placeName, event && event.placeAddress].filter(Boolean).join(" · ");
  async function searchTimelinePlace(event){
    const query = String(event && (event.placeAddress || event.placeName) || "").trim();
    if (!query) return;
    if (typeof globalThis.searchMapForPlace !== "function"){
      if (typeof toast === "function") toast(timelineT("지도를 열 수 없어요."), 2400, { type:"error" });
      return;
    }
    try { await globalThis.searchMapForPlace(query); }
    catch(_){ if (typeof toast === "function") toast(timelineT(tripMode() ? "지도에서 장소를 찾지 못했어요." : "지도에서 유적지를 찾지 못했어요."), 2800, { type:"error" }); }
  }

  function timelinePlaceButton(event, className){
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = "📍 " + placeText(event);
    button.title = timelineT("지도에서 검색") + ": " + (event.placeAddress || event.placeName);
    button.addEventListener("click", clickEvent => {
      clickEvent.preventDefault(); clickEvent.stopPropagation(); searchTimelinePlace(event);
    });
    button.addEventListener("dblclick", clickEvent => { clickEvent.preventDefault(); clickEvent.stopPropagation(); });
    return button;
  }

  function timelinePresentPlaceButton(event){
    const tip = document.createElement("div");
    tip.className = "timeline-present-place-tip";
    const name = document.createElement("b");
    name.textContent = event.placeName || event.placeAddress || "";
    const address = document.createElement("span");
    address.textContent = event.placeAddress || "";
    address.hidden = !(event.placeAddress && event.placeName);
    tip.append(name, address);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timeline-present-place-link";
    button.innerHTML = TIMELINE_MAP_ICON;
    button.setAttribute("aria-label", timelineT("지도에서 검색") + ": " + placeText(event));
    button.addEventListener("click", clickEvent => {
      clickEvent.preventDefault(); clickEvent.stopPropagation(); searchTimelinePlace(event);
    });
    button.addEventListener("dblclick", clickEvent => { clickEvent.preventDefault(); clickEvent.stopPropagation(); });
    const fragment = document.createDocumentFragment();
    fragment.append(tip, button);
    return fragment;
  }

  function renderOverviewTrack(){
    trackBaseWidth = Math.max(320, viewport.clientWidth || 0);
    trackBaseHeight = Math.max(TIMELINE_OVERVIEW_MIN_HEIGHT, viewport.clientHeight || 0);
    canvas.style.width = trackBaseWidth + "px";
    canvas.style.height = trackBaseHeight + "px";
    applyTrackScale();
    if (!model.events.length){ canvas.appendChild(empty); return; }

    const axisY = Math.round(trackBaseHeight / 2);
    const hint = document.createElement("div");
    hint.className = "timeline-overview-hint";
    hint.textContent = model.events.length + timelineT(tripMode()
      ? "개 일정 · 점을 누르면 상세 카드로 이동합니다"
      : "개 사건 · 점을 누르면 상세 카드로 이동합니다");
    canvas.appendChild(hint);
    const axis = document.createElement("div");
    axis.className = "timeline-overview-axis";
    axis.style.top = axisY + "px";
    canvas.appendChild(axis);

    const entries = timelineOverviewEntries(model.events, model.viewMode, trackBaseWidth);
    const labelStep = Math.max(1, Math.ceil(entries.length / 9));
    entries.forEach((row, index) => {
      const event = row.event;
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "timeline-overview-marker" + (event.id === selectedId ? " is-selected" : "");
      marker.dataset.eventId = event.id;
      marker.style.left = row.x + "px";
      marker.style.top = (axisY + row.lane * 15) + "px";
      marker.style.setProperty("--timeline-color", timelineColorHex(event.color));
      marker.title = timelineFormatDate(event.start) + " · " + (event.title || timelineT(tripMode() ? "제목 없는 일정" : "제목 없는 사건"));
      marker.setAttribute("aria-label", marker.title + " · " + timelineT("상세 카드로 이동"));
      marker.addEventListener("click", () => {
        selectedId = event.id;
        setOverview(false, { skipRestore:true });
        selectEvent(event.id, true);
      });
      canvas.appendChild(marker);

      if (index === 0 || index === entries.length - 1 || index % labelStep === 0){
        const label = document.createElement("div");
        label.className = "timeline-overview-label";
        label.style.left = row.x + "px";
        label.style.top = (axisY + (index % 2 ? 58 : -78)) + "px";
        label.textContent = timelineFormatDate(event.start) + " · " + (event.title || timelineT(tripMode() ? "제목 없는 일정" : "제목 없는 사건"));
        canvas.appendChild(label);
      }
    });
  }

  function renderTrack(){
    canvas.replaceChildren();
    if (overview){ renderOverviewTrack(); return; }
    const layout = timelineLayoutEntries(model.events, model.viewMode, 1);
    const isEmpty = !layout.entries.length;
    trackBaseWidth = isEmpty
      ? Math.max(320, Math.ceil((viewport.clientWidth || 840) / (zoom || 1)))
      : Math.ceil(layout.width);
    trackBaseHeight = isEmpty
      ? Math.max(320, Math.ceil((viewport.clientHeight || TIMELINE_STAGE_HEIGHT) / (zoom || 1)))
      : TIMELINE_STAGE_HEIGHT;
    canvas.style.width = trackBaseWidth + "px";
    canvas.style.height = trackBaseHeight + "px";
    applyTrackScale();
    if (isEmpty){
      canvas.appendChild(empty);
      return;
    }
    const axis = document.createElement("div");
    axis.className = "timeline-axis";
    canvas.appendChild(axis);
    for (const row of layout.entries){
      const event = row.event;
      const color = timelineColorHex(event.color);
      if (row.endX > row.x + 2){
        const period = document.createElement("div");
        period.className = "timeline-period";
        period.style.left = row.x + "px";
        period.style.width = Math.max(18, row.endX - row.x) + "px";
        period.style.setProperty("--timeline-color", color);
        period.title = timelineFormatDate(event.start) + " ~ " + timelineFormatDate(event.end);
        canvas.appendChild(period);
      }
      const tick = document.createElement("button");
      tick.type = "button";
      tick.className = "timeline-tick";
      tick.dataset.timelineContextEventId = event.id;
      tick.style.left = row.x + "px";
      tick.style.setProperty("--timeline-color", color);
      tick.title = event.title;
      tick.setAttribute("aria-label", timelineFormatDate(event.start) + " " + event.title);
      tick.addEventListener("click", () => selectEvent(event.id, true));
      canvas.appendChild(tick);

      const label = document.createElement("div");
      label.className = "timeline-tick-label";
      label.style.left = row.x + "px";
      label.textContent = timelineFormatDate(event.start);
      canvas.appendChild(label);

      const card = document.createElement("article");
      card.className = "timeline-card timeline-lane-" + row.lane + (event.id === selectedId ? " is-selected" : "");
      card.dataset.eventId = event.id;
      card.style.left = row.x + "px";
      card.style.setProperty("--timeline-color", color);
      card.tabIndex = 0;
      if (event.image){
        const image = document.createElement("img");
        image.src = event.image.dataUrl; image.alt = event.image.name || event.title;
        card.appendChild(image);
      }
      const meta = document.createElement("div");
      meta.className = "timeline-card-meta";
      const date = document.createElement("span");
      date.textContent = timelineFormatDate(event.start) + (event.end ? " — " + timelineFormatDate(event.end) : "");
      meta.appendChild(date);
      if (event.category){
        const category = document.createElement("b"); category.textContent = event.category; meta.appendChild(category);
      }
      const heading = document.createElement("h3"); heading.textContent = event.title || timelineT(tripMode() ? "제목 없는 일정" : "제목 없는 사건");
      const description = document.createElement("p"); description.textContent = event.description || "";
      card.append(meta, heading);
      if (event.description) card.appendChild(description);
      if (event.placeName || event.placeAddress){
        card.classList.add("has-place");
        card.appendChild(timelinePlaceButton(event, "timeline-place-link"));
      }
      const connector = document.createElement("span"); connector.className = "timeline-connector"; card.appendChild(connector);
      card.addEventListener("click", () => {
        selectEvent(event.id, false);
        clearTimeout(cardPreviewTimer);
        cardPreviewTimer = setTimeout(() => {
          cardPreviewTimer = 0;
          startPresent(event.id);
        }, 220);
      });
      card.addEventListener("dblclick", () => {
        clearTimeout(cardPreviewTimer);
        cardPreviewTimer = 0;
        openEventDialog(event.id);
      });
      card.addEventListener("keydown", keyEvent => {
        if (keyEvent.target !== card) return;
        if (keyEvent.key === "Enter"){ keyEvent.preventDefault(); openEventDialog(event.id); }
        else if (keyEvent.key === "Delete"){ keyEvent.preventDefault(); removeEvent(event.id); }
      });
      canvas.appendChild(card);
    }
  }

  function renderList(){
    list.innerHTML = "";
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const row of timelineSortedEvents(model.events)){
      const event = row.event;
      const haystack = [event.title, event.start, event.end, event.category, event.placeName,
        event.placeAddress, event.description].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) continue;
      visible++;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "timeline-list-item" + (event.id === selectedId ? " is-selected" : "");
      item.dataset.eventId = event.id;
      item.style.setProperty("--timeline-color", timelineColorHex(event.color));
      const date = document.createElement("small"); date.textContent = timelineFormatDate(event.start);
      const title = document.createElement("strong"); title.textContent = event.title || timelineT(tripMode() ? "제목 없는 일정" : "제목 없는 사건");
      const category = document.createElement("span"); category.textContent = event.category || "";
      item.append(date, title, category);
      item.addEventListener("click", () => selectEvent(event.id, true));
      item.addEventListener("dblclick", () => openEventDialog(event.id));
      list.appendChild(item);
    }
    if (!visible){
      const none = document.createElement("div"); none.className = "timeline-list-empty";
      none.textContent = query ? timelineT("검색 결과가 없습니다.") : timelineT(tripMode() ? "아직 일정이 없습니다." : "아직 사건이 없습니다.");
      list.appendChild(none);
    }
  }

  function updateMoveButtons(){
    moveEarlierBtn.disabled = !selectedId || !timelineCanMoveEvent(model.events, selectedId, -1);
    moveLaterBtn.disabled = !selectedId || !timelineCanMoveEvent(model.events, selectedId, 1);
  }

  function renderAll(){ renderTrack(); renderList(); updateMoveButtons(); updateHistory(); }

  function syncSelectedState(){
    for (const item of stage.querySelectorAll("[data-event-id]")){
      item.classList.toggle("is-selected", item.dataset.eventId === selectedId);
    }
    for (const item of list.querySelectorAll("[data-event-id]")){
      item.classList.toggle("is-selected", item.dataset.eventId === selectedId);
    }
  }

  function selectEvent(id, scroll){
    selectedId = String(id || "");
    if (overview && scroll) setOverview(false, { skipRestore:true });
    syncSelectedState();
    updateMoveButtons();
    if (scroll){
      const card = [...stage.querySelectorAll("[data-event-id]")].find(item => item.dataset.eventId === selectedId);
      if (card) card.scrollIntoView({ behavior:"smooth", block:"nearest", inline:"center" });
    }
  }

  function moveSelected(direction){
    if (!selectedId || !timelineMoveEvent(model.events, selectedId, direction)) return;
    history.commit(); touch(); renderAll();
    setTimeout(() => selectEvent(selectedId, true), 0);
  }
  doc.timelineSelectEvent = selectEvent;

  async function removeEvent(id){
    const event = model.events.find(item => item.id === id);
    if (!event) return;
    let approved = true;
    if (typeof confirmDialog === "function"){
      approved = await confirmDialog("‘" + (event.title || (tripMode() ? "제목 없는 일정" : "제목 없는 사건")) + "’ " +
        (tripMode() ? "일정을 지울까요?" : "사건을 지울까요?"), "지우기", "취소");
    } else approved = confirm(tripMode() ? "이 일정을 지울까요?" : "이 사건을 지울까요?");
    if (!approved) return;
    model.events = model.events.filter(item => item.id !== id);
    if (selectedId === id) selectedId = "";
    history.commit(); touch(); renderAll();
  }

  function openEventDialog(id){
    const existing = id ? model.events.find(item => item.id === id) : null;
    const trip = tripMode();
    const categoryList = trip ? ' list="timeline-trip-types"' : "";
    const tripTypes = trip ? '<datalist id="timeline-trip-types"><option value="이동"><option value="관광"><option value="식사"><option value="숙박"></datalist>' : "";
    const modal = document.createElement("div");
    modal.className = "modal timeline-event-modal";
    modal.innerHTML = '<div class="timeline-modal-card" role="dialog" aria-modal="true">' +
      '<header><h2></h2><button type="button" class="timeline-modal-x" aria-label="닫기">×</button></header>' +
      '<div class="timeline-form-grid">' +
        '<label class="timeline-field timeline-field-wide"><span>' + timelineT("제목") + '</span><input class="timeline-form-title" type="text" maxlength="120"></label>' +
        '<label class="timeline-field"><span>' + timelineT("시작") + '</span><input class="timeline-form-start" type="text" maxlength="40" placeholder="' +
          timelineT(trip ? "예: 2026-08-21 09:30" : "예: 1945-08-15 · 기원전 300") + '"></label>' +
        '<label class="timeline-field"><span>' + timelineT("종료(선택)") + '</span><input class="timeline-form-end" type="text" maxlength="40" placeholder="' +
          timelineT(trip ? "예: 2026-08-21 11:00" : "기간이면 끝 날짜") + '"></label>' +
        '<label class="timeline-field"><span>' + timelineT(trip ? "유형" : "분류") + '</span><input class="timeline-form-category" type="text" maxlength="60"' + categoryList + ' placeholder="' +
          timelineT(trip ? "예: 이동·관광·식사·숙박" : "예: 정치·문화·과학") + '">' + tripTypes + '</label>' +
        '<label class="timeline-field"><span>색상</span><select class="timeline-form-color"></select></label>' +
        '<label class="timeline-field"><span>' + timelineT(trip ? "장소(선택)" : "관련 유적지(선택)") + '</span><input class="timeline-form-place-name" type="text" maxlength="120" placeholder="' + timelineT("예: 경복궁") + '"></label>' +
        '<label class="timeline-field"><span>' + timelineT(trip ? "장소 주소(선택)" : "유적지 주소(선택)") + '</span><input class="timeline-form-place-address" type="text" maxlength="200" placeholder="' + timelineT("예: 서울특별시 종로구 사직로 161") + '"></label>' +
        '<label class="timeline-field timeline-field-wide"><span>' + timelineT(trip ? "메모" : "설명") + '</span><textarea class="timeline-form-description" maxlength="4000" rows="6"></textarea></label>' +
        '<div class="timeline-photo-field timeline-field-wide"><span>사진</span><div class="timeline-photo-preview"></div>' +
          '<div><button type="button" class="timeline-photo-pick">사진 넣기</button><button type="button" class="timeline-photo-remove">사진 지우기</button>' +
          '<input class="timeline-photo-input" type="file" accept="image/png,image/jpeg,image/webp" hidden></div></div>' +
      '</div><p class="timeline-form-error" role="alert"></p>' +
      '<footer><button type="button" class="timeline-form-delete">지우기</button><span></span>' +
        '<button type="button" class="timeline-form-cancel">취소</button><button type="button" class="timeline-form-save">저장</button></footer>' +
      '</div>';
    document.body.appendChild(modal);
    const card = modal.querySelector(".timeline-modal-card");
    const heading = modal.querySelector("h2");
    const title = modal.querySelector(".timeline-form-title");
    const start = modal.querySelector(".timeline-form-start");
    const end = modal.querySelector(".timeline-form-end");
    const category = modal.querySelector(".timeline-form-category");
    const placeName = modal.querySelector(".timeline-form-place-name");
    const placeAddress = modal.querySelector(".timeline-form-place-address");
    const description = modal.querySelector(".timeline-form-description");
    const color = modal.querySelector(".timeline-form-color");
    const error = modal.querySelector(".timeline-form-error");
    const preview = modal.querySelector(".timeline-photo-preview");
    const photoInput = modal.querySelector(".timeline-photo-input");
    const deleteBtn = modal.querySelector(".timeline-form-delete");
    const removePhotoBtn = modal.querySelector(".timeline-photo-remove");
    let draftImage = existing && existing.image ? { ...existing.image } : null;
    heading.textContent = existing
      ? timelineT(trip ? "일정 고치기" : "사건 고치기")
      : timelineT(trip ? "새 일정 추가" : "새 사건 추가");
    title.value = existing ? existing.title : "";
    start.value = existing ? existing.start : "";
    end.value = existing ? existing.end : "";
    category.value = existing ? existing.category : "";
    placeName.value = existing ? existing.placeName : "";
    placeAddress.value = existing ? existing.placeAddress : "";
    description.value = existing ? existing.description : "";
    for (const item of TIMELINE_COLORS){
      const option = document.createElement("option"); option.value = item.id; option.textContent = timelineT(item.label);
      if ((existing ? existing.color : "blue") === item.id) option.selected = true;
      color.appendChild(option);
    }
    deleteBtn.hidden = !existing;

    const renderPhoto = () => {
      preview.innerHTML = "";
      removePhotoBtn.disabled = !draftImage;
      if (!draftImage){ preview.textContent = timelineT("사진 없음"); return; }
      const image = document.createElement("img"); image.src = draftImage.dataUrl; image.alt = draftImage.name || "사진";
      const name = document.createElement("span"); name.textContent = draftImage.name || "사진";
      preview.append(image, name);
    };
    renderPhoto();

    const close = () => { document.removeEventListener("keydown", onKey, true); modal.remove(); };
    const onKey = event => {
      if (event.key === "Escape"){ event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener("keydown", onKey, true);
    modal.querySelector(".timeline-modal-x").addEventListener("click", close);
    modal.querySelector(".timeline-form-cancel").addEventListener("click", close);
    modal.addEventListener("mousedown", event => { if (event.target === modal) close(); });
    modal.querySelector(".timeline-photo-pick").addEventListener("click", () => photoInput.click());
    removePhotoBtn.addEventListener("click", () => { draftImage = null; renderPhoto(); });
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files && photoInput.files[0]; photoInput.value = "";
      if (!file) return;
      error.textContent = timelineT("사진을 준비하는 중…");
      try {
        const photo = await timelinePreparePhoto(file);
        const oldChars = existing && existing.image ? existing.image.dataUrl.length : 0;
        if (timelinePhotoTotalChars(model.events) - oldChars + photo.dataUrl.length > TIMELINE_PHOTO_TOTAL_MAX_CHARS){
          throw new Error("photo-total-too-large");
        }
        draftImage = photo; error.textContent = ""; renderPhoto();
      } catch(photoError){
        error.textContent = photoError && photoError.message === "photo-total-too-large"
          ? timelineTf("이 연대표의 사진 합계가 {limit}를 넘습니다. 기존 사진을 줄이거나 지워 주세요.", { limit:TIMELINE_PHOTO_TOTAL_LABEL })
          : timelineT("사진을 넣지 못했어요. PNG·JPG·WebP 파일을 사용해 주세요.");
      }
    });
    modal.querySelector(".timeline-form-save").addEventListener("click", () => {
      const parsedStart = timelineParseDate(start.value);
      const parsedEnd = end.value.trim() ? timelineParseDate(end.value) : null;
      if (!title.value.trim()){ error.textContent = timelineT("제목을 입력하세요."); title.focus(); return; }
      if (!parsedStart){ error.textContent = timelineT(trip
        ? "시작을 ‘2026-08-21 09:30’처럼 입력하세요."
        : "시작 날짜를 ‘1945’, ‘1945-08-15’, ‘기원전 300’처럼 입력하세요."); start.focus(); return; }
      if (end.value.trim() && !parsedEnd){ error.textContent = timelineT(trip ? "종료 날짜·시각 형식을 확인하세요." : "종료 날짜 형식을 확인하세요."); end.focus(); return; }
      if (parsedEnd && parsedEnd.key < parsedStart.key){ error.textContent = timelineT(trip ? "종료는 시작보다 빠를 수 없습니다." : "종료 날짜는 시작 날짜보다 빠를 수 없습니다."); end.focus(); return; }
      const next = timelineNormalizeEvent({
        id:existing ? existing.id : timelineEventId(),
        title:title.value.trim(), start:start.value.trim(), end:end.value.trim(),
        category:category.value.trim(), placeName:placeName.value.trim(), placeAddress:placeAddress.value.trim(),
        description:description.value, color:color.value,
        imageFileName:draftImage ? draftImage.name : (existing && !existing.image ? existing.imageFileName : ""),
        image:draftImage, order:existing ? existing.order : model.events.length
      }, model.events.length);
      if (existing){
        const at = model.events.findIndex(item => item.id === existing.id);
        if (at >= 0) model.events[at] = next;
      } else model.events.push(next);
      selectedId = next.id;
      history.commit(); touch(); renderAll(); close();
      setTimeout(() => selectEvent(next.id, true), 0);
    });
    deleteBtn.addEventListener("click", async () => { close(); await removeEvent(existing.id); });
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(card);
    setTimeout(() => title.focus(), 0);
  }

  const present = document.createElement("div");
  present.className = "timeline-present"; present.hidden = true;
  present.innerHTML = '<div class="timeline-present-top"><div class="timeline-present-status"><span class="timeline-present-count"></span>' +
    '<span class="timeline-present-progress" role="progressbar" aria-label="발표 진행" aria-valuemin="1"><i></i></span></div>' +
    '<button type="button" class="timeline-present-end">끝내기</button></div>' +
    '<div class="timeline-present-card"><div class="timeline-present-meta"></div>' +
    '<div class="timeline-present-body"><div class="timeline-present-image"></div>' +
    '<div class="timeline-present-copy"><h2></h2><p></p>' +
    '<span class="timeline-present-more" aria-hidden="true">' + TIMELINE_MORE_ICON + '</span></div></div>' +
    '<div class="timeline-present-place"></div></div>' +
    '<div class="timeline-present-controls"><button type="button" class="timeline-present-prev">이전</button>' +
    '<button type="button" class="timeline-present-next">다음</button></div>';
  root.appendChild(present);
  const presentCopyEl = present.querySelector(".timeline-present-copy");
  const updatePresentMore = () => {
    const rest = presentCopyEl.scrollHeight - presentCopyEl.clientHeight - presentCopyEl.scrollTop;
    presentCopyEl.classList.toggle("has-more", rest > 8);
  };
  presentCopyEl.addEventListener("scroll", updatePresentMore, { passive:true });
  const showPresent = index => {
    if (!presentRows.length) return;
    presentIndex = Math.max(0, Math.min(presentRows.length - 1, index));
    const event = presentRows[presentIndex].event;
    present.querySelector(".timeline-present-count").textContent = (presentIndex + 1) + " / " + presentRows.length;
    const progress = present.querySelector(".timeline-present-progress");
    progress.style.setProperty("--timeline-progress", (((presentIndex + 1) / presentRows.length) * 100) + "%");
    progress.setAttribute("aria-valuenow", String(presentIndex + 1));
    progress.setAttribute("aria-valuemax", String(presentRows.length));
    present.querySelector(".timeline-present-meta").textContent = timelineFormatDate(event.start) +
      (event.end ? " — " + timelineFormatDate(event.end) : "") + (event.category ? " · " + event.category : "");
    present.querySelector("h2").textContent = event.title || timelineT(tripMode() ? "제목 없는 일정" : "제목 없는 사건");
    present.querySelector("p").textContent = event.description || "";
    presentCopyEl.scrollTop = 0;
    const presentPlace = present.querySelector(".timeline-present-place");
    presentPlace.replaceChildren();
    presentPlace.hidden = !(event.placeName || event.placeAddress);
    if (!presentPlace.hidden) presentPlace.appendChild(timelinePresentPlaceButton(event));
    const presentCard = present.querySelector(".timeline-present-card");
    presentCard.style.setProperty("--timeline-color", timelineColorHex(event.color));
    present.style.setProperty("--timeline-color", timelineColorHex(event.color));
    const imageHost = present.querySelector(".timeline-present-image"); imageHost.innerHTML = "";
    imageHost.hidden = !event.image;
    presentCard.classList.toggle("is-text-only", !event.image);
    presentCard.classList.toggle("has-image", !!event.image);
    if (event.image){ const image = document.createElement("img"); image.src = event.image.dataUrl; image.alt = event.image.name || event.title; imageHost.appendChild(image); }
    present.querySelector(".timeline-present-prev").disabled = presentIndex <= 0;
    present.querySelector(".timeline-present-next").disabled = presentIndex >= presentRows.length - 1;
    presentCopyEl.tabIndex = presentCopyEl.scrollHeight - presentCopyEl.clientHeight > 1 ? 0 : -1;
    updatePresentMore();
  };
  const stopPresent = () => {
    if (present.hidden) return;
    present.hidden = true; root.classList.remove("is-presenting");
    window.removeEventListener("keydown", onPresentKey);
    if (presentRows[presentIndex]) selectEvent(presentRows[presentIndex].event.id, true);
  };
  const onPresentKey = event => {
    if (event.key === "Escape"){ event.preventDefault(); stopPresent(); }
    else if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown"){ event.preventDefault(); showPresent(presentIndex + 1); }
    else if (event.key === "ArrowLeft" || event.key === "PageUp"){ event.preventDefault(); showPresent(presentIndex - 1); }
  };
  const startPresent = eventId => {
    presentRows = timelineSortedEvents(model.events);
    if (!presentRows.length){ if (typeof toast === "function") toast(timelineT(tripMode() ? "보여줄 일정이 없습니다." : "발표할 사건이 없습니다."), 2200); return; }
    const startId = eventId || selectedId;
    const selectedAt = startId ? presentRows.findIndex(row => row.event.id === startId) : 0;
    present.hidden = false; root.classList.add("is-presenting");
    showPresent(selectedAt >= 0 ? selectedAt : 0);
    window.addEventListener("keydown", onPresentKey);
  };
  present.querySelector(".timeline-present-end").addEventListener("click", stopPresent);
  present.querySelector(".timeline-present-prev").addEventListener("click", () => showPresent(presentIndex - 1));
  present.querySelector(".timeline-present-next").addEventListener("click", () => showPresent(presentIndex + 1));

  function printTimeline(){
    const old = document.getElementById("timelinePrintLayer"); if (old) old.remove();
    const layer = document.createElement("div"); layer.id = "timelinePrintLayer"; layer.className = "timeline-print";
    const heading = document.createElement("h1"); heading.textContent = model.title || (tripMode() ? "여행 일정" : "연대표"); layer.appendChild(heading);
    for (const row of timelineSortedEvents(model.events)){
      const event = row.event;
      const item = document.createElement("article"); item.style.setProperty("--timeline-color", timelineColorHex(event.color));
      const meta = document.createElement("div"); meta.textContent = timelineFormatDate(event.start) +
        (event.end ? " — " + timelineFormatDate(event.end) : "") + (event.category ? " · " + event.category : "");
      const title = document.createElement("h2"); title.textContent = event.title || (tripMode() ? "제목 없는 일정" : "제목 없는 사건");
      item.append(meta, title);
      if (event.image){ const image = document.createElement("img"); image.src = event.image.dataUrl; image.alt = event.image.name || event.title; item.appendChild(image); }
      if (event.placeName || event.placeAddress){
        const place = document.createElement("p"); place.className = "timeline-print-place";
        place.textContent = (event.placeName ? (tripMode() ? "장소: " : "유적지: ") + event.placeName : "") +
          (event.placeName && event.placeAddress ? "\n" : "") + (event.placeAddress ? "주소: " + event.placeAddress : "");
        item.appendChild(place);
      }
      if (event.description){ const text = document.createElement("p"); text.textContent = event.description; item.appendChild(text); }
      layer.appendChild(item);
    }
    document.body.appendChild(layer);
    let done = false;
    const cleanup = () => { if (done) return; done = true; window.removeEventListener("afterprint", cleanup); document.body.classList.remove("timeline-printing"); layer.remove(); };
    try { window.addEventListener("afterprint", cleanup); document.body.classList.add("timeline-printing"); window.print(); }
    finally { cleanup(); }
  }
  doc.printTimeline = printTimeline;

  titleInput.addEventListener("input", () => { model.title = titleInput.value; touch(); history.commitSoon(TIMELINE_TYPING_DELAY); });
  titleInput.addEventListener("change", () => history.commit());
  purposeSelect.addEventListener("change", () => {
    model.purpose = timelinePurpose(purposeSelect.value);
    applyPurposeLabels(); history.commit(); touch(); renderAll();
  });
  addBtn.addEventListener("click", () => openEventDialog(null));
  emptyAdd.addEventListener("click", () => openEventDialog(null));
  moveEarlierBtn.addEventListener("click", () => moveSelected(-1));
  moveLaterBtn.addEventListener("click", () => moveSelected(1));
  undoBtn.addEventListener("click", () => history.undo());
  redoBtn.addEventListener("click", () => history.redo());
  modeSelect.addEventListener("change", () => { model.viewMode = modeSelect.value === "scale" ? "scale" : "even"; history.commit(); touch(); renderAll(); });
  zoomOut.addEventListener("click", () => setZoom(zoom - TIMELINE_ZOOM_STEP));
  zoomIn.addEventListener("click", () => setZoom(zoom + TIMELINE_ZOOM_STEP));
  zoomLabel.addEventListener("click", () => setZoom(1));
  overviewBtn.addEventListener("click", () => setOverview(!overview));
  listBtn.addEventListener("click", () => { listPanel.hidden = !listPanel.hidden; listBtn.classList.toggle("is-on", !listPanel.hidden); if (!listPanel.hidden) searchInput.focus(); });
  listClose.addEventListener("click", () => { listPanel.hidden = true; listBtn.classList.remove("is-on"); });
  searchInput.addEventListener("input", renderList);
  csvInBtn.addEventListener("click", () => csvInput.click());
  csvInput.addEventListener("change", async () => {
    const file = csvInput.files && csvInput.files[0]; csvInput.value = ""; if (!file) return;
    const isSheet = /\.xlsx$/i.test(String(file.name || ""));
    const source = isSheet ? timelineT("엑셀 시트") : "CSV";
    const oldLabel = csvInBtn.textContent;
    if (isSheet){ csvInBtn.disabled = true; csvInBtn.textContent = timelineT("엑셀 읽는 중…"); }
    try {
      const result = isSheet ? await timelineEventsFromXlsx(file) : timelineEventsFromCsv(await file.text());
      const room = Math.max(0, TIMELINE_MAX_EVENTS - model.events.length);
      const added = result.events.slice(0, room);
      if (!added.length) throw new Error("event-limit");
      const base = model.events.length;
      added.forEach((event, index) => { event.order = base + index; model.events.push(event); });
      /* 엑셀 시트에 박힌 사진은 여기서 바로 줄인다. 사진 파일명·이미지 폴더를 거치지 않는다. */
      let attached = 0, failed = 0, overLimit = 0;
      if (result.imageFiles && result.imageFiles.size){
        csvInBtn.textContent = timelineT("사진 넣는 중…");
        let totalChars = timelinePhotoTotalChars(model.events);
        for (const [index, imageFile] of result.imageFiles){
          if (index >= added.length) continue;
          try {
            const photo = await timelinePreparePhoto(imageFile);
            if (totalChars + photo.dataUrl.length > TIMELINE_PHOTO_TOTAL_MAX_CHARS){ overLimit++; continue; }
            added[index].image = photo; totalChars += photo.dataUrl.length; attached++;
          } catch(_){ failed++; }
        }
      }
      history.commit(); touch(); renderAll();
      const imageRefs = added.filter(event => !event.image && event.imageFileName).length;
      const parts = [timelineTf(tripMode() ? "일정 {count}개를 가져왔어요." : "사건 {count}개를 가져왔어요.", { count:added.length })];
      if (result.skipped) parts.push(timelineTf("날짜/제목이 잘못된 {count}줄 제외", { count:result.skipped }));
      if (attached) parts.push(timelineTf("시트 사진 {count}장 연결", { count:attached }));
      if (failed) parts.push(timelineTf("사진 처리 실패 {count}장", { count:failed }));
      if (overLimit) parts.push(timelineTf("전체 {limit} 제한으로 제외 {count}개", { limit:TIMELINE_PHOTO_TOTAL_LABEL, count:overLimit }));
      if (imageRefs) parts.push(timelineTf("이미지 파일명 {count}개: [이미지 폴더]를 선택하세요.", { count:imageRefs }));
      if (typeof toast === "function") toast(parts.join(" · "), imageRefs || attached ? 5200 : 3600);
    } catch(error){
      const code = error && error.message;
      const message = code === "csv-columns" ? timelineTf("{source}에 ‘시작’과 ‘제목’ 열이 필요합니다.", { source })
        : code === "event-limit" ? timelineT(tripMode() ? "여행 일정에는 항목을 최대 1,000개까지 넣을 수 있어요." : "연대표에는 사건을 최대 1,000개까지 넣을 수 있어요.")
        : code === "xlsx-runtime" ? timelineT("엑셀을 읽을 준비가 안 됐어요. 잠시 뒤 다시 시도해 주세요.")
        : timelineTf(tripMode() ? "{source}에서 일정을 읽지 못했어요." : "{source}에서 사건을 읽지 못했어요.", { source });
      if (typeof toast === "function") toast(message, 3200, { type:"error" });
    } finally {
      csvInBtn.disabled = false; csvInBtn.textContent = oldLabel;
    }
  });
  imageFolderBtn.addEventListener("click", () => {
    const pending = model.events.filter(event => !event.image && event.imageFileName);
    if (!pending.length){
      if (typeof toast === "function") toast(timelineT("연결할 이미지 파일명이 없습니다. 먼저 이미지 파일명 열이 있는 표를 불러오세요."), 3600);
      return;
    }
    imageFolderInput.click();
  });
  imageFolderInput.addEventListener("change", async () => {
    const files = Array.from(imageFolderInput.files || []); imageFolderInput.value = "";
    if (!files.length) return;
    const pending = model.events.filter(event => !event.image && event.imageFileName);
    if (!pending.length) return;
    const lookup = timelineImageFileLookup(files);
    const prepared = new Map();
    let totalChars = timelinePhotoTotalChars(model.events);
    let attached = 0, missing = 0, failed = 0, overLimit = 0;
    const oldLabel = imageFolderBtn.textContent;
    imageFolderBtn.disabled = true; imageFolderBtn.textContent = timelineT("이미지 연결 중…");
    try {
      for (const event of pending){
        const file = timelineFindImageFile(event.imageFileName, lookup);
        if (!file){ missing++; continue; }
        try {
          if (!prepared.has(file)) prepared.set(file, timelinePreparePhoto(file));
          const photo = await prepared.get(file);
          if (totalChars + photo.dataUrl.length > TIMELINE_PHOTO_TOTAL_MAX_CHARS){ overLimit++; continue; }
          event.image = { ...photo };
          totalChars += photo.dataUrl.length;
          attached++;
        } catch(_){ failed++; }
      }
      if (attached){ history.commit(); touch(); renderAll(); }
      const parts = ["사진 " + attached + "장 연결"];
      if (missing) parts.push("파일 없음 " + missing + "개");
      if (failed) parts.push("처리 실패 " + failed + "개");
      if (overLimit) parts.push(timelineTf("전체 {limit} 제한으로 제외 {count}개", { limit:TIMELINE_PHOTO_TOTAL_LABEL, count:overLimit }));
      if (typeof toast === "function") toast(parts.join(" · "), 5200, attached ? undefined : { type:"error" });
    } finally {
      imageFolderBtn.disabled = false; imageFolderBtn.textContent = oldLabel;
    }
  });
  csvOutBtn.addEventListener("click", () => {
    const csv = "\uFEFF" + timelineEventsToCsv(model.events, model.purpose);
    timelineDownload(timelineSafeName(model.title || doc.name) + ".csv", new Blob([csv], { type:"text/csv;charset=utf-8" }));
    exportMenu.open = false;
  });
  xlsxOutBtn.addEventListener("click", async () => {
    const oldSummary = exportSummary.textContent;
    exportMenu.dataset.busy = "true";
    exportSummary.textContent = timelineT("Excel 만드는 중…");
    csvOutBtn.disabled = true; xlsxOutBtn.disabled = true;
    try {
      const result = await timelineEventsToXlsx(model.events, model.title || doc.name, model.purpose);
      timelineDownload(timelineSafeName(model.title || doc.name) + ".xlsx", new Blob([result.bytes], {
        type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }));
      const message = result.skippedImages
        ? timelineTf("Excel로 내보냈어요. 사진 {count}장은 넣지 못했습니다.", { count:result.skippedImages })
        : timelineTf("Excel로 내보냈어요. 사진 {count}장 포함", { count:result.imageCount });
      if (typeof toast === "function") toast(message, result.skippedImages ? 4400 : 3000,
        result.skippedImages ? { type:"error" } : undefined);
      exportMenu.open = false;
    } catch(error){
      const message = error && error.message === "xlsx-runtime"
        ? timelineT("엑셀을 만들 준비가 안 됐어요. 잠시 뒤 다시 시도해 주세요.")
        : timelineT("Excel 파일을 만들지 못했어요.");
      if (typeof toast === "function") toast(message, 3400, { type:"error" });
    } finally {
      delete exportMenu.dataset.busy;
      exportSummary.textContent = oldSummary;
      csvOutBtn.disabled = false; xlsxOutBtn.disabled = false;
    }
  });
  exportSummary.addEventListener("click", event => { if (exportMenu.dataset.busy) event.preventDefault(); });
  const closeExportMenu = event => {
    if (exportMenu.open && event.target instanceof Node && !exportMenu.contains(event.target)) exportMenu.open = false;
  };
  document.addEventListener("click", closeExportMenu);
  presentBtn.addEventListener("click", () => startPresent());
  printBtn.addEventListener("click", printTimeline);
  saveBtn.addEventListener("click", () => saveTimelineDoc(doc));

  const editableTarget = target => !!(target && target.closest && target.closest("input,textarea,select,[contenteditable='true']"));
  const onKeyDown = event => {
    if (doc.el.hidden || present.hidden === false || editableTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey){
      const key = String(event.key || "").toLowerCase();
      if (key === "z" && !event.shiftKey){ event.preventDefault(); history.undo(); }
      else if (key === "y" || (key === "z" && event.shiftKey)){ event.preventDefault(); history.redo(); }
      else if (key === "=" || key === "+"){ event.preventDefault(); setZoom(zoom + TIMELINE_ZOOM_STEP); }
      else if (key === "-"){ event.preventDefault(); setZoom(zoom - TIMELINE_ZOOM_STEP); }
      else if (key === "0"){ event.preventDefault(); setZoom(1); }
    } else if (event.altKey && event.key === "ArrowUp" && selectedId){ event.preventDefault(); moveSelected(-1); }
    else if (event.altKey && event.key === "ArrowDown" && selectedId){ event.preventDefault(); moveSelected(1); }
    else if (event.key === "Delete" && selectedId){ event.preventDefault(); removeEvent(selectedId); }
  };
  window.addEventListener("keydown", onKeyDown);
  viewport.addEventListener("wheel", event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? TIMELINE_ZOOM_STEP : -TIMELINE_ZOOM_STEP), event);
  }, { passive:false });

  let panState = null;
  const panBackground = target => target === viewport || target === stage || target === canvas;
  const onPanPointerDown = event => {
    if (event.button !== 0 || (event.pointerType && event.pointerType !== "mouse") || !panBackground(event.target)) return;
    event.preventDefault();
    panState = { id:event.pointerId, x:event.clientX, y:event.clientY, left:viewport.scrollLeft, top:viewport.scrollTop };
    viewport.classList.add("is-panning");
    try { viewport.setPointerCapture(event.pointerId); } catch(_){}
  };
  const onPanPointerMove = event => {
    if (!panState || event.pointerId !== panState.id) return;
    event.preventDefault();
    viewport.scrollLeft = panState.left - (event.clientX - panState.x);
    viewport.scrollTop = panState.top - (event.clientY - panState.y);
  };
  const finishPan = event => {
    if (!panState || (event && event.pointerId !== panState.id)) return;
    const pointerId = panState.id;
    panState = null; viewport.classList.remove("is-panning");
    try { if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId); } catch(_){}
  };
  viewport.addEventListener("pointerdown", onPanPointerDown);
  viewport.addEventListener("pointermove", onPanPointerMove);
  viewport.addEventListener("pointerup", finishPan);
  viewport.addEventListener("pointercancel", finishPan);
  viewport.addEventListener("lostpointercapture", finishPan);
  workspace.addEventListener("contextmenu", onTimelineContextMenu);
  root.addEventListener("scroll", closeTimelineContextMenu, true);
  window.addEventListener("resize", closeTimelineContextMenu);

  let resizeTimer = 0;
  const trackResizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      if (overview || !model.events.length) renderTrack();
      else applyTrackScale();
    }, 40);
  }) : null;
  if (trackResizeObserver) trackResizeObserver.observe(viewport);

  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer);
    clearTimeout(resizeTimer);
    clearTimeout(cardPreviewTimer);
    if (trackResizeObserver) trackResizeObserver.disconnect();
    finishPan();
    if (history) history.cancel();
    stopPresent();
    closeTimelineContextMenu();
    workspace.removeEventListener("contextmenu", onTimelineContextMenu);
    root.removeEventListener("scroll", closeTimelineContextMenu, true);
    window.removeEventListener("resize", closeTimelineContextMenu);
    contextMenu.remove();
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("click", closeExportMenu);
    if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery;
    if (doc._timelineHistory === history) delete doc._timelineHistory;
    if (doc.printTimeline === printTimeline) delete doc.printTimeline;
    if (doc.timelineSelectEvent === selectEvent) delete doc.timelineSelectEvent;
  });

  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(root);
  applyPurposeLabels();
  renderAll();
  setZoom(1, false);
  scheduleRecovery();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    TIMELINE_DOC_TYPE, TIMELINE_DOC_VERSION, TIMELINE_COLORS,
    timelineParseDate, timelineFormatDate, timelineNormalizeEvent,
    timelineDocEmpty, timelineDocParse, timelineDocSerialize, timelineDocContentKey,
    timelineSnapshot, timelineSnapshotEqual, timelineSnapshotModel,
    timelineEventsFromRows, timelineCellText, timelineSheetRows, timelineSheetImageRows, timelineNormalizeXlsxNamespaces, timelineEventsFromXlsx,
    timelineSortedEvents, timelineCanMoveEvent, timelineMoveEvent, timelineLayoutEntries, timelineOverviewEntries,
    timelineEventsToCsv, timelineEventsToXlsx, timelineEventsFromCsv,
    timelineImageMatchName, timelineImageFileLookup, timelineFindImageFile,
    timelinePhotoTotalChars, timelineScratchFileName, timelineDefaultTitle
  };
}
