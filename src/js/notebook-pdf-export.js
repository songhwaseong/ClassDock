"use strict";

// 전체 높이·A4 한 쪽 높이·셀 시작점을 받아, 가능한 한 셀 사이에서 끊는 캡처 구간을 만든다.
// 브라우저 없는 단위 테스트에서도 검증할 수 있도록 DOM과 분리한 순수 함수다.
function notebookPdfSegments(totalHeight, pageHeight, cellTops){
  const total = Math.max(0, Math.round(Number(totalHeight) || 0));
  const page = Math.max(1, Math.round(Number(pageHeight) || 1));
  const breaks = Array.from(new Set((Array.isArray(cellTops) ? cellTops : [])
    .map(value => Math.round(Number(value) || 0))
    .filter(value => value > 1 && value < total)))
    .sort((a, b) => a - b);
  const segments = [];
  for (let cursor = 0; cursor < total; ){
    const limit = Math.min(total, cursor + page);
    if (limit >= total){ segments.push([cursor, total]); break; }
    let cut = -1;
    for (const boundary of breaks){
      if (boundary <= cursor + 8) continue;
      if (boundary > limit) break;
      cut = boundary;
    }
    if (cut < 0) cut = limit;
    segments.push([cursor, cut]);
    cursor = cut;
  }
  return segments;
}

// 여러 A4 구간을 한 번의 html2canvas 호출로 묶되, 캔버스 원시 메모리가 일정 수준을 넘지 않게 한다.
// 페이지마다 전체 DOM을 다시 분석하는 비용을 줄여 긴 노트북 내보내기를 크게 단축한다.
function notebookPdfBatches(segments, contentWidth, scale, maxPixels){
  const list = Array.isArray(segments) ? segments : [];
  const width = Math.max(1, Number(contentWidth) || 1);
  const ratio = Math.max(0.1, Number(scale) || 1);
  const limit = Math.max(1000000, Number(maxPixels) || 24000000);
  const batches = [];
  for (let index = 0; index < list.length; ){
    const first = index;
    const start = list[index][0];
    let end = index + 1;
    while (end < list.length){
      const height = Math.max(1, list[end][1] - start);
      const pixels = Math.ceil(width * ratio) * Math.ceil(height * ratio);
      if (pixels > limit) break;
      end++;
    }
    batches.push({ first, end, start, finish:list[end - 1][1] });
    index = end;
  }
  return batches;
}

function nbCanvasPngBytes(canvas){
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== "function"){
      reject(new Error("PNG 캔버스를 만들 수 없어요."));
      return;
    }
    canvas.toBlob(async (blob) => {
      if (!blob){ reject(new Error("PNG 이미지 변환에 실패했어요.")); return; }
      try { resolve(new Uint8Array(await blob.arrayBuffer())); }
      catch(error){ reject(error); }
    }, "image/png");
  });
}

function nbPdfBackgroundRgb(cssColor){
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return [1, 1, 1];
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillStyle = cssColor || "#ffffff";
  ctx.fillRect(0, 0, 1, 1);
  const pixel = ctx.getImageData(0, 0, 1, 1).data;
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
}

// 캡처 라이브러리(html-to-image)의 "소스 코드"를 구한다 — 지도 iframe 에 postMessage 로 전달해 안에서 eval.
// 오프라인 번들은 인라인 <script> 에서(맨 앞 배너로 식별), 개발용 페이지는 src 를 fetch 해서 얻는다.
let _nbCaptureLibPromise = null;
function nbMapCaptureLibSource(){
  if (_nbCaptureLibPromise) return _nbCaptureLibPromise;
  _nbCaptureLibPromise = (async () => {
    for (const s of Array.from(document.scripts)){
      const text = s.src ? "" : (s.textContent || "");
      if (text.length > 5000 && text.slice(0, 300).indexOf("html-to-image") >= 0) return text;
    }
    const src = Array.from(document.scripts).map(s => s.src).find(u => /html-to-image/i.test(u || ""));
    if (src){ try { const r = await fetch(src); if (r.ok) return await r.text(); } catch(_){} }
    return "";
  })();
  return _nbCaptureLibPromise;
}

