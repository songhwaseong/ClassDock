"use strict";

// Python 편집기의 실행 결과와 분리된 모달 터미널을 제공한다.
// 터미널은 앱 전체에서 하나만 두고 열려 있는 py 문서들이 함께 쓴다. 세션·변수·명령 기록이
// 파일을 옮겨도 이어지고, 다른 파일에서 열면 그 파일 폴더로 작업 폴더만 자동으로 옮긴다.
// EXE에서는 PowerShell 명령을 로컬 런처가 실행하고, 일반 브라우저에서는
// 같은 UI를 상태가 유지되는 Pyodide Python 콘솔로 사용한다.
function createPythonTerminal(options){
  options = options || {};
  // 예전 terminalButton 옵션과의 호환을 유지한다.
  const toggleButton = options.toggleButton || options.terminalButton;
  if (!toggleButton) return {
    showResults:() => {},
    showTerminal:() => {},
    close:() => {},
    destroy:() => {}
  };
  return sharedPythonTerminal().attach(toggleButton, options);
}

createPythonTerminal.localConfirmed = false;
createPythonTerminal.shared = null;

// 모달·세션·로그·명령 기록은 여기서 한 번만 만들고, 문서마다 터미널 버튼만 등록(attach)한다.
function sharedPythonTerminal(){
  if (createPythonTerminal.shared) return createPythonTerminal.shared;

  const root = document.createElement("section"); root.className = "py-terminal";
  const head = document.createElement("div"); head.className = "out-head py-terminal-head";
  const title = document.createElement("span"); title.className = "py-terminal-title"; title.id = "py-terminal-title-" + Math.random().toString(36).slice(2); title.textContent = "터미널";
  const mode = document.createElement("span"); mode.className = "py-terminal-mode"; mode.textContent = "환경 확인 중…";
  const headButtons = document.createElement("span"); headButtons.className = "py-terminal-head-buttons";
  const fontDownButton = document.createElement("button"); fontDownButton.type = "button"; fontDownButton.className = "py-terminal-tool py-terminal-font"; fontDownButton.textContent = "A−";
  fontDownButton.title = "터미널 글자 작게"; fontDownButton.setAttribute("aria-label", fontDownButton.title);
  const fontUpButton = document.createElement("button"); fontUpButton.type = "button"; fontUpButton.className = "py-terminal-tool py-terminal-font"; fontUpButton.textContent = "A+";
  fontUpButton.title = "터미널 글자 크게"; fontUpButton.setAttribute("aria-label", fontUpButton.title);
  const clearButton = document.createElement("button"); clearButton.type = "button"; clearButton.className = "py-terminal-tool"; clearButton.textContent = "지우기";
  const resetButton = document.createElement("button"); resetButton.type = "button"; resetButton.className = "py-terminal-tool"; resetButton.textContent = "초기화";
  const stopButton = document.createElement("button"); stopButton.type = "button"; stopButton.className = "terminal-stop"; stopButton.textContent = "중지"; stopButton.disabled = true;
  stopButton.title = "실행 중인 명령 종료 (Ctrl+C)";
  const closeButton = document.createElement("button"); closeButton.type = "button"; closeButton.className = "py-terminal-tool py-terminal-close"; closeButton.textContent = "닫기";
  closeButton.title = "터미널 닫기 (Esc)";
  headButtons.append(fontDownButton, fontUpButton, clearButton, resetButton, stopButton, closeButton);
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

  const modal = document.createElement("div"); modal.className = "modal py-terminal-modal"; modal.hidden = true;
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-labelledby", title.id);
  const card = document.createElement("div"); card.className = "modal-card py-terminal-card"; card.tabIndex = -1;
  card.appendChild(root); modal.appendChild(card); document.body.appendChild(modal);

  let isOpen = false;
  let opener = null;
  const terminalFontStorageKey = "pyTerminalFontSize";
  let terminalFontSize = 13;
  try {
    const savedFontSize = Number(localStorage.getItem(terminalFontStorageKey));
    if (Number.isFinite(savedFontSize)) terminalFontSize = Math.max(11, Math.min(30, Math.round(savedFontSize)));
  } catch(_){}
  const applyTerminalFont = () => {
    root.style.setProperty("--terminal-fs", terminalFontSize + "px");
    root.style.setProperty("--terminal-lh", Math.round(terminalFontSize * 1.6) + "px");
  };
  const bumpTerminalFont = (delta) => {
    terminalFontSize = Math.max(11, Math.min(30, terminalFontSize + delta));
    applyTerminalFont();
    try { localStorage.setItem(terminalFontStorageKey, String(terminalFontSize)); } catch(_){}
  };
  applyTerminalFont();
  let backendReady = null;
  let localBackend = false;
  let busy = false;
  let activeTask = null;
  let localSessionId = "";
  let localShellOpening = null;
  // 세션을 열 때 실제로 요청한 폴더(여는 도중 다른 파일에서 눌렀는지 판별용)와
  // 그 폴더가 PC에 없어 런처가 상위 폴더로 대체했는지 여부.
  let sessionRequestedCwd = "";
  let sessionCwdFallback = false;
  let browserKernelStarted = false;
  let commandHistory = [];
  let historyIndex = 0;
  let completionState = null;
  let completionPending = false;
  // 모든 문서가 같은 커널을 쓰므로 브라우저 모드에서도 변수가 파일 사이에서 유지된다.
  const browserKernelId = "py-terminal-shared";
  // 응답마다 연결을 닫는 로컬 HTTP 서버이므로 너무 짧은 폴링은 TIME_WAIT 연결을 급격히 늘린다.
  const terminalPollIntervalMs = 500;
  const terminalPollRetryLimit = 3;

  // 등록된 터미널 버튼(문서 하나당 하나)과 현재 터미널이 바라보는 문서.
  const entries = new Map();
  let activeEntry = null;
  // 세션을 새로 열다가 마지막 문서가 닫히는 경합을 세대 번호로 걸러낸다.
  let generation = 0;
  let shutdownTimer = 0;
  // 새로고침처럼 문서를 닫고 곧바로 다시 여는 경우가 있어 잠깐 기다렸다 세션을 정리한다.
  const shutdownDelayMs = 3000;

  const pathDir = (value) => {
    const normalized = String(value || "").replace(/\//g, "\\");
    const at = normalized.lastIndexOf("\\");
    return at > 0 ? normalized.slice(0, at) : "";
  };
  const docCwdFor = (options) => {
    const rawDocPath = String(
      (options.ownerDoc && (options.ownerDoc.nativeAbsolutePath || options.ownerDoc.workspacePath || options.ownerDoc.relPath)) ||
      (options.runCtx && (options.runCtx.workspacePath || options.runCtx.relPath)) || ""
    );
    const configuredCwd = String((options.runCtx && options.runCtx.cwd) || "");
    const absoluteDocPath = /^[A-Za-z]:[\\/]/.test(rawDocPath) || /^\\\\/.test(rawDocPath);
    return absoluteDocPath ? pathDir(rawDocPath) : (configuredCwd || pathDir(rawDocPath));
  };
  const sameCwd = (a, b) => {
    const normalize = (value) => String(value || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
    return normalize(a) === normalize(b);
  };
  const powerShellLiteral = (value) => "'" + String(value == null ? "" : value).replace(/'/g, "''") + "'";
  // 작업공간 경로(가상 경로)는 사용자에게 보이는 실제 경로로 바꿔 프롬프트와 cd에 쓴다.
  const resolveDisplayCwd = async (value) => {
    if (!value || !localBackend || typeof displayPathForWorkspace !== "function") return value;
    try {
      const resolved = await displayPathForWorkspace(value);
      return resolved || value;
    } catch(_){ return value; }
  };

  let initialCwd = "";
  let currentCwd = "";

  const applyOpenStateTo = (button) => {
    button.classList.toggle("active", isOpen);
    button.setAttribute("aria-pressed", isOpen ? "true" : "false");
    button.setAttribute("aria-expanded", isOpen ? "true" : "false");
    // 터미널을 닫아도 명령은 계속 돌기 때문에 실행 중 점으로 알려 준다(서버를 띄워 둔 것을 잊지 않게).
    button.classList.toggle("running", busy);
    button.title = isOpen
      ? "터미널이 열려 있습니다"
      : (busy ? "명령이 실행 중입니다 · 눌러서 터미널 열기" : "명령 터미널 열기");
  };
  const setOpenState = () => { entries.forEach((entry) => applyOpenStateTo(entry.button)); };
  const closeTerminal = (restoreFocus=true) => {
    if (!isOpen) return;
    isOpen = false; modal.hidden = true; setOpenState();
    const focusTarget = opener; opener = null;
    if (restoreFocus && focusTarget && focusTarget.isConnected) setTimeout(() => focusTarget.focus(), 0);
  };
  const showResults = () => {
    // 편집기 실행 결과는 뒤의 원래 결과 패널에 표시한다.
    closeTerminal(false);
  };
  const showTerminal = (entry) => {
    const switched = !!entry && activeEntry !== entry;
    if (entry) activeEntry = entry;
    if (!isOpen){
      opener = document.activeElement;
      isOpen = true; modal.hidden = false; setOpenState();
      // 백엔드 확인은 로컬 Python 탐색 등으로 늦어질 수 있다. 입력 포커스를 그 응답 뒤에만
      // 주면 창은 열렸는데 커서가 없고 키 입력도 안 되는 것처럼 보이므로 UI부터 즉시 준비한다.
      setTimeout(() => { if (isOpen) focusTerminal(); }, 0);
    }
    ensureBackend().then(async (isLocal) => {
      if (isLocal){
        const target = await resolveDisplayCwd(activeEntry ? activeEntry.cwd : "");
        if (target) initialCwd = target;
        if (!localSessionId){
          // 세션을 새로 열 때는 그 파일 폴더에서 바로 시작하므로 따로 옮길 필요가 없다.
          if (target) currentCwd = target;
          setPrompt();
          await ensureLocalShell().catch(() => {});
          // 다른 파일이 세션을 여는 중에 눌렀다면 그 세션은 다른 폴더에서 시작했으므로 옮겨 준다.
          // 요청한 폴더가 PC에 없어 대체된 경우에는 다시 그 폴더로 옮기려 들지 않는다.
          if (target && localSessionId && !sessionCwdFallback && !sameCwd(target, sessionRequestedCwd)){
            await moveToDocFolder(target);
          }
        } else if (switched){
          await moveToDocFolder(target);
        }
      }
      if (isOpen) setTimeout(() => focusTerminal(), 0);
    }).catch(() => {});
  };
  // 명령이 도는 동안에는 입력칸이 disabled 라 포커스를 못 받는다 → 카드로 보내 터미널 안에 머물게 한다.
  const focusTerminal = () => { if (input.disabled) card.focus(); else input.focus(); };

  const scrollLog = () => {
    if (isOpen) log.scrollTop = log.scrollHeight;
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
    setOpenState();                                  // 열린 문서들의 터미널 버튼에 실행 중 점을 켜고 끈다
    if (!busy && isOpen) setTimeout(() => input.focus(), 0);
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
    // PowerShell 터미널은 Python 설치 여부가 아니라 C# 로컬 서버가 있는지로 결정한다.
    // Python 실행 백엔드 확인을 쓰면 Python이 없거나 탐색이 지연될 때 EXE 터미널까지 멈춘다.
    backendReady = Promise.resolve(typeof saveFileBackendAvailable === "function" ? saveFileBackendAvailable() : false).then((available) => {
      localBackend = !!available;
      mode.textContent = localBackend ? "로컬 PowerShell" : "브라우저 Python · Pyodide";
      intro.textContent = localBackend
        ? "이 PC의 지속형 PowerShell에서 명령을 실행합니다. 현재 폴더와 변수는 다음 명령에도 유지됩니다. 열려 있는 파이썬 파일들이 이 터미널을 함께 씁니다."
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
    const openedFor = generation;
    const requestedCwd = currentCwd;
    localShellOpening = fetch("/terminal-session-open", {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream" },
      body:encodeStrings([currentCwd])
    }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
      const data = await response.json();
      const id = String(data.id || "");
      if (!id) throw new Error("PowerShell 세션을 시작하지 못했습니다.");
      if (openedFor !== generation){
        fetch("/terminal-session-stop?id=" + encodeURIComponent(id), { method:"POST", keepalive:true }).catch(() => {});
        throw new Error("터미널이 닫혔습니다.");
      }
      localSessionId = id;
      sessionRequestedCwd = requestedCwd;
      sessionCwdFallback = !!data.cwdFallback;
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
  const commonCompletionPrefix = (items) => {
    if (!items.length) return "";
    let prefix = String(items[0].value || "");
    for (let itemIndex = 1; itemIndex < items.length && prefix; itemIndex++){
      const value = String(items[itemIndex].value || "");
      let length = 0;
      const limit = Math.min(prefix.length, value.length);
      while (length < limit && prefix[length].toLowerCase() === value[length].toLowerCase()) length++;
      prefix = prefix.slice(0, length);
    }
    return prefix;
  };
  const applyCompletionValue = (state, value, keepCaretInsideQuote) => {
    const replacement = quoteCompletion(value, state.context.quote);
    input.value = state.context.before + replacement + state.context.after;
    const wrapped = !!state.context.quote || /\s/.test(String(value || ""));
    const caret = state.context.before.length + replacement.length - (keepCaretInsideQuote && wrapped ? 1 : 0);
    input.setSelectionRange(caret, caret);
    state.renderedValue = input.value;
    state.renderedCaret = caret;
  };
  const applyCompletion = (state, index) => {
    const item = state.items[index];
    if (!item) return;
    applyCompletionValue(state, item.value, item.directory);
    state.index = index;
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
      const sharedPrefix = commonCompletionPrefix(items);
      if (!backward && sharedPrefix.length > context.fragment.length){
        applyCompletionValue(completionState, sharedPrefix, true);
        mode.textContent = "경로 자동완성 · 공통 이름까지 · 로컬 PowerShell";
      } else {
        applyCompletion(completionState, backward ? items.length - 1 : 0);
      }
    } catch(error){
      completionState = null;
      mode.textContent = "경로 자동완성 오류 · 로컬 PowerShell";
    } finally {
      completionPending = false;
    }
  };

  const confirmLocalUse = async () => {
    if (createPythonTerminal.localConfirmed) return;
    const confirmed = await confirmDialog(
      "터미널 명령은 내 컴퓨터에서 직접 실행됩니다. 신뢰할 수 있는 명령만 실행하세요.",
      "터미널 사용", "취소"
    );
    if (!confirmed) throw new Error("터미널 실행을 취소했습니다.");
    createPythonTerminal.localConfirmed = true;
  };

  // 사용자가 친 명령과 앱이 자동으로 넣는 작업 폴더 이동이 같은 세션·같은 폴링을 쓴다.
  const sendLocalCommand = async (command, stdoutEl, stderrEl) => {
    const sessionId = await ensureLocalShell();
    const response = await fetch("/terminal-session-run?id=" + encodeURIComponent(sessionId), {
      method:"POST",
      headers:{ "Content-Type":"application/octet-stream" },
      body:encodeStrings([command])
    });
    if (!response.ok) throw new Error(await response.text() || ("HTTP " + response.status));
    let pollFailures = 0;
    for (;;){
      let data;
      try {
        const poll = await fetch("/terminal-session-poll?id=" + encodeURIComponent(sessionId), { cache:"no-store" });
        if (!poll.ok) throw new Error(await poll.text() || ("HTTP " + poll.status));
        data = await poll.json();
        pollFailures = 0;
      } catch(error) {
        pollFailures++;
        if (pollFailures > terminalPollRetryLimit){
          throw new Error(
            "터미널 상태를 확인하지 못했습니다. 서버 또는 명령이 계속 실행 중일 수 있습니다. " +
            "잠시 후 터미널을 다시 열어 확인하세요. (" + ((error && error.message) ? error.message : String(error)) + ")"
          );
        }
        mode.textContent = "로컬 PowerShell · 상태 확인 재시도 (" + pollFailures + "/" + terminalPollRetryLimit + ")";
        await new Promise((resolve) => setTimeout(resolve, terminalPollIntervalMs * pollFailures));
        continue;
      }
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
      await new Promise((resolve) => setTimeout(resolve, terminalPollIntervalMs));
    }
  };

  const runLocalCommand = async (command, stdoutEl, stderrEl) => {
    await confirmLocalUse();
    await sendLocalCommand(command, stdoutEl, stderrEl);
  };

  // 다른 파이썬 파일에서 터미널을 열면 변수는 그대로 두고 작업 폴더만 그 파일 폴더로 옮긴다.
  // 같은 파일에서 다시 열 때는 사용자가 직접 옮긴 폴더를 되돌리지 않는다.
  const moveToDocFolder = async (target) => {
    if (!target || !localBackend || !localSessionId) return;
    if (sameCwd(target, currentCwd)) return;
    if (busy){
      appendLog("명령이 실행 중이라 작업 폴더를 " + target + " 로 옮기지 않았습니다.", "py-terminal-status");
      return;
    }
    setBusy(true);
    const stdoutEl = appendLog("", "py-terminal-output");
    const stderrEl = appendLog("", "py-terminal-error"); stderrEl.hidden = true;
    try {
      await sendLocalCommand("Set-Location -LiteralPath " + powerShellLiteral(target), stdoutEl, stderrEl);
      if (stderrEl.textContent){
        // 폴더가 지워졌거나 실제 경로가 아닌 경우 — PowerShell 원문 대신 무엇이 어긋났는지 알려 준다.
        stderrEl.textContent = "작업 폴더를 " + target + " 로 옮기지 못했습니다. 지금 폴더는 " + currentCwd + " 입니다.";
      } else {
        stdoutEl.className = "py-terminal-status";
        stdoutEl.textContent = "작업 폴더를 " + currentCwd + " 로 옮겼습니다.";
      }
    } catch(error){
      stderrEl.hidden = false;
      stderrEl.textContent = (error && error.message) ? error.message : String(error);
    } finally {
      setBusy(false); scrollLog();
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
    if (busy) return;
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
    if (!busy || !isOpen || event.isComposing || event.repeat) return;
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    // 한글 입력 상태에서는 Ctrl+C 의 event.key 가 "ㅊ" 으로 와서 key 만 보면 중지가 걸리지 않는다.
    const key = String(event.key || "").toLowerCase(), code = String(event.code || "");
    if (key !== "c" && code !== "KeyC") return;
    // 열려 있는 터미널은 화면 전체를 덮는 모달이라 포커스 위치를 따지지 않고 중지로 받는다.
    // 예전에는 포커스를 따지다가 출력 로그를 클릭했을 때(포커스가 카드로 감), 닫았다 다시 열었을 때
    // (포커스가 모달 밖 터미널 버튼에 남음) Ctrl+C 가 통째로 무시돼 중지 버튼밖에 못 썼다.
    event.preventDefault();
    event.stopPropagation();
    stop();
  };

  runButton.addEventListener("click", execute);
  fontDownButton.addEventListener("click", () => bumpTerminalFont(-1));
  fontUpButton.addEventListener("click", () => bumpTerminalFont(1));
  clearButton.addEventListener("click", () => log.replaceChildren());
  resetButton.addEventListener("click", reset);
  stopButton.addEventListener("click", stop);
  closeButton.addEventListener("click", () => closeTerminal());
  modal.addEventListener("mousedown", (event) => { if (event.target === modal) closeTerminal(); });
  const closeWithEscape = (event) => {
    if (!isOpen || event.key !== "Escape") return;
    event.preventDefault(); event.stopImmediatePropagation(); closeTerminal();
  };
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
  // 문서 전역 단축키는 파이썬 문서가 하나라도 열려 있는 동안에만 걸어 둔다.
  let documentKeysBound = false;
  const bindDocumentKeys = () => {
    if (documentKeysBound) return;
    documentKeysBound = true;
    document.addEventListener("keydown", interruptWithKeyboard, true);
    document.addEventListener("keydown", closeWithEscape, true);
  };
  const unbindDocumentKeys = () => {
    if (!documentKeysBound) return;
    documentKeysBound = false;
    document.removeEventListener("keydown", interruptWithKeyboard, true);
    document.removeEventListener("keydown", closeWithEscape, true);
  };

  // 파이썬 문서가 하나도 남지 않으면 셸까지 정리한다(앱 종료 시에는 런처가 남은 세션을 정리한다).
  const shutdown = () => {
    generation++;
    closeTerminal(false);
    activeEntry = null;
    if (localSessionId){
      const id = localSessionId;
      localSessionId = "";
      fetch("/terminal-session-stop?id=" + encodeURIComponent(id), { method:"POST", keepalive:true }).catch(() => {});
    }
    if (activeTask && typeof activeTask.cancel === "function") activeTask.cancel();
    activeTask = null;
    if (!localBackend && browserKernelStarted && typeof startPyodideKernelRun === "function"){
      startPyodideKernelRun({ kernelId:browserKernelId, reset:true }).promise.catch(() => {});
    }
    browserKernelStarted = false;
    setBusy(false);
    completionState = null;
    sessionRequestedCwd = ""; sessionCwdFallback = false;
    initialCwd = ""; currentCwd = "";
    log.replaceChildren(intro);
    unbindDocumentKeys();
  };
  const cancelShutdown = () => { if (shutdownTimer){ clearTimeout(shutdownTimer); shutdownTimer = 0; } };
  const scheduleShutdown = () => {
    cancelShutdown();
    shutdownTimer = setTimeout(() => {
      shutdownTimer = 0;
      if (!entries.size) shutdown();
    }, shutdownDelayMs);
  };

  const detach = (entry) => {
    if (!entries.has(entry.button)) return;
    entry.button.removeEventListener("click", entry.onClick);
    entries.delete(entry.button);
    if (activeEntry === entry) activeEntry = null;
    if (!entries.size) scheduleShutdown();
  };
  const attach = (button, options) => {
    cancelShutdown();
    bindDocumentKeys();
    const existing = entries.get(button);
    if (existing){
      existing.cwd = docCwdFor(options);
      return existing.handle;
    }
    const entry = { button, cwd:docCwdFor(options), onClick:null, handle:null };
    entry.onClick = () => {
      // 이미 열려 있는 터미널을 다른 파일에서 누르면 닫지 않고 그 파일 폴더로 옮긴다.
      if (isOpen && activeEntry !== entry) showTerminal(entry);
      else if (isOpen) closeTerminal();
      else showTerminal(entry);
    };
    entry.handle = {
      showResults,
      showTerminal:() => showTerminal(entry),
      close:() => closeTerminal(),
      destroy:() => detach(entry)
    };
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", entry.onClick);
    entries.set(button, entry);
    applyOpenStateTo(button);
    return entry.handle;
  };

  createPythonTerminal.shared = { attach };
  return createPythonTerminal.shared;
}
