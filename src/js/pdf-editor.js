"use strict";

/* ===== 화면 확대/축소 =====
   줌은 즉시 CSS transform 으로 반영(빠른 피드백)하고, 잠시 뒤 "보이는 페이지"를 그 배율로 재렌더해
   크롬처럼 어느 배율에서도 선명하게 만든다. 레이아웃/오버레이 좌표는 p.scale 고정이라
   서명·텍스트 좌표계(offsetLeft 기준)와 export(offsetLeft/p.scale)에는 영향이 없다. */
function applyPageZoom(p, z){
  const r = ((p.exportRotation || 0) % 360 + 360) % 360;
  let rotate = "";
  if (r === 90) rotate = ` translateX(${p.cssH}px) rotate(90deg)`;
  else if (r === 180) rotate = ` translate(${p.cssW}px,${p.cssH}px) rotate(180deg)`;
  else if (r === 270) rotate = ` translateY(${p.cssW}px) rotate(270deg)`;
  p.pageEl.style.transform = `scale(${z})${rotate}`;
  const swapped = r === 90 || r === 270;
  p.frame.style.width  = ((swapped ? p.cssH : p.cssW) * z) + "px";
  p.frame.style.height = ((swapped ? p.cssW : p.cssH) * z) + "px";
}
let zoomQualityTimer = null;
function scheduleQualityRefresh(doc){
  clearTimeout(zoomQualityTimer);
  zoomQualityTimer = setTimeout(() => refreshVisibleQuality(doc), 150);   // 연속 줌은 합쳐서 1회만 재렌더
}
// 현재 보이는 페이지를 새 배율 해상도로 다시 그린다(지연 렌더 구조 재활용; renderPageCanvas 가 필요할 때만 갱신).
function refreshVisibleQuality(doc){
  if (!doc || doc.closed || doc.kind !== "pdf" || !doc.pages) return;
  doc.pages.forEach(p => { if (p.visible) requestPageRender(doc, p); });   // 큐를 거쳐 보이는 쪽부터
}
function setPdfZoom(z, doc){
  doc = doc || state;
  if (!doc || doc.kind !== "pdf") return;
  z = Math.max(0.3, Math.min(4, Math.round(z * 100) / 100));
  // 줌 변경 전: 화면 맨 위에 걸친 페이지와 그 안에서의 위치 비율을 기록한다.
  // 줌으로 페이지 높이가 달라져도 같은 페이지가 같은 위치에 머물게(분할바 드래그·확대/축소 공통).
  const host = doc.el;
  let anchor = null;
  if (host && doc.pages && doc.pages.length){
    const hostTop = host.getBoundingClientRect().top;
    for (const p of doc.pages){
      if (!p.frame) continue;
      const r = p.frame.getBoundingClientRect();
      if (r.height <= 0) continue;
      if (r.bottom >= hostTop){                  // 화면 위 경계에 처음 걸리는 페이지
        anchor = { frame: p.frame, ratio: Math.max(0, Math.min(1, (hostTop - r.top) / r.height)) };
        break;
      }
    }
  }
  doc.zoom = z;
  doc.pages.forEach(p => applyPageZoom(p, z));   // 즉시 CSS 확대(빠른 피드백)
  updateZoomLabel();
  if (anchor){                                   // 줌 후: 같은 페이지·비율이 맨 위에 오도록 스크롤 보정
    const r = anchor.frame.getBoundingClientRect();
    const hostTop = host.getBoundingClientRect().top;
    host.scrollTop += r.top - (hostTop - anchor.ratio * r.height);
  }
  scheduleQualityRefresh(doc);                   // 잠시 뒤 보이는 페이지를 그 배율로 재렌더 → 선명
  if (typeof refreshPdfSelHighlight === "function") refreshPdfSelHighlight();   // 줌 후 선택 막대 위치 재계산
}
function updateZoomLabel(){
  const z = (state && state.kind === "pdf") ? (state.zoom || 1) : 1;
  const lbl = byId("zoomLabel");
  if (lbl) lbl.textContent = Math.round(z * 100) + "%";
  const fsLbl = byId("fsZoomLabel");
  const fsDoc = fullscreenPdfTarget();
  if (fsLbl) fsLbl.textContent = Math.round(((fsDoc && fsDoc.zoom) || 1) * 100) + "%";
}

// 전체화면 컨트롤이 조작할 PDF: 학습 화면은 고정된 참조 PDF, 일반 화면은 활성 PDF.
function fullscreenPdfTarget(){
  const content = byId("content");
  if (content && content.classList.contains("study-mode")){
    const ref = docs.find(d => d.id === studyPdfId && d.kind === "pdf");
    if (ref) return ref;
  }
  return state && state.kind === "pdf" ? state : null;
}

/* ===== 현재 보고 있는 페이지 ===== */
function currentPageIndex(doc=state){
  if (!doc || doc.kind !== "pdf" || !doc.pages || !doc.pages.length) return 0;
  const host = doc.el || viewer;
  const vr = host.getBoundingClientRect();
  const center = vr.top + vr.height/2;
  let best = 0, bestD = Infinity;
  doc.pages.forEach((p,i) => {
    const r = p.pageEl.getBoundingClientRect();
    const d = Math.abs((r.top + r.height/2) - center);
    if (d < bestD){ bestD = d; best = i; }
  });
  return best;
}

// 헤더·전체화면의 '현재 / 총 페이지' 표시 갱신(입력 중이면 사용자가 친 값은 건드리지 않음)
function updatePdfPageIndicator(doc=state){
  const pdf = (doc && doc.kind === "pdf" && doc.pages && doc.pages.length) ? doc : null;
  const total = pdf ? pdf.pages.length : 0;
  const cur = pdf ? currentPageIndex(pdf) + 1 : 0;
  const input = byId("pageNum"), tot = byId("pageTotal");
  if (input && document.activeElement !== input) input.value = pdf ? String(cur) : "";
  if (tot) tot.textContent = "/ " + total;
  updateFullscreenPageIndicator();
}
function updateFullscreenPageIndicator(){
  const input = byId("fsPageNum"), tot = byId("fsPageTotal"), ctl = byId("fsPageCtl");
  if (!input || !tot || !ctl) return;
  const doc = fullscreenPdfTarget();
  const pdf = doc && doc.pages && doc.pages.length ? doc : null;
  ctl.hidden = !pdf;
  if (document.activeElement !== input) input.value = pdf ? String(currentPageIndex(pdf) + 1) : "";
  tot.textContent = "/ " + (pdf ? pdf.pages.length : 0);
}
// 학습 화면: 고정된 PDF(studyPdfId) 기준으로 떠 있는 페이지 컨트롤 갱신
function updateStudyPageIndicator(){
  const input = byId("studyPageNum"), tot = byId("studyPageTotal");
  if (!input || !tot) return;
  const ref = docs.find(d => d.id === studyPdfId && d.kind === "pdf");
  const on = ref && ref.pages && ref.pages.length && byId("content").classList.contains("study-mode");
  if (!on){ if (document.activeElement !== input) input.value = ""; tot.textContent = "/ 0"; updateFullscreenPageIndicator(); return; }
  if (document.activeElement !== input) input.value = String(currentPageIndex(ref) + 1);
  tot.textContent = "/ " + ref.pages.length;
  updateFullscreenPageIndicator();
}
// 입력한 페이지로 이동: 해당 페이지 위쪽을 화면 상단 근처로 스크롤
function goToPdfPage(doc, n){
  if (!doc || doc.kind !== "pdf" || !doc.pages || !doc.pages.length) return;
  const idx = Math.max(0, Math.min(doc.pages.length - 1, (parseInt(n, 10) || 1) - 1));
  const p = doc.pages[idx];
  if (!p || !p.frame) return;
  const fr = p.frame.getBoundingClientRect(), hr = doc.el.getBoundingClientRect();
  doc.el.scrollTop += fr.top - hr.top - 8;
  startLazyRender(doc);                 // 점프 위치 주변 페이지 렌더 보장
  updatePdfPageIndicator(doc);
}

/* ===== 요소 선택/삭제 ===== */
function selectEl(el, doc){
  doc = doc || (el && el.__doc) || state;
  if (!doc || doc.kind !== "pdf") return;
  if (doc.selected && doc.selected !== el) doc.selected.classList.remove("selected");
  doc.selected = el;
  if (el) el.classList.add("selected");
}
// 학습 화면에서는 활성 문서(state)가 Python이므로 PDF 오버레이만으로는 선택 해제가 되지 않는다.
// 선택된 요소 바깥 어디든 누르면 해당 PDF의 테두리·삭제 버튼을 즉시 숨긴다.
document.addEventListener("pointerdown", (e) => {
  docs.forEach((doc) => {
    if (doc.kind !== "pdf" || !doc.selected) return;
    if (!doc.selected.contains(e.target)) selectEl(null, doc);
  });
}, true);
function removeEl(el){
  const doc = (el && el.__doc) || state;
  if (!doc || doc.kind !== "pdf") return;
  if (isPdfReferenceLocked(doc)){ explainPdfReferenceLocked(); return; }
  doc.elements = doc.elements.filter(x => x.el !== el);
  if (doc.selected === el) doc.selected = null;
  el.remove();
  recordPdfEdit(doc);
}

/* ===== 공통: 배치 요소 생성 ===== */
function placeBase(pageIndex, kind, doc=state){
  if (!doc || doc.kind !== "pdf") return null;
  const p = doc.pages[pageIndex];
  if (!p) return null;
  const el = document.createElement("div");
  el.className = "placed";
  el.__kind = kind;
  el.__doc = doc;

  // 컨트롤 바 (삭제 + 텍스트면 글자크기/색상)
  const ctrl = document.createElement("div");
  ctrl.className = "ctrl";
  ctrl.addEventListener("pointerdown", e => e.stopPropagation());
  const isText = (kind === "text" || kind === "date" || kind === "check");
  if (isText){
    const aMinus = btn("A−"), aPlus = btn("A+");
    aMinus.onclick = () => changeFont(el, -2);
    aPlus.onclick  = () => changeFont(el, +2);
    ctrl.append(aMinus, aPlus);
    ["#111","#1d4ed8","#dc2626","#16a34a"].forEach(c => {
      const sw = document.createElement("span");
      sw.className = "sw"; sw.style.background = c;
      sw.onclick = () => { const t = el.querySelector(".text-edit"); if (t) t.style.color = c; recordPdfEdit(doc); };
      ctrl.appendChild(sw);
    });
  }
  const del = btn("✕"); del.className = "del"; del.onclick = () => removeEl(el);
  ctrl.appendChild(del);
  el.appendChild(ctrl);

  // 위치: 현재 페이지 가시 영역 근처, 살짝 계단식
  const off = (doc.addCount++ % 8) * 14;
  const z = (doc && doc.zoom) || 1;
  const vr = doc.el.getBoundingClientRect();
  const pr = p.pageEl.getBoundingClientRect();
  let top = ((vr.top + vr.height/2) - pr.top) / z - 20 + off;   // 화면좌표→레이아웃좌표(줌 보정)
  top = Math.max(8, Math.min(top, p.pageEl.clientHeight - 60));
  el.style.left = (30 + off) + "px";
  el.style.top  = top + "px";

  p.overlay.appendChild(el);
  doc.elements.push({ el, pageIndex, kind });
  makeDraggable(el);
  return el;
}
function btn(label){ const b = document.createElement("button"); b.textContent = label; return b; }
function isPdfReferenceLocked(doc){ return typeof isStudyReferenceReadonly === "function" && isStudyReferenceReadonly(doc); }
function explainPdfReferenceLocked(){ toast("분할 작업의 참고 PDF는 읽기 전용이에요.", 2200); }
function changeFont(el, d){
  if (isPdfReferenceLocked((el && el.__doc) || state)){ explainPdfReferenceLocked(); return; }
  const t = el.querySelector(".text-edit"); if (!t) return;
  const cur = parseFloat(getComputedStyle(t).fontSize) || 18;
  t.style.fontSize = Math.max(8, Math.min(96, cur + d)) + "px";
  recordPdfEdit((el && el.__doc) || state);
}

