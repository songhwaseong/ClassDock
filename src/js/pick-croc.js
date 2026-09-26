"use strict";

/* ===== 복불복 — 악어 이빨 누르기 =====
   악어 아래턱 이빨 가운데 하나가 '물리는 이빨'이다. 명단 차례대로 한 사람씩 이빨을 누르고, 그 이빨을 누른 사람에게서 입이 콱 닫힌다.
   물리는 이빨은 판을 시작할 때 무작위로 정한다. 이빨 수는 기본이 사람 수(4~16개) — 한 사람이 한 번씩만 누르게 되어 누구나 1/n 로 같다.
   이빨 수를 사람보다 많게 두면 차례가 돌아 앞사람이 더 누르게 된다(놀이로서는 그래도 된다). 진행 상태는 화면에만. */
const PICK_CROC_MIN = 4, PICK_CROC_MAX = 16;
function pickCrocNormalize(raw){
  const v = raw && typeof raw === "object" ? raw : {}, n = Math.round(Number(v.teeth));
  return { teeth:v.teeth === "auto" || v.teeth == null || !Number.isFinite(n) ? "auto" : Math.max(PICK_CROC_MIN, Math.min(PICK_CROC_MAX, n)), turns:v.turns === "random" ? "random" : "list" };
}
function pickCrocTeethCount(settings, people){ const s = pickCrocNormalize(settings); return s.teeth === "auto" ? Math.max(PICK_CROC_MIN, Math.min(PICK_CROC_MAX, people)) : s.teeth; }
/* 아래턱 이빨 자리 — 잇몸 타원 아래 반쪽을 따라 왼쪽 위에서 오른쪽 위까지. { x, y, rot } */
function pickCrocTeeth(n){
  // 각 a 는 3시에서 시계 방향(화면 기준): 168°(왼쪽) → 90°(맨 아래) → 12°(오른쪽). 이빨 끝은 입 가운데를 향하되 반만 기울인다.
  const cx = 300, cy = 312, rx = 172, ry = 118, out = [];
  for (let i = 0; i < n; i++){
    const deg = 168 - 156 * (n === 1 ? 0.5 : i / (n - 1)), a = deg * Math.PI / 180;
    out.push({ x:cx + Math.cos(a) * rx, y:cy + Math.sin(a) * ry, rot:(deg - 90) * 0.6 });
  }
  // 이빨이 많으면 서로 겹치지 않게 줄인다(이빨 폭 38 기준).
  const gap = n > 1 ? Math.min(...out.slice(1).map((t, i) => Math.hypot(t.x - out[i].x, t.y - out[i].y))) : 60, scale = Math.min(1, gap * 0.88 / 38);
  out.forEach(t => { t.scale = scale; });
  return out;
}

