"use strict";

function notebookRunContext(ownerDoc){
  return {
    ownerDoc,
    archiveCtx:ownerDoc && ownerDoc.archiveCtx || null,
    relPath:normalizedRunPath(ownerDoc && (ownerDoc.relPath || ownerDoc.workspacePath || ownerDoc.name))
  };
}

async function buildNotebookWorkspaceBundle(ownerDoc){
  if (!ownerDoc || !ownerDoc.archiveCtx || typeof ownerDoc.archiveCtx.extract !== "function") return null;
  if (ownerDoc._nbWorkspacePromise) return ownerDoc._nbWorkspacePromise;
  ownerDoc._nbWorkspacePromise = (async () => {
    const runCtx = notebookRunContext(ownerDoc);
    const archive = runCtx.archiveCtx;
    const target = runCtx.relPath || normalizedRunPath(ownerDoc.name || "notebook.ipynb");
    const source = notebookCodeSource(ownerDoc.notebookModel);
    const projectScope = archive.paths
      ? buildArchiveScopeFilter(target, source, archive.paths, archive.directories || [])
      : null;
    let files;
    let scopeFilter = null;
    try {
      // 보통은 같은 폴더 묶음을 통째로 올려, 뒤 셀에서 새 경로를 사용해도 다시 마운트할 필요가 없게 한다.
      files = await archive.extract();
    } catch(error){
      if (String(error && error.message).indexOf("too-large") < 0) throw error;
      // 큰 프로젝트는 현재 노트북에서 참조한 데이터·모듈만 기존 .py 실행 규칙으로 좁힌다.
      scopeFilter = projectScope;
      files = await archive.extract(scopeFilter || undefined);
    }
    files = mergeRuntimeFiles(runCtx, files, scopeFilter || undefined);
    const total = files.reduce((sum, file) => sum + (file.bytes ? file.bytes.length : 0), 0);
    if (total > RUN_BUNDLE_CAP) throw new Error("노트북 작업폴더가 50MB를 넘어 함께 열 수 없어요.");
    // 일반 Python과 동일하게 노트북 파일이 있는 폴더를 자동 실행 기준으로 사용한다.
    // 상위·형제 파일은 ../dataIn/result01.csv처럼 실제 상대경로로 참조한다.
    const cwd = normalizedRunPath(projectScope && projectScope.cwd) || runPathDir(target);
    return {
      files,
      dirs:(scopeFilter && scopeFilter.directories || archive.directories || []).map(normalizedRunPath).filter(Boolean),
      cwd,
      target,
      logicalRoot:commonTopDir(files.map(file => file.path)) || ""
    };
  })().catch(error => {
    ownerDoc._nbWorkspacePromise = null;
    throw error;
  });
  return ownerDoc._nbWorkspacePromise;
}

function notebookWorkspaceImports(bundle){
  const names = new Set();
  if (!bundle || !Array.isArray(bundle.files)) return names;
  const cwd = normalizedRunPath(bundle.cwd);
  for (const file of bundle.files){
    let path = normalizedRunPath(file.path);
    if (cwd && path.indexOf(cwd + "/") === 0) path = path.slice(cwd.length + 1);
    if (!path || path.indexOf("../") === 0) continue;
    const parts = path.split("/");
    if (parts.length === 1 && /\.py$/i.test(parts[0])){
      const name = parts[0].replace(/\.py$/i, "");
      if (/^[A-Za-z_]\w*$/.test(name)) names.add(name);
    } else if (parts.length > 1 && /^[A-Za-z_]\w*$/.test(parts[0])){
      names.add(parts[0]);
    }
  }
  return names;
}

function notebookKernelModeLabel(mode){
  const label = mode === "local" ? "노트북 · 로컬 Python" : "노트북 · 브라우저";
  return typeof window !== "undefined" && typeof window.t === "function" ? window.t(label) : label;
}

function notebookRequiresLocalPython(source){
  const code = String(source || "");
  return /(^|\n)\s*(?:from\s+selenium(?:\.|\s+import\b)|import\s+selenium(?:\.|\s|,|$))/m.test(code) ||
    /(^|\n)\s*(?:from\s+playwright(?:\.|\s+import\b)|import\s+playwright(?:\.|\s|,|$))/m.test(code);
}

function nbShowLocalPythonInstallGuide(ownerDoc){
  const message = "이 크롤링은 로컬 Python이 필요합니다. Python을 설치할 때 'Add python.exe to PATH'를 선택한 뒤 만능파일교실을 다시 실행해 주세요.";
  if (typeof toast === "function") toast(message, 7000);
  nbSetStatus(ownerDoc, "로컬 Python 설치 필요 · 설치 후 앱 다시 실행");
}

function nbRefreshKernelModeUi(ownerDoc){
  if (!ownerDoc) return;
  // 자바스크립트 노트북에는 로컬 Python 이 해당 없다 — 관련 버튼을 감추고 커널 이름만 알린다.
  if (notebookLanguageOf(ownerDoc.notebookModel) === "javascript"){
    if (ownerDoc._nbLocalKernelBtn) ownerDoc._nbLocalKernelBtn.hidden = true;
    if (ownerDoc._nbLocalRunBtn) ownerDoc._nbLocalRunBtn.hidden = true;
    if (ownerDoc._nbKernelTag){
      ownerDoc._nbKernelTag.textContent = "브라우저 자바스크립트";
      ownerDoc._nbKernelTag.classList.remove("is-local");
    }
    return;
  }
  const local = ownerDoc._nbKernelMode === "local";
  const missing = ownerDoc._nbLocalPythonAvailable === false;
  if (ownerDoc._nbKernelTag){
    ownerDoc._nbKernelTag.textContent = notebookKernelModeLabel(ownerDoc._nbKernelMode);
    ownerDoc._nbKernelTag.classList.toggle("is-local", local);
  }
  if (ownerDoc._nbLocalKernelBtn){
    const label = local
      ? "브라우저 Python(Pyodide)으로 돌아가기"
      : (missing ? "로컬 Python 설치 필요" : "로컬 Python 셀 커널 사용");
    const title = missing
      ? "Selenium 크롤링을 사용하려면 PC에 Python을 설치하고 앱을 다시 실행해야 합니다."
      : local
      ? "현재 셀 실행은 PC의 로컬 Python을 사용합니다. 누르면 브라우저 커널로 돌아갑니다."
      : "셀마다 PC의 로컬 Python으로 실행하고 변수·Selenium 브라우저 상태를 다음 셀까지 유지합니다.";
    ownerDoc._nbLocalKernelBtn.textContent = typeof window !== "undefined" && typeof window.t === "function" ? window.t(label) : label;
    ownerDoc._nbLocalKernelBtn.title = typeof window !== "undefined" && typeof window.t === "function" ? window.t(title) : title;
    ownerDoc._nbLocalKernelBtn.classList.toggle("is-active", local);
    ownerDoc._nbLocalKernelBtn.classList.toggle("is-missing", missing);
  }
  if (ownerDoc._nbLocalRunBtn){
    const label = missing ? "로컬 Python 전체 실행 · 설치 필요" : "로컬 Python 전체 1회 실행";
    ownerDoc._nbLocalRunBtn.textContent = typeof window !== "undefined" && typeof window.t === "function" ? window.t(label) : label;
    ownerDoc._nbLocalRunBtn.classList.toggle("is-missing", missing);
  }
}

async function nbStopLocalNotebookKernel(ownerDoc, options={}){
  if (!ownerDoc) return;
  const id = ownerDoc._nbLocalKernelId;
  ownerDoc._nbLocalKernelId = null;
  ownerDoc._nbLocalKernelStart = null;
  if (!id) return;
  try {
    await fetch("/python-kernel-stop?id=" + encodeURIComponent(id), {
      method:"POST",
      keepalive:!!options.keepalive
    });
  } catch(_){}
}

// pip 설치로 이미 import 된 라이브러리의 코드가 바뀔 수 있으므로, 로컬 커널은 다음 셀 실행 전에 새로 만든다.
// 출력은 학습 기록으로 남기되 변수·Selenium 등 커널 안의 상태는 초기화된다.
async function nbRestartLocalKernelAfterPackageInstall(ownerDoc){
  if (!ownerDoc) return false;
  const hadKernel = !!(ownerDoc._nbLocalKernelId || ownerDoc._nbLocalKernelStart);
  await nbStopLocalNotebookKernel(ownerDoc);
  ownerDoc._nbExec = 0;
  ownerDoc._nbWorkspacePromise = null;
  return hadKernel;
}

