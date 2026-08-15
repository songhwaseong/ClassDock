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
  assert.match(source,/if \(!startSelect\(e\)\) beginViewPan\(e\)/);
  assert.match(source,/itemAt\(p\) \? "move" : "grab"/);
  // Space 손바닥 이동은 열려 있는 패널이 하나라도 있으면 양보한다(패널이 늘면 조건도 길어진다).
  assert.match(source,/e\.code === "Space"[\s\S]{0,240}pan-ready/);
  assert.match(source,/withBoardExport[\s\S]{0,260}view\.scale=1; view\.x=0; view\.y=0/);
  assert.match(source,/zoomLabelBtn = mkBtn\([\s\S]{0,220}resetView/);
  assert.match(css,/\.wb-canvas\.pan-ready\{cursor:grab!important\}/);
  assert.match(css,/\.wb-canvas\.panning\{cursor:grabbing!important\}/);
});
