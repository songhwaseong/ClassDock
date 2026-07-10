"use strict";

const {
  decodeWorkspace, encodeWorkspace, escapeAttr, escapeHtml, fingerprintBytes, inlineMarkdown, indexWorkspacePathsByFolder,
  formatZipOpenSummary, inferPythonLocalImportRoots, inferPythonProjectRunContext, isExternalRef, markdownToHtml, pythonRelativePathLiterals, pythonRunScopeIncludesPath, resolveProjectRelativePath, resolveRuntimeOutputPath, resolveSiblingPath, safeArchivePath, safeLink, transformEditorLines,
  detectCsvDelimiter, detectTextEncoding, indexCsvRows, parseCsvRecord,
  pythonCompletionCandidates, normalizeIdentifierSelection, findNextIdentifierOccurrence, identifierOccurrences,
  diffTextEdit, applyLinkedIdentifierEdit, pythonOpenClosePlan, completionReplacementRange, completionInsertionPlan,
  lineNumberAtOffset, lineStartOffset, findPythonLocalDefinition, parsePythonTracebackLocation, classifyPythonStderr,
  explainPythonError, contentMatchSnippet, suggestRegexPatterns, countRegexMatches,
  normalizeShortcut, shortcutFromEventLike, shortcutMatchesEvent, normalizePythonVariables,
  normalizeAssignmentTests, normalizeGradingOutput, normalizePythonDiagnostics, normalizePythonTraceReport,
  prettyPrintJsonText, jsonTreeNodeInfo, orderHwpxSections, workspaceFolderMarkerPath, workspaceFolderPathFromMarker
} = PdfSignerCore;

/* ===== 다중 문서 상태 =====
 * docs: 열린 문서들. 각 문서는 자체 컨테이너(el)를 가지며 활성 문서만 보인다.
 *   공통: { id, name, kind:'pdf'|'office'|'image', el }
 *   pdf 추가: { pdfBytes, fileName, pages[], elements[], selected, addCount }
 * state = 활성 문서(아래 PDF 함수들이 그대로 활성 문서에 동작), viewer = 활성 문서 컨테이너 */
const docs = [];
const navNodes = [];
// navNodes 빠른 조회 인덱스(nodeId→node) + 레슨 루트 캐시.
// 트리(추가/삭제)가 바뀔 때 bumpNavTree() 로 버전을 올리면, 다음 조회 때만 다시 만든다.
// (작은 묶음엔 부담이 없고, 파일이 많은 압축에서 클릭마다 배열을 선형 탐색하던 비용을 없앤다.)
let navTreeVersion = 0, navIndexVersion = -1;
const navIndex = new Map();
function bumpNavTree(){ navTreeVersion++; }
function ensureNavIndex(){
  if (navIndexVersion === navTreeVersion) return;
  navIndex.clear();
  for (const n of navNodes) navIndex.set(n.nodeId, n);
  navIndexVersion = navTreeVersion;
}
function navNodeById(id){ ensureNavIndex(); return navIndex.get(id) || null; }
let tabOrder = [];        // 선택(활성화)한 문서 id 순서 — 헤더 아래 탭바
// 활성화 이력(MRU): 가장 최근에 활성이었던 문서가 [0]. setActiveDoc 마다 갱신.
// 활성 탭을 닫을 때 "직전에 보던 문서"로 돌아가는 데 쓴다(VSCode와 같은 패턴).
let activeMru = [];
let sidebarCollapsed = false;
let sidebarCursorKey = null;   // 사이드바 키보드 커서(현재 강조된 줄의 nodeId)
try { sidebarCollapsed = localStorage.getItem("sidebarCollapsed") === "true"; } catch(e){}
let activeId = 0, docSeq = 0, navSeq = 0;
let state = null;        // 활성 문서
let viewer = null;       // 활성 문서 컨테이너(pdf 렌더/측정용)
let studyPdfId = null;   // 분할 작업의 참고 문서 ID (기존 변수명 호환 유지)
let studyReferenceLocked = false; // 필요할 때만 참고 문서를 잠근다. 기본값은 기존 학습 화면처럼 편집 가능.
let lastSig = null;      // 최근 서명(문서 공통, 재사용)