async function nbToggleLocalKernelMode(ownerDoc){
  if (!ownerDoc || ownerDoc._nbBusy || ownerDoc._nbRunAllActive || ownerDoc._nbLocalRunActive) return;
  if (ownerDoc._nbKernelMode === "local"){
    await nbStopLocalNotebookKernel(ownerDoc);
    ownerDoc._nbKernelMode = "browser";
    ownerDoc._nbExec = 0;
    nbClearOutputs(ownerDoc);
    nbRefreshKernelModeUi(ownerDoc);
    nbSetStatus(ownerDoc, "브라우저 커널(Pyodide)로 전환했어요.");
    return;
  }
  let backend = false;
  try { backend = await pythonBackendAvailable(); } catch(_){ backend = false; }
  if (!backend){
    ownerDoc._nbLocalPythonAvailable = false;
    nbRefreshKernelModeUi(ownerDoc);
    nbShowLocalPythonInstallGuide(ownerDoc);
    return;
  }
  if (!ownerDoc._nbLocalKernelConfirmed && typeof confirmDialog === "function"){
    const ok = await confirmDialog(
      "이 노트북의 셀을 이 컴퓨터에 설치된 Python으로 실행합니다.\n변수와 Selenium 브라우저 상태가 다음 셀까지 유지됩니다.\n신뢰할 수 있는 코드만 실행하세요.",
      "로컬 커널 사용", "취소");
    if (!ok) return;
    ownerDoc._nbLocalKernelConfirmed = true;
  }
  ownerDoc._nbKernelMode = "local";
  try { await startPyodideKernelRun({ kernelId:nbKernelId(ownerDoc), reset:true }).promise; } catch(_){}
  ownerDoc._nbExec = 0;
  nbClearOutputs(ownerDoc);
  nbRefreshKernelModeUi(ownerDoc);
  nbSetStatus(ownerDoc, "로컬 Python 셀 커널 선택됨 · 셀을 실행하면 시작합니다.");
}

function nbLocalKernelBundle(workspaceBundle){
  const marker = "__manneung_notebook_kernel__.py";
  if (!workspaceBundle){
    return {
      files:[{ path:marker, bytes:new Uint8Array(0) }],
      target:marker,
      cwd:"",
      dirs:[],
      logicalRoot:""
    };
  }
  const cwd = normalizedRunPath(workspaceBundle.cwd);
  const target = (cwd ? cwd + "/" : "") + marker;
  const files = workspaceBundle.files
    .filter(file => normalizedRunPath(file.path) !== target)
    .map(file => ({ path:file.path, bytes:file.bytes }));
  files.push({ path:target, bytes:new Uint8Array(0) });
  return {
    files,
    target,
    cwd,
    dirs:workspaceBundle.dirs || [],
    logicalRoot:workspaceBundle.logicalRoot || ""
  };
}

async function nbEnsureLocalNotebookKernel(ownerDoc, workspaceBundle){
  if (ownerDoc._nbLocalKernelId) return ownerDoc._nbLocalKernelId;
  if (ownerDoc._nbLocalKernelStart) return ownerDoc._nbLocalKernelStart;
  ownerDoc._nbLocalKernelStart = (async () => {
    const bundle = nbLocalKernelBundle(workspaceBundle);
    const body = buildPyBundle(bundle.files, bundle.target, "", bundle.cwd, bundle.dirs);
    const response = await fetch("/python-kernel-start-bundle", {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream" },
      body
    });
    if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
    const data = await response.json();
    if (!data || !data.id) throw new Error("로컬 Python 커널 ID를 받지 못했습니다.");
    ownerDoc._nbLocalKernelId = data.id;
    ownerDoc._nbLocalKernelBundled = !!workspaceBundle;
    return data.id;
  })();
  try { return await ownerDoc._nbLocalKernelStart; }
  catch(error){
    ownerDoc._nbLocalKernelStart = null;
    throw error;
  }
}

function startLocalNotebookKernelRun(ownerDoc, source, stdin, workspaceBundle){
  const controller = new AbortController();
  let cancelled = false;
  const promise = (async () => {
    const id = await nbEnsureLocalNotebookKernel(ownerDoc, workspaceBundle);
    if (cancelled) throw nbCancellationError();
    const response = await fetch("/python-kernel-exec?id=" + encodeURIComponent(id), {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream" },
      body:buildRunPayload(source, stdin || ""),
      signal:controller.signal
    });
    if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
    const result = await response.json();
    for (const output of (result.outputs || [])){
      if (!output || !output.name || Number(output.size) > 40 * 1024 * 1024) continue;
      try {
        const file = await fetch("/python-kernel-file?id=" + encodeURIComponent(id) + "&name=" + encodeURIComponent(output.name));
        if (file.ok) output.bytes = new Uint8Array(await file.arrayBuffer());
      } catch(_){}
    }
    return result;
  })().catch(error => {
    if (cancelled || (error && error.name === "AbortError")) throw nbCancellationError();
    throw error;
  });
  return {
    promise,
    cancel(){
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      nbStopLocalNotebookKernel(ownerDoc, { keepalive:true });
    }
  };
}

// 로컬 커널 셀에서 누락 모듈을 만났을 때 이 PC 의 Python 에 pip 로 설치한다(동의 후).
// 진행/결과는 노트북 상태줄·토스트로 알린다(.py 뷰어의 runPipInstall 은 별도 출력 패널을 요구해 재사용 대신 별도 구현).
// 다만 로그 스트리밍·취소는 pipInstallStream 을 공유한다 — 상태줄에 경과 시간과 pip 진행 줄을 함께 흘려,
// 몇 분짜리 설치에서도 멈춘 것처럼 보이지 않게 한다. 실행 바의 ■ 버튼이 그대로 설치 취소 버튼이 된다.
// 설치가 끝나면 로컬 커널을 재시작해, 이미 import 된 이전 버전이 남지 않도록 한다. 성공 여부 반환.
async function nbInstallMissingModule(ownerDoc, pkg){
  if (!pkg) return false;
  // .py 편집기와 같은 전역 잠금을 첫 await 전에 잡아 다른 탭·노트북의 pip 과 겹치지 않게 한다.
  if (!pipInstallTryLock()){
    nbSetStatus(ownerDoc, "이미 다른 라이브러리를 설치하는 중이에요. 끝나면 다시 실행해 주세요.");
    if (typeof toast === "function") toast("이미 라이브러리를 설치하는 중이에요", 2800);
    return false;
  }
  try {
    if (!(await pythonBackendAvailable())) return false;   // 브라우저 커널이면 자동 설치 대상 아님
    const approved = typeof confirmDialog === "function" && await confirmDialog(
      "이 노트북이 쓰는 로컬 Python 환경에 다음 패키지를 설치합니다.\n\n" + pkg +
      "\n\n패키지 저장소에 인터넷으로 연결될 수 있으며, 설치한 패키지는 이 컴퓨터에 남습니다. 신뢰하는 패키지만 설치하세요.",
      "설치", "취소");
    if (!approved){ nbSetStatus(ownerDoc, "패키지 설치를 취소했어요."); return false; }
    const startedAt = Date.now();
    let headline = "";
    const paint = () => {
      const el = pipElapsedText(Date.now() - startedAt);
      nbSetStatus(ownerDoc, "패키지 설치 중… " + pkg + " · " + el + (headline ? " · " + headline : ""));
    };
    paint();
    const timer = setInterval(paint, 1000);
    // 설치 중에는 노트북의 중지(■)가 셀 대신 pip 을 끊게 걸어 둔다. 끝나면 원래 작업으로 되돌린다.
    const prevTask = ownerDoc ? ownerDoc._nbActiveTask : null;
    try {
      const r = await pipInstallStream([pkg], {
        onLog: (text) => {
          const line = pipLogHeadline(text);
          if (line && line !== headline){ headline = line; paint(); }
        },
        onCancel: (cancel) => {
          if (!ownerDoc) return;
          ownerDoc._nbActiveTask = cancel ? { cancel } : prevTask;
          if (cancel && ownerDoc._nbCancelRequested) cancel();   // 설치를 시작하기 전에 이미 눌렀던 경우
        }
      });
      clearInterval(timer);
      if (r.ok){
        const took = pipElapsedText(Date.now() - startedAt);
        const restarted = await nbRestartLocalKernelAfterPackageInstall(ownerDoc);
        const suffix = restarted ? " · 커널 재시작됨" : "";
        if (typeof toast === "function") toast("설치 완료: " + pkg + suffix + " · 셀을 다시 실행합니다", 3600);
        nbSetStatus(ownerDoc, "설치 완료 ✓ · " + pkg + " · " + took + suffix);
      } else if (r.cancelled){
        if (typeof toast === "function") toast("설치를 취소했어요", 2600);
        nbSetStatus(ownerDoc, "설치 취소됨 · " + pkg);
      } else {
        if (typeof toast === "function") toast("설치 실패 — 아래 상태줄/로그를 확인하세요", 3200);
        nbSetStatus(ownerDoc, "설치 실패 (코드 " + r.code + ") · " + pkg + (headline ? " · " + headline : ""));
      }
      return !!r.ok;
    } catch(e){
      clearInterval(timer);
      nbSetStatus(ownerDoc, "설치 요청 실패: " + ((e && e.message) || e));
      return false;
    } finally {
      clearInterval(timer);
      if (ownerDoc) ownerDoc._nbActiveTask = prevTask;
    }
  } finally {
    pipInstallUnlock();
  }
}

