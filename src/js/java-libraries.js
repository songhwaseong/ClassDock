"use strict";

/* 자바 실습에서 함께 쓸 라이브러리(jar) — 선택 상태와 EXE 런처 API 호출.
   카탈로그(id → 좌표)는 런처가 갖고 있고 프런트는 /java-lib-catalog 로 받아 그리기만 한다.
   프런트가 경로나 주소를 만들지 않으므로, 클래스패스에 얹히는 것은 언제나 서버가 아는 목록뿐이다.
   흐름(목록 조회 → 설치 스트림 → 증분 로그 → 취소 → 삭제)은 js-libraries.js 의 npm 패키지와 같다. */

const JAVA_LIBRARY_STORAGE_PREFIX = "classdock-java-libraries:";
const JAVA_LIBRARY_MAX_SELECTED = 20;      // 런처가 한 번의 실행에서 보는 상한과 같은 값
// 런처의 검사(JavaLibraryIdRe·JavaLibrarySegmentRe)와 같은 모양. 여기서 먼저 걸러 헛된 요청을 줄인다.
const JAVA_LIBRARY_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const JAVA_LIBRARY_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,99}$/;

// 카탈로그 id 또는 group:artifact:version 인지. .. 는 폴더를 거슬러 오르므로 어느 자리에서도 막는다.
function javaLibraryValidSpec(value){
  const spec = String(value == null ? "" : value).trim();
  if (!spec || spec.indexOf("..") >= 0) return false;
  if (JAVA_LIBRARY_ID_RE.test(spec)) return true;
  const parts = spec.split(":");
  return parts.length === 3 && parts.every((part) => JAVA_LIBRARY_SEGMENT_RE.test(part));
}

// 저장된 값이 무엇이든 {version, ids} 로 만든다(손상된 localStorage 로 실행이 막히지 않게).
function javaLibraryState(value){
  const input = value && typeof value === "object" ? value : {};
  const ids = [];
  for (const raw of Array.isArray(input.ids) ? input.ids : []){
    const spec = String(raw == null ? "" : raw).trim();
    if (!javaLibraryValidSpec(spec) || ids.indexOf(spec) >= 0) continue;
    ids.push(spec);
    if (ids.length >= JAVA_LIBRARY_MAX_SELECTED) break;
  }
  return { version:1, ids };
}

// 채점 테스트 저장 키와 같은 방식 — 문서마다 따로 기억하되 다른 기능과 자리를 나눈다.
function javaLibraryStorageKey(draftKey){
  const key = String(draftKey || "");
  const colon = key.indexOf(":");
  return JAVA_LIBRARY_STORAGE_PREFIX + (colon >= 0 ? key.slice(colon + 1) : key);
}

function loadJavaLibraryState(key){
  try { return javaLibraryState(JSON.parse(localStorage.getItem(String(key || "")) || "null")); }
  catch(_){ return javaLibraryState(null); }
}

function saveJavaLibraryState(key, value){
  try { localStorage.setItem(String(key || ""), JSON.stringify(javaLibraryState(value))); return true; }
  catch(_){ return false; }
}

function javaLibrarySelectionSignature(value){
  return javaLibraryState(value).ids.join(",");
}

// 실행 요청에 붙일 libs= 값. 서버가 이 목록을 다시 검사하고 캐시에서 찾는다.
function javaLibraryQuery(value){
  return javaLibraryState(value).ids.join(",");
}

/* 고른 라이브러리가 알려 주는 클래스 이름 — 편집기 자동완성에 얹는다.
   rows 는 /java-lib-catalog 가 준 그대로(words 는 공백으로 나뉜 한 줄). */
function javaLibraryCompletionWords(value, rows){
  const selected = javaLibraryState(value).ids;
  const words = [];
  for (const row of Array.isArray(rows) ? rows : []){
    if (!row || !row.words) continue;
    if (selected.indexOf(row.id) < 0 && selected.indexOf(row.spec) < 0
      && selected.indexOf(row.coordinate) < 0) continue;
    for (const word of String(row.words).split(/\s+/)){
      if (word && words.indexOf(word) < 0) words.push(word);
    }
  }
  return words;
}

function javaLibraryErrorText(raw){
  const value = String(raw || "").trim().replace(/^javalib-failed:\s*/, "");
  const messages = {
    "invalid-library-spec":"라이브러리 이름을 확인해 주세요. 목록의 이름이나 group:artifact:version 만 쓸 수 있어요.",
    "java-lib-busy":"다른 라이브러리를 받는 중이에요. 끝난 뒤에 다시 눌러 주세요.",
    "java-lib-exists":"이미 이 컴퓨터에 있는 라이브러리예요. 목록에서 선택만 하면 됩니다.",
    "java-lib-limit":"라이브러리는 최대 20개까지 보관할 수 있어요. 쓰지 않는 것을 지워 주세요.",
    "java-lib-not-found":"이 컴퓨터에서 그 라이브러리를 찾지 못했어요.",
    "java-lib-bundled":"프로그램에 함께 담겨 온 라이브러리라 지울 수 없어요.",
    "no-install-root":"라이브러리를 저장할 폴더를 찾지 못했어요.",
    "javalib-confirmation-required":"설치 확인 정보가 전달되지 않았어요. 다시 시도해 주세요."
  };
  return messages[value] || value || "라이브러리 작업에 실패했어요.";
}

