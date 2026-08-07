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
      hasSectPr: item.hasSectPr,
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
      style: source ? source.style : "", inTable: false, hasSectPr: false,
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
    delBtn.title = row.removed ? "삭제 취소" : "이 문단 지우기";
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
    if (e.key === "Enter" && !e.shiftKey){
      e.preventDefault();
      if (row.inTable){ toastOnce("표 안에서는 문단을 나눌 수 없어요."); return; }
      const caret = caretOffsetIn(textEl);
      const value = textEl.textContent;
      const at = state.rows.indexOf(row);
      row.text = value.slice(0, caret);
      textEl.textContent = row.text;
      row.touched = true;
      const made = makeNewRow(row, value.slice(caret));
      made.after = anchorIndexFor(state.rows, at);
      state.rows.splice(at + 1, 0, made);
      state.focusKey = made.key;
      redraw(state);
      state.commitNow();
      return;
    }
    if (e.key === "Backspace" && !textEl.textContent && caretOffsetIn(textEl) === 0){
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
    const list = state.listEl;
    list.innerHTML = "";
    state.rows.forEach((row, position) => list.appendChild(renderRow(state, row, position)));
    state.onDirty();
    if (state.focusKey){
      const target = list.querySelector('[data-key="' + state.focusKey + '"]');
      state.focusKey = 0;
      if (target){
        target.focus();
        try {
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges(); sel.addRange(range);
        } catch(_){}
      }
    }
  }

  /* ---------- 되돌리기 ---------- */

  // 스냅샷은 행 배열의 JSON 문자열 — 가볍고 비교가 그대로 된다(글자 편집기와 같은 무게).
  function makeHistory(state){
    if (typeof MNEditHistory !== "object" || !MNEditHistory || typeof MNEditHistory.create !== "function") return null;
    return MNEditHistory.create({
      limit: 200,
      capture: () => JSON.stringify(state.rows),
      apply: (snapshot) => { state.rows = JSON.parse(snapshot); redraw(state); },
      isEqual: (a, b) => a === b,
      onChange: () => state.onHistory()
    });
  }

  /* ---------- 저장 ---------- */

  /* 행 목록 → XML 편집 → 새 zip → 제자리 저장. 되쓰기 규칙은 전부 순수부가 정한다.
     저장 뒤에는 편집 기준을 새 XML 로 다시 잡는다 — 안 그러면 두 번째 저장이
     이미 반영된 편집을 옛 문단 위치에 또 적용한다. */
  async function saveEdits(state, doc){
    if (state.saving) return;
    const plan = officeParagraphEditPlan(state.xml, state.rows);
    if (!plan.edits.length){
      if (typeof toast === "function") toast("바뀐 내용이 없어요.", 1800);
      return;
    }
    state.saving = true;
    state.setStatus("저장 중…");
    try {
      const nextXml = officeApplyEdits(state.xml, plan.edits);
      const bytes = await MNOfficeReplace.build(state.source.bytes, { "word/document.xml": nextXml });
      const savedPath = await MNOfficeReplace.saveInPlace(doc, bytes, "docx");
      if (!savedPath){
        state.setStatus("저장하지 못했어요");
        if (typeof toast === "function")
          toast("저장할 위치를 찾지 못했어요. 파일을 폴더로 열었는지 확인해 주세요.", 4200, { type: "error" });
        return;
      }
      // 편집 기준을 새 문서로 옮긴다(행 key 가 바뀌므로 화면도 다시 그린다).
      state.source.bytes = bytes;
      state.source.parts["word/document.xml"] = nextXml;
      state.xml = nextXml;
      state.rows = rowsFromOutline(officeParagraphOutline(nextXml));
      redraw(state);
      if (state.history) state.history.reset();

      MNOfficeReplace.reflectSaved(doc, bytes, "docx");
      if (state.previewEl && typeof docxRenderInto === "function"){
        try { await docxRenderInto(doc.sourceFile, state.previewEl); }   // 보기 모드로 돌아가도 새 내용이 보이게
        catch(e){ console.warn("저장 뒤 미리보기 갱신 실패:", e); }
      }
      const remembered = await MNOfficeReplace.rememberSaved(doc, bytes, "docx");

      const parts = [];
      if (plan.changed) parts.push(plan.changed + "개 문단 고침");
      if (plan.inserted) parts.push(plan.inserted + "곳에 문단 추가");
      if (plan.removed) parts.push(plan.removed + "개 문단 삭제");
      let message = "저장했어요: " + savedPath;
      if (parts.length) message += " (" + parts.join(" · ") + ")";
      if (plan.skipped) message += " · 탭·줄바꿈 자리를 건드린 " + plan.skipped + "곳은 저장에서 빠졌어요";
      for (const refusal of plan.refused) message += " · " + refusal.reason;
      if (!remembered) message += " · 자동 복원 갱신 실패";
      const failed = plan.skipped || plan.refused.length || !remembered;
      if (typeof toast === "function") toast(message, failed ? 6000 : 2600, { type: failed ? undefined : "success" });
      state.setStatus("");
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
    bar.append(title, toggle, undoBtn, redoBtn, saveBtn, status);
    host.insertBefore(bar, previewEl);

    const note = document.createElement("div");
    note.className = "code-note docx-edit-note";
    note.hidden = true;
    note.textContent = "✎ 편집 화면 — 글자만 고치는 간이 표시예요. 글꼴·여백·쪽 나눔은 실제 문서와 다르게 보입니다. " +
      "손대지 않은 곳의 서식은 저장할 때 그대로 유지됩니다.";
    host.insertBefore(note, previewEl);

    const listEl = document.createElement("div");
    listEl.className = "docx-para-list md-host";
    listEl.hidden = true;
    host.appendChild(listEl);

    const state = {
      rows: [], listEl, previewEl, focusKey: 0, source: null, xml: "", editing: false,
      saving: false, history: null,
      setStatus: (text) => { status.textContent = text; },
      onDirty: () => {
        const dirty = rowsDirty(state.rows);
        doc.docxEditDirty = dirty;
        if (!state.saving) status.textContent = dirty ? "고친 내용 있음 — 저장하지 않았어요" : "";
        saveBtn.disabled = !dirty;
        if (typeof markDocumentDirty === "function") markDocumentDirty(doc, dirty);
        if (state.history) state.history.commitSoon(400);   // 연속 입력은 한 단계로 묶는다
      },
      onHistory: () => {
        if (!state.history) return;
        undoBtn.disabled = !state.history.canUndo();
        redoBtn.disabled = !state.history.canRedo();
      },
      // 문단을 더하거나 지우는 건 한 번의 동작이므로 묶지 않고 바로 한 단계로 남긴다.
      commitNow: () => { if (state.history) state.history.commit(); }
    };
    doc.docxEditor = state;

    const syncToggle = () => {
      toggle.textContent = state.editing ? "읽기 전용" : "✎ 문단 편집";
      toggle.title = state.editing ? "편집을 마치고 원래 미리보기로 돌아가기" : "문단 글자를 고치고 문단을 더하거나 지우기";
      toggle.classList.toggle("active", state.editing);
      note.hidden = !state.editing;
      listEl.hidden = !state.editing;
      previewEl.hidden = state.editing;
      undoBtn.hidden = redoBtn.hidden = saveBtn.hidden = !state.editing;
    };
    syncToggle();

    undoBtn.addEventListener("click", () => { if (state.history) state.history.undo(); });
    redoBtn.addEventListener("click", () => { if (state.history) state.history.redo(); });
    saveBtn.addEventListener("click", () => { saveEdits(state, doc); });
    // 편집 칸은 contenteditable 이라 브라우저 기본 되돌리기가 먼저 먹는다 — 행 모델을 기준으로 가로챈다.
    listEl.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || !state.history) return;
      const key = String(e.key || "").toLowerCase();
      if (key === "z" && !e.shiftKey){ e.preventDefault(); state.history.undo(); }
      else if (key === "y" || (key === "z" && e.shiftKey)){ e.preventDefault(); state.history.redo(); }
    }, true);

    toggle.addEventListener("click", async () => {
      if (state.editing){ state.editing = false; syncToggle(); return; }
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
        } catch(e){
          console.error(e);
          status.textContent = "문서를 읽지 못했어요.";
          return;
        } finally { toggle.disabled = false; }
      }
      state.editing = true;
      if (!state.history){
        state.history = makeHistory(state);
        if (state.history) state.history.reset();
      }
      syncToggle();
      redraw(state);
      state.onHistory();
      listEl.scrollTop = 0;
    });
  }

  return { attach, rowsFromOutline, rowsDirty, anchorIndexFor };
})();
