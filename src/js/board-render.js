"use strict";

/* ===== 화이트보드/리플레이 공용 벡터 렌더러 =====
   whiteboard.js(편집 화면)와 lesson-replay.js(수업 재생)가 같은 그리기 코드를 공유해,
   되감아 보는 재생 화면이 판서할 때와 픽셀 단위로 일치하도록 한다.
   좌표는 모두 CSS px 기준(캔버스 리사이즈와 무관). 새 라이브러리 없이 canvas 2d 만 사용. */

/* 항목 종류별 선/색/투명도 상태를 ctx 에 반영.
   지우개는 예전처럼 배경색으로 덧칠하지 않고 destination-out 으로 진짜 뚫는다 — 배경이 단색이
   아니라 무늬(모눈·오선)일 수도 있어, 덧칠하면 지운 자리에 단색 얼룩이 남기 때문이다.
   그 대신 배경은 맨 나중에 paintBackground 로 "밑에 깐다"(그리는 쪽 순서가 중요하다). */
const MNBoardRenderer = (() => {
function applyStroke(ctx, it){
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.setLineDash(Array.isArray(it.dash) ? it.dash : []);
  ctx.lineWidth = Number(it.width) || 1; ctx.strokeStyle = it.color || "#111111"; ctx.fillStyle = it.color || "#111111";
  ctx.globalAlpha = (it.type === "highlighter") ? 0.30 : 1;
  if (it.type === "eraser"){
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000000"; ctx.fillStyle = "#000000"; ctx.globalAlpha = 1;
  }
  if (Number.isFinite(it.alpha)) ctx.globalAlpha *= Math.max(0, Math.min(1, it.alpha));
}

// ----- 배경(색 + 무늬) -----
// 무늬 설정 정규화는 state.js 가 갖고 있다. 이 파일만 단독으로 불러 쓰는 테스트를 위해 없을 때도 견딘다.
function normalizePattern(value){
  if (typeof normalizeBoardPattern === "function") return normalizeBoardPattern(value);
  return (value && typeof value === "object" && value.id && value.id !== "none") ? value : null;
}
function patternInk(pattern, bg){
  if (typeof boardPatternInkColor === "function") return boardPatternInkColor(pattern, bg);
  return (pattern && pattern.color) || "#1f2937";
}
/* 무늬 한 판. area 는 "지금 화면에 보이는 보드 좌표 사각형"이고, 칸은 언제나 보드 원점(0,0)에
   맞춰 깔린다 — 창 크기를 바꾸면 보이는 칸 수만 늘고 줄 뿐, 이미 쓴 판서와 칸이 어긋나지 않는다.
   선은 한 번의 stroke() 로 모아 긋는다. 나눠 그으면 교차점마다 알파가 겹쳐 점이 찍힌 것처럼 보인다. */
function drawPattern(ctx, pattern, area, bg){
  if (pattern.id === "chalk"){ drawChalkTexture(ctx, pattern, area, bg); return; }
  const size = Math.max(4, Number(pattern.size) || 40);
  const x0 = area.x, y0 = area.y, x1 = area.x + area.w, y1 = area.y + area.h;
  const start = (from, step) => Math.floor(from / step) * step;
  const hair = Math.max(1, size / 40);   // 간격이 좁은 무늬(오선)도 선이 사라지지 않게 최소 굵기를 둔다
  ctx.save();
  ctx.globalAlpha = Math.max(.05, Math.min(1, Number(pattern.opacity) || .3));
  ctx.strokeStyle = ctx.fillStyle = patternInk(pattern, bg);
  ctx.setLineDash([]); ctx.lineCap = "butt"; ctx.lineJoin = "miter"; ctx.lineWidth = hair;
  // 1px 안팎의 가는 선을 정수 좌표에 그으면 두 픽셀에 반씩 걸려 뿌옇게 번진다 — 반 픽셀 밀어 또렷하게.
  // (칸 위치가 반 픽셀 움직일 뿐이라 그 위에 쓴 판서와의 관계는 그대로다.)
  const crisp = hair <= 1.2 ? .5 : 0;
  const columns = (step, top, bottom) => { for (let x = start(x0, step); x <= x1; x += step){ ctx.moveTo(x + crisp, top); ctx.lineTo(x + crisp, bottom); } };
  const rows = (step, left, right) => { for (let y = start(y0, step); y <= y1; y += step){ ctx.moveTo(left, y + crisp); ctx.lineTo(right, y + crisp); } };
  if (pattern.id === "grid" || pattern.id === "graph"){
    ctx.beginPath(); columns(size, y0, y1); rows(size, x0, x1); ctx.stroke();
    if (pattern.id === "grid"){
      // 다섯 칸마다 굵은 선 — 눈금을 세지 않고도 길이를 읽을 수 있다.
      ctx.lineWidth = hair * 1.9; ctx.beginPath(); columns(size * 5, y0, y1); rows(size * 5, x0, x1); ctx.stroke();
    } else {
      // 축은 무늬보다 진하게. 같은 농도면 원점이 격자에 묻혀 좌표평면 구실을 못 한다.
      const ox = Number.isFinite(Number(pattern.originX)) ? Number(pattern.originX) : (x0 + x1) / 2;
      const oy = Number.isFinite(Number(pattern.originY)) ? Number(pattern.originY) : (y0 + y1) / 2;
      ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 2.4); ctx.lineWidth = hair * 2.4;
      ctx.beginPath(); ctx.moveTo(x0, oy); ctx.lineTo(x1, oy); ctx.moveTo(ox, y0); ctx.lineTo(ox, y1); ctx.stroke();
    }
  } else if (pattern.id === "dots"){
    const r = Math.max(.9, size / 20);
    ctx.beginPath();
    for (let x = start(x0, size); x <= x1; x += size){
      for (let y = start(y0, size); y <= y1; y += size){ ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
    }
    ctx.fill();
  } else if (pattern.id === "lines"){
    ctx.beginPath(); rows(size, x0, x1); ctx.stroke();
  } else if (pattern.id === "staff"){
    // 다섯 줄이 한 단, 단 사이는 넉넉히 띄운다(가사·화음 적을 자리).
    const period = size * 9;
    ctx.beginPath();
    for (let top = start(y0 - size * 4, period); top <= y1; top += period){
      for (let i = 0; i < 5; i++){ const y = top + i * size + crisp; if (y >= y0 - size && y <= y1 + size){ ctx.moveTo(x0, y); ctx.lineTo(x1, y); } }
    }
    ctx.stroke();
  } else if (pattern.id === "cells"){
    // 원고지: 네모 칸 줄이 이어지고 줄과 줄 사이에 손글씨가 삐져나갈 여백을 둔다.
    const gap = Math.max(6, Math.round(size * .42)), period = size + gap;
    ctx.beginPath();
    for (let top = start(y0 - size, period); top <= y1; top += period){
      const bottom = top + size;
      if (bottom < y0 || top > y1) continue;
      ctx.moveTo(x0, top + crisp); ctx.lineTo(x1, top + crisp); ctx.moveTo(x0, bottom + crisp); ctx.lineTo(x1, bottom + crisp);
      columns(size, top, bottom);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/* ----- 칠판 질감 -----
   선 무늬와 달리 결이 있는 '판'이라, 한 칸(타일)을 계산해 두고 보드 원점에 맞춰 반복해 깐다.
   저장되는 건 다른 무늬와 같은 이름·크기·진하기뿐이다 — 타일은 고정 씨앗으로 매번 똑같이 다시 만든다
   (편집 화면·리플레이·내보내기가 같은 결을 보여야 하므로 Math.random 을 쓰지 않는다).
   타일 한 칸 안에는 두 층이 있다:
     light — 분필 가루(무늬 색): 고르지 않은 가루 안개 + 지우개 획(결 줄무늬·누르는 힘) + 알갱이·잔 흠집
     dark  — 판 자체의 얼룩·결(검정)
   모든 계산은 타일 가장자리에서 반대편으로 이어지게(감싸기) 해 반복 이음매가 보이지 않는다.
   캔버스 없이 숫자 배열만 다루므로 노드 테스트에서도 같은 값이 나온다. */
const CHALK_TILE = 1536;            // 보드 px. 화면 하나에 반복이 두 번 넘게 보이지 않을 크기
const CHALK_SEED = 20261004;
const CHALK_GAIN = 1.4;             // 진하기 기본값(.7)에서 '여러 번 지운 칠판' 정도가 되게 맞춘 배율
const chalkFieldCache = new Map();
const chalkTileCache = new Map();
function chalkRandom(seed){
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function chalkNormalize(field){
  let mean = 0; for (let i = 0; i < field.length; i++) mean += field[i];
  mean /= field.length;
  let variance = 0; for (let i = 0; i < field.length; i++){ field[i] -= mean; variance += field[i] * field[i]; }
  const inv = 1 / (Math.sqrt(variance / field.length) || 1);
  for (let i = 0; i < field.length; i++) field[i] *= inv;
  return field;
}
// 감싸지는 값 잡음 여러 겹. octaves 는 [주기(px), 세기] — 칸 수가 정수라 타일 끝이 처음과 이어진다.
function chalkNoise(rand, n, octaves){
  const out = new Float32Array(n * n);
  for (const [period, amp] of octaves){
    const c = Math.max(1, Math.round(n / period));
    const grid = new Float32Array(c * c);
    for (let i = 0; i < grid.length; i++) grid[i] = rand() * 2 - 1;
    const i0 = new Int32Array(n), i1 = new Int32Array(n), w = new Float32Array(n);
    for (let i = 0; i < n; i++){
      const f = i * c / n, k = Math.floor(f), t = f - k;
      i0[i] = k % c; i1[i] = (k + 1) % c; w[i] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < n; y++){
      const r0 = i0[y] * c, r1 = i1[y] * c, wy = w[y], row = y * n;
      for (let x = 0; x < n; x++){
        const wx = w[x], a = grid[r0 + i0[x]], b = grid[r0 + i1[x]], d = grid[r1 + i0[x]], e = grid[r1 + i1[x]];
        const top = a + (b - a) * wx, bottom = d + (e - d) * wx;
        out[row + x] += (top + (bottom - top) * wy) * amp;
      }
    }
  }
  return chalkNormalize(out);
}
// 감싸는 상자 흐림(가로·세로). passes 번 거듭하면 가우스 흐림에 가까워진다.
function chalkBlur(field, n, r, passes){
  if (r < 1) return field;
  let src = field, dst = new Float32Array(n * n);
  const inv = 1 / (2 * r + 1), wrap = (i) => ((i % n) + n) % n, sums = new Float32Array(n);
  for (let p = 0; p < passes; p++){
    for (let y = 0; y < n; y++){
      const row = y * n; let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + wrap(k)];
      for (let x = 0; x < n; x++){
        dst[row + x] = sum * inv;
        const add = x + r + 1, sub = x - r;
        sum += src[row + (add >= n ? add - n : add)] - src[row + (sub < 0 ? sub + n : sub)];
      }
    }
    [src, dst] = [dst, src];
    // 세로는 열마다 내려가지 않고 줄 단위로 합을 굴린다(메모리를 차례로 읽어 훨씬 빠르다).
    sums.fill(0);
    for (let k = -r; k <= r; k++){ const row = wrap(k) * n; for (let x = 0; x < n; x++) sums[x] += src[row + x]; }
    for (let y = 0; y < n; y++){
      const row = y * n, add = wrap(y + r + 1) * n, sub = wrap(y - r) * n;
      for (let x = 0; x < n; x++){ dst[row + x] = sums[x] * inv; sums[x] += src[add + x] - src[sub + x]; }
    }
    [src, dst] = [dst, src];
  }
  return src;
}
// 지우개 한 번이 지나간 길: 손목으로 휘두른 큰 호, 또는 좌우로 문지른 지그재그.
function chalkEraserPaths(rand, n, count){
  const paths = [];
  for (let s = 0; s < count; s++){
    const cx = rand() * n, cy = rand() * n, width = 45 + rand() * 40, alpha = .1 + rand() * .14;
    if (rand() < .55){
      const R = 380 + rand() * 720, span = Math.min(.35 + rand() * .55, 650 / R);
      const mid = -Math.PI / 2 + (rand() - .5) + (rand() < .3 ? Math.PI : 0);
      const arc = (offset) => {
        const points = [];
        for (let i = 0; i <= 40; i++){
          const t = mid - span / 2 + span * i / 40;
          points.push([cx + R * Math.cos(t), cy + R + R * Math.sin(t) + offset]);
        }
        return points;
      };
      paths.push({ points:arc(0), width, alpha });
      if (rand() < .5) paths.push({ points:arc(width * (.5 + rand() * .3)), width, alpha });
    } else {
      const span = 220 + rand() * 380, rows = 2 + Math.floor(rand() * 4), tilt = (rand() - .5) * .24;
      const points = [];
      for (let r = 0; r < rows; r++){
        const y = cy + r * width * (.45 + rand() * .25);
        let xa = cx - span / 2 + (rand() - .5) * 60, xb = cx + span / 2 + (rand() - .5) * 60;
        if (r % 2) [xa, xb] = [xb, xa];
        points.push([xa, y + tilt * (xa - cx)], [xb, y + tilt * (xb - cx)]);
      }
      paths.push({ points, width, alpha });
    }
  }
  return paths;
}
// 길을 1px 간격 점과 그 자리의 법선으로 고르게 다시 찍는다(결 줄을 길 따라 나란히 긋기 위해).
function chalkResample(points){
  const out = [];
  for (let i = 1; i < points.length; i++){
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const len = Math.hypot(x1 - x0, y1 - y0); if (!len) continue;
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    for (let d = 0; d < len; d++){ const t = d / len; out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny); }
  }
  return out;
}
function chalkTextureFields(size, seed){
  const n = Math.max(64, Math.round((Number(size) || CHALK_TILE) / 4) * 4);   // 몸통을 1/4 크기로 칠하므로 4의 배수
  const key = n + ":" + (seed >>> 0 || CHALK_SEED);
  if (chalkFieldCache.has(key)) return chalkFieldCache.get(key);
  const rand = chalkRandom(seed >>> 0 || CHALK_SEED);
  const N = n * n, area = N / (CHALK_TILE * CHALK_TILE);
  const wrap = (i) => ((i % n) + n) % n;

  const mottle = chalkNoise(rand, n, [[768, 1], [384, .6], [96, .3], [48, .16], [12, .08]]);
  const cloud = chalkNoise(rand, n, [[384, 1], [192, .6], [96, .35], [24, .2]]);
  const press = chalkNoise(rand, n, [[512, 1], [192, .7], [96, .4]]);

  // 지우개 획 몸통: 획마다 가장자리가 무르게 퍼지므로 1/4 크기로 칠한 뒤 흐려서 키운다.
  const q = 4, m = n / q;
  let body = new Float32Array(m * m);
  const streak = new Float32Array(N);
  const paths = chalkEraserPaths(rand, n, Math.max(1, Math.round(26 * area)));
  for (const path of paths){
    const pts = path.points, half = path.width / 2, reach = (half + q) * (half + q);
    const xy = new Float64Array(pts.length * 2);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(([x, y], i) => { xy[i * 2] = x; xy[i * 2 + 1] = y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    for (let py = Math.floor((minY - half) / q) - 1; py <= Math.ceil((maxY + half) / q) + 1; py++){
      for (let px = Math.floor((minX - half) / q) - 1; px <= Math.ceil((maxX + half) / q) + 1; px++){
        const X = (px + .5) * q, Y = (py + .5) * q;
        let best = Infinity;
        for (let i = 2; i < xy.length; i += 2){
          const ax = xy[i - 2], ay = xy[i - 1], dx = xy[i] - ax, dy = xy[i + 1] - ay;
          let t = ((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy || 1);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + dx * t - X, ey = ay + dy * t - Y, dist = ex * ex + ey * ey;
          if (dist < best) best = dist;
        }
        if (best >= reach) continue;
        const cover = Math.max(0, Math.min(1, (half - Math.sqrt(best)) / q + .5));
        if (!cover) continue;
        const j = (((py % m) + m) % m) * m + (((px % m) + m) % m);
        body[j] = 1 - (1 - body[j]) * (1 - path.alpha * cover);
      }
    }
    // 결: 지우개 천이 남기는 가는 줄을 길 따라 나란히 긋는다. 줄마다 세기가 다르고 군데군데 끊긴다.
    const line = chalkResample(pts), lines = Math.max(3, Math.round(path.width / 2.2));
    for (let k = 0; k < lines; k++){
      const offset = (k / (lines - 1) - .5) * path.width * .92, value = .15 + rand() * rand() * .85;
      let on = rand() < .75;
      for (let i = 0; i < line.length; i += 4){
        if (rand() < (on ? 1 / 70 : 1 / 25)) on = !on;
        if (!on) continue;
        const x = line[i] + line[i + 2] * offset, y = line[i + 1] + line[i + 3] * offset;
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        const r0 = wrap(y0) * n, r1 = wrap(y0 + 1) * n, c0 = wrap(x0), c1 = wrap(x0 + 1);
        streak[r0 + c0] += value * (1 - fx) * (1 - fy); streak[r0 + c1] += value * fx * (1 - fy);
        streak[r1 + c0] += value * (1 - fx) * fy;       streak[r1 + c1] += value * fx * fy;
      }
    }
  }
  body = chalkBlur(body, m, 3, 3);
  const streakSoft = chalkBlur(streak, n, 1, 1);

  // 판의 고운 결: 두 크기를 섞어 디지털 잡음처럼 보이지 않게 한다.
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) raw[i] = rand() - .5;   // 흐리고 나면 고르게 퍼진 잡음도 종 모양에 가까워진다
  const fineA = chalkNormalize(chalkBlur(raw.slice(), n, 1, 1)), fineB = chalkNormalize(chalkBlur(raw, n, 2, 2));

  const lightF = new Float32Array(N);
  const dark = new Uint8ClampedArray(N);
  // 몸통(1/4 크기)을 감싸며 쌍선형으로 키운다 — 가로 자리는 줄마다 같으니 한 번만 센다.
  const cols0 = new Int32Array(n), cols1 = new Int32Array(n), colT = new Float32Array(n);
  for (let x = 0; x < n; x++){
    const fx = (x + .5) / q - .5, k = Math.floor(fx);
    cols0[x] = ((k % m) + m) % m; cols1[x] = (((k + 1) % m) + m) % m; colT[x] = fx - k;
  }
  const darkScale = 255 * CHALK_GAIN;
  for (let y = 0; y < n; y++){
    const fy = (y + .5) / q - .5, by0 = Math.floor(fy), ty = fy - by0;
    const br0 = ((by0 % m) + m) % m * m, br1 = (((by0 + 1) % m) + m) % m * m, row = y * n;
    for (let x = 0; x < n; x++){
      const i = row + x, c0 = cols0[x], c1 = cols1[x], tx = colT[x];
      const b = (body[br0 + c0] * (1 - tx) + body[br0 + c1] * tx) * (1 - ty) + (body[br1 + c0] * (1 - tx) + body[br1 + c1] * tx) * ty;
      let p = press[i] * .16 + .55; p = p < 0 ? 0 : p > 1 ? 1 : p;
      const st = streakSoft[i] > 1 ? 1 : streakSoft[i];
      let stroke = b * p * (.5 + .8 * st); if (stroke > 1) stroke = 1;
      let c = cloud[i] * .18 + .5; c = c < 0 ? 0 : c > 1 ? 1 : c;
      const haze = .07 * c * Math.sqrt(c);
      const g = fineA[i] * .7 + fineB[i] * .5;
      let mo = mottle[i]; mo = mo < -3 ? -3 : mo > 3 ? 3 : mo;
      const lift = (mo > 0 ? mo * .006 : 0) + (g > 0 ? g * .01 : 0);
      lightF[i] = 1 - (1 - haze) * (1 - stroke) * (1 - lift);
      dark[i] = ((mo < 0 ? -mo * .016 : 0) + (g < 0 ? -g * .028 : 0)) * darkScale + .5;
    }
  }
  // 분필 알갱이(가루가 많은 곳에 더 몰린다)와 잔 흠집.
  const deposit = (x, y, v) => {
    const xi = wrap(Math.round(x)), yi = wrap(Math.round(y));
    lightF[yi * n + xi] = 1 - (1 - lightF[yi * n + xi]) * (1 - v);
  };
  let maxDust = 0; for (let i = 0; i < N; i++) if (lightF[i] > maxDust) maxDust = lightF[i];
  for (let placed = 0, tries = 0, want = Math.round(1500 * area); placed < want && tries < want * 40; tries++){
    const x = Math.floor(rand() * n), y = Math.floor(rand() * n);
    if (rand() * (maxDust + .05) > lightF[y * n + x] + .05) continue;
    const v = Math.pow(.2 + rand() * .8, 2) * .35;
    deposit(x, y, v);
    if (v > .12){ deposit(x + 1, y, v * .45); deposit(x, y + 1, v * .45); deposit(x - 1, y, v * .3); deposit(x, y - 1, v * .3); }
    placed++;
  }
  for (let s = 0, want = Math.round(520 * area); s < want; s++){
    const x = rand() * n, y = rand() * n, len = 10 + rand() * 80;
    const angle = rand() < .7 ? (rand() - .5) * .7 : rand() * Math.PI, v = (.25 + rand() * .35) * .05;
    for (let d = 0; d < len; d++) deposit(x + Math.cos(angle) * d, y + Math.sin(angle) * d, v);
  }
  const light = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) light[i] = Math.round(255 * Math.min(1, lightF[i] * CHALK_GAIN));
  const fields = { size:n, light, dark };
  chalkFieldCache.set(key, fields);
  return fields;
}
// 자동 색이 흰색이면 아주 옅게 누런 분필 색으로 — 새하얀 가루는 칠판 위에서 형광처럼 떠 보인다.
function chalkInk(pattern, bg){
  const ink = patternInk(pattern, bg);
  return (!pattern.color && String(ink).toLowerCase() === "#ffffff") ? "#e4e9e0" : ink;
}
function chalkCanvas(n){
  if (typeof document !== "undefined" && document && typeof document.createElement === "function"){
    const canvas = document.createElement("canvas"); canvas.width = n; canvas.height = n; return canvas;
  }
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(n, n);
  return null;
}
// 색마다 한 장. 가루층(무늬 색)을 판 얼룩층(검정) 위에 얹은 결과를 한 픽셀로 미리 합쳐 둔다.
function chalkTile(ink){
  if (chalkTileCache.has(ink)) return chalkTileCache.get(ink);
  const hex = /^#([0-9a-f]{6})$/i.exec(String(ink || "")) ? String(ink).slice(1) : "e4e9e0";
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const fields = chalkTextureFields(CHALK_TILE, CHALK_SEED), n = fields.size;
  const canvas = chalkCanvas(n), c = canvas && canvas.getContext("2d");
  if (!c) return null;
  const image = c.createImageData(n, n), data = image.data;
  for (let i = 0, j = 0; i < n * n; i++, j += 4){
    const l = fields.light[i] / 255, d = fields.dark[i] / 255, a = l + d * (1 - l);
    const k = a ? l / a : 0;
    data[j] = r * k; data[j + 1] = g * k; data[j + 2] = b * k; data[j + 3] = Math.round(a * 255);
  }
  c.putImageData(image, 0, 0);
  chalkTileCache.set(ink, canvas);
  if (chalkTileCache.size > 6) chalkTileCache.delete(chalkTileCache.keys().next().value);
  return canvas;
}
// 크기 100 = 타일 한 칸이 보드 1536px. 타일 배경 그림과 같은 규칙으로 보드 원점에 맞춰 반복된다.
function drawChalkTexture(ctx, pattern, area, bg){
  if (typeof ctx.createPattern !== "function") return;
  const tile = chalkTile(chalkInk(pattern, bg));
  const fill = tile && ctx.createPattern(tile, "repeat");
  if (!fill) return;
  const scale = Math.max(.05, (Number(pattern.size) || 100) / 100);
  if (scale !== 1 && typeof DOMMatrix === "function" && typeof fill.setTransform === "function"){
    try { fill.setTransform(new DOMMatrix().scaleSelf(scale, scale)); } catch(_){}
  }
  ctx.save();
  ctx.globalAlpha = Math.max(.05, Math.min(1, Number(pattern.opacity) || .7));
  ctx.fillStyle = fill;
  ctx.fillRect(area.x, area.y, area.w, area.h);
  ctx.restore();
}
/* 배경 그림 한 장. 일반 이미지 항목과 달리 현재 보드 화면(area) 자체를 종이처럼 채운다.
   따라서 저장돼 있던 x·y·w·h나 보기 배율에 끌려다니지 않고, 창 크기가 바뀌면 채움·맞춤을
   그 화면에 다시 계산한다. 아직 안 불러온 그림은 건너뛴다 — 다 불러오면 다시 그린다. */
function drawBackgroundImage(ctx, image, area){
  const img = image && image.img;
  if (!img || !img.complete || !img.naturalWidth) return;
  const target = area || {
    x:Number(image.x) || 0, y:Number(image.y) || 0,
    w:Math.max(1, Number(image.w) || 1), h:Math.max(1, Number(image.h) || 1)
  };
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  let x = target.x, y = target.y, w = target.w, h = target.h;
  if (image.fit === "contain"){
    const scale = Math.min(target.w / nw, target.h / nh);
    w = nw * scale; h = nh * scale; x = cx - w / 2; y = cy - h / 2;
  } else if (image.fit === "actual"){
    w = nw; h = nh; x = cx - w / 2; y = cy - h / 2;
  }
  ctx.save();
  ctx.globalAlpha = Math.max(.05, Math.min(1, Number(image.opacity) || 1));
  if (image.fit === "tile" && area){
    // 무늬와 같은 규칙 — 칸은 보드 원점(0,0)에 맞춰 반복된다. createPattern 은 지금 변환을
    // 그대로 따르므로 확대·이동해도 판서와 함께 움직인다.
    const tile = Math.max(.1, (Number(image.tile) || 50) / 100);
    const pattern = ctx.createPattern(img, "repeat");
    if (pattern){
      if (tile !== 1 && typeof DOMMatrix === "function" && typeof pattern.setTransform === "function"){
        try { pattern.setTransform(new DOMMatrix().scaleSelf(tile, tile)); } catch(_){}
      }
      ctx.fillStyle = pattern;
      ctx.fillRect(area.x, area.y, area.w, area.h);
    }
  } else if (image.fit === "cover"){
    const scale = Math.max(w / nw, h / nh);            // 짧은 쪽을 채우는 배율 → 긴 쪽이 넘쳐 잘린다
    const sw = Math.min(nw, w / scale), sh = Math.min(nh, h / scale);
    ctx.drawImage(img, (nw - sw) / 2, (nh - sh) / 2, sw, sh, x, y, w, h);
  } else {
    ctx.drawImage(img, x, y, w, h);
  }
  ctx.restore();
}
/* 배경은 "먼저 칠하는 것"이 아니라 "맨 나중에 밑에 까는 것"이다(destination-over).
   지우개(destination-out)가 판서만 지우고 배경은 남기려면 이 순서여야 한다 — 먼저 칠해 두면
   지우개가 배경까지 뚫어 내보낸 PNG 에 구멍이 남는다. area 는 현재 화면에서 캔버스 전체가
   덮이는 사각형이며, 배경 그림은 이 사각형 자체에 맞춰진다. */
function paintBackground(ctx, area, opts){
  opts = opts || {};
  const bg = opts.bg || "#ffffff";
  const pattern = normalizePattern(opts.pattern);
  ctx.save();
  // destination-over 는 "밑에 깔기"라 그리는 차례가 곧 아래로 쌓이는 차례다.
  // 화면에서 보이는 위아래는 색 → 그림 → 무늬 → 판서 순(무늬는 사진 위에 얹혀야 눈금 구실을 한다).
  ctx.globalCompositeOperation = "destination-over";
  if (pattern) drawPattern(ctx, pattern, area, bg);
  ctx.globalCompositeOperation = "destination-over";
  if (opts.image) drawBackgroundImage(ctx, opts.image, area);
  ctx.globalCompositeOperation = "destination-over";
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.fillStyle = bg;
  ctx.fillRect(area.x, area.y, area.w, area.h);
  ctx.restore();
}

function drawArrowHead(ctx, x1, y1, x2, y2, w){
  const a = Math.atan2(y2 - y1, x2 - x1), len = 9 + w * 2.2;
  ctx.beginPath();
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(a - Math.PI / 7), y2 - len * Math.sin(a - Math.PI / 7));
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(a + Math.PI / 7), y2 - len * Math.sin(a + Math.PI / 7));
  ctx.stroke();
}

// 항목 하나를 그린다.
// limit: 펜/형광펜/지우개 스트로크에서 그릴 점 개수 상한(재생 시 획이 "그려지는" 성장 애니메이션용).
//        null/undefined 면 전체를 그린다.
// bg: 지우개가 배경색 덧칠이던 시절의 인자. 지금은 쓰지 않지만 호출부가 자리로 넘기고 있어 그대로 둔다.
function drawItem(ctx, it, bg, limit, inheritedFlipX=false, inheritedFlipY=false){
  if (!it) return;
  if (it.type === "group"){
    const sw = Math.max(1, Number(it.sourceW) || Number(it.w) || 1), sh = Math.max(1, Number(it.sourceH) || Number(it.h) || 1);
    ctx.save();
    const rotation = Number(it.rotation) || 0;          // 돌린 그룹은 상자 가운데를 축으로 통째로 돈다
    if (rotation){
      const cx = (Number(it.x) || 0) + (Number(it.w) || 0) / 2, cy = (Number(it.y) || 0) + (Number(it.h) || 0) / 2;
      ctx.translate(cx, cy); ctx.rotate(rotation); ctx.translate(-cx, -cy);
    }
    ctx.translate(Number(it.x) || 0, Number(it.y) || 0); ctx.scale((Number(it.w) || sw) / sw, (Number(it.h) || sh) / sh);
    const flipX = !!it.flipX, flipY = !!it.flipY;
    if (flipX || flipY){
      ctx.translate(flipX ? sw : 0, flipY ? sh : 0);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    }
    for (const child of (Array.isArray(it.items) ? it.items : [])){
      drawItem(ctx, child, bg, null, inheritedFlipX !== flipX, inheritedFlipY !== flipY);
    }
    ctx.restore(); ctx.globalAlpha = 1; return;
  }
  applyStroke(ctx, it);
  if (it.type === "pen" || it.type === "highlighter" || it.type === "eraser"){
    const p = it.points; if (!p || !p.length){ ctx.globalAlpha = 1; return; }
    const n = (limit == null) ? p.length : Math.max(1, Math.min(p.length, limit));
    ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(p[i].x, p[i].y);
    if (n === 1) ctx.lineTo(p[0].x + 0.01, p[0].y + 0.01);   // 점 하나도 보이게
    ctx.stroke();
  } else if (it.type === "line" || it.type === "arrow"){
    ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke();
    if (it.type === "arrow") drawArrowHead(ctx, it.x1, it.y1, it.x2, it.y2, it.width);
  } else if (it.type === "rect"){
    const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), w = Math.abs(it.x2 - it.x1), h = Math.abs(it.y2 - it.y1);
    if (it.fill) ctx.fillRect(x, y, w, h); else ctx.strokeRect(x, y, w, h);
  } else if (it.type === "ellipse"){
    ctx.beginPath();
    ctx.ellipse((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2, Math.abs(it.x2 - it.x1) / 2, Math.abs(it.y2 - it.y1) / 2, Number(it.rotation) || 0, 0, Math.PI * 2);
    if (it.fill) ctx.fill(); else ctx.stroke();
  } else if (it.type === "polyline"){
    const points = Array.isArray(it.points) ? it.points : [];
    if (points.length){
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (let i=1;i<points.length;i++) ctx.lineTo(points[i].x, points[i].y);
      if (it.closed) ctx.closePath();
      if (it.fill) ctx.fill(); else ctx.stroke();
    }
  } else if (it.type === "text"){
    ctx.globalAlpha = 1; ctx.fillStyle = it.color; ctx.textBaseline = "top";
    ctx.font = it.fontSize + 'px system-ui,"Malgun Gothic",sans-serif';
    const lines = String(it.text || "").split("\n");
    // 돌린 글(rotation, 라디안)은 왼쪽 위 (x,y) 를 축으로 돈다 — 글을 고치거나 크기를 바꿔도 첫 글자 자리가 그대로다.
    const rotation = Number(it.rotation) || 0;
    const tx = rotation ? 0 : it.x, ty = rotation ? 0 : it.y;
    if (rotation){ ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(rotation); }
    if (inheritedFlipX || inheritedFlipY){
      const fs = Math.max(1, Number(it.fontSize) || 16);
      const widthOf = (line) => (typeof ctx.measureText === "function" ? ctx.measureText(line).width : String(line).length * fs * .6);
      const textW = Math.max(1, ...lines.map(widthOf)), textH = Math.max(fs, lines.length * fs * 1.25);
      ctx.save();
      ctx.translate(inheritedFlipX ? 2 * tx + textW : 0, inheritedFlipY ? 2 * ty + textH : 0);
      ctx.scale(inheritedFlipX ? -1 : 1, inheritedFlipY ? -1 : 1);
      lines.forEach((ln, i) => ctx.fillText(ln, tx, ty + i * fs * 1.25));
      ctx.restore();
    } else {
      lines.forEach((ln, i) => ctx.fillText(ln, tx, ty + i * it.fontSize * 1.25));
    }
    if (rotation) ctx.restore();
  } else if (it.type === "image"){
    ctx.globalAlpha = 1;
    if (it.img && it.img.complete){
      // 돌리기(rotation, 라디안)는 가운데를 축으로, 뒤집기는 돌린 뒤 그림 자신의 축으로.
      const rotation = Number(it.rotation) || 0;
      if (it.flipX || it.flipY || rotation){
        ctx.save(); ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
        if (rotation) ctx.rotate(rotation);
        ctx.scale(it.flipX ? -1 : 1, it.flipY ? -1 : 1);
        ctx.drawImage(it.img, -it.w / 2, -it.h / 2, it.w, it.h); ctx.restore();
      } else ctx.drawImage(it.img, it.x, it.y, it.w, it.h);
    }
  }
  ctx.globalAlpha = 1;
  // 지우개가 켜 둔 destination-out 을 여기서 반드시 되돌린다 — 남으면 다음 항목이 화면을 갉아먹는다.
  ctx.globalCompositeOperation = "source-over";
}

// 항목 배열을 순서대로 그린다(재생용). opts.lastLimit 이 있으면 마지막 항목만 부분(획 성장)으로 그린다.
function drawItems(ctx, items, opts){
  opts = opts || {};
  const bg = opts.bg || "#ffffff";
  for (let i = 0; i < items.length; i++){
    const isLast = (i === items.length - 1);
    drawItem(ctx, items[i], bg, (isLast ? opts.lastLimit : null));
  }
  ctx.globalCompositeOperation = "source-over";
}

const SELECTABLE_TYPES = new Set(["image", "line", "arrow", "rect", "ellipse", "polyline", "text", "group"]);

function isSelectable(it){
  return !!(it && SELECTABLE_TYPES.has(it.type));
}

// 선택 표시와 히트테스트에 쓰는 항목 경계. 텍스트 폭은 화면과 같은 캔버스 글꼴로 외부에서 측정한다.
function itemBounds(it, measureText){
  if (!isSelectable(it)) return null;
  if ((it.type === "image" || it.type === "group") && Number(it.rotation)){
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, a = Number(it.rotation);
    const hw = (Math.abs(it.w * Math.cos(a)) + Math.abs(it.h * Math.sin(a))) / 2;
    const hh = (Math.abs(it.w * Math.sin(a)) + Math.abs(it.h * Math.cos(a))) / 2;
    return { x:cx - hw, y:cy - hh, w:hw * 2, h:hh * 2 };
  }
  if (it.type === "image" || it.type === "group") return { x:it.x, y:it.y, w:it.w, h:it.h };
  if (it.type === "text"){
    const fs = Math.max(1, Number(it.fontSize) || 16);
    const lines = String(it.text || "").split("\n");
    const widthOf = (typeof measureText === "function") ? measureText : (line) => String(line).length * fs * 0.6;
    let w = 1;
    for (const line of lines) w = Math.max(w, Number(widthOf(line, fs)) || 0);
    const h = Math.max(fs, lines.length * fs * 1.25), a = Number(it.rotation) || 0;
    if (!a) return { x:it.x, y:it.y, w, h };
    // 돌린 글: (x,y) 를 축으로 돌린 네 모서리를 감싼 상자
    const cos = Math.cos(a), sin = Math.sin(a);
    const xs = [0, w * cos, -h * sin, w * cos - h * sin], ys = [0, w * sin, h * cos, w * sin + h * cos];
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { x:it.x + x0, y:it.y + y0, w:Math.max(...xs) - x0, h:Math.max(...ys) - y0 };
  }
  if (it.type === "ellipse" && Number(it.rotation)){
    const cx=(it.x1+it.x2)/2, cy=(it.y1+it.y2)/2, rx=Math.abs(it.x2-it.x1)/2, ry=Math.abs(it.y2-it.y1)/2, a=Number(it.rotation);
    const bw=Math.sqrt(rx*rx*Math.cos(a)*Math.cos(a)+ry*ry*Math.sin(a)*Math.sin(a));
    const bh=Math.sqrt(rx*rx*Math.sin(a)*Math.sin(a)+ry*ry*Math.cos(a)*Math.cos(a));
    return { x:cx-bw,y:cy-bh,w:bw*2,h:bh*2 };
  }
  if (it.type === "polyline"){
    const points = Array.isArray(it.points) ? it.points : [];
    if (!points.length) return null;
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w:Math.max(...xs)-x, h:Math.max(...ys)-y };
  }
  const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2);
  return { x, y, w:Math.abs(it.x2 - it.x1), h:Math.abs(it.y2 - it.y1) };
}

function pointSegmentDistance(p, a, b){
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/* edgeOnly 면 속이 빈(fill 없는) 사각형·원은 테두리 근처만 맞은 것으로 친다.
   화이트보드는 먼저 이렇게 찾고, 아무것도 없을 때만 속까지 넓혀 찾는다 — 빈 상자가 그 안의 글·수식을 가리지 않게. */
function hitTestItem(it, p, measureText, tolerance, edgeOnly){
  if (!isSelectable(it) || !p) return false;
  const tol = Math.max(4, Number(tolerance) || 0, (Number(it.width) || 0) / 2 + 3);
  if (edgeOnly && !it.fill && (it.type === "rect" || it.type === "ellipse")){
    if (!hitTestItem(it, p, measureText, tolerance)) return false;
    if (it.type === "rect"){
      const b = itemBounds(it, measureText);
      return !(p.x > b.x + tol && p.x < b.x + b.w - tol && p.y > b.y + tol && p.y < b.y + b.h - tol);
    }
    const rx = Math.abs(it.x2 - it.x1) / 2 - tol, ry = Math.abs(it.y2 - it.y1) / 2 - tol;
    if (rx <= 0 || ry <= 0) return true;
    const cx = (it.x1 + it.x2) / 2, cy = (it.y1 + it.y2) / 2, a = -(Number(it.rotation) || 0);
    const dx = p.x - cx, dy = p.y - cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) > 1;
  }
  if (it.type === "line" || it.type === "arrow"){
    return pointSegmentDistance(p, { x:it.x1, y:it.y1 }, { x:it.x2, y:it.y2 }) <= tol;
  }
  if (it.type === "polyline"){
    const points = Array.isArray(it.points) ? it.points : [];
    for (let i=1;i<points.length;i++) if (pointSegmentDistance(p, points[i-1], points[i]) <= tol) return true;
    return false;
  }
  if (it.type === "ellipse"){
    const cx=(it.x1+it.x2)/2, cy=(it.y1+it.y2)/2, rx=Math.max(Math.abs(it.x2-it.x1)/2,tol), ry=Math.max(Math.abs(it.y2-it.y1)/2,tol), a=-(Number(it.rotation)||0);
    const dx=p.x-cx, dy=p.y-cy, lx=dx*Math.cos(a)-dy*Math.sin(a), ly=dx*Math.sin(a)+dy*Math.cos(a);
    return (lx*lx)/(rx*rx)+(ly*ly)/(ry*ry)<=1;
  }
  if (it.type === "text" && Number(it.rotation)){
    // 돌린 글은 (x,y) 축으로 기울기를 풀어 글 상자 안인지 본다.
    const box = itemBounds(Object.assign({}, it, { rotation:0 }), measureText), a = -Number(it.rotation);
    const dx = p.x - it.x, dy = p.y - it.y, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    return lx >= -tol && lx <= box.w + tol && ly >= -tol && ly <= box.h + tol;
  }
  if ((it.type === "image" || it.type === "group") && Number(it.rotation)){
    // 돌린 그림·그룹은 기울기를 풀어 자기 상자 안인지 본다(경계 상자로 재면 빈 모서리까지 잡힌다).
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, a = -Number(it.rotation);
    const dx = p.x - cx, dy = p.y - cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= Math.abs(it.w) / 2 + tol && Math.abs(ly) <= Math.abs(it.h) / 2 + tol;
  }
  const b = itemBounds(it, measureText); if (!b) return false;
  return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
}

function translateItem(it, dx, dy){
  if (!isSelectable(it)) return it;
  const moved = Object.assign({}, it);
  if (it.type === "image" || it.type === "text" || it.type === "group"){
    moved.x = it.x + dx; moved.y = it.y + dy;
  } else if (it.type === "polyline"){
    moved.points = (it.points || []).map((p) => ({ x:p.x + dx, y:p.y + dy }));
  } else {
    moved.x1 = it.x1 + dx; moved.y1 = it.y1 + dy;
    moved.x2 = it.x2 + dx; moved.y2 = it.y2 + dy;
  }
  return moved;
}

/* 항목 하나를 점 c 를 축으로 angle(라디안)만큼 돌린다. 화이트보드의 돌리기 손잡이·돌린 그룹 풀기가 같이 쓴다.
   - 선·꺾은선·펜 획은 점을 돌리고, 사각형은 기울면 닫힌 다각형이 된다(90° 배수면 사각형 그대로 — '변환' 도구와 같은 규칙).
   - 원·그림·그룹은 가운데를 옮기고 rotation 을 더하며, 글은 돌리기 축인 왼쪽 위 (x,y) 를 옮기고 rotation 을 더한다.
   rotation 은 -π~π 로 접고 0 이면 속성을 지워, 한 바퀴 돌려 제자리면 저장본도 예전과 같다. */
function rotateItem(it, c, angle){
  if (!it || !c || !Number(angle)) return it;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const round = (v) => Math.round(v * 1e4) / 1e4;
  const turn = (x, y) => ({ x:round(c.x + (x - c.x) * cos - (y - c.y) * sin), y:round(c.y + (x - c.x) * sin + (y - c.y) * cos) });
  const out = Object.assign({}, it);
  const addRotation = () => {
    const r = Math.round(Math.atan2(Math.sin((Number(it.rotation) || 0) + angle), Math.cos((Number(it.rotation) || 0) + angle)) * 1e6) / 1e6;
    if (Math.abs(r) < 1e-6) delete out.rotation; else out.rotation = r;
  };
  if (it.type === "line" || it.type === "arrow"){
    const a = turn(it.x1, it.y1), b = turn(it.x2, it.y2);
    out.x1 = a.x; out.y1 = a.y; out.x2 = b.x; out.y2 = b.y;
  } else if (Array.isArray(it.points)){
    out.points = it.points.map((p) => turn(p.x, p.y));
  } else if (it.type === "rect"){
    const corners = [turn(it.x1, it.y1), turn(it.x2, it.y1), turn(it.x2, it.y2), turn(it.x1, it.y2)];
    const axisAligned = (Math.abs(corners[0].y - corners[1].y) < .01 && Math.abs(corners[1].x - corners[2].x) < .01)
      || (Math.abs(corners[0].x - corners[1].x) < .01 && Math.abs(corners[1].y - corners[2].y) < .01);
    if (axisAligned){
      const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
      out.x1 = Math.min(...xs); out.y1 = Math.min(...ys); out.x2 = Math.max(...xs); out.y2 = Math.max(...ys);
    } else {
      out.type = "polyline"; out.points = corners; out.closed = true;
      delete out.x1; delete out.y1; delete out.x2; delete out.y2;
    }
  } else if (it.type === "ellipse"){
    const m = turn((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2), rx = Math.abs(it.x2 - it.x1) / 2, ry = Math.abs(it.y2 - it.y1) / 2;
    out.x1 = m.x - rx; out.y1 = m.y - ry; out.x2 = m.x + rx; out.y2 = m.y + ry; addRotation();
  } else if (it.type === "image" || it.type === "group"){
    const m = turn(it.x + it.w / 2, it.y + it.h / 2);
    out.x = m.x - it.w / 2; out.y = m.y - it.h / 2; addRotation();
  } else if (it.type === "text"){
    const m = turn(it.x, it.y);
    out.x = m.x; out.y = m.y; addRotation();
  } else return it;
  return out;
}

// 그룹을 현재 보드 좌표의 독립 항목들로 푼다. 기존 그룹 객체와 자식은 바꾸지 않는다.
function ungroupItem(group, measureText){
  if (!group || group.type !== "group" || !Array.isArray(group.items)) return [];
  if (Number(group.rotation)){
    // 돌린 그룹: 돌리기 전 자리로 푼 다음 조각마다 그룹 가운데를 축으로 같은 만큼 돌린다.
    const center = { x:(Number(group.x) || 0) + (Number(group.w) || 0) / 2, y:(Number(group.y) || 0) + (Number(group.h) || 0) / 2 };
    const upright = Object.assign({}, group); delete upright.rotation;
    return ungroupItem(upright, measureText).map((child) => rotateItem(child, center, Number(group.rotation)));
  }
  const sw = Math.max(1, Number(group.sourceW) || Number(group.w) || 1), sh = Math.max(1, Number(group.sourceH) || Number(group.h) || 1);
  const sx = (Number(group.w) || sw) / sw, sy = (Number(group.h) || sh) / sh;
  const ox = Number(group.x) || 0, oy = Number(group.y) || 0, widthScale = (Math.abs(sx) + Math.abs(sy)) / 2;
  const flipX = !!group.flipX, flipY = !!group.flipY;
  const mapX = (x) => ox + (flipX ? sw - x : x) * sx;
  const mapY = (y) => oy + (flipY ? sh - y : y) * sy;
  const scaleOne = (it) => {
    const out = Object.assign({}, it);
    if (it.type === "text" && Number(it.rotation)){
      // 돌린 글: 글 가운데를 뒤집어 옮기고(글자는 뒤집지 않는다), 한쪽만 뒤집혔으면 기운 방향도 반대로.
      const b = itemBounds(Object.assign({}, it, { rotation:0 }), measureText) || { w:0, h:0 };
      const a = Number(it.rotation), turn = (r, x, y) => ({ x:x * Math.cos(r) - y * Math.sin(r), y:x * Math.sin(r) + y * Math.cos(r) });
      const half = turn(a, b.w / 2, b.h / 2);
      const a2 = flipX !== flipY ? -a : a, half2 = turn(a2, b.w / 2 * widthScale, b.h / 2 * widthScale);
      out.x = mapX(it.x + half.x) - half2.x; out.y = mapY(it.y + half.y) - half2.y; out.rotation = a2;
      out.fontSize = Math.max(1, (Number(it.fontSize) || 16) * widthScale);
    } else if (it.type === "text"){
      const b = itemBounds(it, measureText) || { x:it.x, y:it.y, w:0, h:0 };
      out.x = ox + (flipX ? sw - b.x - b.w : it.x) * sx;
      out.y = oy + (flipY ? sh - b.y - b.h : it.y) * sy;
      out.fontSize = Math.max(1, (Number(it.fontSize) || 16) * widthScale);
    } else if (it.type === "image" || it.type === "group"){
      out.x = ox + (flipX ? sw - it.x - it.w : it.x) * sx;
      out.y = oy + (flipY ? sh - it.y - it.h : it.y) * sy;
      out.w = it.w * sx; out.h = it.h * sy;
      if (flipX) out.flipX = !out.flipX;
      if (flipY) out.flipY = !out.flipY;
      if (flipX !== flipY && Number(out.rotation)) out.rotation = -Number(out.rotation);
    } else if (it.type === "polyline"){
      out.points = (it.points || []).map((p) => ({ x:mapX(p.x), y:mapY(p.y) }));
    } else {
      out.x1 = mapX(it.x1); out.y1 = mapY(it.y1);
      out.x2 = mapX(it.x2); out.y2 = mapY(it.y2);
      if (it.type === "ellipse" && flipX !== flipY && Number(out.rotation)) out.rotation = -Number(out.rotation);
    }
    if (out.width != null) out.width = Math.max(.5, Number(out.width) * widthScale);
    if (Array.isArray(out.dash)) out.dash = out.dash.map((n) => n * widthScale);
    return out;
  };
  return group.items.map(scaleOne);
}

return Object.freeze({ applyStroke, drawItem, drawItems, paintBackground, drawPattern, chalkTextureFields, drawBackgroundImage, isSelectable, itemBounds, hitTestItem, translateItem, rotateItem, ungroupItem });
})();
