"use strict";

const IMAGE_MEMO_RECT_KEY = "manneung-image-memo:rect:v1";
const IMAGE_MEMO_MAX_ITEMS = 50;
const IMAGE_MEMO_MAX_BYTES = 200 * 1024 * 1024;
const IMAGE_MEMO_HEADERS = { "X-PdfSigner-Image-Memo":"1" };
const IMAGE_MEMO_AUTO_KEY = "manneung-image-memo:auto-save:v1";
const IMAGE_MEMO_DRAFT_DB = "manneung-image-memo-drafts";
const IMAGE_MEMO_DRAFT_STORE = "state";
const IMAGE_MEMO_AUTO_DELAY = 1400;

function imageMemoStamp(date=new Date()){
  const pad = (value, width=2) => String(value).padStart(width, "0");
  return [
    date.getFullYear(), "-", pad(date.getMonth() + 1), "-", pad(date.getDate()), "_",
    pad(date.getHours()), "-", pad(date.getMinutes()), "-", pad(date.getSeconds()), "-", pad(date.getMilliseconds(), 3)
  ].join("");
}

function imageMemoExtension(blob){
  const type = String(blob && blob.type || "").toLowerCase();
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "image/bmp") return "bmp";
  if (type === "image/svg+xml") return "svg";
  if (type === "image/avif") return "avif";
  return "png";
}

function imageMemoDownload(blob, name){
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function imageMemoDraftSnapshot(entries, batchName, nextOrder){
  return {
    version:1,
    batchName:String(batchName || ""),
    nextOrder:Math.max(1, Number(nextOrder) || 1),
    items:(Array.isArray(entries) ? entries : [])
      .filter(entry => entry && !entry.saved && entry.blob)
      .map(entry => ({
        order:Math.max(1, Number(entry.order) || 1),
        blob:entry.blob,
        dimensions:String(entry.dimensions || ""),
        fileName:entry.fileName ? String(entry.fileName) : ""
      }))
  };
}

let _imageMemoDraftDbPromise = null;
function openImageMemoDraftDb(){
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("indexeddb-unavailable"));
  if (_imageMemoDraftDbPromise) return _imageMemoDraftDbPromise;
  _imageMemoDraftDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_MEMO_DRAFT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_MEMO_DRAFT_STORE)){
        request.result.createObjectStore(IMAGE_MEMO_DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexeddb-open-failed"));
  });
  return _imageMemoDraftDbPromise;
}

async function readImageMemoDraft(){
  const db = await openImageMemoDraftDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(IMAGE_MEMO_DRAFT_STORE, "readonly").objectStore(IMAGE_MEMO_DRAFT_STORE).get("pending");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("indexeddb-read-failed"));
  });
}

async function writeImageMemoDraft(snapshot){
  const db = await openImageMemoDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_MEMO_DRAFT_STORE, "readwrite");
    const store = tx.objectStore(IMAGE_MEMO_DRAFT_STORE);
    if (snapshot && snapshot.items && snapshot.items.length) store.put(snapshot, "pending");
    else store.delete("pending");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("indexeddb-write-failed"));
    tx.onabort = () => reject(tx.error || new Error("indexeddb-write-aborted"));
  });
}

