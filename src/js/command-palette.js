"use strict";
/*
 * 명령 팔레트 (Ctrl+K) — 기능을 검색해 바로 실행하는 창.
 * 기능이 많은 앱에서 "어디 있는지 몰라도" 이름으로 찾아 실행하게 해 발견성을 높인다.
 * 새 로직을 만들지 않고, 이미 있는 전역 함수·헤더 버튼을 그대로 재사용해 실행한다.
 * 전역 오염을 피하려고 IIFE 로 감싸고 window.openCommandPalette 만 노출한다.
 */
(function(){
  if (typeof window === "undefined" || !window.document) return;
  const $ = (id) => document.getElementById(id);
  const curState = () => { try { return state; } catch(_){ return null; } };   // state 는 전역 let(문서 상태)

  // ── 실행 대상 판별(문맥) ─────────────────────────────
  const isPdf   = () => { const s = curState(); return !!(s && s.kind === "pdf"); };
  const hasDoc  = () => !!curState();
  const hasMultipleDocs = () => { try { return docs.length > 1; } catch(_){ return false; } };
  const canRun  = () => { const s = curState(); return !!(s && s.el && s.el.querySelector(".run-go")); };
  const canPrint= () => { const t = $("officeTools"); return !!(t && !t.hidden); };
  const canStudy = () => { const b = $("studyToggle"); return !!(b && !b.hidden); };
  const clickId = (id) => { const el = $(id); if (el) el.click(); };
  const callFn  = (name, ...args) => { if (typeof window[name] === "function") window[name](...args); };

  // ── 명령 목록: label(표시)·icon·kw(검색 키워드)·when(문맥)·sc(연결 단축키)·run(실행) ──
  const C = (id, icon, label, run, opts) => Object.assign({ id, icon, label, run }, opts || {});
  const COMMANDS = [
    // 만들기 · 열기
    C("openFiles","📂","파일 열기", () => { if (typeof window.pickFilesOrInput === "function") window.pickFilesOrInput($("fileInput")); else clickId("sbOpenFiles"); }, { sc:"openFiles", kw:"open file 파일 열기 불러오기 추가" }),
    C("openFolder","🗂️","폴더 열기", () => { if (typeof window.pickFolderOrInput === "function") window.pickFolderOrInput($("folderInput")); else clickId("sbOpenFolder"); }, { sc:"openFolder", kw:"folder 폴더 열기" }),
    C("newPython","🐍","새 파이썬 코드", () => callFn("newPythonScratch"), { sc:"newPython", kw:"python 파이썬 코드 새 만들기 new" }),
    C("newNotebook","📓","새 노트북 (.ipynb)", () => callFn("newNotebookScratch"), { kw:"jupyter notebook 노트북 ipynb 커널 셀" }),
    C("newSheet","📊","새 빈 표 (엑셀)", () => callFn("newSpreadsheetScratch"), { kw:"excel sheet 엑셀 표 스프레드시트 xlsx" }),
    C("newBoard","🖊️","새 화이트보드", () => callFn("newWhiteboard"), { kw:"whiteboard 화이트보드 칠판 판서 필기" }),
    C("newText","📝","새 텍스트 파일", () => callFn("newTextScratch"), { kw:"text txt 텍스트 메모장 새" }),
    C("openLesson","⏯️","수업 리플레이 열기 (.lesson)", () => callFn("openLessonFilePicker"), { kw:"lesson replay 리플레이 되감기 수업 녹화" }),
    C("newTask","📦","과제 파일 만들기 (.task)", () => callFn("openTaskBuilderFromActive"), { kw:"task assignment 과제 만들기 배포 자동채점 숙제" }),
    C("taskBatch","🗂️","제출본 일괄 검수 (.taskdone)", () => callFn("openTaskBatchReview"), { kw:"taskdone submission 제출 검수 재채점 성적 채점 일괄 csv" }),
    C("examples","✨","파이썬 예제 갤러리", () => callFn("openSnippetGallery"), { kw:"example gallery 예제 갤러리 샘플 연습" }),
    // 도구 · 보기
    C("scratchpad","🗒️","임시 메모 열기", () => callFn("openScratchpadForNotebookDrop"), { sc:"scratchpad", kw:"memo note 메모 임시 스크래치 노트" }),
    C("imageMemo","🖼️","이미지 메모", () => clickId("imageMemoOpen"), { kw:"image 이미지 캡처 스크린샷 메모" }),
    C("theme","🌓","밝게 / 어둡게 전환 (테마)", () => clickId("themeToggle"), { kw:"theme dark light 다크 라이트 테마 어둡게 밝게 야간" }),
    C("sidebar","↔️","사이드바 접기 / 펼치기", () => clickId("sidebarToggle"), { kw:"sidebar 사이드바 목록 파일 접기 펼치기" }),
    C("screensaver","🖥️","대기 화면 지금 시작", () => callFn("startScreensaverNow"), { sc:"screensaverStart", kw:"screensaver 대기 화면 화면보호기 휴식" }),
    C("settings","⚙️","설정 열기", () => clickId("settingsOpen"), { kw:"settings 설정 환경 옵션 preferences" }),
    C("help","❓","도움말 · 단축키", () => clickId("helpOpen"), { kw:"help 도움말 단축키 shortcut 가이드" }),
    // 문서(PDF) 전용
    C("closeCurrent","×","현재 파일 닫기", () => { const s = curState(); if (s) callFn("closeDoc", s.id, { forgetWorkspace:true }); }, { when:hasDoc, sc:"closeCurrent", kw:"close 닫기 탭 파일" }),
    C("reopenClosed","↶","닫은 파일 다시 열기", () => callFn("reopenClosedDoc"), { sc:"reopenClosed", kw:"reopen restore 닫은 파일 탭 복원" }),
    C("previousFile","◀","이전 열린 파일", () => callFn("navigateTab", -1), { when:hasMultipleDocs, sc:"previousFile", kw:"previous 이전 파일 탭 이동" }),
    C("nextFile","▶","다음 열린 파일", () => callFn("navigateTab", 1), { when:hasMultipleDocs, sc:"nextFile", kw:"next 다음 파일 탭 이동" }),
    C("studyToggle","⇄","분할 작업 켜기 / 끄기", () => clickId("studyToggle"), { when:canStudy, kw:"study split 분할 작업 참고 나란히" }),
    C("pdfSign","✍️","PDF 서명 추가", () => clickId("btnSign"), { when:isPdf, kw:"sign signature 서명 도장" }),
    C("pdfText","🔤","PDF 텍스트 넣기", () => clickId("btnText"), { when:isPdf, kw:"text 텍스트 글자" }),
    C("pdfDate","📅","PDF 날짜 넣기", () => clickId("btnDate"), { when:isPdf, kw:"date 날짜" }),
    C("pdfCheck","✔️","PDF 체크 표시", () => clickId("btnCheck"), { when:isPdf, kw:"check 체크 확인 표시" }),
    C("pdfPen","🖍️","PDF 펜 · 형광펜 필기", () => clickId("btnPen"), { when:isPdf, kw:"pen highlight 펜 형광펜 필기 강조 마크업" }),
    C("pdfFind","🔍","PDF에서 찾기", () => callFn("openPdfFind"), { when:isPdf, sc:"findInDocument", kw:"find search 찾기 검색" }),
    C("pdfPages","🗂️","페이지 썸네일 · 정리", () => clickId("btnPages"), { when:isPdf, kw:"pages 페이지 썸네일 추출 정리 삭제 회전" }),
    C("pdfMerge","➕","PDF 합치기", () => clickId("btnMergePdf"), { when:isPdf, kw:"merge 합치기 병합 이어붙이기" }),
    C("pdfDownload","💾","PDF 다운로드 / 저장", () => clickId("btnDownload"), { when:isPdf, sc:"saveCurrent", kw:"download save 다운로드 저장 내보내기" }),
    C("pdfUndo","↶","PDF 편집 실행 취소", () => callFn("undoPdfEdit"), { when:isPdf, kw:"undo 실행 취소 되돌리기" }),
    C("pdfRedo","↷","PDF 편집 다시 실행", () => callFn("redoPdfEdit"), { when:isPdf, kw:"redo 다시 실행 복구" }),
    // 코드 실행 / 인쇄 / 전체화면 (문맥)
    C("runCode","▶️","현재 코드 실행", () => { const s = curState(); const b = s && s.el && s.el.querySelector(".run-go"); if (b) b.click(); }, { when:canRun, sc:"runCode", kw:"run execute 실행 돌리기" }),
    C("print","🖨️","인쇄 / PDF로 저장", () => clickId("btnPrint"), { when:canPrint, kw:"print 인쇄 출력 pdf" }),
    C("fullscreen","⛶","문서 영역 전체화면", () => callFn("toggleViewerFullscreen"), { when:hasDoc, kw:"fullscreen 전체화면 크게" })
  ];

  // ── 검색 ─────────────────────────────
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
  const localizedLabel = (cmd) => (typeof window.t === "function" ? window.t(cmd.label) : cmd.label);
  function score(cmd, q){
    // 화면에는 영어 레이블을 보여 주므로, 검색도 원문·번역문 양쪽을 대상으로 한다.
    const hay = norm(cmd.label + " " + localizedLabel(cmd) + " " + (cmd.kw || ""));
    const i = hay.indexOf(norm(q));
    return i < 0 ? -1 : (1000 - i);                 // 앞쪽에서 일치할수록 상위
  }
  const available = () => COMMANDS.filter(c => { if (!c.when) return true; try { return !!c.when(); } catch(_){ return false; } });
  function shortcutKey(cmd){
    if (!cmd.sc || typeof window.shortcutValue !== "function" || typeof window.shortcutDisplay !== "function") return "";
    try { return window.shortcutDisplay(window.shortcutValue(cmd.sc)) || ""; } catch(_){ return ""; }
  }

  // ── UI ─────────────────────────────
  let overlay = null, input = null, listEl = null, emptyEl = null, items = [], activeIndex = 0, previousFocus = null;
  const focusableInPalette = () => overlay ? [...overlay.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.hidden && !el.disabled) : [];
  function trapFocus(e){
    if (e.key !== "Tab") return;
    const nodes = focusableInPalette();
    if (!nodes.length){ e.preventDefault(); return; }
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  function build(){
    overlay = document.createElement("div");
    overlay.className = "cmdk-overlay"; overlay.hidden = true;
    overlay.innerHTML =
      '<div class="cmdk" role="dialog" aria-modal="true" aria-label="명령 팔레트">' +
        '<div class="cmdk-inputwrap">' +
          '<svg class="cmdk-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"></circle><path d="m15 15 5 5"></path></svg>' +
          '<input class="cmdk-input" type="text" role="combobox" placeholder="기능 검색…  (예: 서명, 화이트보드, 어둡게)" autocomplete="off" spellcheck="false" aria-label="명령 검색" aria-controls="cmdkList" aria-expanded="true">' +
          '<kbd class="cmdk-esc">Esc</kbd>' +
        '</div>' +
        '<div class="cmdk-list" id="cmdkList" role="listbox"></div>' +
        '<div class="cmdk-empty" hidden>일치하는 기능이 없어요</div>' +
      '</div>';
    document.body.appendChild(overlay);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(overlay);
    input = overlay.querySelector(".cmdk-input");
    listEl = overlay.querySelector(".cmdk-list");
    emptyEl = overlay.querySelector(".cmdk-empty");
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", onInputKey);
    overlay.addEventListener("keydown", trapFocus);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  }
  function render(query){
    const avail = available();
    const list = (!query || !query.trim())
      ? avail
      : avail.map(c => ({ c, s: score(c, query) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(x => x.c);
    items = list;
    activeIndex = 0;
    listEl.innerHTML = "";
    emptyEl.hidden = list.length > 0;
    const frag = document.createDocumentFragment();
    list.forEach((c, idx) => {
      const row = document.createElement("div");
      row.className = "cmdk-item" + (idx === 0 ? " active" : "");
      row.id = "cmdkOption" + idx;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", idx === 0 ? "true" : "false");
      const ico = document.createElement("span"); ico.className = "cmdk-item-ico"; ico.textContent = c.icon || "•";
      const lab = document.createElement("span"); lab.className = "cmdk-item-label"; lab.textContent = localizedLabel(c);
      row.appendChild(ico); row.appendChild(lab);
      const key = shortcutKey(c);
      if (key){ const kb = document.createElement("kbd"); kb.className = "cmdk-item-key"; kb.textContent = key; row.appendChild(kb); }
      row.addEventListener("mousemove", () => setActive(idx));
      row.addEventListener("click", () => run(idx));
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
    input.setAttribute("aria-activedescendant", items.length ? "cmdkOption0" : "");
  }
  function setActive(idx){
    if (idx < 0 || idx >= items.length) return;
    activeIndex = idx;
    [...listEl.children].forEach((el, i) => {
      const on = i === idx;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
    input.setAttribute("aria-activedescendant", "cmdkOption" + idx);
    const el = listEl.children[idx]; if (el) el.scrollIntoView({ block: "nearest" });
  }
  function move(delta){ if (items.length) setActive((activeIndex + delta + items.length) % items.length); }
  function onInputKey(e){
    if (e.key === "ArrowDown"){ e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); move(-1); }
    else if (e.key === "Enter"){ e.preventDefault(); run(activeIndex); }
    else if (e.key === "Escape"){ e.preventDefault(); close(); }
  }
  function run(idx){
    const c = items[idx]; if (!c) return;
    close(false);
    // 파일 선택창·모달을 여는 동작은 팔레트가 닫힌 뒤 실행해야 포커스·중첩 문제가 없다.
    setTimeout(() => {
      try { c.run(); }
      catch(err){ console.error(err); if (typeof window.toast === "function") window.toast("실행하지 못했어요.", 2000, { type: "error" }); }
    }, 0);
  }
  function open(){
    if (!overlay) build();
    if (!overlay.hidden) return;
    if (document.querySelector(".modal:not([hidden])")) return;   // 다른 대화상자 위에 겹쳐 열지 않음
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.hidden = false;
    input.value = "";
    render("");
    requestAnimationFrame(() => { try { input.focus(); input.select(); } catch(_){} });
  }
  function close(restoreFocus=true){
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    const restore = previousFocus; previousFocus = null;
    if (restoreFocus && restore && restore.isConnected) requestAnimationFrame(() => { try { restore.focus(); } catch(_){} });
  }
  window.openCommandPalette = open;

  // 열린 팔레트는 언어 전환 뒤에도 결과 목록·검색 순위를 즉시 새 언어 기준으로 맞춘다.
  window.addEventListener("mni18nchange", () => {
    if (overlay && !overlay.hidden) render(input ? input.value : "");
  });

  // ── 상시 진입점(헤더 버튼·빈 화면 힌트) 연결 ──
  // 팔레트는 이미 완성돼 있으나 진입점이 도움말 안 단축키뿐이라 발견성이 낮았다.
  // 파일 타입과 무관한 헤더 버튼과 드롭존 힌트를 클릭 진입점으로 연결한다.
  ["commandPaletteOpen", "dzCommandPalette"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("click", (e) => { e.preventDefault(); open(); });
  });
  // 헤더 버튼의 kbd 라벨을 실제(커스텀 가능) 단축키와 맞춘다.
  (function syncKbd(){
    const kb = $("commandPaletteKbd");
    if (!kb || typeof window.shortcutValue !== "function" || typeof window.shortcutDisplay !== "function") return;
    try { const k = window.shortcutDisplay(window.shortcutValue("commandPalette")); if (k) kb.textContent = k; } catch(_){}
  })();

  // ── 열기 단축키(기본 Ctrl+K, 설정 → 단축키에서 변경 가능) ──
  window.addEventListener("keydown", (e) => {
    const matched = typeof window.shortcutMatches === "function"
      ? window.shortcutMatches(e, "commandPalette")
      : ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "k");
    if (!matched || e.isComposing || e.keyCode === 229) return;
    if (overlay && !overlay.hidden){ e.preventDefault(); close(); return; }   // 토글: 이미 열려 있으면 닫기
    if (document.querySelector(".modal:not([hidden])")) return;
    e.preventDefault();
    open();
  }, true);
})();
