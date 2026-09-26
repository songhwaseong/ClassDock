"use strict";

/* ===== 복불복 — 공 뽑기 =====
   유리 통 안에 참가자 번호 공(명단 번호 01·02… — 옆 참가자 칸에도 같은 번호)이 들어 있고, 바람에 섞이다 공 하나가 관을 타고 받침으로 굴러 나온다.
   뽑힌 공은 통 밖에 남는다 — 누를 때마다 남은 공 가운데 하나씩(발표 순서 정하기처럼). 다 뽑으면 '공 다시 넣기'.
   뽑을 공은 먼저 정한다(pickRandomInt). 통 안 움직임은 간단한 튕김 계산(중력·벽·공끼리)일 뿐 결과와는 상관없다. 뽑은 차례는 화면에만. */
const PICK_LOTTO_MAX = 60;
const PICK_LOTTO_SPHERE = { cx:290, cy:236, r:196 };
const PICK_LOTTO_EXIT = 38;   // 관이 붙은 자리(도, 3시에서 시계 방향)
function pickLottoRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
/* 명단 번호 — 쉬는 사람이 있어도 번호가 바뀌지 않게 전체 명단 차례로. */
function pickLottoNumber(model, person){ const i = (model.people || []).indexOf(person); return String(i < 0 ? 0 : i + 1).padStart(2, "0"); }
/* 관 — 통 가장자리에서 받침까지 굽은 길(베지어를 점으로). */
function pickLottoTube(){
  const S = PICK_LOTTO_SPHERE, a = PICK_LOTTO_EXIT * Math.PI / 180, p0 = [S.cx + Math.cos(a) * (S.r - 20), S.cy + Math.sin(a) * (S.r - 20)];
  const p1 = [p0[0] + 70, p0[1] + 18], p2 = [548, 392], p3 = [540, 470], pts = [];
  for (let i = 0; i <= 40; i++){ const t = i / 40, u = 1 - t; pts.push([0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k])); }
  return pts;
}
/* 튕김 한 걸음 — balls:[{x,y,vx,vy}] (통 가운데 기준), r 공 반지름, R 통 안 반지름. mix 면 바닥 쪽 공을 위로 불어 올린다. */
function pickLottoStep(balls, r, R, dt, mix, random=Math.random){
  const g = 1100, wall = R - r;
  balls.forEach(b => {
    b.vy += g * dt;
    if (mix && b.y > R * 0.25 && random() < 0.09){ b.vy -= 700 + random() * 500; b.vx += (random() - 0.5) * 600; }
    b.vx *= 0.995; b.vy *= 0.995; b.x += b.vx * dt; b.y += b.vy * dt;
    const d = Math.hypot(b.x, b.y);
    if (d > wall){ const nx = b.x / d, ny = b.y / d, vn = b.vx * nx + b.vy * ny; b.x = nx * wall; b.y = ny * wall; if (vn > 0){ b.vx -= 1.55 * vn * nx; b.vy -= 1.55 * vn * ny; } }
  });
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++){
    const a = balls[i], b = balls[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001;
    if (d >= r * 2) continue;
    const nx = dx / d, ny = dy / d, push = (r * 2 - d) / 2; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; if (vn < 0){ const k = -0.9 * vn; a.vx -= k * nx; a.vy -= k * ny; b.vx += k * nx; b.vy += k * ny; }
  }
  // 공끼리 밀어내다 벽 밖으로 밀린 공은 다시 안으로(유리를 뚫고 나가 보이지 않게).
  balls.forEach(b => { const d = Math.hypot(b.x, b.y); if (d > wall){ b.x *= wall / d; b.y *= wall / d; } });
}
function pickLottoEscape(text){ return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]); }
function pickLottoBall(num, color, r){ return `<circle r="${r}" style="fill:${color}"/><circle r="${r}" class="pkl-ball-shade"/><ellipse class="pkl-ball-shine" cx="${-r * 0.35}" cy="${-r * 0.42}" rx="${r * 0.32}" ry="${r * 0.2}"/><text class="pkl-ball-num" font-size="${Math.round(r * 0.9)}">${pickLottoEscape(num)}</text>`; }

