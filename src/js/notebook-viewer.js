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

function notebookRunContext(ownerDoc){
  return {
    ownerDoc,
    archiveCtx:ownerDoc && ownerDoc.archiveCtx || null,
    relPath:normalizedRunPath(ownerDoc && (ownerDoc.relPath || ownerDoc.workspacePath || ownerDoc.name))
  };
}

async function buildNotebookWorkspaceBundle(ownerDoc){
  if (!ownerDoc || !ownerDoc.archiveCtx || typeof ownerDoc.archiveCtx.extract !== "function") return null;
  if (ownerDoc._nbWorkspacePromise) return ownerDoc._nbWorkspacePromise;
  ownerDoc._nbWorkspacePromise = (async () => {
    const runCtx = notebookRunContext(ownerDoc);
    const archive = runCtx.archiveCtx;
    const target = runCtx.relPath || normalizedRunPath(ownerDoc.name || "notebook.ipynb");
    const source = notebookCodeSource(ownerDoc.notebookModel);
    const projectScope = archive.paths
      ? buildArchiveScopeFilter(target, source, archive.paths, archive.directories || [])
      : null;
    let files;
    let scopeFilter = null;
    try {
      // 보통은 같은 폴더 묶음을 통째로 올려, 뒤 셀에서 새 경로를 사용해도 다시 마운트할 필요가 없게 한다.
      files = await archive.extract();
    } catch(error){
      if (String(error && error.message).indexOf("too-large") < 0) throw error;
      // 큰 프로젝트는 현재 노트북에서 참조한 데이터·모듈만 기존 .py 실행 규칙으로 좁힌다.
      scopeFilter = projectScope;
      files = await archive.extract(scopeFilter || undefined);
    }
    files = mergeRuntimeFiles(runCtx, files, scopeFilter || undefined);
    const total = files.reduce((sum, file) => sum + (file.bytes ? file.bytes.length : 0), 0);
    if (total > RUN_BUNDLE_CAP) throw new Error("노트북 작업폴더가 50MB를 넘어 함께 열 수 없어요.");
    // 일반 Python과 동일하게 노트북 파일이 있는 폴더를 자동 실행 기준으로 사용한다.
    // 상위·형제 파일은 ../dataIn/result01.csv처럼 실제 상대경로로 참조한다.
    const cwd = normalizedRunPath(projectScope && projectScope.cwd) || runPathDir(target);
    return {
      files,
      dirs:(scopeFilter && scopeFilter.directories || archive.directories || []).map(normalizedRunPath).filter(Boolean),
      cwd,
      target,
      logicalRoot:commonTopDir(files.map(file => file.path)) || ""
    };
  })().catch(error => {
    ownerDoc._nbWorkspacePromise = null;
    throw error;
  });
  return ownerDoc._nbWorkspacePromise;
}

function notebookWorkspaceImports(bundle){
  const names = new Set();
  if (!bundle || !Array.isArray(bundle.files)) return names;
  const cwd = normalizedRunPath(bundle.cwd);
  for (const file of bundle.files){
    let path = normalizedRunPath(file.path);
    if (cwd && path.indexOf(cwd + "/") === 0) path = path.slice(cwd.length + 1);
    if (!path || path.indexOf("../") === 0) continue;
    const parts = path.split("/");
    if (parts.length === 1 && /\.py$/i.test(parts[0])){
      const name = parts[0].replace(/\.py$/i, "");
      if (/^[A-Za-z_]\w*$/.test(name)) names.add(name);
    } else if (parts.length > 1 && /^[A-Za-z_]\w*$/.test(parts[0])){
      names.add(parts[0]);
    }
  }
  return names;
}

function notebookKernelModeLabel(mode){
  return mode === "local" ? "노트북 · 로컬 Python" : "노트북 · 브라우저";
}

function notebookRequiresLocalPython(source){
  const code = String(source || "");
  return /(^|\n)\s*(?:from\s+selenium(?:\.|\s+import\b)|import\s+selenium(?:\.|\s|,|$))/m.test(code) ||
    /(^|\n)\s*(?:from\s+playwright(?:\.|\s+import\b)|import\s+playwright(?:\.|\s|,|$))/m.test(code);
}

function nbShowLocalPythonInstallGuide(ownerDoc){
  const message = "이 크롤링은 로컬 Python이 필요합니다. Python을 설치할 때 'Add python.exe to PATH'를 선택한 뒤 만능파일교실을 다시 실행해 주세요.";
  if (typeof toast === "function") toast(message, 7000);
  nbSetStatus(ownerDoc, "로컬 Python 설치 필요 · 설치 후 앱 다시 실행");
}

function nbRefreshKernelModeUi(ownerDoc){
  if (!ownerDoc) return;
  const local = ownerDoc._nbKernelMode === "local";
  const missing = ownerDoc._nbLocalPythonAvailable === false;
  if (ownerDoc._nbKernelTag){
    ownerDoc._nbKernelTag.textContent = notebookKernelModeLabel(ownerDoc._nbKernelMode);
    ownerDoc._nbKernelTag.classList.toggle("is-local", local);
  }
  if (ownerDoc._nbLocalKernelBtn){
    ownerDoc._nbLocalKernelBtn.textContent = local
      ? "✓ 로컬 Python 셀 커널 사용 중"
      : (missing ? "로컬 Python 설치 필요" : "로컬 Python 셀 커널 사용");
    ownerDoc._nbLocalKernelBtn.title = missing
      ? "Selenium 크롤링을 사용하려면 PC에 Python을 설치하고 앱을 다시 실행해야 합니다."
      : local
      ? "현재 셀 실행은 PC의 로컬 Python을 사용합니다. 누르면 브라우저 커널로 돌아갑니다."
      : "셀마다 PC의 로컬 Python으로 실행하고 변수·Selenium 브라우저 상태를 다음 셀까지 유지합니다.";
    ownerDoc._nbLocalKernelBtn.classList.toggle("is-active", local);
    ownerDoc._nbLocalKernelBtn.classList.toggle("is-missing", missing);
  }
  if (ownerDoc._nbLocalRunBtn){
    ownerDoc._nbLocalRunBtn.textContent = missing ? "로컬 Python 전체 실행 · 설치 필요" : "로컬 Python 전체 1회 실행";
    ownerDoc._nbLocalRunBtn.classList.toggle("is-missing", missing);
  }
}

async function nbStopLocalNotebookKernel(ownerDoc, options={}){
  if (!ownerDoc) return;
  const id = ownerDoc._nbLocalKernelId;
  ownerDoc._nbLocalKernelId = null;
  ownerDoc._nbLocalKernelStart = null;
  if (!id) return;
  try {
    await fetch("/python-kernel-stop?id=" + encodeURIComponent(id), {
      method:"POST",
      keepalive:!!options.keepalive
    });
  } catch(_){}
}

async function nbToggleLocalKernelMode(ownerDoc){
  if (!ownerDoc || ownerDoc._nbBusy || ownerDoc._nbRunAllActive || ownerDoc._nbLocalRunActive) return;
  if (ownerDoc._nbKernelMode === "local"){
    await nbStopLocalNotebookKernel(ownerDoc);
    ownerDoc._nbKernelMode = "browser";
    ownerDoc._nbExec = 0;
    nbClearOutputs(ownerDoc);
    nbRefreshKernelModeUi(ownerDoc);
    nbSetStatus(ownerDoc, "브라우저 커널(Pyodide)로 전환했어요.");
    return;
  }
  let backend = false;
  try { backend = await pythonBackendAvailable(); } catch(_){ backend = false; }
  if (!backend){
    ownerDoc._nbLocalPythonAvailable = false;
    nbRefreshKernelModeUi(ownerDoc);
    nbShowLocalPythonInstallGuide(ownerDoc);
    return;
  }
  if (!ownerDoc._nbLocalKernelConfirmed && typeof confirmDialog === "function"){
    const ok = await confirmDialog(
      "이 노트북의 셀을 이 컴퓨터에 설치된 Python으로 실행합니다.\n변수와 Selenium 브라우저 상태가 다음 셀까지 유지됩니다.\n신뢰할 수 있는 코드만 실행하세요.",
      "로컬 커널 사용", "취소");
    if (!ok) return;
    ownerDoc._nbLocalKernelConfirmed = true;
  }
  ownerDoc._nbKernelMode = "local";
  try { await startPyodideKernelRun({ kernelId:nbKernelId(ownerDoc), reset:true }).promise; } catch(_){}
  ownerDoc._nbExec = 0;
  nbClearOutputs(ownerDoc);
  nbRefreshKernelModeUi(ownerDoc);
  nbSetStatus(ownerDoc, "로컬 Python 셀 커널 선택됨 · 셀을 실행하면 시작합니다.");
}

function nbLocalKernelBundle(workspaceBundle){
  const marker = "__manneung_notebook_kernel__.py";
  if (!workspaceBundle){
    return {
      files:[{ path:marker, bytes:new Uint8Array(0) }],
      target:marker,
      cwd:"",
      dirs:[],
      logicalRoot:""
    };
  }
  const cwd = normalizedRunPath(workspaceBundle.cwd);
  const target = (cwd ? cwd + "/" : "") + marker;
  const files = workspaceBundle.files
    .filter(file => normalizedRunPath(file.path) !== target)
    .map(file => ({ path:file.path, bytes:file.bytes }));
  files.push({ path:target, bytes:new Uint8Array(0) });
  return {
    files,
    target,
    cwd,
    dirs:workspaceBundle.dirs || [],
    logicalRoot:workspaceBundle.logicalRoot || ""
  };
}

async function nbEnsureLocalNotebookKernel(ownerDoc, workspaceBundle){
  if (ownerDoc._nbLocalKernelId) return ownerDoc._nbLocalKernelId;
  if (ownerDoc._nbLocalKernelStart) return ownerDoc._nbLocalKernelStart;
  ownerDoc._nbLocalKernelStart = (async () => {
    const bundle = nbLocalKernelBundle(workspaceBundle);
    const body = buildPyBundle(bundle.files, bundle.target, "", bundle.cwd, bundle.dirs);
    const response = await fetch("/python-kernel-start-bundle", {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream" },
      body
    });
    if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
    const data = await response.json();
    if (!data || !data.id) throw new Error("로컬 Python 커널 ID를 받지 못했습니다.");
    ownerDoc._nbLocalKernelId = data.id;
    ownerDoc._nbLocalKernelBundled = !!workspaceBundle;
    return data.id;
  })();
  try { return await ownerDoc._nbLocalKernelStart; }
  catch(error){
    ownerDoc._nbLocalKernelStart = null;
    throw error;
  }
}

function startLocalNotebookKernelRun(ownerDoc, source, stdin, workspaceBundle){
  const controller = new AbortController();
  let cancelled = false;
  const promise = (async () => {
    const id = await nbEnsureLocalNotebookKernel(ownerDoc, workspaceBundle);
    if (cancelled) throw nbCancellationError();
    const response = await fetch("/python-kernel-exec?id=" + encodeURIComponent(id), {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream" },
      body:buildRunPayload(source, stdin || ""),
      signal:controller.signal
    });
    if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
    const result = await response.json();
    for (const output of (result.outputs || [])){
      if (!output || !output.name || Number(output.size) > 20 * 1024 * 1024) continue;
      try {
        const file = await fetch("/python-kernel-file?id=" + encodeURIComponent(id) + "&name=" + encodeURIComponent(output.name));
        if (file.ok) output.bytes = new Uint8Array(await file.arrayBuffer());
      } catch(_){}
    }
    return result;
  })().catch(error => {
    if (cancelled || (error && error.name === "AbortError")) throw nbCancellationError();
    throw error;
  });
  return {
    promise,
    cancel(){
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      nbStopLocalNotebookKernel(ownerDoc, { keepalive:true });
    }
  };
}

// ── 로컬 파이썬 전체 실행(옵션 B) ─────────────────────────────────────────────
// 노트북 전체 코드를 이 PC에 설치된 '진짜' 파이썬으로 한 번에 실행한다. 브라우저 커널(Pyodide)에서
// 안 되는 코드(selenium 크롤링 등)를 위한 별도 경로로, 기존 셀별 실행은 전혀 건드리지 않는다.
// .py 뷰어의 로컬 세션 실행기(runPythonInteractive)를 그대로 재사용 → 입력(input)·생성 파일·이미지·변수까지 처리.
function nbEnsureLocalOutPanel(ownerDoc){
  let wrap = ownerDoc._nbLocalOutWrap;
  if (wrap && wrap.isConnected){ wrap.hidden = false; return ownerDoc._nbLocalOutPanel; }
  wrap = document.createElement("div");
  wrap.className = "nbv-local-out-wrap";
  const bar = document.createElement("div");
  bar.className = "nbv-local-out-bar";
  const title = document.createElement("span");
  title.className = "nbv-local-out-title";
  title.textContent = "로컬 파이썬 실행 결과";
  const close = document.createElement("button");
  close.type = "button"; close.className = "nbv-local-out-close"; close.textContent = "×";
  close.title = "결과 패널 닫기"; close.setAttribute("aria-label", "결과 패널 닫기");
  close.addEventListener("click", () => { wrap.hidden = true; });
  bar.append(title, close);
  const inner = document.createElement("div");
  inner.className = "code-output nbv-local-out";
  wrap.append(bar, inner);
  const root = ownerDoc._nbRoot;
  if (root) root.appendChild(wrap);
  ownerDoc._nbLocalOutWrap = wrap;
  ownerDoc._nbLocalOutPanel = inner;
  return inner;
}

async function nbRunNotebookLocalPython(ownerDoc){
  if (!ownerDoc) return;
  if (ownerDoc._nbLocalRunActive){ nbSetStatus(ownerDoc, "이미 로컬 파이썬으로 실행 중이에요."); return; }
  if (ownerDoc._nbBusy || ownerDoc._nbRunAllActive){ nbSetStatus(ownerDoc, "브라우저 커널 실행이 끝난 뒤 다시 눌러 주세요."); return; }
  ownerDoc._nbLocalRunActive = true;
  try { return await nbRunNotebookLocalPythonOnce(ownerDoc); }
  finally {
    ownerDoc._nbLocalRunActive = false;
    ownerDoc._nbLocalCancel = null;
  }
}

async function nbRunNotebookLocalPythonOnce(ownerDoc){
  let backend = false;
  try { backend = await pythonBackendAvailable(); } catch(_){ backend = false; }
  if (!backend){
    ownerDoc._nbLocalPythonAvailable = false;
    nbRefreshKernelModeUi(ownerDoc);
    nbShowLocalPythonInstallGuide(ownerDoc);
    return;
  }

  const script = notebookCodeSource(ownerDoc.notebookModel);
  if (!script.trim()){ nbSetStatus(ownerDoc, "실행할 코드 셀이 없어요."); return; }

  // 신뢰 확인(노트북별 1회). PC의 진짜 파이썬으로 임의 코드를 실행하므로 한 번 동의를 받는다.
  if (!ownerDoc._nbLocalPyConfirmed && typeof confirmDialog === "function"){
    const ok = await confirmDialog(
      "이 노트북의 모든 코드 셀을 이 컴퓨터에 설치된 파이썬으로 한 번에 실행합니다.\n신뢰할 수 있는 코드만 실행하세요.",
      "실행", "취소");
    if (!ok){ nbSetStatus(ownerDoc, "취소됨"); return; }
    ownerDoc._nbLocalPyConfirmed = true;
  }

  // 옆 파일(dataIn 등) 워크스페이스를 모아 번들로 만들고, 노트북 코드를 실행용 .py 로 끼워 넣는다.
  // 워크스페이스가 없거나(단독 노트북) 너무 크면 옆 파일 없이 코드만 실행한다.
  let bundle = null;
  try {
    const ws = await buildNotebookWorkspaceBundle(ownerDoc);
    if (ws && Array.isArray(ws.files)){
      const cwd = normalizedRunPath(ws.cwd);
      const scriptRel = (cwd ? cwd + "/" : "") + "__manneung_notebook_run__.py";
      const files = ws.files.filter(f => normalizedRunPath(f.path) !== scriptRel);
      files.push({ path: scriptRel, bytes: new TextEncoder().encode(script) });
      bundle = { files, target: scriptRel, cwd, dirs: ws.dirs || [], logicalRoot: ws.logicalRoot || "" };
    }
  } catch(error){
    if (String(error && error.message).indexOf("too-large") >= 0 && typeof toast === "function")
      toast("작업폴더가 커서(>50MB) 옆 파일 없이 코드만 실행해요.", 3500);
    bundle = null;
  }

  const outPanel = nbEnsureLocalOutPanel(ownerDoc);
  try { outPanel.parentNode.scrollIntoView({ block: "nearest" }); } catch(_){}
  const ui = { outPanel, running: true, keepEditorFocus: false, rerun: () => { nbRunNotebookLocalPython(ownerDoc); }, cancelRun: null };
  ui.cancelRun = () => { if (typeof ownerDoc._nbLocalCancel === "function") ownerDoc._nbLocalCancel(); };
  const hooks = { bindCancel: (fn) => { ownerDoc._nbLocalCancel = (typeof fn === "function") ? fn : null; } };

  nbSetStatus(ownerDoc, bundle ? "로컬 파이썬으로 실행 중… (옆 파일 포함)" : "로컬 파이썬으로 실행 중…");
  try {
    const result = await runPythonInteractive(script, bundle, ui, hooks);
    nbSetStatus(ownerDoc, (result && result.code) ? "로컬 실행이 오류로 끝났어요 (아래 결과 확인)." : "로컬 파이썬 실행 완료 ✓");
  } catch(error){
    nbSetStatus(ownerDoc, "로컬 실행 실패: " + ((error && error.message) || error));
  } finally {
    ui.running = false;
    ownerDoc._nbLocalCancel = null;
  }
}

function nbInkState(ownerDoc){
  if (!ownerDoc._nbInkState){
    ownerDoc._nbInkState = { tool:"pen", color:"#e11d48", width:3 };
  }
  return ownerDoc._nbInkState;
}

function nbInkTargetCtrl(ownerDoc){
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  if (ownerDoc && ownerDoc._nbInkTarget && ctrls.includes(ownerDoc._nbInkTarget)) return ownerDoc._nbInkTarget;
  const selected = ctrls[ownerDoc && ownerDoc._nbSelected];
  return selected || null;
}

function nbSyncInkSurfaces(ownerDoc){
  if (!ownerDoc) return;
  const state = nbInkState(ownerDoc);
  const drawing = !!ownerDoc._nbInkMode && state.tool !== "move";
  if (ownerDoc._nbRoot){
    ownerDoc._nbRoot.classList.toggle("nbv-ink-mode", !!ownerDoc._nbInkMode);
    ownerDoc._nbRoot.classList.toggle("nbv-ink-move", !!ownerDoc._nbInkMode && state.tool === "move");
  }
  for (const ctrl of (ownerDoc._nbCtrls || [])){
    if (ctrl.inkSurface) ctrl.inkSurface.setDrawing(drawing);
    if (ctrl.editor && ctrl.editor.ta) ctrl.editor.ta.readOnly = !!ownerDoc._nbInkMode;
  }
}

function nbSetInkMode(ownerDoc, on){
  if (!ownerDoc) return;
  ownerDoc._nbInkMode = !!on;
  if (ownerDoc._nbInkToolbar) ownerDoc._nbInkToolbar.hidden = !ownerDoc._nbInkMode;
  // 켜질 때(숨김→표시) 저장해 둔 위치·세로 상태를 복원. 숨김 중엔 크기가 0 이라 표시 뒤 다음 프레임에 적용.
  if (ownerDoc._nbInkMode && ownerDoc._nbInkToolbar && ownerDoc._nbInkToolbar.__applySavedPos){
    const bar = ownerDoc._nbInkToolbar;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => bar.__applySavedPos());
    else bar.__applySavedPos();
  }
  if (ownerDoc._nbInkButton){
    ownerDoc._nbInkButton.classList.toggle("active", ownerDoc._nbInkMode);
    ownerDoc._nbInkButton.setAttribute("aria-pressed", String(ownerDoc._nbInkMode));
  }
  nbSyncInkSurfaces(ownerDoc);
  if (ownerDoc._nbInkMode && ownerDoc._nbSelected < 0 && (ownerDoc._nbCtrls || []).length){
    nbSetSelected(ownerDoc, 0, {});
  }
}

function nbUndoInk(ownerDoc){
  const ctrl = nbInkTargetCtrl(ownerDoc);
  if (!ctrl || !ctrl.inkSurface || !ctrl.inkSurface.strokes.length){
    if (typeof toast === "function") toast("선택한 셀에 되돌릴 필기가 없어요.", 1600);
    return;
  }
  ctrl.inkSurface.strokes.pop();
  notebookDropEmptyInkMetadata(ctrl.cell);
  ctrl.inkSurface.redraw();
}

function nbClearInk(ownerDoc){
  const ctrl = nbInkTargetCtrl(ownerDoc);
  if (!ctrl || !ctrl.inkSurface || !ctrl.inkSurface.strokes.length){
    if (typeof toast === "function") toast("선택한 셀에 지울 필기가 없어요.", 1600);
    return;
  }
  ctrl.inkSurface.strokes.length = 0;
  notebookDropEmptyInkMetadata(ctrl.cell);
  ctrl.inkSurface.redraw();
  if (typeof toast === "function") toast("선택한 셀의 필기를 지웠어요.", 1400);
}

// 노트북 전체 셀의 필기를 한 번에 지운다(셀 지우기처럼 바로 지운다).
// opts.silent 이면 토스트를 띄우지 않는다(필기 끄면서 함께 지울 때 사용).
function nbClearAllInk(ownerDoc, opts){
  opts = opts || {};
  const ctrls = (ownerDoc && ownerDoc._nbCtrls) || [];
  const total = ctrls.reduce((sum, ctrl) =>
    sum + (ctrl.inkSurface && ctrl.inkSurface.strokes ? ctrl.inkSurface.strokes.length : 0), 0);
  if (!total){
    if (!opts.silent && typeof toast === "function") toast("지울 필기가 없어요.", 1600);
    return;
  }
  for (const ctrl of ctrls){
    if (!ctrl.inkSurface || !ctrl.inkSurface.strokes.length) continue;
    ctrl.inkSurface.strokes.length = 0;
    notebookDropEmptyInkMetadata(ctrl.cell);
    ctrl.inkSurface.redraw();
  }
  if (!opts.silent && typeof toast === "function") toast("모든 셀의 필기를 지웠어요.", 1600);
}

// 키보드 단축키 치트시트 — 학습자가 주피터식 단축키를 바로 찾아볼 수 있는 모달 패널.
const NB_SHORTCUT_GROUPS = [
  ["실행", [
    ["Ctrl+Enter", "현재 셀 실행"],
    ["Shift+Enter", "실행하고 다음 셀로"],
    ["Ctrl+S", ".ipynb 로 저장"]
  ]],
  ["셀 다루기 (셀 테두리 선택 = 명령 모드)", [
    ["Enter", "셀 편집 시작"],
    ["Esc", "편집 끝내고 명령 모드로"],
    ["A / B", "위 / 아래에 코드 셀 추가"],
    ["M / Y", "마크다운 셀 / 코드 셀로 바꾸기"],
    ["D, D", "셀 삭제 (D 를 연속 두 번)"],
    ["↑ / ↓  또는  K / J", "셀 이동 선택"],
    ["Shift+↑ / ↓", "여러 셀 선택"],
    ["Ctrl+C / X / V", "셀 복사 / 잘라내기 / 붙여넣기"],
    ["Ctrl+Z / Ctrl+Y", "셀 작업 되돌리기 / 다시 실행"]
  ]],
  ["편집기 안에서", [
    ["Tab / Shift+Tab", "들여쓰기 / 내어쓰기"],
    ["Shift+Tab · Alt+클릭", "함수 도움말(설명) 보기 — 이름 뒤에서"],
    ["Ctrl+클릭", "정의로 이동"],
    ["Ctrl+↑ / ↓", "위 / 아래 셀 편집으로 이동"]
  ]],
  ["찾기", [
    ["Ctrl+H", "노트북 전체 찾기·바꾸기"],
    ["Ctrl+Shift+H", "현재 셀 안에서 찾기·바꾸기"]
  ]]
];

function nbBuildShortcutSheet(ownerDoc){
  const overlay = document.createElement("div");
  overlay.className = "nbv-help-overlay"; overlay.hidden = true;
  overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "키보드 단축키");
  const panel = document.createElement("div"); panel.className = "nbv-help-panel";
  const head = document.createElement("div"); head.className = "nbv-help-head";
  const title = document.createElement("strong"); title.textContent = "키보드 단축키";
  const close = document.createElement("button"); close.type = "button"; close.className = "nbv-help-close"; close.textContent = "×"; close.title = "닫기 (Esc)";
  head.append(title, close);
  const body = document.createElement("div"); body.className = "nbv-help-body";
  for (const [groupName, rows] of NB_SHORTCUT_GROUPS){
    const section = document.createElement("div"); section.className = "nbv-help-group";
    const gh = document.createElement("div"); gh.className = "nbv-help-group-title"; gh.textContent = groupName;
    section.appendChild(gh);
    for (const [keys, desc] of rows){
      const row = document.createElement("div"); row.className = "nbv-help-row";
      const kbd = document.createElement("kbd"); kbd.className = "nbv-help-keys"; kbd.textContent = keys;
      const txt = document.createElement("span"); txt.className = "nbv-help-desc"; txt.textContent = desc;
      row.append(kbd, txt); section.appendChild(row);
    }
    body.appendChild(section);
  }
  const foot = document.createElement("div"); foot.className = "nbv-help-foot";
  foot.textContent = "명령 모드는 셀 테두리를 클릭해 파란 선택 상태일 때예요. Esc 로 언제든 닫을 수 있어요.";
  panel.append(head, body, foot);
  overlay.appendChild(panel);
  close.addEventListener("click", () => nbToggleShortcutSheet(ownerDoc, false));
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) nbToggleShortcutSheet(ownerDoc, false); });
  return overlay;
}

