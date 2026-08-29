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
      applyStoredPdfPageMode(doc);   // 지난번에 고른 보기 방식(이어보기 / 한 장씩)으로 시작
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
  return doc;
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
  /* 한 장씩 보기에서는 현재 페이지 말고는 display:none 이라 교차 관찰이 아무것도 알려 주지
     못한다(감춘 것은 영원히 '안 보임'이다). 그 모드에서는 관찰을 걸지 않고 그릴 페이지를
     직접 고른다 — 아래 syncPdfSingleRender. */
  if (pdfIsSinglePage(doc)){
    syncPdfSingleRender(doc);
    if (doc.id === activeId) updatePdfPageIndicator(doc);
    return;
  }
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

/* ===== 보기 방식: 이어보기 ↔ 한 장씩 =====
   이어보기(기본)는 페이지를 세로로 쌓아 스크롤한다 — 여러 페이지에 걸친 글자 선택이나 훑어보기가
   쉽다. 한 장씩 보기는 현재 페이지만 남기고 나머지를 감춰 ◀ ▶ 로 넘긴다 — 수업 중 발표처럼
   "지금 이 쪽"만 보여 주고 싶을 때 쓴다. 어느 쪽이 편한지는 사람마다·상황마다 달라 골라 쓰게 하고,
   고른 값은 문서가 아니라 화면 환경설정으로 모든 PDF 가 이어 쓴다. */
const PDF_PAGE_MODE_KEY = "pdfPageMode";
const PDF_SINGLE_NEIGHBORS = 1;        // 앞뒤 한 장은 미리 그려 둔다 — 넘기자마자 보이도록

function pdfStoredPageMode(){
  try { return localStorage.getItem(PDF_PAGE_MODE_KEY) === "single" ? "single" : "flow"; }
  catch(_){ return "flow"; }
}
function pdfIsSinglePage(doc){
  return !!doc && doc.kind === "pdf" && doc.pageMode === "single" && !!(doc.pages && doc.pages.length);
}
/* 한 장씩 보기에서 지금 몇 쪽인지. 이어보기는 화면 한가운데에 가장 가까운 페이지로 판단하지만
   (currentPageIndex), 한 장씩 볼 때는 우리가 고른 쪽이 곧 답이다. */
function pdfSingleIndex(doc){
  const total = (doc && doc.pages && doc.pages.length) || 0;
  if (!total) return 0;
  return Math.max(0, Math.min(total - 1, doc.singleIndex || 0));
}

/* 현재 페이지와 그 이웃만 그리고 나머지는 캔버스를 돌려준다. 이어보기의 교차 관찰이 하던 일을
   여기서 대신한다 — 넘길 때마다, 그리고 확대·문서 전환 뒤에도 불린다. */
function syncPdfSingleRender(doc){
  if (!doc || !doc.pages) return;
  const cur = pdfSingleIndex(doc);
  doc.pages.forEach((p, i) => {
    if (!p.frame) return;
    const near = Math.abs(i - cur) <= PDF_SINGLE_NEIGHBORS;
    p.visible = (i === cur);            // 확대 재렌더(refreshVisibleQuality)가 보는 값
    if (near){
      requestPageRender(doc, p);
      if (i === cur) schedulePdfTextLinks(doc, p);
    } else {
      pdfRenderQueue(doc).pending.delete(p);
      releasePageCanvas(p);
      releasePdfTextLinks(p);
    }
  });
}

/* 한 장이 화면에 다 들어오는 배율. 페이지 크기는 가로 폭에만 맞춰 잡히므로(createPagePlaceholder)
   A4 는 세로가 화면보다 커서, 그대로 두면 한 장씩 넘겨도 그 안에서 또 스크롤해야 한다. */
function pdfFitPageZoom(doc){
  const p = doc && doc.pages && doc.pages[pdfSingleIndex(doc)];
  if (!p || !doc.el || !p.cssW || !p.cssH) return null;
  const availH = doc.el.clientHeight - 30;     // .page-frame 아래 여백(22) + 숨 쉴 틈
  const availW = doc.el.clientWidth - 24;
  if (availH <= 0 || availW <= 0) return null;
  const fit = Math.min(availH / p.cssH, availW / p.cssW);
  if (!Number.isFinite(fit) || fit <= 0) return null;
  /* 맞춤 배율을 반올림하면 최대 0.005만큼 커져 계산한 가용 폭·높이를 다시 넘을 수 있다.
     특히 분할 화면 경계에서는 그 몇 px 때문에 가로 스크롤바가 생기고 clientHeight가 줄어
     다음 ResizeObserver 맞춤은 더 작은 배율을 고른다. 스크롤바가 사라지면 다시 큰 배율로
     돌아가는 진동이 생기므로, 맞춤 계산만큼은 1% 단위로 내림해 가용 영역 안쪽에 둔다. */
  const safeFit = Math.floor((fit + 1e-9) * 100) / 100;
  return Math.max(0.3, Math.min(4, safeFit));
}

