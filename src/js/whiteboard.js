"use strict";

/* ===== 독립 화이트보드(설명용 칠판) =====
   새 문서 종류 "board". 벡터 모델(items)로 그려 undo/redo·리사이즈에 안전하고,
   PNG/PDF 로 내보낸다. 새 라이브러리 없이 캔버스만 사용. */

let _boardCount = 0;
function newWhiteboard(){
  _boardCount++;
  const name = _boardCount > 1 ? ("화이트보드 " + _boardCount) : "화이트보드";
  const doc = makeDoc("board", name, {});
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
  const wb = { tool: "pen", color: "#111111", width: 4, items: [], undo: [], redo: [], bg: "#ffffff", selected: null };

  // ----- 모델 → 캔버스 (그리기는 board-render.js 공용 함수 사용 → 리플레이 재생과 화면이 일치) -----
  const applyStroke = (it) => boardApplyStroke(ctx, it, wb.bg);
  const drawItem = (it) => boardDrawItem(ctx, it, wb.bg);
  // 수업 리플레이: 녹화 중이면 커밋(획/도형/텍스트/이미지/지우기/되돌리기)마다 스냅샷을 남긴다.
  const recordCommit = () => { if (doc.recorder && doc.recorder.active){ try { doc.recorder.capture(wb.items, wb.bg, { W, H }); } catch(_){} } };
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
  const redraw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.fillStyle = wb.bg; ctx.fillRect(0, 0, W, H);
    for (const it of wb.items) drawItem(it);
    const s = wb.selected;                            // 선택 표시(점선 테두리 + 8핸들). 내보낼 땐 잠시 해제하므로 안 박힘.
    if (s && s.type === "image"){
      ctx.save(); ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = "#2563eb";
      ctx.setLineDash([6, 4]); ctx.strokeRect(s.x, s.y, s.w, s.h); ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      for (const h of HANDLES){ const hp = handlePos(s, h); ctx.fillRect(hp.x - HANDLE / 2, hp.y - HANDLE / 2, HANDLE, HANDLE); ctx.strokeRect(hp.x - HANDLE / 2, hp.y - HANDLE / 2, HANDLE, HANDLE); }
      ctx.restore();
    }
  };
  const pushUndo = () => { wb.undo.push(wb.items.slice()); if (wb.undo.length > 140) wb.undo.shift(); wb.redo.length = 0; };
  const doUndo = () => { if (!wb.undo.length) return; wb.redo.push(wb.items.slice()); wb.items = wb.undo.pop(); wb.selected = null; redraw(); updateUndoButtons(); recordCommit(); };
  const doRedo = () => { if (!wb.redo.length) return; wb.undo.push(wb.items.slice()); wb.items = wb.redo.pop(); wb.selected = null; redraw(); updateUndoButtons(); recordCommit(); };
  const clearAll = () => { if (!wb.items.length) return; pushUndo(); wb.items = []; wb.selected = null; redraw(); updateUndoButtons(); recordCommit(); };

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
  // 선택 도구: 이미지 히트테스트
  const imageAt = (p) => {
    for (let i = wb.items.length - 1; i >= 0; i--){ const it = wb.items[i]; if (it.type === "image" && p.x >= it.x && p.x <= it.x + it.w && p.y >= it.y && p.y <= it.y + it.h) return it; }
    return null;
  };
  const beginSelDrag = (e, mode, handle) => {
    canvas.setPointerCapture(e.pointerId);
    const it = wb.selected; const start = pt(e);
    const o = { left: it.x, top: it.y, right: it.x + it.w, bottom: it.y + it.h };
    let live = it, undoPushed = false;
    const move = (ev) => {
      const q = pt(ev);
      if (!undoPushed){ pushUndo(); const idx = wb.items.indexOf(it); live = Object.assign({}, it); wb.items[idx] = live; wb.selected = live; undoPushed = true; }
      if (mode === "move"){
        live.x = o.left + (q.x - start.x); live.y = o.top + (q.y - start.y);
      } else {                                          // 핸들이 잡은 변/모서리만 이동(반대편 고정), 가로·세로 독립
        if (handle.hx === 0){ const nx = Math.min(q.x, o.right - 24); live.x = nx; live.w = o.right - nx; }
        else if (handle.hx === 1){ live.x = o.left; live.w = Math.max(24, q.x - o.left); }
        if (handle.hy === 0){ const ny = Math.min(q.y, o.bottom - 16); live.y = ny; live.h = o.bottom - ny; }
        else if (handle.hy === 1){ live.y = o.top; live.h = Math.max(16, q.y - o.top); }
      }
      redraw();
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      updateUndoButtons(); redraw(); if (undoPushed) recordCommit();
    };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  };
  const startSelect = (e) => {
    const p = pt(e);
    const h = wb.selected && handleAt(wb.selected, p);
    if (h){ beginSelDrag(e, "resize", h); return; }                                       // 핸들 → 그 방향으로 크기조절
    const img = imageAt(p);
    wb.selected = img || null; redraw();
    if (img) beginSelDrag(e, "move");                                                     // 이미지 본체 → 이동
  };
  let cur = null, drawing = false, lastPt = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (wb.tool === "select"){ startSelect(e); return; }
    if (wb.tool === "text"){ startText(pt(e)); return; }
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
    pushUndo(); wb.items.push(cur); cur = null; redraw(); updateUndoButtons(); recordCommit();
  };
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);
  // 선택 도구 호버 커서: 이미지 위=이동, 우하단 핸들=크기조절
  canvas.addEventListener("pointermove", (e) => {
    if (wb.tool !== "select" || drawing) return;
    const p = pt(e);
    const h = wb.selected && handleAt(wb.selected, p);
    canvas.style.cursor = h ? h.cur : (imageAt(p) ? "move" : "default");
  });

  // ----- 텍스트 도구: 클릭 위치에 인라인 입력 -----
  function startText(p){
    const ta = document.createElement("textarea"); ta.className = "wb-textinput"; ta.rows = 1;
    const fs = Math.max(14, wb.width * 4);
    ta.style.left = p.x + "px"; ta.style.top = p.y + "px"; ta.style.color = wb.color; ta.style.fontSize = fs + "px";
    stage.appendChild(ta); ta.focus();
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const txt = ta.value; ta.remove();
      if (txt.trim()){ pushUndo(); wb.items.push({ type: "text", color: wb.color, x: p.x, y: p.y, text: txt, fontSize: fs }); redraw(); updateUndoButtons(); recordCommit(); }
    };
    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape"){ e.preventDefault(); done = true; ta.remove(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); ta.blur(); }
      e.stopPropagation();
    });
  }

  // ----- 이미지 넣기(캡처 붙여넣기·드래그드롭·파일선택) -----
  const imageUrls = [];                              // 보드 닫을 때 일괄 해제(생존 동안은 유지 — 저장/내보내기에 필요)
  const loadImageBlob = (blob) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob); imageUrls.push(url); const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => { reject(new Error("image-load-failed")); };
    img.src = url;
  });
  // (cx,cy) 중심으로 스테이지에 맞춰 축소 배치. cx/cy 없으면 화면 중앙.
  const placeImage = (img, cx, cy) => {
    const maxW = W * 0.85, maxH = H * 0.85;
    let w = img.naturalWidth || 300, h = img.naturalHeight || 200;
    const sc = Math.min(1, maxW / w, maxH / h); w = Math.round(w * sc); h = Math.round(h * sc);
    const ccx = (cx == null) ? W / 2 : cx, ccy = (cy == null) ? H / 2 : cy;
    let x = Math.round(ccx - w / 2), y = Math.round(ccy - h / 2);
    x = Math.max(0, Math.min(x, Math.max(0, W - w))); y = Math.max(0, Math.min(y, Math.max(0, H - h)));
    const it = { type: "image", img, x, y, w, h };
    pushUndo(); wb.items.push(it);
    wb.selected = it; setTool("select");              // 넣자마자 선택 상태 + 선택 도구 → 바로 드래그로 위치·크기 조절
    redraw(); updateUndoButtons(); recordCommit();
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
  const COLORS = ["#111111", "#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#ffffff"];
  const TOOLS = [
    ["select", "🖱", "선택·이동 (이미지 옮기기·크기조절)"],
    ["pen", "✏️", "펜"], ["highlighter", "🖍️", "형광펜"], ["eraser", "🧽", "지우개"],
    ["line", "／", "직선"], ["arrow", "↗", "화살표"], ["rect", "▭", "사각형"], ["ellipse", "◯", "원"], ["text", "T", "텍스트"]
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
  const updateUndoButtons = () => { if (undoBtn) undoBtn.disabled = !wb.undo.length; if (redoBtn) redoBtn.disabled = !wb.redo.length; };

  const mkBtn = (label, title, cls, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", fn); return b;
  };
  const grp = () => { const g = document.createElement("span"); g.className = "wb-group"; return g; };

  const toolGroup = grp();
  TOOLS.forEach(([t, icon, title]) => { const b = mkBtn(icon, title, "wb-tool", () => setTool(t)); toolBtns[t] = b; toolGroup.appendChild(b); });

  const colorGroup = grp();
  COLORS.forEach((c) => {
    const s = document.createElement("button"); s.type = "button"; s.className = "wb-swatch"; s.title = c; s.style.background = c;
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
  imgGroup.append(mkBtn("🖼", "이미지 넣기 — 파일 선택 (또는 Ctrl+V 붙여넣기·드래그드롭)", "wb-act", () => fileInput.click()), fileInput);

  const actGroup = grp();
  undoBtn = mkBtn("↶", "되돌리기 (Ctrl+Z)", "wb-act", doUndo);
  redoBtn = mkBtn("↷", "다시 실행 (Ctrl+Y)", "wb-act", doRedo);
  const clearBtn = mkBtn("🗑", "보드 전체 지우기", "wb-act wb-clear", () => {
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
  setTool("select"); setColor("#111111"); setWidth(4); updateUndoButtons();   // 열면 선택·이동 도구가 기본 활성

  // ----- 키보드(이 보드가 활성일 때만): Ctrl+Z / Ctrl+Y -----
  const onKey = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("wb-textinput")) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey){
      const k = String(e.key).toLowerCase();
      if (k === "z" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); doUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)){ e.preventDefault(); e.stopPropagation(); doRedo(); }
    } else if ((e.key === "Delete" || e.key === "Backspace") && wb.selected){      // 선택한 이미지 삭제
      e.preventDefault(); e.stopPropagation();
      pushUndo(); wb.items = wb.items.filter(it => it !== wb.selected); wb.selected = null; redraw(); updateUndoButtons(); recordCommit();
    } else if (e.key === "Escape" && wb.selected){ wb.selected = null; redraw(); }   // 선택 해제
  };
  document.addEventListener("keydown", onKey, true);

  // ----- 사이즈 추적 + 정리 -----
  let ro = null;
  if (typeof ResizeObserver !== "undefined"){ ro = new ResizeObserver(() => resize()); ro.observe(stage); }
  requestAnimationFrame(resize);

  if (!doc.cleanupFns) doc.cleanupFns = [];
  doc.cleanupFns.push(() => { if (doc.recorder) doc.recorder.active = false; document.removeEventListener("keydown", onKey, true); document.removeEventListener("paste", onPaste); if (ro) ro.disconnect(); imageUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_){} }); });
}
