"use strict";

/* ===== 복불복 — 핀볼 추첨 =====
   위 가운데 구멍에서 구슬이 떨어져 핀에 부딪힐 때마다 반 칸씩 왼쪽·오른쪽으로 가다가, 맨 아래 참가자 칸 하나에 들어간다.
   구슬 자리는 '칸 폭의 반'을 한 걸음으로 센다(가운데 0). 줄 수 R 은 n-1 과 홀짝이 같게 잡아 어느 칸이든 닿을 수 있다(pickPinballRows).
   뽑을 칸을 먼저 정하고(pickRandomInt), 그 칸에 닿는 좌우 걸음을 무작위로 짠다(pickPinballPath — 벽 밖으로 나가지 않게, 끝에 닿을 수 있는 걸음만). */
const PICK_PINBALL_MAX = 16;
const PICK_PINBALL_BIN = 90, PICK_PINBALL_ROW = 64, PICK_PINBALL_TOP = 150;
function pickPinballRows(n){ let R = Math.max(1, n - 1); while (R < 7) R += 2; return R; }
/* 칸 t 의 자리(반 칸 단위) — 2t - (n-1). */
function pickPinballGoal(n, t){ return 2 * t - (n - 1); }
/* 걸음 — 길이 R+1 의 자리 목록(0 에서 시작해 goal 로 끝). 한 걸음은 ±1, 자리는 늘 -(n-1)..(n-1). */
function pickPinballPath(n, target, R, random=Math.random){
  const goal = pickPinballGoal(n, target), lim = n - 1, path = [0]; let p = 0;
  for (let step = 0; step < R; step++){
    const left = R - step - 1, ok = [p - 1, p + 1].filter(q => Math.abs(q) <= Math.max(lim, 1) && Math.abs(goal - q) <= left);
    p = ok.length > 1 ? ok[Math.min(ok.length - 1, Math.floor(random() * ok.length))] : ok[0]; path.push(p);
  }
  return path;
}
function pickPinballGeometry(n){
  const R = pickPinballRows(n), W = n * PICK_PINBALL_BIN + 80, binTop = PICK_PINBALL_TOP + R * PICK_PINBALL_ROW + 10, H = binTop + 130;
  const x = p => W / 2 + p * PICK_PINBALL_BIN / 2, y = r => PICK_PINBALL_TOP + r * PICK_PINBALL_ROW;
  return { n, R, W, H, binTop, x, y };
}
function pickPinballEscape(text){ return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]); }