let fileQueue = Promise.resolve();
// 자동 복원 직렬화는 브라우저와 로컬 서버에 복사본을 만들므로 보수적으로 제한한다.
// 원본 파일을 여는 크기에는 영향을 주지 않는다.
const WORKSPACE_CAP = 256 * 1024 * 1024;
const SHORTCUT_DEFINITIONS = Object.freeze([
  { id:"openFiles", label:"파일 열기", description:"파일 선택 창 열기", defaultValue:"Ctrl+O" },
  { id:"openFolder", label:"폴더 열기", description:"폴더 전체 열기", defaultValue:"Ctrl+Shift+O" },
  { id:"saveCurrent", label:"현재 파일 저장", description:"PDF 내보내기 또는 Python 저장", defaultValue:"Ctrl+S" },
  { id:"closeCurrent", label:"현재 파일 닫기", description:"활성 탭 닫기", defaultValue:"Ctrl+W" },
  { id:"reopenClosed", label:"닫은 파일 다시 열기", description:"방금 닫은 탭 복원", defaultValue:"Ctrl+Shift+T" },
  { id:"focusSearch", label:"열린 파일 검색", description:"사이드바 검색창으로 이동", defaultValue:"Ctrl+F" },
  { id:"scratchpad", label:"임시 메모", description:"메모 열기·닫기", defaultValue:"Ctrl+M" },
  { id:"newPython", label:"새 Python 코드", description:"빈 Python 편집기 만들기", defaultValue:"Alt+N" },
  { id:"previousFile", label:"이전 수업 파일", description:"이전 열린 탭으로 이동", defaultValue:"Ctrl+ArrowLeft" },
  { id:"nextFile", label:"다음 수업 파일", description:"다음 열린 탭으로 이동", defaultValue:"Ctrl+ArrowRight" },
  { id:"findInDocument", label:"문서 안에서 찾기", description:"PDF 찾기 또는 편집기 찾기·바꾸기", defaultValue:"Ctrl+H" },
  { id:"runCode", label:"Python 코드 실행", description:"현재 Python 코드 실행", defaultValue:"Ctrl+Enter" },
  { id:"runNotebook", label:"노트북 전체 실행", description:"현재 노트북의 모든 코드 셀 실행", defaultValue:"Ctrl+Shift+Enter" },
  { id:"screensaverStart", label:"대기 화면 지금 시작", description:"모니터 전체 화면으로 대기 화면 켜기", defaultValue:"Ctrl+F12" }
]);
const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(SHORTCUT_DEFINITIONS.map((item) => [item.id, item.defaultValue])));
const DEFAULT_APP_SETTINGS = {
  uiScale: 1, pdfZoom: 1.25, performance: "memory", autoRestore: true, pdfRecovery: true,
  screensaver: { enabled: false, idleMin: 5, sound: false },
  shortcuts: DEFAULT_SHORTCUTS
};
// 화면보호기 설정 정규화(옵션에서 켤 때만 동작·유효한 대기 시간만 허용). sound 는 '지금 시작' 수동 재생 전용.
function normalizeScreensaver(value){
  const s = value && typeof value === "object" ? value : {};
  const idle = Number(s.idleMin);
  return { enabled: !!s.enabled, idleMin: [1, 3, 5, 10, 20].includes(idle) ? idle : 5, sound: !!s.sound };
}
function normalizeShortcutMap(value){
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(SHORTCUT_DEFINITIONS.map((item) => [
    item.id, normalizeShortcut(source[item.id]) || item.defaultValue
  ]));
}
let appSettings = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem("pdfSignerSettings") || "{}");
    return { ...DEFAULT_APP_SETTINGS, ...saved, screensaver:normalizeScreensaver(saved.screensaver), shortcuts:normalizeShortcutMap(saved.shortcuts) };
  }
  catch(e){ return { ...DEFAULT_APP_SETTINGS, screensaver:normalizeScreensaver(), shortcuts:normalizeShortcutMap() }; }
})();
function saveAppSettings(next){
  const merged = { ...appSettings, ...next };
  appSettings = { ...DEFAULT_APP_SETTINGS, ...merged, screensaver:normalizeScreensaver(merged.screensaver), shortcuts:normalizeShortcutMap(merged.shortcuts) };
  try { localStorage.setItem("pdfSignerSettings", JSON.stringify(appSettings)); } catch(e){}
}
function shortcutValue(action){ return (appSettings.shortcuts && appSettings.shortcuts[action]) || DEFAULT_SHORTCUTS[action] || ""; }
function shortcutMatches(e, action){ return !e.isComposing && shortcutMatchesEvent(e, shortcutValue(action)); }
function shortcutActionForEvent(e){
  if (!e || e.isComposing) return "";
  return (SHORTCUT_DEFINITIONS.find((item) => shortcutMatches(e, item.id)) || {}).id || "";
}
function shortcutDisplay(value){
  return normalizeShortcut(value)
    .replace(/ArrowLeft/g, "←").replace(/ArrowRight/g, "→")
    .replace(/ArrowUp/g, "↑").replace(/ArrowDown/g, "↓")
    .replace(/\bMeta\b/g, "Win");
}
function validateShortcutChoice(value){
  const normalized = normalizeShortcut(value);
  if (!normalized) return "단축키를 인식하지 못했어요.";
  const hasMainModifier = /^(?:Ctrl|Meta|Alt)\+/.test(normalized);
  if (!hasMainModifier) return "Ctrl, Alt 또는 Win 키를 함께 눌러 주세요.";
  const unavailable = new Set([
    "Ctrl+C","Ctrl+X","Ctrl+V","Ctrl+A","Ctrl+Z","Ctrl+Shift+Z","Ctrl+Y",
    "Ctrl+D","Ctrl+Space","Ctrl+/","Ctrl+=","Ctrl+Shift+=","Ctrl+-","Ctrl+0",
    "Alt+ArrowLeft","Alt+ArrowRight","Alt+ArrowUp","Alt+ArrowDown","Ctrl+Alt+ArrowDown",
    "Ctrl+L","Ctrl+T","Ctrl+N","Ctrl+R","Ctrl+Shift+T","Ctrl+Shift+R",
    "Alt+F4","F5","F11"
  ]);
  if (unavailable.has(normalized)) return "브라우저·편집 기능에서 사용하는 조합이라 지정할 수 없어요.";
  return "";
}
function shortcutConflict(shortcuts){
  const seen = new Map();
  for (const item of SHORTCUT_DEFINITIONS){
    const value = normalizeShortcut(shortcuts && shortcuts[item.id]);
    if (!value) continue;
    if (seen.has(value)) return { value, first:seen.get(value), second:item.id };
    seen.set(value, item.id);
  }
  return null;
}
function syncShortcutHints(root=document){
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("[data-shortcut-action]").forEach((el) => {
    const action = el.dataset.shortcutAction, display = shortcutDisplay(shortcutValue(action));
    if (el.tagName === "KBD" || el.dataset.shortcutDisplay === "true") el.textContent = display;
    const title = el.dataset.shortcutTitle;
    if (title) {
      el.title = title + " (" + display + ")";
      if (el.dataset.shortcutAria === "true") el.setAttribute("aria-label", el.title);
    }
  });
}
function currentUiScale(){ const scale = Number(appSettings.uiScale); return [1,1.12,1.25].includes(scale) ? scale : 1; }
function applyUiScale(){
  const scale = currentUiScale();
  document.documentElement.dataset.uiScale = String(scale);
  document.body.style.zoom = String(scale);
  document.body.style.width = (100 / scale) + "%";
  document.body.style.height = (100 / scale) + "vh";
}
applyUiScale();
function defaultPdfZoom(){ const z = Number(appSettings.pdfZoom); return [1,1.25,1.5].includes(z) ? z : 1.25; }
function pdfRenderProfile(){
  return appSettings.performance === "quality"
    ? { prefetchScale: 3, prefetchMaxSide: 5000, rootMargin: "300% 0px" }
    : { prefetchScale: 1.8, prefetchMaxSide: 3600, rootMargin: "100% 0px" };
}