function mountPickLotto(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const S = PICK_LOTTO_SPHERE, tube = pickLottoTube(), R = S.r - 6;
  const box = make("div", "pick-lotto"), stageEl = make("div", "pick-lotto-machine"), banner = make("div", "pick-lotto-banner"), drawnRow = make("div", "pick-lotto-drawn"), notice = make("div", "pick-game-notice");
  notice.hidden = true; box.append(stageEl, banner, drawnRow, notice); api.arena.appendChild(box);
  const tubeD = "M" + tube.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L");
  stageEl.innerHTML = `<svg class="pick-lotto-svg" viewBox="0 0 640 560" role="img" aria-label="번호 공 뽑기 기계">`
    + '<ellipse class="pkl-shadow" cx="300" cy="530" rx="250" ry="16"/>'
    + `<rect class="pkl-stand" x="${S.cx - 150}" y="420" width="300" height="70" rx="26"/><ellipse class="pkl-plate" cx="${S.cx}" cy="424" rx="170" ry="30"/><rect class="pkl-foot" x="${S.cx - 210}" y="478" width="420" height="44" rx="22"/>`
    + `<circle class="pkl-glass-back" cx="${S.cx}" cy="${S.cy}" r="${S.r}"/>`
    + `<g class="pkl-mixer"><rect x="${S.cx - 6}" y="${S.cy - 170}" width="12" height="330" rx="6"/><path d="M${S.cx} ${S.cy - 60}q-90 -20 -120 -90M${S.cx} ${S.cy - 60}q90 -20 120 -90M${S.cx} ${S.cy + 40}q-80 10 -110 -40M${S.cx} ${S.cy + 40}q80 10 110 -40"/></g>`
    + `<g class="pkl-balls" transform="translate(${S.cx} ${S.cy})"></g>`
    + `<circle class="pkl-glass" cx="${S.cx}" cy="${S.cy}" r="${S.r}"/><path class="pkl-shine" d="M${S.cx - 150} ${S.cy - 70}q24-76 100-110"/>`
    + `<path class="pkl-tube-back" d="${tubeD}"/><ellipse class="pkl-cup-back" cx="540" cy="484" rx="62" ry="18"/>`
    + '<g class="pkl-out"></g>'
    + `<path class="pkl-tube" d="${tubeD}"/><path class="pkl-cup" d="M478 484v18q0 20 62 20t62-20v-18"/><ellipse class="pkl-cup-rim" cx="540" cy="484" rx="62" ry="18"/></svg>`;
  const svg = stageEl.querySelector("svg"), ballsEl = stageEl.querySelector(".pkl-balls"), outEl = stageEl.querySelector(".pkl-out");
  let people = [], sig = null, drawn = [], balls = [], r = 20, frame = 0, running = false, lastPick = null;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const remaining = () => people.filter(p => !drawn.includes(p.id));
  const num = person => pickLottoNumber(api.model, person);

  function layout(){
    const list = remaining(), pack = typeof pickPackCircle === "function" ? pickPackCircle(Math.max(1, list.length), R) : { r:18, pts:list.map(() => [0, 0]) };
    r = Math.max(12, Math.min(34, pack.r * 0.96));
    balls = list.map((person, i) => ({ person, x:pack.pts[i] ? pack.pts[i][0] : 0, y:pack.pts[i] ? pack.pts[i][1] : 0, vx:0, vy:0 }));
    ballsEl.innerHTML = balls.map((b, i) => `<g class="pkl-ball" data-i="${i}" transform="translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})">${pickLottoBall(num(b.person), b.person.color, r)}</g>`).join("");
    balls.forEach((b, i) => { b.el = ballsEl.querySelector(`.pkl-ball[data-i="${i}"]`); });
  }
  const placeAll = () => balls.forEach(b => { if (b.el) b.el.setAttribute("transform", `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`); });
  function renderBanner(){
    banner.innerHTML = "";
    if (!lastPick){ const t = make("span", "pkl-banner-hint"); t.textContent = remaining().length ? `공 ${remaining().length}개 — 섞어서 하나를 뽑아요` : "공을 모두 뽑았어요"; banner.appendChild(t); return; }
    const ball = make("span", "pkl-banner-ball"); ball.style.setProperty("--pk-c", lastPick.color); ball.textContent = num(lastPick);
    const text = make("strong"); text.textContent = `${lastPick.name || "사진 참가자"} 당첨`; banner.append(ball, text);
  }
  function renderDrawn(){
    drawnRow.innerHTML = ""; drawnRow.hidden = !drawn.length; if (!drawn.length) return;
    const label = make("span", "pkl-drawn-label"); label.textContent = "뽑은 공"; drawnRow.appendChild(label);
    drawn.forEach(id => { const person = people.find(p => p.id === id) || api.model.people.find(p => p.id === id); if (!person) return; const b = make("span", "pkl-mini"); b.style.setProperty("--pk-c", person.color); b.textContent = num(person); b.title = person.name || ""; drawnRow.appendChild(b); });
  }
  function start(){
    if (running) return;
    if (!remaining().length){ drawn = []; lastPick = null; outEl.innerHTML = ""; layout(); renderBanner(); renderDrawn(); api.refresh(); return; }
    const list = remaining(), winner = list[pickRandomInt(list.length)], m = api.motion();
    const finish = () => {
      running = false; drawn.push(winner.id); lastPick = winner; api.setBusy(false); renderBanner(); renderDrawn(); api.refresh();
      api.showResult(winner, { kicker:`${drawn.length}번째 공 · ${num(winner)}번`, againLabel:remaining().length ? "다음 공 뽑기" : "공 다시 넣기" });
    };
    running = true; api.setBusy(true); outEl.innerHTML = ""; lastPick = null; renderBanner();
    if (!m){ balls = balls.filter(b => b.person !== winner); layout(); outEl.innerHTML = `<g transform="translate(540 470)">${pickLottoBall(num(winner), winner.color, 24)}</g>`; finish(); return; }
    svg.classList.add("is-mixing"); let t0 = 0, prev = 0; const mixMs = 2400 * m, settleMs = 700 * m;
    const step = now => {
      if (!t0){ t0 = now; prev = now; }
      const el = now - t0, dt = Math.min(0.033, (now - prev) / 1000) || 0.016; prev = now;
      for (let k = 0; k < 2; k++) pickLottoStep(balls, r, R, dt / 2, el < mixMs);
      placeAll(); if (el < mixMs && Math.random() < 0.12) api.sound("tick");
      if (el < mixMs + settleMs){ frame = requestAnimationFrame(step); return; }
      frame = 0; svg.classList.remove("is-mixing");
      // 뽑힌 공 — 통에서 빼고 관을 따라 받침까지 굴린다(처음엔 느리게, 갈수록 빠르게).
      const gone = balls.find(b => b.person === winner); if (gone && gone.el) gone.el.remove(); balls = balls.filter(b => b !== gone);
      outEl.innerHTML = `<g class="pkl-rolling">${pickLottoBall(num(winner), winner.color, 24)}</g>`; const ballEl = outEl.querySelector(".pkl-rolling");
      api.sound("pop"); const t1 = performance.now(), dur = 1000 * m;
      const roll = now2 => {
        const t = Math.min(1, (now2 - t1) / dur), e = t * t, idx = Math.min(tube.length - 1, Math.floor(e * (tube.length - 1))), pt = tube[idx];
        ballEl.setAttribute("transform", `translate(${pt[0].toFixed(1)} ${pt[1].toFixed(1)}) rotate(${(e * 540).toFixed(0)})`);
        if (t < 1){ frame = requestAnimationFrame(roll); return; }
        frame = 0; ballEl.classList.add("is-landed"); api.sound("tick"); later(420 * m, finish);
      };
      frame = requestAnimationFrame(roll);
    };
    frame = requestAnimationFrame(step);
  }
  return {
    render(){
      if (running) return;
      const list = api.active(), tooMany = list.length > PICK_LOTTO_MAX;
      notice.hidden = !tooMany; stageEl.hidden = tooMany; notice.textContent = tooMany ? `공 뽑기는 ${PICK_LOTTO_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      const next = list.map(p => [p.id, p.color, api.model.people.indexOf(p)].join("\u0001")).join("\u0002");
      if (next !== sig){ sig = next; people = list; drawn = drawn.filter(id => list.some(p => p.id === id)); if (lastPick && !list.includes(lastPick)) lastPick = null; layout(); }
      renderBanner(); renderDrawn();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_LOTTO_MAX; },
    blockReason:() => (api.active().length > PICK_LOTTO_MAX ? `공 뽑기는 ${PICK_LOTTO_MAX}명까지예요.` : ""),
    start,
    badge:person => num(person),
    goLabel:() => (!remaining().length && people.length ? "공 다시 넣기" : drawn.length ? "다음 공 뽑기" : ""),
    menuItems:() => [{ label:"공 모두 다시 넣기", icon:"refresh", disabled:!drawn.length, action:() => { if (!running){ drawn = []; lastPick = null; outEl.innerHTML = ""; layout(); renderBanner(); renderDrawn(); api.refresh(); } } }],
    dispose(){ cancelAnimationFrame(frame); timers.forEach(clearTimeout); timers.clear(); if (running) api.setBusy(false); running = false; box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.lotto = { mount:mountPickLotto, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_LOTTO_MAX, PICK_LOTTO_SPHERE, pickLottoNumber, pickLottoTube, pickLottoStep, mountPickLotto };
}