/* ===== 이미지(서명) 요소 ===== */
function addImageElement(dataUrl, aspect, pageIndex, options={}){
  const doc = options.doc || state;
  if (!options.restoring && isPdfReferenceLocked(doc)){ explainPdfReferenceLocked(); return null; }
  const el = placeBase(pageIndex, "signature", doc);
  if (!el) return null;
  const w = 200, h = w / aspect;
  el.style.width = w + "px";
  el.style.height = h + "px";
  el.__aspect = aspect;
  el.__dataUrl = dataUrl;
  const img = document.createElement("img");
  img.src = dataUrl; el.appendChild(img);
  const grip = document.createElement("div");
  grip.className = "grip"; el.appendChild(grip);
  makeResizable(el, grip);
  if (!options.restoring){ selectEl(el, doc); recordPdfEdit(doc); }
  return el;
}

/* ===== 텍스트류 요소 ===== */
function addTextElement(kind, opts={}){
  const doc = opts.doc || state;
  if (!opts.restoring && isPdfReferenceLocked(doc)){ explainPdfReferenceLocked(); return null; }
  const pageIndex = Number.isInteger(opts.pageIndex) ? opts.pageIndex : currentPageIndex(doc);
  const el = placeBase(pageIndex, kind, doc);
  if (!el) return null;
  const t = document.createElement("div");
  t.className = "text-edit";
  if (opts.fontSize) t.style.fontSize = opts.fontSize + "px";
  if (opts.color)    t.style.color = opts.color;
  if (opts.bold)     t.style.fontWeight = "700";
  if (opts.fontWeight) t.style.fontWeight = opts.fontWeight;
  if (opts.text)     t.textContent = opts.text;
  el.appendChild(t);

  // 더블클릭으로 편집, 추가 직후엔 바로 편집모드
  el.addEventListener("dblclick", () => startEdit(t));
  t.addEventListener("input", () => recordPdfEdit(doc, 400));
  t.addEventListener("blur", () => { t.contentEditable = "false"; recordPdfEdit(doc); });
  t.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); document.execCommand("insertLineBreak"); }
  });
  if (!opts.restoring){
    selectEl(el, doc);
    startEdit(t);
    recordPdfEdit(doc);
  }
  return el;
}

function addCodeLinkElement(target, opts={}){
  const doc = opts.doc || state;
  const pageIndex = Number.isInteger(opts.pageIndex) ? opts.pageIndex : currentPageIndex(doc);
  const el = placeBase(pageIndex, "code-link", doc);
  if (!el) return null;
  el.classList.add("code-link");                 // 선택 테두리·기본 ✕ 컨트롤바를 코드핀 전용으로 숨기기 위한 표식
  const line = Math.max(1, parseInt(target && target.line, 10) || 1);
  const label = String(opts.label || (target && target.label) || ("L" + line)).slice(0, 32);
  el.__codeTarget = { ...(target || {}), line, label };
  el.style.width = (opts.widthPx || 54) + "px";
  el.style.height = (opts.heightPx || 24) + "px";
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "code-link-pin";
  pin.textContent = label;
  pin.title = "Go to " + ((target && (target.name || target.workspacePath)) || "code") + ":" + line;
  // 마우스는 makeDraggable 의 pointerup 이 이동/열기를 구분한다. 키보드 click(detail=0)만 여기서 연다.
  pin.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.detail === 0) openCodeLink(el);
  });
  el.appendChild(pin);
  // 삭제: 큰 ✕ 컨트롤바·선택 테두리 대신, 핀에 마우스를 올렸을 때만 나타나는 작은 ✕(모서리)로 처리.
  const delBtn = document.createElement("button");
  delBtn.type = "button"; delBtn.className = "code-link-del"; delBtn.textContent = "✕";
  delBtn.title = "이 연결 핀 삭제";
  delBtn.addEventListener("pointerdown", (e) => e.stopPropagation());   // 드래그/선택이 시작되지 않게
  delBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); removeEl(el); });
  el.appendChild(delBtn);
  if (!opts.restoring) recordPdfEdit(doc);        // 생성 시 선택 안 함(선택 테두리·컨트롤바 노출 방지)
  return el;
}

function isPythonCodeDoc(doc){
  const name = String((doc && (doc.workspacePath || doc.name)) || "");
  return !!(doc && !doc.closed && /\.py$/i.test(name));
}

function findCodeLinkDoc(target){
  if (target && target.docId){
    const byId = docs.find(d => d.id === target.docId && isPythonCodeDoc(d));
    if (byId) return byId;
  }
  const path = String((target && target.workspacePath) || "").replace(/\\/g, "/");
  if (path){
    const byPath = docs.find(d => isPythonCodeDoc(d) && String(d.workspacePath || "").replace(/\\/g, "/") === path);
    if (byPath) return byPath;
  }
  const name = String((target && target.name) || "").toLowerCase();
  if (name) return docs.find(d => isPythonCodeDoc(d) && String(d.name || "").toLowerCase() === name) || null;
  return null;
}

function activeCodeLinkDoc(){
  const active = docs.find(d => d.id === activeId && isPythonCodeDoc(d) && d.codeEditor);
  if (active) return active;
  const last = docs.find(d => d.id === window.__lastCodeLinkDocId && isPythonCodeDoc(d) && d.codeEditor);
  if (last) return last;
  return docs.find(d => isPythonCodeDoc(d) && d.codeEditor) || null;
}

function codeLinkTargetFromDoc(doc){
  if (!doc || !doc.codeEditor) return null;
  const line = Math.max(1, doc.codeEditor.getCursorLine ? doc.codeEditor.getCursorLine() : 1);
  // 줄 내용을 앵커로 함께 저장 → 코드에 줄이 추가/삭제돼도 핀이 같은 코드 줄을 다시 찾아간다(자가 치유).
  const src = doc.codeEditor.getValue ? doc.codeEditor.getValue() : "";
  const lineText = (src.split("\n")[line - 1] || "").trim().slice(0, 160);
  return {
    docId: doc.id,
    name: doc.name,
    workspacePath: doc.workspacePath || doc.name,
    line,
    lineText,
    label: "L" + line
  };
}

/* ===== 코드 → PDF 역방향 핀 =====
   PDF에 찍힌 code-link 핀들을 코드 문서 기준으로 되짚어, 편집기 거터에 마커를 띄우고
   클릭하면 해당 PDF 핀으로 이동(revealCodeLinkPin)하게 한다. 줄 번호는 앵커로 자가 치유한다. */

// target.lineText(앵커)로 현재 코드에서 실제 줄을 다시 찾는다. 그대로면 저장된 줄, 어긋났으면 가장 가까운 동일 줄.
function resolveCodeLinkLine(lines, target, pinEl){
  const stored = Math.max(1, parseInt(target && target.line, 10) || 1);
  const anchor = (target && typeof target.lineText === "string") ? target.lineText.trim() : "";
  if (!anchor || !lines) return stored;
  if ((lines[stored - 1] || "").trim() === anchor) return stored;       // 위치 그대로
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < lines.length; i++){
    if ((lines[i] || "").trim() === anchor){
      const dist = Math.abs(i + 1 - stored);
      if (dist < bestDist){ bestDist = dist; best = i + 1; }
    }
  }
  if (best && best !== stored){
    target.line = best; target.label = "L" + best;                      // 메모리 자가 치유(다음 PDF 편집 때 영속화)
    if (pinEl){ const b = pinEl.querySelector(".code-link-pin"); if (b) b.textContent = "L" + best; }
  }
  return best || stored;
}

// 주어진 코드 문서를 가리키는 모든 PDF 핀을 모은다 → [{pdfDoc, el, target, line, label}]
function codeLinksTargetingDoc(codeDoc){
  if (!codeDoc) return [];
  const src = (codeDoc.codeEditor && codeDoc.codeEditor.getValue) ? codeDoc.codeEditor.getValue() : null;
  const lines = src === null ? null : src.split("\n");
  const out = [];
  for (const d of docs){
    if (!d || d.kind !== "pdf" || d.closed) continue;
    for (const item of d.elements || []){
      if (!item || item.kind !== "code-link" || !item.el) continue;
      const t = item.el.__codeTarget;
      if (!t || findCodeLinkDoc(t) !== codeDoc) continue;
      const line = resolveCodeLinkLine(lines, t, item.el);
      out.push({ pdfDoc: d, el: item.el, target: t, line, label: t.label || ("L" + line) });
    }
  }
  return out;
}

// 열린 코드 편집기들에 "핀 마커 다시 그려라" 통지(핀 추가·이동·삭제 후). 가벼우므로 살짝 디바운스.
let _codePinRefreshTimer = 0;
function refreshCodePinMarkers(){
  clearTimeout(_codePinRefreshTimer);
  _codePinRefreshTimer = setTimeout(() => {
    for (const d of docs){
      if (d && d.codeEditor && typeof d.codeEditor.refreshPins === "function") d.codeEditor.refreshPins();
    }
  }, 60);
}

// 코드 거터 마커 클릭 → 해당 PDF 핀으로 이동하고 잠깐 강조.
async function revealCodeLinkPin(pdfDoc, pinEl){
  if (!pdfDoc || !pinEl) return;
  // 학습 화면이 아니면 진입해서 PDF·코드를 나란히 두고 핀을 보여준다(코드 시야 유지 — PDF→코드 이동의 대칭).
  const enteredStudy = (typeof studyPdfId !== "undefined") && studyPdfId === null &&
    pdfDoc.kind === "pdf" && typeof startStudyModeWithPdf === "function" && startStudyModeWithPdf(pdfDoc, { silent:true });
  const isStudyRef = (typeof studyPdfId !== "undefined") && studyPdfId === pdfDoc.id;   // 학습 화면 좌측 참조면 활성 전환 불필요
  if (!enteredStudy && !isStudyRef && pdfDoc.id !== activeId && typeof setActiveDoc === "function") setActiveDoc(pdfDoc.id);
  if (typeof ensureRendered === "function") await ensureRendered(pdfDoc);
  requestAnimationFrame(() => {
    const host = pdfDoc.el;
    if (host && pinEl.isConnected){
      const er = pinEl.getBoundingClientRect(), hr = host.getBoundingClientRect();
      host.scrollTop += (er.top - hr.top) - host.clientHeight * 0.35;       // 핀을 화면 상단 1/3 근처로
    }
    if (typeof startLazyRender === "function") startLazyRender(pdfDoc);
    selectEl(pinEl, pdfDoc);
    pinEl.classList.add("code-link-flash");
    setTimeout(() => pinEl.classList.remove("code-link-flash"), 1500);
    if (typeof updatePdfPageIndicator === "function") updatePdfPageIndicator(pdfDoc);
  });
}

