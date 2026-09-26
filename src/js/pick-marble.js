"use strict";

/* ===== 복불복 — 구슬 경주 =====
   위 출발 칸(START)에서 구불구불한 길을 따라 아래 결승(FINISH)까지 구슬이 함께 달린다. 물리 계산은 하지 않는다.
   순위를 먼저 정하고(무작위 차례) 등수마다 도착 시각 T 를 조금씩 늦게 준 뒤, 구슬마다 진행도를
     p(u) = u + u(1-u)·Σ a_k·sin(2π k u + φ_k)   (u = t/T, a_k = 0.12/k 이하)
   로 흔든다. p(0)=0·p(1)=1 이고 기울기가 늘 0 보다 커서(시험이 확인) 뒤로 가지 않으면서도 중간에 앞뒤가 뒤바뀐다.
   도착한 구슬은 결승선 오른쪽 '도착 칸'에 등수대로 선다. */
const PICK_MARBLE_MAX = 30;
const PICK_MARBLE_W = 1000, PICK_MARBLE_H = 780, PICK_MARBLE_ROAD = 70;
/* 길 조종점(Catmull-Rom) — 출발 칸 아래에서 시작해 왼쪽·오른쪽으로 네 번 굽이치고 오른쪽 아래 결승으로. */
const PICK_MARBLE_TRACK = [[500, 100], [500, 150], [380, 186], [215, 212], [150, 300], [232, 382], [430, 396], [640, 346], [830, 382], [872, 480], [762, 560], [540, 560], [330, 560], [190, 612], [232, 690], [400, 712], [575, 712]];
function pickMarbleRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
/* 길을 촘촘한 점으로 — { pts:[[x,y]], cum:[누적 길이], length } */
function pickMarblePath(points, steps){
  const P = points, per = steps || 28, pts = [];
  for (let i = 0; i < P.length - 1; i++){
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let s = 0; s < per; s++){
      const t = s / per, t2 = t * t, t3 = t2 * t;
      pts.push([0, 1].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  pts.push(P[P.length - 1].slice());
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, length:cum[cum.length - 1] };
}
/* 길 위 d 지점의 좌표와 방향(단위 벡터). */
function pickMarbleAt(path, d){
  const L = path.length, x = Math.max(0, Math.min(L, d)); let lo = 0, hi = path.cum.length - 1;
  while (hi - lo > 1){ const mid = (lo + hi) >> 1; if (path.cum[mid] <= x) lo = mid; else hi = mid; }
  const a = path.pts[lo], b = path.pts[hi], seg = path.cum[hi] - path.cum[lo] || 1, t = (x - path.cum[lo]) / seg;
  const dx = (b[0] - a[0]) / seg, dy = (b[1] - a[1]) / seg, n = Math.hypot(dx, dy) || 1;
  return { x:a[0] + (b[0] - a[0]) * t, y:a[1] + (b[1] - a[1]) * t, tx:dx / n, ty:dy / n };
}
/* 경주 계획 — 순위(차례)를 먼저 섞고, 등수마다 도착 시각과 흔들림을 준다. */
function pickMarblePlan(n, base, random=pickMarbleRandom){
  const order = Array.from({ length:n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--){ const j = Math.min(i, Math.floor(random() * (i + 1))); [order[i], order[j]] = [order[j], order[i]]; }
  const gap = Math.min(0.035, 0.45 / Math.max(1, n)), racers = new Array(n);
  order.forEach((who, rank) => {
    const T = base * (1 + gap * rank + (rank ? random() * gap * 0.3 : 0));
    racers[who] = { rank, T, waves:[1, 2, 3].map(k => ({ k, a:(0.12 / k) * (0.55 + 0.45 * random()), phi:random() * Math.PI * 2 })),
      lane:0, wob:{ a:3 + random() * 5, w:1.2 + random() * 1.6, phi:random() * Math.PI * 2 } };
  });
  return { order, racers };
}
function pickMarbleProgress(racer, t){
  const u = Math.max(0, Math.min(1, t / racer.T)); let s = 0;
  racer.waves.forEach(w => { s += w.a * Math.sin(2 * Math.PI * w.k * u + w.phi); });
  return Math.max(0, Math.min(1, u + u * (1 - u) * s));
}
function pickMarbleEscape(text){ return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]); }
function pickMarbleSmooth(e0, e1, x){ const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
let _pickMarbleSeq = 0;

/* 판 그림(움직이지 않는 부분) — 바탕·나무·표지판·길·출발 칸·결승선. */
function pickMarbleBoardSvg(path, n, uid){
  const d = "M" + path.pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L"), road = PICK_MARBLE_ROAD;
  const penW = Math.max(road + 40, Math.min(880, n * 58 + 40)), penX = 500 - penW / 2;
  const tree = (x, y, s) => `<g class="pk-tree" transform="translate(${x} ${y}) scale(${s})"><rect x="-4" y="8" width="8" height="18" rx="3" class="pk-trunk"/><circle cx="0" cy="-8" r="16"/><circle cx="-12" cy="4" r="13"/><circle cx="12" cy="4" r="13"/><circle cx="-4" cy="-14" r="7" class="pk-leaf-hi"/></g>`;
  const rock = (x, y, s) => `<ellipse class="pk-rock" cx="${x}" cy="${y}" rx="${14 * s}" ry="${9 * s}"/>`;
  const sign = (x, y, rot, lines, k) => `<g class="pk-sign" transform="translate(${x} ${y}) rotate(${rot}) scale(${k || 1})"><rect x="-78" y="-${14 + lines.length * 13}" width="156" height="${28 + lines.length * 26}" rx="8"/>`
    + lines.map((line, i) => `<text x="0" y="${-lines.length * 13 + 22 + i * 26}">${pickMarbleEscape(line)}</text>`).join("") + "</g>";
  const end = path.pts[path.pts.length - 1];
  let checker = ""; for (let r = 0; r < 8; r++) for (let c = 0; c < 2; c++) checker += `<rect x="${end[0] - 10 + c * 10}" y="${end[1] - road / 2 - 8 + r * ((road + 16) / 8)}" width="10" height="${(road + 16) / 8}" class="${(r + c) % 2 ? "pk-chk-b" : "pk-chk-w"}"/>`;
  return `<defs><filter id="${uid}-sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#28305a" flood-opacity=".18"/></filter></defs>`
    + `<rect class="pk-ground" x="4" y="4" width="${PICK_MARBLE_W - 8}" height="${PICK_MARBLE_H - 8}" rx="28"/>`
    + tree(70, 120, 1.1) + tree(110, 150, 0.8) + rock(40, 170, 1) + tree(930, 110, 1.15) + tree(890, 150, 0.85) + rock(955, 175, 1.1)
    + tree(60, 470, 1) + rock(95, 505, 0.9) + tree(592, 470, 0.8) + tree(950, 560, 1) + rock(925, 610, 1) + tree(70, 700, 1.05) + rock(118, 728, 0.8)
    + `<g class="pk-mill" transform="translate(705 458)"><rect x="-4" y="0" width="8" height="34" rx="3"/><g class="pk-mill-blades"><rect x="-3" y="-32" width="6" height="32" rx="3"/><rect x="-3" y="-32" width="6" height="32" rx="3" transform="rotate(90)"/><rect x="-3" y="-32" width="6" height="32" rx="3" transform="rotate(180)"/><rect x="-3" y="-32" width="6" height="32" rx="3" transform="rotate(270)"/></g><circle r="9" class="pk-mill-hub"/></g>`
    + sign(330, 292, -4, ["함께여서", "더 즐거워요!"], 0.82) + sign(470, 636, 2, ["조금만 더! →"], 0.74)
    // 출발 칸 — 넓은 칸에서 깔때기로 길에 이어진다.
    + `<path class="pk-wall" d="M${penX - 10} 44 H${penX + penW + 10} V96 L${500 + road / 2 + 12} 150 V160 H${500 - road / 2 - 12} V150 L${penX - 10} 96 Z"/>`
    + `<path class="pk-wall-line" d="${d}" style="stroke-width:${road + 24}px" filter="url(#${uid}-sh)"/>`
    + `<path class="pk-road" d="M${penX} 52 H${penX + penW} V94 L${500 + road / 2} 146 V160 H${500 - road / 2} V146 L${penX} 94 Z"/>`
    + `<path class="pk-road-line" d="${d}" style="stroke-width:${road}px"/>`
    + `<path class="pk-lane" d="${d}"/>`
    // 도착 칸
    + `<rect class="pk-wall" x="${end[0] + 18}" y="${end[1] - 58}" width="${PICK_MARBLE_W - end[0] - 40}" height="${Math.min(112, PICK_MARBLE_H - end[1] + 46)}" rx="20"/>`
    + `<rect class="pk-road" x="${end[0] + 26}" y="${end[1] - 50}" width="${PICK_MARBLE_W - end[0] - 56}" height="${Math.min(96, PICK_MARBLE_H - end[1] + 30)}" rx="14"/>`
    + checker
    + `<g class="pk-banner is-finish" transform="translate(${end[0]} ${end[1] - road / 2 - 36})"><rect x="-58" y="-18" width="116" height="34" rx="8"/><text x="0" y="0">FINISH</text></g>`
    + `<g class="pk-banner is-start" transform="translate(500 26)"><rect x="-${Math.min(penW / 2, 170)}" y="-19" width="${Math.min(penW, 340)}" height="38" rx="12"/><text x="0" y="1">START</text></g>`;
}

function mountPickMarble(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const uid = "pkm" + (++_pickMarbleSeq), path = pickMarblePath(PICK_MARBLE_TRACK, 28);
  const box = make("div", "pick-marble"), stageEl = make("div", "pick-marble-board"), rank = make("ol", "pick-marble-rank"), count = make("div", "pick-marble-count"), notice = make("div", "pick-game-notice");
  rank.hidden = true; count.hidden = true; notice.hidden = true;
  box.append(stageEl, rank, count, notice); api.arena.appendChild(box);
  let people = [], sig = null, frame = 0, racing = false, plan = null, marbles = [], finished = [], timer = 0, lastRank = 0, leader = -1;
  const R = () => (people.length <= 8 ? 12 : people.length <= 16 ? 10 : 8);
  const penSlot = i => { const n = people.length, penW = Math.max(PICK_MARBLE_ROAD + 40, Math.min(880, n * 58 + 40)), gap = (penW - 40) / Math.max(1, n); return [500 - penW / 2 + 20 + gap * (i + 0.5), 76]; };
  const endSlot = rank => { const end = path.pts[path.pts.length - 1], cols = 10, gap = (PICK_MARBLE_W - end[0] - 90) / (cols - 1); return [end[0] + 50 + (rank % cols) * gap, end[1] - 28 + Math.floor(rank / cols) * 28]; };
  const laneOf = i => { const n = people.length, usable = PICK_MARBLE_ROAD - R() * 2 - 6; return n <= 1 ? 0 : ((i + 0.5) / n - 0.5) * usable; };

  function draw(){
    const n = people.length;
    let marblesSvg = "", defs = "";
    people.forEach((person, i) => {
      defs += `<radialGradient id="${uid}-g${i}" cx="35%" cy="30%" r="75%"><stop offset="0" style="stop-color:#ffffff;stop-opacity:.95"/><stop offset=".28" style="stop-color:${person.color}"/><stop offset="1" style="stop-color:color-mix(in srgb, ${person.color} 55%, #262a5c)"/></radialGradient>`;
      const [x, y] = penSlot(i), name = pickMarbleEscape(Array.from(person.name || "사진").slice(0, 5).join(""));
      marblesSvg += `<g class="pk-marble" data-i="${i}" transform="translate(${x} ${y})"><ellipse class="pk-marble-shadow" cx="1.5" cy="${R() * 0.8}" rx="${R()}" ry="${R() * 0.45}"/><circle r="${R()}" fill="url(#${uid}-g${i})"/>`
        + (n <= 12 ? `<g class="pk-tag"><rect x="-26" y="${-R() - 26}" width="52" height="20" rx="10"/><text x="0" y="${-R() - 15}">${name}</text></g>` : "")
        + `<text class="pk-rank-badge" x="0" y="1"></text></g>`;
    });
    let posts = ""; for (let i = 1; i < n; i++){ const a = penSlot(i - 1), b = penSlot(i); posts += `<rect class="pk-post" x="${(a[0] + b[0]) / 2 - 2}" y="60" width="4" height="30" rx="2"/>`; }
    stageEl.innerHTML = `<svg class="pick-marble-svg" viewBox="0 0 ${PICK_MARBLE_W} ${PICK_MARBLE_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="구슬 경주 판"><defs>${defs}</defs>${pickMarbleBoardSvg(path, n, uid)}${posts}<rect class="pk-gate" x="${penSlot(0)[0] - 30}" y="${96}" width="${penSlot(n - 1)[0] - penSlot(0)[0] + 60}" height="6" rx="3"/><g class="pk-marbles">${marblesSvg}</g></svg>`;
    marbles = people.map((_, i) => stageEl.querySelector(`.pk-marble[data-i="${i}"]`));
  }
  const place = (i, x, y) => { const el = marbles[i]; if (el) el.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`); };
  function renderRank(ids){
    rank.innerHTML = "";
    ids.slice(0, 6).forEach((i, k) => { const li = make("li"); li.style.setProperty("--pk-c", people[i].color); const b = make("b"); b.textContent = String(k + 1); const s = make("span"); s.textContent = people[i].name || "사진"; li.append(b, s); if (finished.includes(i)) li.classList.add("is-done"); rank.appendChild(li); });
    if (ids.length > 6){ const li = make("li", "is-more"); li.textContent = `… ${ids.length - 6}명`; rank.appendChild(li); }
  }
  function countdown(m, done){
    let k = 3; count.hidden = false;
    const tick = () => {
      if (k === 0){ count.textContent = "출발!"; count.classList.remove("is-pop"); void count.offsetWidth; count.classList.add("is-pop"); api.sound("pop"); timer = setTimeout(() => { count.hidden = true; done(); }, 380 * m); return; }
      count.textContent = String(k); count.classList.remove("is-pop"); void count.offsetWidth; count.classList.add("is-pop"); api.sound("tick"); k--; timer = setTimeout(tick, 560 * m);
    };
    tick();
  }
  function start(){
    if (racing || people.length < 2 || people.length > PICK_MARBLE_MAX) return;
    const m = api.motion(); plan = pickMarblePlan(people.length, 11000 * (m || 1)); finished = []; leader = -1;
    people.forEach((_, i) => { plan.racers[i].lane = laneOf(i); });
    draw();
    const results = () => plan.order.map(i => people[i]);
    const finishAll = () => {
      racing = false; box.classList.remove("is-racing"); api.setBusy(false);
      plan.order.forEach((i, r) => { const [x, y] = endSlot(r); place(i, x, y); const badge = marbles[i] && marbles[i].querySelector(".pk-rank-badge"); if (badge) badge.textContent = String(r + 1); if (marbles[i]) marbles[i].classList.add("is-in"); });
      finished = plan.order.slice(); renderRank(plan.order); rank.hidden = false; api.refresh();
      const list = results();
      api.showResult(list[0], { kicker:"1등!", againLabel:"다시 경주", rows:list.map((person, r) => ({ person, label:`${r + 1}등`, win:r === 0 })) });
    };
    if (!m){ finishAll(); return; }
    racing = true; api.setBusy(true); box.classList.add("is-racing"); rank.hidden = false; renderRank(people.map((_, i) => i));
    countdown(m, () => {
      stageEl.querySelector(".pk-gate").classList.add("is-open");
      const t0 = performance.now(), arrive = new Array(people.length).fill(0), total = path.length;
      const step = now => {
        const t = now - t0, prog = people.map((_, i) => pickMarbleProgress(plan.racers[i], t));
        people.forEach((_, i) => {
          const racer = plan.racers[i];
          if (t >= racer.T){
            if (!arrive[i]){ arrive[i] = now; finished.push(i); api.sound("pop"); const badge = marbles[i] && marbles[i].querySelector(".pk-rank-badge"); if (badge) badge.textContent = String(racer.rank + 1); if (marbles[i]) marbles[i].classList.add("is-in"); }
            const [ex, ey] = endSlot(racer.rank), endPt = pickMarbleAt(path, total), w = pickMarbleSmooth(0, 1, (now - arrive[i]) / 450);
            place(i, endPt.x + (ex - endPt.x) * w, endPt.y + (ey - endPt.y) * w); return;
          }
          const p = prog[i], at = pickMarbleAt(path, p * total), wob = racer.wob, lat = racer.lane + wob.a * Math.sin(wob.w * t / 1000 * Math.PI * 2 + wob.phi) * pickMarbleSmooth(0.03, 0.08, p);
          let x = at.x - at.ty * lat, y = at.y + at.tx * lat;
          const into = pickMarbleSmooth(0, 0.035, p); if (into < 1){ const [sx, sy] = penSlot(i); x = sx + (x - sx) * into; y = sy + (y - sy) * into; }
          place(i, x, y);
        });
        const running = people.map((_, i) => i).filter(i => !arrive[i]).sort((a, b) => prog[b] - prog[a]);
        const ids = finished.concat(running);
        if (ids[0] !== leader){ leader = ids[0]; if (t > 600) api.sound("tick"); }
        if (now - lastRank > 160){ lastRank = now; renderRank(ids); }
        if (finished.length < people.length){ frame = requestAnimationFrame(step); return; }
        frame = 0; timer = setTimeout(finishAll, 450);
      };
      frame = requestAnimationFrame(step);
    });
  }
  return {
    render(){
      if (racing) return;
      const list = api.active(), tooMany = list.length > PICK_MARBLE_MAX;
      notice.hidden = !tooMany; stageEl.hidden = tooMany; notice.textContent = tooMany ? `구슬 경주는 ${PICK_MARBLE_MAX}명까지예요 — 지금 ${list.length}명이에요. 몇 명을 '이번엔 빼기'로 두세요.` : "";
      if (tooMany) return;
      const next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002");
      if (next !== sig){ sig = next; people = list; plan = null; finished = []; rank.hidden = true; draw(); }
      else if (!marbles.length) draw();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_MARBLE_MAX; },
    blockReason:() => (api.active().length > PICK_MARBLE_MAX ? `구슬 경주는 ${PICK_MARBLE_MAX}명까지예요. 몇 명을 '이번엔 빼기'로 두세요.` : ""),
    start,
    goLabel:() => (plan ? "다시 경주" : ""),
    dispose(){ cancelAnimationFrame(frame); clearTimeout(timer); if (racing) api.setBusy(false); racing = false; box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.marble = { mount:mountPickMarble, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_MARBLE_MAX, PICK_MARBLE_TRACK, pickMarblePath, pickMarbleAt, pickMarblePlan, pickMarbleProgress, pickMarbleBoardSvg, mountPickMarble };
}
