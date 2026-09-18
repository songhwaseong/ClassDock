"use strict";

/* ===== 일기장(.diary) =====
   - 파일 하나 = 일기장 한 권. 속은 ZIP: diary.json(글·꾸미기·스티커 자리) + assets/*(사진 바이트).
     사진이 1년 치 쌓이는 문서라 .mnote 처럼 base64 로 JSON 에 넣으면 저장할 때마다 수백 MB 를 다시 쓴다.
   - ZIP 은 무압축(STORE)으로 직접 만든다. 사진은 이미 압축돼 있어 줄일 게 없고, JSZip(지연 로드·2.x/3.x
     전역 바꿔치기)을 끌어들이지 않아도 새 문서 뼈대를 동기로 만들 수 있다. 읽기는 남이 다시 묶은
     DEFLATE 항목도 브라우저 내장 DecompressionStream 으로 받아 준다.
   - 날짜마다 일기 하나. 비어 있는 날(글·제목·스티커·꾸미기 없음)은 저장하지 않는다 — 달력을 넘겨 보기만
     해도 빈 일기가 쌓이면 안 되기 때문이다.
   - 사진은 '스티커': 종이 위에 떠 있고 글은 비켜 흐르지 않는다. 자리·크기는 종이 폭에 대한 비율이라
     창 폭이 바뀌어도 같은 자리에 남는다. */

