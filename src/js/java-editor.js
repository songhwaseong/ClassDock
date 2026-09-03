"use strict";

// .java 실행 화면. 파이썬·자바스크립트 실행 화면과 같은 뼈대(실행 바 + 좌우 분할 + 출력 패널)를 쓰되,
// 실행기는 EXE 런처의 로컬 JDK(java-runtime.js)다. 입력값은 별도 칸 대신 대화형 터미널로 받는다 —
// 자바 수업은 Scanner 로 한 줄씩 주고받는 예제가 대부분이라 파이썬 쪽과 같은 방식이 자연스럽다.
// 편집기·초안·저장·분할선은 파이썬 쪽 공용 함수를 그대로 재사용한다.

const JAVA_DRAFT_DELAY = 700;      // 편집이 멈춘 뒤 초안(localStorage) 저장까지 기다리는 시간
const JAVA_AUTOSAVE_DELAY = 3000;  // 편집이 멈춘 뒤 파일 자동 저장까지(텍스트 편집기와 같은 간격)
const JAVA_GRADE_PREFIX = "classdock-java-grade:";   // 파일마다 채점 테스트를 저장하는 키(다른 언어와 분리)

// 빈 파일에서 시작할 때 넣어 주는 최소 골격. 자바는 클래스·main 껍데기가 없으면 아무것도 실행되지 않아서,
// 첫 수업에서 이 열 줄을 받아 적는 데 시간을 다 쓰게 된다. 클래스 이름은 서버가 소스에서 찾아 맞춘다.
const JAVA_STARTER_SOURCE = [
  "public class Main {",
  "    public static void main(String[] args) {",
  "        System.out.println(\"안녕하세요!\");",
  "    }",
  "}",
  ""
].join("\n");

/* 실행에 함께 넣을 라이브러리(jar) 고르기. 자바스크립트 쪽 라이브러리 팝오버(buildJsLibraryPicker)와
   같은 자리·같은 조작이라 화면 모양(run-pkg-wrap·js-library-*)도 그대로 쓴다.
   다른 점은 목록의 출처다 — 카탈로그와 설치 여부를 모두 런처가 알려 주므로 여기서는 그리기만 한다. */
