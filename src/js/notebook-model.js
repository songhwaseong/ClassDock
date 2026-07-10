"use strict";

/* ============================================================================
 * 주피터식 셀 노트북 에디터 — Phase 1: 모델 + .ipynb 직렬화 + 읽기전용 렌더
 *  · 저장 포맷은 .ipynb(nbformat 4) 직접. 기존 출력·첨부와 새 실행 결과를 함께 보존한다.
 *  · 코드 에디터·커널·셀 편집은 이후 단계(P2~)에서 추가. 지금은 모델/직렬화/표시까지.
 *  · 순수 함수(ipynbToModel/modelToIpynb)는 파일 끝에서 module.exports 로 노드 테스트에 노출한다.
 * ========================================================================== */

// 노트북 모드 활성 여부 — .ipynb 의 기본 보기. 사용자가 '변환(.py) 뷰'로 끄면("0") 그때만 변환 뷰를 쓴다.
// (mnNotebookMode(false) → "0" 저장. 값이 없거나 "0" 이 아니면 셀 노트북 뷰가 기본.)
function notebookModeEnabled(){
  try { return localStorage.getItem("mn.notebookMode") !== "0"; } catch(e){ return true; }
}
const NOTEBOOK_RECOVERY_DB = "manneung-notebook-recovery";
const NOTEBOOK_RECOVERY_STORE = "drafts";
const NOTEBOOK_RECOVERY_MAX_TEXT = 20 * 1024 * 1024;
const NOTEBOOK_HISTORY_MAX_ENTRIES = 24;
const NOTEBOOK_HISTORY_MAX_TEXT = 12 * 1024 * 1024;
const NOTEBOOK_AUTOSAVE_DELAY = 3000;

function notebookRecoveryKey(ownerDoc){
  const path = normalizedRunPath(ownerDoc && (ownerDoc.workspacePath || ownerDoc.relPath || ownerDoc.name) || "notebook.ipynb");
  return "notebook:" + (path || "notebook.ipynb");
}

function notebookRecoveryOpen(){
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("indexeddb-unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTEBOOK_RECOVERY_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(NOTEBOOK_RECOVERY_STORE)){
        request.result.createObjectStore(NOTEBOOK_RECOVERY_STORE, { keyPath:"key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("notebook-recovery-open-failed"));
  });
}

async function notebookRecoveryRequest(mode, action){
  const db = await notebookRecoveryOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTEBOOK_RECOVERY_STORE, mode);
    let request;
    try { request = action(tx.objectStore(NOTEBOOK_RECOVERY_STORE)); }
    catch(error){ db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(request && request.result); };
    tx.onerror = () => { const error = tx.error; db.close(); reject(error || new Error("notebook-recovery-failed")); };
    tx.onabort = tx.onerror;
  });
}

async function notebookSaveRecovery(ownerDoc){
  if (!ownerDoc || !ownerDoc.notebookModel || !ownerDoc.hasUnsavedEdits) return false;
  if (ownerDoc._nbRecoverySaving) return ownerDoc._nbRecoverySaving;
  let text;
  try {
    nbSyncFindModel(ownerDoc);
    text = modelToIpynb(ownerDoc.notebookModel);
  } catch(_){ return false; }
  if (!text || text.length > NOTEBOOK_RECOVERY_MAX_TEXT) return false;
  const record = {
    key:notebookRecoveryKey(ownerDoc),
    name:String(ownerDoc.name || "notebook.ipynb"),
    updatedAt:Date.now(),
    text
  };
  ownerDoc._nbRecoverySaving = notebookRecoveryRequest("readwrite", store => store.put(record))
    .then(() => true)
    .catch(error => { console.warn("notebook recovery save skipped:", error); return false; })
    .finally(() => { ownerDoc._nbRecoverySaving = null; });
  return ownerDoc._nbRecoverySaving;
}

function notebookScheduleRecovery(ownerDoc){
  if (!ownerDoc || ownerDoc._nbHistoryRestoring) return;
  clearTimeout(ownerDoc._nbRecoveryTimer);
  ownerDoc._nbRecoveryTimer = setTimeout(() => {
    ownerDoc._nbRecoveryTimer = 0;
    notebookSaveRecovery(ownerDoc);
  }, 1200);
}

function notebookAutosaveTarget(ownerDoc, serverAvailable){
  if (!ownerDoc || !ownerDoc.notebookModel || !ownerDoc.hasUnsavedEdits) return "";
  if (ownerDoc.isScratch && !ownerDoc._named) return "";
  if (ownerDoc.originalSaveMode){
    return ownerDoc.fsHandle && typeof ownerDoc.fsHandle.createWritable === "function" ? "file-handle" : "";
  }
  return serverAvailable && (ownerDoc.workspacePath || ownerDoc.name) ? "server" : "";
}

function notebookSetAutosaveState(ownerDoc, state){
  if (!ownerDoc) return;
  ownerDoc._nbAutosaveState = state || "";
  updateNbSaveButton(ownerDoc, ownerDoc._nbSaveBtn);
}

async function notebookWriteAutosave(text, ownerDoc, name, target){
  if (target === "file-handle"){
    const handle = ownerDoc && ownerDoc.fsHandle;
    if (!handle || typeof handle.createWritable !== "function") return false;
    if (typeof handle.queryPermission === "function"){
      const permission = await handle.queryPermission({ mode:"readwrite" });
      if (permission !== "granted") return false;
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(new Blob([text], { type:"application/x-ipynb+json" }));
      await writable.close();
    } catch(error){
      try { if (typeof writable.abort === "function") await writable.abort(); } catch(_){}
      throw error;
    }
    return true;
  }
  if (target === "server" && typeof saveViaServer === "function"){
    return !!(await saveViaServer(text, ownerDoc, name));
  }
  return false;
}

function notebookScheduleAutosave(ownerDoc){
  if (!ownerDoc || ownerDoc._nbHistoryRestoring) return;
  clearTimeout(ownerDoc._nbAutosaveTimer);
  if (!ownerDoc.hasUnsavedEdits) return;
  if (ownerDoc._nbAutosaveSaving){
    ownerDoc._nbAutosaveAgain = true;
    return;
  }
  ownerDoc._nbAutosaveTimer = setTimeout(() => {
    ownerDoc._nbAutosaveTimer = 0;
    notebookRunAutosave(ownerDoc);
  }, NOTEBOOK_AUTOSAVE_DELAY);
}

