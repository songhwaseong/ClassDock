"use strict";

/* ===== 티어표(.tier) =====
   아래 카드 모음(사진·글)을 끌어다 S·A·B·C·D 같은 등급 줄에 올려 순서를 매기는 문서.
   파일은 JSON 하나 — 사진은 작게 줄여 data URL 로 담는다(카드 한 장이 수백 KB 를 넘지 않게).
   카드 차례는 items 배열 순서 그대로이고, tier 가 "" 인 카드가 아래 모음(아직 안 올린 카드)이다. */
const TIER_DOC_TYPE = "classdock-tier";
const TIER_DOC_VERSION = 1;
const TIER_MAX_TIERS = 20;
const TIER_MAX_ITEMS = 400;
const TIER_HISTORY_LIMIT = 60;
const TIER_RECOVERY_DELAY = 700;
const TIER_IMAGE_MAX_SIDE = 360;
const TIER_IMAGE_MAX_CHARS = 400 * 1024;
const TIER_CARD_SIZES = { s:64, m:88, l:120 };
const TIER_COLORS = ["#ff7f7f", "#ffbf7f", "#ffdf7f", "#ffff7f", "#bfff7f", "#7fff7f", "#7fffff", "#7fbfff", "#bf7fff", "#ff7fbf", "#cfcfcf", "#8a8a8a"];
/* 줄 틀 — 새로 만들 때는 첫째(S~D). ⋯ 메뉴에서 바꾸면 같은 차례의 줄에 있던 카드는 그대로 남는다. */
const TIER_PRESETS = [
  { id:"sabcd", label:"S · A · B · C · D", tiers:["S", "A", "B", "C", "D"] },
  { id:"sabcdf", label:"S · A · B · C · D · F", tiers:["S", "A", "B", "C", "D", "F"] },
  { id:"rank", label:"1등 ~ 5등", tiers:["1등", "2등", "3등", "4등", "5등"] },
  { id:"level", label:"상 · 중 · 하", tiers:["상", "중", "하"] },
  { id:"like", label:"좋아요 · 보통 · 별로", tiers:["좋아요", "보통", "별로"] },
  { id:"important", label:"매우 중요 ~ 덜 중요", tiers:["매우 중요", "중요", "보통", "덜 중요"] }
];
let _tierScratchCount = 0;

