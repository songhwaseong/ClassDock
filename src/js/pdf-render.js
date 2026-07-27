"use strict";

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
      // The offline EXE cannot reliably load subset Korean fonts through FontFace.
      // Draw embedded glyphs on the canvas instead so Korean text is never replaced by boxes.
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
      createPdfPagePanel(doc);
      await initPdfOutline(doc);     // 원본 책갈피를 편집 모델로 바꾼 뒤 복구본·히스토리와 합친다
      await restorePdfRecovery(doc);
      initPdfHistory(doc);

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

/* ===== PDF 야간 보기(색 반전) =====
   페이지 캔버스에만 CSS 반전 필터를 걸어 눈부심을 줄인다(화면 표시 전용).
   필기·서명·강조는 별도 레이어라 원색을 유지하고, 저장·인쇄 결과에는 영향이 없다. */
let pdfNightMode = (() => { try { return localStorage.getItem("pdfNightMode") === "1"; } catch(e){ return false; } })();
function applyPdfNightMode(){
  byId("content").classList.toggle("pdf-night", pdfNightMode);
  const button = byId("btnPdfNight");
  if (button) button.classList.toggle("primary", pdfNightMode);
}
function togglePdfNightMode(){
  pdfNightMode = !pdfNightMode;
  try { localStorage.setItem("pdfNightMode", pdfNightMode ? "1" : "0"); } catch(e){}
  applyPdfNightMode();
  toast(pdfNightMode ? "야간 보기 켬 — PDF 페이지 색을 반전해 눈부심을 줄여요. (화면 표시만, 저장 결과는 그대로)" : "야간 보기를 껐어요.", 2600);
}

// 복원 과정에서는 활성 문서가 아닌 PDF도 먼저 렌더될 수 있다. hidden 문서의 clientWidth는 0이므로
// 그대로 배율을 계산하면 모든 페이지가 최소 배율(0.3)로 고정된다. 문서 자체 폭을 우선 사용하되,
// 아직 배치되지 않은 경우에는 실제 문서 영역/창 폭으로 계산한다.
function pdfViewerLayoutWidth(doc){
  const ownWidth = Number(doc && doc.el && doc.el.clientWidth) || 0;
  if (ownWidth > 80) return ownWidth;
  const content = typeof byId === "function" ? byId("content") : null;
  const contentWidth = Number(content && content.clientWidth) || 0;
  if (contentWidth > 80) return contentWidth;
  const viewportWidth = typeof window !== "undefined" ? (Number(window.innerWidth) || 0) : 0;
  if (viewportWidth > 80) return viewportWidth;
  return FIT_MAX_W;
}

function pdfPlaceholderAvailableWidth(doc){
  return Math.max(1, Math.min(FIT_MAX_W, pdfViewerLayoutWidth(doc) - 40));
}

// 페이지 placeholder 생성: 크기·오버레이·프레임만 만들고 캔버스는 지연 렌더로 미룬다.
function createPagePlaceholder(page, doc, pageNum){
  const base = page.getViewport({ scale: 1 });
  const avail = pdfPlaceholderAvailableWidth(doc);
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
    textLayer: null, annotLayer: null, textBuilt: false, textBuilding: false, textGen: 0, textIdle: 0,
  };
  doc.pages.push(pinfo);
  doc.allPages.push(pinfo);
  if (doc.zoom && doc.zoom !== 1) applyPageZoom(pinfo, doc.zoom);
}

