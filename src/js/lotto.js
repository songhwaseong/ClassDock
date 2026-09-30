"use strict";

// 로또 6/45: 화면과 같은 규칙을 Node에서도 검사할 수 있는 순수 모델.
const MNLotto = (() => {
  const KEY = "classdock-lotto-v1";
  const numbers = value => [...new Set((Array.isArray(value) ? value : []).filter(n => Number.isInteger(n) && n >= 1 && n <= 45))].sort((a, b) => a - b);
  function choose(n, k){
    if (n < k || k < 0) return 0;
    let result = 1;
    for (let i = 1; i <= k; i++) result = result * (n - i + 1) / i;
    return Math.round(result);
  }
  function randomInt(n, random){
    if (random){
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("난수는 0 이상 1 미만이어야 합니다.");
      return Math.floor(value * n);
    }
    if (typeof crypto !== "undefined" && crypto.getRandomValues){
      const limit = Math.floor(4294967296 / n) * n;
      const buffer = new Uint32Array(1);
      do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
      return buffer[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  function combination(pool, rank){
    const out = [];
    for (let i = 0; i < pool.length && out.length < 6; i++){
      const block = choose(pool.length - i - 1, 5 - out.length);
      if (rank < block) out.push(pool[i]);
      else rank -= block;
    }
    return out;
  }
  // 0 ~ total-1 순번에서 서로 다른 count 개를 뽑는다. 후보가 적어도 재시도 반복 없이 끝난다.
  function sampleRanks(total, count, random){
    const swaps = new Map(), ranks = [];
    for (let i = 0; i < count; i++){
      const last = total - i - 1, selected = randomInt(last + 1, random);
      ranks.push(swaps.has(selected) ? swaps.get(selected) : selected);
      swaps.set(selected, swaps.has(last) ? swaps.get(last) : last);
    }
    return ranks;
  }
  function draw(pool, count, random){
    const clean = numbers(pool);
    if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error("게임 수는 1~5개로 선택해 주세요.");
    if (clean.length < 6) throw new Error("뽑을 수 있는 번호가 6개 미만이에요. 제외 번호나 공통 번호 조건을 바꿔 주세요.");
    const total = choose(clean.length, 6);
    if (total < count) throw new Error("서로 다른 조합이 " + total + "개뿐이에요. 게임 수를 줄이거나 번호를 더 선택해 주세요.");
    return sampleRanks(total, count, random).map(rank => combination(clean, rank));
  }
  // 저장된 기록 공통 검사. parseGames 는 한 회차의 games 를 정리해 돌려주거나, 망가졌으면 null.
  function cleanHistory(list, parseGames){
    const seen = new Set(), history = [];
    for (const entry of (Array.isArray(list) ? list : []).slice(0, 100)){
      if (!entry || typeof entry.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.id) || seen.has(entry.id)) continue;
      if (!Number.isFinite(entry.time) || entry.time <= 0 || !Array.isArray(entry.games) || !entry.games.length || entry.games.length > 5) continue;
      const games = parseGames(entry.games);
      if (!games) continue;
      history.push({ id:entry.id, time:entry.time, games, saved:entry.saved === true });
      seen.add(entry.id);
    }
    history.sort((a, b) => b.time - a.time);
    return { history, seen };
  }
  const validCount = count => Number.isInteger(count) && count >= 1 && count <= 5 ? count : 1;
  function normalize(raw){
    const value = raw && typeof raw === "object" ? raw : {};
    const { history, seen } = cleanHistory(value.history, list => {
      const games = list.map(numbers);
      if (games.some((game, i) => game.length !== 6 || !Array.isArray(list[i]) || list[i].length !== 6) || new Set(games.map(game => game.join(","))).size !== games.length) return null;
      return games;
    });
    return { version:1, count:validCount(value.count),
      excluded:numbers(value.excluded), excludePrevious:value.excludePrevious === true, commonOnly:value.commonOnly === true,
      selected:[...new Set((Array.isArray(value.selected) ? value.selected : []).filter(id => seen.has(id)))], history };
  }
  function pool(state){
    const excluded = new Set(numbers(state.excluded));
    if (state.excludePrevious && state.history.length) state.history[0].games.flat().forEach(n => excluded.add(n));
    let candidates = Array.from({ length:45 }, (_, i) => i + 1);
    if (state.commonOnly){
      const rounds = state.history.filter(round => state.selected.includes(round.id));
      if (rounds.length < 2) return { numbers:[], reason:"최근 기록에서 비교할 회차를 2개 이상 선택해 주세요." };
      const sets = rounds.map(round => new Set(round.games.flat()));
      candidates = candidates.filter(n => sets.every(set => set.has(n)));
    }
    candidates = candidates.filter(n => !excluded.has(n));
    const total = choose(candidates.length, 6);
    // 직전 회차를 비교에 넣으면 공통 번호가 모두 그 회차 번호라 '이전 번호 제외'가 전부 지운다.
    const previousCompared = state.commonOnly && state.excludePrevious && state.history.length && state.selected.includes(state.history[0].id);
    const reason = candidates.length < 6 && previousCompared ? "직전 회차를 비교 회차로 고르면 '이전 번호 제외'가 공통 번호를 모두 지워요. 직전 회차 선택을 해제하거나 옵션 하나를 꺼 주세요."
      : candidates.length < 6 ? "뽑을 수 있는 번호가 " + candidates.length + "개예요. 번호가 6개 이상 필요해요."
      : total < state.count ? "서로 다른 조합이 " + total + "개뿐이에요. 게임 수를 줄여 주세요." : "";
    return { numbers:candidates, reason, excluded:[...excluded].sort((a, b) => a - b) };
  }
  return { KEY, numbers, choose, combination, draw, normalize, pool, randomInt, sampleRanks, cleanHistory, validCount };
})();

// 연금복권 720+: 조(1~5) + 여섯 자리 숫자(자리마다 0~9, 같은 숫자 가능). 순번 하나 = 조 × 10^자유자리 + 번호.
const MNPension = (() => {
  const KEY = "classdock-pension-v1";
  const digits = value => {
    const list = Array.isArray(value) ? value : [];
    return Array.from({ length:6 }, (_, i) => Number.isInteger(list[i]) && list[i] >= 0 && list[i] <= 9 ? list[i] : null);
  };
  const group = value => value === "all" || (Number.isInteger(value) && value >= 1 && value <= 5) ? value : "random";
  const ticket = value => value && Number.isInteger(value.group) && value.group >= 1 && value.group <= 5
    && typeof value.number === "string" && /^\d{6}$/.test(value.number) ? { group:value.group, number:value.number } : null;
  function pool(state){
    const fixed = digits(state.fixed), mode = group(state.group);
    const free = fixed.filter(d => d === null).length, numbers = 10 ** free;
    // 모든 조는 번호 하나로 1~5조 5장을 만들므로 장 수와 관계없이 번호 1개만 있으면 된다.
    const count = mode === "all" ? 5 : state.count, needed = mode === "all" ? 1 : count;
    const total = mode === "random" ? numbers * 5 : numbers;
    const reason = total < needed ? "서로 다른 표가 " + total + "장뿐이에요. 장 수를 줄이거나 고정한 자리를 풀어 주세요." : "";
    return { fixed, group:mode, free, count, total, reason };
  }
  function numberAt(fixed, index){
    const out = fixed.slice();
    for (let i = 5; i >= 0; i--) if (out[i] === null){ out[i] = index % 10; index = Math.floor(index / 10); }
    return out.join("");
  }
  function draw(state, random){
    if (!Number.isInteger(state.count) || state.count < 1 || state.count > 5) throw new Error("장 수는 1~5장으로 선택해 주세요.");
    const plan = pool(state);
    if (plan.reason) throw new Error(plan.reason);
    const numbers = 10 ** plan.free;
    if (plan.group === "all"){
      const number = numberAt(plan.fixed, MNLotto.randomInt(numbers, random));
      return [1, 2, 3, 4, 5].map(g => ({ group:g, number }));
    }
    return MNLotto.sampleRanks(plan.total, plan.count, random).map(rank => plan.group === "random"
      ? { group:Math.floor(rank / numbers) + 1, number:numberAt(plan.fixed, rank % numbers) }
      : { group:plan.group, number:numberAt(plan.fixed, rank) })
      .sort((a, b) => a.group - b.group || a.number.localeCompare(b.number));
  }
  function normalize(raw){
    const value = raw && typeof raw === "object" ? raw : {};
    const { history } = MNLotto.cleanHistory(value.history, list => {
      const games = list.map(ticket);
      if (games.some(game => !game) || new Set(games.map(game => game.group + ":" + game.number)).size !== games.length) return null;
      return games;
    });
    return { version:1, count:MNLotto.validCount(value.count), group:group(value.group), fixed:digits(value.fixed), history };
  }
  return { KEY, digits, pool, draw, normalize, numberAt };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Object.assign(MNLotto, { pension:MNPension });

(function(){
  if (typeof window === "undefined" || !window.document) return;
  let opened = null, openedSwitch = null;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (cls, text, action) => {
    const node = el("button", cls, text); node.type = "button";
    if (action) node.addEventListener("click", action);
    return node;
  };
  function icon(name){
    const node = el("span", "lotto-icon"); node.setAttribute("aria-hidden", "true");
    if (typeof uiIcon === "function") node.innerHTML = uiIcon(name);
    return node;
  }
  // 공 한 줄. item = { text, color, suffix } — 연금복권 조 공은 "3조"처럼 작은 글자를 붙인다.
  function ballRow(items, small, label){
    const row = el("div", "lotto-balls" + (small ? " lotto-balls-small" : ""));
    row.style.setProperty("--lotto-cols", String(items.length));
    for (const item of items){
      const node = el("span", "lotto-ball lotto-ball-" + item.color + (small ? " lotto-ball-small" : ""));
      if (item.suffix){ const face = el("span", "lotto-ball-face", item.text); face.appendChild(el("small", null, item.suffix)); node.appendChild(face); }
      else node.textContent = item.text;
      row.appendChild(node);
    }
    row.setAttribute("aria-label", label);
    return row;
  }
  const own = (object, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);
  const EMPTY_LABEL = "아직 뽑은 번호가 없습니다";
  const lottoColor = n => n == null ? "empty" : n <= 10 ? "yellow" : n <= 20 ? "blue" : n <= 30 ? "purple" : n <= 40 ? "green" : "silver";
  const PENSION_COLORS = ["yellow", "blue", "purple", "green", "orange", "pink"];
  // 복권마다 다른 것만 모았다. 창 뼈대·기록·저장·복사·내보내기는 함께 쓴다.
  const GAMES = {
    lotto:{ model:MNLotto, tab:"로또 6/45", brand:"LOTTO", brandSub:"6 / 45", eyebrow:"LOTTO 6/45", title:"로또 번호 뽑기",
      unit:"게임", file:"로또", fair:"모든 조합의 당첨 확률은 같습니다.", compare:true, empty:[null, null, null, null, null, null],
      balls:(game, small) => ballRow(game.map(n => ({ text:n == null ? "?" : String(n), color:lottoColor(n) })), small, game.every(n => n != null) ? game.join(", ") : EMPTY_LABEL),
      text:game => game.join(" · "),
      draw:(state, candidate) => MNLotto.draw(candidate.numbers, state.count),
      drawn:(games, candidate) => games.length + "게임을 뽑았어요. 후보 번호 " + candidate.numbers.length + "개에서 선택했어요." },
    pension:{ model:MNPension, tab:"연금복권 720+", brand:"연금복권", brandSub:"720+", eyebrow:"PENSION 720+", title:"연금복권 번호 뽑기",
      unit:"장", file:"연금복권", fair:"모든 번호의 당첨 확률은 같습니다.", compare:false, empty:{ group:null, number:null },
      balls:(ticket, small) => {
        const digits = ticket.number ? ticket.number.split("") : [null, null, null, null, null, null];
        return ballRow([{ text:ticket.group ? String(ticket.group) : "?", suffix:ticket.group ? "조" : "", color:ticket.group ? "group" : "empty" },
          ...digits.map((d, i) => ({ text:d == null ? "?" : d, color:d == null ? "empty" : PENSION_COLORS[i] }))],
          small, ticket.number ? ticket.group + "조 " + digits.join(" ") : EMPTY_LABEL);
      },
      text:ticket => ticket.group + "조  " + ticket.number,
      draw:state => MNPension.draw(state),
      drawn:(games, candidate) => games.length + "장을 뽑았어요." + (candidate.group === "all" ? " 1~5조 모두 같은 번호예요." : "") }
  };
  const dateText = time => new Date(time).toLocaleString("ko-KR", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  const roundText = (game, round) => round.games.map((entry, i) => String.fromCharCode(65 + i) + "  " + game.text(entry)).join("\n");

  function openLottoPicker(options){
    const wanted = options && own(GAMES, options.game) ? options.game : "";
    if (opened){ if (wanted) openedSwitch(wanted); opened.focus(); return; }
    const load = id => {
      const model = GAMES[id].model;
      try { return model.normalize(JSON.parse(localStorage.getItem(model.KEY) || "null")); }
      catch (_){ return model.normalize(null); }
    };
    const states = { lotto:load("lotto"), pension:load("pension") }, activeIds = {};
    for (const id of Object.keys(states)) activeIds[id] = states[id].history[0] && states[id].history[0].id;
    // 들어가는 길마다 { game } 을 넘긴다. 없으면 로또로 연다.
    let kind = wanted || "lotto";
    let view = "draw", storageNotice = "";
    const S = () => states[kind], G = () => GAMES[kind];
    const previousFocus = document.activeElement;
    const modal = el("div", "modal lotto-modal"), card = el("div", "lotto-shell");
    opened = card; card.tabIndex = -1;
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-labelledby", "lotto-heading");
    const rail = el("nav", "lotto-rail"); rail.setAttribute("aria-label", "복권 메뉴");
    const brand = el("div", "lotto-brand"), brandName = el("span"), brandSub = el("small");
    brand.append(el("span", "lotto-mark", "✦"), brandName, brandSub);
    rail.appendChild(brand);
    const navButtons = [];
    for (const [id, label, symbol] of [["draw", "번호 뽑기", "shuffle"], ["history", "최근 기록", "index"], ["saved", "저장한 번호", "save"]]){
      const node = button("lotto-nav", "", () => { view = id; render(); });
      node.append(icon(symbol), el("span", "lotto-nav-label", label)); rail.appendChild(node); navButtons.push([id, node]);
    }
    const exit = button("lotto-nav lotto-exit", "닫기", shut); exit.prepend(icon("close")); rail.appendChild(exit);
    // 앱 전체의 main/header 배치 규칙이 이 도구 안으로 들어오지 않게 독립된 컨테이너를 쓴다.
    const main = el("div", "lotto-main"), kinds = el("div", "lotto-kinds");
    kinds.setAttribute("role", "group"); kinds.setAttribute("aria-label", "복권 종류");
    const kindButtons = Object.keys(GAMES).map(id => { const node = button("lotto-kind", GAMES[id].tab, () => switchKind(id)); kinds.appendChild(node); return [id, node]; });
    const heading = el("div", "lotto-heading"), headingText = el("div"), eyebrow = el("p", "lotto-eyebrow"), title = el("h2"); title.id = "lotto-heading";
    headingText.append(eyebrow, title, el("p", "lotto-subtitle", "원하는 조건을 고르고, 나만의 번호를 뽑아보세요."));
    const close = button("lotto-close", "", shut); close.appendChild(icon("close"));
    heading.append(headingText, close); main.append(kinds, heading);
    const parts = { lotto:buildLottoParts(), pension:buildPensionParts() };
    main.append(parts.lotto.controls, parts.pension.controls);
    const surface = el("section", "lotto-panel lotto-result"), content = el("div", "lotto-result-content");
    const drawButton = button("lotto-draw", "번호 뽑기", generate); drawButton.prepend(icon("shuffle"));
    const status = el("p", "lotto-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const actions = el("div", "lotto-actions");
    const copy = button("lotto-secondary", "번호 복사", () => copyRound(activeRound())); copy.prepend(icon("copy"));
    const save = button("lotto-secondary", "저장하기", () => {
      const round = activeRound(); if (!round) return;
      round.saved = !round.saved; persist(); render();
      status.textContent = round.saved ? "저장한 번호에 추가했어요." : "저장 표시를 해제했어요.";
    }); save.prepend(icon("save"));
    const exportButton = button("lotto-secondary lotto-export", "텍스트로 내보내기", async () => {
      const game = G(), round = activeRound(); if (!round || typeof saveTextDoc !== "function") return;
      const ok = await saveTextDoc(game.tab + "\n" + dateText(round.time) + "\n\n" + roundText(game, round) + "\n", null, game.file + "-" + new Date(round.time).toISOString().slice(0, 10) + ".txt");
      status.textContent = ok === true ? "번호를 파일로 저장했어요." : "파일 저장을 완료하지 않았어요.";
    });
    actions.append(copy, save, exportButton); surface.append(content, drawButton, status, actions); main.appendChild(surface);
    const note = el("p", "lotto-fair"); main.appendChild(note);
    const side = el("aside", "lotto-side");
    const history = el("section", "lotto-panel lotto-history"), historyHead = el("div", "lotto-panel-head");
    const allHistory = button("lotto-text-button", "전체 보기", () => { view = "history"; render(); });
    historyHead.append(el("h3", null, "최근 기록"), allHistory);
    const historyHint = el("p", "lotto-history-hint");
    const historyRows = el("div", "lotto-history-rows"); history.append(historyHead, historyHint, historyRows);
    side.append(parts.lotto.side, parts.pension.side, history);
    card.append(rail, main, side); modal.appendChild(card);

    // 로또: 게임 수·이전 번호 제외·공통 번호 / 제외할 번호 패널
    function buildLottoParts(){
      const state = states.lotto;
      const controls = el("section", "lotto-panel lotto-controls"), counter = el("div", "lotto-count-group");
      counter.appendChild(el("span", "lotto-label", "게임 수 선택"));
      const counts = el("div", "lotto-counts"); counts.setAttribute("role", "group"); counts.setAttribute("aria-label", "게임 수 선택");
      const countButtons = [];
      for (let count = 1; count <= 5; count++){
        const node = button("lotto-count", count + "게임", () => { state.count = count; persist(); render(); });
        counts.appendChild(node); countButtons.push(node);
      }
      counter.appendChild(counts);
      const options = el("div", "lotto-options");
      const makeToggle = (label, key, hint) => {
        const wrap = el("label", "lotto-toggle"), input = el("input"); input.type = "checkbox";
        input.addEventListener("change", () => {
          state[key] = input.checked;
          // 이전 번호 제외가 켜져 있으면 직전 회차를 건너뛰고 그 앞 두 회차를 비교한다.
          const skip = state.excludePrevious && state.history.length > 2 ? 1 : 0;
          if (key === "commonOnly" && input.checked && state.selected.length < 2) state.selected = state.history.slice(skip, skip + 2).map(round => round.id);
          persist(); render();
        });
        wrap.title = hint; wrap.append(input, el("span", null, label)); options.appendChild(wrap); return input;
      };
      const previousInput = makeToggle("이전 번호 제외", "excludePrevious", "직전 회차의 모든 게임에서 나온 번호를 제외합니다.");
      const commonInput = makeToggle("공통 번호로 뽑기", "commonOnly", "최근 기록에서 선택한 회차들에 공통으로 나온 번호만 사용합니다.");
      controls.append(counter, options);
      const panel = el("section", "lotto-panel lotto-exclusion");
      const head = el("div", "lotto-panel-head"), reset = button("lotto-text-button", "초기화", () => { state.excluded = []; persist(); render(); });
      reset.dataset.lottoFocus = "reset";
      head.append(el("h3", null, "제외할 번호"), reset);
      const chips = el("div", "lotto-chips"), poolNote = el("p", "lotto-pool-note");
      const details = el("details", "lotto-number-details"), summary = el("summary", null, "번호 선택 · 1~45");
      const grid = el("div", "lotto-number-grid"); const gridButtons = [];
      for (let n = 1; n <= 45; n++){
        const node = button("lotto-number", String(n), () => {
          state.excluded = state.excluded.includes(n) ? state.excluded.filter(value => value !== n) : [...state.excluded, n];
          persist(); render();
        });
        node.setAttribute("aria-label", n + "번 제외"); grid.appendChild(node); gridButtons.push(node);
      }
      details.append(summary, grid); panel.append(head, chips, details, poolNote);
      function update(candidate){
        countButtons.forEach((node, i) => { node.classList.toggle("active", state.count === i + 1); node.setAttribute("aria-pressed", String(state.count === i + 1)); });
        previousInput.checked = state.excludePrevious; commonInput.checked = state.commonOnly;
        poolNote.textContent = "뽑을 수 있는 번호 " + candidate.numbers.length + "개" + (state.excludePrevious ? " · 직전 회차 제외" : "") + (state.commonOnly ? " · 선택한 회차의 공통 번호" : "");
        chips.replaceChildren();
        const blocked = candidate.excluded || state.excluded;
        if (!blocked.length) chips.appendChild(el("p", "lotto-empty", "제외할 번호를 아래에서 선택해 주세요."));
        blocked.forEach(n => {
          if (state.excluded.includes(n)){
            const chip = button("lotto-chip", n + " ×", () => { state.excluded = state.excluded.filter(value => value !== n); persist(); render(); });
            chip.setAttribute("aria-label", n + "번 직접 제외 해제"); chip.dataset.lottoFocus = "chip:" + n; chips.appendChild(chip);
          } else { const chip = el("span", "lotto-chip lotto-chip-auto", String(n)); chip.title = "직전 회차에서 나온 번호"; chips.appendChild(chip); }
        });
        gridButtons.forEach((node, i) => { const selected = state.excluded.includes(i + 1); node.classList.toggle("active", selected); node.setAttribute("aria-pressed", String(selected)); });
        reset.disabled = !state.excluded.length;
      }
      return { controls, side:panel, update, fallback:() => chips.querySelector("button") || summary };
    }
    // 연금복권: 장 수·조 선택 / 자리 고정 패널
    function buildPensionParts(){
      const state = states.pension;
      const controls = el("section", "lotto-panel lotto-controls"), counter = el("div", "lotto-count-group");
      counter.appendChild(el("span", "lotto-label", "장 수 선택"));
      const counts = el("div", "lotto-counts"); counts.setAttribute("role", "group"); counts.setAttribute("aria-label", "장 수 선택");
      const countButtons = [];
      for (let count = 1; count <= 5; count++){
        const node = button("lotto-count", count + "장", () => { state.count = count; persist(); render(); });
        counts.appendChild(node); countButtons.push(node);
      }
      counter.appendChild(counts);
      const groupBox = el("div", "lotto-group-box"), choices = el("div", "lotto-counts lotto-group-choices");
      choices.setAttribute("role", "group"); choices.setAttribute("aria-label", "조 선택");
      const groupButtons = [["random", "무작위"], [1, "1조"], [2, "2조"], [3, "3조"], [4, "4조"], [5, "5조"], ["all", "모든 조"]].map(([value, label]) => {
        const node = button("lotto-count lotto-group-choice", label, () => { state.group = value; persist(); render(); });
        choices.appendChild(node); return [value, node];
      });
      const groupHint = el("p", "lotto-group-hint");
      groupBox.append(el("span", "lotto-label", "조 선택"), choices, groupHint);
      controls.append(counter, groupBox);
      const panel = el("section", "lotto-panel lotto-fixed"), head = el("div", "lotto-panel-head");
      const reset = button("lotto-text-button", "초기화", () => { state.fixed = [null, null, null, null, null, null]; persist(); render(); });
      reset.dataset.lottoFocus = "reset";
      head.append(el("h3", null, "자리 고정"), reset);
      const grid = el("div", "lotto-fixed-grid"), selects = [];
      ["십만", "만", "천", "백", "십", "일"].forEach((name, i) => {
        const cell = el("label", "lotto-fixed-cell"), select = el("select");
        select.appendChild(new Option("?", ""));
        for (let d = 0; d <= 9; d++) select.appendChild(new Option(String(d), String(d)));
        select.setAttribute("aria-label", name + " 자리 숫자 고정");
        select.addEventListener("change", () => { state.fixed[i] = select.value === "" ? null : Number(select.value); persist(); render(); });
        cell.append(el("span", null, name), select); grid.appendChild(cell); selects.push(select);
      });
      const poolNote = el("p", "lotto-pool-note");
      panel.append(head, el("p", "lotto-fixed-hint", "숫자를 고른 자리는 뽑는 모든 표에 그 숫자가 들어가요. ?는 무작위예요."), grid, poolNote);
      function update(candidate){
        const all = state.group === "all";
        countButtons.forEach((node, i) => { const on = !all && state.count === i + 1; node.classList.toggle("active", on); node.setAttribute("aria-pressed", String(on)); node.disabled = all; });
        groupButtons.forEach(([value, node]) => { const on = state.group === value; node.classList.toggle("active", on); node.setAttribute("aria-pressed", String(on)); });
        groupHint.textContent = all ? "같은 번호로 1~5조 5장을 뽑아요. 장 수는 5장으로 고정돼요." : state.group === "random" ? "표마다 조도 무작위로 골라요." : state.group + "조로만 뽑아요.";
        selects.forEach((select, i) => { select.value = state.fixed[i] === null ? "" : String(state.fixed[i]); select.classList.toggle("active", state.fixed[i] !== null); });
        reset.disabled = state.fixed.every(d => d === null);
        poolNote.textContent = "무작위 자리 " + candidate.free + "개 · " + (all ? "서로 다른 번호 " + candidate.total.toLocaleString("ko-KR") + "개" : "서로 다른 표 " + candidate.total.toLocaleString("ko-KR") + "장");
      }
      return { controls, side:panel, update, fallback:() => selects[0] };
    }

    function activeRound(){ return S().history.find(round => round.id === activeIds[kind]) || null; }
    function persist(){
      try { localStorage.setItem(G().model.KEY, JSON.stringify(S())); storageNotice = ""; }
      catch (_){ storageNotice = "이 컴퓨터에 기록을 저장하지 못했어요. 필요한 번호는 복사하거나 파일로 내보내 주세요."; }
    }
    // 복사하면 메모에도 글 블록으로 넣는다. 같은 창에서 같은 회차를 또 복사해도 메모에는 한 번만 넣는다.
    const memoSent = new Set();
    function sendToMemo(game, round){
      if (memoSent.has(round.id)) return "already";
      if (typeof window.appendTextToScratchpad !== "function") return "";
      try {
        if (!window.appendTextToScratchpad(game.tab + " · " + dateText(round.time) + "\n" + roundText(game, round))) return "";
      } catch (_){ return ""; }
      memoSent.add(round.id);
      return "added";
    }
    async function copyRound(round){
      if (!round) return;
      const game = G(), memo = sendToMemo(game, round);
      const memoText = memo === "added" ? " 메모에도 넣었어요." : memo === "already" ? " 메모에는 이미 넣었어요." : "";
      // 클립보드 대체 경로가 임시 textarea 에 포커스를 옮겼다 지우므로 누른 버튼으로 되돌린다.
      const focused = document.activeElement;
      let ok = false;
      try { ok = typeof copyDocumentMenuText === "function" && await copyDocumentMenuText(roundText(game, round), game.file + " 번호를 복사했어요." + memoText); }
      catch (_){}
      status.textContent = ok ? "번호를 복사했어요." + memoText
        : memo === "added" ? "클립보드 복사는 못 했지만 메모에는 넣었어요."
        : "복사하지 못했어요. 텍스트로 내보내기를 이용해 주세요.";
      if (opened === card && usable(focused) && document.activeElement !== focused) focused.focus();
    }
    // 다시 그리면 누른 요소가 새로 만들어지거나 비활성이 되어 포커스가 창 밖으로 빠진다.
    const usable = node => !!node && node !== card && node.isConnected && !node.disabled && card.contains(node) && node.getClientRects().length > 0;
    function restoreFocus(focused, key){
      if (!focused || (usable(focused) && document.activeElement === focused)) return;
      const same = key ? [...card.querySelectorAll("[data-lotto-focus]")].find(node => node.dataset.lottoFocus === key) : null;
      const type = key ? key.split(":")[0] : "";
      const fallback = type === "chip" || type === "reset" ? parts[kind].fallback()
        : type === "show" ? drawButton : null;
      const target = [same, fallback].find(usable);
      (target || card).focus();
    }
    function generate(){
      const state = S(), game = G(), candidate = game.model.pool(state);
      if (candidate.reason){ status.textContent = candidate.reason; return; }
      try {
        const games = game.draw(state, candidate);
        const round = { id:kind + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9), time:Date.now(), games, saved:false };
        state.history.unshift(round);
        // 저장 표시가 있는 회차를 먼저 보존하고, 최근 기록은 100회까지 유지한다.
        if (state.history.length > 100){
          const index = state.history.findLastIndex(entry => !entry.saved);
          state.history.splice(index >= 1 ? index : 100, 1);
        }
        if (state.selected) state.selected = state.selected.filter(id => state.history.some(entry => entry.id === id));
        activeIds[kind] = round.id; view = "draw"; persist(); render();
        content.classList.remove("lotto-reveal"); void content.offsetWidth; content.classList.add("lotto-reveal");
        status.textContent = storageNotice || game.drawn(games, candidate);
      } catch (error){ status.textContent = error.message; }
    }
    function historyRow(round, place){
      const state = S(), game = G();
      const row = el("div", "lotto-history-row"), line = el("div", "lotto-history-line");
      if (game.compare){
        const check = el("input"); check.type = "checkbox"; check.checked = state.selected.includes(round.id);
        check.dataset.lottoFocus = "check:" + place + ":" + round.id;
        check.setAttribute("aria-label", dateText(round.time) + " 회차 공통 번호 비교에 선택");
        check.addEventListener("change", () => {
          state.selected = check.checked ? [...state.selected, round.id] : state.selected.filter(id => id !== round.id);
          persist(); render();
        });
        line.appendChild(check);
      }
      line.append(el("span", "lotto-time", dateText(round.time)), el("span", "lotto-games-count", round.games.length + game.unit));
      const show = button("lotto-history-game", "", () => { activeIds[kind] = round.id; view = "draw"; render(); });
      show.setAttribute("aria-label", dateText(round.time) + " 번호 다시 보기"); show.dataset.lottoFocus = "show:" + place + ":" + round.id;
      show.appendChild(game.balls(round.games[0], true));
      if (round.games.length > 1) show.appendChild(el("small", null, "+" + (round.games.length - 1)));
      const rowCopy = button("lotto-row-copy", "", () => copyRound(round)); rowCopy.appendChild(icon("copy")); rowCopy.setAttribute("aria-label", "이 회차 번호 복사");
      rowCopy.dataset.lottoFocus = "copy:" + place + ":" + round.id;
      const numbersLine = el("div", "lotto-history-numbers"); numbersLine.append(show, rowCopy); row.append(line, numbersLine);
      return row;
    }
    function render(){
      const focused = card.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused && focused.dataset ? focused.dataset.lottoFocus || "" : "";
      const state = S(), game = G(), candidate = game.model.pool(state), round = activeRound();
      card.dataset.game = kind;
      kindButtons.forEach(([id, node]) => { node.classList.toggle("active", id === kind); node.setAttribute("aria-pressed", String(id === kind)); });
      brandName.textContent = game.brand; brandSub.textContent = game.brandSub;
      eyebrow.textContent = game.eyebrow; title.textContent = game.title; close.setAttribute("aria-label", game.title + " 닫기");
      note.textContent = game.fair;
      for (const id of Object.keys(parts)){ parts[id].controls.hidden = id !== kind; parts[id].side.hidden = id !== kind; }
      parts[kind].update(candidate);
      navButtons.forEach(([id, node]) => { node.classList.toggle("active", id === view); node.setAttribute("aria-current", id === view ? "page" : "false"); });
      content.replaceChildren();
      if (view === "draw"){
        content.appendChild(el("p", "lotto-result-caption", round ? "선택된 번호 · " + dateText(round.time) : "나의 행운 번호"));
        const games = round ? round.games : [game.empty];
        games.forEach((entry, i) => {
          const row = el("div", "lotto-game");
          if (games.length > 1) row.appendChild(el("span", "lotto-game-label", String.fromCharCode(65 + i)));
          row.appendChild(game.balls(entry, games.length > 1)); content.appendChild(row);
        });
      } else {
        content.appendChild(el("h3", "lotto-list-title", view === "saved" ? "저장한 번호" : "전체 기록"));
        const entries = state.history.filter(entry => view !== "saved" || entry.saved);
        const list = el("div", "lotto-full-history");
        if (!entries.length) list.appendChild(el("p", "lotto-empty", view === "saved" ? "마음에 드는 번호를 뽑고 저장하기를 눌러 주세요." : "번호를 뽑으면 여기에 기록이 쌓여요."));
        entries.forEach(entry => list.appendChild(historyRow(entry, "list"))); content.appendChild(list);
      }
      drawButton.hidden = view !== "draw"; actions.hidden = view !== "draw";
      drawButton.disabled = !!candidate.reason; copy.disabled = !round; save.disabled = !round; exportButton.disabled = !round;
      save.lastChild.textContent = round && round.saved ? "저장 해제" : "저장하기";
      status.classList.toggle("lotto-status-error", !!candidate.reason || !!storageNotice);
      status.textContent = storageNotice || candidate.reason || (round ? "다시 뽑아도 이전 기록은 보관됩니다." : "번호 뽑기를 눌러 첫 번호를 뽑아 보세요.");
      historyRows.replaceChildren();
      if (!state.history.length) historyRows.appendChild(el("p", "lotto-empty", "아직 뽑은 기록이 없어요. 첫 번호를 뽑아보세요."));
      state.history.slice(0, 5).forEach(entry => historyRows.appendChild(historyRow(entry, "side")));
      historyHint.textContent = game.compare ? "비교할 회차 " + state.selected.length + "개 선택 · 2개 이상 선택하면 공통 번호로 뽑을 수 있어요."
        : "번호를 누르면 가운데에서 크게 다시 볼 수 있어요.";
      restoreFocus(focused, focusKey);
    }
    function switchKind(next){
      if (!own(GAMES, next) || next === kind) return;
      kind = next; view = "draw"; render();
    }
    openedSwitch = switchKind;
    function shut(){
      window.removeEventListener("keydown", onKey, true); modal.remove(); opened = null; openedSwitch = null;
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    function onKey(event){
      if (event.key === "Escape"){ event.preventDefault(); event.stopImmediatePropagation(); shut(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...card.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary")].filter(node => node.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first){ event.preventDefault(); return; }
      // 포커스가 창 밖(문서 맨 앞 등)에 있으면 뒤의 앱으로 넘어가지 않게 창 안으로 되돌린다.
      const outside = !card.contains(document.activeElement) || document.activeElement === card;
      if (event.shiftKey && (outside || document.activeElement === first)){ event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (outside || document.activeElement === last)){ event.preventDefault(); first.focus(); }
    }
    modal.addEventListener("click", event => { if (event.target === modal) shut(); });
    window.addEventListener("keydown", onKey, true);
    document.body.appendChild(modal); render(); requestAnimationFrame(() => close.focus());
  }
  window.openLottoPicker = openLottoPicker;
})();
