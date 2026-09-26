"use strict";

/* ===== 복불복 — 풍선 터뜨리기 =====
   참가자마다 자기 색 풍선이 하나씩 떠 있고, 그 안 몇 개에만 '당첨' 쪽지가 들어 있다(pickBalloonDeal — 풍선을 채울 때 정함).
   풍선을 누르면 부르르 떨다가 펑 터지며 쪽지가 보인다. 당첨 쪽지가 다 나오면 끝 — 남은 풍선도 흐리게 쪽지를 보여 준다.
   '풍선 다시 채우기'로 새 판. 진행 상태는 화면에만. */
const PICK_BALLOON_MAX = 24;
function pickBalloonInt(value, min, max, fallback){ const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function pickBalloonWord(value, max, fallback){ return String(value == null ? "" : value).trim().slice(0, max) || fallback; }
function pickBalloonNormalize(raw){
  const v = raw && typeof raw === "object" ? raw : {};
  return { winners:pickBalloonInt(v.winners, 1, PICK_BALLOON_MAX - 1, 1), winLabel:pickBalloonWord(v.winLabel, 12, "당첨"), loseLabel:pickBalloonWord(v.loseLabel, 12, "꽝") };
}
function pickBalloonDeal(count, winners, random=Math.random){
  const k = Math.max(1, Math.min(winners, count - 1)), deck = Array.from({ length:count }, (_, i) => i < k);
  for (let i = deck.length - 1; i > 0; i--){ const j = Math.min(i, Math.floor(random() * (i + 1))); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
function pickBalloonSvg(color){
  return '<svg class="pkb3-svg" viewBox="0 0 120 190" aria-hidden="true">'
    + `<path class="pkb3-string" d="M60 128q-10 14 0 28t-2 30"/><path class="pkb3-knot" d="M54 124h12l-3 9h-6z" style="fill:${color}"/>`
    + `<path class="pkb3-body" d="M60 4C28 4 8 30 8 60c0 34 28 60 52 66 24-6 52-32 52-66C112 30 92 4 60 4z" style="fill:${color}"/>`
    + '<path class="pkb3-shade" d="M60 4C28 4 8 30 8 60c0 34 28 60 52 66-18-10-38-34-38-64C22 34 36 12 60 4z"/>'
    + '<ellipse class="pkb3-shine" cx="36" cy="34" rx="10" ry="16" transform="rotate(30 36 34)"/>'
    + '<path class="pkb3-star" d="M60 44l5.6 11.4 12.6 1.8-9.1 8.9 2.1 12.5L60 72.7l-11.2 5.9 2.1-12.5-9.1-8.9 12.6-1.8z"/></svg>';
}

function mountPickBalloon(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-balloon"), tools = make("div", "pick-game-tools"), area = make("div", "pkb3-area"), grid = make("div", "pkb3-grid"), notice = make("div", "pick-game-notice");
  notice.hidden = true; area.appendChild(grid); box.append(tools, area, notice); api.arena.appendChild(box);
  let people = [], sig = null, items = [], found = [], phase = "playing", plan = 1;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const settings = () => api.settings();

  function deal(){ const s = settings(); plan = Math.max(1, Math.min(s.winners, people.length - 1)); const deck = pickBalloonDeal(people.length, plan, pickCryptoRandom); items = people.map((person, i) => ({ person, win:deck[i], popped:false, rest:false })); found = []; phase = "playing"; }
  function renderTools(){
    const s = settings(); tools.innerHTML = "";
    const chip = make("span", "pick-chip"), minus = make("button", "pick-chip-btn"), plus = make("button", "pick-chip-btn"), b = make("b");
    minus.type = plus.type = "button"; minus.textContent = "−"; plus.textContent = "+"; b.textContent = String(plan);
    minus.disabled = plan <= 1; plus.disabled = plan >= Math.max(1, people.length - 1);
    minus.onclick = () => { if (!api.isBusy()) api.setSettings({ winners:plan - 1 }); }; plus.onclick = () => { if (!api.isBusy()) api.setSettings({ winners:plan + 1 }); };
    chip.append(document.createTextNode(s.winLabel + " "), minus, b, plus, document.createTextNode("개"));
    const status = make("span", "pick-chip"); status.textContent = `찾음 ${found.length}/${plan}`;
    const all = make("button", "pick-chip-btn is-wide"); all.type = "button"; all.textContent = "모두 터뜨리기"; all.disabled = phase !== "playing"; all.onclick = popAll;
    tools.append(chip, status, all);
  }
  function itemEl(item, i){
    const s = settings(), el = make("button", "pkb3-item"); el.type = "button"; el.dataset.i = String(i); el.style.setProperty("--pk-c", item.person.color); el.style.setProperty("--pkb3-d", ((i * 0.37) % 2).toFixed(2) + "s");
    el.innerHTML = pickBalloonSvg(item.person.color)
      + '<span class="pkb3-burst" aria-hidden="true"><i class="p1"></i><i class="p2"></i><i class="p3"></i><i class="p4"></i><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i><i class="c5"></i><i class="c6"></i></span>';
    const ticket = make("span", "pkb3-ticket" + (item.win ? " is-win" : "")); ticket.textContent = item.win ? s.winLabel : s.loseLabel;
    const name = make("span", "pkb3-name"); name.textContent = item.person.name || "사진";
    el.append(ticket, name);
    if (item.popped) el.classList.add("is-popped"); if (item.rest) el.classList.add("is-rest");
    el.disabled = item.popped || phase !== "playing"; el.setAttribute("aria-label", item.popped ? `${item.person.name} 풍선 — ${item.win ? s.winLabel : s.loseLabel}` : `${item.person.name} 풍선 터뜨리기`);
    return el;
  }
  function draw(){ grid.innerHTML = ""; items.forEach((item, i) => grid.appendChild(itemEl(item, i))); fit(); }
  function fit(){
    const w = area.clientWidth, h = area.clientHeight, n = items.length; if (!w || !h || !n) return;
    let best = { cols:1, cw:0 }; const gap = 18;
    for (let cols = 1; cols <= n; cols++){ const rows = Math.ceil(n / cols), cw = Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * 0.62, 200); if (cw > best.cw) best = { cols, cw }; }
    grid.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(best.cw)}px)`; grid.style.setProperty("--pkb3-w", Math.floor(best.cw) + "px");
  }
  function pop(i, quiet){
    const item = items[i]; if (!item || item.popped || phase !== "playing") return;
    if (!quiet && api.isBusy()) return;
    const m = api.motion(), el = grid.querySelector(`.pkb3-item[data-i="${i}"]`);
    api.hideResult(); item.popped = true; if (!quiet) api.setBusy(true);
    if (el){ el.disabled = true; el.classList.add("is-wobble"); }
    later(m ? 380 * m : 0, () => {
      if (el){ el.classList.remove("is-wobble"); el.classList.add("is-popped"); }
      api.sound("pop"); if (item.win){ found.push(item.person); api.sound("tick"); }
      renderTools();
      if (found.length >= plan){
        phase = "done"; items.forEach(it => { if (!it.popped){ it.rest = true; } }); if (!quiet) api.setBusy(false);
        later(m ? 450 * m : 0, () => { draw(); renderTools(); api.showResult(found.slice(), { kicker:found.length > 1 ? `${settings().winLabel} ${found.length}명` : `${settings().winLabel}!`, againLabel:"풍선 다시 채우기" }); });
        return;
      }
      if (!quiet) api.setBusy(false);
    });
  }
  function popAll(){
    if (phase !== "playing" || api.isBusy()) return;
    const left = items.map((it, i) => (it.popped ? -1 : i)).filter(i => i >= 0); let k = 0;
    const next = () => { if (phase !== "playing" || k >= left.length) return; pop(left[k++], true); later(240 * Math.max(0.2, api.motion() || 0.2), next); };
    next();
  }
  grid.addEventListener("click", event => { const el = event.target.closest(".pkb3-item"); if (el) pop(Number(el.dataset.i)); });
  function start(){
    if (api.isBusy() || people.length < 2) return;
    const m = api.motion(); deal(); renderTools(); draw(); api.sound("roll");
    if (m){ grid.classList.remove("is-filling"); void grid.offsetWidth; grid.classList.add("is-filling"); }
  }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(area);
  return {
    render(){
      if (api.isBusy()) return;
      const list = api.active(), tooMany = list.length > PICK_BALLOON_MAX;
      notice.hidden = !tooMany; area.hidden = tooMany; notice.textContent = tooMany ? `풍선 터뜨리기는 ${PICK_BALLOON_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      const next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002") + "\u0003" + JSON.stringify(settings());
      if (next !== sig){ sig = next; people = list; deal(); draw(); }
      renderTools();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_BALLOON_MAX; },
    blockReason:() => (api.active().length > PICK_BALLOON_MAX ? `풍선 터뜨리기는 ${PICK_BALLOON_MAX}명까지예요.` : ""),
    start,
    menuItems:() => [{ label:"모두 터뜨리기", icon:"check", disabled:phase !== "playing", action:popAll }, { label:"쪽지 글 고치기…", icon:"pen", action:openWords }],
    dispose(){ timers.forEach(clearTimeout); timers.clear(); if (api.isBusy()) api.setBusy(false); if (observer) observer.disconnect(); box.remove(); }
  };
  function openWords(){
    if (api.isBusy() || typeof tierModal !== "function") return;
    const s = settings(), form = make("div", "tier-form");
    form.innerHTML = '<label class="wide"><span>당첨 쪽지 글</span><input class="pb-win" maxlength="12"></label><label class="wide"><span>나머지 쪽지 글</span><input class="pb-lose" maxlength="12"></label>'
      + '<footer class="wide"><span></span><button type="button" class="pb-cancel">취소</button><button type="button" class="pb-save primary">확인</button></footer>';
    const ui = tierModal("풍선 쪽지 글", form); form.querySelector(".pb-win").value = s.winLabel; form.querySelector(".pb-lose").value = s.loseLabel;
    form.querySelector(".pb-cancel").onclick = ui.dispose;
    form.querySelector(".pb-save").onclick = () => { ui.dispose(); api.setSettings({ winLabel:form.querySelector(".pb-win").value, loseLabel:form.querySelector(".pb-lose").value }); };
  }
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.balloon = { mount:mountPickBalloon, normalize:pickBalloonNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_BALLOON_MAX, pickBalloonNormalize, pickBalloonDeal, pickBalloonSvg, mountPickBalloon };
}