function nbToggleShortcutSheet(ownerDoc, force){
  if (!ownerDoc) return;
  const overlay = ownerDoc._nbHelpOverlay;
  if (!overlay) return;
  const open = typeof force === "boolean" ? force : overlay.hidden;
  overlay.hidden = !open;
  if (ownerDoc._nbHelpButton) ownerDoc._nbHelpButton.classList.toggle("active", open);
  if (open){
    // 문서 캡처 단계에서 Esc 를 먼저 받아 노트북 단축키보다 앞서 닫는다.
    const onKey = (e) => {
      if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); nbToggleShortcutSheet(ownerDoc, false); }
    };
    ownerDoc._nbHelpKeyHandler = onKey;
    document.addEventListener("keydown", onKey, true);
    const closeBtn = overlay.querySelector(".nbv-help-close");
    if (closeBtn) closeBtn.focus();
  } else if (ownerDoc._nbHelpKeyHandler){
    document.removeEventListener("keydown", ownerDoc._nbHelpKeyHandler, true);
    ownerDoc._nbHelpKeyHandler = null;
  }
}

function nbBuildInkToolbar(ownerDoc){
  const bar = document.createElement("div");
  bar.className = "nbv-ink-toolbar";
  bar.hidden = true;
  const state = nbInkState(ownerDoc);
  // 드래그 핸들 — py 필기 바처럼 바를 자유롭게(노트북 영역 밖까지) 옮긴다.
  const drag = document.createElement("span");
  drag.className = "nbv-ink-drag";
  drag.title = "끌어서 위치 옮기기";
  drag.textContent = "⋮⋮";
  bar.appendChild(drag);
  bar.appendChild(Object.assign(document.createElement("span"), { className:"nbv-ink-sep" }));
  const mk = (label, title, cls, fn) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = cls || "";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", fn);
    return button;
  };
  const tools = {};
  const syncTools = () => {
    for (const key in tools) tools[key].classList.toggle("active", key === state.tool);
    nbSyncInkSurfaces(ownerDoc);
  };
  [
    ["move","↕","이동·셀 선택"],
    ["pen","✏️","펜"],
    ["highlighter","🖍️","형광펜"],
    ["eraser","🧽","지우개"]
  ].forEach(([key, label, title]) => {
    tools[key] = mk(label, title, "nbv-ink-tool", () => { state.tool = key; syncTools(); });
    bar.appendChild(tools[key]);
  });
  const sep = () => Object.assign(document.createElement("span"), { className:"nbv-ink-sep" });
  bar.appendChild(sep());
  const swatches = {};
  const custom = document.createElement("input");
  const setColor = (color) => {
    state.color = color;
    for (const key in swatches) swatches[key].classList.toggle("active", key === color);
    custom.value = color;
  };
  ["#e11d48","#111111","#2563eb","#16a34a","#f59e0b"].forEach(color => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "nbv-ink-swatch";
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", () => setColor(color));
    swatches[color] = swatch;
    bar.appendChild(swatch);
  });
  custom.type = "color";
  custom.className = "nbv-ink-color";
  custom.title = "색 직접 고르기";
  custom.addEventListener("input", () => setColor(custom.value));
  bar.append(custom, sep());
  const widths = {};
  const setWidth = (width) => {
    state.width = width;
    for (const key in widths) widths[key].classList.toggle("active", Number(key) === width);
  };
  [[2,"S"],[3,"M"],[6,"L"]].forEach(([width, label]) => {
    widths[width] = mk(label, "굵기 " + label, "nbv-ink-width", () => setWidth(width));
    bar.appendChild(widths[width]);
  });
  bar.append(
    sep(),
    mk("↶", "선택한 셀의 마지막 필기 되돌리기", "nbv-ink-action", () => nbUndoInk(ownerDoc)),
    mk("셀 지우기", "선택한 셀의 필기 전체 지우기", "nbv-ink-action", () => nbClearInk(ownerDoc)),
    mk("전체 지우기", "모든 셀의 필기 지우기", "nbv-ink-action", () => nbClearAllInk(ownerDoc)),
    mk("✕", "필기 전체 지우고 끄기", "nbv-ink-action", () => { nbClearAllInk(ownerDoc, { silent:true }); nbSetInkMode(ownerDoc, false); })
  );
  setColor(state.color);
  setWidth(state.width);
  syncTools();

  // 자유 배치 드래그 — position:fixed 라 좌표는 뷰포트 기준. 화면 밖으로 못 나가게 여백 8px 로 가둔다.
  // 좌/우 끝(가장자리 근처)으로 끌면 세로 막대로 자동 전환한다(PDF 펜 바와 동일).
  const setAbs = (x, y) => {
    bar.style.left = x + "px";
    bar.style.top = y + "px";
    bar.style.right = "auto";
    bar.style.bottom = "auto";
    bar.style.transform = "none";
  };
  const setVertical = (v) => bar.classList.toggle("vertical", !!v);
  // 위치·세로 여부를 저장/복원(뷰포트 좌표). 모든 노트북이 같은 배치를 공유한다.
  const readPos = () => { try { const v = localStorage.getItem(NB_INK_BAR_POS_KEY); if (v && v.charAt(0) === "{") return JSON.parse(v); } catch(_){} return null; };
  const savePos = (p) => { try { localStorage.setItem(NB_INK_BAR_POS_KEY, JSON.stringify(p)); } catch(_){} };
  const applySaved = () => {
    const p = readPos(); if (!p) return;
    setVertical(!!p.vertical);
    const br = bar.getBoundingClientRect();
    if (!br.width && !br.height) return;                 // 아직 숨김 상태 → 표시 후 다시 호출됨
    const w = (typeof window !== "undefined" ? window.innerWidth : 0) || 0;
    const h = (typeof window !== "undefined" ? window.innerHeight : 0) || 0;
    const x = Math.max(8, Math.min(Number(p.x) || 0, Math.max(8, w - br.width - 8)));
    const y = Math.max(8, Math.min(Number(p.y) || 0, Math.max(8, h - br.height - 8)));
    setAbs(x, y);
  };
  bar.__applySavedPos = applySaved;
  let dragging = null;
  drag.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    drag.setPointerCapture(e.pointerId);
    const br = bar.getBoundingClientRect();
    dragging = { dx:e.clientX - br.left, dy:e.clientY - br.top, barW:br.width, barH:br.height };
  });
  drag.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const w = (typeof window !== "undefined" ? window.innerWidth : 0) || 0;
    const h = (typeof window !== "undefined" ? window.innerHeight : 0) || 0;
    // 포인터가 화면 좌/우 가장자리 근처면 세로, 그 외엔 가로. 이력 현상(60/110px)으로 임계선 깜빡임 방지.
    const isVertical = bar.classList.contains("vertical");
    let wantVertical = isVertical;
    if (!isVertical && (e.clientX < 60 || e.clientX > w - 60)) wantVertical = true;
    else if (isVertical && e.clientX > 110 && e.clientX < w - 110) wantVertical = false;
    if (wantVertical !== isVertical){
      setVertical(wantVertical);
      const br = bar.getBoundingClientRect();
      dragging.barW = br.width; dragging.barH = br.height;
      // 전환 후 포인터가 핸들 중앙을 잡도록 dx/dy 재설정 — 바가 자연스럽게 따라오게.
      const hr = drag.getBoundingClientRect();
      dragging.dx = (hr.left - br.left) + hr.width / 2;
      dragging.dy = (hr.top - br.top) + hr.height / 2;
    }
    const x = Math.max(8, Math.min(e.clientX - dragging.dx, w - dragging.barW - 8));
    const y = Math.max(8, Math.min(e.clientY - dragging.dy, h - dragging.barH - 8));
    setAbs(x, y);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    try { drag.releasePointerCapture(e.pointerId); } catch(_){}
    savePos({ x:parseFloat(bar.style.left) || 0, y:parseFloat(bar.style.top) || 0, vertical:bar.classList.contains("vertical") });
    dragging = null;
  };
  drag.addEventListener("pointerup", endDrag);
  drag.addEventListener("pointercancel", endDrag);

  return bar;
}

function nbCreateInkSurface(ownerDoc, ctrl){
  const overlay = document.createElement("div");
  overlay.className = "nbv-ink-layer";
  const canvas = document.createElement("canvas");
  canvas.className = "nbv-ink-canvas";
  canvas.setAttribute("aria-label", "이 셀에 필기");
  overlay.appendChild(canvas);
  ctrl.cellEl.appendChild(overlay);
  const ctx = canvas.getContext("2d");
  let strokes = notebookEnsureInkStrokes(ctrl.cell, false);
  let width = 1, height = 1, dpr = 1, current = null, last = null;

  const ensureBound = () => {
    const stored = ctrl.cell.metadata && ctrl.cell.metadata[NB_INK_META_KEY];
    if (!stored || stored.strokes !== strokes){
      if (!ctrl.cell.metadata || typeof ctrl.cell.metadata !== "object") ctrl.cell.metadata = {};
      ctrl.cell.metadata[NB_INK_META_KEY] = { version:1, strokes };
    }
  };
  const applyStyle = (stroke) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.width;
    if (stroke.tool === "eraser"){
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = stroke.tool === "highlighter" ? 0.30 : 1;
      ctx.strokeStyle = stroke.color;
    }
  };
  const drawPath = (stroke) => {
    if (!stroke.points.length) return;
    applyStyle(stroke);
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (let i = 1; i < stroke.points.length; i++){
      ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height);
    }
    if (stroke.points.length === 1){
      const point = stroke.points[0];
      ctx.lineTo(point.x * width + 0.01, point.y * height + 0.01);
    }
    ctx.stroke();
  };
  const redraw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of strokes) drawPath(stroke);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  };
  const resize = () => {
    const rect = ctrl.cellEl.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    redraw();
  };
  const pointAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x:Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y:Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    };
  };
  const drawSegment = (stroke, a, b) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyStyle(stroke);
    ctx.beginPath();
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
    if (a.x === b.x && a.y === b.y) ctx.lineTo(b.x * width + 0.01, b.y * height + 0.01);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  };
  const onPointerDown = (event) => {
    const ink = nbInkState(ownerDoc);
    if (!ownerDoc._nbInkMode || ink.tool === "move" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    ownerDoc._nbInkTarget = ctrl;
    nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {});
    canvas.setPointerCapture(event.pointerId);
    if (!ctrl.cell.metadata || !ctrl.cell.metadata[NB_INK_META_KEY]){
      strokes = notebookEnsureInkStrokes(ctrl.cell, true);
      api.strokes = strokes;
    }
    const point = pointAt(event);
    const strokeWidth = ink.tool === "eraser"
      ? Math.max(16, ink.width * 6)
      : (ink.tool === "highlighter" ? Math.max(10, ink.width * 4) : ink.width);
    current = { tool:ink.tool, color:ink.color, width:strokeWidth, points:[point] };
    strokes.push(current);
    ensureBound();
    last = point;
    drawSegment(current, point, point);
  };
  const onPointerMove = (event) => {
    if (!current) return;
    event.preventDefault();
    const point = pointAt(event);
    const dx = (point.x - last.x) * width, dy = (point.y - last.y) * height;
    if (dx * dx + dy * dy < 1.5) return;
    current.points.push(point);
    drawSegment(current, last, point);
    last = point;
  };
  const finishStroke = () => {
    if (!current) return;
    current = null;
    last = null;
    redraw();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);
  let observer = null;
  if (typeof ResizeObserver !== "undefined"){
    observer = new ResizeObserver(resize);
    observer.observe(ctrl.cellEl);
  }
  const api = {
    overlay,
    canvas,
    strokes,
    redraw,
    resize,
    setDrawing(active){
      overlay.classList.toggle("drawing", !!active);
      canvas.dataset.inkTool = nbInkState(ownerDoc).tool;
    },
    cleanup(){
      if (observer) observer.disconnect();
      overlay.remove();
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(resize);
  else resize();
  return api;
}

function nbSyncFindModel(ownerDoc){
  let changed = false;
  for (const ctrl of (ownerDoc && ownerDoc._nbCtrls || [])){
    let value = null;
    if (ctrl.editor) value = ctrl.editor.getValue();
    else {
      const textarea = ctrl.cellEl && ctrl.cellEl.querySelector(".nbv-md-edit");
      if (textarea) value = textarea.value;
    }
    if (value != null && value !== ctrl.cell.source){ ctrl.cell.source = value; changed = true; }
  }
  if (changed) markNbDirty(ownerDoc);
}

function nbFindOptions(state){
  return {
    caseSensitive:!!state.caseSensitive,
    word:!!state.word,
    regex:!!state.regex
  };
}

function nbFocusNotebookFindInput(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state || state.panel.hidden || !state.input) return;
  try { state.input.focus({ preventScroll:true }); }
  catch(_){ try { state.input.focus(); } catch(__){} }
}

// 모든 셀 편집기의 전체 찾기 강조(주황 박스)를 지운다.
function nbClearFindSpotlights(ownerDoc){
  for (const ctrl of (ownerDoc && ownerDoc._nbCtrls || [])){
    if (ctrl.editor && typeof ctrl.editor.clearSpotlight === "function") ctrl.editor.clearSpotlight();  // 코드 셀
    if (typeof ctrl.clearSpotlight === "function") ctrl.clearSpotlight();                                // 마크다운 셀
  }
}

function nbFocusNotebookMatch(ownerDoc, match, options){
  if (!match) return;
  const returnToFind = !!(options && options.returnToFind);
  const restoreFindFocus = () => {
    if (returnToFind) nbFocusNotebookFindInput(ownerDoc);
  };
  const ctrl = (ownerDoc._nbCtrls || [])[match.cellIndex];
  if (!ctrl) return;
  nbClearFindSpotlights(ownerDoc);                 // 이전 매치의 강조를 먼저 지운다(한 번에 하나만 보이게)
  nbSetSelected(ownerDoc, match.cellIndex, { scroll:true });
  ctrl.cellEl.scrollIntoView({ block:"center" });
  if (ctrl.type === "code"){
    ctrl.mount();
    if (ctrl.editor && typeof ctrl.editor.spotlightRange === "function"){
      ctrl.editor.spotlightRange(match.start, match.end);   // 셀 안 찾기와 같은 주황 박스로 또렷하게 강조
    } else if (ctrl.editor){
      ctrl.editor.ta.focus();
      ctrl.editor.ta.setSelectionRange(match.start, match.end);
    }
    restoreFindFocus();
  } else if (ctrl.type === "markdown"){
    if (typeof ctrl.spotlightRange === "function"){
      ctrl.spotlightRange(match.start, match.end);   // 코드 셀과 같은 주황 박스로 강조(편집 모드 진입 후 오버레이)
      restoreFindFocus();
    } else {
      ctrl.edit();
      requestAnimationFrame(() => {
        const textarea = ctrl.cellEl.querySelector(".nbv-md-edit");
        if (textarea){
          textarea.focus();
          textarea.setSelectionRange(match.start, match.end);
        }
        restoreFindFocus();
      });
    }
  } else {
    try { ctrl.cellEl.focus(); } catch(_){}
    restoreFindFocus();
  }
}

function nbRefreshNotebookFind(ownerDoc, preferredIndex){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  nbClearFindSpotlights(ownerDoc);   // 검색어가 바뀌면 이전 강조를 지운다(이동 시 nbFocusNotebookMatch 가 다시 그림)
  nbSyncFindModel(ownerDoc);
  state.input.classList.remove("find-bad");
  try {
    state.matches = notebookFindMatches(ownerDoc.notebookModel, state.input.value, nbFindOptions(state));
  } catch(_){
    state.matches = [];
    state.input.classList.add("find-bad");
    state.count.textContent = "정규식 오류";
    return;
  }
  if (!state.matches.length){
    state.index = -1;
    state.count.textContent = state.input.value ? "0/0" : "";
    return;
  }
  state.index = Math.max(0, Math.min(
    preferredIndex == null ? (state.index < 0 ? 0 : state.index) : preferredIndex,
    state.matches.length - 1
  ));
  const match = state.matches[state.index];
  state.count.textContent = (state.index + 1) + "/" + state.matches.length + " · 셀 " + (match.cellIndex + 1);
}

function notebookFindNextIndex(index, delta, length, navigated){
  const count = Math.max(0, Number(length) || 0);
  if (!count) return -1;
  if (!navigated) return delta < 0 ? count - 1 : 0;
  return ((Number(index) || 0) + (delta < 0 ? -1 : 1) + count) % count;
}

function nbMoveNotebookFind(ownerDoc, delta){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  nbRefreshNotebookFind(ownerDoc);
  if (!state.matches.length){
    nbFocusNotebookFindInput(ownerDoc);
    return;
  }
  state.index = notebookFindNextIndex(state.index, delta, state.matches.length, state.navigated);
  state.navigated = true;
  const match = state.matches[state.index];
  state.count.textContent = (state.index + 1) + "/" + state.matches.length + " · 셀 " + (match.cellIndex + 1);
  nbFocusNotebookMatch(ownerDoc, match, { returnToFind:true });
}

// 현재 포커스(셀 편집기 textarea·검색창 등) 또는 페이지에서 선택된 문자열을 한 줄짜리로 가져온다.
function nbCurrentSelectionText(){
  try {
    const el = (typeof document !== "undefined") && document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && typeof el.selectionStart === "number"){
      const sel = String(el.value || "").slice(el.selectionStart, el.selectionEnd);
      if (sel) return sel;
    }
    const win = (typeof window !== "undefined") && window.getSelection && window.getSelection();
    if (win) { const s = String(win); if (s) return s; }
  } catch(_){}
  return "";
}

function nbOpenNotebookFind(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  const sel = nbCurrentSelectionText();         // 선택한 문자열을 검색란에 따라오게 한다(한 줄·200자 이내)
  if (sel && !sel.includes("\n") && sel.length <= 200){
    state.input.value = sel;
    state.index = -1;
    state.navigated = false;
  }
  state.panel.hidden = false;
  nbRefreshNotebookFind(ownerDoc);
  state.input.focus();
  state.input.select();
}

// 현재 선택된 셀 안에서 찾기·바꾸기(Ctrl+Shift+H). 코드 셀에서만 동작.
function nbOpenCellFind(ownerDoc){
  const ctrl = (ownerDoc._nbCtrls || [])[ownerDoc._nbSelected];
  if (!ctrl) return;
  if (typeof ctrl.edit === "function") ctrl.edit();   // 정적 셀이면 편집기를 마운트하고 포커스
  if (ctrl.editor && typeof ctrl.editor.openFind === "function") ctrl.editor.openFind();
}

// 열려 있는 검색창이 하나라도 있는지(노트북 전체 패널 + 각 셀 편집기 find 바).
function nbAnyFindOpen(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (state && !state.panel.hidden) return true;
  for (const ctrl of (ownerDoc && ownerDoc._nbCtrls || [])){
    if (ctrl.editor && typeof ctrl.editor.isFindOpen === "function" && ctrl.editor.isFindOpen()) return true;
  }
  return false;
}

// Esc 한 번으로 노트북 전체 검색창과 모든 셀 검색창을 닫는다.
function nbCloseAllFinds(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (state && !state.panel.hidden) state.panel.hidden = true;
  nbClearFindSpotlights(ownerDoc);
  for (const ctrl of (ownerDoc && ownerDoc._nbCtrls || [])){
    if (ctrl.editor && typeof ctrl.editor.closeFind === "function" && ctrl.editor.isFindOpen && ctrl.editor.isFindOpen()){
      try { ctrl.editor.closeFind(); } catch(_){}
    }
  }
  const ctrl = (ownerDoc._nbCtrls || [])[ownerDoc._nbSelected];
  if (ctrl) try { ctrl.cellEl.focus(); } catch(_){}
}

function nbCloseNotebookFind(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  state.panel.hidden = true;
  nbClearFindSpotlights(ownerDoc);
  const ctrl = (ownerDoc._nbCtrls || [])[ownerDoc._nbSelected];
  if (ctrl) try { ctrl.cellEl.focus(); } catch(_){}
}

function nbReplaceNotebookCurrent(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  nbRefreshNotebookFind(ownerDoc);
  const match = state.matches[state.index];
  if (!match) return;
  const ctrl = (ownerDoc._nbCtrls || [])[match.cellIndex];
  if (!ctrl) return;
  const source = String(ctrl.cell.source || "");
  let replacement = state.replace.value;
  if (state.regex){
    try { replacement = match.text.replace(notebookSearchRegex(state.input.value, nbFindOptions(state), false), replacement); }
    catch(_){ state.input.classList.add("find-bad"); return; }
  }
  ctrl.setSource(source.slice(0, match.start) + replacement + source.slice(match.end));
  markNbDirty(ownerDoc);
  nbRefreshNotebookFind(ownerDoc, Math.min(state.index, Math.max(0, state.matches.length - 1)));
  if (state.matches.length) nbFocusNotebookMatch(ownerDoc, state.matches[state.index]);
}

function nbReplaceNotebookAll(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state || !state.input.value) return;
  nbSyncFindModel(ownerDoc);
  let count = 0;
  try { count = notebookReplaceAll(ownerDoc.notebookModel, state.input.value, state.replace.value, nbFindOptions(state)); }
  catch(_){ state.input.classList.add("find-bad"); state.count.textContent = "정규식 오류"; return; }
  if (!count){ toast("바꿀 내용이 없어요.", 1600); return; }
  nbInvalidateCompletionCache(ownerDoc);
  for (const ctrl of (ownerDoc._nbCtrls || [])) ctrl.setSource(ctrl.cell.source);
  markNbDirty(ownerDoc);
  nbRefreshNotebookFind(ownerDoc, 0);
  toast("노트북 전체에서 " + count + "개를 바꿨어요.", 2200);
}

function nbBuildFindPanel(ownerDoc){
  const panel = document.createElement("div");
  panel.className = "nbv-find";
  panel.hidden = true;
  panel.innerHTML =
    '<div class="nbv-find-row">' +
      '<input type="text" class="nbv-find-input" placeholder="노트북 전체에서 찾기" aria-label="노트북 전체에서 찾기">' +
      '<span class="nbv-find-count" aria-live="polite"></span>' +
      '<button type="button" data-opt="case" title="대소문자 구분">Aa</button>' +
      '<button type="button" data-opt="word" title="단어 단위">\\b</button>' +
      '<button type="button" data-opt="regex" title="정규식">.*</button>' +
      '<button type="button" data-nav="prev" title="이전">↑</button>' +
      '<button type="button" data-nav="next" title="다음">↓</button>' +
      '<button type="button" data-do="close" title="닫기">✕</button>' +
    '</div>' +
    '<div class="nbv-find-row">' +
      '<input type="text" class="nbv-find-replace" placeholder="바꿀 내용" aria-label="노트북 전체에서 바꿀 내용">' +
      '<button type="button" data-do="one">바꾸기</button>' +
      '<button type="button" data-do="all">모두 바꾸기</button>' +
    '</div>';
  const state = ownerDoc._nbFind = {
    panel,
    input:panel.querySelector(".nbv-find-input"),
    replace:panel.querySelector(".nbv-find-replace"),
    count:panel.querySelector(".nbv-find-count"),
    matches:[],
    index:-1,
    navigated:false,
    caseSensitive:false,
    word:false,
    regex:false
  };
  state.input.addEventListener("input", () => {
    state.index = -1;
    state.navigated = false;
    nbRefreshNotebookFind(ownerDoc, 0);
  });
  state.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter"){ event.preventDefault(); nbMoveNotebookFind(ownerDoc, event.shiftKey ? -1 : 1); }
    else if (event.key === "Escape"){ event.preventDefault(); nbCloseNotebookFind(ownerDoc); }
  });
  state.replace.addEventListener("keydown", (event) => {
    if (event.key === "Enter"){ event.preventDefault(); nbReplaceNotebookCurrent(ownerDoc); }
    else if (event.key === "Escape"){ event.preventDefault(); nbCloseNotebookFind(ownerDoc); }
  });
  panel.querySelectorAll("[data-opt]").forEach(button => button.addEventListener("click", () => {
    const name = button.dataset.opt;
    if (name === "case") state.caseSensitive = !state.caseSensitive;
    else if (name === "word") state.word = !state.word;
    else if (name === "regex") state.regex = !state.regex;
    button.classList.toggle("on", !!state[name === "case" ? "caseSensitive" : name]);
    state.index = -1;
    state.navigated = false;
    nbRefreshNotebookFind(ownerDoc, 0);
    state.input.focus();
  }));
  panel.querySelector('[data-nav="prev"]').addEventListener("click", () => nbMoveNotebookFind(ownerDoc, -1));
  panel.querySelector('[data-nav="next"]').addEventListener("click", () => nbMoveNotebookFind(ownerDoc, 1));
  panel.querySelector('[data-do="one"]').addEventListener("click", () => nbReplaceNotebookCurrent(ownerDoc));
  panel.querySelector('[data-do="all"]').addEventListener("click", () => nbReplaceNotebookAll(ownerDoc));
  panel.querySelector('[data-do="close"]').addEventListener("click", () => nbCloseNotebookFind(ownerDoc));
  return panel;
}

