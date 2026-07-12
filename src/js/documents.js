"use strict";

/* ===== 문서 관리(사이드바/탭) ===== */
const IMG_EXTS = ["png","jpg","jpeg","gif","webp","bmp","svg","avif","ico"];
const SQLITE_EXTS = ["db","sqlite","sqlite3"];
// 코드/설정 파일: 확장자 → 구문강조 프로파일(c=C계열, hash=#주석, css/sql/xml=전용)
const CODE_EXTS = {
  js:"c", mjs:"c", cjs:"c", ts:"c", jsx:"c", tsx:"c", java:"c", c:"c", h:"c", cpp:"c", cc:"c", hpp:"c", cxx:"c",
  cs:"c", go:"c", rs:"c", php:"c", kt:"c", kts:"c", swift:"c", scala:"c", dart:"c", vue:"c", svelte:"c",
  json:"c", json5:"c", jsonc:"c", scss:"c", less:"c", bat:"c", cmd:"c",
  py:"hash", pyi:"hash", rb:"hash", sh:"hash", bash:"hash", zsh:"hash", ps1:"hash",
  yaml:"hash", yml:"hash", toml:"hash", ini:"hash", env:"hash", properties:"hash", conf:"hash",
  css:"css", sql:"sql",
  xml:"xml", xsl:"xml", xslt:"xml", xsd:"xml", rss:"xml", atom:"xml", plist:"xml", wsdl:"xml", dbk:"xml", docbook:"xml",
  rst:"text", adoc:"text", asciidoc:"text", asc:"text", org:"text", textile:"text", tex:"text", latex:"text", sty:"text", cls:"text", wiki:"text", mediawiki:"text",
  r:"hash", lua:"c", pl:"hash", pm:"hash", tcl:"hash", awk:"hash", groovy:"c", gradle:"c", proto:"c", coffee:"hash", cmake:"hash", dockerfile:"hash", makefile:"hash", mk:"hash",
  tsv:"text", log:"text", diff:"text", patch:"text"
};
const TEXT_ENCODING_EXTS = new Set(["csv","md","markdown","mdx","txt","html","htm","xhtml", ...Object.keys(CODE_EXTS), ...SUBTITLE_EXTS]);
// ZIP 안에서 자동으로 열어줄 확장자(중첩 zip 포함)
// VIDEO_EXTS·AUDIO_EXTS·SUBTITLE_EXTS 는 video-viewer.js 가 이 파일보다 먼저 로드되어 제공한다(스크립트 순서 주의).
const ZIP_OPENABLE = ["pdf","docx","xlsx","xls","csv","pptx","hwp","hwpx","md","markdown","mdx","txt","html","htm","xhtml","ipynb",
  ...SQLITE_EXTS, ...Object.keys(CODE_EXTS), "zip", "tar", "gz", "tgz", ...IMG_EXTS,
  ...VIDEO_EXTS, ...AUDIO_EXTS, ...SUBTITLE_EXTS];
// .env 계열(.env, .env.local 등)은 점으로 시작하지만 숨김 파일이 아니라 설정 파일 → 폴더/압축에서도 연다
function isEnvFile(name){ return /^\.env(\.[^\\/]+)?$/i.test(String(name || "")); }
// 파일 확장자 판정(.env 계열은 "env"로 취급 → 코드 뷰어·ZIP_OPENABLE 매칭)
function fileExtOf(name){
  const base = String(name || "");
  return isEnvFile(base) ? "env" : (base.split(".").pop() || "").toLowerCase();
}
// 폴더 트리의 숨김 경로 판정: 점(.) 폴더 하위이거나 파일명이 점으로 시작하면 숨김(.env 계열만 예외)
function isHiddenFolderEntry(rel){
  const parts = String(rel || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length) return true;
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some(part => part.charAt(0) === ".")) return true;
  return base.charAt(0) === "." && !isEnvFile(base);
}
// zip에서 꺼낸 파일은 MIME이 비어 있어 일부 형식(특히 SVG)이 미리보기에서 거부됨 → 확장자로 보강
const ZIP_MIME = { svg:"image/svg+xml", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg",
  gif:"image/gif", webp:"image/webp", bmp:"image/bmp", avif:"image/avif", ico:"image/x-icon", pdf:"application/pdf",
  html:"text/html", htm:"text/html" };
const ZIP_EXTRACT_CAP = 256 * 1024 * 1024;
const ZIP_ENTRY_CAP = 64 * 1024 * 1024;
const ZIP_MODE_NOTICE = "ZIP 모드: 원본 압축의 새로고침·덮어쓰기는 지원하지 않으며, 편집한 파일은 별도로 저장됩니다. Python 옆 파일 실행은 합계 50MB까지 지원합니다.";

// 여러 파일을 복원할 때 각 항목마다 사이드바·탭을 다시 그리지 않고 마지막에 한 번만 반영한다.
let uiBatchDepth = 0;
let uiBatchSidebarPending = false;
let uiBatchChromePending = false;
let uiBatchActiveCandidate = null;
let uiBatchCancelled = false;
function beginUiBatch(){
  if (uiBatchDepth++ === 0){
    uiBatchCancelled = false;
    uiBatchActiveCandidate = null;
    const cancel = byId("loadingCancel"); if (cancel) cancel.hidden = false;
  }
}
function cancelUiBatch(){ uiBatchCancelled = true; updateLoading("현재 파일 처리 후 취소하는 중…"); }
function throwIfUiCancelled(){ if (uiBatchCancelled) throw new Error("operation-cancelled"); }
function endUiBatch(){
  if (!uiBatchDepth || --uiBatchDepth > 0) return;
  const refreshSidebar = uiBatchSidebarPending;
  const refreshHeader = uiBatchChromePending;
  const activateId = uiBatchActiveCandidate;
  uiBatchCancelled = false;
  uiBatchSidebarPending = false;
  uiBatchChromePending = false;
  uiBatchActiveCandidate = null;
  const cancel = byId("loadingCancel"); if (cancel) cancel.hidden = true;
  byId("loading").hidden = true;
  if (refreshHeader) refreshChrome();
  if (refreshSidebar) renderSidebar();
  if (activateId && docs.some(d => d.id === activateId)) setActiveDoc(activateId);
}
async function runUiBatch(task){
  beginUiBatch();
  try { return await task(); }
  finally { endUiBatch(); }
}

/* ===== 손바닥 도구: 내용이 보이는 화면보다 크면 드래그로 스크롤 이동 =====
   - 빈 영역(배경/페이지 여백/문서 본문)에서 좌클릭 드래그 → scrollLeft/scrollTop 이동
   - 배치 요소(.placed), 버튼·입력 등 인터랙티브 요소 위에서는 동작 안 함
   - overflow 가 없을 때는 grab 커서를 표시하지 않음 (ResizeObserver/MutationObserver 로 갱신) */
function isPanIgnoredTarget(target, container){
  let el = target;
  while (el && el !== container){
    if (el.nodeType === 1){
      const cl = el.classList;
      // .img-view(이미지)는 제외하지 않음 — 줌인된 큰 이미지도 드래그로 이동.
      // 짧은 클릭은 임계값(4px) 안이라 통과되어 기존 줌 토글이 그대로 동작한다.
      if (cl && (cl.contains("placed") || cl.contains("text-edit") ||
                 cl.contains("pdf-text-layer") ||   // PDF 글자 위 드래그 = 텍스트 선택(패닝 아님)
                 cl.contains("img-zoom") ||
                 cl.contains("run-path") ||
                 cl.contains("xlsx-sheet") || cl.contains("sqlite-host") || cl.contains("code-host") || cl.contains("code-output") || cl.contains("run-divider") ||
                 cl.contains("txt-host") || cl.contains("md-host") ||
                 cl.contains("html-host") || cl.contains("xlsx-tabs") ||
                 cl.contains("xlsx-tab") || cl.contains("ctrl") ||
                 cl.contains("grip"))) return true;
      const tag = el.tagName;
      if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "TEXTAREA" ||
          tag === "SELECT" || tag === "IFRAME" || tag === "LABEL") return true;
      if (el.isContentEditable) return true;
    }
    el = el.parentElement;
  }
  return false;
}
function updatePannableState(container){
  if (!container) return;
  const over = container.scrollWidth  > container.clientWidth  + 1 ||
               container.scrollHeight > container.clientHeight + 1;
  container.classList.toggle("pannable", over);
}
function attachPanBehavior(container){
  if (!container || container.__panAttached) return;
  container.__panAttached = true;

  // overflow 상태 추적 — 자식 크기/구조 변화에 모두 반응
  if (typeof ResizeObserver !== "undefined"){
    const ro = new ResizeObserver(() => updatePannableState(container));
    ro.observe(container);
    container.__panRO = ro;
  }
  if (typeof MutationObserver !== "undefined"){
    const mo = new MutationObserver(() => updatePannableState(container));
    mo.observe(container, { childList: true, subtree: true, attributes: true,
                            attributeFilter: ["style","class","width","height"] });
    container.__panMO = mo;
  }
  setTimeout(() => updatePannableState(container), 50);

  container.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;                                   // 좌클릭만
    if (isPanIgnoredTarget(e.target, container)) return;
    const overX = container.scrollWidth  > container.clientWidth;
    const overY = container.scrollHeight > container.clientHeight;
    if (!overX && !overY) return;

    const startX = e.clientX, startY = e.clientY;
    const startSL = container.scrollLeft, startST = container.scrollTop;
    let panning = false;

    function onMove(ev){
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!panning){
        if (Math.abs(dx) + Math.abs(dy) < 4) return;              // 4px 임계값 — 짧은 클릭은 통과
        panning = true;
        container.classList.add("panning");
        try { window.getSelection().removeAllRanges(); } catch(_){}
      }
      if (overX) container.scrollLeft = startSL - dx;
      if (overY) container.scrollTop  = startST - dy;
      ev.preventDefault();
    }
    function onUp(){
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup",   onUp,   true);
      if (panning){
        container.classList.remove("panning");
        // 드래그 직후 발생하는 click 은 한 번 차단(배치요소 해제·iframe 포커스 같은 부작용 방지)
        const blockClick = (cev) => { cev.stopPropagation(); cev.preventDefault(); };
        document.addEventListener("click", blockClick, { capture: true, once: true });
      }
    }
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup",   onUp,   true);
  });
}

let fsControlsTimer = null;
function isViewerFullscreen(){
  return document.fullscreenElement === byId("content") || document.body.classList.contains("viewer-fullscreen");
}
function setViewerFullscreenFallback(on){
  document.body.classList.toggle("viewer-fullscreen", !!on);
  syncFullscreenButtons();
  scheduleViewerLayoutRefresh();
}
async function enterViewerFullscreen(){
  const content = byId("content");
  if (!content) return;
  try {
    if (content.requestFullscreen) await content.requestFullscreen();
    else setViewerFullscreenFallback(true);
  } catch(e){
    setViewerFullscreenFallback(true);
  }
  syncFullscreenButtons();
  scheduleViewerLayoutRefresh();
  showFullscreenControls();
}
async function exitViewerFullscreen(){
  if (document.fullscreenElement && document.exitFullscreen) {
    try { await document.exitFullscreen(); } catch(e){}
  }
  setViewerFullscreenFallback(false);
  syncFullscreenButtons();
  hideFullscreenControlsNow();
}
function toggleViewerFullscreen(){
  if (isViewerFullscreen()) exitViewerFullscreen();
  else enterViewerFullscreen();
}
function syncFullscreenButtons(){
  const on = isViewerFullscreen();
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  const title = _t(on ? "전체화면 종료" : "문서 영역 전체화면");
  // PDF 전체화면은 페이지 표시줄(pill) 안의 아이콘 버튼 — 라벨을 덮어쓰지 않고 툴팁·상태만 갱신
  const pdfFs = byId("btnFullscreen");
  if (pdfFs){ pdfFs.title = title; pdfFs.setAttribute("aria-label", title); pdfFs.classList.toggle("active", on); }
  // 오피스 전체화면은 헤더의 텍스트 버튼
  const offFs = byId("btnOfficeFullscreen");
  if (offFs){ offFs.textContent = _t(on ? "⛶ 나가기" : "⛶ 전체화면"); offFs.title = title; }
  const group = byId("fsZoomGroup");
  const pdf = typeof fullscreenPdfTarget === "function" ? fullscreenPdfTarget() : (state && state.kind === "pdf" ? state : null);
  if (group) group.hidden = !pdf;
  const fsLbl = byId("fsZoomLabel");
  if (fsLbl) fsLbl.textContent = Math.round(((pdf && pdf.zoom) || 1) * 100) + "%";
  updateFullscreenPageIndicator();
}
function armFullscreenControlsTimer(){
  clearTimeout(fsControlsTimer);
  const controls = byId("fsControls");
  if (!controls || !isViewerFullscreen()) return;
  fsControlsTimer = setTimeout(() => {
    if (isViewerFullscreen()) controls.classList.add("hide");
  }, 2200);
}
function showFullscreenControls(){
  const controls = byId("fsControls");
  if (!controls || !isViewerFullscreen()) return;
  syncFullscreenButtons();
  controls.classList.remove("hide");
  armFullscreenControlsTimer();
}
function hideFullscreenControlsNow(){
  clearTimeout(fsControlsTimer);
  const controls = byId("fsControls");
  if (controls) controls.classList.add("hide");
}
// ── 분할화면(study) 바 자동 숨김 — 전체화면 컨트롤과 같은 유휴 숨김 방식 ──
let studyControlsTimer = null;
const STUDY_IDLE_MS = 3500;
function studyControlsActive(){
  const c = byId("content");
  return !!(c && c.classList.contains("study-mode") && !isViewerFullscreen());
}
// 페이지 번호 입력 중·펜 필기 중·찾기창 열림 중에는 숨기지 않는다
function studyInteractionBusy(){
  const ae = document.activeElement;
  const ctl = byId("studyPageCtl");
  if (ctl && ae && ctl.contains(ae)) return true;
  const pen = byId("btnStudyPen");
  if (pen && pen.classList.contains("active")) return true;
  if (document.querySelector(".pdf-find:not([hidden])")) return true;
  return false;
}
function armStudyControlsTimer(){
  clearTimeout(studyControlsTimer);
  if (!studyControlsActive()) return;
  studyControlsTimer = setTimeout(() => {
    if (!studyControlsActive()) return;
    if (studyInteractionBusy()){ armStudyControlsTimer(); return; }   // 상호작용 중이면 다시 대기
    const c = byId("content"); if (c) c.classList.add("study-idle");
  }, STUDY_IDLE_MS);
}
function showStudyControls(){
  if (!studyControlsActive()) return;
  const c = byId("content"); if (c) c.classList.remove("study-idle");
  armStudyControlsTimer();
}
function stopStudyControlsAutoHide(){
  clearTimeout(studyControlsTimer);
  const c = byId("content"); if (c) c.classList.remove("study-idle");
}
function scheduleViewerLayoutRefresh(){
  setTimeout(() => {
    const pdf = typeof fullscreenPdfTarget === "function" ? fullscreenPdfTarget() : (state && state.kind === "pdf" ? state : null);
    if (pdf) refreshVisibleQuality(pdf);
    if (state && state.el) updatePannableState(state.el);
  }, 80);
}

