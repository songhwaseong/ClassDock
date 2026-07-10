"use strict";

// 실행 후 다음 셀로 이동(Shift+Enter): 다음 코드 셀은 편집 진입, 마크다운이면 선택, 없으면 새 코드 셀 추가.
function nbFocusNextCode(ownerDoc, ctrl){
  const list = ownerDoc._nbCtrls || [];
  const i = list.indexOf(ctrl);
  for (let j = i + 1; j < list.length; j++){
    if (list[j].type === "code"){ nbEnterEdit(ownerDoc, j, "center"); return; }
    if (list[j].type === "markdown"){ nbSelectCell(ownerDoc, j, "center"); return; }
  }
  nbInsertCell(ownerDoc, i, "code", { where: "below", edit: true, scrollBlock: "center" });
}

// 셀 도구 모음용 단색 SVG 아이콘(이모지 대신). currentColor 라 테마·hover 색을 그대로 따른다.
const nbIcon = (path, width) =>
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="' +
  (width || 1.6) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
const NB_ICONS = {
  grip: nbIcon('<path d="M5 3.5h.01M5 8h.01M5 12.5h.01M11 3.5h.01M11 8h.01M11 12.5h.01"/>', 2.6),
  up: nbIcon('<path d="M4 10l4-4 4 4"/>'),
  down: nbIcon('<path d="M4 6l4 4 4-4"/>'),
  add: nbIcon('<path d="M8 3.5v9M3.5 8h9"/>'),
  copy: nbIcon('<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2"/><path d="M10.5 5.5V3.8A.8.8 0 0 0 9.7 3H3.8a.8.8 0 0 0-.8.8v5.9a.8.8 0 0 0 .8.8h1.7"/>', 1.35),
  paste: nbIcon('<path d="M5.5 4h-1a1 1 0 0 0-1 1v8h9V5a1 1 0 0 0-1-1h-1"/><rect x="5.5" y="2.5" width="5" height="3" rx="1"/><path d="M6 8h4M6 10.5h3"/>', 1.35),
  memo: nbIcon('<path d="M3 3h10v10H3z"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>', 1.35),
  toCode: nbIcon('<path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5"/>'),     // 코드 셀로 변환(꺾쇠)
  toText: nbIcon('<path d="M3 4.5h10M3 8h10M3 11.5h6"/>'),                     // 마크다운 셀로 변환(텍스트 줄)
  trash: nbIcon('<path d="M2.5 4h11M6 4V2.7h4V4M6.5 7v4.5M9.5 7v4.5M3.7 4l.6 8.3a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.6-8.3"/>', 1.4),
  clearOut: nbIcon('<path d="M4 11.5 2.6 10a1 1 0 0 1 0-1.4l4.7-4.7a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4l-3.3 3.2z"/><path d="M6.3 6.3l3.4 3.4M3.6 13h9"/>', 1.4),  // 지우개(셀 출력 비우기)
  runUpTo: nbIcon('<path d="M5 3l5 3.3-5 3.3z" fill="currentColor" stroke="none"/><path d="M3 12.7h10"/>', 1.5),  // 여기까지 실행(재생 ▸ + 하단 기준선)
  collapseTools: nbIcon('<path d="M6 4l4 4-4 4"/>'),
  expandTools: nbIcon('<path d="M10 4 6 8l4 4"/>')
};

function nbClearDragState(ownerDoc){
  const wrap = ownerDoc && ownerDoc._nbCellsWrap;
  if (wrap){
    wrap.querySelectorAll(".nbv-dragging,.nbv-drop-before,.nbv-drop-after").forEach(el => {
      el.classList.remove("nbv-dragging", "nbv-drop-before", "nbv-drop-after");
    });
  }
  if (ownerDoc) ownerDoc._nbDrag = null;
}

function nbSetDragTarget(ownerDoc, ctrl, before){
  const drag = ownerDoc && ownerDoc._nbDrag;
  if (!drag || !ctrl) return;
  for (const item of (ownerDoc._nbCtrls || [])){
    item.cellEl.classList.remove("nbv-drop-before", "nbv-drop-after");
  }
  ctrl.cellEl.classList.add(before ? "nbv-drop-before" : "nbv-drop-after");
  drag.target = ctrl;
  drag.before = before;
}

