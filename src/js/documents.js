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
  const label = on ? "⛶ 나가기" : "⛶ 전체화면";
  const title = on ? "전체화면 종료" : "문서 영역 전체화면";
  ["btnFullscreen","btnOfficeFullscreen"].forEach(id => {
    const btn = byId(id);
    if (!btn) return;
    btn.textContent = label;
    btn.title = title;
  });
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

function makeDoc(kind, name, options={}){
  const id = ++docSeq;
  const el = document.createElement("div");
  el.className = (kind === "pdf") ? "viewer" : "office";
  el.hidden = true;
  byId("content").appendChild(el);
  attachPanBehavior(el);                 // 손바닥 도구: 내용이 화면보다 크면 드래그로 이동
  const d = { id, nodeId: "doc:" + id, parentId: options.parentId || null, name, kind, el,
    workspacePath: options.workspacePath || null, size: options.size || 0, sourceKey: options.sourceKey || null,
    isScratch: !!options.isScratch, textEncoding: options.textEncoding || null,
    originalSaveMode: !!options.originalSaveMode };   // 새로 만든 빈 코드 → 첫 저장 때 이름 받기
  d.relPath = options.relPath || null;
  d.archiveCtx = options.archiveCtx || null;
  d.fsHandle = options.fsHandle || null;
  d.fsDirHandle = options.fsDirHandle || null;   // 같은 폴더에 새 파일을 만들 때 쓰는 폴더 핸들(변환 노트북 저장 등)
  el.addEventListener("pointerdown", () => focusSidebarDoc(id));
  if (kind === "pdf"){
    d.pdfBytes=null; d.fileName=name; d.pages=[]; d.allPages=[]; d.elements=[]; d.selected=null; d.addCount=0; d.zoom=defaultPdfZoom();
    d.selectedPageIds = new Set(); d.pagePanelOpen = false;
  }
  docs.push(d);
  navNodes.push({ nodeId: d.nodeId, type: "doc", docId: id, parentId: d.parentId });
  bumpNavTree();
  renderSidebar();                       // 새 항목을 한 번만 그려둔다(이후 전환은 활성표시만 갱신)
  return d;
}

function setActiveDoc(id){
  // 학습 화면에서 다른 PDF를 고르면 → 오른쪽(작업) 대신 왼쪽 참조 PDF를 그 파일로 바꾼다.
  if (studyPdfId !== null && id !== studyPdfId){
    const picked = docs.find(x => x.id === id);
    if (picked && picked.kind === "pdf"){ setStudyReference(id); return; }
  }
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
  const ref = docs.find(d => d.id === studyPdfId && d.kind === "pdf");
  if (ref) requestAnimationFrame(() => fitStudyPdf(ref));        // 칸 너비가 바뀌었으니 PDF 다시 맞춤
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
    e.preventDefault(); divider.setPointerCapture(e.pointerId); divider.classList.add("dragging");
    const rect = content.getBoundingClientRect();
    const move = (ev) => apply(((ev.clientX - rect.left) / rect.width) * 100);
    const up = () => {
      divider.classList.remove("dragging");
      divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up); save();
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
  docs.forEach(d => d.el.classList.remove("study-reference", "study-work"));
  const ref = docs.find(d => d.id === studyPdfId && d.kind === "pdf");
  const work = docs.find(d => d.id === activeId);
  const split = !!(ref && work && ref.id !== work.id);
  content.classList.toggle("study-mode", split);
  content.classList.toggle("study-swapped", split && studySwapped);   // 저장된 좌우 배치 적용
  if (typeof syncPdfFindLayout === "function") syncPdfFindLayout();
  if (split){
    setupStudyDivider();                       // 분할바 준비(저장된 비율 적용)
    ref.el.hidden = false;
    ref.el.classList.add("study-reference");
    work.el.classList.add("study-work");
    if (ref.pages && ref.pages.length) startLazyRender(ref);
    // 칸 너비가 바뀔 때마다(분할 드래그·창 크기) PDF를 칸에 맞춰 다시 맞춤
    if (!ref._studyRO && typeof ResizeObserver !== "undefined"){
      let raf = 0;
      ref._studyRO = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fitStudyPdf(ref)); });
      ref._studyRO.observe(ref.el);
    }
    requestAnimationFrame(() => fitStudyPdf(ref));    // 진입 시 1회 맞춤
  }
  const btn = byId("studyToggle");
  btn.hidden = docs.length === 0;
  btn.textContent = ref ? "학습 화면 종료" : "학습 화면";
  btn.title = ref ? "PDF 고정을 해제하고 일반 화면으로 돌아가기" : "현재 PDF를 고정하고 코드와 나란히 보기";
  updateStudyPageIndicator();                  // 학습 화면 PDF '현재/총 페이지' 갱신(미진입이면 비움)
  updateModeBadges();
}

function toggleStudyMode(){
  if (studyPdfId !== null){
    const prev = docs.find(d => d.id === studyPdfId);
    studyPdfId = null;
    if (typeof syncPdfFindToActive === "function") syncPdfFindToActive(activeId);
    docs.forEach(d => d.el.hidden = d.id !== activeId);
    applyStudyLayout();
    if (prev && prev._preStudyZoom != null){ setPdfZoom(prev._preStudyZoom, prev); prev._preStudyZoom = null; }   // 진입 전 줌 복원
    return;
  }
  if (!state || state.kind !== "pdf"){
    toast("먼저 공부할 PDF를 연 뒤 학습 화면을 눌러주세요.", 3000);
    return;
  }
  startStudyModeWithPdf(state);
}

// 특정 PDF를 학습 참조로 고정한다. 코드 핀을 일반 PDF에서 눌렀을 때도 같은 진입 흐름을 재사용한다.
function startStudyModeWithPdf(pdfDoc, options={}){
  if (!pdfDoc || pdfDoc.kind !== "pdf" || pdfDoc.closed) return false;
  if (studyPdfId === pdfDoc.id) return true;
  if (studyPdfId !== null){
    setStudyReference(pdfDoc.id);
    return true;
  }
  studyPdfId = pdfDoc.id;
  if (pdfDoc._preStudyZoom == null) pdfDoc._preStudyZoom = pdfDoc.zoom;   // 학습 종료 시 되돌릴 원래 줌 기억
  applyStudyLayout();
  if (!options.silent) toast("PDF를 고정했어요. 사이드바에서 .py 파일을 선택하세요. (다른 PDF를 고르면 이 화면이 그 PDF로 바뀝니다)", 4200);
  return true;
}

// 학습 화면에서 왼쪽 참조 PDF만 다른 PDF로 교체한다(오른쪽 작업 문서는 그대로 유지).
function setStudyReference(id){
  const next = docs.find(d => d.id === id && d.kind === "pdf");
  if (!next || id === studyPdfId) return;
  const prevRef = docs.find(d => d.id === studyPdfId);
  if (prevRef){
    if (prevRef._preStudyZoom != null){ setPdfZoom(prevRef._preStudyZoom, prevRef); prevRef._preStudyZoom = null; }   // 옛 참조 줌 원래대로
    if (prevRef.id !== activeId) prevRef.el.hidden = true;                                                            // 작업 문서가 아니면 옛 참조 숨김
  }
  studyPdfId = id;
  if (typeof syncPdfFindToActive === "function") syncPdfFindToActive(activeId);
  next._preStudyZoom = next.zoom;                                          // 학습 종료 시 되돌릴 줌 기억
  const workDoc = docs.find(d => d.id === activeId);
  if (!workDoc || workDoc.kind === "pdf"){ setActiveDoc(id); return; }     // 오른쪽에 따로 작업할 문서가 없으면 새 PDF 단독 보기
  next.el.hidden = false;
  applyStudyLayout();                                                      // 좌우 배치 즉시 적용(참조=새 PDF, 작업=기존)
  ensureRendered(next).then(() => { if (next.id === studyPdfId){ startLazyRender(next); requestAnimationFrame(() => fitStudyPdf(next)); } });
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

// 지연 렌더: 문서를 처음 활성화할 때 doc.render() 를 한 번만 실행한다.
// (압축 안에 파일이 많아도 열기/전환이 빨라지고, 클릭한 문서만 그린다.)
function ensureRendered(d){
  if (!d || d.closed || d.rendered || typeof d.render !== "function") return Promise.resolve();
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
  badge.textContent = text; badge.className = "doc-status " + cls; badge.hidden = false;
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
    if (doc.id === studyPdfId) return "참조 PDF";
    if (doc.id === activeId) return "학습 작업";
  }
  const ext = documentExtension(doc).toLowerCase();
  if (doc.kind === "pdf") return "PDF 편집";
  if (doc.kind === "board") return "화이트보드";
  if (doc.kind === "replay") return "수업 리플레이";
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
  mode.textContent = text;
  mode.title = "현재 화면: " + text;
  mode.hidden = !text;
  const ref = docs.find(d => d.id === studyPdfId && d.kind === "pdf");
  const work = docs.find(d => d.id === activeId && (!ref || d.id !== ref.id));
  if (ref && work){
    const label = "참조: " + ref.name + " · 작업: " + work.name;
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
  if (wasStudy && next.kind === "pdf") studyPdfId = next.id;
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
    tab.className = "tab" + (id === activeId ? " active" : "");
    tab.draggable = true;
    const cat = extCategory(d.kind, d.name);
    if (cat) tab.dataset.cat = cat;
    tab.title = d.name + (d.textEncoding ? " · 인코딩: " + d.textEncoding.label : "") +
      " · 드래그: 위치 변경 · 우클릭: 탭 정리";
    tab.onclick = () => setActiveDoc(d.id);
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
    x.title = id === studyPdfId ? "탭 닫기 및 학습 화면 종료(파일은 사이드바에 유지)" : "탭만 닫기(파일은 사이드바에 유지)";
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
        item.append(badge, name); item.onclick = () => setActiveDoc(id); list.appendChild(item); count++;
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
  if (id === activeId && tabOrder.length) setActiveDoc(tabOrder[Math.min(i, tabOrder.length - 1)]);
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
  const add = (label, run) => {
    const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "menuitem");
    const text = document.createElement("span"); text.textContent = label; button.appendChild(text);
    button.addEventListener("click", () => { closeSidebarGroupMenu(); run(); });
    menu.appendChild(button);
  };
  add("+Py  새 Python 코드", () => {
    if (typeof newPythonScratchInFolder === "function") newPythonScratchInFolder(node.newPythonContext);
  });
  add("+Nb  새 노트북", () => {
    if (typeof newNotebookScratchInFolder === "function") newNotebookScratchInFolder(node.newPythonContext);
  });
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
      localStorage.setItem(TAB_STATE_KEY, JSON.stringify({ tabs, active, savedAt: Date.now() }));
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

function iconFor(kind, name){
  if (kind === "folder") return "DIR";
  if (kind === "zip") return "ZIP";
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "IMG";
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
    setContentStatus(contentMatchIds.size ? (contentMatchIds.size + "개 일치") : "내용 일치 없음");
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
    setContentStatus(result.size ? (result.size + "개 일치") : "내용 일치 없음");
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
        setActiveDoc(doc.id);
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
    if (doc && doc.hasUnsavedEdits){ saved.textContent = "●"; saved.title = "저장 후 수정됨"; }
    else if (doc && doc.savedInWorkspace){ saved.textContent = "✓"; saved.title = "앱 작업공간에 저장됨"; }
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
  if (backendMB != null) parts.push("메모리 " + backendMB + "MB");
  if (jsMB != null) parts.push("JS " + jsMB + "MB");
  el.textContent = parts.join(" · ");
  el.hidden = false;
  const tip = [];
  for (const p of procs.slice(0, 8)) tip.push(p.name + " " + p.mb + "MB");
  if (jsMB != null) tip.push("페이지 JS 힙 " + jsMB + "MB");
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
    chip.textContent = "파일 0개 · 0 B";
    pop.hidden = true;
    wrap.dataset.pin = "0";
    if (button){
      button.disabled = true;
      button.title = "열린 파일이 없습니다";
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
  chip.textContent = "파일 " + open.length + "개 · " + humanSize(totalSize) + (sidebarExtFilter ? " · " + sidebarExtFilter : "");
  if (button) button.title = sidebarExtFilter ? "현재 " + sidebarExtFilter + " · 확장자 필터 변경" : "열린 파일 — 확장자별 보기";
  const rows = [...byExt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  pop.innerHTML = "";
  const head = document.createElement("div"); head.className = "fsp-head";
  head.textContent = "파일 " + open.length + "개 · " + humanSize(totalSize);
  pop.appendChild(head);
  const all = document.createElement("div"); all.className = "fsp-row fsp-all-row";
  all.classList.toggle("active", !sidebarExtFilter);
  all.setAttribute("role", "menuitemradio"); all.setAttribute("aria-checked", String(!sidebarExtFilter)); all.tabIndex = 0;
  all.title = "전체 파일 보기";
  all.onclick = (e) => { e.stopPropagation(); setSidebarExtensionFilter(""); };
  all.onkeydown = (e) => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); setSidebarExtensionFilter(""); } };
  const allLabel = document.createElement("span"); allLabel.textContent = "전체";
  const allCount = document.createElement("span"); allCount.className = "fsp-cnt"; allCount.textContent = open.length + "개";
  all.append(allLabel, allCount); pop.appendChild(all);
  for (const [ext, n] of rows){
    const row = document.createElement("div"); row.className = "fsp-row";
    row.classList.toggle("active", sidebarExtFilter === ext);
    row.setAttribute("role", "menuitemradio"); row.setAttribute("aria-checked", String(sidebarExtFilter === ext)); row.tabIndex = 0;
    row.title = ext + " 파일만 보기";
    row.onclick = (e) => { e.stopPropagation(); setSidebarExtensionFilter(ext); };
    row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); setSidebarExtensionFilter(ext); } };
    const ex = document.createElement("span"); ex.className = "fsp-ext"; ex.textContent = ext;
    const ct = document.createElement("span"); ct.className = "fsp-cnt"; ct.textContent = n + "개";
    row.append(ex, ct); pop.appendChild(row);
  }
}

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
  if (options.forgetWorkspace && group.workspacePaths && group.workspacePaths.length)
    forgetWorkspacePaths(group.workspacePaths, navNodes.length === 0);
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

