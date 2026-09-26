"use strict";

/* ===== 복불복 — 룰렛 돌리기 =====
   바늘은 12시에 고정, 바퀴가 시계 방향으로 돈다. 칸 i 는 12시에서 시계 방향으로 [i·s, (i+1)·s) (s = 360/사람 수).
   뽑기는 먼저 끝낸다(pickRandomInt) — 그 칸 안의 한 점(가장자리는 피해서)이 바늘 아래 오도록 멈출 각을 거꾸로 셈한다(pickRouletteTarget).
   돌아가는 동안 바늘 아래 칸이 바뀔 때마다 '딱' 소리와 바늘 튕김 — 칸 번호는 pickRouletteIndexAt 하나로 셈해 멈춘 칸과 늘 같다. */
const PICK_ROULETTE_R = 100;

/* 바퀴가 deg 만큼(시계 방향) 돌았을 때 바늘 아래 칸 번호. */
function pickRouletteIndexAt(deg, count){
  if (!(count > 0)) return -1;
  const s = 360 / count, a = (((-deg) % 360) + 360) % 360;
  return Math.min(count - 1, Math.floor(a / s + 1e-9));
}
/* 지금 current 도에서 시계 방향으로 turns 바퀴 넘게 돌아 칸 index 의 (가운데 + offset·칸 폭) 지점이 바늘 아래 오는 각. offset 은 -0.45~0.45. */
function pickRouletteTarget(current, index, count, opts = {}){
  const s = 360 / count, offset = Math.max(-0.45, Math.min(0.45, Number(opts.offset) || 0)), turns = Math.max(0, Math.floor(opts.turns == null ? 5 : opts.turns));
  const a = (index + 0.5 + offset) * s, want = (((-a) % 360) + 360) % 360, now = ((current % 360) + 360) % 360;
  return current + turns * 360 + ((want - now + 360) % 360);
}
function pickRoulettePoint(deg, r){ const a = deg * Math.PI / 180; return [Math.sin(a) * r, -Math.cos(a) * r]; }
function pickRouletteFixed(n){ return Math.round(n * 100) / 100; }
function pickRouletteEscape(text){ return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]); }
/* 이름표 — 8칸까지는 바퀴 기준으로 똑바로(그림처럼), 그보다 많으면 반지름 방향으로 눕혀 길게. 너무 작아지면 null(안 씀). */
function pickRouletteLabel(count, name, hasPhoto){
  const R = PICK_ROULETTE_R, chars = Array.from(String(name || ""));
  const radial = count > 8, maxLen = radial ? 7 : 8;
  const text = chars.length > maxLen ? chars.slice(0, maxLen - 1).join("") + "…" : chars.join("");
  const len = Math.max(1.6, Array.from(text).length);
  if (!radial){
    const d = count === 1 ? 0 : hasPhoto ? R * 0.5 : R * 0.6, half = Math.min(Math.PI / 2, Math.PI / Math.max(1, count));
    const width = count <= 2 ? R * 1.1 : Math.min(R * 1.1, 2 * d * Math.sin(half) * 0.92);
    const size = Math.min(15, width / len); return size < 4 ? null : { text, radial, dist:d, size };
  }
  const dist = hasPhoto ? R * 0.55 : R * 0.62, along = hasPhoto ? R * 0.5 : R * 0.62, across = 2 * dist * Math.sin(Math.PI / count) * 0.78;
  const size = Math.min(13, along / len, across); return size < 3.6 ? null : { text, radial, dist, size };
}
/* 바퀴 속(돌아가는 층) SVG 조각 — 칸·이름·사진·테두리 못. uid 는 사진 자르기 clipPath 이름을 문서마다 다르게. */
function pickRouletteSlices(people, uid){
  const R = PICK_ROULETTE_R, n = people.length; let defs = "", body = "";
  if (!n) return { defs, body:`<circle class="pick-slice-empty" r="${R}"/>` };
  const s = 360 / n;
  people.forEach((person, i) => {
    const a0 = i * s, a1 = (i + 1) * s, mid = a0 + s / 2, color = person.color || "#e5e7eb";
    let shape;
    if (n === 1) shape = `<circle class="pick-slice-bg" r="${R}" fill="${color}"/>`;
    else { const [x0, y0] = pickRoulettePoint(a0, R), [x1, y1] = pickRoulettePoint(a1, R); shape = `<path class="pick-slice-bg" d="M0 0L${pickRouletteFixed(x0)} ${pickRouletteFixed(y0)}A${R} ${R} 0 ${s > 180 ? 1 : 0} 1 ${pickRouletteFixed(x1)} ${pickRouletteFixed(y1)}Z" fill="${color}"/>`; }
    let photo = "";
    const photoOk = person.image && n <= 16;
    if (photoOk){
      // 한 명뿐이면 가운데 위쪽에 크게, 여럿이면 칸 바깥쪽에 작게.
      const d = n === 1 ? R * 0.42 : R * 0.8, r = n === 1 ? R * 0.3 : Math.min(14, 2 * d * Math.sin(Math.PI / n) * 0.36);
      const [cx, cy] = n === 1 ? [0, -d] : pickRoulettePoint(mid, d), id = `${uid}-c${i}`;
      defs += `<clipPath id="${id}"><circle cx="${pickRouletteFixed(cx)}" cy="${pickRouletteFixed(cy)}" r="${pickRouletteFixed(r)}"/></clipPath>`;
      photo = `<circle class="pick-slice-photo-ring" cx="${pickRouletteFixed(cx)}" cy="${pickRouletteFixed(cy)}" r="${pickRouletteFixed(r + 1.6)}"/>`
        + `<image href="${pickRouletteEscape(person.image.dataUrl)}" x="${pickRouletteFixed(cx - r)}" y="${pickRouletteFixed(cy - r)}" width="${pickRouletteFixed(r * 2)}" height="${pickRouletteFixed(r * 2)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
    }
    let label = "";
    const info = pickRouletteLabel(n, person.name, !!photoOk);
    if (info && info.text){
      if (!info.radial){ const [x, y] = n === 1 ? [0, photoOk ? R * 0.2 : 0] : pickRoulettePoint(mid, info.dist); label = `<text class="pick-slice-label" x="${pickRouletteFixed(x)}" y="${pickRouletteFixed(y)}" font-size="${pickRouletteFixed(info.size)}">${pickRouletteEscape(info.text)}</text>`; }
      else { const flip = mid > 180, rot = flip ? mid + 90 : mid - 90; label = `<text class="pick-slice-label" transform="rotate(${pickRouletteFixed(rot)}) translate(${pickRouletteFixed(flip ? -info.dist : info.dist)} 0)" font-size="${pickRouletteFixed(info.size)}">${pickRouletteEscape(info.text)}</text>`; }
    }
    body += `<g class="pick-slice" data-i="${i}">${shape}${photo}${label}</g>`;
  });
  if (n > 1) for (let i = 0; i < n; i++){ const [x, y] = pickRoulettePoint(i * s, R); body += `<line class="pick-slice-sep" x1="0" y1="0" x2="${pickRouletteFixed(x)}" y2="${pickRouletteFixed(y)}"/>`; }
  if (n > 1 && n <= 40) for (let i = 0; i < n; i++){ const [x, y] = pickRoulettePoint(i * s, R + 5); body += `<circle class="pick-peg" cx="${pickRouletteFixed(x)}" cy="${pickRouletteFixed(y)}" r="1.9"/>`; }
  return { defs, body };
}
let _pickRouletteSeq = 0;

function mountPickRoulette(api){
  const uid = "pkr" + (++_pickRouletteSeq);
  const wrap = document.createElement("div"); wrap.className = "pick-wheel";
  wrap.innerHTML = '<svg class="pick-wheel-sparks" viewBox="-150 -150 300 300" aria-hidden="true">'
    + '<path d="M96 -112l10 -16M112 -98l17 -10" stroke="#fcd34d"/><path d="M-96 -112l-10 -16M-112 -98l-17 -10" stroke="#fb8a78"/>'
    + '<path d="M-100 104l-12 14M-114 92l-16 8" stroke="#93c5fd"/><path d="M100 104l12 14M114 92l16 8" stroke="#c4b5fd"/></svg>'
    + `<svg class="pick-wheel-svg" viewBox="-116 -116 232 232" role="img"><defs></defs><circle class="pick-wheel-rim" r="111"/><g class="pick-wheel-rot"></g></svg>`
    + '<div class="pick-pointer" aria-hidden="true"><svg viewBox="0 0 44 52"><path d="M6 6.5Q6 2 10.5 2h23Q38 2 38 6.5q0 2-1.2 3.8L25.4 45.2q-3.4 5-6.8 0L7.2 10.3Q6 8.5 6 6.5z"/></svg></div>';
  const hub = document.createElement("button"); hub.type = "button"; hub.className = "pick-hub"; hub.title = "눌러서 돌리기 (Space)"; hub.setAttribute("aria-label", "룰렛 돌리기");
  hub.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="14" cy="16" r="2.3"/><circle cx="26" cy="16" r="2.3"/><path d="M12.5 23.5q7.5 6.5 15 0" fill="none" stroke-width="2.8" stroke-linecap="round"/></svg>';
  wrap.appendChild(hub);
  api.arena.appendChild(wrap);
  const svg = wrap.querySelector(".pick-wheel-svg"), rot = wrap.querySelector(".pick-wheel-rot"), defs = wrap.querySelector("defs"), pointer = wrap.querySelector(".pick-pointer");
  let angle = 0, people = [], signature = null, frame = 0, spinning = false;
  const setAngle = deg => { rot.setAttribute("transform", `rotate(${pickRouletteFixed(deg % 360)})`); };
  const sigOf = list => list.map(person => [person.id, person.name, person.color, person.image ? person.image.dataUrl.length + ":" + person.image.dataUrl.slice(-24) : ""].join("\u0001")).join("\u0002");
  function draw(force){
    const list = api.active(), sig = sigOf(list);
    if (!force && sig === signature) return; signature = sig; people = list;
    const out = pickRouletteSlices(people, uid); defs.innerHTML = out.defs; rot.innerHTML = out.body;
    if (!people.length){ angle = 0; rot.insertAdjacentHTML("beforeend", '<text class="pick-slice-empty-text" y="-38">참가자를 넣어 주세요</text>'); }
    wrap.classList.remove("is-done"); setAngle(angle);
    svg.setAttribute("aria-label", people.length ? `룰렛 — ${people.map(person => person.name || "사진 참가자").join(", ")}` : "빈 룰렛");
  }
  // 판 크기에 맞춰 바퀴 지름을 정한다(정사각형 · 위 바늘 자리만큼 여유).
  const fit = () => { const w = api.arena.clientWidth, h = api.arena.clientHeight; if (!w || !h) return; const size = Math.max(180, Math.min(w - 24, h - 30, 720)); wrap.style.width = size + "px"; wrap.style.height = size + "px"; };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(api.arena);
  const flick = () => { pointer.classList.remove("is-flick"); void pointer.offsetWidth; pointer.classList.add("is-flick"); };
  function finish(index){
    spinning = false; cancelAnimationFrame(frame); frame = 0; angle = ((angle % 360) + 360) % 360; setAngle(angle);
    wrap.classList.remove("is-spinning"); wrap.classList.add("is-done");
    rot.querySelectorAll(".pick-slice").forEach(g => g.classList.toggle("is-win", Number(g.dataset.i) === index));
    api.setBusy(false); api.showResult(people[index], { kicker:"오늘의 주인공" });
  }
  function start(){
    if (spinning) return; draw(); if (people.length < 2) return;
    wrap.classList.remove("is-done"); rot.querySelectorAll(".pick-slice.is-win").forEach(g => g.classList.remove("is-win"));
    const n = people.length, index = pickRandomInt(n), offset = (pickCryptoRandom() - 0.5) * 0.7, m = api.motion();
    spinning = true; api.setBusy(true);
    if (!m){ angle = pickRouletteTarget(angle, index, n, { turns:0, offset }); finish(index); return; }
    const turns = 4 + pickRandomInt(3), from = angle, target = pickRouletteTarget(angle, index, n, { turns, offset }), dur = (4200 + turns * 300) * m;
    let last = pickRouletteIndexAt(from, n); const t0 = performance.now();
    wrap.classList.add("is-spinning");
    const step = now => {
      const p = Math.min(1, (now - t0) / dur); angle = from + (target - from) * pickEaseOut(p); setAngle(angle);
      const at = pickRouletteIndexAt(angle, n); if (at !== last){ last = at; api.sound("tick"); flick(); }
      if (p < 1) frame = requestAnimationFrame(step); else { angle = target; finish(index); }
    };
    frame = requestAnimationFrame(step);
  }
  hub.onclick = () => api.requestStart();
  svg.addEventListener("click", () => api.requestStart());
  fit();
  return {
    render(){ if (!spinning) draw(); },
    canStart:() => api.active().length >= 2,
    start,
    clearResult(){ if (spinning) return; wrap.classList.remove("is-done"); rot.querySelectorAll(".pick-slice.is-win").forEach(g => g.classList.remove("is-win")); },
    dispose(){ cancelAnimationFrame(frame); if (observer) observer.disconnect(); if (spinning) api.setBusy(false); spinning = false; wrap.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.roulette = { mount:mountPickRoulette, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_ROULETTE_R, pickRouletteIndexAt, pickRouletteTarget, pickRouletteLabel, pickRouletteSlices, mountPickRoulette };
}
