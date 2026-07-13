const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadLayoutHelpers(contentWidth=0, viewportWidth=0){
  const source = fs.readFileSync(path.join(__dirname, "../src/js/pdf-render.js"), "utf8");
  const start = source.indexOf("function pdfViewerLayoutWidth");
  const end = source.indexOf("function createPagePlaceholder", start);
  assert.ok(start >= 0 && end > start, "PDF 레이아웃 도우미를 찾을 수 있어야 한다");
  const context = {
    FIT_MAX_W: 1200,
    byId: (id) => id === "content" ? { clientWidth:contentWidth } : null,
    window: { innerWidth:viewportWidth },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\n;globalThis.__layout = { pdfViewerLayoutWidth, pdfPlaceholderAvailableWidth };", context);
  return context.__layout;
}

test("숨겨진 PDF는 문서 영역 폭으로 최초 페이지 크기를 계산한다", () => {
  const helpers = loadLayoutHelpers(1000, 1400);
  assert.equal(helpers.pdfViewerLayoutWidth({ el:{ clientWidth:0 } }), 1000);
  assert.equal(helpers.pdfPlaceholderAvailableWidth({ el:{ clientWidth:0 } }), 960);
});

test("표시 중인 PDF 폭을 우선하고 화면 폭과 기본 폭을 차례로 대체값으로 쓴다", () => {
  const visible = loadLayoutHelpers(1000, 1400);
  assert.equal(visible.pdfPlaceholderAvailableWidth({ el:{ clientWidth:840 } }), 800);

  const viewport = loadLayoutHelpers(0, 900);
  assert.equal(viewport.pdfPlaceholderAvailableWidth({ el:{ clientWidth:0 } }), 860);

  const defaultWidth = loadLayoutHelpers(0, 0);
  assert.equal(defaultWidth.pdfPlaceholderAvailableWidth({ el:{ clientWidth:0 } }), 1160);
});

test("넓은 복원 화면에서도 페이지 기준 폭은 설정된 최대값을 넘지 않는다", () => {
  const helpers = loadLayoutHelpers(1800, 2000);
  assert.equal(helpers.pdfPlaceholderAvailableWidth({ el:{ clientWidth:0 } }), 1200);
});
