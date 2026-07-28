"use strict";

/* ===== 오피스 미리보기 (보기 전용) ===== */
async function loadOffice(file, ext, options={}){
  const doc = makeDoc("office", file.name, options);
  doc.sourceFile = file;                     // 내용 검색용 원본 파일 핸들(텍스트·코드만 실제로 읽음)
  doc.convertedFromCsv = !!options.convertedFromCsv;
  if (Array.isArray(options.spreadsheetAoa)) doc.spreadsheetAoa = options.spreadsheetAoa;
  if (typeof options.spreadsheetHasHeader === "boolean") doc.spreadsheetHasHeader = options.spreadsheetHasHeader;   // CSV→XLSX 변환 시 '첫 줄 머리글' 선택 전달
  doc.render = async () => {                 // 처음 활성화될 때 실제 렌더(지연 렌더)
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    const source = doc.sourceFile || file;
    const siblingCtx = { relPath: doc.relPath || options.relPath, archiveCtx: doc.archiveCtx || options.archiveCtx };
    if (ext === "docx")      await renderDocx(source, host);
    else if (ext === "doc")  await renderDocLegacy(source, host, doc);   // 구형 바이너리 Word — 글자만 뽑는 간이 미리보기
    else if (ext === "pptx") await renderPptx(source, host, options);
    else if (ext === "hwp" || ext === "hwpx") await renderHwp(source, ext, host);
    else if (ext === "md" || ext === "markdown" || ext === "mdx") await renderCode(source, host, ext, "text", siblingCtx);   // 미리보기 우선 + [✎ 편집]·저장 (code-viewer 의 isMd 경로)
    else if (ext === "txt")  await renderCode(source, host, "txt", "text");   // 텍스트도 코드뷰로 → 편집 토글·저장 지원
    else if (ext === "html" || ext === "htm" || ext === "xhtml") await renderCode(source, host, ext, "xml", siblingCtx);   // 소스 우선 + [미리보기] 토글로 렌더

    else if (CODE_EXTS[ext]) await renderCode(source, host, ext, null, siblingCtx);   // js/py/json/css/sql/xml 등
    else                     await renderXlsx(source, host, doc);   // xlsx / xls / csv (위 else 가 모두 받음 — 중복 호출 제거)
    // 본문 검색 결과 클릭 → 렌더된 화면에서 일치 글자로 스크롤+하이라이트 (마크다운·CSV 와 같은 통로)
    if (["docx", "doc", "pptx", "hwp", "hwpx"].includes(ext)) doc.contentSearchFocus = (query) => focusRenderedTextMatch(host, query);
  };
  refreshChrome();
  activateIfIdle(doc, options);              // 단일 열기면 즉시 렌더, 묶음이면 첫 개만
  return doc;
}

async function loadSqlite(file, options={}){
  const doc = makeDoc("office", file.name, options);
  doc.sourceFile = file;
  doc.sqliteDocument = true;
  // 서버가 실제 저장 폴더 파일로 확인한 .db 만 편집한다. 일반 드래그/압축 내부 파일의 논리 경로는 쓰지 않는다.
  doc.dbPath = options.sqliteDiskPath || null;
  doc.dbFullPath = "";
  doc.render = async () => {
    const host = doc.el; host.innerHTML = ""; host.scrollTop = 0;
    await renderSqlite(doc.sourceFile || file, host, doc.dbPath, (path, fullPath) => {
      doc.dbPath = path;
      if (fullPath) doc.dbFullPath = fullPath;
    }, doc.dbFullPath);
  };
  refreshChrome();
  activateIfIdle(doc, options);
  return doc;
}

