"use strict";

/* ===== 복불복 — 스크래치 뽑기 =====
   참가자마다 자기 색 테두리의 카드가 한 장씩 있고, 은색 막을 긁으면 '당첨' 또는 '다음 기회에'가 보인다.
   당첨 카드 k 장은 섞을 때(pickScratchDeal) 정한다. 마우스·손가락으로 긁고(canvas 지우기), 그냥 한 번 누르면 저절로 긁힌다.
   긁은 자리는 0~1 좌표 선으로 기억해(창 크기가 바뀌면 다시 그림) 16×16 칸 가운데 55% 넘게 긁히면 막이 걷힌다(pickScratchCover).
   당첨 카드가 다 나오면 끝 — 나머지 카드도 열린다. 진행 상태는 화면에만. */
const PICK_SCRATCH_MAX = 24;
const PICK_SCRATCH_GRID = 16;
const PICK_SCRATCH_DECOS = ["heart", "flower", "star", "cloud", "flower2", "star2"];
function pickScratchInt(value, min, max, fallback){ const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function pickScratchWord(value, max, fallback){ return String(value == null ? "" : value).trim().slice(0, max) || fallback; }
function pickScratchNormalize(raw){
  const v = raw && typeof raw === "object" ? raw : {};
  return { winners:pickScratchInt(v.winners, 1, PICK_SCRATCH_MAX - 1, 1), winLabel:pickScratchWord(v.winLabel, 12, "당첨"), loseLabel:pickScratchWord(v.loseLabel, 12, "다음 기회에") };
}
function pickScratchRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
function pickScratchDeal(count, winners, random=pickScratchRandom){
  const k = Math.max(1, Math.min(winners, count - 1)), deck = Array.from({ length:count }, (_, i) => i < k);
  for (let i = deck.length - 1; i > 0; i--){ const j = Math.min(i, Math.floor(random() * (i + 1))); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
/* 긁은 자리 칸 표시 — 선분(0~1 좌표)을 따라 붓 반지름(0~1) 안의 칸을 채운다. 돌려주는 값은 채운 칸 비율. */
function pickScratchCover(grid, a, b, radius){
  const N = PICK_SCRATCH_GRID, steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (radius * 0.5)));
  for (let s = 0; s <= steps; s++){
    const x = a[0] + (b[0] - a[0]) * s / steps, y = a[1] + (b[1] - a[1]) * s / steps;
    for (let gy = Math.max(0, Math.floor((y - radius) * N)); gy <= Math.min(N - 1, Math.floor((y + radius) * N)); gy++)
      for (let gx = Math.max(0, Math.floor((x - radius) * N)); gx <= Math.min(N - 1, Math.floor((x + radius) * N)); gx++)
        if (Math.hypot((gx + 0.5) / N - x, (gy + 0.5) / N - y) <= radius) grid[gy * N + gx] = 1;
  }
  let on = 0; for (let i = 0; i < grid.length; i++) on += grid[i]; return on / grid.length;
}
/* 저절로 긁기 — 위에서 아래로 지그재그 선(0~1 좌표). */
function pickScratchAutoPath(rows){ const pts = []; for (let r = 0; r < rows; r++){ const y = (r + 0.5) / rows; pts.push(r % 2 ? [0.94, y] : [0.06, y], r % 2 ? [0.06, y] : [0.94, y]); } return pts; }
function pickScratchDecoSvg(kind){
  const paths = {
    heart:'<path d="M12 21s-8-5.3-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.7-8 11-8 11z" fill="#ff7b86"/>',
    flower:'<g fill="#5fcf8f"><circle cx="12" cy="6" r="4.2"/><circle cx="18" cy="11" r="4.2"/><circle cx="15.5" cy="18" r="4.2"/><circle cx="8.5" cy="18" r="4.2"/><circle cx="6" cy="11" r="4.2"/></g><circle cx="12" cy="12.5" r="3" fill="#fff"/>',
    star:'<path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z" fill="#ffd45c"/>',
    cloud:'<path d="M7 19a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 19z" fill="#dff0ff" stroke="#b9dcff"/>',
    flower2:'<g fill="#b69cf5"><circle cx="12" cy="6.5" r="4"/><circle cx="17.5" cy="11" r="4"/><circle cx="15" cy="17.5" r="4"/><circle cx="9" cy="17.5" r="4"/><circle cx="6.5" cy="11" r="4"/></g><circle cx="12" cy="12.5" r="2.6" fill="#fff"/>',
    star2:'<path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z" fill="#ffb86b"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || ""}</svg>`;
}

function mountPickScratch(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-scratch"), tools = make("div", "pick-game-tools"), area = make("div", "pick-scratch-area"), grid = make("div", "pick-scratch-grid"), notice = make("div", "pick-game-notice");
  notice.hidden = true; area.appendChild(grid); box.append(tools, area, notice); api.arena.appendChild(box);
  let people = [], sig = null, cards = [], found = [], phase = "playing", plan = 1, auto = null;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const settings = () => api.settings();
  const STAR = '<svg class="pks-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z"/></svg>';

  function deal(){
    const s = settings(); plan = Math.max(1, Math.min(s.winners, people.length - 1));
    const deck = pickScratchDeal(people.length, plan);
    cards = people.map((person, i) => ({ person, win:deck[i], strokes:[], grid:new Uint8Array(PICK_SCRATCH_GRID * PICK_SCRATCH_GRID), open:false, el:null, canvas:null }));
    found = []; phase = "playing";
  }
  function renderTools(){
    const s = settings(); tools.innerHTML = "";
    const chip = make("span", "pick-chip"), minus = make("button", "pick-chip-btn"), plus = make("button", "pick-chip-btn"), b = make("b");
    minus.type = plus.type = "button"; minus.textContent = "−"; plus.textContent = "+"; b.textContent = String(plan);
    minus.disabled = plan <= 1; plus.disabled = plan >= Math.max(1, people.length - 1);
    minus.onclick = () => { if (!api.isBusy()) api.setSettings({ winners:plan - 1 }); }; plus.onclick = () => { if (!api.isBusy()) api.setSettings({ winners:plan + 1 }); };
    chip.append(document.createTextNode(s.winLabel + " "), minus, b, plus, document.createTextNode("장"));
    const status = make("span", "pick-chip"); status.textContent = `찾음 ${found.length}/${plan}`;
    const all = make("button", "pick-chip-btn is-wide"); all.type = "button"; all.textContent = "모두 긁기"; all.disabled = phase !== "playing"; all.onclick = revealAll;
    tools.append(chip, status, all);
  }
  function paintCover(card){
    const canvas = card.canvas; if (!canvas) return;
    const w = canvas.clientWidth || canvas.parentNode.clientWidth, h = canvas.clientHeight || canvas.parentNode.clientHeight; if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = "source-over";
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#d4d3e0"); g.addColorStop(0.5, "#b9b7cc"); g.addColorStop(1, "#d9d8e5"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    let seed = card.person.id.length * 97 + 13; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < Math.round(w * h / 90); i++){ ctx.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,.35)" : "rgba(90,86,120,.12)"; ctx.fillRect(rnd() * w, rnd() * h, 1.4, 1.4); }
    const sparkle = (cx, cy, s) => { ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.quadraticCurveTo(cx, cy, cx + s, cy); ctx.quadraticCurveTo(cx, cy, cx, cy + s); ctx.quadraticCurveTo(cx, cy, cx - s, cy); ctx.quadraticCurveTo(cx, cy, cx, cy - s); ctx.fill(); };
    ctx.fillStyle = "rgba(255,255,255,.75)"; sparkle(w * 0.46, h * 0.5, Math.min(w, h) * 0.16); sparkle(w * 0.64, h * 0.34, Math.min(w, h) * 0.07); sparkle(w * 0.34, h * 0.66, Math.min(w, h) * 0.06);
    ctx.globalCompositeOperation = "destination-out"; ctx.lineCap = ctx.lineJoin = "round"; ctx.lineWidth = Math.min(w, h) * 0.2;
    card.strokes.forEach(stroke => { ctx.beginPath(); stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h))); if (stroke.length === 1) ctx.lineTo(stroke[0][0] * w + 0.1, stroke[0][1] * h); ctx.stroke(); });
  }
  function drawSegment(card, a, b){
    const canvas = card.canvas, w = canvas.clientWidth || canvas.parentNode.clientWidth, h = canvas.clientHeight || canvas.parentNode.clientHeight, ctx = canvas.getContext("2d"); if (!ctx || !w || !h) return;
    ctx.globalCompositeOperation = "destination-out"; ctx.lineCap = "round"; ctx.lineWidth = Math.min(w, h) * 0.2;
    ctx.beginPath(); ctx.moveTo(a[0] * w, a[1] * h); ctx.lineTo(b[0] * w + 0.1, b[1] * h); ctx.stroke();
  }
  function scratch(card, a, b){
    if (card.open || phase !== "playing") return;
    drawSegment(card, a, b);
    const ratio = pickScratchCover(card.grid, a, b, 0.1 * Math.min(1, (card.canvas.clientHeight || 1) / (card.canvas.clientWidth || 1)) + 0.02);
    if (ratio >= 0.55) reveal(card);
  }
  function reveal(card, quiet){
    if (card.open) return; card.open = true; if (card.el) card.el.classList.add("is-open");
    if (quiet) return;
    if (card.win){ found.push(card.person); api.sound("tick"); } else api.sound("pop");
    renderTools();
    if (found.length >= plan){
      phase = "done"; cards.forEach(c => { if (!c.open){ c.open = true; if (c.el) c.el.classList.add("is-open", "is-rest"); } }); renderTools();
      const s = settings(); later(500 * Math.max(0.2, api.motion() || 0.2), () => api.showResult(found.slice(), { kicker:found.length > 1 ? `${s.winLabel} ${found.length}명` : `${s.winLabel}!`, againLabel:"새로 섞기" }));
    }
  }
  function autoScratch(card){
    if (card.open || phase !== "playing" || auto) return;
    const m = api.motion(), pts = pickScratchAutoPath(6);
    if (!m){ reveal(card); return; }
    auto = card; let i = 1; card.strokes.push([pts[0]]);
    const step = () => {
      if (card.open || i >= pts.length){ auto = null; if (!card.open) reveal(card); return; }
      const a = pts[i - 1], b = pts[i]; card.strokes[card.strokes.length - 1].push(b); scratch(card, a, b); i++;
      if (!card.open) later(70 * m, step); else auto = null;
    };
    api.sound("roll"); step();
  }
  function renderGrid(){
    grid.innerHTML = ""; const s = settings();
    cards.forEach((card, i) => {
      const el = make("div", "pks-card"); el.style.setProperty("--pk-c", card.person.color); el.dataset.i = String(i);
      const inner = make("div", "pks-inner"), prize = make("div", "pks-prize" + (card.win ? " is-win" : "")), label = make("b"); label.textContent = card.win ? s.winLabel : s.loseLabel;
      if (card.win) prize.innerHTML = STAR; prize.appendChild(label);
      const canvas = make("canvas", "pks-cover"); canvas.setAttribute("aria-label", `${card.person.name || "사진"} 카드 긁기 — 한 번 누르면 저절로 긁혀요`); canvas.tabIndex = 0;
      inner.append(prize, canvas);
      const deco = make("span", "pks-deco is-" + (i % 4)); deco.innerHTML = pickScratchDecoSvg(PICK_SCRATCH_DECOS[i % PICK_SCRATCH_DECOS.length]);
      const name = make("span", "pks-name"); name.textContent = card.person.name || "사진";
      el.append(inner, deco, name); if (card.open) el.classList.add("is-open"); if (phase === "done" && !card.win) el.classList.add("is-rest");
      card.el = el; card.canvas = canvas; grid.appendChild(el); bindCanvas(card);
    });
    fit();
  }
  function bindCanvas(card){
    const canvas = card.canvas; let down = null;
    const at = event => { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(1, (event.clientX - r.left) / (r.width || 1))), Math.max(0, Math.min(1, (event.clientY - r.top) / (r.height || 1)))]; };
    canvas.addEventListener("pointerdown", event => {
      if (card.open || phase !== "playing" || api.isBusy()) return; event.preventDefault();
      if (typeof canvas.setPointerCapture === "function" && event.pointerId != null){ try { canvas.setPointerCapture(event.pointerId); } catch(_){} }
      const p = at(event); down = { p, last:p, moved:0, t:performance.now() }; card.strokes.push([p]); api.hideResult();
    });
    canvas.addEventListener("pointermove", event => {
      if (!down) return; const p = at(event); down.moved += Math.hypot(p[0] - down.last[0], p[1] - down.last[1]);
      card.strokes[card.strokes.length - 1].push(p); scratch(card, down.last, p); down.last = p;
    });
    const up = () => { if (!down) return; const tap = down.moved < 0.04; down = null; if (tap && !card.open){ card.strokes.pop(); autoScratch(card); } };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", () => { down = null; });
    canvas.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " "){ event.preventDefault(); event.stopPropagation(); autoScratch(card); } });
  }
  function fit(){
    const w = area.clientWidth, h = area.clientHeight; if (!w || !h || !cards.length) return;
    const n = cards.length, gap = Math.max(10, Math.min(26, w / 40)); let best = { cols:1, cw:0 };
    for (let cols = 1; cols <= n; cols++){ const rows = Math.ceil(n / cols), cw = Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * 1.12, 320); if (cw > best.cw) best = { cols, cw }; }
    grid.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(best.cw)}px)`; grid.style.setProperty("--pks-w", Math.floor(best.cw) + "px"); grid.style.setProperty("--pks-h", Math.floor(best.cw / 1.12) + "px"); grid.style.gap = gap + "px";
    cards.forEach(paintCover);
  }
  function revealAll(){
    if (phase !== "playing" || api.isBusy()) return;
    const closed = cards.filter(c => !c.open); let k = 0;
    const next = () => { if (phase !== "playing" || k >= closed.length) return; reveal(closed[k++]); later(260 * Math.max(0.2, api.motion() || 0.2), next); };
    next();
  }
  function start(){
    if (api.isBusy() || people.length < 2) return;
    const m = api.motion(); api.setBusy(true); grid.classList.add("is-shuffling"); api.sound("roll");
    later(m ? 380 * m : 0, () => { deal(); renderTools(); renderGrid(); grid.classList.remove("is-shuffling"); api.setBusy(false); });
  }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(area);
  return {
    render(){
      if (api.isBusy()) return;
      const list = api.active(), tooMany = list.length > PICK_SCRATCH_MAX;
      notice.hidden = !tooMany; area.hidden = tooMany; notice.textContent = tooMany ? `스크래치 뽑기는 ${PICK_SCRATCH_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      const next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002") + "\u0003" + JSON.stringify(settings());
      if (next !== sig){ sig = next; people = list; deal(); renderGrid(); }
      renderTools();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_SCRATCH_MAX; },
    blockReason:() => (api.active().length > PICK_SCRATCH_MAX ? `스크래치 뽑기는 ${PICK_SCRATCH_MAX}명까지예요.` : ""),
    start,
    menuItems:() => [
      { label:"카드 글 고치기…", icon:"pen", action:openWords },
      { label:"모두 긁기", icon:"check", disabled:phase !== "playing", action:revealAll }
    ],
    dispose(){ timers.forEach(clearTimeout); timers.clear(); if (api.isBusy()) api.setBusy(false); if (observer) observer.disconnect(); box.remove(); }
  };
  function openWords(){
    if (api.isBusy() || typeof tierModal !== "function") return;
    const s = settings(), form = make("div", "tier-form");
    form.innerHTML = '<label class="wide"><span>당첨 카드 글</span><input class="ps-win" maxlength="12"></label><label class="wide"><span>나머지 카드 글</span><input class="ps-lose" maxlength="12"></label>'
      + '<footer class="wide"><span></span><button type="button" class="ps-cancel">취소</button><button type="button" class="ps-save primary">확인</button></footer>';
    const ui = tierModal("스크래치 카드 글", form); form.querySelector(".ps-win").value = s.winLabel; form.querySelector(".ps-lose").value = s.loseLabel;
    form.querySelector(".ps-cancel").onclick = ui.dispose;
    form.querySelector(".ps-save").onclick = () => { ui.dispose(); api.setSettings({ winLabel:form.querySelector(".ps-win").value, loseLabel:form.querySelector(".ps-lose").value }); };
  }
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.scratch = { mount:mountPickScratch, normalize:pickScratchNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_SCRATCH_MAX, PICK_SCRATCH_GRID, pickScratchNormalize, pickScratchDeal, pickScratchCover, pickScratchAutoPath, mountPickScratch };
}