// 넘길 페이지를 고른다(0부터). 범위를 벗어난 값은 양 끝으로 눌러 담는다.
function showPdfSinglePage(doc, index){
  if (!pdfIsSinglePage(doc)) return;
  doc.singleIndex = Math.max(0, Math.min(doc.pages.length - 1, Math.round(Number(index) || 0)));
  const cur = doc.singleIndex;
  doc.pages.forEach((p, i) => { if (p.frame) p.frame.classList.toggle("is-current-page", i === cur); });
  doc.el.scrollTop = 0;                        // 새 쪽은 늘 맨 위에서 시작한다
  syncPdfSingleRender(doc);
  if (typeof updatePdfPageIndicator === "function") updatePdfPageIndicator(doc);
  updatePdfPageStepButtons();
  if (typeof refreshPdfSelHighlight === "function") refreshPdfSelHighlight();
}
function stepPdfSinglePage(doc, delta){
  if (!pdfIsSinglePage(doc)) return;
  showPdfSinglePage(doc, pdfSingleIndex(doc) + delta);
}

function setPdfPageMode(doc, mode, opts = {}){
  if (!doc || doc.kind !== "pdf" || !doc.el) return;
  const next = mode === "single" ? "single" : "flow";
  if (doc.pageMode === next && !opts.force) return;
  const wasIndex = typeof currentPageIndex === "function" ? currentPageIndex(doc) : 0;
  doc.pageMode = next;
  doc.el.classList.toggle("pdf-single-page", next === "single");
  if (next === "single"){
    doc.singleIndex = wasIndex;
    /* 들어올 때 한 번 페이지 맞춤으로 맞춰 준다. 그 뒤 사용자가 확대하면 그대로 두고, 이어보기로
       나갈 때 들어오기 전 배율로 되돌린다 — 넘겨 보려고 줄인 배율이 계속 남지 않게. */
    if (doc.zoomBeforeSingle == null) doc.zoomBeforeSingle = doc.zoom || 1;
    /* 아직 화면에 놓이지 않은 문서(여러 파일을 한꺼번에 열 때)는 칸 크기가 0 이라 맞출 수가
       없다 — 표시만 해 두고 처음 보일 때 맞춘다(pdfFitPageIfPending). */
    const fit = pdfFitPageZoom(doc);
    if (fit && typeof setPdfZoom === "function"){ setPdfZoom(fit, doc); doc.needsPageFit = false; }
    else doc.needsPageFit = true;
    showPdfSinglePage(doc, wasIndex);
  } else {
    doc.needsPageFit = false;
    doc.pages.forEach(p => { if (p.frame) p.frame.classList.remove("is-current-page"); });
    if (doc.zoomBeforeSingle != null && typeof setPdfZoom === "function"){
      setPdfZoom(doc.zoomBeforeSingle, doc);
      doc.zoomBeforeSingle = null;
    }
    startLazyRender(doc);
    if (typeof goToPdfPage === "function") goToPdfPage(doc, wasIndex + 1);
  }
  updatePdfPageModeButton(doc);
  updatePdfPageStepButtons();
}
function togglePdfPageMode(doc){
  doc = doc || (typeof fullscreenPdfTarget === "function" ? fullscreenPdfTarget() : null) || (typeof state !== "undefined" ? state : null);
  if (!doc || doc.kind !== "pdf") return;
  const next = pdfIsSinglePage(doc) ? "flow" : "single";
  setPdfPageMode(doc, next);
  try { localStorage.setItem(PDF_PAGE_MODE_KEY, next); } catch(_){}
  if (typeof toast === "function"){          // toast 가 스스로 번역한다(state.js)
    toast(next === "single"
      ? "한 장씩 보기 — ◀ ▶ 또는 PageUp·PageDown 으로 넘깁니다."
      : "이어보기 — 페이지를 스크롤해서 봅니다.", 2600);
  }
}
/* 알약의 보기 방식 단추가 부르는 문. 방식을 바꾸면 배율이 달라져 스크롤이 밀리므로, 보던 쪽을
   기억했다가 맞춘 배율에서 다시 그 쪽으로 돌려놓는다. 분할 참고 칸은 칸 크기에 맞추는 제 규칙이
   따로 있어(fitStudyPdf — 다른 문서에는 아무 일도 하지 않는다) 그것도 한 번 태운다. */
