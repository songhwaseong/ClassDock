"use strict";

// 브라우저 기본 메뉴에는 항목을 추가할 수 없으므로, 코드/텍스트 textarea에서 공통으로
// 쓰는 편집 메뉴를 만든다. 선택 범위는 메뉴를 누르는 동안에도 보존한다.
let activeTextContextMenu = null;
function closeTextContextMenu(){
  if (typeof activeTextContextMenu === "function") activeTextContextMenu();
}

function attachTextCaseContextMenu(ta, options={}){
  // 특수문자 문자표 — 브라우저 위에서 도는 편집기라 "ㅁ + 한자키" 가 오지 않는다.
  // 대신 우클릭 메뉴와 Ctrl+F10(한글·워드의 문자표 단축키)으로 연다.
  // 넣기는 편집기가 준 replaceSelection 을 타야 되돌리기(Ctrl+Z) 기록이 함께 남는다.
  const openSpecialChars = (x, y) => {
    if (typeof MNSpecialChars === "undefined" || !MNSpecialChars) return;
    const len = String(ta.value || "").length;
    let start = Math.max(0, Math.min(ta.selectionStart || 0, len));
    let end = Math.max(0, Math.min(ta.selectionEnd || 0, len));
    if (end < start) [start, end] = [end, start];
    const spot = { start, end };
    MNSpecialChars.open({
      x, y,
      insert: (ch) => {
        ta.focus({ preventScroll:true });
        try { ta.setSelectionRange(spot.start, spot.end); } catch(_){}
        let ok = true;
        if (typeof options.replaceSelection === "function"){
          ok = options.replaceSelection(ch, { start:spot.start, end:spot.end }) !== false;
        } else {
          ta.setRangeText(ch, spot.start, spot.end, "end");
          ta.dispatchEvent(new Event("input", { bubbles:true }));
        }
        // 연속으로 넣을 때(Shift+클릭) 같은 자리에 덮어쓰지 않도록 커서를 방금 넣은 글자 뒤로 민다.
        spot.start = spot.end = spot.start + ch.length;
        try { ta.setSelectionRange(spot.start, spot.end); } catch(_){}
        return ok;
      }
    });
  };
  const onSpecialCharsKey = (event) => {
    if (event.key !== "F10" || !event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    const rect = ta.getBoundingClientRect();
    openSpecialChars(rect.left + 24, rect.top + 48);
  };
  ta.addEventListener("keydown", onSpecialCharsKey);

  const onContextMenu = (event) => {
    event.preventDefault();
    closeTextContextMenu();

    const value = String(ta.value || "");
    const selection = {
      start:Math.max(0, Math.min(ta.selectionStart || 0, value.length)),
      end:Math.max(0, Math.min(ta.selectionEnd || 0, value.length)),
      direction:ta.selectionDirection || "none"
    };
    if (selection.end < selection.start) [selection.start, selection.end] = [selection.end, selection.start];
    const hasSelection = selection.start !== selection.end;
    const menu = document.createElement("div");
    menu.className = "text-context-menu";
    menu.setAttribute("role", "menu");

    const restoreSelection = () => {
      ta.focus({ preventScroll:true });
      try { ta.setSelectionRange(selection.start, selection.end, selection.direction); } catch(_){}
    };
    const replaceSelection = (replacement) => {
      restoreSelection();
      if (typeof options.replaceSelection === "function") return options.replaceSelection(String(replacement || ""), selection) !== false;
      ta.setRangeText(String(replacement || ""), selection.start, selection.end, "select");
      ta.dispatchEvent(new Event("input", { bubbles:true }));
      return true;
    };
    const changeCase = (mode) => {
      const result = typeof transformSelectedTextCase === "function"
        ? transformSelectedTextCase(ta.value, selection.start, selection.end, mode)
        : null;
      if (!result || !result.changed) return;
      replaceSelection(result.replacement);
    };
    const copy = () => {
      restoreSelection();
      try { document.execCommand("copy"); } catch(_){}
    };
    const cut = () => {
      restoreSelection();
      try { document.execCommand("cut"); } catch(_){}
    };
    const paste = async () => {
      restoreSelection();
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") throw new Error("clipboard unavailable");
        const text = await navigator.clipboard.readText();
        replaceSelection(text);
      } catch(_){
        if (typeof toast === "function") toast("붙여넣기는 Ctrl+V로 할 수 있어요.", 2200);
      }
    };
    const dedupeSelectedLines = () => {
      restoreSelection();
      if (typeof options.dedupeSelectedLines !== "function") return;
      const removed = options.dedupeSelectedLines();
      if (typeof toast === "function"){
        toast(removed ? (removed + "개의 중복 줄을 제거했어요.") : "선택한 줄에 중복이 없어요.", 1800);
      }
    };
    const addItem = (label, action, disabled=false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = !!disabled;
      button.setAttribute("role", "menuitem");
      button.addEventListener("pointerdown", (e) => e.preventDefault());
      button.addEventListener("click", () => { close(); if (!button.disabled) action(); });
      menu.appendChild(button);
    };
    const addSeparator = () => {
      const separator = document.createElement("div");
      separator.className = "text-context-sep";
      separator.setAttribute("role", "separator");
      menu.appendChild(separator);
    };
    const close = () => {
      if (!menu.isConnected) return;
      menu.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("resize", close);
      if (activeTextContextMenu === close) activeTextContextMenu = null;
    };
    const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
    const onKeydown = (e) => { if (e.key === "Escape") close(); };

    let contextActions = [];
    try {
      contextActions = typeof options.contextMenuActions === "function"
        ? options.contextMenuActions()
        : (Array.isArray(options.contextMenuActions) ? options.contextMenuActions : []);
    } catch(_){ contextActions = []; }
    if (contextActions.length){
      for (const item of contextActions){
        if (!item) continue;
        if (item.separator){ addSeparator(); continue; }
        if (typeof item.action !== "function") continue;
        addItem(String(item.label || ""), item.action, !!item.disabled);
      }
      addSeparator();
    }
    addItem("복사", copy, !hasSelection);
    addItem("잘라내기", cut, !hasSelection);
    addItem("붙여넣기", paste);
    addSeparator();
    addItem("특수문자… (Ctrl+F10)", () => openSpecialChars(event.clientX, event.clientY));
    addSeparator();
    addItem("대문자로 변경", () => changeCase("upper"), !hasSelection);
    addItem("소문자로 변경", () => changeCase("lower"), !hasSelection);
    addItem("선택한 줄 중복 제거", dedupeSelectedLines, !hasSelection);
    addSeparator();
    addItem("모두 선택", () => { ta.focus({ preventScroll:true }); ta.select(); });

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, event.clientX)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, event.clientY)) + "px";
    activeTextContextMenu = close;
    setTimeout(() => {
      if (!menu.isConnected) return;
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKeydown, true);
      window.addEventListener("resize", close);
    }, 0);
  };
  ta.addEventListener("contextmenu", onContextMenu);
  const detach = () => {
    ta.removeEventListener("contextmenu", onContextMenu);
    ta.removeEventListener("keydown", onSpecialCharsKey);
    if (activeTextContextMenu) closeTextContextMenu();
    if (typeof MNSpecialChars !== "undefined" && MNSpecialChars) MNSpecialChars.close();
  };
  detach.open = onContextMenu;
  detach.openSpecialChars = openSpecialChars;
  return detach;
}

// 표 셀처럼 contenteditable 로 만든 입력 상자용 편집 메뉴.
// textarea 용(attachTextCaseContextMenu)과 겉모습은 같지만, 값(value)이 아니라 선택 Range 를
// 다뤄야 해서 따로 둔다. 대소문자 변환·중복 줄 삭제처럼 '여러 줄' 전제인 항목은 뺐다.
//   options.sanitize     : 붙여넣기·특수문자로 들어올 글자를 다듬는다(표 셀은 줄바꿈을 공백으로).
//   options.onMenuOpen   : 메뉴·문자표가 뜨는 동안 편집을 끝내지 말라고 알린다(표 셀 blur 커밋 방지).
//   options.onMenuClose  : 다 끝나고 원래 자리로 포커스를 돌려줄 때.
function attachEditableContextMenu(el, options={}){
  const clean = (text) => {
    const value = String(text == null ? "" : text);
    return typeof options.sanitize === "function" ? String(options.sanitize(value) || "") : value;
  };
  const notifyOpen = () => { if (typeof options.onMenuOpen === "function") try { options.onMenuOpen(); } catch(_){} };
  const notifyClose = () => { if (typeof options.onMenuClose === "function") try { options.onMenuClose(); } catch(_){} };
  const currentRange = () => {
    try {
      const sel = window.getSelection && window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      return el.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
    } catch(_){ return null; }
  };
  const restore = (range) => {
    try { el.focus({ preventScroll:true }); } catch(_){}
    if (!range) return;
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    sel.removeAllRanges(); sel.addRange(range);
  };
  const openSpecialChars = (x, y, range) => {
    if (typeof MNSpecialChars === "undefined" || !MNSpecialChars) return;
    notifyOpen();
    restore(range);
    MNSpecialChars.open({ x, y, target:el, range, onClose: notifyClose });
  };
  const onSpecialCharsKey = (event) => {
    if (event.key !== "F10" || !event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    const rect = el.getBoundingClientRect();
    openSpecialChars(rect.left, rect.bottom + 4, currentRange());
  };

  const onContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();      // 시트·본문의 다른 우클릭 메뉴가 겹쳐 뜨지 않게 한다
    closeTextContextMenu();
    notifyOpen();

    const range = currentRange();
    const hasSelection = !!(range && !range.collapsed);
    const menu = document.createElement("div");
    menu.className = "text-context-menu";
    menu.setAttribute("role", "menu");

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (menu.isConnected) menu.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("resize", close);
      if (activeTextContextMenu === close) activeTextContextMenu = null;
      notifyClose();
    };
    const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
    const onKeydown = (e) => { if (e.key === "Escape") close(); };
    const addItem = (label, action, disabled=false) => {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = label; button.disabled = !!disabled;
      button.setAttribute("role", "menuitem");
      button.addEventListener("pointerdown", (e) => e.preventDefault());   // 편집 중인 셀의 포커스를 지킨다
      button.addEventListener("click", () => { if (button.disabled) return; close(); action(); });
      menu.appendChild(button);
    };
    const addSeparator = () => {
      const sep = document.createElement("div");
      sep.className = "text-context-sep"; sep.setAttribute("role", "separator");
      menu.appendChild(sep);
    };

    const insertText = (text) => {
      restore(range);
      const value = clean(text);
      if (!value) return;
      try { document.execCommand("insertText", false, value); }      // 되돌리기(Ctrl+Z)를 그대로 탄다
      catch(_){ el.dispatchEvent(new Event("input", { bubbles:true })); }
    };
    addItem("복사", () => { restore(range); try { document.execCommand("copy"); } catch(_){} }, !hasSelection);
    addItem("잘라내기", () => { restore(range); try { document.execCommand("cut"); } catch(_){} }, !hasSelection);
    addItem("붙여넣기", async () => {
      restore(range);
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") throw new Error("clipboard unavailable");
        insertText(await navigator.clipboard.readText());
      } catch(_){
        if (typeof toast === "function") toast("붙여넣기는 Ctrl+V로 할 수 있어요.", 2200);
      }
    });
    addSeparator();
    addItem("특수문자… (Ctrl+F10)", () => openSpecialChars(event.clientX, event.clientY, range));
    addSeparator();
    addItem("모두 선택", () => {
      try {
        el.focus({ preventScroll:true });
        const all = document.createRange(); all.selectNodeContents(el);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(all);
      } catch(_){}
    });

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, event.clientX)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, event.clientY)) + "px";
    activeTextContextMenu = close;
    setTimeout(() => {
      if (!menu.isConnected) return;
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKeydown, true);
      window.addEventListener("resize", close);
    }, 0);
  };

  el.addEventListener("contextmenu", onContextMenu);
  el.addEventListener("keydown", onSpecialCharsKey);
  const detach = () => {
    el.removeEventListener("contextmenu", onContextMenu);
    el.removeEventListener("keydown", onSpecialCharsKey);
    if (activeTextContextMenu) closeTextContextMenu();
    if (typeof MNSpecialChars !== "undefined" && MNSpecialChars) MNSpecialChars.close();
  };
  detach.open = onContextMenu;
  return detach;
}

