"use strict";

// EXE 전용 SSH 원격 터미널. Windows OpenSSH + ConPTY의 바이트 스트림을 xterm.js에 연결한다.
// 저장하는 값은 호스트·포트·계정·인증 방식뿐이며 비밀번호·키 암호·개인키 경로는 브라우저 저장소에 넣지 않는다.
const MNRemoteTerminal = (() => {
  const PROFILE_KEY = "classdockSshProfileV1";
  const DOCK_KEY = "classdockSshDockV3";        // 작업공간 id -> 도킹 배치
  const LEGACY_DOCK_KEY = "classdockSshDockV2"; // 작업공간 구분이 없던 단일 배치
  const FONT_KEY = "classdockSshFontV1";
  const FONT_STACKS = {
    cascadia:'"Cascadia Mono","Cascadia Code",Consolas,"NanumGothicCoding",monospace',
    consolas:'Consolas,"Cascadia Mono","NanumGothicCoding",monospace',
    d2coding:'D2Coding,"Cascadia Mono",Consolas,"NanumGothicCoding",monospace',
    nanum:'"NanumGothicCoding","Nanum Gothic Coding","Cascadia Mono",Consolas,monospace',
    system:'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace'
  };
  const encoder = new TextEncoder();
  // 글꼴 설정은 모든 인스턴스가 같은 값을 쓴다. 값만 여기에 두고 화면 반영은 인스턴스가 한다.
  let fontChoice = "cascadia", terminalFontSize = 14, terminalLineHeight = 1.15;

  const encodeStrings = (values) => {
    const chunks = [];
    let size = 0;
    values.forEach((value) => {
      const bytes = encoder.encode(String(value == null ? "" : value));
      const head = new Uint8Array(4);
      new DataView(head.buffer).setUint32(0, bytes.length, true);
      chunks.push(head, bytes); size += head.length + bytes.length;
    });
    const result = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => { result.set(chunk, offset); offset += chunk.length; });
    return result;
  };

  const responseData = async (response) => {
    if (!response.ok) throw new Error((await response.text()) || ("HTTP " + response.status));
    return response.json();
  };

  const fetchTimed = async (url, options={}, timeout=15000) => {
    if (typeof AbortController !== "function") return fetch(url, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try { return await fetch(url, { ...options, signal:controller.signal }); }
    catch(error){
      if (error && error.name === "AbortError") throw new Error("ssh-request-timeout");
      throw error;
    } finally { clearTimeout(timer); }
  };

  const stripTerminalCodes = (value) => String(value || "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

  const classifySshFailure = (output, code=-1, stopped=false) => {
    const text = stripTerminalCodes(output);
    if (stopped) return { status:"연결 끊김", message:"사용자가 SSH 연결을 끊었습니다." };
    if (Number(code) === 0) return { status:"정상 종료", message:"서버 셸이 정상적으로 종료되었습니다." };
    if (/incorrect passphrase|bad passphrase/i.test(text))
      return { status:"키 암호 오류", message:"개인키 암호가 올바르지 않습니다. 키 암호를 확인한 뒤 재접속하세요." };
    if (/UNPROTECTED PRIVATE KEY FILE|permissions .*private key|bad permissions/i.test(text))
      return { status:"개인키 권한 오류", message:"Windows OpenSSH가 개인키 파일 권한을 안전하지 않다고 판단했습니다. 파일 소유자와 접근 권한을 확인하세요." };
    if (/Load key .*invalid format|error in libcrypto/i.test(text))
      return { status:"개인키 오류", message:"Windows OpenSSH가 선택한 개인키 형식을 읽지 못했습니다. OpenSSH 또는 PEM 개인키인지 확인하세요." };
    if (/Permission denied \(publickey/i.test(text))
      return { status:"인증 실패", message:"서버가 선택한 개인키를 허용하지 않았습니다. 계정과 서버의 authorized_keys 등록 상태를 확인하세요." };
    if (/Permission denied|Authentication failed|Too many authentication failures/i.test(text))
      return { status:"인증 실패", message:"계정 또는 비밀번호가 올바르지 않습니다. 계정을 확인하고 비밀번호를 다시 입력하세요." };
    if (/Connection timed out|Operation timed out|connect to host .* timed out/i.test(text))
      return { status:"연결 시간 초과", message:"서버가 제시간에 응답하지 않았습니다. IP·포트와 서버 전원 상태를 확인하세요." };
    if (/Connection refused/i.test(text))
      return { status:"연결 거부", message:"서버가 SSH 연결을 거부했습니다. Ubuntu의 SSH 서비스와 포트 번호를 확인하세요." };
    if (/Could not resolve hostname|Name or service not known|No such host/i.test(text))
      return { status:"호스트 오류", message:"서버 주소를 찾지 못했습니다. IP 주소나 도메인 철자를 확인하세요." };
    if (/No route to host|Network is unreachable/i.test(text))
      return { status:"네트워크 오류", message:"서버까지 연결 경로가 없습니다. 같은 네트워크인지와 가상머신 네트워크 설정을 확인하세요." };
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(text))
      return { status:"지문 확인 실패", message:"서버 지문이 저장된 값과 다릅니다. 서버 재설치 여부를 확인한 뒤 지문을 다시 승인하세요." };
    if (/Connection reset by peer|Broken pipe|Connection closed by|Connection to .* closed/i.test(text))
      return { status:"연결 종료", message:"서버 또는 네트워크가 SSH 연결을 종료했습니다. 상태를 확인한 뒤 재접속하세요." };
    if (/kex_exchange_identification|ssh_exchange_identification/i.test(text))
      return { status:"SSH 협상 실패", message:"서버가 SSH 초기 연결을 종료했습니다. 접속 제한과 SSH 서버 로그를 확인하세요." };
    return { status:"접속 실패", message:"SSH 연결이 종료되었습니다(코드 " + code + "). 터미널의 마지막 오류를 확인한 뒤 재접속하세요." };
  };

  const friendlyError = (error) => {
    const raw = String((error && error.message) || error || "");
    if (/ssh-request-timeout/.test(raw)) return "요청 시간이 초과되었습니다. 서버 주소·포트와 네트워크 상태를 확인하세요.";
    if (/Permission denied|Authentication failed|Connection refused|Connection timed out|Could not resolve hostname|No route to host|Network is unreachable/i.test(raw))
      return classifySshFailure(raw, 255, false).message;
    if (/ssh-keyscan-timeout|ssh-host-key-not-found/.test(raw)) return "서버의 SSH 지문을 확인하지 못했습니다. IP·포트와 서버 상태를 확인하세요.";
    if (/ssh-keyscan-failed/.test(raw)) return "SSH 서버에 연결하지 못했습니다. IP·포트 또는 방화벽 설정을 확인하세요.";
    // 상한은 desktop/ssh_terminal.cs 의 MaxSessions 다. 숫자가 어긋나지 않게 테스트로 묶어 두었다.
    if (/ssh-session-limit/.test(raw)) return "동시에 접속할 수 있는 SSH 세션은 4개까지입니다. 다른 작업공간의 터미널에서 연결을 끊은 뒤 다시 시도하세요.";
    if (/bad-ssh-host/.test(raw)) return "IP 주소 또는 도메인 형식이 올바르지 않습니다.";
    if (/bad-ssh-port/.test(raw)) return "포트는 1~65535 사이의 숫자로 입력하세요.";
    if (/bad-ssh-user/.test(raw)) return "계정 이름을 확인하세요.";
    if (/bad-ssh-authentication/.test(raw)) return "SSH 인증 방식을 다시 선택하세요.";
    if (/ssh-private-key-not-selected/.test(raw)) return "개인키 파일을 다시 선택하세요.";
    if (/ssh-private-key-not-found/.test(raw)) return "선택한 개인키 파일을 찾을 수 없습니다. 파일을 다시 선택하세요.";
    if (/ssh-private-key-size/.test(raw)) return "개인키 파일이 비어 있거나 허용 크기(1MB)를 넘습니다.";
    if (/ssh-private-key-picker-failed/.test(raw)) return "Windows 개인키 선택창을 열지 못했습니다. ClassDock을 다시 실행한 뒤 시도하세요.";
    if (/ssh-private-key-read-failed/.test(raw)) return "개인키 파일을 읽지 못했습니다. 파일 접근 권한을 확인하세요.";
    if (/ssh-private-key-is-public/.test(raw)) return "공개키(.pub)가 아닌 개인키 파일을 선택하세요.";
    if (/ssh-private-key-putty-format/.test(raw)) return "PuTTY .ppk 키는 바로 사용할 수 없습니다. PuTTYgen에서 OpenSSH 개인키로 변환하세요.";
    if (/ssh-private-key-invalid-format/.test(raw)) return "OpenSSH 또는 PEM 형식의 개인키 파일을 선택하세요.";
    if (/ssh-private-key-secure-copy-failed/.test(raw)) return "개인키를 접속용 임시 사본으로 만들지 못했습니다. 디스크 공간과 사용자 폴더 권한을 확인하세요.";
    if (/ssh-upload-picker-failed/.test(raw)) return "Windows 업로드 파일 선택창을 열지 못했습니다. ClassDock을 다시 실행한 뒤 시도하세요.";
    if (/ssh-upload-file-not-selected/.test(raw)) return "업로드할 파일을 다시 선택하세요.";
    if (/ssh-upload-file-count/.test(raw)) return "파일은 한 번에 최대 32개까지 업로드할 수 있습니다.";
    if (/ssh-upload-file-not-found/.test(raw)) return "선택한 업로드 파일을 찾을 수 없습니다. 파일을 다시 선택하세요.";
    if (/ssh-upload-file-read-failed/.test(raw)) return "업로드 파일 정보를 읽지 못했습니다. 파일 접근 권한을 확인하세요.";
    if (/ssh-upload-file-size/.test(raw)) return "선택한 파일의 전체 크기를 처리할 수 없습니다.";
    if (/ssh-upload-file-paths-too-long/.test(raw)) return "선택한 파일 경로가 너무 깁니다. 파일 수를 줄이거나 짧은 폴더로 옮긴 뒤 시도하세요.";
    if (/bad-ssh-upload-path/.test(raw)) return "원격 디렉터리 경로를 확인하세요.";
    if (/ssh-upload-session-closed/.test(raw)) return "SSH 연결이 종료되었습니다. 재접속한 뒤 업로드하세요.";
    if (/ssh-upload-session-limit/.test(raw)) return "동시에 실행할 수 있는 업로드 수를 넘었습니다. 진행 중인 업로드를 마친 뒤 시도하세요.";
    if (/scp-client-not-found/.test(raw)) return "Windows OpenSSH의 scp.exe가 필요합니다. OpenSSH Client를 다시 설치하세요.";
    if (/ssh-upload-not-found/.test(raw)) return "업로드 상태를 찾지 못했습니다. 파일을 다시 선택해 업로드하세요.";
    if (/bad-ssh-key-passphrase/.test(raw)) return "개인키 암호가 너무 길거나 올바르지 않습니다.";
    if (/ssh-host-key-changed/.test(raw)) return "저장된 서버 지문과 새 지문이 다릅니다.";
    if (/ssh-client-not-found|Windows OpenSSH Client/.test(raw)) return "Windows OpenSSH Client가 필요합니다. Windows 선택적 기능에서 OpenSSH 클라이언트를 설치하세요.";
    if (/conpty/.test(raw)) return "이 Windows 환경에서는 대화형 터미널을 시작하지 못했습니다.";
    return raw.replace(/^.*?(?:failed|실패):\s*/i, "") || "원격 터미널을 시작하지 못했습니다.";
  };

  // 도킹 배치는 작업공간마다 따로 기억한다. 세션과 접힘 상태는 저장하지 않는다.
  const readDockStore = () => {
    try {
      const value = JSON.parse(localStorage.getItem(DOCK_KEY) || "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch(_){ return {}; }
  };

  // 작업공간을 나누기 전에 쓰던 단일 배치. 아직 배치가 없는 작업공간의 기본값으로만 쓴다.
  const legacyDockState = () => {
    try {
      const value = JSON.parse(localStorage.getItem(LEGACY_DOCK_KEY) || "null");
      return value && typeof value === "object" ? value : null;
    } catch(_){ return null; }
  };

  const knownWorkspaceIds = () => {
    if (typeof workspaceRegistry === "undefined" || !workspaceRegistry || !Array.isArray(workspaceRegistry.items)) return null;
    return new Set(workspaceRegistry.items.map((row) => String((row && row.id) || "")));
  };

  const writeDockState = (workspaceId, state) => {
    try {
      const store = readDockStore();
      store[workspaceId] = state;
      // 삭제 이벤트를 놓친 작업공간의 배치가 남지 않게 등록된 작업공간만 남긴다.
      const known = knownWorkspaceIds();
      if (known) Object.keys(store).forEach((id) => { if (id !== workspaceId && !known.has(id)) delete store[id]; });
      localStorage.setItem(DOCK_KEY, JSON.stringify(store));
    } catch(_){}
  };

  const forgetDockState = (workspaceId) => {
    try {
      const store = readDockStore();
      if (!Object.prototype.hasOwnProperty.call(store, workspaceId)) return;
      delete store[workspaceId];
      localStorage.setItem(DOCK_KEY, JSON.stringify(store));
    } catch(_){}
  };

  const savedProfile = () => {
    try {
      const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch(_){ return {}; }
  };

  const loadFontState = () => {
    try {
      const value = JSON.parse(localStorage.getItem(FONT_KEY) || "null");
      if (!value || typeof value !== "object") return;
      if (Object.prototype.hasOwnProperty.call(FONT_STACKS, value.family)) fontChoice = value.family;
      const size = Number(value.size), lineHeight = Number(value.lineHeight);
      if (Number.isFinite(size)) terminalFontSize = Math.max(11, Math.min(24, Math.round(size)));
      if (Number.isFinite(lineHeight)) terminalLineHeight = Math.max(1, Math.min(1.5, Math.round(lineHeight * 100) / 100));
    } catch(_){}
  };

  const storeFontState = () => {
    try { localStorage.setItem(FONT_KEY, JSON.stringify({ family:fontChoice, size:terminalFontSize, lineHeight:terminalLineHeight })); } catch(_){}
  };

  const parseOsc7Location = (payload) => {
    const text = String(payload || "");
    if (!/^file:\/\//i.test(text)) return null;
    const rest = text.slice(7), slash = rest.indexOf("/");
    if (slash < 0) return null;
    const host = rest.slice(0, slash).toLowerCase();
    let path;
    try { path = decodeURIComponent(rest.slice(slash)); } catch(_){ return null; }
    if (!path.startsWith("/") || path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path)) return null;
    if (!path.endsWith("/")) path += "/";
    return { host, path };
  };

  // 원격 터미널 하나(도킹 패널 + xterm + SSH 세션)를 만든다.
  // 상태를 모듈이 아닌 이 클로저에 두어 작업공간마다 하나씩 동시에 띄울 수 있다.
  const createInstance = (workspaceId) => {
    let dock = null, divider = null, card = null, rail = null, formView = null, terminalView = null, terminalHost = null;
    let hostInput = null, portInput = null, userInput = null, authMethodInput = null, passwordInput = null, rememberInput = null;
    let credentialLabel = null, keyField = null, keyButton = null, keyNameEl = null;
    let statusEl = null, connectButton = null, terminalTitle = null, terminalStatus = null;
    let disconnectButton = null, retryButton = null, uploadButton = null;
    let remoteFiles = null, filesButton = null, fileCancelButton = null;
    let uploadPanel = null, uploadFileButton = null, uploadFileSummary = null, uploadPathInput = null;
    let uploadPathHint = null;
    let uploadSecretInput = null, uploadSecretLabel = null, uploadStartButton = null, uploadCancelButton = null;
    let uploadCloseButton = null, uploadProgress = null, uploadStatus = null;
    let fontSelect = null, fontSizeOutput = null, lineHeightButton = null;
    let terminal = null, sessionId = "", outputOffset = 0, generation = 0, inputQueue = [];
    let inputTimer = 0, inputSending = false, resizeObserver = null, resizeTimer = 0;
    let layoutFrame = 0;
    let currentCols = 100, currentRows = 30;
    let dockSide = "right", dockWidth = 520, dockCollapsed = false;
    let diagnosticTail = "", diagnosticDecoder = new TextDecoder(), pollFailures = 0, pollStatusBeforeRetry = "";
    // 화면에 없는 동안 폴을 멈춘다. 깨우기 전까지 폴 루프는 resumeWaiters 에 걸려 기다린다.
    let pollPaused = false, resumeWaiters = [];
    // xterm 에 넘겼지만 아직 그려지지 않은 양. 이 값이 임계치를 넘을 때만 폴 루프가 렌더를 기다린다.
    // lastWrite 는 가장 최근 write 의 완료 Promise — xterm 이 FIFO 로 처리하므로 이것만 기다리면 전부 비워진다.
    let pendingWriteBytes = 0, lastWrite = null, writeEpoch = 0;
    const WRITE_BACKPRESSURE_BYTES = 512 * 1024;
    // 이전 xterm 의 write 콜백은 dispose 뒤에도 늦게 실행될 수 있다. 세대를 바꿔
    // 그 콜백이 새 터미널의 pendingWriteBytes 를 차감하지 못하게 한다.
    const resetWriteBackpressure = () => { writeEpoch++; pendingWriteBytes = 0; lastWrite = null; };
    let selectedKeyId = "", selectedKeyName = "", keyPicking = false, keyPickGeneration = 0;
    let uploadAvailable = true, uploadSelectionId = "", uploadFiles = [], uploadTotalBytes = 0;
    let uploadPicking = false, uploadPickGeneration = 0, uploadId = "", uploadOffset = 0, uploadGeneration = 0;
    let uploadPollFailures = 0;
    let currentRemoteDirectory = "", uploadPathIsAutomatic = true;
    let osc7Buffer = "";
    // 다른 작업공간에 갔다가 돌아왔을 때 패널을 되살릴지 판단한다(사용자가 닫았으면 되살리지 않는다).
    let panelOpen = false;

    const storeProfile = () => {
      try {
        if (!rememberInput.checked) { localStorage.removeItem(PROFILE_KEY); return; }
        localStorage.setItem(PROFILE_KEY, JSON.stringify({
          host:hostInput.value.trim(), port:portInput.value.trim(), user:userInput.value.trim(),
          authentication:authMethodInput.value === "private-key" ? "private-key" : "password"
        }));
      } catch(_){}
    };

    const loadDockState = () => {
      const value = readDockStore()[workspaceId] || legacyDockState();
      if (!value || typeof value !== "object") return;
      dockSide = value.side === "left" ? "left" : "right";
      const width = Number(value.width);
      if (Number.isFinite(width)) dockWidth = Math.max(320, Math.min(900, width));
    };

    const storeDockState = () => {
      writeDockState(workspaceId, { side:dockSide, width:Math.round(dockWidth) });
    };

    const applyFontState = (persist=true) => {
      if (fontSelect) fontSelect.value = fontChoice;
      if (fontSizeOutput) fontSizeOutput.textContent = terminalFontSize + "px";
      if (lineHeightButton){
        lineHeightButton.textContent = "줄 " + terminalLineHeight.toFixed(2).replace(/0$/, "");
        lineHeightButton.title = "줄 간격 변경 (현재 " + terminalLineHeight.toFixed(2) + ")";
      }
      if (terminal){
        terminal.options.fontFamily = FONT_STACKS[fontChoice] || FONT_STACKS.cascadia;
        terminal.options.fontSize = terminalFontSize;
        terminal.options.lineHeight = terminalLineHeight;
        setTimeout(sendResize, 40);
      }
      if (persist) storeFontState();
    };

    const changeFontSize = (delta) => {
      terminalFontSize = Math.max(11, Math.min(24, terminalFontSize + delta));
      applyFontState();
    };

    const cycleLineHeight = () => {
      const values = [1, 1.15, 1.3, 1.5];
      const index = values.findIndex((value) => Math.abs(value - terminalLineHeight) < 0.01);
      terminalLineHeight = values[(index + 1) % values.length];
      applyFontState();
    };

    const notifyLayout = () => {
      if (layoutFrame) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        window.dispatchEvent(new Event("resize"));
        if (terminal && !dockCollapsed) sendResize();
      });
    };

    const applyDockState = () => {
      const main = document.querySelector("main");
      // 재접속의 종료 응답이 늦게 와도 배경 인스턴스가 현재 작업공간의 배치를 덮지 않는다.
      if (!main || !dock || !divider || dock.hidden || workspaceId !== currentWorkspaceId()) return;
      main.classList.toggle("ssh-dock-left", dockSide === "left");
      main.classList.toggle("ssh-dock-collapsed", dockCollapsed);
      main.style.setProperty("--ssh-dock-width", dockWidth + "px");
      dock.dataset.side = dockSide;
      dock.setAttribute("aria-label", "SSH 원격 터미널 · " + (dockSide === "left" ? "왼쪽" : "오른쪽") + " 패널");
      if (rail) rail.title = "원격 터미널 펼치기 (" + (dockSide === "left" ? "왼쪽" : "오른쪽") + ")";
      notifyLayout();
    };

    const toggleDockSide = () => {
      dockSide = dockSide === "right" ? "left" : "right";
      storeDockState(); applyDockState();
    };

    const setDockCollapsed = (collapsed) => {
      dockCollapsed = !!collapsed;
      applyDockState();
      if (!dockCollapsed && terminal) setTimeout(() => {
        if (!terminal || !dock || dock.hidden || terminalView.hidden || workspaceId !== currentWorkspaceId()) return;
        sendResize(); terminal.focus();
      }, 80);
    };

    const beginDockResize = (event) => {
      if (dockCollapsed || event.button !== 0) return;
      event.preventDefault();
      divider.classList.add("dragging");
      const main = document.querySelector("main");
      const move = (moveEvent) => {
        if (!dock || dock.hidden || workspaceId !== currentWorkspaceId()) return;
        const rect = main.getBoundingClientRect();
        const proposed = dockSide === "right" ? rect.right - moveEvent.clientX : moveEvent.clientX - rect.left;
        dockWidth = Math.max(320, Math.min(Math.max(320, rect.width - 320), proposed));
        main.style.setProperty("--ssh-dock-width", dockWidth + "px");
        notifyLayout();
      };
      const end = () => {
        if (divider) divider.classList.remove("dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        storeDockState(); notifyLayout();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once:true });
      window.addEventListener("pointercancel", end, { once:true });
    };

    const field = (label, input) => {
      const wrap = document.createElement("label"); wrap.className = "ssh-field";
      const copy = document.createElement("span"); copy.textContent = label;
      wrap.append(copy, input); return wrap;
    };

    const button = (copy, className="btn") => {
      const el = document.createElement("button"); el.type = "button"; el.className = className; el.textContent = copy; return el;
    };

    const formatBytes = (value) => {
      const bytes = Math.max(0, Number(value) || 0);
      if (bytes < 1024) return bytes + " B";
      const units = ["KB", "MB", "GB", "TB"];
      let size = bytes / 1024, unit = 0;
      while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
      return size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2) + " " + units[unit];
    };

    const updateUploadSelectionSummary = () => {
      if (!uploadFileSummary) return;
      if (!uploadSelectionId || !uploadFiles.length){ uploadFileSummary.textContent = "선택된 파일 없음"; return; }
      const names = uploadFiles.slice(0, 2).join(", ");
      uploadFileSummary.textContent = names + (uploadFiles.length > 2 ? " 외 " + (uploadFiles.length - 2) + "개" : "")
        + " · " + formatBytes(uploadTotalBytes);
    };

    const setUploadBusy = (busy) => {
      if (!uploadPanel) return;
      uploadFileButton.disabled = busy || uploadPicking;
      uploadPathInput.disabled = busy;
      uploadSecretInput.disabled = busy;
      uploadStartButton.disabled = busy || !uploadSelectionId;
      uploadCancelButton.hidden = !busy;
      uploadCloseButton.disabled = busy;
      if (uploadProgress){ uploadProgress.hidden = !busy; if (busy) uploadProgress.removeAttribute("value"); }
    };

    const chooseUploadFiles = async () => {
      if (uploadPicking || uploadId) return;
      uploadPicking = true; uploadFileButton.disabled = true;
      const pick = ++uploadPickGeneration;
      uploadStatus.textContent = "Windows 파일 선택창에서 업로드할 파일을 선택하세요…";
      uploadStatus.classList.remove("error", "success");
      try {
        const start = await fetchTimed("/ssh-upload-pick", { method:"POST", headers:{ "X-ClassDock-Action":"1" } }, 10000);
        if (!start.ok) throw new Error(await start.text());
        for (let attempt = 0; attempt < 1200 && pick === uploadPickGeneration; attempt++){
          const data = await responseData(await fetchTimed("/ssh-upload-pick-status", {
            cache:"no-store", headers:{ "X-ClassDock-Action":"1" }
          }, 10000));
          if (data.state === "selected"){
            uploadSelectionId = String(data.id || "");
            uploadFiles = Array.isArray(data.files) ? data.files.map(String) : [];
            uploadTotalBytes = Number(data.totalBytes) || 0;
            updateUploadSelectionSummary();
            uploadStatus.textContent = uploadFiles.length + "개 파일(" + formatBytes(uploadTotalBytes) + ")을 선택했습니다.";
            uploadStartButton.disabled = !uploadSelectionId;
            return;
          }
          if (data.state === "cancelled") { uploadStatus.textContent = "파일 선택을 취소했습니다."; return; }
          if (data.state === "error") throw new Error(String(data.error || "ssh-upload-picker-failed"));
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (pick === uploadPickGeneration) throw new Error("파일 선택 시간이 초과되었습니다.");
      } catch(error){
        uploadStatus.textContent = friendlyError(error); uploadStatus.classList.add("error");
      } finally {
        if (pick === uploadPickGeneration){ uploadPicking = false; uploadFileButton.disabled = false; }
      }
    };

    const updateAuthenticationUi = () => {
      if (!authMethodInput || !keyField || !credentialLabel) return;
      const privateKey = authMethodInput.value === "private-key";
      keyField.hidden = !privateKey;
      credentialLabel.textContent = privateKey ? "키 암호 (암호화된 키만)" : "비밀번호";
      passwordInput.placeholder = privateKey ? "암호가 없는 키는 비워 두세요" : "SSH 비밀번호";
      passwordInput.required = !privateKey;
      if (keyNameEl) keyNameEl.textContent = selectedKeyName || "선택된 키 없음";
    };

    const choosePrivateKey = async () => {
      if (keyPicking) return;
      if (location.protocol !== "http:" && location.protocol !== "https:"){
        statusEl.textContent = "개인키 선택은 ClassDock.exe에서만 사용할 수 있습니다.";
        statusEl.classList.add("error"); return;
      }
      keyPicking = true; keyButton.disabled = true;
      const pick = ++keyPickGeneration;
      statusEl.textContent = "Windows 파일 선택창에서 개인키를 선택하세요…";
      statusEl.classList.remove("error");
      try {
        const start = await fetchTimed("/ssh-key-pick", { method:"POST", headers:{ "X-ClassDock-Action":"1" } }, 10000);
        if (!start.ok) throw new Error(await start.text());
        for (let attempt = 0; attempt < 1200 && pick === keyPickGeneration; attempt++){
          const data = await responseData(await fetchTimed("/ssh-key-pick-status", {
            cache:"no-store", headers:{ "X-ClassDock-Action":"1" }
          }, 10000));
          if (data.state === "selected"){
            selectedKeyId = String(data.id || ""); selectedKeyName = String(data.name || "");
            keyNameEl.textContent = selectedKeyName || "개인키 선택됨";
            statusEl.textContent = selectedKeyName + " 개인키를 선택했습니다.";
            return;
          }
          if (data.state === "cancelled") { statusEl.textContent = "개인키 선택을 취소했습니다."; return; }
          if (data.state === "error") throw new Error(String(data.name || "ssh-private-key-invalid-format"));
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (pick === keyPickGeneration) throw new Error("개인키 선택 시간이 초과되었습니다.");
      } catch(error){
        statusEl.textContent = friendlyError(error); statusEl.classList.add("error");
      } finally {
        if (pick === keyPickGeneration) { keyPicking = false; keyButton.disabled = false; }
      }
    };

    const updateUploadPathHint = (message="") => {
      if (!uploadPathHint) return;
      uploadPathHint.textContent = message || (currentRemoteDirectory
        ? "자동 감지한 현재 폴더: " + currentRemoteDirectory
        : "현재 폴더 자동 감지 대기 중입니다. 지원하지 않는 셸에서는 직접 입력하세요. ./는 로그인 홈 폴더입니다.");
    };

    const acceptRemoteDirectory = (location) => {
      // Only this connection's startup hook may populate original-server file paths.
      // Hostnames from nested SSH/container shells are not proof of the transfer destination.
      if (!location || !sessionId || location.host !== "classdock-" + sessionId.toLowerCase()) return;
      currentRemoteDirectory = location.path;
      if (uploadPathInput && uploadPathIsAutomatic && !uploadId){
        uploadPathInput.value = currentRemoteDirectory;
      }
      updateUploadPathHint();
      remoteFiles?.updateDirectory();
    };

    const captureOsc7Locations = (value) => {
      // Keep only the incomplete suffix. Re-scanning diagnostic history replays stale paths.
      osc7Buffer += String(value || "");
      const pattern = /\x1b\]7;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
      let match, consumed=0;
      while ((match = pattern.exec(osc7Buffer))){
        acceptRemoteDirectory(parseOsc7Location(match[1]));consumed=pattern.lastIndex;
      }
      osc7Buffer=osc7Buffer.slice(consumed);
      const start=osc7Buffer.lastIndexOf("\x1b]7;");
      osc7Buffer=start>=0 ? osc7Buffer.slice(start) : osc7Buffer.slice(-3);
      if(osc7Buffer.length>32768)osc7Buffer=osc7Buffer.slice(-3);
    };

    const showUploadPanel = () => {
      if (!sessionId){
        if (terminal) terminal.writeln("\r\n\x1b[33m[파일 업로드] SSH 연결이 완료된 뒤 사용할 수 있습니다.\x1b[0m");
        return;
      }
      uploadPanel.hidden = false;
      const privateKey = authMethodInput.value === "private-key";
      uploadSecretLabel.textContent = privateKey ? "키 암호 (암호화된 키만)" : "SSH 비밀번호";
      uploadSecretInput.placeholder = privateKey ? "암호가 없는 키는 비워 두세요" : "업로드 연결에 다시 입력";
      uploadSecretInput.required = !privateKey;
      uploadSecretInput.value = "";
      if (uploadPathIsAutomatic) uploadPathInput.value = currentRemoteDirectory || "./";
      updateUploadPathHint();
      uploadStatus.textContent = uploadSelectionId
        ? "원격 디렉터리와 업로드 인증을 확인하세요."
        : "업로드할 Windows 파일을 선택하세요.";
      uploadStatus.classList.remove("error", "success");
      setUploadBusy(!!uploadId);
      setTimeout(() => (uploadSelectionId ? uploadPathInput : uploadFileButton).focus(), 0);
    };

    const classifyUploadFailure = (failure, code, stopped) => {
      if (stopped || Number(code) === 130) return "사용자가 업로드를 취소했습니다.";
      if (failure === "authentication")
        return authMethodInput.value === "private-key"
          ? "개인키 또는 키 암호가 올바르지 않습니다. 업로드 인증을 다시 확인하세요."
          : "계정 또는 비밀번호가 올바르지 않습니다. 업로드 비밀번호를 다시 입력하세요.";
      if (failure === "write-permission" || failure === "remote-failure")
        return "원격 디렉터리에 파일을 쓸 권한이 없습니다. 경로와 계정 권한을 확인하세요.";
      if (failure === "directory-not-found")
        return "원격 디렉터리를 찾을 수 없습니다. 존재하는 디렉터리 경로를 입력하세요.";
      if (failure === "sftp-unavailable")
        return "서버에서 SFTP 파일 전송을 시작하지 못했습니다. 서버의 SFTP 설정을 확인하세요.";
      if (failure === "timeout") return "서버가 제시간에 응답하지 않았습니다. IP·포트와 서버 상태를 확인하세요.";
      if (failure === "refused") return "서버가 파일 전송 연결을 거부했습니다. SSH 서비스와 포트를 확인하세요.";
      if (failure === "host") return "서버 주소를 찾지 못했습니다. IP 주소나 도메인을 확인하세요.";
      if (failure === "network") return "서버까지 연결 경로가 없습니다. 네트워크 상태를 확인하세요.";
      if (failure === "connection-closed") return "서버 또는 네트워크가 파일 전송 연결을 종료했습니다.";
      if (failure === "result-unavailable")
        return "파일 전송은 종료되었지만 완료 결과를 확인하지 못했습니다. 원격 디렉터리에서 파일을 확인하세요.";
      return "파일 업로드에 실패했습니다(코드 " + code + "). 원격 경로와 서버 상태를 확인하세요.";
    };

    const updateUploadProgress = (value) => {
      const percent = Number(value);
      if (percent >= 0){
        const safePercent = Math.max(0, Math.min(100, percent));
        uploadProgress.hidden = false; uploadProgress.value = safePercent;
        uploadStatus.textContent = "현재 파일 " + safePercent + "% · 전체 " + uploadFiles.length + "개 · " + formatBytes(uploadTotalBytes);
      } else uploadStatus.textContent = "업로드 연결 및 전송 준비 중…";
    };

    const finishUpload = (data) => {
      const succeeded = Number(data.code) === 0 && !data.stopped;
      const resultUnavailable = !data.stopped && Number(data.code) < 0 && String(data.failure || "") === "result-unavailable";
      const message = succeeded
        ? uploadFiles.length + "개 파일(" + formatBytes(uploadTotalBytes) + ") 업로드를 완료했습니다."
        : classifyUploadFailure(String(data.failure || "unknown"), data.code, !!data.stopped);
      uploadId = ""; uploadOffset = 0;
      setUploadBusy(false);
      uploadProgress.hidden = false;
      if (succeeded) uploadProgress.value = 100;
      else if (!resultUnavailable) uploadProgress.removeAttribute("value");
      uploadStatus.textContent = message;
      uploadStatus.classList.toggle("success", succeeded);
      uploadStatus.classList.toggle("error", !succeeded && !data.stopped && !resultUnavailable);
      if (terminal) terminal.writeln("\r\n" + (succeeded ? "\x1b[32m" : data.stopped || resultUnavailable ? "\x1b[33m" : "\x1b[31m")
        + "[파일 업로드] " + message + "\x1b[0m");
    };

    const pollUploadLoop = async (myGeneration) => {
      while (uploadId && myGeneration === uploadGeneration){
        const id = uploadId;
        try {
          const data = await responseData(await fetch("/ssh-upload-poll?id=" + encodeURIComponent(id) + "&offset=" + uploadOffset, { cache:"no-store" }));
          if (id !== uploadId || myGeneration !== uploadGeneration) return;
          uploadPollFailures = 0;
          updateUploadProgress(data.progress);
          uploadOffset = Number(data.offset) || uploadOffset;
          if ((data.complete || data.alive === false) && !data.more){ finishUpload(data); return; }
        } catch(error){
          if (id !== uploadId || myGeneration !== uploadGeneration) return;
          uploadPollFailures++;
          uploadStatus.textContent = "업로드 상태 확인 재시도 " + uploadPollFailures + "/12";
          if (uploadPollFailures >= 12){
            uploadId = ""; setUploadBusy(false);
            uploadStatus.textContent = "업로드 상태를 확인하지 못했습니다. " + friendlyError(error);
            uploadStatus.classList.add("error");
            fetch("/ssh-upload-cancel?id=" + encodeURIComponent(id), { method:"POST", keepalive:true }).catch(() => {});
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 80 * uploadPollFailures)));
        }
      }
    };

    const startUpload = async () => {
      if (uploadId || !sessionId) return;
      if (!uploadSelectionId){ uploadStatus.textContent = "업로드할 파일을 먼저 선택하세요."; uploadStatus.classList.add("error"); return; }
      const secret = uploadSecretInput.value;
      if (authMethodInput.value !== "private-key" && !secret){
        uploadStatus.textContent = "업로드 연결에 사용할 SSH 비밀번호를 다시 입력하세요."; uploadStatus.classList.add("error"); return;
      }
      const directory = uploadPathInput.value.trim() || "./";
      uploadOffset = 0; uploadPollFailures = 0;
      uploadStatus.textContent = "안전한 파일 전송 연결을 시작하고 있습니다…";
      uploadStatus.classList.remove("error", "success");
      setUploadBusy(true);
      const myGeneration = ++uploadGeneration;
      try {
        const opened = await responseData(await fetchTimed("/ssh-upload-start", {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" },
          body:encodeStrings([sessionId, uploadSelectionId, directory, secret])
        }, 20000));
        uploadSecretInput.value = "";
        if (myGeneration !== uploadGeneration){
          fetch("/ssh-upload-cancel?id=" + encodeURIComponent(opened.id), { method:"POST", keepalive:true }).catch(() => {}); return;
        }
        uploadId = String(opened.id || "");
        uploadStatus.textContent = "업로드 연결 및 전송 준비 중…";
        if (terminal) terminal.writeln("\r\n\x1b[36m[파일 업로드] " + uploadFiles.length + "개 · " + formatBytes(uploadTotalBytes)
          + " → " + String(opened.directory || directory) + "\x1b[0m");
        pollUploadLoop(myGeneration);
      } catch(error){
        uploadSecretInput.value = ""; uploadId = ""; setUploadBusy(false);
        uploadStatus.textContent = friendlyError(error); uploadStatus.classList.add("error");
      }
    };

    const cancelActiveUpload = async (showMessage) => {
      const id = uploadId;
      uploadGeneration++; uploadId = ""; uploadOffset = 0; uploadPollFailures = 0;
      if (id){
        try { await fetch("/ssh-upload-cancel?id=" + encodeURIComponent(id), { method:"POST" }); } catch(_){}
      }
      if (uploadSecretInput) uploadSecretInput.value = "";
      if (uploadPanel){
        setUploadBusy(false);
        if (showMessage){ uploadStatus.textContent = "업로드를 취소했습니다."; uploadStatus.classList.remove("error", "success"); }
      }
      if (showMessage && terminal) terminal.writeln("\r\n\x1b[33m[파일 업로드] 사용자가 업로드를 취소했습니다.\x1b[0m");
    };

    const ensureUi = () => {
      if (dock) return;
      const main = document.querySelector("main");
      if (!main) throw new Error("작업 영역을 찾지 못했습니다.");
      loadDockState(); loadFontState();
      divider = document.createElement("div"); divider.className = "ssh-dock-divider"; divider.hidden = true;
      divider.setAttribute("role", "separator"); divider.setAttribute("aria-orientation", "vertical"); divider.title = "드래그: 터미널 너비 조절 · 더블클릭: 좌우 위치 교환";
      dock = document.createElement("aside"); dock.className = "ssh-dock"; dock.hidden = true;
      rail = document.createElement("button"); rail.type = "button"; rail.className = "ssh-dock-rail";
      rail.innerHTML = '<span aria-hidden="true">⌨</span><strong>SSH</strong>';
      rail.setAttribute("aria-label", "원격 터미널 펼치기");
      card = document.createElement("div"); card.className = "ssh-terminal-card";

      formView = document.createElement("form"); formView.className = "ssh-connect-view"; formView.autocomplete = "off";
      const heading = document.createElement("div"); heading.className = "ssh-heading";
      const headingCopy = document.createElement("div");
      const title = document.createElement("h3"); title.textContent = "원격 터미널";
      const subtitle = document.createElement("p"); subtitle.className = "sub"; subtitle.textContent = "IP 주소와 Linux 계정으로 SSH 서버에 접속합니다.";
      headingCopy.append(title, subtitle);
      const headingActions = document.createElement("div"); headingActions.className = "ssh-heading-actions";
      const formSwap = button("⇄", "btn ssh-dock-swap"); formSwap.title = "터미널 좌우 위치 교환"; formSwap.setAttribute("aria-label", "터미널 좌우 위치 교환");
      const formCollapse = button("접기", "btn ssh-dock-collapse"); formCollapse.title = "연결 화면 접기";
      const formClose = button("닫기", "btn ssh-close"); formClose.setAttribute("aria-label", "원격 터미널 닫기");
      headingActions.append(formSwap, formCollapse, formClose);
      heading.append(headingCopy, headingActions);

      hostInput = document.createElement("input"); hostInput.type = "text"; hostInput.placeholder = "예: 192.168.0.20"; hostInput.autocomplete = "off"; hostInput.spellcheck = false; hostInput.maxLength = 253;
      portInput = document.createElement("input"); portInput.type = "number"; portInput.min = "1"; portInput.max = "65535"; portInput.value = "22"; portInput.inputMode = "numeric";
      userInput = document.createElement("input"); userInput.type = "text"; userInput.placeholder = "예: student"; userInput.autocomplete = "username"; userInput.spellcheck = false; userInput.maxLength = 128;
      authMethodInput = document.createElement("select"); authMethodInput.setAttribute("aria-label", "SSH 인증 방식");
      [["password","비밀번호"],["private-key","개인키"]].forEach(([value, label]) => {
        const option = document.createElement("option"); option.value = value; option.textContent = label; authMethodInput.appendChild(option);
      });
      passwordInput = document.createElement("input"); passwordInput.type = "password"; passwordInput.autocomplete = "off"; passwordInput.setAttribute("data-lpignore", "true"); passwordInput.maxLength = 16384;
      const passwordWrap = document.createElement("label"); passwordWrap.className = "ssh-field ssh-credential-field";
      credentialLabel = document.createElement("span"); credentialLabel.textContent = "비밀번호";
      passwordWrap.append(credentialLabel, passwordInput);
      const keyPicker = document.createElement("div"); keyPicker.className = "ssh-key-picker";
      keyButton = button("개인키 선택…", "btn");
      keyNameEl = document.createElement("span"); keyNameEl.textContent = "선택된 키 없음"; keyNameEl.title = "개인키 경로는 브라우저에 전달하거나 저장하지 않습니다.";
      keyPicker.append(keyButton, keyNameEl);
      keyField = field("개인키 파일", keyPicker); keyField.classList.add("ssh-key-field"); keyField.hidden = true;
      const grid = document.createElement("div"); grid.className = "ssh-connect-grid";
      grid.append(field("호스트", hostInput), field("포트", portInput), field("계정", userInput), field("인증 방식", authMethodInput), keyField, passwordWrap);

      const remember = document.createElement("label"); remember.className = "settings-check ssh-remember";
      rememberInput = document.createElement("input"); rememberInput.type = "checkbox"; rememberInput.checked = true;
      const rememberCopy = document.createElement("span"); rememberCopy.textContent = "IP·포트·계정·인증 방식 기억 (비밀번호·키 암호·개인키 경로는 저장하지 않음)";
      remember.append(rememberInput, rememberCopy);
      const security = document.createElement("p"); security.className = "ssh-security-note";
      security.textContent = "처음 접속하는 서버는 SHA-256 지문을 확인한 뒤 신뢰해야 합니다. 관리자에게 받은 지문과 비교하세요.";
      statusEl = document.createElement("div"); statusEl.className = "ssh-connect-status"; statusEl.setAttribute("role", "status"); statusEl.setAttribute("aria-live", "polite");
      const actions = document.createElement("div"); actions.className = "modal-actions";
      const spacer = document.createElement("span"); spacer.className = "spacer";
      connectButton = button("접속", "btn primary"); connectButton.type = "submit";
      actions.append(spacer, connectButton);
      formView.append(heading, grid, remember, security, statusEl, actions);

      terminalView = document.createElement("section"); terminalView.className = "ssh-session-view"; terminalView.hidden = true;
      const terminalHead = document.createElement("div"); terminalHead.className = "ssh-session-head";
      const terminalIdentity = document.createElement("div");
      terminalTitle = document.createElement("strong"); terminalTitle.textContent = "SSH";
      terminalStatus = document.createElement("span"); terminalStatus.className = "ssh-session-status"; terminalStatus.textContent = "접속 준비";
      terminalIdentity.append(terminalTitle, terminalStatus);
      const terminalActions = document.createElement("div"); terminalActions.className = "ssh-session-actions";
      const terminalSwap = button("⇄", "btn ssh-dock-swap"); terminalSwap.title = "터미널 좌우 위치 교환"; terminalSwap.setAttribute("aria-label", "터미널 좌우 위치 교환");
      const terminalCollapse = button("접기", "btn ssh-dock-collapse"); terminalCollapse.title = "SSH 연결을 유지하고 터미널 접기";
      uploadButton = button("파일 업로드", "btn ssh-upload-open"); uploadButton.title = "Windows 파일을 원격 서버로 업로드";
      filesButton = button("원격 파일", "btn ssh-files-open"); filesButton.title = "원격 파일 미리보기와 다운로드";
      fileCancelButton = button("다운로드 취소", "btn danger"); fileCancelButton.hidden = true;
      disconnectButton = button("연결 끊기", "btn ssh-disconnect");
      retryButton = button("재접속", "btn primary ssh-retry"); retryButton.hidden = true;
      const changeServer = button("접속 정보", "btn ssh-reconnect");
      const terminalClose = button("닫기", "btn primary ssh-terminal-close");
      terminalActions.append(terminalSwap, terminalCollapse, uploadButton, filesButton, fileCancelButton, disconnectButton, retryButton, changeServer, terminalClose);
      const fontControls = document.createElement("div"); fontControls.className = "ssh-font-controls"; fontControls.setAttribute("role", "group"); fontControls.setAttribute("aria-label", "터미널 글꼴 설정");
      fontSelect = document.createElement("select"); fontSelect.className = "ssh-font-select"; fontSelect.setAttribute("aria-label", "터미널 글꼴");
      [["cascadia","Cascadia Mono"],["consolas","Consolas"],["d2coding","D2Coding"],["nanum","나눔고딕코딩"],["system","시스템 고정폭"]].forEach(([value, label]) => {
        const option = document.createElement("option"); option.value = value; option.textContent = label; fontSelect.appendChild(option);
      });
      const fontMinus = button("−", "ssh-font-step"); fontMinus.title = "터미널 글자 작게"; fontMinus.setAttribute("aria-label", "터미널 글자 작게");
      fontSizeOutput = document.createElement("output"); fontSizeOutput.className = "ssh-font-size"; fontSizeOutput.setAttribute("aria-live", "polite");
      const fontPlus = button("+", "ssh-font-step"); fontPlus.title = "터미널 글자 크게"; fontPlus.setAttribute("aria-label", "터미널 글자 크게");
      lineHeightButton = button("줄 1.15", "ssh-line-height");
      fontControls.append(fontSelect, fontMinus, fontSizeOutput, fontPlus, lineHeightButton);
      terminalHead.append(terminalIdentity, terminalActions, fontControls);

      uploadPanel = document.createElement("section"); uploadPanel.className = "ssh-upload-panel"; uploadPanel.hidden = true;
      const uploadHeading = document.createElement("div"); uploadHeading.className = "ssh-upload-heading";
      const uploadTitle = document.createElement("strong"); uploadTitle.textContent = "Windows 파일 업로드";
      uploadCloseButton = button("닫기", "ssh-upload-close"); uploadCloseButton.setAttribute("aria-label", "파일 업로드 닫기");
      uploadHeading.append(uploadTitle, uploadCloseButton);
      const uploadGrid = document.createElement("div"); uploadGrid.className = "ssh-upload-grid";
      const uploadPicker = document.createElement("div"); uploadPicker.className = "ssh-upload-picker";
      uploadFileButton = button("파일 선택…", "btn");
      uploadFileSummary = document.createElement("span"); uploadFileSummary.textContent = "선택된 파일 없음";
      uploadPicker.append(uploadFileButton, uploadFileSummary);
      uploadPathInput = document.createElement("input"); uploadPathInput.type = "text"; uploadPathInput.value = "./";
      uploadPathInput.maxLength = 2048; uploadPathInput.spellcheck = false; uploadPathInput.autocomplete = "off";
      uploadPathInput.placeholder = "예: ./ 또는 /home/student/uploads/";
      const uploadPathPicker = document.createElement("div"); uploadPathPicker.className = "ssh-upload-path-picker";
      uploadPathHint = document.createElement("small"); uploadPathHint.className = "ssh-upload-path-hint";
      uploadPathPicker.append(uploadPathInput, uploadPathHint);
      uploadSecretInput = document.createElement("input"); uploadSecretInput.type = "password"; uploadSecretInput.maxLength = 16384;
      uploadSecretInput.autocomplete = "off"; uploadSecretInput.setAttribute("data-lpignore", "true");
      const uploadSecretField = field("업로드 인증", uploadSecretInput);
      uploadSecretLabel = uploadSecretField.firstElementChild;
      const uploadFileField = field("로컬 파일 (최대 32개)", uploadPicker); uploadFileField.classList.add("ssh-upload-file-field");
      uploadGrid.append(uploadFileField, field("원격 디렉터리", uploadPathPicker), uploadSecretField);
      const uploadNote = document.createElement("p"); uploadNote.className = "ssh-upload-note";
      uploadNote.textContent = "Bash 접속에서는 현재 폴더를 자동으로 채웁니다. 직접 입력한 경로는 자동 감지가 덮어쓰지 않습니다. 다른 서버로 다시 SSH 접속했거나 컨테이너 셸에서는 원래 서버 경로를 직접 입력하세요. 같은 이름의 파일은 덮어쓸 수 있습니다.";
      uploadProgress = document.createElement("progress"); uploadProgress.className = "ssh-upload-progress"; uploadProgress.max = 100; uploadProgress.hidden = true;
      uploadStatus = document.createElement("div"); uploadStatus.className = "ssh-upload-status"; uploadStatus.setAttribute("role", "status"); uploadStatus.setAttribute("aria-live", "polite");
      const uploadActions = document.createElement("div"); uploadActions.className = "ssh-upload-actions";
      uploadCancelButton = button("업로드 취소", "btn danger"); uploadCancelButton.hidden = true;
      uploadStartButton = button("업로드 시작", "btn primary"); uploadStartButton.disabled = true;
      uploadActions.append(uploadCancelButton, uploadStartButton);
      uploadPanel.append(uploadHeading, uploadGrid, uploadNote, uploadProgress, uploadStatus, uploadActions);

      terminalHost = document.createElement("div"); terminalHost.className = "ssh-xterm-host";
      terminalView.append(terminalHead, uploadPanel, terminalHost);
      remoteFiles = MNRemoteFilesUI.create({
        getSession:() => ({ id:sessionId, identity:terminalTitle.textContent, authentication:authMethodInput.value }),
        getDirectory:() => currentRemoteDirectory,
        onVisibility:(visible) => {
          terminalHost.hidden = visible;
          if (visible) uploadPanel.hidden = true;
          terminalView.classList.toggle("ssh-files-visible", visible);
          if (!visible) setTimeout(() => { sendResize(); terminal?.focus(); }, 0);
        },
        onBusy:(downloading) => { filesButton.textContent = downloading ? "원격 파일 · 다운로드 중" : "원격 파일"; fileCancelButton.hidden = !downloading; }
      });
      terminalView.append(remoteFiles.panel);
      filesButton.addEventListener("click", () => remoteFiles.show());
      fileCancelButton.addEventListener("click", () => remoteFiles.cancel());
      card.append(formView, terminalView); dock.append(rail, card); main.append(divider, dock);
      applyDockState(); applyFontState(false);

      formClose.addEventListener("click", close);
      terminalClose.addEventListener("click", close);
      formSwap.addEventListener("click", toggleDockSide);
      terminalSwap.addEventListener("click", toggleDockSide);
      formCollapse.addEventListener("click", () => setDockCollapsed(true));
      terminalCollapse.addEventListener("click", () => setDockCollapsed(true));
      rail.addEventListener("click", () => setDockCollapsed(false));
      divider.addEventListener("pointerdown", beginDockResize);
      divider.addEventListener("dblclick", toggleDockSide);
      disconnectButton.addEventListener("click", async () => { generation++; await disconnectSession(true); });
      uploadButton.addEventListener("click", () => { remoteFiles.hide(); showUploadPanel(); });
      uploadFileButton.addEventListener("click", chooseUploadFiles);
      uploadPathInput.addEventListener("input", () => { uploadPathIsAutomatic = false; });
      uploadStartButton.addEventListener("click", startUpload);
      uploadCancelButton.addEventListener("click", () => cancelActiveUpload(true));
      uploadCloseButton.addEventListener("click", () => { if (!uploadId) uploadPanel.hidden = true; });
      retryButton.addEventListener("click", () => prepareReconnect());
      changeServer.addEventListener("click", () => prepareReconnect("접속 정보를 확인한 뒤 재접속하세요."));
      authMethodInput.addEventListener("change", () => { passwordInput.value = ""; updateAuthenticationUi(); });
      keyButton.addEventListener("click", choosePrivateKey);
      fontSelect.addEventListener("change", () => { fontChoice = fontSelect.value; applyFontState(); });
      fontMinus.addEventListener("click", () => changeFontSize(-1));
      fontPlus.addEventListener("click", () => changeFontSize(1));
      lineHeightButton.addEventListener("click", cycleLineHeight);
      formView.addEventListener("submit", (event) => { event.preventDefault(); connect(); });
      formView.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      });
      // xterm의 Esc·Ctrl 조합이 앱 전역 단축키까지 번지지 않게 한다.
      terminalView.addEventListener("keydown", (event) => event.stopPropagation());
      // 공용 최근 접속 정보는 최초 생성 시에만 적용한다. 다시 열 때는 이 작업공간의 입력을 유지한다.
      const profile = savedProfile();
      hostInput.value = String(profile.host || "");
      portInput.value = String(profile.port || "22");
      userInput.value = String(profile.user || "");
      if (profile.authentication === "private-key" || profile.authentication === "password") authMethodInput.value = profile.authentication;
      updateAuthenticationUi();
    };

    const showForm = (message="", focusPassword=false) => {
      formView.hidden = false; terminalView.hidden = true;
      setFormBusy(false, message);
      setTimeout(() => (focusPassword ? passwordInput : hostInput).focus(), 0);
    };

    const setSessionControls = (active) => {
      if (disconnectButton) disconnectButton.hidden = !active;
      if (retryButton) retryButton.hidden = !!active;
      if (uploadButton) uploadButton.disabled = !active || !uploadAvailable;
      if (filesButton) filesButton.disabled = !active;
      if (!active && remoteFiles) remoteFiles.reset();
    };

    const prepareReconnect = async (message) => {
      generation++;
      await disconnectSession(false);
      passwordInput.value = "";
      setDockCollapsed(false);
      const privateKey = authMethodInput.value === "private-key";
      showForm(message || (privateKey
        ? "선택한 개인키와 키 암호를 확인한 뒤 재접속하세요."
        : "비밀번호를 다시 입력한 뒤 재접속하세요."), !privateKey);
    };

    const setFormBusy = (busy, copy="") => {
      connectButton.disabled = busy;
      hostInput.disabled = busy; portInput.disabled = busy; userInput.disabled = busy; authMethodInput.disabled = busy;
      passwordInput.disabled = busy; rememberInput.disabled = busy; keyButton.disabled = busy || keyPicking;
      connectButton.textContent = busy ? "확인 중…" : "접속";
      statusEl.textContent = copy;
      statusEl.classList.remove("error");
    };

    const open = async () => {
      ensureUi();
      const menu = document.getElementById("sbMoreMenu"), more = document.getElementById("sbMore");
      if (menu) menu.hidden = true;
      if (more) more.setAttribute("aria-expanded", "false");
      panelOpen = true;
      dock.hidden = false; divider.hidden = false; setDockCollapsed(false);
      if (sessionId){
        terminalView.hidden = false; formView.hidden = true;
        setTimeout(() => { sendResize(); if (terminal) terminal.focus(); }, 80);
        return;
      }
      showForm();
      updateAuthenticationUi();
      passwordInput.value = "";
      try {
        if (location.protocol !== "http:" && location.protocol !== "https:") throw new Error("원격 터미널은 ClassDock.exe에서만 사용할 수 있습니다.");
        const info = await responseData(await fetchTimed("/ssh-capability", { cache:"no-store" }, 6000));
        if (!info.available) throw new Error(info.reason || "Windows OpenSSH Client가 필요합니다.");
        uploadAvailable = info.upload !== false;
        if (uploadButton) uploadButton.disabled = !sessionId || !uploadAvailable;
      } catch(error){
        statusEl.textContent = friendlyError(error);
        statusEl.classList.add("error"); connectButton.disabled = true;
      }
    };

    const close = async () => {
      generation++;
      await disconnectSession(false);
      if (passwordInput) passwordInput.value = "";
      keyPickGeneration++; keyPicking = false;
      panelOpen = false;
      if (dock) dock.hidden = true;
      if (divider) divider.hidden = true;
      notifyLayout();
    };

    const confirmHostKey = async (keyInfo) => {
      if (keyInfo.state === "trusted") return true;
      const changed = keyInfo.state === "changed";
      const message = changed
        ? "주의: 이 서버의 SSH 지문이 이전 접속과 달라졌습니다. 서버 재설치가 아니라면 중간자 공격일 수 있습니다.\n\n이전: " + keyInfo.trustedFingerprint + "\n새 지문: " + keyInfo.fingerprint + "\n\n관리자에게 확인한 뒤에만 새 지문으로 교체하세요."
        : "처음 접속하는 서버입니다. 아래 SHA-256 지문을 서버 관리자에게 받은 값과 비교하세요.\n\n" + keyInfo.fingerprint + "\n\n일치하면 이 서버를 신뢰하고 접속합니다.";
      let ok;
      if (typeof confirmDialog === "function"){
        const confirmModal = document.getElementById("confirmModal");
        if (confirmModal) confirmModal.classList.add("ssh-confirm-front");
        try { ok = await confirmDialog(message, changed ? "새 지문으로 교체" : "지문을 신뢰", "취소"); }
        finally { if (confirmModal) confirmModal.classList.remove("ssh-confirm-front"); }
      } else return false;
      if (!ok) return false;
      const trust = await fetchTimed("/ssh-host-key-trust", {
        method:"POST", headers:{ "Content-Type":"application/octet-stream" },
        body:encodeStrings([keyInfo.host, keyInfo.port, keyInfo.algorithm, keyInfo.key, changed ? "1" : "0"])
      }, 10000);
      await responseData(trust);
      return true;
    };

    const terminalDimensions = () => {
      const style = window.getComputedStyle(terminalHost);
      const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const innerWidth = Math.max(0, terminalHost.clientWidth - horizontalPadding);
      const innerHeight = Math.max(0, terminalHost.clientHeight - verticalPadding);
      const screen = terminalHost.querySelector(".xterm-screen");
      const screenRect = screen ? screen.getBoundingClientRect() : null;
      const measuredCharWidth = terminal && terminal.cols > 0 && screenRect && screenRect.width > 0
        ? screenRect.width / terminal.cols : 0;
      const measuredCellHeight = terminal && terminal.rows > 0 && screenRect && screenRect.height > 0
        ? screenRect.height / terminal.rows : 0;
      const charWidth = measuredCharWidth > 2 ? measuredCharWidth : terminalFontSize * 0.65;
      const cellHeight = measuredCellHeight > 4 ? measuredCellHeight : terminalFontSize * terminalLineHeight * 1.12;
      return {
        cols:Math.max(20, Math.min(300, Math.floor(innerWidth / charWidth))),
        // WebView 배율·작업 표시줄 변화로 마지막 줄이 잘리지 않도록 한 줄을 안전 여백으로 둔다.
        rows:Math.max(5, Math.min(120, Math.floor(innerHeight / cellHeight) - 1))
      };
    };

    const sendResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // File preview hides xterm. Measuring it then yields 0x0 and shrinks the remote PTY
        // to 20x5, reflowing its contents and full-screen applications while it is invisible.
        if (!terminal || !sessionId || terminalView.hidden || dockCollapsed || dock.hidden || terminalHost.hidden
            || workspaceId !== currentWorkspaceId() || terminalHost.clientWidth <= 0 || terminalHost.clientHeight <= 0) return;
        const size = terminalDimensions();
        if (size.cols === currentCols && size.rows === currentRows) return;
        currentCols = size.cols; currentRows = size.rows;
        terminal.resize(currentCols, currentRows);
        fetch("/ssh-session-resize?id=" + encodeURIComponent(sessionId), {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" },
          body:encodeStrings([currentCols, currentRows])
        }).catch(() => {});
      }, 100);
    };

    const initializeXterm = async () => {
      if (typeof MNLazy === "undefined" || !(await MNLazy.tryNeed("xterm")) || typeof Terminal !== "function")
        throw new Error("원격 터미널 화면을 불러오지 못했습니다.");
      if (terminal) terminal.dispose();
      resetWriteBackpressure();
      terminalHost.replaceChildren();
      const dark = document.documentElement.getAttribute("data-theme") === "dark" || document.body.classList.contains("dark");
      terminal = new Terminal({
        cols:100, rows:30, cursorBlink:true, cursorStyle:"block", scrollback:5000,
        fontFamily:FONT_STACKS[fontChoice] || FONT_STACKS.cascadia, fontSize:terminalFontSize, lineHeight:terminalLineHeight,
        allowTransparency:false, screenReaderMode:false, convertEol:false,
        theme: dark
          ? { background:"#0b1220", foreground:"#e5edf8", cursor:"#60a5fa", selectionBackground:"#31537a" }
          : { background:"#101827", foreground:"#edf2f7", cursor:"#67e8f9", selectionBackground:"#345b7d" }
      });
      terminal.open(terminalHost);
      const size = terminalDimensions(); currentCols = size.cols; currentRows = size.rows; terminal.resize(currentCols, currentRows);
      terminal.onData(queueInput);
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(sendResize) : null;
      if (resizeObserver) resizeObserver.observe(terminalHost);
    };

    const connect = async () => {
      const host = hostInput.value.trim(), port = portInput.value.trim(), user = userInput.value.trim();
      const authentication = authMethodInput.value === "private-key" ? "private-key" : "password";
      const secret = passwordInput.value;
      if (!host || !port || !user){ statusEl.textContent = "호스트·포트·계정을 모두 입력하세요."; statusEl.classList.add("error"); return; }
      if (authentication === "password" && !secret){ statusEl.textContent = "SSH 비밀번호를 입력하세요."; statusEl.classList.add("error"); return; }
      if (authentication === "private-key" && !selectedKeyId){ statusEl.textContent = "접속에 사용할 개인키 파일을 선택하세요."; statusEl.classList.add("error"); return; }
      setFormBusy(true, "서버 지문을 확인하고 있습니다…");
      const myGeneration = ++generation;
      try {
        const scan = await responseData(await fetchTimed("/ssh-host-key-scan", {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" }, body:encodeStrings([host, port])
        }, 32000));
        if (myGeneration !== generation) return;
        if (!(await confirmHostKey(scan))) {
          passwordInput.value = "";
          setFormBusy(false, authentication === "private-key"
            ? "접속을 취소했습니다. 개인키를 확인한 뒤 다시 접속하세요."
            : "접속을 취소했습니다. 비밀번호를 다시 입력하세요.");
          return;
        }
        setFormBusy(true, "대화형 SSH 터미널을 시작하고 있습니다…");
        terminalView.hidden = false; formView.hidden = true;
        await initializeXterm();
        currentRemoteDirectory = ""; osc7Buffer = ""; uploadPathIsAutomatic = true;
        if (uploadPathInput) uploadPathInput.value = "./";
        updateUploadPathHint();
        remoteFiles?.updateDirectory();
        diagnosticTail = ""; diagnosticDecoder = new TextDecoder(); pollFailures = 0; pollStatusBeforeRetry = "";
        terminalTitle.textContent = user + "@" + host + (port === "22" ? "" : ":" + port);
        terminalStatus.textContent = "연결 중";
        terminalStatus.classList.remove("error"); terminalStatus.removeAttribute("title");
        setSessionControls(true);
        terminal.writeln("\x1b[36mClassDock SSH · " + terminalTitle.textContent + "\x1b[0m");
        if (authentication === "private-key") terminal.writeln("\x1b[90m인증: 개인키 · " + selectedKeyName + "\x1b[0m");
        const opened = await responseData(await fetchTimed("/ssh-session-open", {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" },
          body:encodeStrings([authentication, host, port, user, secret, selectedKeyId, currentCols, currentRows])
        }, 20000));
        passwordInput.value = ""; // 서버가 세션을 받은 즉시 비밀번호 또는 키 암호를 화면 메모리에서도 지운다.
        if (myGeneration !== generation){
          fetch("/ssh-session-stop?id=" + encodeURIComponent(opened.id), { method:"POST", keepalive:true }).catch(() => {}); return;
        }
        sessionId = String(opened.id || ""); outputOffset = 0; storeProfile();
        terminalStatus.textContent = "SSH 인증 중"; terminal.focus();
        pollLoop(myGeneration);
      } catch(error){
        passwordInput.value = "";
        await disconnectSession(false);
        formView.hidden = false; terminalView.hidden = true;
        setSessionControls(false);
        setFormBusy(false, friendlyError(error)); statusEl.classList.add("error");
      }
    };

    const queueInput = (data) => {
      if (!sessionId || !data) return;
      inputQueue.push(encoder.encode(data));
      // 12ms 를 모았다가 보내면 글자마다 그만큼 늦게 나간다. 곧바로 보낸다.
      // 전송 중이면 큐에 쌓아 두었다가 진행 중인 요청이 끝나는 즉시 flushInput 의
      // while 이 한 번에 묶어 보내므로, 빨리 쳐도 요청 수는 왕복당 하나로 유지된다.
      if (inputSending) return;
      if (inputTimer){ clearTimeout(inputTimer); inputTimer = 0; }
      flushInput();
    };

    const flushInput = async () => {
      inputTimer = 0;
      if (inputSending || !sessionId || !inputQueue.length) return;
      const id = sessionId;
      inputSending = true;
      try {
        while (id === sessionId && inputQueue.length){
          const chunks = inputQueue; inputQueue = [];
          const total = chunks.reduce((sum, value) => sum + value.length, 0);
          const body = new Uint8Array(total); let at = 0;
          chunks.forEach((value) => { body.set(value, at); at += value.length; });
          const response = await fetch("/ssh-session-input?id=" + encodeURIComponent(id), { method:"POST", body });
          if (!response.ok) throw new Error(await response.text());
        }
      } catch(error){
        if (terminal && id === sessionId) terminal.writeln("\r\n\x1b[31m입력을 보내지 못했습니다: " + friendlyError(error) + "\x1b[0m");
      } finally {
        inputSending = false;
        if (sessionId && inputQueue.length && !inputTimer) inputTimer = setTimeout(flushInput, 0);
      }
    };

    const decodeBase64 = (value) => {
      const raw = atob(String(value || ""));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return bytes;
    };

    const appendDiagnostic = (bytes) => {
      if (!bytes || !bytes.length) return;
      const decoded=diagnosticDecoder.decode(bytes, { stream:true });
      diagnosticTail = (diagnosticTail + decoded).slice(-16000);
      captureOsc7Locations(decoded);
      const plain = stripTerminalCodes(diagnosticTail);
      if (terminalStatus && terminalStatus.textContent === "SSH 인증 중"
        && (/Welcome to |Last login:/i.test(plain) || /(?:^|\r?\n)[^\r\n]{0,120}[$#%>] $/.test(plain)))
        terminalStatus.textContent = "접속됨";
    };

    // 렌더 완료를 기다릴 수 있는 Promise 를 돌려주되, 기다릴지는 호출부가 정한다.
    // xterm 은 write 호출 순서를 내부 큐로 지키므로 기다리지 않아도 출력이 뒤섞이지 않는다.
    const writeTerminal = (bytes) => {
      const target = terminal;
      if (!target || !bytes || !bytes.length) return null;
      const size = bytes.length, epoch = writeEpoch;
      pendingWriteBytes += size;
      lastWrite = new Promise((resolve) => {
        const done = () => {
          if (epoch === writeEpoch) pendingWriteBytes = Math.max(0, pendingWriteBytes - size);
          resolve();
        };
        try { target.write(bytes, done); }
        catch(_){ done(); }
      });
      return lastWrite;
    };

    const finishSession = (data) => {
      try { diagnosticTail = (diagnosticTail + diagnosticDecoder.decode()).slice(-16000); } catch(_){}
      const diagnosis = classifySshFailure(diagnosticTail, data.code, !!data.stopped);
      const id = sessionId; sessionId = "";
      currentRemoteDirectory = ""; osc7Buffer = "";updateUploadPathHint();remoteFiles?.updateDirectory();
      // 마지막 출력까지 받은 종료 세션은 더 이상 보존할 필요가 없다.
      // 닫기와 같은 stop 요청으로 서버에 회수를 허용한다(배경에서 아직 읽지 않은 세션은 보존).
      if (id) fetch("/ssh-session-stop?id=" + encodeURIComponent(id), { method:"POST", keepalive:true }).catch(() => {});
      terminalStatus.textContent = diagnosis.status;
      terminalStatus.title = diagnosis.message;
      terminalStatus.classList.toggle("error", Number(data.code) !== 0 && !data.stopped);
      setSessionControls(false);
      if (terminal){
        terminal.writeln("\r\n\x1b[33m[" + diagnosis.status + "] " + diagnosis.message + "\x1b[0m");
        terminal.writeln(authMethodInput.value === "private-key"
          ? "\x1b[90m상단의 [재접속]을 누르면 접속 정보와 선택한 개인키를 유지합니다.\x1b[0m"
          : "\x1b[90m상단의 [재접속]을 누르면 IP·포트·계정은 유지되고 비밀번호만 다시 입력합니다.\x1b[0m");
      }
    };

    const pollLoop = async (myGeneration) => {
      while (sessionId && myGeneration === generation){
        // 서버가 출력을 16MB 원형 버퍼에 쌓아 두므로 멈췄다가 저장해 둔 오프셋부터 이어 받으면 된다.
        // 상한을 넘겨 앞부분이 밀린 경우는 서버가 reset 을 내려 주고 아래에서 처리한다.
        if (pollPaused){
          await new Promise((resolve) => resumeWaiters.push(resolve));
          continue;
        }
        const id = sessionId;
        try {
          const data = await responseData(await fetch("/ssh-session-poll?id=" + encodeURIComponent(id) + "&offset=" + outputOffset, { cache:"no-store" }));
          if (id !== sessionId || myGeneration !== generation) return;
          if (pollFailures > 0){
            terminalStatus.textContent = pollStatusBeforeRetry || "접속됨";
            terminalStatus.removeAttribute("title");
          }
          pollFailures = 0;
          pollStatusBeforeRetry = "";
          if (data.reset && outputOffset > 0 && terminal){
            // reset 은 write 큐를 거치지 않고 즉시 실행된다. 아직 그려지지 않은 앞 출력이
            // reset 뒤에 나타나 화면이 뒤섞이지 않도록 큐를 먼저 비운다.
            if (lastWrite) await lastWrite;
            if (id !== sessionId || myGeneration !== generation) return;
            terminal.reset(); terminal.writeln("\x1b[33m[오래된 터미널 출력이 생략되었습니다.]\x1b[0m");
          }
          const bytes = data.data ? decodeBase64(data.data) : null;
          if (bytes){
            appendDiagnostic(bytes);
            const written = writeTerminal(bytes);
            // 평소(타자 에코)에는 렌더를 기다리지 않고 곧바로 다음 폴을 건다. 기다리면 그 사이
            // 서버에 대기 중인 폴 요청이 없어, 그때 도착한 에코가 다음 폴까지 서버 버퍼에서 잠든다.
            // 출력이 쏟아져 렌더가 밀릴 때만 기다려 xterm 쪽에 무한정 쌓이는 것을 막는다.
            if (written && pendingWriteBytes > WRITE_BACKPRESSURE_BYTES) await written;
          }
          if (id !== sessionId || myGeneration !== generation) return;
          outputOffset = Number(data.offset) || outputOffset;
          // more 가 true 면 서버가 크기 상한 때문에 남긴 출력이 있다. 종료된 세션이라도
          // 남은 분량을 마저 받은 뒤에 종료 처리를 한다.
          if ((data.complete || data.alive === false) && !data.more){
            finishSession(data);
            return;
          }
        } catch(error){
          if (id !== sessionId || myGeneration !== generation) return;
          if (pollFailures === 0) pollStatusBeforeRetry = terminalStatus.textContent;
          pollFailures++;
          terminalStatus.textContent = "상태 확인 재시도 " + pollFailures + "/12";
          terminalStatus.title = friendlyError(error);
          if (pollFailures >= 12){
            sessionId = "";
            currentRemoteDirectory = ""; osc7Buffer = "";updateUploadPathHint();remoteFiles?.updateDirectory();
            terminalStatus.textContent = "연결 상태 확인 실패";
            terminalStatus.title = friendlyError(error);
            terminalStatus.classList.add("error");
            setSessionControls(false);
            if (terminal) terminal.writeln("\r\n\x1b[31m[연결 상태 확인 실패] ClassDock의 SSH 중계 응답을 확인하지 못했습니다. 재접속해 주세요.\x1b[0m");
            fetch("/ssh-session-stop?id=" + encodeURIComponent(id), { method:"POST", keepalive:true }).catch(() => {});
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 60 * pollFailures)));
          continue;
        }
      }
    };

    const disconnectSession = async (showMessage) => {
      if (remoteFiles) remoteFiles.reset();
      await cancelActiveUpload(false);
      currentRemoteDirectory = ""; osc7Buffer = ""; uploadPathIsAutomatic = true;
      if (uploadPathInput) uploadPathInput.value = "./";
      updateUploadPathHint();
      clearTimeout(inputTimer); inputTimer = 0; inputQueue = [];
      const id = sessionId; sessionId = ""; outputOffset = 0; pollFailures = 0; pollStatusBeforeRetry = ""; resetWriteBackpressure();
      if (id){
        try { await fetch("/ssh-session-stop?id=" + encodeURIComponent(id), { method:"POST" }); } catch(_){}
      }
      setSessionControls(false);
      if (showMessage && terminal){
        terminal.writeln("\r\n\x1b[90m[사용자가 SSH 연결을 끊었습니다. 재접속할 수 있습니다.]\x1b[0m");
        terminalStatus.textContent = "연결 끊김";
        terminalStatus.title = "상단의 재접속 버튼을 눌러 다시 연결할 수 있습니다.";
        terminalStatus.classList.remove("error");
      }
    };

    // 멈춰 둔 폴 루프를 깨운다. 세션이 이미 끝났으면 루프가 while 조건에서 빠져나간다.
    const resumePolling = () => {
      pollPaused = false;
      const waiters = resumeWaiters; resumeWaiters = [];
      waiters.forEach((resolve) => resolve());
    };

    // 이 작업공간으로 돌아왔을 때. 열려 있던 패널만 되살리고 실제 셀 크기로 행·열을 다시 맞춘다.
    const activate = () => {
      resumePolling();
      if (!dock || !panelOpen) return;
      dock.hidden = false; divider.hidden = false;
      applyDockState();
      setTimeout(() => { sendResize(); if (terminal && !dockCollapsed) terminal.focus(); }, 80);
    };

    // 다른 작업공간으로 갔을 때. 화면에서만 내리고 세션은 그대로 살려 둔다.
    const deactivate = () => {
      // 배경 작업공간의 세션까지 초당 두 번씩 폴하면 활성 터미널과 다른 요청이 그만큼 밀린다.
      pollPaused = true;
      if (!dock) return;
      dock.hidden = true; divider.hidden = true;
      notifyLayout();
    };

    // 작업공간이 삭제될 때. 화면을 먼저 내린 뒤 세션·업로드·xterm·DOM 을 모두 정리한다.
    const destroy = async () => {
      generation++;
      resumePolling();
      panelOpen = false;
      clearTimeout(resizeTimer); resizeTimer = 0;
      if (dock) dock.hidden = true;
      if (divider) divider.hidden = true;
      notifyLayout();
      await disconnectSession(false);
      if (resizeObserver){ resizeObserver.disconnect(); resizeObserver = null; }
      if (terminal){ terminal.dispose(); terminal = null; }
      if (divider) divider.remove();
      if (dock) dock.remove();
      dock = null; divider = null;
    };

    // 새로고침처럼 페이지가 사라질 때 이 인스턴스가 들고 있는 원격 세션과 업로드를 정리한다.
    const stopForUnload = () => {
      if (remoteFiles) remoteFiles.reset();
      if (sessionId) fetch("/ssh-session-stop?id=" + encodeURIComponent(sessionId), { method:"POST", keepalive:true }).catch(() => {});
      if (uploadId) fetch("/ssh-upload-cancel?id=" + encodeURIComponent(uploadId), { method:"POST", keepalive:true }).catch(() => {});
    };

    return { open, close, sendResize, stopForUnload, activate, deactivate, destroy };
  };

  // 작업공간 id 하나당 인스턴스 하나. 터미널을 연 작업공간에만 만들어진다.
  const instances = new Map();
  // 작업공간을 알 수 없는 환경에서 쓰는 기본 id.
  const FALLBACK_WORKSPACE_ID = "main";
  let globalListenersBound = false;

  const currentWorkspaceId = () => {
    const id = typeof activeWorkspaceId === "undefined" ? "" : String(activeWorkspaceId || "");
    return id || FALLBACK_WORKSPACE_ID;
  };

  // 인스턴스 안에도 같은 이름의 sendResize 가 있다. 이쪽은 활성 인스턴스로만 넘겨주는 창 리스너용이다.
  const sendResize = () => {
    const instance = instances.get(currentWorkspaceId());
    if (instance) instance.sendResize();
  };

  // 전환 이벤트를 놓쳐도 어긋나지 않게 활성 작업공간 하나만 켜고 나머지는 모두 끈다.
  const applyActiveWorkspace = () => {
    const active = currentWorkspaceId();
    instances.forEach((instance, id) => { if (id !== active) instance.deactivate(); });
    const instance = instances.get(active);
    if (instance) instance.activate();
  };

  const forgetWorkspace = (id) => {
    const key = String(id || "");
    const instance = instances.get(key);
    if (instance){ instances.delete(key); instance.destroy(); }
    forgetDockState(key);
  };

  const bindGlobalListeners = () => {
    if (globalListenersBound) return;
    globalListenersBound = true;
    // 창 크기와 Windows 작업 표시줄의 사용 가능 영역이 바뀌면 실제 셀 크기로 PTY 행·열을 다시 맞춘다.
    window.addEventListener("resize", sendResize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", sendResize);
    window.addEventListener("beforeunload", () => { instances.forEach((instance) => instance.stopForUnload()); });
    // 작업공간 전환·삭제는 workspaces.js 가 알려 준다(이 모듈이 나중에 로드되므로 이벤트로 받는다).
    window.addEventListener("mnworkspaceswitch", applyActiveWorkspace);
    window.addEventListener("mnworkspacedelete", (event) => forgetWorkspace(event && event.detail && event.detail.id));
  };

  const instanceFor = (id) => {
    let instance = instances.get(id);
    if (!instance){
      bindGlobalListeners();
      instance = createInstance(id);
      instances.set(id, instance);
    }
    return instance;
  };

  const open = () => instanceFor(currentWorkspaceId()).open();
  const close = async () => {
    const instance = instances.get(currentWorkspaceId());
    if (instance) await instance.close();
  };

  const trigger = document.getElementById("remoteTerminalOpen");
  if (trigger) trigger.addEventListener("click", open);
  return { open, close, classifySshFailure, parseOsc7Location };
})();