/* ===== EXE 최근 작업공간 저장/복원 ===== */
let workspaceMutationQueue = Promise.resolve();
const pendingWorkspaceRemovals = new Set();
let workspaceRemoveTimer = 0;
let workspaceCleanupActive = false;
let workspaceClearPending = false;
function setWorkspaceActivity(message){
  const wrap = byId("workspaceActivity"), text = byId("workspaceActivityText");
  if (!wrap || !text) return;
  text.textContent = message || "";
  wrap.hidden = !message;
  if (message) wrap.title = message; else wrap.removeAttribute("title");
}
function queueWorkspaceMutation(task){
  const next = workspaceMutationQueue.then(task, task);
  workspaceMutationQueue = next.catch(() => {});
  return next;
}

async function workspaceFetch(url, options={}){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

function encodeWorkspacePathList(rows){
  const enc = new TextEncoder(), encoded = rows.map(p => enc.encode(p));
  const total = 4 + encoded.reduce((sum, bytes) => sum + 4 + bytes.length, 0);
  const body = new Uint8Array(total), view = new DataView(body.buffer);
  let pos = 0; view.setUint32(pos, encoded.length, true); pos += 4;
  encoded.forEach(bytes => { view.setUint32(pos, bytes.length, true); pos += 4; body.set(bytes, pos); pos += bytes.length; });
  return body;
}

async function mapWithConcurrency(items, limit, mapper){
  const rows = [...(items || [])], results = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    for (;;){
      const index = next++;
      if (index >= rows.length) return;
      results[index] = await mapper(rows[index], index);
    }
  };
  const count = Math.min(rows.length, Math.max(1, limit | 0));
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}

async function flushWorkspaceRemovals(){
  clearTimeout(workspaceRemoveTimer); workspaceRemoveTimer = 0;
  if (!pendingWorkspaceRemovals.size && !workspaceClearPending) return true;
  const clearAll = workspaceClearPending;
  const rows = [...pendingWorkspaceRemovals]; pendingWorkspaceRemovals.clear();
  workspaceClearPending = false;
  workspaceCleanupActive = true;
  setWorkspaceActivity("작업공간 정리 중…");
  try {
    return await queueWorkspaceMutation(async () => {
      const res = await workspaceFetch(clearAll ? "/workspace-clear" : "/workspace-remove", {
        method: "POST", headers: { "X-PdfSigner-Workspace": "1" },
        ...(clearAll ? {} : { body: encodeWorkspacePathList(rows) })
      });
      if (!res.ok) throw new Error(await res.text());
      return true;
    });
  } catch(e){
    console.warn("workspace remove failed:", e);
    toast("화면에서는 닫았지만 최근 작업공간에서 제거하지 못했어요.", 3500);
    return false;
  } finally {
    workspaceCleanupActive = false;
    setWorkspaceActivity(pendingWorkspaceRemovals.size || workspaceClearPending ? "닫은 파일 정리 대기 중…" : "");
  }
}

async function buildWorkspacePayload(files, folderPaths=[]){
  const enc = new TextEncoder(), rows = [];
  let total = 4;
  for (const file of [...files]){
    const path = String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path) continue;
    const pathBytes = enc.encode(path), size = Number(file.size) || 0;
    total += 8 + pathBytes.length + size;
    if (total > WORKSPACE_CAP) throw new Error("workspace-too-large");
    rows.push({ file, pathBytes, size });
  }
  const seenFolders = new Set();
  for (const value of folderPaths || []){
    const folder = normalizedRunPath(value).replace(/\/+$/, "");
    if (!folder || seenFolders.has(folder)) continue;
    seenFolders.add(folder);
    const marker = workspaceFolderMarkerPath(folder);
    const pathBytes = enc.encode(marker);
    total += 8 + pathBytes.length;
    if (total > WORKSPACE_CAP) throw new Error("workspace-too-large");
    rows.push({ file:null, pathBytes, size:0 });
  }
  if (rows.length > 10000) throw new Error("workspace-too-many");
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  let pos = 0; view.setUint32(pos, rows.length, true); pos += 4;
  for (const row of rows){
    view.setUint32(pos, row.pathBytes.length, true); pos += 4;
    out.set(row.pathBytes, pos); pos += row.pathBytes.length;
    view.setUint32(pos, row.size, true); pos += 4;
    row.dataOffset = pos;
    pos += row.size;
  }
  // 작은 파일이 많은 폴더는 제한된 병렬 읽기로 저장 준비 시간을 줄인다.
  // 큰 파일이 있으면 기존처럼 순차 처리해 순간 메모리 사용량이 치솟지 않게 한다.
  const readConcurrency = rows.some(row => row.size > 16 * 1024 * 1024) ? 1 : 4;
  await mapWithConcurrency(rows.filter(row => row.file), readConcurrency, async (row) => {
    const bytes = new Uint8Array(await row.file.arrayBuffer());
    if (bytes.length !== row.size) throw new Error("workspace-file-changed");
    out.set(bytes, row.dataOffset);
  });
  return out;
}

async function rememberWorkspace(files, replace, options={}){
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;
  if (window.__tabActive === false) return false;     // 비활성 탭은 작업공간 자동저장 생략(충돌 방지)
  // 영상·오디오 원본은 자동 복원 묶음에서 제외 — 수백 MB 파일 하나가 전체 저장(256MB 제한)을 막지 않게.
  // 다음 실행에 자동 복원되지 않을 뿐, 폴더 열기나 드래그로 다시 열면 된다.
  const rows = [...files].filter(file => !isMediaFileName(file && file.name));
  const folderPaths = options.folderPaths || [];
  if (!rows.length && !folderPaths.length) return false;
  const silent = !!options.silent;
  try {
    // A replacement save makes a queued removal redundant. Cancelling it avoids
    // reading and rewriting a large previous ZIP before the new one can open.
    if (replace && !workspaceCleanupActive){
      clearTimeout(workspaceRemoveTimer); workspaceRemoveTimer = 0;
      pendingWorkspaceRemovals.clear(); workspaceClearPending = false;
      setWorkspaceActivity("");
    }
    const waitingForCleanup = workspaceCleanupActive || pendingWorkspaceRemovals.size > 0 || workspaceClearPending;
    const firstMessage = waitingForCleanup ? "닫은 파일 정리 후 작업공간 저장 중…" : "작업공간 저장 중…";
    if (silent) setWorkspaceActivity(firstMessage);
    else showLoading(waitingForCleanup ? "닫은 파일 정리 후 파일을 여는 중…" : "다음 실행을 위해 작업공간 기억하는 중…");
    await flushWorkspaceRemovals();
    if (silent) setWorkspaceActivity("작업공간 저장 중…");
    else updateLoading("다음 실행을 위해 작업공간 기억하는 중…");
    const body = await buildWorkspacePayload(rows, folderPaths);
    const res = await queueWorkspaceMutation(() => workspaceFetch("/workspace-save?replace=" + (replace ? "1" : "0"), {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-PdfSigner-Workspace": "1" }, body
    }));
    if (!res.ok) throw new Error(await res.text());
    return true;
  } catch(e){
    const msg = String(e && e.message || e);
    console.warn("workspace save skipped:", e);
    toast(msg.indexOf("too-large") >= 0 ? `파일 묶음이 ${Math.round(WORKSPACE_CAP / (1024 * 1024))}MB를 넘어 자동 복원 저장은 생략했어요.` : "최근 작업공간을 저장하지 못했어요.", 4000);
    return false;
  } finally {
    if (silent) setWorkspaceActivity(pendingWorkspaceRemovals.size || workspaceClearPending ? "닫은 파일 정리 대기 중…" : "");
    else hideLoading();
  }
}

async function readRestoredLocalFile(path){
  if (location.protocol !== "http:" && location.protocol !== "https:") return null;
  if (!/\.(py|pyw|txt|db|sqlite|sqlite3)$/i.test(String(path || ""))) return null;
  try {
    const res = await fetch("/local-file?path=" + encodeURIComponent(path), { cache: "no-store" });
    if (!res.ok || res.status === 204) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.byteLength ? bytes : null;
  } catch(e){
    return null;
  }
}

async function parseWorkspacePayload(buffer){
  const decoded = decodeWorkspace(buffer);
  const folderPaths = [...new Set(decoded
    .map(row => workspaceFolderPathFromMarker(row.path))
    .filter(Boolean))];
  const fileRows = decoded.filter(row => !workspaceFolderPathFromMarker(row.path));
  // 저장 폴더의 최신 파일 확인은 결과 순서를 유지한 채 제한적으로 병렬화한다.
  const rows = await mapWithConcurrency(fileRows, 6, async (row) => {
    const diskBytes = await readRestoredLocalFile(row.path);
    const path = row.path;
    const bytes = diskBytes || row.bytes;
    const name = path.split("/").pop() || "file";
    const file = new File([bytes], name);
    if (path.indexOf("/") >= 0) Object.defineProperty(file, "webkitRelativePath", { value: path });
    return { path, file, syncedFromDisk: !!diskBytes };
  });
  return { rows, folderPaths };
}