// 런처가 준 한 줄을 화면이 기대하는 모양으로 (없는 값은 빈 값으로 채운다).
function javaLibraryRow(raw){
  const row = raw && typeof raw === "object" ? raw : {};
  return {
    spec: String(row.spec || ""),
    id: String(row.id || ""),
    label: String(row.label || ""),
    coordinate: String(row.coordinate || ""),
    installed: !!row.installed,
    bundled: !!row.bundled,
    size: Math.max(0, Number(row.size) || 0),
    words: String(row.words || ""),
    sample: String(row.sample || "")
  };
}

async function javaLibraryFetchRows(path){
  if (location.protocol !== "http:" && location.protocol !== "https:") return { available:false, reason:"not-exe", rows:[] };
  try {
    const response = await fetch(path, { cache:"no-store" });
    if (!response.ok){
      if (response.status === 404) return { available:false, reason:"not-exe", rows:[] };
      throw new Error(javaLibraryErrorText(await response.text()));
    }
    const list = await response.json();
    return { available:true, reason:"", rows:(Array.isArray(list) ? list : []).map(javaLibraryRow) };
  } catch(error){
    if (error instanceof TypeError) return { available:false, reason:"not-exe", rows:[] };   // 로컬 서버 없음
    throw error;
  }
}

// 고를 수 있는 목록(설치 여부 포함).
function javaLibraryCatalog(){
  return javaLibraryFetchRows("/java-lib-catalog");
}

// 이 컴퓨터에 실제로 있는 것 전부 — 카탈로그에 없는 직접 좌표도 여기에 나온다.
function javaLibraryInstalled(){
  return javaLibraryFetchRows("/java-lib-list");
}

/* 설치 1건. 시작 요청이 작업 번호를 주고, 로그는 증분 폴링으로 받아 hooks.onLog 로 흘린다.
   hooks.onCancel 은 취소 함수를 넘겨 받는 자리(진행 중에만 값이 있고 끝나면 null 이 온다). */
async function javaLibraryInstallStream(spec, hooks){
  hooks = hooks || {};
  const response = await fetch("/java-lib-install-start", {
    method:"POST",
    headers:{ "Content-Type":"text/plain; charset=utf-8", "X-ClassDock-JavaLib-Confirm":"1" },
    body:String(spec || "").trim()
  });
  if (!response.ok) throw new Error(javaLibraryErrorText(await response.text()));
  let id = "";
  try { id = String((await response.json()).id || ""); } catch(_){ id = ""; }
  if (!id) throw new Error("설치 작업 번호를 받지 못했어요.");
  let cancelSent = false;
  const cancel = async () => {
    if (cancelSent) return;
    cancelSent = true;
    try { await fetch("/java-lib-install-cancel?id=" + encodeURIComponent(id), { method:"POST" }); } catch(_){}
  };
  if (typeof hooks.onCancel === "function") hooks.onCancel(cancel);
  let known = -1, full = "", failures = 0;
  try {
    for (;;){
      let data;
      try {
        const poll = await fetch("/java-lib-install-poll?id=" + encodeURIComponent(id) + "&from=" + known, { cache:"no-store" });
        if (!poll.ok) throw new Error(javaLibraryErrorText(await poll.text()));
        data = await poll.json();
        failures = 0;
      } catch(error){
        // 잠깐 끊긴 것과 정말 실패한 것을 구분한다 — 세 번 이어서 실패하면 받던 것을 접는다.
        if (++failures < 3){ await new Promise((resolve) => setTimeout(resolve, failures * 700)); continue; }
        await cancel();
        throw error;
      }
      if (!data.unchanged){
        if (typeof data.logDelta === "string") full += data.logDelta;
        else if (typeof data.log === "string") full = data.log;
        known = full.length;
        if (typeof hooks.onLog === "function") hooks.onLog(full);
        if (data.complete) return { ok:data.code === 0, code:data.code, output:full, cancelled:!!data.cancelled };
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } finally {
    if (typeof hooks.onCancel === "function") hooks.onCancel(null);
  }
}

async function javaLibraryDelete(spec){
  const response = await fetch("/java-lib-delete?id=" + encodeURIComponent(String(spec || "")), { method:"POST" });
  if (!response.ok) throw new Error(javaLibraryErrorText(await response.text()));
  return true;
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    JAVA_LIBRARY_STORAGE_PREFIX,
    JAVA_LIBRARY_MAX_SELECTED,
    javaLibraryValidSpec,
    javaLibraryState,
    javaLibraryStorageKey,
    javaLibrarySelectionSignature,
    javaLibraryQuery,
    javaLibraryCompletionWords,
    javaLibraryErrorText,
    javaLibraryRow
  };
}
