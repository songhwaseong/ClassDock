"use strict";

/* ===== 복불복 — 동전 던지기 =====
   참가자를 앞면 편·뒷면 편으로 나누고(처음엔 무작위 반반, 이름을 누르면 편을 옮김) 동전을 던져 나온 면의 편이 모두 당첨.
   나올 면은 먼저 정하고(pickRandomInt(2)) 동전은 그 면으로 떨어지도록 도는 바퀴 수를 셈한다(pickCoinSpin — 앞면 = 360의 배수, 뒷면 = +180).
   편 나누기는 화면에만(파일엔 안 담음). */
const PICK_COIN_SIDES = [{ id:0, label:"앞면", icon:"star" }, { id:1, label:"뒷면", icon:"moon" }];
function pickCoinSpin(current, side, turns){ const base = Math.ceil(current / 360) * 360 + Math.max(1, turns) * 360; return base + (side ? 180 : 0); }
function pickCoinSideAt(deg){ const a = ((deg % 360) + 360) % 360; return a > 90 && a < 270 ? 1 : 0; }
/* 무작위 반반 — 사람 수가 홀수면 한 편이 한 명 더. Map(id → 0|1) */
function pickCoinSplit(people, random=Math.random){
  const ids = people.map(p => p.id); for (let i = ids.length - 1; i > 0; i--){ const j = Math.min(i, Math.floor(random() * (i + 1))); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return new Map(ids.map((id, i) => [id, i % 2]));
}
const PICK_COIN_ICONS = {
  star:'<path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  moon:'<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.4A7 7 0 0 1 15.5 3.5z"/>'
};
function pickCoinFace(icon){ return `<svg viewBox="0 0 24 24" aria-hidden="true">${PICK_COIN_ICONS[icon] || ""}</svg>`; }

function mountPickCoin(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-coin"), stageEl = make("div", "pkn-stage"), toss = make("div", "pkn-toss"), coin = make("div", "pkn-coin"), pedestal = make("div", "pkn-pedestal"), result = make("div", "pkn-result"), hint = make("div", "pkn-hint"), sides = make("div", "pkn-sides"), tools = make("div", "pick-game-tools");
  coin.innerHTML = `<span class="pkn-face is-front">${pickCoinFace("star")}</span><span class="pkn-face is-back">${pickCoinFace("moon")}</span>`;
  const swoosh = make("span", "pkn-swoosh"); swoosh.innerHTML = '<svg viewBox="0 0 60 100" aria-hidden="true"><path d="M14 90q40-24 26-74"/><path d="M28 22l12-8 4 14"/></svg>';
  toss.appendChild(coin); stageEl.append(toss, swoosh, pedestal); result.hidden = true;
  box.append(tools, stageEl, result, hint, sides); api.arena.appendChild(box);
  let people = [], sig = null, team = new Map(), angle = 0, frame = 0, flipping = false, lastSide = -1;
  const setCoin = (deg, lift) => { toss.style.transform = `translateY(${(-lift).toFixed(1)}px)`; coin.style.transform = `rotateX(${deg.toFixed(1)}deg)`; };

  function members(side){ return people.filter(p => team.get(p.id) === side); }
  function renderSides(){
    sides.innerHTML = "";
    PICK_COIN_SIDES.forEach(side => {
      const card = make("div", "pkn-side" + (lastSide === side.id ? " is-win" : "")); card.dataset.side = String(side.id);
      const face = make("span", "pkn-side-coin"); face.innerHTML = pickCoinFace(side.icon);
      const title = make("strong"); title.textContent = `${side.label} 편 · ${members(side.id).length}명`;
      const list = make("div", "pkn-members");
      members(side.id).forEach(person => { const chip = make("button", "pkn-member"); chip.type = "button"; chip.dataset.id = person.id; chip.style.setProperty("--pk-c", person.color); chip.textContent = person.name || "사진"; chip.title = "눌러서 다른 편으로 옮기기"; list.appendChild(chip); });
      if (!members(side.id).length){ const empty = make("span", "pkn-empty"); empty.textContent = "아무도 없어요"; list.appendChild(empty); }
      if (lastSide === side.id){ const check = make("span", "pkn-check"); check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>'; card.appendChild(check); }
      card.append(face, title, list); sides.appendChild(card);
    });
    hint.textContent = flipping ? "빙글빙글…" : "이름을 누르면 다른 편으로 옮겨요";
  }
  function renderTools(){
    tools.innerHTML = "";
    const shuffle = make("button", "pick-chip-btn is-wide"); shuffle.type = "button"; shuffle.textContent = "편 새로 나누기"; shuffle.onclick = () => { if (flipping) return; team = pickCoinSplit(people, pickCryptoRandom); lastSide = -1; result.hidden = true; renderSides(); api.refresh(); };
    tools.appendChild(shuffle);
  }
  function showSide(side){
    result.hidden = side < 0; result.innerHTML = ""; if (side < 0) return;
    const t = make("strong"); t.textContent = `${PICK_COIN_SIDES[side].label} 당첨`; result.appendChild(t); result.classList.toggle("is-back", side === 1);
  }
  sides.addEventListener("click", event => {
    const chip = event.target.closest(".pkn-member"); if (!chip || flipping) return;
    team.set(chip.dataset.id, 1 - (team.get(chip.dataset.id) || 0)); lastSide = -1; showSide(-1); renderSides(); api.refresh();
  });
  function start(){
    if (flipping || !members(0).length || !members(1).length) return;
    const side = pickRandomInt(2), m = api.motion(), target = pickCoinSpin(angle, side, 4 + pickRandomInt(3));
    const finish = () => {
      flipping = false; angle = target % 360; setCoin(angle, 0); lastSide = side; box.classList.remove("is-flipping"); showSide(side); renderSides(); api.setBusy(false);
      api.showResult(members(side), { kicker:`${PICK_COIN_SIDES[side].label} 당첨`, againLabel:"한 번 더 던지기" });
    };
    flipping = true; lastSide = -1; showSide(-1); renderSides(); api.setBusy(true);
    if (!m){ finish(); return; }
    box.classList.add("is-flipping"); api.sound("roll");
    const from = angle, dur = 1700 * m, t0 = performance.now(); let lastHalf = Math.floor(from / 180);
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3), deg = from + (target - from) * e, lift = Math.sin(Math.PI * t) * 150;
      setCoin(deg, lift); const half = Math.floor(deg / 180); if (half !== lastHalf){ lastHalf = half; if (t < 0.85) api.sound("tick"); }
      if (t < 1){ frame = requestAnimationFrame(step); return; }
      frame = 0; api.sound("pop"); finish();
    };
    frame = requestAnimationFrame(step);
  }
  coin.addEventListener("click", () => api.requestStart());
  setCoin(0, 0);
  return {
    render(){
      if (flipping) return;
      const list = api.active(), next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002");
      if (next !== sig){
        sig = next; people = list;
        // 이미 나눈 사람은 그대로, 새로 온 사람만 인원이 적은 편에.
        const kept = new Map(); list.forEach(p => { if (team.has(p.id)) kept.set(p.id, team.get(p.id)); });
        if (!kept.size) team = pickCoinSplit(list, pickCryptoRandom);
        else { team = kept; list.forEach(p => { if (!team.has(p.id)){ const a = [...team.values()].filter(v => v === 0).length, b = team.size - a; team.set(p.id, a <= b ? 0 : 1); } }); }
        lastSide = -1; showSide(-1);
      }
      renderTools(); renderSides();
    },
    canStart:() => api.active().length >= 2 && members(0).length > 0 && members(1).length > 0,
    blockReason:() => (api.active().length >= 2 ? "앞면 편과 뒷면 편에 적어도 한 명씩 있어야 해요." : ""),
    start,
    menuItems:() => [{ label:"편 새로 나누기", icon:"shuffle", action:() => { if (!flipping){ team = pickCoinSplit(people, pickCryptoRandom); lastSide = -1; showSide(-1); renderSides(); api.refresh(); } } }],
    dispose(){ cancelAnimationFrame(frame); if (flipping) api.setBusy(false); flipping = false; box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.coin = { mount:mountPickCoin, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_COIN_SIDES, pickCoinSpin, pickCoinSideAt, pickCoinSplit, mountPickCoin };
}
