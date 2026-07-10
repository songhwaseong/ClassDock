const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// notebook-viewer.js 분할본을 이어붙여 CommonJS 식 래퍼로 실행 — 번들과 동일한 순서/스코프이고,
// 마지막 조각(notebook-cells.js) 끝의 module.exports 가 스텁 module 에 채워진다.
// (vm 별도 컨텍스트를 쓰면 다른 realm 의 Array/Object 가 되어 deepEqual 이 실패하므로 같은 realm 에서 실행)
const nbModule = { exports: {} };
const nbSource = ["notebook-model.js", "notebook-tools.js", "notebook-run.js", "notebook-pdf-export.js", "notebook-cells.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "../src/js", file), "utf8")).join("\n");
new Function("module", "window", "localStorage", nbSource)(
  nbModule, {}, { getItem: () => null, setItem: () => {} });
const {
  ipynbToModel,
  modelToIpynb,
  splitSourceLines,
  parseNbOutputs,
  notebookJsonOutput,
  notebookTracebackLine,
  notebookHeadings,
  notebookVariables,
  notebookResultToRawOutputs,
  notebookExecutionHash,
  notebookUpstreamHash,
  notebookRecordExecution,
  notebookClearExecution,
  notebookCellExecutionState,
  notebookNormalizeInkStrokes,
  notebookEnsureInkStrokes,
  notebookDropEmptyInkMetadata,
  notebookMoveArrayItem,
  notebookCellClipboardSnapshot,
  notebookMaterializeClipboardCells,
  notebookCompletionContext,
  notebookInvalidateCompletionCache,
  notebookCodeSource,
  notebookKernelModeLabel,
  notebookRequiresLocalPython,
  notebookInputPlan,
  notebookCellUsesInput,
  notebookFindMatches,
  notebookFindNextIndex,
  notebookReplaceAll,
  notebookExecutionControlState,
  notebookAutosaveTarget,
  notebookCellHasExecutableSource,
  notebookSetOutputsCollapsed,
  notebookFoliumFrameSpec,
  notebookInteractiveHtmlFrameSpec,
  notebookUntrustedHtmlFrameSpec,
  notebookInteractiveMimeFrameSpec,
  notebookPdfSegments,
  notebookPdfBatches
} = nbModule.exports;

test("노트북 PDF 페이지는 가능한 셀 경계에서 나뉘고 큰 셀만 A4 높이로 자른다", () => {
  assert.deepEqual(
    notebookPdfSegments(3200, 1000, [0, 620, 1450, 2300]),
    [[0, 620], [620, 1450], [1450, 2300], [2300, 3200]]
  );
  assert.deepEqual(
    notebookPdfSegments(2500, 1000, [0]),
    [[0, 1000], [1000, 2000], [2000, 2500]]
  );
});

test("노트북 PDF 캡처는 메모리 한도 안에서 인접 페이지를 묶는다", () => {
  const segments = [[0, 1000], [1000, 2000], [2000, 3000], [3000, 4000], [4000, 5000]];
  assert.deepEqual(
    notebookPdfBatches(segments, 1000, 2, 12000000),
    [
      { first:0, end:3, start:0, finish:3000 },
      { first:3, end:5, start:3000, finish:5000 }
    ]
  );
  assert.deepEqual(
    notebookPdfBatches(segments.slice(0, 2), 2000, 3, 1000000),
    [
      { first:0, end:1, start:0, finish:1000 },
      { first:1, end:2, start:1000, finish:2000 }
    ]
  );
});

test("Folium rich output is recognized as an isolated frame", () => {
  const html = [
    '<div style="width:100%"><div style="position:relative;padding-bottom:60%">',
    '<span>Make this Notebook Trusted to load map: File -> Trust Notebook</span>',
    '<iframe srcdoc="&lt;!DOCTYPE html&gt;&lt;html&gt;&lt;head&gt;',
    '&lt;script src=&quot;https://cdn.example/leaflet.js&quot;&gt;&lt;/script&gt;',
    '&lt;/head&gt;&lt;body&gt;&lt;script&gt;const map = L.map(&quot;map&quot;);&lt;/script&gt;',
    '&lt;/body&gt;&lt;/html&gt;"></iframe></div></div>'
  ].join("");
  const spec = notebookFoliumFrameSpec(html);
  assert.ok(spec);
  assert.equal(spec.paddingBottom, "60%");
  assert.match(spec.srcdoc, /const map = L\.map\("map"\)/);
  assert.doesNotMatch(spec.srcdoc, /&lt;/);
});

test("ordinary or suspicious HTML is not promoted to a script frame", () => {
  assert.equal(notebookFoliumFrameSpec("<table><tr><td>1</td></tr></table>"), null);
  assert.equal(notebookFoliumFrameSpec(
    '<span>Make this Notebook Trusted to load map</span><iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'
  ), null);
  assert.equal(notebookFoliumFrameSpec(
    '<span>Make this Notebook Trusted to load map</span>' +
    '<iframe srcdoc="leaflet L.map(&quot;x&quot;)"></iframe><iframe srcdoc=""></iframe>'
  ), null);
});

test("known interactive chart HTML is isolated while ordinary scripts stay blocked", () => {
  const plotly = notebookInteractiveHtmlFrameSpec(
    '<div class="plotly-graph-div" id="chart"></div><script>Plotly.newPlot("chart", [], {})</script>'
  );
  assert.ok(plotly);
  assert.equal(plotly.title, "Plotly 차트");
  assert.equal(plotly.allowScripts, true);
  assert.match(plotly.srcdoc, /cdn\.plot\.ly/);
  assert.equal(notebookInteractiveHtmlFrameSpec("<script>alert(1)</script>"), null);
});

test("arbitrary interactive HTML requires explicit notebook trust", () => {
  const spec = notebookUntrustedHtmlFrameSpec('<div id="demo"></div><script>document.querySelector("#demo").textContent = "ok"</script>');
  assert.ok(spec);
  assert.equal(spec.allowScripts, true);
  assert.equal(spec.requiresTrust, true);
  assert.match(spec.srcdoc, /textContent = "ok"/);
  assert.equal(notebookUntrustedHtmlFrameSpec("<table><tr><td>safe</td></tr></table>"), null);
});

test("Plotly and Vega MIME bundles produce sandbox frame documents", () => {
  const plotly = notebookInteractiveMimeFrameSpec("application/vnd.plotly.v1+json", {
    data:[{ x:[1, 2], y:[3, 4] }],
    layout:{ title:"chart" }
  });
  assert.ok(plotly);
  assert.match(plotly.srcdoc, /Plotly\.newPlot/);
  assert.match(plotly.srcdoc, /"title":"chart"/);

  const vega = notebookInteractiveMimeFrameSpec("application/vnd.vegalite.v5+json", {
    mark:"bar",
    data:{ values:[{ x:"A", y:1 }] }
  });
  assert.ok(vega);
  assert.equal(vega.title, "Altair 차트");
  assert.match(vega.srcdoc, /vegaEmbed/);

  const bokeh = notebookInteractiveMimeFrameSpec("application/vnd.bokehjs_exec.v0+json", {
    version:"3.6.0",
    item:{ target_id:"chart", doc:{ roots:[] } }
  });
  assert.ok(bokeh);
  assert.equal(bokeh.title, "Bokeh 차트");
  assert.match(bokeh.srcdoc, /bokeh-3\.6\.0\.min\.js/);
  assert.match(bokeh.srcdoc, /embed_item/);
});

test("노트북 실행 커널 종류를 사용자에게 분명히 표시한다", () => {
  assert.equal(notebookKernelModeLabel("browser"), "노트북 · 브라우저");
  assert.equal(notebookKernelModeLabel("local"), "노트북 · 로컬 Python");
});

test("Selenium과 Playwright 셀은 로컬 Python 필요 코드로 감지한다", () => {
  assert.equal(notebookRequiresLocalPython("from selenium import webdriver"), true);
  assert.equal(notebookRequiresLocalPython("import selenium.webdriver"), true);
  assert.equal(notebookRequiresLocalPython("from playwright.sync_api import sync_playwright"), true);
  assert.equal(notebookRequiresLocalPython("# import selenium\nimport requests"), false);
  assert.equal(notebookRequiresLocalPython("selenium_result = 'text'"), false);
});

test("노트북 실행 제어는 실행 중 중지 버튼으로 전환되고 중복 중지를 막는다", () => {
  assert.deepEqual(notebookExecutionControlState(false, false), {
    label:"전체 실행",
    title:"모든 코드 셀을 위에서부터 차례로 실행",
    disabled:false
  });
  assert.deepEqual(notebookExecutionControlState(true, false), {
    label:"■",
    title:"현재 셀 실행과 남은 전체 실행을 중지",
    disabled:false
  });
  assert.equal(notebookExecutionControlState(true, true).disabled, true);
});

test("노트북 자동 저장은 이름과 직접 쓰기 대상이 확정된 경우에만 사용한다", () => {
  const base = {
    notebookModel:{ cells:[] },
    hasUnsavedEdits:true,
    name:"수업.ipynb",
    workspacePath:"수업/수업.ipynb"
  };
  assert.equal(notebookAutosaveTarget(base, true), "server");
  assert.equal(notebookAutosaveTarget(base, false), "");
  assert.equal(notebookAutosaveTarget({ ...base, isScratch:true }, true), "");
  assert.equal(notebookAutosaveTarget({ ...base, isScratch:true, _named:true }, true), "server");
  assert.equal(notebookAutosaveTarget({
    ...base,
    originalSaveMode:true,
    fsHandle:{ createWritable(){} }
  }, false), "file-handle");
  assert.equal(notebookAutosaveTarget({ ...base, originalSaveMode:true }, true), "");
  assert.equal(notebookAutosaveTarget({ ...base, hasUnsavedEdits:false }, true), "");
});

test("노트북 출력 접기와 펼치기는 현재 출력 영역에 한꺼번에 적용한다", () => {
  let syncCount = 0;
  const withOutput = id => ({
    cell:{ id },
    outWrap:{},
    syncOutputCollapsed(){ syncCount++; }
  });
  const first = withOutput("first");
  const second = { cell:{ id:"second" }, outWrap:null };
  const third = withOutput("third");
  const ownerDoc = {
    _nbCtrls:[first, second, third],
    _nbCollapsedOutputs:new Set(["old"])
  };

  assert.equal(notebookSetOutputsCollapsed(ownerDoc, true), 2);
  assert.deepEqual([...ownerDoc._nbCollapsedOutputs].sort(), ["first", "third"]);
  assert.equal(syncCount, 2);

  assert.equal(notebookSetOutputsCollapsed(ownerDoc, false), 2);
  assert.deepEqual([...ownerDoc._nbCollapsedOutputs], []);
  assert.equal(syncCount, 4);
});

test("노트북 input 호출을 감지하되 객체 메서드와 비슷한 이름은 제외한다", () => {
  const plan = notebookInputPlan('name = input("이름: ")\nage = int(input("나이: "))');
  assert.deepEqual(plan.calls.map(call => call.prompt), ["이름: ", "나이: "]);
  assert.equal(plan.predictable, true);
  assert.equal(notebookCellUsesInput('name = input("이름: ")'), true);
  assert.equal(notebookCellUsesInput("first = input ()\nsecond = input()"), true);
  assert.equal(notebookCellUsesInput("form.input()"), false);
  assert.equal(notebookCellUsesInput("myinput()"), false);
  assert.equal(notebookCellUsesInput("print('hello')"), false);
  assert.equal(notebookCellUsesInput('# input("주석")\ntext = "input(\\"문자열\\")"'), false);
  assert.equal(notebookInputPlan('for _ in range(2): value = input("값: ")').predictable, false);
  assert.equal(notebookInputPlan('if ready:\n    value = input("값: ")').predictable, false);
});

test("노트북 셀 복사본은 순서·첨부를 보존하고 실행 결과·필기는 제외한다", () => {
  const cells = [
    {
      id:"code-old",
      type:"code",
      source:"answer = 42",
      execCount:7,
      outputs:[{ kind:"stream", text:"42\n" }],
      rawOutputs:[{ output_type:"stream", text:["42\n"] }],
      metadata:{
        tags:["keep"],
        manneung_execution:{ sourceHash:"old" },
        manneung_ink:{ strokes:[{ tool:"pen" }] }
      }
    },
    {
      id:"markdown-old",
      type:"markdown",
      source:"![그림](attachment:figure.png)",
      attachments:{ "figure.png":{ "image/png":"ATTACHED" } },
      metadata:{ custom:{ keep:true } }
    }
  ];

  const snapshots = notebookCellClipboardSnapshot(cells);
  assert.deepEqual(snapshots.map(cell => cell.type), ["code", "markdown"]);
  assert.equal(snapshots[0].source, "answer = 42");
  assert.deepEqual(snapshots[0].metadata, { tags:["keep"] });
  assert.deepEqual(snapshots[1].attachments, cells[1].attachments);

  const pasted = notebookMaterializeClipboardCells(snapshots);
  assert.deepEqual(pasted.map(cell => cell.type), ["code", "markdown"]);
  assert.notEqual(pasted[0].id, cells[0].id);
  assert.notEqual(pasted[0].id, pasted[1].id);
  assert.equal(pasted[0].execCount, null);
  assert.deepEqual(pasted[0].outputs, []);
  assert.deepEqual(pasted[0].rawOutputs, []);
  assert.deepEqual(pasted[1].attachments, cells[1].attachments);

  pasted[0].metadata.tags.push("changed");
  pasted[1].attachments["figure.png"]["image/png"] = "CHANGED";
  assert.deepEqual(snapshots[0].metadata.tags, ["keep"]);
  assert.equal(snapshots[1].attachments["figure.png"]["image/png"], "ATTACHED");
});

const sampleNb = {
  cells: [
    { cell_type: "markdown", source: ["# 제목\n", "설명 줄"],
      attachments: { "figure.png": { "image/png": "ATTACHED" } } },
    { cell_type: "code", execution_count: 3, source: ["import pandas as pd\n", "print(1)"],
      outputs: [{ output_type: "stream", name: "stdout", text: ["1\n"] }] },
    { cell_type: "code", source: "x = 1", outputs: [
      { output_type:"display_data", data:{ "text/html":"<b>rich</b>", "application/json":{ value:1 } }, metadata:{} }
    ] },
    { cell_type: "raw", source: ["raw 텍스트"] }
  ],
  metadata: { kernelspec: { name: "python3" } },
  nbformat: 4,
  nbformat_minor: 5
};

test("ipynbToModel: 셀 타입·소스·실행번호를 읽는다", () => {
  const m = ipynbToModel(JSON.stringify(sampleNb));
  assert.equal(m.cells.length, 4);
  assert.equal(m.cells[0].type, "markdown");
  assert.equal(m.cells[0].source, "# 제목\n설명 줄");
  assert.equal(m.cells[1].type, "code");
  assert.equal(m.cells[1].source, "import pandas as pd\nprint(1)");
  assert.equal(m.cells[1].execCount, 3);
  assert.equal(m.cells[3].type, "raw");
  assert.equal(m.nbformat, 4);
});

test("ipynbToModel: 출력 원본과 마크다운 첨부를 모델에 보존한다", () => {
  const m = ipynbToModel(JSON.stringify(sampleNb));
  assert.equal(m.cells[1].outputs.length, 1);
  assert.equal(m.cells[1].outputs[0].kind, "stream");
  assert.equal(m.cells[1].outputs[0].text, "1\n");
  assert.deepEqual(m.cells[1].rawOutputs, sampleNb.cells[1].outputs);
  assert.deepEqual(m.cells[2].rawOutputs, sampleNb.cells[2].outputs);
  assert.deepEqual(m.cells[0].attachments, sampleNb.cells[0].attachments);
});

test("modelToIpynb: 기존 출력·실행번호·첨부를 보존한다", () => {
  const m = ipynbToModel(JSON.stringify(sampleNb));
  const nb = JSON.parse(modelToIpynb(m));
  assert.equal(nb.nbformat, 4);
  const code = nb.cells.find(c => c.cell_type === "code");
  assert.deepEqual(code.outputs, sampleNb.cells[1].outputs);
  assert.equal(code.execution_count, 3);
  // 마크다운/raw 셀에는 outputs/execution_count 키가 없어야 함
  const md = nb.cells.find(c => c.cell_type === "markdown");
  assert.equal("outputs" in md, false);
  assert.equal("execution_count" in md, false);
  assert.deepEqual(md.attachments, sampleNb.cells[0].attachments);
  assert.deepEqual(nb.cells[2].outputs, sampleNb.cells[2].outputs);
});

test("왕복: model → ipynb → model 에서 타입·소스·순서가 보존된다", () => {
  const m1 = ipynbToModel(JSON.stringify(sampleNb));
  const m2 = ipynbToModel(modelToIpynb(m1));
  assert.equal(m2.cells.length, m1.cells.length);
  for (let i = 0; i < m1.cells.length; i++){
    assert.equal(m2.cells[i].type, m1.cells[i].type, "셀 " + i + " 타입");
    assert.equal(m2.cells[i].source, m1.cells[i].source, "셀 " + i + " 소스");
  }
  assert.equal(m2.cells[1].outputs.length, 1);
  assert.equal(m2.cells[1].execCount, 3);
  assert.deepEqual(m2.cells[0].attachments, sampleNb.cells[0].attachments);
});

test("splitSourceLines: nbformat 줄 배열 규칙", () => {
  assert.deepEqual(splitSourceLines(""), []);
  assert.deepEqual(splitSourceLines("a"), ["a"]);
  assert.deepEqual(splitSourceLines("a\nb"), ["a\n", "b"]);
  assert.deepEqual(splitSourceLines("a\nb\n"), ["a\n", "b\n"]);
});

test("nbformat 3(worksheets/input)은 읽은 뒤 유효한 4.5 구조로 저장한다", () => {
  const nb3 = { nbformat:3, nbformat_minor:0, worksheets: [{ cells: [{ cell_type: "code", input: ["a=1\n", "print(a)"] }] }] };
  const m = ipynbToModel(JSON.stringify(nb3));
  assert.equal(m.cells.length, 1);
  assert.equal(m.cells[0].source, "a=1\nprint(a)");
  const saved = JSON.parse(modelToIpynb(m));
  assert.equal(saved.nbformat, 4);
  assert.equal(saved.nbformat_minor, 5);
  assert.equal(Array.isArray(saved.cells), true);
  assert.equal("worksheets" in saved, false);
  assert.deepEqual(saved.cells[0].source, ["a=1\n", "print(a)"]);
});

test("잘못된 JSON 은 오류를 던진다", () => {
  assert.throws(() => ipynbToModel("{not json"));
});

test("parseNbOutputs: 이미지/에러 매핑", () => {
  const outs = parseNbOutputs([
    { output_type: "display_data", data: { "image/png": "BASE64" } },
    { output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["Trace1", "Trace2"] }
  ]);
  assert.equal(outs[0].kind, "image");
  assert.equal(outs[0].b64, "BASE64");
  assert.equal(outs[1].kind, "error");
  assert.equal(outs[1].text, "Trace1\nTrace2");
});

test("parseNbOutputs: HTML 결과를 text/plain보다 우선한다", () => {
  const outs = parseNbOutputs([
    { output_type:"execute_result", data:{ "text/html":"<table><tr><td>1</td></tr></table>", "text/plain":"   a\\n0  1" } }
  ]);
  assert.equal(outs.length, 1);
  assert.equal(outs[0].kind, "html");
  assert.match(outs[0].html, /<table>/);
});

test("parseNbOutputs: SVG와 JSON 결과를 보존한다", () => {
  const outs = parseNbOutputs([
    { output_type:"display_data", data:{ "image/svg+xml":"<svg><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>" } },
    { output_type:"display_data", data:{ "application/json":{ answer:42, ok:true } } }
  ]);
  assert.equal(outs[0].kind, "svg");
  assert.match(outs[0].svg, /<circle/);
  assert.equal(outs[1].kind, "json");
  assert.equal(JSON.parse(outs[1].text).answer, 42);
  assert.equal(notebookJsonOutput('{"nested":{"value":1}}').includes("\n"), true);
});

test("parseNbOutputs: media, LaTeX, and interactive MIME outputs are recognized", () => {
  const outs = parseNbOutputs([
    { output_type:"display_data", data:{ "audio/wav":"UklGRg==" } },
    { output_type:"display_data", data:{ "video/mp4":"AAAA" } },
    { output_type:"display_data", data:{ "text/latex":"\\\\frac{a}{b}" } },
    { output_type:"display_data", data:{ "application/vnd.plotly.v1+json":{ data:[], layout:{} } } }
  ]);
  assert.deepEqual(outs.map(item => item.kind), ["media", "media", "latex", "interactive"]);
  assert.equal(outs[0].media, "audio");
  assert.equal(outs[1].media, "video");
  assert.equal(outs[3].mime, "application/vnd.plotly.v1+json");
});

test("notebookResultToRawOutputs preserves extended rich MIME data", () => {
  const raw = notebookResultToRawOutputs({
    richOutputs:[{
      output_type:"display_data",
      data:{
        "image/png":"UE5H",
        "text/latex":"x^2",
        "audio/mpeg":"SUQz",
        "application/vnd.vegalite.v5+json":{ mark:"point" }
      }
    }]
  }, 3);
  assert.equal(raw.length, 1);
  assert.equal(raw[0].data["image/png"], "UE5H");
  assert.equal(raw[0].data["text/latex"], "x^2");
  assert.equal(raw[0].data["audio/mpeg"], "SUQz");
  assert.deepEqual(raw[0].data["application/vnd.vegalite.v5+json"], { mark:"point" });
});

test("노트북 목차는 마크다운 제목과 깊이를 셀 순서대로 찾는다", () => {
  const headings = notebookHeadings({
    cells:[
      { id:"intro", type:"markdown", source:"# **소개**\n설명\n## [준비](#ready)" },
      { id:"code", type:"code", source:"# 파이썬 주석" },
      { id:"end", type:"markdown", source:"### 마무리" }
    ]
  });
  assert.deepEqual(headings.map(item => [item.cellId, item.level, item.text]), [
    ["intro", 1, "소개"],
    ["intro", 2, "준비"],
    ["end", 3, "마무리"]
  ]);
});

test("Traceback 마지막 줄과 학생 변수만 추린다", () => {
  const traceback = 'Traceback\\n  File "<exec>", line 2, in helper\\n  File "<exec>", line 7, in <module>\\nValueError: bad';
  assert.equal(notebookTracebackLine(traceback), 7);
  assert.deepEqual(notebookVariables([
    { name:"answer", type:"int", value:"42" },
    { name:"_internal", type:"str", value:"숨김" }
  ]), [{ name:"answer", type:"int", value:"42" }]);
});

test("노트북 변수 목록은 50개 이후 이름도 숨기지 않는다", () => {
  const variables = Array.from({ length:120 }, (_, index) => ({
    name:"value_" + String(index).padStart(3, "0"),
    type:"int",
    value:"",
    lazy:true
  }));
  const rows = notebookVariables(variables);
  assert.equal(rows.length, 120);
  assert.equal(rows[119].name, "value_119");
  assert.equal(rows[119].lazy, true);
});

test("브라우저 커널 결과를 nbformat 출력으로 변환한다", () => {
  const warning = notebookResultToRawOutputs({
    ok:true,
    stdout:"done\n",
    stderr:"UserWarning: careful\n",
    richOutputs:[{
      output_type:"execute_result",
      data:{ "text/html":"<table><tr><td>1</td></tr></table>", "text/plain":"a\\n1" },
      metadata:{}
    }],
    images:["data:image/png;base64,IMAGE"]
  }, 7);
  assert.deepEqual(warning[0], { output_type:"stream", name:"stdout", text:["done\n"] });
  assert.deepEqual(warning[1], { output_type:"stream", name:"stderr", text:["UserWarning: careful\n"] });
  assert.equal(warning[2].output_type, "execute_result");
  assert.equal(warning[2].execution_count, 7);
  assert.match(warning[2].data["text/html"], /<table>/);
  assert.equal(warning[3].output_type, "display_data");
  assert.equal(warning[3].data["image/png"], "IMAGE");

  const failed = notebookResultToRawOutputs({ ok:false, stderr:"Traceback\nValueError: bad\n" });
  assert.equal(failed[0].output_type, "error");
  assert.equal(failed[0].ename, "ValueError");
  assert.equal(failed[0].evalue, "bad");
});

test("노트북 실행 상태는 현재 셀과 앞쪽 코드 변경을 구분한다", () => {
  const first = { id:"first", type:"code", source:"value = 1", execCount:null, rawOutputs:[], metadata:{} };
  const second = { id:"second", type:"code", source:"value + 1", execCount:null, rawOutputs:[], metadata:{} };
  const model = { cells:[first, second] };

  assert.equal(notebookCellExecutionState(model, first).status, "never");
  notebookRecordExecution(model, first, true);
  first.execCount = 1;
  notebookRecordExecution(model, second, true);
  second.execCount = 2;
  assert.equal(notebookCellExecutionState(model, first).status, "fresh");
  assert.equal(notebookCellExecutionState(model, second).status, "fresh");

  first.source = "value = 2";
  assert.equal(notebookCellExecutionState(model, first).status, "stale");
  assert.match(notebookCellExecutionState(model, first).reason, /이 셀/);
  assert.equal(notebookCellExecutionState(model, second).status, "stale");
  assert.match(notebookCellExecutionState(model, second).reason, /앞쪽/);

  notebookRecordExecution(model, first, true);
  assert.equal(notebookCellExecutionState(model, first).status, "fresh");
  assert.equal(notebookCellExecutionState(model, second).status, "stale");
  notebookRecordExecution(model, second, false);
  assert.equal(notebookCellExecutionState(model, second).status, "error");
});

test("빈 코드 셀은 변수·이전 상태 경고 대상에서 제외하되 지운 코드는 재실행 대상으로 남긴다", () => {
  const first = { id:"first", type:"code", source:"value = 1", execCount:null, rawOutputs:[], metadata:{} };
  const blank = { id:"blank", type:"code", source:"  \n", execCount:null, rawOutputs:[], metadata:{} };
  const removed = { id:"removed", type:"code", source:"value + 1", execCount:null, rawOutputs:[], metadata:{} };
  const model = { cells:[first, blank, removed] };

  assert.equal(notebookCellHasExecutableSource(blank), false);
  assert.equal(notebookCellHasExecutableSource(removed), true);
  assert.equal(notebookCellExecutionState(model, blank).status, "blank");

  notebookRecordExecution(model, blank, true);
  blank.execCount = 1;
  notebookRecordExecution(model, removed, true);
  removed.execCount = 2;
  first.source = "value = 2";
  assert.equal(notebookCellExecutionState(model, blank).status, "blank");

  removed.source = "";
  assert.equal(notebookCellExecutionState(model, removed).status, "stale");
  assert.match(notebookCellExecutionState(model, removed).reason, /이 셀/);
});

test("노트북 실행 메타데이터 해시는 저장 왕복 후에도 유지된다", () => {
  const cell = { id:"hash-cell", type:"code", source:"answer = 42\\nanswer", execCount:3, rawOutputs:[], outputs:[], metadata:{} };
  const model = { cells:[cell], metadata:{} };
  notebookRecordExecution(model, cell, true);
  const before = notebookExecutionHash(cell.source);
  const restored = ipynbToModel(modelToIpynb(model));
  assert.equal(restored.cells[0].metadata.manneung_execution.source_hash, before);
  assert.equal(notebookUpstreamHash(restored, restored.cells[0]), notebookUpstreamHash(model, cell));
  assert.equal(notebookCellExecutionState(restored, restored.cells[0]).status, "fresh");
  notebookClearExecution(restored.cells[0]);
  assert.equal(notebookCellExecutionState(restored, restored.cells[0]).status, "unknown");
});

test("노트북 셀 필기는 안전한 벡터 획으로 정규화하되 파일에는 저장하지 않는다(보류)", () => {
  const normalized = notebookNormalizeInkStrokes([
    { tool:"highlighter", color:"#2563eb", width:12, points:[{ x:-1, y:0.5 }, { x:2, y:1 }] },
    { tool:"bad", color:"javascript:red", width:999, points:[{ x:0.2, y:0.3 }, { x:"bad", y:0.4 }] },
    { tool:"pen", points:[] }
  ]);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0].points, [{ x:0, y:0.5 }, { x:1, y:1 }]);
  assert.equal(normalized[1].tool, "pen");
  assert.equal(normalized[1].color, "#e11d48");
  assert.equal(normalized[1].width, 60);
  assert.deepEqual(normalized[1].points, [{ x:0.2, y:0.3 }]);

  // 필기 저장 보류: manneung_ink 는 .ipynb 로 직렬화되지 않는다(세션 한정). 다른 메타데이터는 보존.
  const cell = { id:"ink-cell", type:"markdown", source:"설명", metadata:{
    tags:["keep"],
    manneung_ink:{ version:1, strokes:normalized }
  } };
  const restored = ipynbToModel(modelToIpynb({ cells:[cell], metadata:{} }));
  assert.equal("manneung_ink" in restored.cells[0].metadata, false);
  assert.deepEqual(restored.cells[0].metadata.tags, ["keep"]);

  // 인메모리 정리 헬퍼는 그대로 동작한다.
  const memCell = { metadata:{ manneung_ink:{ version:1, strokes:[] } } };
  notebookDropEmptyInkMetadata(memCell);
  assert.equal("manneung_ink" in memCell.metadata, false);
});

