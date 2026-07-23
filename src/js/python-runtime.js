"use strict";

async function runPythonSource(src, ui, runCtx, keepEditorFocus, options){
  options = options || {};
  const gradeTests = normalizeAssignmentTests(options.gradeTests);
  const grading = gradeTests.length > 0;
  const diagnosing = options.diagnoseMode === true;
  const tracing = options.traceMode === true;
  const cellMode = options.notebookCells === true && !grading && !diagnosing && !tracing;
  const studentSource = String(src == null ? "" : src);
  const executionSource = diagnosing
    ? buildPythonDiagnosticHarness(studentSource, ui.fileBase || "practice.py")
    : tracing
      ? buildPythonTraceHarness(studentSource, ui.fileBase || "practice.py", 300)
      : grading
        ? buildPythonGradingHarness(studentSource, gradeTests, ui.fileBase || "assignment.py")
        : cellMode
          ? buildPythonCellHarness(studentSource, ui.fileBase || "notebook.py")
          : studentSource;
  ui.keepEditorFocus = keepEditorFocus === true;
  const { btn, status, outPanel, split } = ui;
  const stdin = (grading || diagnosing) ? "" : (ui.stdin ? ui.stdin.value : "");
  if (ui.running) return;
  if (typeof ui.pauseLiveDiagnostics === "function") ui.pauseLiveDiagnostics();
  ui.running = true;
  // 수업 리플레이 녹화 중이면 실행 시작(확정 코드)을 파이썬 트랙에 기록(일반 실행만).
  if (!grading && !diagnosing && !tracing && typeof lessonPyOnRun === "function") lessonPyOnRun(studentSource, ui.fileBase);
  let cancelRequested = false;
  let cancelCurrent = null;
  const idleButtonTitle = btn.title;
  const cancellationError = () => {
    const error = new Error("실행을 중지했습니다.");
    error.code = "run-cancel";
    return error;
  };
  const throwIfCancelled = () => { if (cancelRequested) throw cancellationError(); };
  const invokeCancel = (fn) => {
    if (typeof fn !== "function") return;
    try {
      const pending = fn();
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch(_){}
  };
  const bindCancel = (fn) => {
    cancelCurrent = typeof fn === "function" ? fn : null;
    if (cancelRequested && cancelCurrent) invokeCancel(cancelCurrent);
  };
  const requestStop = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    btn.disabled = true;
    status.textContent = "중지 요청 중…";
    invokeCancel(cancelCurrent);
  };
  ui.cancelRun = requestStop;
  btn.textContent = "■";
  btn.title = "현재 Python 실행 중지";
  btn.setAttribute("aria-label", btn.title);
  btn.classList.add("is-running");
  if (ui.traceBtn) ui.traceBtn.disabled = true;
  if (ui.analyzeBtn) ui.analyzeBtn.disabled = true;
  if (ui.gradeBtn) ui.gradeBtn.disabled = true;
  if (!diagnosing){
    split.classList.add("show-out");
    if (ui.layoutBtn) ui.layoutBtn.hidden = false;
  }
  const modeTitle = diagnosing ? "실행 전 코드 진단" : tracing ? "단계 실행" : grading ? "과제 자동채점" : "실행 결과";
  const modeProgress = diagnosing ? "코드를 실행하지 않고 분석 중…" : tracing ? "실행 흐름 기록 중…" : grading ? "테스트 실행 중…" : "실행 중…";
  if (!diagnosing) outPanel.innerHTML = '<div class="out-head">' + modeTitle + '</div><pre class="out-pre out-muted">' + modeProgress + '</pre>';
  const setStatus = (m) => { status.textContent = m; };
  if (ui.clearError) ui.clearError();                                   // 이전 실행의 에러 줄 표시 해제
  if (ui.clearTraceLine) ui.clearTraceLine();
  const applyErr = (code, stderr) => {
    if (!code) return;
    if (diagnosing) return;
    const knownFiles = docs.map((doc) => String(doc.workspacePath || doc.relPath || doc.name || "").replace(/\\/g, "/").split("/").pop()).filter(Boolean);
    const location = parsePythonTracebackLocation(stderr, ui.fileBase, knownFiles);
    const line = location && location.current ? location.line : 0;
    if (line && ui.markError) ui.markError(line);
    appendPythonErrorHelp(outPanel, stderr, location, ui);
  };
  try {
    const backend = await pythonBackendAvailable();
    throwIfCancelled();
    if (backend && !diagnosing && !_localPyConfirmed){
      if (!(await confirmDialog("이 코드를 내 컴퓨터에 설치된 파이썬으로 실행합니다. 신뢰할 수 있는 코드만 실행하세요.", "실행", "취소"))){
        setStatus("취소됨"); renderPyResult(outPanel, "", "", "실행이 취소되었습니다."); return;
      }
      _localPyConfirmed = true;
      throwIfCancelled();
    }
    // 아카이브(zip/tar)에서 나온 파일이면, 같은 압축을 통째로 다시 풀어 옆 파일까지 번들로 묶는다.
    let bundle = null;
    if (!diagnosing && runCtx && runCtx.archiveCtx && runCtx.relPath){
      setStatus("옆 파일 모으는 중…");
      try {
        const targetRel = String(runCtx.relPath).replace(/\\/g, "/").replace(/^\/+/, "");
        // 폴더 묶음(makeFileSiblingCtx)이면 실행 대상과 관련된 하위 트리로 좁혀서 읽는다(무관한 폴더·대용량 데이터 제외).
        const preferredCwd = pythonPreferredRunCwd(runCtx);
        let scopeFilter = runCtx.archiveCtx.paths
          ? buildArchiveScopeFilter(targetRel, studentSource, runCtx.archiveCtx.paths, runCtx.archiveCtx.directories || [], preferredCwd)
          : null;
        let files = await runCtx.archiveCtx.extract(scopeFilter || undefined);
        if (scopeFilter){
          const expandedFilter = expandArchiveScopeFilterFromPythonFiles(
            targetRel,
            studentSource,
            runCtx.archiveCtx.paths,
            runCtx.archiveCtx.directories || [],
            preferredCwd,
            files,
            scopeFilter
          );
          if (expandedFilter !== scopeFilter){
            scopeFilter = expandedFilter;
            try { files = await runCtx.archiveCtx.extract(scopeFilter); }
            catch(e){ console.warn("indirect python path expansion skipped:", e); }
          }
        }
        throwIfCancelled();
        files = mergeRuntimeFiles(runCtx, files, scopeFilter || undefined);
        // 같은 묶음의 옆 파일을 앱에서 열어 편집했으면, 업로드/압축 당시 내용 대신 '현재 편집기 내용'으로 덮어쓴다
        // (저장하지 않았어도 실행에 반영). 대상 파일은 아래에서 현재 내용으로 따로 교체하므로 제외.
        const liveEdits = new Map();
        for (const d of docs){
          if (!d || d.archiveCtx !== runCtx.archiveCtx || !d.codeEditor || typeof d.codeEditor.getValue !== "function") continue;
          const rp = normalizedRunPath(d.relPath || d.workspacePath || "");
          if (rp && rp !== normalizedRunPath(targetRel)) liveEdits.set(rp, d.codeEditor.getValue());
        }
        if (liveEdits.size){
          const enc = new TextEncoder();
          for (const f of files){ const np = normalizedRunPath(f.path); if (liveEdits.has(np)) f.bytes = enc.encode(liveEdits.get(np)); }
        }
        // zip/tar 의 '내용물'만 압축돼 루트에 흩어져 있으면(최상위 폴더 없음) 압축 파일명을 폴더로 씌운다.
        // → 폴더 업로드와 같은 트리(somefolder/...)가 되어 import somefolder... 같은 패키지 절대 import 가 동작.
        // (폴더·평면 업로드는 isFolderContext 이므로 제외, 이미 공통 최상위 폴더가 있으면 중복 방지)
        let target = normalizedRunPath(targetRel);
        let archivePrefix = "";
        const topologyPaths = runCtx.archiveCtx.paths || files.map(f => f.path);
        if (!runCtx.archiveCtx.isFolderContext && !commonTopDir(topologyPaths)){
          const rootName = archiveRootName(runCtx.archiveCtx.name);
          if (rootName){
            archivePrefix = rootName;
            for (const f of files) f.path = rootName + "/" + normalizedRunPath(f.path);
            target = rootName + "/" + target;
          }
        }
        let bundleDirs = (scopeFilter && scopeFilter.directories || []).map(normalizedRunPath).filter(Boolean);
        if (archivePrefix) bundleDirs = bundleDirs.map(dir => archivePrefix + "/" + dir);
        const edited = new TextEncoder().encode(executionSource);     // 편집한 현재 내용(채점 시 테스트 실행기)으로 대상 파일 교체
        let found = false;
        for (const f of files){ if (normalizedRunPath(f.path) === target){ f.bytes = edited; found = true; break; } }
        if (!found) files.push({ path: target, bytes: edited });
        const total = files.reduce((s, f) => s + (f.bytes ? f.bytes.length : 0), 0);
        if (files.length && total <= RUN_BUNDLE_CAP){
          const scopedCwd = normalizedRunPath(scopeFilter && scopeFilter.cwd);
          const cwd = (archivePrefix && scopedCwd ? archivePrefix + "/" + scopedCwd : scopedCwd) || runPathDir(target);
          bundle = { files, target, cwd, dirs:bundleDirs,
            logicalRoot:commonTopDir(files.map(file => file.path)) || "" };
        } else if (total > RUN_BUNDLE_CAP){
          toast("옆 파일 합계가 커서(>50MB) 이 파일만 단독 실행해요.", 3500);
        }
      } catch(e){
        console.warn("sibling bundle skipped:", e);
        if (cancelRequested) throw cancellationError();
        if (String(e && e.message).indexOf("too-large") >= 0) toast("옆 파일 합계가 커서(>50MB) 이 파일만 단독 실행해요.", 3500);
      }
    }
    if (!diagnosing && !bundle) {
      try {
        bundle = await buildOpenPythonSiblingBundle(executionSource, runCtx, studentSource);
        throwIfCancelled();
      } catch(e){
        console.warn("open python sibling bundle skipped:", e);
        if (cancelRequested) throw cancellationError();
        if (String(e && e.message).indexOf("too-large") >= 0) toast("열린 Python 파일 합계가 커서(>50MB) 이 파일만 단독 실행해요.", 3500);
      }
    }
    updateRunProjectPanel(ui, bundle, runCtx);
    const withFolder = bundle ? " · 옆 Python 포함" : "";
    if (backend){
      if (ui.inputWrap) ui.inputWrap.hidden = true;
      const tried = new Set();
      for (;;){
        throwIfCancelled();
        setStatus((diagnosing ? "진단 중…" : tracing ? "단계 기록 중…" : grading ? "채점 중…" : "실행 중…") + " (로컬 파이썬" + withFolder + ")");
        const r = diagnosing
          ? await runPythonViaBackend(executionSource, "")
          : await runPythonInteractive(executionSource, bundle, ui, { bindCancel });
        throwIfCancelled();
        if (diagnosing){
          const parsed = parsePythonMarkedReport(r.stdout, PY_DIAG_MARKER);
          const summary = finishPythonDiagnostics(parsed && parsed.report, ui);
          if (!parsed) applyErr(1, r.stderr || "진단 결과를 읽지 못했습니다.");
          setStatus(parsed
            ? ("진단 완료 · 오류 " + summary.errors + " · 경고 " + summary.warnings + " · 로컬 파이썬")
            : "진단 오류 · 로컬 파이썬");
          break;
        }
        if (tracing){
          const parsed = parsePythonMarkedReport(r.stdout, PY_TRACE_MARKER);
          const summary = renderPythonTrace(outPanel, parsed, studentSource, ui);
          if (summary.error) applyErr(1, summary.error);
          else if (!parsed) applyErr(1, r.stderr || "단계 실행 결과를 읽지 못했습니다.");
          appendOutputFiles(outPanel, r.outputs, r.sessionId);
          await rememberRunOutputs(runCtx, bundle, r.outputs, r.sessionId);
          setStatus(parsed
            ? ("단계 실행 완료 · " + summary.steps + "단계 · 로컬 파이썬" + withFolder)
            : "단계 실행 오류 · 로컬 파이썬");
          break;
        }
        if (grading){
          const report = parsePythonGradingReport(r.stdout);
          const score = renderAssignmentGradingResult(outPanel, report, r.stderr, gradeTests);
          const gradingErrors = assignmentGradingErrorText(report, gradeTests, r.stderr);
          if (gradingErrors) applyErr(1, gradingErrors);
          setStatus(score.total ? ("채점 완료 · " + score.passed + "/" + score.total + " 통과 · 로컬 파이썬" + withFolder) : "채점 오류 · 로컬 파이썬");
          if (typeof options.onGradeResult === "function"){   // 과제 패키지(.task) 과제 바가 점수를 기록
            try { options.onGradeResult({ report, passed: score.passed, total: score.total, backend: "local-python" }); } catch(_){}
          }
          break;
        }
        const missing = (r.code !== 0) ? detectMissingModule(r.stderr) : null;
        if (missing && !tried.has(missing) && tried.size < 6){
          tried.add(missing);
          const pip = importToPip(missing);
          const localIncluded = bundleHasLocalModule(bundle, missing);
          if (localIncluded){
            toast("'" + missing + "' 파일은 작업폴더에 있지만 import 경로가 맞지 않아요. 작업폴더 목록과 패키지 구조를 확인하세요.", 4200);
          } else {
            const ok = await runPipInstall([pip], ui);
            throwIfCancelled();
            if (ok) continue;   // 설치 성공 → 자동 재실행
          }
        }
        throwIfCancelled();
        setStatus((r.code === 0 ? "완료" : "종료 코드 " + r.code) + " · 로컬 파이썬" + withFolder);
        applyErr(r.code, r.stderr);                  // 에러 줄 강조
        if (typeof petReact === "function") petReact(r.code === 0 ? "success" : "error");   // 펫들이 결과에 반응
        const remembered = await rememberRunOutputs(runCtx, bundle, r.outputs, r.sessionId);
        if (remembered.count){
          updateRunProjectPanel(ui, bundle, runCtx);
          toast(remembered.persisted
            ? "생성·변경 파일 " + remembered.count + "개를 작업공간에 저장했어요."
            : "생성·변경 파일 " + remembered.count + "개를 이번 앱 세션에 유지해요.", 2800);
        }
        break;
      }
    } else {
      if (ui.inputWrap) ui.inputWrap.hidden = diagnosing || grading || !usesInput(studentSource);
      let r = null;
      let workerTask = null;
      try {
        await ensurePyodideWorker(setStatus);
        throwIfCancelled();
        // 진단은 import 문도 실행하지 않으므로 외부 패키지를 받을 필요가 없다.
        const packageCode = diagnosing ? "" : pyodideWorkerPackageSource(bundle, studentSource, executionSource);
        const packages = await preparePyodideWorkerPackages(packageCode, setStatus);
        throwIfCancelled();
        workerTask = startPyodideWorkerRun(executionSource, bundle, stdin, packages, setStatus);
        bindCancel(() => workerTask && workerTask.cancel());
        const head = diagnosing ? null : outPanel.querySelector(".out-head");
        const stopWorker = document.createElement("button");
        stopWorker.type = "button"; stopWorker.className = "terminal-stop"; stopWorker.textContent = "중지";
        stopWorker.title = "브라우저 Python Worker 실행 중지";
        stopWorker.addEventListener("click", () => {
          if (typeof ui.cancelRun === "function") ui.cancelRun();
        });
        if (head) head.appendChild(stopWorker);
        try { r = await workerTask.promise; }
        finally { stopWorker.disabled = true; bindCancel(null); }
      } catch(workerError){
        const code = workerError && workerError.code;
        if (code !== "worker-init" && code !== "worker-unavailable") throw workerError;
        console.warn("Pyodide Worker unavailable; using main thread fallback:", workerError);
        toast("브라우저 Worker를 사용할 수 없어 기존 실행 방식으로 전환합니다.", 3200);
        r = bundle
          ? await runBundleViaPyodide(bundle, setStatus, stdin, studentSource)
          : await runPythonViaPyodide(executionSource, setStatus, stdin, studentSource);
      }
      if (diagnosing){
        const parsed = parsePythonMarkedReport(r.stdout, PY_DIAG_MARKER);
        const summary = finishPythonDiagnostics(parsed && parsed.report, ui);
        if (!parsed) applyErr(1, r.stderr || "진단 결과를 읽지 못했습니다.");
        setStatus(parsed
          ? ("진단 완료 · 오류 " + summary.errors + " · 경고 " + summary.warnings + " · 브라우저(Pyodide)")
          : "진단 오류 · 브라우저(Pyodide)");
        return;
      }
      if (tracing){
        const parsed = parsePythonMarkedReport(r.stdout, PY_TRACE_MARKER);
        const summary = renderPythonTrace(outPanel, parsed, studentSource, ui);
        if (summary.error) applyErr(1, summary.error);
        else if (!parsed) applyErr(1, r.stderr || "단계 실행 결과를 읽지 못했습니다.");
        appendOutputFiles(outPanel, r.outputs);
        await rememberRunOutputs(runCtx, bundle, r.outputs, null);
        setStatus(parsed
          ? ("단계 실행 완료 · " + summary.steps + "단계 · 브라우저(Pyodide)" + withFolder)
          : "단계 실행 오류 · 브라우저(Pyodide)");
        return;
      }
      if (grading){
        const report = parsePythonGradingReport(r.stdout);
        const score = renderAssignmentGradingResult(outPanel, report, r.stderr, gradeTests);
        const gradingErrors = assignmentGradingErrorText(report, gradeTests, r.stderr);
        if (gradingErrors) applyErr(1, gradingErrors);
        setStatus(score.total ? ("채점 완료 · " + score.passed + "/" + score.total + " 통과 · 브라우저(Pyodide)" + withFolder) : "채점 오류 · 브라우저(Pyodide)");
        if (typeof options.onGradeResult === "function"){   // 과제 패키지(.task) 과제 바가 점수를 기록
          try { options.onGradeResult({ report, passed: score.passed, total: score.total, backend: "pyodide" }); } catch(_){}
        }
        return;
      }
      renderPyResult(outPanel, r.stdout, r.stderr, null, r.images, r.variables, r.code);
      appendOutputFiles(outPanel, r.outputs);       // 브라우저 실행이 만든 파일(메모리 바이트)
      const remembered = await rememberRunOutputs(runCtx, bundle, r.outputs, null);
      if (remembered.count){
        updateRunProjectPanel(ui, bundle, runCtx);
        toast(remembered.persisted
          ? "생성·변경 파일 " + remembered.count + "개를 작업공간에 저장했어요."
          : "생성·변경 파일 " + remembered.count + "개를 이번 앱 세션에 유지해요.", 2800);
      }
      setStatus((r.code === 0 ? "완료" : "오류 종료") + " · 브라우저(Pyodide)" + withFolder);
      applyErr(r.code, r.stderr);                    // 에러 줄 강조
      if (typeof petReact === "function") petReact(r.code === 0 ? "success" : "error");     // 펫들이 결과에 반응
    }
  } catch(e){
    const cancelled = cancelRequested || (e && (e.code === "worker-cancel" || e.code === "run-cancel"));
    renderPyResult(outPanel, "", "", cancelled ? "실행을 중지했습니다." : ((e && e.message) ? e.message : String(e)));
    setStatus(cancelled ? "중지됨" : "오류");
  } finally {
    bindCancel(null);
    ui.cancelRun = null;
    ui.running = false;
    btn.disabled = false;
    btn.textContent = "▶";
    if (idleButtonTitle){
      btn.title = idleButtonTitle;
      btn.setAttribute("aria-label", idleButtonTitle);
    } else {
      btn.removeAttribute("title");
      btn.removeAttribute("aria-label");
    }
    btn.classList.remove("is-running");
    if (ui.traceBtn) ui.traceBtn.disabled = false;
    if (ui.analyzeBtn) ui.analyzeBtn.disabled = false;
    if (ui.gradeBtn) ui.gradeBtn.disabled = false;
    if (typeof ui.resumeLiveDiagnostics === "function") ui.resumeLiveDiagnostics();
  }
}

