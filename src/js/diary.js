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
// · 6: 원고지 한 줄 칸 수(genkoCols) · 7: 태그·즐겨찾기 · 8: 스티커 갈래(kind) — 내장 그림(art)·글상자(text).
// · 9: 종이 배경 효과(paper·paperColor·paperTone)·인쇄할 땐 배경 빼기(printPlain).
// · 10: 내장 그림 스티커·글상자 투명도(opacity) · 11: 내장 그림 스티커 80종으로 확장.
// · 12: 줄 무늬 8종 추가(두 줄·세 줄·점선·목록·세로줄·십자·오선·사선 격자).
// 새 값이 생길 때마다 올린다 — 옛 앱이 모르는 값을 기본값으로 바꾼 채 덮어쓰지 못하게(옛 앱은 새 파일을 거절한다).
const DIARY_VERSION = 12;
const DIARY_JSON_NAME = "diary.json";
const DIARY_LINES = ["ruled", "double", "triple", "dashed", "list", "grid", "columns", "dots", "crosses", "staff", "diagonal", "blank", "picture", "genko"];
const DIARY_LINE_LABELS = { ruled:"줄 공책", double:"두 줄", triple:"세 줄", dashed:"점선", list:"목록", grid:"모눈", columns:"세로줄", dots:"점", crosses:"십자", staff:"오선", diagonal:"사선 격자", blank:"빈 종이", picture:"그림일기", genko:"원고지" };
// 짧은 이름은 앱 공용 사전(i18n.js) 대신 여기 영어를 함께 둔다 — "점"·"비"·"눈" 같은 한두 글자를 사전에 넣으면
// 다른 화면의 같은 글자까지 바뀐다. diaryLabel(한국어 표, 영어 표, 값)으로 고른다.
const DIARY_LINE_LABELS_EN = { ruled:"Lined", double:"Double line", triple:"Triple line", dashed:"Dashed", list:"List", grid:"Grid", columns:"Columns", dots:"Dots", crosses:"Crosses", staff:"Staff", diagonal:"Diagonal grid", blank:"Blank", picture:"Picture diary", genko:"Manuscript" };
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
/* 종이 배경 효과 — 사진과 달리 파일엔 이름 한 줄만 들어간다(내장 스티커와 같은 생각).
   어떤 효과든 "고른 색"과 종이색(--diary-paper)을 섞어 그린다. 그래서 다크 테마에서도 종이를 따라 어두워지고,
   글자(--diary-ink)가 배경에 묻히지 않는다. 고정 색을 박으면 다크에서 배경만 허옇게 뜬다. */
const DIARY_PAPERS = ["none", "solid", "linear", "radial", "conic", "mesh", "pattern", "vignette", "glass", "noise", "aurora"];
const DIARY_PAPER_LABELS = { none:"없음", solid:"단색", linear:"선형", radial:"방사형", conic:"원뿔형", mesh:"메시",
  pattern:"패턴", vignette:"비네트", glass:"유리", noise:"거친 질감", aurora:"오로라" };
const DIARY_PAPER_LABELS_EN = { none:"None", solid:"Solid", linear:"Linear", radial:"Radial", conic:"Conic", mesh:"Mesh",
  pattern:"Pattern", vignette:"Vignette", glass:"Glass", noise:"Grain", aurora:"Aurora" };
// 종이를 어둡게 칠하는 효과 — 글자·줄 색을 밝은 쪽으로 갈아끼워야 한다(CSS 가 종이·인쇄 종이·견본에 함께 건다).
const DIARY_PAPER_DARK = ["aurora"];
const DIARY_PAPER_DEFAULT_COLOR = "#7aa7ff";
const DIARY_MAX_ENTRIES = 5000;
const DIARY_MAX_STICKERS = 80;
const DIARY_ART_DEFAULT_COLOR = "#ef4444";
const DIARY_TEXT_DEFAULT_COLOR = "#1f2937";
const DIARY_HEX_RE = /^#[0-9a-f]{6}$/i;             // 스티커·펜 색은 이 꼴만 받는다(팔레트 밖 색도 여기만 통과하면 된다)
const DIARY_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const DIARY_MAX_IMAGE_BYTES = 40 * 1024 * 1024;     // 넣기 전 원본 한 장(넣을 때 줄여서 담는다)
/* 붙일 때 사진을 줄이는 기준. 스티커는 1600 에서 1200 으로 낮췄다 — 종이 폭(680~900px)에 여러 장을
   나란히 깔면 한 장이 차지하는 너비가 300px 안팎이고, 인쇄·확대해 봐도 1200 이면 남는다. 대신 바이트는
   면적비만큼(1200/1600 의 제곱 = 약 0.56) 줄어든다. 저장할 때마다 ZIP 전체를 한 덩어리로 다시 쓰고
   작업공간 자동 복원 상한이 512MB 라, 하루에 여러 장을 남기는 일기장에서는 이 차이가 곧 한계다.
   배경 그림은 종이 전체를 덮으므로 그대로 2400 을 쓴다(한 날에 한 장뿐이라 장수로 늘지 않는다).
   이미 붙여 둔 사진은 다시 줄이지 않는다 — 넣는 순간에만 적용된다. */
const DIARY_STICKER_MAX_DIM = 1200;
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
const DIARY_MAX_TAGS = 12;
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
// 한두 낱말짜리 이름은 앱 공용 사전(i18n.js)에 넣지 않고 여기서 고른다 — "자동"·"사진" 같은 글자를
// 사전에 넣으면 다른 화면의 같은 글자까지 함께 바뀐다(날씨·기분 이름과 같은 규칙).
function diaryEn(ko, en){ return diaryIsEn() ? en : ko; }
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
function diaryDefaultStyle(){
  return { lines:"ruled", gap:"normal", bg:"", fit:"cover", veil:0.4, font:"gothic", genkoCols:0,
    paper:"none", paperColor:DIARY_PAPER_DEFAULT_COLOR, paperTone:0.5 };
}
function diaryNormalizeStyle(raw, hasAsset){
  const base = diaryDefaultStyle();
  if (!raw || typeof raw !== "object") return base;
  const veil = Number(raw.veil);
  const tone = Number(raw.paperTone);
  const bg = String(raw.bg || "");
  return {
    lines:DIARY_LINES.includes(raw.lines) ? raw.lines : base.lines,
    gap:Object.prototype.hasOwnProperty.call(DIARY_GAPS, raw.gap) ? raw.gap : base.gap,
    bg:DIARY_ASSET_RE.test(bg) && (!hasAsset || hasAsset(bg)) ? bg : "",
    fit:DIARY_FITS.includes(raw.fit) ? raw.fit : base.fit,
    // Number("")=0 이라 빈 값이 '안 덮음'으로 바뀌지 않게 문자열 비어 있음부터 거른다.
    veil:raw.veil === "" || raw.veil == null || !Number.isFinite(veil) ? base.veil : Math.max(0, Math.min(0.9, veil)),
    font:DIARY_FONTS.includes(raw.font) ? raw.font : base.font,
    genkoCols:DIARY_GENKO_COLS.includes(Number(raw.genkoCols)) ? Number(raw.genkoCols) : base.genkoCols,
    // 배경 효과 — 모르는 이름은 "없음"으로 떨어뜨린다(예전 파일·다음 판 파일을 함께 열 수 있게).
    paper:DIARY_PAPERS.includes(raw.paper) ? raw.paper : base.paper,
    paperColor:DIARY_HEX_RE.test(String(raw.paperColor || "")) ? String(raw.paperColor).toLowerCase() : base.paperColor,
    paperTone:raw.paperTone === "" || raw.paperTone == null || !Number.isFinite(tone) ? base.paperTone : Math.max(0, Math.min(1, tone))
  };
}
/* ---------- 내장 스티커(그림) ----------
   사진과 달리 ZIP 에 바이트를 싣지 않는다 — 이름과 색만 저장하고 그릴 때마다 SVG 로 그린다.
   그래서 크게 늘려도 선명하고, 같은 스티커를 여든 장 붙여도 파일은 한 줄씩만 는다(그림 획과 같은 생각).
   [id, 한글 이름, English, 높이÷폭, SVG 속(viewBox 는 "0 0 100 <높이>"), 반투명(테이프)] */
