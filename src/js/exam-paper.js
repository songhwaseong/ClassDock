"use strict";

/* ===== 시험지 패키지 (.examkey / .exam / .examdone) =====
   선생님이 객관식·주관식 문항(이미지 포함)으로 시험지를 만들어 배포하고, 학생은 풀어서 이름·서명과 함께
   제출본을 내보내며, 선생님이 반 전체를 한 번에 채점한다. 전 과정 완전 오프라인. .task 패키지와 같은 JSON 파일 패턴.

   .examkey  선생님 원본 — 문항 + 정답 + 채점용 개인키를 통째로 '선생님 암호'로 봉인한다.
             실수로 배포돼도 암호 없이는 열 수 없다(정답 보호).
   .exam     배포본(학생용) — 정답을 완전히 뺀 문항 + 공개키. '열기 암호'(선택)로 잠글 수 있다.
   .examdone 제출본 — 답안·서명을 랜덤 AES 키로 암호화하고, 그 키를 시험지의 공개키로 봉인한다.
             학생은 자기 제출본조차 다시 열 수 없고 개인키를 가진 선생님만 연다.

   보안 참고(정직한 한계):
   - 공개키 봉인은 '제출 후 열람·수정'을 실제로 막는다. 다만 제출 전 로컬 초안(localStorage)은 학생 것이고,
     시험 중 화면 캡처·검색 같은 부정행위는 이 도구가 막지 못한다. 방어선은 교실 운영이다.
   - 선생님 암호를 잊으면 개인키를 되살릴 수 없어 제출본을 영영 열 수 없다(설계상 복구 경로 없음).
   - WebCrypto(crypto.subtle)는 EXE(로컬 서버)나 https 에서만 동작한다. file:// 로 연 오프라인 HTML 에서는
     브라우저가 막으므로, 그 경우 시험 기능은 EXE 로 안내한다. */

const EXAM_MASTER_FORMAT = "manneung-exam-master";
const EXAM_FORMAT = "manneung-exam";
const EXAM_RESULT_FORMAT = "manneung-exam-result";
const EXAM_VERSION = 1;

const EXAM_MAX_FILE_BYTES = 48 * 1024 * 1024;
const EXAM_MAX_ITEMS = 100;
const EXAM_MIN_CHOICES = 2;
const EXAM_MAX_CHOICES = 8;
const EXAM_MAX_STEM_CHARS = 4000;
const EXAM_MAX_CHOICE_CHARS = 600;
const EXAM_MAX_ANSWER_CHARS = 2000;
const EXAM_MAX_SHORT_CHARS = 4000;              // 학생이 주관식에 적을 수 있는 길이
const EXAM_MAX_IMAGES_PER_ITEM = 4;
const EXAM_MAX_IMAGE_TOTAL = 12 * 1024 * 1024;  // 시험지 전체 이미지(데이터 URL 기준) 합계
const EXAM_IMAGE_MAX_DIM = 1200;
const EXAM_PBKDF2_ITER = 210000;
const EXAM_MIN_PASSWORD = 8;
const EXAM_CHOICE_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];
const EXAM_GRADEBOOK_KEY = "mn.examGradebook.v1";
const EXAM_GRADEBOOK_VERSION = 1;
const EXAM_GRADEBOOK_MAX_RECORDS = 5000;

/* ===== 작은 도구 ===== */

function examRandomId(){
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch(_){}
  return "exam-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function examHasControlChars(value){
  const s = String(value || "");
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 32) return true;
  return false;
}

// 파일명에 쓸 수 있게 특수문자를 치운 짧은 토큰(.task 와 같은 규칙)
function examSafeFileToken(value, fallback){
  const source = String(value || "");
  let cleaned = "";
  for (let i = 0; i < source.length; i++){
    const ch = source[i];
    cleaned += (source.charCodeAt(i) < 32 || '\\/:*?"<>|'.includes(ch)) ? " " : ch;
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return (cleaned || fallback || "시험지").slice(0, 60);
}

function examBytesToB64(bytes){
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function examB64ToBytes(b64){
  const binary = atob(String(b64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 키를 정렬한 안정 직렬화 — 공백·키 순서와 무관하게 같은 내용이면 같은 해시
function examCanonicalStringify(value){
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return "[" + value.map(examCanonicalStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + examCanonicalStringify(value[k])).join(",") + "}";
}

async function examSha256Hex(text){
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch(_){ return ""; }
}

function examTimeText(value){
  const at = new Date(value);
  return isNaN(at.getTime()) ? (String(value || "") || "—") : at.toLocaleString();
}

function examStampName(){
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  return now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) + "_" + pad2(now.getHours()) + pad2(now.getMinutes());
}

// EXE 로컬 서버가 있으면 저장 폴더에 바로 쓰고, 없으면 다운로드로 폴백(.task 저장 동선과 동일)
async function examSaveTextFile(text, outName, label, mime){
  try {
    if (typeof saveFileBackendAvailable === "function" && await saveFileBackendAvailable()){
      const path = await saveViaServer(text, { workspacePath: outName }, outName);
      if (path){
        toast(label + " 저장 완료 · " + path, 3600, {
          type: "success",
          action: (typeof window.__mnOpenLastSavedFolder === "function")
            ? { label: "폴더 열기", onClick: () => window.__mnOpenLastSavedFolder() } : null
        });
        return true;
      }
    }
  } catch(_){ /* 서버 저장 실패 → 다운로드 폴백 */ }
  const blob = new Blob([text], { type: mime || "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = outName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(label + " 파일을 내려받았어요: " + outName, 3000, { type: "success" });
  return true;
}

function examPickFile(accept, multiple){
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept; input.multiple = !!multiple; input.hidden = true;
    input.addEventListener("change", () => {
      const files = [...(input.files || [])];
      input.remove();
      resolve(files);
    });
    input.addEventListener("cancel", () => { input.remove(); resolve([]); });
    document.body.appendChild(input);
    input.click();
  });
}

function examTranslate(node){
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(node);
}

/* ===== 암호 도구 (WebCrypto) ===== */

function examCryptoReady(){
  try { return !!(window.crypto && window.crypto.subtle && typeof window.crypto.subtle.deriveKey === "function"); }
  catch(_){ return false; }
}

// 암호 기능이 필요한 모든 동선의 첫 관문 — 막힌 이유와 해결책을 한 문장으로 알린다.
function examRequireCrypto(){
  if (examCryptoReady()) return true;
  toast("이 화면에서는 암호 기능을 쓸 수 없어요. 시험지 기능은 만능파일교실 EXE 로 열어서 사용하세요(file:// 로 연 페이지는 브라우저가 암호 기능을 막습니다).", 6000, { type: "error" });
  return false;
}

async function examDeriveAesKey(password, salt, iterations){
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

// 암호 기반 봉투 — 선생님 원본(.examkey)과 배포본 열기 암호에 함께 쓴다.
async function examSealWithPassword(payload, password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await examDeriveAesKey(password, salt, EXAM_PBKDF2_ITER);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return { alg: "PBKDF2-SHA256/AES-256-GCM", iter: EXAM_PBKDF2_ITER, salt: examBytesToB64(salt), iv: examBytesToB64(iv), ct: examBytesToB64(ct) };
}

// 암호가 틀리면 AES-GCM 인증 태그 검사에서 실패한다 → null (틀린 암호와 손상된 파일을 구분하지 않는다)
async function examOpenWithPassword(env, password){
  try {
    const iter = Math.min(1000000, Math.max(1000, Number(env && env.iter) || EXAM_PBKDF2_ITER));
    const key = await examDeriveAesKey(password, examB64ToBytes(env.salt), iter);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: examB64ToBytes(env.iv) }, key, examB64ToBytes(env.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch(_){ return null; }
}

async function examGenerateKeyPair(){
  const pair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["encrypt", "decrypt"]
  );
  return {
    alg: "RSA-OAEP-2048",
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey)
  };
}

// 제출본 봉인: 답안은 1회용 AES 키로 암호화하고, 그 키만 시험지의 공개키로 감싼다(하이브리드).
async function examSealForTeacher(payload, publicJwk){
  const pub = await crypto.subtle.importKey("jwk", publicJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const sealedKey = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, rawKey));
  return { alg: "RSA-OAEP-2048/AES-256-GCM", sealedKey: examBytesToB64(sealedKey), iv: examBytesToB64(iv), ct: examBytesToB64(ct) };
}

async function examUnsealWithPrivate(seal, privateJwk){
  try {
    const priv = await crypto.subtle.importKey("jwk", privateJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
    const rawKey = new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, examB64ToBytes(seal.sealedKey)));
    const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: examB64ToBytes(seal.iv) }, key, examB64ToBytes(seal.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch(_){ return null; }
}

/* ===== 암호 입력 모달 (askText 는 평문 입력이라 별도) ===== */

function examAskPassword(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const modal = document.createElement("div"); modal.className = "modal exam-pass-modal";
    const card = document.createElement("div"); card.className = "modal-card";
    const title = document.createElement("h3"); title.textContent = opts.title || "암호 입력";
    const sub = document.createElement("p"); sub.className = "sub"; sub.textContent = opts.message || "";

    const body = document.createElement("div"); body.className = "exam-pass-body";
    const field = (labelText) => {
      const wrap = document.createElement("label"); wrap.className = "exam-pass-field";
      const cap = document.createElement("span"); cap.textContent = labelText;
      const input = document.createElement("input"); input.type = "password"; input.maxLength = 128;
      input.autocomplete = "off"; input.spellcheck = false;
      wrap.append(cap, input); body.appendChild(wrap);
      return input;
    };
    const first = field(opts.confirm ? "새 암호" : "암호");
    const second = opts.confirm ? field("암호 확인") : null;
    const err = document.createElement("div"); err.className = "exam-pass-err"; err.hidden = true;
    body.appendChild(err);

    const actions = document.createElement("div"); actions.className = "modal-actions";
    const spacer = document.createElement("div"); spacer.className = "spacer";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn"; cancel.textContent = "취소";
    const ok = document.createElement("button"); ok.type = "button"; ok.className = "btn primary"; ok.textContent = opts.okText || "확인";
    actions.append(spacer, cancel, ok);

    const cleanup = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
    const done = (value) => { cleanup(); resolve(value); };
    const fail = (message) => { err.textContent = message; err.hidden = false; };
    const submit = () => {
      const value = first.value;
      if (opts.confirm){
        if (value.length < EXAM_MIN_PASSWORD){ fail("암호는 " + EXAM_MIN_PASSWORD + "자 이상으로 정해 주세요. 사전에 있는 짧은 단어는 피하세요."); first.focus(); return; }
        if (value !== second.value){ fail("두 암호가 서로 달라요."); second.focus(); second.select(); return; }
      } else if (!value){ fail("암호를 입력하세요."); return; }
      done(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === "Enter"){ e.preventDefault(); e.stopPropagation(); submit(); }
    };
    cancel.addEventListener("click", () => done(null));
    ok.addEventListener("click", submit);
    modal.addEventListener("click", (e) => { if (e.target === modal) done(null); });

    card.append(title, sub, body, actions);
    modal.appendChild(card);
    document.body.appendChild(modal);
    window.addEventListener("keydown", onKey, true);
    examTranslate(card);
    setTimeout(() => { try { first.focus(); } catch(_){} }, 0);
  });
}

/* ===== 문항 모델 ===== */

function examNewItem(type){
  const kind = (type === "short") ? "short" : "choice";
  return {
    id: examRandomId(),
    type: kind,
    stem: "",
    images: [],
    choices: kind === "choice" ? [{ text: "", image: "" }, { text: "", image: "" }, { text: "", image: "" }, { text: "", image: "" }] : [],
    answerIndex: 0,        // 객관식 정답(1부터). 0 = 아직 안 정함
    answerText: "",        // 주관식 정답. 여러 개면 | 로 구분
    loose: true            // 주관식 채점에서 공백·대소문자 무시
  };
}

// 파일에서 읽은 문항을 앱이 다루는 모양으로 정규화한다. withAnswers=false 면 정답 필드를 버린다.
function examNormalizeItems(list, withAnswers){
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const raw of list.slice(0, EXAM_MAX_ITEMS)){
    if (!raw || typeof raw !== "object") continue;
    const type = raw.type === "short" ? "short" : "choice";
    const item = {
      id: String(raw.id || examRandomId()).slice(0, 64),
      type,
      stem: String(raw.stem || "").slice(0, EXAM_MAX_STEM_CHARS),
      images: (Array.isArray(raw.images) ? raw.images : [])
        .filter(src => typeof src === "string" && src.startsWith("data:image/"))
        .slice(0, EXAM_MAX_IMAGES_PER_ITEM),
      choices: [],
      answerIndex: 0,
      answerText: "",
      loose: raw.loose !== false
    };
    if (type === "choice"){
      const choices = Array.isArray(raw.choices) ? raw.choices : [];
      item.choices = choices.slice(0, EXAM_MAX_CHOICES).map(choice => ({
        text: String((choice && choice.text) || "").slice(0, EXAM_MAX_CHOICE_CHARS),
        image: (choice && typeof choice.image === "string" && choice.image.startsWith("data:image/")) ? choice.image : ""
      }));
      while (item.choices.length < EXAM_MIN_CHOICES) item.choices.push({ text: "", image: "" });
      if (withAnswers){
        const index = Number(raw.answerIndex) || 0;
        item.answerIndex = (index >= 1 && index <= item.choices.length) ? Math.floor(index) : 0;
      }
    } else if (withAnswers){
      item.answerText = String(raw.answerText || "").slice(0, EXAM_MAX_ANSWER_CHARS);
    }
    out.push(item);
  }
  return out;
}

