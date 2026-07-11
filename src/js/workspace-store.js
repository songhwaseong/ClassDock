"use strict";

/* ===== 최근 작업공간 저장/복원 =====
   EXE(C# 로컬 서버)가 있으면 서버에 저장하고, 없으면(오프라인/온라인 HTML·file:// 포함)
   같은 바이너리 포맷을 이 브라우저의 IndexedDB에 저장한다. 복원·정리 동선은 두 경로가 동일하다. */
let workspaceMutationQueue = Promise.resolve();
const pendingWorkspaceRemovals = new Set();
let workspaceRemoveTimer = 0;
let workspaceCleanupActive = false;
let workspaceClearPending = false;
function setWorkspaceActivity(message){
  const wrap = byId("workspaceActivity"), text = byId("workspaceActivityText");
  if (!wrap || !text) return;
  text.textContent = message || "";
  wrap.hidden = !message;
  if (message) wrap.title = message; else wrap.removeAttribute("title");
}
function queueWorkspaceMutation(task){
  const next = workspaceMutationQueue.then(task, task);
  workspaceMutationQueue = next.catch(() => {});
  return next;
}

async function workspaceFetch(url, options={}){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// ----- 저장 백엔드 선택: EXE 로컬 서버 vs 브라우저 IndexedDB -----
// /can-save-file 은 C# 런처에서만 "yes" 를 돌려준다(한 번만 확인 후 캐시, saveFileBackendAvailable 과 동일 패턴).
let _wsBackendProbe = null;
function workspaceBackendAvailable(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return Promise.resolve(false);
  if (_wsBackendProbe === null){
    _wsBackendProbe = (async () => {
      try {
        const res = await fetch("/can-save-file", { cache: "no-store" });
        return res.ok && (await res.text()).trim().toLowerCase() === "yes";
      } catch(e){ return false; }
    })();
  }
  return _wsBackendProbe;
}

// ----- 브라우저(IndexedDB) 작업공간 저장소 -----
const WS_IDB_NAME = "manneung-workspace", WS_IDB_STORE = "workspace", WS_IDB_KEY = "payload";
function wsIdbSupported(){ try { return typeof indexedDB !== "undefined" && !!indexedDB; } catch(e){ return false; } }
function wsIdbOpen(){
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(WS_IDB_NAME, 1); } catch(e){ reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WS_IDB_STORE)) db.createObjectStore(WS_IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb-open"));
  });
}
function wsIdbRequest(mode, run){
  return wsIdbOpen().then(db => new Promise((resolve, reject) => {
    let request = null;
    try {
      const tx = db.transaction(WS_IDB_STORE, mode);
      request = run(tx.objectStore(WS_IDB_STORE));
      tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("idb-tx")); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("idb-abort")); };
    } catch(e){ db.close(); reject(e); }
  }));
}
// 페이로드는 Blob 으로 저장 — 큰 묶음도 브라우저가 파일로 내려 메모리를 아낀다.
async function wsIdbGetPayload(){
  const record = await wsIdbRequest("readonly", store => store.get(WS_IDB_KEY));
  if (!record || !record.blob) return null;
  const bytes = new Uint8Array(await record.blob.arrayBuffer());
  return bytes.length ? bytes : null;
}
function wsIdbSetPayload(bytes){
  return wsIdbRequest("readwrite", store => store.put({ blob: new Blob([bytes]), savedAt: Date.now() }, WS_IDB_KEY));
}
function wsIdbClearPayload(){
  return wsIdbRequest("readwrite", store => store.delete(WS_IDB_KEY));
}

