"use strict";

/* ===== 복불복 — 슬롯 추첨 =====
   릴 3개가 참가자 얼굴을 돌리다가 왼쪽부터 차례로 멈추고, 셋 모두 가운데 줄에 같은 사람이 서면 그 사람이 뽑힌다.
   당첨자는 먼저 뽑는다(pickRandomInt). 릴마다 띠(pickSlotStrip)를 '지금 보이는 세 칸 + 무작위 채움 + 당첨자를 가운데로 한 세 칸'으로
   만들고, 띠를 끝 칸까지 굴린다 — 늦게 멈추는 릴일수록 채움이 길어 같은 속도로 더 오래 돈다. 멈출 때 살짝 지나쳤다 되돌아온다(easeOutBack). */
const PICK_SLOT_REELS = 3;
function pickSlotRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
function pickSlotAny(people, avoid, random){
  if (people.length <= 1) return people[0];
  let p; do { p = people[Math.min(people.length - 1, Math.floor(random() * people.length))]; } while (p === avoid);
  return p;
}
/* 띠 — cells[0..2] 는 지금 보이는 세 칸, cells[target] 가 당첨자(가운데 줄), 맨 끝은 target+1. 이웃 칸엔 같은 사람이 붙지 않는다(두 명 이상일 때). */
function pickSlotStrip(people, winner, current, fill, random=pickSlotRandom){
  const cells = current.slice(0, 3);
  while (cells.length < 3) cells.push(pickSlotAny(people, cells[cells.length - 1], random));
  for (let i = 0; i < fill; i++) cells.push(pickSlotAny(people, cells[cells.length - 1], random));
  const before = pickSlotAny(people.length > 2 ? people.filter(p => p !== winner) : people, cells[cells.length - 1], random);
  cells.push(before === winner && people.length > 1 ? pickSlotAny(people, winner, random) : before);
  cells.push(winner);
  cells.push(pickSlotAny(people, winner, random));
  return { cells, target:cells.length - 2 };
}
function pickSlotEase(t){ const c1 = 1.25, c3 = c1 + 1, x = Math.max(0, Math.min(1, t)); return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

function mountPickSlot(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const machine = make("div", "pick-slot"), topBar = make("div", "pick-slot-top"), plate = make("div", "pick-slot-plate"), windowEl = make("div", "pick-slot-window"), payline = make("div", "pick-slot-payline");
  const lights = n => { const row = make("span", "pick-slot-lights"); for (let i = 0; i < n; i++) row.appendChild(make("i")); return row; };
  topBar.append(lights(2), plate, lights(2));
  const reels = [];
  for (let r = 0; r < PICK_SLOT_REELS; r++){ const reel = make("div", "pick-slot-reel"), strip = make("div", "pick-slot-strip"); reel.appendChild(strip); windowEl.appendChild(reel); reels.push({ reel, strip, cells:[], current:[] }); }
  windowEl.appendChild(payline);
  const sideL = make("span", "pick-slot-side is-left"), sideR = make("span", "pick-slot-side is-right"); sideL.appendChild(lights(4)); sideR.appendChild(lights(4));
  const knobL = make("span", "pick-slot-knob is-left"), knobR = make("span", "pick-slot-knob is-right");
  machine.append(knobL, knobR, topBar, sideL, windowEl, sideR);
  api.arena.appendChild(machine);
  let people = [], sig = null, frame = 0, spinning = false, cell = 100;

  const cellEl = person => {
    const el = make("div", "pick-slot-cell");
    if (person){ el.style.setProperty("--pk-c", person.color); const name = make("span", "pick-slot-name"); name.textContent = person.name || "사진"; el.append(typeof pickAvatar === "function" ? pickAvatar(person, "pick-slot-face") : make("span"), name); }
    return el;
  };
  function fillStrip(reel, cells){ reel.strip.innerHTML = ""; reel.cells = cells; cells.forEach(person => reel.strip.appendChild(cellEl(person))); reel.strip.style.transform = "translateY(0px)"; }
  function idle(){
    reels.forEach(reel => {
      const keep = reel.current.length === 3 && reel.current.every(p => people.includes(p));
      if (!keep){ const a = pickSlotAny(people, null, pickSlotRandom), b = pickSlotAny(people, a, pickSlotRandom), c = pickSlotAny(people, b, pickSlotRandom); reel.current = people.length ? [a, b, c] : []; }
      fillStrip(reel, reel.current);
    });
  }
  function fit(){
    const w = api.arena.clientWidth, h = api.arena.clientHeight; if (!w || !h) return;
    const width = Math.max(300, Math.min(w - 90, 900, (h - 20) * 1.45)), c = Math.max(54, Math.min((h - width * 0.17 - 96) / 3, width * 0.2));
    cell = Math.round(c); machine.style.width = Math.round(width) + "px"; machine.style.setProperty("--pk-cell", cell + "px");
  }
  function start(){
    if (spinning || people.length < 2) return;
    machine.classList.remove("is-win"); const winner = people[pickRandomInt(people.length)], m = api.motion();
    const plans = reels.map((reel, r) => pickSlotStrip(people, winner, reel.current, 14 + r * 7));
    if (!m){ reels.forEach((reel, r) => { const cells = plans[r].cells; reel.current = [cells[plans[r].target - 1], winner, cells[plans[r].target + 1]]; fillStrip(reel, reel.current); }); done(winner); return; }
    spinning = true; api.setBusy(true); machine.classList.add("is-spinning");
    const t0 = performance.now(), runs = reels.map((reel, r) => { fillStrip(reel, plans[r].cells); return { reel, plan:plans[r], dist:(plans[r].target - 1) * cell, dur:(1500 + r * 750) * m, stopped:false, last:0 }; });
    let lastTick = 0;
    const step = now => {
      let moving = 0;
      runs.forEach(run => {
        if (run.stopped) return;
        const t = Math.min(1, (now - t0) / run.dur), y = run.dist * pickSlotEase(t);
        run.reel.strip.style.transform = `translateY(${-y}px)`;
        const at = Math.floor(y / cell); if (at !== run.last){ run.last = at; if (now - lastTick > 45){ lastTick = now; api.sound("tick"); } }
        if (t >= 1){ run.stopped = true; api.sound("pop"); run.reel.reel.classList.remove("is-stopped"); void run.reel.reel.offsetWidth; run.reel.reel.classList.add("is-stopped"); }
        else moving++;
      });
      if (moving){ frame = requestAnimationFrame(step); return; }
      frame = 0; runs.forEach(run => { const cells = run.plan.cells, t = run.plan.target; run.reel.current = [cells[t - 1], cells[t], cells[t + 1]]; fillStrip(run.reel, run.reel.current); });
      spinning = false; machine.classList.remove("is-spinning"); api.setBusy(false); done(winner);
    };
    frame = requestAnimationFrame(step);
  }
  function done(winner){ machine.classList.add("is-win"); api.showResult(winner, { kicker:"오늘의 주인공" }); }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null; if (observer) observer.observe(api.arena);
  fit();
  return {
    render(){
      plate.textContent = String(api.model.title || "").trim() || "오늘은 누가?";
      if (spinning) return;
      const list = api.active(), next = list.map(p => [p.id, p.name, p.color, p.image ? p.image.dataUrl.length : 0].join("\u0001")).join("\u0002");
      if (next !== sig){ sig = next; people = list; reels.forEach(reel => { reel.current = reel.current.map(p => p && list.find(q => q.id === p.id)).filter(Boolean); }); machine.classList.remove("is-win"); }
      idle();
    },
    canStart:() => api.active().length >= 2,
    start,
    clearResult(){ if (!spinning) machine.classList.remove("is-win"); },
    dispose(){ cancelAnimationFrame(frame); if (spinning) api.setBusy(false); spinning = false; if (observer) observer.disconnect(); machine.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.slot = { mount:mountPickSlot, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_SLOT_REELS, pickSlotStrip, pickSlotEase, mountPickSlot };
}