test("셀 재정렬은 위·아래 이동 후에도 배열 순서를 정확히 유지한다", () => {
  const cells = ["a", "b", "c", "d"];
  assert.equal(notebookMoveArrayItem(cells, 0, 2), true);
  assert.deepEqual(cells, ["b", "c", "a", "d"]);
  assert.equal(notebookMoveArrayItem(cells, 3, 1), true);
  assert.deepEqual(cells, ["b", "d", "c", "a"]);
  assert.equal(notebookMoveArrayItem(cells, 1, 1), false);
  assert.equal(notebookMoveArrayItem(cells, -1, 2), false);
  assert.deepEqual(cells, ["b", "d", "c", "a"]);
});

test("노트북 자동완성 문맥은 현재 셀 앞의 코드 셀만 합친다", () => {
  const model = {
    cells: [
      { type:"code", source:"import pandas as pd\nstudent_score = 95" },
      { type:"markdown", source:"student_score 설명" },
      { type:"code", source:"student_" },
      { type:"code", source:"later_value = 1" }
    ]
  };
  const context = notebookCompletionContext(model, model.cells[2], "student_");
  assert.match(context.source, /import pandas as pd/);
  assert.match(context.source, /student_score = 95/);
  assert.doesNotMatch(context.source, /student_score 설명/);
  assert.doesNotMatch(context.source, /later_value/);
  assert.ok(context.source.endsWith("student_"));
  assert.equal(context.lineOffset, 3);
});

