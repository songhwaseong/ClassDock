"use strict";

const {
  decodeWorkspace, encodeWorkspace, escapeAttr, escapeHtml, fingerprintBytes, inlineMarkdown, indexWorkspacePathsByFolder,
  formatZipOpenSummary, inferPythonLocalImportRoots, inferPythonProjectRunContext, isExternalRef, markdownToHtml, pythonRelativePathLiterals, pythonRunScopeIncludesPath, resolveProjectRelativePath, resolveRuntimeOutputPath, resolveSiblingPath, safeArchivePath, safeLink, transformEditorLines, transformSelectedTextCase,
  windowsAbsolutePathLiterals, windowsAbsolutePathTouchesFolder,
  detectCsvDelimiter, detectTextEncoding, indexCsvRows, parseCsvRecord,
  pythonCompletionCandidates, pythonMemberCompletionCandidates, completionWordsForProfile, pythonImportCompletionCandidates, pythonWorkspaceImportCompletionCandidates, pythonWorkspaceModuleIndex, pythonWorkspaceImportRowsFromIndex, pythonWorkspaceModuleRowsFromIndex, pythonWorkspaceImportAnalysis, pythonWorkspaceImportProblems, pythonImportCheckTargets, pythonJediImportProblems, pythonImportContextAt, pythonCompletionInferenceSource, normalizeIdentifierSelection, pythonBracketContentSelection, findNextIdentifierOccurrence, identifierOccurrences,
  diffTextEdit, remapTextRangesAfterEdit, editorHistoryCaretState, applyLinkedIdentifierEdit, pythonLineOpensBlock, lightReindentPython, pythonOpenClosePlan, completionReplacementRange, completionInsertionPlan, completionApplicationPlan, closingBracketTabPlan,
  lineNumberAtOffset, lineStartOffset, findPythonLocalDefinition, resolvePythonImportedDefinition, parsePythonTracebackLocations, parsePythonTracebackLocation, classifyPythonStderr, pythonStderrDisplayKind, pythonStderrShouldBuffer,
  explainPythonError, contentMatchSnippet, suggestRegexPatterns, countRegexMatches,
  officeXmlDecodeText, officeXmlTextRuns, officeXmlParagraphLines, renderedTextMatchSegments,
  normalizeShortcut, shortcutFromEventLike, shortcutMatchesEvent, documentEdgeShortcutCommand, pythonOutputShortcutCommand, normalizePythonVariables,
  normalizeAssignmentTests, normalizeGradingOutput, normalizePythonDiagnostics, normalizePythonUnusedRanges, normalizePythonTraceReport,
  prettyPrintJsonText, jsonTreeNodeInfo, orderHwpxSections, workspaceFolderMarkerPath, workspaceFolderPathFromMarker, workspaceImageSkipMarkerPath, workspaceImageSkipFolderPath,
  workspaceOriginalSaveMarkerPath, workspaceOriginalSaveFolderPath,
  studyPaneSelectionAction, studyReadonlyPointerAllowed, studyReadonlyKeyAllowed, studySplitEndKeepId,
  splitDropRoleForSide, splitDropSideAtPoint, tabDropSplitAction, dataTransferHasFileItems, captureDroppedFileItems,
  INTERNAL_DRAG_MIME, isInternalDragTransfer, droppedTransferNeedsFolderPicker
} = PdfSignerCore;

/* ===== 다중 문서 상태 =====
 * docs: 열린 문서들. 각 문서는 자체 컨테이너(el)를 가지며 활성 문서만 보인다.
 *   공통: { id, name, kind:'pdf'|'office'|'image', el }
 *   pdf 추가: { pdfBytes, fileName, pages[], elements[], selected, addCount }
 * state = 활성 문서(아래 PDF 함수들이 그대로 활성 문서에 동작), viewer = 활성 문서 컨테이너 */
const docs = [];
// sourceKey → doc 인덱스: "이미 열린 파일" 중복 검사를 파일 수천 개 폴더에서도 O(1)로.
// makeDoc 에서 등록하고 closeDoc 에서 해제한다.
const docsBySourceKey = new Map();
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
// 사이드바 다중 선택(Ctrl/Shift 클릭) — 여러 파일을 한 번에 닫거나 지울 때 쓴다.
// 문서 줄만 담고(폴더 제외), 담긴 값은 nodeId. 선택 중에는 일반 클릭이 선택을 해제한다.
let sidebarSelection = new Set();
let sidebarSelectionAnchor = null;   // Shift 범위 선택의 기준 줄
let lastFocusedDocId = null;   // 마지막으로 들여다본 문서 id — 사이드바를 다시 열 때 그 파일명으로 커서를 옮긴다
try { sidebarCollapsed = localStorage.getItem("sidebarCollapsed") === "true"; } catch(e){}
let activeId = 0, docSeq = 0, navSeq = 0;
let state = null;        // 활성 문서
let viewer = null;       // 활성 문서 컨테이너(pdf 렌더/측정용)
let studyPdfId = null;   // 분할 작업의 참고 문서 ID (기존 변수명 호환 유지)
let studyReferenceLocked = false; // 분할 진입 시 참고 문서를 기본 잠금(읽기 전용)으로 켠다. 열쇠로 풀 수 있음.
let studyTargetPane = "work"; // 분할 화면에서 마지막에 클릭한 칸("work"|"reference") — 사이드바 파일 클릭이 이 칸의 문서를 바꾼다.
let lastSig = null;      // 최근 서명(문서 공통, 재사용)