// 지도 iframe 에 스냅샷을 부탁하고 PNG data URL 을 돌려받는다(시간 초과·취소·실패 시 빈 문자열).
// 마커 수천 개짜리 지도는 캡처에 수십 초가 걸릴 수 있어 기본 시간을 넉넉히 준다(실측: 2,799개 ≈ 18초).
let _nbMapShotSeq = 0;
function nbRequestMapSnapshot(frame, lib, timeoutMs, isCancelled){
  return new Promise((resolve) => {
    const id = "map-" + (++_nbMapShotSeq);
    let timer = 0, cancelTimer = 0;
    const finish = (value) => {
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      clearInterval(cancelTimer);
      resolve(value);
    };
    const onMsg = (ev) => {
      const d = ev.data || {};
      if (!d || d.type !== "nbv-map-snapshot-result" || d.id !== id) return;
      const url = typeof d.dataUrl === "string" ? d.dataUrl : "";
      finish(url.indexOf("data:image/") === 0 ? url : "");   // 이미지 data URL 만 신뢰(sandbox 응답 검증)
    };
    timer = setTimeout(() => finish(""), timeoutMs || 45000);
    if (typeof isCancelled === "function") cancelTimer = setInterval(() => { if (isCancelled()) finish(""); }, 500);
    window.addEventListener("message", onMsg);
    // 타일 프록시: 캡처의 타일 재요청(fetch)이 OSM 정책에 차단되지 않게 exe 서버가 대신 받아온다.
    // http(s)로 서빙될 때만(=exe) 전달 — file:// 등에서는 기존 방식대로 시도한다.
    const tileProxy = (location.protocol === "http:" || location.protocol === "https:")
      ? location.origin + "/tile-proxy?u=" : "";
    try { frame.contentWindow.postMessage({ type: "nbv-map-snapshot", id, lib, scale: 1.5, tileProxy }, "*"); }
    catch(_){ finish(""); }
  });
}

// loading=lazy 라 아직 로드 전인 iframe 은 eager 로 바꿔 로드를 기다린다(스냅샷 전 단계).
function nbEnsureFrameLoaded(frame, timeoutMs){
  if (frame.dataset.nbvFrameLoaded === "1") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(frame.dataset.nbvFrameLoaded === "1"), timeoutMs || 6000);
    frame.addEventListener("load", () => { clearTimeout(timer); resolve(true); }, { once: true });
    try { frame.loading = "eager"; } catch(_){}
  });
}

// PDF 캡처 전에 격리 iframe(지도·차트)을 정적 대체물로 바꿔 둔다 — 지도는 스냅샷 이미지,
// 실패하거나 스냅샷을 지원하지 않는 프레임은 안내 박스. 대체물은 nbv-capturing 중에만 보이고
// 원본 iframe 은 같은 규칙으로 숨겨져, 측정과 캡처 복제본의 페이지 경계가 일치한다.
// 반환한 목록은 내보내기 finally 에서 원상 복구한다.
async function nbSnapshotRichFrames(cells, progress, ownerDoc){
  const wraps = Array.from(cells.querySelectorAll(".nbv-out-rich-frame"));
  const swaps = [];
  if (!wraps.length) return swaps;
  const mapCount = wraps.filter(w => w.dataset.nbvMapFrame === "1").length;
  const lib = mapCount ? await nbMapCaptureLibSource() : "";
  // 화면 밖의 cross-origin iframe 은 브라우저가 렌더링(rAF)을 정지시켜 내부 캡처가 영영 끝나지 않는다.
  // 스냅샷 전에 각 지도를 화면 안으로 스크롤해 깨우고, 끝나면 원래 위치로 되돌린다(진행창 뒤라 안 보임).
  const findScroller = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement){
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  };
  const scroller = mapCount ? findScroller(cells) : null;
  const prevScrollTop = scroller ? scroller.scrollTop : 0;
  const isCancelled = () => !!(progress && progress.isCancelled());
  let done = 0;
  for (const wrap of wraps){
    if (isCancelled()) break;    // 취소 예외는 호출부가 던진다(복구는 finally 담당)
    const frame = wrap.querySelector("iframe.nbv-out-rich-frame-content");
    const isMap = wrap.dataset.nbvMapFrame === "1";
    const title = (frame && frame.title) || "인터랙티브 출력";
    let node = null;
    if (frame && isMap){
      done++;
      nbSetStatus(ownerDoc, "PDF 만드는 중… 지도 캡처 (" + done + "/" + mapCount + ")");
      if (progress) progress.update(done - 1, mapCount, "지도 캡처 중 (" + done + "/" + mapCount + ") — 지도가 크면 시간이 걸려요");
      try { wrap.scrollIntoView({ block: "center" }); } catch(_){}
      await new Promise(r => setTimeout(r, 400));   // 스크롤로 iframe 렌더링이 깨어날 여유
      const wasLoaded = frame.dataset.nbvFrameLoaded === "1";
      const loaded = wasLoaded || await nbEnsureFrameLoaded(frame, 6000);
      if (loaded && !wasLoaded) await new Promise(r => setTimeout(r, 1500));   // 갓 로드된 지도는 타일 로딩 여유
      const shot = loaded ? await nbRequestMapSnapshot(frame, lib, 45000, isCancelled) : "";
      if (shot){
        node = document.createElement("img");
        node.className = "nbv-pdf-shot nbv-pdf-map-shot";
        node.alt = title;
        node.src = shot;
      }
    }
    if (!node){
      node = document.createElement("div");
      node.className = "nbv-pdf-shot nbv-pdf-frame-note";
      node.textContent = (isMap ? "🗺 " : "📊 ") + title
        + " — 대화형 출력이라 이 PDF에는 담지 못했어요. 앱에서 노트북을 열어 확인하세요.";
    }
    wrap.insertAdjacentElement("afterend", node);
    wrap.classList.add("nbv-pdf-frame-hide");
    swaps.push({ wrap, node });
  }
  if (scroller) scroller.scrollTop = prevScrollTop;   // 스냅샷용 스크롤 원복
  return swaps;
}

