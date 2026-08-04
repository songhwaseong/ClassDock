"use strict";
/*
 * 최근 연 파일·폴더(MNRecent)
 *
 * 왜: 지금까지 다시 열 수 있는 길은 "작업공간 전체 자동 복원" 아니면 "처음부터 다시 찾기"
 *     둘뿐이었다. 어제 만지던 파일 하나만 다시 열려면 탐색기를 뒤져야 했다.
 *
 * 어떻게: 파일을 여는 경로(handleFiles)는 이미 File System Access 핸들을 IndexedDB 에
 *     보관하고 있다(saveFsHandle, 키=작업공간 경로). 폴더도 rememberFolderHandle 이 같은
 *     방식으로 보관한다. 그래서 여기서는 "무엇을 언제 열었는지" 목록만 localStorage 에
 *     들고 있다가, 열 때 그 핸들을 다시 찾아 권한 1회 확인 후 되살린다.
 *     핸들을 못 주는 환경(구형 브라우저·file://)에서는 항목을 흐리게 두고 안내한다.
 */
const MNRecent = (() => {
  const KEY = "mn.recentItems";
  const LIMIT = 20;
  const FOLDER_KEY_PREFIX = "__folder-handle__/";   // file-loaders.js 의 rememberFolderHandle 과 같은 규칙

  const now = () => Date.now();
  const canStore = () => { try { return typeof localStorage !== "undefined"; } catch(_){ return false; } };

  function read(){
    if (!canStore()) return [];
    try {
      const rows = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(rows)) return [];
      return rows.filter(row => row && typeof row === "object" && row.path && row.name)
        .map(row => ({
          type: row.type === "folder" ? "folder" : "file",
          name: String(row.name),
          path: String(row.path),
          at: Number(row.at) || 0
        }))
        .slice(0, LIMIT);
    } catch(_){ return []; }
  }

  function write(rows){
    if (!canStore()) return;
    try { localStorage.setItem(KEY, JSON.stringify(rows.slice(0, LIMIT))); } catch(_){}
  }

  // 같은 항목은 하나만 남기고 맨 앞으로 올린다(가장 최근이 위).
  function remember(type, name, path){
    const cleanName = String(name || "").trim();
    const cleanPath = String(path || "").trim();
    if (!cleanName || !cleanPath) return;
    const rows = read().filter(row => !(row.type === type && row.path === cleanPath));
    rows.unshift({ type, name: cleanName, path: cleanPath, at: now() });
    write(rows);
    notify();
  }

  const rememberFile = (name, workspacePath) => remember("file", name, workspacePath || name);
  const rememberFolder = (name) => remember("folder", name, name);

  function forget(type, path){
    write(read().filter(row => !(row.type === type && row.path === path)));
    notify();
  }
  function clear(){ write([]); notify(); }

  // 목록이 바뀌면 화면(드롭존)이 스스로 다시 그리게 알린다.
  function notify(){
    try { window.dispatchEvent(new CustomEvent("mnrecentchange")); } catch(_){}
  }

  const list = () => read();

  /* 항목 하나를 실제로 다시 연다. 반환: "opened" | "denied" | "missing" | "unsupported" */
  async function open(entry){
    if (!entry) return "unsupported";
    const key = entry.type === "folder" ? FOLDER_KEY_PREFIX + entry.path : entry.path;
    let handle = null;
    if (typeof loadFsHandle === "function"){
      try { handle = await loadFsHandle(key); } catch(_){ handle = null; }
    }
    // EXE의 네이티브 핸들은 구조화 복제할 수 없어 IndexedDB에 넣지 않는다. 대신 런처가
    // 기억한 실제 경로로 새 핸들을 복원한다(최근 폴더가 재실행 뒤 사라지는 문제 방지).
    if (!handle && entry.type === "folder" && typeof restoreNativeSourceFolder === "function"){
      try { handle = await restoreNativeSourceFolder(entry.name); } catch(_){ handle = null; }
    }
    if (!handle) return "missing";
    if (typeof ensureReadPermission === "function" && !(await ensureReadPermission(handle))) return "denied";

    if (entry.type === "folder"){
      if (handle.kind !== "directory") return "missing";
      if (typeof collectDirectoryHandleFiles !== "function" || typeof openFolderFiles !== "function") return "unsupported";
      if (typeof classifyRelatedFolderRoots === "function"){
        const related = await classifyRelatedFolderRoots(handle);
        if (related.same || related.child){
          const root = related.same || related.child;
          if (related.same){
            root.folderHandle = handle;
            root.originalSaveMode = true;
            if (typeof ensureFolderWriteAccess === "function") await ensureFolderWriteAccess(handle);
            if (typeof rememberFolderHandle === "function") rememberFolderHandle(root, root.name);
          }
          if (typeof requestFolderRefresh === "function") await requestFolderRefresh(root.nodeId);
          remember("folder", entry.name, entry.path);
          return "opened";
        }
        if (related.parents && related.parents.length && typeof absorbContainedFolderRoots === "function")
          absorbContainedFolderRoots(related.parents);
      }
      if (typeof ensureFolderWriteAccess === "function") await ensureFolderWriteAccess(handle);
      const snapshot = await collectDirectoryHandleFiles(handle);
      if (typeof reportSkippedFolderEntries === "function") reportSkippedFolderEntries(snapshot.skipped);
      if (!snapshot.files.length && !snapshot.folderPaths.length) return "missing";
      await openFolderFiles(snapshot.files, {
        folderPaths: snapshot.folderPaths,
        folderHandle: handle,
        originalSaveMode: true                  // 핸들로 연 폴더는 원본에 바로 저장하는 기존 규칙과 같다
      });
      remember("folder", entry.name, entry.path);
      return "opened";
    }

    if (handle.kind !== "file") return "missing";
    let file;
    try { file = await handle.getFile(); }
    catch(_){ return "missing"; }               // 옮겨졌거나 지워진 파일
    if (typeof withFileHandle === "function") file = withFileHandle(file, handle);
    if (typeof setFileRelativePath === "function" && entry.path !== file.name) setFileRelativePath(file, entry.path);
    if (typeof queueFiles === "function") queueFiles([file]);
    else if (typeof handleFiles === "function") await handleFiles([file]);
    else return "unsupported";
    remember("file", entry.name, entry.path);
    return "opened";
  }

  /* 열기 결과를 사용자 말로 안내한다(실패해도 다음 행동을 알려 준다). */
  async function openWithFeedback(entry){
    let result = "unsupported";
    try { result = await open(entry); }
    catch(error){ console.warn("최근 항목 열기 실패:", error); result = "missing"; }
    if (result === "opened") return result;
    if (typeof toast !== "function") return result;
    const _t = (s) => (typeof window !== "undefined" && typeof window.t === "function" ? window.t(s) : s);
    const _tf = (s, vars) => (typeof window !== "undefined" && typeof window.tf === "function"
      ? window.tf(s, vars) : s.replace(/\{(\w+)\}/g, (_, key) => vars[key] == null ? _ : vars[key]));
    if (result === "denied"){
      toast(_tf("'{name}' 을(를) 다시 읽을 권한을 받지 못했어요.", { name:entry.name }), 3600);
    } else if (result === "missing"){
      toast(_tf("'{name}' 을(를) 찾지 못했어요. 옮겨졌거나 지워졌을 수 있어요.", { name:entry.name }), 4200,
        { type:"error", action:{ label:_t("목록에서 지우기"), onClick:() => forget(entry.type, entry.path) } });
    } else {
      toast(_t("이 브라우저에서는 최근 항목을 바로 열 수 없어요. '열기'로 다시 선택해 주세요."), 4200);
    }
    return result;
  }

  return { list, rememberFile, rememberFolder, forget, clear, open, openWithFeedback, LIMIT };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNRecent;
