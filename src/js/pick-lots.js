"use strict";

/* ===== 복불복 — 제비뽑기 =====
   어항 같은 유리그릇에 참가자 쪽지(접힌 종이, 참가자 색 별)가 들어 있고, 누를 때마다 쪽지 하나가 올라와 펼쳐진다.
   뽑은 쪽지는 그릇 밖 탁자 위에 세워 두고 다시 넣지 않는다 — 누를 때마다 남은 사람 가운데 한 명(발표·청소 순서 정하기). 다 뽑으면 '다시 넣기'.
   뽑을 쪽지는 먼저 정한다(pickRandomInt). 뽑은 차례는 화면에만. */
const PICK_LOTS_MAX = 60;
const PICK_LOTS_BOWL = { cx:320, cy:246, r:176 };
function pickLotsEscape(text){ return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]); }
/* 접힌 쪽지 — 가운데 0,0 · 크기 s. */
function pickLotsSlipSvg(s, color){
  const h = s / 2;
  return `<path class="pkj-slip" d="M${-h} ${-h * 0.8}L${h} ${-h}L${h * 0.9} ${h}L${-h * 0.95} ${h * 0.9}Z"/><path class="pkj-fold" d="M${-h} ${-h * 0.8}L${h * 0.9} ${h}"/>`
    + `<path class="pkj-star" style="fill:${color}" transform="scale(${(s / 60).toFixed(3)})" d="M0-11l3.2 6.6 7.2 1-5.2 5 1.2 7.2L0 5.4l-6.4 3.4 1.2-7.2-5.2-5 7.2-1z"/>`;
}
/* 탁자 위 뽑은 쪽지 자리 — 왼쪽 넷, 오른쪽 넷. */
const PICK_LOTS_TENTS = [[88, 452], [150, 470], [64, 400], [132, 414], [552, 452], [490, 470], [576, 400], [508, 414]];
function pickLotsTentSvg(x, y, color, name){
  return `<g transform="translate(${x} ${y})"><path class="pkj-tent" d="M-34 18L-6-22 34-14 20 22Z"/><path class="pkj-tent-side" d="M-6-22L20 22 30 20 34-14Z"/>`
    + `<path style="fill:${color}" transform="translate(-2 2) scale(.55)" d="M0-11l3.2 6.6 7.2 1-5.2 5 1.2 7.2L0 5.4l-6.4 3.4 1.2-7.2-5.2-5 7.2-1z"/>`
    + `<text class="pkj-tent-name" y="40">${pickLotsEscape(Array.from(name || "사진").slice(0, 4).join(""))}</text></g>`;
}

let _pickLotsSeq = 0;

