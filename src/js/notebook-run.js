"use strict";

// 셀을 세로로 쌓아 그린다. 코드 셀은 buildCodeEditor 인스턴스(내용에 맞춰 높이 자동),
// 마크다운 셀은 렌더 ↔ 더블클릭 편집 토글. 편집은 즉시 model.cells[i].source 에 반영되고
// 저장(💾/Ctrl+S)은 modelToIpynb → saveTextDoc 로 .ipynb 에 기록한다.
function renderNotebookView(model, host, ownerDoc){
  if (typeof prewarmBrowserPython === "function") prewarmBrowserPython();   // 실행 전에 브라우저 파이썬 미리 준비
  const jsNotebookDocument = notebookLanguageOf(model) === "javascript";
  // 같은 doc 을 다시 렌더하지 않도록(탭 전환 시 el 은 유지됨) 한 번만 빌드한다.
  if (ownerDoc){
    ownerDoc.notebookModel = model;
    if (ownerDoc._nbCtrls) destroyNotebook(ownerDoc);
    ownerDoc._nbCtrls = [];
    if (ownerDoc._nbKernelMode !== "local") ownerDoc._nbKernelMode = "browser";
    ownerDoc.flushBackupRecovery = () => notebookSaveRecovery(ownerDoc);
  }
  const ctrls = ownerDoc ? ownerDoc._nbCtrls : [];

  const root = document.createElement("div");
  root.className = "nbv-doc";

  // ── 상단 툴바: 저장 + 변환(.py) 뷰 전환 ──
  const bar = document.createElement("div");
  bar.className = "nbv-bar";
  const tag = document.createElement("span");
  tag.className = "nbv-bar-tag";
  tag.textContent = "노트북";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button"; saveBtn.className = "nbv-save"; saveBtn.textContent = "저장";
  saveBtn.title = "이 노트북을 .ipynb 로 저장 (Ctrl+S)";
  saveBtn.addEventListener("click", () => saveNotebook(ownerDoc));
  const undoBtn = document.createElement("button");
  undoBtn.type = "button"; undoBtn.className = "nbv-history"; undoBtn.textContent = "↶";
  undoBtn.title = "마지막 셀 작업 되돌리기 (명령 모드 Ctrl+Z)";
  undoBtn.setAttribute("aria-label", undoBtn.title);
  undoBtn.addEventListener("click", () => nbRestoreHistory(ownerDoc, "undo"));
  const redoBtn = document.createElement("button");
  redoBtn.type = "button"; redoBtn.className = "nbv-history"; redoBtn.textContent = "↷";
  redoBtn.title = "셀 작업 다시 실행 (명령 모드 Ctrl+Y)";
  redoBtn.setAttribute("aria-label", redoBtn.title);
  redoBtn.addEventListener("click", () => nbRestoreHistory(ownerDoc, "redo"));
  // 실행/커널 버튼은 '전체 실행' 하나만 툴바에 두고, 재시작 계열은 옆 ▾ 드롭다운으로 묶는다.
  const runAllBtn = document.createElement("button");
  runAllBtn.type = "button"; runAllBtn.className = "nbv-runall"; runAllBtn.textContent = "전체 실행";
  runAllBtn.title = "모든 코드 셀을 위에서부터 차례로 실행";
  runAllBtn.dataset.shortcutAction = "runNotebook";
  runAllBtn.dataset.shortcutTitle = "모든 코드 셀을 위에서부터 차례로 실행";
  runAllBtn.dataset.shortcutAria = "true";
  runAllBtn.addEventListener("click", () => {
    if (ownerDoc && (ownerDoc._nbBusy || ownerDoc._nbRunAllActive)) nbStopExecution(ownerDoc);
    else nbRunAll(ownerDoc);
  });
  const restartRunBtn = document.createElement("button");   // stale 셀이 있으면 '최신 상태로 실행 (N)'으로 라벨이 바뀜(_nbFreshRunBtn)
  restartRunBtn.type = "button"; restartRunBtn.className = "nbv-restartrun nbv-run-menu-item"; restartRunBtn.textContent = "재시작 후 실행";
  restartRunBtn.title = "커널을 재시작한 뒤 모든 셀을 처음부터 실행";
  const restartBtn = document.createElement("button");
  restartBtn.type = "button"; restartBtn.className = "nbv-restart nbv-run-menu-item"; restartBtn.textContent = "커널 재시작";
  restartBtn.title = "누적된 변수·상태를 모두 비우고 실행 결과를 지웁니다";
  // 로컬 셀 커널은 Selenium 객체와 변수를 셀 사이에 유지한다. 기존 전체 1회 실행도 별도 도구로 남긴다.
  const localKernelBtn = document.createElement("button");
  localKernelBtn.type = "button"; localKernelBtn.className = "nbv-local-kernel nbv-run-menu-item";
  localKernelBtn.textContent = "로컬 Python 확인 중…";
  const localRunBtn = document.createElement("button");
  localRunBtn.type = "button"; localRunBtn.className = "nbv-localrun nbv-run-menu-item"; localRunBtn.textContent = "로컬 Python 확인 중…";
  localRunBtn.title = "모든 코드 셀을 하나의 .py처럼 합쳐 PC의 로컬 Python으로 한 번 실행";
  if (typeof pythonBackendAvailable === "function"){
    Promise.resolve(pythonBackendAvailable()).then(ok => {
      if (ownerDoc) ownerDoc._nbLocalPythonAvailable = !!ok;
      nbRefreshKernelModeUi(ownerDoc);
    }).catch(() => {
      if (ownerDoc) ownerDoc._nbLocalPythonAvailable = false;
      nbRefreshKernelModeUi(ownerDoc);
    });
  }
  const runMore = document.createElement("button");
  runMore.type = "button"; runMore.className = "nbv-run-more"; runMore.textContent = "▾";
  runMore.title = "실행 커널 선택 · 재시작";
  runMore.setAttribute("aria-haspopup", "menu"); runMore.setAttribute("aria-expanded", "false");
  const runMenu = document.createElement("div");
  runMenu.className = "nbv-run-menu"; runMenu.hidden = true; runMenu.setAttribute("role", "menu");
  runMenu.append(restartRunBtn, restartBtn, localKernelBtn, localRunBtn);
  const runGroup = document.createElement("span");
  runGroup.className = "nbv-run-group";
  runGroup.append(runAllBtn, runMore, runMenu);
  const jsLibraryBtn = document.createElement("button");
  jsLibraryBtn.type = "button"; jsLibraryBtn.className = "nbv-js-library run-pkg run-js-library"; jsLibraryBtn.textContent = "라이브러리";
  const closeRunMenu = () => { if (!runMenu.hidden){ runMenu.hidden = true; runMore.setAttribute("aria-expanded", "false"); } };
  runMore.addEventListener("click", () => {
    const open = runMenu.hidden;
    runMenu.hidden = !open; runMore.setAttribute("aria-expanded", String(open));
  });
  restartRunBtn.addEventListener("click", () => { closeRunMenu(); nbRestartRunAll(ownerDoc); });
  restartBtn.addEventListener("click", () => { closeRunMenu(); nbRestartKernel(ownerDoc); });
  localKernelBtn.addEventListener("click", () => { closeRunMenu(); nbToggleLocalKernelMode(ownerDoc); });
  localRunBtn.addEventListener("click", () => { closeRunMenu(); nbRunNotebookLocalPython(ownerDoc); });
  const onDocClickRunMenu = (e) => { if (!runGroup.contains(e.target)) closeRunMenu(); };
  document.addEventListener("click", onDocClickRunMenu);
  if (ownerDoc){
    ownerDoc._nbRunMoreBtn = runMore;
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => document.removeEventListener("click", onDocClickRunMenu));
  }
  const clearBtn = document.createElement("button");
  clearBtn.type = "button"; clearBtn.className = "nbv-clear nbv-output-clear"; clearBtn.textContent = "출력 지우기";
  clearBtn.title = "노트북 실행 결과를 지웁니다(변수·상태는 유지)";
  clearBtn.addEventListener("click", () => nbClearOutputs(ownerDoc));
  const collapseOutputsBtn = document.createElement("button");
  collapseOutputsBtn.type = "button"; collapseOutputsBtn.className = "nbv-run-menu-item";
  collapseOutputsBtn.textContent = "출력 접기"; collapseOutputsBtn.setAttribute("role", "menuitem");
  const expandOutputsBtn = document.createElement("button");
  expandOutputsBtn.type = "button"; expandOutputsBtn.className = "nbv-run-menu-item";
  expandOutputsBtn.textContent = "출력 펼치기"; expandOutputsBtn.setAttribute("role", "menuitem");
  const outputMore = document.createElement("button");
  outputMore.type = "button"; outputMore.className = "nbv-output-more"; outputMore.textContent = "▾";
  outputMore.title = "출력 접기 · 출력 펼치기";
  outputMore.setAttribute("aria-haspopup", "menu"); outputMore.setAttribute("aria-expanded", "false");
  const outputMenu = document.createElement("div");
  outputMenu.className = "nbv-run-menu nbv-output-menu"; outputMenu.hidden = true; outputMenu.setAttribute("role", "menu");
  outputMenu.append(collapseOutputsBtn, expandOutputsBtn);
  const outputGroup = document.createElement("span");
  outputGroup.className = "nbv-run-group nbv-output-group";
  outputGroup.append(clearBtn, outputMore, outputMenu);
  const closeOutputMenu = () => {
    if (!outputMenu.hidden){
      outputMenu.hidden = true;
      outputMore.setAttribute("aria-expanded", "false");
    }
  };
  outputMore.addEventListener("click", () => {
    const open = outputMenu.hidden;
    outputMenu.hidden = !open;
    outputMore.setAttribute("aria-expanded", String(open));
  });
  collapseOutputsBtn.addEventListener("click", () => {
    closeOutputMenu();
    const count = notebookSetOutputsCollapsed(ownerDoc, true);
    nbSetStatus(ownerDoc, count ? window.tf("출력 {n}개 접음", { n: count }) : (window.t ? window.t("접을 출력이 없어요.") : "접을 출력이 없어요."));
  });
  expandOutputsBtn.addEventListener("click", () => {
    closeOutputMenu();
    const count = notebookSetOutputsCollapsed(ownerDoc, false);
    nbSetStatus(ownerDoc, count ? window.tf("출력 {n}개 펼침", { n: count }) : (window.t ? window.t("펼칠 출력이 없어요.") : "펼칠 출력이 없어요."));
  });
  const onDocClickOutputMenu = event => {
    if (!outputGroup.contains(event.target)) closeOutputMenu();
  };
  const onDocKeydownOutputMenu = event => {
    if (event.key === "Escape") closeOutputMenu();
  };
  document.addEventListener("click", onDocClickOutputMenu);
  document.addEventListener("keydown", onDocKeydownOutputMenu, true);
  if (ownerDoc){
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      document.removeEventListener("click", onDocClickOutputMenu);
      document.removeEventListener("keydown", onDocKeydownOutputMenu, true);
    });
  }
  const inkBtn = document.createElement("button");
  inkBtn.type = "button"; inkBtn.className = "nbv-ink-toggle"; inkBtn.textContent = "필기";
  inkBtn.title = "코드·마크다운·실행 결과 위에 셀별로 필기";
  inkBtn.setAttribute("aria-pressed", "false");
  inkBtn.addEventListener("click", () => nbSetInkMode(ownerDoc, !ownerDoc._nbInkMode));
  const tocBtn = document.createElement("button");
  tocBtn.type = "button"; tocBtn.className = "nbv-toc-open"; tocBtn.textContent = "목차";
  tocBtn.title = "마크다운 제목에서 만든 노트북 목차";
  tocBtn.setAttribute("aria-expanded", "false");
  const findBtn = document.createElement("button");
  findBtn.type = "button"; findBtn.className = "nbv-find-open"; findBtn.textContent = "전체 찾기";
  findBtn.dataset.shortcutAction = "findInDocument";
  findBtn.dataset.shortcutTitle = "노트북 전체 셀에서 찾기·바꾸기";
  findBtn.dataset.shortcutAria = "true";
  findBtn.title = "노트북 전체 셀에서 찾기·바꾸기 (Ctrl+F)";
  findBtn.addEventListener("click", () => nbOpenNotebookFind(ownerDoc));
  const dedupeBtn = document.createElement("button");
  dedupeBtn.type = "button"; dedupeBtn.className = "nbv-dedupe"; dedupeBtn.textContent = "중복 줄 삭제";
  dedupeBtn.title = "선택한 줄에서 같은 내용을 한 줄만 남깁니다(공백·대소문자 구분)";
  dedupeBtn.addEventListener("click", () => {
    const ctrl = (ownerDoc && ownerDoc._nbCtrls || [])[ownerDoc && ownerDoc._nbSelected];
    if (!ctrl || !["code", "markdown"].includes(ctrl.type)){
      toast("코드 또는 마크다운 셀을 선택하세요.", 1800); return;
    }
    if (ownerDoc._nbInkMode || ownerDoc._studyReadonly){
      toast("읽기 전용 상태에서는 줄을 삭제할 수 없어요.", 1800); return;
    }
    let ta = ctrl.type === "code" ? (ctrl.editor && ctrl.editor.ta) : ctrl.cellEl.querySelector(".nbv-md-edit");
    if (!ta){
      ctrl.edit();
      toast("셀에서 삭제할 줄을 선택한 뒤 다시 눌러 주세요.", 2200); return;
    }
    const planned = transformEditorLines(ta.value, ta.selectionStart, ta.selectionEnd, "dedupe");
    if (planned.value === ta.value){
      toast("선택한 줄에 중복이 없어요.", 1800); return;
    }
    if (typeof nbPushHistory === "function") nbPushHistory(ownerDoc, "중복 줄 삭제");
    const beforeLineCount = ta.value.split("\n").length;
    const removed = ctrl.type === "code"
      ? ctrl.editor.dedupeSelectedLines()
      : (() => {
          ta.value = planned.value;
          ta.setSelectionRange(planned.selectionStart, planned.selectionEnd);
          ta.dispatchEvent(new Event("input", { bubbles:true }));
          return Math.max(0, beforeLineCount - planned.value.split("\n").length);
        })();
    toast(removed ? (removed + "개의 중복 줄을 삭제했어요.") : "선택한 줄에 중복이 없어요.", 1800);
    ta.focus();
  });
  const fontGroup = document.createElement("span");
  fontGroup.className = "nbv-font-group";
  const fontDown = document.createElement("button");
  fontDown.type = "button"; fontDown.className = "nbv-font"; fontDown.textContent = "A−";
  fontDown.title = "노트북 글자 작게 — 코드 셀·마크다운 셀·결과 (Ctrl+−)";
  fontDown.setAttribute("aria-label", fontDown.title);
  const fontUp = document.createElement("button");
  fontUp.type = "button"; fontUp.className = "nbv-font"; fontUp.textContent = "A+";
  fontUp.title = "노트북 글자 크게 — 코드 셀·마크다운 셀·결과 (Ctrl++)";
  fontUp.setAttribute("aria-label", fontUp.title);
  fontDown.addEventListener("click", () => bumpCodeFont(-1));
  fontUp.addEventListener("click", () => bumpCodeFont(1));
  fontGroup.append(fontDown, fontUp);
  const exportBtn = document.createElement("button");
  exportBtn.type = "button"; exportBtn.className = "nbv-export"; exportBtn.textContent = ".py 내보내기";
  exportBtn.title = "현재 노트북을 파이썬(.py) 코드로 새 탭에 내보내기";
  exportBtn.addEventListener("click", () => nbExportPy(ownerDoc));
  const pdfBtn = document.createElement("button");
  pdfBtn.type = "button"; pdfBtn.className = "nbv-export-pdf nbv-run-menu-item"; pdfBtn.textContent = "PDF로 저장";
  pdfBtn.setAttribute("role", "menuitem");
  pdfBtn.title = "실행 결과까지 노트북 전체를 고화질 PDF로 저장 (태블릿 학습용 · 필기 제외)";
  pdfBtn.addEventListener("click", () => nbExportImagePdf(ownerDoc));
  const helpBtn = document.createElement("button");
  helpBtn.type = "button"; helpBtn.className = "nbv-help-open"; helpBtn.textContent = "단축키";
  helpBtn.title = "키보드 단축키 모아 보기";
  helpBtn.addEventListener("click", () => nbToggleShortcutSheet(ownerDoc));
  const status = document.createElement("span");
  status.className = "nbv-status";
  const toPyBtn = document.createElement("button");
  toPyBtn.type = "button"; toPyBtn.className = "nbv-toggle nbv-run-menu-item"; toPyBtn.textContent = "변환(.py) 뷰";
  toPyBtn.setAttribute("role", "menuitem");
  toPyBtn.title = "기존 파이썬 변환 뷰로 전환(앱 새로고침)";
  toPyBtn.addEventListener("click", async () => {
    if (ownerDoc && ownerDoc.hasUnsavedEdits){
      const ok = (typeof confirmDialog === "function")
        ? await confirmDialog("저장하지 않은 편집이 있습니다. 그래도 전환할까요?", "전환", "취소") : true;
      if (!ok) return;
    }
    if (typeof window !== "undefined" && window.mnNotebookMode) window.mnNotebookMode(false);
  });
  // 저장·내보내기 계열을 각각 한 덩어리(주 버튼 + ▾ 드롭다운)로 묶는다. 실행/출력 그룹과 같은 스타일·동작.
  const buildToolMenuGroup = (primaryBtn, moreTitle, menuItems, extraClass) => {
    const more = document.createElement("button");
    more.type = "button"; more.className = "nbv-run-more"; more.textContent = "▾";
    more.title = moreTitle;
    more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "nbv-run-menu"; menu.hidden = true; menu.setAttribute("role", "menu");
    menu.append(...menuItems);
    const group = document.createElement("span");
    group.className = "nbv-run-group" + (extraClass ? " " + extraClass : "");
    group.append(primaryBtn, more, menu);
    const close = () => { if (!menu.hidden){ menu.hidden = true; more.setAttribute("aria-expanded", "false"); } };
    more.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open; more.setAttribute("aria-expanded", String(open));
    });
    menu.addEventListener("click", (e) => { if (e.target.closest("button")) close(); });   // 항목 고르면 닫기
    const onDocClick = (e) => { if (!group.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey, true);
    if (ownerDoc){
      if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
      ownerDoc.cleanupFns.push(() => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey, true);
      });
    }
    return group;
  };
  const saveGroup = buildToolMenuGroup(saveBtn, "PDF로 저장", [pdfBtn], "nbv-save-group");
  const exportGroup = buildToolMenuGroup(exportBtn, "변환(.py) 뷰", [toPyBtn], "nbv-export-group");
  bar.append(tag, saveGroup, undoBtn, redoBtn, runGroup);
  if (jsNotebookDocument) bar.appendChild(jsLibraryBtn);
  bar.append(outputGroup, inkBtn, tocBtn, findBtn, dedupeBtn, fontGroup, exportGroup, helpBtn, status);
  root.appendChild(bar);
  if (jsNotebookDocument && typeof buildJsLibraryPicker === "function"){
    const libraryKey = jsLibraryStorageKey(notebookRecoveryKey(ownerDoc));
    let activeLibraries = loadJsLibraryState(libraryKey);
    const completionWords = [...JS_RUN_COMPLETION_WORDS, ...jsLibraryCompletionWords(activeLibraries)];
    if (ownerDoc){
      ownerDoc._jsCompletionWords = completionWords;
      ownerDoc._nbJsLibraryBtn = jsLibraryBtn;
    }
    const jsLibraryPicker = buildJsLibraryPicker(bar, jsLibraryBtn, libraryKey, {
      onChange:(next) => {
        activeLibraries = next;
        completionWords.splice(0, completionWords.length, ...JS_RUN_COMPLETION_WORDS, ...jsLibraryCompletionWords(activeLibraries));
        if (ownerDoc){
          resetJsKernel(nbKernelId(ownerDoc));
          nbSetStatus(ownerDoc, "라이브러리가 바뀌어 JavaScript 커널을 재시작했어요.");
        }
      }
    });
    if (ownerDoc){
      ownerDoc._jsLibraryState = () => jsLibraryPicker.getState();
      if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
      ownerDoc.cleanupFns.push(() => {
        jsLibraryPicker.destroy();
        delete ownerDoc._jsLibraryState;
        delete ownerDoc._jsCompletionWords;
        delete ownerDoc._nbJsLibraryBtn;
      });
    }
  }
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);
  const tocPanel = document.createElement("div");
  tocPanel.className = "nbv-toc";
  tocPanel.hidden = true;
  const tocHead = document.createElement("div"); tocHead.className = "nbv-toc-head";
  const tocTitle = document.createElement("strong"); tocTitle.textContent = "목차";
  const tocClose = document.createElement("button"); tocClose.type = "button"; tocClose.textContent = "×"; tocClose.title = "목차 닫기";
  tocHead.append(tocTitle, tocClose);
  const tocList = document.createElement("div"); tocList.className = "nbv-toc-list";
  tocPanel.append(tocHead, tocList);
  root.appendChild(tocPanel);
  const positionTocBelowBar = () => {
    const height = Math.ceil(bar.getBoundingClientRect().height || bar.offsetHeight || 50);
    tocPanel.style.top = (height + 4) + "px";
  };
  const setTocOpen = open => {
    tocPanel.hidden = !open;
    tocBtn.setAttribute("aria-expanded", String(open));
    if (open){
      positionTocBelowBar();
      nbRefreshToc(ownerDoc);
    }
  };
  tocBtn.addEventListener("click", () => setTocOpen(tocPanel.hidden));
  tocClose.addEventListener("click", () => setTocOpen(false));
  const onDocClickToc = event => {
    if (tocPanel.hidden || tocPanel.contains(event.target) || tocBtn.contains(event.target)) return;
    setTocOpen(false);
  };
  const onDocKeydownToc = event => {
    if (event.key === "Escape" && !tocPanel.hidden) setTocOpen(false);
  };
  document.addEventListener("click", onDocClickToc);
  document.addEventListener("keydown", onDocKeydownToc, true);
  let tocResizeObserver = null;
  const onWindowResizeToc = () => { if (!tocPanel.hidden) positionTocBelowBar(); };
  if (typeof ResizeObserver === "function"){
    tocResizeObserver = new ResizeObserver(onWindowResizeToc);
    tocResizeObserver.observe(bar);
  } else if (typeof window !== "undefined"){
    window.addEventListener("resize", onWindowResizeToc);
  }
  if (ownerDoc){
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      document.removeEventListener("click", onDocClickToc);
      document.removeEventListener("keydown", onDocKeydownToc, true);
      if (tocResizeObserver) tocResizeObserver.disconnect();
      else if (typeof window !== "undefined") window.removeEventListener("resize", onWindowResizeToc);
    });
  }
  const inkToolbar = nbBuildInkToolbar(ownerDoc);
  root.appendChild(inkToolbar);
  const helpOverlay = nbBuildShortcutSheet(ownerDoc);
  root.appendChild(helpOverlay);
  if (ownerDoc){ ownerDoc._nbHelpOverlay = helpOverlay; ownerDoc._nbHelpButton = helpBtn; }
  if (ownerDoc) root.appendChild(nbBuildFindPanel(ownerDoc));
  if (ownerDoc){
    ownerDoc._nbRoot = root;
    ownerDoc._nbFontHost = root;
    root.__refreshFontMetrics = () => {
      requestAnimationFrame(() => {
        for (const ctrl of (ownerDoc._nbCtrls || [])){
          if (ctrl.editor) fitEditorHeight(ctrl.editor);
          else if (typeof ctrl.refitEditor === "function") ctrl.refitEditor();   // 마크다운 셀 원문 textarea
        }
      });
    };
    registerEditorFont(root);
    ownerDoc._nbStatusEl = status;
    ownerDoc._nbBusy = false;
    ownerDoc._nbCancelRequested = false;
    ownerDoc._nbActiveTask = null;
    ownerDoc._nbRunAllActive = false;
    ownerDoc._nbRunAllBtn = runAllBtn;
    ownerDoc._nbRunGroup = runGroup;
    ownerDoc._nbKernelTag = tag;
    ownerDoc._nbLocalKernelBtn = localKernelBtn;
    ownerDoc._nbLocalRunBtn = localRunBtn;
    ownerDoc._nbUndoBtn = undoBtn;
    ownerDoc._nbRedoBtn = redoBtn;
    ownerDoc._nbTocButton = tocBtn;
    ownerDoc._nbTocList = tocList;
    ownerDoc._nbInkButton = inkBtn;
    ownerDoc._nbInkToolbar = inkToolbar;
    nbRefreshKernelModeUi(ownerDoc);
    const onNotebookLanguageChange = () => {
      nbRefreshKernelModeUi(ownerDoc);
      nbRefreshExecutionStates(ownerDoc);
      for (const ctrl of ownerDoc._nbCtrls || []){
        if (ctrl && typeof ctrl.syncOutputCollapsed === "function") ctrl.syncOutputCollapsed();
      }
    };
    window.addEventListener("mni18nchange", onNotebookLanguageChange);
    ownerDoc.cleanupFns.push(() => window.removeEventListener("mni18nchange", onNotebookLanguageChange));
  }

  // ── 셀 목록 ──
  const cellsWrap = document.createElement("div");
  cellsWrap.className = "nbv-cells";
  if (ownerDoc) ownerDoc._nbCellsWrap = cellsWrap;
  (model.cells || []).forEach((cell) => {
    const ctrl = nbBuildCell(ownerDoc, cell);
    cellsWrap.appendChild(ctrl.cellEl);
    ctrls.push(ctrl);
  });
  root.appendChild(cellsWrap);

  // 맨 아래 셀 추가 버튼(빈 노트북에서도 시작 가능)
  const footer = document.createElement("div");
  footer.className = "nbv-footer";
  const addBtn = (label, type) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    b.addEventListener("click", () => nbInsertCell(ownerDoc, (ownerDoc._nbCtrls || []).length - 1, type, { where: "below", edit: true }));
    return b;
  };
  footer.append(addBtn("＋ 코드 셀", "code"), addBtn("＋ 마크다운", "markdown"));
  root.appendChild(footer);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") { window.MNI18N.translateTree(tocPanel); window.MNI18N.translateTree(footer); }

  // 키보드: 명령/편집 모드 (저장·실행·셀 조작) — 캡처 단계에서 에디터보다 먼저 처리
  root.addEventListener("keydown", (e) => nbOnKeydown(ownerDoc, e), true);
  if (typeof syncShortcutHints === "function") syncShortcutHints(root);

  host.appendChild(root);
  if (ownerDoc){
    ownerDoc._nbSelected = -1;
    ownerDoc._nbCellSelection = new Set();
    ownerDoc._nbSelectionAnchor = null;
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function" && typeof MutationObserver === "function"){
      const pending = new Set();
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        for (const node of pending){
          if (node && node.isConnected) window.MNI18N.translateTree(node);
        }
        pending.clear();
      };
      const observer = new MutationObserver(records => {
        for (const record of records){
          for (const node of record.addedNodes){
            const target = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            if (target && target.nodeType === Node.ELEMENT_NODE) pending.add(target);
          }
        }
        if (!scheduled && pending.size){
          scheduled = true;
          Promise.resolve().then(flush);
        }
      });
      observer.observe(root, { childList:true, subtree:true });
      if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
      ownerDoc.cleanupFns.push(() => observer.disconnect());
    }
  }

  // 닫을 때 모든 셀 에디터 정리(메모리 회수) + 커널 네임스페이스 비우기
  if (ownerDoc && !ownerDoc._nbCleanupRegistered){
    ownerDoc._nbCleanupRegistered = true;
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      clearTimeout(ownerDoc._nbRecoveryTimer);
      if (ownerDoc.hasUnsavedEdits) notebookSaveRecovery(ownerDoc);
      nbToggleShortcutSheet(ownerDoc, false);
      destroyNotebook(ownerDoc);
    });
    ownerDoc.cleanupFns.push(() => {
      try { Promise.resolve(nbResetKernel(ownerDoc)).catch(() => {}); } catch(e){}
    });
  }
  if (ownerDoc){
    updateNbSaveButton(ownerDoc, saveBtn);
    ownerDoc._nbSaveBtn = saveBtn;
    ownerDoc._nbFreshRunBtn = restartRunBtn;
    nbRefreshExecutionStates(ownerDoc);
    nbUpdateHistoryButtons(ownerDoc);
    nbRefreshToc(ownerDoc);
    setTimeout(() => notebookOfferRecovery(ownerDoc), 0);
  }
}