test("노트북 자동완성 문맥 캐시는 현재 셀 입력에는 재사용되고 앞 셀 변경 시 무효화된다", () => {
  const model = {
    cells: [
      { type:"code", source:"base_value = 1" },
      { type:"code", source:"base_" },
      { type:"code", source:"later_" }
    ]
  };
  const cache = { model, entries:new Map() };
  const first = notebookCompletionContext(model, model.cells[1], "base_", cache);
  assert.equal(cache.entries.size, 1);
  const currentEdit = notebookCompletionContext(model, model.cells[1], "base_v", cache);
  assert.match(currentEdit.source, /base_value = 1/);
  assert.ok(currentEdit.source.endsWith("base_v"));
  assert.equal(cache.entries.size, 1);

  notebookCompletionContext(model, model.cells[2], "later_", cache);
  assert.equal(cache.entries.size, 2);
  model.cells[0].source = "base_value = 2";
  notebookInvalidateCompletionCache(cache, model, model.cells[0]);
  assert.equal(cache.entries.size, 0);
  const refreshed = notebookCompletionContext(model, model.cells[1], "base_", cache);
  assert.match(refreshed.source, /base_value = 2/);
  assert.doesNotMatch(refreshed.source, /base_value = 1/);
  assert.equal(first.lineOffset, refreshed.lineOffset);
});

