"use strict";

const SCRATCHPAD_TEXT_KEY = "manneung-scratchpad:text:v1";
const SCRATCHPAD_TABS_KEY = "manneung-scratchpad:tabs:v2";
const SCRATCHPAD_OPEN_KEY = "manneung-scratchpad:open:v1";
const SCRATCHPAD_RECT_KEY = "manneung-scratchpad:rect:v1";
const SCRATCHPAD_ASSET_DB = "manneung-scratchpad-assets";
const SCRATCHPAD_ASSET_STORE = "assets";
const SCRATCHPAD_MAX_NOTES = 30;
const SCRATCHPAD_MAX_IMAGES = 50;
const SCRATCHPAD_MAX_NOTEBOOK_CELLS = 200;
const SCRATCHPAD_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SCRATCHPAD_MAX_TOTAL_IMAGE_BYTES = 200 * 1024 * 1024;
const SCRATCHPAD_LAYOUTS = new Set(["top", "left", "right", "bottom"]);
const SCRATCHPAD_IMAGE_SIZES = new Set(["small", "medium", "large", "full"]);
const SCRATCHPAD_COLORS = new Set(["yellow", "sage", "lavender", "rose", "ivory"]);

function scratchpadNoteId(){
  return "memo-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function scratchpadBlockId(prefix="block"){
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

function scratchpadNextTitle(notes){
  const names = new Set((notes || []).map(note => String(note && note.title || "").trim()));
  let number = 1;
  while (names.has(scratchpadDefaultTitle(number))) number++;
  return scratchpadDefaultTitle(number);
}

function scratchpadDefaultTitle(number){
  const base = typeof t === "function" ? t("새 메모") : "새 메모";
  return base + " " + number;
}

function scratchpadDefaultTitleNumber(title){
  const match = /^(?:새 메모|New note) (\d+)$/.exec(String(title || "").trim());
  return match ? Number(match[1]) : null;
}

function localizeScratchpadDefaultTitles(notes){
  const list = Array.isArray(notes) ? notes : [];
  const used = new Set(list
    .filter(note => !scratchpadDefaultTitleNumber(note && note.title))
    .map(note => String(note && note.title || "").trim()));
  let changed = false;
  for (const note of list){
    const originalNumber = scratchpadDefaultTitleNumber(note && note.title);
    if (!originalNumber) continue;
    let number = originalNumber;
    while (used.has(scratchpadDefaultTitle(number))) number++;
    const title = scratchpadDefaultTitle(number);
    if (note.title !== title){
      note.title = title;
      note.updatedAt = Date.now();
      changed = true;
    }
    used.add(title);
  }
  return changed;
}

function scratchpadTextBlock(text=""){
  return { id:scratchpadBlockId("text"), type:"text", text:String(text || ""), locked:false };
}

function scratchpadRemoveBlock(blocks, blockId){
  const list = Array.isArray(blocks) ? blocks : [];
  const index = list.findIndex(block => block && block.id === blockId);
  if (index < 0) return null;
  const removed = list[index];
  if (list.length === 1){
    if (removed.type === "text"){
      removed.text = "";
      return { blocks:list, activeId:removed.id, removed:null };
    }
    const replacement = scratchpadTextBlock("");
    return { blocks:[replacement], activeId:replacement.id, removed };
  }
  list.splice(index, 1);
  const active = list[Math.min(index, list.length - 1)];
  return { blocks:list, activeId:active.id, removed };
}

function scratchpadNormalizeNotebookCell(raw){
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type === "markdown" || raw.type === "raw" ? raw.type : "code";
  let metadata = {};
  let attachments = null;
  try { metadata = JSON.parse(JSON.stringify(raw.metadata || {})); } catch(_){}
  delete metadata.manneung_execution;
  delete metadata.manneung_ink;
  if (type === "markdown"){
    try { attachments = raw.attachments == null ? null : JSON.parse(JSON.stringify(raw.attachments)); } catch(_){}
  }
  return {
    type,
    source:String(raw.source || ""),
    attachments,
    metadata
  };
}

function scratchpadNormalizeBlock(raw){
  if (!raw || typeof raw !== "object") return null;
  const prefix = raw.type === "image" ? "image" : raw.type === "notebook-cell" ? "cell" : "text";
  const id = String(raw.id || "").trim() || scratchpadBlockId(prefix);
  if (raw.type === "notebook-cell"){
    const cell = scratchpadNormalizeNotebookCell(raw.cell);
    if (!cell) return null;
    return { id, type:"notebook-cell", cell, locked:raw.locked === true };
  }
  if (raw.type === "image"){
    const assetId = String(raw.assetId || "").trim();
    if (!assetId) return null;
    const position = SCRATCHPAD_LAYOUTS.has(raw.position) ? raw.position : "left";
    const width = SCRATCHPAD_IMAGE_SIZES.has(raw.width) ? raw.width : "medium";
    return {
      id,
      type:"image",
      assetId,
      text:String(raw.text == null ? "" : raw.text),
      position,
      width,
      name:String(raw.name || "메모 이미지").slice(0, 180),
      mime:String(raw.mime || "image/png").slice(0, 100),
      size:Math.max(0, Number(raw.size) || 0),
      locked:raw.locked === true
    };
  }
  return { id, type:"text", text:String(raw.text == null ? "" : raw.text), locked:raw.locked === true };
}

function normalizeScratchpadData(value, legacyText=""){
  const source = value && typeof value === "object" ? value : {};
  const notes = [];
  const noteIds = new Set();
  for (const raw of (Array.isArray(source.notes) ? source.notes : [])){
    if (!raw || typeof raw !== "object") continue;
    let id = String(raw.id || "").trim();
    if (!id || noteIds.has(id)) id = scratchpadNoteId();
    noteIds.add(id);
    const title = String(raw.title || "").trim().slice(0, 80) || ("메모 " + (notes.length + 1));
    const blocks = [];
    const blockIds = new Set();
    const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [{ type:"text", text:raw.text }];
    for (const candidate of rawBlocks){
      const block = scratchpadNormalizeBlock(candidate);
      if (!block) continue;
      if (blockIds.has(block.id)) block.id = scratchpadBlockId(block.type);
      blockIds.add(block.id);
      blocks.push(block);
    }
    if (!blocks.length) blocks.push(scratchpadTextBlock(""));
    notes.push({
      id,
      title,
      color:SCRATCHPAD_COLORS.has(raw.color) ? raw.color : "yellow",
      blocks,
      createdAt:Number(raw.createdAt) || Date.now(),
      updatedAt:Number(raw.updatedAt) || Date.now()
    });
  }
  if (!notes.length){
    const text = String(legacyText || "");
    notes.push({
      id:scratchpadNoteId(),
      title:text ? "기존 메모" : scratchpadNextTitle(notes),
      color:"yellow",
      blocks:[scratchpadTextBlock(text)],
      createdAt:Date.now(),
      updatedAt:Date.now()
    });
  }
  const activeId = notes.some(note => note.id === source.activeId) ? source.activeId : notes[0].id;
  return { version:5, activeId, notes };
}

function scratchpadPlainText(note){
  if (!note || !Array.isArray(note.blocks)) return "";
  return note.blocks.map(block => {
    if (block.type === "notebook-cell"){
      const type = block.cell && block.cell.type === "markdown" ? "마크다운" : block.cell && block.cell.type === "raw" ? "Raw" : "코드";
      return "[노트북 " + type + " 셀]\n" + String(block.cell && block.cell.source || "");
    }
    if (block.type === "image"){
      const label = "[이미지: " + (block.name || "메모 이미지") + "]";
      return block.text ? label + "\n" + block.text : label;
    }
    return String(block.text || "");
  }).join("\n\n");
}

function scratchpadHasLockedBlocks(note){
  return !!(note && Array.isArray(note.blocks) && note.blocks.some(block => block && block.locked === true));
}

function scratchpadImageSources(dataTransfer){
  if (!dataTransfer || typeof dataTransfer.getData !== "function") return [];
  const sources = [];
  const add = value => {
    value = String(value || "").trim();
    if (!value || sources.includes(value)) return;
    if (/^data:image\//i.test(value) || /^https?:\/\//i.test(value) || /^blob:/i.test(value)) sources.push(value);
  };
  const uriList = dataTransfer.getData("text/uri-list");
  for (const line of String(uriList || "").split(/\r?\n/)){
    if (!line.trim().startsWith("#")) add(line);
  }
  add(dataTransfer.getData("text/plain"));
  const html = dataTransfer.getData("text/html");
  if (html && typeof DOMParser !== "undefined"){
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("img[src]").forEach(image => add(image.getAttribute("src")));
    } catch(_){}
  }
  return sources.slice(0, 10);
}

async function scratchpadDroppedImageBlobs(dataTransfer){
  const direct = [...((dataTransfer && dataTransfer.files) || [])]
    .filter(file => file && /^image\//i.test(file.type || "") && file.size > 0);
  if (direct.length) return direct;
  const blobs = [];
  for (const source of scratchpadImageSources(dataTransfer)){
    try {
      const response = await fetch(source, {
        credentials:"omit",
        referrerPolicy:"no-referrer",
        cache:"no-store"
      });
      if (!response.ok && !/^data:|^blob:/i.test(source)) continue;
      const contentLength = Number(response.headers && response.headers.get("content-length")) || 0;
      if (contentLength > SCRATCHPAD_MAX_IMAGE_BYTES) continue;
      const blob = await response.blob();
      if (!/^image\//i.test(blob.type || "") || blob.size <= 0 || blob.size > SCRATCHPAD_MAX_IMAGE_BYTES) continue;
      blobs.push(blob);
    } catch(_){}
  }
  return blobs;
}

// IndexedDB는 기본적으로 "지워져도 되는(best-effort)" 저장소라, 디스크·용량 압박 시 브라우저가
// 이미지(에셋)만 조용히 비워 버릴 수 있다(메모 구조는 localStorage 라 살아남아 '깨진 이미지'가 됨).
// 영구 저장을 요청해 durable 로 승격시키면 임의 유실을 크게 줄일 수 있다.
let _scratchpadPersistPromise = null;
function ensureScratchpadPersistence(){
  if (_scratchpadPersistPromise) return _scratchpadPersistPromise;
  _scratchpadPersistPromise = (async () => {
    try {
      if (!navigator.storage || !navigator.storage.persist) return false;
      if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch(_){ return false; }
  })();
  return _scratchpadPersistPromise;
}

// 남은 저장 여유(바이트). 알 수 없으면 null.
async function scratchpadStorageFreeBytes(){
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { quota, usage } = await navigator.storage.estimate();
    if (!quota || usage == null) return null;
    return Math.max(0, quota - usage);
  } catch(_){ return null; }
}

let _scratchpadAssetDbPromise = null;
function openScratchpadAssetDb(){
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("indexeddb-unavailable"));
  ensureScratchpadPersistence();   // 첫 저장/조회 시점에 영구 저장 요청(캐시되어 1회만 실행)
  if (_scratchpadAssetDbPromise) return _scratchpadAssetDbPromise;
  _scratchpadAssetDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(SCRATCHPAD_ASSET_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SCRATCHPAD_ASSET_STORE)){
        request.result.createObjectStore(SCRATCHPAD_ASSET_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("scratchpad-db-open-failed"));
  });
  return _scratchpadAssetDbPromise;
}

