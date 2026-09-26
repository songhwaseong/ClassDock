"use strict";

/* ===== 복불복 — 주사위 굴리기 =====
   명단 차례대로 한 사람씩 주사위(1~3개)를 굴려 합이 가장 높은(또는 낮은) 사람이 이긴다.
   맨 앞이 동점이면 그 사람들만 다시 굴린다(재대결) — 한 사람이 남을 때까지. 굴린 값은 굴릴 때마다 새로 뽑으므로 누구나 확률이 같다.
   진행 상태(점수·차례)는 화면에만 둔다. */
const PICK_DICE_PIPS = { 1:[4], 2:[0, 8], 3:[0, 4, 8], 4:[0, 2, 6, 8], 5:[0, 2, 4, 6, 8], 6:[0, 2, 3, 5, 6, 8] };
function pickDiceNormalize(raw){
  const v = raw && typeof raw === "object" ? raw : {}, n = Math.round(Number(v.dice));
  return { dice:Number.isFinite(n) ? Math.max(1, Math.min(3, n)) : 2, rule:v.rule === "low" ? "low" : "high" };
}
function pickDiceRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
function pickDiceRoll(count, random=pickDiceRandom){ return Array.from({ length:count }, () => 1 + Math.min(5, Math.floor(random() * 6))); }
/* 가장 좋은 점수의 사람들(동점이면 여럿). scores: Map(id → 합) */
function pickDiceLeaders(ids, scores, rule){
  const vals = ids.filter(id => scores.has(id)).map(id => scores.get(id)); if (!vals.length) return [];
  const best = rule === "low" ? Math.min(...vals) : Math.max(...vals);
  return ids.filter(id => scores.get(id) === best);
}

