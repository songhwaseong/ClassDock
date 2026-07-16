"use strict";

/* ===== 독립 화이트보드(설명용 칠판) =====
   새 문서 종류 "board". 벡터 모델(items)로 그려 undo/redo·리사이즈에 안전하고,
   PNG/PDF 로 내보낸다. 새 라이브러리 없이 캔버스만 사용. */

let _boardCount = 0;
const BOARD_RECOVERY_PREFIX = "manneung-board-recovery:";
function boardRecoveryKey(name){ return BOARD_RECOVERY_PREFIX + String(name || "화이트보드"); }
function readBoardRecovery(name){
  try {
    const saved = JSON.parse(localStorage.getItem(boardRecoveryKey(name)) || "null");
    if (!saved || saved.version !== 1 || !Array.isArray(saved.items)) return null;
    return { tool:"pen", color:"#111111", width:4, bg:saved.bg || "#ffffff", items:saved.items, selected:null };
  } catch(_){ return null; }
}
function newWhiteboard(){
  _boardCount++;
  const name = _boardCount > 1 ? ("화이트보드 " + _boardCount) : "화이트보드";
  const doc = makeDoc("board", name, {});
  const recovered = readBoardRecovery(name);
  if (recovered && recovered.items.length){
    doc.boardState = recovered;
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc);
    else doc.hasUnsavedEdits = true;
  }
  doc.render = async () => { const host = doc.el; host.innerHTML = ""; host.scrollTop = 0; renderWhiteboard(doc, host); };
  if (typeof refreshChrome === "function") refreshChrome();
  activateIfIdle(doc, {});
  return doc;
}

