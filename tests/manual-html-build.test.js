"use strict";

/*
 * 사용법.html 은 사용법.md 로 만든다(tools/build-manual-html.mjs).
 * 손으로 두 파일을 고치던 시절에는 한쪽만 갱신돼도 아무도 몰랐고, 배포물(오프라인 HTML·EXE)에
 * 들어가는 것은 HTML 이라 사용자만 낡은 문서를 봤다. 이 테스트가 그 어긋남을 막는다.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const toolUrl = "file:///" + path.join(root, "tools", "build-manual-html.mjs").replace(/\\/g, "/");
const loadTool = () => import(toolUrl);

test("사용법.html 은 사용법.md 에서 생성한 결과와 같아야 한다", async () => {
  const { buildManualHtml } = await loadTool();
  const generated = buildManualHtml();
  const current = fs.readFileSync(path.join(root, "사용법.html"), "utf8");
  assert.strictEqual(current, generated,
    "사용법.html 이 사용법.md 와 어긋났습니다. `npm run build:manual` 로 다시 생성하세요.");
});

test("키 조합은 키캡으로, 그 밖의 코드는 코드로 그린다", async () => {
  const { renderCodeSpan } = await loadTool();
  assert.strictEqual(renderCodeSpan("Ctrl+Shift+O"), "<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>");
  assert.strictEqual(renderCodeSpan("Ctrl+클릭"), "<kbd>Ctrl</kbd>+클릭");
  assert.strictEqual(renderCodeSpan("Esc"), "<kbd>Esc</kbd>");
  assert.strictEqual(renderCodeSpan("F10"), "<kbd>F10</kbd>");
  // 키가 아닌 것은 키캡으로 만들지 않는다 — 파일명·코드·수식이 키보드처럼 보이면 안 된다.
  assert.strictEqual(renderCodeSpan(".py"), "<code>.py</code>");
  assert.strictEqual(renderCodeSpan("main.py"), "<code>main.py</code>");
  assert.strictEqual(renderCodeSpan("x+y"), "<code>x+y</code>");
  assert.strictEqual(renderCodeSpan("input()"), "<code>input()</code>");
});

test("인라인 표기는 코드 안의 꺾쇠까지 안전하게 이스케이프한다", async () => {
  const { renderInline } = await loadTool();
  assert.strictEqual(renderInline("**굵게**"), "<strong>굵게</strong>");
  assert.strictEqual(renderInline("[README.md](README.md)"), '<a href="README.md">README.md</a>');
  assert.strictEqual(renderInline("`<script>` 태그"), "<code>&lt;script&gt;</code> 태그");
  assert.strictEqual(renderInline("a < b & c"), "a &lt; b &amp; c");
  // 코드 자리표시자가 본문 숫자와 섞이면 안 된다.
  assert.strictEqual(renderInline("`Esc` 0 1 2"), "<kbd>Esc</kbd> 0 1 2");
});

test("문서 뼈대: 목차·절 앵커·경고 상자·ASCII 상자를 만든다", async () => {
  const { buildDocument } = await loadTool();
  const html = buildDocument([
    "# 제목",
    "",
    "**최종 업데이트: 2026년 1월 1일**",
    "",
    "> 머리말 문장.",
    "",
    "## 1. 첫 절",
    "",
    "> ⚠ 조심하세요.",
    "",
    "```",
    "┌───┐",
    "└───┘",
    "```",
    "",
    "**소제목**",
    "",
    "- 목록 항목",
    ""
  ].join("\n"));

  assert.match(html, /<p class="updated"><strong>최종 업데이트: 2026년 1월 1일<\/strong><\/p>/);
  assert.match(html, /<p class="lead">머리말 문장\.<\/p>/);
  assert.match(html, /<nav class="toc" id="toc">/);
  assert.match(html, /<li><a href="#sec1">첫 절<\/a><\/li>/);
  assert.match(html, /<h2 id="sec1">1\. 첫 절 <a class="back" href="#toc">↑ 목차<\/a><\/h2>/);
  assert.match(html, /<div class="warn">/);
  assert.match(html, /<div class="ascii">┌───┐/);
  assert.match(html, /<h4>소제목<\/h4>/);      // 통째로 굵은 한 줄은 소제목
  assert.match(html, /<ul>\n {2}<li>목록 항목<\/li>\n<\/ul>/);
  assert.ok(!html.includes("<h2>목차</h2>\n<ol>\n</ol>"), "빈 목차가 생기면 안 된다");
});

test("목록 안에 들여쓴 코드 울타리는 항목 안에서 원문 공백을 지킨다", async () => {
  const { buildDocument } = await loadTool();
  const html = buildDocument([
    "# 제목",
    "",
    "## 1. 절",
    "",
    "1. 클론:",
    "   ```bash",
    "   git clone https://example.com/repo.git",
    "   cd repo",
    "   ```",
    ""
  ].join("\n"));
  assert.match(html, /<li>클론:\n\s*<pre><code class="language-bash">git clone https:\/\/example\.com\/repo\.git\ncd repo<\/code><\/pre>/);
});

test("생성기는 마크다운 원본과 HTML 출력 경로를 저장소 안에서만 다룬다", async () => {
  const { SOURCE, TARGET } = await loadTool();
  assert.strictEqual(path.dirname(SOURCE), root);
  assert.strictEqual(path.dirname(TARGET), root);
  assert.strictEqual(path.basename(SOURCE), "사용법.md");
  assert.strictEqual(path.basename(TARGET), "사용법.html");
});
