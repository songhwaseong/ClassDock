"use strict";

/* ===== 복불복 — 카드 뽑기 =====
   카드 여러 장 가운데 당첨 k 장을 숨겨 두고, 명단 차례대로 한 사람씩 한 장을 골라 뒤집는다. 당첨 k 명이 다 나오면 끝.
   당첨 자리는 카드를 나눌 때(pickCardDeal) 정해진다 — 먼저 고르든 나중에 고르든 누구나 확률이 같다(제비뽑기와 같은 셈).
   '카드 섞기'는 카드가 가운데로 모였다가 새로 흩어지는 움직임과 함께 새 판을 나눈다. 진행 상태는 화면에만 둔다. */
const PICK_CARD_MAX = 40;
function pickCardInt(value, min, max, fallback){ const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function pickCardWord(value, max, fallback){ return String(value == null ? "" : value).trim().slice(0, max) || fallback; }
function pickCardNormalize(raw){
  const v = raw && typeof raw === "object" ? raw : {};
  return { count:v.count === "auto" || v.count == null || v.count === "" ? "auto" : pickCardInt(v.count, 2, PICK_CARD_MAX, "auto"),
    winners:pickCardInt(v.winners, 1, PICK_CARD_MAX - 1, 1), winLabel:pickCardWord(v.winLabel, 12, "당첨"), loseLabel:pickCardWord(v.loseLabel, 12, "통과"),
    turns:v.turns === "random" ? "random" : "list" };
}
function pickCardRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
/* 카드 수 — '자동'이면 참가자 수(2~40). 당첨 수는 카드 수 - 1 과 사람 수를 넘지 않는다(모두 당첨·당첨 못 할 사람 없음). */
function pickCardPlan(settings, people){
  const s = pickCardNormalize(settings), count = s.count === "auto" ? Math.max(2, Math.min(PICK_CARD_MAX, people)) : s.count;
  return { count, winners:Math.max(1, Math.min(s.winners, count - 1, Math.max(1, people))) };
}
function pickCardDeal(count, winners, random=pickCardRandom){
  const deck = Array.from({ length:count }, (_, i) => i < winners);
  for (let i = deck.length - 1; i > 0; i--){ const j = Math.min(i, Math.floor(random() * (i + 1))); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
/* 판에 카드를 가장 크게 — 열 수를 하나씩 해 보며 카드 폭이 가장 큰 것을 고른다(카드 가로:세로 = ratio). */
function pickCardGrid(count, w, h, gap, ratio, maxW){
  let best = { cols:1, cw:0 };
  for (let cols = 1; cols <= count; cols++){
    const rows = Math.ceil(count / cols), cw = Math.min((w - gap * (cols - 1)) / cols, (h - gap * (rows - 1)) / rows * ratio, maxW || 240);
    if (cw > best.cw + 0.01) best = { cols, cw };
  }
  return { cols:best.cols, cw:Math.max(40, Math.floor(best.cw)), ch:Math.max(40, Math.floor(Math.max(40, best.cw) / ratio)) };
}
/* 다음 차례 — 이미 당첨된 사람은 건너뛴다. 모두 건너뛰면 -1. */
function pickCardNextTurn(order, from, doneIds){
  for (let step = 1; step <= order.length; step++){ const i = (from + step) % order.length; if (!doneIds.has(order[i].id)) return i; }
  return -1;
}

function mountPickCard(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-cards"), tools = make("div", "pick-game-tools"), turnBar = make("div", "pick-card-turn"), area = make("div", "pick-card-area"), grid = make("div", "pick-card-grid");
  area.appendChild(grid); box.append(tools, turnBar, area); api.arena.appendChild(box);
  let deck = [], order = [], turn = 0, found = [], phase = "playing", sig = null, cardEls = [], plan = { count:2, winners:1 };
  const settings = () => api.settings();
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const STAR = '<svg class="pick-card-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

  function deal(){
    const people = api.active(), s = settings(); plan = pickCardPlan(s, people.length);
    deck = pickCardDeal(plan.count, plan.winners).map(win => ({ win, flipped:false, by:null }));
    order = s.turns === "random" && typeof pickShuffle === "function" ? pickShuffle(people) : people.slice();
    turn = 0; found = []; phase = "playing";
  }
  function renderTools(){
    const s = settings(), people = api.active().length; tools.innerHTML = "";
    const chip = (label, value, min, max, onSet, suffix) => {
      const el = make("span", "pick-chip"), minus = make("button", "pick-chip-btn"), plus = make("button", "pick-chip-btn"), b = make("b");
      minus.type = plus.type = "button"; minus.textContent = "−"; plus.textContent = "+"; b.textContent = String(value);
      minus.disabled = value <= min; plus.disabled = value >= max; minus.onclick = () => { if (!api.isBusy()) onSet(value - 1); }; plus.onclick = () => { if (!api.isBusy()) onSet(value + 1); };
      el.append(document.createTextNode(label + " "), minus, b, plus, document.createTextNode(suffix)); return el;
    };
    tools.appendChild(chip(s.winLabel, plan.winners, 1, Math.max(1, Math.min(plan.count - 1, people)), value => api.setSettings({ winners:value }), "장"));
    tools.appendChild(chip("카드", plan.count, 2, PICK_CARD_MAX, value => api.setSettings({ count:value }), "장"));
    if (s.count !== "auto"){ const auto = make("button", "pick-chip-btn is-wide"); auto.type = "button"; auto.textContent = "사람 수에 맞추기"; auto.onclick = () => { if (!api.isBusy()) api.setSettings({ count:"auto" }); }; tools.appendChild(auto); }
  }
  function renderTurn(){
    turnBar.innerHTML = "";
    const status = make("span", "pick-card-status"); status.textContent = `${settings().winLabel} ${found.length}/${plan.winners}`;
    if (phase === "done"){ const text = make("strong"); text.textContent = "끝! '카드 섞기'로 새 판을 시작해요"; turnBar.append(text, status); return; }
    const person = order[turn]; if (!person){ turnBar.append(status); return; }
    const who = make("span", "pick-card-who"); const name = make("strong"); name.textContent = `${person.name || "사진 참가자"} 차례`;
    who.append(typeof pickAvatar === "function" ? pickAvatar(person) : make("span"), name);
    const hint = make("span", "pick-card-hint"); hint.textContent = "카드를 한 장 고르세요";
    turnBar.append(who, hint, status);
  }
  // 글(당첨·통과·뒤집은 사람)은 drawGrid 가 textContent 로 넣는다 — 사람이 쓴 글을 HTML 로 넣지 않게.
  function faceHtml(card, index){
    const front = card.win
      ? `<span class="pick-card-front is-win"><i class="pk-bit b1"></i><i class="pk-bit b2"></i><i class="pk-bit b3"></i><i class="pk-bit b4"></i><i class="pk-bit b5"></i><i class="pk-bit b6"></i>${STAR}<b></b><small></small></span>`
      : `<span class="pick-card-front"><b></b><small></small></span>`;
    return `<span class="pick-card-inner"><span class="pick-card-back"><span class="pick-card-frame"></span>${STAR}<em>${index + 1}</em></span>${front}</span>`;
  }
  function drawGrid(){
    grid.innerHTML = ""; cardEls = [];
    const s = settings();
    deck.forEach((card, i) => {
      const el = make("button", "pick-card"); el.type = "button"; el.dataset.i = String(i); el.style.setProperty("--d", (i * 22) + "ms");
      el.innerHTML = faceHtml(card, i);
      const front = el.querySelector(".pick-card-front"); front.querySelector("b").textContent = card.win ? s.winLabel : s.loseLabel; front.querySelector("small").textContent = card.by ? (card.by.name || "사진") : "";
      if (card.flipped) el.classList.add("is-flipped"); if (card.revealed) el.classList.add("is-revealed");
      el.setAttribute("aria-label", card.flipped ? `${i + 1}번 카드 — ${card.win ? s.winLabel : s.loseLabel}` : `${i + 1}번 카드 뒤집기`);
      el.disabled = card.flipped || phase === "done";
      grid.appendChild(el); cardEls.push(el);
    });
    fit();
  }
  function fit(){
    const w = area.clientWidth, h = area.clientHeight; if (!w || !h || !deck.length) return;
    const g = pickCardGrid(deck.length, w - 8, h - 8, Math.max(8, Math.min(22, w / 40)), 0.95, 260);
    grid.style.gridTemplateColumns = `repeat(${g.cols}, ${g.cw}px)`; grid.style.setProperty("--pk-card-h", g.ch + "px"); grid.style.setProperty("--pk-card-w", g.cw + "px");
  }
  function flip(i){
    const card = deck[i]; if (!card || card.flipped || phase !== "playing" || api.isBusy()) return;
    const person = order[turn]; if (!person) return;
    api.hideResult(); card.flipped = true; card.by = person;
    const el = cardEls[i]; if (el){ el.querySelector(".pick-card-front small").textContent = person.name || "사진"; el.classList.add("is-flipped"); el.disabled = true; }
    const m = api.motion(); api.setBusy(true); api.sound("pop");
    later(m ? 700 * m : 0, () => {
      if (card.win){ found.push(person); api.sound("tick"); }
      if (found.length >= plan.winners){
        phase = "done"; deck.forEach(c => { if (!c.flipped) c.revealed = true; }); api.setBusy(false); drawGrid(); renderTurn();
        api.showResult(found.slice(), { kicker:found.length > 1 ? `${settings().winLabel} ${found.length}명` : `${settings().winLabel}!`, againLabel:"카드 섞기" });
        return;
      }
      const next = pickCardNextTurn(order, turn, new Set(found.map(p => p.id)));
      if (next < 0){ phase = "done"; api.setBusy(false); drawGrid(); renderTurn(); return; }
      turn = next; api.setBusy(false); renderTurn();
    });
  }
  grid.addEventListener("click", event => { const el = event.target.closest(".pick-card"); if (el) flip(Number(el.dataset.i)); });
  /* 섞기 — 모두 가운데로 모였다가(gather) 새 판으로 흩어진다. */
  function gatherVars(){
    const g = grid.getBoundingClientRect(), cx = g.left + g.width / 2, cy = g.top + g.height / 2;
    cardEls.forEach(el => { const r = el.getBoundingClientRect(); el.style.setProperty("--gx", (cx - (r.left + r.width / 2)) + "px"); el.style.setProperty("--gy", (cy - (r.top + r.height / 2)) + "px"); el.style.setProperty("--gr", ((Math.random() - 0.5) * 18).toFixed(1) + "deg"); });
  }
  function start(){
    if (api.isBusy() || api.active().length < 2) return;
    const m = api.motion();
    if (!m){ deal(); drawGrid(); renderTurn(); renderTools(); return; }
    api.setBusy(true); api.sound("pop"); gatherVars(); grid.classList.add("is-gathering");
    later(460 * m, () => {
      deal(); drawGrid(); renderTurn(); renderTools(); gatherVars(); void grid.offsetWidth;
      requestAnimationFrame(() => { grid.classList.remove("is-gathering"); api.sound("tick"); });
      later(560 * m, () => { api.setBusy(false); });
    });
  }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(area);
  return {
    render(){
      if (api.isBusy()) return;
      const list = api.active(), next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002") + "\u0003" + JSON.stringify(settings());
      if (next !== sig){ sig = next; deal(); }
      renderTools(); renderTurn(); drawGrid();
    },
    canStart:() => api.active().length >= 2,
    start,
    menuItems:() => { const s = settings(); return [
      { label:"차례", icon:"list", children:[["list", "명단 차례대로"], ["random", "차례 섞기"]].map(([id, label]) => ({ label, active:s.turns === id, action:() => api.setSettings({ turns:id }) })) },
      { label:"카드 수를 사람 수에 맞추기", icon:"check", active:s.count === "auto", action:() => api.setSettings({ count:s.count === "auto" ? plan.count : "auto" }) },
      { label:"카드 글 고치기…", icon:"pen", action:openWords }
    ]; },
    dispose(){ timers.forEach(clearTimeout); timers.clear(); if (api.isBusy()) api.setBusy(false); if (observer) observer.disconnect(); box.remove(); }
  };
  function openWords(){
    if (api.isBusy() || typeof tierModal !== "function") return;
    const s = settings(), form = make("div", "tier-form");
    form.innerHTML = '<label class="wide"><span>당첨 카드 글</span><input class="pc-win" maxlength="12"></label><label class="wide"><span>나머지 카드 글</span><input class="pc-lose" maxlength="12"></label>'
      + '<footer class="wide"><span></span><button type="button" class="pc-cancel">취소</button><button type="button" class="pc-save primary">확인</button></footer>';
    const ui = tierModal("카드 글 고치기", form); form.querySelector(".pc-win").value = s.winLabel; form.querySelector(".pc-lose").value = s.loseLabel;
    form.querySelector(".pc-cancel").onclick = ui.dispose;
    form.querySelector(".pc-save").onclick = () => { ui.dispose(); api.setSettings({ winLabel:form.querySelector(".pc-win").value, loseLabel:form.querySelector(".pc-lose").value }); };
  }
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.card = { mount:mountPickCard, normalize:pickCardNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_CARD_MAX, pickCardNormalize, pickCardPlan, pickCardDeal, pickCardGrid, pickCardNextTurn, mountPickCard };
}