// 배열 항목 하나를 최종 인덱스로 옮긴다. 모델과 컨트롤러 배열에 같은 규칙을 적용한다.
function notebookMoveArrayItem(items, from, to){
  if (!Array.isArray(items) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return false;
  const item = items.splice(from, 1)[0];
  items.splice(to, 0, item);
  return true;
}

function nbMoveCellTo(ownerDoc, from, to){
  const model = ownerDoc && ownerDoc.notebookModel;
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const wrap = ownerDoc && ownerDoc._nbCellsWrap;
  if (!model || !wrap || from < 0 || to < 0 || from >= ctrls.length || to >= ctrls.length || from === to) return false;
  nbPushHistory(ownerDoc, "셀 이동");
  notebookMoveArrayItem(model.cells, from, to);
  notebookMoveArrayItem(ctrls, from, to);
  nbInvalidateCompletionCache(ownerDoc);
  const fragment = document.createDocumentFragment();
  for (const item of ctrls) fragment.appendChild(item.cellEl);
  wrap.appendChild(fragment);
  markNbDirty(ownerDoc);
  nbSetSelected(ownerDoc, to, { focusCell:true, scroll:true });
  return true;
}

// 셀 하나의 DOM·동작을 만든다(코드/마크다운/raw). 반환 ctrl 은 _nbCtrls 에 model.cells 와 같은 순서로 보관된다.
function nbBuildCell(ownerDoc, cell){
  const cellEl = document.createElement("div");
  cellEl.className = "nbv-cell nbv-cell-" + cell.type;
  cellEl.tabIndex = -1;
  const ctrl = { ownerDoc, type: cell.type, cell, cellEl, body: null, editor: null, runBtn: null,
    runCount: null, stateLabel: null, execState: null, outWrap: null,
    stdin: null, stdinWrap: null, refreshStdin: function(){}, stdinText: function(){ return ""; },
    prepareStdin: function(){ return true; }, clearStdin: function(){},
    edit: function(){}, setSource: function(source){ cell.source = String(source || ""); }, destroy: function(){} };

  // 셀 도구 모음(이동/타입/추가/삭제) — 호버·선택 시 노출. 인덱스는 호출 시점에 조회(셀이 이동·삭제되므로).
  const tools = document.createElement("div");
  tools.className = "nbv-tools";
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "셀 편집 도구");
  const tbtn = (label, title, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.title = title; b.tabIndex = -1;
    if (/^<svg/.test(label)){ b.innerHTML = label; b.setAttribute("aria-label", title); }  // 아이콘 전용 버튼은 단색 SVG
    else b.textContent = label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  const dragHandle = document.createElement("button");
  dragHandle.type = "button";
  dragHandle.className = "nbv-drag-handle";
  dragHandle.title = "셀을 드래그해 이동";
  dragHandle.setAttribute("aria-label", "셀을 드래그해 이동");
  dragHandle.draggable = true;
  dragHandle.innerHTML = NB_ICONS.grip;
  dragHandle.addEventListener("mousedown", (e) => e.stopPropagation());
  dragHandle.addEventListener("click", (e) => e.stopPropagation());
  dragHandle.addEventListener("dragstart", (e) => {
    const from = nbCtrlIndex(ownerDoc, ctrl);
    if (from < 0){ e.preventDefault(); return; }
    nbEnsureActionSelection(ownerDoc, ctrl);
    nbClearDragState(ownerDoc);
    ownerDoc._nbDrag = { ctrl, from, target:null, before:true };
    ctrl.cellEl.classList.add("nbv-dragging");
    if (e.dataTransfer){
      e.dataTransfer.effectAllowed = "copyMove";
      try { e.dataTransfer.setData("text/plain", String(cell.id || from)); } catch(_){}
      try {
        const snapshots = notebookCellClipboardSnapshot(nbSelectedCtrls(ownerDoc).map(item => item.cell));
        e.dataTransfer.setData("application/x-manneung-notebook-cells", JSON.stringify(snapshots));
      } catch(_){}
    }
    if (typeof window !== "undefined" && typeof window.openScratchpadForNotebookDrop === "function"){
      window.openScratchpadForNotebookDrop();
    }
  });
  dragHandle.addEventListener("dragend", () => nbClearDragState(ownerDoc));
  const collapsedBodyCells = ownerDoc
    ? (ownerDoc._nbCollapsedBodyCells instanceof Set ? ownerDoc._nbCollapsedBodyCells : (ownerDoc._nbCollapsedBodyCells = new Set()))
    : new Set();
  const bodyCollapseKey = String(cell.id || "");
  let bodyCollapse = null;
  const setBodyCollapsed = collapsed => {
    cellEl.classList.toggle("nbv-cell-collapsed", !!collapsed);
    if (bodyCollapseKey){
      if (collapsed) collapsedBodyCells.add(bodyCollapseKey);
      else collapsedBodyCells.delete(bodyCollapseKey);
    }
    if (bodyCollapse){
      bodyCollapse.textContent = collapsed ? "▸" : "▾";
      bodyCollapse.title = collapsed ? "셀 내용 펼치기" : "셀 내용 접기";
      bodyCollapse.setAttribute("aria-label", bodyCollapse.title);
      bodyCollapse.setAttribute("aria-expanded", String(!collapsed));
    }
  };
  bodyCollapse = tbtn("▾", "셀 내용 접기", () => setBodyCollapsed(!cellEl.classList.contains("nbv-cell-collapsed")));
  bodyCollapse.classList.add("nbv-cell-collapse");
  ctrl.setBodyCollapsed = setBodyCollapsed;
  const toolButtons = [
    dragHandle,
    bodyCollapse,
    tbtn(NB_ICONS.copy, "선택한 셀 복사 (Ctrl+C)", () => {
      nbEnsureActionSelection(ownerDoc, ctrl);
      nbCopySelectedCells(ownerDoc);
    }),
    tbtn(NB_ICONS.paste, "이 셀 아래에 붙여넣기 (Ctrl+V)", () => {
      nbEnsureActionSelection(ownerDoc, ctrl);
      nbPasteClipboardCells(ownerDoc);
    }),
    tbtn(NB_ICONS.memo, "선택한 셀을 임시 메모에 보관", () => {
      nbEnsureActionSelection(ownerDoc, ctrl);
      nbSaveSelectedCellsToScratchpad(ownerDoc);
    }),
    tbtn(NB_ICONS.up, "위로 이동", () => nbMoveCell(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), -1)),
    tbtn(NB_ICONS.down, "아래로 이동", () => nbMoveCell(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), 1)),
    tbtn(cell.type === "markdown" ? NB_ICONS.toCode : NB_ICONS.toText, cell.type === "markdown" ? "코드 셀로 변환" : "마크다운 셀로 변환",
      () => nbChangeType(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), cell.type === "markdown" ? "code" : "markdown")),
    tbtn(NB_ICONS.add, "아래에 코드 셀 추가", () => nbInsertCell(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), "code", { where: "below", edit: true }))
  ];
  if (cell.type === "code"){   // 코드 셀에만 '여기까지 실행' · '이 셀 출력 지우기'
    toolButtons.push(tbtn(NB_ICONS.runUpTo, "여기까지 실행 (이 셀 포함, 처음부터 순차 · 커널 상태 유지)", () => nbRunUpTo(ownerDoc, ctrl)));
    toolButtons.push(tbtn(NB_ICONS.clearOut, "이 셀의 출력 지우기(변수·상태는 유지)", () => nbClearCellOutput(ownerDoc, ctrl)));
  }
  toolButtons.push(tbtn(NB_ICONS.trash, "셀 삭제", () => nbDeleteCell(ownerDoc, nbCtrlIndex(ownerDoc, ctrl))));
  // 셀 도구 모음은 기본적으로 접혀 있고(펼치기 버튼만 노출), 사용자가 직접 펼친 셀만 기억한다.
  const expandedCells = ownerDoc
    ? (ownerDoc._nbExpandedToolCells instanceof Set ? ownerDoc._nbExpandedToolCells : (ownerDoc._nbExpandedToolCells = new Set()))
    : new Set();
  const collapseKey = String(cell.id || "");
  let toolsToggle = null;
  const setToolsCollapsed = (collapsed) => {
    tools.classList.toggle("nbv-tools-collapsed", collapsed);
    if (collapseKey){
      if (collapsed) expandedCells.delete(collapseKey);
      else expandedCells.add(collapseKey);
    }
    if (!toolsToggle) return;
    const title = collapsed ? "셀 편집 도구 펼치기" : "셀 편집 도구 접기";
    toolsToggle.innerHTML = collapsed ? NB_ICONS.expandTools : NB_ICONS.collapseTools;
    toolsToggle.title = title;
    toolsToggle.setAttribute("aria-label", title);
    toolsToggle.setAttribute("aria-expanded", String(!collapsed));
  };
  toolsToggle = tbtn(NB_ICONS.collapseTools, "셀 편집 도구 접기", () => {
    setToolsCollapsed(!tools.classList.contains("nbv-tools-collapsed"));
  });
  toolsToggle.classList.add("nbv-tools-toggle");
  toolButtons.push(toolsToggle);
  tools.append(...toolButtons);
  setToolsCollapsed(!(collapseKey && expandedCells.has(collapseKey)));   // 기본 접힘: 펼침으로 기억된 셀만 펼친다
  setBodyCollapsed(!!bodyCollapseKey && collapsedBodyCells.has(bodyCollapseKey));
  cellEl.appendChild(tools);
  cellEl.addEventListener("dragover", (e) => {
    const drag = ownerDoc && ownerDoc._nbDrag;
    const hasMemoCells = !drag && e.dataTransfer &&
      Array.from(e.dataTransfer.types || []).includes("application/x-manneung-notebook-cells");
    if (hasMemoCells){
      e.preventDefault();
      for (const item of (ownerDoc._nbCtrls || [])) item.cellEl.classList.remove("nbv-drop-before", "nbv-drop-after");
      const rect = cellEl.getBoundingClientRect();
      cellEl.classList.add(e.clientY < rect.top + rect.height / 2 ? "nbv-drop-before" : "nbv-drop-after");
      e.dataTransfer.dropEffect = "copy";
      return;
    }
    if (!drag || drag.ctrl === ctrl && (ownerDoc._nbCtrls || []).length <= 1) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = cellEl.getBoundingClientRect();
    nbSetDragTarget(ownerDoc, ctrl, e.clientY < rect.top + rect.height / 2);
  });
  cellEl.addEventListener("drop", (e) => {
    const drag = ownerDoc && ownerDoc._nbDrag;
    if (!drag && e.dataTransfer &&
        Array.from(e.dataTransfer.types || []).includes("application/x-manneung-notebook-cells")){
      e.preventDefault();
      e.stopPropagation();
      let snapshots = [];
      try { snapshots = JSON.parse(e.dataTransfer.getData("application/x-manneung-notebook-cells") || "[]"); } catch(_){}
      const target = nbCtrlIndex(ownerDoc, ctrl);
      const rect = cellEl.getBoundingClientRect();
      const at = target + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0);
      for (const item of (ownerDoc._nbCtrls || [])) item.cellEl.classList.remove("nbv-drop-before", "nbv-drop-after");
      nbInsertCellSnapshots(ownerDoc, snapshots, { at, message:"메모에서 셀 붙여넣기" });
      return;
    }
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const from = nbCtrlIndex(ownerDoc, drag.ctrl);
    const target = nbCtrlIndex(ownerDoc, ctrl);
    const before = drag.target === ctrl ? drag.before : true;
    let to = target + (before ? 0 : 1);
    if (from < to) to--;
    to = Math.max(0, Math.min((ownerDoc._nbCtrls || []).length - 1, to));
    nbClearDragState(ownerDoc);
    nbMoveCellTo(ownerDoc, from, to);
  });

  // 셀 여백 클릭 → 명령 모드 선택(에디터·도구 클릭은 제외)
  cellEl.addEventListener("mousedown", (e) => {
    if (e.target.closest && e.target.closest(".nbv-editor, .nbv-md-edit, .nbv-input, .nbv-tools, .nbv-run")) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault();
    nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {
      focusCell:true,
      toggle:!!(e.ctrlKey || e.metaKey),
      range:!!e.shiftKey
    });
  });

  if (cell.type === "code"){
    const runBtn = document.createElement("button");
    runBtn.type = "button"; runBtn.className = "nbv-run";
    runBtn.title = "이 셀 실행 (Ctrl+Enter · Shift+Enter=실행 후 다음)";
    const runCount = document.createElement("span");
    runCount.className = "nbv-run-count";
    const stateLabel = document.createElement("span");
    stateLabel.className = "nbv-exec-state";
    runBtn.append(runCount, stateLabel);
    runBtn.addEventListener("click", () => {
      if (runBtn.classList.contains("is-running")) nbStopExecution(ownerDoc);   // 실행 중이면 같은 버튼으로 정지
      else nbRunCell(ownerDoc, ctrl, false);
    });
    cellEl.appendChild(runBtn);

    const body = document.createElement("div"); body.className = "nbv-body";
    cellEl.appendChild(body);
    ctrl.body = body; ctrl.runBtn = runBtn; ctrl.runCount = runCount; ctrl.stateLabel = stateLabel; ctrl.active = false;

    const stdinValues = ownerDoc
      ? (ownerDoc._nbStdinValues instanceof Map ? ownerDoc._nbStdinValues : (ownerDoc._nbStdinValues = new Map()))
      : new Map();
    const stdinKey = String(cell.id || "");
    const inputWrap = document.createElement("div"); inputWrap.className = "nbv-input";
    const inputLabel = document.createElement("label");
    const inputField = document.createElement("div"); inputField.className = "nbv-input-field";
    const stdin = document.createElement("input"); stdin.className = "nbv-stdin"; stdin.type = "text";
    stdin.id = "nbv-stdin-" + nbNewId();
    stdin.placeholder = "값 입력 후 Enter";
    stdin.autocomplete = "off"; stdin.spellcheck = false;
    inputLabel.htmlFor = stdin.id;
    const inputValuesEl = document.createElement("div"); inputValuesEl.className = "nbv-input-values";
    const inputHint = document.createElement("div"); inputHint.className = "nbv-input-hint";
    const inputActions = document.createElement("div"); inputActions.className = "nbv-input-actions";
    const inputClear = document.createElement("button"); inputClear.type = "button"; inputClear.textContent = "다시 입력";
    const inputRun = document.createElement("button"); inputRun.type = "button"; inputRun.textContent = "입력 완료 후 실행";
    inputActions.append(inputClear, inputRun);
    inputField.append(inputValuesEl, stdin, inputHint, inputActions);
    inputWrap.append(inputLabel, inputField);
    const storedStdin = stdinKey ? stdinValues.get(stdinKey) : null;
    let inputValues = Array.isArray(storedStdin)
      ? storedStdin.map(value => String(value))
      : (typeof storedStdin === "string" && storedStdin ? storedStdin.split("\n") : []);
    let inputPlan = notebookInputPlan(cell.source);
    const inputPlanSignature = (plan) => JSON.stringify({
      predictable:plan.predictable,
      calls:plan.calls.map(call => call.prompt)
    });
    let inputSignature = inputPlanSignature(inputPlan);
    const inputPrompt = (index) => {
      const call = inputPlan.calls[index];
      const prompt = call && typeof call.prompt === "string" ? call.prompt.trim() : "";
      return prompt || ((index + 1) + "번째 입력값");
    };
    const storeStdin = () => {
      if (!stdinKey) return;
      if (inputValues.length) stdinValues.set(stdinKey, inputValues.slice());
      else stdinValues.delete(stdinKey);
    };
    const renderStdin = () => {
      const count = inputPlan.calls.length;
      inputWrap.hidden = !count;
      if (!count) return;
      const complete = inputPlan.predictable && inputValues.length >= count;
      inputValuesEl.textContent = "";
      inputValues.forEach((value, index) => {
        const item = document.createElement("span");
        item.className = "nbv-input-value";
        item.textContent = (index + 1) + ". " + inputPrompt(index) + " " + (value || "(빈 값)");
        inputValuesEl.appendChild(item);
      });
      const nextIndex = inputValues.length;
      inputLabel.textContent = complete ? "입력 준비 완료" : inputPrompt(nextIndex);
      stdin.hidden = complete;
      inputClear.hidden = !inputValues.length;
      inputRun.hidden = inputPlan.predictable;
      inputRun.disabled = !inputValues.length;
      inputHint.textContent = inputPlan.predictable
        ? (complete
          ? "준비한 값을 실행할 때마다 다시 사용합니다."
          : ((nextIndex + 1) + "/" + count + " · 값을 입력하고 Enter를 누르세요. 마지막 값에서 셀을 실행합니다."))
        : (inputValues.length + "개 준비 · 필요한 값을 모두 추가한 뒤 실행하세요.");
    };
    const commitStdin = (autoRun) => {
      inputValues.push(stdin.value);
      stdin.value = "";
      storeStdin();
      renderStdin();
      if (autoRun && inputPlan.predictable && inputValues.length >= inputPlan.calls.length){
        setTimeout(() => nbRunCell(ownerDoc, ctrl, false), 0);
      } else if (!stdin.hidden) stdin.focus();
    };
    const refreshStdin = () => {
      const nextPlan = notebookInputPlan(cell.source);
      const nextSignature = inputPlanSignature(nextPlan);
      if (nextSignature !== inputSignature){
        inputValues = [];
        inputSignature = nextSignature;
        storeStdin();
      }
      inputPlan = nextPlan;
      if (inputPlan.predictable && inputValues.length > inputPlan.calls.length){
        inputValues = inputValues.slice(0, inputPlan.calls.length);
        storeStdin();
      }
      renderStdin();
    };
    stdin.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      commitStdin(true);
    });
    stdin.addEventListener("focus", () => nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {}));
    const clearStdin = (focusInput) => {
      inputValues = []; stdin.value = ""; storeStdin(); renderStdin();
      if (focusInput && !stdin.hidden) stdin.focus();
    };
    inputClear.addEventListener("click", () => clearStdin(true));
    inputRun.addEventListener("click", () => nbRunCell(ownerDoc, ctrl, false));
    ctrl.stdin = stdin; ctrl.stdinWrap = inputWrap; ctrl.refreshStdin = refreshStdin;
    ctrl.stdinText = () => inputValues.join("\n");
    ctrl.clearStdin = () => clearStdin(false);
    ctrl.prepareStdin = () => {
      if (stdin.value !== "") commitStdin(false);
      if (!inputPlan.predictable || inputValues.length >= inputPlan.calls.length) return true;
      nbSetStatus(ownerDoc, "입력값 " + (inputValues.length + 1) + "/" + inputPlan.calls.length + "을 입력해 주세요.");
      stdin.focus();
      return false;
    };

    // 가상화: 기본은 정적 하이라이트(가벼움). 편집할 때만 실제 에디터를 마운트하고,
    // 화면에서 멀어지면 디마운트해 대형 노트북에서도 에디터 인스턴스 수를 제한한다.
    const makeStatic = () => {
      const pre = document.createElement("pre");
      pre.className = "nbv-static";
      pre.innerHTML = cell.source
        ? ((typeof highlightCode === "function") ? highlightCode(cell.source, "hash") : escapeForPre(cell.source))
        : '<span class="nbv-md-empty">빈 코드 셀 — 클릭해 편집</span>';
      pre.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey || e.shiftKey){
          nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {
            focusCell:true,
            toggle:!!(e.ctrlKey || e.metaKey),
            range:!!e.shiftKey
          });
          return;
        }
        nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {});
        ctrl.edit();
      });
      return pre;
    };
    ctrl.staticEl = makeStatic();
    body.appendChild(ctrl.staticEl);
    body.appendChild(inputWrap);
    refreshStdin();

    ctrl.mount = () => {
      if (ctrl.active) return;
      const ed = buildCodeEditor(cell.source, "hash", {
        completionPortal:true,
        completionContext:(currentSource) => notebookCompletionContext(
          ownerDoc && ownerDoc.notebookModel,
          cell,
          currentSource,
          nbCompletionCache(ownerDoc)
        )
      });
      ed.host.classList.add("nbv-editor");
      ctrl.staticEl.replaceWith(ed.host);
      ed.ta.addEventListener("input", () => {
        const nextSource = ed.getValue();
        if (nextSource !== cell.source){
          cell.source = nextSource;
          nbInvalidateCompletionCache(ownerDoc, cell);
        }
        refreshStdin();
        fitEditorHeight(ed);
        markNbDirty(ownerDoc);
      });
      ed.ta.addEventListener("focus", () => nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {}));
      requestAnimationFrame(() => fitEditorHeight(ed));
      ctrl.editor = ed; ctrl.active = true;
      ed.ta.readOnly = !!ownerDoc._nbInkMode;
    };
    ctrl.demount = () => {
      if (!ctrl.active || !ctrl.editor) return;
      cell.source = ctrl.editor.getValue();
      const pre = makeStatic();
      ctrl.editor.host.replaceWith(pre);
      try { ctrl.editor.destroy(); } catch(e){}
      ctrl.editor = null; ctrl.active = false; ctrl.staticEl = pre;
    };
    ctrl.edit = () => { ctrl.mount(); if (ctrl.editor) ctrl.editor.ta.focus(); };
    ctrl.setSource = (source) => {
      const nextSource = String(source == null ? "" : source);
      if (nextSource !== cell.source){
        cell.source = nextSource;
        nbInvalidateCompletionCache(ownerDoc, cell);
      }
      if (ctrl.editor) ctrl.editor.setValue(cell.source);
      else if (ctrl.staticEl) {
        ctrl.staticEl.innerHTML = cell.source
          ? ((typeof highlightCode === "function") ? highlightCode(cell.source, "hash") : escapeForPre(cell.source))
          : '<span class="nbv-md-empty">빈 코드 셀 — 클릭해 편집</span>';
      }
      refreshStdin();
    };
    ctrl.destroy = () => {
      if (ctrl.editor){ try { ctrl.editor.destroy(); } catch(e){} ctrl.editor = null; }
      if (ownerDoc._nbObserver){ try { ownerDoc._nbObserver.unobserve(cellEl); } catch(e){} }
    };

    if (cell.outputs && cell.outputs.length){
      ctrl.outWrap = document.createElement("div"); ctrl.outWrap.className = "nbv-out";
      renderCellOutputs(cell.outputs, ctrl.outWrap, ctrl);
      nbAttachOutputToggle(ownerDoc, ctrl, ctrl.outWrap);
      body.appendChild(ctrl.outWrap);
    }
    setRunState(ctrl, "idle");
    cellEl.__nbctrl = ctrl;
    const obs = nbEnsureObserver(ownerDoc);
    if (obs) try { obs.observe(cellEl); } catch(e){}
  } else if (cell.type === "markdown"){
    nbMountMarkdown(ctrl, ownerDoc);
  } else {
    const pre = document.createElement("pre"); pre.className = "nbv-raw"; pre.textContent = cell.source;
    cellEl.appendChild(pre);
    ctrl.setSource = (source) => { cell.source = String(source == null ? "" : source); pre.textContent = cell.source; };
  }
  const baseDestroy = ctrl.destroy;
  ctrl.inkSurface = nbCreateInkSurface(ownerDoc, ctrl);
  ctrl.destroy = () => {
    if (ctrl.inkSurface){ ctrl.inkSurface.cleanup(); ctrl.inkSurface = null; }
    baseDestroy();
  };
  ctrl.inkSurface.setDrawing(!!ownerDoc._nbInkMode && nbInkState(ownerDoc).tool !== "move");
  return ctrl;
}