// 편집 중 사용하는 무소음 진단 경로. 학생 코드는 실행하지 않고 기존 compile/AST 하니스만 돌린다.
// 수동 진단과 달리 출력 패널·상태·버튼을 바꾸지 않으며 호출자가 최신 결과 여부를 판정한다.
async function runPythonLiveDiagnostics(src, fileName){
  const executionSource = buildPythonDiagnosticHarness(String(src == null ? "" : src), fileName || "practice.py");
  let result;
  if (await pythonBackendAvailable()) result = await runPythonViaBackend(executionSource, "");
  else {
    const task = startPyodideWorkerRun(executionSource, null, "", null, null);
    result = await task.promise;
  }
  const parsed = parsePythonMarkedReport(result && result.stdout, PY_DIAG_MARKER);
  if (!parsed || !parsed.report) throw new Error("live-diagnostic-report-missing");
  return {
    // 자동 편집 중에는 참고 진단을 대부분 숨기되, 종료 조건 없는 while True는
    // 즉시 알아볼 수 있도록 PY-LOOP만 파란 줄 표시로 유지한다.
    diagnostics:normalizePythonDiagnostics(parsed.report.diagnostics)
      .filter(item => item.severity !== "info" || item.code === "PY-LOOP"),
    unusedReady:parsed.report.unusedReady === true,
    unused:normalizePythonUnusedRanges(parsed.report.unused)
  };
}

// 로컬 백엔드(exe 런처)로 실행: 소스를 보내고 {stdout, stderr, code} 회수
function buildRunPayload(src, stdin){
  const enc = new TextEncoder(), sourceBytes = enc.encode(src), inputBytes = enc.encode(stdin || "");
  const out = new Uint8Array(8 + sourceBytes.length + inputBytes.length), dv = new DataView(out.buffer);
  dv.setUint32(0, sourceBytes.length, true); out.set(sourceBytes, 4);
  dv.setUint32(4 + sourceBytes.length, inputBytes.length, true); out.set(inputBytes, 8 + sourceBytes.length);
  return out;
}

function pythonStderrClassName(stderr, status){
  const kind = (typeof pythonStderrDisplayKind === "function")
    ? pythonStderrDisplayKind(stderr, status)
    : (status == null && String(stderr || "").trim()
      ? "pending"
      : (typeof classifyPythonStderr === "function" ? classifyPythonStderr(stderr, status) : (stderr ? "error" : "none")));
  return kind === "warning" ? "out-warn" : kind === "error" ? "out-err" : "";
}

function applyPythonStderrClass(el, stderr, status){
  if (!el) return;
  el.className = pythonStderrClassName(stderr, status);
}