function buildJavaLibraryPicker(bar, button, storageKey, options){
  options = options || {};
  let state = loadJavaLibraryState(storageKey);
  let rows = [];                 // 카탈로그 + 카탈로그에 없는 설치본
  let loaded = false, busy = false, destroyed = false;
  let outsideClose = null, cancelAction = null;

  const panel = document.createElement("section");
  panel.className = "run-pkg-wrap js-library-picker";
  panel.hidden = true;
  panel.setAttribute("aria-label", "자바 라이브러리 추가");
  const intro = document.createElement("div"); intro.className = "js-library-intro";
  const introTitle = document.createElement("strong"); introTitle.textContent = "실행에 넣을 라이브러리";
  const introText = document.createElement("span");
  introText.textContent = "고른 항목은 이 문서의 실행·채점 클래스패스에 들어갑니다.";
  intro.append(introTitle, introText);
  const status = document.createElement("div"); status.className = "js-npm-status";
  status.textContent = "라이브러리 목록을 확인할 수 있어요.";
  const list = document.createElement("div"); list.className = "js-npm-list";

  const form = document.createElement("div"); form.className = "js-npm-form";
  const specInput = document.createElement("input"); specInput.type = "text";
  specInput.placeholder = "직접 추가 (예: org.apache.commons:commons-io:2.18.0)";
  specInput.autocomplete = "off"; specInput.spellcheck = false;
  const addBtn = document.createElement("button"); addBtn.type = "button"; addBtn.className = "pkg-set"; addBtn.textContent = "받기";
  form.append(specInput, addBtn);
  const warning = document.createElement("p"); warning.className = "js-library-note js-npm-warning";
  warning.textContent = "EXE에서만 쓸 수 있어요. jar 는 Maven Central에서 받아 배포처 검증값과 대조하며, 의존성이 딸린 라이브러리는 필요한 좌표를 하나씩 더 넣어야 합니다.";

  const progress = document.createElement("div"); progress.className = "js-npm-progress"; progress.hidden = true;
  const progressHead = document.createElement("div"); progressHead.className = "js-npm-progress-head";
  const progressLabel = document.createElement("strong"); progressLabel.textContent = "받는 중";
  const cancelBtn = document.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "pkg-set";
  cancelBtn.textContent = "취소"; cancelBtn.hidden = true;
  const log = document.createElement("pre"); log.className = "js-npm-log";
  progressHead.append(progressLabel, cancelBtn); progress.append(progressHead, log);

  const note = document.createElement("p"); note.className = "js-library-note";
  note.textContent = "코드 맨 위에 import 를 적어야 쓸 수 있어요. 항목을 누르면 예시 import 를 보여 줍니다.";
  panel.append(intro, status, list, form, warning, progress, note);
  bar.appendChild(panel);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(panel);

  const detachOutside = () => {
    if (!outsideClose) return;
    document.removeEventListener("pointerdown", outsideClose, true);
    outsideClose = null;
  };
  const close = () => { panel.hidden = true; button.setAttribute("aria-expanded", "false"); detachOutside(); };
  const formatBytes = (value) => {
    const bytes = Math.max(0, Number(value) || 0);
    return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + "MB" : Math.max(1, Math.round(bytes / 1024)) + "KB";
  };
  const specOf = (row) => row.id || row.coordinate;
  const syncButton = () => {
    const count = state.ids.length;
    button.textContent = count ? javaT("라이브러리") + " " + count : javaT("라이브러리");
    button.classList.toggle("has-selection", count > 0);
    button.title = count
      ? javaTf("이 문서에 라이브러리 {count}개 적용 중", { count })
      : javaT("이 문서의 실행에 함께 넣을 라이브러리 고르기");
  };
  const commit = (ids) => {
    const next = javaLibraryState({ ids });
    if (!saveJavaLibraryState(storageKey, next)){
      if (typeof toast === "function") toast(javaT("라이브러리 설정을 저장할 공간이 부족해요."), 4200, { type:"error" });
      return false;
    }
    const before = javaLibrarySelectionSignature(state);
    state = next;
    render();
    if (before !== javaLibrarySelectionSignature(state) && typeof options.onChange === "function"){
      options.onChange(javaLibraryState(state), rows);
    }
    return true;
  };
  const toggle = (row) => {
    const spec = specOf(row);
    const ids = state.ids.indexOf(spec) >= 0 ? state.ids.filter((id) => id !== spec) : state.ids.concat([spec]);
    if (ids.length > JAVA_LIBRARY_MAX_SELECTED){
      if (typeof toast === "function") toast(javaTf("한 번에 {max}개까지 고를 수 있어요.", { max:JAVA_LIBRARY_MAX_SELECTED }), 3000);
      return;
    }
    commit(ids);
  };

  const render = () => {
    syncButton();
    list.replaceChildren();
    if (!rows.length){
      const empty = document.createElement("span"); empty.className = "js-library-empty";
      empty.textContent = loaded ? javaT("쓸 수 있는 라이브러리가 없어요.") : javaT("목록을 여는 중…");
      list.appendChild(empty);
      return;
    }
    for (const row of rows){
      const spec = specOf(row);
      const line = document.createElement("div"); line.className = "js-npm-row";
      const select = document.createElement("button"); select.type = "button"; select.className = "js-npm-select";
      const active = state.ids.indexOf(spec) >= 0;
      select.classList.toggle("active", active);
      select.setAttribute("aria-pressed", String(active));
      const name = document.createElement("strong"); name.textContent = row.label || row.coordinate;
      const meta = document.createElement("small");
      meta.textContent = row.installed ? formatBytes(row.size) : javaT("아직 받지 않음");
      select.append(name, meta);
      select.title = row.coordinate + (row.sample ? "\n" + row.sample : "");
      select.disabled = busy;
      select.addEventListener("click", () => {
        if (busy) return;
        if (!row.installed){ install(spec, row.label || row.coordinate); return; }
        toggle(row);
        // 예시 import 는 한 번 보여 주면 충분하다 — 고를 때만 알려 준다.
        if (row.sample && state.ids.indexOf(spec) >= 0 && typeof toast === "function") toast(row.sample, 3200);
      });
      line.appendChild(select);
      if (row.installed && !row.bundled){
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "js-npm-delete";
        remove.textContent = javaT("삭제");
        remove.title = javaTf("{name} 를 이 컴퓨터에서 지우기", { name:row.coordinate });
        remove.disabled = busy;
        remove.addEventListener("click", () => remove.disabled ? null : erase(row));
        line.appendChild(remove);
      }
      list.appendChild(line);
    }
  };

  const load = async () => {
    status.textContent = javaT("라이브러리 목록을 읽는 중…");
    let catalog, installed;
    try {
      catalog = await javaLibraryCatalog();
      installed = catalog.available ? await javaLibraryInstalled() : { rows:[] };
    } catch(error){
      if (destroyed) return;
      loaded = true;
      status.textContent = javaTf("목록을 읽지 못했어요: {message}", { message:(error && error.message) || error });
      return;
    }
    if (destroyed) return;
    loaded = true;
    if (!catalog.available){
      rows = [];
      status.textContent = javaT("라이브러리 추가는 ClassDock EXE에서만 사용할 수 있어요.");
      render();
      return;
    }
    // 카탈로그에 없는 것(직접 좌표로 받은 것)도 함께 보여 준다 — 받아 놓고 고를 수 없으면 안 된다.
    const known = catalog.rows.map((row) => row.coordinate);
    rows = catalog.rows.concat(installed.rows.filter((row) => known.indexOf(row.coordinate) < 0));
    status.textContent = javaT("항목을 누르면 이 문서의 실행에 함께 들어갑니다.");
    render();
    // 목록을 받아야 어떤 클래스 이름을 아는지 알 수 있다 — 자동완성 갱신은 여기서도 알린다.
    if (typeof options.onChange === "function") options.onChange(javaLibraryState(state), rows);
  };

  const install = async (spec, label) => {
    if (busy) return;
    const allow = typeof confirmDialog === "function"
      ? await confirmDialog(
        javaTf("Maven Central에서 ‘{name}’ 라이브러리(jar)를 내려받아 이 컴퓨터에 보관합니다.\n\n받은 파일은 배포처가 알려준 검증값과 대조합니다. 이 코드는 실행할 때 함께 동작하니 믿을 수 있는 것만 받으세요.",
          { name:label }), javaT("받기"), javaT("취소"))
      : true;
    if (!allow) return;
    busy = true; render();
    addBtn.disabled = true; specInput.disabled = true;
    progress.hidden = false; progressLabel.textContent = javaTf("{name} 받는 중", { name:label });
    log.textContent = javaT("작업을 시작합니다…");
    try {
      const result = await javaLibraryInstallStream(spec, {
        onLog:(text) => { log.textContent = String(text || "").slice(-60000); log.scrollTop = log.scrollHeight; },
        onCancel:(cancel) => { cancelAction = cancel; cancelBtn.hidden = !cancel; cancelBtn.disabled = false; cancelBtn.textContent = javaT("취소"); }
      });
      if (destroyed) return;
      if (!result.ok) throw new Error(result.cancelled ? javaT("받기를 취소했어요.") : javaT("받지 못했어요. 아래 기록을 확인해 주세요."));
      busy = false;
      await load();
      if (destroyed) return;
      progressLabel.textContent = javaT("완료");
      // 받자마자 고른 상태로 만든다 — 받는 이유가 곧 쓰려는 것이다.
      if (state.ids.indexOf(spec) < 0) commit(state.ids.concat([spec]));
      if (typeof toast === "function") toast(javaTf("{name} 를 받아 이 문서에 적용했어요.", { name:label }), 3000);
    } catch(error){
      if (destroyed) return;
      progressLabel.textContent = javaT("실패");
      const message = (error && error.message) || String(error);
      if (log.textContent.indexOf(message) < 0) log.textContent += "\n\n" + message;
      if (typeof toast === "function") toast(message, 4200, { type:"error" });
    } finally {
      busy = false; cancelAction = null; cancelBtn.hidden = true;
      addBtn.disabled = false; specInput.disabled = false;
      if (!destroyed) render();
    }
  };

  const erase = async (row) => {
    const allow = typeof confirmDialog === "function"
      ? await confirmDialog(javaTf("‘{name}’ 를 이 컴퓨터에서 지울까요?", { name:row.coordinate }), javaT("삭제"), javaT("취소"))
      : true;
    if (!allow || destroyed) return;
    try {
      await javaLibraryDelete(specOf(row));
      commit(state.ids.filter((id) => id !== specOf(row)));
      await load();
      if (typeof toast === "function") toast(javaT("라이브러리를 지웠어요."), 2200);
    } catch(error){
      if (typeof toast === "function") toast((error && error.message) || String(error), 4000, { type:"error" });
    }
  };

  addBtn.addEventListener("click", () => {
    const spec = specInput.value.trim();
    if (!javaLibraryValidSpec(spec)){
      if (typeof toast === "function") toast(javaT("group:artifact:version 형식으로 적어 주세요."), 3200);
      specInput.focus();
      return;
    }
    specInput.value = "";
    install(spec, spec);
  });
  specInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing){ e.preventDefault(); addBtn.click(); }
  });
  cancelBtn.addEventListener("click", () => {
    if (typeof cancelAction !== "function") return;
    cancelBtn.disabled = true; cancelBtn.textContent = javaT("취소하는 중…"); cancelAction();
  });

  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => {
    if (!panel.hidden){ close(); return; }
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    if (!loaded && !busy) load();
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
  render();
  // 이미 고른 것이 있으면 팝오버를 열기 전에 한 번 읽는다(자동완성에 클래스 이름을 얹기 위해).
  if (state.ids.length) load();
  return {
    getQuery: () => javaLibraryQuery(state),
    getRows: () => rows.slice(),
    close,
    destroy(){ destroyed = true; close(); bar.removeEventListener("keydown", onKey); panel.remove(); }
  };
}

