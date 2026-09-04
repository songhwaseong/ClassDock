"use strict";

/* 예제 갤러리 — 언어별 예제 목록을 같은 화면에서 보여 준다(파이썬 / 자바).
   예제 데이터는 언어별 파일(python-snippets.js · java-snippets.js)에 있고 여기서는 그리기만 한다.
   언어를 더하려면 SNIPPET_LANGS 에 한 줄만 늘리면 된다 — 카테고리·난이도·검색은 데이터에서 뽑는다.
   ⚠ 예제를 여는 방법은 언어마다 다르다(open) — 아래 openJavaSnippet 주석 참고. */

const SNIPPET_LEVELS = { 1: { label: "입문", star: "⭐" }, 2: { label: "기본", star: "⭐⭐" }, 3: { label: "심화", star: "⭐⭐⭐" }, 4: { label: "응용", star: "⭐⭐⭐⭐" }, 5: { label: "도전", star: "⭐⭐⭐⭐⭐" } };

function snippetIcon(snippet) {
  const category = String(snippet.cat || "");
  if (category.includes("그래프")) return "graph";
  if (category.includes("random") || category.includes("시뮬레이션")) return "dice";
  if (category.includes("수학") || category.includes("알고리즘") || category.includes("정렬")) return "math";
  if (category.includes("문자열")) return "text";
  if (category.includes("리스트") || category.includes("딕셔너리") || category.includes("배열")) return "list";
  if (category.includes("날짜")) return "clock";
  if (category.includes("함수") || category.includes("메서드") || category.includes("클래스")) return "function";
  if (category.includes("예외")) return "warning";
  if (category.includes("응용")) return "puzzle";
  return "code";
}

function openPythonSnippet(snip){
  handleFiles([new File([snip.code], snip.name, { type: "text/x-python" })]);
}

/* 자바는 파이썬과 달리 queueFiles 로 연다 — handleFiles 만 부르면 편집 초안을 붙일 바탕 문서가 없어
   아직 저장하지 않은 새 .java 가 자동복원에서 사라진다(java-editor.js 의 newJavaScratch 와 같은 이유). */
function openJavaSnippet(snip){
  const file = new File([snip.code], snip.name, { type:"text/x-java-source" });
  if (typeof queueFiles === "function") queueFiles([file], { isScratch:true });
  else handleFiles([file], { isScratch:true });
}

const SNIPPET_LANGS = [
  { id:"py", label:"파이썬", ext:"py", title:"파이썬 예제 갤러리", note:"",
    list: () => (typeof PY_SNIPPETS !== "undefined" ? PY_SNIPPETS : []), open: openPythonSnippet },
  { id:"java", label:"자바", ext:"java", title:"자바 예제 갤러리",
    note:" 자바 실행은 앱(EXE)에 자바(JDK)가 있어야 해요 — 없으면 ▶ 에서 설치를 안내해요.",
    list: () => (typeof JAVA_SNIPPETS !== "undefined" ? JAVA_SNIPPETS : []), open: openJavaSnippet },
];

function snippetLangById(id){
  for (const lang of SNIPPET_LANGS){ if (lang.id === id) return lang; }
  return null;
}

// 지금 보고 있는 문서의 확장자로 첫 탭을 고른다 — .java 를 편집하다 열면 자바 탭부터 보인다.
function defaultSnippetLangId(){
  try {
    const cur = (typeof activeId !== "undefined" && typeof docs !== "undefined") ? docs.find(d => d.id === activeId) : null;
    const name = String((cur && cur.name) || "");
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
    for (const lang of SNIPPET_LANGS){ if (lang.ext === ext && lang.list().length) return lang.id; }
  } catch(_){}
  return SNIPPET_LANGS[0].id;
}

