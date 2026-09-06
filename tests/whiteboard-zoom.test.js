"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { whiteboardClampView, whiteboardZoomAt } = require("../src/js/whiteboard.js");

test("화이트보드 배율과 화면 이동은 안전한 범위로 제한된다", () => {
  assert.deepEqual(whiteboardClampView({scale:.1,x:99,y:99},800,600), {scale:.25,x:99,y:99});
  assert.deepEqual(whiteboardClampView({scale:.5,x:-100,y:20},800,600), {scale:.5,x:-100,y:20});
  assert.deepEqual(whiteboardClampView({scale:1,x:180,y:-120},800,600), {scale:1,x:180,y:-120});
  assert.deepEqual(whiteboardClampView({scale:8,x:100,y:-9999},800,600), {scale:4,x:100,y:-2352});
});

test("포인터 중심 확대는 포인터 아래의 보드 좌표를 유지한다", () => {
  const anchor = {x:300,y:200};
  const next = whiteboardZoomAt({scale:1,x:0,y:0},2,anchor,800,600);
  assert.deepEqual(next,{scale:2,x:-300,y:-200});
  assert.equal((anchor.x-next.x)/next.scale,300);
  assert.equal((anchor.y-next.y)/next.scale,200);
  assert.deepEqual(whiteboardZoomAt(next,1,anchor,800,600),{scale:1,x:0,y:0});
});

