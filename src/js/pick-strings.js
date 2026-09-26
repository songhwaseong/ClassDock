"use strict";

/* ===== 복불복 — 끈 뽑기 =====
   상자에 번호 붙은 끈이 여러 개 매달려 있고, 그 가운데 당첨 끈 k 개는 상자 위 선물 창과 이어져 있다.
   명단 차례대로 한 사람씩 끈을 당기면 — 당첨이면 위 창이 열리며 별이, 아니면 끈이 제자리로 돌아간다. 당첨 끈이 다 나오면 끝.
   규칙·장수 셈은 카드 뽑기와 같다(pickCardPlan·pickCardDeal·pickCardNextTurn 공용). 끈은 16개까지. 진행 상태는 화면에만. */
const PICK_STRINGS_MAX = 16;
const PICK_STRINGS_COLORS = ["#f7877a", "#6fd3a8", "#b69cf7", "#fbcf5a", "#7aa7f7", "#f79a86", "#9ad86f", "#f59ac4"];
const PICK_STRINGS_ICONS = [
  '<circle cx="0" cy="-6" r="5"/><circle cx="6" cy="-1" r="5"/><circle cx="3.5" cy="6" r="5"/><circle cx="-3.5" cy="6" r="5"/><circle cx="-6" cy="-1" r="5"/><circle cx="0" cy="1.5" r="3.4" class="pks3-icon-hole"/>',
  '<path d="M-8 8C-8-4 0-9 9-9 9 2 3 9-8 8zM-8 8L3-2"/>',
  '<path d="M0 9S-10 3-10-3a5.3 5.3 0 0 1 10-2.4A5.3 5.3 0 0 1 10-3C10 3 0 9 0 9z"/>',
  '<path d="M-7 7a5 5 0 0 1-.6-10 7 7 0 0 1 13.4 1.8A4.4 4.4 0 0 1 6 7z"/>',
  '<path d="M0 0l-9-6v12zM0 0l9-6v12zM0 0l-5 10M0 0l5 10"/>',
  '<path d="M0-10l3 6.2 6.7 1-4.9 4.7 1.2 6.7L0 5.4l-6 3.2 1.2-6.7-4.9-4.7 6.7-1z"/>'
];
function pickStringsNormalize(raw){
  const v = raw && typeof raw === "object" ? raw : {}, num = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
  const word = (value, fallback) => String(value == null ? "" : value).trim().slice(0, 12) || fallback;
  return { count:v.count === "auto" || v.count == null || v.count === "" ? "auto" : num(v.count, 2, PICK_STRINGS_MAX, "auto"), winners:num(v.winners, 1, PICK_STRINGS_MAX - 1, 1),
    winLabel:word(v.winLabel, "당첨"), loseLabel:word(v.loseLabel, "꽝"), turns:v.turns === "random" ? "random" : "list" };
}
function pickStringsEscape(text){ return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]); }
/* 끈 자리 — 상자 폭 W 안에 고르게. */
function pickStringsXs(count, W){ const inner = W - 120; return Array.from({ length:count }, (_, i) => 60 + (i + 0.5) * inner / count); }