// ── 로컬 파이썬 전체 실행(옵션 B) ─────────────────────────────────────────────
// 노트북 전체 코드를 이 PC에 설치된 '진짜' 파이썬으로 한 번에 실행한다. 브라우저 커널(Pyodide)에서
// 안 되는 코드(selenium 크롤링 등)를 위한 별도 경로로, 기존 셀별 실행은 전혀 건드리지 않는다.
// .py 뷰어의 로컬 세션 실행기(runPythonInteractive)를 그대로 재사용 → 입력(input)·생성 파일·이미지·변수까지 처리.
function nbEnsureLocalOutPanel(ownerDoc){
  let wrap = ownerDoc._nbLocalOutWrap;
  if (wrap && wrap.isConnected){ wrap.hidden = false; return ownerDoc._nbLocalOutPanel; }
  wrap = document.createElement("div");
  wrap.className = "nbv-local-out-wrap";
  const bar = document.createElement("div");
  bar.className = "nbv-local-out-bar";
  const title = document.createElement("span");
  title.className = "nbv-local-out-title";
  title.textContent = "로컬 파이썬 실행 결과";
  const close = document.createElement("button");
  close.type = "button"; close.className = "nbv-local-out-close"; close.textContent = "×";
  close.title = "결과 패널 닫기"; close.setAttribute("aria-label", "결과 패널 닫기");
  close.addEventListener("click", () => { wrap.hidden = true; });
  bar.append(title, close);
  const inner = document.createElement("div");
  inner.className = "code-output nbv-local-out";
  wrap.append(bar, inner);
  const root = ownerDoc._nbRoot;
  if (root) root.appendChild(wrap);
  ownerDoc._nbLocalOutWrap = wrap;
  ownerDoc._nbLocalOutPanel = inner;
  return inner;
}

async function nbRunNotebookLocalPython(ownerDoc){
  if (!ownerDoc) return;
  if (ownerDoc._nbLocalRunActive){ nbSetStatus(ownerDoc, "이미 로컬 파이썬으로 실행 중이에요."); return; }
  if (ownerDoc._nbBusy || ownerDoc._nbRunAllActive){ nbSetStatus(ownerDoc, "브라우저 커널 실행이 끝난 뒤 다시 눌러 주세요."); return; }
  ownerDoc._nbLocalRunActive = true;
  try { return await nbRunNotebookLocalPythonOnce(ownerDoc); }
  finally {
    ownerDoc._nbLocalRunActive = false;
    ownerDoc._nbLocalCancel = null;
  }
}

async function nbRunNotebookLocalPythonOnce(ownerDoc){
  let backend = false;
  try { backend = await pythonBackendAvailable(); } catch(_){ backend = false; }
  if (!backend){
    ownerDoc._nbLocalPythonAvailable = false;
    nbRefreshKernelModeUi(ownerDoc);
    nbShowLocalPythonInstallGuide(ownerDoc);
    return;
  }

  const script = notebookCodeSource(ownerDoc.notebookModel);
  if (!script.trim()){ nbSetStatus(ownerDoc, "실행할 코드 셀이 없어요."); return; }

  // 신뢰 확인(노트북별 1회). PC의 진짜 파이썬으로 임의 코드를 실행하므로 한 번 동의를 받는다.
  if (!ownerDoc._nbLocalPyConfirmed && typeof confirmDialog === "function"){
    const ok = await confirmDialog(
      "이 노트북의 모든 코드 셀을 이 컴퓨터에 설치된 파이썬으로 한 번에 실행합니다.\n신뢰할 수 있는 코드만 실행하세요.",
      "실행", "취소");
    if (!ok){ nbSetStatus(ownerDoc, "취소됨"); return; }
    ownerDoc._nbLocalPyConfirmed = true;
  }

  // 옆 파일(dataIn 등) 워크스페이스를 모아 번들로 만들고, 노트북 코드를 실행용 .py 로 끼워 넣는다.
  // 워크스페이스가 없거나(단독 노트북) 너무 크면 옆 파일 없이 코드만 실행한다.
  let bundle = null;
  try {
    const ws = await buildNotebookWorkspaceBundle(ownerDoc);
    if (ws && Array.isArray(ws.files)){
      const cwd = normalizedRunPath(ws.cwd);
      const scriptRel = (cwd ? cwd + "/" : "") + "__manneung_notebook_run__.py";
      const files = ws.files.filter(f => normalizedRunPath(f.path) !== scriptRel);
      files.push({ path: scriptRel, bytes: new TextEncoder().encode(script) });
      bundle = { files, target: scriptRel, cwd, dirs: ws.dirs || [], logicalRoot: ws.logicalRoot || "" };
    }
  } catch(error){
    if (String(error && error.message).indexOf("too-large") >= 0 && typeof toast === "function")
      toast("작업폴더가 커서(>50MB) 옆 파일 없이 코드만 실행해요.", 3500);
    bundle = null;
  }

  const outPanel = nbEnsureLocalOutPanel(ownerDoc);
  try { outPanel.parentNode.scrollIntoView({ block: "nearest" }); } catch(_){}
  const ui = { outPanel, running: true, keepEditorFocus: false, rerun: () => { nbRunNotebookLocalPython(ownerDoc); }, cancelRun: null };
  ui.cancelRun = () => { if (typeof ownerDoc._nbLocalCancel === "function") ownerDoc._nbLocalCancel(); };
  const hooks = { bindCancel: (fn) => { ownerDoc._nbLocalCancel = (typeof fn === "function") ? fn : null; } };

  nbSetStatus(ownerDoc, bundle ? "로컬 파이썬으로 실행 중… (옆 파일 포함)" : "로컬 파이썬으로 실행 중…");
  try {
    const result = await runPythonInteractive(script, bundle, ui, hooks);
    nbSetStatus(ownerDoc, (result && result.code) ? "로컬 실행이 오류로 끝났어요 (아래 결과 확인)." : "로컬 파이썬 실행 완료 ✓");
    if (typeof petReact === "function") petReact((result && result.code) ? "error" : "success");   // 펫들이 결과에 반응
  } catch(error){
    nbSetStatus(ownerDoc, nbTf("로컬 실행 실패: {message}", { message:(error && error.message) || error }));
  } finally {
    ui.running = false;
    ownerDoc._nbLocalCancel = null;
  }
}

function nbInkState(ownerDoc){
  if (!ownerDoc._nbInkState){
    ownerDoc._nbInkState = { tool:"pen", color:"#e11d48", width:3 };
  }
  return ownerDoc._nbInkState;
}

function nbInkTargetCtrl(ownerDoc){
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  if (ownerDoc && ownerDoc._nbInkTarget && ctrls.includes(ownerDoc._nbInkTarget)) return ownerDoc._nbInkTarget;
  const selected = ctrls[ownerDoc && ownerDoc._nbSelected];
  return selected || null;
}