// 배포본에 담을 모양 — 정답 관련 필드를 아예 만들지 않는다(파일을 뜯어도 정답이 없다).
function examStripAnswers(items){
  return items.map(item => ({
    id: item.id,
    type: item.type,
    stem: item.stem,
    images: item.images.slice(),
    choices: item.type === "choice" ? item.choices.map(choice => ({ text: choice.text, image: choice.image || "" })) : []
  }));
}

function examImageBytesTotal(items){
  let total = 0;
  for (const item of items){
    for (const src of item.images) total += src.length;
    for (const choice of item.choices) total += (choice.image || "").length;
  }
  return Math.floor(total * 3 / 4);
}

function examItemImageCount(item){
  return (item.images || []).length + (item.choices || []).reduce((sum, choice) => sum + (choice.image ? 1 : 0), 0);
}

// 이미지를 긴 변 기준으로 줄여 데이터 URL 로 만든다(큰 사진 그대로 넣으면 시험지 파일이 순식간에 커진다).
function examImageToDataUrl(file){
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const source = String(reader.result || "");
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h){ resolve(null); return; }
        const scale = Math.min(1, EXAM_IMAGE_MAX_DIM / Math.max(w, h));
        if (scale >= 1 && source.length <= 400 * 1024){ resolve(source); return; }   // 작은 원본은 그대로(투명 배경 보존)
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);       // 투명 배경은 흰색으로(시험지 인쇄 대비)
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = source;
    };
    reader.readAsDataURL(file);
  });
}

/* ===== 채점 규칙 ===== */

function examNormalizeShortAnswer(value, loose){
  let text = String(value == null ? "" : value).trim();
  if (!loose) return text;
  return text.replace(/\s+/g, "").toLocaleLowerCase("ko");
}

function examShortAnswerList(item){
  return String(item.answerText || "").split("|").map(s => s.trim()).filter(Boolean);
}

// 문항 1개 = 1점. 객관식은 완전 자동, 주관식은 정답 목록과 대조하고 못 맞춘 것만 선생님 확인 대상으로 표시한다.
function examAutoScore(items, answers){
  const marks = {};
  let review = 0;
  for (const item of items){
    const given = answers[item.id];
    if (item.type === "choice"){
      marks[item.id] = item.answerIndex > 0 && Number(given) === item.answerIndex;
    } else {
      const list = examShortAnswerList(item);
      const normalized = examNormalizeShortAnswer(given, item.loose);
      const hit = !!normalized && list.some(answer => examNormalizeShortAnswer(answer, item.loose) === normalized);
      marks[item.id] = hit;
      if (!hit && normalized) review++;      // 빈 답은 확인할 것이 없다
    }
  }
  return { marks, review };
}

function examCountMarks(marks){
  return Object.keys(marks || {}).reduce((sum, key) => sum + (marks[key] ? 1 : 0), 0);
}

function examHashesMatch(masterHash, payloadHash){
  const expected = String(masterHash || "").toLowerCase();
  const actual = String(payloadHash || "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(expected) && expected === actual;
}

function examRowStudent(row){
  const sealed = row && row.payload && String(row.payload.student || "").trim();
  return sealed || String(row && row.submission && row.submission.student || "").trim() || "—";
}

function examRowSubmittedAt(row){
  const sealed = row && row.payload && String(row.payload.submittedAt || "").trim();
  return sealed || String(row && row.submission && row.submission.submittedAt || "").trim();
}

function examReviewCount(items, row){
  if (!row || !row.marks || !row.payload) return 0;
  let count = 0;
  for (const item of items || []){
    if (item.type !== "short" || row.marks[item.id]) continue;
    const given = examNormalizeShortAnswer(row.payload.answers[item.id], item.loose);
    if (given && !Object.prototype.hasOwnProperty.call(row.manualMarks || {}, item.id)) count++;
  }
  return count;
}

function examRefreshDuplicateWarnings(state){
  const counts = new Map();
  for (const row of state.rows || []){
    if (!row.payload) continue;
    const key = String(state.master && state.master.id || "") + "\n" + examRowStudent(row).toLocaleLowerCase("ko");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const row of state.rows || []){
    const key = String(state.master && state.master.id || "") + "\n" + examRowStudent(row).toLocaleLowerCase("ko");
    row.duplicateWarn = !!row.payload && (counts.get(key) || 0) > 1;
  }
}

/* ===== 서명 패드 ===== */

// onChange(dataUrl|"") 로 서명을 알린다. pdf-editor.js 의 trimCanvas 가 있으면 여백을 잘라 재사용한다.
function examMountSignaturePad(host, onChange){
  const wrap = document.createElement("div"); wrap.className = "exam-sign";
  const canvas = document.createElement("canvas"); canvas.className = "exam-sign-pad";
  canvas.width = 640; canvas.height = 200;
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111111";
  let drawing = false, dirty = false;

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const commit = () => {
    if (!dirty){ onChange(""); return; }
    let out = "";
    try {
      const trimmed = (typeof trimCanvas === "function") ? trimCanvas(canvas) : null;
      out = trimmed ? trimmed.dataUrl : canvas.toDataURL("image/png");
    } catch(_){ out = canvas.toDataURL("image/png"); }
    onChange(out);
  };
  // preventDefault — 캔버스 위 드래그가 글자 선택으로 잡히면 화면이 자동으로 따라 스크롤된다.
  // (문서 전체의 손바닥 드래그는 isPanIgnoredTarget 의 exam-sign-pad 예외가 막는다)
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    drawing = true; dirty = true;
    try { canvas.setPointerCapture(e.pointerId); } catch(_){}
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  });
  const stop = () => { if (!drawing) return; drawing = false; commit(); };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointerleave", stop);
  canvas.addEventListener("pointercancel", stop);

  const tools = document.createElement("div"); tools.className = "exam-sign-tools";
  const hint = document.createElement("span"); hint.className = "exam-sign-hint";
  hint.textContent = "마우스나 손가락으로 이름을 서명하세요.";
  const clear = document.createElement("button"); clear.type = "button"; clear.className = "btn";
  clear.textContent = "지우기";
  clear.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty = false; onChange("");
  });
  tools.append(hint, clear);
  wrap.append(canvas, tools);
  host.appendChild(wrap);
  return wrap;
}

/* ===== 선생님: 시험지 편집기 ===== */

function examRememberedAuthor(){
  try { return localStorage.getItem("mn.examAuthor") || ""; } catch(_){ return ""; }
}

function newExamPaper(){
  if (!examRequireCrypto()) return null;
  const doc = makeDoc("office", "새 시험지", {});
  doc.examEdit = {
    id: examRandomId(),
    meta: { title: "", author: examRememberedAuthor(), createdAt: new Date().toISOString() },
    items: [examNewItem("choice")],
    keys: null,
    password: "",
    savedItemsHash: "",
    revision: 0,
    dirty: true
  };
  doc.render = async () => { examRenderEditor(doc); };
  refreshChrome();
  activateIfIdle(doc, {});
  if (typeof markDocumentDirty === "function") markDocumentDirty(doc, true);
  toast("시험지를 만든 뒤 [💾 원본 저장]으로 선생님 암호를 정하고, [📤 배포본 만들기]로 학생용 파일을 내보내세요.", 5200);
  return doc;
}

function examEditorTitleOf(state){
  return String(state.meta.title || "").trim();
}

function examValidateForSave(state){
  if (!examEditorTitleOf(state)) return { ok: false, message: "시험지 제목을 입력하세요." };
  if (!state.items.length) return { ok: false, message: "문항을 1개 이상 만들어 주세요." };
  for (let i = 0; i < state.items.length; i++){
    const item = state.items[i];
    const no = i + 1;
    if (examItemImageCount(item) > EXAM_MAX_IMAGES_PER_ITEM)
      return { ok: false, message: no + "번 문항의 이미지는 지문과 보기를 합쳐 " + EXAM_MAX_IMAGES_PER_ITEM + "장까지 넣을 수 있어요." };
    if (!String(item.stem || "").trim() && !item.images.length) return { ok: false, message: no + "번 문항의 지문이 비어 있어요." };
    if (item.type === "choice"){
      const filled = item.choices.filter(choice => String(choice.text || "").trim() || choice.image);
      if (filled.length < EXAM_MIN_CHOICES) return { ok: false, message: no + "번 문항의 보기를 " + EXAM_MIN_CHOICES + "개 이상 채워 주세요." };
      if (!item.answerIndex) return { ok: false, message: no + "번 문항의 정답을 골라 주세요." };
      if (!String(item.choices[item.answerIndex - 1].text || "").trim() && !item.choices[item.answerIndex - 1].image)
        return { ok: false, message: no + "번 문항의 정답으로 고른 보기가 비어 있어요." };
    } else if (!examShortAnswerList(item).length){
      return { ok: false, message: no + "번 문항의 정답을 입력하세요(여러 정답은 | 로 구분)." };
    }
  }
  if (examImageBytesTotal(state.items) > EXAM_MAX_IMAGE_TOTAL) return { ok: false, message: "이미지 합계가 12MB를 넘어요. 일부 이미지를 지워 주세요." };
  return { ok: true };
}

