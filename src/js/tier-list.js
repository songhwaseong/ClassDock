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
const TIER_COLORS = ["#ff7b82", "#ffab73", "#ffd76a", "#6fdc8c", "#7cc3f7", "#b49cff", "#ff9fcf", "#6fdcd6", "#c6e36b", "#ffe27f", "#cfcfcf", "#8a8a8a"];
/* 줄 이름 칸 오른쪽의 흐린 장식 그림 — 첫 줄은 왕관, 마지막 줄은 보석, 그 앞은 새싹, 나머지는 별.
   화면(SVG)과 PNG(Path2D)가 같은 경로 글을 쓴다. */
const TIER_ICON_PATHS = {
  crown:"M3.5 8.5l4.3 3.8L12 5.5l4.2 6.8 4.3-3.8-1.8 10H5.3z",
  star:"M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z",
  sprout:"M12 20.5v-8.2M12 12.3c0-4.2 2.8-7 7.6-7 0 4.2-2.8 7-7.6 7zM12 14.2c0-3.2-2.4-5.6-6.6-5.6 0 3.2 2.4 5.6 6.6 5.6z",
  gem:"M6.5 4.5h11l3.5 4.8L12 20 3 9.3zM3 9.3h18M9.3 4.5 7.8 9.3 12 20l4.2-10.7-1.5-4.8"
};
const TIER_UI_PATHS = {
  trash:'<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.8v5.4M14 10.8v5.4"/>',
  eraser:'<path d="M7 20.5 3.2 16.7a2.2 2.2 0 0 1 0-3.1l9.4-9.4a2.2 2.2 0 0 1 3.1 0l4.6 4.6a2.2 2.2 0 0 1 0 3.1L12.4 20.5M20.5 20.5H7M5.6 11.2l7.7 7.7"/>',
  grip:'<circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/>'
};
function tierIconName(value){ return Object.prototype.hasOwnProperty.call(TIER_ICON_PATHS, value) ? value : ""; }
function tierRowIcon(index, count){ return index === 0 ? "crown" : (count >= 3 && index === count - 1) ? "gem" : (count >= 4 && index === count - 2) ? "sprout" : "star"; }
function tierSvg(name, extraClass){
  const inner = TIER_UI_PATHS[name] || (TIER_ICON_PATHS[name] ? '<path d="' + TIER_ICON_PATHS[name] + '"/>' : "");
  return '<svg class="ui-icon' + (extraClass ? " " + extraClass : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
}
/* 두 색 섞기(t=0 이면 a, 1 이면 b) — PNG 에서 줄 색을 옅게 깔 때 쓴다. */
function tierMix(a, b, t){
  const pa = tierColor(a).slice(1), pb = tierColor(b).slice(1), ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  return "rgb(" + [0, 2, 4].map(i => Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t)).join(",") + ")";
}
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
  return preset.tiers.map((label, index) => ({ id:tierId("row"), label, color:TIER_COLORS[Math.min(index, TIER_COLORS.length - 1)], icon:tierRowIcon(index, preset.tiers.length) }));
}
function tierNormalizeImage(raw){
  const value = raw && typeof raw === "object" ? raw : null, dataUrl = value ? String(value.dataUrl || "") : "";
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(dataUrl) || dataUrl.length > TIER_IMAGE_MAX_CHARS) return null;
  return { dataUrl, width:Math.max(1, Math.min(10000, Number(value.width) || 1)), height:Math.max(1, Math.min(10000, Number(value.height) || 1)) };
}
function tierNormalizeTier(raw, index){
  const value = raw && typeof raw === "object" ? raw : {};
  return { id:tierText(value.id, 80) || tierId("row"), label:tierText(value.label, 40), color:tierColor(value.color, TIER_COLORS[Math.min(index || 0, TIER_COLORS.length - 1)]), icon:tierIconName(value.icon) };
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
  // 그림이 없는 예전 파일은 지금 차례로 한 번 정해 두고, 그 뒤로는 줄을 옮겨도 그림이 줄을 따라간다.
  model.tiers.forEach((row, index, rows) => { if (!row.icon) row.icon = tierRowIcon(index, rows.length); });
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
  model.tiers = fresh.map((row, index) => (old[index] ? { ...row, id:old[index].id } : row));   // 틀을 바꾸면 그림도 새 틀 차례대로
  const keep = new Set(model.tiers.map(row => row.id));
  old.filter(row => !keep.has(row.id)).forEach(row => tierClearRow(model, row.id));
}
/* 보유 카드(줄에 안 올린 카드) 가운데 ids 에 든 것만 지운다. 줄에 올린 카드는 ids 에 있어도 건드리지 않는다. */
function tierRemovePoolItems(model, ids){ const drop = new Set(ids || []), before = model.items.length; model.items = model.items.filter(item => item.tier || !drop.has(item.id)); return before - model.items.length; }
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
function tierRoundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  if (typeof ctx.roundRect === "function"){ ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/* 화면과 같은 모양 — 옅은 바탕 위 흰 판, 줄마다 둥근 색 칸 + 줄 색을 옅게 깐 점선 칸. 줄 도구(⠿·⚙·🗑)와 빈 줄 안내는 넣지 않는다. */
async function tierRenderPng(model, opts = {}){
  const card = TIER_CARD_SIZES[model.cardSize] || TIER_CARD_SIZES.m, width = opts.width || 1200;
  const pad = 28, panelPad = 14, rowGap = 10, labelW = 140, labelGap = 10, zonePad = 8, gap = 6;
  const zoneX = pad + panelPad + labelW + labelGap, zoneW = width - zoneX - pad - panelPad;
  const perRow = Math.max(1, Math.floor((zoneW - zonePad * 2 + gap) / (card + gap))), titleH = model.title ? 58 : 0;
  const rows = model.tiers.map(row => { const items = tierItemsIn(model, row.id), lines = Math.max(1, Math.ceil(items.length / perRow)); return { row, items, height:lines * (card + gap) - gap + zonePad * 2 }; });
  const panelH = rows.reduce((sum, row) => sum + row.height, 0) + rowGap * Math.max(0, rows.length - 1) + panelPad * 2;
  const height = pad + titleH + panelH + pad;
  const canvas = document.createElement("canvas"), ratio = opts.ratio || 2; canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const font = '"Pretendard","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  ctx.fillStyle = "#f3f4fb"; ctx.fillRect(0, 0, width, height);
  if (titleH){ ctx.fillStyle = "#1f2340"; ctx.font = "800 28px " + font; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(model.title, pad + 4, pad + titleH / 2 - 6, width - pad * 2); }
  const panelY = pad + titleH;
  ctx.save(); ctx.shadowColor = "rgba(40,45,90,.10)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6; ctx.fillStyle = "#ffffff"; tierRoundRect(ctx, pad, panelY, width - pad * 2, panelH, 18); ctx.fill(); ctx.restore();
  const images = new Map(); await Promise.all(model.items.filter(item => item.image).map(async item => images.set(item.id, await tierLoadImage(item.image.dataUrl))));
  let y = panelY + panelPad;
  rows.forEach(({ row, items, height:h }, rowIndex) => {
    const lx = pad + panelPad;
    ctx.fillStyle = row.color; tierRoundRect(ctx, lx, y, labelW, h, 12); ctx.fill();
    if (typeof Path2D === "function"){   // 흐린 장식 그림(오른쪽 아래)
      const icon = new Path2D(TIER_ICON_PATHS[tierIconName(row.icon) || tierRowIcon(rowIndex, rows.length)]), s = 1.75;
      ctx.save(); ctx.translate(lx + labelW - 24 * s - 8, y + h / 2 - 12 * s); ctx.scale(s, s); ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.stroke(icon); ctx.restore();
    }
    ctx.fillStyle = tierInkFor(row.color); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const size = row.label.length <= 2 ? 34 : row.label.length <= 4 ? 21 : 15; ctx.font = "800 " + size + "px " + font;
    const lines = tierWrapText(ctx, row.label, labelW - 22, 3); lines.forEach((text, index) => ctx.fillText(text, lx + labelW / 2, y + h / 2 + (index - (lines.length - 1) / 2) * size * 1.2));
    ctx.fillStyle = tierMix(row.color, "#ffffff", 0.86); tierRoundRect(ctx, zoneX, y, zoneW, h, 12); ctx.fill();
    ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; ctx.strokeStyle = tierMix(row.color, "#ffffff", 0.35); tierRoundRect(ctx, zoneX + 0.5, y + 0.5, zoneW - 1, h - 1, 12); ctx.stroke(); ctx.restore();
    items.forEach((item, index) => {
      const x = zoneX + zonePad + (index % perRow) * (card + gap), top = y + zonePad + Math.floor(index / perRow) * (card + gap), img = images.get(item.id);
      ctx.save(); ctx.shadowColor = "rgba(20,25,60,.14)"; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1; ctx.fillStyle = img ? "#ffffff" : "#f7f8fc"; tierRoundRect(ctx, x, top, card, card, 8); ctx.fill(); ctx.restore();
      ctx.save(); tierRoundRect(ctx, x, top, card, card, 8); ctx.clip();
      if (img){
        const s = Math.max(card / img.width, card / img.height), sw = card / s, sh = card / s;   // 가운데를 꽉 채워 자르기(cover)
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, top, card, card);
        if (item.text){ ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(x, top + card - 20, card, 20); ctx.fillStyle = "#fff"; ctx.font = "700 11px " + font; ctx.fillText(tierWrapText(ctx, item.text, card - 6, 1)[0] || "", x + card / 2, top + card - 10); }
      } else {
        ctx.strokeStyle = "#e1e4ef"; ctx.lineWidth = 2; tierRoundRect(ctx, x, top, card, card, 8); ctx.stroke(); ctx.fillStyle = "#1f2328";
        const fs = card >= 110 ? 16 : card >= 80 ? 13 : 11; ctx.font = "750 " + fs + "px " + font;
        const text = tierWrapText(ctx, item.text, card - 10, Math.floor((card - 8) / (fs * 1.25)));
        text.forEach((line, i) => ctx.fillText(line, x + card / 2, top + card / 2 + (i - (text.length - 1) / 2) * fs * 1.25));
      }
      ctx.restore();
    });
    y += h + rowGap;
  });
  return canvas.toDataURL("image/png");
}

