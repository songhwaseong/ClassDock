"use strict";

/* ===== 이미지 미리보기 + 가벼운 편집 ===== */
async function loadImage(file, options={}){
  const doc = makeDoc("image", file.name, options);
  doc.sourceFile = file;
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    await renderImage(doc.sourceFile || file, host);
  };
  refreshChrome();
  activateIfIdle(doc, options);
  return doc;
}

// 범용 백업: 알 수 없는 확장자라도 내용이 텍스트면 코드뷰(줄번호)로 열고, 바이너리면 미지원 안내.
/* ===== Folder image gallery ===== */
function galleryFolderContainsDoc(folderNode, doc, includeChildren){
  if (!folderNode || !doc) return false;
  if (!includeChildren) return doc.parentId === folderNode.nodeId;
  let parentId = doc.parentId;
  while (parentId){
    if (parentId === folderNode.nodeId) return true;
    const parent = navNodes.find(node => node.nodeId === parentId);
    if (!parent || parent.parentId === parentId) break;
    parentId = parent.parentId;
  }
  return false;
}

function folderGalleryImageDocs(folderNode, includeChildren){
  return docs
    .filter(doc => doc.kind === "image" && doc.sourceFile && galleryFolderContainsDoc(folderNode, doc, includeChildren))
    .sort((a, b) => String(a.relPath || a.name).localeCompare(String(b.relPath || b.name), "ko", { numeric:true, sensitivity:"base" }));
}

function imageGalleryFolderImageCount(folderNode, includeChildren){
  return folderGalleryImageDocs(folderNode, includeChildren).length;
}

function folderGalleryPdfDocs(folderNode, includeChildren){
  return docs
    .filter(doc => doc.kind === "pdf" && galleryFolderContainsDoc(folderNode, doc, includeChildren))
    .sort((a, b) => String(a.relPath || a.name).localeCompare(String(b.relPath || b.name), "ko", { numeric:true, sensitivity:"base" }));
}

function pdfGalleryFolderPdfCount(folderNode, includeChildren){
  return folderGalleryPdfDocs(folderNode, includeChildren).length;
}

function openFolderImageGallery(folderNode, includeChildren){
  const imageDocs = folderGalleryImageDocs(folderNode, includeChildren);
  if (!imageDocs.length){
    toast(includeChildren ? "이 폴더와 하위 폴더에 표시할 이미지가 없어요." : "이 폴더에 바로 들어 있는 이미지가 없어요.", 2600);
    return null;
  }
  const galleryKey = folderNode.nodeId + ":" + (includeChildren ? "all" : "direct");
  const existing = docs.find(doc => doc.kind === "image-gallery" && doc.galleryKey === galleryKey);
  if (existing){ setActiveDoc(existing.id); return existing; }

  const folderPath = (folderNode.newPythonContext && folderNode.newPythonContext.dir) || "";
  const prefix = folderPath ? folderPath.replace(/\\/g, "/").replace(/\/+$/, "") + "/" : "";
  const items = imageDocs.map(source => {
    const fullPath = String(source.relPath || source.name || "").replace(/\\/g, "/");
    return {
      docId: source.id,
      file: source.sourceFile,
      name: source.name,
      relPath: fullPath,
      labelPath: prefix && fullPath.indexOf(prefix) === 0 ? fullPath.slice(prefix.length) : fullPath
    };
  });
  const suffix = includeChildren ? "이미지 전체" : "이미지";
  const doc = makeDoc("image-gallery", folderNode.name + " · " + suffix, { parentId:folderNode.nodeId });
  doc.galleryKey = galleryKey;
  doc.galleryItems = items;
  doc.galleryState = { mode:"grid", index:0 };
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    renderFolderImageGallery(doc, host);
  };
  refreshChrome();
  activateIfIdle(doc, {});
  return doc;
}

function openFolderPdfGallery(folderNode, includeChildren){
  const pdfDocs = folderGalleryPdfDocs(folderNode, includeChildren);
  if (!pdfDocs.length){
    toast(includeChildren ? "이 폴더와 하위 폴더에 표시할 PDF가 없어요." : "이 폴더에 바로 들어 있는 PDF가 없어요.", 2600);
    return null;
  }
  const galleryKey = folderNode.nodeId + ":pdf:" + (includeChildren ? "all" : "direct");
  const existing = docs.find(doc => doc.kind === "pdf-gallery" && doc.galleryKey === galleryKey);
  if (existing){ setActiveDoc(existing.id); return existing; }

  const folderPath = (folderNode.newPythonContext && folderNode.newPythonContext.dir) || "";
  const prefix = folderPath ? folderPath.replace(/\\/g, "/").replace(/\/+$/, "") + "/" : "";
  const items = pdfDocs.map(source => {
    const fullPath = String(source.relPath || source.name || "").replace(/\\/g, "/");
    return {
      docId: source.id,
      name: source.name,
      relPath: fullPath,
      labelPath: prefix && fullPath.indexOf(prefix) === 0 ? fullPath.slice(prefix.length) : fullPath
    };
  });
  const suffix = includeChildren ? "PDF 전체" : "PDF";
  const doc = makeDoc("pdf-gallery", folderNode.name + " · " + suffix, { parentId:folderNode.nodeId });
  doc.galleryKey = galleryKey;
  doc.galleryItems = items;
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    renderFolderPdfGallery(doc, host);
  };
  refreshChrome();
  activateIfIdle(doc, {});
  return doc;
}

function gallerySetImageSource(img, file){
  const url = URL.createObjectURL(file);
  const release = () => URL.revokeObjectURL(url);
  img.addEventListener("load", release, { once:true });
  img.addEventListener("error", release, { once:true });
  img.src = url;
}

function renderFolderImageGallery(doc, host){
  const items = doc.galleryItems || [];
  const state = doc.galleryState || (doc.galleryState = { mode:"grid", index:0 });
  state.index = Math.max(0, Math.min(items.length - 1, Number(state.index) || 0));
  const shell = document.createElement("section"); shell.className = "image-gallery"; shell.tabIndex = 0;
  const bar = document.createElement("div"); bar.className = "image-gallery-bar";
  const gridButton = document.createElement("button"); gridButton.type = "button"; gridButton.textContent = "▦ 여러 장 보기";
  gridButton.classList.toggle("active", state.mode === "grid");
  gridButton.title = "썸네일을 격자로 봅니다";
  gridButton.addEventListener("click", () => { state.mode = "grid"; paint(); });
  const count = document.createElement("span"); count.className = "image-gallery-count";
  const prev = document.createElement("button"); prev.type = "button"; prev.textContent = "‹ 이전"; prev.title = "이전 이미지";
  const next = document.createElement("button"); next.type = "button"; next.textContent = "다음 ›"; next.title = "다음 이미지";
  prev.addEventListener("click", () => { if (state.index > 0){ state.index--; state.mode = "single"; paint(); } });
  next.addEventListener("click", () => { if (state.index < items.length - 1){ state.index++; state.mode = "single"; paint(); } });
  const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "편집기로 열기"; edit.title = "현재 이미지를 기존 이미지 편집기로 엽니다";
  edit.addEventListener("click", () => {
    const item = items[state.index]; if (!item) return;
    const source = docs.find(candidate => candidate.id === item.docId);
    if (source) setActiveDoc(source.id);
    else loadImage(item.file, { parentId:doc.parentId, relPath:item.relPath });
  });
  bar.append(gridButton, prev, count, next, edit);
  const body = document.createElement("div"); body.className = "image-gallery-body";
  shell.append(bar, body); host.appendChild(shell);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);

  let gridIo = null;   // 격자 썸네일 지연 로더 — 다시 그릴 때 이전 관찰자를 정리한다
  const paint = () => {
    if (gridIo){ gridIo.disconnect(); gridIo = null; }
    body.innerHTML = "";
    const single = state.mode === "single";
    gridButton.classList.toggle("active", !single);
    prev.hidden = next.hidden = edit.hidden = !single;
    count.textContent = single ? (state.index + 1) + " / " + items.length : items.length + "장";
    prev.disabled = !single || state.index === 0;
    next.disabled = !single || state.index >= items.length - 1;
    if (!single){
      const grid = document.createElement("div"); grid.className = "image-gallery-grid";
      // 수천 장 폴더: 화면 근처 카드만 이미지 URL 을 만들어 디코딩한다(전체 즉시 로드 방지)
      gridIo = (typeof IntersectionObserver !== "undefined")
        ? new IntersectionObserver((entries) => {
            for (const ent of entries){
              if (!ent.isIntersecting) continue;
              const img = ent.target;
              gridIo.unobserve(img);
              const file = img.__galleryFile;
              if (file){ img.__galleryFile = null; gallerySetImageSource(img, file); }
            }
          }, { rootMargin: "900px 0px" })
        : null;
      items.forEach((item, index) => {
        const card = document.createElement("button"); card.type = "button"; card.className = "image-gallery-card";
        card.title = item.labelPath || item.name; card.setAttribute("aria-label", item.name + " 한 장 보기");
        const frame = document.createElement("span"); frame.className = "image-gallery-thumb";
        const image = document.createElement("img"); image.loading = "lazy"; image.alt = "";
        if (gridIo){ image.__galleryFile = item.file; gridIo.observe(image); }
        else gallerySetImageSource(image, item.file);
        frame.appendChild(image);
        const name = document.createElement("strong"); name.textContent = item.name;
        const pathLabel = item.labelPath && item.labelPath !== item.name ? item.labelPath : "";
        card.append(frame, name);
        if (pathLabel){
          const path = document.createElement("small"); path.textContent = pathLabel;
          card.appendChild(path);
        }
        card.addEventListener("click", () => { state.index = index; state.mode = "single"; paint(); shell.focus(); });
        grid.appendChild(card);
      });
      body.appendChild(grid);
      return;
    }
    const item = items[state.index];
    const singleView = document.createElement("div"); singleView.className = "image-gallery-single";
    const image = document.createElement("img"); image.alt = item.name; image.draggable = false;
    gallerySetImageSource(image, item.file);
    const caption = document.createElement("div"); caption.className = "image-gallery-caption";
    const name = document.createElement("strong"); name.textContent = item.name;
    const pathLabel = item.labelPath && item.labelPath !== item.name ? item.labelPath : "";
    caption.appendChild(name);
    if (pathLabel){
      const path = document.createElement("span"); path.textContent = pathLabel;
      caption.appendChild(path);
    }
    singleView.append(image, caption); body.appendChild(singleView);
  };
  shell.addEventListener("keydown", (event) => {
    if (state.mode !== "single" || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" && state.index > 0){ event.preventDefault(); prev.click(); }
    if (event.key === "ArrowRight" && state.index < items.length - 1){ event.preventDefault(); next.click(); }
  });
  paint();
}

