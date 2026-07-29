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

async function savePdfRecovery(doc, options={}){
  if (!appSettings.pdfRecovery && !options.force) return;
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
    return true;
  } catch (e) {
    console.warn("PDF 편집 복구 저장 실패:", e);
    return false;
  }
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
  // 스냅샷은 JSON 문자열로만 들고 있는다. 객체와 문자열을 함께 보관하던 옛 방식은
  // 서명 이미지(base64)를 단계마다 두 벌씩 쥐고 있어 메모리를 두 배로 썼다.
  doc.pdfHistory = MNEditHistory.create({
    limit: MNEditHistory.LIMITS.pdf,
    capture: () => JSON.stringify(snapshotPdfState(doc)),
    apply: (json) => applyPdfHistory(doc, JSON.parse(json)),
    isEqual: (a, b) => a === b,                 // 스냅샷이 문자열이라 그대로 비교
  });
  doc.pdfHistory.reset();
  // 히스토리는 상한을 넘으면 앞에서부터 버리므로 기준점은 따로 들고 있는다.
  doc.pdfBaselineJson = doc.pdfHistory.current();
}

// PDF는 hasUnsavedEdits 대신 이 함수로 "잃으면 안 되는 편집"을 판단한다.
// 주석·서명(elements)뿐 아니라 페이지 재정렬·회전·삭제와 목차 편집까지 포함하려고
// 복구본이 추적하는 것과 같은 스냅샷을 문서를 연 직후 상태와 비교한다.
function pdfHasPendingEdits(doc){
  if (!doc || doc.kind !== "pdf") return false;
  if (doc.elements && doc.elements.length) return true;
  if (!doc.pdfBaselineJson) return false;
  try { return JSON.stringify(snapshotPdfState(doc)) !== doc.pdfBaselineJson; }
  catch(e){ console.warn("PDF 편집 여부 확인 실패:", e); return false; }
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
  if (!doc.pdfHistory) initPdfHistory(doc);
  doc.pdfHistory.commit();
}

function recordPdfEdit(doc=state, delay=0){
  if (!doc || doc.kind !== "pdf" || doc._restoringRecovery || doc._applyingHistory) return;
  schedulePdfRecovery(doc);
  if (!doc.pdfHistory) initPdfHistory(doc);
  if (delay > 0) doc.pdfHistory.commitSoon(delay);
  else doc.pdfHistory.commit();
  if (typeof refreshCodePinMarkers === "function") refreshCodePinMarkers();   // 핀 추가·이동·삭제 → 코드 거터 마커 갱신
}

function applyPdfHistory(doc, snapshot){
  if (!doc || !snapshot) return;
  doc._applyingHistory = true;             // 복구 저장·재기록이 이 복원을 새 편집으로 오해하지 않게
  try {
    selectEl(null);
    for (const item of doc.elements || []) item.el.remove();
    doc.elements = [];
    restorePdfPageState(doc, snapshot.pages);
    if (Array.isArray(snapshot.outline) && typeof restorePdfOutlineState === "function") restorePdfOutlineState(doc, snapshot.outline);
    hydratePdfElements(doc, snapshot.elements);
  } finally { doc._applyingHistory = false; }
  schedulePdfRecovery(doc);
}

function undoPdfEdit(doc=state){
  if (!doc || doc.kind !== "pdf" || !doc.pdfHistory) return false;
  if (!doc.pdfHistory.undo()){ toast("되돌릴 작업이 없어요.", 1500); return false; }
  toast("편집 작업을 되돌렸어요.", 1200);
  return true;
}

function redoPdfEdit(doc=state){
  if (!doc || doc.kind !== "pdf" || !doc.pdfHistory) return false;
  if (!doc.pdfHistory.redo()){ toast("다시 실행할 작업이 없어요.", 1500); return false; }
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