function makeGroup(kind, name, parentId=null){
  const node = { nodeId: "group:" + (++navSeq), type: "group", kind, name, parentId, expanded: true };
  navNodes.push(node);
  bumpNavTree();
  renderSidebar();
  refreshChrome();
  return node;
}

function attachStudyReferenceGuard(doc){
  const locked = () => isStudyReferenceLocked(doc);
  const pointerSurface = (target) => {
    if (!target || !target.closest) return "content";
    if (target.closest(".code-link")) return "code-link";
    const textControl = target.closest("textarea,[contenteditable='true'],input");
    if (textControl){
      const type = String(textControl.type || "text").toLowerCase();
      if (textControl.tagName !== "INPUT" || ["text","search","url","email","tel","password","number"].includes(type)) return "text-selection";
    }
    if (target.closest(".selectable-sheet,.xlsx-sheet")) return "sheet-selection";
    if (target.closest("button,input,select,.placed,.wb-canvas,.wb-tools,.code-edit,.xlsx-editbar,.img-editor,.img-view,.scratchpad")) return "mutation-control";
    return "content";
  };
  const blockPointer = (event) => {
    if (!locked()) return;
    if (studyReadonlyPointerAllowed(pointerSurface(event.target), event.type)) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  ["pointerdown", "click", "dblclick", "contextmenu"].forEach(type => doc.el.addEventListener(type, blockPointer, true));
  doc.el.addEventListener("beforeinput", (event) => { if (locked()){ event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  ["paste", "cut", "drop"].forEach(type => doc.el.addEventListener(type, (event) => {
    if (locked()){ event.preventDefault(); event.stopImmediatePropagation(); }
  }, true));
  doc.el.addEventListener("keydown", (event) => {
    if (!locked()) return;
    const target = event.target;
    const closest = target && target.closest ? target.closest.bind(target) : () => null;
    if (studyReadonlyKeyAllowed({
      key:event.key, ctrlKey:event.ctrlKey, metaKey:event.metaKey,
      textEntry:!!closest("input,textarea,[contenteditable='true']"),
      activationControl:!!closest("button,select")
    })) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
}

function makeDoc(kind, name, options={}){
  const id = ++docSeq;
  const el = document.createElement("div");
  el.className = (kind === "pdf") ? "viewer" : "office";
  el.hidden = true;
  byId("content").appendChild(el);
  const d = { id, nodeId: "doc:" + id, parentId: options.parentId || null, name, kind, el,
    workspacePath: options.workspacePath || null, size: options.size || 0, sourceKey: options.sourceKey || null,
    isScratch: !!options.isScratch, textEncoding: options.textEncoding || null,
    originalSaveMode: !!options.originalSaveMode };   // 새로 만든 빈 코드 → 첫 저장 때 이름 받기
  d.relPath = options.relPath || null;
  d.archiveCtx = options.archiveCtx || null;
  d.fsHandle = options.fsHandle || null;
  d.fsDirHandle = options.fsDirHandle || null;   // 같은 폴더에 새 파일을 만들 때 쓰는 폴더 핸들(변환 노트북 저장 등)
  // 손바닥 도구·읽기전용 가드·사이드바 포커스 리스너는 첫 활성화(ensureDocInteractive)로 미룬다.
  // 이미지 수천 장 폴더에서 문서마다 관찰자 2개 + 리스너 십수 개를 만들던 고정 비용 제거.
  if (kind === "pdf"){
    d.pdfBytes=null; d.fileName=name; d.pages=[]; d.allPages=[]; d.elements=[]; d.selected=null; d.addCount=0; d.zoom=defaultPdfZoom();
    d.selectedPageIds = new Set(); d.pagePanelOpen = false;
  }
  docs.push(d);
  if (d.sourceKey && !docsBySourceKey.has(d.sourceKey)) docsBySourceKey.set(d.sourceKey, d);
  navNodes.push({ nodeId: d.nodeId, type: "doc", docId: id, parentId: d.parentId });
  bumpNavTree();
  renderSidebar();                       // 새 항목을 한 번만 그려둔다(이후 전환은 활성표시만 갱신)
  return d;
}

function setActiveDoc(id){
  const prev = docs.find(x => x.id === activeId);          // 직전 활성 문서(있으면)
  if (typeof syncPdfFindToActive === "function") syncPdfFindToActive(id);   // 문서 전환 시 PDF 찾기 닫기
  // 다른 종류 문서로 전환 시 PDF 필기바·코드 필기바가 하단에 남는 현상 방지.
  // - PDF 필기는 글로벌 모드라 PDF 가 아닌 활성 문서에선 끔
  // - 코드 필기는 doc 별 상태라 활성 doc 의 상태에 맞춰 바 표시만 동기화(획은 그대로 유지)
  const target = docs.find(x => x.id === id);
  if (typeof setPenMode === "function" && (!target || target.kind !== "pdf")) setPenMode(false);
  if (typeof syncCodePenBarToActive === "function") syncCodePenBarToActive(target);
  activeId = id;
  // 활성화 이력 갱신: 같은 id 중복 제거 후 맨 앞에. 활성 탭을 닫을 때 직전에 보던 문서로 돌아가는 기준이 된다.
  if (id){
    activeMru = activeMru.filter(x => x !== id);
    activeMru.unshift(id);
    if (activeMru.length > 50) activeMru.length = 50;
  }
  const d = docs.find(x => x.id === id);
  byId("content").classList.toggle("pdf-active", !!d && d.kind === "pdf");   // 일반 화면 플로팅 페이지 컨트롤 표시 조건

  // 전환은 직전·현재 두 문서만 토글한다(모든 문서를 매번 훑지 않아 파일 많은 묶음에서 클릭이 빨라짐).
  // 학습 화면의 고정 PDF는 이 함수 끝의 applyStudyLayout 이 다시 표시한다.
  if (prev && prev !== d) prev.el.hidden = true;
  if (d) d.el.hidden = false;
  if (!d){ state=null; viewer=null; byId("activeFileName").textContent=""; byId("activeFileName").removeAttribute("data-cat"); byId("activeDocEncoding").hidden=true; byId("activeDocStatus").hidden=true; updateOriginalSaveBadge(null); byId("tools").hidden=true; byId("officeTools").hidden=true; updateModeBadges(); updateSidebarActive(); return; }
  state = d;
  viewer = d.el;
  byId("tools").hidden = (d.kind !== "pdf");
  byId("officeTools").hidden = (d.kind === "pdf");
  byId("btnPages").classList.toggle("primary", !!(d.kind === "pdf" && d.pagePanelOpen));
  updateDocumentEncoding(d);
  updateDocumentStatus(d);
  updateOriginalSaveBadge(d);
  updateModeBadges();
  const hdrName = byId("activeFileName");
  hdrName.textContent = d.name;
  const hdrCat = extCategory(d.kind, d.name);            // 상단 파일명도 선택 파일의 색조로
  if (hdrCat) hdrName.dataset.cat = hdrCat; else hdrName.removeAttribute("data-cat");
  if (!tabOrder.includes(id)) tabOrder.push(id);         // 처음 선택한 문서면 탭바에 추가(이미 있으면 순서 유지)
  renderTabs();
  updateZoomLabel();
  updatePdfPageIndicator(d);                             // 헤더 '현재/총 페이지' 갱신
  // 메모리 절약: 떠나는 PDF 의 캔버스만 비운다(매 클릭마다 모든 문서를 훑지 않음). 활성 PDF 는 보이는 페이지를 다시 렌더.
  if (prev && prev.id !== id && prev.kind === "pdf" && prev.pages) prev.pages.forEach(releasePageCanvas);
  // 다른 탭으로 옮기면 보이지 않는 영상은 일시정지한다(소리만 계속 나는 혼란 방지 — 오디오 문서는 계속 재생).
  if (prev && prev.id !== id && prev.kind === "video" && prev.media !== "audio" && prev.el){
    prev.el.querySelectorAll("video").forEach(m => { try { m.pause(); } catch(_){} });
  }
  if (d.kind === "pdf" && d.pages && d.pages.length) startLazyRender(d);
  ensureRendered(d);                                      // 아직 안 그렸으면 이때 처음 렌더(지연 렌더)
  applyStudyLayout();
  updateSidebarActive();                                  // 전체 재생성 대신 활성 표시만 갱신(클릭 반응 향상)
  focusSidebarActive();                                   // 활성 파일을 사이드바에서 보이게(스크롤 + 접힌 폴더 펼침)
}

// 열린 탭(tabOrder) 사이를 좌/우로 순환 전환. (Ctrl+←/→)
function navigateTab(delta){
  if (tabOrder.length < 2) return;
  const i = tabOrder.indexOf(activeId);
  if (i < 0) return;
  const n = tabOrder.length;
  const next = tabOrder[(i + delta + n) % n];
  if (next != null && next !== activeId) setActiveDoc(next);
}

// 학습 화면에서 PDF·코드의 좌우 위치를 바꾼 상태(저장)
let studySwapped = (() => { try { return localStorage.getItem("studySwapped") === "1"; } catch(e){ return false; } })();
function setStudySwapped(v){
  studySwapped = !!v;
  try { localStorage.setItem("studySwapped", studySwapped ? "1" : "0"); } catch(e){}
  byId("content").classList.toggle("study-swapped", studySwapped);
  if (typeof showStudyControls === "function") showStudyControls();                    // 스왑 결과가 보이도록 바를 다시 표시(유휴 숨김 해제)
  const ref = docs.find(d => d.id === studyPdfId);
  if (ref && ref.kind === "pdf") requestAnimationFrame(() => fitStudyPdf(ref));        // 칸 너비가 바뀌었으니 PDF 다시 맞춤
}

// 분할 작업의 참고 PDF는 보기·검색·선택만 허용한다. PDF 편집 모듈도 이 함수를
// 공용으로 호출해 필기·주석·코드 핀 같은 변경 경로를 일관되게 막는다.
function isStudyReferenceLocked(doc){
  const content = byId("content");
  return !!(studyReferenceLocked && doc && doc.id === studyPdfId && content && content.classList.contains("study-mode"));
}
function isStudyReferenceReadonly(doc){ return isStudyReferenceLocked(doc); }
function setStudyReferenceLocked(locked){
  studyReferenceLocked = !!locked;
  applyStudyLayout();
  persistTabState();
  toast(studyReferenceLocked ? "참고 문서를 잠갔습니다. 보기·스크롤·복사만 가능합니다." : "참고 문서 잠금을 풀었습니다. 기존 학습 화면처럼 편집할 수 있습니다.", 3200);
}

// 분할 화면에서 마지막에 클릭한 칸을 기억한다 — 사이드바 파일 클릭이 이 칸의 문서를 바꾼다.
function setStudyTargetPane(pane){
  if (pane !== "reference" && pane !== "work") return;
  if (studyTargetPane === pane) return;
  studyTargetPane = pane;
  updateStudyTargetHighlight();
  persistTabState();
}
// 타깃 칸에만 표시 클래스를 붙인다(참고/작업 두 문서만 만지면 되므로 가볍다).
function updateStudyTargetHighlight(){
  const split = byId("content").classList.contains("study-mode");
  const targetId = studyTargetPane === "reference" ? studyPdfId : activeId;
  docs.forEach(d => d.el.classList.toggle("study-pane-target", split && d.id === targetId));
}
// 칸 안 아무 곳이나 누르면 그 칸이 타깃이 된다. 내부 위젯이 이벤트 전파를 막아도 잡히게 캡처 단계 사용.
function setupStudyPaneTracker(){
  const content = byId("content");
  if (content._studyPaneTracker) return;
  content._studyPaneTracker = true;
  content.addEventListener("pointerdown", (e) => {
    if (!content.classList.contains("study-mode")) return;
    const pane = e.target.closest && e.target.closest(".study-reference, .study-work");
    if (!pane) return;
    setStudyTargetPane(pane.classList.contains("study-reference") ? "reference" : "work");
  }, true);
  // 참고 칸 왼쪽 위 모서리에 마우스가 오면 잠금 열쇠를 잠깐 노출(잠금 상태면 CSS 가 늘 보여주므로 무시)
  content.addEventListener("pointermove", (e) => {
    if (!content.classList.contains("study-mode") || studyReferenceLocked){ content.classList.remove("study-ref-lock-show"); return; }
    const ref = docs.find(d => d.id === studyPdfId);
    if (!ref || !ref.el){ content.classList.remove("study-ref-lock-show"); return; }
    const r = ref.el.getBoundingClientRect();
    const near = e.clientX >= r.left && e.clientX <= r.left + 150 && e.clientY >= r.top && e.clientY <= r.top + 64;
    content.classList.toggle("study-ref-lock-show", near);
  }, { passive: true });
  content.addEventListener("pointerleave", () => content.classList.remove("study-ref-lock-show"));
}

// 사이드바·상단 탭에서 파일 클릭 시 공용 진입점: 분할 화면이면 마지막 클릭 칸 기준으로 연다.
// - 타깃 칸에 이미 떠 있는 문서 → 그대로 유지
// - 반대 칸에 떠 있는 문서 → 좌우 역할 교대(스왑)
// - 그 외 문서 → 타깃 칸의 문서만 교체(반대 칸은 유지)
function openDocInTargetPane(id){
  const action = studyPaneSelectionAction(studyPdfId, activeId, studyTargetPane, id);
  if (action === "keep") return;
  if (action === "swap"){ setStudyReference(activeId); return; }
  if (action === "replace-reference"){ setStudyReference(id); return; }
  setActiveDoc(id);   // 일반 화면 또는 작업 칸 교체
}

// 학습 화면 좌(PDF)·우(코드) 비율 조절 분할바 — #content 에 한 번만 만들고 드래그로 --study-split 갱신(저장)
function setupStudyDivider(){
  const content = byId("content");
  if (content._studyDivider) return content._studyDivider;
  const divider = document.createElement("div");
  divider.className = "study-divider";
  divider.setAttribute("role", "separator"); divider.setAttribute("aria-orientation", "vertical"); divider.tabIndex = 0;
  divider.setAttribute("aria-valuemin", "20"); divider.setAttribute("aria-valuemax", "80");
  divider.title = "드래그: 좌우 비율 조절 · 더블클릭: 좌우 바꾸기";
  let ratio = 50;
  try { const s = Number(localStorage.getItem("studySplitRatio")); if (s >= 20 && s <= 80) ratio = s; } catch(e){}
  const apply = (next) => {
    ratio = Math.max(20, Math.min(80, next));
    content.style.setProperty("--study-split", ratio + "%");
    divider.setAttribute("aria-valuenow", String(Math.round(ratio)));
  };
  const save = () => { try { localStorage.setItem("studySplitRatio", String(ratio)); } catch(e){} };
  apply(ratio);
  divider.addEventListener("pointerdown", (e) => {
    if (matchMedia("(max-width: 900px)").matches) return;          // 모바일은 세로 고정 분할
    const rect = content.getBoundingClientRect();
    const startX = e.clientX;
    let dragging = false;
    // 움직임이 4px 을 넘을 때만 드래그로 전환한다. 순수 클릭·더블클릭은 포인터 캡처를
    // 걸지 않아 dblclick(좌우 바꾸기)이 캡처에 가로채이지 않는다.
    const move = (ev) => {
      if (!dragging){
        if (Math.abs(ev.clientX - startX) < 4) return;
        dragging = true;
        try { divider.setPointerCapture(e.pointerId); } catch(_){}
        divider.classList.add("dragging");
      }
      ev.preventDefault();
      apply(((ev.clientX - rect.left) / rect.width) * 100);
    };
    const up = () => {
      if (dragging){ divider.classList.remove("dragging"); save(); }
      divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up);
    };
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", up); divider.addEventListener("pointercancel", up);
  });
  divider.addEventListener("dblclick", () => setStudySwapped(!studySwapped));   // 더블클릭: PDF·코드 좌우 바꾸기
  divider.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault(); apply(ratio + (e.key === "ArrowLeft" ? -2 : 2)); save();
  });
  content.appendChild(divider);
  content._studyDivider = divider;
  return divider;
}

// 학습 화면에서 PDF를 왼쪽 칸 너비에 맞춰 자동 확대/축소(분할 드래그·창 크기 변화에 함께 반응)
function fitStudyPdf(doc){
  if (!doc || doc.kind !== "pdf" || !doc.pages || !doc.pages.length) return;
  if (!byId("content").classList.contains("study-mode") || doc.id !== studyPdfId) return;
  const p = doc.pages[0];
  const avail = doc.el.clientWidth - 40;          // 좌우 여백·스크롤바 여유
  if (avail <= 0 || !p.cssW) return;
  const z = Math.max(0.3, Math.min(4, avail / p.cssW));   // 페이지 폭(cssW=줌1 기준)을 칸에 맞춤
  if (Math.abs(z - (doc.zoom || 1)) > 0.005) setPdfZoom(z, doc);
  updateStudyPageIndicator();
}

function applyStudyLayout(){
  const content = byId("content");
  docs.forEach(d => d.el.classList.remove("study-reference", "study-work", "study-readonly", "study-pane-target"));
  const ref = docs.find(d => d.id === studyPdfId);
  const work = docs.find(d => d.id === activeId);
  const split = !!(ref && work && ref.id !== work.id);
  content.classList.toggle("study-mode", split);
  content.classList.toggle("study-reference-locked", split && studyReferenceLocked);
  content.classList.toggle("study-swapped", split && studySwapped);   // 저장된 좌우 배치 적용
  content.classList.toggle("study-ref-nonpdf", !!(split && ref && ref.kind !== "pdf"));  // 참고가 PDF가 아니면 PDF 전용 컨트롤(필기·페이지) 숨김
  if (split) showStudyControls(); else stopStudyControlsAutoHide();    // 유휴 자동 숨김 시작/정리
  if (typeof syncPdfFindLayout === "function") syncPdfFindLayout();
  if (split){
    setupStudyDivider();                       // 분할바 준비(저장된 비율 적용)
    setupStudyPaneTracker();                   // 칸 클릭 → 타깃 칸 추적(한 번만 설치)
    ref.el.hidden = false;
    ref.el.classList.add("study-reference");
    ref.el.classList.toggle("study-readonly", studyReferenceLocked);
    work.el.classList.add("study-work");
    if (studyReferenceLocked && typeof setPenMode === "function" && typeof penMode !== "undefined" && penMode) setPenMode(false);
    if (ref.kind === "pdf" && ref.pages && ref.pages.length) startLazyRender(ref);
    // 칸 너비가 바뀔 때마다(분할 드래그·창 크기) PDF를 칸에 맞춰 다시 맞춤
    if (ref.kind === "pdf" && !ref._studyRO && typeof ResizeObserver !== "undefined"){
      let raf = 0;
      ref._studyRO = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fitStudyPdf(ref)); });
      ref._studyRO.observe(ref.el);
    }
    if (ref.kind === "pdf") requestAnimationFrame(() => fitStudyPdf(ref));    // 진입 시 1회 맞춤
  }
  docs.forEach(d => {
    const readonly = !!(split && studyReferenceLocked && ref && d.id === ref.id);
    d._studyReadonly = readonly;
    if (d.codeEditor && d.codeEditor.ta){
      d.codeEditor.ta.readOnly = readonly || !!d._nbInkMode;
      d.codeEditor.ta.setAttribute("aria-readonly", String(readonly || !!d._nbInkMode));
    }
  });
  const pageCtl = byId("studyPageCtl");
  if (pageCtl){
    pageCtl.hidden = !split;
    pageCtl.classList.toggle("non-pdf-ref", !!(split && ref && ref.kind !== "pdf"));
  }
  const btn = byId("studyToggle");
  btn.hidden = docs.length === 0;
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  btn.textContent = _t(ref ? "분할 작업 종료" : "분할 작업");
  btn.title = _t(ref ? "참고 문서 고정을 해제하고 일반 화면으로 돌아가기" : "현재 문서를 참고 화면에 고정하고 작업 문서와 나란히 보기");
  // 참고 칸 왼쪽 위 잠금 열쇠: 상태(잠김/열림)만 갱신(표시 여부는 CSS + 모서리 호버가 결정)
  const chipLock = byId("studyChipLock");
  if (chipLock){
    chipLock.title = studyReferenceLocked ? "참고 문서 잠금을 풀고 편집 가능하게 하기" : "참고 문서를 읽기 전용으로 잠그기";
    chipLock.setAttribute("aria-pressed", String(studyReferenceLocked));
  }
  updateStudyTargetHighlight();                // 타깃 칸 표시 갱신(분할 아니면 표시 제거)
  updateStudyPageIndicator();                  // 학습 화면 PDF '현재/총 페이지' 갱신(미진입이면 비움)
  updateModeBadges();
}

