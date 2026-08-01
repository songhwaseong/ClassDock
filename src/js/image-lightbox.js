"use strict";

/* 실행 결과·노트북 출력의 그림(그래프)을 클릭하면 큰 창으로 띄운다.
   새 탭을 열지 않고 오버레이 한 장만 만들어 계속 재사용한다. 그림은 이미 dataURL 이라 다시 받아올 것이 없다.
   갤러리는 실행할 때마다 통째로 다시 그려지므로, 그림마다 리스너를 다는 대신 document 위임 하나로 받는다.
   껍데기 클래스를 .modal 로 두면 화면보호기의 '바쁨' 판정(.modal:not([hidden]))에도 그대로 걸린다. */
(function(){
  const ZOOM_SELECTOR = "img.out-plot, img.nbv-out-img, img.mn-zoomable";
  const STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];
  const MIN_SCALE = 0.01, MAX_SCALE = 16;

  let modal = null, els = null;
  let items = [], index = 0;
  let fit = true, scale = 1, panMoved = false, lastFocus = null;

  function build(){
    modal = document.createElement("div");
    modal.className = "modal plot-zoom";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="modal-card plot-zoom-card" role="dialog" aria-modal="true" aria-label="그림 크게 보기">' +
        '<div class="plot-zoom-head">' +
          '<h3 id="plotZoomTitle">그림 크게 보기</h3>' +
          '<span class="plot-zoom-count" id="plotZoomCount"></span>' +
          '<button class="plot-zoom-x" id="plotZoomClose" type="button" aria-label="닫기">×</button>' +
        '</div>' +
        // 넘기기 버튼은 스크롤되는 무대 '바깥'에 둔다. 안에 두면 확대해서 스크롤할 때 같이 밀려 사라진다.
        '<div class="plot-zoom-body">' +
          '<button class="plot-zoom-nav prev" id="plotZoomPrev" type="button" aria-label="이전 그림">‹</button>' +
          '<div class="plot-zoom-stage" id="plotZoomStage"><img class="plot-zoom-img fit" id="plotZoomImg" alt=""></div>' +
          '<button class="plot-zoom-nav next" id="plotZoomNext" type="button" aria-label="다음 그림">›</button>' +
        '</div>' +
        '<div class="modal-actions plot-zoom-actions">' +
          '<button class="btn" id="plotZoomOut" type="button" aria-label="축소">−</button>' +
          '<span class="plot-zoom-scale" id="plotZoomScale" aria-live="polite"></span>' +
          '<button class="btn" id="plotZoomIn" type="button" aria-label="확대">＋</button>' +
          '<button class="btn" id="plotZoomFit" type="button">화면 맞춤</button>' +
          '<span class="spacer"></span>' +
          '<button class="btn" id="plotZoomSave" type="button">PNG 저장</button>' +
          '<button class="btn" id="plotZoomMemo" type="button">메모로 보내기</button>' +
          '<button class="btn primary" id="plotZoomDone" type="button">닫기</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    els = {
      title: modal.querySelector("#plotZoomTitle"),
      count: modal.querySelector("#plotZoomCount"),
      stage: modal.querySelector("#plotZoomStage"),
      img: modal.querySelector("#plotZoomImg"),
      prev: modal.querySelector("#plotZoomPrev"),
      next: modal.querySelector("#plotZoomNext"),
      zoomOut: modal.querySelector("#plotZoomOut"),
      zoomIn: modal.querySelector("#plotZoomIn"),
      fit: modal.querySelector("#plotZoomFit"),
      scale: modal.querySelector("#plotZoomScale"),
      save: modal.querySelector("#plotZoomSave"),
      memo: modal.querySelector("#plotZoomMemo"),
      close: modal.querySelector("#plotZoomClose"),
      done: modal.querySelector("#plotZoomDone")
    };
    els.close.addEventListener("click", close);
    els.done.addEventListener("click", close);
    els.prev.addEventListener("click", () => step(-1));
    els.next.addEventListener("click", () => step(1));
    els.zoomIn.addEventListener("click", () => zoomStep(1));
    els.zoomOut.addEventListener("click", () => zoomStep(-1));
    els.fit.addEventListener("click", () => { fit = true; applyScale(); });
    els.save.addEventListener("click", saveCurrent);
    els.memo.addEventListener("click", sendToMemo);
    // 배경(어두운 바깥 여백)만 눌러야 닫힌다. 그림 위 드래그로 닫히면 확대해서 훑어볼 수가 없다.
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
    els.img.addEventListener("click", () => { if (!panMoved) { fit = !fit; if (!fit) scale = 1; applyScale(); } });
    els.img.addEventListener("load", () => applyScale());   // 크기는 그림이 실린 뒤에야 정해진다
    els.stage.addEventListener("mousedown", startPan);
    els.stage.addEventListener("wheel", (e) => {   // Ctrl+휠 = 확대·축소(그냥 휠은 평소대로 스크롤)
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomStep(e.deltaY < 0 ? 1 : -1);
    }, { passive:false });
    if (window.MNI18N && typeof MNI18N.translateTree === "function") MNI18N.translateTree(modal);
  }

  // ── 배율 ────────────────────────────────────────────────────────────
  // 화면 맞춤은 '줄이기만' 하지 않고 창 폭·높이에 닿을 때까지 늘린다. 그래프는 대개 640×480 이라
  // 그냥 두면 큰 창 한가운데에 작게 떠서, 크게 보려고 연 뜻이 반감된다.
  function fitScale(){
    const img = els.img, nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
    if (!nw || !nh) return 1;
    const box = els.stage.getBoundingClientRect();
    const w = Math.max(1, box.width - 4), h = Math.max(1, box.height - 4);   // 테두리 여유
    return Math.min(w / nw, h / nh);
  }
  function currentScale(){
    if (!els.img.naturalWidth) return 1;
    return fit ? fitScale() : scale;
  }
  function updateScaleLabel(){
    const current = currentScale();
    const pct = Math.round(current * 100);
    els.scale.textContent = (fit ? "맞춤 " : "") + (pct > 0 ? pct + "%" : "");
    els.fit.disabled = fit;
    els.zoomOut.disabled = current <= MIN_SCALE + 0.001;
    els.zoomIn.disabled = current >= MAX_SCALE - 0.001;
  }
  function applyScale(){
    const img = els.img, nw = img.naturalWidth || 0;
    img.classList.toggle("fit", fit);
    if (!nw){ img.style.width = ""; img.style.height = ""; }   // 아직 안 실린 그림은 load 에서 다시 맞춘다
    else {
      img.style.width = Math.max(1, Math.round(nw * (fit ? fitScale() : scale))) + "px";
      img.style.height = "auto";
    }
    els.stage.classList.toggle("pannable", !fit);
    updateScaleLabel();
  }
  function setScale(next){
    const stage = els.stage, img = els.img;
    // 확대·축소해도 지금 보고 있던 지점이 가운데 남도록 스크롤을 비율로 옮긴다
    const cx = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, img.clientWidth);
    const cy = (stage.scrollTop + stage.clientHeight / 2) / Math.max(1, img.clientHeight);
    fit = false; scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(next) ? next : 1));
    applyScale();
    stage.scrollLeft = cx * img.clientWidth - stage.clientWidth / 2;
    stage.scrollTop = cy * img.clientHeight - stage.clientHeight / 2;
  }
  function zoomStep(dir){
    const cur = currentScale();
    let next = cur;
    if (dir > 0){
      if (cur >= MAX_SCALE - 0.001) return;
      next = STEPS.find(s => s > cur + 0.001) || Math.min(MAX_SCALE, cur * 1.25);
    } else {
      if (cur <= MIN_SCALE + 0.001) return;
      const lower = STEPS.filter(s => s < cur - 0.001);
      next = lower.length ? lower[lower.length - 1] : Math.max(MIN_SCALE, cur / 1.25);
    }
    setScale(next);
  }
  function startPan(e){
    panMoved = false;
    if (e.button !== 0 || (e.target.closest && e.target.closest(".plot-zoom-nav"))) return;
    // 공용 modal-card 이동 처리까지 버블링되면 그림과 확대 창이 동시에 움직인다.
    e.stopPropagation();
    if (fit) return;
    const stage = els.stage;
    const sx = e.clientX, sy = e.clientY, l = stage.scrollLeft, t = stage.scrollTop;
    const move = (ev) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) panMoved = true;
      stage.scrollLeft = l - (ev.clientX - sx);
      stage.scrollTop = t - (ev.clientY - sy);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("plot-zoom-panning");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("plot-zoom-panning");
    e.preventDefault();
  }

  // ── 그림 넘기기 ─────────────────────────────────────────────────────
  function show(i){
    if (!items.length) return;
    index = (i + items.length) % items.length;
    const it = items[index];
    els.img.src = it.src;
    els.img.alt = it.alt || "그림";
    els.title.textContent = it.alt || "그림 크게 보기";
    els.count.textContent = items.length > 1 ? (index + 1) + " / " + items.length : "";
    els.prev.hidden = els.next.hidden = items.length < 2;
    fit = true; scale = 1;
    applyScale();
    els.stage.scrollTop = els.stage.scrollLeft = 0;
  }
  function step(dir){ if (items.length > 1) show(index + dir); }

  // ── 열고 닫기 ───────────────────────────────────────────────────────
  function onKeydown(e){
    if (!modal || modal.hidden) return;
    const k = e.key;
    if (k === "Escape"){ e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (k === "ArrowLeft"){ e.preventDefault(); e.stopImmediatePropagation(); step(-1); return; }
    if (k === "ArrowRight"){ e.preventDefault(); e.stopImmediatePropagation(); step(1); return; }
    if (k === "+" || k === "="){ e.preventDefault(); e.stopImmediatePropagation(); zoomStep(1); return; }
    if (k === "-" || k === "_"){ e.preventDefault(); e.stopImmediatePropagation(); zoomStep(-1); return; }
    if (k === "0"){ e.preventDefault(); e.stopImmediatePropagation(); fit = true; applyScale(); }
  }
  function onResize(){ if (fit) applyScale(); }   // 맞춤 배율은 창 크기가 바뀌면 다시 계산해야 한다
  function open(list, start){
    const clean = (list || []).filter(it => it && it.src);
    if (!clean.length) return;
    if (!modal) build();
    items = clean;
    lastFocus = document.activeElement;
    modal.hidden = false;
    window.addEventListener("keydown", onKeydown, true);
    window.addEventListener("resize", onResize);
    show(Math.max(0, Math.min(clean.length - 1, start | 0)));
    try { els.close.focus(); } catch(_){}
  }
  function close(){
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    els.img.removeAttribute("src");
    items = [];
    window.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("resize", onResize);
    if (lastFocus && typeof lastFocus.focus === "function"){ try { lastFocus.focus(); } catch(_){} }
    lastFocus = null;
  }

  // ── 저장 ────────────────────────────────────────────────────────────
  function dataUrlToBlob(src){
    const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(String(src || ""));
    if (!m) return null;
    const mime = m[1] || "image/png";
    try {
      if (m[2]){
        const bin = atob(m[3]);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return new Blob([buf], { type:mime });
      }
      return new Blob([decodeURIComponent(m[3])], { type:mime });
    } catch(_){ return null; }
  }
  function currentBlob(){
    const direct = dataUrlToBlob(items[index] && items[index].src);
    if (direct) return Promise.resolve(direct);
    return new Promise(resolve => {   // dataURL 이 아닌 그림(blob:·파일 경로)은 캔버스로 다시 그려 받는다
      try {
        const c = document.createElement("canvas");
        c.width = els.img.naturalWidth; c.height = els.img.naturalHeight;
        c.getContext("2d").drawImage(els.img, 0, 0);
        c.toBlob(b => resolve(b), "image/png");
      } catch(_){ resolve(null); }
    });
  }
  function currentName(blob){
    const type = String(blob && blob.type || "").toLowerCase();
    const ext = type.indexOf("svg") >= 0 ? "svg" : (type.indexOf("jpeg") >= 0 ? "jpg" : "png");
    const base = String(items[index] && items[index].alt || "그림").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 40) || "그림";
    return base.replace(/\s+/g, "_") + "." + ext;
  }
  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveCurrent(){
    const blob = await currentBlob();
    if (!blob){ if (typeof toast === "function") toast("이 그림은 저장하지 못했어요.", 2400, { type:"error" }); return; }
    const name = currentName(blob);
    try {
      if (typeof saveImageBlobUnified === "function") await saveImageBlobUnified(blob, { name }, name);
      else downloadBlob(blob, name);
    } catch(_){ downloadBlob(blob, name); }
  }
  async function sendToMemo(){
    const blob = await currentBlob();
    if (!blob){ if (typeof toast === "function") toast("이 그림은 메모로 보내지 못했어요.", 2400, { type:"error" }); return; }
    const name = currentName(blob);
    try {
      if (typeof window.addImagesToScratchpad === "function"){
        await window.addImagesToScratchpad([new File([blob], name, { type:blob.type || "image/png" })], { name:items[index].alt || "그림" });
        if (typeof toast === "function") toast("그림을 메모에 넣었어요.", 1900, { type:"success" });
      } else await saveCurrent();
    } catch(_){ if (typeof toast === "function") toast("메모로 보내지 못했어요.", 2400, { type:"error" }); }
  }

  // ── 클릭 위임 ───────────────────────────────────────────────────────
  function groupOf(img){
    const host = img.parentElement;
    const found = host ? [...host.querySelectorAll(ZOOM_SELECTOR)] : [];
    const list = (found.length ? found : [img]).filter(el => el.src);
    const at = list.indexOf(img);
    const grouped = list.map(el => ({ src:el.src, alt:el.alt || "" }));
    return { items:grouped.length ? grouped : [{ src:img.src, alt:img.alt || "" }], index:at < 0 ? 0 : at };
  }
  document.addEventListener("click", (e) => {
    if (modal && !modal.hidden) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const img = t.closest(ZOOM_SELECTOR);
    if (!img || !img.src) return;
    const group = groupOf(img);
    open(group.items, group.index);
  }, true);   // 캡처 단계 — 노트북 셀 등 중간에서 클릭 전파를 끊는 곳이 있어도 확대는 열려야 한다
  document.addEventListener("keydown", (e) => {   // 키보드만 쓰는 경우: 그림에 초점이 있을 때 Enter·Space
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = document.activeElement;
    if (!t || !t.matches || !t.matches(ZOOM_SELECTOR)) return;
    e.preventDefault();
    const group = groupOf(t);
    open(group.items, group.index);
  }, true);

  window.openImageLightbox = open;
})();
