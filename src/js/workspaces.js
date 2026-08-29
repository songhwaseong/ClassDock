"use strict";

/* 가상 작업공간은 파일을 복제하지 않고 하나의 문서 모델을 여러 화면에서 공유한다.
 * 기존 workspace.bin은 자동복원 원본 풀로 그대로 두며, 이 파일은 멤버십·탭·배치만 저장한다. */
const CLASSDOCK_WORKSPACES_KEY = "classdock-workspaces:v1";
const WORKSPACE_COLORS = ["blue", "green", "orange", "violet", "rose", "teal"];

function workspaceNewId(){ return "ws-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); }
function workspaceCleanName(value, fallback){
  const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return name || fallback || "작업공간";
}
function workspaceRestoreNeedsPreservation(hasSavedKeys, hasSavedMembership){
  return !!hasSavedKeys && !hasSavedMembership;
}
function workspaceNormalizeBoardRows(value){
  if (!Array.isArray(value)) return [];
  const seen = new Set(), rows = [];
  value.slice(0, 1000).forEach(row => {
    if (!row || typeof row !== "object") return;
    const name = String(row.name || "").trim().slice(0, 200);
    const key = String(row.key || name).trim().slice(0, 500);
    const recoveryName = String(row.recoveryName || name).trim().slice(0, 500);
    const memoBlockId = String(row.memoBlockId || "").trim().slice(0, 500);
    if (!name || !key || !recoveryName || seen.has(key)) return;
    seen.add(key); rows.push({ key, name, recoveryName, memoBlockId });
  });
  return rows;
}
function workspaceEmptyRecord(id, name, color){
  return { id, name:workspaceCleanName(name, "기본 작업공간"), color:color || WORKSPACE_COLORS[0],
    createdAt:Date.now(), updatedAt:Date.now(), docKeys:[], tabKeys:[], activeKey:"", mruKeys:[], study:null, boards:[],
    sidebarCollapsed:false, sidebarSearch:"", splitStacked:false, splitSwapped:false,
    runtimeDocIds:new Set(), runtimeTabIds:[], runtimeActiveId:0, runtimeMruIds:[], runtimeStudyId:null };
}
function workspaceNormalizeSaved(value){
  const input = value && typeof value === "object" ? value : {};
  const raw = Array.isArray(input.items) ? input.items.slice(0, 24) : [];
  const seen = new Set(), items = [];
  raw.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    let id = String(row.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    if (!id || seen.has(id)) id = workspaceNewId();
    seen.add(id);
    const rec = workspaceEmptyRecord(id, row.name,
      WORKSPACE_COLORS.includes(row.color) ? row.color : WORKSPACE_COLORS[index % WORKSPACE_COLORS.length]);
    rec.createdAt = Number(row.createdAt) || rec.createdAt; rec.updatedAt = Number(row.updatedAt) || rec.updatedAt;
    rec.docKeys = Array.isArray(row.docKeys) ? row.docKeys.map(String).filter(Boolean).slice(0, 10000) : [];
    rec.tabKeys = Array.isArray(row.tabKeys) ? row.tabKeys.map(String).filter(Boolean).slice(0, 1000) : [];
    rec.activeKey = String(row.activeKey || "");
    rec.mruKeys = Array.isArray(row.mruKeys) ? row.mruKeys.map(String).filter(Boolean).slice(0, 50) : [];
    rec.study = row.study && typeof row.study === "object" ? row.study : null;
    rec.boards = workspaceNormalizeBoardRows(row.boards);
    rec.sidebarCollapsed = !!row.sidebarCollapsed; rec.sidebarSearch = String(row.sidebarSearch || "").slice(0, 300);
    rec.splitStacked = !!row.splitStacked; rec.splitSwapped = !!row.splitSwapped;
    items.push(rec);
  });
  if (!items.length) items.push(workspaceEmptyRecord("main", "기본 작업공간", WORKSPACE_COLORS[0]));
  const requested = String(input.activeId || "");
  return { version:1, items, activeId:items.some(row => row.id === requested) ? requested : items[0].id };
}
function workspaceLoadRegistry(){
  if (typeof localStorage === "undefined") return workspaceNormalizeSaved(null);
  try { return workspaceNormalizeSaved(JSON.parse(localStorage.getItem(CLASSDOCK_WORKSPACES_KEY) || "null")); }
  catch(_){ return workspaceNormalizeSaved(null); }
}

let workspaceRegistry = workspaceLoadRegistry();
let activeWorkspaceId = workspaceRegistry.activeId;
let workspaceSystemReady = false, workspacePersistTimer = 0, workspaceCtxEl = null;
let workspaceRestoreUnresolved = false;
const workspaceDocsByNativePath = new Map();
const workspaceDocsByRestorePath = new Map();
const workspaceDocsByHandle = new WeakMap();