function notebookCellWorkspaceCwd(ownerDoc, cell, bundle){
  const archive = ownerDoc && ownerDoc.archiveCtx;
  const target = normalizedRunPath(ownerDoc && (ownerDoc.relPath || ownerDoc.workspacePath || ownerDoc.name));
  if (!archive || !archive.paths || !target) return normalizedRunPath(bundle && bundle.cwd);
  const context = inferPythonProjectRunContext(
    target,
    String(cell && cell.source || ""),
    archive.paths,
    { availableDirs:archive.directories || [] }
  );
  return (context.references && context.references.length) ||
    (context.outputDirectories && context.outputDirectories.length)
    ? normalizedRunPath(context.cwd)
    : normalizedRunPath(bundle && bundle.cwd);
}

async function buildNotebookCellWorkspaceSync(ownerDoc, cell){
  const archive = ownerDoc && ownerDoc.archiveCtx;
  const target = normalizedRunPath(ownerDoc && (ownerDoc.relPath || ownerDoc.workspacePath || ownerDoc.name));
  if (!archive || !archive.paths || typeof archive.extract !== "function" || !target) return null;
  const context = inferPythonProjectRunContext(
    target,
    String(cell && cell.source || ""),
    archive.paths,
    { availableDirs:archive.directories || [] }
  );
  const referenced = (context.references || []).map(item => normalizedRunPath(item.path)).filter(Boolean);
  if (!referenced.length) return null;
  const keep = (value) => {
    const path = normalizedRunPath(value);
    return referenced.some(ref => path === ref || path.indexOf(ref + "/") === 0);
  };
  let files = await archive.extract(keep);
  files = mergeRuntimeFiles(notebookRunContext(ownerDoc), files, keep);
  return {
    files,
    dirs:runDirectoryPaths(files.map(file => file.path)),
    cwd:normalizedRunPath(context.cwd)
  };
}

// ── 편집 가능 렌더(Phase 2) ──────────────────────────────────────────────────
function nbReplaceNotebookModel(ownerDoc, model, options={}){
  if (!ownerDoc || !model || !ownerDoc.el) return false;
  const host = ownerDoc.el;
  destroyNotebook(ownerDoc);
  host.innerHTML = "";
  ownerDoc.notebookModel = model;
  renderNotebookView(model, host, ownerDoc);
  ownerDoc.hasUnsavedEdits = options.dirty !== false;
  if (typeof updateDocumentStatus === "function") updateDocumentStatus(ownerDoc);
  updateNbSaveButton(ownerDoc, ownerDoc._nbSaveBtn);
  if (options.status) nbSetStatus(ownerDoc, options.status);
  return true;
}

function nbRestoreHistory(ownerDoc, direction){
  if (!ownerDoc || ownerDoc._nbHistoryRestoring) return false;
  const undo = ownerDoc._nbUndoStack || (ownerDoc._nbUndoStack = []);
  const redo = ownerDoc._nbRedoStack || (ownerDoc._nbRedoStack = []);
  const source = direction === "redo" ? redo : undo;
  const targetStack = direction === "redo" ? undo : redo;
  if (!source.length) return false;
  const current = notebookHistorySnapshot(ownerDoc);
  const entry = source.pop();
  let model;
  try { model = ipynbToModel(entry.text); }
  catch(error){ console.error(error); return false; }
  if (current) targetStack.push({ text:current, label:entry.label });
  notebookTrimHistory(targetStack);
  ownerDoc._nbHistoryRestoring = true;
  nbReplaceNotebookModel(ownerDoc, model, {
    dirty:true,
    status:(direction === "redo" ? "다시 실행: " : "되돌림: ") + entry.label
  });
  ownerDoc._nbHistoryRestoring = false;
  nbUpdateHistoryButtons(ownerDoc);
  notebookScheduleRecovery(ownerDoc);
  return true;
}

async function notebookOfferRecovery(ownerDoc){
  if (!ownerDoc || ownerDoc._nbRecoveryChecked) return;
  ownerDoc._nbRecoveryChecked = true;
  let record;
  try { record = await notebookRecoveryRequest("readonly", store => store.get(notebookRecoveryKey(ownerDoc))); }
  catch(_){ return; }
  if (!record || !record.text) return;
  const current = modelToIpynb(ownerDoc.notebookModel);
  if (record.text === current){ await notebookDeleteRecovery(ownerDoc); return; }
  const stamp = new Date(Number(record.updatedAt) || Date.now()).toLocaleString();
  const ok = typeof confirmDialog === "function"
    ? await confirmDialog("저장되지 않은 노트북 복구본이 있습니다.\n" + stamp + "\n\n복구할까요?", "복구", "무시")
    : false;
  if (!ok){ await notebookDeleteRecovery(ownerDoc); return; }
  try {
    const restored = ipynbToModel(record.text);
    nbReplaceNotebookModel(ownerDoc, restored, { dirty:true, status:"자동복구본을 복원했습니다." });
    notebookScheduleRecovery(ownerDoc);
  } catch(error){
    console.error(error);
    await notebookDeleteRecovery(ownerDoc);
  }
}

// 셀을 세로로 쌓아 그린다. 코드 셀은 buildCodeEditor 인스턴스(내용에 맞춰 높이 자동),
// 마크다운 셀은 렌더 ↔ 더블클릭 편집 토글. 편집은 즉시 model.cells[i].source 에 반영되고
// 저장(💾/Ctrl+S)은 modelToIpynb → saveTextDoc 로 .ipynb 에 기록한다.
function renderNotebookView(model, host, ownerDoc){
  if (typeof prewarmBrowserPython === "function") prewarmBrowserPython();   // 실행 전에 브라우저 파이썬 미리 준비
  // 같은 doc 을 다시 렌더하지 않도록(탭 전환 시 el 은 유지됨) 한 번만 빌드한다.
  if (ownerDoc){
    ownerDoc.notebookModel = model;
    if (ownerDoc._nbCtrls) destroyNotebook(ownerDoc);
    ownerDoc._nbCtrls = [];
    if (ownerDoc._nbKernelMode !== "local") ownerDoc._nbKernelMode = "browser";
  }
  const ctrls = ownerDoc ? ownerDoc._nbCtrls : [];

  const root = document.createElement("div");
  root.className = "nbv-doc";

  // ── 상단 툴바: 저장 + 변환(.py) 뷰 전환 ──
  const bar = document.createElement("div");
  bar.className = "nbv-bar";
  const tag = document.createElement("span");
  tag.className = "nbv-bar-tag";
  tag.textContent = "노트북";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button"; saveBtn.className = "nbv-save"; saveBtn.textContent = "저장";
  saveBtn.title = "이 노트북을 .ipynb 로 저장 (Ctrl+S)";
  saveBtn.addEventListener("click", () => saveNotebook(ownerDoc));
  const undoBtn = document.createElement("button");
  undoBtn.type = "button"; undoBtn.className = "nbv-history"; undoBtn.textContent = "↶";
  undoBtn.title = "마지막 셀 작업 되돌리기 (명령 모드 Ctrl+Z)";
  undoBtn.setAttribute("aria-label", undoBtn.title);
  undoBtn.addEventListener("click", () => nbRestoreHistory(ownerDoc, "undo"));
  const redoBtn = document.createElement("button");
  redoBtn.type = "button"; redoBtn.className = "nbv-history"; redoBtn.textContent = "↷";
  redoBtn.title = "셀 작업 다시 실행 (명령 모드 Ctrl+Y)";
  redoBtn.setAttribute("aria-label", redoBtn.title);
  redoBtn.addEventListener("click", () => nbRestoreHistory(ownerDoc, "redo"));
  // 실행/커널 버튼은 '전체 실행' 하나만 툴바에 두고, 재시작 계열은 옆 ▾ 드롭다운으로 묶는다.
  const runAllBtn = document.createElement("button");
  runAllBtn.type = "button"; runAllBtn.className = "nbv-runall"; runAllBtn.textContent = "전체 실행";
  runAllBtn.title = "모든 코드 셀을 위에서부터 차례로 실행";
  runAllBtn.dataset.shortcutAction = "runNotebook";
  runAllBtn.dataset.shortcutTitle = "모든 코드 셀을 위에서부터 차례로 실행";
  runAllBtn.dataset.shortcutAria = "true";
  runAllBtn.addEventListener("click", () => {
    if (ownerDoc && (ownerDoc._nbBusy || ownerDoc._nbRunAllActive)) nbStopExecution(ownerDoc);
    else nbRunAll(ownerDoc);
  });
  const restartRunBtn = document.createElement("button");   // stale 셀이 있으면 '최신 상태로 실행 (N)'으로 라벨이 바뀜(_nbFreshRunBtn)
  restartRunBtn.type = "button"; restartRunBtn.className = "nbv-restartrun nbv-run-menu-item"; restartRunBtn.textContent = "재시작 후 실행";
  restartRunBtn.title = "커널을 재시작한 뒤 모든 셀을 처음부터 실행";
  const restartBtn = document.createElement("button");
  restartBtn.type = "button"; restartBtn.className = "nbv-restart nbv-run-menu-item"; restartBtn.textContent = "커널 재시작";
  restartBtn.title = "누적된 변수·상태를 모두 비우고 실행 결과를 지웁니다";
  // 로컬 셀 커널은 Selenium 객체와 변수를 셀 사이에 유지한다. 기존 전체 1회 실행도 별도 도구로 남긴다.
  const localKernelBtn = document.createElement("button");
  localKernelBtn.type = "button"; localKernelBtn.className = "nbv-local-kernel nbv-run-menu-item";
  localKernelBtn.textContent = "로컬 Python 확인 중…";
  const localRunBtn = document.createElement("button");
  localRunBtn.type = "button"; localRunBtn.className = "nbv-localrun nbv-run-menu-item"; localRunBtn.textContent = "로컬 Python 확인 중…";
  localRunBtn.title = "모든 코드 셀을 하나의 .py처럼 합쳐 PC의 로컬 Python으로 한 번 실행";
  if (typeof pythonBackendAvailable === "function"){
    Promise.resolve(pythonBackendAvailable()).then(ok => {
      if (ownerDoc) ownerDoc._nbLocalPythonAvailable = !!ok;
      nbRefreshKernelModeUi(ownerDoc);
    }).catch(() => {
      if (ownerDoc) ownerDoc._nbLocalPythonAvailable = false;
      nbRefreshKernelModeUi(ownerDoc);
    });
  }
  const runMore = document.createElement("button");
  runMore.type = "button"; runMore.className = "nbv-run-more"; runMore.textContent = "▾";
  runMore.title = "실행 커널 선택 · 재시작";
  runMore.setAttribute("aria-haspopup", "menu"); runMore.setAttribute("aria-expanded", "false");
  const runMenu = document.createElement("div");
  runMenu.className = "nbv-run-menu"; runMenu.hidden = true; runMenu.setAttribute("role", "menu");
  runMenu.append(restartRunBtn, restartBtn, localKernelBtn, localRunBtn);
  const runGroup = document.createElement("span");
  runGroup.className = "nbv-run-group";
  runGroup.append(runAllBtn, runMore, runMenu);
  const closeRunMenu = () => { if (!runMenu.hidden){ runMenu.hidden = true; runMore.setAttribute("aria-expanded", "false"); } };
  runMore.addEventListener("click", () => {
    const open = runMenu.hidden;
    runMenu.hidden = !open; runMore.setAttribute("aria-expanded", String(open));
  });
  restartRunBtn.addEventListener("click", () => { closeRunMenu(); nbRestartRunAll(ownerDoc); });
  restartBtn.addEventListener("click", () => { closeRunMenu(); nbRestartKernel(ownerDoc); });
  localKernelBtn.addEventListener("click", () => { closeRunMenu(); nbToggleLocalKernelMode(ownerDoc); });
  localRunBtn.addEventListener("click", () => { closeRunMenu(); nbRunNotebookLocalPython(ownerDoc); });
  const onDocClickRunMenu = (e) => { if (!runGroup.contains(e.target)) closeRunMenu(); };
  document.addEventListener("click", onDocClickRunMenu);
  if (ownerDoc){
    ownerDoc._nbRunMoreBtn = runMore;
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => document.removeEventListener("click", onDocClickRunMenu));
  }
  const clearBtn = document.createElement("button");
  clearBtn.type = "button"; clearBtn.className = "nbv-clear nbv-output-clear"; clearBtn.textContent = "출력 지우기";
  clearBtn.title = "노트북 실행 결과를 지웁니다(변수·상태는 유지)";
  clearBtn.addEventListener("click", () => nbClearOutputs(ownerDoc));
  const collapseOutputsBtn = document.createElement("button");
  collapseOutputsBtn.type = "button"; collapseOutputsBtn.className = "nbv-run-menu-item";
  collapseOutputsBtn.textContent = "출력 접기"; collapseOutputsBtn.setAttribute("role", "menuitem");
  const expandOutputsBtn = document.createElement("button");
  expandOutputsBtn.type = "button"; expandOutputsBtn.className = "nbv-run-menu-item";
  expandOutputsBtn.textContent = "출력 펼치기"; expandOutputsBtn.setAttribute("role", "menuitem");
  const outputMore = document.createElement("button");
  outputMore.type = "button"; outputMore.className = "nbv-output-more"; outputMore.textContent = "▾";
  outputMore.title = "출력 접기 · 출력 펼치기";
  outputMore.setAttribute("aria-haspopup", "menu"); outputMore.setAttribute("aria-expanded", "false");
  const outputMenu = document.createElement("div");
  outputMenu.className = "nbv-run-menu nbv-output-menu"; outputMenu.hidden = true; outputMenu.setAttribute("role", "menu");
  outputMenu.append(collapseOutputsBtn, expandOutputsBtn);
  const outputGroup = document.createElement("span");
  outputGroup.className = "nbv-run-group nbv-output-group";
  outputGroup.append(clearBtn, outputMore, outputMenu);
  const closeOutputMenu = () => {
    if (!outputMenu.hidden){
      outputMenu.hidden = true;
      outputMore.setAttribute("aria-expanded", "false");
    }
  };
  outputMore.addEventListener("click", () => {
    const open = outputMenu.hidden;
    outputMenu.hidden = !open;
    outputMore.setAttribute("aria-expanded", String(open));
  });
  collapseOutputsBtn.addEventListener("click", () => {
    closeOutputMenu();
    const count = notebookSetOutputsCollapsed(ownerDoc, true);
    nbSetStatus(ownerDoc, count ? "출력 " + count + "개 접음" : "접을 출력이 없어요.");
  });
  expandOutputsBtn.addEventListener("click", () => {
    closeOutputMenu();
    const count = notebookSetOutputsCollapsed(ownerDoc, false);
    nbSetStatus(ownerDoc, count ? "출력 " + count + "개 펼침" : "펼칠 출력이 없어요.");
  });
  const onDocClickOutputMenu = event => {
    if (!outputGroup.contains(event.target)) closeOutputMenu();
  };
  const onDocKeydownOutputMenu = event => {
    if (event.key === "Escape") closeOutputMenu();
  };
  document.addEventListener("click", onDocClickOutputMenu);
  document.addEventListener("keydown", onDocKeydownOutputMenu, true);
  if (ownerDoc){
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      document.removeEventListener("click", onDocClickOutputMenu);
      document.removeEventListener("keydown", onDocKeydownOutputMenu, true);
    });
  }
  const inkBtn = document.createElement("button");
  inkBtn.type = "button"; inkBtn.className = "nbv-ink-toggle"; inkBtn.textContent = "필기";
  inkBtn.title = "코드·마크다운·실행 결과 위에 셀별로 필기";
  inkBtn.setAttribute("aria-pressed", "false");
  inkBtn.addEventListener("click", () => nbSetInkMode(ownerDoc, !ownerDoc._nbInkMode));
  const tocBtn = document.createElement("button");
  tocBtn.type = "button"; tocBtn.className = "nbv-toc-open"; tocBtn.textContent = "목차";
  tocBtn.title = "마크다운 제목에서 만든 노트북 목차";
  tocBtn.setAttribute("aria-expanded", "false");
  const findBtn = document.createElement("button");
  findBtn.type = "button"; findBtn.className = "nbv-find-open"; findBtn.textContent = "전체 찾기";
  findBtn.title = "노트북 전체 셀에서 찾기·바꾸기 (Ctrl+H · 현재 셀만은 Ctrl+Shift+H)";
  findBtn.addEventListener("click", () => nbOpenNotebookFind(ownerDoc));
  const fontGroup = document.createElement("span");
  fontGroup.className = "nbv-font-group";
  const fontDown = document.createElement("button");
  fontDown.type = "button"; fontDown.className = "nbv-font"; fontDown.textContent = "A−";
  fontDown.title = "코드 셀·결과 글자 작게 (Ctrl+−)";
  fontDown.setAttribute("aria-label", fontDown.title);
  const fontUp = document.createElement("button");
  fontUp.type = "button"; fontUp.className = "nbv-font"; fontUp.textContent = "A+";
  fontUp.title = "코드 셀·결과 글자 크게 (Ctrl++)";
  fontUp.setAttribute("aria-label", fontUp.title);
  fontDown.addEventListener("click", () => bumpCodeFont(-1));
  fontUp.addEventListener("click", () => bumpCodeFont(1));
  fontGroup.append(fontDown, fontUp);
  const exportBtn = document.createElement("button");
  exportBtn.type = "button"; exportBtn.className = "nbv-export"; exportBtn.textContent = ".py 내보내기";
  exportBtn.title = "현재 노트북을 파이썬(.py) 코드로 새 탭에 내보내기";
  exportBtn.addEventListener("click", () => nbExportPy(ownerDoc));
  const pdfBtn = document.createElement("button");
  pdfBtn.type = "button"; pdfBtn.className = "nbv-export-pdf nbv-run-menu-item"; pdfBtn.textContent = "PDF로 저장";
  pdfBtn.setAttribute("role", "menuitem");
  pdfBtn.title = "실행 결과까지 노트북 전체를 고화질 PDF로 저장 (태블릿 학습용 · 필기 제외)";
  pdfBtn.addEventListener("click", () => nbExportImagePdf(ownerDoc));
  const helpBtn = document.createElement("button");
  helpBtn.type = "button"; helpBtn.className = "nbv-help-open"; helpBtn.textContent = "단축키";
  helpBtn.title = "키보드 단축키 모아 보기";
  helpBtn.addEventListener("click", () => nbToggleShortcutSheet(ownerDoc));
  const status = document.createElement("span");
  status.className = "nbv-status";
  const toPyBtn = document.createElement("button");
  toPyBtn.type = "button"; toPyBtn.className = "nbv-toggle nbv-run-menu-item"; toPyBtn.textContent = "변환(.py) 뷰";
  toPyBtn.setAttribute("role", "menuitem");
  toPyBtn.title = "기존 파이썬 변환 뷰로 전환(앱 새로고침)";
  toPyBtn.addEventListener("click", async () => {
    if (ownerDoc && ownerDoc.hasUnsavedEdits){
      const ok = (typeof confirmDialog === "function")
        ? await confirmDialog("저장하지 않은 편집이 있습니다. 그래도 전환할까요?", "전환", "취소") : true;
      if (!ok) return;
    }
    if (typeof window !== "undefined" && window.mnNotebookMode) window.mnNotebookMode(false);
  });
  // 저장·내보내기 계열을 각각 한 덩어리(주 버튼 + ▾ 드롭다운)로 묶는다. 실행/출력 그룹과 같은 스타일·동작.
  const buildToolMenuGroup = (primaryBtn, moreTitle, menuItems, extraClass) => {
    const more = document.createElement("button");
    more.type = "button"; more.className = "nbv-run-more"; more.textContent = "▾";
    more.title = moreTitle;
    more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "nbv-run-menu"; menu.hidden = true; menu.setAttribute("role", "menu");
    menu.append(...menuItems);
    const group = document.createElement("span");
    group.className = "nbv-run-group" + (extraClass ? " " + extraClass : "");
    group.append(primaryBtn, more, menu);
    const close = () => { if (!menu.hidden){ menu.hidden = true; more.setAttribute("aria-expanded", "false"); } };
    more.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open; more.setAttribute("aria-expanded", String(open));
    });
    menu.addEventListener("click", (e) => { if (e.target.closest("button")) close(); });   // 항목 고르면 닫기
    const onDocClick = (e) => { if (!group.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey, true);
    if (ownerDoc){
      if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
      ownerDoc.cleanupFns.push(() => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey, true);
      });
    }
    return group;
  };
  const saveGroup = buildToolMenuGroup(saveBtn, "PDF로 저장", [pdfBtn], "nbv-save-group");
  const exportGroup = buildToolMenuGroup(exportBtn, "변환(.py) 뷰", [toPyBtn], "nbv-export-group");
  bar.append(tag, saveGroup, undoBtn, redoBtn, runGroup, outputGroup, inkBtn, tocBtn, findBtn, fontGroup, exportGroup, helpBtn, status);
  root.appendChild(bar);
  const tocPanel = document.createElement("div");
  tocPanel.className = "nbv-toc";
  tocPanel.hidden = true;
  const tocHead = document.createElement("div"); tocHead.className = "nbv-toc-head";
  const tocTitle = document.createElement("strong"); tocTitle.textContent = "목차";
  const tocClose = document.createElement("button"); tocClose.type = "button"; tocClose.textContent = "×"; tocClose.title = "목차 닫기";
  tocHead.append(tocTitle, tocClose);
  const tocList = document.createElement("div"); tocList.className = "nbv-toc-list";
  tocPanel.append(tocHead, tocList);
  root.appendChild(tocPanel);
  const positionTocBelowBar = () => {
    const height = Math.ceil(bar.getBoundingClientRect().height || bar.offsetHeight || 50);
    tocPanel.style.top = (height + 4) + "px";
  };
  const setTocOpen = open => {
    tocPanel.hidden = !open;
    tocBtn.setAttribute("aria-expanded", String(open));
    if (open){
      positionTocBelowBar();
      nbRefreshToc(ownerDoc);
    }
  };
  tocBtn.addEventListener("click", () => setTocOpen(tocPanel.hidden));
  tocClose.addEventListener("click", () => setTocOpen(false));
  const onDocClickToc = event => {
    if (tocPanel.hidden || tocPanel.contains(event.target) || tocBtn.contains(event.target)) return;
    setTocOpen(false);
  };
  const onDocKeydownToc = event => {
    if (event.key === "Escape" && !tocPanel.hidden) setTocOpen(false);
  };
  document.addEventListener("click", onDocClickToc);
  document.addEventListener("keydown", onDocKeydownToc, true);
  let tocResizeObserver = null;
  const onWindowResizeToc = () => { if (!tocPanel.hidden) positionTocBelowBar(); };
  if (typeof ResizeObserver === "function"){
    tocResizeObserver = new ResizeObserver(onWindowResizeToc);
    tocResizeObserver.observe(bar);
  } else if (typeof window !== "undefined"){
    window.addEventListener("resize", onWindowResizeToc);
  }
  if (ownerDoc){
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      document.removeEventListener("click", onDocClickToc);
      document.removeEventListener("keydown", onDocKeydownToc, true);
      if (tocResizeObserver) tocResizeObserver.disconnect();
      else if (typeof window !== "undefined") window.removeEventListener("resize", onWindowResizeToc);
    });
  }
  const inkToolbar = nbBuildInkToolbar(ownerDoc);
  root.appendChild(inkToolbar);
  const helpOverlay = nbBuildShortcutSheet(ownerDoc);
  root.appendChild(helpOverlay);
  if (ownerDoc){ ownerDoc._nbHelpOverlay = helpOverlay; ownerDoc._nbHelpButton = helpBtn; }
  if (ownerDoc) root.appendChild(nbBuildFindPanel(ownerDoc));
  if (ownerDoc){
    ownerDoc._nbRoot = root;
    ownerDoc._nbFontHost = root;
    root.__refreshFontMetrics = () => {
      requestAnimationFrame(() => {
        for (const ctrl of (ownerDoc._nbCtrls || [])){
          if (ctrl.editor) fitEditorHeight(ctrl.editor);
        }
      });
    };
    registerEditorFont(root);
    ownerDoc._nbStatusEl = status;
    ownerDoc._nbBusy = false;
    ownerDoc._nbCancelRequested = false;
    ownerDoc._nbActiveTask = null;
    ownerDoc._nbRunAllActive = false;
    ownerDoc._nbRunAllBtn = runAllBtn;
    ownerDoc._nbRunGroup = runGroup;
    ownerDoc._nbKernelTag = tag;
    ownerDoc._nbLocalKernelBtn = localKernelBtn;
    ownerDoc._nbLocalRunBtn = localRunBtn;
    ownerDoc._nbUndoBtn = undoBtn;
    ownerDoc._nbRedoBtn = redoBtn;
    ownerDoc._nbTocButton = tocBtn;
    ownerDoc._nbTocList = tocList;
    ownerDoc._nbInkButton = inkBtn;
    ownerDoc._nbInkToolbar = inkToolbar;
    nbRefreshKernelModeUi(ownerDoc);
  }

  // ── 셀 목록 ──
  const cellsWrap = document.createElement("div");
  cellsWrap.className = "nbv-cells";
  if (ownerDoc) ownerDoc._nbCellsWrap = cellsWrap;
  (model.cells || []).forEach((cell) => {
    const ctrl = nbBuildCell(ownerDoc, cell);
    cellsWrap.appendChild(ctrl.cellEl);
    ctrls.push(ctrl);
  });
  root.appendChild(cellsWrap);

  // 맨 아래 셀 추가 버튼(빈 노트북에서도 시작 가능)
  const footer = document.createElement("div");
  footer.className = "nbv-footer";
  const addBtn = (label, type) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    b.addEventListener("click", () => nbInsertCell(ownerDoc, (ownerDoc._nbCtrls || []).length - 1, type, { where: "below", edit: true }));
    return b;
  };
  footer.append(addBtn("＋ 코드 셀", "code"), addBtn("＋ 마크다운", "markdown"));
  root.appendChild(footer);

  // 키보드: 명령/편집 모드 (저장·실행·셀 조작) — 캡처 단계에서 에디터보다 먼저 처리
  root.addEventListener("keydown", (e) => nbOnKeydown(ownerDoc, e), true);
  if (typeof syncShortcutHints === "function") syncShortcutHints(root);

  host.appendChild(root);
  if (ownerDoc){
    ownerDoc._nbSelected = -1;
    ownerDoc._nbCellSelection = new Set();
    ownerDoc._nbSelectionAnchor = null;
  }

  // 닫을 때 모든 셀 에디터 정리(메모리 회수) + 커널 네임스페이스 비우기
  if (ownerDoc && !ownerDoc._nbCleanupRegistered){
    ownerDoc._nbCleanupRegistered = true;
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      clearTimeout(ownerDoc._nbRecoveryTimer);
      if (ownerDoc.hasUnsavedEdits) notebookSaveRecovery(ownerDoc);
      nbToggleShortcutSheet(ownerDoc, false);
      destroyNotebook(ownerDoc);
    });
    ownerDoc.cleanupFns.push(() => {
      try { startPyodideKernelRun({ kernelId: nbKernelId(ownerDoc), reset: true }).promise.catch(() => {}); } catch(e){}
    });
  }
  if (ownerDoc){
    updateNbSaveButton(ownerDoc, saveBtn);
    ownerDoc._nbSaveBtn = saveBtn;
    ownerDoc._nbFreshRunBtn = restartRunBtn;
    nbRefreshExecutionStates(ownerDoc);
    nbUpdateHistoryButtons(ownerDoc);
    nbRefreshToc(ownerDoc);
    setTimeout(() => notebookOfferRecovery(ownerDoc), 0);
  }
}

