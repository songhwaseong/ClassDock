"use strict";

/* ===== 전체 백업 ZIP 내보내기·복원 =====
   사용자가 원본 파일로 저장하지 않은 작업공간 복구본, 편집 초안, 메모와 사용자 설정을
   하나의 ZIP으로 옮긴다. 파일/폴더 핸들과 OCR 캐시는 다른 PC에서 의미가 없거나 다시
   만들 수 있으므로 포함하지 않는다. */
const MN_BACKUP_MAGIC = "manneung-classroom-backup";
const MN_BACKUP_VERSION = 1;
const MN_BACKUP_MAX_FILE = 1024 * 1024 * 1024;
const MN_BACKUP_ACTIVE_TAB_KEY = "manneung-classroom:active-tab";
const MN_BACKUP_PENDING_RESTORE_KEY = "manneung-backup:pending-restore:v1";

const MN_BACKUP_IDB = [
  { name:"pdf-signer-recovery", stores:["documents", "signatures"], open:() => openPdfRecoveryDb() },
  { name:"manneung-notebook-recovery", stores:["drafts"], open:() => notebookRecoveryOpen() },
  { name:"manneung-scratchpad-assets", stores:["assets"], open:() => openScratchpadAssetDb() },
  { name:"manneung-image-memo-drafts", stores:["state"], open:() => openImageMemoDraftDb() }
];

class MnBackupFormatError extends Error {
  constructor(code){
    super(code);
    this.name = "MnBackupFormatError";
    this.code = code;
  }
}

class MnBackupPreparationError extends Error {
  constructor(failures){
    super("backup-recovery-flush-failed");
    this.name = "MnBackupPreparationError";
    this.code = "backup-recovery-flush-failed";
    this.failures = Array.isArray(failures) ? failures : [];
  }
}

function mnBackupPreparationMessage(error){
  const labels = [...new Set((error && error.failures || [])
    .map(item => String(item && item.label || "").trim())
    .filter(Boolean))];
  const shown = labels.slice(0, 3);
  const target = shown.length ? shown.join(", ") + (labels.length > shown.length ? ` 외 ${labels.length - shown.length}개` : "")
    : "알 수 없는 항목";
  return `미저장 내용을 백업 준비하지 못했어요: ${target}. 문서를 닫지 말고 다시 시도해 주세요.`;
}

function validateMnBackupManifest(manifest){
  if (!manifest || typeof manifest !== "object" || manifest.magic !== MN_BACKUP_MAGIC)
    throw new MnBackupFormatError("not-backup");
  const version = Number(manifest.formatVersion);
  if (!Number.isInteger(version) || version < 1) throw new MnBackupFormatError("damaged");
  if (version > MN_BACKUP_VERSION) throw new MnBackupFormatError("unsupported-version");
  if (!manifest.files || manifest.files.localStorage !== "state/local-storage.json"
      || manifest.files.indexedDb !== "state/indexeddb.json")
    throw new MnBackupFormatError("damaged");
  return manifest;
}

function mnBackupStamp(date=new Date()){
  const pad = value => String(value).padStart(2, "0");
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + "-"
    + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

function mnBackupDownload(blob, name){
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function mnBackupByteLength(text){
  return new TextEncoder().encode(String(text || "")).length;
}

async function mnBackupNeedZip(){
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("jszip");
  if (typeof JSZip === "undefined") throw new Error("zip-library-unavailable");
}

async function mnBackupLoadZip(bytes){
  await mnBackupNeedZip();
  try {
    if (typeof JSZip.loadAsync === "function") return await JSZip.loadAsync(bytes);
    return new JSZip(bytes);
  } catch(_){
    throw new MnBackupFormatError("not-backup");
  }
}

async function mnBackupZipText(zip, path){
  const entry = zip.file(path);
  if (!entry) throw new MnBackupFormatError("damaged");
  try {
    return typeof entry.async === "function" ? await entry.async("string") : entry.asText();
  } catch(_){
    throw new MnBackupFormatError("damaged");
  }
}

async function mnBackupZipBytes(zip, path){
  const entry = zip.file(path);
  if (!entry) throw new MnBackupFormatError("damaged");
  try {
    const value = typeof entry.async === "function" ? await entry.async("uint8array") : entry.asUint8Array();
    return value instanceof Uint8Array ? value : new Uint8Array(value);
  } catch(_){
    throw new MnBackupFormatError("damaged");
  }
}

async function mnBackupGenerateZip(zip){
  if (typeof zip.generateAsync === "function")
    return zip.generateAsync({ type:"blob", compression:"STORE" });
  return zip.generate({ type:"blob", compression:"STORE" });
}

function mnBackupOpenDb(name){
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexeddb-open-failed"));
  });
}