function toggleStudyMode(){
  if (studyPdfId !== null){
    const prev = docs.find(d => d.id === studyPdfId);
    studyPdfId = null;
    studyReferenceLocked = false;
    studyTargetPane = "work";
    if (typeof syncPdfFindToActive === "function") syncPdfFindToActive(activeId);
    docs.forEach(d => d.el.hidden = d.id !== activeId);
    applyStudyLayout();
    renderTabs();                                          // 참고 문서 탭 표시 제거
    if (prev && prev.kind === "pdf" && prev._preStudyZoom != null){ setPdfZoom(prev._preStudyZoom, prev); prev._preStudyZoom = null; }   // 진입 전 줌 복원
    return;
  }
  if (!state){
    toast("먼저 참고할 문서를 연 뒤 분할 작업을 눌러주세요.", 3000);
    return;
  }
  startStudyModeWithDoc(state);
}

// 어떤 문서든 읽기 전용 참고 화면으로 고정한다. PDF 코드는 기존 API를 그대로 쓴다.
function startStudyModeWithDoc(doc, options={}){
  if (!doc || doc.closed) return false;
  if (studyPdfId === doc.id) return true;
  if (studyPdfId !== null){
    setStudyReference(doc.id);
    return true;
  }
  studyReferenceLocked = true;                                                         // 참고 문서는 기본 읽기 전용(잠금) — 실수로 고치는 걸 막음
  studyTargetPane = "work";                                                            // 분할 진입 시 기본 타깃은 작업 칸
  studyPdfId = doc.id;
  if (doc.kind === "pdf" && doc._preStudyZoom == null) doc._preStudyZoom = doc.zoom;   // 종료 시 되돌릴 원래 줌 기억
  applyStudyLayout();
  renderTabs();                                                                        // 참고 문서 탭 표시 갱신
  if (!options.silent) toast("문서를 참고 화면에 고정했어요. 참고 문서는 읽기 전용으로 잠겨 있어요. 편집하려면 참고 칸 왼쪽 위 열쇠를 눌러 잠금을 푸세요.", 4600);
  return true;
}
function startStudyModeWithPdf(pdfDoc, options={}){ return pdfDoc && pdfDoc.kind === "pdf" ? startStudyModeWithDoc(pdfDoc, options) : false; }

// 학습 화면에서 왼쪽 참조 PDF만 다른 PDF로 교체한다(오른쪽 작업 문서는 그대로 유지).
function setStudyReference(id){
  const next = docs.find(d => d.id === id);
  if (!next || id === studyPdfId) return;
  const prevRef = docs.find(d => d.id === studyPdfId);
  const previousWork = docs.find(d => d.id === activeId);
  if (prevRef){
    if (prevRef.kind === "pdf" && prevRef._preStudyZoom != null){ setPdfZoom(prevRef._preStudyZoom, prevRef); prevRef._preStudyZoom = null; }   // 옛 참조 줌 원래대로
    if (prevRef.id !== activeId) prevRef.el.hidden = true;                                                            // 작업 문서가 아니면 옛 참조 숨김
  }
  studyPdfId = id;
  if (typeof syncPdfFindToActive === "function") syncPdfFindToActive(activeId);
  if (!tabOrder.includes(id)) tabOrder.push(id);                          // 참고 칸으로 열어도 탭에 추가(아래 renderTabs 또는 setActiveDoc 이 그린다)
  if (next.kind === "pdf") next._preStudyZoom = next.zoom;                // 종료 시 되돌릴 줌 기억
  // 현재 작업 문서를 참고로 바꿀 때는 기존 참고 문서를 작업 칸으로 넘겨 역할을 교대한다.
  const workDoc = previousWork && previousWork.id !== next.id ? previousWork : prevRef;
  if (!workDoc || workDoc.id === next.id){ setActiveDoc(id); return; }
  if (activeId !== workDoc.id){ setActiveDoc(workDoc.id); return; }
  next.el.hidden = false;
  applyStudyLayout();                                                      // 좌우 배치 즉시 적용(참조=새 PDF, 작업=기존)
  renderTabs();                                                            // 새 참고 탭 추가·참고 표시 갱신
  ensureRendered(next).then(() => { if (next.id === studyPdfId && next.kind === "pdf"){ startLazyRender(next); requestAnimationFrame(() => fitStudyPdf(next)); } });
  updateSidebarActive(); focusSidebarDoc(id);
}

// 사이드바 전체를 다시 그리지 않고 .active 표시만 옮긴다 — 파일이 많을 때 클릭 반응을 빠르게.
function updateSidebarActive(){
  byId("sbList").querySelectorAll(".sb-item").forEach(el => {
    el.classList.toggle("active", el.dataset.docId === String(activeId));
    el.classList.toggle("study-ref", studyPdfId !== null && el.dataset.docId === String(studyPdfId) && el.dataset.docId !== String(activeId));   // 학습 화면 고정 PDF 표시
  });
}

// 활성 파일이 사이드바에 보이도록: 접힌 부모 폴더/압축을 펼치고 그 항목으로 스크롤
let sidebarContentFocusTimer = 0;
function focusSidebarDoc(id){
  if (sidebarCollapsed) return;                  // 사이드바 숨김 상태면 스킵
  const d = docs.find(x => x.id === id);
  if (!d) return;
  let changed = false, node = navNodeById(d.nodeId);
  while (node && node.parentId != null){          // 부모 그룹들을 따라 올라가며 펼침
    const parent = navNodeById(node.parentId);
    if (!parent) break;
    if (parent.type === "group" && !parent.expanded){ parent.expanded = true; changed = true; }
    node = parent;
  }
  if (changed) renderSidebar();                   // 펼친 결과 반영(접힌 그룹 안 항목은 새로 그려짐)
  let el = null;
  byId("sbList").querySelectorAll(".sb-item").forEach(x => { if (x.dataset.docId === String(d.id)) el = x; });
  if (el){
    el.scrollIntoView({ block: "nearest" });   // 사이드바 리스트 안에서만 최소 스크롤
    byId("sbList").querySelectorAll(".content-focus").forEach(x => x.classList.remove("content-focus"));
    el.classList.add("content-focus");
    clearTimeout(sidebarContentFocusTimer);
    sidebarContentFocusTimer = setTimeout(() => el.classList.remove("content-focus"), 900);
  }
}
function focusSidebarActive(){ focusSidebarDoc(activeId); }

// 문서당 상호작용 부착(지연): 손바닥 도구 관찰자 + 분할화면 읽기전용 가드 + 사이드바 포커스.
// makeDoc 시점이 아니라 처음 화면에 쓰일 때 한 번만 붙여, 대량 폴더 열기의 문서당 고정 비용을 없앤다.
function ensureDocInteractive(d){
  if (!d || d.__interactive || !d.el) return;
  d.__interactive = true;
  attachPanBehavior(d.el);                 // 손바닥 도구: 내용이 화면보다 크면 드래그로 이동
  attachStudyReferenceGuard(d);
  d.el.addEventListener("pointerdown", () => focusSidebarDoc(d.id));
}

// 지연 렌더: 문서를 처음 활성화할 때 doc.render() 를 한 번만 실행한다.
// (압축 안에 파일이 많아도 열기/전환이 빨라지고, 클릭한 문서만 그린다.)
function ensureRendered(d){
  if (!d || d.closed) return Promise.resolve();
  ensureDocInteractive(d);                 // 활성화 경로 공통 지점 — 여기서 처음 한 번 부착
  if (d.rendered || typeof d.render !== "function") return Promise.resolve();
  if (d._renderPromise) return d._renderPromise;          // 진행 중인 첫 렌더가 끝날 때까지 후속 이동도 함께 대기
  d._rendering = true;
  const promise = Promise.resolve().then(async () => {
    showLoading("여는 중…");
    try {
      await d.render();
      d.rendered = true;
    } catch (e){
      if (!(e && (e.message === "cancelled" || e.message === "hwpx-unsupported" || e.message === "handled"))){
        console.error(e); toast("파일을 여는 중 오류가 발생했습니다.", 3000);
      }
      closeDoc(d.id, { skipConfirm: true });
    } finally {
      d._rendering = false;
      d._renderPromise = null;
      hideLoading();
    }
  });
  d._renderPromise = promise;
  return promise;
}

// 새 문서를 즉시 표시할지 결정 — 일괄 열기에서는 처음 성공한 문서를 배치 대표로 고정한다.
function activateIfIdle(doc, opts){
  const bulk = !!(opts && opts.bulk);
  if (uiBatchDepth > 0){
    if (!uiBatchActiveCandidate) uiBatchActiveCandidate = doc.id;
    return;
  }
  if (!bulk || !activeId || !docs.some(d => d.id === activeId)) setActiveDoc(doc.id);
}

function updateDocumentStatus(doc){
  const badge = byId("activeDocStatus");
  if (!badge || !doc || doc.id !== activeId){ if (badge) badge.hidden = true; return; }
  let text = "", cls = "";
  if (doc.hasUnsavedEdits){ text = "저장 안 됨"; cls = "dirty"; }
  else if (doc.kind === "pdf" && appSettings.pdfRecovery && doc.recoveryDirty){ text = "자동 저장 중"; cls = "dirty"; }
  else if (doc.kind === "pdf" && appSettings.pdfRecovery){ text = "자동 저장됨"; cls = "saved"; }
  if (!text){ badge.hidden = true; return; }
  badge.textContent = (typeof window.t === "function") ? window.t(text) : text; badge.className = "doc-status " + cls; badge.hidden = false;
}

