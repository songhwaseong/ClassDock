"use strict";

/* ===== 수업 리플레이 =====
   화이트보드 판서를 "시간축 이벤트"로 기록(keyframe)하고, 타임라인으로 되감아 재생한다.
   영상이 아니라 벡터 이벤트라 파일이 작고(보통 수십 KB) 오프라인에서 동작한다.
   그리기는 board-render.js 공용 함수를 재사용해 재생 화면이 판서 화면과 일치한다.

   .lesson = JSON:
     { format:"manneung-lesson", version:1, kind:"board", createdAt, bg, W, H, duration,
       keyframes:[ {t, s:[...items]} | {t, a:item} ] }
     - s: 그 시점의 전체 항목(초기 상태·지우기·되돌리기·이동처럼 배열이 통째로 바뀔 때)
     - a: 직전 상태에 항목 하나 추가(대부분의 판서). 파일 크기를 줄이고 획 성장 애니메이션의 단서가 된다.
   확장 여지: PDF 잉크·파이썬 실행을 keyframe kind(track)로 추가하면 같은 타임라인에 얹을 수 있다. */

const LESSON_FORMAT = "manneung-lesson";

// 이미지 항목을 저장 가능한 dataURL 로 직렬화(원본 Image → 오프스크린 캔버스). 한 번 계산하면 캐시.
function lessonSerializeItems(items){
  return items.map((it) => {
    if (!it || it.type !== "image"){ return Object.assign({}, it); }
    if (!it._lessonSrc && it.img && it.img.complete){
      try {
        const c = document.createElement("canvas");
        c.width = it.img.naturalWidth || it.w; c.height = it.img.naturalHeight || it.h;
        c.getContext("2d").drawImage(it.img, 0, 0);
        it._lessonSrc = c.toDataURL("image/png");
      } catch(_){ it._lessonSrc = null; }
    }
    return { type: "image", x: it.x, y: it.y, w: it.w, h: it.h, src: it._lessonSrc || null };
  });
}

// 녹화기. 커밋(획/도형/텍스트/이미지/지우기/되돌리기)마다 capture() 로 스냅샷을 남긴다.
// 반환 객체를 doc.recorder 에 붙여 whiteboard.js 가 호출한다.
function LessonRecorder(items, bg, dim){
  const t0 = performance.now();
  const keyframes = [];
  let last = items.slice();                       // 마지막으로 기록한 항목 배열(참조 비교용)
  let maxW = (dim && dim.W) || 0, maxH = (dim && dim.H) || 0;
  const now = () => Math.round(performance.now() - t0);
  keyframes.push({ t: 0, s: lessonSerializeItems(items) });   // 초기 상태(보통 빈 배열)

  const isAppendOf = (prev, next) => {
    if (next.length !== prev.length + 1) return false;
    for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return false;
    return true;
  };
  const isSameAs = (prev, next) => {
    if (next.length !== prev.length) return false;
    for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return false;
    return true;
  };

  return {
    active: true,
    bg: bg,
    capture(its, b, d){
      if (!this.active) return;
      if (d){ maxW = Math.max(maxW, d.W || 0); maxH = Math.max(maxH, d.H || 0); }
      if (isSameAs(last, its)) return;                 // 바뀐 게 없으면 스냅샷 생략(정지 시 중복 방지)
      if (isAppendOf(last, its)){
        keyframes.push({ t: now(), a: lessonSerializeItems([its[its.length - 1]])[0] });
      } else {
        keyframes.push({ t: now(), s: lessonSerializeItems(its) });
      }
      last = its.slice();
    },
    stop(its, b, d){
      if (this.active) this.capture(its, b, d);
      this.active = false;
      return {
        format: LESSON_FORMAT, version: 1, kind: "board",
        createdAt: new Date().toISOString(),
        bg: bg || "#ffffff",
        W: maxW || 1280, H: maxH || 720,
        duration: keyframes.length ? keyframes[keyframes.length - 1].t : 0,
        keyframes
      };
    }
  };
}