function nbSyncInkSurfaces(ownerDoc){
  if (!ownerDoc) return;
  const state = nbInkState(ownerDoc);
  const drawing = !!ownerDoc._nbInkMode && state.tool !== "move";
  if (ownerDoc._nbRoot){
    ownerDoc._nbRoot.classList.toggle("nbv-ink-mode", !!ownerDoc._nbInkMode);
    ownerDoc._nbRoot.classList.toggle("nbv-ink-move", !!ownerDoc._nbInkMode && state.tool === "move");
  }
  for (const ctrl of (ownerDoc._nbCtrls || [])){
    if (ctrl.inkSurface) ctrl.inkSurface.setDrawing(drawing);
    if (ctrl.editor && ctrl.editor.ta){
      const readonly = !!ownerDoc._nbInkMode || !!ownerDoc._studyReadonly;
      ctrl.editor.ta.readOnly = readonly;
      ctrl.editor.ta.setAttribute("aria-readonly", String(readonly));
    }
  }
}

function nbSetInkMode(ownerDoc, on){
  if (!ownerDoc) return;
  ownerDoc._nbInkMode = !!on;
  if (ownerDoc._nbInkToolbar) ownerDoc._nbInkToolbar.hidden = !ownerDoc._nbInkMode;
  // 켜질 때(숨김→표시) 저장해 둔 위치·세로 상태를 복원. 숨김 중엔 크기가 0 이라 표시 뒤 다음 프레임에 적용.
  if (ownerDoc._nbInkMode && ownerDoc._nbInkToolbar && ownerDoc._nbInkToolbar.__applySavedPos){
    const bar = ownerDoc._nbInkToolbar;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => bar.__applySavedPos());
    else bar.__applySavedPos();
  }
  if (ownerDoc._nbInkButton){
    ownerDoc._nbInkButton.classList.toggle("active", ownerDoc._nbInkMode);
    ownerDoc._nbInkButton.setAttribute("aria-pressed", String(ownerDoc._nbInkMode));
  }
  nbSyncInkSurfaces(ownerDoc);
  if (ownerDoc._nbInkMode && ownerDoc._nbSelected < 0 && (ownerDoc._nbCtrls || []).length){
    nbSetSelected(ownerDoc, 0, {});
  }
}

function nbUndoInk(ownerDoc){
  const ctrl = nbInkTargetCtrl(ownerDoc);
  if (!ctrl || !ctrl.inkSurface || !ctrl.inkSurface.strokes.length){
    if (typeof toast === "function") toast("선택한 셀에 되돌릴 필기가 없어요.", 1600);
    return;
  }
  ctrl.inkSurface.strokes.pop();
  notebookDropEmptyInkMetadata(ctrl.cell);
  ctrl.inkSurface.redraw();
}

function nbClearInk(ownerDoc){
  const ctrl = nbInkTargetCtrl(ownerDoc);
  if (!ctrl || !ctrl.inkSurface || !ctrl.inkSurface.strokes.length){
    if (typeof toast === "function") toast("선택한 셀에 지울 필기가 없어요.", 1600);
    return;
  }
  ctrl.inkSurface.strokes.length = 0;
  notebookDropEmptyInkMetadata(ctrl.cell);
  ctrl.inkSurface.redraw();
  if (typeof toast === "function") toast("선택한 셀의 필기를 지웠어요.", 1400);
}

// 노트북 전체 셀의 필기를 한 번에 지운다(셀 지우기처럼 바로 지운다).
// opts.silent 이면 토스트를 띄우지 않는다(필기 끄면서 함께 지울 때 사용).
function nbClearAllInk(ownerDoc, opts){
  opts = opts || {};
  const ctrls = (ownerDoc && ownerDoc._nbCtrls) || [];
  const total = ctrls.reduce((sum, ctrl) =>
    sum + (ctrl.inkSurface && ctrl.inkSurface.strokes ? ctrl.inkSurface.strokes.length : 0), 0);
  if (!total){
    if (!opts.silent && typeof toast === "function") toast("지울 필기가 없어요.", 1600);
    return;
  }
  for (const ctrl of ctrls){
    if (!ctrl.inkSurface || !ctrl.inkSurface.strokes.length) continue;
    ctrl.inkSurface.strokes.length = 0;
    notebookDropEmptyInkMetadata(ctrl.cell);
    ctrl.inkSurface.redraw();
  }
  if (!opts.silent && typeof toast === "function") toast("모든 셀의 필기를 지웠어요.", 1600);
}

// 키보드 단축키 치트시트 — 학습자가 주피터식 단축키를 바로 찾아볼 수 있는 모달 패널.
const NB_SHORTCUT_GROUPS = [
  ["실행", [
    ["Ctrl+Enter", "현재 셀 실행"],
    ["Shift+Enter", "실행하고 다음 셀로"],
    ["Ctrl+S", ".ipynb 로 저장"]
  ]],
  ["셀 다루기 (셀 테두리 선택 = 명령 모드)", [
    ["Enter", "셀 편집 시작"],
    ["Esc", "편집 끝내고 명령 모드로"],
    ["A / B", "위 / 아래에 코드 셀 추가"],
    ["M / Y", "마크다운 셀 / 코드 셀로 바꾸기"],
    ["D, D", "셀 삭제 (D 를 연속 두 번)"],
    ["↑ / ↓  또는  K / J", "셀 이동 선택"],
    ["Shift+↑ / ↓", "여러 셀 선택"],
    ["Ctrl+C / X / V", "셀 복사 / 잘라내기 / 붙여넣기"],
    ["Ctrl+Z / Ctrl+Y", "셀 작업 되돌리기 / 다시 실행"]
  ]],
  ["편집기 안에서", [
    ["Tab / Shift+Tab", "들여쓰기 / 내어쓰기"],
    ["Shift+Tab · Alt+클릭", "함수 도움말(설명) 보기 — 이름 뒤에서"],
    ["Ctrl+클릭", "정의로 이동"],
    ["Ctrl+↑ / ↓", "위 / 아래 셀 편집으로 이동"],
    ["Ctrl+Home / End", "노트북 처음 / 끝으로 이동"]
  ]],
  ["찾기", [
    ["Ctrl+F", "노트북 전체 찾기·바꾸기"],
    ["Ctrl+Shift+H", "현재 셀 안에서 찾기·바꾸기"]
  ]]
];

function nbBuildShortcutSheet(ownerDoc){
  const overlay = document.createElement("div");
  overlay.className = "nbv-help-overlay"; overlay.hidden = true;
  overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "키보드 단축키");
  const panel = document.createElement("div"); panel.className = "nbv-help-panel";
  const head = document.createElement("div"); head.className = "nbv-help-head";
  const title = document.createElement("strong"); title.textContent = "키보드 단축키";
  const close = document.createElement("button"); close.type = "button"; close.className = "nbv-help-close"; close.textContent = "×"; close.title = "닫기 (Esc)";
  head.append(title, close);
  const body = document.createElement("div"); body.className = "nbv-help-body";
  for (const [groupName, rows] of NB_SHORTCUT_GROUPS){
    const section = document.createElement("div"); section.className = "nbv-help-group";
    const gh = document.createElement("div"); gh.className = "nbv-help-group-title"; gh.textContent = groupName;
    section.appendChild(gh);
    for (const [keys, desc] of rows){
      const row = document.createElement("div"); row.className = "nbv-help-row";
      const kbd = document.createElement("kbd"); kbd.className = "nbv-help-keys"; kbd.textContent = keys;
      const txt = document.createElement("span"); txt.className = "nbv-help-desc"; txt.textContent = desc;
      row.append(kbd, txt); section.appendChild(row);
    }
    body.appendChild(section);
  }
  const foot = document.createElement("div"); foot.className = "nbv-help-foot";
  foot.textContent = "명령 모드는 셀 테두리를 클릭해 파란 선택 상태일 때예요. Esc 로 언제든 닫을 수 있어요.";
  panel.append(head, body, foot);
  overlay.appendChild(panel);
  close.addEventListener("click", () => nbToggleShortcutSheet(ownerDoc, false));
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) nbToggleShortcutSheet(ownerDoc, false); });
  return overlay;
}