// ── 셀 실행(Phase 3): 기존 Pyodide 커널을 셀에 연결. 같은 kernelId 로 변수·상태가 셀 간 누적된다. ──
function nbKernelId(ownerDoc){ return "nbv:" + (ownerDoc && ownerDoc.id != null ? ownerDoc.id : "default"); }
// 이 노트북이 자바스크립트인지 — .ipynb metadata 를 보고 실행기·강조·커널을 고른다.
function nbIsJavascript(ownerDoc){
  return notebookLanguageOf(ownerDoc && ownerDoc.notebookModel) === "javascript";
}
// 커널 재시작 — 언어에 맞는 커널을 끊는다(둘 다 변수가 사라지는 건 같다).
function nbResetKernel(ownerDoc){
  if (nbIsJavascript(ownerDoc)){ resetJsKernel(nbKernelId(ownerDoc)); return Promise.resolve(); }
  return startPyodideKernelRun({ kernelId:nbKernelId(ownerDoc), reset:true }).promise;
}

function nbSetStatus(ownerDoc, msg){
  if (ownerDoc && ownerDoc._nbStatusEl) ownerDoc._nbStatusEl.textContent = nbT(msg || "");
}

function notebookExecutionControlState(running, cancelRequested){
  return running
    ? {
        label:"■",
        title:"현재 셀 실행과 남은 전체 실행을 중지",
        disabled:!!cancelRequested
      }
    : {
        label:"전체 실행",
        title:"모든 코드 셀을 위에서부터 차례로 실행",
        disabled:false
      };
}

