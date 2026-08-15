"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeWhiteboardFocusState,
  whiteboardFocusGeometry,
  whiteboardFocusAllowsPoint,
  whiteboardFlashlightGeometry
} = require("../src/js/whiteboard.js");

test("집중 도구 상태는 안전한 기본값과 범위로 정규화된다", () => {
  assert.deepEqual(normalizeWhiteboardFocusState(null), {
    active:false, mode:"spotlight", controlsVisible:true, dimOpacity:.72,
    spotlight:{shape:"ellipse",cx:.5,cy:.5,width:.36,height:.28,flashlight:false},
    curtain:{edge:"bottom",amount:.5,color:"dark"}
  });
  const state = normalizeWhiteboardFocusState({
    active:true, mode:"curtain", controlsVisible:false, dimOpacity:9,
    spotlight:{shape:"rect",cx:-2,cy:4,width:0,height:8,flashlight:true},
    curtain:{edge:"left",amount:-1,color:"light"}
  });
  assert.equal(state.active,true);
  assert.equal(state.mode,"curtain");
  assert.equal(state.controlsVisible,false);
  assert.equal(state.dimOpacity,.9);
  assert.deepEqual(state.spotlight,{shape:"rect",cx:0,cy:1,width:.05,height:1,flashlight:true});
  assert.deepEqual(state.curtain,{edge:"left",amount:0,color:"light"});
});

test("스포트라이트 도형은 화면 안에 머물고 최소 화면 크기를 지킨다", () => {
  const geometry = whiteboardFocusGeometry({
    mode:"spotlight", spotlight:{shape:"rect",cx:0,cy:0,width:.01,height:.01}
  }, 800, 600);
  assert.equal(geometry.mode,"spotlight");
  assert.equal(geometry.shape,"rect");
  assert.equal(geometry.w,96);
  assert.equal(geometry.h,72);
  assert.equal(geometry.x,0);
  assert.equal(geometry.y,0);
});

test("원형과 사각형 스포트라이트는 밝은 영역 안에서만 입력을 허용한다", () => {
  const ellipse={active:true,mode:"spotlight",spotlight:{shape:"ellipse",cx:.5,cy:.5,width:.5,height:.5}};
  assert.equal(whiteboardFocusAllowsPoint(ellipse,{x:400,y:300},800,600),true);
  assert.equal(whiteboardFocusAllowsPoint(ellipse,{x:590,y:300},800,600),true);
  assert.equal(whiteboardFocusAllowsPoint(ellipse,{x:600,y:440},800,600),false);
  const rect={...ellipse,spotlight:{...ellipse.spotlight,shape:"rect"}};
  assert.equal(whiteboardFocusAllowsPoint(rect,{x:600,y:440},800,600),true);
  assert.equal(whiteboardFocusAllowsPoint(rect,{x:601,y:440},800,600),false);
  assert.equal(whiteboardFocusAllowsPoint({...ellipse,active:false},{x:1,y:1},800,600),true);
});

test("네 방향 화면 가리개는 드러난 쪽의 입력만 허용한다", () => {
  const base={active:true,mode:"curtain",curtain:{amount:.4,color:"dark"}};
  assert.equal(whiteboardFocusAllowsPoint({...base,curtain:{...base.curtain,edge:"top"}},{x:50,y:39},100,100),false);
  assert.equal(whiteboardFocusAllowsPoint({...base,curtain:{...base.curtain,edge:"top"}},{x:50,y:40},100,100),true);
  assert.equal(whiteboardFocusAllowsPoint({...base,curtain:{...base.curtain,edge:"bottom"}},{x:50,y:59},100,100),true);
  assert.equal(whiteboardFocusAllowsPoint({...base,curtain:{...base.curtain,edge:"bottom"}},{x:50,y:61},100,100),false);
  assert.equal(whiteboardFocusAllowsPoint({...base,curtain:{...base.curtain,edge:"left"}},{x:39,y:50},100,100),false);
  assert.equal(whiteboardFocusAllowsPoint({...base,curtain:{...base.curtain,edge:"left"}},{x:40,y:50},100,100),true);
  assert.equal(whiteboardFocusAllowsPoint({...base,curtain:{...base.curtain,edge:"right"}},{x:59,y:50},100,100),true);
  assert.equal(whiteboardFocusAllowsPoint({...base,curtain:{...base.curtain,edge:"right"}},{x:61,y:50},100,100),false);
});