let fileQueue = Promise.resolve();
// 자동 복원 직렬화는 브라우저와 로컬 서버에 복사본을 만들므로 보수적으로 제한한다.
// 원본 파일을 여는 크기에는 영향을 주지 않는다.
const WORKSPACE_CAP = 256 * 1024 * 1024;
const SHORTCUT_DEFINITIONS = Object.freeze([
  { id:"commandPalette", label:"명령 팔레트", description:"기능을 검색해 바로 실행하는 창 열기", defaultValue:"Ctrl+K" },
  { id:"openFiles", label:"파일 열기", description:"파일 선택 창 열기", defaultValue:"Ctrl+O" },
  { id:"openFolder", label:"폴더 열기", description:"폴더 전체 열기", defaultValue:"Ctrl+Shift+O" },
  { id:"saveCurrent", label:"현재 파일 저장", description:"PDF·Python·노트북·엑셀 편집 저장", defaultValue:"Ctrl+S" },
  { id:"closeCurrent", label:"현재 파일 닫기", description:"활성 탭 닫기", defaultValue:"Ctrl+W" },
  { id:"reopenClosed", label:"닫은 파일 다시 열기", description:"방금 닫은 탭 복원", defaultValue:"Ctrl+Shift+T" },
  { id:"focusSearch", label:"열린 파일 검색", description:"사이드바 검색창으로 이동", defaultValue:"Ctrl+Shift+F" },
  { id:"sidebarHide", label:"사이드바 숨기기", description:"왼쪽 파일 목록 접기", defaultValue:"Alt+ArrowLeft" },
  { id:"sidebarShow", label:"사이드바 보이기", description:"왼쪽 파일 목록 펼치기", defaultValue:"Alt+ArrowRight" },
  { id:"scratchpad", label:"임시 메모", description:"메모 열기·닫기", defaultValue:"Ctrl+M" },
  { id:"newPython", label:"새 Python 코드", description:"빈 Python 편집기 만들기", defaultValue:"Alt+N" },
  { id:"newBoard", label:"새 화이트보드", description:"설명하다 바로 판서할 빈 화이트보드 열기", defaultValue:"Alt+B" },
  { id:"previousFile", label:"이전 수업 파일", description:"이전 열린 탭으로 이동", defaultValue:"Ctrl+ArrowLeft" },
  { id:"nextFile", label:"다음 수업 파일", description:"다음 열린 탭으로 이동", defaultValue:"Ctrl+ArrowRight" },
  { id:"findInDocument", label:"문서 안에서 찾기", description:"PDF·노트북·편집기 찾기·바꾸기", defaultValue:"Ctrl+F" },
  { id:"findInCell", label:"현재 셀에서 찾기", description:"노트북 현재 셀 안에서 찾기·바꾸기", defaultValue:"Ctrl+Shift+H" },
  { id:"goToLine", label:"줄 번호로 이동", description:"코드·텍스트 편집기에서 원하는 줄로 바로 가기", defaultValue:"Ctrl+G" },
  { id:"runCode", label:"Python 코드 실행", description:"현재 Python 코드 실행 (노트북: 이 셀만)", defaultValue:"Ctrl+Enter" },
  { id:"runCellAdvance", label:"셀 실행 후 다음 셀", description:"노트북·셀 코드에서 실행 후 다음 셀로", defaultValue:"Shift+Enter" },
  { id:"runNotebook", label:"노트북 전체 실행", description:"현재 노트북의 모든 코드 셀 실행", defaultValue:"Ctrl+Shift+Enter" },
  { id:"formatDocument", label:"코드 자동 정렬", description:"Python 코드 들여쓰기·공백 정렬(로컬 파이썬이면 black)", defaultValue:"Shift+Alt+F" },
  { id:"screensaverStart", label:"대기 화면 지금 시작", description:"모니터 전체 화면으로 대기 화면 켜기", defaultValue:"Ctrl+F12" }
]);
const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(SHORTCUT_DEFINITIONS.map((item) => [item.id, item.defaultValue])));
// 설정에서 노출/숨김을 고를 수 있는 도구막대 버튼들. 이 배열 하나가 설정 체크박스 목록과
// CSS 숨김 클래스를 모두 구동한다(라벨·목록 이중 관리 방지). cls 는 각 버튼의 고유 클래스명.
// ▶ 실행·저장처럼 없으면 안 되는 버튼은 일부러 뺐다. 기본값은 전부 노출(defaultVisible).
const TOGGLEABLE_TOOLS = Object.freeze([
  // 헤더 위쪽 막대 (manneung-classroom.html) — 문서와 무관하게 늘 떠 있는 전역 버튼들.
  // ⚙ 설정·저장·집중(⏱)·분할 작업은 뺐다. 설정은 숨기면 되돌릴 길이 막히고, 저장은 필수,
  // 집중은 이미 '펫 집중 모드' 설정이 켜고 끄며, 분할 작업 버튼은 원래 CSS 로 숨겨둔 상태다.
  { id:"hdrSidebar",    label:"사이드 메뉴 접기·펼치기",       cls:"hdr-tool-sidebar",    target:"header" },
  { id:"hdrPdfEdit",    label:"PDF 편집 메뉴(서명·텍스트·필기)",cls:"hdr-tool-pdfedit",    target:"header" },
  { id:"hdrPdfPage",    label:"PDF 페이지 메뉴(목차·썸네일·합치기)",cls:"hdr-tool-pdfpage",target:"header" },
  { id:"hdrMemo",       label:"메모",                          cls:"hdr-tool-memo",       target:"header" },
  { id:"hdrFullscreen", label:"문서 전체화면",                 cls:"hdr-tool-fullscreen", target:"header" },
  { id:"hdrPrint",      label:"인쇄 / PDF로 저장",             cls:"hdr-tool-print",      target:"header" },
  { id:"hdrPalette",    label:"기능 검색(Ctrl+K)",             cls:"hdr-tool-palette",    target:"header" },
  { id:"hdrSaveFolder", label:"더보기 — 저장 폴더 열기",       cls:"hdr-tool-savefolder", target:"header" },
  { id:"hdrImageMemo",  label:"더보기 — 이미지 메모",          cls:"hdr-tool-imagememo",  target:"header" },
  { id:"hdrLang",       label:"EN(영어로 전환)",               cls:"hdr-tool-lang",       target:"header" },
  { id:"hdrHelp",       label:"도움말·단축키(?)",              cls:"hdr-tool-help",       target:"header" },
  { id:"hdrTheme",      label:"다크 모드 전환",                cls:"hdr-tool-theme",      target:"header" },
  // Python 실행 바 (code-viewer.js)
  { id:"pyTrace",     label:"단계 실행",       cls:"run-trace",           target:"py" },
  { id:"pyAnalyze",   label:"진단",            cls:"run-analyze",         target:"py" },
  { id:"pyGrade",     label:"채점",            cls:"run-grade",           target:"py" },
  { id:"pyLink",      label:"PDF에 핀",        cls:"run-link",            target:"py" },
  { id:"pyNbConvert", label:"노트북으로 변환", cls:"run-nbconvert-group", target:"py" },
  { id:"pyInk",       label:"필기",            cls:"run-ink",             target:"py" },
  { id:"pyRec",       label:"녹화",            cls:"run-rec",             target:"py" },
  { id:"pyPkg",       label:"Python 라이브러리",cls:"run-py-pkg",          target:"py" },
  { id:"jsPkg",       label:"JavaScript 라이브러리",cls:"run-js-library",   target:"py" },
  { id:"pyEnv",       label:"Py Env(실행 환경)",cls:"run-diag",           target:"py" },
  { id:"pyNewPy",     label:"+Py(새 파이썬)",  cls:"run-newpy",           target:"py" },
  { id:"pyRevert",    label:"원본 되돌리기",   cls:"run-py-revert",       target:"py" },
  { id:"pyDedupe",    label:"중복 줄 삭제",     cls:"run-dedupe",          target:"py" },
  { id:"pyPractice",  label:"따라치기(타자 연습)",cls:"run-practice-group", target:"py" },
  { id:"pySpellcheck",label:"맞춤법",          cls:"run-spellcheck",      target:"py" },
  { id:"pyFont",      label:"글자 크기(A− A+)",cls:"run-font-group",      target:"py" },
  // 노트북 도구막대 (notebook-run.js)
  { id:"nbInk",       label:"필기",            cls:"nbv-ink-toggle",      target:"notebook" },
  { id:"nbToc",       label:"목차",            cls:"nbv-toc-open",        target:"notebook" },
  { id:"nbFind",      label:"전체 찾기",       cls:"nbv-find-open",       target:"notebook" },
  { id:"nbDedupe",    label:"중복 줄 삭제",     cls:"nbv-dedupe",          target:"notebook" },
  { id:"nbFont",      label:"글자 크기(A− A+)",cls:"nbv-font-group",      target:"notebook" },
  { id:"nbExport",    label:"내보내기(.py/PDF)",cls:"nbv-export-group",   target:"notebook" },
  { id:"nbHelp",      label:"단축키",          cls:"nbv-help-open",       target:"notebook" },
  // 이미지 편집기 도구막대 (image-viewer.js) — 저장(run-save)·되돌리기/다시는 필수라 뺐다.
  { id:"imgRotate",   label:"회전(↶ ↷)",       cls:"img-tool-rotate",     target:"image" },
  { id:"imgFlip",     label:"뒤집기(좌우·상하)",cls:"img-tool-flip",       target:"image" },
  { id:"imgCrop",     label:"자르기(비율 포함)",cls:"img-tool-crop",       target:"image" },
  { id:"imgAltFormat",label:"다른 형식으로 저장(PNG/JPG)",cls:"img-tool-altfmt", target:"image" },
  { id:"imgPdf",      label:"PDF로 저장",      cls:"img-tool-pdf",        target:"image" },
  { id:"imgMemo",     label:"메모로 보내기",   cls:"img-tool-memo",       target:"image" },
  { id:"imgOcr",      label:"글자 추출(OCR)",  cls:"img-tool-ocr",        target:"image" },
  { id:"imgZoom",     label:"확대·축소(− + 맞춤)",cls:"img-tool-zoom",    target:"image" },
  { id:"imgDims",     label:"이미지 크기 표시",cls:"img-tool-dims",       target:"image" },
  { id:"imgReset",    label:"초기화",          cls:"img-tool-reset",      target:"image" },
  { id:"imgAnnotate", label:"표시(펜·화살표·모자이크)",cls:"img-tool-ann",target:"image" },
  { id:"imgAdjust",   label:"화질 보정·크기 조절",cls:"img-tool-adjust",  target:"image" }
]);
// { id: boolean } 로 정규화. 레지스트리에 있는 id만 남기고, 지정 안 된 것·잘못된 값은 노출(true).
function normalizeToolVisibility(value){
  const s = value && typeof value === "object" ? value : {};
  const out = {};
  for (const tool of TOGGLEABLE_TOOLS) out[tool.id] = s[tool.id] !== false;
  return out;
}
// 숨김으로 설정된 도구만 <html>.hide-tool-<id> 클래스를 붙인다(CSS 가 display:none 처리).
// 클래스만 토글하므로 이미 열려 있는 문서·툴바에도 재렌더 없이 즉시 반영된다.
function applyToolVisibility(){
  if (typeof document === "undefined") return;
  const vis = normalizeToolVisibility(appSettings && appSettings.toolVisibility);
  const root = document.documentElement;
  for (const tool of TOGGLEABLE_TOOLS) root.classList.toggle("hide-tool-" + tool.id, vis[tool.id] === false);
  // 이미 열려 있는 편집기가 '숨겨진 도구의 모드'(이미지 자르기·표시처럼 켜 둔 상태)를 스스로 끌 수 있게 알린다.
  try { document.dispatchEvent(new CustomEvent("mn-tool-visibility", { detail: vis })); } catch(e){}
}
// ── 코드 색(구문 강조) ──────────────────────────────────────────────
// .tk-* 클래스는 색을 직접 갖지 않고 CSS 변수만 참조한다. 사용자 지정값은 --python-code-* 로
// 따로 얹고 .code-color-target 에서만 참조해 파이썬 편집기·노트북 셀·스크래치패드에만 적용한다.
// 라이트·다크는 배경이 정반대라 한 벌로는 쓸 수 없어 테마별로 따로 보관한다.
// label/labelEn 을 함께 들고 있는 이유: "기본"·"주석"처럼 짧은 낱말을 i18n 사전에 넣으면
// 화면 곳곳의 같은 글자까지 함께 번역돼 엉뚱한 곳이 바뀐다(사전은 텍스트 완전 일치로 동작).
const CODE_COLOR_DEFS = Object.freeze([
  { id:"keyword",   varName:"--code-keyword",   userVarName:"--python-code-keyword",   label:"키워드",     labelEn:"Keywords",             hint:"if · for · def · class" },
  { id:"string",    varName:"--code-string",    userVarName:"--python-code-string",    label:"문자열",     labelEn:"Strings",              hint:'"글자" · f"…"' },
  { id:"number",    varName:"--code-number",    userVarName:"--python-code-number",    label:"숫자",       labelEn:"Numbers",              hint:"0 · 3.14" },
  { id:"comment",   varName:"--code-comment",   userVarName:"--python-code-comment",   label:"주석",       labelEn:"Comments",             hint:"# 설명" },
  { id:"function",  varName:"--code-function",  userVarName:"--python-code-function",  label:"함수 이름",  labelEn:"Function names",       hint:"def" },
  { id:"builtin",   varName:"--code-builtin",   userVarName:"--python-code-builtin",   label:"내장 함수",  labelEn:"Built-in functions",   hint:"print · len · range" },
  { id:"type",      varName:"--code-type",      userVarName:"--python-code-type",      label:"내장 예외",  labelEn:"Built-in exceptions",  hint:"ValueError · TypeError" },
  { id:"decorator", varName:"--code-decorator", userVarName:"--python-code-decorator", label:"데코레이터", labelEn:"Decorators",           hint:"@staticmethod" },
  { id:"param",     varName:"--code-param",     userVarName:"--python-code-param",     label:"매개변수",   labelEn:"Parameters",           hint:"def f(x)" }
]);
// styles.css 의 :root / [data-theme="dark"] 값과 반드시 같아야 한다 — 색 고르개의 초기값이자
// '기본색으로 되돌리기'의 기준이고, 이 값과 같으면 저장하지 않고 CSS 에 맡긴다.
const CODE_COLOR_DEFAULTS = Object.freeze({
  light: Object.freeze({ keyword:"#1d4ed8", string:"#047857", number:"#b91c1c", comment:"#64748b",
    function:"#0f766e", builtin:"#795e26", type:"#a21caf", decorator:"#a16207", param:"#7c3aed" }),
  dark: Object.freeze({ keyword:"#93c5fd", string:"#86efac", number:"#fca5a5", comment:"#64748b",
    function:"#67e8f9", builtin:"#dcdcaa", type:"#f0abfc", decorator:"#facc15", param:"#c084fc" })
});
// 배경색(--code-bg)과의 대비를 계산해 "글자가 안 보이는" 선택을 경고하는 데 쓴다.
const CODE_COLOR_BACKGROUNDS = Object.freeze({ light:"#f8fafc", dark:"#0f172a" });
// 프리셋 — 아무 색이나 고르다 배경과 같아지는 사고를 막기 위해 검증된 조합을 먼저 제공한다.
// 각 프리셋은 라이트·다크를 모두 정의한다(한쪽만 바꾸면 테마를 옮겼을 때 색이 깨져 보인다).
const CODE_COLOR_PRESETS = Object.freeze([
  { id:"default", label:"기본", labelEn:"Default", colors:null },   // null = 저장된 값 없이 CSS 기본색 사용
  { id:"monokai", label:"모노카이", labelEn:"Monokai", colors:Object.freeze({
    light:{ keyword:"#c2185b", string:"#7a8b1a", number:"#7c4dff", comment:"#8a8f98",
      function:"#0f7d7d", builtin:"#0277bd", type:"#c2185b", decorator:"#b26a00", param:"#9c27b0" },
    dark:{ keyword:"#f92672", string:"#e6db74", number:"#ae81ff", comment:"#88846f",
      function:"#a6e22e", builtin:"#66d9ef", type:"#f92672", decorator:"#fd971f", param:"#fd971f" }
  })},
  { id:"solarized", label:"솔라라이즈", labelEn:"Solarized", colors:Object.freeze({
    light:{ keyword:"#859900", string:"#2aa198", number:"#d33682", comment:"#93a1a1",
      function:"#268bd2", builtin:"#b58900", type:"#cb4b16", decorator:"#6c71c4", param:"#6c71c4" },
    dark:{ keyword:"#859900", string:"#2aa198", number:"#d33682", comment:"#657b83",
      function:"#268bd2", builtin:"#b58900", type:"#cb4b16", decorator:"#6c71c4", param:"#6c71c4" }
  })},
  { id:"contrast", label:"고대비", labelEn:"High contrast", colors:Object.freeze({
    light:{ keyword:"#0000cc", string:"#006600", number:"#aa0000", comment:"#555555",
      function:"#004d80", builtin:"#804000", type:"#800080", decorator:"#804000", param:"#5c0099" },
    dark:{ keyword:"#7dc4ff", string:"#7dffb0", number:"#ff9d9d", comment:"#a0aec0",
      function:"#8ff0ff", builtin:"#ffe066", type:"#ffb3ff", decorator:"#ffcc66", param:"#d9a6ff" }
  })}
]);
// #rgb·#rrggbb 만 받아 소문자 #rrggbb 로 통일한다(색 고르개 value 와 CSS 변수에 그대로 쓰기 위해).
function normalizeHexColor(value){
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) return "#" + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3];
  return "";
}
// 기본색과 같은 항목은 아예 저장하지 않는다 — 나중에 기본 팔레트를 손봐도 사용자가 직접 고르지 않은
// 색은 새 기본값을 따라가고, CSS 의 테마 규칙도 그대로 살아 있게 된다.
function normalizeCodeColors(value){
  const src = value && typeof value === "object" ? value : {};
  const out = {};
  for (const theme of ["light", "dark"]){
    const saved = src[theme] && typeof src[theme] === "object" ? src[theme] : {};
    const picked = {};
    for (const def of CODE_COLOR_DEFS){
      const hex = normalizeHexColor(saved[def.id]);
      if (hex && hex !== CODE_COLOR_DEFAULTS[theme][def.id]) picked[def.id] = hex;
    }
    out[theme] = picked;
  }
  return out;
}
function currentThemeName(){
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
// 저장값이 없으면 기본색(= styles.css 가 칠하는 색)을 돌려준다.
function codeColorValue(theme, id, source){
  const set = ((source || (appSettings && appSettings.codeColors) || {})[theme]) || {};
  return normalizeHexColor(set[id]) || CODE_COLOR_DEFAULTS[theme][id] || "";
}
// 지금 테마의 사용자 색만 <html>의 --python-code-* 인라인 변수로 얹는다. 실제 토큰 규칙은
// .code-color-target 에서만 이 변수를 읽으므로 JSON·다른 언어 코드에는 번지지 않는다.
// 기본값인 항목은 반드시 removeProperty 로 걷어내야 테마를 바꿨을 때 반대편 색이 살아난다.
// 그래서 테마 토글 직후에도 이 함수를 다시 부른다(app.js 테마 버튼).
function applyCodeColors(){
  if (typeof document === "undefined") return;
  const theme = currentThemeName(), style = document.documentElement.style;
  const set = ((appSettings && appSettings.codeColors) || {})[theme] || {};
  for (const def of CODE_COLOR_DEFS){
    const hex = normalizeHexColor(set[def.id]);
    // 이전 개발 버전이 전역 --code-* 인라인 값을 남긴 채 이 함수를 다시 호출해도 즉시 범위를 복구한다.
    style.removeProperty(def.varName);
    if (hex && hex !== CODE_COLOR_DEFAULTS[theme][def.id]) style.setProperty(def.userVarName, hex);
    else style.removeProperty(def.userVarName);
  }
}
// WCAG 상대 휘도 기반 대비비(1~21). 배경과 너무 비슷한 색을 고르면 설정 화면에서 경고하는 용도.
function colorContrastRatio(a, b){
  const lum = (hex) => {
    const h = normalizeHexColor(hex); if (!h) return 0;
    const ch = [1, 3, 5].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
// ── 화이트보드 배경색 ───────────────────────────────────────────────
// 배경색은 보드마다 스냅샷(bg)에 따로 저장된다. 아래 설정값은 "새 보드를 열 때 쓸 기본색"일 뿐이라,
// 설정을 바꿔도 이미 그려 둔 보드의 배경은 건드리지 않는다(칠판 한 장, 흰 종이 한 장을 같이 쓰는 경우).
const BOARD_BG_DEFAULT = "#ffffff";
const BOARD_BG_PRESETS = Object.freeze([
  { id:"white",  color:"#ffffff", label:"흰색",      labelEn:"White" },
  { id:"paper",  color:"#f1f5f9", label:"연회색",    labelEn:"Light gray" },
  { id:"cream",  color:"#fdf6e3", label:"크림",      labelEn:"Cream" },
  { id:"chalk",  color:"#0f5132", label:"칠판 초록", labelEn:"Chalkboard green" },
  { id:"night",  color:"#111827", label:"검정",      labelEn:"Black" }
]);
function normalizeBoardBg(value){ return normalizeHexColor(value) || BOARD_BG_DEFAULT; }
// 어두운 배경으로 바꾸면 검정 펜은 그은 자리가 보이지 않는다. 대비가 너무 낮을 때 바꿔 줄 펜 색을
// 돌려준다(지금 색으로 충분하면 ""). 기준 2.2 는 코드 색 설정의 대비 경고와 같은 값이다.
function boardInkForBackground(bg, ink){
  const background = normalizeBoardBg(bg), current = normalizeHexColor(ink) || "#111111";
  if (colorContrastRatio(current, background) >= 2.2) return "";
  const best = colorContrastRatio("#ffffff", background) >= colorContrastRatio("#111111", background) ? "#ffffff" : "#111111";
  return best === current ? "" : best;
}

const DEFAULT_APP_SETTINGS = {
  // autoSave: 편집한 파일을 입력이 멈춘 뒤 원본에 자동으로 되쓴다(Python·텍스트·마크다운 공통).
  //   예전 이름은 pythonAutosave 였고 Python 에만 적용됐다 — 아래 migrateAppSettings 가 값을 옮긴다.
  // pdfRecovery: 파일에 쓰지 않고 브라우저 안에 복구본만 남긴다(꺼짐 대비 안전망) — 성격이 달라 따로 둔다.
  // searchHistory: 찾기·검색창에 지난 검색어를 기억해 보여준다(MNSearchHistory).
  //   공용 컴퓨터에서는 앞사람 검색어가 보일 수 있어 끌 수 있게 두었다.
  // autoOpenFirstFile: 폴더·압축을 열 때 안에 있던 첫 파일을 바로 띄울지. 꺼 두면 사이드바만 펼쳐지고
  //   본문에는 "파일을 고르세요" 안내가 뜬다 — 원치 않는 파일이 열리며 화면이 튀는 걸 막는다.
  // officeReplaceAttached: 오피스 찾아 바꾸기가 본문 밖(Word 머리말·꼬리말·각주, PPT 발표자 노트)까지
  //   건드릴지. 기본은 본문만 — 머리말·노트는 본문 화면에서 안 보이는 곳이라, 켜진 줄 모르고 바꾸면
  //   바뀐 사실조차 볼 수 없다. 꺼 두어도 "머리말 3곳은 안 바꿨어요" 로 개수를 알려 준다.
  // officeReplaceTracked: 변경 내용 추적이 켜진 문서도 바꿀지. 기본은 건너뛴다 —
  //   이 프로그램이 바꾼 내용은 Word 의 변경 이력에 남지 않아, 검토 중인 문서라면 이력을 믿을 수 없게 된다.
  uiScale: 1, pdfZoom: 1.25, performance: "memory", autoRestore: true, pdfRecovery: true, autoSave: false, pyFormatOnSave: true,
  searchHistory: true, autoOpenFirstFile: false, officeReplaceAttached: false, officeReplaceTracked: false,
  screensaver: { enabled: false, idleMin: 5, sound: false, mode: "video", url: "" },
  petEnabled: false, petCount: 1,   // 픽셀 펫(돌아다니는 동물) — 옵션에서 켤 때만·마릿수
  petFocus: { enabled: true, focusMin: 25, breakMin: 5, quietTyping: true },
  toolVisibility: {},   // 도구막대 버튼 노출/숨김({} = 전부 노출) — TOGGLEABLE_TOOLS 참고
  boardBg: BOARD_BG_DEFAULT,   // 새 화이트보드의 기본 배경색 — BOARD_BG_PRESETS 참고(보드별 색은 스냅샷에 따로 저장)
  codeColors: {},       // 구문 강조 색({} = 기본 팔레트) — { light:{…}, dark:{…} }, CODE_COLOR_DEFS 참고
  mouseSideButtons: true,   // 마우스 4·5번(뒤로/앞으로) 버튼으로 이전/다음 탭 이동
  shortcutDefaultsVersion: 2,
  shortcuts: DEFAULT_SHORTCUTS
};
// 대기 화면 웹 주소 정규화 — 실제로 화면에 띄우는 주소라 http/https 만 통과시킨다.
// javascript:·data: 같은 스킴은 오버레이 안에서 코드를 실행시킬 수 있어 여기서 잘라낸다.
// 스킴을 안 적었으면(earth.nullschool.net/ko/) https 를 붙여 준다 — 교사가 주소를 복사해 넣는 자리라서.
const SS_BLOCKED_SCHEME = /^\s*(javascript|data|vbscript|file|blob|about|chrome|chrome-extension|view-source)\s*:/i;
function normalizeScreensaverUrl(value){
  const raw = String(value == null ? "" : value).trim();
  if (!raw || SS_BLOCKED_SCHEME.test(raw)) return "";
  const hasScheme = /^https?:\/\//i.test(raw);
  if (!hasScheme){
    // 스킴을 붙여 주기 전에 주소처럼 생겼는지 본다 — 'abc' 같은 오타까지 https://abc 로 만들면
    // 저장은 되는데 대기 화면에서만 안 열려 원인을 찾기 어렵다.
    const host = raw.split(/[/?#]/)[0];
    if (!host.includes(".") && !/^localhost(:\d+)?$/i.test(host)) return "";
  }
  const candidate = hasScheme ? raw : "https://" + raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return url.href;
  } catch(_){ return ""; }
}
// ----- 유튜브 주소 → 퍼가기(embed) 주소 -----
// 유튜브 메인·watch 주소는 다른 화면 안에 넣는 것이 막혀 있어 대기 화면에 그대로 쓸 수 없다.
// /embed/ 주소로 바꿔야 하는데, 손으로 만들면 두 가지를 빠뜨리기 쉽다 —
//   · loop=1 만으로는 한 번 재생하고 멈춘다. 자기 자신을 playlist 로 지정해야 반복된다.
//   · mute=1 이 없으면 브라우저 자동재생 정책에 막혀 아예 시작되지 않는다.
// 이 두 가지를 대신 챙겨 주는 것이 이 변환의 목적이다.
const YT_HOSTS = ["youtube.com", "youtube-nocookie.com", "youtu.be"];
// 시작 시간(t) — "90", "90s", "1m30s", "1h2m3s" 를 초로 바꾼다. 못 읽으면 0(시작 시간 없음).
function youtubeStartSeconds(value){
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}
// 바꿀 것이 없으면 null(유튜브가 아니거나 이미 필요한 값이 다 붙은 퍼가기 주소). 바꿨으면 { url, notes } —
// notes 는 무엇을 왜 바꿨는지 사용자에게 그대로 보여 주는 문장이다(조용히 바꿔치기하지 않는다).
function youtubeEmbedUrl(value){
  const base = normalizeScreensaverUrl(value);
  if (!base) return null;
  let u;
  try { u = new URL(base); } catch(_){ return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  if (YT_HOSTS.indexOf(host) < 0) return null;
  const seg = u.pathname.split("/").filter(Boolean);
  const notes = [];
  const captionNote = "자막은 기본적으로 꺼지도록 cc_load_policy=0 을 붙였어요(유튜브 설정에 따라 다시 보일 수 있습니다).";
  if (seg[0] === "embed"){
    if (u.searchParams.get("cc_load_policy") === "0") return null;
    u.searchParams.set("cc_load_policy", "0");
    notes.push(captionNote);
    return { url:u.href, notes };                                // 기존 퍼가기 옵션은 그대로 두고 자막 기본값만 보완
  }
  let id = "", list = "";
  if (host === "youtu.be") id = seg[0] || "";                   // youtu.be/ID
  else if (seg[0] === "watch") id = u.searchParams.get("v") || "";
  else if (seg[0] === "shorts" || seg[0] === "live" || seg[0] === "v") id = seg[1] || "";
  else if (seg[0] === "playlist") list = u.searchParams.get("list") || "";
  if (seg[0] === "watch" || host === "youtu.be") list = u.searchParams.get("list") || list;
  if (!/^[\w-]{11}$/.test(id)) id = "";                          // 영상 ID 는 11자
  if (!/^[\w-]{2,}$/.test(list)) list = "";
  if (!id && !list) return null;                                 // 채널·검색 주소 등 — 틀 영상이 없다
  const origin = host === "youtube-nocookie.com" ? "https://www.youtube-nocookie.com" : "https://www.youtube.com";
  const params = new URLSearchParams();
  let path;
  if (id){
    path = "/embed/" + id;
    params.set("autoplay", "1"); params.set("mute", "1");
    params.set("loop", "1"); params.set("playlist", id);
    notes.push("한 영상을 계속 반복하도록 loop 와 playlist 를 함께 붙였어요(유튜브는 이 둘이 짝이어야 반복됩니다).");
    if (list) notes.push("주소에 있던 재생목록(list)은 뺐어요 — 목록 전체를 틀려면 재생목록 주소를 넣어 주세요.");
  } else {
    path = "/embed/videoseries";
    params.set("list", list);
    params.set("autoplay", "1"); params.set("mute", "1"); params.set("loop", "1");
    notes.push("재생목록을 처음부터 끝까지 반복하도록 만들었어요.");
  }
  params.set("cc_load_policy", "0");
  notes.push(captionNote);
  const start = youtubeStartSeconds(u.searchParams.get("t") || u.searchParams.get("start"));
  if (start){ params.set("start", String(start)); notes.push("시작 시간 " + start + "초를 함께 옮겼어요."); }
  notes.push("소리가 꺼져 있을 때만 자동재생이 시작돼서 mute 도 켰어요.");
  return { url: origin + path + "?" + params.toString(), notes };
}
// 화면보호기 설정 정규화(옵션에서 켤 때만 동작·유효한 대기 시간만 허용). sound 는 '지금 시작' 수동 재생 전용.
// mode: "video"(영상·기본 애니메이션) | "web"(웹 주소) — 주소가 비면 web 이어도 영상·애니메이션으로 돌아간다.
function normalizeScreensaver(value){
  const s = value && typeof value === "object" ? value : {};
  const idle = Number(s.idleMin);
  const url = normalizeScreensaverUrl(s.url);
  return { enabled: !!s.enabled, idleMin: [1, 3, 5, 10, 20].includes(idle) ? idle : 5, sound: !!s.sound,
    mode: s.mode === "web" ? "web" : "video", url };
}
function normalizePetFocus(value){
  const s = value && typeof value === "object" ? value : {};
  const focusMin = Math.round(Number(s.focusMin)), breakMin = Math.round(Number(s.breakMin));
  return {
    enabled: s.enabled !== false,
    focusMin: Number.isFinite(focusMin) ? Math.min(180, Math.max(1, focusMin)) : 25,
    breakMin: Number.isFinite(breakMin) ? Math.min(60, Math.max(1, breakMin)) : 5,
    quietTyping: s.quietTyping !== false
  };
}
function normalizeShortcutMap(value){
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(SHORTCUT_DEFINITIONS.map((item) => [
    item.id, normalizeShortcut(source[item.id]) || item.defaultValue
  ]));
}
// 예전 설정 이름·기본 단축키를 새 값으로 옮긴다.
// 사용자가 단축키를 하나라도 직접 바꿨다면 그 선택을 우선하고, 정확히 예전 기본 조합일 때만 자동 이전한다.
function migrateAppSettings(saved){
  const next = { ...(saved || {}) };
  if (next.autoSave === undefined && next.pythonAutosave !== undefined) next.autoSave = !!next.pythonAutosave;
  delete next.pythonAutosave;
  if ((Number(next.shortcutDefaultsVersion) || 0) < 2){
    const shortcuts = next.shortcuts && typeof next.shortcuts === "object" ? { ...next.shortcuts } : {};
    const compact = (value) => String(value || "").replace(/\s+/g, "").toLowerCase();
    const usesLegacyDefaults =
      (!shortcuts.focusSearch || compact(shortcuts.focusSearch) === "ctrl+f") &&
      (!shortcuts.findInDocument || compact(shortcuts.findInDocument) === "ctrl+h");
    if (usesLegacyDefaults){
      shortcuts.focusSearch = "Ctrl+Shift+F";
      shortcuts.findInDocument = "Ctrl+F";
      next.shortcuts = shortcuts;
      next._shortcutDefaultsMigrated = true;
    }
    next.shortcutDefaultsVersion = 2;
  }
  return next;
}
let shortcutDefaultsMigrated = false;
let appSettings = (() => {
  try {
    const raw = localStorage.getItem("pdfSignerSettings");
    if (!raw) return { ...DEFAULT_APP_SETTINGS, screensaver:normalizeScreensaver(), petFocus:normalizePetFocus(), toolVisibility:normalizeToolVisibility(), codeColors:normalizeCodeColors(), shortcuts:normalizeShortcutMap() };
    const decoded = JSON.parse(raw);
    const parsed = decoded && typeof decoded === "object" ? decoded : {};
    const migrationChanged = "pythonAutosave" in parsed || (Number(parsed.shortcutDefaultsVersion) || 0) < 2;
    const saved = migrateAppSettings(parsed);
    shortcutDefaultsMigrated = saved._shortcutDefaultsMigrated === true;
    delete saved._shortcutDefaultsMigrated;
    const loaded = { ...DEFAULT_APP_SETTINGS, ...saved, screensaver:normalizeScreensaver(saved.screensaver), petFocus:normalizePetFocus(saved.petFocus), toolVisibility:normalizeToolVisibility(saved.toolVisibility), codeColors:normalizeCodeColors(saved.codeColors), boardBg:normalizeBoardBg(saved.boardBg), shortcuts:normalizeShortcutMap(saved.shortcuts) };
    if (migrationChanged) localStorage.setItem("pdfSignerSettings", JSON.stringify(loaded));
    return loaded;
  }
  catch(e){ return { ...DEFAULT_APP_SETTINGS, screensaver:normalizeScreensaver(), petFocus:normalizePetFocus(), toolVisibility:normalizeToolVisibility(), codeColors:normalizeCodeColors(), shortcuts:normalizeShortcutMap() }; }
})();
function saveAppSettings(next){
  const merged = { ...appSettings, ...next };
  appSettings = { ...DEFAULT_APP_SETTINGS, ...merged, screensaver:normalizeScreensaver(merged.screensaver), petFocus:normalizePetFocus(merged.petFocus), toolVisibility:normalizeToolVisibility(merged.toolVisibility), codeColors:normalizeCodeColors(merged.codeColors), boardBg:normalizeBoardBg(merged.boardBg), shortcuts:normalizeShortcutMap(merged.shortcuts) };
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
  // 기본값으로 쓰는 조합(Ctrl+Shift+T·Shift+Enter·Alt+←/→ 등)은 앱이 이미 처리하므로 언제든 다시 선택할 수 있다.
  if (Object.values(DEFAULT_SHORTCUTS).some((v) => normalizeShortcut(v) === normalized)) return "";
  const hasMainModifier = /^(?:Ctrl|Meta|Alt)\+/.test(normalized);
  if (!hasMainModifier) return "Ctrl, Alt 또는 Win 키를 함께 눌러 주세요.";
  const unavailable = new Set([
    "Ctrl+C","Ctrl+X","Ctrl+V","Ctrl+A","Ctrl+Z","Ctrl+Shift+Z","Ctrl+Y",
    "Ctrl+D","Ctrl+Space","Ctrl+/","Ctrl+=","Ctrl+Shift+=","Ctrl+-","Ctrl+0","Ctrl+Home","Ctrl+End",
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
    const rawTitle = el.dataset.shortcutTitle;
    const title = rawTitle && (typeof window.t === "function") ? window.t(rawTitle) : rawTitle;
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
applyToolVisibility();
applyCodeColors();
function defaultPdfZoom(){ const z = Number(appSettings.pdfZoom); return [1,1.25,1.5].includes(z) ? z : 1.25; }
// 폴더·압축을 열 때 안의 첫 파일을 자동으로 띄울지(기본 끔).
function autoOpenFirstFileEnabled(){ return appSettings.autoOpenFirstFile === true; }
// PDF 렌더 프로필. renderScale 은 미리 그리는 페이지와 화면에 보이는 페이지가 반드시 같아야 한다.
// 둘이 다르면 미리 그려둔 캔버스를 못 쓰고 페이지가 화면에 들어오는 순간 처음부터 다시 그려서,
// 프리페치가 지연을 전혀 줄여주지 못한다(오히려 버려질 렌더로 CPU 만 쓴다).
// maxConcurrent: 동시에 그리는 페이지 수. pdf.js 는 캔버스 래스터화를 메인 스레드에서 하므로
// 제한이 없으면 스크롤로 지나친 페이지들이 정작 사용자가 멈춘 페이지를 밀어낸다.
function pdfRenderProfile(){
  return appSettings.performance === "quality"
    ? { renderScale: 3, maxSide: 6000, rootMargin: "300% 0px", maxConcurrent: 3 }
    : { renderScale: 2, maxSide: 5000, rootMargin: "200% 0px", maxConcurrent: 2 };
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
      count.textContent = window.tf("{n}개 일치", { n: countRegexMatches(countText, item.pattern).toLocaleString() });
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
  msg = (typeof window.t === "function") ? window.t(String(msg)) : String(msg);
  const hasAction = !!(opts.action && opts.action.label);
  const petHandled = typeof petNotify === "function" && petNotify(msg, ms, opts);
  // 펫 한 마리가 일반 알림을 대신 말한 경우, 화면 토스트는 숨기되 aria-live 안내는 유지한다.
  // 행동 버튼이 있는 알림은 펫도 말하고 실제 버튼이 든 토스트도 그대로 보여 준다.
  if (petHandled && !hasAction){
    for (const old of [...area.children]) if (old.dataset.msg === msg) old.remove();
    while (area.children.length >= 3) area.firstChild.remove();
    const live = document.createElement("span");
    live.className = "toast-announcement";
    live.dataset.msg = msg;
    live.textContent = msg;
    area.appendChild(live);
    setTimeout(() => live.remove(), Math.max(1000, ms));
    return live;
  }
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
  if (hasAction){
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
/* 화면에서 지금 선택돼 있는 글자를 검색어 시드로 돌려준다(한 줄·200자 이내, 없으면 "").
   편집기(textarea·글자 입력란) 안의 선택이 우선이고, 다음이 문서 본문의 마우스 선택.
   container 를 주면 그 요소 안에서 이뤄진 선택만 인정한다(예: 특정 PDF 화면). */
function currentSelectionSeed(container){
  try {
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search)$/.test(el.type))) &&
        typeof el.selectionStart === "number" && (!container || container.contains(el))){
      const sel = String(el.value || "").slice(el.selectionStart, el.selectionEnd).trim();
      if (sel && !sel.includes("\n") && sel.length <= 200) return sel;
    }
    const s = window.getSelection && window.getSelection();
    if (s && !s.isCollapsed && s.rangeCount &&
        (!container || (container.contains(s.anchorNode) && container.contains(s.focusNode)))){
      const t = String(s).replace(/\s+/g, " ").trim();
      if (t && t.length <= 200) return t;
    }
  } catch(_){}
  return "";
}
function showLoading(msg){ const _t = (typeof window.t === "function") ? window.t : (x)=>x; byId("loadingMsg").textContent = _t(msg||"처리 중…"); byId("loading").hidden = false; }
function hideLoading(){
  // 작업공간 배치 복원 중 내부 로더가 완료돼도 전체 복원이 끝날 때까지 화면을 유지한다.
  if (typeof uiBatchDepth !== "undefined" && uiBatchDepth > 0) return;
  byId("loading").hidden = true;
}
function updateLoading(msg){ if (msg) byId("loadingMsg").textContent = (typeof window.t === "function") ? window.t(msg) : msg; }
// 브라우저에 제어권을 잠깐 돌려준다(진행 표시·입력 처리). setTimeout(0)은 타이머가 연쇄되면
// 최소 4ms로 묶여 수천 파일 루프에서 수십 초를 잃는다 → scheduler.yield/MessageChannel로 클램프 없이 양보.
const _yieldResolvers = [];
let _yieldChannel = null;
function yieldToBrowser(){
  if (typeof scheduler !== "undefined" && typeof scheduler.yield === "function") return scheduler.yield();
  if (typeof MessageChannel === "undefined") return new Promise(resolve => setTimeout(resolve, 0));
  if (!_yieldChannel){
    _yieldChannel = new MessageChannel();
    _yieldChannel.port1.onmessage = () => { const resolve = _yieldResolvers.shift(); if (resolve) resolve(); };
  }
  return new Promise(resolve => { _yieldResolvers.push(resolve); _yieldChannel.port2.postMessage(0); });
}
// 마지막 양보 후 일정 시간이 지났을 때만 실제로 양보 — 파일 수천 개 루프에서 항목당 고정 비용을 없앤다.
let _lastYieldAt = 0;
async function yieldToBrowserThrottled(minGapMs = 12){
  const now = performance.now();
  if (now - _lastYieldAt < minGapMs) return;
  await yieldToBrowser();
  _lastYieldAt = performance.now();
}
// PDF 렌더 해상도: 화면에 "보이는 배율(줌)"에 맞춰 캔버스 픽셀을 잡아 크롬처럼 어느 배율이든 또렷하게 한다.
// 기본 배율은 pdfRenderProfile().renderScale(슈퍼샘플 배수) + 줌이 커지면 그 배율로 재렌더(targetRenderDpr 참고).
// 한 변이 profile.maxSide(px) 를 넘지 않게 제한해 고배율 메모리를 보호한다(단 기본 배율 품질은 보존).
// 2배 슈퍼샘플이면 CSS 픽셀당 4배 픽셀이라 육안으로 충분히 또렷하다. 3배는 9배 픽셀이 되어
// A4 한 장이 1700만 픽셀(≈68MB)까지 커지고, 이 래스터화 시간이 스크롤 지연의 지배적 원인이었다.
// PDF 기본 표시 크기 배수(맞춤 대비). 1.0 = 기본, 키우면 더 크게 열림.
const FIT_SCALE = 1.0;
// PDF를 처음 열 때 표시 배율. 125%에서 고해상도 렌더가 즉시 적용되도록 기본값으로 사용한다.
// 페이지 최대 너비(px). 넓은 화면에서 이 값까지 커진다(너무 크면 가로 스크롤이 생기지 않게 창 너비로 제한됨).
const FIT_MAX_W = 1200;
