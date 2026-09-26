"use strict";

/* ===== 복불복 — 보물상자 고르기 =====
   번호 붙은 상자 가운데 보물(당첨) k 개가 숨어 있고, 명단 차례대로 한 사람씩 상자를 연다. 보물이 다 나오면 끝.
   규칙·장수 셈은 카드 뽑기와 같다(pickCardPlan·pickCardDeal·pickCardNextTurn·pickCardGrid 공용) — 보물 자리는 나눌 때 정해져 누구나 확률이 같다.
   상자를 누르면 잠깐 달그락 흔들린 뒤 뚜껑이 열린다. 진행 상태는 화면에만. */
const PICK_TREASURE_CHEST = '<svg class="pkx-chest" viewBox="0 0 120 104" aria-hidden="true">'
  + '<g class="pkx-glow"><circle cx="60" cy="40" r="34"/><path d="M60 2v10M28 14l6 8M92 14l-6 8M16 38h10M94 38h10"/></g>'
  + '<path class="pkx-star-big" d="M60 18l6 12 13 2-9.5 9 2.2 13L60 48l-11.7 6.2 2.2-13-9.5-9 13-2z"/>'
  + '<rect class="pkx-inside" x="14" y="44" width="92" height="16" rx="3"/>'
  + '<g class="pkx-body"><rect x="10" y="50" width="100" height="50" rx="8"/><path class="pkx-slat" d="M14 64h92M14 78h92"/><rect class="pkx-band" x="10" y="50" width="12" height="50" rx="4"/><rect class="pkx-band" x="98" y="50" width="12" height="50" rx="4"/><rect class="pkx-band" x="10" y="90" width="100" height="10" rx="4"/></g>'
  + '<g class="pkx-lid"><path d="M10 52V34q0-22 50-22t50 22v18z"/><path class="pkx-slat" d="M14 30q46-14 92 0"/><rect class="pkx-band" x="10" y="44" width="100" height="10" rx="4"/><path class="pkx-band" d="M10 52V34q0-14 12-18v36zM110 52V34q0-14-12-18v36z"/></g>'
  + '<path class="pkx-lock" d="M60 42l4.7 9.6 10.5 1.5-7.6 7.4 1.8 10.4L60 66l-9.4 4.9 1.8-10.4-7.6-7.4 10.5-1.5z"/></svg>';