function nbSetRunningUi(ownerDoc, running){
  if (!ownerDoc) return;
  const btn = ownerDoc._nbRunAllBtn;
  if (btn){
    const state = notebookExecutionControlState(running, ownerDoc._nbCancelRequested);
    btn.textContent = nbT(state.label);
    btn.title = nbT(state.title);
    btn.disabled = state.disabled;
    btn.setAttribute("aria-label", btn.title);
  }
  if (ownerDoc._nbRunGroup) ownerDoc._nbRunGroup.classList.toggle("is-running", !!running);
  if (ownerDoc._nbRunMoreBtn) ownerDoc._nbRunMoreBtn.disabled = !!running;
  if (ownerDoc._nbJsLibraryBtn) ownerDoc._nbJsLibraryBtn.disabled = !!running;
}

function nbCancellationError(){
  const error = new Error("노트북 실행을 중지했습니다.");
  error.code = "worker-cancel";
  return error;
}

function nbThrowIfCancelled(ownerDoc){
  if (ownerDoc && ownerDoc._nbCancelRequested) throw nbCancellationError();
}

function nbStopExecution(ownerDoc){
  if (!ownerDoc || (!ownerDoc._nbBusy && !ownerDoc._nbRunAllActive) || ownerDoc._nbCancelRequested) return;
  ownerDoc._nbCancelRequested = true;
  nbSetStatus(ownerDoc, "중지 요청 중…");
  nbSetRunningUi(ownerDoc, true);
  const task = ownerDoc._nbActiveTask;
  if (task && typeof task.cancel === "function"){
    try { task.cancel(); } catch(_){}
  }
}

