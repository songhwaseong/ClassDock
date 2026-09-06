"use strict";

/* ===== 전체 백업 ZIP 내보내기·복원 =====
   사용자가 원본 파일로 저장하지 않은 작업공간 복구본, 편집 초안, 메모와 사용자 설정을
   하나의 ZIP으로 옮긴다. 파일/폴더 핸들과 OCR 캐시는 다른 PC에서 의미가 없거나 다시
   만들 수 있으므로 포함하지 않는다. */
const MN_BACKUP_MAGIC = "classdock-backup";
const MN_BACKUP_VERSION = 2;
const MN_BACKUP_MAX_FILE = 1024 * 1024 * 1024;
const MN_BACKUP_ACTIVE_TAB_KEY = "classdock:active-tab";
const MN_BACKUP_PENDING_RESTORE_KEY = "classdock-backup:pending-restore:v1";
/* 백업에 넣지도, 복원할 때 건드리지도 않는 "이 창·이 PC 전용" 설정.
   · active-tab   : 여러 창 중 누가 활성인지 — 다른 PC 의 값을 덮으면 한쪽이 멈춘다.
   · 화면보호기 영상 이름: 영상 자체(mnScreensaver IndexedDB)는 수백 MB 라 백업하지 않는다.
     이름만 옮기면 설정에는 목록이 보이는데 재생은 내장 애니메이션으로 떨어져 거짓말이 된다.
     그래서 양쪽 모두 — 내보낼 때도, 복원할 때도 — 이 PC 의 값을 그대로 둔다. */
const MN_BACKUP_LOCAL_ONLY_KEYS = [
  MN_BACKUP_ACTIVE_TAB_KEY,
  "mnScreensaverVideoNames",
  "mnScreensaverVideoName",
  "classdock-diagnostics:events:v1",
  "classdock-diagnostics:session:v1"
];

function mnBackupIsLocalOnlyKey(key){
  return key === MN_BACKUP_PENDING_RESTORE_KEY || MN_BACKUP_LOCAL_ONLY_KEYS.includes(key);
}