async function runPythonInteractive(src, bundle, ui, hooks){
  hooks = hooks || {};
  const { outPanel } = ui;
  const startBody = bundle ? buildPyBundle(bundle.files, bundle.target, "", bundle.cwd, bundle.dirs) : buildRunPayload(src, "");
  const startUrl = bundle ? "/python-session-start-bundle" : "/python-session-start";
  const startRes = await fetch(startUrl, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: startBody });
  if (!startRes.ok) throw new Error(await startRes.text() || ("HTTP " + startRes.status));
  const sessionId = (await startRes.json()).id;

  outPanel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head";
  const headLabel = document.createElement("span"); headLabel.textContent = "실행 결과 · 대화형 터미널"; head.appendChild(headLabel);
  const pre = document.createElement("pre"); pre.className = "out-pre";
  const stdoutEl = document.createElement("span");
  const stderrEl = document.createElement("span");
  pre.append(stdoutEl, stderrEl);
  const row = document.createElement("div"); row.className = "terminal-input-row";
  const mark = document.createElement("span"); mark.className = "terminal-mark"; mark.textContent = "›";
  const input = document.createElement("input"); input.className = "terminal-input"; input.type = "text";
  input.placeholder = "값을 입력하고 Enter"; input.autocomplete = "off"; input.spellcheck = false;
  const stop = document.createElement("button"); stop.className = "terminal-stop"; stop.type = "button"; stop.textContent = "중지";
  const rerun = document.createElement("button"); rerun.className = "terminal-rerun"; rerun.type = "button"; rerun.textContent = "↻ 재실행"; rerun.title = "이 코드를 다시 실행";
  row.append(mark, input, stop, rerun);
  outPanel.append(head, pre, row);

  let stopping = false;
  const stopSession = async () => {
    if (stopping) return;
    stopping = true; input.disabled = true; stop.disabled = true;
    try { await fetch("/python-session-stop?id=" + encodeURIComponent(sessionId), { method: "POST" }); } catch(_){}
  };
  if (typeof hooks.bindCancel === "function") hooks.bindCancel(stopSession);
  stop.addEventListener("click", () => {
    if (typeof ui.cancelRun === "function") ui.cancelRun();
    else stopSession();
  });
  // 재실행: 진행 중이면 먼저 세션을 멈추고, 현재 실행 정리(폴링 종료·실행 버튼 복구)가 끝나면 다시 실행
  rerun.addEventListener("click", async () => {
    if (rerun.disabled) return;
    rerun.disabled = true;
    await stopSession();
    await new Promise(res => {
      const started = Date.now();
      const t = setInterval(() => { if (!ui.running || Date.now() - started > 3000){ clearInterval(t); res(); } }, 30);
    });
    if (typeof ui.rerun === "function") ui.rerun();
  });
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const value = input.value; input.value = ""; input.disabled = true;
    try {
      const res = await fetch("/python-session-input?id=" + encodeURIComponent(sessionId), {
        method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: value
      });
      if (!res.ok) throw new Error(await res.text());
    } catch(err){ toast("입력을 전달하지 못했어요: " + (err.message || err), 3000); }
    finally { if (!stopping){ input.disabled = false; input.focus(); } }
  });
  // Ctrl+Enter 실행도 input()이 있으면 바로 값을 입력할 수 있게 터미널로 포커스.
  // 입력이 없는 코드는 기존처럼 에디터 포커스를 유지해 곧바로 편집을 이어간다.
  const needsInteractiveInput = usesInput(src);
  setTimeout(() => {
    if (ui.keepEditorFocus && ui.editorTa && !needsInteractiveInput) ui.editorTa.focus();
    else input.focus();
  }, 0);

  let result = { code: -1, stdout: "", stderr: "", images: [], outputs: [], variables: [] };
  // 출력 폭주(무한 print 등) 대비: 표시 텍스트는 상한까지만 자르고, 내용이 그대로면 DOM 갱신·스크롤을 생략한다.
  // 거대한 <pre> 를 매 폴마다 통째로 재배치하면 메인 스레드가 막혀 중지 버튼 클릭이 처리되지 않는다.
  // 화면 표시만 줄이고 결과 데이터(채점·진단 프로토콜 포함)는 자르지 않는다.
  const FINAL_HEAD = 20000, FINAL_TAIL = 10000;   // 완료 후 표시 상한(앞+뒤) — 수십만 자 <pre> 는 한 번의
                                                  // 배치로도 수 초가 걸려 "정지됨" 표시가 그만큼 늦어진다
  const LIVE_TAIL = 16000;                  // 실행 중에는 마지막 부분만 표시 — 거대한 <pre> 재배치가 매 폴마다
                                            // 반복되면 메인 스레드가 막혀 정지 클릭이 늦게 처리된다
  // 표시 텍스트를 원본(fullOut) 오프셋을 아는 조각 목록으로 만든다 — 입력 에코 구간만 다른 색으로
  // 칠하려면 잘린 화면 텍스트의 각 조각이 원본 어디에서 왔는지 알아야 한다. src<0 은 생략 안내 문구.
  const displaySegs = (text) => text.length > FINAL_HEAD + FINAL_TAIL + 200
    ? [{ text: text.slice(0, FINAL_HEAD), src: 0 },
       { text: "\n\n…(출력이 " + text.length.toLocaleString() + "자로 길어 중간을 생략했어요)…\n\n", src: -1 },
       { text: text.slice(-FINAL_TAIL), src: text.length - FINAL_TAIL }]
    : [{ text, src: 0 }];
  const liveSegs = (text) => text.length > LIVE_TAIL
    ? [{ text: "…(출력이 길어 마지막 부분만 표시 중 — 전체는 실행이 끝나면 표시)\n", src: -1 },
       { text: text.slice(-LIVE_TAIL), src: text.length - LIVE_TAIL }]
    : [{ text, src: 0 }];
  const displayText = (text) => displaySegs(text).map(s => s.text).join("");
  const liveText = (text) => liveSegs(text).map(s => s.text).join("");
  let shownOut = null, shownErr = null;
  let fullOut = "", fullErr = "";           // 증분(delta) 응답을 이어붙인 누적 출력
  let knownOutLen = -1, knownErrLen = -1;   // 이미 받은 출력 길이 — 서버가 같으면 "unchanged", 자랐으면 새 내용만 응답
  let echoRanges = [];                      // stdout 속 입력 에코 구간 [시작,길이] — 서버가 폴 응답에 실어줌
  try {
    for (;;){
      const res = await fetch("/python-session-poll?id=" + encodeURIComponent(sessionId)
        + "&so=" + knownOutLen + "&se=" + knownErrLen, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!data.unchanged){
        if (typeof data.stdoutDelta === "string" || typeof data.stderrDelta === "string"){
          fullOut += data.stdoutDelta || "";
          fullErr += data.stderrDelta || "";
        } else {
          fullOut = data.stdout || "";
          fullErr = data.stderr || "";
        }
        knownOutLen = fullOut.length;
        knownErrLen = fullErr.length;
        if (Array.isArray(data.echoes)) echoRanges = data.echoes;
        const toShow = data.complete ? displayText : liveText;
        const outSegs = (data.complete ? displaySegs : liveSegs)(fullOut);
        const nextOut = outSegs.map(s => s.text).join("");
        const showWarnings = !ui.split.classList.contains("hide-python-warnings");
        const pendingStderrHidden = (typeof pythonStderrShouldBuffer === "function")
          ? pythonStderrShouldBuffer(data.complete, showWarnings)
          : (!data.complete && !showWarnings);
        // 경고 표시를 껐을 때는 종료 전 stderr를 화면에 쓰지 않는다. 완료 후에는 내용을 DOM에
        // 보존하고 out-warn 클래스만 숨겨, 체크를 다시 켜면 재실행 없이 경고를 볼 수 있게 한다.
        const nextErr = (!pendingStderrHidden && fullErr) ? ((fullOut ? "\n" : "") + toShow(fullErr)) : "";
        if (nextOut !== shownOut || nextErr !== shownErr){
          // 사용자가 위로 스크롤해 둔 동안에는 자동 스크롤을 멈추고, 바닥 근처일 때만 따라 내려간다
          const nearBottom = outPanel.scrollHeight - outPanel.scrollTop - outPanel.clientHeight < 40;
          if (nextOut !== shownOut){ shownOut = nextOut; renderPythonStdoutSegs(stdoutEl, outSegs, echoRanges); }
          if (nextErr !== shownErr){ shownErr = nextErr; stderrEl.textContent = nextErr; }
          applyPythonStderrClass(stderrEl, fullErr, data.complete ? data.code : undefined);
          if (nearBottom) outPanel.scrollTop = outPanel.scrollHeight;
          if (typeof lessonPyOnLiveOutput === "function") lessonPyOnLiveOutput(fullOut, fullErr);   // 수업 리플레이(녹화 중일 때만)
        }
        if (data.complete){
          result = {
            code: data.code, stdout: fullOut, stderr: fullErr,
            images: data.images || [], outputs: data.outputs || [],
            variables: normalizePythonVariables(data.variables)
          };
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  } finally {
    if (typeof hooks.bindCancel === "function") hooks.bindCancel(null);
    stopping = true; input.disabled = true; input.placeholder = "실행 종료"; stop.disabled = true;
    try { await fetch("/python-session-stop?id=" + encodeURIComponent(sessionId), { method: "POST" }); } catch(_){}
  }
  if (!result.stdout && !result.stderr){ pre.classList.add("out-muted"); pre.textContent = "(출력 없음)"; }
  appendVariableInspector(outPanel, result.variables);
  appendPlotGallery(outPanel, result.images);
  appendOutputFiles(outPanel, result.outputs, sessionId);
  if (typeof lessonPyOnResult === "function") lessonPyOnResult({ stdout: result.stdout, stderr: result.stderr, images: result.images });   // 수업 리플레이(녹화 중일 때만)
  result.sessionId = sessionId;
  return result;
}

// 대화형 터미널 stdout 을 다시 그린다. 입력 에코 구간(echoes: fullOut 기준 [시작,길이], 오름차순·비중첩)만
// span.out-echo 로 감싸 일반 출력과 색을 구분한다. seg.src 는 조각이 원본 어디서 왔는지(음수면 생략 안내 문구).
function renderPythonStdoutSegs(el, segs, echoes){
  el.textContent = "";
  const frag = document.createDocumentFragment();
  for (const seg of segs){
    if (seg.src < 0 || !echoes.length){ frag.appendChild(document.createTextNode(seg.text)); continue; }
    const segStart = seg.src, segEnd = seg.src + seg.text.length;
    let pos = segStart;
    for (const range of echoes){
      const start = Math.max(segStart, range[0]), end = Math.min(segEnd, range[0] + range[1]);
      if (end <= pos) continue;               // 이 조각보다 앞의 에코
      if (start >= segEnd) break;             // 이후 에코는 모두 이 조각 뒤
      if (start > pos) frag.appendChild(document.createTextNode(seg.text.slice(pos - segStart, start - segStart)));
      const span = document.createElement("span"); span.className = "out-echo";
      span.textContent = seg.text.slice(start - segStart, end - segStart);
      frag.appendChild(span);
      pos = end;
    }
    if (pos < segEnd) frag.appendChild(document.createTextNode(seg.text.slice(pos - segStart)));
  }
  el.appendChild(frag);
}

// 실행이 만든/바꾼 파일을 결과 패널에 [저장]·[열기] 와 함께 나열(로컬 세션 전용)
// 실행이 만든 파일 목록. 로컬 세션은 sessionId 로 서버에서 받고, 브라우저(Pyodide)는 f.bytes(메모리)에서 바로.
function appendOutputFiles(panel, outputs, sessionId){
  if (!outputs || !outputs.length) return;
  const wrap = document.createElement("div"); wrap.className = "out-files";
  const head = document.createElement("div"); head.className = "out-files-head";
  head.textContent = "실행이 만든 파일 (" + outputs.length + ")";
  wrap.appendChild(head);
  for (const f of outputs){
    const row = document.createElement("div"); row.className = "out-file";
    const name = document.createElement("span"); name.className = "of-name"; name.textContent = f.name;
    const size = document.createElement("span"); size.className = "of-size"; size.textContent = humanSize(f.size);
    const base = f.name.split("/").pop() || "file";
    const dl = document.createElement("a"); dl.className = "of-btn"; dl.textContent = "⬇ 저장"; dl.setAttribute("download", base);
    const open = document.createElement("button"); open.className = "of-btn"; open.type = "button"; open.textContent = "열기";
    if (f.bytes){                                   // 브라우저(Pyodide): 메모리 바이트
      dl.href = URL.createObjectURL(new Blob([f.bytes]));
      open.addEventListener("click", () => handleFiles([new File([f.bytes], base)]));
    } else {                                        // 로컬 세션: 서버에서 받기
      // <a href> 직접 다운로드는 X-Manneung-Token 헤더를 못 붙여 서버가 403으로 거절한다
      // → fetch(래퍼가 토큰 자동 첨부)로 받아 Blob 으로 저장
      const url = "/python-session-file?id=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(f.name);
      dl.href = "#";
      open.addEventListener("click", () => openSessionFile(sessionId, f.name));   // 서버에서 받아 앱 뷰어로 열기
      dl.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error(res.status === 404 ? "실행 결과가 만료되었어요 — 다시 실행해 주세요." : ("HTTP " + res.status));
          const blobUrl = URL.createObjectURL(await res.blob());
          const a = document.createElement("a"); a.href = blobUrl; a.download = base;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
        } catch(err){ toast("파일을 저장하지 못했어요: " + ((err && err.message) || err), 3000); }
      });
    }
    row.append(name, size, dl, open);
    wrap.appendChild(row);
  }
  panel.appendChild(wrap);
}
function appendVariableInspector(panel, variables){
  const rows = normalizePythonVariables(variables);
  if (!panel || !rows.length) return;
  const details = document.createElement("details"); details.className = "out-vars"; details.open = true;
  const summary = document.createElement("summary"); summary.textContent = "실행 후 변수 (" + rows.length + ")";
  const tableWrap = document.createElement("div"); tableWrap.className = "out-vars-scroll";
  const table = document.createElement("table"); table.className = "out-vars-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["변수", "자료형", "값"].forEach(label => { const th = document.createElement("th"); th.textContent = label; headRow.appendChild(th); });
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  rows.forEach(row => {
    const tr = document.createElement("tr");
    const name = document.createElement("td"); const nameCode = document.createElement("code"); nameCode.textContent = row.name; name.appendChild(nameCode);
    const type = document.createElement("td"); const typeCode = document.createElement("code"); typeCode.textContent = row.type; type.appendChild(typeCode);
    const value = document.createElement("td"); const valueCode = document.createElement("code"); valueCode.textContent = row.value; value.appendChild(valueCode);
    tr.append(name, type, value); tbody.appendChild(tr);
  });
  table.append(thead, tbody); tableWrap.appendChild(table); details.append(summary, tableWrap); panel.appendChild(details);
}
function humanSize(n){
  n = +n || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
// 코드가 input() 을 쓰는지(메서드 .input( 은 제외)
function usesInput(code){ return /(^|[^.\w])input\s*\(/.test(code || ""); }
// 출력 파일을 받아 앱 뷰어로 열기(csv·txt·이미지 등은 기존 미리보기로 표시)
async function openSessionFile(sessionId, name){
  try {
    const res = await fetch("/python-session-file?id=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(name));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = await res.arrayBuffer();
    const base = name.split("/").pop() || "file";
    await handleFiles([new File([buf], base)]);
  } catch(e){ toast("파일을 열지 못했어요: " + ((e && e.message) || e), 3000); }
}

// import 이름 → pip 패키지 이름(다른 경우만 매핑)
const IMPORT_TO_PIP = { bs4:"beautifulsoup4", cv2:"opencv-python", PIL:"pillow", sklearn:"scikit-learn",
  skimage:"scikit-image", yaml:"pyyaml", dateutil:"python-dateutil", dotenv:"python-dotenv",
  serial:"pyserial", Crypto:"pycryptodome", OpenSSL:"pyopenssl", win32com:"pywin32", googleapiclient:"google-api-python-client" };
function importToPip(name){ return IMPORT_TO_PIP[name] || name; }
function bundleHasLocalModule(bundle, name){
  if (!bundle || !Array.isArray(bundle.files) || !name) return false;
  const moduleFile = String(name).toLowerCase() + ".py";
  const packageFile = String(name).toLowerCase() + "/__init__.py";
  return bundle.files.some((file) => {
    const path = normalizedRunPath(file.path).toLowerCase();
    return path === moduleFile || path.endsWith("/" + moduleFile) ||
      path === packageFile || path.endsWith("/" + packageFile);
  });
}
function detectMissingModule(stderr){
  const m = /ModuleNotFoundError: No module named ['"]([\w.]+)['"]/.exec(stderr || "");
  return m ? m[1].split(".")[0] : null;   // 최상위 패키지명
}
// 로컬 파이썬에 pip 로 패키지 설치(진행/결과를 출력 패널에 표시). 성공 여부 반환.
// requirements.txt 텍스트에서 설치할 패키지만 추려냄 (빈 줄·주석·옵션 줄·인라인 주석 제거, 중복 제거)
function parseRequirements(txt){
  const out = [], seen = {};
  String(txt || "").split(/\r?\n/).forEach(line => {
    let s = line.trim();
    if (!s || s[0] === "#" || s[0] === "-") return;     // 빈 줄·주석·옵션(-r, --index-url 등) 건너뜀
    const h = s.indexOf(" #"); if (h >= 0) s = s.slice(0, h).trim();   // 인라인 주석 제거
    s = s.replace(/\s+/g, "");                            // 'name == 1.0' → 'name==1.0'
    if (!s) return;
    const key = s.toLowerCase();
    if (!seen[key]){ seen[key] = 1; out.push(s); }
  });
  return out;
}

async function runPipInstall(pkgs, ui){
  if (!Array.isArray(pkgs) || !pkgs.length) return false;
  const { outPanel, split, status } = ui;
  if (!(await pythonBackendAvailable())){
    toast("브라우저 실행에서는 패키지가 자동으로 받아져요 — 따로 설치할 필요 없습니다.", 4000);
    return false;
  }
  const approved = typeof confirmDialog === "function" && await confirmDialog(
    "다음 패키지를 이 컴퓨터의 Python 환경에 설치합니다.\n\n" + pkgs.join(", ") +
    "\n\n패키지 저장소에 인터넷으로 연결될 수 있으며, 설치한 패키지는 이 컴퓨터에 남습니다. 신뢰하는 패키지만 설치하세요.",
    "설치", "취소");
  if (!approved){
    if (status) status.textContent = "설치 취소";
    return false;
  }
  split.classList.add("show-out");
  if (ui.layoutBtn) ui.layoutBtn.hidden = false;
  outPanel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head"; head.textContent = "패키지 설치";
  const pre = document.createElement("pre"); pre.className = "out-pre out-muted";
  pre.textContent = "pip install " + pkgs.join(" ") + " …\n(수십 초~몇 분 걸릴 수 있어요 · 인터넷 필요)";
  outPanel.append(head, pre);
  if (status) status.textContent = "설치 중… " + pkgs.join(" ");
  try {
    const res = await fetch("/pip-install", { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8", "X-Manneung-Pip-Confirm":"1" }, body: pkgs.join(" ") });
    const txt = await res.text();
    let j; try { j = JSON.parse(txt); } catch(_){ j = { ok: res.ok, code: -1, output: txt }; }
    pre.classList.remove("out-muted");
    pre.textContent = (j.output || "").trim() || (j.ok ? "설치 완료" : "설치 실패");
    if (!j.ok){ const e = document.createElement("span"); e.className = "out-err"; e.textContent = "\n\n✖ 설치 실패 (코드 " + j.code + ") — 위 로그를 확인하세요."; pre.appendChild(e); }
    outPanel.scrollTop = outPanel.scrollHeight;
    if (status) status.textContent = j.ok ? "설치 완료 ✓" : "설치 실패";
    toast(j.ok ? ("설치 완료: " + pkgs.join(" ")) : "설치 실패 — 로그를 확인하세요", 3000);
    return !!j.ok;
  } catch(e){
    pre.classList.remove("out-muted"); pre.classList.add("out-err");
    pre.textContent = "설치 요청 실패: " + ((e && e.message) || e);
    if (status) status.textContent = "설치 실패";
    return false;
  }
}

async function runPipList(ui){
  const { outPanel, split, status } = ui;
  if (!(await pythonBackendAvailable())){
    toast("브라우저 실행에서는 설치 목록을 볼 수 없어요 — 로컬 파이썬에서만 가능합니다.", 4000);
    return;
  }
  split.classList.add("show-out");
  if (ui.layoutBtn) ui.layoutBtn.hidden = false;
  outPanel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head"; head.textContent = "설치된 라이브러리";
  const pre = document.createElement("pre"); pre.className = "out-pre out-muted";
  pre.textContent = "목록을 불러오는 중…";
  outPanel.append(head, pre);
  if (status) status.textContent = "목록 불러오는 중…";
  const script = [
    "import importlib.metadata as _m",
    "_seen = {}",
    "for _d in _m.distributions():",
    "    _n = _d.metadata['Name']",
    "    if _n and _n not in _seen: _seen[_n] = _d.version",
    "for _n in sorted(_seen, key=str.lower):",
    "    print(f'{_n}=={_seen[_n]}')",
    "print(f'\\n총 {len(_seen)}개 설치됨')",
  ].join("\n");
  try {
    const r = await runPythonViaBackend(script, "");
    pre.classList.remove("out-muted");
    const out = (r.stdout || "").trim();
    pre.textContent = out || "설치된 라이브러리가 없습니다.";
    if (r.stderr && r.stderr.trim()){ const e = document.createElement("span"); e.className = "out-err"; e.textContent = "\n\n" + r.stderr.trim(); pre.appendChild(e); }
    outPanel.scrollTop = 0;
    if (status) status.textContent = "목록 표시 완료 ✓";
  } catch(e){
    pre.classList.remove("out-muted"); pre.classList.add("out-err");
    pre.textContent = "목록 조회 실패: " + ((e && e.message) || e);
    if (status) status.textContent = "목록 조회 실패";
  }
}

async function runPythonViaBackend(src, stdin){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 65000);
  try {
    const res = await fetch("/run-python", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buildRunPayload(src, stdin), signal: ctrl.signal
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(txt && txt.indexOf("no-python") >= 0 ? "이 컴퓨터에서 파이썬을 찾지 못했어요." : (txt || ("HTTP " + res.status)));
    try { const j = JSON.parse(txt); return { stdout: j.stdout || "", stderr: j.stderr || "", code: (j.code != null ? j.code : 0), images: j.images || [] }; }
    catch(_){ return { stdout: txt, stderr: "", code: 0 }; }
  } finally { clearTimeout(timer); }
}

function loadScriptOnce(src){
  return new Promise((resolve, reject) => {
    const s = document.createElement("script"); s.src = src;
    s.onload = () => resolve(); s.onerror = () => reject(new Error("load-failed"));
    document.head.appendChild(s);
  });
}
// 코어 런타임 위치: exe 런처에 번들(vendor/pyodide/)이 있으면 로컬(오프라인), 없으면 CDN.
let _pyBasePromise = null;
function resolvePyodideBase(){
  if (_pyBasePromise) return _pyBasePromise;
  _pyBasePromise = (async () => {
    try {
      const r = await fetch(PY_LOCAL_BASE + "VERSION", { cache: "no-store" });
      if (r.ok && (await r.text()).trim()) return { base: PY_LOCAL_BASE, offline: true };
    } catch(_){}
    return { base: "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VER + "/full/", offline: false };
  })();
  return _pyBasePromise;
}
async function ensurePyodide(onMsg){
  if (_pyodidePromise) return _pyodidePromise;
  _pyodidePromise = (async () => {
    const sel = await resolvePyodideBase();
    const base = sel.base;
    if (typeof loadPyodide === "undefined"){
      onMsg && onMsg(sel.offline ? "파이썬 런타임 준비 중… (오프라인)" : "파이썬 런타임 내려받는 중… (최초 1회)");
      await loadScriptOnce(base + "pyodide.js");
    }
    onMsg && onMsg("파이썬 런타임 준비 중…");
    const py = await loadPyodide({ indexURL: base });
    // matplotlib 이 Pyodide 의 wasm_backend(from js import document)로 죽지 않도록 Agg 로 고정
    try { py.runPython("import os; os.environ['MPLBACKEND']='Agg'"); } catch(_){}
    // 번들된 한글 폰트를 풀어 쓰고 등록 헬퍼(__mn_setup_kfont)를 정의한다.
    try {
      py.globals.set("__MN_KFONT_GZ", koreanFontGzB64());
      py.runPython(KFONT_INIT_PY);
      py.globals.delete("__MN_KFONT_GZ");
    } catch(_){}
    return py;
  })().catch(err => { _pyodidePromise = null; throw err; });
  return _pyodidePromise;
}
// 브라우저 안에서 실행(Pyodide/WASM): 설치 불필요·샌드박스. 런타임은 최초 1회 CDN 로드(인터넷 필요)
async function capturePyodidePlots(py){
  try {
    const json = await py.runPythonAsync(
      "import io, base64, json\n" +
      "try:\n" +
      " import matplotlib.pyplot as _ps_plt\n" +
      " _ps_imgs=[]\n" +
      " for _ps_num in _ps_plt.get_fignums()[:8]:\n" +
      "  _ps_fig=_ps_plt.figure(_ps_num)\n" +
      "  if not any(getattr(_ps_fig,_ps_attr,[]) for _ps_attr in ('axes','artists','lines','images','texts','legends')):\n" +
      "   _ps_plt.close(_ps_fig); continue\n" +
      "  _ps_buf=io.BytesIO(); _ps_fig.savefig(_ps_buf, format='png', bbox_inches='tight')\n" +
      "  _ps_imgs.append('data:image/png;base64,'+base64.b64encode(_ps_buf.getvalue()).decode('ascii'))\n" +
      " _ps_plt.close('all')\n" +
      "except Exception:\n" +
      " _ps_imgs=[]\n" +
      "json.dumps(_ps_imgs)"
    );
    return JSON.parse(String(json));
  } catch(_){ return []; }
}

async function capturePyodideVariables(py, namespaceName, cleanupGlobals){
  try {
    const namespaceLine = namespaceName
      ? "_ps_ns = globals().get(" + JSON.stringify(namespaceName) + ", {})\n"
      : "_ps_ns = globals()\n";
    const raw = await py.runPythonAsync(
      "import json as _ps_json, types as _ps_types\n" +
      namespaceLine +
      "_ps_items = []\n" +
      "_ps_names = []\n" +
      "for _ps_name in sorted(list(_ps_ns)):\n" +
      " if not _ps_name or _ps_name.startswith('_'):\n" +
      "  continue\n" +
      " _ps_names.append(_ps_name)\n" +
      " _ps_value = _ps_ns[_ps_name]\n" +
      " if isinstance(_ps_value, (_ps_types.ModuleType, _ps_types.FunctionType, _ps_types.BuiltinFunctionType, type)) or callable(_ps_value):\n" +
      "  continue\n" +
      " try:\n" +
      "  _ps_text = repr(_ps_value)\n" +
      " except Exception:\n" +
      "  _ps_text = '<값을 표시할 수 없음>'\n" +
      " if len(_ps_text) > 600:\n" +
      "  _ps_text = _ps_text[:599] + '…'\n" +
      " _ps_items.append({'name': _ps_name[:120], 'type': type(_ps_value).__name__[:120], 'value': _ps_text})\n" +
      " if len(_ps_items) >= 80:\n" +
      "  break\n" +
      "_ps_json.dumps({'items': _ps_items, 'names': _ps_names}, ensure_ascii=False)"
    );
    const parsed = JSON.parse(String(raw));
    if (cleanupGlobals && Array.isArray(parsed.names)){
      parsed.names.forEach(name => { try { py.globals.delete(String(name)); } catch(_){} });
    }
    return normalizePythonVariables(parsed.items);
  } catch(_){
    return [];
  }
}

// Pyodide 가상 파일시스템(MEMFS)에서 base 아래 파일을 재귀적으로 나열
function pyFsWalk(py, base){
  const out = [];
  const walk = (dir) => {
    let names; try { names = py.FS.readdir(dir); } catch(_){ return; }
    for (const n of names){
      if (n === "." || n === "..") continue;
      const full = (dir === "/" ? "" : dir) + "/" + n;
      let st; try { st = py.FS.stat(full); } catch(_){ continue; }
      if (py.FS.isDir(st.mode)) walk(full);
      else out.push({ path: full, size: st.size, mtime: st.mtime && st.mtime.getTime ? st.mtime.getTime() : Number(st.mtime || 0) });
    }
  };
  walk(base);
  return out;
}
function pyFsSnapshot(py, base){
  const m = new Map();
  for (const f of pyFsWalk(py, base)) m.set(f.path, f.size + ":" + f.mtime);
  return m;
}
// 실행 후 새로 생기거나 크기가 바뀐 파일을 {name, size, bytes}[] 로 수집(파일 40MB·합계 50MB 상한)
function pyFsCollectOutputs(py, base, snap){
  const out = []; let total = 0;
  for (const f of pyFsWalk(py, base)){
    if (snap.has(f.path) && snap.get(f.path) === f.size + ":" + f.mtime) continue;
    if (f.size > 40 * 1024 * 1024) continue;
    if (total + f.size > 50 * 1024 * 1024) break;
    let bytes; try { bytes = py.FS.readFile(f.path, { encoding: "binary" }); } catch(_){ continue; }
    total += bytes.length;
    out.push({ name: f.path.slice(base.length).replace(/^\/+/, ""), size: bytes.length, bytes });
  }
  return out;
}

// ── 외부 패키지 설치(브라우저 Pyodide) ───────────────────────────────────────
// 코어는 로컬(오프라인)에서 부팅하고, 코드가 import 하는 외부 패키지(numpy·pandas 등)만
// 인터넷이 있을 때 사용자 동의를 받아 CDN 에서 내려받는다. import명→패키지·의존성은 로컬
// pyodide-lock.json 으로 풀고, 각 .whl 을 CDN 절대 URL 로 loadPackage 한다(코어 base 가 로컬이므로).
let _pyLockPromise = null;
function loadPyodideLockMap(){
  if (_pyLockPromise) return _pyLockPromise;
  _pyLockPromise = (async () => {
    let lock = null;
    for (const u of [PY_LOCAL_BASE + "pyodide-lock.json",
                     "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VER + "/full/pyodide-lock.json"]){
      try { const r = await fetch(u, { cache: "no-store" }); if (r.ok){ lock = await r.json(); break; } } catch(_){}
    }
    if (!lock || !lock.packages) return null;
    const byName = lock.packages;                  // 패키지명 → 엔트리(file_name·depends·imports)
    const byImport = new Map();                     // top-level import 모듈명 → 패키지 엔트리
    const byNormalized = new Map();                 // -, _, . 표기가 다른 의존성 이름도 같은 패키지로 연결
    for (const k in byName){
      byNormalized.set(String(k).toLowerCase().replace(/[-_.]+/g, "-"), byName[k]);
      for (const imp of (byName[k].imports || [])) byImport.set(imp, byName[k]);
    }
    return { byName, byImport, byNormalized };
  })().catch(() => null);
  return _pyLockPromise;
}
// 사용자가 한 번 '받기'에 동의한 Pyodide 패키지는 기억해, 다음부터(앱 재시작·새로고침·워커 재시작 포함)
// 다시 묻지 않고 조용히 받는다. 다운로드 자체는 세션마다 일어나므로 인터넷은 여전히 필요하다.
const PKG_CONSENT_KEY = "mn.pyodide.pkgConsent";
function loadPkgConsent(){
  try { const raw = localStorage.getItem(PKG_CONSENT_KEY); return new Set(raw ? JSON.parse(raw) : []); }
  catch(_){ return new Set(); }
}
// names 전부가 이미 동의된 패키지면 true(묻지 않고 통과). 새 패키지가 하나라도 끼면 false(물어봐야 함).
function pkgAlreadyConsented(names){
  const set = loadPkgConsent();
  return names.length > 0 && names.every(n => set.has(n));
}
function rememberPkgConsent(names){
  const set = loadPkgConsent();
  for (const n of names) set.add(n);
  try { localStorage.setItem(PKG_CONSENT_KEY, JSON.stringify(Array.from(set))); } catch(_){}
}
// 필요한 패키지(names)에 대해 동의를 받는다. 이미 동의된 것뿐이면 묻지 않고 통과한다.
// 취소하면 throw(호출부가 stderr/status 로 보여줌). 새로 동의하면 기억해 둔다.
async function ensurePkgConsent(names, label){
  if (pkgAlreadyConsented(names)) return;
  const ok = await confirmDialog(
    "이 코드에 필요한 패키지(" + label + ")를 인터넷에서 받아 설치할까요? 한 번 받으면 다시 묻지 않아요.",
    "받기", "취소");
  if (!ok) throw new Error("패키지 설치를 취소했어요. (코어 파이썬·표준 라이브러리는 그대로 쓸 수 있어요)");
  rememberPkgConsent(names);
}
// import 모듈명들 → 받아야 할 패키지(의존성 포함, 이미 설치된 건 제외). 표준 라이브러리·미제공은 자연히 빠진다.
function resolveNeededPackages(imports, lockMap, py){
  const loaded = (py && py.loadedPackages) ? py.loadedPackages : {};
  const picked = new Map();
  const visit = (e) => {
    if (!e || picked.has(e.name) || loaded[e.name]) return;
    picked.set(e.name, e);
    for (const dep of (e.depends || [])){
      const raw = String(dep);
      const normalized = raw.toLowerCase().replace(/[-_.]+/g, "-");
      const d = lockMap.byName[raw] || lockMap.byName[raw.toLowerCase()] ||
        (lockMap.byNormalized && lockMap.byNormalized.get(normalized));
      if (d) visit(d);
    }
  };
  for (const imp of imports){ const e = lockMap.byImport.get(imp); if (e) visit(e); }
  return Array.from(picked.values());
}

function pyodideImportsWithRuntimeNeeds(code, imports){
  const names = new Set(Array.from(imports || []).map(String));
  const source = String(code || "");
  const usesPlotlyExpress = names.has("plotly") && (
    /\bimport\s+plotly\.express\b/.test(source) ||
    /\bfrom\s+plotly\s+import\s+express\b/.test(source) ||
    /\bfrom\s+plotly\.express\s+import\b/.test(source)
  );
  // Plotly Express의 NumPy/Pandas 의존성은 Plotly 기본 wheel의 필수 의존성으로 선언되지 않아
  // import plotly.express만 설치하면 런타임 ImportError가 난다. Pyodide 공식 wheel을 함께 준비한다.
  if (usesPlotlyExpress){
    names.add("numpy");
    names.add("pandas");
  }
  return Array.from(names);
}

// 코드가 import 하는 외부 패키지를 (동의 후) CDN 에서 받아 설치한다.
// 표준 라이브러리/이미 설치된 것뿐이면 묻지 않고 통과. 취소하거나 인터넷이 없으면 사용자용
// 메시지를 throw → 호출부가 stderr 로 보여주고, 코어 파이썬은 계속 쓸 수 있다.
async function preloadPyodidePackages(py, code, onMsg){
  let imports = [];
  try { const r = py.runPython("from pyodide.code import find_imports as _fi\n_fi(" + JSON.stringify(code) + ")"); imports = r.toJs(); r.destroy(); }
  catch(_){ return; }
  imports = pyodideImportsWithRuntimeNeeds(code, imports);
  if (!imports || !imports.length) return;
  const lockMap = await loadPyodideLockMap();
  if (!lockMap) return;                                  // lock 을 못 읽으면 조용히 통과(이후 import 에러로 드러남)
  const need = resolveNeededPackages(imports, lockMap, py);
  if (!need.length) return;                              // 받을 게 없음(표준 라이브러리이거나 이미 설치됨)
  const names = need.map(p => p.name);
  const label = names.length <= 4 ? names.join(", ") : (names.slice(0, 4).join(", ") + " 외 " + (names.length - 4) + "개");
  await ensurePkgConsent(names, label);
  const baseCdn = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VER + "/full/";
  onMsg && onMsg("패키지 받는 중… (" + label + ")");
  // openblas 등 shared_library(.zip)는 URL 로 loadPackage 에 못 넘긴다. .whl 만 URL 로 받고,
  // 나머지는 이름으로 받되 indexURL 을 CDN 으로 잠깐 돌려 CDN 의 .zip 을 받게 한다.
  const wheelUrls = need.filter(p => /\.whl$/i.test(String(p.file_name || ""))).map(p => baseCdn + p.file_name);
  const libNames = need.filter(p => !/\.whl$/i.test(String(p.file_name || ""))).map(p => p.name);
  try {
    // shared_library(openblas)를 확장 휠(scipy 등)보다 먼저 로드해야 동적 링크가 맞는다.
    if (libNames.length){
      let prev = null, patched = false;
      try {
        const cfg = py._api && py._api.config;
        if (cfg && cfg.indexURL !== baseCdn){ prev = cfg.indexURL; cfg.indexURL = baseCdn; patched = true; }
        await py.loadPackage(libNames);
      } finally { if (patched){ try { py._api.config.indexURL = prev; } catch(_){} } }
    }
    if (wheelUrls.length) await py.loadPackage(wheelUrls);
  }
  catch(e){ throw new Error("패키지를 받지 못했어요 — 인터넷 연결을 확인해 주세요. 코어 파이썬·표준 라이브러리는 계속 쓸 수 있어요."); }
}

// 브라우저 Python은 별도 Worker에서 실행해 무한 반복·무거운 계산이 UI 전체를 막지 않게 한다.
// Worker를 지원하지 않거나 초기화에 실패한 환경은 아래 기존 메인 스레드 경로로 폴백한다.
const PYODIDE_WORKER_TIMEOUT = 5 * 60 * 1000;
const PYTHON_OUTPUT_HEAD_LIMIT = 4 * 1024 * 1024;
const PYTHON_PROTOCOL_LIMIT = 6 * 1024 * 1024;
const PYTHON_OUTPUT_TRUNCATED_NOTICE = "\n\n[출력이 4MB를 넘어 이후 내용은 생략했습니다. 실행은 계속됩니다.]\n";

// 일반 출력은 앞 4MB까지만 보관한다. 진단·채점·단계 실행 결과는 stdout 끝의 전용 마커로 전달되므로
// 마커부터 시작하는 프로토콜 데이터만 별도 제한(6MB) 안에서 보존해 기능 결과가 잘리지 않게 한다.
function createPythonOutputCollector(headLimit=PYTHON_OUTPUT_HEAD_LIMIT, protocolLimit=PYTHON_PROTOCOL_LIMIT){
  const markers = [PY_DIAG_MARKER, PY_GRADE_MARKER, PY_TRACE_MARKER];
  const scanSize = Math.max(...markers.map(marker => marker.length)) - 1;
  let head = "", protocol = "", scanTail = "", capturingProtocol = false, truncated = false;
  const append = (value) => {
    const text = String(value == null ? "" : value);
    if (!text) return;
    const combined = scanTail + text;
    let markerAt = -1;
    for (const marker of markers) markerAt = Math.max(markerAt, combined.lastIndexOf(marker));
    if (markerAt >= 0){
      capturingProtocol = true;
      protocol = combined.slice(markerAt, markerAt + protocolLimit);
    } else if (capturingProtocol && protocol.length < protocolLimit){
      protocol += text.slice(0, protocolLimit - protocol.length);
    }
    scanTail = combined.slice(-scanSize);
    const remaining = headLimit - head.length;
    if (remaining > 0) head += text.slice(0, remaining);
    if (text.length > Math.max(0, remaining)) truncated = true;
  };
  return {
    append,
    value: () => truncated ? head + PYTHON_OUTPUT_TRUNCATED_NOTICE + (protocol ? protocol : "") : head,
    isTruncated: () => truncated
  };
}

let _pyWorker = null;
let _pyWorkerReadyPromise = null;
let _pyWorkerReadyResolve = null;
let _pyWorkerReadyReject = null;
let _pyWorkerInitOnMsg = null;
let _pyWorkerSeq = 0;
const _pyWorkerJobs = new Map();
const _pyWorkerLoadedPackages = new Set();
const _pyWorkerKernelWorkspaces = new Set();

function pyWorkerError(message, code){
  const err = new Error(message);
  err.code = code || "worker-error";
  return err;
}

// 번들된 한글 폰트(NanumGothic, gzip+base64)를 꺼낸다. korean-font.js 가 globalThis 에 심어둔다.
function koreanFontGzB64(){
  try { return (typeof globalThis !== "undefined" && globalThis.__MN_KFONT_GZ_B64) || ""; }
  catch(_){ return ""; }
}
// Pyodide 초기화 때 1회: 전역 __MN_KFONT_GZ(gzip+base64)를 풀어 /fonts 에 쓰고,
// matplotlib 에 폰트와 한글 폰트 별칭(맑은 고딕 등)을 등록하는 헬퍼 __mn_setup_kfont 를 builtins 에 정의한다.
// 헬퍼는 matplotlib 이 로드된 뒤(사용자 코드 실행 직전) 호출되어야 실제 등록이 일어난다(find_spec 로 가드).
const KFONT_INIT_PY = `import os, base64, gzip, builtins
try:
    _gz = globals().get('__MN_KFONT_GZ') or ''
    if _gz and not os.path.exists('/fonts/NanumGothic.ttf'):
        os.makedirs('/fonts', exist_ok=True)
        with open('/fonts/NanumGothic.ttf', 'wb') as _f:
            _f.write(gzip.decompress(base64.b64decode(_gz)))
except Exception:
    pass

def __mn_setup_kfont():
    import sys, os
    if getattr(sys, '_mn_kfont_done', False):
        return
    import importlib.util
    if importlib.util.find_spec('matplotlib') is None:
        return
    if not os.path.exists('/fonts/NanumGothic.ttf'):
        return
    try:
        import matplotlib
        import matplotlib.font_manager as fm
        fm.fontManager.addfont('/fonts/NanumGothic.ttf')
        matplotlib.rcParams['font.family'] = 'NanumGothic'
        matplotlib.rcParams['axes.unicode_minus'] = False
        try:
            from matplotlib.font_manager import FontEntry
            for _a in ('NanumGothic','Nanum Gothic','Malgun Gothic','\\uba51\\uc740 \\uace0\\ub515','Gulim','\\uad74\\ub9bc','Dotum','\\ub3cb\\uc6c0','Batang','\\ubc14\\ud0d5','AppleGothic','Apple SD Gothic Neo','Noto Sans CJK KR','Noto Sans KR'):
                fm.fontManager.ttflist.append(FontEntry(fname='/fonts/NanumGothic.ttf', name=_a, style='normal', variant='normal', weight='normal', stretch='normal', size='scalable'))
        except Exception:
            pass
        try:
            fm.findfont.cache_clear()
        except Exception:
            pass
        sys._mn_kfont_done = True
    except Exception:
        pass

builtins.__mn_setup_kfont = __mn_setup_kfont
`;
// 사용자 코드 실행 직전에 호출 — matplotlib 이 있을 때만 한글 폰트를 등록한다(없으면 즉시 통과).
const KFONT_SETUP_CALL = "try:\n    __mn_setup_kfont()\nexcept Exception:\n    pass\n";

// Blob Worker 안에서 독립 실행되므로 이 함수는 바깥 변수를 참조하지 않는다.
function pyodideWorkerMain(){
  let py = null;
  let runQueue = Promise.resolve();
  let kfontCall = "";   // 사용자 코드 직전에 실행할 한글 폰트 등록 호출(init 에서 메인스레드가 전달)
  let pkgCdnBase = "";  // 온라인 패키지 인덱스(CDN). 코어가 로컬(offline) 이어도 휠은 여기서 받는다.
  const kernelWorkspaces = new Map();
  const outputHeadLimit = 4 * 1024 * 1024;
  const protocolLimit = 6 * 1024 * 1024;
  const truncatedNotice = "\n\n[출력이 4MB를 넘어 이후 내용은 생략했습니다. 실행은 계속됩니다.]\n";
  const makeOutputCollector = () => {
    const markers = ["__MANNEUNG_DIAG__", "__MANNEUNG_GRADE__", "__MANNEUNG_TRACE__"];
    const scanSize = Math.max(...markers.map(marker => marker.length)) - 1;
    let head = "", protocol = "", scanTail = "", capturing = false, truncated = false;
    return {
      append(value){
        const text = String(value == null ? "" : value);
        if (!text) return;
        const combined = scanTail + text;
        let markerAt = -1;
        for (const marker of markers) markerAt = Math.max(markerAt, combined.lastIndexOf(marker));
        if (markerAt >= 0){ capturing = true; protocol = combined.slice(markerAt, markerAt + protocolLimit); }
        else if (capturing && protocol.length < protocolLimit) protocol += text.slice(0, protocolLimit - protocol.length);
        scanTail = combined.slice(-scanSize);
        const remaining = outputHeadLimit - head.length;
        if (remaining > 0) head += text.slice(0, remaining);
        if (text.length > Math.max(0, remaining)) truncated = true;
      },
      value(){ return truncated ? head + truncatedNotice + (protocol || "") : head; }
    };
  };
  const safeRel = (value) => {
    const parts = String(value || "").replace(/\\/g, "/").split("/").filter(Boolean);
    if (!parts.length || parts.some(part => part === "..")) throw new Error("잘못된 작업 파일 경로입니다.");
    return parts.filter(part => part !== ".").join("/");
  };
  const walkFs = (base) => {
    const out = [];
    const walk = (dir) => {
      let names; try { names = py.FS.readdir(dir); } catch(_){ return; }
      for (const name of names){
        if (name === "." || name === "..") continue;
        const full = (dir === "/" ? "" : dir) + "/" + name;
        let stat; try { stat = py.FS.stat(full); } catch(_){ continue; }
        if (py.FS.isDir(stat.mode)) walk(full);
        else out.push({ path:full, size:stat.size, mtime:stat.mtime && stat.mtime.getTime ? stat.mtime.getTime() : Number(stat.mtime || 0) });
      }
    };
    walk(base);
    return out;
  };
  const snapshotFs = (base) => {
    const result = new Map();
    for (const file of walkFs(base)) result.set(file.path, file.size + ":" + file.mtime);
    return result;
  };
  const collectOutputs = (base, snapshot) => {
    const out = []; let total = 0;
    for (const file of walkFs(base)){
      if (snapshot.has(file.path) && snapshot.get(file.path) === file.size + ":" + file.mtime) continue;
      if (file.size > 40 * 1024 * 1024) continue;
      if (total + file.size > 50 * 1024 * 1024) break;
      let bytes; try { bytes = py.FS.readFile(file.path, { encoding:"binary" }); } catch(_){ continue; }
      total += bytes.length;
      out.push({ name:file.path.slice(base.length).replace(/^\/+/, ""), size:bytes.length, bytes });
    }
    return out;
  };
  const capturePlots = async () => {
    try {
      const raw = await py.runPythonAsync(
        "import io, base64, json\n" +
        "try:\n" +
        " import matplotlib.pyplot as _ps_plt\n" +
        " _ps_imgs=[]\n" +
        " for _ps_num in _ps_plt.get_fignums()[:8]:\n" +
        "  _ps_fig=_ps_plt.figure(_ps_num)\n" +
        "  if not any(getattr(_ps_fig,_ps_attr,[]) for _ps_attr in ('axes','artists','lines','images','texts','legends')):\n" +
        "   _ps_plt.close(_ps_fig); continue\n" +
        "  _ps_buf=io.BytesIO(); _ps_fig.savefig(_ps_buf, format='png', bbox_inches='tight')\n" +
        "  _ps_imgs.append('data:image/png;base64,'+base64.b64encode(_ps_buf.getvalue()).decode('ascii'))\n" +
        " _ps_plt.close('all')\n" +
        "except Exception:\n" +
        " _ps_imgs=[]\n" +
        "json.dumps(_ps_imgs)"
      );
      return JSON.parse(String(raw));
    } catch(_){ return []; }
  };
  const captureVariables = async (namespaceName, cleanupGlobals, options) => {
    try {
      options = options && typeof options === "object" ? options : {};
      const maxItems = options.maxItems === 0 ? 0 : Math.max(1, Math.min(80, Number(options.maxItems) || 80));
      const dataframeHtmlLimit = Math.max(0, Math.min(12, Number(options.dataframeHtmlLimit) || 0));
      const dataframeRows = Math.max(1, Math.min(50, Number(options.dataframeRows) || 20));
      const dataframeCols = Math.max(1, Math.min(50, Number(options.dataframeCols) || 20));
      const metadataOnly = options.metadataOnly === true;
      const variableNames = Array.isArray(options.variableNames)
        ? options.variableNames.map(name => String(name)).filter(Boolean)
        : [];
      const namespaceLine = namespaceName
        ? "_ps_ns = globals().get(" + JSON.stringify(namespaceName) + ", {})\n"
        : "_ps_ns = globals()\n";
      const raw = await py.runPythonAsync(
        "import json as _ps_json, types as _ps_types\n" +
        namespaceLine +
        "_ps_items = []\n" +
        "_ps_names = []\n" +
        "_ps_html_count = 0\n" +
        "_ps_max_items = " + maxItems + "\n" +
        "_ps_df_html_limit = " + dataframeHtmlLimit + "\n" +
        "_ps_df_rows = " + dataframeRows + "\n" +
        "_ps_df_cols = " + dataframeCols + "\n" +
        "_ps_metadata_only = " + (metadataOnly ? "True" : "False") + "\n" +
        "_ps_only_names = set(" + JSON.stringify(variableNames) + ")\n" +
        "for _ps_name in sorted(list(_ps_ns)):\n" +
        " if not _ps_name or _ps_name.startswith('_'):\n" +
        "  continue\n" +
        " if _ps_only_names and _ps_name not in _ps_only_names:\n" +
        "  continue\n" +
        " _ps_names.append(_ps_name)\n" +
        " _ps_value = _ps_ns[_ps_name]\n" +
        " if isinstance(_ps_value, (_ps_types.ModuleType, _ps_types.FunctionType, _ps_types.BuiltinFunctionType, type)) or callable(_ps_value):\n" +
        "  continue\n" +
        " _ps_type = type(_ps_value)\n" +
        " _ps_type_name = _ps_type.__name__[:120]\n" +
        " _ps_type_module = getattr(_ps_type, '__module__', '')\n" +
        " _ps_is_df = _ps_type_name == 'DataFrame' and (_ps_type_module == 'pandas.core.frame' or _ps_type_module.startswith('pandas.'))\n" +
        " _ps_shape_rows = None\n" +
        " _ps_shape_cols = None\n" +
        " _ps_item = {'name': _ps_name[:120], 'type': _ps_type_name, 'value': ''}\n" +
        // shape(행×열)이 있으면 요약에 쓴다(DataFrame·2차원 배열).
        " _ps_sh = getattr(_ps_value, 'shape', None)\n" +
        " if isinstance(_ps_sh, tuple) and len(_ps_sh) == 2:\n" +
        "  try:\n" +
        "   _ps_shape_rows = int(_ps_sh[0])\n" +
        "   _ps_shape_cols = int(_ps_sh[1])\n" +
        "   _ps_item['shape'] = str(_ps_shape_rows) + '\\u00d7' + str(_ps_shape_cols)\n" +
        "  except Exception:\n" +
        "   pass\n" +
        // DataFrame은 전체 repr을 만들지 않는다. 앞부분만 잘라 고정 크기 표로 만든다.
        " if _ps_metadata_only:\n" +
        "  _ps_item['lazy'] = True\n" +
        " elif _ps_is_df:\n" +
        "  _ps_item['value'] = 'DataFrame' + (('(' + _ps_item['shape'] + ')') if 'shape' in _ps_item else '')\n" +
        "  if _ps_html_count < _ps_df_html_limit:\n" +
        "   _ps_html_count += 1\n" +
        "   try:\n" +
        "    _ps_preview = _ps_value.iloc[:_ps_df_rows, :_ps_df_cols]\n" +
        "    _ps_h = str(_ps_preview.to_html(max_rows=_ps_df_rows, max_cols=_ps_df_cols))\n" +
        "    if 0 < len(_ps_h) <= 153600:\n" +
        "     _ps_item['html'] = _ps_h\n" +
        "     if (_ps_shape_rows is not None and _ps_shape_rows > _ps_df_rows) or (_ps_shape_cols is not None and _ps_shape_cols > _ps_df_cols):\n" +
        "      _ps_item['tableNote'] = '앞 ' + str(_ps_df_rows) + '행 × ' + str(_ps_df_cols) + '열 미리보기'\n" +
        "   except Exception:\n" +
        "    pass\n" +
        " else:\n" +
        "  try:\n" +
        "   _ps_text = repr(_ps_value)\n" +
        "  except Exception:\n" +
        "   _ps_text = '<값을 표시할 수 없음>'\n" +
        "  if len(_ps_text) > 600:\n" +
        "   _ps_text = _ps_text[:599] + '…'\n" +
        "  _ps_item['value'] = _ps_text\n" +
        " _ps_items.append(_ps_item)\n" +
        " if _ps_max_items and len(_ps_items) >= _ps_max_items:\n" +
        "  break\n" +
        "_ps_json.dumps({'items': _ps_items, 'names': _ps_names}, ensure_ascii=False)"
      );
      const parsed = JSON.parse(String(raw));
      if (cleanupGlobals && Array.isArray(parsed.names)){
        parsed.names.forEach(name => { try { py.globals.delete(String(name)); } catch(_){} });
      }
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch(_){ return []; }
  };
  const removeKernelWorkspace = (kid) => {
    const workspace = kernelWorkspaces.get(kid);
    kernelWorkspaces.delete(kid);
    if (!workspace) return;
    try {
      py.globals.set("__mn_workspace_root", workspace.root);
      py.runPython(
        "import os, sys, shutil\n" +
        "os.chdir('/home/pyodide')\n" +
        "for __mn_name, __mn_mod in list(sys.modules.items()):\n" +
        "    __mn_file = getattr(__mn_mod, '__file__', '')\n" +
        "    if isinstance(__mn_file, str) and __mn_file.startswith(__mn_workspace_root):\n" +
        "        sys.modules.pop(__mn_name, None)\n" +
        "sys.path[:] = [__mn_path for __mn_path in sys.path if not str(__mn_path).startswith(__mn_workspace_root)]\n" +
        "shutil.rmtree(__mn_workspace_root, ignore_errors=True)"
      );
    } catch(_){}
    try { py.globals.delete("__mn_workspace_root"); } catch(_){}
  };
  const kernelVariableTask = async (data) => {
    const id = data.id;
    const kid = String(data.kernelId || "default");
    const name = String(data.variableName || "");
    try {
      py.globals.set("__k_lookup_id", kid);
      py.runPython(
        "globals()['__k_lookup_ns'] = globals().get('__mn_kernels', {}).get(__k_lookup_id, {})"
      );
      const variables = name ? await captureVariables("__k_lookup_ns", false, {
        maxItems:1,
        dataframeHtmlLimit:1,
        dataframeRows:20,
        dataframeCols:20,
        variableNames:[name]
      }) : [];
      self.postMessage({
        type:"result",
        id,
        result:{ variable:variables.length ? variables[0] : null }
      });
    } catch(error){
      self.postMessage({ type:"task-error", id, message:(error && error.message) ? error.message : String(error) });
    } finally {
      try {
        py.globals.delete("__k_lookup_id");
        py.globals.delete("__k_lookup_ns");
      } catch(_){}
    }
  };
  const ensureKernelWorkspace = (kid, bundle) => {
    let workspace = kernelWorkspaces.get(kid);
    if (workspace || !bundle) return workspace || null;
    const root = "/nbproj_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    py.FS.mkdirTree(root);
    for (const dir of bundle.dirs || []){
      const path = safeRel(dir);
      if (path) py.FS.mkdirTree(root + "/" + path);
    }
    for (const file of bundle.files || []){
      const path = safeRel(file.path);
      const full = root + "/" + path;
      const slash = full.lastIndexOf("/");
      if (slash > 0) py.FS.mkdirTree(full.slice(0, slash));
      py.FS.writeFile(full, file.bytes);
    }
    const cwd = bundle.cwd ? safeRel(bundle.cwd) : "";
    const runDir = cwd ? root + "/" + cwd : root;
    py.FS.mkdirTree(runDir);
    workspace = {
      root,
      runDir,
      snapshots:new Map([[runDir, snapshotFs(runDir)]])
    };
    kernelWorkspaces.set(kid, workspace);
    return workspace;
  };
  const syncKernelWorkspace = (workspace, sync) => {
    if (!workspace || !sync) return false;
    for (const dir of sync.dirs || []){
      const path = safeRel(dir);
      if (path) py.FS.mkdirTree(workspace.root + "/" + path);
    }
    for (const file of sync.files || []){
      const path = safeRel(file.path);
      const full = workspace.root + "/" + path;
      const slash = full.lastIndexOf("/");
      if (slash > 0) py.FS.mkdirTree(full.slice(0, slash));
      py.FS.writeFile(full, file.bytes);
    }
    workspace.snapshots.clear();
    return true;
  };
  const installTaskPackages = async (data, id) => {
    const urls = Array.isArray(data.packageUrls) ? data.packageUrls : [];
    const libNames = Array.isArray(data.packageLibNames) ? data.packageLibNames : [];
    const wheels = Array.isArray(data.packageWheels) ? data.packageWheels : [];
    const online = Array.isArray(data.onlinePackages) ? data.onlinePackages : [];
    if (!urls.length && !libNames.length && !wheels.length && !online.length) return;
    const labels = Array.isArray(data.packageNames) && data.packageNames.length
      ? data.packageNames
      : online;
    self.postMessage({
      type:"progress",
      id,
      message:(online.length ? "패키지 설치 중… (" : "패키지 준비 중… (") + labels.join(", ") + ")"
    });
    try {
      // shared_library(openblas 등)를 휠보다 '먼저' 로드해야 한다. scipy 같은 확장 휠은 openblas
      // 에 동적 링크되므로, openblas 가 먼저 로드돼 있지 않으면 휠 로드가 "Failed to load scipy"
      // → import 시 "PyInit__dop" 같은 링크 오류로 터진다.
      if (libNames.length){
        // openblas 등 shared_library 패키지는 .whl 이 아니라 .zip 이라 URL 형태로 loadPackage 에
        // 넘기면 "No known package with name '<url>'" 로 실패한다(scipy·scikit-learn 계열이 openblas
        // 를 물고 들어와 배치 전체가 무너졌음). 이름으로 넘기되, 코어가 로컬(offline)이면 indexURL 을
        // CDN 으로 잠깐 돌려 CDN 에서 .zip 을 받게 한다(설치 후 원복). micropip 경로와 같은 방식.
        let prevLibIndexURL = null, libIndexPatched = false;
        try {
          const cfg = pkgCdnBase && py._api && py._api.config;
          if (cfg && cfg.indexURL !== pkgCdnBase){ prevLibIndexURL = cfg.indexURL; cfg.indexURL = pkgCdnBase; libIndexPatched = true; }
          await py.loadPackage(libNames);
        } finally {
          if (libIndexPatched){ try { py._api.config.indexURL = prevLibIndexURL; } catch(_){} }
        }
      }
      if (urls.length) await py.loadPackage(urls);
      if (wheels.length){
        const wheelDir = "/tmp/mn-pyodide-wheels";
        py.FS.mkdirTree(wheelDir);
        const wheelPaths = [];
        for (const wheel of wheels){
          const fileName = String(wheel.fileName || "package.whl").replace(/[^A-Za-z0-9_.-]/g, "_");
          const fullPath = wheelDir + "/" + fileName;
          py.FS.writeFile(fullPath, wheel.bytes);
          wheelPaths.push(fullPath);
        }
        py.globals.set("__mn_bundled_wheel_paths_json", JSON.stringify(wheelPaths));
        try {
          await py.runPythonAsync(
            "import json as __mn_json, site as __mn_site, zipfile as __mn_zipfile\n" +
            "__mn_site_dir = __mn_site.getsitepackages()[0]\n" +
            "for __mn_wheel_path in __mn_json.loads(__mn_bundled_wheel_paths_json):\n" +
            "    with __mn_zipfile.ZipFile(__mn_wheel_path) as __mn_wheel_zip:\n" +
            "        __mn_wheel_zip.extractall(__mn_site_dir)"
          );
        } finally {
          try { py.globals.delete("__mn_bundled_wheel_paths_json"); } catch(_){}
          for (const wheel of wheels){
            const fileName = String(wheel.fileName || "package.whl").replace(/[^A-Za-z0-9_.-]/g, "_");
            try { py.FS.unlink(wheelDir + "/" + fileName); } catch(_){}
          }
        }
      }
      if (online.length){
        await py.loadPackage("micropip");
        // micropip 은 온라인 패키지(folium 등)의 의존성 중 Pyodide 락에 있는 것(jinja2 등)을
        // config.indexURL 기준으로 loadPackage 한다. 코어를 로컬(vendor/pyodide)에서 띄우면
        // indexURL 이 로컬을 가리키는데 거기엔 휠이 없어(0개) 404 → jinja2 미설치 → import 실패.
        // 온라인 설치 동안만 인덱스를 CDN 으로 돌려 락 의존성도 CDN 에서 받게 한다(설치 후 원복).
        let prevIndexURL = null, indexPatched = false;
        try {
          const cfg = pkgCdnBase && py._api && py._api.config;
          if (cfg && cfg.indexURL !== pkgCdnBase){ prevIndexURL = cfg.indexURL; cfg.indexURL = pkgCdnBase; indexPatched = true; }
        } catch(_){}
        py.globals.set("__mn_online_requirements_json", JSON.stringify(online.map(String)));
        try {
          await py.runPythonAsync(
            "import json as __mn_json, micropip as __mn_micropip\n" +
            "await __mn_micropip.install(__mn_json.loads(__mn_online_requirements_json))"
          );
        } finally {
          try { py.globals.delete("__mn_online_requirements_json"); } catch(_){}
          if (indexPatched){ try { py._api.config.indexURL = prevIndexURL; } catch(_){} }
        }
      }
    } catch(error){
      const detail = (error && error.message) ? error.message : String(error);
      throw new Error(
        "패키지를 설치하지 못했어요 (" + labels.join(", ") + "). " +
        "인터넷 연결을 확인해 주세요. 바이너리 확장 패키지는 브라우저 Python(Pyodide)에서 지원되지 않을 수 있으며, " +
        "그 경우 일반 .py 실행에서 로컬 Python을 사용해 주세요.\n원인: " + detail
      );
    }
    self.postMessage({ type:"packages-loaded", id, names:data.packageCacheNames || [] });
  };
  const runTask = async (data) => {
    const id = data.id;
    const stdout = makeOutputCollector(), stderr = makeOutputCollector();
    let outputs = [], variables = [], images = [];
    let root = null, baseDir = "/home/pyodide", snapshot = new Map();
    const bundle = data.bundle || null;
    try {
      py.setStdout({ batched:(text) => { stdout.append(text + "\n"); } });
      py.setStderr({ batched:(text) => { stderr.append(text + "\n"); } });
      await installTaskPackages(data, id);
      py.globals.set("__run_stdin", data.stdin || "");
      if (bundle){
        root = "/runproj_" + id + "_" + Date.now();
        py.FS.mkdirTree(root);
        for (const dir of bundle.dirs || []){
          const path = safeRel(dir);
          if (path) py.FS.mkdirTree(root + "/" + path);
        }
        for (const file of bundle.files || []){
          const path = safeRel(file.path);
          const full = root + "/" + path;
          const slash = full.lastIndexOf("/");
          if (slash > 0) py.FS.mkdirTree(full.slice(0, slash));
          py.FS.writeFile(full, file.bytes);
        }
        snapshot = snapshotFs(root);
        const target = safeRel(bundle.target);
        const targetFull = root + "/" + target;
        const targetSlash = target.lastIndexOf("/");
        const scriptDir = targetSlash >= 0 ? root + "/" + target.slice(0, targetSlash) : root;
        const runDir = bundle.cwd ? root + "/" + safeRel(bundle.cwd) : scriptDir;
        py.globals.set("__run_dir", runDir);
        py.globals.set("__run_root", root);
        py.globals.set("__run_file", targetFull);
        self.postMessage({ type:"progress", id, message:"실행 중… (브라우저 Worker · 폴더 포함)" });
        if (kfontCall){ try { await py.runPythonAsync(kfontCall); } catch(_){} }   // 한글 폰트 등록(matplotlib 있을 때만)
        try {
          await py.runPythonAsync(
            "import os, sys, runpy, io\n" +
            "for __name, __mod in list(sys.modules.items()):\n" +
            "    __file = getattr(__mod, '__file__', '')\n" +
            "    if isinstance(__file, str) and __file.startswith('/runproj_'):\n" +
            "        sys.modules.pop(__name, None)\n" +
            "sys.path[:] = [__p for __p in sys.path if not str(__p).startswith('/runproj_')]\n" +
            "os.chdir(__run_dir)\n" +
            "__paths = [os.path.dirname(__run_file)]\n" +
            "__cur = __run_dir\n" +
            "while __cur:\n" +
            "    if __cur not in __paths:\n" +
            "        __paths.append(__cur)\n" +
            "    if os.path.abspath(__cur) == os.path.abspath(__run_root):\n" +
            "        break\n" +
            "    __next = os.path.dirname(__cur)\n" +
            "    if __next == __cur:\n" +
            "        break\n" +
            "    __cur = __next\n" +
            "for __p in reversed(__paths):\n" +
            "    if __p not in sys.path:\n" +
            "        sys.path.insert(0, __p)\n" +
            "sys.stdin = io.StringIO(__run_stdin)\n" +
            "__run_vars = runpy.run_path(__run_file, run_name='__main__')\n"
          );
        } catch(error){ stderr.append(((error && error.message) ? error.message : String(error)) + "\n"); }
        variables = await captureVariables("__run_vars", false);
        outputs = collectOutputs(root, snapshot);
      } else {
        try { baseDir = String(py.runPython("import os; os.chdir('/home/pyodide'); os.getcwd()")) || baseDir; } catch(_){}
        snapshot = snapshotFs(baseDir);
        await py.runPythonAsync("import sys, io\nsys.stdin = io.StringIO(__run_stdin)");
        self.postMessage({ type:"progress", id, message:"실행 중… (브라우저 Worker)" });
        if (kfontCall){ try { await py.runPythonAsync(kfontCall); } catch(_){} }   // 한글 폰트 등록(matplotlib 있을 때만)
        try { await py.runPythonAsync(data.source || ""); }
        catch(error){ stderr.append(((error && error.message) ? error.message : String(error)) + "\n"); }
        variables = await captureVariables(null, true);
        outputs = collectOutputs(baseDir, snapshot);
        for (const output of outputs){ try { py.FS.unlink(baseDir + "/" + output.name); } catch(_){} }
      }
      images = await capturePlots();
      const transfers = outputs.map(output => output.bytes && output.bytes.buffer).filter(Boolean);
      self.postMessage({
        type:"result", id,
        result:{ stdout:stdout.value(), stderr:stderr.value(), code:stderr.value() ? 1 : 0, images, outputs, variables }
      }, transfers);
    } catch(error){
      self.postMessage({ type:"task-error", id, message:(error && error.message) ? error.message : String(error) });
    } finally {
      try { py.setStdout({}); py.setStderr({}); } catch(_){}
      try { py.runPython("import os, sys\nos.chdir('/home/pyodide')\nsys.stdin = sys.__stdin__"); } catch(_){}
      try {
        py.globals.delete("__run_stdin"); py.globals.delete("__run_dir");
        py.globals.delete("__run_root"); py.globals.delete("__run_file"); py.globals.delete("__run_vars");
      } catch(_){}
      if (root){ try { py.runPython("import shutil; shutil.rmtree(" + JSON.stringify(root) + ", ignore_errors=True)"); } catch(_){} }
    }
  };
  // 노트북 커널: 일반 실행(type:"run")과 달리 전역을 지우지 않고 문서별 전용 네임스페이스(__mn_kernels[kid])에
  // 상태를 누적한다. 같은 py 인스턴스를 쓰지만 일반 실행은 globals()를 매번 비우므로 서로 새지 않는다.
  const kernelTask = async (data) => {
    const id = data.id;
    const kid = String(data.kernelId || "default");
    if (data.reset){
      removeKernelWorkspace(kid);
      try { py.runPython("globals().setdefault('__mn_kernels', {}).pop(" + JSON.stringify(kid) + ", None)"); } catch(_){}
      self.postMessage({ type:"result", id, result:{ ok:true, stdout:"", stderr:"", code:0, images:[], outputs:[], variables:[], richOutputs:[], reset:true } });
      return;
    }
    const stdout = makeOutputCollector(), stderr = makeOutputCollector();
    let variables = [], images = [], outputs = [], richOutputs = [];
    let baseDir = "/home/pyodide", outputRoot = baseDir, snapshot = new Map();
    try {
      py.setStdout({ batched:(text) => { stdout.append(text + "\n"); } });
      py.setStderr({ batched:(text) => { stderr.append(text + "\n"); } });
      await installTaskPackages(data, id);
      const workspace = ensureKernelWorkspace(kid, data.workspaceBundle || null);
      if (workspace){
        const workspaceSynced = syncKernelWorkspace(workspace, data.workspaceSync || null);
        const requestedCwd = data.workspaceCwd ? safeRel(data.workspaceCwd) : "";
        const requestedDir = requestedCwd ? workspace.root + "/" + requestedCwd : workspace.runDir;
        if (requestedDir !== workspace.runDir){
          py.FS.mkdirTree(requestedDir);
          workspace.runDir = requestedDir;
        }
        baseDir = workspace.runDir;
        outputRoot = workspace.root;
        snapshot = workspaceSynced
          ? snapshotFs(outputRoot)
          : (workspace.snapshots.get(outputRoot) || snapshotFs(outputRoot));
        if (workspaceSynced) workspace.snapshots.set(outputRoot, snapshot);
        py.globals.set("__k_run_dir", baseDir);
        py.globals.set("__k_run_root", workspace.root);
        await py.runPythonAsync(
          "import os as __k_os, sys as __k_sys\n" +
          "__k_os.chdir(__k_run_dir)\n" +
          "for __k_path in (__k_run_root, __k_run_dir):\n" +
          "    if __k_path not in __k_sys.path:\n" +
          "        __k_sys.path.insert(0, __k_path)"
        );
      } else {
        try { baseDir = String(py.runPython("import os; os.chdir('/home/pyodide'); os.getcwd()")) || baseDir; } catch(_){}
        outputRoot = baseDir;
        snapshot = snapshotFs(outputRoot);
      }
      py.globals.set("__k_src", data.source || "");
      py.globals.set("__k_stdin", data.stdin || "");
      py.globals.set("__k_id", kid);
      self.postMessage({ type:"progress", id, message:"셀 실행 중… (브라우저 커널)" });
      if (kfontCall){ try { await py.runPythonAsync(kfontCall); } catch(_){} }   // 한글 폰트 등록(matplotlib 있을 때만)
      await py.runPythonAsync(
        "import sys as __k_sys, io as __k_io, traceback as __k_tb, json as __k_json, base64 as __k_base64\n" +
        "globals()['__k_rich_outputs'] = []\n" +
        "__k_mime_keys = {'text/html','text/plain','text/latex','image/svg+xml','image/png','image/jpeg','audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm','video/mp4','video/webm','video/ogg','application/json','application/javascript'}\n" +
        "def __k_json_default(__k_v):\n" +
        "    __k_fn = getattr(__k_v, 'tolist', None)\n" +
        "    if callable(__k_fn):\n" +
        "        try: return __k_fn()\n" +
        "        except BaseException: pass\n" +
        "    __k_fn = getattr(__k_v, 'isoformat', None)\n" +
        "    if callable(__k_fn):\n" +
        "        try: return __k_fn()\n" +
        "        except BaseException: pass\n" +
        "    return str(__k_v)\n" +
        "def __k_mime_value(__k_key, __k_value):\n" +
        "    if __k_value is None or (__k_key not in __k_mime_keys and not (__k_key.startswith('application/vnd.') and __k_key.endswith('+json'))): return None\n" +
        "    if isinstance(__k_value, tuple): __k_value = __k_value[0] if __k_value else None\n" +
        "    if __k_value is None: return None\n" +
        "    if __k_key.startswith(('image/','audio/','video/')) and __k_key != 'image/svg+xml':\n" +
        "        if isinstance(__k_value, (bytes, bytearray, memoryview)):\n" +
        "            __k_raw = bytes(__k_value)\n" +
        "            return __k_base64.b64encode(__k_raw).decode('ascii') if len(__k_raw) <= 3145728 else None\n" +
        "        __k_text = str(__k_value)\n" +
        "        return __k_text if len(__k_text) <= 5242880 else None\n" +
        "    if __k_key == 'application/json' or __k_key.endswith('+json'):\n" +
        "        try:\n" +
        "            __k_encoded = __k_json.dumps(__k_value, ensure_ascii=False, separators=(',',':'), default=__k_json_default)\n" +
        "            return __k_json.loads(__k_encoded) if len(__k_encoded) <= 5242880 else None\n" +
        "        except BaseException: return None\n" +
        "    __k_text = str(__k_value)\n" +
        "    return __k_text if len(__k_text) <= 5242880 else None\n" +
        "def __k_mime_data(__k_o):\n" +
        "    __k_data = {}\n" +
        "    try:\n" +
        "        __k_bundle_fn = getattr(__k_o, '_repr_mimebundle_', None)\n" +
        "        if callable(__k_bundle_fn):\n" +
        "            __k_bundle = __k_bundle_fn()\n" +
        "            if isinstance(__k_bundle, tuple): __k_bundle = __k_bundle[0] if __k_bundle else {}\n" +
        "            if isinstance(__k_bundle, dict):\n" +
        "                for __k_key, __k_raw in __k_bundle.items():\n" +
        "                    __k_key = str(__k_key); __k_normal = __k_mime_value(__k_key, __k_raw)\n" +
        "                    if __k_normal is not None: __k_data[__k_key] = __k_normal\n" +
        "    except BaseException: pass\n" +
        "    for __k_key, __k_method_name in (('text/html','_repr_html_'),('image/svg+xml','_repr_svg_'),('image/png','_repr_png_'),('image/jpeg','_repr_jpeg_'),('text/latex','_repr_latex_'),('application/json','_repr_json_')):\n" +
        "        if __k_key in __k_data: continue\n" +
        "        try:\n" +
        "            __k_method = getattr(__k_o, __k_method_name, None)\n" +
        "            if callable(__k_method):\n" +
        "                __k_normal = __k_mime_value(__k_key, __k_method())\n" +
        "                if __k_normal is not None: __k_data[__k_key] = __k_normal\n" +
        "        except BaseException: pass\n" +
        "    __k_bokeh_model = False; __k_bokeh_error = None\n" +
        "    try:\n" +
        "        import bokeh as __k_bokeh\n" +
        "        from bokeh.model import Model as __k_bokeh_model_type\n" +
        "        __k_bokeh_model = isinstance(__k_o, __k_bokeh_model_type)\n" +
        "        if __k_bokeh_model:\n" +
        "            from bokeh.embed import json_item as __k_bokeh_item\n" +
        "            __k_bokeh_payload = {'item': __k_bokeh_item(__k_o, 'bokeh'), 'version': str(__k_bokeh.__version__)}\n" +
        "            __k_normal = __k_mime_value('application/vnd.bokehjs_exec.v0+json', __k_bokeh_payload)\n" +
        "            if __k_normal is not None: __k_data['application/vnd.bokehjs_exec.v0+json'] = __k_normal\n" +
        "    except BaseException as __k_ex: __k_bokeh_error = type(__k_ex).__name__ + ': ' + str(__k_ex)\n" +
        "    if __k_bokeh_model and 'application/vnd.bokehjs_exec.v0+json' not in __k_data:\n" +
        "        try:\n" +
        "            from bokeh.embed import file_html as __k_bokeh_html\n" +
        "            from bokeh.resources import CDN as __k_bokeh_cdn\n" +
        "            __k_html = __k_bokeh_html(__k_o, __k_bokeh_cdn, 'Bokeh chart')\n" +
        "            if len(__k_html) <= 5242880: __k_data['text/html'] = __k_html\n" +
        "        except BaseException as __k_ex:\n" +
        "            if __k_bokeh_error is None: __k_bokeh_error = type(__k_ex).__name__ + ': ' + str(__k_ex)\n" +
        "    try:\n" +
        "        __k_plain = repr(__k_o)\n" +
        "    except Exception:\n" +
        "        try:\n" +
        "            __k_plain = str(__k_o)\n" +
        "        except Exception:\n" +
        "            __k_plain = '<표시할 수 없는 값>'\n" +
        "    if len(__k_plain) > 1048576: __k_plain = __k_plain[:1048576] + '\\n…(출력 생략)'\n" +
        "    if __k_bokeh_model and 'application/vnd.bokehjs_exec.v0+json' not in __k_data and 'text/html' not in __k_data and __k_bokeh_error:\n" +
        "        __k_plain += '\\n[Bokeh 출력 변환 오류] ' + __k_bokeh_error\n" +
        "    if 'text/plain' not in __k_data: __k_data['text/plain'] = __k_plain\n" +
        "    return __k_data\n" +
        "def __k_publish(__k_o, __k_output_type='display_data'):\n" +
        "    if __k_o is not None:\n" +
        "        globals()['__k_rich_outputs'].append({'output_type': __k_output_type, 'data': __k_mime_data(__k_o), 'metadata': {}})\n" +
        "def __k_display(*__k_objs, **__k_kw):\n" +
        "    for __k_o in __k_objs:\n" +
        "        __k_publish(__k_o, 'display_data')\n" +
        "__mn = globals().setdefault('__mn_kernels', {})\n" +
        "__k_ns = __mn.get(__k_id)\n" +
        "if __k_ns is None:\n" +
        "    __k_ns = {'__name__': '__main__'}\n" +
        "    __mn[__k_id] = __k_ns\n" +
        // 주피터/IPython 호환: display()와 셀 마지막 값을 HTML/text MIME 묶음으로 수집한다.
        "if __k_ns.get('display') is None or getattr(__k_ns.get('display'), '__name__', '') == '__k_display':\n" +
        "    __k_ns['display'] = __k_display\n" +
        "__k_sys.stdin = __k_io.StringIO(__k_stdin)\n" +
        "__k_failed = False\n" +
        "try:\n" +
        // 주피터처럼 셀의 '마지막 식'은 값을 자동 표시(Out). 대입·일반문은 그대로 실행.
        "    __k_ast = __import__('ast')\n" +
        "    __k_tree = __k_ast.parse(__k_src, '<셀>', 'exec')\n" +
        "    if __k_tree.body and isinstance(__k_tree.body[-1], __k_ast.Expr):\n" +
        "        __k_last = __k_tree.body.pop()\n" +
        "        exec(compile(__k_tree, '<셀>', 'exec'), __k_ns)\n" +
        "        __k_val = eval(compile(__k_ast.Expression(__k_last.value), '<셀>', 'eval'), __k_ns)\n" +
        "        if __k_val is not None:\n" +
        "            __k_publish(__k_val, 'execute_result')\n" +
        "    else:\n" +
        "        exec(compile(__k_tree, '<셀>', 'exec'), __k_ns)\n" +
        "except SystemExit as __k_ex:\n" +
        "    __k_failed = True\n" +
        "    __k_sys.stderr.write(''.join(__k_tb.format_exception(type(__k_ex), __k_ex, __k_ex.__traceback__)))\n" +
        "except BaseException as __k_ex:\n" +
        "    __k_sys.stderr.write(''.join(__k_tb.format_exception(type(__k_ex), __k_ex, __k_ex.__traceback__.tb_next)))\n" +
        "    __k_failed = True\n" +
        "finally:\n" +
        "    globals()['__k_cur'] = __k_ns\n" +
        "    globals()['__k_failed_out'] = __k_failed\n"
      );
      const failed = !!py.runPython("bool(globals().get('__k_failed_out', False))");
      try {
        richOutputs = JSON.parse(String(py.runPython(
          "__k_json.dumps(globals().get('__k_rich_outputs', []), ensure_ascii=False)"
        )));
      } catch(_){ richOutputs = []; }
      variables = await captureVariables("__k_cur", false, {
        maxItems:0,
        metadataOnly:true
      });
      outputs = collectOutputs(outputRoot, snapshot); // 프로젝트 루트 전체에서 새·변경 파일을 찾아 ../ 출력도 포함한다
      if (workspace) workspace.snapshots.set(outputRoot, snapshotFs(outputRoot));
      images = await capturePlots();
      const transfers = outputs.map(output => output.bytes && output.bytes.buffer).filter(Boolean);
      self.postMessage({
        type:"result", id,
        result:{ ok:!failed, stdout:stdout.value(), stderr:stderr.value(), code:failed ? 1 : 0, images, outputs, variables, richOutputs }
      }, transfers);
    } catch(error){
      self.postMessage({ type:"task-error", id, message:(error && error.message) ? error.message : String(error) });
    } finally {
      try { py.setStdout({}); py.setStderr({}); } catch(_){}
      try {
        py.globals.delete("__k_src"); py.globals.delete("__k_stdin");
        py.globals.delete("__k_id"); py.globals.delete("__k_cur");
        py.globals.delete("__k_failed_out");
        py.globals.delete("__k_rich_outputs");
        py.globals.delete("__k_run_dir"); py.globals.delete("__k_run_root");
      } catch(_){}
    }
  };
  self.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "init"){
      (async () => {
        try {
          self.postMessage({ type:"progress", message:"브라우저 Python Worker 준비 중…" });
          importScripts(data.base + "pyodide.js");
          py = await loadPyodide({ indexURL:data.base });
          // matplotlib 은 Pyodide 에서 기본으로 브라우저 캔버스용 wasm_backend 를 고르는데,
          // 그 백엔드가 'from js import document' 를 시도하다 ImportError 로 죽는다.
          // 그림은 savefig 로 캡처하므로 비대화형 Agg 백엔드로 고정한다(최초 import 전에 설정).
          try { py.runPython("import os; os.environ['MPLBACKEND']='Agg'"); } catch(_){}
          // 번들된 한글 폰트를 /fonts 에 풀고 등록 헬퍼를 정의한다(메인스레드가 init 으로 폰트·코드 전달).
          pkgCdnBase = data.cdnBase || "";
          kfontCall = data.kfontCall || "";
          if (data.kfontInitPy){
            try {
              py.globals.set("__MN_KFONT_GZ", data.kfontGz || "");
              py.runPython(data.kfontInitPy);
              py.globals.delete("__MN_KFONT_GZ");
            } catch(_){}
          }
          self.postMessage({ type:"ready" });
        } catch(error){
          self.postMessage({ type:"init-error", message:(error && error.message) ? error.message : String(error) });
        }
      })();
    } else if (data.type === "run"){
      runQueue = runQueue.then(() => runTask(data), () => runTask(data));
    } else if (data.type === "kernel-run"){
      runQueue = runQueue.then(() => kernelTask(data), () => kernelTask(data));
    } else if (data.type === "kernel-variable"){
      runQueue = runQueue.then(() => kernelVariableTask(data), () => kernelVariableTask(data));
    }
  };
}

function disposePyodideWorker(error){
  const err = error || pyWorkerError("브라우저 Python Worker가 종료되었습니다.", "worker-crash");
  const worker = _pyWorker;
  _pyWorker = null;
  _pyWorkerReadyPromise = null;
  if (worker){ try { worker.terminate(); } catch(_){} }
  if (_pyWorkerReadyReject){ try { _pyWorkerReadyReject(err); } catch(_){} }
  _pyWorkerReadyResolve = null;
  _pyWorkerReadyReject = null;
  _pyWorkerLoadedPackages.clear();
  _pyWorkerKernelWorkspaces.clear();
  for (const job of _pyWorkerJobs.values()){
    clearTimeout(job.timer);
    try { job.reject(err); } catch(_){}
  }
  _pyWorkerJobs.clear();
}

// ── 브라우저 파이썬(Pyodide) 미리 준비 ─────────────────────────────
// 초급자가 첫 코드에서 ▶를 눌렀을 때 30초~1분간 "멈춘 듯한" 대기를 겪지 않도록,
// 파이썬 파일·노트북을 여는 순간(실행 전) 백그라운드로 런타임을 미리 데운다.
// 로컬 파이썬이 있으면 대화형 즉시 실행이라 프리로드가 필요 없어 건너뛴다.
let _pyPrewarmStarted = false;
let _pyReadyFadeTimer = 0;
function setPyReadyPill(state, msg){
  const pill = document.getElementById("pyReadyStatus");
  if (!pill) return;
  pill.hidden = false;
  pill.classList.remove("is-preparing", "is-ready", "is-failed");
  pill.classList.add(state === "ready" ? "is-ready" : state === "failed" ? "is-failed" : "is-preparing");
  const text = document.getElementById("pyReadyText");
  if (text) text.textContent = msg || "";
}
function fadePyReadyPill(delay){
  clearTimeout(_pyReadyFadeTimer);
  _pyReadyFadeTimer = setTimeout(() => { const p = document.getElementById("pyReadyStatus"); if (p) p.hidden = true; }, delay || 4000);
}
async function prewarmBrowserPython(){
  if (_pyPrewarmStarted) return;
  _pyPrewarmStarted = true;
  try { if (await pythonBackendAvailable()) return; } catch(_){}   // 로컬 파이썬이면 프리로드 불필요
  if (typeof Worker === "undefined"){ _pyPrewarmStarted = false; return; }
  if (_pyWorkerReadyPromise){ setPyReadyPill("ready", "파이썬 준비 완료 ✓"); fadePyReadyPill(); return; }
  setPyReadyPill("preparing", "파이썬 준비 중… (처음 한 번, 약 30초)");
  try {
    await ensurePyodideWorker();
    setPyReadyPill("ready", "파이썬 준비 완료 ✓");
    fadePyReadyPill();
  } catch(e){
    setPyReadyPill("failed", "파이썬 준비 실패 · 인터넷 연결 후 다시 시도돼요");
    _pyPrewarmStarted = false;                     // 다음에 다시 시도할 수 있게
    fadePyReadyPill(6000);
  }
}

async function ensurePyodideWorker(onMsg){
  if (_pyWorkerReadyPromise){
    _pyWorkerInitOnMsg = onMsg || _pyWorkerInitOnMsg;
    return _pyWorkerReadyPromise;
  }
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined")
    throw pyWorkerError("이 브라우저는 Python Worker를 지원하지 않습니다.", "worker-unavailable");
  const source = "(" + pyodideWorkerMain.toString() + ")();";
  let worker;
  try {
    const url = URL.createObjectURL(new Blob([source], { type:"text/javascript" }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch(error){
    throw pyWorkerError("Python Worker를 만들지 못했습니다: " + ((error && error.message) || error), "worker-init");
  }
  _pyWorker = worker;
  _pyWorkerInitOnMsg = onMsg || null;
  _pyWorkerReadyPromise = new Promise((resolve, reject) => {
    _pyWorkerReadyResolve = resolve;
    _pyWorkerReadyReject = reject;
  });
  const readyPromise = _pyWorkerReadyPromise;
  worker.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "ready"){
      const resolve = _pyWorkerReadyResolve;
      _pyWorkerReadyResolve = null; _pyWorkerReadyReject = null;
      if (resolve) resolve(worker);
      return;
    }
    if (data.type === "init-error"){
      disposePyodideWorker(pyWorkerError("브라우저 Python Worker를 준비하지 못했습니다: " + (data.message || ""), "worker-init"));
      return;
    }
    if (data.type === "progress"){
      const job = _pyWorkerJobs.get(data.id);
      if (job && !job.timer){
        job.timer = setTimeout(() => {
          disposePyodideWorker(pyWorkerError("브라우저 Python 실행 시간이 5분을 넘어 중지했습니다.", "worker-timeout"));
        }, PYODIDE_WORKER_TIMEOUT);
      }
      if (job && job.onMsg) job.onMsg(data.message || "");
      else if (_pyWorkerInitOnMsg) _pyWorkerInitOnMsg(data.message || "");
      return;
    }
    if (data.type === "packages-loaded"){
      for (const name of data.names || []) _pyWorkerLoadedPackages.add(name);
      return;
    }
    const job = _pyWorkerJobs.get(data.id);
    if (!job) return;
    clearTimeout(job.timer);
    _pyWorkerJobs.delete(data.id);
    if (data.type === "result"){
      if (job.kernelWorkspaceId) _pyWorkerKernelWorkspaces.add(job.kernelWorkspaceId);
      job.resolve(data.result);
    }
    else if (data.type === "task-error") job.reject(pyWorkerError(data.message || "Worker 실행 오류", "worker-task"));
  };
  worker.onerror = (event) => {
    const initializing = !!_pyWorkerReadyResolve;
    disposePyodideWorker(pyWorkerError(
      (initializing ? "브라우저 Python Worker 초기화 오류: " : "브라우저 Python Worker 오류: ") + (event.message || "알 수 없는 오류"),
      initializing ? "worker-init" : "worker-crash"
    ));
  };
  try {
    const selected = await resolvePyodideBase();
    const absoluteBase = new URL(selected.base, location.href).href;
    const cdnBase = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VER + "/full/";
    worker.postMessage({ type:"init", base:absoluteBase, cdnBase, kfontGz:koreanFontGzB64(), kfontInitPy:KFONT_INIT_PY, kfontCall:KFONT_SETUP_CALL });
  } catch(error){
    disposePyodideWorker(pyWorkerError("Python 런타임 위치를 확인하지 못했습니다.", "worker-init"));
  }
  return readyPromise;
}

const PYODIDE_STDLIB_IMPORTS = new Set((
  "__future__ _thread abc argparse array ast asyncio base64 bdb binascii bisect builtins bz2 calendar " +
  "cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser " +
  "contextlib contextvars copy copyreg csv ctypes curses dataclasses datetime dbm decimal difflib dis doctest " +
  "email encodings ensurepip enum errno faulthandler filecmp fileinput fnmatch fractions ftplib functools gc " +
  "genericpath getopt getpass gettext glob graphlib gzip hashlib heapq hmac html http imaplib importlib inspect " +
  "io ipaddress itertools json keyword linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap " +
  "modulefinder multiprocessing netrc nntplib numbers operator optparse os pathlib pdb pickle pickletools pipes " +
  "pkgutil platform plistlib poplib posixpath pprint profile pstats pty py_compile pyclbr pydoc queue quopri " +
  "random re reprlib resource rlcompleter runpy sched secrets selectors shelve shlex shutil signal site smtplib " +
  "socket socketserver sqlite3 ssl stat statistics string stringprep struct subprocess sunau symtable sys " +
  "sysconfig tabnanny tarfile telnetlib tempfile textwrap threading time timeit tkinter token tokenize tomllib " +
  "trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uuid venv warnings " +
  "wave weakref webbrowser wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo"
).split(/\s+/));

const PYODIDE_PYPI_ALIASES = Object.freeze({
  bs4:"beautifulsoup4",
  cv2:"opencv-python",
  Crypto:"pycryptodome",
  dateutil:"python-dateutil",
  faker:"Faker",
  PIL:"Pillow",
  sklearn:"scikit-learn",
  yaml:"PyYAML"
});

function bundledPyodideWheelRegistry(){
  const registry = (typeof globalThis !== "undefined") ? globalThis.__MN_PYODIDE_WHEELS__ : null;
  return registry && typeof registry === "object" ? registry : {};
}

function decodeBundledPyodideWheel(entry){
  const binary = atob(String(entry && entry.base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pyodidePackageLabel(names){
  return names.length <= 4
    ? names.join(", ")
    : (names.slice(0, 4).join(", ") + " 외 " + (names.length - 4) + "개");
}

async function preparePyodideWorkerPackages(code, onMsg, excludedImports){
  const excluded = excludedImports instanceof Set ? excludedImports : new Set(excludedImports || []);
  const imports = pyodideImportsWithRuntimeNeeds(code, targetImportedTopNames(code))
    .filter(name => !excluded.has(name));
  const empty = { urls:[], wheels:[], online:[], names:[], labels:[] };
  if (!imports.length) return empty;

  const lockMap = await loadPyodideLockMap();
  const loadedPackages = {};
  for (const name of _pyWorkerLoadedPackages) loadedPackages[name] = true;
  const requestedNeed = lockMap ? resolveNeededPackages(imports, lockMap, { loadedPackages }) : [];
  let need = requestedNeed.slice();
  const officialImportNames = new Set(
    lockMap ? imports.filter(name => lockMap.byImport.has(name)) : []
  );
  const officialNames = requestedNeed.map(pkg => pkg.name);
  const baseCdn = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VER + "/full/";

  const wheelRegistry = bundledPyodideWheelRegistry();
  const wheels = [];
  const bundledImports = new Set();
  for (const importName of imports){
    const entry = wheelRegistry[importName];
    if (!entry) continue;
    bundledImports.add(importName);
    const packageName = String(entry.packageName || importName);
    if (_pyWorkerLoadedPackages.has(importName) || _pyWorkerLoadedPackages.has(packageName)) continue;
    wheels.push({
      importName,
      packageName,
      fileName:String(entry.fileName || (packageName + ".whl")),
      bytes:decodeBundledPyodideWheel(entry)
    });
  }

  const online = [];
  const onlineImports = [];
  for (const importName of imports){
    if (PYODIDE_STDLIB_IMPORTS.has(importName) ||
        officialImportNames.has(importName) ||
        bundledImports.has(importName)) continue;
    const packageName = PYODIDE_PYPI_ALIASES[importName] || importName;
    if (_pyWorkerLoadedPackages.has(importName) || _pyWorkerLoadedPackages.has(packageName)) continue;
    if (!online.includes(packageName)) online.push(packageName);
    onlineImports.push(importName);
  }
  if (online.length && lockMap){
    const installerNeed = resolveNeededPackages(["micropip"], lockMap, { loadedPackages });
    const allNeed = new Map(need.map(pkg => [pkg.name, pkg]));
    for (const pkg of installerNeed) allNeed.set(pkg.name, pkg);
    need = Array.from(allNeed.values());
  }

  const externalNames = Array.from(new Set(officialNames.concat(online)));
  const labels = Array.from(new Set(
    officialNames.concat(wheels.map(wheel => wheel.packageName), online)
  ));
  if (externalNames.length) await ensurePkgConsent(externalNames, pyodidePackageLabel(externalNames));
  if (labels.length){
    onMsg && onMsg(
      (externalNames.length ? "패키지 준비 중… (" : "내장 패키지 준비 중… (") +
      pyodidePackageLabel(labels) + ")"
    );
  }

  const names = Array.from(new Set(
    need.map(pkg => pkg.name)
      .concat(wheels.flatMap(wheel => [wheel.importName, wheel.packageName]))
      .concat(online)
      .concat(onlineImports)
  ));
  // .whl 은 절대 URL 로 넘겨도 되지만, openblas 같은 shared_library(.zip)는 URL 로 못 넘기므로
  // 이름으로 분리한다(워커에서 indexURL 을 CDN 으로 돌려 이름으로 로드).
  const wheelNeed = need.filter(pkg => /\.whl$/i.test(String(pkg.file_name || "")));
  const libNeed = need.filter(pkg => !/\.whl$/i.test(String(pkg.file_name || "")));
  return {
    urls:wheelNeed.map(pkg => baseCdn + pkg.file_name),
    libNames:libNeed.map(pkg => pkg.name),
    wheels,
    online,
    names,
    labels
  };
}

function pyodideWorkerPackageSource(bundle, packageSource, source){
  if (!bundle) return packageSource == null ? source : packageSource;
  const decoder = new TextDecoder();
  let all = "";
  for (const file of bundle.files || []){
    if (/\.py$/i.test(file.path || "")){ try { all += decoder.decode(file.bytes) + "\n"; } catch(_){} }
  }
  return all + "\n" + (packageSource || "");
}

function startPyodideWorkerRun(source, bundle, stdin, packages, onMsg){
  const id = ++_pyWorkerSeq;
  let cancelled = false, registered = false, rejectOuter = null;
  const promise = new Promise((resolve, reject) => {
    rejectOuter = reject;
    (async () => {
      try {
        const worker = await ensurePyodideWorker(onMsg);
        if (cancelled) return;
        _pyWorkerJobs.set(id, { resolve, reject, onMsg, timer:0 });
        registered = true;
        worker.postMessage({
          type:"run", id, source, bundle, stdin:stdin || "",
          packageUrls:(packages && packages.urls) || [],
          packageLibNames:(packages && packages.libNames) || [],
          packageWheels:(packages && packages.wheels) || [],
          onlinePackages:(packages && packages.online) || [],
          packageNames:(packages && packages.labels) || [],
          packageCacheNames:(packages && packages.names) || []
        });
      } catch(error){ reject(error); }
    })();
  });
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      const error = pyWorkerError("브라우저 Python 실행을 중지했습니다.", "worker-cancel");
      if (registered) disposePyodideWorker(error);
      else if (rejectOuter) rejectOuter(error);
    }
  };
}

// 노트북 커널 실행/초기화. 같은 워커를 쓰되 type:"kernel-run"으로 보내 전용 네임스페이스에 상태를 누적한다.
// opts: { kernelId, source, stdin, packages, workspaceBundle, workspaceSync, workspaceCwd, onMsg, reset }
function startPyodideKernelRun(opts){
  opts = opts || {};
  const id = ++_pyWorkerSeq;
  const kernelId = String(opts.kernelId || "default");
  if (opts.reset) _pyWorkerKernelWorkspaces.delete(kernelId);
  const workspaceBundle = opts.workspaceBundle && !_pyWorkerKernelWorkspaces.has(kernelId)
    ? opts.workspaceBundle
    : null;
  let cancelled = false, registered = false, rejectOuter = null;
  const promise = new Promise((resolve, reject) => {
    rejectOuter = reject;
    (async () => {
      try {
        const worker = await ensurePyodideWorker(opts.onMsg);
        if (cancelled) return;
        _pyWorkerJobs.set(id, {
          resolve,
          reject,
          onMsg:opts.onMsg,
          timer:0,
          kernelWorkspaceId:workspaceBundle ? kernelId : null
        });
        registered = true;
        worker.postMessage({
          type:"kernel-run", id,
          kernelId,
          source:opts.source || "",
          stdin:opts.stdin || "",
          reset:!!opts.reset,
          workspaceBundle,
          workspaceSync:opts.workspaceSync || null,
          workspaceCwd:normalizedRunPath(opts.workspaceCwd || ""),
          packageUrls:(opts.packages && opts.packages.urls) || [],
          packageLibNames:(opts.packages && opts.packages.libNames) || [],
          packageWheels:(opts.packages && opts.packages.wheels) || [],
          onlinePackages:(opts.packages && opts.packages.online) || [],
          packageNames:(opts.packages && opts.packages.labels) || [],
          packageCacheNames:(opts.packages && opts.packages.names) || []
        });
      } catch(error){ reject(error); }
    })();
  });
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      const error = pyWorkerError("브라우저 커널 실행을 중지했습니다.", "worker-cancel");
      if (registered) disposePyodideWorker(error);
      else if (rejectOuter) rejectOuter(error);
    }
  };
}

// 노트북 변수 목록에서 하나를 펼칠 때 현재 커널의 값만 지연 조회한다.
function startPyodideKernelVariableLookup(opts){
  opts = opts || {};
  const id = ++_pyWorkerSeq;
  const kernelId = String(opts.kernelId || "default");
  const variableName = String(opts.variableName || "");
  const promise = new Promise((resolve, reject) => {
    (async () => {
      try {
        const worker = await ensurePyodideWorker(opts.onMsg);
        _pyWorkerJobs.set(id, { resolve, reject, onMsg:opts.onMsg, timer:0 });
        worker.postMessage({
          type:"kernel-variable",
          id,
          kernelId,
          variableName
        });
      } catch(error){ reject(error); }
    })();
  });
  return { promise };
}

async function runPythonViaPyodide(src, onMsg, stdin, packageSource){
  let py;
  try { py = await ensurePyodide(onMsg); }
  catch(e){ throw new Error("브라우저 파이썬 런타임을 불러오지 못했어요. 인터넷 연결이 필요합니다(또는 manneung-classroom.exe + 로컬 파이썬으로 실행)."); }
  const out = createPythonOutputCollector(), err = createPythonOutputCollector();
  let outputs = [], variables = [], snap = null, baseDir = "/home/pyodide";
  try { baseDir = String(py.runPython("import os; os.getcwd()")) || baseDir; } catch(_){}
  py.setStdout({ batched: (s) => { out.append(s + "\n"); } });
  py.setStderr({ batched: (s) => { err.append(s + "\n"); } });
  try {
    py.globals.set("__run_stdin", stdin || "");
    await py.runPythonAsync("import sys, io\nsys.stdin = io.StringIO(__run_stdin)");
    await preloadPyodidePackages(py, packageSource == null ? src : packageSource, onMsg);
    try { await py.runPythonAsync(KFONT_SETUP_CALL); } catch(_){}   // 한글 폰트 등록(matplotlib 있을 때만)
    snap = pyFsSnapshot(py, baseDir);                  // 실행 전 작업폴더 스냅샷
    onMsg && onMsg("실행 중… (브라우저)");
    await py.runPythonAsync(src);
  }
  catch(e){ err.append(((e && e.message) ? e.message : String(e)) + "\n"); }
  variables = await capturePyodideVariables(py, null, true);
  if (snap){ try {                                   // 만든 파일 수집(오류 나도) 후, 다음 실행에 쌓이지 않게 정리
    outputs = pyFsCollectOutputs(py, baseDir, snap);
    for (const o of outputs){ try { py.FS.unlink(baseDir + "/" + o.name); } catch(_){} }
  } catch(_){} }
  const images = await capturePyodidePlots(py);
  try { py.runPython("import sys\nsys.stdin = sys.__stdin__"); py.globals.delete("__run_stdin"); } catch(_){}
  try { py.setStdout({}); py.setStderr({}); } catch(_){}
  const stdout = out.value(), stderr = err.value();
  return { stdout, stderr, code: stderr ? 1 : 0, images, outputs, variables };
}

// 옆 파일 포함 실행용 바이너리 번들:
// [targetLen][target][count]( [pathLen][path][dataLen][data] )*[stdinLen][stdin][cwdLen][cwd][dirCount]([dirLen][dir])* (모두 LE)
function buildPyBundle(files, target, stdin, cwd, dirs=[]){
  const enc = new TextEncoder();
  const chunks = []; let total = 0;
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); chunks.push(b); total += 4; };
  const raw = (b) => { chunks.push(b); total += b.length; };
  const tb = enc.encode(target); u32(tb.length); raw(tb);
  u32(files.length);
  for (const f of files){ const pb = enc.encode(f.path); u32(pb.length); raw(pb); u32(f.bytes.length); raw(f.bytes); }
  const ib = enc.encode(stdin || ""); u32(ib.length); raw(ib);
  const cb = enc.encode(cwd || ""); u32(cb.length); raw(cb);
  const directoryPaths = [...new Set((dirs || []).map(normalizedRunPath).filter(Boolean))];
  u32(directoryPaths.length);
  for (const dir of directoryPaths){ const db = enc.encode(dir); u32(db.length); raw(db); }
  const out = new Uint8Array(total); let o = 0; for (const c of chunks){ out.set(c, o); o += c.length; }
  return out;
}
// 로컬 백엔드: 압축 트리를 통째로 보내 임시폴더에 복원 후 target 스크립트를 제자리 실행
async function runBundleViaBackend(bundle, stdin){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 65000);
  try {
    const body = buildPyBundle(bundle.files, bundle.target, stdin, bundle.cwd, bundle.dirs);
    const res = await fetch("/run-python-bundle", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body, signal: ctrl.signal });
    const txt = await res.text();
    if (!res.ok) throw new Error(txt && txt.indexOf("no-python") >= 0 ? "이 컴퓨터에서 파이썬을 찾지 못했어요." : (txt || ("HTTP " + res.status)));
    try { const j = JSON.parse(txt); return { stdout: j.stdout || "", stderr: j.stderr || "", code: (j.code != null ? j.code : 0), images: j.images || [] }; }
    catch(_){ return { stdout: txt, stderr: "", code: 0 }; }
  } finally { clearTimeout(timer); }
}
// Pyodide: 가상 파일시스템에 트리를 써넣고 chdir + sys.path 후 runpy 로 실행
async function runBundleViaPyodide(bundle, onMsg, stdin, packageSource){
  let py;
  try { py = await ensurePyodide(onMsg); }
  catch(e){ throw new Error("브라우저 파이썬 런타임을 불러오지 못했어요. 인터넷 연결이 필요합니다(또는 manneung-classroom.exe + 로컬 파이썬으로 실행)."); }
  const root = "/runproj_" + Date.now();
  py.FS.mkdirTree(root);
  for (const dir of bundle.dirs || []){
    const path = normalizedRunPath(dir);
    if (path) py.FS.mkdirTree(root + "/" + path);
  }
  for (const f of bundle.files){
    const full = root + "/" + f.path;
    const slash = full.lastIndexOf("/");
    if (slash > 0) py.FS.mkdirTree(full.slice(0, slash));
    py.FS.writeFile(full, f.bytes);
  }
  const snap = pyFsSnapshot(py, root);                 // 입력 트리 스냅샷(이후 새/변경 파일 = 출력)
  const tslash = bundle.target.lastIndexOf("/");
  const scriptDir = tslash >= 0 ? root + "/" + bundle.target.slice(0, tslash) : root;
  const runDir = bundle.cwd ? root + "/" + normalizedRunPath(bundle.cwd) : scriptDir;
  const scriptFull = root + "/" + bundle.target;
  const out = createPythonOutputCollector(), err = createPythonOutputCollector();
  let outputs = [], variables = [];
  py.setStdout({ batched: (s) => { out.append(s + "\n"); } });
  py.setStderr({ batched: (s) => { err.append(s + "\n"); } });
  try {
    py.globals.set("__run_dir", runDir);
    py.globals.set("__run_root", root);
    py.globals.set("__run_file", scriptFull);
    py.globals.set("__run_stdin", stdin || "");
    const _dec = new TextDecoder();
    let _allpy = "";                                   // 대상 + 옆 .py 모듈의 import 까지 패키지 자동 로드
    for (const f of bundle.files){ if (/\.py$/i.test(f.path)){ try { _allpy += _dec.decode(f.bytes) + "\n"; } catch(_){} } }
    await preloadPyodidePackages(py, _allpy + "\n" + (packageSource || ""), onMsg);
    try { await py.runPythonAsync(KFONT_SETUP_CALL); } catch(_){}   // 한글 폰트 등록(matplotlib 있을 때만)
    onMsg && onMsg("실행 중… (브라우저 · 폴더 포함)");
    await py.runPythonAsync(
      "import os, sys, runpy, io\n" +
      "for __name, __mod in list(sys.modules.items()):\n" +
      "    __file = getattr(__mod, '__file__', '')\n" +
      "    if isinstance(__file, str) and __file.startswith('/runproj_'):\n" +
      "        sys.modules.pop(__name, None)\n" +
      "sys.path[:] = [__p for __p in sys.path if not str(__p).startswith('/runproj_')]\n" +
      "os.chdir(__run_dir)\n" +
      "__paths = [os.path.dirname(__run_file)]\n" +
      "__cur = __run_dir\n" +
      "while __cur:\n" +
      "    if __cur not in __paths:\n" +
      "        __paths.append(__cur)\n" +
      "    if os.path.abspath(__cur) == os.path.abspath(__run_root):\n" +
      "        break\n" +
      "    __next = os.path.dirname(__cur)\n" +
      "    if __next == __cur:\n" +
      "        break\n" +
      "    __cur = __next\n" +
      "for __p in reversed(__paths):\n" +
      "    if __p not in sys.path:\n" +
      "        sys.path.insert(0, __p)\n" +
      "sys.stdin = io.StringIO(__run_stdin)\n" +
      "__run_vars = runpy.run_path(__run_file, run_name='__main__')\n"
    );
  } catch(e){ err.append(((e && e.message) ? e.message : String(e)) + "\n"); }
  variables = await capturePyodideVariables(py, "__run_vars", false);
  try { outputs = pyFsCollectOutputs(py, root, snap); } catch(_){}   // rmtree 전에 만든 파일 수집
  const images = await capturePyodidePlots(py);
  {
    try { py.setStdout({}); py.setStderr({}); } catch(_){}
    try { py.runPython("import sys\nsys.stdin = sys.__stdin__"); } catch(_){}
    try { py.runPython(
      "import os, sys\n" +
      "os.chdir('/home/pyodide')\n" +
      "for __name, __mod in list(sys.modules.items()):\n" +
      "    __file = getattr(__mod, '__file__', '')\n" +
      "    if isinstance(__file, str) and __file.startswith('/runproj_'):\n" +
      "        sys.modules.pop(__name, None)\n" +
      "sys.path[:] = [__p for __p in sys.path if not str(__p).startswith('/runproj_')]"
    ); } catch(_){}
    try { py.globals.delete("__run_dir"); py.globals.delete("__run_root"); py.globals.delete("__run_file"); py.globals.delete("__run_stdin"); py.globals.delete("__run_vars"); } catch(_){}
    try { py.runPython("import shutil; shutil.rmtree('" + root + "', ignore_errors=True)"); } catch(_){}
  }
  const stdout = out.value(), stderr = err.value();
  return { stdout, stderr, code: stderr ? 1 : 0, images, outputs, variables };
}

function appendPlotGallery(panel, images){
  if (!images || !images.length) return;
  const gallery = document.createElement("div"); gallery.className = "out-plots";
  images.forEach((src, i) => {
    const img = document.createElement("img"); img.className = "out-plot"; img.src = src; img.alt = "그래프 " + (i + 1);
    gallery.appendChild(img);
  });
  panel.appendChild(gallery);
}

function renderPyResult(panel, stdout, stderr, fatal, images, variables, code){
  panel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head";
  const headLabel = document.createElement("span"); headLabel.textContent = "실행 결과"; head.appendChild(headLabel);
  const pre = document.createElement("pre"); pre.className = "out-pre";
  if (stdout){ const o = document.createElement("span"); o.textContent = stdout; pre.appendChild(o); }
  if (stderr){ const e = document.createElement("span"); applyPythonStderrClass(e, stderr, code); e.textContent = (stdout ? "\n" : "") + stderr; pre.appendChild(e); }
  if (fatal){ const f = document.createElement("span"); f.className = "out-err"; f.textContent = ((stdout || stderr) ? "\n" : "") + "⚠ " + fatal; pre.appendChild(f); }
  if (!stdout && !stderr && !fatal){ pre.classList.add("out-muted"); pre.textContent = "(출력 없음)"; }
  panel.appendChild(head); panel.appendChild(pre);
  appendVariableInspector(panel, variables);
  appendPlotGallery(panel, images);
  if (typeof lessonPyOnResult === "function") lessonPyOnResult({ stdout, stderr, fatal, images });   // 수업 리플레이(녹화 중일 때만)
}

function appendPythonErrorHelp(panel, stderr, location, ui){
  const help = explainPythonError(stderr);
  if (!help || !panel) return;
  const card = document.createElement("section"); card.className = "py-error-help";
  const title = document.createElement("strong"); title.textContent = help.title;
  const type = document.createElement("code"); type.textContent = help.type;
  const head = document.createElement("div"); head.className = "py-error-help-head"; head.append(title, type);
  const tip = document.createElement("p"); tip.textContent = help.tip;
  card.append(head, tip);
  if ((help.type === "FileNotFoundError" || help.type === "ModuleNotFoundError") && ui && ui.projectSummary){
    const projectHint = document.createElement("p"); projectHint.className = "py-error-project-hint";
    projectHint.textContent = "편집기 위 ‘실행 작업폴더’를 펼치면 현재 상대경로 기준과 포함된 파일을 확인할 수 있어요.";
    card.appendChild(projectHint);
    if (typeof ui.openPathHelp === "function"){
      const pathHelp = document.createElement("button"); pathHelp.type = "button"; pathHelp.className = "py-error-path-help";
      pathHelp.textContent = "경로 도우미 열기";
      pathHelp.addEventListener("click", () => ui.openPathHelp());
      card.appendChild(pathHelp);
    }
  }
  if (help.message){
    const detail = document.createElement("div"); detail.className = "py-error-detail"; detail.textContent = help.message; card.appendChild(detail);
  }
  if (location && location.line){
    const where = document.createElement("div"); where.className = "py-error-detail";
    where.textContent = "오류 위치: " + (location.file || "현재 파일") + " · " + location.line + "줄";
    card.appendChild(where);
    const jump = document.createElement("button"); jump.type = "button";
    jump.textContent = (location.current ? "" : (location.file + " ")) + location.line + "줄로 이동";
    jump.addEventListener("click", () => {
      if (location.current){
        if (ui && ui.focusLine) ui.focusLine(location.line);   // 화면 안/밖과 무관하게 항상 해당 줄로 스크롤 + 커서 이동
        if (ui && ui.markError) ui.markError(location.line);    // 빨간 에러 줄 강조 유지
      }
      else if (ui && ui.focusErrorLocation && !ui.focusErrorLocation(location.file, location.line)) toast("해당 Python 파일을 먼저 열어 주세요.", 2400);
    });
    card.appendChild(jump);
  }
  panel.appendChild(card);
}

/* ===== Py 편집기 필기 모드 — 보기 모드에서만 켜짐, 세션 임시(문서 닫으면 사라짐) =====
   PDF 펜과 분리된 별도 상태/바를 가진다. 코드는 스크롤이 textarea 안쪽이라 ta.scrollTop 만큼
   필기를 위/아래로 이동시켜 같이 흐르도록 그린다(필기 좌표는 콘텐츠 절대 Y 기준). */
const _codePenState = { tool: "pen", color: "#e11d48", width: 3 };
let _codePenBar = null;
let _codePenActive = null;   // { doc, overlay, canvas, ... }

// 한 패널(편집기 또는 실행결과)에 캔버스 오버레이를 깔고 그리기/스크롤 보정을 처리하는 공용 헬퍼.
// scrollSrc 는 실제 스크롤이 일어나는 엘리먼트(편집기: textarea, 실행결과: 패널 자기 자신).
function _createPenSurface(targetEl, scrollSrc){
  const overlay = document.createElement("div"); overlay.className = "code-pen-overlay"; overlay.hidden = true;
  const canvas = document.createElement("canvas"); canvas.className = "code-pen-canvas";
  canvas.dataset.inkTool = _codePenState.tool;
  overlay.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const strokes = [];
  let curStroke = null, lastPt = null, vw = 0, vh = 0, dpr = 1;
  const applyStroke = (s) => {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
    ctx.globalAlpha = s.tool === "highlighter" ? 0.30 : 1;
    if (s.tool === "eraser"){ ctx.globalCompositeOperation = "destination-out"; ctx.strokeStyle = "rgba(0,0,0,1)"; }
    else { ctx.globalCompositeOperation = "source-over"; }
  };
  const drawSeg = (s, a, b) => {
    const sy = scrollSrc.scrollTop;
    applyStroke(s); ctx.beginPath();
    ctx.moveTo(a.x, a.y - sy); ctx.lineTo(b.x, b.y - sy);
    if (a.x === b.x && a.y === b.y) ctx.lineTo(b.x + 0.01, b.y - sy + 0.01);
    ctx.stroke();
  };
  const redraw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, vw, vh);
    const sy = scrollSrc.scrollTop;
    for (const s of strokes){
      if (!s.points || !s.points.length) continue;
      applyStroke(s); ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y - sy);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y - sy);
      if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.01, s.points[0].y - sy + 0.01);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  };
  const resize = () => {
    const r = targetEl.getBoundingClientRect();
    // 스크롤바 영역은 캔버스로 덮지 않는다 → 네이티브 스크롤바를 잡아 끌 수 있고 커서도 정상 표시됨
    const sbW = Math.max(0, scrollSrc.offsetWidth - scrollSrc.clientWidth);
    const sbH = Math.max(0, scrollSrc.offsetHeight - scrollSrc.clientHeight);
    vw = Math.max(1, Math.round(r.width) - sbW); vh = Math.max(1, Math.round(r.height) - sbH);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    canvas.style.width = vw + "px"; canvas.style.height = vh + "px";
    redraw();
  };
  const onScroll = () => redraw();
  scrollSrc.addEventListener("scroll", onScroll);
  let ro = null;
  if (typeof ResizeObserver !== "undefined"){ ro = new ResizeObserver(resize); ro.observe(targetEl); }
  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top + scrollSrc.scrollTop };
  };
  const inkWidth = (tool, w) => tool === "eraser" ? Math.max(14, w * 5) : (tool === "highlighter" ? w * 3 : w);
  const onPointerDown = (e) => {
    if (overlay.hidden || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    const pos = getPos(e);
    curStroke = { tool: _codePenState.tool, color: _codePenState.color, width: inkWidth(_codePenState.tool, _codePenState.width), points: [pos] };
    strokes.push(curStroke); lastPt = pos;
    drawSeg(curStroke, pos, pos);
  };
  const onPointerMove = (e) => {
    if (!curStroke) return;
    e.preventDefault();
    const pos = getPos(e); curStroke.points.push(pos); drawSeg(curStroke, lastPt, pos); lastPt = pos;
  };
  const onPointerUp = () => { if (!curStroke) return; curStroke = null; lastPt = null; redraw(); };
  // 휠은 스크롤 소스로 전달 → 필기 중에도 스크롤 가능
  const onWheel = (e) => { scrollSrc.scrollTop += e.deltaY; scrollSrc.scrollLeft += e.deltaX; e.preventDefault(); };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  return {
    overlay, canvas, strokes, resize, redraw,
    show(){ overlay.hidden = false; resize(); },
    hide(){ overlay.hidden = true; },
    clear(){ strokes.length = 0; redraw(); },
    cleanup(){
      try { scrollSrc.removeEventListener("scroll", onScroll); } catch(_){}
      if (ro){ try { ro.disconnect(); } catch(_){} }
      try { overlay.remove(); } catch(_){}
    }
  };
}

