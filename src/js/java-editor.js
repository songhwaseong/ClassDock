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

const JAVA_SIBLING_MAX = 60;                       // 함께 컴파일할 형제 .java 개수 상한(런처 상한과 같은 값)
const JAVA_SIBLING_MAX_BYTES = 2 * 1024 * 1024;    // 형제 본문 합계 상한

// 작업공간 안에서의 문서 경로·그 폴더. 파이썬 쪽 workspacePythonImportTargets 와 같은 사다리를 쓴다.
function javaDocPath(doc){
  return String((doc && (doc.workspacePath || doc.relPath || doc.name)) || "")
    .replace(/\\/g, "/").replace(/^\/+/, "");
}
function javaDocDir(path){
  const at = String(path || "").lastIndexOf("/");
  return at < 0 ? "" : String(path).slice(0, at);
}

/* 같은 폴더에 함께 열려 있는 .java 문서들의 본문. 자바 수업은 Dog.java·Main.java 처럼 클래스마다
   파일을 나누는데, 실행기는 파일 하나만 컴파일해서 지금까지 그런 코드는 아예 돌지 않았다.
   여기서 모은 본문을 실행·채점·저장 검사에 함께 보내면 javac 가 -sourcepath 로 찾아 쓴다.
   폴더가 다르면(다른 archiveCtx·다른 하위 폴더) 넣지 않는다 — 이름이 겹치는 남의 과제 파일을
   끌어오면 없던 오류가 생긴다. 파일 이름은 보내지 않는다(런처가 소스의 package·public 클래스로 정한다). */
async function javaSiblingSources(ownerDoc){
  if (!ownerDoc || typeof docs === "undefined" || !Array.isArray(docs)) return [];
  const context = ownerDoc.archiveCtx || null;
  const dir = javaDocDir(javaDocPath(ownerDoc));
  const rows = [];
  for (const doc of docs){
    if (!doc || doc === ownerDoc) continue;
    if (typeof workspaceHasDoc === "function" && !workspaceHasDoc(doc)) continue;
    if ((doc.archiveCtx || null) !== context) continue;
    if (String(doc.sourceKey || "").startsWith("definition:")) continue;
    const path = javaDocPath(doc);
    if (!/\.java$/i.test(path) || javaDocDir(path) !== dir) continue;
    rows.push(doc);
    if (rows.length >= JAVA_SIBLING_MAX) break;
  }
  const out = [];
  let total = 0;
  for (const doc of rows){
    // 살아있는 편집기 > 저장된 텍스트 > 디스크 순(내용 검색·자동완성이 쓰는 것과 같은 사다리).
    let text = null;
    if (typeof hasLiveDocText === "function" && typeof liveDocText === "function" && hasLiveDocText(doc)){
      const live = liveDocText(doc);
      if (typeof live === "string") text = live;
    }
    if (text == null && typeof doc.savedText === "string") text = doc.savedText;
    if (text == null && typeof openDocRunText === "function"){
      try { text = await openDocRunText(doc); } catch(_){ text = null; }
    }
    if (typeof text !== "string" || !text.trim()) continue;
    total += text.length;
    if (total > JAVA_SIBLING_MAX_BYTES) break;
    out.push(text);
  }
  return out;
}

/* 형제 파일의 오류 줄을 눌렀을 때 그 문서로 옮겨 간다.
   런처는 파일 이름을 소스의 public 클래스로 정하므로 문서 이름과 다를 수 있다 — 못 찾으면 알려만 준다. */
function openJavaSiblingLine(ownerDoc, fileName, line){
  const want = String(fileName || "").toLowerCase();
  const context = ownerDoc ? (ownerDoc.archiveCtx || null) : null;
  const dir = javaDocDir(javaDocPath(ownerDoc));
  const pool = (typeof docs !== "undefined" && Array.isArray(docs)) ? docs : [];
  const target = pool.find((doc) => {
    if (!doc || doc === ownerDoc || (doc.archiveCtx || null) !== context) return false;
    const path = javaDocPath(doc);
    return javaDocDir(path) === dir && path.split("/").pop().toLowerCase() === want;
  });
  if (!target){
    if (typeof toast === "function") toast(javaTf("{file} 을(를) 이 작업공간에서 찾지 못했어요.", { file:fileName }), 2600);
    return;
  }
  target.pendingFocusLine = line;
  if (typeof setActiveDoc === "function") setActiveDoc(target.id);
  const navigator = target.codeEditor || target.codeViewer;
  if (navigator && typeof navigator.focusLine === "function") navigator.focusLine(line);
}

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