function targetPdfForCodeLink(){
  const study = docs.find(d => d.id === studyPdfId && d.kind === "pdf");
  if (study) return study;                          // 분할 참고 칸의 PDF(화면에 보이는 대상)
  if (state && state.kind === "pdf") return state;  // (드묾) 활성 문서 자체가 PDF
  return null;                                      // 화면에 안 보이는 배경 PDF로는 전환하지 않음 — 편집 칸이 엉뚱한 PDF로 바뀌는 것 방지
}

function createCodeLinkFromCodeDoc(codeDoc){
  const pdfDoc = targetPdfForCodeLink();
  if (!pdfDoc){ toast("옆 화면에 PDF를 두고 잠금을 푼 뒤 핀을 꽂아 주세요.", 3200); return; }
  if (isPdfReferenceLocked(pdfDoc)){ explainPdfReferenceLocked(); return; }
  codeDoc = codeDoc || activeCodeLinkDoc();
  const target = codeLinkTargetFromDoc(codeDoc);
  if (!target){ toast("Open a Python file and place the cursor on a line first.", 3000); return; }
  const el = addCodeLinkElement(target, { doc: pdfDoc });
  if (!el) return;
  if (pdfDoc.id !== activeId && studyPdfId !== pdfDoc.id) setActiveDoc(pdfDoc.id);
  toast("Code link pinned to the PDF.", 1800);
}

function createCodeLinkFromActiveEditor(){
  createCodeLinkFromCodeDoc(activeCodeLinkDoc());
}

async function openCodeLink(el){
  const target = el && el.__codeTarget;
  if (!target){ toast("This pin has no code target.", 1800); return; }
  const doc = findCodeLinkDoc(target);
  if (!doc){ toast("Open the linked Python file, then try this pin again.", 3200); return; }
  const pdfDoc = el && el.__doc;
  const enteredStudy = studyPdfId === null && pdfDoc && pdfDoc.kind === "pdf" &&
    typeof startStudyModeWithPdf === "function" && startStudyModeWithPdf(pdfDoc, { silent:true });
  window.__lastCodeLinkDocId = doc.id;
  let targetLine = target.line || 1;
  doc.pendingFocusLine = targetLine;                    // 렌더가 늦어도 editor 부착 시 renderCode 가 소비
  setActiveDoc(doc.id);
  if (typeof ensureRendered === "function") await ensureRendered(doc);
  if (doc.codeEditor && doc.codeEditor.focusLine && doc.pendingFocusLine){
    // 편집기가 붙은 뒤엔 앵커로 실제 줄을 다시 확정(코드가 그새 바뀌었어도 맞는 줄로).
    targetLine = resolveCodeLinkLine(doc.codeEditor.getValue().split("\n"), target, el);
    doc.pendingFocusLine = 0;
    doc.codeEditor.focusLine(targetLine);
  }
  toast(enteredStudy
    ? doc.name + ":" + targetLine + " 줄을 분할 작업 화면에서 열었어요."
    : "Moved to " + doc.name + ":" + targetLine, enteredStudy ? 2200 : 1600);
}

/* ===== PDF 내 찾기(Ctrl+F) — 텍스트 기반 PDF에서 단어를 찾아 페이지 위에 하이라이트 =====
   하이라이트 박스는 각 페이지 pageEl 안의 전용 레이어에 p.scale CSS 좌표로 넣는다.
   pageEl 에는 줌/회전 CSS transform 이 걸려 있어 박스도 함께 변형 → 스크롤·줌 시 재계산이 필요 없다(가볍다).
   글자 위치는 매치가 있는 페이지만 getTextContent 로 그때그때 계산하고 검색을 닫으면 비운다. */
const PDF_FIND_MAX_PAGES = 300;     // 좌표 계산 페이지 상한
const PDF_FIND_MAX_BOXES = 4000;    // 동시에 그리는 박스 상한(메모리 보호)
let _pdfFind = null;
let _pdfFindTimer = 0;

// 일반 화면에서는 활성 PDF, 학습 화면에서는 왼쪽/오른쪽에 고정된 참조 PDF를 찾기 대상으로 삼는다.
function pdfFindTarget(){
  const content = byId("content");
  if (content && content.classList.contains("study-mode")){
    const ref = docs.find(doc => doc.id === studyPdfId && doc.kind === "pdf");
    if (ref) return ref;
  }
  return state && state.kind === "pdf" ? state : null;
}

