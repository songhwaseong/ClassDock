"use strict";

/* ===== 복불복 — 사다리타기 =====
   세로줄 n 개, 가로줄은 '층(level)'마다 이웃 칸이 겹치지 않게 놓는다 — 한 세로줄에 같은 높이의 가로줄이 둘 붙지 않으니
   누구의 길도 갈라지지 않고, 위의 n 명과 아래 n 칸은 늘 하나씩 짝이 된다(pickLadderTrace). 이웃한 두 줄 사이에는 가로줄이 적어도 하나.
   결과는 사다리를 만드는 순간 정해진다(가로줄·아래 칸 차례가 무작위) — 그림은 그 길을 따라 그리기만 한다.
   아래 칸: '당첨 뽑기'(당첨 k 칸 + 나머지 통과) 또는 '칸마다 직접 쓰기'(청소·발표·간식 …, 모자라면 통과로 채움). */
const PICK_LADDER_MAX = 20;
function pickLadderInt(value, min, max, fallback){ const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function pickLadderWord(value, max, fallback){ return String(value == null ? "" : value).trim().slice(0, max) || fallback; }
function pickLadderNormalize(raw){
  const v = raw && typeof raw === "object" ? raw : {};
  return { mode:v.mode === "custom" ? "custom" : "win", winners:pickLadderInt(v.winners, 1, PICK_LADDER_MAX - 1, 1),
    winLabel:pickLadderWord(v.winLabel, 12, "당첨"), loseLabel:pickLadderWord(v.loseLabel, 12, "통과"),
    labels:Array.isArray(v.labels) ? v.labels.slice(0, PICK_LADDER_MAX).map(x => String(x == null ? "" : x).trim().slice(0, 16)).filter(Boolean) : [],
    showRungs:v.showRungs === true };
}
function pickLadderRandom(){ return typeof pickCryptoRandom === "function" ? pickCryptoRandom() : Math.random(); }
function pickLadderPick(n, random){ return Math.min(n - 1, Math.floor(random() * n)); }
/* 사다리 만들기 — { n, levels, rungs:[{ col, level, y }] } (col = col 과 col+1 을 잇는 가로줄, y = 0~1, 위에서 아래로 정렬). */
function pickLadderBuild(n, random=pickLadderRandom){
  if (!(n >= 2)) return { n:Math.max(0, n | 0), levels:0, rungs:[] };
  const levels = Math.max(8, Math.min(22, n * 2 + 2)), at = Array.from({ length:levels }, () => new Array(n - 1).fill(false));
  for (let l = 0; l < levels; l++) for (let c = 0; c < n - 1; c++){ if (c > 0 && at[l][c - 1]) continue; if (random() < 0.42) at[l][c] = true; }
  // 이웃한 두 줄 사이가 비면 한 층을 골라 채운다 — 양옆이 빈 층 가운데서, 없으면 아무 층에서 양옆을 비우고.
  for (let c = 0; c < n - 1; c++){
    if (at.some(row => row[c])) continue;
    const free = []; for (let l = 0; l < levels; l++) if (!(c > 0 && at[l][c - 1]) && !(c < n - 2 && at[l][c + 1])) free.push(l);
    const l = free.length ? free[pickLadderPick(free.length, random)] : pickLadderPick(levels, random);
    if (c > 0) at[l][c - 1] = false; if (c < n - 2) at[l][c + 1] = false; at[l][c] = true;
  }
  const rungs = [];
  for (let l = 0; l < levels; l++) for (let c = 0; c < n - 1; c++) if (at[l][c]) rungs.push({ col:c, level:l, y:(l + 0.5 + (random() - 0.5) * 0.56) / levels });
  rungs.sort((a, b) => a.y - b.y || a.col - b.col);
  return { n, levels, rungs };
}
/* start 번째 세로줄 꼭대기에서 내려가는 길 — points 는 [세로줄 번호, y] 꺾이는 점들, end 는 도착한 아래 칸. */
function pickLadderTrace(ladder, start){
  let cur = start; const points = [[cur, 0]];
  (ladder.rungs || []).forEach(rung => {
    if (rung.col === cur){ points.push([cur, rung.y], [cur + 1, rung.y]); cur++; }
    else if (rung.col === cur - 1){ points.push([cur, rung.y], [cur - 1, rung.y]); cur--; }
  });
  points.push([cur, 1]);
  return { end:cur, points };
}
/* 아래 칸 글 — [{ text, win }] n 개, 차례는 섞어서. */
function pickLadderLabels(settings, n, random=pickLadderRandom){
  const s = pickLadderNormalize(settings); let list;
  if (s.mode === "custom" && s.labels.length){ list = s.labels.slice(0, n).map(text => ({ text, win:false })); while (list.length < n) list.push({ text:s.loseLabel, win:false }); }
  else { const k = Math.min(n - 1, s.winners); list = Array.from({ length:n }, (_, i) => (i < k ? { text:s.winLabel, win:true } : { text:s.loseLabel, win:false })); }
  for (let i = list.length - 1; i > 0; i--){ const j = pickLadderPick(i + 1, random); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
function pickLadderEscape(text){ return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]); }
function pickLadderLength(pts){ let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return len; }
function pickLadderPointAt(pts, dist){
  let left = dist;
  for (let i = 1; i < pts.length; i++){ const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (left <= seg){ const t = seg ? left / seg : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, i]; } left -= seg; }
  const last = pts[pts.length - 1]; return [last[0], last[1], pts.length - 1];
}