// 마크다운 셀: 렌더 표시 ↔ 더블클릭/Enter 로 textarea 편집. 커밋(blur)에서 model 반영·재렌더. ctrl.edit 로 편집 진입.
function nbMountMarkdown(ctrl, ownerDoc){
  const cell = ctrl.cell;
  const view = document.createElement("div");
  view.className = "nbv-md md-host";
  const renderView = () => {
    view.innerHTML = cell.source.trim()
      ? ((typeof markdownToHtml === "function") ? markdownToHtml(cell.source, { allowHtml: true }) : escapeForPre(cell.source))
      : '<span class="nbv-md-empty">빈 마크다운 셀 — 더블클릭/Enter 로 편집</span>';
  };
  renderView();
  let editCtx = null;                     // 편집 중일 때만 {ta, draw, clear, commit, spotOwned}
  const enterEdit = () => {
    if (ctrl.cellEl.querySelector(".nbv-md-edit")) return;
    const wrap = document.createElement("div"); wrap.className = "nbv-md-editwrap"; wrap.style.position = "relative";
    const ta = document.createElement("textarea");
    ta.className = "nbv-md-edit"; ta.value = cell.source; ta.spellcheck = false;
    const preview = document.createElement("div"); preview.className = "md-host nbv-md-preview";
    // 노트북 전체 찾기 강조(주황 박스)를 얹는 오버레이 — textarea 위에 겹치고 입력은 통과시킨다.
    const layer = document.createElement("div"); layer.className = "nbv-md-spotlayer"; layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2";
    const grow = () => { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; };
    const updatePreview = () => {
      preview.innerHTML = ta.value.trim()
        ? ((typeof markdownToHtml === "function") ? markdownToHtml(ta.value, { allowHtml: true }) : escapeForPre(ta.value))
        : '<span class="nbv-md-empty">미리보기</span>';
    };
    const sync = () => {
      if (ta.value !== cell.source){ cell.source = ta.value; markNbDirty(ownerDoc); }
    };
    const clearSpot = () => { layer.textContent = ""; };
    // textarea 와 똑같은 줄바꿈으로 매치 위치를 재는 거울(mirror) 기법 — 워드랩·한글 폭까지 정확히 맞춘다.
    const drawSpot = (start, end) => {
      clearSpot();
      const v = ta.value;
      start = Math.max(0, Math.min(start, v.length));
      end = Math.max(start, Math.min(end, v.length));
      const cs = getComputedStyle(ta);
      const mirror = document.createElement("div");
      ["fontFamily","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","textIndent","tabSize",
       "paddingTop","paddingRight","paddingBottom","paddingLeft",
       "borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth"].forEach(p => { mirror.style[p] = cs[p]; });
      mirror.style.cssText += ";position:fixed;visibility:hidden;pointer-events:none;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word";
      const rect = ta.getBoundingClientRect();
      mirror.style.left = rect.left + "px"; mirror.style.top = rect.top + "px"; mirror.style.width = rect.width + "px";
      const span = document.createElement("span");
      span.textContent = v.slice(start, end) || "​";
      mirror.append(document.createTextNode(v.slice(0, start)), span, document.createTextNode(v.slice(end)));
      document.body.appendChild(mirror);
      const wrapRect = wrap.getBoundingClientRect();
      for (const r of span.getClientRects()){
        const box = document.createElement("div");
        box.className = "find-hi find-hi-active";
        box.style.cssText = "left:" + (r.left - wrapRect.left) + "px;top:" + (r.top - wrapRect.top) +
                            "px;width:" + Math.max(2, r.width) + "px;height:" + r.height + "px";
        layer.appendChild(box);
      }
      mirror.remove();
    };
    const commit = () => { editCtx = null; sync(); renderView(); wrap.replaceWith(view); };
    ta.addEventListener("input", () => { clearSpot(); sync(); grow(); updatePreview(); });
    ta.addEventListener("blur", (e) => {
      const to = e.relatedTarget;
      if (to && to.closest && to.closest(".nbv-find")) return;   // 노트북 찾기창으로 포커스가 간 경우엔 편집·강조를 유지
      commit();
    });
    wrap.append(ta, preview, layer);
    view.replaceWith(wrap); ta.focus(); grow(); updatePreview();
    editCtx = { ta, draw: drawSpot, clear: clearSpot, commit, spotOwned: false };
  };
  view.addEventListener("dblclick", enterEdit);
  ctrl.cellEl.appendChild(view);
  ctrl.edit = enterEdit;
  // 노트북 전체 찾기용 — 코드 셀의 editor.spotlightRange 와 대응(ctrl 레벨).
  ctrl.spotlightRange = (start, end) => {
    const already = !!editCtx;
    enterEdit();
    if (editCtx){
      if (!already) editCtx.spotOwned = true;    // 강조 때문에 우리가 편집 모드로 진입한 셀은 강조 해제 시 되돌린다
      editCtx.draw(start, end);
    }
  };
  ctrl.clearSpotlight = () => {
    if (!editCtx) return;
    editCtx.clear();
    if (editCtx.spotOwned) editCtx.commit();       // 사용자가 직접 편집 중인 셀은 건드리지 않는다
  };
  ctrl.setSource = (source) => {
    cell.source = String(source == null ? "" : source);
    const textarea = ctrl.cellEl.querySelector(".nbv-md-edit");
    if (textarea){
      textarea.value = cell.source;
      textarea.dispatchEvent(new Event("input", { bubbles:true }));
    } else renderView();
  };
}

