"use strict";

/* ===== Word(.docx) 문단 편집 화면 (설계: docs/워드-문단편집-설계.md) =====
   보기 모드는 docx-preview 가 그린 화면 그대로 두고, 편집 모드에서만 자체 문단 화면을 만든다.
   docx-preview 는 DOM ↔ 원본 XML 매핑을 남기지 않아 그 위에서 편집할 수 없기 때문이다
   (Phase 1에서 이미 확인하고 버린 길).

   이 파일은 화면만 맡는다. "무엇을 어떻게 되쓸지" 는 전부 MNOfficeReplace 의 순수 함수가 정하고,
   여기서는 행 배열(rows)만 들고 있다가 저장할 때 통째로 넘긴다.

   행 하나 = 문단 하나:
     { key, index, text, original, style, inTable, hasSectPr, locked, removed, after, touched }
     index 0 = 이번에 새로 만든 문단(after = 이 순번 뒤에 넣는다) */

const MNDocxEditor = (() => {

  const PLACEHOLDER = "(빈 문단)";
  let rowSeq = 0;

  const canEditDocs = () => typeof MNOfficeReplace === "object" && !!MNOfficeReplace;

  // 설정(설정▸문서)은 편집을 시작할 때 한 번 읽는다 — 여는 도중에 바뀌어도 한 화면 안에서는 고정.
  function editorOptions(){
    const settings = (typeof appSettings === "object" && appSettings) ? appSettings : {};
    return { includeAttached: false, allowTrackedChanges: settings.officeReplaceTracked === true };
  }

  /* ---------- 행 모델 ---------- */

  function rowsFromOutline(outline){
    return (outline || []).map(item => ({
      key: ++rowSeq,
      index: item.index,
      text: item.text,
      original: item.text,
      style: item.style,
      inTable: item.inTable,
      tableIndex: item.tableIndex || 0,
      tableRow: item.tableRow || 0,
      tableCell: item.tableCell || 0,
      tableHasNested: !!item.tableHasNested,
      tableHasVerticalMerge: !!item.tableHasVerticalMerge,
      tableHasGridSpan: !!item.tableHasGridSpan,
      tableRectangular: !!item.tableRectangular,
      tableRowCount: item.tableRowCount || 0,
      tableColumnCount: item.tableColumnCount || 0,
      hasSectPr: item.hasSectPr,
      hasTextbox: item.hasTextbox,
      locked: item.locked,
      removed: false,
      after: 0,
      touched: false
    }));
  }

  // 새 문단은 "바로 위 원본 문단" 뒤에 들어간다. 위쪽이 전부 새 문단이면 그 위를 더 훑는다.
  function anchorIndexFor(rows, at){
    for (let i = at; i >= 0; i--){
      const row = rows[i];
      if (row && row.index && !row.removed) return row.index;
    }
    return 0;
  }

  function makeNewRow(source, text){
    return {
      key: ++rowSeq, index: 0, text: String(text || ""), original: null,
      style: source ? source.style : "", inTable: false,
      tableIndex: 0, tableRow: 0, tableCell: 0, tableHasNested: false,
      tableHasVerticalMerge: false, tableHasGridSpan: false, tableRectangular: false,
      tableRowCount: 0, tableColumnCount: 0,
      hasSectPr: false, hasTextbox: false,
      locked: false, removed: false, after: 0, touched: true
    };
  }

  const rowsDirty = (rows) => rows.some(row =>
    row.removed || !row.index || String(row.text) !== String(row.original));

  /* ---------- 화면 ---------- */

  function styleLabelOf(row){
    if (row.style) return row.style;
    return row.inTable ? "표" : "본문";
  }

  /* 문단 한 줄. 처음에는 원문 글자를 그대로 보여주고, 사용자가 손대면 그 문단은
     '고침' 표시를 달아 화면과 저장 대상이 어긋나지 않는다는 걸 눈으로 알린다. */
  function renderRow(state, row, position){
    const wrap = document.createElement("div");
    wrap.className = "docx-para";
    if (row.inTable) wrap.classList.add("in-table");
    if (row.removed) wrap.classList.add("removed");
    if (row.locked) wrap.classList.add("locked");

    const style = document.createElement("span");
    style.className = "docx-para-style";
    style.textContent = styleLabelOf(row);
    if (row.hasSectPr) style.title = "쪽 설정(용지·여백·머리말 연결)이 든 문단이라 지울 수 없어요.";
    else if (row.inTable) style.title = "표 안 문단이에요. 글자는 고칠 수 있지만 더하거나 지울 수 없어요.";
    else if (row.hasTextbox) style.title = "텍스트 상자가 딸린 문단이에요. 상자 안 글자는 여기서 고칠 수 없고, 이 문단을 지우면 상자도 함께 사라져요.";

    const text = document.createElement("div");
    text.className = "docx-para-text";
    text.contentEditable = row.removed ? "false" : "true";
    text.spellcheck = false;
    text.dataset.key = String(row.key);
    text.textContent = row.text;
    if (!row.text) text.dataset.placeholder = PLACEHOLDER;
    if (row.locked) text.title = "탭·줄바꿈이 든 문단이에요. 그 자리를 건드리면 저장에서 빠집니다.";

    const tools = document.createElement("div");
    tools.className = "docx-para-tools";
    const addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "docx-para-btn"; addBtn.textContent = "＋";
    addBtn.title = "아래에 문단 추가";
    addBtn.disabled = row.inTable;
    addBtn.addEventListener("click", () => {
      const at = state.rows.indexOf(row);
      const made = makeNewRow(row, "");
      made.after = anchorIndexFor(state.rows, at);
      state.rows.splice(at + 1, 0, made);
      state.focusKey = made.key;
      redraw(state);
      state.commitNow();
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button"; delBtn.className = "docx-para-btn"; delBtn.textContent = row.removed ? "↩" : "🗑";
    delBtn.title = row.removed ? "삭제 취소"
      : (row.hasTextbox ? "이 문단 지우기 — 딸린 텍스트 상자도 함께 사라져요" : "이 문단 지우기");
    delBtn.disabled = !row.removed && (row.inTable || row.hasSectPr);
    delBtn.addEventListener("click", () => {
      if (!row.index){ state.rows.splice(state.rows.indexOf(row), 1); }      // 새로 만든 문단은 그냥 뺀다
      else row.removed = !row.removed;
      redraw(state);
      state.commitNow();
    });
    tools.append(addBtn, delBtn);

    text.addEventListener("input", () => {
      row.text = text.textContent;
      if (!row.touched){ row.touched = true; wrap.classList.add("touched"); }
      if (row.text) delete text.dataset.placeholder; else text.dataset.placeholder = PLACEHOLDER;
      state.onDirty();
    });
    text.addEventListener("keydown", (e) => onRowKey(e, state, row, text));

    if (row.touched) wrap.classList.add("touched");
    wrap.append(style, text, tools);
    return wrap;
  }

  /* Enter = 커서 자리에서 문단 나누기(Word 와 같다) · 빈 문단에서 Backspace = 그 문단 지우기.
     표 안 문단에서는 둘 다 막는다 — 셀 구조가 깨진다. */
  function onRowKey(e, state, row, textEl){
    // 제자리 편집에서는 상자 안 글자를 빼고 탭·줄바꿈을 되돌린 평문을 쓴다(목록 화면은 칸 글자 그대로).
    const textIn = (el) => state.mode === "inline" ? inlineTextOf(el) : el.textContent;
    if (e.key === "Enter" && !e.shiftKey){
      e.preventDefault();
      if (row.inTable){ toastOnce("표 안에서는 문단을 나눌 수 없어요."); return; }
      const caret = caretOffsetIn(textEl);
      const value = textIn(textEl);
      const at = state.rows.indexOf(row);
      row.text = value.slice(0, caret);
      if (state.mode !== "inline") textEl.textContent = row.text;   // 제자리 편집은 redrawInline 이 맞춘다
      row.touched = true;
      const made = makeNewRow(row, value.slice(caret));
      made.after = anchorIndexFor(state.rows, at);
      state.rows.splice(at + 1, 0, made);
      state.focusKey = made.key;
      redraw(state);
      state.commitNow();
      return;
    }
    if (e.key === "Backspace" && !textIn(textEl) && caretOffsetIn(textEl) === 0){
      const at = state.rows.indexOf(row);
      if (at <= 0) return;
      if (row.inTable || row.hasSectPr){ toastOnce("이 문단은 지울 수 없어요."); e.preventDefault(); return; }
      e.preventDefault();
      if (!row.index) state.rows.splice(at, 1);
      else row.removed = true;
      state.focusKey = state.rows[at - 1] && state.rows[at - 1].key;
      redraw(state);
      state.commitNow();
    }
  }

  function caretOffsetIn(el){
    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return 0;
      const range = sel.getRangeAt(0).cloneRange();
      range.selectNodeContents(el);
      range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      return range.toString().length;
    } catch(_){ return 0; }
  }

  let lastToastAt = 0;
  function toastOnce(message){
    const now = Date.now();
    if (now - lastToastAt < 1200) return;      // 키를 눌러 대도 토스트가 쌓이지 않게
    lastToastAt = now;
    if (typeof toast === "function") toast(message, 2200);
  }

  function redraw(state){
    if (state.mode === "inline") return redrawInline(state);
    const list = state.listEl;
    list.innerHTML = "";
    state.rows.forEach((row, position) => list.appendChild(renderRow(state, row, position)));
    state.onDirty();
    focusRowKey(state, (key) => list.querySelector('[data-key="' + key + '"]'));
  }

  // 구조가 바뀐 뒤 커서를 옮길 자리. 입력 중에는 부르지 않는다(커서가 튄다).
  function focusRowKey(state, find){
    if (!state.focusKey) return;
    const target = find(state.focusKey);
    state.focusKey = 0;
    if (!target) return;
    target.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
    } catch(_){}
  }

  /* ---------- 미리보기 제자리 편집 ---------- */

  /* 미리보기에서 "본문 문단" 만 골라낸다. docx-preview 는 본문 말고도 <p> 를 만든다:
       - 머리말·꼬리말 → <header>/<footer>, 게다가 쪽마다 되풀이해 그린다
       - 각주·미주 → 쪽 아래 <ol>
       - 텍스트 상자 → 그림 <div> 안에 본문처럼 문단을 또 그린다(= <p> 안의 <p>)
     셋 다 조상으로 갈라지고, 남는 것이 document.xml 의 <w:p> 차례와 같아진다
     (officeParagraphOutline 도 도형 안 문단은 세지 않는다). 정말 같은지는 officeInlineMapVerify 가 본다. */
  function inlineBodyParagraphs(previewEl){
    if (!previewEl) return [];
    return Array.from(previewEl.querySelectorAll("p")).filter(node =>
      !node.closest("header, footer, ol") && !(node.parentElement && node.parentElement.closest("p")));
  }

  /* 화면 문단 → 모델과 같은 평문.
     docx-preview 가 글자를 그대로 옮기지 않는 두 자리를 되돌린다.
       <w:tab/> → <span>&emsp;</span> (em 공백 하나만 든 span)  ⇒ "\t"
       <w:br/>  → <br> (textContent 에 아무것도 안 남는다)      ⇒ "\n"
     되돌리지 않으면 문단을 고칠 때 diff 가 탭·줄바꿈 자리까지 바뀐 것으로 보고,
     그 자리는 잠긴 조각이라 문단째 저장에서 빠진다. 텍스트 상자 안 문단은 세지 않는다. */
  function inlineTextOf(node){
    let out = "";
    for (const child of node.childNodes){
      if (child.nodeType === 3){ out += child.nodeValue; continue; }
      if (child.nodeType !== 1) continue;
      if (child.tagName === "P") continue;                       // 텍스트 상자 안 문단
      if (child.tagName === "BR"){ out += "\n"; continue; }
      if (child.tagName === "SPAN" && child.textContent === "\u2003"){ out += "\t"; continue; }
      out += child.querySelector("p, br") ? inlineTextOf(child) : child.textContent;
    }
    return out;
  }

  /* 문단 하나를 편집할 수 있게 손본다.
     탭·줄바꿈이 든 문단(locked)을 읽기 전용으로 두는 이유: 화면의 em 공백·<br> 을 되돌려 놓아도
     그 자리를 실제로 건드리면 되쓸 안전한 자리가 없어 저장에서 빠진다. 고칠 수 있는 것처럼
     보여 놓고 조용히 빠뜨리는 대신, 처음부터 못 고치게 하고 이유를 붙인다. */
  function inlinePrepareNode(state, row, node){
    node.dataset.key = String(row.key);
    node.classList.add("docx-inline-para");
    node.classList.toggle("removed", !!row.removed);
    node.classList.toggle("touched", !!row.touched);
    node.classList.toggle("locked", !!row.locked);
    const markerLocked = state.inlineLockedKeys && state.inlineLockedKeys.has(row.key);
    const editable = !row.removed && !row.locked && !markerLocked;
    node.contentEditable = editable ? "true" : "false";
    node.spellcheck = false;
    // 상자 안 문단은 바깥이 편집 가능해도 따라 열리지 않게 못을 박는다(상자 글자는 v1 대상이 아니다).
    for (const inner of node.querySelectorAll("p")) inner.contentEditable = "false";
    if (markerLocked) node.title = "화면 글자와 저장할 문단이 달라 이 문단은 여기서 고칠 수 없어요.";
    else if (row.locked) node.title = "탭·줄바꿈이 든 문단이라 여기서는 고칠 수 없어요. 문단 목록에서 고쳐 주세요.";
    else if (row.hasTextbox) node.title = "텍스트 상자가 딸린 문단이에요. 상자 안 글자는 고칠 수 없고, 이 문단을 지우면 상자도 사라져요.";
    else if (row.inTable) node.title = "표 안 문단이에요. 글자는 고칠 수 있지만 더하거나 지울 수 없어요.";
    else node.removeAttribute("title");
  }

  // 글자만 든 문단인가 — 그림·상자·줄바꿈이 섞여 있으면 통째로 다시 쓰지 않는다.
  const inlineCanRewrite = (node) => !node.querySelector("p, img, svg, br, table");

  // 행 배열에 맞춰 미리보기 DOM 을 손본다. 입력 중에는 부르지 않고 구조가 바뀔 때만 부른다.
  function redrawInline(state){
    let anchor = null;
    for (const row of state.rows){
      let node = state.nodeByKey.get(row.key);
      if (!node){
        // 임시 북마크로도 화면에 나타나지 않은 원본 문단은 만들지 않는다. 숨은 XML 문단을
        // 억지로 화면에 끼우면 표·페이지 구조가 오히려 바뀐다. 새 문단만 실제 DOM 을 만든다.
        if (row.index) continue;
        // 새 문단은 바로 앞 문단을 껍데기만 복제한다 — 문단 서식(정렬·들여쓰기)이 이어지고,
        // run 서식은 따라오지 않는다. officeNewParagraphXml 이 pPr 만 물려받는 것과 같은 결.
        node = anchor ? anchor.cloneNode(false) : document.createElement("p");
        node.textContent = "";
        state.nodeByKey.set(row.key, node);
        // 자리에 넣는 건 이때뿐이다. 이미 있던 문단은 docx-preview 가 놓은 자리가 옳다 —
        // 표 셀 문단은 저마다 다른 <td> 안에 살아서, 앞 문단 옆으로 옮기면 표가 통째로 뜯어진다.
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
      }
      inlinePrepareNode(state, row, node);
      // 글자를 통째로 갈아 끼우면 그 문단의 그림·텍스트 상자가 화면에서 사라진다(XML 에는 남지만
      // 화면이 거짓말을 하게 된다). 그런 문단은 화면을 그대로 두고 행 모델만 저장에 쓴다.
      if (!(state.inlineLockedKeys && state.inlineLockedKeys.has(row.key)) &&
          inlineCanRewrite(node) && inlineTextOf(node) !== row.text) node.textContent = row.text;
      anchor = node;
    }
    const alive = new Set(state.rows.map(row => row.key));
    for (const [key, node] of Array.from(state.nodeByKey)){
      if (alive.has(key)) continue;
      if (node.parentNode) node.parentNode.removeChild(node);
      state.nodeByKey.delete(key);
    }
    state.onDirty();
    focusRowKey(state, (key) => state.nodeByKey.get(key));
  }

  const inlineRowOf = (state, node) => {
    const key = node && node.dataset ? Number(node.dataset.key) : 0;
    return key ? state.rows.find(row => row.key === key) : null;
  };

  /* 미리보기를 편집 화면으로 삼는다. 붙기 전에 화면 문단과 문서 문단이 같은 것을 가리키는지
     전부 맞춰 보고, 하나라도 어긋나면 붙지 않는다(부르는 쪽이 목록 화면으로 물러난다).
     반환: { ok } 또는 { ok:false, reason } */
  function inlineBind(state){
    const nodes = inlineBodyParagraphs(state.previewEl);
    const check = officeInlineMapVerify(nodes.map(inlineTextOf), state.rows);
    if (!check.ok) return check;
    state.nodeByKey = new Map();
    state.inlineLockedKeys = new Set();
    state.rows.forEach((row, i) => state.nodeByKey.set(row.key, nodes[i]));
    state.rows.forEach(row => inlinePrepareNode(state, row, state.nodeByKey.get(row.key)));
    return { ok: true };
  }

  /* 글자/개수 대조가 실패한 문서는 임시 북마크를 넣은 바이트로 미리보기만 한 번 다시 그린다.
     docx-preview 가 북마크 이름을 span id 로 남기므로 표 병합·필드·렌더러 생략 문단이 있어도
     실제 XML 문단을 정확히 찾는다. 임시 바이트는 저장하지 않고 marker span 도 곧바로 걷는다. */
  async function inlineBindWithMarkers(state){
    if (typeof officeParagraphMarkerPlan !== "function" || typeof docxRenderInto !== "function")
      return { ok: false, reason: "문단 위치 표시 기능을 사용할 수 없어요." };
    const prefix = "_mn_docx_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8) + "_";
    const plan = officeParagraphMarkerPlan(state.xml, prefix);
    if (!plan.markers.length) return { ok: false, reason: "표시할 문단이 없어요." };
    try {
      const markedBytes = await MNOfficeReplace.build(state.source.bytes, { "word/document.xml": plan.xml });
      await docxRenderInto(markedBytes, state.previewEl);
    } catch(e){
      console.warn("문단 위치 표시 미리보기 실패:", e);
      return { ok: false, reason: "문단 위치를 확인하지 못했어요." };
    }

    const elementsById = new Map();
    for (const el of state.previewEl.querySelectorAll("[id]")){
      if (!elementsById.has(el.id)) elementsById.set(el.id, []);
      elementsById.get(el.id).push(el);
    }
    const byIndex = new Map(state.rows.filter(row => row.index).map(row => [row.index, row]));
    const nodeByKey = new Map(), locked = new Set(), markerEls = [];
    for (const marker of plan.markers){
      const found = elementsById.get(marker.name) || [];
      markerEls.push(...found);
      if (found.length !== 1) continue;                 // 중복 렌더나 미표시는 편집 대상으로 잡지 않는다
      const row = byIndex.get(marker.index);
      const node = found[0].closest("p");
      if (!row || !node || !state.previewEl.contains(node) || nodeByKey.has(row.key)) continue;
      nodeByKey.set(row.key, node);
      if (officeInlineTextKey(inlineTextOf(node)) !== officeInlineTextKey(row.text)) locked.add(row.key);
    }
    for (const markerEl of markerEls) markerEl.remove();
    if (!nodeByKey.size) return { ok: false, reason: "화면 문단과 저장할 문단을 연결하지 못했어요." };

    state.nodeByKey = nodeByKey;
    state.inlineLockedKeys = locked;
    for (const row of state.rows){
      const node = nodeByKey.get(row.key);
      if (node) inlinePrepareNode(state, row, node);
    }
    return { ok: true, marked: true, locked: locked.size, missing: state.rows.length - nodeByKey.size };
  }

  // 입력·키 처리는 미리보기 한 곳에 맡긴다 — 문단을 복제해 넣어도 이벤트를 다시 붙일 필요가 없다.
  function inlineWire(state){
    const host = state.previewEl;
    host.addEventListener("input", (e) => {
      if (state.mode !== "inline" || !state.editing) return;
      const node = e.target && e.target.closest ? e.target.closest("[data-key]") : null;
      const row = inlineRowOf(state, node);
      if (!row) return;
      row.text = inlineTextOf(node);
      if (!row.touched){ row.touched = true; node.classList.add("touched"); }
      state.onDirty();
    });
    host.addEventListener("keydown", (e) => {
      if (state.mode !== "inline" || !state.editing) return;
      if ((e.ctrlKey || e.metaKey) && state.history && !state.rendering){
        const key = String(e.key || "").toLowerCase();
        if (key === "z" && !e.shiftKey){ e.preventDefault(); state.history.undo(); return; }
        if (key === "y" || (key === "z" && e.shiftKey)){ e.preventDefault(); state.history.redo(); return; }
      }
      const node = e.target && e.target.closest ? e.target.closest("[data-key]") : null;
      const row = inlineRowOf(state, node);
      if (row) onRowKey(e, state, row, node);
    }, true);
  }

  /* ---------- 되돌리기 ---------- */

  // 스냅샷은 행 배열의 JSON 문자열 — 가볍고 비교가 그대로 된다(글자 편집기와 같은 무게).
  function makeHistory(state){
    if (typeof MNEditHistory !== "object" || !MNEditHistory || typeof MNEditHistory.create !== "function") return null;
    return MNEditHistory.create({
      limit: 200,
      // XML 본문은 버전 표에서 한 번만 들고, 스냅샷에는 작은 버전 번호만 넣는다. 표를 한 번
      // 고친 뒤 타이핑할 때마다 document.xml 전체를 200벌씩 복제하지 않기 위해서다.
      capture: () => JSON.stringify({
        rows: state.rows,
        xmlVersion: state.xmlVersion,
        structureDirty: !!state.structureDirty,
        tableChanges: state.tableChanges || [],
        bakedPlan: state.bakedPlan || { changed: 0, inserted: 0, removed: 0 }
      }),
      apply: (snapshot) => {
        const saved = JSON.parse(snapshot);
        const previousVersion = state.xmlVersion;
        state.rows = saved.rows || [];
        state.xmlVersion = Number(saved.xmlVersion) || 0;
        state.xml = state.xmlVersions.get(state.xmlVersion) || state.xml;
        state.structureDirty = !!saved.structureDirty;
        state.tableChanges = Array.isArray(saved.tableChanges) ? saved.tableChanges : [];
        state.bakedPlan = saved.bakedPlan || { changed: 0, inserted: 0, removed: 0 };
        state.activeTableRow = state.activeTextRow = null;
        if (previousVersion !== state.xmlVersion && state.mode === "inline" && typeof state.renderDraft === "function")
          state.renderDraft().catch(e => console.warn("문서 서식 편집 되돌리기 화면 갱신 실패:", e));
        else redraw(state);
      },
      isEqual: (a, b) => a === b,
      onChange: () => state.onHistory()
    });
  }

  /* ---------- 저장 ---------- */

  /* 행 목록 → XML 편집 → 새 zip → 저장. 되쓰기 규칙은 전부 순수부가 정한다.
     원본을 덮어썼는지 사본이 생겼는지는 saveDocument 가 알려 준다 — 그대로 사용자에게 옮긴다.
     저장 뒤에는 편집 기준을 새 XML 로 다시 잡는다 — 안 그러면 두 번째 저장이
     이미 반영된 편집을 옛 문단 위치에 또 적용한다. */
  async function saveEdits(state, doc){
    if (state.saving) return;
    const plan = officeParagraphEditPlan(state.xml, state.rows);
    if (!plan.edits.length && !state.structureDirty){
      if (typeof toast === "function") toast("바뀐 내용이 없어요.", 1800);
      return;
    }
    const tableChanges = (state.tableChanges || []).slice();
    const bakedPlan = { ...(state.bakedPlan || { changed: 0, inserted: 0, removed: 0 }) };
    state.saving = true;
    state.setStatus("저장 중…");
    try {
      const nextXml = officeApplyEdits(state.xml, plan.edits);
      const bytes = await MNOfficeReplace.build(state.source.bytes, { "word/document.xml": nextXml });
      const saved = await MNOfficeReplace.saveDocument(doc, bytes, "docx");
      if (!saved){
        state.setStatus("저장하지 못했어요");
        if (typeof toast === "function")
          toast("저장할 위치를 찾지 못했어요. 파일을 폴더로 열었는지 확인해 주세요.", 4200, { type: "error" });
        return;
      }
      // 편집 기준을 새 문서로 옮긴다(행 key 가 바뀌므로 화면도 다시 잡는다).
      state.source.bytes = bytes;
      state.source.parts["word/document.xml"] = nextXml;
      state.xml = nextXml;
      state.rows = rowsFromOutline(officeParagraphOutline(nextXml));
      state.structureDirty = false;
      state.tableChanges = [];
      state.bakedPlan = { changed: 0, inserted: 0, removed: 0 };
      state.xmlVersion = 0;
      state.xmlVersionSeq = 0;
      state.xmlVersions = new Map([[0, nextXml]]);

      MNOfficeReplace.reflectSaved(doc, bytes, "docx");
      // 미리보기를 먼저 새로 그리고 나서 붙인다 — 제자리 편집은 그 DOM 을 그대로 쓰므로
      // 순서가 뒤집히면 사라진 옛 문단에 편집이 묶인다.
      let rebound = true;
      if (state.previewEl && typeof docxRenderInto === "function"){
        try { await docxRenderInto(doc.sourceFile, state.previewEl); }
        catch(e){ console.warn("저장 뒤 미리보기 갱신 실패:", e); rebound = false; }
      }
      if (state.mode === "inline"){
        let check = rebound ? inlineBind(state) : { ok: false, reason: "미리보기를 다시 그리지 못했어요." };
        if (!check.ok && rebound) check = await inlineBindWithMarkers(state);
        if (!check.ok && state.fallBackToList) state.fallBackToList(check.reason);   // 조용히 이어 가지 않는다
      }
      redraw(state);
      if (state.history) state.history.reset();
      const remembered = await MNOfficeReplace.rememberSaved(doc, bytes, "docx");

      const parts = [];
      const changedParagraphs = (plan.changed || 0) + (bakedPlan.changed || 0);
      const insertedParagraphs = (plan.inserted || 0) + (bakedPlan.inserted || 0);
      const removedParagraphs = (plan.removed || 0) + (bakedPlan.removed || 0);
      if (changedParagraphs) parts.push(changedParagraphs + "개 문단 고침");
      if (insertedParagraphs) parts.push(insertedParagraphs + "곳에 문단 추가");
      if (removedParagraphs) parts.push(removedParagraphs + "개 문단 삭제");
      if (tableChanges.length) parts.push(tableChanges.join(" · "));
      let message = MNOfficeReplace.saveResultText(saved);
      if (parts.length) message += " (" + parts.join(" · ") + ")";
      if (plan.skipped) message += " · 탭·줄바꿈 자리를 건드린 " + plan.skipped + "곳은 저장에서 빠졌어요";
      for (const refusal of plan.refused) message += " · " + refusal.reason;
      if (!remembered) message += " · 자동 복원 갱신 실패";
      // 사본이 생긴 것도 "그냥 성공" 으로 넘기지 않는다 — 원본을 고친 줄 알면 사본만 쌓인다.
      const failed = plan.skipped || plan.refused.length || !remembered || saved.mode === "copy";
      if (typeof toast === "function") toast(message, failed ? 6000 : 2600, { type: failed ? undefined : "success" });
      state.setStatus(saved.mode === "copy" ? "사본으로 저장했어요" : "");
    } catch(e){
      console.error(e);
      state.setStatus("저장하지 못했어요");
      if (typeof toast === "function") toast("저장 중 문제가 생겼어요.", 3600, { type: "error" });
    } finally { state.saving = false; }
  }

  /* ---------- 붙이기 ---------- */

  /* renderDocx 가 미리보기를 그린 뒤 부른다. 편집 모드로 들어가기 전에는 zip 을 풀지 않는다
     (문서를 열기만 하고 안 고치는 경우가 훨씬 많다). */
  async function attach(file, host, doc, previewEl){
    if (!canEditDocs() || !doc) return;

    const bar = document.createElement("div");
    bar.className = "docx-editor-bar";
    const title = document.createElement("strong");
    title.className = "docx-editor-title";
    title.textContent = "문단 편집";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "docx-editmode-btn";
    const undoBtn = document.createElement("button");
    undoBtn.type = "button"; undoBtn.className = "docx-para-btn"; undoBtn.textContent = "↶";
    undoBtn.title = "되돌리기 (Ctrl+Z)"; undoBtn.hidden = true;
    const redoBtn = document.createElement("button");
    redoBtn.type = "button"; redoBtn.className = "docx-para-btn"; redoBtn.textContent = "↷";
    redoBtn.title = "다시 실행 (Ctrl+Y)"; redoBtn.hidden = true;
    // class="run-save" 로 두면 Ctrl+S(saveCurrent)가 app.js 의 공통 경로로 이 버튼을 눌러 준다.
    const saveBtn = document.createElement("button");
    saveBtn.type = "button"; saveBtn.className = "docx-editmode-btn run-save"; saveBtn.textContent = "💾 저장";
    saveBtn.title = "고친 문단을 원래 파일에 저장 (Ctrl+S)"; saveBtn.hidden = true;
    const status = document.createElement("span");
    status.className = "docx-editor-status";
    status.setAttribute("aria-live", "polite");
    const tableTools = document.createElement("div");
    tableTools.className = "docx-table-tools";
    tableTools.hidden = true;
    const tableToolsLabel = document.createElement("span");
    tableToolsLabel.className = "docx-table-tools-label";
    const tableButtons = new Map();
    const tableButton = (kind, label, titleText) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docx-para-btn";
      button.dataset.tableAction = kind;
      button.dataset.normalTitle = titleText;
      button.textContent = label;
      button.title = titleText;
      tableButtons.set(kind, button);
      return button;
    };
    const tableToolSeparator = () => {
      const separator = document.createElement("span");
      separator.className = "docx-table-tools-separator";
      separator.setAttribute("aria-hidden", "true");
      return separator;
    };
    const tableSelect = (labelText, values) => {
      const label = document.createElement("label");
      label.className = "docx-table-format-field";
      const caption = document.createElement("span");
      caption.textContent = labelText;
      const select = document.createElement("select");
      for (const [value, text] of values){
        const option = document.createElement("option");
        option.value = value; option.textContent = text;
        select.appendChild(option);
      }
      label.append(caption, select);
      return { label, select };
    };
    const horizontalTool = tableSelect("가로", [["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]]);
    const verticalTool = tableSelect("세로", [["top", "위"], ["center", "가운데"], ["bottom", "아래"]]);
    const tableColor = (labelText, value, titleText) => {
      const label = document.createElement("label");
      label.className = "docx-table-color-field";
      label.title = titleText;
      const caption = document.createElement("span");
      caption.textContent = labelText;
      const input = document.createElement("input");
      input.type = "color"; input.value = value;
      input.setAttribute("aria-label", titleText);
      label.append(caption, input);
      return { label, input };
    };
    const fillTool = tableColor("배경", "#ffffff", "선택한 셀의 배경색");
    const borderTool = tableColor("선", "#000000", "선택한 셀의 테두리색");
    const textTools = document.createElement("div");
    textTools.className = "docx-text-tools";
    textTools.hidden = true;
    const textToolsLabel = document.createElement("span");
    textToolsLabel.className = "docx-table-tools-label";
    const fontTool = tableSelect("글꼴", [["", "선택"], ["맑은 고딕", "맑은 고딕"], ["굴림", "굴림"],
      ["돋움", "돋움"], ["바탕", "바탕"], ["궁서", "궁서"], ["Arial", "Arial"], ["Calibri", "Calibri"],
      ["Times New Roman", "Times New Roman"], ["Courier New", "Courier New"]]);
    const fontSizeTool = tableSelect("크기", [["", "선택"], ...[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36]
      .map(value => [String(value), String(value)])]);
    const boldTextButton = document.createElement("button");
    boldTextButton.type = "button";
    boldTextButton.className = "docx-para-btn docx-text-bold";
    boldTextButton.textContent = "B";
    boldTextButton.title = "선택한 문단을 굵게 켜기/끄기";
    boldTextButton.setAttribute("aria-pressed", "false");
    textTools.append(textToolsLabel, fontTool.label, fontSizeTool.label, boldTextButton);
    const formatButtons = [];
    const formatButton = (kind, label, titleText, value) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "docx-para-btn";
      button.dataset.tableFormat = kind;
      if (value !== undefined) button.dataset.tableValue = String(value);
      button.dataset.normalTitle = titleText;
      button.textContent = label; button.title = titleText;
      formatButtons.push(button);
      return button;
    };
    tableTools.append(tableToolsLabel,
      tableButton("row-add-above", "행↑＋", "선택한 셀 위에 빈 행 추가"),
      tableButton("row-add-below", "행↓＋", "선택한 셀 아래에 빈 행 추가"),
      tableButton("row-delete", "행 삭제", "선택한 셀이 있는 행 삭제"),
      tableButton("column-add-left", "열←＋", "선택한 셀 왼쪽에 빈 열 추가"),
      tableButton("column-add-right", "열→＋", "선택한 셀 오른쪽에 빈 열 추가"),
      tableButton("column-delete", "열 삭제", "선택한 셀이 있는 열 삭제"),
      tableToolSeparator(), horizontalTool.label, verticalTool.label,
      fillTool.label, formatButton("fill", "적용", "선택한 셀에 배경색 적용"),
      formatButton("fill", "지움", "선택한 셀의 배경색 지우기", ""),
      borderTool.label, formatButton("border", "적용", "선택한 셀 네 면에 테두리 적용"),
      formatButton("border", "지움", "선택한 셀의 테두리 지우기", ""),
      tableToolSeparator(),
      formatButton("column-width", "열−", "선택한 열 너비 줄이기", -240),
      formatButton("column-width", "열＋", "선택한 열 너비 늘리기", 240),
      formatButton("row-height", "높이−", "선택한 행 높이 줄이기", -120),
      formatButton("row-height", "높이＋", "선택한 행 높이 늘리기", 120));
    bar.append(title, toggle, undoBtn, redoBtn, saveBtn, status, textTools, tableTools);
    host.insertBefore(bar, previewEl);

    const note = document.createElement("div");
    note.className = "code-note docx-edit-note";
    note.hidden = true;
    host.insertBefore(note, previewEl);

    const listEl = document.createElement("div");
    listEl.className = "docx-para-list md-host";
    listEl.hidden = true;
    host.appendChild(listEl);

    const state = {
      rows: [], listEl, previewEl, focusKey: 0, source: null, xml: "", editing: false,
      mode: "inline", nodeByKey: new Map(), inlineLockedKeys: new Set(),
      saving: false, rendering: false, history: null,
      structureDirty: false, tableChanges: [], bakedPlan: { changed: 0, inserted: 0, removed: 0 },
      xmlVersion: 0, xmlVersionSeq: 0, xmlVersions: new Map(), activeTableRow: null, activeTextRow: null,
      setStatus: (text) => { status.textContent = text; },
      onDirty: () => {
        const dirty = rowsDirty(state.rows) || state.structureDirty;
        doc.docxEditDirty = dirty;
        if (!state.saving) status.textContent = dirty ? "고친 내용 있음 — 저장하지 않았어요" : "";
        saveBtn.disabled = !dirty;
        if (typeof markDocumentDirty === "function") markDocumentDirty(doc, dirty);
        if (state.history) state.history.commitSoon(400);   // 연속 입력은 한 단계로 묶는다
      },
      onHistory: () => {
        if (!state.history) return;
        undoBtn.disabled = state.rendering || !state.history.canUndo();
        redoBtn.disabled = state.rendering || !state.history.canRedo();
      },
      // 문단을 더하거나 지우는 건 한 번의 동작이므로 묶지 않고 바로 한 단계로 남긴다.
      commitNow: () => { if (state.history) state.history.commit(); }
    };
    doc.docxEditor = state;

    const INLINE_NOTE = "✎ 제자리 편집 — 보이는 그대로 고쳐요. Enter 로 문단을 나누고, 빈 문단에서 Backspace 로 지웁니다. " +
      "문단을 누르면 글꼴·크기·굵게를, 표 셀을 누르면 행·열과 셀 정렬·색·테두리·크기를 편집할 수 있습니다. " +
      "손대지 않은 곳은 저장할 때 바이트 그대로 남습니다.";
    const LIST_NOTE = "✎ 문단 목록 — 글자만 고치는 간이 표시예요. 글꼴·여백·쪽 나눔은 실제 문서와 다르게 보입니다. " +
      "손대지 않은 곳의 서식은 저장할 때 그대로 유지됩니다.";

    const updateTextTools = (row) => {
      state.activeTextRow = row || null;
      const active = state.activeTextRow;
      textTools.hidden = !state.editing || state.mode !== "inline" || !active;
      if (!active) return;
      textToolsLabel.textContent = active.inTable ? "셀 글자" : (active.index ? "문단 " + active.index : "새 문단");
      const format = active.index ? officeParagraphTextFormat(state.xml, { paragraphIndex: active.index }) : null;
      const fontValue = format ? format.font : "";
      const sizeValue = format ? String(format.fontSize) : "";
      fontTool.select.value = Array.from(fontTool.select.options).some(option => option.value === fontValue) ? fontValue : "";
      fontSizeTool.select.value = Array.from(fontSizeTool.select.options).some(option => option.value === sizeValue) ? sizeValue : "";
      const disabled = state.rendering;
      fontTool.select.disabled = fontSizeTool.select.disabled = boldTextButton.disabled = disabled;
      const bold = !!(format && format.bold);
      boldTextButton.classList.toggle("active", bold);
      boldTextButton.setAttribute("aria-pressed", bold ? "true" : "false");
      boldTextButton.title = "선택한 문단을 굵게 켜기/끄기";
    };

    const updateTableTools = (row) => {
      state.activeTableRow = row && row.inTable ? row : null;
      const active = state.activeTableRow;
      tableTools.hidden = !state.editing || state.mode !== "inline" || !active;
      if (!active) return;
      tableToolsLabel.textContent = "표 " + active.tableIndex + " · " + active.tableRow + "행 " + active.tableCell + "열";
      const nested = active.tableHasNested;
      const rowBlocked = nested || active.tableHasVerticalMerge;
      const columnBlocked = nested || active.tableHasVerticalMerge || active.tableHasGridSpan || !active.tableRectangular;
      for (const [kind, button] of tableButtons){
        const rowAction = kind.startsWith("row-");
        button.disabled = state.rendering || (rowAction ? rowBlocked : columnBlocked) ||
          (kind === "row-delete" && active.tableRowCount <= 1) ||
          (kind === "column-delete" && active.tableColumnCount <= 1);
        if (nested) button.title = "표 안에 다른 표가 들어 있어 구조는 바꿀 수 없어요.";
        else if (rowAction && active.tableHasVerticalMerge) button.title = "세로 병합된 셀이 있어 행 구조는 바꿀 수 없어요.";
        else if (!rowAction && (active.tableHasVerticalMerge || active.tableHasGridSpan)) button.title = "병합된 셀이 있어 열 구조는 바꿀 수 없어요.";
        else button.title = button.dataset.normalTitle;
      }
      const format = officeTableCellFormat(state.xml, {
        tableIndex: active.tableIndex, rowIndex: active.tableRow, cellIndex: active.tableCell
      });
      horizontalTool.select.value = format ? format.horizontal : "left";
      verticalTool.select.value = format ? format.vertical : "top";
      fillTool.input.value = "#" + (format ? format.fill : "FFFFFF");
      borderTool.input.value = "#" + (format ? format.borderColor : "000000");
      horizontalTool.select.disabled = verticalTool.select.disabled = state.rendering || nested;
      fillTool.input.disabled = borderTool.input.disabled = state.rendering || nested;
      for (const button of formatButtons){
        const widthAction = button.dataset.tableFormat === "column-width";
        button.disabled = state.rendering || nested || (widthAction && columnBlocked);
        if (nested) button.title = "표 안에 다른 표가 들어 있어 셀 서식은 바꿀 수 없어요.";
        else if (widthAction && columnBlocked) button.title = "병합되거나 열 수가 다른 표에서는 열 너비를 바꿀 수 없어요.";
        else button.title = button.dataset.normalTitle;
      }
    };

    const syncToggle = () => {
      const inline = state.mode === "inline";
      toggle.textContent = state.editing ? "읽기 전용" : "✎ 문단 편집";
      toggle.title = state.editing ? "편집을 마치고 원래 미리보기로 돌아가기" : "문서를 보이는 자리에서 그대로 고치기";
      toggle.classList.toggle("active", state.editing);
      note.hidden = !state.editing;
      note.textContent = inline ? INLINE_NOTE : LIST_NOTE;
      listEl.hidden = !state.editing || inline;
      previewEl.hidden = state.editing && !inline;      // 제자리 편집은 미리보기를 그대로 쓴다
      previewEl.classList.toggle("docx-inline-editing", state.editing && inline);
      undoBtn.hidden = redoBtn.hidden = saveBtn.hidden = !state.editing;
      updateTextTools(state.activeTextRow);
      updateTableTools(state.activeTableRow);
    };
    syncToggle();

    /* 화면 ↔ 문서 대응이 깨지면 제자리 편집을 끄고 목록 화면으로 물러난다.
       엉뚱한 문단에 저장되느니 덜 예쁜 화면으로 확실하게 고치는 편이 낫다. */
    state.fallBackToList = (reason) => {
      if (state.mode !== "inline" || !state.editing) return;
      state.mode = "list";
      state.nodeByKey = new Map();
      state.inlineLockedKeys = new Set();
      for (const node of inlineBodyParagraphs(previewEl)){
        node.contentEditable = "false";
        node.classList.remove("docx-inline-para", "touched", "removed", "locked");
      }
      updateTextTools(null);
      syncToggle();
      console.warn("제자리 편집을 쓰지 못해 문단 목록으로 물러납니다:", reason);
      if (typeof toast === "function")
        toast("이 문서는 화면과 문단이 딱 맞지 않아 목록 화면으로 고쳐요. (" + reason + ")", 5200);
    };
    inlineWire(state);

    const tableChangeLabel = {
      "row-add-above": "표 행 추가", "row-add-below": "표 행 추가", "row-delete": "표 행 삭제",
      "column-add-left": "표 열 추가", "column-add-right": "표 열 추가", "column-delete": "표 열 삭제"
    };
    const tableFormatLabel = {
      horizontal: "셀 가로 정렬", vertical: "셀 세로 정렬", fill: "셀 배경",
      border: "셀 테두리", "column-width": "표 열 너비", "row-height": "표 행 높이"
    };
    const textFormatLabel = { font: "문단 글꼴", "font-size": "문단 글자 크기", bold: "문단 굵게" };
    const tableRowForSelection = (selection) => state.rows.find(row => row.inTable &&
      row.tableIndex === selection.tableIndex && row.tableRow === selection.rowIndex && row.tableCell === selection.cellIndex);
    const rowForSelection = (selection) => selection && selection.paragraphIndex
      ? state.rows.find(row => row.index === selection.paragraphIndex)
      : tableRowForSelection(selection || {});

    // 현재의 미저장 document.xml 을 임시 DOCX 로 그린다. 저장은 누르지 않았으므로 source.bytes는
    // 그대로 두고, 화면만 새 표 구조로 바꾼 뒤 문단을 다시 정확히 연결한다.
    state.renderDraft = async (selection) => {
      if (state.rendering || !state.source) return;
      state.rendering = true;
      state.onHistory();
      updateTextTools(state.activeTextRow);
      updateTableTools(state.activeTableRow);
      status.textContent = "문서를 다시 그리는 중…";
      try {
        const draftBytes = await MNOfficeReplace.build(state.source.bytes, { "word/document.xml": state.xml });
        await docxRenderInto(draftBytes, previewEl);
        let check = inlineBind(state);
        if (!check.ok) check = await inlineBindWithMarkers(state);
        if (!check.ok){
          state.fallBackToList(check.reason);
          redraw(state);
          return;
        }
        const selected = selection ? rowForSelection(selection) : null;
        state.focusKey = selected ? selected.key : 0;
        redraw(state);
        updateTextTools(selected);
        updateTableTools(selected);
      } catch(e){
        console.warn("문서 편집 미리보기 갱신 실패:", e);
        state.fallBackToList("문서를 다시 그리지 못했어요.");
        redraw(state);
      } finally {
        state.rendering = false;
        state.onHistory();
        state.onDirty();
        updateTextTools(state.activeTextRow);
        updateTableTools(state.activeTableRow);
      }
    };

    const applyTableAction = async (kind) => {
      const active = state.activeTableRow;
      if (!active || state.rendering || state.saving || state.mode !== "inline") return;
      if (state.history) state.history.commit();       // 표를 바꾸기 직전 타이핑 상태를 별도 단계로 남긴다

      // 현재 화면의 글자 편집을 XML에 먼저 굳힌 뒤 그 좌표를 기준으로 행·열을 바꾼다.
      const paragraphPlan = officeParagraphEditPlan(state.xml, state.rows);
      if (paragraphPlan.skipped || paragraphPlan.refused.length){
        toastOnce("먼저 저장할 수 없는 문단 편집을 정리해 주세요.");
        return;
      }
      const withText = officeApplyEdits(state.xml, paragraphPlan.edits);
      const result = officeTableStructureEdit(withText, {
        kind,
        tableIndex: active.tableIndex,
        rowIndex: active.tableRow,
        cellIndex: active.tableCell
      });
      if (!result.changed){ toastOnce(result.reason || "표 구조를 바꾸지 못했어요."); return; }

      state.xml = result.xml;
      state.xmlVersion = ++state.xmlVersionSeq;
      state.xmlVersions.set(state.xmlVersion, state.xml);
      state.rows = rowsFromOutline(officeParagraphOutline(state.xml));
      state.structureDirty = true;
      state.tableChanges.push(tableChangeLabel[kind] || "표 구조 변경");
      state.bakedPlan.changed += paragraphPlan.changed || 0;
      state.bakedPlan.inserted += paragraphPlan.inserted || 0;
      state.bakedPlan.removed += paragraphPlan.removed || 0;
      state.activeTableRow = null;
      state.onDirty();
      state.commitNow();
      await state.renderDraft(result.selection);
    };

    const applyTableFormat = async (kind, value) => {
      const active = state.activeTableRow;
      if (!active || state.rendering || state.saving || state.mode !== "inline") return;
      if (state.history) state.history.commit();
      const paragraphPlan = officeParagraphEditPlan(state.xml, state.rows);
      if (paragraphPlan.skipped || paragraphPlan.refused.length){
        toastOnce("먼저 저장할 수 없는 문단 편집을 정리해 주세요.");
        return;
      }
      const withText = officeApplyEdits(state.xml, paragraphPlan.edits);
      const request = {
        kind, tableIndex: active.tableIndex, rowIndex: active.tableRow, cellIndex: active.tableCell
      };
      if (kind === "column-width" || kind === "row-height") request.delta = Number(value) || 0;
      else request.value = value;
      const result = officeTableFormatEdit(withText, request);
      if (!result.changed){ toastOnce(result.reason || "표 서식을 바꾸지 못했어요."); return; }
      state.xml = result.xml;
      state.xmlVersion = ++state.xmlVersionSeq;
      state.xmlVersions.set(state.xmlVersion, state.xml);
      state.rows = rowsFromOutline(officeParagraphOutline(state.xml));
      state.structureDirty = true;
      state.tableChanges.push(tableFormatLabel[kind] || "표 서식 변경");
      state.bakedPlan.changed += paragraphPlan.changed || 0;
      state.bakedPlan.inserted += paragraphPlan.inserted || 0;
      state.bakedPlan.removed += paragraphPlan.removed || 0;
      state.activeTableRow = null;
      state.onDirty();
      state.commitNow();
      await state.renderDraft(result.selection);
    };

    const applyTextFormat = async (kind, value) => {
      const active = state.activeTextRow;
      if (!active || state.rendering || state.saving || state.mode !== "inline") return;
      if (state.history) state.history.commit();
      const visibleRows = state.rows.filter(row => !row.removed);
      const paragraphIndex = visibleRows.indexOf(active) + 1;
      if (!paragraphIndex){ toastOnce("선택한 문단 위치를 찾지 못했어요."); return; }
      const paragraphPlan = officeParagraphEditPlan(state.xml, state.rows);
      if (paragraphPlan.skipped || paragraphPlan.refused.length){
        toastOnce("먼저 저장할 수 없는 문단 편집을 정리해 주세요.");
        return;
      }
      const withText = officeApplyEdits(state.xml, paragraphPlan.edits);
      const result = officeParagraphFormatEdit(withText, { kind, value, paragraphIndex });
      if (!result.changed){ toastOnce(result.reason || "글자 서식을 바꾸지 못했어요."); return; }
      state.xml = result.xml;
      state.xmlVersion = ++state.xmlVersionSeq;
      state.xmlVersions.set(state.xmlVersion, state.xml);
      state.rows = rowsFromOutline(officeParagraphOutline(state.xml));
      state.structureDirty = true;
      state.tableChanges.push(textFormatLabel[kind] || "문단 글자 서식");
      state.bakedPlan.changed += paragraphPlan.changed || 0;
      state.bakedPlan.inserted += paragraphPlan.inserted || 0;
      state.bakedPlan.removed += paragraphPlan.removed || 0;
      state.activeTextRow = state.activeTableRow = null;
      state.onDirty();
      state.commitNow();
      await state.renderDraft(result.selection);
    };

    for (const [kind, button] of tableButtons){
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => { applyTableAction(kind); });
    }
    horizontalTool.select.addEventListener("change", () => applyTableFormat("horizontal", horizontalTool.select.value));
    verticalTool.select.addEventListener("change", () => applyTableFormat("vertical", verticalTool.select.value));
    for (const button of formatButtons){
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        const kind = button.dataset.tableFormat;
        let value = button.dataset.tableValue;
        if (value === undefined && kind === "fill") value = fillTool.input.value;
        if (value === undefined && kind === "border") value = borderTool.input.value;
        applyTableFormat(kind, value);
      });
    }
    fontTool.select.addEventListener("change", () => {
      if (fontTool.select.value) applyTextFormat("font", fontTool.select.value);
    });
    fontSizeTool.select.addEventListener("change", () => {
      if (fontSizeTool.select.value) applyTextFormat("font-size", fontSizeTool.select.value);
    });
    boldTextButton.addEventListener("mousedown", (e) => e.preventDefault());
    boldTextButton.addEventListener("click", () => {
      const active = state.activeTextRow;
      const format = active && active.index ? officeParagraphTextFormat(state.xml, { paragraphIndex: active.index }) : null;
      applyTextFormat("bold", !(format && format.bold));
    });
    const selectDocumentParagraph = (e) => {
      if (!state.editing || state.mode !== "inline") return;
      const node = e.target && e.target.closest ? e.target.closest("[data-key]") : null;
      const row = inlineRowOf(state, node);
      updateTextTools(row);
      updateTableTools(row);
    };
    previewEl.addEventListener("focusin", selectDocumentParagraph);
    previewEl.addEventListener("click", selectDocumentParagraph);

    undoBtn.addEventListener("click", () => { if (state.history) state.history.undo(); });
    redoBtn.addEventListener("click", () => { if (state.history) state.history.redo(); });
    saveBtn.addEventListener("click", () => { saveEdits(state, doc); });
    // 편집 칸은 contenteditable 이라 브라우저 기본 되돌리기가 먼저 먹는다 — 행 모델을 기준으로 가로챈다.
    listEl.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || !state.history || state.rendering) return;
      const key = String(e.key || "").toLowerCase();
      if (key === "z" && !e.shiftKey){ e.preventDefault(); state.history.undo(); }
      else if (key === "y" || (key === "z" && e.shiftKey)){ e.preventDefault(); state.history.redo(); }
    }, true);

    toggle.addEventListener("click", async () => {
      if (state.editing){
        state.editing = false;
        // 읽기 전용으로 돌아가면 미리보기가 다시 그냥 문서가 되어야 한다(고친 글자는 행 모델에 남는다).
        // 편집 표시까지 걷어낸다 — 커서만 막고 자국을 남겨 두면 "안 돌아왔다" 로 보인다.
        if (state.mode === "inline")
          for (const node of state.nodeByKey.values()){
            if (!node) continue;
            node.contentEditable = "false";
            node.classList.remove("docx-inline-para", "touched", "removed", "locked");
            node.removeAttribute("title");
          }
        syncToggle();
        return;
      }
      if (!state.source){
        toggle.disabled = true;
        status.textContent = "문서를 읽는 중…";
        try {
          const source = await MNOfficeReplace.read(doc.sourceFile || file, "docx", editorOptions());
          if (source.reason){
            status.textContent = source.reason;
            if (typeof toast === "function") toast(source.reason, 3600);
            return;
          }
          state.source = source;
          state.xml = source.parts["word/document.xml"];
          state.rows = rowsFromOutline(officeParagraphOutline(state.xml));
          state.xmlVersion = 0;
          state.xmlVersionSeq = 0;
          state.xmlVersions = new Map([[0, state.xml]]);
        } catch(e){
          console.error(e);
          status.textContent = "문서를 읽지 못했어요.";
          return;
        } finally { toggle.disabled = false; }
      }
      state.editing = true;
      // 제자리 편집을 먼저 시도한다. 화면 문단과 문서 문단이 하나라도 어긋나면 목록으로 물러난다.
      if (state.mode === "inline"){
        let check = inlineBind(state);
        if (!check.ok) check = await inlineBindWithMarkers(state);
        if (!check.ok) state.fallBackToList(check.reason);
      }
      if (!state.history){
        state.history = makeHistory(state);
        if (state.history) state.history.reset();
      }
      syncToggle();
      redraw(state);
      state.onHistory();
      if (state.mode !== "inline") listEl.scrollTop = 0;
    });
  }

  return { attach, rowsFromOutline, rowsDirty, anchorIndexFor };
})();
