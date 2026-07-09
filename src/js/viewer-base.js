"use strict";

/* ===== 오피스 미리보기 (보기 전용) ===== */
async function loadOffice(file, ext, options={}){
  const doc = makeDoc("office", file.name, options);
  doc.sourceFile = file;                     // 내용 검색용 원본 파일 핸들(텍스트·코드만 실제로 읽음)
  if (Array.isArray(options.spreadsheetAoa)) doc.spreadsheetAoa = options.spreadsheetAoa;
  doc.render = async () => {                 // 처음 활성화될 때 실제 렌더(지연 렌더)
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    const siblingCtx = { relPath: doc.relPath || options.relPath, archiveCtx: doc.archiveCtx || options.archiveCtx };
    if (ext === "docx")      await renderDocx(file, host);
    else if (ext === "pptx") await renderPptx(file, host, options);
    else if (ext === "hwp" || ext === "hwpx") await renderHwp(file, ext, host);
    else if (ext === "md" || ext === "markdown" || ext === "mdx") await renderMarkdown(file, host, doc);
    else if (ext === "txt")  await renderCode(file, host, "txt", "text");   // 텍스트도 코드뷰로 → 편집 토글·저장 지원
    else if (ext === "html" || ext === "htm" || ext === "xhtml") await renderCode(file, host, ext, "xml", siblingCtx);   // 소스 우선 + [미리보기] 토글로 렌더

    else if (CODE_EXTS[ext]) await renderCode(file, host, ext, null, siblingCtx);   // js/py/json/css/sql/xml 등
    else                     await renderXlsx(file, host, doc);   // xlsx / xls / csv (위 else 가 모두 받음 — 중복 호출 제거)
  };
  refreshChrome();
  activateIfIdle(doc, options);              // 단일 열기면 즉시 렌더, 묶음이면 첫 개만
  return doc;
}

async function loadSqlite(file, options={}){
  const doc = makeDoc("office", file.name, options);
  doc.sourceFile = file;
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    await renderSqlite(file, host);
  };
  refreshChrome();
  activateIfIdle(doc, options);
  return doc;
}

function sqliteHeaderValid(bytes){
  const signature = "SQLite format 3\u0000";
  if (!bytes || bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) if (bytes[i] !== signature.charCodeAt(i)) return false;
  return true;
}

function sqliteMessage(host, title, detail, kind=""){
  const wrap = document.createElement("div"); wrap.className = "sqlite-message" + (kind ? " " + kind : "");
  const heading = document.createElement("strong"); heading.textContent = title;
  const text = document.createElement("p"); text.textContent = detail;
  wrap.append(heading, text); host.appendChild(wrap);
}