async function notebookRunAutosave(ownerDoc){
  if (!ownerDoc || !ownerDoc.notebookModel || !ownerDoc.hasUnsavedEdits) return false;
  if (ownerDoc._nbBusy || ownerDoc._nbRunAllActive){
    notebookScheduleAutosave(ownerDoc);
    return false;
  }
  if (ownerDoc._nbAutosaveSaving){
    ownerDoc._nbAutosaveAgain = true;
    return ownerDoc._nbAutosaveSaving;
  }
  ownerDoc._nbAutosaveAgain = false;
  const saving = (async () => {
    let serverAvailable = false;
    if (!ownerDoc.originalSaveMode && typeof saveFileBackendAvailable === "function"){
      serverAvailable = await saveFileBackendAvailable();
    }
    const target = notebookAutosaveTarget(ownerDoc, serverAvailable);
    if (!target) return false;
    nbSyncFindModel(ownerDoc);
    const text = modelToIpynb(ownerDoc.notebookModel);
    const name = ownerDoc.name || "notebook.ipynb";
    notebookSetAutosaveState(ownerDoc, "saving");
    const ok = await notebookWriteAutosave(text, ownerDoc, name, target);
    if (!ok) throw new Error("notebook-autosave-write-failed");
    ownerDoc.savedText = text;
    ownerDoc.size = new Blob([text]).size;
    if (typeof markDocumentSavedAsUtf8 === "function") markDocumentSavedAsUtf8(ownerDoc);
    if (typeof rememberWorkspace === "function"){
      try {
        const savedName = ownerDoc.name || name;
        const savedPath = normalizedRunPath(ownerDoc.workspacePath || savedName);
        const updated = new File([text], savedName, { type:"application/x-ipynb+json" });
        if (savedPath.indexOf("/") >= 0){
          Object.defineProperty(updated, "webkitRelativePath", { value:savedPath });
        }
        ownerDoc.savedInWorkspace = await rememberWorkspace([updated], false, { silent:true });
      } catch(error){
        console.warn("notebook autosave workspace refresh skipped:", error);
      }
    }
    ownerDoc.hasUnsavedEdits = modelToIpynb(ownerDoc.notebookModel) !== text;
    if (typeof updateDocumentStatus === "function") updateDocumentStatus(ownerDoc);
    notebookSetAutosaveState(ownerDoc, ownerDoc.hasUnsavedEdits ? "" : "saved");
    nbSetStatus(ownerDoc, ownerDoc.hasUnsavedEdits ? "편집 내용 자동 저장 대기 중…" : "자동 저장됨");
    if (!ownerDoc.hasUnsavedEdits) await notebookDeleteRecovery(ownerDoc);
    return true;
  })().catch(error => {
    console.warn("notebook autosave skipped:", error);
    notebookSetAutosaveState(ownerDoc, "failed");
    nbSetStatus(ownerDoc, "자동 저장 실패 · 복구본은 유지됩니다");
    return false;
  }).finally(() => {
    ownerDoc._nbAutosaveSaving = null;
    if (ownerDoc._nbAutosaveAgain) notebookScheduleAutosave(ownerDoc);
  });
  ownerDoc._nbAutosaveSaving = saving;
  return saving;
}

async function notebookDeleteRecovery(ownerDoc){
  if (!ownerDoc) return;
  clearTimeout(ownerDoc._nbRecoveryTimer);
  ownerDoc._nbRecoveryTimer = 0;
  if (ownerDoc._nbRecoverySaving) await ownerDoc._nbRecoverySaving;
  try { await notebookRecoveryRequest("readwrite", store => store.delete(notebookRecoveryKey(ownerDoc))); }
  catch(error){ console.warn("notebook recovery delete skipped:", error); }
}

function notebookHistorySnapshot(ownerDoc){
  if (!ownerDoc || !ownerDoc.notebookModel) return "";
  nbSyncFindModel(ownerDoc);
  return modelToIpynb(ownerDoc.notebookModel);
}

function notebookTrimHistory(stack){
  while (stack.length > NOTEBOOK_HISTORY_MAX_ENTRIES) stack.shift();
  let total = stack.reduce((sum, entry) => sum + entry.text.length, 0);
  while (stack.length > 1 && total > NOTEBOOK_HISTORY_MAX_TEXT){
    total -= stack[0].text.length;
    stack.shift();
  }
}

function nbUpdateHistoryButtons(ownerDoc){
  if (!ownerDoc) return;
  if (ownerDoc._nbUndoBtn) ownerDoc._nbUndoBtn.disabled = !(ownerDoc._nbUndoStack && ownerDoc._nbUndoStack.length);
  if (ownerDoc._nbRedoBtn) ownerDoc._nbRedoBtn.disabled = !(ownerDoc._nbRedoStack && ownerDoc._nbRedoStack.length);
}

function nbPushHistory(ownerDoc, label){
  if (!ownerDoc || ownerDoc._nbHistoryRestoring) return;
  const text = notebookHistorySnapshot(ownerDoc);
  if (!text) return;
  if (!Array.isArray(ownerDoc._nbUndoStack)) ownerDoc._nbUndoStack = [];
  if (!Array.isArray(ownerDoc._nbRedoStack)) ownerDoc._nbRedoStack = [];
  const last = ownerDoc._nbUndoStack[ownerDoc._nbUndoStack.length - 1];
  if (!last || last.text !== text) ownerDoc._nbUndoStack.push({ text, label:String(label || "셀 작업") });
  ownerDoc._nbRedoStack.length = 0;
  notebookTrimHistory(ownerDoc._nbUndoStack);
  nbUpdateHistoryButtons(ownerDoc);
}

function notebookHeadingText(value){
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function notebookHeadings(model){
  const result = [];
  const cells = model && Array.isArray(model.cells) ? model.cells : [];
  cells.forEach((cell, index) => {
    if (!cell || cell.type !== "markdown") return;
    for (const line of String(cell.source || "").replace(/\r\n?/g, "\n").split("\n")){
      const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!match) continue;
      const text = notebookHeadingText(match[2]);
      if (text) result.push({ cellId:String(cell.id || ""), index, level:match[1].length, text });
    }
  });
  return result;
}

function nbRefreshToc(ownerDoc){
  if (!ownerDoc || !ownerDoc._nbTocList) return;
  const list = ownerDoc._nbTocList;
  const headings = notebookHeadings(ownerDoc.notebookModel);
  list.textContent = "";
  if (!headings.length){
    const empty = document.createElement("div");
    empty.className = "nbv-toc-empty";
    empty.textContent = "마크다운 제목(# 제목)을 추가하면 목차가 생깁니다.";
    list.appendChild(empty);
  } else {
    for (const heading of headings){
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nbv-toc-item";
      button.style.setProperty("--toc-depth", String(Math.max(0, heading.level - 1)));
      button.textContent = heading.text;
      button.title = heading.text;
      button.addEventListener("click", () => {
        const ctrl = (ownerDoc._nbCtrls || []).find(item => String(item.cell.id || "") === heading.cellId)
          || (ownerDoc._nbCtrls || [])[heading.index];
        if (!ctrl) return;
        if (ctrl.setBodyCollapsed) ctrl.setBodyCollapsed(false);
        nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), { focusCell:true, scroll:true, scrollBlock:"center" });
      });
      list.appendChild(button);
    }
  }
  if (ownerDoc._nbTocButton){
    ownerDoc._nbTocButton.textContent = "목차" + (headings.length ? " " + headings.length : "");
  }
}

function nbScheduleTocRefresh(ownerDoc){
  if (!ownerDoc || !ownerDoc._nbTocList || ownerDoc._nbTocRefresh) return;
  const run = () => { ownerDoc._nbTocRefresh = 0; nbRefreshToc(ownerDoc); };
  ownerDoc._nbTocRefresh = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : setTimeout(run, 0);
}