async function restoreLastWorkspace(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  if (!appSettings.autoRestore) return;
  const savedTabs = loadSavedTabState();    // 파일을 열기 전에 저장된 탭 구성을 먼저 읽어둔다
  tabRestoreInProgress = true;
  showLoading("최근 작업공간 확인 중…");
  try {
    const res = await fetch("/workspace-load", { cache: "no-store" });
    if (!res.ok) return;
    const savedSize = Number(res.headers.get("Content-Length")) || 0;
    if (savedSize > WORKSPACE_CAP){
      await workspaceFetch("/workspace-clear", { method: "POST", headers: { "X-PdfSigner-Workspace": "1" } }).catch(() => {});
      toast("이전 자동 복원 기록이 너무 커서 안전하게 정리했어요. 원본 파일은 영향받지 않습니다.", 5000);
      return;
    }
    const restored = await parseWorkspacePayload(await res.arrayBuffer());
    const rows = restored.rows;
    const restoredFolderPaths = restored.folderPaths;
    if (!rows.length && !restoredFolderPaths.length) return;
    updateLoading("최근 작업공간 복원 중…");
    beginUiBatch();
    const folderGroups = new Map(), loose = [];
    const ensureFolderGroup = (root) => {
      if (!folderGroups.has(root)) folderGroups.set(root, { files:[], folderPaths:[] });
      return folderGroups.get(root);
    };
    rows.forEach(row => {
      if (row.path.indexOf("/") < 0) loose.push(row.file);
      else {
        const root = row.path.split("/")[0];
        ensureFolderGroup(root).files.push(row.file);
      }
    });
    restoredFolderPaths.forEach(path => {
      const root = path.split("/")[0];
      if (root) ensureFolderGroup(root).folderPaths.push(path);
    });
    for (const group of folderGroups.values())
      await openFolderFiles(group.files, { folderPaths:group.folderPaths });
    if (loose.length){
      let opts = { bulk: loose.length > 1 };
      const siblings = loose.filter(f => !["zip","tar","gz","tgz"].includes((f.name.split(".").pop() || "").toLowerCase()));
      if (siblings.length > 1) opts.archiveCtx = makeFileSiblingCtx(siblings.map(f => ({ file: f, relPath: f.name })), "최근 작업공간");
      await handleFiles(loose, opts);
    }
    toast("지난 작업공간을 자동으로 복원했어요.", 3000);
  } catch(e){ console.warn("workspace restore skipped:", e); }
  finally {
    // 먼저 기존 로딩을 내린 뒤 배치를 풀면, 활성 문서의 지연 렌더 로딩이 그 다음에 안정적으로 유지된다.
    hideLoading();
    endUiBatch();
    applyTabState(savedTabs);   // 파일이 모두 열린 뒤 탭 순서·활성 탭 복원
    tabRestoreInProgress = false;
  }
}

async function clearRememberedWorkspace(){
  if (location.protocol !== "http:" && location.protocol !== "https:"){
    toast("최근 작업공간 저장은 EXE 실행에서만 사용해요.", 2800); return;
  }
  const ok = await confirmDialog("다음 실행 때 자동 복원할 작업공간을 지울까요? 현재 열린 파일은 유지됩니다.", "지우기", "취소");
  if (!ok) return;
  try {
    await flushWorkspaceRemovals();
    const res = await queueWorkspaceMutation(() => workspaceFetch("/workspace-clear", { method: "POST", headers: { "X-PdfSigner-Workspace": "1" } }));
    if (!res.ok) throw new Error(await res.text());
    toast("최근 작업공간을 지웠어요.", 2500);
  } catch(e){ toast("최근 작업공간을 지우지 못했어요.", 3000); }
}

function forgetWorkspacePaths(paths, clearAll=false){
  if ((location.protocol !== "http:" && location.protocol !== "https:") || !paths || !paths.length) return;
  if (clearAll){
    workspaceClearPending = true;
    pendingWorkspaceRemovals.clear();
  } else if (!workspaceClearPending){
    paths.map(p => String(p || "").replace(/\\/g, "/")).filter(Boolean).forEach(p => pendingWorkspaceRemovals.add(p));
  }
  setWorkspaceActivity("닫은 파일 정리 대기 중…");
  clearTimeout(workspaceRemoveTimer);
  workspaceRemoveTimer = setTimeout(() => { flushWorkspaceRemovals(); }, 80);
}

/* ===== 파일 로딩 ===== */
async function handleFiles(files, options={}){
  const arr = [...files];
  const bulk = options.bulk || arr.length > 1;        // 여러 개·압축 내부 → 첫 항목만 자동 표시(나머지는 클릭 시 렌더)
  let firstDoc = null;                                 // 호출부가 연 문서를 바로 쓸 수 있게(정의 이동 등) 반환
  for (const file of arr){
    throwIfUiCancelled();
    const ext = fileExtOf(file.name);
    const opts = { ...options, bulk, size: file.size || 0, fsHandle: options.fsHandle || file.__fsHandle || null,
      workspacePath: options.transient ? null : (options.workspacePath || file.webkitRelativePath || (!options.parentId ? file.name : null)) };
    opts.textEncoding = await inspectTextFileEncoding(file, ext);
    opts.sourceKey = options.sourceKey || [options.parentId || "root", opts.workspacePath || options.relPath || file.name, file.size || 0, file.lastModified || 0].join("|");
    if (opts.fsHandle && opts.workspacePath && typeof saveFsHandle === "function") saveFsHandle(opts.workspacePath, opts.fsHandle);
    const duplicate = docs.find(d => d.sourceKey && d.sourceKey === opts.sourceKey);
    if (duplicate){
      if (!uiBatchDepth) setActiveDoc(duplicate.id);
      else if (!uiBatchActiveCandidate) uiBatchActiveCandidate = duplicate.id;
      toast(`이미 열린 파일입니다: ${file.name}`, 1800);
      if (!firstDoc) firstDoc = duplicate;
      continue;
    }
    if (opts.archiveCtx && !opts.relPath) opts.relPath = file.name;   // 여러 파일 동시 업로드(평면)의 옆파일 경로
    try {
      let made = null;
      if (ext === "pdf") await loadPdf(await file.arrayBuffer(), file.name, opts);
      else if (ext === "lesson" && typeof loadLesson === "function") made = await loadLesson(file, opts);
      else if (ext === "zip") await loadZip(file, opts);
      else if (ext === "tar") await loadTar(file, opts);
      else if (ext === "gz" || ext === "tgz") await loadGz(file, opts);   // .gz / .tgz / .tar.gz
      else if (ext === "pptx"){
        const pptxBytes = await readPptxBytes(file);
        const pdfBuf = await tryConvertPptxToPdf(pptxBytes);  // 설치된 PowerPoint 로 정확 변환 시도(exe 백엔드)
        if (pdfBuf) await loadPdf(pdfBuf, file.name.replace(/\.pptx$/i, ".pdf"), opts);
        else made = await loadOffice(file, "pptx", { ...opts, pptxBytes, pptxConvertError: _lastPptxConvertError || "알 수 없는 변환 실패" }); // 백엔드 없음/변환 실패 → pptxjs 미리보기로 폴백
      }
      else if (SQLITE_EXTS.includes(ext)) made = await loadSqlite(file, opts);
      else if (ext === "ipynb"){
        if (typeof notebookModeEnabled === "function" && notebookModeEnabled()){
          // [실험·Phase1] 셀 노트북 뷰(읽기전용 미리보기). 콘솔에서 mnNotebookMode(false) 로 끄면 기존 변환(.py) 뷰.
          try {
            const __nbModel = ipynbToModel(await file.text());
            made = makeDoc("office", file.name, opts);
            made.notebook = true; made.notebookModel = __nbModel;
            made.render = async () => { made.el.innerHTML = ""; made.el.scrollTop = 0; renderNotebookView(__nbModel, made.el, made); };
            refreshChrome();
            activateIfIdle(made, opts);
          } catch(e){ toast((e && e.message) || "노트북을 열지 못했어요.", 4000); made = await loadText(file, opts); }
        } else {
        // 주피터 노트북 → 파이썬 소스로 변환한 뒤 Python 실습 뷰어로 연다
        let pySrc = null;
        try { pySrc = ipynbToPython(await file.text(), file.name); }
        catch(e){ toast((e && e.message) || "노트북을 변환하지 못했어요.", 4000); made = await loadText(file, opts); }
        if (pySrc != null){
          const pyName = file.name.replace(/\.ipynb$/i, "") + ".py";
          const pyFile = new File([pySrc], pyName, { type: "text/plain" });
          // 변환된 노트북은 .py 로 다룬다 — 경로 표시·저장 대상도 .py 로 맞춘다.
          // (폴더 새로고침의 탭 복원도 같은 ipynb 분기를 거치므로 .py 경로끼리 일관되게 매칭된다)
          const pyOpts = { ...opts, textEncoding: null };
          if (pyOpts.workspacePath) pyOpts.workspacePath = pyOpts.workspacePath.replace(/\.ipynb$/i, ".py");
          if (pyOpts.relPath) pyOpts.relPath = pyOpts.relPath.replace(/\.ipynb$/i, ".py");
          // 원본 .ipynb 파일 핸들은 물려받지 않는다(저장 때 노트북을 파이썬으로 덮어쓰지 않도록).
          // 대신 같은 폴더 핸들을 들고 있다가, 저장할 때 그 폴더에 X.py 를 새로 만든다(원본 .ipynb 는 그대로 보존).
          pyOpts.fsHandle = null;
          pyOpts.fsDirHandle = file.__fsDirHandle || null;
          made = await loadOffice(pyFile, "py", pyOpts);
          if (made) made.notebook = true;   // 셀 단위 실행(에러가 나도 다음 셀 계속)을 위해 표시
        }
        }
      }
      else if (["docx","xlsx","xls","csv","hwp","hwpx","md","markdown","mdx","txt","html","htm","xhtml"].includes(ext) || (ext in CODE_EXTS)) made = await loadOffice(file, ext, opts);
      else if (IMG_EXTS.includes(ext)) made = await loadImage(file, opts);
      else if (VIDEO_EXTS.includes(ext) || AUDIO_EXTS.includes(ext)) made = await loadVideo(file, opts);
      // 자막은 텍스트 뷰로 명시 배정 — UTF-16 저장 SMI가 loadText 바이너리 판별에 오판되지 않게
      else if (SUBTITLE_EXTS.includes(ext)) made = await loadOffice(file, "txt", opts);
      else made = await loadText(file, opts);          // 알 수 없는 확장자 → 텍스트면 열고 아니면 안내
      if (made && !firstDoc) firstDoc = made;
      // 닫은 탭 복원용: 최상위 실제 파일로 연 문서엔 원본 File과 열기 옵션을 보관해 둔다(아카이브 내부·임시 문서 제외).
      if (!opts.parentId && !opts.archiveCtx && !options.transient && file instanceof File){
        const opened = docs.find(d => d.sourceKey && d.sourceKey === opts.sourceKey);
        if (opened) opened.__reopen = { file, name: opened.name,
          options: { workspacePath: opts.workspacePath, fsHandle: opts.fsHandle, textEncoding: opts.textEncoding,
            originalSaveMode: opts.originalSaveMode } };
      }
    } catch (e){ if (e && e.message === "operation-cancelled") throw e; console.error(e); }
  }
  return firstDoc;
}