function examMarkEditorDirty(doc){
  const state = doc.examEdit;
  if (!state) return;
  state.dirty = true;
  state.revision = (Number(state.revision) || 0) + 1;
  if (typeof markDocumentDirty === "function") markDocumentDirty(doc, true);
  if (doc._examStatusEl) doc._examStatusEl.textContent = "저장 안 됨";
}

async function examEnsureKeys(state){
  if (!state.password){
    const password = await examAskPassword({
      title: "선생님 암호 정하기",
      message: "이 암호로 시험지 원본(정답 포함)과 채점용 열쇠를 잠급니다. 학생에게는 알려주지 마세요. 잊어버리면 제출본을 열 수 없습니다.",
      confirm: true, okText: "암호 정하기"
    });
    if (password === null) return false;
    state.password = password;
  }
  if (!state.keys){
    showLoading("채점용 열쇠를 만드는 중…");
    try { state.keys = await examGenerateKeyPair(); }
    catch(e){ console.warn("exam key pair failed:", e); toast("채점용 열쇠를 만들지 못했어요.", 3200, { type: "error" }); return false; }
    finally { hideLoading(); }
  }
  return true;
}

async function examSaveMaster(doc){
  const state = doc.examEdit;
  const checked = examValidateForSave(state);
  if (!checked.ok){ toast(checked.message, 3400); return false; }
  if (!await examEnsureKeys(state)) return false;
  try { localStorage.setItem("mn.examAuthor", String(state.meta.author || "").trim()); } catch(_){}

  const title = examEditorTitleOf(state);
  const revision = Number(state.revision) || 0;
  const snapshotItems = JSON.parse(JSON.stringify(state.items));
  const snapshotHash = await examSha256Hex(examCanonicalStringify(examStripAnswers(snapshotItems)));
  if (!snapshotHash){ toast("원본 내용의 버전 지문을 만들지 못했어요.", 3200, { type: "error" }); return false; }
  const payload = { items: snapshotItems, keys: state.keys };
  let master = null;
  showLoading("시험지 원본을 잠그는 중…");
  try {
    master = {
      format: EXAM_MASTER_FORMAT, version: EXAM_VERSION, id: state.id,
      meta: {
        title, author: String(state.meta.author || "").trim().slice(0, 60),
        createdAt: state.meta.createdAt, updatedAt: new Date().toISOString(), count: snapshotItems.length
      },
      enc: await examSealWithPassword(payload, state.password)
    };
  } catch(e){
    console.warn("exam master seal failed:", e);
    toast("시험지 원본을 잠그지 못했어요.", 3200, { type: "error" });
    return false;
  } finally { hideLoading(); }

  const saved = await examSaveTextFile(JSON.stringify(master, null, 1), examSafeFileToken(title, "시험지") + ".examkey", "시험지 원본");
  if (!saved) return false;
  state.savedItemsHash = snapshotHash;
  const unchangedWhileSaving = (Number(state.revision) || 0) === revision;
  state.dirty = !unchangedWhileSaving;
  if (typeof markDocumentDirty === "function") markDocumentDirty(doc, !unchangedWhileSaving);
  if (doc._examStatusEl) doc._examStatusEl.textContent = unchangedWhileSaving ? "저장됨" : "저장 중 변경됨";
  doc.name = title;
  refreshChrome();
  if (!unchangedWhileSaving) toast("원본 저장 중 내용이 바뀌어 현재 편집본은 아직 저장되지 않았어요. 다시 저장해 주세요.", 4400);
  return true;
}

async function examExportPaper(doc){
  const state = doc.examEdit;
  const checked = examValidateForSave(state);
  if (!checked.ok){ toast(checked.message, 3400); return; }
  const currentHash = await examSha256Hex(examCanonicalStringify(examStripAnswers(state.items)));
  if (state.dirty || !state.savedItemsHash || state.savedItemsHash !== currentHash){
    const saveFirst = await confirmDialog(
      "배포본과 정확히 같은 최신 원본(.examkey)을 먼저 저장해야 합니다. 원본을 저장한 뒤 배포본을 만들까요?",
      "원본 저장 후 계속", "취소"
    );
    if (!saveFirst) return;
    if (!await examSaveMaster(doc)) return;
    if (state.dirty){
      toast("원본 저장 중 내용이 바뀌어 배포를 중단했어요. 원본을 다시 저장한 뒤 배포하세요.", 4200, { type: "error" });
      return;
    }
  }
  if (!state.keys || !state.keys.publicJwk){
    toast("채점용 열쇠가 든 원본을 다시 저장해 주세요.", 3200, { type: "error" });
    return;
  }

  const title = examEditorTitleOf(state);
  const stripped = examStripAnswers(state.items);
  const itemsHash = await examSha256Hex(examCanonicalStringify(stripped));
  if (!itemsHash || itemsHash !== state.savedItemsHash){
    toast("저장된 원본과 배포본 내용이 일치하지 않아 배포를 중단했어요. 원본을 다시 저장해 주세요.", 4200, { type: "error" });
    return;
  }
  const paper = {
    format: EXAM_FORMAT, version: EXAM_VERSION, id: state.id,
    meta: {
      title, author: String(state.meta.author || "").trim().slice(0, 60),
      createdAt: state.meta.createdAt, count: stripped.length
    },
    itemsHash,
    publicJwk: state.keys.publicJwk,
    locked: false,
    items: stripped
  };

  const wantLock = await confirmDialog(
    "배포본에 '열기 암호'를 걸까요? 학생은 시험 시작 때 이 암호를 입력해야 시험지를 열 수 있어요(시험 시작 전 유출 방지용).",
    "암호 걸기", "암호 없이 배포"
  );
  if (wantLock){
    const password = await examAskPassword({
      title: "시험지 열기 암호",
      message: "시험 시작 때 학생에게 알려줄 암호입니다. 선생님 암호와 다르게 정하세요.",
      confirm: true, okText: "암호 걸기"
    });
    if (password === null) return;
    showLoading("배포본을 잠그는 중…");
    try { paper.enc = await examSealWithPassword({ items: stripped }, password); }
    catch(e){ console.warn("exam paper lock failed:", e); toast("배포본을 잠그지 못했어요.", 3200, { type: "error" }); return; }
    finally { hideLoading(); }
    paper.locked = true;
    delete paper.items;
  }

  await examSaveTextFile(JSON.stringify(paper, null, 1), examSafeFileToken(title, "시험지") + ".exam", "배포용 시험지");
  toast("배포본에는 정답이 들어 있지 않아요. 정답이 든 원본(.examkey)은 선생님만 보관하세요.", 5200);
}

function examRenderEditor(doc){
  const state = doc.examEdit;
  const host = doc.el;
  host.innerHTML = ""; host.scrollTop = 0;

  const wrap = document.createElement("section"); wrap.className = "exam-edit";

  // 머리글 · 제목/출제자
  const head = document.createElement("div"); head.className = "exam-head";
  const headIcon = document.createElement("span"); headIcon.className = "exam-head-icon"; headIcon.textContent = "📝";
  const headTitle = document.createElement("strong"); headTitle.textContent = "시험지 만들기";
  const status = document.createElement("span"); status.className = "exam-head-status";
  status.textContent = state.dirty ? "저장 안 됨" : "저장됨";
  doc._examStatusEl = status;
  head.append(headIcon, headTitle, status);
  wrap.appendChild(head);

  const metaRow = document.createElement("div"); metaRow.className = "exam-meta-row";
  const metaField = (labelText, input) => {
    const label = document.createElement("label"); label.className = "exam-field";
    const cap = document.createElement("span"); cap.textContent = labelText;
    label.append(cap, input); metaRow.appendChild(label);
  };
  const titleInput = document.createElement("input"); titleInput.type = "text"; titleInput.maxLength = 120;
  titleInput.placeholder = "예: 2학기 중간고사 (과학)"; titleInput.value = state.meta.title || "";
  titleInput.addEventListener("input", () => { state.meta.title = titleInput.value; examMarkEditorDirty(doc); });
  const authorInput = document.createElement("input"); authorInput.type = "text"; authorInput.maxLength = 60;
  authorInput.placeholder = "예: 김선생"; authorInput.value = state.meta.author || "";
  authorInput.addEventListener("input", () => { state.meta.author = authorInput.value; examMarkEditorDirty(doc); });
  metaField("시험지 제목", titleInput);
  metaField("출제자(선택)", authorInput);
  wrap.appendChild(metaRow);

  // 도구줄
  const bar = document.createElement("div"); bar.className = "exam-bar";
  const addChoiceBtn = document.createElement("button"); addChoiceBtn.type = "button"; addChoiceBtn.className = "btn";
  addChoiceBtn.textContent = "＋ 객관식";
  const addShortBtn = document.createElement("button"); addShortBtn.type = "button"; addShortBtn.className = "btn";
  addShortBtn.textContent = "＋ 주관식";
  const barSpacer = document.createElement("div"); barSpacer.className = "spacer";
  const gradeBtn = document.createElement("button"); gradeBtn.type = "button"; gradeBtn.className = "btn";
  gradeBtn.textContent = "🗂 채점하기"; gradeBtn.title = "학생 제출본(.examdone)을 모아 한 번에 채점";
  const saveBtn = document.createElement("button"); saveBtn.type = "button"; saveBtn.className = "btn";
  saveBtn.textContent = "💾 원본 저장(.examkey)"; saveBtn.title = "정답과 채점 열쇠가 든 선생님 전용 파일 — 학생에게 주지 마세요";
  const exportBtn = document.createElement("button"); exportBtn.type = "button"; exportBtn.className = "btn primary";
  exportBtn.textContent = "📤 배포본 만들기(.exam)"; exportBtn.title = "정답을 뺀 학생 배포용 시험지 내보내기";
  bar.append(addChoiceBtn, addShortBtn, barSpacer, gradeBtn, saveBtn, exportBtn);
  wrap.appendChild(bar);

  const hint = document.createElement("p"); hint.className = "exam-hint";
  hint.textContent = "모든 문항은 1점입니다. 배포본에는 정답이 들어가지 않고, 학생 제출본은 이 시험지의 열쇠(선생님 암호)로만 열립니다.";
  wrap.appendChild(hint);

  const list = document.createElement("div"); list.className = "exam-item-list";
  wrap.appendChild(list);

  const rerender = () => examRenderEditor(doc);
  const addItem = (type) => {
    if (state.items.length >= EXAM_MAX_ITEMS){ toast("문항은 최대 " + EXAM_MAX_ITEMS + "개까지예요.", 2600); return; }
    state.items.push(examNewItem(type));
    examMarkEditorDirty(doc);
    rerender();
  };
  addChoiceBtn.addEventListener("click", () => addItem("choice"));
  addShortBtn.addEventListener("click", () => addItem("short"));
  saveBtn.addEventListener("click", () => examSaveMaster(doc));
  exportBtn.addEventListener("click", () => examExportPaper(doc));
  gradeBtn.addEventListener("click", async () => {
    if (!state.keys || !state.password || state.dirty || !state.savedItemsHash){
      toast("먼저 [💾 원본 저장]으로 시험지를 저장한 뒤 채점하세요.", 3400);
      return;
    }
    openExamGrading({
      master: {
        id: state.id, title: examEditorTitleOf(state), items: state.items,
        privateJwk: state.keys.privateJwk,
        itemsHash: await examSha256Hex(examCanonicalStringify(examStripAnswers(state.items)))
      }
    });
  });

  state.items.forEach((item, index) => list.appendChild(examRenderEditorItem(doc, item, index, rerender)));

  const total = document.createElement("div"); total.className = "exam-total";
  total.textContent = "총 " + state.items.length + "문항 · " + state.items.length + "점 만점";
  wrap.appendChild(total);

  host.appendChild(wrap);
  examTranslate(wrap);
}