test("화이트보드 휠·화면 이동·원본 내보내기 배선이 함께 들어 있다", () => {
  const source=fs.readFileSync(path.join(__dirname,"../src/js/whiteboard.js"),"utf8");
  const css=fs.readFileSync(path.join(__dirname,"../src/styles.css"),"utf8");
  assert.match(source,/canvas\.addEventListener\("wheel"[\s\S]{0,260}passive:false/);
  assert.match(source,/e\.button === 1 \|\| \(e\.button === 0 && spacePanning\)/);
  assert.match(source,/if \(!startSelect\(e\) && !backgroundViewLocked\(\)\) beginViewPan\(e\)/);
  assert.match(source,/itemAt\(p\) \? "move" : "grab"/);
  // Space 손바닥 이동은 열려 있는 패널이 하나라도 있으면 양보한다(패널이 늘면 조건도 길어진다).
  assert.match(source,/e\.code === "Space"[\s\S]{0,240}pan-ready/);
  assert.match(source,/withBoardExport[\s\S]{0,260}view\.scale=1; view\.x=0; view\.y=0/);
  assert.match(source,/zoomLabelBtn = mkBtn\([\s\S]{0,220}resetView/);
  // 배경 그림은 화면 자체이므로 그림과 판서가 어긋나는 확대·이동을 잠근다.
  assert.match(source,/if \(backgroundViewLocked\(\)\)\{[\s\S]{0,140}view\.scale = 1/);
  assert.match(source,/e\.code === "Space" && !backgroundViewLocked\(\)/);
  assert.match(css,/\.wb-canvas\.pan-ready\{cursor:grab!important\}/);
  assert.match(css,/\.wb-canvas\.panning\{cursor:grabbing!important\}/);
});

// 끄는 동안에는 캔버스만 다시 그린다.
// 예전에는 redraw 하나가 캔버스와 도구막대를 함께 맡아, 도형을 끄는 매 pointermove 마다
// 버튼 disabled·색 스와치·배율 라벨까지 다시 썼다(값은 하나도 안 바뀌는데 레이아웃만 다시 쟀다).
// 되돌아가기 쉬운 종류라 — "왜 이 줄만 paint 지?" 하고 redraw 로 고쳐 놓으면 조용히 느려진다 — 계약으로 박아 둔다.
test("끌기는 캔버스만 다시 그리고 도구막대는 손대지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname,"../src/js/whiteboard.js"),"utf8");
  const between = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));

  // redraw 는 두 가지를 다 하는 합성 함수로 남는다 — 기존 호출부 60여 곳이 그대로 쓴다.
  assert.match(source, /const redraw = \(\) => \{ paint\(\); syncControls\(\); \};/);

  const paint = between("const paint = () => {", "const syncControls");
  const syncControls = between("const syncControls = () => {", "const redraw = () =>");

  // paint 는 화면 좌표와 항목에만 기댄다. 도구막대·집중 겹침은 여기 들어오면 안 된다.
  for (const forbidden of ["syncSelectionControls", "renderFocus", "zoomLabelBtn", "flipXBtn", "groupActionBtn"]){
    assert.ok(!paint.includes(forbidden), `paint 는 도구막대를 건드리지 않아야 한다: ${forbidden}`);
  }
  // 반대로 syncControls 는 캔버스를 그리지 않는다.
  assert.ok(!/\bctx\./.test(syncControls), "syncControls 는 캔버스에 그리지 않아야 한다");
  assert.match(syncControls, /syncSelectionControls\(\);[\s\S]*renderFocus\(\);/);

  // 잦은 끌기 네 갈래는 paint 만 부른다.
  assert.match(source, /clampView\(\); paint\(\);/);                                  // 화면 이동
  assert.match(source, /if \(mode === "move"\) paint\(\); else redraw\(\);/);          // 항목 옮기기(크기조절은 '크기 %'가 살아 움직여야 해서 redraw)
  assert.match(source, /Math\.abs\(sweep\) \* 180 \/ Math\.PI[\s\S]{0,140}\n\s*paint\(\);/); // 자·각도기·컴퍼스
  assert.match(source, /cur\.x2 = p\.x; cur\.y2 = p\.y; paint\(\); drawItem\(cur\);/); // 도형 그리는 중

  // 손을 떼면 반드시 전체를 맞춘다 — 끄는 동안 미뤄 둔 도구막대 상태가 여기서 따라잡는다.
  assert.match(source, /const up = \(\) => \{[\s\S]{0,220}redraw\(\); if \(cloned\)/);
  assert.match(source, /wb\.items\.push\(finished\); cur = null; redraw\(\);/);
});

// 커서 모양 판정도 프레임에 묶는다.
// 판정 한 번은 항목 목록을 최대 네 번 훑고(교구 손잡이·슬라이더·화살촉·항목), 좌표를 구하는 pt()
// 는 그때마다 getBoundingClientRect 로 레이아웃을 읽는다. 포인터 이벤트는 초당 100번 넘게 온다.
// 이 구조는 화면상 티가 안 나서 "왜 굳이 프레임을 거치지?" 하고 되돌리기 쉬우므로 계약으로 박아 둔다.
test("커서 모양은 마우스 이벤트마다가 아니라 프레임마다 한 번만 정한다", () => {
  const source = fs.readFileSync(path.join(__dirname,"../src/js/whiteboard.js"),"utf8");
  const handlerAt = source.indexOf("const updateHoverCursor = () => {");
  assert.ok(handlerAt > 0, "커서 판정은 updateHoverCursor 한 곳에 모여 있어야 한다");
  const listenerAt = source.indexOf('canvas.addEventListener("pointermove"', handlerAt);
  assert.ok(listenerAt > handlerAt, "판정 함수 바로 뒤에 그 좌표를 남기는 pointermove 가 있어야 한다");
  const handler = source.slice(handlerAt, listenerAt);
  const listener = source.slice(listenerAt, source.indexOf("});", listenerAt));

  // 듣는 쪽은 좌표만 남기고 프레임을 예약한다 — 여기서 판정하면 안 된다.
  assert.match(listener, /hoverAt = \{ clientX:e\.clientX, clientY:e\.clientY \};/);
  assert.match(listener, /if \(!hoverFrame\) hoverFrame = requestAnimationFrame\(updateHoverCursor\);/);
  for (const hitTest of ["gearHandleAt", "plotSliderHitAt", "arrowTipAt", "itemAt", "handleAt"]){
    assert.ok(!listener.includes(hitTest), `pointermove 안에서 판정하면 안 된다: ${hitTest}`);
  }

  // 판정하는 쪽은 좌표를 한 번만 구한다(예전에는 판정마다 pt(e) 를 다시 불러 레이아웃을 다섯 번 읽었다).
  assert.equal((handler.match(/pt\(e\)/g) || []).length, 1);
  assert.match(handler, /const p = pt\(e\);\s*\n\s*const gearHover = gearHandleAt\(p\);/);
  assert.match(handler, /if \(!e \|\| drawing\) return;/);          // 프레임을 기다리는 사이 그리기가 시작되면 버린다

  // 문서를 닫을 때 예약해 둔 프레임도 함께 거둔다.
  assert.match(source, /if \(hoverFrame\) cancelAnimationFrame\(hoverFrame\);/);
});