function workspaceNativePathKey(value){
  return String(value || "").replace(/\\/g, "/").toLocaleLowerCase();
}
function workspaceRestorePathKey(value){
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").toLocaleLowerCase();
}
function workspaceDocRestorePath(doc){
  return workspaceRestorePathKey(doc && (doc.workspacePath || doc.relPath || doc.name));
}
function workspaceIndexDocument(doc){
  if (!doc) return;
  const nativeKey = workspaceNativePathKey(doc.nativeAbsolutePath);
  if (nativeKey) workspaceDocsByNativePath.set(nativeKey, doc);
  const restoreKey = workspaceDocRestorePath(doc);
  if (restoreKey){
    let candidates = workspaceDocsByRestorePath.get(restoreKey);
    if (!candidates){ candidates = new Set(); workspaceDocsByRestorePath.set(restoreKey, candidates); }
    candidates.add(doc);
  }
  if (doc.fsHandle && typeof doc.fsHandle === "object") workspaceDocsByHandle.set(doc.fsHandle, doc);
}
function workspaceUnindexDocument(doc){
  if (!doc) return;
  const nativeKey = workspaceNativePathKey(doc.nativeAbsolutePath);
  if (nativeKey && workspaceDocsByNativePath.get(nativeKey) === doc) workspaceDocsByNativePath.delete(nativeKey);
  const restoreKey = workspaceDocRestorePath(doc), candidates = workspaceDocsByRestorePath.get(restoreKey);
  if (candidates){ candidates.delete(doc); if (!candidates.size) workspaceDocsByRestorePath.delete(restoreKey); }
  if (doc.fsHandle && workspaceDocsByHandle.get(doc.fsHandle) === doc) workspaceDocsByHandle.delete(doc.fsHandle);
}