function examRenderEditorItem(doc, item, index, rerender){
  const state = doc.examEdit;
  const card = document.createElement("div"); card.className = "exam-item exam-item-edit";

  // 문항 머리 — 번호 · 유형 · 순서/삭제
  const head = document.createElement("div"); head.className = "exam-item-head";
  const no = document.createElement("span"); no.className = "exam-item-no"; no.textContent = (index + 1) + "번";
  const kind = document.createElement("span"); kind.className = "exam-item-kind";
  kind.textContent = item.type === "choice" ? "객관식" : "주관식";
  const headSpacer = document.createElement("div"); headSpacer.className = "spacer";
  const tool = (label, title, onClick) => {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn exam-item-tool";
    btn.textContent = label; btn.title = title;
    btn.addEventListener("click", onClick);
    return btn;
  };
  const move = (delta) => {
    const to = index + delta;
    if (to < 0 || to >= state.items.length) return;
    const [moved] = state.items.splice(index, 1);
    state.items.splice(to, 0, moved);
    examMarkEditorDirty(doc); rerender();
  };
  head.append(no, kind, headSpacer,
    tool("▲", "위로", () => move(-1)),
    tool("▼", "아래로", () => move(1)),
    tool("복제", "이 문항을 복사해 아래에 추가", () => {
      if (state.items.length >= EXAM_MAX_ITEMS){ toast("문항은 최대 " + EXAM_MAX_ITEMS + "개까지예요.", 2600); return; }
      const copy = JSON.parse(JSON.stringify(item));
      copy.id = examRandomId();
      state.items.splice(index + 1, 0, copy);
      examMarkEditorDirty(doc); rerender();
    }),
    tool("삭제", "이 문항 지우기", async () => {
      if (!await confirmDialog((index + 1) + "번 문항을 지울까요?", "지우기", "취소")) return;
      state.items.splice(index, 1);
      examMarkEditorDirty(doc); rerender();
    })
  );
  card.appendChild(head);

  // 지문
  const stem = document.createElement("textarea"); stem.className = "exam-stem-input"; stem.rows = 3;
  stem.placeholder = "문제 지문을 입력하세요.";
  stem.value = item.stem;
  stem.addEventListener("input", () => { item.stem = stem.value.slice(0, EXAM_MAX_STEM_CHARS); examMarkEditorDirty(doc); });
  card.appendChild(stem);

  // 지문 이미지
  const imageBox = document.createElement("div"); imageBox.className = "exam-image-box";
  item.images.forEach((src, imageIndex) => {
    const cell = document.createElement("div"); cell.className = "exam-image-cell";
    const img = document.createElement("img"); img.src = src; img.alt = "문항 이미지";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn exam-image-remove";
    remove.textContent = "×"; remove.title = "이미지 빼기";
    remove.addEventListener("click", () => { item.images.splice(imageIndex, 1); examMarkEditorDirty(doc); rerender(); });
    cell.append(img, remove);
    imageBox.appendChild(cell);
  });
  const addImageBtn = document.createElement("button"); addImageBtn.type = "button"; addImageBtn.className = "btn exam-add-image";
  addImageBtn.textContent = "🖼 이미지 추가";
  addImageBtn.addEventListener("click", async () => {
    if (examItemImageCount(item) >= EXAM_MAX_IMAGES_PER_ITEM){ toast("문항 하나의 이미지는 지문과 보기를 합쳐 " + EXAM_MAX_IMAGES_PER_ITEM + "장까지예요.", 2600); return; }
    const files = await examPickFile("image/*", true);
    if (!files.length) return;
    for (const file of files){
      if (examItemImageCount(item) >= EXAM_MAX_IMAGES_PER_ITEM) break;
      const dataUrl = await examImageToDataUrl(file);
      if (!dataUrl){ toast("이미지를 읽지 못했어요: " + file.name, 2800); continue; }
      item.images.push(dataUrl);
      if (examImageBytesTotal(state.items) > EXAM_MAX_IMAGE_TOTAL){
        item.images.pop();
        toast("이미지 합계 12MB를 넘어 '" + file.name + "'은 넣지 않았어요.", 3400);
        break;
      }
    }
    examMarkEditorDirty(doc); rerender();
  });
  imageBox.appendChild(addImageBtn);
  card.appendChild(imageBox);

  if (item.type === "choice"){
    const choiceBox = document.createElement("div"); choiceBox.className = "exam-choice-box";
    const groupName = "exam-answer-" + item.id;
    item.choices.forEach((choice, choiceIndex) => {
      const row = document.createElement("div"); row.className = "exam-choice-row";
      const pick = document.createElement("input"); pick.type = "radio"; pick.name = groupName;
      pick.title = "이 보기를 정답으로";
      pick.checked = item.answerIndex === choiceIndex + 1;
      pick.addEventListener("change", () => { item.answerIndex = choiceIndex + 1; examMarkEditorDirty(doc); });
      const mark = document.createElement("span"); mark.className = "exam-choice-mark";
      mark.textContent = EXAM_CHOICE_MARKS[choiceIndex] || String(choiceIndex + 1);
      const text = document.createElement("input"); text.type = "text"; text.className = "exam-choice-input";
      text.maxLength = EXAM_MAX_CHOICE_CHARS; text.placeholder = "보기 " + (choiceIndex + 1);
      text.value = choice.text;
      text.addEventListener("input", () => { choice.text = text.value; examMarkEditorDirty(doc); });
      const imageBtn = document.createElement("button"); imageBtn.type = "button"; imageBtn.className = "btn exam-item-tool";
      imageBtn.textContent = choice.image ? "이미지 ✓" : "이미지";
      imageBtn.title = choice.image ? "이 보기의 이미지 바꾸기 · 오른쪽 × 로 빼기" : "이 보기에 이미지 넣기";
      imageBtn.addEventListener("click", async () => {
        if (!choice.image && examItemImageCount(item) >= EXAM_MAX_IMAGES_PER_ITEM){
          toast("문항 하나의 이미지는 지문과 보기를 합쳐 " + EXAM_MAX_IMAGES_PER_ITEM + "장까지예요.", 2800); return;
        }
        const files = await examPickFile("image/*", false);
        if (!files.length) return;
        const dataUrl = await examImageToDataUrl(files[0]);
        if (!dataUrl){ toast("이미지를 읽지 못했어요.", 2600); return; }
        const before = choice.image;
        choice.image = dataUrl;
        if (examImageBytesTotal(state.items) > EXAM_MAX_IMAGE_TOTAL){
          choice.image = before;
          toast("이미지 합계 12MB를 넘어 넣지 않았어요.", 3200);
          return;
        }
        examMarkEditorDirty(doc); rerender();
      });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn exam-item-tool";
      remove.textContent = "×"; remove.title = "이 보기 지우기";
      remove.addEventListener("click", () => {
        if (item.choices.length <= EXAM_MIN_CHOICES){ toast("보기는 " + EXAM_MIN_CHOICES + "개 이상이어야 해요.", 2400); return; }
        item.choices.splice(choiceIndex, 1);
        if (item.answerIndex === choiceIndex + 1) item.answerIndex = 0;
        else if (item.answerIndex > choiceIndex + 1) item.answerIndex--;
        examMarkEditorDirty(doc); rerender();
      });
      row.append(pick, mark, text, imageBtn, remove);
      choiceBox.appendChild(row);
      if (choice.image){
        const preview = document.createElement("div"); preview.className = "exam-choice-image";
        const img = document.createElement("img"); img.src = choice.image; img.alt = "보기 이미지";
        preview.appendChild(img);
        choiceBox.appendChild(preview);
      }
    });
    const addChoice = document.createElement("button"); addChoice.type = "button"; addChoice.className = "btn exam-add-choice";
    addChoice.textContent = "＋ 보기 추가";
    addChoice.addEventListener("click", () => {
      if (item.choices.length >= EXAM_MAX_CHOICES){ toast("보기는 최대 " + EXAM_MAX_CHOICES + "개까지예요.", 2400); return; }
      item.choices.push({ text: "", image: "" });
      examMarkEditorDirty(doc); rerender();
    });
    choiceBox.appendChild(addChoice);
    card.appendChild(choiceBox);

    const answerHint = document.createElement("div"); answerHint.className = "exam-answer-hint";
    answerHint.textContent = item.answerIndex
      ? ("정답: " + (EXAM_CHOICE_MARKS[item.answerIndex - 1] || item.answerIndex) + "번")
      : "왼쪽 동그라미로 정답을 골라 주세요.";
    answerHint.classList.toggle("is-warn", !item.answerIndex);
    card.appendChild(answerHint);
  } else {
    const answerWrap = document.createElement("label"); answerWrap.className = "exam-field exam-answer-field";
    const cap = document.createElement("span"); cap.textContent = "정답 (여러 개면 | 로 구분)";
    const answer = document.createElement("input"); answer.type = "text"; answer.maxLength = EXAM_MAX_ANSWER_CHARS;
    answer.placeholder = "예: 광합성|photosynthesis";
    answer.value = item.answerText;
    answer.addEventListener("input", () => { item.answerText = answer.value; examMarkEditorDirty(doc); });
    answerWrap.append(cap, answer);
    card.appendChild(answerWrap);

    const looseRow = document.createElement("label"); looseRow.className = "exam-check";
    const loose = document.createElement("input"); loose.type = "checkbox"; loose.checked = item.loose !== false;
    loose.addEventListener("change", () => { item.loose = loose.checked; examMarkEditorDirty(doc); });
    const looseText = document.createElement("span"); looseText.textContent = "띄어쓰기·대소문자 무시하고 채점";
    looseRow.append(loose, looseText);
    card.appendChild(looseRow);
  }

  return card;
}

/* ===== 선생님: 원본(.examkey) 열기 ===== */

function examValidateMasterPayload(raw){
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.format !== EXAM_MASTER_FORMAT || raw.version !== EXAM_VERSION) return null;
  if (!raw.enc || typeof raw.enc !== "object") return null;
  return raw;
}