// ── 새 자바 파일 만들기 ─────────────────────────────────────────────────────
// 파이썬·자바스크립트 스크래치와 같은 길을 쓴다(createScratchInFolder·handleFiles) — 폴더 문맥·
// 이름 충돌 회피·사이드바에서 바로 이름 고치기까지 그대로 따라온다.
// 다른 점은 이름 규칙 하나다. 자바는 파일 이름이 곧 public 클래스 이름이라 "새 코드 2.java" 처럼
// 공백이 든 이름을 쓸 수 없다(식별자로 유효하지 않다). 그래서 Main·Main2 를 쓰고, 시작 코드의
// 클래스 이름도 그 파일 이름에 맞춰 찍는다 — 다른 IDE 나 javac 로 그대로 열어도 깨지지 않게.
function javaScratchFileName(number = 1){
  return "Main" + (number > 1 ? number : "") + ".java";
}
function javaScratchStarter(name){
  const cls = String(name || "").replace(/\.java$/i, "") || "Main";
  const prompt = typeof t === "function" ? t("여기에 자바 코드를 작성하고 ▶ 실행") : "여기에 자바 코드를 작성하고 ▶ 실행";
  return "// " + prompt + " (" + shortcutDisplay(shortcutValue("runCode")) + ")\n"
    + "public class " + cls + " {\n"
    + "    public static void main(String[] args) {\n"
    + "        System.out.println(\"Hello, Java!\");\n"
    + "    }\n"
    + "}\n";
}

// 저장된 .java 파일은 수업에서 쓰는 클래스 이름 규칙(영문 대문자로 시작)을 지키고,
// 최상위 public 타입의 이름은 파일 이름과 같아야 한다. 실행기는 소스에 맞춘 임시 파일을 만들어
// 이 불일치를 가려 주므로, 실제 파일 이름을 정하는 모든 경로에서 먼저 검사한다.
const JAVA_FILE_ID_START_RE = /^[A-Z]$/;
const JAVA_FILE_ID_PART_RE = /^[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]$/u;
const JAVA_SOURCE_ID_START = "[\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}]";
const JAVA_SOURCE_ID_PART = "[\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Cf}]";

function javaClassNameFromFile(name){
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  return base.replace(/\.java$/i, "");
}

function javaFileNameValidationMessage(name){
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  if (!/\.java$/i.test(base)) return "자바 파일은 .java 확장자로 저장해야 해요.";
  const cls = javaClassNameFromFile(base);
  if (!cls || !JAVA_FILE_ID_START_RE.test(cls.charAt(0)))
    return "자바 파일 이름(클래스 이름)은 영문 대문자로 시작해야 해요. 예: Student.java";
  for (const ch of cls){
    if (!JAVA_FILE_ID_PART_RE.test(ch))
      return "자바 파일 이름에는 클래스 이름으로 쓸 수 있는 문자만 사용할 수 있어요. 예: Student01.java";
  }
  return "";
}