function workspaceRecord(id=activeWorkspaceId){ return workspaceRegistry.items.find(row => row.id === id) || workspaceRegistry.items[0]; }
function workspaceDocKey(doc){
  if (!doc) return "";
  if (typeof docStableKey === "function") return docStableKey(doc);
  return String(doc.nativeAbsolutePath || doc.workspacePath || doc.relPath || doc.name || "").replace(/\\/g, "/");
}
function workspaceHasDoc(doc, id=activeWorkspaceId){
  if (!doc) return false;
  return doc.workspaceIds instanceof Set ? doc.workspaceIds.has(id) : (!workspaceSystemReady || id === activeWorkspaceId);
}
function workspaceActiveDocs(){ return docs.filter(doc => !doc.closed && workspaceHasDoc(doc)); }
function workspaceNodeVisible(node, id=activeWorkspaceId){ return !!node && (!node.workspaceId || node.workspaceId === id); }
function workspaceActiveNodes(){ return navNodes.filter(node => workspaceNodeVisible(node)); }
function workspaceRegisterGroup(node){ if (node){ node.workspaceId = activeWorkspaceId; workspaceSchedulePersist(); } return node; }
function workspaceRegisterDoc(doc, node){
  if (!doc) return doc;
  if (!(doc.workspaceIds instanceof Set)) doc.workspaceIds = new Set();
  doc.workspaceIds.add(activeWorkspaceId);
  if (!doc.primaryWorkspaceId) doc.primaryWorkspaceId = activeWorkspaceId;
  if (node) node.workspaceId = activeWorkspaceId;
  workspaceIndexDocument(doc);
  workspaceRecord().runtimeDocIds.add(doc.id); workspaceSchedulePersist(); return doc;
}
function workspaceDocNodeIn(doc, id){
  return navNodes.find(node => node.type === "doc" && node.docId === doc.id && node.workspaceId === id) || null;
}
function workspaceAddAliasNode(doc, id, parentId=null, force=false){
  if (!doc || (!force && workspaceDocNodeIn(doc, id))) return null;
  const parent = parentId && navNodes.find(node => node.nodeId === parentId && workspaceNodeVisible(node, id));
  const node = { nodeId:"wsdoc:" + (++navSeq), type:"doc", docId:doc.id,
    parentId:parent ? parent.nodeId : null, workspaceId:id, workspaceAlias:true };
  navNodes.push(node); bumpNavTree(); return node;
}
function workspaceAttachExistingDoc(doc, parentId=null){
  if (!doc) return false;
  if (!(doc.workspaceIds instanceof Set)) doc.workspaceIds = new Set([doc.primaryWorkspaceId || activeWorkspaceId]);
  const added = !doc.workspaceIds.has(activeWorkspaceId);
  doc.workspaceIds.add(activeWorkspaceId); workspaceRecord().runtimeDocIds.add(doc.id);
  const existingNode = workspaceDocNodeIn(doc, activeWorkspaceId);
  const parent = parentId && navNodes.find(node =>
    node.nodeId === parentId && node.type === "group" && workspaceNodeVisible(node, activeWorkspaceId));
  let moved = false;
  // 같은 작업공간에서 낱개로 먼저 연 파일이 나중에 드롭한 폴더 안에서 발견되면,
  // 기존 최상위 행을 남기지 말고 그 폴더의 자식으로 옮긴다. 문서 모델·편집 내용은 그대로다.
  if (existingNode && parent && existingNode.parentId !== parent.nodeId){
    existingNode.parentId = parent.nodeId;
    if (doc.nodeId === existingNode.nodeId) doc.parentId = parent.nodeId;
    bumpNavTree();
    moved = true;
  } else if (!existingNode){
    workspaceAddAliasNode(doc, activeWorkspaceId, parent ? parent.nodeId : null);
  }
  if (!tabOrder.includes(doc.id)) tabOrder.push(doc.id);
  if (added || moved){ renderWorkspaceUi(); renderSidebar(); workspaceSchedulePersist(); }
  return moved ? "moved" : added;
}
async function workspaceFindOpenDocument(file, options={}){
  const direct = options.sourceKey ? docsBySourceKey.get(options.sourceKey) : null;
  const nativePath = workspaceNativePathKey(options.nativeAbsolutePath || file && file.__nativeAbsolutePath);
  if (nativePath){
    const byPath = workspaceDocsByNativePath.get(nativePath);
    if (byPath) return byPath;
    // 실제 경로를 아는 파일끼리는 이름·크기·수정 시각이 우연히 같아도 다른 파일이다.
    return null;
  }
  const handle = options.fsHandle || file && file.__fsHandle;
  if (handle && typeof handle.isSameEntry === "function"){
    const byIdentity = workspaceDocsByHandle.get(handle);
    if (byIdentity) return byIdentity;
    const restorePath = workspaceRestorePathKey(options.workspacePath || options.relPath || file && (file.webkitRelativePath || file.name));
    const candidates = workspaceDocsByRestorePath.get(restorePath) || [];
    for (const doc of candidates){
      if (!doc.fsHandle) continue;
      try { if (await handle.isSameEntry(doc.fsHandle)) return doc; } catch(_){ }
    }
    // 파일 시스템 핸들로 비교할 수 있었다면 느슨한 sourceKey로 되돌아가지 않는다.
    return null;
  }
  return direct || null;
}
function workspaceDetachDocFromActive(doc){
  if (!doc || !(doc.workspaceIds instanceof Set) || doc.workspaceIds.size <= 1 || !doc.workspaceIds.has(activeWorkspaceId)) return false;
  doc.workspaceIds.delete(activeWorkspaceId);
  for (let i = navNodes.length - 1; i >= 0; i--){
    const node = navNodes[i];
    if (node.type === "doc" && node.docId === doc.id && node.workspaceId === activeWorkspaceId) navNodes.splice(i, 1);
  }
  const rec = workspaceRecord(activeWorkspaceId);
  rec.runtimeDocIds.delete(doc.id); rec.runtimeTabIds = rec.runtimeTabIds.filter(id => id !== doc.id);
  rec.runtimeMruIds = rec.runtimeMruIds.filter(id => id !== doc.id);
  if (rec.runtimeActiveId === doc.id) rec.runtimeActiveId = 0;
  if (rec.runtimeStudyId === doc.id) rec.runtimeStudyId = null;
  tabOrder = tabOrder.filter(id => id !== doc.id); activeMru = activeMru.filter(id => id !== doc.id);
  if (studyPdfId === doc.id) studyPdfId = null;
  if (doc.primaryWorkspaceId === activeWorkspaceId){
    doc.primaryWorkspaceId = [...doc.workspaceIds][0];
    const promoted = workspaceDocNodeIn(doc, doc.primaryWorkspaceId) || workspaceAddAliasNode(doc, doc.primaryWorkspaceId, null);
    if (promoted){ doc.nodeId = promoted.nodeId; doc.parentId = promoted.parentId; promoted.workspaceAlias = false; }
  }
  bumpNavTree();
  if (activeId === doc.id){
    const next = activeMru.find(id => workspaceActiveDocs().some(item => item.id === id)) || workspaceActiveDocs()[0]?.id || 0;
    activeId = 0; state = null; viewer = null;
    if (next) setActiveDoc(next); else setActiveDoc(0);
  }
  refreshChrome(); renderSidebar(); renderWorkspaceUi(); workspaceSchedulePersist();
  return true;
}
function workspaceForgetClosedDoc(doc){
  if (!doc) return;
  workspaceUnindexDocument(doc);
  const key = workspaceDocKey(doc);
  workspaceRegistry.items.forEach(rec => {
    rec.runtimeDocIds.delete(doc.id); rec.runtimeTabIds = rec.runtimeTabIds.filter(id => id !== doc.id);
    rec.runtimeMruIds = rec.runtimeMruIds.filter(id => id !== doc.id);
    if (rec.runtimeActiveId === doc.id) rec.runtimeActiveId = 0;
    if (rec.runtimeStudyId === doc.id) rec.runtimeStudyId = null;
    rec.docKeys = rec.docKeys.filter(value => value !== key); rec.tabKeys = rec.tabKeys.filter(value => value !== key);
    rec.mruKeys = rec.mruKeys.filter(value => value !== key);
    if (rec.activeKey === key) rec.activeKey = "";
    if (rec.study && (rec.study.reference === key || rec.study.work === key)) rec.study = null;
    rec.boards = rec.boards.filter(row => row.key !== key);
  });
  workspaceSchedulePersist(); renderWorkspaceUi();
}