function ensurePdfFindBar(){
  if (_pdfFind) return _pdfFind;
  const bar = document.createElement("div"); bar.className = "pdf-find"; bar.hidden = true;
  bar.innerHTML =
    '<div class="pdf-find-row">' +
      '<input type="text" class="pdf-find-input" placeholder="PDF에서 찾기" aria-label="PDF에서 찾기">' +
      '<span class="pdf-find-count" aria-live="polite"></span>' +
      '<button type="button" class="pdf-find-opt" data-opt="case" title="대소문자 구분">Aa</button>' +
      '<button type="button" class="pdf-find-opt" data-opt="word" title="단어 단위">\\b</button>' +
      '<button type="button" class="pdf-find-opt" data-opt="regex" title="정규식">.*</button>' +
      '<button type="button" class="regex-suggest-toggle" title="예시에서 정규식 추천" aria-expanded="false">패턴</button>' +
      '<button type="button" class="pdf-find-ocr" title="스캔(이미지) PDF 의 글자를 인식해 찾기·검색이 되게 하기" hidden>🔍 글자 인식</button>' +
      '<button type="button" class="pdf-find-btn" data-nav="prev" title="이전 (Shift+Enter)">↑</button>' +
      '<button type="button" class="pdf-find-btn" data-nav="next" title="다음 (Enter)">↓</button>' +
      '<button type="button" class="pdf-find-btn" data-close title="닫기 (Esc)">✕</button>' +
    '</div>' +
    '<div class="regex-suggest" hidden></div>';
  byId("content").appendChild(bar);
  _pdfFind = { bar, input: bar.querySelector(".pdf-find-input"), count: bar.querySelector(".pdf-find-count"),
    suggestPanel: bar.querySelector(".regex-suggest"), patternButton: bar.querySelector(".regex-suggest-toggle"),
    ocrBtn: bar.querySelector(".pdf-find-ocr"),
    doc: null, optCase: false, optWord: false, optRegex: false, suggestOpen: false, suggestToken: 0 };
  // 스캔 PDF 글자 인식 — 완료되면 현재 검색을 다시 계산해 하이라이트가 바로 뜬다.
  _pdfFind.ocrBtn.addEventListener("click", () => {
    const doc = _pdfFind.doc;
    if (!doc || typeof pdfOcrToggle !== "function") return;
    pdfOcrToggle(doc, _pdfFind.ocrBtn, () => {
      if (_pdfFind && _pdfFind.doc === doc){
        if (_pdfFind.input.value.trim()) computePdfMatches(doc);
        else updatePdfFindCount(doc);
      }
    });
  });
  _pdfFind.input.addEventListener("input", () => {
    clearTimeout(_pdfFindTimer);
    if (_pdfFind.suggestOpen) renderPdfRegexSuggestions();
    _pdfFindTimer = setTimeout(() => { if (_pdfFind.doc) computePdfMatches(_pdfFind.doc); }, 180);
  });
  _pdfFind.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); navPdfMatch(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape"){ e.preventDefault(); closePdfFind(); }
  });
  bar.querySelectorAll(".pdf-find-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      const o = btn.dataset.opt;
      if (o === "case") _pdfFind.optCase = !_pdfFind.optCase;
      else if (o === "word") _pdfFind.optWord = !_pdfFind.optWord;
      else if (o === "regex") _pdfFind.optRegex = !_pdfFind.optRegex;
      syncPdfFindOptionButtons();
      _pdfFind.input.focus(); if (_pdfFind.doc) computePdfMatches(_pdfFind.doc);
    });
  });
  _pdfFind.patternButton.addEventListener("click", () => {
    setPdfRegexSuggestionOpen(!_pdfFind.suggestOpen);
    if (!_pdfFind.suggestOpen) _pdfFind.input.focus();
  });
  bar.querySelector('[data-nav="next"]').addEventListener("click", () => navPdfMatch(1));
  bar.querySelector('[data-nav="prev"]').addEventListener("click", () => navPdfMatch(-1));
  bar.querySelector('[data-close]').addEventListener("click", closePdfFind);
  return _pdfFind;
}
function syncPdfFindOptionButtons(){
  if (!_pdfFind) return;
  _pdfFind.bar.querySelector('[data-opt="case"]').classList.toggle("on", _pdfFind.optCase);
  _pdfFind.bar.querySelector('[data-opt="word"]').classList.toggle("on", _pdfFind.optWord);
  _pdfFind.bar.querySelector('[data-opt="regex"]').classList.toggle("on", _pdfFind.optRegex);
}
function applyPdfRegexSuggestion(item){
  if (!_pdfFind) return;
  _pdfFind.input.value = item.pattern;
  _pdfFind.optRegex = true; _pdfFind.optCase = true; _pdfFind.optWord = false;
  syncPdfFindOptionButtons(); setPdfRegexSuggestionOpen(false);
  _pdfFind.input.focus();
  if (_pdfFind.doc) computePdfMatches(_pdfFind.doc);
}
async function renderPdfRegexSuggestions(){
  if (!_pdfFind || !_pdfFind.suggestOpen) return;
  const doc = _pdfFind.doc, token = ++_pdfFind.suggestToken;
  renderRegexSuggestionPanel(_pdfFind.suggestPanel, _pdfFind.input.value, undefined, applyPdfRegexSuggestion);
  if (!doc) return;
  let text = false;
  try { text = await getDocText(doc); } catch(e){}
  if (!_pdfFind || !_pdfFind.suggestOpen || _pdfFind.doc !== doc || _pdfFind.suggestToken !== token) return;
  renderRegexSuggestionPanel(_pdfFind.suggestPanel, _pdfFind.input.value,
    typeof text === "string" ? text : false, applyPdfRegexSuggestion);
}
function setPdfRegexSuggestionOpen(open){
  if (!_pdfFind) return;
  _pdfFind.suggestOpen = !!open;
  _pdfFind.suggestPanel.hidden = !_pdfFind.suggestOpen;
  _pdfFind.patternButton.classList.toggle("on", _pdfFind.suggestOpen);
  _pdfFind.patternButton.setAttribute("aria-expanded", String(_pdfFind.suggestOpen));
  if (_pdfFind.suggestOpen) renderPdfRegexSuggestions();
  else _pdfFind.suggestToken++;
}
async function openPdfFind(targetDoc){
  const target = targetDoc && targetDoc.kind === "pdf" ? targetDoc : pdfFindTarget();
  if (!target){ toast("PDF를 먼저 열어 주세요.", 1800); return; }
  const f = ensurePdfFindBar();
  if (f.doc && f.doc !== target) clearPdfFindHighlights(f.doc);   // 다른 PDF로 바뀌면 이전 하이라이트 정리
  f.doc = target;
  const content = byId("content");
  f.bar.classList.toggle("study-target", !!(content && content.classList.contains("study-mode") && target.id === studyPdfId));
  f.bar.hidden = false;
  // PDF 본문에서 드래그해 둔 글자가 있으면 검색어로 딸려간다(이 PDF 안의 선택만, 한 줄·200자 이내).
  const seed = typeof currentSelectionSeed === "function" ? currentSelectionSeed(target.el) : "";
  if (seed && seed !== f.input.value.trim()) f.input.value = seed;
  f.input.focus(); f.input.select();
  if (f.ocrBtn && !target._ocrRunning) f.ocrBtn.hidden = true;   // 문서가 바뀌었을 수 있으니 일단 감춤(아래 판정 후 표시)
  if (typeof ensureRendered === "function") await ensureRendered(target);   // placeholder(페이지·오버레이) 보장
  if (f.input.value.trim()) computePdfMatches(target);
  else updatePdfFindCount(target);
  // 스캔본(추출·OCR 텍스트 모두 없음) 판정은 비동기로 — 끝나면 글자 인식 버튼을 보여준다.
  (async () => {
    try {
      const text = await getDocText(target);
      if (_pdfFind && _pdfFind.doc === target && _pdfFind.ocrBtn && text === false) _pdfFind.ocrBtn.hidden = false;
    } catch(e){}
  })();
}
function closePdfFind(){
  if (!_pdfFind) return;
  if (_pdfFind.doc) clearPdfFindHighlights(_pdfFind.doc);
  setPdfRegexSuggestionOpen(false);
  if (_pdfFind.ocrBtn && !(_pdfFind.doc && _pdfFind.doc._ocrRunning)) _pdfFind.ocrBtn.hidden = true;
  _pdfFind.bar.hidden = true;
  _pdfFind.bar.classList.remove("study-target");
  _pdfFind.doc = null;
}
function syncPdfFindLayout(){
  if (!_pdfFind || _pdfFind.bar.hidden) return;
  const content = byId("content");
  _pdfFind.bar.classList.toggle("study-target", !!(content && content.classList.contains("study-mode") &&
    _pdfFind.doc && _pdfFind.doc.id === studyPdfId));
}
function buildPdfFindRegex(global){
  const q = _pdfFind.input.value;
  if (!q) return null;
  let pat = _pdfFind.optRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  if (_pdfFind.optWord) pat = "(?:^|\\b)(?:" + pat + ")(?:\\b|$)";
  return new RegExp(pat, (global ? "g" : "") + (_pdfFind.optCase ? "" : "i"));
}
function ensureFindLayer(p){
  if (!p.findLayer || !p.findLayer.isConnected){
    p.findLayer = document.createElement("div");
    p.findLayer.className = "pdf-find-layer";
    p.pageEl.appendChild(p.findLayer);
  }
  return p.findLayer;
}
function clearPdfFindHighlights(doc){
  if (doc && doc.pages) doc.pages.forEach(p => { if (p.findLayer){ p.findLayer.remove(); p.findLayer = null; } });
  if (doc && doc._pdfFind){ doc._pdfFind.matches = []; doc._pdfFind.active = -1; }
}
// 행렬 곱(pdf.js Util.transform 과 동일) — 버전 차이에 무관하게 직접 계산.
function mulMatrix(a, b){
  return [ a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
           a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5] ];
}
// 한 페이지의 글자 문자열과 각 조각의 화면 좌표(p.scale CSS px)를 얻는다.
async function pdfPageFindData(doc, p){
  const page = await doc.pdfjsDoc.getPage(p.pageNum);
  const vp = page.getViewport({ scale: p.scale });               // 레이아웃과 동일한 배율(회전 포함)
  const tc = await page.getTextContent();
  let str = "", items = [];
  for (const it of tc.items){
    const s = (it && it.str) || "";
    if (s){
      const t = mulMatrix(vp.transform, it.transform);
      const h = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
      items.push({ off: str.length, len: s.length, x: t[4], y: t[5] - h, w: (it.width || 0) * p.scale, h });
      str += s;
    }
    str += " ";                                                  // 조각 사이 공백(검색·줄바꿈 보정)
  }
  if (typeof page.cleanup === "function") page.cleanup();
  return { str, items };
}
function rectsForRange(items, ms, me){
  const out = [];
  for (const it of items){
    const a = Math.max(ms, it.off), b = Math.min(me, it.off + it.len);
    if (a >= b || it.len <= 0) continue;
    const f0 = (a - it.off) / it.len, f1 = (b - it.off) / it.len;
    out.push({ x: it.x + it.w * f0, y: it.y, w: it.w * (f1 - f0), h: it.h });
  }
  return out;
}
async function computePdfMatches(doc){
  if (!doc || doc.kind !== "pdf" || !doc.pdfjsDoc || !_pdfFind || _pdfFind.doc !== doc) return;
  clearPdfFindHighlights(doc);
  doc._pdfFind = doc._pdfFind || {};
  doc._pdfFind.matches = []; doc._pdfFind.active = -1; doc._pdfFind.hasText = undefined;
  _pdfFind.input.classList.remove("find-bad");
  let re; try { re = buildPdfFindRegex(true); } catch(e){ _pdfFind.input.classList.add("find-bad"); updatePdfFindCount(doc); return; }
  if (!re){ updatePdfFindCount(doc); return; }
  // 어느 페이지를 볼지: 일반 모드는 A안 캐시 텍스트로 후보 페이지만 추림(가볍게). 정규식 모드는 전 페이지(상한) 스캔.
  let pageNums;
  const cached = (!_pdfFind.optRegex) ? await getDocText(doc) : false;
  let hasText = typeof cached === "string" && !!cached.trim();
  if (typeof cached === "string"){
    const probe = new RegExp(re.source, re.flags.replace("g", ""));
    pageNums = [];
    cached.split("\n").forEach((ln, i) => { if (probe.test(ln)) pageNums.push(i + 1); });
  } else {
    pageNums = doc.pages.map(p => p.pageNum);
  }
  pageNums = pageNums.slice(0, PDF_FIND_MAX_PAGES);
  const token = (doc._pdfFind.token = (doc._pdfFind.token || 0) + 1);
  for (const pn of pageNums){
    const p = doc.pages[pn - 1] || doc.pages.find(pp => pp.pageNum === pn);
    if (!p) continue;
    let data; try { data = await pdfPageFindData(doc, p); } catch(e){ continue; }
    // 글자 정보가 없는 스캔 페이지는 글자 인식(OCR) 결과(단어 좌표)로 대신 찾는다.
    if (!data.str.trim() && typeof pdfOcrFindData === "function"){
      try { const od = await pdfOcrFindData(doc, p); if (od) data = od; } catch(e){}
    }
    if (token !== doc._pdfFind.token || _pdfFind.doc !== doc) return;   // 더 새 검색·문서 전환 → 중단
    if (data.str.trim()) hasText = true;
    re.lastIndex = 0;
    let m, guard = 0;
    while ((m = re.exec(data.str)) !== null){
      const rects = rectsForRange(data.items, m.index, m.index + m[0].length);
      if (rects.length) doc._pdfFind.matches.push({ page: pn, p, rects });
      if (m[0].length === 0) re.lastIndex++;
      if (++guard > 5000) break;
    }
  }
  doc._pdfFind.hasText = hasText;
  renderPdfFindLayers(doc);
  updatePdfFindCount(doc);
  if (doc._pdfFind.matches.length) gotoPdfMatch(doc, 0);
}
function renderPdfFindLayers(doc){
  const byPage = new Map();
  doc._pdfFind.matches.forEach((mt, idx) => {
    if (!byPage.has(mt.page)) byPage.set(mt.page, []);
    byPage.get(mt.page).push({ mt, idx });
  });
  let total = 0;
  for (const [, list] of byPage){
    const layer = ensureFindLayer(list[0].mt.p);
    layer.textContent = "";
    for (const { mt, idx } of list){
      for (const r of mt.rects){
        if (++total > PDF_FIND_MAX_BOXES) return;
        const b = document.createElement("div");
        b.className = "pdf-find-box"; b.dataset.mi = String(idx);
        b.style.cssText = "left:" + r.x + "px;top:" + r.y + "px;width:" + Math.max(2, r.w) + "px;height:" + r.h + "px";
        layer.appendChild(b);
      }
    }
  }
}
function navPdfMatch(dir){
  const doc = _pdfFind && _pdfFind.doc;
  if (!doc || !doc._pdfFind || !doc._pdfFind.matches.length){ if (doc) computePdfMatches(doc); return; }
  gotoPdfMatch(doc, doc._pdfFind.active + dir);
}
function gotoPdfMatch(doc, index){
  const M = doc._pdfFind.matches; if (!M.length) return;
  index = ((index % M.length) + M.length) % M.length;
  doc._pdfFind.active = index;
  doc.pages.forEach(p => { if (p.findLayer) p.findLayer.querySelectorAll(".pdf-find-box.active").forEach(b => b.classList.remove("active")); });
  const mt = M[index];
  if (mt.p.findLayer) mt.p.findLayer.querySelectorAll('.pdf-find-box[data-mi="' + index + '"]').forEach(b => b.classList.add("active"));
  if (doc.el && mt.p.frame){     // offsetParent 에 의존하지 않게 현재 화면 위치 기준으로 스크롤 보정
    const yInFrame = (mt.rects[0] ? mt.rects[0].y : 0) * (doc.zoom || 1);
    const hostTop = doc.el.getBoundingClientRect().top, frameTop = mt.p.frame.getBoundingClientRect().top;
    doc.el.scrollTop += (frameTop - hostTop) + yInFrame - doc.el.clientHeight * 0.3;
  }
  if (mt.p.visible === false || !mt.p.rendered) startLazyRender(doc);   // 점프한 페이지 캔버스 렌더 보장
  updatePdfFindCount(doc);
}
// 활성 문서가 바뀌면(다른 파일 선택) 열려 있던 PDF 찾기 패널을 닫는다 — setActiveDoc 에서 호출.
function syncPdfFindToActive(id){
  const content = byId("content");
  const target = content && content.classList.contains("study-mode")
    ? docs.find(doc => doc.id === studyPdfId && doc.kind === "pdf")
    : docs.find(doc => doc.id === id && doc.kind === "pdf");
  if (_pdfFind && !_pdfFind.bar.hidden && (!_pdfFind.doc || !target || _pdfFind.doc.id !== target.id)) closePdfFind();
}
function updatePdfFindCount(doc){
  if (!_pdfFind) return;
  const M = doc && doc._pdfFind && doc._pdfFind.matches;
  if (!_pdfFind.input.value){ _pdfFind.count.textContent = ""; return; }
  if (doc && doc._pdfFind && doc._pdfFind.hasText === false){
    _pdfFind.count.textContent = "텍스트 없음(스캔본)";
    if (_pdfFind.ocrBtn) _pdfFind.ocrBtn.hidden = false;    // 글자 인식으로 찾을 수 있게 안내
    return;
  }
  _pdfFind.count.textContent = (M && M.length) ? ((doc._pdfFind.active + 1) + "/" + M.length) : "0/0";
}