const NB_EXEC_STATE_LABELS = {
  fresh:"최신",
  stale:"재실행",
  error:"오류",
  never:"미실행",
  unknown:"확인",
  blank:""
};

function nbUpdateOutputFreshness(ctrl, state){
  if (!ctrl || !ctrl.outWrap) return;
  const old = ctrl.outWrap.querySelector(".nbv-out-freshness");
  if (state.status !== "stale"){
    if (old) old.remove();
    return;
  }
  const note = old || document.createElement("div");
  note.className = "nbv-out-freshness";
  note.textContent = nbT("⚠ 수정 전 상태의 실행 결과입니다. ") + nbT(state.reason || "");
  if (!old) ctrl.outWrap.insertBefore(note, ctrl.outWrap.firstChild);
}

function nbApplyExecutionState(ctrl, state){
  if (!ctrl || ctrl.type !== "code") return;
  ctrl.execState = state;
  if (ctrl.runBtn && ctrl.runBtn.classList.contains("is-running")) return;   // 실행 중엔 정지(■) 표시를 유지
  ctrl.cellEl.dataset.execState = state.status;
  if (ctrl.stateLabel){
    const label = NB_EXEC_STATE_LABELS[state.status] || "";
    ctrl.stateLabel.textContent = typeof window !== "undefined" && typeof window.t === "function" ? window.t(label) : label;
    ctrl.stateLabel.title = nbT(state.reason || "");
  }
  if (ctrl.runBtn){
    ctrl.runBtn.title = nbT(state.reason || "") + "\n" + nbT("이 셀 실행 (Ctrl+Enter · Shift+Enter=실행 후 다음)");
  }
  nbUpdateOutputFreshness(ctrl, state);
}