const byId = (id) => document.getElementById(id);
const dropzone = byId("dropzone");

function renderRegexSuggestionPanel(panel, example, countText, onApply) {
  if (!panel) return;
  panel.textContent = "";
  const head = document.createElement("div");
  head.className = "regex-suggest-head";
  head.innerHTML = "<strong>추천 패턴</strong><span>클릭하면 정규식으로 적용됩니다</span>";
  panel.appendChild(head);
  const suggestions = suggestRegexPatterns(example);
  if (!suggestions.length) {
    const empty = document.createElement("div");
    empty.className = "regex-suggest-empty";
    empty.textContent = "abc43처럼 찾고 싶은 예시를 먼저 입력해 보세요.";
    panel.appendChild(empty);
    return;
  }
  suggestions.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "regex-suggest-item";
    const top = document.createElement("span"); top.className = "regex-suggest-top";
    const label = document.createElement("span"); label.className = "regex-suggest-label"; label.textContent = item.label;
    const code = document.createElement("code"); code.textContent = item.pattern;
    top.append(label, code);
    if (typeof countText === "string") {
      const count = document.createElement("span"); count.className = "regex-suggest-count";
      count.textContent = countRegexMatches(countText, item.pattern).toLocaleString() + "개 일치";
      top.appendChild(count);
    } else if (countText === undefined) {
      const count = document.createElement("span"); count.className = "regex-suggest-count";
      count.textContent = "일치 계산 중…";
      top.appendChild(count);
    }
    const description = document.createElement("span");
    description.className = "regex-suggest-description"; description.textContent = item.description;
    button.append(top, description);
    button.addEventListener("click", () => onApply(item));
    panel.appendChild(button);
  });
}