const DIARY_ART = [
  ["heart", "하트", "Heart", 0.90,
    '<path d="M50 86C18 62 6 46 6 30 6 15 17 5 30 5c9 0 16 4 20 12 4-8 11-12 20-12 13 0 24 10 24 25 0 16-12 32-44 56z"/>'],
  ["star", "별", "Star", 0.92,
    '<path d="M50 5 60.9 35 92.8 36.1 67.6 55.7 76.4 86.4 50 68.5 23.6 86.4 32.4 55.7 7.2 36.1 39.1 35z"/>'],
  ["flower", "꽃", "Flower", 1,
    '<g><circle cx="50" cy="23" r="21"/><circle cx="75.7" cy="41.6" r="21"/><circle cx="65.9" cy="71.8" r="21"/>'
    + '<circle cx="34.1" cy="71.8" r="21"/><circle cx="24.3" cy="41.6" r="21"/></g><circle cx="50" cy="50" r="13" fill="#fff" fill-opacity=".85"/>'],
  ["sparkle", "반짝", "Sparkle", 1,
    '<path d="M50 4c4 26 20 42 46 46-26 4-42 20-46 46-4-26-20-42-46-46 26-4 42-20 46-46z"/>'],
  ["ribbon", "리본", "Ribbon", 0.72,
    '<path d="M50 30C40 12 20 8 12 20 4 32 20 44 50 40 80 44 96 32 88 20 80 8 60 12 50 30z"/>'
    + '<path d="M44 42 30 68l16-6zM56 42l14 26-16-6z"/><circle cx="50" cy="37" r="9"/>'],
  ["crown", "왕관", "Crown", 0.72,
    '<path d="M10 62 17 16 34 37 50 8 66 37 83 16 90 62z"/><rect x="10" y="60" width="80" height="10" rx="4"/>'],
  ["leaf", "잎", "Leaf", 1,
    '<path d="M88 12c0 42-30 76-72 76C16 46 46 12 88 12z"/>'
    + '<path d="M16 90C40 71 60 51 79 26" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/>'],
  ["paw", "발자국", "Paw", 0.95,
    '<ellipse cx="50" cy="68" rx="27" ry="22"/><circle cx="22" cy="42" r="11"/><circle cx="40" cy="26" r="12"/>'
    + '<circle cx="62" cy="26" r="12"/><circle cx="80" cy="44" r="11"/>'],
  ["check", "체크", "Check", 0.78,
    '<path d="M10 44 36 70 90 12" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>'],
  ["arrow", "화살표", "Arrow", 0.56,
    '<path d="M2 20h60V4l36 24-36 24V36H2z"/>'],
  ["circle", "동그라미", "Circle", 0.74,
    '<ellipse cx="50" cy="37" rx="45" ry="32" fill="none" stroke="currentColor" stroke-width="6" transform="rotate(-5 50 37)"/>'],
  ["underline", "밑줄", "Underline", 0.2,
    '<path d="M3 12C20 4 34 18 50 11 66 4 80 18 97 9" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'],
  ["speech", "말풍선", "Speech bubble", 0.82,
    '<path d="M50 4C22 4 4 18 4 34c0 16 18 28 40 29L30 78l28-15.5c24-2.5 38-14.5 38-28.5C96 18 78 4 50 4z"/>'],
  ["flag", "깃발", "Flag", 1,
    '<rect x="10" y="4" width="7" height="92" rx="3"/><path d="M17 10c23-8 43 16 67 6v36c-24 10-44-14-67-6z"/>'],
  ["tape", "마스킹테이프", "Washi tape", 0.3,
    '<path d="M3 5 8 8 3 11 8 14 3 17 8 20 3 24 96 27 91 23 96 19 91 15 96 11 91 7 96 3z"/>', true],
  ["cloud", "구름", "Cloud", 0.62,
    '<circle cx="28" cy="36" r="18"/><circle cx="50" cy="28" r="24"/><circle cx="72" cy="38" r="16"/><rect x="10" y="38" width="80" height="16" rx="8"/>'],
  ["sun", "해", "Sun", 1,
    '<circle cx="50" cy="50" r="22"/><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round">'
    + '<path d="M50 7v11M50 82v11M7 50h11M82 50h11M20 20l8 8M72 72l8 8M80 20l-8 8M28 72l-8 8"/></g>'],
  ["moon", "달", "Moon", 1,
    '<path d="M74 82A42 42 0 1 1 68 12 34 34 0 0 0 74 82z"/>'],
  ["rainbow", "무지개", "Rainbow", 0.7,
    '<g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M9 62a41 41 0 0 1 82 0" stroke-width="12"/>'
    + '<path d="M24 62a26 26 0 0 1 52 0" stroke-width="9" opacity=".72"/><path d="M39 62a11 11 0 0 1 22 0" stroke-width="7" opacity=".45"/></g>'],
  ["raindrop", "빗방울", "Raindrop", 1,
    '<path d="M50 5C42 24 20 46 20 66a30 30 0 0 0 60 0C80 46 58 24 50 5z"/>'],
  ["snowflake", "눈송이", "Snowflake", 1,
    '<g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M50 6v88M12 28l76 44M12 72l76-44M41 16l9 9 9-9M41 84l9-9 9 9M18 39l13-3-4-13M82 61l-13 3 4 13M18 61l13 3-4 13M82 39l-13-3 4-13"/></g>'],
  ["smile", "웃는 얼굴", "Smile", 1,
    '<circle cx="50" cy="50" r="45"/><g fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round">'
    + '<path d="M33 38h.1M67 38h.1M28 61c7 20 37 20 44 0"/></g>'],
  ["musicnote", "음표", "Music note", 1,
    '<path d="M39 18 86 7v57c0 13-11 24-25 24-11 0-19-6-19-15 0-10 10-18 23-18 4 0 8 1 11 2V28L49 34v39c0 13-11 24-25 24-11 0-19-6-19-15 0-10 10-18 23-18 4 0 8 1 11 2z"/>'],
  ["book", "책", "Book", 0.72,
    '<path d="M6 8c18-5 33-1 44 8v50C39 57 24 53 6 58zM94 8c-18-5-33-1-44 8v50c11-9 26-13 44-8z"/>'
    + '<path d="M50 16v50" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="4"/>'],
  ["pencil", "연필", "Pencil", 0.32,
    '<path d="M5 23 11 7 76 7l17 9-17 9H11z"/><path d="m76 7 17 9-17 9z" fill="#fff" fill-opacity=".72"/>'
    + '<path d="M18 7v18" stroke="#fff" stroke-opacity=".65" stroke-width="5"/>'],
  ["camera", "카메라", "Camera", 0.72,
    '<path d="M10 20h18l7-11h30l7 11h18c5 0 8 3 8 8v34c0 5-3 8-8 8H10c-5 0-8-3-8-8V28c0-5 3-8 8-8z"/>'
    + '<circle cx="50" cy="45" r="18" fill="#fff" fill-opacity=".88"/><circle cx="50" cy="45" r="10"/><circle cx="82" cy="30" r="4" fill="#fff"/>'],
  ["gift", "선물", "Gift", 0.9,
    '<rect x="8" y="32" width="84" height="56" rx="5"/><rect x="4" y="24" width="92" height="18" rx="5"/>'
    + '<path d="M46 24C29 22 20 16 24 8c5-10 20 2 26 16M54 24C71 22 80 16 76 8 71-2 56 10 50 24M45 24h10v64H45z" fill="#fff" fill-opacity=".75"/>'],
  ["cake", "케이크", "Cake", 0.82,
    '<rect x="10" y="39" width="80" height="37" rx="7"/><path d="M10 48c11 10 19-8 30 2s19-8 30 2 14-2 20-5v-8H10z" fill="#fff" fill-opacity=".8"/>'
    + '<rect x="47" y="13" width="6" height="25" rx="3"/><path d="M50 2c10 10 5 17 0 17-6 0-9-7 0-17z"/>'],
  ["balloon", "풍선", "Balloon", 1.2,
    '<ellipse cx="50" cy="40" rx="34" ry="37"/><path d="m44 78 6-8 6 8zM50 78c-12 14 14 20 0 38" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>'],
  ["apple", "사과", "Apple", 1,
    '<path d="M50 28c-24-19-43 2-41 27 2 25 20 42 35 34 4-2 8-2 12 0 15 8 33-9 35-34 2-25-17-46-41-27z"/>'
    + '<path d="M51 28c0-13 5-21 15-25" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'
    + '<path d="M56 16C66 5 80 8 84 19 73 23 63 22 56 16z"/>'],
  ["cherry", "체리", "Cherries", 0.92,
    '<circle cx="30" cy="68" r="20"/><circle cx="70" cy="68" r="20"/><path d="M30 49C34 28 45 16 58 9M70 49C67 30 63 19 58 9" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
    + '<path d="M58 10C70 0 85 6 88 19 75 22 65 18 58 10z"/>'],
  ["strawberry", "딸기", "Strawberry", 1.08,
    '<path d="M50 18C18 3 6 28 15 55c8 24 25 40 35 48 10-8 27-24 35-48 9-27-3-52-35-37z"/>'
    + '<path d="M50 22 35 6l1 18-20-6 15 17M50 22 65 6l-1 18 20-6-15 17"/>'
    + '<g fill="#fff" fill-opacity=".72"><circle cx="34" cy="47" r="3"/><circle cx="62" cy="43" r="3"/><circle cx="48" cy="64" r="3"/><circle cx="32" cy="70" r="3"/><circle cx="65" cy="70" r="3"/></g>'],
  ["cup", "컵", "Cup", 0.72,
    '<path d="M12 13h63v34c0 14-12 23-27 23H39C24 70 12 61 12 47z"/><path d="M75 24h8c19 0 19 27 0 27h-9" fill="none" stroke="currentColor" stroke-width="9"/>'
    + '<path d="M28 3c-7 7 7 12 0 19M48 3c-7 7 7 12 0 19" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity=".65"/>'],
  ["cat", "고양이", "Cat", 1,
    '<path d="m18 35 2-28 23 17c5-2 9-2 14 0L80 7l2 28c9 12 10 29 3 41-7 13-19 20-35 20S22 89 15 76c-7-12-6-29 3-41z"/>'
    + '<g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"><path d="M34 51h.1M66 51h.1M44 65l6 4 6-4M22 65 4 61M22 72 5 77M78 65l18-4M78 72l17 5"/></g>'],
  ["bunny", "토끼", "Bunny", 1.18,
    '<ellipse cx="34" cy="31" rx="13" ry="29" transform="rotate(-10 34 31)"/><ellipse cx="66" cy="31" rx="13" ry="29" transform="rotate(10 66 31)"/>'
    + '<circle cx="50" cy="75" r="39"/><g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"><path d="M36 69h.1M64 69h.1M44 84l6 4 6-4"/></g>'],
  ["butterfly", "나비", "Butterfly", 0.82,
    '<path d="M44 39C31 8 2 6 7 34c2 13 13 19 29 17-20 7-27 28-12 30 13 2 21-14 23-31zM56 39C69 8 98 6 93 34c-2 13-13 19-29 17 20 7 27 28 12 30-13 2-21-14-23-31z"/>'
    + '<rect x="46" y="30" width="8" height="46" rx="4"/><path d="M48 31C39 20 38 12 38 5M52 31c9-11 10-19 10-26" fill="none" stroke="currentColor" stroke-width="3"/>'],
  ["tree", "나무", "Tree", 1.1,
    '<rect x="43" y="67" width="14" height="39" rx="4"/><circle cx="50" cy="42" r="31"/><circle cx="27" cy="51" r="22"/><circle cx="73" cy="51" r="22"/>'],
  ["house", "집", "House", 0.9,
    '<path d="M5 43 50 4l45 39-8 9-7-6v40H20V46l-7 6z"/><rect x="42" y="57" width="18" height="29" rx="3" fill="#fff" fill-opacity=".82"/>'
    + '<rect x="25" y="48" width="13" height="13" rx="2" fill="#fff" fill-opacity=".82"/><rect x="64" y="48" width="13" height="13" rx="2" fill="#fff" fill-opacity=".82"/>'],
  ["mountain", "산", "Mountain", 0.75,
    '<path d="m2 72 33-55 14 23L63 19l35 53z"/><path d="m22 39 13-22 14 23 14-21 14 22-14-10-14 20-14-20z" fill="#fff" fill-opacity=".78"/>'],
  ["umbrella", "우산", "Umbrella", 0.92,
    '<path d="M5 48C8 21 27 5 50 5s42 16 45 43c-10-8-20-8-30 0-10-8-20-8-30 0-10-8-20-8-30 0z"/>'
    + '<path d="M50 47v29c0 14 20 14 20 0" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'],
  ["airplane", "비행기", "Airplane", 0.62,
    '<path d="m3 37 38-10L52 4h12l-5 20 27-7c8-2 13 2 10 8-2 4-7 7-13 9l-24 6 5 18H52L41 43 9 51z"/>'],
  ["car", "자동차", "Car", 0.62,
    '<path d="M10 27h12L34 9h37l12 18h7c5 0 8 4 8 9v16H2V36c0-5 3-9 8-9z"/><circle cx="24" cy="54" r="10"/><circle cx="76" cy="54" r="10"/>'
    + '<path d="M36 16h14v11H29zM56 16h12l8 11H56z" fill="#fff" fill-opacity=".8"/>'],
  ["bicycle", "자전거", "Bicycle", 0.66,
    '<g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="22" cy="44" r="18"/><circle cx="78" cy="44" r="18"/>'
    + '<path d="m22 44 17-27 17 27H22l13-20h31l12 20M34 17h-9M62 17l8-8"/></g>'],
  ["clover", "네잎클로버", "Four-leaf clover", 1,
    '<circle cx="35" cy="35" r="24"/><circle cx="65" cy="35" r="24"/><circle cx="35" cy="65" r="24"/><circle cx="65" cy="65" r="24"/>'
    + '<path d="M50 50c8 18 9 31 4 45" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'],
  ["fire", "불꽃", "Flame", 1.08,
    '<path d="M57 4c5 23-12 29-5 45 4-12 14-17 20-28 16 17 23 37 13 57-8 17-23 27-39 27-22 0-39-17-37-40 2-18 14-27 28-43-1 17 4 23 8 27 1-19 14-26 12-45z"/>'
    + '<path d="M51 58c8 11 16 18 11 30-3 7-9 11-16 11-10 0-17-8-16-18 1-8 7-13 13-21 0 8 3 12 8 15z" fill="#fff" fill-opacity=".7"/>'],
  ["lightning", "번개", "Lightning", 1,
    '<path d="M58 3 16 58h29l-5 39 44-58H56z"/>'],
  ["pin", "위치 핀", "Map pin", 1.18,
    '<path d="M50 3C25 3 8 21 8 45c0 29 30 59 42 70 12-11 42-41 42-70C92 21 75 3 50 3z"/>'
    + '<circle cx="50" cy="44" r="16" fill="#fff" fill-opacity=".88"/>'],
  ["calendar", "달력", "Calendar", 0.9,
    '<rect x="7" y="14" width="86" height="75" rx="8"/><path d="M7 36h86" stroke="#fff" stroke-width="7"/>'
    + '<path d="M29 5v20M71 5v20" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>'
    + '<g fill="#fff" fill-opacity=".82"><circle cx="29" cy="55" r="5"/><circle cx="50" cy="55" r="5"/><circle cx="71" cy="55" r="5"/><circle cx="29" cy="74" r="5"/><circle cx="50" cy="74" r="5"/><circle cx="71" cy="74" r="5"/></g>'],
  ["dog", "강아지", "Dog", 1,
    '<path d="M20 36C5 24 5 8 18 5c10-2 18 8 23 19 6-2 12-2 18 0C64 13 72 3 82 5c13 3 13 19-2 31 8 15 7 34-3 46-7 9-16 14-27 14S30 91 23 82c-10-12-11-31-3-46z"/>'
    + '<g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"><path d="M35 51h.1M65 51h.1M43 66l7 5 7-5M34 76q16 12 32 0"/></g>'],
  ["bear", "곰", "Bear", 1,
    '<circle cx="22" cy="22" r="17"/><circle cx="78" cy="22" r="17"/><circle cx="50" cy="54" r="42"/>'
    + '<ellipse cx="50" cy="65" rx="20" ry="16" fill="#fff" fill-opacity=".78"/><path d="M35 48h.1M65 48h.1" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="61" r="5"/>'],
  ["penguin", "펭귄", "Penguin", 1.15,
    '<ellipse cx="50" cy="58" rx="38" ry="55"/><ellipse cx="50" cy="65" rx="25" ry="39" fill="#fff" fill-opacity=".88"/>'
    + '<circle cx="38" cy="38" r="4" fill="#fff"/><circle cx="62" cy="38" r="4" fill="#fff"/><path d="m50 45-9 8h18zM31 108l13-9M69 108l-13-9" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>'],
  ["fish", "물고기", "Fish", 0.72,
    '<path d="M8 36C25 8 66 5 82 29L98 13v46L82 43C66 67 25 64 8 36z"/><circle cx="35" cy="29" r="5" fill="#fff"/>'
    + '<path d="M50 13c6 8 7 15 5 22M50 59c6-8 7-15 5-22" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="4"/>'],
  ["bird", "새", "Bird", 0.82,
    '<path d="M8 57c16-3 25-14 31-32 12 7 18 18 17 31 13-10 25-11 37-4-9 8-18 14-30 17-17 14-39 12-55-12z"/>'
    + '<path d="M24 51c13-2 23 2 31 12" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/><circle cx="44" cy="39" r="4" fill="#fff"/>'],
  ["ladybug", "무당벌레", "Ladybug", 1,
    '<circle cx="50" cy="55" r="40"/><circle cx="50" cy="18" r="18"/><path d="M50 26v69" stroke="#fff" stroke-width="5"/>'
    + '<g fill="#fff" fill-opacity=".78"><circle cx="34" cy="48" r="6"/><circle cx="67" cy="48" r="6"/><circle cx="28" cy="70" r="6"/><circle cx="72" cy="70" r="6"/></g>'],
  ["pizza", "피자", "Pizza", 1,
    '<path d="M50 94 9 18c25-13 57-13 82 0z"/><path d="M9 18c25-13 57-13 82 0" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="12" stroke-linecap="round"/>'
    + '<g fill="#fff" fill-opacity=".72"><circle cx="40" cy="38" r="7"/><circle cx="63" cy="51" r="7"/><circle cx="47" cy="68" r="6"/></g>'],
  ["hamburger", "햄버거", "Hamburger", 0.88,
    '<path d="M8 36C10 14 27 4 50 4s40 10 42 32zM7 61h86v14c0 5-4 8-9 8H16c-5 0-9-3-9-8z"/>'
    + '<path d="M6 45h88M11 55l15 8 15-8 15 8 15-8 18 8" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'],
  ["donut", "도넛", "Donut", 1,
    '<circle cx="50" cy="50" r="45"/><circle cx="50" cy="50" r="16" fill="#fff" fill-opacity=".9"/>'
    + '<g fill="#fff" fill-opacity=".72"><rect x="25" y="24" width="14" height="4" rx="2" transform="rotate(30 32 26)"/><rect x="64" y="27" width="14" height="4" rx="2" transform="rotate(-25 71 29)"/><rect x="68" y="66" width="14" height="4" rx="2" transform="rotate(24 75 68)"/><rect x="22" y="65" width="14" height="4" rx="2" transform="rotate(-32 29 67)"/></g>'],
  ["icecream", "아이스크림", "Ice cream", 1.18,
    '<circle cx="50" cy="35" r="32"/><path d="M22 52h56L50 116z"/>'
    + '<path d="m31 65 36 26M69 65 40 88" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="4"/>'],
  ["watermelon", "수박", "Watermelon", 0.72,
    '<path d="M5 7h90C91 43 72 67 50 67S9 43 5 7z"/><path d="M10 13h80" stroke="#fff" stroke-opacity=".8" stroke-width="9"/>'
    + '<g fill="#fff" fill-opacity=".75"><ellipse cx="30" cy="31" rx="3" ry="6"/><ellipse cx="50" cy="40" rx="3" ry="6"/><ellipse cx="70" cy="31" rx="3" ry="6"/></g>'],
  ["coffee", "커피", "Coffee", 0.9,
    '<path d="M10 25h65v35c0 17-13 24-29 24h-7C23 84 10 77 10 60z"/><path d="M75 34h8c18 0 18 27 0 27h-9" fill="none" stroke="currentColor" stroke-width="9"/>'
    + '<path d="M29 3c-8 8 8 13 0 22M49 3c-8 8 8 13 0 22" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'],
  ["bell", "종", "Bell", 1,
    '<path d="M15 75h70L75 62V39C75 22 65 10 50 8 35 10 25 22 25 39v23z"/><path d="M39 80c1 11 21 11 22 0"/><circle cx="50" cy="7" r="7"/>'],
  ["trophy", "트로피", "Trophy", 1,
    '<path d="M24 8h52v24c0 20-10 33-26 36-16-3-26-16-26-36z"/><path d="M24 18H7v12c0 17 10 25 25 24M76 18h17v12c0 17-10 25-25 24" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/>'
    + '<path d="M45 67h10v17h18v10H27V84h18z"/>'],
  ["medal", "메달", "Medal", 1.08,
    '<path d="M20 4h22l8 30L32 48zM80 4H58l-8 30 18 14z"/><circle cx="50" cy="70" r="35"/>'
    + '<path d="m50 48 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z" fill="#fff" fill-opacity=".8"/>'],
  ["graduation", "학사모", "Graduation cap", 0.72,
    '<path d="M2 26 50 4l48 22-48 22z"/><path d="M22 38v19c17 12 39 12 56 0V38L50 51z"/>'
    + '<path d="M91 29v26" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="91" cy="61" r="7"/>'],
  ["globe", "지구본", "Globe", 1.05,
    '<circle cx="50" cy="43" r="39" fill="none" stroke="currentColor" stroke-width="7"/><path d="M50 5c20 20 20 56 0 76M50 5c-20 20-20 56 0 76M12 43h76M19 23h62M19 63h62" fill="none" stroke="currentColor" stroke-width="4"/>'
    + '<path d="M50 83v10M29 101h42" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'],
  ["paintbrush", "붓", "Paint brush", 1,
    '<path d="m15 75 18-4 54-54L74 4 20 58z"/><path d="M15 75c-13 5-10 17-8 22 7-6 20-3 26-18z"/>'
    + '<path d="M24 56 36 68" stroke="#fff" stroke-opacity=".72" stroke-width="5"/>'],
  ["rocket", "로켓", "Rocket", 1.18,
    '<path d="M50 4c24 16 29 48 12 76H38C21 52 26 20 50 4z"/><circle cx="50" cy="40" r="11" fill="#fff" fill-opacity=".85"/>'
    + '<path d="m38 63-19 12-5 26 25-16M62 63l19 12 5 26-25-16M42 82l8 31 8-31"/>'],
  ["train", "기차", "Train", 1,
    '<rect x="12" y="6" width="67" height="55" rx="10"/><path d="M25 18h41v23H25z" fill="#fff" fill-opacity=".8"/>'
    + '<circle cx="29" cy="65" r="12"/><circle cx="66" cy="65" r="12"/><path d="m18 77-9 0M75 77h16M31 78l-12 15M63 78l13 15M34 89h31" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'],
  ["ship", "배", "Ship", 1,
    '<path d="M7 48h86L79 76c-6 12-52 12-58 0z"/><path d="M46 5v43M48 9l34 31H48zM42 14 17 40h25z"/>'
    + '<path d="M7 91c10-8 19 8 29 0s19 8 29 0 19 8 29 0" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'],
  ["suitcase", "여행 가방", "Suitcase", 0.94,
    '<rect x="10" y="23" width="80" height="68" rx="9"/><path d="M35 23V10h30v13M30 25v64M70 25v64" fill="none" stroke="currentColor" stroke-width="7"/>'
    + '<path d="M34 10h32" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'],
  ["tent", "텐트", "Tent", 0.82,
    '<path d="M4 78 45 7h10l41 71z"/><path d="M50 20v58M50 78 30 78l20-37 20 37z" fill="#fff" fill-opacity=".78"/>'
    + '<path d="M8 78h84" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'],
  ["compass", "나침반", "Compass", 1,
    '<circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="7"/><path d="m64 20-8 36-36 8 24-20z"/>'
    + '<circle cx="50" cy="50" r="6" fill="#fff"/><path d="M50 6v8M50 86v8M6 50h8M86 50h8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'],
  ["partyhat", "파티 모자", "Party hat", 1.08,
    '<path d="m12 92 30-78 50 50z"/><path d="M25 58c14 2 27 10 38 22" fill="none" stroke="#fff" stroke-opacity=".78" stroke-width="7"/>'
    + '<circle cx="44" cy="11" r="9"/><circle cx="79" cy="19" r="5"/><circle cx="87" cy="39" r="4"/>'],
  ["confetti", "색종이 폭죽", "Confetti", 1,
    '<path d="m22 94 15-50 39 39z"/><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"><path d="M45 31c-8-12 1-21 13-19M59 39c8-16 25-14 28-28M65 53c14-8 24-1 27 9"/></g>'
    + '<circle cx="22" cy="23" r="6"/><rect x="73" y="65" width="11" height="11" rx="2" transform="rotate(25 78 70)"/><path d="m84 33 11 4-8 9z"/>'],
  ["candle", "촛불", "Candle", 1.1,
    '<rect x="27" y="36" width="46" height="70" rx="5"/><path d="M50 2c18 18 10 34 0 34S32 20 50 2z"/>'
    + '<path d="M27 57c10-9 16 8 27-2 8-7 12 3 19-2" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="6"/>'],
  ["key", "열쇠", "Key", 0.84,
    '<circle cx="25" cy="31" r="20" fill="none" stroke="currentColor" stroke-width="10"/><path d="m41 43 50 13-4 15-14-4-4 13-14-4 4-13-22-6z"/><circle cx="25" cy="31" r="6"/>'],
  ["envelope", "편지", "Envelope", 0.7,
    '<rect x="5" y="7" width="90" height="62" rx="7"/><path d="m9 14 41 31 41-31M8 64l31-27M92 64 61 37" fill="none" stroke="#fff" stroke-opacity=".78" stroke-width="6" stroke-linejoin="round"/>'],
  ["clock", "시계", "Clock", 1,
    '<circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="8"/><path d="M50 24v28l20 13" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="50" r="5"/>'],
  ["soccer", "축구공", "Soccer ball", 1,
    '<circle cx="50" cy="50" r="46"/><path d="m50 27 15 11-6 18H41l-6-18z" fill="#fff" fill-opacity=".88"/>'
    + '<path d="m50 4v23M6 39l29-1M19 83l22-27M81 83 59 56M94 39l-29-1" fill="none" stroke="#fff" stroke-opacity=".82" stroke-width="6"/>'],
  ["gamepad", "게임기", "Game controller", 0.82,
    '<path d="M21 18h58c10 0 15 8 17 20l3 19c3 17-15 23-24 10L65 54H35L25 67C16 80-2 74 1 57l3-19c2-12 7-20 17-20z"/>'
    + '<path d="M27 31v19M17 41h20" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="72" cy="36" r="5" fill="#fff"/><circle cx="83" cy="47" r="5" fill="#fff"/>'],
  ["thumbsup", "엄지척", "Thumbs up", 1,
    '<rect x="5" y="46" width="22" height="48" rx="6"/>'
    + '<path d="M34 94V50c10-2 16-9 19-20 2-8 2-14 6-20 8-12 22-4 18 10-2 7-4 12-6 17h21c8 0 13 7 11 15l-8 30c-2 8-8 12-16 12z"/>'],
  ["sadface", "우는 얼굴", "Crying face", 1,
    '<circle cx="50" cy="50" r="45"/><g fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round">'
    + '<path d="M33 38h.1M67 38h.1M30 72c8-16 32-16 40 0"/></g>'
    + '<path d="M33 50c-6 11-9 16-9 20a9 9 0 0 0 18 0c0-4-3-9-9-20z" fill="#fff" fill-opacity=".85"/>'],
  ["question", "물음표", "Question mark", 1.05,
    '<path d="M50 4C31 4 17 15 15 33h19c2-8 8-13 16-13 9 0 15 5 15 13 0 6-3 10-11 16-11 8-15 15-15 26v3h19v-2c0-7 3-11 12-18 10-8 15-15 15-26C85 16 71 4 50 4z"/>'
    + '<circle cx="48" cy="93" r="11"/>'],
  ["exclaim", "느낌표", "Exclamation mark", 1,
    '<path d="M38 4h24l-4 62H42z"/><circle cx="50" cy="86" r="12"/>'],
  ["cross", "가위표", "Cross mark", 1,
    '<path d="M16 16 84 84M84 16 16 84" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round"/>'],
  ["bulb", "전구", "Light bulb", 1.15,
    '<path d="M50 4C30 4 15 19 15 38c0 13 7 21 13 28 4 5 6 9 7 14h30c1-5 3-9 7-14 6-7 13-15 13-28C85 19 70 4 50 4z"/>'
    + '<rect x="35" y="88" width="30" height="10" rx="5"/><rect x="38" y="102" width="24" height="10" rx="5"/>'
    + '<path d="M50 24c-8 0-14 6-14 14" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="6" stroke-linecap="round"/>'],
  ["magnifier", "돋보기", "Magnifying glass", 1,
    '<circle cx="42" cy="42" r="32" fill="none" stroke="currentColor" stroke-width="10"/>'
    + '<path d="m66 66 28 28" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round"/>'
    + '<path d="M30 30c4-6 10-9 16-9" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/>'],
  ["backpack", "책가방", "Backpack", 1,
    '<path d="M34 36v-7a16 16 0 0 1 32 0v7H55v-7a5 5 0 0 0-10 0v7z"/><rect x="10" y="34" width="80" height="62" rx="16"/>'
    + '<rect x="28" y="56" width="44" height="26" rx="8" fill="#fff" fill-opacity=".82"/>'],
  ["ruler", "자", "Ruler", 0.28,
    '<rect x="2" y="4" width="96" height="20" rx="4"/>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="4" stroke-linecap="round"><path d="M14 4v9M26 4v6M38 4v9M50 4v6M62 4v9M74 4v6M86 4v9"/></g>'],
  ["scissors", "가위", "Scissors", 1,
    '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"><path d="M22 8 62 62M78 8 38 62"/>'
    + '<circle cx="26" cy="80" r="14"/><circle cx="74" cy="80" r="14"/></g>'],
  ["clip", "클립", "Paper clip", 1,
    '<path d="M72 26v42a24 24 0 0 1-48 0V24a15 15 0 0 1 30 0v40a7 7 0 0 1-14 0V30" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'],
  ["note", "메모지", "Sticky note", 1,
    '<path d="M8 8h84v56L64 92H8z"/><path d="M92 64H72c-5 0-8 3-8 8v20z" fill="#fff" fill-opacity=".82"/>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="5" stroke-linecap="round"><path d="M22 28h56M22 44h56M22 60h34"/></g>'],
  ["palette", "물감판", "Paint palette", 0.88,
    '<path d="M50 4C22 4 4 22 4 45c0 22 18 38 38 38 8 0 12-4 12-9 0-6-6-8-6-14 0-6 5-10 12-10h16c14 0 20-8 20-19C96 16 78 4 50 4z"/>'
    + '<g fill="#fff" fill-opacity=".8"><circle cx="28" cy="30" r="7"/><circle cx="52" cy="22" r="7"/><circle cx="74" cy="32" r="7"/><circle cx="24" cy="56" r="7"/></g>'],
  ["glasses", "안경", "Glasses", 0.46,
    '<g fill="none" stroke="currentColor" stroke-width="8"><circle cx="24" cy="26" r="18"/><circle cx="76" cy="26" r="18"/>'
    + '<path d="M42 24c5-4 11-4 16 0M6 20 2 12M94 20l4-8" stroke-linecap="round"/></g>'],
  ["cap", "모자", "Cap", 0.6,
    '<path d="M50 8c-20 0-34 15-34 34v4h68v-4c0-19-14-34-34-34z"/><path d="M16 44h68c12 0 16 12 4 12H24c-8 0-10-6-8-12z"/>'
    + '<circle cx="50" cy="8" r="6"/>'],
  ["shoe", "운동화", "Sneaker", 0.56,
    '<path d="M6 20h20l14 10 22 4c14 2 24 8 30 16v4H6z"/><rect x="2" y="42" width="96" height="12" rx="6"/>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="4" stroke-linecap="round"><path d="M28 24 40 34M36 20l12 12M44 18l12 14"/></g>'],
  ["lock", "자물쇠", "Lock", 1.1,
    '<path d="M30 46V32a20 20 0 0 1 40 0v14H57V32a7 7 0 0 0-14 0v14z"/><rect x="14" y="44" width="72" height="62" rx="12"/>'
    + '<circle cx="50" cy="70" r="8" fill="#fff" fill-opacity=".85"/><rect x="46" y="74" width="8" height="18" rx="4" fill="#fff" fill-opacity=".85"/>'],
  ["headphone", "헤드폰", "Headphones", 0.9,
    '<path d="M14 62V50a36 36 0 0 1 72 0v12" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/>'
    + '<rect x="4" y="54" width="24" height="34" rx="11"/><rect x="72" y="54" width="24" height="34" rx="11"/>'],
  ["guitar", "기타", "Guitar", 1.2,
    '<rect x="40" y="2" width="20" height="13" rx="4"/><rect x="44" y="13" width="12" height="36" rx="3"/>'
    + '<path d="M50 44c-14 0-24 8-24 18 0 6 3 10 6 13-6 4-10 11-10 19 0 12 11 21 28 21s28-9 28-21c0-8-4-15-10-19 3-3 6-7 6-13 0-10-10-18-24-18z"/>'
    + '<circle cx="50" cy="92" r="9" fill="#fff" fill-opacity=".9"/><rect x="46" y="106" width="8" height="8" rx="3" fill="#fff" fill-opacity=".8"/>'],
  ["robot", "로봇", "Robot", 1,
    '<circle cx="50" cy="8" r="7"/><path d="M50 12v14" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
    + '<rect x="18" y="26" width="64" height="54" rx="12"/><rect x="4" y="38" width="12" height="28" rx="6"/><rect x="84" y="38" width="12" height="28" rx="6"/>'
    + '<rect x="28" y="82" width="16" height="14" rx="5"/><rect x="56" y="82" width="16" height="14" rx="5"/>'
    + '<g fill="#fff"><circle cx="36" cy="48" r="8"/><circle cx="64" cy="48" r="8"/></g>'
    + '<path d="M38 64h24" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>'],
  ["basketball", "농구공", "Basketball", 1,
    '<circle cx="50" cy="50" r="46"/><g fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="5">'
    + '<path d="M50 4v92M4 50h92M18 18c18 14 18 50 0 64M82 18c-18 14-18 50 0 64"/></g>'],
  ["baseball", "야구공", "Baseball", 1,
    '<circle cx="50" cy="50" r="46"/><g fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="5" stroke-linecap="round">'
    + '<path d="M22 14c12 20 12 52 0 72M78 14c-12 20-12 52 0 72M28 28l8 4M26 44h9M28 62l8-4M72 28l-8 4M74 44h-9M72 62l-8-4"/></g>'],
  ["snowman", "눈사람", "Snowman", 1.08,
    '<rect x="34" y="0" width="32" height="14" rx="3"/><rect x="22" y="12" width="56" height="7" rx="3"/>'
    + '<circle cx="50" cy="34" r="20"/><circle cx="50" cy="74" r="32"/>'
    + '<g fill="#fff"><circle cx="43" cy="32" r="4"/><circle cx="57" cy="32" r="4"/></g>'
    + '<path d="m50 36 13 4-13 5z" fill="#fff" fill-opacity=".85"/>'
    + '<g fill="#fff" fill-opacity=".8"><circle cx="50" cy="62" r="5"/><circle cx="50" cy="78" r="5"/><circle cx="50" cy="94" r="5"/></g>'
    + '<path d="M20 70 4 56M80 70l16-14" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'],
  ["maple", "단풍잎", "Maple leaf", 1,
    '<path d="M50 4 62 28l14-6-6 16 20-2-14 14 16 8-18 6 8 14-20-4 2 22h-8l2-22-20 4 8-14-18-6 16-8L20 36l20 2-6-16 14 6z"/>'],
  ["blossom", "벚꽃", "Cherry blossom", 1,
    '<g><ellipse cx="50" cy="22" rx="15" ry="20"/><ellipse cx="77" cy="42" rx="15" ry="20" transform="rotate(72 77 42)"/>'
    + '<ellipse cx="67" cy="74" rx="15" ry="20" transform="rotate(144 67 74)"/><ellipse cx="33" cy="74" rx="15" ry="20" transform="rotate(216 33 74)"/>'
    + '<ellipse cx="23" cy="42" rx="15" ry="20" transform="rotate(288 23 42)"/></g>'
    + '<circle cx="50" cy="50" r="9" fill="#fff" fill-opacity=".85"/>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"><path d="M50 50 44 32M50 50l18-4M50 50l10 16M50 50l-16 10"/></g>'],
  ["sunflower", "해바라기", "Sunflower", 1.15,
    '<g><ellipse cx="50" cy="16" rx="9" ry="16"/><ellipse cx="74" cy="26" rx="9" ry="16" transform="rotate(45 74 26)"/>'
    + '<ellipse cx="84" cy="50" rx="16" ry="9"/><ellipse cx="74" cy="74" rx="9" ry="16" transform="rotate(-45 74 74)"/>'
    + '<ellipse cx="50" cy="84" rx="9" ry="16"/><ellipse cx="26" cy="74" rx="9" ry="16" transform="rotate(45 26 74)"/>'
    + '<ellipse cx="16" cy="50" rx="16" ry="9"/><ellipse cx="26" cy="26" rx="9" ry="16" transform="rotate(-45 26 26)"/></g>'
    + '<circle cx="50" cy="50" r="22" fill="#fff" fill-opacity=".85"/><circle cx="50" cy="50" r="14"/>'
    + '<path d="M50 98v15" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'],
  ["mushroom", "버섯", "Mushroom", 1,
    '<path d="M50 6C26 6 6 24 6 44c0 6 4 10 12 10h64c8 0 12-4 12-10C94 24 74 6 50 6z"/>'
    + '<path d="M36 54h28v26c0 10-6 16-14 16s-14-6-14-16z"/>'
    + '<g fill="#fff" fill-opacity=".8"><circle cx="30" cy="30" r="8"/><circle cx="62" cy="24" r="6"/><circle cx="74" cy="38" r="5"/></g>'],
  ["wave", "물결", "Waves", 0.7,
    '<g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round">'
    + '<path d="M5 18c12-12 20 12 32 0s20 12 31 0 20 12 27 0M5 40c12-12 20 12 32 0s20 12 31 0 20 12 27 0M5 62c12-12 20 12 32 0s20 12 31 0 20 12 27 0"/></g>'],
  ["planet", "행성", "Planet", 0.86,
    '<circle cx="50" cy="42" r="30"/>'
    + '<path d="M22 54c-14 6-22 13-20 19 3 8 24 8 48 0s41-21 38-29c-2-5-10-6-20-4" fill="none" stroke="currentColor" stroke-width="7"/>'
    + '<g fill="#fff" fill-opacity=".7"><circle cx="40" cy="32" r="6"/><circle cx="61" cy="50" r="5"/></g>'],
  ["fox", "여우", "Fox", 0.9,
    '<path d="M14 6 34 28h32L86 6c8 20 6 40-4 52-8 10-20 16-32 16s-24-6-32-16C8 46 6 26 14 6z"/>'
    + '<path d="M34 62c0-7 7-12 16-12s16 5 16 12c0 8-7 14-16 14s-16-6-16-14z" fill="#fff" fill-opacity=".85"/>'
    + '<g fill="#fff"><circle cx="32" cy="46" r="4"/><circle cx="68" cy="46" r="4"/></g><circle cx="50" cy="59" r="5"/>'
    + '<path d="M42 69c5 4 11 4 16 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'],
  ["chick", "병아리", "Chick", 1.05,
    '<circle cx="50" cy="60" r="33"/><circle cx="50" cy="28" r="21"/>'
    + '<g fill="#fff"><circle cx="43" cy="26" r="4"/><circle cx="57" cy="26" r="4"/></g>'
    + '<path d="m50 31 11 5-11 6-11-6z" fill="#fff" fill-opacity=".9"/>'
    + '<path d="M22 58c8 6 10 16 6 26-10-4-14-16-6-26z" fill="#fff" fill-opacity=".7"/>'
    + '<path d="M40 92v8M60 92v8M32 100h16M52 100h16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'],
  ["bee", "벌", "Bee", 0.88,
    '<ellipse cx="34" cy="26" rx="19" ry="12" transform="rotate(-22 34 26)" opacity=".5"/>'
    + '<ellipse cx="68" cy="26" rx="19" ry="12" transform="rotate(22 68 26)" opacity=".5"/>'
    + '<ellipse cx="50" cy="56" rx="36" ry="26"/>'
    + '<g fill="#fff" fill-opacity=".75"><ellipse cx="44" cy="56" rx="4" ry="25"/><ellipse cx="62" cy="56" rx="4" ry="21"/></g>'
    + '<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M24 34 16 22M38 28l-2-14"/></g>'
    + '<circle cx="22" cy="50" r="4" fill="#fff"/>'],
  ["frog", "개구리", "Frog", 0.9,
    '<path d="M50 24c-27 0-45 16-45 34 0 16 18 26 45 26s45-10 45-26c0-18-18-34-45-34z"/>'
    + '<circle cx="26" cy="24" r="17"/><circle cx="74" cy="24" r="17"/>'
    + '<g fill="#fff"><circle cx="26" cy="24" r="8"/><circle cx="74" cy="24" r="8"/></g>'
    + '<circle cx="27" cy="25" r="4"/><circle cx="75" cy="25" r="4"/>'
    + '<path d="M32 62c8 10 28 10 36 0" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/>'],
  ["whale", "고래", "Whale", 0.76,
    '<path d="M4 44c0-18 18-32 40-32s38 12 38 28c0 18-16 34-38 34C22 74 4 62 4 44z"/><path d="M80 40 98 22v44L78 52z"/>'
    + '<path d="M12 56c16 10 40 10 56-2" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>'
    + '<circle cx="24" cy="38" r="4" fill="#fff"/>'
    + '<path d="M44 12c-2-8 4-12 10-9M54 10c0-6 6-8 10-5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>'],
  ["candy", "사탕", "Candy", 0.6,
    '<ellipse cx="50" cy="30" rx="26" ry="25"/><path d="M25 30 3 10v40zM75 30l22-20v40z"/>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="5" stroke-linecap="round"><path d="M41 12c7 12 7 24 0 36M57 12c7 12 7 24 0 36"/></g>'],
  ["cookie", "쿠키", "Cookie", 1,
    '<circle cx="50" cy="50" r="45"/>'
    + '<g fill="#fff" fill-opacity=".6"><circle cx="34" cy="34" r="8"/><circle cx="66" cy="40" r="7"/><circle cx="44" cy="64" r="7"/>'
    + '<circle cx="70" cy="70" r="6"/><circle cx="24" cy="58" r="5"/></g>'],
  ["milk", "우유", "Milk carton", 1.1,
    '<path d="M22 36h56v60c0 6-4 10-10 10H32c-6 0-10-4-10-10z"/><path d="M22 36 50 16l28 20z"/><rect x="32" y="10" width="36" height="9" rx="3"/>'
    + '<path d="M22 36 50 26l28 10" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="4"/>'
    + '<rect x="33" y="54" width="34" height="26" rx="4" fill="#fff" fill-opacity=".85"/>'],
  ["banana", "바나나", "Banana", 0.78,
    '<path d="M12 18c-4 28 12 54 40 56 22 2 40-10 44-26-14 10-28 10-40 4C40 44 28 32 26 14z"/><rect x="18" y="6" width="13" height="14" rx="4"/>'],
  ["grape", "포도", "Grapes", 1,
    '<path d="M50 30V10" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
    + '<path d="M52 16c10-14 26-12 32-4-8 12-22 14-32 4z"/>'
    + '<g><circle cx="26" cy="42" r="13"/><circle cx="50" cy="40" r="13"/><circle cx="74" cy="42" r="13"/>'
    + '<circle cx="38" cy="62" r="13"/><circle cx="62" cy="62" r="13"/><circle cx="50" cy="82" r="13"/></g>'],
  ["carrot", "당근", "Carrot", 1.15,
    '<path d="M50 36C40 16 28 10 14 12c2 14 14 24 36 24zM50 36c10-20 22-26 36-24-2 14-14 24-36 24z"/>'
    + '<path d="M32 38h36l-12 70c-2 8-10 8-12 0z"/>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="4" stroke-linecap="round"><path d="M38 56h22M40 74h18M44 90h12"/></g>'],
  ["piano", "피아노", "Piano", 0.7,
    '<rect x="4" y="8" width="92" height="54" rx="7"/>'
    + '<g fill="#fff" fill-opacity=".92"><rect x="10" y="22" width="11" height="34" rx="2"/><rect x="23" y="22" width="11" height="34" rx="2"/>'
    + '<rect x="36" y="22" width="11" height="34" rx="2"/><rect x="49" y="22" width="11" height="34" rx="2"/>'
    + '<rect x="62" y="22" width="11" height="34" rx="2"/><rect x="75" y="22" width="11" height="34" rx="2"/></g>'
    + '<g><rect x="18" y="22" width="7" height="20" rx="2"/><rect x="31" y="22" width="7" height="20" rx="2"/>'
    + '<rect x="57" y="22" width="7" height="20" rx="2"/><rect x="70" y="22" width="7" height="20" rx="2"/></g>'],
  ["drum", "북", "Drum", 0.76,
    '<path d="M20 28 42 6M80 28 58 6" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'
    + '<circle cx="42" cy="6" r="5"/><circle cx="58" cy="6" r="5"/>'
    + '<ellipse cx="50" cy="60" rx="40" ry="12"/><rect x="10" y="38" width="80" height="22"/>'
    + '<ellipse cx="50" cy="38" rx="40" ry="12" fill="#fff" fill-opacity=".85"/>'],
  ["xylophone", "실로폰", "Xylophone", 0.72,
    '<rect x="6" y="12" width="88" height="11" rx="5"/><rect x="10" y="28" width="80" height="11" rx="5"/>'
    + '<rect x="14" y="44" width="72" height="11" rx="5"/><rect x="18" y="60" width="64" height="11" rx="5"/>'
    + '<g fill="#fff" fill-opacity=".55"><circle cx="16" cy="17" r="3"/><circle cx="84" cy="17" r="3"/><circle cx="20" cy="33" r="3"/>'
    + '<circle cx="80" cy="33" r="3"/><circle cx="24" cy="49" r="3"/><circle cx="76" cy="49" r="3"/><circle cx="28" cy="65" r="3"/><circle cx="72" cy="65" r="3"/></g>'],
  ["recorder", "리코더", "Recorder", 0.3,
    '<rect x="4" y="6" width="92" height="18" rx="9"/><path d="M4 8h16v14H4z"/>'
    + '<g fill="#fff" fill-opacity=".75"><circle cx="36" cy="15" r="4"/><circle cx="50" cy="15" r="4"/><circle cx="64" cy="15" r="4"/><circle cx="78" cy="15" r="4"/></g>'],
  ["trumpet", "트럼펫", "Trumpet", 0.7,
    '<path d="M96 6 64 24v22l32 18z"/><rect x="14" y="28" width="52" height="14" rx="7"/><circle cx="14" cy="35" r="10"/>'
    + '<g><rect x="28" y="12" width="8" height="18" rx="4"/><rect x="42" y="12" width="8" height="18" rx="4"/><rect x="56" y="12" width="8" height="18" rx="4"/></g>'],
  ["violin", "바이올린", "Violin", 1.1,
    '<g opacity=".7"><path d="M6 84 94 28" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'
    + '<rect x="2" y="78" width="14" height="11" rx="3" transform="rotate(-32 9 84)"/></g>'
    + '<rect x="42" y="2" width="16" height="12" rx="5"/><rect x="45" y="12" width="10" height="34" rx="3"/>'
    + '<path d="M50 42c-13 0-22 7-22 16 0 5 2 9 6 12-5 4-9 10-9 17 0 11 10 19 25 19s25-8 25-19c0-7-4-13-9-17 4-3 6-7 6-12 0-9-9-16-22-16z"/>'
    + '<g fill="#fff" fill-opacity=".8"><rect x="36" y="72" width="4" height="16" rx="2"/><rect x="60" y="72" width="4" height="16" rx="2"/></g>'],
  ["harmonica", "하모니카", "Harmonica", 0.42,
    '<rect x="4" y="8" width="92" height="28" rx="6"/>'
    + '<g fill="#fff" fill-opacity=".8"><rect x="12" y="16" width="9" height="12" rx="2"/><rect x="25" y="16" width="9" height="12" rx="2"/>'
    + '<rect x="38" y="16" width="9" height="12" rx="2"/><rect x="51" y="16" width="9" height="12" rx="2"/>'
    + '<rect x="64" y="16" width="9" height="12" rx="2"/><rect x="77" y="16" width="9" height="12" rx="2"/></g>'],
  ["tambourine", "탬버린", "Tambourine", 1,
    '<circle cx="50" cy="52" r="42" fill="none" stroke="currentColor" stroke-width="13"/><circle cx="50" cy="52" r="30" opacity=".22"/>'
    + '<g fill="#fff" fill-opacity=".85"><circle cx="50" cy="10" r="7"/><circle cx="86" cy="31" r="7"/><circle cx="86" cy="73" r="7"/>'
    + '<circle cx="50" cy="94" r="7"/><circle cx="14" cy="73" r="7"/><circle cx="14" cy="31" r="7"/></g>'],
  ["triangle", "트라이앵글", "Triangle", 0.95,
    '<g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"><path d="M14 86 50 8l36 78M18 86h52"/></g>'
    + '<path d="M64 34 96 22" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity=".7"/>'],
  ["maracas", "마라카스", "Maracas", 1,
    '<ellipse cx="28" cy="30" rx="20" ry="23"/><rect x="22" y="48" width="12" height="46" rx="6" transform="rotate(10 28 70)"/>'
    + '<ellipse cx="72" cy="34" rx="18" ry="21"/><rect x="67" y="50" width="11" height="42" rx="5" transform="rotate(-10 72 72)"/>'
    + '<g fill="#fff" fill-opacity=".6"><circle cx="24" cy="26" r="5"/><circle cx="68" cy="30" r="4"/></g>'],
  ["janggu", "장구", "Janggu", 0.9,
    '<path d="M16 14c10 6 24 16 34 16s24-10 34-16v60c-10-6-24-16-34-16s-24 10-34 16z"/>'
    + '<ellipse cx="16" cy="44" rx="9" ry="31"/><ellipse cx="84" cy="44" rx="9" ry="31"/>'
    + '<ellipse cx="16" cy="44" rx="4" ry="24" fill="#fff" fill-opacity=".7"/><ellipse cx="84" cy="44" rx="4" ry="24" fill="#fff" fill-opacity=".7"/>'
    + '<path d="M34 28 40 60M50 32v25M60 28l6 32" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="4" stroke-linecap="round"/>'],
  ["microphone", "마이크", "Microphone", 1.1,
    '<rect x="36" y="4" width="28" height="52" rx="14"/>'
    + '<path d="M22 46c0 16 12 28 28 28s28-12 28-28" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>'
    + '<path d="M50 74v20M32 100h36" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>'
    + '<path d="M40 16h20M40 26h20M40 36h20" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>'],
  ["hanbok", "한복", "Hanbok", 1,
    '<path d="M50 6c-9 0-16 3-22 7L6 28l10 13 14-10v13h40V31l14 10 10-13-22-15c-6-4-13-7-22-7z"/>'
    + '<path d="M38 10 50 26 62 10" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="6" stroke-linejoin="round"/>'
    + '<path d="M28 46h44l18 48c-17 8-63 8-80 0z"/>'
    + '<path d="M50 30v14" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>'],
  ["pouch", "복주머니", "Lucky pouch", 1.05,
    '<path d="M34 12c4-8 28-8 32 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'
    + '<path d="M30 30h40c14 12 22 28 22 42 0 16-19 26-42 26S8 88 8 72c0-14 8-30 22-42z"/>'
    + '<path d="M26 30c10-7 38-7 48 0" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>'
    + '<path d="M50 60c8 0 14 6 14 13s-6 13-14 13-14-6-14-13 6-13 14-13z" fill="#fff" fill-opacity=".8"/>'],
  ["songpyeon", "송편", "Songpyeon", 0.72,
    '<path d="M6 64c0-27 20-46 44-46s44 19 44 46z"/>'
    + '<ellipse cx="34" cy="38" rx="7" ry="10" transform="rotate(-20 34 38)" fill="#fff" fill-opacity=".55"/>'
    + '<path d="M62 28c10 5 16 13 18 23" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>'
    + '<path d="M14 66c8-4 16-6 24-6M62 60c8 0 16 2 24 6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity=".55"/>'],
  ["yut", "윷", "Yut sticks", 1,
    '<g><rect x="6" y="8" width="16" height="84" rx="8" transform="rotate(-8 14 50)"/><rect x="29" y="6" width="16" height="88" rx="8" transform="rotate(-3 37 50)"/>'
    + '<rect x="55" y="6" width="16" height="88" rx="8" transform="rotate(3 63 50)"/><rect x="78" y="8" width="16" height="84" rx="8" transform="rotate(8 86 50)"/></g>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"><path d="M14 32v36" transform="rotate(-8 14 50)"/>'
    + '<path d="M37 30v40" transform="rotate(-3 37 50)"/><path d="M63 30v40" transform="rotate(3 63 50)"/><path d="M86 32v36" transform="rotate(8 86 50)"/></g>'],
  ["kite", "연", "Kite", 1.15,
    '<path d="M18 6h64v50c0 20-16 34-32 34S18 76 18 56z"/>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="5"><path d="M50 8v80M20 8l60 48M80 8 20 56"/></g>'
    + '<circle cx="50" cy="44" r="13" fill="#fff" fill-opacity=".9"/>'
    + '<path d="M50 90c-12 8 12 14 0 22" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'],
  ["jegi", "제기", "Jegi", 1,
    '<path d="M38 78 24 10M46 76 42 6M54 76 58 6M62 78 76 10" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
    + '<ellipse cx="50" cy="82" rx="26" ry="14"/><ellipse cx="50" cy="74" rx="15" ry="8" fill="#fff" fill-opacity=".7"/>'],
  ["mask", "탈", "Korean mask", 1.05,
    '<path d="M50 6C28 6 14 22 14 46c0 30 16 54 36 54s36-24 36-54C86 22 72 6 50 6z"/>'
    + '<g fill="#fff"><ellipse cx="34" cy="46" rx="9" ry="6"/><ellipse cx="66" cy="46" rx="9" ry="6"/></g>'
    + '<path d="M30 70c8 13 32 13 40 0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>'
    + '<path d="M22 32c6-6 13-8 19-5M59 27c6-3 13-1 19 5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>'],
  ["carnation", "카네이션", "Carnation", 1.1,
    '<path d="M50 6 58 15l12-5-2 13h13l-6 11 12 6-10 8 7 11-13 2 1 12-12-4-10 9-10-9-12 4 1-12-13-2 7-11-10-8 12-6-6-11h13l-2-13 12 5z"/>'
    + '<circle cx="50" cy="42" r="11" fill="#fff" fill-opacity=".55"/>'
    + '<path d="M39 64h22l-5 16H44z"/><path d="M50 78v28" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
    + '<path d="M50 94c-14-8-24-4-26 3 9 7 20 5 26-3z"/>'],
  ["xmastree", "크리스마스트리", "Christmas tree", 1.15,
    '<path d="m50 2 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z"/>'
    + '<path d="M50 16 72 46H28zM50 36 82 72H18zM50 58 92 100H8z"/><rect x="41" y="100" width="18" height="12" rx="3"/>'
    + '<g fill="#fff" fill-opacity=".75"><circle cx="50" cy="40" r="4"/><circle cx="38" cy="64" r="4"/><circle cx="64" cy="66" r="4"/>'
    + '<circle cx="30" cy="92" r="4"/><circle cx="52" cy="86" r="4"/><circle cx="72" cy="94" r="4"/></g>'],
  ["santahat", "산타 모자", "Santa hat", 0.82,
    '<path d="M10 58c0-28 20-48 42-48 13 0 24 6 30 15-5 12-13 21-25 28-11 6-24 9-47 9z"/>'
    + '<rect x="2" y="56" width="76" height="20" rx="10"/><rect x="7" y="60" width="66" height="12" rx="6" fill="#fff" fill-opacity=".72"/>'
    + '<circle cx="84" cy="26" r="13"/><circle cx="84" cy="26" r="8" fill="#fff" fill-opacity=".72"/>'],
  ["stocking", "크리스마스 양말", "Christmas stocking", 1.15,
    '<path d="M28 20h44v40c0 10 4 16 12 20l6 3c11 5 10 21-3 25-14 4-34 1-46-9-10-8-13-18-13-30z"/>'
    + '<rect x="22" y="6" width="56" height="20" rx="9"/><rect x="26" y="10" width="48" height="13" rx="6" fill="#fff" fill-opacity=".85"/>'
    + '<path d="M36 88c14 8 34 8 48 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>'],
  ["pumpkin", "호박등", "Jack-o'-lantern", 1,
    '<path d="M42 24h16l2-16H40z"/><ellipse cx="50" cy="60" rx="46" ry="36"/>'
    + '<g fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="4"><path d="M26 34c-6 15-6 37 0 52M74 34c6 15 6 37 0 52"/></g>'
    + '<g fill="#fff" fill-opacity=".9"><path d="M28 42h18l-9 16zM72 42H54l9 16z"/>'
    + '<path d="M30 68h8l3 6 4-6h10l3 6 4-6h8c-2 12-11 20-20 20s-18-8-20-20z"/></g>']
];
const DIARY_ART_IDS = DIARY_ART.map(a => a[0]);
function diaryArtInfo(id){ return DIARY_ART.find(a => a[0] === id) || null; }
function diaryArtName(info){ return info ? (diaryIsEn() ? info[2] : info[1]) : ""; }
// 내장 그림 한 장의 SVG. 색은 currentColor 라 바깥 요소의 color 만 바꾸면 된다.
function diaryArtSvg(id, cls){
  const info = diaryArtInfo(id);
  if (!info) return "";
  return `<svg class="${cls || "diary-art"}" viewBox="0 0 100 ${Math.round(info[3] * 100)}" fill="currentColor"`
    + ` aria-hidden="true" focusable="false"${info[5] ? ' opacity=".55"' : ""}>${info[4]}</svg>`;
}

