"use strict";

// .js / .mjs 실행 화면. 파이썬 실행 화면과 같은 뼈대(실행 바 + 좌우 분할 + 출력 패널)를 쓰되,
// 파이썬 전용 도구(라이브러리·노트북·채점·단계 실행·터미널)가 빠진 최소 구성이다.
// 편집기·초안·저장·분할선은 파이썬 쪽 공용 함수를 그대로 재사용한다.

const JS_DRAFT_DELAY = 700;      // 편집이 멈춘 뒤 초안(localStorage) 저장까지 기다리는 시간
const JS_AUTOSAVE_DELAY = 3000;  // 편집이 멈춘 뒤 파일 자동 저장까지(텍스트 편집기와 같은 간격)
const JS_GRADE_PREFIX = "pdf-signer-js-grade:";   // 파일마다 채점 테스트를 저장하는 키(파이썬과 분리)

// 일반 .js 실행 화면과 JavaScript 노트북이 함께 쓰는 라이브러리 선택 팝오버.
// 선택은 문서별 localStorage에 저장하고, 로컬 파일 원문도 같은 상태에 넣는다.
function buildJsLibraryPicker(bar, button, storageKey, options){
  options = options || {};
  let state = loadJsLibraryState(storageKey);
  let outsideClose = null;
  let destroyed = false;
  let npmInstalled = [];
  let npmLoaded = false;
  let npmBusy = false;
  let npmCancelAction = null;

  const panel = document.createElement("section");
  panel.className = "run-pkg-wrap js-library-picker";
  panel.hidden = true;
  panel.setAttribute("aria-label", "자바스크립트 라이브러리 추가");
  const intro = document.createElement("div"); intro.className = "js-library-intro";
  const introTitle = document.createElement("strong"); introTitle.textContent = "실행할 라이브러리";
  const introText = document.createElement("span"); introText.textContent = "선택한 항목은 이 문서의 실행·채점·노트북 Worker에 먼저 들어갑니다.";
  intro.append(introTitle, introText);

  const tabs = document.createElement("div"); tabs.className = "js-library-tabs"; tabs.setAttribute("role", "tablist");
  const builtinTab = document.createElement("button"); builtinTab.type = "button"; builtinTab.textContent = "내장";
  const npmTab = document.createElement("button"); npmTab.type = "button"; npmTab.textContent = "npm 패키지";
  const customTab = document.createElement("button"); customTab.type = "button"; customTab.textContent = "내 파일";
  [builtinTab, npmTab, customTab].forEach((tab) => { tab.className = "js-library-tab"; tab.setAttribute("role", "tab"); tabs.appendChild(tab); });
  const builtinView = document.createElement("div"); builtinView.className = "js-library-tab-view";
  const npmView = document.createElement("div"); npmView.className = "js-library-tab-view"; npmView.hidden = true;
  const customView = document.createElement("div"); customView.className = "js-library-tab-view"; customView.hidden = true;
  const choices = document.createElement("div"); choices.className = "js-library-choices";
  builtinView.appendChild(choices);

  const npmStatus = document.createElement("div"); npmStatus.className = "js-npm-status"; npmStatus.textContent = "Node.js와 npm 상태를 확인할 수 있어요.";
  const npmForm = document.createElement("div"); npmForm.className = "js-npm-form";
  const npmSpec = document.createElement("input"); npmSpec.type = "text"; npmSpec.placeholder = "패키지 (예: lodash-es@4.17.21)"; npmSpec.autocomplete = "off"; npmSpec.spellcheck = false;
  const npmGlobal = document.createElement("input"); npmGlobal.type = "text"; npmGlobal.placeholder = "전역 이름 (예: lodashEs)"; npmGlobal.autocomplete = "off"; npmGlobal.spellcheck = false;
  const npmInstall = document.createElement("button"); npmInstall.type = "button"; npmInstall.className = "pkg-set"; npmInstall.textContent = "설치";
  npmForm.append(npmSpec, npmGlobal, npmInstall);
  const npmWarning = document.createElement("p"); npmWarning.className = "js-library-note js-npm-warning";
  npmWarning.textContent = "EXE와 설치된 Node.js가 필요합니다. 패키지는 인터넷에서 내려받지만 install script는 실행하지 않으며, Node 전용·DOM 전용 패키지는 Worker에서 동작하지 않을 수 있습니다.";
  const npmList = document.createElement("div"); npmList.className = "js-npm-list";
  const npmProgress = document.createElement("div"); npmProgress.className = "js-npm-progress"; npmProgress.hidden = true;
  const npmProgressHead = document.createElement("div"); npmProgressHead.className = "js-npm-progress-head";
  const npmProgressLabel = document.createElement("strong"); npmProgressLabel.textContent = "설치 중";
  const npmCancel = document.createElement("button"); npmCancel.type = "button"; npmCancel.className = "pkg-set"; npmCancel.textContent = "취소"; npmCancel.hidden = true;
  const npmLog = document.createElement("pre"); npmLog.className = "js-npm-log";
  npmProgressHead.append(npmProgressLabel, npmCancel); npmProgress.append(npmProgressHead, npmLog);
  npmView.append(npmStatus, npmForm, npmWarning, npmList, npmProgress);

  const customHead = document.createElement("div"); customHead.className = "js-library-custom-head";
  const customLabel = document.createElement("strong"); customLabel.textContent = "내 파일";
  const addFileBtn = document.createElement("button"); addFileBtn.type = "button"; addFileBtn.className = "pkg-set"; addFileBtn.textContent = "+ .js 파일";
  addFileBtn.title = "브라우저 Worker에서 먼저 실행할 JavaScript 라이브러리 파일 추가";
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = ".js,text/javascript,application/javascript"; fileInput.hidden = true;
  customHead.append(customLabel, addFileBtn, fileInput);
  const customList = document.createElement("div"); customList.className = "js-library-custom-list";
  customView.append(customHead, customList);
  const note = document.createElement("p"); note.className = "js-library-note";
  note.textContent = "코드에서는 import 대신 표시된 전역 이름을 사용합니다. 모든 항목은 격리된 Worker에서 실행됩니다.";
  panel.append(intro, tabs, builtinView, npmView, customView, note);
  bar.appendChild(panel);

  const detachOutside = () => {
    if (!outsideClose) return;
    document.removeEventListener("pointerdown", outsideClose, true);
    outsideClose = null;
  };
  const close = () => { panel.hidden = true; button.setAttribute("aria-expanded", "false"); detachOutside(); };
  const countSelected = () => state.builtins.length + state.npm.length + state.custom.length;
  const syncButton = () => {
    const count = countSelected();
    button.textContent = count ? ("라이브러리 " + count) : "라이브러리";
    button.classList.toggle("has-selection", count > 0);
    button.title = count ? ("이 문서에 라이브러리 " + count + "개 적용 중") : "이 문서에서 사용할 JavaScript 라이브러리 추가";
  };
  const commit = (next) => {
    const normalized = jsLibraryState(next);
    if (!saveJsLibraryState(storageKey, normalized)){
      if (typeof toast === "function") toast("라이브러리 설정을 저장할 공간이 부족해요.", 4200, { type:"error" });
      return false;
    }
    const before = jsLibrarySelectionSignature(state);
    state = normalized;
    sync();
    if (before !== jsLibrarySelectionSignature(state) && typeof options.onChange === "function") options.onChange(jsLibraryState(state));
    return true;
  };
  const formatBytes = (value) => {
    const bytes = Math.max(0, Number(value) || 0);
    return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + "MB" : Math.max(1, Math.round(bytes / 1024)) + "KB";
  };
  const renderNpmList = () => {
    npmList.replaceChildren();
    if (!npmInstalled.length){
      const empty = document.createElement("span"); empty.className = "js-library-empty";
      empty.textContent = npmLoaded ? "설치된 npm 패키지 없음" : "npm 탭을 열면 설치 목록을 확인합니다.";
      npmList.appendChild(empty);
    } else for (const item of npmInstalled){
      const row = document.createElement("div"); row.className = "js-npm-row";
      const select = document.createElement("button"); select.type = "button"; select.className = "js-npm-select";
      const active = state.npm.some((selected) => selected.id === item.id);
      select.classList.toggle("active", active); select.setAttribute("aria-pressed", String(active));
      const name = document.createElement("strong"); name.textContent = item.name + "@" + item.version;
      const meta = document.createElement("small"); meta.textContent = item.global + " · " + formatBytes(item.size);
      select.append(name, meta);
      select.addEventListener("click", () => {
        const selected = state.npm.some((entry) => entry.id === item.id);
        commit({ ...state, npm:selected ? state.npm.filter((entry) => entry.id !== item.id) : [...state.npm, item] });
      });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "js-npm-delete"; remove.textContent = "삭제";
      remove.title = item.name + " 설치 캐시 삭제";
      remove.addEventListener("click", async () => {
        const allow = typeof confirmDialog === "function"
          ? await confirmDialog("‘" + item.name + "@" + item.version + "’ 설치 캐시를 이 컴퓨터에서 삭제할까요?", "삭제", "취소") : true;
        if (!allow) return;
        remove.disabled = true;
        try {
          await jsNpmDelete(item.id);
          commit({ ...state, npm:state.npm.filter((entry) => entry.id !== item.id) });
          npmInstalled = npmInstalled.filter((entry) => entry.id !== item.id);
          renderNpmList(); toast("npm 패키지 캐시를 삭제했어요.", 2200);
        } catch(error){ remove.disabled = false; toast((error && error.message) || String(error), 4000, { type:"error" }); }
      });
      row.append(select, remove); npmList.appendChild(row);
    }
  };
  const sync = () => {
    syncButton();
    for (const btn of choices.querySelectorAll("button[data-js-library]")){
      const active = state.builtins.indexOf(btn.dataset.jsLibrary) >= 0;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    customList.replaceChildren();
    if (!state.custom.length){
      const empty = document.createElement("span"); empty.className = "js-library-empty"; empty.textContent = "추가한 파일 없음";
      customList.appendChild(empty);
    } else for (const item of state.custom){
      const chip = document.createElement("span"); chip.className = "js-library-file";
      const name = document.createElement("span"); name.textContent = item.name; name.title = item.name;
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = item.name + " 제거";
      remove.addEventListener("click", () => commit({ ...state, custom:state.custom.filter((row) => row.id !== item.id) }));
      chip.append(name, remove); customList.appendChild(chip);
    }
    renderNpmList();
  };

  const refreshNpm = async () => {
    npmStatus.textContent = "Node.js와 npm 상태 확인 중…";
    npmInstall.disabled = true;
    const status = await jsNpmStatus();
    if (destroyed) return;
    if (!status.available){
      npmStatus.textContent = status.reason === "not-exe"
        ? "npm 설치는 만능파일교실 EXE에서만 사용할 수 있어요."
        : "Node.js 또는 npm을 찾지 못했어요. Node.js LTS 설치 후 EXE를 다시 열어 주세요.";
      npmLoaded = true; npmInstalled = []; renderNpmList();
      return;
    }
    npmStatus.textContent = "사용 가능 · Node " + status.node + " · npm " + status.npm;
    npmInstall.disabled = npmBusy;
    try {
      npmInstalled = await jsNpmList(); npmLoaded = true; renderNpmList();
    } catch(error){ npmLoaded = true; npmStatus.textContent = "설치 목록을 읽지 못했어요: " + ((error && error.message) || error); }
  };

  const setTab = (wanted) => {
    const rows = [[builtinTab, builtinView, "builtin"], [npmTab, npmView, "npm"], [customTab, customView, "custom"]];
    for (const [tab, view, id] of rows){
      const active = wanted === id; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); view.hidden = !active;
    }
    if (wanted === "npm" && !npmLoaded && !npmBusy) refreshNpm();
  };
  builtinTab.addEventListener("click", () => setTab("builtin"));
  npmTab.addEventListener("click", () => setTab("npm"));
  customTab.addEventListener("click", () => setTab("custom"));
  setTab("builtin");

  for (const item of JS_LIBRARY_CATALOG){
    const choice = document.createElement("button"); choice.type = "button"; choice.className = "pkg-set js-library-choice";
    choice.dataset.jsLibrary = item.id;
    choice.title = item.description + "\n전역: " + item.global + " · 예: " + item.example;
    const name = document.createElement("strong"); name.textContent = item.label;
    const meta = document.createElement("small"); meta.textContent = item.global + " · " + item.version;
    choice.append(name, meta);
    choice.addEventListener("click", () => {
      const selected = state.builtins.indexOf(item.id) >= 0;
      commit({ ...state, builtins:selected ? state.builtins.filter((id) => id !== item.id) : [...state.builtins, item.id] });
    });
    choices.appendChild(choice);
  }

  addFileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (!/\.js$/i.test(file.name || "")){ toast(".js 라이브러리 파일을 선택해 주세요.", 3000); return; }
    if (file.size > JS_LIBRARY_MAX_CUSTOM_SOURCE){ toast("라이브러리 파일은 한 개당 512KB까지 추가할 수 있어요.", 4000); return; }
    if (state.custom.length >= JS_LIBRARY_MAX_CUSTOM){ toast("내 라이브러리는 문서마다 최대 8개까지 추가할 수 있어요.", 3500); return; }
    const total = state.custom.reduce((sum, row) => sum + row.source.length, 0);
    if (total + file.size > JS_LIBRARY_MAX_CUSTOM_TOTAL){ toast("내 라이브러리 원문은 문서마다 합계 1MB까지 저장할 수 있어요.", 4200); return; }
    let source = "";
    try { source = await file.text(); } catch(_){ toast("라이브러리 파일을 읽지 못했어요.", 3000); return; }
    const allow = typeof confirmDialog === "function"
      ? await confirmDialog("‘" + file.name + "’의 코드는 실행할 때마다 브라우저 Worker에서 실행됩니다. 신뢰하는 파일만 추가하세요.", "추가", "취소")
      : true;
    if (!allow) return;
    const row = { id:"custom:" + jsLibraryHash(file.name + "\n" + source), name:file.name, source };
    const withoutSameName = state.custom.filter((item) => item.name !== row.name && item.id !== row.id);
    if (commit({ ...state, custom:[...withoutSameName, row] })) toast(file.name + " 라이브러리를 추가했어요.", 2200);
  });

  npmSpec.addEventListener("input", () => {
    if (!npmGlobal.dataset.edited) npmGlobal.value = jsNpmGlobalFromSpec(npmSpec.value);
  });
  npmGlobal.addEventListener("input", () => { npmGlobal.dataset.edited = npmGlobal.value ? "1" : ""; });
  npmInstall.addEventListener("click", async () => {
    const spec = npmSpec.value.trim();
    const globalName = (npmGlobal.value.trim() || jsNpmGlobalFromSpec(spec));
    if (!spec){ toast("설치할 npm 패키지 이름을 입력해 주세요.", 2600); npmSpec.focus(); return; }
    if (!/^[A-Za-z_$][\w$]*$/.test(globalName)){ toast("전역 이름을 JavaScript 변수 이름 형식으로 입력해 주세요.", 3200); npmGlobal.focus(); return; }
    const allow = typeof confirmDialog === "function" ? await confirmDialog(
      "npm 레지스트리에서 ‘" + spec + "’ 패키지를 내려받아 이 컴퓨터의 별도 캐시에 설치합니다.\n\n" +
      "패키지 코드는 실행할 때 Worker에서 동작합니다. 신뢰하는 패키지만 설치하세요. 설치 스크립트는 실행하지 않습니다.",
      "설치", "취소") : true;
    if (!allow) return;
    npmBusy = true; npmInstall.disabled = true; npmSpec.disabled = true; npmGlobal.disabled = true;
    npmProgress.hidden = false; npmProgressLabel.textContent = spec + " 설치 중"; npmLog.textContent = "설치 작업 시작…";
    try {
      const result = await jsNpmInstallStream(spec, globalName, {
        onLog:(log) => { npmLog.textContent = String(log || "").slice(-120000); npmLog.scrollTop = npmLog.scrollHeight; },
        onCancel:(cancel) => { npmCancelAction = cancel; npmCancel.hidden = !cancel; npmCancel.disabled = false; npmCancel.textContent = "취소"; }
      });
      if (!result.ok) throw new Error(result.cancelled ? "npm 설치를 취소했어요." : "npm 설치에 실패했어요. 아래 로그를 확인해 주세요.");
      jsNpmInvalidateBundle();
      npmInstalled = await jsNpmList(); npmLoaded = true;
      const packageName = (() => {
        if (spec.startsWith("@")){ const slash = spec.indexOf("/"); const at = spec.indexOf("@", slash + 1); return at >= 0 ? spec.slice(0, at) : spec; }
        const at = spec.indexOf("@"); return at >= 0 ? spec.slice(0, at) : spec;
      })();
      const installed = npmInstalled.find((item) => item.name === packageName && item.global === globalName);
      if (installed) commit({ ...state, npm:[...state.npm.filter((item) => item.id !== installed.id), installed] });
      else renderNpmList();
      npmProgressLabel.textContent = "설치 완료"; toast(spec + " 패키지를 설치하고 이 문서에 적용했어요.", 3000);
    } catch(error){
      npmProgressLabel.textContent = "설치 실패";
      const message = (error && error.message) || String(error);
      if (!npmLog.textContent.includes(message)) npmLog.textContent += "\n\n" + message;
      toast(message, 4200, { type:"error" });
    } finally {
      npmBusy = false; npmInstall.disabled = false; npmSpec.disabled = false; npmGlobal.disabled = false;
      npmCancel.hidden = true; npmCancelAction = null;
    }
  });
  npmCancel.addEventListener("click", () => {
    if (typeof npmCancelAction !== "function") return;
    npmCancel.disabled = true; npmCancel.textContent = "취소 중…"; npmProgressLabel.textContent = "설치 취소 중"; npmCancelAction();
  });

  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => {
    if (!panel.hidden){ close(); return; }
    panel.hidden = false; button.setAttribute("aria-expanded", "true");
    outsideClose = (event) => {
      if (destroyed || panel.hidden){ detachOutside(); return; }
      if (panel.contains(event.target) || button.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", outsideClose, true);
  });
  const onKey = (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    const hadFocus = panel.contains(document.activeElement);
    event.preventDefault(); event.stopPropagation(); close();
    if (hadFocus) button.focus({ preventScroll:true });
  };
  bar.addEventListener("keydown", onKey);
  sync();
  return {
    getState:() => jsLibraryState(state),
    close,
    destroy(){ destroyed = true; close(); bar.removeEventListener("keydown", onKey); panel.remove(); }
  };
}

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
  const file = new File([jsScratchStarter()], jsScratchFileName(_scratchCount), { type:"text/javascript" });
  // 파일 열기와 작업공간 저장을 한 큐에서 처리한다. handleFiles만 직접 부르면 편집 초안은 남아도
  // 다음 실행에 그 초안을 붙일 바탕 문서가 없어 미저장 새 JS가 자동복원에서 사라진다.
  if (typeof queueFiles === "function") queueFiles([file], { isScratch:true });
  else handleFiles([file], { isScratch:true });
}