// 현재 줌(보이는 배율)에 맞는 캔버스 해상도(device px 배수)를 구한다.
//  - 최소 profile.renderScale 배 슈퍼샘플로 작게 봐도 또렷.
//  - 줌을 키우면 screen*zoom 으로 따라 올라가 그 배율에서도 1:1 이상 → 크롬처럼 선명.
//  - 캔버스 한 변이 profile.maxSide 를 넘지 않게 제한(메모리). 단 기본 배율 품질은 보존.
// 화면 밖(프리페치) 페이지는 확대 배율을 따라가지 않고 기본 배율에서 멈춘다. floor·maxSide 는
// 보이든 안 보이든 같은 값이라, 기본 줌에서는 미리 그려둔 캔버스를 그대로 재사용한다(재렌더 없음).
function targetRenderDpr(doc, p){
  const screen = window.devicePixelRatio || 1;
  const z = (doc.zoom || 1);
  const dr = doc.el.getBoundingClientRect(), pr = p.frame.getBoundingClientRect();
  const actuallyVisible = pr.bottom > dr.top && pr.top < dr.bottom && pr.right > dr.left && pr.left < dr.right;
  const profile = pdfRenderProfile();
  const floor = profile.renderScale;
  const want = actuallyVisible ? Math.max(floor, screen * z) : floor;
  const longSide = Math.max(p.cssW, p.cssH) || 1;
  const cap = Math.max(floor, profile.maxSide / longSide);
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
      // 그리는 사이 스크롤로 프리페치 범위를 벗어났으면 결과를 버린다.
      // (붙여두면 IntersectionObserver 의 "이탈" 이벤트는 이미 지나가서 다시 해제될 기회가 없다)
      if (doc.closed || p.gen !== gen || !p.frame.isConnected || !p.visible){ canvas.width = canvas.height = 0; return; }
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
// 그리는 중이었다면 취소하고 결과도 버린다. 예전에는 렌더 중이면 그냥 돌아갔는데(early return),
// 그러면 빠르게 스크롤할 때 화면 밖 대형 캔버스가 계속 쌓여 GC 압박으로 더 심하게 버벅였다.
function releasePageCanvas(p){
  if (!p) return;
  if (p.rendering){
    p.gen = (p.gen || 0) + 1;                     // 진행 중 렌더의 완료 처리를 무효화(캔버스 부착 차단)
    if (p.renderTask){ try { p.renderTask.cancel(); } catch(e){} }
    p.renderTask = null; p.rendering = null; p.renderingDpr = 0;
  }
  if (p.canvas){
    p.canvas.width = 0; p.canvas.height = 0;
    p.canvas.remove();
    p.canvas = null;
  }
  p.rendered = false; p.renderedDpr = 0;
}

// ── 렌더 큐 ────────────────────────────────────────────────────────────────
// pdf.js v3 는 캔버스 래스터화를 메인 스레드에서 한다. 그래서 교차 이벤트가 온 순서대로 전부
// 그리기 시작하면, 빠르게 스크롤할 때 "지나쳐 버린" 페이지들이 큐 앞을 차지하고 정작 사용자가
// 멈춘 페이지가 그 뒤에 밀린다. 동시 실행 수를 제한하고, 꺼낼 때마다 지금 화면에 가까운 것을
// 먼저 고른다(대기 중에 화면 밖으로 나간 페이지는 시작하지 않고 버린다).
function pdfRenderQueue(doc){
  if (!doc.__renderQueue) doc.__renderQueue = { pending: new Set(), active: 0 };
  return doc.__renderQueue;
}
function requestPageRender(doc, p){
  if (!doc || doc.closed || !p) return;
  pdfRenderQueue(doc).pending.add(p);
  pumpRenderQueue(doc);
}
// 대기 중인 페이지 가운데 뷰포트에 가장 가까운 것을 고른다(보이는 페이지는 거리 0 → 항상 먼저).
function takeNextRenderTarget(doc, q){
  const dr = doc.el.getBoundingClientRect();
  let best = null, bestDist = Infinity;
  for (const p of Array.from(q.pending)){
    if (!p.frame || !p.frame.isConnected){ q.pending.delete(p); continue; }
    const pr = p.frame.getBoundingClientRect();
    const dist = (pr.bottom > dr.top && pr.top < dr.bottom)
      ? 0
      : Math.min(Math.abs(pr.top - dr.bottom), Math.abs(dr.top - pr.bottom));
    if (dist < bestDist){ bestDist = dist; best = p; }
  }
  return best;
}
function pumpRenderQueue(doc){
  if (!doc || doc.closed) return;
  const q = pdfRenderQueue(doc);
  const limit = Math.max(1, pdfRenderProfile().maxConcurrent);
  while (q.active < limit && q.pending.size){
    const p = takeNextRenderTarget(doc, q);
    if (!p) break;
    q.pending.delete(p);
    if (!p.visible || !p.frame.isConnected) continue;   // 기다리는 사이 화면 밖으로 나감 → 버림
    q.active++;
    Promise.resolve(renderPageCanvas(doc, p)).catch(()=>{}).then(() => {
      q.active--;
      pumpRenderQueue(doc);
    });
  }
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
// 텍스트 레이어는 페이지당 수백 개의 절대 위치 div 를 만드는 메인 스레드 작업이라, 캔버스 렌더와
// 같은 순간에 돌면 서로 밀어낸다. 글자 선택은 사용자가 스크롤을 멈춘 뒤에나 하는 동작이므로
// idle 시간으로 미루고, 그때 화면 근처에 있는 페이지만 만든다(멀면 그냥 두고 다음 스크롤에 재시도).
const PDF_TEXT_NEAR_RATIO = 0.5;      // 뷰포트 높이의 ±50% 안쪽이면 "화면 근처"
function schedulePdfTextLinks(doc, p){
  if (!doc || doc.closed || !p || p.textBuilt || p.textBuilding || p.textIdle) return;
  const idle = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 })
    : (fn) => setTimeout(fn, 200);
  p.textIdle = idle(() => {
    p.textIdle = 0;
    if (doc.closed || !p.visible || !p.frame || !p.frame.isConnected) return;
    const dr = doc.el.getBoundingClientRect(), pr = p.frame.getBoundingClientRect();
    const pad = dr.height * PDF_TEXT_NEAR_RATIO;
    if (pr.bottom < dr.top - pad || pr.top > dr.bottom + pad) return;   // 아직 멀다 → 다음 스크롤에 다시
    ensurePdfTextLinks(doc, p);
  });
}
// 스크롤이 멈출 때마다 화면 근처 페이지의 텍스트 레이어를 채운다(이미 있으면 즉시 반환).
function refreshVisibleText(doc){
  if (!doc || doc.closed || doc.kind !== "pdf" || !doc.pages) return;
  for (const p of doc.pages){ if (p.visible) schedulePdfTextLinks(doc, p); }
}
function releasePdfTextLinks(p){
  if (!p) return;
  if (p.textIdle){
    if (window.cancelIdleCallback) window.cancelIdleCallback(p.textIdle); else clearTimeout(p.textIdle);
    p.textIdle = 0;
  }
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
    doc.pages.forEach(p => { p.visible = true; requestPageRender(doc, p); schedulePdfTextLinks(doc, p); });   // 폴백: 전부 렌더
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries){
      const p = doc.pages.find(x => x.frame === en.target);
      if (!p) continue;
      p.visible = en.isIntersecting;                 // 줌 재렌더가 참고할 가시성 기록
      if (en.isIntersecting){ requestPageRender(doc, p); schedulePdfTextLinks(doc, p); }
      else { pdfRenderQueue(doc).pending.delete(p); releasePageCanvas(p); releasePdfTextLinks(p); }
    }
  }, { root: doc.el, rootMargin: pdfRenderProfile().rootMargin, threshold: 0 });
  doc.pages.forEach(p => io.observe(p.frame));
  doc.io = io;
  if (!doc.__qualityScrollHandler){
    let scheduled = false;
    doc.__qualityScrollHandler = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; refreshVisibleQuality(doc); refreshVisibleText(doc); if (doc.id === activeId) updatePdfPageIndicator(doc); if (doc.id === studyPdfId) updateStudyPageIndicator(); });
    };
    doc.el.addEventListener("scroll", doc.__qualityScrollHandler, { passive: true });
  }
  if (doc.id === activeId) updatePdfPageIndicator(doc);   // 페이지 수가 바뀌었을 수 있으니 총 페이지 갱신
}