function workspaceCaptureCurrent(){
  const rec = workspaceRecord(activeWorkspaceId); if (!rec) return;
  const owned = docs.filter(doc => workspaceHasDoc(doc, rec.id));
  // 복원 원본(workspace.bin)이 없거나 손상됐을 때 빈 런타임을 정상 상태로 오인해 저장된
  // 문서 키를 지우지 않는다. 이후 사용자가 실제 파일을 열면 owned가 생겨 해당 작업공간만 갱신된다.
  if (workspaceRestoreUnresolved && !owned.length && rec.docKeys.length){
    rec.sidebarCollapsed = !!sidebarCollapsed;
    const unresolvedSearch = typeof byId === "function" ? byId("sbSearch") : null;
    rec.sidebarSearch = unresolvedSearch ? String(unresolvedSearch.value || "") : rec.sidebarSearch;
    rec.splitStacked = typeof studyStacked !== "undefined" && !!studyStacked;
    rec.splitSwapped = typeof studySwapped !== "undefined" && !!studySwapped;
    rec.updatedAt = Date.now();
    return;
  }
  rec.runtimeDocIds = new Set(owned.map(doc => doc.id));
  rec.runtimeTabIds = tabOrder.filter(id => owned.some(doc => doc.id === id));
  rec.runtimeActiveId = owned.some(doc => doc.id === activeId) ? activeId : 0;
  rec.runtimeMruIds = activeMru.filter(id => owned.some(doc => doc.id === id)).slice(0, 50);
  rec.runtimeStudyId = owned.some(doc => doc.id === studyPdfId) ? studyPdfId : null;
  rec.docKeys = owned.map(workspaceDocKey).filter(Boolean);
  rec.tabKeys = rec.runtimeTabIds.map(id => workspaceDocKey(docs.find(doc => doc.id === id))).filter(Boolean);
  rec.activeKey = workspaceDocKey(docs.find(doc => doc.id === rec.runtimeActiveId));
  rec.mruKeys = rec.runtimeMruIds.map(id => workspaceDocKey(docs.find(doc => doc.id === id))).filter(Boolean);
  const reference = docs.find(doc => doc.id === rec.runtimeStudyId), work = docs.find(doc => doc.id === rec.runtimeActiveId);
  rec.study = reference && work && reference.id !== work.id ? { reference:workspaceDocKey(reference), work:workspaceDocKey(work),
    locked:!!studyReferenceLocked, targetPane:studyTargetPane === "reference" ? "reference" : "work" } : null;
  rec.boards = owned.filter(doc => doc.kind === "board").map(doc => ({
    key:workspaceDocKey(doc), name:String(doc.name || "화이트보드"),
    recoveryName:String(doc.boardRecoveryName || doc.name || "화이트보드"),
    memoBlockId:doc.memoBlockId ? String(doc.memoBlockId) : ""
  })).filter(row => row.key);
  rec.sidebarCollapsed = !!sidebarCollapsed;
  const search = typeof byId === "function" ? byId("sbSearch") : null;
  rec.sidebarSearch = search ? String(search.value || "") : "";
  rec.splitStacked = typeof studyStacked !== "undefined" && !!studyStacked;
  rec.splitSwapped = typeof studySwapped !== "undefined" && !!studySwapped; rec.updatedAt = Date.now();
}
function workspaceSerializableRegistry(){
  workspaceCaptureCurrent();
  return { version:1, activeId:activeWorkspaceId, items:workspaceRegistry.items.map(rec => ({ id:rec.id, name:rec.name,
    color:rec.color, createdAt:rec.createdAt, updatedAt:rec.updatedAt, docKeys:rec.docKeys, tabKeys:rec.tabKeys,
    activeKey:rec.activeKey, mruKeys:rec.mruKeys, study:rec.study, boards:rec.boards, sidebarCollapsed:rec.sidebarCollapsed,
    sidebarSearch:rec.sidebarSearch, splitStacked:rec.splitStacked, splitSwapped:rec.splitSwapped })) };
}
function workspacePersistNow(){
  clearTimeout(workspacePersistTimer); workspacePersistTimer = 0;
  try { localStorage.setItem(CLASSDOCK_WORKSPACES_KEY, JSON.stringify(workspaceSerializableRegistry())); } catch(_){ }
}
function workspaceSchedulePersist(){ clearTimeout(workspacePersistTimer); workspacePersistTimer = setTimeout(workspacePersistNow, 350); }