async function mnBackupEnsureDbs(){
  for (const item of MN_BACKUP_IDB){
    try { await item.open(); } catch(error){ console.warn("backup database init skipped:", item.name, error); }
  }
}

async function mnBackupReadStore(dbName, storeName){
  const db = await mnBackupOpenDb(dbName);
  try {
    if (!db.objectStoreNames.contains(storeName)) return { keyPath:null, rows:[] };
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      tx.oncomplete = () => resolve({
        keyPath:store.keyPath == null ? null : store.keyPath,
        rows:(valuesRequest.result || []).map((value, index) => ({
          key:(keysRequest.result || [])[index],
          value
        }))
      });
      tx.onerror = () => reject(tx.error || new Error("indexeddb-read-failed"));
      tx.onabort = tx.onerror;
    });
  } finally {
    db.close();
  }
}

async function mnBackupWriteStore(dbName, storeName, dump){
  const db = await mnBackupOpenDb(dbName);
  try {
    if (!db.objectStoreNames.contains(storeName)) throw new MnBackupFormatError("damaged");
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      store.clear();
      for (const row of dump.rows || []){
        if (store.keyPath == null) store.put(row.value, row.key);
        else store.put(row.value);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("indexeddb-write-failed"));
      tx.onabort = tx.onerror;
    });
  } finally {
    db.close();
  }
}

async function mnBackupEncodeValue(value, zip, context, hint){
  if (value === undefined) return { __mnType:"undefined" };
  if (typeof value === "number" && !Number.isFinite(value))
    return { __mnType:"number", value:String(value) };
  if (value instanceof Date) return { __mnType:"date", value:value.toISOString() };
  if (typeof Blob !== "undefined" && value instanceof Blob){
    const path = "binary/" + String(context.nextBinary++).padStart(6, "0") + ".bin";
    const bytes = new Uint8Array(await value.arrayBuffer());
    zip.file(path, bytes);
    context.binaryBytes += bytes.length;
    return {
      __mnType:typeof File !== "undefined" && value instanceof File ? "file" : "blob",
      path,
      mime:String(value.type || ""),
      name:typeof value.name === "string" ? value.name : String(hint || ""),
      lastModified:Number(value.lastModified) || 0,
      size:bytes.length
    };
  }
  if (value instanceof ArrayBuffer){
    const path = "binary/" + String(context.nextBinary++).padStart(6, "0") + ".bin";
    const bytes = new Uint8Array(value);
    zip.file(path, bytes);
    context.binaryBytes += bytes.length;
    return { __mnType:"arraybuffer", path, size:bytes.length };
  }
  if (ArrayBuffer.isView(value)){
    const path = "binary/" + String(context.nextBinary++).padStart(6, "0") + ".bin";
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    zip.file(path, bytes);
    context.binaryBytes += bytes.length;
    return { __mnType:"typedarray", path, ctor:value.constructor.name, size:bytes.length };
  }
  if (Array.isArray(value)){
    const out = [];
    for (let index = 0; index < value.length; index++)
      out.push(await mnBackupEncodeValue(value[index], zip, context, hint + "-" + index));
    return out;
  }
  if (value && typeof value === "object"){
    const out = {};
    for (const key of Object.keys(value))
      out[key] = await mnBackupEncodeValue(value[key], zip, context, key);
    return out;
  }
  return value;
}

