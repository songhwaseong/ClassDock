"use strict";

function downloadPdfBytes(bytes, name){
  // 쪽이 많은 PDF 는 수십 MB 가 되므로 해제까지의 틈을 기본값보다 길게 준다.
  MNDownload.saveBlob(new Blob([bytes], { type:"application/pdf" }), name, { revokeAfterMs:4000 });
}

// 편집 중인 책갈피 트리를 저장 가능한 최소 데이터로 복사한다.
// PDF.js 의 dest/ref 같은 런타임 객체와 UI 선택 상태는 복구본·히스토리에 넣지 않는다.
function serializePdfOutline(items){
  return (Array.isArray(items) ? items : []).map(item => ({
    title: String(item.title || "").replace(/\s+/g, " ").trim() || "(제목 없음)",
    originalIndex: Number.isInteger(item.originalIndex) ? item.originalIndex : null,
    url: /^(https?:|mailto:)/i.test(String(item.url || "")) ? String(item.url) : "",
    bold: !!item.bold,
    italic: !!item.italic,
    items: serializePdfOutline(item.items)
  }));
}

let pdfOutlineIdSeed = 0;
function restorePdfOutlineItems(items){
  return (Array.isArray(items) ? items : []).map(item => ({
    id: "pdf-outline-" + Date.now().toString(36) + "-" + (++pdfOutlineIdSeed).toString(36),
    title: String(item && item.title || "").replace(/\s+/g, " ").trim() || "(제목 없음)",
    originalIndex: Number.isInteger(item && item.originalIndex) ? item.originalIndex : null,
    url: /^(https?:|mailto:)/i.test(String(item && item.url || "")) ? String(item.url) : "",
    bold: !!(item && item.bold),
    italic: !!(item && item.italic),
    items: restorePdfOutlineItems(item && item.items)
  }));
}

function restorePdfOutlineState(doc, items){
  if (!doc || !Array.isArray(items)) return;
  doc.pdfOutline = restorePdfOutlineItems(items);
  doc.selectedOutlineId = null;
  updatePdfOutlinePanel(doc);
  updatePdfOutlineButton(doc);
}

// 선택 페이지 추출에서도 포함된 페이지의 책갈피만 남긴다. 목적지가 빠진 상위 항목은
// 포함된 하위 항목의 그룹 제목으로 유지할 수 있다.
function pdfOutlineForPages(items, allowedOriginalIds){
  const allowed = allowedOriginalIds instanceof Set ? allowedOriginalIds : new Set(allowedOriginalIds || []);
  const visit = (list) => {
    const out = [];
    for (const item of Array.isArray(list) ? list : []){
      const children = visit(item.items);
      const hasPage = Number.isInteger(item.originalIndex) && allowed.has(item.originalIndex);
      const hasUrl = /^(https?:|mailto:)/i.test(String(item.url || ""));
      if (!hasPage && !hasUrl && !children.length) continue;
      out.push({ ...item, originalIndex: hasPage ? item.originalIndex : null, items: children });
    }
    return out;
  };
  return visit(items);
}

