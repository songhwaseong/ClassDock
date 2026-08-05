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
const SCRATCHPAD_MAX_TABLE_ROWS = 50;
const SCRATCHPAD_MAX_TABLE_COLS = 20;
const SCRATCHPAD_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SCRATCHPAD_MAX_TOTAL_IMAGE_BYTES = 200 * 1024 * 1024;
const SCRATCHPAD_LAYOUTS = new Set(["top", "left", "right", "bottom"]);
const SCRATCHPAD_IMAGE_SIZES = new Set(["small", "medium", "large", "full"]);
const SCRATCHPAD_COLORS = new Set(["yellow", "sage", "lavender", "rose", "ivory"]);
const SCRATCHPAD_CUSTOM_COLOR_RE = /^#[0-9a-f]{6}$/i;

// 프리셋 이름 또는 직접 고른 hex(#rrggbb)만 허용하고, 그 외에는 기본색으로 되돌린다.
function scratchpadNormalizeColor(value){
  if (SCRATCHPAD_COLORS.has(value)) return value;
  if (typeof value === "string" && SCRATCHPAD_CUSTOM_COLOR_RE.test(value.trim())) return value.trim().toLowerCase();
  return "yellow";
}

// 직접 고른 색은 CSS 프리셋 대신 인라인 변수로 종이·테두리·글자색을 입힌다.
function scratchpadApplyNoteColor(el, color){
  if (!el) return;
  const custom = !SCRATCHPAD_COLORS.has(color);
  el.dataset.noteColor = custom ? "custom" : color;
  if (custom){
    el.style.setProperty("--memo-paper", color);
    el.style.setProperty("--memo-paper-border", "color-mix(in srgb," + color + " 70%,var(--ink))");
    el.style.setProperty("--memo-ink", scratchpadInkForPaper(color));
  } else {
    el.style.removeProperty("--memo-paper");
    el.style.removeProperty("--memo-paper-border");
    el.style.removeProperty("--memo-ink");
  }
}

// 종이색 밝기에 따라 읽히는 글자색을 고른다(어두운 종이 → 밝은 글자).
function scratchpadInkForPaper(hex){
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? "#1f2937" : "#f8fafc";
}

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

// 표 블록: rows = 문자열 셀의 2차원 배열(직사각형), header=첫 행을 머리글로.
function scratchpadTableBlock(rows=2, cols=2){
  const r = Math.max(1, Math.min(SCRATCHPAD_MAX_TABLE_ROWS, rows | 0));
  const c = Math.max(1, Math.min(SCRATCHPAD_MAX_TABLE_COLS, cols | 0));
  const grid = Array.from({ length:r }, () => Array.from({ length:c }, () => ""));
  return { id:scratchpadBlockId("table"), type:"table", rows:grid, header:true, locked:false };
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
  const prefix = raw.type === "image" ? "image" : raw.type === "notebook-cell" ? "cell" : raw.type === "table" ? "table" : "text";
  const id = String(raw.id || "").trim() || scratchpadBlockId(prefix);
  if (raw.type === "table"){
    const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
    let cols = 0;
    for (const row of rawRows) if (Array.isArray(row)) cols = Math.max(cols, row.length);
    cols = Math.max(1, Math.min(SCRATCHPAD_MAX_TABLE_COLS, cols || 1));
    let rows = rawRows.filter(Array.isArray).slice(0, SCRATCHPAD_MAX_TABLE_ROWS).map(row => {
      const cells = row.slice(0, cols).map(cell => String(cell == null ? "" : cell).slice(0, 5000));
      while (cells.length < cols) cells.push("");
      return cells;
    });
    if (!rows.length) rows = [Array.from({ length:cols }, () => "")];
    return { id, type:"table", rows, header:raw.header !== false, locked:raw.locked === true };
  }
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
      locked:raw.locked === true,
      // 화이트보드에서 온 그림이면 편집용 벡터 스냅샷 에셋을 함께 가리킨다(없으면 빈 문자열).
      boardAssetId:String(raw.boardAssetId || "").trim(),
      boardName:String(raw.boardName || "").slice(0, 180)
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
      color:scratchpadNormalizeColor(raw.color),
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
    if (block.type === "table"){
      return (Array.isArray(block.rows) ? block.rows : [])
        .map(row => (Array.isArray(row) ? row : []).join("\t")).join("\n");
    }
    return String(block.text || "");
  }).join("\n\n");
}