async function mnBackupDecodeValue(value, zip){
  if (Array.isArray(value)){
    const out = [];
    for (const item of value) out.push(await mnBackupDecodeValue(item, zip));
    return out;
  }
  if (!value || typeof value !== "object") return value;
  if (value.__mnType === "undefined") return undefined;
  if (value.__mnType === "number"){
    if (value.value === "NaN") return NaN;
    return value.value === "Infinity" ? Infinity : -Infinity;
  }
  if (value.__mnType === "date") return new Date(value.value);
  if (["blob", "file", "arraybuffer", "typedarray"].includes(value.__mnType)){
    const path = String(value.path || "");
    if (!/^binary\/\d{6}\.bin$/.test(path)) throw new MnBackupFormatError("damaged");
    const bytes = await mnBackupZipBytes(zip, path);
    if (Number(value.size) !== bytes.length) throw new MnBackupFormatError("damaged");
    if (value.__mnType === "blob") return new Blob([bytes], { type:String(value.mime || "") });
    if (value.__mnType === "file")
      return new File([bytes], String(value.name || "backup-file"), {
        type:String(value.mime || ""), lastModified:Number(value.lastModified) || Date.now()
      });
    if (value.__mnType === "arraybuffer") return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const ctor = globalThis[String(value.ctor || "")];
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return typeof ctor === "function" && ctor.BYTES_PER_ELEMENT ? new ctor(buffer) : new Uint8Array(buffer);
  }
  const out = {};
  for (const key of Object.keys(value)) out[key] = await mnBackupDecodeValue(value[key], zip);
  return out;
}

function mnBackupLocalStorageSnapshot(){
  const snapshot = {};
  for (let index = 0; index < localStorage.length; index++){
    const key = localStorage.key(index);
    if (key == null || key === MN_BACKUP_ACTIVE_TAB_KEY || key === MN_BACKUP_PENDING_RESTORE_KEY) continue;
    snapshot[key] = localStorage.getItem(key);
  }
  return snapshot;
}

async function mnBackupGetWorkspace(){
  const useServer = await workspaceBackendAvailable();
  if (typeof flushWorkspaceRemovals === "function") await flushWorkspaceRemovals();
  if (typeof workspaceMutationQueue !== "undefined") await workspaceMutationQueue;
  if (useServer){
    const response = await fetch("/workspace-load", { cache:"no-store" });
    if (!response.ok) throw new Error("workspace-read-failed");
    return new Uint8Array(await response.arrayBuffer());
  }
  const payload = await wsIdbGetPayload().catch(() => null);
  return payload ? new Uint8Array(payload) : new Uint8Array(0);
}

async function mnBackupRestoreWorkspace(bytes, present){
  const useServer = await workspaceBackendAvailable();
  if (!present || !bytes.length){
    if (useServer){
      const response = await fetch("/workspace-clear", {
        method:"POST", headers:{ "X-PdfSigner-Workspace":"1" }
      });
      if (!response.ok) throw new Error("workspace-clear-failed");
    } else await wsIdbClearPayload();
    return;
  }
  if (bytes.length > WORKSPACE_CAP) throw new MnBackupFormatError("damaged");
  await parseWorkspacePayload(bytes);
  if (useServer){
    const response = await fetch("/workspace-save?replace=1", {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream", "X-PdfSigner-Workspace":"1" },
      body:bytes
    });
    if (!response.ok) throw new Error("workspace-write-failed");
  } else await wsIdbSetPayload(bytes);
}

async function mnBackupFlushUnsaved(){
  // 자동복원 설정이 꺼져 있던 경우에도 편집 복구본의 바탕이 되는 원본 파일을 함께 넣는다.
  // 그 뒤 각 편집기 훅이 같은 경로를 최신 미저장 바이트로 다시 덮어쓴다.
  const failures = [];
  const runFlush = async (label, task) => {
    try {
      const result = await task();
      if (result === false) failures.push({ label });
    } catch(error){
      console.warn("backup recovery flush skipped:", label, error);
      failures.push({ label, error });
    }
  };
  const sourceFiles = [...docs].map(doc => doc && doc.sourceFile).filter(file => file instanceof File);
  if (sourceFiles.length && typeof rememberWorkspace === "function"){
    const hasEligibleFiles = typeof workspaceHasBackupEligibleFiles !== "function"
      || workspaceHasBackupEligibleFiles(sourceFiles);
    await runFlush("열린 파일 작업공간", async () => {
      const result = await rememberWorkspace(sourceFiles, false, { silent:true });
      return result === false && !hasEligibleFiles ? true : result;
    });
  }
  const tasks = [];
  for (const doc of [...docs]){
    const label = String(doc && doc.name || "이름 없는 문서");
    try {
      if (!doc.hasUnsavedEdits) continue;
      if (doc.kind === "board" && typeof doc.flushBoardRecovery === "function")
        tasks.push({ label, task:() => doc.flushBoardRecovery() });
      if (doc.kind === "pdf" && doc.recoveryKey && typeof savePdfRecovery === "function")
        tasks.push({ label, task:() => savePdfRecovery(doc, { force:true }) });
      if (typeof doc.flushBackupRecovery === "function")
        tasks.push({ label, task:() => doc.flushBackupRecovery() });
      else if (doc.notebookModel && typeof notebookSaveRecovery === "function")
        tasks.push({ label, task:() => notebookSaveRecovery(doc) });
    } catch(error){
      console.warn("backup editor flush skipped:", label, error);
      failures.push({ label, error });
    }
  }
  if (typeof window.flushScratchpadBackup === "function")
    tasks.push({ label:"메모", task:() => window.flushScratchpadBackup() });
  if (typeof window.flushImageMemoBackup === "function")
    tasks.push({ label:"이미지 메모", task:() => window.flushImageMemoBackup() });
  await Promise.all(tasks.map(item => runFlush(item.label, item.task)));
  if (failures.length){
    console.warn("backup recovery flush failed:", failures);
    throw new MnBackupPreparationError(failures);
  }
  if (typeof workspaceMutationQueue !== "undefined") await workspaceMutationQueue;
}