// pdf-lib 저수준 객체로 ISO PDF Outline 트리를 작성한다. pdf-lib에는 책갈피용 고수준 API가
// 없어서 Catalog/Outlines/연결 리스트를 직접 구성한다.
function writePdfOutline(pdfDoc, items, chosenPages){
  if (!pdfDoc || !PDFLib) return 0;
  const chosen = Array.isArray(chosenPages) ? chosenPages : [];
  const allowed = new Set(chosen.map(page => page.originalIndex));
  const outline = pdfOutlineForPages(items, allowed);
  if (!outline.length) return 0;

  const { PDFName, PDFHexString, PDFNumber } = PDFLib;
  const context = pdfDoc.context;
  const pageRefByOriginal = new Map();
  chosen.forEach((page, index) => {
    const outputPage = pdfDoc.getPage(index);
    if (outputPage) pageRefByOriginal.set(page.originalIndex, outputPage.ref);
  });

  const root = context.obj({ Type: PDFName.of("Outlines") });
  const rootRef = context.register(root);
  const buildLevel = (levelItems, parentRef) => {
    const nodes = levelItems.map(item => {
      const dict = context.obj({});
      const ref = context.register(dict);
      dict.set(PDFName.of("Title"), PDFHexString.fromText(String(item.title || "(제목 없음)")));
      dict.set(PDFName.of("Parent"), parentRef);
      const pageRef = pageRefByOriginal.get(item.originalIndex);
      if (pageRef) dict.set(PDFName.of("Dest"), context.obj([pageRef, PDFName.of("Fit")]));
      else if (/^(https?:|mailto:)/i.test(String(item.url || ""))){
        const action = context.obj({ S: PDFName.of("URI"), URI: PDFHexString.fromText(String(item.url)) });
        dict.set(PDFName.of("A"), context.register(action));
      }
      const flags = (item.italic ? 1 : 0) | (item.bold ? 2 : 0);
      if (flags) dict.set(PDFName.of("F"), PDFNumber.of(flags));
      return { item, dict, ref };
    });

    let count = nodes.length;
    nodes.forEach((node, index) => {
      if (index > 0) node.dict.set(PDFName.of("Prev"), nodes[index - 1].ref);
      if (index + 1 < nodes.length) node.dict.set(PDFName.of("Next"), nodes[index + 1].ref);
      const child = buildLevel(Array.isArray(node.item.items) ? node.item.items : [], node.ref);
      if (child.count){
        node.dict.set(PDFName.of("First"), child.first);
        node.dict.set(PDFName.of("Last"), child.last);
        node.dict.set(PDFName.of("Count"), PDFNumber.of(child.count));
        count += child.count;
      }
    });
    return { first: nodes.length ? nodes[0].ref : null, last: nodes.length ? nodes[nodes.length - 1].ref : null, count };
  };

  const tree = buildLevel(outline, rootRef);
  root.set(PDFName.of("First"), tree.first);
  root.set(PDFName.of("Last"), tree.last);
  root.set(PDFName.of("Count"), PDFNumber.of(tree.count));
  pdfDoc.catalog.set(PDFName.of("Outlines"), rootRef);
  pdfDoc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  return tree.count;
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
  writePdfOutline(output, doc.pdfOutline, chosen);
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
  if (doc.pagePanelOpen && doc.outlinePanelOpen) setPdfOutlinePanelOpen(doc, false);   // 왼쪽 자리 공유 — 한 번에 하나만
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
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(panel);
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
    // 한 장씩 보기에서는 감춰 둔 페이지로 스크롤할 수 없다 — 그 쪽으로 넘긴다.
    row.onclick = () => {
      if (typeof pdfIsSinglePage === "function" && pdfIsSinglePage(doc)) showPdfSinglePage(doc, index);
      else p.frame.scrollIntoView({ behavior: "smooth", block: "start" });
    };
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

/* ===== PDF 목차(책갈피) 패널 =====
 * PDF 에 저장된 책갈피(outline)를 트리로 보여주고 클릭하면 해당 페이지로 이동한다.
 * 페이지 정리(삭제·이동) 뒤에도 원본 페이지 번호(pageNum)로 찾아가므로 안전하다. */
async function initPdfOutline(doc){
  doc.pdfOutline = null;                       // null=확인 중, []=없음, [...]=편집 모델
  doc.outlinePanelOpen = false;
  doc.selectedOutlineId = null;
  updatePdfOutlineButton(doc);
  if (!doc.pdfjsDoc || typeof doc.pdfjsDoc.getOutline !== "function"){
    doc.pdfOutline = [];
    updatePdfOutlineButton(doc);
    return;
  }
  try {
    const raw = await doc.pdfjsDoc.getOutline();
    if (doc.closed) return;
    doc.pdfOutline = await normalizePdfOutlineItems(doc, Array.isArray(raw) ? raw : []);
  } catch(_){
    if (!doc.closed) doc.pdfOutline = [];
  }
  updatePdfOutlinePanel(doc);
  updatePdfOutlineButton(doc);
}

async function normalizePdfOutlineItems(doc, items){
  const out = [];
  for (const raw of Array.isArray(items) ? items : []){
    const pageNum = await resolvePdfOutlinePage(doc, raw);
    const page = pageNum ? doc.pages.find(p => p.pageNum === pageNum) : null;
    out.push({
      id: "pdf-outline-" + Date.now().toString(36) + "-" + (++pdfOutlineIdSeed).toString(36),
      title: String(raw.title || "").replace(/\s+/g, " ").trim() || "(제목 없음)",
      originalIndex: page ? page.originalIndex : null,
      url: /^(https?:|mailto:)/i.test(String(raw.url || "")) ? String(raw.url) : "",
      bold: !!raw.bold,
      italic: !!raw.italic,
      items: await normalizePdfOutlineItems(doc, raw.items)
    });
  }
  return out;
}

function updatePdfOutlineButton(doc){
  const button = byId("btnOutline"); if (!button) return;
  if (!doc || doc.id !== activeId || doc.kind !== "pdf") return;   // PDF 가 아니면 tools 바 자체가 숨겨진다
  const tr = window.t || ((s) => s);
  const ready = Array.isArray(doc.pdfOutline);
  const has = ready && doc.pdfOutline.length > 0;
  button.disabled = !ready;
  button.classList.toggle("primary", ready && !!doc.outlinePanelOpen);
  button.title = !ready ? tr("목차 확인 중…")
    : has ? tr("문서 목차로 이동하거나 책갈피 편집") : tr("현재 페이지에 책갈피 추가");
}

function setPdfOutlinePanelOpen(doc, open){
  if (!doc || doc.kind !== "pdf" || !Array.isArray(doc.pdfOutline)) return;
  if (open && !doc.outlinePanel) createPdfOutlinePanel(doc);
  if (!doc.outlinePanel) return;
  doc.outlinePanelOpen = !!open;
  doc.outlinePanel.hidden = !doc.outlinePanelOpen;
  if (doc.outlinePanelOpen){
    if (doc.pagePanelOpen) setPdfPagePanelOpen(doc, false);   // 썸네일 패널과 자리 공유
    updatePdfOutlinePanel(doc);
  }
  updatePdfOutlineButton(doc);
}
function togglePdfOutlinePanel(doc=state){
  if (!doc || doc.kind !== "pdf" || !Array.isArray(doc.pdfOutline)) return;
  setPdfOutlinePanelOpen(doc, !doc.outlinePanelOpen);
}

function createPdfOutlinePanel(doc){
  const panel = document.createElement("aside");
  panel.className = "pdf-outline-panel"; panel.hidden = true;
  const head = document.createElement("div"); head.className = "pdf-pages-head";
  const heading = document.createElement("div"); heading.className = "pdf-pages-title";
  const title = document.createElement("span"); title.textContent = "목차";
  const count = document.createElement("span"); count.className = "pdf-page-count";
  heading.append(title, count);
  const close = document.createElement("button"); close.type = "button"; close.className = "pdf-pages-close";
  close.textContent = "✕"; close.title = "목차 닫기"; close.setAttribute("aria-label", close.title);
  close.addEventListener("click", () => {
    setPdfOutlinePanelOpen(doc, false);
    if (doc.id === activeId) byId("btnOutline").focus();
  });
  head.append(heading, close);

  const actions = document.createElement("div"); actions.className = "pdf-outline-actions";
  const action = (label, titleText, fn, cls="") => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.title = titleText; button.className = cls; button.addEventListener("click", fn); actions.appendChild(button); return button;
  };
  const buttons = {
    add: action("＋ 현재 페이지", "현재 보고 있는 페이지에 책갈피 추가", () => addPdfOutlineItem(doc), "pdf-outline-add"),
    rename: action("이름", "선택한 책갈피 이름 바꾸기", () => renamePdfOutlineItem(doc)),
    remove: action("삭제", "선택한 책갈피와 하위 항목 삭제", () => deletePdfOutlineItem(doc)),
    up: action("↑", "같은 단계에서 위로 이동", () => movePdfOutlineItem(doc, -1)),
    down: action("↓", "같은 단계에서 아래로 이동", () => movePdfOutlineItem(doc, 1)),
    outdent: action("←", "상위 단계로 내어쓰기", () => outdentPdfOutlineItem(doc)),
    indent: action("→", "바로 위 항목의 하위 목차로 들여쓰기", () => indentPdfOutlineItem(doc))
  };
  const list = document.createElement("div"); list.className = "pdf-outline-list";
  panel.append(head, actions, list);
  doc.el.insertBefore(panel, doc.el.firstChild);
  doc.outlinePanel = panel; doc.outlineList = list; doc.outlineCountLabel = count; doc.outlineButtons = buttons;
  updatePdfOutlinePanel(doc);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(panel);
}