function nbRefreshExecutionStates(ownerDoc){
  if (!ownerDoc || !ownerDoc.notebookModel) return [];
  const states = [];
  let staleCount = 0;
  for (const ctrl of (ownerDoc._nbCtrls || [])){
    if (ctrl.type !== "code") continue;
    const state = notebookCellExecutionState(ownerDoc.notebookModel, ctrl.cell);
    states.push(state);
    if (state.status === "stale") staleCount++;
    nbApplyExecutionState(ctrl, state);
  }
  const btn = ownerDoc._nbFreshRunBtn;
  if (btn){
    btn.classList.toggle("has-stale", staleCount > 0);
    btn.textContent = staleCount > 0
      ? (typeof window !== "undefined" && typeof window.tf === "function"
        ? window.tf("최신 상태로 실행 ({n})", { n:staleCount }) : "최신 상태로 실행 (" + staleCount + ")")
      : (typeof window !== "undefined" && window.t ? window.t("재시작 후 실행") : "재시작 후 실행");
    btn.title = nbT(staleCount > 0
      ? "커널을 비우고 모든 셀을 위에서부터 실행해 오래된 결과를 최신 상태로 맞춥니다."
      : "커널을 재시작한 뒤 모든 셀을 처음부터 실행");
  }
  // ▾ 메뉴는 접혀 있어도 stale 알림이 보이도록 더보기 버튼에 뱃지를 켠다.
  if (ownerDoc._nbRunMoreBtn) ownerDoc._nbRunMoreBtn.classList.toggle("has-stale", staleCount > 0);
  return states;
}

function nbScheduleExecutionStateRefresh(ownerDoc){
  if (!ownerDoc || ownerDoc._nbStateRefresh) return;
  if (typeof requestAnimationFrame !== "function"){
    nbRefreshExecutionStates(ownerDoc);
    return;
  }
  ownerDoc._nbStateRefresh = requestAnimationFrame(() => {
    ownerDoc._nbStateRefresh = 0;
    nbRefreshExecutionStates(ownerDoc);
  });
}

// 실행 버튼(거터)의 표시 갱신: 대기 [ ]/[n] · 실행 중 [*]
function setRunState(ctrl, state){
  const c = ctrl.cell;
  const running = state === "running";
  // 실행 중에는 실행 버튼을 정지(■) 버튼으로 바꿔, 누른 자리에서 바로 멈출 수 있게 한다.
  const count = running ? "■" : (c.execCount != null ? "[" + c.execCount + "]" : "[ ]");
  if (ctrl.runCount) ctrl.runCount.textContent = count;
  else ctrl.runBtn.textContent = count;
  ctrl.runBtn.classList.toggle("is-running", running);
  ctrl.runBtn.title = nbT(running
    ? "실행 중지 (클릭)"
    : "이 셀 실행 (Ctrl+Enter · Shift+Enter=실행 후 다음)");
  ctrl.runBtn.setAttribute("aria-label", nbT(running ? "실행 중지" : "이 셀 실행"));
  if (running && ctrl.stateLabel){
    ctrl.stateLabel.textContent = nbT("중지");
    ctrl.cellEl.dataset.execState = "running";
  }
}

function notebookVariables(value){
  if (typeof normalizePythonVariables === "function"){
    const count = Array.isArray(value) ? value.length : 0;
    return normalizePythonVariables(value, Math.max(1, count), 600);
  }
  const rows = [];
  for (const item of (Array.isArray(value) ? value : [])){
    const name = String(item && item.name || "");
    if (!name || name.charAt(0) === "_") continue;
    const row = {
      name:name.slice(0, 100),
      type:String(item && item.type || "").slice(0, 80),
      value:String(item && item.value == null ? "" : item.value).slice(0, 1200)
    };
    if (item && item.lazy != null) row.lazy = !!item.lazy;
    rows.push(row);
  }
  return rows;
}

async function notebookLookupVariable(ownerDoc, name){
  if (!ownerDoc || typeof startPyodideKernelVariableLookup !== "function") return null;
  const task = startPyodideKernelVariableLookup({
    kernelId:nbKernelId(ownerDoc),
    variableName:name
  });
  const result = await task.promise;
  return notebookVariables(result && result.variable ? [result.variable] : [])[0] || null;
}

// 변수 이름·자료형·shape만 먼저 그리고, 펼칠 때 현재 커널에서 값 또는 DataFrame 표를 가져온다.
function nbBuildVarRow(item, sanitizer, lookupVariable){
  const box = document.createElement("details"); box.className = "nbv-vars-df nbv-vars-item";
  const sm = document.createElement("summary"); sm.className = "nbv-vars-df-summary";
  const nm = document.createElement("code"); nm.className = "nbv-vars-name"; nm.textContent = item.name;
  const meta = document.createElement("span"); meta.className = "nbv-vars-type";
  const updateMeta = (value) => {
    meta.textContent = value.type + (value.shape ? " · " + value.shape : "");
  };
  updateMeta(item);
  sm.append(nm, meta);
  const body = document.createElement("div");
  body.className = "nbv-vars-live";
  box.append(sm, body);
  let loaded = false, loading = false;
  const renderValue = (value) => {
    body.textContent = "";
    updateMeta(value);
    if (value.html && sanitizer){
      const tableWrap = document.createElement("div");
      tableWrap.className = "nbv-out-html nbv-vars-df-table";
      tableWrap.innerHTML = sanitizer(value.html);
      body.appendChild(tableWrap);
      if (value.tableNote){
        const note = document.createElement("div");
        note.className = "nbv-vars-df-note";
        note.textContent = value.tableNote;
        body.appendChild(note);
      }
      return;
    }
    const current = document.createElement("code");
    current.className = "nbv-vars-value nbv-vars-live-value";
    current.textContent = value.value;
    body.appendChild(current);
  };
  if (!item.lazy){
    loaded = true;
    renderValue(item);
  } else {
    body.textContent = nbT("펼치면 현재 커널 값을 불러옵니다.");
    box.addEventListener("toggle", async () => {
      if (!box.open){
        loaded = false;
        return;
      }
      if (loaded || loading) return;
      loading = true;
      body.textContent = nbT("현재 커널 값 불러오는 중…");
      try {
        const value = await lookupVariable(item.name);
        if (!value) body.textContent = nbT("현재 커널에 이 변수가 없습니다.");
        else {
          renderValue(value);
          loaded = true;
        }
      } catch(e){
        body.textContent = nbTf("값을 불러오지 못했습니다: {message}", { message:(e && e.message) ? e.message : e });
      } finally {
        loading = false;
      }
    });
  }
  return box;
}