async function renderSqlite(file, host){
  const shell = document.createElement("section"); shell.className = "sqlite-host";
  host.appendChild(shell);
  const loading = document.createElement("div"); loading.className = "sqlite-message";
  loading.textContent = "SQLite 데이터베이스를 읽는 중…";
  shell.appendChild(loading);

  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch(e){ shell.textContent = ""; sqliteMessage(shell, "파일을 읽지 못했어요", (e && e.message) || String(e), "error"); return; }
  if (!sqliteHeaderValid(bytes)){
    shell.textContent = "";
    sqliteMessage(shell, "SQLite 데이터베이스가 아닙니다", "확장자는 데이터베이스처럼 보이지만 SQLite 3 파일 헤더가 없습니다.", "error");
    return;
  }
  if (location.protocol !== "http:" && location.protocol !== "https:"){
    shell.textContent = "";
    sqliteMessage(shell, "EXE에서 열어주세요", "SQLite 표 미리보기는 만능교실 EXE의 읽기 전용 데이터베이스 엔진을 사용합니다.");
    return;
  }

  let data;
  try {
    const response = await fetch("/sqlite-preview", {
      method: "POST",
      headers: { "Content-Type":"application/octet-stream" },
      body: bytes
    });
    if (!response.ok){
      const reason = await response.text();
      if (response.status === 501) throw new Error("이 컴퓨터에서 Python을 찾지 못해 SQLite를 열 수 없습니다.");
      if (response.status === 413) throw new Error("100MB를 넘는 SQLite 파일은 미리보기를 지원하지 않습니다.");
      if (response.status === 415) throw new Error("SQLite 3 형식이 아닌 데이터베이스입니다.");
      throw new Error(reason || ("HTTP " + response.status));
    }
    data = await response.json();
    if (!data || data.ok === false) throw new Error((data && data.error) || "SQLite 내용을 읽지 못했습니다.");
  } catch(e){
    shell.textContent = "";
    sqliteMessage(shell, "데이터베이스를 열지 못했어요", (e && e.message) || String(e), "error");
    return;
  }

  shell.textContent = "";
  const toolbar = document.createElement("div"); toolbar.className = "sqlite-toolbar";
  const identity = document.createElement("div"); identity.className = "sqlite-identity";
  const title = document.createElement("strong"); title.textContent = file.name;
  const summary = document.createElement("span");
  const tables = Array.isArray(data.tables) ? data.tables : [];
  summary.textContent = "SQLite 3 · " + tables.length + "개 테이블/뷰 · 읽기 전용 · 행 미리보기 최대 " + (data.limit || 200) + "개";
  identity.append(title, summary);
  const refresh = document.createElement("button"); refresh.type = "button"; refresh.textContent = "↻ 새로고침";
  refresh.title = "현재 파일을 다시 읽습니다";
  refresh.addEventListener("click", async () => {
    if (refresh.disabled) return;
    refresh.disabled = true;
    try { host.innerHTML = ""; await renderSqlite(file, host); } finally { refresh.disabled = false; }
  });
  toolbar.append(identity, refresh);
  shell.appendChild(toolbar);

  if (!tables.length){
    sqliteMessage(shell, "비어 있는 데이터베이스입니다", "사용자 테이블이나 뷰가 아직 없습니다.");
    return;
  }

  const layout = document.createElement("div"); layout.className = "sqlite-layout";
  const nav = document.createElement("nav"); nav.className = "sqlite-table-list"; nav.setAttribute("aria-label", "SQLite 테이블");
  const content = document.createElement("div"); content.className = "sqlite-content";
  layout.append(nav, content); shell.appendChild(layout);

  const renderTable = (table, activeButton) => {
    nav.querySelectorAll("button").forEach(button => button.classList.toggle("active", button === activeButton));
    content.textContent = "";
    const head = document.createElement("div"); head.className = "sqlite-table-head";
    const name = document.createElement("h3"); name.textContent = table.name;
    const count = document.createElement("span");
    count.textContent = table.type === "view" ? "VIEW" : "TABLE";
    if (table.rowCount !== null && table.rowCount !== undefined) count.textContent += " · " + Number(table.rowCount).toLocaleString() + "행";
    head.append(name, count); content.appendChild(head);

    if (table.error){
      sqliteMessage(content, "이 테이블을 읽지 못했어요", table.error, "error");
      return;
    }

    const columns = Array.isArray(table.columns) ? table.columns : [];
    if (columns.length){
      const schema = document.createElement("div"); schema.className = "sqlite-schema";
      for (const column of columns){
        const chip = document.createElement("span"); chip.className = "sqlite-column";
        const columnName = document.createElement("b"); columnName.textContent = column.name;
        const type = document.createElement("small"); type.textContent = column.type || "형식 없음";
        chip.append(columnName, type);
        if (column.pk) chip.dataset.key = "PK";
        else if (column.notnull) chip.dataset.key = "NOT NULL";
        schema.appendChild(chip);
      }
      content.appendChild(schema);
    }

    if (table.sql){
      const details = document.createElement("details"); details.className = "sqlite-sql";
      const caption = document.createElement("summary"); caption.textContent = "CREATE SQL";
      const pre = document.createElement("pre"); pre.textContent = table.sql;
      details.append(caption, pre); content.appendChild(details);
    }

    const displayColumns = Array.isArray(table.displayColumns) && table.displayColumns.length
      ? table.displayColumns : columns.map(column => column.name);
    const rows = Array.isArray(table.rows) ? table.rows : [];
    if (!displayColumns.length){
      sqliteMessage(content, "표시할 컬럼이 없습니다", "테이블 구조를 확인해 주세요.");
      return;
    }
    const scroller = document.createElement("div"); scroller.className = "sqlite-grid-wrap";
    const grid = document.createElement("table"); grid.className = "sqlite-grid";
    const thead = document.createElement("thead"), headerRow = document.createElement("tr");
    const rowNo = document.createElement("th"); rowNo.textContent = "#"; headerRow.appendChild(rowNo);
    displayColumns.forEach(column => { const th = document.createElement("th"); th.textContent = column; headerRow.appendChild(th); });
    thead.appendChild(headerRow); grid.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      const no = document.createElement("th"); no.scope = "row"; no.textContent = String(index + 1); tr.appendChild(no);
      displayColumns.forEach((_, columnIndex) => {
        const td = document.createElement("td"), value = row && row[columnIndex];
        if (value === null || value === undefined){ td.textContent = "NULL"; td.className = "sqlite-null"; }
        else td.textContent = String(value);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    grid.appendChild(tbody); scroller.appendChild(grid); content.appendChild(scroller);
    if (!rows.length) sqliteMessage(content, "데이터가 없습니다", "테이블 구조는 있지만 저장된 행이 없습니다.");
    else if (table.rowCount > rows.length){
      const limited = document.createElement("p"); limited.className = "sqlite-limit";
      limited.textContent = "전체 " + Number(table.rowCount).toLocaleString() + "행 중 처음 " + rows.length.toLocaleString() + "행을 표시합니다.";
      content.appendChild(limited);
    }
  };

  tables.forEach((table, index) => {
    const button = document.createElement("button"); button.type = "button";
    const name = document.createElement("span"); name.textContent = table.name;
    const badge = document.createElement("small");
    badge.textContent = table.rowCount === null || table.rowCount === undefined ? table.type : Number(table.rowCount).toLocaleString();
    button.append(name, badge);
    button.addEventListener("click", () => renderTable(table, button));
    nav.appendChild(button);
    if (index === 0) renderTable(table, button);
  });
}

function focusRenderedTextMatch(root, query){
  if (!root || !query) return false;
  clearTimeout(root._contentSearchFlashTimer);
  root.querySelectorAll("mark.content-search-flash").forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent || "")));
  root.normalize();
  const needle = String(query).toLocaleLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = null, at = -1;
  while ((node = walker.nextNode())){
    at = String(node.nodeValue || "").toLocaleLowerCase().indexOf(needle);
    if (at >= 0) break;
  }
  if (!node || at < 0) return false;
  const mark = document.createElement("mark");
  mark.className = "content-search-flash";
  mark.tabIndex = -1;
  mark.textContent = node.nodeValue.slice(at, at + String(query).length);
  const before = document.createTextNode(node.nodeValue.slice(0, at));
  const after = document.createTextNode(node.nodeValue.slice(at + String(query).length));
  node.replaceWith(before, mark, after);
  try { mark.focus({ preventScroll:true }); } catch(_) { mark.focus(); }
  mark.scrollIntoView({ block:"center", inline:"nearest", behavior:"smooth" });
  root._contentSearchFlashTimer = setTimeout(() => {
    if (!mark.isConnected) return;
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
    root.normalize();
  }, 2400);
  return true;
}