function setupCodePenOverlay(doc){
  if (!doc || !doc.codeEditor) return null;
  if (doc.codePenOverlay) return doc.codePenOverlay;
  const editor = doc.codeEditor;
  const editEl = editor.host.querySelector(".code-edit"); if (!editEl) return null;
  // 편집기 캔버스
  const edit = _createPenSurface(editEl, editor.ta);
  editEl.appendChild(edit.overlay);
  // 실행결과 패널 캔버스(있을 때만) — outPanel.innerHTML 이 재설정되면 캔버스도 같이 날아가므로 MutationObserver 로 복구
  const splitEl = editor.host.closest(".run-split");
  const outPanel = splitEl ? splitEl.querySelector(".code-output") : null;
  let out = null, mo = null;
  if (outPanel){
    if (getComputedStyle(outPanel).position === "static") outPanel.style.position = "relative";
    out = _createPenSurface(outPanel, outPanel);
    outPanel.appendChild(out.overlay);
    mo = new MutationObserver(() => {
      if (out.overlay.parentNode !== outPanel){
        outPanel.appendChild(out.overlay);
        out.resize();
      }
    });
    mo.observe(outPanel, { childList: true });
  }
  let active = false;
  const api = {
    get active(){ return active; },
    show(){ active = true; edit.show(); if (out) out.show(); },
    hide(){ active = false; edit.hide(); if (out) out.hide(); },
    setTool(tool){ edit.canvas.dataset.inkTool = tool; if (out) out.canvas.dataset.inkTool = tool; },
    clear(){ edit.clear(); if (out) out.clear(); },
    cleanup(){ edit.cleanup(); if (out) out.cleanup(); if (mo){ try { mo.disconnect(); } catch(_){} } }
  };
  doc.codePenOverlay = api;
  return api;
}