function renderJsRunnable(context){
  const { outer, host, text, prof, ext, file, ownerDoc, runCtx, sourceBytes } = context;
  const saveName = (ownerDoc && ownerDoc.name) || (file && file.name) || "practice.js";
  const draftKey = pythonDraftKey(file, ownerDoc, runCtx);
  const libraryKey = jsLibraryStorageKey(draftKey);
  let activeLibraries = loadJsLibraryState(libraryKey);
  const completionWords = [...JS_RUN_COMPLETION_WORDS, ...jsLibraryCompletionWords(activeLibraries)];
  const fingerprint = fingerprintBytes((file && file.name) || "code.js", sourceBytes);
  const restoredDraft = loadPythonDraft(draftKey, fingerprint);

  const editor = buildCodeEditor(restoredDraft === null ? text : restoredDraft, prof, {
    // 파이썬 전용 지능(Jedi 질의·import 문맥·멤버 추론)을 끄고 확장자에 맞는 키워드를 쓴다.
    // 이걸 넘기지 않으면 .js 편집기가 파이썬 키워드로 완성하고, 로컬 Python 이 있으면
    // 파이썬 분석기(Jedi)에 자바스크립트 코드를 물어보게 된다.
    plain: true,
    fileExt: ext,
    completionWords,
    // console. 처럼 점 뒤에서 무엇을 쓸 수 있는지 — 전역 카탈로그와 리터럴 추론으로 답한다.
    memberCandidates: (source, receiver, prefix) => jsMemberCompletionCandidates(source, receiver, prefix, activeLibraries),
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
  const libraryBtn = document.createElement("button"); libraryBtn.className = "run-pkg run-js-library"; libraryBtn.type = "button";
  const revertBtn = document.createElement("button"); revertBtn.className = "run-revert"; revertBtn.type = "button";
  revertBtn.textContent = "↩ 원본"; revertBtn.title = "편집 전 원본 코드로 되돌리기"; revertBtn.disabled = true;
  const hideOutBtn = document.createElement("button"); hideOutBtn.className = "run-revert"; hideOutBtn.type = "button";
  hideOutBtn.textContent = "결과 숨기기"; hideOutBtn.title = "실행 결과 칸을 접고 편집기를 넓게 쓰기"; hideOutBtn.hidden = true;
  const status = document.createElement("span"); status.className = "run-status";
  bar.append(runBtn, gradeBtn, libraryBtn, saveBtn, revertBtn, hideOutBtn, status);
  const libraryPicker = buildJsLibraryPicker(bar, libraryBtn, libraryKey, {
    onChange:(next) => {
      activeLibraries = next;
      const nextWords = [...JS_RUN_COMPLETION_WORDS, ...jsLibraryCompletionWords(activeLibraries)];
      completionWords.splice(0, completionWords.length, ...nextWords);
    }
  });
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
    libraryState:() => libraryPicker.getState(),
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
      libraryPicker.destroy();
      if (typeof ui.cancelRun === "function") ui.cancelRun();
      if (ownerDoc.isScratch && !ownerDoc._named) clearPythonDraft(draftKey);
      if (ownerDoc.isScratch && !ownerDoc._named){ try { localStorage.removeItem(libraryKey); } catch(_){} }
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