// keyframes → 재생 상태(메모리 O(N)). 프레임을 미리 전부 펼치지 않고(옛 방식은 O(N²)),
// 재생 위치가 바뀔 때마다 그 시점의 items 만 증분 복원한다:
//   전방 이동 = 다음 keyframe 만 이어 붙임(O(delta)), 후방 이동 = 직전 set 부터 다시 쌓기.
// 이렇게 하면 획이 수천 개인 장시간 수업도 재생 메모리가 판서 개수에 선형이다.
function prepareLessonPlayback(lesson){
  const kfs = (lesson.keyframes || []).slice();
  if (!kfs.length) kfs.push({ t: 0, s: [] });
  const n = kfs.length;
  const times = new Array(n), append = new Array(n), lastSet = new Array(n);
  let ls = -1;
  for (let i = 0; i < n; i++){
    times[i] = kfs[i].t || 0;
    append[i] = !!kfs[i].a;
    if (kfs[i].s) ls = i;      // 전체 교체 지점(초기·지우기·되돌리기·이동) — 후방 복원 시작점
    lastSet[i] = ls;
  }
  return { kfs, times, append, lastSet, n, curItems: [], curIdx: -1 };
}

// state.curItems 를 keyframe idx 시점 상태로 만들어 돌려준다(반환 배열은 그리기 전용, 변형 금지).
function lessonItemsAt(state, idx){
  const applyTo = (from) => {
    for (let i = from; i <= idx; i++){
      const kf = state.kfs[i];
      if (kf.s) state.curItems = kf.s.slice();
      else if (kf.a) state.curItems.push(kf.a);
    }
  };
  if (idx === state.curIdx) return state.curItems;
  if (idx > state.curIdx){ applyTo(state.curIdx + 1); state.curIdx = idx; return state.curItems; }
  const setIdx = state.lastSet[idx];      // 후방: 가장 가까운 set 부터 다시 쌓는다
  if (setIdx >= 0){ state.curItems = state.kfs[setIdx].s.slice(); state.curIdx = setIdx; }
  else { state.curItems = []; state.curIdx = -1; }
  applyTo(state.curIdx + 1); state.curIdx = idx; return state.curItems;
}

// keyframe 들의 이미지(dataURL)를 Image 로 미리 로드해 항목에 붙인다. 같은 src 는 한 번만.
function preloadLessonImages(kfs, onReady){
  const cache = new Map();
  const attach = (it) => {
    if (!it || it.type !== "image" || !it.src) return;
    let img = cache.get(it.src);
    if (!img){ img = new Image(); img.src = it.src; cache.set(it.src, img); }
    it.img = img;
  };
  for (const kf of kfs){ if (kf.s) kf.s.forEach(attach); if (kf.a) attach(kf.a); }
  if (typeof onReady === "function") cache.forEach((img) => { img.onload = onReady; });
}

// t 이하인 마지막 keyframe 인덱스(이진 탐색). times = 오름차순 시각 배열.
function lessonIndexAt(times, t){
  let lo = 0, hi = times.length - 1, idx = 0;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (times[m] <= t){ idx = m; lo = m + 1; } else hi = m - 1; }
  return idx;
}

const lessonFmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

// ----- 재생 화면(새 문서 종류 "replay") -----
function openLessonReplay(lesson, name){
  const doc = makeDoc("replay", name || "수업 리플레이", {});
  doc.lesson = lesson;
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    if (lesson.kind === "pdf-ink") renderPdfInkReplay(doc, host, lesson);
    else renderReplay(doc, host, lesson);
  };
  if (typeof refreshChrome === "function") refreshChrome();
  activateIfIdle(doc, {});
  return doc;
}

