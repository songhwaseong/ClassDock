/*
 * 사용법.md → 사용법.html 생성기.
 *
 * 예전에는 두 파일을 손으로 나란히 고쳐야 해서 한쪽만 갱신되면 조용히 어긋났다
 * (오프라인 HTML·EXE 에 들어가는 것은 사용법.html 이라 사용자는 낡은 쪽을 본다).
 * 이제 마크다운이 원본이고 HTML 은 생성물이다. 디자인(CSS·목차·키캡)은 기존 문서를
 * 그대로 옮겼으므로 결과물 모양은 예전과 같다.
 *
 *   node tools/build-manual-html.mjs           # 사용법.html 생성
 *   node tools/build-manual-html.mjs --check   # 생성 결과와 다르면 실패(동기화 검사)
 *
 * 마크다운 표기 → HTML 대응
 *   ## 5. 제목            → <h2 id="sec5">…<a class="back">↑ 목차</a></h2> + 목차 자동 생성
 *   ## 목차               → 그 절은 버리고 번호 붙은 ## 제목으로 목차를 다시 만든다
 *   **최종 업데이트: …**  → 배지(.updated), 그 다음 인용문 → 머리말(.lead)
 *   > ⚠ …                 → 경고 상자(.warn), 그 밖의 인용문 → <blockquote>
 *   ```(박스 그림 문자)   → .ascii 상자, 그 밖의 코드 블록 → <pre><code>
 *   `Ctrl+Shift+O`        → <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>
 *   <div …> 로 시작하는 줄 → 그대로 통과(직접 HTML 을 써야 할 때의 탈출구)
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(root, "사용법.md");
const TARGET = path.join(root, "사용법.html");

// ───────────────────────── 페이지 껍데기(디자인) ─────────────────────────
const PAGE_HEAD = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ClassDock 사용법</title>
<style>
  :root{
    --ink:#1e293b; --muted:#64748b; --border:#e2e8f0; --panel:#f8fafc;
    --accent:#2563eb; --accent-soft:#dbeafe; --code-bg:#f1f5f9; --bg:#ffffff;
    --warn:#b45309; --warn-bg:#fef3c7;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{
    margin:0;padding:0;background:var(--bg);color:var(--ink);
    font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,-apple-system,sans-serif;
    line-height:1.7;font-size:15.5px;
  }
  .wrap{max-width:880px;margin:0 auto;padding:32px 24px 80px}
  h1{font-size:28px;margin:0 0 8px;letter-spacing:-.02em}
  h2{font-size:22px;margin:48px 0 16px;padding:8px 0 6px;border-bottom:2px solid var(--accent-soft);scroll-margin-top:20px}
  h2 .back{font-size:13px;font-weight:400;color:var(--muted);text-decoration:none;float:right;margin-top:6px}
  h2 .back:hover{color:var(--accent)}
  h3{font-size:17px;margin:28px 0 10px;color:var(--ink)}
  h4{font-size:15.5px;margin:18px 0 6px}
  p{margin:10px 0}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  ul,ol{padding-left:24px;margin:10px 0}
  li{margin:4px 0}
  blockquote{border-left:3px solid var(--accent-soft);background:#f8fafc;
    margin:14px 0;padding:10px 16px;color:var(--ink);border-radius:0 6px 6px 0}
  blockquote p{margin:4px 0}
  code{background:var(--code-bg);padding:2px 6px;border-radius:4px;
    font-family:Consolas,"Courier New",monospace;font-size:.92em;color:#0f172a}
  pre{background:var(--code-bg);padding:14px 16px;border-radius:8px;
    overflow-x:auto;border:1px solid var(--border)}
  pre code{background:none;padding:0;font-size:13.5px}
  table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14.5px}
  th,td{border:1px solid var(--border);padding:9px 12px;text-align:left;vertical-align:top}
  th{background:var(--panel);font-weight:600}
  hr{border:none;border-top:1px solid var(--border);margin:32px 0}
  .lead{color:var(--muted);font-size:15px;margin:6px 0 20px}
  .updated{display:inline-block;font-size:13px;color:var(--accent);background:var(--accent-soft);
    padding:4px 12px;border-radius:999px;margin:6px 0 12px}
  /* TOC */
  .toc{background:var(--panel);border:1px solid var(--border);border-radius:10px;
    padding:18px 22px;margin:24px 0 32px}
  .toc h2{font-size:17px;border:none;margin:0 0 10px;padding:0}
  .toc ol{margin:0;padding-left:24px}
  .toc li{margin:6px 0}
  .toc a{color:var(--ink);font-weight:500}
  .toc a:hover{color:var(--accent)}
  /* 박스 */
  .box{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin:14px 0}
  .warn{background:var(--warn-bg);border-left:3px solid var(--warn);padding:10px 14px;border-radius:0 6px 6px 0;color:#78350f;margin:12px 0}
  .warn strong{color:#78350f}
  /* 키캡 스타일 */
  kbd{display:inline-block;padding:2px 7px;font-family:Consolas,monospace;font-size:12.5px;
    background:#fff;border:1px solid var(--border);border-bottom-width:2px;border-radius:4px;color:#334155}
  /* 화면구성 ASCII 박스 */
  .ascii{font-family:Consolas,"Courier New",monospace;font-size:13px;line-height:1.4;
    background:#0f172a;color:#e2e8f0;padding:14px 18px;border-radius:8px;overflow-x:auto;white-space:pre}
  /* 작은 화면 */
  @media (max-width:640px){
    .wrap{padding:20px 14px 60px}
    h1{font-size:24px}
    h2{font-size:19px;margin-top:36px}
    table{font-size:13.5px}
  }
  /* 다크 모드 */
  @media (prefers-color-scheme:dark){
    :root{
      --ink:#e2e8f0;--muted:#94a3b8;--border:#334155;--panel:#1e293b;
      --accent:#60a5fa;--accent-soft:#1e3a8a;--code-bg:#0f172a;--bg:#0b1220;
      --warn:#fbbf24;--warn-bg:#422006;
    }
    blockquote{background:#0f172a}
    pre code,code{color:#e2e8f0}
    th{background:#0f172a}
    .warn{color:#fcd34d}
    .warn strong{color:#fcd34d}
    kbd{background:#1e293b;color:#cbd5e1;border-color:#475569}
  }
</style>
</head>
<body>
<div class="wrap">
`;
const PAGE_FOOT = `
</div>
</body>
</html>
`;

// ───────────────────────── 인라인 변환 ─────────────────────────
const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 키캡으로 그릴 낱말. 한 글자 알파벳·숫자는 조합(Ctrl+C)일 때만 키로 본다 —
// 단독 `A` 까지 키캡으로 만들면 변수 이름 같은 평범한 코드가 키보드처럼 보인다.
const NAMED_KEYS = new Set([
  "Ctrl", "Shift", "Alt", "Win", "Cmd", "Meta", "Esc", "Escape", "Enter", "Tab", "Space",
  "Delete", "Del", "Backspace", "Home", "End", "PageUp", "PageDown", "Insert", "CapsLock"
]);
const MODIFIERS = new Set(["Ctrl", "Shift", "Alt", "Win", "Cmd", "Meta"]);
const SINGLE_SIGN_KEYS = new Set(["+", "-", "−", "=", "/", "\\", "[", "]", ";", "'", ",", "."]);
const isFunctionKey = (token) => /^F([1-9]|1[0-2])$/.test(token);
const isArrowKey = (token) => /^[←→↑↓]$/.test(token);
const isComboKey = (token) => NAMED_KEYS.has(token) || isFunctionKey(token) || isArrowKey(token)
  || /^[A-Z0-9]$/.test(token) || SINGLE_SIGN_KEYS.has(token);
const isSoloKey = (token) => NAMED_KEYS.has(token) || isFunctionKey(token) || isArrowKey(token)
  || SINGLE_SIGN_KEYS.has(token);

const kbd = (token) => `<kbd>${escapeHtml(token)}</kbd>`;

// `Ctrl+Shift+O` → 키캡 3개, `Ctrl+클릭` → 키캡 + 보통 글자, `.py` → 그냥 코드.
function renderCodeSpan(raw) {
  const text = raw.trim();
  if (!text) return `<code>${escapeHtml(raw)}</code>`;
  if (!text.includes("+")) {
    return isSoloKey(text) ? kbd(text) : `<code>${escapeHtml(raw)}</code>`;
  }
  const tokens = text.split("+");
  // "Ctrl+" 처럼 빈 조각이 생기거나 조합키로 시작하지 않으면 코드로 둔다(x+y 같은 수식 보호).
  if (tokens.some((token) => token === "") || !MODIFIERS.has(tokens[0])) {
    return `<code>${escapeHtml(raw)}</code>`;
  }
  return tokens.map((token) => (isComboKey(token) ? kbd(token) : escapeHtml(token))).join("+");
}

// 코드 조각을 먼저 빼두고(자리표시자) 나머지를 이스케이프해야 `<div>` 같은 코드가 살아남는다.
// 자리표시자는 본문에 나올 수 없는 사용자 영역 문자로 감싼다(숫자만 쓰면 평범한 숫자와 섞인다).
const SENTINEL = "\uE000";
const SPAN_PATTERN = /\uE000(\d+)\uE000/g;
function renderInline(text) {
  const spans = [];
  let out = String(text).replace(/`([^`]+)`/g, (_, code) => {
    spans.push(renderCodeSpan(code));
    return SENTINEL + (spans.length - 1) + SENTINEL;
  });
  out = escapeHtml(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>");
  return out.replace(SPAN_PATTERN, (_, index) => spans[Number(index)]);
}

// ───────────────────────── 블록 파서 ─────────────────────────
const HEADING = /^(#{1,4})\s+(.*)$/;
const UNORDERED = /^(\s*)[-*]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)\.\s+(.*)$/;
const RAW_HTML_BLOCK = /^<(div|p|table|details|section|img|iframe)\b/i;
const BOX_DRAWING = /[┌┐└┘├┤┬┴┼─│╔╗╚╝║═]/;

function parseBlocks(lines) {
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (/^\s*```/.test(line)) {                                // 코드 울타리(목록 안에서 들여쓴 것도)
      const fenceIndent = line.match(/^\s*/)[0].length;
      const info = line.trim().slice(3).trim();
      const body = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        body.push(lines[index].slice(fenceIndent)); index += 1;
      }
      index += 1;
      blocks.push({ type: "code", info, body });
      continue;
    }
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) { blocks.push({ type: "hr" }); index += 1; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {                                   // 인용문(경고 상자 포함)
      const body = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", body });
      continue;
    }
    if (/^\|/.test(line)) {                                     // 파이프 표
      const body = [];
      while (index < lines.length && /^\|/.test(lines[index])) { body.push(lines[index]); index += 1; }
      blocks.push({ type: "table", body });
      continue;
    }
    if (RAW_HTML_BLOCK.test(line)) {                            // 직접 쓴 HTML 은 그대로
      const body = [];
      while (index < lines.length && lines[index].trim()) { body.push(lines[index]); index += 1; }
      blocks.push({ type: "raw", body });
      continue;
    }
    // 목록. 항목 아래 더 깊이 들여쓴 줄(중첩 목록·코드 울타리·이어지는 문단)까지 한 덩어리로 모은다.
    if (UNORDERED.test(line) || ORDERED.test(line)) {
      const body = [];
      while (index < lines.length) {
        const current = lines[index];
        if (UNORDERED.test(current) || ORDERED.test(current) || /^\s+\S/.test(current)) {
          body.push(current); index += 1; continue;
        }
        if (!current.trim()) {                                   // 빈 줄 뒤에도 들여쓴 줄이면 계속
          let look = index + 1;
          while (look < lines.length && !lines[look].trim()) look += 1;
          if (look < lines.length && /^\s+\S/.test(lines[look])) { body.push(current); index += 1; continue; }
        }
        break;
      }
      blocks.push({ type: "list", body });
      continue;
    }

    const paragraph = [];                                       // 그 밖에는 문단
    while (index < lines.length && lines[index].trim()
      && !/^(#{1,4}\s|>|\||\s*```|---+\s*$)/.test(lines[index])
      && !UNORDERED.test(lines[index]) && !ORDERED.test(lines[index])) {
      paragraph.push(lines[index].trim()); index += 1;
    }
    if (paragraph.length) {
      const text = paragraph.join(" ");
      // 통째로 굵게 쓴 한 줄은 작은 제목으로 본다(**기본 기능** 같은 소제목 관례).
      const soleBold = /^\*\*([^*]+)\*\*$/.exec(text.trim());
      if (soleBold) blocks.push({ type: "heading", level: 4, text: soleBold[1], fromBold: true });
      else blocks.push({ type: "paragraph", text });
    } else index += 1;
  }
  return blocks;
}

// ───────────────────────── 블록 렌더러 ─────────────────────────
// 항목에 딸린 들여쓴 줄은 다시 블록 파서에 넘긴다 — 중첩 목록·코드 울타리·이어지는 문단이 모두 온다.
function renderList(lines, indent = "") {
  const items = [];
  let cursor = 0;
  const ordered = ORDERED.test(lines[0]);
  while (cursor < lines.length) {
    const match = UNORDERED.exec(lines[cursor]) || ORDERED.exec(lines[cursor]);
    if (!match) { cursor += 1; continue; }
    const markerDepth = match[1].length;
    const text = match.length > 3 ? match[3] : match[2];
    const children = [];
    cursor += 1;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (!next.trim()) { children.push(""); cursor += 1; continue; }
      const nextMatch = UNORDERED.exec(next) || ORDERED.exec(next);
      if (nextMatch && nextMatch[1].length <= markerDepth) break;
      if (!nextMatch && !/^\s/.test(next)) break;
      children.push(next); cursor += 1;
    }
    while (children.length && !children[children.length - 1].trim()) children.pop();

    const inner = renderInline(text);
    if (!children.length) { items.push(`${indent}  <li>${inner}</li>`); continue; }
    const filled = children.filter((line) => line.trim());
    const pad = Math.min(...filled.map((line) => line.match(/^\s*/)[0].length));
    const body = renderBlocks(parseBlocks(children.map((line) => line.slice(pad))), { indent: `${indent}    ` });
    items.push(`${indent}  <li>${inner}\n${body}\n${indent}  </li>`);
  }
  const tag = ordered ? "ol" : "ul";
  return `${indent}<${tag}>\n${items.join("\n")}\n${indent}</${tag}>`;
}

function renderTable(lines) {
  const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const rows = lines.filter((line) => !/^\|[\s:|-]+\|?\s*$/.test(line)).map(cells);
  const [header, ...body] = rows;
  const out = ["<table>"];
  out.push(`<thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`);
  out.push("<tbody>");
  for (const row of body) out.push(`<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`);
  out.push("</tbody>", "</table>");
  return out.join("\n");
}

function renderQuote(body) {
  const first = body.find((line) => line.trim()) || "";
  const warning = /^(\*\*)?\s*⚠/.test(first.trim());
  // 인용문·경고 상자 안에서는 굵은 한 줄을 소제목으로 올리지 않는다(상자 안 첫 줄이 대개 굵다).
  const blocks = parseBlocks(body).map((block) => (block.fromBold
    ? { type: "paragraph", text: `**${block.text}**` }
    : block));
  const inner = renderBlocks(blocks, { indent: "  " });
  if (warning) return `<div class="warn">\n${inner}\n</div>`;
  return `<blockquote>\n${inner}\n</blockquote>`;
}

function renderCode(block) {
  const text = block.body.join("\n");
  if (block.info === "ascii" || BOX_DRAWING.test(text)) {
    return `<div class="ascii">${escapeHtml(text)}</div>`;
  }
  const language = block.info ? ` class="language-${block.info}"` : "";
  return `<pre><code${language}>${escapeHtml(text)}</code></pre>`;
}

// 번호가 붙은 ## 제목은 sec1·sec2… 로, 그 밖의 제목은 글자를 그대로 앵커에 쓴다.
function headingAnchor(text) {
  const numbered = /^(\d+)\.\s/.exec(text);
  if (numbered) return { id: `sec${numbered[1]}`, tocLabel: text.replace(/^\d+\.\s*/, "") };
  return { id: text.trim().replace(/\s+/g, "-").replace(/[?!.,()[\]{}<>"'`/\\]/g, ""), tocLabel: text };
}

function renderBlocks(blocks, options = {}) {
  const indent = options.indent || "";
  const out = [];
  for (const block of blocks) {
    let html = "";
    if (block.type === "heading") {
      if (block.level === 1) html = `<h1>${renderInline(block.text)}</h1>`;
      else if (block.level === 2) {
        const { id } = headingAnchor(block.text);
        html = `<h2 id="${id}">${renderInline(block.text)} <a class="back" href="#toc">↑ 목차</a></h2>`;
      } else html = `<h${block.level}>${renderInline(block.text)}</h${block.level}>`;
    } else if (block.type === "paragraph") {
      html = block.className
        ? `<p class="${block.className}">${renderInline(block.text)}</p>`
        : `<p>${renderInline(block.text)}</p>`;
    } else if (block.type === "list") html = renderList(block.body);
    else if (block.type === "table") html = renderTable(block.body);
    else if (block.type === "quote") html = renderQuote(block.body);
    else if (block.type === "code") html = renderCode(block);
    else if (block.type === "raw") html = block.body.join("\n");
    else if (block.type === "hr") html = "<hr>";
    else if (block.type === "html") html = block.html;
    if (!html) continue;
    if (!indent) { out.push(html); continue; }
    // 코드·ASCII 상자·직접 쓴 HTML 은 줄 안의 공백이 그대로 보이므로 첫 줄만 들여쓴다.
    const preformatted = block.type === "code" || block.type === "raw";
    out.push(preformatted
      ? indent + html
      : html.split("\n").map((line) => (line ? indent + line : line)).join("\n"));
  }
  return out.join("\n\n");
}

// ───────────────────────── 문서 조립 ─────────────────────────
function buildDocument(markdown) {
  const blocks = parseBlocks(markdown.replace(/\r\n/g, "\n").split("\n"));
  const prepared = [];
  let sawTitle = false;
  let leadTaken = false;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // "## 목차" 절은 통째로 버린다 — 목차는 아래에서 제목으로 다시 만든다.
    if (block.type === "heading" && block.level === 2 && block.text.trim() === "목차") {
      let skip = i + 1;
      while (skip < blocks.length && blocks[skip].type !== "heading") skip += 1;
      i = skip - 1;
      // 목차 앞뒤의 구분선이 겹치지 않도록 직전 <hr> 도 함께 접는다.
      if (prepared.length && prepared[prepared.length - 1].type === "hr") prepared.pop();
      continue;
    }
    if (block.type === "heading" && block.level === 1) { sawTitle = true; prepared.push(block); continue; }
    // 제목 바로 아래의 "**최종 업데이트: …**" 는 소제목이 아니라 배지로.
    if (sawTitle && block.fromBold && /^최종 업데이트:/.test(block.text.trim())) {
      prepared.push({ type: "paragraph", className: "updated", text: `**${block.text}**` });
      continue;
    }
    // 그다음 첫 인용문은 머리말로.
    if (sawTitle && !leadTaken && block.type === "quote") {
      leadTaken = true;
      prepared.push({ type: "paragraph", className: "lead", text: block.body.join(" ").trim() });
      continue;
    }
    prepared.push(block);
  }

  const entries = prepared
    .filter((block) => block.type === "heading" && block.level === 2)
    .map((block) => headingAnchor(block.text));
  const toc = [
    '<nav class="toc" id="toc">',
    "<h2>목차</h2>",
    "<ol>",
    ...entries.map((entry) => `  <li><a href="#${entry.id}">${renderInline(entry.tocLabel)}</a></li>`),
    "</ol>",
    "</nav>"
  ].join("\n");

  // 목차는 머리말(또는 제목) 다음, 첫 <h2> 앞에 넣는다.
  const firstHeading = prepared.findIndex((block) => block.type === "heading" && block.level === 2);
  const insertAt = firstHeading < 0 ? prepared.length : firstHeading;
  prepared.splice(insertAt, 0, { type: "html", html: toc }, { type: "hr" });

  const body = renderBlocks(prepared).replace(/(<hr>)(\n\n<hr>)+/g, "$1");
  return PAGE_HEAD + "\n" + body + PAGE_FOOT;
}

// ───────────────────────── 실행 ─────────────────────────
// 테스트가 이 파일을 import 해도 사용법.html 을 건드리지 않도록, 직접 실행할 때만 쓴다.
const buildManualHtml = () => buildDocument(fs.readFileSync(SOURCE, "utf8"));
const executedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (executedDirectly) {
  const html = buildManualHtml();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : "";
    if (current !== html) {
      console.error("사용법.html 이 사용법.md 와 어긋났습니다. `npm run build:manual` 로 다시 생성하세요.");
      process.exit(1);
    }
    console.log("사용법.html 동기화 확인 완료");
  } else {
    fs.writeFileSync(TARGET, html, "utf8");
    const sections = (html.match(/<h2 id=/g) || []).length;
    console.log(`사용법.html 생성 완료: ${html.length.toLocaleString("ko-KR")}자 · 절 ${sections}개`);
  }
}

export { buildDocument, buildManualHtml, renderInline, renderCodeSpan, SOURCE, TARGET };
