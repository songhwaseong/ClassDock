"use strict";

/* ===== 코드/설정 파일 미리보기 (자체 구문 강조 + 줄번호, 외부 의존성 없음) ===== */
const CODE_KW = "abstract|and|arguments|as|assert|async|await|base|bool|boolean|break|byte|case|catch|chan|char|class|const|continue|debugger|def|default|defer|del|delete|do|double|elif|else|elsif|end|enum|except|export|extends|extern|false|final|finally|float|fn|for|foreach|from|func|function|global|go|goto|if|impl|implements|import|in|instanceof|int|interface|is|lambda|let|long|loop|match|mod|module|mut|namespace|new|nil|none|not|null|object|or|out|override|package|pass|private|protected|public|pub|raise|readonly|ref|return|select|self|short|sizeof|static|struct|super|switch|synchronized|template|this|throw|throws|trait|true|try|typedef|typeof|union|unsafe|use|using|var|virtual|void|volatile|when|where|while|with|yield";
const SQL_KW = "select|from|where|insert|into|update|delete|create|alter|drop|table|view|index|join|inner|left|right|outer|full|cross|on|group|order|by|asc|desc|having|union|all|values|set|primary|key|foreign|references|not|null|default|distinct|as|and|or|like|between|in|exists|case|when|then|else|count|sum|avg|min|max|limit|offset|begin|commit|rollback";
window.__lastCodeLinkDocId = window.__lastCodeLinkDocId || null;

function highlightCode(src, profile){
  if (profile === "text") return escapeHtml(src);   // 강조 없이 텍스트만(rst/adoc/org/tex 등 경량 마크업)
  let com;
  if (profile==="hash") com="#[^\\n]*";
  else if (profile==="sql") com="--[^\\n]*|/\\*[\\s\\S]*?\\*/";
  else if (profile==="xml") com="<!--[\\s\\S]*?-->";
  else if (profile==="css") com="/\\*[\\s\\S]*?\\*/";
  else com="//[^\\n]*|/\\*[\\s\\S]*?\\*/";
  const str = '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'' + (profile==="c" ? '|`(?:\\\\.|[^`\\\\])*`' : "");
  const num = "\\b0[xX][0-9a-fA-F]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b";
  const kwList = profile==="sql" ? SQL_KW : CODE_KW;
  let alts;
  if (profile==="xml") alts = ["(?<com>"+com+")", "(?<s>"+str+")", "(?<t></?[A-Za-z][\\w:.-]*|/?>)"];
  else alts = ["(?<com>"+com+")", "(?<s>"+str+")", "(?<n>"+num+")", "(?<k>\\b(?:"+kwList+")\\b)"];
  let re;
  try { re = new RegExp(alts.join("|"), profile==="sql" ? "gi" : "g"); }
  catch(e){ return escapeHtml(src); }                 // 정규식 미지원 환경 → 일반 텍스트로 폴백
  let out="", last=0, m;
  while ((m = re.exec(src))){
    if (m[0] === ""){ re.lastIndex++; continue; }
    out += escapeHtml(src.slice(last, m.index));
    const g = m.groups, cls = g.com?"c":g.s?"s":g.n?"n":g.k?"k":g.t?"t":"";
    out += '<span class="tk-'+cls+'">' + escapeHtml(m[0]) + '</span>';
    last = m.index + m[0].length;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

// 주피터 노트북(.ipynb) JSON → 실행 가능한 파이썬 소스로 변환
//  · 코드 셀은 그대로, 마크다운/설명 셀은 주석(#)으로 옮긴다
//  · 파이썬이 아닌 노트북 명령(%matplotlib, !pip install …)은 주석 처리해 실행이 멈추지 않게 한다
function ipynbToPython(jsonText, fileName){
  let nb;
  try { nb = JSON.parse(jsonText); }
  catch(e){ throw new Error("올바른 노트북(.ipynb) 파일이 아닙니다."); }
  const cells = Array.isArray(nb.cells) ? nb.cells
    : (nb.worksheets && nb.worksheets[0] && Array.isArray(nb.worksheets[0].cells) ? nb.worksheets[0].cells : []);  // nbformat 3 호환
  if (!cells.length) throw new Error("노트북에 셀이 없습니다.");
  const srcOf = (c) => {
    const s = (c.source != null) ? c.source : c.input;     // nbformat 3은 input
    return (Array.isArray(s) ? s.join("") : (s || "")).replace(/\r\n?/g, "\n");
  };
  const out = [];
  out.push("# " + (fileName || "notebook") + " — 주피터 노트북(.ipynb)을 파이썬 코드로 변환했습니다.");
  out.push("# 셀 구분자는 # %% (VSCode·Jupyter 표준). 설명(마크다운) 셀은 주석으로 옮겼습니다.");
  out.push("");
  for (const c of cells){
    const type = c.cell_type || "code";
    const raw = srcOf(c);
    if (type === "code"){
      const body = raw.split("\n")
        .map(line => /^\s*[%!]/.test(line) ? "# (노트북 명령) " + line : line)   // 매직·셸 명령 주석 처리
        .join("\n").replace(/\s+$/, "");
      out.push("# %%");
      if (body.trim()) out.push(body);
      out.push("");
    } else {
      if (!raw.trim()) continue;                            // 빈 설명 셀은 건너뜀
      const lines = raw.replace(/\s+$/, "").split("\n").map(l => l.length ? "# " + l : "#");
      out.push("# %% [markdown]");
      out.push(lines.join("\n"));
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// 편집기 내용을 '코드 셀' 주석 경계로 잘라 셀 목록을 만든다(파이썬 셀 하버스트의 경계 판정과 동일 규칙).
function splitNotebookCells(text){
  const lines = String(text == null ? "" : text).split("\n");
  // 셀 경계: 표준 # %% (VSCode·Jupyter) 또는 이 앱의 옛 '# … 코드 셀 …' 헤더 둘 다 인식.
  const isHead = (l) => { const t = l.replace(/^\s+/, ""); return /^#+\s*%%/.test(t) || (t.startsWith("#") && t.indexOf("코드 셀") >= 0); };
  const heads = [];
  for (let i = 0; i < lines.length; i++) if (isHead(lines[i])) heads.push(i);
  if (!heads.length) return [{ index:1, startLine:0, endLine:lines.length - 1, label:"1", code:text }];
  // 중간 경계만 있는 기존 코드도 첫 경계 이전 내용을 첫 셀로 보존한다.
  const starts = heads[0] === 0 ? heads : [0].concat(heads);
  const bounds = starts.concat([lines.length]);
  const cells = [];
  for (let k = 0; k < starts.length; k++){
    const s = starts[k], e = bounds[k + 1];
    const label = (lines[s].match(/코드 셀\s*(\d+)/) || [])[1] || String(k + 1);
    cells.push({ index:k + 1, startLine:s, endLine:e - 1, label, code:lines.slice(s, e).join("\n") });
  }
  return cells;
}

function ensureFirstNotebookCellMarker(text){
  const value = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  const firstLine = value.split("\n", 1)[0];
  if (/^\s*#+\s*%%/.test(firstLine) || (firstLine.trim().startsWith("#") && firstLine.indexOf("코드 셀") >= 0)){
    return value;
  }
  return "# %%\n" + value;
}

// .py 편집기 내용 → 노트북 모델(.ipynb 직렬화 대상). 셀 경계는 splitNotebookCells 와 동일하게 # %% / 레거시 마커.
// 각 셀의 첫 줄이 마커면 떼어내고, # %% [markdown](또는 레거시 '설명')은 마크다운 셀로 복원한다.
function pyTextToNotebookModel(text){
  const segs = splitNotebookCells(String(text == null ? "" : text));
  const cells = [];
  for (const seg of segs){
    const lines = seg.code.split("\n");
    const head = (lines[0] || "").replace(/^\s+/, "");
    const isMarker = /^#+\s*%%/.test(head) || head.indexOf("코드 셀") >= 0 || /^#.*설명/.test(head);
    const markdown = isMarker && (/\[\s*markdown\s*\]/i.test(head) || head.indexOf("설명") >= 0);
    let body = lines.slice(isMarker ? 1 : 0);
    while (body.length && !body[0].trim()) body.shift();          // 마커 뒤 앞쪽 빈 줄 제거
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const source = markdown
      ? body.map(l => l.replace(/^#[ ]?/, "")).join("\n")          // 주석 접두 제거 → 마크다운 원문 복원
      : body.map(l => l.replace(/^# \(노트북 명령\) /, "")).join("\n");   // %매직·!셸 명령 복원
    if (!source.trim()) continue;                                 // 빈 셀은 건너뜀
    cells.push({ id: nbNewId(), type: markdown ? "markdown" : "code", source, execCount: null, outputs: [], rawOutputs: [], metadata: {} });
  }
  if (!cells.length) cells.push({ id: nbNewId(), type: "code", source: "", execCount: null, outputs: [], rawOutputs: [], metadata: {} });
  return { cells, metadata: {}, nbformat: 4, nbformat_minor: 5 };
}
// 현재 .py 편집기 내용을 .ipynb 로 변환해 새 노트북 문서로 연다(셀 단위 실행·저장은 노트북 뷰에서).
function convertPyEditorToNotebook(text, ownerDoc){
  if (typeof modelToIpynb !== "function" || typeof handleFiles !== "function"){
    if (typeof toast === "function") toast("노트북 변환을 사용할 수 없어요.", 3000);
    return;
  }
  const ipynbText = modelToIpynb(pyTextToNotebookModel(text));
  const base = String((ownerDoc && ownerDoc.name) || "script.py").replace(/\.[^.]+$/, "") || "notebook";
  let file = new File([ipynbText], base + ".ipynb", { type: "application/x-ipynb+json" });
  const opts = { isScratch: true };
  // 원본 .py 가 사이드바 폴더 안에 있으면 변환 노트북도 같은 폴더에 묶는다.
  if (ownerDoc && ownerDoc.parentId) opts.parentId = ownerDoc.parentId;
  // 원본 .py 가 폴더(아카이브)에서 열렸다면 그 폴더 컨텍스트(archiveCtx)를 물려준다. 그래야 노트북을
  // 실행할 때도 옆·상위 파일(예: dataIn/auto-mpg.csv)을 커널에 마운트하고, 작업폴더(cwd)를 원본 .py
  // 와 같은 규칙으로 추론한다(buildNotebookWorkspaceBundle 은 archiveCtx 가 있어야 동작). 없으면
  // 커널 파일시스템이 비어 상대경로 데이터 로드가 FileNotFoundError 로 실패한다.
  // relPath 는 같은 폴더의 .ipynb 로 둬서 원본 .py 문서와 sourceKey 가 충돌하지 않게 한다.
  if (ownerDoc && ownerDoc.archiveCtx){
    opts.archiveCtx = ownerDoc.archiveCtx;
    const srcRel = ownerDoc.relPath || ownerDoc.workspacePath || ownerDoc.name;
    if (srcRel) opts.relPath = String(srcRel).replace(/\.[^./]+$/, "") + ".ipynb";
  }
  // 원본 .py 를 '폴더로 열었다면'(디렉터리 핸들 보유) 그 폴더 핸들을 새 파일에 물려, 저장 때 같은
  // 폴더에 만들어지게 한다(saveViaFileHandle 의 fsDirHandle 경로). 파일 단독으로 연 경우엔 부모
  // 폴더를 알 수 없어(File System Access API 에 getParent 없음) 저장 때 위치를 고르게 된다.
  if (ownerDoc && ownerDoc.fsDirHandle && typeof withDirHandle === "function"){
    file = withDirHandle(file, ownerDoc.fsDirHandle);
  }
  handleFiles([file], opts);
  if (typeof toast === "function") toast("노트북으로 변환해 열었어요. 셀 단위로 실행·저장할 수 있어요.", 3200);
}

// .ipynb(노트북) 문서에만 붙는 커널 툴바: 셀 하나씩 실행하면서 상태가 누적되는 브라우저 커널(Pyodide).
// 일반 ▶ 실행(전체)·다른 파이썬 실행과 완전히 분리됨 — 전용 네임스페이스(__mn_kernels[kid])를 쓴다.
function setupNotebookKernelBar(ownerDoc, editor, ui, outer, split){
  const kid = "nbkernel:" + (ownerDoc && ownerDoc.id != null ? ownerDoc.id : Math.random().toString(36).slice(2));
  const outPanel = ui.outPanel;
  const bar = document.createElement("div"); bar.className = "nb-kernel-bar";
  const mk = (label, title, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; return b; };
  const tag = document.createElement("span"); tag.className = "nb-kernel-tag"; tag.textContent = "노트북 커널"; tag.title = "셀을 하나씩 실행하면 변수가 다음 셀로 이어집니다(브라우저 Python). 전체 ▶ 실행과는 별개예요.\n단축키 — Ctrl+Enter: 이 셀 실행 · Shift+Enter: 실행 후 다음 셀 · Ctrl+↑/↓: 셀 이동(실행 안 함)";
  const runCellBtn = mk("이 셀", "커서가 있는 셀을 실행 (상태 유지)", "nb-kernel-run");
  const nextBtn = mk("다음 셀", "마지막 실행한 셀의 다음 셀을 실행", "nb-kernel-next");
  const restartBtn = mk("커널 재시작", "누적된 변수·상태를 모두 비웁니다", "nb-kernel-restart");
  const nbViewBtn = mk("셀 노트북", "주피터식 셀 편집기로 보기(실험 · 앱 새로고침)", "nb-kernel-nbview");
  nbViewBtn.addEventListener("click", () => { if (typeof window !== "undefined" && window.mnNotebookMode) window.mnNotebookMode(true); });
  const kstatus = document.createElement("span"); kstatus.className = "nb-kernel-status"; kstatus.textContent = "셀에 커서를 두고 [이 셀] 실행";
  bar.append(tag, runCellBtn, nextBtn, restartBtn, nbViewBtn, kstatus);
  outer.insertBefore(bar, split);

  let busy = false, lastRunIndex = 0, activeTask = null, cancelRequested = false;
  const setBusy = (b) => {
    busy = b;
    runCellBtn.disabled = false;
    runCellBtn.textContent = b ? "■" : "이 셀";
    runCellBtn.title = b ? "현재 셀 실행 중지(커널 상태 초기화)" : "커서가 있는 셀을 실행 (상태 유지)";
    runCellBtn.classList.toggle("is-running", b);
    nextBtn.disabled = restartBtn.disabled = b;
  };
  const setStatus = (t) => { kstatus.textContent = t; };
  const stopRun = () => {
    if (!busy || cancelRequested) return;
    cancelRequested = true;
    runCellBtn.disabled = true;
    setStatus("중지 요청 중…");
    if (activeTask && typeof activeTask.cancel === "function") activeTask.cancel();
  };

  const caretCell = (cells) => {
    const ta = editor.ta;
    const line = ta.value.slice(0, ta.selectionStart || 0).split("\n").length - 1;
    let found = cells[0];
    for (const c of cells){ if (line >= c.startLine) found = c; else break; }
    return found || cells[0];
  };

  const ensureLog = () => {
    let log = outPanel.querySelector(".nb-kernel-log");
    if (!log){ outPanel.innerHTML = ""; log = document.createElement("div"); log.className = "nb-kernel-log"; outPanel.appendChild(log); }
    return log;
  };
  const renderResult = (label, result) => {
    const log = ensureLog();
    const block = document.createElement("div"); block.className = "nb-cell-out" + (result.ok === false ? " has-err" : "");
    block.dataset.cell = String(label);
    const head = document.createElement("div"); head.className = "nb-cell-out-head"; head.textContent = "셀 " + label;
    block.appendChild(head);
    if (result.stdout || result.stderr || (!result.images || !result.images.length)){
      const pre = document.createElement("pre"); pre.className = "out-pre";
      const so = document.createElement("span"); so.textContent = result.stdout || "";
      const se = document.createElement("span"); applyPythonStderrClass(se, result.stderr || "", result.ok === false ? 1 : 0); se.textContent = result.stderr || "";
      pre.append(so, se); block.appendChild(pre);
    }
    for (const src of result.images || []){ const im = document.createElement("img"); im.className = "nb-cell-img"; im.src = src; block.appendChild(im); }
    if (result.variables && result.variables.length){
      const vt = document.createElement("div"); vt.className = "nb-var-list";
      const vh = document.createElement("div"); vh.className = "nb-var-title"; vh.textContent = "변수 " + result.variables.length + "개";
      vt.appendChild(vh);
      for (const v of result.variables.slice(0, 40)){
        const row = document.createElement("div"); row.className = "nb-var-row";
        const n = document.createElement("span"); n.className = "nb-var-name"; n.textContent = v.name;
        const ty = document.createElement("span"); ty.className = "nb-var-type"; ty.textContent = v.type;
        const val = document.createElement("span"); val.className = "nb-var-val"; val.textContent = v.value;
        row.append(n, ty, val); vt.appendChild(row);
      }
      block.appendChild(vt);
    }
    // 같은 셀을 다시 실행하면 옛 출력 블록을 그 자리에서 교체(누적 X) — 셀 번호 순서가 유지된다.
    const prev = log.querySelector('.nb-cell-out[data-cell="' + String(label).replace(/"/g, '\\"') + '"]');
    if (prev) prev.replaceWith(block); else log.appendChild(block);
    block.scrollIntoView({ block:"nearest" });
  };

  const runCell = async (cell) => {
    if (!cell || busy) return;
    cancelRequested = false;
    setBusy(true);
    if (editor.highlightCellRange) editor.highlightCellRange(cell.startLine + 1, cell.endLine + 1);
    split.classList.add("show-out");
    if (ui.clearBtn){ ui.clearBtn.hidden = false; ui.clearBtn.disabled = false; }
    if (ui.layoutBtn) ui.layoutBtn.hidden = false;
    setStatus("셀 " + cell.label + " 실행 준비…");
    try {
      let packages = { urls:[], names:[] };
      try { packages = await preparePyodideWorkerPackages(cell.code, setStatus); }
      catch(e){ setStatus(e && e.message ? e.message : "패키지 설치를 취소했어요."); setBusy(false); return; }
      if (cancelRequested) throw Object.assign(new Error("실행을 중지했습니다."), { code:"worker-cancel" });
      await ensurePyodideWorker(setStatus);
      if (cancelRequested) throw Object.assign(new Error("실행을 중지했습니다."), { code:"worker-cancel" });
      activeTask = startPyodideKernelRun({ kernelId:kid, source:cell.code, stdin:(ui.stdin ? ui.stdin.value : ""), packages, onMsg:setStatus });
      if (cancelRequested) activeTask.cancel();
      const result = await activeTask.promise;
      renderResult(cell.label, result);
      lastRunIndex = cell.index;
      setStatus("셀 " + cell.label + (result.ok === false
        ? " 오류 · 커널 유지"
        : (result.stderr ? " 완료(경고 있음) · 커널 활성" : " 완료 · 커널 활성")));
    } catch(e){
      setStatus(cancelRequested || (e && e.code === "worker-cancel")
        ? "중지됨 · 브라우저 커널 초기화됨"
        : "실행 오류: " + (e && e.message ? e.message : e));
    } finally {
      activeTask = null;
      cancelRequested = false;
      setBusy(false);
    }
  };

  // 커서가 놓인 셀을 옅게 강조 — 커서 이동·스크롤·내용 변경 때마다 갱신(rAF로 한 번만).
  let hiRaf = 0;
  const highlightCurrent = () => {
    cancelAnimationFrame(hiRaf);
    hiRaf = requestAnimationFrame(() => {
      if (!editor.highlightCellRange) return;
      const cells = splitNotebookCells(editor.getValue());
      const cur = caretCell(cells);
      if (cur) editor.highlightCellRange(cur.startLine + 1, cur.endLine + 1);
    });
  };
  ["keyup", "mouseup", "focus", "input"].forEach(ev => editor.ta.addEventListener(ev, highlightCurrent));
  highlightCurrent();

  // 단축키 진입점(에디터 keydown에서 호출): Ctrl/⌘+Enter = 이 셀만, Shift+Enter(advance=true) = 이 셀 + 다음 셀로 이동
  ui.runCurrentCell = (advance) => {
    const cells = splitNotebookCells(editor.getValue());
    const cur = caretCell(cells);
    if (advance){
      const next = cells.find(c => c.index > cur.index);
      if (next && ui.focusLine){ ui.focusLine(next.startLine + 1); highlightCurrent(); }
    }
    runCell(cur);
  };

  // 셀 이동(실행 없이 커서만): Ctrl/⌘+↑·↓ 로 이전/다음 셀 헤더로 이동. 처음/끝에서는 멈춘다(랩어라운드 없음).
  ui.moveCell = (dir) => {
    const cells = splitNotebookCells(editor.getValue());
    if (cells.length <= 1) return false;
    const cur = caretCell(cells);
    const target = dir < 0 ? cells[cur.index - 2] : cells[cur.index];   // index 는 1-based → 배열은 index-1
    if (!target || !ui.focusLine) return false;
    ui.focusLine(target.startLine + 1);
    highlightCurrent();
    return true;
  };

  runCellBtn.addEventListener("click", () => {
    if (busy) stopRun();
    else runCell(caretCell(splitNotebookCells(editor.getValue())));
  });
  nextBtn.addEventListener("click", () => {
    const cells = splitNotebookCells(editor.getValue());
    const next = cells.find(c => c.index > lastRunIndex) || cells[0];
    if (next && ui.focusLine) ui.focusLine(next.startLine + 1);
    runCell(next);
  });
  restartBtn.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startPyodideKernelRun({ kernelId:kid, reset:true, onMsg:setStatus }).promise;
      lastRunIndex = 0;
      outPanel.innerHTML = "";
      setStatus("커널 재시작됨 · 상태 초기화");
    } catch(e){
      setStatus("커널 재시작 실패: " + ((e && e.message) ? e.message : e));
    } finally {
      setBusy(false);
    }
  });

  // 문서를 닫으면 커널 네임스페이스를 비워 메모리를 돌려준다(워커가 이미 없으면 조용히 무시).
  if (ownerDoc && Array.isArray(ownerDoc.cleanupFns)){
    ownerDoc.cleanupFns.push(() => {
      if (activeTask && typeof activeTask.cancel === "function"){ try { activeTask.cancel(); } catch(_){} }
      try { startPyodideKernelRun({ kernelId:kid, reset:true }).promise.catch(() => {}); } catch(_){}
    });
  }
}

// 실행 바의 보조 버튼들을 '⋯ 더보기' 토글 뒤로 접는다. 버튼 DOM을 그대로 옮기므로 동작·핸들러는 유지된다.
// storageKey 를 주면 펼침/접힘 상태를 기억한다(한 번 펼치면 다음에도 펼친 채로 — 자주 쓰는 사용자 배려).
function collapseRunButtons(bar, buttons, storageKey){
  buttons = (buttons || []).filter(Boolean);
  if (!bar || !buttons.length) return;
  let open = false;
  if (storageKey){ try { open = localStorage.getItem(storageKey) === "1"; } catch(_){} }
  const wrap = document.createElement("span"); wrap.className = "run-more-wrap"; wrap.hidden = !open;
  const moreBtn = document.createElement("button"); moreBtn.type = "button"; moreBtn.className = "run-more" + (open ? " open" : "");
  moreBtn.textContent = open ? "⋯ 접기" : "⋯ 더보기"; moreBtn.title = "단계 실행·진단·채점·PDF 핀·Py Env 등 추가 도구";
  bar.insertBefore(moreBtn, buttons[0]);
  bar.insertBefore(wrap, buttons[0]);
  for (const b of buttons) wrap.appendChild(b);
  moreBtn.addEventListener("click", () => {
    const show = wrap.hidden;
    wrap.hidden = !show;
    moreBtn.classList.toggle("open", show);
    moreBtn.textContent = show ? "⋯ 접기" : "⋯ 더보기";
    if (storageKey){ try { localStorage.setItem(storageKey, show ? "1" : "0"); } catch(_){} }
  });
}

/* ===== JSON 트리 보기 (표시 전용) =====
 * 파싱된 JSON 값을 접고 펼치는 트리 DOM으로 만든다. 큰 파일에서도 멈추지 않도록
 *  · 자식 DOM은 처음 펼칠 때 만들고(지연 생성),
 *  · 자식이 많은 컨테이너는 300개씩 끊어 "나머지 N개 보기"로 이어 붙인다. */
function buildJsonTreeView(rootValue){
  const CHUNK = 300;
  const EXPAND_ALL_CAP = 10000;   // 모두 펼치기가 새로 만들 수 있는 노드 상한 — 초대형 JSON에서 DOM 폭발로 멈추는 것 방지
  let nodeCount = 0;
  const buildNode = (key, value, depth) => {
    nodeCount++;
    const info = jsonTreeNodeInfo(value);
    const li = document.createElement("li");
    li.className = "jt-node" + (info.container && info.count ? " jt-branch" : "");
    const row = document.createElement("div"); row.className = "jt-row";
    let toggle = null;
    if (info.container && info.count){
      toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "jt-toggle";
      toggle.textContent = "▸"; toggle.setAttribute("aria-label", "펼치기/접기"); toggle.setAttribute("aria-expanded", "false");
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement("span"); spacer.className = "jt-toggle jt-leaf"; row.appendChild(spacer);
    }
    if (key !== null){
      const keyEl = document.createElement("span");
      keyEl.className = "jt-key" + (typeof key === "number" ? " jt-index" : "");
      keyEl.textContent = typeof key === "number" ? String(key) : JSON.stringify(key);
      const colon = document.createElement("span"); colon.className = "jt-colon"; colon.textContent = ": ";
      row.append(keyEl, colon);
    }
    if (info.container){
      const summary = document.createElement("span"); summary.className = "jt-summary"; summary.textContent = info.summary;
      row.appendChild(summary);
    } else {
      const val = document.createElement("span");
      val.className = "jt-val " + (info.kind === "string" ? "tk-s" : info.kind === "number" ? "tk-n" : "tk-k");
      val.textContent = info.text;
      row.appendChild(val);
    }
    li.appendChild(row);
    if (info.container && info.count){
      const objKeys = Array.isArray(value) ? null : Object.keys(value);
      let kidsEl = null, rendered = 0, open = false;
      const appendChunk = () => {
        const moreLi = kidsEl.querySelector(":scope > .jt-more");
        if (moreLi) moreLi.remove();
        const end = Math.min(info.count, rendered + CHUNK);
        for (; rendered < end; rendered++){
          const childKey = objKeys ? objKeys[rendered] : rendered;
          kidsEl.appendChild(buildNode(childKey, objKeys ? value[childKey] : value[rendered], depth + 1));
        }
        if (rendered < info.count){
          const more = document.createElement("li"); more.className = "jt-more";
          const btn = document.createElement("button"); btn.type = "button"; btn.className = "jt-more-btn";
          btn.textContent = "나머지 " + (info.count - rendered).toLocaleString() + "개 보기";
          btn.addEventListener("click", appendChunk);
          more.appendChild(btn); kidsEl.appendChild(more);
        }
      };
      const setOpen = (next) => {
        open = next;
        if (open && !kidsEl){
          kidsEl = document.createElement("ul"); kidsEl.className = "jt-children";
          appendChunk(); li.appendChild(kidsEl);
        }
        if (kidsEl) kidsEl.hidden = !open;
        li.classList.toggle("jt-open", open);
        toggle.textContent = open ? "▾" : "▸";
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      };
      row.addEventListener("click", (e) => {
        if (e.target.closest(".jt-more-btn")) return;
        setOpen(!open);
      });
      li.__jtSetOpen = setOpen;         // 모두 펼치기/접기의 일괄 제어용
      if (depth === 0) setOpen(true);   // 최상위는 펼친 상태로 시작(자식들은 접힌 채 나열)
    }
    return li;
  };
  const wrap = document.createElement("div"); wrap.className = "json-tree"; wrap.tabIndex = -1;
  const rootUl = document.createElement("ul"); rootUl.className = "jt-children jt-root";
  rootUl.appendChild(buildNode(null, rootValue, 0));
  wrap.appendChild(rootUl);
  // 모두 펼치기: 펼치면서 새로 생기는 자식까지 반복 처리하되, 상한을 넘으면 멈추고 false 반환.
  // 300개 청크("나머지 N개 보기")는 자동으로 누르지 않는다 — 폭 넓은 배열은 사용자가 필요한 만큼만.
  wrap.jtExpandAll = () => {
    const start = nodeCount;
    for (;;){
      const closed = wrap.querySelectorAll(".jt-branch:not(.jt-open)");
      if (!closed.length) return true;
      for (const li of closed){
        if (nodeCount - start >= EXPAND_ALL_CAP) return false;
        if (li.__jtSetOpen) li.__jtSetOpen(true);
      }
    }
  };
  // 모두 접기: 초기 상태(최상위만 펼침)로 되돌린다.
  wrap.jtCollapseAll = () => {
    for (const li of wrap.querySelectorAll(".jt-branch.jt-open")){ if (li.__jtSetOpen) li.__jtSetOpen(false); }
    const rootLi = rootUl.firstElementChild;
    if (rootLi && rootLi.__jtSetOpen) rootLi.__jtSetOpen(true);
  };
  return wrap;
}

async function renderCode(file, host, ext, profile, runCtx){
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const text = smartDecodeText(sourceBytes).replace(/\r\n?/g, "\n");
  // 대용량/초장문 파일은 구문 강조(수십만 span 생성)를 생략하고 일반 텍스트로 → 렌더·전환 부담 감소
  const heavy = text.length > 300000 || /[^\n]{20000}/.test(text);
  const prof = heavy ? "text" : (profile || CODE_EXTS[ext] || "c");
  const lineCount = text.split("\n").length;
  const runnable = RUN_EXTS.has(ext);
  const ownerDoc = docs.find(d => d.el === host) || null;
  const effectiveRunCtx = {
    ...(ownerDoc && ownerDoc.archiveCtx ? { archiveCtx: ownerDoc.archiveCtx } : {}),
    ...(ownerDoc && ownerDoc.relPath ? { relPath: ownerDoc.relPath } : {}),
    ...(runCtx || {})
  };
  // 지난 실행에서 저장한 파일이면, 보관해 둔 저장 위치(핸들)를 복원 → 저장 시 위치 재선택 없이 같은 파일로
  if (runnable && ownerDoc && !ownerDoc.fsHandle && ownerDoc.workspacePath){
    loadFsHandle(ownerDoc.workspacePath).then(h => { if (h && !ownerDoc.fsHandle) ownerDoc.fsHandle = h; });
  }
  const outer = runnable ? document.createElement("div") : host;
  if (runnable) outer.className = "run-wrap";
  if (heavy){
    const note = document.createElement("div");
    note.className = "code-note";
    note.textContent = "큰 파일이라 구문 강조를 생략했어요 (" + (text.length/1048576).toFixed(1) + "MB · " + lineCount.toLocaleString() + "줄)";
    outer.appendChild(note);
  }

  if (!runnable){
    // 텍스트/코드: 기본은 읽기 전용, [✎ 편집] 토글로 편집기 전환 후 저장(원래 확장자 유지). 큰 파일은 읽기 전용 고정.
    const canEdit = !heavy;
    const saveName = (ownerDoc && ownerDoc.name) || (file && file.name) || ("문서." + (ext || "txt"));
    const jsonPretty = ext === "json";           // jsonc/json5 는 주석 때문에 JSON.parse 가 실패하므로 제외
    const isHtml = ext === "html" || ext === "htm" || ext === "xhtml";   // 소스 보기 ↔ 미리보기(렌더) 토글 대상
    let currentText = text;
    let prettyText = null;                        // null=원본 표시, 문자열=정렬본 표시(화면 전용 — 편집·저장은 항상 원본)
    let treeMode = false;                         // JSON 트리 보기(화면 전용). 편집·저장은 항상 원본 텍스트 기준
    let treeData = null, treeDataFor = null;      // JSON.parse 결과 캐시(같은 원문이면 재파싱 생략)
    let treeEl = null;                            // 현재 표시 중인 트리 요소(모두 펼치기/접기 버튼이 제어)
    let activeEditor = null, viewJumpTimer = 0;
    let findOnlyEdit = false;                     // Ctrl+H(찾기)로 편집 모드에 들어온 경우 — 찾기를 닫으면 보기로 복귀
    let viewMode = "";                            // "view"/"edit"/"preview" — 현재 표시 모드
    let openReadonlyFind = null;                  // 읽기 전용(대용량·편집 잠금) 찾기 바 열기 — showView 가 채운다

    const teardownActive = () => {
      clearTimeout(viewJumpTimer);
      const ed = activeEditor;
      if (ed){ try { ed.destroy(); } catch(_){} unregisterEditorFont(ed.host); activeEditor = null; }
      if (ownerDoc){ ownerDoc.codeViewer = null; if (ownerDoc.codeEditor && ownerDoc.codeEditor === ed) ownerDoc.codeEditor = null; }
    };

    const showView = () => {
      teardownActive(); host.innerHTML = ""; if (ownerDoc) ownerDoc.codeEditor = null;
      viewMode = "view"; openReadonlyFind = null;
      // 내용 검색 등에서 줄 이동이 예약돼 있으면 줄번호가 있는 코드 보기로 받는다.
      if (treeMode && ownerDoc && ownerDoc.pendingFocusLine) treeMode = false;
      if (canEdit || jsonPretty || isHtml){
        const bar = document.createElement("div"); bar.className = "text-view-bar";
        const name = document.createElement("span"); name.className = "text-view-name"; name.textContent = saveName;
        bar.appendChild(name);
        if (isHtml){
          const previewBtn = document.createElement("button"); previewBtn.type = "button"; previewBtn.className = "text-edit-btn";
          previewBtn.textContent = "미리보기"; previewBtn.title = "HTML을 실제 페이지로 렌더링해 보기";
          previewBtn.addEventListener("click", () => showPreview());
          bar.appendChild(previewBtn);
        }
        if (jsonPretty && !treeMode){
          const prettyBtn = document.createElement("button"); prettyBtn.type = "button"; prettyBtn.className = "text-edit-btn";
          prettyBtn.textContent = prettyText != null ? "원본대로" : "pretty";
          prettyBtn.title = prettyText != null ? "저장된 원본 그대로 보기"
            : "JSON을 들여쓰기로 정렬해 보기 (화면 표시만 바뀌고 파일은 그대로예요)";
          prettyBtn.addEventListener("click", () => {
            if (prettyText != null){ prettyText = null; showView(); return; }
            const result = prettyPrintJsonText(currentText);
            if (!result.ok){ toast("JSON을 정렬하지 못했어요: " + result.error, 4000); return; }
            prettyText = result.text; showView();
          });
          bar.appendChild(prettyBtn);
        }
        if (jsonPretty){
          const treeBtn = document.createElement("button"); treeBtn.type = "button"; treeBtn.className = "text-edit-btn";
          treeBtn.textContent = treeMode ? "코드 보기" : "트리 보기";
          treeBtn.title = treeMode ? "줄번호가 있는 코드 보기로 돌아가기"
            : "접고 펼치는 트리로 JSON 구조 살펴보기 (화면 표시만 바뀌고 파일은 그대로예요)";
          treeBtn.addEventListener("click", () => {
            if (treeMode){ treeMode = false; showView(); return; }
            if (treeDataFor !== currentText){
              try { treeData = JSON.parse(currentText); treeDataFor = currentText; }
              catch(e){ toast("JSON을 트리로 보지 못했어요: " + ((e && e.message) || e), 4000); return; }
            }
            treeMode = true; showView();
          });
          bar.appendChild(treeBtn);
          if (treeMode){
            const expandBtn = document.createElement("button"); expandBtn.type = "button"; expandBtn.className = "text-edit-btn";
            expandBtn.textContent = "모두 펼치기";
            expandBtn.title = "트리 전체를 펼쳐 보기 (구조가 아주 크면 일부까지만 펼쳐요)";
            expandBtn.addEventListener("click", () => {
              if (!treeEl || !treeEl.jtExpandAll) return;
              if (!treeEl.jtExpandAll()) toast("구조가 커서 10,000개까지만 펼쳤어요. 필요한 가지를 눌러 이어서 보세요.", 3500);
            });
            const collapseBtn = document.createElement("button"); collapseBtn.type = "button"; collapseBtn.className = "text-edit-btn";
            collapseBtn.textContent = "모두 접기";
            collapseBtn.title = "처음처럼 최상위만 남기고 모두 접기";
            collapseBtn.addEventListener("click", () => { if (treeEl && treeEl.jtCollapseAll) treeEl.jtCollapseAll(); });
            bar.append(expandBtn, collapseBtn);
          }
        }
        if (canEdit){
          const editBtn = document.createElement("button"); editBtn.type = "button"; editBtn.className = "text-edit-btn"; editBtn.textContent = "✎ 편집";
          editBtn.title = "이 파일을 편집하고 저장";
          editBtn.addEventListener("click", showEdit);
          bar.appendChild(editBtn);
        }
        host.appendChild(bar);
      }
      if (treeMode){
        treeEl = buildJsonTreeView(treeData);
        host.appendChild(treeEl);
        if (ownerDoc){
          // 트리에는 줄 개념이 없으므로, 줄 이동 요청이 오면 코드 보기로 전환한 뒤 넘긴다.
          ownerDoc.codeViewer = { focusLine: (line) => { treeMode = false; showView();
            if (ownerDoc.codeViewer && ownerDoc.codeViewer.focusLine) ownerDoc.codeViewer.focusLine(line); } };
        }
        return;
      }
      const viewText = prettyText != null ? prettyText : currentText;
      const allLines = viewText.split("\n");
      const lineN = allLines.length;
      const longLine = /[^\n]{2000}/.test(viewText);            // 초장문 단일 라인 → 줄바꿈으로 가로 레이아웃 폭발 회피
      const big = heavy || lineN > 6000;                       // 줄이 아주 많으면 청크 가상 렌더(보이는 부분만 레이아웃)
      const LINE_H = 19;                                       // 가상 스크롤 높이 추정용 대략 줄높이
      const wrap = document.createElement("div");
      wrap.className = "code-host code-host-readonly" + (longLine ? " is-wrapped" : "") + (big ? " code-chunked" : "");
      wrap.tabIndex = -1;
      let preRef = null;                                       // 비청크 모드의 pre(focusLine 정밀 계산용)
      const CHUNK = 500;
      const chunkStarts = [];                                  // 각 청크 첫 글자의 viewText 내 offset(단어 하이라이트용)
      const fillCode = (codeEl, txt) => { if (prof === "text") codeEl.textContent = txt; else codeEl.innerHTML = highlightCode(txt, prof); };
      if (big){
        let acc = 0;
        for (let s = 0; s < lineN; s += CHUNK){
          chunkStarts.push(acc);
          const slice = allLines.slice(s, s + CHUNK);
          const chunkText = slice.join("\n");
          const chunk = document.createElement("div"); chunk.className = "code-chunk";
          chunk.style.containIntrinsicSize = "auto " + (slice.length * LINE_H) + "px";   // 오프스크린이어도 스크롤 높이 유지
          const g = document.createElement("div"); g.className = "code-gutter";
          let nums = ""; for (let i = 0; i < slice.length; i++) nums += (s + i + 1) + "\n"; g.textContent = nums;
          const pre = document.createElement("pre"); pre.className = "code-pre";
          const code = document.createElement("code"); fillCode(code, chunkText); pre.appendChild(code);
          chunk.append(g, pre); wrap.appendChild(chunk);
          acc += chunkText.length + 1;                         // +1 = 청크 사이를 잇는 줄바꿈
        }
      } else {
        const gutter = document.createElement("div"); gutter.className = "code-gutter";
        let nums = ""; for (let i = 1; i <= lineN; i++) nums += i + "\n"; gutter.textContent = nums;
        const pre = document.createElement("pre"); pre.className = "code-pre"; preRef = pre;
        const code = document.createElement("code"); fillCode(code, viewText); pre.appendChild(code);
        wrap.append(gutter, pre);
      }
      const jump = document.createElement("div"); jump.className = "readonly-jump-line"; jump.hidden = true; jump.setAttribute("aria-hidden", "true");
      wrap.appendChild(jump);
      host.appendChild(wrap);
      // 청크(가상 렌더) 모드에서 대상 줄의 실제 top 을 실측한다. 추정 줄높이(LINE_H)와 청크별 pre 패딩 때문에
      // 줄이 내려갈수록 누적 오차가 생겨 노란 바가 실제 줄과 어긋나던 문제를 없앤다. 비청크 모드는 null 반환(아래 추정식이 이미 정확).
      let focusForcedChunk = null;
      const measureLineTop = (line) => {
        if (!chunkStarts.length) return null;
        const ci = Math.floor((line - 1) / CHUNK), li = (line - 1) % CHUNK;
        const chunkEl = wrap.querySelectorAll(".code-chunk")[ci];
        if (!chunkEl) return null;
        // 오프스크린 청크는 content-visibility:auto 라 실제 레이아웃이 없다 → 대상 청크만 강제로 레이아웃해 실측
        if (focusForcedChunk && focusForcedChunk !== chunkEl) focusForcedChunk.style.contentVisibility = "";
        chunkEl.style.contentVisibility = "visible"; focusForcedChunk = chunkEl;
        const pre = chunkEl.querySelector("pre"), cs = pre && getComputedStyle(pre);
        const lh = (cs && parseFloat(cs.lineHeight)) || LINE_H;
        const padTop = (cs && parseFloat(cs.paddingTop)) || 16;
        const wr = wrap.getBoundingClientRect(), cr = chunkEl.getBoundingClientRect();
        return { top: (cr.top - wr.top + wrap.scrollTop) + padTop + li * lh, lh };   // 청크 top(실측) + 청크 안 상대 위치
      };
      const focusLine = (line, opts) => {
        line = Math.max(1, Math.min(lineN, parseInt(line, 10) || 1));
        let lineHeight = LINE_H, paddingTop = 16;
        if (preRef){ const cs = getComputedStyle(preRef); lineHeight = parseFloat(cs.lineHeight) || lineHeight; paddingTop = parseFloat(cs.paddingTop) || paddingTop; }
        const estTop = paddingTop + (line - 1) * lineHeight;
        // 찾기 바에서 호출할 땐 포커스를 뺏지 않는다 → 입력창에서 Enter 로 계속 다음 이동 가능
        if (!(opts && opts.noWrapFocus)){ try { wrap.focus({ preventScroll:true }); } catch(_) { wrap.focus(); } }
        // 찾기(noBar)는 placeRoHit 이 실제 단어에 상자를 씌워 정밀 배치하므로, 여기선 기존 추정 스크롤만 하고 줄 전체 노란 바는 생략.
        if (opts && opts.noBar){
          wrap.scrollTop = Math.max(0, estTop - wrap.clientHeight * 0.35);
          jump.style.top = estTop + "px"; jump.style.height = lineHeight + "px"; jump.hidden = true;
          return;
        }
        // 내용검색 클릭 등 일반 점프: 청크 모드는 실측 위치로 정확히 배치. 스크롤 후 이웃 청크 재렌더로 밀리면 다음 프레임에 보정.
        const place = () => {
          const m = measureLineTop(line);
          const top = m ? m.top : estTop, lh = m ? m.lh : lineHeight;
          wrap.scrollTop = Math.max(0, top - wrap.clientHeight * 0.35);
          jump.style.top = top + "px"; jump.style.height = lh + "px";
        };
        place();
        if (chunkStarts.length) requestAnimationFrame(place);
        jump.hidden = false; clearTimeout(viewJumpTimer); viewJumpTimer = setTimeout(() => { jump.hidden = true; }, 2400);
      };
      const flashJumpBar = () => { jump.hidden = false; clearTimeout(viewJumpTimer); viewJumpTimer = setTimeout(() => { jump.hidden = true; }, 2400); };
      if (ownerDoc){
        ownerDoc.codeViewer = { focusLine };
        if (ownerDoc.pendingFocusLine){
          const line = ownerDoc.pendingFocusLine; ownerDoc.pendingFocusLine = 0;
          requestAnimationFrame(() => { if (ownerDoc.codeViewer) ownerDoc.codeViewer.focusLine(line); });
        }
      }
      // 편집 잠금(대용량) 파일용 읽기 전용 찾기 바 — 문자열에서 찾아 해당 줄로 점프·강조(Ctrl+H 로 연다).
      if (!canEdit){
        const roFind = document.createElement("div"); roFind.className = "ro-find"; roFind.hidden = true;
        const roInput = document.createElement("input"); roInput.type = "text"; roInput.className = "ro-find-input";
        roInput.placeholder = "찾기 (대용량 문서)"; roInput.setAttribute("aria-label", "문서에서 찾기");
        const roCount = document.createElement("span"); roCount.className = "ro-find-count";
        const roPrev = document.createElement("button"); roPrev.type = "button"; roPrev.className = "text-edit-btn"; roPrev.textContent = "↑"; roPrev.title = "이전 (Shift+Enter)";
        const roNext = document.createElement("button"); roNext.type = "button"; roNext.className = "text-edit-btn"; roNext.textContent = "↓"; roNext.title = "다음 (Enter)";
        const roClose = document.createElement("button"); roClose.type = "button"; roClose.className = "text-edit-btn"; roClose.textContent = "✕"; roClose.title = "닫기 (Esc)";
        roFind.append(roInput, roCount, roPrev, roNext, roClose);
        host.insertBefore(roFind, host.firstChild);
        let roMatches = [], roIdx = -1, roHay = null;
        const roHit = document.createElement("div"); roHit.className = "ro-find-hit"; roHit.hidden = true; wrap.appendChild(roHit);
        const roCompute = () => {
          roMatches = []; roIdx = -1; roHit.hidden = true;
          const q = roInput.value;
          if (q){
            if (roHay === null) roHay = viewText.toLowerCase();   // 통째 소문자 변환은 이 보기에서 1회만
            const hay = roHay, needle = q.toLowerCase();
            let idx = 0, from = 0, line = 1, scan = 0;
            while ((idx = hay.indexOf(needle, from)) !== -1){
              for (; scan < idx; scan++) if (viewText.charCodeAt(scan) === 10) line++;
              roMatches.push({ line, idx });                     // 줄뿐 아니라 글자 위치(idx)도 저장 → 단어 강조
              from = idx + Math.max(1, needle.length);
              if (roMatches.length >= 5000) break;   // 초대용량 보호
            }
          }
          roCount.textContent = roInput.value ? (roMatches.length ? (roMatches.length + "개") : "없음") : "";
        };
        // 점프한 줄에서 실제 일치한 '단어'에 상자를 씌우고, 그 실측 위치로 정확히 스크롤한다.
        // 추정 줄높이(LINE_H)로 스크롤하면 아래쪽 줄일수록 누적 오차로 단어가 화면 밖에 놓여 안 보였다.
        // → 대상 청크를 강제로 레이아웃(content-visibility) 후 Range 로 실측해 배치·스크롤한다.
        let roForcedChunk = null;
        const placeRoHit = (m, len) => {
          roHit.hidden = true;
          if (!chunkStarts.length || len <= 0) return false;
          const ci = Math.floor((m.line - 1) / CHUNK);
          const chunkEl = wrap.querySelectorAll(".code-chunk")[ci];
          const codeEl = chunkEl && chunkEl.querySelector("code");
          const textNode = codeEl && codeEl.firstChild;
          if (!textNode || textNode.nodeType !== 3) return false;   // heavy 파일은 prof "text" 라 단일 텍스트 노드
          const start = m.idx - chunkStarts[ci], end = start + len;
          if (start < 0 || end > (textNode.nodeValue || "").length) return false;
          // 가상 렌더(content-visibility:auto) 청크는 오프스크린이면 측정 불가 → 이 청크만 강제로 레이아웃
          if (roForcedChunk && roForcedChunk !== chunkEl) roForcedChunk.style.contentVisibility = "";
          chunkEl.style.contentVisibility = "visible"; roForcedChunk = chunkEl;
          try {
            const range = document.createRange();
            range.setStart(textNode, start); range.setEnd(textNode, end);
            const r = range.getBoundingClientRect();
            const wr = wrap.getBoundingClientRect();
            if ((!r.width && !r.height)) return false;
            const cTop = r.top - wr.top + wrap.scrollTop;          // 스크롤과 무관한 콘텐츠 좌표(정확)
            const cLeft = r.left - wr.left + wrap.scrollLeft;
            roHit.style.left = cLeft + "px"; roHit.style.top = cTop + "px";
            roHit.style.width = r.width + "px"; roHit.style.height = r.height + "px";
            roHit.hidden = false;
            wrap.scrollTop = Math.max(0, cTop - wrap.clientHeight * 0.4);   // 실측 위치로 스크롤 → 항상 화면에
            // 가로도 실측 위치로 보정 — 긴 줄에서 검색어가 오른쪽 화면 밖으로 잘려 안 보이던 문제.
            // 줄바꿈(is-wrapped) 모드는 가로 스크롤 자체가 없어 건너뛰고, 이미 보이는 단어는 가만 둔다.
            if (!wrap.classList.contains("is-wrapped")){
              const view = wrap.clientWidth, pad = Math.min(80, view * 0.25);   // 왼쪽 pad ≈ 고정 거터 + 여유
              if (cLeft < wrap.scrollLeft + pad || cLeft + r.width > wrap.scrollLeft + view - pad)
                wrap.scrollLeft = Math.max(0, cLeft - view * 0.4);
            }
            return true;
          } catch(_){ return false; }
        };
        const roGo = (delta) => {
          if (!roMatches.length) return;
          roIdx = (roIdx + delta + roMatches.length) % roMatches.length;
          roCount.textContent = (roIdx + 1) + "/" + roMatches.length;
          const m = roMatches[roIdx], len = roInput.value.length;
          focusLine(m.line, { noWrapFocus: true, noBar: true }); // 포커스 유지 + 줄 전체 노란 바 생략(단어 상자로 대체)
          // 스크롤/레이아웃 반영 후 실측·배치. 이웃 청크가 실제 높이로 재렌더되며 밀릴 수 있어 한 번 더 보정.
          requestAnimationFrame(() => {
            if (!placeRoHit(m, len)){ flashJumpBar(); return; }
            requestAnimationFrame(() => placeRoHit(m, len));
          });
        };
        roInput.addEventListener("input", () => { roCompute(); if (roMatches.length){ roIdx = -1; roGo(1); } });
        roInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter"){ e.preventDefault(); roGo(e.shiftKey ? -1 : 1); }
          else if (e.key === "Escape"){ e.preventDefault(); roClose.click(); }
        });
        roPrev.addEventListener("click", () => { roGo(-1); roInput.focus(); });
        roNext.addEventListener("click", () => { roGo(1); roInput.focus(); });
        roClose.addEventListener("click", () => { roFind.hidden = true; roHit.hidden = true;
          if (roForcedChunk){ roForcedChunk.style.contentVisibility = ""; roForcedChunk = null; }   // 강제 레이아웃 원복
          try { wrap.focus(); } catch(_){} });
        openReadonlyFind = (seedText) => {
          roFind.hidden = false;
          if (seedText && seedText !== roInput.value){ roInput.value = seedText; roCompute(); if (roMatches.length){ roIdx = -1; roGo(1); } }
          roInput.focus(); roInput.select();
          if (roInput.value && !roMatches.length) roCompute();
        };
      }
    };

    const showEdit = () => {
      teardownActive(); host.innerHTML = "";
      viewMode = "edit"; openReadonlyFind = null;
      prettyText = null; treeMode = false;   // 편집·저장은 항상 원본 텍스트 기준 — 표시 전용 정렬·트리 상태는 해제
      const startedForFind = findOnlyEdit; findOnlyEdit = false;
      // 찾기(Ctrl+H)만 하러 들어온 편집 모드면, 찾기를 닫을 때 아직 수정 전이면 보기로 되돌린다.
      const editorOpts = startedForFind ? { onFindClose: () => {
        if (ownerDoc && ownerDoc.hasUnsavedEdits) return;   // 편집을 시작했으면 그대로 편집 유지
        currentText = editor.getValue(); showView();
      } } : {};
      const editor = buildCodeEditor(currentText, prof, editorOpts); activeEditor = editor;
      if (ownerDoc) ownerDoc.codeEditor = editor;
      const bar = document.createElement("div"); bar.className = "run-bar text-edit-bar";
      const saveBtn = document.createElement("button"); saveBtn.type = "button"; saveBtn.className = "run-save"; saveBtn.textContent = "저장";
      saveBtn.dataset.shortcutAction = "saveCurrent"; saveBtn.dataset.shortcutTitle = "파일 저장";
      const viewBtn = document.createElement("button"); viewBtn.type = "button"; viewBtn.className = "run-revert"; viewBtn.textContent = "보기로"; viewBtn.disabled = false;
      const fontDown = document.createElement("button"); fontDown.type = "button"; fontDown.className = "run-font"; fontDown.textContent = "A−"; fontDown.title = "글자 작게 (Ctrl+−)";
      const fontUp = document.createElement("button"); fontUp.type = "button"; fontUp.className = "run-font"; fontUp.textContent = "A+"; fontUp.title = "글자 크게 (Ctrl++)";
      fontDown.addEventListener("click", () => bumpCodeFont(-1)); fontUp.addEventListener("click", () => bumpCodeFont(1));
      const status = document.createElement("span"); status.className = "run-status";
      bar.append(saveBtn, viewBtn, fontDown, fontUp, status);
      host.appendChild(bar); host.appendChild(editor.host);
      if (typeof syncShortcutHints === "function") syncShortcutHints(bar);
      registerEditorFont(editor.host);
      const markDirty = () => { currentText = editor.getValue(); const dirty = currentText !== (ownerDoc && typeof ownerDoc.savedText === "string" ? ownerDoc.savedText : text); status.textContent = dirty ? "저장 안 됨" : ""; if (ownerDoc){ ownerDoc.hasUnsavedEdits = dirty; updateDocumentStatus(ownerDoc); } };
      editor.ta.addEventListener("input", markDirty);
      editor.ta.addEventListener("keydown", (e) => {
        if (shortcutMatches(e, "saveCurrent")){ e.preventDefault(); saveBtn.click(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(1); }
        else if ((e.ctrlKey || e.metaKey) && e.key === "-"){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(-1); }
      });
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        try { const ok = await saveTextDoc(editor.getValue(), ownerDoc, saveName); if (ok){ currentText = editor.getValue(); status.textContent = "저장됨"; if (ownerDoc){ ownerDoc.hasUnsavedEdits = false; updateDocumentStatus(ownerDoc); } } }
        finally { saveBtn.disabled = false; }
      });
      viewBtn.addEventListener("click", () => { currentText = editor.getValue(); showView(); });
      requestAnimationFrame(() => editor.ta.focus());
    };

    // HTML 미리보기: 소스 대신 기존 렌더러(샌드박스 iframe + 옆 리소스 인라인 + 링크 이동)로 실제 페이지를 보여준다.
    const showPreview = () => {
      teardownActive(); host.innerHTML = "";
      viewMode = "preview"; openReadonlyFind = null;
      if (ownerDoc){ ownerDoc.codeViewer = null; ownerDoc.codeEditor = null; }
      const bar = document.createElement("div"); bar.className = "text-view-bar";
      const name = document.createElement("span"); name.className = "text-view-name"; name.textContent = saveName;
      const srcBtn = document.createElement("button"); srcBtn.type = "button"; srcBtn.className = "text-edit-btn";
      srcBtn.textContent = "소스코드"; srcBtn.title = "HTML 원문(소스) 보기";
      srcBtn.addEventListener("click", () => showView());
      bar.append(name, srcBtn);
      host.appendChild(bar);
      renderHtmlFile(file, host, effectiveRunCtx);
    };

    // 보기에서 마우스로 선택한 텍스트를 검색어 시드로 가져온다(이 문서 안의 선택일 때만, 한 줄·200자 이내).
    const getDocFindSeed = () => {
      try {
        const s = window.getSelection && window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) return "";
        if (!host.contains(s.anchorNode) || !host.contains(s.focusNode)) return "";
        const t = String(s).replace(/\s+/g, " ").trim();
        return (t && t.length <= 200) ? t : "";
      } catch(_){ return ""; }
    };
    // Ctrl+H(문서 안에서 찾기): 이미 편집 중이면 바로 찾기, 읽기 전용 보기면 편집 모드로 전환 후 찾기(닫으면 보기 복귀).
    const openDocFind = () => {
      const seed = getDocFindSeed();                  // 편집/DOM 전환 전에 선택어를 먼저 붙잡는다
      if (activeEditor && typeof activeEditor.openFind === "function"){ activeEditor.openFind(seed); return; }
      if (canEdit){                                   // 편집 가능한 파일: 에디터 찾기(글자 단위 하이라이트)
        findOnlyEdit = true;
        showEdit();
        requestAnimationFrame(() => { if (activeEditor && typeof activeEditor.openFind === "function") activeEditor.openFind(seed); });
        return;
      }
      // 편집 잠금(대용량) 파일: 읽기 전용 찾기 바(문자열 검색 + 줄 점프)
      if (viewMode === "view" && typeof openReadonlyFind === "function"){ openReadonlyFind(seed); return; }
      showView();   // 미리보기 등 다른 모드였으면 읽기 전용 보기로 전환 후 연다
      requestAnimationFrame(() => { if (typeof openReadonlyFind === "function") openReadonlyFind(seed); });
    };
    if (ownerDoc) ownerDoc.openDocFind = openDocFind;

    if (ownerDoc){ if (!ownerDoc.cleanupFns) ownerDoc.cleanupFns = []; ownerDoc.cleanupFns.push(teardownActive); }
    (canEdit && ownerDoc && ownerDoc.isScratch ? showEdit : showView)();
    return;
  }

  // ── 실행 가능한 코드(.py): 편집 가능한 에디터 + 실행 바 + 좌(에디터)·우(출력) 분할 ──
  const draftKey = pythonDraftKey(file, ownerDoc, effectiveRunCtx);
  const sourceFingerprint = fingerprintBytes((file && file.name) || "code.py", sourceBytes);
  const restoredDraft = loadPythonDraft(draftKey, sourceFingerprint);
  const editor = buildCodeEditor(restoredDraft === null ? text : restoredDraft, prof);
  let savedValue = text;
  if (ownerDoc && typeof ownerDoc.savedText !== "string") ownerDoc.savedText = text;

  const bar = document.createElement("div"); bar.className = "run-bar";
  const runBtn = document.createElement("button"); runBtn.className = "run-go"; runBtn.type = "button"; runBtn.textContent = "▶";
  runBtn.dataset.shortcutAction = "runCode"; runBtn.dataset.shortcutTitle = "실행"; runBtn.dataset.shortcutAria = "true";
  const traceBtn = document.createElement("button"); traceBtn.className = "run-trace"; traceBtn.type = "button"; traceBtn.textContent = "단계 실행";
  traceBtn.title = "코드를 실행하며 줄별 변수 변화를 최대 300단계까지 기록";
  const analyzeBtn = document.createElement("button"); analyzeBtn.className = "run-analyze"; analyzeBtn.type = "button"; analyzeBtn.textContent = "진단";
  analyzeBtn.title = "코드를 실행하지 않고 문법과 자주 생기는 실수를 검사";
  const gradeBtn = document.createElement("button"); gradeBtn.className = "run-grade"; gradeBtn.type = "button"; gradeBtn.textContent = "채점";
  gradeBtn.title = "입력값과 기대 출력을 기준으로 현재 코드를 자동 채점";
  const saveBtn = document.createElement("button"); saveBtn.className = "run-save"; saveBtn.type = "button"; saveBtn.textContent = ".py 저장";
  saveBtn.dataset.shortcutAction = "saveCurrent"; saveBtn.dataset.shortcutTitle = "Python 파일 저장";
  const revertBtn = document.createElement("button"); revertBtn.className = "run-revert"; revertBtn.type = "button"; revertBtn.textContent = "↩ 원본"; revertBtn.title = "편집 전 원본 코드로 되돌리기"; revertBtn.disabled = true;
  const pkgBtn = document.createElement("button"); pkgBtn.className = "run-pkg"; pkgBtn.type = "button"; pkgBtn.textContent = "라이브러리"; pkgBtn.hidden = true;
  const diagBtn = document.createElement("button"); diagBtn.className = "run-diag"; diagBtn.type = "button"; diagBtn.textContent = "Py Env"; diagBtn.title = "Python 실행 환경 진단";
  const nbConvertBtn = document.createElement("button"); nbConvertBtn.className = "run-nbconvert"; nbConvertBtn.type = "button"; nbConvertBtn.textContent = "노트북으로";
  nbConvertBtn.title = "현재 코드를 주피터 노트북(.ipynb)으로 변환해 새 탭으로 열기 (# %% 를 셀 경계로)";
  // 줄번호(거터)를 클릭해 셀 경계(# %%)를 넣고, 다시 눌러 노트북으로 변환하는 모드 토글
  const cellSplitBtn = document.createElement("button"); cellSplitBtn.className = "run-cellsplit"; cellSplitBtn.type = "button"; cellSplitBtn.textContent = "✂ 셀 나누기";
  cellSplitBtn.title = "줄번호(왼쪽)를 클릭해 셀 경계(# %%)를 넣/빼고, 다시 눌러 노트북으로 변환";
  const autoSplitBtn = document.createElement("button"); autoSplitBtn.className = "run-autosplit"; autoSplitBtn.type = "button"; autoSplitBtn.textContent = "자동분할";
  autoSplitBtn.title = "빈 줄 뒤 최상위 문장마다 셀 경계(# %%)를 자동으로 넣기";
  const nbConvertMore = document.createElement("button");
  nbConvertMore.className = "run-nbconvert-more"; nbConvertMore.type = "button"; nbConvertMore.textContent = "▾";
  nbConvertMore.title = "노트북 변환 방법"; nbConvertMore.setAttribute("aria-label", nbConvertMore.title);
  nbConvertMore.setAttribute("aria-haspopup", "menu"); nbConvertMore.setAttribute("aria-expanded", "false");
  const nbConvertMenu = document.createElement("span");
  nbConvertMenu.className = "run-nbconvert-menu"; nbConvertMenu.hidden = true; nbConvertMenu.setAttribute("role", "menu");
  cellSplitBtn.setAttribute("role", "menuitem"); autoSplitBtn.setAttribute("role", "menuitem");
  nbConvertMenu.append(cellSplitBtn, autoSplitBtn);
  const nbConvertGroup = document.createElement("span");
  nbConvertGroup.className = "run-nbconvert-group";
  nbConvertGroup.append(nbConvertBtn, nbConvertMore, nbConvertMenu);
  const clearBtn = document.createElement("button"); clearBtn.className = "run-clear"; clearBtn.type = "button"; clearBtn.textContent = "지우기"; clearBtn.hidden = true;
  const linkBtn = document.createElement("button"); linkBtn.className = "run-link"; linkBtn.type = "button"; linkBtn.textContent = "PDF에 핀";
  linkBtn.title = "현재 코드 줄을 PDF에 핀으로 연결";
  // 필기 버튼 — 누르면 편집 잠금 + 캔버스 오버레이가 한 번에 켜짐. 다시 누르면 둘 다 해제.
  const inkBtn = document.createElement("button"); inkBtn.className = "run-ink"; inkBtn.type = "button"; inkBtn.textContent = "✏️ 필기"; inkBtn.title = "코드 위에 필기 — 켜는 동안 편집 잠금";
  const status = document.createElement("span"); status.className = "run-status";
  const fontGroup = document.createElement("span"); fontGroup.className = "run-font-group";
  const fontDown = document.createElement("button"); fontDown.className = "run-font"; fontDown.type = "button"; fontDown.textContent = "A−"; fontDown.title = "코드·결과 글자 작게 (Ctrl+−)";
  const fontUp = document.createElement("button"); fontUp.className = "run-font"; fontUp.type = "button"; fontUp.textContent = "A+"; fontUp.title = "코드·결과 글자 크게 (Ctrl++)";
  fontDown.addEventListener("click", () => bumpCodeFont(-1));
  fontUp.addEventListener("click", () => bumpCodeFont(1));
  const fontPick = document.createElement("select"); fontPick.className = "run-font run-fontpick";
  fontPick.title = "코드 글꼴 (시스템에 설치된 monospace 폰트만 표시)"; fontPick.setAttribute("aria-label", fontPick.title);
  const installed = availableCodeFontChoices();
  // 저장된 폰트가 시스템에서 빠졌으면 기본으로 자동 폴백(드롭다운에 안 나타나는 옵션이 선택돼 보이는 혼란 방지).
  if (_codeFontFamily && !installed.some(c => c.value === _codeFontFamily)) setCodeFontFamily("");
  for (const c of installed){ const o = document.createElement("option"); o.value = c.value; o.textContent = c.label; if (c.value === _codeFontFamily) o.selected = true; fontPick.appendChild(o); }
  fontPick.addEventListener("change", () => setCodeFontFamily(fontPick.value));
  // 후보가 기본 하나뿐이면(설치된 게 없으면) 드롭다운 자체를 숨겨 자리만 차지하지 않게 한다.
  if (installed.length <= 1) fontPick.hidden = true;
  fontGroup.append(fontDown, fontUp, fontPick);
  // 편집 흐름상 "고치다가 새로 열기"가 잦아서, 글자 크기 옆에 새 파이썬 코드 버튼을 둔다(사이드바 버튼은 그대로).
  const inFolder = !!(ownerDoc && ownerDoc.archiveCtx && runPathDir(normalizedRunPath(ownerDoc.relPath || ownerDoc.workspacePath || "")));
  const newPyTitle = inFolder ? "이 폴더에 새 파이썬 파일 · 같은 폴더 모듈 import 가능" : "새 파이썬 코드";
  const newPyBtn = document.createElement("button"); newPyBtn.className = "run-newpy"; newPyBtn.type = "button"; newPyBtn.textContent = "+Py";
  newPyBtn.dataset.shortcutAction = "newPython"; newPyBtn.dataset.shortcutTitle = newPyTitle; newPyBtn.dataset.shortcutAria = "true";
  newPyBtn.addEventListener("click", () => { if (typeof newPythonScratch === "function") newPythonScratch(); });
  // 실행 결과 위치 토글(편집기 옆 ↔ 아래) — 결과가 보일 때만 노출. 동작 연결은 split 생성 후(applyOutputLayout).
  const layoutBtn = document.createElement("button"); layoutBtn.className = "run-layout"; layoutBtn.type = "button"; layoutBtn.hidden = true;
  bar.appendChild(runBtn); bar.appendChild(traceBtn); bar.appendChild(analyzeBtn); bar.appendChild(gradeBtn); bar.appendChild(saveBtn); bar.appendChild(revertBtn); bar.appendChild(linkBtn); bar.appendChild(nbConvertGroup); bar.appendChild(inkBtn); bar.appendChild(pkgBtn); bar.appendChild(diagBtn); bar.appendChild(clearBtn); bar.appendChild(fontGroup); bar.appendChild(newPyBtn); bar.appendChild(layoutBtn); bar.appendChild(status);
  syncShortcutHints(bar);

  // 편집기 바로 위: 마지막으로 저장한 파일의 절대경로 표시. 저장 전엔 회색 안내문.
  const pathBar = document.createElement("div"); pathBar.className = "run-path";
  const pathText = document.createElement("span"); pathText.className = "run-path-text is-empty"; pathText.textContent = "저장하면 경로가 여기 표시됩니다";
  pathBar.append(pathText);
  const projectInfo = document.createElement("details"); projectInfo.className = "run-project-info";
  const projectSummary = document.createElement("summary"); projectSummary.textContent = "실행 작업폴더 · 실행 전";
  const projectBody = document.createElement("div"); projectBody.className = "run-project-body";
  projectInfo.append(projectSummary, projectBody);
  const projectRow = document.createElement("div"); projectRow.className = "run-project-row";
  const pathHelpBtn = document.createElement("button"); pathHelpBtn.type = "button"; pathHelpBtn.className = "run-path-help";
  pathHelpBtn.textContent = "경로 도우미"; pathHelpBtn.title = "파일 읽기·저장·import 경로를 현재 작업폴더 기준으로 확인";
  projectRow.append(projectInfo, pathHelpBtn);
  const pathHelpPanel = document.createElement("section"); pathHelpPanel.className = "py-path-help"; pathHelpPanel.hidden = true;
  outer.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !projectInfo.open) return;
    const focusWasInList = projectBody.contains(document.activeElement);
    e.preventDefault();
    e.stopPropagation();
    projectInfo.open = false;
    if (focusWasInList){
      try { projectSummary.focus({ preventScroll:true }); } catch(_) { projectSummary.focus(); }
    }
  }, true);
  // 작업폴더 패널이 열려 있을 때 바깥을 클릭하면 접는다(팝오버식). 열릴 때만 리스너를 달아 부담을 없앤다.
  // 드래그 복사 경로(pathText)는 이 패널 위쪽 pathBar 에 있어 접혀도 안 밀리므로 복사가 깨지지 않는다.
  let projectOutsideClose = null;
  projectInfo.addEventListener("toggle", () => {
    if (projectInfo.open){
      if (projectOutsideClose) return;
      projectOutsideClose = (e) => {
        if (!document.contains(projectInfo)){   // 뷰어가 교체돼 패널이 사라졌으면 리스너 정리(누수 방지)
          document.removeEventListener("pointerdown", projectOutsideClose, true); projectOutsideClose = null; return;
        }
        if (!projectInfo.contains(e.target)) projectInfo.open = false;
      };
      document.addEventListener("pointerdown", projectOutsideClose, true);
    } else if (projectOutsideClose){
      document.removeEventListener("pointerdown", projectOutsideClose, true); projectOutsideClose = null;
    }
  });
  const setSavedPath = (p) => {
    const savedAbsPath = p || "";
    if (savedAbsPath){
      pathText.textContent = savedAbsPath; pathText.title = "드래그해서 복사할 수 있습니다";
      pathText.classList.remove("is-empty");
    } else {
      pathText.textContent = "저장하면 경로가 여기 표시됩니다"; pathText.removeAttribute("title");
      pathText.classList.add("is-empty");
    }
  };
  if (ownerDoc && ownerDoc.workspacePath){
    setSavedPath(ownerDoc.workspacePath);
    displayPathForWorkspace(ownerDoc.workspacePath).then(p => {
      if (p && ownerDoc && ownerDoc.workspacePath) setSavedPath(p);
    });
  }
  // 라이브러리 설치 패널(설치된 로컬 파이썬에서만 노출) — 세트 설치 + 직접 입력
  const pkgWrap = document.createElement("div"); pkgWrap.className = "run-pkg-wrap"; pkgWrap.hidden = true;
  const mkSet = (label, pkgs) => { const b = document.createElement("button"); b.type = "button"; b.className = "pkg-set"; b.textContent = label; b.addEventListener("click", () => runPipInstall(pkgs, ui)); return b; };
  const pkgCustom = document.createElement("input"); pkgCustom.className = "pkg-custom"; pkgCustom.type = "text"; pkgCustom.placeholder = "직접 입력: requests pandas …";
  const pkgGo = document.createElement("button"); pkgGo.type = "button"; pkgGo.className = "pkg-go"; pkgGo.textContent = "설치";
  const doCustom = () => { const v = pkgCustom.value.trim(); if (v) runPipInstall(v.split(/[\s,]+/).filter(Boolean), ui); };
  pkgGo.addEventListener("click", doCustom);
  pkgCustom.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); doCustom(); } });
  const pkgList = document.createElement("button"); pkgList.type = "button"; pkgList.className = "pkg-set pkg-list"; pkgList.textContent = "설치된 목록"; pkgList.addEventListener("click", () => runPipList(ui));
  // requirements.txt 파일을 골라 적힌 라이브러리를 한 번에 설치
  const pkgFile = document.createElement("input"); pkgFile.type = "file"; pkgFile.accept = ".txt,.text,text/plain"; pkgFile.hidden = true;
  const pkgFileBtn = document.createElement("button"); pkgFileBtn.type = "button"; pkgFileBtn.className = "pkg-set pkg-file"; pkgFileBtn.textContent = "txt로 설치"; pkgFileBtn.title = "requirements.txt 등 라이브러리 목록 파일을 골라 한 번에 설치";
  pkgFileBtn.addEventListener("click", () => pkgFile.click());
  pkgFile.addEventListener("change", async () => {
    const f = pkgFile.files && pkgFile.files[0]; if (!f) return;
    let txt = "";
    try { txt = await f.text(); } catch(_){ toast("파일을 읽지 못했어요.", 3000); pkgFile.value = ""; return; }
    pkgFile.value = "";   // 같은 파일을 다시 고를 수 있게 초기화
    const pkgs = parseRequirements(txt);
    if (!pkgs.length){ toast("설치할 라이브러리를 찾지 못했어요. (빈 줄·주석만 있는 파일인가요?)", 4000); return; }
    if (pkgs.length > 40) toast("라이브러리가 " + pkgs.length + "개라 한 번에 40개까지만 설치돼요. 나머지는 파일을 나눠 설치해 주세요.", 6000);
    runPipInstall(pkgs.slice(0, 40), ui);
  });
  pkgWrap.append(mkSet("데이터 분석", ["matplotlib","openpyxl","seaborn","scipy"]), mkSet("크롤링", ["requests","beautifulsoup4","lxml"]), mkSet("DB(MySQL)", ["pymysql"]), pkgCustom, pkgGo, pkgFileBtn, pkgFile, pkgList);
  pkgBtn.addEventListener("click", () => { pkgWrap.hidden = !pkgWrap.hidden; });
  pythonBackendAvailable().then(ok => { if (ok) pkgBtn.hidden = false; });   // 로컬 파이썬일 때만

  diagBtn.addEventListener("click", () => openPythonEnvModal(diagBtn));
  refreshPythonEnvButton(diagBtn);

  const inputWrap = document.createElement("div"); inputWrap.className = "run-input-wrap";
  inputWrap.hidden = !usesInput(text);                  // input() 안 쓰면 숨김
  const inputLabel = document.createElement("label"); inputLabel.className = "run-input-label"; inputLabel.textContent = "입력값 (프로그램이 물어볼 값)";
  const inputFields = document.createElement("div"); inputFields.className = "run-input-fields"; inputFields.hidden = true;
  const inputHint = document.createElement("div"); inputHint.className = "run-input-hint"; inputHint.hidden = true;
  const stdin = document.createElement("textarea"); stdin.className = "run-stdin";
  stdin.placeholder = "input() 호출 순서대로 한 줄에 하나씩 적으세요. 예: 홍길동↵27↵1";
  inputWrap.append(inputLabel, inputFields, inputHint, stdin);

  const split = document.createElement("div"); split.className = "run-split";
  const divider = document.createElement("div"); divider.className = "run-divider";
  divider.setAttribute("role", "separator"); divider.setAttribute("aria-orientation", "vertical"); divider.tabIndex = 0;
  const outPanel = document.createElement("div"); outPanel.className = "code-output";
  split.append(editor.host, divider, outPanel);
  attachRunSplitter(split, divider);
  outer.appendChild(bar); outer.appendChild(pkgWrap); outer.appendChild(inputWrap); outer.appendChild(pathBar); outer.appendChild(projectRow); outer.appendChild(pathHelpPanel); outer.appendChild(split);
  host.appendChild(outer);

  const ui = { btn: runBtn, traceBtn, analyzeBtn, gradeBtn, status, outPanel, split, stdin, inputWrap, editorTa: editor.ta,
    projectInfo, projectSummary, projectBody, pathHelpBtn, pathHelpPanel };
  ui.openPathHelp = () => {
    pathHelpPanel.hidden = false;
    renderPythonPathHelper(pathHelpPanel, editor.getValue(), runCtxWithDoc, ui);
    pathHelpPanel.scrollIntoView({ block:"nearest", behavior:"smooth" });
  };
  pathHelpBtn.addEventListener("click", () => {
    if (pathHelpPanel.hidden) ui.openPathHelp();
    else pathHelpPanel.hidden = true;
  });
  ui.markError = (n) => editor.markError(n);                    // 실행 에러 줄 강조 / 해제(수정 시 자동 해제)
  ui.focusError = (n) => { editor.markError(n); editor.ta.focus(); };
  ui.focusLine = (n) => editor.focusLine(n);
  ui.showTraceLine = (n) => editor.showTraceLine(n);
  ui.clearTraceLine = () => editor.clearTraceLine();
  ui.focusErrorLocation = (fileBase, line) => {
    const target = docs.find((doc) => {
      const base = String(doc.workspacePath || doc.relPath || doc.name || "").replace(/\\/g, "/").split("/").pop();
      return base === fileBase && (doc.codeEditor || doc.codeViewer);
    });
    if (!target) return false;
    if (typeof setActiveDoc === "function") setActiveDoc(target.id);
    const navigator = target.codeEditor || target.codeViewer;
    if (navigator && navigator.focusLine) navigator.focusLine(line);
    else target.pendingFocusLine = line;
    return true;
  };
  ui.clearError = () => editor.clearError();
  // 에러 줄 매칭에 쓸 파일명(로컬 단일 실행은 script.py, 번들은 대상 파일 basename)
  ui.fileBase = String((effectiveRunCtx && effectiveRunCtx.relPath) || (file && file.name) || (ownerDoc && ownerDoc.name) || "").replace(/\\/g, "/").split("/").pop();
  const fromArchive = !!(effectiveRunCtx && effectiveRunCtx.archiveCtx && effectiveRunCtx.relPath);
  const runShortcutLabel = shortcutDisplay(shortcutValue("runCode"));
  const idleMsg = fromArchive ? "편집 후 " + runShortcutLabel + " 실행 · 옆 파일 포함" : "편집 후 " + runShortcutLabel + " 로 실행";
  status.textContent = restoredDraft === null ? idleMsg : "자동 복구된 편집본 · 저장하거나 원본으로 되돌리세요";
  // 실행 결과를 편집기 옆(가로) ↔ 아래(세로)로 토글. 선택은 저장되어 다음에 열 때도 유지.
  ui.layoutBtn = layoutBtn;
  let outputStacked = false;
  try { outputStacked = localStorage.getItem("pythonSplitDir") === "col"; } catch(e){}
  const applyOutputLayout = () => {
    split.classList.toggle("stack-v", outputStacked);
    divider.setAttribute("aria-orientation", outputStacked ? "horizontal" : "vertical");
    layoutBtn.textContent = outputStacked ? "Side" : "Below";
    layoutBtn.title = outputStacked ? "실행 결과를 편집기 오른쪽 옆으로" : "실행 결과를 편집기 아래로";
    layoutBtn.setAttribute("aria-label", layoutBtn.title);
  };
  layoutBtn.addEventListener("click", () => {
    outputStacked = !outputStacked;
    try { localStorage.setItem("pythonSplitDir", outputStacked ? "col" : "row"); } catch(e){}
    applyOutputLayout();
  });
  applyOutputLayout();
  // keepEditorFocus: Ctrl+Enter 로 실행하면 편집을 이어가도록 에디터에 커서를 유지(▶ 버튼 클릭은 평소대로 터미널로 포커스)
  const runCtxWithDoc = { ...(effectiveRunCtx || {}), ownerDoc };
  updateRunProjectPanel(ui, null, runCtxWithDoc);
  const isNotebook = !!(ownerDoc && ownerDoc.notebook);   // .ipynb 변환 문서는 셀 단위로 실행
  if (isNotebook){
    setupNotebookKernelBar(ownerDoc, editor, ui, outer, split);   // 셀 하나씩 실행하는 브라우저 커널 툴바
    // 이미 노트북 문서면 셀 나누기·자동분할은 의미 없으므로 감춘다(커널 바에서 셀을 직접 다룸).
    cellSplitBtn.hidden = true; autoSplitBtn.hidden = true; nbConvertMore.hidden = true;
    // 노트북에선 커널 바가 주 동작이므로, 전체 실행용 보조 버튼을 폭넓게 접는다(기본 접힘).
    collapseRunButtons(bar, [traceBtn, analyzeBtn, gradeBtn, linkBtn, nbConvertGroup, diagBtn], "nbRunMore");
  } else {
    // 일반 Python: 노트북 변환 계열은 한 드롭다운으로 묶고, 다른 보조 도구와 함께 '⋯ 더보기'로 접는다.
    collapseRunButtons(bar, [traceBtn, analyzeBtn, gradeBtn, linkBtn, nbConvertGroup, diagBtn], "pyRunMore");
  }
  const run = (keepEditorFocus) => runPythonSource(editor.getValue(), ui, runCtxWithDoc, keepEditorFocus === true, isNotebook ? { notebookCells: true } : undefined);
  ui.rerun = () => run(false);                 // 대화형 터미널의 ↻ 재실행 버튼이 호출(▶ 버튼과 동일)
  runBtn.addEventListener("click", () => {
    if (typeof ui.cancelRun === "function") ui.cancelRun();
    else run(false);
  });
  traceBtn.addEventListener("click", () => runPythonSource(editor.getValue(), ui, runCtxWithDoc, false, { traceMode:true }));
  analyzeBtn.addEventListener("click", () => runPythonSource(editor.getValue(), ui, runCtxWithDoc, false, { diagnoseMode:true }));
  gradeBtn.addEventListener("click", () => openAssignmentGradingModal({
    storageKey: "pdf-signer-python-grade:" + draftKey.slice(PY_DRAFT_PREFIX.length),
    onRun: (tests) => runPythonSource(editor.getValue(), ui, runCtxWithDoc, false, { gradeTests:tests })
  }));
  linkBtn.addEventListener("click", () => {
    if (typeof createCodeLinkFromCodeDoc === "function") createCodeLinkFromCodeDoc(ownerDoc);
  });
  const closeNbConvertMenu = () => {
    nbConvertMenu.hidden = true;
    nbConvertMore.setAttribute("aria-expanded", "false");
  };
  nbConvertMore.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = nbConvertMenu.hidden;
    nbConvertMenu.hidden = !open;
    nbConvertMore.setAttribute("aria-expanded", String(open));
  });
  const onNbConvertOutside = (event) => {
    if (!nbConvertGroup.contains(event.target)) closeNbConvertMenu();
  };
  const onNbConvertEscape = (event) => {
    if (event.key !== "Escape") return;
    if (editor.isCellSplitMode && editor.isCellSplitMode()){
      event.preventDefault(); event.stopPropagation();
      cancelCellSplit();
      editor.ta.focus();
      return;
    }
    if (!nbConvertMenu.hidden){
      event.preventDefault(); closeNbConvertMenu(); nbConvertMore.focus();
    }
  };
  document.addEventListener("click", onNbConvertOutside);
  document.addEventListener("keydown", onNbConvertEscape, true);
  if (ownerDoc && Array.isArray(ownerDoc.cleanupFns)){
    ownerDoc.cleanupFns.push(() => {
      document.removeEventListener("click", onNbConvertOutside);
      document.removeEventListener("keydown", onNbConvertEscape, true);
    });
  }
  // 셀 나누기 모드에서는 진입 직전 코드를 보관한다. 취소하면 # %% 추가를 포함한 편집을 원본으로 되돌린다.
  let cellSplitSnapshot = null;
  const exitCellSplit = (restore) => {
    if (restore && cellSplitSnapshot !== null && editor.getValue() !== cellSplitSnapshot){
      editor.setValue(cellSplitSnapshot);
    }
    editor.setCellSplitMode(false);
    cellSplitBtn.classList.remove("is-active");
    cellSplitBtn.textContent = "✂ 셀 나누기";
    cellSplitBtn.title = "줄번호(왼쪽)를 클릭해 셀 경계(# %%)를 넣/빼고, 분할 완료로 노트북 변환";
    nbConvertBtn.textContent = "노트북으로";
    nbConvertBtn.classList.remove("is-active");
    nbConvertBtn.title = "현재 코드를 주피터 노트북(.ipynb)으로 변환해 새 탭으로 열기 (# %% 를 셀 경계로)";
    cellSplitSnapshot = null;
  };
  const cancelCellSplit = () => {
    if (!(editor.isCellSplitMode && editor.isCellSplitMode())) return;
    exitCellSplit(true);
    if (typeof toast === "function") toast("셀 나누기를 취소하고 시작 전 코드로 되돌렸어요.", 2600);
  };
  nbConvertBtn.addEventListener("click", () => {
    if (editor.isCellSplitMode && editor.isCellSplitMode()) exitCellSplit(false);
    convertPyEditorToNotebook(editor.getValue(), ownerDoc);
  });
  cellSplitBtn.addEventListener("click", () => {
    closeNbConvertMenu();
    if (editor.isCellSplitMode && editor.isCellSplitMode()){
      cancelCellSplit();
      return;
    }
    cellSplitSnapshot = editor.getValue();
    const splitReadyValue = ensureFirstNotebookCellMarker(cellSplitSnapshot);
    if (splitReadyValue !== cellSplitSnapshot) editor.setValue(splitReadyValue);
    editor.setCellSplitMode(true);
    cellSplitBtn.classList.add("is-active");
    cellSplitBtn.textContent = "× 셀 나누기 취소";
    cellSplitBtn.title = "셀 나누기를 취소하고 시작 전 코드로 복원";
    nbConvertBtn.textContent = "✓ 분할 완료";
    nbConvertBtn.classList.add("is-active");
    nbConvertBtn.title = "셀 경계 편집을 마치고 노트북으로 변환";
    if (typeof toast === "function") toast("줄번호를 클릭해 셀 경계를 조정하세요. '분할 완료'는 변환, Esc는 취소입니다.", 4600);
  });
  autoSplitBtn.addEventListener("click", () => {
    closeNbConvertMenu();
    const changed = editor.autoSplitCells && editor.autoSplitCells();
    if (typeof toast === "function") toast(changed
      ? "빈 줄 기준으로 셀 경계(# %%)를 넣었어요. 필요하면 거터 클릭으로 조정하세요."
      : "추가할 경계가 없어요(이미 나뉘었거나 빈 줄 구분이 없음).", 3600);
  });
  saveBtn.addEventListener("click", async () => {
    const value = editor.getValue();
    let name = (ownerDoc && ownerDoc.name) || (file && file.name) || "practice.py";
    const diagnoseAfterSave = saveBtn.dataset.diagnoseAfterSave === "1";
    delete saveBtn.dataset.diagnoseAfterSave;
    const startDiagnosis = () => {
      if (!diagnoseAfterSave) return;
      // 저장 이벤트를 먼저 끝내 버튼 상태와 저장 경로 UI를 정리한 뒤, 방금 저장한 코드로 진단한다.
      setTimeout(() => runPythonSource(value, ui, runCtxWithDoc, false, { diagnoseMode:true }), 0);
    };
    saveBtn.disabled = true;
    let persisted = false;
    const saveToOriginal = !!(ownerDoc && ownerDoc.originalSaveMode);
    try {
      // 0) exe 로컬 서버가 있으면 브라우저 권한 팝업 없이 서버로 바로 저장(내 문서\만능교실 저장).
      if (!saveToOriginal && await saveFileBackendAvailable()){
        // 새로 만든(스크래치) 파일의 첫 저장은 이름을 받는다(서버 저장은 위치 선택 창이 없으므로).
        if (ownerDoc && ownerDoc.isScratch && !ownerDoc._named){
          const base = String(ownerDoc.name || name).replace(/\.py$/i, "");
          const typed = await askText({ title: "새 파일 저장", message: "저장할 파일 이름을 정하세요.",
            placeholder: "예: 연습", value: base, okText: "저장" });
          if (typed === null) return;                            // 취소 → 저장 안 함
          let fname = String(typed).trim().replace(/[\\/:*?"<>|]/g, "").trim();   // 파일명 금지문자 제거
          if (!fname) fname = base || "새 코드";
          if (!/\.[A-Za-z0-9]+$/.test(fname)) fname += ".py";    // 확장자가 없으면 .py 붙임
          const currentPath = normalizedRunPath(ownerDoc.workspacePath || ownerDoc.relPath || "");
          const currentDir = runPathDir(currentPath);
          const nextPath = currentDir ? currentDir + "/" + fname : fname;
          ownerDoc.name = fname; ownerDoc.workspacePath = nextPath;
          if (ownerDoc.relPath || ownerDoc.archiveCtx) ownerDoc.relPath = nextPath;
          ownerDoc._named = true;
          name = fname;
          if (typeof state !== "undefined" && state === ownerDoc){
            const hdr = byId("activeFileName");
            if (hdr){ hdr.textContent = fname; const c = extCategory(ownerDoc.kind, fname); if (c) hdr.dataset.cat = c; }
          }
          if (typeof renderTabs === "function") renderTabs();
          renderSidebar();
        }
        const savedPath = await saveViaServer(value, ownerDoc, name);
        if (savedPath){
          if (ownerDoc){
            const effName = ownerDoc.name || name;
            let path = String(ownerDoc.workspacePath || effName).replace(/\\/g, "/").replace(/^\/+/, "");
            const updated = new File([value], effName, { type: "text/x-python;charset=utf-8" });
            if (path.indexOf("/") >= 0) Object.defineProperty(updated, "webkitRelativePath", { value: path });
            ownerDoc.workspacePath = path;
            ownerDoc.size = updated.size;
            ownerDoc.savedText = value;
            markDocumentSavedAsUtf8(ownerDoc, false);
            persisted = await rememberWorkspace([updated], false, { silent:true });     // 자동 복원용 작업공간 사본도 조용히 갱신
            ownerDoc.savedInWorkspace = persisted;
          }
          savedValue = value;
          clearPythonDraft(draftKey);
          if (ownerDoc) ownerDoc.hasUnsavedEdits = (editor.getValue() !== savedValue);
          if (ownerDoc) updateDocumentStatus(ownerDoc);
          renderSidebar();
          setSavedPath(savedPath);                 // 편집기 위 경로 줄에 절대경로 고정 표시
          toast("저장 완료 · " + savedPath, 3400, {
            type: "success",
            action: (typeof window !== "undefined" && typeof window.__mnOpenLastSavedFolder === "function")
              ? { label: "폴더 열기", onClick: () => window.__mnOpenLastSavedFolder() } : null
          });
          startDiagnosis();
          return;
        }
        // 서버 저장 실패 → 아래 기존 방식으로 폴백
      }
      // A) File System Access API 로 원본 파일에 바로 저장. 첫 저장에 위치를 한 번 고르고 핸들을 보관 → 이후엔 대화상자 없이 덮어쓰기.
      const wrote = await saveViaFileHandle(value, name, ownerDoc, { existingOnly: saveToOriginal });
      if (wrote === "cancelled") return;                  // 사용자가 위치 선택을 취소 → 아무 것도 안 함
      if (saveToOriginal && wrote !== "saved"){
        toast("원본 파일 쓰기 권한이 없어 저장하지 못했어요.", 3000, { type: "error" });
        return;
      }
      if (wrote === "unsupported") downloadTextFile(value, name);   // 미지원 브라우저/file:// → 기존 다운로드 폴백
      // 다른 이름으로 저장(파일 선택 창에서 새 이름 지정)했으면 사이드바·탭·헤더 이름을 새 파일명으로 갱신
      let renamedFrom = null;
      if (wrote === "saved" && ownerDoc && ownerDoc.fsHandle && ownerDoc.fsHandle.name && ownerDoc.fsHandle.name !== ownerDoc.name){
        renamedFrom = ownerDoc.name;
        ownerDoc.name = ownerDoc.fsHandle.name;
        if (typeof state !== "undefined" && state === ownerDoc){
          const hdr = byId("activeFileName"); if (hdr) hdr.textContent = ownerDoc.name;
        }
        if (typeof renderTabs === "function") renderTabs();
      }
      if (ownerDoc){
        const effName = ownerDoc.name || name;
        let path = String(ownerDoc.workspacePath || effName).replace(/\\/g, "/").replace(/^\/+/, "");
        if (renamedFrom){ const slash = path.lastIndexOf("/"); path = slash >= 0 ? path.slice(0, slash + 1) + effName : effName; }  // 폴더 경로면 마지막 이름만 교체
        const updated = new File([value], effName, { type: "text/x-python;charset=utf-8" });
        if (path.indexOf("/") >= 0) Object.defineProperty(updated, "webkitRelativePath", { value: path });
        const oldPath = ownerDoc.workspacePath;
        ownerDoc.workspacePath = path;
        ownerDoc.size = updated.size;
        ownerDoc.savedText = value;
        markDocumentSavedAsUtf8(ownerDoc, false);
        persisted = await rememberWorkspace([updated], false, { silent:true });
        ownerDoc.savedInWorkspace = persisted;
        if (renamedFrom && oldPath && oldPath !== path && typeof forgetWorkspacePaths === "function") forgetWorkspacePaths([oldPath]);  // 작업공간에 옛 이름이 중복으로 남지 않게
        // 저장 위치(핸들)를 경로 키로 보관 → 다음 실행 때 복원(위치 재선택 불필요). 이름이 바뀌었으면 옛 경로 핸들은 제거.
        if (wrote === "saved" && ownerDoc.fsHandle) saveFsHandle(path, ownerDoc.fsHandle);
        if (renamedFrom && oldPath && oldPath !== path) forgetFsHandle(oldPath);
      }
      savedValue = value;
      clearPythonDraft(draftKey);
      if (ownerDoc) ownerDoc.hasUnsavedEdits = (editor.getValue() !== savedValue);
      if (ownerDoc) updateDocumentStatus(ownerDoc);
      renderSidebar();
      // 폴백 환경(브라우저)은 보안상 절대경로를 알 수 없어 파일명만 표시
      setSavedPath(wrote === "saved" && ownerDoc && ownerDoc.fsHandle && ownerDoc.fsHandle.name
        ? ownerDoc.fsHandle.name : ((ownerDoc && ownerDoc.name) || name));
      if (fromArchive){
        // 압축(zip/tar) 안의 파일은 원본 압축을 다시 쓰지 않고 별도 파일로만 저장된다 — 혼동 없게 안내.
        toast(wrote === "saved"
          ? "압축 안의 파일이라 원본 zip이 아닌 별도 파일로 저장했어요."
          : "압축 안의 파일이라 원본 zip이 아닌 별도 .py로 저장했어요.", 3400, { type: "success" });
      } else {
        toast((wrote === "saved")
          ? (persisted ? "원본 파일에 저장하고 작업공간도 갱신했어요." : "원본 파일에 바로 저장했어요.")
          : (persisted ? "다운로드하고 왼쪽 작업공간에도 저장했어요." : "다운로드 사본을 저장했어요."), 2600, { type: "success" });
      }
      startDiagnosis();
    } finally { saveBtn.disabled = false; }
  });
  clearBtn.addEventListener("click", () => { split.classList.remove("show-out"); outPanel.innerHTML = ""; clearBtn.hidden = true; layoutBtn.hidden = true; status.textContent = idleMsg; });
  ui.clearBtn = clearBtn;
  // input() 프롬프트를 순서대로 읽어 라벨 붙은 입력칸을 만든다(브라우저 실행 전용, 초급자용).
  // 순서가 고정된 호출이면 프롬프트 문구를 라벨로 단 개별 칸을 보여 주고, 반복문·조건문 안처럼
  // 호출 횟수가 달라질 수 있으면 기존 자유 입력 textarea 로 폴백한다. stdin(textarea)은 값 저장소를
  // 겸하므로 실행 경로(ui.stdin.value)는 그대로 동작한다.
  let inputFieldSig = "";
  const syncStdinFromFields = () => {
    stdin.value = Array.from(inputFields.querySelectorAll("input")).map(el => el.value).join("\n");
  };
  const renderInputFields = () => {
    const plan = (typeof notebookInputPlan === "function") ? notebookInputPlan(editor.getValue()) : { calls: [], predictable: false };
    if (!plan.calls.length){ inputFields.hidden = true; inputHint.hidden = true; stdin.hidden = false; inputFieldSig = ""; return; }
    if (!plan.predictable){
      inputFields.hidden = true; inputFields.innerHTML = ""; inputFieldSig = "";
      stdin.hidden = false;
      inputHint.hidden = false;
      inputHint.textContent = "반복문·조건문 안의 input() 이 있어 값 개수가 달라질 수 있어요. 필요한 값을 한 줄에 하나씩 적어 주세요.";
      return;
    }
    const labels = plan.calls.map((c, i) => (c.prompt && c.prompt.trim()) ? c.prompt.trim() : ((i + 1) + "번째 입력값"));
    const sig = JSON.stringify(labels);
    stdin.hidden = true;
    inputHint.hidden = false;
    inputHint.textContent = "각 칸은 코드의 input() 순서예요. 값을 채우고 " + shortcutDisplay(shortcutValue("runCode")) + " 또는 ▶ 실행을 누르세요.";
    if (sig === inputFieldSig){ inputFields.hidden = false; return; }   // 프롬프트 구성이 그대로면 값·포커스 유지
    const prev = Array.from(inputFields.querySelectorAll("input")).map(el => el.value);
    inputFieldSig = sig;
    inputFields.innerHTML = "";
    labels.forEach((labelText, i) => {
      const row = document.createElement("label"); row.className = "run-input-row";
      const cap = document.createElement("span"); cap.className = "run-input-cap"; cap.textContent = labelText;
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "run-input-one";
      inp.autocomplete = "off"; inp.spellcheck = false;
      if (prev[i] != null) inp.value = prev[i];
      row.append(cap, inp); inputFields.appendChild(row);
      inp.addEventListener("input", syncStdinFromFields);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter"){
          e.preventDefault();
          const all = Array.from(inputFields.querySelectorAll("input"));
          const idx = all.indexOf(inp);
          if (idx >= 0 && idx + 1 < all.length) all[idx + 1].focus();
          else if (ui.btn && !ui.btn.disabled) ui.btn.click();          // 마지막 칸에서 Enter → 실행
        }
      });
    });
    inputFields.hidden = false;
    syncStdinFromFields();
  };
  ui.renderInputFields = renderInputFields;
  // 편집 상태 반영: 되돌리기 활성화 + input() 미리입력 칸(로컬 파이썬이면 대화형이라 숨김)
  let draftTimer = 0;
  const persistDraft = () => {
    clearTimeout(draftTimer); draftTimer = 0;
    const value = editor.getValue();
    if (value === savedValue) clearPythonDraft(draftKey);
    else savePythonDraft(draftKey, sourceFingerprint, value);
  };
  const refreshEditState = () => {
    revertBtn.disabled = (editor.getValue() === text);
    const wasDirty = !!(ownerDoc && ownerDoc.hasUnsavedEdits);
    if (ownerDoc) ownerDoc.hasUnsavedEdits = (editor.getValue() !== savedValue);
    if (ownerDoc) updateDocumentStatus(ownerDoc);
    if (ownerDoc && wasDirty !== ownerDoc.hasUnsavedEdits) renderSidebar();
    inputWrap.hidden = (_pyBackend === true) ? true : !usesInput(editor.getValue());
    if (!inputWrap.hidden) renderInputFields();
    clearTimeout(draftTimer); draftTimer = setTimeout(persistDraft, 500);
  };
  editor.ta.addEventListener("input", refreshEditState);
  editor.ta.addEventListener("focus", () => { if (ownerDoc) window.__lastCodeLinkDocId = ownerDoc.id; });
  pythonBackendAvailable().then(refreshEditState);
  prewarmBrowserPython();                        // 실행 전에 브라우저 파이썬 런타임을 미리 데운다(로컬 파이썬이면 자동 skip)
  revertBtn.addEventListener("click", async () => {
    if (editor.getValue() === text) return;
    if (await confirmDialog("편집한 내용을 버리고 원본 코드로 되돌릴까요?", "되돌리기", "취소")){ editor.setValue(text); clearPythonDraft(draftKey); refreshEditState(); }
  });
  editor.ta.addEventListener("keydown", (e) => {
    // 노트북: Shift+Enter = 이 셀 실행 후 다음 셀로, Ctrl/⌘+Enter = 이 셀만(상태 유지). 일반 코드는 기존대로 전체 실행.
    if (ui.runCurrentCell && e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){
      e.preventDefault(); ui.runCurrentCell(true); return;
    }
    // 노트북: Ctrl/⌘+↑·↓ = 실행 없이 이전/다음 셀로 커서 이동
    if (ui.moveCell && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")){
      if (ui.moveCell(e.key === "ArrowDown" ? 1 : -1)){ e.preventDefault(); return; }
    }
    if (shortcutMatches(e, "runCode")){
      e.preventDefault();
      if (ui.runCurrentCell) ui.runCurrentCell(false); else run(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(1); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "-"){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(-1); }
  });
  registerEditorFont(editor.host);                                                    // 저장된 글자 크기 적용
  registerEditorFont(outPanel);                                                       // 실행 결과 문자에도 같은 크기 적용
  if (ownerDoc){
    ownerDoc.codeEditor = editor;
    ownerDoc.codeEditorFileBase = ui.fileBase;
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      if (typeof ui.cancelRun === "function") ui.cancelRun();
    });
    // 이 코드 문서를 가리키는 PDF 핀들을 거터 마커로 표시(코드→PDF 역방향 이동).
    if (editor.setPinProvider) editor.setPinProvider(() => (typeof codeLinksTargetingDoc === "function" ? codeLinksTargetingDoc(ownerDoc) : []));
    window.__lastCodeLinkDocId = ownerDoc.id;
    if (ownerDoc.pendingFocusLine){                    // 정의 이동·코드 링크가 렌더 전에 예약해 둔 줄로 이동
      const ln = ownerDoc.pendingFocusLine; ownerDoc.pendingFocusLine = 0;
      requestAnimationFrame(() => { if (ownerDoc.codeEditor === editor && editor.focusLine) editor.focusLine(ln); });
    }
    if (!ownerDoc.cleanupFns) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      persistDraft();
      if (ownerDoc.codeEditor === editor) ownerDoc.codeEditor = null;
      editor.destroy();
      unregisterEditorFont(editor.host);
      unregisterEditorFont(outPanel);
    });
    // 필기 모드 — 켜면 편집이 자동 잠금되고 캔버스 오버레이가 뜸. 다시 누르면 둘 다 해제.
    // 보드(문서) 닫을 때 자동 정리 → 필기는 세션 한정.
    inkBtn.addEventListener("click", () => {
      const active = !!(ownerDoc.codePenOverlay && ownerDoc.codePenOverlay.active);
      setCodePenMode(ownerDoc, !active);
    });
    ownerDoc.cleanupFns.push(() => { setCodePenMode(ownerDoc, false); if (ownerDoc.codePenOverlay){ try { ownerDoc.codePenOverlay.cleanup(); } catch(_){} ownerDoc.codePenOverlay = null; } });
    ownerDoc.__inkBtn = inkBtn;   // 외부에서 필기 활성 상태 토글 시 버튼 강조용
  }
  refreshEditState();
  // 다른 파일과 동일하게, 열어도 포커스는 사이드바에 둔다(편집기는 클릭/Tab 으로 진입).
}

const PY_DRAFT_PREFIX = "pdf-signer-python-draft:";
const PY_DRAFT_MAX = 768 * 1024;
function pythonDraftKey(file, ownerDoc, runCtx){
  const identity = String(
    (ownerDoc && ownerDoc.workspacePath) ||
    (runCtx && runCtx.archiveCtx && (runCtx.archiveCtx.name + "/" + (runCtx.relPath || ""))) ||
    (runCtx && runCtx.relPath) || (file && file.name) || (ownerDoc && ownerDoc.name) || "code.py"
  ).replace(/\\/g, "/");
  return PY_DRAFT_PREFIX + fingerprintBytes(identity, new TextEncoder().encode(identity));
}
function loadPythonDraft(key, sourceFingerprint){
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && saved.source === sourceFingerprint && typeof saved.value === "string") return saved.value;
    if (saved) localStorage.removeItem(key);
    return null;
  } catch(e){ return null; }
}

function isLocalAbsolutePath(path){
  return /^[A-Za-z]:[\\/]/.test(String(path || "")) || /^\\\\/.test(String(path || ""));
}
function joinLocalPath(root, rel){
  root = String(root || "").replace(/[\\/]+$/, "");
  rel = String(rel || "").replace(/^[\\/]+/, "").replace(/\//g, "\\");
  return root && rel ? root + "\\" + rel : (root || rel);
}
async function displayPathForWorkspace(path){
  path = String(path || "");
  if (!path) return "";
  if (isLocalAbsolutePath(path)) return path;
  try {
    const info = await pythonEnvironmentDetails();
    if (info && info.saveRoot) return joinLocalPath(info.saveRoot, path);
  } catch(e){}
  return path;
}
function savePythonDraft(key, sourceFingerprint, value){
  if (!key || typeof value !== "string" || value.length > PY_DRAFT_MAX) return false;
  try { localStorage.setItem(key, JSON.stringify({ source: sourceFingerprint, value, updatedAt: Date.now() })); return true; }
  catch(e){ return false; }
}
function clearPythonDraft(key){ try { localStorage.removeItem(key); } catch(e){} }

function attachRunSplitter(split, divider){
  let ratio = 50;
  try {
    const saved = Number(localStorage.getItem("pythonSplitRatio"));
    if (saved >= 20 && saved <= 80) ratio = saved;
  } catch(e){}
  const apply = (next) => {
    ratio = Math.max(20, Math.min(80, next));
    split.style.setProperty("--run-editor-width", ratio + "%");
    divider.setAttribute("aria-valuemin", "20");
    divider.setAttribute("aria-valuemax", "80");
    divider.setAttribute("aria-valuenow", String(Math.round(ratio)));
  };
  const save = () => { try { localStorage.setItem("pythonSplitRatio", String(ratio)); } catch(e){} };
  apply(ratio);
  divider.addEventListener("pointerdown", (e) => {
    if (matchMedia("(max-width: 900px)").matches) return;
    e.preventDefault(); divider.setPointerCapture(e.pointerId); divider.classList.add("dragging");
    const rect = split.getBoundingClientRect();
    const vert = split.classList.contains("stack-v");           // 세로 배치면 Y축 기준으로 크기 조절
    const move = (ev) => apply(vert
      ? ((ev.clientY - rect.top) / rect.height) * 100
      : ((ev.clientX - rect.left) / rect.width) * 100);
    const up = () => {
      divider.classList.remove("dragging");
      divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up); save();
    };
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", up); divider.addEventListener("pointercancel", up);
  });
  divider.addEventListener("dblclick", () => { apply(50); save(); });
  divider.addEventListener("keydown", (e) => {
    const vert = split.classList.contains("stack-v");
    const dec = vert ? "ArrowUp" : "ArrowLeft", inc = vert ? "ArrowDown" : "ArrowRight";
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault(); apply(ratio + (e.key === dec ? -2 : 2)); save();
  });
}

function downloadTextFile(text, name){
  const blob = new Blob([text], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = /\.py$/i.test(name) ? name : name + ".py";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 텍스트/코드 파일 저장(.py 외): EXE면 서버에 원래 확장자로 저장, 아니면 다운로드. 스크래치 첫 저장은 이름을 받는다.
async function saveTextDoc(value, ownerDoc, name){
  try {
    if (ownerDoc && ownerDoc.originalSaveMode){
      const wrote = await saveViaFileHandle(value, name, ownerDoc, {
        existingOnly: true,
        mime: "text/plain;charset=utf-8"
      });
      if (wrote === "saved"){
        ownerDoc.size = new Blob([value]).size;
        ownerDoc.savedText = value;
        markDocumentSavedAsUtf8(ownerDoc);
        toast("원본 파일에 바로 저장했어요.", 2200, { type: "success" });
        return true;
      }
      if (wrote !== "cancelled") toast("원본 파일 쓰기 권한이 없어 저장하지 못했어요.", 3000, { type: "error" });
      return false;
    }
    if (await saveFileBackendAvailable()){
      if (ownerDoc && ownerDoc.isScratch && !ownerDoc._named){
        const m = String(name).match(/\.[^.\\/]+$/); const ext0 = m ? m[0] : ".txt";
        const base = String(ownerDoc.name || name).replace(/\.[^.\\/]+$/, "");
        const typed = await askText({ title: "새 파일 저장", message: "저장할 파일 이름을 정하세요.", placeholder: "예: 메모", value: base, okText: "저장" });
        if (typed === null) return false;
        let fname = String(typed).trim().replace(/[\\/:*?"<>|]/g, "").trim() || base || "새 파일";
        if (!/\.[A-Za-z0-9]+$/.test(fname)) fname += ext0;
        const currentPath = normalizedRunPath(ownerDoc.workspacePath || ownerDoc.relPath || "");
        const currentDir = runPathDir(currentPath);
        const nextPath = currentDir ? currentDir + "/" + fname : fname;
        ownerDoc.name = fname; ownerDoc.workspacePath = nextPath; ownerDoc._named = true; name = fname;
        if (ownerDoc.relPath || ownerDoc.archiveCtx) ownerDoc.relPath = nextPath;
        if (typeof renderTabs === "function") renderTabs();
        if (typeof renderSidebar === "function") renderSidebar();
        const hdr = byId("activeFileName"); if (hdr && typeof state !== "undefined" && state === ownerDoc) hdr.textContent = fname;
      }
      const path = await saveViaServer(value, ownerDoc, name);
      if (path){
        if (ownerDoc){ ownerDoc.size = new Blob([value]).size; ownerDoc.savedText = value; markDocumentSavedAsUtf8(ownerDoc); }
        toast("저장 완료 · " + path, 3400, {
          type: "success",
          action: (typeof window !== "undefined" && typeof window.__mnOpenLastSavedFolder === "function")
            ? { label: "폴더 열기", onClick: () => window.__mnOpenLastSavedFolder() } : null
        });
        return true;
      }
    }
    const blob = new Blob([value], { type: "text/plain;charset=utf-8" });   // 브라우저/file:// → 다운로드(확장자 유지)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (ownerDoc){ ownerDoc.size = blob.size; ownerDoc.savedText = value; markDocumentSavedAsUtf8(ownerDoc); }
    toast("파일을 내려받았어요.", 1800, { type: "success" });
    return true;
  } catch(e){ console.error(e); toast("저장하지 못했어요.", 2200, { type: "error" }); return false; }
}

// 새 빈 텍스트 파일(.txt) — renderCode 의 편집 토글로 열려 바로 편집·저장.
let _textScratchCount = 0;
function newTextScratch(){
  _textScratchCount++;
  const name = _textScratchCount > 1 ? ("새 메모 " + _textScratchCount + ".txt") : "새 메모.txt";
  if (typeof handleFiles === "function") handleFiles([new File([""], name, { type: "text/plain" })], { isScratch: true });
}

// ===== 저장 위치(파일 핸들)를 IndexedDB 에 보관 → 프로그램 재실행 후에도 같은 파일에 저장(위치 재선택 불필요) =====
// FileSystemFileHandle 은 구조화 복제로 IndexedDB 에 저장 가능. 단, 새 세션의 첫 저장 때 브라우저가
// 쓰기 권한을 1회 다시 묻는다(보안상 세션 간 자동 유지 안 됨) — 그래도 파일은 기억하므로 클릭 한 번이면 된다.
const FS_HANDLE_DB = "pdf-signer-fs-handles";
const FS_HANDLE_STORE = "handles";
let _fsHandleDbPromise = null;
function openFsHandleDb(){
  if (!window.indexedDB) return Promise.reject(new Error("indexeddb-unavailable"));
  if (_fsHandleDbPromise) return _fsHandleDbPromise;
  _fsHandleDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_HANDLE_DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(FS_HANDLE_STORE)) req.result.createObjectStore(FS_HANDLE_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexeddb-open-failed"));
  });
  return _fsHandleDbPromise;
}
function fsHandleKey(path){ return String(path || "").replace(/\\/g, "/").replace(/^\/+/, ""); }
async function saveFsHandle(path, handle){
  const key = fsHandleKey(path); if (!key || !handle) return;
  try { const db = await openFsHandleDb(); await new Promise((res, rej) => { const tx = db.transaction(FS_HANDLE_STORE, "readwrite"); tx.objectStore(FS_HANDLE_STORE).put(handle, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  catch(e){ console.warn("fs handle save skipped:", e); }
}
async function loadFsHandle(path){
  const key = fsHandleKey(path); if (!key) return null;
  try { const db = await openFsHandleDb(); return await new Promise((res, rej) => { const tx = db.transaction(FS_HANDLE_STORE, "readonly"); const r = tx.objectStore(FS_HANDLE_STORE).get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); }
  catch(e){ return null; }
}
async function forgetFsHandle(path){
  const key = fsHandleKey(path); if (!key) return;
  try { const db = await openFsHandleDb(); await new Promise((res) => { const tx = db.transaction(FS_HANDLE_STORE, "readwrite"); tx.objectStore(FS_HANDLE_STORE).delete(key); tx.oncomplete = res; tx.onerror = res; }); }
  catch(e){}
}

// File System Access API 로 원본 파일에 직접 쓰기. 반환: "saved" | "cancelled" | "denied" | "unsupported"
//   - 첫 저장: showSaveFilePicker 로 위치를 한 번 고르고(suggestedName=원본 이름), 핸들을 문서(ownerDoc.fsHandle)에 보관
//   - 이후 저장: 보관한 핸들로 대화상자 없이 조용히 덮어쓰기
//   - 미지원(구형 브라우저·file://)·권한 거부 → "unsupported"(호출부에서 다운로드로 폴백)
async function saveViaFileHandle(text, name, ownerDoc, options={}){
  try {
    let handle = ownerDoc && ownerDoc.fsHandle;
    if (handle && handle.queryPermission){              // 보관한 핸들의 쓰기 권한 재확인(회수됐을 수 있음)
      let perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted" && handle.requestPermission) perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted"){
        if (options.existingOnly) return "denied";
        handle = null;                                   // 거부 → 새로 위치 선택
      }
    }
    // 파일 핸들은 없지만 폴더 핸들이 있으면(변환된 노트북 등) 원본을 건드리지 않고 같은 폴더에 새 파일을 만든다.
    if (!handle && ownerDoc && ownerDoc.fsDirHandle && typeof ownerDoc.fsDirHandle.getFileHandle === "function"){
      let dperm = "granted";
      if (ownerDoc.fsDirHandle.queryPermission) dperm = await ownerDoc.fsDirHandle.queryPermission({ mode: "readwrite" });
      if (dperm !== "granted" && ownerDoc.fsDirHandle.requestPermission) dperm = await ownerDoc.fsDirHandle.requestPermission({ mode: "readwrite" });
      if (dperm === "granted"){
        handle = await ownerDoc.fsDirHandle.getFileHandle(ownerDoc.name || name, { create: true });
        ownerDoc.fsHandle = handle;            // 이후 저장은 이 .py 파일을 그대로 덮어쓴다
      } else if (options.existingOnly){
        return "denied";
      }
    }
    if (!handle){
      if (options.existingOnly) return "denied";
      if (typeof window.showSaveFilePicker !== "function") return "unsupported";
      handle = await window.showSaveFilePicker({
        suggestedName: /\.py$/i.test(name) ? name : name + ".py",
        types: [{ description: "Python", accept: { "text/x-python": [".py", ".pyw"] } }]
      });
      if (ownerDoc) ownerDoc.fsHandle = handle;
    }
    const writable = await handle.createWritable();
    await writable.write(new Blob([text], { type: options.mime || "text/x-python;charset=utf-8" }));
    await writable.close();
    return "saved";
  } catch(e){
    if (e && e.name === "AbortError") return "cancelled";   // 사용자가 위치 선택 대화상자를 닫음
    console.warn("file-handle save failed:", e);
    return options.existingOnly ? "denied" : "unsupported"; // 원본 모드에서는 다른 위치로 조용히 폴백하지 않음
  }
}

// exe 런처(로컬 서버)가 디스크 저장을 지원하는지 — pythonBackendAvailable 과 동일 패턴(한 번만 확인 후 캐시)
let _saveBackend = null;
async function saveFileBackendAvailable(){
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;   // file:// → 서버 없음
  if (_saveBackend !== null) return _saveBackend;
  try {
    const res = await fetch("/can-save-file", { method: "GET" });
    _saveBackend = res.ok && (await res.text()).trim().toLowerCase() === "yes";        // Go 폴백은 HTML을 돌려주므로 "yes" 일 때만
  } catch(e){ _saveBackend = false; }
  return _saveBackend;
}
// exe 로컬 서버에 바로 저장(브라우저 권한 팝업 없음). 반환: 저장된 절대경로 | null(실패 → 호출부가 기존 방식으로 폴백)
async function saveViaServer(text, ownerDoc, name){
  const rel = String((ownerDoc && (ownerDoc.workspacePath || ownerDoc.name)) || name || "practice.py")
    .replace(/\\/g, "/").replace(/^\/+/, "");
  try {
    const res = await fetch("/save-file", {
      method: "POST",
      headers: { "X-Save-Path": encodeURIComponent(rel) },
      body: new Blob([text], { type: "application/octet-stream" })
    });
    if (!res.ok) return null;
    try { window.__mnLastSaveRel = rel; } catch(_){}   // 헤더 '저장 폴더'가 직전 저장 파일 폴더를 열 수 있게 기록
    return (await res.text()).trim() || rel;
  } catch(e){ return null; }
}

// ===== 에디터 편의: 코드 글자 크기·폰트(모든 에디터 공유·저장) =====
let _codeFontSize = (() => { const v = Number(localStorage.getItem("pyCodeFontSize")); return (v >= 11 && v <= 30) ? v : 13; })();
// 안전한 monospace 시스템 폰트만 후보로 둔다(웹폰트 비동기 로드/가변폭 폰트로 인한 캐럿 어긋남 방지).
// value 가 ""이면 기본(Consolas) 사용. 각 stack 끝에 monospace 폴백을 두어 미설치 폰트도 안전하게 다음 후보로 넘어간다.
const CODE_FONT_CHOICES = [
  { value: "", label: "기본 (Consolas)", stack: "" },
  { value: "Cascadia Mono", label: "Cascadia Mono", stack: '"Cascadia Mono","Cascadia Code",Consolas,monospace' },
  { value: "Cascadia Code", label: "Cascadia Code", stack: '"Cascadia Code","Cascadia Mono",Consolas,monospace' },
  { value: "D2Coding", label: "D2Coding", stack: '"D2Coding","나눔고딕코딩","NanumGothicCoding",Consolas,monospace' },
  { value: "NanumGothicCoding", label: "나눔고딕코딩", stack: '"나눔고딕코딩","NanumGothicCoding","D2Coding",Consolas,monospace' },
  { value: "Courier New", label: "Courier New", stack: '"Courier New",Consolas,monospace' }
];
// 시스템에 폰트가 실제로 설치돼 있는지 — fallback(serif)과 텍스트 너비를 비교(canvas).
// 설치돼 있으면 측정값이 달라지고, 없으면 serif 와 똑같이 떨어진다(브라우저가 그대로 fallback).
const _fontAvailCache = new Map();
function isCodeFontInstalled(family){
  if (!family) return true;
  if (_fontAvailCache.has(family)) return _fontAvailCache.get(family);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const text = "mmmmmmmmlliiwwwwwwwww가나다라0123456789";
    ctx.font = "72px serif";
    const base = ctx.measureText(text).width;
    ctx.font = '72px "' + family + '", serif';
    const ok = Math.abs(ctx.measureText(text).width - base) > 0.5;
    _fontAvailCache.set(family, ok);
    return ok;
  } catch(_){ return true; }   // 측정 실패하면 일단 보이게(안전한 폴백)
}
function availableCodeFontChoices(){
  return CODE_FONT_CHOICES.filter(c => isCodeFontInstalled(c.value));
}
let _codeFontFamily = (() => {
  const v = String(localStorage.getItem("pyCodeFontFamily") || "");
  return CODE_FONT_CHOICES.some(c => c.value === v) ? v : "";
})();
function codeFontStack(value){
  const found = CODE_FONT_CHOICES.find(c => c.value === value);
  return found ? found.stack : "";
}
const _editorHosts = new Set();
function applyEditorFontMetrics(host){
  host.style.setProperty("--code-fs", _codeFontSize + "px");
  host.style.setProperty("--code-lh", Math.round(_codeFontSize * 1.6) + "px");
  const stack = codeFontStack(_codeFontFamily);
  if (stack) host.style.setProperty("--code-ff", stack);
  else host.style.removeProperty("--code-ff");
  // 폰트/크기 바뀌면 4칸 폭이 바뀌므로 들여쓰기 가이드도 다시 그린다(buildCodeEditor 가 등록한 콜백).
  if (typeof host.__refreshIndent === "function") host.__refreshIndent();
  if (typeof host.__refreshPins === "function") host.__refreshPins();        // 줄 높이 변화 → 핀 마커도 재배치
  if (typeof host.__refreshFontMetrics === "function") host.__refreshFontMetrics();
}
function registerEditorFont(host){ _editorHosts.add(host); applyEditorFontMetrics(host); }
function unregisterEditorFont(host){ _editorHosts.delete(host); }
function reapplyAllEditorFonts(){
  for (const h of [..._editorHosts]){ if (h.isConnected) applyEditorFontMetrics(h); else _editorHosts.delete(h); }
}
function bumpCodeFont(delta){
  _codeFontSize = Math.max(11, Math.min(30, _codeFontSize + delta));
  reapplyAllEditorFonts();
  try { localStorage.setItem("pyCodeFontSize", String(_codeFontSize)); } catch(_){}
}
function setCodeFontFamily(value){
  if (!CODE_FONT_CHOICES.some(c => c.value === value)) value = "";
  _codeFontFamily = value;
  reapplyAllEditorFonts();
  try { localStorage.setItem("pyCodeFontFamily", value); } catch(_){}
}
// 빈 파이썬 코드로 바로 시작(파일 없이 라이브 코딩)
let _scratchCount = 0;
// 지금 보고 있는 파일이 '업로드한 폴더 안 파이썬'이면 그 폴더 컨텍스트를 돌려준다.
// → 새 파일을 같은 폴더 옆자리에 만들어, 그 폴더의 모듈을 바로 import 할 수 있게 한다.
function activeFolderContextForNewFile(){
  const cur = (typeof activeId !== "undefined") ? docs.find(d => d.id === activeId) : null;
  if (!cur || cur.kind === "pdf" || !cur.archiveCtx || !cur.parentId) return null;
  const dir = runPathDir(normalizedRunPath(cur.relPath || cur.workspacePath || ""));
  if (!dir) return null;                          // 묶음 루트 직속 파일이면 폴더 없음
  return { parentId: cur.parentId, dir, archiveCtx: cur.archiveCtx };
}
function pythonScratchStarter(){
  return "# 여기에 파이썬 코드를 작성하고 ▶ 실행 (" + shortcutDisplay(shortcutValue("runCode")) + ")\nprint(\"Hello, Python!\")\n";
}
function createPythonScratchInFolder(folder){
  if (!folder || !folder.parentId || !folder.archiveCtx || !folder.dir) return false;
  const starter = pythonScratchStarter();
  const dir = normalizedRunPath(folder.dir);
  if (!dir) return false;
  // 같은 폴더 안에서 이름이 겹치지 않게 정한다.
  const taken = new Set(docs.map(d => normalizedRunPath(d.workspacePath || d.relPath || "")));
  let name = "새 코드.py";
  for (let n = 2; taken.has(normalizedRunPath(dir + "/" + name)); n++) name = "새 코드 " + n + ".py";
  const relPath = dir + "/" + name;
  handleFiles([new File([starter], name, { type: "text/x-python" })],
    { isScratch: true, parentId: folder.parentId, archiveCtx: folder.archiveCtx, relPath, workspacePath: relPath });
  if (typeof toast === "function") toast("'" + (folder.label || dir.split("/").pop() || dir) + "' 폴더 안에 새 Python 파일을 만들었어요.", 3000);
  return true;
}
function newPythonScratchInFolder(folder){
  _scratchCount++;
  createPythonScratchInFolder(folder);
}
function newPythonScratch(){
  _scratchCount++;
  const starter = pythonScratchStarter();
  const folder = activeFolderContextForNewFile();
  if (folder && createPythonScratchInFolder(folder)) return;
  const name = _scratchCount > 1 ? ("새 코드 " + _scratchCount + ".py") : "새 코드.py";
  handleFiles([new File([starter], name, { type: "text/x-python" })], { isScratch: true });
}

// ===== 파이썬 예제 갤러리: 클릭하면 새 코드로 열려 바로 ▶ 실행해볼 수 있다 =====
// 모두 표준 라이브러리(+matplotlib)만 사용 → 브라우저(Pyodide)·로컬 파이썬 양쪽에서 동작.
// 코드 문자열은 들여쓰기 보존을 위해 템플릿 리터럴의 각 줄을 0칸에서 시작한다.
const PY_SNIPPETS = [
  // ── 기초 / 출력 ──
  { cat:"기초·출력", title:"Hello, Python", emoji:"👋", name:"hello.py", code:
`name = "파이썬"
print("Hello,", name)
print("환영합니다! 🐍")
` },
  { cat:"기초·출력", title:"이름 인사 (입력)", emoji:"🙋", name:"인사.py", code:
`name = input("이름이 뭐예요? ")
print(f"반가워요, {name}님!")
` },
  { cat:"기초·출력", title:"사칙연산", emoji:"➗", name:"사칙연산.py", code:
`a, b = 17, 5
print("합:", a + b)
print("차:", a - b)
print("곱:", a * b)
print("몫:", a // b, "나머지:", a % b)
print("나눗셈:", a / b)
` },
  { cat:"기초·출력", title:"두 변수 교환", emoji:"🔁", name:"변수교환.py", code:
`a, b = 1, 2
print("전:", a, b)
a, b = b, a
print("후:", a, b)
` },
  { cat:"기초·출력", title:"형변환", emoji:"🔣", name:"형변환.py", code:
`s = "123"
n = int(s)
print(n + 1, type(n))
print(float(s) / 2)
print("나이: " + str(20))
` },

  // ── 반복 / 패턴 ──
  { cat:"반복·패턴", title:"구구단", emoji:"✖️", name:"구구단.py", code:
`for dan in range(2, 10):
    print(f"--- {dan}단 ---")
    for i in range(1, 10):
        print(f"{dan} x {i} = {dan*i}")
` },
  { cat:"반복·패턴", title:"별 피라미드", emoji:"⭐", name:"별피라미드.py", code:
`n = 5
for i in range(1, n + 1):
    print(" " * (n - i) + "*" * (2*i - 1))
` },
  { cat:"반복·패턴", title:"역삼각형 별", emoji:"🔻", name:"역삼각형.py", code:
`n = 5
for i in range(n, 0, -1):
    print("*" * i)
` },
  { cat:"반복·패턴", title:"다이아몬드 별", emoji:"💎", name:"다이아몬드.py", code:
`n = 4
for i in list(range(1, n + 1)) + list(range(n - 1, 0, -1)):
    print(" " * (n - i) + "*" * (2*i - 1))
` },
  { cat:"반복·패턴", title:"1~100 합계", emoji:"➕", name:"합계.py", code:
`total = sum(range(1, 101))
print("1부터 100까지 합:", total)
` },
  { cat:"반복·패턴", title:"짝수/홀수 나누기", emoji:"⚖️", name:"짝수홀수.py", code:
`evens = [n for n in range(1, 21) if n % 2 == 0]
odds  = [n for n in range(1, 21) if n % 2 == 1]
print("짝수:", evens)
print("홀수:", odds)
` },

  // ── 수학 / 숫자 ──
  { cat:"수학·숫자", title:"소수 찾기", emoji:"🔢", name:"소수.py", code:
`def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0:
            return False
    return True

print([n for n in range(2, 51) if is_prime(n)])
` },
  { cat:"수학·숫자", title:"팩토리얼", emoji:"❗", name:"팩토리얼.py", code:
`import math
for n in range(1, 8):
    print(f"{n}! = {math.factorial(n)}")
` },
  { cat:"수학·숫자", title:"최대공약수·최소공배수", emoji:"🔗", name:"gcd_lcm.py", code:
`import math
a, b = 24, 36
g = math.gcd(a, b)
print("최대공약수:", g)
print("최소공배수:", a * b // g)
` },
  { cat:"수학·숫자", title:"약수 구하기", emoji:"🧮", name:"약수.py", code:
`n = 36
divisors = [i for i in range(1, n + 1) if n % i == 0]
print(f"{n}의 약수:", divisors)
` },
  { cat:"수학·숫자", title:"진법 변환", emoji:"🔟", name:"진법변환.py", code:
`n = 255
print("2진수:", bin(n))
print("8진수:", oct(n))
print("16진수:", hex(n))
` },
  { cat:"수학·숫자", title:"원주율 근사", emoji:"🥧", name:"원주율.py", code:
`# 라이프니츠 공식으로 파이 근사
pi = 0
for k in range(100000):
    pi += (-1) ** k / (2*k + 1)
print("근사값:", pi * 4)
` },

  // ── 문자열 ──
  { cat:"문자열", title:"문자열 뒤집기", emoji:"↩️", name:"뒤집기.py", code:
`s = "안녕하세요 파이썬"
print(s[::-1])
` },
  { cat:"문자열", title:"회문(팰린드롬) 검사", emoji:"🪞", name:"회문.py", code:
`def is_palindrome(s):
    s = s.replace(" ", "").lower()
    return s == s[::-1]

for w in ["level", "python", "기러기"]:
    print(w, "->", is_palindrome(w))
` },
  { cat:"문자열", title:"모음 개수 세기", emoji:"🅰️", name:"모음세기.py", code:
`s = "Hello Python World"
count = sum(1 for c in s.lower() if c in "aeiou")
print("모음 개수:", count)
` },
  { cat:"문자열", title:"대소문자 변환", emoji:"🔠", name:"대소문자.py", code:
`s = "Hello World"
print(s.upper())
print(s.lower())
print(s.swapcase())
print(s.title())
` },
  { cat:"문자열", title:"단어 빈도수", emoji:"📈", name:"단어빈도.py", code:
`from collections import Counter
text = "사과 바나나 사과 포도 바나나 사과"
print(Counter(text.split()))
` },
  { cat:"문자열", title:"아스키 코드표", emoji:"🔡", name:"아스키.py", code:
`for c in "ABCabc":
    print(c, "->", ord(c))
print("65 ->", chr(65))
` },

  // ── 리스트 / 자료구조 ──
  { cat:"리스트·자료구조", title:"리스트 정렬", emoji:"📋", name:"정렬.py", code:
`nums = [5, 2, 8, 1, 9, 3]
print("오름차순:", sorted(nums))
print("내림차순:", sorted(nums, reverse=True))
` },
  { cat:"리스트·자료구조", title:"최대·최소·평균", emoji:"📊", name:"통계.py", code:
`scores = [88, 92, 76, 100, 64]
print("최고점:", max(scores))
print("최저점:", min(scores))
print("평균:", sum(scores) / len(scores))
` },
  { cat:"리스트·자료구조", title:"중복 제거", emoji:"🧹", name:"중복제거.py", code:
`data = [1, 2, 2, 3, 3, 3, 4]
print("중복 제거:", sorted(set(data)))
` },
  { cat:"리스트·자료구조", title:"딕셔너리 사용", emoji:"📖", name:"딕셔너리.py", code:
`phone = {"홍길동": "010-1111", "김철수": "010-2222"}
phone["이영희"] = "010-3333"
for name, number in phone.items():
    print(name, ":", number)
` },
  { cat:"리스트·자료구조", title:"리스트 컴프리헨션", emoji:"⚡", name:"컴프리헨션.py", code:
`squares = [x * x for x in range(1, 11)]
print("제곱:", squares)
` },
  { cat:"리스트·자료구조", title:"행렬 전치", emoji:"🔀", name:"행렬전치.py", code:
`matrix = [[1, 2, 3], [4, 5, 6]]
for row in zip(*matrix):
    print(row)
` },

  // ── random / 게임 ──
  { cat:"random·게임", title:"로또 번호", emoji:"🎰", name:"로또.py", code:
`import random
nums = sorted(random.sample(range(1, 46), 6))
print("이번 주 행운의 번호:", nums)
` },
  { cat:"random·게임", title:"주사위 굴리기", emoji:"🎲", name:"주사위.py", code:
`import random
for _ in range(5):
    print("🎲", random.randint(1, 6))
` },
  { cat:"random·게임", title:"가위바위보", emoji:"✊", name:"가위바위보.py", code:
`import random
hands = ["가위", "바위", "보"]
me, com = random.choice(hands), random.choice(hands)
print("나:", me, "/ 컴퓨터:", com)
` },
  { cat:"random·게임", title:"숫자 맞히기 (입력)", emoji:"🎯", name:"숫자맞히기.py", code:
`import random
answer = random.randint(1, 100)
print("1~100 사이 숫자를 맞혀보세요!")
while True:
    guess = int(input("숫자: "))
    if guess < answer:
        print("UP ↑")
    elif guess > answer:
        print("DOWN ↓")
    else:
        print("정답! 🎉")
        break
` },
  { cat:"random·게임", title:"동전 던지기 통계", emoji:"🪙", name:"동전.py", code:
`import random
flips = [random.choice(["앞", "뒤"]) for _ in range(1000)]
print("앞:", flips.count("앞"), "/ 뒤:", flips.count("뒤"))
` },
  { cat:"random·게임", title:"랜덤 비밀번호", emoji:"🔐", name:"비밀번호.py", code:
`import random, string
chars = string.ascii_letters + string.digits
pw = "".join(random.choice(chars) for _ in range(12))
print("생성된 비밀번호:", pw)
` },

  // ── 날짜 / 시간 ──
  { cat:"날짜·시간", title:"오늘 날짜·시간", emoji:"🕒", name:"오늘.py", code:
`import datetime
now = datetime.datetime.now()
print("지금:", now.strftime("%Y-%m-%d %H:%M:%S"))
` },
  { cat:"날짜·시간", title:"이번 달 달력", emoji:"📅", name:"달력.py", code:
`import calendar, datetime
today = datetime.date.today()
print(calendar.month(today.year, today.month))
` },
  { cat:"날짜·시간", title:"요일 구하기", emoji:"📆", name:"요일.py", code:
`import datetime
days = ["월", "화", "수", "목", "금", "토", "일"]
today = datetime.date.today()
print("오늘은", days[today.weekday()], "요일")
` },
  { cat:"날짜·시간", title:"D-day 계산", emoji:"⏳", name:"dday.py", code:
`import datetime
target = datetime.date(2026, 12, 25)
left = (target - datetime.date.today()).days
print(f"크리스마스까지 D-{left}")
` },
  { cat:"날짜·시간", title:"만 나이 계산", emoji:"🎂", name:"만나이.py", code:
`import datetime
birth = datetime.date(2000, 5, 10)
today = datetime.date.today()
age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
print("만 나이:", age)
` },

  // ── 알고리즘 ──
  { cat:"알고리즘", title:"피보나치 수열", emoji:"🌀", name:"피보나치.py", code:
`a, b = 0, 1
for _ in range(15):
    print(a, end=" ")
    a, b = b, a + b
print()
` },
  { cat:"알고리즘", title:"버블 정렬", emoji:"🫧", name:"버블정렬.py", code:
`nums = [5, 2, 9, 1, 7]
for i in range(len(nums)):
    for j in range(len(nums) - 1 - i):
        if nums[j] > nums[j + 1]:
            nums[j], nums[j + 1] = nums[j + 1], nums[j]
print(nums)
` },
  { cat:"알고리즘", title:"이진 탐색", emoji:"🔍", name:"이진탐색.py", code:
`data = [1, 3, 5, 7, 9, 11, 13]
target = 9
lo, hi = 0, len(data) - 1
while lo <= hi:
    mid = (lo + hi) // 2
    if data[mid] == target:
        print("찾음! 위치:", mid)
        break
    elif data[mid] < target:
        lo = mid + 1
    else:
        hi = mid - 1
` },
  { cat:"알고리즘", title:"하노이 탑", emoji:"🗼", name:"하노이.py", code:
`def hanoi(n, src, via, dst):
    if n == 1:
        print(src, "->", dst)
        return
    hanoi(n - 1, src, dst, via)
    print(src, "->", dst)
    hanoi(n - 1, via, src, dst)

hanoi(3, "A", "B", "C")
` },
  { cat:"알고리즘", title:"FizzBuzz", emoji:"🔔", name:"fizzbuzz.py", code:
`for n in range(1, 31):
    if n % 15 == 0:
        print("FizzBuzz")
    elif n % 3 == 0:
        print("Fizz")
    elif n % 5 == 0:
        print("Buzz")
    else:
        print(n)
` },

  // ── 그래프 (matplotlib) ── 한글 라벨은 폰트 문제로 영문 사용
  { cat:"그래프", title:"막대 그래프", emoji:"📊", name:"막대그래프.py", code:
`import matplotlib.pyplot as plt
labels = ["Mon", "Tue", "Wed", "Thu", "Fri"]
values = [3, 7, 2, 5, 8]
plt.bar(labels, values)
plt.title("Study hours by day")
plt.show()
` },
  { cat:"그래프", title:"꺾은선 그래프", emoji:"📈", name:"꺾은선.py", code:
`import matplotlib.pyplot as plt
x = list(range(1, 11))
y = [v * v for v in x]
plt.plot(x, y, marker="o")
plt.title("y = x^2")
plt.show()
` },
  { cat:"그래프", title:"원 그래프", emoji:"🥧", name:"원그래프.py", code:
`import matplotlib.pyplot as plt
sizes = [40, 25, 20, 15]
labels = ["A", "B", "C", "D"]
plt.pie(sizes, labels=labels, autopct="%1.1f%%")
plt.title("Share")
plt.show()
` },
  { cat:"그래프", title:"사인 곡선", emoji:"〰️", name:"사인곡선.py", code:
`import matplotlib.pyplot as plt
import math
x = [i / 10 for i in range(0, 63)]
y = [math.sin(v) for v in x]
plt.plot(x, y)
plt.title("sin(x)")
plt.show()
` },
  { cat:"그래프", title:"3D 곡면", emoji:"🏔️", name:"3d_곡면.py", code:
`import numpy as np
import matplotlib.pyplot as plt
fig = plt.figure()
ax = fig.add_subplot(111, projection="3d")
x = np.linspace(-5, 5, 60)
y = np.linspace(-5, 5, 60)
X, Y = np.meshgrid(x, y)
Z = np.sin(np.sqrt(X**2 + Y**2))
ax.plot_surface(X, Y, Z, cmap="viridis")
ax.set_title("3D surface")
plt.show()
` },
  { cat:"그래프", title:"3D 산점도", emoji:"🎲", name:"3d_산점도.py", code:
`import numpy as np
import matplotlib.pyplot as plt
fig = plt.figure()
ax = fig.add_subplot(111, projection="3d")
n = 200
xs, ys, zs = np.random.rand(n), np.random.rand(n), np.random.rand(n)
ax.scatter(xs, ys, zs, c=zs, cmap="plasma")
ax.set_title("3D scatter")
plt.show()
` },
  { cat:"그래프", title:"3D 나선", emoji:"🌀", name:"3d_나선.py", code:
`import numpy as np
import matplotlib.pyplot as plt
fig = plt.figure()
ax = fig.add_subplot(111, projection="3d")
t = np.linspace(0, 20, 500)
ax.plot(np.cos(t), np.sin(t), t)
ax.set_title("3D helix")
plt.show()
` },

  // ── 재미 ──
  { cat:"재미", title:"ASCII 텍스트 박스", emoji:"🖼️", name:"텍스트박스.py", code:
`msg = " PYTHON "
line = "+" + "-" * len(msg) + "+"
print(line)
print("|" + msg + "|")
print(line)
` },

  // ── 함수·재귀 ──
  { cat:"함수·재귀", title:"함수 기본", emoji:"🧩", name:"함수기본.py", code:
`def add(a, b):
    return a + b

def greet(name="친구"):
    return f"안녕, {name}!"

print(add(3, 4))
print(greet())
print(greet("민수"))
` },
  { cat:"함수·재귀", title:"가변 인자", emoji:"🎁", name:"가변인자.py", code:
`def total(*nums):
    return sum(nums)

def info(**kw):
    for k, v in kw.items():
        print(f"{k} = {v}")

print("합:", total(1, 2, 3, 4))
info(name="민수", age=14)
` },
  { cat:"함수·재귀", title:"재귀 팩토리얼", emoji:"❗", name:"팩토리얼.py", code:
`def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

for i in range(1, 8):
    print(i, "! =", factorial(i))
` },
  { cat:"함수·재귀", title:"재귀 피보나치", emoji:"🐚", name:"피보나치.py", code:
`def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(15)])
` },
  { cat:"함수·재귀", title:"하노이탑", emoji:"🗼", name:"하노이탑.py", code:
`def hanoi(n, src, dst, via):
    if n == 1:
        print(f"원반 1: {src} -> {dst}")
        return
    hanoi(n - 1, src, via, dst)
    print(f"원반 {n}: {src} -> {dst}")
    hanoi(n - 1, via, dst, src)

hanoi(3, "A", "C", "B")
` },
  { cat:"함수·재귀", title:"lambda·map·filter", emoji:"🎭", name:"람다.py", code:
`nums = [1, 2, 3, 4, 5, 6]
squares = list(map(lambda x: x * x, nums))
evens = list(filter(lambda x: x % 2 == 0, nums))
print("제곱:", squares)
print("짝수:", evens)
` },

  // ── 딕셔너리·집합 ──
  { cat:"딕셔너리·집합", title:"딕셔너리 기본", emoji:"📖", name:"딕셔너리.py", code:
`scores = {"국어": 90, "수학": 85, "영어": 95}
scores["과학"] = 88
for subject, score in scores.items():
    print(f"{subject}: {score}")
print("평균:", sum(scores.values()) / len(scores))
` },
  { cat:"딕셔너리·집합", title:"단어 빈도수", emoji:"🔠", name:"단어빈도.py", code:
`from collections import Counter
text = "apple banana apple cherry banana apple"
count = Counter(text.split())
for word, n in count.most_common():
    print(f"{word}: {n}")
` },
  { cat:"딕셔너리·집합", title:"집합 연산", emoji:"🔵", name:"집합연산.py", code:
`a = {1, 2, 3, 4, 5}
b = {4, 5, 6, 7}
print("합집합:", a | b)
print("교집합:", a & b)
print("차집합:", a - b)
print("대칭차:", a ^ b)
` },
  { cat:"딕셔너리·집합", title:"값으로 정렬", emoji:"🏅", name:"값정렬.py", code:
`fruit = {"사과": 5, "바나나": 2, "체리": 8, "포도": 4}
ranked = sorted(fruit.items(), key=lambda kv: kv[1], reverse=True)
for name, n in ranked:
    print(f"{name}: {n}개")
` },
  { cat:"딕셔너리·집합", title:"중첩 딕셔너리", emoji:"🗂️", name:"중첩딕셔너리.py", code:
`students = {
    "민수": {"수학": 90, "영어": 80},
    "지은": {"수학": 85, "영어": 95},
}
for name, subjects in students.items():
    avg = sum(subjects.values()) / len(subjects)
    print(f"{name} 평균: {avg:.1f}")
` },
  { cat:"딕셔너리·집합", title:"글자 수 세기", emoji:"🔡", name:"글자수.py", code:
`word = "banana"
freq = {}
for ch in word:
    freq[ch] = freq.get(ch, 0) + 1
print(freq)
` },

  // ── 예외·입력검증 ──
  { cat:"예외·입력검증", title:"try / except", emoji:"🛡️", name:"예외처리.py", code:
`values = ["10", "abc", "3.5", "7"]
for v in values:
    try:
        print(v, "->", int(v))
    except ValueError:
        print(v, "-> 정수가 아니에요")
` },
  { cat:"예외·입력검증", title:"0으로 나누기", emoji:"🚫", name:"0나누기.py", code:
`pairs = [(10, 2), (5, 0), (9, 3)]
for a, b in pairs:
    try:
        print(f"{a} / {b} = {a / b}")
    except ZeroDivisionError:
        print(f"{a} / {b} -> 0으로 나눌 수 없어요")
` },
  { cat:"예외·입력검증", title:"숫자 검증 함수", emoji:"✅", name:"숫자검증.py", code:
`def to_int(s):
    try:
        return int(s)
    except ValueError:
        return None

for s in ["42", "-3", "삼", "100"]:
    n = to_int(s)
    print(s, "->", "유효" if n is not None else "무효", n)
` },
  { cat:"예외·입력검증", title:"여러 예외", emoji:"🚦", name:"여러예외.py", code:
`data = ["5", "0", "x"]
for s in data:
    try:
        print(s, "->", 100 / int(s))
    except ValueError:
        print(s, ": 숫자가 아니에요")
    except ZeroDivisionError:
        print(s, ": 0으로 못 나눠요")
` },
  { cat:"예외·입력검증", title:"finally 절", emoji:"🏁", name:"finally.py", code:
`nums = [1, 2, 3]
for i in [0, 5, 2]:
    try:
        print("값:", nums[i])
    except IndexError:
        print(i, "번째는 없어요")
    finally:
        print("- 확인 끝")
` },

  // ── 클래스·객체 ──
  { cat:"클래스·객체", title:"클래스 기본", emoji:"🐶", name:"클래스기본.py", code:
`class Dog:
    def __init__(self, name):
        self.name = name
    def bark(self):
        return f"{self.name}: 멍멍!"

d = Dog("바둑이")
print(d.bark())
` },
  { cat:"클래스·객체", title:"은행 계좌", emoji:"🏦", name:"계좌.py", code:
`class Account:
    def __init__(self, balance=0):
        self.balance = balance
    def deposit(self, amount):
        self.balance += amount
    def __str__(self):
        return f"잔액: {self.balance}원"

a = Account()
a.deposit(5000)
a.deposit(3000)
print(a)
` },
  { cat:"클래스·객체", title:"상속", emoji:"🐾", name:"상속.py", code:
`class Animal:
    def __init__(self, name):
        self.name = name
    def speak(self):
        return "..."

class Cat(Animal):
    def speak(self):
        return "야옹"

class Cow(Animal):
    def speak(self):
        return "음메"

for a in [Cat("나비"), Cow("얼룩이")]:
    print(a.name, ":", a.speak())
` },
  { cat:"클래스·객체", title:"좌표 거리", emoji:"📐", name:"좌표.py", code:
`class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y
    def __str__(self):
        return f"({self.x}, {self.y})"
    def dist(self, other):
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

p, q = Point(0, 0), Point(3, 4)
print(p, "~", q, "거리:", p.dist(q))
` },
  { cat:"클래스·객체", title:"dataclass", emoji:"📦", name:"dataclass.py", code:
`from dataclasses import dataclass

@dataclass
class Book:
    title: str
    price: int

books = [Book("파이썬", 15000), Book("수학", 12000)]
for b in books:
    print(b)
print("총액:", sum(b.price for b in books))
` },

  // ── 정렬·탐색 ──
  { cat:"정렬·탐색", title:"버블 정렬", emoji:"🫧", name:"버블정렬.py", code:
`nums = [5, 2, 9, 1, 7, 3]
for i in range(len(nums)):
    for j in range(len(nums) - 1 - i):
        if nums[j] > nums[j + 1]:
            nums[j], nums[j + 1] = nums[j + 1], nums[j]
print(nums)
` },
  { cat:"정렬·탐색", title:"선택 정렬", emoji:"👉", name:"선택정렬.py", code:
`nums = [64, 25, 12, 22, 11]
for i in range(len(nums)):
    m = i
    for j in range(i + 1, len(nums)):
        if nums[j] < nums[m]:
            m = j
    nums[i], nums[m] = nums[m], nums[i]
print(nums)
` },
  { cat:"정렬·탐색", title:"이진 탐색", emoji:"🔎", name:"이진탐색.py", code:
`data = [1, 3, 5, 7, 9, 11, 13]
target = 9
lo, hi = 0, len(data) - 1
while lo <= hi:
    mid = (lo + hi) // 2
    if data[mid] == target:
        print("찾음! 위치:", mid)
        break
    elif data[mid] < target:
        lo = mid + 1
    else:
        hi = mid - 1
` },
  { cat:"정렬·탐색", title:"다중 기준 정렬", emoji:"🗃️", name:"다중정렬.py", code:
`people = [("민수", 14), ("지은", 13), ("현우", 14)]
by_age = sorted(people, key=lambda p: (p[1], p[0]))
for name, age in by_age:
    print(age, name)
` },
  { cat:"정렬·탐색", title:"최대·최소 찾기", emoji:"📏", name:"최대최소.py", code:
`nums = [3, 8, 1, 9, 4, 7]
biggest = smallest = nums[0]
for n in nums:
    if n > biggest:
        biggest = n
    if n < smallest:
        smallest = n
print("최대:", biggest, "최소:", smallest)
` },

  // ── 시뮬레이션·확률 ──
  { cat:"시뮬레이션·확률", title:"동전 던지기", emoji:"🪙", name:"동전.py", code:
`import random
heads = 0
trials = 1000
for _ in range(trials):
    if random.random() < 0.5:
        heads += 1
print(f"앞면 {heads}회 / {trials}회 ({heads / trials * 100:.1f}%)")
` },
  { cat:"시뮬레이션·확률", title:"주사위 합 분포", emoji:"🎲", name:"주사위분포.py", code:
`import random
counts = {}
for _ in range(1000):
    s = random.randint(1, 6) + random.randint(1, 6)
    counts[s] = counts.get(s, 0) + 1
for total in range(2, 13):
    print(f"{total:2d} | " + "#" * (counts.get(total, 0) // 10))
` },
  { cat:"시뮬레이션·확률", title:"몬테카를로 π", emoji:"🥧", name:"몬테카를로.py", code:
`import random
inside = 0
n = 10000
for _ in range(n):
    x, y = random.random(), random.random()
    if x * x + y * y <= 1:
        inside += 1
print("π 근사값:", 4 * inside / n)
` },
  { cat:"시뮬레이션·확률", title:"랜덤 워크", emoji:"🚶", name:"랜덤워크.py", code:
`import random
import matplotlib.pyplot as plt
x, y = [0], [0]
for _ in range(500):
    x.append(x[-1] + random.choice([-1, 1]))
    y.append(y[-1] + random.choice([-1, 1]))
plt.plot(x, y, linewidth=0.8)
plt.title("Random walk")
plt.show()
` },
  { cat:"시뮬레이션·확률", title:"생일 역설", emoji:"🎂", name:"생일역설.py", code:
`import random
def has_match(people):
    days = [random.randint(1, 365) for _ in range(people)]
    return len(days) != len(set(days))

for people in [10, 23, 40]:
    hits = sum(has_match(people) for _ in range(1000))
    print(f"{people}명: 생일 겹칠 확률 약 {hits / 10:.0f}%")
` },
  { cat:"시뮬레이션·확률", title:"가위바위보 대전", emoji:"✊", name:"가위바위보.py", code:
`import random
hands = ["가위", "바위", "보"]
beats = {"가위": "보", "바위": "가위", "보": "바위"}
result = {"나": 0, "컴퓨터": 0, "비김": 0}
for _ in range(10):
    me, com = random.choice(hands), random.choice(hands)
    if me == com:
        result["비김"] += 1
    elif beats[me] == com:
        result["나"] += 1
    else:
        result["컴퓨터"] += 1
print(result)
` },

  // ── 그래프 추가 (matplotlib, 영문 라벨) ──
  { cat:"그래프", title:"산점도", emoji:"✨", name:"산점도.py", code:
`import matplotlib.pyplot as plt
import random
x = [random.gauss(0, 1) for _ in range(150)]
y = [random.gauss(0, 1) for _ in range(150)]
plt.scatter(x, y, alpha=0.6)
plt.title("Scatter")
plt.show()
` },
  { cat:"그래프", title:"히스토그램", emoji:"📶", name:"히스토그램.py", code:
`import matplotlib.pyplot as plt
import random
data = [random.gauss(50, 10) for _ in range(1000)]
plt.hist(data, bins=20, color="teal")
plt.title("Histogram")
plt.show()
` },
  { cat:"그래프", title:"sin·cos 비교", emoji:"➰", name:"sin_cos.py", code:
`import matplotlib.pyplot as plt
import math
x = [i / 10 for i in range(63)]
plt.plot(x, [math.sin(v) for v in x], label="sin")
plt.plot(x, [math.cos(v) for v in x], label="cos")
plt.legend()
plt.title("sin and cos")
plt.show()
` },
  { cat:"그래프", title:"수평 막대", emoji:"📊", name:"수평막대.py", code:
`import matplotlib.pyplot as plt
langs = ["Python", "Java", "C", "Go", "Rust"]
votes = [42, 30, 18, 12, 9]
plt.barh(langs, votes, color="orange")
plt.title("Votes")
plt.show()
` },
  { cat:"그래프", title:"영역 채우기", emoji:"🌊", name:"영역채우기.py", code:
`import matplotlib.pyplot as plt
x = list(range(10))
y = [v * v for v in x]
plt.fill_between(x, y, color="skyblue", alpha=0.5)
plt.plot(x, y, color="navy")
plt.title("Area under y = x^2")
plt.show()
` },
  { cat:"그래프", title:"여러 그래프", emoji:"🖼️", name:"서브플롯.py", code:
`import matplotlib.pyplot as plt
import math
x = [i / 10 for i in range(63)]
fig, (ax1, ax2) = plt.subplots(1, 2)
ax1.plot(x, [math.sin(v) for v in x])
ax1.set_title("sin")
ax2.plot(x, [math.cos(v) for v in x], color="red")
ax2.set_title("cos")
plt.show()
` },

  // ── 문자열 (추가) ──
  { cat:"문자열", title:"회문 검사", emoji:"🔄", name:"회문.py", code:
`words = ["기러기", "토마토", "파이썬", "level"]
for w in words:
    print(w, "->", "회문!" if w == w[::-1] else "아니에요")
` },
  { cat:"문자열", title:"모음 세기", emoji:"🅰️", name:"모음세기.py", code:
`text = "Hello Python World"
vowels = "aeiouAEIOU"
count = sum(1 for ch in text if ch in vowels)
print("모음 개수:", count)
` },
  { cat:"문자열", title:"시저 암호", emoji:"🔐", name:"시저암호.py", code:
`def caesar(text, shift):
    out = ""
    for ch in text:
        if ch.isalpha():
            base = ord("A") if ch.isupper() else ord("a")
            out += chr((ord(ch) - base + shift) % 26 + base)
        else:
            out += ch
    return out

enc = caesar("Hello", 3)
print("암호화:", enc)
print("복호화:", caesar(enc, -3))
` },
  { cat:"문자열", title:"단어 뒤집기", emoji:"↔️", name:"단어뒤집기.py", code:
`sentence = "파이썬 은 정말 재미있다"
words = sentence.split()
print(" ".join(reversed(words)))
print(" ".join(w[::-1] for w in words))
` },
  { cat:"문자열", title:"문자 종류 통계", emoji:"🔣", name:"문자통계.py", code:
`text = "Hello, Python 123!"
upper = sum(c.isupper() for c in text)
lower = sum(c.islower() for c in text)
digit = sum(c.isdigit() for c in text)
print(f"대문자 {upper}, 소문자 {lower}, 숫자 {digit}")
` },

  // ── 수학·숫자 (추가) ──
  { cat:"수학·숫자", title:"소수 찾기(에라토스테네스)", emoji:"🧮", name:"소수.py", code:
`n = 50
sieve = [True] * (n + 1)
sieve[0] = sieve[1] = False
for i in range(2, int(n ** 0.5) + 1):
    if sieve[i]:
        for j in range(i * i, n + 1, i):
            sieve[j] = False
print([i for i in range(n + 1) if sieve[i]])
` },
  { cat:"수학·숫자", title:"약수 구하기", emoji:"🔻", name:"약수.py", code:
`n = 36
divisors = [i for i in range(1, n + 1) if n % i == 0]
print(f"{n}의 약수:", divisors)
print("개수:", len(divisors))
` },
  { cat:"수학·숫자", title:"최대공약수·최소공배수", emoji:"🔗", name:"gcd_lcm.py", code:
`import math
a, b = 24, 36
g = math.gcd(a, b)
print("최대공약수:", g)
print("최소공배수:", a * b // g)
` },
  { cat:"수학·숫자", title:"진법 변환", emoji:"🔢", name:"진법변환.py", code:
`n = 156
print("2진수:", bin(n))
print("8진수:", oct(n))
print("16진수:", hex(n))
print("2진수 -> 10진수:", int("10011100", 2))
` },
  { cat:"수학·숫자", title:"완전수 찾기", emoji:"💯", name:"완전수.py", code:
`for n in range(2, 1001):
    if sum(i for i in range(1, n) if n % i == 0) == n:
        print(n, "은 완전수")
` },

  // ── 리스트·자료구조 (추가) ──
  { cat:"리스트·자료구조", title:"리스트 컴프리헨션", emoji:"📝", name:"컴프리헨션.py", code:
`squares = [x * x for x in range(1, 11)]
evens = [x for x in range(20) if x % 2 == 0]
pairs = [(x, y) for x in range(3) for y in range(3) if x != y]
print(squares)
print(evens)
print(pairs)
` },
  { cat:"리스트·자료구조", title:"2차원 리스트(행렬)", emoji:"🔲", name:"행렬.py", code:
`matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
for row in matrix:
    print(row)
print("대각합:", sum(matrix[i][i] for i in range(3)))
` },
  { cat:"리스트·자료구조", title:"스택과 큐", emoji:"📚", name:"스택큐.py", code:
`from collections import deque
stack = []
for x in [1, 2, 3]:
    stack.append(x)
print("스택 pop:", stack.pop())

queue = deque(["A", "B", "C"])
print("큐 popleft:", queue.popleft())
` },
  { cat:"리스트·자료구조", title:"중첩 리스트 펼치기", emoji:"➡️", name:"평탄화.py", code:
`nested = [[1, 2], [3, 4, 5], [6]]
flat = [x for row in nested for x in row]
print(flat)
print("합:", sum(flat))
` },
  { cat:"리스트·자료구조", title:"중복 제거·정렬", emoji:"🧹", name:"중복제거.py", code:
`nums = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
unique = sorted(set(nums))
print("원본:", nums)
print("정리:", unique)
` },
  // ── 응용(⭐⭐⭐⭐) / 도전(⭐⭐⭐⭐⭐) ──
  { cat:"응용·도전", title:"다익스트라 최단경로", emoji:"🗺️", name:"다익스트라.py", code:
`import heapq

graph = {
    "A": {"B": 7, "C": 9, "F": 14},
    "B": {"A": 7, "C": 10, "D": 15},
    "C": {"A": 9, "B": 10, "D": 11, "F": 2},
    "D": {"B": 15, "C": 11, "E": 6},
    "E": {"D": 6, "F": 9},
    "F": {"A": 14, "C": 2, "E": 9},
}

def dijkstra(start):
    dist = {node: float("inf") for node in graph}
    dist[start] = 0
    pq = [(0, start)]
    while pq:
        d, node = heapq.heappop(pq)
        if d > dist[node]:
            continue
        for nxt, w in graph[node].items():
            if d + w < dist[nxt]:
                dist[nxt] = d + w
                heapq.heappush(pq, (dist[nxt], nxt))
    return dist

start = "A"
for node, d in dijkstra(start).items():
    print(f"{start} -> {node} : 최단거리 {d}")
` },
  { cat:"응용·도전", title:"배낭 문제 (DP)", emoji:"🎒", name:"배낭문제.py", code:
`weights = [2, 3, 4, 5, 9]
values  = [3, 4, 5, 8, 10]
capacity = 10
n = len(weights)

dp = [[0] * (capacity + 1) for _ in range(n + 1)]
for i in range(1, n + 1):
    for c in range(capacity + 1):
        dp[i][c] = dp[i - 1][c]
        if weights[i - 1] <= c:
            take = dp[i - 1][c - weights[i - 1]] + values[i - 1]
            dp[i][c] = max(dp[i][c], take)

print("최대 가치:", dp[n][capacity])

c, chosen = capacity, []
for i in range(n, 0, -1):
    if dp[i][c] != dp[i - 1][c]:
        chosen.append(i - 1)
        c -= weights[i - 1]
print("담은 물건 index:", sorted(chosen))
` },
  { cat:"응용·도전", title:"최장 공통 부분수열", emoji:"🧬", name:"LCS.py", code:
`a = "AGGTAB"
b = "GXTXAYB"
m, n = len(a), len(b)

dp = [[0] * (n + 1) for _ in range(m + 1)]
for i in range(1, m + 1):
    for j in range(1, n + 1):
        if a[i - 1] == b[j - 1]:
            dp[i][j] = dp[i - 1][j - 1] + 1
        else:
            dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

i, j, lcs = m, n, []
while i > 0 and j > 0:
    if a[i - 1] == b[j - 1]:
        lcs.append(a[i - 1]); i -= 1; j -= 1
    elif dp[i - 1][j] >= dp[i][j - 1]:
        i -= 1
    else:
        j -= 1

print("A:", a)
print("B:", b)
print("최장 공통 부분수열:", "".join(reversed(lcs)), "(길이", dp[m][n], ")")
` },
  { cat:"응용·도전", title:"N-퀸 퍼즐", emoji:"♛", name:"N퀸.py", code:
`N = 8
solutions = 0
cols, diag1, diag2, board = set(), set(), set(), []

def place(row):
    global solutions
    if row == N:
        solutions += 1
        if solutions == 1:
            for c in board:
                print("".join("♛" if x == c else "·" for x in range(N)))
        return
    for col in range(N):
        if col in cols or (row - col) in diag1 or (row + col) in diag2:
            continue
        cols.add(col); diag1.add(row - col); diag2.add(row + col); board.append(col)
        place(row + 1)
        cols.discard(col); diag1.discard(row - col); diag2.discard(row + col); board.pop()

print(f"{N}-퀸 첫 번째 해:")
place(0)
print(f"\\n{N}-퀸 해의 개수: {solutions}")
` },
  { cat:"응용·도전", title:"생명 게임", emoji:"🦠", name:"생명게임.py", code:
`seed = [
    "........",
    "..#.....",
    "...#....",
    ".###....",
    "........",
    "........",
]
grid = [[1 if ch == "#" else 0 for ch in row] for row in seed]
H, W = len(grid), len(grid[0])

def step(g):
    new = [[0] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            live = sum(g[(y + dy) % H][(x + dx) % W]
                       for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                       if not (dy == 0 and dx == 0))
            new[y][x] = 1 if (g[y][x] and live in (2, 3)) or (not g[y][x] and live == 3) else 0
    return new

for gen in range(4):
    print(f"세대 {gen}")
    for row in grid:
        print("".join("■" if c else "·" for c in row))
    print()
    grid = step(grid)
` },
  { cat:"응용·도전", title:"만델브로 프랙탈", emoji:"🌀", name:"만델브로.py", code:
`import matplotlib.pyplot as plt

W, H = 300, 200
max_iter = 40
xmin, xmax, ymin, ymax = -2.2, 1.0, -1.2, 1.2

img = [[0] * W for _ in range(H)]
for py in range(H):
    y0 = ymin + (ymax - ymin) * py / H
    for px in range(W):
        x0 = xmin + (xmax - xmin) * px / W
        x = y = 0.0
        it = 0
        while x * x + y * y <= 4 and it < max_iter:
            x, y = x * x - y * y + x0, 2 * x * y + y0
            it += 1
        img[py][px] = it

plt.figure(figsize=(6, 4))
plt.imshow(img, cmap="magma", extent=[xmin, xmax, ymin, ymax])
plt.title("Mandelbrot Set")
plt.axis("off")
plt.show()
` },
  { cat:"응용·도전", title:"허프만 압축", emoji:"🗜️", name:"허프만.py", code:
`import heapq
from collections import Counter

text = "abracadabra abracadabra"
freq = Counter(text)

heap = [[w, [sym, ""]] for sym, w in freq.items()]
heapq.heapify(heap)
while len(heap) > 1:
    lo = heapq.heappop(heap)
    hi = heapq.heappop(heap)
    for pair in lo[1:]:
        pair[1] = "0" + pair[1]
    for pair in hi[1:]:
        pair[1] = "1" + pair[1]
    heapq.heappush(heap, [lo[0] + hi[0]] + lo[1:] + hi[1:])

codes = {sym: code for sym, code in sorted(heap[0][1:], key=lambda p: (len(p[1]), p[0]))}
for sym, code in codes.items():
    print(f"'{'공백' if sym == ' ' else sym}' -> {code}")

encoded = "".join(codes[ch] for ch in text)
print("\\n원본 비트수(8bit):", len(text) * 8)
print("허프만 비트수     :", len(encoded))
print(f"압축률: {len(encoded) / (len(text) * 8) * 100:.1f}%")
` },
  { cat:"응용·도전", title:"수식 계산기 (파서)", emoji:"🧮", name:"수식계산기.py", code:
`import re

def tokenize(s):
    return re.findall(r"\\d+\\.?\\d*|[()+\\-*/]", s)

class Parser:
    def __init__(self, tokens):
        self.toks = tokens
        self.i = 0
    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else None
    def take(self):
        t = self.peek(); self.i += 1; return t
    def expr(self):        # 덧셈·뺄셈
        v = self.term()
        while self.peek() in ("+", "-"):
            v = v + self.term() if self.take() == "+" else v - self.term()
        return v
    def term(self):        # 곱셈·나눗셈
        v = self.factor()
        while self.peek() in ("*", "/"):
            v = v * self.factor() if self.take() == "*" else v / self.factor()
        return v
    def factor(self):      # 숫자·괄호
        t = self.take()
        if t == "(":
            v = self.expr(); self.take()   # ')'
            return v
        return float(t)

for e in ["2 + 3 * 4", "(2 + 3) * 4", "10 / 4 - 1", "2 * (3 + (4 - 1))"]:
    print(f"{e} = {Parser(tokenize(e)).expr():g}")
` },
  { cat:"응용·도전", title:"A* 길찾기", emoji:"🧭", name:"a_star.py", code:
`import heapq
import matplotlib.pyplot as plt

grid = [
    "S........",
    ".####.##.",
    ".#...#.#.",
    ".#.#.#.#.",
    "...#...#.",
    ".###.###.",
    ".......#G",
]
H, W = len(grid), len(grid[0])
walls, start, goal = set(), None, None
for y, row in enumerate(grid):
    for x, ch in enumerate(row):
        if ch == "#": walls.add((x, y))
        elif ch == "S": start = (x, y)
        elif ch == "G": goal = (x, y)

def heuristic(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

pq = [(heuristic(start, goal), 0, start)]
came, gscore = {}, {start: 0}
while pq:
    _, g, cur = heapq.heappop(pq)
    if cur == goal:
        break
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = cur[0] + dx, cur[1] + dy
        if not (0 <= nx < W and 0 <= ny < H) or (nx, ny) in walls:
            continue
        ng = g + 1
        if ng < gscore.get((nx, ny), 10 ** 9):
            gscore[(nx, ny)] = ng
            came[(nx, ny)] = cur
            heapq.heappush(pq, (ng + heuristic((nx, ny), goal), ng, (nx, ny)))

path, node = [], goal
while node in came:
    path.append(node); node = came[node]
path.append(start); path.reverse()
print("경로 길이:", len(path))

img = [[1 if (x, y) in walls else 0 for x in range(W)] for y in range(H)]
for (x, y) in path:
    img[y][x] = 2
plt.figure(figsize=(6, 3.6))
plt.imshow(img, cmap="viridis")
plt.title(f"A* path length = {len(path)}")
plt.axis("off")
plt.show()
` },
  { cat:"응용·도전", title:"마르코프 문장 생성", emoji:"📝", name:"마르코프.py", code:
`import random
random.seed(7)

corpus = """
파이썬은 배우기 쉽고 강력한 언어입니다.
파이썬은 데이터 분석에 자주 쓰입니다.
데이터 분석은 재미있고 유용합니다.
파이썬으로 웹도 만들고 게임도 만듭니다.
""".split()

model = {}
for a, b in zip(corpus, corpus[1:]):
    model.setdefault(a, []).append(b)

word = random.choice(corpus)
sentence = [word]
for _ in range(12):
    nexts = model.get(word)
    if not nexts:
        break
    word = random.choice(nexts)
    sentence.append(word)

print("생성된 문장:")
print(" ".join(sentence))
` },
];

// ===== 예제 학습 메타데이터 =====
// 각 예제에 난이도(level 1~5)·한 줄 설명(desc)·배우는 개념(learn)을 더한다.
// 코드 블록을 건드리지 않도록 PY_SNIPPETS 와 "같은 순서"의 병렬 배열로 두고 아래에서 병합한다.
//   l: 1=입문 · 2=기본 · 3=심화 · 4=응용 · 5=도전   d: 한 줄 설명   t: 배우는 개념 태그
// ⚠ 예제를 추가·재배치하면 이 배열의 순서도 함께 맞춰야 한다(개수가 다르면 있는 만큼만 병합).
const PY_SNIPPET_META = [
  { l:1, d:"변수에 값을 담고 print로 화면에 출력해요.", t:["변수","print()"] },
  { l:1, d:"input()으로 입력을 받아 f-문자열로 인사해요.", t:["input()","f-문자열"] },
  { l:1, d:"+, -, *, //, %, / 연산자로 계산해요.", t:["산술 연산자","몫·나머지"] },
  { l:1, d:"a, b = b, a 한 줄로 두 값을 맞바꿔요.", t:["다중 할당","튜플 언패킹"] },
  { l:1, d:"int(), float(), str()로 자료형을 바꿔요.", t:["형변환","type()"] },
  { l:1, d:"이중 for문으로 2~9단을 출력해요.", t:["이중 반복문","range()"] },
  { l:1, d:"문자열 곱셈으로 별을 쌓아 삼각형을 만들어요.", t:["for문","문자열 곱셈"] },
  { l:1, d:"range의 감소 스텝으로 별을 줄여가요.", t:["range() 역순","문자열 곱셈"] },
  { l:2, d:"증가·감소 구간을 이어 붙여 마름모를 그려요.", t:["리스트 이어붙이기","패턴 출력"] },
  { l:1, d:"sum()과 range()로 연속된 수를 더해요.", t:["sum()","range()"] },
  { l:2, d:"컴프리헨션과 나머지 연산으로 수를 분류해요.", t:["리스트 컴프리헨션","나머지 연산"] },
  { l:2, d:"제곱근까지만 나눠보며 소수를 판별해요.", t:["함수","소수 판별"] },
  { l:1, d:"math.factorial로 1!~7!을 구해요.", t:["math 모듈","반복문"] },
  { l:2, d:"math.gcd로 최대공약수·최소공배수를 구해요.", t:["math.gcd","약수 관계"] },
  { l:1, d:"나머지가 0인 수만 모아 약수를 찾아요.", t:["리스트 컴프리헨션","나머지 연산"] },
  { l:1, d:"bin/oct/hex로 2·8·16진수로 바꿔요.", t:["진법","내장 함수"] },
  { l:2, d:"라이프니츠 급수를 더해 원주율을 근사해요.", t:["급수","반복 누적"] },
  { l:1, d:"슬라이싱 [::-1]로 문자열을 뒤집어요.", t:["슬라이싱","문자열"] },
  { l:2, d:"뒤집어도 같은지 비교해 회문을 판별해요.", t:["함수","슬라이싱"] },
  { l:2, d:"제너레이터로 모음 글자만 세요.", t:["문자열 순회","조건 카운트"] },
  { l:1, d:"upper·lower·swapcase·title 메서드를 써요.", t:["문자열 메서드"] },
  { l:2, d:"Counter로 단어 개수를 한 번에 세요.", t:["collections.Counter","split()"] },
  { l:1, d:"ord()와 chr()로 문자↔코드값을 바꿔요.", t:["ord()","chr()"] },
  { l:1, d:"sorted()로 오름·내림차순 정렬해요.", t:["sorted()","reverse"] },
  { l:1, d:"max·min·sum으로 점수 통계를 내요.", t:["max()","min()","평균"] },
  { l:1, d:"set으로 중복을 없애고 정렬해요.", t:["set","중복 제거"] },
  { l:1, d:"키-값으로 전화번호부를 만들고 순회해요.", t:["딕셔너리","items()"] },
  { l:2, d:"한 줄로 제곱 리스트를 만들어요.", t:["리스트 컴프리헨션"] },
  { l:2, d:"zip(*matrix)로 행과 열을 바꿔요.", t:["zip()","언패킹"] },
  { l:1, d:"random.sample로 겹치지 않는 6개를 뽑아요.", t:["random.sample","정렬"] },
  { l:1, d:"random.randint로 주사위를 굴려요.", t:["random.randint","반복"] },
  { l:1, d:"random.choice로 무작위로 한 손을 골라요.", t:["random.choice"] },
  { l:2, d:"while로 반복 입력받아 up/down을 알려줘요.", t:["while문","break","input()"] },
  { l:2, d:"1000번 던져 앞·뒤 횟수를 세요.", t:["리스트 컴프리헨션","count()"] },
  { l:2, d:"문자 집합에서 무작위로 골라 비밀번호를 만들어요.", t:["string 모듈","join()"] },
  { l:1, d:"datetime.now와 strftime으로 시각을 꾸며요.", t:["datetime","strftime"] },
  { l:1, d:"calendar.month로 달력을 출력해요.", t:["calendar 모듈"] },
  { l:1, d:"weekday()로 오늘 요일을 구해요.", t:["datetime","리스트 인덱싱"] },
  { l:2, d:"두 날짜를 빼서 남은 일수를 구해요.", t:["날짜 뺄셈","timedelta"] },
  { l:2, d:"생일이 지났는지 비교해 만 나이를 구해요.", t:["튜플 비교","조건식"] },
  { l:2, d:"a,b = b,a+b로 다음 항을 이어 만들어요.", t:["반복","다중 할당"] },
  { l:2, d:"이웃끼리 비교·교환을 반복해 정렬해요.", t:["이중 반복문","교환 정렬"] },
  { l:2, d:"정렬된 데이터를 절반씩 좁혀 찾아요.", t:["이진 탐색","while문"] },
  { l:3, d:"재귀로 원반 옮기는 순서를 출력해요.", t:["재귀","분할 정복"] },
  { l:1, d:"배수 조건으로 Fizz/Buzz를 출력해요.", t:["조건문","나머지 연산"] },
  { l:2, d:"matplotlib bar로 막대 그래프를 그려요.", t:["matplotlib","bar()"] },
  { l:2, d:"plot으로 y=x² 곡선을 그려요.", t:["matplotlib","plot()"] },
  { l:2, d:"pie로 비율을 원그래프로 보여줘요.", t:["matplotlib","pie()"] },
  { l:2, d:"math.sin 값을 이어 곡선을 그려요.", t:["matplotlib","math.sin"] },
  { l:3, d:"numpy 격자에 곡면을 3D로 그려요.", t:["numpy","3D 그래프"] },
  { l:3, d:"무작위 점을 3D 공간에 흩뿌려요.", t:["numpy","3D 산점도"] },
  { l:3, d:"cos·sin·t로 나선을 3D로 그려요.", t:["numpy","3D 곡선"] },
  { l:1, d:"선 문자를 조합해 글자 상자를 만들어요.", t:["문자열 곱셈","출력 꾸미기"] },
  { l:1, d:"def로 함수를 만들고 기본값 인자를 써요.", t:["def","기본값 인자","return"] },
  { l:2, d:"*args, **kwargs로 개수가 다른 인자를 받아요.", t:["*args","**kwargs"] },
  { l:2, d:"자기 자신을 부르는 재귀로 팩토리얼을 구해요.", t:["재귀","종료 조건"] },
  { l:2, d:"재귀로 피보나치 수를 구해요.", t:["재귀","피보나치"] },
  { l:3, d:"재귀로 원반 이동을 단계별로 출력해요.", t:["재귀","분할 정복"] },
  { l:2, d:"익명 함수로 리스트를 변환·선별해요.", t:["lambda","map()","filter()"] },
  { l:1, d:"과목별 점수를 저장하고 평균을 내요.", t:["딕셔너리","values()"] },
  { l:2, d:"Counter.most_common으로 많이 나온 순으로 봐요.", t:["Counter","most_common()"] },
  { l:2, d:"합·교·차집합을 기호로 계산해요.", t:["set","집합 연산"] },
  { l:2, d:"key=lambda로 값 기준으로 정렬해요.", t:["sorted() key","lambda"] },
  { l:2, d:"딕셔너리 안 딕셔너리로 학생별 성적을 다뤄요.", t:["중첩 자료구조","평균"] },
  { l:1, d:"get()으로 글자별 개수를 세요.", t:["dict.get()","카운팅"] },
  { l:2, d:"형변환 오류를 예외로 안전하게 처리해요.", t:["try/except","ValueError"] },
  { l:1, d:"ZeroDivisionError를 잡아 안내해요.", t:["try/except","ZeroDivisionError"] },
  { l:2, d:"변환 실패 시 None을 돌려주는 함수예요.", t:["예외 처리","None 반환"] },
  { l:2, d:"예외 종류별로 다르게 처리해요.", t:["다중 except"] },
  { l:2, d:"성공·실패와 상관없이 finally를 실행해요.", t:["finally","IndexError"] },
  { l:2, d:"class로 객체를 만들고 메서드를 호출해요.", t:["class","__init__","메서드"] },
  { l:2, d:"입금 메서드와 __str__로 상태를 표현해요.", t:["class","__str__"] },
  { l:3, d:"부모 클래스를 물려받아 speak를 재정의해요.", t:["상속","오버라이딩"] },
  { l:3, d:"두 점 사이 거리를 메서드로 계산해요.", t:["class","거리 공식"] },
  { l:3, d:"@dataclass로 데이터 클래스를 간단히 만들어요.", t:["dataclass","타입 힌트"] },
  { l:2, d:"이웃 비교·교환으로 정렬해요.", t:["버블 정렬","이중 반복"] },
  { l:2, d:"가장 작은 값을 앞으로 골라 정렬해요.", t:["선택 정렬","최솟값"] },
  { l:2, d:"절반씩 좁혀 값을 찾아요.", t:["이진 탐색","while문"] },
  { l:2, d:"(나이, 이름) 튜플 키로 여러 기준 정렬해요.", t:["튜플 키 정렬"] },
  { l:1, d:"반복하며 직접 최대·최소를 갱신해요.", t:["반복","비교"] },
  { l:2, d:"random.random으로 앞면 비율을 실험해요.", t:["확률","시뮬레이션"] },
  { l:2, d:"두 주사위 합의 분포를 막대로 그려요.", t:["딕셔너리 카운트","시뮬레이션"] },
  { l:3, d:"무작위 점으로 원주율을 추정해요.", t:["몬테카를로","확률"] },
  { l:3, d:"무작위로 걸으며 경로를 그려요.", t:["시뮬레이션","matplotlib"] },
  { l:3, d:"생일이 겹칠 확률을 실험으로 확인해요.", t:["확률 실험","set"] },
  { l:2, d:"10판 대결 결과를 딕셔너리로 집계해요.", t:["딕셔너리","승패 판정"] },
  { l:2, d:"정규분포 점을 흩뿌려 그려요.", t:["matplotlib","scatter()"] },
  { l:2, d:"값의 분포를 막대로 나눠 그려요.", t:["matplotlib","hist()"] },
  { l:2, d:"두 곡선을 겹쳐 그리고 범례를 달아요.", t:["matplotlib","legend()"] },
  { l:2, d:"barh로 가로 막대 그래프를 그려요.", t:["matplotlib","barh()"] },
  { l:2, d:"fill_between으로 곡선 아래를 칠해요.", t:["matplotlib","fill_between()"] },
  { l:2, d:"subplots로 그래프 두 개를 나란히 그려요.", t:["matplotlib","subplots()"] },
  { l:1, d:"슬라이싱으로 여러 단어의 회문을 확인해요.", t:["슬라이싱","조건식"] },
  { l:1, d:"모음 글자를 세어 개수를 구해요.", t:["문자열 순회","카운트"] },
  { l:3, d:"글자를 일정 칸 밀어 암호로 바꿔요.", t:["ord()/chr()","모듈러 연산"] },
  { l:2, d:"단어 순서와 글자 순서를 각각 뒤집어요.", t:["split()","reversed()"] },
  { l:2, d:"대문자·소문자·숫자 개수를 세요.", t:["문자열 판별 메서드"] },
  { l:3, d:"체를 걸러 소수를 빠르게 찾아요.", t:["에라토스테네스의 체","리스트 활용"] },
  { l:1, d:"약수를 모아 개수까지 구해요.", t:["리스트 컴프리헨션","약수"] },
  { l:2, d:"math.gcd로 두 수의 gcd·lcm을 구해요.", t:["math.gcd","lcm"] },
  { l:2, d:"2·8·16진수 변환과 문자열→10진수도 해봐요.", t:["진법 변환","int(x, base)"] },
  { l:2, d:"진약수의 합이 자기 자신인 수를 찾아요.", t:["약수 합","조건 판별"] },
  { l:2, d:"조건·이중 반복 컴프리헨션을 익혀요.", t:["리스트 컴프리헨션","이중 반복"] },
  { l:2, d:"행렬을 순회하고 대각선 합을 구해요.", t:["2차원 리스트","인덱싱"] },
  { l:2, d:"리스트와 deque로 스택·큐를 다뤄요.", t:["스택","큐","deque"] },
  { l:2, d:"이중 컴프리헨션으로 리스트를 평탄화해요.", t:["평탄화","이중 반복"] },
  { l:1, d:"set으로 중복을 없애고 정렬해요.", t:["set","정렬"] },
  // ── 응용(4) / 도전(5) ── (PY_SNIPPETS 끝에 추가한 10개와 같은 순서)
  { l:4, d:"우선순위 큐로 그래프의 최단거리를 구해요.", t:["다익스트라","heapq","그래프"] },
  { l:4, d:"동적계획법으로 0/1 배낭 문제를 풀고 담은 물건을 역추적해요.", t:["동적계획법","2차원 DP"] },
  { l:4, d:"DP 표로 최장 공통 부분수열을 찾고 문자열을 복원해요.", t:["동적계획법","문자열 DP"] },
  { l:4, d:"백트래킹과 가지치기로 N-퀸의 모든 해를 세요.", t:["백트래킹","재귀","가지치기"] },
  { l:4, d:"콘웨이 생명 게임을 세대별로 진행하며 규칙을 관찰해요.", t:["셀룰러 오토마타","2차원 리스트"] },
  { l:5, d:"복소수 반복 발산 횟수로 만델브로 프랙탈을 그려요.", t:["프랙탈","복소평면","imshow()"] },
  { l:5, d:"빈도 기반 허프만 코드를 만들어 압축률을 계산해요.", t:["허프만 코딩","heapq","트리"] },
  { l:5, d:"재귀 하강 파서로 괄호·연산자 우선순위를 계산해요.", t:["파서","재귀 하강","연산자 우선순위"] },
  { l:5, d:"맨해튼 휴리스틱을 쓰는 A*로 격자 미로 경로를 찾아요.", t:["A* 탐색","휴리스틱","경로 복원"] },
  { l:5, d:"마르코프 체인으로 다음 단어를 이어 문장을 생성해요.", t:["마르코프 체인","확률 모델"] },
];
// PY_SNIPPETS 에 학습 메타데이터를 병합(순서 기준). 개수가 어긋나도 있는 만큼만 안전하게 채운다.
PY_SNIPPETS.forEach((s, i) => {
  const m = PY_SNIPPET_META[i];
  if (!m) return;
  if (s.level === undefined) s.level = m.l;
  if (s.desc === undefined) s.desc = m.d;
  if (s.learn === undefined) s.learn = m.t;
});

const SNIPPET_LEVELS = { 1: { label: "입문", star: "⭐" }, 2: { label: "기본", star: "⭐⭐" }, 3: { label: "심화", star: "⭐⭐⭐" }, 4: { label: "응용", star: "⭐⭐⭐⭐" }, 5: { label: "도전", star: "⭐⭐⭐⭐⭐" } };

function openPythonSnippet(snip){
  handleFiles([new File([snip.code], snip.name, { type: "text/x-python" })]);
}

function openSnippetGallery(){
  if (document.querySelector(".snippet-modal")) return;          // 중복 열림 방지
  const modal = document.createElement("div"); modal.className = "modal snippet-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const h = document.createElement("h3"); h.textContent = "파이썬 예제 갤러리";
  const sub = document.createElement("div"); sub.className = "sub";
  sub.textContent = "예제 " + PY_SNIPPETS.length + "개 · 난이도로 고르고 클릭하면 새 코드로 열려요. ▶ 실행(" + shortcutDisplay(shortcutValue("runCode")) + ")으로 바로 돌려보세요.";
  const close = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
  const onKey = (e) => { if (e.key === "Escape"){ e.preventDefault(); close(); } };

  // 검색창: 제목·카테고리·설명·개념·파일명으로 빠르게 거르기(예제가 많아짐)
  const search = document.createElement("input"); search.type = "search"; search.className = "snippet-search";
  search.placeholder = "예제 검색 (제목·설명·개념)"; search.setAttribute("aria-label", "예제 검색");

  // 난이도 필터 칩: 전체 / ⭐ 입문 / ⭐⭐ 기본 / ⭐⭐⭐ 심화 / ⭐⭐⭐⭐ 응용 / ⭐⭐⭐⭐⭐ 도전
  let levelFilter = 0;   // 0 = 전체
  const filterBar = document.createElement("div"); filterBar.className = "snippet-filter"; filterBar.setAttribute("role", "group"); filterBar.setAttribute("aria-label", "난이도 필터");
  const countFor = (lv) => PY_SNIPPETS.filter(s => !lv || s.level === lv).length;
  const chipDefs = [{ lv: 0, text: "전체 " + countFor(0) }].concat(
    [1, 2, 3, 4, 5].map(lv => ({ lv, text: SNIPPET_LEVELS[lv].star + " " + SNIPPET_LEVELS[lv].label + " " + countFor(lv) }))
  );
  const chips = chipDefs.map(def => {
    const chip = document.createElement("button"); chip.type = "button"; chip.className = "snippet-chip"; chip.textContent = def.text;
    chip.setAttribute("aria-pressed", def.lv === 0 ? "true" : "false");
    if (def.lv === 0) chip.classList.add("active");
    chip.addEventListener("click", () => {
      levelFilter = def.lv;
      chips.forEach(c => { const on = (c === chip); c.classList.toggle("active", on); c.setAttribute("aria-pressed", on ? "true" : "false"); });
      applyFilter();
    });
    filterBar.appendChild(chip);
    return chip;
  });

  // 카테고리별로 묶어 헤더 + 카드 그리드로 렌더(긴 목록은 본문 스크롤)
  const body = document.createElement("div"); body.className = "snippet-body";
  const sections = [];
  const cats = [], byCat = new Map();
  PY_SNIPPETS.forEach(s => { const c = s.cat || "기타"; if (!byCat.has(c)){ byCat.set(c, []); cats.push(c); } byCat.get(c).push(s); });
  cats.forEach(c => {
    const head = document.createElement("div"); head.className = "snippet-cat"; head.textContent = c;
    const grid = document.createElement("div"); grid.className = "snippet-grid";
    const cards = [];
    byCat.get(c).forEach(s => {
      const lvInfo = SNIPPET_LEVELS[s.level] || null;
      const b = document.createElement("button"); b.type = "button"; b.className = "snippet-card"; b.title = s.name;
      if (lvInfo){ b.classList.add("lv" + s.level); b.setAttribute("aria-label", s.title + " · " + lvInfo.label + " · " + (s.desc || "")); }
      const top = document.createElement("span"); top.className = "snippet-top";
      const em = document.createElement("span"); em.className = "snippet-emoji"; em.textContent = s.emoji;
      top.appendChild(em);
      if (lvInfo){ const lv = document.createElement("span"); lv.className = "snippet-level"; lv.textContent = lvInfo.star; lv.title = lvInfo.label; top.appendChild(lv); }
      const t = document.createElement("span"); t.className = "snippet-title"; t.textContent = s.title;
      b.append(top, t);
      if (s.desc){ const d = document.createElement("span"); d.className = "snippet-desc"; d.textContent = s.desc; b.appendChild(d); }
      if (Array.isArray(s.learn) && s.learn.length){
        const tags = document.createElement("span"); tags.className = "snippet-tags";
        s.learn.slice(0, 3).forEach(name => { const tag = document.createElement("span"); tag.className = "snippet-tag"; tag.textContent = name; tags.appendChild(tag); });
        b.appendChild(tags);
      }
      b.addEventListener("click", () => { close(); openPythonSnippet(s); });
      grid.appendChild(b);
      cards.push({ el: b, level: s.level || 0, hay: (s.title + " " + c + " " + (s.desc || "") + " " + (Array.isArray(s.learn) ? s.learn.join(" ") : "") + " " + (s.name || "")).toLocaleLowerCase() });
    });
    body.append(head, grid);
    sections.push({ head, grid, cards });
  });
  const emptyMsg = document.createElement("div"); emptyMsg.className = "snippet-empty"; emptyMsg.textContent = "조건에 맞는 예제가 없어요."; emptyMsg.hidden = true;
  body.appendChild(emptyMsg);
  const applyFilter = () => {
    const q = search.value.trim().toLocaleLowerCase();
    let any = false;
    sections.forEach(sec => {
      let shown = 0;
      sec.cards.forEach(c => {
        const ok = (!q || c.hay.includes(q)) && (!levelFilter || c.level === levelFilter);
        c.el.hidden = !ok; if (ok) shown++;
      });
      sec.head.hidden = sec.grid.hidden = (shown === 0);
      if (shown) any = true;
    });
    emptyMsg.hidden = any;
  };
  search.addEventListener("input", applyFilter);

  const actions = document.createElement("div"); actions.className = "modal-actions";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "닫기";
  cancel.addEventListener("click", close);
  actions.append(spacer, cancel);
  card.append(h, sub, search, filterBar, body, actions);
  modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });   // 바깥 클릭 닫기
  document.body.appendChild(modal);
  setTimeout(() => { try { search.focus(); } catch(e){} }, 0);   // 열면 바로 검색 가능
  window.addEventListener("keydown", onKey, true);
}

// 편집 가능한 코드 에디터: 투명 textarea(실제 입력) 아래에 구문강조 pre(표시)를 겹쳐, 색을 유지하며 편집.
// 줄번호·스크롤 동기화, Tab=공백 4칸. getValue()로 현재 내용을 읽는다(저장 기능은 없음 — 실시간 편집+실행).
// ===== Jedi(로컬 파이썬) 문맥 자동완성 — 가능할 때만, 안 되면 로컬 완성으로 폴백 =====
let _jediBackend = null;   // null=미확인 | "pending" | true | false
function ensureJediProbe(){
  if (_jediBackend !== null) return;                       // 한 번만 확인(결과 캐시)
  if (location.protocol !== "http:" && location.protocol !== "https:"){ _jediBackend = false; return; }
  _jediBackend = "pending";
  fetch("/can-complete", { method: "GET" })                // 백그라운드: 로컬 파이썬+Jedi 준비(없으면 서버가 1회 설치)
    .then(res => res.ok ? res.text() : "no")
    .then(t => { _jediBackend = (String(t).trim().toLowerCase() === "yes"); })
    .catch(() => { _jediBackend = false; });
}
const jediReady = () => _jediBackend === true;
async function requestJediCompletions(source, line, column){
  try {
    const res = await fetch("/complete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, line, column }) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.ok === false || !Array.isArray(data.items)) return null;
    return data.items.map(it => {
      const name = (it && it.name) ? String(it.name) : "";
      if (!name) return null;
      return {
        name,
        type: String(it.type || ""),
        signature: String(it.signature || "").slice(0, 700)
      };
    }).filter(Boolean);
  } catch(e){ return null; }
}
async function requestJediHelp(source, line, column){
  const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 8000) : 0;   // 응답이 없으면 8초 후 포기(로딩 무한대기 방지)
  try {
    const res = await fetch("/complete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, line, column, mode: "help" }), signal: controller ? controller.signal : undefined });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.ok === false) return null;
    return {
      ok: true,
      name: String(data.name || ""),
      type: String(data.type || ""),
      signature: String(data.signature || "").slice(0, 400),
      docstring: String(data.docstring || "").slice(0, 4000)
    };
  } catch(e){ return null; }
  finally { if (timer) clearTimeout(timer); }
}
async function requestJediDefinition(source, line, column){
  try {
    const res = await fetch("/definition", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, line, column, mode: "definition" }) });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : data || null;
  } catch(e){ return null; }
}
async function readLocalDefinitionFile(path){
  // Jedi가 C 확장 모듈(.dll/.pyd 등)을 정의 위치로 돌려주는 경우가 있다.
  // 앱에서 열 수 있는 텍스트 소스만 요청해 예상된 404와 빈 탭 생성을 막는다.
  if (!/\.(py|pyw|pyi|txt)$/i.test(String(path || ""))) return null;
  try {
    const res = await fetch("/local-file?path=" + encodeURIComponent(path));
    if (!res.ok || res.status === 204) return null;
    const buffer = await res.arrayBuffer();
    return buffer.byteLength ? buffer : null;
  } catch(e){ return null; }
}

function buildCodeEditor(text, prof, options={}){
  const host = document.createElement("div"); host.className = "code-host code-host-edit";
  const gutter = document.createElement("div"); gutter.className = "code-gutter";
  const edit = document.createElement("div"); edit.className = "code-edit";
  const pre = document.createElement("pre"); pre.className = "code-pre"; pre.setAttribute("aria-hidden", "true");
  const code = document.createElement("code");
  const ta = document.createElement("textarea"); ta.className = "code-input";
  ta.value = text; ta.spellcheck = false; ta.wrap = "off";
  ta.setAttribute("autocomplete", "off"); ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
  const overlay = document.createElement("div"); overlay.className = "col-overlay"; overlay.setAttribute("aria-hidden", "true");
  const errBand = document.createElement("div"); errBand.className = "err-line"; errBand.hidden = true; errBand.setAttribute("aria-hidden", "true");
  const traceBand = document.createElement("div"); traceBand.className = "trace-line"; traceBand.hidden = true; traceBand.setAttribute("aria-hidden", "true");
  const jumpBand = document.createElement("div"); jumpBand.className = "jump-line"; jumpBand.hidden = true; jumpBand.setAttribute("aria-hidden", "true");
  const cellBand = document.createElement("div"); cellBand.className = "cell-band"; cellBand.hidden = true; cellBand.setAttribute("aria-hidden", "true");
  const cellDivLayer = document.createElement("div"); cellDivLayer.className = "cell-div-layer"; cellDivLayer.setAttribute("aria-hidden", "true");   // # %% 셀 경계 구분선(스크롤 따라 이동)
  const caretLine = document.createElement("div"); caretLine.className = "code-caret-line"; caretLine.setAttribute("aria-hidden", "true");
  const indentLayer = document.createElement("div"); indentLayer.className = "code-indent-layer"; indentLayer.setAttribute("aria-hidden", "true");
  const complete = document.createElement("div"); complete.className = "code-complete"; complete.hidden = true;
  complete.setAttribute("role", "listbox"); complete.setAttribute("aria-label", "Python 자동완성");
  const completionPortal = !!options.completionPortal;
  // 더블클릭/선택으로 잡은 단어와 같은 단어를 편집기 전체에 은은하게 음영. 실제 구현은 아래 colMetrics 정의 후 할당(초기화 순서 보호).
  const wordHi = document.createElement("div"); wordHi.className = "word-hi-layer"; wordHi.setAttribute("aria-hidden", "true");
  const defHover = document.createElement("div"); defHover.className = "code-def-layer"; defHover.setAttribute("aria-hidden", "true");
  const findHi = document.createElement("div"); findHi.className = "find-hi-layer"; findHi.setAttribute("aria-hidden", "true");
  // 노트북 전체 찾기(Ctrl+H)가 이 셀의 현재 매치를 또렷하게 강조할 때 쓰는 별도 레이어 — 셀 안 찾기(findHi)와 겹치지 않게 분리.
  const spotlightHi = document.createElement("div"); spotlightHi.className = "find-hi-layer"; spotlightHi.setAttribute("aria-hidden", "true");
  let wordHiOcc = [];                 // {line, col, len} — 화면 밖 포함 전체 매치(스크롤 시 보이는 것만 다시 그림)
  const linkedEdit = { active:false, term:"", ranges:[], primaryIndex:-1 };
  let linkedBeforeInput = null;
  let renderWordHi = () => {};
  let renderDefinitionHover = () => {};
  let renderFindHi = () => {};
  let renderSpotlight = () => {};
  let renderCellDividers = () => {};   // 실제 구현은 아래(편집 헬퍼 정의 후) 할당 — syncNow 가 먼저 참조하므로 예약 선언
  // ===== 편집기 내 찾기/바꾸기(Ctrl+H) 상태 — 실제 구현은 아래 colMetrics 정의 후 할당 =====
  let findOpen = false, findMatches = [], findIndex = -1, findApplying = false;
  let computeWordHi = () => {};
  const clearWordHi = () => { if (wordHiOcc.length){ wordHiOcc = []; wordHi.textContent = ""; } };
  const exitLinkedEdit = () => {
    if (!linkedEdit.active) return;
    linkedEdit.active = false; linkedEdit.term = ""; linkedEdit.ranges = []; linkedEdit.primaryIndex = -1;
    linkedBeforeInput = null; edit.classList.remove("linked-edit-mode"); clearWordHi();
  };
  let defHoverInfo = null;
  const clearDefinitionHover = () => {
    if (!defHoverInfo && !defHover.textContent) return;
    defHoverInfo = null;
    defHover.textContent = "";
    edit.classList.remove("code-def-linking");
  };
  pre.appendChild(code);
  // caretLine 은 맨 앞에 둬서 강조 pre·textarea 보다 뒤(아래)에 깔린다 — 글자 위에 색이 덧칠되지 않게.
  edit.appendChild(cellBand); edit.appendChild(caretLine); edit.appendChild(indentLayer); edit.appendChild(wordHi); edit.appendChild(findHi); edit.appendChild(spotlightHi); edit.appendChild(defHover); edit.appendChild(pre); edit.appendChild(ta); edit.appendChild(cellDivLayer); edit.appendChild(errBand); edit.appendChild(traceBand); edit.appendChild(jumpBand); edit.appendChild(overlay);
  if (completionPortal){
    complete.classList.add("code-complete-portal");
    document.body.appendChild(complete);
  } else edit.appendChild(complete);
  // 함수 도움말 팝업(Shift+Tab) — 캐럿 근처에 시그니처+docstring 을 띄운다. 항상 body 로 포털(fixed) 배치.
  const help = document.createElement("div"); help.className = "code-help code-help-portal"; help.hidden = true;
  help.setAttribute("role", "tooltip");
  document.body.appendChild(help);
  host.appendChild(gutter); host.appendChild(edit);
  ensureJediProbe();                                       // 로컬 파이썬이면 Jedi 완성 준비(백그라운드, UI 비차단)

  // ===== 실행 에러 줄 표시: 에러 난 줄에 빨간 띠. 스크롤 따라 움직이고, 코드 수정 시 사라진다 =====
  let errLine = 0;
  const positionErr = () => {
    if (!errLine){ errBand.hidden = true; return; }
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    errBand.style.top = (pt + (errLine - 1) * lh - ta.scrollTop) + "px";
    errBand.style.height = lh + "px";
    errBand.hidden = false;
  };
  const clearError = () => { if (!errLine) return; errLine = 0; errBand.hidden = true; };
  let traceLine = 0;
  const positionTrace = () => {
    if (!traceLine){ traceBand.hidden = true; return; }
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    traceBand.style.top = (pt + (traceLine - 1) * lh - ta.scrollTop) + "px";
    traceBand.style.height = lh + "px";
    traceBand.hidden = false;
  };
  const clearTraceLine = () => { traceLine = 0; traceBand.hidden = true; };
  const showTraceLine = (n) => {
    const total = ta.value.split("\n").length;
    n = Math.max(1, Math.min(total, parseInt(n, 10) || 1));
    traceLine = n;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20, y = (n - 1) * lh;
    if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - lh) ta.scrollTop = Math.max(0, y - ta.clientHeight * 0.35);
    positionTrace();
  };
  let jumpLine = 0, jumpTimer = 0;
  const positionJump = () => {
    if (!jumpLine){ jumpBand.hidden = true; return; }
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    jumpBand.style.top = (pt + (jumpLine - 1) * lh - ta.scrollTop) + "px";
    jumpBand.style.height = lh + "px";
    jumpBand.hidden = false;
  };
  const clearJump = () => { jumpLine = 0; jumpBand.hidden = true; clearTimeout(jumpTimer); };
  // ===== 현재(커서) 줄 강조: 캐럿이 있는 줄에 은은한 배경 띠. 스크롤·선택을 따라 움직인다 =====
  const positionCaretLine = () => {
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    const caret = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
    let lineNo = 0; for (let i = 0; i < caret; i++) if (ta.value.charCodeAt(i) === 10) lineNo++;
    caretLine.style.top = (pt + lineNo * lh - ta.scrollTop) + "px";
    caretLine.style.height = lh + "px";
  };
  // 코드로 값을 바꾸면(엔터 자동들여쓰기·Tab·줄 이동 등) 브라우저가 캐럿으로 자동 스크롤하지 않는다 →
  // 캐럿 줄이 화면 밖이면 최소한으로 스크롤해 따라가게 한다(맨 아래에서 엔터 연타 시 화면이 같이 내려감).
  const scrollCaretIntoView = () => {
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const caret = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
    let lineNo = 0; for (let i = 0; i < caret; i++) if (ta.value.charCodeAt(i) === 10) lineNo++;
    const top = pt + lineNo * lh, bottom = top + lh;
    if (bottom > ta.scrollTop + ta.clientHeight - pb) ta.scrollTop = bottom - ta.clientHeight + pb;   // 아래로 벗어남
    else if (top < ta.scrollTop + pt) ta.scrollTop = Math.max(0, top - pt);                            // 위로 벗어남
    syncNow();                                   // 강조 띠·pre·줄번호 위치도 함께 갱신
  };
  // ===== 노트북 셀 강조: 현재(또는 실행 중인) 셀의 줄 범위에 은은한 보라 띠. 스크롤을 따라 움직인다 =====
  let cellStart = 0, cellEnd = 0;   // 1-based 줄 범위(0이면 강조 없음)
  const positionCellBand = () => {
    if (!cellStart){ cellBand.hidden = true; return; }
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    cellBand.style.top = (pt + (cellStart - 1) * lh - ta.scrollTop) + "px";
    cellBand.style.height = ((cellEnd - cellStart + 1) * lh) + "px";
    cellBand.hidden = false;
  };
  const clearCellBand = () => { cellStart = cellEnd = 0; cellBand.hidden = true; };
  const highlightCellRange = (s, e) => {
    const total = ta.value.split("\n").length;
    s = Math.max(1, Math.min(total, parseInt(s, 10) || 1));
    e = Math.max(s, Math.min(total, parseInt(e, 10) || s));
    cellStart = s; cellEnd = e; positionCellBand();
  };
  const markError = (n) => {
    n = parseInt(n, 10);
    const total = ta.value.split("\n").length;
    if (!n || n < 1 || n > total){ clearError(); return; }
    errLine = n; positionErr();
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20, y = (errLine - 1) * lh;
    if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - lh){ ta.scrollTop = Math.max(0, y - ta.clientHeight / 2); }  // 보이게 스크롤
    positionErr();
  };

  const focusLine = (n) => {
    const total = ta.value.split("\n").length;
    n = Math.max(1, Math.min(total, parseInt(n, 10) || 1));
    const offset = lineStartOffset(ta.value, n);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = offset;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (n - 1) * lh - ta.clientHeight * 0.35);
    jumpLine = n;
    positionJump();
    clearTimeout(jumpTimer);
    jumpTimer = setTimeout(clearJump, 2200);
    sync();
  };

  const refresh = () => {
    const val = ta.value;
    // Keep the final empty line measurable so the highlight layer and textarea
    // have the same maximum scroll position when the source ends with a newline.
    code.innerHTML = highlightCode(val, prof) + "&#8203;";
    const lines = val.split("\n").length;
    let nums = ""; for (let i = 1; i <= lines; i++) nums += i + "\n";
    gutter.textContent = nums;
  };
  // 들여쓰기 가이드: 보이는 줄의 들여쓰기 단계(4칸)마다 가는 세로 점선. 학생이 들여쓰기를 시각적 구조로 인식하게 도와 백스페이스 실수를 줄임.
  const INDENT_UNIT = 4;
  const renderIndentGuides = () => {
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20;
    const pt = parseFloat(cs.paddingTop) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    // 4칸 폭 측정(현재 폰트/크기 기준) — 폰트·크기 변경 시 자동으로 맞춰진다
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-family:" + cs.fontFamily + ";font-size:" + cs.fontSize + ";letter-spacing:" + cs.letterSpacing;
    probe.textContent = " ".repeat(INDENT_UNIT);
    edit.appendChild(probe);
    const stepW = probe.getBoundingClientRect().width;
    probe.remove();
    if (!stepW){ indentLayer.textContent = ""; return; }
    const lines = ta.value.split("\n");
    const total = lines.length;
    const viewH = ta.clientHeight;
    // 보이는 범위만 그려 성능 보호(수천 줄 파일에서도 가벼움)
    const firstVisible = Math.max(0, Math.floor(ta.scrollTop / lh) - 1);
    const lastVisible = Math.min(total - 1, Math.ceil((ta.scrollTop + viewH) / lh) + 1);
    let html = "";
    for (let i = firstVisible; i <= lastVisible; i++){
      const line = lines[i] || "";
      let leading = 0;
      for (let j = 0; j < line.length; j++){
        const c = line.charCodeAt(j);
        if (c === 32) leading++;                 // 스페이스
        else if (c === 9) leading += INDENT_UNIT;// 탭은 4칸으로 간주(파이썬 PEP 8 권장)
        else break;
      }
      const levels = Math.floor(leading / INDENT_UNIT);
      if (levels < 1) continue;
      const top = pt + i * lh - ta.scrollTop;
      for (let k = 0; k < levels; k++){
        const left = pl + k * stepW;
        html += '<div class="code-indent-guide" style="top:' + top + 'px;height:' + lh + 'px;left:' + left + 'px"></div>';
      }
    }
    indentLayer.innerHTML = html;
  };
  // 폰트 크기/패밀리 변경 시 applyEditorFontMetrics 에서 호출해 즉시 다시 그린다.
  host.__refreshIndent = renderIndentGuides;

  // ===== 코드 → PDF 역방향 핀: 거터에 📌 마커. 클릭하면 연결된 PDF 핀으로 이동(revealCodeLinkPin) =====
  const pinLayer = document.createElement("div"); pinLayer.className = "code-pin-layer"; pinLayer.setAttribute("aria-hidden", "true");
  host.appendChild(pinLayer);                         // host(.code-host-edit, position:relative)에서 거터 칸 위에 겹친다
  let pinProvider = null;                             // () => [{pdfDoc, el, line, label}]
  let pinMarks = [];                                  // [{line, el}] — 화면에 그린 마커들
  let pinRenderTimer = 0;
  const positionPins = () => {
    if (!pinMarks.length) return;
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    pinLayer.style.width = (gutter.offsetWidth || 0) + "px";
    const h = host.clientHeight;
    for (const m of pinMarks){
      const top = pt + (m.line - 1) * lh - ta.scrollTop;
      if (top < -lh || top > h){ m.el.style.display = "none"; continue; }   // 화면 밖 마커는 숨김
      m.el.style.display = "";
      m.el.style.top = top + "px";
      m.el.style.height = lh + "px";
    }
  };
  const buildPinMarks = () => {
    pinLayer.textContent = ""; pinMarks = [];
    const links = pinProvider ? (pinProvider() || []) : [];
    if (!links.length) return;
    const byLine = new Map();                          // 같은 줄에 여러 핀이면 하나로 묶고 배지로 개수 표시
    for (const lk of links){
      const ln = Math.max(1, lk.line || 1);
      if (!byLine.has(ln)) byLine.set(ln, []);
      byLine.get(ln).push(lk);
    }
    for (const [ln, group] of byLine){
      const mark = document.createElement("button");
      mark.type = "button"; mark.className = "code-pin-mark"; mark.textContent = "📌";
      mark.title = group.length > 1
        ? ("이 줄이 PDF " + group.length + "곳에 연결됨 · 클릭하면 차례로 이동")
        : "이 줄이 PDF에 연결됨 · 클릭하면 이동";
      if (group.length > 1){
        const badge = document.createElement("span"); badge.className = "code-pin-badge"; badge.textContent = String(group.length);
        mark.appendChild(badge);
      }
      let cycle = 0;
      mark.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const lk = group[cycle % group.length]; cycle++;      // 여러 곳이면 누를 때마다 다음 핀으로
        if (typeof revealCodeLinkPin === "function") revealCodeLinkPin(lk.pdfDoc, lk.el);
      });
      pinLayer.appendChild(mark);
      pinMarks.push({ line: ln, el: mark });
    }
    positionPins();
  };
  const schedulePinRender = () => { clearTimeout(pinRenderTimer); pinRenderTimer = setTimeout(buildPinMarks, 220); };
  host.__refreshPins = buildPinMarks;                 // 폰트 변경(applyEditorFontMetrics)에서 재배치

  let syncRaf = 0;
  const syncNow = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; positionErr(); positionTrace(); positionJump(); positionCellBand(); positionCaretLine(); positionPins(); renderWordHi(); renderDefinitionHover(); renderFindHi(); renderSpotlight(); renderIndentGuides(); renderCellDividers(); };
  const sync = () => {
    syncNow();
    cancelAnimationFrame(syncRaf);
    syncRaf = requestAnimationFrame(syncNow);   // 드래그 선택 자동 스크롤이 이벤트 후 반영되는 Chromium 보정
  };
  const measureScrollbars = () => {
    const sw = Math.max(0, ta.offsetWidth - ta.clientWidth);
    const sh = Math.max(0, ta.offsetHeight - ta.clientHeight);
    host.style.setProperty("--code-sbw", sw + "px");
    host.style.setProperty("--code-sbh", sh + "px");
    sync();
  };
  const syncSelection = () => { if (document.activeElement === ta){ computeWordHi(); sync(); } };
  document.addEventListener("selectionchange", syncSelection);
  let editorResizeObserver = null;
  if (typeof ResizeObserver !== "undefined"){
    editorResizeObserver = new ResizeObserver(measureScrollbars);
    editorResizeObserver.observe(edit);
  }
  setTimeout(measureScrollbars, 0);
  const emitInput = () => ta.dispatchEvent(new Event("input", { bubbles: true }));   // refresh/sync·편집상태·히스토리 기록을 한곳에서

  /* ===== Undo/Redo 히스토리 =====
     열 편집·Tab·Enter 자동들여쓰기는 ta.value 를 직접 바꿔 textarea 네이티브 undo 를 깨뜨린다.
     그래서 에디터 전체를 자체 스냅샷 스택으로 되돌린다(연속 입력은 350ms 로 한 단계로 묶음). */
  let history = [{ value: ta.value, s: 0, e: 0 }];
  let hindex = 0, applyingHistory = false, coalesceTimer = 0;
  const HISTORY_MAX = 300;
  const snapshot = () => ({ value: ta.value, s: ta.selectionStart, e: ta.selectionEnd });
  const commitNow = () => {
    if (applyingHistory) return;
    const st = snapshot();
    if (history[hindex] && history[hindex].value === st.value){ history[hindex] = st; return; }  // 값 동일 → 커서만 갱신
    history = history.slice(0, hindex + 1);
    history.push(st);
    if (history.length > HISTORY_MAX) history.shift();
    hindex = history.length - 1;
  };
  const commitSoon = () => { if (applyingHistory) return; clearTimeout(coalesceTimer); coalesceTimer = setTimeout(commitNow, 350); };
  const applyState = (st) => {
    applyingHistory = true;
    ta.value = st.value;
    ta.selectionStart = st.s; ta.selectionEnd = st.e;
    emitInput();                       // 하이라이트·스크롤·외부 편집상태 갱신(applyingHistory 라 재기록은 안 함)
    applyingHistory = false;
  };
  const undo = () => {
    clearTimeout(coalesceTimer);
    if (history[hindex].value !== ta.value) commitNow();   // 대기 중 입력을 먼저 한 단계로 확정(되돌린 뒤 redo 가능)
    if (hindex <= 0) return;
    hindex--; applyState(history[hindex]);
  };
  const redo = () => {
    clearTimeout(coalesceTimer);
    if (hindex >= history.length - 1) return;
    hindex++; applyState(history[hindex]);
  };
  const completion = { items: [], index: 0, start: 0, end: 0, manual: false };
  let completionTimer = 0;
  const hideCompletion = () => {
    clearTimeout(completionTimer); completionTimer = 0;
    complete.hidden = true; complete.textContent = ""; completion.items = []; completion.manual = false;
  };
  const completionContextFor = () => {
    if (typeof options.completionContext !== "function") return { source:ta.value, lineOffset:0 };
    try {
      const value = options.completionContext(ta.value, ta.selectionStart);
      if (value && typeof value === "object"){
        return {
          source:typeof value.source === "string" ? value.source : ta.value,
          lineOffset:Math.max(0, Number(value.lineOffset) || 0)
        };
      }
    } catch(e){}
    return { source:ta.value, lineOffset:0 };
  };
  // ── 함수 도움말(Shift+Tab) ───────────────────────────────────────────────
  let helpSeq = 0;
  const hideHelp = () => { help.hidden = true; help.textContent = ""; };
  const positionHelp = () => {
    const caret = ta.selectionStart;
    const before = ta.value.slice(0, caret);
    const lineText = before.slice(before.lastIndexOf("\n") + 1);
    const lineNo = (before.match(/\n/g) || []).length;
    const cs = getComputedStyle(ta);
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;tab-size:4;font-family:" + cs.fontFamily + ";font-size:" + cs.fontSize + ";font-weight:" + cs.fontWeight + ";letter-spacing:" + cs.letterSpacing;
    probe.textContent = lineText || " "; edit.appendChild(probe);
    const width = lineText ? probe.getBoundingClientRect().width : 0; probe.remove();
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const rect = ta.getBoundingClientRect();
    const left = rect.left + paddingLeft + width - ta.scrollLeft;
    const popupWidth = Math.min(480, Math.max(260, window.innerWidth - 16));
    help.style.width = popupWidth + "px";
    help.style.left = Math.max(8, Math.min(left, window.innerWidth - help.offsetWidth - 8)) + "px";
    let viewportTop = rect.top + paddingTop + (lineNo + 1) * lineHeight - ta.scrollTop + 4;
    const popupHeight = help.offsetHeight || 160;
    if (viewportTop + popupHeight > window.innerHeight - 8){
      viewportTop = rect.top + paddingTop + lineNo * lineHeight - ta.scrollTop - popupHeight - 6;
    }
    help.style.top = Math.max(8, Math.min(viewportTop, window.innerHeight - popupHeight - 8)) + "px";
  };
  const renderHelp = (data) => {
    help.textContent = "";
    if (!data || data.ok === false || (!data.signature && !data.docstring && !data.name)){
      const empty = document.createElement("div"); empty.className = "code-help-empty";
      empty.textContent = "이 위치에서는 함수 도움말을 찾지 못했어요. (실행 전 코드라면 먼저 import 해 보세요)";
      help.appendChild(empty); help.hidden = false; positionHelp(); return;
    }
    const head = document.createElement("div"); head.className = "code-help-head";
    const nm = document.createElement("code"); nm.className = "code-help-name";
    nm.textContent = String(data.signature || data.name || "");
    head.appendChild(nm);
    const close = document.createElement("button"); close.type = "button"; close.className = "code-help-close";
    close.textContent = "×"; close.title = "닫기 (Esc)"; close.addEventListener("mousedown", (e) => { e.preventDefault(); hideHelp(); });
    head.appendChild(close);
    help.appendChild(head);
    if (data.docstring){
      const doc = document.createElement("pre"); doc.className = "code-help-doc"; doc.textContent = String(data.docstring);
      help.appendChild(doc);
    }
    help.hidden = false; positionHelp();
  };
  const showFunctionHelp = async () => {
    if (!jediReady()) return;
    const caret = ta.selectionStart;
    const context = completionContextFor();
    const before = ta.value.slice(0, caret);
    const line = context.lineOffset + (before.match(/\n/g) || []).length + 1;   // Jedi: 1-based
    const column = caret - (before.lastIndexOf("\n") + 1);                        // Jedi: 0-based
    const seq = ++helpSeq;
    help.textContent = "";
    const loading = document.createElement("div"); loading.className = "code-help-loading"; loading.textContent = "함수 도움말 불러오는 중…";
    help.appendChild(loading); help.hidden = false; positionHelp();
    let data = null;
    try { data = await requestJediHelp(context.source, line, column); } catch(_){ data = null; }
    if (seq !== helpSeq) return;   // 더 최신 도움말 요청이 시작됐을 때만 폐기(로딩이 남지 않도록 나머지는 항상 렌더)
    renderHelp(data);
  };
  let helpHover = false;
  help.addEventListener("mouseenter", () => { helpHover = true; });
  help.addEventListener("mouseleave", () => { helpHover = false; });
  const hidePortalOnScroll = (e) => {
    const t = e && e.target;
    // 도움말·자동완성 팝업 안에서 휠로 스크롤하는 건 닫지 않는다(내용을 읽으려 스크롤하는 경우).
    if (t && t.nodeType === 1 && (help.contains(t) || complete.contains(t))) return;
    if (completionPortal && !complete.hidden) hideCompletion();
    if (!help.hidden) hideHelp();
  };
  window.addEventListener("scroll", hidePortalOnScroll, true);
  window.addEventListener("resize", hidePortalOnScroll);
  // 편집기 밖으로 포커스가 나가면 닫되, 팝업 위에 마우스가 있으면(스크롤·텍스트 복사 중) 유지한다.
  ta.addEventListener("blur", () => setTimeout(() => {
    if (!helpHover && document.activeElement !== ta && !help.contains(document.activeElement)) hideHelp();
  }, 150));
  const completionWord = () => {
    if (ta.selectionStart !== ta.selectionEnd) return null;
    const end = ta.selectionStart;
    const match = ta.value.slice(0, end).match(/[A-Za-z_][A-Za-z0-9_]*$/);
    return { prefix: match ? match[0] : "", start: end - (match ? match[0].length : 0), end };
  };
  const positionCompletion = () => {
    const before = ta.value.slice(0, completion.end);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const lineNo = (before.match(/\n/g) || []).length;
    const cs = getComputedStyle(ta);
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;tab-size:4;font-family:" + cs.fontFamily + ";font-size:" + cs.fontSize + ";font-weight:" + cs.fontWeight + ";letter-spacing:" + cs.letterSpacing;
    probe.textContent = line || " "; edit.appendChild(probe);
    const width = line ? probe.getBoundingClientRect().width : 0; probe.remove();
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const left = paddingLeft + width - ta.scrollLeft;
    const top = paddingTop + (lineNo + 1) * lineHeight - ta.scrollTop;
    if (completionPortal){
      const rect = ta.getBoundingClientRect();
      const popupWidth = Math.min(440, Math.max(220, edit.clientWidth - 8, 0));
      complete.style.width = Math.min(popupWidth, Math.max(120, window.innerWidth - 16)) + "px";
      complete.style.left = Math.max(8, Math.min(rect.left + left, window.innerWidth - complete.offsetWidth - 8)) + "px";
      let viewportTop = rect.top + top;
      const popupHeight = complete.offsetHeight || 220;
      if (viewportTop + popupHeight > window.innerHeight - 8){
        viewportTop = rect.top + paddingTop + lineNo * lineHeight - ta.scrollTop - popupHeight - 4;
      }
      complete.style.top = Math.max(8, Math.min(viewportTop, window.innerHeight - popupHeight - 8)) + "px";
      return;
    }
    const popupWidth = complete.offsetWidth || Math.min(440, Math.max(220, edit.clientWidth - 8));
    complete.style.left = Math.max(4, Math.min(left, edit.clientWidth - popupWidth - 4)) + "px";
    complete.style.top = Math.max(4, Math.min(top, edit.clientHeight - 220)) + "px";
  };
  const renderCompletion = () => {
    complete.textContent = "";
    completion.items.forEach((word, index) => {
      const info = word && typeof word === "object"
        ? word
        : { name: String(word || ""), type: "", signature: "" };
      const item = document.createElement("button"); item.type = "button"; item.className = "code-complete-item";
      item.setAttribute("role", "option"); item.setAttribute("aria-selected", String(index === completion.index));
      const name = document.createElement("span"); name.className = "code-complete-name"; name.textContent = info.name;
      item.appendChild(name);
      if (info.signature){
        const signature = document.createElement("span");
        signature.className = "code-complete-signature";
        signature.textContent = info.signature;
        item.appendChild(signature);
        item.title = info.signature;
      }
      item.addEventListener("mousedown", (e) => { e.preventDefault(); completion.index = index; acceptCompletion(); });
      complete.appendChild(item);
    });
    complete.hidden = false;
    positionCompletion();
    const active = complete.children[completion.index]; if (active) active.scrollIntoView({ block: "nearest" });
  };
  let completionSeq = 0;                                   // 비동기 Jedi 응답 경합 방지(최신 요청만 반영)
  const showLocalCompletion = (word, contextSource=null) => { // 빠른 버퍼 단어 + 키워드 후보를 즉시 표시
    const source = typeof contextSource === "string" ? contextSource : completionContextFor().source;
    const items = pythonCompletionCandidates(source, word.prefix).slice(0, 10);
    if (!items.length){ hideCompletion(); return false; }
    completion.items = items; completion.index = 0; completion.start = word.start; completion.end = word.end;
    renderCompletion();
    return true;
  };
  // 다 친 단어(=후보 이름이 지금 친 단어와 정확히 일치)는 자동 팝업에서 제외한다 — 이미 다 쳐서 더 채울 게 없으므로.
  // 단 함수형 후보는 남겨 accept 시 "()" 자동 완성 편의를 유지한다(A-2). 로컬 후보는 core 에서 이미 정확 일치를 제외한다.
  const pruneFullyTyped = (items, prefix) => {
    if (!prefix) return items || [];
    return (items || []).filter(it => {
      const name = (it && typeof it === "object") ? String(it.name || "") : String(it || "");
      if (name !== prefix) return true;                   // 아직 덜 친 후보는 유지
      const type = (it && typeof it === "object" ? String(it.type || "") : "").toLowerCase();
      return type === "function";                         // 다 친 단어라도 함수형이면 유지
    });
  };
  const showCompletion = (manual=false) => {
    clearTimeout(completionTimer); completionTimer = 0;
    completionSeq++;                                       // 진행 중이던 Jedi 응답 무효화
    const word = completionWord();
    if (!word){ hideCompletion(); return; }
    const dotContext = word.start > 0 && ta.value[word.start - 1] === ".";   // obj. 처럼 멤버 접근 문맥
    if (!manual && !dotContext && word.prefix.length < 1){ hideCompletion(); return; }
    completion.manual = manual;
    // 로컬 후보는 즉시 보여 주고, 더 정확한 Jedi 결과가 오면 같은 팝업을 비동기로 보강한다.
    // 네트워크 왕복과 서버의 Python 프로세스 시작을 기다리는 동안 팝업이 비어 있지 않아 체감 지연이 줄어든다.
    if (jediReady()){
      const seq = completionSeq, caret = ta.selectionStart, currentSource = ta.value;
      const context = completionContextFor(), source = context.source;
      const localShown = showLocalCompletion(word, source);
      const before = currentSource.slice(0, caret);
      const line = context.lineOffset + (before.match(/\n/g) || []).length + 1; // Jedi: 줄 1-based
      const column = caret - (before.lastIndexOf("\n") + 1);          // Jedi: 칸 0-based
      requestJediCompletions(source, line, column).then(items => {
        if (seq !== completionSeq || ta.selectionStart !== caret) return;   // 더 최신 요청·커서 이동 → 폐기
        const pruned = manual ? (items || []) : pruneFullyTyped(items, word.prefix);   // 수동(Ctrl+Space)은 그대로
        if (pruned.length){
          completion.items = pruned.slice(0, 12); completion.index = 0;
          completion.start = word.start; completion.end = word.end;
          renderCompletion();
        } else if (!localShown) hideCompletion();     // Jedi·로컬 후보가 모두 없을 때만 닫힘(로컬 버퍼 후보가 떠 있으면 유지)
      });
      return;
    }
    showLocalCompletion(word);
  };
  const scheduleCompletion = () => {
    clearTimeout(completionTimer);
    completionTimer = setTimeout(() => showCompletion(false), 60);
  };
  function acceptCompletion(){
    const selected = completion.items[completion.index]; if (!selected) return;
    const info = selected && typeof selected === "object"
      ? selected
      : { name: String(selected || ""), type: "", signature: "" };
    const range = completionReplacementRange(ta.value, ta.selectionStart, ta.selectionEnd, completion.start, completion.end, info.name);
    const insertion = completionInsertionPlan(ta.value, range, info);
    ta.value = ta.value.slice(0, range.start) + insertion.text + ta.value.slice(range.end);
    ta.selectionStart = ta.selectionEnd = insertion.caret;
    hideCompletion(); emitInput(); scrollCaretIntoView();
  }
  const insertPair = (open, close) => {
    const start = ta.selectionStart, end = ta.selectionEnd, selected = ta.value.slice(start, end);
    ta.value = ta.value.slice(0, start) + open + selected + close + ta.value.slice(end);
    if (start === end) ta.selectionStart = ta.selectionEnd = start + open.length;
    else { ta.selectionStart = start + open.length; ta.selectionEnd = end + open.length; }
    hideCompletion(); emitInput();
  };
  const applyLineAction = (action) => {
    hideCompletion();
    exitCol();
    clearTimeout(coalesceTimer);
    commitNow();
    const next = transformEditorLines(ta.value, ta.selectionStart, ta.selectionEnd, action);
    // 값과 선택이 모두 그대로일 때만 no-op(예: 첫 줄에서 위로 이동). 줄 복사 직후처럼 위·아래 줄이
    // 똑같으면 자리 바꿔도 텍스트는 같지만 커서는 옮겨가야 하므로 선택까지 비교한다.
    if (next.value === ta.value && next.selectionStart === ta.selectionStart && next.selectionEnd === ta.selectionEnd) return;
    ta.value = next.value;
    ta.selectionStart = next.selectionStart; ta.selectionEnd = next.selectionEnd;
    emitInput();
    clearTimeout(coalesceTimer);
    commitNow();
    scrollCaretIntoView();                       // 줄 이동·복제로 커서가 화면 밖으로 나가면 따라가게
  };

  /* ===== 셀 나누기: 거터(줄번호)를 클릭하면 그 줄에 # %% 경계를 넣거나 뺀다 =====
     경계는 텍스트 안의 # %% 로 남으므로, 완료 후 변환(splitNotebookCells)은 그대로 재사용된다. */
  const CELL_MARKER_RE = /^\s*#+\s*%%/;
  renderCellDividers = () => {                    // 위에서 let 으로 예약 선언한 것을 여기서 실제 구현으로 교체
    const lines = ta.value.split("\n");
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    let html = "";
    for (let i = 1; i < lines.length; i++){       // 맨 위(첫 셀) 경계선은 생략
      if (!CELL_MARKER_RE.test(lines[i])) continue;
      const top = pt + i * lh - ta.scrollTop;
      html += '<div class="cell-div" style="top:' + top.toFixed(1) + 'px"></div>';
    }
    cellDivLayer.innerHTML = html;
  };
  const toggleCellBoundaryAtLine = (line) => {
    hideCompletion(); exitCol();
    clearTimeout(coalesceTimer); commitNow();
    const lines = ta.value.split("\n");
    const total = lines.length;
    line = Math.max(1, Math.min(total, parseInt(line, 10) || 1));
    const idx = line - 1;
    let caretLine;
    if (CELL_MARKER_RE.test(lines[idx])){          // 마커 줄 자체를 클릭 → 제거
      if (idx === 0) return;                       // 첫 셀 경계는 코드 유실 방지를 위해 고정
      lines.splice(idx, 1); caretLine = Math.max(1, idx);
    } else if (idx > 0 && CELL_MARKER_RE.test(lines[idx - 1])){   // 바로 위가 마커 → 경계 해제
      if (idx - 1 === 0) return;                   // 첫 코드 줄을 눌러도 첫 경계는 유지
      lines.splice(idx - 1, 1); caretLine = idx;
    } else {                                       // 경계 생성: 이 줄 위에 # %%
      lines.splice(idx, 0, "# %%"); caretLine = line + 1;
    }
    const next = lines.join("\n");
    ta.value = next;
    const nTotal = next.split("\n").length;
    const off = lineStartOffset(next, Math.max(1, Math.min(nTotal, caretLine)));
    ta.selectionStart = ta.selectionEnd = off;
    emitInput();
    clearTimeout(coalesceTimer); commitNow();
    syncNow();
  };
  let cellSplitMode = false;
  const setCellSplitMode = (on) => {
    cellSplitMode = !!on;
    gutter.classList.toggle("is-splitting", cellSplitMode);
    edit.classList.toggle("cell-split-mode", cellSplitMode);
    renderCellDividers();
  };
  gutter.addEventListener("mousedown", (e) => {
    if (!cellSplitMode) return;
    e.preventDefault();                            // 거터 클릭이 텍스트 선택·포커스를 흔들지 않게
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const pt = parseFloat(getComputedStyle(gutter).paddingTop) || 0;
    const rect = gutter.getBoundingClientRect();
    const y = e.clientY - rect.top + gutter.scrollTop - pt;
    toggleCellBoundaryAtLine(Math.floor(y / lh) + 1);
  });
  // 빈 줄 뒤 최상위(들여쓰기 0) 문장마다 # %% 를 넣어 한 번에 나누기(이후 거터 클릭으로 조정).
  const autoSplitCells = () => {
    hideCompletion(); exitCol();
    clearTimeout(coalesceTimer); commitNow();
    const src = ta.value.split("\n");
    const out = [];
    let sawCode = false, blankRun = 0;
    for (const ln of src){
      const trimmed = ln.trim();
      if (CELL_MARKER_RE.test(ln)){ out.push(ln); sawCode = true; blankRun = 0; continue; }
      const indented = /^\s/.test(ln);
      if (trimmed && !indented && sawCode && blankRun >= 1){
        let k = out.length - 1;
        while (k >= 0 && !out[k].trim()) k--;       // 앞의 빈 줄들을 건너뛴 실제 이전 줄
        if (k < 0 || !CELL_MARKER_RE.test(out[k])) out.push("# %%");
      }
      out.push(ln);
      if (trimmed){ sawCode = true; blankRun = 0; } else blankRun++;
    }
    const next = ensureFirstNotebookCellMarker(out.join("\n"));
    if (next === ta.value){ syncNow(); return false; }
    ta.value = next;
    ta.selectionStart = ta.selectionEnd = Math.min(ta.selectionStart, next.length);
    emitInput();
    clearTimeout(coalesceTimer); commitNow();
    syncNow();
    return true;
  };

  /* ===== Alt+세로 드래그 열(블록) 편집 — 여러 줄의 같은 열을 동시에 삽입/교체 =====
     textarea 가 텍스트 원본을 그대로 보관하고, 그 위 overlay 에 가짜 선택 박스·커서를 그린다.
     활성 중에는 textarea 의 네이티브 커서를 감추고(키 입력을 가로채) 각 줄에 같은 편집을 적용한다.
     열 좌표는 문자 인덱스 기준(고정폭 폰트). 들여쓰기는 공백 4칸이라 정렬이 맞는다. */
  const col = { active: false };
  const colMetrics = () => {
    const cs = getComputedStyle(ta);
    const span = document.createElement("span");
    span.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-family:" + cs.fontFamily + ";font-size:" + cs.fontSize;
    span.textContent = "0000000000"; edit.appendChild(span);
    const cw = span.getBoundingClientRect().width / 10; span.remove();
    return { cw, lh: parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.6), pl: parseFloat(cs.paddingLeft) || 0, pt: parseFloat(cs.paddingTop) || 0 };
  };
  // ===== 같은 단어 음영(렌더는 보이는 화면 범위만, 스캔은 선택이 바뀔 때만) =====
  // 한글 등 전각 문자는 글자폭이 영문 1ch 와 달라, 가로 위치/너비는 산술이 아니라 줄 앞부분을 실제 측정해서 잡는다.
  const isWordCh = (ch) => ch !== undefined && /[\w가-힣]/.test(ch);   // 식별자 문자(한글 포함) — 온전한 단어 경계 판정
  let wordHiSpan = null;
  renderWordHi = () => {
    wordHi.textContent = "";
    if (!wordHiOcc.length) return;
    const m = colMetrics();
    const first = Math.floor(ta.scrollTop / m.lh) - 1;
    const last = first + Math.ceil(ta.clientHeight / m.lh) + 2;
    if (!wordHiSpan){
      wordHiSpan = document.createElement("span"); wordHiSpan.setAttribute("aria-hidden", "true");
      wordHiSpan.style.cssText = "position:absolute;visibility:hidden;white-space:pre;tab-size:4;top:-9999px;left:0";
      edit.appendChild(wordHiSpan);
    }
    const cs = getComputedStyle(ta);
    wordHiSpan.style.fontFamily = cs.fontFamily; wordHiSpan.style.fontSize = cs.fontSize;
    wordHiSpan.style.fontWeight = cs.fontWeight; wordHiSpan.style.fontStyle = cs.fontStyle; wordHiSpan.style.letterSpacing = cs.letterSpacing;
    for (const o of wordHiOcc){
      if (o.line < first || o.line > last) continue;        // 화면 밖은 그리지 않음(대용량 보호)
      wordHiSpan.textContent = o.prefix; const lw = wordHiSpan.getBoundingClientRect().width;   // 줄 시작~단어 앞까지 실제 폭
      wordHiSpan.textContent = o.text;   const ww = wordHiSpan.getBoundingClientRect().width;   // 단어 자체 폭
      const box = document.createElement("div"); box.className = "word-hi";
      box.style.cssText = "left:" + (m.pl + lw - ta.scrollLeft) + "px;top:" + (m.pt + o.line * m.lh - ta.scrollTop) +
                          "px;width:" + ww + "px;height:" + m.lh + "px";
      wordHi.appendChild(box);
    }
  };
  const renderLinkedEditRanges = () => {
    if (!linkedEdit.active){ clearWordHi(); return; }
    const v = ta.value, occ = [];
    let scan = 0, curLine = 0, curLineStart = 0;
    linkedEdit.ranges.forEach((range, index) => {
      while (scan < range.start){
        if (v.charCodeAt(scan) === 10){ curLine++; curLineStart = scan + 1; }
        scan++;
      }
      const isNativeSelection = index === linkedEdit.primaryIndex &&
        ta.selectionStart === range.start && ta.selectionEnd === range.end;
      if (!isNativeSelection) occ.push({
        line: curLine,
        prefix: v.slice(curLineStart, range.start),
        text: v.slice(range.start, range.end)
      });
    });
    wordHiOcc = occ;
    renderWordHi();
  };
  computeWordHi = () => {
    if (col.active){ clearWordHi(); return; }                // 열(블록) 편집 중엔 비활성
    if (linkedEdit.active){ renderLinkedEditRanges(); return; }
    const s = ta.selectionStart, e = ta.selectionEnd;
    const term = (s !== e) ? ta.value.slice(s, e) : "";
    if (!term || term.length > 80 || !/^[\w가-힣]+$/.test(term)){ clearWordHi(); return; }   // 단어 하나일 때만
    const v = ta.value;
    if (v.length > 200000){ clearWordHi(); return; }         // 초대용량은 스캔 생략
    const occ = [];
    let p = 0, scan = 0, curLine = 0, curLineStart = 0;
    while ((p = v.indexOf(term, p)) !== -1){
      if (!isWordCh(v[p - 1]) && !isWordCh(v[p + term.length])){   // 온전한 단어만(부분일치 제외)
        if (p !== s){                                        // 선택한 단어 자신은 네이티브 선택색으로 보임 → 제외
          while (scan < p){ if (v.charCodeAt(scan) === 10){ curLine++; curLineStart = scan + 1; } scan++; }
          // 가로 위치 측정용으로 줄 앞부분(prefix)과 단어(text)를 함께 보관 — 한글 폭까지 정확히 반영
          occ.push({ line: curLine, prefix: v.slice(curLineStart, p), text: v.slice(p, p + term.length) });
          if (occ.length >= 2000) break;
        }
      }
      p += term.length;
    }
    wordHiOcc = occ;
    renderWordHi();
  };
  const startLinkedEdit = () => {
    const match = identifierOccurrences(ta.value, ta.selectionStart, ta.selectionEnd);
    if (!match){ exitLinkedEdit(); return; }
    linkedEdit.active = true;
    linkedEdit.term = match.term;
    linkedEdit.ranges = match.ranges;
    linkedEdit.primaryIndex = match.primaryIndex;
    edit.classList.add("linked-edit-mode");
    renderLinkedEditRanges();
  };
  const exitCol = () => { if (!col.active) return; col.active = false; edit.classList.remove("col-mode"); overlay.textContent = ""; clearWordHi(); };
  const ptToLineCol = (clientX, clientY, m) => {
    const r = ta.getBoundingClientRect();
    const lines = ta.value.split("\n");
    let line = Math.floor((clientY - r.top - m.pt + ta.scrollTop) / m.lh);
    line = Math.max(0, Math.min(line, lines.length - 1));
    let colv = Math.round((clientX - r.left - m.pl + ta.scrollLeft) / m.cw);
    return { line, colv: Math.max(0, colv), lines };
  };
  const lineColToOffset = (line, colv) => {
    const lines = ta.value.split("\n");
    let off = 0; for (let i = 0; i < line && i < lines.length; i++) off += lines[i].length + 1;
    return off + Math.min(colv, (lines[line] || "").length);
  };
  col.render = () => {
    overlay.textContent = "";
    if (!col.active) return;
    const m = col.m, lines = ta.value.split("\n");
    for (let i = col.lineStart; i <= col.lineEnd && i < lines.length; i++){
      const len = lines[i].length;
      const sa = Math.min(col.leftCol, len), sb = Math.min(col.rightCol, len);
      const top = m.pt + i * m.lh - ta.scrollTop;
      if (sb > sa){
        const box = document.createElement("div"); box.className = "col-sel";
        box.style.cssText = "left:" + (m.pl + sa * m.cw - ta.scrollLeft) + "px;top:" + top + "px;width:" + ((sb - sa) * m.cw) + "px;height:" + m.lh + "px";
        overlay.appendChild(box);
      }
      const caretColV = col.caretSide === "left" ? col.leftCol : col.rightCol;
      const cc = Math.min(caretColV, len);
      const car = document.createElement("div"); car.className = "col-caret";
      car.style.cssText = "left:" + (m.pl + cc * m.cw - ta.scrollLeft) + "px;top:" + top + "px;height:" + m.lh + "px";
      overlay.appendChild(car);
    }
  };
  const colEachLine = (mutate) => {        // lineStart..lineEnd 각 줄을 mutate(text, a, b) 로 바꾼다(a,b=그 줄의 선택 시작/끝)
    const lines = ta.value.split("\n"), L = col.leftCol, R = col.rightCol;
    for (let i = col.lineStart; i <= col.lineEnd && i < lines.length; i++){
      const s = lines[i], len = s.length;
      lines[i] = mutate(s, Math.min(L, len), Math.min(R, len));
    }
    ta.value = lines.join("\n");
    emitInput();        // 하이라이트·저장상태·히스토리 기록이 함께 갱신
    col.render();
  };
  const colInsert = (text) => {
    colEachLine((s, a, b) => s.slice(0, a) + text + s.slice(b));
    col.leftCol = col.rightCol = col.leftCol + text.length; col.caretSide = "right"; col.render();
  };
  const colBackspace = () => {
    if (col.rightCol > col.leftCol){ colEachLine((s, a, b) => s.slice(0, a) + s.slice(b)); col.rightCol = col.leftCol; }
    else if (col.leftCol > 0){ colEachLine((s, a) => a > 0 ? s.slice(0, a - 1) + s.slice(a) : s); col.leftCol = col.rightCol = col.leftCol - 1; }
    col.caretSide = "left"; col.render();
  };
  const colDelete = () => {
    if (col.rightCol > col.leftCol){ colEachLine((s, a, b) => s.slice(0, a) + s.slice(b)); col.rightCol = col.leftCol; }
    else colEachLine((s, a) => a < s.length ? s.slice(0, a) + s.slice(a + 1) : s);
    col.render();
  };
  ta.addEventListener("mousedown", (e) => {
    if (!e.altKey || e.button !== 0){ exitCol(); return; }
    e.preventDefault(); ta.focus();
    const m = colMetrics(); col.m = m;
    const start = ptToLineCol(e.clientX, e.clientY, m);
    col.anchorLine = start.line; col.anchorColV = start.colv; col.active = true;
    edit.classList.add("col-mode");
    const move = (ev) => {
      const cur = ptToLineCol(ev.clientX, ev.clientY, col.m);
      col.lineStart = Math.min(col.anchorLine, cur.line); col.lineEnd = Math.max(col.anchorLine, cur.line);
      col.leftCol = Math.min(col.anchorColV, cur.colv); col.rightCol = Math.max(col.anchorColV, cur.colv);
      col.caretSide = cur.colv >= col.anchorColV ? "right" : "left";
      col.render();
    };
    const up = () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      if (col.lineStart === col.lineEnd && col.leftCol === col.rightCol){   // 움직임 없음 → 일반 커서로 복귀
        const off = lineColToOffset(col.lineStart, col.leftCol); exitCol();
        ta.selectionStart = ta.selectionEnd = off;
      } else toast("열 편집 모드 — 입력하면 모든 줄에 동시 적용, Esc로 종료", 2800);
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    move(e);
  });
  ta.addEventListener("blur", () => { exitCol(); exitLinkedEdit(); hideCompletion(); clearDefinitionHover(); });
  // 더블클릭 단어 선택: 기본 선택의 공백 깜빡임을 막되, 한글처럼 폭이 넓은 문자가 앞에 있어도 밀리지 않게
  // 클릭한 줄의 실제 렌더링 폭을 측정해서 문자 위치를 찾는다.
  const isWordChar = (ch) => !!ch && (/[A-Za-z0-9_]/.test(ch) || (ch.charCodeAt(0) > 127 && !/\s/.test(ch)));
  const wordAtOffset = (offset) => {
    const text = ta.value;
    let pos = Math.max(0, Math.min(Number(offset) || 0, text.length));
    if (!isWordChar(text[pos]) && pos > 0 && isWordChar(text[pos - 1])) pos--;
    if (!isWordChar(text[pos])) return null;
    let s = pos, en = pos + 1;
    while (s > 0 && isWordChar(text[s - 1])) s--;
    while (en < text.length && isWordChar(text[en])) en++;
    return { start: s, end: en, word: text.slice(s, en), point: pos };
  };
  const openDefinitionAt = async (wordInfo) => {
    if (!wordInfo || !wordInfo.word) return;
    const localDef = findPythonLocalDefinition(ta.value, wordInfo.word, wordInfo.start);
    if (localDef && localDef.line){
      focusLine(localDef.line);
      toast("현재 파일의 " + (localDef.kind === "class" ? "클래스" : "함수") + " 정의로 이동했습니다.", 1400);
      return;
    }
    if (!jediReady()){
      toast("정의 이동은 exe + 로컬 Python/Jedi에서 사용할 수 있어요.", 2800);
      return;
    }
    const before = ta.value.slice(0, wordInfo.point);
    const line = (before.match(/\n/g) || []).length + 1;
    const column = wordInfo.point - (before.lastIndexOf("\n") + 1);
    const def = await requestJediDefinition(ta.value, line, column);
    if (!def || def.reason === "builtin"){
      toast("내장 함수이거나 열 수 있는 Python 소스/스텁 파일이 없습니다.", 2800);
      return;
    }
    if (!def.ok || !def.path){
      toast("정의 위치를 찾지 못했습니다.", 2200);
      return;
    }
    const buf = await readLocalDefinitionFile(def.path);
    if (!buf){
      toast("정의 소스/스텁 파일을 열 수 없습니다.", 2200);
      return;
    }
    const normPath = String(def.path).replace(/\\/g, "/");
    const base = normPath.split("/").pop() || (def.name || "definition") + ".py";
    const sourceKey = "definition:" + normPath;        // 경로 정규화 → 재클릭 시 중복 탭 방지
    const targetLine = def.line || 1;
    // 소스키로 되찾지 않고, 연(또는 이미 열린) 문서를 직접 받아 그 줄로 이동.
    const target = await handleFiles([new File([buf], base, { type: "text/x-python" })], { sourceKey, workspacePath: def.path });
    if (target){
      const navigator = target.codeEditor || target.codeViewer;
      if (navigator && navigator.focusLine) navigator.focusLine(targetLine);
      else target.pendingFocusLine = targetLine;       // 아직 렌더 전 → editor 부착 시 renderCode 가 소비
    }
    toast("정의 파일을 열었습니다.", 1400);
  };
  let clickMeasureSpan = null;
  const measureCodeText = (text) => {
    if (!clickMeasureSpan){
      clickMeasureSpan = document.createElement("span");
      clickMeasureSpan.setAttribute("aria-hidden", "true");
      clickMeasureSpan.style.cssText = "position:absolute;visibility:hidden;white-space:pre;tab-size:4;top:-9999px;left:0";
      edit.appendChild(clickMeasureSpan);
    }
    const cs = getComputedStyle(ta);
    clickMeasureSpan.style.fontFamily = cs.fontFamily; clickMeasureSpan.style.fontSize = cs.fontSize;
    clickMeasureSpan.style.fontWeight = cs.fontWeight; clickMeasureSpan.style.fontStyle = cs.fontStyle; clickMeasureSpan.style.letterSpacing = cs.letterSpacing;
    clickMeasureSpan.textContent = text;
    return clickMeasureSpan.getBoundingClientRect().width;
  };
  const offsetFromMeasuredPoint = (clientX, clientY) => {
    const m = colMetrics(), r = ta.getBoundingClientRect(), lines = ta.value.split("\n");
    let lineIndex = Math.floor((clientY - r.top - m.pt + ta.scrollTop) / m.lh);
    lineIndex = Math.max(0, Math.min(lineIndex, lines.length - 1));
    let base = 0; for (let i = 0; i < lineIndex; i++) base += lines[i].length + 1;
    const line = lines[lineIndex] || "";
    const targetX = Math.max(0, clientX - r.left - m.pl + ta.scrollLeft);
    const widthTo = (index) => measureCodeText(line.slice(0, index));
    let lo = 0, hi = line.length;
    while (lo < hi){
      const mid = Math.floor((lo + hi) / 2);
      if (widthTo(mid) < targetX) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(widthTo(lo - 1) - targetX) <= Math.abs(widthTo(lo) - targetX)) lo--;
    return base + Math.max(0, Math.min(lo, line.length));
  };
  renderDefinitionHover = () => {
    defHover.textContent = "";
    if (!defHoverInfo) return;
    if (ta.value.slice(defHoverInfo.start, defHoverInfo.end) !== defHoverInfo.word){ clearDefinitionHover(); return; }
    const m = colMetrics();
    const line = lineNumberAtOffset(ta.value, defHoverInfo.start);
    const lineStart = lineStartOffset(ta.value, line);
    const prefix = ta.value.slice(lineStart, defHoverInfo.start);
    const lw = measureCodeText(prefix);
    const ww = measureCodeText(defHoverInfo.word);
    const box = document.createElement("div");
    box.className = "code-def-hover";
    box.style.cssText = "left:" + (m.pl + lw - ta.scrollLeft) + "px;top:" + (m.pt + (line - 1) * m.lh - ta.scrollTop) +
                        "px;width:" + ww + "px;height:" + m.lh + "px";
    defHover.appendChild(box);
  };
  let defHoverPointer = null, defHoverRaf = 0;
  const showDefinitionHoverAt = (clientX, clientY) => {
    if (col.active){ clearDefinitionHover(); return; }
    const info = wordAtOffset(offsetFromMeasuredPoint(clientX, clientY));
    if (!info){ clearDefinitionHover(); return; }
    if (defHoverInfo && defHoverInfo.start === info.start && defHoverInfo.end === info.end && defHoverInfo.word === info.word) return;
    defHoverInfo = info;
    edit.classList.add("code-def-linking");
    renderDefinitionHover();
  };
  const scheduleDefinitionHoverAt = (clientX, clientY) => {
    defHoverPointer = { x: clientX, y: clientY };
    if (defHoverRaf) return;
    defHoverRaf = requestAnimationFrame(() => {
      defHoverRaf = 0;
      if (defHoverPointer) showDefinitionHoverAt(defHoverPointer.x, defHoverPointer.y);
    });
  };
  // Ctrl 호버 = 정의 이동 준비, Alt 호버 = 함수 도움말 준비 — 둘 다 같은 밑줄로 "누를 수 있음"을 표시.
  const hoverLinkModifier = (e) => (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey)
    || (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && jediReady());
  ta.addEventListener("mousemove", (e) => {
    defHoverPointer = { x: e.clientX, y: e.clientY };
    if (hoverLinkModifier(e)) scheduleDefinitionHoverAt(e.clientX, e.clientY);
    else clearDefinitionHover();
  });
  ta.addEventListener("mouseleave", () => { defHoverPointer = null; clearDefinitionHover(); });
  window.addEventListener("keydown", (e) => {
    if ((e.key === "Control" || e.key === "Alt") && defHoverPointer) scheduleDefinitionHoverAt(defHoverPointer.x, defHoverPointer.y);
  });
  window.addEventListener("keyup", (e) => { if (e.key === "Control" || e.key === "Alt") clearDefinitionHover(); });
  window.addEventListener("blur", clearDefinitionHover);
  ta.addEventListener("mousedown", (e) => {
    if (linkedEdit.active && e.button === 0 && e.detail === 1) exitLinkedEdit();
    if (e.button === 0 && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey){
      const info = wordAtOffset(offsetFromMeasuredPoint(e.clientX, e.clientY));
      if (info){
        e.preventDefault();
        ta.focus();
        ta.setSelectionRange(info.start, info.end);
        computeWordHi();
        sync();
        openDefinitionAt(info);
      }
      return;
    }
    // Alt+클릭: 클릭한 함수의 도움말 팝업(Shift+Tab 과 동일). Ctrl+클릭은 정의 이동이라 Alt 로 분리.
    if (e.button === 0 && e.altKey && !e.ctrlKey && !e.metaKey && jediReady()){
      const info = wordAtOffset(offsetFromMeasuredPoint(e.clientX, e.clientY));
      if (info){
        e.preventDefault();
        clearDefinitionHover();
        ta.focus();
        ta.setSelectionRange(info.end, info.end);
        hideCompletion();
        showFunctionHelp();
      }
      return;
    }
    if (e.button !== 0 || e.altKey || e.detail !== 2) return;
    const pos = offsetFromMeasuredPoint(e.clientX, e.clientY);
    const info = wordAtOffset(pos);
    if (info){
      e.preventDefault();
      ta.focus();
      ta.setSelectionRange(info.start, info.end);
      hideCompletion();
      computeWordHi();
      sync();
    }
  });
  ta.addEventListener("dblclick", () => {
    hideCompletion();
    requestAnimationFrame(() => {
      if (!ta.isConnected) return;
      const next = normalizeIdentifierSelection(ta.value, ta.selectionStart, ta.selectionEnd);
      ta.setSelectionRange(next.selectionStart, next.selectionEnd);
      startLinkedEdit();
    });
  });

  ta.addEventListener("beforeinput", (e) => {
    if (!linkedEdit.active || !e.isTrusted) return;
    linkedBeforeInput = {
      value: ta.value,
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd,
      ranges: linkedEdit.ranges.map((range) => ({ start: range.start, end: range.end })),
      primaryIndex: linkedEdit.primaryIndex
    };
  });
  ta.addEventListener("input", (e) => {
    if (!help.hidden) hideHelp();   // 타이핑하면 함수 도움말은 닫는다
    if (linkedEdit.active && linkedBeforeInput && e.isTrusted){
      const before = linkedBeforeInput, partial = ta.value;
      const partialSelectionStart = ta.selectionStart, partialSelectionEnd = ta.selectionEnd;
      linkedBeforeInput = null;
      const change = diffTextEdit(before.value, partial);
      const primary = before.ranges[before.primaryIndex];
      const applied = primary && applyLinkedIdentifierEdit(
        before.value, before.ranges, before.primaryIndex, change.start, change.end, change.inserted
      );
      if (applied){
        const primaryAfter = applied.ranges[applied.primaryIndex];
        const nextTerm = applied.value.slice(primaryAfter.start, primaryAfter.end);
        const validTerm = !!nextTerm && nextTerm.length <= 80 &&
          [...nextTerm].every((ch) => /[A-Za-z0-9_]/.test(ch) || (ch.charCodeAt(0) > 127 && !/\s/.test(ch)));
        if (!nextTerm){
          // 마지막 글자까지 지워도 연결 위치를 유지한다. 이어서 새 이름을 입력하면 모든 위치에 함께 들어간다.
          ta.value = applied.value;
          linkedEdit.term = "";
          linkedEdit.ranges = applied.ranges;
          linkedEdit.primaryIndex = applied.primaryIndex;
          ta.setSelectionRange(primaryAfter.start, primaryAfter.start);
        } else if (validTerm){
          const relStart = Math.max(0, partialSelectionStart - primary.start);
          const relEnd = Math.max(relStart, partialSelectionEnd - primary.start);
          ta.value = applied.value;
          linkedEdit.term = nextTerm;
          linkedEdit.ranges = applied.ranges;
          linkedEdit.primaryIndex = applied.primaryIndex;
          ta.setSelectionRange(
            Math.min(primaryAfter.end, primaryAfter.start + relStart),
            Math.min(primaryAfter.end, primaryAfter.start + relEnd)
          );
        } else exitLinkedEdit();
      } else exitLinkedEdit();
    }
    refresh(); sync(); clearError(); clearTraceLine();
    schedulePinRender();                                // 줄이 추가/삭제되면 핀 마커 줄 위치 재확정(앵커 기반)
    if (linkedEdit.active) renderLinkedEditRanges(); else clearWordHi();
    clearDefinitionHover(); if (!applyingHistory) commitSoon();
    if (findOpen && !findApplying) recomputeFind(false);   // 본문이 바뀌면 매치·개수 갱신(커서는 유지)
    // 입력·삭제·붙여넣기 때 자동완성 갱신. 프로그램이 발생시킨 input은 제외한다.
    if (!linkedEdit.active && typeof InputEvent !== "undefined" && e instanceof InputEvent && e.isTrusted &&
        /^(?:insertText|insertCompositionText|insertFromPaste|deleteContentBackward|deleteContentForward)$/.test(e.inputType || "")){
      const word = completionWord();
      const dotContext = word && word.start > 0 && ta.value[word.start - 1] === ".";
      if (word && (word.prefix.length > 0 || dotContext)) scheduleCompletion();
      else hideCompletion();
    } else if (!linkedEdit.active && !complete.hidden) hideCompletion();
  });
  ta.addEventListener("scroll", () => { sync(); hideCompletion(); if (col.active) col.render(); });
  ta.addEventListener("select", sync);

  /* ===== 편집기 내 찾기/바꾸기(Ctrl+H) =====
     본문 textarea 뒤(배경) findHi 레이어에 매치를 음영 처리하고, 현재 매치는 더 진하게 강조.
     대소문자 구분(Aa)·단어 단위(\b)·정규식(.*) 토글 지원. Enter=다음, Shift+Enter=이전, Esc=닫기. */
  const findBar = document.createElement("div"); findBar.className = "code-find"; findBar.hidden = true;
  findBar.innerHTML =
    '<div class="code-find-row">' +
      '<input type="text" class="code-find-input" placeholder="찾기" aria-label="편집기에서 찾기">' +
      '<span class="code-find-count" aria-live="polite"></span>' +
      '<button type="button" class="code-find-opt" data-opt="case" title="대소문자 구분">Aa</button>' +
      '<button type="button" class="code-find-opt" data-opt="word" title="단어 단위">\\b</button>' +
      '<button type="button" class="code-find-opt" data-opt="regex" title="정규식">.*</button>' +
      '<button type="button" class="regex-suggest-toggle" title="예시에서 정규식 추천" aria-expanded="false">패턴</button>' +
      '<button type="button" class="code-find-nav" data-nav="prev" title="이전 (Shift+Enter)">↑</button>' +
      '<button type="button" class="code-find-nav" data-nav="next" title="다음 (Enter)">↓</button>' +
      '<button type="button" class="code-find-close" title="닫기 (Esc)">✕</button>' +
    '</div>' +
    '<div class="code-find-row">' +
      '<input type="text" class="code-find-replace" placeholder="바꾸기" aria-label="바꿀 내용">' +
      '<button type="button" class="code-find-do" data-do="one">바꾸기</button>' +
      '<button type="button" class="code-find-do" data-do="all">모두 바꾸기</button>' +
    '</div>' +
    '<div class="regex-suggest" hidden></div>';
  edit.appendChild(findBar);
  const findInput = findBar.querySelector(".code-find-input");
  const replaceInput = findBar.querySelector(".code-find-replace");
  const countEl = findBar.querySelector(".code-find-count");
  const patternButton = findBar.querySelector(".regex-suggest-toggle");
  const suggestPanel = findBar.querySelector(".regex-suggest");
  let findOptCase = false, findOptWord = false, findOptRegex = false;
  let suggestOpen = false;
  let findHiSpan = null;

  const syncFindOptionButtons = () => {
    findBar.querySelector('[data-opt="case"]').classList.toggle("on", findOptCase);
    findBar.querySelector('[data-opt="word"]').classList.toggle("on", findOptWord);
    findBar.querySelector('[data-opt="regex"]').classList.toggle("on", findOptRegex);
  };
  const setSuggestionOpen = (open) => {
    suggestOpen = !!open;
    suggestPanel.hidden = !suggestOpen;
    patternButton.classList.toggle("on", suggestOpen);
    patternButton.setAttribute("aria-expanded", String(suggestOpen));
    if (suggestOpen) {
      renderRegexSuggestionPanel(suggestPanel, findInput.value, ta.value, (item) => {
        findInput.value = item.pattern;
        findOptRegex = true; findOptCase = true; findOptWord = false;
        syncFindOptionButtons(); setSuggestionOpen(false);
        findInput.focus(); recomputeFind(true);
      });
    }
  };

  const buildFindRegex = (single) => {
    const term = findInput.value;
    if (!term) return null;
    let pattern = findOptRegex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (findOptWord) pattern = "(?:^|\\b)(?:" + pattern + ")(?:\\b|$)";
    return new RegExp(pattern, "g" + (findOptCase ? "" : "i") + (single ? "" : ""));
  };
  const setCount = (override) => {
    if (override !== undefined){ countEl.textContent = override; return; }
    if (!findInput.value){ countEl.textContent = ""; return; }
    countEl.textContent = findMatches.length ? ((findIndex + 1) + "/" + findMatches.length) : "0/0";
  };
  const computeMatches = () => {
    findMatches = []; findIndex = -1;
    findInput.classList.remove("find-bad");
    if (!findOpen || !findInput.value) return;
    let re; try { re = buildFindRegex(false); } catch(e){ findInput.classList.add("find-bad"); return; }
    if (!re) return;
    const v = ta.value;
    let m, guard = 0, scanPos = 0, lineNo = 0;
    while ((m = re.exec(v)) !== null){
      const start = m.index, end = start + m[0].length;
      while (scanPos < start){ if (v.charCodeAt(scanPos) === 10) lineNo++; scanPos++; }
      const lineStart = v.lastIndexOf("\n", start - 1) + 1;
      findMatches.push({ start, end, line: lineNo, prefix: v.slice(lineStart, start), text: v.slice(start, end) });
      if (m[0].length === 0) re.lastIndex++;          // 빈 매치(예: a*) 무한루프 방지
      if (++guard > 100000) break;                    // 초대용량 보호
    }
  };
  const scrollMatchIntoView = (mt) => {
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const top = pt + mt.line * lh, bottom = top + lh;
    if (bottom > ta.scrollTop + ta.clientHeight - pb) ta.scrollTop = bottom - ta.clientHeight + pb;
    else if (top < ta.scrollTop + pt) ta.scrollTop = Math.max(0, top - pt);
    syncNow();
  };
  const selectMatch = (i) => {
    if (!findMatches.length){ setCount(); renderFindHi(); return; }
    findIndex = ((i % findMatches.length) + findMatches.length) % findMatches.length;
    const mt = findMatches[findIndex];
    ta.setSelectionRange(mt.start, mt.end);          // 닫을 때 본문 포커스로 돌아오면 선택이 보임
    scrollMatchIntoView(mt);
    setCount(); renderFindHi();
  };
  // recomputeFind(scroll): 매치를 다시 계산. scroll=true 면 커서 근처 매치로 이동/스크롤.
  const recomputeFind = (scroll) => {
    computeMatches();
    if (findMatches.length){
      const caret = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
      let idx = findMatches.findIndex(mt => mt.end >= caret);
      if (idx < 0) idx = 0;
      if (scroll) selectMatch(idx);
      else { findIndex = idx; setCount(); renderFindHi(); }
    } else { setCount(); renderFindHi(); }
    if (suggestOpen) renderRegexSuggestionPanel(suggestPanel, findInput.value, ta.value, (item) => {
      findInput.value = item.pattern;
      findOptRegex = true; findOptCase = true; findOptWord = false;
      syncFindOptionButtons(); setSuggestionOpen(false);
      findInput.focus(); recomputeFind(true);
    });
  };
  const replacementText = (matchText) => {
    if (!findOptRegex) return replaceInput.value;     // 일반 모드: 입력 그대로(특수 처리 없음)
    try { return matchText.replace(new RegExp(buildFindRegex(true).source, findOptCase ? "" : "i"), replaceInput.value); }
    catch(e){ return replaceInput.value; }            // 정규식 모드: $1 등 역참조 지원
  };
  const replaceCurrent = () => {
    if (findIndex < 0 || !findMatches[findIndex]){ recomputeFind(true); return; }
    const mt = findMatches[findIndex];
    if (ta.value.slice(mt.start, mt.end) !== mt.text){ recomputeFind(true); return; }   // 본문이 변해 어긋남 → 재정렬
    const repl = replacementText(mt.text);
    commitNow();
    ta.value = ta.value.slice(0, mt.start) + repl + ta.value.slice(mt.end);
    const caret = mt.start + repl.length;
    ta.selectionStart = ta.selectionEnd = caret;
    findApplying = true; emitInput(); findApplying = false;
    commitNow();
    computeMatches();
    if (findMatches.length){
      let idx = findMatches.findIndex(m => m.start >= caret);
      selectMatch(idx < 0 ? 0 : idx);
    } else { setCount(); renderFindHi(); }
  };
  const replaceAll = () => {
    if (!findInput.value) return;
    let re; try { re = buildFindRegex(false); } catch(e){ findInput.classList.add("find-bad"); return; }
    if (!re) return;
    const before = ta.value;
    const repl = findOptRegex ? replaceInput.value : replaceInput.value.replace(/\$/g, "$$$$");  // 일반 모드는 $ 를 리터럴로
    const after = before.replace(re, repl);
    if (after === before){ toast("바꿀 내용이 없어요.", 1600); return; }
    const count = (before.match(re) || []).length;
    commitNow();
    ta.value = after;
    ta.selectionStart = ta.selectionEnd = Math.min(ta.selectionStart, after.length);
    findApplying = true; emitInput(); findApplying = false;
    commitNow();
    recomputeFind(false);
    toast(count + "개를 바꿨어요.", 1800);
  };
  const openFind = (seedText) => {
    findOpen = true; findBar.hidden = false;
    // 보기에서 넘겨준 선택어가 있으면 그걸, 없으면 편집기 안에서 선택한 글자를 검색어로 시드
    const seed = (typeof seedText === "string" && seedText && !seedText.includes("\n") && seedText.length <= 200) ? seedText : "";
    const sel = seed || ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel && !sel.includes("\n") && sel.length <= 200) findInput.value = sel;
    findInput.focus(); findInput.select();
    recomputeFind(true);
  };
  const closeFind = () => {
    findOpen = false; findBar.hidden = true;
    setSuggestionOpen(false);
    findMatches = []; findIndex = -1;
    findInput.classList.remove("find-bad");
    renderFindHi();
    ta.focus();
    if (typeof options.onFindClose === "function") { try { options.onFindClose(); } catch(_){} }
  };
  // colMetrics 가 정의된 뒤라 매치 박스 위치를 실측할 수 있다(한글 등 전각 폭 보정).
  renderFindHi = () => {
    findHi.textContent = "";
    if (!findOpen || !findMatches.length) return;
    const m = colMetrics();
    const first = Math.floor(ta.scrollTop / m.lh) - 1;
    const last = first + Math.ceil(ta.clientHeight / m.lh) + 2;
    if (!findHiSpan){
      findHiSpan = document.createElement("span"); findHiSpan.setAttribute("aria-hidden", "true");
      findHiSpan.style.cssText = "position:absolute;visibility:hidden;white-space:pre;tab-size:4;top:-9999px;left:0";
      edit.appendChild(findHiSpan);
    }
    const cs = getComputedStyle(ta);
    findHiSpan.style.fontFamily = cs.fontFamily; findHiSpan.style.fontSize = cs.fontSize;
    findHiSpan.style.fontWeight = cs.fontWeight; findHiSpan.style.fontStyle = cs.fontStyle; findHiSpan.style.letterSpacing = cs.letterSpacing;
    findMatches.forEach((mt, i) => {
      if (mt.line < first || mt.line > last) return;
      findHiSpan.textContent = mt.prefix; const lw = findHiSpan.getBoundingClientRect().width;
      findHiSpan.textContent = mt.text;   const ww = findHiSpan.getBoundingClientRect().width;
      const box = document.createElement("div");
      box.className = "find-hi" + (i === findIndex ? " find-hi-active" : "");
      box.style.cssText = "left:" + (m.pl + lw - ta.scrollLeft) + "px;top:" + (m.pt + mt.line * m.lh - ta.scrollTop) +
                          "px;width:" + Math.max(2, ww) + "px;height:" + m.lh + "px";
      findHi.appendChild(box);
    });
  };
  // ===== 노트북 전체 찾기(Ctrl+H) 강조 — 셀 안 찾기의 find-hi-active 박스를 그대로 재사용해 현재 매치를 또렷하게 표시 =====
  let spotlightHiSpan = null;
  let spotlightSegs = null;                 // [{line, prefix, text}] — 여러 줄에 걸친 매치는 줄마다 한 박스
  const clearSpotlight = () => { if (spotlightSegs){ spotlightSegs = null; spotlightHi.textContent = ""; } };
  const computeSpotlightSegs = (start, end) => {
    const v = ta.value;
    start = Math.max(0, Math.min(start, v.length));
    end = Math.max(start, Math.min(end, v.length));
    const segs = [];
    let lineNo = 0;
    for (let i = 0; i < start; i++) if (v.charCodeAt(i) === 10) lineNo++;
    let segStart = start;
    for (let i = start; i < end; i++){
      if (v.charCodeAt(i) === 10){
        const ls = v.lastIndexOf("\n", segStart - 1) + 1;
        segs.push({ line: lineNo, prefix: v.slice(ls, segStart), text: v.slice(segStart, i) });
        lineNo++; segStart = i + 1;
      }
    }
    const ls = v.lastIndexOf("\n", segStart - 1) + 1;
    segs.push({ line: lineNo, prefix: v.slice(ls, segStart), text: v.slice(segStart, end) });
    return segs;
  };
  renderSpotlight = () => {
    spotlightHi.textContent = "";
    if (!spotlightSegs || !spotlightSegs.length) return;
    const m = colMetrics();
    const first = Math.floor(ta.scrollTop / m.lh) - 1;
    const last = first + Math.ceil(ta.clientHeight / m.lh) + 2;
    if (!spotlightHiSpan){
      spotlightHiSpan = document.createElement("span"); spotlightHiSpan.setAttribute("aria-hidden", "true");
      spotlightHiSpan.style.cssText = "position:absolute;visibility:hidden;white-space:pre;tab-size:4;top:-9999px;left:0";
      edit.appendChild(spotlightHiSpan);
    }
    const cs = getComputedStyle(ta);
    spotlightHiSpan.style.fontFamily = cs.fontFamily; spotlightHiSpan.style.fontSize = cs.fontSize;
    spotlightHiSpan.style.fontWeight = cs.fontWeight; spotlightHiSpan.style.fontStyle = cs.fontStyle; spotlightHiSpan.style.letterSpacing = cs.letterSpacing;
    spotlightSegs.forEach(seg => {
      if (seg.line < first || seg.line > last) return;
      spotlightHiSpan.textContent = seg.prefix; const lw = spotlightHiSpan.getBoundingClientRect().width;
      spotlightHiSpan.textContent = seg.text;   const ww = spotlightHiSpan.getBoundingClientRect().width;
      const box = document.createElement("div");
      box.className = "find-hi find-hi-active";
      box.style.cssText = "left:" + (m.pl + lw - ta.scrollLeft) + "px;top:" + (m.pt + seg.line * m.lh - ta.scrollTop) +
                          "px;width:" + Math.max(2, ww) + "px;height:" + m.lh + "px";
      spotlightHi.appendChild(box);
    });
  };
  // 노트북 전체 찾기가 이 셀의 특정 구간을 강조하도록 호출. 포커스는 검색창에 남겨두고 강조는 주황 박스로만 보인다.
  const spotlightRange = (start, end) => {
    spotlightSegs = computeSpotlightSegs(start, end);
    if (spotlightSegs.length){                          // 매치가 편집기 내부 스크롤 밖이면 보이도록 세로 스크롤
      const m = colMetrics();
      const top = m.pt + spotlightSegs[0].line * m.lh, bottom = top + m.lh;
      if (bottom > ta.scrollTop + ta.clientHeight) ta.scrollTop = bottom - ta.clientHeight;
      else if (top < ta.scrollTop) ta.scrollTop = Math.max(0, top - m.pt);
    }
    try { ta.setSelectionRange(start, start); } catch(_){}   // 흐린 회색 선택 잔상을 없애고 강조는 주황 박스로만
    syncNow();
  };
  ta.addEventListener("input", clearSpotlight);          // 셀을 편집하면 위치가 어긋나므로 강조를 지운다
  findInput.addEventListener("input", () => recomputeFind(true));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); selectMatch(findIndex + (e.shiftKey ? -1 : 1)); }
    else if (e.key === "Escape"){ e.preventDefault(); closeFind(); }
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); replaceCurrent(); }
    else if (e.key === "Escape"){ e.preventDefault(); closeFind(); }
  });
  findBar.querySelectorAll(".code-find-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      const o = btn.dataset.opt;
      if (o === "case") findOptCase = !findOptCase;
      else if (o === "word") findOptWord = !findOptWord;
      else if (o === "regex") findOptRegex = !findOptRegex;
      syncFindOptionButtons();
      findInput.focus(); recomputeFind(true);
    });
  });
  patternButton.addEventListener("click", () => {
    setSuggestionOpen(!suggestOpen);
    if (!suggestOpen) findInput.focus();
  });
  findBar.querySelector('[data-nav="next"]').addEventListener("click", () => { selectMatch(findIndex + 1); findInput.focus(); });
  findBar.querySelector('[data-nav="prev"]').addEventListener("click", () => { selectMatch(findIndex - 1); findInput.focus(); });
  findBar.querySelector('[data-do="one"]').addEventListener("click", () => { replaceCurrent(); });
  findBar.querySelector('[data-do="all"]').addEventListener("click", () => { replaceAll(); });
  findBar.querySelector(".code-find-close").addEventListener("click", closeFind);

  ta.addEventListener("keydown", (e) => {
    if (!help.hidden && e.key === "Escape"){ e.preventDefault(); hideHelp(); return; }   // 도움말 열려 있으면 Esc 로 먼저 닫기
    if (linkedEdit.active){
      if (e.key === "Escape"){
        e.preventDefault(); exitLinkedEdit(); computeWordHi(); return;
      }
      if (!linkedEdit.term && (e.key === "Backspace" || e.key === "Delete")){
        e.preventDefault(); return;                            // 빈 연결 위치에서 주변 코드까지 지우지 않음
      }
      const identifierKey = e.key.length === 1 &&
        (/[A-Za-z0-9_]/.test(e.key) || (e.key.charCodeAt(0) > 127 && !/\s/.test(e.key)));
      if ((!e.ctrlKey && !e.metaKey && !e.altKey && (identifierKey || e.key === "Backspace" || e.key === "Delete")) ||
          e.isComposing || e.keyCode === 229) return;       // 네이티브 input 뒤 동일 식별자 전체에 적용
      exitLinkedEdit();                                    // 이동·단축키·구두점은 연결 편집을 끝내고 기본 처리
    }
    if (shortcutMatches(e, "findInDocument")){
      e.preventDefault(); e.stopPropagation(); exitCol(); hideCompletion(); openFind(); return;
    }
    if (findOpen && e.key === "F3"){   // F3/Shift+F3: 찾기 패널이 열려 있으면 매치 순환
      e.preventDefault(); selectMatch(findIndex + (e.shiftKey ? -1 : 1)); return;
    }
    if (findOpen && e.key === "Escape" && complete.hidden){   // 본문에 포커스가 있어도 Esc 로 찾기 닫기
      e.preventDefault(); closeFind(); return;
    }
    // 자동완성 목록이 떠 있어도, 자동 닫힘 문자 바로 앞의 Tab은 항목 수락보다 "문자 밖으로 이동"을 우선한다.
    if (e.key === "Tab" && !e.shiftKey && ta.selectionStart === ta.selectionEnd &&
        ['"', "'", ")", "]", "}"].includes(ta.value[ta.selectionStart])){
      e.preventDefault(); hideCompletion();
      ta.selectionStart = ta.selectionEnd = ta.selectionStart + 1;
      sync(); return;
    }
    if (!complete.hidden){
      if (e.key === "ArrowDown" || e.key === "ArrowUp"){
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        completion.index = (completion.index + step + completion.items.length) % completion.items.length;
        renderCompletion(); return;
      }
      if (e.key === "Enter" || e.key === "Tab"){ e.preventDefault(); acceptCompletion(); return; }
      if (e.key === "Escape"){ e.preventDefault(); hideCompletion(); return; }
    }
    // 되돌리기/다시실행은 모드와 무관하게 항상 자체 히스토리로 처리(네이티브 undo 는 막는다)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "z" || e.key === "Z")){
      e.preventDefault(); exitCol(); if (e.shiftKey) redo(); else undo(); return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "y" || e.key === "Y")){ e.preventDefault(); exitCol(); redo(); return; }
    if (e.key === "F3" && !e.ctrlKey && !e.metaKey && !e.altKey){
      e.preventDefault();
      const next = findNextIdentifierOccurrence(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
      if (next){
        exitCol();
        hideCompletion();
        ta.setSelectionRange(next.selectionStart, next.selectionEnd);
        scrollCaretIntoView();
        computeWordHi();
        sync();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "d" || e.key === "D")){
      e.preventDefault(); applyLineAction("delete"); return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === " " || e.code === "Space")){
      e.preventDefault(); exitCol(); showCompletion(true); return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "/" || e.code === "Slash")){
      e.preventDefault(); applyLineAction("toggle-comment"); return;
    }
    if (e.altKey && !e.shiftKey && !(e.ctrlKey || e.metaKey) && e.key === "ArrowUp"){
      e.preventDefault(); applyLineAction("move-up"); return;
    }
    if (e.altKey && !e.shiftKey && !(e.ctrlKey || e.metaKey) && e.key === "ArrowDown"){
      e.preventDefault(); applyLineAction("move-down"); return;
    }
    if (e.altKey && !e.shiftKey && (e.ctrlKey || e.metaKey) && e.key === "ArrowDown"){
      e.preventDefault(); applyLineAction("duplicate-down"); return;
    }
    if (col.active){
      // 수식 키 단독 입력(Shift 등)으로 모드가 풀리면 대문자·기호 입력이 깨진다 → 무시
      if (["Shift","Alt","AltGraph","Control","Meta","CapsLock","Dead","Process","Unidentified"].includes(e.key)) return;
      if (e.key === "Escape"){ e.preventDefault(); exitCol(); return; }
      if (e.ctrlKey || e.metaKey){ exitCol(); return; }                 // 저장 등 기존 단축키는 그대로 동작
      if (e.key === "Backspace"){ e.preventDefault(); colBackspace(); return; }
      if (e.key === "Delete"){ e.preventDefault(); colDelete(); return; }
      if (e.key === "Tab"){ e.preventDefault(); colInsert("    "); return; }
      if (e.key === "Enter"){ e.preventDefault(); exitCol(); return; }    // 줄 분할은 복잡 → 모드 종료
      if (e.key.length === 1 && !e.altKey && !e.isComposing){ e.preventDefault(); colInsert(e.key); return; }
      exitCol(); return;                                                  // 화살표 등 그 외 키 → 모드 종료(기본 동작 유지)
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing){
      const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
      const start = ta.selectionStart, end = ta.selectionEnd;
      if (e.key === "Backspace" && start === end && start > 0 && pairs[ta.value[start - 1]] === ta.value[start]){
        e.preventDefault(); ta.value = ta.value.slice(0, start - 1) + ta.value.slice(start + 1);
        ta.selectionStart = ta.selectionEnd = start - 1; hideCompletion(); emitInput(); return;
      }
      // 스마트 백스페이스: 커서 앞이 전부 공백(들여쓰기 구간)이면 이전 탭 정지점(4칸)까지 한 번에 삭제
      if (e.key === "Backspace" && start === end && start > 0){
        const lineStart = ta.value.lastIndexOf("\n", start - 1) + 1;
        const prefix = ta.value.slice(lineStart, start);
        if (prefix.length > 0 && /^ +$/.test(prefix)){
          const remove = ((prefix.length - 1) % 4) + 1;     // 4→0, 8→4, 6→4 …
          e.preventDefault();
          ta.value = ta.value.slice(0, start - remove) + ta.value.slice(start);
          ta.selectionStart = ta.selectionEnd = start - remove;
          hideCompletion(); emitInput(); return;
        }
      }
      if ((e.key === '"' || e.key === "'") && start === end && ta.value[start] === e.key){
        e.preventDefault(); ta.selectionStart = ta.selectionEnd = start + 1; return;
      }
      if (pairs[e.key]){
        // 자동 닫기 짝 붙이기 — 단, 선택 없이 커서 바로 뒤가 '단어 문자'면 여는 문자만 넣는다
        // (foo 앞에 ( 치면 ()foo 가 되는 어색함 방지). 선택 영역은 항상 괄호로 감싼다.
        const nx = ta.value[start];
        const nextIsWord = !!nx && (/[A-Za-z0-9_]/.test(nx) || (nx.charCodeAt(0) > 127 && !/\s/.test(nx)));
        if (start === end && nextIsWord) return;            // 기본 입력 허용(여는 문자만)
        e.preventDefault(); insertPair(e.key, pairs[e.key]); return;
      }
      if ([")", "]", "}"].includes(e.key) && ta.selectionStart === ta.selectionEnd && ta.value[ta.selectionStart] === e.key){
        e.preventDefault(); ta.selectionStart = ta.selectionEnd = ta.selectionStart + 1; return;
      }
    }
    // Shift+Tab: 커서 바로 앞이 식별자/호출이면 함수 도움말(주피터식), 들여쓰기 위치면 아래 내어쓰기로 넘어감.
    if (e.key === "Tab" && e.shiftKey && ta.selectionStart === ta.selectionEnd && jediReady() &&
        /[A-Za-z0-9_)\]]$/.test(ta.value.slice(0, ta.selectionStart))){
      e.preventDefault(); hideCompletion(); showFunctionHelp(); return;
    }
    if (e.key === "Tab"){                                  // 선택 줄 들여쓰기, 커서만 있으면 공백 4칸
      e.preventDefault();
      if (e.shiftKey || ta.selectionStart !== ta.selectionEnd){
        applyLineAction(e.shiftKey ? "outdent" : "indent"); return;
      }
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 4;
      emitInput();
      scrollCaretIntoView();
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && e.keyCode !== 229){   // 자동 들여쓰기
      const s = ta.selectionStart, en = ta.selectionEnd, val = ta.value;
      const openPlan = pythonOpenClosePlan(val, s, en);
      if (openPlan){
        e.preventDefault();
        ta.value = val.slice(0, s) + openPlan.inserted + val.slice(en);
        ta.selectionStart = ta.selectionEnd = openPlan.caret;
        hideCompletion(); emitInput(); scrollCaretIntoView(); return;
      }
      const head = val.slice(val.lastIndexOf("\n", s - 1) + 1, s);          // 현재 줄(커서 앞)
      let indent = (head.match(/^[ \t]*/) || [""])[0];                      // 윗줄 들여쓰기 유지
      if (/:\s*$/.test(head)) indent += "    ";                             // 블록 시작(:)이면 한 단계 더
      e.preventDefault();
      const ins = "\n" + indent;
      ta.value = val.slice(0, s) + ins + val.slice(en);
      ta.selectionStart = ta.selectionEnd = s + ins.length;
      emitInput();
      scrollCaretIntoView();                     // 맨 아래 엔터 시 커서 따라 화면 내려가게
    }
  });
  refresh();
  return { host, ta, getValue: () => ta.value, setValue: (v) => { exitCol(); ta.value = v; emitInput(); },
    getCursorLine: () => lineNumberAtOffset(ta.value, ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd),
    focusLine,
    setPinProvider: (fn) => { pinProvider = fn; buildPinMarks(); },         // 코드→PDF 역방향 핀 공급자 등록 후 즉시 그림
    refreshPins: buildPinMarks,
    destroy: () => {
      clearJump(); hideCompletion(); hideHelp(); clearTimeout(pinRenderTimer); cancelAnimationFrame(syncRaf);
      document.removeEventListener("selectionchange", syncSelection);
      window.removeEventListener("scroll", hidePortalOnScroll, true);
      window.removeEventListener("resize", hidePortalOnScroll);
      help.remove();
      if (completionPortal) complete.remove();
      if (editorResizeObserver) editorResizeObserver.disconnect();
    },
    openFind, closeFind, isFindOpen: () => findOpen, isCompletionOpen: () => !complete.hidden,
    markError, clearError, showTraceLine, clearTraceLine, highlightCellRange, clearCellBand,
    setCellSplitMode, toggleCellBoundaryAtLine, isCellSplitMode: () => cellSplitMode, autoSplitCells,
    spotlightRange, clearSpotlight };
}

// 브라우저에서 실행할 수 있는(=실행 버튼을 붙일) 확장자
const RUN_EXTS = new Set(["py"]);
let _pyBackend = null;          // null=미확인, true/false=캐시(로컬 python 백엔드 가용 여부)
let _localPyConfirmed = false;  // 로컬 실행 1회 동의(세션)
const PYODIDE_VER = "0.27.7";
const PY_LOCAL_BASE = "/pyodide/";   // exe 런처가 vendor/pyodide/ 를 로컬 서빙(오프라인). 없으면 CDN 폴백.
let _pyodidePromise = null;
const RUN_BUNDLE_CAP = 50 * 1024 * 1024;   // 옆 파일 포함 실행 시 합계 상한(초과하면 단일 파일 실행)

// 압축 안의 모든 파일을 {path, bytes}[] 로 다시 추출(실행 작업폴더 복원용). 디렉터리·맥 메타는 제외.
async function extractZipAll(file, password, keep){
  const out = [];
  const r = new zip.ZipReader(new zip.BlobReader(file), password ? { password } : undefined);
  try {
    const selected = [];
    let declaredTotal = 0;
    for (const e of await r.getEntries()){
      if (e.directory) continue;
      const p = safeArchivePath(e.filename);
      if (!p || p.indexOf("__MACOSX/") === 0 || (p.split("/").pop() || "") === ".DS_Store") continue;
      if (typeof keep === "function" && !keep(p)) continue;
      declaredTotal += Number(e.uncompressedSize) || 0;
      if (typeof keep === "function" && declaredTotal > RUN_BUNDLE_CAP) throw new Error("sibling-set-too-large");
      selected.push({ entry:e, path:p });
    }
    let actualTotal = 0;
    for (const item of selected){
      const bytes = await item.entry.getData(new zip.Uint8ArrayWriter());
      actualTotal += bytes.length;
      if (typeof keep === "function" && actualTotal > RUN_BUNDLE_CAP) throw new Error("sibling-set-too-large");
      out.push({ path:item.path, bytes });
    }
  } finally { try { await r.close(); } catch(_){} }
  return out;
}
function tarTreeAll(tarBytes){
  return parseTar(tarBytes)
    .map(en => ({ path: String(en.name || "").replace(/\\/g, "/").replace(/^\/+/, ""), bytes: en.data }))
    .filter(f => f.path && f.path.indexOf("__MACOSX/") < 0 && f.path.indexOf("PaxHeader") < 0 && (f.path.split("/").pop() || "") !== ".DS_Store");
}
// 폴더 열기·여러 파일 동시 업로드용 옆파일 컨텍스트: File 핸들 묶음을 실행 시점에 읽어 {path, bytes}[] 로 만든다.
// 합계 용량이 상한을 넘으면 읽지 않고 거부(→ 단일 파일 실행으로 폴백).
function runDirectoryPaths(paths, explicit=[]){
  const dirs = new Set((explicit || []).map(normalizedRunPath).filter(Boolean));
  for (const value of paths || []){
    let dir = runPathDir(value);
    while (dir){
      dirs.add(dir);
      const parent = runPathDir(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return [...dirs];
}
function makeFileSiblingCtx(pairs, name, directories=[]){
  const paths = pairs.map(p => normalizedRunPath(p.relPath));
  return {
    name,
    isFolderContext: true,
    paths,                                                  // 바이트를 읽기 전 경로만 노출(실행 대상 기준 범위 좁히기용)
    directories: runDirectoryPaths(paths, directories),
    extract: async (keep) => {
      // keep(path) 가 주어지면 해당 파일만 읽는다 → 무관한 폴더·대용량 데이터 제외(50MB 상한 회피).
      const sel = (typeof keep === "function") ? pairs.filter(p => keep(p.relPath)) : pairs;
      let total = 0;
      for (const p of sel) total += (p.file.size || 0);
      if (total > RUN_BUNDLE_CAP) throw new Error("sibling-set-too-large");
      const out = [];
      for (const p of sel) out.push({ path: p.relPath, bytes: new Uint8Array(await p.file.arrayBuffer()) });
      return out;
    }
  };
}
// 폴더/압축 묶음을 실행 대상과 관련된 범위로 좁힌다.
// 자동 실행 기준은 실제 .py 파일 폴더이며, 상위·형제 파일은 ../dataIn/shopList.xml처럼 명시한 경로로 찾는다.
function buildArchiveScopeFilter(targetRel, src, availablePaths, availableDirs=[], preferredCwd=""){
  const target = normalizedRunPath(targetRel);
  const parts = target.split("/").filter(Boolean);
  const targetDir = runPathDir(target);
  const directories = runDirectoryPaths(availablePaths || [], availableDirs);
  const project = inferPythonProjectRunContext(target, src, availablePaths || [], { preferredCwd, availableDirs:directories });
  const referenced = project.references.map(item => normalizedRunPath(item.path));
  const directorySet = new Set(directories);
  const referencedDirs = new Set();
  for (const ref of pythonRelativePathLiterals(src)){
    const resolved = resolveProjectRelativePath(project.cwd, ref);
    if (!resolved) continue;
    if (directorySet.has(resolved)) referencedDirs.add(resolved);
    const parent = runPathDir(resolved);
    if (parent && parent !== project.cwd && directorySet.has(parent)) referencedDirs.add(parent);
  }
  const pkgDirs = [];
  for (const name of targetImportedTopNames(src)){
    const idx = parts.indexOf(name);
    if (idx >= 0 && idx < parts.length - 1) pkgDirs.push(parts.slice(0, idx + 1).join("/"));
  }
  if (typeof inferPythonLocalImportRoots === "function"){
    for (const root of inferPythonLocalImportRoots(target, src, availablePaths || [], {
      cwd:project.cwd || targetDir,
      availableDirs:directories
    })){
      if (!pkgDirs.includes(root)) pkgDirs.push(root);
    }
  }
  const keep = (p) => {
    return pythonRunScopeIncludesPath(p, target, referenced, pkgDirs);
  };
  keep.cwd = project.cwd || targetDir;
  keep.references = project.references;
  keep.directories = [...referencedDirs];
  return keep;
}

function normalizedRunPath(path){
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}
function runPathDir(path){
  const p = normalizedRunPath(path);
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}
function runPathStartsWith(path, root){
  const p = normalizedRunPath(path);
  const r = normalizedRunPath(root);
  return !r || p === r || p.indexOf(r + "/") === 0;
}
function stripRunRoot(path, root){
  const p = normalizedRunPath(path);
  const r = normalizedRunPath(root);
  return r && p.indexOf(r + "/") === 0 ? p.slice(r.length + 1) : p;
}
function pythonRunCwdStorageKey(runCtx){
  const owner = runCtx && runCtx.ownerDoc;
  const path = normalizedRunPath(owner && (owner.workspacePath || owner.relPath || owner.name));
  return path ? "moidapy-run-cwd:v1:" + path : "";
}
function pythonPreferredRunCwd(runCtx){
  const owner = runCtx && runCtx.ownerDoc;
  if (!owner) return "";
  if (!Object.prototype.hasOwnProperty.call(owner, "pythonRunCwd")){
    const key = pythonRunCwdStorageKey(runCtx);
    let saved = "";
    try { if (key) saved = normalizedRunPath(localStorage.getItem(key) || ""); } catch(_){}
    owner.pythonRunCwd = saved;
  }
  return normalizedRunPath(owner.pythonRunCwd || "");
}
function setPythonPreferredRunCwd(runCtx, cwd){
  const owner = runCtx && runCtx.ownerDoc;
  if (!owner) return;
  const value = normalizedRunPath(cwd);
  owner.pythonRunCwd = value;
  const key = pythonRunCwdStorageKey(runCtx);
  try {
    if (key && value) localStorage.setItem(key, value);
    else if (key) localStorage.removeItem(key);
  } catch(_){}
}
function pythonRunContextPaths(runCtx){
  const archive = runCtx && runCtx.archiveCtx;
  if (archive && Array.isArray(archive.paths)) return archive.paths.map(normalizedRunPath).filter(Boolean);
  return docs.map(doc => normalizedRunPath(doc.workspacePath || doc.relPath || doc.name)).filter(Boolean);
}
function pythonRunContextDirectories(runCtx){
  const archive = runCtx && runCtx.archiveCtx;
  return runDirectoryPaths(pythonRunContextPaths(runCtx), archive && archive.directories || []);
}
function pythonRunCwdCandidates(runCtx){
  const owner = runCtx && runCtx.ownerDoc;
  const target = normalizedRunPath(owner && (owner.relPath || owner.workspacePath || owner.name));
  const directories = new Set(pythonRunContextDirectories(runCtx));
  const out = [];
  let dir = runPathDir(target);
  while (dir){
    if (directories.has(dir) || target.indexOf(dir + "/") === 0) out.push(dir);
    const parent = runPathDir(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return out;
}
// 압축 파일명에서 최상위 폴더로 쓸 이름을 뽑는다(somefolder.zip → somefolder).
function archiveRootName(name){
  return String(name || "").replace(/\\/g, "/").split("/").pop()
    .replace(/\.(zip|tgz|tar\.gz|tar)$/i, "").trim();
}
// 모든 경로가 같은 최상위 폴더 아래면 그 이름을, 루트에 흩어져 있으면(공통 최상위 폴더 없음) null 을 돌려준다.
function commonTopDir(paths){
  let top = null;
  for (const p of paths){
    const np = normalizedRunPath(p);
    if (np.indexOf("/") < 0) return null;          // 루트 직속 파일 존재 → 공통 최상위 폴더 없음
    const seg = np.split("/")[0];
    if (top === null) top = seg;
    else if (top !== seg) return null;
  }
  return top;
}
function targetImportedTopNames(src){
  const names = new Set();
  const text = String(src || "");
  let m;
  const importRe = /^\s*import\s+([^\n#]+)/gm;
  while ((m = importRe.exec(text))){
    for (const part of m[1].split(",")){
      const name = part.trim().split(/\s+as\s+/i)[0].split(".")[0];
      if (name) names.add(name);
    }
  }
  const fromRe = /^\s*from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+/gm;
  while ((m = fromRe.exec(text))) names.add(m[1].split(".")[0]);
  return names;
}
function inferOpenPythonProjectRoot(target, src, docPaths){
  const parts = normalizedRunPath(target).split("/").filter(Boolean);
  const imported = targetImportedTopNames(src);
  for (const name of imported){
    const idx = parts.indexOf(name);
    // import 한 최상위 패키지가 경로에 있으면 그 부모가 프로젝트 루트(idx 0 이면 묶음 루트 자체 = "").
    if (idx >= 0 && idx < parts.length - 1) return parts.slice(0, idx).join("/");
  }
  const pathSet = new Set((docPaths || []).map(normalizedRunPath));
  let dir = runPathDir(target);
  let topPackageDir = "";
  while (dir){
    if (pathSet.has(dir + "/__init__.py")) topPackageDir = dir;
    const parent = runPathDir(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return topPackageDir ? runPathDir(topPackageDir) : null;   // 못 찾으면 null(같은 폴더 형제만 묶기)
}
function isRunnablePythonPath(path){
  return /\.py$/i.test(String(path || "").split(/[\\/]/).pop() || "");
}
function runRuntimeFileStore(runCtx, create=false){
  const holder = runCtx && (runCtx.archiveCtx || runCtx.ownerDoc);
  if (!holder) return null;
  if (!holder.runtimeFiles && create) holder.runtimeFiles = new Map();
  return holder.runtimeFiles instanceof Map ? holder.runtimeFiles : null;
}
function runRuntimeFileHolder(runCtx){
  return runCtx && (runCtx.archiveCtx || runCtx.ownerDoc) || null;
}
function findOpenRunProjectDoc(path, runCtx){
  const wanted = normalizedRunPath(path);
  const owner = runCtx && runCtx.ownerDoc;
  const archiveCtx = runCtx && runCtx.archiveCtx;
  const candidates = docs.filter(doc => doc && !doc.closed && !doc.isRunProjectPreview);
  const docPath = (doc) => normalizedRunPath(doc.relPath || doc.workspacePath || doc.name || "");
  const exact = candidates.filter(doc => docPath(doc) === wanted);
  if (exact.length){
    return exact.find(doc => doc === owner) ||
      exact.find(doc => archiveCtx && doc.archiveCtx === archiveCtx) ||
      exact[0];
  }
  const suffix = candidates.filter(doc => {
    const current = docPath(doc);
    return current && (current.endsWith("/" + wanted) || wanted.endsWith("/" + current));
  });
  return suffix.find(doc => doc === owner) ||
    suffix.find(doc => archiveCtx && doc.archiveCtx === archiveCtx) ||
    suffix[0] || null;
}
async function openRunProjectFile(path, bundle, runCtx){
  const wanted = normalizedRunPath(path);
  const runtime = runRuntimeFileStore(runCtx, false);
  const runtimeBytes = runtime && runtime.get(wanted);
  if (!runtimeBytes){
    const openDoc = findOpenRunProjectDoc(wanted, runCtx);
    if (openDoc){
      setActiveDoc(openDoc.id);
      return;
    }
  }
  let bytes = runtimeBytes || null;
  if (!bytes && bundle && Array.isArray(bundle.files)){
    const entry = bundle.files.find(file => normalizedRunPath(file.path) === wanted);
    if (entry && entry.bytes) bytes = entry.bytes;
  }
  if (!bytes && runCtx && runCtx.archiveCtx && typeof runCtx.archiveCtx.extract === "function"){
    try {
      const extracted = await runCtx.archiveCtx.extract(p => normalizedRunPath(p) === wanted);
      const entry = extracted.find(file => normalizedRunPath(file.path) === wanted);
      if (entry && entry.bytes) bytes = entry.bytes;
    } catch(e){ console.warn("실행 작업폴더 파일 열기 실패:", e); }
  }
  if (!bytes){
    toast("이 파일의 내용을 불러오지 못했어요. 코드를 한 번 실행한 뒤 다시 눌러보세요.", 3200);
    return;
  }
  const owner = runCtx && runCtx.ownerDoc;
  const base = wanted.split("/").pop() || "output.txt";
  const previewKey = "run-project-preview:" + (owner ? owner.id : "shared") + ":" + wanted;
  const previous = docs.find(doc => doc && doc.sourceKey === previewKey);
  if (previous) closeDoc(previous.id, { skipConfirm:true });
  const preview = await handleFiles([new File([bytes], base)], {
    bulk: false,
    parentId: owner && owner.parentId ? owner.parentId : null,
    relPath: wanted,
    archiveCtx: runCtx && runCtx.archiveCtx ? runCtx.archiveCtx : null,
    sourceKey: previewKey,
    transient: true
  });
  if (preview){
    preview.isRunProjectPreview = true;
    preview.runProjectPath = wanted;
    preview.runGenerated = !!runtimeBytes;
    setActiveDoc(preview.id);
  }
}
function pythonPathGuideData(src, runCtx){
  const owner = runCtx && runCtx.ownerDoc;
  const target = normalizedRunPath(owner && (owner.relPath || owner.workspacePath || owner.name) || "script.py");
  const paths = pythonRunContextPaths(runCtx);
  const directories = pythonRunContextDirectories(runCtx);
  const pathSet = new Set(paths), directorySet = new Set(directories);
  const preferredCwd = pythonPreferredRunCwd(runCtx);
  const context = inferPythonProjectRunContext(target, src, paths, { preferredCwd, availableDirs:directories });
  const cwd = context.cwd || runPathDir(target) || ".";
  const refs = pythonRelativePathLiterals(src).map(ref => {
    const resolved = resolveProjectRelativePath(cwd === "." ? "" : cwd, ref) || ref;
    const existsFile = pathSet.has(resolved);
    const existsDirectory = directorySet.has(resolved);
    const parent = runPathDir(resolved);
    const parentExists = !parent || directorySet.has(parent);
    const normalizedRef = normalizedRunPath(ref);
    const exactElsewhere = paths.find(path => path === normalizedRef || path.endsWith("/" + normalizedRef));
    const refDir = runPathDir(normalizedRef);
    const directoryElsewhere = refDir
      ? directories.find(dir => dir === refDir || dir.endsWith("/" + refDir))
      : "";
    let suggestedCwd = "";
    const matched = exactElsewhere || directoryElsewhere;
    if (matched){
      const suffix = exactElsewhere ? normalizedRef : refDir;
      if (suffix && matched.length > suffix.length)
        suggestedCwd = matched.slice(0, matched.length - suffix.length).replace(/\/+$/, "");
    }
    return {
      ref, resolved, existsFile, existsDirectory, parentExists,
      elsewhere: exactElsewhere || directoryElsewhere || "", suggestedCwd
    };
  });
  return { target, paths, directories, preferredCwd, cwd, refs };
}
async function copyPythonPathExample(text){
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch(_){}
  if (!copied){
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { copied = document.execCommand("copy"); } catch(_){}
    ta.remove();
  }
  toast(copied ? "예제 코드를 복사했어요." : "복사하지 못했어요.", 1800);
}
function appendPythonPathExample(host, title, text){
  const wrap = document.createElement("section"); wrap.className = "py-path-example";
  const head = document.createElement("div"); head.className = "py-path-example-head";
  const label = document.createElement("strong"); label.textContent = title;
  const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "복사";
  copy.addEventListener("click", () => copyPythonPathExample(text));
  const pre = document.createElement("pre"); pre.textContent = text;
  head.append(label, copy); wrap.append(head, pre); host.appendChild(wrap);
}
function renderPythonPathHelper(panel, src, runCtx, ui){
  if (!panel) return;
  const guide = pythonPathGuideData(src, runCtx);
  panel.innerHTML = "";
  const head = document.createElement("div"); head.className = "py-path-help-head";
  const heading = document.createElement("div");
  const title = document.createElement("strong"); title.textContent = "경로 도우미";
  const sub = document.createElement("span"); sub.textContent = "현재 코드와 열린 폴더를 기준으로 계산합니다.";
  heading.append(title, sub);
  const close = document.createElement("button"); close.type = "button"; close.textContent = "닫기";
  close.addEventListener("click", () => { panel.hidden = true; });
  head.append(heading, close);

  const summary = document.createElement("dl"); summary.className = "py-path-summary";
  const addSummary = (name, value) => {
    const dt = document.createElement("dt"); dt.textContent = name;
    const dd = document.createElement("dd"); dd.textContent = value; dd.title = value;
    summary.append(dt, dd);
  };
  addSummary("현재 파일", guide.target);
  addSummary("실행 기준", guide.cwd);

  const cwdRow = document.createElement("label"); cwdRow.className = "py-path-cwd";
  const cwdLabel = document.createElement("span"); cwdLabel.textContent = "실행 기준 폴더";
  const cwdSelect = document.createElement("select");
  const autoContext = inferPythonProjectRunContext(guide.target, src, guide.paths, { availableDirs:guide.directories });
  const auto = document.createElement("option"); auto.value = ""; auto.textContent = "자동 감지 (" + (autoContext.cwd || ".") + ")";
  cwdSelect.appendChild(auto);
  const candidates = pythonRunCwdCandidates(runCtx);
  if (guide.preferredCwd && !candidates.includes(guide.preferredCwd)) candidates.push(guide.preferredCwd);
  for (const cwd of candidates){
    const option = document.createElement("option"); option.value = cwd; option.textContent = cwd;
    cwdSelect.appendChild(option);
  }
  cwdSelect.value = guide.preferredCwd;
  cwdSelect.addEventListener("change", () => {
    setPythonPreferredRunCwd(runCtx, cwdSelect.value);
    updateRunProjectPanel(ui, null, runCtx);
    renderPythonPathHelper(panel, src, runCtx, ui);
  });
  cwdRow.append(cwdLabel, cwdSelect);

  const note = document.createElement("p"); note.className = "py-path-note";
  note.textContent = "화면의 경로는 논리 작업폴더입니다. 실제 실행이 Temp 폴더에서 이뤄지는 것은 정상이며, 상대경로 구조는 그대로 복원됩니다.";
  panel.append(head, summary, cwdRow, note);

  const refsTitle = document.createElement("h4"); refsTitle.textContent = "코드에서 찾은 파일 경로";
  panel.appendChild(refsTitle);
  const refs = document.createElement("div"); refs.className = "py-path-refs";
  if (!guide.refs.length){
    const empty = document.createElement("p"); empty.className = "py-path-empty"; empty.textContent = "코드에서 분석할 상대 파일 경로를 찾지 못했습니다.";
    refs.appendChild(empty);
  }
  for (const item of guide.refs){
    const row = document.createElement("div"); row.className = "py-path-ref";
    const main = document.createElement("div"); main.className = "py-path-ref-main";
    const code = document.createElement("code"); code.textContent = item.ref;
    const status = document.createElement("span");
    if (item.existsFile || item.existsDirectory){ status.className = "ok"; status.textContent = "찾음"; }
    else if (item.parentExists){ status.className = "new"; status.textContent = "새 파일 생성 가능"; }
    else if (item.elsewhere){ status.className = "warn"; status.textContent = "기준 폴더 불일치"; }
    else { status.className = "bad"; status.textContent = "찾지 못함"; }
    main.append(code, status);
    const resolved = document.createElement("div"); resolved.className = "py-path-resolved";
    resolved.textContent = "현재 찾는 위치: " + item.resolved;
    row.append(main, resolved);
    if (item.elsewhere){
      const actual = document.createElement("div"); actual.className = "py-path-actual";
      actual.textContent = "열린 폴더의 후보: " + item.elsewhere;
      row.appendChild(actual);
      if (item.suggestedCwd && candidates.includes(item.suggestedCwd)){
        const use = document.createElement("button"); use.type = "button"; use.textContent = "실행 기준을 " + item.suggestedCwd + "(으)로 변경";
        use.addEventListener("click", () => {
          setPythonPreferredRunCwd(runCtx, item.suggestedCwd);
          updateRunProjectPanel(ui, null, runCtx);
          renderPythonPathHelper(panel, src, runCtx, ui);
        });
        row.appendChild(use);
      }
    }
    refs.appendChild(row);
  }
  panel.appendChild(refs);

  const examplesTitle = document.createElement("h4"); examplesTitle.textContent = "안전한 경로 예제";
  panel.appendChild(examplesTitle);
  const examples = document.createElement("div"); examples.className = "py-path-examples";
  panel.appendChild(examples);
  const readable = guide.refs.find(item => item.existsFile);
  const writable = guide.refs.find(item => !item.existsFile && (item.parentExists || item.elsewhere));
  const inputRef = readable ? readable.ref : "dataIn/input.xml";
  const outputRef = writable ? writable.ref : "dataOut/output.xml";
  appendPythonPathExample(examples, "파일 읽기",
    "from pathlib import Path\n\ninput_path = Path(" + JSON.stringify(inputRef) + ")\nprint(input_path.resolve())\ntext = input_path.read_text(encoding=\"utf-8\")");
  appendPythonPathExample(examples, "파일 저장",
    "from pathlib import Path\n\noutput_path = Path(" + JSON.stringify(outputRef) + ")\noutput_path.parent.mkdir(parents=True, exist_ok=True)\n# 저장 함수에 output_path를 전달하세요.");
  const localPy = guide.paths.find(path => /^[A-Za-z_]\w*\.py$/i.test(path.split("/").pop() || "") &&
    path !== guide.target && runPathDir(path) === guide.cwd);
  const moduleName = localPy ? localPy.split("/").pop().replace(/\.py$/i, "") : "helper";
  appendPythonPathExample(examples, "같은 폴더 모듈 import",
    "from " + moduleName.replace(/[^\w]/g, "_") + " import 함수명\n\n# " + moduleName + ".py가 실행 기준 폴더에 있어야 합니다.");
}
function updateRunProjectPanel(ui, bundle, runCtx){
  if (!ui || !ui.projectSummary || !ui.projectBody) return;
  const owner = runCtx && runCtx.ownerDoc;
  const logicalTarget = normalizedRunPath((bundle && bundle.target) ||
    (owner && (owner.workspacePath || owner.relPath || owner.name)) || "script.py");
  const target = logicalTarget || "script.py";
  const cwd = normalizedRunPath(bundle && bundle.cwd) || pythonPreferredRunCwd(runCtx) || runPathDir(target) || ".";
  const paths = bundle && bundle.files && bundle.files.length
    ? bundle.files.map((file) => normalizedRunPath(file.path)).filter(Boolean)
    : [target];
  const runtime = runRuntimeFileStore(runCtx, false);
  if (runtime) for (const path of runtime.keys()) if (!paths.includes(path)) paths.push(path);
  ui.projectSummary.textContent = "실행 작업폴더 · " + cwd + " · " + paths.length + "개 파일";
  ui.projectBody.textContent = "";
  const note = document.createElement("p");
  note.textContent = "상대경로 기준: " + cwd + " · 파일명을 누르면 앱에서 내용을 볼 수 있습니다.";
  const files = document.createElement("div"); files.className = "run-project-files";
  files.setAttribute("role", "list");
  const shown = paths.slice(0, 80);
  for (const path of shown){
    const normalized = normalizedRunPath(path);
    const runtimeBytes = runtime && runtime.get(normalized);
    const bundleFile = bundle && bundle.files && bundle.files.find(file => normalizedRunPath(file.path) === normalized);
    const row = document.createElement("button"); row.type = "button"; row.className = "run-project-file";
    row.setAttribute("role", "listitem");
    row.title = normalized + " 열기";
    const name = document.createElement("span"); name.className = "run-project-file-name"; name.textContent = normalized;
    row.appendChild(name);
    if (runtimeBytes){
      const badge = document.createElement("span"); badge.className = "run-project-file-badge"; badge.textContent = "생성/변경";
      row.classList.add("is-runtime");
      row.appendChild(badge);
    }
    const byteLength = runtimeBytes ? runtimeBytes.length : (bundleFile && bundleFile.bytes ? bundleFile.bytes.length : 0);
    if (byteLength){
      const size = document.createElement("span"); size.className = "run-project-file-size"; size.textContent = humanSize(byteLength);
      row.appendChild(size);
    }
    row.addEventListener("click", async () => {
      if (row.disabled) return;
      row.disabled = true;
      try { await openRunProjectFile(normalized, bundle, runCtx); }
      catch(e){
        console.error(e);
        toast("파일을 열지 못했어요: " + ((e && e.message) || e), 3000);
      } finally { row.disabled = false; }
    });
    files.appendChild(row);
  }
  if (paths.length > shown.length){
    const more = document.createElement("div"); more.className = "run-project-more";
    more.textContent = "… 외 " + (paths.length - shown.length) + "개";
    files.appendChild(more);
  }
  const keep = document.createElement("p"); keep.className = "run-project-note";
  const runtimeHolder = runRuntimeFileHolder(runCtx);
  keep.textContent = runtime && runtime.size && runtimeHolder && runtimeHolder.runtimeFilesPersisted
    ? "초록색 생성·변경 파일 " + runtime.size + "개는 실제 저장 폴더와 최근 작업공간에 자동 저장되었습니다."
    : runtime && runtime.size
    ? "초록색 생성·변경 파일 " + runtime.size + "개는 이번 앱 세션 동안 열어보고 다음 실행에서도 사용할 수 있습니다."
    : "실행에서 만든 파일은 이번 앱 세션 동안 다음 실행 작업폴더로 이어집니다.";
  ui.projectBody.append(note, files, keep);
}
function mergeRuntimeFiles(runCtx, files, keep){
  const store = runRuntimeFileStore(runCtx, false);
  if (!store || !store.size) return files;
  const byPath = new Map((files || []).map((file) => [normalizedRunPath(file.path), file]));
  for (const [path, bytes] of store){
    if (typeof keep === "function" && !keep(path)) continue;
    byPath.set(normalizedRunPath(path), { path: normalizedRunPath(path), bytes });
  }
  return [...byPath.values()];
}
async function rememberRunOutputs(runCtx, bundle, outputs, sessionId){
  if (!outputs || !outputs.length) return { count:0, persisted:false };
  const store = runRuntimeFileStore(runCtx, true);
  if (!store) return { count:0, persisted:false };
  const ownerPath = normalizedRunPath(runCtx && runCtx.ownerDoc &&
    (runCtx.ownerDoc.workspacePath || runCtx.ownerDoc.relPath || runCtx.ownerDoc.name || ""));
  let remembered = 0, total = 0;
  const savedRows = [];
  for (const output of outputs){
    const size = Number(output.size) || (output.bytes && output.bytes.length) || 0;
    if (size > 20 * 1024 * 1024 || total + size > RUN_BUNDLE_CAP) continue;
    let bytes = output.bytes ? new Uint8Array(output.bytes) : null;
    if (!bytes && sessionId){
      try {
        const response = await fetch("/python-session-file?id=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(output.name));
        if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      } catch(_){}
    }
    if (!bytes) continue;
    const path = resolveRuntimeOutputPath(ownerPath, output.name, bundle && bundle.logicalRoot, !!bundle);
    store.set(path, bytes);
    savedRows.push({ path, bytes });
    total += bytes.length;
    remembered++;
  }
  let persisted = false;
  if (savedRows.length){
    persisted = await persistRunOutputFiles(savedRows);
    const holder = runRuntimeFileHolder(runCtx);
    if (holder && persisted) holder.runtimeFilesPersisted = true;
  }
  return { count:remembered, persisted };
}
async function persistRunOutputFiles(rows){
  if (!rows || !rows.length || (location.protocol !== "http:" && location.protocol !== "https:")) return false;
  const files = rows.map(row => {
    const path = normalizedRunPath(row.path);
    const name = path.split("/").pop() || "output.dat";
    const file = new File([row.bytes], name);
    if (path) Object.defineProperty(file, "webkitRelativePath", { value:path });
    return file;
  });
  let workspaceSaved = false;
  if (typeof rememberWorkspace === "function"){
    try { workspaceSaved = await rememberWorkspace(files, false, { silent:true }); }
    catch(e){ console.warn("실행 결과 작업공간 저장 실패:", e); }
  }
  let diskSaved = 0;
  if (await saveFileBackendAvailable()){
    for (const row of rows){
      try {
        const path = normalizedRunPath(row.path);
        const response = await fetch("/save-file", {
          method: "POST",
          headers: { "X-Save-Path": encodeURIComponent(path) },
          body: new Blob([row.bytes], { type:"application/octet-stream" })
        });
        if (response.ok) diskSaved++;
      } catch(e){ console.warn("실행 결과 파일 저장 실패:", e); }
    }
  }
  return workspaceSaved || diskSaved === rows.length;
}
async function openDocRunText(doc, fallback){
  if (fallback !== undefined) return String(fallback);
  if (doc && doc.codeEditor && typeof doc.codeEditor.getValue === "function") return doc.codeEditor.getValue();
  if (doc && typeof doc.savedText === "string") return doc.savedText;
  if (doc && doc.sourceFile && typeof doc.sourceFile.arrayBuffer === "function"){
    try {
      return smartDecodeText(await readDocSourceBytes(doc)).replace(/\r\n?/g, "\n");   // 스냅샷 만료 시 핸들로 재취득
    } catch(_){}
  }
  return null;
}

async function buildOpenPythonSiblingBundle(src, runCtx, scopeSource){
  const ownerDoc = runCtx && runCtx.ownerDoc;
  if (!ownerDoc || (runCtx && runCtx.archiveCtx)) return null;
  const target = normalizedRunPath(ownerDoc.workspacePath || ownerDoc.name || "script.py");
  if (!isRunnablePythonPath(target)) return null;
  const dir = runPathDir(target);
  const enc = new TextEncoder();
  const byPath = new Map();
  const put = (path, text, priority) => {
    if (text === null) return;
    const prev = byPath.get(path);
    if (!prev || priority >= prev.priority) byPath.set(path, { path, bytes: enc.encode(text), priority });
  };
  const putBytes = (path, bytes, priority) => {
    if (!bytes) return;
    const prev = byPath.get(path);
    if (!prev || priority >= prev.priority) byPath.set(path, { path, bytes, priority });
  };
  // 비-PDF 문서 전체 수집(데이터 파일 참조 분석에도 사용). .py 후보는 별도 분리.
  const allDocs = [];
  const pyCandidates = [];
  for (const doc of docs){
    if (!doc || doc.kind === "pdf") continue;
    if (doc.sourceKey && String(doc.sourceKey).indexOf("definition:") === 0) continue;
    const path = normalizedRunPath(doc.workspacePath || doc.name || "");
    if (!path) continue;
    allDocs.push({ doc, path });
    if (isRunnablePythonPath(path)){
      const text = await openDocRunText(doc, doc === ownerDoc ? src : undefined);
      const priority = (doc === ownerDoc ? 100 : 0) + (doc.codeEditor ? 20 : 0) + (doc.id === activeId ? 5 : 0);
      pyCandidates.push({ doc, path, text, priority });
    }
  }
  // 데이터 파일 참조 분석 — 코드의 'dataIn/x.xml' 같은 상대경로를 실제 워크스페이스 파일과 매칭.
  const projCtx = (typeof inferPythonProjectRunContext === "function")
    ? inferPythonProjectRunContext(target, scopeSource == null ? src : scopeSource, allDocs.map(d => d.path), {
        preferredCwd:pythonPreferredRunCwd(runCtx),
        availableDirs:runDirectoryPaths(allDocs.map(d => d.path))
      })
    : { cwd: dir, references: [] };
  // 새 파일·복원 파일처럼 ownerDoc 의 폴더 컨텍스트가 끊겨 target 경로가 파일명만 남은 경우에도,
  // 코드의 dataIn/x.json 같은 상대경로를 열린 작업공간의 suffix 와 다시 맞춘다.
  const matchedReferences = [...(projCtx.references || [])];
  // 참조별 매칭된 데이터 파일들: { ref: 코드의 상대경로, actualPath: 워크스페이스 실제경로, items: [doc, ...] }
  const dataMatches = [];
  for (const r of matchedReferences){
    const refStr = String(r.ref || "").replace(/^\.?\/+/, "").replace(/\\/g, "/");
    const actualPath = normalizedRunPath(r.path);
    const items = [];
    for (const item of allDocs){
      if (isRunnablePythonPath(item.path)) continue;
      if (item.path === actualPath || runPathStartsWith(item.path, actualPath)) items.push(item);
    }
    if (items.length) dataMatches.push({ ref: refStr, actualPath, items });
  }
  // 프로젝트 루트(.py 묶음 기준)는 기존 로직 그대로 — 데이터 파일은 스크립트 dir 기준 상대경로로 따로 배치.
  const pyRoot = inferOpenPythonProjectRoot(target, scopeSource == null ? src : scopeSource, pyCandidates.map(c => c.path));
  const projectRoot = pyRoot;
  const runtimeFiles = runRuntimeFileStore(runCtx, false);
  for (const item of pyCandidates){
    if (projectRoot != null){
      if (!runPathStartsWith(item.path, projectRoot)) continue;
      put(item.path, item.text, item.priority);
    } else {
      if (runPathDir(item.path) !== dir) continue;
      put(item.path, item.text, item.priority);
    }
  }
  if (runtimeFiles){
    for (const [runtimePath, bytes] of runtimeFiles){
      const path = normalizedRunPath(runtimePath);
      if (projectRoot != null){
        if (!runPathStartsWith(path, projectRoot)) continue;
        byPath.set(path, { path, bytes, priority: 900 });
      } else {
        if (runPathDir(path) !== dir) continue;
        byPath.set(path, { path, bytes, priority: 900 });
      }
    }
  }
  put(target, src, 1000);
  // 참조된 데이터 파일도 실제 프로젝트 상대 위치에 둔다. cwd와 파일 트리를 함께 보존하므로
  // dataIn/x.csv와 ../dataIn/x.csv가 일반 Python의 상대경로 규칙 그대로 구분된다.
  const DATA_PER_FILE_CAP = 20 * 1024 * 1024;
  for (const m of dataMatches){
    for (const item of m.items){
      if (!item.doc || !item.doc.sourceFile) continue;
      try {
        // 폴더 스냅샷이 오래돼 읽기가 실패하면 원본 핸들로 다시 떠서 재시도(내용 검색 뒤 실행 시 누락 방지).
        const bytes = await readDocSourceBytes(item.doc);
        if (bytes.byteLength > DATA_PER_FILE_CAP) continue;
        putBytes(item.path, bytes, 500);
      } catch(e){ console.warn("data file bundle skipped:", item.path, e); }
    }
  }
  const files = [...byPath.values()].map(f => ({ path: f.path, bytes: f.bytes }));
  if (files.length <= 1) return null;
  const total = files.reduce((sum, f) => sum + (f.bytes ? f.bytes.length : 0), 0);
  if (total > RUN_BUNDLE_CAP) throw new Error("open-python-siblings-too-large");
  return {
    files,
    target,
    cwd:normalizedRunPath(projCtx.cwd) || dir,
    logicalRoot:commonTopDir(files.map(file => file.path)) || ""
  };
}

// exe 런처(로컬 서버)에서 실제 python 실행이 가능한지 — pptxBackendAvailable 과 동일 패턴
async function pythonBackendAvailable(){
  if (/[?&]py=wasm\b/.test(location.search)) return false;  // 테스트용: ?py=wasm 이면 로컬 파이썬 무시하고 브라우저 Pyodide 강제
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;  // file:// → 백엔드 없음
  if (_pyBackend !== null) return _pyBackend;
  try {
    const res = await fetch("/can-run-python", { method: "GET" });
    _pyBackend = res.ok && (await res.text()).trim().toLowerCase().startsWith("yes");
  } catch(e){ _pyBackend = false; }
  return _pyBackend;
}

async function pythonEnvironmentDetails(){
  const browserMode = {
    backend: false,
    mode: "Browser Pyodide",
    python: "Pyodide " + PYODIDE_VER,
    command: "",
    pip: "자동 패키지 로드",
    jedi: "기본 자동완성",
    saveRoot: ""
  };
  if (location.protocol !== "http:" && location.protocol !== "https:") return browserMode;
  try {
    const res = await fetch("/python-diagnostics", { method: "GET", cache: "no-store" });
    if (res.ok){
      const data = await res.json();
      return {
        backend: !!data.ok,
        mode: data.ok ? "Local Python" : "Browser Pyodide",
        python: data.version || (data.ok ? "확인됨" : ("Pyodide " + PYODIDE_VER)),
        command: data.command || "",
        pip: data.pip ? "사용 가능" : (data.ok ? "확인 필요" : "자동 패키지 로드"),
        jedi: data.jedi ? "사용 가능" : (data.ok ? "설치 필요" : "기본 자동완성"),
        saveRoot: data.saveRoot || ""
      };
    }
  } catch(e){}
  const backend = await pythonBackendAvailable();
  return backend ? {
    backend: true, mode: "Local Python", python: "확인됨", command: "", pip: "확인 필요", jedi: "확인 필요", saveRoot: ""
  } : browserMode;
}

function refreshPythonEnvButton(btn){
  if (!btn) return;
  pythonEnvironmentDetails().then(info => {
    btn.classList.toggle("is-ok", !!info.backend);
    btn.classList.toggle("is-warn", !info.backend);
    btn.title = info.backend ? "로컬 Python 실행 환경 진단" : "브라우저 Pyodide 실행 환경";
  }).catch(() => {});
}

// Py Env 버튼: 실행 환경 정보를 모달로 표시(편집기 아래 영역을 차지하지 않게).
function openPythonEnvModal(btn){
  const modal = document.createElement("div"); modal.className = "modal py-env-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const panel = document.createElement("div"); panel.className = "py-env-panel";
  const close = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
  const onKey = (e) => { if (e.key === "Escape"){ e.preventDefault(); close(); } };
  const actions = document.createElement("div"); actions.className = "modal-actions";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "닫기";
  cancel.addEventListener("click", close);
  actions.append(spacer, cancel);
  card.append(panel, actions);
  modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });   // 바깥 클릭 닫기
  document.body.appendChild(modal);
  setTimeout(() => { try { cancel.focus(); } catch(e){} }, 0);
  window.addEventListener("keydown", onKey, true);
  refreshPythonEnvPanel(panel, btn);
}

function loadAssignmentTests(storageKey){
  try { return normalizeAssignmentTests(JSON.parse(localStorage.getItem(storageKey) || "[]")); }
  catch(_){ return []; }
}

function saveAssignmentTests(storageKey, tests){
  const rows = normalizeAssignmentTests(tests);
  try { localStorage.setItem(storageKey, JSON.stringify(rows)); } catch(_){}
  return rows;
}

function openAssignmentGradingModal(options){
  options = options || {};
  const modal = document.createElement("div"); modal.className = "modal py-grade-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const title = document.createElement("h3"); title.textContent = "과제 자동채점";
  const sub = document.createElement("p"); sub.className = "sub";
  sub.textContent = "각 테스트의 input() 입력과 기대 출력을 적으세요. 줄 끝 공백과 앞뒤 빈 줄은 채점에서 무시합니다.";
  const list = document.createElement("div"); list.className = "py-grade-test-list";
  let seed = loadAssignmentTests(options.storageKey);
  if (!seed.length) seed = [{ name:"테스트 1", input:"", expected:"" }];

  const collect = () => normalizeAssignmentTests([...list.querySelectorAll(".py-grade-test")].map(row => ({
    name: row.querySelector(".py-grade-name").value,
    input: row.querySelector(".py-grade-input").value,
    expected: row.querySelector(".py-grade-expected").value
  })));
  const renumber = () => {
    [...list.querySelectorAll(".py-grade-test")].forEach((row, index) => {
      const label = row.querySelector(".py-grade-index");
      if (label) label.textContent = "#" + (index + 1);
    });
  };
  const addRow = (test) => {
    if (list.children.length >= 20) { toast("테스트는 최대 20개까지 만들 수 있어요.", 2200); return; }
    const row = document.createElement("section"); row.className = "py-grade-test";
    const head = document.createElement("div"); head.className = "py-grade-test-head";
    const index = document.createElement("span"); index.className = "py-grade-index";
    const name = document.createElement("input"); name.type = "text"; name.className = "py-grade-name";
    name.maxLength = 120; name.value = test.name || ("테스트 " + (list.children.length + 1)); name.setAttribute("aria-label", "테스트 이름");
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "py-grade-remove"; remove.textContent = "삭제";
    remove.addEventListener("click", () => {
      row.remove();
      if (!list.children.length) addRow({ name:"테스트 1", input:"", expected:"" });
      renumber();
    });
    head.append(index, name, remove);
    const fields = document.createElement("div"); fields.className = "py-grade-fields";
    const makeField = (labelText, cls, value, placeholder) => {
      const label = document.createElement("label"); label.textContent = labelText;
      const area = document.createElement("textarea"); area.className = cls; area.value = value || "";
      area.placeholder = placeholder; area.spellcheck = false; area.maxLength = 20000;
      label.appendChild(area);
      return label;
    };
    fields.append(
      makeField("입력값 (input)", "py-grade-input", test.input, "예: 2↵3"),
      makeField("기대 출력", "py-grade-expected", test.expected, "예: 5")
    );
    row.append(head, fields); list.appendChild(row); renumber();
  };
  seed.forEach(addRow);

  const actions = document.createElement("div"); actions.className = "modal-actions";
  const add = document.createElement("button"); add.className = "btn"; add.type = "button"; add.textContent = "+ 테스트 추가";
  add.addEventListener("click", () => addRow({ name:"테스트 " + (list.children.length + 1), input:"", expected:"" }));
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "닫기";
  const run = document.createElement("button"); run.className = "btn primary"; run.type = "button"; run.textContent = "저장하고 채점";
  const close = (save) => {
    window.removeEventListener("keydown", onKey, true);
    modal.remove();
    if (save){
      try { saveAssignmentTests(options.storageKey, collect()); }
      catch(e){ console.warn("assignment tests save skipped:", e); }
    }
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation(); close(true);
  };
  cancel.addEventListener("click", () => close(true));
  run.addEventListener("click", () => {
    const tests = saveAssignmentTests(options.storageKey, collect());
    close(false);
    if (typeof options.onRun === "function") options.onRun(tests);
  });
  actions.append(add, spacer, cancel, run);
  card.append(title, sub, list, actions); modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(true); });
  document.body.appendChild(modal);
  window.addEventListener("keydown", onKey, true);
  setTimeout(() => { const first = list.querySelector(".py-grade-name"); if (first) first.focus(); }, 0);
}

const PY_GRADE_MARKER = "__MANNEUNG_GRADE__";
function utf8ToBase64(value){
  const bytes = new TextEncoder().encode(String(value == null ? "" : value));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function base64ToUtf8(value){
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function buildPythonGradingHarness(source, tests, fileName){
  const source64 = utf8ToBase64(source);
  const tests64 = utf8ToBase64(JSON.stringify(normalizeAssignmentTests(tests)));
  const file64 = utf8ToBase64(fileName || "assignment.py");
  return [
    "import base64 as __mg_b64, contextlib as __mg_ctx, io as __mg_io, json as __mg_json, os as __mg_os, sys as __mg_sys, traceback as __mg_tb",
    "__mg_source = __mg_b64.b64decode('" + source64 + "').decode('utf-8')",
    "__mg_cases = __mg_json.loads(__mg_b64.b64decode('" + tests64 + "').decode('utf-8'))",
    "__mg_file = str(globals().get('__file__') or __mg_b64.b64decode('" + file64 + "').decode('utf-8'))",
    "__mg_start_dir = __mg_os.getcwd()",
    "def __mg_norm(__mg_value):",
    "    __mg_lines = str(__mg_value).replace('\\r\\n', '\\n').replace('\\r', '\\n').split('\\n')",
    "    while __mg_lines and not __mg_lines[0].strip(): __mg_lines.pop(0)",
    "    while __mg_lines and not __mg_lines[-1].strip(): __mg_lines.pop()",
    "    return '\\n'.join(__mg_line.rstrip(' \\t') for __mg_line in __mg_lines)",
    "class __mg_Limited(__mg_io.StringIO):",
    "    def __init__(self, limit=200000):",
    "        super().__init__(); self.limit = limit; self.cut = False",
    "    def write(self, value):",
    "        text = str(value); remaining = max(0, self.limit - self.tell())",
    "        if remaining: super().write(text[:remaining])",
    "        if len(text) > remaining and not self.cut:",
    "            self.cut = True; super().write('\\n[채점 출력이 200KB를 넘어 일부 생략됨]\\n')",
    "        return len(text)",
    "__mg_results = []",
    "for __mg_index, __mg_case in enumerate(__mg_cases):",
    "    __mg_out, __mg_err = __mg_Limited(), __mg_Limited()",
    "    __mg_old_in = __mg_sys.stdin",
    "    __mg_error = ''",
    "    try:",
    "        __mg_sys.stdin = __mg_io.StringIO(str(__mg_case.get('input', '')))",
    "        __mg_scope = {'__name__': '__main__', '__file__': __mg_file}",
    "        with __mg_ctx.redirect_stdout(__mg_out), __mg_ctx.redirect_stderr(__mg_err):",
    "            exec(compile(__mg_source, __mg_file, 'exec'), __mg_scope, __mg_scope)",
    "    except BaseException:",
    "        __mg_error = __mg_tb.format_exc().strip()",
    "    finally:",
    "        __mg_sys.stdin = __mg_old_in",
    "        try: __mg_os.chdir(__mg_start_dir)",
    "        except BaseException: pass",
    "    __mg_actual = __mg_out.getvalue()",
    "    __mg_stderr = __mg_err.getvalue().strip()",
    "    if __mg_stderr and not __mg_error: __mg_error = __mg_stderr",
    "    __mg_expected = str(__mg_case.get('expected', ''))",
    "    __mg_results.append({'name': str(__mg_case.get('name') or ('테스트 ' + str(__mg_index + 1))), 'input': str(__mg_case.get('input', '')), 'expected': __mg_expected, 'actual': __mg_actual, 'error': __mg_error, 'passed': not __mg_error and __mg_norm(__mg_actual) == __mg_norm(__mg_expected)})",
    "__mg_payload = __mg_json.dumps({'results': __mg_results}, ensure_ascii=False).encode('utf-8')",
    "print('" + PY_GRADE_MARKER + "' + __mg_b64.b64encode(__mg_payload).decode('ascii'))"
  ].join("\n");
}

function parsePythonGradingReport(stdout){
  const text = String(stdout || "");
  const at = text.lastIndexOf(PY_GRADE_MARKER);
  if (at < 0) return null;
  const encoded = text.slice(at + PY_GRADE_MARKER.length).trim().split(/\s/)[0];
  try {
    const parsed = JSON.parse(base64ToUtf8(encoded));
    if (!parsed || !Array.isArray(parsed.results)) return null;
    parsed.results = parsed.results.slice(0, 20).map((row, index) => ({
      name: String(row && row.name || ("테스트 " + (index + 1))).slice(0, 120),
      input: String(row && row.input || ""),
      expected: String(row && row.expected || ""),
      actual: String(row && row.actual || ""),
      error: String(row && row.error || ""),
      passed: !!(row && row.passed)
    }));
    return parsed;
  } catch(_){ return null; }
}

function renderAssignmentGradingResult(panel, report, stderr){
  panel.innerHTML = "";
  const results = report && Array.isArray(report.results) ? report.results : [];
  const passed = results.filter(row => row.passed).length;
  const head = document.createElement("div"); head.className = "out-head";
  head.textContent = results.length ? ("과제 자동채점 · " + passed + "/" + results.length + " 통과") : "과제 자동채점";
  panel.appendChild(head);
  if (!results.length){
    const pre = document.createElement("pre"); pre.className = "out-pre out-err";
    pre.textContent = stderr || "채점 결과를 읽지 못했습니다. 일반 실행으로 코드 오류를 먼저 확인해 주세요.";
    panel.appendChild(pre);
    return { passed:0, total:0 };
  }
  const summary = document.createElement("div"); summary.className = "py-grade-summary " + (passed === results.length ? "is-pass" : "is-fail");
  const score = document.createElement("strong"); score.textContent = passed + " / " + results.length;
  const label = document.createElement("span"); label.textContent = passed === results.length ? "모든 테스트 통과" : (results.length - passed) + "개 테스트를 다시 확인하세요";
  summary.append(score, label); panel.appendChild(summary);
  const list = document.createElement("div"); list.className = "py-grade-results";
  results.forEach((row, index) => {
    const item = document.createElement("details"); item.className = "py-grade-result " + (row.passed ? "is-pass" : "is-fail");
    if (!row.passed) item.open = true;
    const title = document.createElement("summary");
    const mark = document.createElement("span"); mark.className = "py-grade-result-mark"; mark.textContent = row.passed ? "통과" : "실패";
    const name = document.createElement("span"); name.textContent = row.name || ("테스트 " + (index + 1));
    title.append(mark, name); item.appendChild(title);
    const body = document.createElement("div"); body.className = "py-grade-result-body";
    const addValue = (caption, value, cls) => {
      const block = document.createElement("div"); block.className = "py-grade-result-value" + (cls ? " " + cls : "");
      const labelEl = document.createElement("b"); labelEl.textContent = caption;
      const pre = document.createElement("pre"); pre.textContent = value === "" ? "(없음)" : value;
      block.append(labelEl, pre); body.appendChild(block);
    };
    if (row.input) addValue("입력", row.input);
    addValue("기대 출력", row.expected);
    addValue("실제 출력", row.actual);
    if (row.error) addValue("실행 오류", row.error, "is-error");
    item.appendChild(body); list.appendChild(item);
  });
  panel.appendChild(list);
  return { passed, total:results.length };
}

const PY_DIAG_MARKER = "__MANNEUNG_DIAG__";
const PY_TRACE_MARKER = "__MANNEUNG_TRACE__";

function buildPythonDiagnosticHarness(source, fileName){
  const source64 = utf8ToBase64(source);
  const file64 = utf8ToBase64(fileName || "practice.py");
  return [
    "import ast as __md_ast, base64 as __md_b64, builtins as __md_builtins, json as __md_json, warnings as __md_warnings",
    "__md_source = __md_b64.b64decode('" + source64 + "').decode('utf-8')",
    "__md_file = __md_b64.b64decode('" + file64 + "').decode('utf-8')",
    "__md_items = []",
    "def __md_add(severity, line, column, code, message, hint=''):",
    "    __md_items.append({'severity': severity, 'line': max(1, int(line or 1)), 'column': max(0, int(column or 0)), 'code': code, 'message': message, 'hint': hint})",
    "for __md_no, __md_line in enumerate(__md_source.splitlines(), 1):",
    "    __md_indent = __md_line[:len(__md_line) - len(__md_line.lstrip(' \\t'))]",
    "    if '\\t' in __md_indent:",
    "        __md_add('warning', __md_no, 0, 'PY-TAB', '들여쓰기에 탭 문자가 있어요.', '탭과 공백을 섞으면 실행 환경에 따라 들여쓰기가 달라질 수 있어요. 공백 4칸으로 맞춰 보세요.')",
    "__md_tree = None",
    "try:",
    "    with __md_warnings.catch_warnings(record=True) as __md_caught:",
    "        __md_warnings.simplefilter('always')",
    "        compile(__md_source, __md_file, 'exec')",
    "    for __md_warning in __md_caught:",
    "        __md_add('warning', getattr(__md_warning, 'lineno', 1), 0, 'PY-WARN', str(__md_warning.message), 'Python이 실행 전에 발견한 경고입니다.')",
    "    __md_tree = __md_ast.parse(__md_source, __md_file)",
    "except (SyntaxError, IndentationError, TabError) as __md_error:",
    "    __md_add('error', getattr(__md_error, 'lineno', 1), max(0, (getattr(__md_error, 'offset', 1) or 1) - 1), type(__md_error).__name__, getattr(__md_error, 'msg', str(__md_error)), '표시된 줄과 바로 위 줄의 괄호·콜론·따옴표·들여쓰기를 확인해 보세요.')",
    "if __md_tree is not None:",
    "    _md_defined = {'__name__': 1, '__file__': 1}",
    "    _md_loaded = {}",
    "    _md_wildcard = False",
    "    _md_ast = __md_ast",
    "    class __md_Names(__md_ast.NodeVisitor):",
    "        def visit_Name(self, node):",
    "            if isinstance(node.ctx, _md_ast.Store): _md_defined.setdefault(node.id, getattr(node, 'lineno', 1))",
    "            elif isinstance(node.ctx, _md_ast.Load): _md_loaded.setdefault(node.id, getattr(node, 'lineno', 1))",
    "        def visit_arg(self, node): _md_defined.setdefault(node.arg, getattr(node, 'lineno', 1))",
    "        def visit_FunctionDef(self, node):",
    "            _md_defined.setdefault(node.name, getattr(node, 'lineno', 1)); self.generic_visit(node)",
    "        visit_AsyncFunctionDef = visit_FunctionDef",
    "        def visit_ClassDef(self, node):",
    "            _md_defined.setdefault(node.name, getattr(node, 'lineno', 1)); self.generic_visit(node)",
    "        def visit_Import(self, node):",
    "            for alias in node.names: _md_defined.setdefault(alias.asname or alias.name.split('.')[0], getattr(node, 'lineno', 1))",
    "        def visit_ImportFrom(self, node):",
    "            global _md_wildcard",
    "            for alias in node.names:",
    "                if alias.name == '*': _md_wildcard = True",
    "                else: _md_defined.setdefault(alias.asname or alias.name, getattr(node, 'lineno', 1))",
    "        def visit_ExceptHandler(self, node):",
    "            if isinstance(node.name, str): _md_defined.setdefault(node.name, getattr(node, 'lineno', 1))",
    "            self.generic_visit(node)",
    "    __md_Names().visit(__md_tree)",
    "    __md_known = set(dir(__md_builtins)) | set(_md_defined)",
    "    if not _md_wildcard:",
    "        for __md_name, __md_line in _md_loaded.items():",
    "            if __md_name not in __md_known:",
    "                __md_add('warning', __md_line, 0, 'PY-NAME', \"'\" + __md_name + \"' 이름은 정의된 곳을 찾지 못했어요.\", '철자를 확인하거나, 사용하기 전에 값을 대입하거나 import했는지 확인하세요.')",
    "    for __md_node in __md_ast.walk(__md_tree):",
    "        __md_line = getattr(__md_node, 'lineno', 1); __md_col = getattr(__md_node, 'col_offset', 0)",
    "        if isinstance(__md_node, __md_ast.ExceptHandler) and __md_node.type is None:",
    "            __md_add('warning', __md_line, __md_col, 'PY-BARE-EXCEPT', '예외 종류가 없는 except는 모든 오류를 숨길 수 있어요.', 'except ValueError:처럼 예상한 예외 종류를 적어 주세요.')",
    "        if isinstance(__md_node, (__md_ast.FunctionDef, __md_ast.AsyncFunctionDef)):",
    "            for __md_default in list(__md_node.args.defaults) + [value for value in __md_node.args.kw_defaults if value is not None]:",
    "                if isinstance(__md_default, (__md_ast.List, __md_ast.Dict, __md_ast.Set)):",
    "                    __md_add('warning', getattr(__md_default, 'lineno', __md_line), getattr(__md_default, 'col_offset', __md_col), 'PY-MUTABLE-DEFAULT', '함수 기본값에 변경 가능한 자료형을 사용했어요.', '기본값은 None으로 두고 함수 안에서 새 리스트나 딕셔너리를 만드세요.')",
    "        if isinstance(__md_node, __md_ast.Compare) and any(isinstance(op, (__md_ast.Eq, __md_ast.NotEq)) for op in __md_node.ops):",
    "            __md_values = [__md_node.left] + list(__md_node.comparators)",
    "            if any(isinstance(value, __md_ast.Constant) and value.value is None for value in __md_values):",
    "                __md_add('info', __md_line, __md_col, 'PY-NONE', 'None 비교에는 is 또는 is not이 더 분명해요.', 'value is None 또는 value is not None 형태를 권장합니다.')",
    "        if isinstance(__md_node, __md_ast.Call) and isinstance(__md_node.func, __md_ast.Name) and __md_node.func.id in ('eval', 'exec'):",
    "            __md_add('warning', __md_line, __md_col, 'PY-DYNAMIC', __md_node.func.id + '()는 문자열을 코드로 실행해 예상하지 못한 동작을 만들 수 있어요.', '학습 목적이 아니라면 일반 조건문·함수 호출로 바꿀 수 있는지 확인하세요.')",
    "        if isinstance(__md_node, __md_ast.While) and isinstance(__md_node.test, __md_ast.Constant) and __md_node.test.value is True:",
    "            __md_add('info', __md_line, __md_col, 'PY-LOOP', '조건이 항상 참인 반복문입니다.', '반복문 안에 도달 가능한 break 또는 종료 조건이 있는지 확인하세요.')",
    "__md_items.sort(key=lambda item: (item['line'], item['column'], {'error': 0, 'warning': 1, 'info': 2}.get(item['severity'], 9)))",
    "__md_payload = __md_json.dumps({'diagnostics': __md_items[:100]}, ensure_ascii=False).encode('utf-8')",
    "print('" + PY_DIAG_MARKER + "' + __md_b64.b64encode(__md_payload).decode('ascii'))"
  ].join("\n");
}

// .ipynb 변환 문서를 "셀 단위"로 실행하는 하니스.
//  · '# … 코드 셀 N …' 주석을 경계로 잘라 각 셀을 같은 전역(globals)에서 차례로 실행
//  · 한 셀에서 에러가 나도 traceback만 보여주고 다음 셀을 계속 실행(주피터와 비슷)
//  · 각 셀을 원래 줄 위치에 맞춰 compile → traceback 줄 번호가 편집기와 정확히 일치
//  · 디스크의 임시 파일이 아닌 학생 코드를 linecache에 등록해 traceback 소스 줄도 올바르게 표시
function buildPythonCellHarness(source, fileName){
  const source64 = utf8ToBase64(String(source == null ? "" : source).replace(/\r\n?/g, "\n"));
  const file64 = utf8ToBase64(fileName || "notebook.py");
  // 역슬래시 이스케이프 혼선을 피하려고 줄바꿈은 chr(10), 셀 경계는 정규식 없이 문자열 검사로 처리한다.
  return [
    "import base64 as __nb_b64, sys as __nb_sys, traceback as __nb_tb, linecache as __nb_lc",
    "__nb_NL = chr(10)",
    "__nb_src = __nb_b64.b64decode('" + source64 + "').decode('utf-8')",
    "__nb_file = __nb_b64.b64decode('" + file64 + "').decode('utf-8')",
    "__nb_lines = __nb_src.split(__nb_NL)",
    "__nb_lc.cache[__nb_file] = (len(__nb_src), None, [__nb_l + __nb_NL for __nb_l in __nb_lines], __nb_file)",
    "def __nb_is_head(__nb_l):",
    "    __nb_t = __nb_l.lstrip()",
    "    return __nb_t.startswith('#') and (__nb_t.lstrip('#').lstrip().startswith('%%') or '코드 셀' in __nb_t)",
    "__nb_marks = [__nb_i for __nb_i, __nb_l in enumerate(__nb_lines) if __nb_is_head(__nb_l)]",
    "__nb_points = sorted(set([0] + __nb_marks + [len(__nb_lines)]))",
    "__nb_glob = {'__name__': '__main__', '__file__': __nb_file}",
    "__nb_failed = 0",
    "__nb_seq = 0",
    "def __nb_label(__nb_text):",
    "    return ''.join(__nb_c for __nb_c in __nb_text if __nb_c.isdigit())",
    "for __nb_k in range(len(__nb_points) - 1):",
    "    __nb_s = __nb_points[__nb_k]",
    "    __nb_e = __nb_points[__nb_k + 1]",
    "    __nb_body = __nb_lines[__nb_s:__nb_e]",
    "    __nb_code = __nb_NL * __nb_s + __nb_NL.join(__nb_body)",
    "    if not __nb_code.strip():",
    "        continue",
    "    __nb_seq += 1",
    "    __nb_digit = __nb_label(__nb_body[0] if __nb_body else '')",
    "    __nb_cell = __nb_digit or str(__nb_seq)",
    "    try:",
    "        __nb_obj = compile(__nb_code, __nb_file, 'exec')",
    "    except SyntaxError as __nb_ex:",
    "        __nb_sys.stdout.flush()",
    "        __nb_sys.stderr.write(__nb_NL + '[코드 셀 ' + __nb_cell + ' 문법 오류]' + __nb_NL)",
    "        __nb_sys.stderr.write(''.join(__nb_tb.format_exception_only(type(__nb_ex), __nb_ex)))",
    "        __nb_failed += 1",
    "        continue",
    "    try:",
    "        exec(__nb_obj, __nb_glob)",
    "    except SystemExit:",
    "        raise",
    "    except KeyboardInterrupt:",
    "        raise",
    "    except BaseException as __nb_ex:",
    "        __nb_sys.stdout.flush()",
    "        __nb_sys.stderr.write(__nb_NL + '[코드 셀 ' + __nb_cell + ' 오류 — 다음 셀은 계속 실행됩니다]' + __nb_NL)",
    "        __nb_sys.stderr.write(''.join(__nb_tb.format_exception(type(__nb_ex), __nb_ex, __nb_ex.__traceback__.tb_next)))",
    "        __nb_failed += 1",
    "if __nb_failed:",
    "    __nb_sys.stderr.flush()",
    "    __nb_sys.exit(1)",
    ""
  ].join("\n");
}

function buildPythonTraceHarness(source, fileName, maxSteps=300){
  const source64 = utf8ToBase64(source);
  const file64 = utf8ToBase64(fileName || "practice.py");
  const limit = Math.max(20, Math.min(500, parseInt(maxSteps, 10) || 300));
  return [
    "import base64 as __mt_b64, json as __mt_json, sys as __mt_sys, traceback as __mt_tb, types as __mt_types",
    "__mt_source = __mt_b64.b64decode('" + source64 + "').decode('utf-8')",
    "__mt_file = __mt_b64.b64decode('" + file64 + "').decode('utf-8')",
    "__mt_limit = " + limit,
    "__mt_steps, __mt_states, __mt_error, __mt_truncated = [], {}, '', False",
    "def __mt_repr(value):",
    "    try: text = repr(value)",
    "    except BaseException: text = '<값을 표시할 수 없음>'",
    "    return text if len(text) <= 240 else text[:239] + '…'",
    "def __mt_snapshot(frame):",
    "    result = {}",
    "    for name, value in sorted(frame.f_locals.items()):",
    "        if not name or name.startswith('__mt_') or name.startswith('__'): continue",
    "        if isinstance(value, (__mt_types.ModuleType, __mt_types.FunctionType, __mt_types.BuiltinFunctionType, type)) or callable(value): continue",
    "        result[name] = {'type': type(value).__name__[:120], 'value': __mt_repr(value)}",
    "        if len(result) >= 25: break",
    "    return result",
    "def __mt_depth(frame):",
    "    depth, current = 0, frame.f_back",
    "    while current is not None:",
    "        if current.f_code.co_filename == __mt_file: depth += 1",
    "        current = current.f_back",
    "    return depth",
    "def __mt_trace(frame, event, arg):",
    "    global __mt_truncated",
    "    if frame.f_code.co_filename != __mt_file: return __mt_trace",
    "    if event not in ('line', 'return'): return __mt_trace",
    "    if len(__mt_steps) >= __mt_limit:",
    "        __mt_truncated = True",
    "        return None",
    "    current = __mt_snapshot(frame)",
    "    key = id(frame); previous = __mt_states.get(key, {})",
    "    changes = []",
    "    for name in sorted(set(previous) | set(current)):",
    "        if name not in previous: changes.append({'name': name, 'before': '', 'after': current[name]['value'], 'type': current[name]['type'], 'kind': 'added'})",
    "        elif name not in current: changes.append({'name': name, 'before': previous[name]['value'], 'after': '', 'type': previous[name]['type'], 'kind': 'removed'})",
    "        elif previous[name] != current[name]: changes.append({'name': name, 'before': previous[name]['value'], 'after': current[name]['value'], 'type': current[name]['type'], 'kind': 'changed'})",
    "    if event == 'return' and arg is not None:",
    "        changes.append({'name': '↩ 반환값', 'before': '', 'after': __mt_repr(arg), 'type': type(arg).__name__[:120], 'kind': 'added'})",
    "    __mt_states[key] = current",
    "    variables = [{'name': name, 'type': value['type'], 'value': value['value']} for name, value in current.items()]",
    "    __mt_steps.append({'line': max(1, int(frame.f_lineno or 1)), 'functionName': frame.f_code.co_name, 'depth': __mt_depth(frame), 'phase': event, 'variables': variables, 'changes': changes[:25]})",
    "    if event == 'return': __mt_states.pop(key, None)",
    "    return __mt_trace",
    "__mt_scope = {'__name__': '__main__', '__file__': __mt_file}",
    "try:",
    "    __mt_code = compile(__mt_source, __mt_file, 'exec')",
    "    __mt_sys.settrace(__mt_trace)",
    "    exec(__mt_code, __mt_scope, __mt_scope)",
    "except BaseException:",
    "    __mt_error = __mt_tb.format_exc().strip()",
    "finally:",
    "    __mt_sys.settrace(None)",
    "__mt_payload = __mt_json.dumps({'steps': __mt_steps, 'truncated': __mt_truncated, 'error': __mt_error}, ensure_ascii=False).encode('utf-8')",
    "print('\\n" + PY_TRACE_MARKER + "' + __mt_b64.b64encode(__mt_payload).decode('ascii'))"
  ].join("\n");
}

function parsePythonMarkedReport(stdout, marker){
  const text = String(stdout || "");
  const at = text.lastIndexOf(marker);
  if (at < 0) return null;
  const encoded = text.slice(at + marker.length).trim().split(/\s/)[0];
  try {
    return {
      report: JSON.parse(base64ToUtf8(encoded)),
      output: text.slice(0, at).replace(/\r?\n$/, "")
    };
  } catch(_){ return null; }
}

function renderPythonDiagnostics(panel, rawReport, ui){
  panel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head"; head.textContent = "실행 전 코드 진단";
  panel.appendChild(head);
  if (!rawReport){
    const failed = document.createElement("div"); failed.className = "py-diagnostic-summary is-error";
    failed.textContent = "진단 결과를 읽지 못했습니다. 실행 환경을 확인한 뒤 다시 시도해 주세요.";
    panel.appendChild(failed);
    return { errors:1, warnings:0, total:0 };
  }
  const diagnostics = normalizePythonDiagnostics(rawReport.diagnostics);
  const errors = diagnostics.filter(item => item.severity === "error").length;
  const warnings = diagnostics.filter(item => item.severity === "warning").length;
  const summary = document.createElement("div");
  summary.className = "py-diagnostic-summary " + (errors ? "is-error" : warnings ? "is-warning" : "is-ok");
  summary.textContent = diagnostics.length
    ? ("오류 " + errors + "개 · 경고 " + warnings + "개 · 참고 " + (diagnostics.length - errors - warnings) + "개")
    : "발견된 문제가 없습니다. 그래도 실행 결과가 의도와 같은지는 직접 확인해 주세요.";
  panel.appendChild(summary);
  if (!diagnostics.length){
    if (ui && ui.clearError) ui.clearError();
    return { errors, warnings, total:0 };
  }
  const list = document.createElement("div"); list.className = "py-diagnostic-list";
  const severityLabel = { error:"오류", warning:"경고", info:"참고" };
  diagnostics.forEach(item => {
    const row = document.createElement("button"); row.type = "button"; row.className = "py-diagnostic-item is-" + item.severity;
    const mark = document.createElement("span"); mark.className = "py-diagnostic-mark"; mark.textContent = severityLabel[item.severity];
    const where = document.createElement("code"); where.textContent = item.line + "줄" + (item.column ? " " + (item.column + 1) + "칸" : "");
    const body = document.createElement("span"); body.className = "py-diagnostic-body";
    const message = document.createElement("strong"); message.textContent = item.message;
    body.appendChild(message);
    if (item.hint){ const hint = document.createElement("small"); hint.textContent = item.hint; body.appendChild(hint); }
    const code = document.createElement("code"); code.className = "py-diagnostic-code"; code.textContent = item.code;
    row.append(mark, where, body, code);
    row.addEventListener("click", () => { if (ui && ui.focusLine) ui.focusLine(item.line); });
    list.appendChild(row);
  });
  panel.appendChild(list);
  const firstError = diagnostics.find(item => item.severity === "error");
  if (firstError && ui && ui.markError) ui.markError(firstError.line);
  else if (ui && ui.clearError) ui.clearError();
  return { errors, warnings, total:diagnostics.length };
}

function renderPythonTrace(panel, parsed, source, ui){
  panel.innerHTML = "";
  const report = normalizePythonTraceReport(parsed && parsed.report);
  const steps = report.steps;
  const lines = String(source || "").split("\n");
  const head = document.createElement("div"); head.className = "out-head";
  head.textContent = "단계 실행 · " + steps.length + "단계";
  panel.appendChild(head);
  if (parsed && parsed.output){
    const output = document.createElement("details"); output.className = "py-trace-output";
    const summary = document.createElement("summary"); summary.textContent = "프로그램 출력";
    const pre = document.createElement("pre"); pre.textContent = parsed.output;
    output.append(summary, pre); panel.appendChild(output);
  }
  if (!steps.length){
    const empty = document.createElement("div"); empty.className = "py-trace-empty";
    empty.textContent = report.error || "기록된 실행 단계가 없습니다.";
    panel.appendChild(empty);
    if (ui && ui.clearTraceLine) ui.clearTraceLine();
    return { steps:0, error:report.error };
  }
  const controls = document.createElement("div"); controls.className = "py-trace-controls";
  const prev = document.createElement("button"); prev.type = "button"; prev.textContent = "← 이전";
  const slider = document.createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = String(steps.length - 1); slider.value = "0";
  const next = document.createElement("button"); next.type = "button"; next.textContent = "다음 →";
  const count = document.createElement("strong");
  controls.append(prev, slider, next, count); panel.appendChild(controls);
  const card = document.createElement("section"); card.className = "py-trace-card"; panel.appendChild(card);
  const renderTable = (title, rows, columns, cls) => {
    const block = document.createElement("div"); block.className = cls;
    const h = document.createElement("h4"); h.textContent = title; block.appendChild(h);
    if (!rows.length){ const empty = document.createElement("div"); empty.className = "py-trace-none"; empty.textContent = "변화 없음"; block.appendChild(empty); return block; }
    const table = document.createElement("table");
    const thead = document.createElement("thead"), hr = document.createElement("tr");
    columns.forEach(column => { const th = document.createElement("th"); th.textContent = column.label; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach(row => {
      const tr = document.createElement("tr");
      columns.forEach(column => { const td = document.createElement("td"); const code = document.createElement("code"); code.textContent = column.value(row); td.appendChild(code); tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); block.appendChild(table); return block;
  };
  const show = (index) => {
    index = Math.max(0, Math.min(steps.length - 1, parseInt(index, 10) || 0));
    slider.value = String(index); prev.disabled = index === 0; next.disabled = index === steps.length - 1;
    const step = steps[index];
    count.textContent = (index + 1) + " / " + steps.length;
    card.innerHTML = "";
    const meta = document.createElement("div"); meta.className = "py-trace-meta";
    const line = document.createElement("strong"); line.textContent = step.line + "줄";
    const fn = document.createElement("code"); fn.textContent = step.functionName + (step.phase === "return" ? " · 함수 종료" : "") + (step.depth ? " · 호출 깊이 " + step.depth : "");
    meta.append(line, fn);
    const codeLine = document.createElement("pre"); codeLine.className = "py-trace-source"; codeLine.textContent = lines[step.line - 1] || "";
    card.append(meta, codeLine);
    card.appendChild(renderTable("이 단계에서 관찰된 변수 변화", step.changes, [
      { label:"이름", value:row => row.name },
      { label:"이전", value:row => row.before || "(없음)" },
      { label:"현재", value:row => row.after || "(없음)" }
    ], "py-trace-changes"));
    card.appendChild(renderTable("현재 지역 변수", step.variables, [
      { label:"이름", value:row => row.name },
      { label:"자료형", value:row => row.type },
      { label:"값", value:row => row.value }
    ], "py-trace-vars"));
    if (ui && ui.showTraceLine) ui.showTraceLine(step.line);
  };
  prev.addEventListener("click", () => show(Number(slider.value) - 1));
  next.addEventListener("click", () => show(Number(slider.value) + 1));
  slider.addEventListener("input", () => show(slider.value));
  controls.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft"){ event.preventDefault(); show(Number(slider.value) - 1); }
    else if (event.key === "ArrowRight"){ event.preventDefault(); show(Number(slider.value) + 1); }
  });
  if (report.truncated){
    const note = document.createElement("div"); note.className = "py-trace-note";
    note.textContent = "기록이 300단계를 넘어 이후 단계는 생략했습니다. 반복 횟수를 줄여 다시 실행하면 전체 흐름을 보기 쉬워요.";
    panel.appendChild(note);
  }
  if (report.error){
    const error = document.createElement("pre"); error.className = "py-trace-error"; error.textContent = report.error; panel.appendChild(error);
  }
  show(0);
  return { steps:steps.length, error:report.error };
}

async function refreshPythonEnvPanel(panel, btn){
  if (!panel) return;
  panel.innerHTML = '<div class="py-env-head"><span>Python 실행 환경</span><span class="py-env-muted">확인 중...</span></div>';
  const info = await pythonEnvironmentDetails();
  if (btn){
    btn.classList.toggle("is-ok", !!info.backend);
    btn.classList.toggle("is-warn", !info.backend);
  }
  const statusCls = info.backend ? "py-env-ok" : "py-env-warn";
  const rows = [
    ["실행 방식", info.mode, statusCls],
    ["Python", info.python || "-", ""],
    ["명령", info.command || "-", ""],
    ["pip", info.pip || "-", info.pip === "사용 가능" || info.pip === "자동 패키지 로드" ? "py-env-ok" : "py-env-warn"],
    ["자동완성", info.jedi || "-", info.jedi === "사용 가능" ? "py-env-ok" : ""]
  ];
  if (info.saveRoot) rows.push(["저장 위치", info.saveRoot, ""]);
  const dl = document.createElement("dl"); dl.className = "py-env-grid";
  rows.forEach(([k, v, cls]) => {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v; dd.title = v;
    if (cls) dd.className = cls;
    dl.append(dt, dd);
  });
  panel.innerHTML = "";
  const head = document.createElement("div"); head.className = "py-env-head";
  const title = document.createElement("span"); title.textContent = "Python 실행 환경";
  const state = document.createElement("span"); state.className = statusCls; state.textContent = info.backend ? "로컬 실행" : "브라우저 실행";
  head.append(title, state);
  panel.append(head, dl);
}

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
  ui.running = true;
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
  split.classList.add("show-out");
  if (ui.clearBtn){ ui.clearBtn.hidden = false; ui.clearBtn.disabled = true; }
  if (ui.layoutBtn) ui.layoutBtn.hidden = false;
  const modeTitle = diagnosing ? "실행 전 코드 진단" : tracing ? "단계 실행" : grading ? "과제 자동채점" : "실행 결과";
  const modeProgress = diagnosing ? "코드를 실행하지 않고 분석 중…" : tracing ? "실행 흐름 기록 중…" : grading ? "테스트 실행 중…" : "실행 중…";
  outPanel.innerHTML = '<div class="out-head">' + modeTitle + '</div><pre class="out-pre out-muted">' + modeProgress + '</pre>';
  const setStatus = (m) => { status.textContent = m; };
  if (ui.clearError) ui.clearError();                                   // 이전 실행의 에러 줄 표시 해제
  if (ui.clearTraceLine) ui.clearTraceLine();
  const applyErr = (code, stderr) => {
    if (!code) return;
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
        const scopeFilter = runCtx.archiveCtx.paths
          ? buildArchiveScopeFilter(targetRel, studentSource, runCtx.archiveCtx.paths, runCtx.archiveCtx.directories || [], preferredCwd)
          : null;
        let files = await runCtx.archiveCtx.extract(scopeFilter || undefined);
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
        const r = await runPythonInteractive(executionSource, bundle, ui, { bindCancel });
        throwIfCancelled();
        if (diagnosing){
          const parsed = parsePythonMarkedReport(r.stdout, PY_DIAG_MARKER);
          const summary = renderPythonDiagnostics(outPanel, parsed && parsed.report, ui);
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
          const score = renderAssignmentGradingResult(outPanel, report, r.stderr);
          const gradingErrors = report ? report.results.map(row => row.error).filter(Boolean).join("\n") : r.stderr;
          if (gradingErrors) applyErr(1, gradingErrors);
          setStatus(score.total ? ("채점 완료 · " + score.passed + "/" + score.total + " 통과 · 로컬 파이썬" + withFolder) : "채점 오류 · 로컬 파이썬");
          break;
        }
        const missing = (r.code !== 0) ? detectMissingModule(r.stderr) : null;
        if (missing && !tried.has(missing) && tried.size < 6){
          tried.add(missing);
          const pip = importToPip(missing);
          const localIncluded = bundleHasLocalModule(bundle, missing);
          if (localIncluded){
            toast("'" + missing + "' 파일은 작업폴더에 있지만 import 경로가 맞지 않아요. 작업폴더 목록과 패키지 구조를 확인하세요.", 4200);
          } else if (await confirmDialog(
            "'" + missing + "' 모듈을 찾지 못했어요.\n\n직접 만든 모듈이라면 같은 작업폴더에 " + missing + ".py 또는 " +
            missing + "/__init__.py가 있어야 합니다.\n외부 라이브러리가 맞다면 '" + pip + "'을(를) pip로 설치할 수 있습니다.",
            "pip 설치 후 실행", "취소")){
            const ok = await runPipInstall([pip], ui);
            throwIfCancelled();
            if (ok) continue;   // 설치 성공 → 자동 재실행
          }
        }
        throwIfCancelled();
        setStatus((r.code === 0 ? "완료" : "종료 코드 " + r.code) + " · 로컬 파이썬" + withFolder);
        applyErr(r.code, r.stderr);                  // 에러 줄 강조
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
        const head = outPanel.querySelector(".out-head");
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
        const summary = renderPythonDiagnostics(outPanel, parsed && parsed.report, ui);
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
        const score = renderAssignmentGradingResult(outPanel, report, r.stderr);
        const gradingErrors = report ? report.results.map(row => row.error).filter(Boolean).join("\n") : r.stderr;
        if (gradingErrors) applyErr(1, gradingErrors);
        setStatus(score.total ? ("채점 완료 · " + score.passed + "/" + score.total + " 통과 · 브라우저(Pyodide)" + withFolder) : "채점 오류 · 브라우저(Pyodide)");
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
    if (ui.clearBtn) ui.clearBtn.disabled = false;
  }
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
  const kind = (typeof classifyPythonStderr === "function")
    ? classifyPythonStderr(stderr, status)
    : (stderr ? "error" : "none");
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
  const stderrEl = document.createElement("span"); stderrEl.className = "out-warn";
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
  const displayText = (text) => text.length > FINAL_HEAD + FINAL_TAIL + 200
    ? text.slice(0, FINAL_HEAD)
      + "\n\n…(출력이 " + text.length.toLocaleString() + "자로 길어 중간을 생략했어요)…\n\n"
      + text.slice(-FINAL_TAIL)
    : text;
  const liveText = (text) => text.length > LIVE_TAIL
    ? "…(출력이 길어 마지막 부분만 표시 중 — 전체는 실행이 끝나면 표시)\n" + text.slice(-LIVE_TAIL)
    : text;
  let shownOut = null, shownErr = null;
  let fullOut = "", fullErr = "";           // 증분(delta) 응답을 이어붙인 누적 출력
  let knownOutLen = -1, knownErrLen = -1;   // 이미 받은 출력 길이 — 서버가 같으면 "unchanged", 자랐으면 새 내용만 응답
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
        const toShow = data.complete ? displayText : liveText;
        const nextOut = toShow(fullOut);
        const nextErr = fullErr ? ((fullOut ? "\n" : "") + toShow(fullErr)) : "";
        if (nextOut !== shownOut || nextErr !== shownErr){
          if (nextOut !== shownOut){ shownOut = nextOut; stdoutEl.textContent = nextOut; }
          if (nextErr !== shownErr){ shownErr = nextErr; stderrEl.textContent = nextErr; }
          applyPythonStderrClass(stderrEl, fullErr, data.complete ? data.code : undefined);
          outPanel.scrollTop = outPanel.scrollHeight;
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
  result.sessionId = sessionId;
  return result;
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
      dl.href = "/python-session-file?id=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(f.name);
      open.addEventListener("click", () => openSessionFile(sessionId, f.name));
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
  split.classList.add("show-out");
  if (ui.clearBtn) ui.clearBtn.hidden = false;
  if (ui.layoutBtn) ui.layoutBtn.hidden = false;
  outPanel.innerHTML = "";
  const head = document.createElement("div"); head.className = "out-head"; head.textContent = "패키지 설치";
  const pre = document.createElement("pre"); pre.className = "out-pre out-muted";
  pre.textContent = "pip install " + pkgs.join(" ") + " …\n(수십 초~몇 분 걸릴 수 있어요 · 인터넷 필요)";
  outPanel.append(head, pre);
  if (status) status.textContent = "설치 중… " + pkgs.join(" ");
  try {
    const res = await fetch("/pip-install", { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: pkgs.join(" ") });
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
  if (ui.clearBtn) ui.clearBtn.hidden = false;
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
// 실행 후 새로 생기거나 크기가 바뀐 파일을 {name, size, bytes}[] 로 수집(파일 20MB·합계 50MB 상한)
function pyFsCollectOutputs(py, base, snap){
  const out = []; let total = 0;
  for (const f of pyFsWalk(py, base)){
    if (snap.has(f.path) && snap.get(f.path) === f.size + ":" + f.mtime) continue;
    if (f.size > 20 * 1024 * 1024) continue;
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
      if (file.size > 20 * 1024 * 1024) continue;
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
  [["pen","✏️","펜"],["highlighter","🖍️","형광펜"],["eraser","🧽","지우개"]].forEach(([t, icon, title]) => { const b = mk(icon, title, "pen-tool", () => setTool(t)); tools[t] = b; bar.appendChild(b); });
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
  bar.appendChild(mk("✕", "필기 모드 끄기", "pen-act", () => { if (_codePenActive && _codePenActive.doc) setCodePenMode(_codePenActive.doc, false); }));
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
