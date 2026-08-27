"use strict";

/* 오프라인 한국어 맞춤법 검사.
   브라우저 사전이나 외부 API에 의존하지 않고, 확실성이 높은 상용 표현·띄어쓰기 규칙만 검사한다.
   UI와 규칙 엔진을 분리해 나중에 더 정교한 로컬 엔진으로 check()만 교체할 수 있다. */
const MNKoreanSpellcheck = (() => {
  const STORAGE_KEY = "classdock-korean-spell-user-dictionary-v1";
  const MAX_SCOPE_CHARS = 240000;
  const DICTIONARY_WORKER_TIMEOUT = 45000;
  const HASH_COMMENT_EXTS = new Set([
    "py","pyi","rb","sh","bash","zsh","ps1","yaml","yml","toml","ini","env","properties","conf",
    "r","pl","pm","tcl","awk","cmake","makefile","mk"
  ]);
  const SQL_COMMENT_EXTS = new Set(["sql"]);
  const HTML_COMMENT_EXTS = new Set(["html","htm","xhtml","xml","xsl","xslt","xsd","rss","atom","svg"]);

  const makeRule = (id, pattern, replacement, message, category="맞춤법") =>
    Object.freeze({ id, pattern, replacement, message, category });

  // 문맥에 따라 달라질 수 있는 표현은 제외하고, 오탐 가능성이 낮은 규칙만 둔다.
  const RULES = Object.freeze([
    makeRule("dwaeyo", /되요/g, "돼요", "'되어요'가 줄면 '돼요'로 씁니다."),
    makeRule("dwaet", /됬/g, "됐", "'되었'이 줄어든 말은 '됐'으로 씁니다."),
    makeRule("boeyo", /뵈요/g, "봬요", "'뵈어요'가 줄면 '봬요'로 씁니다."),
    makeRule("myeochil", /몇일/g, "며칠", "날짜를 나타낼 때는 '며칠'로 씁니다."),
    makeRule("eotteokhae", /어떻해/g, "어떻게", "'어떻게'가 올바른 표현입니다."),
    makeRule("geumse", /금새/g, "금세", "'지금 바로'라는 뜻은 '금세'로 씁니다."),
    makeRule("oraenman", /오랫만/g, "오랜만", "'오랜만'이 올바른 표현입니다."),
    makeRule("huihan", /희안/g, "희한", "'희한하다'로 씁니다."),
    makeRule("seolgeoji", /설겆이/g, "설거지", "'설거지'가 표준어입니다."),
    makeRule("eoi", /어의없/g, "어이없", "'어이없다'로 씁니다."),
    makeRule("yeokhal", /역활/g, "역할", "'역할'이 올바른 표현입니다."),
    makeRule("daega", /댓가/g, "대가", "'대가'로 씁니다."),
    makeRule("mueot", /무었/g, "무엇", "'무엇'이 올바른 표현입니다."),
    makeRule("kkaekkeusi", /깨끗히/g, "깨끗이", "'깨끗이'로 씁니다."),
    makeRule("gomgomi", /곰곰히/g, "곰곰이", "'곰곰이'로 씁니다."),
    makeRule("ilili", /일일히/g, "일일이", "'일일이'로 씁니다."),
    makeRule("teumteumi", /틈틈히/g, "틈틈이", "'틈틈이'로 씁니다."),
    makeRule("waenil", /왠일/g, "웬일", "'어찌 된 일'이라는 뜻은 '웬일'로 씁니다."),
    makeRule("waenji", /웬지/g, "왠지", "'왜인지'가 줄어든 말은 '왠지'로 씁니다."),
    makeRule("halge", /(할|갈|볼|줄|올|쓸)께/g, "$1게", "약속이나 의지를 나타내는 종결 어미는 '-ㄹ게'로 씁니다."),
    makeRule("geoyeyo", /거에요/g, "거예요", "'것이에요'가 줄면 '거예요'로 씁니다."),
    makeRule("ieyo", /이예요/g, "이에요", "받침 있는 말 뒤에는 '이에요'를 씁니다."),
    makeRule("aniyeyo", /아니예요/g, "아니에요", "'아니에요'가 올바른 표현입니다."),
    makeRule("an-doe", /않되/g, "안 되", "부정의 뜻이면 '안 되다'로 씁니다."),
    makeRule("an-dwae", /않돼/g, "안 돼", "부정의 뜻이면 '안 돼'로 씁니다."),
    makeRule("bakkwieot", /바꼈/g, "바뀌었", "'바뀌었'으로 씁니다."),
    makeRule("haryeogo", /할려고/g, "하려고", "'하려고'가 올바른 표현입니다."),
    makeRule("garyeogo", /갈려고/g, "가려고", "'가려고'가 올바른 표현입니다."),
    makeRule("boryeogo", /볼려고/g, "보려고", "'보려고'가 올바른 표현입니다."),
    makeRule("meogeuryeogo", /먹을려고/g, "먹으려고", "'먹으려고'가 올바른 표현입니다."),
    makeRule("su-spacing", /(할|될|갈|볼|먹을|읽을|쓸|만날)수\s*(있|없)/g, "$1 수 $2",
      "의존 명사 '수'는 앞뒤 말과 띄어 씁니다.", "띄어쓰기"),
    makeRule("ji-spacing", /(한|두|세|몇)지\s*(년|달|주|일|시간|분)/g, "$1 지 $2",
      "시간의 경과를 나타내는 '지'는 앞말과 띄어 씁니다.", "띄어쓰기"),
    makeRule("daero-spacing", /(하는|말한|생각한|배운|본)데로/g, "$1 대로",
      "'그 모양과 같이'라는 뜻의 '대로'는 앞말과 띄어 씁니다.", "띄어쓰기")
  ]);

  function cloneRegex(regex, global=true){
    let flags = regex.flags.replace(/g/g, "");
    if (global) flags += "g";
    return new RegExp(regex.source, flags);
  }

  function replacementFor(rule, matched){
    if (typeof rule.replacement === "function") return String(rule.replacement(matched));
    return matched.replace(cloneRegex(rule.pattern, false), rule.replacement);
  }

  function normalizeRange(start, end, length){
    const s = Math.max(0, Math.min(Number(start) || 0, length));
    const e = Math.max(s, Math.min(end == null ? length : Number(end) || 0, length));
    return { start:s, end:e };
  }

  function complementRanges(length, excluded, scopeStart=0, scopeEnd=length){
    const normalized = excluded
      .map(r => normalizeRange(r.start, r.end, length))
      .filter(r => r.end > r.start && r.end > scopeStart && r.start < scopeEnd)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const range of normalized){
      const clipped = { start:Math.max(scopeStart, range.start), end:Math.min(scopeEnd, range.end) };
      const last = merged[merged.length - 1];
      if (last && clipped.start <= last.end) last.end = Math.max(last.end, clipped.end);
      else merged.push(clipped);
    }
    const out = [];
    let cursor = scopeStart;
    for (const range of merged){
      if (cursor < range.start) out.push({ start:cursor, end:range.start });
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < scopeEnd) out.push({ start:cursor, end:scopeEnd });
    return out;
  }

  function markdownRanges(text, scopeStart=0, scopeEnd=text.length){
    const excluded = [];
    const patterns = [
      /^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm,
      /`[^`\n]*`/g,
      /!\[[^\]]*\]\([^)]+\)/g
    ];
    for (const pattern of patterns){
      let match;
      while ((match = pattern.exec(text))) excluded.push({ start:match.index, end:match.index + match[0].length });
    }
    return complementRanges(text.length, excluded, scopeStart, scopeEnd);
  }

  function codeRanges(text, ext="", scopeStart=0, scopeEnd=text.length){
    ext = String(ext || "").toLowerCase();
    const ranges = [];
    const hashComment = HASH_COMMENT_EXTS.has(ext);
    const sqlComment = SQL_COMMENT_EXTS.has(ext);
    const htmlComment = HTML_COMMENT_EXTS.has(ext);
    const push = (start, end) => {
      start = Math.max(start, scopeStart); end = Math.min(end, scopeEnd);
      if (end > start && /[가-힣]/.test(text.slice(start, end))) ranges.push({ start, end });
    };
    let i = 0;
    while (i < text.length){
      if (htmlComment && text.startsWith("<!--", i)){
        const endAt = text.indexOf("-->", i + 4);
        const end = endAt < 0 ? text.length : endAt;
        push(i + 4, end); i = endAt < 0 ? text.length : endAt + 3; continue;
      }
      if (hashComment && text[i] === "#"){
        const end = text.indexOf("\n", i + 1);
        push(i + 1, end < 0 ? text.length : end); i = end < 0 ? text.length : end + 1; continue;
      }
      if (sqlComment && text.startsWith("--", i)){
        const end = text.indexOf("\n", i + 2);
        push(i + 2, end < 0 ? text.length : end); i = end < 0 ? text.length : end + 1; continue;
      }
      if (text.startsWith("//", i)){
        const end = text.indexOf("\n", i + 2);
        push(i + 2, end < 0 ? text.length : end); i = end < 0 ? text.length : end + 1; continue;
      }
      if (text.startsWith("/*", i)){
        const endAt = text.indexOf("*/", i + 2);
        const end = endAt < 0 ? text.length : endAt;
        push(i + 2, end); i = endAt < 0 ? text.length : endAt + 2; continue;
      }
      const quote = text[i];
      if (quote === "'" || quote === '"' || quote === "`"){
        const triple = quote !== "`" && text.slice(i, i + 3) === quote.repeat(3);
        const delimiter = triple ? quote.repeat(3) : quote;
        const contentStart = i + delimiter.length;
        let j = contentStart;
        while (j < text.length){
          if (!triple && text[j] === "\\"){ j += 2; continue; }
          if (text.startsWith(delimiter, j)) break;
          j++;
        }
        push(contentStart, j);
        i = j < text.length ? j + delimiter.length : text.length;
        continue;
      }
      i++;
    }
    return ranges;
  }

  function rangesFor(text, mode, ext, scopeStart, scopeEnd){
    if (mode === "markdown") return markdownRanges(text, scopeStart, scopeEnd);
    if (mode === "code") return codeRanges(text, ext, scopeStart, scopeEnd);
    return scopeEnd > scopeStart ? [{ start:scopeStart, end:scopeEnd }] : [];
  }

  function readUserDictionary(){
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return new Set(Array.isArray(value) ? value.filter(v => typeof v === "string" && v.length <= 100) : []);
    } catch(_){ return new Set(); }
  }

  function writeUserDictionary(words){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...words].sort())); } catch(_){}
  }

  function check(text, options={}){
    text = String(text == null ? "" : text);
    const scope = normalizeRange(options.start || 0, options.end == null ? text.length : options.end, text.length);
    const ignored = options.ignored instanceof Set ? options.ignored : new Set(options.ignored || []);
    const ranges = rangesFor(text, options.mode || "plain", options.fileExt || "", scope.start, scope.end);
    const issues = [];
    for (const range of ranges){
      const fragment = text.slice(range.start, range.end);
      for (const rule of RULES){
        const regex = cloneRegex(rule.pattern, true);
        let match;
        while ((match = regex.exec(fragment))){
          const original = match[0];
          if (!original){ regex.lastIndex++; continue; }
          if (ignored.has(original)) continue;
          const start = range.start + match.index;
          issues.push({
            id:rule.id + ":" + start,
            ruleId:rule.id,
            start,
            end:start + original.length,
            original,
            suggestions:[replacementFor(rule, original)],
            message:rule.message,
            category:rule.category
          });
        }
      }
    }
    issues.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId));
    const seen = new Set();
    return issues.filter(issue => {
      const key = issue.start + ":" + issue.end + ":" + issue.original;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeIssues(ruleIssues, dictionaryIssues){
    const primary = Array.isArray(ruleIssues) ? ruleIssues : [];
    const secondary = (Array.isArray(dictionaryIssues) ? dictionaryIssues : []).filter(candidate =>
      !primary.some(issue => candidate.start < issue.end && candidate.end > issue.start)
    );
    const combined = [...primary, ...secondary];
    combined.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId));
    return combined;
  }

  let dictionaryWorker = null;
  let dictionaryWorkerUrl = "";
  let dictionaryRequestId = 0;
  const dictionaryRequests = new Map();

  function rejectDictionaryRequests(error){
    for (const request of dictionaryRequests.values()){
      clearTimeout(request.timer);
      request.reject(error);
    }
    dictionaryRequests.clear();
  }

  function resetDictionaryWorker(){
    if (dictionaryWorker) dictionaryWorker.terminate();
    dictionaryWorker = null;
    if (dictionaryWorkerUrl && typeof URL !== "undefined") URL.revokeObjectURL(dictionaryWorkerUrl);
    dictionaryWorkerUrl = "";
  }

  function ensureDictionaryWorker(){
    if (dictionaryWorker) return dictionaryWorker;
    if (typeof Worker !== "function" || typeof Blob !== "function" || typeof URL === "undefined"){
      throw new Error("이 환경에서는 오프라인 한국어 사전 Worker를 사용할 수 없습니다.");
    }
    const source = typeof window !== "undefined" && window.__MN_KOREAN_HUNSPELL_WORKER_SOURCE__;
    if (!source) throw new Error("내장 한국어 사전이 포함되지 않았습니다.");
    dictionaryWorkerUrl = URL.createObjectURL(new Blob([source], { type:"text/javascript" }));
    dictionaryWorker = new Worker(dictionaryWorkerUrl);
    dictionaryWorker.addEventListener("message", event => {
      const payload = event.data || {};
      const request = dictionaryRequests.get(payload.requestId);
      if (!request) return;
      dictionaryRequests.delete(payload.requestId);
      clearTimeout(request.timer);
      if (payload.type === "error") request.reject(new Error(payload.message || "한국어 사전 검사 실패"));
      else request.resolve({ issues:Array.isArray(payload.issues) ? payload.issues : [], truncated:!!payload.truncated });
    });
    dictionaryWorker.addEventListener("error", event => {
      const error = new Error(event && event.message || "한국어 사전 Worker 오류");
      rejectDictionaryRequests(error);
      resetDictionaryWorker();
    });
    return dictionaryWorker;
  }

  /* 사전(hunspell) 본체는 3MB가 넘어 시작할 때 싣지 않는다. 맞춤법 검사를 처음 실행하는
     이 시점에 MNLazy 가 한 번만 불러온다. 부르는 쪽은 이미 "기본 규칙 먼저 → 사전 결과 나중"
     흐름이라, 로드에 걸리는 시간이 편집을 막지 않는다. */
  async function checkWithDictionary(text, options={}){
    if (typeof MNLazy !== "undefined"){
      try { await MNLazy.need("spellcheck"); }
      catch(_){ throw new Error("오프라인 한국어 사전을 불러오지 못했습니다."); }
    }
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = ensureDictionaryWorker(); }
      catch(error){ reject(error); return; }
      const requestId = ++dictionaryRequestId;
      const timer = setTimeout(() => {
        dictionaryRequests.delete(requestId);
        reject(new Error("한국어 사전 검사 시간이 초과되었습니다."));
      }, DICTIONARY_WORKER_TIMEOUT);
      dictionaryRequests.set(requestId, { resolve, reject, timer });
      worker.postMessage({
        type:"check",
        requestId,
        text:String(text == null ? "" : text),
        ranges:Array.isArray(options.ranges) ? options.ranges : [],
        ignored:[...(options.ignored instanceof Set ? options.ignored : new Set(options.ignored || []))]
      });
    });
  }

  function contextSnippet(text, issue){
    const lineStart = text.lastIndexOf("\n", issue.start - 1) + 1;
    let lineEnd = text.indexOf("\n", issue.end);
    if (lineEnd < 0) lineEnd = text.length;
    const start = Math.max(lineStart, issue.start - 35);
    const end = Math.min(lineEnd, issue.end + 35);
    return (start > lineStart ? "…" : "") + text.slice(start, end) + (end < lineEnd ? "…" : "");
  }

  let panel = null;
  let activeController = null;
  let activeIssues = [];
  let activeIndex = -1;

  function element(tag, className, text){
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  const tr = text => (typeof window !== "undefined" && typeof window.t === "function" ? window.t(text) : text);

  function ensurePanel(){
    if (panel && panel.root.isConnected) return panel;
    const root = element("section", "spellcheck-panel");
    root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "맞춤법 검사");
    const head = element("header", "spellcheck-head");
    const title = element("strong", "spellcheck-title", "맞춤법 검사");
    const count = element("span", "spellcheck-count", "0개");
    const close = element("button", "spellcheck-close", "×");
    close.type = "button"; close.title = "맞춤법 검사 닫기"; close.setAttribute("aria-label", close.title);
    head.append(title, count, close);
    const scope = element("div", "spellcheck-scope");
    const empty = element("div", "spellcheck-empty", "검사할 내용을 선택하고 맞춤법 버튼을 눌러 주세요.");
    const issue = element("div", "spellcheck-issue");
    const category = element("span", "spellcheck-category");
    const original = element("strong", "spellcheck-original");
    const message = element("p", "spellcheck-message");
    const snippet = element("pre", "spellcheck-snippet");
    const suggestions = element("div", "spellcheck-suggestions");
    issue.append(category, original, message, snippet, suggestions);
    const nav = element("div", "spellcheck-nav");
    const prev = element("button", "", "이전");
    const next = element("button", "", "다음");
    const recheck = element("button", "", "다시 검사");
    const ignore = element("button", "", "이번만 무시");
    const alwaysIgnore = element("button", "", "사용자 사전에 추가");
    const reset = element("button", "spellcheck-reset", "사용자 사전 비우기");
    [prev, next, recheck, ignore, alwaysIgnore, reset].forEach(button => { button.type = "button"; });
    nav.append(prev, next, recheck, ignore, alwaysIgnore, reset);
    root.append(head, scope, empty, issue, nav);
    document.body.appendChild(root);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(root);
    panel = { root, title, count, close, scope, empty, issue, category, original, message, snippet, suggestions,
      prev, next, recheck, ignore, alwaysIgnore, reset };

    close.addEventListener("click", closePanel);
    prev.addEventListener("click", () => selectIssue(activeIndex - 1));
    next.addEventListener("click", () => selectIssue(activeIndex + 1));
    recheck.addEventListener("click", () => { if (activeController) activeController.run(true); });
    ignore.addEventListener("click", () => {
      if (!activeController || activeIndex < 0) return;
      activeController.sessionIgnored.add(activeIssues[activeIndex].id);
      activeIssues.splice(activeIndex, 1);
      if (!activeIssues.length) activeIndex = -1;
      else activeIndex = Math.min(activeIndex, activeIssues.length - 1);
      renderPanel();
    });
    alwaysIgnore.addEventListener("click", () => {
      if (!activeController || activeIndex < 0) return;
      const word = activeIssues[activeIndex].original;
      const words = readUserDictionary(); words.add(word); writeUserDictionary(words);
      activeController.run(false);
    });
    reset.addEventListener("click", async () => {
      const words = readUserDictionary();
      if (!words.size) return;
      const ok = typeof confirmDialog === "function"
        && await confirmDialog(tr("맞춤법 사용자 사전을 모두 비울까요?"), tr("지우기"), tr("취소"));
      if (!ok) return;
      writeUserDictionary(new Set());
      if (activeController) activeController.run(false);
    });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape"){ event.preventDefault(); closePanel(); }
    });
    return panel;
  }

  function closePanel(restoreFocus=true){
    if (!panel) return;
    const previous = activeController;
    panel.root.hidden = true;
    if (previous) previous.button.setAttribute("aria-pressed", "false");
    activeController = null; activeIssues = []; activeIndex = -1;
    if (restoreFocus && previous && previous.textarea.isConnected){
      try { previous.textarea.focus({ preventScroll:true }); } catch(_){}
    }
  }

  function selectIssue(index){
    if (!activeIssues.length){ activeIndex = -1; renderPanel(); return; }
    activeIndex = (index + activeIssues.length) % activeIssues.length;
    renderPanel();
    const issue = activeIssues[activeIndex];
    if (activeController) activeController.focusIssue(issue);
  }

  function renderPanel(){
    const ui = ensurePanel();
    const has = activeIndex >= 0 && activeIssues[activeIndex];
    ui.count.textContent = activeIssues.length + "개";
    ui.empty.hidden = !!has;
    ui.issue.hidden = !has;
    ui.prev.disabled = ui.next.disabled = ui.ignore.disabled = ui.alwaysIgnore.disabled = !has;
    ui.reset.disabled = readUserDictionary().size === 0;
    if (!activeController){
      ui.scope.textContent = "";
      ui.empty.textContent = tr("검사할 내용을 선택하고 맞춤법 버튼을 눌러 주세요.");
      return;
    }
    ui.title.textContent = activeController.label || "맞춤법 검사";
    ui.scope.textContent = activeController.scopeLabel;
    if (!has){
      if (activeController.dictionaryPending)
        ui.empty.textContent = tr("기본 규칙 검사를 마쳤습니다. 한국어 사전을 불러오는 중입니다.");
      else if (activeController.dictionaryError)
        ui.empty.textContent = tr("기본 규칙에서 오류가 없습니다. 한국어 사전 검사는 사용할 수 없습니다.");
      else ui.empty.textContent = tr("검사 범위에서 발견된 오류가 없습니다.");
      return;
    }
    const current = activeIssues[activeIndex];
    ui.category.textContent = tr(current.category);
    ui.original.textContent = current.original;
    ui.message.textContent = current.message;
    ui.snippet.textContent = contextSnippet(activeController.textarea.value, current);
    ui.suggestions.replaceChildren();
    current.suggestions.forEach(suggestion => {
      const button = element("button", "spellcheck-suggestion", suggestion);
      button.type = "button";
      button.addEventListener("click", () => activeController.apply(current, suggestion));
      ui.suggestions.appendChild(button);
    });
  }

  function scopeForTextarea(textarea){
    const text = textarea.value;
    const selectionStart = textarea.selectionStart || 0;
    const selectionEnd = textarea.selectionEnd || 0;
    if (selectionEnd > selectionStart) {
      return { start:selectionStart, end:selectionEnd, label:"선택 영역 검사" };
    }
    if (text.length <= MAX_SCOPE_CHARS) return { start:0, end:text.length, label:"문서 전체 검사" };
    const half = Math.floor(MAX_SCOPE_CHARS / 2);
    let start = Math.max(0, selectionStart - half);
    let end = Math.min(text.length, start + MAX_SCOPE_CHARS);
    start = Math.max(0, end - MAX_SCOPE_CHARS);
    return { start, end, label:"현재 위치 주변 " + MAX_SCOPE_CHARS.toLocaleString() + "자 검사" };
  }

  function scrollSelectionIntoView(textarea, offset){
    try {
      const before = textarea.value.slice(0, offset);
      const line = before.split("\n").length - 1;
      const cs = getComputedStyle(textarea);
      const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5 || 20;
      const targetTop = line * lineHeight;
      if (targetTop < textarea.scrollTop || targetTop > textarea.scrollTop + textarea.clientHeight - lineHeight * 2)
        textarea.scrollTop = Math.max(0, targetTop - textarea.clientHeight * 0.4);
    } catch(_){}
  }

  function attach(options={}){
    if (typeof document === "undefined") return null;
    const textarea = options.textarea;
    const buttonHost = options.buttonHost;
    if (!textarea || !buttonHost) return null;
    const button = element("button", "spellcheck-trigger", options.buttonText || "맞춤법");
    button.type = "button"; button.title = "오프라인 한국어 맞춤법 검사";
    if (options.buttonClass) button.classList.add(options.buttonClass);
    button.setAttribute("aria-pressed", "false");
    if (options.before && options.before.parentNode === buttonHost) buttonHost.insertBefore(button, options.before);
    else buttonHost.appendChild(button);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(button);

    let destroyed = false;
    let timer = 0;
    let composing = false;
    let applying = false;
    const controller = {
      textarea,
      button,
      label:options.label || "맞춤법 검사",
      mode:options.mode || "plain",
      fileExt:options.fileExt || "",
      scopeLabel:"",
      dictionaryPending:false,
      dictionaryError:"",
      runSerial:0,
      sessionIgnored:new Set(),
      async run(focusFirst=true){
        if (destroyed || !textarea.isConnected) { controller.destroy(); return; }
        clearTimeout(timer);
        const serial = ++controller.runSerial;
        const text = textarea.value;
        const scope = scopeForTextarea(textarea);
        const baseScopeLabel = scope.label + (controller.mode === "code" ? " · 주석과 문자열만" : "");
        controller.scopeLabel = baseScopeLabel + " · 한국어 사전 검사 중";
        controller.dictionaryPending = true;
        controller.dictionaryError = "";
        const dictionary = readUserDictionary();
        const ruleIssues = check(text, {
          mode:controller.mode, fileExt:controller.fileExt, start:scope.start, end:scope.end, ignored:dictionary
        }).filter(issue => !controller.sessionIgnored.has(issue.id));
        if (activeController && activeController !== controller)
          activeController.button.setAttribute("aria-pressed", "false");
        activeController = controller;
        activeIssues = ruleIssues;
        activeIndex = ruleIssues.length ? Math.min(Math.max(activeIndex, 0), ruleIssues.length - 1) : -1;
        const ui = ensurePanel();
        ui.root.hidden = false;
        button.setAttribute("aria-pressed", "true");
        renderPanel();
        if (focusFirst && ruleIssues.length) controller.focusIssue(ruleIssues[activeIndex]);
        try {
          const ranges = rangesFor(text, controller.mode, controller.fileExt, scope.start, scope.end);
          const dictionaryResult = await checkWithDictionary(text, { ranges, ignored:dictionary });
          if (destroyed || serial !== controller.runSerial || activeController !== controller) return;
          const dictionaryIssues = dictionaryResult.issues.filter(issue => !controller.sessionIgnored.has(issue.id));
          activeIssues = mergeIssues(ruleIssues, dictionaryIssues);
          controller.dictionaryPending = false;
          controller.scopeLabel = baseScopeLabel + (dictionaryResult.truncated ? " · 사전 검사 일부만 완료" : " · 오프라인 한국어 사전");
          activeIndex = activeIssues.length ? Math.min(Math.max(activeIndex, 0), activeIssues.length - 1) : -1;
          renderPanel();
          if (focusFirst && activeIssues.length) controller.focusIssue(activeIssues[activeIndex]);
        } catch(error){
          if (destroyed || serial !== controller.runSerial || activeController !== controller) return;
          controller.dictionaryPending = false;
          controller.dictionaryError = String(error && error.message || error || "한국어 사전 검사 실패");
          controller.scopeLabel = baseScopeLabel + " · 기본 규칙만 검사";
          renderPanel();
          console.warn("Korean dictionary spellcheck unavailable:", error);
        }
      },
      focusIssue(issue){
        if (!issue || !textarea.isConnected) return;
        try {
          textarea.focus({ preventScroll:true });
          textarea.setSelectionRange(issue.start, issue.end);
          scrollSelectionIntoView(textarea, issue.start);
        } catch(_){}
      },
      apply(issue, suggestion){
        if (!issue || destroyed || !textarea.isConnected) return;
        applying = true;
        try {
          textarea.focus({ preventScroll:true });
          textarea.setSelectionRange(issue.start, issue.end);
          textarea.setRangeText(suggestion, issue.start, issue.end, "select");
          const event = typeof InputEvent === "function"
            ? new InputEvent("input", { bubbles:true, inputType:"insertReplacementText", data:suggestion })
            : new Event("input", { bubbles:true });
          textarea.dispatchEvent(event);
        } finally {
          applying = false;
        }
        controller.run(false);
        if (activeIssues.length){
          const next = activeIssues.findIndex(item => item.start >= issue.start);
          activeIndex = next < 0 ? activeIssues.length - 1 : next;
          selectIssue(activeIndex);
        }
      },
      destroy(){
        if (destroyed) return;
        destroyed = true; controller.runSerial++; clearTimeout(timer);
        textarea.removeEventListener("input", onInput);
        textarea.removeEventListener("compositionstart", onCompositionStart);
        textarea.removeEventListener("compositionend", onCompositionEnd);
        button.removeEventListener("click", onClick);
        if (activeController === controller) closePanel(false);
        if (button.isConnected) button.remove();
        if (textarea._mnSpellcheckController === controller) delete textarea._mnSpellcheckController;
      }
    };
    const onClick = () => {
      if (activeController === controller && panel && !panel.root.hidden) closePanel();
      else {
        if (activeController !== controller) activeIndex = -1;
        controller.run(true);
      }
    };
    const onInput = event => {
      if (applying || composing || (event && event.isComposing) || activeController !== controller) return;
      clearTimeout(timer); timer = setTimeout(() => controller.run(false), 650);
    };
    const onCompositionStart = () => { composing = true; clearTimeout(timer); };
    const onCompositionEnd = () => {
      composing = false;
      if (activeController === controller){ clearTimeout(timer); timer = setTimeout(() => controller.run(false), 250); }
    };
    button.addEventListener("click", onClick);
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("compositionstart", onCompositionStart);
    textarea.addEventListener("compositionend", onCompositionEnd);
    textarea._mnSpellcheckController = controller;
    return controller;
  }

  return Object.freeze({
    RULES,
    check,
    rangesFor,
    markdownRanges,
    codeRanges,
    readUserDictionary,
    writeUserDictionary,
    mergeIssues,
    checkWithDictionary,
    attach,
    close:closePanel,
    STORAGE_KEY
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNKoreanSpellcheck;
