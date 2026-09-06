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
const CONCEPT_PAN_KEEP = 120;   // 손바닥 이동 뒤에도 화면에 남겨 둘 관계도 가장자리(px)
const CONCEPT_PAN_STEP = 60;    // 방향키 한 번에 옮기는 거리(px)
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
  { id:"cluster", label:"군집형", description:"강한 연결이 촘촘한 카드들을 묶고 묶음 사이에 여백을 둡니다." },
  { id:"weighted", label:"관계 강도형", description:"강하게 연결된 개념끼리 가까이 모으고 카드 간격을 확보합니다." },
  { id:"focus", label:"중심 집중형", description:"중심 카드와 강한 관계로 이어질수록 가까이 배치합니다." },
  { id:"tree", label:"위→아래 가계도", description:"상위 개념에서 자녀·하위 개념이 아래로 펼쳐집니다." },
  { id:"radial", label:"방사형", description:"선택한 카드를 중심으로 가까운 관계부터 사방으로 펼칩니다." },
  { id:"circle", label:"원형", description:"모든 카드를 큰 원 둘레에 고르게 놓습니다." },
  { id:"flow", label:"왼쪽→오른쪽", description:"원인·상위 개념에서 결과·하위 개념 방향으로 흐릅니다." },
  { id:"grid", label:"격자형", description:"관계 방향과 무관하게 카드를 반듯하게 정돈합니다." }
]);
const CONCEPT_LAYOUT_SPACING = Object.freeze({ tight:.78, normal:1, wide:1.35 });
const CONCEPT_WEIGHT_INFLUENCE = Object.freeze({ weak:.3, normal:.65, strong:1 });
function conceptNormalizeWeight(value){ return value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? 3 : Math.round(conceptClamp(value, 1, 5)); }
function conceptLayoutSettings(raw = {}){
  return { layoutWeighted:raw.layoutWeighted !== false, layoutInfluence:Object.hasOwn(CONCEPT_WEIGHT_INFLUENCE, raw.layoutInfluence) ? raw.layoutInfluence : "normal", showWeights:raw.showWeights === true, layoutRootId:conceptSafeText(raw.layoutRootId, 80) };
}
let _conceptScratchCount = 0;