// 주석·문자열을 같은 길이의 공백으로 가려 선언 위치를 그대로 보존한다. 이름처럼 보이는 주석이나
// 문자열, 내부 클래스는 건드리지 않고 깊이 0의 public class/interface/enum/record 하나만 고른다.
function javaSourceCodeMask(source){
  const src = String(source == null ? "" : source);
  let out = "", i = 0;
  const blank = (ch) => (ch === "\n" || ch === "\r") ? ch : " ";
  while (i < src.length){
    if (src[i] === "/" && src[i + 1] === "/"){
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") out += blank(src[i++]);
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*"){
      out += "  "; i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) out += blank(src[i++]);
      if (i < src.length){ out += "  "; i += 2; }
      continue;
    }
    if (src.slice(i, i + 3) === "\"\"\""){
      out += "   "; i += 3;
      while (i < src.length && src.slice(i, i + 3) !== "\"\"\"") out += blank(src[i++]);
      if (i < src.length){ out += "   "; i += 3; }
      continue;
    }
    if (src[i] === "\"" || src[i] === "'"){
      const quote = src[i]; out += " "; i++;
      while (i < src.length){
        if (src[i] === "\\" && i + 1 < src.length){ out += "  "; i += 2; continue; }
        const ch = src[i]; out += blank(ch); i++;
        if (ch === quote) break;
      }
      continue;
    }
    out += src[i++];
  }
  return out;
}

function javaTopLevelPublicType(source){
  const masked = javaSourceCodeMask(source);
  const re = new RegExp("(?:^|[;}{\\s])public\\s+(?:(?:final|abstract|sealed|non-sealed|strictfp)\\s+)*(?:class|interface|enum|record)\\s+(" + JAVA_SOURCE_ID_START + JAVA_SOURCE_ID_PART + "*)", "gu");
  let scan = 0, depth = 0, match;
  while ((match = re.exec(masked))){
    // 정규식이 선언 앞의 구분 문자(특히 이전 타입의 닫는 중괄호)까지 포함하므로 public 위치까지
    // 깊이를 계산해야 `class Helper {} public class Main {}` 같은 정상 소스도 놓치지 않는다.
    const declarationAt = match.index + match[0].indexOf("public");
    while (scan < declarationAt){
      if (masked[scan] === "{") depth++;
      else if (masked[scan] === "}") depth = Math.max(0, depth - 1);
      scan++;
    }
    if (depth !== 0) continue;
    const relative = match[0].lastIndexOf(match[1]);
    return { name:match[1], start:match.index + relative, end:match.index + relative + match[1].length };
  }
  return null;
}

function javaCodePointBefore(text, index){
  if (index <= 0) return "";
  let start = index - 1;
  const code = text.charCodeAt(start);
  if (code >= 0xDC00 && code <= 0xDFFF && start > 0) start--;
  return text.slice(start, index);
}

function javaCodePointAt(text, index){
  if (index >= text.length) return "";
  const code = text.codePointAt(index);
  return String.fromCodePoint(code);
}

function javaRenameIdentifierInCode(source, oldName, newName){
  const value = String(source == null ? "" : source);
  const masked = javaSourceCodeMask(value);
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gu");
  let out = "", cursor = 0, match;
  while ((match = re.exec(masked))){
    const before = javaCodePointBefore(masked, match.index);
    const after = javaCodePointAt(masked, match.index + oldName.length);
    if ((before && JAVA_FILE_ID_PART_RE.test(before)) || (after && JAVA_FILE_ID_PART_RE.test(after))) continue;
    out += value.slice(cursor, match.index) + newName;
    cursor = match.index + oldName.length;
  }
  return cursor ? out + value.slice(cursor) : value;
}

function javaRenamePublicTypeForFile(source, fileName){
  const value = String(source == null ? "" : source);
  const error = javaFileNameValidationMessage(fileName);
  if (error) return { ok:false, error, value, changed:false, found:false };
  const nextName = javaClassNameFromFile(fileName);
  const type = javaTopLevelPublicType(value);
  if (!type) return { ok:true, error:"", value, changed:false, found:false, className:"" };
  if (type.name === nextName) return { ok:true, error:"", value, changed:false, found:true, className:type.name };
  // 선언뿐 아니라 생성자·new 표현식·정적 멤버 접근처럼 같은 타입 이름을 쓰는 코드 토큰도 바꾼다.
  // 주석과 문자열은 mask에서 공백이므로 예제 설명이나 출력 문구는 그대로 남는다.
  return { ok:true, error:"", value:javaRenameIdentifierInCode(value, type.name, nextName),
    changed:true, found:true, className:nextName, previousClassName:type.name };
}