function mountPickCroc(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-croc"), turnBar = make("div", "pkr-turn"), stageEl = make("div", "pkr-stage");
  box.append(stageEl, turnBar); api.arena.appendChild(box);
  let people = [], order = [], sig = null, teeth = [], trap = -1, pressed = new Set(), turn = 0, phase = "playing", loser = null;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const settings = () => api.settings();

  function svgFor(){
    const upperTeeth = Array.from({ length:9 }, (_, i) => { const x = 150 + i * 37.5; return `<path d="M${x - 16} 214q16 30 32 0z"/>`; }).join("");
    const lower = teeth.map((t, i) => `<g transform="translate(${t.x.toFixed(1)} ${t.y.toFixed(1)}) rotate(${t.rot.toFixed(1)}) scale(${t.scale.toFixed(3)})"><g class="pkr-tooth${pressed.has(i) ? " is-down" : ""}${phase === "done" && i === trap ? " is-trap" : ""}" data-i="${i}" role="button" tabindex="0" aria-label="${i + 1}번 이빨"><rect x="-19" y="-24" width="38" height="44" rx="12"/><rect class="pkr-tooth-shine" x="-12" y="-18" width="10" height="16" rx="5"/></g></g>`).join("");
    return '<svg class="pkr-svg" viewBox="0 0 600 520" role="img" aria-label="악어 입">'
      + '<ellipse class="pkr-shadow" cx="300" cy="500" rx="240" ry="16"/>'
      + '<g class="pkr-arm"><ellipse cx="72" cy="330" rx="52" ry="40"/><ellipse class="pkr-claw" cx="40" cy="352" rx="11" ry="15"/><ellipse class="pkr-claw" cx="62" cy="360" rx="11" ry="15"/></g>'
      + '<g class="pkr-arm"><ellipse cx="528" cy="330" rx="52" ry="40"/><ellipse class="pkr-claw" cx="560" cy="352" rx="11" ry="15"/><ellipse class="pkr-claw" cx="538" cy="360" rx="11" ry="15"/></g>'
      + '<path class="pkr-jaw" d="M78 262q0 230 222 230t222-230q0-40-40-40H118q-40 0-40 40z"/>'
      + '<path class="pkr-gum" d="M104 268q0 196 196 196t196-196q0-20-20-20H124q-20 0-20 20z"/>'
      + '<ellipse class="pkr-tongue" cx="300" cy="316" rx="120" ry="70"/><path class="pkr-tongue-line" d="M300 262v96"/>'
      + `<g class="pkr-teeth">${lower}</g>`
      + '<g class="pkr-upper"><path class="pkr-head" d="M92 226q-10-120 70-150 20-60 70-60t58 44h20q8-44 58-44t70 60q80 30 70 150z"/><path class="pkr-mouth-roof" d="M112 226q0-26 26-26h324q26 0 26 26z"/>'
      + `<g class="pkr-upper-teeth">${upperTeeth}</g>`
      + '<ellipse class="pkr-nostril" cx="262" cy="118" rx="12" ry="8"/><ellipse class="pkr-nostril" cx="338" cy="118" rx="12" ry="8"/>'
      + '<g class="pkr-eye"><ellipse cx="206" cy="60" rx="40" ry="38"/><circle class="pkr-pupil" cx="214" cy="66" r="16"/><circle class="pkr-eye-shine" cx="220" cy="58" r="5"/></g>'
      + '<g class="pkr-eye"><ellipse cx="394" cy="60" rx="40" ry="38"/><circle class="pkr-pupil" cx="386" cy="66" r="16"/><circle class="pkr-eye-shine" cx="392" cy="58" r="5"/></g></g></svg>';
  }
  function draw(){ stageEl.innerHTML = svgFor(); stageEl.querySelector(".pkr-svg").classList.toggle("is-snapped", phase === "done"); }
  function renderTurn(){
    turnBar.innerHTML = "";
    if (phase === "done"){ const t = make("strong"); t.textContent = loser ? `앙! ${loser.name || "사진 참가자"}에게서 물었어요` : "끝"; turnBar.appendChild(t); return; }
    const person = order[turn]; if (!person) return;
    const chip = make("span", "pkr-chip"), dot = make("i"), name = make("strong"); dot.style.setProperty("--pk-c", person.color); name.textContent = `${person.name || "사진 참가자"} 차례`; chip.append(dot, name);
    const hint = make("span", "pkr-hint"); hint.textContent = `이빨을 하나 눌러보세요 · 남은 이빨 ${teeth.length - pressed.size}개`;
    turnBar.append(chip, hint);
  }
  function reset(){
    people = api.active(); const n = pickCrocTeethCount(settings(), people.length);
    teeth = pickCrocTeeth(n); trap = pickRandomInt(n); pressed = new Set(); turn = 0; phase = "playing"; loser = null;
    order = settings().turns === "random" && typeof pickShuffle === "function" ? pickShuffle(people) : people.slice();
    api.refresh();
  }
  function press(i){
    if (phase !== "playing" || pressed.has(i) || api.isBusy() || i < 0 || i >= teeth.length) return;
    const person = order[turn]; if (!person) return;
    api.hideResult(); pressed.add(i); const m = api.motion();
    const tooth = stageEl.querySelector(`.pkr-tooth[data-i="${i}"]`); if (tooth) tooth.classList.add("is-down");
    api.sound("tick"); api.setBusy(true);
    later(m ? 380 * m : 0, () => {
      if (i === trap){
        phase = "done"; loser = person; const svg = stageEl.querySelector(".pkr-svg"); if (svg) svg.classList.add("is-snapped"); if (tooth) tooth.classList.add("is-trap");
        api.sound("snap"); renderTurn(); api.refresh();
        later(m ? 700 * m : 0, () => { api.setBusy(false); api.showResult(person, { kicker:"앙! 악어가 물었어요", againLabel:"다시 시작" }); });
        return;
      }
      turn = (turn + 1) % Math.max(1, order.length); api.setBusy(false); renderTurn();
    });
  }
  stageEl.addEventListener("click", event => { const tooth = event.target.closest(".pkr-tooth"); if (tooth) press(Number(tooth.dataset.i)); });
  stageEl.addEventListener("keydown", event => { const tooth = event.target.closest && event.target.closest(".pkr-tooth"); if (tooth && (event.key === "Enter" || event.key === " ")){ event.preventDefault(); event.stopPropagation(); press(Number(tooth.dataset.i)); } });
  return {
    render(){
      if (api.isBusy()) return;
      const list = api.active(), next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002") + "\u0003" + JSON.stringify(settings());
      if (next !== sig){ sig = next; reset(); }
      draw(); renderTurn();
    },
    canStart:() => api.active().length >= 2,
    start(){ if (api.isBusy()) return; reset(); draw(); renderTurn(); api.sound("pop"); },
    goLabel:() => (phase === "done" ? "다시 시작" : pressed.size ? "처음부터" : ""),
    menuItems:() => { const s = settings(); return [
      { label:"이빨 수", icon:"list", children:[["auto", "사람 수만큼 (공평)"], ...[6, 8, 10, 12, 14, 16].map(n => [n, `${n}개`])].map(([id, label]) => ({ label, active:s.teeth === id, action:() => api.setSettings({ teeth:id }) })) },
      { label:"차례", icon:"list", children:[["list", "명단 차례대로"], ["random", "차례 섞기"]].map(([id, label]) => ({ label, active:s.turns === id, action:() => api.setSettings({ turns:id }) })) }
    ]; },
    dispose(){ timers.forEach(clearTimeout); timers.clear(); if (api.isBusy()) api.setBusy(false); box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.croc = { mount:mountPickCroc, normalize:pickCrocNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_CROC_MIN, PICK_CROC_MAX, pickCrocNormalize, pickCrocTeethCount, pickCrocTeeth, mountPickCroc };
}
