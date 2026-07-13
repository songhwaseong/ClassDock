"use strict";

const PDF_RECOVERY_DB = "pdf-signer-recovery";
const PDF_RECOVERY_STORE = "documents";
const PDF_SIGNATURE_STORE = "signatures";
const PDF_RECOVERY_VERSION = 1;
let pdfRecoveryDbPromise = null;

function openPdfRecoveryDb(){
  if (!window.indexedDB) return Promise.reject(new Error("indexeddb-unavailable"));
  if (pdfRecoveryDbPromise) return pdfRecoveryDbPromise;
  pdfRecoveryDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PDF_RECOVERY_DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PDF_RECOVERY_STORE)) req.result.createObjectStore(PDF_RECOVERY_STORE, { keyPath: "key" });
      if (!req.result.objectStoreNames.contains(PDF_SIGNATURE_STORE)) req.result.createObjectStore(PDF_SIGNATURE_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexeddb-open-failed"));
  });
  return pdfRecoveryDbPromise;
}

async function pdfRecoveryRequest(mode, action){
  return pdfStoreRequest(PDF_RECOVERY_STORE, mode, action);
}

async function pdfStoreRequest(storeName, mode, action){
  const db = await openPdfRecoveryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = action(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexeddb-request-failed"));
  });
}

function pdfRecoveryKey(name, bytes){
  return "pdf:" + fingerprintBytes(name, new Uint8Array(bytes));
}

function serializePdfElements(doc){
  return (doc.elements || []).map(({ el, pageIndex, kind }) => {
    const page = doc.pages[pageIndex];
    if (!page) return null;
    const item = {
      pageIndex, kind,
      x: el.offsetLeft / page.cssW, y: el.offsetTop / page.cssH,
      width: el.offsetWidth / page.cssW, height: el.offsetHeight / page.cssH
    };
    if (kind === "signature") {
      item.dataUrl = el.__dataUrl;
      item.aspect = el.__aspect;
    } else if (kind === "code-link") {
      item.target = el.__codeTarget || null;
      item.label = (el.__codeTarget && el.__codeTarget.label) || "";
    } else if (kind === "ink") {
      item.strokes = el.__strokes || [];               // 벡터 스트로크(페이지 좌표)
    } else {
      const text = el.querySelector(".text-edit");
      const style = text ? getComputedStyle(text) : null;
      item.text = text ? text.innerText.replace(/\n$/, "") : "";
      item.fontSize = style ? parseFloat(style.fontSize) : 18;
      item.color = style ? style.color : "#111";
      item.fontWeight = style ? style.fontWeight : "400";
    }
    return item;
  }).filter(Boolean);
}

async function savePdfRecovery(doc){
  if (!appSettings.pdfRecovery) return;
  if (!doc || doc.closed || !doc.recoveryKey || !doc.pages.length) return;
  const elements = serializePdfElements(doc);
  const outline = typeof serializePdfOutline === "function" ? serializePdfOutline(doc.pdfOutline) : [];
  try {
    await pdfRecoveryRequest("readwrite", (store) => store.put({
      key: doc.recoveryKey, name: doc.fileName, version: PDF_RECOVERY_VERSION,
      updatedAt: Date.now(), elements,
      pages: doc.pages.map(p => ({ originalIndex: p.originalIndex, exportRotation: p.exportRotation || 0 })),
      outline
    }));
    doc.recoveryDirty = false;
    updateDocumentStatus(doc);
  } catch (e) { console.warn("PDF 편집 복구 저장 실패:", e); }
}

function schedulePdfRecovery(doc=state){
  if (!appSettings.pdfRecovery) return;
  if (!doc || doc.kind !== "pdf" || !doc.recoveryKey || doc._restoringRecovery || doc._applyingHistory) return;
  doc.recoveryDirty = true;
  updateDocumentStatus(doc);
  clearTimeout(doc.recoveryTimer);
  doc.recoveryTimer = setTimeout(() => savePdfRecovery(doc), 450);
}

function initPdfHistory(doc){
  if (!doc || doc.kind !== "pdf") return;
  const snapshot = snapshotPdfState(doc);
  doc.pdfHistory = [{ snapshot, json: JSON.stringify(snapshot) }];
  doc.pdfHistoryIndex = 0;
}

function snapshotPdfState(doc){
  return {
    elements: serializePdfElements(doc),
    pages: doc.pages.map(p => ({ originalIndex: p.originalIndex, exportRotation: p.exportRotation || 0 })),
    outline: typeof serializePdfOutline === "function" ? serializePdfOutline(doc.pdfOutline) : []
  };
}

function commitPdfHistory(doc){
  if (!doc || doc.kind !== "pdf" || doc._restoringRecovery || doc._applyingHistory) return;
  clearTimeout(doc.pdfHistoryTimer);
  doc.pdfHistoryTimer = null;
  if (!doc.pdfHistory) initPdfHistory(doc);
  const snapshot = snapshotPdfState(doc);
  const json = JSON.stringify(snapshot);
  const current = doc.pdfHistory[doc.pdfHistoryIndex];
  if (current && current.json === json) return;
  doc.pdfHistory.splice(doc.pdfHistoryIndex + 1);
  doc.pdfHistory.push({ snapshot, json });
  if (doc.pdfHistory.length > 50) doc.pdfHistory.shift();
  doc.pdfHistoryIndex = doc.pdfHistory.length - 1;
}