// {path, bytes} 행 목록을 작업공간 바이너리 포맷으로 직렬화(decodeWorkspace 의 역방향).
function encodeWorkspaceRows(rows){
  const enc = new TextEncoder();
  const items = rows.map(r => ({ pathBytes: enc.encode(r.path), bytes: r.bytes || new Uint8Array(0) }));
  if (items.length > 10000) throw new Error("workspace-too-many");
  let total = 4;
  for (const it of items){
    total += 8 + it.pathBytes.length + it.bytes.length;
    if (total > WORKSPACE_CAP) throw new Error("workspace-too-large");
  }
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  let pos = 0; view.setUint32(pos, items.length, true); pos += 4;
  for (const it of items){
    view.setUint32(pos, it.pathBytes.length, true); pos += 4;
    out.set(it.pathBytes, pos); pos += it.pathBytes.length;
    view.setUint32(pos, it.bytes.length, true); pos += 4;
    out.set(it.bytes, pos); pos += it.bytes.length;
  }
  return out;
}

// IndexedDB/서버 공용 규칙을 작고 순수한 함수로 둔다. 같은 경로는 새 파일 내용이 우선이고,
// 제거 대상이 없으면 기존 바이트를 그대로 쓴다.
function mergeWorkspacePayloads(previous, incoming){
  if (!previous || !previous.length) return incoming;
  const map = new Map();
  for (const row of decodeWorkspace(previous)) map.set(row.path, row.bytes);
  for (const row of decodeWorkspace(incoming)) map.set(row.path, row.bytes);
  return encodeWorkspaceRows([...map.entries()].map(([path, bytes]) => ({ path, bytes })));
}
function removeWorkspacePayloadPaths(previous, paths){
  if (!previous || !previous.length) return null;
  const drop = new Set(paths || []);
  const rows = decodeWorkspace(previous).filter(row => !drop.has(row.path));
  return rows.length ? encodeWorkspaceRows(rows) : null;
}

// 브라우저 저장: replace=0 이면 서버와 같은 병합 규칙(같은 경로는 새 내용 우선)을 적용한다.
async function browserWorkspaceSave(body, replace){
  if (!replace){
    const prev = await wsIdbGetPayload().catch(() => null);
    if (prev && prev.length) body = mergeWorkspacePayloads(prev, body);
  }
  await wsIdbSetPayload(body);
}
async function browserWorkspaceRemove(paths, clearAll){
  if (clearAll){ await wsIdbClearPayload(); return; }
  const prev = await wsIdbGetPayload().catch(() => null);
  if (!prev || !prev.length) return;
  const next = removeWorkspacePayloadPaths(prev, paths);
  if (!next){ await wsIdbClearPayload(); return; }
  await wsIdbSetPayload(next);
}

function encodeWorkspacePathList(rows){
  const enc = new TextEncoder(), encoded = rows.map(p => enc.encode(p));
  const total = 4 + encoded.reduce((sum, bytes) => sum + 4 + bytes.length, 0);
  const body = new Uint8Array(total), view = new DataView(body.buffer);
  let pos = 0; view.setUint32(pos, encoded.length, true); pos += 4;
  encoded.forEach(bytes => { view.setUint32(pos, bytes.length, true); pos += 4; body.set(bytes, pos); pos += bytes.length; });
  return body;
}

async function mapWithConcurrency(items, limit, mapper){
  const rows = [...(items || [])], results = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    for (;;){
      const index = next++;
      if (index >= rows.length) return;
      results[index] = await mapper(rows[index], index);
    }
  };
  const count = Math.min(rows.length, Math.max(1, limit | 0));
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}

async function flushWorkspaceRemovals(){
  clearTimeout(workspaceRemoveTimer); workspaceRemoveTimer = 0;
  if (!pendingWorkspaceRemovals.size && !workspaceClearPending) return true;
  const clearAll = workspaceClearPending;
  const rows = [...pendingWorkspaceRemovals]; pendingWorkspaceRemovals.clear();
  workspaceClearPending = false;
  workspaceCleanupActive = true;
  setWorkspaceActivity("작업공간 정리 중…");
  try {
    const useServer = await workspaceBackendAvailable();
    return await queueWorkspaceMutation(async () => {
      if (!useServer){ await browserWorkspaceRemove(rows, clearAll); return true; }
      const res = await workspaceFetch(clearAll ? "/workspace-clear" : "/workspace-remove", {
        method: "POST", headers: { "X-PdfSigner-Workspace": "1" },
        ...(clearAll ? {} : { body: encodeWorkspacePathList(rows) })
      });
      if (!res.ok) throw new Error(await res.text());
      return true;
    });
  } catch(e){
    console.warn("workspace remove failed:", e);
    toast("화면에서는 닫았지만 최근 작업공간에서 제거하지 못했어요.", 3500);
    return false;
  } finally {
    workspaceCleanupActive = false;
    setWorkspaceActivity(pendingWorkspaceRemovals.size || workspaceClearPending ? "닫은 파일 정리 대기 중…" : "");
  }
}