async function javaPrepareDocumentFileRename(doc, fileName, fallbackSource){
  const error = javaFileNameValidationMessage(fileName);
  if (error) return { ok:false, error, value:String(fallbackSource == null ? "" : fallbackSource), changed:false };
  let source = fallbackSource;
  if (source == null && doc && doc.codeEditor && typeof doc.codeEditor.getValue === "function") source = doc.codeEditor.getValue();
  if (source == null && doc && typeof doc.savedText === "string") source = doc.savedText;
  if (source == null && doc && doc.sourceFile && typeof doc.sourceFile.text === "function") source = await doc.sourceFile.text();
  // 편집기 값과 같은 LF·BOM 없는 모양으로 맞춘 뒤 이름만 바꾼다. 디스크 저장 직전에 원래 개행·BOM을 복원한다.
  source = String(source == null ? "" : source).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return javaRenamePublicTypeForFile(source, fileName);
}

function javaApplyPreparedFileRename(doc, prepared, options={}){
  if (!doc || !prepared || !prepared.ok) return;
  if (prepared.changed && doc.codeEditor && typeof doc.codeEditor.setValue === "function")
    doc.codeEditor.setValue(prepared.value);
  if (options.saved){
    doc.savedText = prepared.value;
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
  } else if (prepared.changed && typeof markDocumentDirty === "function"){
    if (typeof File !== "undefined"){
      const oldFile = doc.sourceFile;
      let fresh = new File([prepared.value], doc.name || "Main.java", {
        type:(oldFile && oldFile.type) || "text/x-java-source",
        lastModified:Date.now()
      });
      if (doc.fsHandle && typeof withFileHandle === "function") fresh = withFileHandle(fresh, doc.fsHandle);
      if (doc.fsDirHandle && typeof withDirHandle === "function") fresh = withDirHandle(fresh, doc.fsDirHandle);
      const rel = String(doc.workspacePath || doc.relPath || "");
      if (rel && rel !== fresh.name){
        try { Object.defineProperty(fresh, "webkitRelativePath", { value:rel, configurable:true }); } catch(_){}
      }
      doc.sourceFile = fresh;
      doc.size = fresh.size;
    }
    markDocumentDirty(doc, true);
  }
}
function createJavaScratchInFolder(folder){
  return createScratchInFolder(folder, javaScratchFileName, javaScratchStarter,
    "text/x-java-source", "새 자바 파일을");
}
// 폴더 우클릭 → 이 폴더 안에 만들기
function newJavaScratchInFolder(folder){
  _scratchCount++;                     // 이름 번호는 파이썬·자바스크립트·표와 한 통으로 센다(code-viewer.js)
  createJavaScratchInFolder(folder);
}
// 사이드바 + 메뉴 → 지금 보고 있는 파일의 폴더가 있으면 그 안에, 없으면 그냥 새 문서로
function newJavaScratch(){
  _scratchCount++;
  const folder = activeFolderContextForNewFile();
  if (folder && createJavaScratchInFolder(folder)) return;
  const name = javaScratchFileName(_scratchCount);
  // 파일 열기와 작업공간 저장을 한 큐에서 처리한다(자바스크립트 쪽과 같은 이유) — handleFiles만 직접
  // 부르면 편집 초안은 남아도 그 초안을 붙일 바탕 문서가 없어 미저장 새 .java 가 자동복원에서 사라진다.
  const file = new File([javaScratchStarter(name)], name, { type:"text/x-java-source" });
  if (typeof queueFiles === "function") queueFiles([file], { isScratch:true });
  else handleFiles([file], { isScratch:true });
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
  // 키워드만으로는 List·Scanner 같은 이름이 안 나온다 — 표준 클래스 이름을 함께 올린다(java-runtime.js).
  for (const word of (typeof JAVA_TYPE_WORDS !== "undefined" ? JAVA_TYPE_WORDS : [])){
    if (baseWords.indexOf(word) < 0) baseWords.push(word);
  }
  const completionWords = baseWords.slice();
  /* 지금 고른 라이브러리가 자동완성에 주는 것을 역할별로 나눠 둔다.
     · 단어 후보(extra) — 직접 받은 jar 에서 서버가 읽어 온 이름까지 전부
     · libraries.words — 손으로 적어 둔 멤버 표를 열어 줄 기본 목록의 이름만
     · libraries.classes — 직접 받은 jar 의 패키지 전체 이름(자동 import 용)
     · libraries.members — 직접 받은 jar 에서 서버가 javap 로 뽑아 온 멤버 표(늦게 도착한다) */
  const libraries = { words:[], classes:[], members:{} };
  let libraryMemberSeq = 0;
  const applyLibraryWords = (libState, libRows) => {
    const extra = javaLibraryCompletionWords(libState, libRows);
    libraries.words = javaLibraryMemberWords(libState, libRows);
    libraries.classes = javaLibraryCompletionClasses(libState, libRows);
    completionWords.length = 0;
    for (const word of baseWords) completionWords.push(word);
    for (const word of extra) completionWords.push(word);
    loadLibraryMembers(libState, libRows);
  };
  /* 기본 목록에 없는(= 손으로 적어 둔 표가 없는) 것만 서버에 묻는다. 처음 한 번은 javap 를 돌리느라
     한동안 걸리므로 기다리지 않고, 도착하면 그때부터 후보에 낀다. 그 사이 고른 것이 바뀌었으면 버린다. */
  const loadLibraryMembers = async (libState, libRows) => {
    const seq = ++libraryMemberSeq;
    const rows = Array.isArray(libRows) ? libRows : [];
    const selected = javaLibraryState(libState).ids;
    const specs = [];
    for (const row of rows){
      if (!row || row.id || !row.installed) continue;
      const spec = row.spec || row.coordinate;
      if (!spec || specs.indexOf(spec) >= 0) continue;
      if (selected.indexOf(row.spec) < 0 && selected.indexOf(row.coordinate) < 0) continue;
      specs.push(spec);
    }
    const next = {};
    for (const spec of specs){
      const table = await javaLibraryMembers(spec);
      if (seq !== libraryMemberSeq) return;
      for (const name of Object.keys(table)) next[name] = table[name];
    }
    libraries.members = next;
  };

  const editor = buildCodeEditor(initial, prof, {
    // 파이썬 전용 지능(Jedi 질의·import 문맥)을 끄고 확장자에 맞는 키워드를 쓴다.
    // fileExt 만 넘기면 공용 목록에서 자바 키워드를 골라 준다(core.js 의 completionWordsForProfile).
    plain: true,
    fileExt: ext,
    completionWords,
    // 점 뒤 후보 — sc.nextInt(), list.add() … 선언한 타입을 보고 고른다(java-runtime.js).
    // 고른 라이브러리의 클래스(gson.toJson() 등)까지 같은 길에서 답한다.
    memberCandidates: (source, receiver, prefix) => javaMemberCompletionCandidates(source, receiver, prefix, libraries),
    /* List 를 고르면 java.util.List 를 위에 적어 준다 — 자바 수업의 첫 벽이 "import 를 안 적어서" 나는
       오류다. 넣을 자리를 정하는 규칙(importPlanner)만 자바 것을 주고 장치는 파이썬 쪽 것을 그대로 쓴다. */
    importCandidates: (source, prefix) => javaImportCandidates(source, prefix, libraries),
    importPlanner: JAVA_IMPORT_PLANNER,
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
  // 실행 결과 위치 토글(편집기 옆 ↔ 아래) — 파이썬 실행 화면과 같은 버튼. 결과가 한 번 보인 뒤에만 노출한다.
  const layoutBtn = document.createElement("button"); layoutBtn.className = "run-layout"; layoutBtn.type = "button"; layoutBtn.hidden = true;
  const status = document.createElement("span"); status.className = "run-status";
  bar.append(runBtn, gradeBtn, libBtn, envBtn, saveBtn, revertBtn, layoutBtn, status);
  if (typeof syncShortcutHints === "function") syncShortcutHints(bar);

  // ── 좌(편집기) · 우(실행 결과) 분할 ──
  const split = document.createElement("div"); split.className = "run-split";
  const divider = document.createElement("div"); divider.className = "run-divider";
  divider.setAttribute("role", "separator"); divider.setAttribute("aria-orientation", "vertical"); divider.tabIndex = 0;
  const outPanel = document.createElement("div"); outPanel.className = "code-output";
  outPanel.tabIndex = 0; outPanel.setAttribute("aria-label", "실행 결과");

  /* 결과 숨기기는 실행 바가 아니라 결과 칸 오른쪽 위에 둔다(파이썬 실행 화면과 같은 자리·같은 모양).
     자바 결과 렌더러들은 outPanel.innerHTML 을 통째로 갈아끼우므로, 붙여 둔 버튼도 함께 지워진다.
     그래서 out-chrome 표시를 달아 두고 childList 를 지켜보다가 새 헤더에 다시 붙인다. */
  const outHideBtn = document.createElement("button"); outHideBtn.className = "out-hide"; outHideBtn.type = "button";
  const outHeadActions = document.createElement("span"); outHeadActions.className = "out-head-actions out-chrome";
  outHeadActions.append(outHideBtn);
  const syncOutputHideButton = (stacked) => {
    const label = javaT("실행 결과 숨기기");
    outHideBtn.title = label; outHideBtn.setAttribute("aria-label", label);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // 접히는 방향을 그대로 가리킨다 — 아래에 쌓였으면 ∨, 오른쪽에 있으면 >
    path.setAttribute("d", stacked ? "M7 9l5 5 5-5" : "M9 7l5 5-5 5");
    svg.appendChild(path); outHideBtn.replaceChildren(svg);
  };
  const attachOutputChrome = () => {
    const head = outPanel.querySelector(".out-head");
    if (head){
      if (outHeadActions.parentNode !== head) head.appendChild(outHeadActions);
    } else if (outHeadActions.parentNode !== outPanel){
      outPanel.insertBefore(outHeadActions, outPanel.firstChild);
    }
  };
  const outputChromeObserver = new MutationObserver(attachOutputChrome);
  outputChromeObserver.observe(outPanel, { childList:true, subtree:true });
  outPanel.appendChild(outHeadActions);

  split.append(editor.host, divider, outPanel);
  attachRunSplitter(split, divider);

  // 결과를 편집기 옆(가로) ↔ 아래(세로)로. 고른 방향은 다음에 열 때도 유지한다(파이썬과 키는 따로 둔다).
  let outputStacked = false;
  try { outputStacked = localStorage.getItem("javaSplitDir") === "col"; } catch(_){}
  const applyOutputLayout = () => {
    split.classList.toggle("stack-v", outputStacked);
    divider.setAttribute("aria-orientation", outputStacked ? "horizontal" : "vertical");
    layoutBtn.textContent = outputStacked ? "Side" : "Below";
    layoutBtn.title = javaT(outputStacked ? "실행 결과를 편집기 오른쪽 옆으로" : "실행 결과를 편집기 아래로");
    layoutBtn.setAttribute("aria-label", layoutBtn.title);
    syncOutputHideButton(outputStacked);
  };
  applyOutputLayout();

  outer.append(bar, split);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);
  host.appendChild(outer);

  const ui = {
    btn: runBtn, gradeBtn, status, outPanel, split, editorTa: editor.ta,
    fileBase: saveName,
    markError: (line) => editor.markError(line),
    // 저장 검사는 오류를 여러 개 한꺼번에 준다 — 줄 번호만 넘기면 설명·심각도·칸이 버려지므로
    // 파이썬 진단과 같은 통로(setDiagnosticItems)로 넘겨 호버 설명까지 살린다.
    setDiagnosticItems: (items) => editor.setDiagnosticItems(items),
    focusLine: (line) => editor.focusLine(line),
    // 실행·채점·저장 검사가 같은 형제 목록을 본다 — 한 곳만 알면 서로 다른 답을 낸다.
    siblingSources: () => javaSiblingSources(ownerDoc),
    openSiblingLine: (fileName, line) => openJavaSiblingLine(ownerDoc, fileName, line),
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
  outHideBtn.addEventListener("click", () => {
    split.classList.remove("show-out");
    editor.ta.focus({ preventScroll:true });
  });
  layoutBtn.addEventListener("click", () => {
    outputStacked = !outputStacked;
    try { localStorage.setItem("javaSplitDir", outputStacked ? "col" : "row"); } catch(_){}
    applyOutputLayout();
    split.classList.add("show-out");        // 위치를 고르는 순간 결과 칸을 다시 보여 준다
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
  // 결과가 한 번 보이면 위치 토글을 꺼내 둔다 — 숨긴 뒤에도 다음 실행 위치를 미리 고를 수 있게 남긴다.
  const observer = new MutationObserver(() => {
    if (split.classList.contains("show-out")) layoutBtn.hidden = false;
  });
  observer.observe(split, { attributes:true, attributeFilter:["class"] });

  /* 저장 검사 — 저장이 끝난 뒤 그 내용 그대로 javac 를 돌려 오류 줄을 표시한다.
     수동 저장에만 건다(자동 저장은 입력이 멈추고 3초마다 도므로 치는 도중의 코드를 계속 컴파일하게 된다).
     저장을 붙들지 않고 뒤따라 돌며, 실패해도 저장 결과에는 손대지 않는다. */
  let checkSeq = 0, checkClearTimer = 0;
  const runSaveCheck = async (value) => {
    if (disposed || ui.running) return;
    const seq = ++checkSeq;
    clearTimeout(checkClearTimer);
    status.textContent = javaT("검사 중…");
    let report = null;
    try {
      report = await checkJavaSource(value, ui, {
        libs:libraryPicker.getQuery(),
        extras:await javaSiblingSources(ownerDoc)   // 같은 폴더의 형제 .java 도 함께 컴파일한다
      });
    }
    catch(error){ console.warn("java save check failed:", error); }
    if (disposed || seq !== checkSeq || ui.running) return;
    if (!report){ refreshEditState(); return; }   // 자바 없음·검사 실패 → 원래 상태 표시로 되돌린다
    status.textContent = report.total
      ? javaTf("오류 {errors}개 · 경고 {warnings}개", { errors:report.errors, warnings:report.warnings })
      : javaT("검사 통과");
    if (!report.total){
      // 통과 메시지는 잠깐만 둔다 — 저장 뒤의 빈 상태 줄이 이 화면의 기본 모습이다.
      checkClearTimer = setTimeout(() => { if (!disposed && seq === checkSeq && !ui.running) refreshEditState(); }, 1800);
    }
  };

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      const value = editor.getValue();
      const ok = await saveTextDoc(value, ownerDoc, (ownerDoc && ownerDoc.name) || saveName);
      if (ok !== true) return;
      // 저장창에서 파일명을 바꾸면 saveTextDoc이 public 클래스명도 고쳐 쓴다. 그 최종 값을
      // 저장 기준과 복구 스냅샷에 써야 방금 저장한 문서가 다시 '저장 안 됨'으로 보이지 않는다.
      const writtenValue = ownerDoc && typeof ownerDoc.savedText === "string" ? ownerDoc.savedText : editor.getValue();
      savedValue = writtenValue;
      clearTimeout(draftTimer);
      clearTimeout(autosaveTimer); autosaveTimer = 0;
      clearPythonDraft(draftKey);
      // saveTextDoc 은 디스크에만 쓰므로 자동 복원용 작업공간 사본을 저장한 내용으로 맞춘다.
      if (ownerDoc && typeof markDocumentSavedSnapshot === "function"){
        await markDocumentSavedSnapshot(ownerDoc, new TextEncoder().encode(writtenValue), "text/plain;charset=utf-8");
      }
      refreshEditState();
      runSaveCheck(writtenValue);
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
      checkSeq++; clearTimeout(checkClearTimer);
      observer.disconnect();
      outputChromeObserver.disconnect();
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