// 파일/폴더를 처음 열 때는 화면 렌더가 작업공간 복사보다 먼저 끝난다.
// 복사가 끝난 직후 저장 루트의 동일 바이트 DB임을 서버로 재확인하고, 열린 읽기 전용 탭을 실행 가능 상태로 바꾼다.
async function promoteSavedSqliteDocuments(files){
  if (location.protocol !== "http:" && location.protocol !== "https:") return 0;
  const candidates = [...(files || [])]
    .map(file => ({
      file,
      path: String(file && (file.webkitRelativePath || file.name) || "")
        .replace(/\\/g, "/").replace(/^\/+/, "")
    }))
    .filter(item => item.file && /\.(db|sqlite|sqlite3)$/i.test(item.path));
  if (!candidates.length) return 0;

  let promoted = 0;
  for (const item of candidates){
    const path = item.path;
    const doc = docs.find(candidate => candidate && candidate.sqliteDocument && !candidate.dbPath
      && (candidate.sourceFile === item.file || normalizedRunPath(candidate.workspacePath) === normalizedRunPath(path)));
    if (!doc) continue;
    try {
      const bytes = new Uint8Array(await (doc.sourceFile || item.file).arrayBuffer());
      if (!sqliteHeaderValid(bytes)) continue;
      const expectedFingerprint = await sqliteSha256(bytes);
      if (!expectedFingerprint) continue;
      await sqliteDiskSnapshot(path, expectedFingerprint);
      doc.dbPath = path;
      promoted++;
      if (doc.el && !doc.el.hidden && typeof doc.render === "function") await doc.render();
    } catch(e){
      if (!e || (e.status !== 404 && e.status !== 409))
        console.warn("SQLite 실행 화면 활성화 실패:", e);
    }
  }
  return promoted;
}

function sqliteHeaderValid(bytes){
  const signature = "SQLite format 3\u0000";
  if (!bytes || bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) if (bytes[i] !== signature.charCodeAt(i)) return false;
  return true;
}