function renderJavaRunnable(context){
  const { outer, host, text, prof, ext, file, ownerDoc, runCtx, sourceBytes } = context;
  const saveName = (ownerDoc && ownerDoc.name) || (file && file.name) || "Main.java";
  const draftKey = pythonDraftKey(file, ownerDoc, runCtx);
  const fingerprint = fingerprintBytes((file && file.name) || "Main.java", sourceBytes);
  const restoredDraft = loadPythonDraft(draftKey, fingerprint);
  // 새로 만든 빈 파일에만 골격을 넣는다 — 학생이 지운 내용을 되살리지 않도록 초안이 있으면 건드리지 않는다.
  const initial = restoredDraft !== null ? restoredDraft : (text.trim() === "" ? JAVA_STARTER_SOURCE : text);

  /* 자동완성 단어 = 자바 키워드 + 고른 라이브러리의 클래스 이름. 배열 자체를 편집기에 넘겨 두고
     내용만 갈아 끼운다 — 편집기는 제안을 만들 때마다 이 배열을 읽으므로 다시 만들지 않아도 따라온다. */
  const baseWords = (typeof completionWordsForProfile === "function" ? completionWordsForProfile(prof, ext) : []).slice();
  const completionWords = baseWords.slice();
  const applyLibraryWords = (libState, libRows) => {
    const extra = javaLibraryCompletionWords(libState, libRows);
    completionWords.length = 0;
    for (const word of baseWords) completionWords.push(word);
    for (const word of extra) completionWords.push(word);
  };

  const editor = buildCodeEditor(initial, prof, {
    // 파이썬 전용 지능(Jedi 질의·import 문맥)을 끄고 확장자에 맞는 키워드를 쓴다.
    // fileExt 만 넘기면 공용 목록에서 자바 키워드를 골라 준다(core.js 의 completionWordsForProfile).
    plain: true,
    fileExt: ext,
    completionWords,
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
  saveBtn.textContent = ".java 저장";
  saveBtn.dataset.shortcutAction = "saveCurrent"; saveBtn.dataset.shortcutTitle = "자바 파일 저장";
  const gradeBtn = document.createElement("button"); gradeBtn.className = "run-grade run-java-grade"; gradeBtn.type = "button";
  gradeBtn.textContent = "채점"; gradeBtn.title = "입력값과 기대 출력을 기준으로 현재 코드를 자동 채점";
  const libBtn = document.createElement("button"); libBtn.className = "run-pkg run-java-library"; libBtn.type = "button";
  libBtn.textContent = "라이브러리";
  const envBtn = document.createElement("button"); envBtn.className = "run-pkg run-java-env"; envBtn.type = "button";
  envBtn.textContent = "Java"; envBtn.title = "이 컴퓨터에서 쓰는 자바(JDK) 확인";
  const revertBtn = document.createElement("button"); revertBtn.className = "run-revert"; revertBtn.type = "button";
  revertBtn.textContent = "↩ 원본"; revertBtn.title = "편집 전 원본 코드로 되돌리기"; revertBtn.disabled = true;
  const hideOutBtn = document.createElement("button"); hideOutBtn.className = "run-revert"; hideOutBtn.type = "button";
  hideOutBtn.textContent = "결과 숨기기"; hideOutBtn.title = "실행 결과 칸을 접고 편집기를 넓게 쓰기"; hideOutBtn.hidden = true;
  const status = document.createElement("span"); status.className = "run-status";
  bar.append(runBtn, gradeBtn, libBtn, envBtn, saveBtn, revertBtn, hideOutBtn, status);
  if (typeof syncShortcutHints === "function") syncShortcutHints(bar);

  // ── 좌(편집기) · 우(실행 결과) 분할 ──
  const split = document.createElement("div"); split.className = "run-split";
  const divider = document.createElement("div"); divider.className = "run-divider";
  divider.setAttribute("role", "separator"); divider.setAttribute("aria-orientation", "vertical"); divider.tabIndex = 0;
  const outPanel = document.createElement("div"); outPanel.className = "code-output";
  outPanel.tabIndex = 0; outPanel.setAttribute("aria-label", "실행 결과");
  split.append(editor.host, divider, outPanel);
  attachRunSplitter(split, divider);

  outer.append(bar, split);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);
  host.appendChild(outer);

  const ui = {
    btn: runBtn, gradeBtn, status, outPanel, split, editorTa: editor.ta,
    fileBase: saveName,
    markError: (line) => editor.markError(line),
    clearError: () => editor.clearError()
  };
  const libraryPicker = buildJavaLibraryPicker(bar, libBtn, javaLibraryStorageKey(draftKey), {
    onChange: applyLibraryWords
  });
  const run = (keepEditorFocus) => runJavaSource(editor.getValue(), ui, {
    keepEditorFocus: keepEditorFocus === true,
    libs: libraryPicker.getQuery()
  });
  ui.rerun = () => run(false);

  runBtn.addEventListener("click", () => {
    if (typeof ui.cancelRun === "function") ui.cancelRun();
    else run(false);
  });
  // 채점 — 테스트 편집 창은 파이썬·자바스크립트와 같은 것을 쓴다(언어와 무관하게 입력·기대 출력만 다룬다).
  gradeBtn.addEventListener("click", () => {
    if (typeof openAssignmentGradingModal !== "function"){
      if (typeof toast === "function") toast(javaT("채점 기능을 불러오지 못했어요."), 2400);
      return;
    }
    openAssignmentGradingModal({
      storageKey: JAVA_GRADE_PREFIX + draftKey.slice(draftKey.indexOf(":") + 1),
      // 채점도 같은 라이브러리로 돌린다 — 실행에서만 되는 코드가 채점에서 떨어지면 안 된다.
      onRun: (tests) => runJavaSource(editor.getValue(), ui, { gradeTests:tests, libs:libraryPicker.getQuery() })
    });
  });
  // 어느 자바가 잡혔는지 — 교실에서 "왜 이 PC만 다르지"를 물을 때 가장 먼저 볼 곳이다.
  envBtn.addEventListener("click", async () => {
    if (disposed) return;
    if (typeof ui.disposeInstallGuide === "function") ui.disposeInstallGuide();
    ui.disposeInstallGuide = null;
    split.classList.add("show-out");
    const info = await javaEnvironmentDetails();
    if (disposed) return;
    if (!info.ok){
      const guide = renderJavaInstallGuide(outPanel, () => { if (!disposed) run(false); });
      ui.disposeInstallGuide = () => guide.dispose();
      return;
    }
    outPanel.innerHTML = "";
    const head = document.createElement("div"); head.className = "out-head"; head.textContent = "자바 실행 환경";
    const list = document.createElement("dl"); list.className = "java-env-list";
    const rows = [
      ["버전", info.version || ("Java " + info.major)],
      ["경로", info.path],
      ["찾은 곳", javaSourceLabel(info.source) || info.source]
    ];
    rows.forEach(([label, value]) => {
      if (!value) return;
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = value;
      list.append(dt, dd);
    });
    outPanel.append(head, list);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(outPanel);
  });
  hideOutBtn.addEventListener("click", () => {
    split.classList.remove("show-out");
    hideOutBtn.hidden = true;
    editor.ta.focus({ preventScroll:true });
  });

  // ── 편집 상태(초안·더러움 표시·되돌리기 버튼) ──
  let draftTimer = 0, disposed = false;
  ui.isDisposed = () => disposed;
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
    status.textContent = ui.running ? status.textContent : (dirty ? javaT("저장 안 됨") : "");
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
        if (typeof markDocumentSavedSnapshot === "function"){
          await markDocumentSavedSnapshot(ownerDoc, new TextEncoder().encode(value), "text/plain;charset=utf-8");
        }
        refreshEditState();
        ownerDoc._javaAutosaveFailureNotified = false;
      } else if (ok !== "skipped" && !ownerDoc._javaAutosaveFailureNotified){
        // 저장 위치가 아직 없는 문서("skipped")는 수동 저장을 기다린다 — 알림을 띄우지 않는다.
        ownerDoc._javaAutosaveFailureNotified = true;
        if (typeof toast === "function"){
          toast(javaT("자동 저장에 실패했어요. 편집 내용은 남아 있어요."), 6000, { type:"error",
            action:{ label:javaT("지금 저장"), onClick:() => saveBtn.click() } });
        }
      }
    } catch(error){
      console.warn("java autosave failed:", error);
    } finally {
      autosaveBusy = false;
      const latest = editor.getValue();
      if (autosaveAgain || latest !== savedValue){ autosaveAgain = false; scheduleAutosave(); }
    }
  };
  const scheduleAutosave = () => {
    clearTimeout(autosaveTimer); autosaveTimer = 0;
    if (disposed || !ownerDoc || !ownerDoc.hasUnsavedEdits || !(appSettings && appSettings.autoSave)) return;
    autosaveTimer = setTimeout(runAutosave, JAVA_AUTOSAVE_DELAY);
  };

  editor.ta.addEventListener("input", () => {
    refreshEditState();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, JAVA_DRAFT_DELAY);
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
      // saveTextDoc 은 디스크에만 쓰므로 자동 복원용 작업공간 사본을 저장한 내용으로 맞춘다.
      if (ownerDoc && typeof markDocumentSavedSnapshot === "function"){
        await markDocumentSavedSnapshot(ownerDoc, new TextEncoder().encode(value), "text/plain;charset=utf-8");
      }
      refreshEditState();
    } finally { saveBtn.disabled = false; }
  });
  revertBtn.addEventListener("click", async () => {
    if (editor.getValue() === text) return;
    const yes = typeof confirmDialog === "function"
      ? await confirmDialog(javaT("편집한 내용을 버리고 원본 코드로 되돌릴까요?"), javaT("되돌리기"), javaT("취소"))
      : true;
    if (!yes) return;
    editor.setValue(text);
    clearTimeout(draftTimer);
    clearPythonDraft(draftKey);
    refreshEditState();
    scheduleAutosave();
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
      if (typeof ui.disposeInstallGuide === "function") ui.disposeInstallGuide();
      ui.disposeInstallGuide = null;
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