// 암호를 최대 5번까지 물어보고, 풀리면 {items, keys} 를 돌려준다.
async function examUnlockMaster(master, purposeMessage){
  for (let attempt = 0; attempt < 5; attempt++){
    const password = await examAskPassword({
      title: "선생님 암호",
      message: purposeMessage || ('"' + (master.meta && master.meta.title || "시험지") + '" 원본을 열려면 선생님 암호가 필요해요.'),
      okText: "열기"
    });
    if (password === null) return null;
    showLoading("암호를 확인하는 중…");
    let payload = null;
    try { payload = await examOpenWithPassword(master.enc, password); }
    finally { hideLoading(); }
    if (payload && Array.isArray(payload.items) && payload.keys && payload.keys.privateJwk){
      return { items: examNormalizeItems(payload.items, true), keys: payload.keys, password };
    }
    toast("암호가 맞지 않아요.", 2400, { type: "error" });
  }
  return null;
}

async function loadExamMaster(file, opts){
  if (!examRequireCrypto()) return null;
  if (!file || Number(file.size) > EXAM_MAX_FILE_BYTES){ toast("시험지 파일은 48MB 이하만 열 수 있어요.", 3000); return null; }
  let parsed = null;
  try { parsed = JSON.parse(await file.text()); } catch(_){}
  const master = examValidateMasterPayload(parsed);
  if (!master){ toast("시험지 원본(.examkey) 파일을 읽지 못했어요.", 3400); return null; }
  const opened = await examUnlockMaster(master, null);
  if (!opened) return null;

  const doc = makeDoc("office", (master.meta && master.meta.title) || file.name, opts || {});
  doc.examEdit = {
    id: String(master.id || examRandomId()).slice(0, 64),
    meta: {
      title: String((master.meta && master.meta.title) || "").slice(0, 120),
      author: String((master.meta && master.meta.author) || "").slice(0, 60),
      createdAt: String((master.meta && master.meta.createdAt) || new Date().toISOString())
    },
    items: opened.items,
    keys: opened.keys,
    password: opened.password,
    savedItemsHash: await examSha256Hex(examCanonicalStringify(examStripAnswers(opened.items))),
    revision: 0,
    dirty: false
  };
  doc.render = async () => { examRenderEditor(doc); };
  refreshChrome();
  activateIfIdle(doc, opts || {});
  return doc;
}

/* ===== 학생: 배포본(.exam) 열기 · 풀기 · 제출 ===== */

function examDraftKey(id){ return "mn.exam." + id; }
function examDoneKey(id){ return "mn.examDone." + id; }

function examReadJson(key){
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch(_){ return null; }
}
function examWriteJson(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); } catch(_){ /* 용량 초과 등 — 초안 저장은 실패해도 응시는 계속 */ }
}

function examReadGradebook(){
  const raw = examReadJson(EXAM_GRADEBOOK_KEY);
  const records = [];
  if (raw && raw.version === EXAM_GRADEBOOK_VERSION && Array.isArray(raw.records)){
    for (const entry of raw.records.slice(-EXAM_GRADEBOOK_MAX_RECORDS)){
      if (!entry || typeof entry !== "object") continue;
      const examId = String(entry.examId || "").slice(0, 64);
      const submissionKey = String(entry.submissionKey || "").slice(0, 64);
      const student = String(entry.student || "").trim().slice(0, 60);
      if (!examId || !submissionKey || !student) continue;
      const marks = {};
      if (entry.marks && typeof entry.marks === "object"){
        for (const [id, value] of Object.entries(entry.marks).slice(0, EXAM_MAX_ITEMS)) marks[String(id).slice(0, 64)] = !!value;
      }
      const manualMarks = {};
      if (entry.manualMarks && typeof entry.manualMarks === "object"){
        for (const [id, value] of Object.entries(entry.manualMarks).slice(0, EXAM_MAX_ITEMS)) manualMarks[String(id).slice(0, 64)] = !!value;
      }
      records.push({
        examId, submissionKey, student,
        examTitle: String(entry.examTitle || "시험").slice(0, 120),
        submittedAt: String(entry.submittedAt || "").slice(0, 40),
        updatedAt: String(entry.updatedAt || "").slice(0, 40),
        total: Math.max(0, Math.min(EXAM_MAX_ITEMS, Number(entry.total) || 0)),
        score: Math.max(0, Math.min(EXAM_MAX_ITEMS, Number(entry.score) || 0)),
        review: Math.max(0, Math.min(EXAM_MAX_ITEMS, Number(entry.review) || 0)),
        marks, manualMarks
      });
    }
  }
  return { version: EXAM_GRADEBOOK_VERSION, records };
}

function examWriteGradebook(book){
  try {
    const records = Array.isArray(book && book.records) ? book.records.slice(-EXAM_GRADEBOOK_MAX_RECORDS) : [];
    localStorage.setItem(EXAM_GRADEBOOK_KEY, JSON.stringify({ version: EXAM_GRADEBOOK_VERSION, records }));
    return true;
  } catch(e){
    console.warn("exam gradebook save failed:", e);
    return false;
  }
}

function examFindSavedGrade(examId, submissionKey){
  return examReadGradebook().records.find(entry => entry.examId === examId && entry.submissionKey === submissionKey) || null;
}

function examPersistGradedRow(state, row){
  if (!state || !state.master || !row || !row.marks || !row.payload || !row.submissionKey) return false;
  const book = examReadGradebook();
  const record = {
    examId: state.master.id,
    examTitle: state.master.title,
    submissionKey: row.submissionKey,
    student: examRowStudent(row),
    submittedAt: examRowSubmittedAt(row),
    updatedAt: new Date().toISOString(),
    total: state.master.items.length,
    score: examCountMarks(row.marks),
    review: examReviewCount(state.master.items, row),
    marks: { ...row.marks },
    manualMarks: { ...(row.manualMarks || {}) }
  };
  const index = book.records.findIndex(entry => entry.examId === record.examId && entry.submissionKey === record.submissionKey);
  if (index >= 0) book.records[index] = record;
  else book.records.push(record);
  return examWriteGradebook(book);
}

function examDeleteSavedGrade(examId, submissionKey){
  const book = examReadGradebook();
  book.records = book.records.filter(entry => !(entry.examId === examId && entry.submissionKey === submissionKey));
  return examWriteGradebook(book);
}