// 커널은 셀 간 변수를 공유한다. 각 셀 아래에는 그 셀 실행 직후 커널에 누적된 변수를 모두 보여 준다.
function renderNotebookVariables(host, variables, ownerDoc){
  const rows = notebookVariables(variables);
  if (!rows.length) return;
  const sanitizer = (typeof ClassDockCore !== "undefined" && ClassDockCore && typeof ClassDockCore.sanitizeHtml === "function")
    ? ClassDockCore.sanitizeHtml : null;
  const details = document.createElement("details");
  details.className = "nbv-vars";
  const summary = document.createElement("summary");
  summary.textContent = nbTf("변수 {n}개 (현재 셀까지 · 펼치면 현재 값)", { n:rows.length });
  const search = document.createElement("input");
  search.type = "search";
  search.className = "nbv-vars-search";
  search.placeholder = nbT("변수 이름·자료형 검색");
  search.setAttribute("aria-label", nbT("변수 검색"));
  const table = document.createElement("div");
  table.className = "nbv-vars-table";
  const rendered = [];
  const lookupVariable = (name) => notebookLookupVariable(ownerDoc, name);
  for (const item of rows){
    const row = nbBuildVarRow(item, sanitizer, lookupVariable);
    rendered.push({ item, row });
    table.appendChild(row);
  }
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const entry of rendered){
      const haystack = (entry.item.name + " " + entry.item.type + " " + (entry.item.shape || "")).toLocaleLowerCase();
      entry.row.hidden = !!query && !haystack.includes(query);
    }
  });
  details.append(summary);
  if (rows.length > 12) details.append(search);
  details.append(table);
  host.appendChild(details);
}

// 셀 실행에 걸린 시간을 사람이 읽기 좋은 짧은 문구로 바꾼다(1초 미만은 밀리초).
function notebookElapsedText(ms){
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return nbTf("실행 {n}밀리초", { n:Math.round(value) });
  if (value < 60000) return nbTf("실행 {seconds}초", { seconds:(value / 1000).toFixed(value < 10000 ? 1 : 0) });
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return nbTf("실행 {minutes}분 {seconds}초", { minutes, seconds });
}

// 커널 결과(stdout/stderr/images)를 셀 바로 아래 인라인으로 그린다(빈 출력이면 표시 안 함, 재실행 시 교체).
function renderRunResult(ctrl, result){
  const out = (result && result.stdout) ? String(result.stdout).replace(/\n+$/, "") : "";
  const err = (result && result.stderr) ? String(result.stderr).replace(/\n+$/, "") : "";
  const images = (result && result.images) || [];
  const richOutputs = parseNbOutputs((result && result.richOutputs) || []);
  const outputs = (result && result.outputs) || [];
  const variables = notebookVariables(result && result.variables);
  if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
  if (!notebookCellHasExecutableSource(ctrl && ctrl.cell)) return;
  if (!out && !err && !images.length && !richOutputs.length && !outputs.length && !variables.length) return;
  const wrap = document.createElement("div");
  wrap.className = "nbv-out";
  if (out){ const p = document.createElement("pre"); p.className = "nbv-out-text"; p.textContent = out; wrap.appendChild(p); }
  if (richOutputs.length) renderCellOutputs(richOutputs, wrap, ctrl);
  for (let i = 0; i < images.length; i++){
    const im = document.createElement("img"); im.className = "nbv-out-img"; im.src = images[i];
    im.alt = "그래프 " + (i + 1); im.title = "클릭하면 크게 보기"; im.tabIndex = 0;
    wrap.appendChild(im);
  }
  if (outputs.length){
    const files = document.createElement("div"); files.className = "nbv-out-files";
    const title = document.createElement("strong"); title.textContent = nbTf("생성·변경 파일 {n}개", { n:outputs.length });
    files.appendChild(title);
    for (const output of outputs.slice(0, 20)){
      const row = document.createElement("div"); row.className = "nbv-out-file";
      const full = String(output.name || "output.dat");
      const base = full.split("/").pop() || "file";
      const name = document.createElement("span"); name.className = "of-name"; name.textContent = full;
      const size = document.createElement("span"); size.className = "of-size"; size.textContent = humanSize(Number(output.size) || 0);
      row.append(name, size);
      if (output.bytes){                                 // 실행 시점에 채워진 파일 바이트(브라우저·로컬 커널 공통)
        const dl = document.createElement("a"); dl.className = "of-btn"; dl.textContent = "⬇ 저장";
        dl.setAttribute("download", base); dl.href = URL.createObjectURL(new Blob([output.bytes]));
        const open = document.createElement("button"); open.type = "button"; open.className = "of-btn"; open.textContent = "열기";
        open.addEventListener("click", () => handleFiles([new File([output.bytes], base)]));   // 앱 뷰어로 열기
        row.append(dl, open);
      } else {                                           // 20MB 초과 등으로 바이트 미수집
        const note = document.createElement("span"); note.className = "of-size"; note.textContent = nbTf("(너무 커서 미리 못 받음)");
        row.append(note);
      }
      files.appendChild(row);
    }
    wrap.appendChild(files);
  }
  renderNotebookVariables(wrap, variables, ctrl.ownerDoc);
  if (err) renderNotebookStderr(wrap, err, ctrl, result && result.ok === false ? false : (result && result.code));
  const elapsedText = notebookElapsedText(result && result.elapsedMs);
  if (elapsedText){
    const time = document.createElement("div");
    time.className = "nbv-out-time";
    time.textContent = "⏱ " + elapsedText;
    wrap.appendChild(time);
  }
  nbAttachOutputToggle(ctrl.ownerDoc, ctrl, wrap);
  ctrl.body.appendChild(wrap);
  ctrl.outWrap = wrap;
}