function pdfOutlineLocation(items, id, parent=null, parentList=null){
  const list = Array.isArray(items) ? items : [];
  for (let index = 0; index < list.length; index++){
    const item = list[index];
    if (item.id === id) return { item, list, index, parent, parentList };
    const found = pdfOutlineLocation(item.items, id, item, list);
    if (found) return found;
  }
  return null;
}

function countPdfOutlineItems(items){
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + 1 + countPdfOutlineItems(item.items), 0);
}

function updatePdfOutlinePanel(doc){
  if (!doc || !doc.outlineList) return;
  const list = doc.outlineList;
  list.replaceChildren();
  const selected = pdfOutlineLocation(doc.pdfOutline, doc.selectedOutlineId);
  if (!selected) doc.selectedOutlineId = null;
  const addItems = (items, depth) => {
    for (const item of items){
      const row = document.createElement("button");
      row.type = "button"; row.className = "pdf-outline-item";
      row.style.setProperty("--depth", Math.min(depth, 12));
      row.classList.toggle("selected", item.id === doc.selectedOutlineId);
      const name = document.createElement("span"); name.className = "pdf-outline-name";
      name.textContent = item.title || "(제목 없음)";
      if (item.bold) name.style.fontWeight = "700";
      if (item.italic) name.style.fontStyle = "italic";
      const pageLabel = document.createElement("span"); pageLabel.className = "pdf-outline-page";
      const page = Number.isInteger(item.originalIndex) ? doc.pages.find(p => p.originalIndex === item.originalIndex) : null;
      pageLabel.textContent = page ? String(doc.pages.indexOf(page) + 1) : (item.url ? "↗" : "—");
      row.title = name.textContent + (page ? " · " + pageLabel.textContent + "페이지" : "");
      row.append(name, pageLabel);
      row.addEventListener("click", () => {
        doc.selectedOutlineId = item.id;
        updatePdfOutlinePanel(doc);
        gotoPdfOutlineItem(doc, item);
      });
      row.addEventListener("dblclick", (event) => { event.preventDefault(); renamePdfOutlineItem(doc, item.id); });
      list.appendChild(row);
      if (Array.isArray(item.items) && item.items.length) addItems(item.items, depth + 1);
    }
  };
  addItems(doc.pdfOutline || [], 0);
  if (!list.childElementCount){
    const empty = document.createElement("div"); empty.className = "pdf-outline-empty";
    empty.textContent = "책갈피가 없습니다. ‘＋ 현재 페이지’를 눌러 추가하세요.";
    list.appendChild(empty);
  }
  if (doc.outlineCountLabel) doc.outlineCountLabel.textContent = countPdfOutlineItems(doc.pdfOutline) + "개";
  const loc = pdfOutlineLocation(doc.pdfOutline, doc.selectedOutlineId);
  const locked = typeof isPdfReferenceLocked === "function" && isPdfReferenceLocked(doc);
  const b = doc.outlineButtons || {};
  if (b.add) b.add.disabled = locked;
  for (const key of ["rename", "remove", "up", "down", "outdent", "indent"]) if (b[key]) b[key].disabled = locked || !loc;
  if (loc){
    if (b.up) b.up.disabled = locked || loc.index <= 0;
    if (b.down) b.down.disabled = locked || loc.index >= loc.list.length - 1;
    if (b.indent) b.indent.disabled = locked || loc.index <= 0;
    if (b.outdent) b.outdent.disabled = locked || !loc.parent;
  }
}