// ----- PDF 위 필기 녹화 (전역 훅; pdf-editor.js 가 호출, 녹화 중이 아니면 무동작) -----
let _lessonPdfRec = null;
function lessonPdfRecording(){ return !!(_lessonPdfRec && _lessonPdfRec.active); }
function lessonPdfOnStroke(pdfDoc, pageIndex, stroke){ if (lessonPdfRecording()) _lessonPdfRec.onStroke(pdfDoc, pageIndex, stroke); }
function lessonPdfOnClear(pdfDoc, pageIndex){ if (lessonPdfRecording()) _lessonPdfRec.onClear(pdfDoc, pageIndex); }
function lessonPdfCloneStroke(s){ return { tool: s.tool, color: s.color, width: s.width, points: (s.points || []).map((p) => ({ x: p.x, y: p.y })) }; }
function lessonPdfCaptureBackdrop(pdfDoc, pageIndex){
  const p = pdfDoc && pdfDoc.pages && pdfDoc.pages[pageIndex]; if (!p) return null;
  let src = null; try { if (p.canvas) src = p.canvas.toDataURL("image/png"); } catch(_){}
  return { src, w: p.cssW || 1000, h: p.cssH || 1400 };
}
function LessonPdfInkRecorder(){
  const t0 = performance.now();
  const keyframes = []; const pages = {};
  const now = () => Math.round(performance.now() - t0);
  return {
    active: true,
    onStroke(pdfDoc, pageIndex, stroke){
      if (!this.active || !stroke) return;
      if (!pages[pageIndex]){ const b = lessonPdfCaptureBackdrop(pdfDoc, pageIndex); if (b) pages[pageIndex] = b; }
      keyframes.push({ t: now(), p: pageIndex, a: lessonPdfCloneStroke(stroke) });
    },
    onClear(pdfDoc, pageIndex){ if (this.active) keyframes.push({ t: now(), p: pageIndex, c: 1 }); },
    stop(){
      this.active = false;
      return { format: LESSON_FORMAT, version: 1, kind: "pdf-ink", createdAt: new Date().toISOString(),
        duration: keyframes.length ? keyframes[keyframes.length - 1].t : 0, pages, keyframes };
    }
  };
}
// PDF 필기바의 ● 녹화 버튼이 호출. 시작이면 true, 정지면 false 를 돌려준다.
function lessonPdfToggleRecord(){
  if (lessonPdfRecording()){
    const lesson = _lessonPdfRec.stop(); _lessonPdfRec = null;
    if (lesson.keyframes.length && Object.keys(lesson.pages).length && typeof finishLessonRecording === "function") finishLessonRecording(lesson, "PDF 필기");
    else if (typeof toast === "function") toast("녹화된 필기가 없어요.", 2000);
    return false;
  }
  _lessonPdfRec = LessonPdfInkRecorder();
  if (typeof toast === "function") toast("PDF 필기 녹화를 시작했어요. 필기한 뒤 ■ 정지를 누르세요.", 3200);
  return true;
}

