"use strict";

/* ===== 복불복 — 캡슐 뽑기 =====
   유리 통 안에 참가자 색 캡슐이 들어 있고, 손잡이를 돌리면 통이 흔들린 뒤 캡슐 하나가 나오는 구멍으로 떨어진다.
   옆 '결과' 칸에서 캡슐이 열리며 쪽지에 이름이 보인다. 뽑을 사람은 먼저 정한다(pickRandomInt) — 흔들림·배치는 보여 주기만.
   캡슐은 40개까지만 그린다(사람이 더 많아도 뽑기는 명단 전체에서). */
const PICK_CAPSULE_SHOW = 40;
const PICK_CAPSULE_DOME = { cx:200, cy:232, r:164 };
function pickCapsuleSvg(x, y, r, color, rot){
  const f = n => Math.round(n * 10) / 10;
  return `<g class="pkc-cap" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})"><circle class="pkc-cap-top" r="${f(r)}"/>`
    + `<path d="M${f(-r)} 0A${f(r)} ${f(r)} 0 0 0 ${f(r)} 0Z" style="fill:${color}"/><rect class="pkc-cap-band" x="${f(-r)}" y="-1.3" width="${f(r * 2)}" height="2.6"/>`
    + `<ellipse class="pkc-cap-shine" cx="${f(-r * 0.36)}" cy="${f(-r * 0.46)}" rx="${f(r * 0.3)}" ry="${f(r * 0.16)}"/></g>`;
}
/* 통 안 캡슐 — 사람 목록 앞 40명을 섞어서 바닥부터 쌓는다. */
function pickCapsuleBalls(people, random=Math.random){
  const shown = people.slice(0, PICK_CAPSULE_SHOW), pack = pickPackCircleSafe(shown.length, PICK_CAPSULE_DOME.r - 8, random);
  const order = shown.map((_, i) => i); for (let i = order.length - 1; i > 0; i--){ const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order.map((who, k) => ({ person:shown[who], x:PICK_CAPSULE_DOME.cx + pack.pts[k][0], y:PICK_CAPSULE_DOME.cy + pack.pts[k][1], r:pack.r * 0.97, rot:(random() - 0.5) * 70 }));
}
function pickPackCircleSafe(n, R, random){ return typeof pickPackCircle === "function" ? pickPackCircle(n, R, random) : { r:R / 4, pts:Array.from({ length:n }, () => [0, 0]) }; }
let _pickCapsuleSeq = 0;

function mountPickCapsule(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const uid = "pkc" + (++_pickCapsuleSeq), D = PICK_CAPSULE_DOME;
  const box = make("div", "pick-capsule"), machine = make("div", "pick-capsule-machine"), panel = make("div", "pick-capsule-result");
  panel.innerHTML = '<span class="pkc-result-title">결과</span><div class="pkc-open is-empty"><span class="pkc-half is-top"></span><span class="pkc-paper"><b></b><small></small></span><span class="pkc-half is-bottom"></span><span class="pkc-q">?</span></div>'
    + '<span class="pkc-spark s1"></span><span class="pkc-spark s2"></span><span class="pkc-spark s3"></span>';
  machine.innerHTML = `<svg class="pick-capsule-svg" viewBox="0 0 400 600" role="img" aria-label="캡슐 뽑기 기계"><defs><clipPath id="${uid}-dome"><circle cx="${D.cx}" cy="${D.cy}" r="${D.r - 4}"/></clipPath>`
    + `<radialGradient id="${uid}-glass" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".55" stop-color="#ffffff" stop-opacity=".08"/><stop offset="1" stop-color="#c9c2ee" stop-opacity=".35"/></radialGradient></defs>`
    + '<ellipse class="pkc-shadow" cx="200" cy="584" rx="176" ry="12"/>'
    + '<path class="pkc-base" d="M84 370Q84 352 102 352H298Q316 352 316 370L334 542H66Z"/><rect class="pkc-foot" x="48" y="530" width="304" height="44" rx="20"/>'
    + '<rect class="pkc-chute" x="138" y="480" width="124" height="56" rx="14"/><rect class="pkc-chute-lip" x="130" y="528" width="140" height="12" rx="6"/>'
    + '<path class="pkc-star" d="M200 372l7 14 15 2-11 11 3 15-14-7-14 7 3-15-11-11 15-2z"/>'
    + '<path class="pkc-arrow" d="M152 452q-4-30 18-48"/><path class="pkc-arrow" d="M248 452q4-30-18-48"/><path class="pkc-arrow-head" d="M164 400l8 4-4 8"/><path class="pkc-arrow-head" d="M236 400l-8 4 4 8"/>'
    + '<g class="pkc-knob"><circle cx="200" cy="442" r="38"/><rect x="192" y="410" width="16" height="64" rx="8"/></g>'
    + `<circle class="pkc-glass-back" cx="${D.cx}" cy="${D.cy}" r="${D.r}"/>`
    + `<g clip-path="url(#${uid}-dome)"><g class="pkc-balls"></g></g>`
    + `<circle class="pkc-glass" cx="${D.cx}" cy="${D.cy}" r="${D.r}" fill="url(#${uid}-glass)"/><path class="pkc-shine" d="M92 170q20-58 78-82"/>`
    + '<rect class="pkc-neck" x="96" y="62" width="208" height="26" rx="12"/><ellipse class="pkc-lid" cx="200" cy="64" rx="112" ry="26"/><ellipse class="pkc-lid-knob" cx="200" cy="34" rx="36" ry="20"/>'
    + '<g class="pkc-drop" transform="translate(200 508)"><g class="pkc-drop-in"></g></g></svg>';
  const sparks = make("div", "pick-capsule-sparks"); sparks.setAttribute("aria-hidden", "true");
  sparks.innerHTML = '<i class="k1"></i><i class="k2"></i><i class="k3"></i><i class="k4"></i>';
  machine.appendChild(sparks);
  box.append(machine, panel); api.arena.appendChild(box);
  const svg = machine.querySelector("svg"), ballsEl = machine.querySelector(".pkc-balls"), dropIn = machine.querySelector(".pkc-drop-in"), openEl = panel.querySelector(".pkc-open");
  let people = [], sig = null, running = false, hidden = "";
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

  function drawBalls(){ ballsEl.innerHTML = pickCapsuleBalls(people.filter(p => p.id !== hidden)).map(b => pickCapsuleSvg(b.x, b.y, b.r, b.person.color, b.rot)).join(""); }
  function fit(){
    const w = api.arena.clientWidth, h = api.arena.clientHeight; if (!w || !h) return;
    const side = w > 760 ? Math.min(300, w * 0.3) : 0, H = Math.max(240, Math.min(h - 8, (w - side - 30) * 1.5, 820));
    svg.style.height = Math.round(H) + "px"; svg.style.width = Math.round(H / 1.5) + "px"; box.classList.toggle("is-stacked", !side);
  }
  function setPanel(person){
    openEl.classList.remove("is-open", "is-in"); openEl.classList.toggle("is-empty", !person);
    if (!person) return;
    openEl.style.setProperty("--pk-c", person.color); openEl.querySelector("b").textContent = person.name || "사진 참가자"; openEl.querySelector("small").textContent = "당첨";
  }
  function start(){
    if (running || people.length < 2) return;
    const winner = people[pickRandomInt(people.length)], m = api.motion();
    running = true; api.setBusy(true); hidden = ""; setPanel(null); dropIn.innerHTML = ""; svg.classList.remove("is-out");
    const finish = () => { running = false; api.setBusy(false); api.showResult(winner, { kicker:"캡슐에서 나온 친구", againLabel:"한 번 더 뽑기" }); };
    if (!m){ hidden = winner.id; drawBalls(); setPanel(winner); openEl.classList.add("is-in", "is-open"); finish(); return; }
    svg.classList.add("is-turning", "is-shaking"); api.sound("roll");
    let ticks = 0; const rattle = () => { if (ticks++ < 5){ api.sound("roll"); later(170 * m, rattle); } }; rattle();
    later(1000 * m, () => {
      svg.classList.remove("is-turning", "is-shaking"); hidden = winner.id; drawBalls();
      dropIn.innerHTML = pickCapsuleSvg(0, 0, 26, winner.color, -20); void svg.getBoundingClientRect(); svg.classList.add("is-out"); api.sound("pop");
      later(650 * m, () => {
        setPanel(winner); void openEl.offsetWidth; openEl.classList.add("is-in"); api.sound("tick");
        later(650 * m, () => { openEl.classList.add("is-open"); api.sound("pop"); later(550 * m, finish); });
      });
    });
  }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(api.arena);
  fit();
  return {
    render(){
      if (running) return;
      const list = api.active(), next = list.map(p => [p.id, p.color].join("\u0001")).join("\u0002");
      if (next !== sig){ sig = next; people = list; hidden = ""; drawBalls(); }
    },
    canStart:() => api.active().length >= 2,
    start,
    dispose(){ timers.forEach(clearTimeout); timers.clear(); if (running) api.setBusy(false); running = false; if (observer) observer.disconnect(); box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.capsule = { mount:mountPickCapsule, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_CAPSULE_SHOW, PICK_CAPSULE_DOME, pickCapsuleBalls, pickCapsuleSvg, mountPickCapsule };
}
