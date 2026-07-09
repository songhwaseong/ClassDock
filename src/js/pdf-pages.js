"use strict";

function downloadPdfBytes(bytes, name){
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function buildPdfBytes(doc, onlyOriginalIds=null){
  const { PDFDocument, degrees } = PDFLib;
  const source = await PDFDocument.load(doc.pdfBytes, { ignoreEncryption: true });
  const output = await PDFDocument.create();
  const chosen = doc.pages.filter(p => !onlyOriginalIds || onlyOriginalIds.has(p.originalIndex));
  const copied = await output.copyPages(source, chosen.map(p => p.originalIndex));
  copied.forEach((page, i) => {
    const extra = chosen[i].exportRotation || 0;
    if (extra) page.setRotation(degrees(((page.getRotation().angle || 0) + extra) % 360));
    output.addPage(page);
  });

  for (const { el, pageIndex, kind } of doc.elements){
    if (kind === "code-link") continue;
    if (kind === "ink" && (!el.__strokes || !el.__strokes.length)) continue;   // 빈 잉크 레이어는 건너뜀
    const pageInfo = doc.pages[pageIndex];
    const targetIndex = chosen.indexOf(pageInfo);
    if (targetIndex < 0) continue;
    const dataUrl = kind === "signature" ? el.__dataUrl
      : kind === "ink" ? (el.__canvas ? el.__canvas.toDataURL("image/png") : null)   // 투명 PNG(필기만)
      : textToDataUrl(el);
    if (!dataUrl) continue;
    const page = output.getPage(targetIndex);
    const scale = pageInfo.scale;
    const width = el.offsetWidth / scale, height = el.offsetHeight / scale;
    const png = await output.embedPng(dataUrl);
    page.drawImage(png, {
      x: el.offsetLeft / scale,
      y: pageInfo.ptH - (el.offsetTop / scale) - height,
      width, height
    });
  }
  output.setTitle(doc.fileName || "PDF");
  return output.save();
}

function selectedPdfPages(doc, fallbackCurrent=true){
  let pages = doc.pages.filter(p => doc.selectedPageIds.has(p.originalIndex));
  if (!pages.length && fallbackCurrent && doc === state) pages = [doc.pages[currentPageIndex()]].filter(Boolean);
  return pages;
}

function setPdfPagePanelOpen(doc, open){
  if (!doc || doc.kind !== "pdf" || !doc.pagePanel) return;
  doc.pagePanelOpen = !!open;
  doc.pagePanel.hidden = !doc.pagePanelOpen;
  byId("btnPages").classList.toggle("primary", doc.pagePanelOpen);
  if (doc.pagePanelOpen) renderPdfThumbnails(doc);
}
function togglePdfPagePanel(doc=state){
  if (!doc || doc.kind !== "pdf" || !doc.pagePanel) return;
  setPdfPagePanelOpen(doc, !doc.pagePanelOpen);
}

function createPdfPagePanel(doc){
  const panel = document.createElement("aside");
  panel.className = "pdf-pages-panel"; panel.hidden = true;
  const head = document.createElement("div"); head.className = "pdf-pages-head";
  const heading = document.createElement("div"); heading.className = "pdf-pages-title";
  const title = document.createElement("span"); title.textContent = "페이지";
  const count = document.createElement("span"); count.className = "pdf-page-count";
  heading.append(title, count);
  const close = document.createElement("button"); close.type = "button"; close.className = "pdf-pages-close";
  close.textContent = "✕"; close.title = "썸네일 정리 닫기"; close.setAttribute("aria-label", close.title);
  close.addEventListener("click", () => {
    setPdfPagePanelOpen(doc, false);
    if (doc.id === activeId) byId("btnPages").focus();
  });
  head.append(heading, close);
  const actions = document.createElement("div"); actions.className = "pdf-pages-actions";
  const action = (label, titleText, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = titleText; b.onclick = fn; actions.appendChild(b);
  };
  action("전체", "전체 페이지 선택/해제", () => {
    const all = doc.pages.every(p => doc.selectedPageIds.has(p.originalIndex));
    doc.selectedPageIds = new Set(all ? [] : doc.pages.map(p => p.originalIndex)); updatePdfPagePanel(doc);
  });
  action("추출", "선택 페이지를 새 PDF로 저장", () => extractPdfPages(doc));
  action("삭제", "선택 페이지 삭제", () => deletePdfPages(doc));
  action("↑", "선택 페이지를 앞으로 이동", () => movePdfPage(doc, -1));
  action("↓", "선택 페이지를 뒤로 이동", () => movePdfPage(doc, 1));
  action("회전", "선택 페이지를 시계 방향 90도 회전", () => rotatePdfPages(doc));
  const list = document.createElement("div"); list.className = "pdf-thumb-list";
  panel.append(head, actions, list);
  doc.el.insertBefore(panel, doc.el.firstChild);
  doc.pagePanel = panel; doc.pageThumbList = list; doc.pageCountLabel = count;
  updatePdfPagePanel(doc);
}

function updatePdfPagePanel(doc){
  if (!doc.pageThumbList) return;
  doc.pageCountLabel.textContent = doc.pages.length + "장";
  doc.pageThumbList.innerHTML = "";
  doc.pages.forEach((p, index) => {
    const row = document.createElement("div"); row.className = "pdf-thumb";
    if (doc.selectedPageIds.has(p.originalIndex)) row.classList.add("selected");
    const check = document.createElement("input"); check.type = "checkbox"; check.className = "pdf-thumb-check";
    check.checked = doc.selectedPageIds.has(p.originalIndex); check.title = "페이지 선택";
    check.onclick = e => {
      e.stopPropagation();
      if (check.checked) doc.selectedPageIds.add(p.originalIndex); else doc.selectedPageIds.delete(p.originalIndex);
      updatePdfPagePanel(doc);
    };
    const canvas = p.thumbCanvas || document.createElement("canvas"); p.thumbCanvas = canvas;
    const meta = document.createElement("div"); meta.className = "pdf-thumb-meta";
    const number = document.createElement("span"); number.textContent = (index + 1) + " / " + doc.pages.length;
    const rotation = document.createElement("span"); rotation.className = "pdf-thumb-rotation";
    rotation.textContent = p.exportRotation ? "↻" + p.exportRotation + "°" : "";
    meta.append(number, rotation); row.append(check, canvas, meta);
    row.onclick = () => p.frame.scrollIntoView({ behavior: "smooth", block: "start" });
    doc.pageThumbList.appendChild(row);
  });
}

async function renderPdfThumbnails(doc){
  if (doc._thumbsRendering || !doc.pdfjsDoc) return;
  doc._thumbsRendering = true;
  try {
    for (const p of doc.pages){
      if (doc.closed) break;
      if (p.thumbRendered) continue;
      const page = await doc.pdfjsDoc.getPage(p.pageNum);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(130 / base.width, 0.28);
      const vp = page.getViewport({ scale });
      const c = p.thumbCanvas; c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      p.thumbRendered = true;
      if (typeof page.cleanup === "function") page.cleanup();
      await yieldToBrowser();
    }
  } catch(e){ console.warn("페이지 썸네일 생성 실패:", e); }
  finally { doc._thumbsRendering = false; }
}

async function extractPdfPages(doc){
  const pages = selectedPdfPages(doc);
  if (!pages.length) return;
  showLoading("선택 페이지 추출 중…");
  try {
    const ids = new Set(pages.map(p => p.originalIndex));
    const bytes = await buildPdfBytes(doc, ids);
    downloadPdfBytes(bytes, doc.fileName.replace(/\.pdf$/i, "") + "_pages.pdf");
    toast(pages.length + "개 페이지를 저장했어요.");
  } catch(e){ console.error(e); toast("페이지 추출에 실패했습니다.", 3000); }
  finally { hideLoading(); }
}

function reindexPdfElements(doc, oldPages){
  for (const item of doc.elements){
    const page = oldPages[item.pageIndex];
    item.pageIndex = doc.pages.indexOf(page);
  }
  doc.elements = doc.elements.filter(item => item.pageIndex >= 0);
}

async function deletePdfPages(doc){
  const pages = selectedPdfPages(doc, false);
  if (!pages.length){ toast("삭제할 페이지를 선택하세요."); return; }
  if (pages.length >= doc.pages.length){ toast("PDF에는 한 페이지 이상 남아야 합니다."); return; }
  if (!(await confirmDialog(`선택한 ${pages.length}개 페이지를 작업 결과에서 삭제할까요?`, "삭제", "취소"))) return;
  const old = doc.pages.slice(), removing = new Set(pages);
  pages.forEach(p => { releasePageCanvas(p); p.frame.remove(); });
  doc.pages = doc.pages.filter(p => !removing.has(p));
  for (const item of doc.elements.slice()) if (removing.has(old[item.pageIndex])) item.el.remove();
  reindexPdfElements(doc, old); doc.selectedPageIds.clear();
  startLazyRender(doc); updatePdfPagePanel(doc); recordPdfEdit(doc); schedulePdfRecovery(doc);
}

function movePdfPage(doc, direction){
  const pages = selectedPdfPages(doc, false);
  if (pages.length !== 1){ toast("이동할 페이지 하나를 선택하세요."); return; }
  const old = doc.pages.slice(), from = doc.pages.indexOf(pages[0]), to = Math.max(0, Math.min(doc.pages.length - 1, from + direction));
  if (from === to) return;
  doc.pages.splice(from, 1); doc.pages.splice(to, 0, pages[0]);
  const anchor = doc.pages[to + 1];
  doc.el.insertBefore(pages[0].frame, anchor ? anchor.frame : null);
  reindexPdfElements(doc, old); startLazyRender(doc); updatePdfPagePanel(doc); recordPdfEdit(doc); schedulePdfRecovery(doc);
}

function rotatePdfPages(doc){
  const pages = selectedPdfPages(doc, false);
  if (!pages.length){ toast("회전할 페이지를 선택하세요."); return; }
  pages.forEach(p => { p.exportRotation = ((p.exportRotation || 0) + 90) % 360; });
  pages.forEach(p => applyPageZoom(p, doc.zoom || 1));
  updatePdfPagePanel(doc); schedulePdfRecovery(doc);
  recordPdfEdit(doc);
  toast("회전은 다운로드·추출 결과에 적용됩니다.", 2200);
}

function restorePdfPageState(doc, savedPages){
  if (!doc || !Array.isArray(savedPages) || !savedPages.length) return;
  const byOriginal = new Map((doc.allPages || doc.pages).map(p => [p.originalIndex, p]));
  const restored = [];
  for (const item of savedPages){
    const page = byOriginal.get(item.originalIndex);
    if (!page) continue;
    page.exportRotation = Number(item.exportRotation) || 0;
    restored.push(page); byOriginal.delete(item.originalIndex);
  }
  if (!restored.length) return;
  for (const page of byOriginal.values()){ releasePageCanvas(page); page.frame.remove(); }
  doc.pages = restored;
  for (const page of restored){ doc.el.appendChild(page.frame); applyPageZoom(page, doc.zoom || 1); }
  startLazyRender(doc);
  updatePdfPagePanel(doc);
}

async function mergePdfFiles(doc, files){
  if (!doc || !files || !files.length) return;
  showLoading("PDF 합치는 중…");
  try {
    const { PDFDocument } = PDFLib;
    const merged = await PDFDocument.create();
    const currentBytes = await buildPdfBytes(doc);
    for (const bytes of [currentBytes, ...await Promise.all([...files].map(f => f.arrayBuffer()))]){
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copied = await merged.copyPages(source, source.getPageIndices());
      copied.forEach(page => merged.addPage(page));
    }
    downloadPdfBytes(await merged.save(), doc.fileName.replace(/\.pdf$/i, "") + "_merged.pdf");
    toast(`${files.length + 1}개 PDF를 합쳤어요.`);
  } catch(e){ console.error(e); toast("PDF 합치기에 실패했습니다. 암호 파일인지 확인하세요.", 3500); }
  finally { hideLoading(); }
}