function hydratePdfElements(doc, items){
  if (!doc || doc.kind !== "pdf") return;
  for (const item of items || []){
    const page = doc.pages[item.pageIndex];
    if (!page) continue;
    let el;
    if (item.kind === "signature" && item.dataUrl){
      el = addImageElement(item.dataUrl, item.aspect || 2, item.pageIndex, { doc, restoring: true });
      el.style.width = Math.max(30, item.width * page.cssW) + "px";
      el.style.height = Math.max(15, item.height * page.cssH) + "px";
    } else if (["text","date","check"].includes(item.kind)){
      el = addTextElement(item.kind, {
        doc, pageIndex: item.pageIndex, restoring: true, text: item.text || "",
        fontSize: item.fontSize || 18, color: item.color || "#111", fontWeight: item.fontWeight || "400"
      });
    } else if (item.kind === "code-link" && item.target){
      el = addCodeLinkElement(item.target, {
        doc, pageIndex: item.pageIndex, restoring: true, label: item.label,
        widthPx: Math.max(40, item.width * page.cssW), heightPx: Math.max(24, item.height * page.cssH)
      });
    } else if (item.kind === "ink"){
      buildInkElement(doc, item.pageIndex, item.strokes || []);   // 전체 페이지 잉크 레이어(좌표는 내부에서 0,0)
      continue;
    }
    if (!el) continue;
    el.style.left = Math.max(0, Math.min(page.cssW - 8, item.x * page.cssW)) + "px";
    el.style.top = Math.max(0, Math.min(page.cssH - 8, item.y * page.cssH)) + "px";
  }
  selectEl(null, doc);
  if (typeof refreshCodePinMarkers === "function") refreshCodePinMarkers();   // 복원된 핀을 코드 거터에도 반영
}
function startEdit(t){
  t.contentEditable = "true"; t.focus();
  const r = document.createRange(); r.selectNodeContents(t);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

/* ===== 드래그 이동 ===== */
function makeDraggable(el){
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".ctrl") || e.target.classList.contains("grip")) return;
    const t = el.querySelector(".text-edit");
    if (t && t.isContentEditable) return;        // 편집 중이면 텍스트 선택 허용
    e.preventDefault();
    const doc = el.__doc || state;
    selectEl(el, doc);
    const overlay = el.parentElement;
    const z = (doc && doc.zoom) || 1;        // 줌 중이면 화면좌표를 레이아웃좌표로 환산
    const oRect = overlay.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const offX = e.clientX - eRect.left, offY = e.clientY - eRect.top;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      let nx = (ev.clientX - oRect.left - offX) / z;
      let ny = (ev.clientY - oRect.top  - offY) / z;
      nx = Math.max(0, Math.min(nx, overlay.clientWidth  - el.offsetWidth));
      ny = Math.max(0, Math.min(ny, overlay.clientHeight - el.offsetHeight));
      if (Math.abs(nx - el.offsetLeft) > 0.5 || Math.abs(ny - el.offsetTop) > 0.5) moved = true;
      el.style.left = nx + "px"; el.style.top = ny + "px";
    };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
      if (moved) recordPdfEdit(doc);
      else if (el.__kind === "code-link") openCodeLink(el);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}

/* ===== 크기 조절 (이미지) ===== */
function makeResizable(el, grip){
  grip.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); e.preventDefault();
    const doc = el.__doc || state;
    selectEl(el, doc);
    const overlay = el.parentElement;
    const z = (doc && doc.zoom) || 1;
    const startX = e.clientX, startW = el.offsetWidth;
    const aspect = el.__aspect || (el.offsetWidth / el.offsetHeight);
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      let nw = startW + (ev.clientX - startX) / z;
      nw = Math.max(30, Math.min(nw, overlay.clientWidth - el.offsetLeft));
      el.style.width = nw + "px";
      el.style.height = (nw / aspect) + "px";
    };
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); recordPdfEdit(doc); };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
}

/* ===== 텍스트 → PNG 래스터화 (한글 등 모든 글자 지원) ===== */
function textToDataUrl(el){
  const t = el.querySelector(".text-edit");
  const cs = getComputedStyle(t);
  const fs = parseFloat(cs.fontSize);
  const text = t.innerText.replace(/\n$/, "");
  if (!text.trim()) return null;
  const w = el.offsetWidth, h = el.offsetHeight;
  const ss = Math.max(3, Math.ceil((window.devicePixelRatio || 1) * 2));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * ss));
  c.height = Math.max(1, Math.round(h * ss));
  const ctx = c.getContext("2d");
  ctx.scale(ss, ss);
  ctx.textBaseline = "top";
  ctx.fillStyle = cs.color;
  ctx.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
  const padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
  const lh = fs * 1.3;
  text.split("\n").forEach((line, i) => ctx.fillText(line, padL, padT + i * lh));
  return c.toDataURL("image/png");
}

/* ===== 저장(폴더로 연 PDF는 원본 덮어쓰기, 그 외 다운로드) ===== */
let pdfExportActive = false;
async function exportPdf(){
  const doc = state;
  if (!doc || doc.kind !== "pdf" || pdfExportActive) return;
  const outlineCount = typeof countPdfOutlineItems === "function" ? countPdfOutlineItems(doc.pdfOutline) : 0;
  if (!doc.elements.length && !outlineCount){ toast("추가한 항목이 없어요. 그래도 다운로드합니다.", 1800); }
  pdfExportActive = true;
  const downloadButton = byId("btnDownload");
  if (downloadButton){ downloadButton.disabled = true; downloadButton.setAttribute("aria-busy", "true"); }
  try {
    const bytes = await buildPdfBytes(doc);
    if (doc.originalSaveMode){
      // 폴더로 연 PDF는 코드·텍스트와 마찬가지로 원본 파일 핸들에 바로 쓴다.
      // 저장 뒤 새 바이트를 기준으로 문서를 다시 열어, 다음 저장에서 기존 편집이 중복 적용되지 않게 한다.
      const wrote = (typeof saveViaFileHandle === "function")
        ? await saveViaFileHandle(bytes, doc.fileName, doc, { existingOnly:true, mime:"application/pdf" })
        : "unsupported";
      if (wrote !== "saved"){
        toast("원본 PDF 쓰기 권한이 없어 저장하지 못했어요.", 3000, { type:"error" });
        return;
      }
      const path = String(doc.workspacePath || doc.fileName || "document.pdf").replace(/\\/g, "/").replace(/^\/+/, "");
      const updated = new File([bytes], doc.fileName || "document.pdf", { type:"application/pdf" });
      if (path.indexOf("/") >= 0) Object.defineProperty(updated, "webkitRelativePath", { value:path });
      doc.size = updated.size;
      if (typeof rememberWorkspace === "function") doc.savedInWorkspace = await rememberWorkspace([updated], false, { silent:true });
      if (doc.recoveryKey && typeof deletePdfRecovery === "function") await deletePdfRecovery(doc.recoveryKey);
      doc.recoveryDirty = false;
      if (typeof updateDocumentStatus === "function") updateDocumentStatus(doc);
      const savedId = doc.id;
      toast("원본 PDF에 저장했어요. 최신 파일로 다시 여는 중이에요.", 2200, { type:"success" });
      if (typeof refreshDocFromSource === "function") await refreshDocFromSource(savedId, { skipConfirm:true });
      return;
    }
    downloadPdfBytes(bytes, doc.fileName.replace(/\.pdf$/i, "") + "_signed.pdf");
    toast("다운로드 완료 · " + doc.fileName.replace(/\.pdf$/i, "") + "_signed.pdf", 2600, { type: "success" });
  } catch (e){
    console.error(e);
    toast("저장 중 오류가 발생했습니다.", 3000, { type: "error" });
  } finally {
    pdfExportActive = false;
    if (downloadButton){ downloadButton.disabled = false; downloadButton.removeAttribute("aria-busy"); }
  }
}

/* ===== 서명 패드 ===== */
let padCtx, padDpr, padDrawing = false, padDirty = false;
function openSig(){
  byId("sigModal").hidden = false;
  const lr = byId("lastSigRow");
  if (lastSig){ lr.hidden = false; byId("lastSigThumb").src = lastSig.dataUrl; }
  else lr.hidden = true;
  const pad = byId("sigPad");
  padDpr = window.devicePixelRatio || 1;
  const rect = pad.getBoundingClientRect();
  pad.width = Math.round(rect.width * padDpr);
  pad.height = Math.round(rect.height * padDpr);
  padCtx = pad.getContext("2d");
  padCtx.scale(padDpr, padDpr);
  padCtx.lineWidth = 2.6; padCtx.lineCap = "round"; padCtx.lineJoin = "round";
  padCtx.strokeStyle = "#111";
  padDirty = false;
  byId("sigTarget").value = "current";
  refreshSignatureLibrary();
}
function closeSig(){ byId("sigModal").hidden = true; }
function padPos(e){ const r = e.target.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function initPad(){
  const pad = byId("sigPad");
  pad.addEventListener("pointerdown", (e) => {
    padDrawing = true; padDirty = true; pad.setPointerCapture(e.pointerId);
    const { x, y } = padPos(e); padCtx.beginPath(); padCtx.moveTo(x, y);
  });
  pad.addEventListener("pointermove", (e) => {
    if (!padDrawing) return; const { x, y } = padPos(e); padCtx.lineTo(x, y); padCtx.stroke();
  });
  const stop = () => { padDrawing = false; };
  pad.addEventListener("pointerup", stop);
  pad.addEventListener("pointerleave", stop);
}
function clearPad(){ const pad = byId("sigPad"); padCtx.clearRect(0,0,pad.width,pad.height); padDirty = false; }

/* 서명 캔버스의 빈 여백을 잘라낸다 */
function trimCanvas(src){
  const W = src.width, H = src.height;
  const data = src.getContext("2d").getImageData(0,0,W,H).data;
  let minX=W, minY=H, maxX=0, maxY=0, found=false;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    if (data[(y*W+x)*4+3] > 8){ found=true;
      if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
  }
  if (!found) return null;
  const pad = 8;
  minX=Math.max(0,minX-pad); minY=Math.max(0,minY-pad);
  maxX=Math.min(W-1,maxX+pad); maxY=Math.min(H-1,maxY+pad);
  const w=maxX-minX+1, h=maxY-minY+1;
  const out = document.createElement("canvas"); out.width=w; out.height=h;
  out.getContext("2d").drawImage(src, minX,minY,w,h, 0,0,w,h);
  return { dataUrl: out.toDataURL("image/png"), aspect: w/h };
}

/* 업로드한 이미지를 서명으로: 흰 배경 제거 후 여백 잘라내기 */
function imageToSignature(img){
  const maxDim = 1000;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const sc = Math.min(1, maxDim / Math.max(w, h));
  w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h); const d = id.data;
  for (let i = 0; i < d.length; i += 4){              // 흰 배경 → 투명
    if (d[i] > 235 && d[i+1] > 235 && d[i+2] > 235) d[i+3] = 0;
  }
  ctx.putImageData(id, 0, 0);
  return trimCanvas(c);
}