function nbToggleShortcutSheet(ownerDoc, force){
  if (!ownerDoc) return;
  const overlay = ownerDoc._nbHelpOverlay;
  if (!overlay) return;
  const open = typeof force === "boolean" ? force : overlay.hidden;
  overlay.hidden = !open;
  if (ownerDoc._nbHelpButton) ownerDoc._nbHelpButton.classList.toggle("active", open);
  if (open){
    // 문서 캡처 단계에서 Esc 를 먼저 받아 노트북 단축키보다 앞서 닫는다.
    const onKey = (e) => {
      if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); nbToggleShortcutSheet(ownerDoc, false); }
    };
    ownerDoc._nbHelpKeyHandler = onKey;
    document.addEventListener("keydown", onKey, true);
    const closeBtn = overlay.querySelector(".nbv-help-close");
    if (closeBtn) closeBtn.focus();
  } else if (ownerDoc._nbHelpKeyHandler){
    document.removeEventListener("keydown", ownerDoc._nbHelpKeyHandler, true);
    ownerDoc._nbHelpKeyHandler = null;
  }
}

function nbBuildInkToolbar(ownerDoc){
  const bar = document.createElement("div");
  bar.className = "nbv-ink-toolbar";
  bar.hidden = true;
  const state = nbInkState(ownerDoc);
  // 드래그 핸들 — py 필기 바처럼 바를 자유롭게(노트북 영역 밖까지) 옮긴다.
  const drag = document.createElement("span");
  drag.className = "nbv-ink-drag";
  drag.title = "끌어서 위치 옮기기";
  drag.textContent = "⋮⋮";
  bar.appendChild(drag);
  bar.appendChild(Object.assign(document.createElement("span"), { className:"nbv-ink-sep" }));
  const mk = (label, title, cls, fn) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = cls || "";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", fn);
    return button;
  };
  const mkIcon = (name, fallback, title, cls, fn) => {
    const button = mk("", title, cls, fn);
    if (typeof window.setUiIcon === "function") window.setUiIcon(button, name, title);
    else button.textContent = fallback;
    return button;
  };
  const tools = {};
  const syncTools = () => {
    for (const key in tools) tools[key].classList.toggle("active", key === state.tool);
    nbSyncInkSurfaces(ownerDoc);
  };
  [
    ["move","move","이동","이동·셀 선택"],
    ["pen","pen","펜","펜"],
    ["highlighter","highlighter","형광펜","형광펜"],
    ["eraser","eraser","지우개","지우개"]
  ].forEach(([key, name, fallback, title]) => {
    tools[key] = mkIcon(name, fallback, title, "nbv-ink-tool", () => { state.tool = key; syncTools(); });
    bar.appendChild(tools[key]);
  });
  const sep = () => Object.assign(document.createElement("span"), { className:"nbv-ink-sep" });
  bar.appendChild(sep());
  const swatches = {};
  const custom = document.createElement("input");
  const setColor = (color) => {
    state.color = color;
    for (const key in swatches) swatches[key].classList.toggle("active", key === color);
    custom.value = color;
  };
  ["#e11d48","#111111","#2563eb","#16a34a","#f59e0b"].forEach(color => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "nbv-ink-swatch";
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", () => setColor(color));
    swatches[color] = swatch;
    bar.appendChild(swatch);
  });
  custom.type = "color";
  custom.className = "nbv-ink-color";
  custom.title = "색 직접 고르기";
  custom.addEventListener("input", () => setColor(custom.value));
  bar.append(custom, sep());
  const widths = {};
  const setWidth = (width) => {
    state.width = width;
    for (const key in widths) widths[key].classList.toggle("active", Number(key) === width);
  };
  [[2,"S"],[3,"M"],[6,"L"]].forEach(([width, label]) => {
    widths[width] = mk(label, "굵기 " + label, "nbv-ink-width", () => setWidth(width));
    bar.appendChild(widths[width]);
  });
  bar.append(
    sep(),
    mkIcon("undo", "되돌리기", "선택한 셀의 마지막 필기 되돌리기", "nbv-ink-action", () => nbUndoInk(ownerDoc)),
    mk("셀 지우기", "선택한 셀의 필기 전체 지우기", "nbv-ink-action", () => nbClearInk(ownerDoc)),
    mk("전체 지우기", "모든 셀의 필기 지우기", "nbv-ink-action", () => nbClearAllInk(ownerDoc)),
    mkIcon("close", "닫기", "필기 전체 지우고 끄기", "nbv-ink-action", () => { nbClearAllInk(ownerDoc, { silent:true }); nbSetInkMode(ownerDoc, false); })
  );
  setColor(state.color);
  setWidth(state.width);
  syncTools();
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);

  // 자유 배치 드래그 — position:fixed 라 좌표는 뷰포트 기준. 화면 밖으로 못 나가게 여백 8px 로 가둔다.
  // 좌/우 끝(가장자리 근처)으로 끌면 세로 막대로 자동 전환한다(PDF 펜 바와 동일).
  const setAbs = (x, y) => {
    bar.style.left = x + "px";
    bar.style.top = y + "px";
    bar.style.right = "auto";
    bar.style.bottom = "auto";
    bar.style.transform = "none";
  };
  const setVertical = (v) => bar.classList.toggle("vertical", !!v);
  // 위치·세로 여부를 저장/복원(뷰포트 좌표). 모든 노트북이 같은 배치를 공유한다.
  const readPos = () => { try { const v = localStorage.getItem(NB_INK_BAR_POS_KEY); if (v && v.charAt(0) === "{") return JSON.parse(v); } catch(_){} return null; };
  const savePos = (p) => { try { localStorage.setItem(NB_INK_BAR_POS_KEY, JSON.stringify(p)); } catch(_){} };
  const applySaved = () => {
    const p = readPos(); if (!p) return;
    setVertical(!!p.vertical);
    const br = bar.getBoundingClientRect();
    if (!br.width && !br.height) return;                 // 아직 숨김 상태 → 표시 후 다시 호출됨
    const w = (typeof window !== "undefined" ? window.innerWidth : 0) || 0;
    const h = (typeof window !== "undefined" ? window.innerHeight : 0) || 0;
    const x = Math.max(8, Math.min(Number(p.x) || 0, Math.max(8, w - br.width - 8)));
    const y = Math.max(8, Math.min(Number(p.y) || 0, Math.max(8, h - br.height - 8)));
    setAbs(x, y);
  };
  bar.__applySavedPos = applySaved;
  let dragging = null;
  drag.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    drag.setPointerCapture(e.pointerId);
    const br = bar.getBoundingClientRect();
    dragging = { dx:e.clientX - br.left, dy:e.clientY - br.top, barW:br.width, barH:br.height };
  });
  drag.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const w = (typeof window !== "undefined" ? window.innerWidth : 0) || 0;
    const h = (typeof window !== "undefined" ? window.innerHeight : 0) || 0;
    // 포인터가 화면 좌/우 가장자리 근처면 세로, 그 외엔 가로. 이력 현상(60/110px)으로 임계선 깜빡임 방지.
    const isVertical = bar.classList.contains("vertical");
    let wantVertical = isVertical;
    if (!isVertical && (e.clientX < 60 || e.clientX > w - 60)) wantVertical = true;
    else if (isVertical && e.clientX > 110 && e.clientX < w - 110) wantVertical = false;
    if (wantVertical !== isVertical){
      setVertical(wantVertical);
      const br = bar.getBoundingClientRect();
      dragging.barW = br.width; dragging.barH = br.height;
      // 전환 후 포인터가 핸들 중앙을 잡도록 dx/dy 재설정 — 바가 자연스럽게 따라오게.
      const hr = drag.getBoundingClientRect();
      dragging.dx = (hr.left - br.left) + hr.width / 2;
      dragging.dy = (hr.top - br.top) + hr.height / 2;
    }
    const x = Math.max(8, Math.min(e.clientX - dragging.dx, w - dragging.barW - 8));
    const y = Math.max(8, Math.min(e.clientY - dragging.dy, h - dragging.barH - 8));
    setAbs(x, y);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    try { drag.releasePointerCapture(e.pointerId); } catch(_){}
    savePos({ x:parseFloat(bar.style.left) || 0, y:parseFloat(bar.style.top) || 0, vertical:bar.classList.contains("vertical") });
    dragging = null;
  };
  drag.addEventListener("pointerup", endDrag);
  drag.addEventListener("pointercancel", endDrag);

  return bar;
}

