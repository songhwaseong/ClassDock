"use strict";
/*
 * 특수문자 문자표(MNSpecialChars)
 *
 * 왜: 한글에서 ※ ○ ① ㎡ 같은 글자는 "ㅁ 치고 한자키" 로 넣는 게 몸에 익어 있는데,
 *     이 앱은 브라우저 위에서 도는 편집기라 한자키(IME 특수문자 변환)가 오지 않는다.
 *     그래서 넣을 방법이 아예 없어, 다른 데서 복사해 오거나 포기하게 된다.
 *
 * 어떻게: 커서 자리에서 우클릭 → "특수문자" 를 고르면 문자표가 뜨고, 고른 글자를
 *     커서 자리에 그대로 넣는다. 묶음(탭) 이름 옆에 원래 한자키 자모(ㄱ·ㄴ·ㄷ…)를
 *     같이 적어, 손에 익은 순서 그대로 찾아갈 수 있게 했다.
 *
 * 왜 "묶음 이름 검색" 인가: 글자마다 이름을 다 붙이면 수백 줄짜리 사전이 되고 유지도 안 된다.
 *     대신 묶음에 찾을 말(별·동그라미·화살표·분수…)을 달아 두고 그걸로 거른다.
 *     실제로 사람들이 찾는 건 "그 글자 이름" 이 아니라 "그런 종류" 이기 때문이다.
 *
 * 넣는 자리: textarea·input 은 선택 영역을 갈아끼우고, contenteditable 은 열 때 잡아 둔
 *     Range 에 넣는다. 문자표가 뜨면서 포커스가 옮겨가므로, 커서 위치는 반드시 "열 때"
 *     붙잡아 두고 넣을 때마다 그만큼 앞으로 민다(Shift+클릭 연속 입력이 밀리지 않게).
 */