/* ===== Folder PDF gallery ===== */
function renderFolderPdfGallery(doc, host){
  const items = doc.galleryItems || [];
  const shell = document.createElement("section"); shell.className = "image-gallery pdf-gallery"; shell.tabIndex = 0;
  const bar = document.createElement("div"); bar.className = "image-gallery-bar";
  const label = document.createElement("strong"); label.textContent = "▦ PDF 모아보기"; label.title = "PDF 첫 페이지를 격자로 봅니다";
  const count = document.createElement("span"); count.className = "image-gallery-count"; count.textContent = items.length + "개";
  bar.append(label, count);
  const body = document.createElement("div"); body.className = "image-gallery-body";
  const grid = document.createElement("div"); grid.className = "image-gallery-grid";
  body.appendChild(grid); shell.append(bar, body); host.appendChild(shell);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);

  let disposed = false;
  let observer = null;
  let rendering = 0;
  const pending = [];
  const loadingTasks = new Set();
  const maxConcurrent = 2;
  const alive = () => !disposed && !doc.closed && shell.isConnected;
  const cleanup = () => {
    disposed = true;
    pending.length = 0;
    if (observer) observer.disconnect();
    loadingTasks.forEach(task => { try { task.destroy(); } catch(e){} });
    loadingTasks.clear();
  };
  doc.cleanupFns = doc.cleanupFns || [];
  doc.cleanupFns.push(cleanup);

  const renderThumbnail = async job => {
    const source = docs.find(candidate => candidate.id === job.item.docId);
    let loadingTask = null, pdf = null, page = null;
    try {
      if (!alive() || !job.frame.isConnected) return;
      if (!source || source.closed || !source.pdfBytes) throw new Error("PDF source unavailable");
      if (typeof pdfjsLib === "undefined") throw new Error("PDF renderer unavailable");
      if (typeof ensureWorker === "function") await ensureWorker();
      if (!alive() || !job.frame.isConnected) return;
      loadingTask = pdfjsLib.getDocument({ data:new Uint8Array(source.pdfBytes.slice(0)), disableFontFace:true, useSystemFonts:false });
      loadingTasks.add(loadingTask);
      pdf = await loadingTask.promise;
      if (!alive() || !job.frame.isConnected) return;
      page = await pdf.getPage(1);
      const base = page.getViewport({ scale:1 });
      const cssScale = Math.min(220 / Math.max(1, base.width), 150 / Math.max(1, base.height), 0.32);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale:cssScale * dpr });
      const canvas = job.canvas;
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      canvas.style.width = Math.max(1, Math.round(viewport.width / dpr)) + "px";
      canvas.style.height = Math.max(1, Math.round(viewport.height / dpr)) + "px";
      await page.render({ canvasContext:canvas.getContext("2d"), viewport }).promise;
      if (!alive() || !job.frame.isConnected) return;
      job.placeholder.hidden = true;
      canvas.hidden = false;
      const pathLabel = job.item.labelPath && job.item.labelPath !== job.item.name ? job.item.labelPath : "";
      job.detail.textContent = (pathLabel ? pathLabel + " · " : "") + pdf.numPages + "쪽";
      job.card.title = (job.item.labelPath || job.item.name) + " · " + pdf.numPages + "쪽";
      job.card.removeAttribute("aria-busy");
    } catch(e){
      if (alive() && job.frame.isConnected){
        job.placeholder.textContent = "PDF";
        job.detail.textContent = "미리보기를 만들지 못했어요.";
        job.card.removeAttribute("aria-busy");
      }
    } finally {
      if (page && typeof page.cleanup === "function"){ try { page.cleanup(); } catch(e){} }
      if (loadingTask) loadingTasks.delete(loadingTask);
      if (pdf && typeof pdf.destroy === "function"){ try { await pdf.destroy(); } catch(e){} }
      else if (loadingTask && typeof loadingTask.destroy === "function"){ try { await loadingTask.destroy(); } catch(e){} }
    }
  };
  const pump = () => {
    while (alive() && rendering < maxConcurrent && pending.length){
      const job = pending.shift();
      if (!job.frame.isConnected) continue;
      rendering++;
      renderThumbnail(job).finally(() => { rendering--; pump(); });
    }
  };
  const queue = job => { if (alive()){ pending.push(job); pump(); } };
  observer = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          queue(entry.target.__pdfGalleryJob);
        });
      }, { rootMargin:"420px 0px" })
    : null;

  items.forEach(item => {
    const card = document.createElement("button"); card.type = "button"; card.className = "image-gallery-card pdf-gallery-card";
    card.title = item.labelPath || item.name; card.setAttribute("aria-label", item.name + " PDF 열기"); card.setAttribute("aria-busy", "true");
    const frame = document.createElement("span"); frame.className = "image-gallery-thumb pdf-gallery-thumb";
    const placeholder = document.createElement("span"); placeholder.className = "pdf-gallery-placeholder"; placeholder.textContent = "PDF";
    const canvas = document.createElement("canvas"); canvas.hidden = true; canvas.setAttribute("aria-hidden", "true");
    frame.append(placeholder, canvas);
    const name = document.createElement("strong"); name.textContent = item.name;
    const detail = document.createElement("small"); detail.textContent = "첫 페이지 미리보기 준비 중…";
    const job = { item, card, frame, canvas, placeholder, detail };
    frame.__pdfGalleryJob = job;
    card.append(frame, name, detail);
    card.addEventListener("click", () => {
      const source = docs.find(candidate => candidate.id === item.docId);
      if (source) setActiveDoc(source.id);
    });
    grid.appendChild(card);
    if (observer) observer.observe(frame); else queue(job);
  });
}

async function loadText(file, options={}){
  const textLike = typeof isLikelyTextFile === "function" ? await isLikelyTextFile(file) : true;
  if (!textLike){ if (!options.bulk) toast("지원하지 않는 형식: " + file.name, 2500); return; }
  const doc = makeDoc("office", file.name, options);
  doc.sourceFile = file;
  doc.isTextFile = true;
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    await renderCode(file, host, "", "text");
  };
  refreshChrome();
  activateIfIdle(doc, options);
  return doc;
}

// .model/.npy 학습 산출물은 텍스트로 해석하지 않는다. 원본 File을 유지해 작업공간과
// 다운로드에서 동일한 바이트를 보존한다.
async function loadBinaryAsset(file, options={}){
  const doc = makeDoc("binary", file.name, options);
  doc.sourceFile = file;
  doc.binaryAsset = true;
  doc.render = async () => {
    const host = doc.el;
    host.innerHTML = "";
    host.scrollTop = 0;
    const panel = document.createElement("section");
    panel.className = "binary-asset-card";
    const icon = document.createElement("div");
    icon.className = "binary-asset-icon";
    icon.textContent = fileExtOf(file.name).toUpperCase() || "BIN";
    const title = document.createElement("h2");
    title.textContent = file.name;
    const detail = document.createElement("p");
    detail.textContent = `${humanSize(file.size || 0)} · 이진 파일 · 텍스트 편집은 제공하지 않습니다.`;
    const help = document.createElement("p");
    help.className = "binary-asset-help";
    help.textContent = fileExtOf(file.name).toLowerCase() === "model"
      ? "Gensim 등에서 저장한 모델 원본을 손상 없이 보관합니다. 같이 생성된 .npy 보조 파일도 함께 유지하세요."
      : "NumPy 배열 원본을 손상 없이 보관합니다.";
    const download = document.createElement("button");
    download.type = "button";
    download.className = "btn primary";
    download.textContent = "원본 다운로드";
    download.addEventListener("click", () => {
      const source = doc.sourceFile || file;
      const url = URL.createObjectURL(source);
      const link = document.createElement("a");
      link.href = url; link.download = doc.name || file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    panel.append(icon, title, detail, help, download);
    host.appendChild(panel);
  };
  refreshChrome();
  activateIfIdle(doc, options);
  return doc;
}

function renderImage(file, host){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      setupImageEditor(file, host, img, docs.find(doc => doc.el === host) || null);
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지 로드 실패")); };
    img.src = url;
  });
}