function mountPickPinball(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-pinball"), stageEl = make("div", "pkp-stage"), banner = make("div", "pkp-banner"), notice = make("div", "pick-game-notice");
  banner.hidden = true; notice.hidden = true; box.append(stageEl, banner, notice); api.arena.appendChild(box);
  let people = [], sig = null, geo = null, frame = 0, running = false, chosen = -1;

  function draw(){
    const g = geo = pickPinballGeometry(people.length), n = g.n; let pegs = "", bins = "", walls = "";
    for (let r = 0; r < g.R; r++) for (let p = -(n - 1) - 1; p <= n; p++){ if (((p % 2) + 2) % 2 !== r % 2) continue; const x = g.x(p); if (x < 44 || x > g.W - 44) continue; pegs += `<circle class="pkp-peg" cx="${x.toFixed(1)}" cy="${g.y(r)}" r="9"/>`; }
    people.forEach((person, t) => {
      const cx = g.x(pickPinballGoal(n, t)), x0 = cx - PICK_PINBALL_BIN / 2;
      bins += `<g class="pkp-bin${t === chosen ? " is-chosen" : ""}" data-t="${t}"><rect x="${(x0 + 4).toFixed(1)}" y="${g.binTop + 40}" width="${PICK_PINBALL_BIN - 8}" height="70" rx="10" style="fill:${person.color}"/>`
        + `<text x="${cx.toFixed(1)}" y="${g.binTop + 80}">${pickPinballEscape(Array.from(person.name || "사진").slice(0, 5).join(""))}</text></g>`;
    });
    for (let t = 0; t <= n; t++){ const x = g.x(pickPinballGoal(n, 0)) - PICK_PINBALL_BIN / 2 + t * PICK_PINBALL_BIN; walls += `<rect class="pkp-wall" x="${(x - 5).toFixed(1)}" y="${g.binTop}" width="10" height="112" rx="5"/>`; }
    stageEl.innerHTML = `<svg class="pkp-svg" viewBox="0 0 ${g.W} ${g.H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="핀볼 판">`
      + `<rect class="pkp-frame" x="4" y="40" width="${g.W - 8}" height="${g.H - 44}" rx="36"/><rect class="pkp-board" x="26" y="62" width="${g.W - 52}" height="${g.H - 88}" rx="22"/>`
      + `<path class="pkp-funnel" d="M${g.W / 2 - 46} 40q0 58 46 58t46-58"/>`
      + pegs + bins + walls + '<path class="pkp-trail" d=""/><circle class="pkp-ball" r="15"/><circle class="pkp-ball-shine" r="5"/></svg>';
    placeBall(g.W / 2, 72);
  }
  function placeBall(x, y){ const ball = stageEl.querySelector(".pkp-ball"), shine = stageEl.querySelector(".pkp-ball-shine"); if (!ball) return; ball.setAttribute("cx", x.toFixed(1)); ball.setAttribute("cy", y.toFixed(1)); shine.setAttribute("cx", (x - 5).toFixed(1)); shine.setAttribute("cy", (y - 5).toFixed(1)); }
  function showBanner(person){ banner.hidden = !person; banner.innerHTML = ""; if (!person) return; const t = make("strong"); t.textContent = `${person.name || "사진 참가자"} 당첨`; banner.append(make("i"), t, make("i")); }
  function start(){
    if (running || people.length < 2) return;
    const n = people.length, target = pickRandomInt(n), m = api.motion(); chosen = -1; draw(); showBanner(null);
    const g = geo, path = pickPinballPath(n, target, g.R, pickCryptoRandom);
    // 구슬이 닿는 점들 — 출발(구멍) → 줄마다 핀 위 → 칸 바닥.
    const pts = [[g.W / 2, 72]].concat(path.slice(0, g.R).map((p, r) => [g.x(p), g.y(r) - 24])).concat([[g.x(path[g.R]), g.binTop + 20], [g.x(path[g.R]), g.binTop + 58]]);
    const finish = () => {
      running = false; frame = 0; chosen = target; placeBall(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      const bin = stageEl.querySelector(`.pkp-bin[data-t="${target}"]`); if (bin) bin.classList.add("is-chosen");
      showBanner(people[target]); api.setBusy(false); api.showResult(people[target], { kicker:"구슬이 들어간 칸", againLabel:"한 번 더 떨어뜨리기" });
    };
    running = true; api.setBusy(true);
    const trail = stageEl.querySelector(".pkp-trail");
    if (!m){ trail.setAttribute("d", "M" + pts.map(p => p.join(" ")).join("L")); finish(); return; }
    const hop = 190 * m; let seg = 0, t0 = performance.now(), done = [pts[0]];
    const step = now => {
      const a = pts[seg], b = pts[seg + 1], t = Math.min(1, (now - t0) / hop);
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * (seg && seg < pts.length - 2 ? 22 : 0);
      placeBall(x, y); trail.setAttribute("d", "M" + done.concat([[x, y]]).map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L"));
      if (t >= 1){ seg++; done.push(b); t0 = now; if (seg < pts.length - 2) api.sound("tick"); }
      if (seg < pts.length - 1){ frame = requestAnimationFrame(step); return; }
      api.sound("pop"); finish();
    };
    frame = requestAnimationFrame(step);
  }
  stageEl.addEventListener("click", () => api.requestStart());
  return {
    render(){
      if (running) return;
      const list = api.active(), tooMany = list.length > PICK_PINBALL_MAX;
      notice.hidden = !tooMany; stageEl.hidden = tooMany; notice.textContent = tooMany ? `핀볼 추첨은 ${PICK_PINBALL_MAX}명까지예요 — 지금 ${list.length}명이에요.` : "";
      if (tooMany) return;
      const next = list.map(p => [p.id, p.name, p.color].join("\u0001")).join("\u0002");
      if (next !== sig){ sig = next; people = list; chosen = -1; showBanner(null); }
      if (people.length) draw(); else stageEl.innerHTML = "";
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_PINBALL_MAX; },
    blockReason:() => (api.active().length > PICK_PINBALL_MAX ? `핀볼 추첨은 ${PICK_PINBALL_MAX}명까지예요.` : ""),
    start,
    dispose(){ cancelAnimationFrame(frame); if (running) api.setBusy(false); running = false; box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.pinball = { mount:mountPickPinball, normalize:() => ({}) };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_PINBALL_MAX, pickPinballRows, pickPinballGoal, pickPinballPath, pickPinballGeometry, mountPickPinball };
}