function recordPdfEdit(doc=state, delay=0){
  if (!doc || doc.kind !== "pdf" || doc._restoringRecovery || doc._applyingHistory) return;
  schedulePdfRecovery(doc);
  clearTimeout(doc.pdfHistoryTimer);
  if (delay > 0) doc.pdfHistoryTimer = setTimeout(() => commitPdfHistory(doc), delay);
  else commitPdfHistory(doc);
  if (typeof refreshCodePinMarkers === "function") refreshCodePinMarkers();   // 핀 추가·이동·삭제 → 코드 거터 마커 갱신
}

function applyPdfHistory(doc, entry){
  if (!doc || !entry) return;
  doc._applyingHistory = true;
  try {
    selectEl(null);
    for (const item of doc.elements || []) item.el.remove();
    doc.elements = [];
    restorePdfPageState(doc, entry.snapshot.pages);
    if (Array.isArray(entry.snapshot.outline) && typeof restorePdfOutlineState === "function") restorePdfOutlineState(doc, entry.snapshot.outline);
    hydratePdfElements(doc, entry.snapshot.elements);
  } finally { doc._applyingHistory = false; }
  schedulePdfRecovery(doc);
}

function undoPdfEdit(doc=state){
  if (!doc || doc.kind !== "pdf") return false;
  if (doc.pdfHistoryTimer) commitPdfHistory(doc);
  if (!doc.pdfHistory || doc.pdfHistoryIndex <= 0){ toast("되돌릴 작업이 없어요.", 1500); return false; }
  doc.pdfHistoryIndex--;
  applyPdfHistory(doc, doc.pdfHistory[doc.pdfHistoryIndex]);
  toast("편집 작업을 되돌렸어요.", 1200);
  return true;
}

function redoPdfEdit(doc=state){
  if (!doc || doc.kind !== "pdf") return false;
  if (doc.pdfHistoryTimer) commitPdfHistory(doc);
  if (!doc.pdfHistory || doc.pdfHistoryIndex >= doc.pdfHistory.length - 1){ toast("다시 실행할 작업이 없어요.", 1500); return false; }
  doc.pdfHistoryIndex++;
  applyPdfHistory(doc, doc.pdfHistory[doc.pdfHistoryIndex]);
  toast("편집 작업을 다시 실행했어요.", 1200);
  return true;
}

async function deletePdfRecovery(key){
  if (!key) return;
  try { await pdfRecoveryRequest("readwrite", (store) => store.delete(key)); }
  catch (e) { console.warn("PDF 편집 복구 삭제 실패:", e); }
}

async function restorePdfRecovery(doc){
  if (!appSettings.pdfRecovery) return;
  if (!doc || !doc.recoveryKey) return;
  let saved = null;
  try { saved = await pdfRecoveryRequest("readonly", (store) => store.get(doc.recoveryKey)); }
  catch (e) { console.warn("PDF 편집 복구 읽기 실패:", e); return; }
  if (!saved || saved.version !== PDF_RECOVERY_VERSION) return;
  const elementCount = Array.isArray(saved.elements) ? saved.elements.length : 0;
  const pageChanged = Array.isArray(saved.pages) && (saved.pages.length !== doc.pages.length || saved.pages.some((p, i) => !doc.pages[i] || p.originalIndex !== doc.pages[i].originalIndex || p.exportRotation));
  const outlineChanged = Array.isArray(saved.outline) && typeof serializePdfOutline === "function"
    && JSON.stringify(saved.outline) !== JSON.stringify(serializePdfOutline(doc.pdfOutline));
  if (!elementCount && !pageChanged && !outlineChanged) return;
  doc._restoringRecovery = true;
  try {
    if (saved.pages) restorePdfPageState(doc, saved.pages);
    if (Array.isArray(saved.outline) && typeof restorePdfOutlineState === "function") restorePdfOutlineState(doc, saved.outline);
    hydratePdfElements(doc, saved.elements || []);
    doc.recoveryDirty = false;
    updateDocumentStatus(doc);
  } finally { doc._restoringRecovery = false; }
}

async function listSavedSignatures(){
  try {
    const rows = await pdfStoreRequest(PDF_SIGNATURE_STORE, "readonly", store => store.getAll());
    return (rows || []).sort((a,b) => b.createdAt - a.createdAt);
  } catch(e){ console.warn("서명 보관함 읽기 실패:", e); return []; }
}

async function saveSignatureToLibrary(signature){
  if (!signature || !signature.dataUrl) return;
  const rows = await listSavedSignatures();
  const same = rows.find(row => row.dataUrl === signature.dataUrl);
  if (same) return;
  const item = { id: "sig-" + Date.now() + "-" + Math.random().toString(36).slice(2,7), createdAt: Date.now(), dataUrl: signature.dataUrl, aspect: signature.aspect || 2 };
  try {
    await pdfStoreRequest(PDF_SIGNATURE_STORE, "readwrite", store => store.put(item));
    for (const old of rows.slice(7)) await pdfStoreRequest(PDF_SIGNATURE_STORE, "readwrite", store => store.delete(old.id));
  } catch(e){ console.warn("서명 보관함 저장 실패:", e); }
}

async function deleteSavedSignature(id){
  try { await pdfStoreRequest(PDF_SIGNATURE_STORE, "readwrite", store => store.delete(id)); }
  catch(e){ console.warn("서명 보관함 삭제 실패:", e); }
}
