"use strict";

/* ===== 문서 관리(사이드바/탭) ===== */
const IMG_EXTS = ["png","jpg","jpeg","gif","webp","bmp","svg","avif","ico"];
const SQLITE_EXTS = ["db","sqlite","sqlite3"];
// 학습 모델과 NumPy 배열은 이진 파일이므로 텍스트 편집기로 열지 않고 원본 바이트를 보존한다.
// .pyc(컴파일된 Python 바이트코드)도 소스가 없는 이진 파일이라 같은 경로로 다룬다.
const BINARY_ASSET_EXTS = new Set([
  "model", "npy", "npz", "kv",
  "onnx", "tflite", "safetensors", "pt", "pth", "ckpt",
  "joblib", "pkl", "pickle", "keras", "h5", "hdf5", "pyc"
]);
// 코드/설정 파일: 확장자 → 구문강조 프로파일(c=C계열, python=Python, hash=#주석, css/sql/xml=전용)
const CODE_EXTS = {
  js:"c", mjs:"c", cjs:"c", ts:"c", jsx:"c", tsx:"c", java:"c", c:"c", h:"c", cpp:"c", cc:"c", hpp:"c", cxx:"c",
  cs:"c", go:"c", rs:"c", php:"c", kt:"c", kts:"c", swift:"c", scala:"c", dart:"c", vue:"c", svelte:"c",
  json:"c", json5:"c", jsonc:"c", scss:"c", less:"c", bat:"c", cmd:"c",
  py:"python", pyi:"python", rb:"hash", sh:"hash", bash:"hash", zsh:"hash", ps1:"hash",
  yaml:"hash", yml:"hash", toml:"hash", ini:"hash", env:"hash", properties:"hash", conf:"hash",
  css:"css", sql:"sql",
  xml:"xml", xsl:"xml", xslt:"xml", xsd:"xml", rss:"xml", atom:"xml", plist:"xml", wsdl:"xml", dbk:"xml", docbook:"xml",
  rst:"text", adoc:"text", asciidoc:"text", asc:"text", org:"text", textile:"text", tex:"text", latex:"text", sty:"text", cls:"text", wiki:"text", mediawiki:"text",
  r:"hash", lua:"c", pl:"hash", pm:"hash", tcl:"hash", awk:"hash", groovy:"c", gradle:"c", proto:"c", coffee:"hash", cmake:"hash", dockerfile:"hash", makefile:"hash", mk:"hash",
  tsv:"text", log:"text", diff:"text", patch:"text", tokens:"text", vec:"text", vocab:"text"
};
const TEXT_ENCODING_EXTS = new Set(["csv","md","markdown","mdx","txt","html","htm","xhtml", ...Object.keys(CODE_EXTS), ...SUBTITLE_EXTS]);
// ZIP 안에서 자동으로 열어줄 확장자(중첩 zip 포함)
// VIDEO_EXTS·AUDIO_EXTS·SUBTITLE_EXTS 는 video-viewer.js 가 이 파일보다 먼저 로드되어 제공한다(스크립트 순서 주의).
const ZIP_OPENABLE = ["pdf","docx","doc","xlsx","xls","csv","pptx","hwp","hwpx","md","markdown","mdx","txt","html","htm","xhtml","ipynb",
  ...SQLITE_EXTS, ...Object.keys(CODE_EXTS), ...BINARY_ASSET_EXTS, "zip", "tar", "gz", "tgz", ...IMG_EXTS,
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
const ZIP_ENTRY_CAP = 128 * 1024 * 1024;
const ZIP_MODE_NOTICE = "ZIP 모드: 원본 압축의 새로고침·덮어쓰기는 지원하지 않으며, 편집한 파일은 별도로 저장됩니다. Python 옆 파일 실행은 합계 50MB까지 지원합니다.";

// 여러 파일을 복원할 때 각 항목마다 사이드바·탭을 다시 그리지 않고 마지막에 한 번만 반영한다.
let uiBatchDepth = 0;
let uiBatchSidebarPending = false;
let uiBatchChromePending = false;
let uiBatchActiveCandidate = null;
let uiBatchCancelled = false;
// 폴더·압축을 연 배치는 첫 파일을 자동으로 띄우지 않는다(설정 autoOpenFirstFile 로 되돌릴 수 있음).
// 대신 여기 모아 둔 그룹만 펼쳐서, 사용자가 사이드바에서 볼 파일을 직접 고르게 한다.
let uiBatchNoAutoOpen = false;
let uiBatchOpenedGroupIds = [];
function suppressUiBatchAutoOpen(groupId){
  if (!uiBatchDepth) return;
  uiBatchNoAutoOpen = true;
  // 펼쳐 둘 곳은 최상위 그룹만 — 폴더 안에 들어 있던 압축까지 열어젖히지는 않는다.
  const node = groupId != null ? navNodeById(groupId) : null;
  if (node && node.parentId == null && !uiBatchOpenedGroupIds.includes(groupId)) uiBatchOpenedGroupIds.push(groupId);
}
function beginUiBatch(){
  if (uiBatchDepth++ === 0){
    uiBatchCancelled = false;
    uiBatchActiveCandidate = null;
    uiBatchNoAutoOpen = false;
    uiBatchOpenedGroupIds = [];
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
  const noAutoOpen = uiBatchNoAutoOpen;
  const openedGroupIds = uiBatchOpenedGroupIds;
  uiBatchCancelled = false;
  uiBatchSidebarPending = false;
  uiBatchChromePending = false;
  uiBatchActiveCandidate = null;
  uiBatchNoAutoOpen = false;
  uiBatchOpenedGroupIds = [];
  const cancel = byId("loadingCancel"); if (cancel) cancel.hidden = true;
  byId("loading").hidden = true;
  if (refreshHeader) refreshChrome();
  if (refreshSidebar) renderSidebar();
  if (noAutoOpen){
    // 자동으로 여는 파일이 없으므로 방금 만든 폴더·압축 그룹은 펼쳐 둔다(닫힌 폴더 하나만 남는 걸 막는다).
    let expanded = false;
    openedGroupIds.forEach(nodeId => {
      const node = navNodeById(nodeId);
      if (node && node.type === "group" && !node.expanded){ node.expanded = true; expanded = true; }
    });
    if (expanded) renderSidebar();       // 위에서 이미 한 번 그렸으므로 실제로 펼친 게 있을 때만 다시 그린다
    updateDocEmptyState();
    return;
  }
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
  // Word 제자리 편집 중에는 빈 여백을 눌러도 문서 이동 모드로 들어가지 않는다.
  // 편집 문단 밖에서 시작한 짧은 드래그가 선택을 지우거나 화면을 움직이는 일을 막는다.
  if (container && container.classList && container.classList.contains("docx-inline-editing")) return true;
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
                 cl.contains("exam-sign-pad") ||     // 서명은 캔버스에 그리는 드래그 — 문서 스크롤이 따라오면 획이 어긋난다
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
// ── 일반 PDF 단독 뷰의 우측 상단 바(줌·페이지) 자동 숨김 — study 바와 같은 유휴 방식 ──
let pdfControlsTimer = null;
const PDF_CTL_IDLE_MS = 3000;
function pdfControlsActive(){
  const c = byId("content");
  return !!(c && c.classList.contains("pdf-active") && !c.classList.contains("study-mode") && !isViewerFullscreen());
}
// 페이지 번호 입력 중·찾기창 열림 중에는 숨기지 않는다
function pdfControlsBusy(){
  const ae = document.activeElement;
  const ctl = byId("pageCtl");
  if (ctl && ae && ctl.contains(ae)) return true;
  if (document.querySelector(".pdf-find:not([hidden])")) return true;
  return false;
}
function armPdfControlsTimer(){
  clearTimeout(pdfControlsTimer);
  if (!pdfControlsActive()) return;
  pdfControlsTimer = setTimeout(() => {
    if (!pdfControlsActive()) return;
    if (pdfControlsBusy()){ armPdfControlsTimer(); return; }   // 상호작용 중이면 다시 대기
    const c = byId("content"); if (c) c.classList.add("pdf-ctl-idle");
  }, PDF_CTL_IDLE_MS);
}
function showPdfControls(){
  if (!pdfControlsActive()) return;
  const c = byId("content"); if (c) c.classList.remove("pdf-ctl-idle");
  armPdfControlsTimer();
}
function stopPdfControlsAutoHide(){
  clearTimeout(pdfControlsTimer);
  const c = byId("content"); if (c) c.classList.remove("pdf-ctl-idle");
}
function scheduleViewerLayoutRefresh(){
  setTimeout(() => {
    const pdf = typeof fullscreenPdfTarget === "function" ? fullscreenPdfTarget() : (state && state.kind === "pdf" ? state : null);
    if (pdf) refreshVisibleQuality(pdf);
    if (state && state.el) updatePannableState(state.el);
  }, 80);
}

function makeGroup(kind, name, parentId=null){
  // 새 폴더/압축 그룹은 접힌 채로 시작한다. 폴더를 열면 배치 종료 후 첫 문서가 활성화되고,
  // focusSidebarDoc 가 그 문서의 상위 폴더 체인(루트 포함)만 펼친다 → "열린 탭의 폴더만 펼침".
  const node = { nodeId: "group:" + (++navSeq), type: "group", kind, name, parentId, expanded: false };
  navNodes.push(node);
  bumpNavTree();
  renderSidebar();
  refreshChrome();
  return node;
}

let studyReferenceLockFlashTimer = 0;
let studyReferenceLockFlashAt = 0;
function flashStudyReferenceLock(){
  const content = byId("content");
  const lock = byId("studyChipLock");
  if (!content || !lock || !studyReferenceLocked || !content.classList.contains("study-mode")) return;
  const now = Date.now();
  if (now - studyReferenceLockFlashAt < 280) return;
  studyReferenceLockFlashAt = now;
  clearTimeout(studyReferenceLockFlashTimer);
  lock.classList.remove("study-ref-lock-flash");
  void lock.offsetWidth;
  lock.classList.add("study-ref-lock-flash");
  studyReferenceLockFlashTimer = setTimeout(() => lock.classList.remove("study-ref-lock-flash"), 650);
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
    flashStudyReferenceLock();
    event.preventDefault(); event.stopImmediatePropagation();
  };
  ["pointerdown", "click", "dblclick", "contextmenu"].forEach(type => doc.el.addEventListener(type, blockPointer, true));
  doc.el.addEventListener("beforeinput", (event) => {
    if (locked()){ flashStudyReferenceLock(); event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  ["paste", "cut", "drop"].forEach(type => doc.el.addEventListener(type, (event) => {
    if (locked()){ flashStudyReferenceLock(); event.preventDefault(); event.stopImmediatePropagation(); }
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
    flashStudyReferenceLock();
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
    nativeAbsolutePath: options.nativeAbsolutePath || null,
    originalSaveMode: !!options.originalSaveMode };   // 새로 만든 빈 코드 → 첫 저장 때 이름 받기
  d.relPath = options.relPath || null;
  d.archiveCtx = options.archiveCtx || null;
  if (options.taskCtx) d.taskCtx = options.taskCtx;   // 과제 패키지(.task) 문서 — 렌더 시 과제 바를 붙일 근거
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
  if (d && d.kind === "pdf") showPdfControls(); else stopPdfControlsAutoHide();   // PDF 단독 뷰일 때만 바 유휴 자동 숨김 시작

  // 전환은 직전·현재 두 문서만 토글한다(모든 문서를 매번 훑지 않아 파일 많은 묶음에서 클릭이 빨라짐).
  // 학습 화면의 고정 PDF는 이 함수 끝의 applyStudyLayout 이 다시 표시한다.
  if (prev && prev !== d) prev.el.hidden = true;
  if (d) d.el.hidden = false;
  if (!d){ state=null; viewer=null; byId("activeFileName").textContent=""; byId("activeFileName").removeAttribute("data-cat"); byId("activeDocEncoding").hidden=true; byId("activeDocStatus").hidden=true; updateOriginalSaveBadge(null); byId("tools").hidden=true; byId("officeTools").hidden=true; updateModeBadges(); renderTabs(); updateDocEmptyState(); updateSidebarActive(); return; }
  updateDocEmptyState();
  state = d;
  viewer = d.el;
  byId("tools").hidden = (d.kind !== "pdf");
  byId("officeTools").hidden = (d.kind === "pdf");
  byId("btnPages").classList.toggle("primary", !!(d.kind === "pdf" && d.pagePanelOpen));
  if (typeof updatePdfOutlineButton === "function") updatePdfOutlineButton(d);   // 목차 버튼 상태를 활성 PDF 기준으로
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
  // 저장 버튼(=저장 동선)은 렌더가 끝나야 생기므로, 저장 위치 배지는 렌더 완료 뒤 다시 판단한다.
  const rendered = ensureRendered(d);                     // 아직 안 그렸으면 이때 처음 렌더(지연 렌더)
  if (rendered && typeof rendered.then === "function"){
    rendered.then(() => { if (activeId === d.id) updateOriginalSaveBadge(d); }).catch(() => {});
  }
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

// 학습 화면의 배치 방향과 두 칸의 위치를 바꾼 상태(저장)
let studyStacked = (() => { try { return localStorage.getItem("studySplitDirection") === "stack"; } catch(e){ return false; } })();
let studySwapped = (() => { try { return localStorage.getItem("studySwapped") === "1"; } catch(e){ return false; } })();
function studyUsesStackedLayout(){
  return studyStacked || (typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches);
}
function updateStudyDirectionControls(){
  const stacked = studyUsesStackedLayout();
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  const direction = byId("studyDirectionToggle");
  if (direction){
    const label = _t(studyStacked ? "좌우 분할로 전환" : "상하 분할로 전환");
    direction.title = label;
    direction.setAttribute("aria-label", label);
    direction.setAttribute("aria-pressed", String(studyStacked));
  }
  const swap = byId("studyRoleSwap");
  if (swap){
    const label = _t(stacked ? "참고와 작업 화면 위아래 위치 바꾸기" : "참고와 작업 화면 좌우 위치 바꾸기");
    swap.title = label + _t(" (분할바 더블클릭과 동일)");
    swap.setAttribute("aria-label", label);
  }
}
function setStudyStacked(v){
  studyStacked = !!v;
  try { localStorage.setItem("studySplitDirection", studyStacked ? "stack" : "side"); } catch(e){}
  const content = byId("content");
  content.classList.toggle("study-stacked", content.classList.contains("study-mode") && studyStacked);
  if (content._studyDivider && typeof content._studyDivider._setStudyDirection === "function")
    content._studyDivider._setStudyDirection(studyStacked);
  updateStudyDirectionControls();
  const zone = content._splitDrop;
  if (zone && !zone.hidden) showSplitDropZone();
  if (typeof showStudyControls === "function") showStudyControls();
  const ref = docs.find(d => d.id === studyPdfId);
  if (ref && ref.kind === "pdf") requestAnimationFrame(() => fitStudyPdf(ref));
}
if (typeof window !== "undefined") window.addEventListener("mni18nchange", () => {
  updateStudyDirectionControls();
  const content = byId("content");
  if (content && content._studyDivider && typeof content._studyDivider._setStudyDirection === "function")
    content._studyDivider._setStudyDirection(content.classList.contains("study-stacked"));
  if (content && content._splitDrop && !content._splitDrop.hidden) showSplitDropZone();
});
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
function syncStudyReadonlyForDoc(doc){
  if (!doc) return;
  const readonly = isStudyReferenceLocked(doc);
  doc._studyReadonly = readonly;
  const editorReadonly = readonly || !!doc._nbInkMode || !!(doc.codePenOverlay && doc.codePenOverlay.active);
  const syncEditor = (editor) => {
    if (!editor || !editor.ta) return;
    editor.ta.readOnly = editorReadonly;
    editor.ta.setAttribute("aria-readonly", String(editorReadonly));
  };
  syncEditor(doc.codeEditor);
  (doc._nbCtrls || []).forEach(ctrl => syncEditor(ctrl && ctrl.editor));
}
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
  // 분할바 주변(±60px)에 마우스가 오면 가운데 버튼(종료·역할 교체·방향 전환)을 보여준다.
  // 유휴 시간 기반이 아니라 접근 기반이라 화면을 가리지 않고, 필요할 때 분할바로 가면 바로 나온다.
  content.addEventListener("pointermove", (e) => {
    if (!content.classList.contains("study-mode")){ content.classList.remove("study-divider-near"); return; }
    const r = content.getBoundingClientRect();
    const ratio = parseFloat(content.style.getPropertyValue("--study-split")) || 50;
    const stacked = content.classList.contains("study-stacked");
    const line = stacked ? r.top + r.height * ratio / 100 : r.left + r.width * ratio / 100;
    const near = Math.abs((stacked ? e.clientY : e.clientX) - line) <= 60;
    content.classList.toggle("study-divider-near", near);
  }, { passive: true });
  content.addEventListener("pointerleave", () => content.classList.remove("study-divider-near"));
}

// 사이드바·상단 탭에서 파일 클릭 시 공용 진입점: 분할 화면이면 마지막 클릭 칸 기준으로 연다.
// - 타깃 칸에 이미 떠 있는 문서 → 그대로 유지
// - 반대 칸에 떠 있는 문서 → 두 칸의 역할 교대(스왑)
// - 그 외 문서 → 타깃 칸의 문서만 교체(반대 칸은 유지)
function openDocInTargetPane(id){
  const action = studyPaneSelectionAction(studyPdfId, activeId, studyTargetPane, id);
  if (action === "keep") return;
  if (action === "swap"){ setStudyReference(activeId); return; }
  if (action === "replace-reference"){ setStudyReference(id); return; }
  setActiveDoc(id);   // 일반 화면 또는 작업 칸 교체
}

// ===== 상단 탭을 본문으로 끌어다 분할하기 =====
// 버튼(studyToggle)과 같은 일을 하는 추가 경로다. 터치는 HTML5 드래그가 없고 키보드·명령 팔레트도
// 버튼을 쓰므로 버튼은 그대로 둔다.

// 끌어온 문서를 상대편 칸에 세울 짝 — 직전에 보던 문서(activeMru)를 우선한다.
function splitDropMate(excludeId){
  const alive = (x) => x != null && x !== excludeId && docs.some(d => d.id === x);
  const recent = activeMru.find(x => alive(x) && tabOrder.includes(x));
  if (recent != null) return recent;
  const tabbed = tabOrder.find(alive);
  if (tabbed != null) return tabbed;
  const other = docs.find(d => d.id !== excludeId);
  return other ? other.id : null;
}

// 탭을 떨군 칸에 맞춰 역할을 정한다. 분할 진입·참고 교체·역할 교대는 기존 함수가 그대로 처리한다.
function dropTabIntoPane(id, role){
  const doc = docs.find(d => d.id === id);
  if (!doc) return;
  const mate = splitDropMate(id);
  const action = tabDropSplitAction(studyPdfId, activeId, role, id, mate);
  if (action === "keep") return;
  if (action === "swap" && role === "work"){ setStudyReference(activeId); return; }   // 참고 문서를 작업 칸으로 → 역할 교대
  // 아래 세 갈래는 모두 "끌어온 문서를 참고 칸으로" — startStudyModeWithDoc 가 분할 진입·참고 교체·교대를 가른다.
  if (action === "swap" || action === "replace-reference" || action === "pin-only"){ startStudyModeWithDoc(doc); return; }
  if (action === "pin-with-mate"){ startStudyModeWithDoc(doc); setActiveDoc(mate); return; }
  if (action === "mate-as-reference"){                              // 보던 문서는 작업 칸에 두고 짝을 참고로 세운다
    const mateDoc = docs.find(d => d.id === mate);
    if (mateDoc) startStudyModeWithDoc(mateDoc);
    return;
  }
  if (action === "replace-work"){ setActiveDoc(id); return; }       // 작업 칸 문서만 교체(참고 칸 유지)
  if (action === "pin-current"){                                    // 보던 문서를 참고로 고정하고 끌어온 문서를 작업 칸에
    const current = docs.find(d => d.id === activeId);
    if (current) startStudyModeWithDoc(current);
    setActiveDoc(id);
  }
}

function configureSplitDropZone(zone, stacked){
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  zone.classList.toggle("stack", stacked);
  zone.querySelectorAll(".split-drop-half").forEach((half, index) => {
    half.dataset.side = stacked ? (index === 0 ? "top" : "bottom") : (index === 0 ? "left" : "right");
    const role = splitDropRoleForSide(half.dataset.side, studySwapped);
    half.querySelector("span").textContent = _t(role === "reference" ? "참고 칸에 고정" : "작업 칸에서 열기");
  });
}

// 이미 분할된 화면에서는 실제로 렌더링된 두 칸의 경계를 사용한다.
// CSS 변수만 읽지 않아 모바일의 강제 50:50 배치와 위치 교체 상태도 화면 그대로 따라간다.
function syncSplitDropBoundary(zone, stacked){
  const content = byId("content");
  const rect = zone.getBoundingClientRect();
  let ratio = 0.5;
  if (content.classList.contains("study-mode")){
    const panes = [...content.children]
      .filter(el => !el.hidden && (el.classList.contains("study-reference") || el.classList.contains("study-work")))
      .map(el => el.getBoundingClientRect())
      .sort((a, b) => stacked ? a.top - b.top : a.left - b.left);
    const size = stacked ? rect.height : rect.width;
    if (panes.length >= 2 && size > 0){
      const firstEnd = stacked ? panes[0].bottom : panes[0].right;
      const secondStart = stacked ? panes[1].top : panes[1].left;
      const zoneStart = stacked ? rect.top : rect.left;
      ratio = Math.max(0, Math.min(1, ((firstEnd + secondStart) / 2 - zoneStart) / size));
    }
  }
  zone.style.setProperty("--split-drop-cut", (ratio * 100) + "%");
  return ratio;
}

// 탭 드래그 중에만 #content 를 덮는 투명 판. 오피스·스프레드시트 뷰어는 iframe 이라 덮개가 없으면
// 그 위에서 dragover 가 부모 문서로 오지 않는다(파일 드롭 오버레이가 화면 전체를 덮는 것과 같은 이유).
function setupSplitDropZone(){
  const content = byId("content");
  if (content._splitDrop) return content._splitDrop;
  const zone = document.createElement("div");
  zone.className = "split-drop";
  zone.hidden = true;
  ["left", "right"].forEach(side => {
    const half = document.createElement("div");
    half.className = "split-drop-half";
    half.dataset.side = side;
    half.appendChild(document.createElement("span"));
    zone.appendChild(half);
  });
  const sideAt = (clientX, clientY) => {
    const rect = zone.getBoundingClientRect();
    let stacked = studyUsesStackedLayout();
    if (!content.classList.contains("study-mode")){
      const dx = Math.abs((clientX - (rect.left + rect.width / 2)) / Math.max(1, rect.width));
      const dy = Math.abs((clientY - (rect.top + rect.height / 2)) / Math.max(1, rect.height));
      stacked = dy > dx;  // 첫 분할은 포인터가 더 가까운 화면 가장자리 방향을 사용한다.
    }
    return splitDropSideAtPoint(clientX, clientY, rect, stacked, syncSplitDropBoundary(zone, stacked));
  };
  const clearSide = () => zone.classList.remove("on-left", "on-right", "on-top", "on-bottom");
  zone.addEventListener("dragover", (e) => {
    if (draggedTabId === null || !isInternalDragTransfer(e.dataTransfer, true)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const side = sideAt(e.clientX, e.clientY);
    if (!content.classList.contains("study-mode")) configureSplitDropZone(zone, side === "top" || side === "bottom");
    clearSide();
    zone.classList.toggle("on-left", side === "left");
    zone.classList.toggle("on-right", side === "right");
    zone.classList.toggle("on-top", side === "top");
    zone.classList.toggle("on-bottom", side === "bottom");
  });
  zone.addEventListener("dragleave", (e) => {
    if (e.target !== zone) return;
    clearSide();
  });
  zone.addEventListener("drop", (e) => {
    if (draggedTabId === null || !isInternalDragTransfer(e.dataTransfer, true)) return;
    e.preventDefault(); e.stopPropagation();
    const id = draggedTabId;
    const side = sideAt(e.clientX, e.clientY);
    if (!content.classList.contains("study-mode")) setStudyStacked(side === "top" || side === "bottom");
    resetDocumentDragState();
    dropTabIntoPane(id, splitDropRoleForSide(side, studySwapped));
  });
  content.appendChild(zone);
  content._splitDrop = zone;
  return zone;
}

// 각 반쪽에 그 칸의 이름을 띄운다 — 분할 방향과 위치 바꾸기 상태에 따라 매번 갱신.
function showSplitDropZone(){
  if (!docs.length) return;
  const zone = setupSplitDropZone();
  const stacked = studyUsesStackedLayout();
  configureSplitDropZone(zone, stacked);
  zone.classList.remove("on-left", "on-right", "on-top", "on-bottom");
  zone.hidden = false;
  syncSplitDropBoundary(zone, stacked);
}
function hideSplitDropZone(){
  const content = byId("content");
  const zone = content && content._splitDrop;
  if (!zone) return;
  zone.hidden = true;
  zone.classList.remove("on-left", "on-right", "on-top", "on-bottom");
}

// 학습 화면 비율 조절 분할바 — 좌우/상하 방향별 비율을 기억하고 포인터 축을 바꿔 사용한다.
function setupStudyDivider(){
  const content = byId("content");
  if (content._studyDivider) return content._studyDivider;
  const divider = document.createElement("div");
  divider.className = "study-divider";
  divider.setAttribute("role", "separator"); divider.tabIndex = 0;
  divider.setAttribute("aria-valuemin", "20"); divider.setAttribute("aria-valuemax", "80");
  let sideRatio = 50, stackRatio = 50;
  try {
    const side = Number(localStorage.getItem("studySplitRatio"));
    const stack = Number(localStorage.getItem("studyStackSplitRatio"));
    if (side >= 20 && side <= 80) sideRatio = side;
    if (stack >= 20 && stack <= 80) stackRatio = stack;
  } catch(e){}
  const isStacked = () => content.classList.contains("study-stacked");
  const apply = (next) => {
    const ratio = Math.max(20, Math.min(80, next));
    if (isStacked()) stackRatio = ratio; else sideRatio = ratio;
    content.style.setProperty("--study-split", ratio + "%");
    divider.setAttribute("aria-valuenow", String(Math.round(ratio)));
  };
  const save = () => {
    try {
      localStorage.setItem(isStacked() ? "studyStackSplitRatio" : "studySplitRatio", String(isStacked() ? stackRatio : sideRatio));
    } catch(e){}
  };
  // 가운데 종료 버튼 — 마지막에 클릭한(테두리 표시) 칸만 남기고 분할을 끝낸다.
  // 헤더의 '분할 작업 종료'까지 마우스를 옮기지 않아도 분할바에서 바로 복귀할 수 있다.
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "study-divider-close";
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 8 9 12 5 16"/><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 8 15 12 19 16"/></svg>';
  closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());   // 분할바 드래그 시작 방지
  closeBtn.addEventListener("dblclick", (e) => e.stopPropagation());      // 더블클릭 위치 바꾸기 방지
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); endStudySplitKeepFocused(); });
  divider.appendChild(closeBtn);
  divider._setStudyDirection = (stacked) => {
    const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
    divider.setAttribute("aria-orientation", stacked ? "horizontal" : "vertical");
    divider.title = _t(stacked
      ? "드래그: 위아래 비율 조절 · 더블클릭: 위아래 바꾸기"
      : "드래그: 좌우 비율 조절 · 더블클릭: 좌우 바꾸기");
    closeBtn.title = _t("마지막에 클릭한 칸(테두리 표시)만 남기고 분할 종료");
    closeBtn.setAttribute("aria-label", closeBtn.title);
    apply(stacked ? stackRatio : sideRatio);
  };
  divider._setStudyDirection(isStacked());
  divider.addEventListener("pointerdown", (e) => {
    if (matchMedia("(max-width: 900px)").matches) return;          // 모바일은 세로 고정 분할
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    const rect = content.getBoundingClientRect();
    const stacked = isStacked();
    const startPoint = stacked ? e.clientY : e.clientX;
    const pointerId = e.pointerId;
    let dragging = false;
    // 분할바가 8px로 좁으므로 누르는 즉시 캡처해야 첫 move 전에 바깥으로 빠져도
    // 드래그를 놓치지 않는다. 실제 비율 변경은 4px 이후라 더블클릭과도 구분된다.
    try { divider.setPointerCapture(pointerId); } catch(_){}
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragging){
        if (Math.abs((stacked ? ev.clientY : ev.clientX) - startPoint) < 4) return;
        dragging = true;
        divider.classList.add("dragging");
      }
      ev.preventDefault();
      apply(stacked
        ? ((ev.clientY - rect.top) / rect.height) * 100
        : ((ev.clientX - rect.left) / rect.width) * 100);
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (dragging){ divider.classList.remove("dragging"); save(); }
      divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up);
      try {
        if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
      } catch(_){}
    };
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", up); divider.addEventListener("pointercancel", up);
  });
  divider.addEventListener("dblclick", () => setStudySwapped(!studySwapped));
  divider.addEventListener("keydown", (e) => {
    const stacked = isStacked();
    const decrease = stacked ? e.key === "ArrowUp" : e.key === "ArrowLeft";
    const increase = stacked ? e.key === "ArrowDown" : e.key === "ArrowRight";
    if (!decrease && !increase) return;
    e.preventDefault();
    apply((stacked ? stackRatio : sideRatio) + (decrease ? -2 : 2));
    save();
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
  content.classList.toggle("study-swapped", split && studySwapped);   // 저장된 위치 교체 적용
  content.classList.toggle("study-stacked", split && studyStacked);   // 저장된 좌우/상하 방향 적용
  content.classList.toggle("study-ref-nonpdf", !!(split && ref && ref.kind !== "pdf"));  // 참고가 PDF가 아니면 PDF 전용 컨트롤(필기·페이지) 숨김
  if (!split) content.classList.remove("study-divider-near");                            // 분할 종료 시 분할바 버튼 표시 상태 정리
  if (split) showStudyControls(); else stopStudyControlsAutoHide();    // 유휴 자동 숨김 시작/정리
  if (typeof syncPdfFindLayout === "function") syncPdfFindLayout();
  if (split){
    setupStudyDivider();                       // 분할바 준비(저장된 비율 적용)
    if (content._studyDivider && typeof content._studyDivider._setStudyDirection === "function")
      content._studyDivider._setStudyDirection(studyStacked);
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
  docs.forEach(syncStudyReadonlyForDoc);
  const pageCtl = byId("studyPageCtl");
  if (pageCtl){
    pageCtl.hidden = !split;
    pageCtl.classList.toggle("non-pdf-ref", !!(split && ref && ref.kind !== "pdf"));
  }
  // 헤더 '분할 작업' 버튼은 CSS(#studyToggle{display:none})로 숨겨둔 상태(삭제 아님 — 나중에 되살릴 수 있음).
  // 명령 팔레트가 이 버튼의 hidden 여부·click() 을 계속 쓰므로 아래 상태 갱신 로직은 그대로 유지한다.
  const btn = byId("studyToggle");
  btn.hidden = docs.length === 0;
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  btn.textContent = _t(ref ? "분할 작업 종료" : "분할 작업");
  btn.title = _t(ref ? "참고 문서 고정을 해제하고 일반 화면으로 돌아가기" : "현재 문서를 참고 화면에 고정하고 작업 문서와 나란히 보기");
  updateStudyDirectionControls();
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

// 분할바 가운데 종료 버튼 — 마지막에 클릭한(테두리 표시) 칸의 문서만 남기고 분할을 끝낸다.
// 참고 칸을 남길 땐 참고 문서를 먼저 활성으로 올린 뒤 종료해 그 문서가 화면에 남는다.
function endStudySplitKeepFocused(){
  const keepId = studySplitEndKeepId(studyPdfId, activeId, studyTargetPane);
  if (keepId === null) return;
  if (keepId !== activeId) setActiveDoc(keepId);
  toggleStudyMode();
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
  if (!tabOrder.includes(doc.id)) tabOrder.push(doc.id);                               // 사이드바에서 바로 고정해도 탭이 생기게(setStudyReference 와 동일 처리)
  if (doc.kind === "pdf" && doc._preStudyZoom == null) doc._preStudyZoom = doc.zoom;   // 종료 시 되돌릴 원래 줌 기억
  applyStudyLayout();
  renderTabs();                                                                        // 참고 문서 탭 표시 갱신
  // 복원된 탭이나 사이드바 항목은 아직 한 번도 활성화되지 않아 지연 렌더 상태일 수 있다.
  // 이런 문서를 바로 참고 칸에 드롭하면 컨테이너만 표시되고 내용은 비어 보이므로,
  // 참고 칸으로 진입하는 경로에서도 첫 렌더를 명시적으로 시작한다.
  ensureRendered(doc).then(() => {
    if (doc.id === studyPdfId && doc.kind === "pdf"){
      startLazyRender(doc); requestAnimationFrame(() => fitStudyPdf(doc));
    }
  });
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
  const d = docs.find(x => x.id === id);
  if (!d) return;
  lastFocusedDocId = d.id;                       // 숨김 상태에서도 "마지막으로 본 문서"는 기억(다시 열 때 이 줄로 이동)
  if (sidebarCollapsed) return;                  // 사이드바 숨김 상태면 스킵
  let changed = false, node = navNodeById(d.nodeId);
  while (node && node.parentId != null){          // 부모 그룹들을 따라 올라가며 펼침
    const parent = navNodeById(node.parentId);
    if (!parent) break;
    if (parent.type === "group"){
      if (!parent.expanded){ parent.expanded = true; changed = true; }
      // 검색 중에 접어 둔 폴더라면 그 표시도 풀어야 이 줄이 실제로 그려진다
      if (sidebarSearchCollapsed.delete(parent.nodeId)) changed = true;
    }
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

// 사이드바를 여는 공통 동선. 숨긴 동안에는 focusSidebarDoc 가 스킵되므로(폴더도 안 펼쳐지고 스크롤도 안 따라감)
// 다시 열 때 마지막으로 보던 문서 줄을 펼치고 그 줄로 커서를 맞춰 준다.
//   reveal:false    → 열기만 한다(검색창·확장자 필터처럼 포커스 갈 곳이 따로 있는 경우)
//   moveFocus:true  → 실제 키보드 포커스까지 목록으로 옮긴다(키보드로 열었을 때만)
// 사이드바가 "실제로 화면에 떠 있는" 상태. 목록이 비어 있으면(파일을 하나도 안 열었으면)
// 접힘 설정과 무관하게 닫힌 것으로 본다 — 버튼 아이콘·문구·클릭 동작이 모두 이 값을 따른다.
function sidebarIsOpen(){ return navNodes.length > 0 && !sidebarCollapsed; }

function openSidebar(opts){
  const o = opts || {};
  if (sidebarCollapsed){
    sidebarCollapsed = false;
    try { localStorage.setItem("sidebarCollapsed", "false"); } catch(e){}
    refreshChrome();                              // inert 해제가 먼저여야 아래 focus() 가 먹는다
  }
  if (o.reveal === false) return;
  // 열림 트랜지션(transform .18s) 중에 포커스를 주면 화면이 밀릴 수 있어 한 프레임 뒤로 미룬다.
  requestAnimationFrame(() => revealSidebarCursorDoc(!!o.moveFocus));
}

function revealSidebarCursorDoc(moveFocus){
  if (sidebarCollapsed) return;
  const id = docs.some(x => x.id === lastFocusedDocId) ? lastFocusedDocId : activeId;
  focusSidebarDoc(id);                            // 상위 폴더 펼침 + 스크롤 + 잠깐 강조
  const el = sidebarItems().find(x => x.dataset.docId === String(id));
  if (el) focusSidebarItem(el, { focus: moveFocus });   // 검색·확장자 필터로 줄이 없으면 커서를 그대로 둔다
}

// 활성 문서의 상위 폴더 체인만 펼치고 나머지 그룹은 모두 접는다 → "정확히 활성 탭 하나만 펼침".
// 폴더 열기·드롭·자동복원이 끝나는 순간에만 호출한다(탭 전환·수동 펼침은 건드리지 않는다).
function collapseToActiveBranch(){
  if (sidebarCollapsed) return;
  const d = docs.find(x => x.id === activeId);
  if (!d) return;
  const keep = new Set();                          // 활성 문서의 상위 그룹(루트 포함)만 펼쳐 둔다
  let node = navNodeById(d.nodeId);
  while (node && node.parentId != null){
    const parent = navNodeById(node.parentId);
    if (!parent) break;
    if (parent.type === "group") keep.add(parent.nodeId);
    node = parent;
  }
  let changed = false;
  for (const n of navNodes){
    if (n.type !== "group") continue;
    const want = keep.has(n.nodeId);
    if (n.expanded !== want){ n.expanded = want; changed = true; }
  }
  if (changed) renderSidebar();
  focusSidebarActive();                            // 정리 후 활성 항목이 보이도록 스크롤
}

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
  if (d.rendered || typeof d.render !== "function"){
    syncStudyReadonlyForDoc(d);
    return Promise.resolve();
  }
  if (d._renderPromise) return d._renderPromise;          // 진행 중인 첫 렌더가 끝날 때까지 후속 이동도 함께 대기
  d._rendering = true;
  const promise = Promise.resolve().then(async () => {
    showLoading("여는 중…");
    try {
      await d.render();
      d.rendered = true;
      // 복원·사이드바 고정처럼 참고 잠금이 편집기 생성보다 먼저 적용된 경우를 포함해
      // 렌더가 만든 모든 코드 입력창에 현재 잠금 상태를 다시 반영한다.
      syncStudyReadonlyForDoc(d);
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
  // 읽기 전용 보기에서 편집으로 들어가면 그때 저장 버튼이 생긴다 — 저장 위치 안내도 같이 따라간다.
  updateOriginalSaveBadge(doc);
  let text = "", cls = "";
  if (doc._pyAutosaveState === "saving"){ text = "자동 저장 중"; cls = "dirty"; }
  else if (doc._pyAutosaveState === "failed"){ text = "자동 저장 실패"; cls = "dirty"; }
  else if (doc.hasUnsavedEdits){ text = "저장 안 됨"; cls = "dirty"; }
  else if (doc.kind === "pdf" && appSettings.pdfRecovery && doc.recoveryDirty){ text = "자동 저장 중"; cls = "dirty"; }
  else if (doc.kind === "pdf" && appSettings.pdfRecovery){ text = "자동 저장됨"; cls = "saved"; }
  if (!text){ badge.hidden = true; return; }
  badge.textContent = (typeof window.t === "function") ? window.t(text) : text; badge.className = "doc-status " + cls; badge.hidden = false;
}

// 편집기 종류와 관계없이 같은 "저장 안 됨" 상태를 사용한다. 개별 뷰어가
// 직접 hasUnsavedEdits 를 만지면 상태 배지·사이드바가 늦게 갱신되기 쉬워서,
// 새 편집 기능은 이 함수를 통해 변경 사실을 알린다.
// 값이 그대로면 아무것도 다시 그리지 않으므로 타자마다 불러도 된다.
function markDocumentDirty(doc, dirty=true){
  if (!doc) return;
  const next = !!dirty;
  if (doc.hasUnsavedEdits === next) return;
  doc.hasUnsavedEdits = next;
  if (doc.id === activeId) updateDocumentStatus(doc);
  if (typeof renderSidebar === "function") renderSidebar();
  if (typeof renderTabs === "function") renderTabs();   // 탭의 점(●) 표시도 함께 켜고 끈다
}

function unsavedDocumentLabel(doc){
  if (!doc) return "문서";
  if (doc.examEdit) return "시험지";
  if (doc.kind === "image") return "이미지 편집";
  if (doc.kind === "board") return "화이트보드";
  if (doc.notebook) return "노트북";
  if (doc.kind === "office" && /\.(xlsx|xls|csv)$/i.test(doc.name || "")) return "스프레드시트";
  if (doc.kind === "office") return "문서";
  return "코드";
}

function recoverySnapshotFile(doc, bytes, type){
  if (!doc || !bytes || typeof File === "undefined") return null;
  const name = doc.name || "recovery.bin";
  const file = new File([bytes], name, { type:type || "application/octet-stream" });
  const path = String(doc.workspacePath || doc.relPath || name).replace(/\\/g, "/").replace(/^\/+/, "");
  if (path && path !== name){
    try { Object.defineProperty(file, "webkitRelativePath", { value:path, configurable:true }); } catch(_){}
  }
  if (doc.fsHandle && typeof withFileHandle === "function") return withFileHandle(file, doc.fsHandle);
  return file;
}

// 작업공간 자동 복원은 File 바이트를 기준으로 동작한다. 표·이미지처럼 자체
// 편집 모델을 가진 뷰어도 최신 스냅샷을 같은 경로로 넣어 다음 실행에 복구한다.
async function saveDocumentRecoverySnapshot(doc, bytes, type){
  if (!doc || !doc.hasUnsavedEdits || !doc.workspacePath || typeof rememberWorkspace !== "function") return false;
  const file = recoverySnapshotFile(doc, bytes, type);
  if (!file) return false;
  try {
    doc.savedInWorkspace = await rememberWorkspace([file], false, { silent:true });
    return !!doc.savedInWorkspace;
  } catch(error){
    console.warn("document recovery snapshot skipped:", error);
    return false;
  }
}

async function markDocumentSavedSnapshot(doc, bytes, type){
  if (!doc) return false;
  const file = recoverySnapshotFile(doc, bytes, type);
  if (file){
    doc.sourceFile = file;
    doc.size = file.size;
    if (typeof rememberWorkspace === "function"){
      try { doc.savedInWorkspace = await rememberWorkspace([file], false, { silent:true }); } catch(error){ console.warn("saved document workspace refresh skipped:", error); }
    }
  }
  markDocumentDirty(doc, false);
  return !!file;
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

/* 지금 이 문서를 저장하면 어디에 쓰이는지 한곳에서 판단한다.
   예전에는 "원본 저장"일 때만 배지를 띄워서, 배지가 없을 때가 "사본으로 저장된다"는 뜻인지
   "저장할 수 없는 문서"라는 뜻인지 화면만 봐서는 알 수 없었다. 두 경우를 나눠 말해 준다.
   반환: { mode:"original"|"copy"|"", label, title } */
function documentSaveTarget(doc){
  if (!doc) return { mode:"", label:"", title:"", summary:"" };
  // 저장 동선이 실제로 있는 문서만 — Ctrl+S 처리(app.js)와 같은 기준을 쓴다.
  const savable = !!(doc.notebookModel || doc.kind === "pdf" || doc.saveCapability === "spreadsheet"
    || (doc.el && doc.el.querySelector(".run-save")));
  if (!savable) return { mode:"", label:"", title:"", summary:"" };
  const handle = doc.fsHandle;
  const canWriteOriginal = !!(handle && typeof handle.createWritable === "function");
  // PDF의 낱개 파일 열기는 쓰기 핸들이 있어도 `_signed.pdf` 다운로드가 기본이다.
  // 폴더의 원본 저장 모드로 연 경우에만 exportPdf가 원본을 덮어쓴다. 이미지도 같은 기준이고,
  // 거기에 더해 원본이 png·jpg 일 때만 덮어쓴다(그 외 형식은 _edited.png 사본이라 "사본 저장"이 맞다).
  const originalByHandle = doc.kind !== "pdf" && doc.kind !== "image" && canWriteOriginal;
  const imageKeepsFormat = doc.kind !== "image" || /\.(png|jpe?g)$/i.test(doc.name || "");
  if ((doc.originalSaveMode || originalByHandle) && imageKeepsFormat){
    return {
      mode:"original",
      label:"원본 저장",
      title:"저장하면 이 파일의 원본이 바로 바뀝니다. (열어 둔 폴더·파일에 직접 씁니다)",
      summary:"저장하면 열어 둔 원본 파일을 바로 바꿉니다."
    };
  }
  const viaServer = doc.kind !== "pdf" && typeof workspaceBackendStatus === "function"
    && workspaceBackendStatus() === true;
  return {
    mode:"copy",
    label:"사본 저장",
    summary: viaServer
      ? "원본은 그대로 두고 설정된 자동 저장 폴더에 사본을 저장합니다."
      : "원본은 그대로 두고 다운로드 사본을 저장합니다.",
    title: viaServer
      ? "원본은 그대로 두고 '설정 → 일반 → 자동 저장 폴더'에 사본으로 저장합니다. 원본에 바로 저장하려면 '열기 → 폴더 열기'로 폴더를 여세요."
      : "원본은 그대로 두고 사본(다운로드)으로 저장합니다. 원본에 바로 저장하려면 '열기 → 폴더 열기'로 폴더를 여세요."
  };
}

let saveTargetNoticeTimer = 0;
const SAVE_TARGET_NOTICE_MS = 4000;

function hideSaveTargetNotice(){
  if (saveTargetNoticeTimer){
    clearTimeout(saveTargetNoticeTimer);
    saveTargetNoticeTimer = 0;
  }
  const bar = byId("saveTargetBar");
  if (!bar) return;
  bar.hidden = true;
  bar.classList.remove("notice-active");
  delete bar.dataset.noticeDocId;
  delete bar.dataset.noticeKey;
}

function updateOriginalSaveBadge(doc){
  const badge = byId("originalSaveBadge");
  if (!badge) return;
  if (doc && doc.kind !== "pdf" && typeof workspaceBackendStatus === "function" && workspaceBackendStatus() === null
      && typeof workspaceBackendAvailable === "function" && !badge._backendProbe){
    badge._backendProbe = true;
    workspaceBackendAvailable().finally(() => {
      badge._backendProbe = false;
      if (typeof state !== "undefined" && state === doc) updateOriginalSaveBadge(doc);
    });
  }
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  const target = documentSaveTarget(doc);
  badge.hidden = !target.mode;
  badge.textContent = _t(target.label);
  badge.title = target.mode ? _t(target.summary || target.title) : "";
  badge.classList.toggle("is-copy", target.mode === "copy");
  if (target.mode) badge.setAttribute("aria-label", _t(target.label) + " — " + _t(target.summary || target.title));
  else badge.removeAttribute("aria-label");
  const bar = byId("saveTargetBar");
  const barLabel = byId("saveTargetBarLabel");
  const barText = byId("saveTargetBarText");
  if (!doc || !target.mode){
    hideSaveTargetNotice();
  } else if (bar && barLabel && barText){
    const noticeDocId = String(doc.id == null ? "" : doc.id);
    const noticeKey = target.mode + "|" + String(target.summary || target.title || "");
    const shouldShow = doc._saveTargetNoticeKey !== noticeKey;
    if (!shouldShow && bar.dataset.noticeDocId !== noticeDocId){
      hideSaveTargetNotice();
    } else if (shouldShow){
      doc._saveTargetNoticeKey = noticeKey;
      if (saveTargetNoticeTimer) clearTimeout(saveTargetNoticeTimer);
      bar.hidden = false;
      bar.classList.remove("notice-active");
      void bar.offsetWidth;
      bar.classList.add("notice-active");
      bar.dataset.noticeDocId = noticeDocId;
      bar.dataset.noticeKey = noticeKey;
      barLabel.textContent = _t(target.label);
      barText.textContent = _t(target.summary);
      bar.title = _t(target.summary || target.title);
      saveTargetNoticeTimer = setTimeout(() => {
        if (bar.dataset.noticeDocId === noticeDocId && bar.dataset.noticeKey === noticeKey){
          hideSaveTargetNotice();
        }
      }, SAVE_TARGET_NOTICE_MS);
    }
    bar.classList.toggle("is-original", target.mode === "original");
    bar.classList.toggle("is-copy", target.mode === "copy");
  }
  if (!doc) return;
  const actionLabel = target.mode ? _t(target.label) : _t("저장");
  if (doc.kind === "pdf"){
    const pdfSave = byId("btnDownload");
    if (pdfSave){
      pdfSave.textContent = actionLabel;
      pdfSave.title = target.mode ? _t(target.title) : "";
      pdfSave.dataset.shortcutTitle = target.mode ? "PDF " + actionLabel : _t("PDF 저장");
    }
  }
  if (doc.el){
    doc.el.querySelectorAll(".run-save").forEach(button => {
      button.textContent = actionLabel;
      button.title = target.mode ? _t(target.title) : "";
      button.dataset.shortcutTitle = target.mode ? actionLabel : _t("파일 저장");
    });
  }
  if (doc._nbSaveBtn && typeof updateNbSaveButton === "function") updateNbSaveButton(doc, doc._nbSaveBtn);
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
  if (doc.kind === "diff") return "파일 비교";
  if (doc.kind === "image-gallery") return "이미지 모아보기";
  if (doc.kind === "pdf-gallery") return "PDF 모아보기";
  if (ext === ".py" || ext === ".pyw") return "Python 실습";
  if (doc.kind === "image") return "이미지 보기";
  if (doc.kind === "binary") return "이진 파일 보관";
  if (doc.kind === "video") return doc.media === "audio" ? "오디오 재생" : "영상 재생";
  if (ext === ".docx") return "Word 보기";
  if (ext === ".doc") return "Word 글자 보기";
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
  if (i < 0) return false;
  const d = docs[i];
  if (!options.skipConfirm && d.hasUnsavedEdits){
    if (!confirm(`'${d.name}'의 저장하지 않은 ${unsavedDocumentLabel(d)} 수정이 있습니다. 닫을까요?`)) return false;
  }
  if (!options.skipConfirm && typeof pdfHasPendingEdits === "function" && pdfHasPendingEdits(d)){
    const msg = appSettings.pdfRecovery
      ? `'${d.name}'의 편집 화면을 닫을까요? 편집 내용은 다음에 같은 PDF를 열 때 복원할 수 있습니다.`
      : `'${d.name}'의 편집 내용이 사라집니다. 자동 저장·복원이 꺼져 있어 다시 열어도 복원할 수 없어요. 닫을까요?`;
    if (!confirm(msg)) return false;
  }
  if (d.kind === "pdf"){
    clearTimeout(d.recoveryTimer);
    if (d.pdfHistory) d.pdfHistory.cancel();
    if (d.recoveryDirty) savePdfRecovery(d);
  }
  d.closed = true;
  // 사용자가 직접 닫은(내부 이동/일괄 닫기가 아닌) 파일만 복원 스택에 쌓는다(Ctrl+Shift+T).
  if (!options.skipUi && d.__reopen && d.__reopen.file){
    closedDocStack.push(d.__reopen);
    if (closedDocStack.length > 12) closedDocStack.shift();
  }
  if (d.sourceKey && docsBySourceKey.get(d.sourceKey) === d) docsBySourceKey.delete(d.sourceKey);
  contentCacheDrop(id);                        // 내용 검색 캐시 정리(총량 계산도 함께 되돌린다)
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
  return true;
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
      contentCacheDrop(doc.id);                                            // 갱신된 스냅샷 기준으로 검색 캐시도 무효화
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
async function refreshDocFromSource(id, options={}){
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
  if (!options.skipConfirm && doc.hasUnsavedEdits){
    const ok = await confirmDialog(`저장하지 않은 ${unsavedDocumentLabel(doc)} 수정이 있습니다. 원본으로 새로고침하면 현재 편집 내용이 사라질 수 있어요.`, "새로고침", "취소");
    if (!ok) return;
  }
  if (!options.skipConfirm && typeof pdfHasPendingEdits === "function" && pdfHasPendingEdits(doc)){
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
function resetDocumentDragState(){
  draggedTabId = null;
  clearTabDropMarkers();
  hideSplitDropZone();
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
  // 오른쪽 끝에 항상 붙는 칠판 버튼(새 화이트보드, 32px)과 숨은 탭 버튼(82px) 자리를 미리 빼둔다.
  const usable = Math.max(210, (width || window.innerWidth || 800) - 114);
  return Math.max(1, Math.min(6, Math.floor(usable / 210)));
}

// 헤더 아래 탭바: tabOrder(선택한 문서 순서) 중 현재 열려있는 것만 표시(1개여도 보인다)
function renderTabs(){
  if (typeof closeTabMenu === "function") closeTabMenu();          // 다시 그릴 때 떠 있던 우클릭 메뉴 정리
  tabOrder = tabOrder.filter(id => docs.some(d => d.id === id));   // 닫힌 문서 정리
  // 화면에 보이는 문서는 반드시 탭에도 있어야 한다. 복원/일괄 열기 중 순서가 꼬여도 여기서 보정한다.
  if (activeId && docs.some(d => d.id === activeId) && !tabOrder.includes(activeId)) tabOrder.unshift(activeId);
  persistTabState();                                               // 탭 구성을 저장해 다음 실행 때 복원
  const bar = byId("tabBar");
  if (!bar) return;
  if (!tabOrder.length){ bar.hidden = true; bar.innerHTML = ""; return; }     // 열린 탭이 없을 때만 숨긴다
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
    // 탭이 하나뿐이면 재정렬할 곳도, 사용자가 직접 고른 분할 짝도 없다.
    // 사이드바에만 있는 다른 파일을 임의로 짝지어 분할하지 않도록 상단 탭 드래그를 막는다.
    const canDragTab = tabOrder.length > 1;
    const tab = document.createElement("div");
    tab.className = "tab" + (id === activeId ? " active" : "") + (studyPdfId !== null && id === studyPdfId && id !== activeId ? " study-ref" : "");   // 분할 참고 문서 표시
    tab.draggable = canDragTab;
    const cat = extCategory(d.kind, d.name);
    if (cat) tab.dataset.cat = cat;
    tab.title = d.name + (d.hasUnsavedEdits ? " · 저장 후 수정됨" : "") +
      (d.textEncoding ? " · 인코딩: " + d.textEncoding.label : "") +
      (canDragTab ? " · 드래그: 탭바에서 위치 변경 · 본문 좌우로 끌면 분할" : " · 탭이 하나일 때는 분할 드래그 안 됨") +
      " · 우클릭: 탭 정리";
    tab.onclick = () => openDocInTargetPane(d.id);   // 분할 화면이면 마지막 클릭 칸에 열기
    tab.addEventListener("contextmenu", (e) => { e.preventDefault(); openTabMenu(id, e.clientX, e.clientY); });
    tab.addEventListener("dragstart", (e) => {
      // draggable=false가 적용되지 않는 합성 이벤트나 브라우저 예외 상황에서도 분할 진입을 차단한다.
      if (!canDragTab){ e.preventDefault(); return; }
      draggedTabId = id;
      tab.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(INTERNAL_DRAG_MIME, "document");
      // 드래그 대상은 draggedTabId 로 가린다. 여기 text/plain 은 바깥 앱으로 끌었을 때만 쓰이므로
      // 뜻 없는 문서 번호 대신 파일명을 넣는다.
      e.dataTransfer.setData("text/plain", d.name);
      showSplitDropZone();                      // 본문 좌우 드롭 안내 표시(iframe 뷰어 위까지 덮는다)
    });
    tab.addEventListener("dragover", (e) => {
      if (draggedTabId === null || draggedTabId === id || !isInternalDragTransfer(e.dataTransfer, true)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      tab.classList.toggle("drop-before", !after);
      tab.classList.toggle("drop-after", after);
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("drop-before", "drop-after"));
    tab.addEventListener("drop", (e) => {
      if (draggedTabId === null || draggedTabId === id || !isInternalDragTransfer(e.dataTransfer, true)) return;
      e.preventDefault(); e.stopPropagation();
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      const movedId = draggedTabId;
      resetDocumentDragState();
      moveTab(movedId, id, after);
    });
    tab.addEventListener("dragend", resetDocumentDragState);
    const ic = document.createElement("span"); ic.className = "tab-ic"; ic.textContent = iconFor(d.kind, d.name);
    const nm = document.createElement("span"); nm.className = "tab-name"; nm.textContent = d.name;
    // 수정된 탭은 오른쪽 끝에 점(●)을 보이고, 마우스를 올리면 그 자리에 닫기(✕)가 나온다(사이드바 표시와 톤 통일).
    const dot = document.createElement("span"); dot.className = "tab-dot"; dot.textContent = "●";
    dot.setAttribute("aria-hidden", "true");
    if (d.hasUnsavedEdits) tab.classList.add("dirty");
    const x = document.createElement("button"); x.className = "tab-x"; x.textContent = "✕";
    const closesStudyPane = studyPdfId !== null && (id === studyPdfId || id === activeId);
    x.title = closesStudyPane ? "탭 닫기 및 분할 작업 종료(파일은 사이드바에 유지)" : "탭만 닫기(파일은 사이드바에 유지)";
    x.onclick = (e) => { e.stopPropagation(); untabDoc(d.id); };
    const tail = document.createElement("span"); tail.className = "tab-tail"; tail.append(dot, x);
    tab.append(ic, nm, tail);
    bar.appendChild(tab);
  });
  // 마지막 탭 옆 칠판 버튼 (브라우저 새 탭과 같은 자리) — 문서를 설명하다 바로 판서할 화이트보드를 연다.
  // 사이드바가 접혀 있거나 드롭존이 문서에 가려진 상태에서도 늘 보이는 유일한 새로 만들기 진입점이다.
  const newBoardBtn = document.createElement("button");
  newBoardBtn.type = "button"; newBoardBtn.className = "tab-new-board";
  // ＋ 대신 칠판 아이콘 — 눌렀을 때 무엇이 열리는지 기호만 봐도 알 수 있게 한다(엑셀 시트 탭의 ＋ 와도 구분된다).
  if (typeof setUiIcon === "function") setUiIcon(newBoardBtn, "board"); else newBoardBtn.textContent = "＋";
  newBoardBtn.dataset.shortcutAction = "newBoard";
  newBoardBtn.dataset.shortcutTitle = "새 화이트보드";
  newBoardBtn.dataset.shortcutAria = "true";
  newBoardBtn.onclick = () => { if (typeof newWhiteboard === "function") newWhiteboard(); };
  bar.appendChild(newBoardBtn);
  if (typeof syncShortcutHints === "function") syncShortcutHints(bar);   // 제목·aria 에 현재 단축키 표기 반영
  if (hiddenIds.length){
    const wrap = document.createElement("div"); wrap.className = "tab-overflow";
    const more = document.createElement("button"); more.type = "button"; more.className = "tab-more";
    const hiddenDirtyCount = hiddenIds.reduce((count, id) => {
      const doc = docs.find(d => d.id === id);
      return count + (doc && doc.hasUnsavedEdits ? 1 : 0);
    }, 0);
    const moreCount = document.createElement("span"); moreCount.textContent = "+" + hiddenIds.length;
    more.appendChild(moreCount);
    more.title = "숨겨진 탭 " + hiddenIds.length + "개";
    if (hiddenDirtyCount){
      const moreDirty = document.createElement("span"); moreDirty.className = "tab-more-dirty";
      moreDirty.textContent = "●" + hiddenDirtyCount; moreDirty.setAttribute("aria-hidden", "true");
      more.appendChild(moreDirty);
      more.title += " · 저장 후 수정됨 " + hiddenDirtyCount + "개";
      more.setAttribute("aria-label", more.title);
    }
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
        const name = document.createElement("span"); name.className = "tab-overflow-name"; name.textContent = doc.name;
        item.append(badge, name);
        if (doc.hasUnsavedEdits){
          const dirty = document.createElement("span"); dirty.className = "tab-overflow-dirty"; dirty.textContent = "●";
          dirty.setAttribute("aria-hidden", "true"); item.appendChild(dirty);
          item.title = doc.name + " · 저장 후 수정됨"; item.setAttribute("aria-label", item.title);
        }
        item.onclick = () => openDocInTargetPane(id); list.appendChild(item); count++;
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
  if (studyPdfId !== null && (id === studyPdfId || id === activeId)) toggleStudyMode();
  tabOrder.splice(i, 1);
  if (id === activeId && tabOrder.length){
    // 직전에 보던 문서로 돌아간다(closeDoc 과 같은 VSCode 패턴). Ctrl+클릭 정의 이동으로 연 탭을
    // 닫으면 원래 편집하던 화면으로 복귀. 이력에 탭으로 살아있는 게 없으면 옆 탭으로 폴백.
    const prevId = activeMru.find(x => x !== id && tabOrder.includes(x));
    setActiveDoc(prevId != null ? prevId : tabOrder[Math.min(i, tabOrder.length - 1)]);
  }
  // 마지막 탭을 닫으면 보던 문서도 내린다. 그대로 두면 renderTabs 가 "보이는 문서는 탭에도 있어야 한다"는
  // 규칙으로 방금 닫은 탭을 되살려, 탭 × 가 아무 일도 안 한 것처럼 보인다(파일은 사이드바에 그대로).
  else if (id === activeId) setActiveDoc(0);
  else renderTabs();
}

// 여러 탭을 한 번에 탭바에서 정리(파일은 닫지 않고 사이드바에 유지). anchorId 는 항상 남긴다.
function untabMany(removeIds, anchorId){
  const removeSet = new Set(removeIds);
  removeSet.delete(anchorId);                                  // 기준(우클릭한) 탭은 보존
  if (!tabOrder.some(id => removeSet.has(id))) return;
  if (studyPdfId !== null && (removeSet.has(studyPdfId) || removeSet.has(activeId))) toggleStudyMode();   // 표시 중인 참고·작업 탭이 닫히면 분할 작업 먼저 종료
  const activeRemoved = removeSet.has(activeId);
  tabOrder = tabOrder.filter(id => !removeSet.has(id));
  if (activeRemoved) setActiveDoc(anchorId);                  // 닫힌 탭이 활성이었으면 기준 탭으로 이동(내부에서 renderTabs)
  else renderTabs();
}

/* ===== 원본 파일 이름 바꾸기 =====
 * '폴더 열기'로 쓰기 권한을 받은 실제 파일만 이름을 바꿀 수 있다.
 * 개별 파일·압축 내부·자동 복원 사본처럼 부모 폴더를 확실히 알 수 없는 문서에는 메뉴 자체를 노출하지 않는다. */
function originalRenameRootForDoc(doc){
  let parentId = doc && doc.parentId;
  while (parentId){
    const group = navNodes.find(node => node.nodeId === parentId && node.type === "group");
    if (!group) return null;
    if (group.folderRefreshRootId === group.nodeId) return group;
    parentId = group.parentId;
  }
  return null;
}

function originalRenamePath(doc){
  return String((doc && (doc.workspacePath || doc.relPath)) || "")
    .replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/* 원본 파일을 손대는 동작(이름 바꾸기·삭제)이 지금 가능한지.
   requireSaved: 이름 바꾸기는 복구 데이터 경로를 함께 옮겨야 해서 저장을 먼저 요구한다.
                 삭제는 파일 자체를 버리는 동작이라 저장되지 않은 편집을 따지지 않는다. */
function canModifyOriginalDoc(doc, requireSaved){
  if (!doc || !doc.originalSaveMode || (doc.isScratch && !doc.fsHandle)) return false;
  if (requireSaved){
    if (doc.hasUnsavedEdits) return false;
    if (typeof pdfHasPendingEdits === "function" && pdfHasPendingEdits(doc)) return false;
  }
  // .ipynb 를 메모리에서 .py 로 변환한 문서는 실제 .py 원본이 생기기 전까지 제외한다.
  if (doc.notebook && /\.py$/i.test(doc.name || "") && !doc.fsHandle) return false;
  const root = originalRenameRootForDoc(doc);
  if (!root || !originalRenamePath(doc)) return false;
  const directDir = doc.fsDirHandle;
  if (directDir && typeof directDir.getFileHandle === "function" && typeof directDir.removeEntry === "function") return true;
  const rootHandle = root.folderHandle;
  return !!(rootHandle && typeof rootHandle.getDirectoryHandle === "function");
}

function canRenameOriginalDoc(doc){ return canModifyOriginalDoc(doc, true); }
function canDeleteOriginalDoc(doc){ return canModifyOriginalDoc(doc, false); }

async function originalRenameContext(doc, requireSaved=true){
  if (!canModifyOriginalDoc(doc, requireSaved)) return null;
  const root = originalRenameRootForDoc(doc);
  const path = originalRenamePath(doc);
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 1 && parts[0] !== root.name) return null;
  if (parts[0] === root.name) parts.shift();
  if (!parts.length || parts.some(part => part === "." || part === "..")) return null;
  const oldName = parts.pop();

  let dirHandle = doc.fsDirHandle || null;
  if (!dirHandle){
    let rootHandle = root.folderHandle || null;
    if (!rootHandle && typeof loadRememberedFolderHandle === "function"){
      rootHandle = await loadRememberedFolderHandle(root.name);
      if (rootHandle) root.folderHandle = rootHandle;
    }
    if (!rootHandle || typeof rootHandle.getDirectoryHandle !== "function") return null;
    dirHandle = rootHandle;
    for (const part of parts) dirHandle = await dirHandle.getDirectoryHandle(part);
  }
  if (!dirHandle || typeof dirHandle.getFileHandle !== "function" || typeof dirHandle.removeEntry !== "function") return null;

  let permission = typeof dirHandle.queryPermission === "function"
    ? await dirHandle.queryPermission({ mode:"readwrite" }) : "granted";
  if (permission !== "granted" && typeof dirHandle.requestPermission === "function")
    permission = await dirHandle.requestPermission({ mode:"readwrite" });
  if (permission !== "granted") return null;

  let fileHandle = doc.fsHandle;
  if (!fileHandle || typeof fileHandle.getFile !== "function") fileHandle = await dirHandle.getFileHandle(oldName);
  return { root, path, oldName, dirHandle, fileHandle };
}

async function originalRenameTargetExists(ctx, newName){
  try {
    const existing = await ctx.dirHandle.getFileHandle(newName);
    if (ctx.fileHandle && typeof ctx.fileHandle.isSameEntry === "function"){
      try { if (await ctx.fileHandle.isSameEntry(existing)) return "same"; } catch(_){ }
    }
    return "other";
  } catch(error){
    if (error && error.name === "NotFoundError") return "none";
    throw error;
  }
}

async function moveOriginalFile(ctx, newName){
  const targetState = await originalRenameTargetExists(ctx, newName);
  if (targetState === "other") throw new Error("rename-target-exists");

  // Chromium이 실제 파일 시스템 move를 제공하면 원자적인 이름 변경을 우선한다.
  if (typeof ctx.fileHandle.move === "function"){
    let moved = false;
    try {
      await ctx.fileHandle.move(newName);
      moved = true;
    } catch(error){
      // 대소문자만 다른 이름은 복사 폴백으로 안전하게 처리할 수 없다.
      if (targetState === "same") throw error;
    }
    if (moved){
      try { return await ctx.dirHandle.getFileHandle(newName); }
      catch(_){ return ctx.fileHandle; }   // move가 끝난 뒤 재조회만 실패했으면 복사 폴백으로 되돌아가지 않는다.
    }
  } else if (targetState === "same"){
    throw new Error("rename-case-only-unsupported");
  }

  // move 미지원 환경: 새 파일을 완전히 쓴 것을 확인한 뒤에만 옛 항목을 지운다.
  const source = await ctx.fileHandle.getFile();
  let targetHandle = null;
  let created = false;
  try {
    targetHandle = await ctx.dirHandle.getFileHandle(newName, { create:true });
    created = true;
    const writable = await targetHandle.createWritable();
    try { await writable.write(source); await writable.close(); }
    catch(error){ try { await writable.abort(); } catch(_){ } throw error; }
    const copied = await targetHandle.getFile();
    if (copied.size !== source.size) throw new Error("rename-copy-incomplete");
    await ctx.dirHandle.removeEntry(ctx.oldName);
    return targetHandle;
  } catch(error){
    if (created){ try { await ctx.dirHandle.removeEntry(newName); } catch(_){ } }
    throw error;
  }
}

function replaceWorkspacePathInGroups(oldPath, newPath){
  for (const node of navNodes){
    if (!node || !Array.isArray(node.workspacePaths)) continue;
    node.workspacePaths = node.workspacePaths.map(path =>
      String(path || "").replace(/\\/g, "/") === oldPath ? newPath : path);
  }
}

async function applyOriginalRename(doc, ctx, newName, newHandle){
  const oldPath = ctx.path;
  const newPath = refreshWorkspacePath(oldPath, newName);
  let fresh = await newHandle.getFile();
  fresh = withDirHandle(withFileHandle(fresh, newHandle), ctx.dirHandle);
  if (typeof setFileRelativePath === "function") setFileRelativePath(fresh, newPath);

  if (doc.sourceKey && docsBySourceKey.get(doc.sourceKey) === doc) docsBySourceKey.delete(doc.sourceKey);
  doc.name = newName;
  if (Object.prototype.hasOwnProperty.call(doc, "fileName")) doc.fileName = newName;
  doc.workspacePath = doc.workspacePath ? refreshWorkspacePath(doc.workspacePath, newName) : newPath;
  if (doc.relPath) doc.relPath = refreshWorkspacePath(doc.relPath, newName);
  doc.fsHandle = newHandle;
  doc.fsDirHandle = ctx.dirHandle;
  if (newHandle && newHandle.nativePath) doc.nativeAbsolutePath = newHandle.nativePath;
  doc.sourceFile = fresh;
  doc.size = fresh.size || 0;
  doc.__srcMtime = fresh.lastModified || 0;
  doc.sourceKey = [doc.parentId || "root", doc.workspacePath || doc.relPath || newName, doc.size, doc.__srcMtime].join("|");
  docsBySourceKey.set(doc.sourceKey, doc);
  doc.stableRestoreKey = "";
  doc.stableRestoreKey = docStableKey(doc);
  if (typeof contentCacheDrop === "function") contentCacheDrop(doc.id);
  if (doc.archiveCtx && typeof doc.archiveCtx.rename === "function") doc.archiveCtx.rename(oldPath, newPath, fresh);
  replaceWorkspacePathInGroups(oldPath, newPath);

  if (typeof saveFsHandle === "function") await saveFsHandle(newPath, newHandle);
  if (typeof forgetFsHandle === "function" && oldPath !== newPath) await forgetFsHandle(oldPath);
  if (typeof forgetWorkspacePaths === "function" && oldPath !== newPath) forgetWorkspacePaths([oldPath]);
  if (typeof rememberWorkspace === "function"){
    try {
      await rememberWorkspace([fresh], false, { silent:true,
        folderPaths:ctx.root.folderPaths || [],
        originalSaveFolderPaths:ctx.root.originalSaveMode ? [ctx.root.name] : [] });
    } catch(error){ console.warn("renamed file workspace refresh skipped:", error); }
  }
}

async function renameDoc(id){
  const doc = docs.find(d => d.id === id);
  if (!doc || !canRenameOriginalDoc(doc) || typeof askText !== "function") return;
  let ctx;
  try { ctx = await originalRenameContext(doc); }
  catch(error){ console.warn(error); toast("원본 폴더에 접근하지 못했어요.", 3000); return; }
  if (!ctx){ toast("원본 파일 이름을 바꿀 권한이 없어요.", 3000); return; }
  const input = await askText({
    title: "이름 바꾸기",
    message: "디스크에 있는 원본 파일 이름이 실제로 바뀝니다.",
    value: ctx.oldName, okText: "바꾸기"
  });
  if (input === null) return;
  let name = String(input).replace(/[\\/:*?"<>|]/g, "").trim().replace(/[. ]+$/, "");
  if (!name || name === "." || name === ".." || name === ctx.oldName) return;
  const oldName = String(ctx.oldName);
  const oldExt = fileExtOf(oldName.toLowerCase());
  const hasOldExt = oldExt && oldExt !== oldName.toLowerCase();
  if (hasOldExt && !name.toLowerCase().endsWith("." + oldExt)){
    name = name.replace(/\.+$/, "") + "." + oldExt;        // 확장자 유지(빼거나 바꿔 적어도 원래 확장자로)
  }
  if (!name || name === oldName) return;
  try {
    const newHandle = await moveOriginalFile(ctx, name);
    await applyOriginalRename(doc, ctx, name, newHandle);
  } catch(error){
    console.warn("original file rename failed:", error);
    const code = String(error && error.message || "");
    if (code === "rename-target-exists") toast("같은 폴더에 동일한 이름의 파일이 이미 있어요.", 3400);
    else if (code === "rename-case-only-unsupported") toast("이 환경에서는 대소문자만 바꾸는 이름 변경을 지원하지 않아요.", 3600);
    else if (error && error.name === "NotAllowedError") toast("원본 파일 이름을 바꿀 권한이 없어요.", 3200);
    else toast("원본 파일 이름을 바꾸지 못했어요. 기존 파일은 유지됩니다.", 3600);
    return;
  }
  renderSidebar();
  renderTabs();
  if (doc.el) doc.el.querySelectorAll(".text-view-name").forEach(el => { el.textContent = name; });
  if (doc.id === activeId){
    const hdr = byId("activeFileName");
    if (hdr) hdr.textContent = name;
  }
  if (typeof persistTabState === "function") persistTabState();
  toast("원본 파일 이름을 '" + name + "'(으)로 바꿨어요.", 3200, { type: "success" });
}

/* ===== 원본 파일 삭제 =====
   앱에서 치우기(closeDoc)와 달리 디스크의 파일을 실제로 지운다.
   브라우저의 폴더 권한(removeEntry)으로 지우므로 휴지통을 거치지 않는 '영구 삭제'다.
   되돌릴 수 없으니 확인 문구에서 그 사실과 대상 이름을 분명히 밝힌다. */
async function deleteOriginalFile(doc){
  const ctx = await originalRenameContext(doc, false);
  if (!ctx) throw new Error("delete-no-permission");
  await ctx.dirHandle.removeEntry(ctx.oldName);
  // 지운 파일의 흔적(저장 위치 기억·최근 목록·자동 복원본)도 함께 정리한다.
  const workspacePath = doc.workspacePath || doc.relPath || doc.name;
  if (typeof forgetFsHandle === "function") forgetFsHandle(workspacePath);
  if (typeof MNRecent !== "undefined") MNRecent.forget("file", workspacePath);
}

function deleteConfirmMessage(targets){
  if (targets.length === 1){
    return "'" + targets[0].name + "' 을(를) 디스크에서 완전히 지웁니다.\n" +
      "휴지통으로 가지 않으므로 되돌릴 수 없어요.";
  }
  const preview = targets.slice(0, 5).map(doc => doc.name).join(", ");
  const rest = targets.length > 5 ? " 외 " + (targets.length - 5) + "개" : "";
  return "파일 " + targets.length + "개를 디스크에서 완전히 지웁니다.\n" + preview + rest + "\n" +
    "휴지통으로 가지 않으므로 되돌릴 수 없어요.";
}

/* 문서 목록을 디스크에서 지운다(확인 후). 지울 수 없는 항목은 건너뛰고 이유를 알려 준다. */
async function deleteDocsFromDisk(ids){
  const all = ids.map(id => docs.find(d => d.id === id)).filter(Boolean);
  if (!all.length) return;
  const targets = all.filter(canDeleteOriginalDoc);
  const skipped = all.length - targets.length;
  if (!targets.length){
    toast(all.length === 1
      ? "이 파일은 앱에서 지울 수 없어요. '열기 → 폴더 열기'로 연 파일만 디스크에서 지울 수 있어요."
      : "선택한 파일 중 디스크에서 지울 수 있는 것이 없어요. '열기 → 폴더 열기'로 연 파일만 지울 수 있어요.", 5000);
    return;
  }
  if (typeof confirmDialog !== "function") return;
  const ok = await confirmDialog(deleteConfirmMessage(targets), "완전히 지우기", "취소");
  if (!ok) return;

  const failed = [];
  let removed = 0;
  for (const doc of targets){
    try {
      await deleteOriginalFile(doc);
      closeDoc(doc.id, { forgetWorkspace:true, skipConfirm:true });
      removed++;
    } catch(error){
      console.warn("original file delete failed:", doc.name, error);
      failed.push(doc.name);
    }
  }
  clearSidebarSelection();
  if (removed && !failed.length){
    toast(removed === 1 ? "'" + targets[0].name + "' 을(를) 지웠어요." : "파일 " + removed + "개를 지웠어요.",
      2800, { type:"success" });
  } else if (removed){
    toast("파일 " + removed + "개를 지웠어요. " + failed.length + "개는 지우지 못했어요: " + failed.slice(0, 3).join(", "),
      5000, { type:"error" });
  } else {
    toast("지우지 못했어요. 파일이 다른 프로그램에서 열려 있거나 권한이 없을 수 있어요.", 5000, { type:"error" });
  }
  // 폴더로 열지 않은 파일은 앱이 디스크 위치를 몰라 건드리지 않는다(그대로 열린 채 남는다).
  if (skipped) toast("폴더로 열지 않은 파일 " + skipped + "개는 그대로 두었어요. 탐색기에서 직접 지워 주세요.", 4600);
}

function documentRelativePathForCopy(doc){
  return String((doc && (doc.workspacePath || doc.relPath || doc.name)) || "")
    .replace(/\\/g, "/").replace(/^\/+/, "");
}

async function copyDocumentMenuText(text, successMessage){
  const value = String(text || "");
  let copied = false;
  if (value){
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch(_){ }
    if (!copied){
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try { copied = !!document.execCommand("copy"); } catch(_){ }
      textarea.remove();
    }
  }
  const message = copied ? successMessage : "복사하지 못했어요.";
  toast(typeof window.t === "function" ? window.t(message) : message, 1800,
    copied ? { type:"success" } : undefined);
  return copied;
}

function copyDocumentName(doc){
  return copyDocumentMenuText(doc && doc.name, "파일 이름을 복사했어요.");
}

function copyDocumentRelativePath(doc){
  return copyDocumentMenuText(documentRelativePathForCopy(doc), "상대 경로를 복사했어요.");
}

async function deleteUnsavedScratchDoc(doc){
  if (!doc || !doc.isScratch || doc._named) return false;
  const message = "'" + (doc.name || "새 문서") + "'은 아직 저장되지 않았습니다. 이 문서를 삭제할까요?";
  const ok = typeof confirmDialog === "function"
    ? await confirmDialog(message, "삭제", "취소")
    : window.confirm(message);
  if (!ok) return false;
  const path = String(doc.workspacePath || doc.relPath || doc.name || "");
  if (doc.archiveCtx && typeof doc.archiveCtx.remove === "function") doc.archiveCtx.remove(path);
  return closeDoc(doc.id, { forgetWorkspace:true, skipConfirm:true });
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
  const anchorDoc = docs.find(doc => doc.id === anchorId);
  add("이름 복사", null, () => copyDocumentName(anchorDoc));
  add("상대 경로 복사", null, () => copyDocumentRelativePath(anchorDoc));
  if (canRenameOriginalDoc(anchorDoc)) add("이름 바꾸기", null, () => renameDoc(anchorId));
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

// 사이드바 파일 우클릭 메뉴(탭 메뉴와 같은 스타일) — 탭에 없는 파일도 이름을 바꿀 수 있게 한다.
function openSidebarDocMenu(doc, x, y){
  closeTabMenu();
  closeSidebarGroupMenu();
  const menu = document.createElement("div");
  menu.className = "tab-ctx-menu"; menu.setAttribute("role", "menu");
  const add = (label, run) => {
    const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "menuitem");
    const text = document.createElement("span"); text.textContent = label; button.appendChild(text);
    button.addEventListener("click", () => { closeSidebarGroupMenu(); run(); });
    menu.appendChild(button);
  };
  add("이름 복사", () => copyDocumentName(doc));
  add("상대 경로 복사", () => copyDocumentRelativePath(doc));
  if (canRenameOriginalDoc(doc)) add("이름 바꾸기", () => renameDoc(doc.id));
  if (doc.isScratch && !doc._named){
    const sep = document.createElement("div"); sep.className = "tcx-sep"; menu.appendChild(sep);
    add("미저장 파일 삭제", () => deleteUnsavedScratchDoc(doc));
    const last = menu.querySelector("button:last-of-type");
    if (last) last.classList.add("danger");
  } else if (canDeleteOriginalDoc(doc)){
    const sep = document.createElement("div"); sep.className = "tcx-sep"; menu.appendChild(sep);
    add("디스크에서 삭제", () => deleteDocsFromDisk([doc.id]));
    const last = menu.querySelector("button:last-of-type");
    if (last) last.classList.add("danger");
  }
  document.body.appendChild(menu);
  const pad = 8, mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(pad, Math.min(x, window.innerWidth - mw - pad)) + "px";
  menu.style.top = Math.max(pad, Math.min(y, window.innerHeight - mh - pad)) + "px";
  sidebarGroupMenuEl = menu;                                   // 닫기 동선(바깥 클릭·Esc)은 그룹 메뉴와 공유
  setTimeout(() => document.addEventListener("click", onSidebarGroupMenuDocClick, true), 0);
  document.addEventListener("keydown", onSidebarGroupMenuKey, true);
  const first = menu.querySelector("button");
  if (first) first.focus();
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
    const text = document.createElement("span");
    text.textContent = (typeof window.t === "function") ? window.t(label) : label;
    button.appendChild(text); button.disabled = !!disabled;
    button.addEventListener("click", () => { closeSidebarGroupMenu(); run(); });
    menu.appendChild(button);
  };
  // 새로 만들기 — 사이드바 '새로 만들기' 메뉴와 같은 종류를 이 폴더 안에 만든다.
  // (화이트보드는 디스크 파일 형식이 없는 가상 문서라 폴더 안에 만들 수 없어 제외한다.)
  add("+Py  새 Python 코드", () => {
    if (typeof newPythonScratchInFolder === "function") newPythonScratchInFolder(node.newPythonContext);
  });
  add("+Nb  새 노트북", () => {
    if (typeof newNotebookScratchInFolder === "function") newNotebookScratchInFolder(node.newPythonContext);
  });
  add("+Xls  새 빈 표", () => {
    if (typeof newSpreadsheetScratchInFolder === "function") newSpreadsheetScratchInFolder(node.newPythonContext);
  });
  add("+Txt  새 텍스트 파일", () => {
    if (typeof newTextScratchInFolder === "function") newTextScratchInFolder(node.newPythonContext);
  });
  add("+Mn  새 블록 문서", () => {
    if (typeof newMnoteScratchInFolder === "function") newMnoteScratchInFolder(node.newPythonContext);
  });
  if (typeof canCreateFolderOnDisk === "function" && canCreateFolderOnDisk(node)){
    add("＋ 새 폴더", () => {
      if (typeof createFolderOnDisk === "function") createFolderOnDisk(node);
    });
  }
  // '새로 만들기' 묶음과 아래 항목들을 구분선으로 나눈다(줄이 이어지는 구분선 중복은 addSep 이 막는다).
  const addSep = () => {
    const last = menu.lastElementChild;
    if (!last || last.className === "tcx-sep") return;
    const line = document.createElement("div"); line.className = "tcx-sep"; menu.appendChild(line);
  };
  if (node.folderRefreshRootId) addSep();
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
    add("↻  동기화", () => requestFolderRefresh(node.folderRefreshRootId));
    // 브라우저 재생이 막히는 형식(MKV 등)이 있으면 한꺼번에 MP4로 변환(ffmpeg — 자세한 안내는 영상 탭)
    const videoTargets = (typeof vvFolderVideoTargets === "function") ? vvFolderVideoTargets(node.folderRefreshRootId) : [];
    if (videoTargets.length){
      add("▶  영상 일괄 MP4 변환 (" + videoTargets.length + "개)", () => vvBatchConvertFolder(node.folderRefreshRootId));
    }
  }
  addSep();
  add(sidebarGroupOpen(node) ? "폴더 접기" : "폴더 펼치기",
    () => { setSidebarGroupOpen(node, !sidebarGroupOpen(node)); renderSidebar(); });
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
  if (doc.stableRestoreKey) return doc.stableRestoreKey;
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
  if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return;
  const keyToId = new Map();
  docs.forEach(d => { const k = docStableKey(d); if (k && !keyToId.has(k)) keyToId.set(k, d.id); });
  const restored = [], seen = new Set();
  saved.tabs.forEach(k => { const id = keyToId.get(k); if (id != null && !seen.has(id)){ seen.add(id); restored.push(id); } });
  if (!restored.length) return;        // 하나도 못 되살리면 그대로 둔다(탭 1개짜리 화면도 복원한다)
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
  if (kind === "diff") return "비교";
  const ext = fileExtOf(name);
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "MD";
  if (ext === "docx" || ext === "doc") return "DOC";
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
  if (kind === "binary") return "binary";
  if (kind === "diff")   return "code";
  const ext = fileExtOf(name);
  if (ext === "docx" || ext === "doc") return "word";
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

/* ===== 검색·필터 중의 폴더 접기 =====
   검색어나 확장자 필터가 걸리면 폴더를 강제로 펼쳐 결과가 접힌 폴더 안에 숨지 않게 한다.
   그래서 그때 node.expanded 를 뒤집어 봐야 화면은 그대로였다(화살표만 바뀌고 안 닫힘).
   대신 "검색 중에 사용자가 직접 접은 폴더"만 여기에 담아 두고 원래 트리의 접힘 상태는 건드리지 않는다.
   검색어·필터가 바뀌면 표시를 비운다 → 새 결과는 다시 전부 펼친 채로 보인다. */
let sidebarSearchCollapsed = new Set();      // nodeId 집합
let sidebarSearchCollapsedKey = null;        // 이 집합이 대응하는 (검색어 + 확장자 필터)
function sidebarSearchQuery(){
  return String((byId("sbSearch") && byId("sbSearch").value) || "").trim().toLocaleLowerCase();
}
function sidebarFilterActive(){ return !!(sidebarSearchQuery() || sidebarExtFilter); }
function syncSidebarSearchCollapse(query){
  const key = query + " " + sidebarExtFilter;
  if (key === sidebarSearchCollapsedKey) return;
  sidebarSearchCollapsedKey = key;
  sidebarSearchCollapsed.clear();
}
// 화면에 펼쳐 보일지 — 검색 중에는 "직접 접지 않았으면 펼침", 평소에는 node.expanded 그대로.
function sidebarGroupOpen(node, filtering){
  if (!node || node.type !== "group") return false;
  if (filtering === undefined) filtering = sidebarFilterActive();
  return filtering ? !sidebarSearchCollapsed.has(node.nodeId) : !!node.expanded;
}
function setSidebarGroupOpen(node, open, filtering){
  if (!node || node.type !== "group") return;
  if (filtering === undefined) filtering = sidebarFilterActive();
  if (!filtering){ node.expanded = open; return; }
  if (open) sidebarSearchCollapsed.delete(node.nodeId);
  else sidebarSearchCollapsed.add(node.nodeId);
}

/* ===== 파일명 + 내용 자동 검색(텍스트·코드 한정, 비동기·디바운스·캐시) ===== */
let contentMatchIds = new Set();             // 현재 질의에 내용이 일치하는 docId
let contentMatchSnippets = new Map();         // docId -> { line, text } 첫 일치 미리보기
let contentMatchQuery = "";                  // contentMatchIds 가 대응하는 질의(불일치하면 무시 → 오래된 결과 방지)
const contentTextCache = new Map();          // docId -> 원본 텍스트(또는 false=스킵)
const contentLowerCache = new Map();         // docId -> { text, lower } 소문자본과 그 출처 본문(검색 반복 시 통째 소문자 변환 비용 제거)
// 위 두 캐시의 총량 관리(워커 쪽 캐시와 같은 LRU 방식). 본문·소문자본은 UTF-16 이라 원본 바이트의 곱절을 차지하는데,
// 예전엔 상한도 해제도 없어서 검색 한 번이면 파일을 닫을 때까지 계속 들고 있었다.
//  - 예산: 아주 큰 작업폴더에서 한없이 늘지 않게 막는 천장(보통 크기에선 걸리지 않아 다시 읽는 일이 없다).
//  - 해제: 검색을 닫으면 통째로 비운다 — 검색할 때만 필요한 사본이다.
const contentCacheOrder = [];                // LRU: 오래 안 쓴 docId 가 앞쪽
const contentCacheChars = new Map();         // docId -> 이 문서가 차지하는 대략의 글자 수
let contentCacheTotal = 0;
const CONTENT_CACHE_BUDGET_CHARS = 200 * 1024 * 1024;   // 워커 캐시와 같은 천장
function contentCacheTouch(id){
  const i = contentCacheOrder.indexOf(id);
  if (i >= 0) contentCacheOrder.splice(i, 1);
  contentCacheOrder.push(id);
}
function contentCacheDrop(id){
  contentCacheTotal = Math.max(0, contentCacheTotal - (contentCacheChars.get(id) || 0));
  contentCacheChars.delete(id);
  contentTextCache.delete(id);
  contentLowerCache.delete(id);
  const i = contentCacheOrder.indexOf(id);
  if (i >= 0) contentCacheOrder.splice(i, 1);
}
function contentCacheTrim(){
  while (contentCacheTotal > CONTENT_CACHE_BUDGET_CHARS && contentCacheOrder.length > 1) contentCacheDrop(contentCacheOrder[0]);
}
// 캐시에 넣은 뒤 부른다 — 그 문서의 차지량을 다시 재고 LRU 맨 뒤로 보낸 다음 예산을 넘으면 오래된 것부터 버린다.
function contentCacheAccount(id){
  const text = contentTextCache.get(id), lower = contentLowerCache.get(id);
  const now = (typeof text === "string" ? text.length : 0) + (lower ? lower.lower.length : 0);
  contentCacheTotal = Math.max(0, contentCacheTotal - (contentCacheChars.get(id) || 0) + now);
  if (now) contentCacheChars.set(id, now); else contentCacheChars.delete(id);
  contentCacheTouch(id);
  contentCacheTrim();
}
function contentCacheClear(){
  contentTextCache.clear(); contentLowerCache.clear(); contentCacheChars.clear();
  contentCacheOrder.length = 0; contentCacheTotal = 0;
}
let contentSearchToken = 0;                  // 진행 중 검색 취소용
let contentSearchTimer = 0;
// 내용 검색이 예약·진행 중인 질의. 이름 필터가 0개일 때 사이드바가 "없음"이라고 단언하지 않고
// "검색 중…"을 띄우게 하는 근거 — 결과는 곧 도착하는데 없다고 말하면 검색이 고장 난 것처럼 보인다.
let contentSearchBusyQuery = "";
const CONTENT_SEARCH_DEBOUNCE_MS = 80;       // 캐시가 더워지면 검색 자체는 ~10ms대 — 대기가 체감 지연의 대부분이었다
const CONTENT_SEARCH_MAX_BYTES = 4 * 1024 * 1024;          // 이하: 메인 스레드에서 즉시 검색
const CONTENT_SEARCH_WORKER_MAX_BYTES = 128 * 1024 * 1024; // 여기까지: 대형 텍스트는 워커에서 검색
const PDF_SEARCH_MAX_PAGES = 500;                   // 텍스트 추출 페이지 상한(초대용량 보호)
const PDF_SEARCH_MAX_CHARS = 1500000;               // 추출 누적 글자 상한
const TEXT_SEARCH_EXTS = new Set(["txt","text","log","md","markdown","mdx","csv","tsv","json","xml",
  "yaml","yml","html","htm","xhtml","ini","cfg","conf","env","sql","srt","vtt","smi"]);
const OFFICE_SEARCH_EXTS = new Set(["docx","pptx","hwpx"]);   // zip 안 XML 에서 본문을 직접 추출해 검색
const OFFICE_SEARCH_MAX_BYTES = 64 * 1024 * 1024;             // 원본 zip 크기 상한(이미지가 커도 XML 은 작다)
const OFFICE_TEXT_MAX_CHARS = 1500000;                        // 추출 누적 글자 상한(PDF 와 동일한 보호선)
const OFFICE_XML_ENTRY_MAX_BYTES = 32 * 1024 * 1024;          // 단일 XML 압축 해제 상한(zip bomb·손상 파일 방어)
const OFFICE_XML_TOTAL_MAX_BYTES = 64 * 1024 * 1024;          // 한 문서에서 읽는 XML 전체 압축 해제 상한
// 셀 노트북(.ipynb) 은 본문이 파일이 아니라 모델(notebookModel.cells) 에 있다 — sourceFile 이 없어 예전엔 검색에서 통째로 빠졌다.
// 변환(.py) 뷰로 연 노트북은 sourceFile 을 가진 보통 코드 문서이므로 여기 해당하지 않는다(notebookModel 로 구분).
function isNotebookSearchable(doc){
  return !!(doc && doc.notebookModel && Array.isArray(doc.notebookModel.cells));
}
// .mnote 블록 문서 — 본문이 파일(JSON)이 아니라 모델(mnote.blocks)에 있다.
// sourceFile(JSON)을 검색하면 키·base64가 잡히므로, 노트북처럼 모델의 블록 본문만 검색한다.
function isMnoteSearchable(doc){
  return !!(doc && doc.mnote && Array.isArray(doc.mnote.blocks));
}
function mnoteSearchText(doc){
  if (!isMnoteSearchable(doc)) return null;
  return (typeof mnotePlainText === "function") ? mnotePlainText(doc.mnote) : null;
}
// 검색 본문: 셀 본문을 줄 그대로 이어붙인다(코드·마크다운·raw 모두). 셀 사이엔 개행 하나.
// savedText 는 ipynb JSON 이라 검색에 쓰면 안 된다(따옴표·\n 이스케이프가 섞인 직렬화본).
// ※ 아래 notebookCellAtLine 의 줄 셈과 규약이 한 쌍이다 — 한쪽만 바꾸면 셀 번호가 어긋난다.
function notebookSearchText(doc){
  if (!isNotebookSearchable(doc)) return null;
  return doc.notebookModel.cells.map(c => String((c && c.source) || "")).join("\n");
}
// 검색 본문의 절대 줄 번호 → 몇 번째 셀인가(1부터). join("\n") 이라 셀 i 는 자기 줄 수만큼만 차지한다.
function notebookCellAtLine(doc, line){
  if (!isNotebookSearchable(doc)) return 1;
  const cells = doc.notebookModel.cells;
  let start = 1;
  for (let i = 0; i < cells.length; i++){
    const lines = String((cells[i] && cells[i].source) || "").split("\n").length;
    if (line < start + lines) return i + 1;
    start += lines;
  }
  return cells.length || 1;
}
// 내용 검색이 볼 본문 — 살아있는 편집기 > 저장된 텍스트 > 디스크 스냅샷 순(실행 경로 openDocRunText 와 같은 사다리).
// 앞의 두 칸은 이미 메모리에 있는 문자열이라 읽기 비용이 없고, 편집·저장마다 바뀌므로 캐시에 넣지 않는다
// (contentTextCache 는 파일을 닫을 때만 비워져서, 캐시하면 저장 후에도 옛 내용이 검색된다).
// 편집기는 dirty 일 때만 읽는다 — 깨끗한 문서는 savedText 와 같은 내용이라 문자열 복사를 아낀다.
function hasLiveDocText(doc){
  if (!doc) return false;
  if (isNotebookSearchable(doc)) return true;            // 셀 모델이 곧 최신 본문
  if (isMnoteSearchable(doc)) return true;               // 블록 모델이 곧 최신 본문
  if (doc.hasUnsavedEdits && doc.codeEditor && typeof doc.codeEditor.getValue === "function") return true;
  return typeof doc.savedText === "string";
}
function liveDocText(doc){
  if (!doc) return null;
  if (isNotebookSearchable(doc)) return notebookSearchText(doc);   // savedText(=ipynb JSON) 보다 먼저 — 직렬화본을 검색하면 안 된다
  if (isMnoteSearchable(doc)) return mnoteSearchText(doc);         // savedText(=mnote JSON) 대신 블록 본문
  if (doc.hasUnsavedEdits && doc.codeEditor && typeof doc.codeEditor.getValue === "function"){
    try { return String(doc.codeEditor.getValue()); } catch(e){}
  }
  return typeof doc.savedText === "string" ? doc.savedText : null;
}
// 확장자·종류상 텍스트로 검색할 만한 파일인가(크기는 따지지 않음).
function isTextExtSearchable(doc){
  if (!doc || doc.kind === "pdf" || !doc.sourceFile) return false;
  if (doc.isTextFile) return true;
  const lower = String(doc.name || "").toLowerCase();
  const ext = fileExtOf(lower);
  if (ext === lower) return true;                       // 확장자 없는 파일도 텍스트일 수 있음
  return (typeof CODE_EXTS !== "undefined" && ext in CODE_EXTS) || TEXT_SEARCH_EXTS.has(ext);
}
// Office 문서(docx·pptx·hwpx·doc·hwp) 본문 검색 대상 여부.
//  - docx/pptx/hwpx: zip 안 XML 을 직접 파싱하므로 아직 안 연 문서도 검색된다.
//  - doc(구형 바이너리): CFB 조각표를 직접 읽어 뽑으므로 역시 안 연 문서도 검색된다.
//  - hwp(구형 바이너리): 직접 파싱이 어려워, 이미 렌더된 화면의 글자로 검색한다(안 연 문서는 제외).
function isOfficeSearchable(doc){
  if (!doc || doc.kind !== "office" || !doc.sourceFile) return false;
  const ext = fileExtOf(String(doc.name || "").toLowerCase());
  if (ext === "hwp") return true;
  if (ext === "doc") return !doc.isTextFile && (doc.size || 0) <= OFFICE_SEARCH_MAX_BYTES;   // 이름만 .doc 인 텍스트는 텍스트 통로가 맡는다
  return OFFICE_SEARCH_EXTS.has(ext) && (doc.size || 0) <= OFFICE_SEARCH_MAX_BYTES;
}
// 사이드바 스니펫의 단위 라벨(기본 "줄"): 검색 결과 텍스트의 줄 번호가 무엇을 뜻하는지 알려준다.
function officeSnippetUnit(doc){
  const ext = fileExtOf(String(doc.name || "").toLowerCase());
  if (ext === "pptx") return "슬라이드";
  if (ext === "docx" || ext === "doc" || ext === "hwpx") return "문단";
  return "";
}
// 메인 스레드 즉시 검색 대상: 소형 텍스트 + (텍스트 기반) PDF + Office 문서.
function isTextSearchable(doc){
  if (!doc) return false;
  if (doc.kind === "pdf") return !!doc.pdfBytes;       // 텍스트 PDF 검색(스캔본은 추출 결과가 비어 자동 제외)
  if (isNotebookSearchable(doc)) return true;          // 셀 노트북 — sourceFile 이 없어 아래 확장자 판정을 못 탄다
  if (isMnoteSearchable(doc)) return true;             // .mnote — 블록 본문(모델)로 검색, 확장자 판정 우회
  if (isOfficeSearchable(doc)) return true;            // docx·pptx·hwpx·(렌더된) hwp
  // 본문이 이미 메모리에 있으면 파일을 읽지 않으므로 크기 상한과 무관하게 여기서 바로 검색한다.
  if (hasLiveDocText(doc)) return isTextExtSearchable(doc);
  if ((doc.size || 0) > CONTENT_SEARCH_MAX_BYTES) return false;
  return isTextExtSearchable(doc);
}
// 워커 검색 대상: 메인 스레드 상한을 넘는 대형 텍스트(워커 상한 이하).
function isLargeTextSearchable(doc){
  const size = doc && (doc.size || 0);
  if (hasLiveDocText(doc)) return false;               // 위에서 최신 텍스트로 이미 검색됨(워커엔 옛 스냅샷뿐)
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
// Office 문서 본문 추출. 반환: string(성공) | false(추출 불가 → 캐시) | undefined(아직 불확정 → 캐시 금지).
async function extractOfficeText(doc){
  let ext = fileExtOf(String(doc.name || "").toLowerCase());
  if (ext === "hwp"){                                     // 구형 바이너리 — 렌더된 화면의 글자로 검색
    if (!doc.rendered || !doc.el) return undefined;       // 아직 안 열었으면 다음 검색에서 다시 시도
    const t = String(doc.el.innerText || "").replace(/\u0000/g, "").trim();
    return t || false;
  }
  if (ext === "doc"){                                     // 구형 바이너리 Word — 파일에서 바로 본문을 뽑는다
    if (typeof docLegacyExtractText !== "function") return false;
    try {
      const t = await docLegacyExtractText(doc.sourceFile);
      if (t === null) ext = "docx";                       // 이름만 .doc 인 docx → 아래 zip 통로로 넘긴다
      else return String(t || "").trim() ? t : false;
    } catch(_){ return false; }
  }
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("zip");   // 압축 라이브러리는 첫 사용 때 로드
  if (typeof zip === "undefined") return false;
  let reader = null;
  try {
    zip.configure({ useWebWorkers: false });
    reader = new zip.ZipReader(new zip.BlobReader(doc.sourceFile));
    const entries = await reader.getEntries();
    const byPath = new Map();
    for (const e of entries){ if (!e.directory) byPath.set(e.filename.replace(/\\/g, "/"), e); }
    let xmlBytesRead = 0;
    const readText = async (p) => {
      const e = byPath.get(p); if (!e) return null;
      const declared = Number(e.uncompressedSize);
      if (Number.isFinite(declared) && (declared > OFFICE_XML_ENTRY_MAX_BYTES || xmlBytesRead + declared > OFFICE_XML_TOTAL_MAX_BYTES))
        throw new Error("office-xml-too-large");
      const text = await e.getData(new zip.TextWriter());
      const actual = String(text || "").length;
      if (actual > OFFICE_XML_ENTRY_MAX_BYTES) throw new Error("office-xml-too-large");
      xmlBytesRead += Number.isFinite(declared) ? declared : actual;
      if (xmlBytesRead > OFFICE_XML_TOTAL_MAX_BYTES) throw new Error("office-xml-too-large");
      return text;
    };
    const numOf = (p) => { const m = p.match(/(\d+)\.xml$/); return m ? +m[1] : 0; };
    let lines = [];
    if (ext === "docx"){
      const xml = await readText("word/document.xml");
      if (!xml) return false;                             // 암호 문서·비표준 구조 → 검색 제외
      lines = officeXmlParagraphLines(xml, OFFICE_TEXT_MAX_CHARS).lines;
    } else if (ext === "pptx"){
      const slides = [...byPath.keys()].filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => numOf(a) - numOf(b));
      if (!slides.length) return false;
      let total = 0;
      for (let i = 0; i < slides.length; i++){            // 슬라이드당 한 줄(슬라이드 안 문단은 공백으로 잇는다)
        const p = slides[i];
        const xml = await readText(p);
        const run = xml ? officeXmlTextRuns(xml, " ", Math.max(0, OFFICE_TEXT_MAX_CHARS - total)) : { text:"", truncated:false };
        const line = run.text.replace(/\s+/g, " ").trim();
        lines.push(line); total += line.length;
        if (run.truncated || total >= OFFICE_TEXT_MAX_CHARS) break;
        if (i % 8 === 7 && typeof yieldToBrowser === "function") await yieldToBrowser();
      }
    } else if (ext === "hwpx"){
      const sections = [...byPath.keys()].filter(p => /^Contents\/section\d+\.xml$/i.test(p)).sort((a, b) => numOf(a) - numOf(b));
      if (!sections.length) return false;
      let total = 0;
      for (let i = 0; i < sections.length; i++){
        const p = sections[i];
        const xml = await readText(p);
        if (xml){
          const part = officeXmlParagraphLines(xml, Math.max(0, OFFICE_TEXT_MAX_CHARS - total));
          lines.push(...part.lines); total += part.chars;
          if (part.truncated || total >= OFFICE_TEXT_MAX_CHARS) break;
        }
        if (i % 4 === 3 && typeof yieldToBrowser === "function") await yieldToBrowser();
      }
    } else return false;
    const joined = lines.join("\n").replace(/\u0000/g, "");
    return joined.replace(/\n/g, "").trim() ? joined : false;
  } catch(_){ return false; }
  finally { if (reader){ try { await reader.close(); } catch(_){} } }
}
// 검색 결과에서 PDF 의 특정 페이지로 스크롤(지연 렌더라 먼저 렌더 보장 후 프레임으로 이동).
async function scrollPdfToPage(doc, pageNum){
  try { if (typeof ensureRendered === "function") await ensureRendered(doc); } catch(e){}
  const p = doc.pages && doc.pages[pageNum - 1];
  if (p && p.frame && p.frame.scrollIntoView) p.frame.scrollIntoView({ block: "start", behavior: "smooth" });
}
async function getDocText(doc){                          // 한 번 읽어 소문자로 캐시(바이너리/실패는 false)
  const live = liveDocText(doc);                         // 편집기·저장 텍스트는 캐시를 타지 않고 늘 최신을 쓴다
  if (live !== null) return live;
  if (contentTextCache.has(doc.id)){ contentCacheTouch(doc.id); return contentTextCache.get(doc.id); }
  let text = false;
  try {
    if (doc.kind === "pdf"){
      text = await extractPdfText(doc);
      // 스캔본(글자 없음)이라도 글자 인식(OCR)을 해 둔 PDF 면 그 텍스트로 검색한다(줄 번호 = 페이지 번호 규약 동일).
      if (text === false && typeof pdfOcrCachedText === "function"){
        const ocr = await pdfOcrCachedText(doc);
        if (typeof ocr === "string" && ocr.trim()) text = ocr;
      }
    } else if (isOfficeSearchable(doc)){
      const extracted = await extractOfficeText(doc);
      if (extracted === undefined) return false;         // 아직 불확정(안 연 hwp) → 캐시하지 않고 다음 검색에서 재시도
      text = extracted;
    } else {
      const bytes = await readDocSourceBytes(doc);
      let binary = false, lim = Math.min(bytes.length, 8192);
      for (let i = 0; i < lim; i++){ if (bytes[i] === 0){ binary = true; break; } }
      if (!binary) text = smartDecodeText(bytes);
    }
  } catch(e){ text = false; }
  contentTextCache.set(doc.id, text);
  contentCacheAccount(doc.id);
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
    // 일부 오류 바이트가 섞인 오래된 ANSI 파일도 본문과 같은 기준으로 복구한다.
    const chunkSize = 64 * 1024;
    const starts = bytes.length <= chunkSize
      ? [0]
      : [0, Math.max(0, Math.floor((bytes.length - chunkSize) / 2)), Math.max(0, bytes.length - chunkSize)];
    const replacementScore = (encoding) => {
      let score = 0;
      const decoder = new TextDecoder(encoding);
      for (const start of [...new Set(starts)]){
        const text = decoder.decode(bytes.subarray(start, Math.min(bytes.length, start + chunkSize)));
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xFFFD) score++;
      }
      return score;
    };
    try { return replacementScore("utf-8") < replacementScore("euc-kr") ? "utf-8" : "euc-kr"; }
    catch(_){ return "utf-8"; }
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
    // 워커가 죽으면 done 이 영영 오지 않는다 → 진행 표시를 걷어 "검색 중…"에 갇히지 않게 한다
    // (메인 스레드가 이미 찾아둔 결과는 그대로 남는다).
    w.onerror = () => {
      _contentSearchWorkerBroken = true; _contentSearchWorker = null;
      contentSearchBusyQuery = "";
      setContentStatus(contentMatchIds.size ? window.tf("{n}개 일치", { n: contentMatchIds.size }) : (window.t ? window.t("내용 일치 없음") : "내용 일치 없음"));
      renderSidebar();
    };
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
    contentSearchBusyQuery = "";                          // 워커까지 끝 → 이제 "없음"이라고 말해도 된다
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
  if (!query){
    contentMatchIds = new Set(); contentMatchSnippets = new Map(); contentMatchQuery = "";
    contentSearchBusyQuery = ""; setContentStatus(""); renderSidebar(); return;
  }
  contentSearchBusyQuery = query;
  setContentStatus("검색 중…");
  const result = new Set();
  const snippets = new Map();
  for (const doc of docs.filter(isTextSearchable)){
    if (token !== contentSearchToken) return;            // 더 새 검색이 시작됨 → 중단
    // 첫 검색은 파일을 통째로 읽고 디코드·소문자 변환한다(수십~수백 ms). 중간중간 양보해 화면이 얼지 않게 한다.
    if (typeof yieldToBrowserThrottled === "function") await yieldToBrowserThrottled(12);
    if (token !== contentSearchToken) return;            // 양보 사이에 새 검색이 들어올 수 있다
    const text = await getDocText(doc);
    // 소문자본은 그 본문에서 나온 것일 때만 재쓴다 — 편집 중인 문서는 매번 새 문자열이라 자연히 다시 만들어진다.
    let lower;
    if (text){
      const cached = contentLowerCache.get(doc.id);
      if (cached && cached.text === text) lower = cached.lower;
      else { lower = text.toLocaleLowerCase(); contentLowerCache.set(doc.id, { text, lower }); contentCacheAccount(doc.id); }
    }
    const snippet = text && contentMatchSnippet(text, query, 120, lower);
    if (snippet){
      if (doc.kind === "pdf") snippet.unit = "페이지";
      // 노트북은 줄 번호 대신 셀 번호로 알려준다(미리보기 글은 일치한 코드 줄 그대로).
      else if (isNotebookSearchable(doc)){ snippet.line = notebookCellAtLine(doc, snippet.line); snippet.unit = "셀"; }
      else { const unit = officeSnippetUnit(doc); if (unit) snippet.unit = unit; }
      result.add(doc.id); snippets.set(doc.id, snippet);
    }
  }
  if (token !== contentSearchToken) return;
  contentMatchIds = result; contentMatchSnippets = snippets; contentMatchQuery = query;
  // 대형 텍스트는 워커로 넘겨 백그라운드에서 검색(메인 스레드 안 멈춤). 결과는 도착하는 대로 사이드바에 반영된다.
  const large = docs.filter(isLargeTextSearchable);
  const worker = large.length ? ensureContentSearchWorker() : null;
  if (!worker) contentSearchBusyQuery = "";              // 워커가 뒤이어 돌지 않으면 지금 결과가 최종
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
  clearTimeout(contentSearchTimer);
  const q = String((byId("sbSearch") || {}).value || "").trim().toLocaleLowerCase();
  if (!q){
    contentMatchIds = new Set(); contentMatchSnippets = new Map(); contentMatchQuery = "";
    contentSearchBusyQuery = ""; contentCacheClear();    // 검색을 닫았다 → 본문·소문자본 사본을 놓아준다
    setContentStatus(""); renderSidebar(); return;
  }
  contentSearchBusyQuery = q;                            // 그린 뒤에 세우면 "없음"이 한 프레임 스쳐 지나간다 → 먼저 세운다
  setContentStatus("…");
  renderSidebar();
  contentSearchTimer = setTimeout(() => runContentSearch(q), CONTENT_SEARCH_DEBOUNCE_MS);
}
function documentExtension(doc){
  const name = String(doc && doc.name || "");
  const ext = fileExtOf(name);
  return ext && ext !== name.toLowerCase() ? "." + ext : "(기타)";
}
function setSidebarExtensionFilter(ext){
  sidebarExtFilter = ext || "";
  if (sidebarExtFilter && sidebarCollapsed) openSidebar({ reveal: false });   // 필터에 활성 파일이 안 걸릴 수 있어 커서는 그대로
  renderSidebar();
  const wrap = byId("fileStatsWrap"), pop = byId("fileStatsPop");
  if (wrap) wrap.dataset.pin = "0";
  if (pop) pop.hidden = true;
  const button = byId("fileStats");
  if (button) button.setAttribute("aria-expanded", "false");
}

/* ===== 사이드바에서 바로 이름 짓기 =====
   폴더 우클릭으로 갓 만든 문서는 아직 디스크에 파일이 없다. 그래서 이름 확정은 메모리 문서
   (name·workspacePath·relPath·폴더 묶음)만 고치면 되고, 첫 저장 때 다시 묻지 않도록 _nameChosen 을 세운다.
   renderSidebar 는 자동 저장·상태 갱신 등으로 수시로 다시 그리므로 입력 DOM 을 붙잡아 둘 수 없다.
   상태(sidebarRenameState)만 들고 있다가 매 렌더에서 입력을 새로 만들고 값·선택 범위를 되살린다. */
let sidebarRenameState = null;      // { nodeId, docId, value, selStart, selEnd, openedAt, busy }
// 새 문서를 열면 편집기가 한두 프레임 뒤에 포커스를 가져간다. 그 사이의 blur 는 사용자가 이름을
// 확정한 것이 아니므로, 이 시간 안에서는 확정하지 않고 입력으로 포커스를 되돌린다.
const SIDEBAR_RENAME_FOCUS_GRACE_MS = 700;

// 갓 만든 새 문서의 사이드바 줄을 입력으로 바꾼다. 확장자를 뺀 앞부분만 선택해 바로 덮어쓸 수 있게 한다.
function beginSidebarRename(doc){
  if (!doc || !doc.isScratch || doc._named || doc._nameChosen) return false;
  const node = navNodeById(doc.nodeId);
  if (!node || node.type !== "doc") return false;
  if (sidebarCollapsed) openSidebar({ reveal:false });
  focusSidebarDoc(doc.id);                       // 접힌 부모 폴더를 펼쳐 줄이 실제로 보이게 한다
  const name = String(doc.name || "");
  const dot = name.lastIndexOf(".");
  sidebarRenameState = { nodeId:node.nodeId, docId:doc.id, value:name,
    selStart:0, selEnd:dot > 0 ? dot : name.length, openedAt:Date.now(), busy:false };
  sidebarCursorKey = node.nodeId;
  renderSidebar();
  return true;
}

// 이름 짓기를 접는다 — 만들 때 붙인 기본 이름을 그대로 두므로 첫 저장에서 다시 이름을 묻는다.
function cancelSidebarRename(){
  if (!sidebarRenameState) return;
  sidebarRenameState = null;
  renderSidebar();
}

async function commitSidebarRename(){
  const st = sidebarRenameState;
  if (!st || st.busy) return false;
  const doc = docs.find(d => d.id === st.docId);
  const typed = String(st.value || "").trim();
  if (!doc || !typed){ cancelSidebarRename(); return false; }
  st.busy = true;                                // Enter 와 blur 가 겹쳐도 한 번만 처리
  sidebarRenameState = null;                     // 확정하는 동안에는 그 줄을 보통 파일 줄로 그린다
  // 임시 이름을 그대로 쓰겠다는 Enter도 확정이다. 취소(Esc)와 구분해야 첫 저장 때 다시 묻지 않는다.
  if (typed === doc.name){
    doc._nameChosen = true;
    renderSidebar();
    return true;
  }
  let named = null;
  try {
    named = (typeof applyScratchDocName === "function")
      ? await applyScratchDocName(doc, typed, doc.name, {}) : null;
  } catch(error){ console.warn("sidebar rename failed:", error); }
  if (named) doc._nameChosen = true;             // 첫 저장에서 이름을 다시 묻지 않는다
  renderSidebar();
  return !!named;
}

// 파일명 입력이 포커스를 가진 상태의 Ctrl+S도 평소 저장 단축키와 같아야 한다.
// 이름 확정(중복 확인 포함)이 끝난 뒤 저장 버튼을 눌러, 첫 저장 이름 대화상자가 겹치지 않게 한다.
function saveDocAfterSidebarRename(doc){
  if (!doc) return;
  if (doc.notebookModel && typeof saveNotebook === "function"){
    saveNotebook(doc);
    return;
  }
  const save = doc.el && doc.el.querySelector && doc.el.querySelector(".run-save");
  if (save && !save.disabled) save.click();
}

function focusSidebarRenameInput(input){
  const st = sidebarRenameState;
  if (!st || !input) return;
  if (document.activeElement !== input){
    try { input.focus({ preventScroll:true }); } catch(_){ input.focus(); }
  }
  try { input.setSelectionRange(st.selStart, st.selEnd); } catch(_){}
  input.scrollIntoView({ block:"nearest" });
}

// 사이드바 줄 안에 들어가는 이름 입력. 렌더될 때마다 새로 만들어지므로 값·선택 범위는 상태에서 되살린다.
function createSidebarRenameInput(){
  const st = sidebarRenameState;
  const input = document.createElement("input");
  input.type = "text"; input.className = "sb-rename"; input.value = st.value;
  input.spellcheck = false; input.autocomplete = "off";
  input.setAttribute("aria-label", (typeof window.t === "function" ? window.t("새 파일 이름") : "새 파일 이름"));
  input.title = "Enter: 이름 확정 · Esc: 기본 이름 유지 (파일은 저장할 때 만들어집니다)";
  const sync = () => {
    if (sidebarRenameState !== st) return;
    st.value = input.value;
    st.selStart = input.selectionStart; st.selEnd = input.selectionEnd;
  };
  // 사용자가 입력을 직접 만진 뒤라면 그 다음 blur 는 확실한 의사표시다 → 유예 시간을 끝낸다.
  const touched = () => { if (sidebarRenameState === st) st.openedAt = 0; };
  input.addEventListener("input", sync);
  input.addEventListener("keyup", sync);
  input.addEventListener("select", sync);
  // 줄 클릭(파일 열기)·드래그(분할 열기)·사이드바 ↑/↓ 이동으로 새어 나가지 않게 막는다.
  ["click", "dblclick", "pointerdown", "mousedown", "contextmenu", "dragstart"].forEach(type =>
    input.addEventListener(type, (e) => e.stopPropagation()));
  ["pointerdown", "mousedown"].forEach(type => input.addEventListener(type, touched));
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    touched();
    if (typeof shortcutMatches === "function" && shortcutMatches(e, "saveCurrent")){
      e.preventDefault();
      sync();
      const doc = docs.find(d => d.id === st.docId);
      commitSidebarRename().then((committed) => { if (committed) saveDocAfterSidebarRename(doc); });
    }
    else if (e.key === "Enter"){ e.preventDefault(); sync(); commitSidebarRename(); }
    else if (e.key === "Escape"){ e.preventDefault(); cancelSidebarRename(); }
  });
  input.addEventListener("blur", () => {
    if (sidebarRenameState !== st || st.busy) return;
    if (Date.now() - st.openedAt < SIDEBAR_RENAME_FOCUS_GRACE_MS){   // 편집기가 포커스를 가져간 직후 → 되돌린다
      requestAnimationFrame(() => {
        if (sidebarRenameState !== st) return;
        const list = byId("sbList");
        const again = list && list.querySelector(".sb-rename");
        if (again) focusSidebarRenameInput(again);
      });
      return;
    }
    sync(); commitSidebarRename();
  });
  requestAnimationFrame(() => { if (sidebarRenameState === st && input.isConnected) focusSidebarRenameInput(input); });
  return input;
}

function renderSidebar(){
  if (uiBatchDepth > 0){ uiBatchSidebarPending = true; return; }
  closeSidebarGroupMenu();
  pruneSidebarSelection();                 // 닫힌 문서가 선택에 남아 있지 않게
  if (sidebarRenameState){                 // 이름을 짓던 문서가 닫혔으면 상태를 놓아준다
    const renaming = docs.find(d => d.id === sidebarRenameState.docId);
    if (!renaming || renaming.nodeId !== sidebarRenameState.nodeId) sidebarRenameState = null;
  }
  const list = byId("sbList");
  list.innerHTML = "";
  const query = sidebarSearchQuery();
  syncSidebarSearchCollapse(query);            // 검색어·필터가 바뀌면 검색 중 접어 둔 표시를 놓아준다
  const filtering = !!(query || sidebarExtFilter);
  const groupOpen = (node) => sidebarGroupOpen(node, filtering);
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
      // 갓 만든 문서의 이름 입력 줄은 검색어나 확장자 필터와 무관하게 항상 보여 준다.
      else if (sidebarRenameState && sidebarRenameState.nodeId === node.nodeId) result = true;
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
    item.className = "sb-item" + (doc && doc.id === activeId ? " active" : "") + (doc && studyPdfId !== null && doc.id === studyPdfId && doc.id !== activeId ? " study-ref" : "") + (node.type === "group" ? " group" : "") + (sidebarSelection.has(node.nodeId) ? " selected" : "");
    if (node.type === "doc") item.setAttribute("aria-selected", String(sidebarSelection.has(node.nodeId)));
    item.style.setProperty("--depth", depth);
    item.tabIndex = -1;                                     // 키보드 ↑/↓ 이동용(roving tabindex)
    item.dataset.nodeId = node.nodeId;
    if (node.type === "doc") item.dataset.docId = doc.id;   // 활성표시 갱신용 식별자
    item.onclick = (e) => {
      sidebarCursorKey = node.nodeId;                       // 클릭한 줄을 키보드 커서로 동기화
      // 여러 파일을 한꺼번에 다루기: Ctrl(⌘)+클릭 = 하나씩 고르기, Shift+클릭 = 범위.
      // 폴더 줄은 접기·펼치기가 우선이라 선택 대상에서 뺀다.
      if (node.type === "doc" && (e.ctrlKey || e.metaKey)){
        e.preventDefault(); e.stopPropagation();
        toggleSidebarSelection(node.nodeId);
        return;
      }
      if (node.type === "doc" && e.shiftKey){
        e.preventDefault(); e.stopPropagation();
        selectSidebarRange(node.nodeId);
        return;
      }
      if (sidebarSelection.size) clearSidebarSelection();         // 평범한 클릭 = 선택 해제
      if (node.type === "group"){
        // 일반 클릭(아코디언): 펼칠 때 같은 레벨(형제) 폴더를 자동으로 접어 한 폴더만 열리게 한다.
        // 이미 펼쳐진 폴더라도 형제 중 열린 폴더가 있으면 접지 않고 형제만 접는다(첫 클릭부터 "이 폴더만 남기기").
        // 자기 혼자 열려 있을 때 클릭하면 그때 접힌다. Alt+클릭: 형제를 유지한 채 자기만 펴기/접기.
        const open = groupOpen(node);
        const hasOpenSiblings = navNodes.some(n =>
          n !== node && n.type === "group" && n.parentId === node.parentId && groupOpen(n));
        if (!e.altKey && open && hasOpenSiblings){
          collapseSiblingGroups(node, filtering);
        } else {
          setSidebarGroupOpen(node, !open, filtering);
          if (!e.altKey && !open) collapseSiblingGroups(node, filtering);
        }
        renderSidebar();
      }
      else {
        const hit = query && contentMatchQuery === query ? contentMatchSnippets.get(doc.id) : null;
        const ext = String(doc.name || "").toLowerCase().split(".").pop() || "";
        const canFocusContentLine = !!(hit && hit.line && hit.unit !== "페이지" &&
          (ext === "txt" || ext === "html" || ext === "htm" || ext === "xhtml" ||
           (typeof CODE_EXTS !== "undefined" && ext in CODE_EXTS)));
        const canFocusRenderedContent = !!(hit && ["md", "markdown", "mdx", "csv", "docx", "doc", "pptx", "hwp", "hwpx", "ipynb"].includes(ext));
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
    } else if (node.type === "doc" && doc){
      item.addEventListener("contextmenu", (e) => {           // 파일 우클릭: 이름·상대 경로 복사, 원본 이름 바꾸기
        e.preventDefault(); e.stopPropagation();
        sidebarCursorKey = node.nodeId;
        openSidebarDocMenu(doc, e.clientX, e.clientY);
      });
      // 파일을 본문 좌우로 끌면 탭과 똑같이 분할한다(폴더/그룹은 접기·펼치기 클릭이라 제외).
      item.draggable = true;
      item.addEventListener("dragstart", (e) => {
        draggedTabId = doc.id;                                // 탭 드롭존과 같은 파이프라인 재사용
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(INTERNAL_DRAG_MIME, "document");
        e.dataTransfer.setData("text/plain", doc.name);       // 바깥 앱으로 끌었을 때만 쓰인다
        showSplitDropZone();                                  // 본문 좌우 드롭 안내(iframe 뷰어 위까지 덮음)
      });
      item.addEventListener("dragend", resetDocumentDragState);
    }
    const twist = document.createElement("span");
    twist.className = "sb-twist";
    twist.textContent = node.type === "group" ? (groupOpen(node) ? "▾" : "▸") : "";
    if (node.type === "group") twist.title = "클릭: 이 폴더만 남기고 같은 레벨 폴더 접기 · Alt+클릭: 형제 유지한 채 자기만 토글";
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
    if (node.type === "group" && node.newPythonContext){
      nm.title += " · 우클릭: 새 Python 코드·노트북·표·텍스트·블록 문서" +
        ((typeof canCreateFolderOnDisk === "function" && canCreateFolderOnDisk(node)) ? "·폴더" : "") +
        (node.folderRefreshRootId ? " · 동기화" : "");
    }
    const label = document.createElement("span"); label.className = "sb-label"; label.appendChild(nm);
    if (sidebarRenameState && sidebarRenameState.nodeId === node.nodeId){
      item.draggable = false;                               // 이름을 드래그로 선택할 때 분할 드롭존이 뜨지 않게
      label.replaceChild(createSidebarRenameInput(), nm);
    }
    if (node.type === "group" && node.zipLimits === true){
      label.classList.add("has-zip-info");
      nm.title += " · " + ZIP_MODE_NOTICE;
      const info = document.createElement("button");
      info.className = "sb-zip-info"; info.type = "button"; info.textContent = "ⓘ";
      info.title = ZIP_MODE_NOTICE; info.setAttribute("aria-label", "ZIP 제한사항 보기");
      info.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toast(ZIP_MODE_NOTICE, 6500); });
      label.appendChild(info);
    }
    // 디스크와 트리가 어긋난 게 확실한 루트에만 동기화 버튼을 단다 — 대량 사진이 자동 복원에서
    // 빠졌거나, 코드 실행이 이 폴더 안에 파일을 만들었을 때. 버튼을 눌러야만 디스크를 다시 읽는다.
    if (node.type === "group" && node.folderRefreshRootId === node.nodeId &&
        (node.restorePendingImages || node.runOutputsPending)){
      label.classList.add("has-image-restore");
      const restore = document.createElement("button");
      const translate = (text) => (typeof window.t === "function" ? window.t(text) : text);
      restore.className = "sb-image-restore"; restore.type = "button"; restore.innerHTML = window.uiIcon("refresh");
      const reasons = [];
      if (node.restorePendingImages) reasons.push("용량이 커서 자동 복원에서 빠진 사진");
      if (node.runOutputsPending) reasons.push("코드 실행이 만든 파일");
      restore.title = translate(reasons.join("과 ") + "을 디스크에서 다시 불러옵니다.");
      restore.setAttribute("aria-label", translate("폴더 동기화"));
      restore.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (node.folderReloading) return;
        node.folderReloading = true; restore.disabled = true;
        Promise.resolve(requestFolderRefresh(node.nodeId))
          .catch(() => {})
          .finally(() => { node.folderReloading = false; });
      });
      label.appendChild(restore);
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
    if (doc && doc.hasUnsavedEdits){ saved.classList.add("dirty"); saved.textContent = "●"; saved.title = _t("저장 후 수정됨"); }
    else saved.hidden = true;   // 저장되면 표시 없음(✓ 체크 제거) — dirty 점만 상태를 알린다
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
    if (node.type === "group" && groupOpen(node)) draw(node.nodeId, depth + 1);
  });
  draw(null);
  if (!visibleCount && (query || sidebarExtFilter)){
    // 내용 검색이 아직 돌고 있으면 "없음"이라고 단언하지 않는다 — 결과가 곧 도착한다.
    const searching = !!query && contentSearchBusyQuery === query;
    const label = searching ? "검색 중…" : "필터에 일치하는 파일이 없습니다.";
    const empty = document.createElement("div");
    empty.className = "sb-empty" + (searching ? " searching" : "");
    empty.textContent = (typeof window.t === "function" ? window.t(label) : label);
    list.appendChild(empty);
  }
  // 트리 구조가 예상과 달라 입력 줄을 그리지 못한 경우에만 상태를 정리한다.
  if (sidebarRenameState && !list.querySelector(".sb-rename")) sidebarRenameState = null;
  restoreSidebarCursor();                // 다시 그린 뒤 키보드 커서(roving tabindex/포커스) 복원
  renderSidebarSelectionBar();           // 선택한 개수·일괄 동작 바
  updateFileStats();
}

/* ===== 사이드바 다중 선택 =====
   Ctrl(⌘)+클릭으로 하나씩 고르고 Shift+클릭으로 범위를 고른다. 평범한 클릭은 선택을 푼다.
   고른 파일은 한꺼번에 닫거나 디스크에서 지울 수 있다(선택 바). */
function selectedDocIds(){
  const ids = [];
  for (const nodeId of sidebarSelection){
    const node = navNodes.find(n => n.nodeId === nodeId);
    if (node && node.type === "doc" && docs.some(d => d.id === node.docId)) ids.push(node.docId);
  }
  return ids;
}

function clearSidebarSelection(render=true){
  if (!sidebarSelection.size){ sidebarSelectionAnchor = null; return; }
  sidebarSelection.clear();
  sidebarSelectionAnchor = null;
  if (render) renderSidebar();
}

function toggleSidebarSelection(nodeId){
  if (sidebarSelection.has(nodeId)) sidebarSelection.delete(nodeId);
  else sidebarSelection.add(nodeId);
  sidebarSelectionAnchor = sidebarSelection.has(nodeId) ? nodeId : null;
  renderSidebar();
}

// 기준 줄부터 클릭한 줄까지, 지금 화면에 보이는 순서대로 문서 줄만 고른다(접힌 폴더 안은 제외).
function selectSidebarRange(nodeId){
  if (!sidebarSelectionAnchor){ toggleSidebarSelection(nodeId); return; }
  const visible = sidebarItems().map(el => el.dataset.nodeId);
  const from = visible.indexOf(sidebarSelectionAnchor), to = visible.indexOf(nodeId);
  if (from < 0 || to < 0){ toggleSidebarSelection(nodeId); return; }
  const [start, end] = from <= to ? [from, to] : [to, from];
  for (let i = start; i <= end; i++){
    const node = navNodes.find(n => n.nodeId === visible[i]);
    if (node && node.type === "doc") sidebarSelection.add(visible[i]);
  }
  renderSidebar();
}

// 선택이 사라진 문서(닫힘 등)를 정리한다 — 렌더할 때마다 불려 목록과 어긋나지 않게 한다.
function pruneSidebarSelection(){
  for (const nodeId of [...sidebarSelection]){
    const node = navNodes.find(n => n.nodeId === nodeId);
    if (!node || node.type !== "doc" || !docs.some(d => d.id === node.docId)) sidebarSelection.delete(nodeId);
  }
  if (sidebarSelectionAnchor && !sidebarSelection.has(sidebarSelectionAnchor)) sidebarSelectionAnchor = null;
}

function renderSidebarSelectionBar(){
  const bar = byId("sbSelectionBar"), count = byId("sbSelectionCount");
  if (!bar || !count) return;
  const ids = selectedDocIds();
  bar.hidden = ids.length === 0;
  if (!ids.length) return;
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  count.textContent = ids.length + _t("개 선택");
  const del = byId("sbSelectionDelete");
  if (del){
    // 폴더로 연 파일만 디스크에서 지울 수 있다 — 하나도 없으면 버튼을 잠가 헛클릭을 막는다.
    const deletable = ids.map(id => docs.find(d => d.id === id)).filter(doc => doc && canDeleteOriginalDoc(doc)).length;
    del.disabled = deletable === 0;
    del.title = deletable === 0
      ? _t("'열기 → 폴더 열기'로 연 파일만 디스크에서 지울 수 있어요.")
      : _t("선택한 파일을 디스크에서 완전히 지웁니다(되돌릴 수 없음).");
  }
}

// 같은 레벨(형제)의 펼쳐진 폴더를 접는다(node 자신은 유지). 아코디언 동작용 — 일반 클릭으로
// 폴더를 펼칠 때 호출돼 한 폴더만 열리게 한다. 렌더는 호출자가 책임진다(node.expanded 반영과 함께 한 번만).
// 검색·필터 중이면 원래 트리 대신 검색 한정 접힘 표시를 쓴다(sidebarSearchCollapsed).
function collapseSiblingGroups(node, filtering){
  if (filtering === undefined) filtering = sidebarFilterActive();
  for (const n of navNodes){
    if (n === node) continue;
    if (n.type === "group" && n.parentId === node.parentId && sidebarGroupOpen(n, filtering)) setSidebarGroupOpen(n, false, filtering);
  }
}

/* ===== 사이드바 키보드 탐색: ↑/↓ 로 줄 선택 이동, Enter/Space 로 열기·폴더 펼치기 ===== */
function sidebarItems(){ return [...byId("sbList").querySelectorAll(".sb-item")]; }
// opts.focus === false 면 roving tabindex 와 스크롤만 맞추고 실제 포커스는 옮기지 않는다
// (마우스로 사이드바를 열었을 때 편집 중이던 곳에서 포커스를 뺏지 않기 위해).
function focusSidebarItem(item, opts){
  if (!item) return;
  for (const el of sidebarItems()) el.tabIndex = -1;
  item.tabIndex = 0;
  if (!opts || opts.focus !== false) item.focus({ preventScroll: true });
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
  // 줄 안에서 이름을 짓는 중에도 마찬가지다(포커스를 뺏기면 그 자리에서 이름이 확정돼 버린다).
  if (!sidebarRenameState && byId("sbList").contains(document.activeElement)){
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
  // 문서를 고르지 않은 상태(activeId=0)는 그대로 유지한다. 이 그룹 안의 활성 문서가 실제로
  // 닫힐 때만 남은 문서로 이동해야, 빈 화면에서 그룹 하나를 정리했다고 첫 파일이 멋대로 열리지 않는다.
  const activeWasInGroup = childDocs.some(d => d.id === activeId);
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
  } else if (activeWasInGroup && !docs.some(d => d.id === activeId)) setActiveDoc(docs[0].id);
  refreshChrome();
  applyStudyLayout();
  renderSidebar();
  const forgottenPaths = [...(group.workspacePaths || [])];
  if (group.folderRefreshRootId === group.nodeId && group.imageSkipWorkspacePath)
    forgottenPaths.push(group.imageSkipWorkspacePath);
  if (options.forgetWorkspace && forgottenPaths.length)
    forgetWorkspacePaths(forgottenPaths, navNodes.length === 0);
}

// 파일은 열려 있는데 보고 있는 문서가 없을 때(폴더만 연 직후·마지막 탭을 닫은 뒤) 본문에 안내를 띄운다.
// 시작 화면(dropzone)은 열린 항목이 하나도 없을 때만 나오므로 그 자리를 대신한다.
function updateDocEmptyState(){
  const el = byId("docEmpty");
  if (!el) return;
  el.hidden = !(navNodes.length > 0 && !docs.some(d => d.id === activeId));
}

function refreshChrome(){
  if (uiBatchDepth > 0){ uiBatchChromePending = true; return; }
  const has = navNodes.length > 0;
  if (!docs.length){ byId("activeFileName").textContent = ""; byId("activeFileName").removeAttribute("data-cat"); byId("activeDocEncoding").hidden = true; updateOriginalSaveBadge(null); updateModeBadges(); }
  renderTabs();
  dropzone.hidden = has;
  updateDocEmptyState();
  const sidebar = byId("sidebar"), sidebarBackdrop = byId("sidebarBackdrop");
  const sidebarOpen = has && !sidebarCollapsed;
  sidebar.hidden = !has;
  sidebar.classList.toggle("is-open", sidebarOpen);
  sidebar.inert = !sidebarOpen;
  sidebar.setAttribute("aria-hidden", String(!sidebarOpen));
  sidebarBackdrop.hidden = !has;
  sidebarBackdrop.classList.toggle("is-open", sidebarOpen);
  byId("sbResizer").hidden = !sidebarOpen;
  const sidebarToggle = byId("sidebarToggle");
  // 문구·아이콘 모두 실제 표시 여부(sidebarOpen)를 따른다 — 아이콘은 이 값으로 채움/비움이 갈린다.
  sidebarToggle.title = sidebarOpen ? "왼쪽 사이드 메뉴 숨기기" : "왼쪽 사이드 메뉴 보이기";
  sidebarToggle.setAttribute("aria-label", sidebarToggle.title);
  sidebarToggle.setAttribute("aria-expanded", String(sidebarOpen));
  byId("studyToggle").hidden = !has;
}