function workspaceHydrateRuntime(rec, keyToDoc){
  rec.runtimeDocIds = new Set(rec.docKeys.map(key => keyToDoc.get(key)).filter(Boolean).map(doc => doc.id));
  rec.runtimeTabIds = rec.tabKeys.map(key => keyToDoc.get(key)).filter(doc => doc && rec.runtimeDocIds.has(doc.id)).map(doc => doc.id);
  const active = keyToDoc.get(rec.activeKey);
  rec.runtimeActiveId = active && rec.runtimeDocIds.has(active.id) ? active.id : (rec.runtimeTabIds[0] || 0);
  rec.runtimeMruIds = rec.mruKeys.map(key => keyToDoc.get(key)).filter(doc => doc && rec.runtimeDocIds.has(doc.id)).map(doc => doc.id);
  const reference = rec.study && keyToDoc.get(String(rec.study.reference || ""));
  rec.runtimeStudyId = reference && rec.runtimeDocIds.has(reference.id) ? reference.id : null;
}
// 파일 바이트가 없는 화이트보드는 각 작업공간 레코드의 메타데이터로 문서 모델을 먼저 만든다.
// 이후 finalizeWorkspaceRestore가 docKeys/tabKeys를 적용해 소속·탭 순서·활성 탭을 작업공간별로 복원한다.
function restoreSavedWorkspaceWhiteboards(){
  if (typeof newWhiteboard !== "function") return 0;
  const existing = new Map();
  docs.forEach(doc => { const key = workspaceDocKey(doc); if (key && !existing.has(key)) existing.set(key, doc); });
  let restored = 0;
  workspaceRegistry.items.forEach(rec => {
    const ownedKeys = new Set(rec.docKeys);
    const rows = workspaceNormalizeBoardRows(rec.boards);
    // 작업공간별 boards 필드가 없던 버전도 docKeys와 같은 이름의 판서 복구본이 있으면 승격한다.
    if (!rows.length && typeof readBoardRecoverySnapshot === "function") rec.docKeys.forEach(key => {
      if (readBoardRecoverySnapshot(key)) rows.push({ key, name:key, recoveryName:key, memoBlockId:"" });
    });
    rows.forEach(row => {
      if (!ownedKeys.has(row.key) || existing.has(row.key)) return;
      const doc = newWhiteboard({ name:row.name, recoveryName:row.recoveryName,
        memoBlockId:row.memoBlockId, restoreInBackground:true });
      if (!doc) return;
      doc.stableRestoreKey = row.key;
      existing.set(row.key, doc); restored++;
    });
  });
  return restored;
}
function workspaceDeletionKeepNodeIds(nodes, deletedId, movedDocIds){
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const keep = new Set();
  nodes.forEach(node => {
    if (node.workspaceId !== deletedId || node.type !== "doc" || !movedDocIds.has(node.docId)) return;
    let current = node;
    while (current && current.workspaceId === deletedId && !keep.has(current.nodeId)){
      keep.add(current.nodeId);
      current = current.parentId == null ? null : byId.get(current.parentId);
    }
  });
  return keep;
}
function workspaceAncestorMatches(node, id){
  let current = node;
  while (current && current.parentId != null){
    current = navNodes.find(item => item.nodeId === current.parentId);
    if (!current || current.workspaceId !== id) return false;
  }
  return true;
}
function finalizeWorkspaceRestore(){
  if (workspaceSystemReady) return;
  const keyToDoc = new Map();
  docs.forEach(doc => { const key = workspaceDocKey(doc); if (key && !keyToDoc.has(key)) keyToDoc.set(key, doc); });
  const hasSavedKeys = workspaceRegistry.items.some(rec => rec.docKeys.length);
  const hasSavedMembership = workspaceRegistry.items.some(rec => rec.docKeys.some(key => keyToDoc.has(key)));
  workspaceRestoreUnresolved = workspaceRestoreNeedsPreservation(hasSavedKeys, hasSavedMembership);
  docs.forEach(doc => { doc.workspaceIds = new Set(); doc.primaryWorkspaceId = ""; });
  if (hasSavedMembership) workspaceRegistry.items.forEach(rec => rec.docKeys.forEach(key => {
    const doc = keyToDoc.get(key); if (!doc) return;
    doc.workspaceIds.add(rec.id); if (!doc.primaryWorkspaceId) doc.primaryWorkspaceId = rec.id;
  }));
  docs.forEach(doc => {
    if (!doc.workspaceIds.size) doc.workspaceIds.add(activeWorkspaceId);
    if (!doc.primaryWorkspaceId) doc.primaryWorkspaceId = [...doc.workspaceIds][0];
  });
  for (let i = navNodes.length - 1; i >= 0; i--) if (navNodes[i].workspaceAlias) navNodes.splice(i, 1);
  navNodes.filter(node => node.type === "group").forEach(node => { node.workspaceId = ""; });
  navNodes.filter(node => node.type === "doc").forEach(node => {
    const doc = docs.find(item => item.id === node.docId); node.workspaceId = doc ? doc.primaryWorkspaceId : activeWorkspaceId;
  });
  for (let pass = 0; pass < 12; pass++){
    let changed = false;
    navNodes.filter(node => node.type === "group" && !node.workspaceId).forEach(group => {
      const child = navNodes.find(node => node.parentId === group.nodeId && node.workspaceId);
      if (child){ group.workspaceId = child.workspaceId; changed = true; }
    });
    if (!changed) break;
  }
  navNodes.filter(node => node.type === "group").forEach(node => { if (!node.workspaceId) node.workspaceId = activeWorkspaceId; });
  docs.forEach(doc => { for (const id of doc.workspaceIds){
    const node = workspaceDocNodeIn(doc, id);
    if (!node || !workspaceAncestorMatches(node, id)) workspaceAddAliasNode(doc, id, null, true);
  }});
  bumpNavTree(); workspaceRegistry.items.forEach(rec => workspaceHydrateRuntime(rec, keyToDoc));
  if (!hasSavedMembership){
    const rec = workspaceRecord(activeWorkspaceId);
    rec.runtimeDocIds = new Set(docs.map(doc => doc.id)); rec.runtimeTabIds = tabOrder.slice(); rec.runtimeActiveId = activeId;
    rec.runtimeMruIds = activeMru.slice(); rec.runtimeStudyId = studyPdfId;
  }
  workspaceSystemReady = true; switchWorkspace(activeWorkspaceId, { initial:true, quiet:true }); workspacePersistNow();
}