async function sqliteSha256(bytes){
  if (!bytes || typeof crypto === "undefined" || !crypto.subtle || typeof crypto.subtle.digest !== "function") return "";
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function sqliteDiskSnapshot(dbPath, expectedFingerprint=""){
  const headers = { "X-Db-Path": encodeURIComponent(dbPath) };
  if (expectedFingerprint) headers["X-Db-Fingerprint"] = expectedFingerprint;
  const response = await fetch("/sqlite-disk-preview", { method:"POST", headers, cache:"no-store" });
  if (!response.ok){
    const error = new Error((await response.text()) || ("HTTP " + response.status));
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  if (!data || data.ok === false) throw new Error((data && data.error) || "SQLite 내용을 읽지 못했습니다.");
  return data;
}

function sqliteMessage(host, title, detail, kind=""){
  const wrap = document.createElement("div"); wrap.className = "sqlite-message" + (kind ? " " + kind : "");
  const heading = document.createElement("strong"); heading.textContent = title;
  const text = document.createElement("p"); text.textContent = detail;
  wrap.append(heading, text); host.appendChild(wrap);
}

async function renderSqlite(file, host, dbPath, onDiskPathChange, initialDbFullPath=""){
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

  let data, editable = false, dbFingerprint = "";
  if (dbPath){
    try {
      const expectedFingerprint = await sqliteSha256(bytes);
      if (expectedFingerprint){
        data = await sqliteDiskSnapshot(dbPath, expectedFingerprint);
        dbFingerprint = data.fingerprint || expectedFingerprint;
        editable = true;
      }
    } catch(e){
      // 저장 폴더에 동명 파일이 있더라도 현재 화면의 파일과 다르면 절대 편집 대상으로 삼지 않는다.
      if (!e || (e.status !== 404 && e.status !== 409)) console.warn("SQLite 디스크 원본 확인 실패:", e);
    }
  }
  if (!data){
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
  }

  let sqlText = "";   // 편집기 내용 — 다시 그릴 때 보존
  let copiedDbFullPath = String(initialDbFullPath || "");

  paintSqlite(data);

  function paintSqlite(data, execResult){
    shell.textContent = "";
    const toolbar = document.createElement("div"); toolbar.className = "sqlite-toolbar";
    const identity = document.createElement("div"); identity.className = "sqlite-identity";
    const title = document.createElement("strong"); title.textContent = file.name;
    const summary = document.createElement("span");
    const tables = Array.isArray(data.tables) ? data.tables : [];
    summary.textContent = "SQLite 3 · " + tables.length + "개 테이블/뷰 · " + (editable ? "편집 가능" : "읽기 전용")
      + " · 행 미리보기 최대 " + (data.limit || 200) + "개";
    identity.append(title, summary);
    const refresh = document.createElement("button"); refresh.type = "button"; refresh.textContent = "↻ 새로고침";
    refresh.title = "현재 파일을 다시 읽습니다";
    refresh.addEventListener("click", async () => {
      if (refresh.disabled) return;
      refresh.disabled = true;
      try {
        if (!editable){ host.innerHTML = ""; await renderSqlite(file, host, null); return; }
        const latest = await sqliteDiskSnapshot(dbPath);
        dbFingerprint = latest.fingerprint || dbFingerprint;
        data = latest;
        paintSqlite(data);
      } catch(e){
        paintSqlite(data, { error:"새로고침 실패: " + ((e && e.message) || String(e)) });
      } finally { refresh.disabled = false; }
    });
    toolbar.append(identity, refresh);
    shell.appendChild(toolbar);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(toolbar);

    shell.appendChild(editable ? buildSqlEditor(execResult) : buildSqliteReadOnlyNotice());

    if (!tables.length){
      sqliteMessage(shell, "비어 있는 데이터베이스입니다", "사용자 테이블이나 뷰가 아직 없습니다.");
      return;
    }

    const layout = document.createElement("div"); layout.className = "sqlite-layout";
    const nav = document.createElement("nav"); nav.className = "sqlite-table-list"; nav.setAttribute("aria-label", "SQLite 테이블");
    const content = document.createElement("div"); content.className = "sqlite-content";
    layout.append(nav, content); shell.appendChild(layout);
    paintTableList(tables, nav, content);
  }

  function sqliteCopyPath(){
    const original = String(file && file.name || "database.db");
    const clean = original.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "database.db";
    const dot = clean.lastIndexOf(".");
    const ext = dot > 0 && /\.(db|sqlite|sqlite3)$/i.test(clean.slice(dot)) ? clean.slice(dot) : ".db";
    const stem = (dot > 0 ? clean.slice(0, dot) : clean).replace(/[. ]+$/g, "") || "database";
    const now = new Date();
    const pad = (value, size=2) => String(value).padStart(size, "0");
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "-"
      + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + "-" + pad(now.getMilliseconds(), 3);
    return "SQLite 사본/" + stem + "-실행용-" + stamp + ext;
  }

  function buildSqliteReadOnlyNotice(){
    const panel = document.createElement("section"); panel.className = "sqlite-editor sqlite-readonly-notice";
    const head = document.createElement("div"); head.className = "sqlite-editor-head";
    const label = document.createElement("strong"); label.textContent = "SQL 실행";
    const hint = document.createElement("span"); hint.className = "sqlite-editor-hint sqlite-readonly-badge";
    hint.textContent = "읽기 전용";
    head.append(label, hint);

    const message = document.createElement("p"); message.className = "sqlite-readonly-copy";
    message.textContent = "이 데이터베이스는 읽기 전용으로 열렸습니다. SQL 실행과 데이터 변경은 안전을 위해 만능교실 저장 폴더에 있는 DB 파일에서만 사용할 수 있습니다.";

    const actions = document.createElement("div"); actions.className = "sqlite-editor-actions";
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "sqlite-run";
    copy.textContent = "저장 폴더에 사본 만들기";
    const open = document.createElement("button"); open.type = "button"; open.className = "sqlite-secondary";
    open.textContent = "저장 폴더 열기";
    const status = document.createElement("span"); status.className = "sqlite-exec-status";
    actions.append(copy, open, status);
    panel.append(head, message, actions);

    copy.addEventListener("click", async () => {
      if (copy.disabled) return;
      copy.disabled = true; open.disabled = true; status.textContent = "사본 저장 중…";
      try {
        const copyPath = sqliteCopyPath();
        const response = await fetch("/save-file", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Save-Path": encodeURIComponent(copyPath)
          },
          body: bytes
        });
        const savedFullPath = (await response.text()).trim();
        if (!response.ok) throw new Error(savedFullPath || ("HTTP " + response.status));
        const expectedFingerprint = await sqliteSha256(bytes);
        if (!expectedFingerprint) throw new Error("저장한 사본을 안전하게 확인하지 못했습니다.");
        const latest = await sqliteDiskSnapshot(copyPath, expectedFingerprint);
        dbPath = copyPath;
        copiedDbFullPath = savedFullPath || copyPath;
        dbFingerprint = latest.fingerprint || expectedFingerprint;
        editable = true;
        data = latest;
        if (typeof onDiskPathChange === "function") onDiskPathChange(copyPath, copiedDbFullPath);
        try { window.__mnLastSaveRel = copyPath; } catch(_){}
        if (typeof toast === "function") toast("저장 폴더에 실행 가능한 DB 사본을 만들었습니다.", 3000);
        paintSqlite(data);
      } catch(e){
        status.textContent = "사본을 만들지 못했습니다: " + ((e && e.message) || String(e));
        copy.disabled = false; open.disabled = false;
      }
    });

    open.addEventListener("click", async () => {
      if (open.disabled) return;
      open.disabled = true; status.textContent = "";
      try {
        const response = await fetch("/open-save-folder", {
          method: "POST",
          headers: { "X-PdfSigner-Action":"1" },
          cache: "no-store"
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
      } catch(e){
        status.textContent = "저장 폴더를 열지 못했습니다.";
      } finally { open.disabled = false; }
    });
    return panel;
  }

  function buildSqlEditor(execResult){
    const panel = document.createElement("section"); panel.className = "sqlite-editor";
    const head = document.createElement("div"); head.className = "sqlite-editor-head";
    const label = document.createElement("strong"); label.textContent = "SQL 실행";
    const hint = document.createElement("span"); hint.className = "sqlite-editor-hint";
    hint.textContent = "임의 SQL(SELECT·INSERT·UPDATE·DELETE·DDL) · 수정 시 자동 .bak 백업";
    head.append(label, hint);
    const input = document.createElement("textarea"); input.className = "sqlite-sql-input";
    input.spellcheck = false; input.rows = 3;
    input.placeholder = "예) INSERT INTO 학생(이름, 점수) VALUES ('홍길동', 90);";
    input.value = sqlText;
    input.addEventListener("input", () => { sqlText = input.value; });
    const actions = document.createElement("div"); actions.className = "sqlite-editor-actions";
    const run = document.createElement("button"); run.type = "button"; run.className = "sqlite-run";
    run.textContent = "▶ 실행 (Ctrl+Enter)";
    const status = document.createElement("span"); status.className = "sqlite-exec-status";
    actions.append(run, status);
    panel.append(head, input, actions);

    if (copiedDbFullPath){
      const location = document.createElement("div"); location.className = "sqlite-copy-location";
      const locationLabel = document.createElement("strong"); locationLabel.textContent = "사본 절대경로";
      const locationPath = document.createElement("code"); locationPath.textContent = copiedDbFullPath;
      locationPath.title = copiedDbFullPath;
      location.append(locationLabel, locationPath);
      panel.appendChild(location);
    }

    const result = document.createElement("div"); result.className = "sqlite-exec-result";
    if (execResult) fillExecResult(result, execResult); else result.hidden = true;
    panel.appendChild(result);

    const submit = () => runSql(input.value, run, status);
    run.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter"){ e.preventDefault(); submit(); }
    });
    return panel;
  }

  function fillExecResult(box, exec){
    box.hidden = false; box.textContent = "";
    if (exec.error){
      box.className = "sqlite-exec-result error";
      const p = document.createElement("p"); p.textContent = "오류: " + exec.error; box.appendChild(p);
      return;
    }
    box.className = "sqlite-exec-result ok";
    const head = document.createElement("p"); head.className = "sqlite-exec-summary";
    if (exec.kind === "select"){
      head.textContent = "SELECT · " + Number(exec.rowCount || 0).toLocaleString() + "행" + (exec.truncated ? " (처음 500행만 표시)" : "");
      box.appendChild(head);
      const cols = Array.isArray(exec.columns) ? exec.columns : [];
      const rows = Array.isArray(exec.rows) ? exec.rows : [];
      if (cols.length){
        const scroller = document.createElement("div"); scroller.className = "sqlite-grid-wrap";
        const grid = document.createElement("table"); grid.className = "sqlite-grid";
        const thead = document.createElement("thead"), hr = document.createElement("tr");
        const no = document.createElement("th"); no.textContent = "#"; hr.appendChild(no);
        cols.forEach(c => { const th = document.createElement("th"); th.textContent = c; hr.appendChild(th); });
        thead.appendChild(hr); grid.appendChild(thead);
        const tbody = document.createElement("tbody");
        rows.forEach((row, index) => {
          const tr = document.createElement("tr");
          const rn = document.createElement("th"); rn.scope = "row"; rn.textContent = String(index + 1); tr.appendChild(rn);
          cols.forEach((_, ci) => {
            const td = document.createElement("td"), v = row && row[ci];
            if (v === null || v === undefined){ td.textContent = "NULL"; td.className = "sqlite-null"; }
            else td.textContent = String(v);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        grid.appendChild(tbody); scroller.appendChild(grid); box.appendChild(scroller);
      }
    } else if (exec.kind === "write"){
      const affected = (exec.rowcount === null || exec.rowcount === undefined || exec.rowcount < 0) ? 0 : exec.rowcount;
      head.textContent = "완료 · " + Number(affected).toLocaleString() + "행 변경"
        + (exec.lastrowid ? " · 마지막 rowid " + exec.lastrowid : "");
      box.appendChild(head);
    } else {
      head.textContent = "완료 · 여러 문장 실행됨 (총 " + Number(exec.changes || 0).toLocaleString() + "행 변경)";
      box.appendChild(head);
    }
    if (exec.backup){
      const backup = document.createElement("p"); backup.className = "sqlite-exec-note";
      backup.textContent = "백업: " + exec.backup;
      box.appendChild(backup);
    }
    if (exec.previewError){
      const warning = document.createElement("p"); warning.className = "sqlite-exec-note warning";
      warning.textContent = "SQL은 완료됐지만 화면 새로고침에 실패했습니다: " + exec.previewError;
      box.appendChild(warning);
    }
  }

  async function runSql(text, runButton, status){
    const sql = String(text || "").trim();
    if (!sql){ status.textContent = "실행할 SQL을 입력하세요"; return; }
    if (blockedTxKeyword(sql)){
      status.textContent = "";
      paintSqlite(data, { error: SQLITE_TX_HINT });
      return;
    }
    if (looksDestructive(sql) && !confirm("되돌릴 수 없는 변경일 수 있습니다.\n실행 전 .bak 백업이 만들어집니다. 계속할까요?\n\n" + sql.slice(0, 300))) return;
    sqlText = sql;
    runButton.disabled = true; status.textContent = "실행 중…";
    try {
      const headers = { "Content-Type":"text/plain; charset=utf-8", "X-Db-Path": encodeURIComponent(dbPath) };
      if (dbFingerprint) headers["X-Db-Fingerprint"] = dbFingerprint;
      const response = await fetch("/sqlite-exec", {
        method: "POST",
        headers,
        body: sql
      });
      if (!response.ok){
        const reason = await response.text();
        if (response.status === 404) throw new Error("원본 파일을 찾을 수 없어 편집할 수 없습니다. (저장 폴더 안의 파일만 편집됩니다)");
        if (response.status === 409) throw new Error("파일이 화면을 연 뒤 외부에서 변경되었습니다. 새로고침한 뒤 다시 실행하세요.");
        if (response.status === 501) throw new Error("이 컴퓨터에서 Python을 찾지 못해 SQL을 실행할 수 없습니다.");
        if (response.status === 415) throw new Error("SQLite 3 형식이 아닌 파일입니다.");
        if (response.status === 413) throw new Error("SQL이 너무 깁니다. 2MB 이하로 나누어 실행하세요.");
        throw new Error(reason || ("HTTP " + response.status));
      }
      const out = await response.json();
      if (!out || out.ok === false){
        status.textContent = "";
        let error = (out && out.error) || "SQL 실행에 실패했습니다.";
        if (/not authorized/i.test(error)) error = SQLITE_TX_HINT;
        paintSqlite(data, { error });
        return;
      }
      dbFingerprint = out.fingerprint || dbFingerprint;
      const exec = out.exec || { kind:"write", rowcount:0 };
      try {
        data = await sqliteDiskSnapshot(dbPath);
        dbFingerprint = data.fingerprint || dbFingerprint;
      } catch(previewError){
        exec.previewError = (previewError && previewError.message) || String(previewError);
      }
      status.textContent = "";
      paintSqlite(data, exec);
    } catch(e){
      status.textContent = "";
      paintSqlite(data, { error: (e && e.message) || String(e) });
    } finally {
      runButton.disabled = false;
    }
  }

  // 이 도구는 변경을 자체 트랜잭션(+.bak 백업)으로 감싸 실행하므로, 수동 트랜잭션 제어와
  // 다른 DB 연결(ATTACH/DETACH)은 SQLite authorizer가 막아 "not authorized"를 던진다.
  const SQLITE_TX_HINT = "이 도구는 변경을 실행할 때마다 자동으로 커밋하고 .bak 백업을 만듭니다. "
    + "COMMIT·BEGIN·ROLLBACK 같은 트랜잭션 명령이나 ATTACH·DETACH는 직접 쓸 수 없습니다. "
    + "INSERT·UPDATE·DELETE·DDL만 그대로 실행하면 됩니다.";

  function blockedTxKeyword(sql){
    const kw = (sql.match(/^\s*([a-z]+)/i) || [,""])[1].toUpperCase();
    return kw === "BEGIN" || kw === "COMMIT" || kw === "END" || kw === "ROLLBACK"
      || kw === "SAVEPOINT" || kw === "RELEASE" || kw === "ATTACH" || kw === "DETACH";
  }

  function looksDestructive(sql){
    const kw = (sql.match(/^\s*([a-z]+)/i) || [,""])[1].toUpperCase();
    if (kw === "DROP" || kw === "TRUNCATE") return true;
    if (kw === "DELETE" && !/\bwhere\b/i.test(sql)) return true;   // WHERE 없는 전체 삭제
    if (kw === "UPDATE" && !/\bwhere\b/i.test(sql)) return true;   // WHERE 없는 전체 갱신
    return false;
  }

  function paintTableList(tables, nav, content){
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
}

function focusRenderedTextMatch(root, query){
  if (!root || !query) return false;
  clearTimeout(root._contentSearchFlashTimer);
  root.querySelectorAll("mark.content-search-flash").forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent || "")));
  root.normalize();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())){
    const parent = node.parentElement;
    if (parent && parent.closest("script,style,noscript")) continue;
    nodes.push(node);
  }
  const segments = renderedTextMatchSegments(nodes.map(item => item.nodeValue || ""), query);
  if (!segments.length) return false;
  const marks = [];
  // 뒤쪽 노드부터 감싸면 앞 노드의 참조와 인덱스가 바뀌지 않는다. 한 검색어가 여러 서식 span에
  // 걸쳐 있어도 각 조각을 따로 mark로 감싸 원래 DOM 서식을 보존한다.
  for (let i = segments.length - 1; i >= 0; i--){
    const segment = segments[i], textNode = nodes[segment.index];
    if (!textNode || !textNode.parentNode) continue;
    const value = textNode.nodeValue || "";
    const mark = document.createElement("mark");
    mark.className = "content-search-flash";
    mark.textContent = value.slice(segment.start, segment.end);
    const parts = [];
    if (segment.start > 0) parts.push(document.createTextNode(value.slice(0, segment.start)));
    parts.push(mark);
    if (segment.end < value.length) parts.push(document.createTextNode(value.slice(segment.end)));
    textNode.replaceWith(...parts);
    marks.unshift(mark);
  }
  const first = marks[0];
  if (!first) return false;
  first.tabIndex = -1;
  try { first.focus({ preventScroll:true }); } catch(_) { first.focus(); }
  first.scrollIntoView({ block:"center", inline:"nearest", behavior:"smooth" });
  root._contentSearchFlashTimer = setTimeout(() => {
    marks.forEach(mark => {
      if (mark.isConnected) mark.replaceWith(document.createTextNode(mark.textContent || ""));
    });
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