function mountPickDice(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-dice"), cards = make("div", "pick-dice-cards"), tray = make("div", "pick-dice-tray"), head = make("div", "pick-dice-head"), row = make("div", "pick-dice-row");
  tray.append(head, row); box.append(cards, tray); api.arena.appendChild(box);
  let people = [], sig = null, scores = new Map(), tieScores = new Map(), tieIds = null, turn = 0, phase = "playing", rolling = false, last = [], auto = false, winnerId = "";
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const settings = () => api.settings();
  const rollers = () => (tieIds ? people.filter(p => tieIds.includes(p.id)) : people);

  function reset(){ scores = new Map(); tieScores = new Map(); tieIds = null; turn = 0; phase = "playing"; last = []; auto = false; winnerId = ""; api.refresh(); }
  function dieEl(value, i){
    const die = make("div", "pick-die"); die.style.setProperty("--rot", ((i % 2 ? 1 : -1) * (4 + (value * 3) % 9)) + "deg");
    for (let k = 0; k < 9; k++){ const pip = make("span", "pick-pip"); if ((PICK_DICE_PIPS[value] || []).includes(k)) pip.classList.add("is-on"); die.appendChild(pip); }
    return die;
  }
  function setDie(die, value){ die.querySelectorAll(".pick-pip").forEach((pip, k) => pip.classList.toggle("is-on", (PICK_DICE_PIPS[value] || []).includes(k))); }
  function renderCards(){
    cards.innerHTML = ""; const current = rollers()[turn];
    people.forEach(person => {
      const card = make("div", "pick-dice-card"); card.style.setProperty("--pk-c", person.color);
      if (phase === "playing" && current && current.id === person.id) card.classList.add("is-turn");
      if (tieIds && tieIds.includes(person.id)) card.classList.add("is-tie");
      if (tieIds && !tieIds.includes(person.id)) card.classList.add("is-out");
      if (winnerId === person.id) card.classList.add("is-win");
      const name = make("span", "pick-dice-name"), dot = make("i"), txt = make("span"); txt.textContent = person.name || "사진"; name.append(dot, txt);
      const score = make("b"); score.textContent = scores.has(person.id) ? String(scores.get(person.id)) : "–";
      card.append(name, score);
      if (tieScores.has(person.id)){ const extra = make("small"); extra.textContent = `재대결 ${tieScores.get(person.id)}`; card.appendChild(extra); }
      cards.appendChild(card);
    });
  }
  function renderHead(){
    head.innerHTML = ""; const current = rollers()[turn], turnChip = make("span", "pick-dice-chip is-turn");
    if (phase === "done"){ turnChip.textContent = "끝! '새 판'으로 다시 해요"; }
    else if (current){ const dot = make("i"); dot.style.setProperty("--pk-c", current.color); const t = make("strong"); t.textContent = `${current.name || "사진"} 차례`; turnChip.append(dot, t); if (tieIds){ const s = make("small"); s.textContent = "재대결"; turnChip.appendChild(s); } }
    const sum = make("span", "pick-dice-chip"), label = make("small"), val = make("b"); label.textContent = "합계"; val.textContent = last.length ? String(last.reduce((a, b) => a + b, 0)) : "–"; sum.append(label, val);
    head.append(turnChip, sum);
  }
  function renderDice(){ row.innerHTML = ""; const n = settings().dice; for (let i = 0; i < n; i++) row.appendChild(dieEl(last[i] || [4, 3, 5][i], i)); row.classList.toggle("is-idle", !last.length); }
  function renderAll(){ renderCards(); renderHead(); renderDice(); }

  function settle(){
    const list = rollers();
    if (turn < list.length - 1){ turn++; renderAll(); if (auto) later(320 * Math.max(0.3, api.motion() || 0.3), roll); return; }
    const ids = list.map(p => p.id), table = tieIds ? tieScores : scores, rule = settings().rule, best = pickDiceLeaders(ids, table, rule);
    if (best.length > 1){
      tieIds = best; tieScores = new Map(); turn = 0; renderAll();
      api.say(`동점! ${best.map(id => (people.find(p => p.id === id) || {}).name || "사진").join("·")} — 다시 굴려요`, 2600);
      if (auto) later(600, roll); return;
    }
    phase = "done"; auto = false; winnerId = best[0]; renderAll(); api.refresh();
    const winner = people.find(p => p.id === winnerId);
    const ranked = people.filter(p => scores.has(p.id)).sort((a, b) => {
      if (a.id === winnerId) return -1; if (b.id === winnerId) return 1;
      return rule === "low" ? scores.get(a.id) - scores.get(b.id) : scores.get(b.id) - scores.get(a.id);
    });
    api.showResult(winner, { kicker:rule === "low" ? "가장 낮은 숫자!" : "가장 높은 숫자!", againLabel:"새 판", rows:ranked.map(p => ({ person:p, label:`${scores.get(p.id)}점`, win:p.id === winnerId })) });
  }
  function roll(){
    if (rolling || phase !== "playing") return;
    const person = rollers()[turn]; if (!person) return;
    const s = settings(), values = pickDiceRoll(s.dice), m = api.motion(), sum = values.reduce((a, b) => a + b, 0);
    // 다음 차례로 넘어갈 때까지 busy 로 둔다 — 그 사이 한 번 더 누르면 같은 사람이 두 번 굴리게 된다.
    const commit = () => { last = values; (tieIds ? tieScores : scores).set(person.id, sum); renderAll(); later(m ? 450 * m : 0, () => { rolling = false; api.setBusy(false); settle(); }); };
    rolling = true; api.setBusy(true); api.sound("roll");
    if (!m){ commit(); return; }
    renderDice(); row.classList.remove("is-idle"); row.classList.add("is-rolling");
    const dice = Array.from(row.querySelectorAll(".pick-die")); let flips = 0;
    const flip = () => { dice.forEach(d => setDie(d, 1 + Math.floor(Math.random() * 6))); if (++flips < 9) later(75 * m, flip); };
    flip();
    later(820 * m, () => { row.classList.remove("is-rolling"); api.sound("pop"); commit(); });
  }
  function start(){
    if (api.isBusy() || people.length < 2) return;
    if (phase === "done"){ reset(); renderAll(); return; }
    roll();
  }
  tray.addEventListener("click", () => api.requestStart());
  return {
    render(){
      if (rolling) return;
      const list = api.active(), next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002") + "\u0003" + JSON.stringify(settings());
      if (next !== sig){ sig = next; people = list; reset(); }
      renderAll();
    },
    canStart:() => api.active().length >= 2,
    start,
    goLabel:() => (phase === "done" ? "새 판" : ""),
    menuItems:() => { const s = settings(); return [
      { label:"주사위 개수", icon:"dice", children:[1, 2, 3].map(n => ({ label:`${n}개`, active:s.dice === n, action:() => api.setSettings({ dice:n }) })) },
      { label:"이기는 쪽", icon:"list", children:[["high", "높은 숫자가 이겨요"], ["low", "낮은 숫자가 이겨요"]].map(([id, label]) => ({ label, active:s.rule === id, action:() => api.setSettings({ rule:id }) })) },
      { label:"남은 사람 모두 굴리기", title:"차례대로 저절로 굴려요", icon:"play", disabled:phase !== "playing", action:() => { auto = true; roll(); } },
      { label:"새 판", icon:"refresh", action:() => { reset(); renderAll(); } }
    ]; },
    dispose(){ timers.forEach(clearTimeout); timers.clear(); if (rolling) api.setBusy(false); rolling = false; box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.dice = { mount:mountPickDice, normalize:pickDiceNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_DICE_PIPS, pickDiceNormalize, pickDiceRoll, pickDiceLeaders, mountPickDice };
}
