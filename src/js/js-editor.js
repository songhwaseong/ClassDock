"use strict";

// .js / .mjs 실행 화면. 파이썬 실행 화면과 같은 뼈대(실행 바 + 좌우 분할 + 출력 패널)를 쓰되,
// 파이썬 전용 도구(라이브러리·노트북·채점·단계 실행·터미널)가 빠진 최소 구성이다.
// 편집기·초안·저장·분할선은 파이썬 쪽 공용 함수를 그대로 재사용한다.

const JS_DRAFT_DELAY = 700;      // 편집이 멈춘 뒤 초안(localStorage) 저장까지 기다리는 시간
const JS_AUTOSAVE_DELAY = 3000;  // 편집이 멈춘 뒤 파일 자동 저장까지(텍스트 편집기와 같은 간격)
const JS_GRADE_PREFIX = "pdf-signer-js-grade:";   // 파일마다 채점 테스트를 저장하는 키(파이썬과 분리)

// ── 새 자바스크립트 파일 만들기 ─────────────────────────────────────────────
// 파이썬 스크래치와 같은 길을 쓴다(createScratchInFolder·handleFiles) — 폴더 문맥·이름 충돌 회피·
// 사이드바에서 바로 이름 고치기까지 그대로 따라온다.
function jsScratchStarter(){
  const prompt = typeof t === "function" ? t("여기에 자바스크립트 코드를 작성하고 ▶ 실행") : "여기에 자바스크립트 코드를 작성하고 ▶ 실행";
  return "// " + prompt + " (" + shortcutDisplay(shortcutValue("runCode")) + ")\nconsole.log(\"Hello, JavaScript!\");\n";
}
function jsScratchFileName(number = 1){
  const base = typeof window.t === "function" ? window.t("새 코드") : "새 코드";
  return base + (number > 1 ? " " + number : "") + ".js";
}
function createJsScratchInFolder(folder){
  return createScratchInFolder(folder, jsScratchFileName, jsScratchStarter,
    "text/javascript", "새 자바스크립트 파일을");
}
// 폴더 우클릭 → 이 폴더 안에 만들기
function newJsScratchInFolder(folder){
  _scratchCount++;                     // 이름 번호는 파이썬·표·메모와 한 통으로 센다(code-viewer.js)
  createJsScratchInFolder(folder);
}
// 사이드바 + 메뉴 → 지금 보고 있는 파일의 폴더가 있으면 그 안에, 없으면 그냥 새 문서로
function newJsScratch(){
  _scratchCount++;
  const folder = activeFolderContextForNewFile();
  if (folder && createJsScratchInFolder(folder)) return;
  handleFiles([new File([jsScratchStarter()], jsScratchFileName(_scratchCount), { type:"text/javascript" })], { isScratch:true });
}

