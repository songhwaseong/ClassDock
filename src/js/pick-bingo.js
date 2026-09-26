"use strict";

/* ===== 복불복 — 빙고 추첨 =====
   참가자마다 빙고 판(5×5, B 1~15 · I 16~30 · N 31~45 · G 46~60 · O 61~75, 가운데는 빈칸 ★)을 한 장씩 무작위로 받고,
   '번호 뽑기'로 1~75 가운데 아직 안 나온 번호를 하나씩 뽑으면 모든 판에 동시에 표시된다. 먼저 줄(가로·세로·대각선)을 정한 수만큼 채운 사람이 빙고.
   같은 번호에서 여럿이 동시에 빙고면 모두 당첨. 판은 대칭이라 누구나 확률이 같다. 판·뽑은 번호는 화면에만. */
const PICK_BINGO_MAX = 30;
const PICK_BINGO_LETTERS = ["B", "I", "N", "G", "O"];
function pickBingoNormalize(raw){ const v = raw && typeof raw === "object" ? raw : {}, n = Math.round(Number(v.lines)); return { lines:Number.isFinite(n) ? Math.max(1, Math.min(3, n)) : 1 }; }
function pickBingoRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
/* 판 — 25칸 가로 차례(칸 = 줄*5 + 칸), 가운데(12)는 0(빈칸). 열 c 는 15c+1 ~ 15c+15 에서 겹치지 않게 다섯. */
function pickBingoCard(random=pickBingoRandom){
  const cols = [0, 1, 2, 3, 4].map(c => { const pool = Array.from({ length:15 }, (_, i) => c * 15 + i + 1); for (let i = pool.length - 1; i > 0; i--){ const j = Math.min(i, Math.floor(random() * (i + 1))); [pool[i], pool[j]] = [pool[j], pool[i]]; } return pool.slice(0, 5); });
  const card = []; for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) card.push(r === 2 && c === 2 ? 0 : cols[c][r]);
  return card;
}
const PICK_BINGO_LINES = (() => { const L = []; for (let i = 0; i < 5; i++){ L.push([0, 1, 2, 3, 4].map(c => i * 5 + c)); L.push([0, 1, 2, 3, 4].map(r => r * 5 + i)); } L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]); return L; })();
/* 다 찬 줄들 — 칸 번호 배열의 목록. drawn: Set(뽑은 번호). */
function pickBingoLines(card, drawn){ return PICK_BINGO_LINES.filter(line => line.every(k => card[k] === 0 || drawn.has(card[k]))); }
function pickBingoDraw(drawn, random=pickBingoRandom){ const left = []; for (let n = 1; n <= 75; n++) if (!drawn.has(n)) left.push(n); return left.length ? left[Math.min(left.length - 1, Math.floor(random() * left.length))] : 0; }
function pickBingoLetter(n){ return PICK_BINGO_LETTERS[Math.max(0, Math.min(4, Math.floor((n - 1) / 15)))]; }