function conceptId(prefix){ return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function conceptClamp(value, min, max){ return Math.max(min, Math.min(max, Number(value) || 0)); }
function conceptClampZoom(value){ return conceptClamp(value, CONCEPT_MIN_ZOOM, CONCEPT_MAX_ZOOM); }
function conceptFitZoom(canvasWidth, canvasHeight, viewportWidth, viewportHeight){ const width = Math.max(1, Number(canvasWidth) || 1), height = Math.max(1, Number(canvasHeight) || 1), availableWidth = Math.max(1, (Number(viewportWidth) || 1) - 36), availableHeight = Math.max(1, (Number(viewportHeight) || 1) - 36); return conceptClampZoom(Math.min(availableWidth / width, availableHeight / height, 1)); }
// 무대는 스크롤이 아니라 translate로 움직인다. 화면 위 점 (x,y)가 가리키는 캔버스 지점은 (x - pan) / zoom 이므로,
// 배율이 바뀌어도 기준점 아래 지점이 그대로 있으려면 pan을 아래처럼 다시 잡아야 한다.
function conceptZoomPan(panX, panY, anchorX, anchorY, oldZoom, nextZoom){
  const before = conceptClampZoom(oldZoom), after = conceptClampZoom(nextZoom), ratio = after / before;
  const x = Number(anchorX) || 0, y = Number(anchorY) || 0;
  return { x:x - (x - (Number(panX) || 0)) * ratio, y:y - (y - (Number(panY) || 0)) * ratio };
}
// 사방으로 자유롭게 옮기되, 관계도를 화면 밖으로 완전히 놓치지는 않게 가장자리를 조금 남긴다.
function conceptClampPan(panX, panY, canvasWidth, canvasHeight, viewportWidth, viewportHeight, zoom){
  const scale = conceptClampZoom(zoom), width = Math.max(1, Number(canvasWidth) || 1) * scale, height = Math.max(1, Number(canvasHeight) || 1) * scale;
  const viewWidth = Math.max(1, Number(viewportWidth) || 1), viewHeight = Math.max(1, Number(viewportHeight) || 1);
  const keepX = Math.min(CONCEPT_PAN_KEEP, viewWidth / 2, width), keepY = Math.min(CONCEPT_PAN_KEEP, viewHeight / 2, height);
  return { x:conceptClamp(panX, keepX - width, viewWidth - keepX), y:conceptClamp(panY, keepY - height, viewHeight - keepY) };
}
function conceptZoomScrollWithOffset(scrollLeft, scrollTop, anchorX, anchorY, oldZoom, nextZoom, oldOffsetLeft, oldOffsetTop, nextOffsetLeft, nextOffsetTop){
  const before = conceptClampZoom(oldZoom), after = conceptClampZoom(nextZoom), x = Math.max(0, Number(anchorX) || 0), y = Math.max(0, Number(anchorY) || 0);
  const contentX = ((Number(scrollLeft) || 0) + x - (Number(oldOffsetLeft) || 0)) / before, contentY = ((Number(scrollTop) || 0) + y - (Number(oldOffsetTop) || 0)) / before;
  return { left:Math.max(0, (Number(nextOffsetLeft) || 0) + contentX * after - x), top:Math.max(0, (Number(nextOffsetTop) || 0) + contentY * after - y) };
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
    image:conceptNormalizeImage(value.image), pinned:value.pinned === true };
}
function conceptNormalizeEdge(raw){
  const value = raw && typeof raw === "object" ? raw : {};
  const type = CONCEPT_RELATIONS.some(item => item.id === value.type) ? value.type : "related";
  return { id:conceptSafeText(value.id, 80) || conceptId("ce"), from:conceptSafeText(value.from, 80), to:conceptSafeText(value.to, 80),
    label:conceptSafeText(value.label, 80).trim(), type, weight:conceptNormalizeWeight(value.weight) };
}
function conceptNormalizePresentation(raw, nodes){
  const value = raw && typeof raw === "object" ? raw : {}, ids = new Set((nodes || []).map(node => node.id)), seen = new Set(), order = [];
  for (const id of Array.isArray(value.order) ? value.order : []){ const safe = conceptSafeText(id, 80); if (ids.has(safe) && !seen.has(safe)){ seen.add(safe); order.push(safe); } }
  for (const node of nodes || []) if (!seen.has(node.id)){ seen.add(node.id); order.push(node.id); }
  const animation = CONCEPT_PRESENT_ANIMATIONS.some(item => item.id === value.animation) ? value.animation : "fade";
  return { order, animation, autoFocus:value.autoFocus !== false };
}
function conceptDocEmpty(title){ return { type:CONCEPT_DOC_TYPE, version:CONCEPT_DOC_VERSION, title:conceptSafeText(title || "개념 관계도", 160), layout:"free", layoutStyle:"tree", layoutSpacing:"normal", ...conceptLayoutSettings(), nodes:[], edges:[], presentation:conceptNormalizePresentation(null, []) }; }
function conceptDocParse(text){
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  if (!raw || raw.type !== CONCEPT_DOC_TYPE || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error("concept-format");
  if (raw.nodes.length > CONCEPT_MAX_NODES || raw.edges.length > CONCEPT_MAX_EDGES) throw new Error("concept-limit");
  const model = conceptDocEmpty(raw.title); model.layout = raw.layout === "auto" ? "auto" : "free"; model.layoutStyle = CONCEPT_LAYOUTS.some(item => item.id === raw.layoutStyle) ? raw.layoutStyle : (model.layout === "auto" ? "flow" : "tree"); model.layoutSpacing = Object.prototype.hasOwnProperty.call(CONCEPT_LAYOUT_SPACING, raw.layoutSpacing) ? raw.layoutSpacing : "normal";
  const seen = new Set(); model.nodes = raw.nodes.map(conceptNormalizeNode).filter(node => node.title && !seen.has(node.id) && seen.add(node.id));
  const ids = new Set(model.nodes.map(node => node.id)), edgeSeen = new Set();
  model.edges = raw.edges.map(conceptNormalizeEdge).filter(edge => edge.from !== edge.to && ids.has(edge.from) && ids.has(edge.to) && !edgeSeen.has(edge.id) && edgeSeen.add(edge.id));
  model.presentation = conceptNormalizePresentation(raw.presentation, model.nodes);
  Object.assign(model, conceptLayoutSettings(raw));
  if (!ids.has(model.layoutRootId)) model.layoutRootId = "";
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
// 가중 모듈성 증가량이 양수인 묶음만 합친다. 약한 다리 하나로 전체가 한 묶음이 되는 것을 줄인다.
function conceptClusterGroups(nodes, edges, options = {}){
  const list = [...nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), byId = new Map(list.map((node, i) => [node.id, i]));
  const influence = options.weighted === false ? 0 : (CONCEPT_WEIGHT_INFLUENCE[options.influence] || CONCEPT_WEIGHT_INFLUENCE.normal);
  const links = list.map(() => new Map()), degree = list.map(() => 0), groups = new Map(list.map((node, i) => [i, [node]]));
  for (const edge of edges || []){
    const a = byId.get(edge.from), b = byId.get(edge.to); if (a == null || b == null || a === b) continue;
    const weight = Math.pow(conceptNormalizeWeight(edge.weight), influence);
    if (!links[a].has(b) || links[a].get(b) < weight){ links[a].set(b, weight); links[b].set(a, weight); }
  }
  let total = 0;
  for (let a = 0; a < list.length; a++) for (const b of [...links[a].keys()].sort((x, y) => x - y)){ degree[a] += links[a].get(b); if (a < b) total += links[a].get(b); }
  if (!total) return [...groups.values()];
  while (groups.size > 1){
    let bestA = -1, bestB = -1, bestGain = 1e-10;
    for (const a of groups.keys()) for (const [b, weight] of links[a]){
      if (a >= b || !groups.has(b)) continue;
      const gain = weight / total - degree[a] * degree[b] / (2 * total * total);
      if (gain > bestGain + 1e-12 || (bestA >= 0 && Math.abs(gain - bestGain) <= 1e-12 && (a < bestA || (a === bestA && b < bestB)))){ bestGain = gain; bestA = a; bestB = b; }
    }
    if (bestA < 0) break;
    groups.get(bestA).push(...groups.get(bestB)); groups.delete(bestB); degree[bestA] += degree[bestB];
    for (const [other, weight] of links[bestB]){
      if (other === bestA || !groups.has(other)) continue;
      const merged = (links[bestA].get(other) || 0) + weight; links[bestA].set(other, merged); links[other].set(bestA, merged); links[other].delete(bestB);
    }
    links[bestA].delete(bestB); links[bestB].clear();
  }
  return [...groups.values()].map(group => group.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function conceptClusterLayout(nodes, edges, options){
  const spacing = CONCEPT_LAYOUT_SPACING[options.spacing], gap = 180 * spacing;
  const boxes = conceptClusterGroups(nodes, edges, options).map(group => {
    const ids = new Set(group.map(node => node.id));
    const laid = conceptWeightedLayout(group, (edges || []).filter(edge => ids.has(edge.from) && ids.has(edge.to)), { ...options, mode:"weighted", rootId:"" });
    const left = Math.min(...laid.map(node => node.x)), top = Math.min(...laid.map(node => node.y));
    return { nodes:laid.map(node => ({ ...node, x:node.x - left, y:node.y - top })), width:Math.max(...laid.map(node => node.x)) - left + 250, height:Math.max(...laid.map(node => node.y)) - top + 188 };
  });
  // 큰 묶음부터 놓고 같은 크기는 안정적인 카드 ID 순서를 유지한다.
  boxes.sort((a, b) => b.nodes.length - a.nodes.length || (a.nodes[0].id < b.nodes[0].id ? -1 : 1));
  const targetWidth = Math.max(...boxes.map(box => box.width), Math.sqrt(boxes.reduce((sum, box) => sum + (box.width + gap) * (box.height + gap), 0)) * 1.4);
  const positions = new Map(); let x = 70, y = 70, rowHeight = 0;
  for (const box of boxes){
    if (x > 70 && x + box.width > targetWidth + 70){ x = 70; y += rowHeight + gap; rowHeight = 0; }
    for (const node of box.nodes) positions.set(node.id, { x:x + node.x, y:y + node.y });
    x += box.width + gap; rowHeight = Math.max(rowHeight, box.height);
  }
  return nodes.map(node => ({ ...node, ...positions.get(node.id) }));
}
function conceptAutoLayout(nodes, edges, options = {}){
  const list = (nodes || []).map(conceptNormalizeNode), pinned = list.filter(node => node.pinned).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (!list.length || pinned.length === list.length) return list;
  const laid = conceptComputeLayout(list, edges, options); if (!pinned.length) return laid;
  const planned = new Map(laid.map(node => [node.id, node])), actual = new Map(list.map(node => [node.id, node]));
  const spacing = CONCEPT_LAYOUT_SPACING[options.spacing] || 1, gapX = 250 * Math.max(1, spacing), gapY = 188 * Math.max(1, spacing);
  const offsets = pins => ({ x:pins.reduce((sum, node) => sum + node.x - planned.get(node.id).x, 0) / pins.length, y:pins.reduce((sum, node) => sum + node.y - planned.get(node.id).y, 0) / pins.length });
  const globalOffset = offsets(pinned), shifts = new Map();
  // 군집 안에 고정 카드가 있으면 그 카드 주변으로 묶음을 옮긴다.
  if (options.mode === "cluster") for (const group of conceptClusterGroups(list, edges, options)){
    const pins = group.filter(node => node.pinned), offset = pins.length ? offsets(pins) : globalOffset;
    group.forEach(node => shifts.set(node.id, offset));
  }
  const placed = pinned.map(node => ({ ...node })), result = new Map(placed.map(node => [node.id, node]));
  const free = (x, y) => x >= 20 && y >= 20 && x <= CONCEPT_MAX_COORD && y <= CONCEPT_MAX_COORD && placed.every(other => Math.abs(x - other.x) >= gapX - 1e-7 || Math.abs(y - other.y) >= gapY - 1e-7);
  for (const node of [...laid].filter(node => !node.pinned).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)){
    const offset = shifts.get(node.id) || globalOffset;
    let x = conceptClamp(node.x + offset.x, 20, CONCEPT_MAX_COORD), y = conceptClamp(node.y + offset.y, 20, CONCEPT_MAX_COORD);
    if (!free(x, y)){
      const originX = x, originY = y;
      search: for (let ring = 1; ring <= list.length; ring++){
        const candidates = [];
        for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) candidates.push({ x:originX + dx * gapX, y:originY + dy * gapY, cost:dx * dx * gapX * gapX + dy * dy * gapY * gapY });
        candidates.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
        for (const point of candidates) if (free(point.x, point.y)){ x = point.x; y = point.y; break search; }
      }
    }
    const placedNode = { ...actual.get(node.id), x, y }; placed.push(placedNode); result.set(node.id, placedNode);
  }
  return list.map(node => result.get(node.id));
}
function conceptComputeLayout(nodes, edges, options = {}){
  const list = (nodes || []).map(conceptNormalizeNode); if (!list.length) return list;
  const mode = CONCEPT_LAYOUTS.some(item => item.id === options.mode) ? options.mode : "flow", spacingKey = Object.prototype.hasOwnProperty.call(CONCEPT_LAYOUT_SPACING, options.spacing) ? options.spacing : "normal", spacing = CONCEPT_LAYOUT_SPACING[spacingKey], positions = new Map();
  if (mode === "cluster"){
    return conceptClusterLayout(list, edges, { ...options, spacing:spacingKey });
  } else if (mode === "weighted" || mode === "focus"){
    return conceptWeightedLayout(list, edges, { ...options, mode, spacing:spacingKey });
  } else if (mode === "grid"){
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
// 새 배치는 이전 좌표나 난수를 초기값으로 쓰지 않는다. 관계 방향은 보존하고 거리 계산은 양방향이다.
function conceptWeightedLayout(nodes, edges, options){
  const list = [...nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), byId = new Map(list.map((node, i) => [node.id, i]));
  const spacing = CONCEPT_LAYOUT_SPACING[options.spacing], influence = options.weighted === false ? 0 : (CONCEPT_WEIGHT_INFLUENCE[options.influence] || CONCEPT_WEIGHT_INFLUENCE.normal);
  const gapX = 250 * Math.max(1, spacing), gapY = 188 * Math.max(1, spacing), adjacency = list.map(() => new Map());
  for (const edge of edges || []){
    const a = byId.get(edge.from), b = byId.get(edge.to); if (a == null || b == null || a === b) continue;
    const distance = Math.max(270, 360 * spacing * Math.pow(3 / conceptNormalizeWeight(edge.weight), influence));
    // 같은 두 카드의 복수 관계는 가장 강한 연결을 사용한다.
    if (!adjacency[a].has(b) || distance < adjacency[a].get(b)){ adjacency[a].set(b, distance); adjacency[b].set(a, distance); }
  }
  const defaultRoot = conceptDirectionalLevels(list, edges).roots.sort()[0], rootIndex = byId.has(options.rootId) ? byId.get(options.rootId) : (byId.get(defaultRoot) ?? 0), seen = new Set(), components = [];
  for (const start of [rootIndex, ...list.map((_, i) => i)]){
    if (seen.has(start)) continue;
    const component = [start]; seen.add(start);
    for (let i = 0; i < component.length; i++) for (const next of [...adjacency[component[i]].keys()].sort((a, b) => a - b)) if (!seen.has(next)){ seen.add(next); component.push(next); }
    components.push(component);
  }
  const boxes = components.map(component => {
    const n = component.length, local = new Map(component.map((id, i) => [id, i])), links = [];
    for (const a of component) for (const [b, distance] of adjacency[a]) if (a < b) links.push({ a:local.get(a), b:local.get(b), distance });
    links.sort((a, b) => a.a - b.a || a.b - b.b);
    const points = component.map((id, i) => { const angle = i * Math.PI * 2 / n - Math.PI / 2, radius = Math.max(320, Math.sqrt(n) * 170) * spacing; return { id, x:Math.cos(angle) * radius, y:Math.sin(angle) * radius }; });
    if (options.mode === "focus"){
      // Dijkstra: 강한 관계일수록 짧은 경로. 간접 연결에도 강도가 반영된다.
      const distances = Array(n).fill(Infinity), visited = new Set(); distances[0] = 0;
      for (let step = 0; step < n; step++){
        let current = -1;
        for (let i = 0; i < n; i++) if (!visited.has(i) && (current < 0 || distances[i] < distances[current])) current = i;
        visited.add(current);
        for (const [id, cost] of adjacency[component[current]]){ const next = local.get(id); distances[next] = Math.min(distances[next], distances[current] + cost); }
      }
      points[0].x = 0; points[0].y = 0;
      const order = points.slice(1).sort((a, b) => distances[local.get(a.id)] - distances[local.get(b.id)] || a.id - b.id);
      order.forEach((point, i) => { const angle = -Math.PI / 2 + i * Math.PI * 2 / Math.max(1, n - 1), radius = distances[local.get(point.id)]; point.x = Math.cos(angle) * radius; point.y = Math.sin(angle) * radius; });
    } else {
      for (let step = 0; step < 240; step++){
        const forces = points.map(() => ({ x:0, y:0 }));
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++){
          const dx = points[b].x - points[a].x, dy = points[b].y - points[a].y, distance = Math.max(1, Math.hypot(dx, dy)), push = 180000 * spacing * spacing / (distance * distance);
          forces[a].x -= dx / distance * push; forces[a].y -= dy / distance * push; forces[b].x += dx / distance * push; forces[b].y += dy / distance * push;
        }
        for (const { a, b, distance:target } of links){
          const dx = points[b].x - points[a].x, dy = points[b].y - points[a].y, distance = Math.max(1, Math.hypot(dx, dy)), pull = (distance - target) * .16;
          forces[a].x += dx / distance * pull; forces[a].y += dy / distance * pull; forces[b].x -= dx / distance * pull; forces[b].y -= dy / distance * pull;
        }
        const limit = 28 * (1 - step / 240) + .3;
        points.forEach((point, i) => { const force = forces[i], length = Math.max(1, Math.hypot(force.x, force.y)), scale = Math.min(.75, limit / length); point.x += force.x * scale; point.y += force.y * scale; });
      }
    }
    // 실제 카드 최대 크기(230×168)에 여백을 더한다. 충돌한 카드만 가까운 빈 자리로 옮긴다.
    const placed = [], order = options.mode === "focus" ? [...points].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.id - b.id) : points;
    const free = (x, y) => placed.every(other => Math.abs(x - other.x) >= gapX || Math.abs(y - other.y) >= gapY);
    let priorRadius = 0;
    for (const point of order){
      if (options.mode === "focus" && placed.length){
        // 가까운 순서를 지키면서 같은 반지름의 빈 각도를 먼저 찾는다.
        let radius = Math.max(priorRadius, Math.hypot(point.x, point.y));
        const angle = Math.atan2(point.y, point.x);
        polar: for (let ring = 0; ring <= n; ring++, radius += gapY / 2){
          const samples = Math.max(24, Math.ceil(Math.PI * 4 * radius / gapY));
          for (let step = 0; step < samples; step++){
            const offset = Math.ceil(step / 2) * (step % 2 ? 1 : -1) * Math.PI * 2 / samples, x = Math.cos(angle + offset) * radius, y = Math.sin(angle + offset) * radius;
            if (free(x, y)){ point.x = x; point.y = y; priorRadius = radius; break polar; }
          }
        }
      }
      if (!free(point.x, point.y)){
        const originX = point.x, originY = point.y;
        search: for (let ring = 1; ring <= n; ring++){
          const candidates = [];
          for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) candidates.push({ x:originX + dx * gapX, y:originY + dy * gapY, cost:dx * dx * gapX * gapX + dy * dy * gapY * gapY });
          candidates.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
          for (const candidate of candidates) if (free(candidate.x, candidate.y)){ point.x = candidate.x; point.y = candidate.y; break search; }
        }
      }
      placed.push(point);
    }
    const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
    points.forEach(point => { point.x -= minX; point.y -= minY; });
    return { points, width:Math.max(...points.map(p => p.x)) + gapX, height:Math.max(...points.map(p => p.y)) + gapY };
  });
  // 서로 연결되지 않은 묶음을 여백을 두고 정돈한다. 고립된 카드도 포함한다.
  const rowWidth = Math.max(...boxes.map(box => box.width), Math.sqrt(boxes.reduce((sum, box) => sum + box.width * box.height, 0)) * 1.4), positions = new Map();
  let x = 70, y = 70, rowHeight = 0;
  for (const box of boxes){
    if (x > 70 && x + box.width > rowWidth + 70){ x = 70; y += rowHeight + 80; rowHeight = 0; }
    for (const point of box.points) positions.set(list[point.id].id, { x:x + point.x, y:y + point.y });
    x += box.width + 80; rowHeight = Math.max(rowHeight, box.height);
  }
  // 극단적으로 긴 사슬이 좌표 상한을 넘으면 겹치도록 잘라내지 않고 안전한 격자로 배치한다.
  if ([...positions.values()].some(point => point.x > CONCEPT_MAX_COORD || point.y > CONCEPT_MAX_COORD)){
    const columns = Math.ceil(Math.sqrt(list.length)); list.forEach((node, i) => positions.set(node.id, { x:70 + i % columns * gapX, y:70 + Math.floor(i / columns) * gapY }));
  }
  return nodes.map(node => ({ ...node, ...positions.get(node.id) }));
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

/* ===== 표·개요 들이기와 내보내기 =====
   조직도·업무 분장·절차서는 이미 엑셀 표나 개요 글로 적혀 있는 경우가 대부분이라, 카드를 하나씩
   손으로 만들지 않고 그 표와 글을 그대로 관계도로 바꾼다. 표는 두 모양을 다 받는다 — 한 줄이 관계
   하나인 '관계 표'(출발·관계·도착)와 한 줄이 개념 하나인 '개념 표'(개념·상위). 어느 쪽인지는 도착
   열이 있느냐로 가른다. 내보낸 CSV·개요는 같은 규칙으로 다시 읽히므로 엑셀에서 고쳐 와도 된다. */
const CONCEPT_TABLE_COLUMNS = Object.freeze({
  from:["출발", "출발개념", "상위", "상위개념", "원인", "부모", "from", "source", "parent"],
  title:["개념", "이름", "제목", "항목", "카드", "title", "name", "concept", "node"],
  to:["도착", "도착개념", "하위", "하위개념", "결과", "대상", "자녀", "자식", "to", "target", "child"],
  type:["관계", "관계종류", "관계유형", "종류", "relation", "type"],
  label:["연결선", "연결선말", "라벨", "관계설명", "label"],
  category:["분류", "갈래", "유형", "부서", "팀", "category", "group"],
  description:["설명", "내용", "메모", "비고", "description", "note"],
  color:["색", "색상", "color"],
  weight:["강도", "관계강도", "가중치", "weight", "strength"]
});
const CONCEPT_RELATION_WORDS = Object.freeze({
  cause:["원인", "원인→결과", "결과", "때문에", "cause", "effect"],
  include:["상위", "상위→하위", "하위", "포함", "소속", "include", "contains", "parent", "child"],
  compare:["비교", "차이", "compare", "versus"],
  support:["근거", "뒷받침", "근거·뒷받침", "증거", "support", "evidence"],
  related:["관련", "연관", "related", "relation"]
});
const CONCEPT_COLOR_WORDS = Object.freeze({ 파랑:"blue", 파란색:"blue", 초록:"green", 녹색:"green", 노랑:"amber", 주황:"amber", 빨강:"rose", 분홍:"rose", 보라:"purple", 검정:"slate", 회색:"slate" });
const CONCEPT_TREE_RELATIONS = Object.freeze(["cause", "include", "support"]);
const CONCEPT_OUTLINE_SEPARATOR = " | ";
const CONCEPT_OUTLINE_TAB = 4;   // 개요에서 탭 한 칸을 공백 몇 칸으로 셀지

function conceptHeaderKey(value){ return String(value == null ? "" : value).replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, ""); }
function conceptMatchKey(value){ return String(value == null ? "" : value).trim().normalize("NFC").toLocaleLowerCase("ko"); }
function conceptRelationId(value, fallback){
  const key = conceptHeaderKey(value), base = CONCEPT_RELATIONS.some(item => item.id === fallback) ? fallback : "related";
  if (!key) return base;
  if (CONCEPT_RELATIONS.some(item => item.id === key)) return key;
  for (const id of Object.keys(CONCEPT_RELATION_WORDS)) if (CONCEPT_RELATION_WORDS[id].includes(key)) return id;
  return base;
}
function conceptColorId(value){
  const key = conceptHeaderKey(value);
  return Object.prototype.hasOwnProperty.call(CONCEPT_COLORS, key) ? key : (CONCEPT_COLOR_WORDS[key] || "blue");
}
/* 관계 종류 열이 없는 표는 열 이름만으로 짐작한다 — '상위/하위' 표는 포함, '원인/결과' 표는 인과다. */
function conceptDefaultRelation(fromHeader, toHeader){
  const text = conceptHeaderKey(fromHeader) + "/" + conceptHeaderKey(toHeader);
  if (/원인|결과|cause|effect/.test(text)) return "cause";
  if (/상위|하위|부모|자녀|자식|소속|parent|child/.test(text)) return "include";
  return "related";
}
/* 엑셀은 지역 설정에 따라 쌍반점(;)으로, 시트에서 복사한 글은 탭으로 나뉜 표를 만든다.
   머리글 줄에서 가장 많이 쓰인 구분자를 고르되 쉼표를 기본으로 둔다. */
function conceptCsvDelimiter(text){
  const line = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "", count = ch => line.split(ch).length - 1;
  const comma = count(","), tab = count("\t"), semicolon = count(";");
  return tab > comma && tab >= semicolon ? "\t" : semicolon > comma ? ";" : ",";
}
function conceptCsvRows(text, delimiter){
  const source = String(text || "").replace(/^\uFEFF/, ""), separator = delimiter || conceptCsvDelimiter(source), rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i++){
    const ch = source[i];
    if (quoted){
      if (ch === '"' && source[i + 1] === '"'){ field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator){ row.push(field); field = ""; }
    else if (ch === "\n"){ row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length){ row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(values => values.some(value => String(value).trim()));
}
function conceptCsvCell(value){ const text = String(value == null ? "" : value); return /[",;\t\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }

function conceptGraphFromRows(rows){
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("concept-table-empty");
  const headers = (rows[0] || []).map(conceptHeaderKey), find = key => headers.findIndex(value => value && CONCEPT_TABLE_COLUMNS[key].includes(value));
  const titleAt = find("title"), fromAt = find("from") >= 0 ? find("from") : titleAt, toAt = find("to");
  const mode = fromAt >= 0 && toAt >= 0 ? "edges" : "nodes";
  // 개념 표에서는 제목 열이 그 줄의 카드고, 따로 있는 '상위' 열이 그 카드의 부모다.
  const baseAt = mode === "edges" ? fromAt : titleAt, parentAt = mode === "edges" ? -1 : (fromAt !== titleAt ? fromAt : -1);
  if (baseAt < 0) throw new Error("concept-table-columns");
  const weightAt = find("weight"), weightEdgeIds = [];
  const typeAt = find("type"), labelAt = find("label"), categoryAt = find("category"), descriptionAt = find("description"), colorAt = find("color");
  const fallbackRelation = mode === "edges" ? conceptDefaultRelation(rows[0][fromAt], rows[0][toAt]) : "include";
  const nodes = [], edges = [], byKey = new Map(), edgeKeys = new Set(), cell = (row, index) => index >= 0 ? String(row[index] == null ? "" : row[index]).trim() : "";
  let skipped = 0, truncated = false;
  const ensure = (title, row, withDetails) => {
    const key = conceptMatchKey(title); if (!key) return null;
    const found = byKey.get(key);
    if (found){
      // 같은 개념이 여러 줄에 나오면 비어 있던 칸만 채운다(관계 표에서는 한 카드가 여러 줄에 걸친다).
      if (withDetails){ if (!found.category) found.category = cell(row, categoryAt); if (!found.description) found.description = cell(row, descriptionAt); }
      return found;
    }
    if (nodes.length >= CONCEPT_MAX_NODES){ truncated = true; return null; }
    const node = conceptNormalizeNode({ title, category:withDetails ? cell(row, categoryAt) : "", description:withDetails ? cell(row, descriptionAt) : "",
      color:withDetails && colorAt >= 0 ? conceptColorId(cell(row, colorAt)) : "blue" }, nodes.length);
    nodes.push(node); byKey.set(key, node); return node;
  };
  for (let index = 1; index < rows.length; index++){
    const row = Array.isArray(rows[index]) ? rows[index] : [], base = ensure(cell(row, baseAt), row, true);
    if (!base){ skipped++; continue; }
    const otherTitle = mode === "edges" ? cell(row, toAt) : cell(row, parentAt);
    if (!otherTitle) continue;                                             // 짝이 비어도 카드는 남긴다(외톨이 개념)
    const other = ensure(otherTitle, row, false);
    if (!other || other.id === base.id) continue;
    const type = typeAt >= 0 ? conceptRelationId(cell(row, typeAt), fallbackRelation) : fallbackRelation;
    const from = mode === "edges" ? base.id : other.id, to = mode === "edges" ? other.id : base.id, edgeKey = from + "\u0000" + to + "\u0000" + type;
    if (edgeKeys.has(edgeKey)) continue;
    if (edges.length >= CONCEPT_MAX_EDGES){ truncated = true; continue; }
    const weightText = cell(row, weightAt), edge = conceptNormalizeEdge({ from, to, type, label:cell(row, labelAt), weight:weightText });
    edges.push(edge); if (weightText && Number.isFinite(Number(weightText))) weightEdgeIds.push(edge.id); edgeKeys.add(edgeKey);
  }
  if (!nodes.length) throw new Error("concept-table-empty");
  return { nodes, edges, mode, skipped, truncated, weightEdgeIds };
}

/* 개요는 들여쓰기 한 단계가 상위 → 하위 한 단계다. 글머리 기호와 번호는 떼고, 한 줄은
   '제목 | 설명 | 분류'로 나눈다. 탭과 공백을 섞어 쓴 글도 탭을 네 칸으로 세어 같은 자로 잰다. */
function conceptOutlineParse(text){
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n"), nodes = [], edges = [], stack = [];
  let skipped = 0, truncated = false;
  for (const line of lines){
    if (!line.trim()) continue;
    const indent = (line.match(/^[\t ]*/) || [""])[0].replace(/\t/g, " ".repeat(CONCEPT_OUTLINE_TAB)).length;
    const parts = line.trim().replace(/^(?:[-*•·—]|\d+[.)]|[가-힣][.)])\s+/, "").split("|").map(part => part.trim());
    if (!parts[0]){ skipped++; continue; }
    if (nodes.length >= CONCEPT_MAX_NODES){ truncated = true; break; }
    const node = conceptNormalizeNode({ title:parts[0], description:parts[1] || "", category:parts[2] || "" }, nodes.length);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent){
      if (edges.length >= CONCEPT_MAX_EDGES) truncated = true;
      else edges.push(conceptNormalizeEdge({ from:parent.id, to:node.id, type:"include" }));
    }
    stack.push({ indent, id:node.id }); nodes.push(node);
  }
  if (!nodes.length) throw new Error("concept-outline-empty");
  return { nodes, edges, mode:"outline", skipped, truncated, weightEdgeIds:[] };
}

/* 관계도를 개요 글로 되돌린다. 방향 있는 관계(원인·포함·근거)만 상하 관계로 보고, 카드마다
   처음 만난 상위 하나만 부모로 삼는다 — 개요는 나무라서 한 카드가 두 자리에 앉을 수 없다.
   순환에 걸려 뿌리가 없는 무리는 마지막에 왼쪽 끝에서 다시 편다. */
function conceptGraphToOutline(model){
  const nodes = (model && model.nodes) || [], ids = new Set(nodes.map(node => node.id));
  const children = new Map(nodes.map(node => [node.id, []])), parentOf = new Map(), byId = new Map(nodes.map(node => [node.id, node]));
  for (const edge of (model && model.edges) || []){
    if (!CONCEPT_TREE_RELATIONS.includes(edge.type) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || parentOf.has(edge.to)) continue;
    parentOf.set(edge.to, edge.from); children.get(edge.from).push(edge.to);
  }
  const lines = [], visited = new Set();
  const walk = (id, depth) => {
    if (visited.has(id)) return; visited.add(id);
    const node = byId.get(id), description = String(node.description || "").replace(/\s+/g, " ").trim(), parts = [node.title];
    if (description || node.category) parts.push(description);
    if (node.category) parts.push(node.category);
    lines.push("\t".repeat(depth) + parts.join(CONCEPT_OUTLINE_SEPARATOR));
    children.get(id).forEach(child => walk(child, depth + 1));
  };
  nodes.forEach(node => { if (!parentOf.has(node.id)) walk(node.id, 0); });
  nodes.forEach(node => walk(node.id, 0));
  return lines.join("\n");
}

/* 관계 하나가 한 줄인 CSV. 카드의 분류·설명은 출발 카드 줄에 함께 적어 다시 들일 때 살아나고,
   관계가 하나도 없는 외톨이 카드도 빈 관계 줄로 남겨 빠지지 않게 한다. */
function conceptGraphToCsv(model){
  const nodes = (model && model.nodes) || [], byId = new Map(nodes.map(node => [node.id, node]));
  const rows = [["개념", "분류", "설명", "관계", "대상", "연결선", "강도"]], linked = new Set();
  for (const edge of (model && model.edges) || []){
    const from = byId.get(edge.from), to = byId.get(edge.to);
    if (!from || !to) continue;
    linked.add(from.id);
    const relation = CONCEPT_RELATIONS.find(item => item.id === edge.type);
    rows.push([from.title, from.category, from.description, relation ? relation.label : "관련", to.title, edge.label, conceptNormalizeWeight(edge.weight)]);
  }
  for (const node of nodes) if (!linked.has(node.id)) rows.push([node.title, node.category, node.description, "", "", "", ""]);
  return rows.map(row => row.map(conceptCsvCell).join(",")).join("\r\n");
}

/* 들인 그래프를 지금 관계도에 얹는다. 같은 이름의 카드는 새로 만들지 않고 그대로 쓰므로
   표를 고쳐 다시 들여도 카드가 두 벌이 되지 않고, 색·사진·설명 같은 손질도 살아남는다. */
function conceptMergeGraph(model, incoming, options = {}){
  const replace = !!options.replace;
  const nodes = replace ? [] : ((model && model.nodes) || []).map(node => ({ ...node }));
  const edges = replace ? [] : ((model && model.edges) || []).map(edge => ({ ...edge }));
  const byKey = new Map(nodes.map(node => [conceptMatchKey(node.title), node]));
  const edgeKeys = new Set(edges.map(edge => edge.from + "\u0000" + edge.to + "\u0000" + edge.type));
  const idMap = new Map();
  let added = 0, reused = 0, addedEdges = 0, dropped = 0, droppedEdges = 0, updatedEdges = 0;
  const explicitWeights = Array.isArray(incoming && incoming.weightEdgeIds) ? new Set(incoming.weightEdgeIds) : null;
  for (const raw of (incoming && incoming.nodes) || []){
    const node = conceptNormalizeNode(raw, nodes.length), key = conceptMatchKey(node.title);
    if (!key){ dropped++; continue; }
    const found = byKey.get(key);
    if (found){
      if (!found.category && node.category) found.category = node.category;
      if (!found.description && node.description) found.description = node.description;
      idMap.set(raw.id, found.id); reused++; continue;
    }
    if (nodes.length >= CONCEPT_MAX_NODES){ dropped++; continue; }
    nodes.push(node); byKey.set(key, node); idMap.set(raw.id, node.id); added++;
  }
  for (const raw of (incoming && incoming.edges) || []){
    const from = idMap.get(raw.from), to = idMap.get(raw.to);
    if (!from || !to || from === to){ droppedEdges++; continue; }
    const type = conceptRelationId(raw.type, "related"), key = from + "\u0000" + to + "\u0000" + type;
    if (edgeKeys.has(key)){
      if (explicitWeights ? explicitWeights.has(raw.id) : raw.weight != null){
        const weight = conceptNormalizeWeight(raw.weight);
        edges.filter(edge => edge.from === from && edge.to === to && edge.type === type).forEach(edge => { if (edge.weight !== weight){ edge.weight = weight; updatedEdges++; } });
      }
      droppedEdges++; continue;
    }
    if (edges.length >= CONCEPT_MAX_EDGES){ droppedEdges++; continue; }
    edges.push(conceptNormalizeEdge({ from, to, type, label:raw.label, weight:raw.weight })); edgeKeys.add(key); addedEdges++;
  }
  return { nodes, edges, added, reused, addedEdges, dropped, droppedEdges, updatedEdges };
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
/* 한글 엑셀에서 저장한 CSV 는 CP949 인 경우가 많다. 본문 바이트를 보고 인코딩을 고른 뒤 읽어야
   부서 이름이 깨지지 않는다(판정기는 코어의 것을 그대로 쓴다). */
async function conceptTableText(file){
  try {
    if (typeof detectTextEncoding !== "function") throw new Error("no-detector");
    const bytes = new Uint8Array(await file.arrayBuffer()), info = detectTextEncoding(bytes);
    return new TextDecoder((info && info.encoding) || "utf-8").decode(bytes);
  } catch(_){ return await file.text(); }
}
/* 엑셀은 연대표가 쓰는 ExcelJS 묶음과 시트 읽기·네임스페이스 교정을 그대로 빌린다. 사진은 읽지
   않으므로(카드 사진은 손으로 넣는다) 첫 시트의 글자만 표로 만들어 돌려준다. */
async function conceptRowsFromFile(file){
  if (!/\.xlsx$/i.test(String((file && file.name) || ""))) return conceptCsvRows(await conceptTableText(file));
  if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("exceljs");
  if (typeof ExcelJS === "undefined" || !ExcelJS.Workbook || typeof timelineSheetRows !== "function") throw new Error("concept-xlsx-runtime");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); }
  catch(error){
    if (typeof timelineNormalizeXlsxNamespaces !== "function") throw error;
    if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("jszip");
    const fixed = timelineNormalizeXlsxNamespaces(bytes);
    if (fixed === bytes) throw error;
    workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(fixed);
  }
  const sheet = (workbook.worksheets || []).find(item => item && item.rowCount) || (workbook.worksheets || [])[0];
  if (!sheet) throw new Error("concept-table-empty");
  return timelineSheetRows(sheet);
}
function conceptSafeName(value){ return String(value || "개념 관계도").replace(/[\\/:*?"<>|]+/g, "_").trim() || "개념 관계도"; }
function conceptDownload(name, blob){
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const addNodeBtn = conceptButton("＋ 개념", "새 개념 카드 추가", "concept-btn concept-primary"), addEdgeBtn = conceptButton("＋ 관계", "두 개념 사이 관계 추가"), autoBtn = conceptButton("자동 정렬 ▾", "군집형·관계 강도형·중심 집중형·가계도·방사형·원형·흐름형·격자형 중에서 배치 선택");
  const undoBtn = conceptButton("↶", "실행 취소 (Ctrl+Z)"), redoBtn = conceptButton("↷", "다시 실행 (Ctrl+Shift+Z)");
  const search = document.createElement("input"); search.type = "search"; search.className = "concept-search"; search.placeholder = "개념·설명 검색";
  const orderBtn = conceptButton("① 순서", "전개 발표에서 카드가 나올 순서 정하기"), animationSelect = document.createElement("select"); animationSelect.className = "concept-animation"; animationSelect.title = "전개 발표 애니메이션"; animationSelect.setAttribute("aria-label", "전개 발표 애니메이션");
  CONCEPT_PRESENT_ANIMATIONS.forEach(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = "효과: " + item.label; animationSelect.appendChild(option); }); animationSelect.value = model.presentation.animation;
  const zoomTools = document.createElement("div"); zoomTools.className = "concept-zoom-tools"; const zoomOutBtn = conceptButton("−", "축소 (Ctrl+마우스 휠 아래)"), zoomResetBtn = conceptButton("100%", "배율 100%로 되돌리고 관계도를 화면 가운데로 (Home 키는 화면에 맞춤)"), zoomInBtn = conceptButton("＋", "확대 (Ctrl+마우스 휠 위)"); zoomTools.append(zoomOutBtn, zoomResetBtn, zoomInBtn);
  const tableBtn = conceptButton("표·개요", "엑셀·CSV 표나 개요 글에서 카드 가져오기 · 관계 CSV·개요 내보내기");
  const presentBtn = conceptButton("▶ 큰 카드", "개념을 하나씩 크게 보여주기"), buildPresentBtn = conceptButton("전개 발표", "Space 키로 카드와 관계를 순서대로 공개", "concept-btn concept-build-start"), printBtn = conceptButton("🖨 인쇄", "관계도를 인쇄하거나 PDF로 저장"), saveBtn = conceptButton("저장", "개념 관계도 저장 (Ctrl+S)", "concept-btn concept-primary run-save");
  const edgePicked = document.createElement("div"); edgePicked.className = "concept-edge-picked"; edgePicked.hidden = true; edgePicked.setAttribute("aria-live", "polite");
  const edgePickedCount = document.createElement("span"), edgePickedClear = conceptButton("선택 해제", "고른 관계선을 모두 놓기 (Esc)", "concept-edge-picked-clear");
  const edgeWeightBtn = conceptButton("강도 설정", "선택한 관계선의 강도를 한꺼번에 변경", "concept-edge-picked-weight");
  edgeWeightBtn.onclick = () => openEdgeWeightDialog();
  edgePicked.append(edgePickedCount, edgeWeightBtn, edgePickedClear);
  // 알림은 도구막대 맨 끝에 둔다(나타났다 사라져도 다른 버튼이 밀리지 않는다).
  bar.append(titleInput, addNodeBtn, addEdgeBtn, autoBtn, undoBtn, redoBtn, search, zoomTools, orderBtn, animationSelect, tableBtn, presentBtn, buildPresentBtn, printBtn, saveBtn, edgePicked);
  const viewport = document.createElement("div"); viewport.className = "concept-viewport"; viewport.tabIndex = 0;
  const stage = document.createElement("div"); stage.className = "concept-stage"; stage.style.width = CONCEPT_CANVAS_WIDTH + "px"; stage.style.height = CONCEPT_CANVAS_HEIGHT + "px";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("concept-lines"); svg.setAttribute("viewBox", `0 0 ${CONCEPT_CANVAS_WIDTH} ${CONCEPT_CANVAS_HEIGHT}`);
  svg.innerHTML = '<defs><marker id="conceptArrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z"></path></marker></defs>';
  const cards = document.createElement("div"); cards.className = "concept-cards"; stage.append(svg, cards); viewport.appendChild(stage); root.append(bar, viewport);
  let selectedId = "", hoverEdgeId = "", lastPick = "", history = null, recoveryTimer = 0, drag = null, previewTimer = 0, suppressCardClick = false, closeNodePreview = null, closeBuildPresentation = null, zoom = 1, panX = 0, panY = 0, panReady = false, glideTimer = 0;

  const selectedEdgeIds = new Set();   // Ctrl(⌘)+클릭으로 관계선을 여러 개 골라 둘 수 있다(고르기까지만 하고 한꺼번에 지우지는 않는다)
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
  const replaceModel = restored => { model.title = restored.title; model.layout = restored.layout; model.layoutStyle = restored.layoutStyle; model.layoutSpacing = restored.layoutSpacing; Object.assign(model, conceptLayoutSettings(restored)); model.nodes = restored.nodes; model.edges = restored.edges; model.presentation = restored.presentation; titleInput.value = model.title; animationSelect.value = model.presentation.animation; if (selectedId && !model.nodes.some(node => node.id === selectedId)) selectedId = ""; render(); touch(); };
  history = MNEditHistory.create({ capture:snapshot, isEqual:(a, b) => a === b, apply:value => replaceModel(conceptSnapshotModel(value)), onChange:() => { undoBtn.disabled = !history.canUndo(); redoBtn.disabled = !history.canRedo(); }, limit:CONCEPT_HISTORY_LIMIT });
  history.reset(); doc._conceptHistory = history;

  const applyPan = () => { stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`; };
  const setPan = (x, y, glide) => {
    const size = conceptCanvasSize(model.nodes), next = conceptClampPan(x, y, size.width, size.height, viewport.clientWidth, viewport.clientHeight, zoom);
    panX = next.x; panY = next.y;
    if (glide){ stage.classList.add("is-gliding"); clearTimeout(glideTimer); glideTimer = setTimeout(() => stage.classList.remove("is-gliding"), 340); }
    applyPan();
  };
  const centerCanvas = glide => { const size = conceptCanvasSize(model.nodes); setPan((viewport.clientWidth - size.width * zoom) / 2, (viewport.clientHeight - size.height * zoom) / 2, glide); };
  const syncCanvasSize = () => {
    const size = conceptCanvasSize(model.nodes); stage.style.width = size.width + "px"; stage.style.height = size.height + "px"; svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    if (!panReady && viewport.clientWidth > 0){ panReady = true; panX = (viewport.clientWidth - size.width * zoom) / 2; panY = (viewport.clientHeight - size.height * zoom) / 2; }
    setPan(panX, panY); zoomResetBtn.textContent = Math.round(zoom * 100) + "%"; zoomOutBtn.disabled = zoom <= CONCEPT_MIN_ZOOM; zoomInBtn.disabled = zoom >= CONCEPT_MAX_ZOOM;
  };
  const setZoom = (value, clientX, clientY) => {
    const next = conceptClampZoom(value); if (Math.abs(next - zoom) < .001) return;
    const rect = viewport.getBoundingClientRect(), anchorX = clientX == null ? rect.width / 2 : clientX - rect.left, anchorY = clientY == null ? rect.height / 2 : clientY - rect.top;
    const moved = conceptZoomPan(panX, panY, anchorX, anchorY, zoom, next); zoom = next; panX = moved.x; panY = moved.y; syncCanvasSize();
  };
  const fitCanvasToViewport = () => { const size = conceptCanvasSize(model.nodes); zoom = conceptFitZoom(size.width, size.height, viewport.clientWidth, viewport.clientHeight); syncCanvasSize(); centerCanvas(true); };
  const onViewportWheel = event => {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    if (event.ctrlKey || event.metaKey){ event.preventDefault(); setZoom(zoom * Math.exp(-event.deltaY * unit * .0014), event.clientX, event.clientY); return; }
    // 스크롤 막대가 없는 화면이라 휠도 직접 받아 옮긴다(Shift+휠은 가로).
    event.preventDefault(); stage.classList.remove("is-gliding");
    let dx = event.deltaX * unit, dy = event.deltaY * unit;
    if (event.shiftKey && !event.deltaX){ dx = dy; dy = 0; }
    setPan(panX - dx, panY - dy);
  };
  viewport.addEventListener("wheel", onViewportWheel, { passive:false }); zoomOutBtn.onclick = () => setZoom(zoom / 1.2); zoomResetBtn.onclick = () => { setZoom(1); centerCanvas(true); }; zoomInBtn.onclick = () => setZoom(zoom * 1.2);
  // 빈 여백을 끌어서 화면을 옮긴다(손바닥). 스크롤이 아니라 무대 변환을 직접 움직이므로 어느 방향으로든 자유롭다.
  // 빈 곳의 이벤트 대상은 무대가 아니라 무대를 덮은 svg(.concept-lines)라서 허용 목록에 함께 넣는다.
  const panBackground = target => target === viewport || target === stage || target === svg || target === cards;
  const touchPoints = new Map();
  let panState = null, pinchState = null;
  const pinchMetrics = () => {
    const [first, second] = [...touchPoints.values()], rect = viewport.getBoundingClientRect();
    return { distance:Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), x:(first.x + second.x) / 2 - rect.left, y:(first.y + second.y) / 2 - rect.top };
  };
  const startPinch = () => {
    // 두 손가락이 닿으면 손바닥 이동을 접고 핀치로 넘어간다.
    // 끌던 카드가 있으면 반쯤 옮겨진 채 기록도 남지 않으므로, 집었던 자리로 되돌리고 손을 뗀다.
    if (drag){ const moved = model.nodes.find(node => node.id === drag.id); if (moved){ moved.x = drag.ox; moved.y = drag.oy; } drag = null; render(); }
    panState = null; viewport.classList.remove("is-panning"); stage.classList.remove("is-gliding");
    const metrics = pinchMetrics(); pinchState = { distance:metrics.distance, x:metrics.x, y:metrics.y, zoom, panX, panY };
  };
  const onPanPointerDown = event => {
    if (event.pointerType === "touch" || event.pointerType === "pen"){
      touchPoints.set(event.pointerId, { x:event.clientX, y:event.clientY });
      if (touchPoints.size === 2){ event.preventDefault(); startPinch(); return; }
      if (touchPoints.size > 2) return;
    } else if (event.button !== 0) return;
    if (pinchState || !panBackground(event.target)) return;
    event.preventDefault(); stage.classList.remove("is-gliding");
    panState = { id:event.pointerId, x:event.clientX, y:event.clientY, panX, panY };
    viewport.classList.add("is-panning");
    try { viewport.focus({ preventScroll:true }); } catch(_){ viewport.focus(); }
    try { viewport.setPointerCapture(event.pointerId); } catch(_){}
  };
  const onPanPointerMove = event => {
    if (touchPoints.has(event.pointerId)) touchPoints.set(event.pointerId, { x:event.clientX, y:event.clientY });
    if (pinchState){
      if (touchPoints.size < 2) return;
      event.preventDefault();
      const metrics = pinchMetrics(), next = conceptClampZoom(pinchState.zoom * (metrics.distance / pinchState.distance));
      const moved = conceptZoomPan(pinchState.panX, pinchState.panY, pinchState.x, pinchState.y, pinchState.zoom, next);
      zoom = next; setPan(moved.x + (metrics.x - pinchState.x), moved.y + (metrics.y - pinchState.y)); syncCanvasSize();
      return;
    }
    if (!panState || event.pointerId !== panState.id) return;
    event.preventDefault();
    setPan(panState.panX + (event.clientX - panState.x), panState.panY + (event.clientY - panState.y));
  };
  const finishPan = event => {
    if (event) touchPoints.delete(event.pointerId);
    if (pinchState && touchPoints.size < 2) pinchState = null;
    if (!panState || (event && event.pointerId !== panState.id)) return;
    const pointerId = panState.id; panState = null; viewport.classList.remove("is-panning");
    try { if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId); } catch(_){}
  };
  const onViewportKeyDown = event => {
    if (event.target !== viewport || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? CONCEPT_PAN_STEP * 3 : CONCEPT_PAN_STEP;
    if (event.key === "ArrowLeft") setPan(panX + step, panY);
    else if (event.key === "ArrowRight") setPan(panX - step, panY);
    else if (event.key === "ArrowUp") setPan(panX, panY + step);
    else if (event.key === "ArrowDown") setPan(panX, panY - step);
    else if (event.key === "Home") fitCanvasToViewport();
    else return;
    event.preventDefault();
  };
  viewport.addEventListener("pointerdown", onPanPointerDown); viewport.addEventListener("pointermove", onPanPointerMove);
  viewport.addEventListener("pointerup", finishPan); viewport.addEventListener("pointercancel", finishPan); viewport.addEventListener("lostpointercapture", finishPan);
  viewport.addEventListener("keydown", onViewportKeyDown);
  const viewportResizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncCanvasSize) : null; if (viewportResizeObserver) viewportResizeObserver.observe(viewport);

  const edgePath = (from, to) => { const ax = from.x + 115, ay = from.y + 65, bx = to.x + 115, by = to.y + 65, bend = Math.max(50, Math.abs(bx - ax) * .42); return `M ${ax} ${ay} C ${ax + (bx >= ax ? bend : -bend)} ${ay}, ${bx - (bx >= ax ? bend : -bend)} ${by}, ${bx} ${by}`; };
  /* 선 하나의 좌표를 제자리에서 고친다 — 만들지 않는다.
     세 겹(판정선·후광·본선)은 같은 d 를 쓰고, 이름표는 두 카드의 한가운데에 둔다(115·55 는 카드 230×130 의 절반). */
  const edgeShapes = new Map();          // 관계선 id → { paths:[판정선, 후광, 본선], label }
  const placeEdge = (parts, from, to) => {
    const shape = edgePath(from, to);
    for (const path of parts.paths) path.setAttribute("d", shape);
    parts.label.setAttribute("x", String((from.x + to.x) / 2 + 115));
    parts.label.setAttribute("y", String((from.y + to.y) / 2 + 55));
  };
  /* 카드를 끄는 동안에는 그 카드에 닿은 선만 좌표를 고친다.
     예전에는 매 pointermove 마다 renderEdges 로 전체를 헐고 다시 지었다 — 선 하나에 SVG 5개와
     리스너 4개씩이라, 선 300개면 마우스가 1px 움직일 때마다 노드 1,800개를 만들고 리스너를
     1,200개 달았다. 끌기 중에는 구조가 그대로고 좌표만 바뀌므로 만들 이유가 없다.
     끌기가 시작될 때 대상을 한 번만 추려 두고(그 뒤로는 O(닿은 선)), 카드 위치는 제자리에서
     고쳐지므로 node 객체를 그대로 들고 있어도 값이 따라온다. */
  const edgesTouchingNode = (nodeId) => {
    const byNode = new Map(model.nodes.map(node => [node.id, node]));
    const moving = [];
    for (const edge of model.edges){
      if (edge.from !== nodeId && edge.to !== nodeId) continue;
      const parts = edgeShapes.get(edge.id), from = byNode.get(edge.from), to = byNode.get(edge.to);
      if (parts && from && to) moving.push({ parts, from, to });
    }
    return moving;
  };
  const moveEdges = (moving) => { for (const item of moving) placeEdge(item.parts, item.from, item.to); };

  function renderEdges(){
    [...svg.querySelectorAll(".concept-edge")].forEach(node => node.remove()); edgeShapes.clear();
    const byNode = new Map(model.nodes.map(node => [node.id, node]));
    if (selectedEdgeIds.size){ const live = new Set(model.edges.map(edge => edge.id)); selectedEdgeIds.forEach(id => { if (!live.has(id)) selectedEdgeIds.delete(id); }); }
    for (const edge of model.edges){
      const from = byNode.get(edge.from), to = byNode.get(edge.to); if (!from || !to) continue;
      const group = document.createElementNS(svg.namespaceURI, "g"); group.classList.add("concept-edge"); if (selectedEdgeIds.has(edge.id)) group.classList.add("is-selected"); group.dataset.edgeId = edge.id;
      // 보이는 선은 2.5px뿐이라 마우스로 잡기 어렵다. 투명한 굵은 선(판정선)을 밑에 깔아 hover·선택 판정을 넓힌다.
      // 후광은 판정선과 따로 둔다. 한 장으로 겸하면 후광을 굵게 하는 만큼 누르는 자리도 넓어져 화면 끌기를 잡아먹는다.
      const hit = document.createElementNS(svg.namespaceURI, "path"); hit.classList.add("concept-edge-hit");
      const halo = document.createElementNS(svg.namespaceURI, "path"); halo.classList.add("concept-edge-halo");
      const tip = document.createElementNS(svg.namespaceURI, "title"); tip.textContent = `관계 강도: ${conceptNormalizeWeight(edge.weight)}/5 · 클릭: 관계선 고르기 · 두 번 클릭: 수정`;
      const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("marker-end", "url(#conceptArrow)"); path.classList.add("concept-edge-path", "is-" + edge.type);
      if (model.showWeights) path.style.setProperty("--concept-edge-width", String(1 + conceptNormalizeWeight(edge.weight) * .5));
      const label = document.createElementNS(svg.namespaceURI, "text"); label.classList.add("concept-edge-label"); label.textContent = edge.label || (CONCEPT_RELATIONS.find(item => item.id === edge.type) || {}).label || "관련";
      // 좌표는 만들 때도 끌 때도 placeEdge 한 곳에서만 정한다(두 벌이 되면 끄는 동안만 어긋난다).
      const parts = { paths:[hit, halo, path], label }; placeEdge(parts, from, to); edgeShapes.set(edge.id, parts);
      group.append(tip, hit, halo, path, label); group.addEventListener("click", event => selectEdge(edge.id, event.ctrlKey || event.metaKey)); group.addEventListener("dblclick", () => openEdgeDialog(edge.id));
      group.addEventListener("pointerenter", () => { hoverEdgeId = edge.id; refreshLinkedCards(); });
      group.addEventListener("pointerleave", () => { if (hoverEdgeId !== edge.id) return; hoverEdgeId = ""; refreshLinkedCards(); });
      svg.appendChild(group);
    }
    if (hoverEdgeId && !model.edges.some(edge => edge.id === hoverEdgeId)) hoverEdgeId = "";
    refreshLinkedCards(); refreshEdgePicked(); syncEdgeEmphasis();
  }
  // 고른 선은 맨 뒤로 다시 붙여 다른 선에 깔리지 않게 하고(SVG 는 나중에 그린 것이 위), 하나라도 고르면 나머지 선은 한 발 물러선다.
  const syncEdgeEmphasis = () => {
    svg.classList.toggle("has-picked", selectedEdgeIds.size > 0);
    svg.querySelectorAll(".concept-edge.is-selected").forEach(group => svg.appendChild(group));
  };
  const refreshEdgePicked = () => {
    edgePicked.hidden = !selectedEdgeIds.size;
    edgePickedCount.innerHTML = ""; const strong = document.createElement("b"); strong.textContent = String(selectedEdgeIds.size);
    edgePickedCount.append("관계선 ", strong, "개 선택");
  };
  // 관계선에 손을 올리거나 고르면 그 선이 잇는 두 카드도 함께 밝힌다(무엇과 무엇을 잇는 선인지 바로 읽히게).
  // 손을 올린 쪽이 우선이라, 고른 선이 있어도 다른 선을 훑어보는 동안에는 그 선의 양 끝이 밝아진다.
  const refreshLinkedCards = () => {
    const shown = hoverEdgeId ? model.edges.filter(edge => edge.id === hoverEdgeId) : model.edges.filter(edge => selectedEdgeIds.has(edge.id));
    const ends = new Set(); shown.forEach(edge => { ends.add(edge.from); ends.add(edge.to); });
    cards.querySelectorAll(".concept-card").forEach(card => card.classList.toggle("is-linked", ends.has(card.dataset.nodeId)));
  };
  // 한번 고른 관계선은 마우스로 다른 곳을 만져도 풀리지 않는다. 놓는 길은 Esc 와 도구막대의 '선택 해제' 둘뿐이다.
  const selectCard = id => {
    selectedId = id; lastPick = "card";
    cards.querySelectorAll(".concept-card").forEach(card => card.classList.toggle("is-selected", card.dataset.nodeId === id));
    refreshLinkedCards();
  };
  // 그냥 클릭은 하나만, Ctrl(⌘)+클릭은 이미 고른 것에 더하거나 뺀다. id 가 비면(Esc·선택 해제 버튼) 모두 놓는다.
  const selectEdge = (id, additive) => {
    if (!id) selectedEdgeIds.clear();
    else if (!additive){ selectedEdgeIds.clear(); selectedEdgeIds.add(id); }
    else if (selectedEdgeIds.has(id)) selectedEdgeIds.delete(id);
    else selectedEdgeIds.add(id);
    if (id) lastPick = "edge";
    svg.querySelectorAll(".concept-edge").forEach(group => group.classList.toggle("is-selected", selectedEdgeIds.has(group.dataset.edgeId)));
    syncEdgeEmphasis(); refreshLinkedCards(); refreshEdgePicked();
  };
  edgePickedClear.onclick = () => { selectEdge(""); viewport.focus(); };
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
  /* 검색은 카드를 지우는 게 아니라 흐리게(is-muted) 할 뿐이라, 타자마다 다시 만들 이유가 없다.
     예전에는 input 이 곧장 render 였다 — 한 글자에 카드 DOM 전체(요소 12개·리스너 7개씩)를 새로
     짓고, 카드 사진은 base64 data URL 이라 <img> 를 다시 만드는 순간 브라우저가 이미지를 통째로
     다시 디코딩했다(사진 30장이면 타자 한 번에 30장). 판정식은 render 와 이 함수가 함께 쓴다. */
  const nodeMatchesQuery = (node, query) =>
    !query || [node.title, node.category, node.description].join(" ").toLowerCase().includes(query);
  const applySearchFilter = () => {
    const query = search.value.trim().toLowerCase();
    const byId = new Map(model.nodes.map(node => [node.id, node]));
    for (const card of cards.children){
      const node = byId.get(card.dataset.nodeId);   // 카드가 아닌 자식(빈 관계도 안내 버튼)은 건너뛴다
      if (node) card.classList.toggle("is-muted", !nodeMatchesQuery(node, query));
    }
  };
  function render(){
    syncCanvasSize();
    cards.innerHTML = ""; const query = search.value.trim().toLowerCase(), orderById = new Map(model.presentation.order.map((id, index) => [id, index + 1]));
    for (const node of model.nodes){
      const card = document.createElement("article"); card.className = "concept-card" + (node.id === selectedId ? " is-selected" : "") + (node.pinned ? " is-pinned" : ""); card.dataset.nodeId = node.id; card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.setProperty("--concept-color", CONCEPT_COLORS[node.color]);
      card.tabIndex = 0; card.title = node.pinned ? "위치 고정됨 · 이동하려면 고정 해제 · 클릭: 크게 보기 · 두 번 클릭: 수정" : "클릭: 크게 보기 · 끌기: 이동 · 두 번 클릭: 수정"; card.setAttribute("aria-label", node.title + (node.pinned ? " 위치 고정 카드." : " 카드.") + " Enter 키로 크게 보기");
      if (!nodeMatchesQuery(node, query)) card.classList.add("is-muted");
      const head = document.createElement("div"); head.className = "concept-card-head"; const headLabel = document.createElement("div"), order = document.createElement("span"), category = document.createElement("small"); headLabel.className = "concept-card-label"; order.className = "concept-order-badge"; order.textContent = String(orderById.get(node.id) || "–"); order.title = "발표 순서"; category.textContent = node.category || "개념"; headLabel.append(order, category); const edit = conceptButton("⋯", "개념 수정", "concept-card-edit"); const actions = document.createElement("div"); actions.className = "concept-card-actions";
      const pin = conceptButton(node.pinned ? "고정됨" : "고정", node.pinned ? "위치 고정 해제" : "위치 고정 · 자동정렬과 끌기에서 제자리 유지", "concept-card-pin"); pin.setAttribute("aria-pressed", String(node.pinned)); actions.append(pin, edit); head.append(headLabel, actions);
      pin.addEventListener("click", event => { event.stopPropagation(); clearTimeout(previewTimer); previewTimer = 0; node.pinned = !node.pinned; history.commit(); touch(); render(); Array.from(cards.children).find(item => item.dataset.nodeId === node.id)?.querySelector(".concept-card-pin")?.focus(); });
      const title = document.createElement("h3"); title.textContent = node.title; const body = document.createElement("div"); body.className = "concept-card-body";
      if (node.image){ const img = document.createElement("img"); img.src = node.image.dataUrl; img.alt = ""; body.appendChild(img); }
      const description = document.createElement("p"); description.textContent = node.description || "설명을 입력하세요."; body.appendChild(description); card.append(head, title, body); cards.appendChild(card);
      edit.addEventListener("click", event => { event.stopPropagation(); openNodeDialog(node.id); });
      card.addEventListener("click", () => { if (suppressCardClick){ suppressCardClick = false; return; } selectCard(node.id); clearTimeout(previewTimer); previewTimer = setTimeout(() => { previewTimer = 0; openNodePreview(node.id, card); }, 220); });
      card.addEventListener("dblclick", event => { if (event.target.closest("button")) return; clearTimeout(previewTimer); previewTimer = 0; openNodeDialog(node.id); });
      card.addEventListener("keydown", event => { if (event.target !== card || event.key !== "Enter") return; event.preventDefault(); selectCard(node.id); openNodePreview(node.id, card); });
      card.addEventListener("pointerdown", event => { if (event.button !== 0 || event.target.closest("button")) return; clearTimeout(previewTimer); previewTimer = 0; selectCard(node.id); if (node.pinned) return; drag = { id:node.id, pointer:event.pointerId, x:event.clientX, y:event.clientY, lastX:event.clientX, lastY:event.clientY, ox:node.x, oy:node.y, panX, panY, zoom, edges:edgesTouchingNode(node.id) }; card.setPointerCapture(event.pointerId); card.classList.add("is-dragging"); });
      card.addEventListener("pointermove", event => { if (!drag || drag.pointer !== event.pointerId || drag.id !== node.id) return; const rect = viewport.getBoundingClientRect(), margin = 58, speed = 22, moveX = event.clientX - drag.lastX, moveY = event.clientY - drag.lastY, dx = event.clientX > rect.right - margin && moveX > 0 ? speed : event.clientX < rect.left + margin && moveX < 0 ? -speed : 0, dy = event.clientY > rect.bottom - margin && moveY > 0 ? speed : event.clientY < rect.top + margin && moveY < 0 ? -speed : 0; drag.lastX = event.clientX; drag.lastY = event.clientY; if (dx || dy) setPan(panX - dx, panY - dy); const activeZoom = drag.zoom || 1; node.x = conceptDragCoordinate(drag.ox, event.clientX - drag.x, drag.panX - panX, activeZoom); node.y = conceptDragCoordinate(drag.oy, event.clientY - drag.y, drag.panY - panY, activeZoom); card.style.left = node.x + "px"; card.style.top = node.y + "px"; syncCanvasSize(); moveEdges(drag.edges); });
      const finish = event => { if (!drag || drag.pointer !== event.pointerId || drag.id !== node.id) return; const changed = node.x !== drag.ox || node.y !== drag.oy; drag = null; card.classList.remove("is-dragging"); if (changed){ suppressCardClick = true; setTimeout(() => { suppressCardClick = false; }, 0); model.layout = "free"; history.commit(); touch(); } };
      card.addEventListener("pointerup", finish); card.addEventListener("pointercancel", finish);
    }
    renderEdges();
    if (!model.nodes.length){ const empty = conceptButton("＋ 첫 개념을 넣어 관계도를 시작하세요", "첫 개념 추가", "concept-empty"); empty.addEventListener("click", () => openNodeDialog()); cards.appendChild(empty); }
  }
  doc.conceptSelectNode = (id, center) => { const node = model.nodes.find(item => item.id === id); if (!node) return false; selectedId = id; lastPick = "card"; render(); if (center) setPan(viewport.clientWidth / 2 - (node.x + 115) * zoom, viewport.clientHeight / 2 - (node.y + 65) * zoom, true); return true; };

  function weightSelect(value){
    const select = document.createElement("select");
    [[1,"1 · 매우 약함"], [2,"2 · 약함"], [3,"3 · 보통"], [4,"4 · 강함"], [5,"5 · 매우 강함"]].forEach(([number, text]) => { const option = document.createElement("option"); option.value = String(number); option.textContent = text; select.appendChild(option); });
    select.value = String(conceptNormalizeWeight(value)); return select;
  }
  function openEdgeWeightDialog(){
    const ids = new Set(selectedEdgeIds), chosen = model.edges.filter(edge => ids.has(edge.id)); if (!chosen.length) return;
    const body = document.createElement("div"); body.className = "concept-form";
    body.innerHTML = '<label class="wide cw-field"><span>관계 강도</span></label><p class="wide cw-note"></p><footer class="wide"><button type="button" class="cw-cancel">취소</button><button type="button" class="cw-save primary">강도 적용</button></footer>';
    const ui = conceptModal(`관계선 ${chosen.length}개 강도 설정`, body), select = weightSelect(chosen[0].weight);
    if (new Set(chosen.map(edge => conceptNormalizeWeight(edge.weight))).size > 1){ const mixed = document.createElement("option"); mixed.value = ""; mixed.textContent = "서로 다름 · 적용할 강도를 고르세요"; mixed.disabled = true; select.prepend(mixed); select.value = ""; }
    body.querySelector(".cw-field").appendChild(select);
    body.querySelector(".cw-note").textContent = "강도를 저장한 뒤 자동 정렬을 적용하면 배치에 반영됩니다.";
    const save = body.querySelector(".cw-save"); save.disabled = !select.value; select.onchange = () => { save.disabled = !select.value; };
    body.querySelector(".cw-cancel").onclick = ui.dispose;
    save.onclick = () => { if (!select.value) return; model.edges.forEach(edge => { if (ids.has(edge.id)) edge.weight = conceptNormalizeWeight(select.value); }); ui.dispose(); history.commit(); touch(); render(); };
  }
  function openAutoLayoutDialog(){
    if (!model.nodes.length){ if (typeof toast === "function") toast("정렬할 카드가 없어요.", 2200); return; }
    const body = document.createElement("div"); body.className = "concept-layout-form"; body.innerHTML = '<fieldset><legend>배치 방식</legend><div class="concept-layout-choices"></div></fieldset><fieldset><legend>카드 간격</legend><div class="concept-layout-spacing"></div></fieldset><label class="concept-layout-fit"><input type="checkbox" checked><span><strong>정렬 뒤 화면에 맞춤</strong><small>관계도 전체가 최대한 보이도록 배율을 자동 조절합니다.</small></span></label><p class="concept-layout-root"></p><p class="concept-layout-pinned"></p><fieldset class="cl-weight-settings"><legend>관계 강도 반영</legend><label><input type="checkbox" class="cl-weighted"> 강도에 따라 거리·묶음 조절</label><label>영향도 <select class="cl-influence"><option value="weak">약하게</option><option value="normal">보통</option><option value="strong">강하게</option></select></label><small>군집형·관계 강도형·중심 집중형에 적용됩니다. 카드가 겹치면 간격을 우선 확보합니다.</small></fieldset><label class="cl-root-field">중심 카드 <select class="cl-root"></select></label><label><input type="checkbox" class="cl-show-weights"> 관계 강도를 선 굵기로 표시</label><footer><button type="button" class="cl-cancel">취소</button><button type="button" class="cl-apply primary">정렬 적용</button></footer>';
    const ui = conceptModal("자동 정렬", body), choices = body.querySelector(".concept-layout-choices"), spacing = body.querySelector(".concept-layout-spacing");
    CONCEPT_LAYOUTS.forEach(item => { const label = document.createElement("label"); label.className = "concept-layout-choice"; const input = document.createElement("input"); input.type = "radio"; input.name = "concept-layout-mode"; input.value = item.id; input.checked = item.id === model.layoutStyle; const copy = document.createElement("span"), strong = document.createElement("strong"), small = document.createElement("small"); strong.textContent = item.label; small.textContent = item.description; copy.append(strong, small); label.append(input, copy); choices.appendChild(label); });
    [["tight", "좁게"], ["normal", "보통"], ["wide", "넓게"]].forEach(([value, text]) => { const label = document.createElement("label"), input = document.createElement("input"); input.type = "radio"; input.name = "concept-layout-spacing"; input.value = value; input.checked = value === model.layoutSpacing; label.append(input, document.createTextNode(text)); spacing.appendChild(label); });
    const weighted = body.querySelector(".cl-weighted"), influence = body.querySelector(".cl-influence"), showWeights = body.querySelector(".cl-show-weights"), rootSelect = body.querySelector(".cl-root");
    weighted.checked = model.layoutWeighted; influence.value = model.layoutInfluence; showWeights.checked = model.showWeights;
    const automatic = document.createElement("option"); automatic.value = ""; automatic.textContent = "자동 · 관계의 시작 카드"; rootSelect.appendChild(automatic);
    model.nodes.forEach(node => { const option = document.createElement("option"); option.value = node.id; option.textContent = node.title; rootSelect.appendChild(option); });
    rootSelect.value = selectedId || model.layoutRootId || "";
    const pinnedCount = model.nodes.filter(node => node.pinned).length; body.querySelector(".concept-layout-pinned").textContent = pinnedCount ? `위치 고정 카드 ${pinnedCount}개는 제자리에 두고 나머지를 정렬합니다. 고정 위치를 우선하므로 묶음 모양과 관계 방향이 달라질 수 있습니다.` : "카드의 ‘고정’을 누르면 모든 자동정렬에서 그 위치를 유지합니다.";
    const syncSettings = () => { const mode = body.querySelector('input[name="concept-layout-mode"]:checked').value, usesWeights = mode === "cluster" || mode === "weighted" || mode === "focus"; body.querySelector(".cl-weight-settings").disabled = !usesWeights; influence.disabled = !usesWeights || !weighted.checked; rootSelect.disabled = mode !== "radial" && mode !== "focus"; };
    choices.onchange = syncSettings; weighted.onchange = syncSettings; syncSettings();
    body.querySelector(".concept-layout-root").textContent = "중심 카드는 방사형·중심 집중형에 적용됩니다. 중심 집중형은 연결되지 않은 묶음을 따로 정돈합니다.";
    body.querySelector(".cl-cancel").onclick = ui.dispose; body.querySelector(".cl-apply").onclick = () => { const mode = body.querySelector('input[name="concept-layout-mode"]:checked').value, spacingValue = body.querySelector('input[name="concept-layout-spacing"]:checked').value, fit = body.querySelector(".concept-layout-fit input").checked; model.layoutWeighted = weighted.checked; model.layoutInfluence = influence.value; model.showWeights = showWeights.checked; model.layoutRootId = rootSelect.value; model.nodes = conceptAutoLayout(model.nodes, model.edges, { mode, spacing:spacingValue, rootId:rootSelect.value, weighted:weighted.checked, influence:influence.value }); model.layout = "auto"; model.layoutStyle = mode; model.layoutSpacing = spacingValue; ui.dispose(); history.commit(); touch(); render(); if (fit) requestAnimationFrame(fitCanvasToViewport); else centerCanvas(true); };
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
    body.innerHTML = '<label><span>개념 이름</span><input class="cn-title" maxlength="120"></label><label><span>분류</span><input class="cn-category" maxlength="60" placeholder="예: 원인·인물·공식"></label><label><span>색상</span><select class="cn-color"><option value="blue">파랑</option><option value="green">초록</option><option value="amber">노랑</option><option value="rose">빨강</option><option value="purple">보라</option><option value="slate">검정</option></select></label><label class="wide"><span>설명</span><textarea class="cn-description" rows="6" maxlength="3000"></textarea></label><label class="wide concept-pin-field"><input type="checkbox" class="cn-pinned"><span>카드 위치 고정 · 자동정렬과 끌기에서 제자리 유지</span></label><div class="concept-photo wide"><span>사진</span><div class="cn-photo-preview"></div><button type="button" class="cn-photo-pick">사진 넣기</button><button type="button" class="cn-photo-remove">지우기</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden></div><p class="concept-form-error wide" role="alert"></p><footer class="wide"><button type="button" class="cn-delete danger">삭제</button><span></span><button type="button" class="cn-cancel">취소</button><button type="button" class="cn-save primary">저장</button></footer>';
    const ui = conceptModal(current ? "개념 수정" : "새 개념", body), title = body.querySelector(".cn-title"), category = body.querySelector(".cn-category"), color = body.querySelector(".cn-color"), description = body.querySelector(".cn-description"), pinned = body.querySelector(".cn-pinned"); pinned.checked = !!(current && current.pinned); let image = current && current.image ? current.image : null;
    title.value = current ? current.title : ""; category.value = current ? current.category : ""; color.value = current ? current.color : "blue"; description.value = current ? current.description : "";
    const preview = body.querySelector(".cn-photo-preview"), photoInput = body.querySelector("input[type=file]"); const showPhoto = () => { preview.innerHTML = ""; if (image){ const img = document.createElement("img"); img.src = image.dataUrl; img.alt = "선택한 사진"; preview.appendChild(img); } else preview.textContent = "사진 없음"; };
    showPhoto(); body.querySelector(".cn-photo-pick").onclick = () => photoInput.click(); body.querySelector(".cn-photo-remove").onclick = () => { image = null; showPhoto(); };
    photoInput.onchange = async () => { const file = photoInput.files && photoInput.files[0]; if (!file) return; try { if (typeof timelinePreparePhoto !== "function") throw new Error("photo-runtime"); image = await timelinePreparePhoto(file); showPhoto(); } catch(_){ body.querySelector(".concept-form-error").textContent = "사진을 넣지 못했어요. PNG·JPG·WebP를 사용하세요."; } };
    body.querySelector(".cn-cancel").onclick = ui.dispose; const del = body.querySelector(".cn-delete"); del.hidden = !current;
    del.onclick = async () => { if (typeof confirmDialog !== "function" || !await confirmDialog("이 개념과 연결된 관계를 함께 삭제할까요?", "삭제", "취소")) return; model.nodes = model.nodes.filter(node => node.id !== current.id); model.edges = model.edges.filter(edge => edge.from !== current.id && edge.to !== current.id); model.presentation = conceptNormalizePresentation(model.presentation, model.nodes); selectedId = ""; ui.dispose(); history.commit(); touch(); render(); };
    body.querySelector(".cn-save").onclick = () => { if (!title.value.trim()){ body.querySelector(".concept-form-error").textContent = "개념 이름을 입력하세요."; title.focus(); return; }
      if (current) Object.assign(current, { title:title.value.trim(), category:category.value.trim(), color:color.value, description:description.value, image, pinned:pinned.checked });
      else { if (model.nodes.length >= CONCEPT_MAX_NODES){ body.querySelector(".concept-form-error").textContent = "개념은 최대 300개까지 넣을 수 있어요."; return; } const count = model.nodes.length, node = conceptNormalizeNode({ title:title.value.trim(), category:category.value.trim(), color:color.value, description:description.value, image, pinned:pinned.checked, x:80 + count % 5 * 290, y:80 + Math.floor(count / 5) * 180 }, count); model.nodes.push(node); model.presentation.order.push(node.id); selectedId = node.id; }
      ui.dispose(); history.commit(); touch(); render(); };
    setTimeout(() => title.focus(), 0);
  }

  function openEdgeDialog(id){
    if (model.nodes.length < 2){ if (typeof toast === "function") toast("관계를 만들려면 개념이 두 개 이상 필요해요.", 2800); return; }
    const current = model.edges.find(edge => edge.id === id) || null, body = document.createElement("div"); body.className = "concept-form";
    body.innerHTML = '<label><span>시작 개념</span><select class="ce-from"></select></label><label><span>관계 종류</span><select class="ce-type"></select></label><label><span>도착 개념</span><select class="ce-to"></select></label><label class="wide"><span>연결선에 표시할 말</span><input class="ce-label" maxlength="80" placeholder="예: 때문에·포함한다·공통점"></label><label class="wide ce-weight-field"><span>관계 강도</span></label><p class="wide">강도가 높을수록 새 자동정렬에서 가까워집니다. 저장 후 정렬을 적용하세요.</p><p class="concept-form-error wide" role="alert"></p><footer class="wide"><button type="button" class="ce-delete danger">삭제</button><span></span><button type="button" class="ce-cancel">취소</button><button type="button" class="ce-save primary">저장</button></footer>';
    const weight = weightSelect(current ? current.weight : 3); body.querySelector(".ce-weight-field").appendChild(weight);
    const ui = conceptModal(current ? "관계 수정" : "새 관계", body), from = body.querySelector(".ce-from"), to = body.querySelector(".ce-to"), type = body.querySelector(".ce-type"), label = body.querySelector(".ce-label");
    model.nodes.forEach(node => { [from, to].forEach(select => { const option = document.createElement("option"); option.value = node.id; option.textContent = node.title; select.appendChild(option); }); }); CONCEPT_RELATIONS.forEach(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.label; type.appendChild(option); });
    from.value = current ? current.from : (selectedId || model.nodes[0].id); to.value = current ? current.to : model.nodes.find(node => node.id !== from.value).id; type.value = current ? current.type : "cause"; label.value = current ? current.label : "";
    body.querySelector(".ce-cancel").onclick = ui.dispose; const del = body.querySelector(".ce-delete"); del.hidden = !current; del.onclick = () => { model.edges = model.edges.filter(edge => edge.id !== current.id); ui.dispose(); history.commit(); touch(); render(); };
    body.querySelector(".ce-save").onclick = () => { if (from.value === to.value){ body.querySelector(".concept-form-error").textContent = "서로 다른 개념을 고르세요."; return; } if (current) Object.assign(current, { from:from.value, to:to.value, type:type.value, label:label.value.trim(), weight:conceptNormalizeWeight(weight.value) }); else if (model.edges.length < CONCEPT_MAX_EDGES) model.edges.push(conceptNormalizeEdge({ from:from.value, to:to.value, type:type.value, label:label.value.trim(), weight:conceptNormalizeWeight(weight.value) })); ui.dispose(); history.commit(); touch(); render(); };
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
    overlay.innerHTML = '<div class="concept-build-top"><div><strong class="concept-build-title"></strong><span class="concept-build-count"></span></div><div class="concept-build-progress"><i></i></div><button type="button" class="concept-build-close">끝내기</button></div><div class="concept-build-viewport"><div class="concept-build-fit"><div class="concept-build-stage"><svg class="concept-lines"></svg><div class="concept-cards"></div></div></div><div class="concept-build-hint"><strong>Space</strong><span>키를 눌러 첫 카드를 보여 주세요</span></div></div><div class="concept-build-controls"><button type="button" class="prev">이전</button><span>Space로 다음 · Shift+Space로 이전</span><div class="concept-build-zoom" aria-label="발표 화면 확대·축소"><button type="button" class="zoom-out" title="축소 (Ctrl+마우스 휠 아래)">−</button><button type="button" class="zoom-reset" title="배율 100%로 되돌리기">100%</button><button type="button" class="zoom-in" title="확대 (Ctrl+마우스 휠 위)">＋</button></div><button type="button" class="next">다음</button></div>';
    root.appendChild(overlay); const buildViewport = overlay.querySelector(".concept-build-viewport"), fit = overlay.querySelector(".concept-build-fit"), buildStage = overlay.querySelector(".concept-build-stage"), buildSvg = overlay.querySelector("svg"), buildCards = overlay.querySelector(".concept-cards"), hint = overlay.querySelector(".concept-build-hint");
    const buildZoomOut = overlay.querySelector(".zoom-out"), buildZoomReset = overlay.querySelector(".zoom-reset"), buildZoomIn = overlay.querySelector(".zoom-in");
    overlay.querySelector(".concept-build-title").textContent = model.title || "개념 관계도"; buildStage.style.width = stageWidth + "px"; buildStage.style.height = stageHeight + "px"; buildSvg.setAttribute("viewBox", `0 0 ${stageWidth} ${stageHeight}`);
    const markerId = "conceptBuildArrow" + Date.now().toString(36); buildSvg.innerHTML = `<defs><marker id="${markerId}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z"></path></marker></defs>`;
    const buildCardById = new Map(), edgeElements = [];
    for (const edge of model.edges){
      const from = model.nodes.find(node => node.id === edge.from), to = model.nodes.find(node => node.id === edge.to), fromIndex = orderIndex.get(edge.from), toIndex = orderIndex.get(edge.to); if (!from || !to || fromIndex == null || toIndex == null) continue;
      const group = document.createElementNS(buildSvg.namespaceURI, "g"); group.classList.add("concept-edge", "concept-build-edge", "is-build-hidden"); group.dataset.revealStep = String(Math.max(fromIndex, toIndex) + 1);
      const path = document.createElementNS(buildSvg.namespaceURI, "path"); path.setAttribute("d", edgePath(from, to)); path.setAttribute("marker-end", `url(#${markerId})`); path.classList.add("concept-edge-path", "is-" + edge.type);
      if (model.showWeights) path.style.setProperty("--concept-edge-width", String(1 + conceptNormalizeWeight(edge.weight) * .5));
      const label = document.createElementNS(buildSvg.namespaceURI, "text"); label.classList.add("concept-edge-label"); label.setAttribute("x", String((from.x + to.x) / 2 + 115)); label.setAttribute("y", String((from.y + to.y) / 2 + 55)); label.textContent = edge.label || (CONCEPT_RELATIONS.find(item => item.id === edge.type) || {}).label || "관련";
      group.append(path, label); buildSvg.appendChild(group); edgeElements.push(group);
    }
    ordered.forEach((node, index) => {
      const card = document.createElement("article"); card.className = "concept-card concept-build-card is-build-hidden"; card.dataset.nodeId = node.id; card.dataset.step = String(index + 1); card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.setProperty("--concept-color", CONCEPT_COLORS[node.color]); card.tabIndex = -1; card.setAttribute("aria-hidden", "true");
      const head = document.createElement("div"); head.className = "concept-card-head"; const label = document.createElement("div"), number = document.createElement("span"), category = document.createElement("small"); label.className = "concept-card-label"; number.className = "concept-order-badge"; number.textContent = String(index + 1); category.textContent = node.category || "개념"; label.append(number, category); head.appendChild(label);
      const title = document.createElement("h3"); title.textContent = node.title; const body = document.createElement("div"); body.className = "concept-card-body"; if (node.image){ const img = document.createElement("img"); img.src = node.image.dataUrl; img.alt = ""; body.appendChild(img); } const description = document.createElement("p"); description.textContent = node.description || "설명이 없습니다."; body.appendChild(description); card.append(head, title, body); buildCards.appendChild(card); buildCardById.set(node.id, card);
      card.addEventListener("click", () => openNodePreview(node.id, card)); card.addEventListener("keydown", event => { if (event.key === "Enter"){ event.preventDefault(); openNodePreview(node.id, card); } });
    });
    let step = 0, fitScale = 1, buildZoomAdjusted = false; const animationTimers = new Set(), reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const later = (fn, delay) => { const timer = setTimeout(() => { animationTimers.delete(timer); fn(); }, delay); animationTimers.add(timer); };
    const layoutBuildStage = () => { const scaledWidth = stageWidth * fitScale, scaledHeight = stageHeight * fitScale, marginX = Math.max(16, (buildViewport.clientWidth - scaledWidth) / 2), marginY = Math.max(16, (buildViewport.clientHeight - scaledHeight) / 2); fit.style.width = scaledWidth + "px"; fit.style.height = scaledHeight + "px"; fit.style.margin = `${marginY}px ${marginX}px`; buildStage.style.transform = `scale(${fitScale})`; buildZoomReset.textContent = Math.round(fitScale * 100) + "%"; buildZoomOut.disabled = fitScale <= CONCEPT_MIN_ZOOM; buildZoomIn.disabled = fitScale >= CONCEPT_MAX_ZOOM; };
    const fitStage = () => { const width = Math.max(320, buildViewport.clientWidth - 34), height = Math.max(260, buildViewport.clientHeight - 34); fitScale = conceptClampZoom(Math.min(1, width / stageWidth, height / stageHeight)); layoutBuildStage(); };
    const setBuildZoom = (value, clientX, clientY) => {
      const next = conceptClampZoom(value); if (Math.abs(next - fitScale) < .001) return;
      const rect = buildViewport.getBoundingClientRect(), anchorX = clientX == null ? rect.width / 2 : clientX - rect.left, anchorY = clientY == null ? rect.height / 2 : clientY - rect.top, oldScale = fitScale, oldOffsetLeft = fit.offsetLeft, oldOffsetTop = fit.offsetTop;
      fitScale = next; buildZoomAdjusted = true; layoutBuildStage(); const scroll = conceptZoomScrollWithOffset(buildViewport.scrollLeft, buildViewport.scrollTop, anchorX, anchorY, oldScale, next, oldOffsetLeft, oldOffsetTop, fit.offsetLeft, fit.offsetTop); buildViewport.scrollTo({ left:scroll.left, top:scroll.top, behavior:"auto" });
    };
    const onBuildWheel = event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? buildViewport.clientHeight : 1, factor = Math.exp(-event.deltaY * unit * .0014); setBuildZoom(fitScale * factor, event.clientX, event.clientY); };
    const focusNode = node => { if (!node || !model.presentation.autoFocus) return; const left = fit.offsetLeft + (node.x + 115) * fitScale - buildViewport.clientWidth / 2, top = fit.offsetTop + (node.y + 65) * fitScale - buildViewport.clientHeight / 2; buildViewport.scrollTo({ left:Math.max(0, left), top:Math.max(0, top), behavior:reducedMotion ? "auto" : "smooth" }); };
    const revealCard = card => { card.classList.remove("is-build-hidden"); card.setAttribute("aria-hidden", "false"); card.tabIndex = 0; if (overlay.dataset.animation !== "none" && !reducedMotion){ card.classList.remove("is-revealing"); void card.offsetWidth; card.classList.add("is-revealing"); later(() => card.classList.remove("is-revealing"), overlay.dataset.animation === "draw" ? 900 : 620); } };
    const revealEdge = group => {
      group.classList.remove("is-build-hidden"); if (overlay.dataset.animation === "none" || reducedMotion) return; group.classList.add("is-revealing"); const path = group.querySelector(".concept-edge-path"), length = Math.max(1, path.getTotalLength()), duration = overlay.dataset.animation === "draw" ? 900 : 480; path.style.transition = "none"; path.style.strokeDasharray = `${length} ${length}`; path.style.strokeDashoffset = String(length); void path.getBoundingClientRect(); path.style.transition = `stroke-dashoffset ${duration}ms ease`; path.style.strokeDashoffset = "0";
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
    const keys = event => { if (closeNodePreview) return; const key = String(event.key || "").toLowerCase(), zoomKey = event.ctrlKey || event.metaKey; if (zoomKey && (key === "+" || key === "=")){ event.preventDefault(); setBuildZoom(fitScale * 1.2); } else if (zoomKey && key === "-"){ event.preventDefault(); setBuildZoom(fitScale / 1.2); } else if (zoomKey && key === "0"){ event.preventDefault(); setBuildZoom(1); } else if (event.key === "Escape"){ event.preventDefault(); close(); } else if (!zoomKey && ((event.key === " " && !event.shiftKey) || event.key === "ArrowRight")){ event.preventDefault(); updateStep(step + 1); } else if (!zoomKey && ((event.key === " " && event.shiftKey) || event.key === "ArrowLeft")){ event.preventDefault(); updateStep(step - 1); } else if (event.key === "Home"){ event.preventDefault(); updateStep(0); } else if (event.key === "End"){ event.preventDefault(); updateStep(ordered.length); } };
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => buildZoomAdjusted ? layoutBuildStage() : fitStage()) : null;
    const close = () => { window.removeEventListener("keydown", keys); buildViewport.removeEventListener("wheel", onBuildWheel); if (resizeObserver) resizeObserver.disconnect(); animationTimers.forEach(clearTimeout); animationTimers.clear(); overlay.remove(); if (closeBuildPresentation === close) closeBuildPresentation = null; if (buildPresentBtn.isConnected) buildPresentBtn.focus(); };
    closeBuildPresentation = close; overlay.querySelector(".concept-build-close").onclick = close; overlay.querySelector(".prev").onclick = () => updateStep(step - 1); overlay.querySelector(".next").onclick = () => updateStep(step + 1); buildZoomOut.onclick = () => setBuildZoom(fitScale / 1.2); buildZoomReset.onclick = () => setBuildZoom(1); buildZoomIn.onclick = () => setBuildZoom(fitScale * 1.2); buildViewport.addEventListener("wheel", onBuildWheel, { passive:false }); window.addEventListener("keydown", keys); if (resizeObserver) resizeObserver.observe(buildViewport); fitStage(); updateStep(0); overlay.querySelector(".next").focus();
  }
  /* 표·개요 창 하나에 들이기와 내보내기를 함께 둔다 — 실무에서는 엑셀이나 개요 글로 이미 적어 둔
     것을 들여왔다가, 고친 뒤 다시 엑셀·개요로 넘기는 왕복이 한 자리에서 끝나야 한다.
     이름이 같은 카드는 다시 만들지 않으므로(conceptMergeGraph) 표를 고쳐 몇 번을 들여도 안전하다. */
  function openTableOutlineDialog(){
    const body = document.createElement("div"); body.className = "concept-io-form";
    body.innerHTML = '<section class="concept-io-block"><h3>표에서 가져오기</h3>'
      + '<p>CSV·엑셀(.xlsx)의 첫 시트를 읽습니다. 첫 줄의 열 이름에서 <b>개념·출발·상위</b>와 <b>대상·도착·하위</b>를 알아보고, 관계·연결선·분류·설명·색 열이 있으면 함께 씁니다. 대상 열이 없는 표는 한 줄이 카드 하나입니다.</p>'
      + '<div class="concept-io-actions"><button type="button" class="ci-file primary">표 파일 고르기</button><button type="button" class="ci-csv">관계 CSV 저장</button></div></section>'
      + '<section class="concept-io-block"><h3>개요 글</h3>'
      + '<p>들여쓰기 한 단계가 <b>상위 → 하위</b> 한 단계입니다. 한 줄은 <code>제목 | 설명 | 분류</code>로 적을 수 있고, 글머리 기호와 번호는 알아서 뗍니다.</p>'
      + '<textarea class="ci-outline" rows="10" spellcheck="false"></textarea>'
      + '<div class="concept-io-actions"><button type="button" class="ci-outline-apply primary">이 글로 만들기</button><button type="button" class="ci-copy">복사</button><button type="button" class="ci-txt">.txt 저장</button></div></section>'
      + '<section class="concept-io-options"><fieldset><legend>넣는 방법</legend><div class="ci-modes"></div></fieldset>'
      + '<label class="ci-layout-field"><span>넣은 뒤 배치</span><select class="ci-layout"></select></label>'
      + '<label class="ci-fit"><input type="checkbox" checked><span>정렬 뒤 화면에 맞춤</span></label></section>'
      + '<p class="concept-io-status" role="status"></p><footer><button type="button" class="ci-close">닫기</button></footer>';
    const ui = conceptModal("표·개요", body), status = body.querySelector(".concept-io-status"), outline = body.querySelector(".ci-outline"), layoutSelect = body.querySelector(".ci-layout");
    const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.hidden = true;
    fileInput.accept = ".csv,text/csv,.tsv,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    body.appendChild(fileInput);
    [["merge", "지금 관계도에 더하기"], ["replace", "관계도를 이 내용으로 바꾸기"]].forEach(([value, text], index) => {
      const label = document.createElement("label"), input = document.createElement("input");
      input.type = "radio"; input.name = "concept-io-mode"; input.value = value; input.checked = index === 0;
      label.append(input, document.createTextNode(text)); body.querySelector(".ci-modes").appendChild(label);
    });
    CONCEPT_LAYOUTS.forEach(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.label; layoutSelect.appendChild(option); });
    layoutSelect.value = model.layoutStyle; outline.value = conceptGraphToOutline(model);
    const say = (text, isError) => { status.textContent = text; status.classList.toggle("is-error", !!isError); };
    const apply = async (incoming, source) => {
      const replace = body.querySelector('input[name="concept-io-mode"]:checked').value === "replace";
      if (replace && model.nodes.length && typeof confirmDialog === "function"
        && !await confirmDialog(`지금 있는 카드 ${model.nodes.length}개를 지우고 ${source}의 내용으로 바꿀까요?`, "바꾸기", "취소")) return;
      const mode = layoutSelect.value, merged = conceptMergeGraph(model, incoming, { replace });
      model.edges = merged.edges;
      model.nodes = conceptAutoLayout(merged.nodes, merged.edges, { mode, spacing:model.layoutSpacing, rootId:selectedId || model.layoutRootId, weighted:model.layoutWeighted, influence:model.layoutInfluence });
      model.layout = "auto"; model.layoutStyle = mode;
      model.presentation = conceptNormalizePresentation(model.presentation, model.nodes);
      if (selectedId && !model.nodes.some(node => node.id === selectedId)) selectedId = "";
      history.commit(); touch(); render();
      if (body.querySelector(".ci-fit input").checked) requestAnimationFrame(fitCanvasToViewport); else centerCanvas(true);
      outline.value = conceptGraphToOutline(model);
      const parts = [`${source}에서 카드 ${merged.added}개·관계 ${merged.addedEdges}개를 넣었어요.`];
      if (merged.updatedEdges) parts.push(`기존 관계 ${merged.updatedEdges}개 강도 갱신`);
      if (merged.reused) parts.push(`이름이 같은 카드 ${merged.reused}개는 그대로 뒀어요`);
      if (incoming.skipped) parts.push(`이름이 빈 ${incoming.skipped}줄 제외`);
      if (merged.dropped || incoming.truncated) parts.push(`카드 ${CONCEPT_MAX_NODES}개 한도를 넘어 일부 제외`);
      say(parts.join(" · "));
      if (typeof toast === "function") toast(parts[0], 3200);
    };
    body.querySelector(".ci-file").onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0]; fileInput.value = ""; if (!file) return;
      const isSheet = /\.xlsx$/i.test(String(file.name || ""));
      say(isSheet ? "엑셀 읽는 중…" : "표 읽는 중…");
      try { await apply(conceptGraphFromRows(await conceptRowsFromFile(file)), isSheet ? "엑셀 시트" : "표"); }
      catch(error){
        const code = error && error.message;
        say(code === "concept-table-columns" ? "‘개념(또는 출발·상위)’ 열을 찾지 못했어요. 첫 줄에 열 이름을 적어 주세요."
          : code === "concept-xlsx-runtime" ? "엑셀을 읽을 준비가 안 됐어요. 잠시 뒤 다시 시도해 주세요."
          : code === "concept-table-empty" ? "읽을 내용이 없어요. 첫 줄은 열 이름, 둘째 줄부터 내용이어야 해요."
          : "표를 읽지 못했어요.", true);
      }
    };
    body.querySelector(".ci-outline-apply").onclick = async () => {
      try { await apply(conceptOutlineParse(outline.value), "개요 글"); }
      catch(_){ say("개요 글에서 읽을 줄이 없어요.", true); }
    };
    body.querySelector(".ci-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(outline.value); say("개요를 복사했어요."); }
      catch(_){ outline.focus(); outline.select(); say("복사하지 못했어요. Ctrl+C 로 복사하세요.", true); }
    };
    body.querySelector(".ci-txt").onclick = () => {
      if (!outline.value.trim()){ say("내보낼 개요가 없어요.", true); return; }
      conceptDownload(conceptSafeName(model.title || doc.name) + " 개요.txt", new Blob([outline.value], { type:"text/plain;charset=utf-8" }));
      say("개요를 .txt 로 저장했어요.");
    };
    body.querySelector(".ci-csv").onclick = () => {
      if (!model.nodes.length){ say("내보낼 카드가 없어요.", true); return; }
      // 엑셀이 UTF-8 CSV 를 CP949 로 읽지 않도록 BOM 을 앞에 붙인다.
      conceptDownload(conceptSafeName(model.title || doc.name) + ".csv", new Blob(["\uFEFF" + conceptGraphToCsv(model)], { type:"text/csv;charset=utf-8" }));
      say("관계 CSV 를 저장했어요. 엑셀에서 고쳐 그대로 다시 들일 수 있어요.");
    };
    body.querySelector(".ci-close").onclick = ui.dispose;
    setTimeout(() => outline.focus(), 0);
  }

  function printConcept(){ document.body.classList.add("concept-printing"); root.classList.add("concept-print-target"); const done = () => { document.body.classList.remove("concept-printing"); root.classList.remove("concept-print-target"); window.removeEventListener("afterprint", done); }; window.addEventListener("afterprint", done); window.print(); setTimeout(done, 1500); }
  addNodeBtn.onclick = () => openNodeDialog(); addEdgeBtn.onclick = () => openEdgeDialog(); autoBtn.onclick = openAutoLayoutDialog; tableBtn.onclick = openTableOutlineDialog;
  undoBtn.onclick = () => history.undo(); redoBtn.onclick = () => history.redo(); search.addEventListener("input", applySearchFilter); titleInput.addEventListener("input", () => { model.title = titleInput.value; history.commitSoon(500); touch(); }); orderBtn.onclick = openPresentationOrderDialog; animationSelect.addEventListener("change", () => { model.presentation.animation = animationSelect.value; history.commit(); touch(); }); presentBtn.onclick = startPresentation; buildPresentBtn.onclick = startBuildPresentation; printBtn.onclick = printConcept; saveBtn.onclick = () => saveConceptDoc(doc);
  const keydown = event => { if (doc.el.hidden || closeBuildPresentation || closeNodePreview || (event.target.closest && event.target.closest("input,textarea,select,[contenteditable=true]"))) return; const key = String(event.key || "").toLowerCase(); if ((event.ctrlKey || event.metaKey) && key === "z"){ event.preventDefault(); event.shiftKey ? history.redo() : history.undo(); } else if ((event.ctrlKey || event.metaKey) && key === "y"){ event.preventDefault(); history.redo(); } else if (event.key === "Delete" && lastPick === "edge"){ if (selectedEdgeIds.size === 1) openEdgeDialog([...selectedEdgeIds][0]); } else if (event.key === "Delete" && selectedId) openNodeDialog(selectedId); else if (event.key === "Escape" && selectedEdgeIds.size) selectEdge(""); };
  window.addEventListener("keydown", keydown); if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = []; doc.cleanupFns.push(() => { clearTimeout(recoveryTimer); clearTimeout(previewTimer); if (closeNodePreview) closeNodePreview(); if (closeBuildPresentation) closeBuildPresentation(); if (viewportResizeObserver) viewportResizeObserver.disconnect(); viewport.removeEventListener("wheel", onViewportWheel); if (history) history.cancel(); window.removeEventListener("keydown", keydown); if (doc.flushBackupRecovery === flushRecovery) delete doc.flushBackupRecovery; if (doc.conceptSelectNode) delete doc.conceptSelectNode; });
  render(); touch();
}

if (typeof module !== "undefined" && module.exports){
  module.exports = { CONCEPT_DOC_TYPE, CONCEPT_DOC_VERSION, CONCEPT_RELATIONS, CONCEPT_PRESENT_ANIMATIONS, CONCEPT_LAYOUTS, CONCEPT_LAYOUT_SPACING, conceptNormalizeNode, conceptNormalizeEdge, conceptNormalizePresentation,
    conceptDocEmpty, conceptDocParse, conceptDocSerialize, conceptSearchText, conceptNodeConnections, conceptAutoLayout, conceptClusterGroups, conceptAutoPresentationOrder, conceptClampZoom, conceptFitZoom, conceptZoomPan, conceptClampPan, conceptZoomScrollWithOffset, conceptDragCoordinate, conceptCanvasSize, conceptScratchFileName, conceptDefaultTitle,
    CONCEPT_TABLE_COLUMNS, CONCEPT_TREE_RELATIONS, conceptHeaderKey, conceptMatchKey, conceptRelationId, conceptColorId, conceptDefaultRelation, conceptCsvDelimiter, conceptCsvRows, conceptCsvCell,
    conceptGraphFromRows, conceptOutlineParse, conceptGraphToOutline, conceptGraphToCsv, conceptMergeGraph };
}
