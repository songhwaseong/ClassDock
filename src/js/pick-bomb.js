"use strict";

/* ===== 복불복 — 폭탄 돌리기 =====
   참가자가 둥글게 앉고 가운데 폭탄의 시계가 흐른다. 폭탄을 가진 사람은 '다음 사람에게'(Space)로 넘기고, 터지는 순간 폭탄을 가진 사람이 걸린다.
   터지는 시각은 시작할 때 [가장 짧게, 가장 길게] 사이에서 무작위로 정해 숨긴다(pickBombFuse). 시계는 흐른 시간을 보여 주고,
   '남은 시간 보이기'를 켜면 거꾸로 센다. 터질 때가 가까울수록 째깍 소리가 빨라진다. 진행 상태는 화면에만. */
const PICK_BOMB_MAX = 24;
function pickBombInt(value, min, max, fallback){ const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function pickBombNormalize(raw){
  const v = raw && typeof raw === "object" ? raw : {}, min = pickBombInt(v.min, 3, 120, 10), max = pickBombInt(v.max, 3, 180, 30);
  return { min:Math.min(min, max), max:Math.max(min, max), showLeft:v.showLeft === true, dir:v.dir === "ccw" ? "ccw" : "cw" };
}
function pickBombRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
function pickBombFuse(settings, random=pickBombRandom){ const s = pickBombNormalize(settings); return Math.round((s.min + (s.max - s.min) * random()) * 1000); }
function pickBombClock(ms){ const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
/* 째깍 간격 — 처음 1초, 터질 때가 가까우면 0.18초까지. */
function pickBombTickGap(elapsed, fuse){ const p = Math.max(0, Math.min(1, elapsed / Math.max(1, fuse))); return Math.round(1000 - 820 * p * p); }

function mountPickBomb(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-bomb"), tools = make("div", "pick-game-tools"), ring = make("div", "pick-bomb-ring"), notice = make("div", "pick-game-notice"), msg = make("div", "pick-bomb-msg");
  notice.hidden = true;
  const bomb = make("div", "pkb-bomb");
  bomb.innerHTML = '<svg class="pkb-body" viewBox="0 0 200 210" aria-hidden="true"><defs><radialGradient id="pkb-g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#c7b6ff"/><stop offset=".6" stop-color="#9a7cf2"/><stop offset="1" stop-color="#7a5ae0"/></radialGradient></defs>'
    + '<rect class="pkb-cap" x="80" y="24" width="40" height="26" rx="8"/><path class="pkb-fuse-star" d="M100 2l7 13 14 2-10 10 2 14-13-7-13 7 2-14-10-10 14-2z"/>'
    + '<circle cx="100" cy="122" r="84" fill="url(#pkb-g)"/><ellipse class="pkb-shine" cx="68" cy="84" rx="20" ry="12" transform="rotate(-30 68 84)"/>'
    + '<ellipse class="pkb-eye" cx="74" cy="92" rx="7" ry="9"/><ellipse class="pkb-eye" cx="126" cy="92" rx="7" ry="9"/><circle class="pkb-blush" cx="58" cy="108" r="8"/><circle class="pkb-blush" cx="142" cy="108" r="8"/>'
    + '<path class="pkb-mouth" d="M88 104q12 10 24 0"/></svg><span class="pkb-lcd">00:00</span><span class="pkb-boom" aria-hidden="true">펑!</span>';
  const arrows = make("div", "pkb-arrows"); arrows.setAttribute("aria-hidden", "true");
  ring.append(arrows, bomb);
  box.append(tools, ring, msg, notice); api.arena.appendChild(box);
  const lcd = bomb.querySelector(".pkb-lcd");
  let people = [], sig = null, running = false, holder = -1, fuse = 0, t0 = 0, frame = 0, nextTick = 0, lastLoser = null;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const settings = () => api.settings();

  function fit(){
    const w = ring.parentNode ? box.clientWidth : 0, h = box.clientHeight - 90; if (!w || !h) return;
    const size = Math.max(260, Math.min(w - 10, h, 760)); ring.style.width = ring.style.height = size + "px"; ring.style.setProperty("--pkb-size", size + "px");
  }
  function renderRing(){
    ring.querySelectorAll(".pkb-seat").forEach(el => el.remove());
    const n = people.length, radius = 40, cw = settings().dir !== "ccw";
    ring.style.setProperty("--pkb-seat", (n <= 6 ? 19 : n <= 10 ? 15 : n <= 16 ? 11.5 : 9) + "%");
    people.forEach((person, i) => {
      const a = (i / n) * Math.PI * 2 * (cw ? 1 : -1), seat = make("button", "pkb-seat"); seat.type = "button"; seat.dataset.i = String(i);
      seat.style.left = (50 + radius * Math.sin(a)) + "%"; seat.style.top = (50 - radius * Math.cos(a)) + "%"; seat.style.setProperty("--pk-c", person.color);
      const name = make("span", "pkb-name"); name.textContent = person.name || "사진";
      seat.append(typeof pickAvatar === "function" ? pickAvatar(person, "pkb-face") : make("span"), name);
      if (i === holder){ seat.classList.add("is-holder"); const tag = make("span", "pkb-tag"); tag.textContent = "폭탄 보유"; seat.appendChild(tag); }
      if (lastLoser && lastLoser.id === person.id && !running) seat.classList.add("is-loser");
      seat.title = running ? (i === holder ? "폭탄을 가진 사람" : `${person.name}에게 넘기기`) : person.name;
      ring.appendChild(seat);
    });
    // 넘기는 방향 화살표 — 이웃 자리 사이에 하나씩.
    arrows.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" class="pkb-track"/>${people.map((_, i) => { const a = ((i + 0.5) / n) * 360 * (cw ? 1 : -1); return `<path class="pkb-arrow" d="${cw ? "M48.4 8.6L51.8 10 48.4 11.4z" : "M51.6 8.6L48.2 10 51.6 11.4z"}" transform="rotate(${a.toFixed(1)} 50 50)"/>`; }).join("")}</svg>`;
  }
  function renderTools(){
    const s = settings(); tools.innerHTML = "";
    const chip = make("span", "pick-chip"); chip.textContent = `터지는 시간 ${s.min}~${s.max}초`; chip.title = "설정 → 폭탄 설정에서 바꿔요";
    const reset = make("button", "pick-chip-btn is-wide"); reset.type = "button"; reset.innerHTML = (typeof pickUiIcon === "function" ? pickUiIcon("refresh") : "") + "<span>다시 시작</span>";
    reset.onclick = () => { stop(); api.hideResult(); lastLoser = null; holder = -1; lcd.textContent = "00:00"; renderRing(); renderMsg(); api.refresh(); };
    tools.append(chip, reset);
  }
  function renderMsg(){ msg.textContent = running ? "다음 사람에게 넘겨주세요!" : lastLoser ? `${lastLoser.name || "사진 참가자"}에게서 터졌어요` : "'폭탄 시작'을 누르면 시계가 돌아가요"; }
  function stop(){ if (frame) cancelAnimationFrame(frame); frame = 0; if (running){ running = false; api.setBusy(false); } box.classList.remove("is-running", "is-hot"); }
  function pass(to){
    if (!running || people.length < 2) return;
    // 차례(+1)는 늘 명단 다음 사람 — 반대 방향이면 자리를 반대로 앉혔으니 화면에서도 화살표 방향이 된다.
    const next = to != null ? to : (holder + 1) % people.length; if (next === holder) return;
    holder = next; api.sound("pop"); renderRing();
    bomb.classList.remove("is-passed"); void bomb.offsetWidth; bomb.classList.add("is-passed");
  }
  function boom(){
    const loser = people[holder]; stop(); lastLoser = loser; box.classList.add("is-boom"); api.sound("boom");
    renderRing(); renderMsg(); api.refresh();
    later(900 * Math.max(0.4, api.motion() || 0.4), () => { box.classList.remove("is-boom"); api.showResult(loser, { kicker:"펑! 폭탄이 터졌어요", againLabel:"다시 시작" }); });
  }
  function begin(){
    if (people.length < 2) return;
    const s = settings(); fuse = pickBombFuse(s); holder = pickRandomInt(people.length); lastLoser = null;
    running = true; api.setBusy(true); box.classList.add("is-running"); renderRing(); renderMsg(); api.refresh();
    t0 = performance.now(); nextTick = 0;
    const step = now => {
      if (!running) return;
      const el = now - t0; lcd.textContent = s.showLeft ? pickBombClock(fuse - el + 999) : pickBombClock(el);
      box.classList.toggle("is-hot", el > fuse * 0.7);
      if (el >= nextTick){ api.sound("tick"); nextTick = el + pickBombTickGap(el, fuse); bomb.classList.remove("is-tick"); void bomb.offsetWidth; bomb.classList.add("is-tick"); }
      if (el >= fuse){ frame = 0; boom(); return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }
  ring.addEventListener("click", event => { const seat = event.target.closest(".pkb-seat"); if (seat && running) pass(Number(seat.dataset.i)); });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(box);
  fit();
  return {
    render(){
      if (running) return;
      const list = api.active(), tooMany = list.length > PICK_BOMB_MAX;
      notice.hidden = !tooMany; ring.hidden = tooMany; notice.textContent = tooMany ? `폭탄 돌리기는 ${PICK_BOMB_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      const next = list.map(p => [p.id, p.name, p.color, p.image ? p.image.dataUrl.length : 0].join("\u0001")).join("\u0002") + "\u0003" + JSON.stringify(settings());
      if (next !== sig){ sig = next; people = list; holder = -1; if (lastLoser && !list.includes(lastLoser)) lastLoser = null; }
      renderTools(); renderRing(); renderMsg(); fit();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_BOMB_MAX; },
    blockReason:() => (api.active().length > PICK_BOMB_MAX ? `폭탄 돌리기는 ${PICK_BOMB_MAX}명까지예요.` : ""),
    start:() => { if (running) pass(); else begin(); },
    goWhileBusy:() => running,
    goLabel:() => (running ? "다음 사람에게" : lastLoser ? "다시 시작" : ""),
    menuItems:() => { const s = settings(); return [
      { label:"터지는 시간", icon:"clock", children:[[5, 15], [10, 30], [20, 45], [30, 60], [45, 90]].map(([a, b]) => ({ label:`${a}~${b}초`, active:s.min === a && s.max === b, action:() => api.setSettings({ min:a, max:b }) })) },
      { label:"남은 시간 보이기", title:"끄면 흐른 시간만 보여요(더 두근두근)", icon:"check", active:s.showLeft, action:() => api.setSettings({ showLeft:!s.showLeft }) },
      { label:"앉는 방향", icon:"refresh", children:[["cw", "시계 방향"], ["ccw", "시계 반대 방향"]].map(([id, label]) => ({ label, active:s.dir === id, action:() => api.setSettings({ dir:id }) })) }
    ]; },
    dispose(){ stop(); timers.forEach(clearTimeout); timers.clear(); if (observer) observer.disconnect(); box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.bomb = { mount:mountPickBomb, normalize:pickBombNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_BOMB_MAX, pickBombNormalize, pickBombFuse, pickBombClock, pickBombTickGap, mountPickBomb };
}
