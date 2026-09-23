const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = name => fs.readFileSync(path.join(__dirname, "../src/js", name), "utf8");
function section(source, start, end){
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
function mediaHarness(){
  let width = 1000;
  const queries = [];
  const context = vm.createContext({
    console, scale:1, uiCoordZoom:1,
    Element:class { get currentCSSZoom(){ return 1; } },
    document:{ styleSheets:[], body:{ style:{} }, documentElement:{ dataset:{}, style:{ setProperty(){} } } },
    notifyScreenPixelRatioChange(){},
    window:{ matchMedia(media){
      const listeners = new Set();
      const mq = {
        media, listeners,
        get matches(){ return width <= Number(media.match(/([\d.]+)px/)[1]); },
        addEventListener(type, fn){ listeners.add(fn); },
        removeEventListener(type, fn){ listeners.delete(fn); }
      };
      queries.push(mq);
      return mq;
    } }
  });
  context.currentUiScale = () => context.scale;
  vm.runInContext(section(read("state.js"), "let uiMediaZoom = 1;", "/* ===== 화면 픽셀 배율 ====="), context);
  return {
    context, queries,
    scale(value){ context.scale = value; context.applyUiScale(); },
    width(value){
      const previous = queries.map(q => q.matches);
      width = value;
      queries.forEach((q, i) => { if (q.matches !== previous[i]) for (const fn of [...q.listeners]) fn(q); });
    }
  };
}
test("UI 크기를 바꾸면 열려 있는 DB 결과 배치가 바뀌고 1배로 되돌아온다", () => {
  const h = mediaHarness(), classes = new Set();
  Object.assign(h.context, {
    readResultLayout:() => "side", storeResultLayout(){},
    queryLayout:{ classList:{ toggle(name, active){ active ? classes.add(name) : classes.delete(name); } } },
    editorDivider:{ setAttribute(){} }, layoutButton:{ setAttribute(){}, addEventListener(){} }
  });
  vm.runInContext(section(read("db-client.js"), "    let resultLayout = readResultLayout();", "    let sidebarCollapsed = readSidebarCollapsed();"), h.context);
  assert.ok(classes.has("db-layout-side"));
  h.scale(1.25);
  assert.ok(classes.has("db-layout-below"));
  h.scale(1);
  assert.ok(classes.has("db-layout-side"));
  vm.runInContext("compactQueryLayout.dispose()", h.context);
  assert.equal(h.queries.reduce((sum, q) => sum + q.listeners.size, 0), 0);
});
test("미디어 구독은 같은 일치 상태에서도 새 경계값을 쓰고 해제 후 알림을 멈춘다", () => {
  const h = mediaHarness(), changes = [];
  h.width(1100);
  const watch = h.context.watchUiMediaQuery("(max-width:900px)", mq => changes.push(mq.matches));
  h.scale(1.12);
  assert.deepEqual(changes, []);
  h.width(1000);
  assert.equal(watch.matches, true);
  assert.deepEqual(changes, [true]);
  const count = h.queries.length;
  h.scale(1.12);
  assert.equal(h.queries.length, count);
  watch.dispose();
  h.width(800);
  h.scale(1.25);
  assert.equal(h.queries.length, count);
  assert.equal(h.queries.reduce((sum, q) => sum + q.listeners.size, 0), 0);
  assert.deepEqual(changes, [true]);
});
function canvasHarness(){
  const frames = [], canvases = [];
  let drawings = 0;
  const ctx = {
    setTransform(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){},
    stroke(){ drawings++; }
  };
  const makeNode = tag => {
    const node = {
      style:{}, dataset:{}, classList:{ add(){}, toggle(){} },
      clientWidth:320, clientHeight:180, offsetWidth:320, offsetHeight:180, scrollTop:0,
      currentCSSZoom:1,
      appendChild(){}, append(){}, setAttribute(){}, addEventListener(){}, removeEventListener(){}, remove(){},
      getBoundingClientRect:() => ({ left:0, top:0, width:320, height:180 }),
      getContext:() => ctx
    };
    if (tag === "canvas") canvases.push(node);
    return node;
  };
  const strokes = [{ tool:"pen", color:"#000", width:2, points:[{ x:0.1, y:0.1 }, { x:0.5, y:0.5 }] }];
  const context = vm.createContext({
    console, window:{ devicePixelRatio:1 },
    document:{ createElement:makeNode, addEventListener(){}, removeEventListener(){} },
    requestAnimationFrame(fn){ frames.push(fn); return frames.length; }, cancelAnimationFrame(){},
    // CSS 크기가 변하지 않으므로 ResizeObserver 콜백은 일부러 호출하지 않는다.
    ResizeObserver:class { observe(){} disconnect(){} },
    notebookEnsureInkStrokes:() => strokes,
    _codePenState:{ tool:"pen" }, lessonFmtTime:() => "0:00"
  });
  vm.runInContext(section(read("state.js"), "function cssZoomOf(el)", "(function watchDevicePixelRatio()"), context);
  return { context, makeNode, canvases, strokes,
    flush(){ while (frames.length) frames.shift()(0); },
    draw(){ drawings++; }, get drawings(){ return drawings; }
  };
}
for (const kind of ["리플레이", "노트북", "파이썬"]){
  test(`${kind}: 크기 변경 없이 DPR만 바뀌어도 다시 그리고 종료 후에는 멈춘다`, () => {
    const h = canvasHarness(), c = h.context;
    let cleanup;
    if (kind === "리플레이"){
      vm.runInContext(section(read("lesson-replay.js"), "function mountReplayPlayer(", "// 화이트보드 리플레이"), c);
      const doc = {};
      c.mountReplayPlayer(doc, h.makeNode("div"), { duration:1000, draw:() => h.draw() });
      cleanup = () => doc.cleanupFns.forEach(fn => fn());
    } else if (kind === "노트북"){
      vm.runInContext(section(read("notebook-tools.js"), "function nbCreateInkSurface(", "function nbSyncFindModel("), c);
      const api = c.nbCreateInkSurface({}, { cell:{}, cellEl:h.makeNode("div") });
      cleanup = api.cleanup;
    } else {
      vm.runInContext(section(read("python-runtime.js"), "function _createPenSurface(", "function setupCodePenOverlay("), c);
      const api = c._createPenSurface(h.makeNode("div"), h.makeNode("div"));
      api.strokes.push(...h.strokes);
      api.show();
      cleanup = api.cleanup;
    }
    h.flush();
    const canvas = h.canvases[0];
    assert.equal(canvas.width, 320);
    const before = h.drawings;
    c.window.devicePixelRatio = 2;
    c.notifyScreenPixelRatioChange();
    c.notifyScreenPixelRatioChange();
    h.flush();
    assert.equal(canvas.width, 640);
    assert.equal(canvas.height, 360);
    assert.equal(canvas.style.width, "320px");
    assert.equal(h.drawings, before + 1);
    c.window.devicePixelRatio = 1;
    c.notifyScreenPixelRatioChange();
    h.flush();
    assert.equal(canvas.width, 320);
    c.window.devicePixelRatio = 3;
    c.notifyScreenPixelRatioChange();
    cleanup();
    h.flush();
    assert.equal(canvas.width, 320);
    assert.equal(vm.runInContext("screenPixelRatioListeners.size", c), 0);
  });
}