function wireImageMemo(){
  const panel = byId("imageMemo");
  const openButton = byId("imageMemoOpen");
  const closeButton = byId("imageMemoClose");
  const drop = byId("imageMemoDrop");
  const input = byId("imageMemoFile");
  const list = byId("imageMemoList");
  const empty = byId("imageMemoEmpty");
  const count = byId("imageMemoCount");
  const status = byId("imageMemoStatus");
  const saveButton = byId("imageMemoSave");
  const autoToggle = byId("imageMemoAutoSave");
  const preview = byId("imageMemoPreview");
  const previewStage = byId("imageMemoPreviewStage");
  const previewImage = byId("imageMemoPreviewImage");
  const previewTitle = byId("imageMemoPreviewTitle");
  const previewClose = byId("imageMemoPreviewClose");
  const zoomOutButton = byId("imageMemoZoomOut");
  const zoomInButton = byId("imageMemoZoomIn");
  const zoomFitButton = byId("imageMemoZoomFit");
  const zoomOriginalButton = byId("imageMemoZoomOriginal");
  const zoomLabel = byId("imageMemoZoomLabel");
  if (!panel || !openButton || !drop || !input || !list || !saveButton) return;

  const head = panel.querySelector(".image-memo-head");
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "scratchpad-resize";
  resizeHandle.title = "끌어서 크기 조절";
  resizeHandle.setAttribute("aria-hidden", "true");
  panel.appendChild(resizeHandle);
  const memoFloat = head && typeof makeMemoFloatable === "function"
    ? makeMemoFloatable(panel, head, resizeHandle, IMAGE_MEMO_RECT_KEY)
    : null;

  let entries = [];
  let nextId = 1;
  let nextOrder = 1;
  let batchName = "";
  let saving = false;
  let autoSaving = false;
  let restoring = false;
  let savedTotal = 0;
  let autoSaveTimer = 0;
  let serverAvailablePromise = null;
  let backendResolved = false;
  let serverMode = false;
  let saveFailed = false;
  let autoSaveEnabled = true;
  try { autoSaveEnabled = localStorage.getItem(IMAGE_MEMO_AUTO_KEY) !== "0"; } catch(_){}
  let previewEntry = null;
  let previewTrigger = null;
  let previewZoom = 1;
  let previewX = 0;
  let previewY = 0;

  const pendingEntries = () => entries.filter(entry => !entry.saved);
  const serverAvailable = () => {
    if (!serverAvailablePromise){
      serverAvailablePromise = Promise.resolve(
        typeof saveFileBackendAvailable === "function" && saveFileBackendAvailable()
      ).then(Boolean).catch(() => false).then(value => {
        backendResolved = true;
        serverMode = value;
        syncSaveAction();
        return value;
      });
    }
    return serverAvailablePromise;
  };
  const formatBytes = (bytes) => {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)).toLocaleString() + "KB";
    return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + "MB";
  };
  const fileNameFor = (entry) => entry.fileName || (String(entry.order).padStart(3, "0") + "." + imageMemoExtension(entry.blob));
  const displayNameFor = (entry) => entry.displayName || fileNameFor(entry);
  const setStatus = (message) => { status.textContent = message; };
  function syncSaveAction(){
    if (!saveButton) return;
    if (!backendResolved){
      saveButton.hidden = true;
      return;
    }
    if (serverMode){
      saveButton.hidden = !saveFailed && autoSaveEnabled;
      saveButton.textContent = saveFailed ? "다시 시도" : "지금 저장";
      saveButton.title = saveFailed ? "자동저장에 실패한 이미지를 다시 저장" : "자동저장하지 않은 이미지를 지금 저장";
    } else {
      saveButton.hidden = false;
      saveButton.textContent = "파일로 다운로드";
      saveButton.title = "임시복구 이미지를 원본 파일 또는 ZIP으로 다운로드";
    }
  }

  const applyPreviewTransform = () => {
    if (!previewImage) return;
    previewImage.style.transform = `translate(-50%,-50%) translate(${previewX}px,${previewY}px) scale(${previewZoom})`;
    if (zoomLabel) zoomLabel.textContent = Math.round(previewZoom * 100) + "%";
  };
  const fitPreview = () => {
    if (!previewStage || !previewImage || !previewImage.naturalWidth || !previewImage.naturalHeight) return;
    const width = Math.max(1, previewStage.clientWidth - 36);
    const height = Math.max(1, previewStage.clientHeight - 36);
    previewZoom = Math.max(0.05, Math.min(1, width / previewImage.naturalWidth, height / previewImage.naturalHeight));
    previewX = 0;
    previewY = 0;
    applyPreviewTransform();
  };
  const setPreviewZoom = (nextZoom, clientX, clientY) => {
    if (!previewStage) return;
    const next = Math.max(0.05, Math.min(8, nextZoom));
    const rect = previewStage.getBoundingClientRect();
    const pointX = Number.isFinite(clientX) ? clientX - rect.left - rect.width / 2 : 0;
    const pointY = Number.isFinite(clientY) ? clientY - rect.top - rect.height / 2 : 0;
    const ratio = next / previewZoom;
    previewX = pointX - (pointX - previewX) * ratio;
    previewY = pointY - (pointY - previewY) * ratio;
    previewZoom = next;
    applyPreviewTransform();
  };
  const originalPreview = () => {
    previewZoom = 1;
    previewX = 0;
    previewY = 0;
    applyPreviewTransform();
  };
  let previewIdleTimer = null;
  const armPreviewIdle = () => {
    clearTimeout(previewIdleTimer);
    if (!preview || preview.hidden) return;
    previewIdleTimer = setTimeout(() => {
      if (preview && !preview.hidden && !previewStage.classList.contains("dragging")) preview.classList.add("tools-idle");
    }, 2500);
  };
  const showPreviewTools = () => {
    if (!preview || preview.hidden) return;
    preview.classList.remove("tools-idle");
    armPreviewIdle();
  };
  const closePreview = (restoreFocus=true) => {
    if (!preview || preview.hidden) return;
    clearTimeout(previewIdleTimer);
    preview.classList.remove("tools-idle");
    preview.hidden = true;
    previewEntry = null;
    previewImage.removeAttribute("src");
    if (restoreFocus && previewTrigger && previewTrigger.isConnected) previewTrigger.focus();
    previewTrigger = null;
  };
  const openPreview = (entry, trigger) => {
    if (!preview || !previewImage || !entry) return;
    previewEntry = entry;
    previewTrigger = trigger || null;
    previewTitle.textContent = displayNameFor(entry);
    previewImage.alt = displayNameFor(entry) + " 확대 미리보기";
    previewImage.onload = fitPreview;
    previewImage.src = entry.url;
    preview.hidden = false;
    showPreviewTools();
    requestAnimationFrame(() => {
      if (previewImage.complete) fitPreview();
      previewStage.focus();
    });
  };

  // 디스크에 저장된 이미지 파일 삭제를 시도하고 결과를 원인별로 돌려준다.
  //  ok:true               → 지워졌거나(정상), 이미 디스크에 없어(404) 목록에서 지워도 안전
  //  ok:false + msg        → 실패(잠김·권한 500 / 서버 무응답). msg 는 사용자 안내 문구.
  const deleteSavedFile = async (entry) => {
    try {
      const response = await fetch("/image-memo-delete", {
        method:"POST",
        headers:{ ...IMAGE_MEMO_HEADERS, "X-Image-Memo-Path":encodeURIComponent(entry.sourcePath) }
      });
      if (response.ok) return { ok:true, orphan:false };
      if (response.status === 404) return { ok:true, orphan:true };   // 디스크에 이미 없음 → 목록에서만 정리
      if (response.status === 500)
        return { ok:false, msg:"이미지 파일이 다른 프로그램에서 열려 있거나 권한이 없어 지우지 못했어요. 그 창을 닫고 다시 시도하거나, 목록에서만 지울 수 있어요." };
      return { ok:false, msg:"파일을 지우지 못했어요 (서버 응답 " + response.status + "). 목록에서만 지울 수 있어요." };
    } catch(e){
      console.error(e);
      return { ok:false, msg:"저장 서버가 응답하지 않아 파일을 지우지 못했어요. 목록에서만 지울 수 있어요." };
    }
  };

  const removeEntry = async (id) => {
    const index = entries.findIndex(entry => entry.id === id);
    if (index < 0) return;
    const entry = entries[index];
    let doneMsg;
    if (entry.saved && entry.sourcePath){
      const outcome = await deleteSavedFile(entry);
      if (!outcome.ok){
        // 디스크 삭제 실패 → 원인 안내 후, 디스크 파일은 남긴 채 목록에서만 지울지 확인.
        setStatus(outcome.msg);
        const listOnly = (typeof confirmDialog === "function")
          ? await confirmDialog(outcome.msg + "\n\n목록에서만 지울까요? (디스크의 이미지 파일은 그대로 남습니다)", "목록에서 지우기", "취소")
          : false;
        if (!listOnly){ toast("이미지 메모 파일 삭제에 실패했어요.", 2800); return; }
        doneMsg = "목록에서만 지웠어요. 디스크의 이미지 파일은 남아 있어요.";   // savedTotal 유지(파일 남음)
      } else {
        savedTotal = Math.max(0, savedTotal - 1);
        doneMsg = outcome.orphan ? "이미 없는 파일이라 목록에서만 지웠어요." : "저장된 이미지 파일을 삭제했어요.";
      }
    } else {
      doneMsg = "저장하지 않은 이미지를 목록에서 지웠어요.";
    }
    if (previewEntry && previewEntry.id === entry.id) closePreview(false);
    URL.revokeObjectURL(entry.url);
    entries.splice(index, 1);
    if (!entries.length) batchName = "";
    render();
    setStatus(doneMsg);
    if (!entry.saved){
      if (autoSaveEnabled) scheduleAutoSave(0);
      else if (!(await serverAvailable())){
        try { await writeImageMemoDraft(imageMemoDraftSnapshot(entries, batchName, nextOrder)); } catch(_){}
      }
    }
  };

  const makeCard = (entry, index) => {
    const card = document.createElement("article");
    card.className = "image-memo-card";
    card.classList.toggle("saved", entry.saved);
    card.classList.toggle("drafted", !entry.saved && !!entry.drafted);

    const image = document.createElement("img");
    image.src = entry.url;
    image.alt = "이미지 메모 " + (index + 1);
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.title = "클릭해서 크게 보기";
    image.addEventListener("click", () => openPreview(entry, image));
    image.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openPreview(entry, image);
    });
    image.addEventListener("load", () => {
      entry.dimensions = image.naturalWidth + "×" + image.naturalHeight;
      meta.textContent = [entry.dimensions, formatBytes(entry.blob.size)].filter(Boolean).join(" · ");
    }, { once:true });

    const body = document.createElement("div");
    body.className = "image-memo-card-body";
    const title = document.createElement("strong");
    title.textContent = displayNameFor(entry);
    title.title = displayNameFor(entry);
    const meta = document.createElement("span");
    meta.textContent = [entry.dimensions, formatBytes(entry.blob.size)].filter(Boolean).join(" · ");
    const saved = document.createElement("span");
    saved.className = "image-memo-card-state";
    saved.textContent = entry.saved
      ? ("저장됨" + (entry.modified ? " · " + new Date(entry.modified).toLocaleString() : ""))
      : (entry.drafted ? "임시복구 저장됨" : "저장 안 됨");
    const send = document.createElement("button");
    send.type = "button";
    send.className = "image-memo-send";
    send.textContent = "현재 메모로 보내기";
    send.title = "일반 메모장의 현재 탭에 이 이미지 삽입";
    send.addEventListener("click", async () => {
      if (typeof window.addImagesToScratchpad !== "function"){
        setStatus("일반 메모를 준비하지 못했습니다.");
        return;
      }
      send.disabled = true;
      try {
        const added = await window.addImagesToScratchpad([entry.blob], {
          name:displayNameFor(entry),
          open:true
        });
        if (added){
          setStatus("이미지를 현재 메모로 보냈습니다.");
          setOpen(false, false);
        }
      } catch(error){
        console.error(error);
        setStatus("이미지를 일반 메모로 보내지 못했습니다.");
      } finally {
        send.disabled = false;
      }
    });
    body.append(title, meta, saved, send);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "image-memo-remove";
    remove.textContent = "×";
    remove.title = entry.saved ? "저장된 이미지 파일 삭제" : "이 이미지 지우기";
    remove.setAttribute("aria-label", (index + 1) + "번째 " + (entry.saved ? "저장 파일 삭제" : "이미지 지우기"));
    remove.addEventListener("click", () => removeEntry(entry.id));

    card.append(image, body, remove);
    return card;
  };

  function render(){
    const pending = pendingEntries().length;
    const savedNote = savedTotal > entries.filter(entry => entry.saved).length ? ` · 최근 ${entries.filter(entry => entry.saved).length}/${savedTotal}개 표시` : "";
    count.textContent = entries.length ? `${entries.length}개 · 저장 안 됨 ${pending}개${savedNote}` : (restoring ? "불러오는 중…" : "0개");
    saveButton.disabled = saving || pending === 0;
    syncSaveAction();
    drop.disabled = saving && !autoSaving;
    if (!entries.length){
      empty.hidden = false;
      list.replaceChildren(empty);
      return;
    }
    empty.hidden = true;
    list.replaceChildren(...entries.map(makeCard));
  }

  const addImages = (files, opts={}) => {
    const images = [...(files || [])].filter(file => file && /^image\//i.test(file.type || ""));
    if (!images.length){ setStatus("이미지 형식만 넣을 수 있어요."); return 0; }
    let added = 0;
    let totalBytes = pendingEntries().reduce((sum, entry) => sum + entry.blob.size, 0);
    for (const blob of images){
      if (pendingEntries().length >= IMAGE_MEMO_MAX_ITEMS){
        toast(`이미지는 한 번에 ${IMAGE_MEMO_MAX_ITEMS}개까지 담을 수 있어요.`, 3000);
        break;
      }
      if (totalBytes + blob.size > IMAGE_MEMO_MAX_BYTES){
        toast("이미지 메모가 200MB를 넘어 더 담지 않았어요.", 3200);
        break;
      }
      if (!batchName) batchName = imageMemoStamp();
      const entry = {
        id: nextId++,
        order: nextOrder++,
        blob,
        url: URL.createObjectURL(blob),
        dimensions: "",
        saved: false,
        drafted: false
      };
      // 다른 메모(스크래치패드)에서 보낼 땐 원래 이름을 디스크 저장 파일명으로 유지(경로·특수문자 제거).
      if (opts.keepName && blob.name) entry.fileName = String(blob.name).replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 180);
      entries.push(entry);
      totalBytes += blob.size;
      added++;
    }
    if (added){
      render();
      setStatus(`${added}개를 붙여넣었어요. 계속 붙여넣을 수 있습니다.`);
      scheduleAutoSave();
    }
    return added;
  };

  const persistBrowserDrafts = async () => {
    const pending = pendingEntries();
    try {
      await writeImageMemoDraft(imageMemoDraftSnapshot(entries, batchName, nextOrder));
      pending.forEach(entry => { entry.drafted = true; });
      render();
      setStatus(pending.length
        ? `${pending.length}개를 브라우저 임시복구에 자동 저장했어요.`
        : "브라우저 임시복구를 정리했어요.");
      return true;
    } catch(e){
      console.warn("image memo draft save failed:", e);
      setStatus("브라우저 임시 자동저장에 실패했어요. 파일로 다운로드해 주세요.");
      return false;
    }
  };

  function scheduleAutoSave(delay=IMAGE_MEMO_AUTO_DELAY){
    clearTimeout(autoSaveTimer);
    autoSaveTimer = 0;
    if (!autoSaveEnabled || restoring || !pendingEntries().length) return;
    setStatus(`${pendingEntries().length}개 자동 저장 대기 중…`);
    autoSaveTimer = setTimeout(async () => {
      autoSaveTimer = 0;
      if (!autoSaveEnabled || restoring || !pendingEntries().length) return;
      if (saving){ scheduleAutoSave(700); return; }
      if (await serverAvailable()) await saveAll({ automatic:true });
      else await persistBrowserDrafts();
    }, Math.max(0, Number(delay) || 0));
  }

  const setOpen = (open, focus=true) => {
    panel.hidden = !open;
    openButton.setAttribute("aria-expanded", String(open));
    if (open && memoFloat) memoFloat.clampOnOpen();
    if (open && document.body.classList.contains("viewer-fullscreen") && typeof exitViewerFullscreen === "function") exitViewerFullscreen();
    if (typeof scheduleViewerLayoutRefresh === "function") scheduleViewerLayoutRefresh();
    if (open && focus) setTimeout(() => drop.focus(), 0);
    else if (!open && focus) openButton.focus();
  };

  const saveViaServer = async (pending) => {
    let firstPath = "";
    for (const entry of pending){
      const rel = `이미지메모/${batchName}/${fileNameFor(entry)}`;
      const response = await fetch("/save-file", {
        method: "POST",
        headers: { "X-Save-Path": encodeURIComponent(rel) },
        body: entry.blob
      });
      if (!response.ok) throw new Error((await response.text()) || "save-failed");
      const path = (await response.text()).trim();
      if (!firstPath) firstPath = path;
      entry.sourcePath = rel;
      entry.fileName = fileNameFor(entry);
      entry.displayName = `${batchName}/${entry.fileName}`;
      entry.modified = Date.now();
      entry.saved = true;
      savedTotal++;
      render();
    }
    return firstPath;
  };

  const saveInBrowser = async (pending) => {
    if (pending.length === 1){
      const entry = pending[0];
      imageMemoDownload(entry.blob, `이미지메모_${batchName}_${fileNameFor(entry)}`);
      entry.saved = true;
      return;
    }
    // 여러 장을 한 번에 저장할 때만 압축 라이브러리가 필요하다 — 그때 처음 로드한다.
    if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("jszip");
    if (typeof JSZip !== "undefined"){
      const zip = new JSZip();
      for (const entry of pending){
        zip.file(fileNameFor(entry), new Uint8Array(await entry.blob.arrayBuffer()));
      }
      const blob = zip.generate({ type:"blob" });
      imageMemoDownload(blob, `이미지메모_${batchName}.zip`);
      pending.forEach(entry => { entry.saved = true; });
      return;
    }
    pending.forEach((entry, index) => {
      setTimeout(() => imageMemoDownload(entry.blob, `이미지메모_${batchName}_${fileNameFor(entry)}`), index * 180);
      entry.saved = true;
    });
  };

  const saveAll = async (options={}) => {
    const automatic = !!options.automatic;
    const pending = pendingEntries();
    if (!pending.length || saving) return;
    saving = true;
    autoSaving = automatic;
    render();
    setStatus(`${pending.length}개 ${automatic ? "자동 " : ""}저장 중…`);
    let hasServer = false;
    try {
      hasServer = await serverAvailable();
      if (hasServer){
        const path = await saveViaServer(pending);
        saveFailed = false;
        setStatus(`${pending.length}개를 자동 저장 폴더에 ${automatic ? "자동 " : ""}저장했어요.`);
        if (!automatic) toast(path ? `이미지 메모 저장 완료: ${path}` : "이미지 메모를 저장했어요.", 3200, { type: "success" });
      } else {
        if (automatic){
          await persistBrowserDrafts();
          return;
        }
        await saveInBrowser(pending);
        setStatus(pending.length > 1 ? `${pending.length}개를 ZIP으로 저장했어요.` : "이미지를 저장했어요.");
        toast("이미지 메모 다운로드를 시작했어요.", 2400);
        try { await writeImageMemoDraft(imageMemoDraftSnapshot(entries, batchName, nextOrder)); } catch(_){}
      }
    } catch(e){
      console.error(e);
      if (hasServer) saveFailed = true;
      setStatus("일부 이미지를 저장하지 못했어요. 자동으로 다시 시도합니다.");
      if (!automatic) toast("일부 이미지 메모를 저장하지 못했어요.", 3000, { type: "error" });
    } finally {
      saving = false;
      autoSaving = false;
      render();
      if (autoSaveEnabled && pendingEntries().length) scheduleAutoSave(automatic ? 5000 : IMAGE_MEMO_AUTO_DELAY);
    }
  };

  openButton.addEventListener("click", () => setOpen(panel.hidden));
  closeButton.addEventListener("click", () => setOpen(false));
  if (autoToggle){
    autoToggle.checked = autoSaveEnabled;
    autoToggle.addEventListener("change", () => {
      autoSaveEnabled = !!autoToggle.checked;
      try { localStorage.setItem(IMAGE_MEMO_AUTO_KEY, autoSaveEnabled ? "1" : "0"); } catch(_){}
      clearTimeout(autoSaveTimer);
      autoSaveTimer = 0;
      if (autoSaveEnabled){
        setStatus("이미지 메모 자동 저장을 켰어요.");
        scheduleAutoSave(0);
      } else {
        setStatus("이미지 메모 자동 저장을 껐어요. 아래 저장 버튼으로 직접 저장할 수 있습니다.");
      }
      syncSaveAction();
    });
  }
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    addImages(input.files);
    input.value = "";
  });
  const draggingImages = (event) => {
    if (!event.dataTransfer) return false;
    const types = Array.from(event.dataTransfer.types || []);
    return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html") ||
      !!event.dataTransfer.files.length;
  };
  panel.addEventListener("dragenter", (event) => {
    if (!draggingImages(event)) return;
    event.preventDefault();
    event.stopPropagation();
    panel.classList.add("image-memo-drag");
  }, true);
  panel.addEventListener("dragover", (event) => {
    if (!draggingImages(event)) return;
    event.preventDefault();
    event.stopPropagation();
    panel.classList.add("image-memo-drag");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }, true);
  panel.addEventListener("dragleave", (event) => {
    if (!panel.classList.contains("image-memo-drag")) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.relatedTarget;
    if (!next || !panel.contains(next)) panel.classList.remove("image-memo-drag");
  }, true);
  panel.addEventListener("drop", async (event) => {
    if (!draggingImages(event)) return;
    event.preventDefault();
    event.stopPropagation();
    panel.classList.remove("image-memo-drag");
    let blobs = [...((event.dataTransfer && event.dataTransfer.files) || [])]
      .filter(file => file && /^image\//i.test(file.type || ""));
    if (!blobs.length && typeof scratchpadDroppedImageBlobs === "function"){
      setStatus("웹 이미지를 가져오는 중…");
      blobs = await scratchpadDroppedImageBlobs(event.dataTransfer);
    }
    if (!blobs.length){
      setStatus("이 웹 이미지는 가져올 수 없습니다. 이미지 복사 후 Ctrl+V를 사용해 주세요.");
      return;
    }
    addImages(blobs);
  }, true);
  saveButton.addEventListener("click", saveAll);

  if (preview){
    preview.addEventListener("mousemove", showPreviewTools, { passive:true });
    previewClose.addEventListener("click", () => closePreview());
    preview.addEventListener("click", (event) => { if (event.target === preview) closePreview(); });
    zoomOutButton.addEventListener("click", () => setPreviewZoom(previewZoom / 1.2));
    zoomInButton.addEventListener("click", () => setPreviewZoom(previewZoom * 1.2));
    zoomFitButton.addEventListener("click", fitPreview);
    zoomOriginalButton.addEventListener("click", originalPreview);
    previewStage.addEventListener("wheel", (event) => {
      event.preventDefault();
      setPreviewZoom(previewZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY);
      showPreviewTools();
    }, { passive:false });
    previewStage.addEventListener("dblclick", () => {
      if (Math.abs(previewZoom - 1) < 0.02) fitPreview();
      else originalPreview();
    });
    previewStage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      previewStage.setPointerCapture(event.pointerId);
      previewStage.classList.add("dragging");
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = previewX;
      const originY = previewY;
      const move = (next) => {
        previewX = originX + next.clientX - startX;
        previewY = originY + next.clientY - startY;
        applyPreviewTransform();
      };
      const finish = () => {
        previewStage.classList.remove("dragging");
        previewStage.removeEventListener("pointermove", move);
        previewStage.removeEventListener("pointerup", finish);
        previewStage.removeEventListener("pointercancel", finish);
      };
      previewStage.addEventListener("pointermove", move);
      previewStage.addEventListener("pointerup", finish);
      previewStage.addEventListener("pointercancel", finish);
    });
  }

  document.addEventListener("paste", (event) => {
    if (panel.hidden || (saving && !autoSaving)) return;
    const blobs = [];
    for (const item of [...((event.clipboardData && event.clipboardData.items) || [])]){
      if (item.kind === "file" && /^image\//i.test(item.type || "")){
        const blob = item.getAsFile();
        if (blob) blobs.push(blob);
      }
    }
    if (!blobs.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addImages(blobs);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (preview && !preview.hidden){
      if (event.key === "Escape"){
        event.preventDefault();
        event.stopImmediatePropagation();
        closePreview();
      } else if (event.key === "+" || event.key === "="){
        event.preventDefault();
        setPreviewZoom(previewZoom * 1.2);
      } else if (event.key === "-"){
        event.preventDefault();
        setPreviewZoom(previewZoom / 1.2);
      } else if (event.key === "0"){
        event.preventDefault();
        originalPreview();
      }
      return;
    }
    if (event.key === "Escape" && !panel.hidden){
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    }
  }, true);
  window.addEventListener("beforeunload", (event) => {
    if (!pendingEntries().some(entry => !entry.drafted)) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(autoSaveTimer);
    closePreview(false);
    entries.forEach(entry => URL.revokeObjectURL(entry.url));
  });

  // 다른 메모(스크래치패드)에서 이미지를 이미지 메모로 보내는 진입점 — 반대 방향의 addImagesToScratchpad 와 대칭.
  window.addImagesToImageMemo = (blobs, options={}) => {
    const files = [...(blobs || [])].filter(b => b && /^image\//i.test(b.type || ""));
    if (!files.length) return 0;
    const added = addImages(files, { keepName: !!options.keepName });
    if (added && options.open) setOpen(true, false);   // 보낸 게 보이도록 패널 열기(포커스는 옮기지 않음)
    return added;
  };
  // EXE에서 자동저장을 껐거나 아직 저장 대기 중인 이미지도 전체 백업에 포함한다.
  window.flushImageMemoBackup = () => persistBrowserDrafts();

  const restoreBrowserDrafts = async () => {
    let draft = null;
    try { draft = await readImageMemoDraft(); }
    catch(e){
      console.warn("image memo draft restore failed:", e);
      setStatus("브라우저 임시복구를 불러오지 못했어요.");
      return;
    }
    const items = Array.isArray(draft && draft.items) ? draft.items : [];
    let acceptedBytes = 0;
    const restored = [];
    for (const item of items.slice(0, IMAGE_MEMO_MAX_ITEMS)){
      const blob = item && item.blob;
      if (!blob || !/^image\//i.test(blob.type || "") || blob.size <= 0) continue;
      if (acceptedBytes + blob.size > IMAGE_MEMO_MAX_BYTES) break;
      acceptedBytes += blob.size;
      restored.push({
        id:nextId++,
        order:Math.max(1, Number(item.order) || restored.length + 1),
        blob,
        url:URL.createObjectURL(blob),
        dimensions:String(item.dimensions || ""),
        fileName:item.fileName ? String(item.fileName) : "",
        saved:false,
        drafted:true
      });
    }
    if (restored.length){
      entries = restored.concat(entries);
      batchName = String(draft.batchName || imageMemoStamp());
      nextOrder = Math.max(
        Number(draft.nextOrder) || 1,
        ...restored.map(entry => entry.order + 1)
      );
      setStatus(`임시 자동저장 이미지 ${restored.length}개를 복구했어요.`);
    } else {
      setStatus("캡처 후 Ctrl+V로 붙여넣으세요.");
    }
  };

  const restoreSavedImages = async () => {
    restoring = true;
    render();
    setStatus("저장된 이미지 메모를 불러오는 중…");
    try {
      const hasServer = await serverAvailable();
      if (!hasServer){
        await restoreBrowserDrafts();
        return;
      }
      // 전체 백업으로 가져온 미저장 이미지와 EXE에서 자동저장을 끈 채 남긴 임시본도
      // 실제 저장 폴더 이미지와 함께 복구한다.
      await restoreBrowserDrafts();
      const response = await fetch("/image-memo-list", { headers:IMAGE_MEMO_HEADERS, cache:"no-store" });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const rows = Array.isArray(data && data.items) ? data.items : [];
      savedTotal = Number(data && data.total) || rows.length;
      let acceptedBytes = 0;
      const candidates = rows.filter(row => {
        const size = Number(row && row.size) || 0;
        if (!row || !row.path || size <= 0 || size > IMAGE_MEMO_MAX_BYTES) return false;
        if (acceptedBytes + size > IMAGE_MEMO_MAX_BYTES) return false;
        acceptedBytes += size;
        return true;
      });
      const restored = [];
      for (let index = 0; index < candidates.length; index += 4){
        const batch = candidates.slice(index, index + 4);
        const loaded = await Promise.all(batch.map(async row => {
          try {
            const fileResponse = await fetch("/image-memo-file?path=" + encodeURIComponent(row.path), {
              headers:IMAGE_MEMO_HEADERS,
              cache:"no-store"
            });
            if (!fileResponse.ok) return null;
            const blob = await fileResponse.blob();
            if (!/^image\//i.test(blob.type || "")) return null;
            return {
              id:nextId++,
              order:0,
              blob,
              url:URL.createObjectURL(blob),
              dimensions:"",
              saved:true,
              sourcePath:row.path,
              fileName:row.name || String(row.path).split("/").pop(),
              displayName:String(row.path).replace(/^이미지메모\//, ""),
              modified:Number(row.modified) || 0
            };
          } catch(e){ return null; }
        }));
        restored.push(...loaded.filter(Boolean));
      }
      const existingPaths = new Set(entries.map(entry => entry.sourcePath).filter(Boolean));
      const unique = restored.filter(entry => !existingPaths.has(entry.sourcePath));
      entries = unique.concat(entries);
      setStatus(unique.length
        ? `저장된 이미지 메모 ${unique.length}개를 불러왔어요.`
        : t("저장된 이미지 메모가 없습니다."));
    } catch(e){
      console.warn("image memo restore failed:", e);
      setStatus("저장된 이미지 메모를 불러오지 못했어요.");
    } finally {
      restoring = false;
      render();
    }
  };

  render();
  restoreSavedImages();
}

if (typeof module === "object" && module.exports){
  module.exports = { imageMemoStamp, imageMemoExtension, imageMemoDraftSnapshot };
}
