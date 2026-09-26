"use strict";

/* ===== 복불복 — 다트 추첨 =====
   룰렛과 같은 칸(12시부터 시계 방향, pickRouletteSlices)으로 나눈 과녁에 다트를 던져, 꽂힌 칸의 사람이 뽑힌다.
   뽑을 사람을 먼저 정하고 그 칸 안의 한 점(가장자리·가운데 과녁은 피해서)을 셈해 다트가 거기로 날아간다(pickDartSpot).
   '던질 준비' 막대는 보여 주기일 뿐 결과와 상관없다. 꽂힌 다트는 판마다 여섯 개까지 남긴다. */
const PICK_DART_MAX = 30;
const PICK_DART_BULL = 16;
/* 칸 index 안의 꽂힐 자리 — 각은 칸 가운데 ± 35%, 반지름은 과녁 가운데 바깥에서 테두리 안쪽까지. { x, y } (판 가운데 0,0, 반지름 100 기준) */
function pickDartSpot(index, count, random=Math.random){
  const s = 360 / count, a = (index + 0.5 + (random() - 0.5) * 0.7) * s * Math.PI / 180;
  const r = PICK_DART_BULL + 12 + random() * (100 - PICK_DART_BULL - 22);
  return { x:Math.sin(a) * r, y:-Math.cos(a) * r };
}
/* 좌표가 어느 칸인지 — 시험과 그림이 같은 셈을 쓴다. */
function pickDartIndexAt(x, y, count){ let deg = Math.atan2(x, -y) * 180 / Math.PI; if (deg < 0) deg += 360; return Math.min(count - 1, Math.floor(deg / (360 / count))); }
function pickDartSvg(){
  return '<g class="pkd-dart-in"><path class="pkd-shaft" d="M0 0L34 20"/><path class="pkd-grip" d="M9 5.3l14 8.2"/><path class="pkd-tip" d="M0 0l7 1.8-2.6 2.8z"/>'
    + '<path class="pkd-flight" d="M30 17.6l14-13 4 11zM30 17.6l4 17 8-10z"/></g>';
}

