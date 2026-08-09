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
      tableCellGridSpan: item.tableCellGridSpan || 1,
      tableRowCellCount: item.tableRowCellCount || 0,
      tableCellVmerge: item.tableCellVmerge || "",
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
      tableCellGridSpan: 1, tableRowCellCount: 0, tableCellVmerge: "",
      hasSectPr: false, hasTextbox: false,
      locked: false, removed: false, after: 0, touched: true
    };
  }

  const rowsDirty = (rows) => rows.some(row =>
    row.removed || !row.index || String(row.text) !== String(row.original));

  const sameTableCell = (left, right) => !!left && !!right && left.inTable && right.inTable &&
    left.tableIndex === right.tableIndex && left.tableRow === right.tableRow &&
    left.tableCell === right.tableCell;

  // A Word table cell must keep at least one paragraph. An extra paragraph that
  // was already empty in the source is safe to remove when another one remains.
  function canRemoveParagraph(rows, row){
    if (!row || row.hasSectPr) return false;
    if (!row.inTable) return true;
    if (row.tableHasNested || !row.index || String(row.original || "") || String(row.text || "")) return false;
    return (rows || []).filter(other => !other.removed && sameTableCell(other, row)).length > 1;
  }

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
    else if (row.inTable) style.title = canRemoveParagraph(state.rows, row)
      ? "표 셀의 추가 빈 문단이에요. 맨 앞에서 Backspace를 누르면 지울 수 있어요."
      : "표 안 문단이에요. 셀에는 문단 하나가 반드시 남아야 해요.";
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
    delBtn.disabled = !row.removed && !canRemoveParagraph(state.rows, row);
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
     표 안에서는 문단 나누기를 막고, 원본부터 비어 있던 추가 문단만 하나를 남기는 범위에서 지운다. */
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
      if (!row.inTable && at <= 0) return;
      if (!canRemoveParagraph(state.rows, row)){
        toastOnce(row.inTable ? "표 셀에는 문단 하나를 남겨야 해요." : "이 문단은 지울 수 없어요.");
        e.preventDefault(); return;
      }
      e.preventDefault();
      if (!row.index) state.rows.splice(at, 1);
      else row.removed = true;
      const sameCellNeighbor = row.inTable && state.rows.find((other, index) =>
        index !== at && !other.removed && sameTableCell(other, row));
      state.focusKey = (sameCellNeighbor || state.rows[at - 1] || state.rows[at + 1] || {}).key || 0;
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

  function selectionOffsetsIn(el){
    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
      if (!startEl || !endEl || !el.contains(startEl) || !el.contains(endEl)) return null;
      const before = range.cloneRange();
      before.selectNodeContents(el);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const end = start + range.toString().length;
      return end > start ? { start, end } : null;
    } catch(_){ return null; }
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
    node.classList.toggle("empty", !row.text);
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
    else if (row.inTable) node.title = canRemoveParagraph(state.rows, row)
      ? "표 셀의 추가 빈 문단이에요. 맨 앞에서 Backspace를 누르면 지울 수 있어요."
      : "표 안 문단이에요. 셀에는 문단 하나가 반드시 남아야 해요.";
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
      const markedBytes = await MNOfficeReplace.build(state.source.bytes,
        { ...(state.packageChanges || {}), "word/document.xml": plan.xml });
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
        packageVersion: state.packageVersion,
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
        state.packageVersion = Number(saved.packageVersion) || 0;
        state.packageChanges = state.packageVersions.get(state.packageVersion) || {};
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
      if (plan.skipped || plan.refused.length){
        state.setStatus("저장할 수 없는 문단 편집이 있어요");
        if (typeof toast === "function")
          toast("탭·줄바꿈 또는 보호된 문단의 변경은 저장할 수 없어요.", 3200, { type: "error" });
      } else if (typeof toast === "function") toast("바뀐 내용이 없어요.", 1800);
      return;
    }
    const tableChanges = (state.tableChanges || []).slice();
    const bakedPlan = { ...(state.bakedPlan || { changed: 0, inserted: 0, removed: 0 }) };
    state.saving = true;
    state.setStatus("저장 중…");
    try {
      const nextXml = officeApplyEdits(state.xml, plan.edits);
      const replacements = { ...(state.packageChanges || {}), "word/document.xml": nextXml };
      const bytes = await MNOfficeReplace.build(state.source.bytes, replacements);
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
      for (const [path, value] of Object.entries(state.packageChanges || {}))
        state.source.parts[path] = typeof value === "string" ? value : null;
      state.xml = nextXml;
      state.rows = rowsFromOutline(officeParagraphOutline(nextXml));
      state.structureDirty = false;
      state.tableChanges = [];
      state.bakedPlan = { changed: 0, inserted: 0, removed: 0 };
      state.xmlVersion = 0;
      state.xmlVersionSeq = 0;
      state.xmlVersions = new Map([[0, nextXml]]);
      state.packageChanges = {};
      state.packageVersion = 0;
      state.packageVersionSeq = 0;
      state.packageVersions = new Map([[0, {}]]);

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
    const italicTextButton = document.createElement("button");
    italicTextButton.type = "button";
    italicTextButton.className = "docx-para-btn docx-text-toggle docx-text-italic";
    italicTextButton.textContent = "I";
    italicTextButton.title = "선택한 문단의 기울임 켜기/끄기";
    italicTextButton.setAttribute("aria-pressed", "false");
    const underlineTextButton = document.createElement("button");
    underlineTextButton.type = "button";
    underlineTextButton.className = "docx-para-btn docx-text-toggle docx-text-underline";
    underlineTextButton.textContent = "U";
    underlineTextButton.title = "선택한 문단의 밑줄 켜기/끄기";
    underlineTextButton.setAttribute("aria-pressed", "false");
    const strikeTextButton = document.createElement("button");
    strikeTextButton.type = "button";
    strikeTextButton.className = "docx-para-btn docx-text-toggle docx-text-strike";
    strikeTextButton.textContent = "S";
    strikeTextButton.title = "선택한 문단의 취소선 켜기/끄기";
    strikeTextButton.setAttribute("aria-pressed", "false");
    const baselineTool = tableSelect("첨자", [["baseline", "보통"], ["superscript", "위"], ["subscript", "아래"]]);
    const textColorTool = tableColor("글자", "#000000", "선택한 문단의 글자색");
    const highlightTool = tableColor("형광", "#fff2cc", "선택한 문단의 형광펜 색");
    const textActionButton = (label, titleText) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "docx-para-btn";
      button.textContent = label; button.title = titleText;
      return button;
    };
    const textColorApply = textActionButton("적용", "고른 글자색 적용");
    const textColorClear = textActionButton("지움", "직접 지정한 글자색 지우기");
    const highlightApply = textActionButton("적용", "고른 형광펜 색 적용");
    const highlightClear = textActionButton("지움", "형광펜 지우기");
    const clearTextFormat = textActionButton("서식 지우기", "글꼴·크기·굵게·기울임·밑줄·취소선·첨자·글자색·형광펜 지우기");
    const copyTextFormat = textActionButton("서식 복사", "현재 문단 또는 선택 글자의 서식 복사");
    const pasteTextFormat = textActionButton("서식 붙임", "복사한 서식을 현재 문단 또는 선택 글자에 적용");
    const imageAddButton = textActionButton("그림＋", "현재 문단에 PNG·JPG·GIF 그림 추가");
    const imageReplaceButton = textActionButton("그림 교체", "현재 문단의 첫 그림 교체");
    const imageSmallerButton = textActionButton("그림−", "현재 문단의 첫 그림을 10% 작게");
    const imageLargerButton = textActionButton("그림↑", "현재 문단의 첫 그림을 10% 크게");
    const imageInput = document.createElement("input");
    imageInput.type = "file";
    imageInput.accept = "image/png,image/jpeg,image/gif";
    imageInput.hidden = true;
    const textFormatButtons = [boldTextButton, italicTextButton, underlineTextButton, strikeTextButton,
      textColorApply, textColorClear, highlightApply, highlightClear, clearTextFormat, copyTextFormat, pasteTextFormat,
      imageAddButton, imageReplaceButton, imageSmallerButton, imageLargerButton];
    textTools.append(textToolsLabel, fontTool.label, fontSizeTool.label,
      boldTextButton, italicTextButton, underlineTextButton, strikeTextButton, baselineTool.label,
      textColorTool.label, textColorApply, textColorClear,
      highlightTool.label, highlightApply, highlightClear, clearTextFormat, copyTextFormat, pasteTextFormat,
      imageAddButton, imageReplaceButton, imageSmallerButton, imageLargerButton, imageInput);
    const paragraphTools = document.createElement("div");
    paragraphTools.className = "docx-paragraph-tools";
    paragraphTools.hidden = true;
    const paragraphToolsLabel = document.createElement("span");
    paragraphToolsLabel.className = "docx-table-tools-label";
    paragraphToolsLabel.textContent = "문단 배치";
    const paragraphAlignTool = tableSelect("정렬", [["left", "왼쪽"], ["center", "가운데"],
      ["right", "오른쪽"], ["both", "양쪽"]]);
    const lineSpacingTool = tableSelect("줄", [["1", "1.0"], ["1.15", "1.15"], ["1.5", "1.5"], ["2", "2.0"]]);
    const paragraphSpaceValues = [0, 3, 6, 8, 10, 12, 18, 24].map(value => [String(value), String(value) + "pt"]);
    const beforeSpacingTool = tableSelect("앞", paragraphSpaceValues);
    const afterSpacingTool = tableSelect("뒤", paragraphSpaceValues);
    const specialIndentTool = tableSelect("특수", [["none", "없음"], ["first-line", "첫 줄"], ["hanging", "내어쓰기"]]);
    const listTool = tableSelect("목록", [["none", "없음"], ["bullet", "글머리표"], ["number", "번호"], ["list", "기존 목록"]]);
    const paragraphActionButton = (label, titleText, kind, value) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "docx-para-btn";
      button.textContent = label; button.title = titleText;
      button.dataset.paragraphFormat = kind;
      if (value !== undefined) button.dataset.paragraphValue = String(value);
      return button;
    };
    const leftIndentMinus = paragraphActionButton("왼−", "왼쪽 들여쓰기 줄이기", "indent-left", -360);
    const leftIndentPlus = paragraphActionButton("왼＋", "왼쪽 들여쓰기 늘리기", "indent-left", 360);
    const rightIndentMinus = paragraphActionButton("오−", "오른쪽 들여쓰기 줄이기", "indent-right", -360);
    const rightIndentPlus = paragraphActionButton("오＋", "오른쪽 들여쓰기 늘리기", "indent-right", 360);
    const clearParagraphLayout = paragraphActionButton("문단 지우기", "정렬·간격·들여쓰기 직접 서식 지우기", "clear-layout", "");
    const paragraphFormatButtons = [leftIndentMinus, leftIndentPlus, rightIndentMinus, rightIndentPlus, clearParagraphLayout];
    paragraphTools.append(paragraphToolsLabel, paragraphAlignTool.label, lineSpacingTool.label,
      beforeSpacingTool.label, afterSpacingTool.label, leftIndentMinus, leftIndentPlus,
      rightIndentMinus, rightIndentPlus, specialIndentTool.label, listTool.label, clearParagraphLayout);
    const documentTools = document.createElement("div");
    documentTools.className = "docx-document-tools";
    documentTools.hidden = true;
    const documentToolsLabel = document.createElement("span");
    documentToolsLabel.className = "docx-table-tools-label";
    documentToolsLabel.textContent = "문서";
    const orientationTool = tableSelect("용지", [["portrait", "세로"], ["landscape", "가로"]]);
    const marginsTool = tableSelect("여백", [["normal", "보통"], ["narrow", "좁게"], ["wide", "넓게"]]);
    const headerEditButton = textActionButton("머리글", "머리글 글자 편집");
    const footerEditButton = textActionButton("바닥글", "바닥글 글자 편집");
    documentTools.append(documentToolsLabel, orientationTool.label, marginsTool.label,
      headerEditButton, footerEditButton);
    // 실제 select/color/button 들은 상태와 기존 이벤트 경로를 그대로 유지하되 화면에서는 감춘다.
    // 상단에는 기능 갈래만 보여 주고, 누르면 우클릭 메뉴와 같은 계층형 메뉴를 연다.
    const toolLaunchers = document.createElement("div");
    toolLaunchers.className = "docx-tool-launchers";
    toolLaunchers.hidden = true;
    const toolLauncherLabel = document.createElement("span");
    toolLauncherLabel.className = "docx-tool-launchers-label";
    toolLauncherLabel.textContent = "편집 도구";
    const toolLauncherButtons = new Map();
    const toolLauncherButton = (kind, label, titleText) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "docx-tool-launcher";
      button.dataset.docxToolMenu = kind; button.textContent = label + " ▾"; button.title = titleText;
      button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false");
      toolLauncherButtons.set(kind, button); toolLaunchers.appendChild(button);
      return button;
    };
    toolLaunchers.appendChild(toolLauncherLabel);
    toolLauncherButton("document", "문서", "용지·여백·머리글·바닥글");
    toolLauncherButton("text", "글자", "글꼴·크기·굵게·색상·첨자");
    toolLauncherButton("paragraph", "문단", "정렬·간격·들여쓰기·목록·서식 복사");
    toolLauncherButton("table", "표", "행·열·셀·병합·셀 서식");
    toolLauncherButton("image", "그림", "그림 추가·교체·크기 조절");
    toolLauncherButton("all", "전체", "현재 문단에서 사용할 수 있는 모든 편집 메뉴");
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
      tableButton("cell-merge-right", "셀→합침", "선택한 셀과 오른쪽 셀을 합치기"),
      tableButton("cell-split", "셀 나눔", "가로로 병합된 선택 셀을 원래 열 수로 나누기"),
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
    bar.append(title, toggle, undoBtn, redoBtn, saveBtn, toolLaunchers, status,
      documentTools, textTools, paragraphTools, tableTools);
    host.insertBefore(bar, previewEl);

    // 긴 문서에서도 도구막대는 스크롤 영역 상단에 붙는다. 막대는 화면 폭에 따라 여러 줄이 될 수
    // 있으므로 실제 높이를 CSS 변수로 알려, 포커스된 문단이 막대 뒤에 숨지 않게 한다.
    const syncStickyToolHeight = () => {
      const height = Math.max(48, Math.ceil(bar.getBoundingClientRect().height || bar.offsetHeight || 0));
      host.style.setProperty("--docx-editor-tools-height", (height + 18) + "px");
    };
    let stickyToolObserver = null;
    if (typeof ResizeObserver !== "undefined"){
      stickyToolObserver = new ResizeObserver(syncStickyToolHeight);
      stickyToolObserver.observe(bar);
    }
    requestAnimationFrame(syncStickyToolHeight);
    if (doc.cleanupFns) doc.cleanupFns.push(() => {
      if (stickyToolObserver) stickyToolObserver.disconnect();
      host.style.removeProperty("--docx-editor-tools-height");
    });

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
      packageChanges: {}, packageVersion: 0, packageVersionSeq: 0, packageVersions: new Map([[0, {}]]),
      textSelection: null,
      formatClipboard: null,
      pendingImageKind: "add",
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
    state.setPackageChanges = (changes) => {
      state.packageChanges = { ...(state.packageChanges || {}), ...(changes || {}) };
      state.packageVersion = ++state.packageVersionSeq;
      state.packageVersions.set(state.packageVersion, state.packageChanges);
    };
    doc.docxEditor = state;

    const syncToolLaunchers = () => {
      const editing = state.editing;
      const busy = state.rendering || state.saving;
      const active = state.activeTextRow;
      toolLaunchers.hidden = !editing;
      const setDisabled = (kind, disabled) => {
        const button = toolLauncherButtons.get(kind);
        if (button) button.disabled = !!disabled;
      };
      setDisabled("document", busy || !state.xml);
      setDisabled("text", busy || !active);
      setDisabled("paragraph", busy || !active);
      setDisabled("table", busy || !state.activeTableRow);
      setDisabled("image", busy || !active || imageAddButton.disabled);
      setDisabled("all", busy || !active);
    };

    const INLINE_NOTE = "✎ 제자리 편집 — 보이는 그대로 고쳐요. Enter 로 문단을 나누고, 빈 문단에서 Backspace 로 지웁니다. " +
      "글자를 드래그하면 그 부분만 서식을 바꾸고, 문단을 우클릭하면 문단·목록·표·페이지·머리글/바닥글·그림 편집 메뉴가 열립니다. " +
      "손대지 않은 곳은 저장할 때 바이트 그대로 남습니다.";
    const LIST_NOTE = "✎ 문단 목록 — 글자만 고치는 간이 표시예요. 글꼴·여백·쪽 나눔은 실제 문서와 다르게 보입니다. " +
      "손대지 않은 곳의 서식은 저장할 때 그대로 유지됩니다.";

    const updateTextTools = (row) => {
      state.activeTextRow = row || null;
      const active = state.activeTextRow;
      const visible = state.editing && state.mode === "inline";
      textTools.hidden = !visible;
      textTools.classList.toggle("is-idle", visible && !active);
      if (!active){
        textToolsLabel.textContent = "문단 선택";
        fontTool.select.disabled = fontSizeTool.select.disabled = baselineTool.select.disabled =
          textColorTool.input.disabled = highlightTool.input.disabled = true;
        for (const button of textFormatButtons) button.disabled = true;
        for (const button of [boldTextButton, italicTextButton, underlineTextButton, strikeTextButton]){
          button.classList.remove("active"); button.setAttribute("aria-pressed", "false");
        }
        updateParagraphTools(null);
        syncToolLaunchers();
        return;
      }
      const selected = state.textSelection && state.textSelection.key === active.key &&
        state.textSelection.end > state.textSelection.start ? state.textSelection : null;
      textToolsLabel.textContent = selected ? "선택 " + (selected.end - selected.start) + "자" :
        (active.inTable ? "셀 글자" : (active.index ? "문단 " + active.index : "새 문단"));
      const format = active.index ? officeParagraphTextFormat(state.xml,
        { paragraphIndex: active.index, offset: selected ? selected.start : undefined }) : null;
      const fontValue = format ? format.font : "";
      const sizeValue = format ? String(format.fontSize) : "";
      fontTool.select.value = Array.from(fontTool.select.options).some(option => option.value === fontValue) ? fontValue : "";
      fontSizeTool.select.value = Array.from(fontSizeTool.select.options).some(option => option.value === sizeValue) ? sizeValue : "";
      baselineTool.select.value = format ? format.baseline : "baseline";
      textColorTool.input.value = "#" + (format ? format.textColor : "000000");
      highlightTool.input.value = "#" + (format && format.highlight !== "FFFFFF" ? format.highlight : "FFF2CC");
      const disabled = state.rendering;
      fontTool.select.disabled = fontSizeTool.select.disabled = baselineTool.select.disabled = textColorTool.input.disabled =
        highlightTool.input.disabled = disabled;
      for (const button of textFormatButtons) button.disabled = disabled;
      copyTextFormat.disabled = disabled || !active.index;
      pasteTextFormat.disabled = disabled || !state.formatClipboard;
      const imageInfo = active.index ? officeParagraphImageInfo(state.xml, { paragraphIndex: active.index }) : null;
      imageAddButton.disabled = disabled || !active.index;
      imageReplaceButton.disabled = imageSmallerButton.disabled = imageLargerButton.disabled =
        disabled || !imageInfo || !imageInfo.count;
      const bold = !!(format && format.bold);
      const italic = !!(format && format.italic);
      const underline = !!(format && format.underline);
      const strike = !!(format && format.strike);
      boldTextButton.classList.toggle("active", bold);
      italicTextButton.classList.toggle("active", italic);
      underlineTextButton.classList.toggle("active", underline);
      strikeTextButton.classList.toggle("active", strike);
      boldTextButton.setAttribute("aria-pressed", bold ? "true" : "false");
      italicTextButton.setAttribute("aria-pressed", italic ? "true" : "false");
      underlineTextButton.setAttribute("aria-pressed", underline ? "true" : "false");
      strikeTextButton.setAttribute("aria-pressed", strike ? "true" : "false");
      boldTextButton.title = "선택한 문단을 굵게 켜기/끄기";
      updateParagraphTools(active);
      syncToolLaunchers();
    };

    const updateParagraphTools = (row) => {
      const active = row || null;
      const visible = state.editing && state.mode === "inline";
      paragraphTools.hidden = !visible;
      paragraphTools.classList.toggle("is-idle", visible && !active);
      if (!active){
        paragraphToolsLabel.textContent = "문단 배치";
        paragraphAlignTool.select.disabled = lineSpacingTool.select.disabled = beforeSpacingTool.select.disabled =
          afterSpacingTool.select.disabled = specialIndentTool.select.disabled = listTool.select.disabled = true;
        for (const button of paragraphFormatButtons) button.disabled = true;
        paragraphToolsLabel.title = "편집할 문단을 선택하세요.";
        syncToolLaunchers();
        return;
      }
      const format = active.index ? officeParagraphLayoutFormat(state.xml, { paragraphIndex: active.index }) : null;
      const layout = format || { alignment: "left", lineSpacing: 1, before: 0, after: 0,
        left: 0, right: 0, firstLine: 0, hanging: 0 };
      paragraphAlignTool.select.value = layout.alignment;
      const selectValue = (select, value, fallback) => {
        const wanted = String(value);
        select.value = Array.from(select.options).some(option => option.value === wanted) ? wanted : fallback;
      };
      selectValue(lineSpacingTool.select, layout.lineSpacing, "1");
      selectValue(beforeSpacingTool.select, layout.before, "0");
      selectValue(afterSpacingTool.select, layout.after, "0");
      specialIndentTool.select.value = layout.hanging > 0 ? "hanging" : (layout.firstLine > 0 ? "first-line" : "none");
      const listFormat = active.index ? officeParagraphListFormat(state.xml, { paragraphIndex: active.index }) : null;
      listTool.select.value = listFormat && listFormat.numId ? officeNumberingKind(
        { ...(state.source ? state.source.parts : {}), ...(state.packageChanges || {}) }, listFormat.numId) : "none";
      const disabled = state.rendering;
      paragraphAlignTool.select.disabled = lineSpacingTool.select.disabled = beforeSpacingTool.select.disabled =
        afterSpacingTool.select.disabled = specialIndentTool.select.disabled = listTool.select.disabled = disabled;
      for (const button of paragraphFormatButtons) button.disabled = disabled;
      paragraphToolsLabel.title = "왼쪽 " + layout.left + " · 오른쪽 " + layout.right + " (Word 내부 단위)";
      syncToolLaunchers();
    };

    const updateTableTools = (row) => {
      state.activeTableRow = row && row.inTable ? row : null;
      const active = state.activeTableRow;
      const visible = state.editing && state.mode === "inline";
      tableTools.hidden = !visible;
      tableTools.classList.toggle("is-idle", visible && !active);
      if (!active){
        tableToolsLabel.textContent = "표 셀 선택";
        for (const button of tableButtons.values()) button.disabled = true;
        horizontalTool.select.disabled = verticalTool.select.disabled = fillTool.input.disabled = borderTool.input.disabled = true;
        for (const button of formatButtons) button.disabled = true;
        syncToolLaunchers();
        return;
      }
      tableToolsLabel.textContent = "표 " + active.tableIndex + " · " + active.tableRow + "행 " + active.tableCell + "열";
      const nested = active.tableHasNested;
      const rowBlocked = nested || active.tableHasVerticalMerge;
      const columnBlocked = nested || active.tableHasVerticalMerge || active.tableHasGridSpan || !active.tableRectangular;
      for (const [kind, button] of tableButtons){
        const rowAction = kind.startsWith("row-");
        const cellAction = kind.startsWith("cell-");
        const cellBlocked = nested || !!active.tableCellVmerge ||
          (kind === "cell-merge-right" && active.tableCell >= active.tableRowCellCount) ||
          (kind === "cell-split" && active.tableCellGridSpan <= 1);
        button.disabled = state.rendering || (cellAction ? cellBlocked : (rowAction ? rowBlocked : columnBlocked)) ||
          (kind === "row-delete" && active.tableRowCount <= 1) ||
          (kind === "column-delete" && active.tableColumnCount <= 1);
        if (nested) button.title = "표 안에 다른 표가 들어 있어 구조는 바꿀 수 없어요.";
        else if (cellAction && active.tableCellVmerge) button.title = "세로 병합된 셀은 여기서 바꿀 수 없어요.";
        else if (kind === "cell-merge-right" && active.tableCell >= active.tableRowCellCount) button.title = "오른쪽에 합칠 셀이 없어요.";
        else if (kind === "cell-split" && active.tableCellGridSpan <= 1) button.title = "가로로 병합된 셀만 나눌 수 있어요.";
        else if (rowAction && active.tableHasVerticalMerge) button.title = "세로 병합된 셀이 있어 행 구조는 바꿀 수 없어요.";
        else if (!cellAction && !rowAction && (active.tableHasVerticalMerge || active.tableHasGridSpan)) button.title = "병합된 셀이 있어 열 구조는 바꿀 수 없어요.";
        else button.title = button.dataset.normalTitle;
      }
      syncToolLaunchers();
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

    const updateDocumentTools = () => {
      documentTools.hidden = !state.editing;
      if (!state.xml) return;
      const format = officeDocumentPageFormat(state.xml);
      orientationTool.select.value = format.orientation;
      marginsTool.select.value = format.top === 720 && format.right === 720 && format.bottom === 720 && format.left === 720
        ? "narrow" : (format.top === 1440 && format.right === 2880 && format.bottom === 1440 && format.left === 2880
          ? "wide" : "normal");
      const disabled = state.rendering || state.saving;
      orientationTool.select.disabled = marginsTool.select.disabled = headerEditButton.disabled = footerEditButton.disabled = disabled;
      syncToolLaunchers();
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
      syncToolLaunchers();
      updateDocumentTools();
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
      "column-add-left": "표 열 추가", "column-add-right": "표 열 추가", "column-delete": "표 열 삭제",
      "cell-merge-right": "표 셀 병합", "cell-split": "표 셀 분할"
    };
    const tableFormatLabel = {
      horizontal: "셀 가로 정렬", vertical: "셀 세로 정렬", fill: "셀 배경",
      border: "셀 테두리", "column-width": "표 열 너비", "row-height": "표 행 높이"
    };
    const textFormatLabel = {
      font: "문단 글꼴", "font-size": "문단 글자 크기", bold: "문단 굵게", italic: "문단 기울임",
      underline: "문단 밑줄", strike: "문단 취소선", baseline: "문단 첨자",
      "text-color": "문단 글자색", highlight: "문단 형광펜",
      "clear-format": "문단 서식 지우기"
    };
    const paragraphFormatLabel = {
      alignment: "문단 정렬", "line-spacing": "문단 줄 간격", "space-before": "문단 앞 간격",
      "space-after": "문단 뒤 간격", "indent-left": "문단 왼쪽 들여쓰기",
      "indent-right": "문단 오른쪽 들여쓰기", "special-indent": "문단 특수 들여쓰기",
      "clear-layout": "문단 배치 지우기"
    };
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
        const draftBytes = await MNOfficeReplace.build(state.source.bytes,
          { ...(state.packageChanges || {}), "word/document.xml": state.xml });
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
        updateDocumentTools();
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
      const request = {
        kind,
        tableIndex: active.tableIndex,
        rowIndex: active.tableRow,
        cellIndex: active.tableCell
      };
      const result = kind.startsWith("cell-") ? officeTableCellMergeEdit(withText, request)
        : officeTableStructureEdit(withText, request);
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
      const selected = state.textSelection && state.textSelection.key === active.key &&
        state.textSelection.end > state.textSelection.start ? state.textSelection : null;
      const request = { kind, value, paragraphIndex };
      if (selected){ request.rangeStart = selected.start; request.rangeEnd = selected.end; }
      const result = officeParagraphFormatEdit(withText, request);
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
      state.textSelection = null;
      state.onDirty();
      state.commitNow();
      await state.renderDraft(result.selection);
    };

    const applyParagraphFormat = async (kind, value) => {
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
      const request = { kind, paragraphIndex };
      if (kind === "indent-left" || kind === "indent-right") request.delta = Number(value) || 0;
      else request.value = value;
      const result = officeParagraphLayoutEdit(withText, request);
      if (!result.changed){ toastOnce(result.reason || "문단 서식을 바꾸지 못했어요."); return; }
      state.xml = result.xml;
      state.xmlVersion = ++state.xmlVersionSeq;
      state.xmlVersions.set(state.xmlVersion, state.xml);
      state.rows = rowsFromOutline(officeParagraphOutline(state.xml));
      state.structureDirty = true;
      state.tableChanges.push(paragraphFormatLabel[kind] || "문단 배치 서식");
      state.bakedPlan.changed += paragraphPlan.changed || 0;
      state.bakedPlan.inserted += paragraphPlan.inserted || 0;
      state.bakedPlan.removed += paragraphPlan.removed || 0;
      state.activeTextRow = state.activeTableRow = null;
      state.onDirty();
      state.commitNow();
      await state.renderDraft(result.selection);
    };

    const applyListFormat = async (kind) => {
      const active = state.activeTextRow;
      if (!active || state.rendering || state.saving || state.mode !== "inline" || kind === "list") return;
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
      let numId = 0, packageReplacements = null;
      if (kind !== "none"){
        const ensured = officeEnsureNumbering(
          { ...(state.source ? state.source.parts : {}), ...(state.packageChanges || {}) }, kind);
        numId = ensured.numId;
        packageReplacements = ensured.replacements;
      }
      const result = officeParagraphListEdit(withText, { kind, numId, paragraphIndex });
      if (!result.changed){ toastOnce(result.reason || "목록 형식을 바꾸지 못했어요."); return; }
      if (packageReplacements) state.setPackageChanges(packageReplacements);
      state.xml = result.xml;
      state.xmlVersion = ++state.xmlVersionSeq;
      state.xmlVersions.set(state.xmlVersion, state.xml);
      state.rows = rowsFromOutline(officeParagraphOutline(state.xml));
      state.structureDirty = true;
      state.tableChanges.push(kind === "bullet" ? "글머리표" : (kind === "number" ? "번호 매기기" : "목록 해제"));
      state.bakedPlan.changed += paragraphPlan.changed || 0;
      state.bakedPlan.inserted += paragraphPlan.inserted || 0;
      state.bakedPlan.removed += paragraphPlan.removed || 0;
      state.activeTextRow = state.activeTableRow = null;
      state.onDirty();
      state.commitNow();
      await state.renderDraft(result.selection);
    };

    const copyCurrentFormatting = () => {
      const active = state.activeTextRow;
      if (!active || !active.index) return;
      const selected = state.textSelection && state.textSelection.key === active.key &&
        state.textSelection.end > state.textSelection.start ? state.textSelection : null;
      const text = officeParagraphTextFormat(state.xml,
        { paragraphIndex: active.index, offset: selected ? selected.start : undefined });
      const layout = officeParagraphLayoutFormat(state.xml, { paragraphIndex: active.index });
      const list = officeParagraphListFormat(state.xml, { paragraphIndex: active.index });
      state.formatClipboard = {
        text,
        layout: selected ? null : layout,
        listKind: selected || !list || !list.numId ? "none" : officeNumberingKind(
          { ...(state.source ? state.source.parts : {}), ...(state.packageChanges || {}) }, list.numId)
      };
      pasteTextFormat.disabled = false;
      toastOnce(selected ? "선택한 글자의 서식을 복사했어요." : "문단 서식을 복사했어요.");
    };

    const pasteCurrentFormatting = async () => {
      const active = state.activeTextRow;
      const copied = state.formatClipboard;
      if (!active || !copied || state.rendering || state.saving || state.mode !== "inline") return;
      if (state.history) state.history.commit();
      const visibleRows = state.rows.filter(row => !row.removed);
      const paragraphIndex = visibleRows.indexOf(active) + 1;
      if (!paragraphIndex) return;
      const paragraphPlan = officeParagraphEditPlan(state.xml, state.rows);
      if (paragraphPlan.skipped || paragraphPlan.refused.length){
        toastOnce("먼저 저장할 수 없는 문단 편집을 정리해 주세요.");
        return;
      }
      let nextXml = officeApplyEdits(state.xml, paragraphPlan.edits);
      const selected = state.textSelection && state.textSelection.key === active.key &&
        state.textSelection.end > state.textSelection.start ? state.textSelection : null;
      const textRequest = (kind, value) => ({ kind, value, paragraphIndex,
        rangeStart: selected ? selected.start : undefined, rangeEnd: selected ? selected.end : undefined });
      const applyText = (kind, value) => {
        const result = officeParagraphFormatEdit(nextXml, textRequest(kind, value));
        if (result.changed) nextXml = result.xml;
      };
      applyText("clear-format", "");
      if (copied.text){
        if (copied.text.font) applyText("font", copied.text.font);
        applyText("font-size", copied.text.fontSize);
        applyText("bold", copied.text.bold);
        applyText("italic", copied.text.italic);
        applyText("underline", copied.text.underline);
        applyText("strike", copied.text.strike);
        applyText("baseline", copied.text.baseline);
        if (copied.text.textColor !== "000000") applyText("text-color", copied.text.textColor);
        if (copied.text.highlight !== "FFFFFF") applyText("highlight", copied.text.highlight);
      }
      let packageReplacements = null;
      if (!selected && copied.layout){
        const applyLayout = (kind, value, delta) => {
          const request = { kind, paragraphIndex };
          if (delta) request.delta = Number(value) || 0; else request.value = value;
          const result = officeParagraphLayoutEdit(nextXml, request);
          if (result.changed) nextXml = result.xml;
        };
        applyLayout("clear-layout", "");
        applyLayout("alignment", copied.layout.alignment);
        applyLayout("line-spacing", copied.layout.lineSpacing);
        applyLayout("space-before", copied.layout.before);
        applyLayout("space-after", copied.layout.after);
        if (copied.layout.left) applyLayout("indent-left", copied.layout.left, true);
        if (copied.layout.right) applyLayout("indent-right", copied.layout.right, true);
        applyLayout("special-indent", copied.layout.hanging > 0 ? "hanging" :
          (copied.layout.firstLine > 0 ? "first-line" : "none"));
        if (/^(bullet|number)$/.test(copied.listKind)){
          const ensured = officeEnsureNumbering(
            { ...(state.source ? state.source.parts : {}), ...(state.packageChanges || {}) }, copied.listKind);
          packageReplacements = ensured.replacements;
          const result = officeParagraphListEdit(nextXml,
            { kind: copied.listKind, numId: ensured.numId, paragraphIndex });
          if (result.changed) nextXml = result.xml;
        } else if (copied.listKind === "none"){
          const result = officeParagraphListEdit(nextXml, { kind: "none", paragraphIndex });
          if (result.changed) nextXml = result.xml;
        }
      }
      if (nextXml === state.xml){ toastOnce("같은 서식이에요."); return; }
      if (packageReplacements) state.setPackageChanges(packageReplacements);
      state.xml = nextXml;
      state.xmlVersion = ++state.xmlVersionSeq;
      state.xmlVersions.set(state.xmlVersion, state.xml);
      state.rows = rowsFromOutline(officeParagraphOutline(state.xml));
      state.structureDirty = true;
      state.tableChanges.push(selected ? "선택 글자 서식 붙임" : "문단 서식 붙임");
      state.bakedPlan.changed += paragraphPlan.changed || 0;
      state.bakedPlan.inserted += paragraphPlan.inserted || 0;
      state.bakedPlan.removed += paragraphPlan.removed || 0;
      state.activeTextRow = state.activeTableRow = null;
      state.textSelection = null;
      state.onDirty();
      state.commitNow();
      await state.renderDraft({ paragraphIndex });
    };

    const finishDocumentEdit = async (nextXml, label, paragraphPlan, packageChanges) => {
      if (packageChanges && Object.keys(packageChanges).length) state.setPackageChanges(packageChanges);
      state.xml = nextXml;
      state.xmlVersion = ++state.xmlVersionSeq;
      state.xmlVersions.set(state.xmlVersion, state.xml);
      state.rows = rowsFromOutline(officeParagraphOutline(state.xml));
      state.structureDirty = true;
      state.tableChanges.push(label);
      state.bakedPlan.changed += paragraphPlan.changed || 0;
      state.bakedPlan.inserted += paragraphPlan.inserted || 0;
      state.bakedPlan.removed += paragraphPlan.removed || 0;
      state.activeTextRow = state.activeTableRow = null;
      state.onDirty();
      state.commitNow();
      await state.renderDraft();
    };

    const applyPageSetting = async (kind, value) => {
      if (!state.source || state.rendering || state.saving) return;
      if (state.history) state.history.commit();
      const paragraphPlan = officeParagraphEditPlan(state.xml, state.rows);
      if (paragraphPlan.skipped || paragraphPlan.refused.length){
        toastOnce("먼저 저장할 수 없는 문단 편집을 정리해 주세요."); return;
      }
      const withText = officeApplyEdits(state.xml, paragraphPlan.edits);
      const result = officeDocumentPageEdit(withText, { kind, value });
      if (!result.changed){ toastOnce(result.reason || "페이지 설정을 바꾸지 못했어요."); return; }
      await finishDocumentEdit(result.xml, kind === "orientation" ? "용지 방향" : "페이지 여백", paragraphPlan);
    };

    const editHeaderFooter = async (kind) => {
      if (!state.source || state.rendering || state.saving) return;
      const paragraphPlan = officeParagraphEditPlan(state.xml, state.rows);
      if (paragraphPlan.skipped || paragraphPlan.refused.length){
        toastOnce("먼저 저장할 수 없는 문단 편집을 정리해 주세요."); return;
      }
      const withText = officeApplyEdits(state.xml, paragraphPlan.edits);
      const parts = { ...(state.source.parts || {}), ...(state.packageChanges || {}) };
      const info = officeHeaderFooterInfo(parts, withText, kind);
      const label = kind === "footer" ? "바닥글" : "머리글";
      const value = window.prompt(label + "에 넣을 글자를 입력하세요. 비우면 글자가 지워집니다.", info.text || "");
      if (value === null) return;
      if (state.history) state.history.commit();
      const result = officeHeaderFooterEdit(parts, withText, kind, value);
      if (!result.changed){ toastOnce(result.reason || label + "을 바꾸지 못했어요."); return; }
      const changes = { ...result.replacements };
      delete changes["word/document.xml"];
      await finishDocumentEdit(result.documentXml, label + " 편집", paragraphPlan, changes);
    };

    const imageDimensions = async (file) => {
      if (typeof createImageBitmap === "function"){
        try {
          const bitmap = await createImageBitmap(file);
          const size = { width: bitmap.width, height: bitmap.height };
          if (bitmap.close) bitmap.close();
          return size;
        } catch(_){}
      }
      return await new Promise(resolve => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { const size = { width: img.naturalWidth || 400, height: img.naturalHeight || 300 };
          URL.revokeObjectURL(url); resolve(size); };
        img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 400, height: 300 }); };
        img.src = url;
      });
    };

    const applyImageChange = async (kind, file, scale) => {
      const active = state.activeTextRow;
      if (!active || !active.index || state.rendering || state.saving) return;
      if (state.history) state.history.commit();
      const visibleRows = state.rows.filter(row => !row.removed);
      const paragraphIndex = visibleRows.indexOf(active) + 1;
      const paragraphPlan = officeParagraphEditPlan(state.xml, state.rows);
      if (!paragraphIndex || paragraphPlan.skipped || paragraphPlan.refused.length){
        toastOnce("먼저 저장할 수 없는 문단 편집을 정리해 주세요."); return;
      }
      const withText = officeApplyEdits(state.xml, paragraphPlan.edits);
      const parts = { ...(state.source.parts || {}), ...(state.packageChanges || {}) };
      const request = { kind, paragraphIndex, scale };
      if (file){
        const dimensions = await imageDimensions(file);
        request.bytes = new Uint8Array(await file.arrayBuffer());
        request.mime = file.type;
        request.name = file.name;
        request.widthPx = dimensions.width;
        request.heightPx = dimensions.height;
      }
      const result = officeImagePackageEdit(parts, withText, request);
      if (!result.changed){ toastOnce(result.reason || "그림을 바꾸지 못했어요."); return; }
      await finishDocumentEdit(result.documentXml, kind === "add" ? "그림 추가" :
        (kind === "replace" ? "그림 교체" : "그림 크기"), paragraphPlan, result.replacements);
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
    italicTextButton.addEventListener("mousedown", (e) => e.preventDefault());
    italicTextButton.addEventListener("click", () => {
      const active = state.activeTextRow;
      const format = active && active.index ? officeParagraphTextFormat(state.xml, { paragraphIndex: active.index }) : null;
      applyTextFormat("italic", !(format && format.italic));
    });
    underlineTextButton.addEventListener("mousedown", (e) => e.preventDefault());
    underlineTextButton.addEventListener("click", () => {
      const active = state.activeTextRow;
      const format = active && active.index ? officeParagraphTextFormat(state.xml, { paragraphIndex: active.index }) : null;
      applyTextFormat("underline", !(format && format.underline));
    });
    strikeTextButton.addEventListener("mousedown", (e) => e.preventDefault());
    strikeTextButton.addEventListener("click", () => {
      const active = state.activeTextRow;
      const format = active && active.index ? officeParagraphTextFormat(state.xml, { paragraphIndex: active.index }) : null;
      applyTextFormat("strike", !(format && format.strike));
    });
    baselineTool.select.addEventListener("change", () => applyTextFormat("baseline", baselineTool.select.value));
    for (const button of [textColorApply, textColorClear, highlightApply, highlightClear, clearTextFormat,
      copyTextFormat, pasteTextFormat, imageAddButton, imageReplaceButton, imageSmallerButton, imageLargerButton])
      button.addEventListener("mousedown", (e) => e.preventDefault());
    textColorApply.addEventListener("click", () => applyTextFormat("text-color", textColorTool.input.value));
    textColorClear.addEventListener("click", () => applyTextFormat("text-color", ""));
    highlightApply.addEventListener("click", () => applyTextFormat("highlight", highlightTool.input.value));
    highlightClear.addEventListener("click", () => applyTextFormat("highlight", ""));
    clearTextFormat.addEventListener("click", () => applyTextFormat("clear-format", ""));
    copyTextFormat.addEventListener("click", copyCurrentFormatting);
    pasteTextFormat.addEventListener("click", pasteCurrentFormatting);
    imageAddButton.addEventListener("click", () => { state.pendingImageKind = "add"; imageInput.value = ""; imageInput.click(); });
    imageReplaceButton.addEventListener("click", () => { state.pendingImageKind = "replace"; imageInput.value = ""; imageInput.click(); });
    imageSmallerButton.addEventListener("click", () => applyImageChange("resize", null, 0.9));
    imageLargerButton.addEventListener("click", () => applyImageChange("resize", null, 1.1));
    imageInput.addEventListener("change", () => {
      const chosen = imageInput.files && imageInput.files[0];
      if (chosen) applyImageChange(state.pendingImageKind, chosen);
    });
    paragraphAlignTool.select.addEventListener("change", () => applyParagraphFormat("alignment", paragraphAlignTool.select.value));
    lineSpacingTool.select.addEventListener("change", () => applyParagraphFormat("line-spacing", lineSpacingTool.select.value));
    beforeSpacingTool.select.addEventListener("change", () => applyParagraphFormat("space-before", beforeSpacingTool.select.value));
    afterSpacingTool.select.addEventListener("change", () => applyParagraphFormat("space-after", afterSpacingTool.select.value));
    specialIndentTool.select.addEventListener("change", () => applyParagraphFormat("special-indent", specialIndentTool.select.value));
    listTool.select.addEventListener("change", () => applyListFormat(listTool.select.value));
    orientationTool.select.addEventListener("change", () => applyPageSetting("orientation", orientationTool.select.value));
    marginsTool.select.addEventListener("change", () => applyPageSetting("margins", marginsTool.select.value));
    headerEditButton.addEventListener("click", () => editHeaderFooter("header"));
    footerEditButton.addEventListener("click", () => editHeaderFooter("footer"));
    for (const button of paragraphFormatButtons){
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => applyParagraphFormat(button.dataset.paragraphFormat, button.dataset.paragraphValue));
    }
    const selectDocumentParagraph = (e) => {
      if (!state.editing || state.mode !== "inline") return;
      const node = e.target && e.target.closest ? e.target.closest("[data-key]") : null;
      const row = inlineRowOf(state, node);
      updateTextTools(row);
      updateTableTools(row);
    };
    const rememberTextSelection = (event) => {
      if (!state.editing || state.mode !== "inline") return;
      const sel = window.getSelection && window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      const paragraph = node && node.closest ? node.closest("[data-key]") : null;
      const row = inlineRowOf(state, paragraph);
      const offsets = row && paragraph ? selectionOffsetsIn(paragraph) : null;
      // 선택한 글자를 우클릭하면 브라우저가 contextmenu 직전에 Selection 을 접기도 한다.
      // 오른쪽 버튼 mouseup 에서는 마지막 선택을 지우지 않아, 메뉴의 글자 서식이 원래 범위에 적용되게 한다.
      if (offsets) state.textSelection = { key: row.key, start: offsets.start, end: offsets.end };
      else if (!event || event.button !== 2) state.textSelection = null;
      if (row) updateTextTools(row);
    };

    /* ---------- DOCX 우클릭 편집 메뉴 ----------
       상단 도구와 별도 편집 경로를 만들지 않고 같은 action 함수를 부른다. 그러면 저장·되돌리기와
       지원 제한(병합 셀, 중첩 표 등)이 어느 쪽에서 실행해도 완전히 같다. */
    let contextLayers = [], contextOutside = null, contextKeydown = null, contextResize = null;
    let contextSubTimer = null;
    const cancelContextSubClose = () => {
      if (contextSubTimer){ clearTimeout(contextSubTimer); contextSubTimer = null; }
    };
    const closeContextLayers = (depth) => {
      while (contextLayers.length > depth){
        const layer = contextLayers.pop();
        if (layer.__parentButton) layer.__parentButton.classList.remove("is-open");
        layer.remove();
      }
    };
    const closeDocxContextMenu = () => {
      cancelContextSubClose();
      closeContextLayers(0);
      for (const button of toolLauncherButtons.values()) button.setAttribute("aria-expanded", "false");
      if (contextOutside){ document.removeEventListener("pointerdown", contextOutside, true); contextOutside = null; }
      if (contextKeydown){ document.removeEventListener("keydown", contextKeydown, true); contextKeydown = null; }
      if (contextResize){ window.removeEventListener("resize", contextResize); contextResize = null; }
    };
    if (doc.cleanupFns) doc.cleanupFns.push(closeDocxContextMenu);

    const placeContextSub = (menu, button) => {
      const anchor = button.getBoundingClientRect();
      const margin = 6, width = menu.offsetWidth, height = menu.offsetHeight;
      let left = anchor.right - 4;
      if (left + width > window.innerWidth - margin) left = anchor.left - width + 4;
      let top = anchor.top - 5;
      left = Math.max(margin, left);
      top = Math.max(margin, Math.min(window.innerHeight - height - margin, top));
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    };
    const renderContextLayer = (items, depth) => {
      const menu = document.createElement("div");
      menu.className = depth ? "docx-context-menu docx-context-sub" : "docx-context-menu";
      menu.setAttribute("role", "menu");
      menu.addEventListener("pointerenter", cancelContextSubClose);
      for (const item of items){
        if (item.separator){
          const sep = document.createElement("div");
          sep.className = "docx-context-sep"; sep.setAttribute("role", "separator"); menu.appendChild(sep); continue;
        }
        const button = document.createElement("button");
        button.type = "button"; button.setAttribute("role", "menuitem");
        if (item.swatch){
          button.className = "docx-context-swatch-btn";
          const chip = document.createElement("span"); chip.className = "docx-context-swatch";
          chip.style.background = item.swatch; button.append(chip, document.createTextNode(item.label));
        } else button.textContent = item.label;
        if (item.title) button.title = item.title;
        button.disabled = typeof item.disabled === "function" ? !!item.disabled() : !!item.disabled;
        const children = item.children || [];
        if (children.length){
          button.classList.add("docx-context-parent");
          const openChildren = () => {
            if (button.disabled) return;
            const opened = contextLayers[depth + 1];
            if (opened && opened.__parentButton === button) return;
            closeContextLayers(depth + 1);
            const sub = renderContextLayer(children, depth + 1);
            sub.__parentButton = button; document.body.appendChild(sub); contextLayers.push(sub);
            button.classList.add("is-open"); placeContextSub(sub, button);
          };
          button.addEventListener("pointerenter", () => { cancelContextSubClose(); openChildren(); });
          button.addEventListener("click", openChildren);
        } else {
          button.addEventListener("pointerenter", () => {
            if (contextLayers.length <= depth + 1) return;
            cancelContextSubClose();
            contextSubTimer = setTimeout(() => closeContextLayers(depth + 1), 220);
          });
          button.addEventListener("pointerdown", event => event.preventDefault());
          button.addEventListener("click", () => {
            if (button.disabled) return;
            closeDocxContextMenu();
            if (typeof item.action === "function") item.action();
          });
        }
        menu.appendChild(button);
      }
      return menu;
    };
    const openDocxContextMenu = (x, y, items) => {
      closeDocxContextMenu();
      const menu = renderContextLayer(items, 0);
      document.body.appendChild(menu); contextLayers.push(menu);
      const rect = menu.getBoundingClientRect();
      menu.style.left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, x)) + "px";
      menu.style.top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, y)) + "px";
      contextOutside = event => {
        if (!contextLayers.some(layer => layer.contains(event.target))) closeDocxContextMenu();
      };
      contextKeydown = event => {
        if (event.key !== "Escape") return;
        if (contextLayers.length > 1) closeContextLayers(contextLayers.length - 1);
        else closeDocxContextMenu();
      };
      contextResize = closeDocxContextMenu;
      setTimeout(() => {
        if (!contextLayers.length) return;
        document.addEventListener("pointerdown", contextOutside, true);
        document.addEventListener("keydown", contextKeydown, true);
        window.addEventListener("resize", contextResize);
      }, 0);
    };

    const rangeInside = (paragraph) => {
      try {
        const selection = window.getSelection && window.getSelection();
        if (!selection || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        return paragraph.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
      } catch(_){ return null; }
    };
    const rangeAtOffsets = (paragraph, start, end) => {
      try {
        const texts = [];
        const collect = node => {
          for (const child of node.childNodes){
            if (child.nodeType === 3) texts.push(child);
            else if (child.nodeType === 1 && !(child.tagName === "P" && child !== paragraph)) collect(child);
          }
        };
        collect(paragraph);
        const point = offset => {
          let remaining = Math.max(0, Number(offset) || 0);
          for (const text of texts){
            if (remaining <= text.nodeValue.length) return [text, remaining];
            remaining -= text.nodeValue.length;
          }
          const tail = texts[texts.length - 1];
          return tail ? [tail, tail.nodeValue.length] : [paragraph, 0];
        };
        const a = point(start), b = point(end);
        const range = document.createRange(); range.setStart(a[0], a[1]); range.setEnd(b[0], b[1]);
        return range;
      } catch(_){ return null; }
    };
    const restoreRange = (paragraph, range) => {
      try {
        paragraph.focus({ preventScroll: true });
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return true;
      } catch(_){ return false; }
    };
    const pickContextColor = (initial, apply) => {
      const picker = document.createElement("input"); picker.type = "color";
      picker.value = /^#[0-9a-f]{6}$/i.test(String(initial || "")) ? initial : "#000000";
      picker.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
      document.body.appendChild(picker);
      picker.addEventListener("change", () => { apply(picker.value); picker.remove(); });
      picker.addEventListener("blur", () => setTimeout(() => picker.remove(), 400));
      picker.click();
    };
    const marked = (label, active) => (active ? "✓ " : "　") + label;
    const menuChoice = (label, active, action, extra={}) => ({ ...extra, label: marked(label, active), action });

    const addParagraphBelow = () => {
      const row = state.activeTextRow;
      if (!row || row.inTable || state.rendering || state.saving) return;
      const at = state.rows.indexOf(row), made = makeNewRow(row, "");
      made.after = anchorIndexFor(state.rows, at); state.rows.splice(at + 1, 0, made);
      state.focusKey = made.key; redraw(state); state.commitNow();
    };
    const toggleParagraphRemoved = () => {
      const row = state.activeTextRow;
      if (!row || (!row.removed && !canRemoveParagraph(state.rows, row)) || state.rendering || state.saving) return;
      if (!row.index) state.rows.splice(state.rows.indexOf(row), 1);
      else row.removed = !row.removed;
      state.focusKey = 0; redraw(state); state.commitNow();
    };
    const requestImage = kind => {
      state.pendingImageKind = kind; imageInput.value = ""; imageInput.click();
    };
    const contextItemsFor = (row, paragraph, originalRange, point) => {
      const selected = state.textSelection && state.textSelection.key === row.key &&
        state.textSelection.end > state.textSelection.start ? state.textSelection : null;
      let commandRange = originalRange;
      if ((!commandRange || commandRange.collapsed) && selected)
        commandRange = rangeAtOffsets(paragraph, selected.start, selected.end);
      const hasSelection = !!(commandRange && !commandRange.collapsed);
      const editable = paragraph.contentEditable === "true";
      const format = row.index ? officeParagraphTextFormat(state.xml,
        { paragraphIndex: row.index, offset: selected ? selected.start : undefined }) : null;
      const layout = row.index ? officeParagraphLayoutFormat(state.xml, { paragraphIndex: row.index }) : null;
      const list = row.index ? officeParagraphListFormat(state.xml, { paragraphIndex: row.index }) : null;
      const listKind = list && list.numId ? officeNumberingKind(
        { ...(state.source ? state.source.parts : {}), ...(state.packageChanges || {}) }, list.numId) : "none";
      const busy = state.rendering || state.saving;
      const copyText = async () => {
        const text = commandRange ? commandRange.toString() : "";
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
          else { restoreRange(paragraph, commandRange); document.execCommand("copy"); }
        } catch(_){ restoreRange(paragraph, commandRange); try { document.execCommand("copy"); } catch(__){} }
      };
      const cutText = () => {
        if (!restoreRange(paragraph, commandRange)) return;
        try { document.execCommand("cut"); } catch(_){ toastOnce("잘라내기는 Ctrl+X로 할 수 있어요."); }
      };
      const pasteText = async () => {
        if (!restoreRange(paragraph, commandRange || rangeInside(paragraph))) return;
        try {
          if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error("clipboard unavailable");
          const value = await navigator.clipboard.readText();
          restoreRange(paragraph, commandRange || rangeInside(paragraph));
          if (!document.execCommand("insertText", false, value)) throw new Error("insert failed");
        } catch(_){ toastOnce("붙여넣기는 Ctrl+V로 할 수 있어요."); }
      };
      const selectAll = () => {
        try {
          paragraph.focus({ preventScroll:true });
          const range = document.createRange(); range.selectNodeContents(paragraph);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          rememberTextSelection();
        } catch(_){}
      };
      const palette = [
        ["검정", "#000000"], ["회색", "#666666"], ["빨강", "#c00000"], ["주황", "#ed7d31"],
        ["노랑", "#ffc000"], ["초록", "#008000"], ["파랑", "#0070c0"], ["보라", "#7030a0"]
      ];
      const colorItems = (kind, current, input, clearLabel) => [
        ...palette.map(([label, value]) => menuChoice(label, current === value.slice(1).toUpperCase(),
          () => { input.value = value; applyTextFormat(kind, value); }, { swatch: value, disabled: busy })),
        { label: "다른 색…", action: () => pickContextColor(input.value, value => { input.value = value; applyTextFormat(kind, value); }), disabled: busy },
        { separator: true },
        { label: clearLabel, action: () => applyTextFormat(kind, ""), disabled: busy }
      ];
      const fontNames = ["맑은 고딕", "굴림", "돋움", "바탕", "궁서", "Arial", "Calibri", "Times New Roman", "Courier New"];
      const fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
      const textItems = [
        { label: "글꼴", children: fontNames.map(value => menuChoice(value, !!format && format.font === value,
          () => applyTextFormat("font", value), { disabled: busy })) },
        { label: "글자 크기", children: fontSizes.map(value => menuChoice(value + "pt", !!format && Number(format.fontSize) === value,
          () => applyTextFormat("font-size", value), { disabled: busy })) },
        { separator: true },
        menuChoice("굵게", !!(format && format.bold), () => applyTextFormat("bold", !(format && format.bold)), { disabled: busy }),
        menuChoice("기울임", !!(format && format.italic), () => applyTextFormat("italic", !(format && format.italic)), { disabled: busy }),
        menuChoice("밑줄", !!(format && format.underline), () => applyTextFormat("underline", !(format && format.underline)), { disabled: busy }),
        menuChoice("취소선", !!(format && format.strike), () => applyTextFormat("strike", !(format && format.strike)), { disabled: busy }),
        { label: "첨자", children: [
          menuChoice("보통", !format || format.baseline === "baseline", () => applyTextFormat("baseline", "baseline"), { disabled: busy }),
          menuChoice("위 첨자", !!format && format.baseline === "superscript", () => applyTextFormat("baseline", "superscript"), { disabled: busy }),
          menuChoice("아래 첨자", !!format && format.baseline === "subscript", () => applyTextFormat("baseline", "subscript"), { disabled: busy })
        ] },
        { label: "글자색", children: colorItems("text-color", format ? format.textColor : "000000", textColorTool.input, "글자색 지우기") },
        { label: "형광펜", children: colorItems("highlight", format ? format.highlight : "FFFFFF", highlightTool.input, "형광펜 지우기") },
        { separator: true },
        { label: "글자 서식 지우기", action: () => applyTextFormat("clear-format", ""), disabled: busy }
      ];
      const alignment = layout ? layout.alignment : "left";
      const lineSpacing = layout ? String(layout.lineSpacing) : "1";
      const specialIndent = layout && layout.hanging > 0 ? "hanging" : (layout && layout.firstLine > 0 ? "first-line" : "none");
      const paragraphItems = [
        { label: "정렬", children: [["왼쪽", "left"], ["가운데", "center"], ["오른쪽", "right"], ["양쪽", "both"]]
          .map(([label, value]) => menuChoice(label, alignment === value, () => applyParagraphFormat("alignment", value), { disabled: busy })) },
        { label: "줄 간격", children: ["1", "1.15", "1.5", "2"].map(value =>
          menuChoice(value, lineSpacing === value, () => applyParagraphFormat("line-spacing", value), { disabled: busy })) },
        { label: "문단 앞 간격", children: [0, 3, 6, 8, 10, 12, 18, 24].map(value =>
          menuChoice(value + "pt", !!layout && Number(layout.before) === value, () => applyParagraphFormat("space-before", value), { disabled: busy })) },
        { label: "문단 뒤 간격", children: [0, 3, 6, 8, 10, 12, 18, 24].map(value =>
          menuChoice(value + "pt", !!layout && Number(layout.after) === value, () => applyParagraphFormat("space-after", value), { disabled: busy })) },
        { separator: true },
        { label: "왼쪽 들여쓰기 줄이기", action: () => applyParagraphFormat("indent-left", -360), disabled: busy },
        { label: "왼쪽 들여쓰기 늘리기", action: () => applyParagraphFormat("indent-left", 360), disabled: busy },
        { label: "오른쪽 들여쓰기 줄이기", action: () => applyParagraphFormat("indent-right", -360), disabled: busy },
        { label: "오른쪽 들여쓰기 늘리기", action: () => applyParagraphFormat("indent-right", 360), disabled: busy },
        { label: "특수 들여쓰기", children: [["없음", "none"], ["첫 줄", "first-line"], ["내어쓰기", "hanging"]]
          .map(([label, value]) => menuChoice(label, specialIndent === value, () => applyParagraphFormat("special-indent", value), { disabled: busy })) },
        { separator: true },
        { label: "문단 배치 서식 지우기", action: () => applyParagraphFormat("clear-layout", ""), disabled: busy }
      ];
      const tableDisabled = kind => {
        const button = tableButtons.get(kind); return busy || !button || button.disabled;
      };
      const tableFormatDisabled = kind => {
        const button = formatButtons.find(item => item.dataset.tableFormat === kind);
        return busy || !button || button.disabled;
      };
      const tableItems = row.inTable ? [
        { label: "행", children: [
          { label: "위에 행 추가", action: () => applyTableAction("row-add-above"), disabled: tableDisabled("row-add-above") },
          { label: "아래에 행 추가", action: () => applyTableAction("row-add-below"), disabled: tableDisabled("row-add-below") },
          { label: "현재 행 삭제", action: () => applyTableAction("row-delete"), disabled: tableDisabled("row-delete") }
        ] },
        { label: "열", children: [
          { label: "왼쪽에 열 추가", action: () => applyTableAction("column-add-left"), disabled: tableDisabled("column-add-left") },
          { label: "오른쪽에 열 추가", action: () => applyTableAction("column-add-right"), disabled: tableDisabled("column-add-right") },
          { label: "현재 열 삭제", action: () => applyTableAction("column-delete"), disabled: tableDisabled("column-delete") },
          { separator: true },
          { label: "열 너비 줄이기", action: () => applyTableFormat("column-width", -240), disabled: tableFormatDisabled("column-width") },
          { label: "열 너비 늘리기", action: () => applyTableFormat("column-width", 240), disabled: tableFormatDisabled("column-width") }
        ] },
        { label: "셀", children: [
          { label: "오른쪽 셀과 병합", action: () => applyTableAction("cell-merge-right"), disabled: tableDisabled("cell-merge-right") },
          { label: "병합 셀 나누기", action: () => applyTableAction("cell-split"), disabled: tableDisabled("cell-split") },
          { separator: true },
          { label: "가로 정렬", children: [["왼쪽", "left"], ["가운데", "center"], ["오른쪽", "right"]]
            .map(([label, value]) => menuChoice(label, horizontalTool.select.value === value,
              () => applyTableFormat("horizontal", value), { disabled: horizontalTool.select.disabled })) },
          { label: "세로 정렬", children: [["위", "top"], ["가운데", "center"], ["아래", "bottom"]]
            .map(([label, value]) => menuChoice(label, verticalTool.select.value === value,
              () => applyTableFormat("vertical", value), { disabled: verticalTool.select.disabled })) },
          { label: "배경색", children: [
            { label: "현재 색 적용", swatch: fillTool.input.value, action: () => applyTableFormat("fill", fillTool.input.value), disabled: fillTool.input.disabled },
            { label: "다른 색…", action: () => pickContextColor(fillTool.input.value, value => { fillTool.input.value = value; applyTableFormat("fill", value); }), disabled: fillTool.input.disabled },
            { label: "배경색 지우기", action: () => applyTableFormat("fill", ""), disabled: fillTool.input.disabled }
          ] },
          { label: "테두리색", children: [
            { label: "현재 색 적용", swatch: borderTool.input.value, action: () => applyTableFormat("border", borderTool.input.value), disabled: borderTool.input.disabled },
            { label: "다른 색…", action: () => pickContextColor(borderTool.input.value, value => { borderTool.input.value = value; applyTableFormat("border", value); }), disabled: borderTool.input.disabled },
            { label: "테두리 지우기", action: () => applyTableFormat("border", ""), disabled: borderTool.input.disabled }
          ] },
          { separator: true },
          { label: "행 높이 줄이기", action: () => applyTableFormat("row-height", -120), disabled: tableFormatDisabled("row-height") },
          { label: "행 높이 늘리기", action: () => applyTableFormat("row-height", 120), disabled: tableFormatDisabled("row-height") }
        ] }
      ] : [];
      const page = officeDocumentPageFormat(state.xml);
      const marginKind = page.top === 720 && page.right === 720 && page.bottom === 720 && page.left === 720 ? "narrow" :
        (page.top === 1440 && page.right === 2880 && page.bottom === 1440 && page.left === 2880 ? "wide" : "normal");
      const items = [
        { label: "복사", action: copyText, disabled: !hasSelection },
        { label: "잘라내기", action: cutText, disabled: !hasSelection || !editable || busy },
        { label: "붙여넣기", action: pasteText, disabled: !editable || busy },
        { label: "특수문자… (Ctrl+F10)", action: () => {
          if (typeof MNSpecialChars !== "undefined" && MNSpecialChars)
            MNSpecialChars.open({ x: point.x, y: point.y, target: paragraph, range: commandRange });
        }, disabled: !editable || busy || typeof MNSpecialChars === "undefined" || !MNSpecialChars },
        { label: "문단 전체 선택", action: selectAll },
        { separator: true },
        { label: "글자 서식", children: textItems },
        { label: "문단 배치", children: paragraphItems },
        { label: "목록", children: [
          menuChoice("목록 없음", listKind === "none", () => applyListFormat("none"), { disabled: busy }),
          menuChoice("글머리표", listKind === "bullet", () => applyListFormat("bullet"), { disabled: busy }),
          menuChoice("번호 매기기", listKind === "number", () => applyListFormat("number"), { disabled: busy })
        ] },
        { label: "서식 복사", action: copyCurrentFormatting, disabled: copyTextFormat.disabled },
        { label: "서식 붙이기", action: pasteCurrentFormatting, disabled: pasteTextFormat.disabled },
        { separator: true },
        { label: "아래에 문단 추가", action: addParagraphBelow, disabled: row.inTable || busy },
        { label: row.removed ? "문단 삭제 취소" : "현재 문단 삭제", action: toggleParagraphRemoved,
          disabled: busy || (!row.removed && !canRemoveParagraph(state.rows, row)) },
        ...tableItems.length ? [{ label: "표", children: tableItems }] : [],
        { label: "그림", children: [
          { label: "그림 추가…", action: () => requestImage("add"), disabled: imageAddButton.disabled },
          { label: "첫 그림 교체…", action: () => requestImage("replace"), disabled: imageReplaceButton.disabled },
          { label: "첫 그림 10% 작게", action: () => applyImageChange("resize", null, 0.9), disabled: imageSmallerButton.disabled },
          { label: "첫 그림 10% 크게", action: () => applyImageChange("resize", null, 1.1), disabled: imageLargerButton.disabled }
        ] },
        { label: "문서", children: [
          { label: "용지 방향", children: [
            menuChoice("세로", page.orientation === "portrait", () => applyPageSetting("orientation", "portrait"), { disabled: busy }),
            menuChoice("가로", page.orientation === "landscape", () => applyPageSetting("orientation", "landscape"), { disabled: busy })
          ] },
          { label: "페이지 여백", children: [
            menuChoice("보통", marginKind === "normal", () => applyPageSetting("margins", "normal"), { disabled: busy }),
            menuChoice("좁게", marginKind === "narrow", () => applyPageSetting("margins", "narrow"), { disabled: busy }),
            menuChoice("넓게", marginKind === "wide", () => applyPageSetting("margins", "wide"), { disabled: busy })
          ] },
          { separator: true },
          { label: "머리글 편집…", action: () => editHeaderFooter("header"), disabled: busy },
          { label: "바닥글 편집…", action: () => editHeaderFooter("footer"), disabled: busy }
        ] },
        { separator: true },
        { label: "되돌리기 (Ctrl+Z)", action: () => state.history && state.history.undo(), disabled: !state.history || !state.history.canUndo() || busy },
        { label: "다시 실행 (Ctrl+Y)", action: () => state.history && state.history.redo(), disabled: !state.history || !state.history.canRedo() || busy },
        { label: "저장 (Ctrl+S)", action: () => saveEdits(state, doc), disabled: saveBtn.disabled || busy }
      ];
      return items;
    };
    const openToolbarCategory = (kind, button) => {
      const row = state.activeTextRow || state.rows.find(item =>
        !item.removed && state.nodeByKey && state.nodeByKey.has(item.key));
      const paragraph = row && state.nodeByKey ? state.nodeByKey.get(row.key) : null;
      if (!row || !paragraph || !previewEl.contains(paragraph)) return;
      const rect = button.getBoundingClientRect();
      const root = contextItemsFor(row, paragraph, rangeInside(paragraph),
        { x: rect.left, y: rect.bottom + 6 });
      const branch = label => root.find(item => item && item.label === label);
      let items = root;
      if (kind === "text") items = (branch("글자 서식") || {}).children || [];
      else if (kind === "table") items = (branch("표") || {}).children || [];
      else if (kind === "image") items = (branch("그림") || {}).children || [];
      else if (kind === "document") items = (branch("문서") || {}).children || [];
      else if (kind === "paragraph"){
        const layout = (branch("문단 배치") || {}).children || [];
        const list = branch("목록"), copy = branch("서식 복사"), paste = branch("서식 붙이기");
        items = [...layout, { separator: true }, ...(list ? [list] : []),
          ...(copy ? [copy] : []), ...(paste ? [paste] : [])];
      }
      if (!items.length) return;
      openDocxContextMenu(rect.left, rect.bottom + 6, items);
      button.setAttribute("aria-expanded", "true");
    };
    for (const [kind, button] of toolLauncherButtons){
      button.addEventListener("pointerdown", event => event.preventDefault());
      button.addEventListener("click", () => {
        if (!button.disabled) openToolbarCategory(kind, button);
      });
    }
    const onDocxContextMenu = event => {
      if (!state.editing || state.mode !== "inline") return;
      const paragraph = event.target && event.target.closest ? event.target.closest("[data-key]") : null;
      const row = inlineRowOf(state, paragraph);
      if (!row || !paragraph || !previewEl.contains(paragraph)) return;
      event.preventDefault(); event.stopPropagation();
      updateTextTools(row); updateTableTools(row);
      const range = rangeInside(paragraph);
      const offsets = range && !range.collapsed ? selectionOffsetsIn(paragraph) : null;
      if (offsets) state.textSelection = { key: row.key, start: offsets.start, end: offsets.end };
      openDocxContextMenu(event.clientX, event.clientY,
        contextItemsFor(row, paragraph, range, { x: event.clientX, y: event.clientY }));
    };
    const onDocxContextKeydown = event => {
      if (!state.editing || state.mode !== "inline") return;
      const paragraph = event.target && event.target.closest ? event.target.closest("[data-key]") : null;
      const row = inlineRowOf(state, paragraph);
      if (!row || !paragraph) return;
      const range = rangeInside(paragraph);
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "F10"){
        if (typeof MNSpecialChars === "undefined" || !MNSpecialChars || paragraph.contentEditable !== "true") return;
        event.preventDefault(); event.stopPropagation();
        const rect = paragraph.getBoundingClientRect();
        MNSpecialChars.open({ x: rect.left, y: rect.bottom + 4, target: paragraph, range });
        return;
      }
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault(); event.stopPropagation();
      updateTextTools(row); updateTableTools(row);
      const rect = paragraph.getBoundingClientRect();
      openDocxContextMenu(rect.left + 12, rect.top + 12,
        contextItemsFor(row, paragraph, range, { x: rect.left + 12, y: rect.top + 12 }));
    };
    previewEl.addEventListener("focusin", selectDocumentParagraph);
    previewEl.addEventListener("click", selectDocumentParagraph);
    previewEl.addEventListener("mouseup", rememberTextSelection);
    previewEl.addEventListener("keyup", rememberTextSelection);
    previewEl.addEventListener("contextmenu", onDocxContextMenu);
    previewEl.addEventListener("keydown", onDocxContextKeydown);
    for (const control of [fontTool.select, fontSizeTool.select, baselineTool.select,
      textColorTool.input, highlightTool.input]) control.addEventListener("mousedown", rememberTextSelection);

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
        closeDocxContextMenu();
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