async function nbRunCell(ownerDoc, ctrl, advance, runOptions){
  runOptions = runOptions || {};
  if (!ownerDoc || ownerDoc._nbBusy || ownerDoc._nbLocalRunActive ||
      (ownerDoc._nbRunAllActive && !runOptions.runAll)) return null;
  if (!runOptions.runAll) ownerDoc._nbCancelRequested = false;
  const cell = ctrl.cell;
  if (ctrl.editor) cell.source = ctrl.editor.getValue();   // 마운트된 경우만 동기화(정적 셀은 cell.source 그대로)
  if (ctrl.refreshStdin) ctrl.refreshStdin();
  if (ctrl.prepareStdin && !ctrl.prepareStdin()) return { ok:false, pendingInput:true };
  if (ownerDoc._nbKernelMode !== "local" && notebookRequiresLocalPython(cell.source)){
    let backend = false;
    try { backend = await pythonBackendAvailable(); } catch(_){ backend = false; }
    ownerDoc._nbLocalPythonAvailable = !!backend;
    nbRefreshKernelModeUi(ownerDoc);
    if (!backend) nbShowLocalPythonInstallGuide(ownerDoc);
    else {
      const message = "Selenium 크롤링은 브라우저 Python에서 실행할 수 없습니다. 전체 실행 옆 ▾에서 '로컬 Python 셀 커널 사용'을 선택해 주세요.";
      if (typeof toast === "function") toast(message, 6500);
      nbSetStatus(ownerDoc, "Selenium 실행에는 로컬 Python 셀 커널이 필요해요.");
    }
    return { ok:false, requiresLocalPython:true, backendAvailable:backend };
  }
  const executionSnapshot = {
    source_hash:notebookExecutionHash(cell.source),
    upstream_hash:notebookUpstreamHash(ownerDoc.notebookModel, cell)
  };
  ownerDoc._nbBusy = true;
  nbSetRunningUi(ownerDoc, true);
  setRunState(ctrl, "running");
  const onMsg = (m) => nbSetStatus(ownerDoc, m);
  let result = null;
  try {
    // 자바스크립트 노트북은 브라우저 워커 커널 하나로 끝난다 —
    // 로컬 Python·패키지 준비·작업폴더 번들이 모두 해당 없으므로 그 준비 과정을 건너뛴다.
    const jsNotebook = nbIsJavascript(ownerDoc);
    const localKernel = !jsNotebook && ownerDoc._nbKernelMode === "local";
    let workspaceBundle = null;
    let workspaceSync = null;
    if (!jsNotebook) try {
      workspaceBundle = await buildNotebookWorkspaceBundle(ownerDoc);
      nbThrowIfCancelled(ownerDoc);
      if (!localKernel){
        workspaceSync = await buildNotebookCellWorkspaceSync(ownerDoc, cell);
        nbThrowIfCancelled(ownerDoc);
      }
      if (workspaceBundle) nbSetStatus(ownerDoc, "노트북 작업폴더 준비 중…");
    } catch(e){
      nbSetStatus(ownerDoc, nbTf("작업폴더 준비 오류: {message}", { message:(e && e.message) ? e.message : e }));
      throw e;
    }
    const workspaceCwd = jsNotebook ? "" : notebookCellWorkspaceCwd(ownerDoc, cell, workspaceBundle);
    let task;
    if (jsNotebook){
      nbSetStatus(ownerDoc, nbTf("셀 실행 중… · {kernel}", { kernel:nbT("브라우저 자바스크립트") }));
      let libraries = [];
      if (typeof prepareJsLibrarySources === "function" && typeof ownerDoc._jsLibraryState === "function"){
        nbSetStatus(ownerDoc, "JavaScript 라이브러리 준비 중…");
        libraries = await prepareJsLibrarySources(ownerDoc._jsLibraryState());
        nbThrowIfCancelled(ownerDoc);
        nbSetStatus(ownerDoc, nbTf("셀 실행 중… · {kernel}", { kernel:nbT("브라우저 자바스크립트") }));
      }
      task = startJsKernelRun({
        kernelId:nbKernelId(ownerDoc),
        source:cell.source,
        stdin:ctrl.stdinText ? ctrl.stdinText() : "",
        userFile:"cell.js",
        libraries
      });
    } else if (localKernel){
      nbSetStatus(ownerDoc, nbTf("셀 실행 중… · {kernel} · 기준 {cwd}", { kernel:nbT("로컬 Python"), cwd:workspaceCwd || "." }));
      task = startLocalNotebookKernelRun(
        ownerDoc,
        cell.source,
        ctrl.stdinText ? ctrl.stdinText() : "",
        workspaceBundle
      );
    } else {
      let packages = { urls: [], names: [] };
      try {
        packages = await preparePyodideWorkerPackages(
          cell.source,
          onMsg,
          notebookWorkspaceImports(workspaceBundle)
        );
        nbThrowIfCancelled(ownerDoc);
      }
      catch(e){
        const message = (e && e.message) ? e.message : "패키지 설치를 취소했어요.";
        nbSetStatus(ownerDoc, message);
        throw new Error(message);
      }
      await ensurePyodideWorker(onMsg);
      nbThrowIfCancelled(ownerDoc);
      nbSetStatus(ownerDoc, nbTf("셀 실행 중… · {kernel} · 기준 {cwd}", { kernel:nbT("브라우저"), cwd:workspaceCwd || "." }));
      task = startPyodideKernelRun({
        kernelId:nbKernelId(ownerDoc),
        source:cell.source,
        stdin:ctrl.stdinText ? ctrl.stdinText() : "",
        packages,
        workspaceBundle,
        workspaceSync,
        workspaceCwd,
        onMsg
      });
    }
    ownerDoc._nbActiveTask = task;
    if (ownerDoc._nbCancelRequested) task.cancel();
    const runClock = (typeof performance !== "undefined" && performance.now) ? performance : Date;
    const runStartedAt = runClock.now();
    result = await task.promise;
    if (result && typeof result === "object") result.elapsedMs = runClock.now() - runStartedAt;
    nbThrowIfCancelled(ownerDoc);
    // 로컬 커널: 누락 모듈(ModuleNotFoundError)이면 pip 로 설치하고 새 커널을 만든 뒤 자동 재실행한다
    // (단일 .py 파일 실행과 동일한 편의 — 브라우저 커널은 preparePyodideWorkerPackages 가 미리 챙김).
    if (localKernel){
      const tried = new Set();
      while (result && result.ok === false){
        const missing = detectMissingModule(result.stderr);
        if (!missing || tried.has(missing) || tried.size >= 6 || bundleHasLocalModule(workspaceBundle, missing)) break;
        tried.add(missing);
        const installed = await nbInstallMissingModule(ownerDoc, importToPip(missing));
        nbThrowIfCancelled(ownerDoc);
        if (!installed) break;
        nbSetStatus(ownerDoc, nbTf("셀 실행 중… · {kernel} · 기준 {cwd}", { kernel:nbT("로컬 Python"), cwd:workspaceCwd || "." }));
        const retryTask = startLocalNotebookKernelRun(
          ownerDoc, cell.source, ctrl.stdinText ? ctrl.stdinText() : "", workspaceBundle
        );
        ownerDoc._nbActiveTask = retryTask;
        if (ownerDoc._nbCancelRequested) retryTask.cancel();
        const retryStartedAt = runClock.now();
        result = await retryTask.promise;
        if (result && typeof result === "object") result.elapsedMs = runClock.now() - retryStartedAt;
        nbThrowIfCancelled(ownerDoc);
      }
    }
    const outputBundle = workspaceBundle
      ? { ...workspaceBundle, cwd:workspaceCwd,
          logicalRoot:workspaceBundle.logicalRoot || "" }
      : null;
    const remembered = await rememberRunOutputs(
      notebookRunContext(ownerDoc),
      outputBundle,
      result.outputs || [],
      null
    );
    if (workspaceBundle && result.outputs && result.outputs.length){
      const byPath = new Map(workspaceBundle.files.map(file => [normalizedRunPath(file.path), file]));
      for (const output of result.outputs){
        if (!output.bytes) continue;
        const path = normalizedRunPath(output.name);
        if (path) byPath.set(path, { path, bytes:new Uint8Array(output.bytes) });
      }
      workspaceBundle.files = Array.from(byPath.values());
    }
    ownerDoc._nbExec = (ownerDoc._nbExec || 0) + 1;
    cell.execCount = ownerDoc._nbExec;
    cell.rawOutputs = notebookResultToRawOutputs(result, cell.execCount);
    cell.outputs = parseNbOutputs(cell.rawOutputs);
    cell.variables = notebookCellHasExecutableSource(cell) ? notebookVariables(result.variables) : [];
    notebookRecordExecution(ownerDoc.notebookModel, cell, result.ok !== false, executionSnapshot);
    renderRunResult(ctrl, result);
    setRunState(ctrl, "done");
    markNbDirty(ownerDoc);
    nbRefreshExecutionStates(ownerDoc);
    const elapsedText = notebookElapsedText(result.elapsedMs);
    const kernelName = nbT(jsNotebook ? "브라우저 자바스크립트" : localKernel ? "로컬 Python" : "브라우저");
    nbSetStatus(ownerDoc, result.ok === false
      ? nbTf("오류 · {kernel} · 기준 {cwd} · 커널 유지{elapsed}", { kernel:kernelName, cwd:workspaceCwd || ".", elapsed:elapsedText ? " · " + elapsedText : "" })
      : nbTf("완료{warning} · {kernel} · 기준 {cwd}{files}{elapsed}", {
        warning:result.stderr ? nbT("(경고 있음)") : "", kernel:kernelName, cwd:workspaceCwd || ".",
        files:remembered.count ? " · " + nbTf("파일 {n}개 저장", { n:remembered.count }) : "",
        elapsed:elapsedText ? " · " + elapsedText : ""
      }));
  } catch(e){
    const message = (e && e.message) ? e.message : String(e);
    const cancelled = !!ownerDoc._nbCancelRequested || (e && e.code === "worker-cancel");
    result = { ok:false, cancelled, code:cancelled ? -1 : 1, error:message, stdout:"", stderr:cancelled ? "" : message, images:[], outputs:[] };
    if (cancelled){
      ownerDoc._nbWorkspacePromise = null;
      nbSetStatus(ownerDoc, nbTf("중지됨 · {kernel} 커널 초기화됨", { kernel:nbT(ownerDoc._nbKernelMode === "local" ? "로컬 Python" : "브라우저") }));
    } else if (/could not be read|NotReadableError|permission problems that have occurred/i.test(message)){
      // 폴더에서 온 File 스냅샷이 만료됨(파일이 디스크에서 바뀌었거나 권한 만료) — 캐시를 비워 다음 실행에서 다시 읽게 하고,
      // 재획득이 불가능한 경우(핸들 없는 드래그드롭 등)를 대비해 폴더를 다시 열라고 안내한다.
      ownerDoc._nbWorkspacePromise = null;
      nbSetStatus(ownerDoc, "작업폴더 파일을 다시 읽지 못했어요(파일이 바뀌었거나 권한이 만료됨). 폴더를 다시 열고 실행해 주세요.");
    } else {
      nbSetStatus(ownerDoc, nbTf("실행 오류: {message}", { message }));
    }
    setRunState(ctrl, "idle");
    nbRefreshExecutionStates(ownerDoc);   // 정지/오류 후 버튼·상태 라벨을 실제 실행 상태로 되돌린다
  } finally {
    ownerDoc._nbActiveTask = null;
    ownerDoc._nbBusy = false;
    if (!runOptions.runAll){
      ownerDoc._nbCancelRequested = false;
      nbSetRunningUi(ownerDoc, false);
    }
  }
  if (advance && !result.cancelled) nbFocusNextCode(ownerDoc, ctrl);
  return result;
}