function nbAttachOutputToggle(ownerDoc, ctrl, wrap){
  if (!wrap || wrap.querySelector(":scope > .nbv-out-toggle")) return;
  const key = String(ctrl && ctrl.cell && ctrl.cell.id || "");
  const collapsed = ownerDoc
    ? (ownerDoc._nbCollapsedOutputs instanceof Set ? ownerDoc._nbCollapsedOutputs : (ownerDoc._nbCollapsedOutputs = new Set()))
    : new Set();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nbv-out-toggle";
  const sync = () => {
    const on = !!key && collapsed.has(key);
    wrap.classList.toggle("nbv-out-collapsed", on);
    button.textContent = on ? "▸ 출력 펼치기" : "▾ 출력 접기";
    button.setAttribute("aria-expanded", String(!on));
  };
  button.addEventListener("click", () => {
    if (!key) return;
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    sync();
  });
  if (ctrl) ctrl.syncOutputCollapsed = sync;
  wrap.prepend(button);
  sync();
}

function notebookSetOutputsCollapsed(ownerDoc, collapse){
  if (!ownerDoc) return 0;
  const collapsed = ownerDoc._nbCollapsedOutputs instanceof Set
    ? ownerDoc._nbCollapsedOutputs
    : (ownerDoc._nbCollapsedOutputs = new Set());
  const outputs = (ownerDoc._nbCtrls || []).filter(ctrl => ctrl && ctrl.outWrap);
  collapsed.clear();
  if (collapse){
    for (const ctrl of outputs){
      const key = String(ctrl.cell && ctrl.cell.id || "");
      if (key) collapsed.add(key);
    }
  }
  for (const ctrl of outputs){
    if (typeof ctrl.syncOutputCollapsed === "function") ctrl.syncOutputCollapsed();
  }
  return outputs.length;
}
if (typeof window !== "undefined"){
  window.mnNotebookMode = function(on){
    try { localStorage.setItem("mn.notebookMode", on ? "1" : "0"); } catch(e){}
    if (typeof location !== "undefined") location.reload();
  };
}

function blankNotebookText(){
  return modelToIpynb({
    cells: [{ id: nbNewId(), type: "code", source: "", execCount: null, outputs: [], rawOutputs: [], metadata: {} }],
    metadata: {}, nbformat: 4, nbformat_minor: 5
  });
}

// 빈 새 노트북(.ipynb) 만들기 — 코드 셀 하나로 시작. 기본 보기가 셀 노트북이라 바로 셀 편집기로 열린다.
function newNotebookScratch(){
  const blank = blankNotebookText();
  if (typeof handleFiles === "function"){
    handleFiles([new File([blank], "새 노트북.ipynb", { type: "application/json" })], { isScratch: true });
  }
}

// 폴더 우클릭에서 만든 노트북은 Python 새 파일과 같은 폴더 문맥을 이어받는다.
// 실제 디스크 기록은 첫 저장 때 이뤄지고, 폴더 안에서 이름이 겹치면 번호를 붙인다.
function newNotebookScratchInFolder(folder){
  if (!folder || !folder.parentId || !folder.archiveCtx || !folder.dir) return false;
  const dir = normalizedRunPath(folder.dir);
  if (!dir) return false;
  const taken = new Set(docs.map(doc => normalizedRunPath(doc.workspacePath || doc.relPath || "")));
  let name = "새 노트북.ipynb";
  for (let number = 2; taken.has(normalizedRunPath(dir + "/" + name)); number++){
    name = "새 노트북 " + number + ".ipynb";
  }
  const relPath = dir + "/" + name;
  if (typeof handleFiles === "function"){
    handleFiles([new File([blankNotebookText()], name, { type: "application/x-ipynb+json" })],
      { isScratch:true, parentId:folder.parentId, archiveCtx:folder.archiveCtx,
        relPath, workspacePath:relPath });
  }
  if (typeof toast === "function"){
    toast("'" + (folder.label || dir.split("/").pop() || dir) + "' 폴더 안에 새 노트북을 만들었어요.", 3000);
  }
  return true;
}

// ── 직렬화 ──────────────────────────────────────────────────────────────────
// .ipynb(JSON 문자열 또는 객체) → 내부 모델. nbformat 4 기준, nbformat 3(worksheets/input)도 받아들인다.
function ipynbToModel(jsonOrText){
  let nb;
  try { nb = (typeof jsonOrText === "string") ? JSON.parse(jsonOrText) : jsonOrText; }
  catch(e){ throw new Error("올바른 노트북(.ipynb) 파일이 아닙니다."); }
  if (!nb || typeof nb !== "object") throw new Error("올바른 노트북(.ipynb) 파일이 아닙니다.");
  const rawCells = Array.isArray(nb.cells) ? nb.cells
    : (nb.worksheets && nb.worksheets[0] && Array.isArray(nb.worksheets[0].cells) ? nb.worksheets[0].cells : []);
  const cells = rawCells.map((c, i) => {
    const t = c && c.cell_type;
    const type = (t === "markdown" || t === "raw") ? t : "code";
    const src = (c && c.source != null) ? c.source : (c ? c.input : "");   // nbformat 3 은 input
    const source = (Array.isArray(src) ? src.join("") : (src || "")).replace(/\r\n?/g, "\n");
    return {
      id: (c && c.id) ? String(c.id) : ("cell-" + i + "-" + Math.random().toString(36).slice(2, 8)),
      type,
      source,
      execCount: (c && typeof c.execution_count === "number") ? c.execution_count : null,
      outputs: parseNbOutputs(c && c.outputs),
      rawOutputs: (c && Array.isArray(c.outputs)) ? c.outputs : [],
      attachments: (c && c.attachments && typeof c.attachments === "object") ? c.attachments : null,
      metadata: (c && c.metadata && typeof c.metadata === "object") ? c.metadata : {}
    };
  });
  return {
    cells,
    metadata: (nb.metadata && typeof nb.metadata === "object") ? nb.metadata : {},
    nbformat: (typeof nb.nbformat === "number") ? nb.nbformat : 4,
    nbformat_minor: (typeof nb.nbformat_minor === "number") ? nb.nbformat_minor : 5
  };
}

function notebookJsonOutput(value){
  if (typeof value === "string"){
    try { return JSON.stringify(JSON.parse(value), null, 2); }
    catch(_){ return value; }
  }
  try { return JSON.stringify(value, null, 2); }
  catch(_){ return String(value == null ? "" : value); }
}

