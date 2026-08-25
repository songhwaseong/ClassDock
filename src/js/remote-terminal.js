"use strict";

// EXE 전용 SSH 원격 터미널. Windows OpenSSH + ConPTY의 바이트 스트림을 xterm.js에 연결한다.
// 저장하는 값은 호스트·포트·계정·인증 방식뿐이며 비밀번호·키 암호·개인키 경로는 브라우저 저장소에 넣지 않는다.
const MNRemoteTerminal = (() => {
  const PROFILE_KEY = "classdockSshProfileV1";
  const DOCK_KEY = "classdockSshDockV2";
  const FONT_KEY = "classdockSshFontV1";
  const FONT_STACKS = {
    cascadia:'"Cascadia Mono","Cascadia Code",Consolas,"NanumGothicCoding",monospace',
    consolas:'Consolas,"Cascadia Mono","NanumGothicCoding",monospace',
    d2coding:'D2Coding,"Cascadia Mono",Consolas,"NanumGothicCoding",monospace',
    nanum:'"NanumGothicCoding","Nanum Gothic Coding","Cascadia Mono",Consolas,monospace',
    system:'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace'
  };
  const encoder = new TextEncoder();
  let dock = null, divider = null, card = null, rail = null, formView = null, terminalView = null, terminalHost = null;
  let hostInput = null, portInput = null, userInput = null, authMethodInput = null, passwordInput = null, rememberInput = null;
  let credentialLabel = null, keyField = null, keyButton = null, keyNameEl = null;
  let statusEl = null, connectButton = null, terminalTitle = null, terminalStatus = null;
  let disconnectButton = null, retryButton = null;
  let fontSelect = null, fontSizeOutput = null, lineHeightButton = null;
  let terminal = null, sessionId = "", outputOffset = 0, generation = 0, inputQueue = [];
  let inputTimer = 0, inputSending = false, resizeObserver = null, resizeTimer = 0;
  let layoutFrame = 0;
  let currentCols = 100, currentRows = 30;
  let dockSide = "right", dockWidth = 520, dockCollapsed = false;
  let fontChoice = "cascadia", terminalFontSize = 14, terminalLineHeight = 1.15;
  let diagnosticTail = "", diagnosticDecoder = new TextDecoder(), pollFailures = 0, pollStatusBeforeRetry = "";
  let selectedKeyId = "", selectedKeyName = "", keyPicking = false, keyPickGeneration = 0;

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
    if (/bad-ssh-key-passphrase/.test(raw)) return "개인키 암호가 너무 길거나 올바르지 않습니다.";
    if (/ssh-host-key-changed/.test(raw)) return "저장된 서버 지문과 새 지문이 다릅니다.";
    if (/ssh-client-not-found|Windows OpenSSH Client/.test(raw)) return "Windows OpenSSH Client가 필요합니다. Windows 선택적 기능에서 OpenSSH 클라이언트를 설치하세요.";
    if (/conpty/.test(raw)) return "이 Windows 환경에서는 대화형 터미널을 시작하지 못했습니다.";
    return raw.replace(/^.*?(?:failed|실패):\s*/i, "") || "원격 터미널을 시작하지 못했습니다.";
  };

  const savedProfile = () => {
    try {
      const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch(_){ return {}; }
  };

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
    try {
      const value = JSON.parse(localStorage.getItem(DOCK_KEY) || "null");
      if (!value || typeof value !== "object") return;
      dockSide = value.side === "left" ? "left" : "right";
      const width = Number(value.width);
      if (Number.isFinite(width)) dockWidth = Math.max(320, Math.min(900, width));
    } catch(_){}
  };

  const storeDockState = () => {
    try { localStorage.setItem(DOCK_KEY, JSON.stringify({ side:dockSide, width:Math.round(dockWidth) })); } catch(_){}
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
    if (!main || !dock || !divider) return;
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
    if (!dockCollapsed && terminal) setTimeout(() => { sendResize(); terminal.focus(); }, 80);
  };

  const beginDockResize = (event) => {
    if (dockCollapsed || event.button !== 0) return;
    event.preventDefault();
    divider.classList.add("dragging");
    const main = document.querySelector("main");
    const move = (moveEvent) => {
      const rect = main.getBoundingClientRect();
      const proposed = dockSide === "right" ? rect.right - moveEvent.clientX : moveEvent.clientX - rect.left;
      dockWidth = Math.max(320, Math.min(Math.max(320, rect.width - 320), proposed));
      main.style.setProperty("--ssh-dock-width", dockWidth + "px");
      notifyLayout();
    };
    const end = () => {
      divider.classList.remove("dragging");
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
    disconnectButton = button("연결 끊기", "btn ssh-disconnect");
    retryButton = button("재접속", "btn primary ssh-retry"); retryButton.hidden = true;
    const changeServer = button("접속 정보", "btn ssh-reconnect");
    const terminalClose = button("닫기", "btn primary ssh-terminal-close");
    terminalActions.append(terminalSwap, terminalCollapse, disconnectButton, retryButton, changeServer, terminalClose);
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
    terminalHost = document.createElement("div"); terminalHost.className = "ssh-xterm-host";
    terminalView.append(terminalHead, terminalHost);
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
    // 창 크기와 Windows 작업 표시줄의 사용 가능 영역이 바뀌면 실제 셀 크기로 PTY 행·열을 다시 맞춘다.
    window.addEventListener("resize", sendResize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", sendResize);
    window.addEventListener("beforeunload", () => {
      if (sessionId) fetch("/ssh-session-stop?id=" + encodeURIComponent(sessionId), { method:"POST", keepalive:true }).catch(() => {});
    });
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
    dock.hidden = false; divider.hidden = false; setDockCollapsed(false);
    if (sessionId){
      terminalView.hidden = false; formView.hidden = true;
      setTimeout(() => { sendResize(); if (terminal) terminal.focus(); }, 80);
      return;
    }
    showForm();
    const profile = savedProfile();
    if (!hostInput.value) hostInput.value = String(profile.host || "");
    if (portInput.value === "22" && profile.port) portInput.value = String(profile.port);
    if (!userInput.value) userInput.value = String(profile.user || "");
    if (profile.authentication === "private-key" || profile.authentication === "password") authMethodInput.value = profile.authentication;
    updateAuthenticationUi();
    passwordInput.value = "";
    try {
      if (location.protocol !== "http:" && location.protocol !== "https:") throw new Error("원격 터미널은 ClassDock.exe에서만 사용할 수 있습니다.");
      const info = await responseData(await fetchTimed("/ssh-capability", { cache:"no-store" }, 6000));
      if (!info.available) throw new Error(info.reason || "Windows OpenSSH Client가 필요합니다.");
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
    } else ok = window.confirm(message);
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
      if (!terminal || !sessionId || terminalView.hidden || dockCollapsed || dock.hidden) return;
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
    if (!inputTimer && !inputSending) inputTimer = setTimeout(flushInput, 12);
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
      if (sessionId && inputQueue.length && !inputTimer) inputTimer = setTimeout(flushInput, 12);
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
    diagnosticTail = (diagnosticTail + diagnosticDecoder.decode(bytes, { stream:true })).slice(-16000);
    const plain = stripTerminalCodes(diagnosticTail);
    if (terminalStatus && terminalStatus.textContent === "SSH 인증 중"
      && (/Welcome to |Last login:/i.test(plain) || /(?:^|\r?\n)[^\r\n]{0,120}[$#%>] $/.test(plain)))
      terminalStatus.textContent = "접속됨";
  };

  const writeTerminal = (bytes) => new Promise((resolve) => {
    const target = terminal;
    if (!target || !bytes || !bytes.length) { resolve(); return; }
    try { target.write(bytes, resolve); }
    catch(_){ resolve(); }
  });

  const finishSession = (data) => {
    try { diagnosticTail = (diagnosticTail + diagnosticDecoder.decode()).slice(-16000); } catch(_){}
    const diagnosis = classifySshFailure(diagnosticTail, data.code, !!data.stopped);
    sessionId = "";
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
        if (data.reset && outputOffset > 0 && terminal){ terminal.reset(); terminal.writeln("\x1b[33m[오래된 터미널 출력이 생략되었습니다.]\x1b[0m"); }
        const bytes = data.data ? decodeBase64(data.data) : null;
        if (bytes){ appendDiagnostic(bytes); await writeTerminal(bytes); }
        if (id !== sessionId || myGeneration !== generation) return;
        outputOffset = Number(data.offset) || outputOffset;
        if (data.complete || data.alive === false){
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
    clearTimeout(inputTimer); inputTimer = 0; inputQueue = [];
    const id = sessionId; sessionId = ""; outputOffset = 0; pollFailures = 0; pollStatusBeforeRetry = "";
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

  const trigger = document.getElementById("remoteTerminalOpen");
  if (trigger) trigger.addEventListener("click", open);
  return { open, close, classifySshFailure };
})();