function openSnippetGallery(langId){
  if (document.querySelector(".snippet-modal")) return;          // 중복 열림 방지
  // 예제가 하나도 없는 언어는 탭에서 뺀다(자바 목록을 채우기 전에도 파이썬 갤러리는 그대로 열린다).
  const langs = SNIPPET_LANGS.filter(lang => lang.list().length > 0);
  if (!langs.length) return;
  let current = snippetLangById(langId) || snippetLangById(defaultSnippetLangId()) || langs[0];
  if (langs.indexOf(current) < 0) current = langs[0];

  /* 같은 문제를 다른 언어로도 풀어 둔 예제를 서로 이어 둔다 — 파이썬 쪽은 id, 자바 쪽은 pair 를 갖는다.
     파이썬 목록은 제목도 파일 이름도 중복이 있어(소수.py·회문.py 등) 이름으로는 짝을 찾을 수 없다. */
  const partners = new Map();          // 예제 객체 -> { lang, snip }
  for (const a of langs) {
    for (const b of langs) {
      if (a === b) continue;
      const byId = new Map();
      for (const s of b.list()) if (s.id) byId.set(s.id, s);
      for (const s of a.list()) {
        const other = s.pair ? byId.get(s.pair) : null;
        if (!other) continue;
        partners.set(s, { lang: b, snip: other });
        partners.set(other, { lang: a, snip: s });
      }
    }
  }

  const modal = document.createElement("div"); modal.className = "modal snippet-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const h = document.createElement("h3");
  const sub = document.createElement("div"); sub.className = "sub";
  const close = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
  const onKey = (e) => { if (e.key === "Escape"){ e.preventDefault(); close(); } };

  // 검색창: 제목·카테고리·설명·개념·파일명으로 빠르게 거르기(예제가 많아짐)
  const search = document.createElement("input"); search.type = "search"; search.className = "snippet-search";
  search.placeholder = "예제 검색 (제목·설명·개념)"; search.setAttribute("aria-label", "예제 검색");

  // 언어 탭: 예제가 있는 언어가 둘 이상일 때만 보인다.
  const langBar = document.createElement("div"); langBar.className = "snippet-filter snippet-langbar";
  langBar.setAttribute("role", "group"); langBar.setAttribute("aria-label", "언어 고르기");
  langBar.hidden = langs.length < 2;
  const langChips = langs.map(lang => {
    const chip = document.createElement("button"); chip.type = "button"; chip.className = "snippet-chip";
    chip.textContent = lang.label + " " + lang.list().length;
    chip.addEventListener("click", () => { if (lang !== current) selectLang(lang); });
    langBar.appendChild(chip);
    return { chip, lang };
  });

  // 난이도 필터 칩: 전체 / ⭐ 입문 / ⭐⭐ 기본 / ⭐⭐⭐ 심화 / ⭐⭐⭐⭐ 응용 / ⭐⭐⭐⭐⭐ 도전
  // 개수는 언어마다 다르므로 탭을 바꿀 때 다시 그린다.
  let levelFilter = 0;   // 0 = 전체
  const filterBar = document.createElement("div"); filterBar.className = "snippet-filter"; filterBar.setAttribute("role", "group"); filterBar.setAttribute("aria-label", "난이도 필터");
  let chips = [];

  // 카테고리별로 묶어 헤더 + 카드 그리드로 렌더(긴 목록은 본문 스크롤)
  const body = document.createElement("div"); body.className = "snippet-body";
  let sections = [];
  const emptyMsg = document.createElement("div"); emptyMsg.className = "snippet-empty"; emptyMsg.textContent = "조건에 맞는 예제가 없어요."; emptyMsg.hidden = true;

  const applyFilter = () => {
    const q = search.value.trim().toLocaleLowerCase();
    let any = false;
    sections.forEach(sec => {
      let shown = 0;
      sec.cards.forEach(c => {
        const ok = (!q || c.hay.includes(q)) && (!levelFilter || c.level === levelFilter);
        c.el.hidden = !ok; if (ok) shown++;
      });
      sec.head.hidden = sec.grid.hidden = (shown === 0);
      if (shown) any = true;
    });
    emptyMsg.hidden = any;
  };

  const buildLevelChips = () => {
    filterBar.textContent = "";
    const list = current.list();
    const countFor = (lv) => list.filter(s => !lv || s.level === lv).length;
    const chipDefs = [{ lv: 0, text: "전체 " + countFor(0) }].concat(
      [1, 2, 3, 4, 5].map(lv => ({ lv, text: SNIPPET_LEVELS[lv].star + " " + SNIPPET_LEVELS[lv].label + " " + countFor(lv) }))
    );
    chips = chipDefs.map(def => {
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "snippet-chip"; chip.textContent = def.text;
      chip.setAttribute("aria-pressed", def.lv === levelFilter ? "true" : "false");
      if (def.lv === levelFilter) chip.classList.add("active");
      chip.addEventListener("click", () => {
        levelFilter = def.lv;
        chips.forEach(c => { const on = (c === chip); c.classList.toggle("active", on); c.setAttribute("aria-pressed", on ? "true" : "false"); });
        applyFilter();
      });
      filterBar.appendChild(chip);
      return chip;
    });
  };

  const buildBody = () => {
    body.textContent = "";
    sections = [];
    const cats = [], byCat = new Map();
    current.list().forEach(s => { const c = s.cat || "기타"; if (!byCat.has(c)){ byCat.set(c, []); cats.push(c); } byCat.get(c).push(s); });
    cats.forEach(c => {
      const head = document.createElement("div"); head.className = "snippet-cat"; head.textContent = c;
      const grid = document.createElement("div"); grid.className = "snippet-grid";
      const cards = [];
      byCat.get(c).forEach(s => {
        const lvInfo = SNIPPET_LEVELS[s.level] || null;
        const b = document.createElement("button"); b.type = "button"; b.className = "snippet-card"; b.title = s.name;
        if (lvInfo){ b.classList.add("lv" + s.level); b.setAttribute("aria-label", s.title + " · " + lvInfo.label + " · " + (s.desc || "")); }
        const top = document.createElement("span"); top.className = "snippet-top";
        const em = document.createElement("span"); em.className = "snippet-emoji"; em.innerHTML = uiIcon(snippetIcon(s));
        top.appendChild(em);
        if (lvInfo){ const lv = document.createElement("span"); lv.className = "snippet-level"; lv.textContent = lvInfo.star; lv.title = lvInfo.label; top.appendChild(lv); }
        const t = document.createElement("span"); t.className = "snippet-title"; t.textContent = s.title;
        b.append(top, t);
        if (s.desc){ const d = document.createElement("span"); d.className = "snippet-desc"; d.textContent = s.desc; b.appendChild(d); }
        if (Array.isArray(s.learn) && s.learn.length){
          const tags = document.createElement("span"); tags.className = "snippet-tags";
          s.learn.slice(0, 3).forEach(name => { const tag = document.createElement("span"); tag.className = "snippet-tag"; tag.textContent = name; tags.appendChild(tag); });
          b.appendChild(tags);
        }
        const opener = current.open;
        b.addEventListener("click", () => { close(); opener(s); });

        // 카드(버튼) 안에 또 버튼을 넣을 수 없으므로, 칸을 하나 두고 카드 아래에 짝 링크를 붙인다.
        const cell = document.createElement("div"); cell.className = "snippet-cell";
        cell.appendChild(b);
        const partner = partners.get(s);
        if (partner) {
          const link = document.createElement("button"); link.type = "button"; link.className = "snippet-pair";
          link.textContent = partner.lang.label + " 버전 보기";
          link.title = partner.lang.label + " 예제 " + partner.snip.title + " 로 이동";
          link.addEventListener("click", () => selectLang(partner.lang, partner.snip));
          cell.appendChild(link);
        }
        grid.appendChild(cell);
        cards.push({ el: cell, node: b, snip: s, level: s.level || 0, hay: (s.title + " " + c + " " + (s.desc || "") + " " + (Array.isArray(s.learn) ? s.learn.join(" ") : "") + " " + (s.name || "")).toLocaleLowerCase() });
      });
      body.append(head, grid);
      sections.push({ head, grid, cards });
    });
    body.appendChild(emptyMsg);
  };

  // focus 를 주면(짝 링크로 건너올 때) 그 예제가 보이도록 검색어·난이도 필터를 풀고 그 자리로 옮긴다.
  function selectLang(lang, focus){
    current = lang;
    levelFilter = 0;                                     // 언어를 바꾸면 난이도 필터는 처음으로
    if (focus) search.value = "";
    h.textContent = lang.title;
    sub.textContent = "예제 " + lang.list().length + "개 · 난이도로 고르고 클릭하면 새 코드로 열려요. ▶ 실행("
      + shortcutDisplay(shortcutValue("runCode")) + ")으로 바로 돌려보세요." + (lang.note || "");
    langChips.forEach(item => {
      const on = (item.lang === lang);
      item.chip.classList.toggle("active", on);
      item.chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
    buildLevelChips();
    buildBody();
    applyFilter();
    body.scrollTop = 0;
    if (!focus) return;
    for (const sec of sections) {
      const hit = sec.cards.find(c => c.snip === focus);
      if (!hit) continue;
      hit.el.classList.add("is-target");                 // 어디로 왔는지 잠깐 표시해 준다
      setTimeout(() => { try { hit.el.classList.remove("is-target"); } catch(e){} }, 2000);
      try { hit.node.scrollIntoView({ block:"center" }); hit.node.focus({ preventScroll:true }); } catch(e){}
      break;
    }
  }

  search.addEventListener("input", applyFilter);

  const actions = document.createElement("div"); actions.className = "modal-actions";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "닫기";
  cancel.addEventListener("click", close);
  actions.append(spacer, cancel);
  card.append(h, sub, search, langBar, filterBar, body, actions);
  selectLang(current);
  modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });   // 바깥 클릭 닫기
  document.body.appendChild(modal);
  setTimeout(() => { try { search.focus(); } catch(e){} }, 0);   // 열면 바로 검색 가능
  window.addEventListener("keydown", onKey, true);
}