function nbNewId(){ return "cell-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function nbCtrlIndex(ownerDoc, ctrl){ return (ownerDoc._nbCtrls || []).indexOf(ctrl); }

// ── 선택/모드 ──
function nbSelectionSet(ownerDoc){
  if (!ownerDoc._nbCellSelection) ownerDoc._nbCellSelection = new Set();
  return ownerDoc._nbCellSelection;
}

function nbSelectedCtrls(ownerDoc){
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const selected = ownerDoc ? nbSelectionSet(ownerDoc) : new Set();
  const ordered = ctrls.filter(ctrl => selected.has(ctrl.cell));
  if (ordered.length) return ordered;
  const primary = ctrls[ownerDoc && ownerDoc._nbSelected];
  return primary ? [primary] : [];
}

function nbRefreshSelection(ownerDoc){
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const selected = nbSelectionSet(ownerDoc);
  ctrls.forEach((ctrl, index) => {
    const inSelection = selected.has(ctrl.cell);
    ctrl.cellEl.classList.toggle("nbv-selected", index === ownerDoc._nbSelected);
    ctrl.cellEl.classList.toggle("nbv-multi-selected", inSelection);
    ctrl.cellEl.setAttribute("aria-selected", String(inSelection));
  });
}

function nbSetSelectionCells(ownerDoc, cells, primaryCell=null, focus=true){
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const available = new Set(ctrls.map(ctrl => ctrl.cell));
  const selected = nbSelectionSet(ownerDoc);
  selected.clear();
  for (const cell of (cells || [])) if (available.has(cell)) selected.add(cell);
  let primaryIndex = ctrls.findIndex(ctrl => ctrl.cell === primaryCell);
  if (primaryIndex < 0) primaryIndex = ctrls.findIndex(ctrl => selected.has(ctrl.cell));
  if (primaryIndex < 0 && ctrls.length){
    primaryIndex = 0;
    selected.add(ctrls[0].cell);
  }
  ownerDoc._nbSelected = primaryIndex;
  ownerDoc._nbSelectionAnchor = primaryIndex >= 0 ? ctrls[primaryIndex].cell : null;
  nbRefreshSelection(ownerDoc);
  const primary = ctrls[primaryIndex];
  if (focus && primary){
    try { primary.cellEl.focus({ preventScroll:true }); } catch(_){ try { primary.cellEl.focus(); } catch(__){} }
    primary.cellEl.scrollIntoView({ block:"nearest" });
  }
}

function nbSetSelected(ownerDoc, idx, opts){
  opts = opts || {};
  const ctrls = ownerDoc._nbCtrls || [];
  const sel = ctrls[idx];
  if (!sel) return;
  const selected = nbSelectionSet(ownerDoc);
  if (opts.range){
    const anchorIndex = Math.max(0, ctrls.findIndex(ctrl => ctrl.cell === ownerDoc._nbSelectionAnchor));
    selected.clear();
    for (let i = Math.min(anchorIndex, idx); i <= Math.max(anchorIndex, idx); i++) selected.add(ctrls[i].cell);
  } else if (opts.toggle){
    if (selected.has(sel.cell) && selected.size > 1){
      selected.delete(sel.cell);
      const fallback = [...ctrls].reverse().find(ctrl => selected.has(ctrl.cell));
      idx = fallback ? ctrls.indexOf(fallback) : idx;
    } else {
      selected.add(sel.cell);
      ownerDoc._nbSelectionAnchor = sel.cell;
    }
  } else {
    selected.clear();
    selected.add(sel.cell);
    ownerDoc._nbSelectionAnchor = sel.cell;
  }
  ownerDoc._nbSelected = idx;
  if (!selected.has(ctrls[idx].cell)) selected.add(ctrls[idx].cell);
  nbRefreshSelection(ownerDoc);
  const primary = ctrls[idx];
  if (primary){
    if (opts.focusCell){ try { primary.cellEl.focus({ preventScroll: true }); } catch(e){ try { primary.cellEl.focus(); } catch(_){} } }
    if (opts.scroll){
      const block = ["start", "center", "end", "nearest"].includes(opts.scrollBlock) ? opts.scrollBlock : "nearest";
      primary.cellEl.scrollIntoView({ block });
    }
  }
}

function nbEnsureActionSelection(ownerDoc, ctrl){
  if (!ownerDoc || !ctrl) return;
  if (!nbSelectionSet(ownerDoc).has(ctrl.cell)) nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), {});
}

