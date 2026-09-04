"use strict";

// .java 실행 화면. 파이썬·자바스크립트 실행 화면과 같은 뼈대(실행 바 + 좌우 분할 + 출력 패널)를 쓰되,
// 실행기는 EXE 런처의 로컬 JDK(java-runtime.js)다. 입력값은 별도 칸 대신 대화형 터미널로 받는다 —
// 자바 수업은 Scanner 로 한 줄씩 주고받는 예제가 대부분이라 파이썬 쪽과 같은 방식이 자연스럽다.
// 편집기·초안·저장·분할선은 파이썬 쪽 공용 함수를 그대로 재사용한다.

const JAVA_DRAFT_DELAY = 700;      // 편집이 멈춘 뒤 초안(localStorage) 저장까지 기다리는 시간
const JAVA_AUTOSAVE_DELAY = 3000;  // 편집이 멈춘 뒤 파일 자동 저장까지(텍스트 편집기와 같은 간격)
const JAVA_GRADE_PREFIX = "classdock-java-grade:";   // 파일마다 채점 테스트를 저장하는 키(다른 언어와 분리)
const JAVA_LINT_PREFIX = "classdock-java-lint:";     // 실행 구성의 -Xlint 선택도 파일마다 따로 기억
const JAVA_MAIN_PREFIX = "classdock-java-main:";     // main 이 여러 개인 파일에서 고른 실행 대상

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

// 실행 구성에는 본문 전체가 아니라 함께 컴파일될 파일 이름만 보여 준다.
function javaSiblingFileNames(ownerDoc){
  if (!ownerDoc || typeof docs === "undefined" || !Array.isArray(docs)) return [];
  const context = ownerDoc.archiveCtx || null;
  const dir = javaDocDir(javaDocPath(ownerDoc));
  const names = [];
  for (const doc of docs){
    if (!doc || doc === ownerDoc) continue;
    if (typeof workspaceHasDoc === "function" && !workspaceHasDoc(doc)) continue;
    if ((doc.archiveCtx || null) !== context) continue;
    if (String(doc.sourceKey || "").startsWith("definition:")) continue;
    const path = javaDocPath(doc);
    if (!/\.java$/i.test(path) || javaDocDir(path) !== dir) continue;
    names.push(path.split("/").pop());
    if (names.length >= JAVA_SIBLING_MAX) break;
  }
  return names;
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

// Python의 Py Env와 같은 작은 모달. 실행 결과는 프로그램 출력만 맡고,
// JDK 확인·설치는 이 창 안에서 끝낸다.
function openJavaEnvModal(btn){
  const modal = document.createElement("div"); modal.className = "modal py-env-modal java-env-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const panel = document.createElement("div"); panel.className = "py-env-panel";
  const actions = document.createElement("div"); actions.className = "modal-actions";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "닫기";
  let closed = false, guide = null, refreshSeq = 0;

  const disposeGuide = () => {
    if (guide && typeof guide.dispose === "function") guide.dispose();
    guide = null;
  };
  const close = () => {
    if (closed) return;
    closed = true; refreshSeq++; disposeGuide();
    window.removeEventListener("keydown", onKey, true);
    modal.remove();
    if (btn && document.contains(btn)) setTimeout(() => {
      try { btn.focus({ preventScroll:true }); } catch(_){ btn.focus(); }
    }, 0);
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); close();
  };
  const refresh = async () => {
    const seq = ++refreshSeq;
    disposeGuide();
    panel.innerHTML = '<div class="py-env-head"><span>자바 실행 환경</span><span class="py-env-muted">확인 중…</span></div>';
    const info = await javaEnvironmentDetails();
    if (closed || seq !== refreshSeq) return;
    panel.replaceChildren();
    if (!info.ok){
      guide = renderJavaInstallGuide(panel, () => { if (!closed) refresh(); });
      return;
    }
    const head = document.createElement("div"); head.className = "py-env-head";
    const title = document.createElement("span"); title.textContent = "자바 실행 환경";
    const state = document.createElement("span"); state.className = "py-env-ok"; state.textContent = "JDK 사용 가능";
    head.append(title, state);
    const list = document.createElement("dl"); list.className = "py-env-grid";
    const rows = [
      ["버전", info.version || (info.major ? "Java " + info.major : "-")],
      ["경로", info.path || "-"],
      ["찾은 곳", javaSourceLabel(info.source) || info.source || "-"],
      ["최소 버전", "JDK " + (info.minimum || 11) + "+"]
    ];
    rows.forEach(([label, value]) => {
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = value;
      list.append(dt, dd);
    });
    panel.append(head, list);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(panel);
  };

  cancel.addEventListener("click", close);
  actions.append(spacer, cancel); card.append(panel, actions); modal.appendChild(card);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.body.appendChild(modal);
  window.addEventListener("keydown", onKey, true);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(actions);
  refresh();
  setTimeout(() => { if (!closed) cancel.focus(); }, 0);
}