function tierId(prefix){ return (prefix || "t") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function tierText(value, max){ return String(value == null ? "" : value).slice(0, max); }
function tierColor(value, fallback){ const text = String(value || "").trim(); return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : (fallback || TIER_COLORS[0]); }
function tierPresetTiers(presetId){
  const preset = TIER_PRESETS.find(item => item.id === presetId) || TIER_PRESETS[0];
  return preset.tiers.map((label, index) => ({ id:tierId("row"), label, color:TIER_COLORS[Math.min(index, TIER_COLORS.length - 1)] }));
}
function tierNormalizeImage(raw){
  const value = raw && typeof raw === "object" ? raw : null, dataUrl = value ? String(value.dataUrl || "") : "";
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(dataUrl) || dataUrl.length > TIER_IMAGE_MAX_CHARS) return null;
  return { dataUrl, width:Math.max(1, Math.min(10000, Number(value.width) || 1)), height:Math.max(1, Math.min(10000, Number(value.height) || 1)) };
}
function tierNormalizeTier(raw, index){
  const value = raw && typeof raw === "object" ? raw : {};
  return { id:tierText(value.id, 80) || tierId("row"), label:tierText(value.label, 40), color:tierColor(value.color, TIER_COLORS[Math.min(index || 0, TIER_COLORS.length - 1)]) };
}
function tierNormalizeItem(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  return { id:tierText(value.id, 80) || tierId("card"), tier:tierText(value.tier, 80), text:tierText(value.text, 120), name:tierText(value.name, 120), image:tierNormalizeImage(value.image) };
}
function tierDocEmpty(title, presetId){ return { type:TIER_DOC_TYPE, version:TIER_DOC_VERSION, title:tierText(title || "티어표", 160), cardSize:"m", tiers:tierPresetTiers(presetId), items:[] }; }
function tierDocParse(text){
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  if (!raw || raw.type !== TIER_DOC_TYPE || !Array.isArray(raw.tiers) || !Array.isArray(raw.items)) throw new Error("tier-format");
  if (raw.items.length > TIER_MAX_ITEMS) throw new Error("tier-limit");
  const model = tierDocEmpty(raw.title), tierIds = new Set(), itemIds = new Set();
  model.cardSize = Object.prototype.hasOwnProperty.call(TIER_CARD_SIZES, raw.cardSize) ? raw.cardSize : "m";
  model.tiers = raw.tiers.slice(0, TIER_MAX_TIERS).map(tierNormalizeTier).filter(tier => !tierIds.has(tier.id) && tierIds.add(tier.id));
  if (!model.tiers.length) model.tiers = tierPresetTiers();
  const known = new Set(model.tiers.map(tier => tier.id));
  // 사진도 글도 없는 카드는 보이지 않으니 버린다. 지워진 줄을 가리키는 카드는 아래 모음으로 내린다.
  model.items = raw.items.map(tierNormalizeItem).filter(item => (item.image || item.text.trim()) && !itemIds.has(item.id) && itemIds.add(item.id))
    .map(item => (item.tier && !known.has(item.tier) ? { ...item, tier:"" } : item));
  return model;
}
function tierDocSerialize(model){ return JSON.stringify(tierDocParse({ ...model, type:TIER_DOC_TYPE, version:TIER_DOC_VERSION }), null, 2); }
function tierItemsIn(model, tier){ return (model.items || []).filter(item => item.tier === (tier || "")); }
/* 카드 한 장을 tierId 줄의 beforeId 카드 앞으로 옮긴다(beforeId 가 없으면 그 줄 맨 끝). */
function tierMoveItem(model, id, tier, beforeId){
  const from = model.items.findIndex(item => item.id === id); if (from < 0 || beforeId === id) return false;
  const target = tier || ""; if (target && !model.tiers.some(row => row.id === target)) return false;
  const [item] = model.items.splice(from, 1); item.tier = target;
  let at = beforeId ? model.items.findIndex(other => other.id === beforeId && other.tier === target) : -1;
  if (at < 0){ let last = -1; model.items.forEach((other, index) => { if (other.tier === target) last = index; }); at = last >= 0 ? last + 1 : model.items.length; }
  model.items.splice(at, 0, item); return true;
}
/* 줄을 지우거나 비우면 그 줄 카드는 아래 모음 맨 끝으로 내려간다 — 카드가 사라지지 않게. */
function tierClearRow(model, tier){ const moved = model.items.filter(item => item.tier === tier); model.items = model.items.filter(item => item.tier !== tier).concat(moved.map(item => ({ ...item, tier:"" }))); return moved.length; }
function tierRemoveRow(model, tier){ if (model.tiers.length <= 1) return false; tierClearRow(model, tier); model.tiers = model.tiers.filter(row => row.id !== tier); return true; }
function tierResetAll(model){ const count = model.items.filter(item => item.tier).length; model.items = tierItemsIn(model, "").concat(model.items.filter(item => item.tier).map(item => ({ ...item, tier:"" }))); return count; }
function tierApplyPreset(model, presetId){
  const fresh = tierPresetTiers(presetId), old = model.tiers;
  model.tiers = fresh.map((row, index) => (old[index] ? { ...row, id:old[index].id } : row));
  const keep = new Set(model.tiers.map(row => row.id));
  old.filter(row => !keep.has(row.id)).forEach(row => tierClearRow(model, row.id));
}
function tierShufflePool(model, random=Math.random){
  const pool = tierItemsIn(model, ""); for (let i = pool.length - 1; i > 0; i--){ const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  model.items = model.items.filter(item => item.tier).concat(pool);
}
function tierSearchText(model){ return [model.title, ...(model.tiers || []).map(row => row.label), ...(model.items || []).flatMap(item => [item.text, item.name])].filter(Boolean).join("\n"); }
function tierDefaultTitle(name){ return String(name || "").replace(/\.tier$/i, "") || "티어표"; }
function tierScratchFileName(number){ return number > 1 ? "티어표 " + number + ".tier" : "티어표.tier"; }
function tierSafeName(value){ return String(value || "티어표").replace(/[\\/:*?"<>|]+/g, "_").trim() || "티어표"; }
/* 글자 대비 — 밝은 줄 색엔 검은 글자, 어두운 색엔 흰 글자. */
function tierInkFor(color){
  const hex = tierColor(color).slice(1), r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1f2328" : "#ffffff";
}

/* 사진을 카드 크기로 줄인다. 투명한 PNG(아이콘 등)는 PNG 그대로 두고, 나머지는 JPEG 로. */
async function tierPrepareImage(file){
  if (!file || !/^image\/(?:png|jpeg|webp|gif|bmp|avif)$/i.test(String(file.type || ""))) throw new Error("photo-type");
  if (file.size > 30 * 1024 * 1024) throw new Error("photo-too-large");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("photo-read")); img.src = url; });
    const nw = image.naturalWidth || image.width, nh = image.naturalHeight || image.height, scale = Math.min(1, TIER_IMAGE_MAX_SIDE / Math.max(nw, nh));
    const width = Math.max(1, Math.round(nw * scale)), height = Math.max(1, Math.round(nh * scale));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d");
    let dataUrl = "";
    if (/png|gif|webp/i.test(file.type)){ ctx.drawImage(image, 0, 0, width, height); dataUrl = canvas.toDataURL("image/png"); if (dataUrl.length > 260 * 1024) dataUrl = ""; }
    if (!dataUrl){
      ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(image, 0, 0, width, height);
      dataUrl = canvas.toDataURL("image/jpeg", 0.86); if (dataUrl.length > TIER_IMAGE_MAX_CHARS) dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    }
    if (dataUrl.length > TIER_IMAGE_MAX_CHARS) throw new Error("photo-output-too-large");
    return { dataUrl, width, height };
  } finally { URL.revokeObjectURL(url); }
}