function mountPickLadder(api){
  const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const box = make("div", "pick-ladder"), tools = make("div", "pick-game-tools"), board = make("div", "pick-ladder-board");
  const top = make("div", "pick-ladder-top"), mid = make("div", "pick-ladder-mid"), bottom = make("div", "pick-ladder-bottom"), notice = make("div", "pick-game-notice");
  notice.hidden = true;
  board.append(top, mid, bottom); box.append(tools, board, notice); api.arena.appendChild(box);
  let ladder = null, labels = [], people = [], sig = null, revealed = false, traced = new Set(), highlight = new Set(), phase = "ready", frame = 0, anim = null;
  const settings = () => api.settings();
  const icon = name => (typeof pickUiIcon === "function" ? pickUiIcon(name) : "");

  function rebuild(){
    const n = people.length; ladder = pickLadderBuild(n); labels = pickLadderLabels(settings(), n);
    traced = new Set(); highlight = new Set(); phase = "ready"; revealed = settings().showRungs; api.refresh();
  }
  function renderTools(){
    const s = settings(); tools.innerHTML = "";
    if (s.mode === "win"){
      const chip = make("span", "pick-chip"); chip.append(document.createTextNode(s.winLabel + " "));
      const minus = make("button", "pick-chip-btn"), plus = make("button", "pick-chip-btn"), count = make("b");
      minus.type = plus.type = "button"; minus.textContent = "−"; plus.textContent = "+"; minus.title = "하나 줄이기"; plus.title = "하나 늘리기";
      const k = Math.min(Math.max(1, people.length - 1), s.winners); count.textContent = String(k);
      minus.disabled = k <= 1; plus.disabled = k >= Math.max(1, people.length - 1);
      minus.onclick = () => { if (!api.isBusy()) api.setSettings({ winners:k - 1 }); }; plus.onclick = () => { if (!api.isBusy()) api.setSettings({ winners:k + 1 }); };
      chip.append(minus, count, plus, document.createTextNode("칸")); tools.appendChild(chip);
    } else { const chip = make("span", "pick-chip"); chip.textContent = `칸 직접 쓰기 · ${Math.min(s.labels.length, people.length)}/${people.length}칸`; tools.appendChild(chip); }
    const edit = make("button", "pick-chip-btn is-wide"); edit.type = "button"; edit.innerHTML = icon("pen") + "<span>아래 칸 고치기</span>"; edit.onclick = openLabels;
    const fresh = make("button", "pick-chip-btn is-wide"); fresh.type = "button"; fresh.innerHTML = icon("refresh") + "<span>새 사다리</span>"; fresh.title = "가로줄과 아래 칸을 새로 섞기";
    fresh.onclick = () => { if (api.isBusy() || people.length < 2) return; api.hideResult(); rebuild(); draw(); };
    tools.append(edit, fresh);
  }
  function renderEnds(){
    const n = people.length, cols = `repeat(${n}, minmax(0, 1fr))`;
    top.style.gridTemplateColumns = cols; bottom.style.gridTemplateColumns = cols; top.innerHTML = ""; bottom.innerHTML = "";
    const reach = new Map(); traced.forEach(i => reach.set(pickLadderTrace(ladder, i).end, people[i]));
    people.forEach((person, i) => {
      const pill = make("button", "pick-ladder-name"); pill.type = "button"; pill.dataset.i = String(i); pill.style.setProperty("--pk-c", person.color);
      if (traced.has(i)) pill.classList.add("is-traced"); if (highlight.has(i)) pill.classList.add("is-sel");
      const name = make("span"); name.textContent = person.name || "사진"; pill.append(typeof pickAvatar === "function" ? pickAvatar(person) : make("span"), name);
      pill.title = traced.has(i) ? `${person.name} — 누르면 길을 다시 보여 줘요` : `${person.name} — 누르면 이 사람만 사다리를 타요`;
      top.appendChild(pill);
    });
    labels.forEach((label, i) => {
      const cell = make("div", "pick-ladder-end"), prize = make("span", "pick-ladder-prize" + (label.win ? " is-win" : ""));
      prize.innerHTML = label.win ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>' : "";
      prize.append(document.createTextNode(label.text)); cell.appendChild(prize);
      const who = reach.get(i); if (who){ const tag = make("span", "pick-ladder-reach"); tag.style.setProperty("--pk-c", who.color); tag.textContent = who.name || "사진"; cell.appendChild(tag); }
      bottom.appendChild(cell);
    });
  }
  /* 가운데 그림 — 판 크기(픽셀) 그대로 그린다(선 굵기가 늘어나지 않게). anim 이 있으면 그 길들은 점선 길이로 가려 두고 조금씩 드러낸다. */
  const geom = () => { const w = mid.clientWidth, h = mid.clientHeight, n = people.length, pad = 12; return { w, h, x:c => (c + 0.5) * w / n, y:v => pad + v * (h - pad * 2) }; };
  const pixelPoints = (g, pts) => pts.map(([c, v]) => [g.x(c), g.y(v)]);
  const trailColor = (i, strong) => (strong ? "#7c5ce6" : `color-mix(in srgb, ${people[i].color} 58%, #3b3478)`);
  function draw(){
    renderEnds();
    const g = geom(), n = people.length; if (!g.w || !g.h || n < 2){ mid.innerHTML = ""; return; }
    let html = `<svg class="pick-ladder-svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}" aria-hidden="true">`;
    for (let c = 0; c < n; c++) html += `<line class="pick-ladder-pole" x1="${g.x(c)}" y1="${g.y(0)}" x2="${g.x(c)}" y2="${g.y(1)}"/>`;
    if (revealed) ladder.rungs.forEach(r => { html += `<line class="pick-ladder-rung" x1="${g.x(r.col)}" y1="${g.y(r.y)}" x2="${g.x(r.col + 1)}" y2="${g.y(r.y)}"/>`; });
    else html += `<rect class="pick-ladder-cover" x="${g.x(0) - 18}" y="${g.y(0.04)}" width="${g.x(n - 1) - g.x(0) + 36}" height="${g.y(0.96) - g.y(0.04)}" rx="16"/><text class="pick-ladder-cover-text" x="${g.w / 2}" y="${g.h / 2}">가로줄은 사다리를 탈 때 나타나요</text>`;
    const done = [...traced].filter(i => !(anim && anim.items.some(item => item.i === i)));
    done.sort((a, b) => Number(highlight.has(a)) - Number(highlight.has(b))).forEach(i => {
      const pts = pixelPoints(g, pickLadderTrace(ladder, i).points), strong = highlight.has(i);
      html += `<path class="pick-ladder-trail${strong ? " is-sel" : ""}" style="stroke:${trailColor(i, strong)}" d="M${pts.map(p => p.join(" ")).join("L")}"/>`;
    });
    if (anim) anim.items.forEach(item => {
      item.pts = pixelPoints(g, item.path.points); item.len = pickLadderLength(item.pts);
      html += `<path class="pick-ladder-trail is-live" data-i="${item.i}" style="stroke:${trailColor(item.i, anim.items.length === 1)};stroke-dasharray:${item.len} ${item.len + 20};stroke-dashoffset:${item.len}" d="M${item.pts.map(p => p.join(" ")).join("L")}"/>`
        + `<circle class="pick-ladder-head" data-i="${item.i}" r="8" cx="${item.pts[0][0]}" cy="${item.pts[0][1]}" style="fill:${trailColor(item.i, true)}"/>`;
    });
    for (let c = 0; c < n; c++) html += `<circle class="pick-ladder-dot" cx="${g.x(c)}" cy="${g.y(0)}" r="6"/><circle class="pick-ladder-dot" cx="${g.x(c)}" cy="${g.y(1)}" r="6"/>`;
    mid.innerHTML = html + "</svg>";
    if (anim) anim.items.forEach(item => { item.line = mid.querySelector(`.pick-ladder-trail.is-live[data-i="${item.i}"]`); item.head = mid.querySelector(`.pick-ladder-head[data-i="${item.i}"]`); });
  }
  /* 길 따라가기 — 여러 명이면 한꺼번에(사람 색), 한 명이면 보라색으로. 꺾일 때마다 '딱'. */
  function run(indices, done){
    const m = api.motion(); revealed = true;
    if (!m || !indices.length){ indices.forEach(i => traced.add(i)); draw(); done(); return; }
    api.setBusy(true); board.classList.add("is-running");
    anim = { items:indices.map(i => ({ i, path:pickLadderTrace(ladder, i), turn:0 })), t0:performance.now(), dur:(indices.length === 1 ? 2300 : 3000) * m };
    draw(); let lastTick = 0;
    const step = now => {
      if (!anim) return;
      const t = Math.min(1, (now - anim.t0) / anim.dur), p = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      anim.items.forEach(item => {
        if (!item.line) return; const dist = item.len * p; item.line.style.strokeDashoffset = String(item.len - dist);
        const [hx, hy, seg] = pickLadderPointAt(item.pts, dist); if (item.head){ item.head.setAttribute("cx", String(hx)); item.head.setAttribute("cy", String(hy)); }
        if (seg > item.turn + 1 && now - lastTick > 60){ item.turn = seg; lastTick = now; api.sound("tick"); } else if (seg > item.turn + 1) item.turn = seg;
      });
      if (t < 1){ frame = requestAnimationFrame(step); return; }
      anim.items.forEach(item => traced.add(item.i)); anim = null; frame = 0; board.classList.remove("is-running"); api.setBusy(false); draw(); done();
    };
    frame = requestAnimationFrame(step);
  }
  function finish(){
    phase = "done"; api.refresh();
    const ends = people.map((_, i) => pickLadderTrace(ladder, i).end), s = settings();
    if (s.mode === "win"){
      const winners = people.filter((_, i) => labels[ends[i]].win); highlight = new Set(people.map((_, i) => i).filter(i => labels[ends[i]].win)); draw();
      api.showResult(winners, { kicker:winners.length > 1 ? `${s.winLabel} ${winners.length}명` : `${s.winLabel}!`, againLabel:"새 사다리 타기" });
    } else {
      highlight = new Set(); draw();
      const rows = labels.map((label, col) => ({ person:people[ends.indexOf(col)], label:label.text })).filter(row => row.person);
      api.showResult([], { kicker:"사다리 결과", title:"누가 무엇을?", rows, againLabel:"새 사다리 타기" });
    }
  }
  function start(){
    if (api.isBusy() || people.length < 2) return;
    if (phase === "done" || traced.size >= people.length) rebuild();
    highlight = new Set(); const pending = people.map((_, i) => i).filter(i => !traced.has(i));
    run(pending, finish);
  }
  top.addEventListener("click", event => {
    const pill = event.target.closest(".pick-ladder-name"); if (!pill || api.isBusy()) return; const i = Number(pill.dataset.i);
    if (phase === "done" || traced.has(i)){ highlight = new Set([i]); draw(); return; }
    api.hideResult(); highlight = new Set([i]);
    run([i], () => { if (traced.size >= people.length) finish(); else { const label = labels[pickLadderTrace(ladder, i).end]; api.say(`${people[i].name || "사진 참가자"} → ${label.text}`, 2200); if (label.win) api.sound("win"); } });
  });

  function openLabels(){
    if (api.isBusy() || typeof tierModal !== "function") return;
    const s = settings(), form = make("div", "tier-form");
    form.innerHTML = '<div class="wide pick-seg" role="radiogroup"><button type="button" data-mode="win">당첨 뽑기</button><button type="button" data-mode="custom">칸마다 직접 쓰기</button></div>'
      + '<div class="wide pick-mode-win"><label><span>당첨 칸 글</span><input class="pl-win" maxlength="12"></label><label><span>나머지 칸 글</span><input class="pl-lose" maxlength="12"></label><label><span>당첨 칸 수</span><input class="pl-count" type="number" min="1" max="19"></label></div>'
      + `<label class="wide pick-mode-custom"><span>한 줄에 한 칸씩 (지금 ${people.length}칸 — 모자라면 '나머지 칸 글'로 채워요)</span><textarea class="pl-lines" rows="7" placeholder="예)\n청소\n발표\n간식 사기\n칠판 지우기"></textarea></label>`
      + '<footer class="wide"><span></span><button type="button" class="pl-cancel">취소</button><button type="button" class="pl-save primary">확인</button></footer>';
    const ui = tierModal("아래 칸 고치기", form); let mode = s.mode;
    const sync = () => { form.querySelectorAll(".pick-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false")); form.querySelector(".pick-mode-win").hidden = mode !== "win"; form.querySelector(".pick-mode-custom").hidden = mode !== "custom"; };
    form.querySelectorAll(".pick-seg button").forEach(b => { b.onclick = () => { mode = b.dataset.mode; sync(); }; });
    form.querySelector(".pl-win").value = s.winLabel; form.querySelector(".pl-lose").value = s.loseLabel; form.querySelector(".pl-count").value = String(s.winners); form.querySelector(".pl-lines").value = s.labels.join("\n"); sync();
    form.querySelector(".pl-cancel").onclick = ui.dispose;
    form.querySelector(".pl-save").onclick = () => {
      const lines = form.querySelector(".pl-lines").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      ui.dispose(); api.hideResult();
      api.setSettings({ mode, winLabel:form.querySelector(".pl-win").value, loseLabel:form.querySelector(".pl-lose").value, winners:form.querySelector(".pl-count").value, labels:lines });
    };
  }

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (ladder) draw(); }) : null; if (observer) observer.observe(mid);
  return {
    render(){
      if (api.isBusy()) return;
      const list = api.active(), s = settings(), tooMany = list.length > PICK_LADDER_MAX;
      notice.hidden = !tooMany; board.hidden = tooMany; notice.textContent = tooMany ? `사다리는 ${PICK_LADDER_MAX}명까지 탈 수 있어요 — 지금 ${list.length}명이에요. 몇 명을 '이번엔 빼기'로 두세요.` : "";
      if (tooMany){ tools.innerHTML = ""; return; }
      const next = list.map(p => [p.id, p.name, p.color, p.image ? p.image.dataUrl.length : 0].join("\u0001")).join("\u0002") + "\u0003" + JSON.stringify(s);
      people = list;
      if (next !== sig){ sig = next; rebuild(); }
      renderTools(); draw();
    },
    canStart:() => { const n = api.active().length; return n >= 2 && n <= PICK_LADDER_MAX; },
    blockReason:() => (api.active().length > PICK_LADDER_MAX ? `사다리는 ${PICK_LADDER_MAX}명까지예요. 몇 명을 '이번엔 빼기'로 두세요.` : ""),
    start,
    goLabel:() => (phase === "done" ? "새 사다리 타기" : ""),
    menuItems:() => { const s = settings(); return [
      { label:"가로줄 미리 보이기", title:"끄면 사다리를 탈 때 가로줄이 나타나요", icon:"check", active:s.showRungs, action:() => api.setSettings({ showRungs:!s.showRungs }) },
      { label:"아래 칸 고치기…", icon:"pen", action:openLabels },
      { label:"새 사다리 만들기", icon:"refresh", action:() => { if (people.length >= 2){ api.hideResult(); rebuild(); draw(); } } }
    ]; },
    dispose(){ cancelAnimationFrame(frame); if (anim) api.setBusy(false); anim = null; if (observer) observer.disconnect(); box.remove(); }
  };
}
if (typeof PICK_GAME_IMPL === "object" && PICK_GAME_IMPL) PICK_GAME_IMPL.ladder = { mount:mountPickLadder, normalize:pickLadderNormalize };

if (typeof module !== "undefined" && module.exports){
  module.exports = { PICK_LADDER_MAX, pickLadderNormalize, pickLadderBuild, pickLadderTrace, pickLadderLabels, pickLadderLength, pickLadderPointAt, mountPickLadder };
}