async function buildWorkspacePayload(files, folderPaths=[]){
  const enc = new TextEncoder(), rows = [];
  let total = 4;
  for (const file of [...files]){
    const path = String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path) continue;
    const pathBytes = enc.encode(path), size = Number(file.size) || 0;
    total += 8 + pathBytes.length + size;
    if (total > WORKSPACE_CAP) throw new Error("workspace-too-large");
    rows.push({ file, pathBytes, size });
  }
  const seenFolders = new Set();
  for (const value of folderPaths || []){
    const folder = normalizedRunPath(value).replace(/\/+$/, "");
    if (!folder || seenFolders.has(folder)) continue;
    seenFolders.add(folder);
    const marker = workspaceFolderMarkerPath(folder);
    const pathBytes = enc.encode(marker);
    total += 8 + pathBytes.length;
    if (total > WORKSPACE_CAP) throw new Error("workspace-too-large");
    rows.push({ file:null, pathBytes, size:0 });
  }
  if (rows.length > 10000) throw new Error("workspace-too-many");
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  let pos = 0; view.setUint32(pos, rows.length, true); pos += 4;
  for (const row of rows){
    view.setUint32(pos, row.pathBytes.length, true); pos += 4;
    out.set(row.pathBytes, pos); pos += row.pathBytes.length;
    view.setUint32(pos, row.size, true); pos += 4;
    row.dataOffset = pos;
    pos += row.size;
  }
  // 작은 파일이 많은 폴더는 제한된 병렬 읽기로 저장 준비 시간을 줄인다.
  // 큰 파일이 있으면 기존처럼 순차 처리해 순간 메모리 사용량이 치솟지 않게 한다.
  const readConcurrency = rows.some(row => row.size > 16 * 1024 * 1024) ? 1 : 4;
  await mapWithConcurrency(rows.filter(row => row.file), readConcurrency, async (row) => {
    const bytes = new Uint8Array(await row.file.arrayBuffer());
    if (bytes.length !== row.size) throw new Error("workspace-file-changed");
    out.set(bytes, row.dataOffset);
  });
  return out;
}

// 이미지가 아주 많은 묶음(사진 폴더 등)은 자동 복원에 바이트를 넣지 않는다 — 열 때마다
// 수십~수백 MB를 복사·저장하느라 수십 초씩 걸리는 것을 막는다. 폴더 핸들을 IDB 에 보관하므로
// 복원 후 '폴더 새로고침' 한 번(권한 1클릭)이면 디스크에서 그대로 다시 불러온다.
const WS_IMAGE_SKIP_COUNT = 200;
const WS_IMAGE_SKIP_BYTES = 48 * 1024 * 1024;
function isBulkSkippedImageName(name){
  const ext = String(name || "").toLowerCase().split(".").pop() || "";
  return typeof IMG_EXTS !== "undefined" && IMG_EXTS.includes(ext);
}