function updateDocumentEncoding(doc){
  const badge = byId("activeDocEncoding");
  if (!badge || !doc || doc.id !== activeId || !doc.textEncoding){
    if (badge) badge.hidden = true;
    return;
  }
  const info = doc.textEncoding;
  badge.textContent = info.label;
  badge.title = "불러온 파일의 저장 인코딩" + (info.sampled ? " (파일 앞부분을 검사한 결과)" : "") +
    (info.uncertain ? " · 바이트만으로 확정할 수 없어 추정값입니다." : "");
  badge.hidden = false;
}

function setDocumentTextEncoding(doc, info, refresh=true){
  if (!doc || !info) return;
  doc.textEncoding = info;
  if (doc.id === activeId) updateDocumentEncoding(doc);
  if (refresh && typeof renderSidebar === "function") renderSidebar();
}

function markDocumentSavedAsUtf8(doc, refresh=true){
  setDocumentTextEncoding(doc, {
    encoding:"utf-8", label:"UTF-8", shortLabel:"UTF-8", bom:false,
    empty:false, uncertain:false, sampled:false
  }, refresh);
}

function updateOriginalSaveBadge(doc){
  const badge = byId("originalSaveBadge");
  if (!badge) return;
  badge.hidden = !(doc && doc.originalSaveMode);
  badge.title = doc && doc.originalSaveMode
    ? "저장을 누르면 선택한 폴더의 원본 파일을 바로 덮어씁니다."
    : "";
}

async function inspectTextFileEncoding(file, ext){
  if (!file || !TEXT_ENCODING_EXTS.has(String(ext || "").toLowerCase())) return null;
  try {
    const cap = 4 * 1024 * 1024;
    const sampled = file.size > cap;
    const blob = sampled ? file.slice(0, cap) : file;
    const info = detectTextEncoding(new Uint8Array(await blob.arrayBuffer()), { truncated:sampled });
    return { ...info, sampled };
  } catch(e){
    console.warn("text encoding detection skipped:", file.name, e);
    return null;
  }
}

function modeBadgeText(doc){
  if (!doc) return "";
  if (studyPdfId !== null){
    if (doc.id === studyPdfId) return studyReferenceLocked ? "읽기 전용 참고 문서" : "참고 문서";
    if (doc.id === activeId) return "분할 작업";
  }
  const ext = documentExtension(doc).toLowerCase();
  if (doc.kind === "pdf") return "PDF 편집";
  if (doc.kind === "board") return "화이트보드";
  if (doc.kind === "replay") return "수업 리플레이";
  if (doc.kind === "image-gallery") return "이미지 모아보기";
  if (doc.kind === "pdf-gallery") return "PDF 모아보기";
  if (ext === ".py" || ext === ".pyw") return "Python 실습";
  if (doc.kind === "image") return "이미지 보기";
  if (doc.kind === "video") return doc.media === "audio" ? "오디오 재생" : "영상 재생";
  if (ext === ".docx") return "Word 보기";
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") return "표 보기";
  if (SQLITE_EXTS.includes(ext.replace(/^\./, ""))) return "SQLite 보기";
  if (ext === ".pptx") return "PowerPoint 보기";
  if (ext === ".hwp" || ext === ".hwpx") return "HWP 보기";
  if (ext === ".md" || ext === ".markdown" || ext === ".mdx") return "Markdown 보기";
  if (ext in CODE_EXTS) return "코드 보기";
  return "문서 보기";
}

function updateModeBadges(){
  const mode = byId("activeModeBadge"), pair = byId("studyPairBadge");
  if (!mode || !pair) return;
  const doc = docs.find(d => d.id === activeId);
  if (!doc){
    mode.hidden = true; pair.hidden = true; return;
  }
  const text = modeBadgeText(doc);
  const shown = (typeof window.t === "function") ? window.t(text) : text;
  mode.textContent = shown;
  mode.title = window.tf("현재 화면: {mode}", { mode: shown });
  mode.hidden = !text;
  const ref = docs.find(d => d.id === studyPdfId);
  const work = docs.find(d => d.id === activeId && (!ref || d.id !== ref.id));
  if (ref && work){
    const label = window.tf("참조: {ref} · 작업: {work}", { ref: ref.name, work: work.name });
    pair.textContent = label;
    pair.title = label;
    pair.hidden = false;
  } else {
    pair.hidden = true;
  }
}

function closeDoc(id, options={}){
  const i = docs.findIndex(d => d.id === id);
  if (i < 0) return;
  const d = docs[i];
  if (!options.skipConfirm && d.hasUnsavedEdits){
    if (!confirm(`'${d.name}'의 저장하지 않은 코드 수정이 있습니다. 닫을까요?`)) return;
  }
  if (!options.skipConfirm && d.kind === "pdf" && d.elements && d.elements.length){
    if (!confirm(`'${d.name}'의 편집 화면을 닫을까요? 편집 내용은 다음에 같은 PDF를 열 때 복원할 수 있습니다.`)) return;
  }
  if (d.kind === "pdf"){
    clearTimeout(d.recoveryTimer);
    clearTimeout(d.pdfHistoryTimer);
    if (d.recoveryDirty) savePdfRecovery(d);
  }
  d.closed = true;
  // 사용자가 직접 닫은(내부 이동/일괄 닫기가 아닌) 파일만 복원 스택에 쌓는다(Ctrl+Shift+T).
  if (!options.skipUi && d.__reopen && d.__reopen.file){
    closedDocStack.push(d.__reopen);
    if (closedDocStack.length > 12) closedDocStack.shift();
  }
  if (d.sourceKey && docsBySourceKey.get(d.sourceKey) === d) docsBySourceKey.delete(d.sourceKey);
  contentTextCache.delete(id);                 // 내용 검색 캐시 정리
  contentLowerCache.delete(id);
  contentMatchSnippets.delete(id);
  evictContentSearchDoc(id);                    // 워커 쪽 디코딩 캐시도 정리
  if (studyPdfId === id) studyPdfId = null;
  if (d.io){ d.io.disconnect(); d.io = null; }                  // 지연 렌더 옵저버 해제
  if (d.pdfjsDoc && d.pdfjsDoc.destroy){ try { d.pdfjsDoc.destroy(); } catch(e){} d.pdfjsDoc = null; }
  if (d.__fontFaces){ d.__fontFaces.forEach(ff => { try { document.fonts.delete(ff); } catch(e){} }); d.__fontFaces = null; }  // PPTX 내장 글꼴 해제
  if (d.cleanupFns){
    d.cleanupFns.splice(0).forEach(fn => { try { fn(); } catch(e){} });
    d.cleanupFns = null;
  }
  d.el.remove();
  docs.splice(i, 1);
  const ni = navNodes.findIndex(n => n.nodeId === d.nodeId);
  if (ni >= 0) navNodes.splice(ni, 1);
  const forgottenPaths = d.workspacePath ? [d.workspacePath] : [];
  if (options.forgetWorkspace && !options.skipPrune){
    let parentId = d.parentId;
    while (parentId){
      const groupIndex = navNodes.findIndex(n => n.nodeId === parentId && n.type === "group");
      if (groupIndex < 0 || navNodes.some(n => n.parentId === parentId)) break;
      const group = navNodes[groupIndex];
      const refreshRoot = navNodes.find(n =>
        n.nodeId === group.folderRefreshRootId &&
        n.type === "group" &&
        n.folderRefreshRootId === n.nodeId
      );
      const physicalFolder = refreshRoot &&
        (refreshRoot.folderPaths || []).map(normalizedRunPath).includes(groupStablePath(group));
      if (physicalFolder) break;
      if (group.workspacePaths) forgottenPaths.push(...group.workspacePaths);
      parentId = group.parentId;
      navNodes.splice(groupIndex, 1);
    }
  }
  bumpNavTree();                          // 노드 삭제 → 인덱스/루트 캐시 무효화(아래 setActiveDoc 가 갱신본을 본다)
  activeMru = activeMru.filter(x => x !== id);   // 닫힌 문서는 활성화 이력에서도 제거
  if (activeId === id){
    if (options.skipUi){ activeId=0; state=null; viewer=null; }
    else if (docs.length){
      // 직전에 보던 문서로 돌아간다(VSCode 패턴). 이력에 살아있는 게 없으면 docs 순서 기준 옆 문서로 폴백.
      const prevId = activeMru.find(x => docs.some(d => d.id === x));
      setActiveDoc(prevId != null ? prevId : docs[Math.max(0, Math.min(i, docs.length - 1))].id);
    }
    else { activeId=0; state=null; viewer=null; byId("tools").hidden=true; byId("officeTools").hidden=true; }
  }
  if (!options.skipUi){
    refreshChrome();
    applyStudyLayout();
    renderSidebar();
  }
  if (options.forgetWorkspace && forgottenPaths.length) forgetWorkspacePaths(forgottenPaths, navNodes.length === 0);
}

function withFileHandle(file, handle){
  if (!file || !handle) return file;
  try { Object.defineProperty(file, "__fsHandle", { value: handle, configurable: true }); } catch(e){}
  return file;
}
// 파일이 속한 폴더 핸들도 함께 보관 — 변환된 노트북(.ipynb→.py)을 원본을 건드리지 않고 같은 폴더에 새 .py 로 저장할 때 쓴다.
function withDirHandle(file, dirHandle){
  if (!file || !dirHandle) return file;
  try { Object.defineProperty(file, "__fsDirHandle", { value: dirHandle, configurable: true }); } catch(e){}
  return file;
}
// doc.sourceFile 을 바이트로 읽는다. 폴더에서 온 File 은 File System Access 스냅샷이라, 내용 검색 등으로 한 번 읽힌 뒤
// 다시 읽을 때 NotReadableError 로 실패할 수 있다. 그럴 땐 보관해둔 원본 핸들(__fsHandle)로 File 을 다시 떠서 재시도하고,
// 성공한 새 스냅샷을 doc.sourceFile 에 반영해 이후 읽기(실행 번들 등)도 어긋나지 않게 한다.
async function readDocSourceBytes(doc){
  const file = doc && doc.sourceFile;
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("no-source-file");
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch(e){
    const handle = file.__fsHandle;
    if (handle && typeof handle.getFile === "function"){
      const fresh = withDirHandle(withFileHandle(await handle.getFile(), handle), file.__fsDirHandle || null);
      doc.sourceFile = fresh;
      contentTextCache.delete(doc.id); contentLowerCache.delete(doc.id);   // 갱신된 스냅샷 기준으로 검색 캐시도 무효화
      return new Uint8Array(await fresh.arrayBuffer());
    }
    throw e;
  }
}
function refreshWorkspacePath(oldPath, fileName){
  const path = String(oldPath || "").replace(/\\/g, "/");
  if (!path || !fileName) return fileName || path || null;
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash + 1) + fileName : fileName;
}
async function getDocRefreshHandle(doc){
  if (!doc) return null;
  if (doc.fsHandle && typeof doc.fsHandle.getFile === "function") return doc.fsHandle;
  if (doc.workspacePath && typeof loadFsHandle === "function"){
    try {
      const handle = await loadFsHandle(doc.workspacePath);
      if (handle && typeof handle.getFile === "function"){
        doc.fsHandle = handle;
        return handle;
      }
    } catch(e){}
  }
  return null;
}
async function ensureReadPermission(handle){
  if (!handle) return false;
  try {
    if (typeof handle.queryPermission === "function"){
      const current = await handle.queryPermission({ mode: "read" });
      if (current === "granted") return true;
    }
    if (typeof handle.requestPermission === "function"){
      return await handle.requestPermission({ mode: "read" }) === "granted";
    }
    return true;
  } catch(e){
    return false;
  }
}
async function pickRefreshReplacement(doc){
  if (typeof window === "undefined" || typeof window.showOpenFilePicker !== "function") return null;
  const ok = await confirmDialog(
    "'" + doc.name + "' 원본 파일 권한을 다시 확인할 수 없어요. 이름을 바꿨거나 다른 방식으로 열었다면 새 파일을 다시 선택해 주세요.",
    "파일 선택",
    "취소"
  );
  if (!ok) return null;
  try {
    const handles = await window.showOpenFilePicker({ multiple: false });
    const handle = handles && handles[0];
    if (!handle) return null;
    return { handle, file: withFileHandle(await handle.getFile(), handle) };
  } catch(e){
    if (!(e && e.name === "AbortError")) console.warn(e);
    return null;
  }
}
async function refreshDocFromSource(id){
  const doc = docs.find(d => d.id === id);
  if (!doc) return;
  let picked = null;
  let handle = await getDocRefreshHandle(doc);
  if (!handle){
    picked = await pickRefreshReplacement(doc);
    if (!picked){
      toast("이 파일은 원본을 다시 읽을 권한이 없어요. 파일 선택으로 다시 연결해 주세요.", 3600);
      return;
    }
    handle = picked.handle;
  }
  if (!(await ensureReadPermission(handle))){
    picked = await pickRefreshReplacement(doc);
    if (!picked){
      toast("원본 파일 읽기 권한이 필요해요.", 2800);
      return;
    }
    handle = picked.handle;
  }
  if (doc.hasUnsavedEdits){
    const ok = await confirmDialog("저장하지 않은 코드 수정이 있습니다. 원본으로 새로고침하면 현재 편집 내용이 사라질 수 있어요.", "새로고침", "취소");
    if (!ok) return;
  }
  if (doc.kind === "pdf" && doc.elements && doc.elements.length){
    const ok = await confirmDialog("PDF에 추가한 편집/핀을 버리고 원본 파일을 다시 읽을까요?", "새로고침", "취소");
    if (!ok) return;
    if (doc.recoveryKey && typeof deletePdfRecovery === "function") await deletePdfRecovery(doc.recoveryKey);
    doc.recoveryDirty = false;
  }
  const oldId = doc.id;
  const oldNodeId = doc.nodeId;
  const oldNodeIndex = navNodes.findIndex(n => n.nodeId === oldNodeId);
  const oldTabIndex = tabOrder.indexOf(oldId);
  const parentId = doc.parentId || null;
  const wasActive = activeId === oldId;
  const wasStudy = studyPdfId === oldId;
  const oldPath = doc.workspacePath || null;
  let file;
  try { file = picked ? picked.file : withFileHandle(await handle.getFile(), handle); }
  catch(e){
    picked = await pickRefreshReplacement(doc);
    if (!picked){ toast("원본 파일을 다시 읽지 못했어요.", 3000); return; }
    handle = picked.handle;
    file = picked.file;
  }
  const newPath = refreshWorkspacePath(oldPath, file.name);
  const sourceKey = [parentId || "root", newPath || file.name, file.size || 0, file.lastModified || 0].join("|");
  const beforeIds = new Set(docs.map(d => d.id));
  closeDoc(oldId, { skipConfirm: true, skipPrune: true, skipUi: true });
  try {
    await handleFiles([file], { parentId, bulk: true, workspacePath: newPath, sourceKey, fsHandle: handle,
      isScratch: doc.isScratch, originalSaveMode: doc.originalSaveMode });
  } catch(e){
    console.error(e);
    refreshChrome(); renderSidebar();
    toast("새로고침 중 오류가 났어요.", 3000);
    return;
  }
  const next = docs.find(d => !beforeIds.has(d.id));
  if (!next){
    refreshChrome(); renderSidebar();
    return;
  }
  next.fsHandle = handle;
  if (typeof saveFsHandle === "function" && next.workspacePath) saveFsHandle(next.workspacePath, handle);
  if (typeof forgetFsHandle === "function" && oldPath && oldPath !== next.workspacePath) forgetFsHandle(oldPath);
  const nextNodeIndex = navNodes.findIndex(n => n.nodeId === next.nodeId);
  if (oldNodeIndex >= 0 && nextNodeIndex >= 0 && nextNodeIndex !== oldNodeIndex){
    const [node] = navNodes.splice(nextNodeIndex, 1);
    navNodes.splice(Math.min(oldNodeIndex, navNodes.length), 0, node);
    bumpNavTree();
  }
  tabOrder = tabOrder.filter(x => x !== oldId && x !== next.id);
  if (oldTabIndex >= 0) tabOrder.splice(Math.min(oldTabIndex, tabOrder.length), 0, next.id);
  if (wasStudy) studyPdfId = next.id;
  if (wasActive) setActiveDoc(next.id);
  else { refreshChrome(); renderSidebar(); renderTabs(); }
  toast("원본 파일에서 새로고침했어요.", 1800);
}