function mountPickStrings(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-strings"), tools = make("div", "pick-game-tools"), turnBar = make("div", "pick-card-turn"), stageEl = make("div", "pks3-stage");
  box.append(tools, turnBar, stageEl); api.arena.appendChild(box);
  let lastPulled = -1, items = [], order = [], turn = 0, found = [], phase = "playing", sig = null, plan = { count:2, winners:1 }, W = 760;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const settings = () => api.settings();

  function deal(){
    const people = api.active(), s = settings(); plan = pickCardPlan({ ...s, count:s.count === "auto" ? Math.min(PICK_STRINGS_MAX, Math.max(2, people.length)) : s.count }, people.length);
    items = pickCardDeal(plan.count, plan.winners).map(win => ({ win, pulled:false, by:null, revealed:false }));
    order = s.turns === "random" && typeof pickShuffle === "function" ? pickShuffle(people) : people.slice(); turn = 0; found = []; phase = "playing"; lastPulled = -1;
  }
  function renderTools(){
    const s = settings(), people = api.active().length; tools.innerHTML = "";
    const chip = (label, value, min, max, onSet, suffix) => {
      const el = make("span", "pick-chip"), minus = make("button", "pick-chip-btn"), plus = make("button", "pick-chip-btn"), b = make("b");
      minus.type = plus.type = "button"; minus.textContent = "−"; plus.textContent = "+"; b.textContent = String(value);
      minus.disabled = value <= min; plus.disabled = value >= max; minus.onclick = () => { if (!api.isBusy()) onSet(value - 1); }; plus.onclick = () => { if (!api.isBusy()) onSet(value + 1); };
      el.append(document.createTextNode(label + " "), minus, b, plus, document.createTextNode(suffix)); return el;
    };
    tools.appendChild(chip(s.winLabel, plan.winners, 1, Math.max(1, Math.min(plan.count - 1, people)), value => api.setSettings({ winners:value }), "개"));
    tools.appendChild(chip("끈", plan.count, 2, PICK_STRINGS_MAX, value => api.setSettings({ count:value }), "개"));
  }
  function renderTurn(){
    turnBar.innerHTML = ""; const status = make("span", "pick-card-status"); status.textContent = `${settings().winLabel} ${found.length}/${plan.winners}`;
    if (phase === "done"){ const t = make("strong"); t.textContent = "당첨 끈을 모두 찾았어요!"; turnBar.append(t, status); return; }
    const person = order[turn]; if (!person){ turnBar.append(status); return; }
    const who = make("span", "pick-card-who"), name = make("strong"); name.textContent = `${person.name || "사진 참가자"} 차례`;
    who.append(typeof pickAvatar === "function" ? pickAvatar(person) : make("span"), name);
    const hint = make("span", "pick-card-hint"); hint.textContent = "끈을 하나 당겨보세요";
    turnBar.append(who, hint, status);
  }
  function draw(){
    const n = items.length, s = settings(); W = Math.max(640, n * 96 + 120); const xs = pickStringsXs(n, W);
    let scallops = ""; const sc = Math.max(8, Math.round((W - 40) / 90)); for (let i = 0; i < sc; i++){ const x0 = 20 + i * (W - 40) / sc, w = (W - 40) / sc; scallops += `<path class="${i % 2 ? "pks3-awn-w" : "pks3-awn"}" d="M${x0.toFixed(1)} 118h${w.toFixed(1)}v18a${(w / 2).toFixed(1)} ${(w / 2.6).toFixed(1)} 0 0 1-${w.toFixed(1)} 0z"/>`; }
    const strings = items.map((item, i) => {
      const color = PICK_STRINGS_COLORS[i % PICK_STRINGS_COLORS.length], icon = PICK_STRINGS_ICONS[i % PICK_STRINGS_ICONS.length];
      const cls = "pks3-string" + (item.pulled ? " is-pulled" : "") + (item.pulled && item.win ? " is-win" : "") + (item.revealed ? " is-rest" : "") + (i === lastPulled ? " is-new" : "");
      // 당첨 끈은 위 선물 창이 알려 주니 아래 글은 꽝 끈(당긴 사람 이름)에만.
      const label = item.pulled && !item.win ? (item.by ? item.by.name || "사진" : s.loseLabel) : "";
      return `<g transform="translate(${xs[i].toFixed(1)} 0)"><circle class="pks3-num" cy="198" r="19"/><text class="pks3-num-text" y="199">${i + 1}</text><ellipse class="pks3-hole" cy="250" rx="22" ry="16"/>`
        + `<g class="${cls}" data-i="${i}" role="button" tabindex="0" aria-label="${i + 1}번 끈 당기기"><rect class="pks3-cord" x="-9" y="250" width="18" height="110" rx="9" style="fill:${color}"/>`
        + `<circle class="pks3-knob" cy="372" r="30" style="fill:${color}"/><g class="pks3-icon" transform="translate(0 372) scale(1.25)">${icon}</g></g>`
        + (label ? `<text class="pks3-label" y="436">${pickStringsEscape(label)}</text>` : "") + "</g>";
    }).join("");
    const prizes = items.map((item, i) => (item.pulled && item.win ? `<g transform="translate(${xs[i].toFixed(1)} 118)"><g class="pks3-prize${i === lastPulled ? " is-new" : ""}"><rect x="-50" y="-96" width="100" height="96" rx="16"/><rect class="pks3-prize-in" x="-38" y="-62" width="76" height="56" rx="8"/><path class="pks3-prize-star" d="M0-58l6 12.5 13.5 2-9.8 9.4 2.3 13.4L0-27l-12 6.3 2.3-13.4-9.8-9.4 13.5-2z"/><text class="pks3-prize-text" y="-74">${pickStringsEscape(s.winLabel)}</text></g></g>` : "")).join("");
    stageEl.innerHTML = `<svg class="pks3-svg" viewBox="0 0 ${W} 520" role="img" aria-label="끈 뽑기 상자">`
      + `<ellipse class="pks3-shadow" cx="${W / 2}" cy="486" rx="${W / 2 - 30}" ry="14"/>`
      + `<rect class="pks3-foot" x="60" y="440" width="70" height="30" rx="12"/><rect class="pks3-foot" x="${W - 130}" y="440" width="70" height="30" rx="12"/>`
      + prizes
      + `<rect class="pks3-box" x="30" y="118" width="${W - 60}" height="332" rx="30"/><rect class="pks3-top" x="20" y="100" width="${W - 40}" height="30" rx="14"/>${scallops}`
      + `<g class="pks3-bow" transform="translate(${W - 150} 92)"><path d="M0 0c-30-26-50-8-40 10 6 12 26 8 40-10zM0 0c30-26 50-8 40 10-6 12-26 8-40-10z"/><circle r="10"/></g>`
      + strings + "</svg>";
  }
  function pull(i){
    const item = items[i]; if (!item || item.pulled || phase !== "playing" || api.isBusy()) return;
    const person = order[turn]; if (!person) return;
    api.hideResult(); item.pulled = true; item.by = person; lastPulled = i; const m = api.motion();
    api.setBusy(true); api.sound("roll");
    const el = stageEl.querySelector(`.pks3-string[data-i="${i}"]`); if (el) el.classList.add("is-pulling");
    later(m ? 520 * m : 0, () => {
      draw(); api.sound(item.win ? "tick" : "pop"); if (item.win) found.push(person);
      later(m ? 550 * m : 0, () => {
        if (found.length >= plan.winners){
          phase = "done"; items.forEach(it => { if (!it.pulled) it.revealed = true; }); api.setBusy(false); draw(); renderTurn();
          api.showResult(found.slice(), { kicker:found.length > 1 ? `당첨 끈 ${found.length}개` : "당첨 끈!", againLabel:"다시 준비" }); return;
        }
        const next = typeof pickCardNextTurn === "function" ? pickCardNextTurn(order, turn, new Set(found.map(p => p.id))) : (turn + 1) % order.length;
        if (next < 0){ phase = "done"; api.setBusy(false); draw(); renderTurn(); return; }
        turn = next; api.setBusy(false); renderTurn();
      });
    });
  }
  stageEl.addEventListener("click", event => { const el = event.target.closest(".pks3-string"); if (el) pull(Number(el.dataset.i)); });
  stageEl.addEventListener("keydown", event => { const el = event.target.closest && event.target.closest(".pks3-string"); if (el && (event.key === "Enter" || event.key === " ")){ event.preventDefault(); event.stopPropagation(); pull(Number(el.dataset.i)); } });
  return {
    render(){
      if (api.isBusy()) return;
      const list = api.active(), next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002") + "\u0003" + JSON.stringify(settings());
      if (next !== sig){ sig = next; deal(); }
      renderTools(); renderTurn(); draw();
    },
    canStart:() => api.active().length >= 2,
    start(){ if (api.isBusy()) return; api.hideResult(); deal(); renderTools(); renderTurn(); draw(); api.sound("pop"); },
    menuItems:() => { const s = settings(); return [
      { label:"차례", icon:"list", children:[["list", "명단 차례대로"], ["random", "차례 섞기"]].map(([id, label]) => ({ label, active:s.turns === id, action:() => api.setSettings({ turns:id }) })) },
      { label:"끈 수를 사람 수에 맞추기", icon:"check", active:s.count === "auto", action:() => api.setSettings({ count:s.count === "auto" ? plan.count : "auto" }) }
    ]; },
    dispose(){ timers.forEach(clearTimeout); timers.clear(); if (api.isBusy()) api.setBusy(false); box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.strings = { mount:mountPickStrings, normalize:pickStringsNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_STRINGS_MAX, pickStringsNormalize, pickStringsXs, mountPickStrings };
}