/* ---------- 글상자 스티커 ----------
   글자 크기를 종이 폭에 대한 비율로 둔다(그림 획과 같은 생각) — 그래야 창 폭이 바뀌어도, 인쇄 폭(680px)에서도
   줄바꿈 자리가 같다. 높이(ar)는 글에서 나오므로 파일에 저장하지 않고 그릴 때마다 재서 채운다. */
const DIARY_TEXT_ALIGNS = ["left", "center", "right"];
const DIARY_TEXT_SIZES = [["small", 0.034, "작게", "Small"], ["mid", 0.048, "보통", "Medium"], ["big", 0.072, "크게", "Large"]];
const DIARY_TEXT_MAX = 500;
const DIARY_STICKER_KINDS = ["photo", "art", "text"];
function diaryStickerKind(raw){
  const kind = String(raw && raw.kind || "");
  if (DIARY_STICKER_KINDS.includes(kind)) return kind;
  return raw && raw.art ? "art" : (raw && raw.text != null && !raw.asset) ? "text" : "photo";   // kind 가 없던 옛 파일
}
function diaryStickerId(){ return "st-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function diaryNormalizeSticker(raw, hasAsset){
  if (!raw || typeof raw !== "object") return null;
  const num = (v, lo, hi, dflt) => { const n = Number(v); return v === "" || v == null || !Number.isFinite(n) ? dflt : Math.max(lo, Math.min(hi, n)); };
  const kind = diaryStickerKind(raw);
  const base = {
    id:String(raw.id || "").slice(0, 60) || diaryStickerId(),
    kind,
    x:num(raw.x, -1, 2, 0.1),
    y:num(raw.y, -1, 60, 0.1),
    w:num(raw.w, 0.03, 1.5, 0.3),
    ar:num(raw.ar, 0.02, 50, 1),
    rot:diaryNormalizeAngle(num(raw.rot, -3600, 3600, 0)),
    flip:raw.flip === true
  };
  const color = DIARY_HEX_RE.test(String(raw.color || "")) ? String(raw.color).toLowerCase() : "";
  const opacity = num(raw.opacity, 0.1, 1, 1);
  if (kind === "art"){
    const info = diaryArtInfo(String(raw.art || ""));
    if (!info) return null;                                   // 모르는 그림은 버린다(앱이 그릴 수 없다)
    return { ...base, art:info[0], color:color || DIARY_ART_DEFAULT_COLOR, opacity, ar:num(raw.ar, 0.02, 50, info[3]) };
  }
  if (kind === "text"){
    const text = String(raw.text == null ? "" : raw.text).replace(/\r\n?/g, "\n").slice(0, DIARY_TEXT_MAX);
    if (!text.trim()) return null;                            // 빈 글상자는 남기지 않는다
    return { ...base, text, color:color || DIARY_TEXT_DEFAULT_COLOR, opacity,
      font:DIARY_FONTS.includes(raw.font) ? raw.font : "gothic",
      size:num(raw.size, 0.012, 0.3, 0.048),
      align:DIARY_TEXT_ALIGNS.includes(raw.align) ? raw.align : "left",
      w:num(raw.w, 0.03, 1.5, 0.4) };
  }
  const asset = String(raw.asset || "");
  if (!DIARY_ASSET_RE.test(asset) || (hasAsset && !hasAsset(asset))) return null;
  return { ...base, asset, ...(opacity < 1 ? { opacity } : {}) };
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
function diaryNormalizeTags(raw){
  const out = [], seen = new Set();
  for (const value of (Array.isArray(raw) ? raw : [])){
    const tag = String(value == null ? "" : value).replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, 24);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key); out.push(tag);
    if (out.length >= DIARY_MAX_TAGS) break;
  }
  return out;
}
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
    favorite:!!raw.favorite,
    tags:diaryNormalizeTags(raw.tags),
    drawing:(Array.isArray(raw.drawing) ? raw.drawing : []).slice(0, DIARY_MAX_STROKES).map(diaryNormalizeStroke).filter(Boolean),
    stickers
  };
}
function diaryEntryIsEmpty(entry){
  return !entry || (!String(entry.title || "").trim() && !String(entry.text || "").trim()
    && !(entry.stickers && entry.stickers.length) && !entry.style && !entry.weather && !entry.mood && !entry.favorite
    && !(entry.tags && entry.tags.length)
    && !(entry.drawing && entry.drawing.length));
}
function diaryEmpty(title){
  const now = Date.now();
  return { format:DIARY_FORMAT, version:DIARY_VERSION, title:String(title || "일기장").slice(0, 200),
    createdAt:now, updatedAt:now, style:diaryDefaultStyle(), printPlain:false, entries:[] };
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
    // 인쇄할 땐 배경 빼기 — 꾸미기와 달리 날짜별로 갈리지 않는다(한 번 인쇄에 여러 날이 함께 나가므로).
    printPlain:!!raw.printPlain,
    entries:[...byDate.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  };
}
function diaryCleanEntries(model){
  return (model.entries || []).filter(e => !diaryEntryIsEmpty(e))
    .slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    .map(e => ({ date:e.date, title:e.title || "", text:e.text || "", style:e.style || null,
      weather:e.weather || "", mood:e.mood || "", favorite:!!e.favorite, tags:diaryNormalizeTags(e.tags),
      drawing:(e.drawing || []).map(st => st.e ? { c:st.c, w:st.w, p:st.p, e:true } : { c:st.c, w:st.w, p:st.p }),
      stickers:(e.stickers || []).map(diaryCleanSticker).filter(Boolean) }));
}
// 스티커 한 장을 저장할 모양으로. 글상자의 높이(ar)는 글에서 나오므로 담지 않는다 —
// 담으면 창 폭에 따라 잰 값이 달라져 고치지도 않은 일기장이 '저장 안 됨'으로 보인다(diaryContentKey 가 이걸 읽는다).
function diaryCleanSticker(s){
  if (!s) return null;
  const kind = diaryStickerKind(s);
  const box = { id:s.id, x:s.x, y:s.y, w:s.w, rot:diaryNormalizeAngle(s.rot), flip:!!s.flip };
  if (kind === "art") return { ...box, kind:"art", art:s.art, color:s.color || DIARY_ART_DEFAULT_COLOR, opacity:s.opacity == null ? 1 : s.opacity, ar:s.ar };
  if (kind === "text"){
    if (!String(s.text || "").trim()) return null;
    return { ...box, kind:"text", text:s.text, color:s.color || DIARY_TEXT_DEFAULT_COLOR, opacity:s.opacity == null ? 1 : s.opacity,
      font:s.font || "gothic", size:s.size, align:s.align || "left", flip:false };
  }
  return { ...box, kind:"photo", asset:s.asset, ar:s.ar,
    ...(s.opacity != null && s.opacity < 1 ? { opacity:s.opacity } : {}) };
}
// 저장본과 같은지 가르는 열쇠 — 시각(updatedAt)은 빼야 저장 → 편집 → 되돌리기 뒤 다시 '깨끗'이 된다.
function diaryContentKey(model){
  return JSON.stringify({ title:model.title || "", style:model.style, printPlain:!!model.printPlain, entries:diaryCleanEntries(model) });
}
function diaryModelJson(model){
  return JSON.stringify({
    format:DIARY_FORMAT, version:DIARY_VERSION, title:model.title || "일기장",
    createdAt:model.createdAt || Date.now(), updatedAt:model.updatedAt || Date.now(),
    style:model.style, printPlain:!!model.printPlain, entries:diaryCleanEntries(model)
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
    for (const s of e.stickers) if (s.asset) used.add(s.asset);      // 내장 그림·글상자는 사진 바이트가 없다
  }
  return used;
}
function diaryEntryLabel(entry){
  if (!entry) return "";
  const title = String(entry.title || "").trim();
  if (title) return title;
  const line = String(entry.text || "").split("\n").map(s => s.trim()).find(Boolean);
  if (line) return line.length > 40 ? line.slice(0, 40) + "…" : line;
  // 본문이 비어도 글상자에 쓴 글이 있으면 그것을 이름으로 쓴다(종이에 보이는 글이니까).
  const boxed = diaryStickerText(entry).split("\n").map(s => s.trim()).find(Boolean);
  if (boxed) return boxed.length > 40 ? boxed.slice(0, 40) + "…" : boxed;
  if (entry.stickers && entry.stickers.length) return diaryStickerCountLabel(entry.stickers);
  if (entry.tags && entry.tags.length) return entry.tags.map(t => "#" + t).join(" ");
  if (entry.favorite) return diaryT("즐겨찾기한 날");
  const mood = diaryMoodInfo(entry.mood), weather = diaryWeatherInfo(entry.weather);
  if (mood || weather) return [diaryName(weather), diaryName(mood)].filter(Boolean).join(" · ");
  return diaryT("꾸미기만 한 날");
}
// 종이 위 글상자에 쓴 글을 모은 것 — 목록 이름·검색·통합 검색이 본문과 함께 읽는다.
function diaryStickerText(entry){
  return ((entry && entry.stickers) || []).filter(s => diaryStickerKind(s) === "text").map(s => String(s.text || "")).filter(Boolean).join("\n");
}
// "사진 2장 · 스티커 3개" — 갈래가 섞여 있으므로 사진만 세던 이름을 쪼갠다.
function diaryStickerCountLabel(stickers){
  const list = stickers || [];
  const photos = list.filter(s => diaryStickerKind(s) === "photo").length;
  const arts = list.filter(s => diaryStickerKind(s) === "art").length;
  return [photos && diaryTf("사진 {n}장", { n:photos }), arts && diaryTf("스티커 {n}개", { n:arts })].filter(Boolean).join(" · ")
    || diaryTf("스티커 {n}개", { n:list.length });
}
function diaryPlainText(model){
  return diaryCleanEntries(model).map(e => [diaryDateLabel(e.date), diaryWeatherMoodLabel(e), ...(e.tags || []).map(t => "#" + t), e.title, e.text, diaryStickerText(e)].filter(Boolean).join("\n")).join("\n\n");
}
function diaryEntryMatches(entry, query){
  const q = String(query || "").trim().toLowerCase();
  if (!q || !entry) return false;
  return [entry.date, diaryDateLabel(entry.date), diaryWeatherMoodLabel(entry), ...(entry.tags || []), entry.title, entry.text, diaryStickerText(entry)].join("\n").toLowerCase().includes(q);
}
// 검색·목록용 "날씨 맑음 · 기분 기쁨" — 그림 글자 없이 이름만.
function diaryWeatherMoodLabel(entry){
  const weather = diaryWeatherInfo(entry && entry.weather), mood = diaryMoodInfo(entry && entry.mood);
  return [weather && "날씨 " + weather[2], mood && "기분 " + mood[2]].filter(Boolean).join(" · ");
}

function diaryReviewStats(entries, year, month){
  const prefix = String(year) + "-" + String(month).padStart(2, "0") + "-";
  const rows = (entries || []).filter(e => e && e.date && e.date.startsWith(prefix) && !diaryEntryIsEmpty(e));
  const mood = new Map(), weather = new Map(), words = new Map();
  let photos = 0;
  const skip = new Set(["그리고", "하지만", "오늘", "정말", "너무", "있는", "했다", "하는", "the", "and", "was", "that"]);
  for (const e of rows){
    if (e.mood) mood.set(e.mood, (mood.get(e.mood) || 0) + 1);
    if (e.weather) weather.set(e.weather, (weather.get(e.weather) || 0) + 1);
    photos += (e.stickers || []).length;
    const tokens = (String(e.title || "") + " " + String(e.text || "")).toLocaleLowerCase();
    for (const token of tokens.match(/[가-힣]{2,}|[a-z]{3,}/g) || []){
      if (!skip.has(token)) words.set(token, (words.get(token) || 0) + 1);
    }
  }
  const days = rows.map(e => Number(e.date.slice(8, 10))).sort((a, b) => a - b);
  let longest = 0, run = 0, previous = -2;
  for (const day of days){ run = day === previous + 1 ? run + 1 : 1; longest = Math.max(longest, run); previous = day; }
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  return {
    count:rows.length, photos, longest,
    favorite:rows.filter(e => e.favorite).length,
    mood:top(mood), weather:top(weather),
    words:[...words.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
  };
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

/* ---------- 사진 여러 장 정렬 ----------
   좌표 단위는 스티커와 같다 — x·y·w 모두 '종이 폭에 대한 비율'이다(높이도 폭으로 나눈 값). 그래서
   한 번 정렬해 두면 창 폭이 바뀌어도, 인쇄 폭(680px)에서도 같은 모양으로 남는다.
   배열 순서 = 쌓는 순서이므로 들어온 순서 그대로 왼쪽→오른쪽, 위→아래로 깐다.
   '사진첩처럼'의 흔들림도 Math.random 을 쓰지 않는다 — 같은 입력이 늘 같은 자리라야
   되돌리기로 돌아온 모양이 달라지지 않고 시험도 값을 짚을 수 있다. */
const DIARY_ARRANGE_MODES = ["row", "grid", "scatter"];
const DIARY_ARRANGE_GAP = 0.02;            // 사진 사이 틈(종이 폭 비율)
const DIARY_ARRANGE_ROW_H = 0.28;          // '줄 맞춰 깔기' 한 줄의 목표 높이
const DIARY_ARRANGE_MIN_W = 0.05;
const DIARY_ARRANGE_MAX_COLS = 6;
const diaryArrangeAr = (s) => Math.max(0.05, Math.min(20, Number(s && s.ar) || 1));
// 한 줄에 담은 것들을 같은 높이로 맞췄을 때 그 높이. 폭을 h/ar 로 잡으면 줄이 usable 을 꼭 채운다.
function diaryArrangeRowHeight(items, usable, gap){
  const inv = items.reduce((sum, s) => sum + 1 / diaryArrangeAr(s), 0);
  return Math.max(0.01, (usable - gap * (items.length - 1)) / Math.max(0.05, inv));
}
// 줄 맞춰 깔기 — 같은 높이로 한 줄을 채우고, 한 장 더 넣어 목표 높이보다 낮아지면 줄을 바꾼다.
function diaryArrangeRows(items, o){
  const out = [];
  const rowH = o.rowH || DIARY_ARRANGE_ROW_H;
  let row = [], y = o.top;
  // full=true 인 줄은 usable 을 꼭 채운다. 마지막 줄은 늘리지 않는다 —
  // 한 장만 남았다고 종이 폭을 다 먹으면 정렬이 아니라 확대가 된다.
  const flush = (full) => {
    if (!row.length) return;
    const fit = diaryArrangeRowHeight(row, o.usable, o.gap);
    const h = full ? fit : Math.min(fit, rowH);
    let x = o.left;
    for (const s of row){
      const w = Math.max(DIARY_ARRANGE_MIN_W, h / diaryArrangeAr(s));
      out.push({ id:s.id, x, y, w, ar:diaryArrangeAr(s), rot:0 });
      x += w + o.gap;
    }
    y += h + o.gap;
    row = [];
  };
  for (const s of items){
    row.push(s);
    if (diaryArrangeRowHeight(row, o.usable, o.gap) <= rowH) flush(true);
  }
  flush(false);
  return out;
}
function diaryArrangeAutoCols(n){ return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4; }
// 격자로 깔기 — 폭을 똑같이 맞춘 칸에 넣고, 줄 높이는 그 줄에서 가장 높은 사진에 맞춘다(세로 가운데).
function diaryArrangeGridPlaces(items, o){
  const n = items.length;
  const asked = Math.round(Number(o.cols) || 0);
  const cols = Math.max(1, Math.min(n, DIARY_ARRANGE_MAX_COLS, asked || diaryArrangeAutoCols(n)));
  const w = Math.max(DIARY_ARRANGE_MIN_W, (o.usable - o.gap * (cols - 1)) / cols);
  const out = [];
  let y = o.top;
  for (let i = 0; i < n; i += cols){
    const row = items.slice(i, i + cols);
    const rowH = Math.max(...row.map(s => w * diaryArrangeAr(s)));
    row.forEach((s, k) => {
      const h = w * diaryArrangeAr(s);
      out.push({ id:s.id, x:o.left + k * (w + o.gap), y:y + (rowH - h) / 2, w, ar:diaryArrangeAr(s), rot:0 });
    });
    y += rowH + o.gap;
  }
  return out;
}
// 사진첩처럼 — 격자 자리에서 조금씩 어긋내고 살짝 기울인다. 값은 순번으로 정해 늘 같다.
function diaryArrangeScatter(items, o){
  return diaryArrangeGridPlaces(items, { ...o, gap:o.gap * 0.5 }).map((p, i) => ({
    id:p.id, ar:p.ar, w:p.w,
    x:p.x + (((i * 7) % 5) - 2) * 0.006,
    y:p.y + (((i * 11) % 5) - 2) * 0.006,
    rot:(((i * 5) % 9) - 4) * 1.5
  }));
}
/* 스티커 여러 장의 새 자리를 셈한다 — [{ id, x, y, w, rot }]. 모델을 고치지는 않는다(부르는 쪽이 넣는다).
   opts: top(맨 위 자리) · left/right 또는 usable(쓸 폭) · gap · cols(격자 열 수) · rowH */
function diaryArrangeStickers(list, mode, opts){
  const items = (list || []).filter(s => s && Number(s.ar) > 0);
  if (!items.length) return [];
  const o = opts || {};
  const gap = o.gap == null ? DIARY_ARRANGE_GAP : Math.max(0, Number(o.gap) || 0);
  const left = o.left == null ? 0.04 : Number(o.left) || 0;
  const usable = Math.max(0.2, o.usable != null ? Number(o.usable) : (o.right == null ? 1 - left * 2 : Number(o.right) - left));
  const base = { left, usable, gap, top:o.top == null ? 0.04 : Math.max(0, Number(o.top) || 0), cols:o.cols, rowH:o.rowH };
  if (mode === "grid") return diaryArrangeGridPlaces(items, base);
  if (mode === "scatter") return diaryArrangeScatter(items, base);
  return diaryArrangeRows(items, base);
}
/* 그림 칸 같은 네모 안에 여러 장 나눠 맞추기 — 칸(비율 단위)을 넘지 않는 가장 큰 배치를 고른다.
   열 수를 1..n 까지 넣어 보고 사진 한 장이 가장 커지는 쪽(배율÷열 수)을 쓴다. 한 열로 길게 세우는 것과
   한 줄로 늘어놓는 것 가운데 어느 쪽이 큰지는 칸 모양에 따라 달라서 미리 고를 수가 없다. */
function diaryArrangeInBox(list, box, opts){
  const items = (list || []).filter(s => s && Number(s.ar) > 0);
  if (!items.length || !box || !(box.width > 0) || !(box.height > 0)) return [];
  const o = opts || {};
  const pad = o.pad == null ? 0.01 : Math.max(0, Number(o.pad) || 0);
  const area = { left:box.left + pad, top:box.top + pad,
    width:Math.max(0.02, box.width - pad * 2), height:Math.max(0.02, box.height - pad * 2) };
  const gap = o.gap == null ? DIARY_ARRANGE_GAP : Math.max(0, Number(o.gap) || 0);
  let best = null;
  for (let cols = 1; cols <= Math.min(items.length, DIARY_ARRANGE_MAX_COLS); cols++){
    // 폭 1 을 기준으로 깔아 보고, 칸에 들어가게 줄이는 배율을 잰다(격자라 블록 폭은 늘 1 이다).
    const places = diaryArrangeGridPlaces(items, { left:0, top:0, usable:1, gap, cols });
    const blockH = Math.max(...places.map(p => p.y + p.w * p.ar));
    const scale = blockH > 0 ? Math.min(area.width, area.height / blockH) : area.width;
    const score = scale / cols;
    if (!best || score > best.score) best = { places, blockH, scale, score };
  }
  const s = best.scale;
  const offX = area.left + Math.max(0, (area.width - s) / 2);
  const offY = area.top + Math.max(0, (area.height - best.blockH * s) / 2);
  return best.places.map(p => ({ id:p.id, x:offX + p.x * s, y:offY + p.y * s, w:Math.max(0.02, p.w * s), ar:p.ar, rot:0 }));
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
  const padLeft = lines === "ruled" || lines === "list" ? 64 : (lines === "blank" || lines === "picture") ? 40 : gap * 2;
  const fontSize = Math.round((DIARY_FONT_SIZES[style && style.gap] || 16) * diaryFontScale(style && style.font));
  const lift = Math.max(0, Math.round(gap / 2 - fontSize * 0.62));
  const box = lines === "picture" ? diaryPictureBox(style, width) : null;
  const padTop = box ? gap + box.height + gap : gap;
  return { gap, lines, padTop, padLeft, padRight:32, fontSize, lift, box };
}
function diaryLineBackground(style){
  const { gap, lines, lift } = diaryLineMetrics(style);
  const line = "var(--diary-line)";
  const light = "color-mix(in srgb, var(--diary-line) 60%, transparent)";
  const rule = `linear-gradient(to bottom, transparent ${gap - 1}px, ${line} ${gap - 1}px, ${line} ${gap}px)`;
  const guide = (at) => `linear-gradient(to bottom, transparent ${at - 1}px, ${light} ${at - 1}px, ${light} ${at}px, transparent ${at}px)`;
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
  if (lines === "double" || lines === "triple"){
    const at = lines === "double" ? [Math.round(gap / 2)] : [Math.round(gap / 3), Math.round(gap * 2 / 3)];
    const images = [rule, ...at.map(guide)];
    return { image:images.join(", "), size:images.map(() => `100% ${gap}px`).join(", "),
      position:images.map(() => `0 ${-lift}px`).join(", "), repeat:images.map(() => "repeat").join(", ") };
  }
  if (lines === "dashed"){
    return { image:`radial-gradient(ellipse 3px 1px at 4px ${gap - 1}px, ${line} 98%, transparent 100%)`,
      size:`10px ${gap}px`, position:`0 ${-lift}px`, repeat:"repeat" };
  }
  if (lines === "list"){
    return { image:`radial-gradient(circle at 28px ${Math.round(gap / 2)}px, var(--diary-dot) 3px, transparent 3.5px), ${rule}`,
      size:`100% ${gap}px, 100% ${gap}px`, position:`0 ${-lift}px, 0 ${-lift}px`, repeat:"repeat, repeat" };
  }
  if (lines === "columns"){
    return { image:`linear-gradient(to right, transparent ${gap * 4 - 1}px, ${light} ${gap * 4 - 1}px, ${light} ${gap * 4}px)`,
      size:`${gap * 4}px 100%`, position:"0 0", repeat:"repeat" };
  }
  if (lines === "crosses"){
    return { image:`radial-gradient(ellipse 4px 0.8px at 50% 50%, var(--diary-dot) 98%, transparent 100%), radial-gradient(ellipse 0.8px 4px at 50% 50%, var(--diary-dot) 98%, transparent 100%)`,
      size:`${gap}px ${gap}px, ${gap}px ${gap}px`, position:`0 ${-lift}px, 0 ${-lift}px`, repeat:"repeat, repeat" };
  }
  if (lines === "staff"){
    const marks = [1, 2, 3, 4, 5].map(n => guide(Math.round(gap * n / 6)));
    return { image:marks.join(", "), size:marks.map(() => `100% ${gap}px`).join(", "),
      position:marks.map(() => `0 ${-lift}px`).join(", "), repeat:marks.map(() => "repeat").join(", ") };
  }
  if (lines === "diagonal"){
    const step = gap * 2;
    return { image:`repeating-linear-gradient(60deg, transparent 0, transparent ${step - 1}px, ${light} ${step - 1}px, ${light} ${step}px), repeating-linear-gradient(-60deg, transparent 0, transparent ${step - 1}px, ${light} ${step - 1}px, ${light} ${step}px)`,
      size:"auto, auto", position:"0 0, 0 0", repeat:"repeat, repeat" };
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

/* 종이 배경 효과 — 편집기·인쇄·꾸미기 창 견본이 모두 이 한 함수로 그린다(줄 무늬와 같은 방식).
   '진하기'는 색을 종이색과 얼마나 섞느냐만 움직인다. 그래서 어떤 효과를 골라도 글자가 읽히는 선을 넘지 않는다. */
function diaryPaperBackground(style){
  const kind = style && DIARY_PAPERS.includes(style.paper) ? style.paper : "none";
  const off = { kind:"none", image:"none", size:"auto", position:"0 0", repeat:"no-repeat", color:"transparent" };
  if (kind === "none") return off;
  const c = style && DIARY_HEX_RE.test(String(style.paperColor || "")) ? String(style.paperColor) : DIARY_PAPER_DEFAULT_COLOR;
  const raw = Number(style.paperTone);
  const t = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
  // pct% 만큼 고른 색, 나머지는 종이색 — 0% 면 종이 그대로다.
  const blend = (color, pct) => `color-mix(in srgb, ${color} ${Math.round(Math.max(0, Math.min(100, pct)))}%, var(--diary-paper))`;
  const mix = (pct) => blend(c, pct);
  // 이웃 색 — 고른 색을 분홍·연두 쪽으로 살짝 굴린다(한 색만으로는 메시·원뿔형이 밋밋하다).
  const turn = (other, pct) => `color-mix(in srgb, ${other} ${pct}%, ${c})`;
  const made = (image, extra) => Object.assign({ kind, image, size:"auto", position:"0 0", repeat:"no-repeat", color:"transparent" }, extra || {});
  if (kind === "solid") return made("none", { color:mix(9 + 42 * t) });
  if (kind === "linear") return made(`linear-gradient(160deg, ${mix(5 + 26 * t)} 0%, ${mix(24 + 56 * t)} 100%)`);
  if (kind === "radial") return made(`radial-gradient(130% 92% at 50% 2%, ${mix(28 + 54 * t)} 0%, ${mix(3 + 14 * t)} 74%)`);
  if (kind === "conic"){
    return made(`conic-gradient(from 212deg at 50% 45%, ${mix(26 + 46 * t)}, ${mix(5 + 14 * t)}, `
      + `${blend(turn("#f472b6", 45), 22 + 44 * t)}, ${mix(4 + 12 * t)}, ${mix(26 + 46 * t)})`);
  }
  if (kind === "mesh"){
    return made(`radial-gradient(62% 58% at 12% 14%, ${blend(turn("#f472b6", 52), 32 + 48 * t)} 0%, transparent 62%), `
      + `radial-gradient(58% 55% at 88% 10%, ${mix(30 + 50 * t)} 0%, transparent 60%), `
      + `radial-gradient(66% 62% at 80% 92%, ${blend(turn("#34d399", 52), 28 + 46 * t)} 0%, transparent 64%), `
      + `radial-gradient(60% 56% at 8% 92%, ${mix(22 + 42 * t)} 0%, transparent 62%)`);
  }
  if (kind === "pattern"){
    return made(`radial-gradient(circle, ${mix(40 + 45 * t)} 1.5px, transparent 1.9px)`,
      { size:"18px 18px", repeat:"repeat", color:mix(3 + 9 * t) });
  }
  if (kind === "glass"){
    // 유리 — backdrop-filter 는 인쇄에서 사라지므로 쓰지 않는다. 번진 색 덩어리 위에 종이색 반투명 판을 덮어
    // '서리 낀 유리'를 그림만으로 만든다(화면과 인쇄가 똑같이 나온다).
    const sheen = (pct) => `color-mix(in srgb, var(--diary-paper) ${Math.round(pct)}%, transparent)`;
    return made(`linear-gradient(135deg, ${sheen(62 - 18 * t)} 0%, ${sheen(26 - 10 * t)} 44%, ${sheen(52 - 16 * t)} 100%), `
      + `radial-gradient(58% 52% at 16% 14%, ${blend(turn("#f472b6", 48), 46 + 42 * t)} 0%, transparent 66%), `
      + `radial-gradient(62% 56% at 86% 20%, ${mix(42 + 44 * t)} 0%, transparent 64%), `
      + `radial-gradient(72% 62% at 60% 98%, ${blend(turn("#22d3ee", 48), 40 + 42 * t)} 0%, transparent 68%)`);
  }
  if (kind === "noise"){
    // 거친 질감 — feTurbulence 로 만든 회색 알갱이를 타일로 깐다(그림 파일이 아니라 그리는 무늬라 파일이 늘지 않는다).
    const op = (0.07 + 0.2 * t).toFixed(3);
    const grain = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E`
      + `%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E`
      + `%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E`
      + `%3Crect width='160' height='160' filter='url(%23g)' opacity='${op}'/%3E%3C/svg%3E")`;
    return made(`${grain}, linear-gradient(168deg, ${mix(6 + 22 * t)} 0%, ${mix(20 + 40 * t)} 100%)`,
      { size:"160px 160px, auto", repeat:"repeat, no-repeat" });
  }
  if (kind === "aurora"){
    // 오로라 — 종이색 자체가 밤하늘로 바뀌어 있다(CSS 의 --diary-paper 덮어쓰기). 여기 섞음은 그 밤하늘을 바탕으로 한다.
    return made(`radial-gradient(74% 56% at 18% 6%, ${blend(turn("#22d3ee", 55), 44 + 38 * t)} 0%, transparent 70%), `
      + `radial-gradient(66% 52% at 80% 2%, ${blend(turn("#a855f7", 55), 40 + 38 * t)} 0%, transparent 68%), `
      + `radial-gradient(96% 62% at 52% 106%, ${mix(26 + 36 * t)} 0%, transparent 72%)`,
      { color:mix(6 + 12 * t) });
  }
  // 비네트 — 가장자리로 갈수록 어둡게. 고른 색을 검푸른 쪽으로 굴려 '어두워진다'는 느낌을 낸다.
  return made(`radial-gradient(118% 96% at 50% 42%, transparent 44%, ${blend(turn("#0f172a", 46), 38 + 52 * t)} 100%)`,
    { color:mix(2 + 8 * t) });
}
// 층 하나에 배경 효과를 칠한다 — 편집기 종이·인쇄 종이·견본 칩이 모두 이것을 부른다.
function diaryPaintPaper(el, style){
  const p = diaryPaperBackground(style);
  Object.assign(el.style, { backgroundImage:p.image, backgroundSize:p.size, backgroundPosition:p.position, backgroundRepeat:p.repeat,
    backgroundColor:p.color === "transparent" ? "" : p.color });
  el.dataset.paper = p.kind;
  return p;
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

/* 팔레트 밖 색을 고르는 칸 — 그리기 바와 스티커 창이 같은 물건을 쓴다.
   색 고르개를 끄는 동안 input 이 쉴 새 없이 뜨므로(그대로 기록하면 되돌리기가 한 걸음씩 쌓인다)
   끄는 중(live=true)과 확정(change)을 갈라 알린다. */
function diaryColorInput(className, onPick){
  const input = document.createElement("input");
  input.type = "color";
  input.className = className;
  input.addEventListener("input", () => onPick(String(input.value || "").toLowerCase(), true));
  input.addEventListener("change", () => onPick(String(input.value || "").toLowerCase(), false));
  return input;
}

/* ===== 종이 한 장(일기장·여행일지 공용) =====
   els = 이미 만들어 둔 층 14개 · ctx = 바깥이 내주는 것 23개 · 돌려주는 것 27개.
   DOM 뼈대를 만드는 일은 부르는 쪽이 하고 여기는 '행동'만 붙인다 — 여행일지(.trip)가 같은 종이를 쓰되
   달력이 아니라 여정 띠를 두르기 때문이다. 바뀌는 값(날짜·되돌리기·펜)은 ctx 의 창구로 그때그때 읽는다. */
function mountDiaryPaper(els, paperEnv){
  const { paper, area, bgLayer, veilLayer, genkoLayer, genkoCaret, genkoGrid, stickerLayer, artBgLayer, drawLayer, drawCanvas, pictureBox, pictureHint, main } = els;
  const { model, assets, assetUrl, currentLabel, ensureEntry, entryOf, onDrawModeChange, onEntryChange, onStickerSelect, openStickerColorPicker, refreshCurrentLabel, refreshDirty, renderCalendar, repaintCardPapers, scheduleRecovery, setStatus, syncDrawBar, syncPanel, touch, translateUi } = paperEnv;
  /* ----- 종이 ----- */
  // 고른 스티커는 종이의 것이다. 바깥은 selectionIds()·clearSelection() 으로만 본다.
  let selection = [];
  let paperWidth = 0;
  function applyStyle(){
    const entry = entryOf(paperEnv.current());
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
    // 배경 효과는 종이에도 표시를 남긴다 — 어두운 효과가 글자·줄 색을 갈아끼우려면 종이 쪽 선택자가 필요하다.
    paper.dataset.paper = diaryPaintPaper(artBgLayer, style).kind;
    const url = assetUrl(style.bg);
    bgLayer.style.backgroundImage = url ? `url("${url}")` : "none";
    bgLayer.dataset.fit = style.fit;
    bgLayer.hidden = !url;
    veilLayer.hidden = !url;
    veilLayer.style.opacity = String(style.veil);
    repaintCardPapers();
    syncPanel();
  }
  // 종이 높이 = 글 높이·스티커 아래 끝·최소 한 쪽 중 큰 값(줄 간격의 배수로 맞춰 마지막 줄이 잘리지 않게).
  function layout(){
    const width = paper.clientWidth;
    if (!width) return;
    paperWidth = width;
    measureTextStickers(width);            // 글상자 높이를 먼저 채워야 아래의 stickerBottom 이 맞는다
    const effective = diaryEffectiveStyle(model, entryOf(paperEnv.current()));
    if (diaryUsesGenko(effective)){ layoutGenko(width, effective); positionStickers(); return; }
    const m = diaryLineMetrics(effective, width);
    area.style.paddingTop = m.padTop + "px";
    placePictureBox(m);
    const top = main.scrollTop;
    area.style.height = "0px";
    const textH = area.scrollHeight;
    let stickerBottom = 0;
    const entry = entryOf(paperEnv.current());
    for (const s of (entry ? entry.stickers : [])) stickerBottom = Math.max(stickerBottom, diaryStickerBottom(s) * width);
    const minH = m.gap * 24;
    const height = Math.ceil(Math.max(textH, stickerBottom + m.gap * 2, minH) / m.gap) * m.gap;
    area.style.height = height + "px";
    main.scrollTop = top;
    positionStickers();
  }
  /* 글상자 높이는 글에서 나온다 — 파일에 담지 않고 그릴 때마다 잰다.
     글자 크기가 종이 폭에 대한 비율이라 어느 폭에서도 줄바꿈 자리가 같고, 잰 높이를 ar 에 채워 두면
     종이 길이(layout)·인쇄가 사진과 똑같은 식으로 잰다. 재기는 종이 길이를 셈하기 전에 끝나야 한다. */
  function measureTextStickers(w){
    const entry = entryOf(paperEnv.current());
    if (!w || !entry) return;
    for (const node of stickerLayer.children){
      if (node.dataset.kind !== "text") continue;
      const s = entry.stickers.find(item => item.id === node.dataset.id);
      const body = s && node.querySelector(".diary-sticker-body");
      if (!body) continue;
      node.style.width = (s.w * w) + "px";
      node.style.height = "auto";
      body.style.fontSize = (s.size * w) + "px";
      body.style.fontFamily = DIARY_FONT_STACKS[s.font] || "";
      body.style.color = s.color || DIARY_TEXT_DEFAULT_COLOR;
      body.style.textAlign = s.align || "left";
      const h = node.offsetHeight;
      if (h > 0) s.ar = h / Math.max(1, s.w * w);
    }
  }
  function positionStickers(){
    const w = paperWidth || paper.clientWidth;
    measureTextStickers(w);
    for (const node of stickerLayer.children){
      const entry = entryOf(paperEnv.current());
      const s = entry && entry.stickers.find(item => item.id === node.dataset.id);
      if (!s) continue;
      node.style.left = (s.x * w) + "px";
      node.style.top = (s.y * w) + "px";
      node.style.width = (s.w * w) + "px";
      // 글상자만 높이를 글에 맡긴다(measureTextStickers 가 이미 auto 로 두고 잰 뒤다).
      if (node.dataset.kind !== "text") node.style.height = (s.w * s.ar * w) + "px";
      node.style.transform = s.rot ? `rotate(${s.rot}deg)` : "";
      const body = node.querySelector(".diary-sticker-body");
      if (body && node.dataset.kind !== "text") body.style.transform = s.flip ? "scaleX(-1)" : "";
    }
    // 사진이나 그림이 있으면 안내 문장만 감추고 가운데 아이콘은 남긴다.
    // 오른쪽 위에 별도 연필 단추를 두지 않으므로, 이 아이콘이 다시 그리기로 들어가는 길이기도 하다.
    if (!pictureBox.hidden){
      const entry = entryOf(paperEnv.current());
      const box = pictureBoxRect();
      const hasContent = !!(entry && entry.drawing && entry.drawing.length) || !!(box && entry && entry.stickers.some(st => {
        const cx = (st.x + st.w / 2) * w, cy = (st.y + st.w * st.ar / 2) * w;
        return cx >= box.left && cx <= box.left + box.width && cy >= box.top && cy <= box.top + box.height;
      }));
      pictureHint.hidden = drawMode;
      pictureHint.classList.toggle("is-compact", hasContent);
    }
  }
  let genkoLay = null, genkoGm = null;
  function layoutGenko(width, style){
    placePictureBox(diaryLineMetrics(style, width));
    const gm = diaryGenkoMetrics(style, width);
    const lay = diaryGenkoLayout(area.value, gm.cols);
    const entry = entryOf(paperEnv.current());
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
    layoutGenko(paperWidth || paper.clientWidth, diaryEffectiveStyle(model, entryOf(paperEnv.current())));
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
    const m = diaryLineMetrics(diaryEffectiveStyle(model, entryOf(paperEnv.current())), paperWidth || paper.clientWidth);
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

  /* ----- 본문 입력·떨어뜨리기 -----
     종이의 textarea·종이 판을 듣는 자리라 종이 구역 안에 둔다. 바깥 창·바에는 되부름으로만 알린다. */
  area.addEventListener("input", () => {
    const entry = ensureEntry(paperEnv.current());
    const wasEmpty = diaryEntryIsEmpty(entry);
    entry.text = area.value;
    layout();
    onEntryChange();
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
  if (typeof attachTextCaseContextMenu === "function") attachTextCaseContextMenu(area,
    { contextMenuActions:paperEnv.contextMenuActions });
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

  /* ----- 그림 칸 그리기 ----- */
  let drawMode = false;
  function setDrawMode(on){
    drawMode = !!on && !pictureBox.hidden;
    paper.classList.toggle("is-drawing", drawMode);
    onDrawModeChange(drawMode);
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
    const entry = entryOf(paperEnv.current());
    diaryDrawStrokes(ctx, entry ? entry.drawing : [], bw);
  }
  drawCanvas.addEventListener("pointerdown", (e) => {
    if (!drawMode || e.button !== 0) return;
    e.preventDefault();
    const rect = drawCanvas.getBoundingClientRect();
    const bw = rect.width || 1;
    const size = (DIARY_PEN_SIZES.find(x => x[0] === paperEnv.penSize()) || DIARY_PEN_SIZES[1])[1];
    const stroke = { c:paperEnv.penColor(), w:paperEnv.eraser() ? size * 2.5 : size, p:[] };
    if (paperEnv.eraser()) stroke.e = true;
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
      if (paperEnv.history()) paperEnv.history().flush();
      const entry = ensureEntry(paperEnv.current());
      if (!Array.isArray(entry.drawing)) entry.drawing = [];
      if (entry.drawing.length >= DIARY_MAX_STROKES){ setStatus(diaryT("그림이 너무 많아 더 그릴 수 없어요.")); redrawDrawing(); return; }
      entry.drawing.push(stroke);
      redrawDrawing();
      onEntryChange();
      renderCalendar();
      syncDrawBar();
      touch(true);
    };
    drawCanvas.addEventListener("pointermove", move);
    drawCanvas.addEventListener("pointerup", up);
    drawCanvas.addEventListener("pointercancel", up);
  });
  function renderStickers(){
    const entry = entryOf(paperEnv.current());
    const list = entry ? entry.stickers : [];
    selection = selection.filter(id => list.some(s => s.id === id));
    // 다시 그리면 스티커 요소가 새로 생겨 포커스가 빠진다 — 같은 스티커에 되돌려야 방향키·단축키가 이어진다.
    const focusedId = document.activeElement && stickerLayer.contains(document.activeElement)
      ? document.activeElement.dataset.id : "";
    // 글상자에 손글씨 글꼴을 골랐으면 미리 읽어 둔다 — 다 읽으면 줄바꿈 자리가 달라지므로 다시 재야 한다.
    const handFonts = [...new Set(list.filter(s => diaryStickerKind(s) === "text").map(s => s.font))].filter(f => DIARY_HAND_FONTS[f]);
    if (handFonts.length) Promise.all(handFonts.map(diaryEnsureFont)).then(() => { if (stickerLayer.isConnected) layout(); });
    stickerLayer.replaceChildren(...list.map(s => {
      const kind = diaryStickerKind(s);
      const node = document.createElement("div");
      node.className = "diary-sticker diary-sticker-is-" + kind + (selection.includes(s.id) ? " is-selected" : "");
      node.dataset.id = s.id;
      node.dataset.kind = kind;
      node.tabIndex = 0;
      node.setAttribute("role", kind === "text" ? "group" : "img");
      node.setAttribute("aria-label", kind === "text"
        ? "글상자 — 두 번 누르면 고쳐 쓰기, 끌어서 옮기기, 모서리로 너비, 우클릭으로 글자 크기·맞춤"
        : kind === "art"
          ? "붙인 스티커 — 끌어서 옮기기, 모서리로 크기, 위 손잡이로 돌리기, 우클릭으로 순서·색"
          : "붙인 사진 — 끌어서 옮기기, 두 번 누르면 크게 보기, Alt+누르기로 겹친 것 고르기, 우클릭으로 정렬·순서");
      let body;
      if (kind === "art"){
        body = document.createElement("span");
        body.className = "diary-sticker-body diary-sticker-art";
        body.innerHTML = diaryArtSvg(s.art);                       // 앱이 만든 고정 SVG 표에서만 나온다(사용자 입력 아님)
        body.style.color = s.color || DIARY_ART_DEFAULT_COLOR;
      } else if (kind === "text"){
        body = document.createElement("div");
        body.className = "diary-sticker-body diary-sticker-text";
        body.textContent = s.text;                                  // 글은 반드시 textContent 로(HTML 로 새지 않게)
      } else {
        body = document.createElement("img");
        body.className = "diary-sticker-body";
        body.src = assetUrl(s.asset);
        body.alt = "";
        body.draggable = false;
      }
      body.style.opacity = String(s.opacity == null ? 1 : s.opacity);
      const handle = document.createElement("span");
      handle.className = "diary-sticker-handle";
      handle.title = kind === "text" ? "너비 바꾸기" : "크기 바꾸기";
      const rotor = document.createElement("span");
      rotor.className = "diary-sticker-rotate";
      rotor.title = "돌리기 (Shift: 15°씩)";
      const remove = diaryButton("", kind === "photo" ? "사진 떼기" : "스티커 떼기", "diary-sticker-remove", "close");
      remove.addEventListener("pointerdown", e => e.stopPropagation());
      remove.addEventListener("click", (e) => { e.stopPropagation(); removeSticker(s.id); });
      const more = diaryButton("", "순서·돌리기·뒤집기", "diary-sticker-more", "more");
      more.addEventListener("pointerdown", e => e.stopPropagation());
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = more.getBoundingClientRect();
        openStickerMenu(s.id, r.left, r.bottom + 4);
      });
      node.append(body, handle, rotor, remove, more);
      if (kind === "text"){
        node.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); editTextSticker(s.id); });
        node.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.target !== node) return;
          e.preventDefault(); e.stopPropagation(); editTextSticker(s.id);
        });
      }
      if (kind === "photo"){
        // 두 번 누르면 크게 보기 — 종이 위에서는 작게 붙여 두고도 그 날 사진을 큰 창에서 넘겨 볼 수 있다.
        node.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); openPhotoViewer(s.id); });
        node.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.target !== node) return;
          e.preventDefault(); e.stopPropagation(); openPhotoViewer(s.id);
        });
      }
      node.addEventListener("pointerdown", (e) => {
        if (node.classList.contains("is-editing")) return;       // 고쳐 쓰는 중엔 끌기가 글칸 누르기를 가로채면 안 된다
        // Alt+누르기는 끌지 않고 '아래 것'으로 넘어간다 — 겹쳐 놓은 사진 속에서 가린 것을 골라내는 길.
        if (e.button === 0 && e.altKey && e.target !== handle && e.target !== rotor){
          e.preventDefault(); e.stopPropagation();
          cycleStickerAt(e);
          return;
        }
        startStickerDrag(e, s, node, e.target === handle ? "resize" : e.target === rotor ? "rotate" : "move");
      });
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
    onStickerSelect();                                // 고른 것의 색·투명도를 스티커 창에 비춘다
  }
  function setSelection(ids){
    const before = selection.join("|");
    selection = [...new Set(ids.filter(Boolean))];
    if (selection.join("|") === before) return;
    syncSelection();
    if (selection.length > 1) setStatus(diaryTf("스티커 {n}개를 골랐어요 — 함께 옮기고 돌리고 뗄 수 있어요", { n:selection.length }));
  }
  function selectSticker(id){ setSelection(id ? [id] : []); }
  function toggleSticker(id){
    setSelection(selection.includes(id) ? selection.filter(x => x !== id) : [...selection, id]);
  }
  const selectedStickers = () => {
    const entry = entryOf(paperEnv.current());
    return entry ? entry.stickers.filter(s => selection.includes(s.id)) : [];
  };
  const clampStickerPos = (s) => {
    s.x = Math.max(-s.w * 0.6, Math.min(1 - s.w * 0.4, s.x));
    s.y = Math.max(-0.02, s.y);
  };
  /* 누른 자리에 걸친 스티커들 — 위에 있는 것부터. 돌린 것은 돌리기 전 상자로 잰다(네모 고르기와 같은 규칙).
     배열 순서가 쌓는 순서이므로 뒤에서부터 보면 위에 있는 것이 먼저다. */
  function stickersAtPoint(px, py){
    const entry = entryOf(paperEnv.current());
    if (!entry) return [];
    return entry.stickers.filter(s => px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.w * s.ar).reverse();
  }
  /* Alt+누르기 = 겹친 자리에서 아래 것으로 한 칸씩 내려가며 고르기(맨 아래 다음은 다시 맨 위).
     사진을 여러 장 깔면 겹치는 일이 흔한데, 위 스티커가 누르기를 다 먹어서 가려진 것은 고를 길이 없었다.
     '한 칸 뒤로' 메뉴는 이미 있지만 그건 가린 것을 먼저 골라야 쓸 수 있다. */
  function cycleStickerAt(ev){
    const w = paperWidth || paper.clientWidth || 1;
    const rect = paper.getBoundingClientRect();
    const hits = stickersAtPoint((ev.clientX - rect.left) / w, (ev.clientY - rect.top) / w);
    if (!hits.length) return;
    const at = hits.findIndex(s => selection.includes(s.id));
    const next = hits[(at + 1) % hits.length];                 // 고른 것이 없으면(-1) 맨 위부터
    selectSticker(next.id);
    const node = stickerLayer.querySelector(`[data-id="${next.id}"]`);
    if (node) node.focus({ preventScroll:true });
    setStatus(hits.length > 1
      ? diaryTf("겹친 것 가운데 {i}/{n} 을 골랐어요 — Alt+누르기로 아래 것을 골라요.", { i:hits.indexOf(next) + 1, n:hits.length })
      : diaryT("스티커 하나를 골랐어요."));
  }
  /* 사진을 두 번 누르면 크게 본다 — 앱 공용 그림 창(image-lightbox.js)을 그대로 빌린다.
     그 날 사진을 모두 넘겨 주므로 ←→ 로 넘겨 볼 수 있고, 저장·메모 보내기도 딸려 온다. */
  function openPhotoViewer(id){
    const entry = entryOf(paperEnv.current());
    if (!entry || typeof window.openImageLightbox !== "function") return false;
    const photos = entry.stickers.filter(s => diaryStickerKind(s) === "photo" && assetUrl(s.asset));
    if (!photos.length) return false;
    const at = Math.max(0, photos.findIndex(s => s.id === id));
    const label = currentLabel();
    window.openImageLightbox(photos.map((s, i) => ({
      src:assetUrl(s.asset),
      alt:photos.length > 1 ? label + " (" + (i + 1) + "/" + photos.length + ")" : label
    })), at);
    return true;
  }
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
      if (!moved && paperEnv.history()) paperEnv.history().flush();
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
    const entry = entryOf(paperEnv.current());
    return entry ? entry.stickers.find(item => item.id === id) || null : null;
  }
  // where: front(맨 앞)·forward(한 칸 앞)·backward(한 칸 뒤)·back(맨 뒤). 배열 순서가 곧 쌓는 순서다.
  // 여러 장이면 고른 것끼리의 앞뒤 순서는 지키며 함께 옮긴다(diaryReorder).
  function reorderStickers(where){
    const entry = entryOf(paperEnv.current());
    if (!entry || !selection.length) return;
    const next = diaryReorder(entry.stickers, new Set(selection), where);
    if (next.every((s, i) => s === entry.stickers[i])) return;
    if (paperEnv.history()) paperEnv.history().flush();
    entry.stickers = next;
    renderStickers();
    touch(true);
  }
  function rotateStickers(delta, absolute){
    const list = selectedStickers();
    if (!list.length) return;
    if (paperEnv.history()) paperEnv.history().flush();
    for (const s of list) s.rot = diaryNormalizeAngle(absolute ? delta : (s.rot || 0) + delta);
    positionStickers(); layout(); touch(true);
  }
  // 하나라도 안 뒤집혔으면 모두 뒤집고, 모두 뒤집혀 있으면 모두 되돌린다.
  function flipStickers(){
    const list = selectedStickers();
    if (!list.length) return;
    if (paperEnv.history()) paperEnv.history().flush();
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
  /* ----- 여러 장 정렬해서 깔기 -----
     자리 셈은 순수 함수(diaryArrange*)가 하고, 여기서는 대상을 고르고 모델에 넣는 일만 한다. */
  function applyStickerPlaces(list, places){
    const byId = new Map(list.map(s => [s.id, s]));
    let hit = 0;
    for (const p of places){
      const s = byId.get(p.id);
      if (!s) continue;
      s.x = p.x; s.y = p.y; s.w = p.w;
      if (p.rot != null) s.rot = diaryNormalizeAngle(p.rot);
      clampStickerPos(s);
      hit++;
    }
    return hit;
  }
  /* 정렬할 것 — 고르지 않고 부르면 그 날 '사진'만 손댄다. 하트·별 같은 그림 스티커는 그 자리에 두려고
     일부러 놓은 것이라, 사진을 정리한다고 격자로 끌려오면 꾸며 둔 것이 망가진다.
     반대로 그림 스티커를 둘 이상 골라 놓고 불렀다면 그건 "이것들을 줄 세워라"는 뜻이니 함께 정렬한다.
     글상자는 어느 쪽이든 제외한다 — 높이를 글에서 재므로 줄 맞춰 늘릴 수가 없다. */
  function arrangeTargets(){
    const picked = selectedStickers().filter(s => diaryStickerKind(s) !== "text");
    if (picked.length >= 2) return picked;
    const entry = entryOf(paperEnv.current());
    return entry ? entry.stickers.filter(s => diaryStickerKind(s) === "photo") : [];
  }
  // [사진만일 때, 그림 스티커가 섞였을 때] — 하트를 함께 옮겨 놓고 "사진 3장"이라고 하면 말이 어긋난다.
  const DIARY_ARRANGE_DONE = {
    row:["사진 {n}장을 줄 맞춰 깔았어요. Ctrl+Z 로 되돌릴 수 있어요.", "스티커 {n}개를 줄 맞춰 깔았어요. Ctrl+Z 로 되돌릴 수 있어요."],
    grid:["사진 {n}장을 격자로 깔았어요. Ctrl+Z 로 되돌릴 수 있어요.", "스티커 {n}개를 격자로 깔았어요. Ctrl+Z 로 되돌릴 수 있어요."],
    scatter:["사진 {n}장을 사진첩처럼 깔았어요. Ctrl+Z 로 되돌릴 수 있어요.", "스티커 {n}개를 사진첩처럼 깔았어요. Ctrl+Z 로 되돌릴 수 있어요."]
  };
  const arrangeAllPhotos = (list) => list.every(s => diaryStickerKind(s) === "photo");
  function arrangePhotos(mode, opts){
    const list = arrangeTargets();
    if (list.length < 2){ setStatus(diaryT("정렬하려면 사진이 두 장 이상 있어야 해요.")); return; }
    const done = DIARY_ARRANGE_DONE[mode] || DIARY_ARRANGE_DONE.row;
    // 있던 자리에서 정돈한다 — 맨 위에 있던 것의 높이가 정렬한 블록의 시작이 된다.
    const top = Math.max(0.03, Math.min(...list.map(s => Number(s.y) || 0)));
    const places = diaryArrangeStickers(list, mode, Object.assign({ top }, opts || {}));
    if (!places.length) return;
    if (paperEnv.history()) paperEnv.history().flush();
    applyStickerPlaces(list, places);
    selection = list.map(s => s.id);
    renderStickers(); layout(); touch(true);
    setStatus(diaryTf(arrangeAllPhotos(list) ? done[0] : done[1], { n:list.length }));
  }
  // 그림 칸 안에 든 스티커 — 가운데가 칸 안에 들면 '칸에 든 것'으로 본다(안내 문장을 감추는 판정과 같은 규칙).
  function stickersInBox(entry, box, w){
    if (!entry || !box || !w) return [];
    return entry.stickers.filter(s => {
      const cx = (s.x + s.w / 2) * w, cy = (s.y + s.w * s.ar / 2) * w;
      return cx >= box.left && cx <= box.left + box.width && cy >= box.top && cy <= box.top + box.height;
    });
  }
  // 그림 칸에 나눠 맞추기 — 한 장이면 예전처럼 칸에 꼭 맞춘다.
  function fitStickersToBox(list, box = pictureBoxRect(), w = paperWidth || paper.clientWidth){
    if (!box || !w || !list || !list.length) return false;
    if (list.length === 1) return fitStickerToBox(list[0], box, w);
    const places = diaryArrangeInBox(list, { left:box.left / w, top:box.top / w, width:box.width / w, height:box.height / w });
    return applyStickerPlaces(list, places) > 0;
  }
  function fitSelectionToBox(){
    const list = arrangeTargets();
    if (!list.length) return;
    if (paperEnv.history()) paperEnv.history().flush();
    if (!fitStickersToBox(list)) return;
    selection = list.map(s => s.id);
    renderStickers(); layout(); touch(true);
    setStatus(list.length < 2 ? diaryT("사진을 그림 칸에 꼭 맞췄어요.")
      : arrangeAllPhotos(list) ? diaryTf("사진 {n}장을 그림 칸에 나눠 맞췄어요.", { n:list.length })
      : diaryTf("스티커 {n}개를 그림 칸에 나눠 맞췄어요.", { n:list.length }));
  }
  function openStickerMenu(id, x, y){
    const s = stickerOf(id);
    if (!s || typeof MNContextMenu === "undefined") return;
    const entry = entryOf(paperEnv.current());
    const list = selectedStickers();
    const many = list.length > 1;
    const kind = diaryStickerKind(s);
    // 이미 맨 앞/맨 뒤인지 — 여러 장이면 고른 것이 모두 그 끝에 붙어 있을 때
    const n = entry.stickers.length, k = list.length;
    const atFront = entry.stickers.slice(n - k).every(x => selection.includes(x.id));
    const atBack = entry.stickers.slice(0, k).every(x => selection.includes(x.id));
    const arrangeCount = arrangeTargets().length;
    // 그림·글상자만 색을 바꾼다(사진은 바꿀 색이 없다). 고른 것에 사진이 섞여 있으면 사진만 그대로 둔다.
    const colorTargets = list.filter(item => diaryStickerKind(item) !== "photo");
    const colorful = colorTargets.length > 0;
    // 고른 것이 모두 한 색일 때만 그 색을 켠다(섞여 있으면 아무것도 켜지 않는다).
    const oneColor = colorful && colorTargets.every(item => item.color === colorTargets[0].color) ? colorTargets[0].color : "";
    const colorChildren = DIARY_PENS.map(([color, ko, en]) => ({
      label:diaryIsEn() ? en : ko, active:list.every(item => item.color === color), action:() => applyStickerColor(color)
    }));
    // 팔레트 밖 색은 메뉴 안에 칸을 넣을 수 없어(MNContextMenu 는 글자 항목만 받는다) 스티커 창의 색 칸을 대신 연다.
    // 창이 닫혀 있으면 먼저 연다 — display:none 인 칸은 click() 해도 고르개가 뜨지 않는다.
    colorChildren.push({
      label:diaryT("직접 고르기…"),
      active:!!oneColor && !DIARY_PENS.some(pen => pen[0] === oneColor),
      action:() => {
        openStickerColorPicker();
      }
    });
    const textItems = kind !== "text" || many ? [] : [
      { label:diaryT("글 고쳐 쓰기"), icon:"pen", title:"Enter", action:() => editTextSticker(id) },
      { label:diaryT("글자 크기"), children:DIARY_TEXT_SIZES.map(([, value, ko, en]) => ({
        label:diaryIsEn() ? en : ko, active:Math.abs((s.size || 0) - value) < 0.0005,
        action:() => setTextStickerField({ size:value })
      })) },
      { label:diaryT("글 맞춤"), children:[["left", "왼쪽", "Left"], ["center", "가운데", "Center"], ["right", "오른쪽", "Right"]]
        .map(([align, ko, en]) => ({ label:diaryIsEn() ? en : ko, active:(s.align || "left") === align, action:() => setTextStickerField({ align }) })) },
      { label:diaryT("글꼴"), children:DIARY_FONTS.map(font => ({
        label:diaryLabel(DIARY_FONT_LABELS, DIARY_FONT_LABELS_EN, font), active:(s.font || "gothic") === font,
        action:() => setTextStickerField({ font })
      })) },
      { separator:true }
    ];
    MNContextMenu.open(x, y, [
      ...textItems,
      (kind !== "photo" || many) ? null : { label:diaryEn("크게 보기", "View large"), icon:"zoomIn", title:"Enter", action:() => openPhotoViewer(id) },
      (kind !== "photo" || many) ? null : { separator:true },
      colorful ? { label:diaryT("색 바꾸기"), children:colorChildren } : null,
      colorful ? { separator:true } : null,
      paperEnv.photoOpacity && list.some(item => diaryStickerKind(item) === "photo")
        ? { label:diaryT("사진 투명도 조절…"), action:() => paperEnv.openStickerOpacityPanel() } : null,
      { label:diaryT("맨 앞으로"), title:"Ctrl+Shift+]", disabled:atFront, action:() => reorderStickers("front") },
      { label:diaryT("한 칸 앞으로"), title:"Ctrl+]", disabled:atFront, action:() => reorderStickers("forward") },
      { label:diaryT("한 칸 뒤로"), title:"Ctrl+[", disabled:atBack, action:() => reorderStickers("backward") },
      { label:diaryT("맨 뒤로"), title:"Ctrl+Shift+[", disabled:atBack, action:() => reorderStickers("back") },
      { separator:true },
      { label:diaryT("왼쪽으로 15° 돌리기"), icon:"rotateLeft", title:"[ (Shift: 15°)", action:() => rotateStickers(-15) },
      { label:diaryT("오른쪽으로 15° 돌리기"), icon:"rotateRight", title:"] (Shift: 15°)", action:() => rotateStickers(15) },
      { label:diaryT("돌리기 되돌리기"), disabled:!list.some(x => x.rot), action:() => rotateStickers(0, true) },
      // 글상자는 뒤집지 않는다 — 거울 글씨가 될 뿐이다.
      list.every(x => diaryStickerKind(x) === "text") ? null
        : { label:diaryT("좌우 뒤집기"), icon:"flipH", active:list.every(x => x.flip), action:() => flipStickers() },
      // 사진 여러 장은 자리를 하나하나 끌지 않고 한 번에 정돈한다 — 고른 것이 둘 이상이면 그것만, 아니면 그 날 전부.
      arrangeCount < 2 ? null : { label:diaryEn("정렬해서 깔기", "Arrange photos"), icon:"table", children:[
        { label:diaryEn("줄 맞춰", "In rows"), action:() => arrangePhotos("row") },
        { label:diaryEn("격자로", "In a grid"), children:[
          { label:diaryEn("자동", "Auto"), action:() => arrangePhotos("grid") },
          ...[2, 3, 4].map(cols => ({ label:diaryIsEn() ? cols + " columns" : cols + "열", action:() => arrangePhotos("grid", { cols }) }))
        ] },
        { label:diaryEn("사진첩처럼", "Photo-album look"), action:() => arrangePhotos("scatter") }
      ] },
      (pictureBox.hidden || kind === "text") ? null
        : many ? { label:diaryTf("그림 칸에 {n}장 나눠 맞추기", { n:k }), icon:"fit", action:() => fitSelectionToBox() }
        : { label:diaryT("그림 칸에 꼭 맞추기"), icon:"fit", action:() => {
            if (paperEnv.history()) paperEnv.history().flush();
            if (fitStickerToBox(s)){ positionStickers(); layout(); touch(true); }
          } },
      { separator:true },
      many ? { label:diaryT("모두 고르기"), title:"Ctrl+A", disabled:k === n, action:() => setSelection(entry.stickers.map(x => x.id)) } : null,
      { label:many ? diaryTf("스티커 {n}개 떼기", { n:k }) : diaryT(kind === "photo" ? "사진 떼기" : "스티커 떼기"), icon:"delete", action:() => removeStickers(selection) }
    ], { onClose:() => { const node = stickerLayer.querySelector(`[data-id="${id}"]`); if (node) node.focus({ preventScroll:true }); } });
  }
  function removeSticker(id){ removeStickers([id]); }
  function removeStickers(ids){
    const entry = entryOf(paperEnv.current());
    if (!entry) return;
    const drop = new Set(ids);
    const keep = entry.stickers.filter(s => !drop.has(s.id));
    const count = entry.stickers.length - keep.length;
    if (!count) return;
    if (paperEnv.history()) paperEnv.history().flush();
    entry.stickers = keep;
    selection = [];
    renderStickers();
    layout();
    renderCalendar();
    touch(true);
    setStatus(count > 1 ? diaryTf("스티커 {n}개를 뗐어요. Ctrl+Z 로 되돌릴 수 있어요.", { n:count }) : diaryT("스티커를 뗐어요. Ctrl+Z 로 되돌릴 수 있어요."));
  }
  /* Ctrl(⌘)+끌기 = 네모를 그려 한꺼번에 고르기. 종이 대부분이 글칸이라 그냥 끌기·Shift+끌기는 글 고르기로 남겨 둔다.
     네모에 조금이라도 걸친 스티커를 고른다(돌린 스티커는 돌리기 전 상자로 잰다). Shift 를 함께 누르면 지금 고른 것에 더한다. */
  const marquee = document.createElement("div");
  marquee.className = "diary-marquee";
  marquee.hidden = true;
  paper.append(marquee);
  paper.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || drawMode) return;
    if (e.target.closest(".diary-sticker, .diary-draw-bar, .diary-picture-hint button")) return;
    const entry = entryOf(paperEnv.current());
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
  /* at: 종이 안 픽셀 좌표(없으면 지금 보이는 종이 한가운데) · fit: 그림 칸에 맞추기
     여러 장을 한꺼번에 넣으면 계단식으로 겹쳐 쌓지 않고 곧바로 줄 맞춰 깐다 — 다섯 장을 떨어뜨렸는데
     카드 뭉치처럼 겹쳐 있으면 한 장씩 끌어내는 일부터 해야 한다. 그림 칸에 넣을 때도 칸을 나눠 맞춘다. */
  async function addStickers(files, at, fit){
    const blobs = [...(files || [])].filter(f => f && /^image\//i.test(f.type || ""));
    if (!blobs.length) return;
    let targetDate = paperEnv.current();
    const targetBox = fit ? pictureBoxRect() : null;
    setStatus(diaryT("사진을 붙이는 중…"));
    const w = paperWidth || paper.clientWidth || 600;
    const origin = at || stickerOrigin();
    // 사진을 모두 준비한 뒤 현재 모델에 한 번에 넣는다. 날짜 이동·되돌리기로 교체된 entry 를 붙잡지 않는다.
    const prepared = [];
    let added = 0, skipped = 0;
    for (const blob of blobs){
      if (prepared.length >= DIARY_MAX_STICKERS){ skipped++; continue; }
      let asset = null;
      try { asset = await addAsset(blob, DIARY_STICKER_MAX_DIM); }
      catch(error){ console.warn("사진을 붙이지 못했어요:", error); }
      if (!asset){ skipped++; continue; }
      prepared.push(asset);
    }
    // 빈 여행일지에는 아직 첫날 id가 없다. 첫 사진을 준비한 뒤 날을 만들면 ensureEntry("")가 새 id를
    // 만들 수 있으므로, 그 실제 id를 이후 추가·화면 갱신에 계속 쓴다. 그렇지 않으면 사진 바이트와
    // 스티커는 들어가도 현재 id와 비교가 어긋나 화면에 그리지 않고, 여러 장은 날도 여러 개 만든다.
    if (prepared.length && !entryOf(targetDate)){
      const created = ensureEntry(targetDate);
      const createdKey = created && (created.date || created.id);
      if (createdKey) targetDate = createdKey;
    }
    if (prepared.length && paperEnv.history()) paperEnv.history().flush();
    const fresh = [];
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
      entry.stickers.push(sticker);
      fresh.push(sticker);
      if (paperEnv.current() === targetDate) selection = [sticker.id];
      added++;
    }
    // 넣은 자리는 한 번에 정한다 — 한 장씩 맞추면 칸을 나눌 때 앞 장이 어디 있는지 알 수 없다.
    let fitted = 0;
    if (fresh.length && fit){
      // 칸에 이미 들어 있던 사진까지 함께 나눈다 — 새것만 나누면 먼저 있던 한 장이 칸을 덮은 채로 남는다.
      // 칸 안에 놓인 그림 스티커·글상자는 건드리지 않는다(정렬 대상과 같은 규칙 — 꾸미기는 그 자리에 둔다).
      const older = stickersInBox(entryOf(targetDate), targetBox, w)
        .filter(s => diaryStickerKind(s) === "photo" && !fresh.includes(s));
      const targets = [...older, ...fresh];
      if (fitStickersToBox(targets, targetBox, w)) fitted = targets.length;
    }
    else if (fresh.length > 1){
      const top = Math.max(0.02, origin.y / w - 0.04);
      applyStickerPlaces(fresh, diaryArrangeStickers(fresh, "row", { top }));
    }
    if (fresh.length > 1 && paperEnv.current() === targetDate) selection = fresh.map(s => s.id);
    if (added){
      if (paperEnv.current() === targetDate){
        renderStickers();
        layout();
        onEntryChange();
      }
      renderCalendar();
      touch(true);
    }
    if (skipped) setStatus((added ? diaryTf("사진 {n}장을 붙였어요.", { n:added }) + " " : "") + diaryTf("{n}장은 붙이지 못했어요(그림 파일이 아니거나 너무 크거나 한 날 {max}장을 넘었어요).", { n:skipped, max:DIARY_MAX_STICKERS }));
    // 여러 장은 이미 정렬해 두었다고 알려 준다 — 다른 모양으로 깔 길(우클릭)도 여기서 한 번 짚어 준다.
    else if (fitted > 1) setStatus(diaryTf("사진 {n}장을 그림 칸에 나눠 맞췄어요.", { n:fitted }));
    else if (fresh.length > 1) setStatus(diaryTf("사진 {n}장을 줄 맞춰 깔았어요 — 우클릭 '정렬해서 깔기' 로 격자·사진첩 모양으로 바꿀 수 있어요.", { n:fresh.length }));
    // 일기장 refreshDirty 는 저장 상태를 문구로 쓰지만 여행일지는 그렇지 않다. 한 장 성공도 직접 끝났다고
    // 알려 주지 않으면 여행일지 막대에는 시작 문구인 "사진을 붙이는 중…"이 영원히 남는다.
    else if (added) setStatus(diaryTf("사진 {n}장을 붙였어요.", { n:added }));
    else refreshDirty();
  }

  /* ----- 내장 스티커·글상자 붙이기 -----
     사진과 달리 ZIP 에 담을 바이트가 없어서 기다릴 것도, 줄일 것도 없다 — 곧바로 모델에 한 줄을 더한다. */
  let artColor = DIARY_ART_DEFAULT_COLOR;        // 다음에 붙일 그림 색(고른 스티커가 있으면 그쪽을 바꾼다)
  let artOpacity = 1;                            // 다음에 붙일 내장 그림·글상자 투명도
  // 색을 한 번이라도 직접 고르기 전까지는 그림은 빨강, 글상자는 검정이라는 기본을 지킨다.
  // 고른 뒤에는 글상자도 그 색을 따른다 — 색을 골라 놓고 글상자만 검정으로 붙으면 고장으로 보인다.
  let artColorPicked = false;
  // 종이에서 지금 보이는 데의 한가운데 — 사진 붙이기와 같은 자리 규칙.
  function stickerOrigin(){
    const w = paperWidth || paper.clientWidth || 600;
    const rect = paper.getBoundingClientRect(), view = main.getBoundingClientRect();
    const visibleTop = Math.max(0, view.top - rect.top);
    return { x:w * 0.5, y:visibleTop + Math.min(view.height, rect.height) * 0.35, w };
  }
  // 같은 자리에 똑같이 겹쳐 쌓이면 위의 것만 잡힌다 — 한 장씩 조금씩 어긋내 놓는다
  // (사진을 여러 장 한꺼번에 붙일 때 쓰던 규칙과 같다).
  function cascadeOffset(){
    const entry = entryOf(paperEnv.current());
    return ((entry ? entry.stickers.length : 0) % 8) * 0.025;
  }
  function pushSticker(sticker){
    const entry = ensureEntry(paperEnv.current());
    if (entry.stickers.length >= DIARY_MAX_STICKERS){
      setStatus(diaryTf("한 날에 스티커는 {max}개까지예요.", { max:DIARY_MAX_STICKERS }));
      return null;
    }
    if (paperEnv.history()) paperEnv.history().flush();
    entry.stickers.push(sticker);
    selection = [sticker.id];
    renderStickers();
    layout();
    renderCalendar();
    onEntryChange();
    touch(true);
    return sticker;
  }
  function addArtSticker(id){
    const info = diaryArtInfo(id);
    if (!info) return;
    const o = stickerOrigin(), width = 0.18, off = cascadeOffset();
    const s = pushSticker({ id:diaryStickerId(), kind:"art", art:info[0], color:artColor, opacity:artOpacity, w:width, ar:info[3],
      x:Math.max(0, Math.min(1 - width, o.x / o.w - width / 2 + off)), y:Math.max(0, o.y / o.w - (width * info[3]) / 2 + off),
      rot:0, flip:false });
    if (s) setStatus(diaryTf("{name} 스티커를 붙였어요 — 끌어서 옮기고 모서리로 크기를 바꿔요.", { name:diaryArtName(info) }));
  }
  function addTextSticker(){
    const o = stickerOrigin(), width = 0.42, off = cascadeOffset();
    const s = pushSticker({ id:diaryStickerId(), kind:"text", text:diaryT("여기에 쓰세요"), color:artColorPicked ? artColor : DIARY_TEXT_DEFAULT_COLOR, opacity:artOpacity,
      font:diaryEffectiveStyle(model, entryOf(paperEnv.current())).font, size:0.048, align:"left", w:width, ar:0.2,
      x:Math.max(0, Math.min(1 - width, o.x / o.w - width / 2 + off)), y:Math.max(0, o.y / o.w + off), rot:0, flip:false });
    if (s) editTextSticker(s.id, true);          // 붙이자마자 바로 쓰게 — 견본 글은 모두 골라 둔다
  }
  /* 글상자 고쳐 쓰기 — 종이 위 그 자리에 같은 글꼴·크기의 textarea 를 잠깐 얹는다.
     contenteditable 은 쓰지 않는다(.mnote 설계 때 커서·IME 로 데인 길이라 일기장도 같은 결정이다).
     Esc 는 되돌리고, 글을 모두 지우면 글상자가 사라진다(빈 상자는 저장되지도 않는다). */
  let textEditing = "";
  function editTextSticker(id, selectAll){
    if (textEditing) return;
    const s = stickerOf(id);
    if (!s || diaryStickerKind(s) !== "text") return;
    const node = stickerLayer.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const body = node && node.querySelector(".diary-sticker-body");
    if (!body) return;
    textEditing = id;
    node.classList.add("is-editing");
    const before = s.text;
    const w = paperWidth || paper.clientWidth || 600;
    const ta = document.createElement("textarea");
    ta.className = "diary-sticker-edit";
    ta.value = s.text;
    ta.maxLength = DIARY_TEXT_MAX;
    ta.spellcheck = false;
    ta.setAttribute("aria-label", "글상자 글");
    Object.assign(ta.style, { fontSize:(s.size * w) + "px", fontFamily:DIARY_FONT_STACKS[s.font] || "",
      color:s.color || DIARY_TEXT_DEFAULT_COLOR, textAlign:s.align || "left" });
    body.hidden = true;
    node.append(ta);
    const grow = () => { ta.style.height = "0px"; ta.style.height = ta.scrollHeight + "px"; };
    grow();
    ta.addEventListener("input", () => { grow(); layout(); });
    let cancelled = false;
    ta.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); cancelled = true; ta.blur(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); e.stopPropagation(); ta.blur(); }
    });
    ta.addEventListener("blur", () => {
      if (textEditing !== id) return;
      textEditing = "";
      const next = cancelled ? before : ta.value;
      ta.remove();
      body.hidden = false;
      node.classList.remove("is-editing");
      const live = stickerOf(id);
      if (!live) return;
      if (next === before){ renderStickers(); layout(); return; }
      if (paperEnv.history()) paperEnv.history().flush();
      if (!String(next).trim()){
        removeStickers([id]);
        setStatus(diaryT("글이 비어서 글상자를 뺐어요. Ctrl+Z 로 되돌릴 수 있어요."));
        return;
      }
      live.text = String(next).slice(0, DIARY_TEXT_MAX);
      renderStickers(); layout(); renderCalendar(); touch(true);
    });
    ta.focus({ preventScroll:true });
    if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  // 고른 글상자의 글자 크기·맞춤·글꼴 바꾸기(여럿을 골랐으면 글상자만 골라 함께).
  function setTextStickerField(patch){
    const list = selectedStickers().filter(s => diaryStickerKind(s) === "text");
    if (!list.length) return;
    if (paperEnv.history()) paperEnv.history().flush();
    for (const s of list) Object.assign(s, patch);
    if (patch.font && DIARY_HAND_FONTS[patch.font]) diaryEnsureFont(patch.font).then(() => layout());
    renderStickers(); layout(); touch(true);
  }
  /* 고른 스티커의 색 바꾸기. 고른 게 없으면 다음에 붙일 색만 기억한다.
     live=true 는 색 고르개를 아직 끄는 중이라는 뜻 — 화면만 바꾸고 되돌리기 단계는 만들지 않는다.
     확정(change)에서 한 번만 commit 하므로, 색을 한참 고르다 놓아도 Ctrl+Z 한 번에 돌아간다. */
  function applyStickerColor(color, live){
    const list = selectedStickers().filter(s => diaryStickerKind(s) !== "photo");
    artColor = color;
    artColorPicked = true;
    if (!list.length){
      onStickerSelect();
      if (!live) setStatus(diaryT("다음에 붙일 스티커 색을 바꿨어요."));
      return;
    }
    if (!live && paperEnv.history()) paperEnv.history().flush();
    for (const s of list) s.color = color;
    renderStickers(); onStickerSelect();
    if (live){ refreshDirty(); scheduleRecovery(); return; }
    touch(true);
  }
  function applyStickerOpacity(opacity, live){
    const value = Math.max(0.1, Math.min(1, Number(opacity) || 1));
    const list = selectedStickers().filter(s => diaryStickerKind(s) !== "photo" || paperEnv.photoOpacity);
    if (!list.length || list.some(s => diaryStickerKind(s) !== "photo")) artOpacity = value;
    if (!list.length){
      onStickerSelect();
      if (!live) setStatus(diaryT("다음에 붙일 스티커 투명도를 바꿨어요."));
      return;
    }
    for (const s of list) s.opacity = value;
    renderStickers(); onStickerSelect();
    if (live){ refreshDirty(); scheduleRecovery(); return; }
    touch(true);
  }

  /* ----- 바깥에 내주는 읽기 창구 -----
     종이 엔진을 떼어 낼 때 이 여섯이 돌려주는 값이 된다. 바깥이 종이의 변수를 직접 읽지 않게 한다. */
  const selectionIds = () => selection;
  const clearSelection = () => { selection = []; };
  const paperWidthNow = () => paperWidth;
  const isDrawing = () => drawMode;
  const stickerColorNow = () => artColor;
  const stickerOpacityNow = () => artOpacity;


  // 종이가 문서에 직접 건 처리기는 종이가 거둔다.
  const destroyPaper = () => document.removeEventListener("selectionchange", onSelectionChange);

  return { addArtSticker, addAsset, addStickers, addTextSticker, applyStickerColor, applyStickerOpacity, applyStyle, clearSelection, destroyPaper, isDrawing, layout, nudgeStickers, openPhotoViewer, paperWidthNow, positionStickers, redrawDrawing, removeStickers, renderStickers, reorderStickers, rotateStickers, selectSticker, selectedStickers, selectionIds, setDrawMode, setSelection, stickerColorNow, stickerOpacityNow };
}