// 재생기 공용 타임라인/컨트롤(보드·PDF잉크가 공유). opts.draw(ctx,CW,CH,dpr,playT) 가 한 프레임을 그린다.
// 반환 { redraw } 로 이미지 로드 완료 등에서 다시 그릴 수 있다.
function mountReplayPlayer(doc, host, opts){
  host.classList.add("lr-doc");
  const duration = opts.duration || 0;

  const wrap = document.createElement("div"); wrap.className = "lr-wrap";
  const stage = document.createElement("div"); stage.className = "lr-stage";
  const canvas = document.createElement("canvas"); canvas.className = "lr-canvas";
  stage.appendChild(canvas);
  const bar = document.createElement("div"); bar.className = "lr-bar";
  wrap.append(stage, bar); host.appendChild(wrap);

  const ctx = canvas.getContext("2d");
  let dpr = 1, CW = 0, CH = 0;
  let playT = 0, playing = false, speed = 1, lastTick = 0, raf = 0;

  const mk = (label, title, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; b.setAttribute("aria-label", title); return b; };
  const playBtn = mk("▶", "재생 (스페이스)", "lr-btn lr-play");
  const restartBtn = mk("⟲", "처음부터", "lr-btn");
  const seek = document.createElement("input");
  seek.type = "range"; seek.className = "lr-seek"; seek.min = "0"; seek.max = String(duration || 0); seek.step = "10"; seek.value = "0";
  seek.setAttribute("aria-label", "재생 위치");
  const timeLabel = document.createElement("span"); timeLabel.className = "lr-time"; timeLabel.textContent = "0:00 / " + lessonFmtTime(duration);
  const speedSel = document.createElement("select"); speedSel.className = "lr-speed"; speedSel.title = "재생 속도";
  [["0.5", "0.5×"], ["1", "1×"], ["1.5", "1.5×"], ["2", "2×"], ["4", "4×"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === "1") o.selected = true; speedSel.appendChild(o); });
  const saveBtn = mk("💾 저장", ".lesson 파일로 저장", "lr-btn lr-save");
  bar.append(playBtn, restartBtn, seek, timeLabel, speedSel, saveBtn);

  const draw = () => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, CW, CH); opts.draw(ctx, CW, CH, dpr, playT); };
  const resize = () => {
    const r = stage.getBoundingClientRect();
    CW = Math.max(1, Math.round(r.width)); CH = Math.max(1, Math.round(r.height));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
    canvas.style.width = CW + "px"; canvas.style.height = CH + "px";
    draw();
  };
  const syncUI = () => { seek.value = String(Math.round(playT)); timeLabel.textContent = lessonFmtTime(playT) + " / " + lessonFmtTime(duration); };
  const setPlayIcon = () => { playBtn.textContent = playing ? "⏸" : "▶"; playBtn.title = playing ? "일시정지 (스페이스)" : "재생 (스페이스)"; };
  const tick = (ts) => {
    if (!playing){ return; }
    if (typeof activeId !== "undefined" && activeId !== doc.id){ pause(); return; }   // 다른 탭으로 가면 멈춤
    if (!lastTick) lastTick = ts;
    const dt = ts - lastTick; lastTick = ts;
    playT += dt * speed;
    if (playT >= duration){ playT = duration; playing = false; setPlayIcon(); }
    syncUI(); draw();
    if (playing) raf = requestAnimationFrame(tick);
  };
  const play = () => { if (playing) return; if (playT >= duration) playT = 0; playing = true; lastTick = 0; setPlayIcon(); raf = requestAnimationFrame(tick); };
  const pause = () => { playing = false; setPlayIcon(); };
  const toggle = () => { playing ? pause() : play(); };

  playBtn.addEventListener("click", toggle);
  restartBtn.addEventListener("click", () => { playT = 0; syncUI(); draw(); });
  seek.addEventListener("input", () => { pause(); playT = Number(seek.value) || 0; syncUI(); draw(); });
  speedSel.addEventListener("change", () => { speed = Number(speedSel.value) || 1; });
  saveBtn.addEventListener("click", () => { if (typeof opts.onSave === "function") opts.onSave(); });

  // 이 재생 화면이 활성일 때 스페이스로 재생/정지
  const onKey = (e) => {
    if (typeof activeId !== "undefined" && activeId !== doc.id) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "SELECT" || ae.tagName === "TEXTAREA")) return;
    if (e.key === " " || e.code === "Space"){ e.preventDefault(); toggle(); }
  };
  document.addEventListener("keydown", onKey);

  let ro = null;
  if (typeof ResizeObserver !== "undefined"){ ro = new ResizeObserver(() => resize()); ro.observe(stage); }
  requestAnimationFrame(resize);
  setPlayIcon(); syncUI();

  if (!doc.cleanupFns) doc.cleanupFns = [];
  doc.cleanupFns.push(() => { playing = false; if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); document.removeEventListener("keydown", onKey); });

  return { redraw: draw };
}

