"use strict";

/* ===== 개념 관계도(.concept) =====
   카드와 연결선을 JSON 한 파일에 담고, 자유 배치와 자동 정렬을 모두 지원한다. */

const CONCEPT_DOC_TYPE = "classdock-concept";
const CONCEPT_DOC_VERSION = 1;
const CONCEPT_MAX_NODES = 300;
const CONCEPT_MAX_EDGES = 800;
const CONCEPT_CANVAS_WIDTH = 1800;
const CONCEPT_CANVAS_HEIGHT = 1100;
const CONCEPT_MAX_COORD = 30000;
const CONCEPT_MIN_ZOOM = .35;
const CONCEPT_MAX_ZOOM = 2;
const CONCEPT_HISTORY_LIMIT = 35;
const CONCEPT_RECOVERY_DELAY = 850;
const CONCEPT_COLORS = Object.freeze({ blue:"#2563eb", green:"#16a34a", amber:"#d97706", rose:"#e11d48", purple:"#7c3aed", slate:"#475569" });
const CONCEPT_RELATIONS = Object.freeze([
  { id:"cause", label:"원인 → 결과" }, { id:"include", label:"상위 → 하위" },
  { id:"compare", label:"비교" }, { id:"support", label:"근거·뒷받침" }, { id:"related", label:"관련" }
]);
const CONCEPT_PRESENT_ANIMATIONS = Object.freeze([
  { id:"fade", label:"페이드" }, { id:"zoom", label:"확대" }, { id:"slide", label:"슬라이드" },
  { id:"draw", label:"연결선 그리기" }, { id:"none", label:"효과 없음" }
]);
const CONCEPT_LAYOUTS = Object.freeze([
  { id:"tree", label:"위→아래 가계도", description:"상위 개념에서 자녀·하위 개념이 아래로 펼쳐집니다." },
  { id:"radial", label:"방사형", description:"선택한 카드를 중심으로 가까운 관계부터 사방으로 펼칩니다." },
  { id:"circle", label:"원형", description:"모든 카드를 큰 원 둘레에 고르게 놓습니다." },
  { id:"flow", label:"왼쪽→오른쪽", description:"원인·상위 개념에서 결과·하위 개념 방향으로 흐릅니다." },
  { id:"grid", label:"격자형", description:"관계 방향과 무관하게 카드를 반듯하게 정돈합니다." }
]);
const CONCEPT_LAYOUT_SPACING = Object.freeze({ tight:.78, normal:1, wide:1.35 });
let _conceptScratchCount = 0;