let draggedTabId = null;
function clearTabDropMarkers(){
  const bar = byId("tabBar");
  if (bar) bar.querySelectorAll(".tab").forEach(tab => tab.classList.remove("dragging", "drop-before", "drop-after"));
}
function moveTab(draggedId, targetId, after){
  if (draggedId === targetId) return;
  const from = tabOrder.indexOf(draggedId);
  if (from < 0 || tabOrder.indexOf(targetId) < 0) return;
  tabOrder.splice(from, 1);
  const target = tabOrder.indexOf(targetId);
  tabOrder.splice(target + (after ? 1 : 0), 0, draggedId);
  renderTabs();
}
let tabLayoutLimit = 0;
let tabBarResizeObserver = null;
function tabLimitForWidth(width){
  const usable = Math.max(210, (width || window.innerWidth || 800) - 82);
  return Math.max(1, Math.min(6, Math.floor(usable / 210)));
}

// 헤더 아래 탭바: tabOrder(선택한 문서 순서) 중 현재 열려있는 것만, 2개 이상일 때 표시
function renderTabs(){
  if (typeof closeTabMenu === "function") closeTabMenu();          // 다시 그릴 때 떠 있던 우클릭 메뉴 정리
  tabOrder = tabOrder.filter(id => docs.some(d => d.id === id));   // 닫힌 문서 정리
  // 화면에 보이는 문서는 반드시 탭에도 있어야 한다. 복원/일괄 열기 중 순서가 꼬여도 여기서 보정한다.
  if (activeId && docs.some(d => d.id === activeId) && !tabOrder.includes(activeId)) tabOrder.unshift(activeId);
  persistTabState();                                               // 탭 구성을 저장해 다음 실행 때 복원
  const bar = byId("tabBar");
  if (!bar) return;
  if (tabOrder.length < 2){ bar.hidden = true; bar.innerHTML = ""; return; }   // 1개 이하면 숨겨 공간 절약
  bar.hidden = false;
  bar.innerHTML = "";
  tabLayoutLimit = tabLimitForWidth(bar.clientWidth);
  if (!tabBarResizeObserver && typeof ResizeObserver !== "undefined"){
    tabBarResizeObserver = new ResizeObserver(entries => {
      const width = entries[0] && entries[0].contentRect.width;
      const next = tabLimitForWidth(width);
      if (next !== tabLayoutLimit){ tabLayoutLimit = next; renderTabs(); }
    });
    tabBarResizeObserver.observe(bar);
  }
  const visibleCount = Math.min(tabLayoutLimit, tabOrder.length);
  const activeIndex = Math.max(0, tabOrder.indexOf(activeId));
  const start = Math.max(0, Math.min(tabOrder.length - visibleCount, activeIndex - Math.floor(visibleCount / 2)));
  const visibleIds = tabOrder.slice(start, start + visibleCount);
  const visibleSet = new Set(visibleIds);
  const hiddenIds = tabOrder.filter(id => !visibleSet.has(id));
  visibleIds.forEach(id => {
    const d = docs.find(x => x.id === id);
    if (!d) return;
    const tab = document.createElement("div");
    tab.className = "tab" + (id === activeId ? " active" : "") + (studyPdfId !== null && id === studyPdfId && id !== activeId ? " study-ref" : "");   // 분할 참고 문서 표시
    tab.draggable = true;
    const cat = extCategory(d.kind, d.name);
    if (cat) tab.dataset.cat = cat;
    tab.title = d.name + (d.textEncoding ? " · 인코딩: " + d.textEncoding.label : "") +
      " · 드래그: 위치 변경 · 우클릭: 탭 정리";
    tab.onclick = () => openDocInTargetPane(d.id);   // 분할 화면이면 마지막 클릭 칸에 열기
    tab.addEventListener("contextmenu", (e) => { e.preventDefault(); openTabMenu(id, e.clientX, e.clientY); });
    tab.addEventListener("dragstart", (e) => {
      draggedTabId = id;
      tab.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(id));
    });
    tab.addEventListener("dragover", (e) => {
      if (draggedTabId === null || draggedTabId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      tab.classList.toggle("drop-before", !after);
      tab.classList.toggle("drop-after", after);
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("drop-before", "drop-after"));
    tab.addEventListener("drop", (e) => {
      if (draggedTabId === null || draggedTabId === id) return;
      e.preventDefault(); e.stopPropagation();
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      const movedId = draggedTabId;
      draggedTabId = null;
      clearTabDropMarkers();
      moveTab(movedId, id, after);
    });
    tab.addEventListener("dragend", () => { draggedTabId = null; clearTabDropMarkers(); });
    const ic = document.createElement("span"); ic.className = "tab-ic"; ic.textContent = iconFor(d.kind, d.name);
    const nm = document.createElement("span"); nm.className = "tab-name"; nm.textContent = d.name;
    const x = document.createElement("button"); x.className = "tab-x"; x.textContent = "✕";
    x.title = id === studyPdfId ? "탭 닫기 및 분할 작업 종료(파일은 사이드바에 유지)" : "탭만 닫기(파일은 사이드바에 유지)";
    x.onclick = (e) => { e.stopPropagation(); untabDoc(d.id); };
    tab.append(ic, nm, x);
    bar.appendChild(tab);
  });
  if (hiddenIds.length){
    const wrap = document.createElement("div"); wrap.className = "tab-overflow";
    const more = document.createElement("button"); more.type = "button"; more.className = "tab-more";
    more.textContent = "+" + hiddenIds.length; more.title = "숨겨진 탭 " + hiddenIds.length + "개";
    const menu = document.createElement("div"); menu.className = "tab-overflow-menu"; menu.hidden = true;
    const search = document.createElement("input"); search.type = "search"; search.placeholder = "숨겨진 탭 검색";
    search.setAttribute("aria-label", "숨겨진 탭 검색");
    const list = document.createElement("div"); list.className = "tab-overflow-list";
    const fill = () => {
      const query = search.value.trim().toLocaleLowerCase(); list.innerHTML = "";
      let count = 0;
      hiddenIds.forEach(id => {
        const doc = docs.find(d => d.id === id);
        if (!doc || (query && !doc.name.toLocaleLowerCase().includes(query))) return;
        const item = document.createElement("button"); item.type = "button"; item.className = "tab-overflow-item";
        const badge = document.createElement("span"); badge.className = "tab-ic"; badge.textContent = iconFor(doc.kind, doc.name);
        const name = document.createElement("span"); name.textContent = doc.name;
        item.append(badge, name); item.onclick = () => openDocInTargetPane(id); list.appendChild(item); count++;
      });
      if (!count){ const empty = document.createElement("div"); empty.className = "tab-overflow-empty"; empty.textContent = "일치하는 탭이 없습니다."; list.appendChild(empty); }
    };
    search.addEventListener("input", fill);
    search.addEventListener("keydown", e => { if (e.key === "Escape"){ menu.hidden = true; more.focus(); } });
    menu.addEventListener("click", e => e.stopPropagation());
    more.addEventListener("click", e => {
      e.stopPropagation(); menu.hidden = !menu.hidden;
      if (!menu.hidden){ fill(); setTimeout(() => search.focus(), 0); document.addEventListener("click", () => { menu.hidden = true; }, { once:true }); }
    });
    menu.append(search, list); wrap.append(more, menu); bar.appendChild(wrap);
  }
}

// 탭 × : 탭바에서만 제거(파일은 닫지 않음). 활성 탭을 닫으면 옆 탭으로 이동.
function untabDoc(id){
  const i = tabOrder.indexOf(id);
  if (i < 0) return;
  if (id === studyPdfId) toggleStudyMode();
  tabOrder.splice(i, 1);
  if (id === activeId && tabOrder.length){
    // 직전에 보던 문서로 돌아간다(closeDoc 과 같은 VSCode 패턴). Ctrl+클릭 정의 이동으로 연 탭을
    // 닫으면 원래 편집하던 화면으로 복귀. 이력에 탭으로 살아있는 게 없으면 옆 탭으로 폴백.
    const prevId = activeMru.find(x => x !== id && tabOrder.includes(x));
    setActiveDoc(prevId != null ? prevId : tabOrder[Math.min(i, tabOrder.length - 1)]);
  }
  else renderTabs();
}

// 여러 탭을 한 번에 탭바에서 정리(파일은 닫지 않고 사이드바에 유지). anchorId 는 항상 남긴다.
function untabMany(removeIds, anchorId){
  const removeSet = new Set(removeIds);
  removeSet.delete(anchorId);                                  // 기준(우클릭한) 탭은 보존
  if (!tabOrder.some(id => removeSet.has(id))) return;
  if (studyPdfId !== null && removeSet.has(studyPdfId)) toggleStudyMode();   // 고정 PDF가 닫히면 학습 화면 먼저 종료
  const activeRemoved = removeSet.has(activeId);
  tabOrder = tabOrder.filter(id => !removeSet.has(id));
  if (activeRemoved) setActiveDoc(anchorId);                  // 닫힌 탭이 활성이었으면 기준 탭으로 이동(내부에서 renderTabs)
  else renderTabs();
}

// 탭 우클릭 메뉴: IDE 처럼 오른쪽/왼쪽/다른 탭을 한 번에 정리(모두 "탭만 닫기" — 파일은 사이드바에 유지)
let tabMenuEl = null;
function closeTabMenu(){
  if (!tabMenuEl) return;
  tabMenuEl.remove(); tabMenuEl = null;
  document.removeEventListener("keydown", onTabMenuKey, true);
  document.removeEventListener("click", onTabMenuDocClick, true);
}
function onTabMenuKey(e){ if (e.key === "Escape"){ e.stopPropagation(); closeTabMenu(); } }
function onTabMenuDocClick(e){ if (!(tabMenuEl && tabMenuEl.contains(e.target))) closeTabMenu(); }   // 메뉴 안 클릭은 항목 버튼이 처리
function openTabMenu(anchorId, x, y){
  closeSidebarGroupMenu();
  closeTabMenu();
  const idx = tabOrder.indexOf(anchorId);
  if (idx < 0) return;
  const right = tabOrder.slice(idx + 1), left = tabOrder.slice(0, idx);
  const others = tabOrder.filter(id => id !== anchorId);
  const menu = document.createElement("div");
  menu.className = "tab-ctx-menu"; menu.setAttribute("role", "menu");
  const add = (label, count, run) => {
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem");
    const t = document.createElement("span"); t.textContent = label; b.appendChild(t);
    if (typeof count === "number"){
      const c = document.createElement("span"); c.className = "tcx-count"; c.textContent = count + "개"; b.appendChild(c);
      b.disabled = count === 0;
    }
    b.onclick = () => { closeTabMenu(); run(); };
    menu.appendChild(b);
  };
  add("이 탭 닫기", null, () => untabDoc(anchorId));
  const sep = document.createElement("div"); sep.className = "tcx-sep"; menu.appendChild(sep);
  add("오른쪽 탭 닫기", right.length, () => untabMany(right, anchorId));
  add("왼쪽 탭 닫기", left.length, () => untabMany(left, anchorId));
  add("다른 탭 모두 닫기", others.length, () => untabMany(others, anchorId));
  document.body.appendChild(menu);
  const pad = 8, mw = menu.offsetWidth, mh = menu.offsetHeight;     // 화면 밖으로 넘치지 않게 보정
  menu.style.left = Math.max(pad, Math.min(x, window.innerWidth - mw - pad)) + "px";
  menu.style.top  = Math.max(pad, Math.min(y, window.innerHeight - mh - pad)) + "px";
  tabMenuEl = menu;
  setTimeout(() => document.addEventListener("click", onTabMenuDocClick, true), 0);   // 바깥 클릭 시 닫기(여는 클릭은 제외)
  document.addEventListener("keydown", onTabMenuKey, true);
}

// 업로드한 일반 폴더 우클릭 메뉴. ZIP/TAR 그룹에는 newPythonContext 를 넣지 않아 표시되지 않는다.
let sidebarGroupMenuEl = null;
function closeSidebarGroupMenu(){
  if (!sidebarGroupMenuEl) return;
  sidebarGroupMenuEl.remove(); sidebarGroupMenuEl = null;
  document.removeEventListener("keydown", onSidebarGroupMenuKey, true);
  document.removeEventListener("click", onSidebarGroupMenuDocClick, true);
}
function onSidebarGroupMenuKey(e){
  if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); closeSidebarGroupMenu(); }
}
function onSidebarGroupMenuDocClick(e){
  if (!(sidebarGroupMenuEl && sidebarGroupMenuEl.contains(e.target))) closeSidebarGroupMenu();
}
function openSidebarGroupMenu(node, x, y){
  closeTabMenu();
  closeSidebarGroupMenu();
  if (!node || node.type !== "group" || !node.newPythonContext) return;
  const menu = document.createElement("div");
  menu.className = "tab-ctx-menu"; menu.setAttribute("role", "menu");
  const add = (label, run, disabled=false) => {
    const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "menuitem");
    const text = document.createElement("span"); text.textContent = label; button.appendChild(text); button.disabled = !!disabled;
    button.addEventListener("click", () => { closeSidebarGroupMenu(); run(); });
    menu.appendChild(button);
  };
  add("+Py  새 Python 코드", () => {
    if (typeof newPythonScratchInFolder === "function") newPythonScratchInFolder(node.newPythonContext);
  });
  add("+Nb  새 노트북", () => {
    if (typeof newNotebookScratchInFolder === "function") newNotebookScratchInFolder(node.newPythonContext);
  });
  if (node.folderRefreshRootId && typeof imageGalleryFolderImageCount === "function" && typeof openFolderImageGallery === "function"){
    const directCount = imageGalleryFolderImageCount(node, false);
    const nestedCount = imageGalleryFolderImageCount(node, true);
    add("▦ 이미지 모아보기 — 이 폴더만 (" + directCount + "개)", () => openFolderImageGallery(node, false), directCount === 0);
    add("▦ 이미지 모아보기 — 하위 폴더 포함 (" + nestedCount + "개)", () => openFolderImageGallery(node, true), nestedCount === 0);
  }
  if (node.folderRefreshRootId && typeof pdfGalleryFolderPdfCount === "function" && typeof openFolderPdfGallery === "function"){
    const directCount = pdfGalleryFolderPdfCount(node, false);
    const nestedCount = pdfGalleryFolderPdfCount(node, true);
    add("▦ PDF 모아보기 — 이 폴더만 (" + directCount + "개)", () => openFolderPdfGallery(node, false), directCount === 0);
    add("▦ PDF 모아보기 — 하위 폴더 포함 (" + nestedCount + "개)", () => openFolderPdfGallery(node, true), nestedCount === 0);
  }
  if (node.folderRefreshRootId){
    add("↻  폴더 새로고침", () => requestFolderRefresh(node.folderRefreshRootId));
    // 브라우저 재생이 막히는 형식(MKV 등)이 있으면 한꺼번에 MP4로 변환(ffmpeg — 자세한 안내는 영상 탭)
    const videoTargets = (typeof vvFolderVideoTargets === "function") ? vvFolderVideoTargets(node.folderRefreshRootId) : [];
    if (videoTargets.length){
      add("▶  영상 일괄 MP4 변환 (" + videoTargets.length + "개)", () => vvBatchConvertFolder(node.folderRefreshRootId));
    }
  }
  const sep = document.createElement("div"); sep.className = "tcx-sep"; menu.appendChild(sep);
  add(node.expanded ? "폴더 접기" : "폴더 펼치기", () => { node.expanded = !node.expanded; renderSidebar(); });
  document.body.appendChild(menu);
  const pad = 8, mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(pad, Math.min(x, window.innerWidth - mw - pad)) + "px";
  menu.style.top = Math.max(pad, Math.min(y, window.innerHeight - mh - pad)) + "px";
  sidebarGroupMenuEl = menu;
  setTimeout(() => document.addEventListener("click", onSidebarGroupMenuDocClick, true), 0);
  document.addEventListener("keydown", onSidebarGroupMenuKey, true);
  const first = menu.querySelector("button");
  if (first) first.focus();
}