function canEditPdfOutline(doc){
  if (!doc || doc.kind !== "pdf") return false;
  if (typeof isPdfReferenceLocked === "function" && isPdfReferenceLocked(doc)){
    if (typeof explainPdfReferenceLocked === "function") explainPdfReferenceLocked();
    return false;
  }
  return true;
}

function commitPdfOutlineEdit(doc, message){
  updatePdfOutlinePanel(doc);
  updatePdfOutlineButton(doc);
  recordPdfEdit(doc);
  if (message) toast(message, 1800, { type: "success" });
}

async function addPdfOutlineItem(doc){
  if (!canEditPdfOutline(doc)) return;
  const page = doc.pages[currentPageIndex(doc)];
  if (!page){ toast("책갈피를 추가할 페이지를 찾지 못했어요.", 2200); return; }
  const displayPage = doc.pages.indexOf(page) + 1;
  const entered = await askText({ title: "책갈피 추가", message: displayPage + "페이지의 목차 이름을 입력하세요.",
    value: "페이지 " + displayPage, placeholder: "예: 1장 시작", okText: "추가" });
  if (entered == null) return;
  const title = String(entered).replace(/\s+/g, " ").trim();
  if (!title){ toast("책갈피 이름을 입력하세요.", 1800); return; }
  const item = restorePdfOutlineItems([{ title, originalIndex: page.originalIndex, items: [] }])[0];
  const loc = pdfOutlineLocation(doc.pdfOutline, doc.selectedOutlineId);
  if (loc) loc.list.splice(loc.index + 1, 0, item); else doc.pdfOutline.push(item);
  doc.selectedOutlineId = item.id;
  commitPdfOutlineEdit(doc, "현재 페이지에 책갈피를 추가했어요.");
}