// 요소부터 위로 올라가며 첫 불투명 배경색을 찾는다(캡처·PDF 여백 배경용 — 현재 테마 배경을 그대로 따른다).
function nbResolveBg(el){
  for (let node = el; node && node.nodeType === 1; node = node.parentElement){
    const c = getComputedStyle(node).backgroundColor;
    if (c && c !== "transparent" && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(c)) return c;
  }
  return null;
}

function nbPreparePdfClone(root){
  if (!root) return;
  // 화면 테마 그대로 캡처한다(라이트는 라이트, 다크는 다크) — 복제본이 앱의 data-theme 을 물려받으므로
  // 따로 바꾸지 않는다. 사용자가 보는 모습 그대로 저장된다.
  root.classList.add("nbv-capturing");
  root.querySelectorAll(".nbv-cell-collapsed").forEach(el => el.classList.remove("nbv-cell-collapsed"));
  root.querySelectorAll(".nbv-out-collapsed").forEach(el => el.classList.remove("nbv-out-collapsed"));
}

function nbCreatePdfProgress(){
  const overlay = document.createElement("div");
  overlay.className = "nbv-pdf-progress";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "nbv-pdf-progress-title");
  const card = document.createElement("div");
  card.className = "nbv-pdf-progress-card";
  const head = document.createElement("div");
  head.className = "nbv-pdf-progress-head";
  const spinner = document.createElement("div");
  spinner.className = "nbv-pdf-progress-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const title = document.createElement("div");
  title.id = "nbv-pdf-progress-title";
  title.className = "nbv-pdf-progress-title";
  title.textContent = "노트북 PDF 저장 중";
  head.append(spinner, title);
  const note = document.createElement("p");
  note.className = "nbv-pdf-progress-note";
  note.textContent = "고화질 변환은 페이지 수와 실행 결과에 따라 시간이 걸릴 수 있어요. 이 창을 닫지 마세요.";
  const meter = document.createElement("progress");
  meter.className = "nbv-pdf-progress-meter";
  meter.max = 1;
  meter.value = 0;
  const detail = document.createElement("div");
  detail.className = "nbv-pdf-progress-detail";
  detail.setAttribute("role", "status");
  detail.setAttribute("aria-live", "polite");
  detail.textContent = "페이지를 계산하고 있어요…";
  const actions = document.createElement("div");
  actions.className = "nbv-pdf-progress-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "nbv-pdf-progress-cancel";
  cancel.textContent = "저장 취소";
  actions.appendChild(cancel);
  card.append(head, note, meter, detail, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const startedAt = Date.now();
  let cancelled = false;
  let completed = 0;
  let total = 0;
  let phase = "페이지를 계산하고 있어요…";
  const render = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    meter.max = Math.max(1, total);
    meter.value = Math.min(completed, meter.max);
    detail.textContent = cancelled
      ? "현재 묶음 처리가 끝나면 취소합니다… · 경과 " + seconds + "초"
      : phase + (total ? " · " + completed + "/" + total + "쪽" : "") + " · 경과 " + seconds + "초";
  };
  const timer = setInterval(render, 1000);
  cancel.addEventListener("click", () => {
    if (cancelled) return;
    cancelled = true;
    cancel.disabled = true;
    cancel.textContent = "취소 요청됨";
    render();
  });
  render();
  return {
    update(done, count, message){
      completed = Math.max(0, Number(done) || 0);
      total = Math.max(0, Number(count) || 0);
      phase = message || phase;
      render();
    },
    isCancelled(){ return cancelled; },
    close(){ clearInterval(timer); overlay.remove(); }
  };
}