function mountPickBingo(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-bingo"), cardsEl = make("div", "pkg-cards"), side = make("div", "pkg-side"), tools = make("div", "pick-game-tools");
  const ball = make("div", "pkg-ball"), ballNum = make("b"), ballLetter = make("small"), caption = make("span", "pkg-caption"), status = make("div", "pkg-status"), drawnRow = make("div", "pkg-drawn"), notice = make("div", "pick-game-notice");
  ball.append(ballLetter, ballNum); caption.textContent = "이번 번호"; side.append(tools, ball, caption, status); notice.hidden = true;
  box.append(cardsEl, side, drawnRow, notice); api.arena.appendChild(box);
  let people = [], sig = null, cards = new Map(), drawn = [], drawnSet = new Set(), winners = [], phase = "playing", rolling = false, auto = false;
  const timers = new Set(), later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const settings = () => api.settings();

  function reset(){ people = api.active(); cards = new Map(people.map(p => [p.id, pickBingoCard()])); drawn = []; drawnSet = new Set(); winners = []; phase = "playing"; auto = false; api.refresh(); }
  function renderCards(){
    cardsEl.innerHTML = ""; const need = settings().lines;
    people.forEach(person => {
      const card = cards.get(person.id); if (!card) return;
      const lines = pickBingoLines(card, drawnSet), inLine = new Set(lines.flat()), hits = card.filter(v => v && drawnSet.has(v)).length;
      const el = make("div", "pkg-card"); el.style.setProperty("--pk-c", person.color); if (winners.includes(person)) el.classList.add("is-bingo");
      const head = make("div", "pkg-card-head"), dot = make("i"), name = make("strong"), prog = make("small");
      name.textContent = person.name || "사진"; prog.textContent = lines.length ? `${Math.min(lines.length, need)}/${need}줄` : `${hits}칸`; head.append(dot, name, prog);
      const grid = make("div", "pkg-grid");
      PICK_BINGO_LETTERS.forEach((letter, c) => { const h = make("span", "pkg-letter is-" + c); h.textContent = letter; grid.appendChild(h); });
      card.forEach((value, k) => {
        const cell = make("span", "pkg-cell");
        if (!value){ cell.classList.add("is-free", "is-hit"); cell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z"/></svg>'; }
        else { cell.textContent = String(value); if (drawnSet.has(value)) cell.classList.add("is-hit"); if (value === drawn[drawn.length - 1]) cell.classList.add("is-new"); }
        if (inLine.has(k)) cell.classList.add("is-line");
        grid.appendChild(cell);
      });
      el.append(head, grid); cardsEl.appendChild(el);
    });
    cardsEl.classList.toggle("is-many", people.length > 6);
  }
  function renderSide(){
    const last = drawn[drawn.length - 1];
    ballNum.textContent = last ? String(last) : "?"; ballLetter.textContent = last ? pickBingoLetter(last) : ""; ball.classList.toggle("is-empty", !last);
    status.innerHTML = ""; status.className = "pkg-status" + (phase === "done" ? " is-bingo" : "");
    status.textContent = phase === "done" ? "빙고!" : drawn.length ? `${drawn.length}번째 · 남은 번호 ${75 - drawn.length}개` : "번호를 뽑아 보세요";
    tools.innerHTML = "";
    const s = settings(), chip = make("span", "pick-chip"), minus = make("button", "pick-chip-btn"), plus = make("button", "pick-chip-btn"), b = make("b");
    minus.type = plus.type = "button"; minus.textContent = "−"; plus.textContent = "+"; b.textContent = String(s.lines); minus.disabled = s.lines <= 1; plus.disabled = s.lines >= 3;
    minus.onclick = () => { if (!api.isBusy()) api.setSettings({ lines:s.lines - 1 }); }; plus.onclick = () => { if (!api.isBusy()) api.setSettings({ lines:s.lines + 1 }); };
    chip.append(document.createTextNode("빙고 "), minus, b, plus, document.createTextNode("줄"));
    const autoBtn = make("button", "pick-chip-btn is-wide" + (auto ? " is-on" : "")); autoBtn.type = "button"; autoBtn.textContent = auto ? "자동 멈추기" : "자동으로 뽑기"; autoBtn.disabled = phase !== "playing";
    autoBtn.onclick = () => { auto = !auto; renderSide(); if (auto) api.requestStart(); };
    tools.append(chip, autoBtn);
  }
  function renderDrawn(){
    drawnRow.innerHTML = ""; drawnRow.hidden = !drawn.length; if (!drawn.length) return;
    const label = make("span", "pkg-drawn-label"); label.textContent = "뽑은 번호"; drawnRow.appendChild(label);
    drawn.slice(-24).forEach(n => { const chip = make("span", "pkg-drawn-chip is-" + Math.floor((n - 1) / 15)); chip.textContent = String(n); drawnRow.appendChild(chip); });
    if (drawn.length > 24){ const more = make("span", "pkg-drawn-more"); more.textContent = `외 ${drawn.length - 24}개`; drawnRow.prepend(more); }
  }
  function renderAll(){ renderCards(); renderSide(); renderDrawn(); }
  function draw(){
    if (rolling || phase !== "playing") return;
    const n = pickBingoDraw(drawnSet); if (!n){ auto = false; renderSide(); return; }
    const m = api.motion(); rolling = true; api.setBusy(true); api.hideResult();
    const commit = () => {
      drawn.push(n); drawnSet.add(n); ball.classList.remove("is-rolling"); api.sound("pop");
      const need = settings().lines; winners = people.filter(p => pickBingoLines(cards.get(p.id), drawnSet).length >= need);
      if (winners.length){ phase = "done"; auto = false; }
      renderAll(); rolling = false; api.setBusy(false); api.refresh();
      if (phase === "done") api.showResult(winners.slice(), { kicker:winners.length > 1 ? `빙고! ${winners.length}명` : "빙고!", againLabel:"새 판" });
      else if (auto) later(Math.max(250, 1100 * (m || 0.3)), draw);
    };
    if (!m){ commit(); return; }
    ball.classList.add("is-rolling"); api.sound("roll"); let flips = 0;
    const flip = () => { const k = 1 + Math.floor(Math.random() * 75); ballNum.textContent = String(k); ballLetter.textContent = pickBingoLetter(k); if (++flips < 7) later(70 * m, flip); };
    flip(); later(560 * m, commit);
  }
  return {
    render(){
      if (api.isBusy()) return;
      const list = api.active(), tooMany = list.length > PICK_BINGO_MAX;
      notice.hidden = !tooMany; cardsEl.hidden = side.hidden = tooMany; notice.textContent = tooMany ? `빙고 추첨은 ${PICK_BINGO_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      const next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002");
      const s = JSON.stringify(settings());
      if (next !== sig){ sig = next; reset(); }
      else if (box.dataset.settings && s !== box.dataset.settings && drawn.length){
        // 줄 수를 바꾸면 지금 뽑은 번호로 다시 판정한다 — 늘리면 이어서 뽑고, 줄이면 바로 빙고가 날 수도 있다.
        const was = phase; winners = people.filter(p => pickBingoLines(cards.get(p.id), drawnSet).length >= settings().lines); phase = winners.length ? "done" : "playing"; auto = false; api.refresh();
        if (phase === "done" && was !== "done"){ box.dataset.settings = s; renderAll(); api.showResult(winners.slice(), { kicker:"빙고!", againLabel:"새 판" }); return; }
      }
      box.dataset.settings = s; renderAll();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_BINGO_MAX; },
    blockReason:() => (api.active().length > PICK_BINGO_MAX ? `빙고 추첨은 ${PICK_BINGO_MAX}명까지예요.` : ""),
    start(){ if (api.isBusy()) return; if (phase === "done"){ reset(); renderAll(); return; } draw(); },
    goLabel:() => (phase === "done" ? "새 판" : ""),
    menuItems:() => [
      { label:"빙고 줄 수", icon:"list", children:[1, 2, 3].map(n => ({ label:`${n}줄`, active:settings().lines === n, action:() => api.setSettings({ lines:n }) })) },
      { label:auto ? "자동 멈추기" : "자동으로 뽑기", icon:"play", disabled:phase !== "playing", action:() => { auto = !auto; renderSide(); if (auto) api.requestStart(); } },
      { label:"새 판 (판 새로 나누기)", icon:"refresh", action:() => { if (!api.isBusy()){ reset(); renderAll(); } } }
    ],
    dispose(){ timers.forEach(clearTimeout); timers.clear(); auto = false; if (rolling) api.setBusy(false); rolling = false; box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.bingo = { mount:mountPickBingo, normalize:pickBingoNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_BINGO_MAX, PICK_BINGO_LINES, pickBingoNormalize, pickBingoCard, pickBingoLines, pickBingoDraw, pickBingoLetter, mountPickBingo };
}