function mountPickTreasure(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-treasure"), tools = make("div", "pick-game-tools"), turnBar = make("div", "pick-card-turn"), area = make("div", "pkx-area"), grid = make("div", "pkx-grid");
  area.appendChild(grid); box.append(tools, turnBar, area); api.arena.appendChild(box);
  let chests = [], order = [], turn = 0, found = [], phase = "playing", sig = null, plan = { count:2, winners:1 }, els = [];
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const settings = () => api.settings();

  function deal(){
    const people = api.active(), s = settings(); plan = pickCardPlan(s, people.length);
    chests = pickCardDeal(plan.count, plan.winners).map(win => ({ win, open:false, by:null, revealed:false }));
    order = s.turns === "random" && typeof pickShuffle === "function" ? pickShuffle(people) : people.slice(); turn = 0; found = []; phase = "playing";
  }
  function renderTools(){
    const s = settings(), people = api.active().length; tools.innerHTML = "";
    const chip = (label, value, min, max, onSet, suffix) => {
      const el = make("span", "pick-chip"), minus = make("button", "pick-chip-btn"), plus = make("button", "pick-chip-btn"), b = make("b");
      minus.type = plus.type = "button"; minus.textContent = "−"; plus.textContent = "+"; b.textContent = String(value);
      minus.disabled = value <= min; plus.disabled = value >= max; minus.onclick = () => { if (!api.isBusy()) onSet(value - 1); }; plus.onclick = () => { if (!api.isBusy()) onSet(value + 1); };
      el.append(document.createTextNode(label + " "), minus, b, plus, document.createTextNode(suffix)); return el;
    };
    tools.appendChild(chip("보물", plan.winners, 1, Math.max(1, Math.min(plan.count - 1, people)), value => api.setSettings({ winners:value }), "개"));
    tools.appendChild(chip("상자", plan.count, 2, 30, value => api.setSettings({ count:value }), "개"));
    if (s.count !== "auto"){ const auto = make("button", "pick-chip-btn is-wide"); auto.type = "button"; auto.textContent = "사람 수에 맞추기"; auto.onclick = () => { if (!api.isBusy()) api.setSettings({ count:"auto" }); }; tools.appendChild(auto); }
  }
  function renderTurn(){
    turnBar.innerHTML = ""; const status = make("span", "pick-card-status"); status.textContent = `보물 ${found.length}/${plan.winners}`;
    if (phase === "done"){ const t = make("strong"); t.textContent = "보물을 모두 찾았어요!"; turnBar.append(t, status); return; }
    const person = order[turn]; if (!person){ turnBar.append(status); return; }
    const who = make("span", "pick-card-who"), name = make("strong"); name.textContent = `${person.name || "사진 참가자"} 차례`;
    who.append(typeof pickAvatar === "function" ? pickAvatar(person) : make("span"), name);
    const hint = make("span", "pick-card-hint"); hint.textContent = "상자를 하나 골라보세요";
    turnBar.append(who, hint, status);
  }
  function drawGrid(){
    grid.innerHTML = ""; els = []; const s = settings();
    chests.forEach((chest, i) => {
      const el = make("button", "pkx-item"); el.type = "button"; el.dataset.i = String(i); el.innerHTML = PICK_TREASURE_CHEST;
      const tag = make("span", "pkx-tag"); el.appendChild(tag);
      if (chest.open || chest.revealed){ el.classList.add("is-open"); if (chest.win) el.classList.add("is-win"); if (chest.revealed) el.classList.add("is-rest"); }
      tag.textContent = chest.open ? (chest.win ? s.winLabel : (chest.by ? chest.by.name || "사진" : s.loseLabel)) : chest.revealed ? (chest.win ? s.winLabel : "") : String(i + 1);
      if (chest.open && chest.win) tag.classList.add("is-win");
      el.disabled = chest.open || chest.revealed || phase !== "playing";
      el.setAttribute("aria-label", chest.open ? `${i + 1}번 상자 — ${chest.win ? s.winLabel : s.loseLabel}` : `${i + 1}번 상자 열기`);
      grid.appendChild(el); els.push(el);
    });
    fit();
  }
  function fit(){
    const w = area.clientWidth, h = area.clientHeight; if (!w || !h || !chests.length) return;
    const g = typeof pickCardGrid === "function" ? pickCardGrid(chests.length, w - 8, h - 8, Math.max(10, Math.min(30, w / 30)), 0.95, 250) : { cols:3, cw:160 };
    grid.style.gridTemplateColumns = `repeat(${g.cols}, ${g.cw}px)`; grid.style.setProperty("--pkx-w", g.cw + "px");
  }
  function open(i){
    const chest = chests[i]; if (!chest || chest.open || phase !== "playing" || api.isBusy()) return;
    const person = order[turn]; if (!person) return;
    api.hideResult(); chest.open = true; chest.by = person; const el = els[i], m = api.motion();
    api.setBusy(true); if (el){ el.disabled = true; el.classList.add("is-shaking"); } api.sound("roll");
    later(m ? 420 * m : 0, () => {
      if (el){ el.classList.remove("is-shaking"); el.classList.add("is-open"); if (chest.win) el.classList.add("is-win"); const tag = el.querySelector(".pkx-tag"); tag.textContent = chest.win ? settings().winLabel : (person.name || "사진"); tag.classList.toggle("is-win", chest.win); }
      api.sound(chest.win ? "tick" : "pop"); if (chest.win) found.push(person);
      later(m ? 520 * m : 0, () => {
        if (found.length >= plan.winners){
          phase = "done"; chests.forEach(c => { if (!c.open) c.revealed = true; }); api.setBusy(false); drawGrid(); renderTurn();
          api.showResult(found.slice(), { kicker:found.length > 1 ? `보물을 찾은 ${found.length}명` : "보물을 찾았어요!", againLabel:"다시 섞기" }); return;
        }
        const next = typeof pickCardNextTurn === "function" ? pickCardNextTurn(order, turn, new Set(found.map(p => p.id))) : (turn + 1) % order.length;
        if (next < 0){ phase = "done"; api.setBusy(false); drawGrid(); renderTurn(); return; }
        turn = next; api.setBusy(false); renderTurn();
      });
    });
  }
  grid.addEventListener("click", event => { const el = event.target.closest(".pkx-item"); if (el) open(Number(el.dataset.i)); });
  function start(){
    if (api.isBusy() || api.active().length < 2) return;
    const m = api.motion();
    if (!m){ deal(); renderTools(); renderTurn(); drawGrid(); return; }
    api.setBusy(true); grid.classList.add("is-shuffling"); api.sound("roll");
    later(420 * m, () => { deal(); renderTools(); renderTurn(); drawGrid(); grid.classList.remove("is-shuffling"); api.setBusy(false); });
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
      { label:"상자 수를 사람 수에 맞추기", icon:"check", active:s.count === "auto", action:() => api.setSettings({ count:s.count === "auto" ? plan.count : "auto" }) }
    ]; },
    dispose(){ timers.forEach(clearTimeout); timers.clear(); if (api.isBusy()) api.setBusy(false); if (observer) observer.disconnect(); box.remove(); }
  };
}
/* 설정은 카드 뽑기와 같은 모양(상자 수·보물 수·글·차례) — 상자는 30개까지. */
function pickTreasureNormalize(raw){
  const out = typeof pickCardNormalize === "function" ? pickCardNormalize(raw) : { count:"auto", winners:1, winLabel:"당첨", loseLabel:"통과", turns:"list" };
  if (out.count !== "auto") out.count = Math.min(30, out.count);
  return out;
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.treasure = { mount:mountPickTreasure, normalize:pickTreasureNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_TREASURE_CHEST, pickTreasureNormalize, mountPickTreasure };
}