// Python 실행 결과와 같은 찾기 UI. 결과 렌더러가 내용을 갈아끼워도 헤더·검색바를 다시 붙인다.
function attachJavaOutputFind(options){
  const { outPanel, outHeadActions, attachOutputChrome } = options;
  const findBtn = document.createElement("button"); findBtn.className = "out-find-open"; findBtn.type = "button";
  findBtn.setAttribute("aria-haspopup", "true"); findBtn.setAttribute("aria-expanded", "false");
  findBtn.dataset.shortcutAction = "findInDocument";
  findBtn.dataset.shortcutTitle = "실행 결과에서 찾기";
  findBtn.dataset.shortcutAria = "true";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "10.5"); circle.setAttribute("cy", "10.5"); circle.setAttribute("r", "6");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "m15 15 5 5");
  icon.append(circle, path); findBtn.appendChild(icon); outHeadActions.prepend(findBtn);

  const bar = document.createElement("div"); bar.className = "out-find-bar out-chrome"; bar.hidden = true;
  const input = document.createElement("input"); input.className = "out-find-input"; input.type = "search";
  input.autocomplete = "off"; input.spellcheck = false;
  const count = document.createElement("span"); count.className = "out-find-count";
  const prev = document.createElement("button"); prev.className = "out-find-nav"; prev.type = "button"; prev.textContent = "↑";
  const next = document.createElement("button"); next.className = "out-find-nav"; next.type = "button"; next.textContent = "↓";
  const closeBtn = document.createElement("button"); closeBtn.className = "out-find-close"; closeBtn.type = "button"; closeBtn.textContent = "✕";
  bar.append(input, count, prev, next, closeBtn);
  const layer = document.createElement("div"); layer.className = "out-find-layer out-chrome"; layer.setAttribute("aria-hidden", "true");

  let open = false, matches = [], index = -1, truncated = false, timer = 0, raf = 0;
  const LIMIT = 2000;
  const label = javaT("실행 결과에서 찾기");
  input.placeholder = label; input.setAttribute("aria-label", label);
  prev.title = javaT("이전 결과") + " (Shift+Enter)"; next.title = javaT("다음 결과") + " (Enter)";
  closeBtn.title = javaT("닫기 (Esc)");
  if (typeof syncShortcutHints === "function") syncShortcutHints(outHeadActions);
  else { findBtn.title = label + " (Ctrl+F)"; findBtn.setAttribute("aria-label", findBtn.title); }

  const isChrome = (node) => {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(element && (element.classList.contains("out-chrome") || element.closest(".out-chrome")));
  };
  const attach = () => {
    attachOutputChrome();
    const head = outPanel.querySelector(".out-head");
    if (head){
      const parent = head.parentNode || outPanel;
      if (bar.parentNode !== parent || bar.previousElementSibling !== head) head.insertAdjacentElement("afterend", bar);
    } else if (bar.parentNode !== outPanel){
      outPanel.insertBefore(bar, outHeadActions.nextSibling);
    }
    if (layer.parentNode !== outPanel) outPanel.appendChild(layer);
  };
  const clearHighlights = () => layer.replaceChildren();
  const renderHighlights = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0; clearHighlights();
      if (!open || !matches.length) return;
      const panelRect = outPanel.getBoundingClientRect();
      const head = outPanel.querySelector(".out-head");
      const visibleTop = Math.max(panelRect.top, !bar.hidden ? bar.getBoundingClientRect().bottom
        : (head ? head.getBoundingClientRect().bottom : panelRect.top));
      const frag = document.createDocumentFragment();
      matches.forEach((match, matchIndex) => {
        Array.from(match.range.getClientRects()).forEach((rect) => {
          if (!rect.width || !rect.height || rect.bottom <= visibleTop || rect.top >= panelRect.bottom ||
              rect.right <= panelRect.left || rect.left >= panelRect.right) return;
          const box = document.createElement("span");
          box.className = "out-find-hit" + (matchIndex === index ? " active" : "");
          const left = Math.max(rect.left, panelRect.left), right = Math.min(rect.right, panelRect.right);
          const top = Math.max(rect.top, visibleTop), bottom = Math.min(rect.bottom, panelRect.bottom);
          box.style.left = (left - panelRect.left + outPanel.scrollLeft) + "px";
          box.style.top = (top - panelRect.top + outPanel.scrollTop) + "px";
          box.style.width = (right - left) + "px"; box.style.height = (bottom - top) + "px";
          frag.appendChild(box);
        });
      });
      layer.appendChild(frag);
    });
  };
  const allowed = (node) => {
    const element = node && node.parentElement;
    if (!element || isChrome(element)) return false;
    if (element.closest(".out-head,.out-vars,.code-pen-overlay,button,input,textarea,select,script,style,svg,[hidden]")) return false;
    const closed = element.closest("details:not([open])");
    if (closed && !element.closest("summary")) return false;
    return !!element.getClientRects().length;
  };
  const updateCount = () => {
    count.textContent = !input.value ? "" : (!matches.length ? "0/0" : (index + 1) + "/" + matches.length + (truncated ? "+" : ""));
  };
  const recompute = (reset) => {
    clearTimeout(timer); timer = 0; matches = []; truncated = false;
    const query = input.value;
    if (open && query){
      const needle = query.toLocaleLowerCase();
      const walker = document.createTreeWalker(outPanel, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => allowed(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      let node;
      outer: while ((node = walker.nextNode())){
        const text = String(node.nodeValue || "").toLocaleLowerCase();
        let from = 0, at;
        while ((at = text.indexOf(needle, from)) !== -1){
          const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + query.length);
          matches.push({ range });
          if (matches.length >= LIMIT){ truncated = true; break outer; }
          from = at + Math.max(1, query.length);
        }
      }
    }
    index = matches.length ? (reset ? 0 : Math.max(0, Math.min(index, matches.length - 1))) : -1;
    updateCount(); renderHighlights();
  };
  const schedule = (reset, delay=90) => {
    clearTimeout(timer); timer = setTimeout(() => recompute(reset), delay);
  };
  const scrollToMatch = () => {
    const match = matches[index]; if (!match) return;
    const rect = match.range.getBoundingClientRect(), panelRect = outPanel.getBoundingClientRect();
    const head = outPanel.querySelector(".out-head");
    const chromeBottom = !bar.hidden ? bar.getBoundingClientRect().bottom
      : (head ? head.getBoundingClientRect().bottom : panelRect.top);
    if (rect.top < chromeBottom + 6 || rect.bottom > panelRect.bottom - 8){
      const height = Math.max(0, panelRect.bottom - chromeBottom);
      outPanel.scrollTop += rect.top - (chromeBottom + Math.max(8, (height - rect.height) * .4));
    }
  };
  const move = (delta) => {
    if (!matches.length){ updateCount(); return; }
    index = (index + delta + matches.length) % matches.length;
    updateCount(); renderHighlights(); requestAnimationFrame(scrollToMatch);
  };
  const selectionSeed = () => {
    try {
      const selection = window.getSelection && window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount ||
          !outPanel.contains(selection.anchorNode) || !outPanel.contains(selection.focusNode)) return "";
      const value = String(selection).trim();
      return value && !value.includes("\n") && value.length <= 200 ? value : "";
    } catch(_){ return ""; }
  };
  const history = (typeof MNSearchHistory === "object" && MNSearchHistory)
    ? MNSearchHistory.attach(input, { scope:"text", mount:bar, className:"search-history-row", onPick:() => schedule(true, 0) })
    : null;
  const remember = () => { if (history) history.remember(input.value); };
  const openFind = (seed) => {
    attach(); open = true; bar.hidden = false; findBtn.setAttribute("aria-expanded", "true");
    const selected = typeof seed === "string" ? seed : selectionSeed();
    if (selected && selected !== input.value) input.value = selected;
    else if (!input.value && history) input.value = MNSearchHistory.last("text");
    recompute(true); input.focus(); input.select();
  };
  const closeFind = (restoreFocus=true) => {
    open = false; bar.hidden = true; findBtn.setAttribute("aria-expanded", "false");
    matches = []; index = -1; truncated = false; clearHighlights(); updateCount();
    if (restoreFocus) findBtn.focus({ preventScroll:true });
  };
  const observer = new MutationObserver((records) => {
    attach();
    if (!open) return;
    const changed = records.some((record) => {
      if (isChrome(record.target)) return false;
      const nodes = Array.from(record.addedNodes).concat(Array.from(record.removedNodes));
      return !nodes.length || !nodes.every(isChrome);
    });
    if (changed) schedule(false, 120);
  });
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (open) renderHighlights(); }) : null;
  const onScroll = () => { if (open) renderHighlights(); };
  const onToggle = (event) => { if (open && event.target && event.target.matches("details")) schedule(false, 0); };
  outPanel.addEventListener("scroll", onScroll, { passive:true });
  outPanel.addEventListener("toggle", onToggle, true);
  outPanel.append(bar, layer); observer.observe(outPanel, { childList:true, subtree:true });
  if (resizeObserver) resizeObserver.observe(outPanel);
  findBtn.addEventListener("click", () => open ? closeFind(false) : openFind());
  input.addEventListener("input", (event) => { if (!event.isComposing) schedule(true); });
  input.addEventListener("compositionend", () => schedule(true, 0));
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter"){ event.preventDefault(); remember(); move(event.shiftKey ? -1 : 1); }
    else if (event.key === "Escape"){ event.preventDefault(); closeFind(); }
  });
  prev.addEventListener("click", () => { remember(); move(-1); input.focus(); });
  next.addEventListener("click", () => { remember(); move(1); input.focus(); });
  closeBtn.addEventListener("click", () => closeFind());
  attach();
  return {
    open:openFind, close:closeFind, selectionSeed,
    refresh:() => { if (open) renderHighlights(); },
    destroy:() => {
      clearTimeout(timer); cancelAnimationFrame(raf); observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      outPanel.removeEventListener("scroll", onScroll);
      outPanel.removeEventListener("toggle", onToggle, true);
      if (history) history.destroy();
    }
  };
}