// ── 셀 실행(Phase 3): 기존 Pyodide 커널을 셀에 연결. 같은 kernelId 로 변수·상태가 셀 간 누적된다. ──
function nbKernelId(ownerDoc){ return "nbv:" + (ownerDoc && ownerDoc.id != null ? ownerDoc.id : "default"); }

function nbSetStatus(ownerDoc, msg){
  if (ownerDoc && ownerDoc._nbStatusEl) ownerDoc._nbStatusEl.textContent = msg || "";
}

function notebookExecutionControlState(running, cancelRequested){
  return running
    ? {
        label:"■",
        title:"현재 셀 실행과 남은 전체 실행을 중지",
        disabled:!!cancelRequested
      }
    : {
        label:"전체 실행",
        title:"모든 코드 셀을 위에서부터 차례로 실행",
        disabled:false
      };
}

function nbSetRunningUi(ownerDoc, running){
  if (!ownerDoc) return;
  const btn = ownerDoc._nbRunAllBtn;
  if (btn){
    const state = notebookExecutionControlState(running, ownerDoc._nbCancelRequested);
    btn.textContent = state.label;
    btn.title = state.title;
    btn.disabled = state.disabled;
    btn.setAttribute("aria-label", btn.title);
  }
  if (ownerDoc._nbRunGroup) ownerDoc._nbRunGroup.classList.toggle("is-running", !!running);
  if (ownerDoc._nbRunMoreBtn) ownerDoc._nbRunMoreBtn.disabled = !!running;
}

function nbCancellationError(){
  const error = new Error("노트북 실행을 중지했습니다.");
  error.code = "worker-cancel";
  return error;
}

function nbThrowIfCancelled(ownerDoc){
  if (ownerDoc && ownerDoc._nbCancelRequested) throw nbCancellationError();
}

function nbStopExecution(ownerDoc){
  if (!ownerDoc || (!ownerDoc._nbBusy && !ownerDoc._nbRunAllActive) || ownerDoc._nbCancelRequested) return;
  ownerDoc._nbCancelRequested = true;
  nbSetStatus(ownerDoc, "중지 요청 중…");
  nbSetRunningUi(ownerDoc, true);
  const task = ownerDoc._nbActiveTask;
  if (task && typeof task.cancel === "function"){
    try { task.cancel(); } catch(_){}
  }
}

const NB_EXEC_STATE_LABELS = {
  fresh:"최신",
  stale:"재실행",
  error:"오류",
  never:"미실행",
  unknown:"확인",
  blank:""
};

function nbUpdateOutputFreshness(ctrl, state){
  if (!ctrl || !ctrl.outWrap) return;
  const old = ctrl.outWrap.querySelector(".nbv-out-freshness");
  if (state.status !== "stale"){
    if (old) old.remove();
    return;
  }
  const note = old || document.createElement("div");
  note.className = "nbv-out-freshness";
  note.textContent = "⚠ 수정 전 상태의 실행 결과입니다. " + state.reason;
  if (!old) ctrl.outWrap.insertBefore(note, ctrl.outWrap.firstChild);
}

function nbApplyExecutionState(ctrl, state){
  if (!ctrl || ctrl.type !== "code") return;
  ctrl.execState = state;
  if (ctrl.runBtn && ctrl.runBtn.classList.contains("is-running")) return;   // 실행 중엔 정지(■) 표시를 유지
  ctrl.cellEl.dataset.execState = state.status;
  if (ctrl.stateLabel){
    ctrl.stateLabel.textContent = NB_EXEC_STATE_LABELS[state.status] || "";
    ctrl.stateLabel.title = state.reason || "";
  }
  if (ctrl.runBtn){
    ctrl.runBtn.title = state.reason + "\n이 셀 실행 (Ctrl+Enter · Shift+Enter=실행 후 다음)";
  }
  nbUpdateOutputFreshness(ctrl, state);
}

function nbRefreshExecutionStates(ownerDoc){
  if (!ownerDoc || !ownerDoc.notebookModel) return [];
  const states = [];
  let staleCount = 0;
  for (const ctrl of (ownerDoc._nbCtrls || [])){
    if (ctrl.type !== "code") continue;
    const state = notebookCellExecutionState(ownerDoc.notebookModel, ctrl.cell);
    states.push(state);
    if (state.status === "stale") staleCount++;
    nbApplyExecutionState(ctrl, state);
  }
  const btn = ownerDoc._nbFreshRunBtn;
  if (btn){
    btn.classList.toggle("has-stale", staleCount > 0);
    btn.textContent = staleCount > 0 ? "최신 상태로 실행 (" + staleCount + ")" : "재시작 후 실행";
    btn.title = staleCount > 0
      ? "커널을 비우고 모든 셀을 위에서부터 실행해 오래된 결과를 최신 상태로 맞춥니다."
      : "커널을 재시작한 뒤 모든 셀을 처음부터 실행";
  }
  // ▾ 메뉴는 접혀 있어도 stale 알림이 보이도록 더보기 버튼에 뱃지를 켠다.
  if (ownerDoc._nbRunMoreBtn) ownerDoc._nbRunMoreBtn.classList.toggle("has-stale", staleCount > 0);
  return states;
}

function nbScheduleExecutionStateRefresh(ownerDoc){
  if (!ownerDoc || ownerDoc._nbStateRefresh) return;
  if (typeof requestAnimationFrame !== "function"){
    nbRefreshExecutionStates(ownerDoc);
    return;
  }
  ownerDoc._nbStateRefresh = requestAnimationFrame(() => {
    ownerDoc._nbStateRefresh = 0;
    nbRefreshExecutionStates(ownerDoc);
  });
}

// 실행 버튼(거터)의 표시 갱신: 대기 [ ]/[n] · 실행 중 [*]
function setRunState(ctrl, state){
  const c = ctrl.cell;
  const running = state === "running";
  // 실행 중에는 실행 버튼을 정지(■) 버튼으로 바꿔, 누른 자리에서 바로 멈출 수 있게 한다.
  const count = running ? "■" : (c.execCount != null ? "[" + c.execCount + "]" : "[ ]");
  if (ctrl.runCount) ctrl.runCount.textContent = count;
  else ctrl.runBtn.textContent = count;
  ctrl.runBtn.classList.toggle("is-running", running);
  ctrl.runBtn.title = running
    ? "실행 중지 (클릭)"
    : "이 셀 실행 (Ctrl+Enter · Shift+Enter=실행 후 다음)";
  ctrl.runBtn.setAttribute("aria-label", running ? "실행 중지" : "이 셀 실행");
  if (running && ctrl.stateLabel){
    ctrl.stateLabel.textContent = "중지";
    ctrl.cellEl.dataset.execState = "running";
  }
}

function notebookVariables(value){
  if (typeof normalizePythonVariables === "function"){
    const count = Array.isArray(value) ? value.length : 0;
    return normalizePythonVariables(value, Math.max(1, count), 600);
  }
  const rows = [];
  for (const item of (Array.isArray(value) ? value : [])){
    const name = String(item && item.name || "");
    if (!name || name.charAt(0) === "_") continue;
    const row = {
      name:name.slice(0, 100),
      type:String(item && item.type || "").slice(0, 80),
      value:String(item && item.value == null ? "" : item.value).slice(0, 1200)
    };
    if (item && item.lazy != null) row.lazy = !!item.lazy;
    rows.push(row);
  }
  return rows;
}

async function notebookLookupVariable(ownerDoc, name){
  if (!ownerDoc || typeof startPyodideKernelVariableLookup !== "function") return null;
  const task = startPyodideKernelVariableLookup({
    kernelId:nbKernelId(ownerDoc),
    variableName:name
  });
  const result = await task.promise;
  return notebookVariables(result && result.variable ? [result.variable] : [])[0] || null;
}

// 변수 이름·자료형·shape만 먼저 그리고, 펼칠 때 현재 커널에서 값 또는 DataFrame 표를 가져온다.
function nbBuildVarRow(item, sanitizer, lookupVariable){
  const box = document.createElement("details"); box.className = "nbv-vars-df nbv-vars-item";
  const sm = document.createElement("summary"); sm.className = "nbv-vars-df-summary";
  const nm = document.createElement("code"); nm.className = "nbv-vars-name"; nm.textContent = item.name;
  const meta = document.createElement("span"); meta.className = "nbv-vars-type";
  const updateMeta = (value) => {
    meta.textContent = value.type + (value.shape ? " · " + value.shape : "");
  };
  updateMeta(item);
  sm.append(nm, meta);
  const body = document.createElement("div");
  body.className = "nbv-vars-live";
  box.append(sm, body);
  let loaded = false, loading = false;
  const renderValue = (value) => {
    body.textContent = "";
    updateMeta(value);
    if (value.html && sanitizer){
      const tableWrap = document.createElement("div");
      tableWrap.className = "nbv-out-html nbv-vars-df-table";
      tableWrap.innerHTML = sanitizer(value.html);
      body.appendChild(tableWrap);
      if (value.tableNote){
        const note = document.createElement("div");
        note.className = "nbv-vars-df-note";
        note.textContent = value.tableNote;
        body.appendChild(note);
      }
      return;
    }
    const current = document.createElement("code");
    current.className = "nbv-vars-value nbv-vars-live-value";
    current.textContent = value.value;
    body.appendChild(current);
  };
  if (!item.lazy){
    loaded = true;
    renderValue(item);
  } else {
    body.textContent = "펼치면 현재 커널 값을 불러옵니다.";
    box.addEventListener("toggle", async () => {
      if (!box.open){
        loaded = false;
        return;
      }
      if (loaded || loading) return;
      loading = true;
      body.textContent = "현재 커널 값 불러오는 중…";
      try {
        const value = await lookupVariable(item.name);
        if (!value) body.textContent = "현재 커널에 이 변수가 없습니다.";
        else {
          renderValue(value);
          loaded = true;
        }
      } catch(e){
        body.textContent = "값을 불러오지 못했습니다: " + ((e && e.message) ? e.message : e);
      } finally {
        loading = false;
      }
    });
  }
  return box;
}

// 커널은 셀 간 변수를 공유한다. 각 셀 아래에는 그 셀 실행 직후 커널에 누적된 변수를 모두 보여 준다.
function renderNotebookVariables(host, variables, ownerDoc){
  const rows = notebookVariables(variables);
  if (!rows.length) return;
  const sanitizer = (typeof PdfSignerCore !== "undefined" && PdfSignerCore && typeof PdfSignerCore.sanitizeHtml === "function")
    ? PdfSignerCore.sanitizeHtml : null;
  const details = document.createElement("details");
  details.className = "nbv-vars";
  const summary = document.createElement("summary");
  summary.textContent = "변수 " + rows.length + "개 (현재 셀까지 · 펼치면 현재 값)";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "nbv-vars-search";
  search.placeholder = "변수 이름·자료형 검색";
  search.setAttribute("aria-label", "변수 검색");
  const table = document.createElement("div");
  table.className = "nbv-vars-table";
  const rendered = [];
  const lookupVariable = (name) => notebookLookupVariable(ownerDoc, name);
  for (const item of rows){
    const row = nbBuildVarRow(item, sanitizer, lookupVariable);
    rendered.push({ item, row });
    table.appendChild(row);
  }
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const entry of rendered){
      const haystack = (entry.item.name + " " + entry.item.type + " " + (entry.item.shape || "")).toLocaleLowerCase();
      entry.row.hidden = !!query && !haystack.includes(query);
    }
  });
  details.append(summary);
  if (rows.length > 12) details.append(search);
  details.append(table);
  host.appendChild(details);
}

// 셀 실행에 걸린 시간을 사람이 읽기 좋은 짧은 문구로 바꾼다(1초 미만은 밀리초).
function notebookElapsedText(ms){
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return "실행 " + Math.round(value) + "밀리초";
  if (value < 60000) return "실행 " + (value / 1000).toFixed(value < 10000 ? 1 : 0) + "초";
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return "실행 " + minutes + "분 " + seconds + "초";
}

// 커널 결과(stdout/stderr/images)를 셀 바로 아래 인라인으로 그린다(빈 출력이면 표시 안 함, 재실행 시 교체).
function renderRunResult(ctrl, result){
  const out = (result && result.stdout) ? String(result.stdout).replace(/\n+$/, "") : "";
  const err = (result && result.stderr) ? String(result.stderr).replace(/\n+$/, "") : "";
  const images = (result && result.images) || [];
  const richOutputs = parseNbOutputs((result && result.richOutputs) || []);
  const outputs = (result && result.outputs) || [];
  const variables = notebookVariables(result && result.variables);
  if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
  if (!notebookCellHasExecutableSource(ctrl && ctrl.cell)) return;
  if (!out && !err && !images.length && !richOutputs.length && !outputs.length && !variables.length) return;
  const wrap = document.createElement("div");
  wrap.className = "nbv-out";
  if (out){ const p = document.createElement("pre"); p.className = "nbv-out-text"; p.textContent = out; wrap.appendChild(p); }
  if (richOutputs.length) renderCellOutputs(richOutputs, wrap, ctrl);
  for (const src of images){ const im = document.createElement("img"); im.className = "nbv-out-img"; im.src = src; wrap.appendChild(im); }
  if (outputs.length){
    const files = document.createElement("div"); files.className = "nbv-out-files";
    const title = document.createElement("strong"); title.textContent = "생성·변경 파일 " + outputs.length + "개";
    files.appendChild(title);
    for (const output of outputs.slice(0, 20)){
      const row = document.createElement("div"); row.className = "nbv-out-file";
      row.textContent = String(output.name || "output.dat") + " · " + humanSize(Number(output.size) || 0);
      files.appendChild(row);
    }
    wrap.appendChild(files);
  }
  renderNotebookVariables(wrap, variables, ctrl.ownerDoc);
  if (err) renderNotebookStderr(wrap, err, ctrl, result && result.ok === false ? false : (result && result.code));
  const elapsedText = notebookElapsedText(result && result.elapsedMs);
  if (elapsedText){
    const time = document.createElement("div");
    time.className = "nbv-out-time";
    time.textContent = "⏱ " + elapsedText;
    wrap.appendChild(time);
  }
  nbAttachOutputToggle(ctrl.ownerDoc, ctrl, wrap);
  ctrl.body.appendChild(wrap);
  ctrl.outWrap = wrap;
}

async function nbRunCell(ownerDoc, ctrl, advance, runOptions){
  runOptions = runOptions || {};
  if (!ownerDoc || ownerDoc._nbBusy || ownerDoc._nbLocalRunActive ||
      (ownerDoc._nbRunAllActive && !runOptions.runAll)) return null;
  if (!runOptions.runAll) ownerDoc._nbCancelRequested = false;
  const cell = ctrl.cell;
  if (ctrl.editor) cell.source = ctrl.editor.getValue();   // 마운트된 경우만 동기화(정적 셀은 cell.source 그대로)
  if (ctrl.refreshStdin) ctrl.refreshStdin();
  if (ctrl.prepareStdin && !ctrl.prepareStdin()) return { ok:false, pendingInput:true };
  if (ownerDoc._nbKernelMode !== "local" && notebookRequiresLocalPython(cell.source)){
    let backend = false;
    try { backend = await pythonBackendAvailable(); } catch(_){ backend = false; }
    ownerDoc._nbLocalPythonAvailable = !!backend;
    nbRefreshKernelModeUi(ownerDoc);
    if (!backend) nbShowLocalPythonInstallGuide(ownerDoc);
    else {
      const message = "Selenium 크롤링은 브라우저 Python에서 실행할 수 없습니다. 전체 실행 옆 ▾에서 '로컬 Python 셀 커널 사용'을 선택해 주세요.";
      if (typeof toast === "function") toast(message, 6500);
      nbSetStatus(ownerDoc, "Selenium 실행에는 로컬 Python 셀 커널이 필요해요.");
    }
    return { ok:false, requiresLocalPython:true, backendAvailable:backend };
  }
  const executionSnapshot = {
    source_hash:notebookExecutionHash(cell.source),
    upstream_hash:notebookUpstreamHash(ownerDoc.notebookModel, cell)
  };
  ownerDoc._nbBusy = true;
  nbSetRunningUi(ownerDoc, true);
  setRunState(ctrl, "running");
  const onMsg = (m) => nbSetStatus(ownerDoc, m);
  let result = null;
  try {
    const localKernel = ownerDoc._nbKernelMode === "local";
    let workspaceBundle = null;
    let workspaceSync = null;
    try {
      workspaceBundle = await buildNotebookWorkspaceBundle(ownerDoc);
      nbThrowIfCancelled(ownerDoc);
      if (!localKernel){
        workspaceSync = await buildNotebookCellWorkspaceSync(ownerDoc, cell);
        nbThrowIfCancelled(ownerDoc);
      }
      if (workspaceBundle) nbSetStatus(ownerDoc, "노트북 작업폴더 준비 중…");
    } catch(e){
      nbSetStatus(ownerDoc, "작업폴더 준비 오류: " + ((e && e.message) ? e.message : e));
      throw e;
    }
    const workspaceCwd = notebookCellWorkspaceCwd(ownerDoc, cell, workspaceBundle);
    let task;
    if (localKernel){
      nbSetStatus(ownerDoc, "셀 실행 중… · 로컬 Python · 기준 " + (workspaceCwd || "."));
      task = startLocalNotebookKernelRun(
        ownerDoc,
        cell.source,
        ctrl.stdinText ? ctrl.stdinText() : "",
        workspaceBundle
      );
    } else {
      let packages = { urls: [], names: [] };
      try {
        packages = await preparePyodideWorkerPackages(
          cell.source,
          onMsg,
          notebookWorkspaceImports(workspaceBundle)
        );
        nbThrowIfCancelled(ownerDoc);
      }
      catch(e){
        const message = (e && e.message) ? e.message : "패키지 설치를 취소했어요.";
        nbSetStatus(ownerDoc, message);
        throw new Error(message);
      }
      await ensurePyodideWorker(onMsg);
      nbThrowIfCancelled(ownerDoc);
      nbSetStatus(ownerDoc, "셀 실행 중… · 브라우저 · 기준 " + (workspaceCwd || "."));
      task = startPyodideKernelRun({
        kernelId:nbKernelId(ownerDoc),
        source:cell.source,
        stdin:ctrl.stdinText ? ctrl.stdinText() : "",
        packages,
        workspaceBundle,
        workspaceSync,
        workspaceCwd,
        onMsg
      });
    }
    ownerDoc._nbActiveTask = task;
    if (ownerDoc._nbCancelRequested) task.cancel();
    const runClock = (typeof performance !== "undefined" && performance.now) ? performance : Date;
    const runStartedAt = runClock.now();
    result = await task.promise;
    if (result && typeof result === "object") result.elapsedMs = runClock.now() - runStartedAt;
    nbThrowIfCancelled(ownerDoc);
    const outputBundle = workspaceBundle
      ? { ...workspaceBundle, cwd:workspaceCwd,
          logicalRoot:workspaceBundle.logicalRoot || "" }
      : null;
    const remembered = await rememberRunOutputs(
      notebookRunContext(ownerDoc),
      outputBundle,
      result.outputs || [],
      null
    );
    if (workspaceBundle && result.outputs && result.outputs.length){
      const byPath = new Map(workspaceBundle.files.map(file => [normalizedRunPath(file.path), file]));
      for (const output of result.outputs){
        if (!output.bytes) continue;
        const path = normalizedRunPath(output.name);
        if (path) byPath.set(path, { path, bytes:new Uint8Array(output.bytes) });
      }
      workspaceBundle.files = Array.from(byPath.values());
    }
    ownerDoc._nbExec = (ownerDoc._nbExec || 0) + 1;
    cell.execCount = ownerDoc._nbExec;
    cell.rawOutputs = notebookResultToRawOutputs(result, cell.execCount);
    cell.outputs = parseNbOutputs(cell.rawOutputs);
    cell.variables = notebookCellHasExecutableSource(cell) ? notebookVariables(result.variables) : [];
    notebookRecordExecution(ownerDoc.notebookModel, cell, result.ok !== false, executionSnapshot);
    renderRunResult(ctrl, result);
    setRunState(ctrl, "done");
    markNbDirty(ownerDoc);
    nbRefreshExecutionStates(ownerDoc);
    const elapsedText = notebookElapsedText(result.elapsedMs);
    const kernelName = localKernel ? "로컬 Python" : "브라우저";
    nbSetStatus(ownerDoc, result.ok === false
      ? "오류 · " + kernelName + " · 기준 " + (workspaceCwd || ".") + " · 커널 유지" + (elapsedText ? " · " + elapsedText : "")
      : ("완료" + (result.stderr ? "(경고 있음)" : "") + " · " + kernelName + " · 기준 " + (workspaceCwd || ".") +
        (remembered.count ? " · 파일 " + remembered.count + "개 저장" : "") + (elapsedText ? " · " + elapsedText : "")));
  } catch(e){
    const message = (e && e.message) ? e.message : String(e);
    const cancelled = !!ownerDoc._nbCancelRequested || (e && e.code === "worker-cancel");
    result = { ok:false, cancelled, code:cancelled ? -1 : 1, error:message, stdout:"", stderr:cancelled ? "" : message, images:[], outputs:[] };
    if (cancelled){
      ownerDoc._nbWorkspacePromise = null;
      nbSetStatus(ownerDoc, "중지됨 · " + (ownerDoc._nbKernelMode === "local" ? "로컬 Python" : "브라우저") + " 커널 초기화됨");
    } else {
      nbSetStatus(ownerDoc, "실행 오류: " + message);
    }
    setRunState(ctrl, "idle");
    nbRefreshExecutionStates(ownerDoc);   // 정지/오류 후 버튼·상태 라벨을 실제 실행 상태로 되돌린다
  } finally {
    ownerDoc._nbActiveTask = null;
    ownerDoc._nbBusy = false;
    if (!runOptions.runAll){
      ownerDoc._nbCancelRequested = false;
      nbSetRunningUi(ownerDoc, false);
    }
  }
  if (advance && !result.cancelled) nbFocusNextCode(ownerDoc, ctrl);
  return result;
}

async function nbRunAll(ownerDoc){
  if (!ownerDoc) return;
  const list = (ownerDoc._nbCtrls || []).filter(c => c.type === "code");
  return nbRunSequence(ownerDoc, list);
}

// 처음 셀부터 지정한 셀(포함)까지의 코드 셀만 순차 실행한다. 커널 상태(변수)는 그대로 유지한다.
async function nbRunUpTo(ownerDoc, ctrl){
  if (!ownerDoc) return;
  const ctrls = ownerDoc._nbCtrls || [];
  const end = ctrl ? ctrls.indexOf(ctrl) : ownerDoc._nbSelected;
  if (end < 0) return;
  const list = ctrls.slice(0, end + 1).filter(c => c.type === "code");
  if (!list.length){ nbSetStatus(ownerDoc, "여기까지 실행할 코드 셀이 없어요."); return; }
  return nbRunSequence(ownerDoc, list);
}