// 문서 끝에 여러 빈 줄을 만들 때도 일반 Enter처럼 마지막 코드 줄의 들여쓰기를 이어받는다.
// 이미 끝에 빈 줄이 있으면 마지막 실제 코드 줄을 기준으로 삼아 구조선이 중간에 끊기지 않게 한다.
function documentEndBlankIndent(value, prof){
  const lines = String(value == null ? "" : value).split("\n");
  let lastCodeLine = "";
  for (let i = lines.length - 1; i >= 0; i--){
    if (!lines[i].trim()) continue;
    lastCodeLine = lines[i];
    break;
  }
  let indent = (lastCodeLine.match(/^[ \t]*/) || [""])[0];
  if (prof === "python" && typeof pythonLineOpensBlock === "function" && pythonLineOpensBlock(lastCodeLine)){
    indent += "    ";
  } else if (prof === "c" && /[{([]\s*$/.test(lastCodeLine)){
    indent += "    ";
  }
  return indent;
}

/* ===== 줄 번호로 이동(Ctrl+G) 전용 미니 창 =====
   찾기 바에 숫자를 섞지 않고 창을 따로 둔다 — 코드에서 숫자를 '찾는' 일과 그 줄로 '가는' 일은 둘 다 자주
   쓰여서, 한 입력창에 접두사로 몰아넣으면 어느 쪽도 자연스럽지 않다.
   치는 동안에는 미리보기로 화면만 옮기고(캐럿·포커스는 그대로 두어 계속 칠 수 있게), Enter 로 확정한다.
   Esc 로 닫으면 보던 자리로 되돌아온다 — 잘못 눌러도 읽던 위치를 잃지 않게.
   config: mount(붙일 곳) · totalLines() · snapshot()/restore(스크롤 되돌리기) · preview(line) · commit(line) · onClose
   flow=true 면 겹쳐 띄우는 대신 문서 위쪽 흐름에 놓는다(읽기 전용 보기 — 겹칠 자리가 마땅치 않고 찾기 바와 같은 줄맞춤이 낫다). */
function mountGotoLineBar(config){
  const bar = document.createElement("div"); bar.className = config.flow ? "code-goto code-goto-flow" : "code-goto"; bar.hidden = true;
  bar.innerHTML =
    '<div class="code-goto-row">' +
      '<span class="code-goto-title">줄 이동</span>' +
      '<input type="text" class="code-goto-input" inputmode="numeric" autocomplete="off" placeholder="줄 번호" aria-label="이동할 줄 번호">' +
      '<button type="button" class="code-goto-do">이동</button>' +
      '<button type="button" class="code-goto-close" title="닫기 (Esc)">✕</button>' +
    '</div>' +
    '<div class="code-goto-hint" aria-live="polite"></div>';
  if (config.prepend) config.mount.insertBefore(bar, config.mount.firstChild); else config.mount.appendChild(bar);
  const input = bar.querySelector(".code-goto-input");
  const hint = bar.querySelector(".code-goto-hint");
  let open = false, snapshot = null, previewed = false;

  const total = () => Math.max(1, Math.floor(config.totalLines()) || 1);
  // 입력을 줄 번호로 읽는다. 숫자만 받고(공백·쉼표는 흘려보냄), 범위 밖이면 양 끝으로 당긴다.
  const readLine = () => {
    const raw = input.value.replace(/[\s,]/g, "");
    const max = total();
    if (!raw) return { empty:true, max };
    if (!/^\d+$/.test(raw)) return { bad:true, max };
    const asked = parseInt(raw, 10);
    return { line: Math.max(1, Math.min(max, asked)), asked, clamped: asked < 1 || asked > max, max };
  };
  const showHint = () => {
    const r = readLine();
    hint.classList.remove("is-bad");
    if (r.empty){ hint.textContent = window.tf("1 ~ {n}줄", { n:r.max }); return; }
    if (r.bad){ hint.classList.add("is-bad"); hint.textContent = window.t("숫자만 넣어 주세요."); return; }
    if (r.clamped){ hint.classList.add("is-bad"); hint.textContent = window.tf("{n}줄까지 있어요 — {line}줄로 갑니다.", { n:r.max, line:r.line }); return; }
    hint.textContent = window.tf("{line} / {n}줄", { line:r.line, n:r.max });
  };
  const close = (rewind) => {
    if (!open) return;
    open = false; bar.hidden = true;
    if (rewind && previewed && snapshot !== null && config.restore) config.restore(snapshot);
    previewed = false; snapshot = null;
    if (config.onClose) config.onClose();
  };
  const preview = () => {
    const r = readLine();
    showHint();
    if (r.empty || r.bad) return;
    config.preview(r.line);
    previewed = true;
  };
  const commit = () => {
    const r = readLine();
    if (r.empty || r.bad){ showHint(); input.focus(); input.select(); return; }
    previewed = false;               // 확정했으니 되돌릴 자리는 버린다
    close(false);
    config.commit(r.line);
  };
  input.addEventListener("input", preview);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); commit(); }
    else if (e.key === "Escape"){ e.preventDefault(); close(true); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown"){          // ↑↓ 로 한 줄씩 옮겨 가며 훑어보기
      e.preventDefault();
      const r = readLine();
      const base = (r.empty || r.bad) ? 1 : r.line;
      input.value = String(Math.max(1, Math.min(r.max, base + (e.key === "ArrowDown" ? 1 : -1))));
      preview();
    }
  });
  bar.querySelector(".code-goto-do").addEventListener("click", commit);
  bar.querySelector(".code-goto-close").addEventListener("click", () => close(true));
  if (typeof MNI18N === "object" && MNI18N && typeof MNI18N.translateTree === "function") MNI18N.translateTree(bar);
  return {
    el: bar,
    isOpen: () => open,
    close: () => close(true),
    open: () => {
      if (!open){ snapshot = config.snapshot ? config.snapshot() : null; previewed = false; }
      open = true; bar.hidden = false;
      input.value = ""; showHint();
      input.focus(); input.select();
    },
    destroy: () => { bar.remove(); }
  };
}

/* ===== 줄바꿈(자동 개행) 보기 =====
   편집기는 평소 wrap=off — 강조 pre·줄번호·찾기 상자·들여쓰기 안내가 모두 "몇 번째 줄 × 줄높이"로 자리를
   잡기 때문이다. 줄이 접히면 그 산술이 전부 어긋난다. 그래서 줄바꿈을 켤 때는 겹쳐 그리던 층을 CSS 로
   싹 내리고(is-wrapped) textarea 글자를 직접 보여 준다 — 가벼운 편집기가 평소 쓰는 방식 그대로다.
   구문 강조와 줄번호를 잠시 포기하는 대신, 긴 줄을 가로 스크롤 없이 읽는 게 목적인 산문(.txt·.md)에서
   제값을 한다. 코드에서는 켜지 않으면 그만이라 기존 동작에는 손대지 않는다. */
function setEditorWrap(host, ta, on){
  const wrapped = !!on;
  host.classList.toggle("is-wrapped", wrapped);
  // 캐럿을 잃지 않게 자리만 기억했다 되돌린다 — wrap 속성이 바뀌면 브라우저가 스크롤을 처음으로 되감는다.
  const caret = ta.selectionStart, caretEnd = ta.selectionEnd, dir = ta.selectionDirection;
  ta.wrap = wrapped ? "soft" : "off";
  try { ta.setSelectionRange(caret, caretEnd, dir); } catch(_){}
  return wrapped;
}