async function mnBackupExport(){
  if (window.__tabActive === false){
    toast("현재 활성 창에서만 백업할 수 있어요.", 2800, { type:"error" });
    return false;
  }
  if (typeof showLoading === "function") showLoading("미저장 작업을 백업 준비 중…");
  try {
    await mnBackupFlushUnsaved();
    await mnBackupNeedZip();
    const zip = new JSZip();
    const context = { nextBinary:1, binaryBytes:0 };
    const workspace = await mnBackupGetWorkspace();
    if (workspace.length) zip.file("state/workspace.bin", workspace);

    const localStorageSnapshot = mnBackupLocalStorageSnapshot();
    const localStorageText = JSON.stringify(localStorageSnapshot);
    zip.file("state/local-storage.json", localStorageText);

    await mnBackupEnsureDbs();
    const dbDumps = [];
    for (const item of MN_BACKUP_IDB){
      const stores = [];
      for (const storeName of item.stores){
        const dump = await mnBackupReadStore(item.name, storeName);
        const rows = [];
        for (const row of dump.rows){
          rows.push({
            key:await mnBackupEncodeValue(row.key, zip, context, item.name + "-" + storeName + "-key"),
            value:await mnBackupEncodeValue(row.value, zip, context, item.name + "-" + storeName + "-value")
          });
        }
        stores.push({ name:storeName, keyPath:dump.keyPath, rows });
      }
      dbDumps.push({ name:item.name, stores });
    }
    const indexedDbText = JSON.stringify({ databases:dbDumps });
    zip.file("state/indexeddb.json", indexedDbText);

    const openBoards = [...docs].filter(doc => doc.kind === "board").map(doc => String(doc.name || ""));
    const manifest = {
      magic:MN_BACKUP_MAGIC,
      formatVersion:MN_BACKUP_VERSION,
      createdAt:new Date().toISOString(),
      files:{
        localStorage:"state/local-storage.json",
        indexedDb:"state/indexeddb.json",
        workspace:workspace.length ? "state/workspace.bin" : null
      },
      workspacePresent:workspace.length > 0,
      openBoards,
      uncompressedBytes:workspace.length + context.binaryBytes
        + mnBackupByteLength(localStorageText) + mnBackupByteLength(indexedDbText)
    };
    zip.file("backup-manifest.json", JSON.stringify(manifest, null, 2));
    if (typeof updateLoading === "function") updateLoading("백업 ZIP 만드는 중…");
    await new Promise(resolve => setTimeout(resolve, 0));
    const blob = await mnBackupGenerateZip(zip);
    mnBackupDownload(blob, "만능파일교실-백업_" + mnBackupStamp() + ".zip");
    toast("전체 백업 ZIP을 만들었어요.", 2800, { type:"success" });
    return true;
  } catch(error){
    console.error("backup export failed:", error);
    toast(error && error.code === "backup-recovery-flush-failed"
      ? mnBackupPreparationMessage(error)
      : "백업 ZIP을 만들지 못했어요. 저장 공간과 메모리를 확인해 주세요.", 5600, { type:"error" });
    return false;
  } finally {
    if (typeof hideLoading === "function") hideLoading();
  }
}