async function loadTierDoc(file, opts = {}){
  let model; try { model = tierDocParse(await file.text()); }
  catch(_){ if (typeof toast === "function") toast("티어표(.tier)를 읽지 못해 텍스트로 열었어요.", 3600); return typeof loadText === "function" ? loadText(file, opts) : null; }
  if (!model.title) model.title = tierDefaultTitle(file.name);
  const doc = makeDoc("tier", file.name, opts); doc.tierDoc = model; doc.sourceFile = file; doc.savedText = tierDocSerialize(model);
  doc.contentSearchFocus = query => { const needle = String(query || "").trim().toLowerCase(), found = model.items.find(item => [item.text, item.name].join(" ").toLowerCase().includes(needle)); if (!found || typeof doc.tierSelectItem !== "function") return false; doc.tierSelectItem(found.id); return true; };
  doc.render = async () => { if (doc._tierMounted) return; doc._tierMounted = true; doc.el.innerHTML = ""; mountTierEditor(doc); };
  if (typeof refreshChrome === "function") refreshChrome(); if (typeof activateIfIdle === "function") activateIfIdle(doc, opts); return doc;
}
function newTierScratch(){
  _tierScratchCount++; const name = tierScratchFileName(_tierScratchCount); if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([tierDocSerialize(tierDocEmpty(tierDefaultTitle(name)))], name, { type:"application/json" })], { isScratch:true }));
}
function newTierScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, tierScratchFileName, name => tierDocSerialize(tierDocEmpty(tierDefaultTitle(name))), "application/json", "티어표");
}
async function saveTierDoc(doc){
  if (!doc || !doc.tierDoc) return false; const json = tierDocSerialize(doc.tierDoc), ok = typeof saveTextDoc === "function" ? await saveTextDoc(json, doc, doc.name) : false; if (!ok) return false;
  doc.savedText = json; if (typeof doc.tierMarkSaved === "function") doc.tierMarkSaved();
  if (typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json"); else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false); return true;
}

/* 티어표를 그림 한 장으로 — 화면을 찍지 않고 캔버스에 직접 그린다(스크롤에 가린 줄까지 다 나오게). */
function tierLoadImage(src){ return new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; }); }
function tierWrapText(ctx, text, maxWidth, maxLines){
  const lines = []; let line = "";
  for (const ch of String(text || "").replace(/\s+/g, " ").trim()){
    if (ctx.measureText(line + ch).width > maxWidth && line){ lines.push(line); line = ch.trim() ? ch : ""; if (lines.length >= maxLines) break; } else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
}
async function tierRenderPng(model, opts = {}){
  const card = TIER_CARD_SIZES[model.cardSize] || TIER_CARD_SIZES.m, gap = 4, labelW = 120, width = opts.width || 1200, contentW = width - labelW - gap * 3;
  const perRow = Math.max(1, Math.floor((contentW + gap) / (card + gap))), titleH = model.title ? 56 : 0;
  const rows = model.tiers.map(row => { const items = tierItemsIn(model, row.id); return { row, items, height:Math.max(card + gap * 2, Math.ceil(items.length / perRow) * (card + gap) + gap) }; });
  const height = titleH + rows.reduce((sum, row) => sum + row.height + 2, 0) + 2;
  const canvas = document.createElement("canvas"), ratio = opts.ratio || 2; canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const font = '"Pretendard","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  ctx.fillStyle = "#1a1a1f"; ctx.fillRect(0, 0, width, height);
  if (titleH){ ctx.fillStyle = "#ffffff"; ctx.font = "800 26px " + font; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(model.title, 16, titleH / 2 + 2, width - 32); }
  const images = new Map(); await Promise.all(model.items.filter(item => item.image).map(async item => images.set(item.id, await tierLoadImage(item.image.dataUrl))));
  let y = titleH + 2;
  for (const { row, items, height:h } of rows){
    ctx.fillStyle = row.color; ctx.fillRect(2, y, labelW, h);
    ctx.fillStyle = tierInkFor(row.color); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const size = row.label.length <= 2 ? 30 : row.label.length <= 4 ? 20 : 15; ctx.font = "800 " + size + "px " + font;
    const lines = tierWrapText(ctx, row.label, labelW - 14, 3); lines.forEach((text, index) => ctx.fillText(text, 2 + labelW / 2, y + h / 2 + (index - (lines.length - 1) / 2) * size * 1.2));
    ctx.fillStyle = "#26262d"; ctx.fillRect(labelW + 4, y, width - labelW - 6, h);
    items.forEach((item, index) => {
      const x = labelW + 4 + gap + (index % perRow) * (card + gap), top = y + gap + Math.floor(index / perRow) * (card + gap), img = images.get(item.id);
      if (img){
        const s = Math.max(card / img.width, card / img.height), sw = card / s, sh = card / s;   // 가운데를 꽉 채워 자르기(cover)
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, top, card, card);
        if (item.text){ ctx.fillStyle = "rgba(0,0,0,.62)"; ctx.fillRect(x, top + card - 20, card, 20); ctx.fillStyle = "#fff"; ctx.font = "700 11px " + font; ctx.fillText(tierWrapText(ctx, item.text, card - 6, 1)[0] || "", x + card / 2, top + card - 10); }
      } else {
        ctx.fillStyle = "#f4f4f6"; ctx.fillRect(x, top, card, card); ctx.fillStyle = "#1f2328";
        const fs = card >= 110 ? 16 : card >= 80 ? 13 : 11; ctx.font = "750 " + fs + "px " + font;
        const text = tierWrapText(ctx, item.text, card - 10, Math.floor((card - 8) / (fs * 1.25)));
        text.forEach((line, i) => ctx.fillText(line, x + card / 2, top + card / 2 + (i - (text.length - 1) / 2) * fs * 1.25));
      }
    });
    y += h + 2;
  }
  return canvas.toDataURL("image/png");
}

function tierButton(label, title, className, icon){
  const button = document.createElement("button"); button.type = "button"; button.className = className || "tier-btn";
  if (icon && typeof window.uiIcon === "function"){
    button.innerHTML = window.uiIcon(icon);
    if (label){ const span = document.createElement("span"); if (/run-save/.test(button.className)) span.className = "run-save-label"; span.textContent = label; button.append(span); }
    else button.classList.add("tier-ico");
  } else button.textContent = label;
  if (title){ button.title = title; button.setAttribute("aria-label", title); }
  return button;
}
function tierModal(titleText, body){
  const modal = document.createElement("div"); modal.className = "tier-modal"; const card = document.createElement("div"); card.className = "tier-modal-card movable-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
  const head = document.createElement("header"), h = document.createElement("h2"), close = tierButton("", "닫기", "tier-modal-x", "close"); h.textContent = titleText; head.append(h, close); card.append(head, body); modal.appendChild(card); document.body.appendChild(modal);
  const dispose = () => modal.remove(); close.onclick = dispose; modal.addEventListener("pointerdown", event => { if (event.target === modal) dispose(); }); modal.addEventListener("keydown", event => { if (event.key === "Escape"){ event.preventDefault(); event.stopPropagation(); dispose(); } }); return { modal, dispose };
}