test("가리개 0%는 전부 허용하고 100%는 전부 막는다", () => {
  const state={active:true,mode:"curtain",curtain:{edge:"bottom",amount:0}};
  assert.equal(whiteboardFocusAllowsPoint(state,{x:10,y:10},100,100),true);
  assert.equal(whiteboardFocusAllowsPoint({...state,curtain:{...state.curtain,amount:1}},{x:10,y:10},100,100),false);
});

test("손전등은 발표 상태에서 스포트라이트 곁을 따라가고 화면 끝에서 반대편으로 옮겨진다", () => {
  const base={active:true,mode:"spotlight",controlsVisible:false,spotlight:{shape:"ellipse",cx:.5,cy:.5,width:.36,height:.28,flashlight:true}};
  const center=whiteboardFlashlightGeometry(base,800,600);
  assert.equal(center.visible,true);
  assert.equal(center.side,"right");
  assert.equal(center.beam.length,4);
  assert.ok(center.lensX>400);
  const edge=whiteboardFlashlightGeometry({...base,spotlight:{...base.spotlight,cx:.94,width:.18}},800,600);
  assert.equal(edge.visible,true);
  assert.equal(edge.side,"left");
  assert.equal(whiteboardFlashlightGeometry({...base,controlsVisible:true},800,600).visible,false);
  assert.equal(whiteboardFlashlightGeometry({...base,spotlight:{...base.spotlight,flashlight:false}},800,600).visible,false);
});