function notebookTracebackLine(value){
  const text = String(value || "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  let line = 0;
  const patterns = [
    /\bFile\s+["'][^"']*["']\s*,\s*line\s+(\d+)/gi,
    /\bline\s+(\d+)\b/gi
  ];
  for (const pattern of patterns){
    let match;
    while ((match = pattern.exec(text))) line = Math.max(1, Number(match[1]) || 0);
    if (line) break;
  }
  return line;
}

// nbformat outputs → 표시용 간단 모델(스트림/이미지/결과/에러).
function notebookStderrKind(value, status){
  return (typeof classifyPythonStderr === "function")
    ? classifyPythonStderr(value, status)
    : (value ? "error" : "none");
}

function renderNotebookStderr(host, value, ctrl, status){
  const kind = notebookStderrKind(value, status);
  if (kind === "error"){
    renderNotebookError(host, value, ctrl);
    return;
  }
  const pre = document.createElement("pre");
  pre.className = "nbv-out-text nbv-out-warning";
  pre.textContent = String(value || "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  host.appendChild(pre);
}

function parseNbOutputs(outputs){
  if (!Array.isArray(outputs)) return [];
  const joined = (v) => Array.isArray(v) ? v.join("") : (v == null ? "" : String(v));
  const out = [];
  for (const o of outputs){
    if (!o || typeof o !== "object") continue;
    const k = o.output_type;
    if (k === "stream"){
      out.push({ kind: "stream", name: o.name || "stdout", text: joined(o.text) });
    } else if (k === "error"){
      const tb = Array.isArray(o.traceback) ? o.traceback.join("\n") : "";
      out.push({ kind: "error", text: tb || ((o.ename || "") + ": " + (o.evalue || "")) });
    } else if (k === "execute_result" || k === "display_data"){
      const data = o.data || {};
      const interactiveKey = Object.keys(data).find(key =>
        /^application\/vnd\.plotly\.v\d+\+json$/i.test(key) ||
        /^application\/vnd\.vega(?:lite)?\.v\d+\+json$/i.test(key) ||
        /^application\/vnd\.bokehjs_(?:exec|load)\.v\d+\+json$/i.test(key) ||
        (key === "application/javascript" && /\bBokeh\b/.test(joined(data[key])))
      );
      const audioKey = Object.keys(data).find(key => /^audio\/(?:mpeg|mp4|wav|ogg|webm)$/i.test(key));
      const videoKey = Object.keys(data).find(key => /^video\/(?:mp4|webm|ogg)$/i.test(key));
      if (interactiveKey) out.push({ kind:"interactive", mime:interactiveKey, data:data[interactiveKey] });
      else if (data["image/png"]) out.push({ kind: "image", mime: "image/png", b64: joined(data["image/png"]) });
      else if (data["image/jpeg"]) out.push({ kind: "image", mime: "image/jpeg", b64: joined(data["image/jpeg"]) });
      else if (data["image/svg+xml"]) out.push({ kind: "svg", svg: joined(data["image/svg+xml"]) });
      else if (data["text/html"]) out.push({ kind: "html", html: joined(data["text/html"]) });
      else if (audioKey) out.push({ kind:"media", media:"audio", mime:audioKey, b64:joined(data[audioKey]) });
      else if (videoKey) out.push({ kind:"media", media:"video", mime:videoKey, b64:joined(data[videoKey]) });
      else if (data["text/latex"]) out.push({ kind:"latex", text:joined(data["text/latex"]) });
      else {
        const jsonKey = Object.keys(data).find(key => key === "application/json" || /\+json$/i.test(key));
        if (jsonKey) out.push({ kind: "json", text:notebookJsonOutput(data[jsonKey]), mime:jsonKey });
        else if (data["text/plain"]) out.push({ kind: "result", text: joined(data["text/plain"]) });
      }
    }
  }
  return out;
}

// 내부 모델 → .ipynb(JSON 문자열). nbformat 3 입력도 유효한 nbformat 4.5로 변환해 저장한다.
const NOTEBOOK_RICH_FRAME_MAX_HTML = 5 * 1024 * 1024;

function notebookDecodeHtmlAttribute(value){
  return String(value == null ? "" : value)
    .replace(/&#(\d+);/g, (_, digits) => {
      const code = Number(digits);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => {
      const code = parseInt(digits, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

// Folium의 _repr_html_은 신뢰되지 않은 Jupyter용 안내문과 실제 지도를 담은 srcdoc iframe을 함께 반환한다.
// 일반 HTML 허용 범위는 넓히지 않고, 이 형태만 부모 문서와 origin이 분리된 sandbox iframe으로 옮긴다.
function notebookFoliumFrameSpec(html){
  const input = String(html == null ? "" : html);
  if (!input || input.length > NOTEBOOK_RICH_FRAME_MAX_HTML ||
      !/Make this Notebook Trusted to load map/i.test(input)) return null;
  const frames = input.match(/<iframe\b/gi) || [];
  if (frames.length !== 1) return null;
  const tag = /<iframe\b[\s\S]*?>/i.exec(input);
  if (!tag) return null;
  const attr = /\bsrcdoc\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag[0]);
  if (!attr) return null;
  const srcdoc = notebookDecodeHtmlAttribute(attr[2]);
  if (!srcdoc || srcdoc.length > NOTEBOOK_RICH_FRAME_MAX_HTML ||
      !/leaflet/i.test(srcdoc) || !/\bL\.map\s*\(/.test(srcdoc)) return null;
  const ratioMatch = /padding-bottom\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i.exec(input);
  const ratio = Math.min(100, Math.max(30, ratioMatch ? Number(ratioMatch[1]) : 60));
  return { srcdoc, paddingBottom:ratio + "%" };
}

/* ===== 지도 iframe 스냅샷(PDF용) =====
 * folium 지도는 origin 이 분리된 sandbox iframe 에서 돌아 부모의 캡처 라이브러리가 내부에 닿지 않는다.
 * 대신 srcdoc 에 가벼운 수신기를 심어 두고, PDF 내보내기 때 부모가 postMessage 로 캡처 라이브러리
 * "소스 코드"를 함께 보내면 iframe 스스로 자신을 PNG 로 찍어 돌려준다(라이브러리는 그때 1회 eval).
 * 캡처는 html-to-image(SVG foreignObject 방식)를 쓴다 — html2canvas 는 복제용 중첩 iframe 을 만드는데
 * sandbox(origin null) 문서 안에서는 중첩 iframe 접근이 차단돼 실패한다(실측 확인).
 * 실패(오프라인·타일 차단·시간 초과)하면 부모가 안내 박스로 대체한다. */
const NB_MAP_CAPTURE_BOOTSTRAP = "<script>(function(){\n"
  + "var TILE_HOSTS = /(^|\\.)(tile\\.openstreetmap\\.org|basemaps\\.cartocdn\\.com|tile\\.opentopomap\\.org|server\\.arcgisonline\\.com|tiles\\.stadiamaps\\.com|tile\\.thunderforest\\.com)$/;\n"
  + "var proxied = [];\n"
  + "function rewriteTiles(base){\n"
  + "  if (!base) return Promise.resolve();\n"
  + "  var waits = [];\n"
  + "  var imgs = document.querySelectorAll('img');\n"
  + "  for (var i = 0; i < imgs.length; i++){ (function(img){\n"
  + "    var src = img.src || '';\n"
  + "    var m = /^https:\\/\\/([^\\/]+)\\//.exec(src);\n"
  + "    if (!m || !TILE_HOSTS.test(m[1])) return;\n"
  + "    proxied.push([img, src]);\n"
  + "    waits.push(new Promise(function(res){\n"
  + "      img.addEventListener('load', res, { once:true });\n"
  + "      img.addEventListener('error', res, { once:true });\n"
  + "      setTimeout(res, 8000);\n"
  + "    }));\n"
  + "    img.src = base + encodeURIComponent(src);\n"
  + "  })(imgs[i]); }\n"
  + "  return Promise.all(waits).then(function(){\n"
  + "    // 재로드가 leaflet 타일 페이드인을 재시작시켜 캡처 순간 투명(opacity 0)일 수 있다 → 강제로 불투명 고정\n"
  + "    for (var i = 0; i < proxied.length; i++){ try { proxied[i][0].style.opacity = '1'; } catch(_){} }\n"
  + "    return new Promise(function(res){ setTimeout(res, 350); });\n"
  + "  });\n"
  + "}\n"
  + "function restoreTiles(){ for (var i = 0; i < proxied.length; i++){ try { proxied[i][0].src = proxied[i][1]; } catch(_){} } proxied = []; }\n"
  + "window.addEventListener('message', function(ev){\n"
  + "  var d = ev.data || {};\n"
  + "  if (!d || d.type !== 'nbv-map-snapshot') return;\n"
  + "  var send = function(url, error){ try { ev.source.postMessage({ type:'nbv-map-snapshot-result', id:d.id, dataUrl:url || '', error:error || '' }, '*'); } catch(_){} };\n"
  + "  try {\n"
  + "    if ((typeof htmlToImage === 'undefined' || !htmlToImage) && d.lib) (0, eval)(d.lib);\n"
  + "    if (typeof htmlToImage === 'undefined' || !htmlToImage || typeof htmlToImage.toPng !== 'function'){ send('', 'no-capture-lib'); return; }\n"
  + "    var w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);\n"
  + "    rewriteTiles(String(d.tileProxy || '')).then(function(){\n"
  + "      return htmlToImage.toPng(document.body, { width:w, height:h, backgroundColor:'#ffffff',\n"
  + "          pixelRatio:Math.min(2, Math.max(1, Number(d.scale) || 1.5)), cacheBust:false });\n"
  + "    }).then(function(url){ restoreTiles(); send(url); })\n"
  + "      .catch(function(e){ restoreTiles(); send('', String((e && e.message) || e)); });\n"
  + "  } catch(e){ restoreTiles(); send('', String((e && e.message) || e)); }\n"
  + "});\n"
  + "})();<\/script>";
function nbInjectMapCapture(srcdoc){
  const doc = String(srcdoc || "");
  return /<\/body>/i.test(doc)
    ? doc.replace(/<\/body>/i, () => NB_MAP_CAPTURE_BOOTSTRAP + "</body>")
    : doc + NB_MAP_CAPTURE_BOOTSTRAP;
}

function notebookFrameDocument(html, headHtml){
  const input = String(html || "");
  const extra = String(headHtml || "");
  if (/<html[\s>]/i.test(input)){
    if (!extra) return input;
    return /<\/head>/i.test(input)
      ? input.replace(/<\/head>/i, extra + "</head>")
      : input.replace(/<body[\s>]/i, extra + "$&");
  }
  return "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<style>html,body{margin:0;padding:0;max-width:100%;overflow:auto;background:#fff}" +
    "body{box-sizing:border-box;padding:4px}img,svg,canvas{max-width:100%}</style>" + extra + "</head><body>" +
    input + "</body></html>";
}

function notebookInteractiveHtmlFrameSpec(html){
  const input = String(html == null ? "" : html);
  if (!input || input.length > NOTEBOOK_RICH_FRAME_MAX_HTML) return null;
  const folium = notebookFoliumFrameSpec(input);
  if (folium) return { ...folium, title:"Folium 지도", allowScripts:true, mapCapture:true };
  if (/<(?:audio|video)\b/i.test(input)){
    return {
      srcdoc:notebookFrameDocument(input),
      height:/<video\b/i.test(input) ? "420px" : "96px",
      title:"미디어 출력",
      allowScripts:false
    };
  }
  const signatures = [
    {
      title:"Plotly 차트",
      pattern:/\bPlotly\.newPlot\s*\(|plotly-graph-div|cdn\.plot\.ly/i,
      head:/cdn\.plot\.ly/i.test(input) ? "" : "<script src=\"https://cdn.plot.ly/plotly-2.35.2.min.js\"></script>"
    },
    { title:"Bokeh 차트", pattern:/\bBokeh\.(?:embed|documents)|\bbk-root\b|cdn\.bokeh\.org/i, head:"" },
    {
      title:"Altair 차트",
      pattern:/\bvegaEmbed\s*\(|vega-lite|vega-embed/i,
      head:/vega-embed/i.test(input) && /<script[^>]+src=/i.test(input) ? "" :
        "<script src=\"https://cdn.jsdelivr.net/npm/vega@5\"></script>" +
        "<script src=\"https://cdn.jsdelivr.net/npm/vega-lite@5\"></script>" +
        "<script src=\"https://cdn.jsdelivr.net/npm/vega-embed@6\"></script>"
    }
  ];
  const match = signatures.find(item => item.pattern.test(input));
  if (!match || !/<script\b/i.test(input)) return null;
  return {
    srcdoc:notebookFrameDocument(input, match.head),
    paddingBottom:"62%",
    title:match.title,
    allowScripts:true
  };
}

// 알려진 차트가 아닌 HTML은 기본적으로 정적으로만 보여 준다. 스크립트·iframe 등
// 실행 가능한 요소가 있을 때만, 문서 단위 신뢰 승인을 받은 뒤 별도 sandbox에서 실행한다.
function notebookUntrustedHtmlFrameSpec(html){
  const input = String(html == null ? "" : html);
  if (!input || input.length > NOTEBOOK_RICH_FRAME_MAX_HTML) return null;
  if (!/<(?:script|iframe|object|embed)\b|\son[a-z]+\s*=/i.test(input)) return null;
  return {
    srcdoc:notebookFrameDocument(input),
    paddingBottom:"62%",
    title:"신뢰된 인터랙티브 HTML 출력",
    allowScripts:true,
    requiresTrust:true
  };
}

function notebookJsonForScript(value){
  let json;
  try { json = JSON.stringify(value); }
  catch(_){ return ""; }
  return json.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function notebookInteractiveMimeFrameSpec(mime, value){
  const type = String(mime || "").toLowerCase();
  if (type === "application/javascript" && /\bBokeh\b/.test(String(value || ""))){
    const code = String(value || "").replace(/<\/script/gi, "<\\/script");
    return {
      title:"Bokeh 차트",
      paddingBottom:"62%",
      allowScripts:true,
      srcdoc:"<!doctype html><html><head><meta charset=\"utf-8\">" +
        "<script src=\"https://cdn.bokeh.org/bokeh/release/bokeh-3.6.0.min.js\"></script>" +
        "<style>html,body{margin:0;padding:0;background:#fff}</style></head><body>" +
        "<script>" + code + "</script></body></html>"
    };
  }
  const payload = notebookJsonForScript(value);
  if (!payload || payload.length > NOTEBOOK_RICH_FRAME_MAX_HTML) return null;
  if (/^application\/vnd\.plotly\.v\d+\+json$/.test(type)){
    return {
      title:"Plotly 차트",
      paddingBottom:"62%",
      allowScripts:true,
      srcdoc:"<!doctype html><html><head><meta charset=\"utf-8\">" +
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<script src=\"https://cdn.plot.ly/plotly-2.35.2.min.js\"></script>" +
        "<style>html,body,#chart{margin:0;width:100%;height:100%;min-height:320px}</style></head>" +
        "<body><div id=\"chart\"></div><script>const spec=" + payload + ";" +
        "Plotly.newPlot('chart',spec.data||[],spec.layout||{},Object.assign({responsive:true},spec.config||{}));" +
        "</script></body></html>"
    };
  }
  if (/^application\/vnd\.vega(?:lite)?\.v\d+\+json$/.test(type)){
    const mode = type.includes("vegalite") ? "vega-lite" : "vega";
    return {
      title:mode === "vega-lite" ? "Altair 차트" : "Vega 차트",
      paddingBottom:"62%",
      allowScripts:true,
      srcdoc:"<!doctype html><html><head><meta charset=\"utf-8\">" +
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<script src=\"https://cdn.jsdelivr.net/npm/vega@5\"></script>" +
        "<script src=\"https://cdn.jsdelivr.net/npm/vega-lite@5\"></script>" +
        "<script src=\"https://cdn.jsdelivr.net/npm/vega-embed@6\"></script>" +
        "<style>html,body,#vis{margin:0;max-width:100%;min-height:320px;background:#fff}</style></head>" +
        "<body><div id=\"vis\"></div><script>const spec=" + payload + ";" +
        "vegaEmbed('#vis',spec,{actions:true,mode:'" + mode + "',renderer:'canvas'});" +
        "</script></body></html>"
    };
  }
  if (/^application\/vnd\.bokehjs_(?:exec|load)\.v\d+\+json$/.test(type)){
    const rawVersion = value && typeof value === "object" ? String(value.version || "") : "";
    const bokehVersion = /^\d+\.\d+\.\d+$/.test(rawVersion) ? rawVersion : "3.6.0";
    return {
      title:"Bokeh 차트",
      paddingBottom:"62%",
      allowScripts:true,
      srcdoc:"<!doctype html><html><head><meta charset=\"utf-8\">" +
        "<script src=\"https://cdn.bokeh.org/bokeh/release/bokeh-" + bokehVersion + ".min.js\"></script>" +
        "<style>html,body{margin:0;padding:0;background:#fff}</style></head><body><div id=\"bokeh\"></div>" +
        "<script>const spec=" + payload + ";const docs=spec.docs_json||spec.doc_json||spec.docs;" +
        "const items=spec.render_items||spec.render_item||spec.items||[];" +
        "for(const item of (Array.isArray(items)?items:[items])){" +
        "for(const id of Object.values(item.roots||{})){if(!document.getElementById(id)){" +
        "const el=document.createElement('div');el.id=id;document.getElementById('bokeh').appendChild(el);}}}" +
        "if(spec.item)Bokeh.embed.embed_item(spec.item,'bokeh');" +
        "else if(docs&&items)Bokeh.embed.embed_items(docs,items);</script></body></html>"
    };
  }
  return null;
}

const NOTEBOOK_PERSISTED_MIME = [
  "text/html", "text/plain", "text/latex", "image/svg+xml", "image/png", "image/jpeg",
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm",
  "video/mp4", "video/webm", "video/ogg", "application/json", "application/javascript"
];

function notebookMimeShouldPersist(key){
  return NOTEBOOK_PERSISTED_MIME.includes(key) ||
    /^application\/vnd\.(?:plotly|vega|vegalite|bokehjs_)[^;]*\+json$/i.test(key) ||
    /\+json$/i.test(key);
}

function modelToIpynb(model){
  const cells = ((model && model.cells) || []).map(cell => {
    // 필기 저장 보류: manneung_ink 메타데이터는 파일로 직렬화하지 않는다(세션 한정).
    const rawMeta = (cell.metadata && typeof cell.metadata === "object") ? cell.metadata : {};
    const metadata = {};
    for (const key in rawMeta){ if (key !== NB_INK_META_KEY) metadata[key] = rawMeta[key]; }
    const node = {
      cell_type: cell.type === "markdown" || cell.type === "raw" ? cell.type : "code",
      metadata,
      source: splitSourceLines(cell.source)
    };
    if (cell.id) node.id = String(cell.id);
    if (node.cell_type === "code"){
      node.execution_count = (typeof cell.execCount === "number") ? cell.execCount : null;
      node.outputs = Array.isArray(cell.rawOutputs) ? cell.rawOutputs : [];
    } else if (node.cell_type === "markdown" && cell.attachments && typeof cell.attachments === "object"){
      node.attachments = cell.attachments;
    }
    return node;
  });
  const nb = {
    cells,
    metadata: (model && model.metadata) || {},
    nbformat: 4,
    nbformat_minor: 5
  };
  return JSON.stringify(nb, null, 1) + "\n";
}

// 브라우저 커널 결과를 nbformat output 노드로 바꿔 다음 저장에서도 실행 결과가 유지되게 한다.
function notebookResultToRawOutputs(result, executionCount){
  result = result || {};
  const outputs = [];
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (stdout) outputs.push({ output_type:"stream", name:"stdout", text:splitSourceLines(stdout) });
  if (stderr){
    if (result.ok === false){
      const lines = stderr.replace(/\n+$/, "").split("\n");
      const last = lines[lines.length - 1] || "실행 오류";
      const colon = last.indexOf(":");
      outputs.push({
        output_type:"error",
        ename:colon > 0 ? last.slice(0, colon).trim() : "Error",
        evalue:colon > 0 ? last.slice(colon + 1).trim() : last,
        traceback:lines
      });
    } else {
      outputs.push({ output_type:"stream", name:"stderr", text:splitSourceLines(stderr) });
    }
  }
  for (const rich of (Array.isArray(result.richOutputs) ? result.richOutputs : [])){
    if (!rich || typeof rich !== "object") continue;
    const sourceData = rich.data && typeof rich.data === "object" ? rich.data : {};
    const data = {};
    for (const key of Object.keys(sourceData)){
      if (!notebookMimeShouldPersist(key)) continue;
      if (key === "application/json" || /\+json$/i.test(key)){
        data[key] = notebookJsonClone(sourceData[key], sourceData[key]);
      } else {
        data[key] = String(sourceData[key]);
      }
    }
    if (!Object.keys(data).length) continue;
    const outputType = rich.output_type === "execute_result" ? "execute_result" : "display_data";
    const node = { output_type:outputType, data, metadata:{} };
    if (outputType === "execute_result"){
      node.execution_count = typeof executionCount === "number" ? executionCount : null;
    }
    outputs.push(node);
  }
  for (const src of (Array.isArray(result.images) ? result.images : [])){
    const match = /^data:(image\/(?:png|jpeg));base64,([\s\S]+)$/i.exec(String(src || ""));
    if (!match) continue;
    outputs.push({
      output_type:"display_data",
      data:{ [match[1].toLowerCase()]:match[2] },
      metadata:{}
    });
  }
  return outputs;
}

// 문자열 source → nbformat 의 줄 배열(마지막 줄 빼고 각 줄 끝에 \n 유지, 마지막 개행은 분리하지 않음).
//  "a\nb"  → ["a\n","b"]      "a\nb\n" → ["a\n","b\n"]      "" → []
function splitSourceLines(text){
  const s = String(text == null ? "" : text);
  if (s === "") return [];
  const parts = s.split("\n");
  const lines = [];
  for (let i = 0; i < parts.length; i++){
    if (i < parts.length - 1) lines.push(parts[i] + "\n");
    else if (parts[i] !== "") lines.push(parts[i]);   // 끝에 개행이 있으면(마지막이 "") 더 넣지 않음
  }
  return lines;
}

// 실행 당시 코드와 앞쪽 코드 셀 구성을 짧은 해시로 기록해, 저장·재실행 후에도
// 현재 화면의 출력이 최신 코드에서 나온 것인지 판별한다.
const NB_EXEC_META_KEY = "manneung_execution";
const NB_INK_META_KEY = "manneung_ink";
let _notebookCellClipboard = [];

function notebookJsonClone(value, fallback){
  if (value == null) return fallback;
  try { return JSON.parse(JSON.stringify(value)); }
  catch(_){ return fallback; }
}

// 셀 클립보드에는 다시 실행하지 않은 새 셀로서 안전한 정보만 담는다.
// 코드/마크다운 내용·첨부·일반 메타데이터는 보존하고 실행 결과·상태·세션 필기는 제외한다.
function notebookCellClipboardSnapshot(cells){
  const snapshots = [];
  for (const cell of (Array.isArray(cells) ? cells : [])){
    if (!cell || typeof cell !== "object") continue;
    const type = cell.type === "markdown" || cell.type === "raw" ? cell.type : "code";
    const metadata = notebookJsonClone(cell.metadata, {});
    delete metadata[NB_EXEC_META_KEY];
    delete metadata[NB_INK_META_KEY];
    snapshots.push({
      type,
      source:String(cell.source || ""),
      attachments:type === "markdown" ? notebookJsonClone(cell.attachments, null) : null,
      metadata
    });
  }
  return snapshots;
}

function notebookMaterializeClipboardCells(snapshots){
  return (Array.isArray(snapshots) ? snapshots : []).map(snapshot => {
    const type = snapshot && (snapshot.type === "markdown" || snapshot.type === "raw") ? snapshot.type : "code";
    return {
      id:nbNewId(),
      type,
      source:String(snapshot && snapshot.source || ""),
      execCount:null,
      outputs:[],
      rawOutputs:[],
      attachments:type === "markdown" ? notebookJsonClone(snapshot && snapshot.attachments, null) : null,
      metadata:notebookJsonClone(snapshot && snapshot.metadata, {})
    };
  });
}
const NB_INK_BAR_POS_KEY = "mn.nbInkBarPos";   // 필기 바 마지막 위치·세로 여부(뷰포트 좌표)
function notebookExecutionHash(value){
  const text = String(value == null ? "" : value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

function notebookCellHasExecutableSource(cell){
  return !!String(cell && cell.source || "").trim();
}

function notebookUpstreamHash(model, targetCell){
  const rows = [];
  for (const cell of (model && Array.isArray(model.cells) ? model.cells : [])){
    if (cell === targetCell) break;
    if (cell && cell.type === "code"){
      rows.push([String(cell.id || ""), notebookExecutionHash(cell.source)]);
    }
  }
  return notebookExecutionHash(JSON.stringify(rows));
}

function notebookRecordExecution(model, cell, ok, snapshot){
  if (!cell || cell.type !== "code") return null;
  if (!cell.metadata || typeof cell.metadata !== "object") cell.metadata = {};
  const meta = {
    version:1,
    source_hash:snapshot && snapshot.source_hash ? snapshot.source_hash : notebookExecutionHash(cell.source),
    upstream_hash:snapshot && snapshot.upstream_hash ? snapshot.upstream_hash : notebookUpstreamHash(model, cell),
    status:ok === false ? "error" : "ok"
  };
  cell.metadata[NB_EXEC_META_KEY] = meta;
  return meta;
}

function notebookClearExecution(cell){
  if (cell && cell.metadata && typeof cell.metadata === "object"){
    delete cell.metadata[NB_EXEC_META_KEY];
  }
}

function notebookCellExecutionState(model, cell){
  if (!cell || cell.type !== "code") return { status:"none", reason:"" };
  const meta = cell.metadata && cell.metadata[NB_EXEC_META_KEY];
  const hasResult = cell.execCount != null || !!(cell.rawOutputs && cell.rawOutputs.length);
  if (!meta || typeof meta !== "object" || !meta.source_hash){
    if (!hasResult && !notebookCellHasExecutableSource(cell)){
      return { status:"blank", reason:"빈 코드 셀입니다." };
    }
    return hasResult
      ? { status:"unknown", reason:"기존 실행 결과라 현재 코드와 같은 상태에서 실행됐는지 확인할 수 없어요." }
      : { status:"never", reason:"아직 실행하지 않은 셀이에요." };
  }
  if (meta.source_hash !== notebookExecutionHash(cell.source)){
    return { status:"stale", reason:"이 셀을 실행한 뒤 코드가 수정됐어요." };
  }
  if (!notebookCellHasExecutableSource(cell)){
    return { status:"blank", reason:"빈 코드 셀은 실행 결과를 표시하지 않아요." };
  }
  if (meta.upstream_hash !== notebookUpstreamHash(model, cell)){
    return { status:"stale", reason:"앞쪽 코드 셀이 바뀌어 이 결과는 이전 상태에서 만들어졌어요." };
  }
  if (meta.status === "error"){
    return { status:"error", reason:"현재 코드의 마지막 실행에서 오류가 발생했어요." };
  }
  return { status:"fresh", reason:"현재 코드와 앞쪽 셀 상태가 실행 결과와 일치해요." };
}

function notebookNormalizeInkStrokes(value){
  const source = Array.isArray(value) ? value : [];
  const result = [];
  for (const stroke of source.slice(0, 600)){
    if (!stroke || typeof stroke !== "object") continue;
    const tool = ["pen","highlighter","eraser"].includes(stroke.tool) ? stroke.tool : "pen";
    const color = /^#[0-9a-f]{6}$/i.test(String(stroke.color || "")) ? String(stroke.color) : "#e11d48";
    const width = Math.max(1, Math.min(60, Number(stroke.width) || 3));
    const points = [];
    for (const point of (Array.isArray(stroke.points) ? stroke.points : []).slice(0, 4000)){
      const x = Number(point && point.x), y = Number(point && point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x:Math.max(0, Math.min(1, x)), y:Math.max(0, Math.min(1, y)) });
    }
    if (points.length) result.push({ tool, color, width, points });
  }
  return result;
}

function notebookEnsureInkStrokes(cell, create=true){
  if (!cell.metadata || typeof cell.metadata !== "object") cell.metadata = {};
  const stored = cell.metadata[NB_INK_META_KEY];
  if (!stored && !create) return [];
  const strokes = notebookNormalizeInkStrokes(stored && stored.strokes);
  cell.metadata[NB_INK_META_KEY] = { version:1, strokes };
  return strokes;
}

function notebookDropEmptyInkMetadata(cell){
  const stored = cell && cell.metadata && cell.metadata[NB_INK_META_KEY];
  if (stored && Array.isArray(stored.strokes) && !stored.strokes.length){
    delete cell.metadata[NB_INK_META_KEY];
  }
}

// 현재 코드 셀 자동완성에 앞쪽 코드 셀의 변수·import 문맥을 함께 제공한다.
// 앞쪽 셀 접두부는 대상 셀별로 캐시하고 현재 셀 내용만 매 입력마다 붙인다.
// lineOffset 은 합쳐진 소스에서 현재 셀이 시작하는 0-based 줄 오프셋(Jedi 줄 번호 보정용).
function notebookCompletionContext(model, targetCell, currentSource, cache=null){
  const cells = (model && Array.isArray(model.cells)) ? model.cells : [];
  const targetIndex = cells.indexOf(targetCell);
  if (targetIndex < 0) return { source:String(currentSource || ""), lineOffset:0 };
  if (cache && cache.model !== model){
    cache.model = model;
    cache.entries = new Map();
  }
  const cached = cache && cache.entries instanceof Map ? cache.entries.get(targetCell) : null;
  if (cached && cached.targetIndex === targetIndex){
    return {
      source:cached.prefix + String(currentSource || ""),
      lineOffset:cached.lineOffset
    };
  }
  const previous = [];
  for (let i = 0; i < targetIndex; i++){
    const cell = cells[i];
    if (cell && cell.type === "code" && String(cell.source || "").trim()) previous.push(String(cell.source || ""));
  }
  const prefix = previous.length ? previous.join("\n\n") + "\n\n" : "";
  const lineOffset = (prefix.match(/\n/g) || []).length;
  if (cache && cache.entries instanceof Map){
    cache.entries.set(targetCell, { targetIndex, prefix, lineOffset });
  }
  return {
    source:prefix + String(currentSource || ""),
    lineOffset
  };
}

function notebookInvalidateCompletionCache(cache, model, changedCell=null){
  if (!cache || typeof cache !== "object") return;
  if (cache.model !== model || !(cache.entries instanceof Map)){
    cache.model = model;
    cache.entries = new Map();
    return;
  }
  if (!changedCell){
    cache.entries.clear();
    return;
  }
  const cells = (model && Array.isArray(model.cells)) ? model.cells : [];
  const changedIndex = cells.indexOf(changedCell);
  if (changedIndex < 0){
    cache.entries.clear();
    return;
  }
  for (const target of [...cache.entries.keys()]){
    if (cells.indexOf(target) > changedIndex) cache.entries.delete(target);
  }
}

function nbCompletionCache(ownerDoc){
  if (!ownerDoc) return null;
  if (!ownerDoc._nbCompletionCache){
    ownerDoc._nbCompletionCache = { model:ownerDoc.notebookModel, entries:new Map() };
  }
  return ownerDoc._nbCompletionCache;
}

function nbInvalidateCompletionCache(ownerDoc, changedCell=null){
  if (!ownerDoc) return;
  notebookInvalidateCompletionCache(nbCompletionCache(ownerDoc), ownerDoc.notebookModel, changedCell);
}

function notebookCodeSource(model){
  return ((model && model.cells) || [])
    .filter(cell => cell && cell.type === "code")
    .map(cell => String(cell.source || ""))
    .filter(source => source.trim())
    .join("\n\n");
}

function notebookSkipPythonString(source, start){
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return start + 1;
  const triple = source.slice(start, start + 3) === quote.repeat(3);
  const delimiterLength = triple ? 3 : 1;
  let i = start + delimiterLength;
  while (i < source.length){
    if (source[i] === "\\"){ i += 2; continue; }
    if (source.slice(i, i + delimiterLength) === quote.repeat(delimiterLength)) return i + delimiterLength;
    i++;
  }
  return source.length;
}

function notebookInputPrompt(argument){
  const text = String(argument || "").trim();
  if (!text) return "";
  const match = /^(?:[uU])?(['"])([\s\S]*)\1$/.exec(text);
  if (!match || match[2].startsWith(match[1].repeat(2)) || match[2].endsWith(match[1].repeat(2))) return null;
  return match[2].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
    .replace(/\\(['"\\])/g, "$1");
}

function notebookInputPlan(source){
  const text = String(source || "");
  const calls = [];
  for (let i = 0; i < text.length;){
    const ch = text[i];
    if (ch === "#"){
      const newline = text.indexOf("\n", i);
      i = newline < 0 ? text.length : newline + 1;
      continue;
    }
    if (ch === "'" || ch === '"'){ i = notebookSkipPythonString(text, i); continue; }
    if (!/[A-Za-z_]/.test(ch)){ i++; continue; }
    const start = i++;
    while (i < text.length && /\w/.test(text[i])) i++;
    if (text.slice(start, i) !== "input" || text[start - 1] === ".") continue;
    let open = i;
    while (open < text.length && /\s/.test(text[open])) open++;
    if (text[open] !== "(") continue;
    let depth = 1, end = open + 1;
    for (; end < text.length && depth > 0; end++){
      const current = text[end];
      if (current === "#"){
        const newline = text.indexOf("\n", end);
        end = newline < 0 ? text.length : newline;
      } else if (current === "'" || current === '"'){
        end = notebookSkipPythonString(text, end) - 1;
      } else if (current === "(") depth++;
      else if (current === ")") depth--;
    }
    if (depth !== 0) continue;
    const close = end - 1;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEndAt = text.indexOf("\n", close);
    const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
    const before = text.slice(lineStart, start);
    const after = text.slice(close + 1, lineEnd);
    const indented = /^[ \t]+/.test(text.slice(lineStart, lineEnd));
    const flow = /\b(?:for|while|if|elif|else|try|except|finally|with|match|case|lambda)\b/;
    calls.push({
      prompt:notebookInputPrompt(text.slice(open + 1, close)),
      predictable:!indented && !flow.test(before) && !flow.test(after)
    });
    i = end;
  }
  return {
    calls,
    predictable:!!calls.length && calls.every(call => call.predictable)
  };
}

function notebookCellUsesInput(source){
  return notebookInputPlan(source).calls.length > 0;
}

function notebookSearchRegex(query, options, global=true){
  options = options || {};
  const text = String(query || "");
  if (!text) return null;
  let pattern = options.regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.word) pattern = "\\b(?:" + pattern + ")\\b";
  return new RegExp(pattern, (global ? "g" : "") + (options.caseSensitive ? "" : "i"));
}

function notebookFindMatches(model, query, options){
  const regex = notebookSearchRegex(query, options, true);
  if (!regex) return [];
  const matches = [];
  ((model && model.cells) || []).forEach((cell, cellIndex) => {
    const source = String(cell && cell.source || "");
    regex.lastIndex = 0;
    let match, guard = 0;
    while ((match = regex.exec(source)) !== null){
      matches.push({
        cellIndex,
        start:match.index,
        end:match.index + match[0].length,
        text:match[0]
      });
      if (!match[0].length) regex.lastIndex++;
      if (++guard > 100000) break;
    }
  });
  return matches;
}

function notebookReplaceAll(model, query, replacement, options){
  const matches = notebookFindMatches(model, query, options);
  if (!matches.length) return 0;
  const regex = notebookSearchRegex(query, options, true);
  const value = options && options.regex
    ? String(replacement || "")
    : String(replacement || "").replace(/\$/g, "$$$$");
  for (const cell of ((model && model.cells) || [])){
    const source = String(cell && cell.source || "");
    regex.lastIndex = 0;
    cell.source = source.replace(regex, value);
  }
  return matches.length;
}

