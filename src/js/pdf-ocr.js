"use strict";

/* ===== 스캔 PDF 글자 인식(OCR) =====
   글자 정보가 없는 스캔(이미지) PDF 의 텍스트를 tesseract.js 로 읽어,
   PDF 안 찾기(Ctrl+H)와 사이드바 본문 검색이 스캔본에도 동작하게 한다.
   - 도구(스크립트·한국어 학습 데이터)는 필요할 때 CDN에서 동의 후 1회 받아온다(문서 내용은 전송 안 됨).
   - 인식 결과(페이지 텍스트 + 단어 좌표)는 문서 지문(fingerprint) 기준으로 IndexedDB 에 저장해
     같은 PDF 는 다시 인식하지 않는다(브라우저·EXE 공통, 완전 로컬).
   - 좌표는 인식 당시 렌더 배율로 저장하고, 하이라이트 때 화면 배율(p.scale)로 환산한다. */

const PDF_OCR_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const PDF_OCR_MAX_PAGES = 300;            // 인식 페이지 상한(장시간 보호) — 검색 추출 상한(500)보다 보수적
const PDF_OCR_TARGET_WIDTH = 1800;        // 인식용 렌더 폭(px) — 정확도·속도 균형
const PDF_OCR_CACHE_VERSION = 2;

// ----- 결과 캐시(IndexedDB) -----
const PDF_OCR_DB = "manneung-ocr", PDF_OCR_STORE = "pages";
function pdfOcrIdbOpen(){
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(PDF_OCR_DB, 1); } catch(e){ reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PDF_OCR_STORE)) db.createObjectStore(PDF_OCR_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb-open"));
  });
}
function pdfOcrIdbRequest(mode, run){
  return pdfOcrIdbOpen().then(db => new Promise((resolve, reject) => {
    let request = null;
    try {
      const tx = db.transaction(PDF_OCR_STORE, mode);
      request = run(tx.objectStore(PDF_OCR_STORE));
      tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("idb-tx")); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("idb-abort")); };
    } catch(e){ db.close(); reject(e); }
  }));
}

function pdfOcrDigestInput(bytes){
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (!view.byteLength) return null;
  // 원본 전체 버퍼를 그대로 넘길 수 있으면 불필요한 복사를 피한다. 부분 view만 안전하게 복사한다.
  return (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) ? view.buffer : view.slice().buffer;
}
function pdfOcrHex(bytes){ return Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, "0")).join(""); }
async function pdfOcrCacheKey(doc){
  if (!doc || !doc.pdfBytes || typeof fingerprintBytes !== "function") return null;
  if (doc._ocrKey) return doc._ocrKey;
  if (doc._ocrKeyPending) return doc._ocrKeyPending;
  doc._ocrKeyPending = (async () => {
    const input = pdfOcrDigestInput(doc.pdfBytes);
    if (input && typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function"){
      try {
        const digest = await crypto.subtle.digest("SHA-256", input);
        return "ocr:v" + PDF_OCR_CACHE_VERSION + ":sha256:" + pdfOcrHex(digest);
      } catch(e){}
    }
    // 오래된 브라우저에서는 기존의 빠른 지문으로 안전하게 폴백하되, 캐시 버전은 분리한다.
    return "ocr:v" + PDF_OCR_CACHE_VERSION + ":sample:" + fingerprintBytes(doc.name || "doc.pdf", doc.pdfBytes);
  })();
  try { doc._ocrKey = await doc._ocrKeyPending; return doc._ocrKey; }
  finally { delete doc._ocrKeyPending; }
}

// 문서의 OCR 결과(pages:[{text, words:[[s,x0,y0,x1,y1],…], scale}])를 캐시에서 읽는다. 없으면 null.
async function pdfOcrCachedData(doc){
  if (!doc || doc.kind !== "pdf") return null;
  if (doc._ocrData !== undefined) return doc._ocrData;
  let data = null;
  try {
    const key = await pdfOcrCacheKey(doc);
    if (key){
      const record = await pdfOcrIdbRequest("readonly", store => store.get(key));
      if (record && Array.isArray(record.pages)) data = record;
    }
  } catch(e){}
  doc._ocrData = data;
  return data;
}

// 사이드바 본문 검색용: 페이지당 한 줄(추출 텍스트와 같은 계약 — 줄 번호 = 페이지 번호). 없으면 false.
async function pdfOcrCachedText(doc){
  const data = await pdfOcrCachedData(doc);
  if (!data) return false;
  const joined = data.pages.map(pg => String((pg && pg.text) || "").replace(/\s+/g, " ").trim()).join("\n");
  return joined.replace(/\n/g, "").trim() ? joined : false;
}

// PDF 찾기(Ctrl+H)용: OCR 단어 좌표를 화면 배율(p.scale)로 환산해 pdfPageFindData 와 같은 모양으로 돌려준다.
async function pdfOcrFindData(doc, p){
  const data = await pdfOcrCachedData(doc);
  const pg = data && data.pages && data.pages[p.pageNum - 1];
  if (!pg || !Array.isArray(pg.words) || !pg.words.length) return null;
  const f = (p.scale || 1) / (pg.scale || 2);
  let str = "";
  const items = [];
  for (const w of pg.words){
    const s = String(w[0] || "");
    if (s){
      items.push({ off: str.length, len: s.length, x: w[1] * f, y: w[2] * f, w: (w[3] - w[1]) * f, h: (w[4] - w[2]) * f });
      str += s;
    }
    str += " ";
  }
  return { str, items };
}