async function writeScratchpadAsset(id, blob){
  const db = await openScratchpadAssetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCRATCHPAD_ASSET_STORE, "readwrite");
    tx.objectStore(SCRATCHPAD_ASSET_STORE).put(blob, id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("scratchpad-asset-write-failed"));
    tx.onabort = () => reject(tx.error || new Error("scratchpad-asset-write-aborted"));
  });
}

async function readScratchpadAsset(id){
  const db = await openScratchpadAssetDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SCRATCHPAD_ASSET_STORE, "readonly").objectStore(SCRATCHPAD_ASSET_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("scratchpad-asset-read-failed"));
  });
}

async function deleteScratchpadAsset(id){
  const db = await openScratchpadAssetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCRATCHPAD_ASSET_STORE, "readwrite");
    tx.objectStore(SCRATCHPAD_ASSET_STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("scratchpad-asset-delete-failed"));
    tx.onabort = () => reject(tx.error || new Error("scratchpad-asset-delete-aborted"));
  });
}

// 메모창을 헤더 드래그로 옮기고, 오른쪽 아래 손잡이로 크기 조절. 위치·크기는 저장된다.
function makeMemoFloatable(panel, head, handle, storageKey=SCRATCHPAD_RECT_KEY){
  const MIN_W = 280, MIN_H = 200;
  let pinned = false;
  const compactLayout = () => {
    try { return window.matchMedia("(max-width:600px), (max-height:520px)").matches; }
    catch(_){ return window.innerWidth <= 600 || window.innerHeight <= 520; }
  };
  const save = () => {
    if (!pinned || compactLayout()) return;
    const r = panel.getBoundingClientRect();
    try { localStorage.setItem(storageKey, JSON.stringify({ left:Math.round(r.left), top:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height) })); } catch(_){}
  };
  const pin = () => {
    if (pinned) return;
    const r = panel.getBoundingClientRect();
    panel.style.left = r.left + "px";
    panel.style.top = r.top + "px";
    panel.style.width = r.width + "px";
    panel.style.height = r.height + "px";
    panel.style.transform = "none";
    pinned = true;
  };
  const clamp = () => {
    if (!pinned || panel.hidden || compactLayout()) return;
    const margin = 6;
    let r = panel.getBoundingClientRect();
    const width = Math.min(r.width, Math.max(MIN_W, window.innerWidth - margin * 2));
    const height = Math.min(r.height, Math.max(MIN_H, window.innerHeight - margin * 2));
    if (Math.abs(width - r.width) > 0.5) panel.style.width = width + "px";
    if (Math.abs(height - r.height) > 0.5) panel.style.height = height + "px";
    r = panel.getBoundingClientRect();
    panel.style.left = Math.max(margin, Math.min(r.left, window.innerWidth - r.width - margin)) + "px";
    panel.style.top = Math.max(margin, Math.min(r.top, window.innerHeight - r.height - margin)) + "px";
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved && saved.w >= MIN_W && saved.h >= MIN_H){
      panel.style.left = saved.left + "px";
      panel.style.top = saved.top + "px";
      panel.style.width = saved.w + "px";
      panel.style.height = saved.h + "px";
      panel.style.transform = "none";
      pinned = true;
    }
  } catch(_){}
  head.addEventListener("pointerdown", event => {
    if (compactLayout() || event.target.closest("button")) return;
    event.preventDefault();
    pin();
    const rect = panel.getBoundingClientRect();
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    head.setPointerCapture(event.pointerId);
    const move = next => {
      panel.style.left = (next.clientX - dx) + "px";
      panel.style.top = (next.clientY - dy) + "px";
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
      clamp();
      save();
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
  });
  handle.addEventListener("pointerdown", event => {
    if (compactLayout()) return;
    event.preventDefault();
    event.stopPropagation();
    pin();
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    handle.setPointerCapture(event.pointerId);
    const move = next => {
      panel.style.width = Math.max(MIN_W, Math.min(rect.width + next.clientX - startX, window.innerWidth - rect.left - 6)) + "px";
      panel.style.height = Math.max(MIN_H, Math.min(rect.height + next.clientY - startY, window.innerHeight - rect.top - 6)) + "px";
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  window.addEventListener("resize", clamp);
  return { clampOnOpen:clamp };
}

function wireScratchpad(){
  const panel = byId("scratchpad");
  const openButtons = [...document.querySelectorAll("[data-scratchpad-open]")];
  const closeButton = byId("scratchpadClose");
  const editor = byId("scratchpadEditor");
  const tabs = byId("scratchpadTabs");
  const newButton = byId("scratchpadNew");
  const addTextButton = byId("scratchpadAddText");
  const addImageButton = byId("scratchpadAddImage");
  const colorButtons = [...panel.querySelectorAll(".scratchpad-color[data-note-color]")];
  const imageInput = byId("scratchpadImageFile");
  const renameButton = byId("scratchpadRename");
  const status = byId("scratchpadStatus");
  const count = byId("scratchpadCount");
  const copyButton = byId("scratchpadCopy");
  const clearButton = byId("scratchpadClear");
  if (!panel || !openButtons.length || !editor || !tabs || !newButton) return;
  ensureScratchpadPersistence();   // 이미지 유실 방지: 시작 시점에 영구 저장을 미리 요청

  const head = panel.querySelector(".scratchpad-head");
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "scratchpad-resize";
  resizeHandle.title = "끌어서 크기 조절";
  resizeHandle.setAttribute("aria-hidden", "true");
  panel.appendChild(resizeHandle);
  const memoFloat = head ? makeMemoFloatable(panel, head, resizeHandle) : null;

  let saveTimer = 0;
  let statusTimer = 0;
  let lastOpenButton = openButtons[0];
  let data = null;
  let activeBlockId = "";
  let draggedBlockId = "";
  let renderToken = 0;
  const assetUrls = new Map();

  try {
    const saved = JSON.parse(localStorage.getItem(SCRATCHPAD_TABS_KEY) || "null");
    const legacy = localStorage.getItem(SCRATCHPAD_TEXT_KEY) || "";
    data = normalizeScratchpadData(saved, legacy);
  } catch(_){
    let legacy = "";
    try { legacy = localStorage.getItem(SCRATCHPAD_TEXT_KEY) || ""; } catch(_error){}
    data = normalizeScratchpadData(null, legacy);
  }

  const activeNote = () => data.notes.find(note => note.id === data.activeId) || data.notes[0];
  const allImageBlocks = () => data.notes.flatMap(note => note.blocks.filter(block => block.type === "image"));
  const allNotebookCellBlocks = () => data.notes.flatMap(note => note.blocks.filter(block => block.type === "notebook-cell"));
  const noteHasContent = note => note && note.blocks.some(block =>
    block.type === "image" || block.type === "notebook-cell" || String(block.text || "").trim()
  );
  const showStatus = (message, reset=true) => {
    clearTimeout(statusTimer);
    status.textContent = message;
    if (reset) statusTimer = setTimeout(() => { status.textContent = (window.t ? window.t("자동 저장") : "자동 저장"); }, 2200);
  };
  const updateCount = () => {
    const note = activeNote();
    const textLength = note.blocks.reduce((sum, block) => sum + String(block.text || "").length, 0);
    const images = note.blocks.filter(block => block.type === "image").length;
    const cells = note.blocks.filter(block => block.type === "notebook-cell").length;
    count.textContent = window.tf("{n}자", { n: textLength.toLocaleString() }) +
      (images ? " · " + window.tf("이미지 {n}개", { n: images }) : "") + (cells ? " · " + window.tf("셀 {n}개", { n: cells }) : "");
  };
  const persist = (announce=true) => {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      localStorage.setItem(SCRATCHPAD_TABS_KEY, JSON.stringify(data));
      if (announce) showStatus("저장됨");
      return true;
    } catch(error){
      console.error(error);
      showStatus("메모 저장 실패", false);
      return false;
    }
  };
  const schedulePersist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(), 350);
  };
  const touchNote = () => {
    const note = activeNote();
    if (note) note.updatedAt = Date.now();
    updateCount();
    schedulePersist();
  };
  const focusFirstEditor = () => {
    const target = editor.querySelector("textarea");
    if (target) target.focus();
    else editor.focus();
  };
  const isAssetUsed = assetId => data.notes.some(note =>
    note.blocks.some(block => block.type === "image" && block.assetId === assetId)
  );
  const removeAssetIfUnused = async assetId => {
    if (!assetId || isAssetUsed(assetId)) return;
    const cached = assetUrls.get(assetId);
    if (cached) URL.revokeObjectURL(cached);
    assetUrls.delete(assetId);
    try { await deleteScratchpadAsset(assetId); } catch(error){ console.warn("scratchpad asset delete failed:", error); }
  };
  const assetUrl = async assetId => {
    if (assetUrls.has(assetId)) return assetUrls.get(assetId);
    const blob = await readScratchpadAsset(assetId);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    assetUrls.set(assetId, url);
    return url;
  };
  const insertionIndex = note => {
    const index = note.blocks.findIndex(block => block.id === activeBlockId);
    return index < 0 ? note.blocks.length : index + 1;
  };
  const insertTextBlock = (text="", focus=true) => {
    const note = activeNote();
    const block = scratchpadTextBlock(text);
    note.blocks.splice(insertionIndex(note), 0, block);
    activeBlockId = block.id;
    note.updatedAt = Date.now();
    renderEditor();
    persist();
    if (focus){
      const target = editor.querySelector(`[data-block-id="${block.id}"] textarea`);
      if (target) target.focus();
    }
    return block;
  };
  const addNotebookCells = (snapshots, options={}) => {
    const normalized = (Array.isArray(snapshots) ? snapshots : [])
      .map(scratchpadNormalizeNotebookCell).filter(Boolean);
    if (!normalized.length){ showStatus("저장할 노트북 셀이 없습니다.", false); return 0; }
    const available = SCRATCHPAD_MAX_NOTEBOOK_CELLS - allNotebookCellBlocks().length;
    if (available <= 0){
      showStatus("노트북 셀은 최대 " + SCRATCHPAD_MAX_NOTEBOOK_CELLS + "개까지 보관할 수 있습니다.", false);
      return 0;
    }
    const note = activeNote();
    let index = Number.isInteger(options.index) ? options.index : insertionIndex(note);
    index = Math.max(0, Math.min(note.blocks.length, index));
    if (note.blocks.length === 1 && note.blocks[0].type === "text" && !note.blocks[0].locked && !String(note.blocks[0].text || "").trim()){
      note.blocks.splice(0, 1);
      index = 0;
    }
    const blocks = normalized.slice(0, available).map(cell => ({
      id:scratchpadBlockId("cell"),
      type:"notebook-cell",
      cell,
      locked:false
    }));
    note.blocks.splice(index, 0, ...blocks);
    activeBlockId = blocks[blocks.length - 1].id;
    note.updatedAt = Date.now();
    renderEditor();
    persist();
    showStatus("노트북 셀 " + blocks.length + "개를 보관했습니다.");
    return blocks.length;
  };
  const addImageBlobs = async (inputBlobs, options={}) => {
    const blobs = [...(inputBlobs || [])].filter(blob => blob && /^image\//i.test(blob.type || "") && blob.size > 0);
    if (!blobs.length){ showStatus("넣을 수 있는 이미지가 없습니다.", false); return 0; }
    const note = activeNote();
    const existingImages = allImageBlocks();
    let totalBytes = existingImages.reduce((sum, block) => sum + (Number(block.size) || 0), 0);
    let index = insertionIndex(note);
    let added = 0;
    for (const blob of blobs){
      if (allImageBlocks().length >= SCRATCHPAD_MAX_IMAGES){
        showStatus("메모 이미지는 최대 " + SCRATCHPAD_MAX_IMAGES + "개입니다.", false);
        break;
      }
      if (blob.size > SCRATCHPAD_MAX_IMAGE_BYTES){
        showStatus("이미지 한 장은 25MB까지 넣을 수 있습니다.", false);
        continue;
      }
      if (totalBytes + blob.size > SCRATCHPAD_MAX_TOTAL_IMAGE_BYTES){
        showStatus("메모 이미지 합계가 200MB를 넘습니다.", false);
        break;
      }
      const assetId = scratchpadBlockId("asset");
      try {
        await writeScratchpadAsset(assetId, blob);
      } catch(error){
        console.error(error);
        showStatus("이미지를 저장하지 못했습니다.", false);
        continue;
      }
      const block = {
        id:scratchpadBlockId("image"),
        type:"image",
        assetId,
        text:"",
        position:"left",
        width:"medium",
        name:String(options.name || blob.name || "메모 이미지").slice(0, 180),
        mime:String(blob.type || "image/png"),
        size:blob.size,
        locked:false
      };
      note.blocks.splice(index++, 0, block);
      activeBlockId = block.id;
      totalBytes += blob.size;
      added++;
    }
    if (added){
      note.updatedAt = Date.now();
      renderEditor();
      persist();
      const free = await scratchpadStorageFreeBytes();
      if (free != null && free < 50 * 1024 * 1024){
        showStatus("이미지 " + added + "개 저장 — 저장 공간이 빠듯해요. 중요한 이미지는 '💾 파일로' 백업을 권해요.", false);
      } else {
        showStatus("이미지 " + added + "개를 메모에 넣었습니다.");
      }
      if (options.open !== false) setOpen(true, false);
      const caption = editor.querySelector(`[data-block-id="${activeBlockId}"] .scratchpad-image-text`);
      if (caption) caption.focus();
    }
    return added;
  };
  const removeBlock = async block => {
    const note = activeNote();
    if (block && block.locked){
      showStatus("잠긴 블록은 삭제할 수 없습니다. 먼저 잠금을 해제하세요.", false);
      return;
    }
    if (!block) return;
    const result = scratchpadRemoveBlock(note.blocks, block.id);
    if (!result) return;
    note.blocks = result.blocks;
    activeBlockId = result.activeId;
    note.updatedAt = Date.now();
    renderEditor();
    persist();
    if (result.removed && result.removed.type === "image"){
      await removeAssetIfUnused(result.removed.assetId);
    }
  };
  const moveBlock = (block, direction) => {
    if (block && block.locked){
      showStatus("잠긴 블록은 이동할 수 없습니다. 먼저 잠금을 해제하세요.", false);
      return;
    }
    const note = activeNote();
    const index = note.blocks.findIndex(item => item.id === block.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= note.blocks.length) return;
    note.blocks.splice(next, 0, note.blocks.splice(index, 1)[0]);
    activeBlockId = block.id;
    note.updatedAt = Date.now();
    renderEditor();
    persist();
  };
  const makeButton = (text, title, action, className="") => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    if (className) button.className = className;
    button.addEventListener("click", event => {
      event.stopPropagation();
      action(button);
    });
    return button;
  };
  const toggleBlockLock = block => {
    if (!block) return;
    block.locked = !block.locked;
    activeBlockId = block.id;
    const note = activeNote();
    note.updatedAt = Date.now();
    renderEditor();
    persist();
    showStatus(block.locked ? "블록을 잠갔습니다. 읽기만 할 수 있습니다." : "블록 잠금을 해제했습니다.");
    const target = editor.querySelector(`[data-block-id="${block.id}"] textarea`);
    if (target && !block.locked) target.focus();
  };
  const lockIconSvg = locked => locked
    ? '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/><path d="M8 10v1.5"/></svg>'
    : '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5 7V5a3 3 0 0 1 5.7-1.3"/><path d="M8 10v1.5"/></svg>';
  const makeLockButton = block => {
    const button = makeButton(
      "",
      block.locked ? "잠금을 풀어 다시 편집" : "수정·이동·삭제 방지",
      () => toggleBlockLock(block),
      "scratchpad-lock" + (block.locked ? " active" : "")
    );
    button.innerHTML = lockIconSvg(block.locked);
    button.setAttribute("aria-label", block.locked ? "블록 잠금 해제" : "블록 잠금");
    button.setAttribute("aria-pressed", String(block.locked));
    return button;
  };
  const makeBlockShell = block => {
    const shell = document.createElement("article");
    shell.className = "scratchpad-block scratchpad-" + block.type + "-block";
    shell.classList.toggle("locked", !!block.locked);
    shell.dataset.blockId = block.id;
    shell.addEventListener("pointerdown", () => { activeBlockId = block.id; });
    return shell;
  };
  const makeBlockHandle = block => {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "scratchpad-block-handle";
    handle.textContent = "⋮⋮";
    handle.title = block.locked ? "잠긴 블록은 이동할 수 없음" : "끌어서 블록 순서 변경";
    handle.draggable = !block.locked;
    handle.disabled = !!block.locked;
    handle.addEventListener("dragstart", event => {
      draggedBlockId = block.id;
      event.dataTransfer.effectAllowed = block.type === "notebook-cell" ? "copyMove" : "move";
      event.dataTransfer.setData("text/x-scratchpad-block", block.id);
      if (block.type === "notebook-cell"){
        event.dataTransfer.setData("application/x-manneung-notebook-cells", JSON.stringify([block.cell]));
      }
      requestAnimationFrame(() => handle.closest(".scratchpad-block").classList.add("dragging"));
    });
    handle.addEventListener("dragend", () => {
      draggedBlockId = "";
      editor.querySelectorAll(".scratchpad-block").forEach(node =>
        node.classList.remove("dragging", "drop-before", "drop-after")
      );
    });
    return handle;
  };
  const makeTextBlock = block => {
    const shell = makeBlockShell(block);
    const tools = document.createElement("div");
    tools.className = "scratchpad-block-tools";
    tools.append(
      makeBlockHandle(block),
      makeLockButton(block),
      makeButton("↑", "이 블록을 위로", () => moveBlock(block, -1)),
      makeButton("↓", "이 블록을 아래로", () => moveBlock(block, 1)),
      makeButton("×", "이 글 블록 삭제", () => removeBlock(block), "danger")
    );
    if (block.locked){
      [...tools.querySelectorAll("button")].forEach(button => {
        if (!button.classList.contains("scratchpad-lock")) button.disabled = true;
      });
    }
    const textarea = document.createElement("textarea");
    textarea.className = "scratchpad-text-block";
    textarea.maxLength = 200000;
    textarea.placeholder = "내용을 입력하세요. 이미지는 붙여넣거나 이곳에 드래그할 수 있습니다.";
    textarea.spellcheck = false;
    textarea.value = block.text;
    textarea.readOnly = !!block.locked;
    textarea.setAttribute("aria-readonly", String(!!block.locked));
    const textSpellcheck = MNKoreanSpellcheck.attach({
      textarea,
      buttonHost:tools,
      mode:"plain",
      label:((activeNote() || {}).title || "메모") + " 맞춤법 검사"
    });
    if (textSpellcheck) textSpellcheck.button.disabled = !!block.locked;
    textarea.addEventListener("focus", () => { activeBlockId = block.id; });
    textarea.addEventListener("input", () => {
      if (block.locked) return;
      block.text = textarea.value;
      touchNote();
    });
    textarea.addEventListener("paste", async event => {
      if (block.locked) return;
      const images = [...((event.clipboardData && event.clipboardData.items) || [])]
        .filter(item => item.kind === "file" && /^image\//i.test(item.type || ""))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (!images.length) return;
      event.preventDefault();
      event.stopPropagation();
      activeBlockId = block.id;
      showStatus("붙여넣은 이미지를 저장하는 중…", false);
      await addImageBlobs(images);
    });
    textarea.addEventListener("keydown", event => {
      if (event.key === "Escape"){
        event.preventDefault();
        event.stopPropagation();
        closeByEscape();
        return;
      }
      if (shortcutMatches(event, "scratchpad")) return;
      const action = shortcutActionForEvent(event);
      if (action === "saveCurrent"){
        event.preventDefault();
        event.stopPropagation();
        persist();
      }
    });
    shell.append(tools, textarea);
    return shell;
  };
  const makeImageBlock = block => {
    const shell = makeBlockShell(block);
    shell.classList.add("layout-" + block.position, "size-" + block.width);
    const tools = document.createElement("div");
    tools.className = "scratchpad-block-tools scratchpad-image-tools";
    const layoutGroup = document.createElement("span");
    layoutGroup.className = "scratchpad-layout-group";
    layoutGroup.setAttribute("aria-label", "이미지 위치");
    const layoutButtons = [
      ["↑", "top", "이미지를 글 위에 배치"],
      ["←", "left", "이미지를 글 왼쪽에 배치"],
      ["→", "right", "이미지를 글 오른쪽에 배치"],
      ["↓", "bottom", "이미지를 글 아래에 배치"]
    ];
    layoutButtons.forEach(([label, value, title]) => {
      const button = makeButton(label, title, () => {
        block.position = value;
        touchNote();
        renderEditor();
      });
      button.className = "scratchpad-layout" + (block.position === value ? " active" : "");
      button.setAttribute("aria-pressed", String(block.position === value));
      layoutGroup.appendChild(button);
    });
    const size = document.createElement("select");
    size.className = "scratchpad-image-size";
    size.title = "이미지 표시 크기";
    [["small","작게"],["medium","중간"],["large","크게"],["full","가득"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      size.appendChild(option);
    });
    size.value = block.width;
    size.disabled = !!block.locked;
    size.addEventListener("change", () => {
      if (block.locked) return;
      block.width = SCRATCHPAD_IMAGE_SIZES.has(size.value) ? size.value : "medium";
      touchNote();
      renderEditor();
    });
    // 재사용: 복사·파일 저장·편집 탭 열기 — 원본을 바꾸지 않는 읽기 동작이라 잠긴 블록에서도 허용
    const blockBlob = async () => {
      try {
        const blob = await readScratchpadAsset(block.assetId);
        if (blob) return blob;
      } catch(error){ console.warn("scratchpad asset read failed:", error); }
      showStatus("이미지 데이터가 저장소에서 사라졌어요 (저장 공간 정리 등) — 복사·다운로드할 수 없습니다.", false);
      return null;
    };
    const reuseBase = () => String(block.name || "메모 이미지").replace(/\.[^.]+$/, "").trim() || "메모 이미지";
    const reuseExt = blob => ((blob.type || "image/png").split("/")[1] || "png").replace("jpeg", "jpg").replace(/\+.*$/, "");
    const toPngBlob = blob => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
        c.getContext("2d").drawImage(img, 0, 0);
        c.toBlob(b => b ? resolve(b) : reject(new Error("png-encode-failed")), "image/png");
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image-decode-failed")); };
      img.src = url;
    });
    const copyBtn = makeButton("📋 복사", "이미지를 클립보드로 복사 — 한글·워드 등 다른 프로그램에 붙여넣기", async () => {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined"){
        showStatus("이 브라우저에서는 복사가 안 됩니다. 이미지 우클릭 → 이미지 복사를 사용하세요.", false);
        return;
      }
      // 클립보드는 PNG가 가장 안정적. 저장소 읽기 실패는 blockBlob이 자체 안내를 띄우므로 여기선 조용히 끝낸다.
      let assetMissing = false;
      const pngPromise = () => blockBlob().then(blob => {
        if (!blob){ assetMissing = true; throw new Error("asset-missing"); }
        return /^image\/png$/i.test(blob.type) ? blob : toPngBlob(blob);
      });
      try {
        try {
          // Safari는 클릭 직후(사용자 제스처가 살아있을 때) write를 시작해야 하므로 PNG 준비를 Promise 그대로 넘긴다
          await navigator.clipboard.write([new ClipboardItem({ "image/png": pngPromise() })]);
        } catch(error){
          if (assetMissing) throw error;
          // ClipboardItem에 Promise 값을 못 넣는 브라우저 — Blob을 만든 뒤 다시 시도
          const png = await pngPromise();
          await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        }
        showStatus("이미지를 복사했습니다");
      } catch(error){
        console.warn(error);
        if (!assetMissing) showStatus("이 브라우저에서는 복사가 안 됩니다. 이미지 우클릭 → 이미지 복사를 사용하세요.", false);
      }
    }, "scratchpad-reuse");
    const fileBtn = makeButton("💾 파일로", "이미지를 파일로 저장 (EXE는 저장 폴더, 브라우저는 다운로드)", async () => {
      const blob = await blockBlob(); if (!blob) return;
      const name = reuseBase() + "." + reuseExt(blob);
      if (typeof saveImageBlobUnified === "function"){ await saveImageBlobUnified(blob, null, name); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "scratchpad-reuse");
    const editBtn = makeButton("✏️ 편집기로", "이미지를 새 편집 탭으로 열기 — 자르기·표시·모자이크 후 '📷 메모로'로 다시 넣기", async () => {
      const blob = await blockBlob(); if (!blob) return;
      if (typeof handleFiles !== "function"){ showStatus("편집 탭을 열 수 없습니다.", false); return; }
      await handleFiles([new File([blob], reuseBase() + "." + reuseExt(blob), { type: blob.type || "image/png" })]);
      setOpen(false);                                       // 메모를 닫아 새 편집 탭이 보이게
      if (typeof toast === "function") toast("메모 이미지를 편집 탭으로 열었어요. 편집 후 '📷 메모로'로 다시 넣을 수 있어요.", 2800);
    }, "scratchpad-reuse");
    const imageMemoBtn = makeButton("🖼️ 이미지 메모로", "이 이미지를 이미지 메모로 보내기 (EXE는 저장 폴더의 이미지메모 폴더에 자동 저장)", async () => {
      const blob = await blockBlob(); if (!blob) return;
      if (typeof window.addImagesToImageMemo !== "function"){ showStatus("이미지 메모를 열 수 없습니다.", false); return; }
      const file = new File([blob], reuseBase() + "." + reuseExt(blob), { type: blob.type || "image/png" });
      const added = window.addImagesToImageMemo([file], { open: true, keepName: true });
      showStatus(added ? "이미지 메모로 보냈어요." : "이미지 메모로 보내지 못했어요.", !!added);
    }, "scratchpad-reuse");
    tools.append(
      makeBlockHandle(block),
      makeLockButton(block),
      layoutGroup,
      size,
      makeButton("블록 ↑", "이미지 블록을 위로", () => moveBlock(block, -1)),
      makeButton("블록 ↓", "이미지 블록을 아래로", () => moveBlock(block, 1)),
      copyBtn,
      fileBtn,
      editBtn,
      imageMemoBtn,
      makeButton("삭제", "이 이미지 블록 삭제", () => removeBlock(block), "danger")
    );
    if (block.locked){
      [...tools.querySelectorAll("button,select")].forEach(control => {
        if (!control.classList.contains("scratchpad-lock") && !control.classList.contains("scratchpad-reuse")) control.disabled = true;
      });
    }

    const content = document.createElement("div");
    content.className = "scratchpad-image-content";
    const picture = document.createElement("div");
    picture.className = "scratchpad-image-picture";
    const image = document.createElement("img");
    image.alt = block.name || "메모 이미지";
    image.draggable = false;
    const loading = document.createElement("span");
    loading.textContent = "이미지 불러오는 중…";
    picture.append(image, loading);
    const token = renderToken;
    assetUrl(block.assetId).then(url => {
      if (token !== renderToken || !image.isConnected) return;
      if (url){
        image.src = url;
        loading.remove();
      } else {
        loading.textContent = "이미지 데이터가 사라졌어요 (저장 공간 정리 등) — 복사·다운로드 불가";
        picture.classList.add("missing");
      }
    }).catch(() => {
      if (token === renderToken && loading.isConnected){
        loading.textContent = "이미지를 불러오지 못했습니다.";
        picture.classList.add("missing");
      }
    });
    const text = document.createElement("textarea");
    text.className = "scratchpad-image-text";
    text.maxLength = 200000;
    text.placeholder = "이미지와 함께 표시할 글을 입력하세요.";
    text.spellcheck = false;
    text.value = block.text;
    text.readOnly = !!block.locked;
    text.setAttribute("aria-readonly", String(!!block.locked));
    const imageTextSpellcheck = MNKoreanSpellcheck.attach({
      textarea:text,
      buttonHost:tools,
      mode:"plain",
      label:((activeNote() || {}).title || "메모") + " 이미지 설명 맞춤법 검사"
    });
    if (imageTextSpellcheck) imageTextSpellcheck.button.disabled = !!block.locked;
    text.addEventListener("focus", () => { activeBlockId = block.id; });
    text.addEventListener("input", () => {
      if (block.locked) return;
      block.text = text.value;
      touchNote();
    });
    text.addEventListener("paste", async event => {
      if (block.locked) return;
      const images = [...((event.clipboardData && event.clipboardData.items) || [])]
        .filter(item => item.kind === "file" && /^image\//i.test(item.type || ""))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (!images.length) return;
      event.preventDefault();
      event.stopPropagation();
      activeBlockId = block.id;
      await addImageBlobs(images);
    });
    content.append(picture, text);
    shell.append(tools, content);
    return shell;
  };
  const makeNotebookCellBlock = block => {
    const shell = makeBlockShell(block);
    const tools = document.createElement("div");
    tools.className = "scratchpad-block-tools scratchpad-notebook-tools";
    const paste = makeButton("노트북에 붙여넣기", "현재 노트북의 선택한 셀 아래에 삽입", () => {
      if (typeof window.insertNotebookCellsFromScratchpad !== "function"){
        showStatus("먼저 붙여넣을 노트북을 열어 주세요.", false);
        return;
      }
      const inserted = window.insertNotebookCellsFromScratchpad([block.cell]);
      showStatus(inserted ? "노트북에 셀을 붙여넣었습니다." : "붙여넣을 노트북을 먼저 열어 주세요.", !!inserted);
    }, "scratchpad-reuse");
    tools.append(
      makeBlockHandle(block),
      makeLockButton(block),
      makeButton("↑", "이 셀 블록을 위로", () => moveBlock(block, -1)),
      makeButton("↓", "이 셀 블록을 아래로", () => moveBlock(block, 1)),
      paste,
      makeButton("×", "이 셀 블록 삭제", () => removeBlock(block), "danger")
    );
    if (block.locked){
      [...tools.querySelectorAll("button")].forEach(button => {
        if (!button.classList.contains("scratchpad-lock") && !button.classList.contains("scratchpad-reuse")) button.disabled = true;
      });
    }
    const card = document.createElement("div");
    card.className = "scratchpad-notebook-card";
    const badge = document.createElement("strong");
    const cellType = block.cell && block.cell.type;
    badge.className = "scratchpad-notebook-badge type-" + (cellType || "code");
    badge.textContent = cellType === "markdown" ? "마크다운 셀" : cellType === "raw" ? "Raw 셀" : "코드 셀";
    const source = document.createElement("pre");
    source.className = "scratchpad-notebook-source";
    if (cellType === "code" && typeof highlightCode === "function"){
      source.innerHTML = highlightCode(String(block.cell && block.cell.source || ""), "hash");
    } else {
      source.textContent = String(block.cell && block.cell.source || "");
    }
    if (!source.textContent.trim()) source.textContent = "(빈 셀)";
    card.append(badge, source);
    shell.append(tools, card);
    return shell;
  };
  function renderEditor(){
    renderToken++;
    const note = activeNote();
    panel.dataset.noteColor = note.color;
    colorButtons.forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.noteColor === note.color))
    );
    editor.setAttribute("aria-label", note.title + " 내용");
    editor.setAttribute("aria-labelledby", "scratchpad-tab-" + note.id);
    editor.replaceChildren(...note.blocks.map(block =>
      block.type === "image" ? makeImageBlock(block)
        : block.type === "notebook-cell" ? makeNotebookCellBlock(block)
        : makeTextBlock(block)
    ));
    updateCount();
  }
  const renameNote = async (note=activeNote()) => {
    if (!note) return;
    const entered = await askText({
      title:"메모 이름 변경",
      message:"탭에 표시할 이름을 입력하세요.",
      placeholder:"예: 수업 준비",
      value:note.title,
      okText:"변경"
    });
    if (entered === null) return;
    const firstLine = scratchpadPlainText(note).split(/\r?\n/).map(line => line.trim()).find(Boolean) || "";
    note.title = String(entered).trim().slice(0, 80) || firstLine.slice(0, 80) ||
      scratchpadNextTitle(data.notes.filter(item => item !== note));
    note.updatedAt = Date.now();
    renderTabs();
    persist();
  };
  const switchNote = (id, focus=true) => {
    if (!data.notes.some(note => note.id === id)) return;
    data.activeId = id;
    activeBlockId = activeNote().blocks[0].id;
    renderEditor();
    renderTabs();
    persist(false);
    if (focus) focusFirstEditor();
  };
  const removeNote = async note => {
    if (!note) return;
    if (scratchpadHasLockedBlocks(note)){
      showStatus("잠긴 블록이 있어 메모를 삭제할 수 없습니다. 먼저 잠금을 해제하세요.", false);
      return;
    }
    if (noteHasContent(note)){
      const ok = await confirmDialog("'" + note.title + "' 메모를 삭제할까요?", "삭제", "취소");
      if (!ok) return;
    }
    const assets = note.blocks.filter(block => block.type === "image").map(block => block.assetId);
    const index = data.notes.findIndex(item => item.id === note.id);
    if (index < 0) return;
    data.notes.splice(index, 1);
    if (!data.notes.length){
      data.notes.push({
        id:scratchpadNoteId(),
        title:scratchpadNextTitle(data.notes),
        color:"yellow",
        blocks:[scratchpadTextBlock("")],
        createdAt:Date.now(),
        updatedAt:Date.now()
      });
    }
    if (data.activeId === note.id) data.activeId = data.notes[Math.min(index, data.notes.length - 1)].id;
    activeBlockId = activeNote().blocks[0].id;
    renderEditor();
    renderTabs();
    persist();
    for (const assetId of assets) await removeAssetIfUnused(assetId);
    focusFirstEditor();
  };
  function renderTabs(){
    tabs.textContent = "";
    for (const note of data.notes){
      const item = document.createElement("div");
      item.className = "scratchpad-tab" + (note.id === data.activeId ? " active" : "");
      item.dataset.noteColor = note.color;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "scratchpad-tab-main";
      tab.id = "scratchpad-tab-" + note.id;
      tab.textContent = note.title;
      tab.title = note.title + " · 더블클릭 또는 F2로 이름 변경";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(note.id === data.activeId));
      tab.setAttribute("aria-controls", "scratchpadEditor");
      tab.tabIndex = note.id === data.activeId ? 0 : -1;
      tab.addEventListener("click", () => switchNote(note.id));
      tab.addEventListener("dblclick", event => {
        event.preventDefault();
        renameNote(note);
      });
      tab.addEventListener("keydown", event => {
        if (event.key === "F2"){
          event.preventDefault();
          renameNote(note);
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = data.notes.findIndex(item => item.id === note.id);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = data.notes[(index + direction + data.notes.length) % data.notes.length];
        switchNote(next.id, false);
        const nextTab = byId("scratchpad-tab-" + next.id);
        if (nextTab) nextTab.focus();
      });
      const close = document.createElement("button");
      close.type = "button";
      close.className = "scratchpad-tab-close";
      close.textContent = "×";
      close.title = note.title + " 삭제";
      close.setAttribute("aria-label", note.title + " 메모 삭제");
      close.addEventListener("click", event => {
        event.stopPropagation();
        removeNote(note);
      });
      item.append(tab, close);
      tabs.appendChild(item);
    }
    const selected = byId("scratchpad-tab-" + data.activeId);
    if (selected) selected.scrollIntoView({ block:"nearest", inline:"nearest" });
  }
  const setOpen = (open, focus=true) => {
    panel.hidden = !open;
    if (open && memoFloat) memoFloat.clampOnOpen();
    openButtons.forEach(button => button.setAttribute("aria-expanded", String(open)));
    try { localStorage.setItem(SCRATCHPAD_OPEN_KEY, open ? "1" : "0"); } catch(_){}
    if (open && document.body.classList.contains("viewer-fullscreen") && typeof exitViewerFullscreen === "function") exitViewerFullscreen();
    if (typeof scheduleViewerLayoutRefresh === "function") scheduleViewerLayoutRefresh();
    if (open && focus) setTimeout(focusFirstEditor, 0);
    else if (!open && focus){
      const returnTarget = lastOpenButton.offsetParent !== null
        ? lastOpenButton
        : openButtons.find(button => button.offsetParent !== null);
      if (returnTarget) returnTarget.focus();
    }
  };
  const closeByEscape = () => {
    if (saveTimer) persist();
    setOpen(false);
  };

  const localizedDefaultTitles = localizeScratchpadDefaultTitles(data.notes);
  activeBlockId = activeNote().blocks[0].id;
  renderEditor();
  renderTabs();
  persist(localizedDefaultTitles);
  window.addEventListener("mni18nchange", () => {
    if (!localizeScratchpadDefaultTitles(data.notes)) return;
    renderEditor();
    renderTabs();
    persist(false);
  });
  let restoreOpen = false;
  try { restoreOpen = localStorage.getItem(SCRATCHPAD_OPEN_KEY) === "1"; } catch(_){}
  setOpen(restoreOpen, false);

  openButtons.forEach(button => button.addEventListener("click", () => {
    lastOpenButton = button;
    setOpen(panel.hidden);
  }));
  closeButton.addEventListener("click", () => setOpen(false));
  newButton.addEventListener("click", () => {
    if (data.notes.length >= SCRATCHPAD_MAX_NOTES){
      showStatus("메모는 최대 " + SCRATCHPAD_MAX_NOTES + "개", false);
      return;
    }
    const note = {
      id:scratchpadNoteId(),
      title:scratchpadNextTitle(data.notes),
      color:"yellow",
      blocks:[scratchpadTextBlock("")],
      createdAt:Date.now(),
      updatedAt:Date.now()
    };
    data.notes.push(note);
    data.activeId = note.id;
    activeBlockId = note.blocks[0].id;
    renderEditor();
    renderTabs();
    persist();
    focusFirstEditor();
  });
  if (addTextButton) addTextButton.addEventListener("click", () => insertTextBlock());
  colorButtons.forEach(button => button.addEventListener("click", () => {
    const note = activeNote();
    const color = button.dataset.noteColor;
    if (!note || !SCRATCHPAD_COLORS.has(color) || note.color === color) return;
    note.color = color;
    note.updatedAt = Date.now();
    renderEditor();
    renderTabs();
    persist();
  }));
  if (addImageButton && imageInput){
    addImageButton.addEventListener("click", () => imageInput.click());
    imageInput.addEventListener("change", async () => {
      await addImageBlobs(imageInput.files);
      imageInput.value = "";
    });
  }
  if (renameButton) renameButton.addEventListener("click", () => renameNote());
  copyButton.addEventListener("click", async () => {
    const text = scratchpadPlainText(activeNote());
    if (!text.trim()){ showStatus("복사할 내용 없음"); return; }
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch(_){}
    if (!copied){
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      try { copied = document.execCommand("copy"); } catch(_){}
      fallback.remove();
    }
    showStatus(copied ? "텍스트로 복사됨" : "복사 실패");
  });
  clearButton.addEventListener("click", async () => {
    const note = activeNote();
    if (!noteHasContent(note)) return;
    if (scratchpadHasLockedBlocks(note)){
      showStatus("잠긴 블록이 있어 모두 지울 수 없습니다. 먼저 잠금을 해제하세요.", false);
      return;
    }
    if (!await confirmDialog("'" + note.title + "' 내용을 모두 지울까요?", "지우기", "취소")) return;
    const assets = note.blocks.filter(block => block.type === "image").map(block => block.assetId);
    note.blocks = [scratchpadTextBlock("")];
    activeBlockId = note.blocks[0].id;
    note.updatedAt = Date.now();
    renderEditor();
    persist();
    for (const assetId of assets) await removeAssetIfUnused(assetId);
    focusFirstEditor();
  });

  const transferMightContainImage = transfer => {
    const types = Array.from((transfer && transfer.types) || []);
    return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html");
  };
  const transferHasNotebookCells = transfer =>
    Array.from((transfer && transfer.types) || []).includes("application/x-manneung-notebook-cells");
  const transferNotebookCells = transfer => {
    try {
      const parsed = JSON.parse(transfer.getData("application/x-manneung-notebook-cells") || "[]");
      return (Array.isArray(parsed) ? parsed : []).map(scratchpadNormalizeNotebookCell).filter(Boolean);
    } catch(_){ return []; }
  };
  editor.addEventListener("dragover", event => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedBlockId){
      const target = event.target.closest(".scratchpad-block");
      editor.querySelectorAll(".scratchpad-block").forEach(node => node.classList.remove("drop-before", "drop-after"));
      if (target && target.dataset.blockId !== draggedBlockId){
        const rect = target.getBoundingClientRect();
        target.classList.add(event.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
      }
      event.dataTransfer.dropEffect = "move";
    } else if (transferHasNotebookCells(event.dataTransfer)){
      editor.classList.add("external-drag", "external-cell-drag");
      const target = event.target.closest(".scratchpad-block");
      editor.querySelectorAll(".scratchpad-block").forEach(node => node.classList.remove("drop-before", "drop-after"));
      if (target){
        const rect = target.getBoundingClientRect();
        target.classList.add(event.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
      }
      event.dataTransfer.dropEffect = "copy";
    } else if (transferMightContainImage(event.dataTransfer)){
      editor.classList.add("external-drag");
      event.dataTransfer.dropEffect = "copy";
    }
  });
  editor.addEventListener("dragleave", event => {
    if (!editor.contains(event.relatedTarget)) editor.classList.remove("external-drag", "external-cell-drag");
  });
  editor.addEventListener("drop", async event => {
    event.preventDefault();
    event.stopPropagation();
    editor.classList.remove("external-drag", "external-cell-drag");
    if (draggedBlockId){
      const note = activeNote();
      const sourceIndex = note.blocks.findIndex(block => block.id === draggedBlockId);
      const target = event.target.closest(".scratchpad-block");
      const targetIndex = target ? note.blocks.findIndex(block => block.id === target.dataset.blockId) : note.blocks.length;
      if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex){
        const rect = target && target.getBoundingClientRect();
        const after = rect && event.clientY >= rect.top + rect.height / 2;
        const moved = note.blocks.splice(sourceIndex, 1)[0];
        let destination = targetIndex + (after ? 1 : 0);
        if (sourceIndex < destination) destination--;
        note.blocks.splice(Math.max(0, Math.min(destination, note.blocks.length)), 0, moved);
        activeBlockId = moved.id;
        note.updatedAt = Date.now();
        renderEditor();
        persist();
      }
      draggedBlockId = "";
      return;
    }
    if (transferHasNotebookCells(event.dataTransfer)){
      const cells = transferNotebookCells(event.dataTransfer);
      const note = activeNote();
      const target = event.target.closest(".scratchpad-block");
      let index = target ? note.blocks.findIndex(block => block.id === target.dataset.blockId) : note.blocks.length;
      if (target){
        const rect = target.getBoundingClientRect();
        if (event.clientY >= rect.top + rect.height / 2) index++;
      }
      addNotebookCells(cells, { index });
      return;
    }
    showStatus("드롭한 이미지를 가져오는 중…", false);
    const blobs = await scratchpadDroppedImageBlobs(event.dataTransfer);
    if (!blobs.length){
      showStatus("이 웹 이미지는 직접 가져올 수 없습니다. 이미지 복사 후 Ctrl+V를 사용해 주세요.", false);
      return;
    }
    await addImageBlobs(blobs);
  });

  window.addImagesToScratchpad = async (blobs, options={}) => {
    setOpen(true, false);
    return addImageBlobs(blobs, options);
  };
  // 텍스트를 글 블록으로 추가(이미지 OCR 결과 등 외부 모듈용) — 메모장을 열고 새 블록에 넣는다.
  window.appendTextToScratchpad = (text) => {
    setOpen(true, false);
    return insertTextBlock(String(text || ""), false);
  };
  window.addNotebookCellsToScratchpad = (snapshots, options={}) => {
    setOpen(true, false);
    return addNotebookCells(snapshots, options);
  };
  window.openScratchpadForNotebookDrop = () => setOpen(true, false);
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden && !document.querySelector(".modal:not([hidden])")){
      event.preventDefault();
      closeByEscape();
      return;
    }
    if (document.querySelector(".modal:not([hidden])") || !shortcutMatches(event, "scratchpad")) return;
    event.preventDefault();
    if (panel.hidden) setOpen(true);
    else if (panel.contains(document.activeElement)) setOpen(false);
    else focusFirstEditor();
  });
  window.addEventListener("pagehide", () => {
    if (saveTimer) persist();
    assetUrls.forEach(url => URL.revokeObjectURL(url));
    assetUrls.clear();
  });
}

if (typeof module !== "undefined" && module.exports){
  module.exports = {
    normalizeScratchpadData,
    scratchpadNextTitle,
    scratchpadRemoveBlock,
    scratchpadNormalizeBlock,
    scratchpadNormalizeNotebookCell,
    scratchpadPlainText,
    scratchpadHasLockedBlocks,
    scratchpadImageSources
  };
}
