"use strict";
/*
 * 최근 검색어(MNSearchHistory)
 *
 * 왜: 찾기 창은 앱을 다시 켜거나 문서를 옮기면 값이 사라져, 같은 말을 몇 번이고 다시 타이핑해야 했다.
 *     사이드바 통합검색은 Escape 한 번에 비워지고, 편집기 찾기는 문서를 닫으면 초기화된다.
 *
 * 어떻게: 검색어를 구획(scope)별로 localStorage 에 최근 것부터 12개까지만 들고 있다가
 *     ① 찾기 창을 열 때 마지막 검색어를 미리 채워 주고(선택해 둔 글자가 있으면 그게 우선),
 *     ② 입력창이 비었을 때·'최근' 버튼을 눌렀을 때 목록을 드롭다운으로 보여준다.
 *     기록은 타이핑마다가 아니라 Enter·다음/이전·바꾸기처럼 "실제로 검색을 쓴 순간"에만 남긴다.
 *     그래야 ㅅ, 서, 설… 같은 조합 중간값이 쌓이지 않는다.
 *
 * 왜 구획을 나누나: 파일 검색어와 정규식 패턴, 셀 값이 한 목록에 섞이면 목록이 쓸모없어진다.
 *     files(통합검색) · text(편집기·문서) · pdf · notebook · sheet · batch 로 따로 쌓는다.
 *
 * 프라이버시: 교실 공용 컴퓨터를 고려해 설정 → 일반에서 끌 수 있고(appSettings.searchHistory),
 *     '검색 기록 지우기'로 한 번에 지운다. 꺼두면 읽지도 쓰지도 않는다.
 *     '바꿀 내용'은 일부러 기록하지 않는다 — 지난 치환 문자열이 되살아나 잘못 적용되는 게 더 위험하다.
 *
 * 드롭다운은 겹쳐 띄우지 않고 흐름 안(in-flow)에 넣는다. 사이드바·찾기 바 모두 세로 flex 라
 * 자연스럽게 자리를 잡고, z-index·잘림(overflow) 문제를 처음부터 만들지 않는다.
 */