test("노트북 작업폴더 분석 소스는 코드 셀만 실행 순서대로 합친다", () => {
  const model = {
    cells: [
      { type:"markdown", source:"dataIn/result01.csv 설명" },
      { type:"code", source:"input_path = 'dataIn/result01.csv'" },
      { type:"raw", source:"무시" },
      { type:"code", source:"pd.read_csv(input_path)" }
    ]
  };
  assert.equal(
    notebookCodeSource(model),
    "input_path = 'dataIn/result01.csv'\n\npd.read_csv(input_path)"
  );
});

test("노트북 전체 찾기는 코드·마크다운 셀의 위치를 순서대로 찾는다", () => {
  const model = {
    cells: [
      { type:"markdown", source:"Pandas 설명" },
      { type:"code", source:"import pandas as pd\npandas_version = 1" },
      { type:"code", source:"print('PANDAS')" }
    ]
  };
  const matches = notebookFindMatches(model, "pandas", { caseSensitive:false });
  assert.deepEqual(matches.map(match => match.cellIndex), [0, 1, 1, 2]);
  assert.equal(notebookFindMatches(model, "pandas", { caseSensitive:true }).length, 2);
  assert.equal(notebookFindMatches(model, "pandas", { caseSensitive:false, word:true }).length, 3);
});

test("노트북 전체 찾기는 마지막과 처음에서 양방향으로 순환한다", () => {
  assert.equal(notebookFindNextIndex(-1, 1, 3, false), 0);
  assert.equal(notebookFindNextIndex(2, 1, 3, true), 0);
  assert.equal(notebookFindNextIndex(-1, -1, 3, false), 2);
  assert.equal(notebookFindNextIndex(0, -1, 3, true), 2);
  assert.equal(notebookFindNextIndex(0, 1, 0, true), -1);
});

test("노트북 전체 바꾸기는 일반 문자열과 정규식을 모든 셀에 적용한다", () => {
  const model = {
    cells: [
      { type:"markdown", source:"result01.csv 설명" },
      { type:"code", source:"a = 'result01.csv'\nb = 'result02.csv'" }
    ]
  };
  assert.equal(notebookReplaceAll(model, "result01", "sample", {}), 2);
  assert.equal(model.cells[0].source, "sample.csv 설명");
  assert.equal(notebookReplaceAll(model, "result(\\d+)", "data$1", { regex:true }), 1);
  assert.match(model.cells[1].source, /data02\.csv/);
});