// 화이트보드 리플레이(벡터 판서).
function renderReplay(doc, host, lesson){
  const pb = prepareLessonPlayback(lesson);
  const boardBg = lesson.bg || "#ffffff";
  const duration = lesson.duration || pb.times[pb.n - 1] || 0;
  const draw = (ctx, CW, CH, dpr, playT) => {
    const idx = lessonIndexAt(pb.times, playT);
    const baseItems = lessonItemsAt(pb, idx);         // idx 시점까지 커밋된 판서
    // 다음 keyframe 이 "획 추가"면, 그 획을 진행도만큼 성장시켜 별도로 덧그린다(공용 렌더러 재사용).
    let grow = null, growLimit = 0;
    const ni = idx + 1;
    if (ni < pb.n && pb.append[ni]){
      const cand = pb.kfs[ni].a;
      if (cand && cand.points && cand.points.length){
        const span = Math.max(1, pb.times[ni] - pb.times[idx]);
        const prog = Math.min(1, Math.max(0, (playT - pb.times[idx]) / span));
        grow = cand; growLimit = Math.max(1, Math.round(cand.points.length * prog));
      }
    }
    const scale = Math.min(CW / lesson.W, CH / lesson.H) || 1;
    const dw = lesson.W * scale, dh = lesson.H * scale, ox = (CW - dw) / 2, oy = (CH - dh) / 2;
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.rect(0, 0, lesson.W, lesson.H); ctx.clip();
    ctx.fillStyle = boardBg; ctx.fillRect(0, 0, lesson.W, lesson.H);
    boardDrawItems(ctx, baseItems, { bg: boardBg });
    if (grow) boardDrawItem(ctx, grow, boardBg, growLimit);
    ctx.restore();
  };
  const player = mountReplayPlayer(doc, host, { duration, draw, onSave: () => saveLessonFile(lesson, doc.name) });
  preloadLessonImages(pb.kfs, player.redraw);
}

// ----- PDF 위 필기(잉크) 리플레이 -----
// 부분 스트로크 그리기(성장 애니메이션). 기존 잉크 렌더러(applyInkStyle)를 재사용해 지우개(destination-out)도 재현.
function lessonDrawInk(ctx, st, limit){
  const p = st.points; if (!p || !p.length) return;
  const n = (limit == null) ? p.length : Math.max(1, Math.min(p.length, limit));
  ctx.save();
  if (typeof applyInkStyle === "function") applyInkStyle(ctx, st);
  else { ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = st.width; ctx.strokeStyle = st.color; ctx.globalAlpha = (st.tool === "highlighter") ? 0.3 : 1; }
  ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(p[i].x, p[i].y);
  if (n === 1) ctx.lineTo(p[0].x + 0.01, p[0].y + 0.01);
  ctx.stroke(); ctx.restore();
}

// t 시점의 활성 페이지 + 그 페이지의 커밋 스트로크(마지막 지우기 이후) + 성장 중 스트로크.
function pdfInkStateAt(kfs, times, t, firstPage){
  const idx = lessonIndexAt(times, t);
  const page = (idx >= 0 && kfs[idx]) ? kfs[idx].p : firstPage;
  const strokes = [];
  for (let i = 0; i <= idx; i++){
    const kf = kfs[i]; if (!kf || kf.p !== page) continue;
    if (kf.c) strokes.length = 0; else if (kf.a) strokes.push(kf.a);
  }
  let grow = null, growLimit = 0;
  const ni = idx + 1;
  if (ni < kfs.length && kfs[ni].a && kfs[ni].p === page){
    const cand = kfs[ni].a;
    if (cand.points && cand.points.length){
      const span = Math.max(1, times[ni] - times[idx]);
      const prog = Math.min(1, Math.max(0, (t - times[idx]) / span));
      grow = cand; growLimit = Math.max(1, Math.round(cand.points.length * prog));
    }
  }
  return { page, strokes, grow, growLimit };
}