function mountPickLots(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const B = PICK_LOTS_BOWL, box = make("div", "pick-lots"), stageEl = make("div", "pkj-stage"), banner = make("div", "pkj-banner"), notice = make("div", "pick-game-notice");
  banner.hidden = true; notice.hidden = true; box.append(stageEl, banner, notice); api.arena.appendChild(box);
  stageEl.innerHTML = `<svg class="pkj-svg" viewBox="0 0 640 520" role="img" aria-label="제비뽑기 그릇"><defs><clipPath id="pkj-clip-${++_pickLotsSeq}"><circle cx="${B.cx}" cy="${B.cy}" r="${B.r - 6}"/></clipPath></defs>`
    + '<ellipse class="pkj-table" cx="320" cy="470" rx="310" ry="60"/><rect class="pkj-tray" x="150" y="410" width="340" height="80" rx="18"/>'
    + '<g class="pkj-tents"></g>'
    + `<circle class="pkj-bowl-back" cx="${B.cx}" cy="${B.cy}" r="${B.r}"/><g class="pkj-inside"><g class="pkj-slips"></g></g>`
    + `<circle class="pkj-bowl" cx="${B.cx}" cy="${B.cy}" r="${B.r}"/><path class="pkj-shine" d="M${B.cx - 130} ${B.cy - 40}q18-70 90-100"/>`
    + `<rect class="pkj-mouth-cover" x="${B.cx - 130}" y="${B.cy - B.r - 4}" width="260" height="40"/><ellipse class="pkj-rim" cx="${B.cx}" cy="${B.cy - B.r + 34}" rx="132" ry="16"/>`
    + '<g class="pkj-flying"></g></svg>';
  const svg = stageEl.querySelector("svg"), clip = svg.querySelector("clipPath"), inside = svg.querySelector(".pkj-inside"), slipsEl = svg.querySelector(".pkj-slips"), tentsEl = svg.querySelector(".pkj-tents"), flyEl = svg.querySelector(".pkj-flying");
  inside.setAttribute("clip-path", `url(#${clip.getAttribute("id")})`);
  let people = [], sig = null, drawn = [], running = false, frame = 0, lastPick = null;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const remaining = () => people.filter(p => !drawn.includes(p.id));

  function drawSlips(){
    const list = remaining().slice(0, 60), pack = typeof pickPackCircle === "function" ? pickPackCircle(list.length, B.r - 14) : { r:20, pts:list.map(() => [0, 0]) }, s = Math.min(64, pack.r * 1.7);
    slipsEl.innerHTML = list.map((person, i) => { const [x, y] = pack.pts[i] || [0, 0]; return `<g transform="translate(${(B.cx + x).toFixed(1)} ${(B.cy + y).toFixed(1)}) rotate(${((i * 47) % 70 - 35)})">${pickLotsSlipSvg(s, person.color)}</g>`; }).join("");
  }
  function drawTents(){
    const recent = drawn.slice(-PICK_LOTS_TENTS.length);
    tentsEl.innerHTML = recent.map((id, k) => { const person = people.find(p => p.id === id) || api.model.people.find(p => p.id === id); const [x, y] = PICK_LOTS_TENTS[k]; return person ? pickLotsTentSvg(x, y, person.color, person.name) : ""; }).join("");
  }
  function showBanner(person){
    banner.hidden = !person; banner.innerHTML = ""; if (!person) return;
    const text = make("strong"); text.textContent = `${person.name || "사진 참가자"} 당첨`;
    const star = make("span", "pkj-banner-star"); star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z"/></svg>';
    const count = make("small"); count.textContent = `${drawn.length}번째 제비`;
    banner.append(count, text, star);
  }
  function refill(){ drawn = []; lastPick = null; showBanner(null); drawSlips(); drawTents(); api.refresh(); }
  function start(){
    if (running) return;
    if (!remaining().length){ refill(); return; }
    const list = remaining(), winner = list[pickRandomInt(list.length)], m = api.motion();
    const finish = () => { running = false; drawn.push(winner.id); lastPick = winner; flyEl.innerHTML = ""; drawTents(); showBanner(winner); api.setBusy(false); api.refresh();
      api.showResult(winner, { kicker:`${drawn.length}번째 제비`, againLabel:remaining().length ? "한 장 더 뽑기" : "다시 넣기" }); };
    running = true; api.setBusy(true); showBanner(null);
    if (!m){ drawn.push(winner.id); drawSlips(); drawn.pop(); finish(); return; }
    svg.classList.add("is-shaking"); api.sound("roll");
    later(700 * m, () => {
      svg.classList.remove("is-shaking"); drawn.push(winner.id); drawSlips(); drawn.pop();
      flyEl.innerHTML = `<g class="pkj-fly">${pickLotsSlipSvg(56, winner.color)}</g>`; const fly = flyEl.querySelector(".pkj-fly"); api.sound("pop");
      const t0 = performance.now(), dur = 1100 * m, from = [B.cx, B.cy + 30], top = [B.cx + 20, B.cy - B.r - 40], to = [320, 440];
      const step = now => {
        const t = Math.min(1, (now - t0) / dur); let x, y, sc, rot;
        if (t < 0.5){ const u = t / 0.5, e = u * (2 - u); x = from[0] + (top[0] - from[0]) * e; y = from[1] + (top[1] - from[1]) * e; sc = 1; rot = -20 + 60 * u; }
        else { const u = (t - 0.5) / 0.5, e = u * u; x = top[0] + (to[0] - top[0]) * e; y = top[1] + (to[1] - top[1]) * e; sc = 1 + u * 1.4; rot = 40 - 40 * u; }
        fly.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${sc.toFixed(2)})`);
        if (t < 1){ frame = requestAnimationFrame(step); return; }
        frame = 0; api.sound("tick"); finish();
      };
      frame = requestAnimationFrame(step);
    });
  }
  svg.addEventListener("click", () => api.requestStart());
  return {
    render(){
      if (running) return;
      const list = api.active(), tooMany = list.length > PICK_LOTS_MAX;
      notice.hidden = !tooMany; stageEl.hidden = tooMany; notice.textContent = tooMany ? `제비뽑기는 ${PICK_LOTS_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      const next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002");
      if (next !== sig){ sig = next; people = list; drawn = drawn.filter(id => list.some(p => p.id === id)); if (lastPick && !list.includes(lastPick)){ lastPick = null; showBanner(null); } }
      drawSlips(); drawTents();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_LOTS_MAX; },
    blockReason:() => (api.active().length > PICK_LOTS_MAX ? `제비뽑기는 ${PICK_LOTS_MAX}명까지예요.` : ""),
    start,
    goLabel:() => (people.length && !remaining().length ? "다시 넣기" : drawn.length ? "한 장 더 뽑기" : ""),
    menuItems:() => [{ label:"쪽지 모두 다시 넣기", icon:"refresh", disabled:!drawn.length, action:() => { if (!running) refill(); } }],
    dispose(){ cancelAnimationFrame(frame); timers.forEach(clearTimeout); timers.clear(); if (running) api.setBusy(false); running = false; box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.lots = { mount:mountPickLots, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_LOTS_MAX, PICK_LOTS_BOWL, PICK_LOTS_TENTS, pickLotsSlipSvg, pickLotsTentSvg, mountPickLots };
}
