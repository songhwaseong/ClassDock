"use strict";

// 기존 버튼을 옮겨 쓰므로 만들기·열기·채점의 실행 경로는 유지한다.
const MNSidebarCreateMenu = (() => {
  const categories = [
    { id:"all", label:"전체", icon:"layers" },
    { id:"code", label:"코딩·데이터", icon:"code", column:0 },
    { id:"document", label:"문서·기록", icon:"notebook", column:0 },
    { id:"class", label:"수업 자료", icon:"board", column:1 },
    { id:"activity", label:"활동·뽑기", icon:"dice", column:1 },
    { id:"review", label:"열기·검수", icon:"check", column:0 }
  ];
  const items = [
    { id:"sbNewPy", category:"code", label:"파이썬 코드", extension:".py", color:"#caa019", description:"Python 코드 작성·실행", keywords:"python 파이썬 프로그래밍" },
    { id:"sbNewJs", category:"code", label:"자바스크립트 코드", extension:".js", color:"#6b8aa3", description:"JavaScript 코드 작성·실행", keywords:"javascript js mjs 자바스크립트 프로그래밍" },
    { id:"sbNewJava", category:"code", label:"자바 코드", extension:".java", color:"#d2603a", description:"Java 코드 작성·실행", keywords:"java jdk 자바 프로그래밍" },
    { id:"sbNewNotebook", category:"code", label:"노트북", extension:".ipynb", color:"#caa019", description:"코드·마크다운 셀을 작성하고 실행", keywords:"jupyter notebook python 노트북 주피터" },
    { id:"sbNewSheet", category:"code", label:"빈 표", extension:".xlsx", color:"#1f9d57", description:"셀·수식으로 데이터를 정리", keywords:"excel spreadsheet xlsx 엑셀 스프레드시트 표" },
    { id:"sbNewDbConn", category:"code", label:"DB 접속", extension:".dbconn", color:"#0f9f8f", description:"데이터베이스 연결 문서 만들기", keywords:"database sql db 데이터베이스 접속 연결" },
    { id:"sbNewText", category:"document", label:"텍스트 파일", extension:".txt", description:"간단한 글과 메모 작성", keywords:"text txt 메모 텍스트" },
    { id:"sbNewMnote", category:"document", label:"블록 문서", extension:".mnote", color:"#3b82f6", description:"글·표·이미지를 블록으로 구성", keywords:"block document note notion 블록 문서 노션 메모" },
    { id:"sbNewDiary", category:"document", label:"일기장", extension:".diary", color:"#d97706", description:"날짜별 글과 사진 기록", keywords:"diary journal 달력 일기 다이어리" },
    { id:"sbNewTrip", category:"document", label:"여행일지", extension:".trip", color:"#0f9f8f", description:"여정·지도·장소를 함께 기록", keywords:"trip travel 여행 일지 기록" },
    { id:"sbNewPhotoAlbum", category:"document", label:"사진첩 열기", color:"#8b5cf6", description:"사진과 영상을 모아 보는 사진첩 열기", keywords:"photo album image 사진첩 사진 앨범 이미지 영상" },
    { id:"sbNewBoard", category:"class", label:"화이트보드", color:"#8b5cf6", description:"그림과 글로 자유롭게 판서", keywords:"whiteboard board 화이트보드 칠판 판서 필기" },
    { id:"sbNewMusic", category:"class", label:"악보", extension:".msheet", color:"#ec4899", description:"음표를 놓고 소리로 확인", keywords:"music score sheet musicxml 악보 음악 오선 음표" },
    { id:"sbNewMap", category:"class", label:"지도", extension:".map", color:"#0f9f8f", description:"위치·거리·영역을 지도에 표시", keywords:"map geography 지도 지리 위치 거리" },
    { id:"sbNewTimeline", category:"class", label:"연대표", extension:".timeline", color:"#d97706", description:"사건과 기간을 시간순으로 정리", keywords:"timeline history 연대표 연표 역사 사건" },
    { id:"sbNewConcept", category:"class", label:"개념 관계도", extension:".concept", color:"#3b82f6", description:"개념을 연결해 관계와 구조 정리", keywords:"concept mindmap 개념 관계도 마인드맵 연결" },
    { id:"sbNewStudy", category:"class", label:"암기 카드", extension:".study", color:"#d97706", description:"문답·빈칸 카드를 만들고 복습", keywords:"study flashcard 암기 카드 단어장 복습 빈칸" },
    { id:"sbNewTier", category:"activity", label:"티어표", extension:".tier", color:"#3b82f6", description:"항목을 등급별로 나누어 배치", keywords:"tier rank 티어표 순위 등급 분류" },
    { id:"sbNewBracket", category:"activity", label:"대진표", extension:".bracket", color:"#8b5cf6", description:"토너먼트·리그 대진과 결과 관리", keywords:"bracket tournament 대진표 토너먼트 경기 리그" },
    { id:"sbNewPick", category:"activity", label:"복불복 뽑기", extension:".pick", color:"#ef4444", description:"참가자 명단으로 룰렛·추첨 진행", keywords:"pick random roulette draw 복불복 뽑기 추첨 룰렛 사다리" },
    { id:"sbLottoPicker", category:"activity", label:"로또 번호 뽑기", color:"#3b82f6", description:"로또 6/45 번호 조합 뽑기", keywords:"lotto lottery 645 로또 복권 번호" },
    { id:"sbPensionPicker", category:"activity", label:"연금복권 번호 뽑기", color:"#1f9d57", description:"연금복권 720+ 번호 조합 뽑기", keywords:"pension lottery 720 연금복권 복권 번호" },
    { id:"sbOpenLesson", category:"review", label:"리플레이 열기", extension:".lesson", color:"#3b82f6", description:"녹화한 수업 파일 열어 다시 보기", keywords:"lesson replay 리플레이 녹화 수업 재생 열기" },
    { id:"sbTaskBatch", category:"review", label:"제출본 일괄 검수", extension:".taskdone", color:"#0f9f8f", description:"과제 제출 파일을 모아 확인·재채점", keywords:"taskdone submission grading 과제 제출본 검수 채점" },
    { id:"sbNewExam", category:"review", label:"시험지 만들기", extension:".exam", color:"#8b5cf6", description:"객관식·주관식·이미지 문항 작성", keywords:"exam test quiz 시험지 시험 문제 출제" },
    { id:"sbExamGrade", category:"review", label:"시험 채점", extension:".examdone", color:"#ef4444", description:"제출된 답안을 채점하고 성적 정리", keywords:"examdone grading grade 시험 채점 답안 성적" }
  ];
  const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase().trim();

  function filterItems(source, query, category="all", translate=(value) => value){
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return source.filter((item) => {
      // 검색은 선택한 카테고리 밖의 도구도 찾는다.
      if (!words.length) return category === "all" || item.category === category;
      const group = categories.find((entry) => entry.id === item.category);
      const text = normalize([item.label, item.description, item.extension, item.keywords,
        translate(item.label), translate(item.description), group && group.label, group && translate(group.label)].join(" "));
      return words.every((word) => text.includes(word));
    });
  }

  function placement(anchor, panel, viewport){
    const pad = 8, gap = 7;
    const above = Math.max(0, anchor.top - gap - pad);
    const below = Math.max(0, viewport.height - anchor.bottom - gap - pad);
    const useAbove = above >= below;
    const maxHeight = Math.min(Math.max(0, viewport.height - pad * 2), useAbove ? above : below);
    const height = Math.min(panel.height, maxHeight);
    const left = Math.max(pad, Math.min(anchor.left, viewport.width - panel.width - pad));
    const top = useAbove ? anchor.top - gap - height : anchor.bottom + gap;
    return { left, top:Math.max(pad, top), maxHeight };
  }

  function init(button, menu, environment={}){
    if (!button || !menu) return null;
    const doc = environment.document || document, win = environment.window || window;
    const home = menu.parentNode;
    const translate = (value) => typeof win.t === "function" ? win.t(value) : value;
    const countText = (template, count) => typeof win.tf === "function"
      ? win.tf(template, { n:count }) : template.replace("{n}", count);
    const create = (tag, className, text) => {
      const element = doc.createElement(tag);
      if (className) element.className = className;
      if (text != null) element.textContent = translate(text);
      return element;
    };
    const icon = (name) => {
      const element = create("span", "sb-create-icon");
      element.setAttribute("aria-hidden", "true");
      if (typeof win.uiIcon === "function") element.innerHTML = win.uiIcon(name);
      return element;
    };
    const availableButtons = new Map(Array.from(menu.querySelectorAll(".sb-menu-item"), (entry) => [entry.id, entry]));
    const availableItems = items.filter((entry) => availableButtons.has(entry.id));
    let category = "all", visible = [], current = 0;

    menu.classList.add("sb-create-menu");
    menu.setAttribute("role", "dialog"); menu.setAttribute("aria-labelledby", "sbCreateTitle");
    menu.setAttribute("data-i18n-ui", ""); button.setAttribute("aria-haspopup", "dialog");
    const header = create("div", "sb-create-header");
    const title = create("strong", "sb-create-title", "새로 만들기"); title.id = "sbCreateTitle";
    const total = create("span", "sb-create-total", countText("{n}개 도구", availableItems.length));
    total.setAttribute("data-i18n-ignore", "");
    const close = create("button", "sb-create-close"); close.type = "button";
    close.setAttribute("aria-label", translate("닫기")); close.append(icon("close"));
    header.append(title, total, close);
    const searchWrap = create("div", "sb-create-search");
    const search = create("input"); search.type = "search";
    search.id = "sbCreateSearch"; search.autocomplete = "off"; search.spellcheck = false;
    search.placeholder = translate("도구 이름·확장자 검색");
    search.setAttribute("aria-label", translate("도구 이름·확장자 검색"));
    const clear = create("button", "sb-create-clear"); clear.type = "button";
    clear.setAttribute("aria-label", translate("검색 지우기")); clear.append(icon("close"));
    searchWrap.append(icon("search"), search, clear);
    const body = create("div", "sb-create-body");
    const navigation = create("div", "sb-create-categories");
    navigation.setAttribute("role", "tablist"); navigation.setAttribute("aria-label", translate("도구 카테고리"));
    navigation.setAttribute("aria-orientation", "vertical");
    const resultPane = create("div", "sb-create-results"); resultPane.id = "sbCreateResults";
    resultPane.setAttribute("role", "tabpanel"); resultPane.setAttribute("aria-labelledby", "sbCreateCategory-all");
    const summary = create("div", "sb-create-summary");
    const resultTitle = create("strong", "", "전체"), resultCount = create("span", "sb-create-count");
    resultCount.setAttribute("role", "status"); resultCount.setAttribute("aria-live", "polite");
    resultCount.setAttribute("data-i18n-ignore", ""); summary.append(resultTitle, resultCount);
    const grid = create("div", "sb-create-grid"); grid.setAttribute("role", "menu");
    grid.setAttribute("aria-label", translate("만들기·열기 도구"));
    const columns = [create("div", "sb-create-column"), create("div", "sb-create-column")];
    columns.forEach((column) => { column.setAttribute("role", "none"); grid.append(column); });
    const empty = create("div", "sb-create-empty", "검색 결과가 없습니다");
    resultPane.append(summary, grid, empty); body.append(navigation, resultPane);
    const records = new Map(), groups = [], tabs = [];

    for (const entry of categories){
      const members = availableItems.filter((item) => entry.id === "all" || item.category === entry.id);
      const tab = create("button", "sb-create-category"); tab.type = "button";
      tab.id = "sbCreateCategory-" + entry.id; tab.dataset.category = entry.id;
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", resultPane.id);
      const number = create("span", "sb-create-category-count", String(members.length));
      number.setAttribute("data-i18n-ignore", "");
      tab.append(icon(entry.icon), create("span", "sb-create-category-label", entry.label), number);
      navigation.append(tab); tabs.push(tab);
      tab.addEventListener("click", () => selectCategory(entry.id));
      if (entry.id === "all") continue;
      const group = create("section", "sb-create-group"); group.setAttribute("role", "group");
      const heading = create("div", "sb-create-group-title"); heading.id = "sbCreateGroup-" + entry.id;
      group.setAttribute("aria-labelledby", heading.id);
      const headingCount = create("span", "", String(members.length));
      headingCount.setAttribute("data-i18n-ignore", "");
      heading.append(create("span", "", entry.label), headingCount); group.append(heading);
      for (const item of members){
        const action = availableButtons.get(item.id), originalIcon = action.querySelector("svg");
        const symbol = create("span", "sb-create-item-icon"); symbol.setAttribute("aria-hidden", "true");
        if (originalIcon) symbol.append(originalIcon);
        const copy = create("span", "sb-create-copy");
        copy.append(create("span", "sb-create-label", item.label), create("small", "sb-create-description", item.description));
        action.replaceChildren(symbol, copy);
        if (item.extension){
          const extension = create("span", "sb-create-extension", item.extension);
          extension.setAttribute("data-i18n-ignore", ""); action.append(extension);
        }
        action.classList.add("sb-create-item");
        action.style.setProperty("--create-icon-color", item.color || "var(--muted)");
        if (!action.hasAttribute("data-shortcut-title")) action.title = translate(item.description);
        action.tabIndex = -1; records.set(item.id, action); group.append(action);
        // 먼저 닫아 새 뷰어나 파일 선택창에 생긴 포커스를 빼앗지 않는다.
        action.addEventListener("click", () => setOpen(false), true);
        action.addEventListener("focus", () => markCurrent(action));
        action.addEventListener("mouseenter", () => markCurrent(action));
      }
      columns[entry.column].append(group); groups.push({ entry, element:group, count:headingCount });
    }
    // 두 열의 DOM 순서대로 키보드가 이동한다.
    const orderedItems = Array.from(grid.querySelectorAll(".sb-create-item"), (action) => availableItems.find((item) => item.id === action.id));
    const footer = create("div", "sb-create-footer"), keys = create("span", "sb-create-keys");
    keys.append(create("kbd", "", "↑ ↓"), create("span", "", "도구 이동"),
      create("kbd", "", "Enter"), create("span", "", "실행"));
    const fullSearch = create("button", "sb-create-full-search"); fullSearch.type = "button";
    const shortcut = create("kbd", "", "Ctrl+K"); shortcut.setAttribute("data-shortcut-action", "commandPalette");
    fullSearch.append(icon("search"), create("span", "", "전체 기능 검색"), shortcut);
    footer.append(keys, fullSearch); menu.replaceChildren(header, searchWrap, body, footer);

    function markCurrent(action){
      const index = visible.findIndex((entry) => records.get(entry.id) === action);
      if (index >= 0) current = index;
      for (const [id, element] of records){
        const active = !!visible[current] && visible[current].id === id;
        element.classList.toggle("is-current", active); element.tabIndex = active ? 0 : -1;
      }
    }
    function render(){
      const query = search.value.trim();
      visible = filterItems(orderedItems, query, category, translate);
      const ids = new Set(visible.map((entry) => entry.id)), selected = query ? "all" : category;
      menu.dataset.view = query ? "search" : category === "all" ? "all" : "category";
      for (const tab of tabs){
        const active = tab.dataset.category === selected;
        tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
      }
      for (const [id, action] of records) action.hidden = !ids.has(id);
      for (const group of groups){
        const count = visible.filter((entry) => entry.category === group.entry.id).length;
        group.element.hidden = count === 0; group.count.textContent = String(count);
      }
      columns.forEach((column) => { column.hidden = Array.from(column.children).every((group) => group.hidden); });
      resultTitle.textContent = translate(query ? "검색 결과" : categories.find((entry) => entry.id === category).label);
      resultCount.textContent = countText(query ? "{n}개 검색 결과" : "{n}개 도구", visible.length);
      resultPane.setAttribute("aria-labelledby", "sbCreateCategory-" + selected);
      empty.hidden = visible.length > 0; grid.hidden = visible.length === 0; clear.hidden = !search.value;
      current = 0; markCurrent(visible[0] && records.get(visible[0].id));
      resultPane.scrollTop = 0; placeMenu();
    }
    function selectCategory(id){ category = id; search.value = ""; render(); }
    function placeMenu(){
      if (menu.hidden) return;
      // state.js가 rect와 innerWidth/Height를 같은 확대 전 좌표로 정규화한다.
      const anchor = button.getBoundingClientRect(), viewport = { width:win.innerWidth, height:win.innerHeight };
      let point = placement(anchor, { width:menu.offsetWidth, height:menu.offsetHeight }, viewport);
      menu.style.maxHeight = point.maxHeight + "px";
      point = placement(anchor, { width:menu.offsetWidth, height:menu.offsetHeight }, viewport);
      menu.style.left = point.left + "px"; menu.style.top = point.top + "px";
      menu.style.right = "auto"; menu.style.bottom = "auto";
    }
    function setOpen(open, restoreFocus=false){
      button.setAttribute("aria-expanded", String(open));
      if (open){
        doc.body.append(menu); menu.classList.add("sb-menu-viewport"); menu.hidden = false;
        category = "all"; search.value = ""; render(); search.focus();
      } else {
        menu.hidden = true; menu.classList.remove("sb-menu-viewport"); menu.removeAttribute("style"); home.append(menu);
        if (restoreFocus) button.focus();
      }
    }
    button.addEventListener("click", (event) => { event.stopPropagation(); setOpen(menu.hidden); });
    close.addEventListener("click", () => setOpen(false, true));
    clear.addEventListener("click", () => { search.value = ""; render(); search.focus(); });
    search.addEventListener("input", (event) => { if (!event.isComposing) render(); });
    search.addEventListener("compositionend", render);
    fullSearch.addEventListener("click", () => {
      setOpen(false);
      const trigger = doc.getElementById("commandPaletteOpen"); if (trigger) trigger.click();
    });
    menu.addEventListener("click", (event) => event.stopPropagation());
    doc.addEventListener("click", (event) => { if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) setOpen(false); });
    doc.addEventListener("focusin", (event) => { if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) setOpen(false); });
    menu.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false, true); return; }
      const tab = tabs.find((entry) => entry === event.target);
      if (tab && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)){
        event.preventDefault(); event.stopPropagation();
        const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : (tabs.indexOf(tab) + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[index].click(); tabs[index].focus(); return;
      }
      if (event.target !== search && !visible.some((entry) => records.get(entry.id) === event.target)) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && visible.length){
        if (event.target === search && ["Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        current = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
          : event.target === search ? (event.key === "ArrowDown" ? 0 : visible.length - 1)
          : (current + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
        const action = records.get(visible[current].id); markCurrent(action);
        action.focus(); action.scrollIntoView({ block:"nearest" });
      } else if (event.key === "Enter" && event.target === search){
        event.preventDefault(); event.stopPropagation();
        if (visible[current]) records.get(visible[current].id).click();
      } else if (["Enter", " "].includes(event.key) && event.target !== search){
        event.preventDefault(); event.stopPropagation(); event.target.click();
      }
    });
    win.addEventListener("resize", placeMenu);
    win.addEventListener("mni18nchange", () => {
      total.textContent = countText("{n}개 도구", availableItems.length); render();
    });
    if (typeof win.ResizeObserver === "function") new win.ResizeObserver(placeMenu).observe(menu);
    render();
    return { open:() => setOpen(true), close:() => setOpen(false, true) };
  }
  return { categories, items, filterItems, placement, init };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNSidebarCreateMenu;