// ----- 도구 로드(동의 + CDN, 세션당 1회) -----
let _pdfOcrConsent = false;
async function pdfOcrEnsureTesseract(){
  if (typeof Tesseract !== "undefined") return true;
  if (!navigator.onLine){
    toast("글자 인식 도구를 받아오려면 인터넷 연결이 필요해요. (인식한 결과는 이 컴퓨터에 저장돼 다음엔 오프라인에서도 검색됩니다)", 5000, { type: "error" });
    return false;
  }
  if (!_pdfOcrConsent){
    const ok = await confirmDialog(
      "스캔 PDF 글자 인식(OCR) 도구를 인터넷(CDN)에서 받아옵니다(한국어+영어, 약 15~20MB · 최초 1회).\n문서 내용은 외부로 전송되지 않고 인식은 이 컴퓨터 안에서만 처리돼요.",
      "받아오기", "취소");
    if (!ok) return false;
    _pdfOcrConsent = true;
  }
  try {
    await loadScriptOnce(PDF_OCR_CDN);
  } catch(e){}
  if (typeof Tesseract === "undefined"){
    toast("글자 인식 도구를 받아오지 못했어요. 인터넷 연결을 확인해 주세요.", 4000, { type: "error" });
    return false;
  }
  return true;
}

// 인식용 페이지 렌더(뷰어와 독립) — 반환 {canvas, scale}.
async function pdfOcrRenderPage(pdf, pageNum){
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1, PDF_OCR_TARGET_WIDTH / Math.max(1, base.width)));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  await page.render({ canvasContext: canvas.getContext("2d", { willReadFrequently: true }), viewport: vp }).promise;
  if (typeof page.cleanup === "function") page.cleanup();
  return { canvas, scale };
}

// ----- 전체 인식 실행 -----
// 버튼 하나로 시작/중지까지 관리한다: pdfOcrToggle(doc, btn, onDone).
// 실행 중 다시 누르면 중지. 완료하면 결과를 IndexedDB 에 저장하고 검색 캐시를 무효화한 뒤 onDone() 호출.
async function pdfOcrToggle(doc, btn, onDone){
  if (!doc || doc.kind !== "pdf" || !doc.pdfBytes){ toast("인식할 PDF 를 찾지 못했어요.", 2400); return; }
  if (doc._ocrRunning){ doc._ocrCancel = true; if (btn) btn.textContent = "중지 중…"; return; }

  const idle = () => { if (btn){ btn.textContent = "🔍 글자 인식"; btn.classList.remove("running"); } };
  if (!(await pdfOcrEnsureTesseract())){ idle(); return; }

  doc._ocrRunning = true; doc._ocrCancel = false;
  if (btn){ btn.classList.add("running"); btn.textContent = "준비 중…"; }
  let worker = null, temp = null;
  try {
    worker = await Tesseract.createWorker("kor+eng", 1);
    let pdf = doc.pdfjsDoc;
    if (!pdf){
      await ensureWorker();
      const bytes = new Uint8Array(doc.pdfBytes.slice(0));
      pdf = temp = await pdfjsLib.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false }).promise;
    }
    const max = Math.min(pdf.numPages, PDF_OCR_MAX_PAGES);
    const pages = [];
    for (let i = 1; i <= max; i++){
      if (doc._ocrCancel) break;
      if (btn) btn.textContent = "인식 중 " + i + "/" + max + "p (누르면 중지)";
      const { canvas, scale } = await pdfOcrRenderPage(pdf, i);
      const { data } = await worker.recognize(canvas);
      canvas.width = canvas.height = 0;                       // 캔버스 메모리 즉시 반환
      const words = [];
      for (const w of (data && data.words) || []){
        const s = String((w && w.text) || "").trim();
        const b = w && w.bbox;
        if (s && b) words.push([s, b.x0 | 0, b.y0 | 0, b.x1 | 0, b.y1 | 0]);
      }
      pages.push({ text: String((data && data.text) || ""), words, scale });
    }
    if (doc._ocrCancel){
      toast("글자 인식을 중지했어요. (저장하지 않음)", 2600);
      return;
    }
    const key = await pdfOcrCacheKey(doc);
    const record = { pages, name: doc.name || "", savedAt: Date.now() };
    if (key) await pdfOcrIdbRequest("readwrite", store => store.put(record, key));
    doc._ocrData = record;
    // 사이드바 본문 검색 캐시 무효화 — 다음 검색부터 OCR 텍스트가 잡힌다.
    try { contentTextCache.delete(doc.id); contentLowerCache.delete(doc.id); } catch(e){}
    const found = pages.filter(pg => pg.text.trim()).length;
    toast(found
      ? "글자 인식 완료 — " + pages.length + "쪽 중 " + found + "쪽에서 글자를 찾았어요. 이제 이 PDF 도 검색됩니다."
      : "글자 인식을 마쳤지만 읽을 수 있는 글자를 찾지 못했어요.", 4200);
    if (pdf.numPages > PDF_OCR_MAX_PAGES) toast("문서가 길어 앞 " + PDF_OCR_MAX_PAGES + "쪽까지만 인식했어요.", 3600);
    if (typeof onDone === "function") onDone();
  } catch(e){
    console.warn("pdf ocr failed:", e);
    toast("글자 인식 중 문제가 생겼어요: " + ((e && e.message) || e), 4000, { type: "error" });
  } finally {
    doc._ocrRunning = false; doc._ocrCancel = false;
    idle();
    if (worker){ try { worker.terminate(); } catch(e){} }
    if (temp && temp.destroy){ try { temp.destroy(); } catch(e){} }
  }
}