function examCsvCell(value){
  let text = String(value == null ? "" : value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

async function loadExamPaper(file, opts){
  // 제출 봉인에 WebCrypto 가 필요하므로, 풀기 전에 먼저 막는다(다 풀고 나서 제출 못 하는 사태 방지).
  if (!examRequireCrypto()) return null;
  if (!file || Number(file.size) > EXAM_MAX_FILE_BYTES){ toast("시험지 파일은 48MB 이하만 열 수 있어요.", 3000); return null; }
  let paper = null;
  try { paper = JSON.parse(await file.text()); } catch(_){}
  if (!paper || typeof paper !== "object" || paper.format !== EXAM_FORMAT || paper.version !== EXAM_VERSION){
    toast("시험지(.exam) 파일을 읽지 못했어요.", 3400); return null;
  }
  if (!paper.publicJwk){ toast("이 시험지에는 제출용 열쇠가 없어요. 선생님께 파일을 다시 받으세요.", 4000, { type: "error" }); return null; }

  let items = null;
  if (paper.locked){
    if (!examRequireCrypto()) return null;
    for (let attempt = 0; attempt < 5 && !items; attempt++){
      const password = await examAskPassword({
        title: "시험지 열기 암호",
        message: '"' + ((paper.meta && paper.meta.title) || file.name) + '" 시험지를 열려면 선생님이 알려준 암호를 입력하세요.',
        okText: "열기"
      });
      if (password === null) return null;
      showLoading("암호를 확인하는 중…");
      let opened = null;
      try { opened = await examOpenWithPassword(paper.enc, password); }
      finally { hideLoading(); }
      if (opened && Array.isArray(opened.items)) items = examNormalizeItems(opened.items, false);
      else toast("암호가 맞지 않아요.", 2400, { type: "error" });
    }
    if (!items) return null;
  } else {
    items = examNormalizeItems(paper.items, false);
  }
  if (!items.length){ toast("이 시험지에는 문항이 없어요.", 3000); return null; }
  return openExamTakeDoc(paper, items, file.name, opts || {});
}

function openExamTakeDoc(paper, items, name, opts){
  const id = String(paper.id || "").slice(0, 64) || examRandomId();
  const doc = makeDoc("office", (paper.meta && paper.meta.title) || name, opts || {});
  const done = examReadJson(examDoneKey(id));
  const draft = done ? null : examReadJson(examDraftKey(id));
  doc.examTake = {
    id, paper, items,
    answers: (draft && draft.answers && typeof draft.answers === "object") ? draft.answers : {},
    student: (draft && typeof draft.student === "string") ? draft.student : examRememberedStudent(),
    signature: (draft && typeof draft.signature === "string") ? draft.signature : "",
    submitted: !!done,
    submittedAt: done ? String(done.at || "") : ""
  };
  doc.render = async () => { examRenderTake(doc); };
  refreshChrome();
  activateIfIdle(doc, opts || {});
  return doc;
}

function examRememberedStudent(){
  try { return localStorage.getItem("mn.studentName") || ""; } catch(_){ return ""; }
}

function examSaveDraft(doc){
  const state = doc.examTake;
  if (!state || state.submitted) return;
  examWriteJson(examDraftKey(state.id), {
    answers: state.answers, student: state.student, signature: state.signature, at: Date.now()
  });
}

function examAnsweredCount(state){
  let count = 0;
  for (const item of state.items){
    const value = state.answers[item.id];
    if (item.type === "choice"){ if (Number(value) > 0) count++; }
    else if (String(value || "").trim()) count++;
  }
  return count;
}

function examRenderTake(doc){
  const state = doc.examTake;
  const host = doc.el;
  host.innerHTML = ""; host.scrollTop = 0;

  const wrap = document.createElement("section"); wrap.className = "exam-take";
  const meta = state.paper.meta || {};

  const head = document.createElement("div"); head.className = "exam-head";
  const headIcon = document.createElement("span"); headIcon.className = "exam-head-icon"; headIcon.textContent = "🧾";
  const headTitle = document.createElement("strong"); headTitle.textContent = meta.title || "시험지";
  const headAuthor = document.createElement("span"); headAuthor.className = "exam-head-sub";
  headAuthor.textContent = meta.author ? ("출제: " + meta.author) : "";
  head.append(headIcon, headTitle, headAuthor);
  wrap.appendChild(head);

  if (state.submitted){
    const donePanel = document.createElement("div"); donePanel.className = "exam-done-panel";
    const doneTitle = document.createElement("strong"); doneTitle.textContent = "✅ 제출이 끝났습니다";
    const doneBody = document.createElement("p");
    doneBody.textContent = "제출본은 선생님만 열 수 있게 잠겼습니다. 이 기기에서는 이 시험지를 다시 풀거나 고칠 수 없어요."
      + (state.submittedAt ? (" (제출 시각 " + examTimeText(state.submittedAt) + ")") : "");
    donePanel.append(doneTitle, doneBody);
    wrap.appendChild(donePanel);
    host.appendChild(wrap);
    examTranslate(wrap);
    return;
  }

  const progress = document.createElement("div"); progress.className = "exam-progress";
  const updateProgress = () => {
    progress.textContent = "푼 문항 " + examAnsweredCount(state) + " / " + state.items.length + " (한 문항 1점)";
  };
  updateProgress();
  wrap.appendChild(progress);

  const notice = document.createElement("p"); notice.className = "exam-hint";
  notice.textContent = "답은 자동으로 임시 저장되고, 제출 전까지 자유롭게 고칠 수 있어요. 제출하면 답안 파일은 선생님만 열 수 있고 이 기기에서는 시험지가 잠깁니다.";
  wrap.appendChild(notice);

  const list = document.createElement("div"); list.className = "exam-item-list";
  state.items.forEach((item, index) => {
    const card = document.createElement("div"); card.className = "exam-item";
    const itemHead = document.createElement("div"); itemHead.className = "exam-item-head";
    const no = document.createElement("span"); no.className = "exam-item-no"; no.textContent = (index + 1) + "번";
    const kind = document.createElement("span"); kind.className = "exam-item-kind";
    kind.textContent = item.type === "choice" ? "객관식" : "주관식";
    itemHead.append(no, kind);
    card.appendChild(itemHead);

    const stem = document.createElement("div"); stem.className = "exam-stem";
    stem.textContent = item.stem;
    card.appendChild(stem);

    if (item.images.length){
      const images = document.createElement("div"); images.className = "exam-image-box";
      item.images.forEach((src) => {
        const cell = document.createElement("div"); cell.className = "exam-image-cell";
        const img = document.createElement("img"); img.src = src; img.alt = "문항 이미지";
        cell.appendChild(img);
        images.appendChild(cell);
      });
      card.appendChild(images);
    }

    if (item.type === "choice"){
      const box = document.createElement("div"); box.className = "exam-choice-box";
      const groupName = "exam-take-" + item.id;
      item.choices.forEach((choice, choiceIndex) => {
        const row = document.createElement("label"); row.className = "exam-take-choice";
        const pick = document.createElement("input"); pick.type = "radio"; pick.name = groupName;
        pick.checked = Number(state.answers[item.id]) === choiceIndex + 1;
        pick.addEventListener("change", () => {
          state.answers[item.id] = choiceIndex + 1;
          examSaveDraft(doc); updateProgress();
        });
        const mark = document.createElement("span"); mark.className = "exam-choice-mark";
        mark.textContent = EXAM_CHOICE_MARKS[choiceIndex] || String(choiceIndex + 1);
        const text = document.createElement("span"); text.className = "exam-take-choice-text";
        text.textContent = choice.text;
        row.append(pick, mark, text);
        if (choice.image){
          const img = document.createElement("img"); img.className = "exam-take-choice-image";
          img.src = choice.image; img.alt = "보기 이미지";
          row.appendChild(img);
        }
        box.appendChild(row);
      });
      const clearRow = document.createElement("button"); clearRow.type = "button"; clearRow.className = "btn exam-item-tool";
      clearRow.textContent = "선택 지우기";
      clearRow.addEventListener("click", () => {
        delete state.answers[item.id];
        box.querySelectorAll('input[type="radio"]').forEach(input => { input.checked = false; });
        examSaveDraft(doc); updateProgress();
      });
      box.appendChild(clearRow);
      card.appendChild(box);
    } else {
      const answer = document.createElement("textarea"); answer.className = "exam-short-input"; answer.rows = 2;
      answer.placeholder = "답을 입력하세요.";
      answer.value = String(state.answers[item.id] || "");
      answer.addEventListener("input", () => {
        state.answers[item.id] = answer.value.slice(0, EXAM_MAX_SHORT_CHARS);
        examSaveDraft(doc); updateProgress();
      });
      card.appendChild(answer);
    }
    list.appendChild(card);
  });
  wrap.appendChild(list);

  // 이름 · 서명 · 제출
  const submitBox = document.createElement("div"); submitBox.className = "exam-submit-box";
  const submitTitle = document.createElement("strong"); submitTitle.textContent = "이름과 서명";
  submitBox.appendChild(submitTitle);

  const nameField = document.createElement("label"); nameField.className = "exam-field";
  const nameCap = document.createElement("span"); nameCap.textContent = "이름 (번호+이름 권장)";
  const nameInput = document.createElement("input"); nameInput.type = "text"; nameInput.maxLength = 60;
  nameInput.placeholder = "예: 12 홍길동"; nameInput.value = state.student || "";
  nameInput.addEventListener("input", () => { state.student = nameInput.value; examSaveDraft(doc); });
  nameField.append(nameCap, nameInput);
  submitBox.appendChild(nameField);

  if (state.signature){
    const saved = document.createElement("div"); saved.className = "exam-sign-saved";
    const savedCap = document.createElement("span"); savedCap.textContent = "지금 저장된 서명";
    const savedImg = document.createElement("img"); savedImg.src = state.signature; savedImg.alt = "저장된 서명";
    saved.append(savedCap, savedImg);
    submitBox.appendChild(saved);
  }
  examMountSignaturePad(submitBox, (dataUrl) => {
    if (dataUrl) state.signature = dataUrl;
    else state.signature = "";
    examSaveDraft(doc);
  });

  const submitBtn = document.createElement("button"); submitBtn.type = "button"; submitBtn.className = "btn primary exam-submit-btn";
  submitBtn.textContent = "📤 제출 확정하기";
  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    try { await examSubmit(doc); }
    finally { submitBtn.disabled = false; }
  });
  submitBox.appendChild(submitBtn);
  wrap.appendChild(submitBox);

  host.appendChild(wrap);
  examTranslate(wrap);
}

async function examSubmit(doc){
  const state = doc.examTake;
  if (!state || state.submitted) return;
  if (!examRequireCrypto()) return;

  const student = String(state.student || "").trim().slice(0, 60);
  if (!student || examHasControlChars(student)){ toast("이름을 입력해야 제출할 수 있어요.", 2800); return; }
  if (!state.signature){ toast("서명을 한 뒤 제출하세요.", 2800); return; }

  const unanswered = state.items.length - examAnsweredCount(state);
  if (unanswered > 0){
    const go = await confirmDialog("아직 답하지 않은 문항이 " + unanswered + "개 있어요. 그래도 제출할까요?", "그래도 제출", "돌아가기");
    if (!go) return;
  }
  const confirmed = await confirmDialog(
    "제출하면 제출본은 선생님만 열 수 있게 잠기고 이 기기에서는 시험지를 다시 고칠 수 없어요. 제출할까요?",
    "제출하기", "취소"
  );
  if (!confirmed) return;

  const submittedAt = new Date().toISOString();
  const payload = {
    examId: state.id,
    examTitle: String((state.paper.meta && state.paper.meta.title) || "시험지").slice(0, 120),
    student,
    signature: state.signature,
    submittedAt,
    itemsHash: String(state.paper.itemsHash || ""),
    answers: state.items.map(item => ({
      id: item.id,
      type: item.type,
      value: item.type === "choice" ? (Number(state.answers[item.id]) || 0) : String(state.answers[item.id] || "").slice(0, EXAM_MAX_SHORT_CHARS)
    }))
  };

  let seal = null;
  showLoading("제출본을 봉인하는 중…");
  try { seal = await examSealForTeacher(payload, state.paper.publicJwk); }
  catch(e){ console.warn("exam seal failed:", e); }
  finally { hideLoading(); }
  if (!seal){ toast("제출본을 봉인하지 못했어요. 시험지 파일을 다시 받아 열어 보세요.", 4000, { type: "error" }); return; }

  const title = String((state.paper.meta && state.paper.meta.title) || "시험지");
  const submission = {
    format: EXAM_RESULT_FORMAT, version: EXAM_VERSION,
    examId: state.id, examTitle: title.slice(0, 120), itemsHash: String(state.paper.itemsHash || ""),
    student, submittedAt, count: state.items.length, seal
  };
  const outName = examSafeFileToken(title, "시험지") + "_" + examSafeFileToken(student, "학생") + ".examdone";
  await examSaveTextFile(JSON.stringify(submission, null, 1), outName, "제출본");

  try { localStorage.setItem("mn.studentName", student); } catch(_){}
  try { localStorage.removeItem(examDraftKey(state.id)); } catch(_){}   // 초안을 지우고 이 기기의 완료 표식으로 다시 열기를 막는다
  examWriteJson(examDoneKey(state.id), { at: submittedAt, student });
  state.submitted = true;
  state.submittedAt = submittedAt;
  state.answers = {};
  examRenderTake(doc);
  toast("제출이 끝났습니다. 만들어진 " + outName + " 파일을 선생님께 내세요.", 6000, { type: "success" });
}

/* ===== 선생님: 제출본 일괄 채점 ===== */

function examValidateSubmissionPayload(raw){
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.format !== EXAM_RESULT_FORMAT || raw.version !== EXAM_VERSION) return null;
  if (!raw.seal || typeof raw.seal !== "object" || !raw.seal.sealedKey) return null;
  const student = String(raw.student || "").trim().slice(0, 60);
  if (!student) return null;
  return {
    examId: String(raw.examId || "").slice(0, 64),
    examTitle: String(raw.examTitle || "").slice(0, 120),
    itemsHash: String(raw.itemsHash || "").slice(0, 64),
    student,
    submittedAt: String(raw.submittedAt || "").slice(0, 40),
    count: Math.max(0, Math.min(EXAM_MAX_ITEMS, Number(raw.count) || 0)),
    seal: raw.seal
  };
}

// 채점 화면은 한 번에 하나만 둔다 — 여러 탭에 흩어지면 어느 표에 제출본을 넣었는지 헷갈린다.
function openExamGrading(seed){
  const existing = docs.find(d => d && d.examGrade && !d.closed);
  if (existing){
    if (seed && seed.master){
      existing.examGrade.master = seed.master;
      examResetGradedRows(existing.examGrade);
      examOpenPendingRows(existing).then(() => examRenderGrading(existing));
    } else if (existing.rendered) examRenderGrading(existing);
    setActiveDoc(existing.id);
    return existing;
  }
  const doc = makeDoc("office", "시험 채점", {});
  doc.examGrade = { master: (seed && seed.master) || null, rows: [] };
  doc.render = async () => { examRenderGrading(doc); };
  refreshChrome();
  activateIfIdle(doc, {});
  return doc;
}

// .examdone 을 더블클릭하면 채점 화면으로 모은다.
async function loadExamSubmission(file, opts){
  if (!file || Number(file.size) > EXAM_MAX_FILE_BYTES){ toast("제출본 파일은 48MB 이하만 열 수 있어요.", 3000); return null; }
  let parsed = null;
  try { parsed = JSON.parse(await file.text()); } catch(_){}
  const submission = examValidateSubmissionPayload(parsed);
  if (!submission){ toast("제출본(.examdone) 파일을 읽지 못했어요.", 3400); return null; }
  const doc = openExamGrading(null);
  if (!doc) return null;
  await examAddSubmissions(doc, [{ file, submission }]);
  return doc;
}