/* ===== pdf.js 워커 (file:// 에서도 동작하도록 blob 으로) ===== */
let workerReady = null;
function ensureWorker(){
  if (workerReady) return workerReady;
  workerReady = (async () => {
    // 1) 인라인 워커(오프라인 빌드)가 있으면 우선 사용
    const inline = document.getElementById("pdfWorkerSrc");
    if (inline && inline.textContent.trim().length > 100){
      const blob = new Blob([inline.textContent], { type: "application/javascript" });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      return;
    }
    // 2) 없으면 CDN 워커를 blob 으로 받아 사용 (file:// 호환)
    const url = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    try {
      const res = await fetch(url);
      const txt = await res.text();
      const blob = new Blob([txt], { type: "application/javascript" });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } catch (e) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = url; // 실패 시 fallback
    }
  })();
  return workerReady;
}

/* ===== 유틸 ===== */
/* 공용 토스트: 화면 하단 고정 위치에 잠깐 떠서 "방금 일어난 일"을 알린다.
   #toast 영역이 aria-live="polite" 라 스크린리더도 같은 내용을 음성으로 안내한다.
   opts.type: "success" | "error" — 왼쪽 색 띠로 결과를 구분
   opts.action: { label, onClick } — 토스트 안 행동 버튼(예: 저장 후 '폴더 열기') */
function toast(msg, ms=2200, opts={}){
  const area = byId("toast"); if (!area) return null;
  msg = String(msg);
  // 같은 문구가 이미 떠 있으면 갈아 끼워 중복으로 쌓이지 않게 한다(저장 연타 등).
  for (const old of [...area.children]) if (old.dataset.msg === msg) old.remove();
  while (area.children.length >= 3) area.firstChild.remove();
  const item = document.createElement("div");
  item.className = "toast-item" + ((opts.type === "success" || opts.type === "error") ? " " + opts.type : "");
  item.dataset.msg = msg;
  const text = document.createElement("span");
  text.className = "toast-msg"; text.textContent = msg;
  item.appendChild(text);
  let timer;
  const dismiss = () => { clearTimeout(timer); item.classList.remove("show"); setTimeout(() => item.remove(), 200); };
  if (opts.action && opts.action.label){
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "toast-action"; btn.textContent = opts.action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      try { if (typeof opts.action.onClick === "function") opts.action.onClick(); } finally { dismiss(); }
    });
    item.appendChild(btn);
    ms = Math.max(ms, 6000);                 // 버튼이 있으면 누를 시간을 넉넉히 준다
  }
  item.addEventListener("click", dismiss);   // 토스트 아무 곳이나 눌러도 닫힘
  area.appendChild(item);
  requestAnimationFrame(() => item.classList.add("show"));
  timer = setTimeout(dismiss, ms);
  return item;
}
function showLoading(msg){ byId("loadingMsg").textContent = msg||"처리 중…"; byId("loading").hidden = false; }
function hideLoading(){
  // 작업공간 배치 복원 중 내부 로더가 완료돼도 전체 복원이 끝날 때까지 화면을 유지한다.
  if (typeof uiBatchDepth !== "undefined" && uiBatchDepth > 0) return;
  byId("loading").hidden = true;
}
function updateLoading(msg){ if (msg) byId("loadingMsg").textContent = msg; }
function yieldToBrowser(){ return new Promise(resolve => setTimeout(resolve, 0)); }
// PDF 렌더 해상도: 화면에 "보이는 배율(줌)"에 맞춰 캔버스 픽셀을 잡아 크롬처럼 어느 배율이든 또렷하게 한다.
// 최소 RENDER_SCALE 배 슈퍼샘플(작게 봐도 선명) + 줌이 커지면 그 배율로 재렌더(targetRenderDpr 참고).
// RENDER_MAX_SIDE 로 캔버스 한 변(px)을 제한해 고배율 메모리를 보호한다(단 z=1 품질은 보존).
const RENDER_SCALE = 3;
const RENDER_MAX_SIDE = 5000;
// PDF 기본 표시 크기 배수(맞춤 대비). 1.0 = 기본, 키우면 더 크게 열림.
const FIT_SCALE = 1.0;
// PDF를 처음 열 때 표시 배율. 125%에서 고해상도 렌더가 즉시 적용되도록 기본값으로 사용한다.
// 페이지 최대 너비(px). 넓은 화면에서 이 값까지 커진다(너무 크면 가로 스크롤이 생기지 않게 창 너비로 제한됨).
const FIT_MAX_W = 1200;