// 닫은 탭 복원 스택(최근 닫은 파일 12개). 일괄/내부 닫기는 제외하고 사용자가 직접 닫은 파일만 쌓인다.
let closedDocStack = [];
async function reopenClosedDoc(){
  const entry = closedDocStack.pop();
  if (!entry || !entry.file){ toast("다시 열 닫은 파일이 없어요.", 1800); return; }
  try { await handleFiles([entry.file], entry.options || {}); }
  catch(e){ if (!(e && e.message === "operation-cancelled")) toast("파일을 다시 열지 못했어요.", 3000); }
}

/* ===== PPTX → PDF 변환 (exe 백엔드 + 설치된 PowerPoint) =====
   pptxjs 는 도형/그룹 좌표를 못 맞춰 원본과 크게 달라진다. exe 로 실행 중이면 launcher 의
   /convert-pptx 엔드포인트(PowerPoint COM)로 정확히 PDF 변환해 PDF 뷰어로 띄운다(서명도 가능).
   - file:// (브라우저 단독 offline HTML)이거나 PowerPoint 미설치면 null → 기존 pptxjs 폴백. */
let _pptxBackend = null;   // null=미확인, true/false=캐시
let _lastPptxConvertError = "";
async function readPptxBytes(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksEncryptedOffice(bytes)) return bytes;
  const dec = await promptAndDecrypt(bytes, "pptx");
  if (!dec) throw new Error("cancelled");
  return dec;
}
async function pptxBackendAvailable(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;   // file:// → 백엔드 없음
  if (_pptxBackend !== null) return _pptxBackend;
  try {
    const res = await fetch("/can-convert", { method: "GET" });
    _pptxBackend = res.ok && (await res.text()).trim() === "yes";
  } catch(e){ _pptxBackend = false; }
  return _pptxBackend;
}
async function tryConvertPptxToPdf(pptxBytes){
  _lastPptxConvertError = "";
  if (!(await pptxBackendAvailable())) {
    const msg = (location.protocol === "http:" || location.protocol === "https:")
      ? "PowerPoint 변환 백엔드를 사용할 수 없어 간이 미리보기로 열어요."
      : "PPTX 도형을 정확히 보려면 manneung-classroom.exe로 열어주세요.";
    _lastPptxConvertError = msg;
    toast(msg, 4000);
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);   // 최대 3분
  try {
    showLoading("PowerPoint으로 변환 중… (대형 파일은 잠시 걸려요)");
    const buf = normalizeArrayBuffer(pptxBytes);
    const res = await fetch("/convert-pptx", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf, signal: ctrl.signal });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      console.warn("pptx pdf conversion failed:", res.status, msg);
      _lastPptxConvertError = msg || ("HTTP " + res.status);
      toast("PowerPoint 변환에 실패해 간이 미리보기로 열어요.", 3500);
      return null;                                         // 501(PowerPoint 없음)/500 등 → 폴백
    }
    if (((res.headers.get("Content-Type") || "").toLowerCase()).indexOf("application/pdf") < 0) {
      _lastPptxConvertError = "PowerPoint 변환 결과가 PDF가 아님";
      toast("PowerPoint 변환 결과가 올바르지 않아 간이 미리보기로 열어요.", 3500);
      return null;
    }
    const pdf = await res.arrayBuffer();
    if (pdf && pdf.byteLength > 100) {
      toast("PowerPoint 정확 변환(PDF)으로 열었어요.", 2500);
      return pdf;
    }
    _lastPptxConvertError = "빈 PDF 결과";
    return null;
  } catch(e){
    console.warn("pptx pdf conversion skipped:", e);
    _lastPptxConvertError = e && e.message ? e.message : String(e || "unknown");
    toast("PowerPoint 변환을 사용할 수 없어 간이 미리보기로 열어요.", 3500);
    return null;
  }
  finally { clearTimeout(timer); hideLoading(); }
}

/* ===== 압축(zip) 풀어서 내부 파일을 각각 열기 (zip.js — 무암호 + AES 암호 지원) ===== */
async function loadZip(file, options={}){
  if (typeof zip === "undefined"){ toast("압축 라이브러리를 불러오지 못했습니다."); return; }
  zip.configure({ useWebWorkers: false });                 // file:// 에서도 동작하도록 워커 미사용
  showLoading("압축 여는 중…");

  // 1) 엔트리 훑어서 — 열 수 있는 게 있는지 + 암호가 걸렸는지 파악
  let openable = 0, unsupported = 0, encrypted = false;
  const archivePaths = [];
  try {
    const r = new zip.ZipReader(new zip.BlobReader(file));
    for (const e of await r.getEntries()){
      if (e.directory) continue;
      const path = safeArchivePath(e.filename);
      if (!path) continue;
      if (path.indexOf("__MACOSX/") === 0) continue;        // 맥 메타데이터
      const base = path.split("/").pop();                   // 경로 제거 → 파일명만
      if (base && base !== ".DS_Store") archivePaths.push(path);
      if (!base || (base.charAt(0) === "." && !isEnvFile(base))) continue;   // 숨김(.DS_Store 등) — .env 계열은 예외
      const ext = fileExtOf(base);
      if (!ZIP_OPENABLE.includes(ext)){ unsupported++; continue; }
      openable++;
      if (e.encrypted) encrypted = true;
    }
    await r.close();
  } catch(e){
    console.error(e); hideLoading();
    toast("압축을 열지 못했습니다. 올바른 zip 파일인지 확인해 주세요.", 3500);
    return;
  }
  if (!openable){
    hideLoading();
    toast(unsupported ? "압축 안에 열 수 있는 형식이 없어요. · " + unsupported + "개 형식 미지원" : "압축이 비어 있어요.", 3500);
    return;
  }

  // 2) 암호가 걸렸으면 암호 확정 (오피스 암호와 동일하게 최대 5회 재시도)
  let password = null;
  if (encrypted){
    hideLoading();
    for (let attempt = 0; ; attempt++){
      const pw = await askPassword(attempt === 0
        ? "암호로 보호된 압축입니다. 암호를 입력하세요."
        : "암호가 올바르지 않습니다. 다시 입력해 주세요.");
      if (pw === null) return;                              // 취소
      showLoading("암호 확인 중…");
      const ok = await zipPasswordOk(file, pw);
      hideLoading();
      if (ok){ password = pw; break; }
      if (attempt >= 4){ toast("암호를 확인하지 못했어요.", 3000); return; }
    }
  }

  const zipGroup = makeGroup("zip", file.name, options.parentId || null);
  zipGroup.zipLimits = true;
  zipGroup.workspacePaths = [options.workspacePath || file.name];
  // 같은 압축에서 나온 .py 실행 시 옆 파일(import·데이터)을 함께 쓰도록, 실행할 때 이 압축을 통째로 다시 푼다.
  const archiveCtx = {
    name: file.name,
    paths: archivePaths,
    extract: (keep) => extractZipAll(file, password, keep)
  };
  const zipFolders = new Map();
  function zipParentFor(path){
    const parts = String(path || "").split("/").filter(Boolean);
    parts.pop();
    let parentId = zipGroup.nodeId, key = "";
    for (const part of parts){
      key = key ? key + "/" + part : part;
      if (!zipFolders.has(key)){
        zipFolders.set(key, makeGroup("folder", part, parentId).nodeId);
      }
      parentId = zipFolders.get(key);
    }
    return parentId;
  }

  // 3) 실제 추출 → 하나씩 열어 메모리 피크를 낮춤
  showLoading("압축 푸는 중…");
  let opened = 0, failed = 0, oversized = 0, r = null, extractedBytes = 0;
  try {
    r = new zip.ZipReader(new zip.BlobReader(file), password ? { password } : undefined);
    const entries = await r.getEntries();
    for (const e of entries){
      if (e.directory) continue;
      const path = e.filename || "";
      if (path.indexOf("__MACOSX/") === 0) continue;
      const base = path.split("/").pop();
      if (!base || (base.charAt(0) === "." && !isEnvFile(base))) continue;
      const ext = fileExtOf(base);
      if (!ZIP_OPENABLE.includes(ext)) continue;
      const entrySize = Number(e.uncompressedSize) || 0;
      if (entrySize > ZIP_ENTRY_CAP || extractedBytes + entrySize > ZIP_EXTRACT_CAP){ oversized++; continue; }
      try {
        updateLoading(`압축 푸는 중… (${opened + failed + 1}/${openable})`);
        const m = ZIP_MIME[ext];
        const innerFile = new File([await e.getData(new zip.BlobWriter())], base, m ? { type: m } : undefined);
        extractedBytes += innerFile.size || entrySize;
        const parentId = zipParentFor(path);
        hideLoading();
        await handleFiles([innerFile], { parentId, bulk: true, relPath: path, archiveCtx });
        opened++;
        await yieldToBrowser();
        showLoading(`압축 푸는 중… (${opened}/${openable})`);
      } catch(err){
        console.error(err);
        failed++;
      }                               // 개별 추출 실패
    }
  } catch(e){ console.error(e); }
  finally {
    try { if (r) await r.close(); } catch(e){ console.warn(e); }
  }
  hideLoading();

  if (!opened){ closeGroup(zipGroup.nodeId); toast("압축을 풀지 못했어요.", 3000); return; }
  const summary = formatZipOpenSummary({ opened, unsupported, oversized, failed });
  toast(summary + " · ZIP은 읽기 중심이며 원본 새로고침·덮어쓰기는 지원하지 않아요. (ⓘ)", 6000);
}