const MN_BACKUP_IDB = [
  { name:"classdock-recovery", stores:["documents", "signatures"], open:() => openPdfRecoveryDb() },
  { name:"classdock-notebook-recovery", stores:["drafts"], open:() => notebookRecoveryOpen() },
  { name:"classdock-scratchpad-assets", stores:["assets"], open:() => openScratchpadAssetDb() },
  { name:"classdock-image-memo-drafts", stores:["state"], open:() => openImageMemoDraftDb() }
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

function mnBackupOpenBoardDescriptor(raw){
  if (!raw || typeof raw !== "object") return String(raw || "");
  const name = String(raw.name || "").trim();
  const recoveryName = String(raw.recoveryName || "").trim();
  const memoBlockId = String(raw.memoBlockId || "").trim();
  return recoveryName ? { name:name || "화이트보드", recoveryName, memoBlockId } : name;
}

/* 열려 있는 화이트보드를 가리키는 이름 — 복구본을 찾는 열쇠와 같다(whiteboard.js 의 recoveryName). */
function mnBackupBoardIdentity(doc){
  return String(doc && (doc.boardRecoveryName || doc.name) || "").trim();
}

/* 매니페스트의 보드 목록에서 "아직 없는 것"만 골라 newWhiteboard 옵션으로 돌려준다.
   탭 상태(classdock-tabs:v1)와 작업공간 기록에도 화이트보드가 남아, 복원 직후의
   자동 복원이 이미 보드를 되살린다(restoreSavedWorkspaceWhiteboards·restoreSavedWhiteboards).
   그것을 모르고 다시 만들면 같은 판서가 두 벌로 열리므로 여기서 걸러낸다.
   옵션을 안 남기던 예전 백업(이름 문자열만 들어 있는 경우)도 그대로 받는다. */
function mnBackupMissingBoards(rawBoards, openedNames){
  const seen = new Set((openedNames || []).map(value => String(value || "").trim()).filter(Boolean));
  const out = [];
  for (const raw of (Array.isArray(rawBoards) ? rawBoards : [])){
    const board = mnBackupOpenBoardDescriptor(raw);
    const options = typeof board === "string"
      ? { name:board }
      : { name:board.name, recoveryName:board.recoveryName, memoBlockId:board.memoBlockId };
    const key = String(options.recoveryName || options.name || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(options);
  }
  return out;
}

function mnBackupDownload(blob, name){
  // 전체 백업 ZIP 은 수백 MB 가 될 수 있어 해제까지의 틈을 기본값보다 길게 준다.
  MNDownload.saveBlob(blob, name, { revokeAfterMs:1500 });
}

function mnBackupByteLength(text){
  return new TextEncoder().encode(String(text || "")).length;
}

/* 백업 ZIP 은 무압축(STORE)이라 작업공간·메모 그림이 그대로 들어가 수백 MB 가 될 수 있다.
   JSZip 2.6.1 의 generate 는 동기라 그만한 크기에서 화면이 통째로 멈추고 메모리도 두 배로
   든다. 백업만 이미 들어 있는 3.x(generateAsync·loadAsync)를 쓰고, 어떤 이유로든 못 실으면
   예전처럼 2.6.1 로 물러선다(작은 백업은 그것으로도 된다). */
async function mnBackupZipLib(){
  if (typeof MNLazy !== "undefined"){
    if (await MNLazy.tryNeed("jszipModern")){
      const modern = typeof MNLazy.modernZip === "function" ? MNLazy.modernZip() : null;
      if (typeof modern === "function") return modern;
    }
    await MNLazy.tryNeed("jszip");
  }
  if (typeof JSZip === "undefined") throw new Error("zip-library-unavailable");
  return JSZip;
}

async function mnBackupLoadZip(bytes){
  const Zip = await mnBackupZipLib();
  try {
    if (typeof Zip.loadAsync === "function") return await Zip.loadAsync(bytes);
    return new Zip(bytes);
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
  if (typeof zip.generateAsync === "function"){
    // 3.x 는 조금씩 끊어 만들며 진행률을 알려준다 — 큰 백업에서 "멈췄나" 싶지 않게 로딩에 보인다.
    return zip.generateAsync({ type:"blob", compression:"STORE" }, metadata => {
      const percent = Number(metadata && metadata.percent);
      if (typeof updateLoading === "function" && Number.isFinite(percent))
        updateLoading("백업 ZIP 만드는 중… " + Math.round(percent) + "%");
    });
  }
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
    if (key == null || mnBackupIsLocalOnlyKey(key)) continue;
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
        method:"POST", headers:{ "X-ClassDock-Workspace":"1" }
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
      headers:{ "Content-Type":"application/octet-stream", "X-ClassDock-Workspace":"1" },
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
      // 화이트보드는 ● 를 켜지 않는(자동 저장) 문서라 hasUnsavedEdits 로 거를 수 없다.
      // 백업에 마지막 판서까지 담기도록 dirty 판정 앞에서 항상 흘려보낸다(localStorage 쓰기 한 번).
      if (doc.kind === "board" && typeof doc.flushBoardRecovery === "function")
        tasks.push({ label, task:() => doc.flushBoardRecovery() });
      if (!doc.hasUnsavedEdits) continue;
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
    const Zip = await mnBackupZipLib();
    const zip = new Zip();
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

    const openBoards = [...docs].filter(doc => doc.kind === "board").map(doc =>
      doc.boardRecoveryName ? {
        name:String(doc.name || "화이트보드"),
        recoveryName:String(doc.boardRecoveryName),
        memoBlockId:String(doc.memoBlockId || "")
      } : String(doc.name || "")
    );
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
    mnBackupDownload(blob, "ClassDock-백업_" + mnBackupStamp() + ".zip");
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
    return "이 백업은 더 최신 버전의 ClassDock에서 만들어졌습니다. 프로그램을 업데이트한 뒤 다시 시도해 주세요.";
  if (code === "damaged")
    return "백업 ZIP이 손상되었거나 필수 데이터가 없습니다. 다른 백업 파일을 선택해 주세요.";
  return "ClassDock에서 만든 백업 ZIP이 아닙니다. 올바른 백업 파일을 선택해 주세요.";
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

/* 복원하는 동안 앱이 스스로 남기는 localStorage 자동 저장을 멈춘다.
   확인을 누른 뒤 새로고침까지는 짧은 사이지만, 그 동안도 판서 복구본(0.5초)·탭 구성(0.4초)·
   메모(0.35초) 타이머가 제각기 돌고 있다. 그대로 두면 방금 되돌린 내용을 복원 전 상태가
   덮어써, 백업에 없던 탭이 다시 살아난다(e2e 로 재현된 실제 증상이다).
   읽기는 그대로 두고 쓰기만 막으며, 복원 코드 자신은 보관한 원래 함수(write)로 쓴다.
   성공하면 그대로 새로고침하므로 되돌릴 필요가 없고, 실패하면 resume() 으로 앱을 되돌린다. */
function mnBackupPauseLocalStorage(){
  const storage = localStorage;
  const prototype = Object.getPrototypeOf(storage);
  const methods = ["setItem", "removeItem", "clear"];
  const write = Object.fromEntries(methods.map(key => [key, storage[key].bind(storage)]));
  const replaced = [];
  const resume = () => {
    while (replaced.length){
      const [key, descriptor] = replaced[replaced.length - 1];
      Object.defineProperty(prototype, key, descriptor);
      replaced.pop();
    }
  };
  // Storage 인스턴스에 함수를 대입하면 메서드가 아니라 문자열 저장 키가 생긴다.
  // 프로토타입에서 가로채되 sessionStorage 등 다른 저장소의 호출은 그대로 통과시킨다.
  try {
    for (const key of methods){
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (!descriptor || typeof descriptor.value !== "function") throw new Error("storage-pause-unavailable");
      const original = descriptor.value;
      Object.defineProperty(prototype, key, {
        ...descriptor,
        value:function(...args){
          if (this === storage) return;
          return original.apply(this, args);
        }
      });
      replaced.push([key, descriptor]);
    }
  } catch(error){
    resume();
    throw error; // 차단에 실패하면 데이터를 교체하기 전에 복원을 중단한다.
  }
  return {
    write,
    paused:() => replaced.length > 0,
    resume
  };
}

function mnBackupReplaceLocalStorage(snapshot, openBoards, io){
  // 자동 저장을 멈춰 두었으면 그 때 받아 둔 원래 함수로 쓴다(멈추기 전이면 그냥 localStorage).
  const write = (io && io.write) || localStorage;
  // 이 PC 전용 설정은 지우기 전에 따로 떠 두었다가 그대로 되돌려 놓는다.
  const preserved = MN_BACKUP_LOCAL_ONLY_KEYS
    .map(key => [key, localStorage.getItem(key)])
    .filter(([, value]) => value != null);
  write.clear();
  for (const key of Object.keys(snapshot)){
    if (mnBackupIsLocalOnlyKey(key)) continue;
    if (typeof snapshot[key] !== "string") throw new MnBackupFormatError("damaged");
    write.setItem(key, snapshot[key]);
  }
  for (const [key, value] of preserved) write.setItem(key, value);
  write.setItem(MN_BACKUP_PENDING_RESTORE_KEY, JSON.stringify({
    restoredAt:Date.now(),
    boards:Array.isArray(openBoards) ? openBoards.map(mnBackupOpenBoardDescriptor).filter(board =>
      typeof board === "string" ? !!board : !!board.recoveryName
    ) : []
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

let mnBackupRestoreInProgress = false;

async function mnBackupRestore(file){
  if (mnBackupRestoreInProgress) return false;
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
  if (!ok || mnBackupRestoreInProgress) return false;

  if (typeof showLoading === "function") showLoading("백업 내용 복원 중…");
  let io;
  try {
    // 차단을 설치하지 못하면 저장소를 건드리지 않고 아래 실패 처리로 간다.
    io = mnBackupPauseLocalStorage();
    mnBackupRestoreInProgress = true;
    await mnBackupEnsureDbs();
    for (const dbDump of parsed.decodedDatabases){
      for (const storeDump of dbDump.stores){
        await mnBackupWriteStore(dbDump.name, storeDump.name, storeDump);
      }
    }
    await mnBackupRestoreWorkspace(parsed.workspace, !!parsed.manifest.workspacePresent);
    mnBackupReplaceLocalStorage(parsed.localStorageData, parsed.manifest.openBoards, io);
    await mnBackupPushAppState();
    toast("백업을 복원했어요. 프로그램을 다시 불러옵니다.", 2600, { type:"success" });
    setTimeout(() => location.reload(), 700);
    return true;
  } catch(error){
    if (io) io.resume();
    mnBackupRestoreInProgress = false;
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
  if (typeof newWhiteboard !== "function") return;
  const opened = (typeof docs === "undefined" ? [] : [...docs])
    .filter(doc => doc && doc.kind === "board")
    .map(mnBackupBoardIdentity);
  for (const options of mnBackupMissingBoards(pending && pending.boards, opened)){
    try { newWhiteboard(options); }
    catch(error){ console.warn("backup board restore skipped:", error); }
  }
}

const MNBackup = Object.freeze({
  exportBackup:mnBackupExport,
  restoreBackup:mnBackupRestore,
  isRestoring:() => mnBackupRestoreInProgress,
  hasPendingRestore:mnBackupHasPendingRestore,
  finishPendingRestore:mnBackupFinishPendingRestore,
  validateManifest:validateMnBackupManifest
});

if (typeof module === "object" && module.exports){
  module.exports = {
    MN_BACKUP_MAGIC, MN_BACKUP_VERSION, MnBackupFormatError, MnBackupPreparationError,
    validateMnBackupManifest, mnBackupStamp, mnBackupPreparationMessage, mnBackupOpenBoardDescriptor,
    mnBackupBoardIdentity, mnBackupMissingBoards,
    MN_BACKUP_LOCAL_ONLY_KEYS, mnBackupIsLocalOnlyKey
  };
}