/* ===== 탭 구성 저장/복원 (EXE 자동 복원과 함께 다음 실행 때 탭바 되살리기) ===== */
// 세션이 바뀌어도 같은 파일을 가리키는 안정 키: 루트 그룹→…→파일명 경로(생성 ID가 아닌 이름 기반)
function docStableKey(doc){
  if (!doc) return "";
  const parts = [doc.name];
  let pid = doc.parentId;
  while (pid != null){
    const parent = navNodes.find(n => n.nodeId === pid);
    if (!parent) break;
    parts.unshift(parent.name || "");
    pid = parent.parentId;
  }
  return parts.join("/");
}
const TAB_STATE_KEY = "pdf-signer-tabs:v1";
let tabRestoreInProgress = false;
let tabStateTimer = 0;
function persistTabState(){       // 탭 순서·활성 탭을 디바운스 저장(복원 중에는 건너뜀)
  clearTimeout(tabStateTimer);
  tabStateTimer = setTimeout(() => {
    if (tabRestoreInProgress) return;
    if (window.__tabActive === false) return;        // 비활성(다른 창이 활성) 탭은 저장하지 않음 — 충돌 방지
    try {
      const tabs = tabOrder.map(id => docStableKey(docs.find(d => d.id === id))).filter(Boolean);
      const active = docStableKey(docs.find(d => d.id === activeId));
      const reference = docs.find(d => d.id === studyPdfId);
      const work = docs.find(d => d.id === activeId);
      // ID is recreated at each launch, so persist stable document paths instead.
      const study = reference && work && reference.id !== work.id
        ? {
            reference: docStableKey(reference),
            work: docStableKey(work),
            locked: !!studyReferenceLocked,
            targetPane: studyTargetPane === "reference" ? "reference" : "work"
          }
        : null;
      localStorage.setItem(TAB_STATE_KEY, JSON.stringify({ tabs, active, study, savedAt: Date.now() }));
    } catch(e){}
  }, 400);
}
function loadSavedTabState(){
  try { const s = JSON.parse(localStorage.getItem(TAB_STATE_KEY) || "null");
        return (s && Array.isArray(s.tabs)) ? s : null; }
  catch(e){ return null; }
}
// 복원으로 파일이 모두 열린 뒤, 저장된 탭 순서·활성 탭을 안정 키로 매칭해 되살린다(매칭 안 되는 항목은 무시).
function applyTabState(saved){
  if (!saved || !Array.isArray(saved.tabs) || saved.tabs.length < 2) return;
  const keyToId = new Map();
  docs.forEach(d => { const k = docStableKey(d); if (k && !keyToId.has(k)) keyToId.set(k, d.id); });
  const restored = [], seen = new Set();
  saved.tabs.forEach(k => { const id = keyToId.get(k); if (id != null && !seen.has(id)){ seen.add(id); restored.push(id); } });
  if (restored.length < 2) return;     // 두 개 이상 되살릴 수 있을 때만 탭바를 복원
  tabOrder = restored;
  const wantActive = keyToId.get(saved.active);
  setActiveDoc(seen.has(wantActive) ? wantActive : restored[0]);
}

// Reconnect the split pair after all workspace files have been restored.
// Older saved states have no study field and continue to restore as a normal view.
function restoreStudyState(saved){
  const study = saved && saved.study;
  if (!study || typeof study !== "object") return false;
  const referenceKey = String(study.reference || "");
  const workKey = String(study.work || "");
  if (!referenceKey || !workKey || referenceKey === workKey) return false;
  const keyToDoc = new Map();
  docs.forEach(d => {
    const key = docStableKey(d);
    if (key && !keyToDoc.has(key)) keyToDoc.set(key, d);
  });
  const reference = keyToDoc.get(referenceKey);
  const work = keyToDoc.get(workKey);
  if (!reference || !work || reference.id === work.id) return false;

  // The active document is always the work pane. tabRestoreInProgress prevents a resave here.
  if (activeId !== work.id) setActiveDoc(work.id);
  studyPdfId = reference.id;
  studyReferenceLocked = !!study.locked;
  studyTargetPane = study.targetPane === "reference" ? "reference" : "work";
  if (reference.kind === "pdf" && reference._preStudyZoom == null) reference._preStudyZoom = reference.zoom;
  applyStudyLayout();
  renderTabs();
  // 복원 직후 참고 문서는 활성 문서가 아니므로, PDF뿐 아니라 모든 형식을 명시적으로 첫 렌더한다.
  ensureRendered(reference).then(() => {
    if (reference.id === studyPdfId && reference.kind === "pdf"){
      startLazyRender(reference); requestAnimationFrame(() => fitStudyPdf(reference));
    }
  });
  return true;
}

function iconFor(kind, name){
  if (kind === "folder") return "DIR";
  if (kind === "zip") return "ZIP";
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "IMG";
  if (kind === "image-gallery") return "▦";
  if (kind === "pdf-gallery") return "▦";
  if (kind === "video") return AUDIO_EXTS.includes(fileExtOf(name)) ? "AUD" : "VID";
  if (kind === "board") return "칠판";
  if (kind === "replay") return "▶";
  const ext = fileExtOf(name);
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "MD";
  if (ext === "docx") return "DOC";
  if (ext === "pptx") return "PPT";
  if (ext === "hwp" || ext === "hwpx") return "한";
  return (ext || "?").slice(0, 4).toUpperCase();
}

// 배지 색 분류: iconFor 와 같은 (kind, name) 으로 호출 — 종류별 색조 키를 돌려준다(없으면 "" → 기본 회색)
function extCategory(kind, name){
  if (kind === "folder") return "dir";
  if (kind === "zip")    return "zip";
  if (kind === "pdf")    return "pdf";
  if (kind === "image")  return "img";
  if (kind === "image-gallery") return "img";
  if (kind === "pdf-gallery") return "pdf";
  if (kind === "video")  return "media";
  const ext = fileExtOf(name);
  if (ext === "docx") return "word";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "sheet";
  if (SQLITE_EXTS.includes(ext)) return "db";
  if (ext === "pptx") return "ppt";
  if (ext === "hwp" || ext === "hwpx") return "hwp";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "md";
  if (ext === "html" || ext === "htm" || ext === "xhtml") return "html";
  if (ext === "py") return "py";
  if (ext === "zip" || ext === "tar" || ext === "gz" || ext === "tgz") return "zip";
  if (IMG_EXTS.includes(ext)) return "img";
  if (ext in CODE_EXTS) return "code";
  return "";
}

let sidebarExtFilter = "";

/* ===== 파일명 + 내용 자동 검색(텍스트·코드 한정, 비동기·디바운스·캐시) ===== */
let contentMatchIds = new Set();             // 현재 질의에 내용이 일치하는 docId
let contentMatchSnippets = new Map();         // docId -> { line, text } 첫 일치 미리보기
let contentMatchQuery = "";                  // contentMatchIds 가 대응하는 질의(불일치하면 무시 → 오래된 결과 방지)
const contentTextCache = new Map();          // docId -> 원본 텍스트(또는 false=스킵)
const contentLowerCache = new Map();         // docId -> 소문자 텍스트(검색 반복 시 통째 소문자 변환 비용 제거)
let contentSearchToken = 0;                  // 진행 중 검색 취소용
let contentSearchTimer = 0;
const CONTENT_SEARCH_MAX_BYTES = 4 * 1024 * 1024;          // 이하: 메인 스레드에서 즉시 검색
const CONTENT_SEARCH_WORKER_MAX_BYTES = 128 * 1024 * 1024; // 여기까지: 대형 텍스트는 워커에서 검색
const PDF_SEARCH_MAX_PAGES = 500;                   // 텍스트 추출 페이지 상한(초대용량 보호)
const PDF_SEARCH_MAX_CHARS = 1500000;               // 추출 누적 글자 상한
const TEXT_SEARCH_EXTS = new Set(["txt","text","log","md","markdown","mdx","csv","tsv","json","xml",
  "yaml","yml","html","htm","xhtml","ini","cfg","conf","env","sql","srt","vtt","smi"]);
// 확장자·종류상 텍스트로 검색할 만한 파일인가(크기는 따지지 않음).
function isTextExtSearchable(doc){
  if (!doc || doc.kind === "pdf" || !doc.sourceFile) return false;
  const lower = String(doc.name || "").toLowerCase();
  const ext = fileExtOf(lower);
  if (ext === lower) return true;                       // 확장자 없는 파일도 텍스트일 수 있음
  return (typeof CODE_EXTS !== "undefined" && ext in CODE_EXTS) || TEXT_SEARCH_EXTS.has(ext);
}
// 메인 스레드 즉시 검색 대상: 소형 텍스트 + (텍스트 기반) PDF.
function isTextSearchable(doc){
  if (!doc) return false;
  if (doc.kind === "pdf") return !!doc.pdfBytes;       // 텍스트 PDF 검색(스캔본은 추출 결과가 비어 자동 제외)
  if ((doc.size || 0) > CONTENT_SEARCH_MAX_BYTES) return false;
  return isTextExtSearchable(doc);
}
// 워커 검색 대상: 메인 스레드 상한을 넘는 대형 텍스트(워커 상한 이하).
function isLargeTextSearchable(doc){
  const size = doc && (doc.size || 0);
  return isTextExtSearchable(doc) && size > CONTENT_SEARCH_MAX_BYTES && size <= CONTENT_SEARCH_WORKER_MAX_BYTES;
}
// 텍스트 기반 PDF의 글자를 페이지 단위로 추출(페이지당 한 줄 → 스니펫 line 번호 = 페이지 번호).
// 아직 안 연 PDF 도 doc.pdfBytes 로 임시 파싱해 검색한다(뷰어 렌더와 독립). 스캔(이미지) PDF 는 false.
async function extractPdfText(doc){
  let pdf = doc.pdfjsDoc, temp = null;
  try {
    if (!pdf){
      if (!doc.pdfBytes || typeof pdfjsLib === "undefined") return false;
      await ensureWorker();
      const data = new Uint8Array(doc.pdfBytes.slice(0));   // 원본 버퍼 detach 방지(복사본 전달)
      pdf = temp = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
    }
    const max = Math.min(pdf.numPages, PDF_SEARCH_MAX_PAGES);
    const parts = [];
    let total = 0;
    for (let i = 1; i <= max; i++){
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const s = tc.items.map(it => (it && it.str) || "").join(" ").replace(/\s+/g, " ").trim();
      parts.push(s); total += s.length;
      if (typeof page.cleanup === "function") page.cleanup();
      if (total > PDF_SEARCH_MAX_CHARS) break;
    }
    const joined = parts.join("\n");
    return joined.replace(/\n/g, "").trim() ? joined : false;   // 글자 없는 스캔본 → false(검색 제외)
  } catch(e){ return false; }
  finally { if (temp && temp.destroy){ try { temp.destroy(); } catch(e){} } }
}
// 검색 결과에서 PDF 의 특정 페이지로 스크롤(지연 렌더라 먼저 렌더 보장 후 프레임으로 이동).
async function scrollPdfToPage(doc, pageNum){
  try { if (typeof ensureRendered === "function") await ensureRendered(doc); } catch(e){}
  const p = doc.pages && doc.pages[pageNum - 1];
  if (p && p.frame && p.frame.scrollIntoView) p.frame.scrollIntoView({ block: "start", behavior: "smooth" });
}
async function getDocText(doc){                          // 한 번 읽어 소문자로 캐시(바이너리/실패는 false)
  if (contentTextCache.has(doc.id)) return contentTextCache.get(doc.id);
  let text = false;
  try {
    if (doc.kind === "pdf"){
      text = await extractPdfText(doc);
      // 스캔본(글자 없음)이라도 글자 인식(OCR)을 해 둔 PDF 면 그 텍스트로 검색한다(줄 번호 = 페이지 번호 규약 동일).
      if (text === false && typeof pdfOcrCachedText === "function"){
        const ocr = await pdfOcrCachedText(doc);
        if (typeof ocr === "string" && ocr.trim()) text = ocr;
      }
    } else {
      const bytes = await readDocSourceBytes(doc);
      let binary = false, lim = Math.min(bytes.length, 8192);
      for (let i = 0; i < lim; i++){ if (bytes[i] === 0){ binary = true; break; } }
      if (!binary) text = smartDecodeText(bytes);
    }
  } catch(e){ text = false; }
  contentTextCache.set(doc.id, text);
  return text;
}
function setContentStatus(text){
  const input = byId("sbSearch");
  if (input) input.setAttribute("aria-busy", String(text === "검색 중…" || text === "…"));
}