function nbCopySelectedCells(ownerDoc){
  const selected = nbSelectedCtrls(ownerDoc);
  if (!selected.length) return false;
  _notebookCellClipboard = notebookCellClipboardSnapshot(selected.map(ctrl => ctrl.cell));
  const message = selected.length + "개 셀을 복사했어요.";
  nbSetStatus(ownerDoc, message);
  if (typeof toast === "function") toast(message, 1600);
  return true;
}

function nbSaveSelectedCellsToScratchpad(ownerDoc){
  const selected = nbSelectedCtrls(ownerDoc);
  if (!selected.length) return false;
  if (typeof window === "undefined" || typeof window.addNotebookCellsToScratchpad !== "function"){
    if (typeof toast === "function") toast("임시 메모를 사용할 수 없습니다.", 1800);
    return false;
  }
  const snapshots = notebookCellClipboardSnapshot(selected.map(ctrl => ctrl.cell));
  const added = window.addNotebookCellsToScratchpad(snapshots);
  if (!added) return false;
  const message = added + "개 셀을 임시 메모에 보관했어요.";
  nbSetStatus(ownerDoc, message);
  if (typeof toast === "function") toast(message, 1800);
  return true;
}

function nbRemoveSelectedCells(ownerDoc, selectedCtrls){
  const model = ownerDoc && ownerDoc.notebookModel;
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const wrap = ownerDoc && ownerDoc._nbCellsWrap;
  const chosen = (selectedCtrls || []).filter(ctrl => ctrls.includes(ctrl));
  if (!model || !wrap || !chosen.length) return false;
  const indices = chosen.map(ctrl => ctrls.indexOf(ctrl)).sort((a, b) => a - b);
  const nextIndex = Math.min(indices[0], Math.max(0, ctrls.length - chosen.length - 1));
  for (let i = indices.length - 1; i >= 0; i--){
    const index = indices[i];
    const ctrl = ctrls[index];
    try { ctrl.destroy && ctrl.destroy(); } catch(_){}
    ctrl.cellEl.remove();
    ctrls.splice(index, 1);
    model.cells.splice(index, 1);
  }
  if (!ctrls.length){
    const cell = { id:nbNewId(), type:"code", source:"", execCount:null, outputs:[], rawOutputs:[], metadata:{} };
    model.cells.push(cell);
    const ctrl = nbBuildCell(ownerDoc, cell);
    ctrls.push(ctrl);
    wrap.appendChild(ctrl.cellEl);
  }
  nbInvalidateCompletionCache(ownerDoc);
  markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
  nbSetSelectionCells(ownerDoc, [ctrls[Math.min(nextIndex, ctrls.length - 1)].cell], null, true);
  return true;
}

function nbCutSelectedCells(ownerDoc){
  const selected = nbSelectedCtrls(ownerDoc);
  if (!selected.length) return false;
  nbPushHistory(ownerDoc, selected.length + "개 셀 잘라내기");
  _notebookCellClipboard = notebookCellClipboardSnapshot(selected.map(ctrl => ctrl.cell));
  if (!nbRemoveSelectedCells(ownerDoc, selected)) return false;
  const message = selected.length + "개 셀을 잘라냈어요.";
  nbSetStatus(ownerDoc, message);
  if (typeof toast === "function") toast(message, 1600);
  return true;
}

function nbPasteClipboardCells(ownerDoc){
  if (!_notebookCellClipboard.length){
    const message = "복사한 셀이 없습니다.";
    nbSetStatus(ownerDoc, message);
    if (typeof toast === "function") toast(message, 1600);
    return false;
  }
  return nbInsertCellSnapshots(ownerDoc, _notebookCellClipboard, {
    message:_notebookCellClipboard.length + "개 셀 붙여넣기"
  });
}

function nbInsertCellSnapshots(ownerDoc, snapshots, options={}){
  const model = ownerDoc && ownerDoc.notebookModel;
  const ctrls = ownerDoc && ownerDoc._nbCtrls || [];
  const wrap = ownerDoc && ownerDoc._nbCellsWrap;
  const safeSnapshots = notebookCellClipboardSnapshot(notebookMaterializeClipboardCells(snapshots));
  if (!model || !wrap || !safeSnapshots.length) return false;
  nbPushHistory(ownerDoc, options.message || (safeSnapshots.length + "개 셀 붙여넣기"));
  const selected = nbSelectedCtrls(ownerDoc);
  const selectedIndices = selected.map(ctrl => ctrls.indexOf(ctrl)).filter(index => index >= 0);
  const fallbackAt = selectedIndices.length ? Math.max(...selectedIndices) + 1 : Math.max(0, ownerDoc._nbSelected + 1);
  const at = Number.isInteger(options.at)
    ? Math.max(0, Math.min(ctrls.length, options.at))
    : fallbackAt;
  const cells = notebookMaterializeClipboardCells(safeSnapshots);
  const newCtrls = cells.map(cell => nbBuildCell(ownerDoc, cell));
  model.cells.splice(at, 0, ...cells);
  const reference = ctrls[at] ? ctrls[at].cellEl : null;
  const fragment = document.createDocumentFragment();
  newCtrls.forEach(ctrl => fragment.appendChild(ctrl.cellEl));
  wrap.insertBefore(fragment, reference);
  ctrls.splice(at, 0, ...newCtrls);
  nbInvalidateCompletionCache(ownerDoc);
  markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
  nbSetSelectionCells(ownerDoc, cells, cells[cells.length - 1], true);
  const message = cells.length + "개 셀을 붙여넣었어요.";
  nbSetStatus(ownerDoc, message);
  if (typeof toast === "function") toast(message, 1600);
  return true;
}
function nbSelectCell(ownerDoc, idx, scrollBlock){
  const ctrls = ownerDoc._nbCtrls || [];
  if (!ctrls.length) return;
  idx = Math.max(0, Math.min(ctrls.length - 1, idx));
  nbSetSelected(ownerDoc, idx, { focusCell: true, scroll: true, scrollBlock });
}
function nbEnterEdit(ownerDoc, idx, scrollBlock){
  const ctrl = (ownerDoc._nbCtrls || [])[idx];
  if (!ctrl) return;
  nbSetSelected(ownerDoc, idx, { scroll: true, scrollBlock });
  if (typeof ctrl.edit === "function") ctrl.edit();
}