function ensureCodePenBar(){
  if (_codePenBar) return _codePenBar;
  const bar = document.createElement("div"); bar.className = "pen-bar code-pen-bar"; bar.hidden = true;
  const mk = (label, title, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; b.addEventListener("click", fn); return b; };
  const mkIcon = (name, fallback, title, cls, fn) => {
    const b = mk("", title, cls, fn);
    if (typeof window.setUiIcon === "function") window.setUiIcon(b, name, title);
    else b.textContent = fallback;
    return b;
  };
  // 드래그 핸들
  const drag = document.createElement("span"); drag.className = "pen-drag"; drag.title = "끌어서 위치 옮기기"; drag.textContent = "⋮⋮";
  bar.appendChild(drag); bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));
  // 도구
  const tools = {};
  const setTool = (t) => {
    _codePenState.tool = t;
    for (const k in tools) tools[k].classList.toggle("active", k === t);
    if (_codePenActive && _codePenActive.setTool) _codePenActive.setTool(t);
  };
  [["pen","pen","펜","펜"],["highlighter","highlighter","형광펜","형광펜"],["eraser","eraser","지우개","지우개"]].forEach(([t, name, fallback, title]) => { const b = mkIcon(name, fallback, title, "pen-tool", () => setTool(t)); tools[t] = b; bar.appendChild(b); });
  bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));
  // 색
  const swatches = {};
  const custom = document.createElement("input");
  const setColor = (c) => { _codePenState.color = c; for (const k in swatches) swatches[k].classList.toggle("active", k === c); custom.value = c; };
  ["#e11d48","#111111","#2563eb","#16a34a","#f59e0b"].forEach(c => { const s = document.createElement("button"); s.type = "button"; s.className = "pen-swatch"; s.style.background = c; s.title = c; s.addEventListener("click", () => setColor(c)); swatches[c] = s; bar.appendChild(s); });
  custom.type = "color"; custom.className = "pen-color-input"; custom.value = _codePenState.color; custom.title = "색 직접 고르기"; custom.addEventListener("input", () => setColor(custom.value)); bar.appendChild(custom);
  bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));
  // 굵기
  const widths = {};
  const setWidth = (w) => { _codePenState.width = w; for (const k in widths) widths[k].classList.toggle("active", Number(k) === w); };
  [["2","S",2],["3","M",3],["6","L",6]].forEach(([k, label, w]) => { const b = mk(label, "굵기 " + label, "pen-width", () => setWidth(w)); widths[k] = b; bar.appendChild(b); });
  bar.appendChild(Object.assign(document.createElement("span"), { className: "pen-sep" }));
  bar.appendChild(mk("초기화", "필기 전체 지우기", "pen-act", () => { if (_codePenActive && _codePenActive.clear) _codePenActive.clear(); }));
  bar.appendChild(mkIcon("close", "닫기", "필기 모드 끄기", "pen-act", () => { if (_codePenActive && _codePenActive.doc) setCodePenMode(_codePenActive.doc, false); }));
  setTool("pen"); setColor("#e11d48"); setWidth(3);
  byId("content").appendChild(bar);

  // 드래그(좌/우 끝 자동 세로 전환은 코드 바엔 생략 — 단순 자유 배치)
  const setAbs = (x, y) => { bar.style.left = x + "px"; bar.style.top = y + "px"; bar.style.right = "auto"; bar.style.bottom = "auto"; bar.style.transform = "none"; };
  let dragging = null;
  drag.addEventListener("pointerdown", (e) => {
    e.preventDefault(); drag.setPointerCapture(e.pointerId);
    const host = byId("content").getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    dragging = { dx: e.clientX - br.left, dy: e.clientY - br.top, hostL: host.left, hostT: host.top, hostW: host.width, hostH: host.height, barW: br.width, barH: br.height };
  });
  drag.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const x = Math.max(8, Math.min(e.clientX - dragging.hostL - dragging.dx, dragging.hostW - dragging.barW - 8));
    const y = Math.max(8, Math.min(e.clientY - dragging.hostT - dragging.dy, dragging.hostH - dragging.barH - 8));
    setAbs(x, y);
  });
  const endDrag = (e) => { if (!dragging) return; try { drag.releasePointerCapture(e.pointerId); } catch(_){} dragging = null; };
  drag.addEventListener("pointerup", endDrag); drag.addEventListener("pointercancel", endDrag);

  _codePenBar = bar; return bar;
}