test("집중 도구 UI는 화면 오버레이·입력 차단·정리·원본 내보내기에 연결된다", () => {
  const source=fs.readFileSync(path.join(__dirname,"../src/js/whiteboard.js"),"utf8");
  const css=fs.readFileSync(path.join(__dirname,"../src/styles.css"),"utf8");
  assert.match(source,/classList\.add\("wb-focus-visual"\)/);
  assert.match(source,/focusVisual\.toggleAttribute\("hidden",!active\); focusVisual\.style\.display=active\?"":"none"/);
  assert.doesNotMatch(source,/focusVisual\.hidden=!active/);
  assert.match(source,/whiteboardFocusAllowsPoint\(focus, p, W, H\)/);
  assert.match(source,/if \(!focusAllowsScreenPoint\(screen\)\)/);
  assert.match(source,/if \(!focusAllowsScreenPoint\(screenPoint\(e\)\)\)\{ flashFocusBoundary\(\); finishStroke\(\); return; \}/);
  assert.match(source,/if \(focus\.active && focus\.controlsVisible && e\.button !== 2\)\{ e\.preventDefault\(\); flashFocusBoundary\(\); return; \}/);
  assert.match(source,/if \(focus\.active && focus\.controlsVisible\)\{ canvas\.style\.cursor = "not-allowed"; return; \}/);
  assert.match(source,/canvas\.addEventListener\("dblclick", \(e\) => \{\s*if \(focus\.active && focus\.controlsVisible\)/);
  assert.match(source,/e\.dataTransfer\.dropEffect = "none"/);
  assert.match(source,/focus\.active && focus\.mode === "spotlight" && !focus\.controlsVisible\)\{ beginSpotlightDrag\(e,\.5,\.5,true\); return; \}/);
  assert.match(source,/focus\.active && focus\.mode === "spotlight" && !focus\.controlsVisible\)\{ canvas\.style\.cursor = "move"; return; \}/);
  assert.match(source,/focusToolBtn=mkBtn\("◉","집중 도구 — 스포트라이트·화면 가리개"/);
  assert.match(source,/focusPowerBtn=mkBtn\("시작","선택한 집중 효과 시작"/);
  assert.match(source,/function toggleFocusActive\(\)\{\s*if \(focus\.active\) stopFocus\(\);\s*else \{ startFocus\(\); toggleFocusPanel\(false\); \}\s*\}/);
  assert.match(source,/spotlightModeBtn\.classList\.toggle\("selected",spotlight\)/);
  assert.match(source,/focusPowerBtn\.textContent=focus\.active\?"종료":"시작"/);
  assert.match(source,/focusContextMenu\.className="wb-focus-context-menu"/);
  assert.match(source,/focusContextEllipseBtn=contextAction\("원형","원형 스포트라이트로 변경"/);
  assert.match(source,/focusContextRectBtn=contextAction\("사각형","사각형 스포트라이트로 변경"/);
  assert.match(source,/focusContextResetBtn=contextAction\("위치 초기화","집중 도구 위치와 크기 초기화","",resetFocusGeometry\)/);
  assert.match(source,/focusContextStopBtn=contextAction\("종료","집중 도구 종료","wb-context-danger",stopFocus\)/);
  assert.match(source,/focusContextEllipseBtn\.hidden=!spotlightMode; focusContextRectBtn\.hidden=!spotlightMode/);
  assert.match(source,/focusContextEllipseBtn\.classList\.toggle\("active",spotlightMode&&focus\.spotlight\.shape==="ellipse"\)/);
  assert.match(source,/focus\.controlsVisible\?"조절점 숨기기":"조절점 보이기"/);
  assert.match(source,/stage\.addEventListener\("contextmenu",onFocusContextMenu\)/);
  assert.match(source,/!focusContextMenu\.hidden && !focusContextMenu\.contains\(e\.target\)/);
  assert.match(source,/e\.key === "Escape" && !focusContextMenu\.hidden/);
  assert.match(source,/stage\.removeEventListener\("contextmenu",onFocusContextMenu\); focusContextMenu\.remove\(\)/);
  assert.match(source,/flashlightOnBtn=mkBtn\("켬","조절점을 숨겼을 때 손전등과 빛줄기 표시"/);
  assert.match(source,/whiteboardFlashlightGeometry\(focus,W,H\)/);
  assert.match(source,/flashlightBody\.setAttribute\("transform",`translate/);
  assert.match(source,/" · 사용 안 함"/);
  assert.match(source,/if \(e\.key === "Escape" && focus\.active\)\{[\s\S]{0,280}if \(focus\.controlsVisible\)\{[\s\S]{0,180}setFocusControlsVisible\(false\);[\s\S]{0,220}else stopFocus\(\);[\s\S]{0,40}return;/);
  assert.match(source,/if \(focusFloat\) focusFloat\.destroy\(\)/);
  // 저장 스냅샷은 판서 모델만 담는다(측정값 갱신 같은 앞단 호출은 붙을 수 있다).
  assert.match(source,/const boardSnapshot = \(\) => \((?:syncMeasureItems\(\), )?\{[\s\S]{0,180}items:wb\.items/);
  assert.doesNotMatch(source,/const boardSnapshot = \(\) => \((?:syncMeasureItems\(\), )?\{[\s\S]{0,220}boardFocus/);
  assert.match(source,/withBoardExport\(\(\) => canvas\.toDataURL\("image\/png"\)\)/);
  assert.match(css,/\.wb-focus-visual\{[^}]*pointer-events:none/);
  assert.match(css,/\.wb-focus-controls\{[^}]*pointer-events:none/);
  assert.match(css,/\.wb-focus-handle\{[^}]*pointer-events:auto/);
  assert.match(css,/\.wb-focus-panel/);
  assert.match(css,/\.wb-focus-choice\.selected:not\(\.active\)/);
  assert.match(css,/\.wb-focus-start/);
  assert.match(css,/\.wb-flashlight-beam/);
  assert.match(css,/\.wb-flashlight-body/);
  assert.match(css,/\.wb-focus-context-menu/);
  assert.match(css,/\.wb-focus-context-actions\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css,/\.wb-focus-context-choice\.active(?:,[^{]+)?\{background:var\(--accent\);color:#fff\}/);
});