async function renderMarkdown(file, host, ownerDoc){
  const wrap = document.createElement("article");
  wrap.className = "md-host";
  wrap.innerHTML = markdownToHtml(smartDecodeText(new Uint8Array(await file.arrayBuffer())), { allowHtml: true });
  host.appendChild(wrap);
  if (ownerDoc) ownerDoc.contentSearchFocus = (query) => focusRenderedTextMatch(wrap, query);
}

async function renderText(file, host){
  const wrap = document.createElement("article");
  const pre = document.createElement("pre");
  wrap.className = "txt-host";
  pre.textContent = smartDecodeText(new Uint8Array(await file.arrayBuffer()));
  wrap.appendChild(pre);
  host.appendChild(wrap);
}

const normRel = (p) => String(p || "").replace(/\\/g, "/").replace(/^\/+/, "");

/* HTML 파일 보기: 업로드된 HTML 의 스크립트가 본 앱·쿠키에 접근하지 못하도록
   sandbox 격리된 iframe 으로 렌더링한다(같은 출처 권한은 부여하지 않음). */
async function renderHtmlFile(file, host, runCtx){
  const wrap = document.createElement("div");
  wrap.className = "html-host";
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-popups allow-forms allow-modals");
  frame.setAttribute("referrerpolicy", "no-referrer");
  // zip/폴더로 열렸으면 옆 리소스(이미지·CSS·JS)를 인라인하고,
  // 옆 HTML 페이지로 향하는 <a> 링크는 클릭을 가로채 같은 iframe 안에서 페이지를 전환한다.
  if (runCtx && runCtx.archiveCtx && runCtx.relPath){
    try {
      const files = await runCtx.archiveCtx.extract();
      const byPath = new Map();
      for (const f of files) byPath.set(normRel(f.path), f.bytes);
      const startRel = normRel(runCtx.relPath);
      if (byPath.has(startRel)){
        const backBtn = document.createElement("button");
        backBtn.type = "button"; backBtn.className = "html-nav-back"; backBtn.textContent = "← 뒤로"; backBtn.hidden = true;
        const stack = [];
        const render = (rel) => {
          const bytes = byPath.get(rel);
          if (bytes) frame.setAttribute("srcdoc", buildSelfContainedHtml(bytes, rel, byPath));
        };
        const go = (rel) => { stack.push(rel); render(rel); backBtn.hidden = stack.length <= 1; };
        backBtn.onclick = () => {
          if (stack.length <= 1) return;
          stack.pop(); render(stack[stack.length - 1]); backBtn.hidden = stack.length <= 1;
        };
        // 샌드박스(origin=null) iframe 이 보내는 이동 요청만 받는다(이 frame 의 창에서 온 것인지 확인).
        window.addEventListener("message", (e) => {
          if (e.source !== frame.contentWindow || !e.data || e.data.__htmlNav !== true) return;
          const target = normRel(e.data.path || "");
          if (byPath.has(target)) go(target);
        });
        go(startRel);
        wrap.appendChild(backBtn);
        wrap.appendChild(frame);
        host.appendChild(wrap);
        return;
      }
    } catch(e){ console.warn("HTML 옆 리소스/링크 처리 실패 — 원본으로 표시:", e); }
  }
  // 단독 HTML(또는 위 처리 실패): 원본 바이트를 그대로 넘겨 문서의 <meta charset> 을 따르게 한다(EUC-KR 등 한글 인코딩 보존)
  const url = URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: "text/html" }));
  frame.src = url;
  frame.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  wrap.appendChild(frame);
  host.appendChild(wrap);
}

