"use strict";

/* ===== 화이트보드/리플레이 공용 벡터 렌더러 =====
   whiteboard.js(편집 화면)와 lesson-replay.js(수업 재생)가 같은 그리기 코드를 공유해,
   되감아 보는 재생 화면이 판서할 때와 픽셀 단위로 일치하도록 한다.
   좌표는 모두 CSS px 기준(캔버스 리사이즈와 무관). 새 라이브러리 없이 canvas 2d 만 사용. */

// 항목 종류별 선/색/투명도 상태를 ctx 에 반영. 지우개는 배경색(bg)으로 덮어 그린다.
function boardApplyStroke(ctx, it, bg){
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = it.width; ctx.strokeStyle = it.color; ctx.fillStyle = it.color;
  ctx.globalAlpha = (it.type === "highlighter") ? 0.30 : 1;
  if (it.type === "eraser"){ ctx.strokeStyle = bg; ctx.globalAlpha = 1; }
}

function boardDrawArrowHead(ctx, x1, y1, x2, y2, w){
  const a = Math.atan2(y2 - y1, x2 - x1), len = 9 + w * 2.2;
  ctx.beginPath();
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(a - Math.PI / 7), y2 - len * Math.sin(a - Math.PI / 7));
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(a + Math.PI / 7), y2 - len * Math.sin(a + Math.PI / 7));
  ctx.stroke();
}

// 항목 하나를 그린다.
// limit: 펜/형광펜/지우개 스트로크에서 그릴 점 개수 상한(재생 시 획이 "그려지는" 성장 애니메이션용).
//        null/undefined 면 전체를 그린다.
function boardDrawItem(ctx, it, bg, limit){
  if (!it) return;
  boardApplyStroke(ctx, it, bg);
  if (it.type === "pen" || it.type === "highlighter" || it.type === "eraser"){
    const p = it.points; if (!p || !p.length){ ctx.globalAlpha = 1; return; }
    const n = (limit == null) ? p.length : Math.max(1, Math.min(p.length, limit));
    ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(p[i].x, p[i].y);
    if (n === 1) ctx.lineTo(p[0].x + 0.01, p[0].y + 0.01);   // 점 하나도 보이게
    ctx.stroke();
  } else if (it.type === "line" || it.type === "arrow"){
    ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke();
    if (it.type === "arrow") boardDrawArrowHead(ctx, it.x1, it.y1, it.x2, it.y2, it.width);
  } else if (it.type === "rect"){
    ctx.strokeRect(Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.abs(it.x2 - it.x1), Math.abs(it.y2 - it.y1));
  } else if (it.type === "ellipse"){
    ctx.beginPath();
    ctx.ellipse((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2, Math.abs(it.x2 - it.x1) / 2, Math.abs(it.y2 - it.y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
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
function boardDrawItems(ctx, items, opts){
  opts = opts || {};
  const bg = opts.bg || "#ffffff";
  for (let i = 0; i < items.length; i++){
    const isLast = (i === items.length - 1);
    boardDrawItem(ctx, items[i], bg, (isLast ? opts.lastLimit : null));
  }
}