async function nbRunAll(ownerDoc){
  if (!ownerDoc) return;
  const list = (ownerDoc._nbCtrls || []).filter(c => c.type === "code");
  return nbRunSequence(ownerDoc, list);
}

// 처음 셀부터 지정한 셀(포함)까지의 코드 셀만 순차 실행한다. 커널 상태(변수)는 그대로 유지한다.
async function nbRunUpTo(ownerDoc, ctrl){
  if (!ownerDoc) return;
  const ctrls = ownerDoc._nbCtrls || [];
  const end = ctrl ? ctrls.indexOf(ctrl) : ownerDoc._nbSelected;
  if (end < 0) return;
  const list = ctrls.slice(0, end + 1).filter(c => c.type === "code");
  if (!list.length){ nbSetStatus(ownerDoc, "여기까지 실행할 코드 셀이 없어요."); return; }
  return nbRunSequence(ownerDoc, list);
}

// 전체 실행·여기까지 실행이 공유하는 순차 실행 루프(중지·오류 중단·실행 UI 처리 포함).
async function nbRunSequence(ownerDoc, list){
  if (!ownerDoc || ownerDoc._nbBusy || ownerDoc._nbLocalRunActive ||
      ownerDoc._nbRunAllActive || !list || !list.length) return;
  ownerDoc._nbRunAllActive = true;
  ownerDoc._nbCancelRequested = false;
  try {
    for (const ctrl of list){
      if (ownerDoc._nbCancelRequested) break;
      const result = await nbRunCell(ownerDoc, ctrl, false, { runAll:true });
      if (!result || result.ok === false){
        if (result && result.cancelled) nbSetStatus(ownerDoc, "중지됨 · 남은 셀 실행 취소 · 커널 초기화됨");
        else if (result && result.pendingInput) nbSetStatus(ownerDoc, "입력값을 준비한 뒤 전체 실행을 다시 눌러 주세요.");
        else if (result && result.requiresLocalPython) { /* 앞에서 표시한 설치·전환 안내 유지 */ }
        else nbSetStatus(ownerDoc, "오류가 나서 전체 실행을 멈췄어요(커널은 유지).");
        break;
      }
    }
  } finally {
    const cancelled = !!ownerDoc._nbCancelRequested;
    ownerDoc._nbRunAllActive = false;
    ownerDoc._nbBusy = false;
    ownerDoc._nbActiveTask = null;
    ownerDoc._nbCancelRequested = false;
    nbSetRunningUi(ownerDoc, false);
    if (cancelled) nbSetStatus(ownerDoc, "중지됨 · 남은 셀 실행 취소 · 커널 초기화됨");
  }
}

async function nbRestartKernel(ownerDoc){
  if (!ownerDoc || ownerDoc._nbBusy || ownerDoc._nbLocalRunActive) return false;
  ownerDoc._nbBusy = true;
  try {
    if (!nbIsJavascript(ownerDoc) && ownerDoc._nbKernelMode === "local") await nbStopLocalNotebookKernel(ownerDoc);
    else await nbResetKernel(ownerDoc);
  } catch(e){
    nbSetStatus(ownerDoc, nbTf("커널 재시작 실패: {message}", { message:(e && e.message) ? e.message : e }));
    ownerDoc._nbBusy = false;
    return false;
  }
  ownerDoc._nbBusy = false;
  ownerDoc._nbExec = 0;
  ownerDoc._nbWorkspacePromise = null;
  let changed = false;
  for (const ctrl of (ownerDoc._nbCtrls || [])){
    if (ctrl.type !== "code") continue;
    if (ctrl.cell.execCount != null || (ctrl.cell.rawOutputs && ctrl.cell.rawOutputs.length) ||
        (ctrl.cell.metadata && ctrl.cell.metadata[NB_EXEC_META_KEY])) changed = true;
    ctrl.cell.execCount = null;
    ctrl.cell.rawOutputs = [];
    ctrl.cell.outputs = [];
    notebookClearExecution(ctrl.cell);
    if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
    setRunState(ctrl, "idle");
  }
  if (changed) markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
  nbSetStatus(ownerDoc, nbTf("{kernel} 커널 재시작됨 · 상태 초기화", { kernel:nbT(ownerDoc._nbKernelMode === "local" ? "로컬 Python" : "브라우저") }));
  return true;
}

// 커널 재시작 후 전체 실행
async function nbRestartRunAll(ownerDoc){
  if (!ownerDoc || ownerDoc._nbBusy) return;
  if (await nbRestartKernel(ownerDoc)) await nbRunAll(ownerDoc);
}

// 모든 셀의 출력만 지운다(변수·상태 유지)
function nbClearOutputs(ownerDoc){
  let changed = false;
  for (const ctrl of (ownerDoc._nbCtrls || [])){
    if (ctrl.type !== "code") continue;
    if (ctrl.cell.execCount != null || (ctrl.cell.rawOutputs && ctrl.cell.rawOutputs.length) ||
        (ctrl.cell.metadata && ctrl.cell.metadata[NB_EXEC_META_KEY])) changed = true;
    ctrl.cell.execCount = null;
    ctrl.cell.rawOutputs = [];
    ctrl.cell.outputs = [];
    notebookClearExecution(ctrl.cell);
    if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
    setRunState(ctrl, "idle");
  }
  if (changed) markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
  nbSetStatus(ownerDoc, "실행 결과를 지웠어요.");
}

// 한 코드 셀의 실행 결과만 비운다(변수·커널 상태는 유지). 셀 도구막대의 지우개 버튼에서 호출.
function nbClearCellOutput(ownerDoc, ctrl){
  if (!ctrl || ctrl.type !== "code") return;
  const cell = ctrl.cell;
  const had = cell.execCount != null || (cell.rawOutputs && cell.rawOutputs.length) ||
    (cell.outputs && cell.outputs.length) || (cell.metadata && cell.metadata[NB_EXEC_META_KEY]);
  if (!had){ if (typeof toast === "function") toast("이 셀에는 지울 출력이 없어요.", 1600); return; }
  cell.execCount = null;
  cell.rawOutputs = [];
  cell.outputs = [];
  notebookClearExecution(cell);
  if (ctrl.outWrap){ ctrl.outWrap.remove(); ctrl.outWrap = null; }
  setRunState(ctrl, "idle");
  markNbDirty(ownerDoc);
  nbRefreshExecutionStates(ownerDoc);
}

// 현재 노트북을 파이썬(.py)으로 변환해 새 탭으로 연다(기존 ipynbToPython 재사용).
function nbExportPy(ownerDoc){
  const model = ownerDoc && ownerDoc.notebookModel;
  if (!model) return;
  let pySrc;
  try { pySrc = (typeof ipynbToPython === "function") ? ipynbToPython(modelToIpynb(model), ownerDoc.name || "notebook.ipynb") : null; }
  catch(e){ nbSetStatus(ownerDoc, nbTf("내보내기 실패: {message}", { message:(e && e.message) || e })); return; }
  if (pySrc == null){ nbSetStatus(ownerDoc, "내보내기를 지원하지 않는 환경이에요."); return; }
  const pyName = String(ownerDoc.name || "notebook").replace(/\.ipynb$/i, "") + ".py";
  if (typeof handleFiles === "function") handleFiles([new File([pySrc], pyName, { type: "text/x-python" })], { isScratch: true });
  nbSetStatus(ownerDoc, nbTf("{name} 로 내보냈어요.", { name:pyName }));
}