// ── 명령/편집 모드 키보드 ──
function nbOnKeydown(ownerDoc, e){
  // Esc: 열려 있는 모든 검색창(노트북 전체 + 각 셀)을 한 번에 닫는다.
  if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && nbAnyFindOpen(ownerDoc)){
    e.preventDefault(); e.stopPropagation(); nbCloseAllFinds(ownerDoc); return;
  }
  // Ctrl+H = 노트북 전체 찾기·바꾸기, Ctrl+Shift+H = 현재 셀 안에서 찾기·바꾸기 (capture 단계라 셀 편집기보다 먼저 가로챔)
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "h" || e.key === "H")){
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) nbOpenCellFind(ownerDoc); else nbOpenNotebookFind(ownerDoc);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "S")){
    e.preventDefault(); e.stopPropagation(); saveNotebook(ownerDoc); return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "=" || e.key === "+")){
    e.preventDefault(); e.stopPropagation(); bumpCodeFont(1); return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "-"){
    e.preventDefault(); e.stopPropagation(); bumpCodeFont(-1); return;
  }
  if (ownerDoc._nbInkMode && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z")){
    e.preventDefault(); e.stopPropagation(); nbUndoInk(ownerDoc); return;
  }
  if (ownerDoc._nbInkMode && e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey){
    e.preventDefault(); e.stopPropagation();
    nbClearAllInk(ownerDoc, { silent:true }); nbSetInkMode(ownerDoc, false); return;
  }
  if (e.target.closest && e.target.closest(".nbv-find")) return;
  if (typeof shortcutMatches === "function" && shortcutMatches(e, "runNotebook")){
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) nbRunAll(ownerDoc);
    return;
  }
  const ctrls = ownerDoc._nbCtrls || [];
  const idx = ownerDoc._nbSelected;
  const inEditor = !!(e.target.closest && e.target.closest(".nbv-editor, .nbv-md-edit, .nbv-stdin"));
  if (!inEditor && (e.ctrlKey || e.metaKey) && !e.altKey){
    const command = String(e.key || "").toLowerCase();
    if (command === "z"){
      e.preventDefault(); e.stopPropagation();
      nbRestoreHistory(ownerDoc, e.shiftKey ? "redo" : "undo");
      return;
    }
    if (command === "y" && !e.shiftKey){
      e.preventDefault(); e.stopPropagation();
      nbRestoreHistory(ownerDoc, "redo");
      return;
    }
  }

  // 실행(편집·명령 공통)
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey){
    if (idx >= 0){ e.preventDefault(); e.stopPropagation(); nbRunByIndex(ownerDoc, idx, false); } return;
  }
  if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){
    if (idx >= 0){ e.preventDefault(); e.stopPropagation(); nbRunByIndex(ownerDoc, idx, true); } return;
  }

  if (inEditor){
    if (e.key === "Escape"){
      // 자동완성 목록이 떠 있으면 편집기 자신이 ESC 로 목록만 닫도록 넘긴다(커서 유지, 셀 이탈 금지).
      const ed = (ctrls[idx] && ctrls[idx].editor) || null;
      if (ed && typeof ed.isCompletionOpen === "function" && ed.isCompletionOpen()) return;
      e.preventDefault(); e.stopPropagation();
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch(_){}
      nbSetSelected(ownerDoc, idx >= 0 ? idx : 0, { focusCell: true });
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")){
      e.preventDefault(); e.stopPropagation();
      const ni = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (ni >= 0 && ni < ctrls.length) nbEnterEdit(ownerDoc, ni);
    }
    return;
  }

  // 명령 모드
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey){
    const command = String(e.key || "").toLowerCase();
    if (command === "c"){
      e.preventDefault(); e.stopPropagation(); nbCopySelectedCells(ownerDoc); return;
    }
    if (command === "x"){
      e.preventDefault(); e.stopPropagation(); nbCutSelectedCells(ownerDoc); return;
    }
    if (command === "v"){
      e.preventDefault(); e.stopPropagation(); nbPasteClipboardCells(ownerDoc); return;
    }
  }
  if (idx < 0) return;
  const k = e.key;
  if (k === "Enter"){ e.preventDefault(); nbEnterEdit(ownerDoc, idx); }
  else if (e.shiftKey && (k === "ArrowUp" || k === "ArrowDown")){
    e.preventDefault();
    const next = Math.max(0, Math.min(ctrls.length - 1, idx + (k === "ArrowDown" ? 1 : -1)));
    nbSetSelected(ownerDoc, next, { focusCell:true, scroll:true, range:true });
  }
  else if (k === "ArrowUp" || k === "k"){ e.preventDefault(); nbSelectCell(ownerDoc, idx - 1); }
  else if (k === "ArrowDown" || k === "j"){ e.preventDefault(); nbSelectCell(ownerDoc, idx + 1); }
  else if (k === "a" || k === "A"){ e.preventDefault(); nbInsertCell(ownerDoc, idx, "code", { where: "above", edit: true }); }
  else if (k === "b" || k === "B"){ e.preventDefault(); nbInsertCell(ownerDoc, idx, "code", { where: "below", edit: true }); }
  else if (k === "m" || k === "M"){ e.preventDefault(); nbChangeType(ownerDoc, idx, "markdown"); }
  else if (k === "y" || k === "Y"){ e.preventDefault(); nbChangeType(ownerDoc, idx, "code"); }
  else if (k === "d" || k === "D"){
    e.preventDefault();
    if (ownerDoc._nbDPending){ clearTimeout(ownerDoc._nbDTimer); ownerDoc._nbDPending = false; nbDeleteCell(ownerDoc, idx); }
    else { ownerDoc._nbDPending = true; ownerDoc._nbDTimer = setTimeout(() => { ownerDoc._nbDPending = false; }, 700); }
  }
}

function nbRunByIndex(ownerDoc, idx, advance){
  const ctrl = (ownerDoc._nbCtrls || [])[idx];
  if (!ctrl) return;
  if (ctrl.type === "code"){ nbRunCell(ownerDoc, ctrl, advance); return; }
  // 마크다운/raw: 편집 중이면 커밋(blur), advance 면 다음 셀 선택
  try { const a = document.activeElement; if (a && a.closest && a.closest(".nbv-md-edit")) a.blur(); } catch(_){}
  if (advance) nbSelectCell(ownerDoc, idx + 1);
}

// ── 셀 조작 ──
function nbInsertCell(ownerDoc, idx, type, opts){
  opts = opts || {};
  const model = ownerDoc.notebookModel, ctrls = ownerDoc._nbCtrls || [], wrap = ownerDoc._nbCellsWrap;
  if (!model || !wrap) return;
  nbPushHistory(ownerDoc, (type === "markdown" ? "마크다운" : "코드") + " 셀 추가");
  const at = (opts.where === "above") ? Math.max(0, idx) : idx + 1;
  const cell = { id: nbNewId(), type: type || "code", source: "", execCount: null, outputs: [], rawOutputs: [], metadata: {} };
  model.cells.splice(at, 0, cell);
  nbInvalidateCompletionCache(ownerDoc);
  const ctrl = nbBuildCell(ownerDoc, cell);
  const ref = ctrls[at] ? ctrls[at].cellEl : null;
  wrap.insertBefore(ctrl.cellEl, ref);
  ctrls.splice(at, 0, ctrl);
  markNbDirty(ownerDoc);
  if (opts.edit) nbEnterEdit(ownerDoc, at, opts.scrollBlock); else nbSetSelected(ownerDoc, at, { focusCell: true, scroll: true, scrollBlock: opts.scrollBlock });
}

function nbDeleteCell(ownerDoc, idx){
  const model = ownerDoc.notebookModel, ctrls = ownerDoc._nbCtrls || [];
  const ctrl = ctrls[idx];
  if (!model || !ctrl) return;
  nbPushHistory(ownerDoc, "셀 삭제");
  if (model.cells.length <= 1){   // 마지막 한 셀은 지우지 않고 비운다(빈 노트북 방지)
    ctrl.cell.source = "";
    nbInvalidateCompletionCache(ownerDoc);
    ctrl.cell.execCount = null;
    ctrl.cell.rawOutputs = [];
    ctrl.cell.outputs = [];
    notebookClearExecution(ctrl.cell);
    if (ctrl.editor) ctrl.editor.setValue("");
    if (ctrl.stdin){
      ctrl.clearStdin();
      ctrl.refreshStdin();
    }
    if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
    if (ctrl.runBtn) setRunState(ctrl, "idle");
    markNbDirty(ownerDoc); return;
  }
  try { ctrl.destroy && ctrl.destroy(); } catch(e){}
  if (ownerDoc._nbExpandedToolCells instanceof Set) ownerDoc._nbExpandedToolCells.delete(String(ctrl.cell.id || ""));
  if (ownerDoc._nbStdinValues instanceof Map) ownerDoc._nbStdinValues.delete(String(ctrl.cell.id || ""));
  ctrl.cellEl.remove();
  model.cells.splice(idx, 1);
  ctrls.splice(idx, 1);
  nbInvalidateCompletionCache(ownerDoc);
  markNbDirty(ownerDoc);
  nbSelectCell(ownerDoc, Math.min(idx, ctrls.length - 1));
}

function nbMoveCell(ownerDoc, idx, dir){
  nbMoveCellTo(ownerDoc, idx, idx + dir);
}

function nbChangeType(ownerDoc, idx, type){
  const ctrls = ownerDoc._nbCtrls || [], wrap = ownerDoc._nbCellsWrap;
  const old = ctrls[idx];
  if (!old || !wrap || old.cell.type === type) return;
  nbPushHistory(ownerDoc, "셀 형식 변경");
  old.cell.type = type;
  nbInvalidateCompletionCache(ownerDoc);
  notebookClearExecution(old.cell);
  old.cell.execCount = null;
  old.cell.rawOutputs = [];
  old.cell.outputs = [];
  const fresh = nbBuildCell(ownerDoc, old.cell);
  wrap.insertBefore(fresh.cellEl, old.cellEl);
  try { old.destroy && old.destroy(); } catch(e){}
  old.cellEl.remove();
  ctrls[idx] = fresh;
  markNbDirty(ownerDoc);
  nbSetSelected(ownerDoc, idx, { focusCell: true });
}