function setCodePenMode(doc, on){
  if (!doc || !doc.codeEditor){ return; }
  const editor = doc.codeEditor;
  if (on){
    const api = setupCodePenOverlay(doc); if (!api) return;
    editor.ta.readOnly = true;                                // 필기 중엔 편집 자동 잠금(좌표가 줄과 어긋나지 않게)
    editor.host.classList.add("code-host-viewmode");
    api.doc = doc; api.setTool(_codePenState.tool); api.show();
    _codePenActive = api;
    const bar = ensureCodePenBar(); bar.hidden = false;
    if (doc.__inkBtn) doc.__inkBtn.classList.add("primary");
  } else {
    if (doc.codePenOverlay){ doc.codePenOverlay.hide(); }
    editor.ta.readOnly = false;
    editor.host.classList.remove("code-host-viewmode");
    if (_codePenActive && _codePenActive.doc === doc) _codePenActive = null;
    if (_codePenBar && !_codePenActive) _codePenBar.hidden = true;
    if (doc.__inkBtn) doc.__inkBtn.classList.remove("primary");
  }
}

// 활성 문서가 바뀔 때 호출 — 새 활성 문서가 코드 필기 켜진 문서가 아니면 바를 숨김.
// (필기 상태/획은 그대로 두므로 그 문서로 돌아오면 자동 복원)
function syncCodePenBarToActive(d){
  if (!_codePenBar) return;
  const activeOverlay = (d && d.codePenOverlay && d.codePenOverlay.active) ? d.codePenOverlay : null;
  _codePenActive = activeOverlay;
  _codePenBar.hidden = !activeOverlay;
}