async function rememberWorkspace(files, replace, options={}){
  const useServer = await workspaceBackendAvailable();
  if (!useServer && !wsIdbSupported()) return false;   // 서버도 IndexedDB 도 없으면 자동 복원 저장 불가
  if (window.__tabActive === false) return false;     // 비활성 탭은 작업공간 자동저장 생략(충돌 방지)
  // 영상·오디오 원본은 자동 복원 묶음에서 제외 — 수백 MB 파일 하나가 전체 저장(256MB 제한)을 막지 않게.
  // 다음 실행에 자동 복원되지 않을 뿐, 폴더 열기나 드래그로 다시 열면 된다.
  let rows = [...files].filter(file => !isMediaFileName(file && file.name));
  const imageRows = rows.filter(file => isBulkSkippedImageName(file && file.name));
  const imageBytes = imageRows.reduce((sum, file) => sum + (Number(file && file.size) || 0), 0);
  let skippedImages = 0;
  let skippedImagePaths = [];
  if (imageRows.length > WS_IMAGE_SKIP_COUNT || imageBytes > WS_IMAGE_SKIP_BYTES){
    skippedImages = imageRows.length;
    // replace=false 저장은 같은 경로가 이번 입력에 없으면 예전 바이트를 그대로 병합한다.
    // 따라서 이미 저장돼 있던 대량 사진도 함께 제거 목록으로 남겨야 다음 실행이 다시 느려지지 않는다.
    skippedImagePaths = imageRows
      .map(file => normalizedRunPath(file && (file.webkitRelativePath || file.name)))
      .filter(Boolean);
    rows = rows.filter(file => !isBulkSkippedImageName(file && file.name));
  }
  const folderPaths = options.folderPaths || [];
  const notifySkippedImages = () => {
    if (!skippedImages) return;
    toast("사진 " + skippedImages.toLocaleString() + "장은 용량이 커서 자동 복원 저장에서 제외했어요. 다음 실행 때는 '폴더 새로고침'으로 다시 불러올 수 있어요.", 4200);
  };
  if (!rows.length && !folderPaths.length){
    // 파일 선택으로 연 사진만 있는 경우에는 새 작업공간 본문을 만들지 않는다.
    // 그래도 과거 자동 복원 기록에 같은 사진이 남아 있으면 다음 실행이 다시 느려지므로 정리한다.
    if (skippedImagePaths.length) forgetWorkspacePaths(skippedImagePaths);
    notifySkippedImages();
    return false;
  }
  const silent = !!options.silent;
  try {
    // A replacement save makes a queued removal redundant. Cancelling it avoids
    // reading and rewriting a large previous ZIP before the new one can open.
    if (replace && !workspaceCleanupActive){
      clearTimeout(workspaceRemoveTimer); workspaceRemoveTimer = 0;
      pendingWorkspaceRemovals.clear(); workspaceClearPending = false;
      setWorkspaceActivity("");
    }
    const waitingForCleanup = workspaceCleanupActive || pendingWorkspaceRemovals.size > 0 || workspaceClearPending;
    const firstMessage = waitingForCleanup ? "닫은 파일 정리 후 작업공간 저장 중…" : "작업공간 저장 중…";
    if (silent) setWorkspaceActivity(firstMessage);
    else showLoading(waitingForCleanup ? "닫은 파일 정리 후 파일을 여는 중…" : "다음 실행을 위해 작업공간 기억하는 중…");
    await flushWorkspaceRemovals();
    if (silent) setWorkspaceActivity("작업공간 저장 중…");
    else updateLoading("다음 실행을 위해 작업공간 기억하는 중…");
    const body = await buildWorkspacePayload(rows, folderPaths);
    if (useServer){
      const res = await queueWorkspaceMutation(() => workspaceFetch("/workspace-save?replace=" + (replace ? "1" : "0"), {
        method: "POST", headers: { "Content-Type": "application/octet-stream", "X-PdfSigner-Workspace": "1" }, body
      }));
      if (!res.ok) throw new Error(await res.text());
    } else {
      await queueWorkspaceMutation(() => browserWorkspaceSave(body, replace));
    }
    // 이전 버전에서 자동 복원 묶음에 들어간 사진은 이번 저장에서 빠졌다고 해서
    // merge 저장만으로 사라지지 않는다. 성공적으로 폴더 표식을 저장한 뒤 경로별로 정리한다.
    if (skippedImagePaths.length) forgetWorkspacePaths(skippedImagePaths);
    notifySkippedImages();
    return true;
  } catch(e){
    const msg = String(e && e.message || e);
    console.warn("workspace save skipped:", e);
    toast(msg.indexOf("too-large") >= 0 ? `파일 묶음이 ${Math.round(WORKSPACE_CAP / (1024 * 1024))}MB를 넘어 자동 복원 저장은 생략했어요.`
      : (e && e.name === "QuotaExceededError") ? "브라우저 저장 공간이 부족해 자동 복원 저장은 생략했어요."
      : "최근 작업공간을 저장하지 못했어요.", 4000);
    return false;
  } finally {
    if (silent) setWorkspaceActivity(pendingWorkspaceRemovals.size || workspaceClearPending ? "닫은 파일 정리 대기 중…" : "");
    else hideLoading();
  }
}