function renderPdfInkReplay(doc, host, lesson){
  const kfs = lesson.keyframes || [];
  const times = kfs.map((k) => k.t || 0);
  const pages = lesson.pages || {};
  const duration = lesson.duration || (times.length ? times[times.length - 1] : 0);
  const firstPage = kfs.length ? kfs[0].p : Number(Object.keys(pages)[0] || 0);

  const imgs = {};                                    // 페이지 배경(dataURL → Image)
  const off = document.createElement("canvas"); const offctx = off.getContext("2d");

  const draw = (ctx, CW, CH, dpr, playT) => {
    const st = pdfInkStateAt(kfs, times, playT, firstPage);
    const pg = pages[st.page] || { w: 1000, h: 1400 };
    const pw = pg.w || 1000, ph = pg.h || 1400;
    const scale = Math.min(CW / pw, CH / ph) || 1;
    const dw = pw * scale, dh = ph * scale, ox = (CW - dw) / 2, oy = (CH - dh) / 2;
    // 잉크는 별도 투명 캔버스에 그린다 — 지우개 destination-out 이 아래 배경 이미지를 지우지 않게.
    const os = Math.max(1, Math.min(3, dpr * scale));
    off.width = Math.max(1, Math.round(pw * os)); off.height = Math.max(1, Math.round(ph * os));
    offctx.setTransform(os, 0, 0, os, 0, 0);
    offctx.globalCompositeOperation = "source-over"; offctx.clearRect(0, 0, pw, ph);
    for (const s of st.strokes) lessonDrawInk(offctx, s, null);
    if (st.grow) lessonDrawInk(offctx, st.grow, st.growLimit);
    ctx.save();
    ctx.translate(ox, oy);
    const im = imgs[st.page];
    if (im && im.complete && im.naturalWidth){ ctx.drawImage(im, 0, 0, dw, dh); }
    else { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, dw, dh); }
    ctx.drawImage(off, 0, 0, dw, dh);
    ctx.restore();
    // 현재 페이지 표시
    ctx.save();
    ctx.fillStyle = "rgba(15,23,42,.72)"; ctx.fillRect(ox + 8, oy + 8, 76, 22);
    ctx.fillStyle = "#fff"; ctx.font = '12px system-ui,"Malgun Gothic",sans-serif'; ctx.textBaseline = "middle";
    ctx.fillText("페이지 " + (st.page + 1), ox + 16, oy + 20);
    ctx.restore();
  };

  const player = mountReplayPlayer(doc, host, { duration, draw, onSave: () => saveLessonFile(lesson, doc.name) });
  for (const k in pages){ if (pages[k] && pages[k].src){ const im = new Image(); im.onload = () => player.redraw(); im.src = pages[k].src; imgs[k] = im; } }
}

// ----- 저장/열기 -----
function saveLessonFile(lesson, name){
  try {
    const blob = new Blob([JSON.stringify(lesson)], { type: "application/json" });
    const u = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = u; a.download = (name || "수업").replace(/\.lesson$/i, "") + ".lesson";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
  } catch(e){ if (typeof toast === "function") toast("리플레이를 저장하지 못했어요.", 2400, { type: "error" }); }
}

// 녹화 종료 후 재생 화면을 열고 안내한다. whiteboard.js 가 호출.
function finishLessonRecording(lesson, name){
  const doc = openLessonReplay(lesson, (name ? name + " " : "") + "리플레이");
  if (typeof toast === "function") toast("수업 리플레이가 만들어졌어요. ▶ 재생하거나 💾로 저장하세요.", 3400);
  return doc;
}

// .lesson 파일 열기(파일 오픈 파이프라인 + 메뉴 공용).
async function loadLesson(file, opts){
  let lesson = null;
  try { lesson = JSON.parse(await file.text()); } catch(_){}
  if (!lesson || lesson.format !== LESSON_FORMAT){ if (typeof toast === "function") toast("리플레이(.lesson) 파일을 읽지 못했어요.", 3000); return null; }
  return openLessonReplay(lesson, (file.name || "수업 리플레이").replace(/\.lesson$/i, ""));
}

// 메뉴 '리플레이 열기' — 숨은 파일 입력으로 .lesson 을 직접 고른다.
function openLessonFilePicker(){
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".lesson,application/json"; inp.hidden = true;
  inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; if (f) loadLesson(f, {}); inp.remove(); });
  document.body.appendChild(inp); inp.click();
}