/* 머리말 오른쪽에서 판 위로 빼꼼 내다보는 삼색 고양이 — 장식일 뿐이라 눌리지 않는다(pointer-events:none). */
const TIER_MASCOT_SVG = '<svg class="tier-mascot-cat" viewBox="0 0 150 112" aria-hidden="true" focusable="false">'
  + '<defs><clipPath id="tierCatHead"><ellipse cx="78" cy="66" rx="45" ry="37"/></clipPath></defs>'
  + '<g stroke="#5b4636" stroke-width="2.4" stroke-linejoin="round">'
  + '<path d="M40 48 L44 10 L72 33 Z" fill="#f6ad72"/><path d="M116 48 L112 10 L84 33 Z" fill="#fffaf4"/>'
  + '<path d="M47 40 L49 20 L63 33 Z" fill="#ffc4c8" stroke="none"/><path d="M109 40 L107 20 L93 33 Z" fill="#ffc4c8" stroke="none"/>'
  + '<ellipse cx="78" cy="66" rx="45" ry="37" fill="#fffaf4"/></g>'
  + '<g clip-path="url(#tierCatHead)"><path d="M30 30 C48 26 66 36 62 52 C58 64 42 66 30 62 Z" fill="#f6ad72"/><path d="M102 30 C116 30 128 44 124 58 C112 58 100 50 98 40 Z" fill="#8f6547"/></g>'
  + '<ellipse cx="78" cy="66" rx="45" ry="37" fill="none" stroke="#5b4636" stroke-width="2.4"/>'
  + '<ellipse cx="62" cy="67" rx="4.6" ry="5.6" fill="#3b2a20"/><ellipse cx="94" cy="67" rx="4.6" ry="5.6" fill="#3b2a20"/>'
  + '<circle cx="63.6" cy="65" r="1.6" fill="#fff"/><circle cx="95.6" cy="65" r="1.6" fill="#fff"/>'
  + '<ellipse cx="51" cy="79" rx="6.5" ry="3.8" fill="#ffb3b8" opacity=".75"/><ellipse cx="105" cy="79" rx="6.5" ry="3.8" fill="#ffb3b8" opacity=".75"/>'
  + '<path d="M75 74 h6 l-3 3.2 z" fill="#ff8f9a" stroke="#5b4636" stroke-width="1.2" stroke-linejoin="round"/>'
  + '<path d="M78 77.5 q-3.2 4.6 -7 1.4 M78 77.5 q3.2 4.6 7 1.4" fill="none" stroke="#5b4636" stroke-width="1.8" stroke-linecap="round"/>'
  + '<g fill="#fffaf4" stroke="#5b4636" stroke-width="2.4"><ellipse cx="48" cy="100" rx="16" ry="10.5"/><ellipse cx="108" cy="100" rx="16" ry="10.5"/></g>'
  + '<path d="M43 97 v5 M49 96 v6 M103 97 v5 M109 96 v6" stroke="#5b4636" stroke-width="1.8" stroke-linecap="round"/>'
  + '<path d="M20 20 c-3-4-9-1-6 4 l6 5 6-5 c3-5-3-8-6-4z" fill="#ff8fa3"/>'
  + '<path d="M132 12 l4-7 M138 20 l8-3 M128 6 l1-5" stroke="#ff8fa3" stroke-width="2.6" stroke-linecap="round"/>'
  + "</svg>";

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
// 전체화면(#content)에서는 body 에 붙인 창·끌기 그림이 보이지 않으므로 그 칸 안에 붙인다.
function tierLayerHost(){ return document.fullscreenElement || document.body; }
function tierModal(titleText, body){
  const modal = document.createElement("div"); modal.className = "tier-modal"; const card = document.createElement("div"); card.className = "tier-modal-card movable-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
  const head = document.createElement("header"), h = document.createElement("h2"), close = tierButton("", "닫기", "tier-modal-x", "close"); h.textContent = titleText; head.append(h, close); card.append(head, body); modal.appendChild(card); tierLayerHost().appendChild(modal);
  // Esc 는 초점이 창 밖(방금 두 번 누른 카드 등)에 있어도 이 창을 닫는다 — 그래야 전체화면이 대신 풀리지 않는다.
  const onKey = event => { const confirmOpen = document.getElementById("confirmModal"); if (confirmOpen && !confirmOpen.hidden) return;   // 위에 뜬 확인창이 먼저
    if (event.key === "Escape" && modal.isConnected){ event.preventDefault(); event.stopPropagation(); dispose(); } };
  const dispose = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); }; close.onclick = dispose; modal.addEventListener("pointerdown", event => { if (event.target === modal) dispose(); }); window.addEventListener("keydown", onKey, true); return { modal, dispose };
}