function setupImageEditor(file, host, img, ownerDoc=null){
  const state = {
    img, rotation: 0, flipX: false, flipY: false, zoom: null,
    cropMode: false, cropRect: null, cropRatio: null, dragStart: null, output: null,
    adjust: { brightness:100, contrast:100, saturate:100, sharpen:0, denoise:0 },
    // 표시(주석): 출력 캔버스 픽셀 좌표로 저장 — 저장 시 renderForDisplay 가 함께 굽는다.
    shapes: [], annTool: null, annColor: "#ef4444", annWidth: 4, annDraft: null,
    annSelected: null, annMove: null,                       // 선택 도구: 선택된 표시와 이동 드래그 상태
    jpgQuality: 90
  };
  const wrap = document.createElement("div"); wrap.className = "img-editor";
  const bar = document.createElement("div"); bar.className = "img-tools";
  const stage = document.createElement("div"); stage.className = "img-stage";
  const canvas = document.createElement("canvas"); canvas.className = "img-view"; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", file.name);
  const cropBox = document.createElement("div"); cropBox.className = "img-crop-box"; cropBox.hidden = true;
  stage.append(canvas, cropBox);
  wrap.append(bar, stage);
  host.appendChild(wrap);

  let imageRecoveryTimer = 0;
  const markImageDirty = () => {
    if (!ownerDoc || typeof markDocumentDirty !== "function") return;
    markDocumentDirty(ownerDoc);
    clearTimeout(imageRecoveryTimer);
    imageRecoveryTimer = setTimeout(async () => {
      if (!ownerDoc.hasUnsavedEdits || typeof saveDocumentRecoverySnapshot !== "function") return;
      try {
        const flattened = renderForDisplay(state);
        const blob = await new Promise(resolve => flattened.toBlob(resolve, "image/png"));
        if (blob) await saveDocumentRecoverySnapshot(ownerDoc, blob, "image/png");
      } catch(error){ console.warn("image recovery snapshot skipped:", error); }
    }, 1200);
  };
  if (ownerDoc){
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => clearTimeout(imageRecoveryTimer));
  }

  const zoomLabel = document.createElement("span"); zoomLabel.className = "img-zoom-label";
  const mkBtn = (text, title, fn, cls) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = text; b.title = title; b.setAttribute("aria-label", title);
    if (cls) b.className = cls;
    b.addEventListener("click", fn);
    return b;
  };
  const cloneShapes = (shapes) => JSON.parse(JSON.stringify(shapes || []));
  const snapshot = () => ({ img: state.img, rotation: state.rotation, flipX: state.flipX, flipY: state.flipY, adjust: { ...state.adjust }, shapes: cloneShapes(state.shapes) });
  const restoreSnapshot = (snap) => {
    state.img = snap.img; state.rotation = snap.rotation; state.flipX = snap.flipX; state.flipY = snap.flipY;
    if (snap.adjust) state.adjust = { ...snap.adjust };
    state.shapes = cloneShapes(snap.shapes); state.annDraft = null;
    state.annSelected = null; state.annMove = null;        // 복원된 배열의 도형과 참조가 어긋나므로 선택 해제
    state.cropRect = null; state.dragStart = null; state.cropMode = false;
    cropBtn.classList.remove("active"); stage.classList.remove("crop-mode");
    syncCropUi();
    syncAdjustUI();
    redraw();
  };
  // 표시 도형은 출력(화면 픽셀) 좌표라, 회전·뒤집기·자르기·크기 조절 때 좌표도 같은 변환을 따라간다.
  const mapShapePoints = (fn) => {
    for (const s of state.shapes){
      if (s.points){ s.points = s.points.map(p => fn(p)); continue; }
      if (s.kind === "text"){ const p = fn({ x: s.x, y: s.y }); s.x = p.x; s.y = p.y; continue; }
      const a = fn({ x: s.x, y: s.y }), b = fn({ x: s.x + s.w, y: s.y + s.h });
      s.x = Math.min(a.x, b.x); s.y = Math.min(a.y, b.y); s.w = Math.abs(a.x - b.x); s.h = Math.abs(a.y - b.y);
    }
  };
  const transformShapesGeo = (op) => {   // op: cw(오른쪽 90) | ccw(왼쪽 90) | fx(좌우) | fy(상하) — 변환 전 출력 기준
    if (!state.shapes.length || !state.output) return;
    const w = state.output.width, h = state.output.height;
    if (op === "cw") mapShapePoints(p => ({ x: h - p.y, y: p.x }));
    else if (op === "ccw") mapShapePoints(p => ({ x: p.y, y: w - p.x }));
    else if (op === "fx") mapShapePoints(p => ({ x: w - p.x, y: p.y }));
    else if (op === "fy") mapShapePoints(p => ({ x: p.x, y: h - p.y }));
  };
  const scaleShapes = (f) => {
    if (!state.shapes.length || !(f > 0) || f === 1) return;
    for (const s of state.shapes){
      if (s.points) s.points = s.points.map(p => ({ x: p.x * f, y: p.y * f }));
      if (s.x != null){ s.x *= f; s.y *= f; }
      if (s.w != null){ s.w *= f; s.h *= f; }
      if (s.width) s.width = Math.max(1, s.width * f);
      if (s.size) s.size = Math.max(6, s.size * f);
    }
  };
  const shiftShapes = (dx, dy) => { mapShapePoints(p => ({ x: p.x + dx, y: p.y + dy })); };
  const history = MNEditHistory.create({
    limit: MNEditHistory.LIMITS.image,
    capture: snapshot,
    apply: restoreSnapshot,
    // img 는 같은 이미지 객체면 같은 것으로 본다(자르기·확대는 새 이미지를 만든다). 나머지는 값 비교.
    isEqual: (a, b) => a.img === b.img && a.rotation === b.rotation && a.flipX === b.flipX && a.flipY === b.flipY
      && JSON.stringify(a.adjust) === JSON.stringify(b.adjust)
      && JSON.stringify(a.shapes) === JSON.stringify(b.shapes),
    onChange: () => updateHistoryButtons(),
  });
  // 편집을 마친 뒤 호출한다. 실제로 달라졌을 때만 한 단계로 기록된다.
  const recordEdit = () => { if (history.commit()) markImageDirty(); };
  const undoBtn = mkBtn("되돌리기", "이미지 편집 되돌리기", () => { if (history.undo()) markImageDirty(); });
  const redoBtn = mkBtn("다시", "이미지 편집 다시 실행", () => { if (history.redo()) markImageDirty(); });
  const updateHistoryButtons = () => {
    undoBtn.disabled = !history.canUndo();
    redoBtn.disabled = !history.canRedo();
  };
  const syncCropUi = () => {
    cropRatioWrap.hidden = !state.cropMode;
    cropBox.classList.toggle("ratio-locked", !!state.cropRatio);
  };
  const setAnnToolOff = () => {
    if (!state.annTool) return;
    state.annTool = null; state.annDraft = null;
    const hadSelection = !!state.annSelected;
    state.annSelected = null; state.annMove = null;
    for (const k in annToolBtns) annToolBtns[k].classList.remove("active");
    if (hadSelection) redraw();                            // 남아 있는 선택 점선 제거
  };
  const cropBtn = mkBtn("자르기", "자르기 영역 선택", () => {
    state.cropMode = !state.cropMode;
    if (state.cropMode) setAnnToolOff();             // 자르기와 표시 도구는 동시에 켜지 않음
    cropBtn.classList.toggle("active", state.cropMode);
    stage.classList.toggle("crop-mode", state.cropMode);
    syncCropUi();
    applyCursor();                                   // 모드에 맞게 커서 갱신(+ 십자 ↔ 돋보기)
    if (!state.cropMode){ state.dragStart = null; updateCropBox(); }
  });
  const applyCropBtn = mkBtn("적용", "선택한 영역으로 자르기", async () => {
    if (!state.cropRect){ toast("자를 영역을 먼저 드래그하세요.", 1800); return; }
    const crop = state.cropRect;
    const c = renderEditedImage(state, crop);
    const next = await imageFromDataUrl(c.toDataURL("image/png"));
    shiftShapes(-Math.max(0, Math.floor(crop.x)), -Math.max(0, Math.floor(crop.y)));   // 표시 좌표를 잘린 기준으로 이동
    state.img = next; state.rotation = 0; state.flipX = false; state.flipY = false; state.cropRect = null; state.cropMode = false;
    cropBtn.classList.remove("active"); stage.classList.remove("crop-mode");
    syncCropUi();
    redraw(); recordEdit();
  });
  // 자르기 비율 프리셋 — 자르기 모드일 때만 표시
  const cropRatioWrap = document.createElement("span"); cropRatioWrap.className = "img-crop-ratios"; cropRatioWrap.hidden = true;
  const ratioBtns = [];
  const refitCropToRatio = () => {
    const r = state.cropRatio, c = state.cropRect;
    if (!r || !c || !state.output) return;
    let w = c.w, h = w / r;
    if (c.y + h > state.output.height){ h = state.output.height - c.y; w = h * r; }
    if (c.x + w > state.output.width){ w = state.output.width - c.x; h = w / r; }
    state.cropRect = (w >= 4 && h >= 4) ? { x: c.x, y: c.y, w, h } : c;
    updateCropBox();
  };
  const mkRatio = (label, val) => {
    const b = mkBtn(label, "자르기 비율 " + label, () => {
      state.cropRatio = val;
      ratioBtns.forEach(x => x.classList.toggle("active", x === b));
      syncCropUi();
      refitCropToRatio();
    });
    ratioBtns.push(b);
    return b;
  };
  const freeRatioBtn = mkRatio("자유", null);
  cropRatioWrap.append(freeRatioBtn, mkRatio("1:1", 1), mkRatio("4:3", 4 / 3), mkRatio("16:9", 16 / 9));
  freeRatioBtn.classList.add("active");
  const dimsLabel = document.createElement("span"); dimsLabel.className = "img-dims"; dimsLabel.title = "현재 이미지 픽셀 크기";
  bar.append(
    undoBtn,
    redoBtn,
    mkBtn("↶", "왼쪽으로 90도 회전", () => { transformShapesGeo("ccw"); state.rotation = (state.rotation + 270) % 360; state.cropRect = null; redraw(); recordEdit(); }),
    mkBtn("↷", "오른쪽으로 90도 회전", () => { transformShapesGeo("cw"); state.rotation = (state.rotation + 90) % 360; state.cropRect = null; redraw(); recordEdit(); }),
    mkBtn("좌우", "좌우 뒤집기", () => { transformShapesGeo("fx"); state.flipX = !state.flipX; state.cropRect = null; redraw(); recordEdit(); }),
    mkBtn("상하", "상하 뒤집기", () => { transformShapesGeo("fy"); state.flipY = !state.flipY; state.cropRect = null; redraw(); recordEdit(); }),
    cropBtn,
    applyCropBtn,
    cropRatioWrap,
    mkBtn("PNG", "현재 이미지를 PNG로 저장", () => downloadEditedImage(state, file, "png", ownerDoc)),
    mkBtn("JPG", "현재 이미지를 JPG로 저장", () => downloadEditedImage(state, file, "jpeg", ownerDoc)),
    mkBtn("PDF", "현재 이미지를 PDF로 저장", () => downloadImagePdf(state, file)),
    mkBtn("📷 메모로", "현재 이미지를 메모에 넣기 — 자르기 영역을 선택해 두었으면 그 부분만", () => sendImageToMemo(state, file)),
    mkBtn("🔠 글자 추출", "이미지 속 글자를 인식(OCR)해 복사·메모로 — 자르기 영역이 있으면 그 부분만", () => extractImageText(state, file)),
    mkBtn("-", "축소", () => { state.zoom = Math.max(0.1, (state.zoom === null ? 1 : state.zoom) - 0.25); redraw(); }, "img-tool-compact"),
    zoomLabel,
    mkBtn("+", "확대", () => { state.zoom = Math.min(8, (state.zoom === null ? 1 : state.zoom) + 0.25); redraw(); }, "img-tool-compact"),
    mkBtn("맞춤", "화면에 맞추기", () => { state.zoom = null; redraw(); }),
    dimsLabel,
    mkBtn("초기화", "회전·뒤집기·자르기·표시·보정 모두 초기화", () => {
      state.rotation = 0; state.flipX = false; state.flipY = false; state.cropRect = null; state.cropMode = false; state.zoom = null;
      state.adjust = { brightness:100, contrast:100, saturate:100, sharpen:0, denoise:0 };
      state.shapes = []; state.annDraft = null; state.annSelected = null; state.annMove = null;
      state.img = img;
      cropBtn.classList.remove("active"); stage.classList.remove("crop-mode"); syncCropUi(); syncAdjustUI(); redraw(); recordEdit();
    })
  );

  // ===== 화질 보정 패널: 자동보정 · 슬라이더(밝기·대비·채도·선명도·노이즈) · 고화질 확대 =====
  const adjustPanel = document.createElement("div"); adjustPanel.className = "img-adjust"; adjustPanel.hidden = true;
  const sliderRefs = {};
  let rafPending = false;
  const scheduleRedraw = () => { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; redraw(); }); };
  const syncAdjustUI = () => {
    for (const key in sliderRefs){
      const r = sliderRefs[key], v = state.adjust[key];
      r.input.value = v; r.val.textContent = r.pct ? v + "%" : String(v);
    }
  };
  // 슬라이더는 드래그 중 값을 실시간으로 바꾸고 끝(change)에서 한 단계로 기록한다.
  // 직전 상태는 이미 히스토리의 현재 단계라, 따로 미리 떠 둘 필요가 없다.
  const commitAdjust = () => recordEdit();
  const mkSlider = (label, key, min, max, pct) => {
    const row = document.createElement("label"); row.className = "img-adj-row";
    const name = document.createElement("span"); name.className = "img-adj-name"; name.textContent = label;
    const input = document.createElement("input"); input.type = "range"; input.min = min; input.max = max; input.step = 1; input.value = state.adjust[key];
    const val = document.createElement("span"); val.className = "img-adj-val"; val.textContent = pct ? state.adjust[key] + "%" : String(state.adjust[key]);
    sliderRefs[key] = { input, val, pct };
    input.addEventListener("input", () => { state.adjust[key] = Number(input.value); val.textContent = pct ? input.value + "%" : input.value; scheduleRedraw(); });
    input.addEventListener("change", commitAdjust);
    row.append(name, input, val);
    return row;
  };
  const drawScaled = (src, dw, dh) => { const c = document.createElement("canvas"); c.width = dw; c.height = dh; const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, dw, dh); return c; };
  function upscaleCurrent(factor){
    const base = renderEditedImage(state);                // 기하변형만 적용된 베이스(보정은 라이브 유지)
    const nw = Math.round(base.width * factor), nh = Math.round(base.height * factor);
    if (Math.max(nw, nh) > 6000 || nw * nh > 24e6){ toast("너무 커집니다(최대 6000px). 더 작은 배율을 쓰세요.", 3000); return; }
    const c = (factor >= 4) ? drawScaled(drawScaled(base, base.width * 2, base.height * 2), nw, nh) : drawScaled(base, nw, nh);   // 4x는 2단계로(품질↑)
    imageFromDataUrl(c.toDataURL("image/png")).then(im => {
      scaleShapes(nw / base.width);
      state.img = im; state.rotation = 0; state.flipX = false; state.flipY = false; state.cropRect = null;
      redraw(); recordEdit(); toast(factor + "x 확대 완료 (" + nw + "×" + nh + ")", 2200);
    });
  }
  function downscaleCurrent(factor){
    const base = renderEditedImage(state);
    const nw = Math.round(base.width * factor), nh = Math.round(base.height * factor);
    if (Math.min(nw, nh) < 16){ toast("너무 작아집니다(최소 16px). 더 큰 배율을 쓰세요.", 2400); return; }
    let cur = base;                                       // 큰 폭 축소는 절반씩 줄여 품질을 지킨다
    while (cur.width / nw >= 2 && cur.height / nh >= 2)
      cur = drawScaled(cur, Math.max(nw, Math.round(cur.width / 2)), Math.max(nh, Math.round(cur.height / 2)));
    const c = drawScaled(cur, nw, nh);
    imageFromDataUrl(c.toDataURL("image/png")).then(im => {
      scaleShapes(nw / base.width);
      state.img = im; state.rotation = 0; state.flipX = false; state.flipY = false; state.cropRect = null;
      redraw(); recordEdit(); toast("크기 조절 완료 (" + nw + "×" + nh + ")", 2200, { type: "success" });
    });
  }
  const autoBtn = mkBtn("✨ 자동보정", "밝기·대비를 자동으로 맞추고 약하게 선명화", () => {
    const lv = computeAutoLevels(renderEditedImage(state));
    state.adjust.brightness = lv.brightness; state.adjust.contrast = lv.contrast;
    state.adjust.sharpen = Math.max(state.adjust.sharpen, 25);
    syncAdjustUI(); redraw(); recordEdit();
    toast("자동 보정 적용 — 슬라이더로 미세조정할 수 있어요", 2400);
  }, "img-adj-auto");
  const resetAdjBtn = mkBtn("보정 초기화", "밝기·대비·채도·선명도·노이즈를 기본값으로", () => {
    state.adjust = { brightness:100, contrast:100, saturate:100, sharpen:0, denoise:0 };
    syncAdjustUI(); redraw(); recordEdit();
  });
  const upWrap = document.createElement("span"); upWrap.className = "img-adj-row";
  const upLabel = document.createElement("span"); upLabel.className = "img-adj-name"; upLabel.textContent = "고화질 확대";
  upWrap.append(upLabel, mkBtn("2x", "2배 고화질 확대", () => upscaleCurrent(2)), mkBtn("4x", "4배 고화질 확대", () => upscaleCurrent(4)));
  // 크기 줄이기 — 과제 제출용 용량 축소(½·⅓ 또는 폭 직접 입력)
  const sizeWrap = document.createElement("span"); sizeWrap.className = "img-adj-row";
  const sizeLabel = document.createElement("span"); sizeLabel.className = "img-adj-name"; sizeLabel.textContent = "크기 줄이기";
  const widthInput = document.createElement("input"); widthInput.type = "number"; widthInput.min = "16"; widthInput.placeholder = "폭 px"; widthInput.className = "img-adj-width"; widthInput.title = "원하는 폭(픽셀)을 입력하고 적용";
  const widthApply = mkBtn("적용", "입력한 폭으로 크기 조절", () => {
    const t = Number(widthInput.value);
    if (!(t >= 16)){ toast("폭을 16px 이상 숫자로 입력하세요.", 2200); return; }
    const base = renderEditedImage(state);
    const f = t / base.width;
    if (f === 1) return;
    if (f > 1) upscaleCurrent(f); else downscaleCurrent(f);
    widthInput.value = "";
  });
  widthInput.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); widthApply.click(); } });
  sizeWrap.append(sizeLabel, mkBtn("½", "절반 크기로 축소", () => downscaleCurrent(0.5)), mkBtn("⅓", "3분의 1 크기로 축소", () => downscaleCurrent(1 / 3)), widthInput, widthApply);
  // JPG 저장 품질(파일 크기) — 보정값과 달리 되돌리기 대상은 아님
  const qWrap = document.createElement("span"); qWrap.className = "img-adj-row";
  const qName = document.createElement("span"); qName.className = "img-adj-name"; qName.textContent = "JPG 품질";
  const qInput = document.createElement("input"); qInput.type = "range"; qInput.min = "50"; qInput.max = "100"; qInput.step = "1"; qInput.value = state.jpgQuality;
  const qVal = document.createElement("span"); qVal.className = "img-adj-val"; qVal.textContent = state.jpgQuality + "%";
  qInput.addEventListener("input", () => { state.jpgQuality = Number(qInput.value); qVal.textContent = qInput.value + "%"; });
  qInput.title = "JPG로 저장할 때의 압축 품질(낮을수록 파일이 작아짐)";
  qWrap.append(qName, qInput, qVal);
  adjustPanel.append(
    autoBtn,
    mkSlider("밝기", "brightness", 0, 200, true),
    mkSlider("대비", "contrast", 0, 200, true),
    mkSlider("채도", "saturate", 0, 200, true),
    mkSlider("선명도", "sharpen", 0, 100, false),
    mkSlider("노이즈완화", "denoise", 0, 100, false),
    upWrap,
    sizeWrap,
    qWrap,
    resetAdjBtn
  );
  const adjustToggle = mkBtn("보정", "화질 보정·크기 조절 패널 열기/닫기", () => {
    adjustPanel.hidden = !adjustPanel.hidden;
    adjustToggle.classList.toggle("active", !adjustPanel.hidden);
  });

  // ===== 표시(주석) 패널: 펜·형광펜·화살표·사각형·텍스트·모자이크 — 저장 시 이미지에 함께 구워짐 =====
  const annPanel = document.createElement("div"); annPanel.className = "img-adjust img-annotate"; annPanel.hidden = true;
  const annToolBtns = {};
  const setAnnTool = (tool) => {
    state.annTool = state.annTool === tool ? null : tool;
    const hadSelection = !!state.annSelected;
    state.annSelected = null; state.annMove = null; state.annDraft = null;
    if (state.annTool && state.cropMode){                  // 표시 도구를 켜면 자르기 모드는 끔
      state.cropMode = false; state.dragStart = null;
      cropBtn.classList.remove("active"); stage.classList.remove("crop-mode");
      syncCropUi(); updateCropBox();
    }
    for (const k in annToolBtns) annToolBtns[k].classList.toggle("active", state.annTool === k);
    applyCursor();
    if (hadSelection) redraw();                            // 도구를 바꾸면 선택 점선 제거
  };
  const mkTool = (key, text, title) => { const b = mkBtn(text, title, () => setAnnTool(key)); annToolBtns[key] = b; return b; };
  const annColorRow = document.createElement("span"); annColorRow.className = "img-adj-row";
  const annColorName = document.createElement("span"); annColorName.className = "img-adj-name"; annColorName.textContent = "색";
  const annColorInput = document.createElement("input"); annColorInput.type = "color"; annColorInput.value = state.annColor; annColorInput.title = "표시 색상"; annColorInput.className = "img-ann-color";
  annColorInput.addEventListener("input", () => { state.annColor = annColorInput.value; });
  annColorRow.append(annColorName, annColorInput);
  const annWidthRow = document.createElement("span"); annWidthRow.className = "img-adj-row";
  const annWidthName = document.createElement("span"); annWidthName.className = "img-adj-name"; annWidthName.textContent = "굵기";
  const annWidthInput = document.createElement("input"); annWidthInput.type = "range"; annWidthInput.min = "1"; annWidthInput.max = "12"; annWidthInput.step = "1"; annWidthInput.value = state.annWidth;
  const annWidthVal = document.createElement("span"); annWidthVal.className = "img-adj-val"; annWidthVal.textContent = String(state.annWidth);
  annWidthInput.addEventListener("input", () => { state.annWidth = Number(annWidthInput.value); annWidthVal.textContent = annWidthInput.value; });
  annWidthRow.append(annWidthName, annWidthInput, annWidthVal);
  const annClearBtn = mkBtn("모두 지우기", "모든 표시를 지우기 (되돌리기 버튼으로 복구 가능)", () => {
    if (!state.shapes.length) return;
    state.shapes = []; state.annDraft = null; state.annSelected = null; state.annMove = null; redraw(); recordEdit();
  });
  const annHint = document.createElement("span"); annHint.className = "img-ann-hint";
  annHint.textContent = "드래그해 표시 · 텍스트는 클릭해 입력(넣은 뒤 바로 드래그로 이동) · 🖱 선택: 클릭해 잡고 드래그로 이동, Delete 삭제, 텍스트 더블클릭 수정";
  annPanel.append(
    mkTool("select", "🖱 선택", "표시를 클릭해 선택 → 드래그로 이동 · Delete 삭제 · 텍스트 더블클릭으로 수정"),
    mkTool("pen", "✏️ 펜", "펜으로 자유롭게 그리기"),
    mkTool("hl", "🖍️ 형광펜", "반투명 형광펜으로 강조"),
    mkTool("arrow", "→ 화살표", "드래그한 방향으로 화살표 그리기"),
    mkTool("rect", "▭ 사각형", "드래그한 영역에 테두리 사각형"),
    mkTool("text", "T 텍스트", "클릭한 위치에 글자 넣기"),
    mkTool("mosaic", "▦ 모자이크", "드래그한 영역을 모자이크로 가리기(이름·얼굴 등)"),
    annColorRow,
    annWidthRow,
    annClearBtn,
    annHint
  );
  const annToggle = mkBtn("✏️ 표시", "펜·화살표·텍스트·모자이크 표시 패널 열기/닫기", () => {
    annPanel.hidden = !annPanel.hidden;
    annToggle.classList.toggle("active", !annPanel.hidden);
    if (annPanel.hidden) setAnnToolOff();
    else if (!state.annTool) setAnnTool("pen");            // 패널을 열면 펜부터 바로 사용
    applyCursor();
  });
  bar.append(annToggle, adjustToggle);
  wrap.insertBefore(adjustPanel, stage);
  wrap.insertBefore(annPanel, stage);
  // 편집기 툴바·보정/표시 패널을 현재 UI 언어로 번역(이미지 본문 stage 는 텍스트가 없어 무해).
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") { window.MNI18N.translateTree(bar); window.MNI18N.translateTree(adjustPanel); window.MNI18N.translateTree(annPanel); }

  const canvasPoint = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(state.output.width, (ev.clientX - r.left) * state.output.width / r.width));
    const y = Math.max(0, Math.min(state.output.height, (ev.clientY - r.top) * state.output.height / r.height));
    return { x, y };
  };
  const setCropFromPoints = (a, b) => {
    let x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    let w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    if (state.cropRatio && w >= 4 && h >= 4){          // 비율 고정: 드래그 방향을 유지하며 큰 쪽에 맞춤
      const r = state.cropRatio;
      if (w / r >= h) h = w / r; else w = h * r;
      x = (b.x < a.x) ? a.x - w : a.x;
      y = (b.y < a.y) ? a.y - h : a.y;
      x = Math.max(0, x); y = Math.max(0, y);
      if (x + w > state.output.width){ w = state.output.width - x; h = w / r; }
      if (y + h > state.output.height){ h = state.output.height - y; w = h * r; }
    }
    state.cropRect = (w >= 4 && h >= 4) ? { x, y, w, h } : null;
    updateCropBox();
  };

  // ===== 표시(주석) 선택: 경계 상자·히트테스트 =====
  const annotationBounds = (s) => {
    if (s.kind === "text"){
      const size = s.size || 30;
      const ctx = canvas.getContext("2d");
      ctx.save(); ctx.font = "bold " + size + 'px system-ui, "Malgun Gothic", sans-serif';
      const lines = String(s.text || "").split("\n");
      let w = 0; for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
      ctx.restore();
      return { x: s.x, y: s.y, w: Math.max(8, w), h: Math.max(8, lines.length * size * 1.25) };
    }
    if (s.points){
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const p of s.points){ x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
      const pad = ((s.kind === "hl" ? s.width * 3 : s.width) || 2) / 2 + 3;
      return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
    }
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  };
  const shapeAt = (p) => {
    for (let i = state.shapes.length - 1; i >= 0; i--){   // 최근에 그린 것(위에 보이는 것)부터
      const s = state.shapes[i];
      if (s.kind === "pen" || s.kind === "hl" || s.kind === "arrow"){
        const r = ((s.kind === "hl" ? s.width * 3 : s.width) || 2) / 2 + 6;
        const pts = s.points || [];
        for (let j = 1; j < pts.length; j++) if (distToSegment(p, pts[j - 1], pts[j]) <= r) return s;
        continue;
      }
      const b = annotationBounds(s);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return s;
    }
    return null;
  };

  // ===== 표시(주석) 그리기 =====
  const addTextAt = async (p) => {
    const typed = await askText({ title: "텍스트 넣기", message: "이미지에 넣을 글자를 입력하세요.", placeholder: "예: 여기 확인!", okText: "넣기" });
    if (typed === null || !String(typed).trim()) return;
    const shape = { kind: "text", color: state.annColor, size: Math.round(14 + state.annWidth * 5), x: p.x, y: p.y, text: String(typed).trim() };
    state.shapes.push(shape);
    if (state.annTool !== "select") setAnnTool("select");  // 넣자마자 선택 도구로 전환 → 바로 드래그로 위치 조정
    state.annSelected = shape;
    redraw(); recordEdit();
    toast("텍스트를 넣었어요. 드래그로 위치를 옮길 수 있어요.", 2000);
  };
  const finishAnnDraft = () => {
    const d = state.annDraft; if (!d) return;
    state.annDraft = null;
    const ok = d.points
      ? (d.kind === "arrow"
        ? Math.hypot(d.points[1].x - d.points[0].x, d.points[1].y - d.points[0].y) >= 6
        : d.points.length >= 2)
      : (d.w >= 4 && d.h >= 4);
    if (ok){ delete d._ax; delete d._ay; state.shapes.push(d); }
    redraw(); if (ok) recordEdit();
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!state.output) return;
    if (state.cropMode){
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      state.dragStart = canvasPoint(e); setCropFromPoints(state.dragStart, state.dragStart);
      return;
    }
    if (!state.annTool) return;
    if (state.annTool === "select"){
      const p = canvasPoint(e);
      const hit = shapeAt(p);
      state.annSelected = hit;
      if (hit){
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        state.annMove = { start: p, orig: JSON.parse(JSON.stringify(hit)), moved: false };
      }
      redraw();                                            // 선택 점선 표시/해제
      return;
    }
    e.preventDefault();
    const p = canvasPoint(e);
    if (state.annTool === "text"){ addTextAt(p); return; }
    canvas.setPointerCapture(e.pointerId);
    const base = { color: state.annColor, width: state.annWidth };
    state.annDraft =
      state.annTool === "pen" ? { kind: "pen", ...base, points: [p] } :
      state.annTool === "hl" ? { kind: "hl", ...base, points: [p] } :
      state.annTool === "arrow" ? { kind: "arrow", ...base, points: [p, { ...p }] } :
      { kind: state.annTool, ...base, x: p.x, y: p.y, w: 0, h: 0, _ax: p.x, _ay: p.y };
    scheduleRedraw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (state.cropMode && state.dragStart){
      e.preventDefault(); setCropFromPoints(state.dragStart, canvasPoint(e));
      return;
    }
    if (state.annMove && state.annSelected){               // 선택한 표시 드래그 이동
      e.preventDefault();
      const p = canvasPoint(e);
      const dx = p.x - state.annMove.start.x, dy = p.y - state.annMove.start.y;
      if (!state.annMove.moved){
        if (Math.abs(dx) + Math.abs(dy) < 2) return;       // 짧은 클릭은 이동으로 치지 않음
        state.annMove.moved = true;
      }
      const s = state.annSelected, o = state.annMove.orig;
      if (s.points) s.points = o.points.map(q => ({ x: q.x + dx, y: q.y + dy }));
      if (o.x != null){ s.x = o.x + dx; s.y = o.y + dy; }
      scheduleRedraw();
      return;
    }
    if (!state.annDraft) return;
    e.preventDefault();
    const p = canvasPoint(e), d = state.annDraft;
    if (d.kind === "pen" || d.kind === "hl"){
      const last = d.points[d.points.length - 1];
      if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) >= 1.2) d.points.push(p);
    } else if (d.kind === "arrow"){
      d.points[1] = p;
    } else {
      d.x = Math.min(d._ax, p.x); d.y = Math.min(d._ay, p.y);
      d.w = Math.abs(p.x - d._ax); d.h = Math.abs(p.y - d._ay);
    }
    scheduleRedraw();
  });
  canvas.addEventListener("pointerup", () => {
    state.dragStart = null;
    const moved = !!(state.annMove && state.annMove.moved);
    state.annMove = null;
    finishAnnDraft();
    if (moved) recordEdit();                               // 드래그 이동 1회 = 되돌리기 1단계
  });
  canvas.addEventListener("pointercancel", () => { state.dragStart = null; state.annDraft = null; state.annMove = null; redraw(); });
  canvas.addEventListener("click", () => {
    if (state.cropMode || state.annTool) return;
    state.zoom = (state.zoom === null) ? 1 : null; redraw();
  });
  // 선택 도구에서 텍스트 더블클릭 → 내용 수정(빈 값으로 확정하면 삭제)
  canvas.addEventListener("dblclick", async (e) => {
    if (state.annTool !== "select") return;
    const s = shapeAt(canvasPoint(e));
    if (!s || s.kind !== "text") return;
    const typed = await askText({ title: "텍스트 수정", message: "내용을 고쳐 쓰세요. 비우고 확인하면 삭제됩니다.", value: s.text, okText: "수정" });
    if (typed === null) return;
    const next = String(typed).trim();
    if (next){ s.text = next; state.annSelected = s; }
    else { state.shapes = state.shapes.filter(x => x !== s); state.annSelected = null; }
    redraw(); recordEdit();
  });

  // ===== 자르기 상자 이동·모서리 핸들 리사이즈 =====
  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(dir => {
    const hd = document.createElement("div");
    hd.className = "img-crop-handle dir-" + dir; hd.dataset.dir = dir;
    cropBox.appendChild(hd);
  });
  let cropDrag = null;   // { mode:"move"|"resize", dir, start, rect }
  cropBox.addEventListener("pointerdown", (e) => {
    if (!state.cropMode || !state.cropRect || !state.output) return;
    e.preventDefault(); e.stopPropagation();
    cropBox.setPointerCapture(e.pointerId);
    const dir = (e.target.dataset && e.target.dataset.dir) || "";
    cropDrag = { mode: dir ? "resize" : "move", dir, start: canvasPoint(e), rect: { ...state.cropRect } };
  });
  cropBox.addEventListener("pointermove", (e) => {
    if (!cropDrag || !state.output) return;
    e.preventDefault();
    const p = canvasPoint(e), W = state.output.width, H = state.output.height, r0 = cropDrag.rect;
    if (cropDrag.mode === "move"){
      const x = Math.max(0, Math.min(W - r0.w, r0.x + p.x - cropDrag.start.x));
      const y = Math.max(0, Math.min(H - r0.h, r0.y + p.y - cropDrag.start.y));
      state.cropRect = { x, y, w: r0.w, h: r0.h };
    } else {
      let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
      const d = cropDrag.dir;
      if (d.includes("w")) x1 = p.x; if (d.includes("e")) x2 = p.x;
      if (d.includes("n")) y1 = p.y; if (d.includes("s")) y2 = p.y;
      let nx = Math.min(x1, x2), ny = Math.min(y1, y2), nw = Math.abs(x2 - x1), nh = Math.abs(y2 - y1);
      if (state.cropRatio){                                 // 비율 고정: 반대 모서리를 앵커로 유지
        const r = state.cropRatio;
        if (nw / r >= nh) nh = nw / r; else nw = nh * r;
        const ax = d.includes("w") ? Math.max(x1, x2) : Math.min(x1, x2);
        const ay = d.includes("n") ? Math.max(y1, y2) : Math.min(y1, y2);
        nx = d.includes("w") ? ax - nw : ax;
        ny = d.includes("n") ? ay - nh : ay;
      }
      nx = Math.max(0, nx); ny = Math.max(0, ny);
      nw = Math.min(nw, W - nx); nh = Math.min(nh, H - ny);
      if (state.cropRatio){ const r = state.cropRatio; if (nw / r <= nh) nh = nw / r; else nw = nh * r; }
      if (nw >= 4 && nh >= 4) state.cropRect = { x: nx, y: ny, w: nw, h: nh };
    }
    updateCropBox();
  });
  const endCropDrag = () => { cropDrag = null; };
  cropBox.addEventListener("pointerup", endCropDrag);
  cropBox.addEventListener("pointercancel", endCropDrag);

  function updateCropBox(){
    if (!state.cropMode || !state.cropRect || !state.output){ cropBox.hidden = true; return; }
    const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const sx = cr.width / state.output.width, sy = cr.height / state.output.height;
    cropBox.hidden = false;
    cropBox.style.left = (cr.left - sr.left + state.cropRect.x * sx) + "px";
    cropBox.style.top = (cr.top - sr.top + state.cropRect.y * sy) + "px";
    cropBox.style.width = (state.cropRect.w * sx) + "px";
    cropBox.style.height = (state.cropRect.h * sy) + "px";
  }
  function applyCursor(){
    // 자르기·표시 도구면 십자(텍스트=글자, 선택=기본), 아니면 확대 상태에 따라 돋보기(맞춤=확대 / 확대중=축소)
    canvas.style.cursor = state.cropMode ? "crosshair"
      : state.annTool === "text" ? "text"
      : state.annTool === "select" ? "default"
      : state.annTool ? "crosshair"
      : (state.zoom === null ? "zoom-in" : "zoom-out");
  }
  function redraw(){
    const out = renderForDisplay(state);
    state.output = out;
    canvas.width = out.width; canvas.height = out.height;
    canvas.getContext("2d").drawImage(out, 0, 0);
    // 선택 점선은 화면 캔버스에만 그린다 — 저장은 renderForDisplay 를 직접 쓰므로 파일에 안 박힘
    if (state.annTool === "select" && state.annSelected && state.shapes.includes(state.annSelected)){
      const ctx = canvas.getContext("2d"), b = annotationBounds(state.annSelected);
      ctx.save();
      ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.8; ctx.strokeStyle = "#4338ca";
      ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.restore();
    }
    if (state.zoom === null){
      canvas.style.width = ""; canvas.style.maxWidth = "100%"; canvas.style.maxHeight = "calc(100vh - 190px)";
      zoomLabel.textContent = "맞춤";
    } else {
      canvas.style.maxWidth = "none"; canvas.style.maxHeight = "none"; canvas.style.width = (out.width * state.zoom) + "px";
      zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
    }
    dimsLabel.textContent = out.width + "×" + out.height;
    applyCursor();
    updateCropBox();
    updateHistoryButtons();
    updatePannableState(host);
  }
  // ----- 키보드(이 이미지 탭이 보일 때만): Delete=선택 삭제, Esc=선택 해제, Ctrl+Z/Y=되돌리기 -----
  const onImgKey = (e) => {
    if (!canvas.isConnected){ document.removeEventListener("keydown", onImgKey, true); return; }   // 편집기 제거 후 자가 정리
    if (!host.offsetParent) return;                        // 다른 탭이 활성일 때는 무시
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey){
      const k = String(e.key).toLowerCase();
      if (k === "z" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); undoBtn.click(); }
      else if (k === "y" || (k === "z" && e.shiftKey)){ e.preventDefault(); e.stopPropagation(); redoBtn.click(); }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.annSelected){
      e.preventDefault(); e.stopPropagation();
      state.shapes = state.shapes.filter(s => s !== state.annSelected);
      state.annSelected = null; state.annMove = null;
      redraw(); recordEdit();
    } else if (e.key === "Escape" && state.annSelected){   // 선택만 해제(전역 Esc 동작은 그대로 진행)
      state.annSelected = null; state.annMove = null;
      redraw();
    }
  };
  document.addEventListener("keydown", onImgKey, true);

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateCropBox).observe(canvas);
  redraw();
  history.reset();                                         // 연 직후 상태를 되돌리기 기준점으로
}