// 전체 실행·여기까지 실행이 공유하는 순차 실행 루프(중지·오류 중단·실행 UI 처리 포함).
async function nbRunSequence(ownerDoc, list){
  if (!ownerDoc || ownerDoc._nbBusy || ownerDoc._nbLocalRunActive ||
      ownerDoc._nbRunAllActive || !list || !list.length) return;
  ownerDoc._nbRunAllActive = true;
  ownerDoc._nbCancelRequested = false;
  try {
    for (const ctrl of list){
      if (ownerDoc._nbCancelRequested) break;
      const result = await nbRunCell(ownerDoc, ctrl, false, { runAll:true });
      if (!result || result.ok === false){
        if (result && result.cancelled) nbSetStatus(ownerDoc, "중지됨 · 남은 셀 실행 취소 · 커널 초기화됨");
        else if (result && result.pendingInput) nbSetStatus(ownerDoc, "입력값을 준비한 뒤 전체 실행을 다시 눌러 주세요.");
        else if (result && result.requiresLocalPython) { /* 앞에서 표시한 설치·전환 안내 유지 */ }
        else nbSetStatus(ownerDoc, "오류가 나서 전체 실행을 멈췄어요(커널은 유지).");
        break;
      }
    }
  } finally {
    const cancelled = !!ownerDoc._nbCancelRequested;
    ownerDoc._nbRunAllActive = false;
    ownerDoc._nbBusy = false;
    ownerDoc._nbActiveTask = null;
    ownerDoc._nbCancelRequested = false;
    nbSetRunningUi(ownerDoc, false);
    if (cancelled) nbSetStatus(ownerDoc, "중지됨 · 남은 셀 실행 취소 · 커널 초기화됨");
  }
}

async function nbRestartKernel(ownerDoc){
  if (!ownerDoc || ownerDoc._nbBusy || ownerDoc._nbLocalRunActive) return false;
  ownerDoc._nbBusy = true;
  try {
    if (ownerDoc._nbKernelMode === "local") await nbStopLocalNotebookKernel(ownerDoc);
    else await startPyodideKernelRun({ kernelId: nbKernelId(ownerDoc), reset: true }).promise;
  } catch(e){
    nbSetStatus(ownerDoc, "커널 재시작 실패: " + ((e && e.message) ? e.message : e));
    ownerDoc._nbBusy = false;
    return false;
  }
  ownerDoc._nbBusy = false;
  ownerDoc._nbExec = 0;
  ownerDoc._nbWorkspacePromise = null;
  let changed = false;
  for (const ctrl of (ownerDoc._nbCtrls || [])){
    if (ctrl.type !== "code") continue;
    if (ctrl.cell.execCount != null || (ctrl.cell.rawOutputs && ctrl.cell.rawOutputs.length) ||
        (ctrl.cell.metadata && ctrl.cell.metadata[NB_EXEC_META_KEY])) changed = true;
    ctrl.cell.execCount = null;
    ctrl.cell.rawOutputs = [];
    ctrl.cell.outputs = [];
    notebookClearExecution(ctrl.cell);
    if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
    setRunState(ctrl, "idle");
  }
  if (changed) markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
  nbSetStatus(ownerDoc, (ownerDoc._nbKernelMode === "local" ? "로컬 Python" : "브라우저") + " 커널 재시작됨 · 상태 초기화");
  return true;
}

// 커널 재시작 후 전체 실행
async function nbRestartRunAll(ownerDoc){
  if (!ownerDoc || ownerDoc._nbBusy) return;
  if (await nbRestartKernel(ownerDoc)) await nbRunAll(ownerDoc);
}

// 모든 셀의 출력만 지운다(변수·상태 유지)
function nbClearOutputs(ownerDoc){
  let changed = false;
  for (const ctrl of (ownerDoc._nbCtrls || [])){
    if (ctrl.type !== "code") continue;
    if (ctrl.cell.execCount != null || (ctrl.cell.rawOutputs && ctrl.cell.rawOutputs.length) ||
        (ctrl.cell.metadata && ctrl.cell.metadata[NB_EXEC_META_KEY])) changed = true;
    ctrl.cell.execCount = null;
    ctrl.cell.rawOutputs = [];
    ctrl.cell.outputs = [];
    notebookClearExecution(ctrl.cell);
    if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
    setRunState(ctrl, "idle");
  }
  if (changed) markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
  nbSetStatus(ownerDoc, "실행 결과를 지웠어요.");
}

// 한 코드 셀의 실행 결과만 비운다(변수·커널 상태는 유지). 셀 도구막대의 지우개 버튼에서 호출.
function nbClearCellOutput(ownerDoc, ctrl){
  if (!ctrl || ctrl.type !== "code") return;
  const cell = ctrl.cell;
  const had = cell.execCount != null || (cell.rawOutputs && cell.rawOutputs.length) ||
    (cell.outputs && cell.outputs.length) || (cell.metadata && cell.metadata[NB_EXEC_META_KEY]);
  if (!had){ if (typeof toast === "function") toast("이 셀에는 지울 출력이 없어요.", 1600); return; }
  cell.execCount = null;
  cell.rawOutputs = [];
  cell.outputs = [];
  notebookClearExecution(cell);
  if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
  setRunState(ctrl, "idle");
  markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
}

// 현재 노트북을 파이썬(.py)으로 변환해 새 탭으로 연다(기존 ipynbToPython 재사용).
function nbExportPy(ownerDoc){
  const model = ownerDoc && ownerDoc.notebookModel;
  if (!model) return;
  let pySrc;
  try { pySrc = (typeof ipynbToPython === "function") ? ipynbToPython(modelToIpynb(model), ownerDoc.name || "notebook.ipynb") : null; }
  catch(e){ nbSetStatus(ownerDoc, "내보내기 실패: " + ((e && e.message) || e)); return; }
  if (pySrc == null){ nbSetStatus(ownerDoc, "내보내기를 지원하지 않는 환경이에요."); return; }
  const pyName = String(ownerDoc.name || "notebook").replace(/\.ipynb$/i, "") + ".py";
  if (typeof handleFiles === "function") handleFiles([new File([pySrc], pyName, { type: "text/x-python" })], { isScratch: true });
  nbSetStatus(ownerDoc, pyName + " 로 내보냈어요.");
}

// 전체 높이·A4 한 쪽 높이·셀 시작점을 받아, 가능한 한 셀 사이에서 끊는 캡처 구간을 만든다.
// 브라우저 없는 단위 테스트에서도 검증할 수 있도록 DOM과 분리한 순수 함수다.
function notebookPdfSegments(totalHeight, pageHeight, cellTops){
  const total = Math.max(0, Math.round(Number(totalHeight) || 0));
  const page = Math.max(1, Math.round(Number(pageHeight) || 1));
  const breaks = Array.from(new Set((Array.isArray(cellTops) ? cellTops : [])
    .map(value => Math.round(Number(value) || 0))
    .filter(value => value > 1 && value < total)))
    .sort((a, b) => a - b);
  const segments = [];
  for (let cursor = 0; cursor < total; ){
    const limit = Math.min(total, cursor + page);
    if (limit >= total){ segments.push([cursor, total]); break; }
    let cut = -1;
    for (const boundary of breaks){
      if (boundary <= cursor + 8) continue;
      if (boundary > limit) break;
      cut = boundary;
    }
    if (cut < 0) cut = limit;
    segments.push([cursor, cut]);
    cursor = cut;
  }
  return segments;
}

// 여러 A4 구간을 한 번의 html2canvas 호출로 묶되, 캔버스 원시 메모리가 일정 수준을 넘지 않게 한다.
// 페이지마다 전체 DOM을 다시 분석하는 비용을 줄여 긴 노트북 내보내기를 크게 단축한다.
function notebookPdfBatches(segments, contentWidth, scale, maxPixels){
  const list = Array.isArray(segments) ? segments : [];
  const width = Math.max(1, Number(contentWidth) || 1);
  const ratio = Math.max(0.1, Number(scale) || 1);
  const limit = Math.max(1000000, Number(maxPixels) || 24000000);
  const batches = [];
  for (let index = 0; index < list.length; ){
    const first = index;
    const start = list[index][0];
    let end = index + 1;
    while (end < list.length){
      const height = Math.max(1, list[end][1] - start);
      const pixels = Math.ceil(width * ratio) * Math.ceil(height * ratio);
      if (pixels > limit) break;
      end++;
    }
    batches.push({ first, end, start, finish:list[end - 1][1] });
    index = end;
  }
  return batches;
}

function nbCanvasPngBytes(canvas){
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== "function"){
      reject(new Error("PNG 캔버스를 만들 수 없어요."));
      return;
    }
    canvas.toBlob(async (blob) => {
      if (!blob){ reject(new Error("PNG 이미지 변환에 실패했어요.")); return; }
      try { resolve(new Uint8Array(await blob.arrayBuffer())); }
      catch(error){ reject(error); }
    }, "image/png");
  });
}

function nbPdfBackgroundRgb(cssColor){
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return [1, 1, 1];
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillStyle = cssColor || "#ffffff";
  ctx.fillRect(0, 0, 1, 1);
  const pixel = ctx.getImageData(0, 0, 1, 1).data;
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
}

// 캡처 라이브러리(html-to-image)의 "소스 코드"를 구한다 — 지도 iframe 에 postMessage 로 전달해 안에서 eval.
// 오프라인 번들은 인라인 <script> 에서(맨 앞 배너로 식별), 개발용 페이지는 src 를 fetch 해서 얻는다.
let _nbCaptureLibPromise = null;
function nbMapCaptureLibSource(){
  if (_nbCaptureLibPromise) return _nbCaptureLibPromise;
  _nbCaptureLibPromise = (async () => {
    for (const s of Array.from(document.scripts)){
      const text = s.src ? "" : (s.textContent || "");
      if (text.length > 5000 && text.slice(0, 300).indexOf("html-to-image") >= 0) return text;
    }
    const src = Array.from(document.scripts).map(s => s.src).find(u => /html-to-image/i.test(u || ""));
    if (src){ try { const r = await fetch(src); if (r.ok) return await r.text(); } catch(_){} }
    return "";
  })();
  return _nbCaptureLibPromise;
}

// 지도 iframe 에 스냅샷을 부탁하고 PNG data URL 을 돌려받는다(시간 초과·취소·실패 시 빈 문자열).
// 마커 수천 개짜리 지도는 캡처에 수십 초가 걸릴 수 있어 기본 시간을 넉넉히 준다(실측: 2,799개 ≈ 18초).
let _nbMapShotSeq = 0;
function nbRequestMapSnapshot(frame, lib, timeoutMs, isCancelled){
  return new Promise((resolve) => {
    const id = "map-" + (++_nbMapShotSeq);
    let timer = 0, cancelTimer = 0;
    const finish = (value) => {
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      clearInterval(cancelTimer);
      resolve(value);
    };
    const onMsg = (ev) => {
      const d = ev.data || {};
      if (!d || d.type !== "nbv-map-snapshot-result" || d.id !== id) return;
      const url = typeof d.dataUrl === "string" ? d.dataUrl : "";
      finish(url.indexOf("data:image/") === 0 ? url : "");   // 이미지 data URL 만 신뢰(sandbox 응답 검증)
    };
    timer = setTimeout(() => finish(""), timeoutMs || 45000);
    if (typeof isCancelled === "function") cancelTimer = setInterval(() => { if (isCancelled()) finish(""); }, 500);
    window.addEventListener("message", onMsg);
    // 타일 프록시: 캡처의 타일 재요청(fetch)이 OSM 정책에 차단되지 않게 exe 서버가 대신 받아온다.
    // http(s)로 서빙될 때만(=exe) 전달 — file:// 등에서는 기존 방식대로 시도한다.
    const tileProxy = (location.protocol === "http:" || location.protocol === "https:")
      ? location.origin + "/tile-proxy?u=" : "";
    try { frame.contentWindow.postMessage({ type: "nbv-map-snapshot", id, lib, scale: 1.5, tileProxy }, "*"); }
    catch(_){ finish(""); }
  });
}

// loading=lazy 라 아직 로드 전인 iframe 은 eager 로 바꿔 로드를 기다린다(스냅샷 전 단계).
function nbEnsureFrameLoaded(frame, timeoutMs){
  if (frame.dataset.nbvFrameLoaded === "1") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(frame.dataset.nbvFrameLoaded === "1"), timeoutMs || 6000);
    frame.addEventListener("load", () => { clearTimeout(timer); resolve(true); }, { once: true });
    try { frame.loading = "eager"; } catch(_){}
  });
}

// PDF 캡처 전에 격리 iframe(지도·차트)을 정적 대체물로 바꿔 둔다 — 지도는 스냅샷 이미지,
// 실패하거나 스냅샷을 지원하지 않는 프레임은 안내 박스. 대체물은 nbv-capturing 중에만 보이고
// 원본 iframe 은 같은 규칙으로 숨겨져, 측정과 캡처 복제본의 페이지 경계가 일치한다.
// 반환한 목록은 내보내기 finally 에서 원상 복구한다.
async function nbSnapshotRichFrames(cells, progress, ownerDoc){
  const wraps = Array.from(cells.querySelectorAll(".nbv-out-rich-frame"));
  const swaps = [];
  if (!wraps.length) return swaps;
  const mapCount = wraps.filter(w => w.dataset.nbvMapFrame === "1").length;
  const lib = mapCount ? await nbMapCaptureLibSource() : "";
  // 화면 밖의 cross-origin iframe 은 브라우저가 렌더링(rAF)을 정지시켜 내부 캡처가 영영 끝나지 않는다.
  // 스냅샷 전에 각 지도를 화면 안으로 스크롤해 깨우고, 끝나면 원래 위치로 되돌린다(진행창 뒤라 안 보임).
  const findScroller = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement){
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  };
  const scroller = mapCount ? findScroller(cells) : null;
  const prevScrollTop = scroller ? scroller.scrollTop : 0;
  const isCancelled = () => !!(progress && progress.isCancelled());
  let done = 0;
  for (const wrap of wraps){
    if (isCancelled()) break;    // 취소 예외는 호출부가 던진다(복구는 finally 담당)
    const frame = wrap.querySelector("iframe.nbv-out-rich-frame-content");
    const isMap = wrap.dataset.nbvMapFrame === "1";
    const title = (frame && frame.title) || "인터랙티브 출력";
    let node = null;
    if (frame && isMap){
      done++;
      nbSetStatus(ownerDoc, "PDF 만드는 중… 지도 캡처 (" + done + "/" + mapCount + ")");
      if (progress) progress.update(done - 1, mapCount, "지도 캡처 중 (" + done + "/" + mapCount + ") — 지도가 크면 시간이 걸려요");
      try { wrap.scrollIntoView({ block: "center" }); } catch(_){}
      await new Promise(r => setTimeout(r, 400));   // 스크롤로 iframe 렌더링이 깨어날 여유
      const wasLoaded = frame.dataset.nbvFrameLoaded === "1";
      const loaded = wasLoaded || await nbEnsureFrameLoaded(frame, 6000);
      if (loaded && !wasLoaded) await new Promise(r => setTimeout(r, 1500));   // 갓 로드된 지도는 타일 로딩 여유
      const shot = loaded ? await nbRequestMapSnapshot(frame, lib, 45000, isCancelled) : "";
      if (shot){
        node = document.createElement("img");
        node.className = "nbv-pdf-shot nbv-pdf-map-shot";
        node.alt = title;
        node.src = shot;
      }
    }
    if (!node){
      node = document.createElement("div");
      node.className = "nbv-pdf-shot nbv-pdf-frame-note";
      node.textContent = (isMap ? "🗺 " : "📊 ") + title
        + " — 대화형 출력이라 이 PDF에는 담지 못했어요. 앱에서 노트북을 열어 확인하세요.";
    }
    wrap.insertAdjacentElement("afterend", node);
    wrap.classList.add("nbv-pdf-frame-hide");
    swaps.push({ wrap, node });
  }
  if (scroller) scroller.scrollTop = prevScrollTop;   // 스냅샷용 스크롤 원복
  return swaps;
}

// 요소부터 위로 올라가며 첫 불투명 배경색을 찾는다(캡처·PDF 여백 배경용 — 현재 테마 배경을 그대로 따른다).
function nbResolveBg(el){
  for (let node = el; node && node.nodeType === 1; node = node.parentElement){
    const c = getComputedStyle(node).backgroundColor;
    if (c && c !== "transparent" && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(c)) return c;
  }
  return null;
}

function nbPreparePdfClone(root){
  if (!root) return;
  // 화면 테마 그대로 캡처한다(라이트는 라이트, 다크는 다크) — 복제본이 앱의 data-theme 을 물려받으므로
  // 따로 바꾸지 않는다. 사용자가 보는 모습 그대로 저장된다.
  root.classList.add("nbv-capturing");
  root.querySelectorAll(".nbv-cell-collapsed").forEach(el => el.classList.remove("nbv-cell-collapsed"));
  root.querySelectorAll(".nbv-out-collapsed").forEach(el => el.classList.remove("nbv-out-collapsed"));
}

function nbCreatePdfProgress(){
  const overlay = document.createElement("div");
  overlay.className = "nbv-pdf-progress";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "nbv-pdf-progress-title");
  const card = document.createElement("div");
  card.className = "nbv-pdf-progress-card";
  const head = document.createElement("div");
  head.className = "nbv-pdf-progress-head";
  const spinner = document.createElement("div");
  spinner.className = "nbv-pdf-progress-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const title = document.createElement("div");
  title.id = "nbv-pdf-progress-title";
  title.className = "nbv-pdf-progress-title";
  title.textContent = "노트북 PDF 저장 중";
  head.append(spinner, title);
  const note = document.createElement("p");
  note.className = "nbv-pdf-progress-note";
  note.textContent = "고화질 변환은 페이지 수와 실행 결과에 따라 시간이 걸릴 수 있어요. 이 창을 닫지 마세요.";
  const meter = document.createElement("progress");
  meter.className = "nbv-pdf-progress-meter";
  meter.max = 1;
  meter.value = 0;
  const detail = document.createElement("div");
  detail.className = "nbv-pdf-progress-detail";
  detail.setAttribute("role", "status");
  detail.setAttribute("aria-live", "polite");
  detail.textContent = "페이지를 계산하고 있어요…";
  const actions = document.createElement("div");
  actions.className = "nbv-pdf-progress-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "nbv-pdf-progress-cancel";
  cancel.textContent = "저장 취소";
  actions.appendChild(cancel);
  card.append(head, note, meter, detail, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const startedAt = Date.now();
  let cancelled = false;
  let completed = 0;
  let total = 0;
  let phase = "페이지를 계산하고 있어요…";
  const render = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    meter.max = Math.max(1, total);
    meter.value = Math.min(completed, meter.max);
    detail.textContent = cancelled
      ? "현재 묶음 처리가 끝나면 취소합니다… · 경과 " + seconds + "초"
      : phase + (total ? " · " + completed + "/" + total + "쪽" : "") + " · 경과 " + seconds + "초";
  };
  const timer = setInterval(render, 1000);
  cancel.addEventListener("click", () => {
    if (cancelled) return;
    cancelled = true;
    cancel.disabled = true;
    cancel.textContent = "취소 요청됨";
    render();
  });
  render();
  return {
    update(done, count, message){
      completed = Math.max(0, Number(done) || 0);
      total = Math.max(0, Number(count) || 0);
      phase = message || phase;
      render();
    },
    isCancelled(){ return cancelled; },
    close(){ clearInterval(timer); overlay.remove(); }
  };
}

function nbPdfCancelError(){
  const error = new Error("PDF 저장을 취소했어요.");
  error.code = "notebook-pdf-cancelled";
  return error;
}