async function readRestoredLocalFile(path){
  if (!(await workspaceBackendAvailable())) return null;   // 저장 폴더 최신본 확인은 EXE 로컬 서버에서만
  if (!/\.(py|pyw|txt|db|sqlite|sqlite3)$/i.test(String(path || ""))) return null;
  try {
    const res = await fetch("/local-file?path=" + encodeURIComponent(path), { cache: "no-store" });
    if (!res.ok || res.status === 204) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.byteLength ? bytes : null;
  } catch(e){
    return null;
  }
}

async function parseWorkspacePayload(buffer){
  const decoded = decodeWorkspace(buffer);
  const folderPaths = [...new Set(decoded
    .map(row => workspaceFolderPathFromMarker(row.path))
    .filter(Boolean))];
  const fileRows = decoded.filter(row => !workspaceFolderPathFromMarker(row.path));
  // 저장 폴더의 최신 파일 확인은 결과 순서를 유지한 채 제한적으로 병렬화한다.
  const rows = await mapWithConcurrency(fileRows, 6, async (row) => {
    const diskBytes = await readRestoredLocalFile(row.path);
    const path = row.path;
    const bytes = diskBytes || row.bytes;
    const name = path.split("/").pop() || "file";
    const file = new File([bytes], name);
    if (path.indexOf("/") >= 0) Object.defineProperty(file, "webkitRelativePath", { value: path });
    return { path, file, syncedFromDisk: !!diskBytes };
  });
  return { rows, folderPaths };
}

