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
    ctx.save(); ctx.translate(Number(it.x) || 0, Number(it.y) || 0); ctx.scale((Number(it.w) || sw) / sw, (Number(it.h) || sh) / sh);
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
    if (inheritedFlipX || inheritedFlipY){
      const fs = Math.max(1, Number(it.fontSize) || 16);
      const widthOf = (line) => (typeof ctx.measureText === "function" ? ctx.measureText(line).width : String(line).length * fs * .6);
      const textW = Math.max(1, ...lines.map(widthOf)), textH = Math.max(fs, lines.length * fs * 1.25);
      ctx.save();
      ctx.translate(inheritedFlipX ? 2 * it.x + textW : 0, inheritedFlipY ? 2 * it.y + textH : 0);
      ctx.scale(inheritedFlipX ? -1 : 1, inheritedFlipY ? -1 : 1);
      lines.forEach((ln, i) => ctx.fillText(ln, it.x, it.y + i * fs * 1.25));
      ctx.restore();
    } else {
      lines.forEach((ln, i) => ctx.fillText(ln, it.x, it.y + i * it.fontSize * 1.25));
    }
  } else if (it.type === "image"){
    ctx.globalAlpha = 1;
    if (it.img && it.img.complete){
      if (it.flipX || it.flipY){
        ctx.save(); ctx.translate(it.x + it.w / 2, it.y + it.h / 2); ctx.scale(it.flipX ? -1 : 1, it.flipY ? -1 : 1);
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
  if (it.type === "image" || it.type === "group") return { x:it.x, y:it.y, w:it.w, h:it.h };
  if (it.type === "text"){
    const fs = Math.max(1, Number(it.fontSize) || 16);
    const lines = String(it.text || "").split("\n");
    const widthOf = (typeof measureText === "function") ? measureText : (line) => String(line).length * fs * 0.6;
    let w = 1;
    for (const line of lines) w = Math.max(w, Number(widthOf(line, fs)) || 0);
    return { x:it.x, y:it.y, w, h:Math.max(fs, lines.length * fs * 1.25) };
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

function hitTestItem(it, p, measureText, tolerance){
  if (!isSelectable(it) || !p) return false;
  const tol = Math.max(4, Number(tolerance) || 0, (Number(it.width) || 0) / 2 + 3);
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

// 그룹을 현재 보드 좌표의 독립 항목들로 푼다. 기존 그룹 객체와 자식은 바꾸지 않는다.
function ungroupItem(group, measureText){
  if (!group || group.type !== "group" || !Array.isArray(group.items)) return [];
  const sw = Math.max(1, Number(group.sourceW) || Number(group.w) || 1), sh = Math.max(1, Number(group.sourceH) || Number(group.h) || 1);
  const sx = (Number(group.w) || sw) / sw, sy = (Number(group.h) || sh) / sh;
  const ox = Number(group.x) || 0, oy = Number(group.y) || 0, widthScale = (Math.abs(sx) + Math.abs(sy)) / 2;
  const flipX = !!group.flipX, flipY = !!group.flipY;
  const mapX = (x) => ox + (flipX ? sw - x : x) * sx;
  const mapY = (y) => oy + (flipY ? sh - y : y) * sy;
  const scaleOne = (it) => {
    const out = Object.assign({}, it);
    if (it.type === "text"){
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

return Object.freeze({ applyStroke, drawItem, drawItems, paintBackground, drawPattern, drawBackgroundImage, isSelectable, itemBounds, hitTestItem, translateItem, ungroupItem });
})();