const MNSpecialChars = (() => {
  const RECENT_KEY = "mn.recentChars";
  const RECENT_MAX = 20;

  // key = 한글에서 그 묶음이 나오던 자모(한자키). 습관대로 찾아가라고 탭에 같이 적는다.
  const GROUPS = [
    { id:"punct", name:"문장부호", key:"ㄱ", words:"문장부호 마침표 쉼표 가운뎃점 말줄임표 물결 따옴표 참고 단락",
      chars:"·‥…―∥＼～¨〃´˝˚˙¸˛ˇ˘ˆ¡¿ː、。§¶†‡※‘’“”«»‹›〝〞" },
    { id:"bracket", name:"괄호", key:"ㄴ", words:"괄호 대괄호 중괄호 꺾쇠 낫표 겹낫표",
      chars:"（）［］｛｝〔〕〈〉《》「」『』【】⟨⟩‘’“”" },
    { id:"math", name:"수학", key:"ㄷ", words:"수학 연산 부등호 적분 시그마 루트 무한대 각도 집합 미분 논리",
      chars:"＋－±×÷＝≠＜＞≤≥≡≒≪≫∞∴∵∠⊥⌒∂∇√∽∝∫∬∈∋⊆⊇⊂⊃∪∩∧∨￢⇒⇔∀∃∑∏∮∅°′″㏒㏑" },
    { id:"unit", name:"단위", key:"ㄹ", words:"단위 화폐 원 달러 미터 그램 리터 섭씨 퍼센트 넓이 부피 넓이 전압",
      chars:"￦＄￠￡￥€％‰℃℉Å㎜㎝㎞㎟㎠㎡㎢㎣㎤㎥㎦㎍㎎㎏㎖㎗ℓ㎘㏄㎈㎉㎧㎨㎐㎑㎒㎓Ω㏀㏈㎩㏊㎾㎽㎼㎻㎺㎳㎲㎱㎰㏘㏂" },
    { id:"sign", name:"일반기호", key:"ㅁ", words:"기호 별 동그라미 네모 세모 하트 다이아 체크 전화 손가락 음표 주식회사 참고 도형 표시",
      chars:"＃＆＊＠§※☆★○●◎◇◆□■△▲▽▼◁◀▷▶♤♠♡♥♧♣⊙◈▣◐◑▒▤▥▨▧▦▩♨☏☎☜☞♭♩♪♬㉿㈜№㏇™℡✽⊿▪▫✓✔✗✘☑☒" },
    { id:"arrow", name:"화살표", key:"ㅁ", words:"화살표 방향 위 아래 왼쪽 오른쪽 순환 되돌리기",
      chars:"→←↑↓↔↕↗↙↖↘⇒⇐⇑⇓⇔⇕⇨⇦⇧⇩➔➜➡⬅⬆⬇↩↪⤴⤵↻↺" },
    { id:"line", name:"선·표", key:"ㅂ", words:"선 표 괘선 테두리 상자 음영 막대",
      chars:"─│┌┐┘└├┬┤┴┼━┃┏┓┛┗┣┳┫┻╋═║╔╗╝╚╠╦╣╩╬▁▔░▒▓█▏▎▍▌▋▊▉" },
    { id:"number", name:"원문자·번호", key:"ㅅ ㅇ", words:"원문자 번호 동그라미숫자 괄호숫자 가나다 알파벳 순서",
      chars:"①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩㈀㈁㈂㈃㈄㉮㉯㉰㉱㉲㈎㈏㈐㈑㈒ⓐⓑⓒⓓⓔⒶⒷⒸⒹⒺ" },
    { id:"roman", name:"로마·그리스", key:"ㅈ", words:"로마숫자 그리스 알파 베타 감마 세타 람다 파이 오메가",
      chars:"ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω" },
    { id:"frac", name:"분수·첨자", key:"ㅊ", words:"분수 첨자 지수 위첨자 아래첨자 제곱 절반",
      chars:"½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞¹²³⁴⁵ⁿ₁₂₃₄₅⁺⁻⁼⁽⁾₊₋₌₍₎" },
    { id:"jamo", name:"한글 자모", key:"", words:"자음 모음 자모 한글 기역 니은 아 야 어 여",
      chars:"ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ" },
    { id:"kana", name:"일본어 가나", key:"ㅋ ㅌ", words:"일본어 히라가나 가타카나 가나",
      chars:"ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをん" +
            "ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ" },
    { id:"cyrillic", name:"키릴(러시아)", key:"ㅍ", words:"러시아 키릴 러시아어",
      chars:"АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя" },
    { id:"latin", name:"라틴 확장", key:"ㅎ", words:"라틴 악센트 발음기호 알파벳 유럽",
      chars:"ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿŒœŁłŊŋĦħĲĳŦŧĸŉ" },
    // 이모지는 변형 선택자·ZWJ 가 붙어 글자 단위로 쪼개면 깨진다 → 배열로 하나씩 적는다.
    { id:"emoji", name:"그림문자", key:"", words:"이모지 그림 스티커 표정 칭찬 도장",
      chars:["😀","😄","😊","🙂","😉","😍","🤔","😅","😢","😮","👍","👏","🙌","✋","👉","📌","📎","📚","✏️","📝",
             "🔍","💡","⭐","🌟","🎉","🎁","🔥","⚠️","❗","❓","✅","❌","⏰","📅","🏫","🎯","🧩","🔔","☀️","🌙"] }
  ];

  const charList = (group) => (Array.isArray(group.chars) ? group.chars.slice() : Array.from(group.chars));

  const canStore = () => { try { return typeof localStorage !== "undefined"; } catch(_){ return false; } };
  function recent(){
    if (!canStore()) return [];
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((c) => typeof c === "string" && c).slice(0, RECENT_MAX) : [];
    } catch(_){ return []; }
  }
  function remember(ch){
    if (!ch || !canStore()) return;
    const list = [String(ch), ...recent().filter((c) => c !== ch)].slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch(_){}
  }
  function clearRecent(){ if (canStore()) try { localStorage.removeItem(RECENT_KEY); } catch(_){} }

  /* ── 넣을 자리 붙잡기 ── */
  // 문자표가 뜨면 포커스가 옮겨가므로 커서를 미리 붙잡아 둔다. 넣을 때마다 그만큼 뒤로 민다.
  function captureTarget(el, presetRange){
    if (!el) return null;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT"){
      const len = String(el.value || "").length;
      let start = Math.max(0, Math.min(el.selectionStart || 0, len));
      let end = Math.max(0, Math.min(el.selectionEnd || 0, len));
      if (end < start) [start, end] = [end, start];
      return { kind:"field", el, start, end };
    }
    if (el.isContentEditable || presetRange){
      // 메뉴를 거쳐 오면 선택이 이미 흐트러졌을 수 있어, 부른 쪽이 붙잡아 둔 Range 를 우선 쓴다.
      let range = presetRange ? presetRange.cloneRange() : null;
      if (!range) try {
        const sel = window.getSelection && window.getSelection();
        if (sel && sel.rangeCount){
          const r = sel.getRangeAt(0);
          if (el.contains(r.commonAncestorContainer)) range = r.cloneRange();
        }
      } catch(_){}
      return { kind:"editable", el, range };
    }
    return null;
  }

  function insertAt(spot, text){
    if (!spot || !text) return false;
    if (spot.kind === "field"){
      const el = spot.el;
      try { el.focus({ preventScroll:true }); } catch(_){ }
      try { el.setSelectionRange(spot.start, spot.end); } catch(_){}
      el.setRangeText(text, spot.start, spot.end, "end");
      el.dispatchEvent(new Event("input", { bubbles:true }));
      spot.start = spot.end = spot.start + text.length;    // 연속 입력이 같은 자리에 겹치지 않게 민다
      return true;
    }
    if (spot.kind === "editable"){
      const el = spot.el;
      try { el.focus({ preventScroll:true }); } catch(_){ }
      const sel = window.getSelection && window.getSelection();
      if (!sel) return false;
      if (spot.range){ sel.removeAllRanges(); sel.addRange(spot.range); }
      const range = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) return false;
      // execCommand 가 되면 그걸 쓴다 — 브라우저 되돌리기(Ctrl+Z)와 input 이벤트가 공짜로 따라온다.
      let done = false;
      try { done = document.execCommand("insertText", false, text); } catch(_){ done = false; }
      if (!done){
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node); range.collapse(true);
        sel.removeAllRanges(); sel.addRange(range);
        el.dispatchEvent(new Event("input", { bubbles:true }));
      }
      const after = sel.rangeCount ? sel.getRangeAt(0) : null;
      spot.range = after ? after.cloneRange() : null;   // 이어서 넣을 때 방금 넣은 글자 뒤에서 시작
      return true;
    }
    return false;
  }

  /* ── 문자표 ── */
  let closeActive = null;
  function close(){ if (typeof closeActive === "function") closeActive(); }

  // open({ x, y, target, range, insert, onClose })
  //   target : 글자를 넣을 textarea·input·contenteditable (insert 를 주면 없어도 된다)
  //   range  : contenteditable 에서 부른 쪽이 미리 붙잡아 둔 선택 위치
  //   insert : 직접 넣기(편집기의 되돌리기 기록을 타야 할 때). 넣었으면 true 를 돌려준다.
  //   onClose: 문자표가 닫힐 때(원래 편집 자리로 포커스를 돌려줄 때 쓴다)
  function open(options={}){
    close();
    const spot = typeof options.insert === "function" ? null : captureTarget(options.target, options.range);
    if (!spot && typeof options.insert !== "function") return null;

    const panel = document.createElement("div");
    panel.className = "mn-charmap";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "특수문자");

    const head = document.createElement("div"); head.className = "mn-charmap-head";
    const search = document.createElement("input"); search.className = "mn-charmap-search"; search.type = "search";
    search.placeholder = "종류로 찾기 (별·화살표·분수…)"; search.setAttribute("aria-label", "특수문자 종류 검색");
    const closeBtn = document.createElement("button"); closeBtn.type = "button"; closeBtn.className = "mn-charmap-close";
    closeBtn.textContent = "✕"; closeBtn.title = "닫기 (Esc)"; closeBtn.setAttribute("aria-label", "문자표 닫기");
    head.append(search, closeBtn);

    const tabs = document.createElement("div"); tabs.className = "mn-charmap-tabs"; tabs.setAttribute("role", "tablist");
    const grid = document.createElement("div"); grid.className = "mn-charmap-grid";
    const foot = document.createElement("div"); foot.className = "mn-charmap-foot";
    foot.textContent = "클릭: 넣고 닫기 · Shift+클릭: 계속 넣기 · Esc: 닫기";
    panel.append(head, tabs, grid, foot);

    let currentId = options.group || "";
    const put = (ch) => {
      const done = typeof options.insert === "function" ? options.insert(ch) !== false : insertAt(spot, ch);
      if (done) remember(ch);
      return done;
    };

    const visibleGroups = () => {
      const term = search.value.trim().toLowerCase();
      const list = [];
      const rec = recent();
      if (rec.length && !term) list.push({ id:"recent", name:"최근 쓴 글자", key:"", chars:rec });
      for (const g of GROUPS){
        if (!term || g.name.toLowerCase().includes(term) || g.words.includes(term)) list.push(g);
      }
      if (term && !list.length){
        // 찾은 말이 글자 자체면(붙여넣어 확인할 때) 그 글자만 보여 준다.
        const hit = GROUPS.flatMap(charList).filter((c) => c === search.value.trim());
        if (hit.length) list.push({ id:"hit", name:"찾은 글자", key:"", chars:hit });
      }
      return list;
    };

    const renderGrid = (group) => {
      grid.textContent = "";
      if (!group){ grid.append(Object.assign(document.createElement("p"), { className:"mn-charmap-empty", textContent:"찾는 종류가 없어요." })); return; }
      for (const ch of charList(group)){
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "mn-charmap-cell"; btn.textContent = ch; btn.title = ch;
        btn.addEventListener("pointerdown", (e) => e.preventDefault());   // 커서를 잡고 있는 편집기에서 포커스를 뺏지 않는다
        btn.addEventListener("click", (e) => {
          const ok = put(ch);
          if (e.shiftKey){ if (ok) renderTabs(); return; }                // 계속 넣기: 최근 목록만 갱신
          closePanel();
        });
        grid.appendChild(btn);
      }
    };

    const renderTabs = () => {
      const groups = visibleGroups();
      if (!groups.some((g) => g.id === currentId)) currentId = groups.length ? groups[0].id : "";
      tabs.textContent = "";
      for (const g of groups){
        const tab = document.createElement("button");
        tab.type = "button"; tab.className = "mn-charmap-tab" + (g.id === currentId ? " active" : "");
        tab.textContent = g.key ? (g.name + " " + g.key) : g.name;
        tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", g.id === currentId ? "true" : "false");
        if (g.key) tab.title = "한글에서 " + g.key + " + 한자키로 나오던 묶음";
        tab.addEventListener("pointerdown", (e) => e.preventDefault());
        tab.addEventListener("click", () => { currentId = g.id; renderTabs(); });
        tabs.appendChild(tab);
      }
      renderGrid(groups.find((g) => g.id === currentId));
    };

    const onOutside = (e) => { if (!panel.contains(e.target)) closePanel(); };
    const onKeydown = (e) => {
      if (e.key === "Escape"){ e.preventDefault(); closePanel(); return; }
      if (!e.key.startsWith("Arrow")) return;
      const cells = Array.from(grid.querySelectorAll(".mn-charmap-cell"));
      const at = cells.indexOf(document.activeElement);
      if (at === -1) return;
      const perRow = Math.max(1, Math.round(grid.clientWidth / Math.max(1, cells[0].offsetWidth)));
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? perRow : -perRow;
      const next = cells[Math.max(0, Math.min(cells.length - 1, at + step))];
      if (next){ e.preventDefault(); next.focus(); }
    };
    function closePanel(){
      if (!panel.isConnected) return;
      panel.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("resize", closePanel);
      if (closeActive === closePanel) closeActive = null;
      if (typeof options.onClose === "function") try { options.onClose(); } catch(_){}
    }

    search.addEventListener("input", renderTabs);
    // 닫기 버튼도 포커스를 뺏지 않는다 — 표 셀은 포커스를 잃는 순간 편집이 끝나 버린다.
    closeBtn.addEventListener("pointerdown", (e) => e.preventDefault());
    closeBtn.addEventListener("click", closePanel);
    renderTabs();

    document.body.appendChild(panel);
    const rect = panel.getBoundingClientRect();
    const x = Number.isFinite(options.x) ? options.x : (window.innerWidth - rect.width) / 2;
    const y = Number.isFinite(options.y) ? options.y : (window.innerHeight - rect.height) / 2;
    panel.style.left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, x)) + "px";
    panel.style.top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, y)) + "px";
    closeActive = closePanel;
    setTimeout(() => {
      if (!panel.isConnected) return;
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKeydown, true);
      window.addEventListener("resize", closePanel);
    }, 0);
    return closePanel;
  }

  return { open, close, recent, remember, clearRecent, groups: () => GROUPS.map((g) => ({ id:g.id, name:g.name, key:g.key, chars:charList(g) })) };
})();