// 코드 셀 에디터 높이를 내용 줄 수에 맞춘다(최소 1줄, 최대 640px 후 내부 스크롤).
function fitEditorHeight(ed){
  const lines = (ed.ta.value.match(/\n/g) || []).length + 1;
  const lh = parseFloat(getComputedStyle(ed.ta).lineHeight) || 21;
  const h = Math.min(Math.max(lines * lh + 34, lh + 34), 640);
  ed.host.style.height = h + "px";
}

function markNbDirty(ownerDoc){
  if (!ownerDoc) return;
  ownerDoc.hasUnsavedEdits = true;
  notebookSetAutosaveState(ownerDoc, "");
  if (typeof updateDocumentStatus === "function") updateDocumentStatus(ownerDoc);
  updateNbSaveButton(ownerDoc, ownerDoc._nbSaveBtn);
  nbScheduleExecutionStateRefresh(ownerDoc);
  notebookScheduleRecovery(ownerDoc);
  notebookScheduleAutosave(ownerDoc);
  nbScheduleTocRefresh(ownerDoc);
}

function updateNbSaveButton(ownerDoc, btn){
  if (!btn) return;
  const dirty = !!(ownerDoc && ownerDoc.hasUnsavedEdits);
  const autosaveState = ownerDoc && ownerDoc._nbAutosaveState;
  btn.textContent = autosaveState === "saving" ? "저장 중…"
    : autosaveState === "failed" ? "저장 실패"
    : dirty ? "저장 *" : "저장";
  btn.title = autosaveState === "saving" ? "노트북을 자동 저장하는 중입니다."
    : autosaveState === "failed" ? "자동 저장에 실패했습니다. 복구본은 유지되며 저장 버튼으로 다시 시도할 수 있습니다."
    : dirty ? "저장되지 않은 변경 내용이 있습니다." : "노트북 저장";
  btn.classList.toggle("is-dirty", dirty);
}

// 모델 → .ipynb 직렬화 후 기존 저장 경로(saveTextDoc: 원본 파일/서버/다운로드)로 기록.
async function saveNotebook(ownerDoc){
  if (!ownerDoc || !ownerDoc.notebookModel) return;
  clearTimeout(ownerDoc._nbAutosaveTimer);
  ownerDoc._nbAutosaveTimer = 0;
  ownerDoc._nbAutosaveAgain = false;
  if (ownerDoc._nbAutosaveSaving) await ownerDoc._nbAutosaveSaving;
  nbSyncFindModel(ownerDoc);
  const text = modelToIpynb(ownerDoc.notebookModel);
  const name = ownerDoc.name || "notebook.ipynb";
  let ok = false;
  try { ok = (typeof saveTextDoc === "function") ? await saveTextDoc(text, ownerDoc, name) : false; }
  catch(e){ console.error(e); }
  if (ok){
    notebookSetAutosaveState(ownerDoc, "");
    ownerDoc.savedText = text;
    const savedName = ownerDoc.name || name;
    const savedPath = normalizedRunPath(ownerDoc.workspacePath || savedName);
    if (typeof rememberWorkspace === "function"){
      try {
        const updated = new File([text], savedName, { type:"application/x-ipynb+json" });
        if (savedPath.indexOf("/") >= 0){
          Object.defineProperty(updated, "webkitRelativePath", { value:savedPath });
        }
        ownerDoc.savedInWorkspace = await rememberWorkspace([updated], false, { silent:true });
      } catch(e){
        console.warn("notebook workspace save skipped:", e);
        ownerDoc.savedInWorkspace = false;
      }
    }
    ownerDoc.hasUnsavedEdits = modelToIpynb(ownerDoc.notebookModel) !== text;
    if (typeof updateDocumentStatus === "function") updateDocumentStatus(ownerDoc);
    updateNbSaveButton(ownerDoc, ownerDoc._nbSaveBtn);
    if (typeof renderSidebar === "function") renderSidebar();
    await notebookDeleteRecovery(ownerDoc);
  }
}

function destroyNotebook(ownerDoc){
  nbClearDragState(ownerDoc);
  if (ownerDoc) nbSetInkMode(ownerDoc, false);
  if (ownerDoc && typeof ownerDoc._nbLocalCancel === "function"){
    try { ownerDoc._nbLocalCancel(); } catch(_){}
  }
  if (ownerDoc && ownerDoc._nbLocalKernelId){
    nbStopLocalNotebookKernel(ownerDoc, { keepalive:true });
  }
  if (ownerDoc){
    clearTimeout(ownerDoc._nbAutosaveTimer);
    ownerDoc._nbAutosaveTimer = 0;
    ownerDoc._nbAutosaveAgain = false;
  }
  if (ownerDoc && ownerDoc._nbStateRefresh && typeof cancelAnimationFrame === "function"){
    cancelAnimationFrame(ownerDoc._nbStateRefresh);
    ownerDoc._nbStateRefresh = 0;
  }
  if (ownerDoc && ownerDoc._nbObserver){ try { ownerDoc._nbObserver.disconnect(); } catch(e){} ownerDoc._nbObserver = null; }
  if (ownerDoc && ownerDoc._nbFontHost){
    unregisterEditorFont(ownerDoc._nbFontHost);
    ownerDoc._nbFontHost.__refreshFontMetrics = null;
    ownerDoc._nbFontHost = null;
  }
  if (ownerDoc) ownerDoc._nbFind = null;
  if (!ownerDoc || !Array.isArray(ownerDoc._nbCtrls)) return;
  if (ownerDoc._nbActiveTask && typeof ownerDoc._nbActiveTask.cancel === "function"){
    try { ownerDoc._nbActiveTask.cancel(); } catch(_){}
  }
  for (const c of ownerDoc._nbCtrls){ try { c.destroy && c.destroy(); } catch(e){} }
  ownerDoc._nbCtrls = null;
  ownerDoc._nbFreshRunBtn = null;
  ownerDoc._nbRunMoreBtn = null;
  ownerDoc._nbRunAllBtn = null;
  ownerDoc._nbRunGroup = null;
  ownerDoc._nbKernelTag = null;
  ownerDoc._nbLocalKernelBtn = null;
  ownerDoc._nbLocalRunBtn = null;
  ownerDoc._nbUndoBtn = null;
  ownerDoc._nbRedoBtn = null;
  ownerDoc._nbTocButton = null;
  ownerDoc._nbTocList = null;
  if (ownerDoc._nbTocRefresh){
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(ownerDoc._nbTocRefresh);
    else clearTimeout(ownerDoc._nbTocRefresh);
    ownerDoc._nbTocRefresh = 0;
  }
  ownerDoc._nbActiveTask = null;
  ownerDoc._nbRunAllActive = false;
  ownerDoc._nbCancelRequested = false;
  ownerDoc._nbInkButton = null;
  ownerDoc._nbInkToolbar = null;
  ownerDoc._nbInkTarget = null;
  ownerDoc._nbRoot = null;
}

// ── 가상화: 화면에서 충분히 멀어진(마운트된) 코드 셀을 정적 표시로 되돌려 에디터 수를 제한 ──
function nbEnsureObserver(ownerDoc){
  if (ownerDoc._nbObserver) return ownerDoc._nbObserver;
  if (typeof IntersectionObserver === "undefined") return null;
  ownerDoc._nbObserver = new IntersectionObserver((entries) => {
    for (const en of entries){
      if (en.isIntersecting) continue;
      const ctrl = en.target.__nbctrl;
      if (ctrl && ctrl.type === "code" && ctrl.active) nbMaybeDemount(ownerDoc, ctrl);
    }
  }, { root: null, rootMargin: "1200px 0px" });
  return ownerDoc._nbObserver;
}
function nbMaybeDemount(ownerDoc, ctrl){
  if (!ctrl.active) return;
  if (nbCtrlIndex(ownerDoc, ctrl) === ownerDoc._nbSelected) return;          // 선택된 셀은 유지
  if (ctrl.cellEl.contains(document.activeElement)) return;                  // 포커스 있는 셀은 유지
  ctrl.demount();
}

function nbFocusCellLine(ctrl, line){
  if (!ctrl || !line) return;
  if (ctrl.setBodyCollapsed) ctrl.setBodyCollapsed(false);
  const ownerDoc = ctrl.ownerDoc;
  if (ownerDoc) nbSetSelected(ownerDoc, nbCtrlIndex(ownerDoc, ctrl), { scroll:true });
  if (ctrl.edit) ctrl.edit();
  requestAnimationFrame(() => {
    if (ctrl.editor && ctrl.editor.focusLine) ctrl.editor.focusLine(line);
  });
}