const MNSearchHistory = (() => {
  const KEY = "mn.searchHistory";
  const LIMIT = 12;              // 구획당 보관 개수 — 넘으면 오래된 것부터 버린다
  const MAX_LEN = 200;           // 한 줄 검색어만 다룬다(붙여넣은 문단이 목록을 잡아먹지 않게)
  const SCOPES = ["files", "text", "pdf", "notebook", "sheet", "batch"];

  const canStore = () => { try { return typeof localStorage !== "undefined"; } catch(_){ return false; } };
  // 설정에서 끄면 저장·표시 모두 하지 않는다. state.js 보다 먼저 읽힐 수 있어 typeof 로 확인한다.
  const enabled = () => {
    try { return !(typeof appSettings !== "undefined" && appSettings && appSettings.searchHistory === false); }
    catch(_){ return true; }
  };
  const T = (text) => (typeof window.t === "function" ? window.t(text) : text);

  const cleanTerm = (value) => {
    const term = String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").trim();
    return term.length > MAX_LEN ? "" : term;      // 너무 길면 아예 기록하지 않는다(잘라 두면 다시 못 쓴다)
  };

  // 저장된 값을 그대로 읽는다(켜짐/꺼짐은 보여줄 때 list 에서 가른다 — 꺼둔 상태에서도 '지우기'가 동작해야 한다).
  function readAll(){
    if (!canStore()) return {};
    let saved;
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch(_){ return {}; }
    if (!saved || typeof saved !== "object") return {};
    const out = {};
    for (const scope of SCOPES){
      const rows = Array.isArray(saved[scope]) ? saved[scope] : [];
      const seen = new Set();
      out[scope] = rows.map((row) => {
        const q = cleanTerm(row && typeof row === "object" ? row.q : row);
        if (!q || seen.has(q)) return null;
        seen.add(q);
        return { q, meta: row && typeof row === "object" && row.m && typeof row.m === "object" ? row.m : null };
      }).filter(Boolean).slice(0, LIMIT);
    }
    return out;
  }

  function writeAll(all){
    if (!canStore()) return;
    const out = {};
    for (const scope of SCOPES){
      const rows = (all && all[scope]) || [];
      if (rows.length) out[scope] = rows.slice(0, LIMIT).map((row) => (row.meta ? { q: row.q, m: row.meta } : { q: row.q }));
    }
    try {
      if (Object.keys(out).length) localStorage.setItem(KEY, JSON.stringify(out));
      else localStorage.removeItem(KEY);
    } catch(_){}
  }

  const list = (scope) => (SCOPES.includes(scope) && enabled() ? (readAll()[scope] || []) : []);
  const last = (scope) => { const rows = list(scope); return rows.length ? rows[0].q : ""; };
  const size = () => { const all = readAll(); return SCOPES.reduce((sum, scope) => sum + ((all[scope] || []).length), 0); };

  // 같은 검색어는 하나만 남기고 맨 앞으로 올린다(가장 최근이 위). meta 는 찾기 옵션 같은 부가정보.
  function remember(scope, value, meta){
    if (!SCOPES.includes(scope) || !enabled()) return "";
    const q = cleanTerm(value);
    if (!q) return "";
    const all = readAll();
    const rows = (all[scope] || []).filter((row) => row.q !== q);
    rows.unshift({ q, meta: meta && typeof meta === "object" ? meta : null });
    all[scope] = rows.slice(0, LIMIT);
    writeAll(all);
    notify();
    return q;
  }

  function forget(scope, value){
    if (!SCOPES.includes(scope)) return;
    const q = cleanTerm(value);
    const all = readAll();
    all[scope] = (all[scope] || []).filter((row) => row.q !== q);
    writeAll(all);
    notify();
  }

  // scope 를 주면 그 구획만, 없으면 전부 지운다(설정의 '검색 기록 지우기').
  function clear(scope){
    if (scope && SCOPES.includes(scope)){
      const all = readAll();
      all[scope] = [];
      writeAll(all);
    } else if (canStore()){
      try { localStorage.removeItem(KEY); } catch(_){}
    }
    notify();
  }

  // 목록이 바뀌면 열려 있는 다른 드롭다운도 스스로 다시 그리게 알린다(찾기 바가 여러 문서에 동시에 있다).
  function notify(){
    try { window.dispatchEvent(new CustomEvent("mnsearchhistorychange")); } catch(_){}
  }

  let panelSeq = 0;   // aria-controls 로 가리킬 목록 id 를 겹치지 않게

  /* 입력창 하나에 '최근 검색어' 드롭다운을 붙인다.
     options: scope        어느 구획에 쌓을지(필수)
              insertAfter  이 요소 바로 뒤에 패널을 넣는다(기본: 입력창 부모의 끝에 붙임)
              mount        패널을 담을 요소(insertAfter 가 없을 때)
              className    패널에 더할 클래스(사이드바용 어두운 배색 등)
              toggleButton 목록을 여닫는 버튼(열려 있는 동안 .on 표시를 붙여 준다)
              onPick       항목을 고른 뒤 할 일 (term, meta) => void — 보통 여기서 검색을 실행한다
     반환: { panel, show, hide, toggle, isOpen, remember, refresh, destroy }
     (panel = 만들어진 목록 요소. 바깥 UI 가 클릭을 가로채는 자리에서 stopPropagation 을 걸 때 쓴다) */
  function attach(input, options){
    const opt = options || {};
    const scope = opt.scope;
    if (!input || !SCOPES.includes(scope)) return null;

    const panel = document.createElement("div");
    panel.className = "search-history" + (opt.className ? " " + opt.className : "");
    panel.hidden = true;
    const head = document.createElement("div");
    head.className = "search-history-head";
    const title = document.createElement("strong");
    const clearBtn = document.createElement("button");
    clearBtn.type = "button"; clearBtn.className = "search-history-clear";
    head.append(title, clearBtn);
    const listEl = document.createElement("div");
    listEl.className = "search-history-list";
    listEl.setAttribute("role", "listbox");
    listEl.id = "searchHistoryList-" + (++panelSeq);
    panel.append(head, listEl);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", listEl.id);
    input.setAttribute("aria-expanded", "false");
    if (opt.insertAfter && opt.insertAfter.parentNode) opt.insertAfter.parentNode.insertBefore(panel, opt.insertAfter.nextSibling);
    else (opt.mount || input.parentElement || document.body).appendChild(panel);

    let open = false, rows = [], activeIndex = -1, allMode = false;

    const syncLabels = () => {
      title.textContent = T("최근 검색어");
      clearBtn.textContent = T("모두 지우기");
      clearBtn.title = T("이 목록을 모두 지웁니다");
    };

    const paint = () => {
      listEl.textContent = "";
      rows.forEach((row, index) => {
        const item = document.createElement("div");
        item.className = "search-history-item";
        const pick = document.createElement("button");
        pick.type = "button"; pick.className = "search-history-pick";
        pick.textContent = row.q;
        pick.title = row.q;
        pick.setAttribute("role", "option");
        pick.setAttribute("aria-selected", String(index === activeIndex));
        if (index === activeIndex) pick.classList.add("is-active");
        pick.addEventListener("click", () => choose(index));
        const del = document.createElement("button");
        del.type = "button"; del.className = "search-history-del";
        del.textContent = "✕";
        del.title = T("이 검색어 지우기");
        del.setAttribute("aria-label", T("이 검색어 지우기") + ": " + row.q);
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          forget(scope, row.q);
          refresh();                       // 목록이 비면 refresh 가 패널을 닫는다
          if (open) input.focus();
        });
        item.append(pick, del);
        listEl.appendChild(item);
      });
    };

    // 입력창에 글자가 있으면 그걸 포함하는 것만 보여준다(주소창처럼). 없으면·'최근' 버튼이면 전체 목록.
    const collect = () => {
      const all = list(scope);
      const typed = allMode ? "" : cleanTerm(input.value).toLocaleLowerCase();
      if (!typed) return all;
      return all.filter((row) => row.q.toLocaleLowerCase().includes(typed) && row.q.toLocaleLowerCase() !== typed);
    };

    function refresh(){
      if (!open) return;
      rows = collect();
      if (!rows.length){ hide(); return; }
      if (activeIndex >= rows.length) activeIndex = rows.length - 1;
      paint();
    }

    // all=true 면 입력창에 적힌 글자와 상관없이 전체 목록을 보여준다('최근' 버튼으로 열 때).
    function show(all){
      if (!enabled()) return;
      allMode = !!all;
      rows = collect();
      if (!rows.length){
        hide();
        if (allMode && typeof toast === "function") toast(T("아직 기억한 검색어가 없어요."), 1600);
        return;
      }
      activeIndex = -1;
      syncLabels();
      paint();
      panel.hidden = false;
      open = true;
      input.setAttribute("aria-expanded", "true");
      if (opt.toggleButton){ opt.toggleButton.classList.add("on"); opt.toggleButton.setAttribute("aria-expanded", "true"); }
    }

    function hide(){
      allMode = false;
      if (opt.toggleButton){ opt.toggleButton.classList.remove("on"); opt.toggleButton.setAttribute("aria-expanded", "false"); }
      if (!open && panel.hidden) return;
      panel.hidden = true;
      open = false;
      activeIndex = -1;
      input.setAttribute("aria-expanded", "false");
    }

    function choose(index){
      const row = rows[index];
      if (!row) return;
      input.value = row.q;
      hide();
      remember(scope, row.q, row.meta);         // 고른 것도 '방금 쓴 것'이라 맨 위로 올린다
      input.focus();
      try { input.setSelectionRange(row.q.length, row.q.length); } catch(_){}
      if (typeof opt.onPick === "function") opt.onPick(row.q, row.meta);
    }

    // -1 = 아무것도 안 고른 상태(입력창), 0..n-1 = 목록 항목. 끝에서 한 번 더 누르면 입력창으로 돌아온다.
    const moveActive = (delta) => {
      if (!rows.length) return;
      let next = activeIndex + delta;
      if (next >= rows.length) next = -1;
      else if (next < -1) next = rows.length - 1;
      activeIndex = next;
      paint();
      const target = listEl.children[activeIndex];
      if (target && target.firstChild && typeof target.firstChild.scrollIntoView === "function") {
        target.firstChild.scrollIntoView({ block: "nearest" });
      }
    };

    clearBtn.addEventListener("click", () => { clear(scope); hide(); input.focus(); });
    // 패널을 클릭할 때 입력창이 blur 돼 패널이 먼저 닫히면 클릭이 사라진다 → mousedown 기본동작을 막는다.
    panel.addEventListener("mousedown", (e) => e.preventDefault());

    // 캡처 단계로 듣는다: 이미 붙어 있는 Escape·Enter 처리(사이드바 비우기, 찾기 이동)보다 먼저
    // 드롭다운이 키를 가져가야 "Esc 로 목록만 닫기"가 가능하다.
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;                       // 한글 조합 중에는 목록 조작에 끼어들지 않는다
      if (!open){
        if (e.key === "ArrowDown" && !e.altKey && !e.ctrlKey && !e.shiftKey){
          show();
          if (open){ e.preventDefault(); e.stopPropagation(); moveActive(1); }
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp"){
        e.preventDefault(); e.stopPropagation();
        moveActive(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter"){
        if (activeIndex >= 0){ e.preventDefault(); e.stopPropagation(); choose(activeIndex); }
        else hide();                                   // 고른 게 없으면 원래 Enter(검색 이동)를 그대로 흘린다
      } else if (e.key === "Escape"){
        e.preventDefault(); e.stopPropagation();       // 첫 Esc 는 목록만 닫는다(검색어·찾기 바는 그대로)
        hide();
      } else if (e.key === "Tab"){
        hide();
      }
    }, true);

    input.addEventListener("input", (e) => {
      if (e && e.isComposing) return;
      // 검색어를 다 지우면(✕ 나 백스페이스) 다시 목록을 보여준다 — 그 순간이 "다른 걸 찾고 싶다"는 뜻이다.
      if (!cleanTerm(input.value) && document.activeElement === input) show();
      else if (open) refresh();
    });
    input.addEventListener("compositionend", () => { if (open) refresh(); });
    // 입력창이 비어 있을 때 포커스가 오면 바로 보여준다(가장 쓸모 있는 순간이라 발견도 쉽다).
    input.addEventListener("focus", () => { if (!cleanTerm(input.value)) show(); });
    input.addEventListener("blur", () => { setTimeout(hide, 0); });   // 항목 클릭이 먼저 처리되도록 한 틱 미룬다
    window.addEventListener("mnsearchhistorychange", () => { if (open) refresh(); });
    window.addEventListener("mni18nchange", () => { if (open) syncLabels(); });   // 한/EN 토글 시 머리글도 따라 바뀌게

    return {
      panel, show, hide, isOpen: () => open, hasActive: () => activeIndex >= 0, refresh,
      toggle: (all) => { if (open) hide(); else show(all); },
      remember: (value, meta) => remember(scope, value, meta),
      destroy: () => { hide(); if (panel.parentNode) panel.parentNode.removeChild(panel); }
    };
  }

  return { list, last, size, remember, forget, clear, enabled, attach, SCOPES: SCOPES.slice() };
})();