// ===== 대형 텍스트 파일 전체검색용 Web Worker =====
// 파일 읽기·디코딩·문자열 검색을 백그라운드 스레드에서 처리해 메인 스레드(타이핑·스크롤)를 멈추지 않는다.
// 이 함수는 .toString() 으로 직렬화돼 Blob 워커가 되므로 바깥 스코프를 절대 참조하면 안 된다(자기완결).
function contentSearchWorkerMain(){
  const cache = new Map();            // docId -> {text, lower, chars}  디코딩 결과 재사용(파일당 1회만 디코딩)
  const order = [];                   // LRU: 오래 안 쓴 docId 가 앞쪽
  const BUDGET_CHARS = 200 * 1024 * 1024;   // 캐시 총량(대략) 초과 시 오래된 것부터 버림
  let cachedChars = 0, latest = 0;
  const touch = (id) => { const i = order.indexOf(id); if (i >= 0) order.splice(i, 1); order.push(id); };
  const evict = (id) => { const e = cache.get(id); if (e){ cachedChars -= e.chars; cache.delete(id); } const i = order.indexOf(id); if (i >= 0) order.splice(i, 1); };
  const trim = () => { while (cachedChars > BUDGET_CHARS && order.length > 1) evict(order[0]); };
  function detectEncoding(bytes){
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return "utf-8";
    try { new TextDecoder("utf-8", { fatal:true }).decode(bytes); return "utf-8"; } catch(_){}
    try { new TextDecoder("euc-kr", { fatal:true }).decode(bytes); return "euc-kr"; } catch(_){}
    return "utf-8";
  }
  function decode(bytes){
    const lim = Math.min(bytes.length, 8192);              // 앞부분에 NUL 이 있으면 바이너리로 보고 스킵(메인 경로와 동일)
    for (let i = 0; i < lim; i++) if (bytes[i] === 0) return false;
    try { return new TextDecoder(detectEncoding(bytes)).decode(bytes); }
    catch(_){ try { return new TextDecoder("utf-8").decode(bytes); } catch(_2){ return false; } }
  }
  function lineNumberAt(text, offset){
    let line = 1; const end = Math.max(0, Math.min(offset, text.length));
    for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
  }
  function snippet(text, lower, q, maxLength){
    const index = lower.indexOf(q);
    if (index < 0) return null;
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    let lineEnd = text.indexOf("\n", index); if (lineEnd < 0) lineEnd = text.length;
    let value = text.slice(lineStart, lineEnd).replace(/\t/g, "  ").trim();
    const offset = Math.max(0, index - lineStart);
    if (value.length > maxLength){
      const start = Math.max(0, Math.min(value.length - maxLength, offset - Math.floor(maxLength / 3)));
      value = (start > 0 ? "…" : "") + value.slice(start, start + maxLength) + (start + maxLength < value.length ? "…" : "");
    }
    return { line: lineNumberAt(text, index), text: value };
  }
  async function getEntry(docId, blob){
    let e = cache.get(docId);
    if (e){ touch(docId); return e; }
    let text = false;
    try { text = decode(new Uint8Array(await blob.arrayBuffer())); } catch(_){ text = false; }
    e = { text, lower: text ? text.toLowerCase() : "", chars: text ? text.length * 2 : 0 };
    cache.set(docId, e); order.push(docId); cachedChars += e.chars; trim();
    return e;
  }
  self.onmessage = async (ev) => {
    const d = ev.data || {};
    if (d.type === "evict"){ evict(d.docId); return; }
    if (d.type === "evictAll"){ cache.clear(); order.length = 0; cachedChars = 0; return; }
    if (d.type !== "search") return;
    const token = d.token; latest = token;
    const q = String(d.query || "").toLowerCase(), maxLength = d.maxLength || 120, files = d.files || [];
    for (let i = 0; i < files.length; i++){
      if (token !== latest) return;                        // 더 새 검색이 들어옴 → 중단(await 사이에서 최신 토큰 갱신됨)
      const f = files[i];
      let hit = null;
      if (q){ const e = await getEntry(f.docId, f.blob); if (token !== latest) return; if (e.text) hit = snippet(e.text, e.lower, q, maxLength); }
      self.postMessage({ type:"result", token, docId:f.docId, hit });
    }
    if (token === latest) self.postMessage({ type:"done", token });
  };
  self.postMessage({ type:"ready" });
}
let _contentSearchWorker = null, _contentSearchWorkerBroken = false, _contentRenderRaf = 0;
function ensureContentSearchWorker(){
  if (_contentSearchWorker || _contentSearchWorkerBroken) return _contentSearchWorker;
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined"){ _contentSearchWorkerBroken = true; return null; }
  try {
    const url = URL.createObjectURL(new Blob(["(" + contentSearchWorkerMain.toString() + ")();"], { type:"text/javascript" }));
    const w = new Worker(url); URL.revokeObjectURL(url);
    w.onmessage = onContentSearchWorkerMessage;
    w.onerror = () => { _contentSearchWorkerBroken = true; };
    _contentSearchWorker = w;
  } catch(_){ _contentSearchWorkerBroken = true; }
  return _contentSearchWorker;
}
function scheduleContentSearchRender(){
  if (_contentRenderRaf) return;                           // rAF 로 묶어 결과 폭주 시 렌더 과다 방지
  _contentRenderRaf = requestAnimationFrame(() => { _contentRenderRaf = 0; renderSidebar(); });
}
function onContentSearchWorkerMessage(ev){
  const d = ev.data || {};
  if (d.type === "result"){
    if (d.token !== contentSearchToken) return;            // 스테일 결과 무시
    if (d.hit){ contentMatchIds.add(d.docId); contentMatchSnippets.set(d.docId, d.hit); scheduleContentSearchRender(); }
  } else if (d.type === "done"){
    if (d.token !== contentSearchToken) return;
    setContentStatus(contentMatchIds.size ? window.tf("{n}개 일치", { n: contentMatchIds.size }) : (window.t ? window.t("내용 일치 없음") : "내용 일치 없음"));
    renderSidebar();
  }
}
// 파일을 닫으면 워커 캐시에서도 지운다(closeDoc 등에서 호출).
function evictContentSearchDoc(id){
  if (_contentSearchWorker) try { _contentSearchWorker.postMessage({ type:"evict", docId:id }); } catch(_){}
}

async function runContentSearch(query){
  const token = ++contentSearchToken;
  if (!query){ contentMatchIds = new Set(); contentMatchSnippets = new Map(); contentMatchQuery = ""; setContentStatus(""); renderSidebar(); return; }
  setContentStatus("검색 중…");
  const result = new Set();
  const snippets = new Map();
  for (const doc of docs.filter(isTextSearchable)){
    if (token !== contentSearchToken) return;            // 더 새 검색이 시작됨 → 중단
    const text = await getDocText(doc);
    let lower = contentLowerCache.get(doc.id);
    if (text && typeof lower !== "string"){ lower = text.toLocaleLowerCase(); contentLowerCache.set(doc.id, lower); }
    const snippet = text && contentMatchSnippet(text, query, 120, lower);
    if (snippet){ if (doc.kind === "pdf") snippet.unit = "페이지"; result.add(doc.id); snippets.set(doc.id, snippet); }
  }
  if (token !== contentSearchToken) return;
  contentMatchIds = result; contentMatchSnippets = snippets; contentMatchQuery = query;
  // 대형 텍스트는 워커로 넘겨 백그라운드에서 검색(메인 스레드 안 멈춤). 결과는 도착하는 대로 사이드바에 반영된다.
  const large = docs.filter(isLargeTextSearchable);
  const worker = large.length ? ensureContentSearchWorker() : null;
  renderSidebar();
  if (worker){
    setContentStatus("검색 중…");                          // done 메시지에서 최종 개수·렌더 마무리
    worker.postMessage({ type:"search", token, query, maxLength:120,
      files: large.map(d => ({ docId: d.id, blob: d.sourceFile })) });
  } else {
    // 워커 불가(구형 환경) 또는 대형 파일 없음 → 지금 결과가 최종
    setContentStatus(result.size ? window.tf("{n}개 일치", { n: result.size }) : (window.t ? window.t("내용 일치 없음") : "내용 일치 없음"));
  }
}
function onSidebarSearchInput(){                          // 입력 즉시 이름 필터 + 내용 검색은 디바운스
  renderSidebar();
  clearTimeout(contentSearchTimer);
  const q = String((byId("sbSearch") || {}).value || "").trim().toLocaleLowerCase();
  if (!q){ contentMatchIds = new Set(); contentMatchSnippets = new Map(); contentMatchQuery = ""; setContentStatus(""); return; }
  setContentStatus("…");
  contentSearchTimer = setTimeout(() => runContentSearch(q), 250);
}
function documentExtension(doc){
  const name = String(doc && doc.name || "");
  const ext = fileExtOf(name);
  return ext && ext !== name.toLowerCase() ? "." + ext : "(기타)";
}
function setSidebarExtensionFilter(ext){
  sidebarExtFilter = ext || "";
  if (sidebarExtFilter && sidebarCollapsed){
    sidebarCollapsed = false;
    try { localStorage.setItem("sidebarCollapsed", "false"); } catch(e){}
    refreshChrome();
  }
  renderSidebar();
  const wrap = byId("fileStatsWrap"), pop = byId("fileStatsPop");
  if (wrap) wrap.dataset.pin = "0";
  if (pop) pop.hidden = true;
  const button = byId("fileStats");
  if (button) button.setAttribute("aria-expanded", "false");
}

function renderSidebar(){
  if (uiBatchDepth > 0){ uiBatchSidebarPending = true; return; }
  closeSidebarGroupMenu();
  const list = byId("sbList");
  list.innerHTML = "";
  const query = String((byId("sbSearch") && byId("sbSearch").value) || "").trim().toLocaleLowerCase();
  const childrenOf = (parentId) => navNodes.filter(n => n.parentId === parentId);
  const nodeName = (node) => {
    if (node.type === "group") return node.name || "";
    const doc = docs.find(d => d.id === node.docId);
    return doc ? doc.name : "";
  };
  const matchCache = new Map();
  const matches = (node) => {
    if (matchCache.has(node.nodeId)) return matchCache.get(node.nodeId);
    let result;
    if (node.type === "group"){
      const childMatch = childrenOf(node.nodeId).some(matches);
      result = sidebarExtFilter ? childMatch : (!query || nodeName(node).toLocaleLowerCase().includes(query) || childMatch);
    } else {
      const doc = docs.find(d => d.id === node.docId);
      if (!doc) result = false;
      else {
        const queryMatch = !query || doc.name.toLocaleLowerCase().includes(query)
          || (contentMatchQuery === query && contentMatchIds.has(doc.id));
        const extMatch = !sidebarExtFilter || documentExtension(doc) === sidebarExtFilter;
        result = queryMatch && extMatch;
      }
    }
    matchCache.set(node.nodeId, result);
    return result;
  };
  let visibleCount = 0;
  const draw = (parentId, depth=0) => childrenOf(parentId).forEach(node => {
    if (!matches(node)) return;
    const doc = node.type === "doc" ? docs.find(d => d.id === node.docId) : null;
    if (node.type === "doc" && !doc) return;
    const item = document.createElement("div");
    item.className = "sb-item" + (doc && doc.id === activeId ? " active" : "") + (doc && studyPdfId !== null && doc.id === studyPdfId && doc.id !== activeId ? " study-ref" : "") + (node.type === "group" ? " group" : "");
    item.style.setProperty("--depth", depth);
    item.tabIndex = -1;                                     // 키보드 ↑/↓ 이동용(roving tabindex)
    item.dataset.nodeId = node.nodeId;
    if (node.type === "doc") item.dataset.docId = doc.id;   // 활성표시 갱신용 식별자
    item.onclick = (e) => {
      sidebarCursorKey = node.nodeId;                       // 클릭한 줄을 키보드 커서로 동기화
      if (node.type === "group"){
        // 자동 복원에서 대량 사진이 생략된 폴더는 루트·하위 폴더 어디를 눌러도 한 번만 실제 파일을 다시 읽는다.
        const pendingImageRoot = navNodes.find(item =>
          item.nodeId === node.folderRefreshRootId && item.type === "group" && item.folderRefreshRootId === item.nodeId
        );
        if (pendingImageRoot && pendingImageRoot.restorePendingImages && !pendingImageRoot.folderReloading){
          pendingImageRoot.folderReloading = true;
          Promise.resolve(requestFolderRefresh(pendingImageRoot.nodeId))
            .catch(() => {})
            .finally(() => { pendingImageRoot.folderReloading = false; });
          return;
        }
        // 일반 클릭(아코디언): 펼칠 때 같은 레벨(형제) 폴더를 자동으로 접어 한 폴더만 열리게 한다.
        // Alt+클릭: 형제를 유지한 채 자기만 펴기/접기(여러 폴더 동시에 펼쳐두고 싶을 때).
        node.expanded = !node.expanded;
        if (!e.altKey && node.expanded) collapseSiblingGroups(node);
        renderSidebar();
      }
      else {
        const hit = query && contentMatchQuery === query ? contentMatchSnippets.get(doc.id) : null;
        const ext = String(doc.name || "").toLowerCase().split(".").pop() || "";
        const canFocusContentLine = !!(hit && hit.line && hit.unit !== "페이지" &&
          (ext === "txt" || ext === "html" || ext === "htm" || ext === "xhtml" ||
           (typeof CODE_EXTS !== "undefined" && ext in CODE_EXTS)));
        const canFocusRenderedContent = !!(hit && ["md", "markdown", "mdx", "csv"].includes(ext));
        // 코드·텍스트는 렌더 전에도 줄 이동을 예약한다. 이미 렌더된 문서는 아래에서 즉시 이동한다.
        if (canFocusContentLine) doc.pendingFocusLine = hit.line;
        openDocInTargetPane(doc.id);           // 분할 화면이면 마지막 클릭 칸에 열기(아니면 setActiveDoc 와 동일)
        if (doc.kind === "pdf" && hit){   // PDF 내용 검색 결과 → 일치 페이지로 이동
          if (hit && hit.unit === "페이지" && hit.line) scrollPdfToPage(doc, hit.line);
        } else if (canFocusContentLine){
          const navigator = doc.codeEditor || doc.codeViewer;
          if (navigator && typeof navigator.focusLine === "function"){
            const line = doc.pendingFocusLine;
            doc.pendingFocusLine = 0;
            requestAnimationFrame(() => navigator.focusLine(line));
          }
        } else if (canFocusRenderedContent){
          ensureRendered(doc).then(() => {
            if (doc.id !== activeId || typeof doc.contentSearchFocus !== "function") return;
            requestAnimationFrame(() => doc.contentSearchFocus(query));
          }).catch(() => {});
        }
      }
    };
    if (node.type === "group" && node.newPythonContext){
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault(); e.stopPropagation();
        sidebarCursorKey = node.nodeId;
        openSidebarGroupMenu(node, e.clientX, e.clientY);
      });
    }
    const twist = document.createElement("span");
    twist.className = "sb-twist";
    twist.textContent = node.type === "group" ? (node.expanded ? "▾" : "▸") : "";
    if (node.type === "group") twist.title = "클릭: 펼치기(같은 레벨 폴더는 자동 접힘) · Alt+클릭: 형제 유지한 채 자기만 토글";
    const ic = document.createElement("span");
    ic.className = "sb-ic";
    ic.textContent = node.type === "group" ? iconFor(node.kind, node.name) : iconFor(doc.kind, doc.name);
    const icCat = node.type === "group" ? extCategory(node.kind, node.name) : extCategory(doc.kind, doc.name);
    if (icCat) item.dataset.cat = icCat;   // 행에 부여 → 배지와 파일명이 같은 색조 공유
    const nm = document.createElement("span");
    nm.className = "sb-name";
    nm.textContent = node.type === "group" ? node.name : doc.name;
    nm.title = nm.textContent;
    if (doc) nm.title += " · " + humanSize(doc.size || 0);
    if (doc && doc.textEncoding) nm.title += " · 인코딩: " + doc.textEncoding.label +
      (doc.textEncoding.sampled ? " (앞부분 검사)" : "");
    if (node.type === "group" && node.newPythonContext) nm.title += " · 우클릭: 새 Python 코드·노트북" + (node.folderRefreshRootId ? " · 폴더 새로고침" : "");
    const label = document.createElement("span"); label.className = "sb-label"; label.appendChild(nm);
    if (node.type === "group" && node.zipLimits === true){
      label.classList.add("has-zip-info");
      nm.title += " · " + ZIP_MODE_NOTICE;
      const info = document.createElement("button");
      info.className = "sb-zip-info"; info.type = "button"; info.textContent = "ⓘ";
      info.title = ZIP_MODE_NOTICE; info.setAttribute("aria-label", "ZIP 제한사항 보기");
      info.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toast(ZIP_MODE_NOTICE, 6500); });
      label.appendChild(info);
    }
    if (doc && query && contentMatchQuery === query && contentMatchSnippets.has(doc.id)){
      const hit = contentMatchSnippets.get(doc.id);
      const preview = document.createElement("span"); preview.className = "sb-match"; preview.title = hit.text;
      const prefix = document.createElement("span"); prefix.textContent = hit.line + (hit.unit || "줄") + " · "; preview.appendChild(prefix);
      const at = hit.text.toLocaleLowerCase().indexOf(query);
      if (at >= 0){
        preview.append(document.createTextNode(hit.text.slice(0, at)));
        const mark = document.createElement("mark"); mark.textContent = hit.text.slice(at, at + query.length); preview.appendChild(mark);
        preview.append(document.createTextNode(hit.text.slice(at + query.length)));
      } else preview.append(document.createTextNode(hit.text));
      label.appendChild(preview);
    }
    const saved = document.createElement("span");
    saved.className = "sb-saved";
    const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
    if (doc && doc.hasUnsavedEdits){ saved.textContent = "●"; saved.title = _t("저장 후 수정됨"); }
    else if (doc && doc.savedInWorkspace){ saved.textContent = "✓"; saved.title = _t("앱 작업공간에 저장됨"); }
    else saved.hidden = true;
    const encoding = document.createElement("span");
    encoding.className = "sb-encoding";
    if (doc && doc.textEncoding){
      encoding.textContent = doc.textEncoding.shortLabel || doc.textEncoding.label;
      encoding.title = "인코딩: " + doc.textEncoding.label + (doc.textEncoding.sampled ? " (파일 앞부분 검사)" : "");
    } else encoding.hidden = true;
    item.append(twist, ic, label, encoding, saved);
    // 닫기(✕)는 최상위 항목에만 — 낱개 파일이나 ZIP·폴더의 맨 위(묶음 통째로 닫기). 안쪽 파일·하위 폴더엔 표시하지 않는다.
    if (node.parentId == null){
      const cl = document.createElement("button"); cl.className = "sb-close"; cl.textContent = "✕";
      cl.title = node.type === "group" ? "묶음 전체 닫기" : "닫기";
      cl.onclick = (e) => {
        e.stopPropagation();
        if (node.type === "group") closeGroup(node.nodeId, { forgetWorkspace: true });
        else closeDoc(doc.id, { forgetWorkspace: true });
      };
      item.append(cl);
    }
    list.appendChild(item);
    visibleCount++;
    if (node.type === "group" && (node.expanded || query || sidebarExtFilter)) draw(node.nodeId, depth + 1);
  });
  draw(null);
  if (!visibleCount && (query || sidebarExtFilter)){
    const empty = document.createElement("div"); empty.className = "sb-empty"; empty.textContent = "필터에 일치하는 파일이 없습니다.";
    list.appendChild(empty);
  }
  restoreSidebarCursor();                // 다시 그린 뒤 키보드 커서(roving tabindex/포커스) 복원
  updateFileStats();
}