function nbCreateInkSurface(ownerDoc, ctrl){
  const overlay = document.createElement("div");
  overlay.className = "nbv-ink-layer";
  const canvas = document.createElement("canvas");
  canvas.className = "nbv-ink-canvas";
  canvas.setAttribute("aria-label", "이 셀에 필기");
  overlay.appendChild(canvas);
  ctrl.cellEl.appendChild(overlay);
  const ctx = canvas.getContext("2d");
  let strokes = notebookEnsureInkStrokes(ctrl.cell, false);
  let width = 1, height = 1, dpr = 1, current = null, last = null;

  const ensureBound = () => {
    const stored = ctrl.cell.metadata && ctrl.cell.metadata[NB_INK_META_KEY];
    if (!stored || stored.strokes !== strokes){
      if (!ctrl.cell.metadata || typeof ctrl.cell.metadata !== "object") ctrl.cell.metadata = {};
      ctrl.cell.metadata[NB_INK_META_KEY] = { version:1, strokes };
    }
  };
  const applyStyle = (stroke) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.width;
    if (stroke.tool === "eraser"){
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = stroke.tool === "highlighter" ? 0.30 : 1;
      ctx.strokeStyle = stroke.color;
    }
  };
  const drawPath = (stroke) => {
    if (!stroke.points.length) return;
    applyStyle(stroke);
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (let i = 1; i < stroke.points.length; i++){
      ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height);
    }
    if (stroke.points.length === 1){
      const point = stroke.points[0];
      ctx.lineTo(point.x * width + 0.01, point.y * height + 0.01);
    }
    ctx.stroke();
  };
  const redraw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of strokes) drawPath(stroke);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  };
  const resize = () => {
    const rect = ctrl.cellEl.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    redraw();
  };
  const pointAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x:Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y:Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    };
  };
  const drawSegment = (stroke, a, b) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyStyle(stroke);
    ctx.beginPath();
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
    if (a.x === b.x && a.y === b.y) ctx.lineTo(b.x * width + 0.01, b.y * height + 0.01);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  };
  const onPointerDown = (event) => {
    const ink = nbInkState(ownerDoc);
    if (!ownerDoc._nbInkMode || ink.tool === "move" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    ownerDoc._nbInkTarget = ctrl;
    nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {});
    canvas.setPointerCapture(event.pointerId);
    if (!ctrl.cell.metadata || !ctrl.cell.metadata[NB_INK_META_KEY]){
      strokes = notebookEnsureInkStrokes(ctrl.cell, true);
      api.strokes = strokes;
    }
    const point = pointAt(event);
    const strokeWidth = ink.tool === "eraser"
      ? Math.max(16, ink.width * 6)
      : (ink.tool === "highlighter" ? Math.max(10, ink.width * 4) : ink.width);
    current = { tool:ink.tool, color:ink.color, width:strokeWidth, points:[point] };
    strokes.push(current);
    ensureBound();
    last = point;
    drawSegment(current, point, point);
  };
  const onPointerMove = (event) => {
    if (!current) return;
    event.preventDefault();
    const point = pointAt(event);
    const dx = (point.x - last.x) * width, dy = (point.y - last.y) * height;
    if (dx * dx + dy * dy < 1.5) return;
    current.points.push(point);
    drawSegment(current, last, point);
    last = point;
  };
  const finishStroke = () => {
    if (!current) return;
    current = null;
    last = null;
    redraw();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);
  let observer = null;
  if (typeof ResizeObserver !== "undefined"){
    observer = new ResizeObserver(resize);
    observer.observe(ctrl.cellEl);
  }
  const api = {
    overlay,
    canvas,
    strokes,
    redraw,
    resize,
    setDrawing(active){
      overlay.classList.toggle("drawing", !!active);
      canvas.dataset.inkTool = nbInkState(ownerDoc).tool;
    },
    cleanup(){
      if (observer) observer.disconnect();
      overlay.remove();
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(resize);
  else resize();
  return api;
}

function nbSyncFindModel(ownerDoc){
  let changed = false;
  for (const ctrl of (ownerDoc && ownerDoc._nbCtrls || [])){
    let value = null;
    if (ctrl.editor) value = ctrl.editor.getValue();
    else {
      const textarea = ctrl.cellEl && ctrl.cellEl.querySelector(".nbv-md-edit");
      if (textarea) value = textarea.value;
    }
    if (value != null && value !== ctrl.cell.source){ ctrl.cell.source = value; changed = true; }
  }
  if (changed) markNbDirty(ownerDoc);
}

function nbFindOptions(state){
  return {
    caseSensitive:!!state.caseSensitive,
    word:!!state.word,
    regex:!!state.regex
  };
}

function nbFocusNotebookFindInput(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state || state.panel.hidden || !state.input) return;
  try { state.input.focus({ preventScroll:true }); }
  catch(_){ try { state.input.focus(); } catch(__){} }
}

// 모든 셀 편집기의 전체 찾기 강조(주황 박스)를 지운다.
function nbClearFindSpotlights(ownerDoc){
  for (const ctrl of (ownerDoc && ownerDoc._nbCtrls || [])){
    if (ctrl.editor && typeof ctrl.editor.clearSpotlight === "function") ctrl.editor.clearSpotlight();  // 코드 셀
    if (typeof ctrl.clearSpotlight === "function") ctrl.clearSpotlight();                                // 마크다운 셀
  }
}

function nbFocusNotebookMatch(ownerDoc, match, options){
  if (!match) return;
  const returnToFind = !!(options && options.returnToFind);
  const restoreFindFocus = () => {
    if (returnToFind) nbFocusNotebookFindInput(ownerDoc);
  };
  const ctrl = (ownerDoc._nbCtrls || [])[match.cellIndex];
  if (!ctrl) return;
  nbClearFindSpotlights(ownerDoc);                 // 이전 매치의 강조를 먼저 지운다(한 번에 하나만 보이게)
  nbSetSelected(ownerDoc, match.cellIndex, { scroll:true });
  ctrl.cellEl.scrollIntoView({ block:"center" });
  if (ctrl.type === "code"){
    ctrl.mount();
    if (ctrl.editor && typeof ctrl.editor.spotlightRange === "function"){
      ctrl.editor.spotlightRange(match.start, match.end);   // 셀 안 찾기와 같은 주황 박스로 또렷하게 강조
    } else if (ctrl.editor){
      ctrl.editor.ta.focus();
      ctrl.editor.ta.setSelectionRange(match.start, match.end);
    }
    restoreFindFocus();
  } else if (ctrl.type === "markdown"){
    if (typeof ctrl.spotlightRange === "function"){
      ctrl.spotlightRange(match.start, match.end);   // 코드 셀과 같은 주황 박스로 강조(편집 모드 진입 후 오버레이)
      restoreFindFocus();
    } else {
      ctrl.edit();
      requestAnimationFrame(() => {
        const textarea = ctrl.cellEl.querySelector(".nbv-md-edit");
        if (textarea){
          textarea.focus();
          textarea.setSelectionRange(match.start, match.end);
        }
        restoreFindFocus();
      });
    }
  } else {
    try { ctrl.cellEl.focus(); } catch(_){}
    restoreFindFocus();
  }
}

function nbRefreshNotebookFind(ownerDoc, preferredIndex){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  nbClearFindSpotlights(ownerDoc);   // 검색어가 바뀌면 이전 강조를 지운다(이동 시 nbFocusNotebookMatch 가 다시 그림)
  nbSyncFindModel(ownerDoc);
  state.input.classList.remove("find-bad");
  try {
    state.matches = notebookFindMatches(ownerDoc.notebookModel, state.input.value, nbFindOptions(state));
  } catch(_){
    state.matches = [];
    state.input.classList.add("find-bad");
    state.count.textContent = "정규식 오류";
    return;
  }
  if (!state.matches.length){
    state.index = -1;
    state.count.textContent = state.input.value ? "0/0" : "";
    return;
  }
  state.index = Math.max(0, Math.min(
    preferredIndex == null ? (state.index < 0 ? 0 : state.index) : preferredIndex,
    state.matches.length - 1
  ));
  const match = state.matches[state.index];
  state.count.textContent = (state.index + 1) + "/" + state.matches.length + " · 셀 " + (match.cellIndex + 1);
}

function notebookFindNextIndex(index, delta, length, navigated){
  const count = Math.max(0, Number(length) || 0);
  if (!count) return -1;
  if (!navigated) return delta < 0 ? count - 1 : 0;
  return ((Number(index) || 0) + (delta < 0 ? -1 : 1) + count) % count;
}

