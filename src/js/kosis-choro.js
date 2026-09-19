"use strict";
/* 색칠 지도 창 안의 'KOSIS에서 가져오기' 칸(MNKosisChoro).
   두 가지 길: ① 자주 쓰는 통계(MNKosisApi.PRESETS — 이름 맞춤을 미리 확인한 표) ② 검색해서 고르기(아무 KOSIS 표).
   어느 쪽이든 결과는 "시도 시군구\t값" 글로 색칠 지도의 붙여넣기 칸에 들어가고, 이름 맞추기·칠하기는 색칠 지도가 한다
   (고칠 곳이 붙여넣기 칸에 그대로 보이고, 저장된 지도를 다시 열 때도 같은 길로 읽는다). */
const MNKosisChoro = (() => {
  // container: 칸을 넣을 곳 · level(): 지금 고른 기준 · onImport({text,title,unit,level,note}) · t: 번역기
  function mount({ container, level, onImport, t = v => v }){
    const api = MNKosisApi;
    const el = (tag, cls, label) => { const node = document.createElement(tag); if (cls) node.className = cls; if (label) node.textContent = t(label); return node; };
    const button = (label, cls = "") => { const node = el("button", "btn " + cls, label); node.type = "button"; return node; };
    const field = (label, control) => { const wrap = el("label", "map-nearby-field"); const span = el("span"); span.textContent = label; wrap.append(span, control); return wrap; };
    const option = (value, label) => { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; };
    // 한두 낱말은 사전에 넣지 않고 여기서 가른다(사전은 같은 글 조각을 화면 어디서나 바꾼다).
    const word = (ko, en) => window.MNI18N && window.MNI18N.lang === "en" ? en : ko;
    const L = api.label;

    const box = el("div", "map-choro-kosis");
    const tabs = el("div", "map-choro-kosis-tabs");
    tabs.setAttribute("role", "tablist");
    const presetTab = button("자주 쓰는 통계", "map-choro-kosis-tab is-on"), searchTab = button("검색해서 고르기", "map-choro-kosis-tab");
    for (const tab of [presetTab, searchTab]) tab.setAttribute("role", "tab");
    tabs.append(presetTab, searchTab);

    // ① 자주 쓰는 통계
    const presetPane = el("div", "map-choro-kosis-pane");
    const presetSelect = el("select", "map-select map-choro-kosis-preset");
    for (const group of api.GROUPS){
      const optgroup = document.createElement("optgroup");
      optgroup.label = L(group);
      for (const p of api.PRESETS.filter(item => item.group === group))
        optgroup.append(option(p.id, L(p.title) + (p.levels.includes("sgg") ? "" : " · " + word("시도만", "provinces only"))));
      presetSelect.append(optgroup);
    }
    const itemSelect = el("select", "map-select map-choro-kosis-item");
    const yearSelect = el("select", "map-select map-choro-kosis-year");
    const thisYear = new Date().getFullYear();
    yearSelect.append(option("", word("가장 최근", "Latest")));
    for (let y = thisYear; y > thisYear - 15; y--) yearSelect.append(option(String(y), String(y)));
    // 고르면 바로 받으므로 이 단추는 '다시 받기' 구실이다 — 칠하기 단추와 헷갈리지 않게 보라색을 쓰지 않는다.
    const presetGo = button("", "map-choro-kosis-go"); presetGo.textContent = word("가져오기", "Import");
    const presetRow = el("div", "map-choro-row");
    const itemField = field(word("항목", "Item"), itemSelect);
    presetRow.append(field(word("통계", "Statistic"), presetSelect), itemField, field(word("해", "Year"), yearSelect), presetGo);
    const presetNote = el("small", "map-choro-kosis-hint");
    presetPane.append(presetRow, presetNote);

    // ② 검색해서 고르기
    const searchPane = el("div", "map-choro-kosis-pane"); searchPane.hidden = true;
    const searchForm = el("form", "map-choro-row");
    const searchInput = el("input", "map-choro-kosis-q");
    searchInput.type = "search"; searchInput.maxLength = 60; searchInput.placeholder = t("예: 도서관, 학생 수, 쌀 생산량");
    searchInput.setAttribute("aria-label", t("KOSIS 통계표 찾기"));
    const searchGo = button(""); searchGo.textContent = word("찾기", "Search"); searchGo.type = "submit";
    searchForm.append(searchInput, searchGo);
    const results = el("ul", "map-choro-kosis-results"); results.hidden = true;
    const tablePane = el("div", "map-choro-kosis-table"); tablePane.hidden = true;
    searchPane.append(searchForm, results, tablePane);

    // 안내 글의 → 는 글자로 둔다(icons.js 가 그림으로 바꾸면 "설정  연결"로 보인다).
    const status = el("p", "map-choro-kosis-status ui-keep-symbols"); status.setAttribute("aria-live", "polite");
    const source = el("a", "map-choro-kosis-source", "출처: KOSIS 국가통계포털");
    source.href = "https://kosis.kr/"; source.target = "_blank"; source.rel = "noopener noreferrer";
    box.append(tabs, presetPane, searchPane, status, source);
    container.append(box);

    let abort = null;
    const setStatus = value => { status.textContent = value; };
    const busy = on => { presetGo.disabled = searchGo.disabled = on; for (const b of tablePane.querySelectorAll("button")) b.disabled = on; };
    const fail = error => { if (!(error && error.name === "AbortError")) setStatus(t(api.failureText(error))); };
    const fresh = () => { if (abort) abort.abort(); abort = new AbortController(); return abort.signal; };

    function showTab(which){
      presetPane.hidden = which !== "preset"; searchPane.hidden = which !== "search";
      presetTab.classList.toggle("is-on", which === "preset"); searchTab.classList.toggle("is-on", which === "search");
      presetTab.setAttribute("aria-selected", String(which === "preset")); searchTab.setAttribute("aria-selected", String(which === "search"));
      setStatus("");
      (which === "search" ? searchInput : presetSelect).focus();
    }
    presetTab.addEventListener("click", () => showTab("preset"));
    searchTab.addEventListener("click", () => showTab("search"));

    // 받은 지역 줄을 지금 기준(시도/시군구)으로 넘긴다. 그 기준에 줄이 없으면 있는 쪽으로 바꿔 넘긴다.
    function deliver(regions, { title, unit, period, note }){
      const want = level() === "sido" ? "sido" : "sgg";
      const count = lv => regions.filter(r => r.level === lv).length;
      const lv = count(want) ? want : count(want === "sido" ? "sgg" : "sido") ? (want === "sido" ? "sgg" : "sido") : "";
      if (!lv){ setStatus(t("지역으로 나눈 값이 없어요. 다른 항목이나 해를 골라 주세요.")); return; }
      const fullTitle = title + (period ? " (" + period.replace(/^(\d{4})(\d{2})$/, "$1.$2") + ")" : "");
      onImport({ text:api.pasteText(regions, lv, fullTitle), title:fullTitle, unit, level:lv, note });
      setStatus((lv !== want ? t(lv === "sido" ? "이 통계는 시도까지만 있어 기준을 '시도'로 바꿨어요." : "이 통계는 시군구 값이라 기준을 '시군구'로 바꿨어요.") + " " : "")
        + t("가져왔어요 — 아래에서 색을 고르고 [칠하기]를 누르세요."));
    }

    // ① 자주 쓰는 통계
    function syncPreset(){
      const p = api.preset(presetSelect.value);
      itemSelect.replaceChildren(...(p ? p.items : []).map(([id, name]) => option(id, L(name) || L(p.title))));
      itemField.hidden = !p || p.items.length < 2;
      presetNote.textContent = p ? [p.note ? L(p.note) : "", p.levels.includes("sgg") ? "" : t("시도별로만 있는 통계예요.")].filter(Boolean).join(" ") : "";
    }
    /* 고르면 바로 받는다 — 처음엔 '고르기 → 가져오기 → 칠하기' 세 걸음이었는데, 가져오기를 건너뛰고 칠하기를 눌러
       빈 표로 끝나는 일이 있었다(2026-09-19). 받는 중에 칠하기를 누르면 창이 pending 을 기다린다. */
    let pending = Promise.resolve(false), seq = 0;
    function importPreset(){
      const p = api.preset(presetSelect.value);
      if (!p) return Promise.resolve(false);
      const signal = fresh(), mine = ++seq;
      busy(true); setStatus(t("KOSIS에서 받는 중…"));
      pending = (async () => {
        try {
          const result = await api.loadPreset(p.id, { item:itemSelect.value, year:yearSelect.value, signal });
          if (mine !== seq) return false;
          if (!result.regions.length){ setStatus(t(yearSelect.value ? "그 해 자료가 아직 없어요. 다른 해를 골라 주세요." : "자료가 없어요.")); return false; }
          const itemName = (p.items.find(i => i[0] === itemSelect.value) || [])[1];
          deliver(result.regions, { title:L(p.title) + (itemName ? " — " + L(itemName) : ""), unit:result.unit, period:result.period, note:p.note });
          return true;
        } catch(error){ if (mine === seq) fail(error); return false; }
        finally { if (mine === seq) busy(false); }
      })();
      return pending;
    }
    presetSelect.addEventListener("change", () => { syncPreset(); importPreset(); });
    itemSelect.addEventListener("change", importPreset);
    yearSelect.addEventListener("change", importPreset);
    presetGo.addEventListener("click", importPreset);
    syncPreset();

    // ② 검색 → 표 고르기 → 항목·분류·해 고르기
    searchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const q = searchInput.value.trim();
      if (!q){ searchInput.focus(); return; }
      const signal = fresh();
      busy(true); setStatus(t("KOSIS에서 찾는 중…")); tablePane.hidden = true;
      try {
        const list = await api.search(q, { signal });
        // 지역별 표를 앞으로(제목에 시도·시군구가 든 것).
        list.sort((a, b) => Number(b.regional) - Number(a.regional));
        results.replaceChildren(...list.map(item => {
          const li = document.createElement("li");
          const pick = button("", "map-choro-kosis-result");
          const name = el("strong"); name.textContent = item.title;
          const meta = el("small"); meta.textContent = [item.source, item.start && item.end ? item.start + "~" + item.end : ""].filter(Boolean).join(" · ");
          pick.append(name, meta);
          pick.addEventListener("click", () => openTable(item));
          li.append(pick);
          return li;
        }));
        results.hidden = !list.length;
        setStatus(list.length ? t("표를 고르세요. 제목에 '시도'·'시군구'가 든 표가 색칠 지도에 맞아요.") : t("찾은 통계표가 없어요. 다른 낱말로 찾아 보세요."));
      } catch(error){ fail(error); }
      finally { busy(false); }
    });

    async function openTable(item){
      const signal = fresh();
      busy(true); setStatus(t("통계표 정보를 받는 중…"));
      try {
        const [itm, prd] = await Promise.all([api.meta(item.org, item.tbl, "ITM", { signal }), api.meta(item.org, item.tbl, "PRD", { signal })]);
        const info = api.metaObjects(itm), prds = api.periods(prd);
        if (!info.region){ setStatus(t("이 표는 지역으로 나뉘어 있지 않아요. 다른 표를 골라 주세요.")); tablePane.hidden = true; return; }
        if (!info.items.length){ setStatus(t("이 표에서 값 항목을 찾지 못했어요.")); return; }
        renderTable(item, info, prds);
        setStatus("");
      } catch(error){ fail(error); }
      finally { busy(false); }
    }
    function renderTable(item, info, prds){
      tablePane.replaceChildren();
      const head = el("div", "map-choro-kosis-picked"); head.textContent = item.title;
      const row = el("div", "map-choro-row");
      const itemPick = el("select", "map-select");
      for (const i of info.items) itemPick.append(option(i.id, i.name + (i.unit ? " (" + i.unit + ")" : "")));
      row.append(field(word("항목", "Item"), itemPick));
      // 지역이 아닌 분류(성별·연령 등)는 하나씩 고른다 — 첫 값(대개 '계')이 기본.
      const others = info.classes.filter(c => c !== info.region).map(c => {
        const pick = el("select", "map-select");
        for (const v of c.values.slice(0, 400)) pick.append(option(v.id, v.name));
        row.append(field(c.name, pick));
        return { c, pick };
      });
      const yearly = prds.find(p => p.se === "Y");
      const se = yearly ? "Y" : (prds[0] && prds[0].se) || "Y";
      const yearPick = el("select", "map-select");
      yearPick.append(option("", word("가장 최근", "Latest")));
      if (yearly) for (const y of api.yearsOf(prds)) yearPick.append(option(y, y));
      row.append(field(word("해", "Year"), yearPick));
      const go = button("", "map-choro-kosis-table-go"); go.textContent = word("가져오기", "Import");
      row.append(go);
      tablePane.append(head, row);
      tablePane.hidden = false;
      go.addEventListener("click", async () => {
        const objs = info.classes.map(c => c === info.region ? "ALL" : (others.find(o => o.c === c) || {}).pick.value);
        const signal = fresh();
        busy(true); setStatus(t("KOSIS에서 받는 중…"));
        try {
          const rows = await api.data({ org:item.org, tbl:item.tbl, item:itemPick.value, objs, prdSe:se, year:yearPick.value }, { signal });
          const regionColumn = "C" + (info.classes.indexOf(info.region) + 1);
          const regions = api.regionRows(rows, { regionColumn });
          if (!regions.length){ setStatus(t(yearPick.value ? "그 해 자료가 아직 없어요. 다른 해를 골라 주세요." : "자료가 없어요.")); return; }
          const chosen = info.items.find(i => i.id === itemPick.value) || {};
          const extra = others.map(o => o.pick.selectedOptions[0] && o.pick.selectedOptions[0].textContent).filter(n => n && !/^(계|합계|전체|총계)$/.test(n));
          deliver(regions, { title:[api.text(chosen.name || item.title), ...extra].join(" · "),
            unit:api.text(chosen.unit || (rows[0] && rows[0].UNIT_NM) || ""), period:api.text(rows[0] && rows[0].PRD_DE) });
        } catch(error){ fail(error); }
        finally { busy(false); }
      });
    }

    return {
      box,
      // 칸을 열 때 지금 고른 통계를 곧바로 받는다(검색 탭을 보고 있으면 그대로 둔다).
      start(){ if (!presetPane.hidden) importPreset(); },
      // 기준(시도↔시군구)을 바꾸면 같은 통계를 그 기준으로 다시 넣는다.
      again(){ return presetPane.hidden ? Promise.resolve(false) : importPreset(); },
      // 받는 중이면 끝날 때까지 기다린다(칠하기가 빈 표로 끝나지 않게).
      whenReady(){ return pending; },
      destroy(){ if (abort) abort.abort(); box.remove(); }
    };
  }
  return { mount };
})();