function switchWorkspace(id, options={}){
  const target = workspaceRecord(id);
  if (!target || (!options.initial && target.id === activeWorkspaceId)){ workspaceCloseCtxMenu(); return false; }
  if (workspaceSystemReady && !options.initial) workspaceCaptureCurrent();
  docs.forEach(doc => { if (doc.el) doc.el.hidden = true; });
  activeWorkspaceId = target.id; workspaceRegistry.activeId = target.id;
  tabOrder = target.runtimeTabIds.filter(docId => docs.some(doc => doc.id === docId && workspaceHasDoc(doc, target.id)));
  activeMru = target.runtimeMruIds.filter(docId => docs.some(doc => doc.id === docId && workspaceHasDoc(doc, target.id)));
  studyPdfId = target.runtimeStudyId && docs.some(doc => doc.id === target.runtimeStudyId && workspaceHasDoc(doc, target.id))
    ? target.runtimeStudyId : null;
  studyReferenceLocked = !!(target.study && target.study.locked);
  studyTargetPane = target.study && target.study.targetPane === "reference" ? "reference" : "work";
  sidebarCollapsed = !!target.sidebarCollapsed;
  if (typeof studyStacked !== "undefined") studyStacked = !!target.splitStacked;
  if (typeof studySwapped !== "undefined") studySwapped = !!target.splitSwapped;
  const search = typeof byId === "function" ? byId("sbSearch") : null;
  if (search) search.value = target.sidebarSearch || "";
  const first = workspaceActiveDocs()[0];
  const wanted = target.runtimeActiveId && docs.some(doc => doc.id === target.runtimeActiveId && workspaceHasDoc(doc, target.id))
    ? target.runtimeActiveId : (tabOrder[0] || (first && first.id) || 0);
  activeId = 0; state = null; viewer = null;
  if (wanted) setActiveDoc(wanted); else setActiveDoc(0);
  renderSidebar(); refreshChrome(); applyStudyLayout(); renderWorkspaceUi(); workspaceCloseCtxMenu(); workspaceSchedulePersist();
  if (!options.quiet) toast("'" + target.name + "' 작업공간으로 전환했어요.", 1500); return true;
}

function workspaceUniqueName(base){
  const root = workspaceCleanName(base, "새 작업공간");
  if (!workspaceRegistry.items.some(rec => rec.name === root)) return root;
  for (let i = 2; i < 100; i++) if (!workspaceRegistry.items.some(rec => rec.name === root + " " + i)) return root + " " + i;
  return root + " " + Date.now().toString().slice(-4);
}
async function createWorkspace(){
  if (typeof askText !== "function") return;
  workspaceCloseCtxMenu();
  const suggested = workspaceUniqueName("새 작업공간");
  const entered = await askText({ title:"새 작업공간", message:"새 작업공간 이름을 입력하세요.",
    value:suggested, placeholder:"예: 1학년 수학", okText:"만들기" });
  if (entered === null) return;
  const rec = workspaceEmptyRecord(workspaceNewId(), workspaceUniqueName(entered),
    WORKSPACE_COLORS[workspaceRegistry.items.length % WORKSPACE_COLORS.length]);
  workspaceRegistry.items.push(rec); renderWorkspaceUi(); switchWorkspace(rec.id);
}
async function renameWorkspace(id){
  const rec = workspaceRecord(id); if (!rec) return;
  if (typeof askText !== "function") return;
  workspaceCloseCtxMenu();
  const entered = await askText({ title:"작업공간 이름 변경", message:"새 이름을 입력하세요.",
    value:rec.name, placeholder:"작업공간 이름", okText:"변경" });
  if (entered === null) return;
  rec.name = workspaceCleanName(entered, rec.name); rec.updatedAt = Date.now(); renderWorkspaceUi(); workspaceSchedulePersist();
}
async function deleteWorkspace(id){
  if (workspaceRegistry.items.length <= 1){ toast("작업공간은 하나 이상 있어야 합니다.", 2200); return; }
  const rec = workspaceRecord(id); if (!rec) return;
  const message = "'" + rec.name + "' 작업공간을 삭제할까요? 열린 파일은 다른 작업공간으로 옮겨 원본과 수정 내용을 보존합니다.";
  const ok = typeof confirmDialog === "function" && await confirmDialog(message, "삭제", "취소");
  if (!ok) return;
  workspaceCaptureCurrent();
  const fallback = workspaceRegistry.items.find(item => item.id !== id);
  const movedDocIds = new Set();
  docs.forEach(doc => {
    if (!(doc.workspaceIds instanceof Set) || !doc.workspaceIds.has(id)) return;
    doc.workspaceIds.delete(id);
    if (!doc.workspaceIds.size){ doc.workspaceIds.add(fallback.id); movedDocIds.add(doc.id); }
    if (doc.primaryWorkspaceId === id){
      doc.primaryWorkspaceId = [...doc.workspaceIds][0];
      if (!movedDocIds.has(doc.id)){
        const promoted = workspaceDocNodeIn(doc, doc.primaryWorkspaceId);
        if (promoted){
          promoted.workspaceAlias = false;
          doc.nodeId = promoted.nodeId;
          doc.parentId = promoted.parentId;
        }
      }
    }
  });
  const keepDeletedNodes = workspaceDeletionKeepNodeIds(navNodes, id, movedDocIds);
  for (let index = navNodes.length - 1; index >= 0; index--){
    const node = navNodes[index];
    if (node.workspaceId !== id) continue;
    if (keepDeletedNodes.has(node.nodeId)){
      node.workspaceId = fallback.id;
      if (node.type === "doc") node.workspaceAlias = false;
    } else navNodes.splice(index, 1);
  }
  const movedKeys = docs.filter(doc => movedDocIds.has(doc.id)).map(workspaceDocKey).filter(Boolean);
  movedKeys.forEach(key => {
    if (!fallback.docKeys.includes(key)) fallback.docKeys.push(key);
    if (rec.tabKeys.includes(key) && !fallback.tabKeys.includes(key)) fallback.tabKeys.push(key);
    const board = rec.boards.find(row => row.key === key);
    if (board && !fallback.boards.some(row => row.key === key)) fallback.boards.push(board);
  });
  workspaceRegistry.items = workspaceRegistry.items.filter(item => item.id !== id);
  if (activeWorkspaceId === id) activeWorkspaceId = fallback.id;
  const keyToDoc = new Map(docs.map(doc => [workspaceDocKey(doc), doc]));
  workspaceRegistry.items.forEach(item => workspaceHydrateRuntime(item, keyToDoc));
  bumpNavTree(); switchWorkspace(activeWorkspaceId, { initial:true, quiet:true }); workspacePersistNow();
  toast("작업공간을 삭제하고 열린 파일은 '" + fallback.name + "'에 보존했어요.", 2800);
}