function nbMoveNotebookFind(ownerDoc, delta){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  nbRefreshNotebookFind(ownerDoc);
  if (!state.matches.length){
    nbFocusNotebookFindInput(ownerDoc);
    return;
  }
  state.index = notebookFindNextIndex(state.index, delta, state.matches.length, state.navigated);
  state.navigated = true;
  const match = state.matches[state.index];
  state.count.textContent = (state.index + 1) + "/" + state.matches.length + " · 셀 " + (match.cellIndex + 1);
  nbFocusNotebookMatch(ownerDoc, match, { returnToFind:true });
}

// 현재 포커스(셀 편집기 textarea·검색창 등) 또는 페이지에서 선택된 문자열을 한 줄짜리로 가져온다.
function nbCurrentSelectionText(){
  try {
    const el = (typeof document !== "undefined") && document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && typeof el.selectionStart === "number"){
      const sel = String(el.value || "").slice(el.selectionStart, el.selectionEnd);
      if (sel) return sel;
    }
    const win = (typeof window !== "undefined") && window.getSelection && window.getSelection();
    if (win) { const s = String(win); if (s) return s; }
  } catch(_){}
  return "";
}

// 찾기 옵션 버튼(Aa·\b·.*)의 켜짐 표시를 현재 state 에 맞춘다(최근 검색어로 옵션까지 되살릴 때 필요).
function nbSyncNotebookFindOptionButtons(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  state.panel.querySelector('[data-opt="case"]').classList.toggle("on", !!state.caseSensitive);
  state.panel.querySelector('[data-opt="word"]').classList.toggle("on", !!state.word);
  state.panel.querySelector('[data-opt="regex"]').classList.toggle("on", !!state.regex);
}
// 실제로 찾은·바꾼 순간에만 남긴다('바꿀 내용'은 기록하지 않는다).
function nbRememberNotebookFind(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state || !state.history) return;
  state.history.remember(state.input.value, { case: !!state.caseSensitive, word: !!state.word, regex: !!state.regex });
}
function nbOpenNotebookFind(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  const sel = nbCurrentSelectionText();         // 선택한 문자열을 검색란에 따라오게 한다(한 줄·200자 이내)
  if (sel && !sel.includes("\n") && sel.length <= 200){
    state.input.value = sel;
    state.index = -1;
    state.navigated = false;
  } else if (!state.input.value && state.history){
    // 선택한 글자도, 적혀 있던 것도 없으면 마지막으로 찾던 말을 채워 준다.
    const rows = MNSearchHistory.list("notebook");
    if (rows.length){
      state.input.value = rows[0].q;
      const meta = rows[0].meta;
      if (meta){
        state.caseSensitive = !!meta.case; state.word = !!meta.word; state.regex = !!meta.regex;
        nbSyncNotebookFindOptionButtons(ownerDoc);
      }
      state.index = -1;
      state.navigated = false;
    }
  }
  state.panel.hidden = false;
  nbRefreshNotebookFind(ownerDoc);
  state.input.focus();
  state.input.select();
}

// 현재 선택된 셀 안에서 찾기·바꾸기(Ctrl+Shift+H). 코드 셀에서만 동작.
function nbOpenCellFind(ownerDoc){
  const ctrl = (ownerDoc._nbCtrls || [])[ownerDoc._nbSelected];
  if (!ctrl) return;
  if (typeof ctrl.edit === "function") ctrl.edit();   // 정적 셀이면 편집기를 마운트하고 포커스
  if (ctrl.editor && typeof ctrl.editor.openFind === "function") ctrl.editor.openFind();
}

// 열려 있는 검색창이 하나라도 있는지(노트북 전체 패널 + 각 셀 편집기 find 바).
function nbAnyFindOpen(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (state && !state.panel.hidden) return true;
  for (const ctrl of (ownerDoc && ownerDoc._nbCtrls || [])){
    if (ctrl.editor && typeof ctrl.editor.isFindOpen === "function" && ctrl.editor.isFindOpen()) return true;
  }
  return false;
}

// Esc 한 번으로 노트북 전체 검색창과 모든 셀 검색창을 닫는다.
function nbCloseAllFinds(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (state && !state.panel.hidden) state.panel.hidden = true;
  nbClearFindSpotlights(ownerDoc);
  for (const ctrl of (ownerDoc && ownerDoc._nbCtrls || [])){
    if (ctrl.editor && typeof ctrl.editor.closeFind === "function" && ctrl.editor.isFindOpen && ctrl.editor.isFindOpen()){
      try { ctrl.editor.closeFind(); } catch(_){}
    }
  }
  const ctrl = (ownerDoc._nbCtrls || [])[ownerDoc._nbSelected];
  if (ctrl) try { ctrl.cellEl.focus(); } catch(_){}
}

function nbCloseNotebookFind(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  state.panel.hidden = true;
  nbClearFindSpotlights(ownerDoc);
  const ctrl = (ownerDoc._nbCtrls || [])[ownerDoc._nbSelected];
  if (ctrl) try { ctrl.cellEl.focus(); } catch(_){}
}

function nbReplaceNotebookCurrent(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state) return;
  nbRefreshNotebookFind(ownerDoc);
  const match = state.matches[state.index];
  if (!match) return;
  const ctrl = (ownerDoc._nbCtrls || [])[match.cellIndex];
  if (!ctrl) return;
  const source = String(ctrl.cell.source || "");
  let replacement = state.replace.value;
  if (state.regex){
    try { replacement = match.text.replace(notebookSearchRegex(state.input.value, nbFindOptions(state), false), replacement); }
    catch(_){ state.input.classList.add("find-bad"); return; }
  }
  ctrl.setSource(source.slice(0, match.start) + replacement + source.slice(match.end));
  markNbDirty(ownerDoc);
  nbRefreshNotebookFind(ownerDoc, Math.min(state.index, Math.max(0, state.matches.length - 1)));
  if (state.matches.length) nbFocusNotebookMatch(ownerDoc, state.matches[state.index]);
}

function nbReplaceNotebookAll(ownerDoc){
  const state = ownerDoc && ownerDoc._nbFind;
  if (!state || !state.input.value) return;
  nbSyncFindModel(ownerDoc);
  let count = 0;
  try { count = notebookReplaceAll(ownerDoc.notebookModel, state.input.value, state.replace.value, nbFindOptions(state)); }
  catch(_){ state.input.classList.add("find-bad"); state.count.textContent = "정규식 오류"; return; }
  if (!count){ toast("바꿀 내용이 없어요.", 1600); return; }
  nbInvalidateCompletionCache(ownerDoc);
  for (const ctrl of (ownerDoc._nbCtrls || [])) ctrl.setSource(ctrl.cell.source);
  markNbDirty(ownerDoc);
  nbRefreshNotebookFind(ownerDoc, 0);
  toast(window.tf("노트북 전체에서 {n}개를 바꿨어요.", { n: count }), 2200);
}