async function renamePdfOutlineItem(doc, id=doc && doc.selectedOutlineId){
  if (!canEditPdfOutline(doc)) return;
  const loc = pdfOutlineLocation(doc.pdfOutline, id); if (!loc) return;
  const entered = await askText({ title: "책갈피 이름 바꾸기", message: "목차에 표시할 이름을 입력하세요.",
    value: loc.item.title, okText: "변경" });
  if (entered == null) return;
  const title = String(entered).replace(/\s+/g, " ").trim();
  if (!title){ toast("책갈피 이름을 입력하세요.", 1800); return; }
  loc.item.title = title;
  doc.selectedOutlineId = loc.item.id;
  commitPdfOutlineEdit(doc, "책갈피 이름을 바꿨어요.");
}

async function deletePdfOutlineItem(doc){
  if (!canEditPdfOutline(doc)) return;
  const loc = pdfOutlineLocation(doc.pdfOutline, doc.selectedOutlineId); if (!loc) return;
  const descendants = countPdfOutlineItems(loc.item.items);
  const detail = descendants ? "와 하위 항목 " + descendants + "개를" : "을";
  if (!(await confirmDialog("‘" + loc.item.title + "’" + detail + " 삭제할까요?", "삭제", "취소"))) return;
  loc.list.splice(loc.index, 1);
  doc.selectedOutlineId = null;
  commitPdfOutlineEdit(doc, "책갈피를 삭제했어요.");
}

function movePdfOutlineItem(doc, direction){
  if (!canEditPdfOutline(doc)) return false;
  const loc = pdfOutlineLocation(doc.pdfOutline, doc.selectedOutlineId); if (!loc) return false;
  const target = loc.index + direction;
  if (target < 0 || target >= loc.list.length) return false;
  loc.list.splice(loc.index, 1); loc.list.splice(target, 0, loc.item);
  commitPdfOutlineEdit(doc);
  return true;
}

function indentPdfOutlineItem(doc){
  if (!canEditPdfOutline(doc)) return false;
  const loc = pdfOutlineLocation(doc.pdfOutline, doc.selectedOutlineId); if (!loc || loc.index <= 0) return false;
  const parent = loc.list[loc.index - 1];
  loc.list.splice(loc.index, 1);
  if (!Array.isArray(parent.items)) parent.items = [];
  parent.items.push(loc.item);
  commitPdfOutlineEdit(doc);
  return true;
}