function conceptId(prefix){ return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function conceptClamp(value, min, max){ return Math.max(min, Math.min(max, Number(value) || 0)); }
function conceptClampZoom(value){ return conceptClamp(value, CONCEPT_MIN_ZOOM, CONCEPT_MAX_ZOOM); }
function conceptFitZoom(canvasWidth, canvasHeight, viewportWidth, viewportHeight){ const width = Math.max(1, Number(canvasWidth) || 1), height = Math.max(1, Number(canvasHeight) || 1), availableWidth = Math.max(1, (Number(viewportWidth) || 1) - 36), availableHeight = Math.max(1, (Number(viewportHeight) || 1) - 36); return conceptClampZoom(Math.min(availableWidth / width, availableHeight / height, 1)); }
function conceptZoomScroll(scrollLeft, scrollTop, anchorX, anchorY, oldZoom, nextZoom){
  const before = conceptClampZoom(oldZoom), after = conceptClampZoom(nextZoom), x = Math.max(0, Number(anchorX) || 0), y = Math.max(0, Number(anchorY) || 0);
  return { left:Math.max(0, ((Number(scrollLeft) || 0) + x) / before * after - x), top:Math.max(0, ((Number(scrollTop) || 0) + y) / before * after - y) };
}
function conceptDragCoordinate(origin, pointerDelta, scrollDelta, zoom){ return conceptClamp((Number(origin) || 0) + ((Number(pointerDelta) || 0) + (Number(scrollDelta) || 0)) / conceptClampZoom(zoom), 20, CONCEPT_MAX_COORD); }
function conceptCanvasSize(nodes){ return { width:Math.max(CONCEPT_CANVAS_WIDTH, ...(nodes || []).map(node => Number(node.x) + 290)), height:Math.max(CONCEPT_CANVAS_HEIGHT, ...(nodes || []).map(node => Number(node.y) + 210)) }; }
function conceptSafeText(value, max){ return String(value == null ? "" : value).slice(0, max); }
function conceptNormalizeImage(raw){
  const value = raw && typeof raw === "object" ? raw : null;
  const dataUrl = value ? String(value.dataUrl || "") : "";
  if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl) || dataUrl.length > 900 * 1024) return null;
  return { name:conceptSafeText(value.name || "사진", 120), dataUrl, width:conceptClamp(value.width, 1, 10000), height:conceptClamp(value.height, 1, 10000) };
}
function conceptNormalizeNode(raw, index){
  const value = raw && typeof raw === "object" ? raw : {};
  const color = Object.prototype.hasOwnProperty.call(CONCEPT_COLORS, value.color) ? value.color : "blue";
  return { id:conceptSafeText(value.id, 80) || conceptId("cn"), title:conceptSafeText(value.title, 120),
    description:conceptSafeText(value.description, 3000), category:conceptSafeText(value.category, 60).trim(), color,
    x:conceptClamp(value.x == null ? 70 + (Number(index) || 0) % 5 * 290 : value.x, 20, CONCEPT_MAX_COORD),
    y:conceptClamp(value.y == null ? 70 + Math.floor((Number(index) || 0) / 5) * 190 : value.y, 20, CONCEPT_MAX_COORD),
    image:conceptNormalizeImage(value.image) };
}
function conceptNormalizeEdge(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  const type = CONCEPT_RELATIONS.some(item => item.id === value.type) ? value.type : "related";
  return { id:conceptSafeText(value.id, 80) || conceptId("ce"), from:conceptSafeText(value.from, 80), to:conceptSafeText(value.to, 80),
    label:conceptSafeText(value.label, 80).trim(), type };
}
function conceptNormalizePresentation(raw, nodes){
  const value = raw && typeof raw === "object" ? raw : {}, ids = new Set((nodes || []).map(node => node.id)), seen = new Set(), order = [];
  for (const id of Array.isArray(value.order) ? value.order : []){ const safe = conceptSafeText(id, 80); if (ids.has(safe) && !seen.has(safe)){ seen.add(safe); order.push(safe); } }
  for (const node of nodes || []) if (!seen.has(node.id)){ seen.add(node.id); order.push(node.id); }
  const animation = CONCEPT_PRESENT_ANIMATIONS.some(item => item.id === value.animation) ? value.animation : "fade";
  return { order, animation, autoFocus:value.autoFocus !== false };
}
function conceptDocEmpty(title){ return { type:CONCEPT_DOC_TYPE, version:CONCEPT_DOC_VERSION, title:conceptSafeText(title || "개념 관계도", 160), layout:"free", layoutStyle:"tree", layoutSpacing:"normal", nodes:[], edges:[], presentation:conceptNormalizePresentation(null, []) }; }
function conceptDocParse(text){
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  if (!raw || raw.type !== CONCEPT_DOC_TYPE || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error("concept-format");
  if (raw.nodes.length > CONCEPT_MAX_NODES || raw.edges.length > CONCEPT_MAX_EDGES) throw new Error("concept-limit");
  const model = conceptDocEmpty(raw.title); model.layout = raw.layout === "auto" ? "auto" : "free"; model.layoutStyle = CONCEPT_LAYOUTS.some(item => item.id === raw.layoutStyle) ? raw.layoutStyle : (model.layout === "auto" ? "flow" : "tree"); model.layoutSpacing = Object.prototype.hasOwnProperty.call(CONCEPT_LAYOUT_SPACING, raw.layoutSpacing) ? raw.layoutSpacing : "normal";
  const seen = new Set(); model.nodes = raw.nodes.map(conceptNormalizeNode).filter(node => node.title && !seen.has(node.id) && seen.add(node.id));
  const ids = new Set(model.nodes.map(node => node.id)), edgeSeen = new Set();
  model.edges = raw.edges.map(conceptNormalizeEdge).filter(edge => edge.from !== edge.to && ids.has(edge.from) && ids.has(edge.to) && !edgeSeen.has(edge.id) && edgeSeen.add(edge.id));
  model.presentation = conceptNormalizePresentation(raw.presentation, model.nodes);
  return model;
}
function conceptDocSerialize(model){ return JSON.stringify(conceptDocParse({ ...model, type:CONCEPT_DOC_TYPE, version:CONCEPT_DOC_VERSION }), null, 2); }
function conceptSnapshot(model){ return JSON.stringify(model); }
function conceptSnapshotModel(snapshot){ return conceptDocParse(snapshot); }
function conceptSearchText(model){
  const names = new Map((model.nodes || []).map(node => [node.id, node.title]));
  return [model.title, ...(model.nodes || []).flatMap(node => [node.title, node.category, node.description]),
    ...(model.edges || []).flatMap(edge => [names.get(edge.from), edge.label, names.get(edge.to)])].filter(Boolean).join("\n");
}
function conceptNodeConnections(model, nodeId){
  const nodes = new Map((model && model.nodes || []).map(node => [node.id, node]));
  return (model && model.edges || []).filter(edge => edge.from === nodeId || edge.to === nodeId).map(edge => {
    const outgoing = edge.from === nodeId, other = nodes.get(outgoing ? edge.to : edge.from);
    if (!other) return null;
    const relation = CONCEPT_RELATIONS.find(item => item.id === edge.type);
    return { edgeId:edge.id, otherId:other.id, otherTitle:other.title, direction:outgoing ? "out" : "in", label:edge.label || (relation && relation.label) || "관련" };
  }).filter(Boolean);
}

function conceptDirectionalLevels(nodes, edges){
  const list = nodes || [], ids = new Set(list.map(node => node.id)), directional = new Set(["cause", "include", "support"]), outgoing = new Map(list.map(node => [node.id, []])), parents = new Map(list.map(node => [node.id, []])), incoming = new Map(list.map(node => [node.id, 0]));
  for (const edge of edges || []){ if (!directional.has(edge.type) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue; outgoing.get(edge.from).push(edge.to); parents.get(edge.to).push(edge.from); incoming.set(edge.to, incoming.get(edge.to) + 1); }
  const roots = list.filter(node => incoming.get(node.id) === 0).map(node => node.id), depth = new Map(), queue = [...roots]; roots.forEach(id => depth.set(id, 0));
  for (let i = 0; i < queue.length; i++){ const id = queue[i], nextDepth = (depth.get(id) || 0) + 1; for (const to of outgoing.get(id) || []){ depth.set(to, Math.max(depth.get(to) || 0, nextDepth)); incoming.set(to, incoming.get(to) - 1); if (incoming.get(to) === 0) queue.push(to); } }
  const maxDepth = Math.max(0, ...depth.values()); list.forEach(node => { if (!depth.has(node.id)) depth.set(node.id, maxDepth + 1); });
  const levels = new Map(); list.forEach(node => { const d = depth.get(node.id); if (!levels.has(d)) levels.set(d, []); levels.get(d).push(node); });
  const prior = new Map(); [...levels.keys()].sort((a, b) => a - b).forEach(d => { const level = levels.get(d); level.sort((a, b) => { const score = node => { const known = (parents.get(node.id) || []).map(id => prior.get(id)).filter(value => value != null); return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : Number(node.y) / 10000 + Number(node.x) / 100000000; }; return score(a) - score(b) || Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x); }); level.forEach((node, index) => prior.set(node.id, index)); });
  return { levels, roots };
}
function conceptAutoLayout(nodes, edges, options = {}){
  const list = (nodes || []).map(conceptNormalizeNode); if (!list.length) return list;
  const mode = CONCEPT_LAYOUTS.some(item => item.id === options.mode) ? options.mode : "flow", spacingKey = Object.prototype.hasOwnProperty.call(CONCEPT_LAYOUT_SPACING, options.spacing) ? options.spacing : "normal", spacing = CONCEPT_LAYOUT_SPACING[spacingKey], positions = new Map();
  if (mode === "grid"){
    const columns = Math.max(1, Math.ceil(Math.sqrt(list.length * 1.45))), gapX = 280 * spacing, gapY = 180 * spacing; list.forEach((node, index) => positions.set(node.id, { x:70 + index % columns * gapX, y:70 + Math.floor(index / columns) * gapY }));
  } else if (mode === "circle"){
    const radius = Math.min((CONCEPT_MAX_COORD - 400) / 2, Math.max(300 * spacing, list.length * 270 * spacing / (Math.PI * 2))), center = radius + 180; list.forEach((node, index) => { const angle = -Math.PI / 2 + index / list.length * Math.PI * 2; positions.set(node.id, { x:center + Math.cos(angle) * radius - 115, y:center + Math.sin(angle) * radius - 65 }); });
  } else if (mode === "radial"){
    const byId = new Map(list.map(node => [node.id, node])), adjacency = new Map(list.map(node => [node.id, []])); for (const edge of edges || []) if (byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to){ adjacency.get(edge.from).push(edge.to); adjacency.get(edge.to).push(edge.from); }
    const directed = conceptDirectionalLevels(list, edges), rootId = byId.has(options.rootId) ? options.rootId : (directed.roots[0] || list[0].id), depth = new Map([[rootId, 0]]), queue = [rootId]; for (let i = 0; i < queue.length; i++){ const id = queue[i]; for (const next of adjacency.get(id) || []) if (!depth.has(next)){ depth.set(next, depth.get(id) + 1); queue.push(next); } }
    const maxConnectedDepth = Math.max(0, ...depth.values()); list.forEach(node => { if (!depth.has(node.id)) depth.set(node.id, maxConnectedDepth + 1); }); const rings = new Map(); list.forEach(node => { const d = depth.get(node.id); if (!rings.has(d)) rings.set(d, []); rings.get(d).push(node); });
    let maxRadius = 0; const radii = new Map(); for (const [d, ring] of rings){ const radius = d === 0 ? 0 : Math.max(d * 310 * spacing, ring.length * 270 * spacing / (Math.PI * 2)); radii.set(d, radius); maxRadius = Math.max(maxRadius, radius); } const center = Math.min(CONCEPT_MAX_COORD / 2, maxRadius + 180);
    for (const [d, ring] of rings){ const radius = radii.get(d); ring.forEach((node, index) => { const angle = -Math.PI / 2 + index / ring.length * Math.PI * 2; positions.set(node.id, { x:center + Math.cos(angle) * radius - 115, y:center + Math.sin(angle) * radius - 65 }); }); }
  } else {
    const { levels } = conceptDirectionalLevels(list, edges), keys = [...levels.keys()].sort((a, b) => a - b);
    if (mode === "tree"){
      const maxCount = Math.max(1, ...keys.map(key => levels.get(key).length)), gapX = 280 * spacing, gapY = 205 * spacing; keys.forEach(depth => { const level = levels.get(depth), startX = 80 + (maxCount - level.length) * gapX / 2; level.forEach((node, index) => positions.set(node.id, { x:startX + index * gapX, y:70 + depth * gapY })); });
    } else {
      const gapX = 340 * spacing, gapY = 180 * spacing; keys.forEach(depth => levels.get(depth).forEach((node, index) => positions.set(node.id, { x:70 + depth * gapX, y:70 + index * gapY })));
    }
  }
  return list.map(node => { const point = positions.get(node.id) || { x:node.x, y:node.y }; return { ...node, x:conceptClamp(point.x, 20, CONCEPT_MAX_COORD), y:conceptClamp(point.y, 20, CONCEPT_MAX_COORD) }; });
}
function conceptAutoPresentationOrder(nodes, edges){
  const list = nodes || [], ids = new Set(list.map(node => node.id)), directional = new Set(["cause", "include", "support"]);
  const outgoing = new Map(list.map(node => [node.id, []])), incoming = new Map(list.map(node => [node.id, 0]));
  for (const edge of edges || []){
    if (!directional.has(edge.type) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
    outgoing.get(edge.from).push(edge.to); incoming.set(edge.to, incoming.get(edge.to) + 1);
  }
  const byPosition = (a, b) => Number(a.x) - Number(b.x) || Number(a.y) - Number(b.y) || String(a.title).localeCompare(String(b.title), "ko");
  let layer = list.filter(node => incoming.get(node.id) === 0).sort(byPosition), ordered = [], used = new Set();
  while (layer.length){
    const next = [];
    for (const node of layer){
      if (used.has(node.id)) continue; used.add(node.id); ordered.push(node.id);
      for (const to of outgoing.get(node.id) || []){ incoming.set(to, incoming.get(to) - 1); if (incoming.get(to) === 0){ const target = list.find(item => item.id === to); if (target) next.push(target); } }
    }
    layer = next.sort(byPosition);
  }
  list.filter(node => !used.has(node.id)).sort(byPosition).forEach(node => ordered.push(node.id));
  return ordered;
}

function conceptDefaultTitle(name){ return String(name || "").replace(/\.concept$/i, "") || "개념 관계도"; }
function conceptScratchFileName(number){ return number > 1 ? "개념 관계도 " + number + ".concept" : "개념 관계도.concept"; }
async function loadConceptDoc(file, opts = {}){
  let model;
  try { model = conceptDocParse(await file.text()); }
  catch(_){ if (typeof toast === "function") toast("개념 관계도(.concept)를 읽지 못해 텍스트로 열었어요.", 3600); return typeof loadText === "function" ? loadText(file, opts) : null; }
  if (!model.title) model.title = conceptDefaultTitle(file.name);
  const doc = makeDoc("concept", file.name, opts); doc.conceptDoc = model; doc.sourceFile = file; doc.savedText = conceptDocSerialize(model); doc._conceptSavedSnapshot = conceptSnapshot(model);
  doc.contentSearchFocus = query => { const needle = String(query || "").trim().toLowerCase(); const found = model.nodes.find(node => [node.title, node.category, node.description].join(" ").toLowerCase().includes(needle)); if (!found || typeof doc.conceptSelectNode !== "function") return false; doc.conceptSelectNode(found.id, true); return true; };
  doc.render = async () => { if (doc._conceptMounted) return; doc._conceptMounted = true; doc.el.innerHTML = ""; mountConceptEditor(doc); };
  if (typeof refreshChrome === "function") refreshChrome(); if (typeof activateIfIdle === "function") activateIfIdle(doc, opts); return doc;
}
function newConceptScratch(){
  _conceptScratchCount++; const name = conceptScratchFileName(_conceptScratchCount);
  if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([conceptDocSerialize(conceptDocEmpty(conceptDefaultTitle(name)))], name, { type:"application/json" })], { isScratch:true }));
}
function newConceptScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  return createScratchInFolder(folder, conceptScratchFileName, name => conceptDocSerialize(conceptDocEmpty(conceptDefaultTitle(name))), "application/json", "개념 관계도");
}
async function saveConceptDoc(doc){
  if (!doc || !doc.conceptDoc) return false; const json = conceptDocSerialize(doc.conceptDoc);
  const ok = typeof saveTextDoc === "function" ? await saveTextDoc(json, doc, doc.name) : false; if (!ok) return false;
  doc.savedText = json; doc._conceptSavedSnapshot = conceptSnapshot(doc.conceptDoc);
  if (doc._conceptHistory && typeof doc._conceptHistory.replaceCurrent === "function") doc._conceptHistory.replaceCurrent(doc._conceptSavedSnapshot);
  if (typeof markDocumentSavedSnapshot === "function") await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json"); else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
  return true;
}
function conceptButton(label, title, className){ const button = document.createElement("button"); button.type = "button"; button.className = className || "concept-btn"; button.textContent = label; if (title) button.title = title; return button; }
function conceptModal(titleText, body){
  const modal = document.createElement("div"); modal.className = "concept-modal"; const card = document.createElement("div"); card.className = "concept-modal-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
  const head = document.createElement("header"), title = document.createElement("h2"), close = conceptButton("×", "닫기", "concept-modal-x"); title.textContent = titleText; head.append(title, close); card.append(head, body); modal.appendChild(card); document.body.appendChild(modal);
  const dispose = () => modal.remove(); close.addEventListener("click", dispose); modal.addEventListener("pointerdown", event => { if (event.target === modal) dispose(); }); modal.addEventListener("keydown", event => { if (event.key === "Escape"){ event.preventDefault(); dispose(); } });
  return { modal, card, dispose };
}