function mnBackupFormatMessage(error){
  const code = error && error.code;
  if (code === "unsupported-version")
    return "이 백업은 더 최신 버전의 만능파일교실에서 만들어졌습니다. 프로그램을 업데이트한 뒤 다시 시도해 주세요.";
  if (code === "damaged")
    return "백업 ZIP이 손상되었거나 필수 데이터가 없습니다. 다른 백업 파일을 선택해 주세요.";
  return "만능파일교실에서 만든 백업 ZIP이 아닙니다. 올바른 백업 파일을 선택해 주세요.";
}

async function mnBackupParseRestore(file){
  if (!file || file.size <= 0 || file.size > MN_BACKUP_MAX_FILE)
    throw new MnBackupFormatError("not-backup");
  const zip = await mnBackupLoadZip(await file.arrayBuffer());
  let manifest;
  try { manifest = JSON.parse(await mnBackupZipText(zip, "backup-manifest.json")); }
  catch(_){ throw new MnBackupFormatError("not-backup"); }
  validateMnBackupManifest(manifest);
  let localStorageData, indexedDbData;
  try {
    localStorageData = JSON.parse(await mnBackupZipText(zip, manifest.files.localStorage));
    indexedDbData = JSON.parse(await mnBackupZipText(zip, manifest.files.indexedDb));
  } catch(_){ throw new MnBackupFormatError("damaged"); }
  if (!localStorageData || typeof localStorageData !== "object" || Array.isArray(localStorageData)
      || !indexedDbData || !Array.isArray(indexedDbData.databases))
    throw new MnBackupFormatError("damaged");
  let workspace = new Uint8Array(0);
  if (manifest.workspacePresent){
    if (manifest.files.workspace !== "state/workspace.bin") throw new MnBackupFormatError("damaged");
    workspace = await mnBackupZipBytes(zip, manifest.files.workspace);
    if (!workspace.length || workspace.length > WORKSPACE_CAP) throw new MnBackupFormatError("damaged");
    try { await parseWorkspacePayload(workspace); }
    catch(_){ throw new MnBackupFormatError("damaged"); }
  }
  return { zip, manifest, localStorageData, indexedDbData, workspace };
}

function mnBackupValidateDbDump(data){
  const allowed = new Map(MN_BACKUP_IDB.map(item => [item.name, new Set(item.stores)]));
  const seen = new Set();
  for (const db of data.databases){
    if (!db || !allowed.has(db.name) || !Array.isArray(db.stores) || seen.has(db.name))
      throw new MnBackupFormatError("damaged");
    seen.add(db.name);
    const stores = allowed.get(db.name);
    const seenStores = new Set();
    for (const store of db.stores){
      if (!store || !stores.has(store.name) || !Array.isArray(store.rows) || seenStores.has(store.name))
        throw new MnBackupFormatError("damaged");
      seenStores.add(store.name);
    }
    if (seenStores.size !== stores.size) throw new MnBackupFormatError("damaged");
  }
  if (seen.size !== allowed.size) throw new MnBackupFormatError("damaged");
}

function mnBackupReplaceLocalStorage(snapshot, openBoards){
  const activeTab = localStorage.getItem(MN_BACKUP_ACTIVE_TAB_KEY);
  localStorage.clear();
  for (const key of Object.keys(snapshot)){
    if (key === MN_BACKUP_ACTIVE_TAB_KEY || key === MN_BACKUP_PENDING_RESTORE_KEY) continue;
    if (typeof snapshot[key] !== "string") throw new MnBackupFormatError("damaged");
    localStorage.setItem(key, snapshot[key]);
  }
  if (activeTab != null) localStorage.setItem(MN_BACKUP_ACTIVE_TAB_KEY, activeTab);
  localStorage.setItem(MN_BACKUP_PENDING_RESTORE_KEY, JSON.stringify({
    restoredAt:Date.now(),
    boards:Array.isArray(openBoards) ? openBoards.map(String) : []
  }));
}

async function mnBackupPushAppState(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const snapshot = {};
  for (let index = 0; index < localStorage.length; index++){
    const key = localStorage.key(index);
    if (key != null) snapshot[key] = localStorage.getItem(key);
  }
  try {
    await fetch("/app-state", {
      method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(snapshot)
    });
  } catch(_){}
}