// 점 p 와 선분 a–b 사이 거리(펜·화살표 히트테스트용)
function distToSegment(p, a, b){
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function renderEditedImage(state, crop){
  const img = state.img;
  const rotated = state.rotation % 180 !== 0;
  const w = rotated ? img.naturalHeight : img.naturalWidth;
  const h = rotated ? img.naturalWidth : img.naturalHeight;
  const full = document.createElement("canvas");
  full.width = Math.max(1, w); full.height = Math.max(1, h);
  const ctx = full.getContext("2d");
  ctx.save();
  ctx.translate(full.width / 2, full.height / 2);
  ctx.rotate(state.rotation * Math.PI / 180);
  ctx.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
  if (!crop) return full;
  const x = Math.max(0, Math.floor(crop.x)), y = Math.max(0, Math.floor(crop.y));
  const cw = Math.max(1, Math.min(full.width - x, Math.floor(crop.w)));
  const ch = Math.max(1, Math.min(full.height - y, Math.floor(crop.h)));
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  out.getContext("2d").drawImage(full, x, y, cw, ch, 0, 0, cw, ch);
  return out;
}

// ===== 화질 보정 =====
// renderEditedImage 는 기하변형(회전·반전·자르기) 전용. 색/선명/노이즈 보정은 그 위에 얹어 표시·저장용 캔버스를 만든다.
// (자르기·고화질 확대는 renderEditedImage 로 베이스를 굽고 보정은 라이브 유지 → 이중 적용 방지)
const ADJUST_NEUTRAL = { brightness:100, contrast:100, saturate:100, sharpen:0, denoise:0 };
function renderForDisplay(state){
  const geo = renderEditedImage(state);
  const a = state.adjust || ADJUST_NEUTRAL;
  const needColor = a.brightness !== 100 || a.contrast !== 100 || a.saturate !== 100;
  const needPx = (a.sharpen || 0) > 0 || (a.denoise || 0) > 0;
  let c = geo;                                       // renderEditedImage 가 매번 새 캔버스를 만들어 바로 그려도 안전
  if (needColor || needPx){
    c = document.createElement("canvas"); c.width = geo.width; c.height = geo.height;
    const ctx = c.getContext("2d");
    if (needColor) ctx.filter = "brightness(" + a.brightness + "%) contrast(" + a.contrast + "%) saturate(" + a.saturate + "%)";
    ctx.drawImage(geo, 0, 0);
    ctx.filter = "none";
    if (needPx) applyPixelFx(c, a.sharpen || 0, a.denoise || 0);
  }
  const shapes = (state.shapes || []).concat(state.annDraft ? [state.annDraft] : []);
  if (shapes.length){
    applyImageMosaics(c, shapes);                    // 모자이크(픽셀화) 먼저, 그 위에 선·글자
    drawImageAnnotations(c.getContext("2d"), shapes);
  }
  return c;
}

// ===== 표시(주석) 렌더 — 화면 표시와 저장이 같은 경로를 쓴다 =====
function applyImageMosaics(canvas, shapes){
  const ms = (shapes || []).filter(s => s.kind === "mosaic" && s.w >= 3 && s.h >= 3);
  if (!ms.length) return;
  const ctx = canvas.getContext("2d");
  for (const s of ms){
    const x = Math.max(0, Math.floor(s.x)), y = Math.max(0, Math.floor(s.y));
    const w = Math.min(canvas.width - x, Math.ceil(s.w)), h = Math.min(canvas.height - y, Math.ceil(s.h));
    if (w < 3 || h < 3) continue;
    const block = Math.max(8, Math.round(Math.max(canvas.width, canvas.height) / 80));   // 이미지 크기에 비례한 모자이크 칸
    const tw = Math.max(1, Math.round(w / block)), th = Math.max(1, Math.round(h / block));
    const t = document.createElement("canvas"); t.width = tw; t.height = th;
    t.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, tw, th);
    ctx.save();
    ctx.imageSmoothingEnabled = false;               // 되살릴 수 없게 저해상도로 굽고 계단식으로 확대
    ctx.drawImage(t, 0, 0, tw, th, x, y, w, h);
    ctx.restore();
  }
}
function drawImageAnnotations(ctx, shapes){
  for (const s of shapes || []){
    if (s.kind === "mosaic") continue;
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (s.kind === "pen" || s.kind === "hl"){
      const pts = s.points || [];
      if (pts.length >= 2){
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
        if (s.kind === "hl"){ ctx.globalAlpha = 0.4; ctx.lineWidth = s.width * 3; }
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    } else if (s.kind === "arrow"){
      const a = s.points[0], b = s.points[1];
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x), head = Math.max(10, s.width * 3.2);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(ang - 0.46), b.y - head * Math.sin(ang - 0.46));
      ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(ang + 0.46), b.y - head * Math.sin(ang + 0.46));
      ctx.stroke();
    } else if (s.kind === "rect"){
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
    } else if (s.kind === "text"){
      const size = s.size || 30;
      ctx.font = "bold " + size + 'px system-ui, "Malgun Gothic", sans-serif';
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(2, size / 7); ctx.strokeStyle = "rgba(255,255,255,.9)";   // 흰 테두리로 어떤 배경에서도 읽히게
      ctx.fillStyle = s.color;
      const lines = String(s.text || "").split("\n");
      lines.forEach((line, i) => {
        ctx.strokeText(line, s.x, s.y + i * size * 1.25);
        ctx.fillText(line, s.x, s.y + i * size * 1.25);
      });
    }
    ctx.restore();
  }
}
function boxBlur3(src, w, h){          // 3x3 평균(가장자리는 있는 픽셀만) — RGB만, 알파 보존
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++){
      const oi = (y * w + x) * 4;
      for (let c = 0; c < 3; c++){
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++){
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++){
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            sum += src[(yy * w + xx) * 4 + c]; n++;
          }
        }
        out[oi + c] = sum / n;
      }
      out[oi + 3] = src[oi + 3];
    }
  }
  return out;
}
function applyPixelFx(canvas, sharpen, denoise){
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const id = ctx.getImageData(0, 0, w, h);
  const data = id.data;
  if (denoise > 0){                    // 약한 블러와 섞어 잡티 완화
    const amt = Math.min(1, denoise / 100 * 0.9);
    const blur = boxBlur3(data, w, h);
    for (let i = 0; i < data.length; i += 4)
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - amt) + blur[i + c] * amt;
  }
  if (sharpen > 0){                    // 언샤프 마스크: 원본 + amt*(원본 - 블러)
    const amt = sharpen / 100 * 1.5;
    const blur = boxBlur3(data, w, h);
    for (let i = 0; i < data.length; i += 4)
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + amt * (data[i + c] - blur[i + c]);
  }
  ctx.putImageData(id, 0, 0);
}
function computeAutoLevels(srcCanvas){  // 휘도 히스토그램의 양끝 0.5%를 잘라 밝기·대비 자동 산출
  const w = srcCanvas.width, h = srcCanvas.height;
  const data = srcCanvas.getContext("2d").getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 200000)));
  const hist = new Uint32Array(256); let count = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step){
    const i = (y * w + x) * 4;
    hist[(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0]++; count++;
  }
  const clip = count * 0.005; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++){ acc += hist[v]; if (acc >= clip){ lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--){ acc += hist[v]; if (acc >= clip){ hi = v; break; } }
  if (hi <= lo) return { brightness: 100, contrast: 100 };
  const loN = lo / 255, hiN = hi / 255;
  const contrast = 1 + 2 * loN / (hiN - loN);
  const brightness = 1 / ((hiN - loN) * contrast);
  const cl = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
  return { brightness: cl(brightness * 100, 60, 200), contrast: cl(contrast * 100, 60, 280) };
}