async function refreshSignatureLibrary(){
  const host = byId("sigLibrary");
  const rows = await listSavedSignatures();
  host.innerHTML = "";
  if (!rows.length){
    const empty = document.createElement("span"); empty.className = "sig-library-empty"; empty.textContent = "저장된 서명이 없습니다."; host.appendChild(empty); return;
  }
  for (const row of rows){
    const item = document.createElement("div"); item.className = "sig-saved"; item.title = "이 서명 선택"; item.tabIndex = 0; item.setAttribute("role", "button");
    if (lastSig && lastSig.dataUrl === row.dataUrl) item.classList.add("active");
    const img = document.createElement("img"); img.src = row.dataUrl; img.alt = "저장된 서명";
    const del = document.createElement("button"); del.type = "button"; del.className = "sig-saved-x"; del.textContent = "×"; del.title = "보관함에서 삭제";
    del.onclick = async (e) => { e.stopPropagation(); await deleteSavedSignature(row.id); if (lastSig && lastSig.dataUrl === row.dataUrl) lastSig = null; refreshSignatureLibrary(); };
    item.onclick = () => {
      lastSig = { dataUrl: row.dataUrl, aspect: row.aspect };
      byId("lastSigRow").hidden = false; byId("lastSigThumb").src = row.dataUrl;
      host.querySelectorAll(".sig-saved").forEach(el => el.classList.remove("active")); item.classList.add("active");
    };
    item.onkeydown = (e) => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); item.click(); } };
    item.append(img, del); host.appendChild(item);
  }
}

function signatureTargetPageIndices(){
  const target = byId("sigTarget").value;
  if (target === "all") return state.pages.map((_, i) => i);
  if (target === "selected") return state.pages.map((p, i) => state.selectedPageIds.has(p.originalIndex) ? i : -1).filter(i => i >= 0);
  return [currentPageIndex()];
}

function placeSignature(dataUrl, aspect){
  const pageIndices = signatureTargetPageIndices();
  if (!pageIndices.length){ toast("페이지 썸네일에서 적용할 페이지를 선택하세요.", 2800); return; }
  lastSig = { dataUrl, aspect };
  saveSignatureToLibrary(lastSig);
  closeSig();
  const batch = pageIndices.length > 1 || byId("sigTarget").value !== "current";
  for (const pageIndex of pageIndices){
    const el = addImageElement(dataUrl, aspect, pageIndex, { restoring: true });
    if (batch){
      const page = state.pages[pageIndex];
      el.style.left = Math.max(20, page.cssW - el.offsetWidth - 35) + "px";
      el.style.top = Math.max(20, page.cssH - el.offsetHeight - 35) + "px";
    }
  }
  selectEl(null);
  recordPdfEdit();
  toast(pageIndices.length > 1 ? `${pageIndices.length}개 페이지에 서명을 넣었어요.` : "서명을 넣었어요.", 2200);
}

function insertSig(){
  if (!padDirty){ toast("먼저 서명을 그려주세요."); return; }
  const trimmed = trimCanvas(byId("sigPad"));
  if (!trimmed){ toast("서명이 비어 있어요."); return; }
  placeSignature(trimmed.dataUrl, trimmed.aspect);
}

/* ===== PDF 위 자유 필기(잉크) — 펜 / 형광펜 / 지우개 =====
   페이지마다 투명 잉크 캔버스(벡터 스트로크)를 overlay 맨 아래에 깔고 펜 모드에서 직접 그린다.
   지우개는 destination-out 으로 잉크만 지운다(PDF 원본 불변). 직렬화·자동복원·되돌리기·PDF 내보내기는
   기존 요소 파이프라인(serializePdfElements / hydratePdfElements / buildPdfBytes)에 합류한다. */
let penMode = false;
let penState = { tool: "pen", color: "#e11d48", width: 3 };
const INK_SUPER = 2;                                  // 잉크 캔버스 내부 해상도 배수(선명도)

const INK_SHAPE_TOOLS = new Set(["arrow", "rect", "mosaic"]);   // 드래그 시작→끝 두 점으로 그리는 도구
function inkStrokeWidth(tool, w){
  if (tool === "eraser") return Math.max(14, w * 6);
  if (tool === "highlighter") return Math.max(10, w * 5);
  return w;
}
function applyInkStyle(ctx, st){
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = st.width;
  if (st.tool === "eraser"){ ctx.globalCompositeOperation = "destination-out"; ctx.strokeStyle = "rgba(0,0,0,1)"; ctx.globalAlpha = 1; }
  else { ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = st.color; ctx.globalAlpha = (st.tool === "highlighter") ? 0.3 : 1; }
}
function drawInkStroke(ctx, st){
  const p = st.points; if (!p || !p.length) return;
  if (INK_SHAPE_TOOLS.has(st.tool)){ drawInkShape(ctx, st); return; }
  ctx.save(); applyInkStyle(ctx, st);
  ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  if (p.length === 1) ctx.lineTo(p[0].x + 0.01, p[0].y + 0.01);
  ctx.stroke(); ctx.restore();
}
// 도형 스트로크(화살표·사각형·모자이크): points 의 첫 점=시작, 마지막 점=끝 두 점만 사용한다.
// 잉크 스트로크와 같은 {tool,color,width,points} 모델이라 직렬화·복구·되돌리기·PDF 굽기·리플레이에 그대로 합류.
function drawInkShape(ctx, st){
  const p = st.points; if (!p || p.length < 1) return;
  const a = p[0], b = p[p.length - 1];
  ctx.save();
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  if (st.tool === "mosaic"){
    // 개인정보 가리기용 불투명 모자이크 무늬 — 셀 밝기는 좌표 기반 결정적 값(다시 그려도 동일).
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w >= 2 && h >= 2){
      const cell = 8;
      for (let cy = 0; cy < h; cy += cell){
        for (let cx = 0; cx < w; cx += cell){
          const i = (((cx / cell) | 0) * 31 + ((cy / cell) | 0) * 17) % 4;
          const g = 168 + i * 13;
          ctx.fillStyle = "rgb(" + g + "," + (g + 2) + "," + (g + 6) + ")";
          ctx.fillRect(x + cx, y + cy, Math.min(cell, w - cx), Math.min(cell, h - cy));
        }
      }
    }
  } else {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.lineWidth = st.width; ctx.strokeStyle = st.color;
    if (st.tool === "rect"){
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else {   // arrow
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x), len = 9 + st.width * 2.2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - len * Math.cos(ang - Math.PI / 7), b.y - len * Math.sin(ang - Math.PI / 7));
      ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - len * Math.cos(ang + Math.PI / 7), b.y - len * Math.sin(ang + Math.PI / 7));
      ctx.stroke();
    }
  }
  ctx.restore();
}
function renderInkEl(el){
  const cv = el.__canvas, s = el.__super || INK_SUPER, ctx = cv.getContext("2d");
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.globalCompositeOperation = "source-over"; ctx.clearRect(0, 0, cv.width / s, cv.height / s);
  for (const st of el.__strokes) drawInkStroke(ctx, st);
}
// 페이지의 잉크 요소 생성(strokes 주어지면 복원/되돌리기용으로 초기화).
function buildInkElement(doc, pageIndex, strokes){
  const p = doc.pages[pageIndex]; if (!p) return null;
  const el = document.createElement("div");
  el.className = "placed ink"; el.__kind = "ink"; el.__doc = doc;
  el.style.left = "0px"; el.style.top = "0px"; el.style.width = p.cssW + "px"; el.style.height = p.cssH + "px";
  el.style.pointerEvents = "none";
  const canvas = document.createElement("canvas"); canvas.className = "ink-canvas";
  canvas.width = Math.max(1, Math.round(p.cssW * INK_SUPER)); canvas.height = Math.max(1, Math.round(p.cssH * INK_SUPER));
  canvas.style.width = p.cssW + "px"; canvas.style.height = p.cssH + "px";
  el.appendChild(canvas);
  el.__canvas = canvas; el.__super = INK_SUPER;
  el.__strokes = Array.isArray(strokes)
    ? strokes.map(s => ({ tool: s.tool, color: s.color, width: s.width, points: (s.points || []).map(pt => ({ x: pt.x, y: pt.y })) }))
    : [];
  p.overlay.insertBefore(el, p.overlay.firstChild);   // 잉크는 다른 주석(서명·텍스트) 아래에
  doc.elements.push({ el, pageIndex, kind: "ink" });
  if (el.__strokes.length) renderInkEl(el);
  return el;
}
function inkElForPage(doc, pageIndex){
  const found = doc.elements.find(x => x.kind === "ink" && x.pageIndex === pageIndex);
  return found ? found.el : buildInkElement(doc, pageIndex, []);
}
function clearInkOnPage(doc, pageIndex){
  if (isPdfReferenceLocked(doc)){ explainPdfReferenceLocked(); return; }
  const entry = doc.elements.find(x => x.kind === "ink" && x.pageIndex === pageIndex);
  if (!entry || !entry.el.__strokes.length){ toast("이 페이지에 지울 필기가 없어요.", 1600); return; }
  entry.el.__strokes = []; renderInkEl(entry.el); recordPdfEdit(doc);
  if (typeof lessonPdfOnClear === "function") lessonPdfOnClear(doc, pageIndex);   // 수업 리플레이 녹화(중일 때만)
  toast("이 페이지 필기를 지웠어요.", 1400);
}

// ----- 펜 모드 토글 + 도구막대 -----
function penTargetDoc(){
  if (state && state.kind === "pdf" && !isPdfReferenceLocked(state)) return state;
  if (studyPdfId !== null) return null;               // 분할 작업에서는 읽기 전용 참고 PDF로 폴백하지 않는다.
  return docs.find(d => d.kind === "pdf") || null;
}
function setPenMode(on){
  if (on && !penTargetDoc()){ explainPdfReferenceLocked(); on = false; }
  penMode = !!on;
  byId("content").classList.toggle("pdf-pen-mode", penMode);
  const bar = ensurePenBar(); bar.hidden = !penMode;
  if (penMode && typeof bar.__applySavedPos === "function") requestAnimationFrame(bar.__applySavedPos);
  const btn = byId("btnPen"); if (btn) btn.classList.toggle("primary", penMode);
  const sbtn = byId("btnStudyPen"); if (sbtn) sbtn.classList.toggle("active", penMode);   // 학습 화면 진입 버튼
  if (penMode){ const det = btn && btn.closest("details"); if (det) det.open = false; }
}
function togglePenMode(){
  if (!penMode && !penTargetDoc()){ toast("먼저 PDF를 여세요.", 1800); return; }
  setPenMode(!penMode);
}

