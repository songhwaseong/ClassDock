// 같은 일을 하는 작은 함수가 여러 벌 있던 것을 정리한 결과를 지킨다.
//
// 다만 "같아 보이면 무조건 합친다"가 답은 아니었다. 셋 중 하나는 일부러 남겼고, 하나는 애초에
// 다른 일을 하고 있었다. 그 판단을 적어 두지 않으면 다음 사람이 마저 합치다가 테스트를 깨뜨린다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "src/js", file), "utf8");
const core = require("../src/js/core.js");

test("공용 escapeHtml 은 다섯 글자를 모두 막는다", () => {
  assert.equal(core.escapeHtml(`<a href="x" title='y'>&</a>`),
    "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  // 속성값에는 백틱까지 막는 escapeAttr 을 쓴다.
  assert.equal(core.escapeAttr("a`b"), "a&#96;b");
});

test("표 화면에는 < > & 셋만 막는 이스케이프가 남아 있지 않다", () => {
  /* 좁은 이스케이프가 둘 있었다. 지금 쓰이는 자리는 모두 요소 본문이라 그걸로도 새지 않았지만,
     이름만 보고 속성값에 쓰면 조용히 뚫린다. 둘을 다르게 정리했다.
       · 인쇄 제목의 지역 esc → 공용 escapeHtml 로 (그 코드는 전역을 이미 쓰는 자리다)
       · escapeChartText → 자리에 두되 막는 글자를 공용과 같게 (아래 테스트가 이유를 밝힌다) */
  const viewer = read("spreadsheet-viewer.js");
  assert.ok(!/\[<>&\]/.test(viewer), "셋만 막는 이스케이프가 남아 있으면 안 된다");
  assert.match(viewer, /<title>" \+ escapeHtml\(base \+ " - " \+ currentSheet\)/);
});

test("차트 이스케이프도 일부러 남긴다 - 혼자서도 돌아야 한다", () => {
  // buildSpreadsheetChartSvg 가 export 되어 테스트가 spreadsheet-viewer.js 만 require 해서 부른다.
  // 화이트보드와 같은 이유로 전역을 쓰지 않는다. 대신 막는 글자는 공용과 같아야 한다.
  const sheet = require("../src/js/spreadsheet-viewer.js");
  const svg = sheet.buildSpreadsheetChartSvg("bar", [`"><script>`], [1], { width:400, height:240 });
  assert.ok(!svg.includes("<script>"), "이름표로 태그를 끼워 넣을 수 없어야 한다");
  assert.ok(svg.includes("&quot;") && svg.includes("&lt;script&gt;"), "따옴표까지 막는다");
  assert.match(read("spreadsheet-viewer.js"), /여기 둔다[\s\S]{0,200}공용과 같게 맞춘다/);
});

test("파이썬 base64 변환은 한 벌만 남는다", () => {
  const runtime = read("python-runtime.js");
  const context = read("python-run-context.js");
  assert.ok(!/_utf8ToBase64/.test(runtime), "python-runtime 의 사본은 지웠다");
  assert.match(context, /function utf8ToBase64\(value\)\{/);
  assert.match(runtime, /_pyFormatDriver\(utf8ToBase64\(src\)\)/);

  // 남긴 쪽은 큰 파일에서 더 낫다 - 한 글자씩 이어 붙이지 않고 덩어리로 끊어 만든다.
  assert.match(context, /i \+= 0x8000/);

  // 먼저 로드된다는 것을 manifest 계약으로 보장한다(순서가 뒤집히면 검사에서 걸린다).
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts.manifest.json"), "utf8"));
  assert.ok(manifest.scriptDependencies["python-runtime.js"].includes("python-run-context.js"));
});

test("화이트보드의 것은 일부러 남긴다 - 혼자서도 돌아야 한다", () => {
  /* 겉모습이 공용 escapeHtml 과 같아서 합치고 싶어지지만, whiteboardVectorGroupSvg 는 앱 전역
     없이 혼자 도는 순수 함수다. 테스트가 whiteboard.js 만 require 해서 부르므로, 전역
     escapeHtml 로 바꾸면 여기서 ReferenceError 로 죽는다. 그 사실을 말로만 두지 않고
     실제로 불러서 확인한다. */
  const board = require("../src/js/whiteboard.js");
  const group = { items:[{ type:"line", x1:0, y1:0, x2:10, y2:10, color:`"><script>` }] };
  const svg = board.whiteboardVectorGroupSvg(group, "#16a34a");
  assert.match(svg, /^<svg /);
  assert.ok(!svg.includes("<script>"), "색 값으로 태그를 끼워 넣을 수 없어야 한다");
  assert.match(svg, /stroke="&quot;&gt;&lt;script&gt;"/);

  // 남겨 둔 이유가 코드에도 적혀 있어야 다음 사람이 마저 합치지 않는다.
  assert.match(read("whiteboard.js"), /일부러 여기 둔다[\s\S]{0,200}ReferenceError/);
});

test("mnote 의 esc 는 HTML 이 아니라 표 칸을 위한 것이다", () => {
  // 이름이 같아 중복으로 세기 쉽지만, 하는 일이 다르다(마크다운 표에서 | 와 줄바꿈 막기).
  const mnote = read("mnote.js");
  assert.match(mnote, /replace\(\/\\\|\/g, "\\\\\|"\)/);
  assert.ok(!/&amp;/.test(mnote.slice(mnote.indexOf("const esc = v =>"), mnote.indexOf("const esc = v =>") + 200)),
    "HTML 이스케이프가 아니다");
});