/* ===== tar / gzip (.tar / .gz / .tar.gz / .tgz) ===== */
// gzip 해제: 브라우저 내장 DecompressionStream 사용(외부 라이브러리·네트워크 불필요).
async function gunzipBytes(bytes){
  if (typeof DecompressionStream === "undefined")
    throw new Error("이 브라우저는 gzip 해제를 지원하지 않습니다.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// tar 파서: 512바이트 헤더+데이터 블록을 훑어 일반 파일만 추출({name, data}[]).
function parseTar(buf){
  const td = new TextDecoder();
  const str = (s, len) => td.decode(buf.subarray(s, s + len)).replace(/\0[\s\S]*$/, "").trim();
  const octal = (s, len) => parseInt((td.decode(buf.subarray(s, s + len)).replace(/[\0 ]+$/, "").trim() || "0"), 8) || 0;
  const files = []; let off = 0, longName = null;
  while (off + 512 <= buf.length){
    let empty = true;
    for (let i = 0; i < 512; i++){ if (buf[off + i] !== 0){ empty = false; break; } }
    if (empty) break;                                   // 끝(빈 블록)
    let name = str(off, 100);
    const size = octal(off + 124, 12);
    const type = String.fromCharCode(buf[off + 156] || 0);
    const prefix = str(off + 345, 155);                 // ustar 긴 경로
    if (prefix) name = prefix + "/" + name;
    off += 512;
    const data = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
    if (type === "L"){ longName = td.decode(data).replace(/\0[\s\S]*$/, ""); continue; }  // GNU 긴 이름
    if (longName){ name = longName; longName = null; }
    if (type === "0" || type === "\0" || type === "" || type === "7") files.push({ name, data });
    // 디렉토리(5)·심볼릭(1,2)·메타(x,g)는 건너뜀
  }
  return files;
}

// tar 바이트를 그룹으로 펼쳐 내부 파일을 각각 연다(zip 과 동일한 폴더 트리 구성).
async function extractTar(tarBytes, name, options = {}){
  const entries = parseTar(tarBytes).filter(en => {
    const base = (en.name.split("/").pop() || "");
    if (!base || (base.charAt(0) === "." && !isEnvFile(base)) || en.name.indexOf("PaxHeader") >= 0) return false;
    return ZIP_OPENABLE.includes(fileExtOf(base));
  });
  if (!entries.length){ toast("압축 안에 열 수 있는 형식이 없어요.", 3000); return; }
  const group = makeGroup("zip", name, options.parentId || null);
  group.workspacePaths = [options.workspacePath || name];
  // 같은 tar 에서 나온 .py 실행 시 옆 파일을 함께 쓰도록, 실행할 때 tar 를 통째로 다시 푼다.
  const archiveCtx = { name, extract: () => tarTreeAll(tarBytes) };
  const folders = new Map();
  const parentFor = (path) => {
    const parts = String(path || "").split("/").filter(Boolean); parts.pop();
    let parentId = group.nodeId, key = "";
    for (const part of parts){
      key = key ? key + "/" + part : part;
      if (!folders.has(key)) folders.set(key, makeGroup("folder", part, parentId).nodeId);
      parentId = folders.get(key);
    }
    return parentId;
  };
  let opened = 0;
  for (const en of entries){
    const base = en.name.split("/").pop();
    const m = ZIP_MIME[(base.split(".").pop() || "").toLowerCase()];
    const innerFile = new File([en.data], base, m ? { type: m } : undefined);
    await handleFiles([innerFile], { parentId: parentFor(en.name), bulk: true, relPath: en.name, archiveCtx });
    opened++;
    await yieldToBrowser();
  }
  if (!opened){ closeGroup(group.nodeId); toast("압축을 풀지 못했어요.", 3000); }
  else toast(opened + "개 열기", 3000);
}

async function loadTar(file, options = {}){
  showLoading("압축 푸는 중…");
  try {
    await extractTar(new Uint8Array(await file.arrayBuffer()), file.name, options);
  } catch(e){ console.error(e); toast("tar 파일을 열지 못했습니다.", 3500); }
  finally { hideLoading(); }
}

async function loadGz(file, options = {}){
  showLoading("압축 푸는 중…");
  try {
    const out = await gunzipBytes(new Uint8Array(await file.arrayBuffer()));
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")){
      await extractTar(out, file.name.replace(/\.(tgz|tar\.gz)$/i, ".tar"), options);
    } else {
      // 단일 파일 gzip → 확장자(.gz)만 떼고 그대로 처리
      const innerName = file.name.replace(/\.gz$/i, "") || "decompressed";
      hideLoading();
      await handleFiles([new File([out], innerName)], options);
    }
  } catch(e){ console.error(e); toast("gzip 압축을 풀지 못했습니다. (지원: gzip · tar.gz)", 3500); }
  finally { hideLoading(); }
}

/* 암호 검증: 첫 암호화 엔트리를 주어진 암호로 풀어본다(성공=true) */
async function zipPasswordOk(file, pw){
  try {
    const r = new zip.ZipReader(new zip.BlobReader(file), { password: pw });
    const te = (await r.getEntries()).find(e => e.encrypted && !e.directory);
    if (te) await te.getData(new zip.BlobWriter());         // 암호가 틀리면 여기서 throw
    await r.close();
    return true;
  } catch(e){ return false; }
}

async function openFilesWithHandles(options={}){
  if (typeof window === "undefined" || typeof window.showOpenFilePicker !== "function") return false;
  let handles;
  try {
    handles = await window.showOpenFilePicker({ multiple: true });
  } catch(e){
    if (e && e.name !== "AbortError") console.warn(e);
    return !!(e && e.name === "AbortError");
  }
  const files = [];
  for (const handle of handles || []){
    try { files.push(withFileHandle(await handle.getFile(), handle)); }
    catch(e){ console.warn(e); }
  }
  if (files.length) queueFiles(files, options);
  return true;
}
function pickFilesOrInput(input, options={}){
  openFilesWithHandles(options).then(handled => {
    if (!handled && input) input.click();
  });
}

function queueFiles(files, options={}){
  const batch = [...files];
  if (!batch.length) return fileQueue;
  let opts = options;
  // 여러 파일을 한 번에 올리면 그 묶음을 같은 작업폴더의 옆 파일로 묶는다(.py 실행 시 import/파일읽기 지원).
  if (!options.archiveCtx){
    const loose = batch.filter(f => !["zip","tar","gz","tgz"].includes((f.name.split(".").pop() || "").toLowerCase()));
    if (loose.length > 1){
      const ctx = makeFileSiblingCtx(loose.map(f => ({ file: f, relPath: f.name })), "여러 파일");
      opts = { ...options, archiveCtx: ctx };
    }
  }
  fileQueue = fileQueue
    .then(() => runUiBatch(async () => { await rememberWorkspace(batch, docs.length === 0); await handleFiles(batch, opts); }))
    .catch((e) => { if (e && e.message === "operation-cancelled") toast("파일 열기를 취소했어요."); else console.error(e); });
  return fileQueue;
}

/* 폴더 열기(webkitdirectory / File System Access API)
   - 지원 브라우저는 디렉터리 핸들을 보관해 이후 폴더 새로고침을 한 번에 처리한다.
   - 미지원 환경은 기존 folder input으로 폴더를 다시 선택하는 방식으로 폴백한다. */
let pendingFolderRefreshId = null;

function setFileRelativePath(file, path){
  try { Object.defineProperty(file, "webkitRelativePath", { value: path, configurable: true }); } catch(e){}
  return file;
}
async function collectDirectoryHandleFiles(handle){
  if (!handle || handle.kind !== "directory") return { files: [], folderPaths: [] };
  const rootName = handle.name || "폴더";
  const files = [];
  const folderPaths = [rootName];
  const walk = async (dir, parts) => {
    for await (const entry of dir.values()){
      throwIfUiCancelled();
      if (!entry || !entry.name) continue;
      if (entry.kind === "directory"){
        if (entry.name.charAt(0) === ".") continue;
        const nextParts = parts.concat(entry.name);
        folderPaths.push([rootName].concat(nextParts).join("/"));
        await walk(entry, nextParts);
      } else if (entry.kind === "file"){
        const file = withDirHandle(withFileHandle(await entry.getFile(), entry), dir);
        setFileRelativePath(file, [rootName].concat(parts, entry.name).join("/"));
        files.push(file);
      }
    }
  };
  await walk(handle, []);
  return { files, folderPaths };
}
async function collectFolderEntryPaths(entries, fileList){
  const paths = new Set();
  const firstFilePath = String((fileList && fileList[0] && (fileList[0].webkitRelativePath || fileList[0].name)) || "");
  const rootName = normalizedRunPath(firstFilePath).split("/")[0] || "";
  const addParents = (value, includeSelf=false) => {
    const parts = normalizedRunPath(value).split("/").filter(Boolean);
    const end = includeSelf ? parts.length : Math.max(0, parts.length - 1);
    for (let i = 1; i <= end; i++) paths.add(parts.slice(0, i).join("/"));
  };
  [...(fileList || [])].forEach(file => addParents(file.webkitRelativePath || file.name));
  const visit = async (entry) => {
    if (!entry) return;
    let path = normalizedRunPath(entry.fullPath || entry.name);
    if (rootName && path && path.split("/")[0] !== rootName) path = rootName + "/" + path;
    if (entry.isDirectory){
      if ((entry.name || "").charAt(0) === ".") return;
      addParents(path, true);
      let children = [];
      try { children = await readAllDirectoryEntries(entry); } catch(e){ console.warn(e); }
      for (const child of children) await visit(child);
    } else if (entry.isFile) {
      addParents(path);
    }
  };
  for (const entry of entries || []) await visit(entry);
  return [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}
async function chooseFolderHandle(startIn=null){
  if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") return null;
  const options = { mode: "read" };
  if (startIn && startIn.kind === "directory") options.startIn = startIn;
  try { return await window.showDirectoryPicker(options); }
  catch(e){
    if (options.startIn && !(e && e.name === "AbortError")){
      try { return await window.showDirectoryPicker({ mode: "read" }); }
      catch(f){
        if (!(f && f.name === "AbortError")) console.warn("directory picker failed:", f);
        return null;
      }
    }
    if (!(e && e.name === "AbortError")) console.warn("directory picker failed:", e);
    return null;
  }
}
async function askOriginalFolderSave(handle){
  if (!handle || handle.kind !== "directory" || typeof handle.requestPermission !== "function") return false;
  const useOriginal = await confirmDialog(
    "이 폴더의 코드·텍스트 파일에서 저장을 누르면 원본 파일을 바로 덮어쓸까요? 실행 결과와 새 파일은 기존 자동 저장 폴더에 보관됩니다.",
    "원본에 저장",
    "사본으로 저장"
  );
  if (!useOriginal) return false;
  try {
    let permission = typeof handle.queryPermission === "function"
      ? await handle.queryPermission({ mode:"readwrite" })
      : "prompt";
    if (permission !== "granted") permission = await handle.requestPermission({ mode:"readwrite" });
    if (permission === "granted"){
      toast("원본 저장 모드를 켰어요. 저장할 때 원본 파일이 변경됩니다.", 3600);
      return true;
    }
  } catch(e){ console.warn("folder write permission denied:", e); }
  toast("폴더 쓰기 권한이 없어 기존 자동 저장 폴더를 사용합니다.", 3400);
  return false;
}
async function pickFolderOrInput(input){
  pendingFolderRefreshId = null;
  const supportsPicker = typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
  if (!supportsPicker){
    if (input) input.click();
    return;
  }
  const handle = await chooseFolderHandle();
  if (!handle) return;
  const originalSaveMode = await askOriginalFolderSave(handle);
  showLoading("폴더 파일 확인 중…");
  try {
    const snapshot = await collectDirectoryHandleFiles(handle);
    queueFolder(snapshot.files, { folderHandle: handle, folderPaths: snapshot.folderPaths, originalSaveMode });
  } catch(e){
    if (e && e.message === "operation-cancelled") toast("폴더 열기를 취소했어요.");
    else { console.error(e); toast("폴더를 읽지 못했어요.", 3000); }
  } finally {
    hideLoading();
  }
}
function handleFolderInputSelection(fileList, options={}){
  const refreshId = pendingFolderRefreshId;
  pendingFolderRefreshId = null;
  if (refreshId) return queueFolderRefresh(refreshId, fileList, options);
  return queueFolder(fileList, options);
}
function clearPendingFolderRefresh(){ pendingFolderRefreshId = null; }
function queueFolder(fileList, options={}){
  const files = [...fileList];
  if (!files.length && !(options.folderPaths && options.folderPaths.length)) return fileQueue;
  fileQueue = fileQueue.then(() => runUiBatch(async () => {
    if (files.length || (options.folderPaths && options.folderPaths.length))
      await rememberWorkspace(files, navNodes.length === 0, { folderPaths:options.folderPaths || [] });
    await openFolderFiles(files, options);
  })).catch((e) => { if (e && e.message === "operation-cancelled") toast("폴더 열기를 취소했어요."); else console.error(e); });
  return fileQueue;
}

function folderOpenableFiles(fileList){
  // 열 수 있는 형식 + 숨김파일 제외(.env 계열은 예외)
  return [...fileList].filter(f => {
    const base = f.name || "";
    if (!base || isHiddenFolderEntry(f.webkitRelativePath || base)) return false;
    return ZIP_OPENABLE.includes(fileExtOf(base));
  });
}
async function openFolderFiles(fileList, options={}){
  const openable = folderOpenableFiles(fileList);
  const folderPaths = [...new Set((options.folderPaths || []).map(normalizedRunPath).filter(Boolean))]
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  if (!openable.length && !folderPaths.length){ toast("폴더 안에 열 수 있는 파일이나 폴더가 없어요.", 3000); return; }

  const rootName = ((openable[0] && openable[0].webkitRelativePath || folderPaths[0] || "").split("/")[0]) || "폴더";
  const rootGroup = makeGroup("folder", rootName, null);
  rootGroup.folderRefreshRootId = rootGroup.nodeId;
  rootGroup.folderHandle = options.folderHandle || null;
  rootGroup.originalSaveMode = !!options.originalSaveMode;
  rootGroup.folderPaths = folderPaths.length ? folderPaths : [rootName];
  rootGroup.workspacePaths = [
    ...[...fileList].map(f => f.webkitRelativePath || (rootName + "/" + f.name)),
    ...rootGroup.folderPaths.map(workspaceFolderMarkerPath)
  ];
  const workspacePathsByFolder = indexWorkspacePathsByFolder(rootGroup.workspacePaths);
  // 폴더 전체(데이터 파일 포함, 숨김 경로 제외)를 옆 파일로 묶는다 — .py 실행 시 import/파일읽기 지원
  const folderCtx = makeFileSiblingCtx(
    [...fileList]
      .filter(f => !isHiddenFolderEntry(f.webkitRelativePath || f.name || ""))
      .map(f => ({ file: f, relPath: f.webkitRelativePath || (rootName + "/" + f.name) })),
    rootName,
    folderPaths
  );
  rootGroup.newPythonContext = {
    parentId: rootGroup.nodeId, dir: rootName, archiveCtx: folderCtx, label: rootName
  };
  const folders = new Map();                 // 상대경로 key → 그룹 nodeId
  const parentFor = (relPath) => {
    const parts = String(relPath || "").split("/").filter(Boolean);
    parts.pop();                             // 파일명 제거
    if (parts.length) parts.shift();         // 루트 폴더명 제거(rootGroup 이 담당)
    let parentId = rootGroup.nodeId, key = rootName;
    for (const part of parts){
      key += "/" + part;
      if (!folders.has(key)){
        const subgroup = makeGroup("folder", part, parentId);
        subgroup.workspacePaths = workspacePathsByFolder.get(key) || [];
        subgroup.newPythonContext = {
          parentId: subgroup.nodeId, dir: key, archiveCtx: folderCtx, label: part
        };
        subgroup.folderRefreshRootId = rootGroup.nodeId;
        folders.set(key, subgroup.nodeId);
      }
      parentId = folders.get(key);
    }
    return parentId;
  };
  // FileList에는 빈 디렉터리가 들어오지 않지만, Chrome/Edge의 디렉터리 핸들에서는
  // 폴더 경로를 별도로 수집할 수 있다. 파일을 열기 전에 그 경로로 빈 그룹까지 만든다.
  folderPaths.forEach(path => parentFor(path + "/.__empty_folder__"));

  showLoading("폴더 여는 중…");
  let opened = 0;
  for (const f of openable){
    try {
      updateLoading(`폴더 여는 중… (${opened + 1}/${openable.length})`);
      const rel = f.webkitRelativePath || (rootName + "/" + f.name);
      const parentId = parentFor(rel);
      hideLoading();
      await handleFiles([f], { parentId, bulk: true, relPath: rel, archiveCtx: folderCtx,
        originalSaveMode: rootGroup.originalSaveMode });   // 첫 개만 즉시 렌더, 나머지 지연
      opened++;
      await yieldToBrowser();
      showLoading(`폴더 여는 중… (${opened}/${openable.length})`);
    } catch(e){ if (e && e.message === "operation-cancelled") throw e; console.error(e); }
  }
  hideLoading();
  if (!opened && !folderPaths.length){ closeGroup(rootGroup.nodeId); toast("폴더를 열지 못했어요.", 3000); return null; }
  if (!options.silent){
    const subfolderCount = Math.max(0, folders.size);
    const summary = opened ? opened + "개 파일" : "빈 폴더";
    toast(summary + (subfolderCount ? " · 폴더 " + subfolderCount + "개" : "") + " 열기", 2800);
  }
  return rootGroup;
}

function navBranchIds(rootId){
  const ids = new Set([rootId]);
  let changed = true;
  while (changed){
    changed = false;
    navNodes.forEach(node => {
      if (!ids.has(node.nodeId) && ids.has(node.parentId)){
        ids.add(node.nodeId);
        changed = true;
      }
    });
  }
  return ids;
}
function groupStablePath(node){
  if (!node) return "";
  if (node.newPythonContext && node.newPythonContext.dir) return normalizedRunPath(node.newPythonContext.dir);
  const parts = [node.name || ""];
  let parentId = node.parentId;
  while (parentId){
    const parent = navNodes.find(item => item.nodeId === parentId && item.type === "group");
    if (!parent) break;
    parts.unshift(parent.name || "");
    parentId = parent.parentId;
  }
  return parts.filter(Boolean).join("/");
}
async function requestFolderRefresh(rootId){
  const root = navNodes.find(node => node.nodeId === rootId && node.type === "group" && node.folderRefreshRootId === node.nodeId);
  if (!root) return;
  let handle = root.folderHandle || null;
  if (handle && handle.kind === "directory" && await ensureReadPermission(handle)){
    showLoading("폴더 변경 내용 확인 중…");
    try {
      const snapshot = await collectDirectoryHandleFiles(handle);
      root.folderHandle = handle;
      queueFolderRefresh(rootId, snapshot.files, { folderHandle: handle, folderPaths: snapshot.folderPaths });
    } catch(e){
      if (e && e.message === "operation-cancelled") toast("폴더 새로고침을 취소했어요.");
      else { console.error(e); toast("폴더를 다시 읽지 못했어요.", 3000); }
    } finally {
      hideLoading();
    }
    return;
  }

  const supportsPicker = typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
  if (supportsPicker){
    const picked = await chooseFolderHandle(root.folderHandle || null);
    if (!picked) return;
    showLoading("폴더 변경 내용 확인 중…");
    try {
      const snapshot = await collectDirectoryHandleFiles(picked);
      queueFolderRefresh(rootId, snapshot.files, { folderHandle: picked, folderPaths: snapshot.folderPaths });
    } catch(e){
      if (e && e.message === "operation-cancelled") toast("폴더 새로고침을 취소했어요.");
      else { console.error(e); toast("폴더를 다시 읽지 못했어요.", 3000); }
    } finally {
      hideLoading();
    }
    return;
  }

  const input = byId("folderInput");
  if (!input) return;
  pendingFolderRefreshId = rootId;
  toast("'" + root.name + "' 폴더를 다시 선택해 주세요.", 3200);
  input.click();
}
function queueFolderRefresh(rootId, fileList, options={}){
  const files = [...fileList];
  if (!files.length && !(options.folderPaths && options.folderPaths.length)) return fileQueue;
  fileQueue = fileQueue
    .then(() => runUiBatch(() => refreshFolderGroup(rootId, files, options)))
    .catch((e) => {
      if (e && e.message === "operation-cancelled") toast("폴더 새로고침을 취소했어요.");
      else { console.error(e); toast("폴더 새로고침 중 오류가 났어요.", 3200); }
    });
  return fileQueue;
}
async function refreshFolderGroup(rootId, fileList, options={}){
  const root = navNodes.find(node => node.nodeId === rootId && node.type === "group");
  if (!root) return false;
  const files = [...fileList];
  const openable = folderOpenableFiles(files);
  const folderPaths = [...new Set((options.folderPaths || []).map(normalizedRunPath).filter(Boolean))];
  if (!openable.length && !folderPaths.length){ toast("새로고침할 수 있는 파일이나 폴더가 없어요.", 3200); return false; }
  const selectedRootName = ((openable[0] && openable[0].webkitRelativePath || folderPaths[0] || "").split("/")[0]) || "폴더";
  if (selectedRootName !== root.name){
    toast("'" + root.name + "' 폴더를 선택해야 새로고침할 수 있어요.", 3600);
    return false;
  }

  const branchIds = navBranchIds(rootId);
  const childDocs = docs.filter(doc => branchIds.has(doc.nodeId));
  const childDocIds = new Set(childDocs.map(doc => doc.id));
  const hasUnsaved = childDocs.some(doc => doc.hasUnsavedEdits || (doc.isScratch && !doc._named));
  const editedPdfs = childDocs.filter(doc => doc.kind === "pdf" && doc.elements && doc.elements.length);
  if (hasUnsaved || editedPdfs.length){
    const detail = hasUnsaved && editedPdfs.length ? "저장하지 않은 코드와 PDF 편집" : (hasUnsaved ? "저장하지 않은 코드" : "PDF 편집");
    const ok = await confirmDialog(detail + "이 있습니다. 폴더를 새로고침하면 해당 내용이 사라질 수 있어요.", "새로고침", "취소");
    if (!ok) return false;
  }

  const refForId = (id) => {
    const doc = docs.find(item => item.id === id);
    if (!doc) return null;
    if (!childDocIds.has(id)) return { id };
    return { path: normalizedRunPath(doc.workspacePath || doc.relPath || doc.name) };
  };
  const tabRefs = tabOrder.map(refForId).filter(Boolean);
  const activeRef = refForId(activeId);
  const studyRef = refForId(studyPdfId);
  const mruRefs = activeMru.map(refForId).filter(Boolean);
  const expanded = new Map();
  navNodes.filter(node => branchIds.has(node.nodeId) && node.type === "group")
    .forEach(node => expanded.set(groupStablePath(node), node.expanded !== false));
  const oldRootIndex = navNodes.findIndex(node => node.nodeId === rootId);
  const oldPaths = [...(root.workspacePaths || [])].map(normalizedRunPath);

  for (const doc of editedPdfs){
    if (doc.recoveryKey && typeof deletePdfRecovery === "function") await deletePdfRecovery(doc.recoveryKey);
    doc.recoveryDirty = false;
  }
  childDocs.forEach(doc => closeDoc(doc.id, { skipConfirm: true, skipPrune: true, skipUi: true }));
  for (let i = navNodes.length - 1; i >= 0; i--){
    if (branchIds.has(navNodes[i].nodeId)) navNodes.splice(i, 1);
  }
  bumpNavTree();

  const nextRoot = await openFolderFiles(files, { ...options, silent: true, originalSaveMode: !!root.originalSaveMode });
  if (!nextRoot) return false;
  const nextBranchIds = navBranchIds(nextRoot.nodeId);
  const nextNodes = navNodes.filter(node => nextBranchIds.has(node.nodeId));
  for (let i = navNodes.length - 1; i >= 0; i--){
    if (nextBranchIds.has(navNodes[i].nodeId)) navNodes.splice(i, 1);
  }
  navNodes.splice(Math.max(0, Math.min(oldRootIndex, navNodes.length)), 0, ...nextNodes);
  bumpNavTree();
  nextNodes.filter(node => node.type === "group").forEach(node => {
    const saved = expanded.get(groupStablePath(node));
    if (saved !== undefined) node.expanded = saved;
  });

  const nextDocs = docs.filter(doc => nextBranchIds.has(doc.nodeId));
  const resolveRef = (ref) => {
    if (!ref) return null;
    if (ref.id != null) return docs.some(doc => doc.id === ref.id) ? ref.id : null;
    const match = nextDocs.find(doc => normalizedRunPath(doc.workspacePath || doc.relPath || doc.name) === ref.path);
    return match ? match.id : null;
  };
  const restoredTabs = [], seenTabs = new Set();
  tabRefs.forEach(ref => {
    const id = resolveRef(ref);
    if (id != null && !seenTabs.has(id)){ seenTabs.add(id); restoredTabs.push(id); }
  });
  tabOrder = restoredTabs;
  activeMru = mruRefs.map(resolveRef).filter((id, index, rows) => id != null && rows.indexOf(id) === index);
  const nextStudyId = resolveRef(studyRef);
  studyPdfId = nextStudyId != null && docs.some(doc => doc.id === nextStudyId && doc.kind === "pdf") ? nextStudyId : null;
  const wantedActive = resolveRef(activeRef);
  const fallbackActive = wantedActive || restoredTabs[0] || (nextDocs[0] && nextDocs[0].id) || (docs[0] && docs[0].id) || 0;
  sidebarCursorKey = nextRoot.nodeId;
  if (fallbackActive){
    setActiveDoc(fallbackActive);
    uiBatchActiveCandidate = fallbackActive;
  }
  else {
    activeId = 0; state = null; viewer = null;
    refreshChrome(); applyStudyLayout(); renderSidebar();
  }

  if (files.length || folderPaths.length)
    await rememberWorkspace(files, false, { silent: true, folderPaths });
  const nextPathSet = new Set(files.map(file => normalizedRunPath(file.webkitRelativePath || (selectedRootName + "/" + file.name))));
  folderPaths.forEach(path => nextPathSet.add(workspaceFolderMarkerPath(path)));
  const deleted = oldPaths.filter(path => path && !nextPathSet.has(path));
  if (deleted.length) forgetWorkspacePaths(deleted);
  toast("폴더를 새로고침했어요. " + nextDocs.length + "개 파일을 반영했습니다.", 3000);
  return true;
}

function readEntryFile(entry){
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(reader){
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function readAllDirectoryEntries(entry){
  const reader = entry.createReader();
  const all = [];
  for (;;){
    const batch = await readDirectoryEntries(reader);
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
}

async function handleEntry(entry, parentId=null){
  if (!entry) return;
  if (entry.isDirectory){
    const group = makeGroup("folder", entry.name, parentId);
    const entries = await readAllDirectoryEntries(entry);
    entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
    for (const child of entries) await handleEntry(child, group.nodeId);
    if (!navNodes.some(n => n.parentId === group.nodeId)) closeGroup(group.nodeId);
    return;
  }
  if (entry.isFile){
    let file;
    try { file = await readEntryFile(entry); }
    catch (e){ console.warn("파일 엔트리를 읽지 못해 건너뜀:", entry.name, e); return; }
    await handleFiles([file], { parentId, bulk: true });   // 폴더=묶음 열기: 첫 개만 즉시 렌더, 나머지는 지연(빈 화면·렌더 폭주 방지)
  }
}

async function handleDroppedItems(entries){
  let used = false;
  for (const entry of entries){
    if (!entry) continue;
    used = true;
    await handleEntry(entry, null);
  }
  return used;
}

// 폴더 드롭도 폴더 선택과 같은 File[] 형태로 모아 저장·옆파일 실행·자동복원을 모두 지원한다.
async function collectDroppedFiles(entry, prefix, out, folderPaths){
  if (!entry) return;
  const rel = prefix ? prefix + "/" + entry.name : entry.name;
  if (entry.isDirectory){
    if ((entry.name || "").charAt(0) === ".") return;
    if (folderPaths) folderPaths.push(rel);
    const children = await readAllDirectoryEntries(entry);
    for (const child of children) await collectDroppedFiles(child, rel, out, folderPaths);
  } else if (entry.isFile){
    try {
      const file = await readEntryFile(entry);
      Object.defineProperty(file, "webkitRelativePath", { value: rel });
      out.push(file);
    } catch(e){ console.warn("파일 엔트리를 읽지 못해 건너뜀:", entry.name, e); }
  }
}

function queueDroppedItems(dataTransfer){
  const items = dataTransfer && dataTransfer.items;
  const files = dataTransfer && dataTransfer.files ? [...dataTransfer.files] : [];
  if (!items || !items.length) return queueFiles(files);
  // 엔트리는 드롭 이벤트가 끝나기 전에 동기적으로 확보해야 한다(이후 item 무효화).
  const entries = [];
  for (const item of [...items]){
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  // 폴더 드롭이 아니면 신뢰할 수 있는 dataTransfer.files 를 그대로 쓴다.
  // file:// 로 열면 FileSystemFileEntry.file() 이 EncodingError 로 깨지는 Chrome 버그가 있어,
  // 일반 파일은 엔트리 API 를 거치지 않는다(폴더 구조 파악이 필요할 때만 엔트리 순회).
  const hasDir = entries.some(en => en.isDirectory);
  if (!hasDir) return queueFiles(files);
  fileQueue = fileQueue
    .then(() => runUiBatch(async () => {
      const collected = [];
      const folderPaths = [];
      for (const entry of entries) await collectDroppedFiles(entry, "", collected, folderPaths);
      if (collected.length || folderPaths.length)
        await rememberWorkspace(collected, navNodes.length === 0, { folderPaths });
      await openFolderFiles(collected, { folderPaths });
    }))
    .catch((e) => { if (e && e.message === "operation-cancelled") toast("폴더 열기를 취소했어요."); else console.error(e); });
  return fileQueue;
}

async function loadPdf(arrayBuffer, name, options={}){
  if (typeof pdfjsLib === "undefined" || typeof PDFLib === "undefined"){
    toast("라이브러리 로드 실패 — 인터넷 연결을 확인하세요."); return;
  }
  const doc = makeDoc("pdf", name || "document.pdf", options);
  doc.pdfBytes = arrayBuffer;              // 원본은 그대로 보관
  doc.fileName = name || "document.pdf";
  doc.recoveryKey = pdfRecoveryKey(doc.fileName, arrayBuffer);
  // 무거운 파싱/렌더는 처음 활성화될 때(지연 렌더) 수행한다.
  doc.render = async () => {
    try {
      await ensureWorker();
      const data = new Uint8Array(arrayBuffer.slice(0)); // pdf.js 에는 복사본 전달
      // disableFontFace: 임베드 폰트의 글리프를 캔버스에 직접 그린다.
      //  → 브라우저가 서브셋 한글(CJK) 폰트의 @font-face 를 거부해 두부글자(□)로 깨지는 문제 방지(특히 file://).
      // useSystemFonts:false: 시스템 폰트로 대체하지 않고 임베드 폰트를 그대로 사용.
      const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
      doc.pdfjsDoc = pdf;

      // 페이지 크기만 먼저 구해 placeholder(프레임+오버레이) 생성 — 레이아웃/스크롤 확정.
      // 무거운 캔버스 렌더는 화면에 보일 때만(지연 렌더) 수행해 메모리를 아낀다.
      let rotatedWarn = false;
      for (let n = 1; n <= pdf.numPages; n++){
        updateLoading(`PDF 여는 중… (${n}/${pdf.numPages})`);
        if (doc.closed) return;
        const page = await pdf.getPage(n);
        if (page.rotate % 360 !== 0) rotatedWarn = true;
        createPagePlaceholder(page, doc, n);
        if (typeof page.cleanup === "function") page.cleanup();
        if (n % 8 === 0) await yieldToBrowser();
      }
      if (doc.closed) return;
      startLazyRender(doc);          // 보이는 페이지부터 렌더, 멀어지면 캔버스 해제
      await restorePdfRecovery(doc);
      initPdfHistory(doc);
      createPdfPagePanel(doc);

      byId("hint").hidden = false;
      setTimeout(()=>{ byId("hint").hidden = true; }, 6000);
      if (rotatedWarn) toast("회전된 페이지가 있어 위치가 약간 어긋날 수 있어요.", 3500);
    } catch (e){
      console.error(e);
      toast("PDF 를 열지 못했습니다. (암호 걸린 파일은 미지원)", 3500);
      throw new Error("handled");      // ensureRendered 가 일반 오류 토스트 없이 닫도록
    }
  };
  refreshChrome();
  activateIfIdle(doc, options);          // 단일 열기면 즉시 렌더, 묶음이면 첫 개만
}

// 페이지 placeholder 생성: 크기·오버레이·프레임만 만들고 캔버스는 지연 렌더로 미룬다.
function createPagePlaceholder(page, doc, pageNum){
  const base = page.getViewport({ scale: 1 });
  const avail = Math.min(FIT_MAX_W, doc.el.clientWidth - 40);
  let scale = (avail / base.width) * FIT_SCALE;
  scale = Math.max(0.3, Math.min(scale, 2.2));
  const vp = page.getViewport({ scale });

  const pageEl = document.createElement("div");
  pageEl.className = "page";
  pageEl.style.width = vp.width + "px";
  pageEl.style.height = vp.height + "px";

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) selectEl(null, doc); });

  const frame = document.createElement("div");
  frame.className = "page-frame";
  frame.style.width = vp.width + "px";
  frame.style.height = vp.height + "px";

  pageEl.appendChild(overlay);                 // 캔버스는 보일 때 overlay 앞(아래)에 끼워넣음
  frame.appendChild(pageEl);
  doc.el.appendChild(frame);

  const pinfo = {
    pageEl, overlay, frame, scale, pageNum,
    originalIndex: pageNum - 1, exportRotation: 0,
    cssW: vp.width, cssH: vp.height,
    ptW: base.width, ptH: base.height,
    rotation: page.rotate % 360,
    canvas: null, rendered: false, rendering: null,
    renderedDpr: 0, renderingDpr: 0, renderTask: null, gen: 0, visible: false,
    textLayer: null, annotLayer: null, textBuilt: false, textBuilding: false, textGen: 0,
  };
  doc.pages.push(pinfo);
  doc.allPages.push(pinfo);
  if (doc.zoom && doc.zoom !== 1) applyPageZoom(pinfo, doc.zoom);
}

// 현재 줌(보이는 배율)에 맞는 캔버스 해상도(device px 배수)를 구한다.
//  - 최소 RENDER_SCALE 배 슈퍼샘플로 작게 봐도 또렷.
//  - 줌을 키우면 screen*zoom 으로 따라 올라가 그 배율에서도 1:1 이상 → 크롬처럼 선명.
//  - 캔버스 한 변이 RENDER_MAX_SIDE 를 넘지 않게 제한(메모리). 단 z=1 품질(RENDER_SCALE)은 보존.
function targetRenderDpr(doc, p){
  const screen = window.devicePixelRatio || 1;
  const z = (doc.zoom || 1);
  const dr = doc.el.getBoundingClientRect(), pr = p.frame.getBoundingClientRect();
  const actuallyVisible = pr.bottom > dr.top && pr.top < dr.bottom && pr.right > dr.left && pr.left < dr.right;
  const profile = pdfRenderProfile();
  const floor = actuallyVisible ? RENDER_SCALE : profile.prefetchScale;
  const maxSide = actuallyVisible ? RENDER_MAX_SIDE : profile.prefetchMaxSide;
  const want = Math.max(floor, actuallyVisible ? screen * z : Math.min(screen * z, 2));
  const longSide = Math.max(p.cssW, p.cssH) || 1;
  const cap = Math.max(floor, maxSide / longSide);
  return Math.min(want, cap);
}

// 페이지 캔버스를 실제로 그린다(화면에 보일 때 호출). 줌이 커져 더 높은 해상도가 필요하면 다시 그린다.
// 지연 렌더(IntersectionObserver)와 줌 핸들러가 함께 호출한다. 레이아웃/오버레이 좌표는 p.scale 고정이고
// 캔버스 CSS 크기도 항상 cssW×cssH 라서, 해상도가 바뀌어도 서명·텍스트 좌표계엔 영향이 없다.
function renderPageCanvas(doc, p){
  if (!doc.pdfjsDoc) return Promise.resolve();
  const target = targetRenderDpr(doc, p);
  const EPS = 0.01;
  if (p.rendered  && target <= (p.renderedDpr  || 0) + EPS) return p.rendering || Promise.resolve();
  if (p.rendering && target <= (p.renderingDpr || 0) + EPS) return p.rendering;
  // 더 높은 해상도가 필요 → 진행 중인 저해상도 렌더가 있으면 취소하고 다시 그린다.
  if (p.rendering && p.renderTask){ try { p.renderTask.cancel(); } catch(e){} }
  const gen = (p.gen = (p.gen || 0) + 1);
  p.renderingDpr = target;
  p.rendering = (async () => {
    try {
      const page = await doc.pdfjsDoc.getPage(p.pageNum);
      if (doc.closed || p.gen !== gen || !p.frame.isConnected) return;
      const vp = page.getViewport({ scale: p.scale });    // 레이아웃은 그대로, 해상도(target)만 키운다
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(vp.width  * target);
      canvas.height = Math.round(vp.height * target);
      canvas.style.width  = vp.width + "px";              // CSS 크기는 항상 cssW×cssH → 오버레이와 정합 유지
      canvas.style.height = vp.height + "px";
      const ctx = canvas.getContext("2d");
      ctx.scale(target, target);
      const task = page.render({ canvasContext: ctx, viewport: vp });
      p.renderTask = task;
      await task.promise;
      if (typeof page.cleanup === "function") page.cleanup();
      if (doc.closed || p.gen !== gen || !p.frame.isConnected){ canvas.width = canvas.height = 0; return; }
      const old = p.canvas;
      p.pageEl.insertBefore(canvas, p.pageEl.firstChild);          // 새 캔버스를 오버레이 뒤(아래)에 먼저 끼우고
      if (old && old !== canvas){ old.width = old.height = 0; old.remove(); }   // 옛 캔버스 교체(깜빡임 최소화)
      p.canvas = canvas;
      p.rendered = true;
      p.renderedDpr = target;
    } catch (e){
      if (!(e && e.name === "RenderingCancelledException")) console.error("page render", e);
    } finally {
      if (p.gen === gen){ p.renderTask = null; p.rendering = null; p.renderingDpr = 0; }
    }
  })();
  return p.rendering;
}

// 멀어진 페이지의 캔버스를 비워 메모리를 회수한다(오버레이·서명은 그대로 유지).
function releasePageCanvas(p){
  if (!p || p.rendering) return;
  if (p.canvas){
    p.canvas.width = 0; p.canvas.height = 0;
    p.canvas.remove();
    p.canvas = null;
  }
  p.rendered = false; p.renderedDpr = 0;
}

// ── PDF 텍스트 선택 레이어 + 링크(URL) 레이어 ────────────────────────────────
// 캔버스는 "그림"이라 글자를 잡거나 링크를 누를 수 없다. PDF.js 가 주는 글자 좌표로
// 투명한 텍스트 레이어를, 링크 주석으로 클릭 영역을 얹어 크롬 PDF 뷰어처럼 만든다.
// 좌표계는 캔버스와 같은 p.scale(getViewport) 이라 줌·회전(pageEl transform)에 그대로 따라간다.
const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;   // javascript:/file:/data: 등 위험 스킴 차단
function ensurePdfTextLinks(doc, p){
  if (!doc || !doc.pdfjsDoc || p.textBuilt || p.textBuilding) return;
  if (typeof pdfjsLib === "undefined" || typeof pdfjsLib.renderTextLayer !== "function") return;
  p.textBuilding = true;
  const gen = (p.textGen = (p.textGen || 0) + 1);    // 진행 중 빌드를 무효화할 수 있게 세대 표식
  (async () => {
    try {
      const page = await doc.pdfjsDoc.getPage(p.pageNum);
      if (doc.closed || p.textGen !== gen) return;
      const vp = page.getViewport({ scale: p.scale });

      // 1) 텍스트(선택) 레이어 — v3 는 --scale-factor 변수로 글자 위치를 계산한다
      const tl = document.createElement("div");
      tl.className = "pdf-text-layer";
      tl.style.width = p.cssW + "px"; tl.style.height = p.cssH + "px";
      tl.style.setProperty("--scale-factor", p.scale);
      const tc = await page.getTextContent();
      if (doc.closed || p.textGen !== gen) return;
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise;
      if (doc.closed || p.textGen !== gen) return;

      // 2) 링크(URL) 레이어 — 링크 주석의 사각형을 뷰포트 좌표로 바꿔 <a> 클릭 영역을 얹는다
      const al = document.createElement("div");
      al.className = "pdf-annot-layer";
      al.style.width = p.cssW + "px"; al.style.height = p.cssH + "px";
      let annots = [];
      try { annots = await page.getAnnotations({ intent: "display" }); } catch(e){}
      if (doc.closed || p.textGen !== gen) return;
      for (const a of annots){
        if (!a || a.subtype !== "Link" || !a.url || !SAFE_LINK_SCHEME.test(a.url)) continue;
        const r = vp.convertToViewportRectangle(a.rect);
        const link = document.createElement("a");
        link.href = a.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.title = a.url;
        link.style.left   = Math.min(r[0], r[2]) + "px";
        link.style.top    = Math.min(r[1], r[3]) + "px";
        link.style.width  = Math.abs(r[2] - r[0]) + "px";
        link.style.height = Math.abs(r[3] - r[1]) + "px";
        al.appendChild(link);
      }

      p.pageEl.appendChild(tl);      // 캔버스·오버레이 위에 얹음(컨테이너는 pointer-events:none)
      p.pageEl.appendChild(al);
      p.textLayer = tl; p.annotLayer = al;
      p.textBuilt = true;
    } catch (e){
      if (!(e && (e.name === "AbortException" || e.name === "RenderingCancelledException")))
        console.warn("PDF 텍스트/링크 레이어 실패:", e);
    } finally {
      if (p.textGen === gen) p.textBuilding = false;
    }
  })();
}
function releasePdfTextLinks(p){
  if (!p) return;
  p.textGen = (p.textGen || 0) + 1;    // 진행 중인 빌드가 있으면 무효화
  p.textBuilding = false; p.textBuilt = false;
  if (p.textLayer){ p.textLayer.remove(); p.textLayer = null; }
  if (p.annotLayer){ p.annotLayer.remove(); p.annotLayer = null; }
}

// ── 선택 하이라이트를 줄 단위 통짜 막대로 직접 그린다(크롬 PDF 뷰어처럼 균일하게) ──
// PDF.js 텍스트 레이어는 단어별 조각이라 네이티브 선택이 들쭉날쭉하다. 그래서 네이티브
// 하이라이트는 CSS 에서 끄고(::selection 투명), 선택 범위의 사각형들을 줄끼리 병합해
// 뷰어(스크롤 컨테이너) 좌표로 다시 그린다. getClientRects 는 이미 줌·회전이 반영된
// 화면 좌표라, 스크롤 오프셋만 더하면 줌/회전에도 그대로 맞는다.
function pdfSelLayer(doc){
  if (!doc || !doc.el) return null;
  if (!doc.selHiLayer || !doc.selHiLayer.isConnected){
    const layer = document.createElement("div");
    layer.className = "pdf-sel-hilite";
    doc.el.appendChild(layer);
    doc.selHiLayer = layer;
  }
  return doc.selHiLayer;
}
let _pdfSelRAF = 0;
function schedulePdfSelHighlight(){
  if (_pdfSelRAF) return;
  _pdfSelRAF = requestAnimationFrame(() => { _pdfSelRAF = 0; drawPdfSelHighlight(); });
}
function refreshPdfSelHighlight(){ schedulePdfSelHighlight(); }   // 줌/리사이즈 후 재계산용
function drawPdfSelHighlight(){
  for (const d of docs){ if (d.kind === "pdf" && d.selHiLayer) d.selHiLayer.textContent = ""; }  // 이전 것 지움
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const anchor = sel.anchorNode;
  const anchorEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
  if (!anchorEl || !anchorEl.closest || !anchorEl.closest(".pdf-text-layer")) return;   // PDF 글자 선택만
  const doc = docs.find(d => d.kind === "pdf" && d.el && d.el.contains(anchor));
  if (!doc) return;

  // 선택 범위의 사각형 모으기
  const rects = [];
  for (let i = 0; i < sel.rangeCount; i++){
    for (const r of sel.getRangeAt(i).getClientRects()){
      if (r.width > 0.5 && r.height > 0.5) rects.push(r);
    }
  }
  if (!rects.length) return;

  // 줄 단위로 묶어 통짜 막대로 병합(단어 사이 빈칸·요철 제거)
  const lines = [];
  for (const r of rects){
    let g = null;
    for (const cand of lines){
      const overlap = Math.min(r.bottom, cand.bottom) - Math.max(r.top, cand.top);
      if (overlap > 0.4 * Math.min(r.height, cand.bottom - cand.top)){ g = cand; break; }
    }
    if (g){ g.left = Math.min(g.left, r.left); g.right = Math.max(g.right, r.right);
            g.top = Math.min(g.top, r.top); g.bottom = Math.max(g.bottom, r.bottom); }
    else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }

  const layer = pdfSelLayer(doc); if (!layer) return;
  const cr = doc.el.getBoundingClientRect();
  const sl = doc.el.scrollLeft, st = doc.el.scrollTop;
  const frag = document.createDocumentFragment();
  for (const g of lines){
    const box = document.createElement("div");
    box.className = "pdf-sel-box";
    box.style.left   = (g.left - cr.left + sl) + "px";
    box.style.top    = (g.top  - cr.top  + st) + "px";
    box.style.width  = (g.right - g.left) + "px";
    box.style.height = (g.bottom - g.top) + "px";
    frag.appendChild(box);
  }
  layer.appendChild(frag);
}
document.addEventListener("selectionchange", schedulePdfSelHighlight);
window.addEventListener("resize", schedulePdfSelHighlight);

// 지연 렌더 옵저버: 화면 근처(±3화면) 페이지만 렌더하고, 멀어지면 해제한다.
function startLazyRender(doc){
  if (doc.io){ doc.io.disconnect(); doc.io = null; }
  if (typeof IntersectionObserver === "undefined"){
    doc.pages.forEach(p => { p.visible = true; renderPageCanvas(doc, p); ensurePdfTextLinks(doc, p); });   // 폴백: 전부 렌더
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries){
      const p = doc.pages.find(x => x.frame === en.target);
      if (!p) continue;
      p.visible = en.isIntersecting;                 // 줌 재렌더가 참고할 가시성 기록
      if (en.isIntersecting){ renderPageCanvas(doc, p); ensurePdfTextLinks(doc, p); }
      else { releasePageCanvas(p); releasePdfTextLinks(p); }
    }
  }, { root: doc.el, rootMargin: pdfRenderProfile().rootMargin, threshold: 0 });
  doc.pages.forEach(p => io.observe(p.frame));
  doc.io = io;
  if (!doc.__qualityScrollHandler){
    let scheduled = false;
    doc.__qualityScrollHandler = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; refreshVisibleQuality(doc); if (doc.id === activeId) updatePdfPageIndicator(doc); if (doc.id === studyPdfId) updateStudyPageIndicator(); });
    };
    doc.el.addEventListener("scroll", doc.__qualityScrollHandler, { passive: true });
  }
  if (doc.id === activeId) updatePdfPageIndicator(doc);   // 페이지 수가 바뀌었을 수 있으니 총 페이지 갱신
}
