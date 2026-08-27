"use strict";

const MNWorkspacePython = (() => {
  function isDefinitionSourceDoc(doc){
    return !!(doc && String(doc.sourceKey || "").startsWith("definition:"));
  }
  
  // Ctrl+클릭에서 현재 작업공간의 from ... import ... 를 먼저 해석한다.
  // Jedi에는 브라우저가 가진 폴더 상대경로를 넘길 수 없어, 함께 열린 문서 경로로 직접 연결해야 한다.
  async function openWorkspacePythonImportDefinition(ownerDoc, source, wordInfo){
    if (!ownerDoc || !wordInfo || !wordInfo.word || typeof resolvePythonImportedDefinition !== "function") return false;
    const docPath = (doc) => String((doc && (doc.workspacePath || doc.relPath || doc.name)) || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const candidates = docs.filter(doc => typeof workspaceHasDoc !== "function" || workspaceHasDoc(doc));
    const hit = resolvePythonImportedDefinition(source, wordInfo.word, docPath(ownerDoc), candidates.map(docPath));
    if (!hit) return false;
    const target = candidates.find(doc => docPath(doc) === hit.path);
    if (!target) return false;
    let targetSource = "";
    try { targetSource = await openDocRunText(target); } catch(_){}
    const definition = findPythonLocalDefinition(targetSource, hit.importedName, 0);
    const targetLine = definition ? definition.line : 1;
    const targetFocus = { column:0, length:Math.max(1, hit.importedName.length) };
    target.pendingFocusLine = targetLine;
    target.pendingFocusOptions = targetFocus;
    setActiveDoc(target.id);
    const navigator = target.codeEditor || target.codeViewer;
    if (navigator && navigator.focusLine) navigator.focusLine(targetLine, targetFocus);
    toast(definition ? "작업공간의 함수 정의로 이동했습니다." : "작업공간의 모듈 파일을 열었습니다.", 1600);
    return true;
  }
  
  // 아직 한 번도 연 적 없는 .py 의 원본 텍스트 캐시(문서 id → {stamp, text}).
  // 완성 팝업은 동기라 그 자리에서 디스크를 읽을 수 없다. 그래서 열린 문서로 먼저 답하고,
  // 비어 있는 파일은 백그라운드로 읽어 이 캐시에 채운다(다음 타이핑부터 후보에 들어온다).
  const workspacePyTextCache = new Map();
  // 끝내 읽지 못한(권한·스냅샷 만료·너무 큰) 파일의 문서 id. 캐시에는 빈 본문으로 들어가므로
  // 이 목록이 없으면 '내용이 빈 __init__.py' 와 구분되지 않는다 — import 검사가 이 둘을 다르게 본다.
  const workspacePyUnreadable = new Set();
  const WORKSPACE_PY_MAX_BYTES = 512 * 1024;   // 이보다 큰 .py 는 자동완성 인덱스에서 제외(대개 생성 코드)
  const WORKSPACE_PY_PREWARM_MAX = 400;        // 한 번에 읽어 둘 파일 수 상한(대형 폴더 보호)
  let workspacePyPrewarmBusy = false;
  let workspacePyPrewarmOwner = null;
  const workspacePyPrewarmQueue = [];
  const workspacePyPrewarmCallbacks = new Map();
  
  function workspacePyStamp(doc){
    const file = doc && doc.sourceFile;
    if (!file) return "";
    return String(file.size || 0) + ":" + String(file.lastModified || 0);
  }
  // 완성이 볼 본문 — 살아있는 편집기 > 저장된 텍스트 > 프리워밍 캐시 순(내용 검색 liveDocText 와 같은 사다리).
  function workspacePyText(doc){
    if (typeof liveDocText === "function" && typeof hasLiveDocText === "function" && hasLiveDocText(doc)){
      const live = liveDocText(doc);
      if (typeof live === "string") return live;
    } else if (doc && typeof doc.savedText === "string") return doc.savedText;
    const cached = doc ? workspacePyTextCache.get(doc.id) : null;
    return cached && cached.stamp === workspacePyStamp(doc) ? cached.text : null;
  }
  // 자동 import 인덱스에 넣을 문서 목록. 서로 다른 폴더/압축 묶음은 import 루트가 모호해지므로
  // 같은 archiveCtx만 포함한다.
  function workspacePythonImportTargets(ownerDoc){
    const docPath = (doc) => String((doc && (doc.workspacePath || doc.relPath || doc.name)) || "")
      .replace(/\\/g, "/").replace(/^\/+/, "");
    const context = ownerDoc.archiveCtx || null;
    const rows = [];
    for (const doc of docs){
      if (typeof workspaceHasDoc === "function" && !workspaceHasDoc(doc)) continue;
      if (!doc || doc === ownerDoc || doc.kind === "pdf") continue;
      if (doc.sourceKey && String(doc.sourceKey).startsWith("definition:")) continue;
      if ((doc.archiveCtx || null) !== context) continue;
      const path = docPath(doc);
      if (!/\.(?:py|pyw|pyi)$/i.test(path)) continue;
      rows.push({ doc, path });
    }
    return { currentPath:docPath(ownerDoc), rows };
  }
  // 닫힌 문서의 캐시는 버린다(문서 목록이 곧 수명).
  function pruneWorkspacePyTextCache(){
    if (!workspacePyTextCache.size) return;
    const alive = new Set(docs.map(doc => doc && doc.id));
    for (const id of [...workspacePyTextCache.keys()]) if (!alive.has(id)) workspacePyTextCache.delete(id);
    for (const id of [...workspacePyUnreadable]) if (!alive.has(id)) workspacePyUnreadable.delete(id);
  }
  // 열지 않은 .py 를 한 번씩 읽어 캐시에 채운다. 한 파일마다 프레임을 양보해 타이핑을 막지 않는다.
  // 못 읽거나(권한·스냅샷 만료) 너무 큰 파일도 빈 본문으로 표시해 둔다 — 그래야 타이핑할 때마다
  // 같은 파일을 다시 시도하지 않는다. 파일이 바뀌면 stamp 가 달라져 자동으로 다시 읽는다.
  async function runWorkspacePythonPrewarm(ownerDoc){
    const rows = workspacePythonImportTargets(ownerDoc).rows;
    let read = 0, remaining = false;
    for (const row of rows){
      if (workspacePyText(row.doc) != null) continue;
      const stamp = workspacePyStamp(row.doc);
      const file = row.doc.sourceFile;
      if (!file || typeof file.arrayBuffer !== "function" || file.size > WORKSPACE_PY_MAX_BYTES){
        workspacePyTextCache.set(row.doc.id, { stamp, text:"" });   // 읽지 않기로 한 파일 — 다시 시도하지 않는다
        workspacePyUnreadable.add(row.doc.id);
        continue;
      }
      if (read >= WORKSPACE_PY_PREWARM_MAX){ remaining = true; break; } // 다음 유휴 차례에 이어 읽는다
      read++;
      let text = null;
      try { text = typeof openDocRunText === "function" ? await openDocRunText(row.doc) : null; }
      catch(_){ text = null; }
      workspacePyTextCache.set(row.doc.id, { stamp, text:typeof text === "string" ? text : "" });
      if (typeof text === "string") workspacePyUnreadable.delete(row.doc.id);
      else workspacePyUnreadable.add(row.doc.id);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    pruneWorkspacePyTextCache();
    return { remaining };
  }
  // 프리워밍 예약 — 동시에 하나만 돌리고 400개 단위로 끝까지 이어 읽는다.
  // 완료 콜백은 import 검사가 보류됐던 편집기의 진단을 입력 없이 다시 실행하는 데 쓴다.
  function scheduleWorkspacePythonPrewarm(ownerDoc, onReady){
    if (!ownerDoc) return;
    if (typeof onReady === "function") {
      let callbacks = workspacePyPrewarmCallbacks.get(ownerDoc);
      if (!callbacks){ callbacks = new Set(); workspacePyPrewarmCallbacks.set(ownerDoc, callbacks); }
      callbacks.add(onReady);
    }
    if (workspacePyPrewarmOwner !== ownerDoc && !workspacePyPrewarmQueue.includes(ownerDoc)) workspacePyPrewarmQueue.push(ownerDoc);
    drainWorkspacePythonPrewarmQueue();
  }
  function drainWorkspacePythonPrewarmQueue(){
    if (workspacePyPrewarmBusy || !workspacePyPrewarmQueue.length) return;
    const ownerDoc = workspacePyPrewarmQueue.shift();
    workspacePyPrewarmBusy = true;
    workspacePyPrewarmOwner = ownerDoc;
    let outcome = { remaining:false };
    const start = () => runWorkspacePythonPrewarm(ownerDoc)
      .then(result => { outcome = result || outcome; })
      .catch(e => console.warn("작업공간 자동완성 인덱스 준비 실패:", e))
      .finally(() => {
        workspacePyPrewarmBusy = false;
        workspacePyPrewarmOwner = null;
        if (outcome.remaining) {
          if (!workspacePyPrewarmQueue.includes(ownerDoc)) workspacePyPrewarmQueue.push(ownerDoc);
        } else {
          const callbacks = workspacePyPrewarmCallbacks.get(ownerDoc);
          workspacePyPrewarmCallbacks.delete(ownerDoc);
          if (callbacks) for (const callback of callbacks) try { callback(); } catch(_){ }
        }
        drainWorkspacePythonPrewarmQueue();
      });
    if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout:2000 });
    else setTimeout(start, 200);
  }
  function workspacePythonPrewarmReady(ownerDoc){
    if (!ownerDoc || !workspacePythonImportTargets(ownerDoc).rows.some(row => workspacePyText(row.doc) == null))
      return Promise.resolve();
    return new Promise(resolve => scheduleWorkspacePythonPrewarm(ownerDoc, resolve));
  }
  // 작업공간 모듈 색인(자동 import 후보 · import 문 완성이 함께 쓴다).
  // 타이핑마다 모든 .py 를 다시 훑지 않도록 지난 색인을 재사용한다. 재사용 판정은 본문 문자열
  // 비교 — 안 바뀐 파일은 같은 문자열 객체라 사실상 즉시 끝나고, 한 글자만 바뀌어도 정확히 걸린다.
  let workspacePyIndexMemo = null;
  function workspacePyIndexMemoHit(currentPath, projectRoot, entries){
    const memo = workspacePyIndexMemo;
    if (!memo || memo.currentPath !== currentPath || memo.projectRoot !== projectRoot) return null;
    if (memo.entries.length !== entries.length) return null;
    for (let i = 0; i < entries.length; i++){
      if (memo.entries[i].path !== entries[i].path || memo.entries[i].source !== entries[i].source
        || memo.entries[i].unreadable !== entries[i].unreadable) return null;
    }
    return memo.index;
  }
  function workspacePythonModuleIndex(ownerDoc){
    if (!ownerDoc || typeof pythonWorkspaceModuleIndex !== "function") return null;
    const targets = workspacePythonImportTargets(ownerDoc);
    const entries = [];
    let missing = false;
    for (const row of targets.rows){
      const source = workspacePyText(row.doc);
      if (source == null){ missing = true; continue; }
      entries.push({ path:row.path, source, unreadable:workspacePyUnreadable.has(row.doc.id) });
    }
    if (missing) scheduleWorkspacePythonPrewarm(ownerDoc);   // 아직 못 읽은 파일은 백그라운드로 채운다
    // import 문(from 패키지…)과 __init__.py 로 추정한 실행 기준 폴더를 넘긴다 — 실행 때 통하는
    // 경로와 같은 모양으로 자동 import 를 넣기 위해서다(추정 실패면 가까운 폴더 기준 그대로).
    const ownerSource = workspacePyText(ownerDoc);
    let projectRoot = null;
    if (typeof inferOpenPythonProjectRoot === "function"){
      projectRoot = inferOpenPythonProjectRoot(targets.currentPath, ownerSource == null ? "" : ownerSource,
        entries.map(entry => entry.path));
    }
    const hit = workspacePyIndexMemoHit(targets.currentPath, projectRoot, entries);
    if (hit) return hit;
    const index = pythonWorkspaceModuleIndex(targets.currentPath, entries,
      projectRoot == null ? {} : { projectRoot });
    workspacePyIndexMemo = { currentPath:targets.currentPath, projectRoot, entries, index };
    // 색인이 실제로 바뀐 이 순간에만 서버 미러도 갱신한다(Jedi 가 프로젝트 모듈을 알게 하는 D 경로).
    // 현재 파일은 완성 요청에 본문을 그대로 실어 보내므로, 미러에는 저장된 상태로 들어가도 된다.
    if (typeof scheduleJediProjectSync === "function"){
      const ownerPath = targets.currentPath;
      const files = ownerSource == null ? entries : [...entries, { path:ownerPath, source:ownerSource }];
      scheduleJediProjectSync(files.filter(file => file.path));
    }
    return index;
  }
  // 열린 작업공간의 Python 문서를 읽어 로컬 자동 import 후보를 만든다.
  function workspacePythonImportCandidates(ownerDoc){
    const index = workspacePythonModuleIndex(ownerDoc);
    if (!index || typeof pythonWorkspaceImportRowsFromIndex !== "function") return [];
    return pythonWorkspaceImportRowsFromIndex(index);
  }
  // 실행 기준 폴더(sys.path 루트) 추정값 — 자동 import 경로와 Jedi 프로젝트 루트가 같은 값을 쓴다.
  function workspacePythonProjectRoot(ownerDoc){
    workspacePythonModuleIndex(ownerDoc);
    const memo = workspacePyIndexMemo;
    return memo && memo.projectRoot ? memo.projectRoot : "";
  }
  // 작업공간 모듈 색인으로 import 경로·이름을 검사한다(파이썬 진단 하니스는 import 대상의 실존을
  // 확인하지 않는다 — 없는 모듈이든 없는 함수든 이름만 있으면 정의된 것으로 친다).
  // 아직 못 읽은 .py 가 하나라도 있으면 "없다"고 말할 근거가 부족하므로 통째로 건너뛴다.
  function workspacePythonImportAnalysis(ownerDoc, source, onReady){
    const empty = { problems:[], resolvedKeys:[] };
    if (!ownerDoc || typeof pythonWorkspaceImportAnalysis !== "function") return empty;
    const rows = workspacePythonImportTargets(ownerDoc).rows;
    if (!rows.length) return empty;
    if (rows.some(row => workspacePyText(row.doc) == null)){
      scheduleWorkspacePythonPrewarm(ownerDoc, onReady);
      return empty;
    }
    const index = workspacePythonModuleIndex(ownerDoc);
    if (!index || !index.files.length) return empty;
    try { return pythonWorkspaceImportAnalysis(source, index); }
    catch(e){ console.warn("import 검사 실패:", e); return empty; }
  }
  function workspacePythonImportDiagnostics(ownerDoc, source, onReady){
    return workspacePythonImportAnalysis(ownerDoc, source, onReady).problems;
  }
  // Jedi 가 미러 안에서 찾은 정의를 원래 작업공간 탭으로 되돌려 연다(임시 복사본을 열지 않도록).
  async function openWorkspaceDefinitionTarget(ownerDoc, hit){
    if (!ownerDoc || !hit || !hit.path) return false;
    const wanted = String(hit.path).replace(/\\/g, "/").replace(/^\/+/, "");
    const docPath = (doc) => String((doc && (doc.workspacePath || doc.relPath || doc.name)) || "")
      .replace(/\\/g, "/").replace(/^\/+/, "");
    const context = ownerDoc.archiveCtx || null;
    const scoped = docs.filter(doc => doc && (typeof workspaceHasDoc !== "function" || workspaceHasDoc(doc)) && (doc.archiveCtx || null) === context && docPath(doc) === wanted);
    const target = scoped.find(doc => ownerDoc.parentId != null && doc.parentId === ownerDoc.parentId) || scoped[0];
    if (!target) return false;
    const line = Math.max(1, Number(hit.line) || 1);
    const focus = { column:Math.max(0, Number(hit.column) || 0), length:Math.max(1, String(hit.name || "").length) };
    target.pendingFocusLine = line;
    target.pendingFocusOptions = focus;
    setActiveDoc(target.id);
    const navigator = target.codeEditor || target.codeViewer;
    if (navigator && navigator.focusLine) navigator.focusLine(line, focus);
    toast("작업공간의 정의로 이동했습니다.", 1600);
    return true;
  }

  function workspacePythonModuleCandidates(ownerDoc, context){
    if (!context || typeof pythonWorkspaceModuleRowsFromIndex !== "function") return [];
    const index = workspacePythonModuleIndex(ownerDoc);
    return index ? pythonWorkspaceModuleRowsFromIndex(index, context) : [];
  }

  return {
    isDefinitionSourceDoc, openWorkspacePythonImportDefinition, workspacePyStamp, workspacePyText, workspacePythonImportTargets, pruneWorkspacePyTextCache, runWorkspacePythonPrewarm, scheduleWorkspacePythonPrewarm, drainWorkspacePythonPrewarmQueue, workspacePythonPrewarmReady, workspacePyIndexMemoHit, workspacePythonModuleIndex, workspacePythonImportCandidates, workspacePythonProjectRoot, workspacePythonImportAnalysis, workspacePythonImportDiagnostics, openWorkspaceDefinitionTarget, workspacePythonModuleCandidates, workspacePyTextCache
  };
})();

if (typeof module === "object" && module.exports) module.exports = MNWorkspacePython;
