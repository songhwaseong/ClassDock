"use strict";

/* ===== 화이트보드/리플레이 공용 벡터 렌더러 =====
   whiteboard.js(편집 화면)와 lesson-replay.js(수업 재생)가 같은 그리기 코드를 공유해,
   되감아 보는 재생 화면이 판서할 때와 픽셀 단위로 일치하도록 한다.
   좌표는 모두 CSS px 기준(캔버스 리사이즈와 무관). 새 라이브러리 없이 canvas 2d 만 사용. */

// 항목 종류별 선/색/투명도 상태를 ctx 에 반영. 지우개는 배경색(bg)으로 덮어 그린다.
const MNBoardRenderer = (() => {
function applyStroke(ctx, it, bg){
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.setLineDash(Array.isArray(it.dash) ? it.dash : []);
  ctx.lineWidth = Number(it.width) || 1; ctx.strokeStyle = it.color || "#111111"; ctx.fillStyle = it.color || "#111111";
  ctx.globalAlpha = (it.type === "highlighter") ? 0.30 : 1;
  if (it.type === "eraser"){ ctx.strokeStyle = bg; ctx.globalAlpha = 1; }
  if (Number.isFinite(it.alpha)) ctx.globalAlpha *= Math.max(0, Math.min(1, it.alpha));
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
function drawItem(ctx, it, bg, limit){
  if (!it) return;
  if (it.type === "group"){
    const sw = Math.max(1, Number(it.sourceW) || Number(it.w) || 1), sh = Math.max(1, Number(it.sourceH) || Number(it.h) || 1);
    ctx.save(); ctx.translate(Number(it.x) || 0, Number(it.y) || 0); ctx.scale((Number(it.w) || sw) / sw, (Number(it.h) || sh) / sh);
    for (const child of (Array.isArray(it.items) ? it.items : [])) drawItem(ctx, child, bg);
    ctx.restore(); ctx.globalAlpha = 1; return;
  }
  applyStroke(ctx, it, bg);
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
    String(it.text || "").split("\n").forEach((ln, i) => ctx.fillText(ln, it.x, it.y + i * it.fontSize * 1.25));
  } else if (it.type === "image"){
    ctx.globalAlpha = 1; if (it.img && it.img.complete) ctx.drawImage(it.img, it.x, it.y, it.w, it.h);
  }
  ctx.globalAlpha = 1;
}

// 항목 배열을 순서대로 그린다(재생용). opts.lastLimit 이 있으면 마지막 항목만 부분(획 성장)으로 그린다.
function drawItems(ctx, items, opts){
  opts = opts || {};
  const bg = opts.bg || "#ffffff";
  for (let i = 0; i < items.length; i++){
    const isLast = (i === items.length - 1);
    drawItem(ctx, items[i], bg, (isLast ? opts.lastLimit : null));
  }
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
function ungroupItem(group){
  if (!group || group.type !== "group" || !Array.isArray(group.items)) return [];
  const sw = Math.max(1, Number(group.sourceW) || Number(group.w) || 1), sh = Math.max(1, Number(group.sourceH) || Number(group.h) || 1);
  const sx = (Number(group.w) || sw) / sw, sy = (Number(group.h) || sh) / sh;
  const ox = Number(group.x) || 0, oy = Number(group.y) || 0, widthScale = (Math.abs(sx) + Math.abs(sy)) / 2;
  const scaleOne = (it) => {
    const out = Object.assign({}, it);
    if (it.type === "text" || it.type === "image" || it.type === "group"){
      out.x = ox + it.x * sx; out.y = oy + it.y * sy;
      if (it.type !== "text"){ out.w = it.w * sx; out.h = it.h * sy; }
      else out.fontSize = Math.max(1, (Number(it.fontSize) || 16) * widthScale);
    } else if (it.type === "polyline"){
      out.points = (it.points || []).map((p) => ({ x:ox + p.x * sx, y:oy + p.y * sy }));
    } else {
      out.x1 = ox + it.x1 * sx; out.y1 = oy + it.y1 * sy;
      out.x2 = ox + it.x2 * sx; out.y2 = oy + it.y2 * sy;
    }
    if (out.width != null) out.width = Math.max(.5, Number(out.width) * widthScale);
    if (Array.isArray(out.dash)) out.dash = out.dash.map((n) => n * widthScale);
    return out;
  };
  return group.items.map(scaleOne);
}

return Object.freeze({ applyStroke, drawItem, drawItems, isSelectable, itemBounds, hitTestItem, translateItem, ungroupItem });
})();