async function examAddSubmissions(doc, entries){
  const state = doc.examGrade;
  let added = 0, skipped = 0;
  for (const entry of entries){
    const submission = entry.submission;
    const submissionKey = await examSha256Hex(examCanonicalStringify(submission.seal));
    const duplicate = state.rows.some(row => row.submissionKey && row.submissionKey === submissionKey);
    if (duplicate){ skipped++; continue; }
    state.rows.push({
      submission, fileName: entry.file ? entry.file.name : (submission.student + ".examdone"),
      submissionKey: submissionKey || examRandomId(), payload: null, marks: null, autoMarks: null,
      manualMarks: {}, review: 0, note: "", opened: false, duplicateWarn: false
    });
    added++;
  }
  state.rows.sort((a, b) => a.submission.student.localeCompare(b.submission.student, "ko"));
  if (state.master) await examOpenPendingRows(doc);
  examRenderGrading(doc);
  if (added || skipped) toast("제출본 " + added + "개 추가" + (skipped ? " · " + skipped + "개 제외(중복·형식 오류)" : ""), 2800);
}

// 원본을 바꾸면 이전 열쇠로 연 결과(수동으로 고친 O/X 포함)는 더 이상 근거가 없다 — 모두 다시 연다.
function examResetGradedRows(state){
  for (const row of state.rows){
    row.opened = false; row.payload = null; row.marks = null; row.autoMarks = null;
    row.manualMarks = {}; row.review = 0; row.note = ""; row.hashWarn = false;
    row.nameWarn = false; row.timeWarn = false; row.duplicateWarn = false;
  }
}

// 원본 열쇠로 아직 못 연 제출본을 열고 자동 채점한다.
async function examOpenPendingRows(doc){
  const state = doc.examGrade;
  if (!state.master) return;
  let gradebookFailed = false;
  for (const row of state.rows){
    if (row.opened) continue;
    const payload = await examUnsealWithPrivate(row.submission.seal, state.master.privateJwk);
    if (!payload || !Array.isArray(payload.answers)){
      row.note = "이 시험지의 열쇠로 열 수 없음";
      row.opened = false;
      continue;
    }
    const answers = {};
    for (const entry of payload.answers){
      if (!entry || !entry.id) continue;
      answers[String(entry.id)] = entry.value;
    }
    row.payload = {
      examId: String(payload.examId || "").slice(0, 64),
      student: String(payload.student || "").trim().slice(0, 60),
      submittedAt: String(payload.submittedAt || "").slice(0, 40),
      signature: String(payload.signature || ""), answers, itemsHash: String(payload.itemsHash || "")
    };
    row.nameWarn = !row.payload.student || row.payload.student !== row.submission.student.trim();
    row.timeWarn = !row.payload.submittedAt || row.payload.submittedAt !== row.submission.submittedAt;
    row.hashWarn = !examHashesMatch(state.master.itemsHash, row.payload.itemsHash);
    if (row.payload.examId !== state.master.id || row.hashWarn){
      row.note = row.payload.examId !== state.master.id
        ? "다른 시험지 제출본 — 채점 차단"
        : "시험지 버전 불일치 — 채점 차단";
      row.marks = null; row.autoMarks = null; row.review = 0; row.opened = true;
      continue;
    }
    const scored = examAutoScore(state.master.items, answers);
    row.marks = { ...scored.marks };
    row.autoMarks = { ...scored.marks };
    const saved = examFindSavedGrade(state.master.id, row.submissionKey);
    if (saved){
      row.manualMarks = { ...(saved.manualMarks || {}) };
      for (const item of state.master.items){
        if (Object.prototype.hasOwnProperty.call(saved.marks || {}, item.id)) row.marks[item.id] = !!saved.marks[item.id];
      }
    }
    row.review = examReviewCount(state.master.items, row);
    row.note = "";
    row.opened = true;
    if (!examPersistGradedRow(state, row)) gradebookFailed = true;
  }
  examRefreshDuplicateWarnings(state);
  if (gradebookFailed) toast("일부 성적을 브라우저 저장소에 저장하지 못했어요. 성적 CSV를 바로 내보내 보관하세요.", 5200, { type: "error" });
}

async function examLoadMasterForGrading(doc){
  if (!examRequireCrypto()) return;
  const files = await examPickFile(".examkey,application/json", false);
  if (!files.length) return;
  const file = files[0];
  let parsed = null;
  try { parsed = JSON.parse(await file.text()); } catch(_){}
  const master = examValidateMasterPayload(parsed);
  if (!master){ toast("시험지 원본(.examkey) 파일을 읽지 못했어요.", 3400); return; }
  const opened = await examUnlockMaster(master, "제출본을 열려면 이 시험지를 만들 때 정한 선생님 암호가 필요해요.");
  if (!opened) return;
  examResetGradedRows(doc.examGrade);
  doc.examGrade.master = {
    id: String(master.id || "").slice(0, 64),
    title: String((master.meta && master.meta.title) || file.name),
    items: opened.items,
    privateJwk: opened.keys.privateJwk,
    itemsHash: await examSha256Hex(examCanonicalStringify(examStripAnswers(opened.items)))
  };
  showLoading("제출본을 여는 중…");
  try { await examOpenPendingRows(doc); }
  finally { hideLoading(); }
  examRenderGrading(doc);
  toast('원본 "' + doc.examGrade.master.title + '" 을(를) 열었어요.', 3000, { type: "success" });
}

function examRenderGrading(doc){
  const state = doc.examGrade;
  const host = doc.el;
  host.innerHTML = ""; host.scrollTop = 0;

  const wrap = document.createElement("section"); wrap.className = "exam-grade";

  const head = document.createElement("div"); head.className = "exam-head";
  const headIcon = document.createElement("span"); headIcon.className = "exam-head-icon"; headIcon.textContent = "🗂";
  const headTitle = document.createElement("strong"); headTitle.textContent = "시험 채점";
  const headSub = document.createElement("span"); headSub.className = "exam-head-sub";
  headSub.textContent = state.master ? (state.master.title + " · " + state.master.items.length + "문항") : "원본 시험지를 열어 주세요";
  head.append(headIcon, headTitle, headSub);
  wrap.appendChild(head);

  const hint = document.createElement("p"); hint.className = "exam-hint";
  hint.textContent = "원본(.examkey)을 열고 제출본(.examdone)을 모으면 자동으로 채점합니다. 주관식은 자동 판정이 틀릴 수 있으니 [답안 보기]에서 확인하세요.";
  wrap.appendChild(hint);

  const bar = document.createElement("div"); bar.className = "exam-bar";
  const masterBtn = document.createElement("button"); masterBtn.type = "button"; masterBtn.className = "btn";
  masterBtn.textContent = state.master ? "🔑 원본 바꾸기" : "🔑 원본 .examkey 열기";
  masterBtn.addEventListener("click", () => examLoadMasterForGrading(doc));
  const addBtn = document.createElement("button"); addBtn.type = "button"; addBtn.className = "btn primary";
  addBtn.textContent = "＋ 제출본 추가";
  addBtn.title = "여러 .examdone 파일을 한 번에 선택할 수 있어요";
  addBtn.addEventListener("click", async () => {
    const files = await examPickFile(".examdone,application/json", true);
    if (!files.length) return;
    const entries = [];
    for (const file of files){
      let parsed = null;
      try { parsed = JSON.parse(await file.text()); } catch(_){}
      const submission = examValidateSubmissionPayload(parsed);
      if (submission) entries.push({ file, submission });
    }
    if (!entries.length){ toast("읽을 수 있는 제출본이 없어요.", 3000); return; }
    showLoading("제출본을 읽는 중…");
    try { await examAddSubmissions(doc, entries); }
    finally { hideLoading(); }
  });
  const barSpacer = document.createElement("div"); barSpacer.className = "spacer";
  const csvBtn = document.createElement("button"); csvBtn.type = "button"; csvBtn.className = "btn";
  csvBtn.textContent = "⬇ 성적 CSV"; csvBtn.title = "표의 내용을 엑셀에서 열 수 있는 CSV 파일로 내보내기";
  csvBtn.addEventListener("click", () => examExportScoreCsv(doc));
  const allCsvBtn = document.createElement("button"); allCsvBtn.type = "button"; allCsvBtn.className = "btn";
  allCsvBtn.textContent = "📚 누적 성적 CSV"; allCsvBtn.title = "저장된 모든 시험의 학생별 점수를 한 CSV로 내보내기";
  allCsvBtn.addEventListener("click", () => examExportCumulativeCsv());
  bar.append(masterBtn, addBtn, barSpacer, csvBtn, allCsvBtn);
  wrap.appendChild(bar);

  const tableWrap = document.createElement("div"); tableWrap.className = "exam-table-wrap";
  const table = document.createElement("table"); table.className = "exam-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["#", "학생", "제출 시각", "점수", "확인 필요", "비고", ""].forEach((label) => {
    const th = document.createElement("th"); th.textContent = label; headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);

  const empty = document.createElement("div"); empty.className = "exam-empty";
  empty.textContent = "아직 추가한 제출본이 없어요. [＋ 제출본 추가]로 .examdone 파일들을 선택하세요.";
  empty.hidden = state.rows.length > 0;
  wrap.appendChild(empty);

  const total = state.master ? state.master.items.length : 0;
  state.rows.forEach((row, index) => {
    if (state.master && row.marks) row.review = examReviewCount(state.master.items, row);
    const tr = document.createElement("tr");
    const td = (node) => { const cell = document.createElement("td"); if (node != null) cell.append(node); tr.appendChild(cell); return cell; };
    td(String(index + 1));
    td(examRowStudent(row)).classList.add("exam-cell-student");
    td(examTimeText(examRowSubmittedAt(row)));

    const score = document.createElement("span"); score.className = "exam-score";
    if (row.marks){
      const got = examCountMarks(row.marks);
      score.textContent = got + " / " + total;
      score.classList.add(got === total ? "is-pass" : "is-mid");
    } else {
      score.textContent = state.master ? "열 수 없음" : "원본 필요";
      score.classList.add("is-none");
    }
    td(score);

    td(row.marks ? (row.review ? row.review + "문항" : "—") : "—");

    const notes = [];
    if (row.note) notes.push(row.note);
    if (row.nameWarn) notes.push("외부 이름 변조·불일치(봉인 속 이름 사용)");
    if (row.timeWarn) notes.push("외부 제출 시각 변조·불일치(봉인 속 시각 사용)");
    if (row.duplicateWarn) notes.push("같은 학생의 복수 제출");
    td(notes.join(" · ") || "—");

    const openBtn = document.createElement("button"); openBtn.type = "button"; openBtn.className = "btn exam-item-tool";
    openBtn.textContent = "답안 보기";
    openBtn.disabled = !row.marks;
    openBtn.addEventListener("click", () => examOpenAnswerSheet(doc, row));
    const removeBtn = document.createElement("button"); removeBtn.type = "button"; removeBtn.className = "btn exam-item-tool";
    removeBtn.textContent = "×"; removeBtn.title = "이 제출본을 목록에서 빼기";
    removeBtn.addEventListener("click", () => {
      state.rows.splice(index, 1);
      examRefreshDuplicateWarnings(state);
      examRenderGrading(doc);
    });
    const tools = document.createElement("div"); tools.className = "exam-cell-tools";
    tools.append(openBtn, removeBtn);
    td(tools);
    tbody.appendChild(tr);
  });

  if (state.rows.length && state.master){
    const summary = document.createElement("div"); summary.className = "exam-total";
    const scored = state.rows.filter(row => row.marks);
    const sum = scored.reduce((acc, row) => acc + examCountMarks(row.marks), 0);
    summary.textContent = "채점 제출본 " + scored.length + "개 · 평균 " + (scored.length ? (sum / scored.length).toFixed(1) : "0") + " / " + total + "점";
    wrap.appendChild(summary);
  }

  examRenderSavedGrades(doc, wrap);

  host.appendChild(wrap);
  examTranslate(wrap);
}

