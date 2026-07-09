"use strict";

/* ===== EXE 최근 작업공간 저장/복원 ===== */
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
    return await queueWorkspaceMutation(async () => {
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

async function rememberWorkspace(files, replace, options={}){
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;
  if (window.__tabActive === false) return false;     // 비활성 탭은 작업공간 자동저장 생략(충돌 방지)
  // 영상·오디오 원본은 자동 복원 묶음에서 제외 — 수백 MB 파일 하나가 전체 저장(256MB 제한)을 막지 않게.
  // 다음 실행에 자동 복원되지 않을 뿐, 폴더 열기나 드래그로 다시 열면 된다.
  const rows = [...files].filter(file => !isMediaFileName(file && file.name));
  const folderPaths = options.folderPaths || [];
  if (!rows.length && !folderPaths.length) return false;
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
    const res = await queueWorkspaceMutation(() => workspaceFetch("/workspace-save?replace=" + (replace ? "1" : "0"), {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-PdfSigner-Workspace": "1" }, body
    }));
    if (!res.ok) throw new Error(await res.text());
    return true;
  } catch(e){
    const msg = String(e && e.message || e);
    console.warn("workspace save skipped:", e);
    toast(msg.indexOf("too-large") >= 0 ? `파일 묶음이 ${Math.round(WORKSPACE_CAP / (1024 * 1024))}MB를 넘어 자동 복원 저장은 생략했어요.` : "최근 작업공간을 저장하지 못했어요.", 4000);
    return false;
  } finally {
    if (silent) setWorkspaceActivity(pendingWorkspaceRemovals.size || workspaceClearPending ? "닫은 파일 정리 대기 중…" : "");
    else hideLoading();
  }
}

async function readRestoredLocalFile(path){
  if (location.protocol !== "http:" && location.protocol !== "https:") return null;
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
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  if (!appSettings.autoRestore) return;
  const savedTabs = loadSavedTabState();    // 파일을 열기 전에 저장된 탭 구성을 먼저 읽어둔다
  tabRestoreInProgress = true;
  showLoading("최근 작업공간 확인 중…");
  try {
    const res = await fetch("/workspace-load", { cache: "no-store" });
    if (!res.ok) return;
    const savedSize = Number(res.headers.get("Content-Length")) || 0;
    if (savedSize > WORKSPACE_CAP){
      await workspaceFetch("/workspace-clear", { method: "POST", headers: { "X-PdfSigner-Workspace": "1" } }).catch(() => {});
      toast("이전 자동 복원 기록이 너무 커서 안전하게 정리했어요. 원본 파일은 영향받지 않습니다.", 5000);
      return;
    }
    const restored = await parseWorkspacePayload(await res.arrayBuffer());
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
      await openFolderFiles(group.files, { folderPaths:group.folderPaths });
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
    tabRestoreInProgress = false;
  }
}

async function clearRememberedWorkspace(){
  if (location.protocol !== "http:" && location.protocol !== "https:"){
    toast("최근 작업공간 저장은 EXE 실행에서만 사용해요.", 2800); return;
  }
  const ok = await confirmDialog("다음 실행 때 자동 복원할 작업공간을 지울까요? 현재 열린 파일은 유지됩니다.", "지우기", "취소");
  if (!ok) return;
  try {
    await flushWorkspaceRemovals();
    const res = await queueWorkspaceMutation(() => workspaceFetch("/workspace-clear", { method: "POST", headers: { "X-PdfSigner-Workspace": "1" } }));
    if (!res.ok) throw new Error(await res.text());
    toast("최근 작업공간을 지웠어요.", 2500);
  } catch(e){ toast("최근 작업공간을 지우지 못했어요.", 3000); }
}

function forgetWorkspacePaths(paths, clearAll=false){
  if ((location.protocol !== "http:" && location.protocol !== "https:") || !paths || !paths.length) return;
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