function mountPickDart(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-dart"), boardWrap = make("div", "pkd-board"), side = make("div", "pkd-side"), card = make("div", "pkd-card"), power = make("div", "pkd-power"), notice = make("div", "pick-game-notice");
  power.innerHTML = '<span>던질 준비</span><div class="pkd-power-bar"><i></i></div>';
  notice.hidden = true; side.append(card); box.append(boardWrap, side, power, notice); api.arena.appendChild(box);
  boardWrap.innerHTML = '<svg class="pkd-svg" viewBox="-122 -122 244 244" role="img" aria-label="다트 판"><defs></defs><circle class="pkd-rim" r="116"/><g class="pkd-slices"></g><g class="pkd-studs"></g>'
    + `<circle class="pkd-bull-out" r="${PICK_DART_BULL}"/><circle class="pkd-bull" r="${PICK_DART_BULL * 0.55}"/><g class="pkd-darts"></g></svg>`;
  const svg = boardWrap.querySelector("svg"), slicesEl = boardWrap.querySelector(".pkd-slices"), defs = boardWrap.querySelector("defs"), studs = boardWrap.querySelector(".pkd-studs"), dartsEl = boardWrap.querySelector(".pkd-darts");
  let people = [], sig = null, frame = 0, flying = false, darts = [], winner = null;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

  function drawBoard(){
    const out = typeof pickRouletteSlices === "function" ? pickRouletteSlices(people, "pkd" + Math.random().toString(36).slice(2, 7)) : { defs:"", body:"" };
    defs.innerHTML = out.defs; slicesEl.innerHTML = out.body;
    const n = people.length; let s = ""; for (let i = 0; i < n; i++){ const a = i * 2 * Math.PI / Math.max(1, n); s += `<circle class="pkd-stud" cx="${(Math.sin(a) * 110).toFixed(1)}" cy="${(-Math.cos(a) * 110).toFixed(1)}" r="3.4"/>`; }
    studs.innerHTML = s; dartsEl.innerHTML = ""; darts = [];
  }
  function renderCard(){
    card.innerHTML = ""; card.classList.toggle("is-win", !!winner);
    if (!winner){ const t = make("span", "pkd-card-hint"); t.textContent = "어디에 꽂힐까요?"; card.appendChild(t); return; }
    const star = make("span", "pkd-card-star"); star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z"/></svg>';
    const text = make("strong"); text.textContent = `${winner.name || "사진 참가자"} 당첨`; card.append(star, text);
  }
  function fit(){
    const w = box.clientWidth, h = box.clientHeight - 60; if (!w || !h) return;
    const wide = w > 700, size = Math.max(220, Math.min(wide ? w - 290 : w - 10, h, 700));
    svg.style.width = svg.style.height = size + "px"; box.classList.toggle("is-narrow", !wide);
  }
  function placeDart(el, x, y, scale){ el.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(3)})`); }
  function start(){
    if (flying || people.length < 2) return;
    const n = people.length, index = pickRandomInt(n), spot = pickDartSpot(index, n, pickCryptoRandom), m = api.motion();
    winner = null; renderCard(); flying = true; api.setBusy(true); power.classList.add("is-frozen");
    slicesEl.querySelectorAll(".pick-slice.is-win").forEach(g => g.classList.remove("is-win")); svg.classList.remove("is-done");
    // 오래된 다트는 흐리게, 여섯 개 넘으면 뺀다.
    darts.forEach(d => d.classList.add("is-old")); while (darts.length >= 6){ const old = darts.shift(); old.remove(); }
    dartsEl.insertAdjacentHTML("beforeend", `<g class="pkd-dart">${pickDartSvg()}</g>`); const el = dartsEl.lastElementChild || dartsEl.children[dartsEl.children.length - 1]; darts.push(el);
    const land = () => {
      placeDart(el, spot.x, spot.y, 1); svg.classList.remove("is-hit"); void svg.getBoundingClientRect(); svg.classList.add("is-hit", "is-done"); api.sound("pop");
      const g = slicesEl.querySelector(`.pick-slice[data-i="${index}"]`); if (g) g.classList.add("is-win");
      later(m ? 450 * m : 0, () => { flying = false; power.classList.remove("is-frozen"); winner = people[index]; renderCard(); api.setBusy(false); api.showResult(people[index], { kicker:"다트가 꽂힌 칸", againLabel:"한 번 더 던지기" }); });
    };
    if (!m){ land(); return; }
    api.sound("roll");
    const t0 = performance.now(), dur = 620 * m, from = { x:150, y:170 };
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = t * (2 - t), x = from.x + (spot.x - from.x) * e, y = from.y + (spot.y - from.y) * e - Math.sin(Math.PI * t) * 40;
      placeDart(el, x, y, 2.4 - 1.4 * e);
      if (t < 1){ frame = requestAnimationFrame(step); return; }
      frame = 0; land();
    };
    frame = requestAnimationFrame(step);
  }
  svg.addEventListener("click", () => api.requestStart());
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(box);
  fit();
  return {
    render(){
      if (flying) return;
      const list = api.active(), tooMany = list.length > PICK_DART_MAX;
      notice.hidden = !tooMany; boardWrap.hidden = tooMany; notice.textContent = tooMany ? `다트 추첨은 ${PICK_DART_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      const next = list.map(p => [p.id, p.name, p.color, p.image ? p.image.dataUrl.length : 0].join("\u0001")).join("\u0002");
      if (next !== sig){ sig = next; people = list; winner = null; drawBoard(); }
      renderCard(); fit();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_DART_MAX; },
    blockReason:() => (api.active().length > PICK_DART_MAX ? `다트 추첨은 ${PICK_DART_MAX}명까지예요.` : ""),
    start,
    clearResult(){ if (!flying){ svg.classList.remove("is-done"); slicesEl.querySelectorAll(".pick-slice.is-win").forEach(g => g.classList.remove("is-win")); } },
    dispose(){ cancelAnimationFrame(frame); timers.forEach(clearTimeout); timers.clear(); if (flying) api.setBusy(false); flying = false; if (observer) observer.disconnect(); box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.dart = { mount:mountPickDart, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_DART_MAX, PICK_DART_BULL, pickDartSpot, pickDartIndexAt, mountPickDart };
}