function outdentPdfOutlineItem(doc){
  if (!canEditPdfOutline(doc)) return false;
  const loc = pdfOutlineLocation(doc.pdfOutline, doc.selectedOutlineId); if (!loc || !loc.parent) return false;
  const parentLoc = pdfOutlineLocation(doc.pdfOutline, loc.parent.id); if (!parentLoc) return false;
  loc.list.splice(loc.index, 1);
  parentLoc.list.splice(parentLoc.index + 1, 0, loc.item);
  commitPdfOutlineEdit(doc);
  return true;
}

function removePdfOutlinePages(doc, removedOriginalIds){
  if (!doc || !Array.isArray(doc.pdfOutline)) return;
  const removed = removedOriginalIds instanceof Set ? removedOriginalIds : new Set(removedOriginalIds || []);
  const visit = (items) => {
    const out = [];
    for (const item of items){
      item.items = visit(Array.isArray(item.items) ? item.items : []);
      if (Number.isInteger(item.originalIndex) && removed.has(item.originalIndex)) out.push(...item.items);
      else out.push(item);
    }
    return out;
  };
  doc.pdfOutline = visit(doc.pdfOutline);
  if (!pdfOutlineLocation(doc.pdfOutline, doc.selectedOutlineId)) doc.selectedOutlineId = null;
  updatePdfOutlinePanel(doc);
  updatePdfOutlineButton(doc);
}

// 책갈피 목적지(dest) → 원본 페이지 번호(1-기준). 결과는 항목에 캐시한다.
async function resolvePdfOutlinePage(doc, item){
  if (item.__pageNum !== undefined) return item.__pageNum;
  let n = null;
  try {
    let dest = item.dest;
    if (typeof dest === "string") dest = await doc.pdfjsDoc.getDestination(dest);
    const ref = Array.isArray(dest) ? dest[0] : null;
    if (typeof ref === "number") n = ref + 1;                                  // 일부 PDF 는 페이지 인덱스를 직접 담는다
    else if (ref) n = (await doc.pdfjsDoc.getPageIndex(ref)) + 1;
  } catch(_){ n = null; }
  item.__pageNum = n;
  return n;
}

function gotoPdfOutlineItem(doc, item){
  if (item.url && !Number.isInteger(item.originalIndex)){                 // 외부 링크형 책갈피
    if (/^(https?:|mailto:)/i.test(item.url)) window.open(item.url, "_blank", "noopener");
    return;
  }
  const page = Number.isInteger(item.originalIndex) ? doc.pages.find(p => p.originalIndex === item.originalIndex) : null;
  if (!page){ toast("이 목차 항목의 위치를 찾지 못했어요.", 2200); return; }
  if (typeof pdfIsSinglePage === "function" && pdfIsSinglePage(doc)) showPdfSinglePage(doc, doc.pages.indexOf(page));
  else page.frame.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function extractPdfPages(doc){
  const pages = selectedPdfPages(doc);
  if (!pages.length) return;
  showLoading("선택 페이지 추출 중…");
  try {
    const ids = new Set(pages.map(p => p.originalIndex));
    const bytes = await buildPdfBytes(doc, ids);
    downloadPdfBytes(bytes, doc.fileName.replace(/\.pdf$/i, "") + "_pages.pdf");
    toast(window.tf("{n}개 페이지를 저장했어요.", { n: pages.length }));
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
  removePdfOutlinePages(doc, new Set(pages.map(p => p.originalIndex)));
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
    writePdfOutline(merged, doc.pdfOutline, doc.pages);   // 현재 문서의 책갈피는 합친 PDF의 앞부분에도 유지
    downloadPdfBytes(await merged.save(), doc.fileName.replace(/\.pdf$/i, "") + "_merged.pdf");
    toast(`${files.length + 1}개 PDF를 합쳤어요.`);
  } catch(e){ console.error(e); toast("PDF 합치기에 실패했습니다. 암호 파일인지 확인하세요.", 3500); }
  finally { hideLoading(); }
}