function imageFromDataUrl(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function imageBaseName(file){
  return String(file && file.name || "image").replace(/\.[^.]+$/, "") || "image";
}

// 저장 동선 통일: EXE 로컬 서버가 있으면 권한 팝업 없이 저장 폴더(내 문서\만능교실 저장)에 쓰고
// 저장 완료 토스트에 절대경로·[폴더 열기]를 띄운다. 없으면 기존 다운로드로 폴백(.py 저장과 같은 흐름).
async function saveImageBlobUnified(blob, file, outName, ownerDoc=null, options={}){
  if (options.overwriteOriginal && ownerDoc && ownerDoc.originalSaveMode){
    const wrote = (typeof saveViaFileHandle === "function")
      ? await saveViaFileHandle(blob, ownerDoc.name || file.name, ownerDoc, { existingOnly:true, mime:blob.type || "application/octet-stream" })
      : "unsupported";
    if (wrote !== "saved"){
      toast("원본 이미지 쓰기 권한이 없어 저장하지 못했어요.", 3000, { type:"error" });
      return false;
    }
    const savedName = ownerDoc.name || file.name || outName;
    const path = String(ownerDoc.workspacePath || ownerDoc.relPath || savedName).replace(/\\/g, "/").replace(/^\/+/, "");
    let updated = new File([blob], savedName, { type:blob.type || "application/octet-stream" });
    if (path.indexOf("/") >= 0) Object.defineProperty(updated, "webkitRelativePath", { value:path });
    if (typeof withFileHandle === "function") updated = withFileHandle(updated, ownerDoc.fsHandle);
    if (typeof withDirHandle === "function") updated = withDirHandle(updated, ownerDoc.fsDirHandle);
    ownerDoc.sourceFile = updated;
    ownerDoc.size = updated.size;
    if (typeof rememberWorkspace === "function") ownerDoc.savedInWorkspace = await rememberWorkspace([updated], false, { silent:true });
    if (typeof markDocumentDirty === "function") markDocumentDirty(ownerDoc, false);
    toast("원본 이미지에 저장했어요.", 2200, { type:"success" });
    return true;
  }
  const relDir = (() => {
    const p = String((file && file.webkitRelativePath) || "").replace(/\\/g, "/");
    const i = p.lastIndexOf("/");
    return i > 0 ? p.slice(0, i + 1) : "";                       // 폴더로 연 이미지는 원본 폴더 구조 유지
  })();
  try {
    if (typeof saveFileBackendAvailable === "function" && await saveFileBackendAvailable()){
      const path = await saveViaServer(blob, { workspacePath: relDir + outName }, outName);
      if (path){
        if (ownerDoc && typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(ownerDoc, blob, blob.type || "image/png");
        toast("저장 완료 · " + path, 3400, {
          type: "success",
          action: (typeof window !== "undefined" && typeof window.__mnOpenLastSavedFolder === "function")
            ? { label: "폴더 열기", onClick: () => window.__mnOpenLastSavedFolder() } : null
        });
        return true;
      }
    }
  } catch(_){ /* 서버 저장 실패 → 다운로드 폴백 */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = outName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (ownerDoc && typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(ownerDoc, blob, blob.type || "image/png");
  toast("파일을 내려받았어요.", 1800, { type: "success" });
  return true;
}

// 편집본을 일반 메모에 이미지 블록으로 넣는다(엑셀 '선택→메모'와 같은 통로).
// 자르기 영역을 선택해 두었으면 '적용'으로 실제로 자르지 않고도 그 부분만 발췌해 보낸다.
// renderForDisplay 기준이라 표시·모자이크·보정이 화면에 보이는 그대로 담긴다(선택 점선은 제외).
function sendImageToMemo(state, file){
  const full = renderForDisplay(state);
  let cv = full;
  const crop = state.cropRect;
  if (crop && crop.w >= 4 && crop.h >= 4){
    const x = Math.max(0, Math.floor(crop.x)), y = Math.max(0, Math.floor(crop.y));
    const w = Math.max(1, Math.min(full.width - x, Math.round(crop.w)));
    const h = Math.max(1, Math.min(full.height - y, Math.round(crop.h)));
    cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(full, x, y, w, h, 0, 0, w, h);
  }
  const partial = cv !== full;
  cv.toBlob((blob) => {
    if (!blob){ toast("이미지를 만들지 못했어요.", 2200, { type: "error" }); return; }
    const name = imageBaseName(file) + (partial ? "_영역" : "") + ".png";
    if (typeof window.addImagesToScratchpad === "function"){
      Promise.resolve(window.addImagesToScratchpad([new File([blob], name, { type: "image/png" })], { name: imageBaseName(file) + (partial ? " 자른 영역" : "") }))
        .then(() => toast(partial ? "자르기 영역을 메모에 넣었어요." : "이미지를 메모에 넣었어요.", 1900, { type: "success" }))
        .catch((e) => { console.error(e); saveImageBlobUnified(blob, file, name); });   // 메모 실패 → 파일 저장 폴백
    } else {
      saveImageBlobUnified(blob, file, name);
    }
  }, "image/png");
}

/* ===== 이미지 글자 추출(OCR) =====
 * 스캔 PDF OCR(pdf-ocr.js)의 도구 로더(동의 + CDN, 한국어+영어)를 그대로 재사용해
 * 현재 화면의 이미지(자르기 영역이 있으면 그 부분만)에서 글자를 읽어 복사·메모로 보낸다.
 * 인식은 이 컴퓨터 안에서만 처리되고 이미지가 외부로 전송되지 않는 점도 동일하다. */
let _imgOcrRunning = false;
async function extractImageText(state, file){
  if (_imgOcrRunning){ toast("이미 글자를 인식하는 중이에요.", 2000); return; }
  if (typeof pdfOcrEnsureTesseract !== "function" || !(await pdfOcrEnsureTesseract())) return;
  const full = renderForDisplay(state);
  let cv = full;
  const crop = state.cropRect;
  if (crop && crop.w >= 4 && crop.h >= 4){                 // 자르기 영역이 있으면 그 부분만 인식
    const x = Math.max(0, Math.floor(crop.x)), y = Math.max(0, Math.floor(crop.y));
    const w = Math.max(1, Math.min(full.width - x, Math.round(crop.w)));
    const h = Math.max(1, Math.min(full.height - y, Math.round(crop.h)));
    cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(full, x, y, w, h, 0, 0, w, h);
  }
  _imgOcrRunning = true;
  showLoading("글자 인식 중… (이 컴퓨터 안에서만 처리돼요)");
  let worker = null, text = "", ok = false;
  try {
    worker = await Tesseract.createWorker("kor+eng", 1);
    const { data } = await worker.recognize(cv);
    text = String((data && data.text) || "").replace(/[ \t]+\n/g, "\n").trim();
    ok = true;
  } catch(e){
    console.warn("image ocr failed:", e);
    toast("글자 인식 중 문제가 생겼어요: " + ((e && e.message) || e), 3600, { type: "error" });
  } finally {
    if (worker){ try { worker.terminate(); } catch(_){} }
    hideLoading();
    _imgOcrRunning = false;
  }
  if (!ok) return;
  if (!text){ toast("읽을 수 있는 글자를 찾지 못했어요. 글자가 크고 선명할수록 잘 인식돼요.", 3600); return; }
  showImageOcrResult(text);
}

// 인식 결과 창: 텍스트를 고쳐 쓸 수 있는 칸 + 복사·메모로 보내기.
function showImageOcrResult(text){
  const overlay = document.createElement("div"); overlay.className = "modal";
  const card = document.createElement("div"); card.className = "modal-card"; card.style.width = "min(580px,96%)";
  const heading = document.createElement("h3"); heading.textContent = "글자 추출 결과";
  const sub = document.createElement("div"); sub.className = "sub";
  sub.textContent = "인식이 완벽하지 않을 수 있어요 — 필요한 부분을 고쳐서 복사하세요.";
  const ta = document.createElement("textarea");
  ta.className = "img-ocr-text"; ta.value = text; ta.rows = 12;
  ta.setAttribute("aria-label", "인식된 글자");
  const actions = document.createElement("div"); actions.className = "modal-actions";
  const spacer = document.createElement("span"); spacer.className = "spacer";
  const mkAct = (label, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; return b; };
  const memoBtn = mkAct("메모에 넣기", "btn");
  const copyBtn = mkAct("📋 복사", "btn primary");
  const closeBtn = mkAct("닫기", "btn");
  const close = () => { overlay.remove(); window.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape"){ e.preventDefault(); close(); } };
  window.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("click", close);
  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(ta.value); toast("인식한 글자를 복사했어요.", 1800, { type: "success" }); }
    catch(_){ ta.select(); document.execCommand && document.execCommand("copy"); toast("인식한 글자를 복사했어요.", 1800, { type: "success" }); }
  });
  memoBtn.addEventListener("click", () => {
    if (typeof window.appendTextToScratchpad !== "function"){ toast("메모 기능을 찾지 못했어요 — 복사를 사용해 주세요.", 2600); return; }
    window.appendTextToScratchpad(ta.value);
    toast("인식한 글자를 메모에 넣었어요.", 1900, { type: "success" });
  });
  actions.append(spacer, memoBtn, copyBtn, closeBtn);
  card.append(heading, sub, ta, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(card);
  ta.focus();
}

function imageOutputMatchesOriginal(file, format){
  const ext = String(file && file.name || "").split(".").pop().toLowerCase();
  return (format === "png" && ext === "png") ||
    (format === "jpeg" && (ext === "jpg" || ext === "jpeg"));
}

function downloadEditedImage(state, file, format, ownerDoc=null){
  const canvas = renderForDisplay(state);
  const jpeg = format === "jpeg";
  const overwriteOriginal = !!(ownerDoc && ownerDoc.originalSaveMode && imageOutputMatchesOriginal(file, format));
  const name = overwriteOriginal ? (ownerDoc.name || file.name) : imageBaseName(file) + "_edited." + (jpeg ? "jpg" : "png");
  const quality = jpeg ? Math.max(0.5, Math.min(1, (state.jpgQuality || 90) / 100)) : undefined;
  canvas.toBlob(blob => {
    if (!blob){ toast("이미지를 저장하지 못했어요.", 2200, { type: "error" }); return; }
    saveImageBlobUnified(blob, file, name, ownerDoc, { overwriteOriginal });
  }, jpeg ? "image/jpeg" : "image/png", quality);
}

async function downloadImagePdf(state, file){
  if (typeof PDFLib === "undefined"){ toast("PDF 라이브러리를 불러오지 못했습니다.", 2600); return; }
  try {
    const canvas = renderForDisplay(state);
    const png = canvas.toDataURL("image/png");
    const { PDFDocument } = PDFLib;
    const pdf = await PDFDocument.create();
    const img = await pdf.embedPng(png);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    const bytes = await pdf.save();
    await saveImageBlobUnified(new Blob([bytes], { type: "application/pdf" }), file, imageBaseName(file) + ".pdf");
  } catch(e){
    console.error(e);
    toast("PDF로 저장하지 못했어요.", 2600, { type: "error" });
  }
}