function nbPdfCancelError(){
  const error = new Error("PDF 저장을 취소했어요.");
  error.code = "notebook-pdf-cancelled";
  return error;
}

// requestAnimationFrame 안에서 Promise를 바로 끝내면 이어지는 무거운 작업이 같은 프레임의 paint를
// 다시 막을 수 있다. 다음 task로 넘겨 진행창이 실제 화면에 먼저 그려지도록 보장한다.
function nbWaitForPdfProgressPaint(){
  return new Promise(resolve => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

// 노트북 전체(코드+실행 출력)를 A4 세로 비율 구간별로 캡처해 고화질 이미지 PDF로 저장한다.
// 태블릿에서 실행 결과까지 그대로 넘겨보며 공부하도록.
//  · 필기·변수 패널·실행 시간·셀번호(실행칸)·툴 아이콘은 nbv-capturing 클래스로 숨겨 깔끔하게 담는다.
//  · 긴 코드·출력·접힌 셀은 캡처 복제본에서 펼치고, 선택 표시와 편집 입력 레이어는 숨긴다.
//  · 페이지 경계는 셀 시작점과 출력 블록 시작점에서만 끊어 차트·그림·지도가 중간에서
//    잘리지 않게 한다. 코드와 출력 사이에서도 끊을 수 있어 큰 출력이 딸린 셀이 통째로
//    다음 쪽으로 밀리며 생기던 빈 공간을 줄인다. (블록 하나가 한 쪽보다 크면 그때만 잘린다)
//  · 화면 테마 그대로 캡처한다(라이트는 라이트, 다크는 다크) — 사용자가 보는 모습대로 저장.
//  · 빈 셀(자리표시 문구만 있는 셀)은 담지 않는다 — '클릭해 편집' 안내가 인쇄물에 찍히지 않게.
//  · 노트북 전체를 거대한 캔버스 한 장으로 만들지 않고 2~3쪽 묶음을 2.5배(약 300dpi)로 렌더해
//    메모리를 제한하면서 페이지마다 DOM을 다시 분석하던 대기 시간도 줄인다.
async function nbExportImagePdf(ownerDoc){
  if (!ownerDoc) return;
  const cells = ownerDoc._nbCellsWrap;
  if (!cells || !cells.childElementCount){ nbSetStatus(ownerDoc, "내보낼 셀이 없어요."); return; }
  if (typeof html2canvas === "undefined"){ nbSetStatus(ownerDoc, "이미지 라이브러리를 불러오지 못했어요."); return; }
  if (typeof PDFLib === "undefined"){ nbSetStatus(ownerDoc, "PDF 라이브러리를 불러오지 못했어요."); return; }
  if (ownerDoc._nbPdfBusy) return;
  ownerDoc._nbPdfBusy = true;
  const pdfButton = ownerDoc._nbRoot && ownerDoc._nbRoot.querySelector(".nbv-export-pdf");
  if (pdfButton){ pdfButton.disabled = true; pdfButton.setAttribute("aria-busy", "true"); }
  const progress = nbCreatePdfProgress();
  nbSetStatus(ownerDoc, "PDF 만드는 중… 페이지 계산");

  const scale = 2.5;
  let bg = "#ffffff";
  let collapsedCells = [];
  let collapsedOutputs = [];
  let frameSwaps = [];
  try {
    // 진행창부터 paint한 뒤 큰 노트북 DOM 검색·폰트 대기·페이지 계산을 시작한다.
    await nbWaitForPdfProgressPaint();
    bg = nbResolveBg(cells) || "#ffffff";   // 여백·페이지 배경도 현재 테마 배경색을 따른다
    collapsedCells = Array.from(cells.querySelectorAll(".nbv-cell-collapsed"));
    collapsedOutputs = Array.from(cells.querySelectorAll(".nbv-out-collapsed"));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    if (progress.isCancelled()) throw nbPdfCancelError();

    // 격리 iframe(지도·차트)을 스냅샷 이미지/안내 박스로 바꿔 둔다 — 빈 공간 방지.
    frameSwaps = await nbSnapshotRichFrames(cells, progress, ownerDoc);
    if (progress.isCancelled()) throw nbPdfCancelError();

    // 빈 셀(자리표시 문구만 있는 셀)에 제외 마커를 단다. 측정(라이브 DOM)과 html2canvas 복제본이
    // 같은 nbv-capturing CSS 규칙으로 숨기므로 페이지 경계 계산과 캡처 결과가 어긋나지 않는다.
    Array.from(cells.querySelectorAll(":scope > .nbv-cell")).forEach(el => {
      const empty = !!el.querySelector(".nbv-md-empty") && !el.querySelector(".nbv-out");
      el.classList.toggle("nbv-pdf-skip", empty);
    });

    // ① PDF용 펼침 상태에서 셀 경계와 전체 높이를 잰다. 한 동기 작업 안에서 원상 복구하므로 화면에는 그려지지 않는다.
    collapsedCells.forEach(el => el.classList.remove("nbv-cell-collapsed"));
    collapsedOutputs.forEach(el => el.classList.remove("nbv-out-collapsed"));
    cells.classList.add("nbv-capturing");
    const bounds = cells.getBoundingClientRect();
    const contTop = bounds.top;
    const contentWidth = Math.max(1, Math.ceil(bounds.width));
    const contentHeight = Math.max(1, Math.ceil(bounds.height), Math.ceil(cells.scrollHeight));
    // 경계 후보: 셀 시작점 + 셀 안 출력 묶음(.nbv-out)·각 출력 블록의 시작점.
    // 코드와 출력 사이, 출력 블록 사이에서도 쪽을 끊을 수 있어, 큰 차트·지도가 딸린 셀이
    // 통째로 다음 쪽으로 밀리며 남기던 쪽 하단 빈 공간이 줄어든다.
    // 이미지·지도 중간은 여전히 안 자른다(블록 하나가 한 쪽보다 클 때만 예외).
    // height 0 블록(캡처 중 숨김: 실행시간·원본 iframe 등)은 경계에서 뺀다.
    const cellTops = [];
    Array.from(cells.querySelectorAll(":scope > .nbv-cell:not(.nbv-pdf-skip)")).forEach((cellEl) => {
      cellTops.push(cellEl.getBoundingClientRect().top - contTop);
      cellEl.querySelectorAll(".nbv-out, .nbv-out > *").forEach((block) => {
        const rect = block.getBoundingClientRect();
        if (rect.height > 1) cellTops.push(rect.top - contTop);
      });
    });
    cells.classList.remove("nbv-capturing");
    collapsedCells.forEach(el => el.classList.add("nbv-cell-collapsed"));
    collapsedOutputs.forEach(el => el.classList.add("nbv-out-collapsed"));

    // ② A4 세로 비율 한 페이지 높이. 이보다 커지기 직전의 셀 경계에서 페이지를 끊는다.
    const A4_W = 595.28, A4_H = 841.89;
    const pageCssHeight = Math.max(1, Math.round(contentWidth * (A4_H / A4_W)));
    const segs = notebookPdfSegments(contentHeight, pageCssHeight, cellTops);
    if (!segs.length) throw new Error("캡처할 페이지를 계산하지 못했어요.");
    const batches = notebookPdfBatches(segs, contentWidth, scale, 24000000);
    progress.update(0, segs.length, "고화질 캡처 준비 중");

    const { PDFDocument } = PDFLib;
    const pdf = await PDFDocument.create();
    const bgRgb = nbPdfBackgroundRgb(bg);

    // ③ 2~3쪽을 한 번에 렌더한 다음 쪽별 캔버스로 잘라 PDF에 넣는다.
    //    html2canvas의 전체 DOM 복제·분석 횟수가 페이지 수가 아니라 묶음 수만큼으로 줄어든다.
    let completedPages = 0;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++){
      if (progress.isCancelled()) throw nbPdfCancelError();
      const batch = batches[batchIndex];
      const batchHeight = Math.max(1, batch.finish - batch.start);
      const rangeText = (batch.first + 1) + (batch.end > batch.first + 1 ? "–" + batch.end : "");
      const captureMessage = rangeText + "쪽 고화질 캡처 중";
      nbSetStatus(ownerDoc, "PDF 만드는 중… " + captureMessage);
      progress.update(completedPages, segs.length, captureMessage);
      const batchShot = await html2canvas(cells, {
        backgroundColor: bg,
        scale,
        useCORS: true,
        logging: false,
        x: 0,
        y: batch.start,
        width: contentWidth,
        height: batchHeight,
        windowWidth: Math.max(document.documentElement.clientWidth, contentWidth),
        windowHeight: Math.max(document.documentElement.clientHeight, Math.min(contentHeight, batchHeight)),
        onclone: (doc, el) => nbPreparePdfClone(el)
      });
      if (!batchShot.width || !batchShot.height) throw new Error(rangeText + "쪽 캡처에 실패했어요.");
      if (progress.isCancelled()){
        batchShot.width = batchShot.height = 1;
        throw nbPdfCancelError();
      }
      const scaleY = batchShot.height / batchHeight;
      for (let p = batch.first; p < batch.end; p++){
        const segment = segs[p];
        const sourceY = Math.max(0, Math.round((segment[0] - batch.start) * scaleY));
        const sourceEnd = Math.min(batchShot.height, Math.round((segment[1] - batch.start) * scaleY));
        const sourceHeight = Math.max(1, sourceEnd - sourceY);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = batchShot.width;
        pageCanvas.height = sourceHeight;
        const pageContext = pageCanvas.getContext("2d");
        if (!pageContext) throw new Error((p + 1) + "쪽 캔버스를 만들지 못했어요.");
        pageContext.drawImage(batchShot, 0, sourceY, batchShot.width, sourceHeight, 0, 0, pageCanvas.width, pageCanvas.height);
        const pngBytes = await nbCanvasPngBytes(pageCanvas);
        const png = await pdf.embedPng(pngBytes);
        const page = pdf.addPage([A4_W, A4_H]);
        if (typeof PDFLib.rgb === "function"){
          page.drawRectangle({ x:0, y:0, width:A4_W, height:A4_H, color:PDFLib.rgb(bgRgb[0], bgRgb[1], bgRgb[2]) });
        }
        const imageHeight = Math.min(A4_H, A4_W * (pageCanvas.height / pageCanvas.width));
        page.drawImage(png, { x:0, y:A4_H - imageHeight, width:A4_W, height:imageHeight });
        pageCanvas.width = pageCanvas.height = 1;
        completedPages++;
        const encodeMessage = (p + 1) + "쪽 PDF에 넣는 중";
        nbSetStatus(ownerDoc, "PDF 만드는 중… " + completedPages + "/" + segs.length + " 쪽");
        progress.update(completedPages, segs.length, encodeMessage);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      batchShot.width = batchShot.height = 1;
    }
    if (progress.isCancelled()) throw nbPdfCancelError();
    progress.update(segs.length, segs.length, "PDF 파일 마무리 중");
    nbSetStatus(ownerDoc, "PDF 만드는 중… 파일 마무리");
    const bytes = await pdf.save();
    const name = String(ownerDoc.name || "notebook").replace(/\.ipynb$/i, "") + ".pdf";
    if (typeof downloadPdfBytes !== "function") throw new Error("PDF 다운로드 기능을 찾지 못했어요.");
    downloadPdfBytes(bytes, name);
    nbSetStatus(ownerDoc, name + " 로 고화질 저장했어요 · 전체 " + segs.length + "쪽");
  } catch(e){
    if (e && e.code === "notebook-pdf-cancelled"){
      nbSetStatus(ownerDoc, "PDF 저장을 취소했어요.");
    } else {
      console.error(e);
      nbSetStatus(ownerDoc, "PDF 저장 실패: " + ((e && e.message) || e));
    }
  } finally {
    cells.classList.remove("nbv-capturing");
    collapsedCells.forEach(el => el.classList.add("nbv-cell-collapsed"));
    collapsedOutputs.forEach(el => el.classList.add("nbv-out-collapsed"));
    frameSwaps.forEach(({ wrap, node }) => {
      try { node.remove(); wrap.classList.remove("nbv-pdf-frame-hide"); } catch(_){}
    });
    ownerDoc._nbPdfBusy = false;
    if (pdfButton){ pdfButton.disabled = false; pdfButton.removeAttribute("aria-busy"); }
    progress.close();
  }
}