let _penBar = null;
function ensurePenBar(){
  if (_penBar) return _penBar;
  const bar = document.createElement("div"); bar.className = "pen-bar"; bar.hidden = true;
  const mk = (label, title, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; b.addEventListener("click", fn); return b; };
  const mkIcon = (name, fallback, title, cls, fn) => {
    const b = mk("", title, cls, fn);
    if (typeof window.setUiIcon === "function") window.setUiIcon(b, name, title);
    else b.textContent = fallback;
    return b;
  };

  // 드래그 핸들(⋮⋮) — 바를 마우스로 끌어 자유 배치. 픽셀 좌표는 localStorage 에 저장.
  const drag = document.createElement("span"); drag.className = "pen-drag"; drag.title = "끌어서 위치 옮기기"; drag.textContent = "⋮⋮";
  bar.appendChild(drag);
  bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));

  const tools = {};
  // 선택 도구를 활성화하면 그리기는 잠시 멈춤 → 페이지 클릭·스크롤·페이지 이동을 평소처럼 사용 가능.
  const setTool = (t) => {
    penState.tool = t;
    for (const k in tools) tools[k].classList.toggle("active", k === t);
    const content = byId("content");
    content.classList.toggle("pen-select", t === "select");
    ["select", "pen", "highlighter", "eraser", "arrow", "rect", "mosaic"].forEach(tool => content.classList.toggle("pen-tool-" + tool, tool === t));
  };
  [["select","select","선택","선택"],["pen","pen","펜","펜"],["highlighter","highlighter","형광펜","형광펜"],["eraser","eraser","지우개","지우개"],
   ["arrow","arrow","화살표","화살표 (드래그)"],["rect","rect","사각형","사각형 (드래그)"],["mosaic","mosaic","모자이크","모자이크 — 개인정보 가리기 (드래그)"]].forEach(([t,name,fallback,title]) => { const b = mkIcon(name, fallback, title, "pen-tool", () => setTool(t)); tools[t] = b; bar.appendChild(b); });
  bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));
  const swatches = {};
  const custom = document.createElement("input");
  const setColor = (c) => { penState.color = c; for (const k in swatches) swatches[k].classList.toggle("active", k === c); custom.value = c; };
  ["#e11d48","#111111","#2563eb","#16a34a","#f59e0b"].forEach(c => { const s = document.createElement("button"); s.type = "button"; s.className = "pen-swatch"; s.style.background = c; s.title = c; s.addEventListener("click", () => setColor(c)); swatches[c] = s; bar.appendChild(s); });
  custom.type = "color"; custom.className = "pen-color-input"; custom.value = penState.color; custom.title = "색 직접 고르기"; custom.addEventListener("input", () => setColor(custom.value)); bar.appendChild(custom);
  bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));
  const widths = {};
  const setWidth = (w) => { penState.width = w; for (const k in widths) widths[k].classList.toggle("active", Number(k) === w); };
  [["2","S",2],["3","M",3],["6","L",6]].forEach(([k,label,w]) => { const b = mk(label, "굵기 " + label, "pen-width", () => setWidth(w)); widths[k] = b; bar.appendChild(b); });
  bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));
  bar.appendChild(mkIcon("undo", "되돌리기", "되돌리기 (Ctrl+Z)", "pen-act", () => { const doc = penTargetDoc(); if (doc) undoPdfEdit(doc); }));
  bar.appendChild(mkIcon("redo", "다시 실행", "다시 실행 (Ctrl+Y)", "pen-act", () => { const doc = penTargetDoc(); if (doc) redoPdfEdit(doc); }));
  bar.appendChild(mk("초기화", "현재 페이지의 필기 전체 지우기", "pen-act", () => { const doc = penTargetDoc(); if (doc) clearInkOnPage(doc, currentPageIndex(doc)); }));
  bar.appendChild(mkIcon("close", "닫기", "필기 모드 끄기", "pen-act", () => setPenMode(false)));
  bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));
  // 수업 리플레이 녹화 — PDF 위 필기(+파이썬 코드·실행)를 시간순으로 기록해 되감아 볼 수 있다.
  // 파이썬 실행바의 ● 녹화와 같은 녹화기를 공유 — lesson-rec-changed 로 양쪽 버튼 상태를 맞춘다.
  const syncPenRecBtn = (on) => {
    const _T = (s) => (typeof window.t === "function" ? window.t(s) : s);
    recBtn.classList.toggle("recording", on);
    recBtn.textContent = _T(on ? "■ 정지" : "● 녹화");
    recBtn.title = _T(on ? "녹화 정지 — 지금까지 기록을 리플레이로 만들기" : "수업 리플레이 녹화 — 필기(+파이썬 코드·실행)를 시간순으로 기록해 되감아 볼 수 있어요");
  };
  const recBtn = mk("● 녹화", "수업 리플레이 녹화 — 필기(+파이썬 코드·실행)를 시간순으로 기록해 되감아 볼 수 있어요", "pen-act pen-rec", () => {
    if (typeof lessonPdfToggleRecord !== "function"){ toast("리플레이 기능을 불러오지 못했어요.", 2400); return; }
    syncPenRecBtn(lessonPdfToggleRecord());
  });
  document.addEventListener("lesson-rec-changed", (e) => syncPenRecBtn(!!(e.detail && e.detail.on)));   // 펜바는 싱글턴이라 해제 불필요
  bar.appendChild(recBtn);
  setTool("pen"); setColor("#e11d48"); setWidth(3);
  byId("content").appendChild(bar);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);

  // ----- 드래그로 자유 배치(픽셀 좌표) + 좌/우 끝 자동 세로 전환 -----
  // 옛 4방향 토글 값("top"/"left"/...)이 남아 있으면 무시하고 기본 위치(아래 가운데) 유지.
  const readPos = () => { try { const v = localStorage.getItem("pdfPenBarPos"); if (v && v.charAt(0) === "{") return JSON.parse(v); } catch(_){} return null; };
  const savePos = (p) => { try { localStorage.setItem("pdfPenBarPos", JSON.stringify(p)); } catch(_){} };
  const setAbs = (x, y) => { bar.style.left = x + "px"; bar.style.top = y + "px"; bar.style.right = "auto"; bar.style.bottom = "auto"; bar.style.transform = "none"; };
  const setVertical = (v) => bar.classList.toggle("vertical", !!v);
  const applySaved = () => {
    const p = readPos(); if (!p) return;
    setVertical(!!p.vertical);
    const host = byId("content").getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const x = Math.max(8, Math.min(p.x, Math.max(8, host.width - br.width - 8)));
    const y = Math.max(8, Math.min(p.y, Math.max(8, host.height - br.height - 8)));
    setAbs(x, y);
  };
  // hidden 상태에서는 getBoundingClientRect 가 0 이라 일단 보일 때(setPenMode on) 적용. 여기서는 한 번 시도 + 다음 프레임 보정.
  requestAnimationFrame(applySaved);
  bar.__applySavedPos = applySaved;
  let dragging = null;
  drag.addEventListener("pointerdown", (e) => {
    e.preventDefault(); drag.setPointerCapture(e.pointerId);
    const host = byId("content").getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    dragging = { dx: e.clientX - br.left, dy: e.clientY - br.top, hostL: host.left, hostT: host.top, hostW: host.width, hostH: host.height, barW: br.width, barH: br.height };
  });
  drag.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // 포인터가 호스트 좌/우 가장자리 근처면 세로로, 그 외엔 가로로 자동 전환.
    // 이력 현상(hysteresis): 들어갈 땐 60px, 나올 땐 110px — 임계선에서 깜빡임 방지.
    const px = e.clientX - dragging.hostL;
    const isVertical = bar.classList.contains("vertical");
    let wantVertical = isVertical;
    if (!isVertical && (px < 60 || px > dragging.hostW - 60)) wantVertical = true;
    else if (isVertical && px > 110 && px < dragging.hostW - 110) wantVertical = false;
    if (wantVertical !== isVertical){
      setVertical(wantVertical);
      const br = bar.getBoundingClientRect();
      dragging.barW = br.width; dragging.barH = br.height;
      // 모드 전환 후 포인터가 드래그 핸들 중앙을 잡고 있도록 dx/dy 재설정 — 바가 포인터를 따라 자연스럽게 재배치되어 "안 따라옴" 현상 해결.
      const hr = drag.getBoundingClientRect();
      dragging.dx = (hr.left - br.left) + hr.width / 2;
      dragging.dy = (hr.top - br.top) + hr.height / 2;
    }
    const x = Math.max(8, Math.min(e.clientX - dragging.hostL - dragging.dx, dragging.hostW - dragging.barW - 8));
    const y = Math.max(8, Math.min(e.clientY - dragging.hostT - dragging.dy, dragging.hostH - dragging.barH - 8));
    setAbs(x, y);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    try { drag.releasePointerCapture(e.pointerId); } catch(_){}
    const host = byId("content").getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    savePos({ x: br.left - host.left, y: br.top - host.top, vertical: bar.classList.contains("vertical") });
    dragging = null;
  };
  drag.addEventListener("pointerup", endDrag);
  drag.addEventListener("pointercancel", endDrag);

  _penBar = bar; return bar;
}