// requestAnimationFrame 안에서 Promise를 바로 끝내면 이어지는 무거운 작업이 같은 프레임의 paint를
// 다시 막을 수 있다. 다음 task로 넘겨 진행창이 실제 화면에 먼저 그려지도록 보장한다.
function nbWaitForPdfProgressPaint(){
  return new Promise(resolve => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

// 노트북 전체(코드+실행 출력)를 A4 세로 비율 구간별로 캡처해 고화질 이미지 PDF로 저장한다.
// 태블릿에서 실행 결과까지 그대로 넘겨보며 공부하도록.
//  · 필기·변수 패널·실행 시간·셀번호(실행칸)·툴 아이콘은 nbv-capturing 클래스로 숨겨 깔끔하게 담는다.
//  · 긴 코드·출력·접힌 셀은 캡처 복제본에서 펼치고, 선택 표시와 편집 입력 레이어는 숨긴다.
//  · 페이지 경계는 셀 시작점과 출력 블록 시작점에서만 끊어 차트·그림·지도가 중간에서
//    잘리지 않게 한다. 코드와 출력 사이에서도 끊을 수 있어 큰 출력이 딸린 셀이 통째로
//    다음 쪽으로 밀리며 생기던 빈 공간을 줄인다. (블록 하나가 한 쪽보다 크면 그때만 잘린다)
//  · 화면 테마 그대로 캡처한다(라이트는 라이트, 다크는 다크) — 사용자가 보는 모습대로 저장.
//  · 빈 셀(자리표시 문구만 있는 셀)은 담지 않는다 — '클릭해 편집' 안내가 인쇄물에 찍히지 않게.
//  · 노트북 전체를 거대한 캔버스 한 장으로 만들지 않고 2~3쪽 묶음을 2.5배(약 300dpi)로 렌더해
//    메모리를 제한하면서 페이지마다 DOM을 다시 분석하던 대기 시간도 줄인다.
async function nbExportImagePdf(ownerDoc){
  if (!ownerDoc) return;
  const cells = ownerDoc._nbCellsWrap;
  if (!cells || !cells.childElementCount){ nbSetStatus(ownerDoc, "내보낼 셀이 없어요."); return; }
  if (typeof html2canvas === "undefined"){ nbSetStatus(ownerDoc, "이미지 라이브러리를 불러오지 못했어요."); return; }
  if (typeof PDFLib === "undefined"){ nbSetStatus(ownerDoc, "PDF 라이브러리를 불러오지 못했어요."); return; }
  if (ownerDoc._nbPdfBusy) return;
  ownerDoc._nbPdfBusy = true;
  const pdfButton = ownerDoc._nbRoot && ownerDoc._nbRoot.querySelector(".nbv-export-pdf");
  if (pdfButton){ pdfButton.disabled = true; pdfButton.setAttribute("aria-busy", "true"); }
  const progress = nbCreatePdfProgress();
  nbSetStatus(ownerDoc, "PDF 만드는 중… 페이지 계산");

  const scale = 2.5;
  let bg = "#ffffff";
  let collapsedCells = [];
  let collapsedOutputs = [];
  let frameSwaps = [];
  try {
    // 진행창부터 paint한 뒤 큰 노트북 DOM 검색·폰트 대기·페이지 계산을 시작한다.
    await nbWaitForPdfProgressPaint();
    bg = nbResolveBg(cells) || "#ffffff";   // 여백·페이지 배경도 현재 테마 배경색을 따른다
    collapsedCells = Array.from(cells.querySelectorAll(".nbv-cell-collapsed"));
    collapsedOutputs = Array.from(cells.querySelectorAll(".nbv-out-collapsed"));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    if (progress.isCancelled()) throw nbPdfCancelError();

    // 격리 iframe(지도·차트)을 스냅샷 이미지/안내 박스로 바꿔 둔다 — 빈 공간 방지.
    frameSwaps = await nbSnapshotRichFrames(cells, progress, ownerDoc);
    if (progress.isCancelled()) throw nbPdfCancelError();

    // 빈 셀(자리표시 문구만 있는 셀)에 제외 마커를 단다. 측정(라이브 DOM)과 html2canvas 복제본이
    // 같은 nbv-capturing CSS 규칙으로 숨기므로 페이지 경계 계산과 캡처 결과가 어긋나지 않는다.
    Array.from(cells.querySelectorAll(":scope > .nbv-cell")).forEach(el => {
      const empty = !!el.querySelector(".nbv-md-empty") && !el.querySelector(".nbv-out");
      el.classList.toggle("nbv-pdf-skip", empty);
    });

    // ① PDF용 펼침 상태에서 셀 경계와 전체 높이를 잰다. 한 동기 작업 안에서 원상 복구하므로 화면에는 그려지지 않는다.
    collapsedCells.forEach(el => el.classList.remove("nbv-cell-collapsed"));
    collapsedOutputs.forEach(el => el.classList.remove("nbv-out-collapsed"));
    cells.classList.add("nbv-capturing");
    const bounds = cells.getBoundingClientRect();
    const contTop = bounds.top;
    const contentWidth = Math.max(1, Math.ceil(bounds.width));
    const contentHeight = Math.max(1, Math.ceil(bounds.height), Math.ceil(cells.scrollHeight));
    // 경계 후보: 셀 시작점 + 셀 안 출력 묶음(.nbv-out)·각 출력 블록의 시작점.
    // 코드와 출력 사이, 출력 블록 사이에서도 쪽을 끊을 수 있어, 큰 차트·지도가 딸린 셀이
    // 통째로 다음 쪽으로 밀리며 남기던 쪽 하단 빈 공간이 줄어든다.
    // 이미지·지도 중간은 여전히 안 자른다(블록 하나가 한 쪽보다 클 때만 예외).
    // height 0 블록(캡처 중 숨김: 실행시간·원본 iframe 등)은 경계에서 뺀다.
    const cellTops = [];
    Array.from(cells.querySelectorAll(":scope > .nbv-cell:not(.nbv-pdf-skip)")).forEach((cellEl) => {
      cellTops.push(cellEl.getBoundingClientRect().top - contTop);
      cellEl.querySelectorAll(".nbv-out, .nbv-out > *").forEach((block) => {
        const rect = block.getBoundingClientRect();
        if (rect.height > 1) cellTops.push(rect.top - contTop);
      });
    });
    cells.classList.remove("nbv-capturing");
    collapsedCells.forEach(el => el.classList.add("nbv-cell-collapsed"));
    collapsedOutputs.forEach(el => el.classList.add("nbv-out-collapsed"));

    // ② A4 세로 비율 한 페이지 높이. 이보다 커지기 직전의 셀 경계에서 페이지를 끊는다.
    const A4_W = 595.28, A4_H = 841.89;
    const pageCssHeight = Math.max(1, Math.round(contentWidth * (A4_H / A4_W)));
    const segs = notebookPdfSegments(contentHeight, pageCssHeight, cellTops);
    if (!segs.length) throw new Error("캡처할 페이지를 계산하지 못했어요.");
    const batches = notebookPdfBatches(segs, contentWidth, scale, 24000000);
    progress.update(0, segs.length, "고화질 캡처 준비 중");

    const { PDFDocument } = PDFLib;
    const pdf = await PDFDocument.create();
    const bgRgb = nbPdfBackgroundRgb(bg);

    // ③ 2~3쪽을 한 번에 렌더한 다음 쪽별 캔버스로 잘라 PDF에 넣는다.
    //    html2canvas의 전체 DOM 복제·분석 횟수가 페이지 수가 아니라 묶음 수만큼으로 줄어든다.
    let completedPages = 0;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++){
      if (progress.isCancelled()) throw nbPdfCancelError();
      const batch = batches[batchIndex];
      const batchHeight = Math.max(1, batch.finish - batch.start);
      const rangeText = (batch.first + 1) + (batch.end > batch.first + 1 ? "–" + batch.end : "");
      const captureMessage = rangeText + "쪽 고화질 캡처 중";
      nbSetStatus(ownerDoc, "PDF 만드는 중… " + captureMessage);
      progress.update(completedPages, segs.length, captureMessage);
      const batchShot = await html2canvas(cells, {
        backgroundColor: bg,
        scale,
        useCORS: true,
        logging: false,
        x: 0,
        y: batch.start,
        width: contentWidth,
        height: batchHeight,
        windowWidth: Math.max(document.documentElement.clientWidth, contentWidth),
        windowHeight: Math.max(document.documentElement.clientHeight, Math.min(contentHeight, batchHeight)),
        onclone: (doc, el) => nbPreparePdfClone(el)
      });
      if (!batchShot.width || !batchShot.height) throw new Error(rangeText + "쪽 캡처에 실패했어요.");
      if (progress.isCancelled()){
        batchShot.width = batchShot.height = 1;
        throw nbPdfCancelError();
      }
      const scaleY = batchShot.height / batchHeight;
      for (let p = batch.first; p < batch.end; p++){
        const segment = segs[p];
        const sourceY = Math.max(0, Math.round((segment[0] - batch.start) * scaleY));
        const sourceEnd = Math.min(batchShot.height, Math.round((segment[1] - batch.start) * scaleY));
        const sourceHeight = Math.max(1, sourceEnd - sourceY);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = batchShot.width;
        pageCanvas.height = sourceHeight;
        const pageContext = pageCanvas.getContext("2d");
        if (!pageContext) throw new Error((p + 1) + "쪽 캔버스를 만들지 못했어요.");
        pageContext.drawImage(batchShot, 0, sourceY, batchShot.width, sourceHeight, 0, 0, pageCanvas.width, pageCanvas.height);
        const pngBytes = await nbCanvasPngBytes(pageCanvas);
        const png = await pdf.embedPng(pngBytes);
        const page = pdf.addPage([A4_W, A4_H]);
        if (typeof PDFLib.rgb === "function"){
          page.drawRectangle({ x:0, y:0, width:A4_W, height:A4_H, color:PDFLib.rgb(bgRgb[0], bgRgb[1], bgRgb[2]) });
        }
        const imageHeight = Math.min(A4_H, A4_W * (pageCanvas.height / pageCanvas.width));
        page.drawImage(png, { x:0, y:A4_H - imageHeight, width:A4_W, height:imageHeight });
        pageCanvas.width = pageCanvas.height = 1;
        completedPages++;
        const encodeMessage = (p + 1) + "쪽 PDF에 넣는 중";
        nbSetStatus(ownerDoc, "PDF 만드는 중… " + completedPages + "/" + segs.length + " 쪽");
        progress.update(completedPages, segs.length, encodeMessage);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      batchShot.width = batchShot.height = 1;
    }
    if (progress.isCancelled()) throw nbPdfCancelError();
    progress.update(segs.length, segs.length, "PDF 파일 마무리 중");
    nbSetStatus(ownerDoc, "PDF 만드는 중… 파일 마무리");
    const bytes = await pdf.save();
    const name = String(ownerDoc.name || "notebook").replace(/\.ipynb$/i, "") + ".pdf";
    if (typeof downloadPdfBytes !== "function") throw new Error("PDF 다운로드 기능을 찾지 못했어요.");
    downloadPdfBytes(bytes, name);
    nbSetStatus(ownerDoc, name + " 로 고화질 저장했어요 · 전체 " + segs.length + "쪽");
  } catch(e){
    if (e && e.code === "notebook-pdf-cancelled"){
      nbSetStatus(ownerDoc, "PDF 저장을 취소했어요.");
    } else {
      console.error(e);
      nbSetStatus(ownerDoc, "PDF 저장 실패: " + ((e && e.message) || e));
    }
  } finally {
    cells.classList.remove("nbv-capturing");
    collapsedCells.forEach(el => el.classList.add("nbv-cell-collapsed"));
    collapsedOutputs.forEach(el => el.classList.add("nbv-out-collapsed"));
    frameSwaps.forEach(({ wrap, node }) => {
      try { node.remove(); wrap.classList.remove("nbv-pdf-frame-hide"); } catch(_){}
    });
    ownerDoc._nbPdfBusy = false;
    if (pdfButton){ pdfButton.disabled = false; pdfButton.removeAttribute("aria-busy"); }
    progress.close();
  }
}

// 실행 후 다음 셀로 이동(Shift+Enter): 다음 코드 셀은 편집 진입, 마크다운이면 선택, 없으면 새 코드 셀 추가.
function nbFocusNextCode(ownerDoc, ctrl){
  const list = ownerDoc._nbCtrls || [];
  const i = list.indexOf(ctrl);
  for (let j = i + 1; j < list.length; j++){
    if (list[j].type === "code"){ nbEnterEdit(ownerDoc, j, "center"); return; }
    if (list[j].type === "markdown"){ nbSelectCell(ownerDoc, j, "center"); return; }
  }
  nbInsertCell(ownerDoc, i, "code", { where: "below", edit: true, scrollBlock: "center" });
}

// 셀 도구 모음용 단색 SVG 아이콘(이모지 대신). currentColor 라 테마·hover 색을 그대로 따른다.
const nbIcon = (path, width) =>
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="' +
  (width || 1.6) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
const NB_ICONS = {
  grip: nbIcon('<path d="M5 3.5h.01M5 8h.01M5 12.5h.01M11 3.5h.01M11 8h.01M11 12.5h.01"/>', 2.6),
  up: nbIcon('<path d="M4 10l4-4 4 4"/>'),
  down: nbIcon('<path d="M4 6l4 4 4-4"/>'),
  add: nbIcon('<path d="M8 3.5v9M3.5 8h9"/>'),
  copy: nbIcon('<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2"/><path d="M10.5 5.5V3.8A.8.8 0 0 0 9.7 3H3.8a.8.8 0 0 0-.8.8v5.9a.8.8 0 0 0 .8.8h1.7"/>', 1.35),
  paste: nbIcon('<path d="M5.5 4h-1a1 1 0 0 0-1 1v8h9V5a1 1 0 0 0-1-1h-1"/><rect x="5.5" y="2.5" width="5" height="3" rx="1"/><path d="M6 8h4M6 10.5h3"/>', 1.35),
  memo: nbIcon('<path d="M3 3h10v10H3z"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>', 1.35),
  toCode: nbIcon('<path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5"/>'),     // 코드 셀로 변환(꺾쇠)
  toText: nbIcon('<path d="M3 4.5h10M3 8h10M3 11.5h6"/>'),                     // 마크다운 셀로 변환(텍스트 줄)
  trash: nbIcon('<path d="M2.5 4h11M6 4V2.7h4V4M6.5 7v4.5M9.5 7v4.5M3.7 4l.6 8.3a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.6-8.3"/>', 1.4),
  clearOut: nbIcon('<path d="M4 11.5 2.6 10a1 1 0 0 1 0-1.4l4.7-4.7a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4l-3.3 3.2z"/><path d="M6.3 6.3l3.4 3.4M3.6 13h9"/>', 1.4),  // 지우개(셀 출력 비우기)
  runUpTo: nbIcon('<path d="M5 3l5 3.3-5 3.3z" fill="currentColor" stroke="none"/><path d="M3 12.7h10"/>', 1.5),  // 여기까지 실행(재생 ▸ + 하단 기준선)
  collapseTools: nbIcon('<path d="M6 4l4 4-4 4"/>'),
  expandTools: nbIcon('<path d="M10 4 6 8l4 4"/>')
};

function nbClearDragState(ownerDoc){
  const wrap = ownerDoc && ownerDoc._nbCellsWrap;
  if (wrap){
    wrap.querySelectorAll(".nbv-dragging,.nbv-drop-before,.nbv-drop-after").forEach(el => {
      el.classList.remove("nbv-dragging", "nbv-drop-before", "nbv-drop-after");
    });
  }
  if (ownerDoc) ownerDoc._nbDrag = null;
}

function nbSetDragTarget(ownerDoc, ctrl, before){
  const drag = ownerDoc && ownerDoc._nbDrag;
  if (!drag || !ctrl) return;
  for (const item of (ownerDoc._nbCtrls || [])){
    item.cellEl.classList.remove("nbv-drop-before", "nbv-drop-after");
  }
  ctrl.cellEl.classList.add(before ? "nbv-drop-before" : "nbv-drop-after");
  drag.target = ctrl;
  drag.before = before;
}

// 배열 항목 하나를 최종 인덱스로 옮긴다. 모델과 컨트롤러 배열에 같은 규칙을 적용한다.
function notebookMoveArrayItem(items, from, to){
  if (!Array.isArray(items) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return false;
  const item = items.splice(from, 1)[0];
  items.splice(to, 0, item);
  return true;
}

function nbMoveCellTo(ownerDoc, from, to){
  const model = ownerDoc && ownerDoc.notebookModel;
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const wrap = ownerDoc && ownerDoc._nbCellsWrap;
  if (!model || !wrap || from < 0 || to < 0 || from >= ctrls.length || to >= ctrls.length || from === to) return false;
  nbPushHistory(ownerDoc, "셀 이동");
  notebookMoveArrayItem(model.cells, from, to);
  notebookMoveArrayItem(ctrls, from, to);
  nbInvalidateCompletionCache(ownerDoc);
  const fragment = document.createDocumentFragment();
  for (const item of ctrls) fragment.appendChild(item.cellEl);
  wrap.appendChild(fragment);
  markNbDirty(ownerDoc);
  nbSetSelected(ownerDoc, to, { focusCell:true, scroll:true });
  return true;
}

// 셀 하나의 DOM·동작을 만든다(코드/마크다운/raw). 반환 ctrl 은 _nbCtrls 에 model.cells 와 같은 순서로 보관된다.
function nbBuildCell(ownerDoc, cell){
  const cellEl = document.createElement("div");
  cellEl.className = "nbv-cell nbv-cell-" + cell.type;
  cellEl.tabIndex = -1;
  const ctrl = { ownerDoc, type: cell.type, cell, cellEl, body: null, editor: null, runBtn: null,
    runCount: null, stateLabel: null, execState: null, outWrap: null,
    stdin: null, stdinWrap: null, refreshStdin: function(){}, stdinText: function(){ return ""; },
    prepareStdin: function(){ return true; }, clearStdin: function(){},
    edit: function(){}, setSource: function(source){ cell.source = String(source || ""); }, destroy: function(){} };

  // 셀 도구 모음(이동/타입/추가/삭제) — 호버·선택 시 노출. 인덱스는 호출 시점에 조회(셀이 이동·삭제되므로).
  const tools = document.createElement("div");
  tools.className = "nbv-tools";
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "셀 편집 도구");
  const tbtn = (label, title, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.title = title; b.tabIndex = -1;
    if (/^<svg/.test(label)){ b.innerHTML = label; b.setAttribute("aria-label", title); }  // 아이콘 전용 버튼은 단색 SVG
    else b.textContent = label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  const dragHandle = document.createElement("button");
  dragHandle.type = "button";
  dragHandle.className = "nbv-drag-handle";
  dragHandle.title = "셀을 드래그해 이동";
  dragHandle.setAttribute("aria-label", "셀을 드래그해 이동");
  dragHandle.draggable = true;
  dragHandle.innerHTML = NB_ICONS.grip;
  dragHandle.addEventListener("mousedown", (e) => e.stopPropagation());
  dragHandle.addEventListener("click", (e) => e.stopPropagation());
  dragHandle.addEventListener("dragstart", (e) => {
    const from = nbCtrlIndex(ownerDoc, ctrl);
    if (from < 0){ e.preventDefault(); return; }
    nbEnsureActionSelection(ownerDoc, ctrl);
    nbClearDragState(ownerDoc);
    ownerDoc._nbDrag = { ctrl, from, target:null, before:true };
    ctrl.cellEl.classList.add("nbv-dragging");
    if (e.dataTransfer){
      e.dataTransfer.effectAllowed = "copyMove";
      try { e.dataTransfer.setData("text/plain", String(cell.id || from)); } catch(_){}
      try {
        const snapshots = notebookCellClipboardSnapshot(nbSelectedCtrls(ownerDoc).map(item => item.cell));
        e.dataTransfer.setData("application/x-manneung-notebook-cells", JSON.stringify(snapshots));
      } catch(_){}
    }
    if (typeof window !== "undefined" && typeof window.openScratchpadForNotebookDrop === "function"){
      window.openScratchpadForNotebookDrop();
    }
  });
  dragHandle.addEventListener("dragend", () => nbClearDragState(ownerDoc));
  const collapsedBodyCells = ownerDoc
    ? (ownerDoc._nbCollapsedBodyCells instanceof Set ? ownerDoc._nbCollapsedBodyCells : (ownerDoc._nbCollapsedBodyCells = new Set()))
    : new Set();
  const bodyCollapseKey = String(cell.id || "");
  let bodyCollapse = null;
  const setBodyCollapsed = collapsed => {
    cellEl.classList.toggle("nbv-cell-collapsed", !!collapsed);
    if (bodyCollapseKey){
      if (collapsed) collapsedBodyCells.add(bodyCollapseKey);
      else collapsedBodyCells.delete(bodyCollapseKey);
    }
    if (bodyCollapse){
      bodyCollapse.textContent = collapsed ? "▸" : "▾";
      bodyCollapse.title = collapsed ? "셀 내용 펼치기" : "셀 내용 접기";
      bodyCollapse.setAttribute("aria-label", bodyCollapse.title);
      bodyCollapse.setAttribute("aria-expanded", String(!collapsed));
    }
  };
  bodyCollapse = tbtn("▾", "셀 내용 접기", () => setBodyCollapsed(!cellEl.classList.contains("nbv-cell-collapsed")));
  bodyCollapse.classList.add("nbv-cell-collapse");
  ctrl.setBodyCollapsed = setBodyCollapsed;
  const toolButtons = [
    dragHandle,
    bodyCollapse,
    tbtn(NB_ICONS.copy, "선택한 셀 복사 (Ctrl+C)", () => {
      nbEnsureActionSelection(ownerDoc, ctrl);
      nbCopySelectedCells(ownerDoc);
    }),
    tbtn(NB_ICONS.paste, "이 셀 아래에 붙여넣기 (Ctrl+V)", () => {
      nbEnsureActionSelection(ownerDoc, ctrl);
      nbPasteClipboardCells(ownerDoc);
    }),
    tbtn(NB_ICONS.memo, "선택한 셀을 임시 메모에 보관", () => {
      nbEnsureActionSelection(ownerDoc, ctrl);
      nbSaveSelectedCellsToScratchpad(ownerDoc);
    }),
    tbtn(NB_ICONS.up, "위로 이동", () => nbMoveCell(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), -1)),
    tbtn(NB_ICONS.down, "아래로 이동", () => nbMoveCell(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), 1)),
    tbtn(cell.type === "markdown" ? NB_ICONS.toCode : NB_ICONS.toText, cell.type === "markdown" ? "코드 셀로 변환" : "마크다운 셀로 변환",
      () => nbChangeType(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), cell.type === "markdown" ? "code" : "markdown")),
    tbtn(NB_ICONS.add, "아래에 코드 셀 추가", () => nbInsertCell(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), "code", { where: "below", edit: true }))
  ];
  if (cell.type === "code"){   // 코드 셀에만 '여기까지 실행' · '이 셀 출력 지우기'
    toolButtons.push(tbtn(NB_ICONS.runUpTo, "여기까지 실행 (이 셀 포함, 처음부터 순차 · 커널 상태 유지)", () => nbRunUpTo(ownerDoc, ctrl)));
    toolButtons.push(tbtn(NB_ICONS.clearOut, "이 셀의 출력 지우기(변수·상태는 유지)", () => nbClearCellOutput(ownerDoc, ctrl)));
  }
  toolButtons.push(tbtn(NB_ICONS.trash, "셀 삭제", () => nbDeleteCell(ownerDoc, nbCtrlIndex(ownerDoc, ctrl))));
  // 셀 도구 모음은 기본적으로 접혀 있고(펼치기 버튼만 노출), 사용자가 직접 펼친 셀만 기억한다.
  const expandedCells = ownerDoc
    ? (ownerDoc._nbExpandedToolCells instanceof Set ? ownerDoc._nbExpandedToolCells : (ownerDoc._nbExpandedToolCells = new Set()))
    : new Set();
  const collapseKey = String(cell.id || "");
  let toolsToggle = null;
  const setToolsCollapsed = (collapsed) => {
    tools.classList.toggle("nbv-tools-collapsed", collapsed);
    if (collapseKey){
      if (collapsed) expandedCells.delete(collapseKey);
      else expandedCells.add(collapseKey);
    }
    if (!toolsToggle) return;
    const title = collapsed ? "셀 편집 도구 펼치기" : "셀 편집 도구 접기";
    toolsToggle.innerHTML = collapsed ? NB_ICONS.expandTools : NB_ICONS.collapseTools;
    toolsToggle.title = title;
    toolsToggle.setAttribute("aria-label", title);
    toolsToggle.setAttribute("aria-expanded", String(!collapsed));
  };
  toolsToggle = tbtn(NB_ICONS.collapseTools, "셀 편집 도구 접기", () => {
    setToolsCollapsed(!tools.classList.contains("nbv-tools-collapsed"));
  });
  toolsToggle.classList.add("nbv-tools-toggle");
  toolButtons.push(toolsToggle);
  tools.append(...toolButtons);
  setToolsCollapsed(!(collapseKey && expandedCells.has(collapseKey)));   // 기본 접힘: 펼침으로 기억된 셀만 펼친다
  setBodyCollapsed(!!bodyCollapseKey && collapsedBodyCells.has(bodyCollapseKey));
  cellEl.appendChild(tools);
  cellEl.addEventListener("dragover", (e) => {
    const drag = ownerDoc && ownerDoc._nbDrag;
    const hasMemoCells = !drag && e.dataTransfer &&
      Array.from(e.dataTransfer.types || []).includes("application/x-manneung-notebook-cells");
    if (hasMemoCells){
      e.preventDefault();
      for (const item of (ownerDoc._nbCtrls || [])) item.cellEl.classList.remove("nbv-drop-before", "nbv-drop-after");
      const rect = cellEl.getBoundingClientRect();
      cellEl.classList.add(e.clientY < rect.top + rect.height / 2 ? "nbv-drop-before" : "nbv-drop-after");
      e.dataTransfer.dropEffect = "copy";
      return;
    }
    if (!drag || drag.ctrl === ctrl && (ownerDoc._nbCtrls || []).length <= 1) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = cellEl.getBoundingClientRect();
    nbSetDragTarget(ownerDoc, ctrl, e.clientY < rect.top + rect.height / 2);
  });
  cellEl.addEventListener("drop", (e) => {
    const drag = ownerDoc && ownerDoc._nbDrag;
    if (!drag && e.dataTransfer &&
        Array.from(e.dataTransfer.types || []).includes("application/x-manneung-notebook-cells")){
      e.preventDefault();
      e.stopPropagation();
      let snapshots = [];
      try { snapshots = JSON.parse(e.dataTransfer.getData("application/x-manneung-notebook-cells") || "[]"); } catch(_){}
      const target = nbCtrlIndex(ownerDoc, ctrl);
      const rect = cellEl.getBoundingClientRect();
      const at = target + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0);
      for (const item of (ownerDoc._nbCtrls || [])) item.cellEl.classList.remove("nbv-drop-before", "nbv-drop-after");
      nbInsertCellSnapshots(ownerDoc, snapshots, { at, message:"메모에서 셀 붙여넣기" });
      return;
    }
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const from = nbCtrlIndex(ownerDoc, drag.ctrl);
    const target = nbCtrlIndex(ownerDoc, ctrl);
    const before = drag.target === ctrl ? drag.before : true;
    let to = target + (before ? 0 : 1);
    if (from < to) to--;
    to = Math.max(0, Math.min((ownerDoc._nbCtrls || []).length - 1, to));
    nbClearDragState(ownerDoc);
    nbMoveCellTo(ownerDoc, from, to);
  });

  // 셀 여백 클릭 → 명령 모드 선택(에디터·도구 클릭은 제외)
  cellEl.addEventListener("mousedown", (e) => {
    if (e.target.closest && e.target.closest(".nbv-editor, .nbv-md-edit, .nbv-input, .nbv-tools, .nbv-run")) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault();
    nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {
      focusCell:true,
      toggle:!!(e.ctrlKey || e.metaKey),
      range:!!e.shiftKey
    });
  });

  if (cell.type === "code"){
    const runBtn = document.createElement("button");
    runBtn.type = "button"; runBtn.className = "nbv-run";
    runBtn.title = "이 셀 실행 (Ctrl+Enter · Shift+Enter=실행 후 다음)";
    const runCount = document.createElement("span");
    runCount.className = "nbv-run-count";
    const stateLabel = document.createElement("span");
    stateLabel.className = "nbv-exec-state";
    runBtn.append(runCount, stateLabel);
    runBtn.addEventListener("click", () => {
      if (runBtn.classList.contains("is-running")) nbStopExecution(ownerDoc);   // 실행 중이면 같은 버튼으로 정지
      else nbRunCell(ownerDoc, ctrl, false);
    });
    cellEl.appendChild(runBtn);

    const body = document.createElement("div"); body.className = "nbv-body";
    cellEl.appendChild(body);
    ctrl.body = body; ctrl.runBtn = runBtn; ctrl.runCount = runCount; ctrl.stateLabel = stateLabel; ctrl.active = false;

    const stdinValues = ownerDoc
      ? (ownerDoc._nbStdinValues instanceof Map ? ownerDoc._nbStdinValues : (ownerDoc._nbStdinValues = new Map()))
      : new Map();
    const stdinKey = String(cell.id || "");
    const inputWrap = document.createElement("div"); inputWrap.className = "nbv-input";
    const inputLabel = document.createElement("label");
    const inputField = document.createElement("div"); inputField.className = "nbv-input-field";
    const stdin = document.createElement("input"); stdin.className = "nbv-stdin"; stdin.type = "text";
    stdin.id = "nbv-stdin-" + nbNewId();
    stdin.placeholder = "값 입력 후 Enter";
    stdin.autocomplete = "off"; stdin.spellcheck = false;
    inputLabel.htmlFor = stdin.id;
    const inputValuesEl = document.createElement("div"); inputValuesEl.className = "nbv-input-values";
    const inputHint = document.createElement("div"); inputHint.className = "nbv-input-hint";
    const inputActions = document.createElement("div"); inputActions.className = "nbv-input-actions";
    const inputClear = document.createElement("button"); inputClear.type = "button"; inputClear.textContent = "다시 입력";
    const inputRun = document.createElement("button"); inputRun.type = "button"; inputRun.textContent = "입력 완료 후 실행";
    inputActions.append(inputClear, inputRun);
    inputField.append(inputValuesEl, stdin, inputHint, inputActions);
    inputWrap.append(inputLabel, inputField);
    const storedStdin = stdinKey ? stdinValues.get(stdinKey) : null;
    let inputValues = Array.isArray(storedStdin)
      ? storedStdin.map(value => String(value))
      : (typeof storedStdin === "string" && storedStdin ? storedStdin.split("\n") : []);
    let inputPlan = notebookInputPlan(cell.source);
    const inputPlanSignature = (plan) => JSON.stringify({
      predictable:plan.predictable,
      calls:plan.calls.map(call => call.prompt)
    });
    let inputSignature = inputPlanSignature(inputPlan);
    const inputPrompt = (index) => {
      const call = inputPlan.calls[index];
      const prompt = call && typeof call.prompt === "string" ? call.prompt.trim() : "";
      return prompt || ((index + 1) + "번째 입력값");
    };
    const storeStdin = () => {
      if (!stdinKey) return;
      if (inputValues.length) stdinValues.set(stdinKey, inputValues.slice());
      else stdinValues.delete(stdinKey);
    };
    const renderStdin = () => {
      const count = inputPlan.calls.length;
      inputWrap.hidden = !count;
      if (!count) return;
      const complete = inputPlan.predictable && inputValues.length >= count;
      inputValuesEl.textContent = "";
      inputValues.forEach((value, index) => {
        const item = document.createElement("span");
        item.className = "nbv-input-value";
        item.textContent = (index + 1) + ". " + inputPrompt(index) + " " + (value || "(빈 값)");
        inputValuesEl.appendChild(item);
      });
      const nextIndex = inputValues.length;
      inputLabel.textContent = complete ? "입력 준비 완료" : inputPrompt(nextIndex);
      stdin.hidden = complete;
      inputClear.hidden = !inputValues.length;
      inputRun.hidden = inputPlan.predictable;
      inputRun.disabled = !inputValues.length;
      inputHint.textContent = inputPlan.predictable
        ? (complete
          ? "준비한 값을 실행할 때마다 다시 사용합니다."
          : ((nextIndex + 1) + "/" + count + " · 값을 입력하고 Enter를 누르세요. 마지막 값에서 셀을 실행합니다."))
        : (inputValues.length + "개 준비 · 필요한 값을 모두 추가한 뒤 실행하세요.");
    };
    const commitStdin = (autoRun) => {
      inputValues.push(stdin.value);
      stdin.value = "";
      storeStdin();
      renderStdin();
      if (autoRun && inputPlan.predictable && inputValues.length >= inputPlan.calls.length){
        setTimeout(() => nbRunCell(ownerDoc, ctrl, false), 0);
      } else if (!stdin.hidden) stdin.focus();
    };
    const refreshStdin = () => {
      const nextPlan = notebookInputPlan(cell.source);
      const nextSignature = inputPlanSignature(nextPlan);
      if (nextSignature !== inputSignature){
        inputValues = [];
        inputSignature = nextSignature;
        storeStdin();
      }
      inputPlan = nextPlan;
      if (inputPlan.predictable && inputValues.length > inputPlan.calls.length){
        inputValues = inputValues.slice(0, inputPlan.calls.length);
        storeStdin();
      }
      renderStdin();
    };
    stdin.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      commitStdin(true);
    });
    stdin.addEventListener("focus", () => nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {}));
    const clearStdin = (focusInput) => {
      inputValues = []; stdin.value = ""; storeStdin(); renderStdin();
      if (focusInput && !stdin.hidden) stdin.focus();
    };
    inputClear.addEventListener("click", () => clearStdin(true));
    inputRun.addEventListener("click", () => nbRunCell(ownerDoc, ctrl, false));
    ctrl.stdin = stdin; ctrl.stdinWrap = inputWrap; ctrl.refreshStdin = refreshStdin;
    ctrl.stdinText = () => inputValues.join("\n");
    ctrl.clearStdin = () => clearStdin(false);
    ctrl.prepareStdin = () => {
      if (stdin.value !== "") commitStdin(false);
      if (!inputPlan.predictable || inputValues.length >= inputPlan.calls.length) return true;
      nbSetStatus(ownerDoc, "입력값 " + (inputValues.length + 1) + "/" + inputPlan.calls.length + "을 입력해 주세요.");
      stdin.focus();
      return false;
    };

    // 가상화: 기본은 정적 하이라이트(가벼움). 편집할 때만 실제 에디터를 마운트하고,
    // 화면에서 멀어지면 디마운트해 대형 노트북에서도 에디터 인스턴스 수를 제한한다.
    const makeStatic = () => {
      const pre = document.createElement("pre");
      pre.className = "nbv-static";
      pre.innerHTML = cell.source
        ? ((typeof highlightCode === "function") ? highlightCode(cell.source, "hash") : escapeForPre(cell.source))
        : '<span class="nbv-md-empty">빈 코드 셀 — 클릭해 편집</span>';
      pre.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey || e.shiftKey){
          nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {
            focusCell:true,
            toggle:!!(e.ctrlKey || e.metaKey),
            range:!!e.shiftKey
          });
          return;
        }
        nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {});
        ctrl.edit();
      });
      return pre;
    };
    ctrl.staticEl = makeStatic();
    body.appendChild(ctrl.staticEl);
    body.appendChild(inputWrap);
    refreshStdin();

    ctrl.mount = () => {
      if (ctrl.active) return;
      const ed = buildCodeEditor(cell.source, "hash", {
        completionPortal:true,
        completionContext:(currentSource) => notebookCompletionContext(
          ownerDoc && ownerDoc.notebookModel,
          cell,
          currentSource,
          nbCompletionCache(ownerDoc)
        )
      });
      ed.host.classList.add("nbv-editor");
      ctrl.staticEl.replaceWith(ed.host);
      ed.ta.addEventListener("input", () => {
        const nextSource = ed.getValue();
        if (nextSource !== cell.source){
          cell.source = nextSource;
          nbInvalidateCompletionCache(ownerDoc, cell);
        }
        refreshStdin();
        fitEditorHeight(ed);
        markNbDirty(ownerDoc);
      });
      ed.ta.addEventListener("focus", () => nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {}));
      requestAnimationFrame(() => fitEditorHeight(ed));
      ctrl.editor = ed; ctrl.active = true;
      ed.ta.readOnly = !!ownerDoc._nbInkMode;
    };
    ctrl.demount = () => {
      if (!ctrl.active || !ctrl.editor) return;
      cell.source = ctrl.editor.getValue();
      const pre = makeStatic();
      ctrl.editor.host.replaceWith(pre);
      try { ctrl.editor.destroy(); } catch(e){}
      ctrl.editor = null; ctrl.active = false; ctrl.staticEl = pre;
    };
    ctrl.edit = () => { ctrl.mount(); if (ctrl.editor) ctrl.editor.ta.focus(); };
    ctrl.setSource = (source) => {
      const nextSource = String(source == null ? "" : source);
      if (nextSource !== cell.source){
        cell.source = nextSource;
        nbInvalidateCompletionCache(ownerDoc, cell);
      }
      if (ctrl.editor) ctrl.editor.setValue(cell.source);
      else if (ctrl.staticEl) {
        ctrl.staticEl.innerHTML = cell.source
          ? ((typeof highlightCode === "function") ? highlightCode(cell.source, "hash") : escapeForPre(cell.source))
          : '<span class="nbv-md-empty">빈 코드 셀 — 클릭해 편집</span>';
      }
      refreshStdin();
    };
    ctrl.destroy = () => {
      if (ctrl.editor){ try { ctrl.editor.destroy(); } catch(e){} ctrl.editor = null; }
      if (ownerDoc._nbObserver){ try { ownerDoc._nbObserver.unobserve(cellEl); } catch(e){} }
    };

    if (cell.outputs && cell.outputs.length){
      ctrl.outWrap = document.createElement("div"); ctrl.outWrap.className = "nbv-out";
      renderCellOutputs(cell.outputs, ctrl.outWrap, ctrl);
      nbAttachOutputToggle(ownerDoc, ctrl, ctrl.outWrap);
      body.appendChild(ctrl.outWrap);
    }
    setRunState(ctrl, "idle");
    cellEl.__nbctrl = ctrl;
    const obs = nbEnsureObserver(ownerDoc);
    if (obs) try { obs.observe(cellEl); } catch(e){}
  } else if (cell.type === "markdown"){
    nbMountMarkdown(ctrl, ownerDoc);
  } else {
    const pre = document.createElement("pre"); pre.className = "nbv-raw"; pre.textContent = cell.source;
    cellEl.appendChild(pre);
    ctrl.setSource = (source) => { cell.source = String(source == null ? "" : source); pre.textContent = cell.source; };
  }
  const baseDestroy = ctrl.destroy;
  ctrl.inkSurface = nbCreateInkSurface(ownerDoc, ctrl);
  ctrl.destroy = () => {
    if (ctrl.inkSurface){ ctrl.inkSurface.cleanup(); ctrl.inkSurface = null; }
    baseDestroy();
  };
  ctrl.inkSurface.setDrawing(!!ownerDoc._nbInkMode && nbInkState(ownerDoc).tool !== "move");
  return ctrl;
}