function renderWhiteboard(doc, host){
  host.classList.add("wb-doc");
  const wrap = document.createElement("div"); wrap.className = "wb-wrap";
  const tools = document.createElement("div"); tools.className = "wb-tools";
  const stage = document.createElement("div"); stage.className = "wb-stage";
  const canvas = document.createElement("canvas"); canvas.className = "wb-canvas";
  stage.appendChild(canvas);
  wrap.append(tools, stage); host.appendChild(wrap);

  const ctx = canvas.getContext("2d");
  let dpr = 1, W = 0, H = 0;
  // wb: 보드 상태(전역 active 문서 변수 state 와 헷갈리지 않게 이름 분리)
  // 탭을 다시 그려도 판서 모델을 문서에 붙여 유지한다. 저장 전 변경은 공통
  // 문서 상태에 전달돼 탭 닫기·새로고침 때도 놓치지 않는다.
  const wb = doc.boardState || (doc.boardState = { tool: "pen", color: "#111111", width: 4, items: [], bg: "#ffffff", selected: null });
  let boardRecoveryTimer = 0;
  const saveBoardRecoveryNow = () => {
    clearTimeout(boardRecoveryTimer); boardRecoveryTimer = 0;
    try {
      const items = wb.items.map(item => {
        const copy = { ...item };
        if (copy.type === "image"){ copy.src = copy.src || (copy.img && (copy.img.__boardSrc || copy.img.src)) || ""; delete copy.img; }
        return copy;
      });
      localStorage.setItem(boardRecoveryKey(doc.name), JSON.stringify({ version:1, bg:wb.bg, items }));
    } catch(error){ console.warn("whiteboard recovery snapshot skipped:", error); }
  };
  // 탭 닫기·브라우저 종료 직전엔 0.5초 디바운스를 건너뛰고 마지막 획까지 즉시 저장한다.
  doc.flushBoardRecovery = saveBoardRecoveryNow;
  const scheduleBoardRecovery = () => {
    clearTimeout(boardRecoveryTimer);
    boardRecoveryTimer = setTimeout(saveBoardRecoveryNow, 500);
  };

  // ----- 모델 → 캔버스 (그리기는 board-render.js 공용 함수 사용 → 리플레이 재생과 화면이 일치) -----
  const {
    applyStroke: applyBoardStroke,
    drawItem: drawBoardItem,
    itemBounds: boardItemBounds,
    hitTestItem: hitTestBoardItem,
    translateItem: translateBoardItem
  } = MNBoardRenderer;
  const applyStroke = (it) => applyBoardStroke(ctx, it, wb.bg);
  const drawItem = (it) => drawBoardItem(ctx, it, wb.bg);
  const measureBoardText = (line, fontSize) => {
    ctx.save(); ctx.font = fontSize + 'px system-ui,"Malgun Gothic",sans-serif';
    const width = ctx.measureText(String(line || "")).width; ctx.restore(); return width;
  };
  const boundsOf = (it) => boardItemBounds(it, measureBoardText);
  // 수업 리플레이: 녹화 중이면 커밋(획/도형/텍스트/이미지/지우기/되돌리기)마다 스냅샷을 남긴다.
  const recordCommit = () => {
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc);
    scheduleBoardRecovery();
    if (doc.recorder && doc.recorder.active){ try { doc.recorder.capture(wb.items, wb.bg, { W, H }); } catch(_){} }
  };
  const HANDLE = 12;                                  // 크기조절 핸들 한 변 크기(클릭 판정에도 사용)
  // 8방향 핸들: hx/hy ∈ {0=왼/위, 0.5=가운데, 1=오른/아래}. 가운데(0.5,0.5) 제외.
  const HANDLES = [
    { hx:0,   hy:0,   cur:"nwse-resize" }, { hx:0.5, hy:0,   cur:"ns-resize" }, { hx:1, hy:0,   cur:"nesw-resize" },
    { hx:0,   hy:0.5, cur:"ew-resize" },                                        { hx:1, hy:0.5, cur:"ew-resize" },
    { hx:0,   hy:1,   cur:"nesw-resize" }, { hx:0.5, hy:1,   cur:"ns-resize" }, { hx:1, hy:1,   cur:"nwse-resize" }
  ];
  const handlePos = (it, h) => ({ x: it.x + it.w * h.hx, y: it.y + it.h * h.hy });
  const handleAt = (it, p) => {
    if (!it || it.type !== "image") return null;
    for (const h of HANDLES){ const hp = handlePos(it, h); if (Math.abs(p.x - hp.x) <= HANDLE && Math.abs(p.y - hp.y) <= HANDLE) return h; }
    return null;
  };
  let editingTextItem = null;
  const redraw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.fillStyle = wb.bg; ctx.fillRect(0, 0, W, H);
    for (const it of wb.items) if (it !== editingTextItem) drawItem(it);
    const s = wb.selected;                            // 선택 표시(점선 테두리, 이미지는 8핸들). 내보낼 땐 잠시 해제하므로 안 박힘.
    const sb = s && boundsOf(s);
    if (s && sb){
      ctx.save(); ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = "#2563eb";
      const pad = s.type === "image" ? 0 : 4;
      ctx.setLineDash([6, 4]); ctx.strokeRect(sb.x - pad, sb.y - pad, Math.max(1, sb.w) + pad * 2, Math.max(1, sb.h) + pad * 2); ctx.setLineDash([]);
      if (s.type === "image"){
        ctx.fillStyle = "#fff";
        for (const h of HANDLES){ const hp = handlePos(s, h); ctx.fillRect(hp.x - HANDLE / 2, hp.y - HANDLE / 2, HANDLE, HANDLE); ctx.strokeRect(hp.x - HANDLE / 2, hp.y - HANDLE / 2, HANDLE, HANDLE); }
      }
      ctx.restore();
    }
  };
  const restoreBoardImages = () => {
    for (const item of wb.items){
      if (!item || item.type !== "image" || item.img || !item.src) continue;
      const img = new Image();
      img.onload = () => { item.img = img; img.__boardSrc = item.src; redraw(); };
      img.onerror = () => { console.warn("whiteboard recovery image skipped"); };
      img.src = item.src;
    }
  };
  // 스냅샷은 항목 배열의 얕은 복사 — 항목 객체 자체를 제자리에서 고치면 이전 단계가 망가지므로
  // 기존 항목을 바꿀 때는 사본으로 교체한다(beginSelDrag 참고).
  const history = MNEditHistory.create({
    limit: MNEditHistory.LIMITS.board,
    capture: () => wb.items.slice(),
    apply: (items) => { wb.items = items.slice(); wb.selected = null; redraw(); },
    // 항목은 통째로 교체만 하고 제자리에서 고치지 않으므로 참조 비교로 충분하다.
    isEqual: (a, b) => a.length === b.length && a.every((it, i) => it === b[i]),
    onChange: () => updateUndoButtons(),
  });
  const doUndo = () => { if (history.undo()) recordCommit(); };
  const doRedo = () => { if (history.redo()) recordCommit(); };
  const clearAll = () => { if (!wb.items.length) return; wb.items = []; wb.selected = null; redraw(); history.commit(); recordCommit(); };

  // ----- 사이즈/DPR (리사이즈해도 좌표는 CSS px 그대로라 그림 위치 유지) -----
  const resize = () => {
    const r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    redraw();
  };

  // ----- 포인터 그리기 -----
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  // 선택 도구: 이미지·도형·텍스트 중 위에 그려진 항목부터 히트테스트
  const itemAt = (p) => {
    for (let i = wb.items.length - 1; i >= 0; i--){ const it = wb.items[i]; if (hitTestBoardItem(it, p, measureBoardText, 7)) return it; }
    return null;
  };
  const beginSelDrag = (e, mode, handle) => {
    canvas.setPointerCapture(e.pointerId);
    const it = wb.selected; const start = pt(e);
    const o = it.type === "image" ? { left: it.x, top: it.y, right: it.x + it.w, bottom: it.y + it.h } : null;
    const idx = wb.items.indexOf(it);
    let live = it, cloned = false;
    const move = (ev) => {
      const q = pt(ev);
      if (mode === "move"){
        live = translateBoardItem(it, q.x - start.x, q.y - start.y);
        wb.items[idx] = live; wb.selected = live; cloned = true;
      } else {                                          // 핸들이 잡은 변/모서리만 이동(반대편 고정), 가로·세로 독립
        // 이전 단계 스냅샷이 이 항목 객체를 함께 가리키므로, 제자리에서 고치지 않고 사본으로 바꿔 끼운다.
        if (!cloned){ live = Object.assign({}, it); wb.items[idx] = live; wb.selected = live; cloned = true; }
        if (handle.hx === 0){ const nx = Math.min(q.x, o.right - 24); live.x = nx; live.w = o.right - nx; }
        else if (handle.hx === 1){ live.x = o.left; live.w = Math.max(24, q.x - o.left); }
        if (handle.hy === 0){ const ny = Math.min(q.y, o.bottom - 16); live.y = ny; live.h = o.bottom - ny; }
        else if (handle.hy === 1){ live.y = o.top; live.h = Math.max(16, q.y - o.top); }
      }
      redraw();
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      redraw(); if (cloned){ history.commit(); recordCommit(); }   // 드래그 한 번을 한 단계로
    };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  };
  const startSelect = (e) => {
    const p = pt(e);
    const h = wb.selected && handleAt(wb.selected, p);
    if (h){ beginSelDrag(e, "resize", h); return; }                                       // 핸들 → 그 방향으로 크기조절
    const item = itemAt(p);
    wb.selected = item || null; redraw();
    if (item) beginSelDrag(e, "move");                                                    // 항목 본체 → 이동
  };
  let cur = null, drawing = false, lastPt = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (wb.tool === "select"){ startSelect(e); return; }
    if (wb.tool === "text"){ e.preventDefault(); startText(pt(e)); return; }
    canvas.setPointerCapture(e.pointerId); drawing = true;
    const p = pt(e);
    if (wb.tool === "pen" || wb.tool === "highlighter" || wb.tool === "eraser"){
      const w = wb.tool === "eraser" ? Math.max(16, wb.width * 5) : (wb.tool === "highlighter" ? wb.width * 3 : wb.width);
      cur = { type: wb.tool, color: wb.color, width: w, points: [p] };
    } else {
      cur = { type: wb.tool, color: wb.color, width: wb.width, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    }
    lastPt = p;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing || !cur) return;
    const p = pt(e);
    if (cur.points){
      cur.points.push(p);
      applyStroke(cur); ctx.beginPath(); ctx.moveTo(lastPt.x, lastPt.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.globalAlpha = 1;
      lastPt = p;
    } else {
      cur.x2 = p.x; cur.y2 = p.y; redraw(); drawItem(cur);
    }
  });
  const finishStroke = () => {
    if (!drawing){ return; }
    drawing = false;
    if (!cur){ return; }
    if (!cur.points && Math.abs(cur.x2 - cur.x1) < 2 && Math.abs(cur.y2 - cur.y1) < 2){ cur = null; redraw(); return; }  // 점 찍힌 도형 무시
    wb.items.push(cur); cur = null; redraw(); history.commit(); recordCommit();
  };
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);
  // 선택 도구 호버 커서: 선택 가능한 항목 위=이동, 이미지 핸들=크기조절
  canvas.addEventListener("pointermove", (e) => {
    if (wb.tool !== "select" || drawing) return;
    const p = pt(e);
    const h = wb.selected && handleAt(wb.selected, p);
    canvas.style.cursor = h ? h.cur : (itemAt(p) ? "move" : "default");
  });
  canvas.addEventListener("dblclick", (e) => {
    if (wb.tool !== "select") return;
    const item = itemAt(pt(e));
    if (!item || item.type !== "text") return;
    e.preventDefault(); e.stopPropagation(); startText({ x:item.x, y:item.y }, item);
  });

  // ----- 텍스트 도구: 클릭 위치에 인라인 입력 -----
  function startText(p, existing){
    const ta = document.createElement("textarea"); ta.className = "wb-textinput"; ta.rows = 1;
    const fs = existing ? Math.max(14, Number(existing.fontSize) || 16) : Math.max(14, wb.width * 4);
    const color = existing ? existing.color : wb.color;
    ta.style.left = p.x + "px"; ta.style.top = p.y + "px"; ta.style.color = color; ta.style.fontSize = fs + "px";
    ta.placeholder = "텍스트 입력";
    if (existing){
      ta.value = String(existing.text || "");
      const b = boundsOf(existing);
      if (b){ ta.style.width = Math.max(120, b.w + 16) + "px"; ta.style.height = Math.max(fs * 1.5, b.h + 8) + "px"; }
      editingTextItem = existing; wb.selected = null; redraw();
    }
    stage.appendChild(ta);
    // pointerdown 중 만든 입력창은 같은 클릭의 기본 포커스 처리로 즉시 blur 될 수 있어 다음 프레임에 포커스한다.
    requestAnimationFrame(() => {
      if (!ta.isConnected) return;
      ta.focus({ preventScroll:true });
      if (existing) ta.select();
    });
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const txt = ta.value; ta.remove();
      editingTextItem = null;
      if (existing){
        const idx = wb.items.indexOf(existing);
        if (idx < 0){ redraw(); return; }
        if (txt.trim()){
          const item = Object.assign({}, existing, { text:txt });
          wb.items[idx] = item; wb.selected = item;
        } else {
          wb.items.splice(idx, 1); wb.selected = null;
        }
        redraw(); history.commit(); recordCommit(); return;
      }
      if (txt.trim()){
        const item = { type: "text", color: wb.color, x: p.x, y: p.y, text: txt, fontSize: fs };
        wb.items.push(item); wb.selected = item; setTool("select"); redraw(); history.commit(); recordCommit();
      }
    };
    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape"){
        e.preventDefault(); done = true; ta.remove(); editingTextItem = null;
        if (existing) wb.selected = existing; redraw();
      }
      else if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); ta.blur(); }
      e.stopPropagation();
    });
  }

  // ----- 이미지 넣기(캡처 붙여넣기·드래그드롭·파일선택) -----
  const imageUrls = [];                              // 이전 버전 object URL 정리 호환용(새 삽입은 복구 가능한 data URL 사용)
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("image-read-failed"));
    reader.readAsDataURL(blob);
  });
  const loadImageBlob = async (blob) => {
    const src = await blobToDataUrl(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { img.__boardSrc = src; resolve(img); };
      img.onerror = () => reject(new Error("image-load-failed"));
      img.src = src;
    });
  };
  // (cx,cy) 중심으로 스테이지에 맞춰 축소 배치. cx/cy 없으면 화면 중앙.
  const placeImage = (img, cx, cy) => {
    const maxW = W * 0.85, maxH = H * 0.85;
    let w = img.naturalWidth || 300, h = img.naturalHeight || 200;
    const sc = Math.min(1, maxW / w, maxH / h); w = Math.round(w * sc); h = Math.round(h * sc);
    const ccx = (cx == null) ? W / 2 : cx, ccy = (cy == null) ? H / 2 : cy;
    let x = Math.round(ccx - w / 2), y = Math.round(ccy - h / 2);
    x = Math.max(0, Math.min(x, Math.max(0, W - w))); y = Math.max(0, Math.min(y, Math.max(0, H - h)));
    const it = { type: "image", img, src:img.__boardSrc || img.src || "", x, y, w, h };
    wb.items.push(it);
    wb.selected = it; setTool("select");              // 넣자마자 선택 상태 + 선택 도구 → 바로 드래그로 위치·크기 조절
    redraw(); history.commit(); recordCommit();
  };
  const insertImageBlob = (blob, cx, cy) => {
    if (!blob || !/^image\//.test(blob.type)){ return false; }
    loadImageBlob(blob).then(img => placeImage(img, cx, cy)).catch(() => { if (typeof toast === "function") toast("이미지를 넣지 못했어요.", 2000); });
    return true;
  };
  // 붙여넣기(Ctrl+V): 이 보드가 활성이고 텍스트 입력 중이 아닐 때 클립보드 이미지를 넣는다.
  const onPaste = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("wb-textinput")) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items){
      if (it.kind === "file" && /^image\//.test(it.type)){
        const blob = it.getAsFile();
        if (blob){ e.preventDefault(); insertImageBlob(blob); return; }
      }
    }
  };
  document.addEventListener("paste", onPaste);
  // 드래그&드롭: 캡처/이미지 파일을 보드에 떨구면 그 위치에 넣는다.
  stage.addEventListener("dragover", (e) => { if (e.dataTransfer && [...(e.dataTransfer.items || [])].some(i => i.kind === "file")){ e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  stage.addEventListener("drop", (e) => {
    const files = (e.dataTransfer && e.dataTransfer.files) || [];
    const imgFile = [...files].find(f => /^image\//.test(f.type));
    if (imgFile){ e.preventDefault(); e.stopPropagation(); const p = pt(e); insertImageBlob(imgFile, p.x, p.y); }
  });

  // 내보내기 전 선택 표시(점선·핸들)를 잠깐 지워 PNG/PDF 에 안 박히게 한다.
  const withoutSelection = (fn) => { const sel = wb.selected; if (sel){ wb.selected = null; redraw(); } try { return fn(); } finally { if (sel){ wb.selected = sel; } } };

  // ----- 내보내기 -----
  const exportPng = () => {
    const sel = wb.selected; if (sel){ wb.selected = null; redraw(); }
    canvas.toBlob((b) => {
      if (sel){ wb.selected = sel; redraw(); }
      if (!b){ if (typeof toast === "function") toast("이미지를 저장하지 못했어요.", 2000, { type: "error" }); return; }
      const u = URL.createObjectURL(b); const a = document.createElement("a");
      a.href = u; a.download = (doc.name || "화이트보드") + ".png";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
    }, "image/png");
  };
  const exportPdf = async () => {
    if (typeof PDFLib === "undefined"){ if (typeof toast === "function") toast("PDF 라이브러리를 불러오지 못했어요.", 2200); return; }
    try {
      const png = withoutSelection(() => canvas.toDataURL("image/png"));
      if (wb.selected) redraw();
      const { PDFDocument } = PDFLib;
      const pdf = await PDFDocument.create();
      const img = await pdf.embedPng(png);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      const bytes = await pdf.save();
      if (typeof downloadPdfBytes === "function") downloadPdfBytes(bytes, (doc.name || "화이트보드") + ".pdf");
    } catch(e){ console.error(e); if (typeof toast === "function") toast("PDF로 저장하지 못했어요.", 2200, { type: "error" }); }
  };

  // ----- 도구막대 -----
  const COLORS = [
    ["#111111", "검정"], ["#e11d48", "빨강"], ["#2563eb", "파랑"], ["#16a34a", "초록"],
    ["#f59e0b", "주황"], ["#7c3aed", "보라"], ["#ffffff", "흰색"]
  ];
  const WB_ICONS = {
    select: '<path d="M5 3l12 9-6.2 1.2L8 19.5z"/><path d="m11 13 4.5 6.5"/>',
    pen: '<path d="m4 20 4.4-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.4 16z"/><path d="m14.7 6.7 3 3M5.4 16l3 3"/>',
    highlighter: '<path d="m7 14 7.8-7.8 3 3L10 17z"/><path d="m13.3 7.7 3 3M7 14l3 3M4 20h12"/>',
    eraser: '<path d="m4.7 14.3 8.6-8.6a2.4 2.4 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4L9 20H6.4l-3.1-3.1a1.8 1.8 0 0 1 0-2.6z"/><path d="m10.5 8.5 5 5M9 20h11"/>',
    line: '<path d="M5 19 19 5"/>',
    arrow: '<path d="M5 19 19 5M11 5h8v8"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    text: '<path d="M5 5h14M12 5v14M8 19h8"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5.5 17 4.5-4 3 2.5 2.5-2 3 3.5"/>',
    undo: '<path d="M9 7 5 11l4 4"/><path d="M5 11h8a6 6 0 0 1 6 6"/>',
    redo: '<path d="m15 7 4 4-4 4"/><path d="M19 11h-8a6 6 0 0 0-6 6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'
  };
  const TOOLS = [
    ["select", "select", "선택·이동 (이미지 옮기기·크기조절)"],
    ["pen", "pen", "펜"], ["highlighter", "highlighter", "형광펜"], ["eraser", "eraser", "지우개"],
    ["line", "line", "직선"], ["arrow", "arrow", "화살표"], ["rect", "rect", "사각형"], ["ellipse", "ellipse", "원"], ["text", "text", "텍스트"]
  ];
  const toolBtns = {};
  const swatchEls = {};
  const widthBtns = {};
  let undoBtn, redoBtn;
  const setTool = (t) => {
    wb.tool = t; for (const k in toolBtns) toolBtns[k].classList.toggle("active", k === t);
    if (t !== "select" && wb.selected){ wb.selected = null; redraw(); }   // 다른 도구로 가면 선택 해제
    canvas.style.cursor = "";
    canvas.dataset.tool = t;
  };
  const setColor = (c) => { wb.color = c; for (const k in swatchEls) swatchEls[k].classList.toggle("active", k === c); customColor.value = c; };
  const setWidth = (w) => { wb.width = w; for (const k in widthBtns) widthBtns[k].classList.toggle("active", Number(k) === w); };
  const updateUndoButtons = () => { if (undoBtn) undoBtn.disabled = !history.canUndo(); if (redoBtn) redoBtn.disabled = !history.canRedo(); };

  const mkBtn = (label, title, cls, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", fn); return b;
  };
  const mkIcon = (name) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "wb-icon"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.8"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = WB_ICONS[name] || "";
    return svg;
  };
  const mkIconBtn = (icon, title, cls, fn) => {
    const b = mkBtn("", title, cls, fn);
    b.appendChild(mkIcon(icon));
    return b;
  };
  const grp = () => { const g = document.createElement("span"); g.className = "wb-group"; return g; };

  const toolGroup = grp();
  TOOLS.forEach(([t, icon, title]) => { const b = mkIconBtn(icon, title, "wb-tool", () => setTool(t)); toolBtns[t] = b; toolGroup.appendChild(b); });

  const colorGroup = grp();
  COLORS.forEach(([c, name]) => {
    const s = document.createElement("button"); s.type = "button"; s.className = "wb-swatch"; s.title = name; s.setAttribute("aria-label", name); s.style.background = c;
    if (c === "#ffffff") s.style.border = "1px solid #cbd5e1";
    s.addEventListener("click", () => setColor(c)); swatchEls[c] = s; colorGroup.appendChild(s);
  });
  const customColor = document.createElement("input"); customColor.type = "color"; customColor.className = "wb-color-input"; customColor.value = wb.color; customColor.title = "색 직접 고르기";
  customColor.addEventListener("input", () => setColor(customColor.value));
  colorGroup.appendChild(customColor);

  const widthGroup = grp();
  [["2", "S", 2], ["4", "M", 4], ["8", "L", 8]].forEach(([k, label, w]) => { const b = mkBtn(label, "굵기 " + label, "wb-width", () => setWidth(w)); widthBtns[k] = b; widthGroup.appendChild(b); });

  const imgGroup = grp();
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.hidden = true;
  fileInput.addEventListener("change", () => { const f = fileInput.files && fileInput.files[0]; if (f) insertImageBlob(f); fileInput.value = ""; });
  imgGroup.append(mkIconBtn("image", "이미지 넣기 — 파일 선택 (또는 Ctrl+V 붙여넣기·드래그드롭)", "wb-act", () => fileInput.click()), fileInput);

  const actGroup = grp();
  undoBtn = mkIconBtn("undo", "되돌리기 (Ctrl+Z)", "wb-act", doUndo);
  redoBtn = mkIconBtn("redo", "다시 실행 (Ctrl+Y)", "wb-act", doRedo);
  const clearBtn = mkIconBtn("trash", "보드 전체 지우기", "wb-act wb-clear", () => {
    if (!wb.items.length) return;
    if (typeof confirmDialog === "function"){ confirmDialog("보드 내용을 모두 지울까요?", "지우기", "취소").then(ok => { if (ok) clearAll(); }); }
    else clearAll();
  });
  actGroup.append(undoBtn, redoBtn, clearBtn);

  const exportGroup = grp();
  exportGroup.append(mkBtn("PNG", "PNG 이미지로 저장", "wb-act", exportPng), mkBtn("PDF", "PDF로 저장", "wb-act", exportPdf));

  // ----- 수업 리플레이 녹화 -----
  // ● 녹화 → 판서를 시간순으로 기록, ■ 정지 → 리플레이(되감아 보기) 화면을 만든다.
  const recGroup = grp();
  const recBtn = mkBtn("● 녹화", "수업 리플레이 녹화 — 판서 과정을 시간순으로 기록해 되감아 볼 수 있어요", "wb-act wb-rec", () => toggleRecord());
  recGroup.appendChild(recBtn);
  function toggleRecord(){
    if (typeof LessonRecorder !== "function"){ if (typeof toast === "function") toast("리플레이 기능을 불러오지 못했어요.", 2400); return; }
    if (doc.recorder && doc.recorder.active){
      const lesson = doc.recorder.stop(wb.items, wb.bg, { W, H });
      doc.recorder = null;
      recBtn.classList.remove("recording"); recBtn.textContent = "● 녹화";
      recBtn.title = "수업 리플레이 녹화 — 판서 과정을 시간순으로 기록해 되감아 볼 수 있어요";
      if (lesson && lesson.keyframes.length > 1 && typeof finishLessonRecording === "function") finishLessonRecording(lesson, doc.name);
      else if (typeof toast === "function") toast("녹화된 판서가 없어요.", 2000);
    } else {
      doc.recorder = LessonRecorder(wb.items, wb.bg, { W, H });
      recBtn.classList.add("recording"); recBtn.textContent = "■ 정지";
      recBtn.title = "녹화 정지 — 지금까지 판서를 리플레이로 만들기";
      if (typeof toast === "function") toast("녹화를 시작했어요. 판서한 뒤 ■ 정지를 누르면 리플레이가 만들어져요.", 3000);
    }
  }

  // 도구막대 위치(상/우/하/좌) — ⋮⋮ 핸들을 끌면 마우스에서 가장 가까운 변에 자동 도킹.
  const POS_SEQ = ["top", "right", "bottom", "left"];
  const readPos = () => { try { const v = localStorage.getItem("wbToolbarPos"); return POS_SEQ.includes(v) ? v : "top"; } catch(_){ return "top"; } };
  let curPos = readPos();
  const applyPos = (p) => { POS_SEQ.forEach(x => wrap.classList.toggle("tb-pos-" + x, x === p)); };
  const savePos = (p) => { try { localStorage.setItem("wbToolbarPos", p); } catch(_){} };
  const dragHandle = document.createElement("span");
  dragHandle.className = "wb-drag"; dragHandle.title = "끌어서 도구막대 위치 바꾸기 — 상/하 가로, 좌/우 세로";
  dragHandle.textContent = "⋮⋮";
  let wbDragging = false;
  dragHandle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); dragHandle.setPointerCapture(e.pointerId); wbDragging = true;
  });
  dragHandle.addEventListener("pointermove", (e) => {
    if (!wbDragging) return;
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    // 4변 중 가장 가까운 쪽으로 라이브 도킹
    const cand = [
      { p: "top",    v: y },
      { p: "bottom", v: r.height - y },
      { p: "left",   v: x },
      { p: "right",  v: r.width - x }
    ].sort((a, b) => a.v - b.v)[0];
    if (cand.p !== curPos){ curPos = cand.p; applyPos(curPos); }
  });
  const endWbDrag = (e) => {
    if (!wbDragging) return;
    wbDragging = false;
    try { dragHandle.releasePointerCapture(e.pointerId); } catch(_){}
    savePos(curPos);
  };
  dragHandle.addEventListener("pointerup", endWbDrag);
  dragHandle.addEventListener("pointercancel", endWbDrag);
  const posGroup = grp();
  posGroup.appendChild(dragHandle);
  applyPos(curPos);

  tools.append(posGroup, toolGroup, colorGroup, widthGroup, imgGroup, actGroup, exportGroup, recGroup);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(tools);
  setTool("select"); setColor("#111111"); setWidth(4); history.reset();   // 열면 선택·이동 도구가 기본 활성 + 현재 판서를 기준점으로

  // ----- 키보드(이 보드가 활성일 때만): Ctrl+Z / Ctrl+Y -----
  const onKey = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("wb-textinput")) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey){
      const k = String(e.key).toLowerCase();
      if (k === "z" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); doUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)){ e.preventDefault(); e.stopPropagation(); doRedo(); }
    } else if ((e.key === "Delete" || e.key === "Backspace") && wb.selected){      // 선택한 이미지·도형·텍스트 삭제
      e.preventDefault(); e.stopPropagation();
      wb.items = wb.items.filter(it => it !== wb.selected); wb.selected = null; redraw(); history.commit(); recordCommit();
    } else if (e.key === "Escape" && wb.selected){ wb.selected = null; redraw(); }   // 선택 해제
  };
  document.addEventListener("keydown", onKey, true);

  // ----- 사이즈 추적 + 정리 -----
  let ro = null;
  if (typeof ResizeObserver !== "undefined"){ ro = new ResizeObserver(() => resize()); ro.observe(stage); }
  restoreBoardImages();
  requestAnimationFrame(resize);

  if (!doc.cleanupFns) doc.cleanupFns = [];
  doc.cleanupFns.push(() => { clearTimeout(boardRecoveryTimer); if (doc.recorder) doc.recorder.active = false; document.removeEventListener("keydown", onKey, true); document.removeEventListener("paste", onPaste); if (ro) ro.disconnect(); imageUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_){} }); });
}
