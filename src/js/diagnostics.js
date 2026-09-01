"use strict";

/* 앱 전체 공통 진단 로그.
   - 오류와 마지막 정상 화면 상태를 문서 본문 없이 남긴다.
   - EXE에서는 %LOCALAPPDATA%\ClassDock\logs 로 보내고, 서버가 없으면 작은 localStorage 순환 기록을 쓴다.
   - 화면이 완전히 멈추면 그 뒤 코드는 실행할 수 없으므로 5초 생존 신호의 마지막 성공 상태를 다음 실행에서 읽는다. */
const MNDiagnostics = (() => {
  const LOCAL_EVENTS_KEY = "classdock-diagnostics:events:v1";
  const LOCAL_SESSION_KEY = "classdock-diagnostics:session:v1";
  const LOCAL_EVENT_LIMIT = 160;
  const HEARTBEAT_MS = 5000;
  const FREEZE_GAP_MS = 15000;
  const MAX_STRING = 1200;
  const MAX_STACK = 3600;
  const root = typeof window !== "undefined" ? window : globalThis;
  const sessionId = (root.crypto && typeof root.crypto.randomUUID === "function")
    ? root.crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  const providers = new Map();
  let sequence = 0;
  let localEvents = readLocalEvents();
  let serverAvailable = null;
  let previousAbnormal = null;
  let heartbeatTimer = 0;
  let lastVisibleTick = Date.now();
  let started = false;
  let panelWired = false;
  let panelEvents = [];

  function scrubString(value, limit = MAX_STRING){
    let text = String(value == null ? "" : value);
    // 개인 폴더·쿼리 문자열·대표적인 키 형식은 오류 메시지나 stack에 섞여도 로그에 남기지 않는다.
    text = text.replace(/[A-Za-z]:\\(?:[^\s"'<>|]+\\)*[^\s"'<>|]*/g, "[경로]");
    text = text.replace(/\/(?:Users|home)\/[^\s"'<>]+/gi, "[경로]");
    text = text.replace(/([?&](?:token|key|secret|password|auth)=)[^&#\s]+/gi, "$1[제외]");
    text = text.replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[키 제외]");
    text = text.replace(/\b[A-Za-z0-9+/]{180,}={0,2}\b/g, "[긴 데이터 제외]");
    return text.length > limit ? text.slice(0, limit) + "…" : text;
  }

  function privateKey(key){
    return /(?:password|passwd|secret|token|api.?key|authorization|cookie|document.?text|source|content|body|code)/i.test(String(key || ""));
  }

  function sanitize(value, key = "", depth = 0, seen){
    if (privateKey(key)) return "[제외]";
    if (value == null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "string") return scrubString(value, key === "stack" ? MAX_STACK : MAX_STRING);
    if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
    if (depth >= 4) return "[깊이 제한]";
    const visited = seen || new Set();
    if (typeof value === "object"){
      if (visited.has(value)) return "[순환 참조]";
      visited.add(value);
    }
    if (Array.isArray(value)){
      const out = value.slice(0, 24).map((item) => sanitize(item, key, depth + 1, visited));
      if (value.length > 24) out.push(`[${value.length - 24}개 생략]`);
      return out;
    }
    if (value instanceof Error){
      return { name:scrubString(value.name, 100), message:scrubString(value.message), stack:scrubString(value.stack || "", MAX_STACK) };
    }
    const out = {};
    let count = 0;
    for (const itemKey of Object.keys(value || {})){
      if (count++ >= 32){ out._truncated = true; break; }
      try { out[scrubString(itemKey, 80)] = sanitize(value[itemKey], itemKey, depth + 1, visited); }
      catch(_){ out[scrubString(itemKey, 80)] = "[읽기 실패]"; }
    }
    return out;
  }

  function extensionOnly(name){
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,12})$/);
    return match ? match[1] : "";
  }

  function baseContext(){
    const context = {
      screen:"home",
      visibility:(typeof document !== "undefined" && document.visibilityState) || "unknown"
    };
    try {
      if (typeof state !== "undefined" && state){
        context.screen = scrubString(state.kind || "document", 40);
        context.extension = extensionOnly(state.name || state.fileName);
        context.dirty = !!state.dirty;
      }
      if (typeof docs !== "undefined" && Array.isArray(docs)) context.openDocuments = docs.length;
    } catch(_){}
    try {
      if (typeof document !== "undefined"){
        context.running = !!document.querySelector(".is-running");
        context.fullscreen = !!(document.fullscreenElement || document.body.classList.contains("viewer-fullscreen"));
        context.splitView = !!document.body.classList.contains("study-mode");
      }
    } catch(_){}
    try {
      const memory = root.performance && root.performance.memory;
      if (memory && Number.isFinite(memory.usedJSHeapSize)){
        context.jsHeapMb = Math.round(memory.usedJSHeapSize / 1048576);
        context.jsHeapLimitMb = Math.round(memory.jsHeapSizeLimit / 1048576);
      }
    } catch(_){}
    for (const [name, provider] of providers){
      try { context[name] = sanitize(provider(), name); }
      catch(error){ context[name] = { providerError:scrubString(error && error.message || error) }; }
    }
    return sanitize(context);
  }

  function readJson(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; }
    catch(_){ return fallback; }
  }

  function readLocalEvents(){
    const rows = readJson(LOCAL_EVENTS_KEY, []);
    return Array.isArray(rows) ? rows.slice(-LOCAL_EVENT_LIMIT).filter((row) => row && row.id && row.at) : [];
  }

  function saveLocalEvents(){
    try { localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(localEvents.slice(-LOCAL_EVENT_LIMIT))); }
    catch(_){}
  }

  function saveLocalSession(session){
    try { localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session)); }
    catch(_){}
  }

  function diagnosticEvent(level, type, message, details){
    return sanitize({
      version:1,
      id:sessionId + ":" + (++sequence),
      sessionId,
      at:new Date().toISOString(),
      level:["error", "warn", "info"].includes(level) ? level : "info",
      type:scrubString(type || "event", 100),
      message:scrubString(message || type || "이벤트"),
      context:baseContext(),
      details:sanitize(details || {})
    });
  }

  function postJson(path, value, keepalive){
    if (typeof root.fetch !== "function") return Promise.reject(new Error("fetch-unavailable"));
    return root.fetch(path, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body:JSON.stringify(value), cache:"no-store", keepalive:!!keepalive
    }).then((response) => {
      if (!response || !response.ok) throw new Error("HTTP " + (response && response.status));
      serverAvailable = true;
      return true;
    }).catch((error) => { serverAvailable = false; throw error; });
  }

  function record(level, type, message, details){
    const event = diagnosticEvent(level, type, message, details);
    localEvents.push(event);
    if (localEvents.length > LOCAL_EVENT_LIMIT) localEvents.splice(0, localEvents.length - LOCAL_EVENT_LIMIT);
    // The desktop log file is the primary store. Keep localStorage writes only
    // as a browser/offline fallback so diagnostics do not churn app-state saves.
    if (serverAvailable !== true) saveLocalEvents();
    postJson("/diagnostics/events", event, level === "error").catch(() => { saveLocalEvents(); });
    return event;
  }

  function errorDetails(error, extra){
    const details = Object.assign({}, extra || {});
    if (error instanceof Error){
      details.name = error.name;
      details.message = error.message;
      details.stack = error.stack || "";
    } else details.reason = error;
    return details;
  }

  function sessionSnapshot(status){
    return sanitize({
      version:1, sessionId, status:status || "active", at:new Date().toISOString(),
      lastEventId:localEvents.length ? localEvents[localEvents.length - 1].id : "",
      context:baseContext()
    });
  }

  function writeSession(status, keepalive){
    const session = sessionSnapshot(status);
    return postJson("/diagnostics/session", session, keepalive).catch(() => { saveLocalSession(session); return false; });
  }

  async function readPreviousSession(){
    let previous = null;
    try {
      const response = await root.fetch("/diagnostics/session", { cache:"no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      previous = await response.json();
      serverAvailable = true;
    } catch(_){
      serverAvailable = false;
      previous = readJson(LOCAL_SESSION_KEY, null);
    }
    const when = previous && Date.parse(previous.at);
    if (previous && previous.sessionId && previous.sessionId !== sessionId && previous.status === "active"
      && Number.isFinite(when) && Date.now() - when > FREEZE_GAP_MS){
      previousAbnormal = sanitize(previous);
      record("warn", "previous_session_abnormal", "직전 실행이 정상 종료되지 않았습니다.", {
        lastSeenAt:previous.at, lastContext:previous.context
      });
      try { root.dispatchEvent(new CustomEvent("mndiagnosticsabnormal", { detail:previousAbnormal })); } catch(_){}
    }
    await writeSession("active", false);
  }

  function heartbeat(){
    const now = Date.now();
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    if (visible && now - lastVisibleTick > FREEZE_GAP_MS){
      record("warn", "main_thread_gap", "화면 응답이 잠시 멈췄다가 복구되었습니다.", {
        gapMs:now - lastVisibleTick
      });
    }
    lastVisibleTick = now;
    writeSession("active", false);
  }

  function install(){
    if (started) return;
    started = true;
    if (typeof root.addEventListener === "function"){
      root.addEventListener("error", (event) => {
        record("error", "javascript_error", event && event.message || "JavaScript 오류", errorDetails(event && event.error, {
          file:event && event.filename ? String(event.filename).split("/").pop() : "",
          line:event && event.lineno, column:event && event.colno
        }));
      });
      root.addEventListener("unhandledrejection", (event) => {
        const reason = event && event.reason;
        record("error", "unhandled_rejection", reason && reason.message || "처리되지 않은 비동기 오류", errorDetails(reason));
      });
      root.addEventListener("visibilitychange", () => { lastVisibleTick = Date.now(); });
      root.addEventListener("pagehide", () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        const closed = sessionSnapshot("closed");
        saveLocalSession(closed);
        postJson("/diagnostics/session", closed, true).catch(() => {});
      }, { once:true });
    }
    readPreviousSession().catch(() => {});
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  }

  function registerContext(name, provider){
    if (!name || typeof provider !== "function") return () => {};
    providers.set(String(name), provider);
    return () => providers.delete(String(name));
  }

  function mergedEvents(serverEvents){
    const map = new Map();
    for (const event of [...(Array.isArray(serverEvents) ? serverEvents : []), ...localEvents]){
      if (event && event.id) map.set(event.id, sanitize(event));
    }
    return [...map.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  async function loadEvents(){
    let serverEvents = [];
    try {
      const response = await root.fetch("/diagnostics/events?limit=700", { cache:"no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      serverEvents = await response.json();
      serverAvailable = true;
    } catch(_){ serverAvailable = false; }
    return mergedEvents(serverEvents);
  }

  function eventLabel(type){
    return ({
      javascript_error:"JavaScript 오류",
      unhandled_rejection:"비동기 오류",
      previous_session_abnormal:"비정상 종료",
      main_thread_gap:"화면 멈춤 후 복구",
      document_active:"화면 전환",
      music_playback_start:"악보 재생 시작",
      music_playback_pause:"악보 일시정지",
      music_playback_resume:"악보 이어서 재생",
      music_playback_end:"악보 재생 종료"
    })[type] || type || "기록";
  }

  function filterPanelEvents(){
    const level = document.getElementById("diagnosticLevelFilter").value;
    const screen = document.getElementById("diagnosticScreenFilter").value;
    const query = document.getElementById("diagnosticSearch").value.trim().toLowerCase();
    return panelEvents.filter((event) => {
      const eventScreen = event.context && event.context.screen || "home";
      if (level && event.level !== level) return false;
      if (screen && eventScreen !== screen) return false;
      if (query && !(`${event.type} ${event.message} ${eventScreen}`.toLowerCase().includes(query))) return false;
      return true;
    });
  }

  function renderPanel(){
    if (typeof document === "undefined") return;
    const list = document.getElementById("diagnosticLogList");
    if (!list) return;
    const rows = filterPanelEvents().slice().reverse();
    list.replaceChildren();
    const status = document.getElementById("diagnosticStatus");
    const errors = panelEvents.filter((event) => event.level === "error").length;
    const warnings = panelEvents.filter((event) => event.level === "warn").length;
    status.textContent = `${panelEvents.length}건 · 오류 ${errors} · 경고 ${warnings} · ${serverAvailable ? "로컬 로그 연결됨" : "브라우저 임시 로그"}`;
    const empty = document.getElementById("diagnosticEmpty");
    empty.hidden = rows.length > 0;
    for (const event of rows){
      const details = document.createElement("details");
      details.className = "diagnostic-log diagnostic-" + event.level;
      const summary = document.createElement("summary");
      const time = document.createElement("time");
      const parsed = new Date(event.at);
      time.textContent = Number.isNaN(parsed.getTime()) ? String(event.at || "") : parsed.toLocaleString();
      const badge = document.createElement("span");
      badge.className = "diagnostic-level";
      badge.textContent = event.level === "error" ? "오류" : event.level === "warn" ? "경고" : "정보";
      const title = document.createElement("strong");
      title.textContent = eventLabel(event.type);
      const message = document.createElement("span");
      message.className = "diagnostic-message";
      message.textContent = event.message || "";
      const screen = document.createElement("span");
      screen.className = "diagnostic-screen";
      screen.textContent = event.context && event.context.screen || "home";
      summary.append(time, badge, title, message, screen);
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(event, null, 2);
      details.append(summary, pre);
      list.appendChild(details);
    }
  }

  function syncScreenFilter(){
    const select = document.getElementById("diagnosticScreenFilter");
    if (!select) return;
    const current = select.value;
    const screens = [...new Set(panelEvents.map((event) => event.context && event.context.screen || "home"))].sort();
    select.replaceChildren(new Option("모든 화면", ""), ...screens.map((screen) => new Option(screen, screen)));
    if (screens.includes(current)) select.value = current;
  }

  async function refreshPanel(){
    const status = typeof document !== "undefined" && document.getElementById("diagnosticStatus");
    if (status) status.textContent = "진단 로그를 읽는 중…";
    panelEvents = await loadEvents();
    syncScreenFilter();
    const abnormal = document.getElementById("diagnosticAbnormal");
    if (abnormal){
      abnormal.hidden = !previousAbnormal;
      if (previousAbnormal) abnormal.textContent = `직전 실행이 정상 종료되지 않았습니다. 마지막 정상 기록: ${new Date(previousAbnormal.at).toLocaleString()}`;
    }
    renderPanel();
    return panelEvents;
  }

  function exportText(events){
    return JSON.stringify({
      format:"classdock-diagnostics", version:1, exportedAt:new Date().toISOString(),
      privacy:"문서 본문·코드·API 키·개인 경로 제외", events:events || panelEvents
    }, null, 2);
  }

  async function copyText(text){
    if (navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return; }
    const area = document.createElement("textarea");
    area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
  }

  function downloadText(text){
    const blob = new Blob([text], { type:"application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `ClassDock-진단로그-${stamp}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function wireSettings(){
    if (panelWired || typeof document === "undefined") return;
    const list = document.getElementById("diagnosticLogList");
    if (!list) return;
    panelWired = true;
    for (const id of ["diagnosticLevelFilter", "diagnosticScreenFilter", "diagnosticSearch"]){
      const el = document.getElementById(id);
      el.addEventListener(id === "diagnosticSearch" ? "input" : "change", renderPanel);
    }
    const tab = document.querySelector('[data-settings-tab="diagnostics"]');
    if (tab) tab.addEventListener("click", () => setTimeout(refreshPanel, 0));
    document.getElementById("diagnosticRefresh").addEventListener("click", refreshPanel);
    document.getElementById("diagnosticCopy").addEventListener("click", async () => {
      try { await copyText(exportText(filterPanelEvents())); if (typeof toast === "function") toast("진단 로그를 복사했습니다.", 2200); }
      catch(_){ if (typeof toast === "function") toast("진단 로그를 복사하지 못했습니다.", 2400); }
    });
    document.getElementById("diagnosticSave").addEventListener("click", () => downloadText(exportText(filterPanelEvents())));
    document.getElementById("diagnosticOpenFolder").addEventListener("click", async () => {
      try {
        const response = await root.fetch("/diagnostics/open-folder", { method:"POST", headers:{ "X-ClassDock-Action":"1" } });
        if (!response.ok) throw new Error("HTTP " + response.status);
      } catch(_){ if (typeof toast === "function") toast("로그 폴더는 ClassDock.exe에서 열 수 있습니다.", 2600); }
    });
    document.getElementById("diagnosticClear").addEventListener("click", async () => {
      if (typeof confirmDialog !== "function") return;
      const ok = await confirmDialog("저장된 진단 로그를 모두 지울까요?", "로그 지우기", "취소");
      if (!ok) return;
      if (serverAvailable){
        try {
          const response = await root.fetch("/diagnostics/clear", { method:"POST" });
          if (!response.ok) throw new Error("HTTP " + response.status);
        } catch(_){
          if (typeof toast === "function") toast("로컬 진단 로그를 지우지 못했습니다.", 2500);
          return;
        }
      }
      localEvents = [];
      previousAbnormal = null;
      try { localStorage.removeItem(LOCAL_EVENTS_KEY); } catch(_){}
      await refreshPanel();
      if (typeof toast === "function") toast("진단 로그를 지웠습니다.", 2200);
    });
  }

  install();
  return {
    info:(type, message, details) => record("info", type, message, details),
    warn:(type, message, details) => record("warn", type, message, details),
    error:(type, message, error, details) => record("error", type, message, errorDetails(error, details)),
    registerContext, context:baseContext, sanitize, scrubString, loadEvents, refreshPanel, wireSettings,
    previousAbnormal:() => previousAbnormal, sessionId:() => sessionId,
    _test:{ mergedEvents, diagnosticEvent, sessionSnapshot, extensionOnly, eventLabel }
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNDiagnostics;