// 마크다운 셀: 렌더 표시 ↔ 더블클릭/Enter 로 textarea 편집. 커밋(blur)에서 model 반영·재렌더. ctrl.edit 로 편집 진입.
function nbMountMarkdown(ctrl, ownerDoc){
  const cell = ctrl.cell;
  const view = document.createElement("div");
  view.className = "nbv-md md-host";
  const renderView = () => {
    view.innerHTML = cell.source.trim()
      ? ((typeof markdownToHtml === "function") ? markdownToHtml(cell.source, { allowHtml: true }) : escapeForPre(cell.source))
      : '<span class="nbv-md-empty">빈 마크다운 셀 — 더블클릭/Enter 로 편집</span>';
  };
  renderView();
  let editCtx = null;                     // 편집 중일 때만 {ta, draw, clear, commit, spotOwned}
  const enterEdit = () => {
    if (ctrl.cellEl.querySelector(".nbv-md-edit")) return;
    const wrap = document.createElement("div"); wrap.className = "nbv-md-editwrap"; wrap.style.position = "relative";
    const ta = document.createElement("textarea");
    ta.className = "nbv-md-edit"; ta.value = cell.source; ta.spellcheck = false;
    const preview = document.createElement("div"); preview.className = "md-host nbv-md-preview";
    // 노트북 전체 찾기 강조(주황 박스)를 얹는 오버레이 — textarea 위에 겹치고 입력은 통과시킨다.
    const layer = document.createElement("div"); layer.className = "nbv-md-spotlayer"; layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2";
    const grow = () => { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; };
    const updatePreview = () => {
      preview.innerHTML = ta.value.trim()
        ? ((typeof markdownToHtml === "function") ? markdownToHtml(ta.value, { allowHtml: true }) : escapeForPre(ta.value))
        : '<span class="nbv-md-empty">미리보기</span>';
    };
    const sync = () => {
      if (ta.value !== cell.source){ cell.source = ta.value; markNbDirty(ownerDoc); }
    };
    const clearSpot = () => { layer.textContent = ""; };
    // textarea 와 똑같은 줄바꿈으로 매치 위치를 재는 거울(mirror) 기법 — 워드랩·한글 폭까지 정확히 맞춘다.
    const drawSpot = (start, end) => {
      clearSpot();
      const v = ta.value;
      start = Math.max(0, Math.min(start, v.length));
      end = Math.max(start, Math.min(end, v.length));
      const cs = getComputedStyle(ta);
      const mirror = document.createElement("div");
      ["fontFamily","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","textIndent","tabSize",
       "paddingTop","paddingRight","paddingBottom","paddingLeft",
       "borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth"].forEach(p => { mirror.style[p] = cs[p]; });
      mirror.style.cssText += ";position:fixed;visibility:hidden;pointer-events:none;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word";
      const rect = ta.getBoundingClientRect();
      mirror.style.left = rect.left + "px"; mirror.style.top = rect.top + "px"; mirror.style.width = rect.width + "px";
      const span = document.createElement("span");
      span.textContent = v.slice(start, end) || "​";
      mirror.append(document.createTextNode(v.slice(0, start)), span, document.createTextNode(v.slice(end)));
      document.body.appendChild(mirror);
      const wrapRect = wrap.getBoundingClientRect();
      for (const r of span.getClientRects()){
        const box = document.createElement("div");
        box.className = "find-hi find-hi-active";
        box.style.cssText = "left:" + (r.left - wrapRect.left) + "px;top:" + (r.top - wrapRect.top) +
                            "px;width:" + Math.max(2, r.width) + "px;height:" + r.height + "px";
        layer.appendChild(box);
      }
      mirror.remove();
    };
    const commit = () => { editCtx = null; sync(); renderView(); wrap.replaceWith(view); };
    ta.addEventListener("input", () => { clearSpot(); sync(); grow(); updatePreview(); });
    ta.addEventListener("blur", (e) => {
      const to = e.relatedTarget;
      if (to && to.closest && to.closest(".nbv-find")) return;   // 노트북 찾기창으로 포커스가 간 경우엔 편집·강조를 유지
      commit();
    });
    wrap.append(ta, preview, layer);
    view.replaceWith(wrap); ta.focus(); grow(); updatePreview();
    editCtx = { ta, draw: drawSpot, clear: clearSpot, commit, spotOwned: false };
  };
  view.addEventListener("dblclick", enterEdit);
  ctrl.cellEl.appendChild(view);
  ctrl.edit = enterEdit;
  // 노트북 전체 찾기용 — 코드 셀의 editor.spotlightRange 와 대응(ctrl 레벨).
  ctrl.spotlightRange = (start, end) => {
    const already = !!editCtx;
    enterEdit();
    if (editCtx){
      if (!already) editCtx.spotOwned = true;    // 강조 때문에 우리가 편집 모드로 진입한 셀은 강조 해제 시 되돌린다
      editCtx.draw(start, end);
    }
  };
  ctrl.clearSpotlight = () => {
    if (!editCtx) return;
    editCtx.clear();
    if (editCtx.spotOwned) editCtx.commit();       // 사용자가 직접 편집 중인 셀은 건드리지 않는다
  };
  ctrl.setSource = (source) => {
    cell.source = String(source == null ? "" : source);
    const textarea = ctrl.cellEl.querySelector(".nbv-md-edit");
    if (textarea){
      textarea.value = cell.source;
      textarea.dispatchEvent(new Event("input", { bubbles:true }));
    } else renderView();
  };
}

function nbNewId(){ return "cell-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function nbCtrlIndex(ownerDoc, ctrl){ return (ownerDoc._nbCtrls || []).indexOf(ctrl); }

// ── 선택/모드 ──
function nbSelectionSet(ownerDoc){
  if (!ownerDoc._nbCellSelection) ownerDoc._nbCellSelection = new Set();
  return ownerDoc._nbCellSelection;
}

function nbSelectedCtrls(ownerDoc){
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const selected = ownerDoc ? nbSelectionSet(ownerDoc) : new Set();
  const ordered = ctrls.filter(ctrl => selected.has(ctrl.cell));
  if (ordered.length) return ordered;
  const primary = ctrls[ownerDoc && ownerDoc._nbSelected];
  return primary ? [primary] : [];
}

function nbRefreshSelection(ownerDoc){
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const selected = nbSelectionSet(ownerDoc);
  ctrls.forEach((ctrl, index) => {
    const inSelection = selected.has(ctrl.cell);
    ctrl.cellEl.classList.toggle("nbv-selected", index === ownerDoc._nbSelected);
    ctrl.cellEl.classList.toggle("nbv-multi-selected", inSelection);
    ctrl.cellEl.setAttribute("aria-selected", String(inSelection));
  });
}

function nbSetSelectionCells(ownerDoc, cells, primaryCell=null, focus=true){
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const available = new Set(ctrls.map(ctrl => ctrl.cell));
  const selected = nbSelectionSet(ownerDoc);
  selected.clear();
  for (const cell of (cells || [])) if (available.has(cell)) selected.add(cell);
  let primaryIndex = ctrls.findIndex(ctrl => ctrl.cell === primaryCell);
  if (primaryIndex < 0) primaryIndex = ctrls.findIndex(ctrl => selected.has(ctrl.cell));
  if (primaryIndex < 0 && ctrls.length){
    primaryIndex = 0;
    selected.add(ctrls[0].cell);
  }
  ownerDoc._nbSelected = primaryIndex;
  ownerDoc._nbSelectionAnchor = primaryIndex >= 0 ? ctrls[primaryIndex].cell : null;
  nbRefreshSelection(ownerDoc);
  const primary = ctrls[primaryIndex];
  if (focus && primary){
    try { primary.cellEl.focus({ preventScroll:true }); } catch(_){ try { primary.cellEl.focus(); } catch(__){} }
    primary.cellEl.scrollIntoView({ block:"nearest" });
  }
}

function nbSetSelected(ownerDoc, idx, opts){
  opts = opts || {};
  const ctrls = ownerDoc._nbCtrls || [];
  const sel = ctrls[idx];
  if (!sel) return;
  const selected = nbSelectionSet(ownerDoc);
  if (opts.range){
    const anchorIndex = Math.max(0, ctrls.findIndex(ctrl => ctrl.cell === ownerDoc._nbSelectionAnchor));
    selected.clear();
    for (let i = Math.min(anchorIndex, idx); i <= Math.max(anchorIndex, idx); i++) selected.add(ctrls[i].cell);
  } else if (opts.toggle){
    if (selected.has(sel.cell) && selected.size > 1){
      selected.delete(sel.cell);
      const fallback = [...ctrls].reverse().find(ctrl => selected.has(ctrl.cell));
      idx = fallback ? ctrls.indexOf(fallback) : idx;
    } else {
      selected.add(sel.cell);
      ownerDoc._nbSelectionAnchor = sel.cell;
    }
  } else {
    selected.clear();
    selected.add(sel.cell);
    ownerDoc._nbSelectionAnchor = sel.cell;
  }
  ownerDoc._nbSelected = idx;
  if (!selected.has(ctrls[idx].cell)) selected.add(ctrls[idx].cell);
  nbRefreshSelection(ownerDoc);
  const primary = ctrls[idx];
  if (primary){
    if (opts.focusCell){ try { primary.cellEl.focus({ preventScroll: true }); } catch(e){ try { primary.cellEl.focus(); } catch(_){} } }
    if (opts.scroll){
      const block = ["start", "center", "end", "nearest"].includes(opts.scrollBlock) ? opts.scrollBlock : "nearest";
      primary.cellEl.scrollIntoView({ block });
    }
  }
}

function nbEnsureActionSelection(ownerDoc, ctrl){
  if (!ownerDoc || !ctrl) return;
  if (!nbSelectionSet(ownerDoc).has(ctrl.cell)) nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {});
}

function nbCopySelectedCells(ownerDoc){
  const selected = nbSelectedCtrls(ownerDoc);
  if (!selected.length) return false;
  _notebookCellClipboard = notebookCellClipboardSnapshot(selected.map(ctrl => ctrl.cell));
  const message = selected.length + "개 셀을 복사했어요.";
  nbSetStatus(ownerDoc, message);
  if (typeof toast === "function") toast(message, 1600);
  return true;
}

function nbSaveSelectedCellsToScratchpad(ownerDoc){
  const selected = nbSelectedCtrls(ownerDoc);
  if (!selected.length) return false;
  if (typeof window === "undefined" || typeof window.addNotebookCellsToScratchpad !== "function"){
    if (typeof toast === "function") toast("임시 메모를 사용할 수 없습니다.", 1800);
    return false;
  }
  const snapshots = notebookCellClipboardSnapshot(selected.map(ctrl => ctrl.cell));
  const added = window.addNotebookCellsToScratchpad(snapshots);
  if (!added) return false;
  const message = added + "개 셀을 임시 메모에 보관했어요.";
  nbSetStatus(ownerDoc, message);
  if (typeof toast === "function") toast(message, 1800);
  return true;
}

function nbRemoveSelectedCells(ownerDoc, selectedCtrls){
  const model = ownerDoc && ownerDoc.notebookModel;
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const wrap = ownerDoc && ownerDoc._nbCellsWrap;
  const chosen = (selectedCtrls || []).filter(ctrl => ctrls.includes(ctrl));
  if (!model || !wrap || !chosen.length) return false;
  const indices = chosen.map(ctrl => ctrls.indexOf(ctrl)).sort((a, b) => a - b);
  const nextIndex = Math.min(indices[0], Math.max(0, ctrls.length - chosen.length - 1));
  for (let i = indices.length - 1; i >= 0; i--){
    const index = indices[i];
    const ctrl = ctrls[index];
    try { ctrl.destroy && ctrl.destroy(); } catch(_){}
    ctrl.cellEl.remove();
    ctrls.splice(index, 1);
    model.cells.splice(index, 1);
  }
  if (!ctrls.length){
    const cell = { id:nbNewId(), type:"code", source:"", execCount:null, outputs:[], rawOutputs:[], metadata:{} };
    model.cells.push(cell);
    const ctrl = nbBuildCell(ownerDoc, cell);
    ctrls.push(ctrl);
    wrap.appendChild(ctrl.cellEl);
  }
  nbInvalidateCompletionCache(ownerDoc);
  markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
  nbSetSelectionCells(ownerDoc, [ctrls[Math.min(nextIndex, ctrls.length - 1)].cell], null, true);
  return true;
}

function nbCutSelectedCells(ownerDoc){
  const selected = nbSelectedCtrls(ownerDoc);
  if (!selected.length) return false;
  nbPushHistory(ownerDoc, selected.length + "개 셀 잘라내기");
  _notebookCellClipboard = notebookCellClipboardSnapshot(selected.map(ctrl => ctrl.cell));
  if (!nbRemoveSelectedCells(ownerDoc, selected)) return false;
  const message = selected.length + "개 셀을 잘라냈어요.";
  nbSetStatus(ownerDoc, message);
  if (typeof toast === "function") toast(message, 1600);
  return true;
}

function nbPasteClipboardCells(ownerDoc){
  if (!_notebookCellClipboard.length){
    const message = "복사한 셀이 없습니다.";
    nbSetStatus(ownerDoc, message);
    if (typeof toast === "function") toast(message, 1600);
    return false;
  }
  return nbInsertCellSnapshots(ownerDoc, _notebookCellClipboard, {
    message:_notebookCellClipboard.length + "개 셀 붙여넣기"
  });
}

function nbInsertCellSnapshots(ownerDoc, snapshots, options={}){
  const model = ownerDoc && ownerDoc.notebookModel;
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const wrap = ownerDoc && ownerDoc._nbCellsWrap;
  const safeSnapshots = notebookCellClipboardSnapshot(notebookMaterializeClipboardCells(snapshots));
  if (!model || !wrap || !safeSnapshots.length) return false;
  nbPushHistory(ownerDoc, options.message || (safeSnapshots.length + "개 셀 붙여넣기"));
  const selected = nbSelectedCtrls(ownerDoc);
  const selectedIndices = selected.map(ctrl => ctrls.indexOf(ctrl)).filter(index => index >= 0);
  const fallbackAt = selectedIndices.length ? Math.max(...selectedIndices) + 1 : Math.max(0, ownerDoc._nbSelected + 1);
  const at = Number.isInteger(options.at)
    ? Math.max(0, Math.min(ctrls.length, options.at))
    : fallbackAt;
  const cells = notebookMaterializeClipboardCells(safeSnapshots);
  const newCtrls = cells.map(cell => nbBuildCell(ownerDoc, cell));
  model.cells.splice(at, 0, ...cells);
  const reference = ctrls[at] ? ctrls[at].cellEl : null;
  const fragment = document.createDocumentFragment();
  newCtrls.forEach(ctrl => fragment.appendChild(ctrl.cellEl));
  wrap.insertBefore(fragment, reference);
  ctrls.splice(at, 0, ...newCtrls);
  nbInvalidateCompletionCache(ownerDoc);
  markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
  nbSetSelectionCells(ownerDoc, cells, cells[cells.length - 1], true);
  const message = cells.length + "개 셀을 붙여넣었어요.";
  nbSetStatus(ownerDoc, message);
  if (typeof toast === "function") toast(message, 1600);
  return true;
}
function nbSelectCell(ownerDoc, idx, scrollBlock){
  const ctrls = ownerDoc._nbCtrls || [];
  if (!ctrls.length) return;
  idx = Math.max(0, Math.min(ctrls.length - 1, idx));
  nbSetSelected(ownerDoc, idx, { focusCell: true, scroll: true, scrollBlock });
}
function nbEnterEdit(ownerDoc, idx, scrollBlock){
  const ctrl = (ownerDoc._nbCtrls || [])[idx];
  if (!ctrl) return;
  nbSetSelected(ownerDoc, idx, { scroll: true, scrollBlock });
  if (typeof ctrl.edit === "function") ctrl.edit();
}