/* 실행에 함께 넣을 라이브러리(jar) 고르기. 자바스크립트 쪽 라이브러리 팝오버(buildJsLibraryPicker)와
   같은 자리·같은 조작이라 화면 모양(run-pkg-wrap·js-library-*)도 그대로 쓴다.
   다른 점은 목록의 출처다 — 카탈로그와 설치 여부를 모두 런처가 알려 주므로 여기서는 그리기만 한다. */
function buildJavaLibraryPicker(bar, button, storageKey, options){
  options = options || {};
  let state = loadJavaLibraryState(storageKey);
  let rows = [];                 // 카탈로그 + 카탈로그에 없는 설치본
  let searchRows = [];
  let searchRequestId = 0;
  let loaded = false, busy = false, searching = false, confirming = false, destroyed = false;
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

  const searchForm = document.createElement("div"); searchForm.className = "js-npm-form java-library-search-form";
  const searchInput = document.createElement("input"); searchInput.type = "search";
  searchInput.placeholder = "라이브러리 검색 (예: lombok)";
  searchInput.autocomplete = "off"; searchInput.spellcheck = false;
  const searchBtn = document.createElement("button"); searchBtn.type = "button"; searchBtn.className = "pkg-set"; searchBtn.textContent = "검색";
  searchForm.append(searchInput, searchBtn);
  const searchStatus = document.createElement("div"); searchStatus.className = "js-npm-status java-library-search-status";
  searchStatus.textContent = "영문 라이브러리 이름으로 Maven Central을 검색할 수 있어요.";
  const searchList = document.createElement("div"); searchList.className = "js-npm-list java-library-search-results"; searchList.hidden = true;

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
  panel.append(intro, status, list, searchForm, searchStatus, searchList, form, warning, progress, note);
  bar.appendChild(panel);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(panel);

  const detachOutside = () => {
    if (!outsideClose) return;
    document.removeEventListener("pointerdown", outsideClose, true);
    outsideClose = null;
  };
  // 확인 모달을 누르는 순간은 panel 바깥 pointerdown 이지만 설치 흐름의 일부다. 그때나 설치 중에는
  // 팝오버를 닫지 않아 진행 기록과 성공·실패 결과가 사라지지 않게 한다.
  const close = (force) => {
    if (!force && (confirming || busy)) return false;
    panel.hidden = true; button.setAttribute("aria-expanded", "false"); detachOutside(); return true;
  };
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
      select.disabled = busy || searching;
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
        remove.disabled = busy || searching;
        remove.addEventListener("click", () => remove.disabled ? null : erase(row));
        line.appendChild(remove);
      }
      list.appendChild(line);
    }
    renderSearch();
  };

  const renderSearch = () => {
    searchList.replaceChildren();
    searchList.hidden = !searchRows.length;
    for (const row of searchRows){
      const line = document.createElement("div"); line.className = "js-npm-row java-library-search-row";
      const select = document.createElement("button"); select.type = "button"; select.className = "js-npm-select";
      const name = document.createElement("strong");
      name.textContent = (row.curated ? "★ " : row.exact ? "✓ " : "") + (row.label || row.artifact);
      const meta = document.createElement("small");
      meta.textContent = row.group + " · " + (row.version || javaT("버전 확인 필요"));
      select.append(name, meta);
      select.title = row.group + ":" + row.artifact + ":" + row.version;
      select.disabled = busy;
      select.addEventListener("click", () => { if (!select.disabled) installSearchResult(row); });
      line.appendChild(select); searchList.appendChild(line);
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

  const install = async (spec, label, dependencyInfo) => {
    if (busy) return;
    confirming = true;
    let allow = true;
    try {
      let confirmation = javaTf("Maven Central에서 ‘{name}’ 라이브러리(jar)를 내려받아 이 컴퓨터에 보관합니다.\n\n받은 파일은 배포처가 알려준 검증값과 대조합니다. 이 코드는 실행할 때 함께 동작하니 믿을 수 있는 것만 받으세요.",
        { name:label });
      if (dependencyInfo && dependencyInfo.dependencyKnown && dependencyInfo.dependencyCount > 0){
        confirmation += "\n\n" + javaTf("직접 의존성 {count}개가 있습니다. 이 화면은 딸린 라이브러리를 자동으로 받지 않으므로 추가 설치가 필요할 수 있어요.",
          { count:dependencyInfo.dependencyCount });
      }
      allow = typeof confirmDialog === "function"
        ? await confirmDialog(confirmation, javaT("받기"), javaT("취소"))
        : true;
    } finally { confirming = false; }
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
      const installedRow = rows.find((row) => row.coordinate === spec || row.id === spec);
      const selectedSpec = installedRow ? specOf(installedRow) : spec;
      if (state.ids.indexOf(selectedSpec) < 0) commit(state.ids.concat([selectedSpec]));
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

  const installSearchResult = async (row) => {
    if (busy) return;
    // 즉시 표시한 추천 항목을 누르면 뒤에서 진행 중인 외부 검색 결과는 더 이상 화면을 바꾸지 않는다.
    if (searching){ searchRequestId++; searching = false; searchBtn.disabled = false; searchInput.disabled = false; }
    searching = true; searchBtn.disabled = true; searchInput.disabled = true; render();
    searchStatus.textContent = javaT("최신 안정 버전과 의존성을 확인하는 중…");
    try {
      const resolved = row.resolved ? {
        coordinate:row.group + ":" + row.artifact + ":" + row.version,
        version:row.version,
        dependencyKnown:row.dependencyKnown,
        dependencyCount:row.dependencyCount
      } : await javaLibraryResolve(row.group, row.artifact);
      if (destroyed) return;
      const existing = rows.find((item) => item.coordinate === resolved.coordinate);
      if (existing && existing.installed){
        const selectedSpec = specOf(existing);
        if (state.ids.indexOf(selectedSpec) < 0) commit(state.ids.concat([selectedSpec]));
        if (typeof toast === "function") toast(javaTf("{name} 를 이 문서에 적용했어요.", { name:existing.label || resolved.coordinate }), 2600);
        searchStatus.textContent = javaT("이미 받은 라이브러리를 이 문서에 적용했어요.");
        return;
      }
      searchStatus.textContent = resolved.dependencyKnown
        ? javaTf("최신 {version} · 직접 의존성 {count}개", { version:resolved.version, count:resolved.dependencyCount })
        : javaTf("최신 {version} · 의존성 정보는 확인하지 못했어요.", { version:resolved.version });
      await install(resolved.coordinate, (row.label || row.artifact) + " " + resolved.version, resolved);
    } catch(error){
      if (destroyed) return;
      searchStatus.textContent = javaTf("검색 결과를 준비하지 못했어요: {message}", { message:(error && error.message) || error });
      if (typeof toast === "function") toast((error && error.message) || String(error), 4200, { type:"error" });
    } finally {
      searching = false; searchBtn.disabled = false; searchInput.disabled = false;
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
  searchBtn.addEventListener("click", async () => {
    const query = searchInput.value.trim();
    if (!javaLibraryValidSearch(query)){
      if (typeof toast === "function") toast(javaT("검색어는 영문 이름 2~80자로 적어 주세요."), 3000);
      searchInput.focus(); return;
    }
    const requestId = ++searchRequestId;
    const localRows = javaLibraryLocalSearch(query, rows);
    searchRows = localRows;
    searching = true; searchBtn.disabled = true; searchInput.disabled = true; render();
    searchStatus.textContent = localRows.length
      ? javaTf("추천 항목 {count}개를 먼저 표시했어요. Maven Central에서 추가 결과를 찾는 중…", { count:localRows.length })
      : javaT("Maven Central을 검색하는 중…");
    try {
      const result = await javaLibrarySearch(query);
      if (destroyed || requestId !== searchRequestId) return;
      searchRows = javaLibraryMergeSearchRows(localRows, result.rows);
      searchStatus.textContent = searchRows.length
        ? javaTf("검색 결과 {count}개 · ★는 ClassDock 추천 항목입니다.", { count:searchRows.length })
        : javaT("검색 결과가 없어요. 다른 이름으로 검색해 보세요.");
    } catch(error){
      if (destroyed || requestId !== searchRequestId) return;
      searchRows = localRows;
      searchStatus.textContent = localRows.length
        ? javaT("추천 항목만 표시했어요. Maven Central 추가 검색은 응답이 늦거나 연결되지 않았습니다.")
        : javaTf("검색하지 못했어요: {message}", { message:(error && error.message) || error });
    } finally {
      if (requestId === searchRequestId){
        searching = false; searchBtn.disabled = false; searchInput.disabled = false;
        if (!destroyed) render();
      }
    }
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing){ e.preventDefault(); searchBtn.click(); }
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
      if (confirming || busy) return;
      close();
    };
    document.addEventListener("pointerdown", outsideClose, true);
  });
  const onKey = (event) => {
    if (event.key !== "Escape" || panel.hidden || confirming || busy) return;
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
    destroy(){ destroyed = true; close(true); bar.removeEventListener("keydown", onKey); panel.remove(); }
  };
}

function javaRunSourceInfo(source, fallbackName){
  const masked = javaSourceCodeMask(source);
  const packageMatch = masked.match(/^\s*package\s+([\p{L}_$][\p{L}\p{N}_$]*(?:\s*\.\s*[\p{L}_$][\p{L}\p{N}_$]*)*)\s*;/mu);
  const packageName = packageMatch ? packageMatch[1].replace(/\s+/g, "") : "(기본 패키지)";
  const fallback = String(fallbackName || "Main.java").replace(/\.java$/i, "") || "Main";
  const mainRe = /\bstatic\s+void\s+main\s*\(\s*(?:java\s*\.\s*lang\s*\.\s*)?String\s*(?:\[\s*\]|\.\.\.)/u;
  const typeRe = new RegExp("(?:^|[;}{\\s])((?:public\\s+)?(?:(?:final|abstract|sealed|non-sealed|strictfp)\\s+)*(?:class|interface|enum|record)\\s+(" + JAVA_SOURCE_ID_START + JAVA_SOURCE_ID_PART + "*))", "gu");
  const types = [];
  let scan = 0, depth = 0, match;
  while ((match = typeRe.exec(masked))){
    const declarationAt = match.index + match[0].indexOf(match[1]);
    while (scan < declarationAt){
      if (masked[scan] === "{") depth++;
      else if (masked[scan] === "}") depth = Math.max(0, depth - 1);
      scan++;
    }
    if (depth !== 0) continue;
    const open = masked.indexOf("{", typeRe.lastIndex);
    if (open < 0) continue;
    let end = open + 1, bodyDepth = 1;
    while (end < masked.length && bodyDepth){
      if (masked[end] === "{") bodyDepth++;
      else if (masked[end] === "}") bodyDepth--;
      end++;
    }
    types.push({ name:match[2], isPublic:/\bpublic\b/u.test(match[1]), hasMain:mainRe.test(masked.slice(open + 1, end - 1)) });
  }
  const launchType = types.find(type => type.hasMain) || types.find(type => type.isPublic) || types[0] || { name:fallback, hasMain:false };
  const typeName = launchType.name;
  const hasMain = !!launchType.hasMain;
  return {
    packageName,
    mainClass:hasMain ? (packageMatch ? packageName + "." : "") + typeName : "찾지 못함",
    typeName,
    hasMain,
    mainTypes:types.filter(type => type.hasMain).map(type => type.name)
  };
}

// 현재 실행이 무엇을 묶어 javac/java 에 넘기는지 한눈에 보여 주는 작은 팝오버.
function buildJavaRunConfigPopover(bar, button, storageKey, options){
  options = options || {};
  const lintKey = JAVA_LINT_PREFIX + storageKey;
  const mainKey = JAVA_MAIN_PREFIX + storageKey;
  let lint = false, destroyed = false, outsideClose = null, refreshSeq = 0;
  let selectedMain = "";
  try { lint = localStorage.getItem(lintKey) === "1"; } catch(_){}
  try { selectedMain = localStorage.getItem(mainKey) || ""; } catch(_){}

  const panel = document.createElement("section"); panel.className = "run-pkg-wrap java-run-config"; panel.hidden = true;
  panel.setAttribute("aria-label", "자바 실행 구성");
  const head = document.createElement("div"); head.className = "java-run-config-head";
  const title = document.createElement("strong"); title.textContent = "실행 구성";
  const hint = document.createElement("span"); hint.textContent = "현재 문서 기준";
  head.append(title, hint);
  const grid = document.createElement("dl"); grid.className = "java-run-config-grid";
  const addRow = (label, className) => {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.className = className || "";
    grid.append(dt, dd); return dd;
  };
  const mainValue = addRow("main 클래스", "java-config-main");
  const packageValue = addRow("패키지", "java-config-package");
  const siblingValue = addRow("함께 컴파일", "java-config-siblings");
  const libraryValue = addRow("라이브러리", "java-config-libraries");
  const jdkValue = addRow("JDK", "java-config-jdk");
  const tempValue = addRow("실행 폴더", "java-config-temp");
  tempValue.textContent = "ClassDock 임시 폴더 · 실행 후 자동 정리";
  const lintLabel = document.createElement("label"); lintLabel.className = "java-run-config-lint";
  const lintInput = document.createElement("input"); lintInput.type = "checkbox"; lintInput.checked = lint;
  const lintText = document.createElement("span"); lintText.textContent = "상세 컴파일 경고 사용 (-Xlint:all)";
  lintLabel.append(lintInput, lintText);
  const note = document.createElement("p"); note.className = "java-run-config-note";
  note.textContent = "저장 검사·실행·채점에 같은 설정을 적용합니다.";
  panel.append(head, grid, lintLabel, note); bar.appendChild(panel);
  button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-expanded", "false");

  const textList = (node, values, empty) => {
    node.textContent = values.length ? values.join(", ") : empty;
    node.title = node.textContent;
  };
  const refresh = async () => {
    const seq = ++refreshSeq;
    const source = typeof options.source === "function" ? options.source() : "";
    const fileName = typeof options.fileName === "function" ? options.fileName() : "Main.java";
    const info = javaRunSourceInfo(source, fileName);
    const mains = info.mainTypes;
    if (mains.length > 1){
      if (mains.indexOf(selectedMain) < 0) selectedMain = mains[0];
      const select = document.createElement("select"); select.className = "java-config-main-select";
      for (const name of mains){
        const option = document.createElement("option"); option.value = name;
        option.textContent = (info.packageName === "(기본 패키지)" ? "" : info.packageName + ".") + name;
        option.selected = name === selectedMain; select.appendChild(option);
      }
      select.addEventListener("change", () => {
        selectedMain = select.value;
        try { localStorage.setItem(mainKey, selectedMain); } catch(_){}
      });
      mainValue.replaceChildren(select);
    } else {
      selectedMain = mains[0] || "";
      mainValue.textContent = info.mainClass;
    }
    mainValue.classList.toggle("is-warn", !info.hasMain);
    packageValue.textContent = info.packageName;
    textList(siblingValue, typeof options.siblings === "function" ? options.siblings() : [], "현재 파일만");
    const libs = typeof options.libraries === "function" ? String(options.libraries() || "").split(",").filter(Boolean) : [];
    textList(libraryValue, libs, "선택 없음");
    jdkValue.textContent = "확인 중…";
    const env = await javaEnvironmentDetails();
    if (destroyed || seq !== refreshSeq) return;
    jdkValue.textContent = env.ok ? ((env.version || ("Java " + (env.major || ""))) + (env.path ? " · " + env.path : "")) : "JDK를 찾지 못함";
    jdkValue.classList.toggle("is-warn", !env.ok);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(panel);
  };
  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true; button.setAttribute("aria-expanded", "false");
    if (outsideClose){ document.removeEventListener("pointerdown", outsideClose, true); outsideClose = null; }
  };
  button.addEventListener("click", () => {
    if (!panel.hidden){ close(); return; }
    panel.hidden = false; button.setAttribute("aria-expanded", "true"); refresh();
    outsideClose = (event) => { if (!panel.contains(event.target) && event.target !== button) close(); };
    document.addEventListener("pointerdown", outsideClose, true);
  });
  lintInput.addEventListener("change", () => {
    lint = lintInput.checked;
    try { localStorage.setItem(lintKey, lint ? "1" : "0"); } catch(_){}
  });
  const onKey = (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault(); event.stopPropagation(); close(); button.focus({ preventScroll:true });
  };
  bar.addEventListener("keydown", onKey);
  return {
    getLint:() => lint,
    getMainClass:() => {
      const info = javaRunSourceInfo(typeof options.source === "function" ? options.source() : "",
        typeof options.fileName === "function" ? options.fileName() : "Main.java");
      return info.mainTypes.indexOf(selectedMain) >= 0 ? selectedMain : (info.mainTypes[0] || "");
    },
    refresh:() => { if (!panel.hidden) refresh(); },
    close,
    destroy(){ destroyed = true; refreshSeq++; close(); bar.removeEventListener("keydown", onKey); panel.remove(); }
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

  let editor = null;
  editor = buildCodeEditor(initial, prof, {
    // 파이썬 전용 지능(Jedi 질의·import 문맥)을 끄고 확장자에 맞는 키워드를 쓴다.
    // fileExt 만 넘기면 공용 목록에서 자바 키워드를 골라 준다(core.js 의 completionWordsForProfile).
    plain: true,
    fileExt: ext,
    completionWords,
    // 점 뒤 후보 — sc.nextInt(), list.add() … 선언한 타입을 보고 고른다(java-runtime.js).
    // 고른 라이브러리의 클래스(gson.toJson() 등)까지 같은 길에서 답한다.
    memberCandidates: (source, receiver, prefix) => javaMemberCompletionCandidates(source, receiver, prefix, libraries),
    completionDetail: (item, source) => javaCompletionTypePackage(source, item && item.name, libraries),
    /* List 를 고르면 java.util.List 를 위에 적어 준다 — 자바 수업의 첫 벽이 "import 를 안 적어서" 나는
       오류다. 넣을 자리를 정하는 규칙(importPlanner)만 자바 것을 주고 장치는 파이썬 쪽 것을 그대로 쓴다. */
    importCandidates: (source, prefix) => javaImportCandidates(source, prefix, libraries),
    importPlanner: JAVA_IMPORT_PLANNER,
    // Java 편집기가 공용 편집기의 Python/Jedi 폴백으로 빠지 않고,
    // 현재 파일의 정의나 JDK src.zip 원문을 열도록 자바 전용 훅을 연결한다.
    definitionTargetAt: ({ source, wordInfo }) => javaDefinitionTargetAt(source, wordInfo),
    openDefinitionTarget: async ({ wordInfo, target }) => {
      if (target.scope === "local"){
        editor.focusLine(target.line, { column:target.column || 0, length:Math.max(1, String(target.name || wordInfo.word).length) });
        toast(target.kind === "method" ? "현재 파일의 메서드 정의로 이동했습니다." : "현재 파일의 타입 정의로 이동했습니다.", 1500);
        return true;
      }
      const data = await requestJavaDefinitionSource(target.qualified);
      if (!data || !data.ok){
        const reason = data && data.reason;
        if (reason === "no-backend") toast("JDK 소스 이동은 ClassDock.exe에서 사용할 수 있어요.", 2800);
        else if (reason === "no-jdk") toast("JDK를 찾지 못해 정의 소스를 열 수 없어요.", 2800);
        else if (reason === "no-source") toast("JDK에 src.zip 소스가 없어 정의를 열 수 없어요.", 2800);
        else toast("열 수 있는 Java 소스를 찾지 못했습니다.", 2400);
        return true;
      }
      const base = String(data.fileName || target.name || wordInfo.word || "definition") + (String(data.fileName || "").endsWith(".java") ? "" : ".java");
      const sourceKey = "definition:jdk:" + String(data.entry || target.qualified).replace(/\\/g, "/");
      const opened = await handleFiles([new File([String(data.source || "")], base, { type:"text/x-java-source" })], { sourceKey });
      if (opened){
        const line = Math.max(1, Number(data.line) || 1);
        const focus = { column:Math.max(0, Number(data.column) || 0), length:Math.max(1, String(data.name || target.name || wordInfo.word).length) };
        const navigator = opened.codeEditor || opened.codeViewer;
        if (navigator && navigator.focusLine) navigator.focusLine(line, focus);
        else { opened.pendingFocusLine = line; opened.pendingFocusOptions = focus; }
      }
      toast("JDK 정의 소스를 열었습니다.", 1500);
      return true;
    },
    contextMenuActions: () => (typeof ui !== "undefined" && typeof ui.cancelRun === "function"
      ? [{ label:"■ 실행 중지", action:() => ui.cancelRun() }]
      : [{ label:"▶ 실행", action:() => run(true) }])
  });
  let savedValue = text;
  if (ownerDoc && typeof ownerDoc.savedText !== "string") ownerDoc.savedText = text;

  // ── 실행 바 ──
  const bar = document.createElement("div"); bar.className = "run-bar java-run-bar";
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
  envBtn.textContent = "Java Env"; envBtn.title = "이 컴퓨터에서 쓰는 자바(JDK) 확인";
  const configBtn = document.createElement("button"); configBtn.className = "run-pkg run-java-config"; configBtn.type = "button";
  configBtn.textContent = "실행 구성"; configBtn.title = "main 클래스·패키지·함께 컴파일할 파일과 옵션 확인";
  const junitBtn = document.createElement("button"); junitBtn.className = "run-pkg run-java-junit"; junitBtn.type = "button";
  junitBtn.textContent = "JUnit"; junitBtn.title = "JUnit 5 테스트를 찾아 별도 결과로 실행";
  const formatBtn = document.createElement("button"); formatBtn.className = "run-pkg run-java-format"; formatBtn.type = "button";
  formatBtn.textContent = "코드 정렬"; formatBtn.title = "문자열과 주석을 보존하며 Java 들여쓰기 정리";
  const importsBtn = document.createElement("button"); importsBtn.className = "run-pkg run-java-imports"; importsBtn.type = "button";
  importsBtn.textContent = "import 정리"; importsBtn.title = "중복·사용하지 않는 import를 지우고 명확한 누락 import 추가";
  const revertBtn = document.createElement("button"); revertBtn.className = "run-revert run-java-revert"; revertBtn.type = "button";
  revertBtn.textContent = "↩ 원본"; revertBtn.title = "편집 전 원본 코드로 되돌리기"; revertBtn.disabled = true;
  const fontGroup = document.createElement("span"); fontGroup.className = "run-java-font-group";
  const fontDown = document.createElement("button"); fontDown.className = "run-font"; fontDown.type = "button";
  fontDown.textContent = "A−"; fontDown.title = "코드·결과 글자 작게 (Ctrl+−)";
  const fontUp = document.createElement("button"); fontUp.className = "run-font"; fontUp.type = "button";
  fontUp.textContent = "A+"; fontUp.title = "코드·결과 글자 크게 (Ctrl++)";
  fontDown.addEventListener("click", () => bumpCodeFont(-1));
  fontUp.addEventListener("click", () => bumpCodeFont(1));
  const fontPick = document.createElement("select"); fontPick.className = "run-font run-fontpick";
  fontPick.title = "코드 글꼴 (시스템에 설치된 글꼴만 · 고정폭/가변폭으로 나눠 표시)";
  fontPick.setAttribute("aria-label", fontPick.title);
  const fontGroups = groupedCodeFontChoices();
  const installedFonts = [...fontGroups.mono, ...fontGroups.prop];
  if (_codeFontFamily && !installedFonts.some(choice => choice.value === _codeFontFamily)) setCodeFontFamily("");
  const addFontGroup = (label, choices) => {
    if (!choices.length) return;
    const group = document.createElement("optgroup"); group.label = label;
    choices.forEach((choice) => {
      const option = document.createElement("option"); option.value = choice.value; option.textContent = choice.label;
      if (choice.value === _codeFontFamily) option.selected = true;
      group.appendChild(option);
    });
    fontPick.appendChild(group);
  };
  addFontGroup("고정폭 (코딩용)", fontGroups.mono);
  addFontGroup("가변폭 (읽기용)", fontGroups.prop);
  fontPick.addEventListener("change", () => setCodeFontFamily(fontPick.value));
  if (installedFonts.length <= 1) fontPick.hidden = true;
  fontGroup.append(fontDown, fontUp, fontPick);

  const practiceGroup = document.createElement("span"); practiceGroup.className = "run-java-practice-group";
  const practiceBtn = document.createElement("button"); practiceBtn.className = "run-practice"; practiceBtn.type = "button";
  practiceBtn.textContent = "따라치기";
  practiceBtn.title = "이 코드를 흐리게 두고 그 위에 똑같이 따라 쳐 보기 — 맞으면 제 색, 틀리면 빨강 (Esc: 그만두기)";
  const practiceInfo = document.createElement("span"); practiceInfo.className = "run-practice-info"; practiceInfo.hidden = true;
  practiceInfo.setAttribute("aria-live", "polite");
  practiceGroup.append(practiceBtn, practiceInfo);
  const setPracticeChrome = (on) => {
    practiceBtn.classList.toggle("is-on", on);
    practiceBtn.textContent = on ? "그만두기" : "따라치기";
    practiceInfo.hidden = !on;
    if (!on) practiceInfo.textContent = "";
  };
  practiceBtn.addEventListener("click", () => {
    if (editor.isPracticeActive()){ editor.stopPractice("cancel"); return; }
    const started = editor.startPractice({
      onProgress: (state) => { practiceInfo.textContent = state.percent + "% · 정확도 " + state.accuracy + "%"; },
      onDone: (reason, state) => {
        setPracticeChrome(false); refreshEditState();
        if (reason !== "done"){
          toast("따라치기를 그만뒀어요. 여기까지 " + state.percent + "% · 정확도 " + state.accuracy + "%", 3000);
          return;
        }
        toast("다 따라 썼어요! 정확도 " + state.accuracy + "% · " + state.seconds + "초 · 분당 " + state.cpm + "타"
          + (state.wrong ? " (고친 실수 " + state.wrong + "번)" : ""), 5200);
        if (typeof petReact === "function") petReact(state.accuracy >= 90 ? "success" : "error");
      }
    });
    if (!started){ toast("따라 칠 코드가 없어요.", 2000); return; }
    setPracticeChrome(true);
    toast("줄 앞 들여쓰기는 자동으로 넘어가요. 틀리면 빨갛게 표시되니 지우고 다시 치면 돼요. (Esc: 그만두기)", 4600);
  });
  const newJavaBtn = document.createElement("button"); newJavaBtn.className = "run-newjava"; newJavaBtn.type = "button";
  newJavaBtn.textContent = "+Java"; newJavaBtn.title = "새 자바 코드";
  newJavaBtn.addEventListener("click", () => { if (typeof newJavaScratch === "function") newJavaScratch(); });
  // 실행 결과 위치 토글(편집기 옆 ↔ 아래) — 파이썬 실행 화면과 같은 버튼. 결과가 한 번 보인 뒤에만 노출한다.
  const layoutBtn = document.createElement("button"); layoutBtn.className = "run-layout"; layoutBtn.type = "button"; layoutBtn.hidden = true;
  const status = document.createElement("span"); status.className = "run-status";
  // 넓을 때는 보조 도구를 그대로 펼치고, 편집기 폭이 좁으면 같은 노드를 ⋯ 메뉴로 접는다(CSS container query).
  const moreGroup = document.createElement("span"); moreGroup.className = "java-run-more";
  const moreBtn = document.createElement("button"); moreBtn.className = "java-run-more-toggle"; moreBtn.type = "button";
  moreBtn.textContent = "⋯"; moreBtn.title = "자바 보조 도구"; moreBtn.setAttribute("aria-haspopup", "menu"); moreBtn.setAttribute("aria-expanded", "false");
  const moreMenu = document.createElement("span"); moreMenu.className = "java-run-more-menu"; moreMenu.setAttribute("role", "menu");
  moreMenu.append(configBtn, junitBtn, formatBtn, importsBtn, revertBtn, fontGroup, practiceGroup, newJavaBtn, layoutBtn);
  moreGroup.append(moreBtn, moreMenu);
  bar.append(runBtn, gradeBtn, libBtn, envBtn, saveBtn, moreGroup, status);
  const closeMore = () => { moreGroup.classList.remove("is-open"); moreBtn.setAttribute("aria-expanded", "false"); };
  const onMoreOutside = (event) => { if (!moreGroup.contains(event.target)) closeMore(); };
  const onMoreKey = (event) => {
    if (event.key !== "Escape" || !moreGroup.classList.contains("is-open")) return;
    event.preventDefault(); event.stopPropagation(); closeMore(); moreBtn.focus({ preventScroll:true });
  };
  moreBtn.addEventListener("click", () => {
    const open = !moreGroup.classList.contains("is-open");
    closeMore();
    if (open){ moreGroup.classList.add("is-open"); moreBtn.setAttribute("aria-expanded", "true"); }
  });
  document.addEventListener("pointerdown", onMoreOutside, true);
  bar.addEventListener("keydown", onMoreKey);
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
  outPanel.appendChild(outHeadActions);

  split.append(editor.host, divider, outPanel);
  attachRunSplitter(split, divider);
  const outputFinder = attachJavaOutputFind({ outPanel, outHeadActions, attachOutputChrome });

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
    btn: runBtn, gradeBtn, junitBtn, status, outPanel, split, editorTa: editor.ta,
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
  const runConfig = buildJavaRunConfigPopover(bar, configBtn, draftKey, {
    source:() => editor.getValue(),
    fileName:() => (ownerDoc && ownerDoc.name) || saveName,
    siblings:() => javaSiblingFileNames(ownerDoc),
    libraries:() => libraryPicker.getQuery()
  });
  const run = (keepEditorFocus) => runJavaSource(editor.getValue(), ui, {
    keepEditorFocus: keepEditorFocus === true,
    libs: libraryPicker.getQuery(),
    lint: runConfig.getLint(),
    mainClass:runConfig.getMainClass()
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
      onRun: (tests) => runJavaSource(editor.getValue(), ui, {
        gradeTests:tests, libs:libraryPicker.getQuery(), lint:runConfig.getLint(), mainClass:runConfig.getMainClass()
      })
    });
  });
  junitBtn.addEventListener("click", () => {
    if (ui.running){ if (typeof toast === "function") toast(javaT("실행 중인 작업을 먼저 중지해 주세요."), 2200); return; }
    const libs = libraryPicker.getQuery();
    if (!String(libs).split(",").some(value => value === "junit" || value.indexOf("junit-platform-console-standalone") >= 0)){
      if (typeof toast === "function") toast(javaT("라이브러리에서 JUnit 5를 먼저 선택해 주세요."), 3000);
      libBtn.click(); return;
    }
    runJavaSource(editor.getValue(), ui, {
      libs, lint:runConfig.getLint(), mainClass:runConfig.getMainClass(), junit:true
    });
  });
  // 어느 자바가 잡혔는지는 실행 결과를 덮지 않고 Python의 Py Env와 같은 작은 모달에서 확인한다.
  envBtn.addEventListener("click", () => { if (!disposed) openJavaEnvModal(envBtn); });
  outHideBtn.addEventListener("click", () => {
    outputFinder.close(false);
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
    runConfig.refresh();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, JAVA_DRAFT_DELAY);
    if (autosaveBusy) autosaveAgain = true;
    scheduleAutosave();
  });
  const applyJavaTransform = (transform, doneMessage, unchangedMessage) => {
    const before = editor.getValue();
    const after = transform(before);
    if (after === before){ if (typeof toast === "function") toast(javaT(unchangedMessage), 2000); return; }
    editor.setValue(after);
    if (typeof toast === "function") toast(javaT(doneMessage), 1800);
  };
  formatBtn.addEventListener("click", () => applyJavaTransform(javaFormatSource,
    "Java 코드 들여쓰기를 정리했습니다.", "정리할 들여쓰기 변화가 없습니다."));
  importsBtn.addEventListener("click", () => applyJavaTransform(
    value => javaOrganizeImports(value, libraries), "import를 정리했습니다.", "정리할 import가 없습니다."));
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
        lint:runConfig.getLint(),
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
  outPanel.__refreshFontMetrics = () => outputFinder.refresh();
  registerEditorFont(outPanel);

  if (ownerDoc){
    const openJavaDocFind = () => {
      if (outPanel.contains(document.activeElement) || outputFinder.selectionSeed()) outputFinder.open();
      else editor.openFind();
    };
    ownerDoc.codeEditor = editor;
    ownerDoc.codeEditorFileBase = saveName;
    ownerDoc.openDocFind = openJavaDocFind;
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
      outputFinder.destroy();
      libraryPicker.destroy();
      runConfig.destroy();
      document.removeEventListener("pointerdown", onMoreOutside, true);
      bar.removeEventListener("keydown", onMoreKey);
      if (typeof ui.disposeInstallGuide === "function") ui.disposeInstallGuide();
      ui.disposeInstallGuide = null;
      if (typeof ui.cancelRun === "function") ui.cancelRun();
      if (ownerDoc.isScratch && !ownerDoc._named) clearPythonDraft(draftKey);
      if (ownerDoc.codeEditor === editor) ownerDoc.codeEditor = null;
      if (ownerDoc.openDocFind === openJavaDocFind) delete ownerDoc.openDocFind;
      delete ownerDoc.openGotoLine;
      editor.destroy();
      unregisterEditorFont(editor.host);
      unregisterEditorFont(outPanel);
      delete outPanel.__refreshFontMetrics;
    });
    if (ownerDoc.pendingFocusLine){                  // 정의 이동·코드 링크가 렌더 전에 예약해 둔 줄로 이동
      const line = ownerDoc.pendingFocusLine, opts = ownerDoc.pendingFocusOptions;
      ownerDoc.pendingFocusLine = 0; ownerDoc.pendingFocusOptions = null;
      requestAnimationFrame(() => { if (ownerDoc.codeEditor === editor && editor.focusLine) editor.focusLine(line, opts); });
    }
  }
  refreshEditState();
}