const HTML_MIME = { html:"text/html", htm:"text/html", css:"text/css", js:"text/javascript", mjs:"text/javascript",
  json:"application/json", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", svg:"image/svg+xml",
  webp:"image/webp", avif:"image/avif", bmp:"image/bmp", ico:"image/x-icon", woff:"font/woff", woff2:"font/woff2",
  ttf:"font/ttf", otf:"font/otf", eot:"application/vnd.ms-fontobject", mp4:"video/mp4", webm:"video/webm",
  ogg:"audio/ogg", mp3:"audio/mpeg", wav:"audio/wav", m4a:"audio/mp4", txt:"text/plain", xml:"application/xml", wasm:"application/wasm" };
function mimeForPath(p){ return HTML_MIME[(String(p).split(".").pop() || "").toLowerCase()] || "application/octet-stream"; }
function rewriteCssUrls(css, baseRel, urlFn){
  return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
    if (isExternalRef(ref)) return m;
    const p = resolveSiblingPath(baseRel, ref); const u = p && urlFn(p);
    return u ? "url(" + q + u + q + ")" : m;
  });
}
function rewriteSrcset(el, baseRel, urlFn){
  const ss = el.getAttribute("srcset"); if (!ss) return;
  el.setAttribute("srcset", ss.split(",").map(part => {
    const seg = part.trim(); if (!seg) return seg;
    const sp = seg.split(/\s+/);
    if (!isExternalRef(sp[0])){ const p = resolveSiblingPath(baseRel, sp[0]); const u = p && urlFn(p); if (u) sp[0] = u; }
    return sp.join(" ");
  }).join(", "));
}
// 샌드박스 iframe 안에서 옆 HTML 페이지로의 링크 클릭을 부모로 알린다(부모가 같은 iframe 에 그 페이지를 다시 그림).
const HTML_NAV_SCRIPT =
  "document.addEventListener('click',function(e){" +
  "var a=e.target&&e.target.closest?e.target.closest('a[data-navhtml]'):null;" +
  "if(!a)return;e.preventDefault();" +
  "try{parent.postMessage({__htmlNav:true,path:a.getAttribute('data-navhtml')},'*');}catch(_){}" +
  "},true);";

