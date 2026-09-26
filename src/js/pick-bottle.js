"use strict";

/* ===== 복불복 — 병 돌리기 =====
   둥근 탁자 둘레에 참가자가 앉고(12시부터 시계 방향), 가운데 병이 돌다가 한 사람을 가리킨다.
   뽑을 사람을 먼저 정하고(pickRandomInt) 병목이 그 자리(± 자리 간격의 30%)를 가리키도록 멈출 각을 셈한다(pickBottleTarget).
   병 각도 0 = 병목이 12시, 시계 방향으로 늘어난다. 돌 때 가리키는 자리가 바뀔 때마다 '딱'. */
const PICK_BOTTLE_MAX = 24;
function pickBottleTarget(current, index, count, opts = {}){
  const s = 360 / count, offset = Math.max(-0.3, Math.min(0.3, Number(opts.offset) || 0)), turns = Math.max(0, Math.floor(opts.turns == null ? 4 : opts.turns));
  const want = ((((index + offset) * s) % 360) + 360) % 360, now = ((current % 360) + 360) % 360;
  return current + turns * 360 + ((want - now + 360) % 360);
}
/* 병목이 가장 가까이 가리키는 자리. */
function pickBottleIndexAt(deg, count){ if (!(count > 0)) return -1; const s = 360 / count, a = ((deg % 360) + 360) % 360; return Math.round(a / s) % count; }
const PICK_BOTTLE_SVG = '<svg class="pkt-bottle-svg" viewBox="0 0 70 220" aria-hidden="true"><defs><linearGradient id="pkt-glass" x1="0" x2="1"><stop offset="0" stop-color="#5fc795"/><stop offset=".45" stop-color="#a6ebc8"/><stop offset="1" stop-color="#4fb584"/></linearGradient></defs>'
  + '<path class="pkt-bottle-body" d="M26 8h18v8l-2 2v40c0 12 20 24 20 46v96c0 9-6 14-14 14H22c-8 0-14-5-14-14v-96c0-22 20-34 20-46V18l-2-2z" fill="url(#pkt-glass)"/>'
  + '<rect class="pkt-bottle-lip" x="23" y="4" width="24" height="12" rx="4"/><path class="pkt-bottle-shine" d="M20 118v80"/><path class="pkt-bottle-shine is-thin" d="M31 30v34"/>'
  + '<ellipse class="pkt-bottle-base" cx="35" cy="208" rx="22" ry="5"/></svg>';

function mountPickBottle(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-bottle"), table = make("div", "pkt-table"), wood = make("div", "pkt-wood"), bottle = make("div", "pkt-bottle"), banner = make("div", "pkt-banner"), notice = make("div", "pick-game-notice");
  bottle.innerHTML = PICK_BOTTLE_SVG; notice.hidden = true; banner.hidden = true;
  const swirl = make("div", "pkt-swirl"); swirl.setAttribute("aria-hidden", "true");
  swirl.innerHTML = '<svg viewBox="0 0 100 100"><path d="M30 64Q30 36 58 30"/><path class="pkt-swirl-head" d="M52 25l8 5-7 6"/></svg>';
  table.append(wood, swirl, bottle); box.append(table, banner, notice); api.arena.appendChild(box);
  let people = [], sig = null, angle = 0, frame = 0, spinning = false, chosen = -1;
  const setAngle = deg => { bottle.style.transform = `translate(-50%, -50%) rotate(${(deg % 360).toFixed(2)}deg)`; };

  function fit(){ const w = box.clientWidth, h = box.clientHeight - 70; if (!w || !h) return; const size = Math.max(240, Math.min(w - 10, h, 720)); table.style.width = table.style.height = size + "px"; table.style.setProperty("--pkt-size", size + "px"); }
  function renderSeats(){
    table.querySelectorAll(".pkt-seat").forEach(el => el.remove());
    const n = people.length; table.style.setProperty("--pkt-seat", (n <= 6 ? 18 : n <= 10 ? 14.5 : n <= 16 ? 11 : 8.6) + "%");
    people.forEach((person, i) => {
      const a = (i / n) * Math.PI * 2, seat = make("div", "pkt-seat"); seat.dataset.i = String(i);
      seat.style.left = (50 + 37 * Math.sin(a)) + "%"; seat.style.top = (50 - 37 * Math.cos(a)) + "%"; seat.style.setProperty("--pk-c", person.color);
      if (person.image){ const img = document.createElement("img"); img.src = person.image.dataUrl; img.alt = ""; seat.appendChild(img); }
      const name = make("span"); name.textContent = person.name || "사진"; seat.appendChild(name);
      if (i === chosen) seat.classList.add("is-chosen");
      table.appendChild(seat);
    });
  }
  function showBanner(person){
    banner.hidden = !person; banner.innerHTML = ""; if (!person) return;
    const text = make("strong"); text.textContent = `${person.name || "사진 참가자"} 당첨`; banner.append(make("i"), text, make("i"));
  }
  function finish(index){
    spinning = false; frame = 0; angle = ((angle % 360) + 360) % 360; setAngle(angle); box.classList.remove("is-spinning");
    chosen = index; renderSeats(); showBanner(people[index]); api.setBusy(false);
    api.showResult(people[index], { kicker:"병이 가리킨 사람", againLabel:"한 번 더 돌리기" });
  }
  function start(){
    if (spinning || people.length < 2) return;
    const n = people.length, index = pickRandomInt(n), offset = (pickCryptoRandom() - 0.5) * 0.5, m = api.motion();
    chosen = -1; renderSeats(); showBanner(null); spinning = true; api.setBusy(true);
    if (!m){ angle = pickBottleTarget(angle, index, n, { turns:0, offset }); finish(index); return; }
    const turns = 3 + pickRandomInt(3), from = angle, target = pickBottleTarget(angle, index, n, { turns, offset }), dur = (3600 + turns * 350) * m, t0 = performance.now();
    let last = pickBottleIndexAt(from, n); box.classList.add("is-spinning");
    const step = now => {
      const p = Math.min(1, (now - t0) / dur); angle = from + (target - from) * pickEaseOut(p); setAngle(angle);
      const at = pickBottleIndexAt(angle, n); if (at !== last){ last = at; api.sound("tick"); }
      if (p < 1){ frame = requestAnimationFrame(step); return; }
      angle = target; finish(index);
    };
    frame = requestAnimationFrame(step);
  }
  bottle.addEventListener("click", () => api.requestStart());
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(box);
  setAngle(angle); fit();
  return {
    render(){
      if (spinning) return;
      const list = api.active(), tooMany = list.length > PICK_BOTTLE_MAX;
      notice.hidden = !tooMany; table.hidden = tooMany; notice.textContent = tooMany ? `병 돌리기는 ${PICK_BOTTLE_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      const next = list.map(p => [p.id, p.name, p.color, p.image ? p.image.dataUrl.length : 0].join("\u0001")).join("\u0002");
      if (next !== sig){ sig = next; people = list; chosen = -1; showBanner(null); }
      renderSeats(); fit();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_BOTTLE_MAX; },
    blockReason:() => (api.active().length > PICK_BOTTLE_MAX ? `병 돌리기는 ${PICK_BOTTLE_MAX}명까지예요.` : ""),
    start,
    dispose(){ cancelAnimationFrame(frame); if (spinning) api.setBusy(false); spinning = false; if (observer) observer.disconnect(); box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.bottle = { mount:mountPickBottle, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_BOTTLE_MAX, pickBottleTarget, pickBottleIndexAt, mountPickBottle };
}