// ----- 그리기(문서 캡처, 펜 모드일 때만) -----
let _inkDraw = null;
// 화면(client) 좌표 → 페이지의 '회전 전' 로컬 좌표(잉크·강조가 저장되는 좌표계).
// pageEl 은 transform-origin:top-left 로 scale(z)+회전이 걸리고 frame 이 그 배치 박스(padding·border 0)라,
// frame 좌상단을 기준점으로 zoom·exportRotation 을 역으로 풀면 어느 회전에서도 정확히 맞는다.
function pageLocalFromClient(p, doc, clientX, clientY){
  const fr = p.frame.getBoundingClientRect();
  const z = (doc && doc.zoom) || 1;
  const sx = (clientX - fr.left) / z, sy = (clientY - fr.top) / z;
  const r = ((p.exportRotation || 0) % 360 + 360) % 360;
  let x, y;
  if (r === 90){ x = sy; y = p.cssH - sx; }
  else if (r === 180){ x = p.cssW - sx; y = p.cssH - sy; }
  else if (r === 270){ x = p.cssW - sy; y = sx; }
  else { x = sx; y = sy; }
  return { x: Math.max(0, Math.min(p.cssW, x)), y: Math.max(0, Math.min(p.cssH, y)) };
}
function inkPos(e, p, doc){
  return pageLocalFromClient(p, doc, e.clientX, e.clientY);
}
function drawInkSeg(ctx, st, a, b){
  ctx.save(); applyInkStyle(ctx, st);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  if (a.x === b.x && a.y === b.y) ctx.lineTo(b.x + 0.01, b.y + 0.01);
  ctx.stroke(); ctx.restore();
}
function penPointerDown(e){
  if (!penMode || e.button !== 0) return;
  if (penState.tool === "select") return;            // 선택 도구일 땐 그리지 않고 페이지 클릭 그대로 사용
  const pageEl = e.target && e.target.closest ? e.target.closest(".page") : null;
  if (!pageEl) return;
  const doc = docs.find(d => d.kind === "pdf" && d.pages && d.pages.some(p => p.pageEl === pageEl));
  if (!doc || isPdfReferenceLocked(doc)) return;
  const pageIndex = doc.pages.findIndex(p => p.pageEl === pageEl);
  const p = doc.pages[pageIndex]; if (!p) return;
  e.preventDefault(); e.stopPropagation();
  const el = inkElForPage(doc, pageIndex);
  const ctx = el.__canvas.getContext("2d"); ctx.setTransform(el.__super, 0, 0, el.__super, 0, 0);
  const pos = inkPos(e, p, doc);
  const shape = INK_SHAPE_TOOLS.has(penState.tool);
  const stroke = shape
    ? { tool: penState.tool, color: penState.color, width: penState.width, points: [pos, { x: pos.x, y: pos.y }] }
    : { tool: penState.tool, color: penState.color, width: inkStrokeWidth(penState.tool, penState.width), points: [pos] };
  el.__strokes.push(stroke);
  _inkDraw = { doc, el, ctx, p, pageIndex, stroke, last: pos, shape };
  if (shape) renderInkEl(el); else drawInkSeg(ctx, stroke, pos, pos);
  window.addEventListener("pointermove", penPointerMove, true);
  window.addEventListener("pointerup", penPointerUp, true);
  window.addEventListener("pointercancel", penPointerUp, true);
}
function penPointerMove(e){
  if (!_inkDraw) return;
  e.preventDefault();
  const pos = inkPos(e, _inkDraw.p, _inkDraw.doc);
  if (_inkDraw.shape){                                // 도형: 끝점만 갱신하고 전체 다시 그려 미리보기
    _inkDraw.stroke.points[1] = pos;
    renderInkEl(_inkDraw.el);
    return;
  }
  _inkDraw.stroke.points.push(pos);
  drawInkSeg(_inkDraw.ctx, _inkDraw.stroke, _inkDraw.last, pos);
  _inkDraw.last = pos;
}
function penPointerUp(){
  window.removeEventListener("pointermove", penPointerMove, true);
  window.removeEventListener("pointerup", penPointerUp, true);
  window.removeEventListener("pointercancel", penPointerUp, true);
  if (!_inkDraw) return;
  const { doc, el, pageIndex, stroke, shape } = _inkDraw; _inkDraw = null;
  // 클릭만 하고 끌지 않은 도형(2px 미만)은 실수로 보고 버린다.
  if (shape){
    const a = stroke.points[0], b = stroke.points[1];
    if (Math.abs(b.x - a.x) < 2 && Math.abs(b.y - a.y) < 2){
      const i = el.__strokes.indexOf(stroke);
      if (i >= 0) el.__strokes.splice(i, 1);
      renderInkEl(el);
      return;
    }
  }
  renderInkEl(el);                                    // 한 번에 다시 그려 형광펜 알파·지우개 겹침 정리
  recordPdfEdit(doc);                                 // 스트로크 1개 = 되돌리기 1단계
  if (typeof lessonPdfOnStroke === "function") lessonPdfOnStroke(doc, pageIndex, stroke);   // 수업 리플레이 녹화(중일 때만)
}
document.addEventListener("pointerdown", penPointerDown, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && penMode){ setPenMode(false); } });

/* ===== PDF 텍스트 선택 → 형광펜 강조(마크업) =====
   펜 모드 없이 크롬 PDF처럼 글자를 드래그로 선택하면 색상 막대가 떠서 바로 강조한다.
   선택 범위를 줄 단위 사각형으로 병합해 형광펜 '잉크 스트로크'로 변환 → 기존 잉크
   파이프라인(렌더·직렬화 PNG·자동복원 벡터·되돌리기·PDF 굽기·리플레이)에 그대로 합류한다. */
const TEXT_HI_COLORS = [["#ffd43b","노랑"],["#69db7c","연두"],["#ff8fab","분홍"],["#74c0fc","하늘"],["#ffa94d","주황"]];
let _textHiColor = "#ffd43b";

// 현재 선택이 편집 가능한 PDF 글자 위인지 확인하고 { sel, doc } 반환(아니면 null).
function pdfTextSelectionInfo(){
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const anchor = sel.anchorNode;
  const anchorEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
  if (!anchorEl || !anchorEl.closest || !anchorEl.closest(".pdf-text-layer")) return null;
  const doc = docs.find(d => d.kind === "pdf" && d.el && d.el.contains(anchor));
  return doc ? { sel, doc } : null;
}
// 선택 범위의 화면 사각형들을 페이지별로 모아 줄 단위로 병합하고 형광펜 스트로크를 얹는다.
function applyTextHighlight(color){
  const info = pdfTextSelectionInfo();
  if (!info) return false;
  const { sel, doc } = info;
  if (isPdfReferenceLocked(doc)){ explainPdfReferenceLocked(); return false; }
  const byPage = new Map();
  for (let i = 0; i < sel.rangeCount; i++){
    for (const r of sel.getRangeAt(i).getClientRects()){
      if (r.width <= 0.5 || r.height <= 0.5) continue;
      const probe = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + Math.min(4, r.width / 2))), r.top + r.height / 2);
      const pageEl = probe && probe.closest ? probe.closest(".page") : null;
      if (!pageEl) continue;
      const pageIndex = doc.pages.findIndex(p => p.pageEl === pageEl);
      if (pageIndex < 0) continue;
      if (!byPage.has(pageIndex)) byPage.set(pageIndex, []);
      byPage.get(pageIndex).push(r);
    }
  }
  let made = 0;
  for (const [pageIndex, prects] of byPage){
    const p = doc.pages[pageIndex]; if (!p || !p.overlay) continue;
    const lines = [];
    for (const r of prects){
      // 화면 사각형의 대각 두 꼭짓점을 회전 전 페이지 좌표로 변환(회전 시 축이 바뀌므로 min/max 로 정규화).
      const a = pageLocalFromClient(p, doc, r.left, r.top);
      const b = pageLocalFromClient(p, doc, r.right, r.bottom);
      const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
      const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
      let g = null;
      for (const c of lines){
        const ov = Math.min(bottom, c.bottom) - Math.max(top, c.top);
        if (ov > 0.4 * Math.min(bottom - top, c.bottom - c.top)){ g = c; break; }
      }
      if (g){ g.left = Math.min(g.left, left); g.right = Math.max(g.right, right); g.top = Math.min(g.top, top); g.bottom = Math.max(g.bottom, bottom); }
      else lines.push({ left, right, top, bottom });
    }
    const el = inkElForPage(doc, pageIndex);
    for (const g of lines){
      const h = g.bottom - g.top, w = g.right - g.left;
      if (h < 2 || w < 1) continue;
      const cy = (g.top + g.bottom) / 2, inset = Math.min(h / 2, w / 2);
      const stroke = { tool: "highlighter", color, width: h, points: [{ x: g.left + inset, y: cy }, { x: g.right - inset, y: cy }] };
      el.__strokes.push(stroke);
      if (typeof lessonPdfOnStroke === "function") lessonPdfOnStroke(doc, pageIndex, stroke);
      made++;
    }
    if (made) renderInkEl(el);
  }
  if (made){
    recordPdfEdit(doc);
    try { sel.removeAllRanges(); } catch(_){}
    if (typeof refreshPdfSelHighlight === "function") refreshPdfSelHighlight();
    hideTextHiBar();
  }
  return made > 0;
}

// ----- 선택 위에 뜨는 강조 색상 막대 -----
let _textHiBar = null;
function ensureTextHiBar(){
  if (_textHiBar) return _textHiBar;
  const bar = document.createElement("div");
  bar.className = "pdf-hi-bar"; bar.hidden = true;
  bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "선택한 글자 강조");
  const cap = document.createElement("span"); cap.className = "pdf-hi-cap";
  if (typeof window.setUiIcon === "function") window.setUiIcon(cap, "highlighter", "글자 강조");
  else cap.textContent = "강조";
  bar.appendChild(cap);
  for (const [c, name] of TEXT_HI_COLORS){
    const b = document.createElement("button");
    b.type = "button"; b.className = "pdf-hi-color"; b.style.background = c;
    b.title = name + "으로 강조"; b.setAttribute("aria-label", name + "으로 강조");
    // mousedown 에서 preventDefault 로 선택을 유지한 채 바로 적용(클릭이면 선택이 풀림).
    b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); _textHiColor = c; applyTextHighlight(c); });
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);
  _textHiBar = bar; return bar;
}
function hideTextHiBar(){ if (_textHiBar) _textHiBar.hidden = true; }
function positionTextHiBar(focusColor=false){
  const info = pdfTextSelectionInfo();
  if (!info || isPdfReferenceLocked(info.doc)){ hideTextHiBar(); return; }
  const rects = info.sel.getRangeAt(info.sel.rangeCount - 1).getClientRects();
  const r = rects && rects.length ? rects[rects.length - 1] : info.sel.getRangeAt(0).getBoundingClientRect();
  if (!r || (!r.width && !r.height)){ hideTextHiBar(); return; }
  const bar = ensureTextHiBar();
  bar.hidden = false;
  const bw = bar.offsetWidth || 180, bh = bar.offsetHeight || 34;
  let left = r.left + r.width / 2 - bw / 2;
  left = Math.max(8, Math.min(window.innerWidth - bw - 8, left));
  let top = r.top - bh - 8;                              // 선택 위쪽에, 공간 없으면 아래로
  if (top < 8) top = Math.min(window.innerHeight - bh - 8, r.bottom + 8);
  bar.style.left = left + "px"; bar.style.top = top + "px";
  if (focusColor){
    const firstColor = bar.querySelector(".pdf-hi-color");
    if (firstColor) firstColor.focus();
  }
}
// 드래그 중엔 깜빡이지 않도록 손을 뗐을 때(pointerup) 위치를 잡고, 선택이 풀리면 숨긴다.
document.addEventListener("pointerup", (e) => {
  if (e.target && e.target.closest && e.target.closest(".pdf-hi-bar")) return;
  setTimeout(positionTextHiBar, 0);
});
document.addEventListener("keyup", (e) => {
  if (!e.shiftKey || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(e.key)) return;
  const target = e.target;
  if (!target || !target.closest || !target.closest(".pdf-text-layer")) return;
  setTimeout(() => positionTextHiBar(true), 0);
});
document.addEventListener("selectionchange", () => {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.isCollapsed || !pdfTextSelectionInfo()) hideTextHiBar();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _textHiBar && !_textHiBar.hidden){ hideTextHiBar(); }
}, true);
window.addEventListener("resize", hideTextHiBar);
document.addEventListener("scroll", hideTextHiBar, true);   // PDF 스크롤 시 위치가 어긋나므로 숨김