function buildCodeEditor(text, prof, options={}){
  const host = document.createElement("div"); host.className = "code-host code-host-edit";
  if (prof === "python") host.classList.add("code-color-target");
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
  // 노트북 전체 찾기(Ctrl+F)가 이 셀의 현재 매치를 또렷하게 강조할 때 쓰는 별도 레이어 — 셀 안 찾기(findHi)와 겹치지 않게 분리.
  const spotlightHi = document.createElement("div"); spotlightHi.className = "find-hi-layer"; spotlightHi.setAttribute("aria-hidden", "true");
  let wordHiOcc = [];                 // {line, col, len} — 화면 밖 포함 전체 매치(스크롤 시 보이는 것만 다시 그림)
  const linkedEdit = { active:false, term:"", ranges:[], primaryIndex:-1 };
  let linkedBeforeInput = null;
  let renderWordHi = () => {};
  let renderDefinitionHover = () => {};
  let renderFindHi = () => {};
  let renderSpotlight = () => {};
  let renderCellDividers = () => {};   // 실제 구현은 아래(편집 헬퍼 정의 후) 할당 — syncNow 가 먼저 참조하므로 예약 선언
  let unusedSemanticRanges = [];       // Python AST 분석이 돌려준 미사용 선언의 절대 문자 범위
  let paramSemanticRanges = [];        // 함수 매개변수·키워드 인자 이름의 절대 문자 범위(cls:"tk-param")
  let semanticRangeText = ta.value;    // 다음 입력에서 기존 범위를 안전하게 이동시키기 위한 직전 본문
  // ===== 편집기 내 찾기/바꾸기(Ctrl+F) 상태 — 실제 구현은 아래 colMetrics 정의 후 할당 =====
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
  const diagnosticTip = document.createElement("div");
  diagnosticTip.className = "code-diagnostic-tooltip";
  diagnosticTip.hidden = true;
  diagnosticTip.setAttribute("role", "tooltip");
  document.body.appendChild(diagnosticTip);
  host.appendChild(gutter); host.appendChild(edit);
  // plain=일반 텍스트/코드 편집(.py 실행 화면이 아님). 이때는 파이썬 전용 지능(Jedi 완성·정의 이동·함수 도움말·
  // 파이썬 import 제안)을 끄고, 프로파일에 맞는 버퍼 단어 완성만 쓴다. 로컬 파이썬이 떠 있어도(jediReady=true)
  // JS·JSON 소스를 파이썬으로 보내지 않도록 이 플래그로 함께 막는다.
  const plainMode = !!options.plain;
  // 일반(plain) 편집은 확장자에 맞는 키워드를 쓰되, 부르는 쪽이 목록을 직접 줄 수도 있다
  // (실행 편집기처럼 "이 실행 환경에서 실제로 되는 것"만 제안해야 하는 경우).
  const completionWords = plainMode
    ? (Array.isArray(options.completionWords) ? options.completionWords : completionWordsForProfile(prof, options.fileExt))
    : undefined;
  const jediUsable = () => !plainMode && typeof jediReady === "function" && jediReady();
  // 서버 미러 안에서 이 파일이 놓인 상대경로 — Jedi 가 "지금 이 파일이 프로젝트의 어디인지"를
  // 알아야 같은 패키지의 형제 모듈(from .state import State 같은 상대 import)까지 풀 수 있다.
  const jediRelPath = () => {
    if (typeof options.workspaceRelPath !== "function") return "";
    try { return String(options.workspaceRelPath() || ""); } catch(e){ return ""; }
  };
  // 실행 기준 폴더(sys.path 루트) — 자동 import 경로를 만들 때 쓰는 추정값을 Jedi 에게도 그대로 준다.
  const jediProjectRoot = () => {
    if (typeof options.workspaceProjectRoot !== "function") return "";
    try { return String(options.workspaceProjectRoot() || ""); } catch(e){ return ""; }
  };
  if (!plainMode){
    ensureJediProbe();                                     // 로컬 파이썬이면 Jedi 완성 준비(백그라운드, UI 비차단)
    if (typeof ensurePythonImportIndex === "function") ensurePythonImportIndex();
  }

  // ===== 실행 에러 줄 표시: 에러 난 줄에 빨간 띠. 스크롤 따라 움직이고, 코드 수정 시 사라진다 =====
  let errLines = [];
  let diagnosticTipLine = 0;
  const hideDiagnosticTooltip = () => {
    diagnosticTipLine = 0;
    diagnosticTip.hidden = true;
    diagnosticTip.replaceChildren();
  };
  const positionDiagnosticTooltip = (clientX, clientY) => {
    const gap = 14, margin = 10;
    let left = clientX + gap, top = clientY + gap;
    diagnosticTip.style.left = left + "px";
    diagnosticTip.style.top = top + "px";
    const rect = diagnosticTip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - margin) left = Math.max(margin, clientX - rect.width - gap);
    if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, clientY - rect.height - gap);
    diagnosticTip.style.left = left + "px";
    diagnosticTip.style.top = top + "px";
  };
  const showDiagnosticTooltip = (entry, clientX, clientY) => {
    const diagnostics = entry && Array.isArray(entry.diagnostics) ? entry.diagnostics : [];
    if (!diagnostics.length){ hideDiagnosticTooltip(); return; }
    if (diagnosticTipLine !== entry.line){
      diagnosticTip.replaceChildren();
      diagnostics.forEach((item) => {
        const row = document.createElement("div");
        row.className = "code-diagnostic-tooltip-item is-" + item.severity;
        const head = document.createElement("div"); head.className = "code-diagnostic-tooltip-head";
        const severity = document.createElement("strong");
        severity.textContent = item.severity === "error" ? "오류" : item.severity === "info" ? "참고" : "경고";
        const where = document.createElement("span");
        where.textContent = item.line + "줄 " + (item.column + 1) + "칸" + (item.code ? " · " + item.code : "");
        head.append(severity, where);
        const message = document.createElement("div"); message.className = "code-diagnostic-tooltip-message"; message.textContent = item.message;
        row.append(head, message);
        if (item.hint){
          const hint = document.createElement("div"); hint.className = "code-diagnostic-tooltip-hint"; hint.textContent = "힌트: " + item.hint;
          row.appendChild(hint);
        }
        diagnosticTip.appendChild(row);
      });
      diagnosticTipLine = entry.line;
    }
    diagnosticTip.hidden = false;
    positionDiagnosticTooltip(clientX, clientY);
  };
  const diagnosticEntryAtPointer = (event) => {
    const rect = ta.getBoundingClientRect();
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    const contentY = event.clientY - rect.top + ta.scrollTop - pt;
    if (contentY < 0) return null;
    const line = Math.floor(contentY / lh) + 1;
    return errLines.find((entry) => entry && typeof entry === "object" && entry.line === line && Array.isArray(entry.diagnostics)) || null;
  };
  const handleDiagnosticPointerMove = (event) => {
    const entry = diagnosticEntryAtPointer(event);
    if (!entry){ hideDiagnosticTooltip(); return; }
    showDiagnosticTooltip(entry, event.clientX, event.clientY);
  };
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
  const clearError = () => { errLines = []; errBands.replaceChildren(); hideDiagnosticTooltip(); };
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
    // 범위를 선택하면 줄 전체 띠가 실제 선택 배경처럼 보인다. 선택 중에는 숨겨
    // textarea의 네이티브 선택 영역만 보이게 한다.
    if (ta.selectionStart !== ta.selectionEnd){
      caretLine.hidden = true;
      return;
    }
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    const caret = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
    let lineNo = 0; for (let i = 0; i < caret; i++) if (ta.value.charCodeAt(i) === 10) lineNo++;
    caretLine.style.top = (pt + lineNo * lh - ta.scrollTop) + "px";
    caretLine.style.height = lh + "px";
    caretLine.hidden = false;
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
    hideDiagnosticTooltip();
    const total = ta.value.split("\n").length;
    const severityRank = { error:0, warning:1, info:2 };
    const byLine = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      item = item || {};
      const line = parseInt(item.line, 10);
      if (!(line >= 1 && line <= total)) return;
      const severity = ["error", "warning", "info"].includes(item.severity) ? item.severity : "warning";
      const diagnostic = {
        line,
        column:Math.max(0, parseInt(item.column, 10) || 0),
        severity,
        code:String(item.code == null ? "" : item.code),
        message:String(item.message == null ? "" : item.message),
        hint:String(item.hint == null ? "" : item.hint)
      };
      if (!diagnostic.message) return;
      const current = byLine.get(line) || { line, severity, diagnostics:[] };
      current.diagnostics.push(diagnostic);
      if (severityRank[severity] < severityRank[current.severity]) current.severity = severity;
      byLine.set(line, current);
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

  /* ===== 코드 따라치기(타자 연습) =====
     본문을 흐린 '교본'으로 깔아 두고 그 위에 똑같이 쳐 보는 모드. 맞은 글자는 제 색, 틀린 글자는 빨강.
     핵심 규칙 하나: textarea 는 연습 내내 교본 전체(target)를 그대로 담고 캐럿만 pos 에서 앞으로 나간다.
     친 글자는 곧바로 지우고 '맞음/틀림' 표시만 marks 에 남긴다 → pre 와 글자가 완전히 같아 캐럿·줄·스크롤이
     절대 어긋나지 않고, 아직 안 친 아랫줄도 평소처럼 스크롤해 미리 볼 수 있다.
     marks[i]: 1=맞음, 2=틀림(관대 모드라 틀려도 그냥 다음 글자로 넘어간다). */
  // shown[i]: 그 자리에 그릴 글자 — 맞았으면 교본 글자, 틀렸으면 '내가 친 글자'(무엇을 잘못 눌렀는지 보이게).
  // bad = 지금 화면에 남아 있는 빨간 글자 수(정확도의 기준), wrong = 고친 것까지 포함한 총 실수 횟수.
  const practice = { active:false, target:"", pos:0, marks:null, shown:null, bad:0, wrong:0,
                     startedAt:0, composing:false, rejectAt:-1, rejectTimer:0, onProgress:null, onDone:null };
  const practiceClass = (mark) => mark === 2 ? "tp-bad" : "tp-ok";
  // 지나온 곳(0~end)을 맞음/틀림 색으로 조립. 같은 색이 이어지는 구간은 한 <span> 으로 묶는다 —
  // 글자마다 span 을 만들면 한 글자 칠 때마다 수천 개가 생겨 느려진다.
  const practiceHtmlUpTo = (end) => {
    let html = "", runStart = 0, runClass = practiceClass(practice.marks[0]);
    const flush = (stop) => { if (stop > runStart) html += '<span class="' + runClass + '">' + escapeHtml(practice.shown.slice(runStart, stop).join("")) + "</span>"; };
    for (let i = 0; i < end; i++){
      const cls = practiceClass(practice.marks[i]);
      if (cls !== runClass){ flush(i); runClass = cls; runStart = i; }
    }
    flush(end);
    return html;
  };
  const renderPracticeCode = () => {
    const target = practice.target;
    let html = practiceHtmlUpTo(practice.pos);
    // 한글 조합 중(ㅎ→하→학)에는 아직 채점하지 않는다. 조합 글자가 textarea 에 끼어 있는 만큼(extra)
    // pre 에도 똑같이 끼워 넣어야 글자 수가 같아 캐럿이 어긋나지 않는다.
    let from = practice.pos;
    const extra = ta.value.length - target.length;
    if (extra > 0){
      const composing = ta.value.slice(practice.pos, practice.pos + extra);
      html += '<span class="tp-typing">' + escapeHtml(composing) + "</span>";
      // 조합 글자가 차지하는 칸 수만큼 교본을 잠깐 가린다 — 안 그러면 한 글자 조합할 때마다 뒷글자가 밀렸다 돌아온다.
      let cells = 0;
      for (const ch of composing) cells += wideChar.test(ch) ? 2 : 1;
      let covered = 0;
      while (covered < cells && from < target.length && target[from] !== "\n"){   // 줄바꿈은 절대 넘지 않는다
        covered += wideChar.test(target[from]) ? 2 : 1; from++;
      }
    }
    // 폭이 달라 막은 키는 지금 칠 글자를 잠깐 빨갛게 깜빡여 "여기서 막혔다"를 알린다.
    if (practice.rejectAt === practice.pos && from < target.length){
      html += '<span class="tp-block">' + escapeHtml(target[from]) + "</span>";
      from += 1;
    }
    if (from < target.length) html += '<span class="tp-ghost">' + escapeHtml(target.slice(from)) + "</span>";
    code.innerHTML = html + "&#8203;";
  };

  const refresh = () => {
    if (practice.active){ renderPracticeCode(); scheduleScrollbarMeasure(); return; }
    const val = ta.value;
    // Keep the final empty line measurable so the highlight layer and textarea
    // have the same maximum scroll position when the source ends with a newline.
    // 미사용 흐림(tk-unused)을 먼저 넘겨 매개변수색(tk-param)과 겹칠 때 흐림이 이기게 한다.
    const semanticRanges = paramSemanticRanges.length ? unusedSemanticRanges.concat(paramSemanticRanges) : unusedSemanticRanges;
    code.innerHTML = highlightCode(val, prof, semanticRanges) + "&#8203;";
    const lines = val.split("\n").length;
    let nums = ""; for (let i = 1; i <= lines; i++) nums += i + "\n";
    gutter.textContent = nums;
    scheduleScrollbarMeasure();   // 긴 줄 붙여넣기·삭제로 스크롤바가 생기거나 사라지면 예약 여백을 다시 맞춘다
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

  // ===== 거터 맨 아래 '↓' 버튼: 누르면 문서 끝에 빈 줄 10개를 추가(엔터 10번 효과) =====
  const JUMP_DOWN_LINES = 10;
  const jumpDownBtn = document.createElement("button");
  jumpDownBtn.type = "button"; jumpDownBtn.className = "code-jump-down"; jumpDownBtn.textContent = "↓";
  jumpDownBtn.title = "문서 끝에 빈 줄 " + JUMP_DOWN_LINES + "개 추가";
  jumpDownBtn.setAttribute("aria-label", jumpDownBtn.title);
  host.appendChild(jumpDownBtn);
  const positionJumpDown = () => {                    // 마지막 줄번호 옆에 붙어 스크롤을 따라 이동
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    const lastLine = ta.value.split("\n").length;     // 1-based 마지막 줄
    jumpDownBtn.style.top = (pt + (lastLine - 1) * lh - ta.scrollTop) + "px";
    jumpDownBtn.style.height = lh + "px";
  };
  jumpDownBtn.addEventListener("mousedown", (e) => { e.preventDefault(); });   // 거터 클릭이 포커스·선택을 흔들지 않게
  jumpDownBtn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    hideCompletion(); exitCol();
    clearTimeout(coalesceTimer); commitNow();
    const blankIndent = documentEndBlankIndent(ta.value, prof);
    ta.value = ta.value + ("\n" + blankIndent).repeat(JUMP_DOWN_LINES);
    ta.selectionStart = ta.selectionEnd = ta.value.length;   // 커서를 새로 만든 마지막 빈 줄로
    ta.focus();
    emitInput();                                             // 하이라이트·줄번호·히스토리(undo) 한 번에 반영
    clearTimeout(coalesceTimer); commitNow();
    scrollCaretIntoView();
  });

  let syncRaf = 0;
  const syncNow = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; positionErr(); positionTrace(); positionJump(); positionCellBand(); positionCaretLine(); positionPins(); positionJumpDown(); renderWordHi(); renderDefinitionHover(); renderFindHi(); renderSpotlight(); renderIndentGuides(); renderCellDividers(); };
  const sync = () => {
    syncNow();
    cancelAnimationFrame(syncRaf);
    syncRaf = requestAnimationFrame(syncNow);   // 드래그 선택 자동 스크롤이 이벤트 후 반영되는 Chromium 보정
  };
  // 스크롤바가 차지하는 실제 폭·높이를 재서 pre·줄번호의 예약 여백(--code-sbw/--code-sbh)에 반영한다.
  // 값이 바뀐 경우에만 true 를 돌려줘 불필요한 재배치를 막는다.
  let sbW = -1, sbH = -1;
  const applyScrollbarMetrics = () => {
    const sw = Math.max(0, ta.offsetWidth - ta.clientWidth);
    const sh = Math.max(0, ta.offsetHeight - ta.clientHeight);
    if (sw === sbW && sh === sbH) return false;
    sbW = sw; sbH = sh;
    host.style.setProperty("--code-sbw", sw + "px");
    host.style.setProperty("--code-sbh", sh + "px");
    return true;
  };
  const measureScrollbars = () => { applyScrollbarMetrics(); sync(); };
  // 화면보다 긴 줄을 붙여넣어 가로 스크롤바가 새로 생겨도(반대로 지워서 사라져도) .code-edit 의 크기는
  // 그대로라 ResizeObserver 가 울리지 않는다 → 본문이 바뀔 때마다 한 프레임 뒤 다시 잰다. 예약 여백이
  // 어긋나면 pre·줄번호의 최대 스크롤이 textarea 보다 짧아, 문서 끝에서 글자·줄번호만 덜 밀려 캐럿과 어긋난다.
  let sbRaf = 0;
  const scheduleScrollbarMeasure = () => {
    if (sbRaf) return;
    sbRaf = requestAnimationFrame(() => { sbRaf = 0; if (applyScrollbarMetrics()) sync(); });
  };
  host.__refreshFontMetrics = scheduleScrollbarMeasure;   // 글자 크기·글꼴 변경으로 스크롤바가 생기고 사라질 때도 재측정
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
  const snapshot = () => ({ value: ta.value, s: ta.selectionStart, e: ta.selectionEnd });
  const history = MNEditHistory.create({
    limit: MNEditHistory.LIMITS.text,
    capture: snapshot,
    apply: (st) => {
      ta.value = st.value;
      ta.selectionStart = st.s; ta.selectionEnd = st.e;
      emitInput();                     // 하이라이트·스크롤·외부 편집상태 갱신(되돌리는 중이라 재기록은 안 된다)
    },
    isEqual: (a, b) => a.value === b.value,   // 커서만 다른 건 새 단계가 아니다
  });
  history.reset();
  let coalesceTimer = 0;
  const rememberHistoryCaret = () => {
    if (practice.active) return;                 // 따라치기 중 값 변화는 되돌리기 기록에 섞지 않는다
    const cur = history.isApplying() ? null : history.current();
    if (cur) history.replaceCurrent(editorHistoryCaretState(cur, ta.value, ta.selectionStart, ta.selectionEnd));
  };
  const commitNow = () => {
    if (history.isApplying()) return;
    if (!history.commit()) history.replaceCurrent(snapshot());   // 값 동일 → 커서만 갱신
  };
  // 연속 입력 묶기는 여기서 직접 한다 — 묶임이 풀릴 때 커서만 갱신하는 위 동작이 필요해서.
  const commitSoon = () => { if (history.isApplying()) return; clearTimeout(coalesceTimer); coalesceTimer = setTimeout(commitNow, 350); };
  const undo = () => {
    clearTimeout(coalesceTimer);
    history.undo();                    // 대기 중 입력은 undo 안에서 한 단계로 확정된다
  };
  const redo = () => {
    clearTimeout(coalesceTimer);
    history.redo();
  };
  const completion = { items: [], index: 0, start: 0, end: 0, manual: false };
  let completionTimer = 0;
  let pendingAutoParen = -1;   // 자동완성으로 방금 () 가 삽입된 커서 위치(그 직후 ( 중복입력 방지용). 다른 편집·이동 시 -1 로 무효화.
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
    try { data = await requestJediHelp(context.source, line, column, jediRelPath(), jediProjectRoot()); } catch(_){ data = null; }
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
  // 커서가 파이썬 주석(#) 안에 있으면 자동완성을 띄우지 않는다. 현재 줄만 훑되
  // 따옴표 안의 #(문자열 리터럴)은 주석으로 보지 않는다.
  const caretInComment = (caret) => {
    if (prof !== "python") return false;                  // Python 코드에서만 대상
    const before = ta.value.slice(0, caret);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    let quote = "";
    for (let i = 0; i < line.length; i++){
      const ch = line[i];
      if (quote){ if (ch === quote) quote = ""; continue; }
      if (ch === "'" || ch === '"'){ quote = ch; continue; }
      if (ch === "#") return true;
    }
    return false;
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
  const dismissCompletion = () => {
    completionSeq++;
    hideCompletion();
  };
  const closeCompletionOnOutsidePointer = (event) => {
    if (complete.hidden || complete.contains(event.target)) return;
    dismissCompletion();
  };
  document.addEventListener("pointerdown", closeCompletionOnOutsidePointer, true);
  // 자동 import 후보 모으기 — 작업공간(같은 프로젝트의 다른 .py) 후보는 자동 팝업에도 넣고,
  // 설치 패키지·표준 라이브러리 카탈로그는 Ctrl+Space(수동)에서만 연다. 목록이 길어져 생기는
  // 소음은 카탈로그 쪽이 대부분이고, 옆 파일의 클래스·함수는 지금 쓰려는 이름일 확률이 높다.
  // 멤버 접근(obj.) 문맥은 제외한다 — 거기서 필요한 건 속성이지 import 가 아니다.
  const importCandidatesFor = (source, prefix, manual, dotContext) => {
    if (plainMode || dotContext) return [];                // 일반 텍스트 편집·멤버 접근에서는 import 제안 없음
    const indexed = manual && typeof pythonIndexedImportCandidates === "function" ? pythonIndexedImportCandidates(prefix) : [];
    let workspace = [];
    if (typeof options.workspaceImportCandidates === "function") {
      try { workspace = options.workspaceImportCandidates() || []; } catch(e) { workspace = []; }
    }
    const extra = [...workspace, ...indexed];
    if (!manual && !workspace.length) return [];
    return typeof pythonImportCompletionCandidates === "function"
      ? pythonImportCompletionCandidates(source, prefix, extra, { catalog: manual })
      : extra;
  };
  // 앞 그룹(버퍼 단어·Jedi 후보)이 목록을 다 채워도 자동 import 가 몇 칸은 남도록 자리를 예약한다.
  // 예약분이 남으면 다시 앞 그룹으로 채워 목록 길이는 그대로 유지한다.
  const IMPORT_RESERVED_SLOTS = 3;
  const mergeCompletionItems = (primary, imports, limit) => {
    const keys = new Set();
    const items = [];
    const push = (list, max) => {
      for (const item of list) {
        if (items.length >= max) break;
        const name = item && typeof item === "object" ? String(item.name || "") : String(item || "");
        const importText = item && typeof item === "object" ? String(item.importText || "") : "";
        const key = importText ? (name + "\n" + importText) : name;
        if (!name || keys.has(key)) continue;
        keys.add(key); items.push(item);
      }
    };
    const reserve = Math.min(IMPORT_RESERVED_SLOTS, imports.length);
    push(primary, Math.max(0, limit - reserve));
    push(imports, limit);
    push(primary, limit);
    return items;
  };
  // import 문을 치는 중이면(from 패키지. / from 모듈 import 이름) 그 자리에 들어갈 이름을
  // 작업공간 모듈 색인에서 찾는다. 이름만 넣으면 되는 자리라 import 문은 따로 붙이지 않는다.
  const moduleCandidatesFor = (importCtx, prefix, manual) => {
    if (plainMode || !importCtx || typeof options.workspaceModuleCandidates !== "function") return [];
    let rows = [];
    try { rows = options.workspaceModuleCandidates(importCtx) || []; } catch(e) { rows = []; }
    return manual ? rows : pruneFullyTyped(rows, prefix);   // 다 친 이름은 자동 팝업에서 뺀다
  };
  const showLocalCompletion = (word, contextSource=null, manual=false, ctx={}) => { // 빠른 버퍼 단어 + 키워드 후보를 즉시 표시
    const memberReceiver = ctx.memberReceiver || "", importCtx = ctx.importCtx || null;
    const source = typeof contextSource === "string" ? contextSource : completionContextFor().source;
    // import 줄에서 아직 아무 글자도 안 쳤으면 버퍼 단어는 빼고 모듈 후보만 보여 준다(목록 소음 방지).
    const local = importCtx && !word.prefix ? [] : pythonCompletionCandidates(source, word.prefix, completionWords);
    // 멤버 후보는 부르는 쪽이 준 함수를 먼저 쓴다(자바스크립트 실행 편집기 등 파이썬이 아닌 언어).
    // 없으면 기존대로 파이썬 추론을 쓴다 — 일반 텍스트 편집(plainMode)에서는 둘 다 쓰지 않는다.
    let members = [];
    if (memberReceiver){
      if (typeof options.memberCandidates === "function"){
        try { members = options.memberCandidates(source, memberReceiver, word.prefix) || []; }
        catch(e){ members = []; }
      } else if (!plainMode && typeof pythonMemberCompletionCandidates === "function"){
        members = pythonMemberCompletionCandidates(source, memberReceiver, word.prefix);
      }
    }
    const modules = moduleCandidatesFor(importCtx, word.prefix, manual);
    const imports = importCtx ? [] : importCandidatesFor(source, word.prefix, manual, ctx.dotContext);
    const items = mergeCompletionItems([...modules, ...members, ...local], imports, memberReceiver ? 240 : 12);
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
    if (caretInComment(word.end)){ hideCompletion(); return; }   // 주석 안에서는 자동완성하지 않음
    const dotContext = word.start > 0 && ta.value[word.start - 1] === ".";   // obj. 처럼 멤버 접근 문맥
    const receiverMatch = dotContext ? ta.value.slice(0, word.start - 1).match(/([A-Za-z_]\w*)$/) : null;
    const memberReceiver = receiverMatch ? receiverMatch[1] : "";
    // import 문 안이면 아직 한 글자도 안 쳤어도 후보를 연다(from 모듈 import ⟨여기⟩ 처럼).
    const importCtx = !plainMode && typeof pythonImportContextAt === "function"
      ? pythonImportContextAt(ta.value, ta.selectionStart) : null;
    const completionCtx = { memberReceiver, dotContext, importCtx };
    if (!manual && !dotContext && !importCtx && word.prefix.length < 1){ hideCompletion(); return; }
    completion.manual = manual;
    // 로컬 후보는 즉시 보여 주고, 더 정확한 Jedi 결과가 오면 같은 팝업을 비동기로 보강한다.
    // 네트워크 왕복과 서버의 Python 프로세스 시작을 기다리는 동안 팝업이 비어 있지 않아 체감 지연이 줄어든다.
    if (jediUsable()){
      const seq = completionSeq, caret = ta.selectionStart, currentSource = ta.value;
      const context = completionContextFor(), source = context.source;
      const localShown = showLocalCompletion(word, source, manual, completionCtx);
      const before = currentSource.slice(0, caret);
      const line = context.lineOffset + (before.match(/\n/g) || []).length + 1; // Jedi: 줄 1-based
      const column = caret - (before.lastIndexOf("\n") + 1);          // Jedi: 칸 0-based
      requestJediCompletions(source, line, column, jediRelPath(), jediProjectRoot()).then(items => {
        if (seq !== completionSeq || ta.selectionStart !== caret) return;   // 더 최신 요청·커서 이동 → 폐기
        const pruned = manual ? (items || []) : pruneFullyTyped(items, word.prefix);   // 수동(Ctrl+Space)은 그대로
        const imports = importCtx ? [] : importCandidatesFor(source, word.prefix, manual, dotContext);
        const modules = moduleCandidatesFor(importCtx, word.prefix, manual);   // 작업공간 모듈은 Jedi 가 모르는 영역이라 앞에 둔다
        const fallbackMembers = memberReceiver && typeof pythonMemberCompletionCandidates === "function"
          ? pythonMemberCompletionCandidates(source, memberReceiver, word.prefix) : [];
        const combined = mergeCompletionItems([...modules, ...fallbackMembers, ...pruned], imports, memberReceiver ? 240 : 12);
        if (combined.length){
          completion.items = combined; completion.index = 0;
          completion.start = word.start; completion.end = word.end;
          renderCompletion();
        } else if (!localShown) hideCompletion();     // Jedi·로컬 후보가 모두 없을 때만 닫힘(로컬 버퍼 후보가 떠 있으면 유지)
      });
      return;
    }
    showLocalCompletion(word, null, manual, completionCtx);
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
    // 함수 수락으로 빈 () 가 자동 삽입되어 커서가 그 안에 놓였으면, 바로 뒤 ( 중복입력을 막을 위치로 기록.
    const caret = application.caret;
    pendingAutoParen = (ta.value[caret - 1] === "(" && ta.value[caret] === ")") ? caret : -1;
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

  // ===== 코드 자동 정렬 =====
  // 경량 재들여쓰기(오프라인·항상 가능) + 로컬 파이썬이면 black/autopep8 전체 재포맷. 파이썬 편집기(prof "python",
  // plain 아님)에서만 동작한다. black 은 비동기라 도중에 사용자가 편집하면 그 결과를 버려 편집을 덮어쓰지 않는다.
  // undo 는 정렬 전/후를 한 단계로 묶고, 커서는 같은 줄·같은 칸(가능한 범위)으로 되돌린다.
  const formatDocumentNow = async (opts) => {
    opts = opts || {};
    if (plainMode || prof !== "python") return { changed: false };
    const before = ta.value;
    if (!before.trim()) return { changed: false };
    hideCompletion(); exitCol();
    const caret = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
    let line = 0, col = 0;
    for (let i = 0; i < caret && i < before.length; i++){ if (before.charCodeAt(i) === 10){ line++; col = 0; } else col++; }
    let result;
    try {
      result = (typeof mnFormatPythonSource === "function")
        ? await mnFormatPythonSource(before, { backend: opts.backend !== false })
        : { text: (typeof lightReindentPython === "function" ? lightReindentPython(before) : before), engine: "light" };
    } catch(_){ result = { text: before, engine: "light" }; }
    const after = (result && typeof result.text === "string") ? result.text : before;
    if (ta.value !== before) return { changed: false, stale: true };   // 비동기 도중 사용자가 편집 → 폐기
    if (after === before) return { changed: false, engine: result && result.engine, reason: result && result.reason };
    clearTimeout(coalesceTimer); commitNow();                          // 정렬 직전 상태를 undo 한 단계로
    ta.value = after;
    const nlines = after.split("\n");
    const tgtLine = Math.max(0, Math.min(line, nlines.length - 1));
    let off = 0; for (let i = 0; i < tgtLine; i++) off += nlines[i].length + 1;
    off += Math.min(col, nlines[tgtLine].length);
    ta.selectionStart = ta.selectionEnd = Math.min(off, after.length);
    emitInput();
    clearTimeout(coalesceTimer); commitNow();
    scrollCaretIntoView();
    return { changed: true, engine: result && result.engine, reason: result && result.reason };
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
     열 좌표는 문자 인덱스 기준이고, 가로 위치(px)는 줄 앞부분을 실제로 측정해서 잡는다
     → 가변폭 글꼴·한글(전각)·탭이 섞여도 선택 박스와 커서가 글자와 어긋나지 않는다. */
  const col = { active: false };
  const colMetrics = () => {
    const cs = getComputedStyle(ta);
    return { lh: parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.6), pl: parseFloat(cs.paddingLeft) || 0, pt: parseFloat(cs.paddingTop) || 0 };
  };
  // 열↔px 변환. 측정은 measureCodeText(미러 span) 로 하고, 한 번의 드래그·렌더 동안만 캐시한다
  // (같은 줄의 같은 열을 선택 박스·커서가 반복해서 물어보므로 측정 횟수가 줄어든다).
  let colWCache = new Map();                          // "줄번호\t글자수" → px
  const colWReset = () => { colWCache.clear(); };
  const colPrefixW = (line, text, n) => {
    if (n <= 0) return 0;
    const key = line + "\t" + n;
    let w = colWCache.get(key);
    if (w === undefined){ w = measureCodeText(text.slice(0, n)); colWCache.set(key, w); }
    return w;
  };
  // 줄 끝을 넘어간 구간용 기준 글자폭 — 짧은 줄 뒤쪽으로 드래그해도 사각 선택이 이어지게 한다.
  let colRefCw = 0;
  const colRefWidth = () => (colRefCw || (colRefCw = measureCodeText("0000000000") / 10) || 8);
  // px → 가장 가까운 문자 경계(열). 앞부분 폭은 글자수에 대해 단조 증가하므로 이분 탐색.
  const colAtX = (line, text, x) => {
    const len = text.length;
    if (x <= 0) return 0;
    const full = colPrefixW(line, text, len);
    if (x >= full) return len + Math.round((x - full) / colRefWidth());   // 줄 끝 뒤 = 가상 열
    let lo = 0, hi = len;
    while (hi - lo > 1){
      const mid = (lo + hi) >> 1;
      if (colPrefixW(line, text, mid) <= x) lo = mid; else hi = mid;
    }
    const wLo = colPrefixW(line, text, lo), wHi = colPrefixW(line, text, hi);
    return (x - wLo) <= (wHi - x) ? lo : hi;           // 고정폭에서의 Math.round 와 같은 감각으로 스냅
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
    colWReset();
    const colv = colAtX(line, lines[line] || "", clientX - r.left - m.pl + ta.scrollLeft);
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
    colWReset();
    for (let i = col.lineStart; i <= col.lineEnd && i < lines.length; i++){
      const s = lines[i], len = s.length;
      const sa = Math.min(col.leftCol, len), sb = Math.min(col.rightCol, len);
      const xa = colPrefixW(i, s, sa), xb = colPrefixW(i, s, sb);
      const top = m.pt + i * m.lh - ta.scrollTop;
      if (sb > sa){
        const box = document.createElement("div"); box.className = "col-sel";
        box.style.cssText = "left:" + (m.pl + xa - ta.scrollLeft) + "px;top:" + top + "px;width:" + (xb - xa) + "px;height:" + m.lh + "px";
        overlay.appendChild(box);
      }
      const caretColV = col.caretSide === "left" ? col.leftCol : col.rightCol;
      const cc = Math.min(caretColV, len);
      const xc = cc === sa ? xa : (cc === sb ? xb : colPrefixW(i, s, cc));
      const car = document.createElement("div"); car.className = "col-caret";
      car.style.cssText = "left:" + (m.pl + xc - ta.scrollLeft) + "px;top:" + top + "px;height:" + m.lh + "px";
      overlay.appendChild(car);
    }
  };
  // 글꼴·글자 크기가 바뀌면(A± / 글꼴 드롭다운) 측정 캐시를 버리고 열 편집 오버레이를 다시 그린다.
  // applyEditorFontMetrics 가 이 훅을 호출한다.
  host.__refreshFontMetrics = () => {
    colRefCw = 0; colWReset();
    if (col.active){ col.m = colMetrics(); col.render(); }
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
  /* ===== 열 편집 클립보드(복사·잘라내기·붙여넣기) =====
     사각 선택은 textarea 의 네이티브 선택이 아니라 오버레이 그림이라, 브라우저 기본 복사로는 아무것도
     담기지 않는다 → 줄마다 선택 구간을 직접 잘라 "줄바꿈으로 이은 한 덩어리"로 클립보드에 넣는다. */
  const colSelectedRows = () => {
    const lines = ta.value.split("\n"), out = [];
    for (let i = col.lineStart; i <= col.lineEnd && i < lines.length; i++){
      const s = lines[i], len = s.length;
      out.push(s.slice(Math.min(col.leftCol, len), Math.min(col.rightCol, len)));
    }
    return out;
  };
  let colClipboardBusy = false;      // 폴백 복사가 잠깐 포커스를 훔쳐도 blur 로 열 모드가 풀리지 않게
  const colWriteClipboard = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch(_){}
    colClipboardBusy = true;         // 권한·비보안 컨텍스트로 막히면 숨은 textarea + execCommand 로
    const box = document.createElement("textarea");
    box.value = text; box.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0";
    document.body.appendChild(box); box.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch(_){}
    box.remove();
    ta.focus({ preventScroll:true });
    colClipboardBusy = false;
    return ok;
  };
  const colCopy = (cut) => {
    if (col.rightCol <= col.leftCol) return false;        // 폭 0(세로 커서만) → 복사할 것이 없다
    const rows = colSelectedRows();
    const chars = rows.reduce((n, s) => n + s.length, 0);
    colWriteClipboard(rows.join("\n")).then((ok) => {
      if (typeof toast !== "function") return;
      if (!ok){ toast("클립보드에 담지 못했어요.", 2200); return; }
      toast("열 " + rows.length + "줄 " + chars + "자를 " + (cut ? "잘라냈어요." : "복사했어요."), 1600);
    });
    if (cut){
      colEachLine((s, a, b) => s.slice(0, a) + s.slice(b));
      col.rightCol = col.leftCol; col.caretSide = "left"; col.render();
    }
    return true;
  };
  // 붙여넣기: 줄 수가 선택한 줄 수와 같으면 줄별로 짝지어 넣고, 한 줄짜리는 모든 줄에 같이 넣는다.
  // 줄 수가 어긋나면 위에서부터 맞추고(모자란 줄은 빈 값) 알려 준다.
  const colPaste = (raw) => {
    const text = String(raw || "").replace(/\r\n?/g, "\n");
    if (!text) return;
    const rows = text.split("\n");
    const count = col.lineEnd - col.lineStart + 1;
    if (rows.length === 1){ colInsert(rows[0]); return; }
    let i = 0, widest = 0;
    for (const r of rows.slice(0, count)) widest = Math.max(widest, r.length);
    colEachLine((s, a, b) => s.slice(0, a) + (rows[i++] || "") + s.slice(b));
    col.leftCol = col.rightCol = col.leftCol + widest; col.caretSide = "right"; col.render();
    if (rows.length !== count && typeof toast === "function"){
      toast("붙여넣는 " + rows.length + "줄이 선택한 " + count + "줄과 달라 위에서부터 맞췄어요.", 2600);
    }
  };
  ta.addEventListener("paste", (e) => {          // Ctrl+V — clipboardData 로 받으면 읽기 권한이 필요 없다
    if (!col.active || practice.active) return;
    const data = e.clipboardData && e.clipboardData.getData("text");
    if (!data) return;
    e.preventDefault();
    colPaste(data);
  });
  ta.addEventListener("mousedown", (e) => {
    if (e.button === 2 && col.active) return;    // 우클릭은 열 선택을 유지 — 상황 메뉴에서 복사할 수 있게
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
  ta.addEventListener("blur", () => {
    if (colClipboardBusy) return;              // 폴백 복사가 잠깐 훔쳐 간 포커스 — 열 선택은 그대로 둔다
    exitCol(); exitLinkedEdit(); dismissCompletion(); clearDefinitionHover();
  });
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
    const def = await requestJediDefinition(ta.value, line, column, jediRelPath(), jediProjectRoot());
    if (!def || def.reason === "builtin"){
      toast("내장 함수이거나 열 수 있는 Python 소스/스텁 파일이 없습니다.", 2800);
      return;
    }
    if (!def.ok || !def.path){
      toast("정의 위치를 찾지 못했습니다.", 2200);
      return;
    }
    // 미러 안(=내 작업공간 파일)이면 임시 복사본 대신 원래 탭을 연다.
    if (def.workspacePath && typeof options.openWorkspaceDefinition === "function"){
      try {
        const opened = await options.openWorkspaceDefinition({
          path:String(def.workspacePath),
          line:Math.max(1, Number(def.line) || 1),
          column:Math.max(0, Number(def.column) || 0),
          name:String(def.name || wordInfo.word || "")
        });
        if (opened) return;
      } catch(e){ console.warn("작업공간 정의 이동 실패:", e); }
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
    clickMeasureSpan.style.fontVariantLigatures = cs.fontVariantLigatures;
    clickMeasureSpan.style.fontFeatureSettings = cs.fontFeatureSettings;
    clickMeasureSpan.style.fontKerning = cs.fontKerning;
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
  let pendingBracketSelection = null;
  ta.addEventListener("mousedown", (e) => {
    if (e.button === 0 && e.detail === 1) pendingBracketSelection = null;
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
    const bracketSelection = pythonBracketContentSelection(ta.value, pos);
    if (bracketSelection){
      e.preventDefault();
      pendingBracketSelection = bracketSelection;
      exitLinkedEdit();
      ta.focus();
      ta.setSelectionRange(bracketSelection.selectionStart, bracketSelection.selectionEnd);
      hideCompletion();
      computeWordHi();
      sync();
      return;
    }
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
    const bracketSelection = pendingBracketSelection;
    pendingBracketSelection = null;
    requestAnimationFrame(() => {
      if (!ta.isConnected) return;
      if (bracketSelection){
        ta.setSelectionRange(bracketSelection.selectionStart, bracketSelection.selectionEnd);
        computeWordHi();
        sync();
        return;
      }
      const next = normalizeIdentifierSelection(ta.value, ta.selectionStart, ta.selectionEnd);
      ta.setSelectionRange(next.selectionStart, next.selectionEnd);
      startLinkedEdit();
    });
  });

  ta.addEventListener("beforeinput", (e) => {
    rememberHistoryCaret();
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
    if (practice.active){
      // 조합 중에는 판정하지 않는다 — ㅎ·하 단계마다 빨간불이 깜빡이지 않게 확정(compositionend) 후에만 채점.
      if (practice.composing || e.isComposing) renderPracticeCode();
      else practiceGrade();
      sync();
      return;
    }
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
    // 새 AST 분석을 기다리는 동안에도 직접 건드리지 않은 미사용 표시는 유지한다.
    // 편집 뒤쪽 범위는 글자 수만큼 이동하고, 편집과 겹친 범위만 즉시 버려 엉뚱한 글자를 흐리지 않는다.
    unusedSemanticRanges = remapTextRangesAfterEdit(unusedSemanticRanges, semanticRangeText, ta.value);
    paramSemanticRanges = remapTextRangesAfterEdit(paramSemanticRanges, semanticRangeText, ta.value);
    semanticRangeText = ta.value;
    refresh(); sync(); clearError(); clearTraceLine();
    schedulePinRender();                                // 줄이 추가/삭제되면 핀 마커 줄 위치 재확정(앵커 기반)
    if (linkedEdit.active) renderLinkedEditRanges(); else clearWordHi();
    clearDefinitionHover(); if (!history.isApplying()) commitSoon();
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
  ta.addEventListener("mousemove", handleDiagnosticPointerMove);
  ta.addEventListener("mouseleave", hideDiagnosticTooltip);
  ta.addEventListener("scroll", () => { sync(); hideCompletion(); hideDiagnosticTooltip(); if (col.active) col.render(); });
  ta.addEventListener("select", sync);
  // ===== 따라치기 모드 입력 가로채기 =====
  ta.addEventListener("compositionstart", () => { if (practice.active) practice.composing = true; });
  ta.addEventListener("compositionend", () => {
    if (!practice.active) return;
    practice.composing = false;
    setTimeout(() => { if (practice.active && !practice.composing) practiceGrade(); }, 0);   // 브라우저마다 input/compositionend 순서가 달라 한 박자 뒤에 채점
  });
  // 붙여넣기·잘라내기·끌어놓기로 통째 넘기는 건 연습이 되지 않으므로 막는다.
  ["paste", "cut", "drop"].forEach((type) => ta.addEventListener(type, (e) => { if (practice.active) e.preventDefault(); }));
  // 캐럿은 늘 '지금 칠 자리'에 — 클릭·더블클릭으로 중간에 끼어들지 못하게 되돌린다.
  const practiceSnapCaret = () => {
    if (!practice.active || practice.composing) return;
    if (ta.selectionStart !== practice.pos || ta.selectionEnd !== practice.pos) ta.setSelectionRange(practice.pos, practice.pos);
  };
  ta.addEventListener("mouseup", practiceSnapCaret);
  ta.addEventListener("dblclick", practiceSnapCaret);
  ta.addEventListener("focus", practiceSnapCaret);

  /* ===== 편집기 내 찾기/바꾸기(Ctrl+F) =====
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
      '<button type="button" class="search-history-toggle" title="최근 검색어 (↓)" aria-expanded="false">최근</button>' +
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
  const historyButton = findBar.querySelector(".search-history-toggle");
  const suggestPanel = findBar.querySelector(".regex-suggest");
  let findOptCase = false, findOptWord = false, findOptRegex = false;
  let suggestOpen = false;
  let findHiSpan = null;

  const syncFindOptionButtons = () => {
    findBar.querySelector('[data-opt="case"]').classList.toggle("on", findOptCase);
    findBar.querySelector('[data-opt="word"]').classList.toggle("on", findOptWord);
    findBar.querySelector('[data-opt="regex"]').classList.toggle("on", findOptRegex);
  };
  /* 최근 검색어 — 대소문자·단어·정규식 토글까지 함께 기억한다.
     정규식 패턴을 일반 모드로 되살리면 하나도 못 찾아 "기록이 고장났다"처럼 보이기 때문이다. */
  const findHistory = (typeof MNSearchHistory === "object" && MNSearchHistory)
    ? MNSearchHistory.attach(findInput, {
        scope: "text",
        mount: findBar,
        toggleButton: historyButton,
        onPick: (term, meta) => {
          if (meta){
            findOptCase = !!meta.case; findOptWord = !!meta.word; findOptRegex = !!meta.regex;
            syncFindOptionButtons();
          }
          recomputeFind(true);
        }
      })
    : null;
  // 실제로 검색을 쓴 순간(Enter·다음/이전·바꾸기)에만 남긴다. '바꿀 내용'은 일부러 기록하지 않는다.
  const rememberFindTerm = () => {
    if (findHistory) findHistory.remember(findInput.value, { case: findOptCase, word: findOptWord, regex: findOptRegex });
  };
  if (historyButton){
    if (findHistory){
      // mousedown 기본동작(포커스 이동)을 막아야 입력창이 blur 되면서 목록이 곧바로 닫히는 일이 없다.
      historyButton.addEventListener("mousedown", (e) => e.preventDefault());
      historyButton.addEventListener("click", () => { findHistory.toggle(true); findInput.focus(); });
    } else historyButton.hidden = true;
  }
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
    // 화면 밖일 때만 살짝 위쪽 가운데로 이동. 이미 보이면 그대로 둬야 타이핑 중 화면이 튀지 않는다.
    if (top < ta.scrollTop + pt || bottom > ta.scrollTop + ta.clientHeight - pb){
      const want = top - (ta.clientHeight - lh) * 0.4;
      ta.scrollTop = Math.max(0, Math.min(want, ta.scrollHeight - ta.clientHeight));
    }
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
    // 선택한 글자도, 지금 적힌 것도 없으면 마지막으로 찾던 말을 채워 준다(문서를 옮겨도 이어서 찾게).
    else if (!findInput.value && findHistory){
      const rows = MNSearchHistory.list("text");
      if (rows.length){
        findInput.value = rows[0].q;
        const meta = rows[0].meta;
        if (meta){ findOptCase = !!meta.case; findOptWord = !!meta.word; findOptRegex = !!meta.regex; syncFindOptionButtons(); }
      }
    }
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
  // ===== 노트북 전체 찾기(Ctrl+F) 강조 — 셀 안 찾기의 find-hi-active 박스를 그대로 재사용해 현재 매치를 또렷하게 표시 =====
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
      if (top < ta.scrollTop || bottom > ta.scrollTop + ta.clientHeight){   // 밖일 때만 위쪽 가운데로(찾기 이동과 같은 규칙)
        const want = top - (ta.clientHeight - m.lh) * 0.4;
        ta.scrollTop = Math.max(0, Math.min(want, ta.scrollHeight - ta.clientHeight));
      }
    }
    try { ta.setSelectionRange(start, start); } catch(_){}   // 흐린 회색 선택 잔상을 없애고 강조는 주황 박스로만
    syncNow();
  };
  ta.addEventListener("input", clearSpotlight);          // 셀을 편집하면 위치가 어긋나므로 강조를 지운다
  findInput.addEventListener("input", () => recomputeFind(true));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); rememberFindTerm(); selectMatch(findIndex + (e.shiftKey ? -1 : 1)); }
    else if (e.key === "Escape"){ e.preventDefault(); closeFind(); }
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); rememberFindTerm(); replaceCurrent(); }
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
  findBar.querySelector('[data-nav="next"]').addEventListener("click", () => { rememberFindTerm(); selectMatch(findIndex + 1); findInput.focus(); });
  findBar.querySelector('[data-nav="prev"]').addEventListener("click", () => { rememberFindTerm(); selectMatch(findIndex - 1); findInput.focus(); });
  findBar.querySelector('[data-do="one"]').addEventListener("click", () => { rememberFindTerm(); replaceCurrent(); });
  findBar.querySelector('[data-do="all"]').addEventListener("click", () => { rememberFindTerm(); replaceAll(); });
  findBar.querySelector(".code-find-close").addEventListener("click", closeFind);

  /* ===== 줄 번호로 이동(Ctrl+G) =====
     미리보기는 화면만 옮긴다 — 캐럿과 포커스를 건드리지 않아야 입력창에서 숫자를 계속 고칠 수 있다.
     노란 띠(jumpBand)로 어느 줄인지 보여 주되, 확정 전에는 자동으로 지우지 않는다(고르는 중이니까). */
  const previewGotoLine = (n) => {
    const total = ta.value.split("\n").length;
    const line = Math.max(1, Math.min(total, n));
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight * 0.35);
    clearTimeout(jumpTimer);
    jumpLine = line; positionJump();
    sync();
  };
  const gotoBar = mountGotoLineBar({
    mount: edit,
    totalLines: () => ta.value.split("\n").length,
    snapshot: () => ta.scrollTop,
    restore: (top) => { clearJump(); ta.scrollTop = top; sync(); },
    preview: previewGotoLine,
    commit: (line) => focusLine(line),
    onClose: () => { if (!practice.active) ta.focus(); }
  });
  // 따라치기 중에는 막는다 — 캐럿을 임의의 줄로 옮기면 지금 어디를 치고 있는지(practice.pos)와 어긋난다.
  const openGoto = () => {
    if (practice.active){ toast("따라치기 중에는 줄 이동을 쓸 수 없어요. Esc 로 먼저 끝내 주세요.", 2600); return; }
    exitCol(); hideCompletion(); hideHelp();
    gotoBar.open();
  };

  ta.addEventListener("keydown", (e) => {
    // 따라치기 중에는 편집 도우미(자동 들여쓰기·짝 괄호·자동완성·열 편집…)를 전부 비켜 간다.
    // 내가 치지 않은 글자가 저절로 들어가면 채점이 어긋나기 때문. 글자·Enter·Backspace 만 기본 동작으로 통과시킨다.
    if (practice.active){
      if (e.key === "Escape"){ e.preventDefault(); stopPractice("cancel"); return; }
      if (e.ctrlKey || e.metaKey || e.altKey){
        const key = (e.key || "").toLowerCase();
        if (key === "v" || key === "z" || key === "y" || key === "x") e.preventDefault();   // 붙여넣기·되돌리기로 건너뛰기 방지
        return;                                                                            // 저장 등 나머지 단축키는 그대로
      }
      if (e.key === "Tab"){ e.preventDefault(); return; }                                   // 줄 앞 들여쓰기는 자동으로 넘어간다
      if (e.key === "Delete"){ e.preventDefault(); return; }                                // 앞으로 지우기는 아직 안 친 교본을 건드린다
      if (/^(?:Arrow|Page)/.test(e.key) || e.key === "Home" || e.key === "End"){ e.preventDefault(); return; }
      return;
    }
    rememberHistoryCaret();
    const autoParenSpot = pendingAutoParen; pendingAutoParen = -1;   // 자동 () 중복방지 표식은 다음 키 입력 한 번만 유효(one-shot)
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
    if (shortcutMatches(e, "goToLine")){
      e.preventDefault(); e.stopPropagation(); openGoto(); return;
    }
    if (shortcutMatches(e, "formatDocument")){
      e.preventDefault(); e.stopPropagation();
      formatDocumentNow({ backend: true }).then((r) => {
        if (!r || typeof toast !== "function") return;
        if (r.reason === "syntax") toast("구문 오류가 있어 완전 정렬은 못 하고 공백만 정리했어요.", 2800);
        else if (r.changed) {
          const engine = r.engine === "light"
            ? (typeof window.t === "function" ? window.t("경량 정렬") : "경량 정렬")
            : (r.engine || "formatter");
          const message = typeof window.tf === "function"
            ? window.tf("코드를 정렬했어요 ({engine}).", { engine })
            : "코드를 정렬했어요 (" + engine + ").";
          toast(message, 1600);
        }
        else if (!r.changed && !r.stale) toast("이미 정렬돼 있어요.", 1400);
      }).catch(() => {});
      return;
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
      if (ta.selectionStart === ta.selectionEnd){   // 선택 없이 커서만 단어 안에 있으면 먼저 그 단어를 선택
        const word = wordAtOffset(ta.selectionStart);
        if (word && word.word.length <= 80 && /^[\w가-힣]+$/.test(word.word)){
          exitCol();
          hideCompletion();
          ta.setSelectionRange(word.start, word.end);
          scrollCaretIntoView();
          computeWordHi();
          sync();
        }
        return;
      }
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
      if (e.ctrlKey || e.metaKey){
        // 복사·잘라내기·붙여넣기는 열(사각) 단위로 직접 처리한다. 네이티브 복사는 이 모드에서
        // 선택이 비어 있어(오버레이로만 그린 선택) 아무것도 담기지 않는다.
        const key = (e.key || "").toLowerCase(), code = e.code || "";   // 한글 입력 상태에서도 잡히게 code 병행
        if (!e.altKey && !e.shiftKey && (key === "c" || code === "KeyC")){ e.preventDefault(); colCopy(false); return; }
        if (!e.altKey && !e.shiftKey && (key === "x" || code === "KeyX")){ e.preventDefault(); colCopy(true); return; }
        if (!e.altKey && (key === "v" || code === "KeyV")) return;      // paste 이벤트에서 처리 — 열 모드 유지
        exitCol(); return;                                              // 저장 등 기존 단축키는 그대로 동작
      }
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
      // 도크스트링: 같은 따옴표 2개 바로 뒤에서 3번째를 치면 닫는 3개까지 한 번에 넣는다(""" """ 형태).
      // 짝 붙이기에 맡기면 """ + " 로 4개가 되어 불편. 단, 앞이 식별자·닫는 괄호·같은 따옴표면
      // 이미 끝난 문자열 뒤라는 뜻이므로("""abc""" 뒤 등) 새 도크스트링으로 보지 않는다.
      if ((e.key === '"' || e.key === "'") && start === end && start >= 2
          && ta.value.slice(start - 2, start) === e.key + e.key
          && !/[A-Za-z0-9_)\]}"']/.test(ta.value[start - 3] || "")){
        const nq = ta.value[start];
        const nextIsWordQ = !!nq && (/[A-Za-z0-9_]/.test(nq) || (nq.charCodeAt(0) > 127 && !/\s/.test(nq)));
        if (!nextIsWordQ){ e.preventDefault(); insertPair(e.key, e.key.repeat(3)); return; }
      }
      // 함수 자동완성이 방금 넣어 준 빈 () 안에서 곧바로 ( 를 누르면 print(()) 처럼 중복되므로,
      // 그 한 번만 무시한다(같은 위치·직후에만 성립 → 튜플 인자 print((1,2)) 등 일반 중첩은 그대로 동작).
      if (e.key === "(" && start === end && start === autoParenSpot
          && ta.value[start - 1] === "(" && ta.value[start] === ")"){
        e.preventDefault(); return;
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
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){
      const bracketPlan = closingBracketTabPlan(ta.value, ta.selectionStart, ta.selectionEnd);
      if (bracketPlan){
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = bracketPlan.caret;
        sync();
        return;
      }
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
      if (prof === "python"){
        if (pythonLineOpensBlock(head)) indent += "    ";                    // Python 블록 시작(:) 뒤에 주석이 있어도 한 단계 더
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
  const setUnusedRanges = (items) => {
    if (practice.active) return;                 // 따라치기 중에는 본문이 '치는 중'이라 분석 결과를 입히지 않는다
    const value = ta.value, starts = [0];
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) starts.push(i + 1);
    const next = [];
    for (const item of Array.isArray(items) ? items : []){
      const line = Math.max(1, parseInt(item && item.line, 10) || 1);
      const column = Math.max(0, parseInt(item && item.column, 10) || 0);
      const length = Math.max(0, parseInt(item && item.length, 10) || 0);
      if (!length || line > starts.length) continue;
      const start = starts[line - 1] + column, end = start + length;
      if (start < starts[line - 1] || end > value.length || value.slice(start, end).indexOf("\n") >= 0) continue;
      const expected = String((item && item.name) || "");
      if (expected && value.slice(start, end) !== expected) continue;
      next.push({ start, end, name:expected || value.slice(start, end) });
    }
    unusedSemanticRanges = next.sort((a, b) => a.start - b.start || a.end - b.end);
    semanticRangeText = value;
    refresh(); sync();
  };
  const clearUnusedRanges = () => {
    if (!unusedSemanticRanges.length) return;
    unusedSemanticRanges = [];
    refresh(); sync();
  };
  // 함수 매개변수·키워드 인자 이름 강조. 미사용 표시와 같은 방식(줄/열/길이 → 절대 범위 + 이름 검증)이되
  // cls 를 tk-param 으로 달아 refresh 가 highlightCode 로 넘길 때 매개변수색으로 칠하게 한다.
  const setParamRanges = (items) => {
    if (practice.active) return;
    const value = ta.value, starts = [0];
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) starts.push(i + 1);
    const next = [];
    for (const item of Array.isArray(items) ? items : []){
      const line = Math.max(1, parseInt(item && item.line, 10) || 1);
      const column = Math.max(0, parseInt(item && item.column, 10) || 0);
      const length = Math.max(0, parseInt(item && item.length, 10) || 0);
      if (!length || line > starts.length) continue;
      const start = starts[line - 1] + column, end = start + length;
      if (start < starts[line - 1] || end > value.length || value.slice(start, end).indexOf("\n") >= 0) continue;
      const expected = String((item && item.name) || "");
      if (expected && value.slice(start, end) !== expected) continue;
      next.push({ start, end, name:expected || value.slice(start, end), cls:"tk-param" });
    }
    paramSemanticRanges = next.sort((a, b) => a.start - b.start || a.end - b.end);
    semanticRangeText = value;
    refresh(); sync();
  };
  const clearParamRanges = () => {
    if (!paramSemanticRanges.length) return;
    paramSemanticRanges = [];
    refresh(); sync();
  };
  const dedupeSelectedLines = () => {
    const before = ta.value;
    applyLineAction("dedupe");
    return Math.max(0, before.split("\n").length - ta.value.split("\n").length);
  };
  /* 줄 정리(정렬·빈 줄 삭제·번호 매기기 …) — 되돌리기는 applyLineAction 이 앞뒤로 commitNow 를 부르므로
     아무리 많은 줄이 바뀌어도 Ctrl+Z 한 번에 통째로 돌아간다. 따라치기 중에는 막는다: 교본 위에 그대로
     치는 중이라 내가 치지 않은 변화가 끼어들면 채점 위치(practice.pos)가 어긋난다. */
  const applyLineTidy = (action) => {
    if (practice.active) return null;
    const before = ta.value;
    applyLineAction(action);
    if (ta.value === before) return { changed:false, lineDelta:0 };
    return { changed:true, lineDelta: before.split("\n").length - ta.value.split("\n").length };
  };
  const detachTextContextMenu = attachTextCaseContextMenu(ta, {
    replaceSelection: (replacement, selection) => {
      const start = Math.max(0, Math.min(selection.start, ta.value.length));
      const end = Math.max(start, Math.min(selection.end, ta.value.length));
      if (ta.value.slice(start, end) === replacement) return false;
      hideCompletion(); exitCol(); clearTimeout(coalesceTimer);
      rememberHistoryCaret(); commitNow();
      ta.setRangeText(replacement, start, end, "select");
      emitInput();
      clearTimeout(coalesceTimer); commitNow(); sync();
      return true;
    },
    dedupeSelectedLines,
    // 열 편집 중에는 사각 선택 전용 항목을 맨 위에 얹는다(네이티브 선택이 비어 있어 기본 복사 항목은 꺼져 있다).
    contextMenuActions: () => {
      const base = typeof options.contextMenuActions === "function"
        ? (options.contextMenuActions() || [])
        : (Array.isArray(options.contextMenuActions) ? options.contextMenuActions : []);
      if (!col.active) return base;
      const empty = col.rightCol <= col.leftCol;
      const items = [
        { label:"열 복사", action:() => colCopy(false), disabled:empty },
        { label:"열 잘라내기", action:() => colCopy(true), disabled:empty }
      ];
      return base.length ? items.concat([{ separator:true }], base) : items;
    }
  });
  /* ===== 코드 따라치기: 채점·시작·종료 ===== */
  // 줄 앞 들여쓰기는 자동으로 통과시킨다(맞은 것으로 처리). 파이썬 4칸을 매번 세어 치는 건 연습이 아니라
  // 고역이고, 실제 타자 연습 도구들도 같은 방식이다.
  const practiceSkipIndent = () => {
    const target = practice.target;
    while (practice.pos < target.length && (target[practice.pos] === " " || target[practice.pos] === "\t")){
      practice.marks[practice.pos] = 1; practice.shown[practice.pos] = target[practice.pos]; practice.pos++;
    }
  };
  // 줄 끝에 남아 있는 공백은 화면에 보이지 않는다 — 여기서 Enter 를 쳤다고 틀렸다고 하면 억울하므로
  // (그리고 그 뒤가 전부 한 칸씩 밀린다) 뒤가 줄바꿈일 때만 그 공백들을 맞은 것으로 넘긴다.
  const practiceSkipLineTail = () => {
    const target = practice.target;
    let at = practice.pos;
    while (at < target.length && (target[at] === " " || target[at] === "\t")) at++;
    if (at >= target.length || target[at] !== "\n") return;
    while (practice.pos < at){ practice.marks[practice.pos] = 1; practice.shown[practice.pos] = target[practice.pos]; practice.pos++; }
  };
  // 캐럿이 줄 앞 들여쓰기 구간(앞쪽이 전부 공백)에 있나 — 학생이 직접 친 들여쓰기를 흘려보낼지 판단한다.
  const practiceAtIndent = () => {
    const target = practice.target;
    for (let i = practice.pos - 1; i >= 0; i--){
      const ch = target[i];
      if (ch === "\n") return true;
      if (ch !== " " && ch !== "\t") return false;
    }
    return true;                                 // 문서 첫 줄
  };
  // 틀린 자리에는 내가 친 글자를 그대로 보여 준다(무엇을 잘못 눌렀는지 바로 보이게).
  // 줄바꿈·탭만은 그 자리에 그릴 수 없어(줄이 밀리거나 탭 정지점이 튄다) 교본 글자를 빨갛게 두는 것으로 대신한다.
  const practiceShownChar = (typed, want) => (!typed || typed === "\n" || typed === "\t") ? want : typed;
  // 한글·한자는 고정폭 글꼴에서 두 칸을 차지한다. 한 칸짜리 자리에 그대로 그리면 그 줄 전체가 밀리므로
  // '영문 자리엔 영문만, 한글 자리엔 한글만' 받는다. 폭이 다른 키는 아예 넘어가지 않고 그 자리에서 막힌다
  // (한/영 키를 안 누른 채 한 줄을 다 치면 그 뒤가 통째로 빨개지는 것도 이걸로 같이 막힌다).
  const wideChar = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;   // 한글 자모·완성형·한자·전각 기호 등 '두 칸짜리' 글자
  const practiceWidthMismatch = (typed, want) => wideChar.test(typed) !== wideChar.test(want);
  let practiceHintAt = 0;
  const practiceRejectKey = (typed) => {
    practice.rejectAt = practice.pos;
    clearTimeout(practice.rejectTimer);
    practice.rejectTimer = setTimeout(() => { practice.rejectAt = -1; if (practice.active) renderPracticeCode(); }, 700);
    const now = Date.now();
    if (typeof toast === "function" && now - practiceHintAt > 4000){
      practiceHintAt = now;
      toast(wideChar.test(typed) ? "여기는 영문 자리예요. 한/영 키를 눌러 영문으로 바꿔 보세요."
                                 : "여기는 한글 자리예요. 한/영 키를 눌러 한글로 바꿔 보세요.", 2600);
    }
  };
  const practiceStats = () => {
    const ms = Math.max(1, Date.now() - practice.startedAt);
    const total = practice.target.length, done = practice.pos;
    return { total, done, wrong:practice.wrong, bad:practice.bad,
      percent:total ? Math.round((done / total) * 100) : 100,
      // 정확도는 '지금 화면에 남아 있는 빨간 글자' 기준 — 틀린 자리를 지우고 다시 똑바로 치면 도로 올라간다.
      // (wrong 은 고친 것까지 포함한 실수 횟수라 따로 센다)
      accuracy:done ? Math.round(((done - practice.bad) / done) * 100) : 100,
      seconds:Math.max(1, Math.round(ms / 1000)), cpm:Math.round(done / (ms / 60000)) };
  };
  const practiceGrade = () => {
    const target = practice.target, current = ta.value;
    if (current !== target){
      const delta = current.length - target.length;
      const keepTop = ta.scrollTop, keepLeft = ta.scrollLeft;   // 값을 다시 넣으면 스크롤이 맨 위로 튀는 브라우저 보정
      // 캐럿 자리(pos)에 delta 글자가 끼어들었다 = 방금 친 글자. 앞뒤가 교본 그대로인지 확인해 오인식을 막는다.
      if (delta > 0 && current.slice(0, practice.pos) === target.slice(0, practice.pos)
          && current.slice(practice.pos + delta) === target.slice(practice.pos)){
        const added = current.slice(practice.pos, practice.pos + delta);
        ta.value = target;                                      // 친 글자는 지우고 교본 글자를 그대로 둔다
        for (let i = 0; i < added.length && practice.pos < target.length; i++){
          const ch = added[i];
          // 줄 앞 들여쓰기는 이미 자동으로 넘어갔다. 그 자리에서 배운 대로 공백·탭을 직접 더 쳐도
          // 틀린 것으로 세지 않고 그냥 흘려보낸다 — 안 그러면 그때부터 한 칸씩 밀려, 맞게 친 뒷글자가 전부 빨개진다.
          if ((ch === " " || ch === "\t") && practiceAtIndent()) continue;
          if (ch === "\n") practiceSkipLineTail();              // 줄 끝에 눈에 안 보이는 공백이 있어도 통과
          // 영문 자리에 한글(또는 그 반대)은 폭이 달라 줄이 밀린다 → 넘어가지 않고 그 자리에서 막는다.
          if (practiceWidthMismatch(ch, target[practice.pos])){
          practiceRejectKey(ch);
            practice.wrong++;                                   // 한 칸도 못 나갔으니 실수 횟수만 센다
            continue;
          }
          const want = target[practice.pos], hit = ch === want;
          practice.marks[practice.pos] = hit ? 1 : 2;
          practice.shown[practice.pos] = hit ? want : practiceShownChar(ch, want);
          practice.pos++;
          if (!hit){ practice.wrong++; practice.bad++; }        // 관대 모드: 틀려도 막지 않고 빨갛게만 남긴다
          else if (want === "\n") practiceSkipIndent();
        }
      } else if (delta < 0 && current.slice(0, practice.pos + delta) === target.slice(0, practice.pos + delta)
                 && current.slice(practice.pos + delta) === target.slice(practice.pos)){
        const back = Math.max(0, practice.pos + delta);         // 지운(백스페이스) 만큼 되돌아간다
        // 지워서 화면에서 사라진 빨간 글자는 정확도에서도 빠진다 → 다시 똑바로 치면 정확도가 도로 올라간다.
        for (let i = back; i < practice.pos; i++) if (practice.marks[i] === 2) practice.bad--;
        practice.pos = back;
        ta.value = target;
      } else ta.value = target;                                 // 예상 못 한 편집(전체 선택 후 입력 등) — 교본만 되돌린다
      ta.scrollTop = keepTop; ta.scrollLeft = keepLeft;
    }
    ta.setSelectionRange(practice.pos, practice.pos);
    renderPracticeCode();
    scrollCaretIntoView();
    if (typeof practice.onProgress === "function") { try { practice.onProgress(practiceStats()); } catch(_){} }
    if (practice.pos >= target.length) stopPractice("done");
  };
  const startPractice = (options={}) => {
    if (practice.active || !ta.value.trim()) return false;
    const target = ta.value;
    exitCol(); exitLinkedEdit(); hideCompletion(); hideHelp(); clearWordHi(); clearDefinitionHover();
    clearError(); clearTraceLine(); clearUnusedRanges(); clearParamRanges();
    if (findOpen) closeFind();
    clearTimeout(coalesceTimer);
    practice.active = true; practice.target = target; practice.pos = 0;
    practice.marks = new Uint8Array(target.length);
    practice.shown = target.split("");
    practice.bad = 0; practice.wrong = 0; practice.composing = false;
    practice.rejectAt = -1; clearTimeout(practice.rejectTimer); practice.rejectTimer = 0;
    practice.startedAt = Date.now();
    practice.onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    practice.onDone = typeof options.onDone === "function" ? options.onDone : null;
    edit.classList.add("code-practice");
    practiceSkipIndent();                        // 첫 줄 들여쓰기부터 자동 통과
    ta.setSelectionRange(practice.pos, practice.pos);
    ta.scrollTop = 0; ta.scrollLeft = 0;
    renderPracticeCode(); sync();
    ta.focus({ preventScroll:true });
    if (practice.onProgress) { try { practice.onProgress(practiceStats()); } catch(_){} }
    return true;
  };
  // reason: "done"=끝까지 침 / "cancel"=Esc·버튼으로 그만둠. 본문은 연습 내내 교본 그대로였으므로 표시만 되돌리면 된다.
  const stopPractice = (reason="cancel") => {
    if (!practice.active) return null;
    const stats = practiceStats();
    const target = practice.target, done = practice.onDone;
    practice.active = false; practice.target = ""; practice.marks = null; practice.shown = null; practice.pos = 0;
    practice.composing = false; practice.onProgress = null; practice.onDone = null;
    practice.rejectAt = -1; clearTimeout(practice.rejectTimer); practice.rejectTimer = 0;
    edit.classList.remove("code-practice");
    if (ta.value !== target) ta.value = target;  // 조합이 끝나기 전에 그만둔 경우 대비
    ta.setSelectionRange(0, 0);
    ta.scrollTop = 0; ta.scrollLeft = 0;
    history.reset();                             // 연습하며 오간 값이 되돌리기(Ctrl+Z)에 남지 않게
    semanticRangeText = ta.value;
    refresh(); sync();
    if (done) { try { done(reason, stats); } catch(_){} }
    return stats;
  };

  refresh();
  return { host, ta,
    // 따라치기 중에는 '교본(원본)'을 돌려준다 — 저장·자동저장·실행·초안이 치다 만 글자를 파일에 덮어쓰지 않게 하는 핵심 방어선.
    getValue: () => practice.active ? practice.target : ta.value,
    setValue: (v) => { stopPractice("cancel"); exitCol(); ta.value = v; emitInput(); },
    getCursorLine: () => lineNumberAtOffset(ta.value, ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd),
    openContextMenu: (event) => detachTextContextMenu.open(event),
    // 줄바꿈을 켜면 겹쳐 그리던 층(강조·열 편집·찾기 상자)이 CSS 로 내려가므로, 열 편집 중이면 먼저 빠져나온다.
    setWrap: (on) => { if (on) exitCol(); return setEditorWrap(host, ta, on); },
    focusLine,
    setPinProvider: (fn) => { pinProvider = fn; buildPinMarks(); },         // 코드→PDF 역방향 핀 공급자 등록 후 즉시 그림
    refreshPins: buildPinMarks,
    formatDocument: formatDocumentNow,
    dedupeSelectedLines, applyLineTidy,
    canFormat: () => !plainMode && prof === "python",
    startPractice, stopPractice, isPracticeActive: () => practice.active,
    destroy: () => {
      if (practice.active) stopPractice("cancel");
      detachTextContextMenu();
      if (ta._mnSpellcheckController) ta._mnSpellcheckController.destroy();
      clearJump(); hideCompletion(); hideHelp(); clearTimeout(pinRenderTimer); cancelAnimationFrame(syncRaf); cancelAnimationFrame(sbRaf);
      document.removeEventListener("selectionchange", syncSelection);
      document.removeEventListener("pointerdown", closeCompletionOnOutsidePointer, true);
      window.removeEventListener("scroll", hidePortalOnScroll, true);
      window.removeEventListener("resize", hidePortalOnScroll);
      help.remove();
      diagnosticTip.remove();
      if (completionPortal) complete.remove();
      if (editorResizeObserver) editorResizeObserver.disconnect();
    },
    openFind, closeFind, isFindOpen: () => findOpen, isCompletionOpen: () => !complete.hidden,
    openGoto, closeGoto: gotoBar.close, isGotoOpen: gotoBar.isOpen,
    markError, markErrorLines, setDiagnosticItems, clearError, setUnusedRanges, clearUnusedRanges, setParamRanges, clearParamRanges, showTraceLine, clearTraceLine, highlightCellRange, clearCellBand,
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

  // 줄 번호로 이동(Ctrl+G) — 일반 편집기와 같은 창을 쓴다(처음 열 때 만든다).
  let gotoBar = null;
  const openGoto = () => {
    if (!gotoBar) gotoBar = mountGotoLineBar({
      mount: edit,
      totalLines: () => countLines(ta.value),
      snapshot: () => ta.scrollTop,
      restore: (top) => { ta.scrollTop = top; syncScroll(); },
      preview: (line) => {
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
        ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight * 0.4);
        syncScroll();
      },
      commit: (line) => focusLine(line)
    });
    gotoBar.open();
  };

  // ===== 가벼운 찾기(Ctrl+F): 문자열을 찾아 textarea 안에서 선택·스크롤(강조 오버레이 없이 네이티브 선택만) =====
  let findBar = null, findInput = null, findCount = null, findOpen = false, findHistory = null;
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
    // 최근 검색어 — 강조 오버레이가 없는 가벼운 편집기도 같은 목록(text 구획)을 쓴다.
    findHistory = (typeof MNSearchHistory === "object" && MNSearchHistory)
      ? MNSearchHistory.attach(findInput, { scope: "text", mount: findBar, className: "search-history-row", onPick: runSearch })
      : null;
    const remember = () => { if (findHistory) findHistory.remember(findInput.value); };
    // 한글 IME 조합 중(isComposing)에는 검색하지 않는다 — 조합 도중 재검색이 조합을 방해하지 않게, 조합 확정 후에만.
    findInput.addEventListener("input", (e) => { if (e.isComposing) return; runSearch(); });
    findInput.addEventListener("compositionend", runSearch);
    findInput.addEventListener("keydown", (e) => {
      if (e.isComposing) return;                          // 조합 확정용 Enter 는 검색 이동으로 가로채지 않는다
      if (e.key === "Enter"){ e.preventDefault(); remember(); goMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape"){ e.preventDefault(); closeFind(); }
    });
    prev.addEventListener("click", () => { remember(); goMatch(-1); findInput.focus(); });
    next.addEventListener("click", () => { remember(); goMatch(1); findInput.focus(); });
    close.addEventListener("click", closeFind);
    edit.appendChild(findBar);
  };
  const openFind = (seed) => {
    if (!findBar) buildFindBar();
    findBar.hidden = false; findOpen = true;
    if (seed && seed !== findInput.value){ findInput.value = seed; computeMatches(); if (matches.length){ matchIdx = -1; goMatch(1); } }
    // 넘겨준 검색어도, 적혀 있던 것도 없으면 마지막으로 찾던 말을 채워 준다.
    else if (!findInput.value && findHistory){
      const last = MNSearchHistory.last("text");
      if (last){ findInput.value = last; computeMatches(); if (matches.length){ matchIdx = -1; goMatch(1); } }
    }
    findInput.focus(); findInput.select();
  };

  /* 가벼운 편집기에는 자체 되돌리기 이력이 없어 브라우저 기본 undo 에 기댄다. ta.value 에 직접 대입하면
     그 이력이 통째로 지워지므로(정렬을 잘못 눌러도 Ctrl+Z 가 먹지 않는다) 문서 전체를 setRangeText 로
     한 번에 갈아 끼운다 — 한 단계로 묶이면서 되돌리기가 남는다. */
  const applyLineAction = (action) => {
    const before = ta.value;
    const next = transformEditorLines(before, ta.selectionStart, ta.selectionEnd, action);
    if (next.value === before) return false;
    ta.focus({ preventScroll:true });
    ta.setRangeText(next.value, 0, before.length, "end");
    ta.setSelectionRange(next.selectionStart, next.selectionEnd);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    syncScroll();
    return true;
  };
  const dedupeSelectedLines = () => {
    const before = ta.value;
    if (!applyLineAction("dedupe")) return 0;
    return Math.max(0, before.split("\n").length - ta.value.split("\n").length);
  };
  const applyLineTidy = (action) => {
    const before = ta.value;
    if (!applyLineAction(action)) return { changed:false, lineDelta:0 };
    return { changed:true, lineDelta: before.split("\n").length - ta.value.split("\n").length };
  };

  const detachTextContextMenu = attachTextCaseContextMenu(ta, {
    replaceSelection: (replacement, selection) => {
      const start = Math.max(0, Math.min(selection.start, ta.value.length));
      const end = Math.max(start, Math.min(selection.end, ta.value.length));
      if (ta.value.slice(start, end) === replacement) return false;
      ta.setRangeText(replacement, start, end, "select");
      ta.dispatchEvent(new Event("input", { bubbles:true }));
      syncScroll();
      return true;
    },
    dedupeSelectedLines
  });

  renderGutter();
  return {
    host, ta,
    getValue: () => ta.value,
    setValue: (v) => { ta.value = v; renderGutter(); ta.dispatchEvent(new Event("input", { bubbles: true })); },
    getCursorLine: () => lineAtOffset(ta.value, ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd),
    setWrap: (on) => setEditorWrap(host, ta, on),
    focusLine, dedupeSelectedLines, applyLineTidy, openFind, closeFind, isFindOpen: () => findOpen,
    openGoto, closeGoto: () => { if (gotoBar) gotoBar.close(); }, isGotoOpen: () => !!gotoBar && gotoBar.isOpen(),
    destroy: () => {
      detachTextContextMenu();
      if (ta._mnSpellcheckController) ta._mnSpellcheckController.destroy();
      ta.removeEventListener("scroll", syncScroll); if (findBar) findBar.remove(); if (gotoBar) gotoBar.destroy();
    }
  };
}
