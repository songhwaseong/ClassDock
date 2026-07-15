"use strict";

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
  const errBands = document.createElement("div"); errBands.className = "err-lines"; errBands.setAttribute("aria-hidden", "true");
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
  edit.appendChild(cellBand); edit.appendChild(caretLine); edit.appendChild(indentLayer); edit.appendChild(wordHi); edit.appendChild(findHi); edit.appendChild(spotlightHi); edit.appendChild(defHover); edit.appendChild(pre); edit.appendChild(ta); edit.appendChild(cellDivLayer); edit.appendChild(errBands); edit.appendChild(traceBand); edit.appendChild(jumpBand); edit.appendChild(overlay);
  if (completionPortal){
    complete.classList.add("code-complete-portal");
    document.body.appendChild(complete);
  } else edit.appendChild(complete);
  // 함수 도움말 팝업(Shift+Tab) — 캐럿 근처에 시그니처+docstring 을 띄운다. 항상 body 로 포털(fixed) 배치.
  const help = document.createElement("div"); help.className = "code-help code-help-portal"; help.hidden = true;
  help.setAttribute("role", "tooltip");
  document.body.appendChild(help);
  host.appendChild(gutter); host.appendChild(edit);
  // plain=일반 텍스트/코드 편집(.py 실행 화면이 아님). 이때는 파이썬 전용 지능(Jedi 완성·정의 이동·함수 도움말·
  // 파이썬 import 제안)을 끄고, 프로파일에 맞는 버퍼 단어 완성만 쓴다. 로컬 파이썬이 떠 있어도(jediReady=true)
  // JS·JSON 소스를 파이썬으로 보내지 않도록 이 플래그로 함께 막는다.
  const plainMode = !!options.plain;
  const completionWords = plainMode ? completionWordsForProfile(prof, options.fileExt) : undefined;
  const jediUsable = () => !plainMode && typeof jediReady === "function" && jediReady();
  if (!plainMode){
    ensureJediProbe();                                     // 로컬 파이썬이면 Jedi 완성 준비(백그라운드, UI 비차단)
    if (typeof ensurePythonImportIndex === "function") ensurePythonImportIndex();
  }

  // ===== 실행 에러 줄 표시: 에러 난 줄에 빨간 띠. 스크롤 따라 움직이고, 코드 수정 시 사라진다 =====
  let errLines = [];
  const positionErr = () => {
    errBands.replaceChildren();
    if (!errLines.length) return;
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    const fragment = document.createDocumentFragment();
    errLines.forEach((entry) => {
      const item = (entry && typeof entry === "object") ? entry : { line:entry, severity:"error" };
      const line = item.line;
      const band = document.createElement("div");
      band.className = "err-line" + (item.severity === "warning" ? " err-line-warning" : item.severity === "info" ? " err-line-info" : "");
      band.style.top = (pt + (line - 1) * lh - ta.scrollTop) + "px";
      band.style.height = lh + "px";
      fragment.appendChild(band);
    });
    errBands.appendChild(fragment);
  };
  const clearError = () => { errLines = []; errBands.replaceChildren(); };
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
  const markErrorLines = (lines) => {
    const total = ta.value.split("\n").length;
    errLines = [...new Set((Array.isArray(lines) ? lines : [lines]).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= total))];
    if (!errLines.length){ clearError(); return; }
    positionErr();
    const firstLine = errLines[0];
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20, y = (firstLine - 1) * lh;
    if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - lh){ ta.scrollTop = Math.max(0, y - ta.clientHeight / 2); }  // 보이게 스크롤
    positionErr();
  };
  const markError = (n) => markErrorLines([n]);
  // 실시간 진단은 타이핑 위치를 방해하지 않도록 자동 스크롤 없이 줄 표시만 갱신한다.
  const setDiagnosticItems = (items) => {
    const total = ta.value.split("\n").length;
    const severityRank = { error:0, warning:1, info:2 };
    const byLine = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      item = item || {};
      const line = parseInt(item.line, 10);
      if (!(line >= 1 && line <= total)) return;
      const severity = ["error", "warning", "info"].includes(item.severity) ? item.severity : "warning";
      const current = byLine.get(line);
      if (!current || severityRank[severity] < severityRank[current.severity]) byLine.set(line, { line, severity });
    });
    errLines = [...byLine.values()].sort((a, b) => a.line - b.line);
    if (!errLines.length){ clearError(); return; }
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
    if (!jediUsable()) return;
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
      const detail = info.signature || info.importText;
      if (detail){
        const signature = document.createElement("span");
        signature.className = "code-complete-signature";
        signature.textContent = detail;
        item.appendChild(signature);
        item.title = detail;
      }
      item.addEventListener("mousedown", (e) => { e.preventDefault(); completion.index = index; acceptCompletion(); });
      complete.appendChild(item);
    });
    complete.hidden = false;
    positionCompletion();
    const active = complete.children[completion.index]; if (active) active.scrollIntoView({ block: "nearest" });
  };
  let completionSeq = 0;                                   // 비동기 Jedi 응답 경합 방지(최신 요청만 반영)
  const showLocalCompletion = (word, contextSource=null, includeImports=false) => { // 빠른 버퍼 단어 + 키워드 후보를 즉시 표시
    const source = typeof contextSource === "string" ? contextSource : completionContextFor().source;
    const local = pythonCompletionCandidates(source, word.prefix, completionWords);
    const wantImports = includeImports && !plainMode;      // 파이썬 import 제안은 파이썬 편집기에서만
    const indexed = wantImports && typeof pythonIndexedImportCandidates === "function" ? pythonIndexedImportCandidates(word.prefix) : [];
    const imports = wantImports && typeof pythonImportCompletionCandidates === "function"
      ? pythonImportCompletionCandidates(source, word.prefix, indexed) : indexed;
    const names = new Set(local);
    const items = [...local, ...imports.filter(item => !names.has(item.name))].slice(0, 12);
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
    if (jediUsable()){
      const seq = completionSeq, caret = ta.selectionStart, currentSource = ta.value;
      const context = completionContextFor(), source = context.source;
      const localShown = showLocalCompletion(word, source, manual);
      const before = currentSource.slice(0, caret);
      const line = context.lineOffset + (before.match(/\n/g) || []).length + 1; // Jedi: 줄 1-based
      const column = caret - (before.lastIndexOf("\n") + 1);          // Jedi: 칸 0-based
      requestJediCompletions(source, line, column).then(items => {
        if (seq !== completionSeq || ta.selectionStart !== caret) return;   // 더 최신 요청·커서 이동 → 폐기
        const pruned = manual ? (items || []) : pruneFullyTyped(items, word.prefix);   // 수동(Ctrl+Space)은 그대로
        const indexed = manual && typeof pythonIndexedImportCandidates === "function" ? pythonIndexedImportCandidates(word.prefix) : [];
        const imports = manual && typeof pythonImportCompletionCandidates === "function"
          ? pythonImportCompletionCandidates(source, word.prefix, indexed) : indexed;
        const combined = [...pruned, ...imports.filter(item => !pruned.some(candidate => String(candidate && candidate.name || candidate) === item.name))];
        if (combined.length){
          completion.items = combined.slice(0, 12); completion.index = 0;
          completion.start = word.start; completion.end = word.end;
          renderCompletion();
        } else if (!localShown) hideCompletion();     // Jedi·로컬 후보가 모두 없을 때만 닫힘(로컬 버퍼 후보가 떠 있으면 유지)
      });
      return;
    }
    showLocalCompletion(word, null, manual);
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
    const application = (typeof completionApplicationPlan === "function")
      ? completionApplicationPlan(ta.value, range, info)
      : (() => {
          const insertion = completionInsertionPlan(ta.value, range, info);
          return { value:ta.value.slice(0, range.start) + insertion.text + ta.value.slice(range.end), caret:insertion.caret };
        })();
    ta.value = application.value;
    ta.selectionStart = ta.selectionEnd = application.caret;
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
    if (typeof options.resolveWorkspaceDefinition === "function"){
      try {
        if (await options.resolveWorkspaceDefinition({ source:ta.value, wordInfo })) return;
      } catch(e){ console.warn("작업공간 정의 이동 실패:", e); }
    }
    if (!jediUsable()){
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
    const targetFocus = {
      column:Math.max(0, Number(def.column) || 0),
      length:Math.max(1, String(def.name || wordInfo.word || "").length)
    };
    // 소스키로 되찾지 않고, 연(또는 이미 열린) 문서를 직접 받아 그 줄로 이동.
    const target = await handleFiles([new File([buf], base, { type: "text/x-python" })], { sourceKey, workspacePath: def.path });
    if (target){
      const navigator = target.codeEditor || target.codeViewer;
      if (navigator && navigator.focusLine) navigator.focusLine(targetLine, targetFocus);
      else {
        target.pendingFocusLine = targetLine;           // 아직 렌더 전 → editor 부착 시 renderCode 가 소비
        target.pendingFocusOptions = targetFocus;
      }
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
    || (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && jediUsable());
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
    if (e.button === 0 && e.altKey && !e.ctrlKey && !e.metaKey && jediUsable()){
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
    toast(window.tf("{n}개를 바꿨어요.", { n: count }), 1800);
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
    if (e.key === "Tab" && e.shiftKey && ta.selectionStart === ta.selectionEnd && jediUsable() &&
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
      if (!plainMode){                                                      // 파이썬 전용: x=open(...) → x.close() 자동 채움
        const openPlan = pythonOpenClosePlan(val, s, en);
        if (openPlan){
          e.preventDefault();
          ta.value = val.slice(0, s) + openPlan.inserted + val.slice(en);
          ta.selectionStart = ta.selectionEnd = openPlan.caret;
          hideCompletion(); emitInput(); scrollCaretIntoView(); return;
        }
      }
      const head = val.slice(val.lastIndexOf("\n", s - 1) + 1, s);          // 현재 줄(커서 앞)
      let indent = (head.match(/^[ \t]*/) || [""])[0];                      // 윗줄 들여쓰기 유지
      // 커서가 여는 괄호와 짝 닫는 괄호 사이면 블록으로 펼친다: {\n    |\n} (모든 언어 공통)
      const openPair = { "(": ")", "[": "]", "{": "}" };
      if (s === en && openPair[val[s - 1]] && val[en] === openPair[val[s - 1]]){
        e.preventDefault();
        const body = "\n" + indent + "    ", tail = "\n" + indent;
        ta.value = val.slice(0, s) + body + tail + val.slice(en);
        ta.selectionStart = ta.selectionEnd = s + body.length;
        hideCompletion(); emitInput(); scrollCaretIntoView(); return;
      }
      if (prof === "hash"){
        if (/:\s*$/.test(head)) indent += "    ";                           // 파이썬 등 블록 시작(:)이면 한 단계 더
      } else if (prof === "c"){
        if (/[{([]\s*$/.test(head)) indent += "    ";                       // C계열: { ( [ 로 끝나면 한 단계 더
      }
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
    markError, markErrorLines, setDiagnosticItems, clearError, showTraceLine, clearTraceLine, highlightCellRange, clearCellBand,
    setCellSplitMode, toggleCellBoundaryAtLine, isCellSplitMode: () => cellSplitMode, autoSplitCells,
    spotlightRange, clearSpotlight };
}

// 대용량(1MB+·초장문) 텍스트/코드 전용 '가벼운 편집기'. 구문 강조 오버레이·단어 강조·자동완성·핀 등
// 무거운 레이어를 전부 빼고 '보이는 textarea + 줄번호'만 둔다. 일반 편집기(buildCodeEditor)는 글자 하나
// 칠 때마다 highlightCode 로 문서 전체를 다시 그려(innerHTML) 큰 파일에서 프리징하는데, 여기선 그 비용이
// 없어 수 MB 파일도 매끄럽게 편집된다. 대신 강조·완성 같은 편의 기능은 제공하지 않는다.
// showEdit 이 기대하는 인터페이스(host·ta·getValue·destroy·focusLine·openFind)만 최소로 맞춘다.
function buildLightTextEditor(text, options={}){
  const host = document.createElement("div"); host.className = "code-host code-host-edit code-host-light";
  const gutter = document.createElement("div"); gutter.className = "code-gutter"; gutter.setAttribute("aria-hidden", "true");
  const edit = document.createElement("div"); edit.className = "code-edit";
  const hitLayer = document.createElement("div"); hitLayer.className = "lite-hit-layer"; hitLayer.setAttribute("aria-hidden", "true");   // 찾기 일치 강조 박스(투명 textarea 뒤에 깔림)
  const ta = document.createElement("textarea"); ta.className = "code-input";
  ta.value = text; ta.spellcheck = false; ta.wrap = "off";
  ta.setAttribute("autocomplete", "off"); ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
  edit.appendChild(hitLayer); edit.appendChild(ta);   // hitLayer 를 먼저 → textarea(투명 배경) 아래에 강조가 비쳐 보인다
  host.appendChild(gutter); host.appendChild(edit);

  const countLines = (v) => { let c = 1; for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) === 10) c++; return c; };
  const offsetOfLine = (v, line) => {                 // 1-based 줄의 시작 글자 위치
    if (line <= 1) return 0;
    let seen = 0; for (let i = 0; i < v.length; i++){ if (v.charCodeAt(i) === 10 && ++seen === line - 1) return i + 1; }
    return v.length;
  };
  const lineAtOffset = (v, off) => { let n = 1; const end = Math.min(off, v.length); for (let i = 0; i < end; i++) if (v.charCodeAt(i) === 10) n++; return n; };

  // 줄번호는 줄 '개수'가 바뀔 때만 다시 만든다 — 같은 줄 안에서 타이핑하면 그대로 둔다(초대형 파일도 가벼움).
  let lastLineCount = -1;
  const renderGutter = () => {
    const n = countLines(ta.value);
    if (n === lastLineCount) return;
    lastLineCount = n;
    let nums = ""; for (let i = 1; i <= n; i++) nums += i + "\n";
    gutter.textContent = nums;
  };
  // ===== 찾기 일치 강조 박스 =====
  let curHit = null;                                   // curHit={s,len} 현재 강조 위치
  // 위치 계산은 '컬럼×글자폭'이 아니라 실제 렌더링을 그대로 재는 방식 — 한글(전각)·탭·혼합 폭까지 정확.
  // 화면 밖에 둔 미러 <pre>(textarea 와 같은 글꼴·탭)에서 '앞부분+<span>일치</span>'를 레이아웃해 span 의 위치·폭을 읽는다.
  let measurePre = null;
  const styleMeasure = () => {
    const cs = getComputedStyle(ta);
    measurePre.style.fontFamily = cs.fontFamily; measurePre.style.fontSize = cs.fontSize;
    measurePre.style.fontWeight = cs.fontWeight; measurePre.style.letterSpacing = cs.letterSpacing;
    measurePre.style.fontVariantLigatures = cs.fontVariantLigatures; measurePre.style.fontFeatureSettings = cs.fontFeatureSettings;
    measurePre.style.fontKerning = cs.fontKerning;
    measurePre.style.tabSize = cs.tabSize; measurePre.style.MozTabSize = cs.tabSize;
  };
  const positionHit = () => {
    let box = hitLayer.firstChild;
    if (!curHit){ if (box) hitLayer.textContent = ""; return; }
    const v = ta.value;
    if (curHit.s > v.length) { clearHit(); return; }
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, padTop = parseFloat(cs.paddingTop) || 16, padLeft = parseFloat(cs.paddingLeft) || 18;
    const line = lineAtOffset(v, curHit.s), lineStart = offsetOfLine(v, line);
    const nl = v.indexOf("\n", curHit.s); const lineEnd = nl === -1 ? v.length : nl;   // 강조는 한 줄 안에서만
    if (!measurePre){ measurePre = document.createElement("pre"); measurePre.className = "lite-measure"; measurePre.setAttribute("aria-hidden", "true"); edit.appendChild(measurePre); }
    styleMeasure();
    measurePre.textContent = "";
    measurePre.appendChild(document.createTextNode(v.slice(lineStart, curHit.s)));
    const span = document.createElement("span"); span.textContent = v.slice(curHit.s, Math.min(curHit.s + curHit.len, lineEnd));
    measurePre.appendChild(span);
    const left = span.offsetLeft, width = span.offsetWidth;
    if (!box){ box = document.createElement("div"); box.className = "lite-hit"; hitLayer.appendChild(box); }
    box.style.top = (padTop + (line - 1) * lh - ta.scrollTop) + "px";
    box.style.height = lh + "px";
    box.style.left = (padLeft + left - ta.scrollLeft) + "px";
    box.style.width = Math.max(2, width) + "px";
  };
  const showHit = (s, len) => { curHit = { s, len }; positionHit(); };
  const clearHit = () => { curHit = null; hitLayer.textContent = ""; };
  host.__refreshFontMetrics = () => { positionHit(); };   // 글자 크기 변경(A±) 시 강조 박스도 다시 맞춘다

  const syncScroll = () => { gutter.scrollTop = ta.scrollTop; positionHit(); };
  ta.addEventListener("scroll", syncScroll, { passive: true });
  ta.addEventListener("input", renderGutter);

  // Tab = 4칸 들여쓰기 / Shift+Tab = 내어쓰기(간단). 그 외 키는 textarea 네이티브 동작을 그대로 둔다.
  ta.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    if (e.shiftKey){
      const ls = v.lastIndexOf("\n", s - 1) + 1;
      let rm = 0; while (rm < 4 && v.charCodeAt(ls + rm) === 32) rm++;
      if (rm){ ta.value = v.slice(0, ls) + v.slice(ls + rm); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - rm); ta.dispatchEvent(new Event("input", { bubbles: true })); }
    } else {
      ta.value = v.slice(0, s) + "    " + v.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 4;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  const focusLine = (line) => {
    const v = ta.value, total = countLines(v);
    line = Math.max(1, Math.min(total, parseInt(line, 10) || 1));
    const start = offsetOfLine(v, line);
    ta.focus(); ta.setSelectionRange(start, start);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight * 0.4);
    syncScroll();
  };

  // ===== 가벼운 찾기(Ctrl+H): 문자열을 찾아 textarea 안에서 선택·스크롤(강조 오버레이 없이 네이티브 선택만) =====
  let findBar = null, findInput = null, findCount = null, findOpen = false;
  let matches = [], matchIdx = -1;
  const computeMatches = () => {
    matches = []; matchIdx = -1;
    const q = findInput.value; if (!q){ findCount.textContent = ""; clearHit(); return; }
    const hay = ta.value.toLowerCase(), needle = q.toLowerCase();
    let from = 0, idx;
    while ((idx = hay.indexOf(needle, from)) !== -1){ matches.push(idx); from = idx + Math.max(1, needle.length); if (matches.length >= 5000) break; }
    findCount.textContent = matches.length ? (matches.length + "개") : "없음";
  };
  const goMatch = (delta) => {
    if (!matches.length) return;
    matchIdx = (matchIdx + delta + matches.length) % matches.length;
    findCount.textContent = (matchIdx + 1) + "/" + matches.length;
    const s = matches[matchIdx], len = findInput.value.length;
    // 포커스는 찾기 입력창에 그대로 둔다 — textarea 로 포커스를 옮기면 한글 IME 조합이 끊긴다(ㅆ+ㅡ 안 붙음).
    // 선택 위치만 표시(포커스 이동 없음)하고, 강조는 자체 노란 박스로 그린다.
    try { ta.setSelectionRange(s, s + len); } catch(_){}
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20, line = lineAtOffset(ta.value, s);
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight * 0.4);
    showHit(s, len);              // 일치 부분에 또렷한 강조 박스
    syncScroll();
  };
  const closeFind = () => {
    if (findBar) findBar.hidden = true;
    findOpen = false; clearHit();
    if (typeof options.onFindClose === "function"){ try { options.onFindClose(); } catch(_){} }
    ta.focus();
  };
  const buildFindBar = () => {
    findBar = document.createElement("div"); findBar.className = "ro-find lite-find";
    findInput = document.createElement("input"); findInput.type = "text"; findInput.className = "ro-find-input"; findInput.placeholder = "찾기"; findInput.setAttribute("aria-label", "문서에서 찾기");
    findCount = document.createElement("span"); findCount.className = "ro-find-count";
    const prev = document.createElement("button"); prev.type = "button"; prev.className = "text-edit-btn"; prev.textContent = "↑"; prev.title = "이전 (Shift+Enter)";
    const next = document.createElement("button"); next.type = "button"; next.className = "text-edit-btn"; next.textContent = "↓"; next.title = "다음 (Enter)";
    const close = document.createElement("button"); close.type = "button"; close.className = "text-edit-btn"; close.textContent = "✕"; close.title = "닫기 (Esc)";
    findBar.append(findInput, findCount, prev, next, close);
    const runSearch = () => { computeMatches(); if (matches.length){ matchIdx = -1; goMatch(1); } };
    // 한글 IME 조합 중(isComposing)에는 검색하지 않는다 — 조합 도중 재검색이 조합을 방해하지 않게, 조합 확정 후에만.
    findInput.addEventListener("input", (e) => { if (e.isComposing) return; runSearch(); });
    findInput.addEventListener("compositionend", runSearch);
    findInput.addEventListener("keydown", (e) => {
      if (e.isComposing) return;                          // 조합 확정용 Enter 는 검색 이동으로 가로채지 않는다
      if (e.key === "Enter"){ e.preventDefault(); goMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape"){ e.preventDefault(); closeFind(); }
    });
    prev.addEventListener("click", () => { goMatch(-1); findInput.focus(); });
    next.addEventListener("click", () => { goMatch(1); findInput.focus(); });
    close.addEventListener("click", closeFind);
    edit.appendChild(findBar);
  };
  const openFind = (seed) => {
    if (!findBar) buildFindBar();
    findBar.hidden = false; findOpen = true;
    if (seed && seed !== findInput.value){ findInput.value = seed; computeMatches(); if (matches.length){ matchIdx = -1; goMatch(1); } }
    findInput.focus(); findInput.select();
  };

  renderGutter();
  return {
    host, ta,
    getValue: () => ta.value,
    setValue: (v) => { ta.value = v; renderGutter(); ta.dispatchEvent(new Event("input", { bubbles: true })); },
    getCursorLine: () => lineAtOffset(ta.value, ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd),
    focusLine, openFind, closeFind, isFindOpen: () => findOpen,
    destroy: () => { ta.removeEventListener("scroll", syncScroll); if (findBar) findBar.remove(); }
  };
}