async function restoreLastWorkspace(){
  if (!appSettings.autoRestore) return;
  const useServer = await workspaceBackendAvailable();
  if (!useServer && !wsIdbSupported()) return;
  const savedTabs = loadSavedTabState();    // 파일을 열기 전에 저장된 탭 구성을 먼저 읽어둔다
  tabRestoreInProgress = true;
  showLoading("최근 작업공간 확인 중…");
  try {
    let payload = null;
    if (useServer){
      const res = await fetch("/workspace-load", { cache: "no-store" });
      if (!res.ok) return;
      const savedSize = Number(res.headers.get("Content-Length")) || 0;
      if (savedSize > WORKSPACE_CAP){
        await workspaceFetch("/workspace-clear", { method: "POST", headers: { "X-PdfSigner-Workspace": "1" } }).catch(() => {});
        toast("이전 자동 복원 기록이 너무 커서 안전하게 정리했어요. 원본 파일은 영향받지 않습니다.", 5000);
        return;
      }
      payload = await res.arrayBuffer();
    } else {
      payload = await wsIdbGetPayload().catch(() => null);
      if (!payload) return;
      if (payload.length > WORKSPACE_CAP){
        await wsIdbClearPayload().catch(() => {});
        toast("이전 자동 복원 기록이 너무 커서 안전하게 정리했어요. 원본 파일은 영향받지 않습니다.", 5000);
        return;
      }
    }
    const restored = await parseWorkspacePayload(payload);
    const rows = restored.rows;
    const restoredFolderPaths = restored.folderPaths;
    if (!rows.length && !restoredFolderPaths.length) return;
    updateLoading("최근 작업공간 복원 중…");
    beginUiBatch();
    const folderGroups = new Map(), loose = [];
    const ensureFolderGroup = (root) => {
      if (!folderGroups.has(root)) folderGroups.set(root, { files:[], folderPaths:[] });
      return folderGroups.get(root);
    };
    rows.forEach(row => {
      if (row.path.indexOf("/") < 0) loose.push(row.file);
      else {
        const root = row.path.split("/")[0];
        ensureFolderGroup(root).files.push(row.file);
      }
    });
    restoredFolderPaths.forEach(path => {
      const root = path.split("/")[0];
      if (root) ensureFolderGroup(root).folderPaths.push(path);
    });
    for (const group of folderGroups.values())
      // 대량 이미지가 자동 복원 저장에서 제외된 폴더는 빈 트리만 먼저 복원한다.
      // 사용자가 그 루트 폴더를 클릭하면 저장해 둔 폴더 핸들로 실제 파일을 다시 읽는다.
      await openFolderFiles(group.files, { folderPaths:group.folderPaths, restoreFromWorkspace:true });
    if (loose.length){
      let opts = { bulk: loose.length > 1 };
      const siblings = loose.filter(f => !["zip","tar","gz","tgz"].includes((f.name.split(".").pop() || "").toLowerCase()));
      if (siblings.length > 1) opts.archiveCtx = makeFileSiblingCtx(siblings.map(f => ({ file: f, relPath: f.name })), "최근 작업공간");
      await handleFiles(loose, opts);
    }
    toast("지난 작업공간을 자동으로 복원했어요.", 3000);
  } catch(e){ console.warn("workspace restore skipped:", e); }
  finally {
    // 먼저 기존 로딩을 내린 뒤 배치를 풀면, 활성 문서의 지연 렌더 로딩이 그 다음에 안정적으로 유지된다.
    hideLoading();
    endUiBatch();
    applyTabState(savedTabs);   // 파일이 모두 열린 뒤 탭 순서·활성 탭 복원
    restoreStudyState(savedTabs); // 참고·작업 문서 짝도 마지막에 다시 구성
    tabRestoreInProgress = false;
  }
}

async function clearRememberedWorkspace(){
  const useServer = await workspaceBackendAvailable();
  if (!useServer && !wsIdbSupported()){
    toast("이 브라우저에서는 최근 작업공간 저장을 지원하지 않아요.", 2800); return;
  }
  const ok = await confirmDialog("다음 실행 때 자동 복원할 작업공간을 지울까요? 현재 열린 파일은 유지됩니다.", "지우기", "취소");
  if (!ok) return;
  try {
    await flushWorkspaceRemovals();
    if (useServer){
      const res = await queueWorkspaceMutation(() => workspaceFetch("/workspace-clear", { method: "POST", headers: { "X-PdfSigner-Workspace": "1" } }));
      if (!res.ok) throw new Error(await res.text());
    } else {
      await queueWorkspaceMutation(() => wsIdbClearPayload());
    }
    toast("최근 작업공간을 지웠어요.", 2500);
  } catch(e){ toast("최근 작업공간을 지우지 못했어요.", 3000); }
}

function forgetWorkspacePaths(paths, clearAll=false){
  if (!paths || !paths.length) return;
  if ((location.protocol !== "http:" && location.protocol !== "https:") && !wsIdbSupported()) return;
  if (clearAll){
    workspaceClearPending = true;
    pendingWorkspaceRemovals.clear();
  } else if (!workspaceClearPending){
    paths.map(p => String(p || "").replace(/\\/g, "/")).filter(Boolean).forEach(p => pendingWorkspaceRemovals.add(p));
  }
  setWorkspaceActivity("닫은 파일 정리 대기 중…");
  clearTimeout(workspaceRemoveTimer);
  workspaceRemoveTimer = setTimeout(() => { flushWorkspaceRemovals(); }, 80);
}