function mountTierEditor(doc){
  const model = doc.tierDoc, root = document.createElement("div"); root.className = "tier-doc"; doc.el.appendChild(root);
  const bar = document.createElement("div"); bar.className = "tier-bar";
  const brand = document.createElement("div"); brand.className = "tier-brand";
  brand.innerHTML = '<span class="tier-logo" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 26.5 5 17 24 7.5 43 17z" fill="#8b80f9" stroke="#2b2d6e" stroke-width="2.6" stroke-linejoin="round"/><path d="M5 24.5 24 34l19-9.5M5 32l19 9.5L43 32" fill="none" stroke="#2b2d6e" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/></svg></span>'
    + '<div class="tier-heading"><span class="tier-sub">드래그 앤 드롭으로 손쉽게 정리하세요.</span></div>';
  const titleInput = document.createElement("input"); titleInput.className = "tier-title"; titleInput.value = model.title; titleInput.maxLength = 160; titleInput.placeholder = "티어표 제목 (예: 최고의 간식)"; titleInput.title = "눌러서 제목 바꾸기";
  brand.querySelector(".tier-heading").prepend(titleInput);
  const textBtn = tierButton("카드 추가", "글자만 있는 카드 넣기", "tier-btn", "plus");
  const photoBtn = tierButton("가져오기", "사진 카드 넣기 — 여러 장을 한꺼번에 고르거나, 이 화면에 끌어다 놓거나, Ctrl+V 로 붙여 넣을 수 있어요", "tier-btn", "image");
  const undoBtn = tierButton("", "실행 취소 (Ctrl+Z)", "tier-btn", "undo"), redoBtn = tierButton("", "다시 실행 (Ctrl+Y)", "tier-btn", "redo");
  const saveBtn = tierButton("저장하기", "티어표 저장 (Ctrl+S)", "tier-btn tier-primary run-save", "save");
  const moreBtn = tierButton("", "더 보기 — 줄 추가·칠판으로·그림으로 저장·줄 틀·카드 크기", "tier-btn", "more");
  const actions = document.createElement("div"); actions.className = "tier-actions"; actions.append(textBtn, photoBtn, undoBtn, redoBtn, saveBtn, moreBtn);
  const mascot = document.createElement("div"); mascot.className = "tier-mascot"; mascot.setAttribute("aria-hidden", "true");
  mascot.innerHTML = '<span class="tier-mascot-say">좋아하는 걸<br>정리해봐요!</span>' + TIER_MASCOT_SVG;
  const barInner = document.createElement("div"); barInner.className = "tier-bar-inner"; barInner.append(brand, actions, mascot); bar.appendChild(barInner);
  const board = document.createElement("div"); board.className = "tier-board";
  const rowsEl = document.createElement("div"); rowsEl.className = "tier-rows";
  const poolSection = document.createElement("section"); poolSection.className = "tier-pool-section";
  const poolHead = document.createElement("div"); poolHead.className = "tier-pool-head";
  poolHead.innerHTML = '<span class="tier-pool-ico" aria-hidden="true"></span><div class="tier-pool-titles"><strong><span class="tier-pool-name">보유 카드</span><span class="tier-pool-count"></span></strong>'
    + '<span class="tier-sub">카드를 끌어 위의 줄에 놓으세요.<span class="tier-hint"> · 카드를 누른 뒤 숫자 키 1~9 로 그 줄에, 0 으로 여기로 · 두 번 누르면 고치기</span></span></div>'
    + '<button type="button" class="tier-btn tier-pool-clear" title="보유 카드를 한꺼번에 지우기 — 검색 중이면 찾은 카드만 (Ctrl+Z 로 되돌릴 수 있어요)"><span class="tier-pool-clear-ico" aria-hidden="true"></span><span class="tier-pool-clear-label">모두 지우기</span></button>'
    + '<label class="tier-search"><span class="tier-search-ico" aria-hidden="true"></span><input type="search" placeholder="카드 검색…" aria-label="보유 카드 검색" maxlength="60"></label>';
  if (typeof window.uiIcon === "function"){ poolHead.querySelector(".tier-pool-ico").innerHTML = window.uiIcon("image"); poolHead.querySelector(".tier-search-ico").innerHTML = window.uiIcon("search"); }
  const searchInput = poolHead.querySelector(".tier-search input"), poolClearBtn = poolHead.querySelector(".tier-pool-clear");
  poolHead.querySelector(".tier-pool-clear-ico").innerHTML = tierSvg("trash");
  const pool = document.createElement("div"); pool.className = "tier-items tier-pool"; pool.dataset.tier = "";
  poolSection.append(poolHead, pool);
  board.append(rowsEl, poolSection);
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"; fileInput.multiple = true; fileInput.hidden = true;
  root.append(bar, board, fileInput);
  // 고양이 발은 판 윗변에 걸쳐 있다 — 내려 보면 스크롤된 줄 위를 덮으니 슬쩍 숨긴다.
  board.addEventListener("scroll", () => mascot.classList.toggle("is-away", board.scrollTop > 6), { passive:true });
  // 판 쪽 스크롤 막대 폭만큼 머리말 오른쪽도 비워 두 틀의 가운데를 맞춘다(막대 폭은 배율·운영체제마다 다르다).
  const syncGutter = () => root.style.setProperty("--tier-gutter", Math.max(0, board.offsetWidth - board.clientWidth) + "px");
  const gutterObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncGutter) : null; if (gutterObserver) gutterObserver.observe(board);

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
      const rowEl = document.createElement("div"); rowEl.className = "tier-row"; rowEl.dataset.tierRow = row.id; rowEl.style.setProperty("--row-color", row.color);
      const label = document.createElement("button"); label.type = "button"; label.className = "tier-label"; label.style.background = row.color; label.style.color = tierInkFor(row.color);
      const labelText = document.createElement("span"); labelText.className = "tier-label-text"; labelText.textContent = row.label;
      const labelIco = document.createElement("span"); labelIco.className = "tier-label-ico"; labelIco.innerHTML = tierSvg(tierIconName(row.icon) || tierRowIcon(index, model.tiers.length));
      label.append(labelText, labelIco); label.title = "눌러서 줄 설정 — 이름·색 바꾸기·줄 추가·비우기" + (index < 9 ? ` · 카드를 고르고 ${index + 1} 키를 누르면 이 줄로` : "");
      label.onclick = () => openRowDialog(row.id);
      const zone = document.createElement("div"); zone.className = "tier-items"; zone.dataset.tier = row.id; zone.dataset.empty = "여기에 카드를 끌어다 놓으세요.";
      tierItemsIn(model, row.id).forEach(item => zone.appendChild(cardEl(item)));
      const tools = document.createElement("div"); tools.className = "tier-row-tools";
      const grip = document.createElement("button"); grip.type = "button"; grip.className = "tier-row-btn tier-row-grip"; grip.innerHTML = tierSvg("grip"); grip.dataset.rowIndex = String(index);
      grip.title = "끌어서 줄 순서 바꾸기 (↑·↓ 키로도 옮겨요)"; grip.setAttribute("aria-label", `줄 순서 바꾸기 — ${row.label || "이름 없는 줄"}`);
      grip.addEventListener("keydown", event => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); event.stopPropagation();
        const to = index + (event.key === "ArrowUp" ? -1 : 1); if (!moveRow(index, event.key === "ArrowUp" ? -1 : 1)) return;
        const again = rowsEl.querySelector(`.tier-row-grip[data-row-index="${to}"]`); if (again) again.focus();
      });
      // 줄 설정은 왼쪽 색 칸(줄 이름)을 누르면 열린다 — 따로 ⚙ 버튼을 두지 않고 손잡이·비우기를 크게.
      // 줄 자체를 지우는 건 줄 설정 창에만 둔다(자주 누르는 자리에서 줄이 통째로 사라지지 않게).
      const clear = document.createElement("button");
      clear.type = "button"; clear.className = "tier-row-btn tier-row-clear"; clear.innerHTML = tierSvg("eraser"); clear.title = "줄 비우기 (그 줄 카드는 보유 카드로 내려가요)"; clear.setAttribute("aria-label", `줄 비우기 — ${row.label || "이름 없는 줄"}`);
      clear.disabled = !tierItemsIn(model, row.id).length;
      clear.onclick = () => clearRow(row.id);
      tools.append(grip, clear);
      rowEl.append(label, zone, tools); rowsEl.appendChild(rowEl);
    });
    pool.innerHTML = ""; const rest = tierItemsIn(model, ""), shown = rest.filter(poolMatches);
    shown.forEach(item => pool.appendChild(cardEl(item)));
    if (!model.items.length){
      const empty = document.createElement("button"); empty.type = "button"; empty.className = "tier-empty"; empty.title = "사진 카드 넣기";
      empty.innerHTML = (typeof window.uiIcon === "function" ? window.uiIcon("image") : "") + '<strong>＋ 사진을 여기로 끌어다 놓거나 클릭해서 추가하세요.</strong><small>사진·글 카드로 나만의 티어표를 만들어 보세요.</small>';
      empty.onclick = () => fileInput.click(); pool.appendChild(empty);
    } else if (!shown.length && rest.length){ const none = document.createElement("p"); none.className = "tier-pool-none"; none.textContent = "찾는 카드가 없어요."; pool.appendChild(none); }
    poolClearBtn.disabled = !shown.length; poolHead.querySelector(".tier-pool-clear-label").textContent = shown.length !== rest.length ? `찾은 카드 ${shown.length}장 지우기` : "모두 지우기";
    poolHead.querySelector(".tier-pool-count").textContent = rest.length ? (shown.length !== rest.length ? `${shown.length} / ${rest.length}` : String(rest.length)) : "";
  }
  function poolQuery(){ return searchInput.value.trim().toLowerCase(); }
  function poolMatches(item){ const q = poolQuery(); return !q || [item.text, item.name].join(" ").toLowerCase().includes(q); }
  doc.tierSelectItem = id => {
    const found = model.items.find(item => item.id === id); if (!found) return false;
    if (!found.tier && !poolMatches(found)) searchInput.value = "";   // 검색에 가려진 카드면 검색을 풀어 보이게
    selectedId = id; render(); const el = board.querySelector(`[data-item-id="${CSS.escape(id)}"]`); if (el) el.scrollIntoView({ behavior:"smooth", block:"center" }); return true;
  };
  searchInput.addEventListener("input", () => render());
  searchInput.addEventListener("keydown", event => { if (event.key === "Escape" && searchInput.value){ event.preventDefault(); event.stopPropagation(); searchInput.value = ""; render(); } });

  function moveRow(index, delta){ return moveRowTo(index, index + delta); }
  function moveRowTo(from, to){ if (from === to || from < 0 || to < 0 || from >= model.tiers.length || to >= model.tiers.length) return false; const [row] = model.tiers.splice(from, 1); model.tiers.splice(to, 0, row); changed(); return true; }
  function clearRow(id){ const n = tierClearRow(model, id); if (!n) return; changed(); if (typeof toast === "function") toast(`카드 ${n}장을 보유 카드로 내렸어요. 되돌리려면 Ctrl+Z`, 2600); }
  function removeRow(id){ if (tierRemoveRow(model, id)){ changed(); if (typeof toast === "function") toast("줄을 지웠어요 — 그 줄 카드는 보유 카드로 내려갔어요. 되돌리려면 Ctrl+Z", 2800); } }
  function addRow(at){
    if (model.tiers.length >= TIER_MAX_TIERS){ if (typeof toast === "function") toast(`등급 줄은 ${TIER_MAX_TIERS}개까지 만들 수 있어요.`, 2600); return null; }
    const used = new Set(model.tiers.map(row => row.color)), color = TIER_COLORS.find(c => !used.has(c)) || TIER_COLORS[model.tiers.length % TIER_COLORS.length];
    const row = { id:tierId("row"), label:"새 줄", color, icon:"star" }; model.tiers.splice(at == null ? model.tiers.length : at, 0, row); changed(); return row;
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
    body.querySelector(".tf-clear").onclick = () => { apply(); ui.dispose(); if (tierItemsIn(model, row.id).length) clearRow(row.id); else changed(); };
    const del = body.querySelector(".tf-delete"); del.disabled = model.tiers.length <= 1;
    del.onclick = () => { ui.dispose(); removeRow(row.id); };
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
  async function clearPool(){
    const shown = tierItemsIn(model, "").filter(poolMatches); if (!shown.length) return;
    const filtered = shown.length !== tierItemsIn(model, "").length;
    const message = (filtered ? `검색으로 찾은 보유 카드 ${shown.length}장을 지울까요?` : `보유 카드 ${shown.length}장을 모두 지울까요?`) + " 줄에 올린 카드는 그대로 남아요.";
    if (typeof confirmDialog === "function" && !await confirmDialog(message, "지우기", "취소")) return;
    const removed = tierRemovePoolItems(model, shown.map(item => item.id)); if (!removed) return;
    if (selectedId && !model.items.some(item => item.id === selectedId)) selectedId = "";
    changed(); if (typeof toast === "function") toast(`보유 카드 ${removed}장을 지웠어요. 되돌리려면 Ctrl+Z`, 2800);
  }
  poolClearBtn.onclick = clearPool;
  function deleteItem(id){
    const before = model.items.length; model.items = model.items.filter(item => item.id !== id); if (model.items.length === before) return;
    if (selectedId === id) selectedId = ""; changed(); if (typeof toast === "function") toast("카드를 지웠어요. 되돌리려면 Ctrl+Z", 2400);
  }

  async function addImageFiles(files){
    const list = Array.from(files || []).filter(file => /^image\//i.test(file.type || "")); if (!list.length) return 0;
    const room = TIER_MAX_ITEMS - model.items.length; if (room <= 0){ if (typeof toast === "function") toast(`카드는 ${TIER_MAX_ITEMS}장까지 넣을 수 있어요.`, 2800); return 0; }
    // 줄을 지우면 그 줄 사진은 보유 카드로 내려와 남는다 — 같은 사진을 다시 올리면 카드가 겹치니 이미 있는 사진은 건너뛴다.
    const known = new Set(model.items.map(item => item.image && item.image.dataUrl).filter(Boolean));
    let added = 0, failed = 0, same = 0;
    for (const file of list.slice(0, room)){
      try {
        const image = await tierPrepareImage(file); if (known.has(image.dataUrl)){ same++; continue; } known.add(image.dataUrl);
        const item = tierNormalizeItem({ name:String(file.name || "").replace(/\.[^.]+$/, "") }); item.image = image; model.items.push(item); added++;
      }
      catch(_){ failed++; }
    }
    if (added) changed();
    if (typeof toast === "function"){
      const skipped = list.length - Math.min(list.length, room);
      toast((added || !same ? `사진 카드 ${added}장을 넣었어요.` : "이미 있는 사진이에요.") + (same ? ` (같은 사진 ${same}장은 이미 있어서 뺌)` : "") + (failed ? ` (${failed}장은 읽지 못함)` : "") + (skipped ? ` (${skipped}장은 한도를 넘어 뺌)` : ""), 3200);
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
  /* 줄 끌어 옮기기 — 줄 오른쪽 ⠿ 손잡이를 잡고 위아래로. 놓을 자리는 줄 사이 가로 막대로 보여 준다. */
  let rowDrag = null;
  rowsEl.addEventListener("pointerdown", event => {
    const grip = event.target.closest(".tier-row-grip"); if (!grip || event.button !== 0) return;
    const rowEl = grip.closest(".tier-row"); if (!rowEl) return;
    rowDrag = { rowEl, from:Number(grip.dataset.rowIndex), pointerId:event.pointerId, y:event.clientY, started:false, ghost:null, mark:null, to:-1, dy:0, left:0 };
  });
  const rowMove = event => {
    const state = rowDrag;
    if (!state.started){
      if (Math.abs(event.clientY - state.y) < 4) return;
      state.started = true; const r = state.rowEl.getBoundingClientRect(); state.dy = state.y - r.top; state.left = r.left;
      state.ghost = state.rowEl.cloneNode(true); state.ghost.classList.add("tier-row-ghost"); state.ghost.style.width = r.width + "px"; tierLayerHost().appendChild(state.ghost);
      state.rowEl.classList.add("is-dragging"); state.mark = document.createElement("div"); state.mark.className = "tier-row-mark"; root.classList.add("is-row-dragging");
    }
    event.preventDefault();
    state.ghost.style.transform = `translate(${state.left}px, ${event.clientY - state.dy}px)`;
    const others = Array.from(rowsEl.querySelectorAll(".tier-row")).filter(el => el !== state.rowEl);
    let at = others.findIndex(el => { const r = el.getBoundingClientRect(); return event.clientY < r.top + r.height / 2; }); if (at < 0) at = others.length;
    state.to = at; if (at < others.length) rowsEl.insertBefore(state.mark, others[at]); else rowsEl.appendChild(state.mark);
    autoScroll(event.clientY);
  };
  const rowFinish = cancel => {
    const state = rowDrag; rowDrag = null; if (!state.started) return;
    state.ghost.remove(); if (state.mark.parentNode) state.mark.remove(); state.rowEl.classList.remove("is-dragging"); root.classList.remove("is-row-dragging");
    if (cancel || state.to < 0 || !moveRowTo(state.from, state.to)) render();
  };
  const onMove = event => {
    if (rowDrag && event.pointerId === rowDrag.pointerId){ rowMove(event); return; }
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started){
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      drag.started = true; const r = drag.el.getBoundingClientRect(); drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
      drag.ghost = drag.el.cloneNode(true); drag.ghost.classList.add("tier-ghost"); drag.ghost.style.width = r.width + "px"; drag.ghost.style.height = r.height + "px"; tierLayerHost().appendChild(drag.ghost);
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
    if (rowDrag && (!event || event.pointerId === rowDrag.pointerId)){ rowFinish(cancel); return; }
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
  const addRowAndEdit = () => { const row = addRow(); if (row) openRowDialog(row.id); };
  titleInput.oninput = () => { model.title = titleInput.value; history.commitSoon(500); touch(); };
  saveBtn.onclick = () => saveTierDoc(doc);

  const exportPng = async () => {
    try { const png = await tierRenderPng(model); const blob = await (await fetch(png)).blob(); MNDownload.saveBlob(blob, tierSafeName(model.title) + ".png"); }
    catch(error){ console.warn("티어표 그림 저장 실패:", error); if (typeof toast === "function") toast("그림으로 저장하지 못했어요.", 3000, { type:"error" }); }
  };
  let sendingToBoard = false;
  const sendToBoard = async () => {
    if (typeof newWhiteboard !== "function"){ if (typeof toast === "function") toast("화이트보드를 열 수 없어요.", 2600); return; }
    if (sendingToBoard) return; sendingToBoard = true;
    try {
      const png = await tierRenderPng(model);
      const boardDoc = newWhiteboard({ name:tierSafeName(model.title), state:{ version:1, savedAt:Date.now(), bg:typeof defaultBoardBg === "function" ? defaultBoardBg() : "#ffffff", items:[] } });
      if (typeof setActiveDoc === "function") setActiveDoc(boardDoc.id);
      if (typeof ensureRendered === "function") await ensureRendered(boardDoc);   // 렌더가 끝나야 insertBoardImage 가 붙는다
      const placed = typeof boardDoc.insertBoardImage === "function" ? await boardDoc.insertBoardImage(png) : false;
      if (typeof toast === "function") toast(placed ? "티어표를 칠판으로 옮겼어요 — 그 위에 바로 판서할 수 있어요." : "칠판에 티어표를 넣지 못했어요.", 3000);
    } catch(error){ console.warn("티어표 칠판 보내기 실패:", error); if (typeof toast === "function") toast("칠판에 티어표를 넣지 못했어요.", 3000, { type:"error" }); }
    finally { sendingToBoard = false; }
  };
  moreBtn.onclick = () => {
    if (typeof MNContextMenu === "undefined"){ exportPng(); return; }
    const rect = moreBtn.getBoundingClientRect(); moreBtn.classList.add("is-open");
    MNContextMenu.open(rect.right - 210, rect.bottom + 6, [
      { label:"줄 추가", title:"맨 아래에 등급 줄 추가", icon:"plus", disabled:model.tiers.length >= TIER_MAX_TIERS, action:addRowAndEdit },
      { separator:true },
      { label:"칠판으로", title:"티어표를 그림으로 굳혀 새 화이트보드에 넣기", icon:"board", action:sendToBoard },
      { label:"그림(PNG)으로 저장", title:"등급 줄 전체를 그림 한 장으로 저장", icon:"image", action:exportPng },
      { separator:true },
      { label:"카드 크기", icon:"view", children:[["s", "작게"], ["m", "보통"], ["l", "크게"]].map(([size, label]) => ({ label, active:model.cardSize === size, action:() => { if (model.cardSize !== size){ model.cardSize = size; changed(); } } })) },
      { label:"줄 틀 바꾸기", icon:"list", children:TIER_PRESETS.map(preset => ({ label:preset.label, title:"줄 이름·색을 이 틀로 바꿉니다(카드는 같은 차례의 줄에 그대로)", action:() => { tierApplyPreset(model, preset.id); changed(); } })) },
      { separator:true },
      { label:"보유 카드 모두 지우기", title:"보유 카드(줄에 안 올린 카드)를 한꺼번에 지우기 — 검색 중이면 찾은 카드만", icon:"delete", disabled:!tierItemsIn(model, "").some(poolMatches), action:clearPool },
      { label:"보유 카드 섞기", title:"보유 카드의 차례를 무작위로 섞기", icon:"shuffle", disabled:tierItemsIn(model, "").length < 2, action:() => { tierShufflePool(model); changed(); } },
      { label:"모두 보유 카드로 내리기", title:"줄에 올린 카드를 전부 보유 카드로 되돌리기(다시 매기기)", icon:"refresh", disabled:!model.items.some(item => item.tier),
        action:async () => { if (typeof confirmDialog === "function" && !await confirmDialog("줄에 올린 카드를 모두 보유 카드로 내릴까요?", "내리기", "취소")) return; tierResetAll(model); changed(); } }
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
      const group = tierItemsIn(model, item.tier).filter(other => item.tier || poolMatches(other) || other === item), at = group.indexOf(item), to = at + (event.key === "ArrowLeft" ? -1 : 1); if (to < 0 || to >= group.length) return;
      event.preventDefault(); tierMoveItem(model, item.id, item.tier, event.key === "ArrowLeft" ? group[to].id : (group[to + 1] ? group[to + 1].id : "")); changed(); return;
    }
    if (event.key === "Delete" || event.key === "Backspace"){ event.preventDefault(); deleteItem(item.id); return; }
    if (event.key === "Enter"){ event.preventDefault(); openItemDialog(item.id); return; }
    if (event.key === "Escape"){ event.preventDefault(); selectedId = ""; render(); }
  };
  window.addEventListener("keydown", keydown);
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => {
    clearTimeout(recoveryTimer); if (history) history.cancel(); if (drag && drag.ghost) drag.ghost.remove(); drag = null; if (rowDrag && rowDrag.ghost) rowDrag.ghost.remove(); rowDrag = null;
    window.removeEventListener("keydown", keydown); document.removeEventListener("paste", onPaste); if (gutterObserver) gutterObserver.disconnect();
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel);
    if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery; delete doc.tierSelectItem; delete doc.tierMarkSaved;
  });
  render(); touch();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = { TIER_DOC_TYPE, TIER_DOC_VERSION, TIER_PRESETS, TIER_CARD_SIZES, tierDocEmpty, tierDocParse, tierDocSerialize, tierNormalizeItem,
    tierItemsIn, tierMoveItem, tierClearRow, tierRemoveRow, tierResetAll, tierApplyPreset, tierShufflePool, tierRemovePoolItems, tierSearchText, tierDefaultTitle, tierScratchFileName, tierInkFor };
}