function mountConceptEditor(doc){
  const model = doc.conceptDoc, root = document.createElement("div"); root.className = "concept-doc"; doc.el.appendChild(root);
  const bar = document.createElement("div"); bar.className = "concept-bar";
  const titleInput = document.createElement("input"); titleInput.className = "concept-title"; titleInput.maxLength = 160; titleInput.value = model.title; titleInput.placeholder = "관계도 제목";
  const addNodeBtn = conceptButton("＋ 개념", "새 개념 카드 추가", "concept-btn concept-primary"), addEdgeBtn = conceptButton("＋ 관계", "두 개념 사이 관계 추가"), autoBtn = conceptButton("자동 정렬 ▾", "가계도·방사형·원형·흐름형·격자형 중에서 배치 선택");
  const undoBtn = conceptButton("↶", "실행 취소 (Ctrl+Z)"), redoBtn = conceptButton("↷", "다시 실행 (Ctrl+Shift+Z)");
  const search = document.createElement("input"); search.type = "search"; search.className = "concept-search"; search.placeholder = "개념·설명 검색";
  const orderBtn = conceptButton("① 순서", "전개 발표에서 카드가 나올 순서 정하기"), animationSelect = document.createElement("select"); animationSelect.className = "concept-animation"; animationSelect.title = "전개 발표 애니메이션"; animationSelect.setAttribute("aria-label", "전개 발표 애니메이션");
  CONCEPT_PRESENT_ANIMATIONS.forEach(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = "효과: " + item.label; animationSelect.appendChild(option); }); animationSelect.value = model.presentation.animation;
  const zoomTools = document.createElement("div"); zoomTools.className = "concept-zoom-tools"; const zoomOutBtn = conceptButton("−", "축소 (Ctrl+마우스 휠 아래)"), zoomResetBtn = conceptButton("100%", "배율 100%로 되돌리기"), zoomInBtn = conceptButton("＋", "확대 (Ctrl+마우스 휠 위)"); zoomTools.append(zoomOutBtn, zoomResetBtn, zoomInBtn);
  const presentBtn = conceptButton("▶ 큰 카드", "개념을 하나씩 크게 보여주기"), buildPresentBtn = conceptButton("✨ 전개 발표", "Space 키로 카드와 관계를 순서대로 공개", "concept-btn concept-build-start"), printBtn = conceptButton("🖨 인쇄", "관계도를 인쇄하거나 PDF로 저장"), saveBtn = conceptButton("저장", "개념 관계도 저장 (Ctrl+S)", "concept-btn concept-primary run-save");
  bar.append(titleInput, addNodeBtn, addEdgeBtn, autoBtn, undoBtn, redoBtn, search, zoomTools, orderBtn, animationSelect, presentBtn, buildPresentBtn, printBtn, saveBtn);
  const viewport = document.createElement("div"); viewport.className = "concept-viewport"; viewport.tabIndex = 0;
  const zoomSpace = document.createElement("div"); zoomSpace.className = "concept-zoom-space";
  const stage = document.createElement("div"); stage.className = "concept-stage"; stage.style.width = CONCEPT_CANVAS_WIDTH + "px"; stage.style.height = CONCEPT_CANVAS_HEIGHT + "px";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("concept-lines"); svg.setAttribute("viewBox", `0 0 ${CONCEPT_CANVAS_WIDTH} ${CONCEPT_CANVAS_HEIGHT}`);
  svg.innerHTML = '<defs><marker id="conceptArrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z"></path></marker></defs>';
  const cards = document.createElement("div"); cards.className = "concept-cards"; stage.append(svg, cards); zoomSpace.appendChild(stage); viewport.appendChild(zoomSpace); root.append(bar, viewport);
  let selectedId = "", history = null, recoveryTimer = 0, drag = null, previewTimer = 0, suppressCardClick = false, closeNodePreview = null, closeBuildPresentation = null, zoom = 1;

  const snapshot = () => conceptSnapshot(model);
  const flushRecovery = async () => {
    clearTimeout(recoveryTimer); recoveryTimer = 0;
    if (!doc.hasUnsavedEdits && !(doc.isScratch && !doc._named)) return true;
    if (typeof rememberWorkspace !== "function" || typeof recoverySnapshotFile !== "function") return false;
    try { const file = recoverySnapshotFile(doc, new TextEncoder().encode(conceptDocSerialize(model)), "application/json"); doc.savedInWorkspace = file ? await rememberWorkspace([file], false, { silent:true }) : false; return !!doc.savedInWorkspace; }
    catch(error){ console.warn("개념 관계도 복구본 저장 실패:", error); return false; }
  };
  const touch = () => { if (typeof markDocumentDirty === "function") markDocumentDirty(doc, snapshot() !== doc._conceptSavedSnapshot); clearTimeout(recoveryTimer); recoveryTimer = setTimeout(flushRecovery, CONCEPT_RECOVERY_DELAY); };
  doc.flushBackupRecovery = flushRecovery;
  const replaceModel = restored => { model.title = restored.title; model.layout = restored.layout; model.layoutStyle = restored.layoutStyle; model.layoutSpacing = restored.layoutSpacing; model.nodes = restored.nodes; model.edges = restored.edges; model.presentation = restored.presentation; titleInput.value = model.title; animationSelect.value = model.presentation.animation; if (selectedId && !model.nodes.some(node => node.id === selectedId)) selectedId = ""; render(); touch(); };
  history = MNEditHistory.create({ capture:snapshot, isEqual:(a, b) => a === b, apply:value => replaceModel(conceptSnapshotModel(value)), onChange:() => { undoBtn.disabled = !history.canUndo(); redoBtn.disabled = !history.canRedo(); }, limit:CONCEPT_HISTORY_LIMIT });
  history.reset(); doc._conceptHistory = history;

  const syncCanvasSize = () => {
    const size = conceptCanvasSize(model.nodes); stage.style.width = size.width + "px"; stage.style.height = size.height + "px"; stage.style.transform = `scale(${zoom})`; svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    zoomSpace.style.width = Math.max(viewport.clientWidth, size.width * zoom) + "px"; zoomSpace.style.height = Math.max(viewport.clientHeight, size.height * zoom) + "px"; zoomResetBtn.textContent = Math.round(zoom * 100) + "%"; zoomOutBtn.disabled = zoom <= CONCEPT_MIN_ZOOM; zoomInBtn.disabled = zoom >= CONCEPT_MAX_ZOOM;
    viewport.classList.toggle("is-pannable", viewport.scrollWidth > viewport.clientWidth + 1 || viewport.scrollHeight > viewport.clientHeight + 1);
  };
  const setZoom = (value, clientX, clientY) => {
    const next = conceptClampZoom(value); if (Math.abs(next - zoom) < .001) return;
    const rect = viewport.getBoundingClientRect(), anchorX = clientX == null ? rect.width / 2 : clientX - rect.left, anchorY = clientY == null ? rect.height / 2 : clientY - rect.top, scroll = conceptZoomScroll(viewport.scrollLeft, viewport.scrollTop, anchorX, anchorY, zoom, next); zoom = next; syncCanvasSize(); viewport.scrollTo({ left:scroll.left, top:scroll.top, behavior:"auto" });
  };
  const fitCanvasToViewport = () => { const size = conceptCanvasSize(model.nodes); zoom = conceptFitZoom(size.width, size.height, viewport.clientWidth, viewport.clientHeight); syncCanvasSize(); viewport.scrollTo({ left:0, top:0, behavior:"smooth" }); };
  const onViewportWheel = event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1, factor = Math.exp(-event.deltaY * unit * .0014); setZoom(zoom * factor, event.clientX, event.clientY); };
  viewport.addEventListener("wheel", onViewportWheel, { passive:false }); zoomOutBtn.onclick = () => setZoom(zoom / 1.2); zoomResetBtn.onclick = () => setZoom(1); zoomInBtn.onclick = () => setZoom(zoom * 1.2);
  // 빈 여백을 끌어서 화면을 옮긴다(손바닥). 카드·연결선 위에서는 원래 동작을 그대로 둔다.
  // 빈 곳의 이벤트 대상은 무대가 아니라 무대를 덮은 svg(.concept-lines)라서 허용 목록에 함께 넣는다.
  let panState = null;
  const panBackground = target => target === viewport || target === zoomSpace || target === stage || target === svg || target === cards;
  const onPanPointerDown = event => {
    if (event.button !== 0 || (event.pointerType && event.pointerType !== "mouse")) return;
    if (!panBackground(event.target) || !viewport.classList.contains("is-pannable")) return;
    event.preventDefault();
    panState = { id:event.pointerId, x:event.clientX, y:event.clientY, left:viewport.scrollLeft, top:viewport.scrollTop };
    viewport.classList.add("is-panning");
    try { viewport.setPointerCapture(event.pointerId); } catch(_){}
  };
  const onPanPointerMove = event => {
    if (!panState || event.pointerId !== panState.id) return;
    event.preventDefault();
    viewport.scrollLeft = panState.left - (event.clientX - panState.x);
    viewport.scrollTop = panState.top - (event.clientY - panState.y);
  };
  const finishPan = event => {
    if (!panState || (event && event.pointerId !== panState.id)) return;
    const pointerId = panState.id; panState = null; viewport.classList.remove("is-panning");
    try { if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId); } catch(_){}
  };
  viewport.addEventListener("pointerdown", onPanPointerDown); viewport.addEventListener("pointermove", onPanPointerMove);
  viewport.addEventListener("pointerup", finishPan); viewport.addEventListener("pointercancel", finishPan); viewport.addEventListener("lostpointercapture", finishPan);
  const viewportResizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncCanvasSize) : null; if (viewportResizeObserver) viewportResizeObserver.observe(viewport);

  const edgePath = (from, to) => { const ax = from.x + 115, ay = from.y + 65, bx = to.x + 115, by = to.y + 65, bend = Math.max(50, Math.abs(bx - ax) * .42); return `M ${ax} ${ay} C ${ax + (bx >= ax ? bend : -bend)} ${ay}, ${bx - (bx >= ax ? bend : -bend)} ${by}, ${bx} ${by}`; };
  function renderEdges(){
    [...svg.querySelectorAll(".concept-edge")].forEach(node => node.remove()); const byNode = new Map(model.nodes.map(node => [node.id, node]));
    for (const edge of model.edges){
      const from = byNode.get(edge.from), to = byNode.get(edge.to); if (!from || !to) continue;
      const group = document.createElementNS(svg.namespaceURI, "g"); group.classList.add("concept-edge"); group.dataset.edgeId = edge.id;
      const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", edgePath(from, to)); path.setAttribute("marker-end", "url(#conceptArrow)"); path.classList.add("concept-edge-path", "is-" + edge.type);
      const label = document.createElementNS(svg.namespaceURI, "text"); label.classList.add("concept-edge-label"); label.setAttribute("x", String((from.x + to.x) / 2 + 115)); label.setAttribute("y", String((from.y + to.y) / 2 + 55)); label.textContent = edge.label || (CONCEPT_RELATIONS.find(item => item.id === edge.type) || {}).label || "관련";
      group.append(path, label); group.addEventListener("dblclick", () => openEdgeDialog(edge.id)); svg.appendChild(group);
    }
  }
  const selectCard = id => {
    selectedId = id;
    cards.querySelectorAll(".concept-card").forEach(card => card.classList.toggle("is-selected", card.dataset.nodeId === id));
  };
  const showLargeNode = (overlay, node, status) => {
    const color = CONCEPT_COLORS[node.color]; overlay.style.setProperty("--concept-color", color); overlay.querySelector("article").style.setProperty("--concept-color", color); overlay.querySelector(".concept-present-top span").textContent = status;
    overlay.querySelector("small").textContent = node.category || "개념"; overlay.querySelector("h2").textContent = node.title; overlay.querySelector("p").textContent = node.description || "설명이 없습니다.";
    const image = overlay.querySelector(".concept-present-image"); image.innerHTML = ""; image.hidden = !node.image;
    if (node.image){ const img = document.createElement("img"); img.src = node.image.dataUrl; img.alt = ""; image.appendChild(img); }
    const links = overlay.querySelector(".concept-present-links"); links.innerHTML = "";
    conceptNodeConnections(model, node.id).forEach(link => { const chip = document.createElement("span"); chip.textContent = (link.direction === "out" ? "→ " : "← ") + link.label + " · " + link.otherTitle; links.appendChild(chip); });
  };
  function openNodePreview(id, returnFocus){
    const node = model.nodes.find(item => item.id === id); if (!node) return;
    if (closeNodePreview) closeNodePreview();
    const overlay = document.createElement("div"); overlay.className = "concept-present concept-focus"; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", node.title + " 크게 보기");
    overlay.innerHTML = '<div class="concept-present-top"><span></span><button type="button">닫기</button></div><article><small></small><h2></h2><div class="concept-present-main"><div class="concept-present-image"></div><p></p></div><div class="concept-present-links"></div></article>';
    root.appendChild(overlay);
    const close = () => { window.removeEventListener("keydown", keys); overlay.remove(); if (closeNodePreview === close) closeNodePreview = null; if (returnFocus && returnFocus.isConnected) returnFocus.focus(); };
    const keys = event => { if (event.key === "Escape"){ event.preventDefault(); close(); } };
    closeNodePreview = close; overlay.querySelector(".concept-present-top button").onclick = close; overlay.addEventListener("pointerdown", event => { if (event.target === overlay) close(); }); window.addEventListener("keydown", keys);
    showLargeNode(overlay, node, "카드 크게 보기"); overlay.querySelector(".concept-present-top button").focus();
  }
  function render(){
    syncCanvasSize();
    cards.innerHTML = ""; const query = search.value.trim().toLowerCase(), orderById = new Map(model.presentation.order.map((id, index) => [id, index + 1]));
    for (const node of model.nodes){
      const card = document.createElement("article"); card.className = "concept-card" + (node.id === selectedId ? " is-selected" : ""); card.dataset.nodeId = node.id; card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.setProperty("--concept-color", CONCEPT_COLORS[node.color]);
      card.tabIndex = 0; card.title = "클릭: 크게 보기 · 끌기: 이동 · 두 번 클릭: 수정"; card.setAttribute("aria-label", node.title + " 카드. Enter 키로 크게 보기");
      if (query && ![node.title, node.category, node.description].join(" ").toLowerCase().includes(query)) card.classList.add("is-muted");
      const head = document.createElement("div"); head.className = "concept-card-head"; const headLabel = document.createElement("div"), order = document.createElement("span"), category = document.createElement("small"); headLabel.className = "concept-card-label"; order.className = "concept-order-badge"; order.textContent = String(orderById.get(node.id) || "–"); order.title = "발표 순서"; category.textContent = node.category || "개념"; headLabel.append(order, category); const edit = conceptButton("⋯", "개념 수정", "concept-card-edit"); head.append(headLabel, edit);
      const title = document.createElement("h3"); title.textContent = node.title; const body = document.createElement("div"); body.className = "concept-card-body";
      if (node.image){ const img = document.createElement("img"); img.src = node.image.dataUrl; img.alt = ""; body.appendChild(img); }
      const description = document.createElement("p"); description.textContent = node.description || "설명을 입력하세요."; body.appendChild(description); card.append(head, title, body); cards.appendChild(card);
      edit.addEventListener("click", event => { event.stopPropagation(); openNodeDialog(node.id); });
      card.addEventListener("click", () => { if (suppressCardClick){ suppressCardClick = false; return; } selectCard(node.id); clearTimeout(previewTimer); previewTimer = setTimeout(() => { previewTimer = 0; openNodePreview(node.id, card); }, 220); });
      card.addEventListener("dblclick", event => { if (event.target.closest("button")) return; clearTimeout(previewTimer); previewTimer = 0; openNodeDialog(node.id); });
      card.addEventListener("keydown", event => { if (event.target !== card || event.key !== "Enter") return; event.preventDefault(); selectCard(node.id); openNodePreview(node.id, card); });
      card.addEventListener("pointerdown", event => { if (event.button !== 0 || event.target.closest("button")) return; clearTimeout(previewTimer); previewTimer = 0; selectCard(node.id); drag = { id:node.id, pointer:event.pointerId, x:event.clientX, y:event.clientY, lastX:event.clientX, lastY:event.clientY, ox:node.x, oy:node.y, scrollLeft:viewport.scrollLeft, scrollTop:viewport.scrollTop, zoom }; card.setPointerCapture(event.pointerId); card.classList.add("is-dragging"); });
      card.addEventListener("pointermove", event => { if (!drag || drag.pointer !== event.pointerId || drag.id !== node.id) return; const rect = viewport.getBoundingClientRect(), margin = 58, speed = 22, moveX = event.clientX - drag.lastX, moveY = event.clientY - drag.lastY, dx = event.clientX > rect.right - margin && moveX > 0 ? speed : event.clientX < rect.left + margin && moveX < 0 ? -speed : 0, dy = event.clientY > rect.bottom - margin && moveY > 0 ? speed : event.clientY < rect.top + margin && moveY < 0 ? -speed : 0; drag.lastX = event.clientX; drag.lastY = event.clientY; if (dx || dy) viewport.scrollBy({ left:dx, top:dy, behavior:"auto" }); const activeZoom = drag.zoom || 1; node.x = conceptDragCoordinate(drag.ox, event.clientX - drag.x, viewport.scrollLeft - drag.scrollLeft, activeZoom); node.y = conceptDragCoordinate(drag.oy, event.clientY - drag.y, viewport.scrollTop - drag.scrollTop, activeZoom); card.style.left = node.x + "px"; card.style.top = node.y + "px"; syncCanvasSize(); renderEdges(); });
      const finish = event => { if (!drag || drag.pointer !== event.pointerId || drag.id !== node.id) return; const changed = node.x !== drag.ox || node.y !== drag.oy; drag = null; card.classList.remove("is-dragging"); if (changed){ suppressCardClick = true; setTimeout(() => { suppressCardClick = false; }, 0); model.layout = "free"; history.commit(); touch(); } };
      card.addEventListener("pointerup", finish); card.addEventListener("pointercancel", finish);
    }
    renderEdges();
    if (!model.nodes.length){ const empty = conceptButton("＋ 첫 개념을 넣어 관계도를 시작하세요", "첫 개념 추가", "concept-empty"); empty.addEventListener("click", () => openNodeDialog()); cards.appendChild(empty); }
  }
  doc.conceptSelectNode = (id, center) => { const node = model.nodes.find(item => item.id === id); if (!node) return false; selectedId = id; render(); if (center) viewport.scrollTo({ left:Math.max(0, (node.x + 115) * zoom - viewport.clientWidth / 2), top:Math.max(0, (node.y + 65) * zoom - viewport.clientHeight / 2), behavior:"smooth" }); return true; };

  function openAutoLayoutDialog(){
    if (!model.nodes.length){ if (typeof toast === "function") toast("정렬할 카드가 없어요.", 2200); return; }
    const body = document.createElement("div"); body.className = "concept-layout-form"; body.innerHTML = '<fieldset><legend>배치 방식</legend><div class="concept-layout-choices"></div></fieldset><fieldset><legend>카드 간격</legend><div class="concept-layout-spacing"></div></fieldset><label class="concept-layout-fit"><input type="checkbox" checked><span><strong>정렬 뒤 화면에 맞춤</strong><small>관계도 전체가 최대한 보이도록 배율을 자동 조절합니다.</small></span></label><p class="concept-layout-root"></p><footer><button type="button" class="cl-cancel">취소</button><button type="button" class="cl-apply primary">정렬 적용</button></footer>';
    const ui = conceptModal("자동 정렬", body), choices = body.querySelector(".concept-layout-choices"), spacing = body.querySelector(".concept-layout-spacing");
    CONCEPT_LAYOUTS.forEach(item => { const label = document.createElement("label"); label.className = "concept-layout-choice"; const input = document.createElement("input"); input.type = "radio"; input.name = "concept-layout-mode"; input.value = item.id; input.checked = item.id === model.layoutStyle; const copy = document.createElement("span"), strong = document.createElement("strong"), small = document.createElement("small"); strong.textContent = item.label; small.textContent = item.description; copy.append(strong, small); label.append(input, copy); choices.appendChild(label); });
    [["tight", "좁게"], ["normal", "보통"], ["wide", "넓게"]].forEach(([value, text]) => { const label = document.createElement("label"), input = document.createElement("input"); input.type = "radio"; input.name = "concept-layout-spacing"; input.value = value; input.checked = value === model.layoutSpacing; label.append(input, document.createTextNode(text)); spacing.appendChild(label); });
    const rootNode = model.nodes.find(node => node.id === selectedId); body.querySelector(".concept-layout-root").textContent = rootNode ? `방사형 중심: 선택한 카드 ‘${rootNode.title}’` : "방사형 중심: 관계의 시작 카드(들어오는 방향 관계가 없는 카드)";
    body.querySelector(".cl-cancel").onclick = ui.dispose; body.querySelector(".cl-apply").onclick = () => { const mode = body.querySelector('input[name="concept-layout-mode"]:checked').value, spacingValue = body.querySelector('input[name="concept-layout-spacing"]:checked').value, fit = body.querySelector(".concept-layout-fit input").checked; model.nodes = conceptAutoLayout(model.nodes, model.edges, { mode, spacing:spacingValue, rootId:selectedId }); model.layout = "auto"; model.layoutStyle = mode; model.layoutSpacing = spacingValue; ui.dispose(); history.commit(); touch(); render(); if (fit) requestAnimationFrame(fitCanvasToViewport); else viewport.scrollTo({ left:0, top:0, behavior:"smooth" }); };
    setTimeout(() => choices.querySelector("input:checked")?.focus(), 0);
  }

  function openPresentationOrderDialog(){
    if (!model.nodes.length){ if (typeof toast === "function") toast("순서를 정할 카드가 없어요.", 2200); return; }
    const body = document.createElement("div"); body.className = "concept-order-form";
    body.innerHTML = '<div class="concept-order-tools"><button type="button" class="co-auto">관계 따라 자동 순서</button><button type="button" class="co-position">화면 위치순</button><p>끌어서 옮기거나 화살표를 눌러 순서를 바꾸세요. 이 번호대로 전개 발표가 진행됩니다.</p></div><ol class="concept-order-list"></ol><footer><button type="button" class="co-cancel">취소</button><button type="button" class="co-save primary">순서 저장</button></footer>';
    const ui = conceptModal("발표 순서", body), list = body.querySelector(".concept-order-list"); let draft = [...model.presentation.order], draggingId = "";
    const move = (id, delta) => { const index = draft.indexOf(id), next = Math.max(0, Math.min(draft.length - 1, index + delta)); if (index < 0 || next === index) return; draft.splice(index, 1); draft.splice(next, 0, id); renderList(); };
    const renderList = () => {
      const byId = new Map(model.nodes.map(node => [node.id, node])); list.innerHTML = "";
      draft.forEach((id, index) => {
        const node = byId.get(id); if (!node) return;
        const row = document.createElement("li"); row.className = "concept-order-row"; row.draggable = true; row.dataset.nodeId = id;
        const number = document.createElement("span"); number.className = "concept-order-number"; number.textContent = String(index + 1);
        const grip = document.createElement("span"); grip.className = "concept-order-grip"; grip.textContent = "⠿"; grip.title = "끌어서 순서 변경";
        const copy = document.createElement("div"); const title = document.createElement("strong"), category = document.createElement("small"); title.textContent = node.title; category.textContent = node.category || "개념"; copy.append(title, category);
        const up = conceptButton("↑", "한 단계 앞으로", "concept-order-move"), down = conceptButton("↓", "한 단계 뒤로", "concept-order-move"); up.disabled = index === 0; down.disabled = index === draft.length - 1; up.onclick = () => move(id, -1); down.onclick = () => move(id, 1);
        row.append(number, grip, copy, up, down); row.addEventListener("dragstart", event => { draggingId = id; row.classList.add("is-dragging"); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; }); row.addEventListener("dragend", () => { draggingId = ""; row.classList.remove("is-dragging"); });
        row.addEventListener("dragover", event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; }); row.addEventListener("drop", event => { event.preventDefault(); if (!draggingId || draggingId === id) return; const from = draft.indexOf(draggingId); if (from < 0) return; draft.splice(from, 1); const target = draft.indexOf(id); draft.splice(target, 0, draggingId); draggingId = ""; renderList(); }); list.appendChild(row);
      });
    };
    body.querySelector(".co-auto").onclick = () => { draft = conceptAutoPresentationOrder(model.nodes, model.edges); renderList(); };
    body.querySelector(".co-position").onclick = () => { draft = [...model.nodes].sort((a, b) => a.x - b.x || a.y - b.y || a.title.localeCompare(b.title, "ko")).map(node => node.id); renderList(); };
    body.querySelector(".co-cancel").onclick = ui.dispose; body.querySelector(".co-save").onclick = () => { model.presentation.order = [...draft]; ui.dispose(); history.commit(); touch(); render(); };
    renderList(); setTimeout(() => list.querySelector("button:not(:disabled)")?.focus(), 0);
  }

  function openNodeDialog(id){
    const current = model.nodes.find(node => node.id === id) || null, body = document.createElement("div"); body.className = "concept-form";
    body.innerHTML = '<label><span>개념 이름</span><input class="cn-title" maxlength="120"></label><label><span>분류</span><input class="cn-category" maxlength="60" placeholder="예: 원인·인물·공식"></label><label><span>색상</span><select class="cn-color"><option value="blue">파랑</option><option value="green">초록</option><option value="amber">노랑</option><option value="rose">빨강</option><option value="purple">보라</option><option value="slate">검정</option></select></label><label class="wide"><span>설명</span><textarea class="cn-description" rows="6" maxlength="3000"></textarea></label><div class="concept-photo wide"><span>사진</span><div class="cn-photo-preview"></div><button type="button" class="cn-photo-pick">사진 넣기</button><button type="button" class="cn-photo-remove">지우기</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden></div><p class="concept-form-error wide" role="alert"></p><footer class="wide"><button type="button" class="cn-delete danger">삭제</button><span></span><button type="button" class="cn-cancel">취소</button><button type="button" class="cn-save primary">저장</button></footer>';
    const ui = conceptModal(current ? "개념 수정" : "새 개념", body), title = body.querySelector(".cn-title"), category = body.querySelector(".cn-category"), color = body.querySelector(".cn-color"), description = body.querySelector(".cn-description"); let image = current && current.image ? current.image : null;
    title.value = current ? current.title : ""; category.value = current ? current.category : ""; color.value = current ? current.color : "blue"; description.value = current ? current.description : "";
    const preview = body.querySelector(".cn-photo-preview"), photoInput = body.querySelector("input[type=file]"); const showPhoto = () => { preview.innerHTML = ""; if (image){ const img = document.createElement("img"); img.src = image.dataUrl; img.alt = "선택한 사진"; preview.appendChild(img); } else preview.textContent = "사진 없음"; };
    showPhoto(); body.querySelector(".cn-photo-pick").onclick = () => photoInput.click(); body.querySelector(".cn-photo-remove").onclick = () => { image = null; showPhoto(); };
    photoInput.onchange = async () => { const file = photoInput.files && photoInput.files[0]; if (!file) return; try { if (typeof timelinePreparePhoto !== "function") throw new Error("photo-runtime"); image = await timelinePreparePhoto(file); showPhoto(); } catch(_){ body.querySelector(".concept-form-error").textContent = "사진을 넣지 못했어요. PNG·JPG·WebP를 사용하세요."; } };
    body.querySelector(".cn-cancel").onclick = ui.dispose; const del = body.querySelector(".cn-delete"); del.hidden = !current;
    del.onclick = () => { if (!confirm("이 개념과 연결된 관계를 함께 삭제할까요?")) return; model.nodes = model.nodes.filter(node => node.id !== current.id); model.edges = model.edges.filter(edge => edge.from !== current.id && edge.to !== current.id); model.presentation = conceptNormalizePresentation(model.presentation, model.nodes); selectedId = ""; ui.dispose(); history.commit(); touch(); render(); };
    body.querySelector(".cn-save").onclick = () => { if (!title.value.trim()){ body.querySelector(".concept-form-error").textContent = "개념 이름을 입력하세요."; title.focus(); return; }
      if (current) Object.assign(current, { title:title.value.trim(), category:category.value.trim(), color:color.value, description:description.value, image });
      else { if (model.nodes.length >= CONCEPT_MAX_NODES){ body.querySelector(".concept-form-error").textContent = "개념은 최대 300개까지 넣을 수 있어요."; return; } const count = model.nodes.length, node = conceptNormalizeNode({ title:title.value.trim(), category:category.value.trim(), color:color.value, description:description.value, image, x:80 + count % 5 * 290, y:80 + Math.floor(count / 5) * 180 }, count); model.nodes.push(node); model.presentation.order.push(node.id); selectedId = node.id; }
      ui.dispose(); history.commit(); touch(); render(); };
    setTimeout(() => title.focus(), 0);
  }

  function openEdgeDialog(id){
    if (model.nodes.length < 2){ if (typeof toast === "function") toast("관계를 만들려면 개념이 두 개 이상 필요해요.", 2800); return; }
    const current = model.edges.find(edge => edge.id === id) || null, body = document.createElement("div"); body.className = "concept-form";
    body.innerHTML = '<label><span>시작 개념</span><select class="ce-from"></select></label><label><span>관계 종류</span><select class="ce-type"></select></label><label><span>도착 개념</span><select class="ce-to"></select></label><label class="wide"><span>연결선에 표시할 말</span><input class="ce-label" maxlength="80" placeholder="예: 때문에·포함한다·공통점"></label><p class="concept-form-error wide" role="alert"></p><footer class="wide"><button type="button" class="ce-delete danger">삭제</button><span></span><button type="button" class="ce-cancel">취소</button><button type="button" class="ce-save primary">저장</button></footer>';
    const ui = conceptModal(current ? "관계 수정" : "새 관계", body), from = body.querySelector(".ce-from"), to = body.querySelector(".ce-to"), type = body.querySelector(".ce-type"), label = body.querySelector(".ce-label");
    model.nodes.forEach(node => { [from, to].forEach(select => { const option = document.createElement("option"); option.value = node.id; option.textContent = node.title; select.appendChild(option); }); }); CONCEPT_RELATIONS.forEach(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.label; type.appendChild(option); });
    from.value = current ? current.from : (selectedId || model.nodes[0].id); to.value = current ? current.to : model.nodes.find(node => node.id !== from.value).id; type.value = current ? current.type : "cause"; label.value = current ? current.label : "";
    body.querySelector(".ce-cancel").onclick = ui.dispose; const del = body.querySelector(".ce-delete"); del.hidden = !current; del.onclick = () => { model.edges = model.edges.filter(edge => edge.id !== current.id); ui.dispose(); history.commit(); touch(); render(); };
    body.querySelector(".ce-save").onclick = () => { if (from.value === to.value){ body.querySelector(".concept-form-error").textContent = "서로 다른 개념을 고르세요."; return; } if (current) Object.assign(current, { from:from.value, to:to.value, type:type.value, label:label.value.trim() }); else if (model.edges.length < CONCEPT_MAX_EDGES) model.edges.push(conceptNormalizeEdge({ from:from.value, to:to.value, type:type.value, label:label.value.trim() })); ui.dispose(); history.commit(); touch(); render(); };
  }

  function startPresentation(){
    if (!model.nodes.length){ if (typeof toast === "function") toast("발표할 개념이 없어요.", 2200); return; }
    const baseOrder = model.presentation.order.map(id => model.nodes.find(node => node.id === id)).filter(Boolean), ordered = selectedId ? [...baseOrder.filter(node => node.id === selectedId), ...baseOrder.filter(node => node.id !== selectedId)] : baseOrder; let index = 0;
    const overlay = document.createElement("div"); overlay.className = "concept-present"; overlay.innerHTML = '<div class="concept-present-top"><span></span><button type="button">끝내기</button></div><article><small></small><h2></h2><div class="concept-present-main"><div class="concept-present-image"></div><p></p></div><div class="concept-present-links"></div></article><div class="concept-present-controls"><button type="button" class="prev">이전</button><button type="button" class="next">다음</button></div>'; root.appendChild(overlay);
    const close = () => { window.removeEventListener("keydown", keys); overlay.remove(); };
    const show = () => { const node = ordered[index]; showLargeNode(overlay, node, `${index + 1} / ${ordered.length}`); overlay.querySelector(".prev").disabled = index === 0; overlay.querySelector(".next").disabled = index === ordered.length - 1; };
    const keys = event => { if (event.key === "Escape") close(); else if ((event.key === "ArrowRight" || event.key === " ") && index < ordered.length - 1){ event.preventDefault(); index++; show(); } else if (event.key === "ArrowLeft" && index > 0){ event.preventDefault(); index--; show(); } };
    overlay.querySelector(".concept-present-top button").onclick = close; overlay.querySelector(".prev").onclick = () => { if (index > 0){ index--; show(); } }; overlay.querySelector(".next").onclick = () => { if (index < ordered.length - 1){ index++; show(); } }; window.addEventListener("keydown", keys); show();
  }
  function startBuildPresentation(){
    if (!model.nodes.length){ if (typeof toast === "function") toast("발표할 개념이 없어요.", 2200); return; }
    const ordered = model.presentation.order.map(id => model.nodes.find(node => node.id === id)).filter(Boolean), orderIndex = new Map(ordered.map((node, index) => [node.id, index]));
    const stageWidth = Math.max(CONCEPT_CANVAS_WIDTH, ...model.nodes.map(node => node.x + 290)), stageHeight = Math.max(CONCEPT_CANVAS_HEIGHT, ...model.nodes.map(node => node.y + 210));
    const overlay = document.createElement("div"); overlay.className = "concept-build-present"; overlay.dataset.animation = model.presentation.animation; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "관계도 전개 발표");
    overlay.innerHTML = '<div class="concept-build-top"><div><strong class="concept-build-title"></strong><span class="concept-build-count"></span></div><div class="concept-build-progress"><i></i></div><button type="button" class="concept-build-close">끝내기</button></div><div class="concept-build-viewport"><div class="concept-build-fit"><div class="concept-build-stage"><svg class="concept-lines"></svg><div class="concept-cards"></div></div></div><div class="concept-build-hint"><strong>Space</strong><span>키를 눌러 첫 카드를 보여 주세요</span></div></div><div class="concept-build-controls"><button type="button" class="prev">이전</button><span>Space로 다음 · Shift+Space로 이전</span><button type="button" class="next">다음</button></div>';
    root.appendChild(overlay); const buildViewport = overlay.querySelector(".concept-build-viewport"), fit = overlay.querySelector(".concept-build-fit"), buildStage = overlay.querySelector(".concept-build-stage"), buildSvg = overlay.querySelector("svg"), buildCards = overlay.querySelector(".concept-cards"), hint = overlay.querySelector(".concept-build-hint");
    overlay.querySelector(".concept-build-title").textContent = model.title || "개념 관계도"; buildStage.style.width = stageWidth + "px"; buildStage.style.height = stageHeight + "px"; buildSvg.setAttribute("viewBox", `0 0 ${stageWidth} ${stageHeight}`);
    const markerId = "conceptBuildArrow" + Date.now().toString(36); buildSvg.innerHTML = `<defs><marker id="${markerId}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z"></path></marker></defs>`;
    const buildCardById = new Map(), edgeElements = [];
    for (const edge of model.edges){
      const from = model.nodes.find(node => node.id === edge.from), to = model.nodes.find(node => node.id === edge.to), fromIndex = orderIndex.get(edge.from), toIndex = orderIndex.get(edge.to); if (!from || !to || fromIndex == null || toIndex == null) continue;
      const group = document.createElementNS(buildSvg.namespaceURI, "g"); group.classList.add("concept-edge", "concept-build-edge", "is-build-hidden"); group.dataset.revealStep = String(Math.max(fromIndex, toIndex) + 1);
      const path = document.createElementNS(buildSvg.namespaceURI, "path"); path.setAttribute("d", edgePath(from, to)); path.setAttribute("marker-end", `url(#${markerId})`); path.classList.add("concept-edge-path", "is-" + edge.type);
      const label = document.createElementNS(buildSvg.namespaceURI, "text"); label.classList.add("concept-edge-label"); label.setAttribute("x", String((from.x + to.x) / 2 + 115)); label.setAttribute("y", String((from.y + to.y) / 2 + 55)); label.textContent = edge.label || (CONCEPT_RELATIONS.find(item => item.id === edge.type) || {}).label || "관련";
      group.append(path, label); buildSvg.appendChild(group); edgeElements.push(group);
    }
    ordered.forEach((node, index) => {
      const card = document.createElement("article"); card.className = "concept-card concept-build-card is-build-hidden"; card.dataset.nodeId = node.id; card.dataset.step = String(index + 1); card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.setProperty("--concept-color", CONCEPT_COLORS[node.color]); card.tabIndex = -1; card.setAttribute("aria-hidden", "true");
      const head = document.createElement("div"); head.className = "concept-card-head"; const label = document.createElement("div"), number = document.createElement("span"), category = document.createElement("small"); label.className = "concept-card-label"; number.className = "concept-order-badge"; number.textContent = String(index + 1); category.textContent = node.category || "개념"; label.append(number, category); head.appendChild(label);
      const title = document.createElement("h3"); title.textContent = node.title; const body = document.createElement("div"); body.className = "concept-card-body"; if (node.image){ const img = document.createElement("img"); img.src = node.image.dataUrl; img.alt = ""; body.appendChild(img); } const description = document.createElement("p"); description.textContent = node.description || "설명이 없습니다."; body.appendChild(description); card.append(head, title, body); buildCards.appendChild(card); buildCardById.set(node.id, card);
      card.addEventListener("click", () => openNodePreview(node.id, card)); card.addEventListener("keydown", event => { if (event.key === "Enter"){ event.preventDefault(); openNodePreview(node.id, card); } });
    });
    let step = 0, fitScale = 1; const animationTimers = new Set(), reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const later = (fn, delay) => { const timer = setTimeout(() => { animationTimers.delete(timer); fn(); }, delay); animationTimers.add(timer); };
    const fitStage = () => { const width = Math.max(320, buildViewport.clientWidth - 34), height = Math.max(260, buildViewport.clientHeight - 34); fitScale = Math.max(.42, Math.min(1, width / stageWidth, height / stageHeight)); const scaledWidth = stageWidth * fitScale, scaledHeight = stageHeight * fitScale, marginX = Math.max(16, (buildViewport.clientWidth - scaledWidth) / 2), marginY = Math.max(16, (buildViewport.clientHeight - scaledHeight) / 2); fit.style.width = scaledWidth + "px"; fit.style.height = scaledHeight + "px"; fit.style.margin = `${marginY}px ${marginX}px`; buildStage.style.transform = `scale(${fitScale})`; };
    const focusNode = node => { if (!node || !model.presentation.autoFocus) return; const left = fit.offsetLeft + (node.x + 115) * fitScale - buildViewport.clientWidth / 2, top = fit.offsetTop + (node.y + 65) * fitScale - buildViewport.clientHeight / 2; buildViewport.scrollTo({ left:Math.max(0, left), top:Math.max(0, top), behavior:reducedMotion ? "auto" : "smooth" }); };
    const revealCard = card => { card.classList.remove("is-build-hidden"); card.setAttribute("aria-hidden", "false"); card.tabIndex = 0; if (overlay.dataset.animation !== "none" && !reducedMotion){ card.classList.remove("is-revealing"); void card.offsetWidth; card.classList.add("is-revealing"); later(() => card.classList.remove("is-revealing"), overlay.dataset.animation === "draw" ? 900 : 620); } };
    const revealEdge = group => {
      group.classList.remove("is-build-hidden"); if (overlay.dataset.animation === "none" || reducedMotion) return; group.classList.add("is-revealing"); const path = group.querySelector("path"), length = Math.max(1, path.getTotalLength()), duration = overlay.dataset.animation === "draw" ? 900 : 480; path.style.transition = "none"; path.style.strokeDasharray = `${length} ${length}`; path.style.strokeDashoffset = String(length); void path.getBoundingClientRect(); path.style.transition = `stroke-dashoffset ${duration}ms ease`; path.style.strokeDashoffset = "0";
      later(() => { group.classList.remove("is-revealing"); path.style.transition = ""; path.style.strokeDasharray = ""; path.style.strokeDashoffset = ""; }, duration + 40);
    };
    const updateStep = next => {
      const previous = step; step = Math.max(0, Math.min(ordered.length, next));
      if (step < previous){
        ordered.forEach((node, index) => { if (index < step) return; const card = buildCardById.get(node.id); card.classList.add("is-build-hidden"); card.classList.remove("is-revealing"); card.setAttribute("aria-hidden", "true"); card.tabIndex = -1; }); edgeElements.forEach(group => { if (Number(group.dataset.revealStep) > step){ group.classList.add("is-build-hidden"); group.classList.remove("is-revealing"); } });
      } else if (step > previous){
        for (let index = previous; index < step; index++) revealCard(buildCardById.get(ordered[index].id)); edgeElements.filter(group => Number(group.dataset.revealStep) > previous && Number(group.dataset.revealStep) <= step).forEach(revealEdge);
      }
      overlay.querySelector(".concept-build-count").textContent = `${step} / ${ordered.length}`; overlay.querySelector(".concept-build-progress i").style.width = (ordered.length ? step / ordered.length * 100 : 0) + "%"; overlay.querySelector(".prev").disabled = step === 0; overlay.querySelector(".next").disabled = step === ordered.length; hint.hidden = step !== 0; if (step > 0 && step >= previous) focusNode(ordered[step - 1]);
    };
    const keys = event => { if (closeNodePreview) return; if (event.key === "Escape"){ event.preventDefault(); close(); } else if ((event.key === " " && !event.shiftKey) || event.key === "ArrowRight"){ event.preventDefault(); updateStep(step + 1); } else if ((event.key === " " && event.shiftKey) || event.key === "ArrowLeft"){ event.preventDefault(); updateStep(step - 1); } else if (event.key === "Home"){ event.preventDefault(); updateStep(0); } else if (event.key === "End"){ event.preventDefault(); updateStep(ordered.length); } };
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fitStage()) : null;
    const close = () => { window.removeEventListener("keydown", keys); if (resizeObserver) resizeObserver.disconnect(); animationTimers.forEach(clearTimeout); animationTimers.clear(); overlay.remove(); if (closeBuildPresentation === close) closeBuildPresentation = null; if (buildPresentBtn.isConnected) buildPresentBtn.focus(); };
    closeBuildPresentation = close; overlay.querySelector(".concept-build-close").onclick = close; overlay.querySelector(".prev").onclick = () => updateStep(step - 1); overlay.querySelector(".next").onclick = () => updateStep(step + 1); window.addEventListener("keydown", keys); if (resizeObserver) resizeObserver.observe(buildViewport); fitStage(); updateStep(0); overlay.querySelector(".next").focus();
  }
  function printConcept(){ document.body.classList.add("concept-printing"); root.classList.add("concept-print-target"); const done = () => { document.body.classList.remove("concept-printing"); root.classList.remove("concept-print-target"); window.removeEventListener("afterprint", done); }; window.addEventListener("afterprint", done); window.print(); setTimeout(done, 1500); }
  addNodeBtn.onclick = () => openNodeDialog(); addEdgeBtn.onclick = () => openEdgeDialog(); autoBtn.onclick = openAutoLayoutDialog;
  undoBtn.onclick = () => history.undo(); redoBtn.onclick = () => history.redo(); search.addEventListener("input", render); titleInput.addEventListener("input", () => { model.title = titleInput.value; history.commitSoon(500); touch(); }); orderBtn.onclick = openPresentationOrderDialog; animationSelect.addEventListener("change", () => { model.presentation.animation = animationSelect.value; history.commit(); touch(); }); presentBtn.onclick = startPresentation; buildPresentBtn.onclick = startBuildPresentation; printBtn.onclick = printConcept; saveBtn.onclick = () => saveConceptDoc(doc);
  const keydown = event => { if (doc.el.hidden || closeBuildPresentation || closeNodePreview || (event.target.closest && event.target.closest("input,textarea,select,[contenteditable=true]"))) return; const key = String(event.key || "").toLowerCase(); if ((event.ctrlKey || event.metaKey) && key === "z"){ event.preventDefault(); event.shiftKey ? history.redo() : history.undo(); } else if ((event.ctrlKey || event.metaKey) && key === "y"){ event.preventDefault(); history.redo(); } else if (event.key === "Delete" && selectedId) openNodeDialog(selectedId); };
  window.addEventListener("keydown", keydown); if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = []; doc.cleanupFns.push(() => { clearTimeout(recoveryTimer); clearTimeout(previewTimer); if (closeNodePreview) closeNodePreview(); if (closeBuildPresentation) closeBuildPresentation(); if (viewportResizeObserver) viewportResizeObserver.disconnect(); viewport.removeEventListener("wheel", onViewportWheel); if (history) history.cancel(); window.removeEventListener("keydown", keydown); if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery; if (doc.conceptSelectNode) delete doc.conceptSelectNode; });
  render(); touch();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = { CONCEPT_DOC_TYPE, CONCEPT_DOC_VERSION, CONCEPT_RELATIONS, CONCEPT_PRESENT_ANIMATIONS, CONCEPT_LAYOUTS, CONCEPT_LAYOUT_SPACING, conceptNormalizeNode, conceptNormalizeEdge, conceptNormalizePresentation,
    conceptDocEmpty, conceptDocParse, conceptDocSerialize, conceptSearchText, conceptNodeConnections, conceptAutoLayout, conceptAutoPresentationOrder, conceptClampZoom, conceptFitZoom, conceptZoomScroll, conceptDragCoordinate, conceptCanvasSize, conceptScratchFileName, conceptDefaultTitle };
}
