"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const viewer = fs.readFileSync(path.join(__dirname, "../src/js/code-viewer.js"), "utf8");
const start = viewer.indexOf("const CODE_KW");
const end = viewer.indexOf("function ipynbToPython");
const context = {
  window: {},
  escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;")
};
vm.createContext(context);
vm.runInContext(viewer.slice(start, end), context);

test("Python 데코레이터와 정의 함수명은 전용 토큰으로 강조한다", () => {
  const html = context.highlightCodeBase("@st.cache_resource\ndef load_vectorstore():\n    return Chroma()", "python");
  assert.match(html, /<span class="tk-d">@st\.cache_resource<\/span>/);
  assert.match(html, /<span class="tk-k">def<\/span> <span class="tk-f">load_vectorstore<\/span>/);
});

test("Python 강조는 async 정의와 의미 분석 표식 안의 함수명도 유지한다", () => {
  const html = context.highlightCode("async def load_data():\n    pass", "python", [{ start:10, end:19, cls:"tk-unused" }]);
  assert.match(html, /<span class="tk-k">async def<\/span> <span class="tk-unused"><span class="tk-f">load_data<\/span><\/span>/);
});

test("데코레이터처럼 보이는 문자열과 주석은 코드 토큰으로 강조하지 않는다", () => {
  const html = context.highlightCodeBase("# @st.cache_resource\nlabel = '@st.cache_resource'", "python");
  assert.doesNotMatch(html, /tk-d/);
});