function nbBuildFindPanel(ownerDoc){
  const panel = document.createElement("div");
  panel.className = "nbv-find";
  panel.hidden = true;
  panel.innerHTML =
    '<div class="nbv-find-row">' +
      '<input type="text" class="nbv-find-input" placeholder="노트북 전체에서 찾기" aria-label="노트북 전체에서 찾기">' +
      '<span class="nbv-find-count" aria-live="polite"></span>' +
      '<button type="button" data-opt="case" title="대소문자 구분">Aa</button>' +
      '<button type="button" data-opt="word" title="단어 단위">\\b</button>' +
      '<button type="button" data-opt="regex" title="정규식">.*</button>' +
      '<button type="button" class="search-history-toggle" title="최근 검색어 (↓)" aria-expanded="false">최근</button>' +
      '<button type="button" data-nav="prev" title="이전">↑</button>' +
      '<button type="button" data-nav="next" title="다음">↓</button>' +
      '<button type="button" data-do="close" title="닫기">✕</button>' +
    '</div>' +
    '<div class="nbv-find-row">' +
      '<input type="text" class="nbv-find-replace" placeholder="바꿀 내용" aria-label="노트북 전체에서 바꿀 내용">' +
      '<button type="button" data-do="one">바꾸기</button>' +
      '<button type="button" data-do="all">모두 바꾸기</button>' +
    '</div>';
  const state = ownerDoc._nbFind = {
    panel,
    input:panel.querySelector(".nbv-find-input"),
    replace:panel.querySelector(".nbv-find-replace"),
    count:panel.querySelector(".nbv-find-count"),
    matches:[],
    index:-1,
    navigated:false,
    caseSensitive:false,
    word:false,
    regex:false
  };
  state.input.addEventListener("input", () => {
    state.index = -1;
    state.navigated = false;
    nbRefreshNotebookFind(ownerDoc, 0);
  });
  state.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter"){ event.preventDefault(); nbRememberNotebookFind(ownerDoc); nbMoveNotebookFind(ownerDoc, event.shiftKey ? -1 : 1); }
    else if (event.key === "Escape"){ event.preventDefault(); nbCloseNotebookFind(ownerDoc); }
  });
  state.replace.addEventListener("keydown", (event) => {
    if (event.key === "Enter"){ event.preventDefault(); nbRememberNotebookFind(ownerDoc); nbReplaceNotebookCurrent(ownerDoc); }
    else if (event.key === "Escape"){ event.preventDefault(); nbCloseNotebookFind(ownerDoc); }
  });
  panel.querySelectorAll("[data-opt]").forEach(button => button.addEventListener("click", () => {
    const name = button.dataset.opt;
    if (name === "case") state.caseSensitive = !state.caseSensitive;
    else if (name === "word") state.word = !state.word;
    else if (name === "regex") state.regex = !state.regex;
    button.classList.toggle("on", !!state[name === "case" ? "caseSensitive" : name]);
    state.index = -1;
    state.navigated = false;
    nbRefreshNotebookFind(ownerDoc, 0);
    state.input.focus();
  }));
  // 최근 검색어 — 노트북은 notebook 구획에 따로 쌓고, 찾기 옵션까지 함께 되살린다.
  const historyButton = panel.querySelector(".search-history-toggle");
  state.history = (typeof MNSearchHistory === "object" && MNSearchHistory)
    ? MNSearchHistory.attach(state.input, {
        scope: "notebook",
        mount: panel,
        toggleButton: historyButton,
        onPick: (term, meta) => {
          if (meta){
            state.caseSensitive = !!meta.case; state.word = !!meta.word; state.regex = !!meta.regex;
            nbSyncNotebookFindOptionButtons(ownerDoc);
          }
          state.index = -1; state.navigated = false;
          nbRefreshNotebookFind(ownerDoc, 0);
        }
      })
    : null;
  if (state.history){
    historyButton.addEventListener("mousedown", (e) => e.preventDefault());   // 입력창 blur 로 목록이 곧바로 닫히지 않게
    historyButton.addEventListener("click", () => { state.history.toggle(true); state.input.focus(); });
  } else historyButton.hidden = true;
  panel.querySelector('[data-nav="prev"]').addEventListener("click", () => { nbRememberNotebookFind(ownerDoc); nbMoveNotebookFind(ownerDoc, -1); });
  panel.querySelector('[data-nav="next"]').addEventListener("click", () => { nbRememberNotebookFind(ownerDoc); nbMoveNotebookFind(ownerDoc, 1); });
  panel.querySelector('[data-do="one"]').addEventListener("click", () => { nbRememberNotebookFind(ownerDoc); nbReplaceNotebookCurrent(ownerDoc); });
  panel.querySelector('[data-do="all"]').addEventListener("click", () => { nbRememberNotebookFind(ownerDoc); nbReplaceNotebookAll(ownerDoc); });
  panel.querySelector('[data-do="close"]').addEventListener("click", () => nbCloseNotebookFind(ownerDoc));
  return panel;
}

function notebookCellWorkspaceCwd(ownerDoc, cell, bundle){
  const archive = ownerDoc && ownerDoc.archiveCtx;
  const target = normalizedRunPath(ownerDoc && (ownerDoc.relPath || ownerDoc.workspacePath || ownerDoc.name));
  if (!archive || !archive.paths || !target) return normalizedRunPath(bundle && bundle.cwd);
  const context = inferPythonProjectRunContext(
    target,
    String(cell && cell.source || ""),
    archive.paths,
    { availableDirs:archive.directories || [] }
  );
  return (context.references && context.references.length) ||
    (context.outputDirectories && context.outputDirectories.length)
    ? normalizedRunPath(context.cwd)
    : normalizedRunPath(bundle && bundle.cwd);
}

async function buildNotebookCellWorkspaceSync(ownerDoc, cell){
  const archive = ownerDoc && ownerDoc.archiveCtx;
  const target = normalizedRunPath(ownerDoc && (ownerDoc.relPath || ownerDoc.workspacePath || ownerDoc.name));
  if (!archive || !archive.paths || typeof archive.extract !== "function" || !target) return null;
  const context = inferPythonProjectRunContext(
    target,
    String(cell && cell.source || ""),
    archive.paths,
    { availableDirs:archive.directories || [] }
  );
  const referenced = (context.references || []).map(item => normalizedRunPath(item.path)).filter(Boolean);
  if (!referenced.length) return null;
  const keep = (value) => {
    const path = normalizedRunPath(value);
    return referenced.some(ref => path === ref || path.indexOf(ref + "/") === 0);
  };
  let files = await archive.extract(keep);
  files = mergeRuntimeFiles(notebookRunContext(ownerDoc), files, keep);
  return {
    files,
    dirs:runDirectoryPaths(files.map(file => file.path)),
    cwd:normalizedRunPath(context.cwd)
  };
}

// ── 편집 가능 렌더(Phase 2) ──────────────────────────────────────────────────
function nbReplaceNotebookModel(ownerDoc, model, options={}){
  if (!ownerDoc || !model || !ownerDoc.el) return false;
  const host = ownerDoc.el;
  destroyNotebook(ownerDoc);
  host.innerHTML = "";
  ownerDoc.notebookModel = model;
  renderNotebookView(model, host, ownerDoc);
  markDocumentDirty(ownerDoc, options.dirty !== false);
  updateNbSaveButton(ownerDoc, ownerDoc._nbSaveBtn);
  if (options.status) nbSetStatus(ownerDoc, options.status);
  return true;
}

function nbRestoreHistory(ownerDoc, direction){
  if (!ownerDoc || ownerDoc._nbHistoryRestoring) return false;
  const redoing = direction === "redo";
  if (redoing ? !nbCanRedo(ownerDoc) : !nbCanUndo(ownerDoc)) return false;
  const h = nbHistoryFor(ownerDoc);
  if (!(redoing ? h.redo() : h.undo())) return false;   // 미기록 작업은 undo 안에서 한 단계로 확정된다
  // 작업 이름은 항상 "위쪽" 단계에 붙어 있다. 되돌리면 방금 떠난 단계(peekRedo),
  // 다시 실행하면 방금 들어간 단계(current).
  const entry = redoing ? h.current() : h.peekRedo();
  const label = (entry && entry.label) || "셀 작업";
  nbSetStatus(ownerDoc, (redoing ? "다시 실행: " : "되돌림: ") + label);
  notebookScheduleRecovery(ownerDoc);
  return true;
}

async function notebookOfferRecovery(ownerDoc){
  if (!ownerDoc || ownerDoc._nbRecoveryChecked) return;
  ownerDoc._nbRecoveryChecked = true;
  let record;
  try { record = await notebookRecoveryRequest("readonly", store => store.get(notebookRecoveryKey(ownerDoc))); }
  catch(_){ return; }
  if (!record || !record.text) return;
  const current = modelToIpynb(ownerDoc.notebookModel);
  if (record.text === current){ await notebookDeleteRecovery(ownerDoc); return; }
  const stamp = new Date(Number(record.updatedAt) || Date.now()).toLocaleString();
  const ok = typeof confirmDialog === "function"
    ? await confirmDialog("저장되지 않은 노트북 복구본이 있습니다.\n" + stamp + "\n\n복구할까요?", "복구", "무시")
    : false;
  if (!ok){ await notebookDeleteRecovery(ownerDoc); return; }
  try {
    const restored = ipynbToModel(record.text);
    nbReplaceNotebookModel(ownerDoc, restored, { dirty:true, status:"자동복구본을 복원했습니다." });
    notebookScheduleRecovery(ownerDoc);
  } catch(error){
    console.error(error);
    await notebookDeleteRecovery(ownerDoc);
  }
}
