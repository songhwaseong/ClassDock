"use strict";

// Python 편집기의 결과 패널을 보존한 채 터미널 화면과 전환한다.
// EXE에서는 PowerShell 명령을 로컬 런처가 실행하고, 일반 브라우저에서는
// 같은 UI를 상태가 유지되는 Pyodide Python 콘솔로 사용한다.
function createPythonTerminal(options){
  options = options || {};
  const ui = options.ui || {};
  const outPanel = ui.outPanel;
  // 결과/터미널을 오가는 토글 버튼 하나로 동작한다. (예전 두 버튼 방식과의 호환도 유지)
  const toggleButton = options.toggleButton || options.terminalButton;
  if (!outPanel || !toggleButton) return {
    showResults:() => {},
    showTerminal:() => {},
    destroy:() => {}
  };

  const resultStore = document.createDocumentFragment();
  const terminalStore = document.createDocumentFragment();
  const root = document.createElement("section"); root.className = "py-terminal";
  const head = document.createElement("div"); head.className = "out-head py-terminal-head";
  const title = document.createElement("span"); title.className = "py-terminal-title"; title.textContent = "터미널";
  const mode = document.createElement("span"); mode.className = "py-terminal-mode"; mode.textContent = "환경 확인 중…";
  const headButtons = document.createElement("span"); headButtons.className = "py-terminal-head-buttons";
  const clearButton = document.createElement("button"); clearButton.type = "button"; clearButton.className = "py-terminal-tool"; clearButton.textContent = "지우기";
  const resetButton = document.createElement("button"); resetButton.type = "button"; resetButton.className = "py-terminal-tool"; resetButton.textContent = "초기화";
  const stopButton = document.createElement("button"); stopButton.type = "button"; stopButton.className = "terminal-stop"; stopButton.textContent = "중지"; stopButton.disabled = true;
  stopButton.title = "실행 중인 명령 종료 (Ctrl+C)";
  headButtons.append(clearButton, resetButton, stopButton);
  head.append(title, mode, headButtons);

  const log = document.createElement("div"); log.className = "py-terminal-log"; log.setAttribute("role", "log"); log.setAttribute("aria-live", "polite");
  const intro = document.createElement("div"); intro.className = "py-terminal-intro";
  intro.textContent = "터미널을 준비하고 있습니다…";
  log.appendChild(intro);

  const inputRow = document.createElement("div"); inputRow.className = "py-terminal-input-row";
  const prompt = document.createElement("span"); prompt.className = "py-terminal-prompt"; prompt.textContent = "›";
  const input = document.createElement("textarea"); input.className = "py-terminal-command"; input.rows = 1;
  input.autocomplete = "off"; input.spellcheck = false; input.placeholder = "명령을 입력하고 Enter";
  input.setAttribute("aria-label", "터미널 명령");
  const runButton = document.createElement("button"); runButton.type = "button"; runButton.className = "py-terminal-run"; runButton.textContent = "실행";
  inputRow.append(prompt, input, runButton);
  root.append(head, log, inputRow);

  let activeView = "result";
  let backendReady = null;
  let localBackend = false;
  let busy = false;
  let destroyed = false;
  let activeTask = null;
  let localSessionId = "";
  let localShellOpening = null;
  let browserKernelStarted = false;
  let commandHistory = [];
  let historyIndex = 0;
  let completionState = null;
  let completionPending = false;
  const browserKernelId = "py-terminal-" + Math.random().toString(36).slice(2);

  const rawDocPath = String(
    (options.ownerDoc && (options.ownerDoc.workspacePath || options.ownerDoc.relPath)) ||
    (options.runCtx && (options.runCtx.workspacePath || options.runCtx.relPath)) || ""
  );
  const configuredCwd = String((options.runCtx && options.runCtx.cwd) || "");
  const pathDir = (value) => {
    const normalized = String(value || "").replace(/\//g, "\\");
    const at = normalized.lastIndexOf("\\");
    return at > 0 ? normalized.slice(0, at) : "";
  };
  const absoluteDocPath = /^[A-Za-z]:[\\/]/.test(rawDocPath) || /^\\\\/.test(rawDocPath);
  let initialCwd = absoluteDocPath ? pathDir(rawDocPath) : (configuredCwd || pathDir(rawDocPath));
  let currentCwd = initialCwd;

  const setTabState = (view) => {
    const isTerminal = view === "terminal";
    toggleButton.classList.toggle("active", isTerminal);
    toggleButton.setAttribute("aria-pressed", isTerminal ? "true" : "false");
    toggleButton.title = isTerminal ? "결과 화면으로 돌아가기" : "명령 터미널 열기";
  };
  const movePanelChildren = (target) => {
    while (outPanel.firstChild) target.appendChild(outPanel.firstChild);
  };
  const refreshOutputChrome = () => {
    if (typeof options.attachOutputChrome === "function") options.attachOutputChrome();
  };
  const showResults = () => {
    if (activeView === "result") return;
    movePanelChildren(terminalStore);
    outPanel.appendChild(resultStore);
    activeView = "result"; setTabState("result"); refreshOutputChrome();
  };
  const showTerminal = () => {
    if (activeView !== "terminal"){
      movePanelChildren(resultStore);
      outPanel.appendChild(terminalStore.firstChild || root);
      activeView = "terminal"; setTabState("terminal"); refreshOutputChrome();
    }
    if (typeof options.onShowOutput === "function") options.onShowOutput();
    ensureBackend().then((isLocal) => {
      if (isLocal) ensureLocalShell().catch(() => {});
      if (!destroyed && activeView === "terminal") setTimeout(() => input.focus(), 0);
    }).catch(() => {});
  };

  const scrollLog = () => {
    if (activeView === "terminal") outPanel.scrollTop = outPanel.scrollHeight;
  };
  const trimLog = () => {
    while (log.childNodes.length > 400) log.removeChild(log.firstChild);
  };
  const appendLog = (text, className) => {
    const el = document.createElement("div");
    el.className = className || "py-terminal-output";
    el.textContent = String(text == null ? "" : text);
    log.appendChild(el); trimLog(); scrollLog();
    return el;
  };
  const setBusy = (value) => {
    busy = !!value;
    input.disabled = busy; runButton.disabled = busy; resetButton.disabled = busy;
    stopButton.disabled = !busy;
    if (!busy && activeView === "terminal") setTimeout(() => input.focus(), 0);
  };
  const setPrompt = () => {
    if (localBackend){
      prompt.textContent = currentCwd ? (currentCwd + " ›") : "PS ›";
      prompt.title = currentCwd || "PowerShell";
      input.placeholder = "PowerShell 명령을 입력하고 Enter";
    } else {
      prompt.textContent = ">>>";
      prompt.title = "브라우저 Python 콘솔";
      input.placeholder = "Python 문장 또는 식을 입력하고 Enter · Shift+Enter 줄바꿈";
    }
  };
  const ensureBackend = () => {
    if (backendReady) return backendReady;
    backendReady = Promise.resolve(typeof pythonBackendAvailable === "function" ? pythonBackendAvailable() : false).then(async (available) => {
      localBackend = !!available;
      if (localBackend && initialCwd && typeof displayPathForWorkspace === "function"){
        try {
          const resolved = await displayPathForWorkspace(initialCwd);
          if (resolved){ initialCwd = resolved; currentCwd = resolved; }
        } catch(_){}
      }
      mode.textContent = localBackend ? "로컬 PowerShell" : "브라우저 Python · Pyodide";
      intro.textContent = localBackend
        ? "이 PC의 지속형 PowerShell에서 명령을 실행합니다. 현재 폴더와 변수는 다음 명령에도 유지됩니다."
        : "브라우저 안에서 Python을 실행합니다. 운영체제 명령과 subprocess는 사용할 수 없습니다.";
      resetButton.title = localBackend ? "PowerShell 변수와 작업 폴더 초기화" : "브라우저 Python 변수와 상태 초기화";
      setPrompt();
      return localBackend;
    }).catch(() => {
      localBackend = false;
      mode.textContent = "브라우저 Python · Pyodide";
      intro.textContent = "브라우저 안에서 Python을 실행합니다. 운영체제 명령과 subprocess는 사용할 수 없습니다.";
      setPrompt();
      return false;
    });
    return backendReady;
  };

  const encodeStrings = (values) => {
    const encoder = new TextEncoder();
    const chunks = [];
    let total = 0;
    values.forEach((value) => {
      const bytes = encoder.encode(String(value == null ? "" : value));
      const size = new Uint8Array(4);
      new DataView(size.buffer).setUint32(0, bytes.length, true);
      chunks.push(size, bytes); total += size.length + bytes.length;
    });
    const body = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => { body.set(chunk, offset); offset += chunk.length; });
    return body;
  };

  const ensureLocalShell = async () => {
    if (localSessionId) return localSessionId;
    if (localShellOpening) return localShellOpening;
    localShellOpening = fetch("/terminal-session-open", {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream" },
      body:encodeStrings([currentCwd])
    }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
      const data = await response.json();
      const id = String(data.id || "");
      if (!id) throw new Error("PowerShell 세션을 시작하지 못했습니다.");
      if (destroyed){
        fetch("/terminal-session-stop?id=" + encodeURIComponent(id), { method:"POST", keepalive:true }).catch(() => {});
        throw new Error("터미널이 닫혔습니다.");
      }
      localSessionId = id;
      if (data.cwd) currentCwd = String(data.cwd);
      if (data.cwdFallback){
        appendLog(
          "표시된 작업 폴더가 PC에 없어 가장 가까운 실제 폴더 " + (data.cwd || "") + "에서 시작했습니다.",
          "py-terminal-status"
        );
      }
      mode.textContent = "로컬 PowerShell · 준비됨";
      setPrompt();
      return id;
    }).finally(() => { localShellOpening = null; });
    return localShellOpening;
  };

  const closeLocalShell = async () => {
    const id = localSessionId;
    localSessionId = "";
    if (!id) return;
    try {
      await fetch("/terminal-session-stop?id=" + encodeURIComponent(id), { method:"POST" });
    } catch(_){}
  };

  const completionContext = () => {
    const value = input.value;
    const cursor = input.selectionStart == null ? value.length : input.selectionStart;
    const beforeCursor = value.slice(0, cursor);
    let tokenStart = 0;
    let quote = "";
    for (let index = 0; index < beforeCursor.length; index++){
      const ch = beforeCursor[index];
      if (quote){
        if (ch === quote && beforeCursor[index - 1] !== "`") quote = "";
      } else if (ch === "'" || ch === "\""){
        quote = ch;
      } else if (/\s/.test(ch)){
        tokenStart = index + 1;
      }
    }
    let raw = beforeCursor.slice(tokenStart);
    let leadingQuote = "";
    if (raw[0] === "'" || raw[0] === "\""){
      leadingQuote = raw[0];
      raw = raw.slice(1);
    }
    const command = value.trimStart().match(/^([^\s]+)/);
    const commandName = command ? command[1].toLowerCase() : "";
    let after = value.slice(cursor);
    if (leadingQuote && after[0] === leadingQuote) after = after.slice(1);
    return {
      cursor,
      before:value.slice(0, tokenStart),
      after,
      fragment:raw,
      quote:leadingQuote,
      directoriesOnly:commandName === "cd" || commandName === "sl" || commandName === "set-location"
    };
  };
  const quoteCompletion = (value, quote) => {
    value = String(value || "");
    if (quote === "\"") return "\"" + value.replace(/"/g, "`\"") + "\"";
    if (quote === "'") return "'" + value.replace(/'/g, "''") + "'";
    if (/\s/.test(value)) return "'" + value.replace(/'/g, "''") + "'";
    return value;
  };
  const applyCompletion = (state, index) => {
    const item = state.items[index];
    if (!item) return;
    const replacement = quoteCompletion(item.value, state.context.quote);
    input.value = state.context.before + replacement + state.context.after;
    const wrapped = !!state.context.quote || /\s/.test(String(item.value || ""));
    const caret = state.context.before.length + replacement.length - (item.directory && wrapped ? 1 : 0);
    input.setSelectionRange(caret, caret);
    state.index = index;
    state.renderedValue = input.value;
    state.renderedCaret = caret;
    mode.textContent = "경로 후보 " + (index + 1) + "/" + state.items.length + " · 로컬 PowerShell";
  };
  const insertBrowserIndent = () => {
    const start = input.selectionStart == null ? input.value.length : input.selectionStart;
    const end = input.selectionEnd == null ? start : input.selectionEnd;
    input.value = input.value.slice(0, start) + "    " + input.value.slice(end);
    input.setSelectionRange(start + 4, start + 4);
  };
  const completeTerminalInput = async (backward) => {
    if (busy || completionPending) return;
    completionPending = true;
    try {
      await ensureBackend();
      if (!localBackend){
        completionState = null;
        insertBrowserIndent();
        return;
      }
      if (completionState && completionState.renderedValue === input.value &&
          completionState.renderedCaret === input.selectionStart){
        const count = completionState.items.length;
        const next = (completionState.index + (backward ? -1 : 1) + count) % count;
        applyCompletion(completionState, next);
        return;
      }
      const context = completionContext();
      if (!context.fragment && !context.directoriesOnly) return;
      const response = await fetch("/terminal-complete", {
        method:"POST",
        headers:{ "Content-Type":"application/octet-stream" },
        body:encodeStrings([currentCwd, context.fragment, context.directoriesOnly ? "1" : "0"])
      });
      if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items.filter((item) => item && typeof item.value === "string") : [];
      if (!items.length){
        completionState = null;
        mode.textContent = "일치하는 경로 없음 · 로컬 PowerShell";
        return;
      }
      completionState = { context, items, index:-1, renderedValue:"", renderedCaret:-1 };
      applyCompletion(completionState, backward ? items.length - 1 : 0);
    } catch(error){
      completionState = null;
      mode.textContent = "경로 자동완성 오류 · 로컬 PowerShell";
    } finally {
      completionPending = false;
    }
  };

  const runLocalCommand = async (command, stdoutEl, stderrEl) => {
    if (!createPythonTerminal.localConfirmed){
      const confirmed = await confirmDialog(
        "터미널 명령은 내 컴퓨터에서 직접 실행됩니다. 신뢰할 수 있는 명령만 실행하세요.",
        "터미널 사용", "취소"
      );
      if (!confirmed) throw new Error("터미널 실행을 취소했습니다.");
      createPythonTerminal.localConfirmed = true;
    }
    const sessionId = await ensureLocalShell();
    const response = await fetch("/terminal-session-run?id=" + encodeURIComponent(sessionId), {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream" },
      body:encodeStrings([command])
    });
    if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
    for (;;){
      const poll = await fetch("/terminal-session-poll?id=" + encodeURIComponent(sessionId), { cache:"no-store" });
      if (!poll.ok) throw new Error(await poll.text() || ("HTTP " + poll.status));
      const data = await poll.json();
      stdoutEl.textContent = data.stdout || "";
      stderrEl.textContent = data.stderr || "";
      stderrEl.hidden = !stderrEl.textContent;
      scrollLog();
      if (data.complete){
        if (data.cwd) currentCwd = String(data.cwd);
        if (data.alive === false && localSessionId === sessionId) localSessionId = "";
        setPrompt();
        mode.textContent = data.alive === false ? "로컬 PowerShell · 다시 시작 대기" : "로컬 PowerShell · 준비됨";
        if (Number(data.code) !== 0 && !data.stopped) appendLog("종료 코드 " + data.code, "py-terminal-status error");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
  };

  const browserConsoleSource = (command) =>
    "__mn_console_source = " + JSON.stringify(command) + "\n" +
    "try:\n" +
    "    __mn_console_code = compile(__mn_console_source, '<console>', 'eval')\n" +
    "except SyntaxError:\n" +
    "    exec(compile(__mn_console_source, '<console>', 'exec'), globals(), globals())\n" +
    "else:\n" +
    "    __mn_console_value = eval(__mn_console_code, globals(), globals())\n" +
    "    if __mn_console_value is not None:\n" +
    "        print(repr(__mn_console_value))";

  const runBrowserCommand = async (command, stdoutEl, stderrEl) => {
    let packages = { urls:[], names:[] };
    if (typeof preparePyodideWorkerPackages === "function"){
      packages = await preparePyodideWorkerPackages(command, (message) => {
        mode.textContent = message || "브라우저 Python · Pyodide";
      });
    }
    mode.textContent = "브라우저 Python · Pyodide";
    activeTask = startPyodideKernelRun({
      kernelId:browserKernelId,
      source:browserConsoleSource(command),
      stdin:"",
      packages
    });
    browserKernelStarted = true;
    const result = await activeTask.promise;
    stdoutEl.textContent = (result && result.stdout) || "";
    stderrEl.textContent = (result && result.stderr) || "";
    stderrEl.hidden = !stderrEl.textContent;
    scrollLog();
    if (result && result.ok === false && !stderrEl.textContent) stderrEl.textContent = "Python 명령 실행 중 오류가 발생했습니다.";
    activeTask = null;
  };

  const execute = async () => {
    if (busy || destroyed) return;
    const command = input.value.trim();
    if (!command) return;
    input.value = ""; completionState = null;
    if (command === "clear" || command === "cls"){
      log.replaceChildren();
      return;
    }
    commandHistory.push(command);
    if (commandHistory.length > 100) commandHistory.shift();
    historyIndex = commandHistory.length;
    await ensureBackend();
    const shownPrompt = localBackend ? (currentCwd || "PS") + " › " : ">>> ";
    appendLog(shownPrompt + command, "py-terminal-command-line");
    const stdoutEl = appendLog("", "py-terminal-output");
    const stderrEl = appendLog("", "py-terminal-error"); stderrEl.hidden = true;
    setBusy(true);
    try {
      if (localBackend) await runLocalCommand(command, stdoutEl, stderrEl);
      else await runBrowserCommand(command, stdoutEl, stderrEl);
    } catch(error){
      const cancelled = error && (error.code === "worker-cancel" || /중지|취소/.test(error.message || ""));
      stderrEl.hidden = false;
      stderrEl.textContent = cancelled ? "명령 실행을 중지했습니다." : ((error && error.message) ? error.message : String(error));
    } finally {
      activeTask = null; setBusy(false); scrollLog();
    }
  };

  const stop = async () => {
    if (!busy) return;
    stopButton.disabled = true;
    if (localSessionId){
      await closeLocalShell();
    } else if (activeTask && typeof activeTask.cancel === "function"){
      activeTask.cancel();
    }
  };
  const reset = async () => {
    if (busy) return;
    await ensureBackend();
    if (localBackend){
      setBusy(true);
      try {
        await closeLocalShell();
        currentCwd = initialCwd;
        await ensureLocalShell();
        appendLog("PowerShell 변수와 작업 폴더를 초기화했습니다.", "py-terminal-status");
      } catch(error){
        appendLog((error && error.message) ? error.message : String(error), "py-terminal-error");
      } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      const task = startPyodideKernelRun({ kernelId:browserKernelId, reset:true });
      await task.promise;
      browserKernelStarted = false;
      appendLog("브라우저 Python 변수와 상태를 초기화했습니다.", "py-terminal-status");
    } catch(error){
      appendLog((error && error.message) ? error.message : String(error), "py-terminal-error");
    } finally { setBusy(false); }
  };

  const interruptWithKeyboard = (event) => {
    if (!busy || activeView !== "terminal" || event.isComposing || event.repeat) return;
    if (!event.ctrlKey || event.altKey || event.metaKey || String(event.key).toLowerCase() !== "c") return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && !root.contains(focused)) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  };

  toggleButton.addEventListener("click", () => {
    if (activeView === "terminal") showResults();
    else showTerminal();
  });
  runButton.addEventListener("click", execute);
  clearButton.addEventListener("click", () => log.replaceChildren());
  resetButton.addEventListener("click", reset);
  stopButton.addEventListener("click", stop);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Tab"){
      event.preventDefault();
      completeTerminalInput(event.shiftKey);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey){
      event.preventDefault(); execute(); return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !input.value.includes("\n")){
      event.preventDefault();
      if (event.key === "ArrowUp") historyIndex = Math.max(0, historyIndex - 1);
      else historyIndex = Math.min(commandHistory.length, historyIndex + 1);
      input.value = historyIndex < commandHistory.length ? commandHistory[historyIndex] : "";
      input.setSelectionRange(input.value.length, input.value.length);
      completionState = null;
    }
  });
  input.addEventListener("input", () => {
    completionState = null;
    if (localBackend) mode.textContent = localSessionId ? "로컬 PowerShell · 준비됨" : "로컬 PowerShell";
  });
  document.addEventListener("keydown", interruptWithKeyboard, true);

  return {
    showResults,
    showTerminal,
    destroy:() => {
      destroyed = true;
      document.removeEventListener("keydown", interruptWithKeyboard, true);
      if (localSessionId){
        const id = localSessionId;
        localSessionId = "";
        fetch("/terminal-session-stop?id=" + encodeURIComponent(id), { method:"POST", keepalive:true }).catch(() => {});
      }
      if (activeTask && typeof activeTask.cancel === "function") activeTask.cancel();
      if (!localBackend && browserKernelStarted && typeof startPyodideKernelRun === "function"){
        startPyodideKernelRun({ kernelId:browserKernelId, reset:true }).promise.catch(() => {});
      }
    }
  };
}

createPythonTerminal.localConfirmed = false;