function renderJsRunnable(context){
  const { outer, host, text, prof, ext, file, ownerDoc, runCtx, sourceBytes } = context;
  const saveName = (ownerDoc && ownerDoc.name) || (file && file.name) || "practice.js";
  const draftKey = pythonDraftKey(file, ownerDoc, runCtx);
  const fingerprint = fingerprintBytes((file && file.name) || "code.js", sourceBytes);
  const restoredDraft = loadPythonDraft(draftKey, fingerprint);

  const editor = buildCodeEditor(restoredDraft === null ? text : restoredDraft, prof, {
    // 파이썬 전용 지능(Jedi 질의·import 문맥·멤버 추론)을 끄고 확장자에 맞는 키워드를 쓴다.
    // 이걸 넘기지 않으면 .js 편집기가 파이썬 키워드로 완성하고, 로컬 Python 이 있으면
    // 파이썬 분석기(Jedi)에 자바스크립트 코드를 물어보게 된다.
    plain: true,
    fileExt: ext,
    completionWords: JS_RUN_COMPLETION_WORDS,
    // console. 처럼 점 뒤에서 무엇을 쓸 수 있는지 — 전역 카탈로그와 리터럴 추론으로 답한다.
    memberCandidates: (source, receiver, prefix) => jsMemberCompletionCandidates(source, receiver, prefix),
    // 우클릭 메뉴도 실행 바·단축키와 같은 진입점을 쓴다(메뉴를 열 때 평가되므로 아래 정의를 안전하게 참조).
    contextMenuActions: () => (typeof ui !== "undefined" && typeof ui.cancelRun === "function"
      ? [{ label:"■ 실행 중지", action:() => ui.cancelRun() }]
      : [{ label:"▶ 실행", action:() => run(true) }])
  });
  let savedValue = text;
  if (ownerDoc && typeof ownerDoc.savedText !== "string") ownerDoc.savedText = text;

  // ── 실행 바 ──
  const bar = document.createElement("div"); bar.className = "run-bar";
  const runBtn = document.createElement("button"); runBtn.className = "run-go"; runBtn.type = "button"; runBtn.textContent = "▶";
  runBtn.title = "실행";
  runBtn.dataset.shortcutAction = "runCode"; runBtn.dataset.shortcutTitle = "실행"; runBtn.dataset.shortcutAria = "true";
  const saveBtn = document.createElement("button"); saveBtn.className = "run-save"; saveBtn.type = "button";
  saveBtn.textContent = /\.mjs$/i.test(saveName) ? ".mjs 저장" : ".js 저장";
  saveBtn.dataset.shortcutAction = "saveCurrent"; saveBtn.dataset.shortcutTitle = "자바스크립트 파일 저장";
  const gradeBtn = document.createElement("button"); gradeBtn.className = "run-grade"; gradeBtn.type = "button";
  gradeBtn.textContent = "채점"; gradeBtn.title = "입력값과 기대 출력을 기준으로 현재 코드를 자동 채점";
  const revertBtn = document.createElement("button"); revertBtn.className = "run-revert"; revertBtn.type = "button";
  revertBtn.textContent = "↩ 원본"; revertBtn.title = "편집 전 원본 코드로 되돌리기"; revertBtn.disabled = true;
  const hideOutBtn = document.createElement("button"); hideOutBtn.className = "run-revert"; hideOutBtn.type = "button";
  hideOutBtn.textContent = "결과 숨기기"; hideOutBtn.title = "실행 결과 칸을 접고 편집기를 넓게 쓰기"; hideOutBtn.hidden = true;
  const status = document.createElement("span"); status.className = "run-status";
  bar.append(runBtn, gradeBtn, saveBtn, revertBtn, hideOutBtn, status);
  if (typeof syncShortcutHints === "function") syncShortcutHints(bar);

  // ── 입력값 칸: input()·prompt() 를 쓰는 코드에서만 보인다 ──
  const inputWrap = document.createElement("div"); inputWrap.className = "run-input-wrap";
  const inputLabel = document.createElement("label"); inputLabel.className = "run-input-label";
  inputLabel.textContent = "입력값 (프로그램이 물어볼 값)";
  const stdin = document.createElement("textarea"); stdin.className = "run-stdin";
  stdin.placeholder = "input() 호출 순서대로 한 줄에 하나씩 적으세요. 예: 홍길동↵27↵1";
  inputWrap.append(inputLabel, stdin);
  const syncInputVisibility = () => { inputWrap.hidden = !jsUsesInput(editor.getValue()); };
  syncInputVisibility();

  // ── 좌(편집기) · 우(실행 결과) 분할 ──
  const split = document.createElement("div"); split.className = "run-split";
  const divider = document.createElement("div"); divider.className = "run-divider";
  divider.setAttribute("role", "separator"); divider.setAttribute("aria-orientation", "vertical"); divider.tabIndex = 0;
  const outPanel = document.createElement("div"); outPanel.className = "code-output";
  outPanel.tabIndex = 0; outPanel.setAttribute("aria-label", "실행 결과");
  split.append(editor.host, divider, outPanel);
  attachRunSplitter(split, divider);

  outer.append(bar, inputWrap, split);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function"){
    [bar, inputWrap].forEach((el) => window.MNI18N.translateTree(el));
  }
  host.appendChild(outer);

  const ui = {
    btn: runBtn, gradeBtn, status, outPanel, split, stdin, editorTa: editor.ta,
    fileBase: saveName,
    markError: (line) => editor.markError(line),
    clearError: () => editor.clearError()
  };
  const run = (keepEditorFocus) => runJsSource(editor.getValue(), ui, { keepEditorFocus: keepEditorFocus === true });

  runBtn.addEventListener("click", () => {
    if (typeof ui.cancelRun === "function") ui.cancelRun();
    else run(false);
  });
  // 채점 — 테스트 편집 창은 파이썬과 같은 것을 쓴다(언어와 무관하게 입력·기대 출력만 다룬다).
  // 과제 패키지(.task) 내보내기는 아직 파이썬(main.py) 전용이라 여기서는 넘기지 않는다.
  gradeBtn.addEventListener("click", () => {
    if (typeof openAssignmentGradingModal !== "function"){ toast("채점 기능을 불러오지 못했어요.", 2400); return; }
    openAssignmentGradingModal({
      storageKey: JS_GRADE_PREFIX + draftKey.slice(draftKey.indexOf(":") + 1),
      onRun: (tests) => runJsSource(editor.getValue(), ui, { gradeTests:tests })
    });
  });
  hideOutBtn.addEventListener("click", () => {
    split.classList.remove("show-out");
    hideOutBtn.hidden = true;
    editor.ta.focus({ preventScroll:true });
  });

  // ── 편집 상태(초안·더러움 표시·되돌리기 버튼) ──
  let draftTimer = 0, disposed = false;
  const persistDraft = () => {
    if (disposed) return;
    const value = editor.getValue();
    if (value === savedValue) clearPythonDraft(draftKey);
    else savePythonDraft(draftKey, fingerprint, value);
  };
  const refreshEditState = () => {
    const value = editor.getValue();
    const dirty = value !== savedValue;
    revertBtn.disabled = value === text;
    status.textContent = ui.running ? status.textContent : (dirty ? "저장 안 됨" : "");
    markDocumentDirty(ownerDoc, dirty);
  };
  // 자동 저장 — 텍스트 편집기와 같은 계약을 쓴다(설정에 따르고, 저장 위치가 정해진 문서만 조용히 쓴다).
  let autosaveTimer = 0, autosaveBusy = false, autosaveAgain = false;
  const runAutosave = async () => {
    if (!ownerDoc || !ownerDoc.hasUnsavedEdits || !(appSettings && appSettings.autoSave)) return;
    if (autosaveBusy){ autosaveAgain = true; return; }
    autosaveBusy = true;
    const value = editor.getValue();
    try {
      const ok = await saveTextDoc(value, ownerDoc, ownerDoc.name || saveName, { silent:true, existingOnly:true });
      if (ok === true){
        savedValue = value;
        refreshEditState();
        ownerDoc._jsAutosaveFailureNotified = false;
      } else if (ok !== "skipped" && !ownerDoc._jsAutosaveFailureNotified){
        // 저장 위치가 아직 없는 문서("skipped")는 수동 저장을 기다린다 — 알림을 띄우지 않는다.
        ownerDoc._jsAutosaveFailureNotified = true;
        toast("자동 저장에 실패했어요. 편집 내용은 남아 있어요.", 6000, { type:"error",
          action:{ label:"지금 저장", onClick:() => saveBtn.click() } });
      }
    } catch(error){
      console.warn("javascript autosave failed:", error);
    } finally {
      autosaveBusy = false;
      const latest = editor.getValue();
      if (autosaveAgain || latest !== savedValue){ autosaveAgain = false; scheduleAutosave(); }
    }
  };
  const scheduleAutosave = () => {
    clearTimeout(autosaveTimer); autosaveTimer = 0;
    if (disposed || !ownerDoc || !ownerDoc.hasUnsavedEdits || !(appSettings && appSettings.autoSave)) return;
    autosaveTimer = setTimeout(runAutosave, JS_AUTOSAVE_DELAY);
  };

  editor.ta.addEventListener("input", () => {
    syncInputVisibility();
    refreshEditState();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, JS_DRAFT_DELAY);
    if (autosaveBusy) autosaveAgain = true;
    scheduleAutosave();
  });
  // 결과가 보이는 동안에만 '결과 숨기기'를 노출한다.
  const observer = new MutationObserver(() => { hideOutBtn.hidden = !split.classList.contains("show-out"); });
  observer.observe(split, { attributes:true, attributeFilter:["class"] });

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      const value = editor.getValue();
      const ok = await saveTextDoc(value, ownerDoc, (ownerDoc && ownerDoc.name) || saveName);
      if (ok !== true) return;
      savedValue = value;
      clearTimeout(draftTimer);
      clearTimeout(autosaveTimer); autosaveTimer = 0;
      clearPythonDraft(draftKey);
      refreshEditState();                        // 사이드바·탭의 저장 표시는 markDocumentDirty 가 갱신한다
    } finally { saveBtn.disabled = false; }
  });
  revertBtn.addEventListener("click", async () => {
    if (editor.getValue() === text) return;
    const yes = typeof confirmDialog === "function"
      ? await confirmDialog("편집한 내용을 버리고 원본 코드로 되돌릴까요?", "되돌리기", "취소")
      : true;
    if (!yes) return;
    editor.setValue(text);
    clearTimeout(draftTimer);
    clearPythonDraft(draftKey);
    refreshEditState();
    scheduleAutosave();          // 되돌린 내용도 저장 대상이다(원본과 저장본이 다를 수 있다)
  });

  editor.ta.addEventListener("keydown", (e) => {
    if (typeof shortcutMatches !== "function") return;
    if (shortcutMatches(e, "runCode")){ e.preventDefault(); run(true); return; }
    if (shortcutMatches(e, "saveCurrent")){ e.preventDefault(); saveBtn.click(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(1); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "-"){ e.preventDefault(); e.stopPropagation(); bumpCodeFont(-1); }
  });

  registerEditorFont(editor.host);
  registerEditorFont(outPanel);

  if (ownerDoc){
    ownerDoc.codeEditor = editor;
    ownerDoc.codeEditorFileBase = saveName;
    ownerDoc.openDocFind = () => editor.openFind();
    ownerDoc.openGotoLine = () => editor.openGoto();
    if (!Array.isArray(ownerDoc.cleanupFns)) ownerDoc.cleanupFns = [];
    ownerDoc.cleanupFns.push(() => {
      // disposed 를 먼저 세우면 persistDraft 가 즉시 돌아가므로 마지막 입력을 먼저 기록한다.
      persistDraft();
      disposed = true;
      clearTimeout(draftTimer);
      clearTimeout(autosaveTimer); autosaveTimer = 0;
      observer.disconnect();
      if (typeof ui.cancelRun === "function") ui.cancelRun();
      if (ownerDoc.isScratch && !ownerDoc._named) clearPythonDraft(draftKey);
      if (ownerDoc.codeEditor === editor) ownerDoc.codeEditor = null;
      delete ownerDoc.openDocFind;
      delete ownerDoc.openGotoLine;
      editor.destroy();
      unregisterEditorFont(editor.host);
      unregisterEditorFont(outPanel);
    });
    if (ownerDoc.pendingFocusLine){                  // 정의 이동·코드 링크가 렌더 전에 예약해 둔 줄로 이동
      const line = ownerDoc.pendingFocusLine, opts = ownerDoc.pendingFocusOptions;
      ownerDoc.pendingFocusLine = 0; ownerDoc.pendingFocusOptions = null;
      requestAnimationFrame(() => { if (ownerDoc.codeEditor === editor && editor.focusLine) editor.focusLine(line, opts); });
    }
  }
  refreshEditState();
}