// 같은 레벨(형제)의 펼쳐진 폴더를 접는다(node 자신은 유지). 아코디언 동작용 — 일반 클릭으로
// 폴더를 펼칠 때 호출돼 한 폴더만 열리게 한다. 렌더는 호출자가 책임진다(node.expanded 반영과 함께 한 번만).
function collapseSiblingGroups(node){
  for (const n of navNodes){
    if (n === node) continue;
    if (n.type === "group" && n.parentId === node.parentId && n.expanded) n.expanded = false;
  }
}

/* ===== 사이드바 키보드 탐색: ↑/↓ 로 줄 선택 이동, Enter/Space 로 열기·폴더 펼치기 ===== */
function sidebarItems(){ return [...byId("sbList").querySelectorAll(".sb-item")]; }
function focusSidebarItem(item){
  if (!item) return;
  for (const el of sidebarItems()) el.tabIndex = -1;
  item.tabIndex = 0;
  item.focus();
  item.scrollIntoView({ block: "nearest" });
  sidebarCursorKey = item.dataset.nodeId || null;
}
// 사이드바를 다시 그린 뒤 커서 위치를 유지한다. roving tabindex 가 항상 한 줄에만 남도록 보장하고,
// 사이드바 안에 포커스가 있을 때만 실제 포커스를 옮겨 다른 영역 작업을 방해하지 않는다.
function restoreSidebarCursor(){
  const items = sidebarItems();
  if (!items.length){ sidebarCursorKey = null; return; }
  let target = sidebarCursorKey ? items.find(el => el.dataset.nodeId === sidebarCursorKey) : null;
  if (!target) target = items.find(el => el.dataset.docId === String(activeId)) || items[0];
  for (const el of items) el.tabIndex = -1;
  target.tabIndex = 0;
  sidebarCursorKey = target.dataset.nodeId || null;
  // 키보드로 목록을 탐색 중일 때만 포커스를 되돌린다. 검색창 등 사이드바의 다른 컨트롤에
  // 포커스가 있을 때 되돌리면, 한 글자 입력마다 포커스가 파일 항목으로 튕겨 나간다.
  if (byId("sbList").contains(document.activeElement)){
    target.focus(); target.scrollIntoView({ block: "nearest" });
  }
}
function onSidebarKey(e){
  const items = sidebarItems();
  if (!items.length) return;
  const cur = document.activeElement && document.activeElement.closest(".sb-item");
  const idx = cur ? items.indexOf(cur) : -1;
  switch (e.key){
    case "ArrowDown": e.preventDefault(); focusSidebarItem(items[idx < 0 ? 0 : Math.min(items.length - 1, idx + 1)]); break;
    case "ArrowUp":   e.preventDefault(); focusSidebarItem(items[idx < 0 ? items.length - 1 : Math.max(0, idx - 1)]); break;
    case "Home":      e.preventDefault(); focusSidebarItem(items[0]); break;
    case "End":       e.preventDefault(); focusSidebarItem(items[items.length - 1]); break;
    case "Enter":
    case " ":
      if (cur){
        e.preventDefault();
        const key = cur.dataset.nodeId;
        cur.click();                                          // 파일 열기 또는 폴더 펼치기·접기
        const again = sidebarItems().find(el => el.dataset.nodeId === key);
        if (again) focusSidebarItem(again);                   // 다시 그려졌어도 같은 줄에 커서를 유지
      }
      break;
  }
}

// 메모리 사용량 칩: 백엔드 프로세스 트리(호스트 + 파이썬 커널·드라이버 등) 물리 메모리 합계 + 페이지 JS 힙. 몇 초마다 갱신.
let memStatTimer = 0;
async function updateMemStat(){
  const el = byId("memStat"); if (!el) return;
  let backendMB = null, procs = [];
  try {
    const r = await fetch("/mem", { cache: "no-store" });
    if (r.ok){ const j = await r.json(); if (j && j.ok){ backendMB = j.totalMB; procs = j.processes || []; } }
  } catch(_){}
  let jsMB = null;   // performance.memory 는 Chromium 계열만 제공(페이지 JS 힙)
  try { const m = performance && performance.memory; if (m && m.usedJSHeapSize) jsMB = Math.round(m.usedJSHeapSize / 1048576); } catch(_){}
  if (backendMB == null && jsMB == null){ el.hidden = true; return; }
  const parts = [];
  if (backendMB != null) parts.push(window.tf("메모리 {mb}MB", { mb: backendMB }));
  if (jsMB != null) parts.push("JS " + jsMB + "MB");
  el.textContent = parts.join(" · ");
  el.hidden = false;
  const tip = [];
  for (const p of procs.slice(0, 8)) tip.push(p.name + " " + p.mb + "MB");
  if (jsMB != null) tip.push(window.tf("페이지 JS 힙 {mb}MB", { mb: jsMB }));
  el.title = tip.join("\n");
}
function startMemStat(){
  if (memStatTimer) return;
  updateMemStat();
  memStatTimer = setInterval(updateMemStat, 4000);
}

// 사이드바 파일 통계: 열린 파일 총 갯수·총 용량 + 확장자별 내역(클릭 팝오버)
function updateFileStats(){
  const wrap = byId("fileStatsWrap"); if (!wrap) return;
  const pop = byId("fileStatsPop"), chip = byId("fileStatsSummary"), button = byId("fileStats");
  const open = docs.filter(d => !d.closed);
  wrap.hidden = false;
  if (!open.length){
    sidebarExtFilter = "";
    chip.textContent = (typeof window.t === "function") ? window.t("파일 0개 · 0 B") : "파일 0개 · 0 B";
    pop.hidden = true;
    wrap.dataset.pin = "0";
    if (button){
      button.disabled = true;
      button.title = (typeof window.t === "function") ? window.t("열린 파일이 없습니다") : "열린 파일이 없습니다";
      button.setAttribute("aria-expanded", "false");
    }
    return;
  }
  if (button) button.disabled = false;
  let totalSize = 0; const byExt = new Map();
  for (const d of open){
    totalSize += (d.size || 0);
    const key = documentExtension(d);
    byExt.set(key, (byExt.get(key) || 0) + 1);
  }
  chip.textContent = window.tf("파일 {n}개 · {size}", { n: open.length, size: humanSize(totalSize) }) + (sidebarExtFilter ? " · " + sidebarExtFilter : "");
  if (button) button.title = sidebarExtFilter ? window.tf("현재 {ext} · 확장자 필터 변경", { ext: sidebarExtFilter }) : (window.t ? window.t("열린 파일 — 확장자별 보기") : "열린 파일 — 확장자별 보기");
  const rows = [...byExt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  pop.innerHTML = "";
  const head = document.createElement("div"); head.className = "fsp-head";
  head.textContent = window.tf("파일 {n}개 · {size}", { n: open.length, size: humanSize(totalSize) });
  pop.appendChild(head);
  const all = document.createElement("div"); all.className = "fsp-row fsp-all-row";
  all.classList.toggle("active", !sidebarExtFilter);
  all.setAttribute("role", "menuitemradio"); all.setAttribute("aria-checked", String(!sidebarExtFilter)); all.tabIndex = 0;
  all.title = (window.t ? window.t("전체 파일 보기") : "전체 파일 보기");
  all.onclick = (e) => { e.stopPropagation(); setSidebarExtensionFilter(""); };
  all.onkeydown = (e) => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); setSidebarExtensionFilter(""); } };
  const allLabel = document.createElement("span"); allLabel.textContent = (window.t ? window.t("전체") : "전체");
  const allCount = document.createElement("span"); allCount.className = "fsp-cnt"; allCount.textContent = window.tf("{n}개", { n: open.length });
  all.append(allLabel, allCount); pop.appendChild(all);
  for (const [ext, n] of rows){
    const row = document.createElement("div"); row.className = "fsp-row";
    row.classList.toggle("active", sidebarExtFilter === ext);
    row.setAttribute("role", "menuitemradio"); row.setAttribute("aria-checked", String(sidebarExtFilter === ext)); row.tabIndex = 0;
    row.title = window.tf("{ext} 파일만 보기", { ext });
    row.onclick = (e) => { e.stopPropagation(); setSidebarExtensionFilter(ext); };
    row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); setSidebarExtensionFilter(ext); } };
    const ex = document.createElement("span"); ex.className = "fsp-ext"; ex.textContent = ext;
    const ct = document.createElement("span"); ct.className = "fsp-cnt"; ct.textContent = window.tf("{n}개", { n });
    row.append(ex, ct); pop.appendChild(row);
  }
}

// i18n 바인딩 대상이 아닌 동적 문서 상태·사이드바도 언어 전환 직후 다시 계산한다.
window.addEventListener("mni18nchange", () => {
  docs.forEach(updateDocumentStatus);
  updateModeBadges();
  renderSidebar();
});

function closeGroup(nodeId, options={}){
  const group = navNodes.find(n => n.nodeId === nodeId && n.type === "group");
  if (!group) return;
  const ids = new Set([nodeId]);
  let changed = true;
  while (changed){
    changed = false;
    navNodes.forEach(n => {
      if (!ids.has(n.nodeId) && ids.has(n.parentId)){
        ids.add(n.nodeId);
        changed = true;
      }
    });
  }
  const childDocs = docs.filter(d => ids.has(d.nodeId));
  if (childDocs.some(d => d.kind === "pdf" && d.elements && d.elements.length)){
    if (!confirm(`'${group.name}' 안에 추가한 서명/텍스트가 있는 PDF가 있습니다. 닫을까요?`)) return;
  }
  childDocs.forEach(d => closeDoc(d.id, { skipConfirm: true, skipPrune: true, skipUi: true }));
  for (let i = navNodes.length - 1; i >= 0; i--){
    if (ids.has(navNodes[i].nodeId)) navNodes.splice(i, 1);
  }
  bumpNavTree();                          // 묶음 삭제 → 인덱스/루트 캐시 무효화
  if (!docs.length){
    activeId = 0; state=null; viewer=null; byId("tools").hidden=true; byId("officeTools").hidden=true;
  } else if (!docs.some(d => d.id === activeId)) setActiveDoc(docs[0].id);
  refreshChrome();
  applyStudyLayout();
  renderSidebar();
  const forgottenPaths = [...(group.workspacePaths || [])];
  if (group.folderRefreshRootId === group.nodeId && group.imageSkipWorkspacePath)
    forgottenPaths.push(group.imageSkipWorkspacePath);
  if (options.forgetWorkspace && forgottenPaths.length)
    forgetWorkspacePaths(forgottenPaths, navNodes.length === 0);
}

function refreshChrome(){
  if (uiBatchDepth > 0){ uiBatchChromePending = true; return; }
  const has = navNodes.length > 0;
  if (!docs.length){ byId("activeFileName").textContent = ""; byId("activeFileName").removeAttribute("data-cat"); byId("activeDocEncoding").hidden = true; updateOriginalSaveBadge(null); updateModeBadges(); }
  renderTabs();
  dropzone.hidden = has;
  byId("sidebar").hidden = sidebarCollapsed;
  byId("sbResizer").hidden = !has || sidebarCollapsed;
  const sidebarToggle = byId("sidebarToggle");
  sidebarToggle.title = sidebarCollapsed ? "왼쪽 사이드 메뉴 보이기" : "왼쪽 사이드 메뉴 숨기기";
  sidebarToggle.setAttribute("aria-label", sidebarToggle.title);
  sidebarToggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
  byId("studyToggle").hidden = !has;
}