function switchPdfPageMode(doc){
  if (!doc || doc.kind !== "pdf") return;
  const at = typeof currentPageIndex === "function" ? currentPageIndex(doc) : 0;
  togglePdfPageMode(doc);
  if (typeof fitStudyPdf === "function") fitStudyPdf(doc);
  if (typeof goToPdfPage === "function") goToPdfPage(doc, at + 1);
  if (typeof showStudyControls === "function") showStudyControls();
  if (typeof showPdfControls === "function") showPdfControls();
}

/* 새로 연 PDF 는 지난번에 고른 보기 방식으로 시작한다(페이지를 다 만든 뒤에 부른다). */
function applyStoredPdfPageMode(doc){
  if (!doc || doc.kind !== "pdf" || !doc.pages || !doc.pages.length) return;
  if (pdfStoredPageMode() !== "single") return;
  setPdfPageMode(doc, "single", { force: true });
}

/* 크기가 0 이라 미뤄 둔 페이지 맞춤을, 문서가 실제로 화면에 놓인 뒤에 한 번 해 준다. */
function pdfFitPageIfPending(doc){
  if (!doc || !doc.needsPageFit || !pdfIsSinglePage(doc)) return;
  const fit = pdfFitPageZoom(doc);
  if (!fit || typeof setPdfZoom !== "function") return;
  doc.needsPageFit = false;
  setPdfZoom(fit, doc);
}

/* 넘기기·보기 방식 단추는 세 벌이 있다 — 문서 위 알약(작업 칸), 전체화면, 분할 참고 칸.
   저마다 제 칸의 문서를 비춰야 한다: 분할 작업에서 두 칸이 서로 다른 PDF 일 수 있고, 한쪽만
   한 장씩 보는 것도 당연하다. 한 벌이 남의 칸 문서를 비추면 단추가 거짓말을 하게 된다. */
function pdfStudyReference(){
  return typeof studyReferencePdf === "function" ? studyReferencePdf() : null;
}
function pdfViewTarget(){
  return typeof viewPdfTarget === "function" ? viewPdfTarget() : null;
}
function updatePdfPageModeButton(doc){
  const ref = pdfStudyReference();
  /* doc 은 아직 화면에 오르지 않은 문서(여러 파일을 한꺼번에 열 때)를 위한 보조 값이다.
     분할 중에는 어느 칸의 문서인지 알 수 없으므로 쓰지 않는다 — 칸을 잘못 비추느니 비운다. */
  const fallback = pdfViewTarget() || (ref ? null : (doc || null));
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  for (const [id, target] of [["btnPdfPageMode", fallback], ["btnStudyPageMode", ref || fallback]]){
    const button = typeof byId === "function" ? byId(id) : null;
    if (!button) continue;
    const single = pdfIsSinglePage(target);
    // 아이콘 두 벌은 HTML 에 함께 두고 CSS(.is-on)가 골라 보여 준다 — 여기서는 상태만 적는다.
    button.classList.toggle("is-on", single);
    button.setAttribute("aria-pressed", String(single));
    const title = _t(single ? "이어보기로 — 페이지를 스크롤해서 봅니다" : "한 장씩 보기 — 페이지를 한 장씩 넘겨 봅니다");
    button.title = title;
    button.setAttribute("aria-label", title);
  }
}
// ◀ ▶ 는 한 장씩 볼 때만 내놓고, 양 끝에서는 그쪽만 잠근다.
function updatePdfPageStepButtons(){
  const fsTarget = typeof fullscreenPdfTarget === "function" ? fullscreenPdfTarget() : null;
  const ref = pdfStudyReference();
  const view = pdfViewTarget();
  const pairs = [["pagePrev", "pageNext", view], ["fsPagePrev", "fsPageNext", fsTarget],
                 ["studyPagePrev", "studyPageNext", ref || view]];
  for (const [prevId, nextId, target] of pairs){
    const single = pdfIsSinglePage(target);
    const index = single ? pdfSingleIndex(target) : 0;
    const last = single ? target.pages.length - 1 : 0;
    const prev = typeof byId === "function" ? byId(prevId) : null;
    const next = typeof byId === "function" ? byId(nextId) : null;
    if (prev){ prev.hidden = !single; prev.disabled = index <= 0; }
    if (next){ next.hidden = !single; next.disabled = index >= last; }
  }
}