function renderNotebookError(host, value, ctrl){
  const text = String(value || "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  const box = document.createElement("div");
  box.className = "nbv-out-error-box";
  // 초보자용 오류 해설 카드 — 흔한 예외를 한국어로 풀어 준다(일반 Python 뷰어와 같은 explainPythonError 사용).
  const help = (typeof explainPythonError === "function") ? explainPythonError(text) : null;
  if (help){
    const card = document.createElement("section");
    card.className = "py-error-help nbv-error-help";
    const title = document.createElement("strong"); title.textContent = help.title;
    const type = document.createElement("code"); type.textContent = help.type;
    const head = document.createElement("div"); head.className = "py-error-help-head"; head.append(title, type);
    const tip = document.createElement("p"); tip.textContent = help.tip;
    card.append(head, tip);
    box.appendChild(card);
  }
  const pre = document.createElement("pre");
  pre.className = "nbv-out-text nbv-out-error";
  pre.textContent = text;
  const line = notebookTracebackLine(text);
  if (line && ctrl){
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "nbv-error-jump";
    jump.textContent = "오류 줄 " + line + "로 이동";
    jump.addEventListener("click", () => nbFocusCellLine(ctrl, line));
    box.append(jump);
  }
  box.appendChild(pre);
  host.appendChild(box);
}

function renderNotebookRichFrame(host, spec){
  if (!spec || !spec.srcdoc) return false;
  const rich = document.createElement("div");
  rich.className = "nbv-out-rich-frame";
  if (spec.height){
    rich.style.height = spec.height;
    rich.style.paddingBottom = "0";
  } else {
    rich.style.paddingBottom = spec.paddingBottom || "62%";
  }
  const frame = document.createElement("iframe");
  frame.className = "nbv-out-rich-frame-content";
  frame.title = spec.title || "인터랙티브 출력";
  frame.setAttribute("sandbox", spec.allowScripts ? "allow-scripts" : "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "lazy");
  frame.addEventListener("load", () => { frame.dataset.nbvFrameLoaded = "1"; });   // PDF 스냅샷 가능 여부 판단용
  if (spec.mapCapture){
    rich.dataset.nbvMapFrame = "1";                       // PDF 내보내기 때 스냅샷 요청 대상 표시
    frame.srcdoc = nbInjectMapCapture(spec.srcdoc);
  } else {
    frame.srcdoc = spec.srcdoc;
  }
  rich.appendChild(frame);
  host.appendChild(rich);
  return true;
}

function renderNotebookTrustCard(host, html, ctrl){
  const spec = notebookUntrustedHtmlFrameSpec(html);
  if (!spec) return false;
  const card = document.createElement("div");
  card.className = "nbv-out-interactive-trust";
  const title = document.createElement("strong");
  title.textContent = "인터랙티브 HTML 결과";
  const detail = document.createElement("p");
  detail.textContent = "스크립트 또는 외부 콘텐츠가 포함되어 있어 기본적으로 실행하지 않았습니다. 실행해도 앱과 분리된 iframe에서만 동작합니다.";
  const run = document.createElement("button");
  run.type = "button";
  run.className = "nbv-out-interactive-trust-run";
  run.textContent = "이 노트북에서 실행";
  run.addEventListener("click", async () => {
    const ownerDoc = ctrl && ctrl.ownerDoc;
    if (!ownerDoc) return;
    if (!ownerDoc._nbInteractiveHtmlTrusted){
      const ok = typeof confirmDialog === "function" && await confirmDialog(
        "이 노트북의 임의 HTML·스크립트 결과를 이번에 연 노트북 동안 실행합니다. 외부 네트워크 요청이 발생할 수 있으므로 신뢰하는 노트북에서만 계속하세요.",
        "이 노트북 신뢰", "취소");
      if (!ok) return;
      ownerDoc._nbInteractiveHtmlTrusted = true;
    }
    card.remove();
    renderNotebookRichFrame(host, spec);
  });
  card.append(title, detail, run);
  host.appendChild(card);
  return true;
}

function renderCellOutputs(outputs, host, ctrl){
  for (const o of outputs){
    if (o.kind === "image"){
      const img = document.createElement("img");
      img.className = "nbv-out-img";
      img.src = "data:" + (o.mime || "image/png") + ";base64," + o.b64;
      host.appendChild(img);
    } else if (o.kind === "svg"){
      const img = document.createElement("img");
      img.className = "nbv-out-img nbv-out-svg";
      const svg = String(o.svg || "");
      if (svg.length <= 5 * 1024 * 1024){
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        img.alt = "SVG 실행 결과";
        host.appendChild(img);
      }
    } else if (o.kind === "interactive"){
      const frameSpec = notebookInteractiveMimeFrameSpec(o.mime, o.data);
      if (!renderNotebookRichFrame(host, frameSpec)){
        const pre = document.createElement("pre");
        pre.className = "nbv-out-text nbv-out-json";
        pre.textContent = notebookJsonOutput(o.data);
        host.appendChild(pre);
      }
    } else if (o.kind === "html"){
      const frameSpec = notebookInteractiveHtmlFrameSpec(o.html);
      const untrustedSpec = !frameSpec && notebookUntrustedHtmlFrameSpec(o.html);
      if (frameSpec) renderNotebookRichFrame(host, frameSpec);
      else if (untrustedSpec && ctrl && ctrl.ownerDoc && ctrl.ownerDoc._nbInteractiveHtmlTrusted){
        renderNotebookRichFrame(host, untrustedSpec);
      } else if (untrustedSpec){
        renderNotebookTrustCard(host, o.html, ctrl);
      } else {
        const rich = document.createElement("div");
        rich.className = "nbv-out-html";
        const sanitizer = typeof PdfSignerCore !== "undefined" &&
          PdfSignerCore && typeof PdfSignerCore.sanitizeHtml === "function"
          ? PdfSignerCore.sanitizeHtml
          : null;
        if (sanitizer) rich.innerHTML = sanitizer(o.html || "");
        else rich.textContent = o.html || "";
        host.appendChild(rich);
      }
    } else if (o.kind === "media"){
      const media = document.createElement(o.media === "video" ? "video" : "audio");
      media.className = "nbv-out-media nbv-out-" + (o.media === "video" ? "video" : "audio");
      media.controls = true;
      media.preload = "metadata";
      const raw = String(o.b64 || "");
      if (raw.length <= 12 * 1024 * 1024){
        media.src = /^data:(?:audio|video)\//i.test(raw)
          ? raw
          : "data:" + o.mime + ";base64," + raw.replace(/\s+/g, "");
        host.appendChild(media);
      }
    } else if (o.kind === "latex"){
      const box = document.createElement("div");
      box.className = "nbv-out-latex";
      const tex = String(o.text || "")
        .replace(/^\s*\$\$([\s\S]*)\$\$\s*$/, "$1")
        .replace(/^\s*\\\[([\s\S]*)\\\]\s*$/, "$1");
      const renderer = typeof PdfSignerCore !== "undefined" &&
        PdfSignerCore && typeof PdfSignerCore.latexToMathML === "function"
        ? PdfSignerCore.latexToMathML
        : null;
      if (renderer) box.innerHTML = renderer(tex, true);
      else box.textContent = tex;
      host.appendChild(box);
    } else if (o.kind === "json"){
      const pre = document.createElement("pre");
      pre.className = "nbv-out-text nbv-out-json";
      pre.textContent = o.text || "";
      host.appendChild(pre);
    } else if (o.kind === "error"){
      renderNotebookError(host, o.text, ctrl);
    } else {
      const pre = document.createElement("pre");
      pre.className = "nbv-out-text" + (o.name === "stderr" ? " nbv-out-warning" : "");
      pre.textContent = o.text || "";
      host.appendChild(pre);
    }
  }
}

function escapeForPre(s){
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

if (typeof window !== "undefined"){
  window.insertNotebookCellsFromScratchpad = snapshots => {
    const ownerDoc = (typeof docs !== "undefined" && typeof activeId !== "undefined")
      ? docs.find(doc => doc.id === activeId)
      : null;
    if (!ownerDoc || !ownerDoc.notebookModel || !Array.isArray(ownerDoc._nbCtrls)) return false;
    return nbInsertCellSnapshots(ownerDoc, snapshots, { message:"메모에서 셀 붙여넣기" });
  };
}

// 노드 테스트용: 순수 직렬화 함수만 노출(브라우저에서는 module 이 없어 무시됨)
if (typeof module === "object" && module.exports){
  module.exports = {
    ipynbToModel,
    modelToIpynb,
    splitSourceLines,
    parseNbOutputs,
    notebookJsonOutput,
    notebookTracebackLine,
    notebookHeadings,
    notebookVariables,
    notebookResultToRawOutputs,
    notebookExecutionHash,
    notebookUpstreamHash,
    notebookRecordExecution,
    notebookClearExecution,
    notebookCellExecutionState,
    notebookNormalizeInkStrokes,
    notebookEnsureInkStrokes,
    notebookDropEmptyInkMetadata,
    notebookMoveArrayItem,
    notebookCellClipboardSnapshot,
    notebookMaterializeClipboardCells,
    notebookCompletionContext,
    notebookInvalidateCompletionCache,
    notebookCodeSource,
    notebookKernelModeLabel,
    notebookRequiresLocalPython,
    notebookInputPlan,
    notebookCellUsesInput,
    notebookFindMatches,
    notebookFindNextIndex,
    notebookReplaceAll,
    notebookExecutionControlState,
    notebookAutosaveTarget,
    notebookCellHasExecutableSource,
    notebookSetOutputsCollapsed,
    notebookFoliumFrameSpec,
    notebookInteractiveHtmlFrameSpec,
    notebookUntrustedHtmlFrameSpec,
    notebookInteractiveMimeFrameSpec,
    notebookPdfSegments,
    notebookPdfBatches
  };
}