// ── 명령/편집 모드 키보드 ──
function nbOnKeydown(ownerDoc, e){
  // Esc: 열려 있는 모든 검색창(노트북 전체 + 각 셀)을 한 번에 닫는다.
  if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && nbAnyFindOpen(ownerDoc)){
    e.preventDefault(); e.stopPropagation(); nbCloseAllFinds(ownerDoc); return;
  }
  // Ctrl+H = 노트북 전체 찾기·바꾸기, Ctrl+Shift+H = 현재 셀 안에서 찾기·바꾸기 (capture 단계라 셀 편집기보다 먼저 가로챔)
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "h" || e.key === "H")){
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) nbOpenCellFind(ownerDoc); else nbOpenNotebookFind(ownerDoc);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "S")){
    e.preventDefault(); e.stopPropagation(); saveNotebook(ownerDoc); return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "=" || e.key === "+")){
    e.preventDefault(); e.stopPropagation(); bumpCodeFont(1); return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "-"){
    e.preventDefault(); e.stopPropagation(); bumpCodeFont(-1); return;
  }
  if (ownerDoc._nbInkMode && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z")){
    e.preventDefault(); e.stopPropagation(); nbUndoInk(ownerDoc); return;
  }
  if (ownerDoc._nbInkMode && e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey){
    e.preventDefault(); e.stopPropagation();
    nbClearAllInk(ownerDoc, { silent:true }); nbSetInkMode(ownerDoc, false); return;
  }
  if (e.target.closest && e.target.closest(".nbv-find")) return;
  if (typeof shortcutMatches === "function" && shortcutMatches(e, "runNotebook")){
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) nbRunAll(ownerDoc);
    return;
  }
  const ctrls = ownerDoc._nbCtrls || [];
  const idx = ownerDoc._nbSelected;
  const inEditor = !!(e.target.closest && e.target.closest(".nbv-editor, .nbv-md-edit, .nbv-stdin"));
  if (!inEditor && (e.ctrlKey || e.metaKey) && !e.altKey){
    const command = String(e.key || "").toLowerCase();
    if (command === "z"){
      e.preventDefault(); e.stopPropagation();
      nbRestoreHistory(ownerDoc, e.shiftKey ? "redo" : "undo");
      return;
    }
    if (command === "y" && !e.shiftKey){
      e.preventDefault(); e.stopPropagation();
      nbRestoreHistory(ownerDoc, "redo");
      return;
    }
  }

  // 실행(편집·명령 공통)
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey){
    if (idx >= 0){ e.preventDefault(); e.stopPropagation(); nbRunByIndex(ownerDoc, idx, false); } return;
  }
  if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){
    if (idx >= 0){ e.preventDefault(); e.stopPropagation(); nbRunByIndex(ownerDoc, idx, true); } return;
  }

  if (inEditor){
    if (e.key === "Escape"){
      // 자동완성 목록이 떠 있으면 편집기 자신이 ESC 로 목록만 닫도록 넘긴다(커서 유지, 셀 이탈 금지).
      const ed = (ctrls[idx] && ctrls[idx].editor) || null;
      if (ed && typeof ed.isCompletionOpen === "function" && ed.isCompletionOpen()) return;
      e.preventDefault(); e.stopPropagation();
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch(_){}
      nbSetSelected(ownerDoc, idx >= 0 ? idx : 0, { focusCell: true });
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")){
      e.preventDefault(); e.stopPropagation();
      const ni = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (ni >= 0 && ni < ctrls.length) nbEnterEdit(ownerDoc, ni);
    }
    return;
  }

  // 명령 모드
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey){
    const command = String(e.key || "").toLowerCase();
    if (command === "c"){
      e.preventDefault(); e.stopPropagation(); nbCopySelectedCells(ownerDoc); return;
    }
    if (command === "x"){
      e.preventDefault(); e.stopPropagation(); nbCutSelectedCells(ownerDoc); return;
    }
    if (command === "v"){
      e.preventDefault(); e.stopPropagation(); nbPasteClipboardCells(ownerDoc); return;
    }
  }
  if (idx < 0) return;
  const k = e.key;
  if (k === "Enter"){ e.preventDefault(); nbEnterEdit(ownerDoc, idx); }
  else if (e.shiftKey && (k === "ArrowUp" || k === "ArrowDown")){
    e.preventDefault();
    const next = Math.max(0, Math.min(ctrls.length - 1, idx + (k === "ArrowDown" ? 1 : -1)));
    nbSetSelected(ownerDoc, next, { focusCell:true, scroll:true, range:true });
  }
  else if (k === "ArrowUp" || k === "k"){ e.preventDefault(); nbSelectCell(ownerDoc, idx - 1); }
  else if (k === "ArrowDown" || k === "j"){ e.preventDefault(); nbSelectCell(ownerDoc, idx + 1); }
  else if (k === "a" || k === "A"){ e.preventDefault(); nbInsertCell(ownerDoc, idx, "code", { where: "above", edit: true }); }
  else if (k === "b" || k === "B"){ e.preventDefault(); nbInsertCell(ownerDoc, idx, "code", { where: "below", edit: true }); }
  else if (k === "m" || k === "M"){ e.preventDefault(); nbChangeType(ownerDoc, idx, "markdown"); }
  else if (k === "y" || k === "Y"){ e.preventDefault(); nbChangeType(ownerDoc, idx, "code"); }
  else if (k === "d" || k === "D"){
    e.preventDefault();
    if (ownerDoc._nbDPending){ clearTimeout(ownerDoc._nbDTimer); ownerDoc._nbDPending = false; nbDeleteCell(ownerDoc, idx); }
    else { ownerDoc._nbDPending = true; ownerDoc._nbDTimer = setTimeout(() => { ownerDoc._nbDPending = false; }, 700); }
  }
}

function nbRunByIndex(ownerDoc, idx, advance){
  const ctrl = (ownerDoc._nbCtrls || [])[idx];
  if (!ctrl) return;
  if (ctrl.type === "code"){ nbRunCell(ownerDoc, ctrl, advance); return; }
  // 마크다운/raw: 편집 중이면 커밋(blur), advance 면 다음 셀 선택
  try { const a = document.activeElement; if (a && a.closest && a.closest(".nbv-md-edit")) a.blur(); } catch(_){}
  if (advance) nbSelectCell(ownerDoc, idx + 1);
}

// ── 셀 조작 ──
function nbInsertCell(ownerDoc, idx, type, opts){
  opts = opts || {};
  const model = ownerDoc.notebookModel, ctrls = ownerDoc._nbCtrls || [], wrap = ownerDoc._nbCellsWrap;
  if (!model || !wrap) return;
  nbPushHistory(ownerDoc, (type === "markdown" ? "마크다운" : "코드") + " 셀 추가");
  const at = (opts.where === "above") ? Math.max(0, idx) : idx + 1;
  const cell = { id: nbNewId(), type: type || "code", source: "", execCount: null, outputs: [], rawOutputs: [], metadata: {} };
  model.cells.splice(at, 0, cell);
  nbInvalidateCompletionCache(ownerDoc);
  const ctrl = nbBuildCell(ownerDoc, cell);
  const ref = ctrls[at] ? ctrls[at].cellEl : null;
  wrap.insertBefore(ctrl.cellEl, ref);
  ctrls.splice(at, 0, ctrl);
  markNbDirty(ownerDoc);
  if (opts.edit) nbEnterEdit(ownerDoc, at, opts.scrollBlock); else nbSetSelected(ownerDoc, at, { focusCell: true, scroll: true, scrollBlock: opts.scrollBlock });
}

function nbDeleteCell(ownerDoc, idx){
  const model = ownerDoc.notebookModel, ctrls = ownerDoc._nbCtrls || [];
  const ctrl = ctrls[idx];
  if (!model || !ctrl) return;
  nbPushHistory(ownerDoc, "셀 삭제");
  if (model.cells.length <= 1){   // 마지막 한 셀은 지우지 않고 비운다(빈 노트북 방지)
    ctrl.cell.source = "";
    nbInvalidateCompletionCache(ownerDoc);
    ctrl.cell.execCount = null;
    ctrl.cell.rawOutputs = [];
    ctrl.cell.outputs = [];
    notebookClearExecution(ctrl.cell);
    if (ctrl.editor) ctrl.editor.setValue("");
    if (ctrl.stdin){
      ctrl.clearStdin();
      ctrl.refreshStdin();
    }
    if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
    if (ctrl.runBtn) setRunState(ctrl, "idle");
    markNbDirty(ownerDoc); return;
  }
  try { ctrl.destroy && ctrl.destroy(); } catch(e){}
  if (ownerDoc._nbExpandedToolCells instanceof Set) ownerDoc._nbExpandedToolCells.delete(String(ctrl.cell.id || ""));
  if (ownerDoc._nbStdinValues instanceof Map) ownerDoc._nbStdinValues.delete(String(ctrl.cell.id || ""));
  ctrl.cellEl.remove();
  model.cells.splice(idx, 1);
  ctrls.splice(idx, 1);
  nbInvalidateCompletionCache(ownerDoc);
  markNbDirty(ownerDoc);
  nbSelectCell(ownerDoc, Math.min(idx, ctrls.length - 1));
}

function nbMoveCell(ownerDoc, idx, dir){
  nbMoveCellTo(ownerDoc, idx, idx + dir);
}

function nbChangeType(ownerDoc, idx, type){
  const ctrls = ownerDoc._nbCtrls || [], wrap = ownerDoc._nbCellsWrap;
  const old = ctrls[idx];
  if (!old || !wrap || old.cell.type === type) return;
  nbPushHistory(ownerDoc, "셀 형식 변경");
  old.cell.type = type;
  nbInvalidateCompletionCache(ownerDoc);
  notebookClearExecution(old.cell);
  old.cell.execCount = null;
  old.cell.rawOutputs = [];
  old.cell.outputs = [];
  const fresh = nbBuildCell(ownerDoc, old.cell);
  wrap.insertBefore(fresh.cellEl, old.cellEl);
  try { old.destroy && old.destroy(); } catch(e){}
  old.cellEl.remove();
  ctrls[idx] = fresh;
  markNbDirty(ownerDoc);
  nbSetSelected(ownerDoc, idx, { focusCell: true });
}

// 코드 셀 에디터 높이를 내용 줄 수에 맞춘다(최소 1줄, 최대 640px 후 내부 스크롤).
function fitEditorHeight(ed){
  const lines = (ed.ta.value.match(/\n/g) || []).length + 1;
  const lh = parseFloat(getComputedStyle(ed.ta).lineHeight) || 21;
  const h = Math.min(Math.max(lines * lh + 34, lh + 34), 640);
  ed.host.style.height = h + "px";
}

function markNbDirty(ownerDoc){
  if (!ownerDoc) return;
  ownerDoc.hasUnsavedEdits = true;
  notebookSetAutosaveState(ownerDoc, "");
  if (typeof updateDocumentStatus === "function") updateDocumentStatus(ownerDoc);
  updateNbSaveButton(ownerDoc, ownerDoc._nbSaveBtn);
  nbScheduleExecutionStateRefresh(ownerDoc);
  notebookScheduleRecovery(ownerDoc);
  notebookScheduleAutosave(ownerDoc);
  nbScheduleTocRefresh(ownerDoc);
}

function updateNbSaveButton(ownerDoc, btn){
  if (!btn) return;
  const dirty = !!(ownerDoc && ownerDoc.hasUnsavedEdits);
  const autosaveState = ownerDoc && ownerDoc._nbAutosaveState;
  btn.textContent = autosaveState === "saving" ? "저장 중…"
    : autosaveState === "failed" ? "저장 실패"
    : dirty ? "저장 *" : "저장";
  btn.title = autosaveState === "saving" ? "노트북을 자동 저장하는 중입니다."
    : autosaveState === "failed" ? "자동 저장에 실패했습니다. 복구본은 유지되며 저장 버튼으로 다시 시도할 수 있습니다."
    : dirty ? "저장되지 않은 변경 내용이 있습니다." : "노트북 저장";
  btn.classList.toggle("is-dirty", dirty);
}

// 모델 → .ipynb 직렬화 후 기존 저장 경로(saveTextDoc: 원본 파일/서버/다운로드)로 기록.
async function saveNotebook(ownerDoc){
  if (!ownerDoc || !ownerDoc.notebookModel) return;
  clearTimeout(ownerDoc._nbAutosaveTimer);
  ownerDoc._nbAutosaveTimer = 0;
  ownerDoc._nbAutosaveAgain = false;
  if (ownerDoc._nbAutosaveSaving) await ownerDoc._nbAutosaveSaving;
  nbSyncFindModel(ownerDoc);
  const text = modelToIpynb(ownerDoc.notebookModel);
  const name = ownerDoc.name || "notebook.ipynb";
  let ok = false;
  try { ok = (typeof saveTextDoc === "function") ? await saveTextDoc(text, ownerDoc, name) : false; }
  catch(e){ console.error(e); }
  if (ok){
    notebookSetAutosaveState(ownerDoc, "");
    ownerDoc.savedText = text;
    const savedName = ownerDoc.name || name;
    const savedPath = normalizedRunPath(ownerDoc.workspacePath || savedName);
    if (typeof rememberWorkspace === "function"){
      try {
        const updated = new File([text], savedName, { type:"application/x-ipynb+json" });
        if (savedPath.indexOf("/") >= 0){
          Object.defineProperty(updated, "webkitRelativePath", { value:savedPath });
        }
        ownerDoc.savedInWorkspace = await rememberWorkspace([updated], false, { silent:true });
      } catch(e){
        console.warn("notebook workspace save skipped:", e);
        ownerDoc.savedInWorkspace = false;
      }
    }
    ownerDoc.hasUnsavedEdits = modelToIpynb(ownerDoc.notebookModel) !== text;
    if (typeof updateDocumentStatus === "function") updateDocumentStatus(ownerDoc);
    updateNbSaveButton(ownerDoc, ownerDoc._nbSaveBtn);
    if (typeof renderSidebar === "function") renderSidebar();
    await notebookDeleteRecovery(ownerDoc);
  }
}

function destroyNotebook(ownerDoc){
  nbClearDragState(ownerDoc);
  if (ownerDoc) nbSetInkMode(ownerDoc, false);
  if (ownerDoc && typeof ownerDoc._nbLocalCancel === "function"){
    try { ownerDoc._nbLocalCancel(); } catch(_){}
  }
  if (ownerDoc && ownerDoc._nbLocalKernelId){
    nbStopLocalNotebookKernel(ownerDoc, { keepalive:true });
  }
  if (ownerDoc){
    clearTimeout(ownerDoc._nbAutosaveTimer);
    ownerDoc._nbAutosaveTimer = 0;
    ownerDoc._nbAutosaveAgain = false;
  }
  if (ownerDoc && ownerDoc._nbStateRefresh && typeof cancelAnimationFrame === "function"){
    cancelAnimationFrame(ownerDoc._nbStateRefresh);
    ownerDoc._nbStateRefresh = 0;
  }
  if (ownerDoc && ownerDoc._nbObserver){ try { ownerDoc._nbObserver.disconnect(); } catch(e){} ownerDoc._nbObserver = null; }
  if (ownerDoc && ownerDoc._nbFontHost){
    unregisterEditorFont(ownerDoc._nbFontHost);
    ownerDoc._nbFontHost.__refreshFontMetrics = null;
    ownerDoc._nbFontHost = null;
  }
  if (ownerDoc) ownerDoc._nbFind = null;
  if (!ownerDoc || !Array.isArray(ownerDoc._nbCtrls)) return;
  if (ownerDoc._nbActiveTask && typeof ownerDoc._nbActiveTask.cancel === "function"){
    try { ownerDoc._nbActiveTask.cancel(); } catch(_){}
  }
  for (const c of ownerDoc._nbCtrls){ try { c.destroy && c.destroy(); } catch(e){} }
  ownerDoc._nbCtrls = null;
  ownerDoc._nbFreshRunBtn = null;
  ownerDoc._nbRunMoreBtn = null;
  ownerDoc._nbRunAllBtn = null;
  ownerDoc._nbRunGroup = null;
  ownerDoc._nbKernelTag = null;
  ownerDoc._nbLocalKernelBtn = null;
  ownerDoc._nbLocalRunBtn = null;
  ownerDoc._nbUndoBtn = null;
  ownerDoc._nbRedoBtn = null;
  ownerDoc._nbTocButton = null;
  ownerDoc._nbTocList = null;
  if (ownerDoc._nbTocRefresh){
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(ownerDoc._nbTocRefresh);
    else clearTimeout(ownerDoc._nbTocRefresh);
    ownerDoc._nbTocRefresh = 0;
  }
  ownerDoc._nbActiveTask = null;
  ownerDoc._nbRunAllActive = false;
  ownerDoc._nbCancelRequested = false;
  ownerDoc._nbInkButton = null;
  ownerDoc._nbInkToolbar = null;
  ownerDoc._nbInkTarget = null;
  ownerDoc._nbRoot = null;
}

// ── 가상화: 화면에서 충분히 멀어진(마운트된) 코드 셀을 정적 표시로 되돌려 에디터 수를 제한 ──
function nbEnsureObserver(ownerDoc){
  if (ownerDoc._nbObserver) return ownerDoc._nbObserver;
  if (typeof IntersectionObserver === "undefined") return null;
  ownerDoc._nbObserver = new IntersectionObserver((entries) => {
    for (const en of entries){
      if (en.isIntersecting) continue;
      const ctrl = en.target.__nbctrl;
      if (ctrl && ctrl.type === "code" && ctrl.active) nbMaybeDemount(ownerDoc, ctrl);
    }
  }, { root: null, rootMargin: "1200px 0px" });
  return ownerDoc._nbObserver;
}
function nbMaybeDemount(ownerDoc, ctrl){
  if (!ctrl.active) return;
  if (nbCtrlIndex(ownerDoc, ctrl) === ownerDoc._nbSelected) return;          // 선택된 셀은 유지
  if (ctrl.cellEl.contains(document.activeElement)) return;                  // 포커스 있는 셀은 유지
  ctrl.demount();
}

function nbFocusCellLine(ctrl, line){
  if (!ctrl || !line) return;
  if (ctrl.setBodyCollapsed) ctrl.setBodyCollapsed(false);
  const ownerDoc = ctrl.ownerDoc;
  if (ownerDoc) nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), { scroll:true });
  if (ctrl.edit) ctrl.edit();
  requestAnimationFrame(() => {
    if (ctrl.editor && ctrl.editor.focusLine) ctrl.editor.focusLine(line);
  });
}

function renderNotebookError(host, value, ctrl){
  const text = String(value || "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  const box = document.createElement("div");
  box.className = "nbv-out-error-box";
  // 초보자용 오류 해설 카드 — 흔한 예외를 한국어로 풀어 준다(일반 Python 뷰어와 같은 explainPythonError 사용).
  const help = (typeof explainPythonError === "function") ? explainPythonError(text) : null;
  if (help){
    const card = document.createElement("section");
    card.className = "py-error-help nbv-error-help";
    const title = document.createElement("strong"); title.textContent = help.title;
    const type = document.createElement("code"); type.textContent = help.type;
    const head = document.createElement("div"); head.className = "py-error-help-head"; head.append(title, type);
    const tip = document.createElement("p"); tip.textContent = help.tip;
    card.append(head, tip);
    box.appendChild(card);
  }
  const pre = document.createElement("pre");
  pre.className = "nbv-out-text nbv-out-error";
  pre.textContent = text;
  const line = notebookTracebackLine(text);
  if (line && ctrl){
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "nbv-error-jump";
    jump.textContent = "오류 줄 " + line + "로 이동";
    jump.addEventListener("click", () => nbFocusCellLine(ctrl, line));
    box.append(jump);
  }
  box.appendChild(pre);
  host.appendChild(box);
}

function renderNotebookRichFrame(host, spec){
  if (!spec || !spec.srcdoc) return false;
  const rich = document.createElement("div");
  rich.className = "nbv-out-rich-frame";
  if (spec.height){
    rich.style.height = spec.height;
    rich.style.paddingBottom = "0";
  } else {
    rich.style.paddingBottom = spec.paddingBottom || "62%";
  }
  const frame = document.createElement("iframe");
  frame.className = "nbv-out-rich-frame-content";
  frame.title = spec.title || "인터랙티브 출력";
  frame.setAttribute("sandbox", spec.allowScripts ? "allow-scripts" : "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "lazy");
  frame.addEventListener("load", () => { frame.dataset.nbvFrameLoaded = "1"; });   // PDF 스냅샷 가능 여부 판단용
  if (spec.mapCapture){
    rich.dataset.nbvMapFrame = "1";                       // PDF 내보내기 때 스냅샷 요청 대상 표시
    frame.srcdoc = nbInjectMapCapture(spec.srcdoc);
  } else {
    frame.srcdoc = spec.srcdoc;
  }
  rich.appendChild(frame);
  host.appendChild(rich);
  return true;
}

function renderCellOutputs(outputs, host, ctrl){
  for (const o of outputs){
    if (o.kind === "image"){
      const img = document.createElement("img");
      img.className = "nbv-out-img";
      img.src = "data:" + (o.mime || "image/png") + ";base64," + o.b64;
      host.appendChild(img);
    } else if (o.kind === "svg"){
      const img = document.createElement("img");
      img.className = "nbv-out-img nbv-out-svg";
      const svg = String(o.svg || "");
      if (svg.length <= 5 * 1024 * 1024){
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        img.alt = "SVG 실행 결과";
        host.appendChild(img);
      }
    } else if (o.kind === "interactive"){
      const frameSpec = notebookInteractiveMimeFrameSpec(o.mime, o.data);
      if (!renderNotebookRichFrame(host, frameSpec)){
        const pre = document.createElement("pre");
        pre.className = "nbv-out-text nbv-out-json";
        pre.textContent = notebookJsonOutput(o.data);
        host.appendChild(pre);
      }
    } else if (o.kind === "html"){
      const frameSpec = notebookInteractiveHtmlFrameSpec(o.html);
      if (!renderNotebookRichFrame(host, frameSpec)){
        const rich = document.createElement("div");
        rich.className = "nbv-out-html";
        const sanitizer = typeof PdfSignerCore !== "undefined" &&
          PdfSignerCore && typeof PdfSignerCore.sanitizeHtml === "function"
          ? PdfSignerCore.sanitizeHtml
          : null;
        if (sanitizer) rich.innerHTML = sanitizer(o.html || "");
        else rich.textContent = o.html || "";
        host.appendChild(rich);
      }
    } else if (o.kind === "media"){
      const media = document.createElement(o.media === "video" ? "video" : "audio");
      media.className = "nbv-out-media nbv-out-" + (o.media === "video" ? "video" : "audio");
      media.controls = true;
      media.preload = "metadata";
      const raw = String(o.b64 || "");
      if (raw.length <= 12 * 1024 * 1024){
        media.src = /^data:(?:audio|video)\//i.test(raw)
          ? raw
          : "data:" + o.mime + ";base64," + raw.replace(/\s+/g, "");
        host.appendChild(media);
      }
    } else if (o.kind === "latex"){
      const box = document.createElement("div");
      box.className = "nbv-out-latex";
      const tex = String(o.text || "")
        .replace(/^\s*\$\$([\s\S]*)\$\$\s*$/, "$1")
        .replace(/^\s*\\\[([\s\S]*)\\\]\s*$/, "$1");
      const renderer = typeof PdfSignerCore !== "undefined" &&
        PdfSignerCore && typeof PdfSignerCore.latexToMathML === "function"
        ? PdfSignerCore.latexToMathML
        : null;
      if (renderer) box.innerHTML = renderer(tex, true);
      else box.textContent = tex;
      host.appendChild(box);
    } else if (o.kind === "json"){
      const pre = document.createElement("pre");
      pre.className = "nbv-out-text nbv-out-json";
      pre.textContent = o.text || "";
      host.appendChild(pre);
    } else if (o.kind === "error"){
      renderNotebookError(host, o.text, ctrl);
    } else {
      const pre = document.createElement("pre");
      pre.className = "nbv-out-text" + (o.name === "stderr" ? " nbv-out-warning" : "");
      pre.textContent = o.text || "";
      host.appendChild(pre);
    }
  }
}

function escapeForPre(s){
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

if (typeof window !== "undefined"){
  window.insertNotebookCellsFromScratchpad = snapshots => {
    const ownerDoc = (typeof docs !== "undefined" && typeof activeId !== "undefined")
      ? docs.find(doc => doc.id === activeId)
      : null;
    if (!ownerDoc || !ownerDoc.notebookModel || !Array.isArray(ownerDoc._nbCtrls)) return false;
    return nbInsertCellSnapshots(ownerDoc, snapshots, { message:"메모에서 셀 붙여넣기" });
  };
}

// 노드 테스트용: 순수 직렬화 함수만 노출(브라우저에서는 module 이 없어 무시됨)
if (typeof module === "object" && module.exports){
  module.exports = {
    ipynbToModel,
    modelToIpynb,
    splitSourceLines,
    parseNbOutputs,
    notebookJsonOutput,
    notebookTracebackLine,
    notebookHeadings,
    notebookVariables,
    notebookResultToRawOutputs,
    notebookExecutionHash,
    notebookUpstreamHash,
    notebookRecordExecution,
    notebookClearExecution,
    notebookCellExecutionState,
    notebookNormalizeInkStrokes,
    notebookEnsureInkStrokes,
    notebookDropEmptyInkMetadata,
    notebookMoveArrayItem,
    notebookCellClipboardSnapshot,
    notebookMaterializeClipboardCells,
    notebookCompletionContext,
    notebookInvalidateCompletionCache,
    notebookCodeSource,
    notebookKernelModeLabel,
    notebookRequiresLocalPython,
    notebookInputPlan,
    notebookCellUsesInput,
    notebookFindMatches,
    notebookFindNextIndex,
    notebookReplaceAll,
    notebookExecutionControlState,
    notebookAutosaveTarget,
    notebookCellHasExecutableSource,
    notebookSetOutputsCollapsed,
    notebookFoliumFrameSpec,
    notebookInteractiveHtmlFrameSpec,
    notebookInteractiveMimeFrameSpec,
    notebookPdfSegments,
    notebookPdfBatches
  };
}