async function mnBackupRestore(file){
  let parsed;
  if (typeof showLoading === "function") showLoading("백업 ZIP 확인 중…");
  try {
    parsed = await mnBackupParseRestore(file);
    mnBackupValidateDbDump(parsed.indexedDbData);
    for (const key of Object.keys(parsed.localStorageData)){
      if (typeof parsed.localStorageData[key] !== "string") throw new MnBackupFormatError("damaged");
    }
    parsed.decodedDatabases = [];
    for (const dbDump of parsed.indexedDbData.databases){
      const decodedStores = [];
      for (const storeDump of dbDump.stores){
        const decodedRows = [];
        for (const row of storeDump.rows){
          decodedRows.push({
            key:await mnBackupDecodeValue(row.key, parsed.zip),
            value:await mnBackupDecodeValue(row.value, parsed.zip)
          });
        }
        decodedStores.push({ name:storeDump.name, rows:decodedRows });
      }
      parsed.decodedDatabases.push({ name:dbDump.name, stores:decodedStores });
    }
  } catch(error){
    console.warn("backup validation failed:", error);
    toast(mnBackupFormatMessage(error), 5200, { type:"error" });
    return false;
  } finally {
    if (typeof hideLoading === "function") hideLoading();
  }

  const created = parsed.manifest.createdAt ? new Date(parsed.manifest.createdAt).toLocaleString() : "날짜 정보 없음";
  const ok = await confirmDialog(
    "이 백업(" + created + ")으로 복원할까요?\n\n현재의 미저장 작업·메모·복구 데이터와 설정이 백업 내용으로 교체됩니다.",
    "복원", "취소"
  );
  if (!ok) return false;

  if (typeof showLoading === "function") showLoading("백업 내용 복원 중…");
  try {
    await mnBackupEnsureDbs();
    for (const dbDump of parsed.decodedDatabases){
      for (const storeDump of dbDump.stores){
        await mnBackupWriteStore(dbDump.name, storeDump.name, storeDump);
      }
    }
    await mnBackupRestoreWorkspace(parsed.workspace, !!parsed.manifest.workspacePresent);
    mnBackupReplaceLocalStorage(parsed.localStorageData, parsed.manifest.openBoards);
    await mnBackupPushAppState();
    toast("백업을 복원했어요. 프로그램을 다시 불러옵니다.", 2600, { type:"success" });
    setTimeout(() => location.reload(), 700);
    return true;
  } catch(error){
    console.error("backup restore failed:", error);
    toast(error instanceof MnBackupFormatError ? mnBackupFormatMessage(error)
      : "백업을 복원하지 못했어요. 현재 데이터는 가능한 범위에서 유지됩니다.", 5200, { type:"error" });
    return false;
  } finally {
    if (typeof hideLoading === "function") hideLoading();
  }
}

function mnBackupHasPendingRestore(){
  try { return !!localStorage.getItem(MN_BACKUP_PENDING_RESTORE_KEY); } catch(_){ return false; }
}

function mnBackupFinishPendingRestore(){
  let pending = null;
  try {
    pending = JSON.parse(localStorage.getItem(MN_BACKUP_PENDING_RESTORE_KEY) || "null");
    localStorage.removeItem(MN_BACKUP_PENDING_RESTORE_KEY);
  } catch(_){}
  const boards = Array.isArray(pending && pending.boards) ? pending.boards : [];
  let count = boards.length;
  for (const name of boards){
    const match = /^화이트보드(?: (\d+))?$/.exec(String(name || ""));
    if (match) count = Math.max(count, Number(match[1]) || 1);
  }
  for (let index = 0; index < count; index++){
    try { newWhiteboard(); } catch(error){ console.warn("backup board restore skipped:", error); break; }
  }
}

const MNBackup = Object.freeze({
  exportBackup:mnBackupExport,
  restoreBackup:mnBackupRestore,
  hasPendingRestore:mnBackupHasPendingRestore,
  finishPendingRestore:mnBackupFinishPendingRestore,
  validateManifest:validateMnBackupManifest
});

if (typeof module === "object" && module.exports){
  module.exports = {
    MN_BACKUP_MAGIC, MN_BACKUP_VERSION, MnBackupFormatError, MnBackupPreparationError,
    validateMnBackupManifest, mnBackupStamp, mnBackupPreparationMessage
  };
}