function scratchpadNoteLines(note){
  return scratchpadPlainText(note).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function scratchpadClipLines(lines, maxLines, maxChars){
  const shown = lines.slice(0, maxLines).map(line => line.length > maxChars ? line.slice(0, maxChars) + "…" : line);
  if (lines.length > maxLines) shown.push("…");
  return shown;
}

// 탭에는 제목만 보여서 메모가 늘면 안에 뭐가 들었는지 알 수 없다. 마우스를 올렸을 때 쓸 본문 앞부분을 뽑는다.
function scratchpadPreviewLines(note, maxLines=3, maxChars=60){
  return scratchpadClipLines(scratchpadNoteLines(note), maxLines, maxChars);
}

// 긴 줄에서 찾은 말이 잘려 나가지 않도록 일치한 자리를 가운데 두고 앞뒤를 자른다.
function scratchpadClipAround(line, needle, maxChars){
  // 검색어 자체가 미리보기 폭보다 길어도 일치한 문자열은 온전히 남긴다.
  const clipChars = Math.max(maxChars, needle ? needle.length : 0);
  if (line.length <= clipChars) return line;
  const at = needle ? line.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return line.slice(0, clipChars) + "…";
  const start = Math.max(0, at - Math.floor((clipChars - needle.length) / 2));
  const end = Math.min(line.length, start + clipChars);
  return (start > 0 ? "…" : "") + line.slice(start, end) + (end < line.length ? "…" : "");
}

// 메모 목록·검색의 공통 계산. 검색어가 없으면 전부 앞부분 미리보기, 있으면 제목·본문이 맞는 메모만 일치한 줄과 함께 돌려준다.
function scratchpadSearchNotes(notes, query="", maxLines=3, maxChars=80){
  const needle = String(query || "").trim().toLowerCase();
  const result = [];
  for (const note of (Array.isArray(notes) ? notes : [])){
    const lines = scratchpadNoteLines(note);
    if (!needle){
      result.push({ note, lines: scratchpadClipLines(lines, maxLines, maxChars), hits: 0, titleHit: false });
      continue;
    }
    const titleHit = String(note.title || "").toLowerCase().includes(needle);
    const hitLines = lines.filter(line => line.toLowerCase().includes(needle));
    if (!titleHit && !hitLines.length) continue;
    const source = hitLines.length ? hitLines : lines;
    const shown = source.slice(0, maxLines).map(line => scratchpadClipAround(line, needle, maxChars));
    if (source.length > maxLines) shown.push("…");
    result.push({ note, lines: shown, hits: hitLines.length, titleHit });
  }
  return result;
}

// 카드에 붙일 한 줄 요약 — 글자 수와 이미지·표·셀 개수
function scratchpadNoteCounts(note){
  const blocks = (note && Array.isArray(note.blocks)) ? note.blocks : [];
  return {
    chars: blocks.reduce((sum, block) => sum + String(block.text || "").length, 0),
    images: blocks.filter(block => block.type === "image").length,
    tables: blocks.filter(block => block.type === "table").length,
    cells: blocks.filter(block => block.type === "notebook-cell").length
  };
}

function scratchpadT(text){
  return (typeof window !== "undefined" && typeof window.t === "function") ? window.t(text) : text;
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

// 메모창을 헤더 드래그로 옮기고, 네 변·네 모서리로 크기 조절. 위치·크기는 저장된다.
function makeMemoFloatable(panel, head, handle, storageKey=SCRATCHPAD_RECT_KEY){
  const MIN_W = 280, MIN_H = 200;
  let pinned = false;
  let edge = null;                                  // 아래에서 attachEdgeResize 로 채운다
  const syncEdge = () => { if (edge) edge.sync(); }; // 창이 움직이면 가장자리 핸들도 따라가야 한다
  const compactLayout = () => {
    try { return window.matchMedia("(max-width:600px), (max-height:520px)").matches; }
    catch(_){ return window.innerWidth <= 600 || window.innerHeight <= 520; }
  };
  const focusModeActive = () => panel.classList.contains("note-focus") || panel.classList.contains("block-focus");
  const save = () => {
    if (!pinned || compactLayout() || focusModeActive()) return;
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
    if (!pinned || panel.hidden || compactLayout() || focusModeActive()) return;
    const margin = 6;
    let r = panel.getBoundingClientRect();
    const width = Math.min(r.width, Math.max(MIN_W, window.innerWidth - margin * 2));
    const height = Math.min(r.height, Math.max(MIN_H, window.innerHeight - margin * 2));
    if (Math.abs(width - r.width) > 0.5) panel.style.width = width + "px";
    if (Math.abs(height - r.height) > 0.5) panel.style.height = height + "px";
    r = panel.getBoundingClientRect();
    panel.style.left = Math.max(margin, Math.min(r.left, window.innerWidth - r.width - margin)) + "px";
    panel.style.top = Math.max(margin, Math.min(r.top, window.innerHeight - r.height - margin)) + "px";
    syncEdge();
  };
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    // 예전 창 전체 최대화 저장본은 확대 전 좌표로 되돌리고, 이후에는 일반 좌표만 저장한다.
    const saved = stored && stored.max ? stored.prev : stored;
    if (saved && saved.w >= MIN_W && saved.h >= MIN_H){
      panel.style.left = saved.left + "px";
      panel.style.top = saved.top + "px";
      panel.style.width = saved.w + "px";
      panel.style.height = saved.h + "px";
      panel.style.transform = "none";
      pinned = true;
      if (stored && stored.max) localStorage.setItem(storageKey, JSON.stringify(saved));
    } else if (stored && stored.max){
      localStorage.removeItem(storageKey);
    }
  } catch(_){}
  head.addEventListener("pointerdown", event => {
    if (compactLayout() || focusModeActive() || event.target.closest("button")) return;
    event.preventDefault();
    pin();
    const rect = panel.getBoundingClientRect();
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    head.setPointerCapture(event.pointerId);
    const move = next => {
      panel.style.left = (next.clientX - dx) + "px";
      panel.style.top = (next.clientY - dy) + "px";
      syncEdge();
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
  // 크기 조절은 네 변·네 모서리 어디서나(모달과 같은 공용 핸들). handle 은 우하단 손잡이 '그림'으로만 남긴다.
  edge = typeof attachEdgeResize === "function" ? attachEdgeResize(panel, {
    enabled: () => !panel.hidden && !compactLayout() && !focusModeActive(),
    min: () => ({ w: MIN_W, h: MIN_H }),
    grip: false,                       // 손잡이 그림은 .scratchpad-resize 가 이미 그리고 있다
    zIndex: () => {
      let z = 0;
      try { z = parseInt(getComputedStyle(panel).zIndex, 10) || 0; } catch(_){}
      return (z || 130) + 1;           // 메모창 바로 위(테두리에 걸치는 띠라 창을 가리지 않는다)
    },
    onStart: pin,
    onEnd: () => { clamp(); save(); }
  }) : null;
  if (handle) handle.style.pointerEvents = "none";
  // 창을 닫을 때(hidden) 핸들도 같이 숨기고, 열 때 다시 맞춘다
  if (typeof MutationObserver !== "undefined"){
    new MutationObserver(() => requestAnimationFrame(syncEdge))
      .observe(panel, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
  }
  window.addEventListener("resize", clamp);
  return { clampOnOpen: () => { clamp(); syncEdge(); } };
}

function wireScratchpad(){
  const panel = byId("scratchpad");
  const openButtons = [...document.querySelectorAll("[data-scratchpad-open]")];
  const closeButton = byId("scratchpadClose");
  const editor = byId("scratchpadEditor");
  const tabs = byId("scratchpadTabs");
  const newButton = byId("scratchpadNew");
  const overview = byId("scratchpadOverview");
  const overviewButton = byId("scratchpadOverviewOpen");
  const overviewCards = byId("scratchpadCards");
  const overviewCount = byId("scratchpadOverviewCount");
  const overviewFullButton = byId("scratchpadOverviewFull");
  const searchInput = byId("scratchpadSearch");
  const addTextButton = byId("scratchpadAddText");
  const addTableButton = byId("scratchpadAddTable");
  const addImageButton = byId("scratchpadAddImage");
  const colorButtons = [...panel.querySelectorAll(".scratchpad-color[data-note-color]")];
  const customColorInput = byId("scratchpadColorCustom");
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
  let overviewFull = false;
  let noteFocus = false;
  let focusedNoteId = "";
  let focusedBlockId = "";
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
    block.type === "image" || block.type === "notebook-cell" || block.type === "table" || String(block.text || "").trim()
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
    const tables = note.blocks.filter(block => block.type === "table").length;
    count.textContent = window.tf("{n}자", { n: textLength.toLocaleString() }) +
      (images ? " · " + window.tf("이미지 {n}개", { n: images }) : "") + (cells ? " · " + window.tf("셀 {n}개", { n: cells }) : "") +
      (tables ? " · " + window.tf("표 {n}개", { n: tables }) : "");
  };
  // 탭 제목 + 본문 앞부분 미리보기 + 이름 변경 안내
  const tabTooltip = note => [
    note.title,
    scratchpadPreviewLines(note).join("\n") || scratchpadT("(빈 메모)"),
    scratchpadT("더블클릭 또는 F2로 이름 변경")
  ].join("\n");
  // 글을 고치면 탭을 다시 그리지 않으므로, 저장 시점에 현재 탭 미리보기만 갱신한다.
  const refreshActiveTabTooltip = () => {
    const note = activeNote();
    const tab = note ? byId("scratchpad-tab-" + note.id) : null;
    if (tab) tab.title = tabTooltip(note);
  };
  const persist = (announce=true) => {
    clearTimeout(saveTimer);
    saveTimer = 0;
    refreshActiveTabTooltip();
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
    note.blocks.some(block => block.type === "image" && (block.assetId === assetId || block.boardAssetId === assetId))
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
  const insertTableBlock = (focus=true) => {
    const note = activeNote();
    const block = scratchpadTableBlock(2, 2);
    note.blocks.splice(insertionIndex(note), 0, block);
    activeBlockId = block.id;
    note.updatedAt = Date.now();
    renderEditor();
    persist();
    if (focus){
      const target = editor.querySelector(`[data-block-id="${block.id}"] .scratchpad-table-cell`);
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
  const findImageBlockById = blockId => {
    if (!blockId) return null;
    for (const note of data.notes){
      const block = note.blocks.find(item => item && item.type === "image" && item.id === blockId);
      if (block) return { note, block };
    }
    return null;
  };
  /* 화이트보드에서 온 그림: 보이는 PNG(에셋) + 편집용 벡터 스냅샷(JSON 에셋)을 한 블록에 묶는다.
     options.blockId 가 살아 있으면 그 블록을 제자리에서 바꿔(왕복 편집), 없으면 새 블록으로 넣는다. */
  const addBoardBlock = async (pngBlob, boardData, options={}) => {
    if (!pngBlob || !pngBlob.size){ showStatus("화이트보드 그림을 받지 못했습니다.", false); return null; }
    if (pngBlob.size > SCRATCHPAD_MAX_IMAGE_BYTES){ showStatus("이미지 한 장은 25MB까지 넣을 수 있습니다.", false); return null; }
    let boardBlob = null;
    try { boardBlob = new Blob([JSON.stringify(boardData || {})], { type:"application/json" }); }
    catch(error){ console.warn("scratchpad board snapshot skipped:", error); }
    const found = findImageBlockById(options.blockId);
    if (found && found.block.locked){
      showStatus("잠긴 블록은 바꿀 수 없습니다. 먼저 잠금을 해제하세요.", false);
      return null;
    }
    const existing = allImageBlocks();
    if (!found && existing.length >= SCRATCHPAD_MAX_IMAGES){
      showStatus("메모 이미지는 최대 " + SCRATCHPAD_MAX_IMAGES + "개입니다.", false);
      return null;
    }
    // 제자리 교체는 바뀔 블록의 옛 용량을 빼고 합계를 따진다.
    let totalBytes = existing.reduce((sum, block) => sum + (Number(block.size) || 0), 0);
    if (found) totalBytes -= Number(found.block.size) || 0;
    if (totalBytes + pngBlob.size > SCRATCHPAD_MAX_TOTAL_IMAGE_BYTES){
      showStatus("메모 이미지 합계가 200MB를 넘습니다.", false);
      return null;
    }
    const assetId = scratchpadBlockId("asset");
    const boardAssetId = boardBlob ? scratchpadBlockId("asset") : "";
    let wrotePng = false, wroteBoard = false;
    try {
      await writeScratchpadAsset(assetId, pngBlob);
      wrotePng = true;
      if (boardBlob){ await writeScratchpadAsset(boardAssetId, boardBlob); wroteBoard = true; }
    } catch(error){
      console.error(error);
      if (wrotePng) try { await deleteScratchpadAsset(assetId); } catch(cleanupError){ console.warn("scratchpad board png rollback failed:", cleanupError); }
      if (wroteBoard) try { await deleteScratchpadAsset(boardAssetId); } catch(cleanupError){ console.warn("scratchpad board snapshot rollback failed:", cleanupError); }
      showStatus("화이트보드를 메모에 저장하지 못했습니다.", false);
      return null;
    }
    const name = String(options.name || "화이트보드.png").slice(0, 180);
    const boardName = String(options.boardName || "화이트보드").slice(0, 180);
    const previousActiveBlockId = activeBlockId;
    let note, block;
    let previousBlock = null, insertIndex = -1;
    if (found){
      note = found.note;
      block = found.block;
      previousBlock = { ...block };
      Object.assign(block, {
        assetId, boardAssetId, boardName, name,
        mime:String(pngBlob.type || "image/png"),
        size:pngBlob.size
      });
    } else {
      note = activeNote();
      block = {
        id:scratchpadBlockId("image"),
        type:"image",
        assetId,
        text:"",
        position:"left",
        width:"medium",
        name,
        mime:String(pngBlob.type || "image/png"),
        size:pngBlob.size,
        locked:false,
        boardAssetId,
        boardName
      };
      insertIndex = insertionIndex(note);
      note.blocks.splice(insertIndex, 0, block);
    }
    activeBlockId = block.id;
    const previousUpdatedAt = note.updatedAt;
    note.updatedAt = Date.now();
    // 새 참조가 localStorage에 확정되기 전에는 옛 에셋을 지우지 않는다. 저장 실패 시
    // 메모 객체와 새 IndexedDB 에셋을 모두 되돌려 재실행 후 깨진 참조가 남지 않게 한다.
    if (!persist(false)){
      if (previousBlock) Object.assign(block, previousBlock);
      else if (insertIndex >= 0) note.blocks.splice(insertIndex, 1);
      note.updatedAt = previousUpdatedAt;
      activeBlockId = previousActiveBlockId;
      try { await deleteScratchpadAsset(assetId); } catch(error){ console.warn("scratchpad board png rollback failed:", error); }
      if (boardAssetId) try { await deleteScratchpadAsset(boardAssetId); } catch(error){ console.warn("scratchpad board snapshot rollback failed:", error); }
      renderEditor();
      return null;
    }
    renderEditor();
    if (previousBlock){
      // 저장된 메타데이터가 새 id를 가리키는 것이 확정된 뒤에만 옛 에셋을 정리한다.
      await removeAssetIfUnused(previousBlock.assetId);
      await removeAssetIfUnused(previousBlock.boardAssetId);
    }
    if (options.open !== false) setOpen(true, false);
    showStatus(found ? "화이트보드를 메모에서 바꿨습니다." : "화이트보드를 메모에 넣었습니다.");
    return { blockId:block.id, replaced:!!found };
  };
  const removeBlock = async block => {
    const note = activeNote();
    if (block && block.locked){
      showStatus("잠긴 블록은 삭제할 수 없습니다. 먼저 잠금을 해제하세요.", false);
      return;
    }
    if (!block) return;
    if (focusedBlockId === block.id) setBlockFocus(false, block.id, false);
    const result = scratchpadRemoveBlock(note.blocks, block.id);
    if (!result) return;
    note.blocks = result.blocks;
    activeBlockId = result.activeId;
    note.updatedAt = Date.now();
    renderEditor();
    persist();
    if (result.removed && result.removed.type === "image"){
      await removeAssetIfUnused(result.removed.assetId);
      await removeAssetIfUnused(result.removed.boardAssetId);
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
  const makeBlockFocusButton = block => {
    const button = makeButton(
      focusedBlockId === block.id ? "⤡" : "⤢",
      scratchpadT(focusedBlockId === block.id ? "이전 크기로" : "이 블록만 크게 보기"),
      () => setBlockFocus(focusedBlockId !== block.id, block.id),
      "scratchpad-block-focus"
    );
    button.setAttribute("aria-label", scratchpadT(focusedBlockId === block.id ? "이전 크기로" : "이 블록만 크게 보기"));
    button.setAttribute("aria-pressed", String(focusedBlockId === block.id));
    return button;
  };
  const makeBlockShell = block => {
    const shell = document.createElement("article");
    shell.className = "scratchpad-block scratchpad-" + block.type + "-block";
    shell.classList.toggle("locked", !!block.locked);
    shell.classList.toggle("focused-block", focusedBlockId === block.id);
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
      makeBlockFocusButton(block),
      makeButton("↑", "이 블록을 위로", () => moveBlock(block, -1)),
      makeButton("↓", "이 블록을 아래로", () => moveBlock(block, 1)),
      makeButton("×", "이 글 블록 삭제", () => removeBlock(block), "danger")
    );
    if (block.locked){
      [...tools.querySelectorAll("button")].forEach(button => {
        if (!button.classList.contains("scratchpad-lock") && !button.classList.contains("scratchpad-block-focus")) button.disabled = true;
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
    // 우클릭 편집 메뉴(복사·붙여넣기·특수문자). 한자키가 없는 편집기라 ※ ○ ① 은 여기로 넣는다.
    // 잠근 블록은 붙이지 않는다 — 메뉴의 넣기는 readOnly 를 그냥 통과해 버린다.
    if (!block.locked && typeof attachTextCaseContextMenu === "function") attachTextCaseContextMenu(textarea);
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
  const makeTableBlock = block => {
    const shell = makeBlockShell(block);
    let focusR = 0, focusC = 0;
    const cols = () => (block.rows[0] ? block.rows[0].length : 0);
    const lockedMsg = () => showStatus("잠긴 블록은 편집할 수 없습니다. 먼저 잠금을 해제하세요.", false);
    const host = () => editor.querySelector(`[data-block-id="${block.id}"]`);
    const focusCell = (r, c) => {
      const node = host();
      if (!node) return;
      const cell = node.querySelector(`.scratchpad-table-cell[data-r="${r}"][data-c="${c}"]`);
      if (!cell) return;
      cell.focus();
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    // 구조 변경(행·열 추가/삭제·머리글)은 모델을 바꾼 뒤 전체 렌더 후 셀로 다시 포커스한다.
    const commit = () => {
      const note = activeNote();
      if (note) note.updatedAt = Date.now();
      renderEditor();
      persist();
    };
    const addRow = at => {
      if (block.locked) return lockedMsg();
      if (block.rows.length >= SCRATCHPAD_MAX_TABLE_ROWS){ showStatus("표는 최대 " + SCRATCHPAD_MAX_TABLE_ROWS + "행까지 넣을 수 있습니다.", false); return; }
      const idx = Math.max(0, Math.min(block.rows.length, at == null ? block.rows.length : at));
      block.rows.splice(idx, 0, Array.from({ length:cols() }, () => ""));
      commit();
    };
    const addCol = at => {
      if (block.locked) return lockedMsg();
      if (cols() >= SCRATCHPAD_MAX_TABLE_COLS){ showStatus("표는 최대 " + SCRATCHPAD_MAX_TABLE_COLS + "열까지 넣을 수 있습니다.", false); return; }
      const idx = Math.max(0, Math.min(cols(), at == null ? cols() : at));
      block.rows.forEach(row => row.splice(idx, 0, ""));
      commit();
    };
    const delRow = at => {
      if (block.locked) return lockedMsg();
      if (block.rows.length <= 1){ showStatus("행이 하나뿐이라 삭제할 수 없습니다.", false); return; }
      block.rows.splice(Math.max(0, Math.min(block.rows.length - 1, at)), 1);
      commit();
    };
    const delCol = at => {
      if (block.locked) return lockedMsg();
      if (cols() <= 1){ showStatus("열이 하나뿐이라 삭제할 수 없습니다.", false); return; }
      block.rows.forEach(row => row.splice(Math.max(0, Math.min(cols() - 1, at)), 1));
      commit();
    };
    const toggleHeader = () => {
      if (block.locked) return lockedMsg();
      block.header = !block.header;
      commit();
    };
    // 블록 공통 도구(핸들·잠금·이동·삭제) — 글 블록과 동일
    const tools = document.createElement("div");
    tools.className = "scratchpad-block-tools";
    tools.append(
      makeBlockHandle(block),
      makeLockButton(block),
      makeBlockFocusButton(block),
      makeButton("↑", "이 블록을 위로", () => moveBlock(block, -1)),
      makeButton("↓", "이 블록을 아래로", () => moveBlock(block, 1)),
      makeButton("×", "이 표 블록 삭제", () => removeBlock(block), "danger")
    );
    // 표 전용 도구 — 현재 포커스된 셀 기준으로 행·열을 다룬다
    const tableTools = document.createElement("div");
    tableTools.className = "scratchpad-table-tools";
    const headerBtn = makeButton("머리글", "첫 행을 머리글로 표시", () => toggleHeader(),
      "scratchpad-table-toggle" + (block.header ? " active" : ""));
    headerBtn.setAttribute("aria-pressed", String(block.header));
    tableTools.append(
      headerBtn,
      makeButton("＋행", "현재 행 아래에 행 추가", () => { const r = focusR; addRow(r + 1); focusCell(Math.min(block.rows.length - 1, r + 1), focusC); }),
      makeButton("－행", "현재 행 삭제", () => { const r = focusR; delRow(r); focusCell(Math.min(block.rows.length - 1, r), Math.min(cols() - 1, focusC)); }),
      makeButton("＋열", "현재 열 오른쪽에 열 추가", () => { const c = focusC; addCol(c + 1); focusCell(focusR, Math.min(cols() - 1, c + 1)); }),
      makeButton("－열", "현재 열 삭제", () => { const c = focusC; delCol(c); focusCell(Math.min(block.rows.length - 1, focusR), Math.min(cols() - 1, c)); })
    );
    // 표를 바깥으로 꺼내기 — 복사(TSV)·CSV 저장·표 편집기 탭. 읽기만 하는 동작이라 잠긴 블록에서도 쓸 수 있다.
    const outTools = document.createElement("div");
    outTools.className = "scratchpad-table-out";
    const exportBaseName = () => {
      const note = activeNote();
      const tables = note ? note.blocks.filter(item => item.type === "table") : [];
      const index = tables.findIndex(item => item.id === block.id);
      return MNTableExport.suggestBase((note && note.title) || "메모", Math.max(0, index), tables.length);
    };
    outTools.append(
      makeButton("복사", "표 전체를 탭 구분으로 복사 — 엑셀·한글에 그대로 붙여넣기",
        () => MNTableExport.copyTable(block, { notify:showStatus })),
      makeButton("⬇ CSV", "표를 엑셀에서 열 수 있는 CSV 파일로 저장",
        () => MNTableExport.saveCsv(block, { baseName:exportBaseName(), notify:showStatus })),
      makeButton("편집기로", "이 표의 복사본을 새 탭의 표 편집기(xlsx)로 열기 — 거기서 고친 값은 메모로 돌아오지 않아요",
        () => MNTableExport.openInEditor(block, { baseName:exportBaseName(), notify:showStatus })),
      makeButton("변환", "이 표를 JSON·XML·마크다운 등 다른 형식으로 바꾸기 — 결과는 복사본으로만 나가요",
        () => MNTableExport.openConvert(block, { baseName:exportBaseName(), notify:showStatus }))
    );
    tableTools.appendChild(outTools);
    if (block.locked){
      [...tools.querySelectorAll("button"), ...tableTools.querySelectorAll("button")].forEach(button => {
        if (button.classList.contains("scratchpad-lock") || button.classList.contains("scratchpad-block-focus") || button.closest(".scratchpad-table-out")) return;
        button.disabled = true;
      });
    }
    // 셀 입력 중 방향 이동. 구조가 바뀌는 Enter/Tab만 여기서 가로챈다.
    const handleKey = (event, r, c) => {
      if (event.key === "Escape"){ event.preventDefault(); event.stopPropagation(); closeByEscape(); return; }
      const nCols = cols(), nRows = block.rows.length;
      if (event.key === "Tab"){
        event.preventDefault();
        let idx = r * nCols + c + (event.shiftKey ? -1 : 1);
        if (idx < 0) idx = 0;
        if (idx > nRows * nCols - 1){ addRow(nRows); focusCell(nRows, 0); return; }
        focusCell(Math.floor(idx / nCols), idx % nCols);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey){
        event.preventDefault();
        if (r === nRows - 1){ addRow(nRows); focusCell(nRows, c); }
        else focusCell(r + 1, c);
        return;
      }
      if (shortcutActionForEvent(event) === "saveCurrent"){ event.preventDefault(); event.stopPropagation(); persist(); }
    };
    const makeCell = (r, c) => {
      const isHeader = block.header && r === 0;
      const cell = document.createElement(isHeader ? "th" : "td");
      const box = document.createElement("div");
      box.className = "scratchpad-table-cell";
      box.contentEditable = block.locked ? "false" : "true";
      box.textContent = block.rows[r][c] || "";
      box.dataset.r = String(r);
      box.dataset.c = String(c);
      box.setAttribute("role", "textbox");
      box.setAttribute("aria-label", (r + 1) + "행 " + (c + 1) + "열");
      if (!block.locked){
        box.addEventListener("focus", () => { focusR = r; focusC = c; activeBlockId = block.id; });
        box.addEventListener("input", () => { block.rows[r][c] = box.textContent; touchNote(); });
        box.addEventListener("paste", event => {
          event.preventDefault();
          const text = ((event.clipboardData || window.clipboardData) || { getData:() => "" }).getData("text/plain");
          document.execCommand("insertText", false, String(text || "").replace(/[\t\r\n]+/g, " "));
        });
        box.addEventListener("keydown", event => handleKey(event, r, c));
        // 셀 우클릭: 복사·붙여넣기·특수문자(한자키 대신). 셀은 한 줄이라 줄바꿈은 공백으로 눕힌다.
        if (typeof attachEditableContextMenu === "function"){
          attachEditableContextMenu(box, { sanitize:(text) => text.replace(/[\t\r\n]+/g, " ") });
        }
      }
      cell.appendChild(box);
      return cell;
    };
    const table = document.createElement("table");
    table.className = "scratchpad-table";
    for (let r = 0; r < block.rows.length; r++){
      const tr = document.createElement("tr");
      for (let c = 0; c < block.rows[r].length; c++) tr.appendChild(makeCell(r, c));
      table.appendChild(tr);
    }
    const scroller = document.createElement("div");
    scroller.className = "scratchpad-table-scroll";
    scroller.appendChild(table);
    shell.append(tools, tableTools, scroller);
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
    // 화이트보드에서 온 그림만: 벡터 스냅샷을 되살려 새 화이트보드 탭으로 연다(왕복 편집).
    const boardBtn = block.boardAssetId ? makeButton("✏️ 화이트보드로", "화이트보드로 다시 열어 편집 — 고친 뒤 '메모로'를 누르면 이 블록이 바뀝니다", async () => {
      if (typeof newWhiteboard !== "function"){ showStatus("화이트보드를 열 수 없습니다.", false); return; }
      let state = null;
      try {
        const blob = await readScratchpadAsset(block.boardAssetId);
        if (blob) state = JSON.parse(await blob.text());
      } catch(error){ console.warn("scratchpad board read failed:", error); }
      if (!state){
        showStatus("이 그림의 화이트보드 정보가 저장소에서 사라졌어요 — 다시 편집할 수 없습니다.", false);
        return;
      }
      newWhiteboard({ state, name:block.boardName || "화이트보드", memoBlockId:block.id });
      setOpen(false);                                     // 메모를 닫아 새 화이트보드 탭이 보이게
      if (typeof toast === "function") toast("화이트보드로 열었어요. 고친 뒤 '메모로'를 누르면 이 메모 블록이 바뀝니다.", 3200);
    }, "scratchpad-reuse") : null;
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
      makeBlockFocusButton(block),
      layoutGroup,
      size,
      makeButton("블록 ↑", "이미지 블록을 위로", () => moveBlock(block, -1)),
      makeButton("블록 ↓", "이미지 블록을 아래로", () => moveBlock(block, 1)),
      copyBtn,
      fileBtn,
      editBtn,
      ...(boardBtn ? [boardBtn] : []),
      imageMemoBtn,
      makeButton("삭제", "이 이미지 블록 삭제", () => removeBlock(block), "danger")
    );
    if (block.locked){
      [...tools.querySelectorAll("button,select")].forEach(control => {
        if (!control.classList.contains("scratchpad-lock") && !control.classList.contains("scratchpad-block-focus") && !control.classList.contains("scratchpad-reuse")) control.disabled = true;
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
    if (!block.locked && typeof attachTextCaseContextMenu === "function") attachTextCaseContextMenu(text);
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
      makeBlockFocusButton(block),
      makeButton("↑", "이 셀 블록을 위로", () => moveBlock(block, -1)),
      makeButton("↓", "이 셀 블록을 아래로", () => moveBlock(block, 1)),
      paste,
      makeButton("×", "이 셀 블록 삭제", () => removeBlock(block), "danger")
    );
    if (block.locked){
      [...tools.querySelectorAll("button")].forEach(button => {
        if (!button.classList.contains("scratchpad-lock") && !button.classList.contains("scratchpad-block-focus") && !button.classList.contains("scratchpad-reuse")) button.disabled = true;
      });
    }
    const card = document.createElement("div");
    card.className = "scratchpad-notebook-card";
    const badge = document.createElement("strong");
    const cellType = block.cell && block.cell.type;
    badge.className = "scratchpad-notebook-badge type-" + (cellType || "code");
    badge.textContent = cellType === "markdown" ? "마크다운 셀" : cellType === "raw" ? "Raw 셀" : "코드 셀";
    const source = document.createElement("pre");
    source.className = "scratchpad-notebook-source" + (cellType === "code" ? " code-color-target" : "");
    if (cellType === "code" && typeof highlightCode === "function"){
      source.innerHTML = highlightCode(String(block.cell && block.cell.source || ""), "python");
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
    scratchpadApplyNoteColor(panel, note.color);
    const isCustomColor = !SCRATCHPAD_COLORS.has(note.color);
    colorButtons.forEach(button =>
      button.setAttribute("aria-pressed", String(!isCustomColor && button.dataset.noteColor === note.color))
    );
    if (customColorInput){
      customColorInput.classList.toggle("active", isCustomColor);
      if (isCustomColor) customColorInput.value = note.color;
    }
    editor.setAttribute("aria-label", note.title + " 내용");
    editor.setAttribute("aria-labelledby", "scratchpad-tab-" + note.id);
    editor.replaceChildren(...note.blocks.map(block =>
      block.type === "image" ? makeImageBlock(block)
        : block.type === "notebook-cell" ? makeNotebookCellBlock(block)
        : block.type === "table" ? makeTableBlock(block)
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
    if (focusedBlockId) setBlockFocus(false, focusedBlockId, false);
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
    const assets = note.blocks.filter(block => block.type === "image")
      .flatMap(block => [block.assetId, block.boardAssetId]).filter(Boolean);
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
      scratchpadApplyNoteColor(item, note.color);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "scratchpad-tab-main";
      tab.id = "scratchpad-tab-" + note.id;
      tab.textContent = note.title;
      tab.title = tabTooltip(note);
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
    if (overviewOpen()) renderOverview();   // 목록을 펼친 채로 메모가 늘거나 줄면 카드도 따라간다
  }

  // ── 메모 목록(카드 격자)과 전 메모 검색 ─────────────────────────────
  // 탭을 없애지 않는다. 목록은 편집 영역 위에 잠깐 덮였다가, 메모를 고르면 다시 걷힌다.
  const overviewOpen = () => !!(overview && !overview.hidden);
  const noteMetaText = note => {
    const counts = scratchpadNoteCounts(note);
    const parts = [];
    const updated = formatNoteTime(note.updatedAt);
    if (updated) parts.push(updated);
    parts.push(window.tf("{n}자", { n: counts.chars.toLocaleString() }));
    if (counts.images) parts.push(window.tf("이미지 {n}개", { n: counts.images }));
    if (counts.tables) parts.push(window.tf("표 {n}개", { n: counts.tables }));
    if (counts.cells) parts.push(window.tf("셀 {n}개", { n: counts.cells }));
    return parts.join(" · ");
  };
  const formatNoteTime = stamp => {
    if (!stamp) return "";
    const date = new Date(stamp);
    if (isNaN(date.getTime())) return "";
    const locale = (window.MNI18N && window.MNI18N.lang === "en") ? "en-US" : "ko-KR";
    return date.toDateString() === new Date().toDateString()
      ? date.toLocaleTimeString(locale, { hour:"2-digit", minute:"2-digit" })
      : date.toLocaleDateString(locale, { month:"short", day:"numeric" });
  };
  // 찾은 말에 표시를 남긴다. innerHTML 을 쓰지 않고 텍스트 노드와 <mark> 로만 만든다.
  const appendHighlighted = (host, text, needle) => {
    if (!needle){ host.appendChild(document.createTextNode(text)); return; }
    const lower = text.toLowerCase();
    let from = 0;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)){
      if (at > from) host.appendChild(document.createTextNode(text.slice(from, at)));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(at, at + needle.length);
      host.appendChild(mark);
      from = at + needle.length;
    }
    host.appendChild(document.createTextNode(text.slice(from)));
  };
  const openNoteFromOverview = note => {
    if (noteFocus) setNoteFocus(false, "", false);
    setOverview(false, false);
    switchNote(note.id);
  };
  const makeOverviewBlock = (block, needle, token) => {
    const shell = document.createElement("section");
    shell.className = "scratchpad-overview-block type-" + block.type;
    if (block.type === "image"){
      shell.classList.add("scratchpad-overview-image");
      const picture = document.createElement("div");
      picture.className = "scratchpad-overview-image-picture";
      const image = document.createElement("img");
      image.alt = block.name || "메모 이미지";
      image.draggable = false;
      const loading = document.createElement("span");
      loading.textContent = scratchpadT("이미지 불러오는 중…");
      picture.append(image, loading);
      assetUrl(block.assetId).then(url => {
        if (token !== renderToken || !image.isConnected) return;
        if (url){ image.src = url; loading.remove(); }
        else loading.textContent = scratchpadT("이미지 데이터가 사라졌습니다.");
      }).catch(() => {
        if (token === renderToken && loading.isConnected) loading.textContent = scratchpadT("이미지를 불러오지 못했습니다.");
      });
      const copy = document.createElement("div");
      copy.className = "scratchpad-overview-image-copy";
      const name = document.createElement("strong");
      appendHighlighted(name, block.name || "메모 이미지", needle);
      copy.appendChild(name);
      if (String(block.text || "").trim()){
        const description = document.createElement("p");
        appendHighlighted(description, String(block.text || ""), needle);
        copy.appendChild(description);
      }
      shell.append(picture, copy);
      return shell;
    }
    if (block.type === "table"){
      shell.classList.add("scratchpad-overview-table");
      const table = document.createElement("table");
      const rows = Array.isArray(block.rows) ? block.rows : [];
      rows.forEach((row, r) => {
        const tr = document.createElement("tr");
        (Array.isArray(row) ? row : []).forEach(value => {
          const cell = document.createElement(block.header && r === 0 ? "th" : "td");
          appendHighlighted(cell, String(value || ""), needle);
          tr.appendChild(cell);
        });
        table.appendChild(tr);
      });
      shell.appendChild(table);
      return shell;
    }
    if (block.type === "notebook-cell"){
      shell.classList.add("scratchpad-overview-cell");
      const cellType = block.cell && block.cell.type;
      const badge = document.createElement("strong");
      badge.textContent = cellType === "markdown" ? scratchpadT("마크다운 셀") : cellType === "raw" ? "Raw 셀" : scratchpadT("코드 셀");
      const source = document.createElement("pre");
      const text = String(block.cell && block.cell.source || "");
      if (text.trim()) appendHighlighted(source, text, needle);
      else source.textContent = scratchpadT("(빈 셀)");
      shell.append(badge, source);
      return shell;
    }
    const text = document.createElement("pre");
    text.className = "scratchpad-overview-text";
    const value = String(block.text || "");
    if (value.trim()) appendHighlighted(text, value, needle);
    else text.textContent = scratchpadT("(빈 메모)");
    shell.appendChild(text);
    return shell;
  };
  const makeNoteCard = ({ note, lines }, needle="", full=false, token=renderToken) => {
    const card = document.createElement("article");
    card.className = "scratchpad-card" + (note.id === data.activeId ? " active" : "");
    card.dataset.noteId = note.id;
    scratchpadApplyNoteColor(card, note.color);
    const cardHead = document.createElement("div");
    cardHead.className = "scratchpad-card-head";
    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "scratchpad-card-heading";
    heading.setAttribute("aria-label", note.title + " 메모 편집");
    const title = document.createElement("strong");
    appendHighlighted(title, note.title, needle);
    const meta = document.createElement("span");
    meta.className = "scratchpad-card-meta";
    meta.textContent = noteMetaText(note);
    heading.append(title, meta);
    heading.addEventListener("click", () => openNoteFromOverview(note));
    const actions = document.createElement("div");
    actions.className = "scratchpad-card-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = scratchpadT("편집");
    edit.setAttribute("aria-label", note.title + " · " + scratchpadT("편집"));
    edit.addEventListener("click", () => openNoteFromOverview(note));
    const enlarge = document.createElement("button");
    enlarge.type = "button";
    enlarge.className = "scratchpad-card-enlarge";
    const focused = noteFocus && focusedNoteId === note.id;
    enlarge.textContent = focused ? scratchpadT("⤡ 이전 크기") : scratchpadT("⤢ 크게 보기");
    enlarge.title = focused ? scratchpadT("이전 크기로") : scratchpadT("현재 메모만 크게 보기");
    enlarge.setAttribute("aria-label", note.title + " · " + enlarge.title);
    enlarge.setAttribute("aria-pressed", String(focused));
    enlarge.addEventListener("click", () => setNoteFocus(!focused, note.id));
    actions.append(edit, enlarge);
    cardHead.append(heading, actions);
    const body = document.createElement("div");
    body.className = "scratchpad-card-body";
    if (full){
      body.classList.add("scratchpad-overview-blocks");
      note.blocks.forEach(block => body.appendChild(makeOverviewBlock(block, needle, token)));
    } else if (lines.length){
      appendHighlighted(body, lines.join("\n"), needle);
    } else {
      body.textContent = scratchpadT("(빈 메모)");
      body.classList.add("empty");
    }
    card.append(cardHead, body);
    card.addEventListener("click", event => {
      if (event.target.closest("button") || full) return;
      openNoteFromOverview(note);
    });
    return card;
  };
  const syncOverviewFullButton = () => {
    if (!overviewFullButton) return;
    const label = overviewFull ? scratchpadT("간단히 보기") : scratchpadT("모든 메모 전체 내용 보기");
    overviewFullButton.textContent = overviewFull ? scratchpadT("간단히 보기") : scratchpadT("전체 내용 보기");
    overviewFullButton.title = label;
    overviewFullButton.setAttribute("aria-label", label);
    overviewFullButton.setAttribute("aria-pressed", String(overviewFull));
  };
  function renderOverview(){
    if (!overview) return;
    const token = ++renderToken;
    const query = searchInput ? searchInput.value : "";
    let results = scratchpadSearchNotes(data.notes, query);
    if (noteFocus){
      const focused = data.notes.find(note => note.id === focusedNoteId);
      const matched = results.find(result => result.note.id === focusedNoteId);
      results = matched ? [matched] : (focused ? scratchpadSearchNotes([focused], "") : []);
    }
    const needle = String(query || "").trim().toLowerCase();
    const showFull = overviewFull || noteFocus;
    overviewCards.textContent = "";
    overviewCards.classList.toggle("full-content", showFull);
    overviewCards.classList.toggle("single-note", noteFocus);
    for (const result of results) overviewCards.appendChild(makeNoteCard(result, needle, showFull, token));
    if (!results.length){
      const empty = document.createElement("p");
      empty.className = "scratchpad-cards-empty";
      empty.textContent = scratchpadT("찾는 내용이 있는 메모가 없습니다.");
      overviewCards.appendChild(empty);
    }
    if (overviewCount){
      overviewCount.textContent = String(query || "").trim()
        ? window.tf("메모 {n}개 찾음", { n: results.length })
        : window.tf("메모 {n}개", { n: data.notes.length });
    }
    syncOverviewFullButton();
  }
  const setOverview = (open, focus=true) => {
    if (!overview || !overviewButton) return;
    if (open && focusedBlockId) setBlockFocus(false, focusedBlockId, false);
    if (!open && noteFocus) setNoteFocus(false, "", false);
    if (open && saveTimer) persist(false);   // 목록에 방금 친 글까지 보이게 대기 중인 저장을 먼저 확정
    overview.hidden = !open;
    editor.hidden = open;                    // 격자와 편집 영역은 같은 칸을 나눠 쓴다(둘 중 하나만 놓인다)
    panel.classList.toggle("overview-open", open);
    overviewButton.setAttribute("aria-pressed", String(open));
    if (open){
      renderOverview();
      if (focus && searchInput) searchInput.focus();
    } else {
      if (searchInput) searchInput.value = "";
      if (focus) focusFirstEditor();
    }
  };
  function setNoteFocus(open, noteId="", focus=true){
    if (open){
      if (!data.notes.some(note => note.id === noteId)) return;
      if (!overviewOpen()) setOverview(true, false);
      focusedNoteId = noteId;
    } else {
      focusedNoteId = "";
    }
    noteFocus = !!open;
    panel.classList.toggle("note-focus", noteFocus);
    if (overviewOpen()) renderOverview();
    if (!noteFocus && memoFloat) memoFloat.clampOnOpen();
    if (focus) setTimeout(() => {
      const target = noteFocus ? overviewCards.querySelector(".scratchpad-card-enlarge") : searchInput;
      if (target) target.focus();
    }, 0);
  }
  function setBlockFocus(open, blockId="", focus=true){
    const note = activeNote();
    if (open && (!note || !note.blocks.some(block => block.id === blockId))) return;
    focusedBlockId = open ? blockId : "";
    panel.classList.toggle("block-focus", !!focusedBlockId);
    editor.querySelectorAll(".scratchpad-block").forEach(node =>
      node.classList.toggle("focused-block", node.dataset.blockId === focusedBlockId)
    );
    editor.querySelectorAll(".scratchpad-block-focus").forEach(button => {
      const selected = !!focusedBlockId && button.closest(".scratchpad-block")?.dataset.blockId === focusedBlockId;
      button.textContent = selected ? "⤡" : "⤢";
      button.title = scratchpadT(selected ? "이전 크기로" : "이 블록만 크게 보기");
      button.setAttribute("aria-label", scratchpadT(selected ? "이전 크기로" : "이 블록만 크게 보기"));
      button.setAttribute("aria-pressed", String(selected));
    });
    if (!focusedBlockId && memoFloat) memoFloat.clampOnOpen();
    if (focus) setTimeout(() => {
      const targetId = open ? focusedBlockId : blockId;
      const target = editor.querySelector(`[data-block-id="${targetId}"] .scratchpad-block-focus`);
      if (target) target.focus();
    }, 0);
  }
  const setOpen = (open, focus=true) => {
    if (!open && overviewOpen()) setOverview(false, false);   // 다시 열면 늘 편집 화면부터
    if (!open && noteFocus) setNoteFocus(false, "", false);
    if (!open && focusedBlockId) setBlockFocus(false, focusedBlockId, false);
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
    if (focusedBlockId){ setBlockFocus(false, focusedBlockId); return; }
    if (noteFocus){ setNoteFocus(false); return; }
    setOpen(false);
  };

  const localizedDefaultTitles = localizeScratchpadDefaultTitles(data.notes);
  activeBlockId = activeNote().blocks[0].id;
  renderEditor();
  renderTabs();
  syncOverviewFullButton();
  persist(localizedDefaultTitles);
  window.addEventListener("mni18nchange", () => {
    if (localizeScratchpadDefaultTitles(data.notes)){
      renderEditor();
      renderTabs();
      persist(false);
    } else if (overviewOpen()) renderOverview();
    syncOverviewFullButton();
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
    setOverview(false, false);   // 새 메모는 바로 쓰기 시작하는 게 목적이니 목록을 걷는다
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
  if (overviewButton) overviewButton.addEventListener("click", () => setOverview(!overviewOpen()));
  if (overviewFullButton) overviewFullButton.addEventListener("click", () => { overviewFull = !overviewFull; renderOverview(); });
  if (searchInput){
    searchInput.addEventListener("input", () => renderOverview());
    searchInput.addEventListener("keydown", event => {
      if (event.key === "Escape"){
        event.preventDefault();
        event.stopPropagation();
        if (searchInput.value){ searchInput.value = ""; renderOverview(); }   // 먼저 검색어만 비운다
        else setOverview(false);
        return;
      }
      if (event.key !== "Enter") return;   // 첫 번째 결과로 바로 이동
      event.preventDefault();
      const first = overviewCards.querySelector(".scratchpad-card-heading");
      if (first) first.click();
    });
  }
  if (addTextButton) addTextButton.addEventListener("click", () => insertTextBlock());
  if (addTableButton) addTableButton.addEventListener("click", () => insertTableBlock());
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
  if (customColorInput){
    customColorInput.addEventListener("input", () => {
      // 드래그 중에는 화면만 미리 반영하고, 확정(change)에서 저장한다.
      scratchpadApplyNoteColor(panel, customColorInput.value);
      const activeTab = tabs.querySelector(".scratchpad-tab.active");
      if (activeTab) scratchpadApplyNoteColor(activeTab, customColorInput.value);
    });
    customColorInput.addEventListener("change", () => {
      const note = activeNote();
      if (!note) return;
      const color = scratchpadNormalizeColor(customColorInput.value);
      if (note.color !== color){
        note.color = color;
        note.updatedAt = Date.now();
        persist();
      }
      renderEditor();
      renderTabs();
    });
  }
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
    const assets = note.blocks.filter(block => block.type === "image")
      .flatMap(block => [block.assetId, block.boardAssetId]).filter(Boolean);
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
  // 화이트보드 → 메모(그림 + 편집용 스냅샷). 반환 {blockId,replaced} 를 보드가 기억해 다음엔 제자리 교체.
  window.addBoardToScratchpad = async (pngBlob, boardData, options={}) => {
    setOpen(true, false);
    return addBoardBlock(pngBlob, boardData, options);
  };
  // 전체 백업 버튼은 0.35초 자동저장 대기 중인 마지막 입력까지 즉시 확정한다.
  window.flushScratchpadBackup = () => persist(false);
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
  window.openScratchpadOverview = () => { setOpen(true, false); setOverview(true); };
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden && !document.querySelector(".modal:not([hidden])")){
      event.preventDefault();
      if (focusedBlockId) setBlockFocus(false, focusedBlockId); // 크게 본 편집 블록만 먼저 원래 메모로 되돌린다
      else if (noteFocus) setNoteFocus(false);       // 크게 본 카드만 먼저 원래 목록으로 되돌린다
      else if (overviewOpen()) setOverview(false);   // 목록만 먼저 걷고 메모창은 열어 둔다
      else closeByEscape();
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
    scratchpadNormalizeColor,
    scratchpadNextTitle,
    scratchpadRemoveBlock,
    scratchpadNormalizeBlock,
    scratchpadNormalizeNotebookCell,
    scratchpadPlainText,
    scratchpadPreviewLines,
    scratchpadClipAround,
    scratchpadSearchNotes,
    scratchpadNoteCounts,
    scratchpadHasLockedBlocks,
    scratchpadImageSources
  };
}