// 작업공간 목록·추가·이름 변경·삭제는 헤더 버튼 대신 탭 우클릭 메뉴로 연다(문서 탭 메뉴와 같은 .tab-ctx-menu 스타일).
function workspaceCloseCtxMenu(){
  if (!workspaceCtxEl) return;
  workspaceCtxEl.remove(); workspaceCtxEl = null;
  document.removeEventListener("keydown", onWorkspaceCtxKey, true);
  document.removeEventListener("click", onWorkspaceCtxDocClick, true);
}
function onWorkspaceCtxKey(e){ if (e.key === "Escape"){ e.stopPropagation(); workspaceCloseCtxMenu(); } }
function onWorkspaceCtxDocClick(e){ if (!(workspaceCtxEl && workspaceCtxEl.contains(e.target))) workspaceCloseCtxMenu(); }
function openWorkspaceCtxMenu(anchorId, x, y){
  workspaceCloseCtxMenu();
  if (typeof closeTabMenu === "function") closeTabMenu();
  const anchor = workspaceRecord(anchorId); if (!anchor) return;
  const menu = document.createElement("div");
  menu.className = "tab-ctx-menu workspace-ctx-menu"; menu.setAttribute("role", "menu");
  const head = document.createElement("div"); head.className = "tcx-head";
  const headTitle = document.createElement("strong"); headTitle.textContent = "작업공간";
  const headHint = document.createElement("small"); headHint.textContent = "Ctrl+Alt+←/→";
  head.append(headTitle, headHint); menu.appendChild(head);
  const add = (label, run, opts) => {
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem");
    const t = document.createElement("span"); t.className = "tcx-label"; t.textContent = label;
    if (opts && opts.color){
      const dot = document.createElement("span"); dot.className = "workspace-color"; dot.dataset.color = opts.color;
      b.appendChild(dot);
    }
    b.appendChild(t);
    if (opts && opts.count !== undefined){
      const c = document.createElement("span"); c.className = "tcx-count"; c.textContent = "파일 " + opts.count.toLocaleString() + "개";
      b.appendChild(c);
    }
    if (opts && opts.active) b.classList.add("is-active");
    if (opts && opts.danger) b.classList.add("danger");
    b.disabled = !!(opts && opts.disabled);
    b.onclick = () => { workspaceCloseCtxMenu(); run(); };
    menu.appendChild(b);
  };
  workspaceRegistry.items.forEach(rec => {
    add(rec.name, () => { if (rec.id !== activeWorkspaceId) switchWorkspace(rec.id); },
      { color:rec.color, count:docs.filter(doc => workspaceHasDoc(doc, rec.id)).length, active:rec.id === activeWorkspaceId });
  });
  const sep = document.createElement("div"); sep.className = "tcx-sep"; menu.appendChild(sep);
  add("＋ 새 작업공간", () => createWorkspace());
  add("'" + anchor.name + "' 이름 변경", () => renameWorkspace(anchor.id));
  add("'" + anchor.name + "' 삭제", () => deleteWorkspace(anchor.id),
    { danger:true, disabled:workspaceRegistry.items.length <= 1 });
  document.body.appendChild(menu);
  const pad = 8, mw = menu.offsetWidth, mh = menu.offsetHeight;     // 화면 밖으로 넘치지 않게 보정
  menu.style.left = Math.max(pad, Math.min(x, window.innerWidth - mw - pad)) + "px";
  menu.style.top  = Math.max(pad, Math.min(y, window.innerHeight - mh - pad)) + "px";
  workspaceCtxEl = menu;
  setTimeout(() => document.addEventListener("click", onWorkspaceCtxDocClick, true), 0);   // 여는 클릭은 제외
  document.addEventListener("keydown", onWorkspaceCtxKey, true);
}
function workspaceRevealTab(tabs, tab){
  if (!tabs || !tab) return;
  const reveal = () => {
    const left = tab.offsetLeft, right = left + tab.offsetWidth;
    if (left < tabs.scrollLeft) tabs.scrollTo({ left:Math.max(0, left - 4), behavior:"smooth" });
    else if (right > tabs.scrollLeft + tabs.clientWidth) tabs.scrollTo({ left:right - tabs.clientWidth + 4, behavior:"smooth" });
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal); else reveal();
}
function renderWorkspaceUi(){
  if (typeof byId !== "function") return;
  const tabs = byId("workspaceTabs");
  let activeTab = null;
  if (tabs){
    tabs.innerHTML = "";
    workspaceRegistry.items.forEach(rec => {
      const tab = document.createElement("button");
      tab.type = "button"; tab.className = "workspace-tab" + (rec.id === activeWorkspaceId ? " active" : "");
      tab.dataset.workspaceId = rec.id; tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(rec.id === activeWorkspaceId));
      tab.tabIndex = rec.id === activeWorkspaceId ? 0 : -1; tab.title = rec.name + " · 우클릭: 작업공간 메뉴";
      const color = document.createElement("span"); color.className = "workspace-color"; color.dataset.color = rec.color;
      const label = document.createElement("span"); label.className = "workspace-tab-name"; label.textContent = rec.name;
      tab.append(color, label);
      tab.onclick = event => { event.stopPropagation(); if (rec.id !== activeWorkspaceId) switchWorkspace(rec.id); };
      tabs.appendChild(tab); if (rec.id === activeWorkspaceId) activeTab = tab;
    });
    workspaceRevealTab(tabs, activeTab);
  }
}
function setupWorkspaceUi(){
  if (typeof byId !== "function") return;
  const tabs = byId("workspaceTabs");
  if (!tabs || tabs.dataset.wired === "1") return;
  tabs.dataset.wired = "1";
  // 탭 위 우클릭은 그 작업공간을, 빈 자리 우클릭은 현재 작업공간을 대상으로 메뉴를 연다.
  tabs.addEventListener("contextmenu", event => {
    const tab = event.target.closest && event.target.closest(".workspace-tab");
    event.preventDefault(); event.stopPropagation();
    openWorkspaceCtxMenu(tab ? tab.dataset.workspaceId : activeWorkspaceId, event.clientX, event.clientY);
  });
  tabs.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || tabs.scrollWidth <= tabs.clientWidth) return;
    event.preventDefault(); tabs.scrollLeft += event.deltaY;
  }, { passive:false });
  tabs.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tab = event.target.closest && event.target.closest(".workspace-tab"); if (!tab) return;
    const index = workspaceRegistry.items.findIndex(rec => rec.id === tab.dataset.workspaceId); if (index < 0) return;
    event.preventDefault();
    let nextIndex = event.key === "Home" ? 0 : event.key === "End" ? workspaceRegistry.items.length - 1
      : (index + (event.key === "ArrowLeft" ? -1 : 1) + workspaceRegistry.items.length) % workspaceRegistry.items.length;
    const next = workspaceRegistry.items[nextIndex]; if (!next) return;
    switchWorkspace(next.id);
    const nextTab = tabs.querySelector('[data-workspace-id="' + next.id + '"]'); if (nextTab) nextTab.focus();
  });
  window.addEventListener("keydown", event => {
    if (!(event.ctrlKey && event.altKey) || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    if (event.target && event.target.closest && event.target.closest("input,textarea,[contenteditable='true']")) return;
    if (document.querySelector(".modal:not([hidden])")) return;
    event.preventDefault(); const index = workspaceRegistry.items.findIndex(rec => rec.id === activeWorkspaceId);
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    const next = workspaceRegistry.items[(index + delta + workspaceRegistry.items.length) % workspaceRegistry.items.length];
    if (next) switchWorkspace(next.id);
  }, true);
  window.addEventListener("pagehide", () => {
    workspacePersistNow();
    // state-sync의 앞선 pagehide 리스너가 먼저 실행된 뒤 생긴 마지막 변경도 서버 app-state.json에 보낸다.
    if (typeof window.__mnFlushAppState === "function") window.__mnFlushAppState();
  });
  renderWorkspaceUi();
}

if (typeof module !== "undefined") module.exports = {
  workspaceNormalizeSaved, workspaceNormalizeBoardRows, workspaceCleanName,
  workspaceRestoreNeedsPreservation, workspaceDeletionKeepNodeIds
};