const DIARY_FORMAT = "classdock-diary";
// 2: 날씨·기분·스티커 회전/뒤집기·그림일기·글꼴 · 3: 원고지 줄 무늬 · 4: 그림 칸에 그린 그림(drawing) · 5: 손글씨 글꼴
// · 6: 원고지 한 줄 칸 수(genkoCols).
// 새 값이 생길 때마다 올린다 — 옛 앱이 모르는 값을 기본값으로 바꾼 채 덮어쓰지 못하게(옛 앱은 새 파일을 거절한다).
const DIARY_VERSION = 6;
const DIARY_JSON_NAME = "diary.json";
const DIARY_LINES = ["ruled", "grid", "dots", "blank", "picture", "genko"];
const DIARY_LINE_LABELS = { ruled:"줄 공책", grid:"모눈", dots:"점", blank:"빈 종이", picture:"그림일기", genko:"원고지" };
// 짧은 이름은 앱 공용 사전(i18n.js) 대신 여기 영어를 함께 둔다 — "점"·"비"·"눈" 같은 한두 글자를 사전에 넣으면
// 다른 화면의 같은 글자까지 바뀐다. diaryLabel(한국어 표, 영어 표, 값)으로 고른다.
const DIARY_LINE_LABELS_EN = { ruled:"Lined", grid:"Grid", dots:"Dots", blank:"Blank", picture:"Picture diary", genko:"Manuscript" };
// 고딕·바탕·궁서·굴림은 Windows·Mac 에 기본으로 있는 글꼴을 쓰고, 손글씨(나눔손글씨 펜·붓, OFL)는 앱에 담아 두었다가
// 고를 때만 읽는다(vendor/hand-font-*.js, 약 0.8MB 씩 — 오프라인 앱이라 웹 글꼴을 받을 수 없다).
const DIARY_FONTS = ["gothic", "myeongjo", "gungseo", "gulim", "pen", "brush"];
const DIARY_FONT_LABELS = { gothic:"고딕", myeongjo:"바탕", gungseo:"궁서", gulim:"굴림", pen:"손글씨 펜", brush:"손글씨 붓" };
const DIARY_FONT_LABELS_EN = { gothic:"Gothic", myeongjo:"Batang", gungseo:"Gungsuh", gulim:"Gulim", pen:"Hand (pen)", brush:"Hand (brush)" };
// 손글씨 글꼴 — 앱 안의 이름(family)으로 등록한다. 컴퓨터에 같은 글꼴이 깔려 있으면 그것을 먼저 쓴다.
const DIARY_HAND_FONTS = {
  pen:{ bundle:"handPen", family:"ClassDock Nanum Pen" },
  brush:{ bundle:"handBrush", family:"ClassDock Nanum Brush" }
};
// 손글씨 글꼴은 같은 크기에서 글자가 작아 보여 키운다(줄 간격·칸 크기는 그대로).
const DIARY_FONT_SCALE = { pen:1.35, brush:1.3 };
const DIARY_FONT_STACKS = {
  gothic:"",
  myeongjo:'"Batang", "바탕", "AppleMyungjo", "Noto Serif KR", serif',
  gungseo:'"Gungsuh", "궁서", "GungSeo", "Batang", serif',
  gulim:'"Gulim", "굴림", "AppleGothic", sans-serif',
  pen:'"Nanum Pen Script", "나눔손글씨 펜", "ClassDock Nanum Pen", cursive',
  brush:'"Nanum Brush Script", "나눔손글씨 붓", "ClassDock Nanum Brush", cursive'
};
function diaryFontScale(font){ return DIARY_FONT_SCALE[font] || 1; }
// 손글씨 글꼴을 읽어 document.fonts 에 올린다. 한 번만 읽고, 실패하면 다음에 다시 시도한다. 결과는 성공 여부.
const _diaryFontLoads = new Map();
function diaryEnsureFont(id){
  const info = DIARY_HAND_FONTS[id];
  if (!info) return Promise.resolve(true);
  if (_diaryFontLoads.has(id)) return _diaryFontLoads.get(id);
  const task = (async () => {
    if (typeof MNLazy === "undefined" || typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return false;
    if (!await MNLazy.tryNeed(info.bundle)) return false;
    const store = globalThis.__MN_HANDFONT || {};
    const b64 = store[id];
    if (!b64) return false;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const face = new FontFace(info.family, bytes.buffer);
    await face.load();
    document.fonts.add(face);
    delete store[id];                    // 0.8MB 문자열을 들고 있지 않는다(글꼴은 이미 올라갔다)
    return true;
  })().catch(() => false);
  _diaryFontLoads.set(id, task);
  task.then(ok => { if (!ok) _diaryFontLoads.delete(id); });
  return task;
}
// [값, 그림, 이름] — 이름은 검색·읽어 주기에 쓴다. 그림 글자는 .ui-keep-symbols 안에서만 살아남는다(icons.js 가 UI 이모지를 지움).
const DIARY_WEATHERS = [["sunny", "☀️", "맑음", "Sunny"], ["partly", "⛅", "구름 조금", "Partly cloudy"], ["cloudy", "☁️", "흐림", "Cloudy"],
  ["rainy", "🌧️", "비", "Rainy"], ["storm", "⛈️", "천둥번개", "Thunderstorm"], ["snowy", "❄️", "눈", "Snowy"],
  ["windy", "🌬️", "바람", "Windy"], ["foggy", "🌫️", "안개", "Foggy"]];
// 날씨 그림 — 색 칸 + 흰 모양 + 오른쪽 아래로 길게 늘어진 그림자(플랫 아이콘). 이모지는 기기마다 모양이 달라 직접 그린다.
// 모양은 currentColor 로 한 번만 정의해 두고, 그림자는 같은 모양을 대각선으로 겹쳐 찍어 만든다(겹친 무리 전체에 투명도를 한 번만).
// 구름 테두리는 --wx-bg 로 칠해 뒤의 해와 갈라 보이게 하고, 그림자 쪽에선 투명으로 꺼 둔다.
const DIARY_WEATHER_ART = (() => {
  const cloud = (x, y) => `<circle cx="${x - 6}" cy="${y + 1}" r="5"/><circle cx="${x + 1}" cy="${y - 3}" r="7"/><circle cx="${x + 7}" cy="${y + 1}" r="5"/><rect x="${x - 11}" y="${y + 1}" width="23" height="5" rx="2.5"/>`;
  const rays = (cx, cy, r1, r2, n) => Array.from({ length:n }, (_, i) => {
    const a = i * Math.PI * 2 / n, c = Math.cos(a), sn = Math.sin(a);
    return `<line x1="${(cx + c * r1).toFixed(1)}" y1="${(cy + sn * r1).toFixed(1)}" x2="${(cx + c * r2).toFixed(1)}" y2="${(cy + sn * r2).toFixed(1)}"/>`;
  }).join("");
  const line = 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
  const fill = 'fill="currentColor"';
  const edged = `fill="currentColor" style="stroke:var(--wx-bg);stroke-width:2.4"`;
  return {
    sunny:["#F6A53A", `<circle cx="24" cy="24" r="7" ${fill}/><g ${line}>${rays(24, 24, 10.5, 14.5, 8)}</g>`],
    partly:["#F4A07C", `<circle cx="20" cy="19" r="5" ${fill}/><g ${line}>${rays(20, 19, 7.5, 10.5, 8)}</g><g ${edged}>${cloud(27, 27)}</g><g ${fill}>${cloud(27, 27)}</g>`],
    cloudy:["#B3BACB", `<g ${fill}>${cloud(24, 24)}</g>`],
    rainy:["#5C8EDC", `<g ${fill}>${cloud(24, 20)}</g><g ${line}><line x1="18" y1="30" x2="16.5" y2="34"/><line x1="24" y1="30" x2="22.5" y2="34"/><line x1="30" y1="30" x2="28.5" y2="34"/><line x1="21" y1="35.5" x2="20" y2="38"/><line x1="27" y1="35.5" x2="26" y2="38"/></g>`],
    storm:["#8B6FE0", `<g ${fill}>${cloud(24, 19)}</g><path d="M25.5 27 L20 34.5 H24 L22 41 L29 32.5 H25 L27.5 27 Z" ${fill}/>`],
    snowy:["#7CC2F4", `<g ${line}><line x1="24" y1="12" x2="24" y2="36"/><line x1="13.6" y1="18" x2="34.4" y2="30"/><line x1="13.6" y1="30" x2="34.4" y2="18"/><path d="M20.5 13.5 L24 17 L27.5 13.5 M20.5 34.5 L24 31 L27.5 34.5 M13.5 22.5 L18.3 21 L17 16.3 M34.5 25.5 L29.7 27 L31 31.7 M13.5 25.5 L18.3 27 L17 31.7 M34.5 22.5 L29.7 21 L31 16.3"/></g>`],
    windy:["#6CC29A", `<g ${line}><path d="M11 19 H28 a4 4 0 1 0 -4 -4"/><path d="M11 25 H34 a4 4 0 1 1 -4 4"/><path d="M11 31 H23"/></g>`],
    foggy:["#A4ABBD", `<g ${line}><line x1="13" y1="17" x2="35" y2="17"/><line x1="13" y1="24" x2="35" y2="24"/><line x1="13" y1="31" x2="35" y2="31"/></g>`]
  };
})();
// 기분 그림 — 같은 방식으로 흰 얼굴을 그리고, 눈·입은 칸 색(--wx-bg)으로 칠한다(그림자 쪽에선 꺼져 얼굴 그림자만 남는다).
const DIARY_MOOD_ART = (() => {
  const face = `<circle cx="24" cy="24" r="13.5" fill="currentColor"/>`;
  const f = (d) => `<path d="${d}" fill="none" style="stroke:var(--wx-bg)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const solid = (d) => `<path d="${d}" style="fill:var(--wx-bg)"/>`;
  const dots = `<circle cx="19.5" cy="22" r="1.7" style="fill:var(--wx-bg)"/><circle cx="28.5" cy="22" r="1.7" style="fill:var(--wx-bg)"/>`;
  const heart = (x, y) => `M${x} ${y + 2.6} l-2.9 -2.9 a1.65 1.65 0 0 1 2.9 -2.3 a1.65 1.65 0 0 1 2.9 2.3 z`;
  const grin = "M18 26.5 h12 q0 6 -6 6 q-6 0 -6 -6 z";
  return {
    happy:["#F6BA33", face + f("M17.8 22 q2.2 -3 4.4 0 M25.8 22 q2.2 -3 4.4 0 M18.5 27 q5.5 5 11 0")],
    excited:["#F5964A", face + f("M18 19 l3.6 2.6 l-3.6 2.6 M30 19 l-3.6 2.6 l3.6 2.6") + solid(grin)],
    love:["#F06F6A", face + solid(heart(19.5, 19.5) + " " + heart(28.5, 19.5)) + solid(grin)],
    calm:["#EDC45C", face + f("M17.8 22 q2.2 2.6 4.4 0 M25.8 22 q2.2 2.6 4.4 0 M20 28.5 q4 2.2 8 0")],
    tired:["#8C98B3", face + f("M17.8 22.5 h4.4 M25.8 22.5 h4.4 M18.5 29.5 q1.375 -1.6 2.75 0 t2.75 0 t2.75 0 t2.75 0")],
    sad:["#8B7BE0", face + dots + f("M19 30.5 q5 -4.5 10 0") + solid("M29.2 24.6 C27.4 27.2 27.4 28.9 29.2 28.9 C31 28.9 31 27.2 29.2 24.6 Z")],
    angry:["#3FB58C", face + f("M17.5 17.5 l4.6 2.6 M30.5 17.5 l-4.6 2.6 M19 30.5 q5 -4 10 0") + dots],
    worried:["#58A7E6", face + dots + f("M17.5 18.5 l4.2 -1.8 M30.5 18.5 l-4.2 -1.8 M19.5 30 q4.5 -3.4 9 0")]
  };
})();
let _diaryWeatherSeq = 0;
function diaryWeatherSvg(id){
  const art = DIARY_WEATHER_ART[id] || DIARY_MOOD_ART[id];
  if (!art) return "";
  const n = ++_diaryWeatherSeq, g = "dwx" + n, c = "dwxc" + n;
  let shadow = "";
  for (let i = 1; i <= 22; i++) shadow += `<use href="#${g}" x="${i}" y="${i}"/>`;
  return `<svg class="diary-wx" viewBox="0 0 48 48" aria-hidden="true" focusable="false">`
    + `<defs><g id="${g}">${art[1]}</g><clipPath id="${c}"><rect width="48" height="48" rx="10"/></clipPath></defs>`
    + `<rect width="48" height="48" rx="10" fill="${art[0]}"/>`
    + `<g clip-path="url(#${c})" opacity=".13" style="color:#000;--wx-bg:transparent">${shadow}</g>`
    + `<use href="#${g}" style="color:#fff;--wx-bg:${art[0]}"/></svg>`;
}
// 날씨·기분 표시 칸 — 직접 그린 그림(없는 값이면 이모지 글자로).
function diaryMarkFill(el, info){
  const svg = info ? diaryWeatherSvg(info[0]) : "";
  if (info) el.dataset.mark = info[0]; else delete el.dataset.mark;
  if (svg){ el.innerHTML = svg; el.classList.add("has-wx"); }
  else { el.textContent = info ? info[1] : ""; el.classList.remove("has-wx"); }
  return el;
}
const DIARY_MOODS = [["happy", "😊", "기쁨", "Happy"], ["excited", "🤩", "신남", "Excited"], ["love", "🥰", "설렘", "Fluttery"],
  ["calm", "😌", "평온", "Calm"], ["tired", "😴", "피곤", "Tired"], ["sad", "😢", "슬픔", "Sad"], ["angry", "😠", "화남", "Angry"],
  ["worried", "😟", "걱정", "Worried"]];
const DIARY_GAPS = { narrow:28, normal:34, wide:42 };
const DIARY_GAP_LABELS = { narrow:"좁게", normal:"보통", wide:"넓게" };
const DIARY_GAP_LABELS_EN = { narrow:"Narrow", normal:"Normal", wide:"Wide" };
const DIARY_FONT_SIZES = { narrow:15, normal:16, wide:18 };
const DIARY_FITS = ["cover", "contain", "tile"];
const DIARY_FIT_LABELS = { cover:"꽉 채우기", contain:"전체 보이기", tile:"바둑판 반복" };
const DIARY_FIT_LABELS_EN = { cover:"Fill", contain:"Fit", tile:"Tile" };
const DIARY_MAX_ENTRIES = 5000;
const DIARY_MAX_STICKERS = 80;
const DIARY_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const DIARY_MAX_IMAGE_BYTES = 40 * 1024 * 1024;     // 넣기 전 원본 한 장(넣을 때 줄여서 담는다)
const DIARY_STICKER_MAX_DIM = 1600;
const DIARY_BG_MAX_DIM = 2400;
const DIARY_KEEP_ORIGINAL_BYTES = 1.5 * 1024 * 1024;
const DIARY_RECOVERY_DELAY = 1500;
// 암호 일기장은 기존 ZIP 전체를 AES-GCM 봉투로 감싼다. diary.json 만 잠그면 사진이 그대로 노출되므로
// 반드시 ZIP 바이트 전체가 암호문이어야 한다. 고정 헤더(40바이트)는 GCM additionalData 로도 인증한다.
//   0..7  "CDDYENC1" · 8..11 PBKDF2 반복 수(LE) · 12..27 salt · 28..39 IV · 40.. 암호문+태그
const DIARY_ENCRYPTED_MAGIC = "CDDYENC1";
const DIARY_ENCRYPTED_HEADER_BYTES = 40;
const DIARY_PBKDF2_ITER = 600000;
const DIARY_PBKDF2_MIN = 1000;
const DIARY_PBKDF2_MAX = 2000000;
const DIARY_ASSET_RE = /^assets\/[a-z0-9_-]{4,64}\.(png|jpe?g|webp|gif)$/;
const DIARY_ASSET_MIME = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif" };
const DIARY_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DIARY_WEEKDAYS_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
let _diaryScratchCount = 0;

/* ---------- 파일 암호화 ---------- */
function diaryCryptoApi(){
  try { return globalThis.crypto && globalThis.crypto.subtle ? globalThis.crypto : null; }
  catch(_){ return null; }
}
function diaryCryptoReady(){
  const api = diaryCryptoApi();
  return !!(api && typeof api.subtle.deriveKey === "function" && typeof api.subtle.encrypt === "function");
}
function diaryMagicBytes(){ return new TextEncoder().encode(DIARY_ENCRYPTED_MAGIC); }
function diaryIsEncrypted(input){
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  const magic = diaryMagicBytes();
  if (bytes.length < DIARY_ENCRYPTED_HEADER_BYTES + 16) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}
function diaryEncryptedInfo(input){
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (!diaryIsEncrypted(bytes)) throw new Error("diary-encrypted-format");
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (iterations < DIARY_PBKDF2_MIN || iterations > DIARY_PBKDF2_MAX) throw new Error("diary-encrypted-kdf");
  return {
    iterations,
    salt:bytes.slice(12, 28),
    iv:bytes.slice(28, 40),
    header:bytes.slice(0, DIARY_ENCRYPTED_HEADER_BYTES),
    ciphertext:bytes.slice(DIARY_ENCRYPTED_HEADER_BYTES)
  };
}
async function diaryDeriveProtection(password, salt, iterations=DIARY_PBKDF2_ITER){
  const api = diaryCryptoApi();
  if (!api) throw new Error("diary-crypto-unavailable");
  const iter = Math.trunc(Number(iterations));
  if (iter < DIARY_PBKDF2_MIN || iter > DIARY_PBKDF2_MAX) throw new Error("diary-encrypted-kdf");
  const actualSalt = salt ? new Uint8Array(salt) : api.getRandomValues(new Uint8Array(16));
  if (actualSalt.length !== 16) throw new Error("diary-encrypted-salt");
  const base = await api.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveKey"]);
  const key = await api.subtle.deriveKey(
    { name:"PBKDF2", salt:actualSalt, iterations:iter, hash:"SHA-256" },
    base, { name:"AES-GCM", length:256 }, false, ["encrypt", "decrypt"]
  );
  return { key, salt:actualSalt.slice(), iterations:iter };
}
async function diarySealBytes(input, protection){
  const api = diaryCryptoApi();
  if (!api || !protection || !protection.key) throw new Error("diary-crypto-unavailable");
  const salt = new Uint8Array(protection.salt || 0);
  const iterations = Math.trunc(Number(protection.iterations));
  if (salt.length !== 16 || iterations < DIARY_PBKDF2_MIN || iterations > DIARY_PBKDF2_MAX) throw new Error("diary-encrypted-format");
  const iv = api.getRandomValues(new Uint8Array(12));       // 같은 키로 저장할 때도 GCM IV 는 매번 새 값
  const header = new Uint8Array(DIARY_ENCRYPTED_HEADER_BYTES);
  header.set(diaryMagicBytes(), 0);
  new DataView(header.buffer).setUint32(8, iterations, true);
  header.set(salt, 12); header.set(iv, 28);
  const plain = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ciphertext = new Uint8Array(await api.subtle.encrypt(
    { name:"AES-GCM", iv, additionalData:header, tagLength:128 }, protection.key, plain
  ));
  const out = new Uint8Array(header.length + ciphertext.length);
  out.set(header, 0); out.set(ciphertext, header.length);
  return out;
}
async function diaryOpenSealed(input, password){
  const api = diaryCryptoApi();
  if (!api) throw new Error("diary-crypto-unavailable");
  const info = diaryEncryptedInfo(input);
  try {
    const protection = await diaryDeriveProtection(password, info.salt, info.iterations);
    const plain = await api.subtle.decrypt(
      { name:"AES-GCM", iv:info.iv, additionalData:info.header, tagLength:128 }, protection.key, info.ciphertext
    );
    return { bytes:new Uint8Array(plain), protection };
  } catch(error){
    if (error && /^diary-/.test(String(error.message || ""))) throw error;
    return null;                                            // 틀린 암호와 변조된 암호문은 GCM 단계에서 구분할 수 없다
  }
}

/* ---------- 날짜 ---------- */
function diaryDateKey(date){
  const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function diaryIsDateKey(value){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}
function diaryDateFromKey(key){
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function diaryAddDays(key, count){
  const d = diaryDateFromKey(key); d.setDate(d.getDate() + count); return diaryDateKey(d);
}
function diaryDateLabel(key){
  const d = diaryDateFromKey(key);
  return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + DIARY_WEEKDAYS[d.getDay()] + "요일";
}
// 월 달력 6주(42칸) — 일요일부터. 앞뒤 달의 날짜도 채워 두되 inMonth 로 가른다.
function diaryMonthGrid(year, month){
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++){
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ key:diaryDateKey(d), day:d.getDate(), weekday:d.getDay(), inMonth:d.getMonth() === month });
  }
  return cells;
}

/* ---------- 화면 글자(한국어/영어) ----------
   글자는 한국어로 두고 i18n.js 사전(t·tf)으로 바꾼다. 고정된 단추는 translateTree 가 언어를 바꿀 때 함께 바꾸고,
   날짜·달력처럼 그때그때 만드는 글자는 여기 함수로 그 자리에서 고른다(언어가 바뀌면 다시 그린다).
   저장·검색에 쓰는 글자(diaryDateLabel·diaryPlainText)는 언어와 무관하게 한국어다. */
function diaryIsEn(){ return typeof MNI18N !== "undefined" && !!MNI18N && MNI18N.lang === "en"; }
function diaryT(ko){ return (typeof window !== "undefined" && typeof window.t === "function") ? window.t(ko) : ko; }
function diaryTf(tmpl, vars){
  if (typeof window !== "undefined" && typeof window.tf === "function") return window.tf(tmpl, vars);
  return String(tmpl).replace(/\{(\w+)\}/g, (m, key) => (vars && vars[key] != null) ? String(vars[key]) : m);
}
function diaryUiDateLabel(key){
  if (!diaryIsEn()) return diaryDateLabel(key);
  return diaryDateFromKey(key).toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
}
// 종이 위 날짜 머리 — 한국어는 "2026. 9. 18" 처럼 짧게(요일까지 든 긴 이름은 title·읽어 주기로).
function diaryUiHeadDate(key){
  if (diaryIsEn()) return diaryUiDateLabel(key);
  const d = diaryDateFromKey(key);
  return d.getFullYear() + ". " + (d.getMonth() + 1) + ". " + d.getDate();
}
function diaryUiShortDate(key){
  const d = diaryDateFromKey(key);
  if (!diaryIsEn()) return (d.getMonth() + 1) + "월 " + d.getDate() + "일";
  return d.toLocaleDateString("en-US", { month:"short", day:"numeric" });
}
function diaryUiMonthLabel(year, month){
  if (!diaryIsEn()) return year + "년 " + (month + 1) + "월";
  return new Date(year, month, 1).toLocaleDateString("en-US", { year:"numeric", month:"long" });
}
function diaryLabel(ko, en, id){ return (diaryIsEn() ? en[id] : ko[id]) || ko[id] || id; }
// 날씨·기분 이름([값, 그림, 한국어, 영어])
function diaryName(info){ return info ? (diaryIsEn() ? info[3] : info[2]) : ""; }
function diaryUiWeekday(i){ return (diaryIsEn() ? DIARY_WEEKDAYS_EN : DIARY_WEEKDAYS)[i]; }
function diaryUiListDay(key){
  const d = diaryDateFromKey(key);
  return diaryIsEn() ? d.getDate() + " " + DIARY_WEEKDAYS_EN[d.getDay()] : d.getDate() + "일 " + DIARY_WEEKDAYS[d.getDay()];
}

/* ---------- 모델 ---------- */
// 원고지 한 줄 칸 수 — 0 은 "자동"(줄 간격 크기의 칸을 폭에 맞게 채움). 나머지는 쓰기 공책(8·10칸)부터 원고지(20칸)까지.
// 칸 수를 정하면 칸 크기는 종이 폭으로 정해지므로, 창 폭이 달라도·인쇄해도 줄바꿈 자리가 같다.
const DIARY_GENKO_COLS = [0, 8, 10, 12, 16, 20, 24];
function diaryDefaultStyle(){ return { lines:"ruled", gap:"normal", bg:"", fit:"cover", veil:0.4, font:"gothic", genkoCols:0 }; }
function diaryNormalizeStyle(raw, hasAsset){
  const base = diaryDefaultStyle();
  if (!raw || typeof raw !== "object") return base;
  const veil = Number(raw.veil);
  const bg = String(raw.bg || "");
  return {
    lines:DIARY_LINES.includes(raw.lines) ? raw.lines : base.lines,
    gap:Object.prototype.hasOwnProperty.call(DIARY_GAPS, raw.gap) ? raw.gap : base.gap,
    bg:DIARY_ASSET_RE.test(bg) && (!hasAsset || hasAsset(bg)) ? bg : "",
    fit:DIARY_FITS.includes(raw.fit) ? raw.fit : base.fit,
    // Number("")=0 이라 빈 값이 '안 덮음'으로 바뀌지 않게 문자열 비어 있음부터 거른다.
    veil:raw.veil === "" || raw.veil == null || !Number.isFinite(veil) ? base.veil : Math.max(0, Math.min(0.9, veil)),
    font:DIARY_FONTS.includes(raw.font) ? raw.font : base.font,
    genkoCols:DIARY_GENKO_COLS.includes(Number(raw.genkoCols)) ? Number(raw.genkoCols) : base.genkoCols
  };
}
function diaryStickerId(){ return "st-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function diaryNormalizeSticker(raw, hasAsset){
  if (!raw || typeof raw !== "object") return null;
  const asset = String(raw.asset || "");
  if (!DIARY_ASSET_RE.test(asset) || (hasAsset && !hasAsset(asset))) return null;
  const num = (v, lo, hi, dflt) => { const n = Number(v); return v === "" || v == null || !Number.isFinite(n) ? dflt : Math.max(lo, Math.min(hi, n)); };
  return {
    id:String(raw.id || "").slice(0, 60) || diaryStickerId(),
    asset,
    x:num(raw.x, -1, 2, 0.1),
    y:num(raw.y, -1, 60, 0.1),
    w:num(raw.w, 0.03, 1.5, 0.3),
    ar:num(raw.ar, 0.02, 50, 1),
    rot:diaryNormalizeAngle(num(raw.rot, -3600, 3600, 0)),
    flip:raw.flip === true
  };
}
// 각도는 -180 초과 ~ 180 이하로 모은다(돌리기를 여러 바퀴 해도 같은 값이 저장되게).
function diaryNormalizeAngle(deg){
  let a = Math.round((Number(deg) || 0) * 10) / 10 % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a === 0 ? 0 : a;                 // -0 을 0 으로(저장본 비교가 흔들리지 않게)
}
/* 그림 칸 그리기 — 획은 벡터로 둔다(칸 크기가 바뀌어도 선명하고, 획 하나씩 되돌리고, 파일이 작다).
   좌표·굵기는 그림 칸 폭에 대한 비율(y 도 폭 단위 — 가로세로 비율을 지키려고). e:true 는 지우개 획. */
const DIARY_PENS = [["#1f2937", "검정", "Black"], ["#ef4444", "빨강", "Red"], ["#f97316", "주황", "Orange"], ["#facc15", "노랑", "Yellow"],
  ["#22c55e", "초록", "Green"], ["#3b82f6", "파랑", "Blue"], ["#a855f7", "보라", "Purple"], ["#ec4899", "분홍", "Pink"],
  ["#92400e", "갈색", "Brown"], ["#ffffff", "하양", "White"]];
const DIARY_PEN_SIZES = [["thin", 0.006, "가늘게", "Thin"], ["mid", 0.012, "보통", "Medium"], ["thick", 0.024, "굵게", "Thick"]];
const DIARY_MAX_STROKES = 3000;
const DIARY_MAX_STROKE_POINTS = 4000;
function diaryNormalizeStroke(raw){
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.p)) return null;
  const c = /^#[0-9a-f]{6}$/i.test(String(raw.c || "")) ? String(raw.c).toLowerCase() : "#1f2937";
  const wNum = Number(raw.w);
  const w = raw.w === "" || raw.w == null || !Number.isFinite(wNum) ? 0.012 : Math.max(0.001, Math.min(0.2, wNum));
  const pts = [];
  const limit = Math.min(raw.p.length - (raw.p.length % 2), DIARY_MAX_STROKE_POINTS * 2);
  for (let i = 0; i < limit; i += 2){
    const x = Number(raw.p[i]), y = Number(raw.p[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push(Math.round(Math.max(-0.1, Math.min(1.1, x)) * 10000) / 10000, Math.round(Math.max(-0.1, Math.min(3, y)) * 10000) / 10000);
  }
  if (!pts.length) return null;
  const stroke = { c, w, p:pts };
  if (raw.e === true) stroke.e = true;
  return stroke;
}
// 획들을 그린다. bw = 그림 칸 폭(px). 지우개 획은 이 캔버스의 그림만 지운다(아래 사진·칸은 그대로).
function diaryDrawStrokes(ctx, strokes, bw){
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of (strokes || [])){
    const p = s.p || [];
    if (p.length < 2) continue;
    ctx.globalCompositeOperation = s.e ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = s.c;
    ctx.lineWidth = Math.max(0.5, s.w * bw);
    if (p.length === 2){
      ctx.beginPath(); ctx.arc(p[0] * bw, p[1] * bw, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(p[0] * bw, p[1] * bw);
    // 점 사이 가운데를 지나는 곡선 — 마우스로 그린 선의 각이 덜 진다.
    for (let i = 2; i < p.length - 2; i += 2){
      const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      ctx.quadraticCurveTo(p[i] * bw, p[i + 1] * bw, mx * bw, my * bw);
    }
    ctx.lineTo(p[p.length - 2] * bw, p[p.length - 1] * bw);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}
function diaryWeatherInfo(id){ return DIARY_WEATHERS.find(w => w[0] === id) || null; }
function diaryMoodInfo(id){ return DIARY_MOODS.find(m => m[0] === id) || null; }
function diaryNormalizeEntry(raw, hasAsset){
  if (!raw || typeof raw !== "object" || !diaryIsDateKey(raw.date)) return null;
  const stickers = (Array.isArray(raw.stickers) ? raw.stickers : []).map(s => diaryNormalizeSticker(s, hasAsset)).filter(Boolean).slice(0, DIARY_MAX_STICKERS);
  const ids = new Set();
  for (const s of stickers){ if (ids.has(s.id)) s.id = diaryStickerId(); ids.add(s.id); }
  return {
    date:raw.date,
    title:String(raw.title == null ? "" : raw.title).slice(0, 200),
    // 저장된 본문은 길이로 잘라내지 않는다. ZIP 항목 크기 제한은 읽기 단계에서 검사한다.
    text:String(raw.text == null ? "" : raw.text).replace(/\r\n?/g, "\n"),
    style:raw.style && typeof raw.style === "object" ? diaryNormalizeStyle(raw.style, hasAsset) : null,
    weather:diaryWeatherInfo(raw.weather) ? raw.weather : "",
    mood:diaryMoodInfo(raw.mood) ? raw.mood : "",
    drawing:(Array.isArray(raw.drawing) ? raw.drawing : []).slice(0, DIARY_MAX_STROKES).map(diaryNormalizeStroke).filter(Boolean),
    stickers
  };
}
function diaryEntryIsEmpty(entry){
  return !entry || (!String(entry.title || "").trim() && !String(entry.text || "").trim()
    && !(entry.stickers && entry.stickers.length) && !entry.style && !entry.weather && !entry.mood
    && !(entry.drawing && entry.drawing.length));
}
function diaryEmpty(title){
  const now = Date.now();
  return { format:DIARY_FORMAT, version:DIARY_VERSION, title:String(title || "일기장").slice(0, 200),
    createdAt:now, updatedAt:now, style:diaryDefaultStyle(), entries:[] };
}
// 신뢰할 수 없는 diary.json 을 안전한 모델로. hasAsset(이름) 이 주어지면 ZIP 에 없는 사진을 가리키는 칸은 버린다.
function diaryNormalize(raw, hasAsset){
  if (!raw || typeof raw !== "object" || raw.format !== DIARY_FORMAT) throw new Error("diary-format");
  if (!(Number(raw.version) >= 1 && Number(raw.version) <= DIARY_VERSION)) throw new Error("diary-version");
  const byDate = new Map();
  for (const item of (Array.isArray(raw.entries) ? raw.entries : []).slice(0, DIARY_MAX_ENTRIES)){
    const entry = diaryNormalizeEntry(item, hasAsset);
    if (entry && !diaryEntryIsEmpty(entry) && !byDate.has(entry.date)) byDate.set(entry.date, entry);
  }
  return {
    format:DIARY_FORMAT, version:DIARY_VERSION,
    title:String(raw.title || "일기장").slice(0, 200),
    createdAt:Number(raw.createdAt) || Date.now(),
    updatedAt:Number(raw.updatedAt) || Date.now(),
    style:diaryNormalizeStyle(raw.style, hasAsset),
    entries:[...byDate.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  };
}
function diaryCleanEntries(model){
  return (model.entries || []).filter(e => !diaryEntryIsEmpty(e))
    .slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    .map(e => ({ date:e.date, title:e.title || "", text:e.text || "", style:e.style || null,
      weather:e.weather || "", mood:e.mood || "",
      drawing:(e.drawing || []).map(st => st.e ? { c:st.c, w:st.w, p:st.p, e:true } : { c:st.c, w:st.w, p:st.p }),
      stickers:(e.stickers || []).map(s => ({ id:s.id, asset:s.asset, x:s.x, y:s.y, w:s.w, ar:s.ar,
        rot:diaryNormalizeAngle(s.rot), flip:!!s.flip })) }));
}
// 저장본과 같은지 가르는 열쇠 — 시각(updatedAt)은 빼야 저장 → 편집 → 되돌리기 뒤 다시 '깨끗'이 된다.
function diaryContentKey(model){
  return JSON.stringify({ title:model.title || "", style:model.style, entries:diaryCleanEntries(model) });
}
function diaryModelJson(model){
  return JSON.stringify({
    format:DIARY_FORMAT, version:DIARY_VERSION, title:model.title || "일기장",
    createdAt:model.createdAt || Date.now(), updatedAt:model.updatedAt || Date.now(),
    style:model.style, entries:diaryCleanEntries(model)
  }, null, 2);
}
function diaryEffectiveStyle(model, entry){
  return (entry && entry.style) ? entry.style : model.style;
}
function diaryReferencedAssets(model){
  const used = new Set();
  if (model.style && model.style.bg) used.add(model.style.bg);
  for (const e of diaryCleanEntries(model)){
    if (e.style && e.style.bg) used.add(e.style.bg);
    for (const s of e.stickers) used.add(s.asset);
  }
  return used;
}
function diaryEntryLabel(entry){
  if (!entry) return "";
  const title = String(entry.title || "").trim();
  if (title) return title;
  const line = String(entry.text || "").split("\n").map(s => s.trim()).find(Boolean);
  if (line) return line.length > 40 ? line.slice(0, 40) + "…" : line;
  if (entry.stickers && entry.stickers.length) return diaryTf("사진 {n}장", { n:entry.stickers.length });
  const mood = diaryMoodInfo(entry.mood), weather = diaryWeatherInfo(entry.weather);
  if (mood || weather) return [diaryName(weather), diaryName(mood)].filter(Boolean).join(" · ");
  return diaryT("꾸미기만 한 날");
}
function diaryPlainText(model){
  return diaryCleanEntries(model).map(e => [diaryDateLabel(e.date), diaryWeatherMoodLabel(e), e.title, e.text].filter(Boolean).join("\n")).join("\n\n");
}
function diaryEntryMatches(entry, query){
  const q = String(query || "").trim().toLowerCase();
  if (!q || !entry) return false;
  return [entry.date, diaryDateLabel(entry.date), diaryWeatherMoodLabel(entry), entry.title, entry.text].join("\n").toLowerCase().includes(q);
}
// 검색·목록용 "날씨 맑음 · 기분 기쁨" — 그림 글자 없이 이름만.
function diaryWeatherMoodLabel(entry){
  const weather = diaryWeatherInfo(entry && entry.weather), mood = diaryMoodInfo(entry && entry.mood);
  return [weather && "날씨 " + weather[2], mood && "기분 " + mood[2]].filter(Boolean).join(" · ");
}

// 쌓는 순서 바꾸기(배열 뒤가 앞). picked = 고른 id 의 Set. 고른 것끼리의 순서는 그대로 둔다.
// forward/backward 는 고르지 않은 이웃 하나와만 자리를 바꾼다(고른 것이 붙어 있으면 한 덩어리로 움직인다).
function diaryReorder(list, picked, where){
  const out = list.slice();
  const isPicked = (s) => picked.has(s.id);
  if (where === "front") return [...out.filter(s => !isPicked(s)), ...out.filter(isPicked)];
  if (where === "back") return [...out.filter(isPicked), ...out.filter(s => !isPicked(s))];
  if (where === "forward"){
    for (let i = out.length - 2; i >= 0; i--){
      if (isPicked(out[i]) && !isPicked(out[i + 1])){ const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t; }
    }
  } else if (where === "backward"){
    for (let i = 1; i < out.length; i++){
      if (isPicked(out[i]) && !isPicked(out[i - 1])){ const t = out[i]; out[i] = out[i - 1]; out[i - 1] = t; }
    }
  }
  return out;
}
// 스티커 아래 끝(종이 폭 단위). 돌린 스티커는 돌린 뒤 차지하는 상자 높이로 잰다.
function diaryStickerBottom(s){
  const w = s.w, h = s.w * s.ar;
  const rad = (Number(s.rot) || 0) * Math.PI / 180;
  const boxH = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  return s.y + h / 2 + boxH / 2;
}

/* ---------- 줄 무늬 ----------
   줄은 글자와 딱 맞아야 해서 캔버스가 아니라 textarea 자체의 배경으로 깐다. line-height 를 줄 간격과
   같게 두면 글줄마다 선이 하나씩 온다. 다만 글자는 줄 상자 한가운데에 서므로 선을 상자 바닥에 두면
   글이 두 선 사이에 떠 보인다 — 선을 글자 아랫부분(가운데 + 글자 크기의 0.62) 바로 밑으로 올린다. */
// 그림일기: 위쪽에 그림 칸(종이 폭의 약 55%)을 두고 그 아래는 원고지다(실제 그림일기 공책처럼).
// 칸의 좌우를 원고지 칸 줄의 양 끝에 맞춘다 — 그래야 그림 칸 테두리와 원고지 테두리가 한 줄로 선다.
// 원고지 칸 줄 — 칸 크기·칸 수·왼쪽 여백. 원고지·그림일기 칸·인쇄가 모두 이 한 함수로 잰다(그래야 테두리가 맞는다).
function diaryGenkoGrid(style, width){
  const w = Math.max(0, Number(width) || 0);
  const fixed = DIARY_GENKO_COLS.includes(Number(style && style.genkoCols)) ? Number(style.genkoCols) : 0;
  let cell, cols;
  if (fixed){ cols = fixed; cell = Math.max(12, Math.min(120, Math.floor((w - 64) / fixed))); }
  else { cell = DIARY_GAPS[style && style.gap] || DIARY_GAPS.normal; cols = Math.max(4, Math.floor((w - 64) / cell)); }
  return { cell, cols, offsetX:Math.max(0, Math.round((w - cols * cell) / 2)) };
}
function diaryPictureBox(style, width){
  const gap = DIARY_GAPS[style && style.gap] || DIARY_GAPS.normal;
  const w = Math.max(0, Number(width) || 0);
  const height = Math.max(4, Math.round((w * 0.55) / gap)) * gap;
  const grid = diaryGenkoGrid(style, w);
  return { top:gap / 2, left:grid.offsetX, right:Math.max(0, w - grid.offsetX - grid.cols * grid.cell - 1), height };
}
// 원고지 칸에 글자를 그리는 줄 무늬(원고지·그림일기). 이때 textarea 는 숨은 입력칸이 된다.
function diaryUsesGenko(style){ return !!style && (style.lines === "genko" || style.lines === "picture"); }
function diaryLineMetrics(style, width){
  const gap = DIARY_GAPS[style && style.gap] || DIARY_GAPS.normal;
  const lines = style && DIARY_LINES.includes(style.lines) ? style.lines : "ruled";
  const padLeft = lines === "ruled" ? 64 : (lines === "blank" || lines === "picture") ? 40 : gap * 2;
  const fontSize = Math.round((DIARY_FONT_SIZES[style && style.gap] || 16) * diaryFontScale(style && style.font));
  const lift = Math.max(0, Math.round(gap / 2 - fontSize * 0.62));
  const box = lines === "picture" ? diaryPictureBox(style, width) : null;
  const padTop = box ? gap + box.height + gap : gap;
  return { gap, lines, padTop, padLeft, padRight:32, fontSize, lift, box };
}
function diaryLineBackground(style){
  const { gap, lines, lift } = diaryLineMetrics(style);
  const line = "var(--diary-line)";
  const rule = `linear-gradient(to bottom, transparent ${gap - 1}px, ${line} ${gap - 1}px, ${line} ${gap}px)`;
  if (lines === "ruled"){
    return {
      image:`linear-gradient(to right, transparent 48px, var(--diary-margin) 48px, var(--diary-margin) 49.5px, transparent 49.5px), ${rule}`,
      size:`100% 100%, 100% ${gap}px`, position:`0 0, 0 ${-lift}px`, repeat:"no-repeat, repeat"
    };
  }
  if (lines === "grid"){
    return {
      image:`${rule}, linear-gradient(to right, transparent ${gap - 1}px, ${line} ${gap - 1}px, ${line} ${gap}px)`,
      size:`100% ${gap}px, ${gap}px 100%`, position:`0 ${-lift}px, 0 0`, repeat:"repeat, repeat"
    };
  }
  if (lines === "dots"){
    const half = gap / 2;
    return {
      image:`radial-gradient(circle, var(--diary-dot) 1.4px, transparent 1.9px)`,
      size:`${gap}px ${gap}px`, position:`${half - 1}px ${half - 1 - lift}px`, repeat:"repeat"
    };
  }
  return { image:"none", size:"auto", position:"0 0", repeat:"no-repeat" };
}

/* ---------- 원고지 ----------
   글자 하나 = 칸 하나. textarea 는 글자 폭을 칸에 못 맞추므로 원고지에서는 textarea 를 보이지 않는 입력칸으로만
   쓰고(IME·되돌리기·붙여넣기는 그대로), 글자는 칸마다 따로 그린다. 칸 배치 규칙(원고지 쓰기):
   - 한글·한자·문장부호·빈칸은 한 칸에 하나. 영문·숫자는 두 자씩 한 칸.
   - 줄바꿈(Enter)은 다음 줄 첫 칸부터.
   - 줄이 꽉 찬 뒤 오는 마침표·쉼표·물음표·느낌표는 새 줄로 넘기지 않고 끝 칸 오른쪽 여백에 붙인다.
     줄이 꽉 찬 뒤 오는 빈칸은 새 줄 첫 칸을 비우지 않도록 여백으로 보낸다(그려지지 않는다).
   pos[i] = 글자 i 앞에 커서가 놓일 자리(row, col — 영문 두 자 칸의 둘째 글자는 .5). */
function diaryGenkoMetrics(style, width){
  const w = Math.max(0, Number(width) || 0);
  const { cell, cols, offsetX } = diaryGenkoGrid(style, w);
  const rowGap = Math.round(cell * 0.32);
  // 그림일기는 그림 칸 아래에서 원고지가 시작한다.
  const box = style && style.lines === "picture" ? diaryPictureBox(style, w) : null;
  return { cell, rowGap, pitch:cell + rowGap, cols, offsetX,
    // 한 쪽 길이는 칸 크기가 아니라 줄 간격으로 잰다(큰 칸을 골라도 종이가 끝없이 길어지지 않게).
    pageH:(DIARY_GAPS[style && style.gap] || DIARY_GAPS.normal) * 26,
    padTop:box ? box.top + box.height + Math.round(cell * 0.6) : Math.round(cell * 0.8),
    fontSize:Math.round(cell * 0.58 * Math.min(1.25, diaryFontScale(style && style.font))) };   // 칸 밖으로 넘치지 않게 배율을 줄인다
}
const DIARY_GENKO_HALF = /^[A-Za-z0-9]$/;
const DIARY_GENKO_HANG = /^[.,!?]$/;
function diaryGenkoLayout(text, cols){
  const src = String(text || "");
  const n = Math.max(1, cols | 0);
  const cells = [];
  const pos = new Array(src.length + 1);
  let row = 0, col = 0, i = 0;
  while (i < src.length){
    const cp = src.codePointAt(i);
    const len = cp > 0xFFFF ? 2 : 1;
    const ch = src.slice(i, i + len);
    if (ch === "\n"){ pos[i] = { row, col }; row++; col = 0; i++; continue; }
    if (col >= n){
      const last = cells[cells.length - 1];
      if ((ch === " " || DIARY_GENKO_HANG.test(ch)) && last && last.row === row){
        pos[i] = { row, col:n };
        if (ch !== " ") last.hang = (last.hang || "") + ch;
        last.end = i + len;
        i += len;
        continue;
      }
      row++; col = 0;
    }
    const next = src[i + 1];
    if (DIARY_GENKO_HALF.test(ch) && next && DIARY_GENKO_HALF.test(next)){
      pos[i] = { row, col }; pos[i + 1] = { row, col:col + 0.5 };
      cells.push({ row, col, start:i, end:i + 2, text:ch + next, half:true });
      col++; i += 2;
      continue;
    }
    pos[i] = { row, col };
    if (len === 2) pos[i + 1] = { row, col };
    cells.push({ row, col, start:i, end:i + len, text:ch });
    col++; i += len;
  }
  pos[src.length] = { row, col };
  return { cells, pos, rows:row + 1, cols:n };
}
// 커서가 놓일 글자 번호 — 그 줄에서 x(칸 단위)에 가장 가까운 자리. 줄이 비었으면 그 줄의 첫 자리, 없는 줄이면 끝.
function diaryGenkoIndexAt(lay, row, colF){
  let best = -1, bestD = Infinity;
  for (let i = 0; i < lay.pos.length; i++){
    const p = lay.pos[i];
    if (!p || p.row !== row) continue;
    const d = Math.abs(p.col - colF);
    if (d < bestD || (d === bestD && i > best && p.col <= colF)){ best = i; bestD = d; }
  }
  if (best >= 0) return best;
  const last = lay.pos[lay.pos.length - 1];
  if (row > last.row) return lay.pos.length - 1;
  for (let i = 0; i < lay.pos.length; i++) if (lay.pos[i] && lay.pos[i].row > row) return i;
  return lay.pos.length - 1;
}
// 원고지 칸·글자를 그린다(편집기와 인쇄가 함께 쓴다). 돌려주는 값은 그린 줄 수.
function diaryRenderGenko(layer, lay, gm, opts){
  const o = opts || {};
  const rows = Math.max(lay.rows + 1, o.minRows || 0);
  const selA = Math.min(o.selStart == null ? 0 : o.selStart, o.selEnd == null ? 0 : o.selEnd);
  const selB = Math.max(o.selStart == null ? 0 : o.selStart, o.selEnd == null ? 0 : o.selEnd);
  const frag = document.createDocumentFragment();
  const gridW = gm.cols * gm.cell;
  for (let r = 0; r < rows; r++){
    const row = document.createElement("div");
    row.className = "diary-genko-row";
    row.style.cssText = `left:${gm.offsetX}px;top:${gm.padTop + r * gm.pitch}px;width:${gridW + 1}px;height:${gm.cell + 1}px;background-size:${gm.cell}px 100%, 100% 1px, 100% 1px`;
    frag.append(row);
  }
  for (const c of lay.cells){
    const top = gm.padTop + c.row * gm.pitch;
    if (c.text !== " " || (selB > selA && c.start < selB && c.end > selA)){
      const span = document.createElement("span");
      span.className = "diary-genko-ch" + (c.half ? " is-half" : "") + (selB > selA && c.start < selB && c.end > selA ? " is-sel" : "");
      span.style.cssText = `left:${gm.offsetX + c.col * gm.cell}px;top:${top}px;width:${gm.cell}px;height:${gm.cell}px;line-height:${gm.cell}px;font-size:${c.half ? Math.round(gm.fontSize * 0.82) : gm.fontSize}px`;
      span.textContent = c.text === " " ? "" : c.text;
      frag.append(span);
    }
    if (c.hang){
      const hang = document.createElement("span");
      hang.className = "diary-genko-hang";
      hang.style.cssText = `left:${gm.offsetX + gridW + 2}px;top:${top}px;height:${gm.cell}px;line-height:${gm.cell}px;font-size:${gm.fontSize}px`;
      hang.textContent = c.hang;
      frag.append(hang);
    }
  }
  layer.replaceChildren(frag);
  return rows;
}

/* ---------- ZIP (무압축 쓰기 / STORE·DEFLATE 읽기) ---------- */
const DIARY_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function diaryCrc32(bytes){
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = DIARY_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
// files: [{ name, bytes, crc? }] — 사진은 저장마다 CRC 를 다시 셀 필요가 없어 미리 센 값을 받는다.
function diaryZipBuild(files, now){
  const enc = new TextEncoder();
  const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF;
  const dosDate = (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  const items = files.map(f => {
    const name = enc.encode(f.name);
    const bytes = f.bytes instanceof Uint8Array ? f.bytes : enc.encode(String(f.bytes || ""));
    return { name, bytes, crc:typeof f.crc === "number" ? f.crc : diaryCrc32(bytes) };
  });
  let size = 22;
  for (const it of items) size += 30 + it.name.length + it.bytes.length + 46 + it.name.length;
  if (size > 0xFFFFFFFF) throw new Error("diary-too-large");
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let pos = 0;
  const offsets = [];
  for (const it of items){
    offsets.push(pos);
    view.setUint32(pos, 0x04034b50, true); view.setUint16(pos + 4, 20, true); view.setUint16(pos + 6, 0x0800, true);
    view.setUint16(pos + 8, 0, true); view.setUint16(pos + 10, dosTime, true); view.setUint16(pos + 12, dosDate, true);
    view.setUint32(pos + 14, it.crc, true); view.setUint32(pos + 18, it.bytes.length, true); view.setUint32(pos + 22, it.bytes.length, true);
    view.setUint16(pos + 26, it.name.length, true); view.setUint16(pos + 28, 0, true);
    out.set(it.name, pos + 30); out.set(it.bytes, pos + 30 + it.name.length);
    pos += 30 + it.name.length + it.bytes.length;
  }
  const cdStart = pos;
  items.forEach((it, i) => {
    view.setUint32(pos, 0x02014b50, true); view.setUint16(pos + 4, 20, true); view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true); view.setUint16(pos + 10, 0, true); view.setUint16(pos + 12, dosTime, true);
    view.setUint16(pos + 14, dosDate, true); view.setUint32(pos + 16, it.crc, true); view.setUint32(pos + 20, it.bytes.length, true);
    view.setUint32(pos + 24, it.bytes.length, true); view.setUint16(pos + 28, it.name.length, true);
    view.setUint32(pos + 42, offsets[i], true);
    out.set(it.name, pos + 46);
    pos += 46 + it.name.length;
  });
  view.setUint32(pos, 0x06054b50, true); view.setUint16(pos + 8, items.length, true); view.setUint16(pos + 10, items.length, true);
  view.setUint32(pos + 12, pos - cdStart, true); view.setUint32(pos + 16, cdStart, true);
  return out;
}
async function diaryInflateRaw(bytes){
  if (typeof DecompressionStream === "undefined") throw new Error("diary-deflate-unsupported");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function diaryZipRead(input){
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--){
    if (view.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error("diary-not-zip");
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder("utf-8");
  const files = new Map();
  for (let n = 0; n < count; n++){
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error("diary-zip-damaged");
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true), extraLen = view.getUint16(pos + 30, true), commentLen = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen)).replace(/\\/g, "/");
    pos += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || size > DIARY_MAX_ENTRY_BYTES) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error("diary-zip-damaged");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compSize > bytes.length) throw new Error("diary-zip-damaged");
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) files.set(name, raw.slice());
    else if (method === 8) files.set(name, await diaryInflateRaw(raw));
  }
  return files;
}
function diaryAssetMime(name){
  const ext = String(name).split(".").pop().toLowerCase();
  return DIARY_ASSET_MIME[ext] || "application/octet-stream";
}
// assets: Map(이름 → { bytes, crc? }) — 모델이 가리키는 것만 담는다(지운 스티커의 사진은 저장에서 빠진다).
function diaryPack(model, assets, now){
  const json = diaryModelJson({ ...model, updatedAt:now == null ? Date.now() : Number(now) });
  const files = [{ name:DIARY_JSON_NAME, bytes:new TextEncoder().encode(json) }];
  for (const name of [...diaryReferencedAssets(model)].sort()){
    const asset = assets && assets.get(name);
    if (!asset || !asset.bytes) continue;
    if (asset.crc === undefined) asset.crc = diaryCrc32(asset.bytes);
    files.push({ name, bytes:asset.bytes, crc:asset.crc });
  }
  return diaryZipBuild(files, now == null ? undefined : now);
}
async function diaryUnpack(bytes){
  const files = await diaryZipRead(bytes);
  const jsonBytes = files.get(DIARY_JSON_NAME);
  if (!jsonBytes) throw new Error("diary-format");
  const assets = new Map();
  for (const [name, data] of files){
    if (DIARY_ASSET_RE.test(name)) assets.set(name, { bytes:data });
  }
  const model = diaryNormalize(JSON.parse(new TextDecoder("utf-8").decode(jsonBytes)), name => assets.has(name));
  // 모델이 가리키지 않는 사진은 들고 있지 않는다.
  const used = diaryReferencedAssets(model);
  for (const name of [...assets.keys()]) if (!used.has(name)) assets.delete(name);
  return { model, assets };
}

/* ---------- 사진 넣기 ---------- */
async function diaryHashBytes(bytes){
  try {
    if (typeof crypto !== "undefined" && crypto.subtle){
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return [...digest.slice(0, 10)].map(b => b.toString(16).padStart(2, "0")).join("");
    }
  } catch(_){}
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
// 너무 큰 사진은 줄여 담는다. 투명 배경이 있을 수 있는 형식은 webp 로(스티커 테두리가 살아야 한다).
async function diaryPrepareImage(blob, maxDim){
  if (!blob || !/^image\//i.test(blob.type || "") || blob.size <= 0 || blob.size > DIARY_MAX_IMAGE_BYTES) return null;
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch(_){ return null; }
  const w = bitmap.width, h = bitmap.height;
  if (!w || !h){ if (bitmap.close) bitmap.close(); return null; }
  const type = String(blob.type).toLowerCase().replace("image/jpg", "image/jpeg");
  const keepType = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type);
  if (keepType && Math.max(w, h) <= maxDim && blob.size <= DIARY_KEEP_ORIGINAL_BYTES){
    if (bitmap.close) bitmap.close();
    return { bytes:new Uint8Array(await blob.arrayBuffer()), mime:type, w, h };
  }
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, cw, ch);
  if (bitmap.close) bitmap.close();
  const want = type === "image/jpeg" ? "image/jpeg" : "image/webp";
  const out = await new Promise(resolve => canvas.toBlob(resolve, want, 0.88));
  if (!out) return null;
  const mime = ["image/png", "image/jpeg", "image/webp"].includes(out.type) ? out.type : "image/png";
  return { bytes:new Uint8Array(await out.arrayBuffer()), mime, w:cw, h:ch };
}

/* ---------- 열기·만들기·저장 ---------- */
function diaryRequireCrypto(){
  if (diaryCryptoReady()) return true;
  if (typeof toast === "function") toast(diaryT("이 화면에서는 일기장 암호 기능을 쓸 수 없어요. ClassDock EXE로 열어 주세요."), 6000, { type:"error" });
  return false;
}
function diaryAttachUnlockedDoc(doc, unpacked, protection){
  doc.diary = unpacked.model;
  doc.diaryAssets = unpacked.assets;
  doc.diaryProtection = protection || null;
  doc.diarySecurityRevision = 0;
  doc.savedDiarySecurityRevision = 0;
  doc.savedText = diaryContentKey(unpacked.model);
  doc.diaryLocked = false;
  doc.render = async () => {
    if (doc._diaryMounted) return;               // 편집 상태를 잃지 않도록 한 번만 마운트
    doc._diaryMounted = true;
    doc.el.innerHTML = "";
    mountDiaryEditor(doc);
  };
  doc.contentSearchFocus = (query) => (typeof doc._diaryFocus === "function" ? doc._diaryFocus(query) : false);
}
function diaryRenderLockedPanel(doc){
  doc.el.innerHTML = "";
  const panel = document.createElement("section"); panel.className = "diary-locked-panel";
  const icon = document.createElement("div"); icon.className = "diary-locked-icon";
  if (typeof window.uiIcon === "function") icon.innerHTML = window.uiIcon("lock");
  const title = document.createElement("strong"); title.textContent = doc.name || "일기장.diary";
  const body = document.createElement("p"); body.textContent = "암호로 보호된 일기장입니다. 내용과 사진을 보려면 암호를 입력하세요.";
  const open = document.createElement("button"); open.type = "button"; open.className = "btn primary"; open.textContent = "암호 넣고 열기";
  open.addEventListener("click", () => { doc._diaryUnlockRequested = true; doc.render(); });
  panel.append(icon, title, body, open); doc.el.append(panel);
  if (typeof MNI18N !== "undefined" && MNI18N && typeof MNI18N.translateTree === "function") MNI18N.translateTree(panel);
}
async function diaryPromptUnlock(bytes, name){
  if (!diaryRequireCrypto() || typeof examAskPassword !== "function") return null;
  let message = '"' + String(name || "일기장.diary") + '" 파일을 열려면 암호가 필요해요.';
  for (;;){
    let password = await examAskPassword({ title:"일기장 암호", message, okText:"열기" });
    if (password === null) return null;
    if (typeof showLoading === "function") showLoading(diaryT("암호를 확인하는 중…"));
    let opened = null;
    try { opened = await diaryOpenSealed(bytes, password); }
    catch(error){
      console.warn("diary decrypt failed:", error);
      if (typeof toast === "function") toast(diaryT("암호화된 일기장 형식을 읽지 못했어요."), 4200, { type:"error" });
      return null;
    } finally {
      password = "";
      if (typeof hideLoading === "function") hideLoading();
    }
    if (opened) return opened;
    if (typeof toast === "function") toast(diaryT("암호가 틀리거나 파일이 손상됐어요."), 2800, { type:"error" });
    message = diaryT("암호가 틀리거나 파일이 손상됐어요. 다시 입력해 주세요.");
  }
}
async function loadDiary(file, opts = {}){
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (diaryIsEncrypted(bytes)){
    if (!diaryRequireCrypto()) return null;
    const doc = makeDoc("diary", file.name, opts);
    doc.sourceFile = file;
    doc.diaryLocked = true;
    doc._diaryUnlockRequested = !(opts && (opts.bulk || opts.restoreFromWorkspace));
    doc.render = async () => {
      if (doc._diaryMounted || doc._diaryUnlocking) return;
      diaryRenderLockedPanel(doc);
      if (!doc._diaryUnlockRequested) return;
      doc._diaryUnlockRequested = false;
      doc._diaryUnlocking = true;
      try {
        const opened = await diaryPromptUnlock(bytes, file.name);
        if (!opened) return;
        let unpacked;
        try { unpacked = await diaryUnpack(opened.bytes); }
        catch(error){
          console.warn("decrypted diary open failed:", error);
          if (typeof toast === "function") toast(diaryT("일기장(.diary)을 읽지 못했어요. 파일이 손상됐을 수 있어요."), 4200, { type:"error" });
          return;
        }
        diaryAttachUnlockedDoc(doc, unpacked, opened.protection);
        await doc.render();
        if (typeof refreshChrome === "function") refreshChrome();
      } finally { doc._diaryUnlocking = false; }
    };
    if (typeof refreshChrome === "function") refreshChrome();
    if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
    return doc;
  }

  let unpacked;
  try { unpacked = await diaryUnpack(bytes); }
  catch(error){
    console.warn("diary open failed:", error);
    if (typeof toast === "function") toast(diaryT("일기장(.diary)을 읽지 못했어요. 파일이 손상됐을 수 있어요."), 4200, { type:"error" });
    return null;
  }
  const doc = makeDoc("diary", file.name, opts);
  doc.sourceFile = file;
  diaryAttachUnlockedDoc(doc, unpacked, null);
  if (typeof refreshChrome === "function") refreshChrome();
  if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
  return doc;
}
function diaryScratchFileName(n){ return n && n > 1 ? "일기장 " + n + ".diary" : "일기장.diary"; }
function diaryStarterBytes(name){
  return diaryPack(diaryEmpty(String(name || "").replace(/\.diary$/i, "") || "일기장"), new Map());
}
function newDiaryScratch(){
  _diaryScratchCount++;
  const name = diaryScratchFileName(_diaryScratchCount);
  if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([diaryStarterBytes(name)], name, { type:"application/zip" })], { isScratch:true }));
}
function newDiaryScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, diaryScratchFileName, name => diaryStarterBytes(name), "application/zip", "새 일기장을");
}
async function diaryOutputBytes(model, assets, protection, now){
  const plain = diaryPack(model, assets, now);              // await 전에 모델을 고정해 저장 중 입력과 섞이지 않게
  return protection ? diarySealBytes(plain, protection) : plain;
}
async function saveDiary(doc){
  if (!doc || !doc.diary || doc._diarySaving) return false;
  doc._diarySaving = true;
  try {
    const now = Date.now();
    const savedKey = diaryContentKey(doc.diary);
    const savedSecurityRevision = Number(doc.diarySecurityRevision) || 0;
    const protection = doc.diaryProtection || null;
    let bytes;
    try { bytes = await diaryOutputBytes(doc.diary, doc.diaryAssets, protection, now); }
    catch(error){
      const cryptoError = /diary-crypto/.test(String(error && error.message || ""));
      if (typeof toast === "function") toast(cryptoError
        ? diaryT("일기장 암호화에 실패해서 저장하지 못했어요.")
        : diaryT("일기장이 너무 커서 저장하지 못했어요(4GB 제한)."), 4200, { type:"error" });
      return false;
    }
    const ok = (typeof saveTextDoc === "function") ? await saveTextDoc(bytes, doc, doc.name) : false;
    if (ok){
      doc.diary.updatedAt = now;
      // 복구본 큐 뒤에 최종 저장본을 넣어, 먼저 시작한 평문 복구본이 암호화 저장본을 뒤늦게 덮지 못하게 한다.
      const mime = protection ? "application/octet-stream" : "application/zip";
      if (typeof doc._diaryQueueSavedSnapshot === "function") await doc._diaryQueueSavedSnapshot(bytes, mime);
      else if (typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(doc, bytes, mime);
      // 디스크 쓰기·작업공간 갱신을 기다리는 동안에도 입력할 수 있다. 실제 쓴 내용과 암호 상태만 저장 기준으로 삼는다.
      doc.savedText = savedKey;
      doc.savedDiarySecurityRevision = savedSecurityRevision;
      const dirty = diaryContentKey(doc.diary) !== savedKey
        || (Number(doc.diarySecurityRevision) || 0) !== savedSecurityRevision;
      if (typeof markDocumentDirty === "function") markDocumentDirty(doc, dirty);
    }
    return ok;
  } finally { doc._diarySaving = false; }
}

/* ---------- 편집기 ---------- */
function diaryButton(label, title, className, icon, labelCls){
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "diary-btn";
  if (icon && typeof window.uiIcon === "function"){
    button.innerHTML = window.uiIcon(icon);
    if (label){ const span = document.createElement("span"); if (labelCls) span.className = labelCls; span.textContent = label; button.append(span); }
    else button.classList.add("diary-ico");
  } else button.textContent = label;
  if (title){ button.title = title; button.setAttribute("aria-label", title); }
  return button;
}

function mountDiaryEditor(doc){
  const model = doc.diary;
  const assets = doc.diaryAssets || (doc.diaryAssets = new Map());
  const urls = new Map();                      // 사진 이름 → object URL (문서를 닫을 때 풀어 준다)
  const today = diaryDateKey();
  let current = today;
  let viewYear = diaryDateFromKey(today).getFullYear(), viewMonth = diaryDateFromKey(today).getMonth();
  // 고른 스티커들(순서 = 고른 순서). 한 장이면 손잡이(크기·돌리기·떼기·⋯)가 보이고, 여러 장이면 테두리만.
  let selection = [];
  let history = null;
  let recoveryTimer = 0;

  const assetUrl = (name) => {
    if (!name) return "";
    if (urls.has(name)) return urls.get(name);
    const asset = assets.get(name);
    if (!asset) return "";
    const url = URL.createObjectURL(new Blob([asset.bytes], { type:diaryAssetMime(name) }));
    urls.set(name, url);
    return url;
  };
  const entryOf = (key) => model.entries.find(e => e.date === key) || null;
  const ensureEntry = (key) => {
    let entry = entryOf(key);
    if (!entry){
      entry = { date:key, title:"", text:"", style:null, weather:"", mood:"", drawing:[], stickers:[] };
      model.entries.push(entry);
    }
    return entry;
  };

  /* ----- 뼈대 ----- */
  const root = document.createElement("div");
  root.className = "diary-doc";
  const bar = document.createElement("div");
  bar.className = "diary-bar";
  const titleInput = document.createElement("input");
  titleInput.className = "diary-title";
  titleInput.type = "text";
  titleInput.maxLength = 200;
  titleInput.value = model.title || "";
  titleInput.placeholder = "일기장 이름";
  titleInput.setAttribute("aria-label", "일기장 이름");
  const undoBtn = diaryButton("", "되돌리기 (Ctrl+Z)", "diary-btn", "undo");
  const redoBtn = diaryButton("", "다시 실행 (Ctrl+Y)", "diary-btn", "redo");
  const photoBtn = diaryButton("", "사진을 스티커처럼 붙이기 — 종이 위로 끌어다 놓아도 돼요", "diary-btn", "image");
  const styleBtn = diaryButton("", "줄 무늬·배경 그림 바꾸기", "diary-btn", "sliders");
  styleBtn.setAttribute("aria-haspopup", "dialog");
  styleBtn.setAttribute("aria-expanded", "false");
  const protectBtn = diaryButton("", "파일 암호 설정·변경", "diary-btn", "lock");
  protectBtn.setAttribute("aria-haspopup", "menu");
  const saveBtn = diaryButton("저장", "일기장 저장 (Ctrl+S)", "diary-btn diary-primary run-save", "save", "run-save-label");
  saveBtn.dataset.shortcutAction = "saveCurrent";
  saveBtn.classList.add("diary-ico");            // 그림만 — 글자 칸(.run-save-label)은 documents.js 가 갈아 끼우므로 남겨 두고 CSS 로 감춘다
  const status = document.createElement("span");
  status.className = "diary-status";
  status.setAttribute("aria-live", "polite");
  const photoInput = document.createElement("input");
  photoInput.type = "file"; photoInput.accept = "image/*"; photoInput.multiple = true; photoInput.hidden = true;
  const bgInput = document.createElement("input");
  bgInput.type = "file"; bgInput.accept = "image/*"; bgInput.hidden = true;
  bar.append(titleInput, undoBtn, redoBtn, photoBtn, styleBtn, protectBtn, saveBtn, status, photoInput, bgInput);

  const body = document.createElement("div");
  body.className = "diary-body";
  const side = document.createElement("aside");
  side.className = "diary-side";
  side.setAttribute("aria-label", "달력");
  const calHead = document.createElement("div");
  calHead.className = "diary-cal-head";
  const prevMonth = diaryButton("", "이전 달", "diary-btn diary-cal-nav", "arrowLeft");
  const nextMonth = diaryButton("", "다음 달", "diary-btn diary-cal-nav", "arrow");
  const monthLabel = document.createElement("strong");
  monthLabel.className = "diary-cal-month";
  const todayBtn = diaryButton("오늘", "오늘 일기로 가기", "diary-btn diary-cal-today");
  calHead.append(prevMonth, monthLabel, nextMonth, todayBtn);
  const calGrid = document.createElement("div");
  calGrid.className = "diary-cal-grid ui-keep-symbols";      // 달력 칸의 날씨·기분 그림을 icons.js 가 지우지 않게
  calGrid.setAttribute("role", "grid");
  const monthList = document.createElement("div");
  monthList.className = "diary-month-list ui-keep-symbols";
  side.append(calHead, calGrid, monthList);

  const main = document.createElement("div");
  main.className = "diary-main";
  const pageHead = document.createElement("div");
  pageHead.className = "diary-page-head";
  const prevDay = diaryButton("", "전날", "diary-btn diary-day-nav", "arrowLeft");
  const dateLabel = document.createElement("h2");
  dateLabel.className = "diary-date";
  const nextDay = diaryButton("", "다음날", "diary-btn diary-day-nav", "arrow");
  // 오늘 배지 — 달력 그림 · 가는 선 · "오늘". 날짜 글자와 따로 두어야 날짜 칸 글자가 날짜만 남는다.
  const todayBadge = document.createElement("span");
  todayBadge.className = "diary-today-badge";
  todayBadge.hidden = true;
  todayBadge.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="2.5" y="3.5" width="15" height="14" rx="3" fill="currentColor"/>'
    + '<rect x="5.6" y="1.5" width="2" height="4.2" rx="1" fill="currentColor"/><rect x="12.4" y="1.5" width="2" height="4.2" rx="1" fill="currentColor"/>'
    + '<g fill="var(--diary-today-ink,#f0507a)"><rect x="5" y="9" width="2.4" height="2.2" rx=".6"/><rect x="8.8" y="9" width="2.4" height="2.2" rx=".6"/><rect x="12.6" y="9" width="2.4" height="2.2" rx=".6"/>'
    + '<rect x="5" y="12.8" width="2.4" height="2.2" rx=".6"/><rect x="8.8" y="12.8" width="2.4" height="2.2" rx=".6"/></g></svg>'
    + '<span class="diary-today-sep" aria-hidden="true"></span><span class="diary-today-text"></span>';
  const entryTitle = document.createElement("input");
  entryTitle.className = "diary-entry-title";
  entryTitle.type = "text";
  entryTitle.maxLength = 200;
  entryTitle.placeholder = "제목(선택)";
  entryTitle.setAttribute("aria-label", "이 날 일기 제목");
  const deleteBtn = diaryButton("", "이 날 일기 지우기", "diary-btn diary-danger", "delete");
  // 날씨·기분 — 그림 글자를 쓰므로 ui-keep-symbols 로 icons.js 의 이모지 지우기를 피한다.
  const weatherBtn = diaryButton("", "날씨 고르기", "diary-btn diary-pick ui-keep-symbols");
  weatherBtn.dataset.pick = "weather";
  const moodBtn = diaryButton("", "기분 고르기", "diary-btn diary-pick ui-keep-symbols");
  moodBtn.dataset.pick = "mood";
  pageHead.append(prevDay, dateLabel, todayBadge, nextDay, weatherBtn, moodBtn, entryTitle, deleteBtn);

  const paper = document.createElement("div");
  paper.className = "diary-paper";
  const bgLayer = document.createElement("div");
  bgLayer.className = "diary-paper-bg";
  const veilLayer = document.createElement("div");
  veilLayer.className = "diary-paper-veil";
  const area = document.createElement("textarea");
  area.className = "diary-text";
  area.spellcheck = false;
  area.setAttribute("aria-label", "일기 본문");
  const stickerLayer = document.createElement("div");
  stickerLayer.className = "diary-stickers";
  // 그림일기의 그림 칸 — 글은 그 아래부터 쓴다. 사진을 넣으면 칸에 꼭 맞춰 붙는다(그 뒤로는 보통 스티커).
  const pictureBox = document.createElement("div");
  pictureBox.className = "diary-picture-box";
  pictureBox.hidden = true;
  const pictureHint = document.createElement("div");
  pictureHint.className = "diary-picture-hint";
  const pictureHintText = document.createElement("span");
  pictureHintText.textContent = "그림 칸 — 사진을 넣거나(끌어다 놓아도 돼요) 직접 그려 보세요";
  const pictureBtn = diaryButton("사진 넣기", "그림 칸에 꼭 맞게 사진 넣기", "diary-btn", "image");
  const pictureInput = document.createElement("input");
  pictureInput.type = "file"; pictureInput.accept = "image/*"; pictureInput.hidden = true;
  const pictureDrawBtn = diaryButton("그리기", "그림 칸에 그리기", "diary-btn", "pen");
  const pictureHintBtns = document.createElement("div");
  pictureHintBtns.className = "diary-picture-hint-btns";
  pictureHintBtns.append(pictureBtn, pictureDrawBtn);
  pictureHint.append(pictureHintText, pictureHintBtns, pictureInput);
  // 그리기 층 — 그림 칸과 같은 자리, 스티커 위(사진에 덧그릴 수 있게). 그리기 중에만 누르는 것을 받는다.
  const drawLayer = document.createElement("div");
  drawLayer.className = "diary-draw-layer";
  drawLayer.hidden = true;
  const drawCanvas = document.createElement("canvas");
  drawCanvas.className = "diary-draw-canvas";
  const drawToggle = diaryButton("", "그림 칸에 그리기", "diary-draw-toggle", "pen");
  const drawBar = document.createElement("div");
  drawBar.className = "diary-draw-bar";
  drawBar.hidden = true;
  drawBar.setAttribute("role", "toolbar");
  const penButtons = DIARY_PENS.map(([color]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "diary-pen";
    b.dataset.color = color;
    b.style.setProperty("--pen", color);
    drawBar.append(b);
    return b;
  });
  const sizeButtons = DIARY_PEN_SIZES.map(([id, w]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "diary-pen-size";
    b.dataset.size = id;
    const dot = document.createElement("span");
    dot.style.width = dot.style.height = Math.round(4 + w * 300) + "px";
    b.append(dot);
    drawBar.append(b);
    return b;
  });
  const eraserBtn = diaryButton("", "지우개", "diary-draw-tool", "eraser");
  const drawClearBtn = diaryButton("", "그림 전체 지우기", "diary-draw-tool", "delete");
  const drawDoneBtn = diaryButton("다 그렸어요", "그리기 끝내기 (Esc)", "diary-btn diary-primary diary-draw-done", "check");
  drawBar.append(eraserBtn, drawClearBtn, drawDoneBtn);
  drawLayer.append(drawCanvas, drawToggle, drawBar);
  pictureBox.append(pictureHint);
  // 원고지 — 칸과 글자를 그리는 층. 이때 textarea 는 커서 자리에 숨어 입력만 받는다(IME 후보 창도 거기 뜬다).
  const genkoLayer = document.createElement("div");
  genkoLayer.className = "diary-genko";
  genkoLayer.hidden = true;
  const genkoGrid = document.createElement("div");
  genkoGrid.className = "diary-genko-grid";
  const genkoCaret = document.createElement("div");
  genkoCaret.className = "diary-genko-caret";
  genkoLayer.append(genkoGrid, genkoCaret);
  paper.append(bgLayer, veilLayer, area, genkoLayer, pictureBox, stickerLayer, drawLayer);
  main.append(pageHead, paper);
  body.append(side, main);

  /* ----- 꾸미기 창 ----- */
  const panel = document.createElement("div");
  panel.className = "diary-style-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "꾸미기");
  const section = (label) => {
    const wrap = document.createElement("div"); wrap.className = "diary-style-row";
    const head = document.createElement("div"); head.className = "diary-style-label"; head.textContent = label;
    const content = document.createElement("div"); content.className = "diary-style-controls";
    wrap.append(head, content); panel.append(wrap);
    return content;
  };
  const scopeRow = document.createElement("label");
  scopeRow.className = "diary-style-scope";
  const scopeBox = document.createElement("input");
  scopeBox.type = "checkbox";
  const scopeText = document.createElement("span");
  scopeText.textContent = "이 날짜에만 적용";
  scopeRow.append(scopeBox, scopeText);
  const scopeNote = document.createElement("div");
  scopeNote.className = "diary-style-note";
  panel.append(scopeRow, scopeNote);
  const lineChips = section("줄 무늬");
  const lineButtons = DIARY_LINES.map(id => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-chip diary-line-chip"; b.dataset.lines = id;
    const sample = document.createElement("span"); sample.className = "diary-line-sample";
    const bgc = diaryLineBackground({ lines:id, gap:"narrow" });
    // 원고지·그림일기 견본은 CSS 가 그린다 — 여기서 background-image:none 을 박으면 그 견본을 덮어 빈 칩이 된다.
    if (bgc.image !== "none") Object.assign(sample.style, { backgroundImage:bgc.image, backgroundSize:bgc.size, backgroundPosition:bgc.position, backgroundRepeat:bgc.repeat });
    const label = document.createElement("span"); label.className = "diary-chip-label"; label.textContent = DIARY_LINE_LABELS[id];
    b.append(sample, label);
    b.addEventListener("click", () => changeStyle({ lines:id }, true));
    lineChips.append(b);
    return b;
  });
  const gapChips = section("줄 간격");
  const gapButtons = Object.keys(DIARY_GAPS).map(id => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-chip"; b.dataset.gap = id; b.textContent = DIARY_GAP_LABELS[id];   // 글자는 syncPanel 이 언어에 맞춰 다시 쓴다
    b.addEventListener("click", () => changeStyle({ gap:id }, true));
    gapChips.append(b);
    return b;
  });
  // 원고지 칸 — 원고지·그림일기일 때만 보인다.
  const colsChips = section("원고지 칸");
  const colsRow = colsChips.parentElement;
  const colsButtons = DIARY_GENKO_COLS.map(n => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-chip diary-cols-chip"; b.dataset.cols = String(n);
    b.addEventListener("click", () => changeStyle({ genkoCols:n }, true));
    colsChips.append(b);
    return b;
  });
  const fontChips = section("글꼴");
  const fontButtons = DIARY_FONTS.map(id => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-chip diary-font-chip"; b.dataset.font = id;
    const sample = document.createElement("span"); sample.className = "diary-font-sample"; sample.textContent = "가나다";
    if (DIARY_FONT_STACKS[id]) sample.style.fontFamily = DIARY_FONT_STACKS[id];
    const label = document.createElement("span"); label.className = "diary-chip-label"; label.textContent = DIARY_FONT_LABELS[id];
    b.append(sample, label);
    b.addEventListener("click", () => changeStyle({ font:id }, true));
    fontChips.append(b);
    return b;
  });
  const bgControls = section("배경 그림");
  const bgThumb = document.createElement("span");
  bgThumb.className = "diary-bg-thumb";
  const bgPick = diaryButton("배경 고르기", "배경으로 깔 그림 고르기", "diary-btn", "image");
  const bgClear = diaryButton("그림 빼기", "배경 그림 빼기", "diary-btn");
  bgControls.append(bgThumb, bgPick, bgClear);
  const fitControls = section("그림 맞춤");
  const fitSelect = document.createElement("select");
  fitSelect.className = "diary-select";
  fitSelect.setAttribute("aria-label", "배경 그림 맞춤");
  DIARY_FITS.forEach(id => { const o = document.createElement("option"); o.value = id; o.textContent = DIARY_FIT_LABELS[id]; fitSelect.append(o); });
  fitControls.append(fitSelect);
  const veilControls = section("그림 흐리게");
  const veilRange = document.createElement("input");
  veilRange.type = "range"; veilRange.min = "0"; veilRange.max = "90"; veilRange.step = "5";
  veilRange.setAttribute("aria-label", "배경 그림을 종이색으로 덮는 정도");
  const veilValue = document.createElement("span");
  veilValue.className = "diary-veil-value";
  veilControls.append(veilRange, veilValue);

  // 날씨·기분 고르개(머리줄 단추 아래에 뜬다)
  const pickPop = document.createElement("div");
  pickPop.className = "diary-pick-pop ui-keep-symbols";
  pickPop.hidden = true;
  pickPop.setAttribute("role", "dialog");
  root.append(bar, body, panel, pickPop);
  doc.el.appendChild(root);

  /* ----- 상태 표시·되돌리기·복구본 ----- */
  const setStatus = (msg) => { status.textContent = msg || ""; };
  const refreshDirty = () => {
    const dirty = diaryContentKey(model) !== doc.savedText
      || (Number(doc.diarySecurityRevision) || 0) !== (Number(doc.savedDiarySecurityRevision) || 0);
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, dirty);
    setStatus(dirty ? diaryT("● 저장 안 됨") : "");
    return dirty;
  };
  let recoveryGeneration = 0;
  let recoveryChain = Promise.resolve(true);
  const snapshotBytes = () => {
    const plain = diaryPack(model, assets);
    const protection = doc.diaryProtection || null;
    return {
      promise:protection ? diarySealBytes(plain, protection) : Promise.resolve(plain),
      mime:protection ? "application/octet-stream" : "application/zip"
    };
  };
  const queueSnapshot = (bytesPromise, mime, saved) => {
    const generation = ++recoveryGeneration;
    recoveryChain = recoveryChain.catch(() => false).then(async () => {
      if (!saved && generation !== recoveryGeneration) return false;
      const bytes = await bytesPromise;
      if (!saved && generation !== recoveryGeneration) return false;
      if (saved) return typeof markDocumentSavedSnapshot === "function"
        ? markDocumentSavedSnapshot(doc, bytes, mime) : false;
      return typeof saveDocumentRecoverySnapshot === "function"
        ? saveDocumentRecoverySnapshot(doc, bytes, mime) : false;
    });
    return recoveryChain;
  };
  doc._diaryQueueSavedSnapshot = (bytes, mime) => queueSnapshot(Promise.resolve(bytes), mime, true);
  const queueRecovery = () => {
    let packed;
    try { packed = snapshotBytes(); } catch(_){ return false; }
    return queueSnapshot(packed.promise, packed.mime, false);
  };
  const scheduleRecovery = () => {
    clearTimeout(recoveryTimer);
    if (typeof appSettings !== "object" || !appSettings || !appSettings.pdfRecovery) return;
    if (typeof saveDocumentRecoverySnapshot !== "function") return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = 0;
      if (!doc.hasUnsavedEdits) return;
      const pending = queueRecovery();
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    }, DIARY_RECOVERY_DELAY);
  };
  const flushRecovery = () => {
    clearTimeout(recoveryTimer); recoveryTimer = 0;
    if (!doc.hasUnsavedEdits || typeof saveDocumentRecoverySnapshot !== "function") return true;
    return queueRecovery();
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

  /* ----- 달력 ----- */
  function renderCalendar(){
    monthLabel.textContent = diaryUiMonthLabel(viewYear, viewMonth);
    const filled = new Set(model.entries.filter(e => !diaryEntryIsEmpty(e)).map(e => e.date));
    const byDate = new Map(model.entries.map(e => [e.date, e]));
    const head = DIARY_WEEKDAYS.map((w, i) => {
      const c = document.createElement("div");
      c.className = "diary-cal-wd" + (i === 0 ? " is-sun" : i === 6 ? " is-sat" : "");
      c.textContent = diaryUiWeekday(i); c.setAttribute("role", "columnheader");
      return c;
    });
    const cells = diaryMonthGrid(viewYear, viewMonth).map(cell => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "diary-cal-day";
      if (!cell.inMonth) b.classList.add("is-out");
      if (cell.weekday === 0) b.classList.add("is-sun");
      if (cell.weekday === 6) b.classList.add("is-sat");
      if (cell.key === today) b.classList.add("is-today");
      if (cell.key === current) b.classList.add("is-selected");
      if (filled.has(cell.key)) b.classList.add("has-entry");
      b.dataset.date = cell.key;
      const num = document.createElement("span");
      num.className = "diary-cal-num";
      num.textContent = String(cell.day);
      b.append(num);
      // 기분을 먼저, 없으면 날씨를 점 대신 작게 보여 준다.
      const entry = byDate.get(cell.key);
      const mark = entry && (diaryMoodInfo(entry.mood) || diaryWeatherInfo(entry.weather));
      if (mark){
        const em = document.createElement("span");
        em.className = "diary-cal-emoji";
        diaryMarkFill(em, mark);
        b.append(em);
        b.classList.add("has-emoji");
      }
      const marks = entry ? [diaryWeatherInfo(entry.weather), diaryMoodInfo(entry.mood)].filter(Boolean).map(diaryName) : [];
      b.setAttribute("aria-label", [diaryUiDateLabel(cell.key), filled.has(cell.key) ? diaryT("일기 있음") : "", ...marks].filter(Boolean).join(" · "));
      if (cell.key === current) b.setAttribute("aria-current", "date");
      b.addEventListener("click", () => goTo(cell.key));
      return b;
    });
    calGrid.replaceChildren(...head, ...cells);

    const prefix = viewYear + "-" + String(viewMonth + 1).padStart(2, "0") + "-";
    const rows = model.entries.filter(e => e.date.startsWith(prefix) && !diaryEntryIsEmpty(e))
      .sort((a, b) => a.date < b.date ? -1 : 1);
    const heading = document.createElement("div");
    heading.className = "diary-month-list-head";
    heading.textContent = rows.length ? diaryTf("이번 달 일기 {n}편", { n:rows.length }) : diaryT("이번 달엔 아직 일기가 없어요");
    const items = rows.map(e => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "diary-month-item" + (e.date === current ? " is-selected" : "");
      b.dataset.date = e.date;
      const day = document.createElement("span"); day.className = "diary-month-item-day";
      day.textContent = diaryUiListDay(e.date);
      const label = document.createElement("span"); label.className = "diary-month-item-label";
      label.textContent = diaryEntryLabel(e);
      b.append(day);
      const mark = diaryMoodInfo(e.mood) || diaryWeatherInfo(e.weather);
      if (mark){ const em = document.createElement("span"); em.className = "diary-month-item-emoji"; diaryMarkFill(em, mark); b.append(em); }
      b.append(label);
      b.addEventListener("click", () => goTo(e.date));
      return b;
    });
    monthList.replaceChildren(heading, ...items);
  }

  /* ----- 종이 ----- */
  let paperWidth = 0;
  function applyStyle(){
    const entry = entryOf(current);
    const style = diaryEffectiveStyle(model, entry);
    const m = diaryLineMetrics(style, paperWidth || paper.clientWidth);
    const bgc = diaryLineBackground(style);
    Object.assign(area.style, {
      backgroundImage:bgc.image, backgroundSize:bgc.size, backgroundPosition:bgc.position, backgroundRepeat:bgc.repeat,
      lineHeight:m.gap + "px", fontSize:m.fontSize + "px", fontFamily:DIARY_FONT_STACKS[style.font] || "",
      paddingTop:m.padTop + "px", paddingBottom:m.gap + "px", paddingLeft:m.padLeft + "px", paddingRight:m.padRight + "px"
    });
    paper.dataset.lines = m.lines;
    paper.dataset.font = style.font;
    if (DIARY_HAND_FONTS[style.font]){
      const want = style.font;
      diaryEnsureFont(want).then(ok => {
        // 글꼴이 바뀌면 줄바꿈 자리가 달라진다 — 다 읽은 뒤 종이 높이를 다시 잰다.
        if (ok){ if (paper.dataset.font === want) layout(); }
        else setStatus(diaryT("손글씨 글꼴을 불러오지 못했어요."));
      });
    }
    const genko = diaryUsesGenko(style);
    paper.classList.toggle("is-genko", genko);
    area.classList.toggle("is-genko-input", genko);
    genkoLayer.hidden = !genko;
    genkoLayer.style.fontFamily = DIARY_FONT_STACKS[style.font] || "";
    if (!genko){ genkoLay = null; area.style.left = ""; area.style.top = ""; }
    placePictureBox(m);
    const url = assetUrl(style.bg);
    bgLayer.style.backgroundImage = url ? `url("${url}")` : "none";
    bgLayer.dataset.fit = style.fit;
    bgLayer.hidden = !url;
    veilLayer.hidden = !url;
    veilLayer.style.opacity = String(style.veil);
    syncPanel();
  }
  function syncPanel(){
    const entry = entryOf(current);
    const own = !!(entry && entry.style);
    const style = diaryEffectiveStyle(model, entry);
    scopeBox.checked = own;
    scopeNote.textContent = diaryT(own
      ? "이 날짜만 따로 꾸몄어요. 체크를 풀면 일기장 전체 꾸미기로 돌아가요."
      : "바꾸면 따로 꾸민 날을 뺀 일기장 전체에 적용돼요.");
    lineButtons.forEach(b => { const on = b.dataset.lines === style.lines; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
    gapButtons.forEach(b => { const on = b.dataset.gap === style.gap; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
    fontButtons.forEach(b => { const on = b.dataset.font === style.font; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
    lineButtons.forEach(b => { b.querySelector(".diary-chip-label").textContent = diaryLabel(DIARY_LINE_LABELS, DIARY_LINE_LABELS_EN, b.dataset.lines); });
    gapButtons.forEach(b => { b.textContent = diaryLabel(DIARY_GAP_LABELS, DIARY_GAP_LABELS_EN, b.dataset.gap); });
    fontButtons.forEach(b => { b.querySelector(".diary-chip-label").textContent = diaryLabel(DIARY_FONT_LABELS, DIARY_FONT_LABELS_EN, b.dataset.font); });
    for (const option of fitSelect.options) option.textContent = diaryLabel(DIARY_FIT_LABELS, DIARY_FIT_LABELS_EN, option.value);
    colsRow.hidden = !diaryUsesGenko(style);
    colsButtons.forEach(b => {
      const n = Number(b.dataset.cols), on = n === (style.genkoCols || 0);
      b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on));
      b.textContent = n ? (diaryIsEn() ? n + " / row" : n + "칸") : (diaryIsEn() ? "Auto" : "자동");
      b.title = n ? (diaryIsEn() ? n + " cells per row" : "한 줄에 " + n + "칸") : (diaryIsEn() ? "Cell size follows the line spacing" : "칸 크기를 줄 간격에 맞춰요");
    });
    const url = assetUrl(style.bg);
    bgThumb.style.backgroundImage = url ? `url("${url}")` : "none";
    bgThumb.classList.toggle("is-empty", !url);
    bgClear.disabled = !style.bg;
    fitSelect.value = style.fit;
    fitSelect.disabled = veilRange.disabled = !style.bg;
    veilRange.value = String(Math.round(style.veil * 100));
    veilValue.textContent = Math.round(style.veil * 100) + "%";
  }
  // 종이 높이 = 글 높이·스티커 아래 끝·최소 한 쪽 중 큰 값(줄 간격의 배수로 맞춰 마지막 줄이 잘리지 않게).
  function layout(){
    const width = paper.clientWidth;
    if (!width) return;
    paperWidth = width;
    const effective = diaryEffectiveStyle(model, entryOf(current));
    if (diaryUsesGenko(effective)){ layoutGenko(width, effective); positionStickers(); return; }
    const m = diaryLineMetrics(effective, width);
    area.style.paddingTop = m.padTop + "px";
    placePictureBox(m);
    const top = main.scrollTop;
    area.style.height = "0px";
    const textH = area.scrollHeight;
    let stickerBottom = 0;
    const entry = entryOf(current);
    for (const s of (entry ? entry.stickers : [])) stickerBottom = Math.max(stickerBottom, diaryStickerBottom(s) * width);
    const minH = m.gap * 24;
    const height = Math.ceil(Math.max(textH, stickerBottom + m.gap * 2, minH) / m.gap) * m.gap;
    area.style.height = height + "px";
    main.scrollTop = top;
    positionStickers();
  }
  function positionStickers(){
    const w = paperWidth || paper.clientWidth;
    for (const node of stickerLayer.children){
      const entry = entryOf(current);
      const s = entry && entry.stickers.find(item => item.id === node.dataset.id);
      if (!s) continue;
      node.style.left = (s.x * w) + "px";
      node.style.top = (s.y * w) + "px";
      node.style.width = (s.w * w) + "px";
      node.style.height = (s.w * s.ar * w) + "px";
      node.style.transform = s.rot ? `rotate(${s.rot}deg)` : "";
      const img = node.querySelector("img");
      if (img) img.style.transform = s.flip ? "scaleX(-1)" : "";
    }
    // 그림 칸 한가운데를 스티커가 덮고 있으면 안내 글을 감춘다(사진 위로 글자가 비치지 않게).
    if (!pictureBox.hidden){
      const entry = entryOf(current);
      const box = pictureBoxRect();
      pictureHint.hidden = drawMode || !!(entry && entry.drawing && entry.drawing.length) || !!(box && entry && entry.stickers.some(st => {
        const cx = (st.x + st.w / 2) * w, cy = (st.y + st.w * st.ar / 2) * w;
        return cx >= box.left && cx <= box.left + box.width && cy >= box.top && cy <= box.top + box.height;
      }));
    }
  }
  let genkoLay = null, genkoGm = null;
  function layoutGenko(width, style){
    placePictureBox(diaryLineMetrics(style, width));
    const gm = diaryGenkoMetrics(style, width);
    const lay = diaryGenkoLayout(area.value, gm.cols);
    const entry = entryOf(current);
    let stickerBottom = 0;
    for (const st of (entry ? entry.stickers : [])) stickerBottom = Math.max(stickerBottom, diaryStickerBottom(st) * width);
    // 한 쪽(줄 간격 26줄쯤)을 채우되, 그림일기는 그림 칸이 차지한 만큼 줄 수를 줄인다.
    const minRows = Math.max(4, Math.ceil((gm.pageH - gm.padTop) / gm.pitch), Math.ceil((stickerBottom - gm.padTop) / gm.pitch) + 1);
    const focused = document.activeElement === area;
    const rows = diaryRenderGenko(genkoGrid, lay, gm, { minRows, selStart:focused ? area.selectionStart : 0, selEnd:focused ? area.selectionEnd : 0 });
    genkoLayer.style.height = (gm.padTop + rows * gm.pitch + gm.cell) + "px";
    genkoLay = lay; genkoGm = gm;
    placeGenkoCaret();
  }
  function placeGenkoCaret(){
    if (!genkoLay) return;
    const head = area.selectionDirection === "backward" ? area.selectionStart : area.selectionEnd;
    const p = genkoLay.pos[Math.max(0, Math.min(genkoLay.pos.length - 1, head))] || { row:0, col:0 };
    const left = genkoGm.offsetX + p.col * genkoGm.cell, top = genkoGm.padTop + p.row * genkoGm.pitch;
    genkoCaret.style.left = left + "px";
    genkoCaret.style.top = (top + 3) + "px";
    genkoCaret.style.height = (genkoGm.cell - 6) + "px";
    // IME 후보 창이 커서 옆에 뜨도록 보이지 않는 입력칸도 그 자리로 옮긴다.
    area.style.left = left + "px";
    area.style.top = top + "px";
    genkoCaret.classList.toggle("is-on", document.activeElement === area && area.selectionStart === area.selectionEnd);
  }
  let genkoSelKey = "";
  function refreshGenkoSelection(force){
    if (!genkoLay) return;
    const key = document.activeElement === area ? area.selectionStart + ":" + area.selectionEnd + ":" + area.selectionDirection : "blur";
    if (!force && key === genkoSelKey) return;
    genkoSelKey = key;
    layoutGenko(paperWidth || paper.clientWidth, diaryEffectiveStyle(model, entryOf(current)));
  }
  function setGenkoSelection(anchor, head){
    if (head >= anchor) area.setSelectionRange(anchor, head, "forward");
    else area.setSelectionRange(head, anchor, "backward");
  }
  function genkoIndexFromPoint(ev){
    const r = genkoLayer.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const row = Math.max(0, Math.floor((y - genkoGm.padTop + genkoGm.rowGap / 2) / genkoGm.pitch));
    return diaryGenkoIndexAt(genkoLay, row, Math.max(0, (x - genkoGm.offsetX) / genkoGm.cell));
  }
  function pictureBoxRect(){
    const m = diaryLineMetrics(diaryEffectiveStyle(model, entryOf(current)), paperWidth || paper.clientWidth);
    if (!m.box) return null;
    const w = paperWidth || paper.clientWidth;
    return { left:m.box.left, top:m.box.top, width:Math.max(40, w - m.box.left - m.box.right), height:m.box.height };
  }
  function placePictureBox(m){
    pictureBox.hidden = !m.box;
    drawLayer.hidden = !m.box;
    if (!m.box){ if (drawMode) setDrawMode(false); return; }
    const w = paperWidth || paper.clientWidth;
    const geo = { left:m.box.left + "px", top:m.box.top + "px",
      width:Math.max(40, w - m.box.left - m.box.right) + "px", height:m.box.height + "px" };
    Object.assign(pictureBox.style, geo);
    Object.assign(drawLayer.style, geo);
    redrawDrawing();
  }

  /* ----- 그림 칸 그리기 ----- */
  let drawMode = false, eraser = false;
  let penColor = DIARY_PENS[0][0], penSize = "mid";
  try {
    const saved = JSON.parse(localStorage.getItem("mn.diaryPen") || "null");
    if (saved && DIARY_PENS.some(x => x[0] === saved.color)) penColor = saved.color;
    if (saved && DIARY_PEN_SIZES.some(x => x[0] === saved.size)) penSize = saved.size;
  } catch(_){}
  const rememberPen = () => { try { localStorage.setItem("mn.diaryPen", JSON.stringify({ color:penColor, size:penSize })); } catch(_){} };
  function syncDrawBar(){
    penButtons.forEach(b => {
      const on = !eraser && b.dataset.color === penColor;
      const info = DIARY_PENS.find(x => x[0] === b.dataset.color);
      const name = diaryIsEn() ? info[2] : info[1];
      b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on));
      b.title = name; b.setAttribute("aria-label", name);
    });
    sizeButtons.forEach(b => {
      const on = b.dataset.size === penSize;
      const info = DIARY_PEN_SIZES.find(x => x[0] === b.dataset.size);
      const name = diaryIsEn() ? info[3] : info[2];
      b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on));
      b.title = name; b.setAttribute("aria-label", name);
    });
    eraserBtn.classList.toggle("is-on", eraser);
    eraserBtn.setAttribute("aria-pressed", String(eraser));
    const entry = entryOf(current);
    drawClearBtn.disabled = !(entry && entry.drawing && entry.drawing.length);
  }
  function setDrawMode(on){
    drawMode = !!on && !pictureBox.hidden;
    paper.classList.toggle("is-drawing", drawMode);
    drawBar.hidden = !drawMode;
    drawToggle.hidden = drawMode;
    if (drawMode){ selectSticker(""); syncDrawBar(); }
    positionStickers();
  }
  function redrawDrawing(){
    if (drawLayer.hidden) return;
    const bw = drawLayer.clientWidth, bh = drawLayer.clientHeight;
    if (!bw || !bh) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cw = Math.round(bw * dpr), ch = Math.round(bh * dpr);
    if (drawCanvas.width !== cw || drawCanvas.height !== ch){ drawCanvas.width = cw; drawCanvas.height = ch; }
    const ctx = drawCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const entry = entryOf(current);
    diaryDrawStrokes(ctx, entry ? entry.drawing : [], bw);
  }
  drawCanvas.addEventListener("pointerdown", (e) => {
    if (!drawMode || e.button !== 0) return;
    e.preventDefault();
    const rect = drawCanvas.getBoundingClientRect();
    const bw = rect.width || 1;
    const size = (DIARY_PEN_SIZES.find(x => x[0] === penSize) || DIARY_PEN_SIZES[1])[1];
    const stroke = { c:penColor, w:eraser ? size * 2.5 : size, p:[] };
    if (eraser) stroke.e = true;
    const ctx = drawCanvas.getContext("2d");
    const add = (ev) => {
      if (stroke.p.length >= DIARY_MAX_STROKE_POINTS * 2) return;
      const x = (ev.clientX - rect.left) / bw, y = (ev.clientY - rect.top) / bw;
      const n = stroke.p.length;
      if (n && Math.abs(stroke.p[n - 2] - x) < 0.0015 && Math.abs(stroke.p[n - 1] - y) < 0.0015) return;
      stroke.p.push(Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000);
      // 그리는 동안은 새 토막만 바로 그린다(모든 획을 매번 다시 그리면 획이 많을 때 느려진다).
      const q = stroke.p, m = q.length;
      ctx.save();
      ctx.globalCompositeOperation = stroke.e ? "destination-out" : "source-over";
      ctx.strokeStyle = ctx.fillStyle = stroke.c;
      ctx.lineWidth = Math.max(0.5, stroke.w * bw);
      ctx.lineCap = "round";
      ctx.beginPath();
      if (m >= 4){ ctx.moveTo(q[m - 4] * bw, q[m - 3] * bw); ctx.lineTo(q[m - 2] * bw, q[m - 1] * bw); ctx.stroke(); }
      else { ctx.arc(q[0] * bw, q[1] * bw, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    };
    add(e);
    try { drawCanvas.setPointerCapture(e.pointerId); } catch(_){}
    const move = (ev) => {
      const list = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [];
      if (list.length) list.forEach(add); else add(ev);
    };
    const up = () => {
      drawCanvas.removeEventListener("pointermove", move);
      drawCanvas.removeEventListener("pointerup", up);
      drawCanvas.removeEventListener("pointercancel", up);
      if (!stroke.p.length) return;
      if (history) history.flush();
      const entry = ensureEntry(current);
      const wasEmpty = diaryEntryIsEmpty(entry);
      if (!Array.isArray(entry.drawing)) entry.drawing = [];
      if (entry.drawing.length >= DIARY_MAX_STROKES){ setStatus(diaryT("그림이 너무 많아 더 그릴 수 없어요.")); redrawDrawing(); return; }
      entry.drawing.push(stroke);
      redrawDrawing();
      deleteBtn.disabled = diaryEntryIsEmpty(entry);
      if (wasEmpty) renderCalendar();
      syncDrawBar();
      touch(true);
    };
    drawCanvas.addEventListener("pointermove", move);
    drawCanvas.addEventListener("pointerup", up);
    drawCanvas.addEventListener("pointercancel", up);
  });
  penButtons.forEach(b => b.addEventListener("click", () => { penColor = b.dataset.color; eraser = false; rememberPen(); syncDrawBar(); }));
  sizeButtons.forEach(b => b.addEventListener("click", () => { penSize = b.dataset.size; rememberPen(); syncDrawBar(); }));
  eraserBtn.addEventListener("click", () => { eraser = !eraser; syncDrawBar(); });
  drawClearBtn.addEventListener("click", () => {
    const entry = entryOf(current);
    if (!entry || !entry.drawing || !entry.drawing.length) return;
    if (history) history.flush();
    entry.drawing = [];
    redrawDrawing(); syncDrawBar(); renderCalendar(); positionStickers();
    deleteBtn.disabled = diaryEntryIsEmpty(entry);
    touch(true);
    setStatus(diaryT("그림을 모두 지웠어요. Ctrl+Z 로 되돌릴 수 있어요."));
  });
  drawDoneBtn.addEventListener("click", () => setDrawMode(false));
  drawToggle.addEventListener("click", (e) => { e.stopPropagation(); setDrawMode(true); });
  pictureDrawBtn.addEventListener("click", (e) => { e.stopPropagation(); setDrawMode(true); });
  function renderStickers(){
    const entry = entryOf(current);
    const list = entry ? entry.stickers : [];
    selection = selection.filter(id => list.some(s => s.id === id));
    // 다시 그리면 스티커 요소가 새로 생겨 포커스가 빠진다 — 같은 스티커에 되돌려야 방향키·단축키가 이어진다.
    const focusedId = document.activeElement && stickerLayer.contains(document.activeElement)
      ? document.activeElement.dataset.id : "";
    stickerLayer.replaceChildren(...list.map(s => {
      const node = document.createElement("div");
      node.className = "diary-sticker" + (selection.includes(s.id) ? " is-selected" : "");
      node.dataset.id = s.id;
      node.tabIndex = 0;
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", "붙인 사진 — 끌어서 옮기기, 모서리로 크기, 위 손잡이로 돌리기, 우클릭으로 순서·뒤집기");
      const img = document.createElement("img");
      img.src = assetUrl(s.asset);
      img.alt = "";
      img.draggable = false;
      const handle = document.createElement("span");
      handle.className = "diary-sticker-handle";
      handle.title = "크기 바꾸기";
      const rotor = document.createElement("span");
      rotor.className = "diary-sticker-rotate";
      rotor.title = "돌리기 (Shift: 15°씩)";
      const remove = diaryButton("", "사진 떼기", "diary-sticker-remove", "close");
      remove.addEventListener("pointerdown", e => e.stopPropagation());
      remove.addEventListener("click", (e) => { e.stopPropagation(); removeSticker(s.id); });
      const more = diaryButton("", "순서·돌리기·뒤집기", "diary-sticker-more", "more");
      more.addEventListener("pointerdown", e => e.stopPropagation());
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = more.getBoundingClientRect();
        openStickerMenu(s.id, r.left, r.bottom + 4);
      });
      node.append(img, handle, rotor, remove, more);
      node.addEventListener("pointerdown", (e) => startStickerDrag(e, s, node, e.target === handle ? "resize" : e.target === rotor ? "rotate" : "move"));
      node.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selection.includes(s.id)) selectSticker(s.id);          // 고른 무리 안이면 무리 전체에 대한 메뉴
        openStickerMenu(s.id, e.clientX, e.clientY);
      });
      translateUi(node);
      node.addEventListener("focus", () => { if (!selection.includes(s.id)) selectSticker(s.id); });
      return node;
    }));
    syncSelection();
    positionStickers();
    const refocus = focusedId && stickerLayer.querySelector(`[data-id="${focusedId}"]`);
    if (refocus) refocus.focus({ preventScroll:true });
  }
  function syncSelection(){
    for (const node of stickerLayer.children) node.classList.toggle("is-selected", selection.includes(node.dataset.id));
    stickerLayer.classList.toggle("is-multi", selection.length > 1);
  }
  function setSelection(ids){
    const before = selection.join("|");
    selection = [...new Set(ids.filter(Boolean))];
    if (selection.join("|") === before) return;
    syncSelection();
    if (selection.length > 1) setStatus(diaryTf("사진 {n}장을 골랐어요 — 함께 옮기고 돌리고 뗄 수 있어요", { n:selection.length }));
  }
  function selectSticker(id){ setSelection(id ? [id] : []); }
  function toggleSticker(id){
    setSelection(selection.includes(id) ? selection.filter(x => x !== id) : [...selection, id]);
  }
  const selectedStickers = () => {
    const entry = entryOf(current);
    return entry ? entry.stickers.filter(s => selection.includes(s.id)) : [];
  };
  const clampStickerPos = (s) => {
    s.x = Math.max(-s.w * 0.6, Math.min(1 - s.w * 0.4, s.x));
    s.y = Math.max(-0.02, s.y);
  };
  function startStickerDrag(e, sticker, node, mode){
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (mode === "move" && (e.shiftKey || e.ctrlKey || e.metaKey)){
      toggleSticker(sticker.id);
      if (selection.includes(sticker.id)) node.focus({ preventScroll:true });
      return;
    }
    const group = mode === "move" && selection.length > 1 && selection.includes(sticker.id);
    if (!group) selectSticker(sticker.id);
    node.focus({ preventScroll:true });
    const w = paperWidth || paper.clientWidth || 1;
    const start = { x:e.clientX, y:e.clientY, sx:sticker.x, sy:sticker.y, sw:sticker.w, rot:sticker.rot || 0 };
    const groupStart = group ? selectedStickers().map(s => ({ s, x:s.x, y:s.y })) : null;
    const rect = node.getBoundingClientRect();
    const center = { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
    const startAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    let moved = false;
    try { node.setPointerCapture(e.pointerId); } catch(_){}
    node.classList.add("is-dragging");
    const onMove = (ev) => {
      const dx = (ev.clientX - start.x) / w, dy = (ev.clientY - start.y) / w;
      if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 3) return;
      if (!moved && history) history.flush();
      moved = true;
      if (mode === "rotate"){
        const now = Math.atan2(ev.clientY - center.y, ev.clientX - center.x);
        let deg = start.rot + (now - startAngle) * 180 / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        sticker.rot = diaryNormalizeAngle(deg);
      } else if (mode === "resize"){
        // 돌린 스티커는 끈 거리를 스티커 자기 가로 방향으로 옮겨 잰다(손잡이가 따라오게).
        const rad = (start.rot || 0) * Math.PI / 180;
        const along = dx * Math.cos(rad) + dy * Math.sin(rad);
        sticker.w = Math.max(0.04, Math.min(1.5, start.sw + along));
      } else if (groupStart){
        for (const g of groupStart){ g.s.x = g.x + dx; g.s.y = g.y + dy; clampStickerPos(g.s); }
      } else {
        sticker.x = Math.max(-sticker.w * 0.6, Math.min(1 - sticker.w * 0.4, start.sx + dx));
        sticker.y = Math.max(-0.02, start.sy + dy);
      }
      positionStickers();
    };
    const onUp = () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      node.classList.remove("is-dragging");
      if (moved){ layout(); touch(true); }
      else if (groupStart) selectSticker(sticker.id);       // 무리 안 하나를 끌지 않고 누르기만 하면 그 한 장만 고른다
    };
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
  }
  function nudgeStickers(dx, dy){
    const list = selectedStickers();
    if (!list.length) return;
    for (const s of list){ s.x += dx; s.y += dy; clampStickerPos(s); }
    positionStickers();
    layout();
    touch();
  }
  function stickerOf(id){
    const entry = entryOf(current);
    return entry ? entry.stickers.find(item => item.id === id) || null : null;
  }
  // where: front(맨 앞)·forward(한 칸 앞)·backward(한 칸 뒤)·back(맨 뒤). 배열 순서가 곧 쌓는 순서다.
  // 여러 장이면 고른 것끼리의 앞뒤 순서는 지키며 함께 옮긴다(diaryReorder).
  function reorderStickers(where){
    const entry = entryOf(current);
    if (!entry || !selection.length) return;
    const next = diaryReorder(entry.stickers, new Set(selection), where);
    if (next.every((s, i) => s === entry.stickers[i])) return;
    if (history) history.flush();
    entry.stickers = next;
    renderStickers();
    touch(true);
  }
  function rotateStickers(delta, absolute){
    const list = selectedStickers();
    if (!list.length) return;
    if (history) history.flush();
    for (const s of list) s.rot = diaryNormalizeAngle(absolute ? delta : (s.rot || 0) + delta);
    positionStickers(); layout(); touch(true);
  }
  // 하나라도 안 뒤집혔으면 모두 뒤집고, 모두 뒤집혀 있으면 모두 되돌린다.
  function flipStickers(){
    const list = selectedStickers();
    if (!list.length) return;
    if (history) history.flush();
    const to = !list.every(s => s.flip);
    for (const s of list) s.flip = to;
    positionStickers(); touch(true);
  }
  // 그림 칸에 꼭 맞추기 — 칸 안에 다 들어오는 가장 큰 크기로, 칸 한가운데에. 돌리기는 되돌린다.
  function fitStickerToBox(s, box = pictureBoxRect(), w = paperWidth || paper.clientWidth){
    if (!box || !w) return false;
    const pad = 6;
    let sw = (box.width - pad * 2) / w;
    if (sw * s.ar * w > box.height - pad * 2) sw = (box.height - pad * 2) / (s.ar * w);
    s.w = Math.max(0.04, sw);
    s.x = (box.left + box.width / 2) / w - s.w / 2;
    s.y = (box.top + box.height / 2) / w - (s.w * s.ar) / 2;
    s.rot = 0;
    return true;
  }
  function openStickerMenu(id, x, y){
    const s = stickerOf(id);
    if (!s || typeof MNContextMenu === "undefined") return;
    const entry = entryOf(current);
    const list = selectedStickers();
    const many = list.length > 1;
    // 이미 맨 앞/맨 뒤인지 — 여러 장이면 고른 것이 모두 그 끝에 붙어 있을 때
    const n = entry.stickers.length, k = list.length;
    const atFront = entry.stickers.slice(n - k).every(x => selection.includes(x.id));
    const atBack = entry.stickers.slice(0, k).every(x => selection.includes(x.id));
    MNContextMenu.open(x, y, [
      { label:diaryT("맨 앞으로"), title:"Ctrl+Shift+]", disabled:atFront, action:() => reorderStickers("front") },
      { label:diaryT("한 칸 앞으로"), title:"Ctrl+]", disabled:atFront, action:() => reorderStickers("forward") },
      { label:diaryT("한 칸 뒤로"), title:"Ctrl+[", disabled:atBack, action:() => reorderStickers("backward") },
      { label:diaryT("맨 뒤로"), title:"Ctrl+Shift+[", disabled:atBack, action:() => reorderStickers("back") },
      { separator:true },
      { label:diaryT("왼쪽으로 15° 돌리기"), icon:"rotateLeft", title:"[ (Shift: 15°)", action:() => rotateStickers(-15) },
      { label:diaryT("오른쪽으로 15° 돌리기"), icon:"rotateRight", title:"] (Shift: 15°)", action:() => rotateStickers(15) },
      { label:diaryT("돌리기 되돌리기"), disabled:!list.some(x => x.rot), action:() => rotateStickers(0, true) },
      { label:diaryT("좌우 뒤집기"), icon:"flipH", active:list.every(x => x.flip), action:() => flipStickers() },
      (pictureBox.hidden || many) ? null : { label:diaryT("그림 칸에 꼭 맞추기"), icon:"fit", action:() => {
        if (history) history.flush();
        if (fitStickerToBox(s)){ positionStickers(); layout(); touch(true); }
      } },
      { separator:true },
      many ? { label:diaryT("모두 고르기"), title:"Ctrl+A", disabled:k === n, action:() => setSelection(entry.stickers.map(x => x.id)) } : null,
      { label:many ? diaryTf("사진 {n}장 떼기", { n:k }) : diaryT("사진 떼기"), icon:"delete", action:() => removeStickers(selection) }
    ], { onClose:() => { const node = stickerLayer.querySelector(`[data-id="${id}"]`); if (node) node.focus({ preventScroll:true }); } });
  }
  function removeSticker(id){ removeStickers([id]); }
  function removeStickers(ids){
    const entry = entryOf(current);
    if (!entry) return;
    const drop = new Set(ids);
    const keep = entry.stickers.filter(s => !drop.has(s.id));
    const count = entry.stickers.length - keep.length;
    if (!count) return;
    if (history) history.flush();
    entry.stickers = keep;
    selection = [];
    renderStickers();
    layout();
    renderCalendar();
    touch(true);
    setStatus(count > 1 ? diaryTf("사진 {n}장을 뗐어요. Ctrl+Z 로 되돌릴 수 있어요.", { n:count }) : diaryT("사진을 뗐어요. Ctrl+Z 로 되돌릴 수 있어요."));
  }
  /* Ctrl(⌘)+끌기 = 네모를 그려 한꺼번에 고르기. 종이 대부분이 글칸이라 그냥 끌기·Shift+끌기는 글 고르기로 남겨 둔다.
     네모에 조금이라도 걸친 스티커를 고른다(돌린 스티커는 돌리기 전 상자로 잰다). Shift 를 함께 누르면 지금 고른 것에 더한다. */
  const marquee = document.createElement("div");
  marquee.className = "diary-marquee";
  marquee.hidden = true;
  paper.append(marquee);
  paper.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || drawMode) return;
    if (e.target.closest(".diary-sticker, .diary-draw-bar, .diary-draw-toggle, .diary-picture-hint button")) return;
    const entry = entryOf(current);
    if (!entry || !entry.stickers.length) return;
    e.preventDefault();
    e.stopPropagation();
    const base = e.shiftKey ? [...selection] : [];
    const rect = paper.getBoundingClientRect();
    const x0 = e.clientX - rect.left, y0 = e.clientY - rect.top;
    const w = paperWidth || paper.clientWidth || 1;
    try { paper.setPointerCapture(e.pointerId); } catch(_){}
    const move = (ev) => {
      const x1 = ev.clientX - rect.left, y1 = ev.clientY - rect.top;
      const box = { left:Math.min(x0, x1), top:Math.min(y0, y1), right:Math.max(x0, x1), bottom:Math.max(y0, y1) };
      Object.assign(marquee.style, { left:box.left + "px", top:box.top + "px", width:(box.right - box.left) + "px", height:(box.bottom - box.top) + "px" });
      marquee.hidden = false;
      const hit = entry.stickers.filter(s => {
        const l = s.x * w, t = s.y * w, r = l + s.w * w, b = t + s.w * s.ar * w;
        return l < box.right && r > box.left && t < box.bottom && b > box.top;
      }).map(s => s.id);
      setSelection([...base, ...hit]);
    };
    const up = () => {
      paper.removeEventListener("pointermove", move);
      paper.removeEventListener("pointerup", up);
      paper.removeEventListener("pointercancel", up);
      marquee.hidden = true;
      const first = selection[0] && stickerLayer.querySelector(`[data-id="${selection[0]}"]`);
      if (first) first.focus({ preventScroll:true });            // 곧바로 방향키·Delete 가 먹게
    };
    paper.addEventListener("pointermove", move);
    paper.addEventListener("pointerup", up);
    paper.addEventListener("pointercancel", up);
  }, true);
  async function addAsset(blob, maxDim){
    const prepared = await diaryPrepareImage(blob, maxDim);
    if (!prepared) return null;
    const ext = prepared.mime === "image/jpeg" ? "jpg" : prepared.mime.split("/")[1];
    const name = "assets/" + await diaryHashBytes(prepared.bytes) + "." + ext;
    if (!assets.has(name)) assets.set(name, { bytes:prepared.bytes });
    return { name, w:prepared.w, h:prepared.h };
  }
  // at: 종이 안 픽셀 좌표(없으면 지금 보이는 종이 한가운데) · fit: 그림 칸에 꼭 맞추기(첫 장만)
  async function addStickers(files, at, fit){
    const blobs = [...(files || [])].filter(f => f && /^image\//i.test(f.type || ""));
    if (!blobs.length) return;
    const targetDate = current;
    const targetBox = fit ? pictureBoxRect() : null;
    setStatus(diaryT("사진을 붙이는 중…"));
    const w = paperWidth || paper.clientWidth || 600;
    let origin = at;
    if (!origin){
      const rect = paper.getBoundingClientRect(), view = main.getBoundingClientRect();
      const visibleTop = Math.max(0, view.top - rect.top);
      origin = { x:w * 0.5, y:visibleTop + Math.min(view.height, rect.height) * 0.35 };
    }
    // 사진을 모두 준비한 뒤 현재 모델에 한 번에 넣는다. 날짜 이동·되돌리기로 교체된 entry 를 붙잡지 않는다.
    const prepared = [];
    let added = 0, skipped = 0;
    for (const blob of blobs){
      if (prepared.length >= DIARY_MAX_STICKERS){ skipped++; continue; }
      const asset = await addAsset(blob, DIARY_STICKER_MAX_DIM);
      if (!asset){ skipped++; continue; }
      prepared.push(asset);
    }
    if (prepared.length && history) history.flush();
    for (const asset of prepared){
      const entry = ensureEntry(targetDate);
      if (entry.stickers.length >= DIARY_MAX_STICKERS){ skipped++; continue; }
      const width = Math.min(0.45, Math.max(0.12, (asset.w / w) * 0.6));
      const ar = asset.h / asset.w;
      const sticker = {
        id:diaryStickerId(), asset:asset.name, w:width, ar,
        x:Math.max(0, Math.min(1 - width, origin.x / w - width / 2 + added * 0.03)),
        y:Math.max(0, origin.y / w - (width * ar) / 2 + added * 0.03)
      };
      if (fit && !added) fitStickerToBox(sticker, targetBox, w);
      entry.stickers.push(sticker);
      if (current === targetDate) selection = [sticker.id];
      added++;
    }
    if (added){
      if (current === targetDate){
        renderStickers();
        layout();
        deleteBtn.disabled = false;
      }
      renderCalendar();
      touch(true);
    }
    if (skipped) setStatus((added ? diaryTf("사진 {n}장을 붙였어요.", { n:added }) + " " : "") + diaryTf("{n}장은 붙이지 못했어요(그림 파일이 아니거나 너무 크거나 한 날 {max}장을 넘었어요).", { n:skipped, max:DIARY_MAX_STICKERS }));
    else refreshDirty();
  }

  /* ----- 꾸미기 바꾸기 ----- */
  function changeStyle(patch, immediate){
    if (history && immediate) history.flush();
    const entry = entryOf(current);
    if (entry && entry.style) entry.style = diaryNormalizeStyle({ ...entry.style, ...patch }, name => assets.has(name));
    else model.style = diaryNormalizeStyle({ ...model.style, ...patch }, name => assets.has(name));
    applyStyle();
    layout();
    touch(immediate);
  }
  scopeBox.addEventListener("change", () => {
    if (history) history.flush();
    if (scopeBox.checked){
      const entry = ensureEntry(current);
      entry.style = { ...model.style };
    } else {
      const entry = entryOf(current);
      if (entry) entry.style = null;
    }
    applyStyle(); layout(); renderCalendar(); touch(true);
  });
  bgPick.addEventListener("click", () => bgInput.click());
  bgInput.addEventListener("change", async () => {
    const file = bgInput.files && bgInput.files[0];
    bgInput.value = "";
    if (!file) return;
    setStatus(diaryT("배경 그림을 넣는 중…"));
    const asset = await addAsset(file, DIARY_BG_MAX_DIM);
    if (!asset){ setStatus(diaryT("그림을 읽지 못했어요.")); return; }
    changeStyle({ bg:asset.name }, true);
  });
  bgClear.addEventListener("click", () => changeStyle({ bg:"" }, true));
  fitSelect.addEventListener("change", () => changeStyle({ fit:fitSelect.value }, true));
  veilRange.addEventListener("input", () => changeStyle({ veil:Number(veilRange.value) / 100 }, false));

  const setPanelOpen = (open) => {
    panel.hidden = !open;
    styleBtn.setAttribute("aria-expanded", String(open));
    styleBtn.classList.toggle("is-on", open);
    if (open){
      syncPanel();
      // 글꼴 칩 견본도 손글씨로 보이도록 창을 열 때 미리 읽는다(처음 한 번만 무겁다).
      for (const id of Object.keys(DIARY_HAND_FONTS)) diaryEnsureFont(id);
    }
  };
  styleBtn.addEventListener("click", (e) => { e.stopPropagation(); setPanelOpen(panel.hidden); });
  const onOutside = (e) => {
    if (!pickPop.hidden && !pickPop.contains(e.target) && !weatherBtn.contains(e.target) && !moodBtn.contains(e.target)) closePicker();
    if (panel.hidden) return;
    if (panel.contains(e.target) || styleBtn.contains(e.target)) return;
    setPanelOpen(false);
  };
  document.addEventListener("pointerdown", onOutside, true);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape"){ e.preventDefault(); setPanelOpen(false); styleBtn.focus(); } });

  /* ----- 날짜 이동 ----- */
  function renderPage(){
    const entry = entryOf(current);
    dateLabel.textContent = diaryUiHeadDate(current);
    dateLabel.title = diaryUiDateLabel(current);
    dateLabel.setAttribute("aria-label", diaryUiDateLabel(current) + (current === today ? " · " + diaryT("오늘") : ""));
    dateLabel.classList.toggle("is-today", current === today);
    todayBadge.hidden = current !== today;
    todayBadge.querySelector(".diary-today-text").textContent = diaryT("오늘");
    entryTitle.value = entry ? entry.title : "";
    if (area.value !== (entry ? entry.text : "")) area.value = entry ? entry.text : "";
    area.placeholder = diaryT(current === today ? "오늘은 어떤 하루였나요?" : "이 날의 일기를 적어 보세요.");
    deleteBtn.disabled = diaryEntryIsEmpty(entry);
    syncPickers();
    applyStyle();
    renderStickers();
    layout();
    redrawDrawing();
    if (drawMode) syncDrawBar();
  }
  function syncPickers(){
    const entry = entryOf(current);
    const weather = diaryWeatherInfo(entry && entry.weather), mood = diaryMoodInfo(entry && entry.mood);
    const paint = (btn, info, word) => {
      btn.replaceChildren();
      const em = document.createElement("span"); em.className = "diary-pick-emoji"; diaryMarkFill(em, info);
      const label = document.createElement("span"); label.className = "diary-pick-label"; label.textContent = info ? diaryName(info) : diaryT(word);
      if (info) btn.append(em);
      btn.append(label);
      btn.classList.toggle("is-set", !!info);
      const name = info ? diaryT(word) + ": " + diaryName(info) : diaryT(word + " 고르기");
      btn.title = name; btn.setAttribute("aria-label", name);
    };
    paint(weatherBtn, weather, "날씨");
    paint(moodBtn, mood, "기분");
  }
  function setEntryField(field, value){
    if (history) history.flush();
    const entry = ensureEntry(current);
    if ((entry[field] || "") === value) return;
    entry[field] = value;
    deleteBtn.disabled = diaryEntryIsEmpty(entry);
    syncPickers();
    renderCalendar();
    touch(true);
  }
  function closePicker(){
    if (pickPop.hidden) return;
    pickPop.hidden = true;
    weatherBtn.setAttribute("aria-expanded", "false");
    moodBtn.setAttribute("aria-expanded", "false");
  }
  function openPicker(kind, anchor){
    const options = kind === "weather" ? DIARY_WEATHERS : DIARY_MOODS;
    const entry = entryOf(current);
    const now = entry ? entry[kind] : "";
    pickPop.setAttribute("aria-label", diaryT(kind === "weather" ? "날씨 고르기" : "기분 고르기"));
    pickPop.dataset.kind = kind;
    const buttons = options.map((info) => {
      const id = info[0];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "diary-pick-option" + (id === now ? " is-on" : "");
      b.dataset.value = id;
      b.setAttribute("aria-pressed", String(id === now));
      const em = document.createElement("span"); em.className = "diary-pick-emoji"; diaryMarkFill(em, info);
      b.title = diaryName(info); b.setAttribute("aria-label", diaryName(info));   // 그림만 — 이름은 마우스를 올리면 보인다
      b.append(em);
      b.addEventListener("click", () => { setEntryField(kind, id === now ? "" : id); closePicker(); anchor.focus(); });
      return b;
    });
    const clear = diaryButton("", diaryT("지우기"), "diary-btn diary-pick-clear", "delete");
    clear.disabled = !now;
    clear.addEventListener("click", () => { setEntryField(kind, ""); closePicker(); anchor.focus(); });
    pickPop.replaceChildren(...buttons, clear);
    pickPop.hidden = false;
    weatherBtn.setAttribute("aria-expanded", String(kind === "weather"));
    moodBtn.setAttribute("aria-expanded", String(kind === "mood"));
    const r = anchor.getBoundingClientRect(), base = root.getBoundingClientRect();
    const left = Math.max(8, Math.min(base.width - pickPop.offsetWidth - 8, r.left - base.left));
    pickPop.style.left = left + "px";
    pickPop.style.top = (r.bottom - base.top + 6) + "px";
    const first = pickPop.querySelector(".is-on") || pickPop.querySelector("button");
    if (first) first.focus({ preventScroll:true });
  }
  for (const btn of [weatherBtn, moodBtn]){
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!pickPop.hidden && pickPop.dataset.kind === btn.dataset.pick){ closePicker(); return; }
      openPicker(btn.dataset.pick, btn);
    });
  }
  pickPop.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){
      e.preventDefault();
      const anchor = pickPop.dataset.kind === "weather" ? weatherBtn : moodBtn;
      closePicker();
      anchor.focus();
    }
  });
  function goTo(key){
    if (!diaryIsDateKey(key)) return;
    if (history) history.flush();
    closePicker();
    setDrawMode(false);
    // 비어 버린 날은 모델에서도 치운다(저장엔 원래 안 들어가지만 되돌리기 단계가 헛돌지 않게).
    model.entries = model.entries.filter(e => e.date === key || !diaryEntryIsEmpty(e));
    current = key;
    selection = [];
    const d = diaryDateFromKey(key);
    viewYear = d.getFullYear(); viewMonth = d.getMonth();
    renderCalendar();
    renderPage();
    main.scrollTop = 0;
  }
  prevMonth.addEventListener("click", () => { viewMonth--; if (viewMonth < 0){ viewMonth = 11; viewYear--; } renderCalendar(); });
  nextMonth.addEventListener("click", () => { viewMonth++; if (viewMonth > 11){ viewMonth = 0; viewYear++; } renderCalendar(); });
  todayBtn.addEventListener("click", () => goTo(today));
  prevDay.addEventListener("click", () => goTo(diaryAddDays(current, -1)));
  nextDay.addEventListener("click", () => goTo(diaryAddDays(current, 1)));

  /* ----- 입력 ----- */
  titleInput.addEventListener("input", () => { model.title = titleInput.value; touch(); });
  entryTitle.addEventListener("input", () => {
    const entry = ensureEntry(current);
    const wasEmpty = diaryEntryIsEmpty(entry);
    entry.title = entryTitle.value;
    deleteBtn.disabled = diaryEntryIsEmpty(entry);
    refreshCurrentLabel(wasEmpty);
    touch();
  });
  // 타자마다 달력 전체를 다시 그리지 않는다 — 점이 생기고 없어질 때만 다시 그리고, 그 밖엔 목록의 글귀 한 줄만 고친다.
  const refreshCurrentLabel = (wasEmpty) => {
    const entry = entryOf(current);
    const label = monthList.querySelector(`.diary-month-item[data-date="${current}"] .diary-month-item-label`);
    if (wasEmpty !== diaryEntryIsEmpty(entry) || !label) renderCalendar();
    else label.textContent = diaryEntryLabel(entry);
  };
  area.addEventListener("input", () => {
    const entry = ensureEntry(current);
    const wasEmpty = diaryEntryIsEmpty(entry);
    entry.text = area.value;
    layout();
    deleteBtn.disabled = diaryEntryIsEmpty(entry);
    refreshCurrentLabel(wasEmpty);
    touch();
  });
  area.addEventListener("pointerdown", () => selectSticker(""));
  area.addEventListener("paste", async (event) => {
    const imgs = [...((event.clipboardData && event.clipboardData.items) || [])]
      .filter(it => it.kind === "file" && /^image\//i.test(it.type || ""))
      .map(it => it.getAsFile()).filter(Boolean);
    if (!imgs.length) return;
    event.preventDefault();
    await addStickers(imgs);
  });
  if (typeof attachTextCaseContextMenu === "function") attachTextCaseContextMenu(area);
  paper.addEventListener("pointerdown", (e) => { if (!e.target.closest(".diary-sticker")) selectSticker(""); });
  genkoLayer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !genkoLay) return;
    e.preventDefault();
    const idx = genkoIndexFromPoint(e);
    const wasFocused = document.activeElement === area;
    const anchor = e.shiftKey && wasFocused ? (area.selectionDirection === "backward" ? area.selectionEnd : area.selectionStart) : idx;
    area.focus({ preventScroll:true });
    setGenkoSelection(anchor, idx);
    refreshGenkoSelection(true);
    const move = (ev) => { if (genkoLay){ setGenkoSelection(anchor, genkoIndexFromPoint(ev)); refreshGenkoSelection(); } };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  // 원고지는 줄이 칸으로 정해져 textarea 의 위·아래·처음·끝 이동이 맞지 않는다 — 칸 기준으로 직접 옮긴다.
  area.addEventListener("keydown", (e) => {
    if (!genkoLay || e.isComposing || e.altKey) return;
    const key = e.key;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
    if ((key === "Home" || key === "End") && (e.ctrlKey || e.metaKey)) return;   // 글 처음·끝은 textarea 그대로
    e.preventDefault();
    const back = area.selectionDirection === "backward";
    const head = back ? area.selectionStart : area.selectionEnd;
    const anchor = back ? area.selectionEnd : area.selectionStart;
    const p = genkoLay.pos[head] || { row:0, col:0 };
    const lastRow = genkoLay.pos[genkoLay.pos.length - 1].row;
    let idx;
    if (key === "ArrowUp") idx = p.row === 0 ? 0 : diaryGenkoIndexAt(genkoLay, p.row - 1, p.col);
    else if (key === "ArrowDown") idx = p.row >= lastRow ? area.value.length : diaryGenkoIndexAt(genkoLay, p.row + 1, p.col);
    else if (key === "Home") idx = diaryGenkoIndexAt(genkoLay, p.row, 0);
    else idx = diaryGenkoIndexAt(genkoLay, p.row, genkoGm.cols + 1);
    if (e.shiftKey) setGenkoSelection(anchor, idx); else area.setSelectionRange(idx, idx);
    refreshGenkoSelection();
  });
  const onSelectionChange = () => { if (genkoLay && document.activeElement === area) refreshGenkoSelection(); };
  document.addEventListener("selectionchange", onSelectionChange);
  area.addEventListener("keyup", () => { if (genkoLay) refreshGenkoSelection(); });
  area.addEventListener("focus", () => { if (genkoLay) refreshGenkoSelection(true); });
  area.addEventListener("blur", () => { if (genkoLay) refreshGenkoSelection(true); });
  // 사진을 종이 위에 떨어뜨리면 그 자리에 붙인다. 그림이 아닌 파일은 흘려보내 평소처럼 새 탭으로 열린다.
  const hasImageFiles = (dt) => !!dt && [...(dt.items || [])].some(it => it.kind === "file" && /^image\//i.test(it.type || ""));
  paper.addEventListener("dragover", (e) => {
    if (!hasImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    paper.classList.add("is-drop");
  });
  paper.addEventListener("dragleave", (e) => { if (!paper.contains(e.relatedTarget)) paper.classList.remove("is-drop"); });
  paper.addEventListener("drop", async (e) => {
    paper.classList.remove("is-drop");
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    const images = files.filter(f => /^image\//i.test(f.type || ""));
    if (!images.length) return;
    e.preventDefault();
    if (images.length === files.length) e.stopPropagation();
    const rect = paper.getBoundingClientRect();
    const at = { x:e.clientX - rect.left, y:e.clientY - rect.top };
    const box = pictureBox.hidden ? null : pictureBoxRect();
    const inBox = !!(box && at.x >= box.left && at.x <= box.left + box.width && at.y >= box.top && at.y <= box.top + box.height);
    await addStickers(images, at, inBox);
  });
  photoBtn.addEventListener("click", () => photoInput.click());
  pictureBtn.addEventListener("click", (e) => { e.stopPropagation(); pictureInput.click(); });
  pictureInput.addEventListener("change", async () => { const files = [...(pictureInput.files || [])]; pictureInput.value = ""; await addStickers(files, null, true); });
  photoInput.addEventListener("change", async () => { const files = [...(photoInput.files || [])]; photoInput.value = ""; await addStickers(files); });

  /* ----- 파일 암호 ----- */
  const syncProtectionButton = () => {
    const protectedFile = !!doc.diaryProtection;
    protectBtn.classList.toggle("is-on", protectedFile);
    protectBtn.setAttribute("aria-pressed", String(protectedFile));
    protectBtn.title = diaryT(protectedFile ? "암호로 보호됨 — 암호 변경·제거" : "파일 암호 설정·변경");
  };
  const saveProtectionChange = async (nextProtection, successMessage, busyMessage) => {
    if (doc._diarySaving){
      if (typeof toast === "function") toast(diaryT("저장이 끝난 뒤 다시 시도해 주세요."), 2400);
      return false;
    }
    const oldProtection = doc.diaryProtection || null;
    const oldRevision = Number(doc.diarySecurityRevision) || 0;
    clearTimeout(recoveryTimer); recoveryTimer = 0;          // 대기 중인 복구본이 임시 암호 상태로 저장되지 않게
    doc.diaryProtection = nextProtection;
    doc.diarySecurityRevision = oldRevision + 1;
    syncProtectionButton(); refreshDirty();
    setStatus(diaryT(busyMessage));
    let ok = false;
    try { ok = await saveDiary(doc); }
    catch(error){ console.warn("diary protection save failed:", error); }
    if (!ok){
      doc.diaryProtection = oldProtection;
      doc.diarySecurityRevision = oldRevision;
      syncProtectionButton(); refreshDirty(); scheduleRecovery();
      return false;
    }
    refreshDirty();
    if (typeof toast === "function") toast(diaryT(successMessage), 3200, { type:"success" });
    return true;
  };
  const setDiaryPassword = async (changing) => {
    if (!diaryRequireCrypto() || typeof examAskPassword !== "function") return;
    let password = await examAskPassword({
      title:changing ? "일기장 암호 변경" : "일기장 암호 설정",
      message:"이 암호는 앱이나 파일에 저장하지 않습니다. 잊으면 일기와 사진을 복구할 수 없으니 기억할 수 있는 긴 암호를 사용하세요.",
      confirm:true, okText:changing ? "암호 변경" : "암호 설정"
    });
    if (password === null) return;
    if (typeof showLoading === "function") showLoading(diaryT("암호화 키를 만드는 중…"));
    let protection = null;
    try { protection = await diaryDeriveProtection(password); }
    catch(error){
      console.warn("diary key derivation failed:", error);
      if (typeof toast === "function") toast(diaryT("일기장 암호화에 실패했어요."), 3600, { type:"error" });
    } finally {
      password = "";
      if (typeof hideLoading === "function") hideLoading();
    }
    if (!protection) return;
    await saveProtectionChange(protection,
      changing ? "새 암호로 일기장을 보호했어요." : "일기장을 암호로 보호했어요.",
      "암호화하여 저장하는 중…");
  };
  const removeDiaryPassword = async () => {
    if (!doc.diaryProtection) return;
    const ok = typeof confirmDialog === "function" ? await confirmDialog(
      "파일 암호를 제거할까요? 저장된 일기와 사진을 암호 없이 열 수 있게 됩니다.", "암호 제거", "취소") : false;
    if (!ok) return;
    await saveProtectionChange(null, "일기장 암호를 제거했어요.", "암호를 제거하여 저장하는 중…");
  };
  const openProtectionMenu = () => {
    if (typeof MNContextMenu === "undefined") return;
    const r = protectBtn.getBoundingClientRect();
    const items = doc.diaryProtection
      ? [
          { label:diaryT("암호 변경"), action:() => setDiaryPassword(true) },
          { label:diaryT("암호 제거"), danger:true, action:removeDiaryPassword }
        ]
      : [{ label:diaryT("암호 설정"), action:() => setDiaryPassword(false) }];
    MNContextMenu.open(r.left, r.bottom + 4, items, { autoFocus:true });
  };
  protectBtn.addEventListener("click", (e) => { e.stopPropagation(); openProtectionMenu(); });
  syncProtectionButton();

  deleteBtn.addEventListener("click", () => {
    const idx = model.entries.findIndex(e => e.date === current);
    if (idx < 0) return;
    if (history) history.flush();
    model.entries.splice(idx, 1);
    renderCalendar(); renderPage(); touch(true);
    setStatus(diaryTf("{date} 일기를 지웠어요. Ctrl+Z 로 되돌릴 수 있어요.", { date:diaryUiDateLabel(current) }));
  });
  saveBtn.addEventListener("click", async () => {
    if (history) history.flush();
    const ok = await saveDiary(doc);
    if (ok){
      refreshDirty();
      scheduleRecovery();
      // 저장을 기다리는 동안 쓴 글도 별도의 되돌리기 단계로 남긴다.
      if (history) history.flush();
    }
  });

  /* ----- 되돌리기 ----- */
  const snapshot = () => JSON.stringify({ title:model.title, style:model.style, entries:model.entries });
  history = MNEditHistory.create({
    limit:80,
    sizeOf:(s) => s.length,
    maxBytes:24 * 1024 * 1024,
    capture:snapshot,
    isEqual:(a, b) => a === b,
    apply:(state) => {
      let parsed; try { parsed = JSON.parse(state); } catch(_){ return; }
      model.title = parsed.title;
      model.style = parsed.style;
      model.entries = parsed.entries;
      titleInput.value = model.title || "";
      renderCalendar();
      renderPage();
      refreshDirty();
      scheduleRecovery();
    },
    onChange:updateHistoryButtons
  });
  undoBtn.addEventListener("click", () => history.undo());
  redoBtn.addEventListener("click", () => { history.flush(); history.redo(); });

  // 글칸 안의 Ctrl+Z 는 브라우저 기본(타자 단위)에 맡기고, 그 밖에서는 일기장 전체 되돌리기.
  // 스티커를 고른 채 Delete·방향키도 여기서 받는다.
  const onKey = (e) => {
    if (typeof state !== "undefined" && state !== doc) return;
    if (e.defaultPrevented || e.isComposing) return;
    const target = e.target;
    const inField = !!(target && target.closest && target.closest('input,textarea,select,[contenteditable="true"]'));
    if (drawMode && e.key === "Escape" && !inField){ e.preventDefault(); setDrawMode(false); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey){
      // Ctrl+] / Ctrl+[ 한 칸 앞·뒤, Shift 를 더하면 맨 앞·맨 뒤(파워포인트와 같은 자리).
      if (selection.length && !inField && root.contains(target) && (e.code === "BracketRight" || e.code === "BracketLeft")){
        e.preventDefault(); e.stopPropagation();
        const up = e.code === "BracketRight";
        reorderStickers(e.shiftKey ? (up ? "front" : "back") : (up ? "forward" : "backward"));
        return;
      }
      // 스티커를 고른 채 Ctrl+A → 이 날 스티커 모두 고르기(글칸 안의 Ctrl+A 는 글 전체 고르기 그대로)
      if (selection.length && !inField && root.contains(target) && String(e.key || "").toLowerCase() === "a" && !e.shiftKey){
        e.preventDefault(); e.stopPropagation();
        const entry = entryOf(current);
        if (entry) setSelection(entry.stickers.map(s => s.id));
        return;
      }
      const key = String(e.key || "").toLowerCase();
      const undo = key === "z" && !e.shiftKey;
      const redo = key === "y" || (key === "z" && e.shiftKey);
      if ((!undo && !redo) || inField || (!root.contains(target) && target !== document.body)) return;
      e.preventDefault(); e.stopPropagation();
      if (redo){ history.flush(); history.redo(); } else history.undo();
      return;
    }
    if (!selection.length || inField || !root.contains(target)) return;
    if (e.key === "Delete" || e.key === "Backspace"){ e.preventDefault(); removeStickers(selection); return; }
    if (e.code === "BracketLeft" || e.code === "BracketRight"){
      e.preventDefault();
      rotateStickers((e.code === "BracketRight" ? 1 : -1) * (e.shiftKey ? 15 : 5));
      return;
    }
    const step = (e.shiftKey ? 20 : 2) / (paperWidth || 600);
    const moves = { ArrowLeft:[-step, 0], ArrowRight:[step, 0], ArrowUp:[0, -step], ArrowDown:[0, step] };
    if (moves[e.key]){ e.preventDefault(); nudgeStickers(moves[e.key][0], moves[e.key][1]); }
    else if (e.key === "Escape") selectSticker("");
  };
  document.addEventListener("keydown", onKey, true);

  /* ----- 인쇄(PDF 로 저장은 인쇄 창의 대상에서) -----
     화면을 그대로 찍으면 도구막대·달력까지 나오므로 인쇄 전용 층을 따로 만들어 그것만 찍는다(연대표와 같은 방식).
     한 날 = 한 쪽에서 시작하고, 글이 길면 다음 쪽으로 이어진다. 종이 폭은 A4 에 맞춰 680px 로 고정해 다시 배치한다. */
  const DIARY_PRINT_WIDTH = 680;
  function buildPrintPage(e, first, heading){
    const W = DIARY_PRINT_WIDTH;
    const waits = [];
    const page = document.createElement("section");
    page.className = "diary-print-page";
    if (first){
      const top = document.createElement("div");
      top.className = "diary-print-book";
      top.textContent = [model.title || diaryT("일기장"), heading].filter(Boolean).join(" · ");
      page.append(top);
    }
    // header 태그는 쓰지 않는다 — 전역 header{color:#fff} 를 물려받아 흰 종이에 흰 글자로 찍힌다.
    const head = document.createElement("div");
    head.className = "diary-print-head";
    const date = document.createElement("div");
    date.className = "diary-print-date";
    date.textContent = diaryUiDateLabel(e.date);
    const marks = [diaryWeatherInfo(e.weather), diaryMoodInfo(e.mood)].filter(Boolean);
    for (const m of marks){
      const tag = document.createElement("span");
      tag.className = "diary-print-mark";
      diaryMarkFill(tag, m);
      tag.append(" " + diaryName(m));
      date.append(tag);
    }
    head.append(date);
    if (e.title){ const h = document.createElement("h2"); h.textContent = e.title; head.append(h); }
    page.append(head);
    const style = diaryEffectiveStyle(model, e);
    const paperEl = document.createElement("div");
    paperEl.className = "diary-print-paper";
    paperEl.dataset.lines = style.lines;
    paperEl.style.width = W + "px";
    const url = assetUrl(style.bg);
    if (url){
      const bg = document.createElement("div");
      bg.className = "diary-paper-bg";
      bg.dataset.fit = style.fit;
      bg.style.backgroundImage = `url("${url}")`;
      const veil = document.createElement("div");
      veil.className = "diary-paper-veil";
      veil.style.opacity = String(style.veil);
      paperEl.append(bg, veil);
      const pre = new Image(); pre.src = url;
      if (pre.decode) waits.push(pre.decode().catch(() => {}));
    }
    let stickerBottom = 0;
    for (const st of e.stickers) stickerBottom = Math.max(stickerBottom, diaryStickerBottom(st) * W);
    const font = DIARY_FONT_STACKS[style.font] || "";
    if (diaryUsesGenko(style)){
      const gm = diaryGenkoMetrics(style, W);
      const lay = diaryGenkoLayout(e.text, gm.cols);
      const layer = document.createElement("div");
      layer.className = "diary-genko";
      layer.style.fontFamily = font;
      const grid = document.createElement("div");
      grid.className = "diary-genko-grid";
      layer.append(grid);
      const rows = diaryRenderGenko(grid, lay, gm, { minRows:Math.ceil((stickerBottom - gm.padTop) / gm.pitch) + 1 });
      layer.style.height = (gm.padTop + rows * gm.pitch + gm.cell / 2) + "px";
      paperEl.append(layer);
      const pm = diaryLineMetrics(style, W);
      if (pm.box){
        const box = document.createElement("div");
        box.className = "diary-picture-box";
        Object.assign(box.style, { left:pm.box.left + "px", top:pm.box.top + "px", width:(W - pm.box.left - pm.box.right) + "px", height:pm.box.height + "px" });
        paperEl.append(box);
      }
    } else {
      const m = diaryLineMetrics(style, W);
      const bgc = diaryLineBackground(style);
      const text = document.createElement("div");
      text.className = "diary-print-text";
      text.textContent = e.text;
      Object.assign(text.style, {
        backgroundImage:bgc.image, backgroundSize:bgc.size, backgroundPosition:bgc.position, backgroundRepeat:bgc.repeat,
        lineHeight:m.gap + "px", fontSize:m.fontSize + "px", fontFamily:font,
        paddingTop:m.padTop + "px", paddingBottom:m.gap + "px", paddingLeft:m.padLeft + "px", paddingRight:m.padRight + "px",
        minHeight:Math.ceil((stickerBottom + m.gap) / m.gap) * m.gap + "px"
      });
      paperEl.append(text);
    }
    for (const st of e.stickers){
      const node = document.createElement("div");
      node.className = "diary-print-sticker";
      Object.assign(node.style, { left:st.x * W + "px", top:st.y * W + "px", width:st.w * W + "px", height:st.w * st.ar * W + "px",
        transform:st.rot ? `rotate(${st.rot}deg)` : "" });
      const img = document.createElement("img");
      img.src = assetUrl(st.asset);
      img.alt = "";
      if (st.flip) img.style.transform = "scaleX(-1)";
      if (img.decode) waits.push(img.decode().catch(() => {}));
      node.append(img);
      paperEl.append(node);
    }
    const pbox = diaryUsesGenko(style) ? diaryLineMetrics(style, W).box : null;
    if (pbox && e.drawing && e.drawing.length){
      const bw = W - pbox.left - pbox.right;
      const canvas = document.createElement("canvas");
      canvas.width = bw * 2; canvas.height = pbox.height * 2;               // 인쇄는 두 배로 그려 선이 거칠지 않게
      const ctx = canvas.getContext("2d");
      ctx.scale(2, 2);
      diaryDrawStrokes(ctx, e.drawing, bw);
      const img = document.createElement("img");
      img.className = "diary-print-drawing";
      img.alt = "";
      img.src = canvas.toDataURL("image/png");
      Object.assign(img.style, { left:pbox.left + "px", top:pbox.top + "px", width:bw + "px", height:pbox.height + "px" });
      if (img.decode) waits.push(img.decode().catch(() => {}));
      paperEl.append(img);
    }
    page.append(paperEl);
    return { page, waits };
  }
  async function printEntries(list, heading){
    if (!list.length) return false;
    await Promise.all([...new Set(list.map(e => diaryEffectiveStyle(model, e).font))].map(diaryEnsureFont));
    const old = document.getElementById("diaryPrintLayer");
    if (old) old.remove();
    const layer = document.createElement("div");
    layer.id = "diaryPrintLayer";
    layer.className = "diary-print ui-keep-symbols";
    const waits = [];
    list.forEach((e, i) => { const built = buildPrintPage(e, i === 0, heading); layer.append(built.page); waits.push(...built.waits); });
    document.body.appendChild(layer);
    await Promise.all(waits);
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", cleanup);
      document.body.classList.remove("diary-printing");
      layer.remove();
    };
    try {
      window.addEventListener("afterprint", cleanup);
      document.body.classList.add("diary-printing");
      window.print();
    } finally { cleanup(); }
    return true;
  }
  function openPrintMenu(anchor){
    if (typeof MNContextMenu === "undefined") return;
    if (history) history.flush();
    const all = diaryCleanEntries(model);
    const day = all.filter(e => e.date === current);
    const prefix = viewYear + "-" + String(viewMonth + 1).padStart(2, "0") + "-";
    const month = all.filter(e => e.date.startsWith(prefix));
    const monthName = diaryUiMonthLabel(viewYear, viewMonth);
    const tip = diaryT("인쇄 창의 '대상'에서 'PDF로 저장'을 고르면 PDF 파일이 됩니다");
    const r = (anchor && anchor.isConnected ? anchor : saveBtn).getBoundingClientRect();
    MNContextMenu.open(r.left, r.bottom + 4, [
      { label:diaryTf("이 날 인쇄 ({date})", { date:diaryUiShortDate(current) }), title:tip, disabled:!day.length, action:() => printEntries(day) },
      { label:diaryTf("이번 달 인쇄 ({month} · {n}편)", { month:monthName, n:month.length }), title:tip, disabled:!month.length, action:() => printEntries(month, monthName) },
      { label:diaryTf("일기장 전체 인쇄 ({n}편)", { n:all.length }), title:tip, disabled:!all.length, action:() => printEntries(all) }
    ], { autoFocus:true });
  }
  // 도구막대엔 인쇄 단추를 두지 않는다 — 상단 인쇄 단추(app.js)·Ctrl+P 가 이 고르기 메뉴를 연다.
  doc.printDiary = () => openPrintMenu(document.getElementById("btnPrint"));
  doc._diaryPrintEntries = printEntries;           // e2e·명령에서 고르기 없이 부를 때

  // 고정된 단추·안내 글은 translateTree 가 언어 전환까지 맡고, 그때그때 그리는 글자는 다시 그린다.
  function translateUi(node){
    if (typeof MNI18N !== "undefined" && MNI18N && typeof MNI18N.translateTree === "function") MNI18N.translateTree(node);
  }
  const onLangChange = () => { closePicker(); renderCalendar(); renderPage(); syncPanel(); syncProtectionButton(); refreshDirty(); };
  window.addEventListener("mni18nchange", onLangChange);

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (paper.clientWidth && paper.clientWidth !== paperWidth) layout();
  }) : null;
  if (resizeObserver) resizeObserver.observe(paper);

  // 통합 검색 결과를 누르면 그 글귀가 든 날로 간다(가장 최근 일기부터).
  doc._diaryFocus = (query) => {
    const hit = diaryCleanEntries(model).reverse().find(e => diaryEntryMatches(e, query));
    if (!hit) return false;
    goTo(hit.date);
    return true;
  };

  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("selectionchange", onSelectionChange);
    window.removeEventListener("mni18nchange", onLangChange);
    if (doc.printDiary) delete doc.printDiary;
    if (resizeObserver) resizeObserver.disconnect();
    if (history) history.cancel();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery;
    if (doc._diaryQueueSavedSnapshot) delete doc._diaryQueueSavedSnapshot;
    recoveryGeneration++;
  });

  renderCalendar();
  renderPage();
  translateUi(bar); translateUi(pageHead); translateUi(panel); translateUi(pictureBox); translateUi(side);
  history.reset();
  updateHistoryButtons();
  // 첫 마운트는 탭이 아직 안 보일 수 있다 — 보인 다음 프레임에 한 번 더 잰다.
  requestAnimationFrame(() => layout());
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    DIARY_FORMAT, DIARY_VERSION, DIARY_LINES, DIARY_GAPS, DIARY_ENCRYPTED_MAGIC, DIARY_PBKDF2_ITER,
    diaryDateKey, diaryIsDateKey, diaryAddDays, diaryDateLabel, diaryMonthGrid,
    diaryDefaultStyle, diaryNormalizeStyle, diaryNormalizeSticker, diaryNormalizeEntry, diaryEntryIsEmpty,
    diaryEmpty, diaryNormalize, diaryContentKey, diaryModelJson, diaryEffectiveStyle, diaryReferencedAssets,
    DIARY_FONTS, DIARY_HAND_FONTS, DIARY_FONT_STACKS, diaryFontScale, diaryEnsureFont, DIARY_WEATHERS, DIARY_MOODS, diaryNormalizeAngle, diaryWeatherInfo, diaryMoodInfo, diaryWeatherMoodLabel,
    DIARY_PENS, DIARY_PEN_SIZES, diaryNormalizeStroke, diaryDrawStrokes,
    diaryReorder, DIARY_GENKO_COLS, diaryGenkoGrid, diaryPictureBox, diaryUsesGenko, diaryStickerBottom, diaryGenkoMetrics, diaryGenkoLayout, diaryGenkoIndexAt,
    diaryUiDateLabel, diaryUiHeadDate, diaryUiMonthLabel, diaryUiWeekday, diaryT, diaryTf,
    diaryEntryLabel, diaryPlainText, diaryEntryMatches, diaryLineMetrics, diaryLineBackground,
    diaryCrc32, diaryZipBuild, diaryZipRead, diaryPack, diaryUnpack, diaryScratchFileName, diaryStarterBytes,
    diaryCryptoReady, diaryIsEncrypted, diaryEncryptedInfo, diaryDeriveProtection, diarySealBytes, diaryOpenSealed, diaryOutputBytes
  };
}