/* ===== 꾸미기 창·스티커 창(일기장·여행일지 공용) =====
   종이 엔진과 같은 생각이다 — 창을 만들고 붙이는 일만 여기서 하고, 무엇을 꾸미는지(model·날짜)와
   무엇을 할지(종이 다시 그리기·스티커 색 바꾸기)는 부르는 쪽이 panelEnv 로 내준다.
   창을 화면에 붙이는 것도 부르는 쪽 몫이다 — 일기장은 잠금 덮개 아래, 여행일지는 다른 자리다.
   (매개변수를 ctx 로 지으면 안 된다 — 그리기 코드가 캔버스 컨텍스트 이름으로 쓴다.) */
function mountDiaryPanels(panelEnv){
  const { model, assets, assetUrl, addAsset, entryOf, ensureEntry, touch, setStatus, applyStyle, layout, renderCalendar, bgInput, styleBtn, stickerBtn, addArtSticker, addTextSticker, applyStickerColor, applyStickerOpacity, selectedStickers, stickerColorNow, stickerOpacityNow } = panelEnv;
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
  // 배경 효과 — 파일에 바이트를 싣지 않는 종이 무늬. 사진 배경과 함께 쓰면 효과가 아래, 사진이 위다.
  const paperChips = section("배경 효과");
  paperChips.classList.add("diary-paper-grid");
  const paperButtons = DIARY_PAPERS.map(id => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-chip diary-paper-chip"; b.dataset.paper = id;
    const sample = document.createElement("span"); sample.className = "diary-paper-sample";
    const label = document.createElement("span"); label.className = "diary-chip-label"; label.textContent = DIARY_PAPER_LABELS[id];
    b.append(sample, label);
    b.addEventListener("click", () => changeStyle({ paper:id }, true));
    paperChips.append(b);
    return b;
  });
  const paperToneControls = section("효과 색·진하기");
  const paperColorPick = diaryColorInput("diary-paper-color", (color, live) => changeStyle({ paperColor:color }, !live));
  paperColorPick.title = "배경 효과에 쓸 색";
  paperColorPick.setAttribute("aria-label", paperColorPick.title);
  const paperToneRange = document.createElement("input");
  paperToneRange.type = "range"; paperToneRange.min = "0"; paperToneRange.max = "100"; paperToneRange.step = "5";
  paperToneRange.className = "diary-paper-tone";
  paperToneRange.setAttribute("aria-label", "배경 효과를 얼마나 진하게 할지");
  const paperToneValue = document.createElement("span");
  paperToneValue.className = "diary-veil-value";
  paperToneControls.append(paperColorPick, paperToneRange, paperToneValue);
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
  veilRange.className = "diary-veil-range";
  veilRange.setAttribute("aria-label", "배경 그림을 종이색으로 덮는 정도");
  const veilValue = document.createElement("span");
  veilValue.className = "diary-veil-value";
  veilControls.append(veilRange, veilValue);

  // 인쇄할 땐 배경 빼기 — 날짜별 꾸미기가 아니라 일기장 전체 설정이라 '이 날짜에만'과 상관없이 하나다.
  const printPlainRow = document.createElement("label");
  // 클래스를 '이 날짜에만'과 나눠 둔다 — 같이 쓰면 두 체크상자가 한 선택자에 걸린다(e2e 가 먼저 깨진다).
  printPlainRow.className = "diary-print-plain";
  const printPlainBox = document.createElement("input");
  printPlainBox.type = "checkbox";
  const printPlainText = document.createElement("span");
  printPlainText.textContent = "인쇄할 땐 배경 빼기";
  printPlainRow.append(printPlainBox, printPlainText);
  const printPlainNote = document.createElement("div");
  printPlainNote.className = "diary-style-note";
  printPlainNote.textContent = "배경 효과와 배경 그림을 빼고 인쇄해요(잉크를 아껴요). 일기장 전체에 적용돼요.";
  panel.append(printPlainRow, printPlainNote);

  // 꾸미기 창의 칩·칸을 지금 꾸미기로 맞춘다. 종이를 그리는 일과는 상관이 없어 창 곁에 둔다.
  function syncPanel(){
    const entry = entryOf(panelEnv.current());
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
    paperButtons.forEach(b => {
      const on = b.dataset.paper === style.paper;
      b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on));
      b.querySelector(".diary-chip-label").textContent = diaryLabel(DIARY_PAPER_LABELS, DIARY_PAPER_LABELS_EN, b.dataset.paper);
      // 견본도 지금 고른 색·진하기로 그린다 — 칩만 봐도 그 색이 어떻게 깔릴지 보인다.
      diaryPaintPaper(b.querySelector(".diary-paper-sample"), { paper:b.dataset.paper, paperColor:style.paperColor, paperTone:style.paperTone });
    });
    printPlainBox.checked = !!model.printPlain;
    paperColorPick.value = style.paperColor;
    paperColorPick.disabled = paperToneRange.disabled = style.paper === "none";
    paperToneRange.value = String(Math.round(style.paperTone * 100));
    paperToneValue.textContent = Math.round(style.paperTone * 100) + "%";
    const url = assetUrl(style.bg);
    bgThumb.style.backgroundImage = url ? `url("${url}")` : "none";
    bgThumb.classList.toggle("is-empty", !url);
    bgClear.disabled = !style.bg;
    fitSelect.value = style.fit;
    fitSelect.disabled = veilRange.disabled = !style.bg;
    veilRange.value = String(Math.round(style.veil * 100));
    veilValue.textContent = Math.round(style.veil * 100) + "%";
  }

  /* ----- 스티커 창 ----- */
  const artPanel = document.createElement("div");
  artPanel.className = "diary-art-panel";      // 꾸미기 창과 모양은 같지만 클래스는 따로 — 선택자가 둘을 가려야 한다
  artPanel.hidden = true;
  artPanel.setAttribute("role", "dialog");
  artPanel.setAttribute("aria-label", "스티커");
  const artSection = (label) => {
    const wrap = document.createElement("div"); wrap.className = "diary-style-row";
    const head = document.createElement("div"); head.className = "diary-style-label"; head.textContent = label;
    const content = document.createElement("div"); content.className = "diary-style-controls";
    wrap.append(head, content); artPanel.append(wrap);
    return content;
  };
  const artColorChips = artSection("색");
  const artColorButtons = DIARY_PENS.map(([color, ko, en]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-art-color"; b.dataset.color = color;
    b.style.setProperty("--pen", color);
    b.title = diaryIsEn() ? en : ko;
    b.setAttribute("aria-label", b.title);
    b.addEventListener("click", () => applyStickerColor(color));
    artColorChips.append(b);
    return b;
  });
  // 팔레트 밖 색 — 고른 스티커가 있으면 그 스티커를, 없으면 다음에 붙일 색을 바꾼다(칩과 같은 규칙).
  const artCustomColor = diaryColorInput("diary-art-color-custom", (color, live) => applyStickerColor(color, live));
  artColorChips.append(artCustomColor);
  const artOpacityControls = artSection("투명도");
  const artOpacityRange = document.createElement("input");
  artOpacityRange.type = "range"; artOpacityRange.min = "10"; artOpacityRange.max = "100"; artOpacityRange.step = "5";
  artOpacityRange.className = "diary-art-opacity";
  artOpacityRange.title = "스티커 투명도"; artOpacityRange.setAttribute("aria-label", artOpacityRange.title);
  const artOpacityValue = document.createElement("span");
  artOpacityValue.className = "diary-veil-value";
  let artOpacityGesture = false;
  const beginArtOpacity = () => {
    if (artOpacityGesture) return;
    if (selectedStickers().some(s => diaryStickerKind(s) !== "photo" || panelEnv.photoOpacity) && panelEnv.history()) panelEnv.history().flush();
    artOpacityGesture = true;
  };
  artOpacityRange.addEventListener("pointerdown", beginArtOpacity);
  artOpacityRange.addEventListener("input", () => {
    beginArtOpacity(); applyStickerOpacity(Number(artOpacityRange.value) / 100, true);
  });
  artOpacityRange.addEventListener("change", () => {
    applyStickerOpacity(Number(artOpacityRange.value) / 100, false); artOpacityGesture = false;
  });
  artOpacityControls.append(artOpacityRange, artOpacityValue);
  const artGrid = artSection("그림");
  artGrid.classList.add("diary-art-grid");
  const artButtons = DIARY_ART.map(info => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "diary-art-chip"; b.dataset.art = info[0];
    b.innerHTML = diaryArtSvg(info[0], "diary-art diary-art-chip-svg");
    b.title = diaryArtName(info);
    b.setAttribute("aria-label", b.title);
    b.addEventListener("click", () => addArtSticker(info[0]));
    artGrid.append(b);
    return b;
  });
  const artTextRow = artSection("글상자");
  const artTextBtn = diaryButton("글상자 넣기", "종이 위 아무 데나 글을 얹어요 — 두 번 누르면 고쳐 써요", "diary-btn", "text");
  artTextBtn.addEventListener("click", () => { setArtPanelOpen(false); addTextSticker(); });
  const artTextNote = document.createElement("span");
  artTextNote.className = "diary-style-note";
  artTextRow.append(artTextBtn, artTextNote);

  // 날씨·기분 고르개(머리줄 단추 아래에 뜬다)

  function changeStyle(patch, immediate){
    if (panelEnv.history() && immediate) panelEnv.history().flush();
    const entry = entryOf(panelEnv.current());
    if (entry && entry.style) entry.style = diaryNormalizeStyle({ ...entry.style, ...patch }, name => assets.has(name));
    else model.style = diaryNormalizeStyle({ ...model.style, ...patch }, name => assets.has(name));
    applyStyle();
    layout();
    touch(immediate);
  }
  scopeBox.addEventListener("change", () => {
    if (panelEnv.history()) panelEnv.history().flush();
    if (scopeBox.checked){
      const entry = ensureEntry(panelEnv.current());
      entry.style = { ...model.style };
    } else {
      const entry = entryOf(panelEnv.current());
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
  paperToneRange.addEventListener("input", () => changeStyle({ paperTone:Number(paperToneRange.value) / 100 }, false));
  printPlainBox.addEventListener("change", () => {
    if (panelEnv.history()) panelEnv.history().flush();
    model.printPlain = printPlainBox.checked;
    touch(true);
  });

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
  styleBtn.addEventListener("click", (e) => { e.stopPropagation(); setArtPanelOpen(false); setPanelOpen(panel.hidden); });
  // 고른 스티커의 색을 색 칸에 비춘다(여럿을 골라 색이 섞여 있으면 아무것도 켜지 않는다).
  function syncArtPanel(){
    const picked = selectedStickers().filter(s => diaryStickerKind(s) !== "photo");
    const colors = new Set(picked.map(s => s.color));
    const shown = picked.length ? (colors.size === 1 ? [...colors][0] : "") : stickerColorNow();
    artColorButtons.forEach(b => {
      const on = b.dataset.color === shown;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    // 팔레트에 없는 색(직접 고른 색)이면 칩은 모두 꺼지고 색 칸만 켜진다.
    if (shown) artCustomColor.value = shown;
    artCustomColor.classList.toggle("is-on", !!shown && !DIARY_PENS.some(p => p[0] === shown));
    artCustomColor.title = diaryT("색 직접 고르기");
    artCustomColor.setAttribute("aria-label", artCustomColor.title);
    const opacityPicked = selectedStickers().filter(s => diaryStickerKind(s) !== "photo" || panelEnv.photoOpacity);
    const opacities = new Set(opacityPicked.map(s => s.opacity == null ? 1 : s.opacity));
    const shownOpacity = opacityPicked.length ? (opacities.size === 1 ? [...opacities][0] : null) : stickerOpacityNow();
    artColorChips.parentElement.hidden = !!panelEnv.photoOpacity && !!opacityPicked.length && !picked.length;
    artOpacityRange.value = String(Math.round((shownOpacity == null ? 1 : shownOpacity) * 100));
    artOpacityValue.textContent = shownOpacity == null ? "—" : Math.round(shownOpacity * 100) + "%";
    artOpacityRange.title = diaryT(panelEnv.photoOpacity && opacityPicked.length && !picked.length
      ? "사진 투명도" : "스티커 투명도");
    artOpacityRange.setAttribute("aria-label", artOpacityRange.title);
    artTextNote.textContent = panelEnv.photoOpacity && opacityPicked.length && !picked.length
      ? diaryTf("고른 사진 {n}장의 투명도를 바꿔요.", { n:opacityPicked.length })
      : picked.length
      ? diaryTf("고른 스티커 {n}개의 색을 바꿔요.", { n:picked.length })
      : diaryT("색을 먼저 고르면 그림도 글상자도 그 색으로 붙어요.");
    artButtons.forEach(b => { b.title = diaryArtName(diaryArtInfo(b.dataset.art)); b.setAttribute("aria-label", b.title); });
    artColorButtons.forEach(b => {
      const info = DIARY_PENS.find(p => p[0] === b.dataset.color);
      b.title = info ? (diaryIsEn() ? info[2] : info[1]) : "";
      b.setAttribute("aria-label", b.title);
    });
  }
  const setArtPanelOpen = (open) => {
    artPanel.hidden = !open;
    stickerBtn.setAttribute("aria-expanded", String(open));
    stickerBtn.classList.toggle("is-on", open);
    if (open) syncArtPanel();
  };
  stickerBtn.addEventListener("click", (e) => { e.stopPropagation(); setPanelOpen(false); setArtPanelOpen(artPanel.hidden); });

  return { panel, artPanel, artCustomColor, artOpacityRange, syncPanel, syncArtPanel, setPanelOpen, setArtPanelOpen, changeStyle };
}

/* ===== 인쇄 층의 종이 한 장(일기장·여행일지 공용) =====
   화면을 찍지 않고 A4 폭으로 다시 배치한다. 배경 효과·배경 그림·스티커·원고지 칸·그림 획까지
   화면과 같은 함수로 그리므로 줄바꿈 자리가 흔들리지 않는다.
   printEnv = { assetUrl } · plain 이면 배경을 빼고 찍는다(잉크를 아낀다). */
function diaryBuildPrintPaper(entry, style, width, plain, printEnv){
  const e = entry;                     // 아래 몸통이 쓰던 이름을 그대로 둔다
  const waits = [];
  const paperEl = document.createElement("div");
  paperEl.className = "diary-print-paper";
  paperEl.dataset.lines = style.lines;
  paperEl.style.width = width + "px";
  // 배경 효과 — 화면과 같은 함수로 그린다. 인쇄 층엔 print-color-adjust:exact 가 걸려 있어 그라디언트도 찍힌다.
  if (!plain && style.paper && style.paper !== "none"){
    const art = document.createElement("div");
    art.className = "diary-paper-art";
    paperEl.dataset.paper = diaryPaintPaper(art, style).kind;
    paperEl.append(art);
  }
  const url = plain ? "" : printEnv.assetUrl(style.bg);
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
  for (const st of entry.stickers) stickerBottom = Math.max(stickerBottom, diaryStickerBottom(st) * width);
  const font = DIARY_FONT_STACKS[style.font] || "";
  if (diaryUsesGenko(style)){
    const gm = diaryGenkoMetrics(style, width);
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
    const pm = diaryLineMetrics(style, width);
    if (pm.box){
      const box = document.createElement("div");
      box.className = "diary-picture-box";
      Object.assign(box.style, { left:pm.box.left + "px", top:pm.box.top + "px", width:(width - pm.box.left - pm.box.right) + "px", height:pm.box.height + "px" });
      paperEl.append(box);
    }
  } else {
    const m = diaryLineMetrics(style, width);
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
  for (const st of entry.stickers){
    const kind = diaryStickerKind(st);
    const node = document.createElement("div");
    node.className = "diary-print-sticker diary-sticker-is-" + kind;
    Object.assign(node.style, { left:st.x * width + "px", top:st.y * width + "px", width:st.w * width + "px",
      transform:st.rot ? `rotate(${st.rot}deg)` : "" });
    // 글상자만 높이를 글에 맡긴다 — 글자 크기가 종이 폭 비율이라 680px 에서도 화면과 같은 자리에서 줄이 바뀐다.
    if (kind !== "text") node.style.height = st.w * st.ar * width + "px";
    node.style.opacity = String(st.opacity == null ? 1 : st.opacity);
    if (kind === "art"){
      const art = document.createElement("span");
      art.className = "diary-sticker-body diary-sticker-art";
      art.innerHTML = diaryArtSvg(st.art);
      art.style.color = st.color || DIARY_ART_DEFAULT_COLOR;
      if (st.flip) art.style.transform = "scaleX(-1)";
      node.append(art);
    } else if (kind === "text"){
      const box = document.createElement("div");
      box.className = "diary-sticker-body diary-sticker-text";
      box.textContent = st.text;
      Object.assign(box.style, { fontSize:(st.size * width) + "px", fontFamily:DIARY_FONT_STACKS[st.font] || "",
        color:st.color || DIARY_TEXT_DEFAULT_COLOR, textAlign:st.align || "left" });
      node.append(box);
    } else {
      const img = document.createElement("img");
      img.className = "diary-sticker-body";
      img.src = printEnv.assetUrl(st.asset);
      img.alt = "";
      if (st.flip) img.style.transform = "scaleX(-1)";
      if (img.decode) waits.push(img.decode().catch(() => {}));
      node.append(img);
    }
    paperEl.append(node);
  }
  const pbox = diaryUsesGenko(style) ? diaryLineMetrics(style, width).box : null;
  if (pbox && entry.drawing && entry.drawing.length){
    const bw = width - pbox.left - pbox.right;
    const canvas = document.createElement("canvas");
    canvas.width = bw * 2; canvas.height = pbox.height * 2;               // 인쇄는 두 배로 그려 선이 거칠지 않게
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    diaryDrawStrokes(ctx, entry.drawing, bw);
    const img = document.createElement("img");
    img.className = "diary-print-drawing";
    img.alt = "";
    img.src = canvas.toDataURL("image/png");
    Object.assign(img.style, { left:pbox.left + "px", top:pbox.top + "px", width:bw + "px", height:pbox.height + "px" });
    if (img.decode) waits.push(img.decode().catch(() => {}));
    paperEl.append(img);
  }
  return { paperEl, waits };
}

function mountDiaryEditor(doc){
  const model = doc.diary;
  const assets = doc.diaryAssets || (doc.diaryAssets = new Map());
  const urls = new Map();                      // 사진 이름 → object URL (문서를 닫을 때 풀어 준다)
  const today = diaryDateKey();
  let current = today;
  let viewYear = diaryDateFromKey(today).getFullYear(), viewMonth = diaryDateFromKey(today).getMonth();
  // 고른 스티커들(순서 = 고른 순서). 한 장이면 손잡이(크기·돌리기·떼기·⋯)가 보이고, 여러 장이면 테두리만.
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
      entry = { date:key, title:"", text:"", style:null, weather:"", mood:"", favorite:false, tags:[], drawing:[], stickers:[] };
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
  const undoBtn = diaryButton("", "되돌리기 (Ctrl+Z)", "diary-btn diary-undo-btn", "undo");
  const redoBtn = diaryButton("", "다시 실행 (Ctrl+Y)", "diary-btn diary-redo-btn", "redo");
  const photoBtn = diaryButton("", "사진을 스티커처럼 붙이기 — 종이 위로 끌어다 놓아도 돼요", "diary-btn", "image");
  // 보기 묶음 — 양옆 칸 접기와 몰입 모드. 글자는 applyPanels 가 상태·언어에 맞춰 다시 쓴다.
  const sideToggleBtn = diaryButton("", "달력·찾기 칸 감추기", "diary-btn diary-view-btn diary-side-toggle", "calendar");
  const railToggleBtn = diaryButton("", "일기 목록 감추기", "diary-btn diary-view-btn diary-rail-toggle", "list");
  const focusBtn = diaryButton("", "몰입 모드", "diary-btn diary-view-btn diary-focus-btn", "fit");
  const barViewSep = document.createElement("span");
  barViewSep.className = "diary-bar-sep";
  barViewSep.setAttribute("aria-hidden", "true");
  const stickerBtn = diaryButton("", "스티커 붙이기 — 내장 그림과 글상자", "diary-btn diary-sticker-btn", "sticker");
  stickerBtn.setAttribute("aria-haspopup", "dialog");
  stickerBtn.setAttribute("aria-expanded", "false");
  const styleBtn = diaryButton("", "줄 무늬·배경 그림 바꾸기", "diary-btn diary-style-btn", "sliders");
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
  const barIdentity = document.createElement("div");
  barIdentity.className = "diary-bar-identity";
  barIdentity.append(sideToggleBtn, railToggleBtn, focusBtn, barViewSep, titleInput, status);
  const barActions = document.createElement("div");
  barActions.className = "diary-bar-actions";
  barActions.append(undoBtn, redoBtn, photoBtn, stickerBtn, styleBtn, protectBtn, saveBtn);
  bar.append(barIdentity, barActions, photoInput, bgInput);

  const body = document.createElement("div");
  body.className = "diary-body";
  const side = document.createElement("aside");
  side.className = "diary-side";
  side.setAttribute("aria-label", "달력");
  const sideMobileToggle = diaryButton("달력·검색", "달력과 일기 찾기 열기", "diary-side-mobile-toggle", "calendar");
  const sideTabs = document.createElement("div");
  sideTabs.className = "diary-side-tabs";
  sideTabs.setAttribute("role", "tablist");
  // 탭은 아이콘만 보인다(이름 span 은 CSS 가 감춘다) — 이름은 툴팁·aria-label 로 남는다.
  const makeSideTab = (id, ko, en, icon) => {
    const name = diaryIsEn() ? en : ko;
    const b = diaryButton(name, name, "diary-side-tab", icon);
    b.dataset.sideTab = id; b.setAttribute("role", "tab");
    return b;
  };
  const calendarTab = makeSideTab("calendar", "달력", "Calendar", "calendar");
  const searchTab = makeSideTab("search", "찾기", "Find", "search");
  const photoTab = makeSideTab("photos", "사진", "Photos", "image");
  const reviewTab = makeSideTab("review", "돌아보기", "Review", "chart");
  sideTabs.append(calendarTab, searchTab, photoTab, reviewTab);
  const calendarPane = document.createElement("div");
  calendarPane.className = "diary-side-pane diary-calendar-pane";
  calendarPane.dataset.sidePane = "calendar";
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
  calendarPane.append(calHead, calGrid);

  const searchPane = document.createElement("div");
  searchPane.className = "diary-side-pane diary-search-pane";
  searchPane.dataset.sidePane = "search"; searchPane.hidden = true;
  const searchInput = document.createElement("input");
  searchInput.type = "search"; searchInput.className = "diary-search-input";
  searchInput.placeholder = diaryIsEn() ? "Search this diary" : "이 일기장에서 찾기";
  const searchFilters = document.createElement("div");
  searchFilters.className = "diary-search-filters";
  const searchFilter = document.createElement("select");
  searchFilter.className = "diary-select";
  searchFilter.setAttribute("aria-label", "검색 조건");
  searchFilters.append(searchFilter);
  const searchResults = document.createElement("div");
  searchResults.className = "diary-search-results ui-keep-symbols";
  searchPane.append(searchInput, searchFilters, searchResults);

  // 사진만 모아 보기 — 날짜마다 흩어진 사진을 한 칸에 모아 놓는다(누르면 그 날의 그 사진으로 간다).
  const photoPane = document.createElement("div");
  photoPane.className = "diary-side-pane diary-photo-pane";
  photoPane.dataset.sidePane = "photos"; photoPane.hidden = true;

  const reviewPane = document.createElement("div");
  reviewPane.className = "diary-side-pane diary-review-pane ui-keep-symbols";
  reviewPane.dataset.sidePane = "review"; reviewPane.hidden = true;
  side.append(sideMobileToggle, sideTabs, calendarPane, searchPane, photoPane, reviewPane);

  const entryRail = document.createElement("section");
  entryRail.className = "diary-entry-rail";
  entryRail.setAttribute("aria-label", diaryIsEn() ? "Diary card list" : "일기 카드 목록");
  entryRail.append(monthList);

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
  // 공휴일·24절기 이름(한국천문연구원 특일 정보 — EXE 에 공공데이터포털 키가 있을 때만 보인다)
  const specialBadge = document.createElement("span");
  specialBadge.className = "diary-special";
  specialBadge.hidden = true;
  const entryTitle = document.createElement("input");
  entryTitle.className = "diary-entry-title";
  entryTitle.type = "text";
  entryTitle.maxLength = 200;
  entryTitle.placeholder = "제목(선택)";
  entryTitle.setAttribute("aria-label", "이 날 일기 제목");
  const deleteBtn = diaryButton("", "이 날 일기 지우기", "diary-btn diary-danger", "delete");
  const favoriteBtn = diaryButton("", "기억하고 싶은 날로 표시", "diary-btn diary-favorite ui-keep-symbols");
  const favoriteMark = document.createElement("span"); favoriteMark.className = "diary-favorite-mark"; favoriteMark.textContent = "★";
  favoriteMark.setAttribute("aria-hidden", "true"); favoriteBtn.append(favoriteMark);
  favoriteBtn.setAttribute("aria-pressed", "false");
  const templateBtn = diaryButton("글감", "작성 질문과 양식 고르기", "diary-btn diary-template-btn");
  // 날씨·기분 — 그림 글자를 쓰므로 ui-keep-symbols 로 icons.js 의 이모지 지우기를 피한다.
  const weatherBtn = diaryButton("", "날씨 고르기", "diary-btn diary-pick ui-keep-symbols");
  weatherBtn.dataset.pick = "weather";
  const moodBtn = diaryButton("", "기분 고르기", "diary-btn diary-pick ui-keep-symbols");
  moodBtn.dataset.pick = "mood";
  const dateRow = document.createElement("div");
  dateRow.className = "diary-date-row";
  dateRow.append(prevDay, dateLabel, todayBadge, specialBadge, nextDay);
  const titleRow = document.createElement("div");
  titleRow.className = "diary-title-row";
  titleRow.append(entryTitle, weatherBtn, moodBtn, favoriteBtn, templateBtn, deleteBtn);
  const tagRow = document.createElement("div");
  tagRow.className = "diary-tag-row";
  const tagList = document.createElement("div");
  tagList.className = "diary-tag-list";
  const tagInput = document.createElement("input");
  tagInput.className = "diary-tag-input"; tagInput.type = "text"; tagInput.maxLength = 24;
  tagInput.placeholder = diaryIsEn() ? "Add tag" : "태그 추가";
  tagInput.setAttribute("aria-label", "태그 추가");
  tagRow.append(tagList, tagInput);
  pageHead.append(dateRow, titleRow, tagRow);

  const paper = document.createElement("div");
  paper.className = "diary-paper";
  // 층 차례: 배경 효과 → 배경 사진 → 덮개 → 글. 효과를 맨 아래 두어야 사진을 깔아도 사진이 이긴다.
  const artBgLayer = document.createElement("div");
  artBgLayer.className = "diary-paper-art";
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
  const pictureBtn = diaryButton("", "그림 칸에 사진 넣기 — 여러 장이면 칸을 나눠 맞춰요", "diary-btn diary-picture-photo", "image");
  const pictureInput = document.createElement("input");
  pictureInput.type = "file"; pictureInput.accept = "image/*"; pictureInput.multiple = true; pictureInput.hidden = true;   // 여러 장이면 칸을 나눠 맞춘다
  const pictureDrawBtn = diaryButton("", "그림 칸에 그리기", "diary-btn diary-picture-draw", "pen");
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
  // 팔레트 10색 다음에 '직접 고르기' 칸 — 여기서 고른 색도 다음에 칠할 색이 된다.
  const penCustomColor = diaryColorInput("diary-pen-custom", (color, live) => setPenColor(color, live));
  drawBar.append(penCustomColor);
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
  drawLayer.append(drawCanvas, drawBar);
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
  paper.append(artBgLayer, bgLayer, veilLayer, area, genkoLayer, pictureBox, stickerLayer, drawLayer);
  main.append(pageHead, paper);
  body.append(side, entryRail, main);

  const pickPop = document.createElement("div");
  pickPop.className = "diary-pick-pop ui-keep-symbols";
  pickPop.hidden = true;
  pickPop.setAttribute("role", "dialog");
  const templatePanel = document.createElement("div");
  templatePanel.className = "diary-template-panel";
  templatePanel.hidden = true;
  templatePanel.setAttribute("role", "dialog");
  templatePanel.setAttribute("aria-label", "작성 질문과 양식");
  const lockScreen = document.createElement("div");
  lockScreen.className = "diary-screen-lock"; lockScreen.hidden = true;
  const lockIcon = document.createElement("span");
  lockIcon.className = "diary-screen-lock-icon";
  if (typeof window.uiIcon === "function") lockIcon.innerHTML = window.uiIcon("lock");
  const lockTitle = document.createElement("strong"); lockTitle.textContent = "일기장이 잠겼어요";
  const lockNote = document.createElement("p"); lockNote.textContent = "내용을 다시 보려면 파일 암호를 입력하세요.";
  const unlockBtn = diaryButton("잠금 풀기", "일기장 화면 잠금 풀기", "diary-btn diary-primary", "lock");
  lockScreen.append(lockIcon, lockTitle, lockNote, unlockBtn);
  root.append(bar, body, pickPop, templatePanel, lockScreen);
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

  /* ----- 공휴일·24절기와 기상청 날씨 -----
     런처(EXE)가 공공데이터포털 키로 대신 묻는다. 브라우저·오프라인 HTML 에서는 아무것도 보이지 않는다.
     특일은 보고 있는 달만 묻는다. 키 문제로 실패한 달은 이 창에서 다시 묻지 않는다(달력을 그릴 때마다 헛걸음하지 않게). */
  const weatherApi = typeof MNWeatherApi !== "undefined" ? MNWeatherApi : null;
  let weatherReady = false;
  const specialFailed = new Set();
  const specialItemsOf = (key) => {
    if (!weatherReady) return [];
    const items = weatherApi.cachedSpecialDays(Number(key.slice(0, 4)), Number(key.slice(5, 7)));
    return items ? items.filter(i => i.date === key) : [];
  };
  function requestSpecialMonth(year, month){
    const ym = year * 100 + month;
    if (!weatherReady || specialFailed.has(ym) || weatherApi.cachedSpecialDays(year, month)) return;
    weatherApi.loadSpecialDays(year, month).then(() => {
      if (!root.isConnected) return;
      paintSpecialDays(); renderSpecialBadge();
    }).catch(() => { specialFailed.add(ym); });
  }
  function paintSpecialDays(){
    if (!weatherReady) return;
    if (!weatherApi.cachedSpecialDays(viewYear, viewMonth + 1)){ requestSpecialMonth(viewYear, viewMonth + 1); return; }
    for (const b of calGrid.querySelectorAll(".diary-cal-day")){
      if (b.dataset.special) continue;
      const found = specialItemsOf(b.dataset.date);
      if (!found.length) continue;
      const names = found.map(i => i.name).join(" · ");
      b.dataset.special = names;
      b.classList.toggle("is-holiday", found.some(i => i.holiday));
      b.classList.toggle("is-term", found.some(i => i.term));
      b.title = names;
      b.setAttribute("aria-label", b.getAttribute("aria-label") + " · " + names);
    }
  }
  function renderSpecialBadge(){
    const found = specialItemsOf(current);
    if (weatherReady && !weatherApi.cachedSpecialDays(Number(current.slice(0, 4)), Number(current.slice(5, 7))))
      requestSpecialMonth(Number(current.slice(0, 4)), Number(current.slice(5, 7)));
    specialBadge.hidden = !found.length;
    specialBadge.textContent = found.map(i => i.name).join(" · ");
    specialBadge.classList.toggle("is-holiday", found.some(i => i.holiday));
  }
  // 날씨 고르개 아래 '기상청 날씨로 채우기' — 지난 날은 관측(어제까지), 오늘은 지금 실황, 앞날은 단기예보.
  // 단기예보가 닿는 날은 발표 시각마다 다르다(2026-09 실측: 사흘 뒤까지 온전, 나흘·닷새 뒤는 일부) → 예보에 그날이 있는지로 가른다.
  const wxNumber = v => v == null ? "" : String(Math.round(v * 10) / 10);
  function weatherSummary(parts){ return parts.filter(Boolean).join(" · "); }
  async function fillWeatherFromKma(place, button, note){
    const s = weatherApi.station(place.value);
    if (!s) return;
    weatherApi.saveStation(s.id);
    const key = current;
    const ahead = Math.round((diaryDateFromKey(key) - diaryDateFromKey(today)) / 86400000);
    if (ahead > 5){ note.textContent = diaryT("기상청 예보에 아직 이 날이 없어요."); return; }
    button.disabled = true;
    note.textContent = diaryT("기상청 날씨를 받는 중…");
    let value = "", summary = "", service = ahead < 0 ? "day" : "forecast";
    try {
      if (ahead < 0){
        const d = await weatherApi.loadDay(s.id, key);
        value = d.diary;
        summary = weatherSummary([diaryTf("{place} 관측", { place:d.station || s.name }),
          d.max != null ? diaryTf("최고 {max}°", { max:wxNumber(d.max) }) : "",
          d.min != null ? diaryTf("최저 {min}°", { min:wxNumber(d.min) }) : "",
          d.rain != null && d.rain > 0 ? diaryTf("비 {mm}mm", { mm:wxNumber(d.rain) }) : ""]);
      } else if (ahead === 0){
        const n = await weatherApi.loadNow(s.lat, s.lng);
        value = n.diary;
        summary = weatherSummary([diaryTf("{place} 지금", { place:s.name }),
          n.temp != null ? diaryTf("기온 {t}°", { t:wxNumber(n.temp) }) : "",
          n.rain1h != null && n.rain1h > 0 ? diaryTf("비 {mm}mm", { mm:wxNumber(n.rain1h) }) : ""]);
      } else {
        const f = await weatherApi.loadForecast(s.lat, s.lng);
        const day = f.days.find(d => d.date === key.replace(/-/g, "") && d.sky != null);
        if (!day){ note.textContent = diaryT("기상청 예보에 아직 이 날이 없어요."); button.disabled = false; return; }
        value = day.diary;
        summary = weatherSummary([diaryTf("{place} 예보", { place:s.name }),
          day.max != null ? diaryTf("최고 {max}°", { max:wxNumber(day.max) }) : "",
          day.min != null ? diaryTf("최저 {min}°", { min:wxNumber(day.min) }) : "",
          day.popMax != null ? diaryTf("강수확률 {p}%", { p:day.popMax }) : ""]);
      }
    } catch(error){
      if (root.isConnected && current === key) note.textContent = diaryT(weatherApi.failureText(error, service));
      button.disabled = false;
      return;
    }
    button.disabled = false;
    if (!root.isConnected || current !== key) return;
    if (!value){ note.textContent = diaryT("기상청 자료로 날씨를 정하지 못했어요."); return; }
    setEntryField("weather", value);
    // 고르개가 아직 열려 있으면 고른 값이 보이게 다시 그리고 받은 내용을 그 아래에 남긴다.
    if (!pickPop.hidden && pickPop.dataset.kind === "weather") openPicker("weather", weatherBtn, summary);
  }
  if (weatherApi) weatherApi.available().then(ok => {
    if (!ok || !root.isConnected) return;
    weatherReady = true;
    paintSpecialDays(); renderSpecialBadge();
  });

  /* ----- 우리 학교(NEIS 급식·학사일정·시간표) -----
     EXE 에서만 보인다(런처가 NEIS 키를 들고 대신 묻는다). 고른 학교는 이 브라우저에 남고 일기장 파일에는 담지 않는다.
     보고 있는 달의 급식·학사일정을 한 번에 받아 두고(달력 표시·날짜 줄에 같이 쓴다), 시간표는 그날만 묻는다. */
  const neisApi = typeof MNNeisApi !== "undefined" ? MNNeisApi : null;
  // 한두 낱말(급식·반·학년)은 i18n 사전에 넣지 않는다 — 사전은 같은 글 조각을 화면 어디서나 바꾼다.
  const schoolWord = (ko, en) => diaryIsEn() ? en : ko;
  let neisReady = false, school = neisApi ? neisApi.savedSchool() : null;
  const schoolMonths = new Map(), schoolLoading = new Set(), schoolFailed = new Map();
  // 학교마다 학년·반 목록(NEIS 학급정보) — 한 번 받은 것은 이 창에서 다시 묻지 않는다.
  const schoolClasses = new Map();
  // 학교 정보 카드(학교 찾기 응답의 자세한 칸) — 학교마다 한 번.
  const schoolDetails = new Map();
  function renderSchoolCard(card){
    const asked = schoolKey();
    let task = schoolDetails.get(asked);
    if (!task){
      task = neisApi.loadSchoolDetail(school);
      schoolDetails.set(asked, task);
      task.catch(() => schoolDetails.delete(asked));
    }
    card.textContent = diaryT("학교 정보를 받는 중…");
    task.then(info => {
      if (asked !== schoolKey() || !card.isConnected) return;
      card.replaceChildren();
      if (!info){ card.textContent = diaryT("학교 정보를 찾지 못했어요."); return; }
      const en = diaryIsEn();
      const date = (p, withYear) => !p ? "" : en
        ? new Date(p.y || 2000, p.m - 1, p.d).toLocaleDateString("en-US", withYear ? { year:"numeric", month:"short", day:"numeric" } : { month:"short", day:"numeric" })
        : (withYear && p.y ? p.y + "년 " : "") + p.m + "월 " + p.d + "일";
      const rows = [
        [schoolWord("구분", "Type"), [info.kind, info.found, info.coed, info.highKind].filter(Boolean).join(" · ")],
        [schoolWord("주소", "Address"), [info.zip ? "(" + info.zip + ")" : "", info.address].filter(Boolean).join(" ")],
        [schoolWord("전화", "Phone"), [info.phone, info.fax ? schoolWord("팩스", "Fax") + " " + info.fax : ""].filter(Boolean).join(" · ")],
        [schoolWord("홈페이지", "Website"), info.homepage],
        [schoolWord("관할", "Office"), info.office],
        [schoolWord("개교기념일", "Founding day"), date(info.anniversary, false)],
        [schoolWord("설립일", "Established"), date(info.founded, true)]
      ].filter(([, value]) => value);
      for (const [label, value] of rows){
        const row = document.createElement("div"); row.className = "diary-school-card-row";
        const head = document.createElement("span"); head.className = "diary-school-card-label"; head.textContent = label;
        let body;
        if (value === info.homepage){
          // 새 창으로 연다(일기장을 떠나지 않게). 주소는 http(s) 만 받는다(neis-api.js homepage).
          body = document.createElement("a");
          body.href = value; body.target = "_blank"; body.rel = "noopener noreferrer";
          body.textContent = value.replace(/^https?:\/\//, "").replace(/\/$/, "");
        } else {
          body = document.createElement("span"); body.textContent = value;
        }
        body.classList.add("diary-school-card-value");
        row.append(head, body);
        card.append(row);
      }
    }, error => {
      if (asked === schoolKey() && card.isConnected) card.textContent = diaryT(neisApi.failureText(error));
    });
  }
  const schoolBtn = diaryButton("", "우리 학교 — 급식·학사일정·시간표", "diary-btn diary-school-btn", "school");
  schoolBtn.hidden = true;
  schoolBtn.setAttribute("aria-haspopup", "dialog");
  schoolBtn.setAttribute("aria-expanded", "false");
  barActions.insertBefore(schoolBtn, saveBtn);
  const schoolStrip = document.createElement("div");
  schoolStrip.className = "diary-school";
  schoolStrip.hidden = true;
  main.insertBefore(schoolStrip, paper);
  const schoolPanel = document.createElement("div");
  schoolPanel.className = "diary-school-panel";
  schoolPanel.hidden = true;
  schoolPanel.setAttribute("role", "dialog");
  schoolPanel.setAttribute("aria-label", schoolWord("우리 학교", "My school"));
  root.append(schoolPanel);

  const schoolYm = (key) => key.slice(0, 7);
  const schoolKey = () => school ? school.office + school.code : "";
  function schoolMonth(key){ return schoolMonths.get(schoolKey() + "|" + schoolYm(key)) || null; }
  function requestSchoolMonth(year, month){
    if (!neisReady || !school) return;
    const ym = year + "-" + String(month).padStart(2, "0"), id = schoolKey() + "|" + ym;
    if (schoolMonths.has(id) || schoolLoading.has(id) || schoolFailed.has(id)) return;
    schoolLoading.add(id);
    const asked = schoolKey();
    neisApi.loadMonth(school, year, month).then(data => {
      schoolMonths.set(id, data);
    }, error => { schoolFailed.set(id, error); }).finally(() => {
      schoolLoading.delete(id);
      if (!root.isConnected || asked !== schoolKey()) return;
      paintSchoolDays(); renderSchoolStrip();
    });
  }
  function paintSchoolDays(){
    if (!neisReady || !school) return;
    requestSchoolMonth(viewYear, viewMonth + 1);
    const data = schoolMonths.get(schoolKey() + "|" + viewYear + "-" + String(viewMonth + 1).padStart(2, "0"));
    if (!data) return;
    for (const b of calGrid.querySelectorAll(".diary-cal-day")){
      if (b.dataset.school) continue;
      const events = data.schedule.get(b.dataset.date) || [];
      if (!events.length) continue;
      const names = events.map(e => e.name).join(" · ");
      b.dataset.school = names;
      b.classList.add("has-school-event");
      b.classList.toggle("is-school-off", events.some(e => e.off));
      b.title = [b.title, names].filter(Boolean).join(" · ");
      b.setAttribute("aria-label", b.getAttribute("aria-label") + " · " + names);
    }
  }
  let timetableSeq = 0;
  function renderSchoolStrip(){
    schoolStrip.hidden = !neisReady || !school;
    schoolBtn.classList.toggle("is-set", !!school);
    if (schoolStrip.hidden){ schoolStrip.replaceChildren(); return; }
    const key = current;
    requestSchoolMonth(Number(key.slice(0, 4)), Number(key.slice(5, 7)));
    const data = schoolMonth(key);
    const failed = schoolFailed.get(schoolKey() + "|" + schoolYm(key));
    const line = (label, cls) => {
      const row = document.createElement("div"); row.className = "diary-school-row " + cls;
      const head = document.createElement("span"); head.className = "diary-school-label"; head.textContent = label;
      const body = document.createElement("span"); body.className = "diary-school-text";
      row.append(head, body);
      return { row, body };
    };
    const title = document.createElement("div");
    title.className = "diary-school-name";
    title.textContent = school.name + (school.grade && school.cls ? " · " + (diaryIsEn() ? "Grade " + school.grade + ", class " + school.cls : school.grade + "학년 " + school.cls + "반") : "");
    const rows = [title];
    if (failed && !data){
      const note = document.createElement("div"); note.className = "diary-school-note ui-keep-symbols";
      note.textContent = diaryT(neisApi.failureText(failed));
      rows.push(note);
    } else if (!data){
      const note = document.createElement("div"); note.className = "diary-school-note";
      note.textContent = diaryT("학교 정보를 받는 중…");
      rows.push(note);
    } else {
      const meals = data.meals.get(key) || [];
      const events = data.schedule.get(key) || [];
      const meal = line(schoolWord("급식", "Lunch"), "is-meal");
      if (meals.length){
        meal.body.textContent = meals.map(m => (meals.length > 1 ? m.type + " " : "") + m.dishes.join(", ")).join(" / ");
        const insert = diaryButton("일기에 넣기", "급식 메뉴를 일기 끝에 한 줄로 넣기", "diary-btn diary-school-insert");
        insert.addEventListener("click", () => {
          const text = neisApi.mealLine(meals);
          if (!text) return;
          area.value = area.value + (area.value && !area.value.endsWith("\n") ? "\n" : "") + text;
          area.dispatchEvent(new Event("input", { bubbles:true }));
          area.focus();
        });
        meal.row.append(insert);
      } else meal.body.textContent = diaryT("급식 정보가 없어요");
      rows.push(meal.row);
      if (events.length){
        const ev = line(schoolWord("일정", "Events"), "is-event");
        ev.body.textContent = events.map(e => e.name).join(" · ");
        rows.push(ev.row);
      }
      const tt = line(schoolWord("시간표", "Timetable"), "is-timetable");
      tt.body.textContent = school.grade && school.cls ? diaryT("시간표를 받는 중…") : diaryT("학년·반을 고르면 시간표가 보여요");
      rows.push(tt.row);
      if (school.grade && school.cls){
        const seq = ++timetableSeq, asked = schoolKey();
        neisApi.loadTimetable(school, key).then(list => {
          if (seq !== timetableSeq || key !== current || asked !== schoolKey()) return;
          tt.body.textContent = list.length ? list.map(p => p.period + "교시 " + p.subject).join(" · ") : diaryT("시간표가 없어요");
        }, error => {
          if (seq !== timetableSeq || key !== current) return;
          tt.body.textContent = diaryT(neisApi.failureText(error));
        });
      }
      if (data.truncated){
        const note = document.createElement("div"); note.className = "diary-school-note ui-keep-symbols";
        note.textContent = diaryT("NEIS 인증키가 없어 일부(5줄)만 보여요. 설정 → 연결에서 'NEIS 교육정보' 키를 넣어 주세요.");
        rows.push(note);
      }
    }
    schoolStrip.replaceChildren(...rows);
  }

  // 학교 고르기 창
  function renderSchoolPanel(results, status){
    const head = document.createElement("div"); head.className = "diary-style-label"; head.textContent = schoolWord("우리 학교", "My school");
    const now = document.createElement("div"); now.className = "diary-school-current";
    now.textContent = school ? school.name + (school.kind ? " (" + school.kind + ")" : "") : diaryT("아직 고른 학교가 없어요");
    const form = document.createElement("form"); form.className = "diary-school-form";
    const input = document.createElement("input");
    input.type = "search"; input.className = "diary-school-q"; input.maxLength = 40;
    input.placeholder = diaryT("학교 이름 (예: 가락초)"); input.setAttribute("aria-label", schoolWord("학교 이름", "School name"));
    const find = diaryButton("찾기", "학교 찾기", "diary-btn");
    find.type = "submit";
    form.append(input, find);
    const list = document.createElement("div"); list.className = "diary-school-results";
    for (const s of results || []){
      const b = document.createElement("button");
      b.type = "button"; b.className = "diary-school-result";
      const name = document.createElement("strong"); name.textContent = s.name;
      const meta = document.createElement("small"); meta.textContent = [s.kind, s.address || s.region].filter(Boolean).join(" · ");
      b.append(name, meta);
      b.addEventListener("click", () => {
        school = { office:s.office, code:s.code, name:s.name, kind:s.kind, grade:"", cls:"" };
        neisApi.saveSchool(school);
        schoolMonths.clear(); schoolFailed.clear();
        renderCalendar(); renderSchoolStrip(); renderSchoolPanel([], "");
      });
      list.append(b);
    }
    const note = document.createElement("div"); note.className = "diary-school-note ui-keep-symbols"; note.textContent = status || "";
    const parts = [head, now];
    if (school){
      const card = document.createElement("div");
      card.className = "diary-school-card ui-keep-symbols";
      parts.push(card);
      renderSchoolCard(card);
    }
    parts.push(form, list);
    if (school){
      /* 시간표는 학년·반이 있어야 묻는다. 학년·반은 NEIS 학급정보의 실제 목록에서 고른다.
         목록을 받기 전·못 받았을 때(키 없는 5줄 샘플 포함)는 학년 1~3(초등 1~6)과 반 직접 입력으로 둔다. */
      const row = document.createElement("div"); row.className = "diary-school-class";
      const grade = document.createElement("select"); grade.className = "diary-select diary-school-grade"; grade.setAttribute("aria-label", schoolWord("학년", "Grade"));
      const clsPick = document.createElement("select"); clsPick.className = "diary-select diary-school-cls-pick"; clsPick.setAttribute("aria-label", schoolWord("반", "Class"));
      clsPick.hidden = true;
      const cls = document.createElement("input"); cls.className = "diary-school-cls"; cls.maxLength = 6; cls.setAttribute("aria-label", schoolWord("반", "Class"));
      cls.value = school.cls; cls.placeholder = schoolWord("반", "Class");
      const option = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; return o; };
      const gradeLabel = g => diaryIsEn() ? "Grade " + g : g + "학년";
      const classLabel = c => /^\d+$/.test(c) ? (diaryIsEn() ? "Class " + c : c + "반") : c;
      let listed = null;   // { byGrade, complete } — 받은 학년·반 목록
      const fillGrades = (grades) => {
        grade.replaceChildren(option("", schoolWord("학년", "Grade")), ...grades.map(g => option(g, gradeLabel(g))));
        // 목록에 없는 저장값(지난 학년도의 반 등)도 보이게 남긴다.
        if (school.grade && !grades.includes(school.grade)) grade.append(option(school.grade, gradeLabel(school.grade)));
        grade.value = school.grade;
      };
      const fillClasses = () => {
        const list = (listed && listed.byGrade[grade.value]) || [];
        clsPick.replaceChildren(option("", schoolWord("반", "Class")), ...list.map(c => option(c, classLabel(c))));
        if (school.cls && grade.value === school.grade && !list.includes(school.cls)) clsPick.append(option(school.cls, classLabel(school.cls)));
        clsPick.value = grade.value === school.grade ? school.cls : "";
        clsPick.disabled = !grade.value;
      };
      const useList = () => listed && listed.complete && Object.keys(listed.byGrade).length > 0;
      const syncControls = () => {
        const on = useList();
        clsPick.hidden = !on; cls.hidden = on;
        if (on) fillClasses();
      };
      fillGrades(Array.from({ length:/초등/.test(school.kind) ? 6 : 3 }, (_, i) => String(i + 1)));
      const apply = () => {
        const c = (useList() ? clsPick.value : cls.value).trim();
        school = { ...school, grade:grade.value, cls:/^[0-9A-Za-z가-힣]{1,6}$/.test(c) ? c : "" };
        neisApi.saveSchool(school);
        renderSchoolStrip();
      };
      grade.addEventListener("change", () => {
        // 학년을 바꾸면 그 학년의 반 목록으로 — 전 학년의 반이 새 학년에 없으면 비운다.
        if (useList()){
          const list = listed.byGrade[grade.value] || [];
          if (!list.includes(clsPick.value)) clsPick.value = "";
          school = { ...school, grade:grade.value, cls:list.includes(school.cls) ? school.cls : "" };
          fillClasses();
        }
        apply();
      });
      clsPick.addEventListener("change", apply);
      cls.addEventListener("change", apply);
      const asked = schoolKey();
      let task = schoolClasses.get(asked);
      if (!task){
        task = neisApi.loadClasses(school);
        schoolClasses.set(asked, task);
        task.catch(() => schoolClasses.delete(asked));   // 실패는 다음에 창을 열 때 다시 묻는다
      }
      task.then(result => {
        if (asked !== schoolKey() || !grade.isConnected) return;
        listed = result;
        if (useList()) fillGrades(Object.keys(result.byGrade).sort());
        syncControls();
      }, () => {});
      row.append(grade, clsPick, cls);
      const forget = diaryButton("학교 빼기", "고른 학교를 지우기", "diary-btn");
      forget.addEventListener("click", () => {
        school = null; neisApi.saveSchool(null);
        schoolMonths.clear(); schoolFailed.clear();
        renderCalendar(); renderSchoolStrip(); renderSchoolPanel([], "");
      });
      parts.push(row, forget);
    }
    parts.push(note);
    schoolPanel.replaceChildren(...parts);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q){ input.focus(); return; }
      find.disabled = true; note.textContent = diaryT("학교를 찾는 중…");
      try {
        const found = await neisApi.searchSchools(q);
        const message = !found.schools.length ? diaryT("찾은 학교가 없어요. 이름 일부로 다시 찾아 보세요.")
          : found.sample && found.total > found.schools.length ? diaryT("NEIS 인증키가 없어 앞의 5곳만 보여요.") : "";
        renderSchoolPanel(found.schools, message);
        const again = schoolPanel.querySelector(".diary-school-q"); if (again) again.value = q;
      } catch(error){ note.textContent = diaryT(neisApi.failureText(error)); find.disabled = false; }
    });
  }
  const setSchoolOpen = (open) => {
    schoolPanel.hidden = !open;
    schoolBtn.setAttribute("aria-expanded", String(open));
    schoolBtn.classList.toggle("is-on", open);
    if (open){
      renderSchoolPanel([], "");
      const input = schoolPanel.querySelector(".diary-school-q"); if (input) input.focus();
    }
  };
  schoolBtn.addEventListener("click", (e) => { e.stopPropagation(); setSchoolOpen(schoolPanel.hidden); });
  schoolPanel.addEventListener("keydown", (e) => { if (e.key === "Escape"){ e.preventDefault(); setSchoolOpen(false); schoolBtn.focus(); } });
  const onSchoolOutside = (e) => {
    if (schoolPanel.hidden || schoolPanel.contains(e.target) || schoolBtn.contains(e.target)) return;
    setSchoolOpen(false);
  };
  document.addEventListener("pointerdown", onSchoolOutside, true);
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => document.removeEventListener("pointerdown", onSchoolOutside, true));
  if (neisApi) neisApi.available().then(ok => {
    if (!ok || !root.isConnected) return;
    neisReady = true;
    schoolBtn.hidden = false;
    paintSchoolDays(); renderSchoolStrip();
  });

  /* ----- 왼쪽 탐색: 달력 · 일기 찾기 · 돌아보기 ----- */
  let activeSideTab = "calendar";
  function syncSearchFilterOptions(){
    const value = searchFilter.value || "all";
    const labels = diaryIsEn()
      ? [["all", "All entries"], ["favorite", "Favorites"], ["photo", "With photos"], ["tag", "With tags"], ["mood", "Mood or weather"]]
      : [["all", "모든 일기"], ["favorite", "즐겨찾기"], ["photo", "사진이 있는 날"], ["tag", "태그가 있는 날"], ["mood", "기분·날씨가 있는 날"]];
    searchFilter.replaceChildren(...labels.map(([id, label]) => {
      const option = document.createElement("option"); option.value = id; option.textContent = label; return option;
    }));
    searchFilter.value = labels.some(([id]) => id === value) ? value : "all";
  }
  function setSideTab(id, focus){
    activeSideTab = ["calendar", "search", "photos", "review"].includes(id) ? id : "calendar";
    for (const tab of sideTabs.querySelectorAll(".diary-side-tab")){
      const on = tab.dataset.sideTab === activeSideTab;
      tab.classList.toggle("is-on", on); tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1;
    }
    for (const pane of side.querySelectorAll(".diary-side-pane")) pane.hidden = pane.dataset.sidePane !== activeSideTab;
    side.classList.remove("is-mobile-collapsed");
    if (activeSideTab === "calendar") renderCalendar();
    if (activeSideTab === "search"){ renderSearchResults(); if (focus) searchInput.focus(); }
    if (activeSideTab === "photos") renderPhotoWall();
    if (activeSideTab === "review"){ renderReview(); renderCalendar(); }
  }
  const entryExcerpt = entry => {
    const text = String(entry && entry.text || "").replace(/\s+/g, " ").trim();
    if (text) return text.length > 84 ? text.slice(0, 84) + "…" : text;
    const marks = diaryWeatherMoodLabel(entry);
    if (marks) return marks;
    if (entry && entry.tags && entry.tags.length) return entry.tags.map(tag => "#" + tag).join(" ");
    if (entry && entry.drawing && entry.drawing.length) return diaryIsEn() ? "Drawing" : "그림이 있는 일기";
    return diaryIsEn() ? "No text" : "글이 없는 일기";
  };
  function buildEntryCard(entry){
    const button = document.createElement("button");
    button.type = "button";
    button.className = "diary-month-item diary-entry-card" + (entry.date === current ? " is-selected" : "");
    button.dataset.date = entry.date;
    const content = document.createElement("span"); content.className = "diary-entry-card-content";
    const top = document.createElement("span"); top.className = "diary-entry-card-top";
    const day = document.createElement("span"); day.className = "diary-month-item-day"; day.textContent = diaryUiListDay(entry.date);
    top.append(day);
    if (entry.favorite){ const star = document.createElement("span"); star.className = "diary-month-item-favorite"; star.textContent = "★"; top.append(star); }
    const mark = diaryMoodInfo(entry.mood) || diaryWeatherInfo(entry.weather);
    if (mark){ const em = document.createElement("span"); em.className = "diary-month-item-emoji"; diaryMarkFill(em, mark); top.append(em); }
    const label = document.createElement("strong"); label.className = "diary-month-item-label"; label.textContent = diaryEntryLabel(entry);
    const excerpt = document.createElement("span"); excerpt.className = "diary-entry-card-excerpt"; excerpt.textContent = entryExcerpt(entry);
    content.append(top, label, excerpt);
    if (entry.tags && entry.tags.length){
      const tags = document.createElement("span"); tags.className = "diary-entry-card-tags";
      tags.textContent = entry.tags.slice(0, 3).map(tag => "#" + tag).join(" "); content.append(tags);
    }
    button.append(content);
    const cardPhotos = entry.stickers ? entry.stickers.filter(sticker => assetUrl(sticker.asset)) : [];
    const firstSticker = cardPhotos[0] || null;
    // 사진이 없어도 내장 그림을 붙였으면 그 그림을 보여 준다(꾸민 날이 빈 칸으로 보이지 않게).
    const firstArt = !firstSticker && entry.stickers
      ? entry.stickers.find(sticker => diaryStickerKind(sticker) === "art" && diaryArtInfo(sticker.art)) : null;
    const hasDrawing = !!(entry.drawing && entry.drawing.length);
    const thumb = document.createElement("span");
    thumb.className = "diary-entry-card-thumb" + (!firstSticker && !firstArt && !hasDrawing ? " is-empty" : "");
    // 그 날 종이 배경도 작게 깔아 둔다 — 목록만 봐도 어떻게 꾸민 날인지 보인다.
    // "없음"일 땐 칠하지 않는다: 인라인 배경이 빈 칸 무늬(.is-empty)를 덮어 버린다.
    const cardStyle = diaryEffectiveStyle(model, entry);
    if (cardStyle.paper !== "none") diaryPaintPaper(thumb, cardStyle);
    if (firstSticker){
      // 사진이 여러 장인 날은 앞의 세 장을 모자이크로 깔고 남은 장수를 +N 으로 알린다 —
      // 한 장만 보이면 목록에서 '사진 많은 날'이 사진 한 장인 날과 똑같이 보인다.
      const shots = cardPhotos.slice(0, 3);
      if (shots.length > 1) thumb.dataset.photos = String(shots.length);
      for (const shot of shots){
        const img = document.createElement("img"); img.src = assetUrl(shot.asset); img.alt = ""; thumb.append(img);
      }
      if (cardPhotos.length > shots.length){
        const more = document.createElement("span");
        more.className = "diary-entry-card-more";
        more.textContent = "+" + (cardPhotos.length - shots.length);
        thumb.append(more);
      }
      button.append(thumb);
    } else if (firstArt && !hasDrawing){
      const art = document.createElement("span");
      art.className = "diary-entry-card-art";
      art.innerHTML = diaryArtSvg(firstArt.art);
      art.style.color = firstArt.color || DIARY_ART_DEFAULT_COLOR;
      art.style.opacity = String(firstArt.opacity == null ? 1 : firstArt.opacity);
      thumb.append(art);
    }
    if (hasDrawing){
      // 그림 칸의 가로·세로 비율을 유지한 별도 레이어라 사진이 있어도 지우개 획이 사진까지 지우지 않는다.
      const sourceWidth = 1000;
      const box = diaryPictureBox(diaryEffectiveStyle(model, entry), sourceWidth);
      const canvas = document.createElement("canvas");
      canvas.className = "diary-entry-card-drawing";
      canvas.width = 192;
      canvas.height = Math.max(1, Math.round(canvas.width * box.height / sourceWidth));
      diaryDrawStrokes(canvas.getContext("2d"), entry.drawing, canvas.width);
      thumb.append(canvas);
    } else if (!firstSticker && !firstArt && mark){
      const em = document.createElement("span"); em.className = "diary-entry-card-mark"; diaryMarkFill(em, mark); thumb.append(em);
    }
    if (!firstSticker) button.append(thumb);
    button.setAttribute("aria-label", diaryUiDateLabel(entry.date) + " · " + diaryEntryLabel(entry));
    button.addEventListener("click", () => goTo(entry.date));
    return button;
  }
  // 꾸미기를 바꾸면 이미 그려 둔 카드의 종이 배경만 다시 칠한다 — 목록을 통째로 다시 그리면
  // 진하기 슬라이더를 끄는 동안 카드 수십 장을 매번 새로 만들게 된다.
  function repaintCardPapers(){
    for (const card of monthList.querySelectorAll(".diary-entry-card")){
      const thumb = card.querySelector(".diary-entry-card-thumb");
      if (!thumb) continue;
      const style = diaryEffectiveStyle(model, entryOf(card.dataset.date));
      if (style.paper === "none"){
        thumb.removeAttribute("data-paper");
        Object.assign(thumb.style, { backgroundImage:"", backgroundSize:"", backgroundPosition:"", backgroundRepeat:"", backgroundColor:"" });
      } else diaryPaintPaper(thumb, style);
    }
  }
  function renderEntryCards(rows, headingText, emptyText){
    const heading = document.createElement("div"); heading.className = "diary-month-list-head"; heading.textContent = headingText;
    const items = rows.map(buildEntryCard);
    if (!items.length){ const empty = document.createElement("div"); empty.className = "diary-entry-rail-empty"; empty.textContent = emptyText; items.push(empty); }
    monthList.replaceChildren(heading, ...items);
  }
  function renderSearchResults(){
    const query = searchInput.value.trim(), filter = searchFilter.value || "all";
    let rows = diaryCleanEntries(model).slice().sort((a, b) => a.date < b.date ? 1 : -1);
    if (query) rows = rows.filter(e => diaryEntryMatches(e, query));
    if (filter === "favorite") rows = rows.filter(e => e.favorite);
    if (filter === "photo") rows = rows.filter(e => e.stickers && e.stickers.length);
    if (filter === "tag") rows = rows.filter(e => e.tags && e.tags.length);
    if (filter === "mood") rows = rows.filter(e => e.mood || e.weather);
    if (!query && filter === "all") rows = rows.slice(0, 30);
    const countText = query || filter !== "all"
      ? (diaryIsEn() ? rows.length + " results" : rows.length + "개의 일기")
      : (diaryIsEn() ? "Recent entries" : "최근 일기");
    const summary = document.createElement("div"); summary.className = "diary-search-count"; summary.textContent = countText;
    searchResults.replaceChildren(summary);
    renderEntryCards(rows.slice(0, 100), countText, diaryIsEn() ? "No matching entries." : "조건에 맞는 일기가 없어요.");
  }
  /* 사진만 모아 보기 — 날짜마다 흩어진 사진을 최근 날부터 한 칸에 모은다.
     썸네일 수천 장을 한 번에 그리면 탭을 누를 때마다 멈추므로 정해진 수까지만 그리고, 남은 장수는 글로 알린다.
     누르면 그 날로 가서 그 사진을 골라 준다(어디에 붙인 사진인지 종이에서 보이게). */
  const DIARY_PHOTO_WALL_MAX = 300;
  function renderPhotoWall(){
    const rows = diaryCleanEntries(model).slice().sort((a, b) => a.date < b.date ? 1 : -1);
    const groups = [];
    let shown = 0, total = 0;
    for (const e of rows){
      const photos = (e.stickers || []).filter(s => diaryStickerKind(s) === "photo" && assetUrl(s.asset));
      total += photos.length;
      if (!photos.length || shown >= DIARY_PHOTO_WALL_MAX) continue;
      const take = photos.slice(0, DIARY_PHOTO_WALL_MAX - shown);
      groups.push({ date:e.date, photos:take });
      shown += take.length;
    }
    if (!total){
      const empty = document.createElement("div");
      empty.className = "diary-side-empty";
      empty.textContent = diaryIsEn() ? "No photos yet. Drop photos onto the paper to start." : "아직 사진이 없어요. 종이에 사진을 끌어다 놓아 보세요.";
      photoPane.replaceChildren(empty);
      return;
    }
    const count = document.createElement("div");
    count.className = "diary-search-count";
    count.textContent = shown < total
      ? (diaryIsEn() ? "Photos " + shown + " of " + total : "사진 " + total + "장 가운데 최근 " + shown + "장")
      : (diaryIsEn() ? total + " photos" : "사진 " + total + "장");
    const parts = [count];
    for (const g of groups){
      const day = document.createElement("div");
      day.className = "diary-photo-day";
      const label = document.createElement("button");
      label.type = "button";
      label.className = "diary-photo-day-label";
      label.textContent = diaryUiShortDate(g.date) + " · " + g.photos.length;
      label.title = diaryUiDateLabel(g.date);
      label.addEventListener("click", () => goTo(g.date));
      const grid = document.createElement("div");
      grid.className = "diary-photo-grid";
      for (const s of g.photos){
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "diary-photo-cell" + (g.date === current ? " is-current" : "");
        cell.title = diaryUiDateLabel(g.date);
        cell.setAttribute("aria-label", diaryUiDateLabel(g.date));
        const img = document.createElement("img");
        img.src = assetUrl(s.asset); img.alt = ""; img.loading = "lazy";
        cell.append(img);
        cell.addEventListener("click", () => {
          if (g.date !== current) goTo(g.date);
          revealSticker(s.id);
        });
        cell.addEventListener("dblclick", () => { if (g.date === current) openPhotoViewer(s.id); });
        grid.append(cell);
      }
      day.append(label, grid);
      parts.push(day);
    }
    photoPane.replaceChildren(...parts);
  }
  // 그 스티커를 골라 주고 종이를 그 자리로 굴린다 — 목록·사진 칸에서 눌렀을 때 어디 붙은 것인지 보이게.
  function revealSticker(id){
    selectSticker(id);
    const node = stickerLayer.querySelector(`[data-id="${id}"]`);
    if (!node) return;
    node.focus({ preventScroll:true });
    if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block:"center", inline:"nearest" });
  }
  function renderReview(){
    const stats = diaryReviewStats(model.entries, viewYear, viewMonth + 1);
    const heading = document.createElement("div"); heading.className = "diary-review-heading";
    heading.textContent = diaryUiMonthLabel(viewYear, viewMonth);
    const cards = document.createElement("div"); cards.className = "diary-review-cards";
    const addCard = (value, label) => {
      const card = document.createElement("div"); card.className = "diary-review-card";
      const strong = document.createElement("strong"); strong.textContent = String(value);
      const small = document.createElement("span"); small.textContent = label;
      card.append(strong, small); cards.append(card);
    };
    addCard(stats.count, diaryIsEn() ? "entries" : "작성한 날");
    addCard(stats.longest, diaryIsEn() ? "day streak" : "최장 연속");
    addCard(stats.photos, diaryIsEn() ? "photos" : "사진");
    addCard(stats.favorite, diaryIsEn() ? "favorites" : "즐겨찾기");
    const insights = document.createElement("div"); insights.className = "diary-review-insights";
    const addInsight = (label, value) => {
      const row = document.createElement("div"); const key = document.createElement("span"); const val = document.createElement("strong");
      key.textContent = label; val.textContent = value || "—"; row.append(key, val); insights.append(row);
    };
    addInsight(diaryIsEn() ? "Most common mood" : "가장 많았던 기분", stats.mood ? diaryName(diaryMoodInfo(stats.mood[0])) + " · " + stats.mood[1] : "");
    addInsight(diaryIsEn() ? "Most common weather" : "가장 많았던 날씨", stats.weather ? diaryName(diaryWeatherInfo(stats.weather[0])) + " · " + stats.weather[1] : "");
    if (stats.words.length){
      const wordBox = document.createElement("div"); wordBox.className = "diary-review-words";
      const label = document.createElement("span"); label.textContent = diaryIsEn() ? "Frequent words" : "자주 쓴 말"; wordBox.append(label);
      for (const [word, count] of stats.words){ const chip = document.createElement("button"); chip.type = "button"; chip.textContent = word + " " + count; chip.addEventListener("click", () => { searchInput.value = word; setSideTab("search", true); }); wordBox.append(chip); }
      insights.append(wordBox);
    }
    const heatTitle = document.createElement("div"); heatTitle.className = "diary-review-subhead";
    heatTitle.textContent = diaryIsEn() ? viewYear + " writing map" : viewYear + "년 기록 지도";
    const heat = document.createElement("div"); heat.className = "diary-review-heatmap";
    const dates = new Set(diaryCleanEntries(model).filter(e => e.date.startsWith(String(viewYear) + "-")).map(e => e.date));
    for (let month = 1; month <= 12; month++){
      const row = document.createElement("div"); row.className = "diary-review-heat-row";
      const monthName = document.createElement("span"); monthName.textContent = diaryIsEn() ? String(month) : month + "월"; row.append(monthName);
      const last = new Date(viewYear, month, 0).getDate();
      for (let day = 1; day <= 31; day++){
        const dot = document.createElement(day <= last ? "button" : "span"); dot.className = "diary-review-day";
        if (day <= last){
          dot.type = "button";
          const key = viewYear + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
          dot.classList.toggle("has-entry", dates.has(key)); dot.title = diaryUiDateLabel(key);
          dot.addEventListener("click", () => goTo(key));
        } else dot.classList.add("is-empty");
        row.append(dot);
      }
      heat.append(row);
    }
    const memoryTitle = document.createElement("div"); memoryTitle.className = "diary-review-subhead";
    memoryTitle.textContent = diaryIsEn() ? "On this day" : "그해 오늘";
    const mmdd = current.slice(5), memories = diaryCleanEntries(model).filter(e => e.date.slice(5) === mmdd && e.date !== current).sort((a, b) => a.date < b.date ? 1 : -1);
    const memoryBox = document.createElement("div"); memoryBox.className = "diary-review-memories";
    if (!memories.length) memoryBox.textContent = diaryIsEn() ? "No earlier entry for this date." : "같은 날짜의 지난 기록이 아직 없어요.";
    for (const e of memories){ const b = document.createElement("button"); b.type = "button"; b.textContent = e.date.slice(0, 4) + " · " + diaryEntryLabel(e); b.addEventListener("click", () => goTo(e.date)); memoryBox.append(b); }
    reviewPane.replaceChildren(heading, cards, insights, heatTitle, heat, memoryTitle, memoryBox);
  }
  function refreshSideLanguage(){
    // 탭은 아이콘만 보이므로 이름은 툴팁·aria-label 까지 함께 바꿔야 한다(감춘 span 도 맞춰 둔다).
    for (const [tab, ko, en] of [[calendarTab, "달력", "Calendar"], [searchTab, "찾기", "Find"], [photoTab, "사진", "Photos"], [reviewTab, "돌아보기", "Review"]]){
      const name = diaryIsEn() ? en : ko;
      tab.querySelector("span:last-child").textContent = name;
      tab.title = name;
      tab.setAttribute("aria-label", name);
    }
    searchInput.placeholder = diaryIsEn() ? "Search this diary" : "이 일기장에서 찾기";
    entryRail.setAttribute("aria-label", diaryIsEn() ? "Diary card list" : "일기 카드 목록");
    sideMobileToggle.querySelector("span:last-child").textContent = diaryIsEn() ? "Calendar · Find" : "달력·검색";
    syncSearchFilterOptions();
  }
  sideTabs.addEventListener("click", (event) => { const tab = event.target.closest(".diary-side-tab"); if (tab) setSideTab(tab.dataset.sideTab, true); });
  sideMobileToggle.addEventListener("click", () => side.classList.toggle("is-mobile-collapsed"));
  searchInput.addEventListener("input", renderSearchResults);
  searchFilter.addEventListener("change", renderSearchResults);
  refreshSideLanguage(); setSideTab("calendar");
  if (typeof matchMedia === "function" && matchMedia("(max-width:760px)").matches) side.classList.add("is-mobile-collapsed");

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
      if (entry && entry.favorite){
        const star = document.createElement("span"); star.className = "diary-cal-favorite"; star.textContent = "★"; b.append(star);
      }
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
    paintSpecialDays();
    paintSchoolDays();

    const prefix = viewYear + "-" + String(viewMonth + 1).padStart(2, "0") + "-";
    const rows = model.entries.filter(e => e.date.startsWith(prefix) && !diaryEntryIsEmpty(e))
      .sort((a, b) => a.date < b.date ? -1 : 1);
    const sorted = rows.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    if (activeSideTab === "search") renderSearchResults();
    else renderEntryCards(sorted,
      rows.length ? diaryTf("이번 달 일기 {n}편", { n:rows.length }) : diaryT("이번 달엔 아직 일기가 없어요"),
      diaryT("이번 달엔 아직 일기가 없어요"));
    if (activeSideTab === "photos") renderPhotoWall();
    if (activeSideTab === "review") renderReview();
  }

  /* ----- 그리기 펜(바가 가진 상태) -----
     펜 색·굵기·지우개는 도구 바의 것이다. 종이는 획을 시작할 때만 읽는다(localStorage mn.diaryPen).
     그리기 켜짐(drawMode)만 종이 쪽에 남는다 — 그리기 층·스티커 고르기가 함께 움직여야 하기 때문이다. */
  let eraser = false;
  let penColor = DIARY_PENS[0][0], penSize = "mid";
  try {
    const saved = JSON.parse(localStorage.getItem("mn.diaryPen") || "null");
    // 팔레트 밖 색도 기억한다(직접 고른 색이 다음에 열 때 조용히 검정으로 돌아가지 않게).
    if (saved && DIARY_HEX_RE.test(String(saved.color || ""))) penColor = String(saved.color).toLowerCase();
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
    // 팔레트에 없는 색이면 칩은 모두 꺼지고 '직접 고르기' 칸만 켠다.
    penCustomColor.value = penColor;
    penCustomColor.classList.toggle("is-on", !eraser && !DIARY_PENS.some(x => x[0] === penColor));
    penCustomColor.title = diaryT("색 직접 고르기");
    penCustomColor.setAttribute("aria-label", penCustomColor.title);
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

  // 색을 고르면 지우개는 자동으로 풀린다(색을 골랐는데 계속 지워지면 놀란다).
  // 끄는 중(live)에는 localStorage 에 쓰지 않는다 — 확정된 색만 기억한다.
  function setPenColor(color, live){
    penColor = color; eraser = false;
    if (!live) rememberPen();
    syncDrawBar();
  }
  penButtons.forEach(b => b.addEventListener("click", () => setPenColor(b.dataset.color)));
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
  pictureDrawBtn.addEventListener("click", (e) => { e.stopPropagation(); setDrawMode(true); });

  /* ----- 종이가 바깥 창·바에 알리는 네 가지 -----
     종이 엔진을 따로 떼어 낼 때(mountDiaryPaper) 이 넷이 그대로 ctx 가 된다.
     종이는 창·바의 요소를 직접 만지지 않고 여기로만 알린다. */
  const onEntryChange = () => { deleteBtn.disabled = diaryEntryIsEmpty(entryOf(current)); };
  const onDrawModeChange = (on) => { drawBar.hidden = !on; };
  const onStickerSelect = () => syncArtPanel();
  const openStickerColorPicker = () => {
    setArtPanelOpen(true);
    artCustomColor.focus({ preventScroll:true });
    artCustomColor.click();
  };

  /* ----- 종이 ----- */
  // 종이 한 장은 mountDiaryPaper 가 맡는다. 바깥은 창구로만 주고받는다(위 주석 참고).
  const paperApi = mountDiaryPaper(
    { paper, area, bgLayer, veilLayer, genkoLayer, genkoCaret, genkoGrid, stickerLayer, artBgLayer, drawLayer, drawCanvas, pictureBox, pictureHint, main },
    { model, assets, assetUrl:(...a) => assetUrl(...a), currentLabel:() => diaryUiDateLabel(current), ensureEntry:(...a) => ensureEntry(...a), entryOf:(...a) => entryOf(...a), onDrawModeChange:(...a) => onDrawModeChange(...a), onEntryChange:(...a) => onEntryChange(...a), onStickerSelect:(...a) => onStickerSelect(...a), openStickerColorPicker:(...a) => openStickerColorPicker(...a), refreshCurrentLabel:(...a) => refreshCurrentLabel(...a), refreshDirty:(...a) => refreshDirty(...a), renderCalendar:(...a) => renderCalendar(...a), repaintCardPapers:(...a) => repaintCardPapers(...a), scheduleRecovery:(...a) => scheduleRecovery(...a), setStatus:(...a) => setStatus(...a), syncDrawBar:(...a) => syncDrawBar(...a), syncPanel:(...a) => syncPanel(...a), touch:(...a) => touch(...a), translateUi:(...a) => translateUi(...a), current:() => current, history:() => history, penColor:() => penColor, penSize:() => penSize, eraser:() => eraser }
  );
  const { addArtSticker, addAsset, addStickers, addTextSticker, applyStickerColor, applyStickerOpacity, applyStyle, clearSelection, destroyPaper, isDrawing, layout, nudgeStickers, openPhotoViewer, paperWidthNow, positionStickers, redrawDrawing, removeStickers, renderStickers, reorderStickers, rotateStickers, selectSticker, selectedStickers, selectionIds, setDrawMode, setSelection, stickerColorNow, stickerOpacityNow } = paperApi;

  /* ----- 꾸미기 바꾸기 ----- */
  /* ----- 꾸미기 창·스티커 창 ----- */
  // 창은 종이 뒤에 세운다 — 창이 종이의 스티커 색·투명도를 되비추기 때문이다.
  const panels = mountDiaryPanels({ model, assets, assetUrl:(...a) => assetUrl(...a), addAsset:(...a) => addAsset(...a), entryOf:(...a) => entryOf(...a), ensureEntry:(...a) => ensureEntry(...a), touch:(...a) => touch(...a), setStatus:(...a) => setStatus(...a), applyStyle:(...a) => applyStyle(...a), layout:(...a) => layout(...a), renderCalendar:(...a) => renderCalendar(...a), bgInput, styleBtn, stickerBtn, addArtSticker:(...a) => addArtSticker(...a), addTextSticker:(...a) => addTextSticker(...a), applyStickerColor:(...a) => applyStickerColor(...a), applyStickerOpacity:(...a) => applyStickerOpacity(...a), selectedStickers:(...a) => selectedStickers(...a), stickerColorNow:(...a) => stickerColorNow(...a), stickerOpacityNow:(...a) => stickerOpacityNow(...a), current:() => current, history:() => history });
  const { panel, artPanel, artCustomColor, syncPanel, syncArtPanel, setPanelOpen, setArtPanelOpen } = panels;
  // 덮개(잠금)보다 아래에 오도록 자리를 지켜 끼운다.
  root.insertBefore(panel, pickPop);
  root.insertBefore(artPanel, pickPop);

  const onOutside = (e) => {
    if (!pickPop.hidden && !pickPop.contains(e.target) && !weatherBtn.contains(e.target) && !moodBtn.contains(e.target)) closePicker();
    if (!templatePanel.hidden && !templatePanel.contains(e.target) && !templateBtn.contains(e.target)) setTemplateOpen(false);
    // 스티커 창은 종이 위 스티커를 고르며 색을 바꾸는 창이라, 종이를 눌렀다고 닫지 않는다.
    if (!artPanel.hidden && !artPanel.contains(e.target) && !stickerBtn.contains(e.target) && !paper.contains(e.target)) setArtPanelOpen(false);
    if (panel.hidden) return;
    if (panel.contains(e.target) || styleBtn.contains(e.target)) return;
    setPanelOpen(false);
  };
  document.addEventListener("pointerdown", onOutside, true);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape"){ e.preventDefault(); setPanelOpen(false); styleBtn.focus(); } });
  artPanel.addEventListener("keydown", (e) => { if (e.key === "Escape"){ e.preventDefault(); setArtPanelOpen(false); stickerBtn.focus(); } });

  /* ----- 보기: 양옆 칸 접기 · 몰입 모드 -----
     왼쪽 두 칸이 늘 524px 를 먹어 1280px 화면에서도 종이가 제 폭(780px)을 못 찾았다.
     접기 상태는 보는 사람 편의라 파일이 아니라 localStorage 에만 둔다(펜 색과 같은 자리).
     몰입 모드는 접기와 따로 둔다 — 나갈 때 사용자가 접어 둔 상태가 그대로 돌아와야 한다.
     종이 폭(max-width:780px)은 모드에 따라 바꾸지 않는다. 바꾸면 줄바꿈 자리가 흔들린다. */
  let sideCollapsed = false, railCollapsed = false, focusMode = false;
  try {
    const saved = JSON.parse(localStorage.getItem("mn.diaryPanels") || "null");
    if (saved && typeof saved === "object"){ sideCollapsed = !!saved.side; railCollapsed = !!saved.rail; }
  } catch(_){}
  const rememberPanels = () => {
    try { localStorage.setItem("mn.diaryPanels", JSON.stringify({ side:sideCollapsed, rail:railCollapsed })); } catch(_){}
  };
  function applyPanels(){
    root.classList.toggle("is-side-collapsed", sideCollapsed);
    root.classList.toggle("is-rail-collapsed", railCollapsed);
    root.classList.toggle("is-focus", focusMode);
    const mark = (btn, hidden, showKo, hideKo, showEn, hideEn) => {
      btn.title = diaryIsEn() ? (hidden ? showEn : hideEn) : (hidden ? showKo : hideKo);
      btn.setAttribute("aria-label", btn.title);
      btn.setAttribute("aria-pressed", String(!hidden));
      btn.classList.toggle("is-on", !hidden);
      btn.disabled = focusMode;                     // 몰입 중엔 양옆이 이미 없다
    };
    mark(sideToggleBtn, sideCollapsed, "달력·찾기 칸 보이기", "달력·찾기 칸 감추기", "Show the calendar panel", "Hide the calendar panel");
    mark(railToggleBtn, railCollapsed, "일기 목록 보이기", "일기 목록 감추기", "Show the entry list", "Hide the entry list");
    focusBtn.title = diaryIsEn()
      ? (focusMode ? "Leave focus mode (Esc)" : "Focus mode — hide both side panels")
      : (focusMode ? "몰입 모드 나가기 (Esc)" : "몰입 모드 — 양옆을 감추고 종이만");
    focusBtn.setAttribute("aria-label", focusBtn.title);
    focusBtn.setAttribute("aria-pressed", String(focusMode));
    focusBtn.classList.toggle("is-on", focusMode);
    layout();                                       // 종이 폭이 바뀌었으니 줄·스티커를 다시 잰다
  }
  function setFocusMode(on){
    if (focusMode === !!on) return;
    focusMode = !!on;
    applyPanels();
    setStatus(focusMode
      ? diaryT("몰입 모드 — Esc 를 누르면 돌아와요.")
      : diaryT("몰입 모드를 껐어요."));
  }
  sideToggleBtn.addEventListener("click", () => { sideCollapsed = !sideCollapsed; rememberPanels(); applyPanels(); });
  railToggleBtn.addEventListener("click", () => { railCollapsed = !railCollapsed; rememberPanels(); applyPanels(); });
  focusBtn.addEventListener("click", () => setFocusMode(!focusMode));

  /* ----- 즐겨찾기 · 태그 · 글감 ----- */
  const templates = [
    ["daily", "하루 돌아보기", "Daily reflection", "오늘 가장 기억에 남는 일은?\n\n그때 어떤 기분이 들었나요?\n\n내일의 나에게 한마디"],
    ["gratitude", "감사 일기", "Gratitude", "오늘 고마웠던 일 3가지\n\n1. \n2. \n3. \n\n고마움을 전하고 싶은 사람"],
    ["school", "학교생활", "School day", "오늘 배운 것\n\n친구들과 있었던 일\n\n내일 준비할 것"],
    ["reading", "독서 기록", "Reading note", "책 제목: \n\n기억에 남는 장면이나 문장\n\n읽고 난 뒤 든 생각"],
    ["travel", "여행 일기", "Travel journal", "다녀온 곳: \n\n가장 좋았던 순간\n\n새롭게 발견한 것\n\n다시 가고 싶은 이유"]
  ];
  function renderEntryMeta(){
    const entry = entryOf(current), favorite = !!(entry && entry.favorite), tags = entry && entry.tags ? entry.tags : [];
    favoriteBtn.classList.toggle("is-on", favorite); favoriteBtn.setAttribute("aria-pressed", String(favorite));
    favoriteBtn.title = favorite ? (diaryIsEn() ? "Remove from favorites" : "즐겨찾기에서 빼기") : (diaryIsEn() ? "Add to favorites" : "기억하고 싶은 날로 표시");
    favoriteBtn.setAttribute("aria-label", favoriteBtn.title);
    tagList.replaceChildren(...tags.map(tag => {
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "diary-tag-chip";
      const label = document.createElement("span"); label.textContent = "#" + tag;
      const remove = document.createElement("span"); remove.setAttribute("aria-hidden", "true"); remove.textContent = "×";
      chip.append(label, remove); chip.title = (diaryIsEn() ? "Remove tag " : "태그 지우기 ") + tag;
      chip.addEventListener("click", () => {
        if (history) history.flush();
        const live = entryOf(current); if (!live) return;
        live.tags = (live.tags || []).filter(value => value !== tag);
        renderEntryMeta(); renderCalendar(); touch(true);
      });
      return chip;
    }));
    tagInput.hidden = tags.length >= DIARY_MAX_TAGS;
    tagInput.placeholder = diaryIsEn() ? "Add tag" : "태그 추가";
  }
  function addCurrentTag(){
    const raw = tagInput.value; tagInput.value = "";
    const entry = ensureEntry(current), tags = diaryNormalizeTags([...(entry.tags || []), raw]);
    if (!raw.trim() || tags.length === (entry.tags || []).length) return;
    if (history) history.flush(); entry.tags = tags;
    renderEntryMeta(); renderCalendar(); touch(true);
  }
  favoriteBtn.addEventListener("click", () => {
    if (history) history.flush();
    const entry = ensureEntry(current); entry.favorite = !entry.favorite;
    renderEntryMeta(); renderCalendar(); touch(true);
  });
  tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ","){ event.preventDefault(); addCurrentTag(); }
  });
  function setTemplateOpen(open){
    templatePanel.hidden = !open; templateBtn.classList.toggle("is-on", open); templateBtn.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const title = document.createElement("strong"); title.textContent = diaryIsEn() ? "Choose a writing prompt" : "오늘의 글감 고르기";
    const note = document.createElement("span"); note.className = "diary-template-note";
    note.textContent = diaryIsEn() ? "Questions are inserted into the current entry." : "고른 질문을 지금 일기에 넣어 드려요.";
    const buttons = templates.map(([, ko, en, text]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "diary-template-option"; b.textContent = diaryIsEn() ? en : ko;
      b.addEventListener("click", () => {
        if (history) history.flush();
        const chosen = diaryIsEn() ? ({
          "하루 돌아보기":"What was the most memorable moment today?\n\nHow did it make you feel?\n\nA note to tomorrow's me",
          "감사 일기":"Three things I was grateful for today\n\n1. \n2. \n3. \n\nSomeone I want to thank",
          "학교생활":"What I learned today\n\nSomething that happened with friends\n\nWhat to prepare for tomorrow",
          "독서 기록":"Book title: \n\nA memorable scene or sentence\n\nMy thoughts after reading",
          "여행 일기":"Place: \n\nThe best moment\n\nSomething new I discovered\n\nWhy I want to return"
        }[ko] || text) : text;
        area.value = area.value.trim() ? area.value.replace(/\s*$/, "") + "\n\n" + chosen : chosen;
        area.dispatchEvent(new Event("input", { bubbles:true }));
        setTemplateOpen(false); area.focus(); area.setSelectionRange(area.value.length, area.value.length);
      });
      return b;
    });
    templatePanel.replaceChildren(title, note, ...buttons);
    const r = templateBtn.getBoundingClientRect(), base = root.getBoundingClientRect();
    templatePanel.style.left = Math.max(8, Math.min(base.width - 260, r.left - base.left)) + "px";
    templatePanel.style.top = (r.bottom - base.top + 6) + "px";
  }
  templateBtn.setAttribute("aria-haspopup", "dialog"); templateBtn.setAttribute("aria-expanded", "false");
  templateBtn.addEventListener("click", (event) => { event.stopPropagation(); setTemplateOpen(templatePanel.hidden); });
  templatePanel.addEventListener("keydown", (event) => { if (event.key === "Escape"){ event.preventDefault(); setTemplateOpen(false); templateBtn.focus(); } });

  /* ----- 날짜 이동 ----- */
  function renderPage(){
    const entry = entryOf(current);
    dateLabel.textContent = diaryUiHeadDate(current);
    dateLabel.title = diaryUiDateLabel(current);
    dateLabel.setAttribute("aria-label", diaryUiDateLabel(current) + (current === today ? " · " + diaryT("오늘") : ""));
    dateLabel.classList.toggle("is-today", current === today);
    todayBadge.hidden = current !== today;
    todayBadge.querySelector(".diary-today-text").textContent = diaryT("오늘");
    renderSpecialBadge();
    renderSchoolStrip();
    entryTitle.value = entry ? entry.title : "";
    if (area.value !== (entry ? entry.text : "")) area.value = entry ? entry.text : "";
    area.placeholder = diaryT(current === today ? "오늘은 어떤 하루였나요?" : "이 날의 일기를 적어 보세요.");
    deleteBtn.disabled = diaryEntryIsEmpty(entry);
    syncPickers();
    renderEntryMeta();
    applyStyle();
    renderStickers();
    layout();
    redrawDrawing();
    if (isDrawing()) syncDrawBar();
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
  function openPicker(kind, anchor, wxNote){
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
    if (kind === "weather" && weatherReady){
      const auto = document.createElement("div");
      auto.className = "diary-wx-auto";
      const place = document.createElement("select");
      place.className = "diary-select diary-wx-place";
      place.setAttribute("aria-label", diaryT("날씨 지역"));
      const saved = weatherApi.savedStation();
      [...weatherApi.STATIONS].sort((a, b) => a.name.localeCompare(b.name, "ko")).forEach(s => {
        const o = document.createElement("option"); o.value = String(s.id); o.textContent = s.name; place.append(o);
      });
      place.value = String(saved.id);
      const fill = diaryButton("기상청 날씨로 채우기", "고른 지역의 기상청 날씨로 이 날 날씨를 채웁니다", "diary-btn diary-wx-fill");
      const note = document.createElement("div");
      note.className = "diary-wx-note";
      note.setAttribute("aria-live", "polite");
      note.textContent = wxNote || "";
      place.addEventListener("change", () => weatherApi.saveStation(place.value));
      fill.addEventListener("click", () => fillWeatherFromKma(place, fill, note));
      auto.append(place, fill, note);
      pickPop.append(auto);
    }
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
    clearSelection();
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
    if (activeSideTab === "search"){ renderSearchResults(); return; }
    const card = monthList.querySelector(`.diary-month-item[data-date="${current}"]`);
    const label = card && card.querySelector(".diary-month-item-label");
    if (wasEmpty !== diaryEntryIsEmpty(entry) || !label) renderCalendar();
    else {
      label.textContent = diaryEntryLabel(entry);
      const excerpt = card.querySelector(".diary-entry-card-excerpt"); if (excerpt) excerpt.textContent = entryExcerpt(entry);
    }
  };
  photoBtn.addEventListener("click", () => photoInput.click());
  pictureBtn.addEventListener("click", (e) => { e.stopPropagation(); pictureInput.click(); });
  pictureInput.addEventListener("change", async () => { const files = [...(pictureInput.files || [])]; pictureInput.value = ""; await addStickers(files, null, true); });
  photoInput.addEventListener("change", async () => { const files = [...(photoInput.files || [])]; photoInput.value = ""; await addStickers(files); });

  /* ----- 파일 암호 ----- */
  let screenLocked = false, screenLockVerifier = null, autoLockTimer = 0;
  let autoLockMinutes = (() => {
    try { const n = Number(localStorage.getItem("mn.diaryAutoLock") || 0); return [0, 5, 10, 30].includes(n) ? n : 0; }
    catch(_){ return 0; }
  })();
  const scheduleAutoLock = () => {
    clearTimeout(autoLockTimer); autoLockTimer = 0;
    if (!autoLockMinutes || !doc.diaryProtection || screenLocked) return;
    autoLockTimer = setTimeout(() => { autoLockTimer = 0; lockDiaryScreen(); }, autoLockMinutes * 60000);
  };
  const ensureScreenLockVerifier = async () => {
    if (screenLockVerifier || !doc.diaryProtection) return screenLockVerifier;
    const api = diaryCryptoApi(); if (!api) return null;
    const iv = api.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode("ClassDock diary screen lock");
    const bytes = new Uint8Array(await api.subtle.encrypt({ name:"AES-GCM", iv, tagLength:128 }, doc.diaryProtection.key, plain));
    screenLockVerifier = { iv, bytes };
    return screenLockVerifier;
  };
  async function lockDiaryScreen(){
    if (!doc.diaryProtection){
      if (typeof toast === "function") toast(diaryT("화면 잠금은 먼저 파일 암호를 설정해야 사용할 수 있어요."), 3200);
      return false;
    }
    try { if (!await ensureScreenLockVerifier()) return false; }
    catch(error){ console.warn("diary screen lock verifier failed:", error); return false; }
    closePicker(); setPanelOpen(false); setTemplateOpen(false); setSchoolOpen(false); setDrawMode(false);
    screenLocked = true; clearTimeout(autoLockTimer); autoLockTimer = 0;
    root.classList.add("is-screen-locked"); lockScreen.hidden = false;
    lockTitle.textContent = diaryIsEn() ? "Diary locked" : "일기장이 잠겼어요";
    lockNote.textContent = diaryIsEn() ? "Enter the file password to view it again." : "내용을 다시 보려면 파일 암호를 입력하세요.";
    unlockBtn.querySelector("span:last-child").textContent = diaryIsEn() ? "Unlock" : "잠금 풀기";
    unlockBtn.focus({ preventScroll:true });
    return true;
  }
  async function unlockDiaryScreen(){
    if (!screenLocked || !doc.diaryProtection || typeof examAskPassword !== "function") return;
    let password = await examAskPassword({
      title:diaryIsEn() ? "Unlock diary" : "일기장 잠금 풀기",
      message:diaryIsEn() ? "Enter this diary's file password." : "이 일기장의 파일 암호를 입력하세요.",
      okText:diaryIsEn() ? "Unlock" : "잠금 풀기"
    });
    if (password === null) return;
    let ok = false;
    try {
      const candidate = await diaryDeriveProtection(password, doc.diaryProtection.salt, doc.diaryProtection.iterations);
      const api = diaryCryptoApi();
      const plain = await api.subtle.decrypt({ name:"AES-GCM", iv:screenLockVerifier.iv, tagLength:128 }, candidate.key, screenLockVerifier.bytes);
      ok = new TextDecoder().decode(plain) === "ClassDock diary screen lock";
    } catch(_){ ok = false; }
    password = "";
    if (!ok){ if (typeof toast === "function") toast(diaryIsEn() ? "Incorrect password." : "암호가 맞지 않아요.", 2600, { type:"error" }); return; }
    screenLocked = false; lockScreen.hidden = true; root.classList.remove("is-screen-locked"); scheduleAutoLock(); area.focus();
  }
  const setAutoLock = minutes => {
    autoLockMinutes = minutes;
    try { localStorage.setItem("mn.diaryAutoLock", String(minutes)); } catch(_){}
    scheduleAutoLock();
    if (typeof toast === "function") toast(minutes
      ? (diaryIsEn() ? "Auto-lock set to " + minutes + " minutes." : minutes + "분 동안 사용하지 않으면 화면을 잠급니다.")
      : (diaryIsEn() ? "Auto-lock turned off." : "자동 화면 잠금을 껐어요."), 2600);
  };
  const onLockActivity = () => { if (!screenLocked) scheduleAutoLock(); };
  root.addEventListener("pointerdown", onLockActivity, true);
  root.addEventListener("keydown", onLockActivity, true);
  unlockBtn.addEventListener("click", unlockDiaryScreen);
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
    screenLockVerifier = null;
    if (!nextProtection){ autoLockMinutes = 0; try { localStorage.setItem("mn.diaryAutoLock", "0"); } catch(_){} }
    scheduleAutoLock();
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
    const fileItems = doc.diaryProtection
      ? [
          { label:diaryT("암호 변경"), action:() => setDiaryPassword(true) },
          { label:diaryT("암호 제거"), danger:true, action:removeDiaryPassword }
        ]
      : [{ label:diaryT("암호 설정"), action:() => setDiaryPassword(false) }];
    const autoChildren = [0, 5, 10, 30].map(minutes => ({
      label:minutes ? (diaryIsEn() ? minutes + " minutes" : minutes + "분") : (diaryIsEn() ? "Off" : "사용 안 함"),
      active:autoLockMinutes === minutes, action:() => setAutoLock(minutes)
    }));
    const items = [...fileItems, { separator:true },
      { label:diaryIsEn() ? "Lock screen now" : "지금 화면 잠그기", icon:"lock", disabled:!doc.diaryProtection, action:lockDiaryScreen },
      { label:diaryIsEn() ? "Auto-lock" : "자동 화면 잠금", disabled:!doc.diaryProtection, children:autoChildren }
    ];
    MNContextMenu.open(r.left, r.bottom + 4, items, { autoFocus:true });
  };
  protectBtn.addEventListener("click", (e) => { e.stopPropagation(); openProtectionMenu(); });
  syncProtectionButton();
  scheduleAutoLock();

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
    if (isDrawing() && e.key === "Escape" && !inField){ e.preventDefault(); setDrawMode(false); return; }
    /* 몰입 모드는 Esc 로 나간다. 글을 쓰다가도 나갈 수 있어야 하므로 일기 본문 칸은 예외로 받아 주되,
       글상자 고쳐 쓰기(Esc = 고치기 취소)·다른 입력칸·열린 창·고른 스티커가 먼저다.
       이 처리기는 capture 라 글상자 textarea 의 Esc 보다 먼저 온다 — 그래서 여기서 걸러야 한다. */
    if (e.key === "Escape" && focusMode && !selectionIds().length
      && (!inField || target === area)
      && panel.hidden && artPanel.hidden && pickPop.hidden && templatePanel.hidden){
      e.preventDefault();
      setFocusMode(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey){
      // Ctrl+] / Ctrl+[ 한 칸 앞·뒤, Shift 를 더하면 맨 앞·맨 뒤(파워포인트와 같은 자리).
      if (selectionIds().length && !inField && root.contains(target) && (e.code === "BracketRight" || e.code === "BracketLeft")){
        e.preventDefault(); e.stopPropagation();
        const up = e.code === "BracketRight";
        reorderStickers(e.shiftKey ? (up ? "front" : "back") : (up ? "forward" : "backward"));
        return;
      }
      // 스티커를 고른 채 Ctrl+A → 이 날 스티커 모두 고르기(글칸 안의 Ctrl+A 는 글 전체 고르기 그대로)
      if (selectionIds().length && !inField && root.contains(target) && String(e.key || "").toLowerCase() === "a" && !e.shiftKey){
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
    if (!selectionIds().length || inField || !root.contains(target)) return;
    if (e.key === "Delete" || e.key === "Backspace"){ e.preventDefault(); removeStickers(selectionIds()); return; }
    if (e.code === "BracketLeft" || e.code === "BracketRight"){
      e.preventDefault();
      rotateStickers((e.code === "BracketRight" ? 1 : -1) * (e.shiftKey ? 15 : 5));
      return;
    }
    const step = (e.shiftKey ? 20 : 2) / (paperWidthNow() || 600);
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
    if (e.favorite){ const tag = document.createElement("span"); tag.className = "diary-print-mark"; tag.textContent = "★"; date.append(tag); }
    if (e.tags && e.tags.length){ const tag = document.createElement("span"); tag.className = "diary-print-mark"; tag.textContent = e.tags.map(value => "#" + value).join(" "); date.append(tag); }
    head.append(date);
    if (e.title){ const h = document.createElement("h2"); h.textContent = e.title; head.append(h); }
    page.append(head);
    const style = diaryEffectiveStyle(model, e);
    const built = diaryBuildPrintPaper(e, style, W, model.printPlain, { assetUrl });
    const paperEl = built.paperEl;
    waits.push(...built.waits);
    page.append(paperEl);
    return { page, waits };
  }
  async function printEntries(list, heading){
    if (!list.length) return false;
    // 종이 글꼴과 글상자 글꼴을 모두 미리 읽는다 — 손글씨가 늦게 오면 줄바꿈 자리가 달라진 채로 찍힌다.
    const fonts = new Set(list.map(e => diaryEffectiveStyle(model, e).font));
    for (const e of list) for (const st of e.stickers) if (diaryStickerKind(st) === "text") fonts.add(st.font);
    await Promise.all([...fonts].map(diaryEnsureFont));
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
  const onLangChange = () => {
    closePicker(); setTemplateOpen(false); refreshSideLanguage(); renderCalendar(); renderPage(); syncPanel(); applyPanels(); syncProtectionButton(); refreshDirty();
    if (screenLocked){ lockTitle.textContent = diaryIsEn() ? "Diary locked" : "일기장이 잠겼어요"; lockNote.textContent = diaryIsEn() ? "Enter the file password to view it again." : "내용을 다시 보려면 파일 암호를 입력하세요."; }
  };
  window.addEventListener("mni18nchange", onLangChange);

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (paper.clientWidth && paper.clientWidth !== paperWidthNow()) layout();
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
    clearTimeout(autoLockTimer);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onOutside, true);
    destroyPaper();
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
  applyPanels();            // translateUi 다음에 — 단추 글자는 상태까지 봐야 해서 여기서 확정한다
  history.reset();
  updateHistoryButtons();
  // 첫 마운트는 탭이 아직 안 보일 수 있다 — 보인 다음 프레임에 한 번 더 잰다.
  requestAnimationFrame(() => layout());
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    diaryAssetMime,
    DIARY_FORMAT, DIARY_VERSION, DIARY_LINES, DIARY_GAPS, DIARY_ENCRYPTED_MAGIC, DIARY_PBKDF2_ITER,
    DIARY_PAPERS, DIARY_PAPER_DARK, DIARY_PAPER_DEFAULT_COLOR, diaryPaperBackground,
    diaryDateKey, diaryIsDateKey, diaryAddDays, diaryDateLabel, diaryMonthGrid,
    diaryDefaultStyle, diaryNormalizeStyle, diaryNormalizeSticker, diaryNormalizeTags, diaryNormalizeEntry, diaryEntryIsEmpty,
    diaryEmpty, diaryNormalize, diaryContentKey, diaryModelJson, diaryEffectiveStyle, diaryReferencedAssets,
    DIARY_FONTS, DIARY_HAND_FONTS, DIARY_FONT_STACKS, diaryFontScale, diaryEnsureFont, DIARY_WEATHERS, DIARY_MOODS, diaryNormalizeAngle, diaryWeatherInfo, diaryMoodInfo, diaryWeatherMoodLabel,
    DIARY_PENS, DIARY_PEN_SIZES, diaryNormalizeStroke, diaryDrawStrokes,
    DIARY_ART, DIARY_ART_IDS, DIARY_TEXT_SIZES, DIARY_TEXT_ALIGNS, DIARY_TEXT_MAX, DIARY_ART_DEFAULT_COLOR, DIARY_TEXT_DEFAULT_COLOR,
    diaryArtInfo, diaryArtName, diaryArtSvg, diaryStickerKind, diaryCleanSticker, diaryStickerText, diaryStickerCountLabel,
    diaryReorder, DIARY_ARRANGE_MODES, DIARY_ARRANGE_GAP, DIARY_ARRANGE_ROW_H, diaryArrangeAutoCols, diaryArrangeStickers, diaryArrangeInBox,
    DIARY_GENKO_COLS, diaryGenkoGrid, diaryPictureBox, diaryUsesGenko, diaryStickerBottom, diaryGenkoMetrics, diaryGenkoLayout, diaryGenkoIndexAt,
    diaryUiDateLabel, diaryUiHeadDate, diaryUiMonthLabel, diaryUiWeekday, diaryT, diaryTf,
    diaryEntryLabel, diaryPlainText, diaryEntryMatches, diaryReviewStats, diaryLineMetrics, diaryLineBackground,
    diaryCrc32, diaryZipBuild, diaryZipRead, diaryPack, diaryUnpack, diaryScratchFileName, diaryStarterBytes,
    diaryCryptoReady, diaryIsEncrypted, diaryEncryptedInfo, diaryDeriveProtection, diarySealBytes, diaryOpenSealed, diaryOutputBytes
  };
}