function mountTierEditor(doc){
  const model = doc.tierDoc, root = document.createElement("div"); root.className = "tier-doc"; doc.el.appendChild(root);
  const bar = document.createElement("div"); bar.className = "tier-bar";
  const titleInput = document.createElement("input"); titleInput.className = "tier-title"; titleInput.value = model.title; titleInput.maxLength = 160; titleInput.placeholder = "티어표 제목 (예: 최고의 간식)";
  const photoBtn = tierButton("사진", "사진 카드 넣기 — 여러 장을 한꺼번에 고르거나, 이 화면에 끌어다 놓거나, Ctrl+V 로 붙여 넣을 수 있어요", "tier-btn tier-primary", "image");
  const textBtn = tierButton("글 카드", "글자만 있는 카드 넣기", "tier-btn", "text");
  const undoBtn = tierButton("", "실행 취소 (Ctrl+Z)", "tier-btn", "undo"), redoBtn = tierButton("", "다시 실행 (Ctrl+Y)", "tier-btn", "redo");
  const rowBtn = tierButton("줄", "맨 아래에 등급 줄 추가", "tier-btn", "plus");
  const boardBtn = tierButton("칠판으로", "티어표를 그림으로 굳혀 새 화이트보드에 넣기", "tier-btn", "board");
  const saveBtn = tierButton("저장", "티어표 저장 (Ctrl+S)", "tier-btn tier-primary run-save", "save");
  const moreBtn = tierButton("", "더 보기 — 그림으로 저장·줄 틀·카드 크기·모두 내리기", "tier-btn", "more");
  bar.append(titleInput, photoBtn, textBtn, undoBtn, redoBtn, rowBtn, boardBtn, saveBtn, moreBtn);
  const board = document.createElement("div"); board.className = "tier-board";
  const rowsEl = document.createElement("div"); rowsEl.className = "tier-rows";
  const poolHead = document.createElement("div"); poolHead.className = "tier-pool-head";
  poolHead.innerHTML = '<strong>📌 올릴 카드</strong><span class="tier-hint">카드를 끌어 위 줄에 놓으세요 · 카드를 누른 뒤 숫자 키 1~9 로 그 줄에, 0 으로 여기로 · 두 번 누르면 고치기</span>';
  const pool = document.createElement("div"); pool.className = "tier-items tier-pool"; pool.dataset.tier = "";
  board.append(rowsEl, poolHead, pool);
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"; fileInput.multiple = true; fileInput.hidden = true;
  root.append(bar, board, fileInput);

  // 되돌리기 기록엔 사진 바이트 대신 짧은 열쇠만 담는다 — 사진 수백 장 × 기록 60칸이면 메모리가 버티지 못한다.
  const imageKeys = new WeakMap(), imageStore = new Map(); let imageSeq = 0;
  const imageKey = image => { if (!image) return ""; let key = imageKeys.get(image); if (!key){ key = "i" + (++imageSeq); imageKeys.set(image, key); imageStore.set(key, image); } return key; };
  const snapshot = () => JSON.stringify({ title:model.title, cardSize:model.cardSize, tiers:model.tiers, items:model.items.map(item => ({ ...item, image:imageKey(item.image) })) });
  let savedSnapshot = snapshot(), selectedId = "", recoveryTimer = 0, history = null;
  doc.tierMarkSaved = () => { savedSnapshot = snapshot(); if (history) history.replaceCurrent(savedSnapshot); };
  const flushRecovery = async () => { clearTimeout(recoveryTimer); recoveryTimer = 0; if (!doc.hasUnsavedEdits && !(doc.isScratch && !doc._named)) return true; if (typeof rememberWorkspace !== "function" || typeof recoverySnapshotFile !== "function") return false;
    try { const file = recoverySnapshotFile(doc, new TextEncoder().encode(tierDocSerialize(model)), "application/json"); doc.savedInWorkspace = file ? await rememberWorkspace([file], false, { silent:true }) : false; return !!doc.savedInWorkspace; } catch(error){ console.warn("티어표 복구본 저장 실패:", error); return false; } };
  const touch = () => { if (typeof markDocumentDirty === "function") markDocumentDirty(doc, snapshot() !== savedSnapshot); clearTimeout(recoveryTimer); recoveryTimer = setTimeout(flushRecovery, TIER_RECOVERY_DELAY); };
  doc.flushBackupRecovery = flushRecovery;
  const replaceModel = value => {
    const raw = JSON.parse(value); model.title = raw.title; model.cardSize = raw.cardSize; model.tiers = raw.tiers; model.items = raw.items.map(item => ({ ...item, image:item.image ? imageStore.get(item.image) || null : null }));
    titleInput.value = model.title; if (selectedId && !model.items.some(item => item.id === selectedId)) selectedId = ""; render(); touch();
  };
  history = MNEditHistory.create({ capture:snapshot, isEqual:(a, b) => a === b, apply:replaceModel, onChange:() => { undoBtn.disabled = !history.canUndo(); redoBtn.disabled = !history.canRedo(); }, limit:TIER_HISTORY_LIMIT }); history.reset(); doc._tierHistory = history;
  const changed = () => { history.commit(); touch(); render(); };

  function cardEl(item){
    const el = document.createElement("div"); el.className = "tier-item" + (item.image ? "" : " is-text") + (item.id === selectedId ? " is-selected" : ""); el.dataset.itemId = item.id; el.tabIndex = -1;
    el.title = (item.text || item.name || "카드") + " — 끌어서 옮기기 · 두 번 누르면 고치기";
    if (item.image){ const img = document.createElement("img"); img.src = item.image.dataUrl; img.alt = item.text || item.name || ""; img.draggable = false; el.appendChild(img); }
    if (item.text){ const cap = document.createElement("span"); cap.className = item.image ? "tier-item-cap" : "tier-item-text"; cap.textContent = item.text; el.appendChild(cap); }
    return el;
  }
  function render(){
    root.style.setProperty("--tier-card", (TIER_CARD_SIZES[model.cardSize] || TIER_CARD_SIZES.m) + "px");
    rowsEl.innerHTML = "";
    model.tiers.forEach((row, index) => {
      const rowEl = document.createElement("div"); rowEl.className = "tier-row"; rowEl.dataset.tierRow = row.id;
      const label = document.createElement("button"); label.type = "button"; label.className = "tier-label"; label.style.background = row.color; label.style.color = tierInkFor(row.color);
      label.textContent = row.label; label.title = "줄 이름·색 바꾸기" + (index < 9 ? ` · 카드를 고르고 ${index + 1} 키를 누르면 이 줄로` : "");
      label.onclick = () => openRowDialog(row.id);
      const zone = document.createElement("div"); zone.className = "tier-items"; zone.dataset.tier = row.id;
      tierItemsIn(model, row.id).forEach(item => zone.appendChild(cardEl(item)));
      const tools = document.createElement("div"); tools.className = "tier-row-tools";
      const gear = tierButton("", "줄 설정", "tier-row-btn tier-row-gear", "settings"), up = tierButton("", "줄을 위로", "tier-row-btn", "chevronUp"), down = tierButton("", "줄을 아래로", "tier-row-btn", "chevronDown");
      up.disabled = index === 0; down.disabled = index === model.tiers.length - 1;
      gear.onclick = () => openRowDialog(row.id); up.onclick = () => moveRow(index, -1); down.onclick = () => moveRow(index, 1);
      const arrows = document.createElement("div"); arrows.className = "tier-row-arrows"; arrows.append(up, down); tools.append(gear, arrows);
      rowEl.append(label, zone, tools); rowsEl.appendChild(rowEl);
    });
    pool.innerHTML = ""; const rest = tierItemsIn(model, "");
    rest.forEach(item => pool.appendChild(cardEl(item)));
    if (!model.items.length){ const empty = tierButton("＋ 사진을 여기로 끌어다 놓거나 눌러서 고르세요", "사진 카드 넣기", "tier-empty"); empty.onclick = () => fileInput.click(); pool.appendChild(empty); }
    poolHead.querySelector("strong").textContent = `📌 올릴 카드 ${rest.length ? rest.length + "장" : ""}`.trim();
  }
  doc.tierSelectItem = id => { if (!model.items.some(item => item.id === id)) return false; selectedId = id; render(); const el = board.querySelector(`[data-item-id="${CSS.escape(id)}"]`); if (el) el.scrollIntoView({ behavior:"smooth", block:"center" }); return true; };

  function moveRow(index, delta){ const to = index + delta; if (to < 0 || to >= model.tiers.length) return; const [row] = model.tiers.splice(index, 1); model.tiers.splice(to, 0, row); changed(); }
  function addRow(at){
    if (model.tiers.length >= TIER_MAX_TIERS){ if (typeof toast === "function") toast(`등급 줄은 ${TIER_MAX_TIERS}개까지 만들 수 있어요.`, 2600); return null; }
    const used = new Set(model.tiers.map(row => row.color)), color = TIER_COLORS.find(c => !used.has(c)) || TIER_COLORS[model.tiers.length % TIER_COLORS.length];
    const row = { id:tierId("row"), label:"새 줄", color }; model.tiers.splice(at == null ? model.tiers.length : at, 0, row); changed(); return row;
  }

  function openRowDialog(id){
    const row = model.tiers.find(item => item.id === id); if (!row) return;
    const body = document.createElement("div"); body.className = "tier-form";
    body.innerHTML = '<label class="wide"><span>줄 이름</span><input class="tf-label" maxlength="40"></label><div class="wide tier-swatch-field"><span>줄 색</span><div class="tier-swatches"></div><input type="color" class="tf-color" title="다른 색 고르기"></div>'
      + '<div class="wide tier-form-actions"><button type="button" class="tf-above">위에 줄 추가</button><button type="button" class="tf-below">아래에 줄 추가</button><button type="button" class="tf-clear">이 줄 비우기</button><button type="button" class="tf-delete danger">줄 지우기</button></div>'
      + '<footer class="wide"><span></span><button type="button" class="tf-cancel">취소</button><button type="button" class="tf-save primary">확인</button></footer>';
    const ui = tierModal("등급 줄 설정", body), labelInput = body.querySelector(".tf-label"), colorInput = body.querySelector(".tf-color"), swatches = body.querySelector(".tier-swatches");
    let color = row.color; labelInput.value = row.label; colorInput.value = color;
    const paint = () => swatches.querySelectorAll("button").forEach(button => button.classList.toggle("is-on", button.dataset.color === color));
    TIER_COLORS.forEach(c => { const sw = document.createElement("button"); sw.type = "button"; sw.dataset.color = c; sw.style.background = c; sw.title = c; sw.setAttribute("aria-label", "색 " + c); sw.onclick = () => { color = c; colorInput.value = c; paint(); }; swatches.appendChild(sw); }); paint();
    colorInput.oninput = () => { color = tierColor(colorInput.value, color); paint(); };
    const apply = () => { row.label = tierText(labelInput.value, 40); row.color = color; };
    body.querySelector(".tf-cancel").onclick = ui.dispose;
    body.querySelector(".tf-save").onclick = () => { apply(); ui.dispose(); changed(); };
    labelInput.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing){ event.preventDefault(); body.querySelector(".tf-save").click(); } });
    body.querySelector(".tf-above").onclick = () => { apply(); ui.dispose(); addRow(model.tiers.indexOf(row)); };
    body.querySelector(".tf-below").onclick = () => { apply(); ui.dispose(); addRow(model.tiers.indexOf(row) + 1); };
    body.querySelector(".tf-clear").onclick = () => { apply(); ui.dispose(); const n = tierClearRow(model, row.id); changed(); if (n && typeof toast === "function") toast(`카드 ${n}장을 아래로 내렸어요. 되돌리려면 Ctrl+Z`, 2600); };
    const del = body.querySelector(".tf-delete"); del.disabled = model.tiers.length <= 1;
    del.onclick = () => { ui.dispose(); if (tierRemoveRow(model, row.id)){ changed(); if (typeof toast === "function") toast("줄을 지웠어요 — 그 줄 카드는 아래로 내려갔어요. 되돌리려면 Ctrl+Z", 2800); } };
    setTimeout(() => { labelInput.focus(); labelInput.select(); }, 0);
  }

  function openItemDialog(id){
    const current = id ? model.items.find(item => item.id === id) : null;
    const body = document.createElement("div"); body.className = "tier-form";
    body.innerHTML = '<div class="wide tier-item-preview"></div><label class="wide"><span class="tf-text-label"></span><textarea class="tf-text" rows="3" maxlength="120"></textarea></label>'
      + '<div class="wide tier-form-actions"><button type="button" class="tf-photo">사진 바꾸기</button><button type="button" class="tf-photo-remove">사진 빼기</button><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" hidden></div>'
      + '<p class="tier-form-error wide" role="alert"></p><footer class="wide"><button type="button" class="tf-delete danger">카드 지우기</button><span></span><button type="button" class="tf-cancel">취소</button><button type="button" class="tf-save primary">확인</button></footer>';
    const ui = tierModal(current ? "카드 고치기" : "새 글 카드", body), text = body.querySelector(".tf-text"), preview = body.querySelector(".tier-item-preview"), photoInput = body.querySelector("input[type=file]"), error = body.querySelector(".tier-form-error");
    let image = current ? current.image : null;
    const sync = () => {
      preview.innerHTML = ""; preview.hidden = !image; if (image){ const img = document.createElement("img"); img.src = image.dataUrl; img.alt = ""; preview.appendChild(img); }
      body.querySelector(".tf-text-label").textContent = image ? "사진 아래 글 (비워 두면 사진만)" : "카드 글";
      body.querySelector(".tf-photo").textContent = image ? "사진 바꾸기" : "사진 넣기"; body.querySelector(".tf-photo-remove").hidden = !image;
    };
    text.value = current ? current.text : ""; sync();
    body.querySelector(".tf-photo").onclick = () => photoInput.click();
    body.querySelector(".tf-photo-remove").onclick = () => { image = null; sync(); };
    photoInput.onchange = async () => { const file = photoInput.files && photoInput.files[0]; photoInput.value = ""; if (!file) return; try { image = await tierPrepareImage(file); sync(); } catch(_){ error.textContent = "사진을 넣지 못했어요."; } };
    body.querySelector(".tf-cancel").onclick = ui.dispose;
    const del = body.querySelector(".tf-delete"); del.hidden = !current; del.onclick = () => { ui.dispose(); deleteItem(current.id); };
    body.querySelector(".tf-save").onclick = () => {
      const value = tierText(text.value, 120).trim();
      if (!image && !value){ error.textContent = "카드에 넣을 글을 쓰거나 사진을 넣으세요."; text.focus(); return; }
      if (current){ current.text = value; current.image = image; }
      else { if (model.items.length >= TIER_MAX_ITEMS){ error.textContent = `카드는 ${TIER_MAX_ITEMS}장까지 넣을 수 있어요.`; return; } const item = tierNormalizeItem({ text:value }); item.image = image; model.items.push(item); selectedId = item.id; }
      ui.dispose(); changed();
    };
    text.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing){ event.preventDefault(); body.querySelector(".tf-save").click(); } });
    setTimeout(() => text.focus(), 0);
  }
  function deleteItem(id){
    const before = model.items.length; model.items = model.items.filter(item => item.id !== id); if (model.items.length === before) return;
    if (selectedId === id) selectedId = ""; changed(); if (typeof toast === "function") toast("카드를 지웠어요. 되돌리려면 Ctrl+Z", 2400);
  }

  async function addImageFiles(files){
    const list = Array.from(files || []).filter(file => /^image\//i.test(file.type || "")); if (!list.length) return 0;
    const room = TIER_MAX_ITEMS - model.items.length; if (room <= 0){ if (typeof toast === "function") toast(`카드는 ${TIER_MAX_ITEMS}장까지 넣을 수 있어요.`, 2800); return 0; }
    let added = 0, failed = 0;
    for (const file of list.slice(0, room)){
      try { const image = await tierPrepareImage(file); const item = tierNormalizeItem({ name:String(file.name || "").replace(/\.[^.]+$/, "") }); item.image = image; model.items.push(item); added++; }
      catch(_){ failed++; }
    }
    if (added) changed();
    if (typeof toast === "function"){
      const skipped = list.length - Math.min(list.length, room);
      toast(`사진 카드 ${added}장을 넣었어요.` + (failed ? ` (${failed}장은 읽지 못함)` : "") + (skipped ? ` (${skipped}장은 한도를 넘어 뺌)` : ""), 2800);
    }
    return added;
  }

  /* ── 끌어서 옮기기 ── 마우스·펜·손가락이 같은 길로 가도록 포인터 이벤트로 직접 짠다(HTML5 drag 는 터치에서 안 된다). */
  let drag = null;
  const zoneAt = (x, y) => { const hit = document.elementFromPoint(x, y); return hit && hit.closest ? hit.closest(".tier-doc .tier-items") : null; };
  const beforeAt = (zone, x, y) => {
    for (const el of zone.querySelectorAll(".tier-item:not(.is-dragging)")){
      const r = el.getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return el;
    }
    return null;
  };
  const autoScroll = y => { const r = board.getBoundingClientRect(); if (y < r.top + 40) board.scrollTop -= 14; else if (y > r.bottom - 40) board.scrollTop += 14; };
  board.addEventListener("pointerdown", event => {
    const el = event.target.closest(".tier-item"); if (!el || event.button !== 0) return;
    drag = { id:el.dataset.itemId, el, pointerId:event.pointerId, x:event.clientX, y:event.clientY, started:false, ghost:null, mark:null, zone:null, before:null, dx:0, dy:0 };
  });
  const onMove = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started){
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      drag.started = true; const r = drag.el.getBoundingClientRect(); drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
      drag.ghost = drag.el.cloneNode(true); drag.ghost.classList.add("tier-ghost"); drag.ghost.style.width = r.width + "px"; drag.ghost.style.height = r.height + "px"; document.body.appendChild(drag.ghost);
      drag.el.classList.add("is-dragging"); drag.mark = document.createElement("div"); drag.mark.className = "tier-drop-mark"; root.classList.add("is-dragging");
    }
    event.preventDefault();
    drag.ghost.style.transform = `translate(${event.clientX - drag.dx}px, ${event.clientY - drag.dy}px)`;
    const zone = zoneAt(event.clientX, event.clientY); drag.zone = zone;
    board.querySelectorAll(".tier-items.is-over").forEach(el => { if (el !== zone) el.classList.remove("is-over"); });
    if (zone){ zone.classList.add("is-over"); const before = beforeAt(zone, event.clientX, event.clientY); drag.before = before; if (before) zone.insertBefore(drag.mark, before); else zone.appendChild(drag.mark); }
    else if (drag.mark.parentNode) drag.mark.remove();
    autoScroll(event.clientY);
  };
  const finish = (event, cancel) => {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const state = drag; drag = null;
    if (!state.started){ if (!cancel){ selectedId = state.id; board.querySelectorAll(".tier-item.is-selected").forEach(el => el.classList.remove("is-selected")); state.el.classList.add("is-selected"); } return; }
    state.ghost.remove(); if (state.mark.parentNode) state.mark.remove(); state.el.classList.remove("is-dragging"); root.classList.remove("is-dragging");
    board.querySelectorAll(".tier-items.is-over").forEach(el => el.classList.remove("is-over"));
    selectedId = state.id;
    if (cancel || !state.zone){ render(); return; }
    const moved = tierMoveItem(model, state.id, state.zone.dataset.tier || "", state.before ? state.before.dataset.itemId : "");
    if (moved) changed(); else render();
  };
  const onUp = event => finish(event, false), onCancel = event => finish(event, true);
  window.addEventListener("pointermove", onMove, { passive:false }); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onCancel);
  board.addEventListener("dblclick", event => { const el = event.target.closest(".tier-item"); if (el) openItemDialog(el.dataset.itemId); });
  board.addEventListener("click", event => { if (!event.target.closest(".tier-item") && !event.target.closest("button") && selectedId){ selectedId = ""; board.querySelectorAll(".tier-item.is-selected").forEach(el => el.classList.remove("is-selected")); } });

  // 사진 파일을 이 화면에 끌어다 놓으면 아래 모음에 카드로 들어간다.
  root.addEventListener("dragover", event => { if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files")){ event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; root.classList.add("is-file-over"); } });
  root.addEventListener("dragleave", event => { if (event.target === root || !root.contains(event.relatedTarget)) root.classList.remove("is-file-over"); });
  root.addEventListener("drop", event => {
    root.classList.remove("is-file-over"); const files = event.dataTransfer && event.dataTransfer.files; if (!files || !files.length) return;
    const images = Array.from(files).filter(file => /^image\//i.test(file.type || "")); if (!images.length) return;
    event.preventDefault(); event.stopPropagation(); addImageFiles(images);
  });
  const onPaste = event => {
    if (doc.el.hidden || !doc.el.isConnected || document.querySelector(".tier-modal")) return;
    if (event.target && event.target.closest && event.target.closest("input,textarea,[contenteditable=true]")) return;
    const files = Array.from((event.clipboardData && event.clipboardData.files) || []).filter(file => /^image\//i.test(file.type || ""));
    if (files.length){ event.preventDefault(); addImageFiles(files); }
  };
  document.addEventListener("paste", onPaste);

  photoBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => { const files = Array.from(fileInput.files || []); fileInput.value = ""; await addImageFiles(files); };
  textBtn.onclick = () => openItemDialog("");
  undoBtn.onclick = () => history.undo(); redoBtn.onclick = () => history.redo();
  rowBtn.onclick = () => { const row = addRow(); if (row) openRowDialog(row.id); };
  titleInput.oninput = () => { model.title = titleInput.value; history.commitSoon(500); touch(); };
  saveBtn.onclick = () => saveTierDoc(doc);

  const exportPng = async () => {
    try { const png = await tierRenderPng(model); const blob = await (await fetch(png)).blob(); MNDownload.saveBlob(blob, tierSafeName(model.title) + ".png"); }
    catch(error){ console.warn("티어표 그림 저장 실패:", error); if (typeof toast === "function") toast("그림으로 저장하지 못했어요.", 3000, { type:"error" }); }
  };
  boardBtn.onclick = async () => {
    if (typeof newWhiteboard !== "function"){ if (typeof toast === "function") toast("화이트보드를 열 수 없어요.", 2600); return; }
    boardBtn.disabled = true;
    try {
      const png = await tierRenderPng(model);
      const boardDoc = newWhiteboard({ name:tierSafeName(model.title), state:{ version:1, savedAt:Date.now(), bg:typeof defaultBoardBg === "function" ? defaultBoardBg() : "#ffffff", items:[] } });
      if (typeof setActiveDoc === "function") setActiveDoc(boardDoc.id);
      if (typeof ensureRendered === "function") await ensureRendered(boardDoc);   // 렌더가 끝나야 insertBoardImage 가 붙는다
      const placed = typeof boardDoc.insertBoardImage === "function" ? await boardDoc.insertBoardImage(png) : false;
      if (typeof toast === "function") toast(placed ? "티어표를 칠판으로 옮겼어요 — 그 위에 바로 판서할 수 있어요." : "칠판에 티어표를 넣지 못했어요.", 3000);
    } catch(error){ console.warn("티어표 칠판 보내기 실패:", error); if (typeof toast === "function") toast("칠판에 티어표를 넣지 못했어요.", 3000, { type:"error" }); }
    finally { boardBtn.disabled = false; }
  };
  moreBtn.onclick = () => {
    if (typeof MNContextMenu === "undefined"){ exportPng(); return; }
    const rect = moreBtn.getBoundingClientRect(); moreBtn.classList.add("is-open");
    MNContextMenu.open(rect.right - 210, rect.bottom + 6, [
      { label:"그림(PNG)으로 저장", title:"등급 줄 전체를 그림 한 장으로 저장", icon:"image", action:exportPng },
      { separator:true },
      { label:"카드 크기", icon:"view", children:[["s", "작게"], ["m", "보통"], ["l", "크게"]].map(([size, label]) => ({ label, active:model.cardSize === size, action:() => { if (model.cardSize !== size){ model.cardSize = size; changed(); } } })) },
      { label:"줄 틀 바꾸기", icon:"list", children:TIER_PRESETS.map(preset => ({ label:preset.label, title:"줄 이름·색을 이 틀로 바꿉니다(카드는 같은 차례의 줄에 그대로)", action:() => { tierApplyPreset(model, preset.id); changed(); } })) },
      { separator:true },
      { label:"올릴 카드 섞기", title:"아래 모음의 카드 차례를 무작위로 섞기", icon:"shuffle", disabled:tierItemsIn(model, "").length < 2, action:() => { tierShufflePool(model); changed(); } },
      { label:"모두 아래로 내리기", title:"줄에 올린 카드를 전부 아래 모음으로 되돌리기(다시 매기기)", icon:"refresh", disabled:!model.items.some(item => item.tier),
        action:async () => { if (typeof confirmDialog === "function" && !await confirmDialog("줄에 올린 카드를 모두 아래로 내릴까요?", "내리기", "취소")) return; tierResetAll(model); changed(); } }
    ], { base:"text-context", onClose:() => moreBtn.classList.remove("is-open") });
  };

  const keydown = event => {
    if (doc.el.hidden || !doc.el.isConnected || document.querySelector(".tier-modal")) return;
    if (event.target && event.target.closest && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
    const key = String(event.key || "").toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (mod && key === "z"){ event.preventDefault(); event.shiftKey ? history.redo() : history.undo(); return; }
    if (mod && key === "y"){ event.preventDefault(); history.redo(); return; }
    if (mod || event.altKey || !selectedId) return;
    const item = model.items.find(other => other.id === selectedId); if (!item){ selectedId = ""; return; }
    if (/^[0-9]$/.test(event.key)){
      const n = Number(event.key), target = n === 0 ? "" : (model.tiers[n - 1] && model.tiers[n - 1].id); if (target == null) return;
      event.preventDefault(); if (item.tier !== target && tierMoveItem(model, item.id, target, "")) changed(); return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight"){
      const group = tierItemsIn(model, item.tier), at = group.indexOf(item), to = at + (event.key === "ArrowLeft" ? -1 : 1); if (to < 0 || to >= group.length) return;
      event.preventDefault(); tierMoveItem(model, item.id, item.tier, event.key === "ArrowLeft" ? group[to].id : (group[to + 1] ? group[to + 1].id : "")); changed(); return;
    }
    if (event.key === "Delete" || event.key === "Backspace"){ event.preventDefault(); deleteItem(item.id); return; }
    if (event.key === "Enter"){ event.preventDefault(); openItemDialog(item.id); return; }
    if (event.key === "Escape"){ selectedId = ""; render(); }
  };
  window.addEventListener("keydown", keydown);
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer); if (history) history.cancel(); if (drag && drag.ghost) drag.ghost.remove(); drag = null;
    window.removeEventListener("keydown", keydown); document.removeEventListener("paste", onPaste);
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel);
    if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery; delete doc.tierSelectItem; delete doc.tierMarkSaved;
  });
  render(); touch();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = { TIER_DOC_TYPE, TIER_DOC_VERSION, TIER_PRESETS, TIER_CARD_SIZES, tierDocEmpty, tierDocParse, tierDocSerialize, tierNormalizeItem,
    tierItemsIn, tierMoveItem, tierClearRow, tierRemoveRow, tierResetAll, tierApplyPreset, tierShufflePool, tierSearchText, tierDefaultTitle, tierScratchFileName, tierInkFor };
}