// zip/폴더로 연 HTML: 옆 리소스를 인라인(이미지·폰트·미디어=data: / CSS=<style> / JS=인라인 <script>)해 자체 완결 HTML 로.
// 샌드박스(allow-same-origin 없음)에서도 동작하도록 blob URL 대신 data:/인라인을 쓴다.
// htmlBytes = 그릴 HTML 의 원본 바이트, htmlRel = 묶음 내 그 HTML 의 경로, byPath = 묶음 전체(경로→bytes).
function buildSelfContainedHtml(htmlBytes, htmlRel, byPath){
  const cache = new Map();
  const dataUrl = (p) => {
    if (cache.has(p)) return cache.get(p);
    const bytes = byPath.get(p);
    if (!bytes || bytes.length > 12 * 1024 * 1024){ cache.set(p, null); return null; }   // 12MB 초과는 생략
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const u = "data:" + mimeForPath(p) + ";base64," + btoa(bin);
    cache.set(p, u); return u;
  };
  const doc = new DOMParser().parseFromString(smartDecodeText(htmlBytes), "text/html");
  const rewriteAttr = (el, attr, baseRel) => {
    const ref = el.getAttribute(attr); if (!ref || isExternalRef(ref)) return;
    const p = resolveSiblingPath(baseRel, ref); const u = p && dataUrl(p); if (u) el.setAttribute(attr, u);
  };
  doc.querySelectorAll("img[src],source[src],video[src],audio[src],embed[src],input[src],track[src]").forEach(el => rewriteAttr(el, "src", htmlRel));
  doc.querySelectorAll("[poster]").forEach(el => rewriteAttr(el, "poster", htmlRel));
  doc.querySelectorAll("img[srcset],source[srcset]").forEach(el => rewriteSrcset(el, htmlRel, dataUrl));
  doc.querySelectorAll("use, image").forEach(el => { rewriteAttr(el, "href", htmlRel); rewriteAttr(el, "xlink:href", htmlRel); });
  // <link>: 스타일시트는 내용을 가져와 url() 재작성 후 <style> 로 인라인, 아이콘 등은 data:
  [...doc.querySelectorAll("link[href]")].forEach(link => {
    const ref = link.getAttribute("href"); if (!ref || isExternalRef(ref)) return;
    const p = resolveSiblingPath(htmlRel, ref); if (!p || !byPath.has(p)) return;
    if ((link.getAttribute("rel") || "").toLowerCase().indexOf("stylesheet") >= 0){
      const style = doc.createElement("style");
      style.textContent = rewriteCssUrls(smartDecodeText(byPath.get(p)), p, dataUrl);
      link.replaceWith(style);
    } else { const u = dataUrl(p); if (u) link.setAttribute("href", u); }
  });
  // <script src=옆파일> → 내용을 인라인(샌드박스에서 실행 가능)
  [...doc.querySelectorAll("script[src]")].forEach(s => {
    const ref = s.getAttribute("src"); if (!ref || isExternalRef(ref)) return;
    const p = resolveSiblingPath(htmlRel, ref); if (!p || !byPath.has(p)) return;
    const inl = doc.createElement("script");
    for (const a of s.attributes){ if (a.name.toLowerCase() !== "src") inl.setAttribute(a.name, a.value); }
    inl.textContent = smartDecodeText(byPath.get(p));
    s.replaceWith(inl);
  });
  doc.querySelectorAll("style").forEach(st => { st.textContent = rewriteCssUrls(st.textContent || "", htmlRel, dataUrl); });
  doc.querySelectorAll("[style]").forEach(el => { const v = el.getAttribute("style"); if (v && v.indexOf("url(") >= 0) el.setAttribute("style", rewriteCssUrls(v, htmlRel, dataUrl)); });
  // <a href=옆HTML> → 클릭 시 같은 iframe 안에서 그 페이지로 전환(data-navhtml 표시 후 주입 스크립트가 가로챔).
  // 외부/앵커(#)/이미 data: 인 것은 그대로 둔다(앵커는 iframe 안에서 그대로 스크롤된다).
  let hasNav = false;
  doc.querySelectorAll("a[href]").forEach(a => {
    const ref = a.getAttribute("href"); if (!ref || isExternalRef(ref)) return;
    const p = resolveSiblingPath(htmlRel, ref);
    if (p && byPath.has(p) && /\.(?:xhtml|html?|htm)$/i.test(p)){
      a.setAttribute("data-navhtml", p);
      a.setAttribute("href", "#");
      hasNav = true;
    }
  });
  if (hasNav){
    const nav = doc.createElement("script");
    nav.textContent = HTML_NAV_SCRIPT;
    (doc.body || doc.documentElement).appendChild(nav);
  }
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}