// 학생 답안 상세 — 문항별 학생 답·정답을 나란히 보고, 주관식은 O/X 를 직접 고칠 수 있다.
function examOpenAnswerSheet(doc, row){
  const state = doc.examGrade;
  if (!state.master || !row.marks) return;

  const modal = document.createElement("div"); modal.className = "modal exam-sheet-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const title = document.createElement("h3"); title.textContent = examRowStudent(row) + " 답안";
  const sub = document.createElement("p"); sub.className = "sub";
  sub.textContent = state.master.title + " · 제출 " + examTimeText(examRowSubmittedAt(row));

  const body = document.createElement("div"); body.className = "exam-sheet-body";
  const scoreLine = document.createElement("div"); scoreLine.className = "exam-sheet-score";
  const refreshScore = () => {
    scoreLine.textContent = "점수 " + examCountMarks(row.marks) + " / " + state.master.items.length + "점";
  };
  refreshScore();
  body.appendChild(scoreLine);

  state.master.items.forEach((item, index) => {
    const line = document.createElement("div"); line.className = "exam-sheet-item";
    const head = document.createElement("div"); head.className = "exam-sheet-head";
    const no = document.createElement("span"); no.className = "exam-item-no"; no.textContent = (index + 1) + "번";
    const kind = document.createElement("span"); kind.className = "exam-item-kind";
    kind.textContent = item.type === "choice" ? "객관식" : "주관식";
    const headSpacer = document.createElement("div"); headSpacer.className = "spacer";
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "btn exam-mark-toggle";
    const applyToggle = () => {
      const ok = !!row.marks[item.id];
      toggle.textContent = ok ? "○ 정답" : "✗ 오답";
      toggle.classList.toggle("is-pass", ok);
      toggle.classList.toggle("is-fail", !ok);
    };
    toggle.title = "선생님이 직접 정답/오답을 바꿉니다";
    toggle.addEventListener("click", () => {
      row.marks[item.id] = !row.marks[item.id];
      row.manualMarks[item.id] = row.marks[item.id];
      row.review = examReviewCount(state.master.items, row);
      if (!examPersistGradedRow(state, row)) toast("수동 채점 결과를 저장하지 못했어요. 성적 CSV로 보관하세요.", 4200, { type: "error" });
      applyToggle(); refreshScore();     // 뒤의 표는 창을 닫을 때 한 번만 다시 그린다
    });
    applyToggle();
    head.append(no, kind, headSpacer, toggle);
    line.appendChild(head);

    const stem = document.createElement("div"); stem.className = "exam-sheet-stem"; stem.textContent = item.stem;
    line.appendChild(stem);

    const given = row.payload.answers[item.id];
    const grid = document.createElement("div"); grid.className = "exam-sheet-grid";
    const cell = (caption, value, extraClass) => {
      const box = document.createElement("div"); box.className = "exam-sheet-cell " + (extraClass || "");
      const cap = document.createElement("b"); cap.textContent = caption;
      const text = document.createElement("span"); text.textContent = value;
      box.append(cap, text); grid.appendChild(box);
    };
    if (item.type === "choice"){
      const pickIndex = Number(given) || 0;
      const label = (index2) => index2 > 0
        ? ((EXAM_CHOICE_MARKS[index2 - 1] || index2) + " " + String((item.choices[index2 - 1] || {}).text || "").slice(0, 80))
        : "(무응답)";
      cell("학생 답", label(pickIndex));
      cell("정답", label(item.answerIndex));
    } else {
      cell("학생 답", String(given || "").trim() || "(무응답)");
      cell("정답", examShortAnswerList(item).join(" / ") || "(정답 없음)");
    }
    line.appendChild(grid);
    body.appendChild(line);
  });

  if (row.payload.signature){
    const signBox = document.createElement("div"); signBox.className = "exam-sheet-sign";
    const cap = document.createElement("b"); cap.textContent = "서명";
    const img = document.createElement("img"); img.src = row.payload.signature; img.alt = "학생 서명";
    signBox.append(cap, img);
    body.appendChild(signBox);
  }

  const actions = document.createElement("div"); actions.className = "modal-actions";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const resetBtn = document.createElement("button"); resetBtn.type = "button"; resetBtn.className = "btn";
  resetBtn.textContent = "자동 채점으로 되돌리기";
  resetBtn.addEventListener("click", () => {
    row.marks = { ...(row.autoMarks || {}) };
    row.manualMarks = {};
    row.review = examReviewCount(state.master.items, row);
    if (!examPersistGradedRow(state, row)) toast("수동 채점 결과를 저장하지 못했어요. 성적 CSV로 보관하세요.", 4200, { type: "error" });
    close();
    examRenderGrading(doc);
    examOpenAnswerSheet(doc, row);
  });
  const closeBtn = document.createElement("button"); closeBtn.type = "button"; closeBtn.className = "btn primary";
  closeBtn.textContent = "닫기";
  actions.append(resetBtn, spacer, closeBtn);

  const close = () => {
    if (!examPersistGradedRow(state, row)) toast("수동 채점 결과를 저장하지 못했어요. 성적 CSV로 보관하세요.", 4200, { type: "error" });
    window.removeEventListener("keydown", onKey, true); modal.remove(); examRenderGrading(doc);
  };
  const onKey = (e) => { if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); } };
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  card.append(title, sub, body, actions);
  modal.appendChild(card);
  document.body.appendChild(modal);
  window.addEventListener("keydown", onKey, true);
  examTranslate(card);
}

function examExportScoreCsv(doc){
  const state = doc.examGrade;
  if (!state.rows.length){ toast("내보낼 제출본이 없어요.", 2400); return; }
  if (!state.master){ toast("먼저 원본(.examkey)을 열어 채점한 뒤 내보내세요.", 3000); return; }
  const total = state.master.items.length;
  const header = ["시험", "학생", "제출 시각", "점수", "만점", "확인 필요", "비고"];
  for (let i = 0; i < total; i++) header.push((i + 1) + "번");
  const lines = [header.map(examCsvCell).join(",")];
  for (const row of state.rows){
    const notes = [];
    if (row.note) notes.push(row.note);
    if (row.nameWarn) notes.push("외부 이름 불일치");
    if (row.timeWarn) notes.push("외부 제출 시각 불일치");
    if (row.duplicateWarn) notes.push("같은 학생의 복수 제출");
    const line = [
      state.master.title, examRowStudent(row), examRowSubmittedAt(row),
      row.marks ? examCountMarks(row.marks) : "", total,
      row.marks ? examReviewCount(state.master.items, row) : "", notes.join(" · ")
    ];
    for (const item of state.master.items) line.push(row.marks ? (row.marks[item.id] ? "O" : "X") : "");
    lines.push(line.map(examCsvCell).join(","));
  }
  const outName = "성적_" + examSafeFileToken(state.master.title, "시험") + "_" + examStampName() + ".csv";
  examSaveTextFile(String.fromCharCode(0xFEFF) + lines.join("\r\n"), outName, "성적표", "text/csv");
}

function examRenderSavedGrades(doc, wrap){
  const records = examReadGradebook().records
    .slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const attempts = new Map();
  for (const record of records){
    const key = record.examId + "\n" + record.student.toLocaleLowerCase("ko");
    attempts.set(key, (attempts.get(key) || 0) + 1);
  }
  const section = document.createElement("section"); section.className = "exam-gradebook";
  const heading = document.createElement("div"); heading.className = "exam-gradebook-head";
  const title = document.createElement("strong"); title.textContent = "📚 저장된 학생별 성적";
  const sub = document.createElement("span"); sub.textContent = records.length + "건 · 수동 채점 결과는 자동 저장됩니다";
  heading.append(title, sub); section.appendChild(heading);
  if (!records.length){
    const empty = document.createElement("div"); empty.className = "exam-empty";
    empty.textContent = "아직 저장된 성적이 없어요."; section.appendChild(empty); wrap.appendChild(section); return;
  }
  const tableWrap = document.createElement("div"); tableWrap.className = "exam-table-wrap exam-gradebook-table-wrap";
  const table = document.createElement("table"); table.className = "exam-table";
  const thead = document.createElement("thead"); const hr = document.createElement("tr");
  ["시험", "학생", "제출 시각", "점수", "확인 필요", "비고", "저장 시각", ""].forEach(label => {
    const th = document.createElement("th"); th.textContent = label; hr.appendChild(th);
  });
  thead.appendChild(hr); const tbody = document.createElement("tbody");
  for (const record of records){
    const tr = document.createElement("tr");
    const td = (value) => { const cell = document.createElement("td"); cell.textContent = String(value == null ? "" : value); tr.appendChild(cell); return cell; };
    td(record.examTitle); td(record.student).classList.add("exam-cell-student");
    td(examTimeText(record.submittedAt)); td(record.score + " / " + record.total);
    td(record.review ? record.review + "문항" : "—");
    const attemptKey = record.examId + "\n" + record.student.toLocaleLowerCase("ko");
    td((attempts.get(attemptKey) || 0) > 1 ? "복수 제출" : "—"); td(examTimeText(record.updatedAt));
    const tools = document.createElement("td");
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn exam-item-tool"; remove.textContent = "삭제";
    remove.addEventListener("click", async () => {
      if (!await confirmDialog(record.examTitle + " · " + record.student + " 성적을 저장 목록에서 삭제할까요?", "삭제", "취소")) return;
      examDeleteSavedGrade(record.examId, record.submissionKey); examRenderGrading(doc);
    });
    tools.appendChild(remove); tr.appendChild(tools); tbody.appendChild(tr);
  }
  table.append(thead, tbody); tableWrap.appendChild(table); section.appendChild(tableWrap); wrap.appendChild(section);
}

function examExportCumulativeCsv(){
  const records = examReadGradebook().records
    .slice().sort((a, b) => a.examTitle.localeCompare(b.examTitle, "ko") || a.student.localeCompare(b.student, "ko"));
  if (!records.length){ toast("내보낼 저장 성적이 없어요.", 2400); return; }
  const attempts = new Map();
  for (const record of records){
    const key = record.examId + "\n" + record.student.toLocaleLowerCase("ko");
    attempts.set(key, (attempts.get(key) || 0) + 1);
  }
  const header = ["시험", "학생", "제출 시각", "점수", "만점", "확인 필요", "비고", "마지막 수정"];
  const lines = [header.map(examCsvCell).join(",")];
  for (const record of records){
    lines.push([
      record.examTitle, record.student, record.submittedAt, record.score,
      record.total, record.review,
      (attempts.get(record.examId + "\n" + record.student.toLocaleLowerCase("ko")) || 0) > 1 ? "복수 제출" : "",
      record.updatedAt
    ].map(examCsvCell).join(","));
  }
  examSaveTextFile(String.fromCharCode(0xFEFF) + lines.join("\r\n"), "누적성적_" + examStampName() + ".csv", "누적 성적표", "text/csv");
}
